import { memoryDigest } from "../src/model/scoped-memory.ts";
import type { StructuredMemoryConversationCategory, StructuredMemoryConversationOperation } from "../src/model/memory-conversation.ts";

export const MEMORY_DERIVATION_RESULT_VERSION = "memory-derivation-candidates-v1";
export type MemoryDerivationPurpose = "rolling-summary" | "profile" | "suggestion";
export type MemoryDerivationQuote = Readonly<{ sourceIndex: number; start: number; end: number; text: string }>;
export type MemoryDerivationCategory = StructuredMemoryConversationCategory | "preference-hypothesis" | "workflow-hypothesis";
export type MemoryDerivationSourceBinding = Readonly<{ sourceId: string; revision: number; contentHash: string }>;
export type MemoryDerivationSource = Readonly<{
  sourceId: string; revision: number; contentHash: string; lineageId: string; scopeKey: string; text: string; expiresAt: string;
  role: "user" | "assistant"; kind: "message" | "authored-block" | "observation";
  authorship: "original-human" | "original-assistant" | "derived" | "unknown";
}>;
export type MemoryDerivationPriorItem = Readonly<{
  itemId: string; revision: number; purpose: MemoryDerivationPurpose; scopeKey: string;
  lineageIds: readonly string[]; sourceBindings: readonly MemoryDerivationSourceBinding[]; validUntil: string; userProtected: boolean;
}>;
/** Server-owned, freshly rehydrated job inputs. This structural type is NOT a
 * native authority proof, purpose grant, or permission to send data to an LLM. */
export type MemoryDerivationParseContext = Readonly<{
  purpose: MemoryDerivationPurpose; scopeKey: string; manifestId: string; manifestRevision: number;
  checkedAt: string; validUntil: string; sources: readonly MemoryDerivationSource[];
  priorItems: readonly MemoryDerivationPriorItem[]; suppressedLineages: readonly string[];
}>;
type Candidate = {
  operation: StructuredMemoryConversationOperation; target: { itemId: string; revision: number } | null;
  category: MemoryDerivationCategory; text: string; supports: MemoryDerivationQuote[]; counterevidence: MemoryDerivationQuote[];
};
export type MemoryDerivationCandidate = Readonly<Candidate & {
  claimKey: string; lineageIds: readonly string[]; sourceBindings: readonly MemoryDerivationSourceBinding[]; validUntil: string;
  citationStatus: "support-cited" | "conflicting-citations";
}>;
export type ParsedMemoryDerivation = Readonly<{
  version: typeof MEMORY_DERIVATION_RESULT_VERSION; purpose: MemoryDerivationPurpose; scopeKey: string;
  manifestId: string; manifestRevision: number; validUntil: string;
  semanticAuthority: "model-derived-unverified"; semanticCompleteness: false; independentEvidence: false;
  /** Proposals only: omissions do not remove prior items; corrections cannot
   * supersede a human correction or lift a suppression. */
  items: readonly MemoryDerivationCandidate[];
}>;
type Row = Record<string, unknown>;
const purposes = ["rolling-summary", "profile", "suggestion"];
const categories = ["goal", "decision", "proposal", "rejected-alternative", "question", "blocker", "next-step"];
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Row => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.isWellFormed() && value.trim() === value && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
// Canonical native scope keys contain several resource IDs, so they cannot use
// the individual-ID limit. Equality here constrains data; it never grants scope.
const scopeKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192
  && value.isWellFormed() && value.trim() === value && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const sourceBinding = (source: MemoryDerivationSource): MemoryDerivationSourceBinding => ({ sourceId: source.sourceId, revision: source.revision, contentHash: source.contentHash });
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const time = (value: unknown): number => typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value ? Date.parse(value) : Number.NaN;
const requireValue = (condition: unknown): void => { if (!condition) throw new Error("memory-derivation-result-invalid"); };

/** Reject accessors/proxies that throw, sparse arrays, custom prototypes, cycles,
 * malformed strings and excess input without calling user-defined toJSON. */
function snapshot(input: unknown): unknown {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>(), encoder = new TextEncoder();
  const copy = (value: unknown, depth: number): unknown => {
    requireValue(++nodes <= 8192 && depth <= 12); bytes += 8; requireValue(bytes <= 524288);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { requireValue(Number.isFinite(value)); return value; }
    if (typeof value === "string") {
      requireValue(value.length <= 16384 && value.isWellFormed()); bytes += encoder.encode(value).byteLength;
      requireValue(bytes <= 524288); return value;
    }
    requireValue(object(value) || Array.isArray(value));
    const source = value as object; requireValue(!ancestors.has(source)); ancestors.add(source);
    try {
      const array = Array.isArray(source), keys = Reflect.ownKeys(source), result: Row | unknown[] = array ? [] : {};
      requireValue(Object.getPrototypeOf(source) === (array ? Array.prototype : Object.prototype));
      if (array) {
        const length = Object.getOwnPropertyDescriptor(source, "length");
        requireValue(length && Object.hasOwn(length, "value") && integer(length.value) && length.value <= 128 && keys.length === length.value + 1);
        for (let i = 0; i < length!.value; i++) {
          const entry = Object.getOwnPropertyDescriptor(source, String(i));
          requireValue(entry?.enumerable && Object.hasOwn(entry, "value"));
          (result as unknown[]).push(copy(entry!.value, depth + 1));
        }
      } else {
        requireValue(keys.length <= 16);
        for (const key of keys) {
          requireValue(typeof key === "string" && key.length <= 240);
          const entry = Object.getOwnPropertyDescriptor(source, key);
          requireValue(entry?.enumerable && Object.hasOwn(entry, "value"));
          Object.defineProperty(result, key, { value: copy(entry!.value, depth + 1), enumerable: true });
        }
      }
      return result;
    } finally { ancestors.delete(source); }
  };
  return copy(input, 0);
}

/** JSON grammar is validated by JSON.parse; this additionally rejects even
 * escaped duplicate keys, which JSON.parse would silently overwrite. */
function uniqueKeys(text: string): boolean {
  const stack: { keys: Set<string> | null; expectsKey: boolean }[] = [];
  for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}:,[\]]/gsu)) {
    if (token === "{" || token === "[") {
      stack.push({ keys: token === "{" ? new Set() : null, expectsKey: token === "{" });
      if (stack.length > 12) return false;
    } else if (token === "}" || token === "]") stack.pop();
    else {
      const current = stack.at(-1);
      if (token === "," && current?.keys) current.expectsKey = true;
      else if (token.startsWith('"') && current?.keys && current.expectsKey) {
        const key: string = JSON.parse(token);
        if (current.keys.has(key)) return false;
        current.keys.add(key); current.expectsKey = false;
      }
    }
  }
  return true;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Structural/citation validation only. An exact quotation establishes attribution,
 * NOT entailment or independent human preference. The native consumer must replay
 * source, grant, suppression, prior-revision and lifetime proofs in its publication
 * batch. Invalid model output can still be billable; this function never settles a
 * budget, publishes a record, changes user declarations, or refunds a provider call. */
export async function parseMemoryDerivationResult(rawJson: string, originalContext: MemoryDerivationParseContext): Promise<ParsedMemoryDerivation | null> {
  try {
    if (typeof rawJson !== "string" || rawJson.length > 65536 || new TextEncoder().encode(rawJson).byteLength > 65536) return null;
    const raw = snapshot(JSON.parse(rawJson)), context = snapshot(originalContext);
    if (!uniqueKeys(rawJson) || !exact(raw, ["version", "items"]) || raw.version !== MEMORY_DERIVATION_RESULT_VERSION
      || !Array.isArray(raw.items) || raw.items.length > 16
      || !exact(context, ["purpose", "scopeKey", "manifestId", "manifestRevision", "checkedAt", "validUntil", "sources", "priorItems", "suppressedLineages"])
      || !purposes.includes(String(context.purpose)) || !scopeKey(context.scopeKey) || !id(context.manifestId) || !integer(context.manifestRevision, 1)
      || !Array.isArray(context.sources) || !context.sources.length || context.sources.length > 128
      || !Array.isArray(context.priorItems) || context.priorItems.length > 64
      || !Array.isArray(context.suppressedLineages) || !context.suppressedLineages.every(id)
      || new Set(context.suppressedLineages).size !== context.suppressedLineages.length) return null;
    const at = time(context.checkedAt), until = time(context.validUntil), now = Date.now();
    if (!Number.isFinite(at) || !Number.isFinite(until) || at > now || until <= now || until <= at || until - at > 60000) return null;
    const sources = context.sources as unknown as MemoryDerivationSource[], lineages = new Map<string, number>();
    if (new Set(sources.map(source => source?.sourceId)).size !== sources.length) return null;
    for (const source of sources) {
      if (!exact(source, ["sourceId", "revision", "contentHash", "lineageId", "scopeKey", "text", "expiresAt", "role", "kind", "authorship"])
        || !id(source.sourceId) || !id(source.lineageId) || source.scopeKey !== context.scopeKey
        || !integer(source.revision, 1) || typeof source.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(source.contentHash)
        || typeof source.text !== "string" || !source.text.isWellFormed() || time(source.expiresAt) < until || !Number.isFinite(time(source.expiresAt))
        || !["user", "assistant"].includes(source.role) || !["message", "authored-block", "observation"].includes(source.kind)
        || !["original-human", "original-assistant", "derived", "unknown"].includes(source.authorship)
        || source.authorship === "original-human" && source.role !== "user"
        || source.authorship === "original-assistant" && source.role !== "assistant"
        || await memoryDigest(source.text) !== source.contentHash || Date.now() >= until) return null;
      lineages.set(source.lineageId, Math.min(lineages.get(source.lineageId) ?? Infinity, time(source.expiresAt)));
    }
    const previous = new Map<string, MemoryDerivationPriorItem>();
    for (const item of context.priorItems as unknown as MemoryDerivationPriorItem[]) {
      if (!exact(item, ["itemId", "revision", "purpose", "scopeKey", "lineageIds", "sourceBindings", "validUntil", "userProtected"])
        || !id(item.itemId) || previous.has(item.itemId) || !integer(item.revision, 1) || item.purpose !== context.purpose || item.scopeKey !== context.scopeKey
        || !Array.isArray(item.lineageIds) || !item.lineageIds.length || item.lineageIds.some(lineage => !id(lineage) || !lineages.has(lineage))
        || new Set(item.lineageIds).size !== item.lineageIds.length || !Number.isFinite(time(item.validUntil))
        || time(item.validUntil) < until || typeof item.userProtected !== "boolean") return null;
      if (!Array.isArray(item.sourceBindings) || !item.sourceBindings.length || item.sourceBindings.length > 128
        || new Set(item.sourceBindings.map(binding => binding?.sourceId)).size !== item.sourceBindings.length) return null;
      const inheritedLineages = new Set<string>();
      for (const binding of item.sourceBindings) {
        if (!exact(binding, ["sourceId", "revision", "contentHash"])) return null;
        const source = sources.find(source => source.sourceId === binding.sourceId);
        if (!source || source.revision !== binding.revision || source.contentHash !== binding.contentHash) return null;
        inheritedLineages.add(source.lineageId);
      }
      if (inheritedLineages.size !== item.lineageIds.length || item.lineageIds.some(lineage => !inheritedLineages.has(lineage))) return null;
      previous.set(item.itemId, item);
    }
    const suppressedLineages = new Set(context.suppressedLineages as string[]);
    const items: MemoryDerivationCandidate[] = [], targets = new Set<string>(), claimKeys = new Set<string>();
    for (const value of raw.items) {
      if (!exact(value, ["operation", "target", "category", "text", "supports", "counterevidence"])
        || !["assert", "correct", "supersede", "withdraw"].includes(String(value.operation))
        || !(context.purpose === "profile" ? ["preference-hypothesis", "workflow-hypothesis"] : context.purpose === "suggestion" ? ["proposal", "next-step"] : categories).includes(String(value.category))
        || typeof value.text !== "string" || !value.text.trim() || Array.from(value.text).length > 1000
        || !Array.isArray(value.supports) || !value.supports.length || value.supports.length > 8
        || !Array.isArray(value.counterevidence) || value.counterevidence.length > 8) return null;
      let prior: MemoryDerivationPriorItem | undefined;
      if (value.operation === "assert") { if (value.target !== null) return null; }
      else {
        if (!exact(value.target, ["itemId", "revision"]) || !id(value.target.itemId) || !integer(value.target.revision, 1)) return null;
        prior = previous.get(value.target.itemId);
        if (!prior || prior.revision !== value.target.revision || prior.userProtected || targets.has(prior.itemId)) return null;
        targets.add(prior.itemId);
      }
      const cited = new Set<string>(), dependencies = new Set(prior?.lineageIds ?? []),
        boundSources = new Map((prior?.sourceBindings ?? []).map(binding => [binding.sourceId, binding]));
      let humanSupport = false;
      for (const [quotes, support] of [[value.supports, true], [value.counterevidence, false]] as const) {
        for (const quote of quotes) {
          if (!exact(quote, ["sourceIndex", "start", "end", "text"]) || !integer(quote.sourceIndex) || quote.sourceIndex >= sources.length
            || !integer(quote.start) || !integer(quote.end, 1) || quote.end <= quote.start || quote.end - quote.start > 512 || typeof quote.text !== "string" || !quote.text.trim()) return null;
          const source = sources[quote.sourceIndex], points = Array.from(source.text), key = JSON.stringify([quote.sourceIndex, quote.start, quote.end]);
          if (quote.end > points.length || points.slice(quote.start, quote.end).join("") !== quote.text || cited.has(key)
            || source.authorship === "derived" || source.authorship === "unknown" || source.kind === "observation"
            || support && context.purpose === "profile" && source.authorship !== "original-human") return null;
          cited.add(key); dependencies.add(source.lineageId);
          boundSources.set(source.sourceId, sourceBinding(source));
          if (support && source.authorship === "original-human") humanSupport = true;
        }
      }
      if (value.category === "decision" && !humanSupport || [...dependencies].some(lineage => suppressedLineages.has(lineage))) return null;
      const lineageIds = [...dependencies].sort();
      const claimKey = prior?.itemId ?? "derived:" + await memoryDigest(JSON.stringify([context.scopeKey, context.purpose, value.category,
        value.supports.map(quote => { const q = quote as Row, source = sources[q.sourceIndex as number];
          return [source.sourceId, source.revision, source.contentHash, q.start, q.end];
        }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)]));
      // Re-assertion must not replace any existing item, especially a protected
      // human correction. Existing claims require their explicit revision target.
      if (claimKeys.has(claimKey) || !prior && previous.has(claimKey) || Date.now() >= until) return null;
      claimKeys.add(claimKey);
      items.push({ ...(value as unknown as Candidate), claimKey, lineageIds,
        sourceBindings: [...boundSources.values()].sort((a, b) => a.sourceId < b.sourceId ? -1 : 1), validUntil: context.validUntil as string,
        citationStatus: value.counterevidence.length ? "conflicting-citations" : "support-cited" });
    }
    if (Date.now() >= until) return null;
    return freeze({ version: MEMORY_DERIVATION_RESULT_VERSION, purpose: context.purpose as MemoryDerivationPurpose, scopeKey: context.scopeKey,
      manifestId: context.manifestId, manifestRevision: context.manifestRevision, validUntil: context.validUntil as string,
      semanticAuthority: "model-derived-unverified", semanticCompleteness: false, independentEvidence: false, items });
  } catch { return null; }
}
