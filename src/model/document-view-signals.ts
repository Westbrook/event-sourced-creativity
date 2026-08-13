import type { CreativeEvent } from "./events.ts";
import { attentionEvents } from "./attention.ts";
import type { DocumentView } from "./routes.ts";

export const DOCUMENT_VIEW_LABELS: Record<DocumentView, string> = {
  document: "Document",
  board: "Context board",
  guided: "Guided brief",
  layers: "Reality layers",
  adaptive: "Adaptive path",
  editor: "Creative editor",
  chat: "Chat",
};

export const DOCUMENT_VIEWS = Object.keys(DOCUMENT_VIEW_LABELS) as DocumentView[];

export type DocumentViewUsage = {
  view: DocumentView;
  label: string;
  visits: number;
  focusedVisits: number;
  edits: number;
  generationRequests: number;
  outcomes: number;
  activeMinutes: number;
  frictionEpisodes: number;
  score: number;
  confidence: number;
  lastSequence: number;
  evidenceRefs: string[];
};

export type DocumentViewWorkflow = {
  rows: DocumentViewUsage[];
  usedViews: number;
  totalVisits: number;
  totalOutcomes: number;
  totalActiveMinutes: number;
  transitions: number;
  preferredView: DocumentViewUsage | null;
  lastView: DocumentViewUsage | null;
};

const EDIT_EVENTS = /^(BlockCreated|BlockRenamed|BlockPropertyEdited|BlockWeightSet|BlockLocked|BlockUnlocked|BlockRemoved|BlockRestored|BlockRelationAdded|BlockRelationRemoved|ChipEdited|ChatMessageSent)$/;
const OUTCOME_EVENTS = /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|IdeationPromoted|PromptFanOutputPromoted|BriefItemAccepted)$/;
const GENERATION_EVENTS = /^(GenerationRequested)$/;
const round = (value: number, precision = 3) => Number(value.toFixed(precision));
const safeView = (value: unknown): DocumentView | null => DOCUMENT_VIEWS.includes(value as DocumentView) ? value as DocumentView : null;

export function documentViewForSurface(value: unknown): DocumentView | null {
  const surface = String(value ?? "").toLowerCase();
  if (!surface) return null;
  if (/chat/.test(surface)) return "chat";
  if (/creative-editor|editor/.test(surface)) return "editor";
  if (/adaptive/.test(surface)) return "adaptive";
  if (/reality-layer|layers/.test(surface)) return "layers";
  if (/guided/.test(surface)) return "guided";
  if (/context-board|board/.test(surface)) return "board";
  if (/studio|document|context-block|output-card/.test(surface)) return "document";
  return null;
}

function documentMaps(events: CreativeEvent[]) {
  const blockDocuments = new Map<string, string>();
  const generationDocuments = new Map<string, string>();
  const objectDocuments = new Map<string, string>();
  let currentDocument = "";
  for (const event of events) {
    const payload = event.payload;
    if (event.type === "DocumentCreated" || event.type === "DocumentOpened") currentDocument = String(payload.document_id ?? currentDocument);
    if (event.type === "BlockCreated") blockDocuments.set(String(payload.block_id ?? ""), String(payload.document_id ?? currentDocument));
    if (event.type === "GenerationRequested" || event.type === "IdeationPreviewCompleted" || event.type === "GenerationCompleted") {
      const documentId = String(payload.document_id ?? currentDocument);
      generationDocuments.set(String(payload.generation_id ?? ""), documentId);
      const objects = Array.isArray(payload.object_ids) ? payload.object_ids : payload.object_id ? [payload.object_id] : [];
      for (const objectId of objects) objectDocuments.set(String(objectId), documentId);
    }
  }
  return { blockDocuments, generationDocuments, objectDocuments };
}

function eventDocumentId(event: CreativeEvent, maps: ReturnType<typeof documentMaps>, fallback: string) {
  const payload = event.payload;
  const explicit = String(payload.document_id ?? "");
  if (explicit) return explicit;
  const block = maps.blockDocuments.get(String(payload.block_id ?? ""));
  if (block) return block;
  const generation = maps.generationDocuments.get(String(payload.generation_id ?? ""));
  if (generation) return generation;
  return maps.objectDocuments.get(String(payload.object_id ?? payload.item_id ?? "")) ?? fallback;
}

export function documentViewWorkflow(events: CreativeEvent[], documentId?: string, now = Date.now()): DocumentViewWorkflow {
  const maps = documentMaps(events);
  const rows = new Map<DocumentView, DocumentViewUsage>(DOCUMENT_VIEWS.map((view) => [view, { view, label: DOCUMENT_VIEW_LABELS[view], visits: 0, focusedVisits: 0, edits: 0, generationRequests: 0, outcomes: 0, activeMinutes: 0, frictionEpisodes: 0, score: 0, confidence: 0, lastSequence: 0, evidenceRefs: [] }]));
  const currentViewByDocument = new Map<string, DocumentView>();
  const lastVisitSequence = new Map<DocumentView, number>();
  let currentDocument = "";
  let currentView: DocumentView = "document";
  let transitions = 0;
  const addEvidence = (row: DocumentViewUsage, event: CreativeEvent) => {
    row.lastSequence = Math.max(row.lastSequence, event.sequence);
    if (!row.evidenceRefs.includes(event.eventId)) row.evidenceRefs.push(event.eventId);
    if (row.evidenceRefs.length > 12) row.evidenceRefs.shift();
  };

  for (const event of events) {
    const payload = event.payload;
    if (event.type === "DocumentCreated" || event.type === "DocumentOpened") currentDocument = String(payload.document_id ?? currentDocument);
    const eventDocument = eventDocumentId(event, maps, currentDocument);
    if (event.type === "DocumentViewVisited") {
      const view = safeView(payload.view);
      if (!view || (documentId && eventDocument !== documentId)) continue;
      const previous = currentViewByDocument.get(eventDocument);
      if (previous && previous !== view) transitions += 1;
      currentViewByDocument.set(eventDocument, view); currentView = view; currentDocument = eventDocument || currentDocument;
      const row = rows.get(view)!; row.visits += 1; row.focusedVisits += Number(Boolean(payload.focused)); addEvidence(row, event);
      lastVisitSequence.set(view,event.sequence);
      continue;
    }
    if (documentId && eventDocument && eventDocument !== documentId) continue;
    const view = documentViewForSurface(payload.source_surface ?? payload.created_from) ?? currentViewByDocument.get(eventDocument) ?? currentView;
    const row = rows.get(view)!;
    if (EDIT_EVENTS.test(event.type)) { row.edits += 1; addEvidence(row, event); }
    if (GENERATION_EVENTS.test(event.type) && event.actor !== "worker:scout") { row.generationRequests += 1; addEvidence(row, event); }
    if (OUTCOME_EVENTS.test(event.type)) { row.outcomes += 1; addEvidence(row, event); }
  }

  for (const event of attentionEvents(events, now)) {
    const payload = event.payload;
    const eventDocument = String(payload.document_id ?? "");
    if (documentId && eventDocument && eventDocument !== documentId) continue;
    const view = safeView(payload.document_view) ?? documentViewForSurface(payload.context) ?? "document";
    const row = rows.get(view)!;
    row.activeMinutes += Number(payload.active_ms ?? 0) / 60_000;
    row.frictionEpisodes += Number(Number(payload.friction_score ?? 0) >= .45);
    addEvidence(row, event);
  }

  for (const row of rows.values()) {
    row.activeMinutes = round(row.activeMinutes, 1);
    row.score = round(row.visits * .18 + row.focusedVisits * .08 + row.edits * .32 + row.generationRequests * .5 + row.outcomes + Math.min(10, row.activeMinutes) * .005 - row.frictionEpisodes * .02);
    const directEvidence = row.visits + row.edits + row.generationRequests + row.outcomes;
    row.confidence = round(Math.min(.95, directEvidence ? .28 + Math.log2(directEvidence + 1) * .14 + Math.min(.2, row.outcomes * .06) : 0));
  }
  const ordered = [...rows.values()].sort((left, right) => right.score - left.score || right.lastSequence - left.lastSequence || left.view.localeCompare(right.view));
  const used = ordered.filter((row) => row.visits || row.edits || row.generationRequests || row.outcomes || row.activeMinutes);
  return {
    rows: ordered,
    usedViews: used.length,
    totalVisits: used.reduce((sum, row) => sum + row.visits, 0),
    totalOutcomes: used.reduce((sum, row) => sum + row.outcomes, 0),
    totalActiveMinutes: round(used.reduce((sum, row) => sum + row.activeMinutes, 0), 1),
    transitions,
    preferredView: used[0] ?? null,
    lastView: (lastVisitSequence.size ? [...used].filter((row)=>lastVisitSequence.has(row.view)).sort((left,right)=>(lastVisitSequence.get(right.view)??0)-(lastVisitSequence.get(left.view)??0)) : [...used].sort((left, right) => right.lastSequence - left.lastSequence))[0] ?? null,
  };
}

export function preferredDocumentView(events: CreativeEvent[], documentId?: string) {
  const workflow = documentViewWorkflow(events, documentId);
  return workflow.preferredView?.view ?? workflow.lastView?.view ?? "document";
}
