import type { CreativeEvent } from "./events.ts";
import { isPhantomAttentionEpisode } from "./attention.ts";
import { memoryTimestamp, parseMemoryLifetime, type MemoryRecallLifetime } from "./memory-lifetime.ts";
import {
  memoryKey, memoryScopeGrant, memorySourceEligible, memorySourceMatches, memorySourceRef, memoryTime,
  type MemoryAccess, type MemoryOrigin, type MemoryPurpose, type MemoryScopeGraph, type MemorySource, type MemorySourceRef,
} from "./scoped-memory.ts";

export type MemoryAction = "encounter" | "inspect" | "compare" | "edit" | "commit" | "reuse"
  | "remove" | "restore" | "critique" | "request" | "accept" | "reject" | "defer" | "navigate" | "attention";
export type MemoryTarget = {
  id: string; scopeId: string; revision: string; kind: "project" | "document" | "block" | "artifact" | "output" | "canvas";
};
export type MemoryEventReceipt = {
  event: CreativeEvent; source: MemorySource; targets: readonly MemoryTarget[];
  /** Server-resolved outcome identity coalesces a suggestion acceptance and its mutations. */
  outcomeId: string; episodeId: string; lineageResolved: boolean;
};
export type MemoryObservation = {
  eventId: string; eventType: string; custodianId: string; actorUserId: string; scopeId: string;
  streamId: string; sequence: number; happenedAt: string; source: MemorySourceRef;
  /** Carries conservative normalization into record construction without losing taint. */
  evidenceSource: MemorySource;
  targets: readonly MemoryTarget[]; action: MemoryAction; origin: MemoryOrigin;
  outcomeId: string; episodeId: string; humanActivity: boolean; independentEvidence: boolean;
  synthetic: boolean; coVisiblePageActiveMs: number; expiresAt: string;
};
export type MemoryAttentionGrant = {
  allowed: boolean; expiresAt: string; /** Independent cutoffs per actual source stream. */
  forgottenThrough: Readonly<Record<string, number>>;
};
export type MemoryObservationView = {
  observations: readonly MemoryObservation[]; sources: ReadonlyMap<string, MemorySource>;
  access: MemoryAccess; graph: MemoryScopeGraph; attention?: MemoryAttentionGrant;
};

/** Revalidate retained projections against CURRENT policy/source state, not old capture grants. */
export function eligibleMemoryObservations(view: MemoryObservationView, purpose: "recall" | "learn" = "recall"): MemoryObservation[] {
  return view.observations.filter((observation) => {
    const source = view.sources.get(memoryKey(observation.source.custodianId, observation.source.id));
    if (!source || observation.actorUserId !== view.access.actorUserId || !memorySourceMatches(observation.source, source)
      || !memorySourceEligible(source, view.access, view.graph, purpose) || !(memoryTime(observation.expiresAt) > memoryTime(view.access.now))
      || observation.targets.some((target) => !memoryScopeGrant(view.access, view.graph, target.scopeId, purpose))) return false;
    if (observation.action !== "attention") return true;
    const cutoff = view.attention?.forgottenThrough[observation.streamId] ?? 0;
    return view.attention?.allowed === true && memoryTime(view.attention.expiresAt) > memoryTime(view.access.now)
      && Number.isSafeInteger(cutoff) && cutoff >= 0 && observation.sequence > cutoff;
  });
}

const ACTIONS: Readonly<Record<string, MemoryAction>> = {
  DocumentOpened: "encounter", DocumentRenamed: "edit", DocumentViewVisited: "encounter", ApplicationViewVisited: "navigate",
  ObjectViewed: "inspect", DocumentArtifactViewed: "inspect", ComparisonOpened: "compare",
  BlockCreated: "edit", BlockRenamed: "edit", BlockPropertyEdited: "edit", ChipEdited: "edit", BlockWeightSet: "edit",
  BlockLocked: "edit", BlockUnlocked: "edit", BlockRelationAdded: "edit", BlockRelationRemoved: "edit",
  DocumentArtifactEdited: "edit", CanvasTextApplied: "edit",
  BlockRemoved: "remove", BlockRestored: "restore", ObjectUnpinned: "remove", RemovedFromLibrary: "remove",
  ObjectSaved: "commit", ObjectPinned: "commit", AddedToLibrary: "commit", ObjectExported: "commit",
  DocumentArtifactExported: "commit", ArtifactApproved: "commit", PromptFanOutputPromoted: "commit", IdeationPromoted: "commit",
  CanvasItemPlaced: "reuse", CanvasReferenceCreated: "reuse", ContextSetFormalized: "reuse",
  ObjectDiscarded: "reject", ObjectCritiqued: "critique", ArtifactChangesRequested: "critique",
  ArtifactReviewRequested: "request", GenerationRequested: "request", DocumentRenderRequested: "request",
  ChatMessageSent: "request",
  ProposalAccepted: "accept", ProposalRejected: "reject", ProposalDeclined: "defer",
  BriefItemAccepted: "accept", BriefItemIgnored: "defer", BriefDismissed: "defer",
  AttentionEpisodeObserved: "attention",
};
const ASSISTED = new Set(["ProposalAccepted", "ProposalRejected", "ProposalDeclined", "BriefItemAccepted", "BriefItemIgnored", "BriefDismissed"]);
/** Used by the disconnected source reader before it requests any private body. */
export const memoryEventAction = (type: string): MemoryAction | null => ACTIONS[type] ?? null;

type LiveConsumptionAction = Exclude<MemoryAction, "navigate" | "attention">;
export type LiveConsumptionReference = {
  eventId: string; type: string; blockId: string | null; recordedAt: string; validUntil: string;
};
type LiveConsumptionCounts = { actions: Partial<Record<LiveConsumptionAction, number>>; sourceIndexes: number[] };
export type LiveMemoryConsumption = {
  version: "live-reference-consumption-v1"; basis: "selected-source-events"; completeFromStart: false;
  sourceLimit: 64; sourceLimitReached: boolean;
  windows: Array<{ windowDays: 7 | 30; since: string; document: LiveConsumptionCounts;
    /** The anchor resolves blockId through the parent recall's sources; no new resource/revision authority. */
    blocks: Array<LiveConsumptionCounts & { sourceIndex: number }> }>;
};

/** Describe only the already-authorized live selection. This does not authorize sources or infer
 * independent outcomes, episodes, reading time or preferences. Block counts are document subsets;
 * overlapping windows/resources must not be summed. The parent recall owns scope and expiration. */
export function rollingLiveMemoryConsumption(sources: readonly LiveConsumptionReference[], lifetime: MemoryRecallLifetime,
  enrolledSince: string, retentionDays: number): LiveMemoryConsumption {
  const lease = parseMemoryLifetime(lifetime), enrolled = memoryTimestamp(enrolledSince);
  const checkedAt = lease ? memoryTimestamp(lease.checkedAt)! : NaN, validUntil = lease ? memoryTimestamp(lease.validUntil)! : NaN;
  const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
  if (!lease || enrolled === null || enrolled > checkedAt || !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365
    || sources.length > 64 || new Set(sources.map(source => source.eventId)).size !== sources.length) throw new Error("Invalid live consumption coverage");
  const recorded = sources.map(source => {
    const at = memoryTimestamp(source.recordedAt), until = memoryTimestamp(source.validUntil);
    if (!id(source.eventId) || typeof source.type !== "string" || source.type.length === 0 || source.type.length > 120
      || !(source.blockId === null || id(source.blockId)) || at === null || until === null || at < enrolled || at > checkedAt
      || at + retentionDays * 86_400_000 <= checkedAt || until > at + retentionDays * 86_400_000
      || until <= checkedAt || validUntil > until) throw new Error("Invalid live consumption source");
    return at;
  });
  const actions = sources.map(source => {
    const action = Object.hasOwn(ACTIONS, source.type) ? memoryEventAction(source.type) : null;
    return action === "navigate" || action === "attention" ? null : action;
  });
  const counts = (sourceIndexes: number[]): LiveConsumptionCounts => {
    const totals: LiveConsumptionCounts["actions"] = {};
    for (const index of sourceIndexes) { const action = actions[index]!; totals[action] = (totals[action] ?? 0) + 1; }
    return { actions: totals, sourceIndexes: [...sourceIndexes] };
  };
  return { version: "live-reference-consumption-v1", basis: "selected-source-events", completeFromStart: false,
    sourceLimit: 64, sourceLimitReached: sources.length === 64, windows: ([7, 30] as const).map(windowDays => {
      // Enrollment and retention can shorten a requested window; even fewer than 64 rows never prove complete history.
      const since = Math.max(enrolled, checkedAt - Math.min(windowDays, retentionDays) * 86_400_000);
      const indexes = sources.flatMap((_source, index) => recorded[index] >= since && actions[index] ? [index] : []);
      const blocks = new Map<string, number[]>();
      for (const index of indexes) { const block = sources[index].blockId; if (block !== null) blocks.set(block, [...(blocks.get(block) ?? []), index]); }
      return { windowDays, since: new Date(since).toISOString(), document: counts(indexes),
        blocks: [...blocks.values()].map(indices => ({ sourceIndex: indices[0], ...counts(indices) })) };
    }) };
}
const COPY_FIELDS = ["copied_from_block_id", "forked_from_block_id", "copied_from_relation_id", "forked_from_relation_id", "source_block_id", "source_output_id", "source_generation_id", "source_artifact_id", "source_document_id", "source_claim_ref"];
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const usableId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;

function observationOrigin(event: CreativeEvent, source: MemorySource): MemoryOrigin {
  if (source.origin !== "user") return source.origin;
  const payload = event.payload, properties = asRecord(payload.properties);
  if (payload.source_surface === "autocomplete") return "autocomplete";
  if (payload.memory_authored_version === 1 || ASSISTED.has(event.type) || payload.source_surface === "assistant" || payload.source_chat_turn_id || payload.proposal_id) return "assistant";
  if (COPY_FIELDS.some((key) => payload[key] || properties[key])) return "copy";
  return "user";
}

/**
 * Normalize already authorized FINAL event rows. No prose, raw URLs, arbitrary
 * payload maps, keystrokes or pointer paths are copied into observations.
 */
export function normalizeMemoryObservation(receipt: MemoryEventReceipt, access: MemoryAccess, graph: MemoryScopeGraph,
  attention?: MemoryAttentionGrant, purpose: MemoryPurpose = "learn"): MemoryObservation | null {
  const { event, source } = receipt;
  const action = ACTIONS[event.type];
  if (!action || !memorySourceEligible(source, access, graph, purpose)
    || event.eventId !== source.id || event.streamId !== source.streamId || event.sequence !== source.sequence
    || event.eventId.startsWith("optimistic:") || event.streamId.startsWith("optimistic:") || event.clientId.includes("optimistic")
    || source.actorUserId !== access.actorUserId || !(event.actor === "user" || event.actor === `user:${access.actorUserId}`)
    || !usableId(receipt.outcomeId) || !usableId(receipt.episodeId) || receipt.targets.length === 0 || receipt.targets.length > 8) return null;
  if (event.type === "ChatMessageSent" && (source.visibility !== "actor" || source.speaker !== "user")) return null;
  const synthetic = source.synthetic || asRecord(event.payload.origin).synthetic === true
    || event.payload.simulation === true || event.payload.mock_data_source === "openai-provider" || event.payload.report_space === "scout";
  if (synthetic && access.environment !== "synthetic") return null;
  if (receipt.targets.some((target) => !usableId(target.id) || !usableId(target.revision)
    || !["project", "document", "block", "artifact", "output", "canvas"].includes(target.kind)
    || !memoryScopeGrant(access, graph, target.scopeId, purpose))) return null;
  let activeMs = 0;
  if (action === "attention") {
    const cutoff = attention?.forgottenThrough[source.streamId] ?? 0;
    const started = memoryTime(event.payload.started_at), ended = memoryTime(event.payload.ended_at);
    activeMs = Number(event.payload.active_ms);
    const idleMs = Number(event.payload.idle_ms);
    if (attention?.allowed !== true || !(memoryTime(attention.expiresAt) > memoryTime(access.now))
      || !Number.isSafeInteger(cutoff) || cutoff < 0 || source.sequence <= cutoff
      || !(memoryTime(event.payload.expires_at) > memoryTime(access.now)) || isPhantomAttentionEpisode(event.payload)
      || !["attention-v1", "attention-v2"].includes(String(event.payload.capture_version))
      || !Number.isFinite(started) || !Number.isFinite(ended) || ended < started || ended > memoryTime(access.now)
      || ended - started > 3_600_000 || !Number.isFinite(activeMs) || !Number.isFinite(idleMs)
      || activeMs < 0 || idleMs < 0 || activeMs + idleMs > ended - started
      || ended + 14 * 86_400_000 <= memoryTime(access.now)) return null;
  }
  const origin = observationOrigin(event, source);
  const independentEvidence = source.independentEvidence && receipt.lineageResolved === true && origin === "user" && !event.compensatesEventId
    && ["edit", "commit", "reuse", "critique"].includes(action);
  const expiresAt = new Date(Math.min(memoryTime(source.expiresAt), memoryTime(source.happenedAt) + access.retentionDays * 86_400_000,
    memoryTime(access.enrollmentExpiresAt), ...receipt.targets.map((target) => memoryTime(memoryScopeGrant(access, graph, target.scopeId, purpose)!.expiresAt)),
    action === "attention" ? memoryTime(event.payload.expires_at) : Infinity,
    action === "attention" ? memoryTime(event.payload.ended_at) + 14 * 86_400_000 : Infinity,
    action === "attention" ? memoryTime(attention!.expiresAt) : Infinity,
  )).toISOString();
  const evidenceSource = { ...source, origin, independentEvidence, synthetic, expiresAt };
  return {
    eventId: event.eventId, eventType: event.type, custodianId: source.custodianId, actorUserId: source.actorUserId,
    scopeId: source.scopeId, streamId: source.streamId, sequence: source.sequence, happenedAt: source.happenedAt,
    source: memorySourceRef(evidenceSource), evidenceSource, targets: receipt.targets.map((target) => ({ ...target })), action, origin,
    outcomeId: receipt.outcomeId, episodeId: receipt.episodeId, humanActivity: action !== "attention" && origin !== "system",
    independentEvidence, synthetic, coVisiblePageActiveMs: activeMs, expiresAt,
  };
}

export type MemoryConsumption = {
  custodianId: string; actorUserId: string; target: MemoryTarget; windowDays: number;
  outcomes: number; episodes: number; lastSeenAt: string;
  /** Co-visibility, NOT per-resource reading time. Never sum this across resources. */
  coVisiblePageActiveMs: number;
  actions: Partial<Record<MemoryAction, number>>; sourceIds: string[];
};

/** Aggregate exact resource REVISION encounters, not inferred liking or comprehension. */
export function rollingMemoryConsumption(view: MemoryObservationView, windowDays = 30): MemoryConsumption[] {
  const now = view.access.now;
  if (!Number.isFinite(memoryTime(now)) || ![1, 7, 14, 30, 90].includes(windowDays)) throw new Error("Invalid consumption window");
  const cutoff = memoryTime(now) - windowDays * 86_400_000;
  const groups = new Map<string, { row: MemoryConsumption; episodes: Set<string>; outcomes: Set<string>; actions: Set<string> }>();
  const seen = new Set<string>();
  const ordered = eligibleMemoryObservations(view).sort((left, right) => memoryTime(left.happenedAt) - memoryTime(right.happenedAt) || left.eventId.localeCompare(right.eventId));
  for (const observation of ordered) {
    const happened = memoryTime(observation.happenedAt);
    const physicalKey = memoryKey(observation.custodianId, observation.eventId);
    if (!Number.isFinite(happened) || happened < cutoff || happened > memoryTime(now) || !(memoryTime(observation.expiresAt) > memoryTime(now)) || seen.has(physicalKey)) continue;
    seen.add(physicalKey);
    for (const target of observation.targets) {
      const key = JSON.stringify([observation.custodianId, observation.actorUserId, target.scopeId, target.kind, target.id, target.revision]);
      const group = groups.get(key) ?? {
        row: { custodianId: observation.custodianId, actorUserId: observation.actorUserId, target: { ...target }, windowDays,
          outcomes: 0, episodes: 0, lastSeenAt: observation.happenedAt, coVisiblePageActiveMs: 0, actions: {}, sourceIds: [] },
        episodes: new Set<string>(), outcomes: new Set<string>(), actions: new Set<string>(),
      };
      group.episodes.add(observation.episodeId);
      const actionKey = JSON.stringify([observation.outcomeId, observation.action]);
      if (!group.actions.has(actionKey)) {
        group.row.actions[observation.action] = (group.row.actions[observation.action] ?? 0) + 1;
        group.row.coVisiblePageActiveMs += observation.coVisiblePageActiveMs;
        group.actions.add(actionKey);
      }
      group.outcomes.add(observation.outcomeId);
      group.row.episodes = group.episodes.size; group.row.outcomes = group.outcomes.size;
      group.row.lastSeenAt = observation.happenedAt;
      group.row.sourceIds.push(observation.eventId);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => group.row);
}

export type MemoryWorkflowPattern = {
  actorUserId: string; custodianId: string; scopeId: string; action: MemoryAction;
  claimKey: string; independentOutcomes: number; episodeCount: number; sourceIds: string[];
};

/** Descriptive repetition only. This intentionally makes no aesthetic/intent claim. */
export function memoryWorkflowPatterns(view: MemoryObservationView): MemoryWorkflowPattern[] {
  const groups = new Map<string, MemoryObservation[]>();
  for (const observation of eligibleMemoryObservations(view, "learn")) {
    if (!observation.independentEvidence) continue;
    const key = JSON.stringify([observation.custodianId, observation.actorUserId, observation.scopeId, observation.action]);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  return [...groups.values()].flatMap((rows) => {
    const independent = new Map<string, MemoryObservation>();
    const outcomes = new Set<string>();
    for (const row of [...rows].sort((left, right) => left.eventId.localeCompare(right.eventId))) {
      if (independent.has(row.source.lineageId) || outcomes.has(row.outcomeId)) continue;
      independent.set(row.source.lineageId, row); outcomes.add(row.outcomeId);
    }
    const evidence = [...independent.values()], episodes = new Set(evidence.map((row) => row.episodeId));
    if (evidence.length < 3 || episodes.size < 2) return [];
    const first = evidence[0];
    return [{ actorUserId: first.actorUserId, custodianId: first.custodianId, scopeId: first.scopeId, action: first.action,
      claimKey: `workflow-frequency:${first.action}`, independentOutcomes: evidence.length, episodeCount: episodes.size,
      sourceIds: evidence.map((row) => row.eventId) }];
  }).sort((left, right) => JSON.stringify([left.custodianId, left.actorUserId, left.scopeId, left.action]).localeCompare(JSON.stringify([right.custodianId, right.actorUserId, right.scopeId, right.action])));
}
