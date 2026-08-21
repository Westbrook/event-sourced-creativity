import { foldEvents, type CreativeEvent } from "./events.ts";
import { DOCUMENT_VIEW_LABELS, documentViewWorkflow } from "./document-view-signals.ts";
import { libraryFocusRoute, withDocumentInRoute, type DocumentView } from "./routes.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";

export const PHASE6_MIN_CLOSED_SESSIONS = 3;
export const PHASE6_MIN_IMPRESSIONS = 10;
const REJECTED_PATH_STALENESS_EVENTS = 30;

export type BriefDestination = {
  route: string;
  view: "comparison" | "context-block" | "collection" | "document";
  ref_id: string;
  object_ids?: string[];
  document_id?: string;
  document_view?: DocumentView;
};

export type BriefItem = {
  item_id: string;
  item_type: "comparison" | "thread" | "collection" | "intent";
  ref_id: string;
  rank: number;
  title: string;
  summary: string;
  rationale_ref: string;
  source_event_refs: string[];
  authority: "inferred" | "explicit";
  destination: BriefDestination;
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
const witnessedCreatorIntents = (events: CreativeEvent[]) => unfinishedIntentTrajectories(events).filter((trajectory) => trajectory.authority === "explicit" || trajectory.authority === "authored" && trajectory.expectedOutputKind !== "context" && trajectory.steps.some((step) => (step.actor === "user" || step.actor.startsWith("user:")) && /^(GenerationRequested|DocumentRenderRequested)$/.test(step.type)));

function openComparisons(events: CreativeEvent[]) {
  const settled = new Set(events.filter((event) => /^(ObjectSaved|ObjectDiscarded)$/.test(event.type)).map((event) => String(event.payload.object_id ?? "")));
  return events.filter((event) => event.type === "ComparisonOpened" && list(event.payload.object_ids).some((id) => !settled.has(id)));
}

export function briefEligibility(events: CreativeEvent[]): BriefEligibility {
  const closedSessions = events.filter((event) => event.type === "SessionClosed").length;
  const explicitIntentions = witnessedCreatorIntents(events).filter((trajectory) => (trajectory.interrupted || trajectory.status === "ready") && trajectory.sourceEventIds.length > 1);
  const unresolvedThreads = openComparisons(events).length + explicitIntentions.length;
  const dormantProjects = events.filter((event) => event.type === "ProjectStateChanged" && event.payload.state === "dormant").length;
  const hasDormantOrUnresolved = unresolvedThreads > 0 || dormantProjects > 0;
  const requiredClosedSessions = explicitIntentions.length ? 1 : PHASE6_MIN_CLOSED_SESSIONS;
  const reasons: string[] = [];
  if (closedSessions < requiredClosedSessions) reasons.push(`${requiredClosedSessions - closedSessions} more closed session${requiredClosedSessions - closedSessions === 1 ? "" : "s"}`);
  if (!hasDormantOrUnresolved) reasons.push("one dormant project or unresolved comparison");
  return { eligible: reasons.length === 0, closedSessions, requiredClosedSessions, unresolvedThreads, dormantProjects, hasDormantOrUnresolved, reasons };
}

export function sessionContinuityDelta(events: CreativeEvent[]) {
  const close = events.filter((event) => event.type === "SessionClosed").at(-1);
  const snapshot = record(close?.payload.snapshot_ref);
  const snapshotHead = Number(snapshot.head ?? close?.sequence ?? 0);
  const recent = events.filter((event) => event.sequence > snapshotHead);
  const excluded = /^(SessionOpened|SessionClosed|BriefComposed|BriefItemPresented|Budget(?:Reserved|Released|Exceeded)|AdapterVersioned|CapabilityDeclared|ContextCompiled|CanvasLock(?:Acquired|Released)|CanvasInteractionRecorded|ApplicationViewVisited|DocumentViewVisited|AttentionEpisodeObserved|ProviderProbe(?:Started|Completed|Failed)|ShareLink(?:Created|Revoked))$/;
  const changes = recent.filter((event) => !excluded.test(event.type) && (event.actor === "user" || /(?:Completed|Failed|Resurfaced)$/.test(event.type)));
  const workflow = documentViewWorkflow(events);
  const viewVisits = recent.filter((event) => event.type === "DocumentViewVisited").map((event) => String(event.payload.view)).filter(Boolean);
  const changedViews = [...new Set(viewVisits)];
  const recentTransitions = viewVisits.reduce((count, view, index) => count + (index > 0 && view !== viewVisits[index - 1] ? 1 : 0), 0);
  return {
    snapshotHead,
    eventCount: changes.length,
    eventTypes: [...new Set(changes.map((event) => event.type))].sort(),
    sourceEventRefs: changes.slice(-12).map((event) => event.eventId),
    documentViews: changedViews,
    viewTransitions: recentTransitions,
    lastDocumentView: workflow.lastView?.view ?? null,
    preferredDocumentView: workflow.preferredView?.view ?? null,
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
  const destinationFor = (documentId: string) => {
    const workflow = documentViewWorkflow(events, documentId);
    const documentView = workflow.preferredView?.view ?? workflow.lastView?.view ?? "document";
    const title = projection.documents.find((document) => document.id === documentId)?.title ?? projection.documentTitle;
    const base = documentView === "document" ? "/" : `/studio/${documentView}`;
    return { route: withDocumentInRoute(base, documentId, title), document_id: documentId, document_view: documentView };
  };
  const items: Array<BriefItem & { lastSequence: number }> = [];
  for (const trajectory of witnessedCreatorIntents(events)) {
    if (!trajectory.nextAction || !trajectory.documentId) continue;
    const location = destinationFor(trajectory.documentId);
    const source = trajectory.sourceEventIds.at(-1) ?? "";
    const readyArtifact = trajectory.status === "ready" ? trajectory.artifactIds.at(-1) : undefined;
    const destination: BriefDestination = readyArtifact ? { ...location, route: libraryFocusRoute("artifact", readyArtifact, trajectory.title), view: "document", ref_id: trajectory.documentId } : { ...location, view: "document", ref_id: trajectory.documentId };
    items.push({ item_id: `intent:${trajectory.id}`, item_type: "intent", ref_id: trajectory.id, rank: 0, title: trajectory.nextAction.label, summary: `${trajectory.nextAction.reason} ${readyArtifact ? "Open the finished result directly" : `Resume in ${DOCUMENT_VIEW_LABELS[location.document_view]}`}; review remains your choice.`, rationale_ref: `event:${source}`, source_event_refs: trajectory.sourceEventIds.slice(-4), authority: "explicit", destination, lastSequence: trajectory.lastSequence });
  }
  const comparisons = openComparisons(events);
  const comparison = comparisons.at(-1);
  if (comparison) {
    const objectIds = list(comparison.payload.object_ids);
    const documentId = String(comparison.payload.document_id ?? projection.libraryOutputs.find((output) => objectIds.includes(output.id))?.documentId ?? projection.documentId);
    const location = destinationFor(documentId);
    items.push({ item_id: `comparison:${comparison.eventId}`, item_type: "comparison", ref_id: objectIds[0] ?? comparison.eventId, rank: 0, title: "Resolve an open comparison", summary: `${objectIds.length || 2} alternatives remain on the decision frontier. Resume in ${DOCUMENT_VIEW_LABELS[location.document_view]}, the working mode with the strongest recent direct evidence.`, rationale_ref: `event:${comparison.eventId}`, source_event_refs: [comparison.eventId], authority: "inferred", destination: { ...location, view: "comparison", ref_id: objectIds[0] ?? comparison.eventId, object_ids: objectIds }, lastSequence: comparison.sequence });
  }
  const recentBlockEvents = [...events].reverse().filter((event) => /^(BlockCreated|BlockPropertyEdited|ChipEdited|ExtractionCompleted)$/.test(event.type));
  const seenBlocks = new Set<string>();
  for (const event of recentBlockEvents) {
    const blockId = String(event.payload.block_id ?? "");
    if (!blockId || seenBlocks.has(blockId)) continue;
    const block = projection.blocks.find((value) => value.id === blockId); if (!block) continue;
    seenBlocks.add(blockId);
    const location = destinationFor(block.documentId || projection.documentId);
    items.push({ item_id: `thread:${block.id}`, item_type: "thread", ref_id: block.handle, rank: 0, title: `Continue ${block.handle}`, summary: `This authored thread was recently active and remains available as portable context. Resume in ${DOCUMENT_VIEW_LABELS[location.document_view]}, where this document has had the strongest recent progress.`, rationale_ref: `event:${event.eventId}`, source_event_refs: block.sourceEvents.slice(-4), authority: "inferred", destination: { ...location, view: "context-block", ref_id: block.id }, lastSequence: event.sequence });
    if (seenBlocks.size >= 2) break;
  }
  const collection = projection.collections.find((value) => Object.values(projection.membership).some((membership) => membership.collectionId === value.id));
  if (collection) {
    const related = events.filter((event) => String(event.payload.collection_id ?? event.payload.to_collection_id ?? "") === collection.id);
    const latest = related.at(-1);
    items.push({ item_id: `collection:${collection.id}`, item_type: "collection", ref_id: collection.handle, rank: 0, title: `Return to ${collection.handle}`, summary: "This authored collection groups active context into one re-entry point.", rationale_ref: `event:${latest?.eventId ?? collection.id}`, source_event_refs: related.slice(-4).map((event) => event.eventId), authority: "inferred", destination: { route: "/library", view: "collection", ref_id: collection.id }, lastSequence: latest?.sequence ?? 0 });
  }
  const rejected = new Set(rejectedPathMemory(events).filter((entry) => entry.active).map((entry) => entry.refId));
  const genericEvidenceReady = events.filter((event) => event.type === "SessionClosed").length >= PHASE6_MIN_CLOSED_SESSIONS;
  return items.filter((item) => genericEvidenceReady || item.item_type === "intent").filter((item) => !rejected.has(item.item_id) && !rejected.has(item.ref_id)).sort((a, b) => Number(b.authority === "explicit") - Number(a.authority === "explicit") || b.lastSequence - a.lastSequence || a.item_id.localeCompare(b.item_id)).slice(0, 3).map((candidate, index) => ({ item_id: candidate.item_id, item_type: candidate.item_type, ref_id: candidate.ref_id, rank: index + 1, title: candidate.title, summary: candidate.summary, rationale_ref: candidate.rationale_ref, source_event_refs: candidate.source_event_refs, authority: candidate.authority, destination: candidate.destination }));
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
      input_receipt: { state_at_close_sequence: delta.snapshotHead, continuity_delta_events: delta.eventCount, warm_thread_candidates: items.filter((item) => item.item_type !== "comparison").length, rejected_paths_excluded: rejected.length, document_views_since_close: delta.documentViews, view_transitions: delta.viewTransitions, last_document_view: delta.lastDocumentView, preferred_document_view: delta.preferredDocumentView, source_event_refs: delta.sourceEventRefs },
      prompt_contract: { facts_first: true, authority_marked: true, citations_required: true, token_budget: { facts: 0, pins: 0, tail: 0 }, mode: "deterministic-composition" },
      composition: { mode: "deterministic", cost_usd: 0, input_tokens: 0, output_tokens: 0, dosage: items.length },
    },
  };
}

export function phase6GateMetrics(events: CreativeEvent[]) {
  const briefs = new Map(events.filter((event) => event.type === "BriefComposed").map((event) => [String(event.payload.brief_id), event]));
  const presented = events.filter((event) => event.type === "BriefItemPresented");
  const viewForItem = (event: CreativeEvent) => {
    const direct = String(event.payload.document_view ?? record(event.payload.destination).document_view ?? "");
    if (direct) return direct as DocumentView;
    const items = Array.isArray(briefs.get(String(event.payload.brief_id))?.payload.items) ? briefs.get(String(event.payload.brief_id))!.payload.items as unknown[] : [];
    const item = items.map(record).find((value) => String(value.item_id) === String(event.payload.item_id));
    return String(record(item?.destination).document_view ?? "") as DocumentView | "";
  };
  const viewByPresentation = new Map(presented.map((event) => [`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`, viewForItem(event)]));
  const presentedKeys = new Set(presented.map((event) => `${String(event.payload.brief_id)}:${String(event.payload.item_id)}`));
  const accepted = events.filter((event) => event.type === "BriefItemAccepted" && presentedKeys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`));
  const ignored = events.filter((event) => event.type === "BriefItemIgnored" && presentedKeys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`));
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
  const representedViews = [...new Set(viewByPresentation.values())].filter((view): view is DocumentView => Boolean(view));
  const viewBreakdown = representedViews.map((view) => {
    const keys = new Set([...viewByPresentation].filter(([, candidate]) => candidate === view).map(([key]) => key));
    const viewImpressions = presented.filter((event) => keys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`)).length;
    const viewAcceptances = accepted.filter((event) => keys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`)).length;
    const viewIgnored = ignored.filter((event) => keys.has(`${String(event.payload.brief_id)}:${String(event.payload.item_id)}`)).length;
    return { view, label: DOCUMENT_VIEW_LABELS[view], impressions: viewImpressions, acceptances: viewAcceptances, ignored: viewIgnored, acceptanceRate: viewImpressions ? round(viewAcceptances / viewImpressions) : 0 };
  }).sort((left, right) => right.acceptances - left.acceptances || right.impressions - left.impressions || left.label.localeCompare(right.label));
  return {
    impressions,
    acceptances,
    acceptanceRate: impressions ? round(acceptances / impressions) : 0,
    blankChoices,
    totalCost: round(totalCost, 6),
    costPerAcceptance: acceptances ? round(totalCost / acceptances, 6) : null,
    dosageCurve,
    averageTimeToFirstAcceptMs: firstAcceptTimes.length ? Math.round(firstAcceptTimes.reduce((sum, value) => sum + value, 0) / firstAcceptTimes.length) : null,
    viewBreakdown,
    viewCoverage: impressions ? round([...viewByPresentation.values()].filter(Boolean).length / impressions) : 0,
    topAcceptedView: viewBreakdown.find((entry) => entry.acceptances)?.view ?? null,
    requiredImpressions: PHASE6_MIN_IMPRESSIONS,
    evidenceReady: impressions >= PHASE6_MIN_IMPRESSIONS && dosageCurve.some((entry) => entry.impressions > 0),
  };
}
