import type { CreativeEvent } from "./events";
import { ownedMediaKey } from "./share-scope.ts";

export type FormaArchiveMedia = {
  sourceRef: string;
  rightsClass: string;
  artifactId?: string;
  itemId?: string;
  role?: string;
  mediaType?: string;
  narrativeOrder?: number;
  generationOrder?: number;
  durationSeconds?: number;
};

export type FormaArchive = {
  format: "forma-event-archive";
  version: 1;
  exportedAt: string;
  streamId: string;
  events: CreativeEvent[];
  mediaManifest: FormaArchiveMedia[];
};

export function exportArchive(events: CreativeEvent[]): FormaArchive {
  const streamId = events[0]?.streamId ?? "empty";
  const ownerId = streamId.startsWith("creative:") ? streamId.slice("creative:".length) : "";
  const mediaManifest: FormaArchiveMedia[] = events.filter((event) => event.type === "ReferenceIngested")
    .map((event) => ({ sourceRef: String(event.payload.source_ref ?? ""), rightsClass: String(event.payload.rights_class ?? "unknown") }))
    .filter((entry) => !ownerId || !entry.sourceRef.startsWith("/api/media/") || Boolean(ownedMediaKey(entry.sourceRef, ownerId)));
  const existingEntries = new Map(mediaManifest.map((entry, index) => [entry.sourceRef, index]));
  const add = (url: unknown, entry: Omit<FormaArchiveMedia, "sourceRef" | "rightsClass">) => {
    if (typeof url !== "string" || !/^\/api\/media\/[^?#]+$/.test(url)) return;
    if (ownerId && !ownedMediaKey(url, ownerId)) return;
    const existingIndex = existingEntries.get(url);
    if (existingIndex !== undefined) {
      const previous = mediaManifest[existingIndex]!;
      mediaManifest[existingIndex] = { ...previous, ...entry, ...(previous.role ? { role: previous.role } : {}) };
      return;
    }
    existingEntries.set(url, mediaManifest.length);
    mediaManifest.push({ sourceRef: url, rightsClass: "account-generated", ...entry });
  };
  for (const event of events) {
    const payload = event.payload;
    if (event.type === "GenerationCompleted" || event.type === "IdeationPreviewCompleted") {
      add(payload.media_url, { role: event.type === "IdeationPreviewCompleted" ? "generated-preview" : "generated-image", ...(payload.media_type ? { mediaType: String(payload.media_type) } : {}) });
      continue;
    }
    if (event.type !== "DocumentRenderCompleted") continue;
    const artifactId = String(payload.artifact_id ?? "");
    const kind = String(payload.artifact_kind ?? "");
    const items = (Array.isArray(payload.items) ? payload.items : []).flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [item as Record<string, unknown>] : [])
      .sort((left, right) => Number(left.narrative_order ?? Number.MAX_SAFE_INTEGER) - Number(right.narrative_order ?? Number.MAX_SAFE_INTEGER));
    for (const item of items) add(item.media_url, {
      ...(artifactId ? { artifactId } : {}),
      ...(item.id ? { itemId: String(item.id) } : {}),
      role: kind === "video" ? "video-scene" : kind === "storyboard" ? "storyboard-frame" : "artifact-media",
      ...(item.media_type ? { mediaType: String(item.media_type) } : {}),
      ...(Number(item.narrative_order) > 0 ? { narrativeOrder: Number(item.narrative_order) } : {}),
      ...(Number(item.generation_order) > 0 ? { generationOrder: Number(item.generation_order) } : {}),
      ...(Number(item.duration_seconds) > 0 ? { durationSeconds: Number(item.duration_seconds) } : {}),
    });
    add(payload.media_url, { ...(artifactId ? { artifactId } : {}), role: kind === "video" ? "video-output" : "artifact-media", ...(payload.media_type ? { mediaType: String(payload.media_type) } : {}) });
    for (const asset of Array.isArray(payload.production_assets) ? payload.production_assets : []) {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
      const value = asset as Record<string, unknown>;
      add(value.media_url, { ...(artifactId ? { artifactId } : {}), role: String(value.role ?? "production-asset"), ...(value.media_type ? { mediaType: String(value.media_type) } : {}) });
    }
  }
  return {
    format: "forma-event-archive", version: 1, exportedAt: new Date().toISOString(),
    streamId,
    events: structuredClone(events),
    mediaManifest,
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
