import type { CreativeEvent } from "./events";

export type FormaArchive = {
  format: "forma-event-archive";
  version: 1;
  exportedAt: string;
  streamId: string;
  events: CreativeEvent[];
  mediaManifest: Array<{ sourceRef: string; rightsClass: string }>;
};

export function exportArchive(events: CreativeEvent[]): FormaArchive {
  return {
    format: "forma-event-archive", version: 1, exportedAt: new Date().toISOString(),
    streamId: events[0]?.streamId ?? "empty",
    events: structuredClone(events),
    mediaManifest: events.filter((e) => e.type === "ReferenceIngested").map((e) => ({ sourceRef: String(e.payload.source_ref ?? ""), rightsClass: String(e.payload.rights_class ?? "unknown") })),
  };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const resourceId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "";

/** Resolve ownership from creation facts before filtering interleaved account-wide history. */
export function projectArchiveEvents(events: readonly CreativeEvent[], projectId: string): CreativeEvent[] {
  const selectedProject = projectId.trim();
  if (!selectedProject) return [];

  const owners = new Map<string, string>();
  let activeProject = "";
  const remember = (value: unknown, owner: string) => {
    const id = resourceId(value);
    if (id && owner) owners.set(id, owner);
  };

  for (const event of events) {
    const payload = asRecord(event.payload);
    if (event.type === "ProjectCreated" || event.type === "ProjectOpened") {
      activeProject = resourceId(payload.project_id) || activeProject;
      if (event.type === "ProjectCreated") remember(payload.project_id, activeProject);
      continue;
    }

    const documentOwner = owners.get(resourceId(payload.document_id));
    const blockOwner = owners.get(resourceId(payload.block_id));
    const canvasOwner = owners.get(resourceId(payload.canvas_id));
    const owner = resourceId(payload.project_id) || documentOwner || blockOwner || canvasOwner || activeProject;
    if (!owner) continue;

    if (event.type === "DocumentCreated" || event.type === "DocumentForked") remember(payload.document_id, owner);
    if (event.type === "BlockCreated") {
      remember(payload.block_id, owner);
      remember(asRecord(payload.properties).reference_id, owner);
    }
    if (event.type === "BlockRelationAdded") remember(payload.relation_id, owner);
    if (event.type === "CollectionCreated") remember(payload.collection_id, owner);
    if (event.type === "CanvasCreated") remember(payload.canvas_id, owner);
    if (event.type === "CanvasItemPlaced" || event.type === "CanvasReferenceCreated") {
      remember(payload.item_id ?? payload.reference_item_id, owner);
    }
    if (event.type === "ContextSetFormalized") remember(payload.context_set_id, owner);
    if (event.type === "ReferenceIngested") remember(payload.reference_id, owner);
    if (event.type === "ContextCompiled" || event.type === "GenerationRequested") remember(payload.generation_id, owner);
    if (event.type === "GenerationCompleted" || event.type === "IdeationPreviewGenerated") {
      remember(payload.generation_id, owner);
      for (const id of Array.isArray(payload.object_ids) ? payload.object_ids : []) remember(id, owner);
      remember(payload.object_id, owner);
    }
    if (event.type === "DocumentRenderRequested" || event.type === "DocumentRenderCompleted") remember(payload.artifact_id, owner);
  }

  return events.filter((event) => {
    const payload = asRecord(event.payload);
    const direct = resourceId(payload.project_id) || resourceId(asRecord(payload.snapshot_ref).project_id);
    if (direct) return direct === selectedProject;

    const nested = asRecord(payload.item_ref);
    const candidates = [
      payload.document_id, payload.block_id, payload.from_block_id, payload.to_block_id,
      payload.relation_id, payload.reference_id, payload.collection_id, payload.canvas_id,
      payload.item_id, payload.reference_item_id, payload.context_set_id, payload.generation_id,
      payload.object_id, payload.artifact_id, nested.document_id, nested.block_id,
      nested.collection_id, nested.object_id, ...(Array.isArray(payload.object_ids) ? payload.object_ids : []),
    ];
    const resolved = candidates.map((id) => owners.get(resourceId(id))).filter((owner): owner is string => Boolean(owner));
    return resolved.length > 0 && resolved.every((owner) => owner === selectedProject);
  });
}

/** A project-facing export must never silently contain another project's events or media. */
export function exportProjectArchive(events: readonly CreativeEvent[], projectId: string): FormaArchive {
  return exportArchive(projectArchiveEvents(events, projectId));
}

export function importArchive(value: unknown): FormaArchive {
  if (!value || typeof value !== "object") throw new Error("Archive must be an object");
  const archive = value as Partial<FormaArchive>;
  if (archive.format !== "forma-event-archive" || archive.version !== 1 || !Array.isArray(archive.events)) throw new Error("Unsupported Forma archive");
  for (const event of archive.events) if (!event || typeof event.type !== "string" || typeof event.sequence !== "number" || !event.payload) throw new Error("Archive contains an invalid event");
  return archive as FormaArchive;
}
