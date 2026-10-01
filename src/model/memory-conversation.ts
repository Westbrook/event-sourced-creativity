import {
  createMemoryRecord, memoryDigest, memoryKey, memoryRecordEligible, memorySourceEligible, memorySourceMatches,
  type MemoryAccess, type MemoryRecord, type MemoryScopeGraph, type MemorySource, type MemorySourceRef, type MemorySuppression,
} from "./scoped-memory.ts";

export type MemoryConversationTurn = {
  turnId: string; conversationId: string; role: "user" | "assistant";
  status: "final" | "pending" | "superseded"; text: string; source: MemorySourceRef;
};
export type MemoryConversationInventory = {
  conversationId: string; scopeId: string; completeFromStart: boolean;
  /** Must come from the private conversation ledger, not display-local 0..5 indices. */
  turns: readonly MemoryConversationTurn[];
};
export type MemoryConversationSegment = {
  method: "extractive-v1"; conversationId: string;
  covered: readonly Pick<MemoryConversationTurn, "turnId" | "role" | "source">[];
  record: MemoryRecord;
};

type LiveConversationQuoteReference = { excerptIndex: number; role: "user" | "assistant"; start: number; end: number };
export type LiveConversationDigest = {
  method: "local-extractive-quotes-v1"; completeFromStart: false; showOriginals: boolean;
  quotes: { role: "user" | "assistant"; text: string; references: LiveConversationQuoteReference[] }[];
  excerptOnly: { excerptIndex: number; role: "user" | "assistant"; reason: "unsupported" | "unfinished" | "clipped" | "budget" }[];
};

const quoteWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character);
const quoteClosers = new Set(["\"", "'", "”", "’", "»", ")", "]", "）", "】", "」", "』", "》"]);
function balancedQuote(characters: readonly string[]): boolean {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "（": "）", "【": "】", "「": "」", "『": "』", "《": "》", "“": "”", "‘": "’", "«": "»" };
  const stack: string[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    // Keep apostrophes inside words and trailing possessives; they are not quotes.
    if ((character === "'" || character === "’") && quoteWord(characters[index - 1])
      && (quoteWord(characters[index + 1]) || stack.at(-1) !== character)) continue;
    if (character === "\"" || character === "'") {
      if (stack.at(-1) === character) stack.pop(); else stack.push(character);
    } else if (Object.hasOwn(pairs, character)) stack.push(pairs[character]);
    else if (quoteClosers.has(character)) { if (stack.pop() !== character) return false; }
  }
  return stack.length === 0;
}

function liveQuoteSpans(text: string, possiblyByteClipped = false): { spans: { start: number; end: number; text: string }[];
  reason: "unsupported" | "unfinished" | "clipped" | null } {
  const characters = Array.from(text), spans: { start: number; end: number; text: string }[] = [];
  const clipped = characters.length === 512 || possiblyByteClipped;
  // This is deliberately not a code/Markdown parser or a language classifier.
  // Ambiguous syntax stays visible in the original excerpts instead of being rewritten.
  if (/[`{}<>\\]|:\/\/|=>|(?:^|\n)\s*[$#]|(?:^|\n)\s*\w+\s*[=:]/u.test(text) || !balancedQuote(characters))
    return { spans, reason: "unsupported" };
  let start = 0;
  while (/\s/u.test(characters[start] ?? "")) start++;
  for (let index = start; index < characters.length; index++) {
    if (!/[.!?。！？؟]/u.test(characters[index])) continue;
    let end = index + 1;
    while (end < characters.length && (/[.!?。！？؟]/u.test(characters[end]) || quoteClosers.has(characters[end]))) end++;
    if (end < characters.length && !/\s/u.test(characters[end]) && !/[。！？]/u.test(characters[index])) continue;
    // Interior periods may be abbreviations, decimals or grammatical boundaries.
    // Keep them together instead of guessing a language-specific abbreviation list.
    if (characters[index] === "." && !/[!?。！？؟]/u.test(characters.slice(index, end).join(""))
      && characters.slice(end).some(character => /\S/u.test(character))) continue;
    const selected = characters.slice(start, end);
    if (!selected.some(quoteWord) || !balancedQuote(selected)) continue;
    // At the wire cap we cannot know whether the final span lost following context.
    if (clipped && !characters.slice(end).some(character => /\S/u.test(character))) break;
    spans.push({ start, end, text: selected.join("") });
    start = end;
    while (/\s/u.test(characters[start] ?? "")) start++;
    index = start - 1;
  }
  return { spans, reason: clipped ? "clipped" : start < characters.length || !spans.length ? "unfinished" : null };
}

/**
 * Render-local quotation view of the already decoded older-six live clips only.
 * This does not authenticate sources, create shadow provenance, persist a summary,
 * or infer intent/accepted decisions. The caller must retain the original clips and
 * discard this result with their existing access/retention lease. Offsets are Unicode
 * code points into those clips, not full-message offsets or claims of complete history.
 * Native readers instead cap clips at 512 UTF-8 bytes. A 509–512-byte clip may have
 * lost a following code point (at most four bytes), so its terminal span is unsafe.
 * The default preserves the original code-point-bounded display contract.
 */
export function liveConversationDigest(excerpts: readonly { user: string; assistant: string }[],
  clipping: "code-points-512" | "utf8-512" = "code-points-512"): LiveConversationDigest {
  if (!["code-points-512", "utf8-512"].includes(clipping) || !Array.isArray(excerpts) || excerpts.length > 6 || excerpts.some(excerpt => !excerpt
    || [excerpt.user, excerpt.assistant].some(text => typeof text !== "string" || Array.from(text).length > 512
      || clipping === "utf8-512" && (!text.isWellFormed() || new TextEncoder().encode(text).byteLength > 512))))
    throw new Error("Invalid decoded live conversation clips");
  const result: LiveConversationDigest = { method: "local-extractive-quotes-v1", completeFromStart: false,
    showOriginals: false, quotes: [], excerptOnly: [] };
  const utterances = excerpts.flatMap((excerpt, excerptIndex) => (["user", "assistant"] as const).map(role => {
    const parsed = liveQuoteSpans(excerpt[role], clipping === "utf8-512" && new TextEncoder().encode(excerpt[role]).byteLength >= 509);
    if (parsed.reason) result.excerptOnly.push({ excerptIndex, role, reason: parsed.reason });
    return { excerptIndex, role, spans: parsed.spans, omitted: false };
  }));
  let bytes = 0;
  // Round-robin sentence-like quote selection, then source-order display. There is no semantic
  // or language-specific ranking. Never cut a selected quote to fit the fixed budget.
  for (let round = 0; utterances.some(utterance => round < utterance.spans.length); round++) {
    for (const utterance of utterances) {
      const span = utterance.spans[round];
      if (!span) continue;
      const reference = { excerptIndex: utterance.excerptIndex, role: utterance.role, start: span.start, end: span.end };
      const duplicate = result.quotes.find(quote => quote.role === utterance.role && quote.text === span.text);
      if (duplicate) { duplicate.references.push(reference); continue; }
      const size = new TextEncoder().encode(span.text).byteLength;
      if (result.quotes.length === 8 || bytes + size > 2_048) { utterance.omitted = true; continue; }
      bytes += size; result.quotes.push({ role: utterance.role, text: span.text, references: [reference] });
    }
  }
  for (const utterance of utterances) if (utterance.omitted)
    result.excerptOnly.push({ excerptIndex: utterance.excerptIndex, role: utterance.role, reason: "budget" });
  const sourceOrder = (a: LiveConversationQuoteReference, b: LiveConversationQuoteReference) => {
    return a.excerptIndex - b.excerptIndex || (a.role === b.role ? a.start - b.start : a.role === "user" ? -1 : 1);
  };
  for (const quote of result.quotes) quote.references.sort(sourceOrder);
  result.quotes.sort((left, right) => sourceOrder(left.references[0], right.references[0]));
  // A collapsed repeated quote must not hide a later correction/reassertion's place
  // in the original chronology. Keep the original pairs visible whenever we dedupe.
  result.showOriginals = result.excerptOnly.length > 0 || result.quotes.some(quote => quote.references.length > 1);
  return result;
}

async function finalizedInventory(inventory: MemoryConversationInventory, sources: ReadonlyMap<string, MemorySource>,
  access: MemoryAccess, graph: MemoryScopeGraph, purpose: "learn" | "recall"): Promise<MemoryConversationTurn[] | null> {
  if (!inventory.conversationId || inventory.scopeId !== access.targetScopeId || inventory.turns.length > 256
    || typeof inventory.completeFromStart !== "boolean" || inventory.turns.some((turn) => !["final", "pending", "superseded"].includes(turn.status))) return null;
  const turns = structuredClone(inventory.turns.filter((turn) => turn.status === "final"));
  const seenEvents = new Set<string>(), seenMessages = new Set<string>(), seenSequences = new Set<number>(), streams = new Set<string>();
  for (const turn of turns) {
    const current = sources.get(memoryKey(turn.source.custodianId, turn.source.id));
    const source = current ? { ...current } : undefined;
    if (!source || !memorySourceMatches(turn.source, source) || !memorySourceEligible(source, access, graph, purpose)
      || source.visibility !== "actor" || source.actorUserId !== access.actorUserId || source.scopeId !== inventory.scopeId
      || source.speaker !== turn.role
      || !turn.turnId || turn.conversationId !== inventory.conversationId || !["user", "assistant"].includes(turn.role)
      || typeof turn.text !== "string" || !turn.text.trim() || new TextEncoder().encode(turn.text).byteLength > 16_384
      || source.contentHash !== await memoryDigest(turn.text)) return null;
    const live = sources.get(memoryKey(turn.source.custodianId, turn.source.id));
    if (!live || !memorySourceMatches(source, live) || !memorySourceEligible(live, access, graph, purpose)) return null;
    const messageKey = JSON.stringify([turn.turnId, turn.role]);
    if (seenEvents.has(source.id) || seenMessages.has(messageKey) || seenSequences.has(source.sequence)) return null;
    seenEvents.add(source.id); seenMessages.add(messageKey); seenSequences.add(source.sequence); streams.add(source.streamId);
  }
  // A later integration may provide a canonical conversation order. Never compare unrelated cursors here.
  if (streams.size > 1) return null;
  if (turns.some((turn) => {
    const source = sources.get(memoryKey(turn.source.custodianId, turn.source.id));
    return !source || !memorySourceMatches(turn.source, source) || !memorySourceEligible(source, access, graph, purpose);
  })) return null;
  return [...turns].sort((left, right) => sources.get(memoryKey(left.source.custodianId, left.source.id))!.sequence
    - sources.get(memoryKey(right.source.custodianId, right.source.id))!.sequence);
}

const extractiveBody = (turns: readonly Pick<MemoryConversationTurn, "text" | "role">[]) => turns.map((turn) => {
  const characters = Array.from(turn.text.replace(/\s+/gu, " ").trim());
  const excerpt = characters.slice(0, 160).join("") + (characters.length > 160 ? "…" : "");
  return `${turn.role === "user" ? "User stated" : "Assistant proposed (not an accepted decision)"}: ${excerpt}`;
}).join("\n");

/** Exact rendered budget for chunking; source/role eligibility is still checked separately. */
export const memoryConversationExcerptBytes = (turns: readonly Pick<MemoryConversationTurn, "text" | "role">[]): number =>
  new TextEncoder().encode(extractiveBody(turns)).byteLength;

/** Deterministic extractive baseline, not a semantic model summary or accepted-decision extractor. */
export async function createMemoryConversationSegment(input: {
  id: string; version: number; inventory: MemoryConversationInventory;
}, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph): Promise<MemoryConversationSegment | null> {
  const captured = structuredClone(input);
  const turns = await finalizedInventory(captured.inventory, sources, access, graph, "learn");
  if (!turns?.length || turns.length > 16) return null;
  const body = extractiveBody(turns);
  const record = createMemoryRecord({ id: captured.id, version: captured.version, scopeId: captured.inventory.scopeId,
    kind: "conversation-summary", claimKey: `conversation:${captured.inventory.conversationId}`, body,
    sources: turns.map((turn) => sources.get(memoryKey(turn.source.custodianId, turn.source.id))!),
  }, access, graph);
  return record ? { method: "extractive-v1", conversationId: captured.inventory.conversationId, record,
    covered: turns.map(({ turnId, role, source }) => ({ turnId, role, source: { ...source } })) } : null;
}

export type MemoryConversationCoverage = {
  status: "ready" | "blocked"; completeFromStart: boolean; continuous: boolean;
  segments: MemoryConversationSegment[]; recentTurns: MemoryConversationTurn[];
  summarizedTurnIds: string[]; recentTurnIds: string[]; omittedTurnIds: string[];
  reason?: "ineligible-inventory";
};

/** Exact summarized prefix + uncovered tail; missing middle turns are explicitly reported. */
export async function memoryConversationCoverage(input: {
  inventory: MemoryConversationInventory; segments: readonly MemoryConversationSegment[];
  recentLimit?: number; summaryByteLimit?: number;
}, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph,
  suppressions: readonly MemorySuppression[] = []): Promise<MemoryConversationCoverage> {
  const captured = structuredClone(input);
  const turns = await finalizedInventory(captured.inventory, sources, access, graph, "recall");
  const recentLimit = captured.recentLimit ?? 6, byteLimit = captured.summaryByteLimit ?? 2_048;
  if (!Number.isSafeInteger(recentLimit) || recentLimit < 0 || recentLimit > 32
    || !Number.isSafeInteger(byteLimit) || byteLimit < 0 || byteLimit > 8_192) throw new Error("Invalid conversation memory budget");
  if (!turns) return { status: "blocked", completeFromStart: false, continuous: false,
    segments: [], recentTurns: [], summarizedTurnIds: [], recentTurnIds: [], omittedTurnIds: [], reason: "ineligible-inventory" };
  const selected: MemoryConversationSegment[] = [];
  const turnByKey = new Map(turns.map((turn) => [JSON.stringify([turn.turnId, turn.role]), turn]));
  const eligible = captured.segments.filter((segment) => segment.method === "extractive-v1"
    && segment.conversationId === captured.inventory.conversationId && segment.record.scopeId === captured.inventory.scopeId
    && segment.record.claimKey === `conversation:${captured.inventory.conversationId}`
    && segment.record.kind === "conversation-summary" && segment.record.authority === "historical"
    && memoryRecordEligible(segment.record, sources, access, graph, suppressions)
    && segment.covered.length > 0 && segment.covered.length === segment.record.sources.length
    && segment.covered.every((turn, index) => memorySourceMatches(turn.source, segment.record.sources[index]))
    && segment.covered.every((turn) => turnByKey.has(JSON.stringify([turn.turnId, turn.role])))
    && segment.record.body === extractiveBody(segment.covered.map((turn) => turnByKey.get(JSON.stringify([turn.turnId, turn.role]))!)))
    .sort((left, right) => right.covered.length - left.covered.length || right.record.version - left.record.version || left.record.id.localeCompare(right.record.id));
  let covered = 0, bytes = 0;
  while (covered < turns.length && selected.length < 4) {
    const next = eligible.find((segment) => !selected.includes(segment) && segment.covered.every((reference, offset) => {
      const turn = turns[covered + offset];
      return turn && reference.turnId === turn.turnId && reference.role === turn.role
        && memorySourceMatches(reference.source, turn.source);
    }) && bytes + new TextEncoder().encode(segment.record.body).byteLength <= byteLimit);
    if (!next) break;
    selected.push(next); covered += next.covered.length; bytes += new TextEncoder().encode(next.record.body).byteLength;
  }
  const recentStart = Math.max(covered, turns.length - recentLimit);
  const recent = turns.slice(recentStart);
  const turnKey = (turn: Pick<MemoryConversationTurn, "turnId" | "role">) => JSON.stringify([turn.turnId, turn.role]);
  const omitted = turns.slice(covered, recentStart).map(turnKey);
  return {
    status: "ready", completeFromStart: captured.inventory.completeFromStart,
    continuous: captured.inventory.completeFromStart && omitted.length === 0,
    segments: selected, recentTurns: recent, summarizedTurnIds: turns.slice(0, covered).map(turnKey),
    recentTurnIds: recent.map(turnKey), omittedTurnIds: omitted,
  };
}

import { memoryScopePath } from "./scoped-memory.ts";

export type StructuredMemoryConversationCategory = "goal" | "decision" | "proposal" | "rejected-alternative"
  | "question" | "blocker" | "next-step";
export type StructuredMemoryConversationOperation = "assert" | "correct" | "supersede" | "withdraw";
export type StructuredMemoryConversationReference = {
  itemId: string; revision: number; category: StructuredMemoryConversationCategory; operation: StructuredMemoryConversationOperation;
  turnId: string; role: "user" | "assistant"; source: MemorySourceRef;
  /** Half-open Unicode code-point offsets into the exact original message. */
  start: number; end: number; text: string;
};
export type StructuredMemoryConversationAnnotation = StructuredMemoryConversationReference & {
  predecessor: StructuredMemoryConversationReference | null;
};
export type StructuredMemoryConversationItem = {
  itemId: string; category: StructuredMemoryConversationCategory; role: "user" | "assistant";
  state: "asserted" | "withdrawn"; current: StructuredMemoryConversationReference;
  history: readonly StructuredMemoryConversationAnnotation[];
};
export type StructuredMemoryConversationSegment = {
  method: "structured-declarations-v1"; semanticAuthority: "caller-declared-unverified"; semanticCompleteness: false;
  conversationId: string; covered: readonly Pick<MemoryConversationTurn, "turnId" | "role" | "source">[];
  annotations: readonly StructuredMemoryConversationAnnotation[]; items: readonly StructuredMemoryConversationItem[];
  record: MemoryRecord;
};
export type StructuredMemoryConversationCoverage = {
  status: "ready" | "blocked"; semanticAuthority: "caller-declared-unverified"; semanticCompleteness: false;
  completeFromStart: boolean; continuous: boolean;
  segments: StructuredMemoryConversationSegment[]; items: StructuredMemoryConversationItem[]; recentTurns: MemoryConversationTurn[];
  /** All validated original messages; selected structural coverage remains in segments.covered. */
  examinedTurnIds: string[]; annotatedTurnIds: string[]; unannotatedTurnIds: string[]; recentTurnIds: string[]; omittedTurnIds: string[];
  validUntil: string | null;
  reason?: "ineligible-inventory" | "unresolved-annotations" | "invalid-segment" | "stale-authority" | "suppressed";
};

const structuredCategories = new Set<string>(["goal", "decision", "proposal", "rejected-alternative", "question", "blocker", "next-step"]);
const structuredOperations = new Set<string>(["assert", "correct", "supersede", "withdraw"]);
const structuredTurnKey = (turn: Pick<MemoryConversationTurn, "turnId" | "role">) => JSON.stringify([turn.turnId, turn.role]);
const structuredReference = (value: StructuredMemoryConversationReference): StructuredMemoryConversationReference => ({
  itemId: value.itemId, revision: value.revision, category: value.category, operation: value.operation,
  turnId: value.turnId, role: value.role, source: { ...value.source }, start: value.start, end: value.end, text: value.text,
});
const structuredReferenceEqual = (left: StructuredMemoryConversationReference, right: StructuredMemoryConversationReference) =>
  Boolean(left && right && left.source && right.source) && left.itemId === right.itemId && left.revision === right.revision
  && left.category === right.category && left.operation === right.operation && left.turnId === right.turnId && left.role === right.role
  && left.start === right.start && left.end === right.end && left.text === right.text && memorySourceMatches(left.source, right.source);
const structuredAnnotationEqual = (left: StructuredMemoryConversationAnnotation, right: StructuredMemoryConversationAnnotation) =>
  structuredReferenceEqual(left, right) && (left.predecessor === null && right.predecessor === null
    || Boolean(left.predecessor && right.predecessor && structuredReferenceEqual(left.predecessor, right.predecessor)));
const structuredPosition = (left: StructuredMemoryConversationReference, right: StructuredMemoryConversationReference) =>
  left.source.sequence - right.source.sequence || left.start - right.start || left.end - right.end;

/** This fingerprint detects caller authority mutation across hashing; it is not an authority signature. */
function structuredAuthority(access: MemoryAccess, graph: MemoryScopeGraph, suppressions: readonly MemorySuppression[] = []): string {
  return JSON.stringify([access.actorUserId, access.custodianId, access.targetScopeId, access.enabled, access.environment, access.now,
    access.enrollmentExpiresAt, access.retentionDays, [access.fence.permission, access.fence.erasure, access.fence.ancestry, access.fence.policy],
    access.grants.map(grant => [grant.custodianId, grant.scopeId, grant.scopeVersion, grant.canRead, [...grant.purposes], grant.expiresAt]),
    [...graph].map(([key, scope]) => [key, scope.id, scope.custodianId, scope.kind, scope.parentId, scope.version]),
    suppressions.map(value => [value.actorUserId, value.custodianId, value.scopeId, value.claimKey, [...value.lineageIds], value.state])]);
}

/** Reduce the whole declared ledger BEFORE eligibility selection or budget truncation. */
function structuredLedger(annotations: readonly StructuredMemoryConversationAnnotation[], turns: readonly MemoryConversationTurn[]): {
  annotations: StructuredMemoryConversationAnnotation[]; items: StructuredMemoryConversationItem[];
} | null {
  if (!Array.isArray(annotations) || annotations.length > 256 || turns.some(turn => !turn.text.isWellFormed())) return null;
  const byTurn = new Map(turns.map(turn => [structuredTurnKey(turn), turn]));
  const ordered: StructuredMemoryConversationAnnotation[] = [];
  for (const annotation of annotations) {
    if (!annotation || typeof annotation.itemId !== "string" || !annotation.itemId.trim() || annotation.itemId.length > 256
      || !annotation.itemId.isWellFormed() || !Number.isSafeInteger(annotation.revision) || annotation.revision < 1
      || !structuredCategories.has(annotation.category) || !structuredOperations.has(annotation.operation)
      || annotation.category === "decision" && annotation.role !== "user" || !annotation.source
      || !Number.isSafeInteger(annotation.start) || !Number.isSafeInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start
      || typeof annotation.text !== "string" || !annotation.text.trim() || !annotation.text.isWellFormed()) return null;
    const turn = byTurn.get(structuredTurnKey(annotation));
    if (!turn || turn.role !== annotation.role || !memorySourceMatches(annotation.source, turn.source)) return null;
    const characters = Array.from(turn.text);
    if (annotation.end > characters.length || characters.slice(annotation.start, annotation.end).join("") !== annotation.text) return null;
    if (annotation.predecessor !== null && (!annotation.predecessor || typeof annotation.predecessor !== "object"
      || Array.isArray(annotation.predecessor) || !annotation.predecessor.source)) return null;
    ordered.push({ ...structuredReference(annotation), predecessor: annotation.predecessor === null ? null
      : structuredReference(annotation.predecessor) });
  }
  ordered.sort((left, right) => structuredPosition(left, right)
    || (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : left.revision - right.revision));
  const histories = new Map<string, StructuredMemoryConversationAnnotation[]>();
  for (const annotation of ordered) {
    const history = histories.get(annotation.itemId), previous = history?.at(-1);
    if (!previous) {
      if (annotation.operation !== "assert" || annotation.revision !== 1 || annotation.predecessor !== null) return null;
      histories.set(annotation.itemId, [annotation]);
    } else {
      if (annotation.operation === "assert" || annotation.revision !== previous.revision + 1
        || !annotation.predecessor || !structuredReferenceEqual(annotation.predecessor, previous)
        || annotation.role !== previous.role || annotation.category !== previous.category || structuredPosition(previous, annotation) >= 0
        || annotation.source.sequence === previous.source.sequence && annotation.start < previous.end) return null;
      history!.push(annotation);
    }
  }
  const items = [...histories.values()].map(history => {
    const current = history.at(-1)!;
    return { itemId: current.itemId, category: current.category, role: current.role,
      state: current.operation === "withdraw" ? "withdrawn" as const : "asserted" as const,
      current: structuredReference(current), history };
  }).sort((left, right) => structuredPosition(left.current, right.current)
    || (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
  return { annotations: ordered, items };
}

/** Canonical rendering retains every operation and exact quote, not just the active head. */
function structuredBody(items: readonly StructuredMemoryConversationItem[]): string {
  return JSON.stringify({ semanticAuthority: "caller-declared-unverified", items: items.map(item => ({
    itemId: item.itemId, category: item.category, role: item.role, state: item.state,
    history: item.history.map(annotation => [annotation.revision, annotation.operation, annotation.turnId, annotation.role,
      annotation.source.id, annotation.source.revision, annotation.start, annotation.end, annotation.text, annotation.predecessor?.revision ?? null]),
  })) });
}
function structuredItemsEqual(left: readonly StructuredMemoryConversationItem[], right: readonly StructuredMemoryConversationItem[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => {
    const expected = right[index];
    return item && item.itemId === expected.itemId && item.category === expected.category && item.role === expected.role
      && item.state === expected.state && structuredReferenceEqual(item.current, expected.current)
      && Array.isArray(item.history) && item.history.length === expected.history.length
      && item.history.every((annotation: StructuredMemoryConversationAnnotation, offset: number) => structuredAnnotationEqual(annotation, expected.history[offset]));
  });
}
function structuredSourcesCurrent(turns: readonly MemoryConversationTurn[], sources: ReadonlyMap<string, MemorySource>,
  access: MemoryAccess, graph: MemoryScopeGraph, purpose: "learn" | "recall"): boolean {
  return turns.every(turn => {
    const source = sources.get(memoryKey(turn.source.custodianId, turn.source.id));
    return source && memorySourceMatches(turn.source, source) && memorySourceEligible(source, access, graph, purpose)
      && source.speaker === turn.role && source.visibility === "actor" && source.actorUserId === access.actorUserId
      && source.scopeId === access.targetScopeId;
  });
}
function structuredDeadline(turns: readonly MemoryConversationTurn[], records: readonly MemoryRecord[],
  sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess): string | null {
  if (!turns.length) return null;
  const scopes = new Set([access.targetScopeId, ...turns.map(turn => turn.source.scopeId)]);
  const deadlines = [Date.parse(access.enrollmentExpiresAt), ...records.map(record => Date.parse(record.expiresAt)),
    ...access.grants.filter(grant => scopes.has(grant.scopeId) && grant.custodianId === access.custodianId).map(grant => Date.parse(grant.expiresAt))];
  for (const turn of turns) {
    const source = sources.get(memoryKey(turn.source.custodianId, turn.source.id));
    if (!source) return null;
    deadlines.push(Date.parse(source.expiresAt), Date.parse(source.happenedAt) + access.retentionDays * 86_400_000);
  }
  const deadline = Math.min(...deadlines);
  return Number.isFinite(deadline) && deadline > Date.parse(access.now) ? new Date(deadline).toISOString() : null;
}

/** Memory-derived fallback is not an exception to forgetting this conversation. */
function structuredSuppressed(input: { inventory: MemoryConversationInventory;
  annotations: readonly StructuredMemoryConversationAnnotation[]; segments: readonly StructuredMemoryConversationSegment[] },
  sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph, suppressions: readonly MemorySuppression[]): boolean {
  const active = suppressions.filter(value => value.state === "active" && value.actorUserId === access.actorUserId
    && value.custodianId === access.custodianId);
  if (!active.length) return false;
  let ancestors: Set<string>;
  try { ancestors = new Set(memoryScopePath(graph, access.custodianId, access.targetScopeId).map(scope => scope.id)); }
  catch { return true; }
  const lineage = new Set<string>();
  const include = (ref: MemorySourceRef | undefined) => {
    // A forged/stale caller lineage must not hide the current source behind the
    // same referenced ID. This target-scoped lookup can deny, never grant access.
    const current = ref && typeof ref.id === "string" ? sources.get(memoryKey(access.custodianId, ref.id)) : undefined;
    if (current && current.id === ref!.id && current.custodianId === access.custodianId
      && current.scopeId === access.targetScopeId && current.actorUserId === access.actorUserId
      && typeof current.lineageId === "string") lineage.add(current.lineageId);
    if (ref && ref.custodianId === access.custodianId && ref.scopeId === access.targetScopeId
      && ref.actorUserId === access.actorUserId && typeof ref.lineageId === "string") lineage.add(ref.lineageId);
  };
  for (const turn of input.inventory.turns) if (turn?.conversationId === input.inventory.conversationId) include(turn.source);
  const targetTurns = new Set(input.inventory.turns.filter(turn => turn?.conversationId === input.inventory.conversationId).map(structuredTurnKey));
  if (Array.isArray(input.annotations)) for (const annotation of input.annotations) {
    if (annotation && targetTurns.has(structuredTurnKey(annotation))) include(annotation.source);
    if (annotation?.predecessor && targetTurns.has(structuredTurnKey(annotation.predecessor))) include(annotation.predecessor.source);
  }
  if (Array.isArray(input.segments)) for (const segment of input.segments) {
    if (segment?.conversationId === input.inventory.conversationId && segment.record?.scopeId === access.targetScopeId
      && segment.record.actorUserId === access.actorUserId && segment.record.custodianId === access.custodianId
      && Array.isArray(segment.record.sources)) for (const ref of segment.record.sources) include(ref);
  }
  return active.some(value => ancestors.has(value.scopeId) && value.claimKey === `conversation-structured:${input.inventory.conversationId}`
    || value.lineageIds.some(id => lineage.has(id)));
}

/**
 * A caller-declared annotation projection, not a semantic classifier or operational approval.
 * The caller must supply original messages and a complete authoritative annotation ledger.
 * Current source receipts bind quotations and speaker; matching text hashes do not
 * authenticate categories or the absence of omitted corrections.
 * Sixteen-message segments are an implementation bound, not an accepted token-budget default.
 */
export async function createStructuredMemoryConversationSegment(input: {
  id: string; version: number; inventory: MemoryConversationInventory; annotations: readonly StructuredMemoryConversationAnnotation[];
}, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph): Promise<StructuredMemoryConversationSegment | null> {
  const captured = structuredClone(input), capturedAccess = structuredClone(access), capturedGraph = structuredClone(graph);
  const authority = structuredAuthority(access, graph);
  if (!Array.isArray(captured.inventory.turns) || captured.inventory.turns.some(turn => !turn || !turn.source
    || typeof turn.text !== "string" || !turn.text.isWellFormed())) return null;
  const turns = await finalizedInventory(captured.inventory, sources, capturedAccess, capturedGraph, "learn");
  if (authority !== structuredAuthority(access, graph) || !turns?.length || turns.length > 16
    || !structuredSourcesCurrent(turns, sources, capturedAccess, capturedGraph, "learn")) return null;
  const ledger = structuredLedger(captured.annotations, turns);
  if (!ledger) return null;
  const record = createMemoryRecord({ id: captured.id, version: captured.version, scopeId: captured.inventory.scopeId,
    kind: "conversation-summary", claimKey: `conversation-structured:${captured.inventory.conversationId}`,
    body: structuredBody(ledger.items), confidence: 0,
    sources: turns.map(turn => sources.get(memoryKey(turn.source.custodianId, turn.source.id))!),
  }, capturedAccess, capturedGraph);
  if (!record || authority !== structuredAuthority(access, graph)
    || !structuredSourcesCurrent(turns, sources, capturedAccess, capturedGraph, "learn")) return null;
  return { method: "structured-declarations-v1", semanticAuthority: "caller-declared-unverified", semanticCompleteness: false,
    conversationId: captured.inventory.conversationId, covered: turns.map(({ turnId, role, source }) => ({ turnId, role, source: { ...source } })),
    annotations: ledger.annotations, items: ledger.items, record };
}

/**
 * Single-conversation read: any invalid supplied annotation/segment blocks structured output.
 * Recompute against current authorized originals; never learn again, renew a record, or fall
 * back to an older active head after a negative successor becomes unavailable. The durable
 * adapter must own immutable segments, original expiry and the complete current ledger: a
 * stateless function cannot detect an entirely omitted later declaration or sign its metadata.
 * Fresh server time/access and a publication-time lease check remain integration requirements.
 */
export async function structuredMemoryConversationCoverage(input: {
  inventory: MemoryConversationInventory; annotations: readonly StructuredMemoryConversationAnnotation[];
  segments: readonly StructuredMemoryConversationSegment[]; recentLimit: number; summaryByteLimit: number;
}, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph,
  suppressions: readonly MemorySuppression[] = []): Promise<StructuredMemoryConversationCoverage> {
  const captured = structuredClone(input), capturedAccess = structuredClone(access), capturedGraph = structuredClone(graph);
  const capturedSuppressions = structuredClone(suppressions), authority = structuredAuthority(access, graph, suppressions);
  const recentLimit = captured.recentLimit, byteLimit = captured.summaryByteLimit;
  if (!Number.isSafeInteger(recentLimit) || recentLimit < 0 || recentLimit > 32
    || !Number.isSafeInteger(byteLimit) || byteLimit < 0 || byteLimit > 8_192) throw new Error("Invalid structured conversation memory budget");
  const empty = (reason: StructuredMemoryConversationCoverage["reason"], turns: readonly MemoryConversationTurn[] = []): StructuredMemoryConversationCoverage => {
    const recent = recentLimit ? turns.slice(-recentLimit) : [];
    return { status: "blocked", semanticAuthority: "caller-declared-unverified", semanticCompleteness: false,
      completeFromStart: false, continuous: false, segments: [], items: [], recentTurns: [...recent],
      examinedTurnIds: turns.map(structuredTurnKey), annotatedTurnIds: [], unannotatedTurnIds: [],
      recentTurnIds: recent.map(structuredTurnKey), omittedTurnIds: turns.slice(0, turns.length - recent.length).map(structuredTurnKey),
      validUntil: structuredDeadline(turns, [], sources, capturedAccess), reason };
  };
  const inventoryShape = Array.isArray(captured.inventory.turns) && captured.inventory.turns.length <= 256
    && captured.inventory.scopeId === capturedAccess.targetScopeId && typeof captured.inventory.conversationId === "string"
    && Boolean(captured.inventory.conversationId) && typeof captured.inventory.completeFromStart === "boolean";
  if (!inventoryShape) return empty("ineligible-inventory");
  if (structuredSuppressed(captured, sources, capturedAccess, capturedGraph, capturedSuppressions)) return empty("suppressed");
  const originalText = captured.inventory.turns.every(turn => turn && turn.source && typeof turn.text === "string" && turn.text.isWellFormed());
  const turns = originalText ? await finalizedInventory(captured.inventory, sources, capturedAccess, capturedGraph, "recall") : null;
  if (authority !== structuredAuthority(access, graph, suppressions)) return empty("stale-authority");
  if (structuredSuppressed(captured, sources, capturedAccess, capturedGraph, capturedSuppressions)) return empty("suppressed");
  if (!turns) {
    // Raw-only fallback never treats loss of a negative dependency as semantic withdrawal.
    const candidates = captured.inventory.turns.filter(turn => turn && turn.status === "final"
      && turn.conversationId === captured.inventory.conversationId && typeof turn.text === "string" && turn.text.isWellFormed()
      && turn.source && structuredSourcesCurrent([turn], sources, capturedAccess, capturedGraph, "recall"));
    const raw = await finalizedInventory({ ...captured.inventory, turns: candidates }, sources, capturedAccess, capturedGraph, "recall");
    if (authority !== structuredAuthority(access, graph, suppressions)) return empty("stale-authority");
    if (structuredSuppressed(captured, sources, capturedAccess, capturedGraph, capturedSuppressions)) return empty("suppressed");
    return empty("ineligible-inventory", raw && structuredSourcesCurrent(raw, sources, capturedAccess, capturedGraph, "recall") ? raw : []);
  }
  const block = (reason: StructuredMemoryConversationCoverage["reason"]) =>
    structuredSuppressed(captured, sources, capturedAccess, capturedGraph, capturedSuppressions) ? empty("suppressed") : empty(reason,
    structuredSourcesCurrent(turns, sources, capturedAccess, capturedGraph, "recall") ? turns : []);
  const ledger = structuredLedger(captured.annotations, turns);
  if (!ledger) return block("unresolved-annotations");
  if (!Array.isArray(captured.segments) || captured.segments.length > 256) return block("invalid-segment");
  const positions = new Map(turns.map((turn, index) => [structuredTurnKey(turn), index]));
  const heads = new Map(ledger.items.map(item => [item.itemId, item.current]));
  const validated: { segment: StructuredMemoryConversationSegment; start: number; current: boolean }[] = [];
  for (const segment of captured.segments) {
    if (!segment || segment.method !== "structured-declarations-v1" || segment.semanticAuthority !== "caller-declared-unverified"
      || segment.semanticCompleteness !== false || segment.conversationId !== captured.inventory.conversationId || !segment.record
      || segment.record.scopeId !== captured.inventory.scopeId || segment.record.claimKey !== `conversation-structured:${captured.inventory.conversationId}`
      || segment.record.kind !== "conversation-summary" || segment.record.authority !== "historical" || segment.record.confidence !== 0
      || !Array.isArray(segment.covered) || segment.covered.length < 1 || segment.covered.length > 16
      || !Array.isArray(segment.annotations) || !Array.isArray(segment.record.sources)
      || segment.record.sources.length !== segment.covered.length
      || segment.covered.some((turn: StructuredMemoryConversationSegment["covered"][number]) => !turn || !turn.source) || segment.record.sources.some((ref: MemorySourceRef) => !ref)
      || !memoryRecordEligible(segment.record, sources, capturedAccess, capturedGraph, capturedSuppressions, "recall")) return block("invalid-segment");
    const start = positions.get(structuredTurnKey(segment.covered[0]));
    if (start === undefined || !segment.covered.every((covered: StructuredMemoryConversationSegment["covered"][number], offset: number) => {
      const turn = turns[start + offset];
      return turn && covered.turnId === turn.turnId && covered.role === turn.role && covered.source
        && memorySourceMatches(covered.source, turn.source) && memorySourceMatches(covered.source, segment.record.sources[offset]);
    })) return block("invalid-segment");
    const coveredTurns = turns.slice(start, start + segment.covered.length), keys = new Set(coveredTurns.map(structuredTurnKey));
    const expected = ledger.annotations.filter(annotation => keys.has(structuredTurnKey(annotation)));
    const local = structuredLedger(expected, coveredTurns);
    if (!local || segment.annotations.length !== expected.length
      || !segment.annotations.every((annotation: StructuredMemoryConversationAnnotation, index: number) => structuredAnnotationEqual(annotation, expected[index]))
      || !structuredItemsEqual(segment.items, local.items) || segment.record.body !== structuredBody(local.items)) return block("invalid-segment");
    validated.push({ segment: { ...segment, annotations: local.annotations, items: local.items }, start,
      current: local.items.every(item => structuredReferenceEqual(item.current, heads.get(item.itemId)!)) });
  }
  // An authentic older head may remain in the rolling pool only when an eligible
  // full-chain successor is also present. Validate every segment before this choice:
  // an invalid/expired/suppressed correction is never filtered back to its predecessor.
  if (validated.some(value => !value.current && value.segment.items.some(item =>
    !structuredReferenceEqual(item.current, heads.get(item.itemId)!) && !validated.some(candidate => candidate.current
      && candidate.segment.items.some(current => current.itemId === item.itemId
        && structuredReferenceEqual(current.current, heads.get(item.itemId)!)))))) return block("invalid-segment");
  validated.sort((left, right) => right.segment.covered.length - left.segment.covered.length
    || right.segment.record.version - left.segment.record.version
    || (left.segment.record.id < right.segment.record.id ? -1 : left.segment.record.id > right.segment.record.id ? 1 : 0));
  const selected: StructuredMemoryConversationSegment[] = [];
  let covered = 0, bytes = 0;
  while (covered < turns.length && selected.length < 4) {
    const next = validated.find(value => value.current && value.start === covered && !selected.includes(value.segment)
      && bytes + new TextEncoder().encode(value.segment.record.body).byteLength <= byteLimit);
    if (!next) break;
    selected.push(next.segment); covered += next.segment.covered.length; bytes += new TextEncoder().encode(next.segment.record.body).byteLength;
  }
  const recentStart = Math.max(covered, turns.length - recentLimit), recent = turns.slice(recentStart);
  const annotated = new Set(ledger.annotations.map(structuredTurnKey));
  if (authority !== structuredAuthority(access, graph, suppressions)) return empty("stale-authority");
  if (structuredSuppressed(captured, sources, capturedAccess, capturedGraph, capturedSuppressions)) return empty("suppressed");
  if (!structuredSourcesCurrent(turns, sources, capturedAccess, capturedGraph, "recall")
    || selected.some(segment => !memoryRecordEligible(segment.record, sources, capturedAccess, capturedGraph, capturedSuppressions, "recall"))) return block("invalid-segment");
  const omitted = turns.slice(covered, recentStart).map(structuredTurnKey);
  return { status: "ready", semanticAuthority: "caller-declared-unverified", semanticCompleteness: false,
    completeFromStart: captured.inventory.completeFromStart, continuous: captured.inventory.completeFromStart && omitted.length === 0,
    segments: selected, items: selected.flatMap(segment => [...segment.items]), recentTurns: recent,
    examinedTurnIds: turns.map(structuredTurnKey), annotatedTurnIds: turns.filter(turn => annotated.has(structuredTurnKey(turn))).map(structuredTurnKey),
    unannotatedTurnIds: turns.filter(turn => !annotated.has(structuredTurnKey(turn))).map(structuredTurnKey),
    recentTurnIds: recent.map(structuredTurnKey), omittedTurnIds: omitted,
    validUntil: structuredDeadline(turns, selected.map(segment => segment.record), sources, capturedAccess) };
}
