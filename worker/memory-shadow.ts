import {
  memoryAccessValid, memoryDigest, memoryKey, memoryLocality, memoryRecordEligible, memoryScopeGrant,
  memorySourceEligible, memorySourceMatches, memorySourceRef, memoryTime, sameMemoryFence,
  type MemoryAccess, type MemoryFence, type MemoryRecord, type MemoryScopeGraph, type MemorySource,
  type MemorySourceRef, type MemorySuppression,
} from "../src/model/scoped-memory.ts";
import type { MemoryObservation } from "../src/model/memory-observations.ts";

export type MemoryShadowMode = "off" | "shadow";
export const MEMORY_SHADOW_DEFAULT_MODE: MemoryShadowMode = "off";
export const MEMORY_SHADOW_CONTEXT_MAX_BYTES = 16_384;
type ShadowEvidence = {
  citation: string; locality: "local" | "project" | "broad"; authority: MemoryRecord["authority"];
  kind: MemoryRecord["kind"]; text: string; recordedAt: string;
};
export type MemoryShadowContext<T> = {
  current: T; memory: { treatment: "untrusted-historical-evidence"; items: ShadowEvidence[] };
};
export type MemoryShadowAssembly<T> = {
  /** Always the original context; this first slice cannot activate serving. */
  context: T; status: "disabled" | "shadow" | "blocked"; reason?: string;
  preview?: MemoryShadowContext<T>; bytes?: number;
  references?: Array<{ citation: string; recordId: string; sourceIds: string[] }>;
  retrieval?: "lexical-baseline";
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const terms = (text: string) => new Set((text.toLocaleLowerCase("en").match(/[\p{L}\p{N}_-]+/gu) ?? []).slice(0, 512));

/**
 * Disconnected adapter for evaluating the future server assembly seam. No IO,
 * provider calls, environment-variable activation or existing-context mutation.
 */
export function assembleMemoryShadow<T>(input: {
  mode?: MemoryShadowMode; context: T; query: string; records: readonly MemoryRecord[];
  sources: ReadonlyMap<string, MemorySource>; access: MemoryAccess; graph: MemoryScopeGraph;
  suppressions?: readonly MemorySuppression[]; maxBytes?: number; maxMemoryBytes?: number; maxItems?: number;
}): MemoryShadowAssembly<T> {
  if ((input.mode ?? MEMORY_SHADOW_DEFAULT_MODE) !== "shadow") return { context: input.context, status: "disabled" };
  const blocked = (reason: string): MemoryShadowAssembly<T> => ({ context: input.context, status: "blocked", reason });
  if (input.access.environment !== "synthetic") return blocked("production-activation-not-implemented");
  if (!memoryAccessValid(input.access, input.graph) || !memoryScopeGrant(input.access, input.graph, input.access.targetScopeId, "recall")) return blocked("ineligible-access");
  const maxBytes = input.maxBytes ?? MEMORY_SHADOW_CONTEXT_MAX_BYTES, maxMemoryBytes = input.maxMemoryBytes ?? 4_096, maxItems = input.maxItems ?? 4;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MEMORY_SHADOW_CONTEXT_MAX_BYTES
    || !Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 0 || maxMemoryBytes > maxBytes
    || !Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > 16) return blocked("invalid-budget");
  if (bytes(input.context) > maxBytes) return blocked("current-context-over-budget");
  const preview: MemoryShadowContext<T> = { current: input.context, memory: { treatment: "untrusted-historical-evidence", items: [] } };
  const emptyBytes = bytes(preview);
  if (emptyBytes > maxBytes) return blocked("optional-envelope-over-budget");
  const query = terms(input.query.slice(0, 2_048));
  const priorities = { local: 0, project: 1, broad: 2 };
  // Filter authoritative rows FIRST. Ineligible bodies cannot influence ranking/counts.
  const ranked = input.records.filter((record) => memoryRecordEligible(record, input.sources, input.access, input.graph, input.suppressions))
    .map((record) => {
      const tokens = terms(record.body), matches = [...query].filter((term) => tokens.has(term)).length;
      const freshness = record.lastIndependentEvidenceAt ? Math.pow(.5, Math.max(0, memoryTime(input.access.now) - memoryTime(record.lastIndependentEvidenceAt)) / (30 * 86_400_000)) : 0;
      return { record, locality: memoryLocality(input.graph, input.access.custodianId, input.access.targetScopeId, record.scopeId),
        score: (query.size ? matches / query.size : 0) + freshness * .1 };
    }).filter(({ record }) => query.size === 0 || [...query].some((term) => terms(record.body).has(term)))
    .sort((left, right) => priorities[left.locality] - priorities[right.locality] || right.score - left.score
      || right.record.version - left.record.version || left.record.id.localeCompare(right.record.id));
  const references: NonNullable<MemoryShadowAssembly<T>["references"]> = [];
  const usedSources = new Set<string>(), usedRecords = new Set<string>();
  const memoryBudget = Math.min(maxMemoryBytes, maxBytes - emptyBytes);
  let broadBytes = 0;
  for (const { record, locality } of ranked) {
    if (preview.memory.items.length >= maxItems) break;
    if (usedRecords.has(record.id) || record.sources.some((source) => usedSources.has(memoryKey(source.custodianId, source.lineageId)))) continue;
    const citation = `m${preview.memory.items.length + 1}`;
    const item: ShadowEvidence = { citation, locality, authority: record.authority, kind: record.kind, text: record.body, recordedAt: record.createdAt };
    const itemBytes = bytes(item);
    if (locality === "broad" && broadBytes + itemBytes > Math.floor(memoryBudget * .1)) continue;
    const candidate = { ...preview, memory: { ...preview.memory, items: [...preview.memory.items, item] } };
    if (bytes(candidate) > maxBytes || bytes(candidate) - emptyBytes > memoryBudget) continue;
    preview.memory.items.push(item);
    references.push({ citation, recordId: record.id, sourceIds: record.sources.map((source) => source.id) });
    usedRecords.add(record.id); record.sources.forEach((source) => usedSources.add(memoryKey(source.custodianId, source.lineageId)));
    if (locality === "broad") broadBytes += itemBytes;
  }
  return { context: input.context, status: "shadow", preview, references, bytes: bytes(preview), retrieval: "lexical-baseline" };
}

export type MemoryCursor = Readonly<Record<string, number>>;
export type MemoryReviewPlan = {
  id: string; environment: "synthetic"; actorUserId: string; custodianId: string; scopeId: string;
  recipeVersion: string; fence: MemoryFence; from: MemoryCursor; through: MemoryCursor;
  sources: readonly MemorySourceRef[];
};
export type MemoryReviewInventory = {
  /** Attested by the future source adapter, not a client-controlled claim. */
  complete: boolean; from: MemoryCursor; through: MemoryCursor;
  /** All qualifying normalized observations in this complete source interval. */
  observationSources: readonly MemorySourceRef[];
};
export type MemoryReviewDecision = {
  status: "disabled" | "blocked" | "outside-window" | "no-activity" | "planned" | "resume";
  reason?: string; plan?: MemoryReviewPlan; timeZone?: string; usedTimeZoneFallback?: boolean;
};
const cursorValid = (cursor: MemoryCursor) => Object.entries(cursor).every(([stream, value]) => stream.length > 0 && stream.length <= 512 && Number.isSafeInteger(value) && value >= 0);
const cursorEntries = (cursor: MemoryCursor) => Object.entries(cursor).sort(([left], [right]) => left.localeCompare(right));
const cursorEqual = (left: MemoryCursor, right: MemoryCursor) => JSON.stringify(cursorEntries(left)) === JSON.stringify(cursorEntries(right));
const cursorAdvances = (from: MemoryCursor, through: MemoryCursor) => cursorValid(from) && cursorValid(through)
  && Object.entries(from).every(([stream, sequence]) => (through[stream] ?? -1) >= sequence);
const reviewIdentity = (plan: Omit<MemoryReviewPlan, "id">) => JSON.stringify({
  environment: plan.environment, actorUserId: plan.actorUserId, custodianId: plan.custodianId, scopeId: plan.scopeId,
  recipeVersion: plan.recipeVersion, fence: [plan.fence.permission, plan.fence.erasure, plan.fence.ancestry, plan.fence.policy],
  from: cursorEntries(plan.from), through: cursorEntries(plan.through),
  sources: [...plan.sources].sort((left, right) => memoryKey(left.custodianId, left.id).localeCompare(memoryKey(right.custodianId, right.id)))
    .map((source) => [source.custodianId, source.id, source.scopeId, source.scopeVersion, source.streamId, source.sequence,
      source.revision, source.contentHash, source.lineageId, source.origin, source.synthetic, source.independentEvidence,
      source.actorUserId, source.visibility, source.happenedAt, source.speaker]),
});

function reviewSourcesCurrent(plan: MemoryReviewPlan, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess, graph: MemoryScopeGraph): boolean {
  return plan.environment === "synthetic" && access.environment === "synthetic" && plan.actorUserId === access.actorUserId
    && plan.custodianId === access.custodianId && plan.scopeId === access.targetScopeId && sameMemoryFence(plan.fence, access.fence)
    && cursorAdvances(plan.from, plan.through) && plan.sources.length > 0 && plan.sources.length <= 2_048
    && Boolean(memoryScopeGrant(access, graph, plan.scopeId, "learn"))
    && plan.sources.every((ref) => {
      const source = sources.get(memoryKey(ref.custodianId, ref.id));
      return Boolean(source && memorySourceMatches(ref, source) && memorySourceEligible(source, access, graph, "learn")
        && source.sequence <= (plan.through[source.streamId] ?? 0));
    });
}

/** Pure admission planner, NOT a deployed scheduler/queue/lease or a paid-operation grant. */
export async function planMemoryReview(input: {
  mode?: MemoryShadowMode; observations: readonly MemoryObservation[]; processed: MemoryCursor;
  inventory?: MemoryReviewInventory;
  sources: ReadonlyMap<string, MemorySource>; access: MemoryAccess; graph: MemoryScopeGraph;
  recipeVersion: string; timeZone: string; pending?: MemoryReviewPlan;
}): Promise<MemoryReviewDecision> {
  if ((input.mode ?? MEMORY_SHADOW_DEFAULT_MODE) !== "shadow") return { status: "disabled" };
  const { access, graph } = input;
  if (access.environment !== "synthetic" || !memoryAccessValid(access, graph) || !memoryScopeGrant(access, graph, access.targetScopeId, "learn")
    || !cursorValid(input.processed) || !input.recipeVersion || input.recipeVersion.length > 128 || input.observations.length > 2_048) return { status: "blocked", reason: "ineligible-review" };
  if (input.pending) {
    const pending = structuredClone(input.pending);
    const validId = pending.id === await memoryDigest(reviewIdentity(pending));
    if (!validId || pending.recipeVersion !== input.recipeVersion || !cursorEqual(pending.from, input.processed)
      || !reviewSourcesCurrent(pending, input.sources, access, graph)) return { status: "blocked", reason: "stale-pending-review" };
    return { status: "resume", plan: pending };
  }
  let timeZone = input.timeZone, usedTimeZoneFallback = false;
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(access.now)); }
  catch { timeZone = "UTC"; usedTimeZoneFallback = true; }
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(access.now)));
  if (hour < 1 || hour >= 5) return { status: "outside-window", timeZone, usedTimeZoneFallback };
  const observations = input.observations.filter((observation) => {
    const source = input.sources.get(memoryKey(observation.source.custodianId, observation.source.id));
    return source && observation.actorUserId === access.actorUserId && memorySourceMatches(observation.source, source)
      && memorySourceEligible(source, access, graph, "learn") && source.sequence > (input.processed[source.streamId] ?? 0)
      && source.sequence <= (input.inventory?.through[source.streamId] ?? 0);
  });
  const inventory = input.inventory;
  if (!inventory || inventory.complete !== true || !cursorEqual(inventory.from, input.processed) || !cursorAdvances(inventory.from, inventory.through)
    || inventory.observationSources.length > 2_048) return { status: "blocked", reason: "incomplete-source-interval" };
  const observedRefs = new Map(observations.map((observation) => [memoryKey(observation.source.custodianId, observation.source.id), observation.source]));
  if (observedRefs.size !== inventory.observationSources.length || inventory.observationSources.some((ref) => {
    const observed = observedRefs.get(memoryKey(ref.custodianId, ref.id));
    return !observed || !memorySourceMatches(ref, observed);
  })) return { status: "blocked", reason: "incomplete-source-interval" };
  if (!observations.some((observation) => observation.humanActivity && observation.origin !== "system")) return { status: "no-activity", timeZone, usedTimeZoneFallback };
  const refs = [...input.sources.values()].filter((source) => source.sequence <= (inventory.through[source.streamId] ?? 0)
    && memorySourceEligible(source, access, graph, "learn")).map(memorySourceRef);
  if (refs.length > 2_048) return { status: "blocked", reason: "source-snapshot-limit" };
  const plan: Omit<MemoryReviewPlan, "id"> = { environment: "synthetic", actorUserId: access.actorUserId, custodianId: access.custodianId,
    scopeId: access.targetScopeId, recipeVersion: input.recipeVersion, fence: { ...access.fence },
    from: Object.fromEntries(cursorEntries(input.processed)), through: Object.fromEntries(cursorEntries(inventory.through)), sources: refs };
  const identified = { ...plan, id: await memoryDigest(reviewIdentity(plan)) };
  if (!cursorEqual(input.processed, identified.from) || !reviewSourcesCurrent(identified, input.sources, access, graph)) return { status: "blocked", reason: "stale-review-snapshot" };
  return { status: "planned", plan: identified, timeZone, usedTimeZoneFallback };
}

/**
 * Models the future transactional compare-and-publish boundary. The storage
 * adapter must atomically persist records, outbox and this captured watermark.
 * This function itself persists nothing and never advances on failure/staleness.
 */
export async function publishMemoryReview(input: {
  plan: MemoryReviewPlan; processed: MemoryCursor; successful: boolean; records: readonly MemoryRecord[];
  sources: ReadonlyMap<string, MemorySource>; access: MemoryAccess; graph: MemoryScopeGraph; suppressions?: readonly MemorySuppression[];
}): Promise<{ published: boolean; processed: MemoryCursor }> {
  if (!input.successful) return { published: false, processed: input.processed };
  const plan = structuredClone(input.plan);
  const validId = plan.id === await memoryDigest(reviewIdentity(plan));
  // No await below this point: re-read all live guards immediately before the modeled commit.
  if (!validId || !cursorEqual(input.processed, plan.from) || !reviewSourcesCurrent(plan, input.sources, input.access, input.graph)
    || input.records.some((record) => !memoryRecordEligible(record, input.sources, input.access, input.graph, input.suppressions, "learn")
      || record.sources.some((source) => !plan.sources.some((captured) => memorySourceMatches(source, captured))))) return { published: false, processed: input.processed };
  return { published: true, processed: { ...plan.through } };
}
