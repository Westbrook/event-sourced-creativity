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
