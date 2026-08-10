import { foldEvents, type CreativeEvent } from "./events.ts";

export const PHASE6_MIN_CLOSED_SESSIONS = 3;
export const PHASE6_MIN_IMPRESSIONS = 10;
const REJECTED_PATH_STALENESS_EVENTS = 30;

export type BriefItem = {
  item_id: string;
  item_type: "comparison" | "thread" | "collection";
  ref_id: string;
  rank: number;
  title: string;
  summary: string;
  rationale_ref: string;
  source_event_refs: string[];
  authority: "inferred";
};

export type BriefEligibility = {
  eligible: boolean;
  closedSessions: number;
  requiredClosedSessions: number;
  unresolvedThreads: number;
  dormantProjects: number;
  hasDormantOrUnresolved: boolean;
  reasons: string[];
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const round = (value: number, precision = 4) => Number(value.toFixed(precision));

function openComparisons(events: CreativeEvent[]) {
  const settled = new Set(events.filter((event) => /^(ObjectSaved|ObjectDiscarded)$/.test(event.type)).map((event) => String(event.payload.object_id ?? "")));
  return events.filter((event) => event.type === "ComparisonOpened" && list(event.payload.object_ids).some((id) => !settled.has(id)));
}

export function briefEligibility(events: CreativeEvent[]): BriefEligibility {
  const closedSessions = events.filter((event) => event.type === "SessionClosed").length;
  const unresolvedThreads = openComparisons(events).length;
  const dormantProjects = events.filter((event) => event.type === "ProjectStateChanged" && event.payload.state === "dormant").length;
  const hasDormantOrUnresolved = unresolvedThreads > 0 || dormantProjects > 0;
  const reasons: string[] = [];
  if (closedSessions < PHASE6_MIN_CLOSED_SESSIONS) reasons.push(`${PHASE6_MIN_CLOSED_SESSIONS - closedSessions} more closed session${PHASE6_MIN_CLOSED_SESSIONS - closedSessions === 1 ? "" : "s"}`);
  if (!hasDormantOrUnresolved) reasons.push("one dormant project or unresolved comparison");
  return { eligible: reasons.length === 0, closedSessions, requiredClosedSessions: PHASE6_MIN_CLOSED_SESSIONS, unresolvedThreads, dormantProjects, hasDormantOrUnresolved, reasons };
}

export function sessionContinuityDelta(events: CreativeEvent[]) {
  const close = events.filter((event) => event.type === "SessionClosed").at(-1);
  const snapshot = record(close?.payload.snapshot_ref);
  const snapshotHead = Number(snapshot.head ?? close?.sequence ?? 0);
  const excluded = /^(SessionOpened|SessionClosed|BriefComposed|BriefItemPresented)$/;
  const changes = events.filter((event) => event.sequence > snapshotHead && !excluded.test(event.type));
  return {
    snapshotHead,
    eventCount: changes.length,
    eventTypes: [...new Set(changes.map((event) => event.type))].sort(),
    sourceEventRefs: changes.slice(-12).map((event) => event.eventId),
  };
}

export function rejectedPathMemory(events: CreativeEvent[]) {
  const head = events.at(-1)?.sequence ?? 0;
  const rejected = new Map<string, { sequence: number; reason: string }>();
  const briefs = new Map(events.filter((event) => event.type === "BriefComposed").map((event) => [String(event.payload.brief_id), Array.isArray(event.payload.items) ? event.payload.items.map(record) : []]));
  for (const event of events) {
    if (event.type === "BriefItemIgnored") rejected.set(String(event.payload.item_id), { sequence: event.sequence, reason: "ignored" });
    if (event.type === "ObjectDiscarded") rejected.set(String(event.payload.object_id), { sequence: event.sequence, reason: "discarded" });
    if (event.type === "BranchAbandoned") rejected.set(String(event.payload.branch_id ?? event.payload.ref_id), { sequence: event.sequence, reason: "abandoned" });
    if (event.type === "BriefDismissed") for (const item of briefs.get(String(event.payload.brief_id)) ?? []) rejected.set(String(item.item_id ?? item.ref_id), { sequence: event.sequence, reason: "brief-dismissed" });
  }
  return [...rejected].map(([refId, value]) => ({ refId, ...value, stalenessEvents: head - value.sequence, active: head - value.sequence < REJECTED_PATH_STALENESS_EVENTS }));
}

function candidates(events: CreativeEvent[]): BriefItem[] {
  const projection = foldEvents(events);
  const items: Array<BriefItem & { lastSequence: number }> = [];
  const comparisons = openComparisons(events);
  const comparison = comparisons.at(-1);
  if (comparison) {
    const objectIds = list(comparison.payload.object_ids);
    items.push({ item_id: `comparison:${comparison.eventId}`, item_type: "comparison", ref_id: objectIds[0] ?? comparison.eventId, rank: 0, title: "Resolve an open comparison", summary: `${objectIds.length || 2} alternatives remain on the decision frontier.`, rationale_ref: `event:${comparison.eventId}`, source_event_refs: [comparison.eventId], authority: "inferred", lastSequence: comparison.sequence });
  }
  const recentBlockEvents = [...events].reverse().filter((event) => /^(BlockCreated|BlockPropertyEdited|ChipEdited|ExtractionCompleted)$/.test(event.type));
  const seenBlocks = new Set<string>();
  for (const event of recentBlockEvents) {
    const blockId = String(event.payload.block_id ?? "");
    if (!blockId || seenBlocks.has(blockId)) continue;
    const block = projection.blocks.find((value) => value.id === blockId); if (!block) continue;
    seenBlocks.add(blockId);
    items.push({ item_id: `thread:${block.id}`, item_type: "thread", ref_id: block.handle, rank: 0, title: `Continue ${block.handle}`, summary: `This authored thread was recently active and remains available as portable context.`, rationale_ref: `event:${event.eventId}`, source_event_refs: block.sourceEvents.slice(-4), authority: "inferred", lastSequence: event.sequence });
    if (seenBlocks.size >= 2) break;
  }
  const collection = projection.collections.find((value) => Object.values(projection.membership).some((membership) => membership.collectionId === value.id));
  if (collection) {
    const related = events.filter((event) => String(event.payload.collection_id ?? event.payload.to_collection_id ?? "") === collection.id);
    const latest = related.at(-1);
    items.push({ item_id: `collection:${collection.id}`, item_type: "collection", ref_id: collection.handle, rank: 0, title: `Return to ${collection.handle}`, summary: "This authored collection groups active context into one re-entry point.", rationale_ref: `event:${latest?.eventId ?? collection.id}`, source_event_refs: related.slice(-4).map((event) => event.eventId), authority: "inferred", lastSequence: latest?.sequence ?? 0 });
  }
  const rejected = new Set(rejectedPathMemory(events).filter((entry) => entry.active).map((entry) => entry.refId));
  return items.filter((item) => !rejected.has(item.item_id) && !rejected.has(item.ref_id)).sort((a, b) => b.lastSequence - a.lastSequence || a.item_id.localeCompare(b.item_id)).slice(0, 3).map((candidate, index) => ({ item_id: candidate.item_id, item_type: candidate.item_type, ref_id: candidate.ref_id, rank: index + 1, title: candidate.title, summary: candidate.summary, rationale_ref: candidate.rationale_ref, source_event_refs: candidate.source_event_refs, authority: candidate.authority }));
}

export function composeReentryBrief(events: CreativeEvent[], briefId: string) {
  const eligibility = briefEligibility(events);
  const items = candidates(events);
  if (!eligibility.eligible || !items.length) return { eligible: false as const, eligibility: { ...eligibility, reasons: items.length ? eligibility.reasons : [...eligibility.reasons, "one eligible, non-rejected thread"] }, payload: null };
  const delta = sessionContinuityDelta(events);
  const rejected = rejectedPathMemory(events).filter((entry) => entry.active);
  const sessionId = String(events.filter((event) => event.type === "SessionOpened").at(-1)?.payload.session_id ?? `reentry-${briefId}`);
  return {
    eligible: true as const,
    eligibility,
    payload: {
      brief_id: briefId,
      session_id: sessionId,
      as_of: { sequence: events.at(-1)?.sequence ?? 0 },
      items,
      input_receipt: { state_at_close_sequence: delta.snapshotHead, continuity_delta_events: delta.eventCount, warm_thread_candidates: items.filter((item) => item.item_type !== "comparison").length, rejected_paths_excluded: rejected.length, source_event_refs: delta.sourceEventRefs },
      prompt_contract: { facts_first: true, authority_marked: true, citations_required: true, token_budget: { facts: 0, pins: 0, tail: 0 }, mode: "deterministic-composition" },
      composition: { mode: "deterministic", cost_usd: 0, input_tokens: 0, output_tokens: 0, dosage: items.length },
    },
  };
}

export function phase6GateMetrics(events: CreativeEvent[]) {
  const briefs = new Map(events.filter((event) => event.type === "BriefComposed").map((event) => [String(event.payload.brief_id), event]));
  const presented = events.filter((event) => event.type === "BriefItemPresented");
  const presentedKeys = new Set(presented.map((event) => `${String(event.payload.brief_id)}:${String(event.payload.item_id)}`));
  const accepted = events.filter((event) => event.type === "BriefItemAccepted" && presentedKeys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`));
  const dismissed = events.filter((event) => event.type === "BriefDismissed");
  const blankChoices = events.filter((event) => event.type === "EmptyCanvasChosen").length;
  const totalCost = [...briefs.values()].reduce((sum, event) => sum + Number(record(event.payload.composition).cost_usd ?? 0), 0);
  const sizes = [...new Set([...briefs.values()].map((event) => Array.isArray(event.payload.items) ? event.payload.items.length : 0))].sort((a, b) => a - b);
  const dosageCurve = sizes.map((size) => {
    const ids = new Set([...briefs].filter(([, event]) => (Array.isArray(event.payload.items) ? event.payload.items.length : 0) === size).map(([id]) => id));
    const impressions = presented.filter((event) => ids.has(String(event.payload.brief_id))).length;
    const acceptances = accepted.filter((event) => ids.has(String(event.payload.brief_id))).length;
    return { size, briefs: ids.size, impressions, acceptances, acceptanceRate: impressions ? round(acceptances / impressions) : 0, dismissals: dismissed.filter((event) => ids.has(String(event.payload.brief_id))).length };
  });
  const firstAcceptTimes = [...briefs.keys()].flatMap((briefId) => {
    const firstPresented = presented.find((event) => String(event.payload.brief_id) === briefId);
    const firstAccepted = accepted.find((event) => String(event.payload.brief_id) === briefId);
    if (!firstPresented || !firstAccepted) return [];
    return [Math.max(0, Date.parse(firstAccepted.recordedAt) - Date.parse(firstPresented.recordedAt))];
  });
  const impressions = presented.length;
  const acceptances = accepted.length;
  return {
    impressions,
    acceptances,
    acceptanceRate: impressions ? round(acceptances / impressions) : 0,
    blankChoices,
    totalCost: round(totalCost, 6),
    costPerAcceptance: acceptances ? round(totalCost / acceptances, 6) : null,
    dosageCurve,
    averageTimeToFirstAcceptMs: firstAcceptTimes.length ? Math.round(firstAcceptTimes.reduce((sum, value) => sum + value, 0) / firstAcceptTimes.length) : null,
    requiredImpressions: PHASE6_MIN_IMPRESSIONS,
    evidenceReady: impressions >= PHASE6_MIN_IMPRESSIONS && dosageCurve.some((entry) => entry.impressions > 0),
  };
}
