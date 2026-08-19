import type { CreativeEvent, CreativeProjection } from "./events.ts";
import { DOCUMENT_VIEW_LABELS, documentViewForSurface } from "./document-view-signals.ts";
import { documentSlug, type DocumentView } from "./routes.ts";

export type ReplayApplication = "creative" | "canvas" | "operations";
export type ReplaySurfaceKind = "projects" | "project" | "document" | "library" | "sessions" | "scout" | "memory" | "canvas" | "operations";

export type ReplaySurface = {
  application: ReplayApplication;
  kind: ReplaySurfaceKind;
  label: string;
  route: string;
  view?: DocumentView;
  focused?: boolean;
  targetLabel: string;
};

const visibleSystemEvents = new Set([
  "AssistantReasoned",
  "MutationProposed",
  "GenerationRequested",
  "GenerationCompleted",
  "GenerationFailed",
  "IdeationPreviewCompleted",
  "ImageFocalPointCalculated",
  "ExtractionCompleted",
  "ExtractionFailed",
  "BriefComposed",
  "BriefItemPresented",
  "ScoutRunStarted",
  "ScoutObserved",
  "ScoutRunExhausted",
  "FamilyDeclared",
  "FamilyMembershipAsserted",
  "IndexBuildCompleted",
  "TasteModelVersioned",
  "ConditionFired",
  "ProposalIssued",
  "JobQueued",
  "JobStarted",
  "JobRecovered",
  "JobCompleted",
  "JobFailed",
  "ValidationFailed",
]);

const text = (value: unknown) => String(value ?? "").trim();
const titleForDocument = (projection: CreativeProjection, documentId: string) => projection.documents.find((document) => document.id === documentId)?.title ?? projection.documentTitle ?? "Untitled document";

export function replayEventIsUserVisible(event: CreativeEvent) {
  if (event.actor === "user" || event.actor.startsWith("user:")) return true;
  if (event.payload.user_visible === true) return true;
  return visibleSystemEvents.has(event.type);
}

export function replayUserVisibleEvents(events: CreativeEvent[]) {
  return events.filter(replayEventIsUserVisible);
}

export function replayVisibleLandmarks(events: CreativeEvent[], maximum = 160) {
  const visible = replayUserVisibleEvents(events);
  if (visible.length <= maximum) return visible;
  const selected: CreativeEvent[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (visible.length - 1) / (maximum - 1));
    const event = visible[sourceIndex];
    if (event && selected.at(-1)?.eventId !== event.eventId) selected.push(event);
  }
  return selected;
}

export function adjacentVisibleReplaySequence(events: CreativeEvent[], sequence: number, direction: -1 | 1) {
  const visible = replayUserVisibleEvents(events);
  if (direction > 0) return visible.find((event) => event.sequence > sequence)?.sequence ?? events.length;
  return [...visible].reverse().find((event) => event.sequence < sequence)?.sequence ?? 0;
}

function latestDocumentView(events: CreativeEvent[], sequence: number, documentId: string) {
  for (let index = Math.min(sequence - 1, events.length - 1); index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "DocumentViewVisited") continue;
    if (documentId && text(event.payload.document_id) && text(event.payload.document_id) !== documentId) continue;
    const view = text(event.payload.view) as DocumentView;
    if (view in DOCUMENT_VIEW_LABELS) return { view, focused: event.payload.focused === true };
  }
  return { view: "document" as DocumentView, focused: false };
}

function documentSurface(event: CreativeEvent, projection: CreativeProjection, events: CreativeEvent[]): ReplaySurface {
  const payload = event.payload;
  const documentId = text(payload.document_id) || projection.documentId || "replay-document";
  const prior = latestDocumentView(events, event.sequence, documentId);
  const explicitView = event.type === "DocumentViewVisited" && text(payload.view) in DOCUMENT_VIEW_LABELS ? text(payload.view) as DocumentView : null;
  const view = explicitView ?? documentViewForSurface(payload.source_surface ?? payload.created_from) ?? prior.view;
  const focused = event.type === "DocumentViewVisited" ? payload.focused === true : prior.focused;
  const title = titleForDocument(projection, documentId);
  const slug = documentSlug(title);
  const viewPath = view === "document" ? "" : `/view/${view}`;
  return {
    application: "creative",
    kind: "document",
    label: DOCUMENT_VIEW_LABELS[view],
    route: `/document/${encodeURIComponent(documentId)}${slug ? `/${slug}` : ""}${viewPath}${focused ? "/focus" : ""}`,
    view,
    focused,
    targetLabel: text(payload.handle ?? payload.label ?? payload.title ?? payload.object_id ?? payload.block_id) || title,
  };
}

function canvasSurface(event: CreativeEvent, events: CreativeEvent[]): ReplaySurface {
  const canvasId = text(event.payload.canvas_id) || "replay-canvas";
  const creation = [...events].reverse().find((candidate) => candidate.sequence <= event.sequence && candidate.type === "CanvasCreated" && text(candidate.payload.canvas_id) === canvasId);
  const name = text(creation?.payload.name) || "Working canvas";
  const sourceSurface = text(event.payload.source_surface);
  const view = /compare/.test(sourceSurface) ? "compare" : /folder/.test(sourceSurface) ? "folders" : /list/.test(sourceSurface) ? "list" : "spatial";
  return {
    application: "canvas",
    kind: "canvas",
    label: view === "spatial" ? "Spatial canvas" : view === "folders" ? "Folders" : `${view[0].toUpperCase()}${view.slice(1)} view`,
    route: `/canvas/${encodeURIComponent(canvasId)}/${documentSlug(name) || "working-canvas"}${view === "spatial" ? "" : `/view/${view}`}`,
    targetLabel: text(event.payload.title ?? event.payload.name ?? event.payload.item_id ?? event.payload.proposal_id) || name,
  };
}

export function replaySurfaceForEvent(event: CreativeEvent, projection: CreativeProjection, events: CreativeEvent[]): ReplaySurface {
  const payload = event.payload;
  const source = text(payload.source_surface ?? payload.created_from).toLowerCase();
  if (text(payload.report_space) === "scout") return { application: "creative", kind: "scout", label: "Scout", route: "/scout", targetLabel: text(payload.label ?? payload.summary ?? payload.observation_id) || "Scout observation" };
  const correlatedCanvasEvent = /^(GenerationRequested|GenerationCompleted|GenerationFailed|ContextCompiled)$/.test(event.type) ? [...events].reverse().find((candidate) => candidate.sequence <= event.sequence && candidate.correlationId === event.correlationId && (text(candidate.payload.canvas_id) || /^(Canvas|Stroke|ContextSetFormalized|Proposal|VoteCast)/.test(candidate.type))) : undefined;
  if (correlatedCanvasEvent) return canvasSurface({ ...event, payload: { ...payload, canvas_id: text(correlatedCanvasEvent.payload.canvas_id) } }, events);
  if (/^(Canvas|Stroke|ContextSetFormalized|Proposal|VoteCast)/.test(event.type) || text(payload.canvas_id)) return canvasSurface(event, events);
  if (/^(Brief|Session)/.test(event.type) || /session|re-entry|brief/.test(source)) return { application: "creative", kind: "sessions", label: "Re-entry", route: "/sessions", targetLabel: text(payload.title ?? payload.item_id ?? payload.brief_id) || "Re-entry brief" };
  if (/^(Scout|Observation)/.test(event.type) || /scout/.test(source)) return { application: "creative", kind: "scout", label: "Scout", route: "/scout", targetLabel: text(payload.label ?? payload.summary ?? payload.observation_id) || "Scout observation" };
  if (/^(Taste|Preference|Condition|Attention|ClaimSuperseded|FactRetracted)/.test(event.type) || /memory|taste/.test(source)) return { application: "creative", kind: "memory", label: "Taste & time", route: "/memory", targetLabel: text(payload.label ?? payload.claim_ref ?? payload.condition_id) || "Memory evidence" };
  if (/library/.test(source) || /^(AddedToLibrary|RemovedFromLibrary|Family|IndexBuild)/.test(event.type) || (!text(payload.document_id) && /Block(Relation)?(Created|Removed|Restored|Renamed|PropertyEdited)/.test(event.type))) return { application: "creative", kind: "library", label: "Library", route: "/library", targetLabel: text(payload.label ?? payload.handle ?? payload.object_id ?? payload.block_id) || "Reusable creative context" };
  if (event.type === "ProjectCreated") return { application: "creative", kind: "projects", label: "Projects", route: "/projects", targetLabel: text(payload.name ?? payload.project_id) || projection.projectName };
  if (/^(ProjectOpened|ProjectSelected|ProjectRenamed|ProjectStateChanged|Collection|DocumentCreated|DocumentRemoved|DocumentRestored)/.test(event.type) || /project/.test(source)) return { application: "creative", kind: "project", label: "Project contents", route: "/studio/project", targetLabel: text(payload.title ?? payload.name ?? payload.new_name ?? payload.document_id ?? payload.collection_id) || projection.projectName };
  if (/^(Model|Adapter|Capability|Budget|Attribution|PhaseGate|Validation|BranchAbandoned|Job|RetentionSweep)/.test(event.type) && !text(payload.document_id)) return { application: "operations", kind: "operations", label: "Event operations", route: "/operations/events", targetLabel: text(payload.label ?? payload.job_id ?? payload.model_id ?? event.type) };
  return documentSurface(event, projection, events);
}

export function replayRunnerEvent(events: CreativeEvent[], sequence: number, pinnedEventId = "") {
  if (pinnedEventId) {
    const pinned = events.find((event) => event.eventId === pinnedEventId && event.sequence <= sequence);
    if (pinned) return pinned;
  }
  for (let index = Math.min(sequence - 1, events.length - 1); index >= 0; index -= 1) if (replayEventIsUserVisible(events[index])) return events[index];
  return sequence > 0 ? events[Math.min(sequence - 1, events.length - 1)] : undefined;
}
