import type { CreativeEvent } from "./events";
import { ownedMediaKey } from "./share-scope.ts";

export type FormaArchiveMedia = {
  sourceRef: string;
  rightsClass: string;
  artifactId?: string;
  itemId?: string;
  blockId?: string;
  role?: string;
  mediaType?: string;
  sha256?: string;
  fileName?: string;
  fileSize?: number;
  format?: string;
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
  const references = new Map(events.filter((event) => event.type === "ReferenceIngested")
    .map((event) => [event.payload.source_ref, event.payload]));
  const mediaManifest: FormaArchiveMedia[] = [...references.values()]
    .map((payload) => ({ sourceRef: String(payload.source_ref ?? ""), rightsClass: String(payload.rights_class ?? "unknown") }))
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
  const addModelMedia = (url: unknown, entry: Omit<FormaArchiveMedia, "sourceRef" | "rightsClass">) => {
    const reference = references.get(url);
    add(url, {
      ...entry,
      ...(reference?.source_mime_type ? { mediaType: String(reference.source_mime_type) } : {}),
      ...archiveHash(reference?.content_hash),
    });
  };
  const addModelFiles = (files: unknown, owner: { artifactId?: string; blockId?: string }) => {
    for (const candidate of Array.isArray(files) ? files : []) {
      const file = asRecord(candidate);
      addModelMedia(file.url, {
        ...owner,
        role: ["mesh", "texture", "preview"].includes(String(file.role)) ? String(file.role) : "model3d-attachment",
        ...(file.mimeType ? { mediaType: String(file.mimeType) } : {}),
        ...(file.fileName ? { fileName: String(file.fileName) } : {}),
        ...(typeof file.fileSize === "number" && Number.isSafeInteger(file.fileSize) && file.fileSize >= 0 ? { fileSize: file.fileSize } : {}),
        ...(file.format ? { format: String(file.format) } : {}),
        ...archiveHash(file.sha256),
      });
    }
  };
  const blocks = new Map<string, { type: string; properties: Record<string, unknown> }>();
  const addModelBlock = (blockId: string, block: { type: string; properties: Record<string, unknown> }) => {
    const properties = block.properties;
    if (block.type !== "model3d" && !properties.model_url && !properties.model3d_files && !asRecord(properties.settings).model3d_files) return;
    addModelFiles(properties.model3d_files, { blockId });
    addModelFiles(asRecord(properties.settings).model3d_files, { blockId });
    addModelMedia(properties.model_url, {
      blockId, role: "mesh",
      ...(properties.model_mime_type ? { mediaType: String(properties.model_mime_type) } : {}),
      ...archiveHash(properties.model_content_hash),
    });
    if (properties.media_url !== properties.model_url) {
      const mediaType = properties.media_type ?? properties.mime_type ?? properties.source_mime_type;
      addModelMedia(properties.media_url, {
        blockId, role: String(mediaType ?? "").startsWith("model/") ? "mesh" : "model3d-view",
        ...(mediaType ? { mediaType: String(mediaType) } : {}),
        ...archiveHash(properties.source_content_hash ?? properties.content_hash),
      });
    }
  };
  for (const event of events) {
    const payload = event.payload;
    if (event.type === "BlockCreated") {
      const blockId = String(payload.block_id ?? "");
      const block = { type: String(payload.type ?? ""), properties: { ...asRecord(payload.properties) } };
      blocks.set(blockId, block);
      addModelBlock(blockId, block);
      continue;
    }
    if (event.type === "BlockPropertyEdited" || event.type === "ChipEdited") {
      const blockId = String(payload.block_id ?? "");
      const block = blocks.get(blockId);
      const path = String(event.type === "ChipEdited" ? payload.property ?? "value" : payload.property_path ?? "");
      if (block && path) {
        if (event.type === "BlockPropertyEdited" && path === "type") block.type = String(payload.new_value ?? "");
        else block.properties[path] = payload.new_value;
        addModelBlock(blockId, block);
      }
      continue;
    }
    if (event.type === "GenerationCompleted" || event.type === "IdeationPreviewCompleted") {
      add(payload.media_url, { role: event.type === "IdeationPreviewCompleted" ? "generated-preview" : "generated-image", ...(payload.media_type ? { mediaType: String(payload.media_type) } : {}) });
      continue;
    }
    if (event.type !== "DocumentRenderCompleted") continue;
    const artifactId = String(payload.artifact_id ?? "");
    const kind = String(payload.artifact_kind ?? "");
    if (kind === "model3d") addModelFiles(asRecord(payload.settings).model3d_files, artifactId ? { artifactId } : {});
    const items = (Array.isArray(payload.items) ? payload.items : []).flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [item as Record<string, unknown>] : [])
      .sort((left, right) => Number(left.narrative_order ?? Number.MAX_SAFE_INTEGER) - Number(right.narrative_order ?? Number.MAX_SAFE_INTEGER));
    for (const item of items) add(item.media_url, {
      ...(artifactId ? { artifactId } : {}),
      ...(item.id ? { itemId: String(item.id) } : {}),
      role: kind === "video" ? "video-scene" : kind === "storyboard" ? "storyboard-frame" : kind === "model3d" ? "mesh" : "artifact-media",
      ...(item.media_type ? { mediaType: String(item.media_type) } : {}),
      ...(Number(item.narrative_order) > 0 ? { narrativeOrder: Number(item.narrative_order) } : {}),
      ...(Number(item.generation_order) > 0 ? { generationOrder: Number(item.generation_order) } : {}),
      ...(Number(item.duration_seconds) > 0 ? { durationSeconds: Number(item.duration_seconds) } : {}),
    });
    add(payload.media_url, { ...(artifactId ? { artifactId } : {}), role: kind === "video" ? "video-output" : kind === "model3d" ? "mesh" : "artifact-media", ...(payload.media_type ? { mediaType: String(payload.media_type) } : {}) });
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

const archiveHash = (value: unknown): { sha256?: string } =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? { sha256: value } : {};

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
    const referenceOwner = owners.get(resourceId(payload.reference_id)) || owners.get(resourceId(payload.model_reference_id));
    const artifactOwner = owners.get(resourceId(payload.artifact_id));
    const generationOwner = owners.get(resourceId(payload.generation_id));
    const objectOwner = owners.get(resourceId(payload.object_id));
    const owner = resourceId(payload.project_id) || documentOwner || blockOwner || canvasOwner || referenceOwner || artifactOwner || generationOwner || objectOwner || activeProject;
    if (!owner) continue;

    if (event.type === "DocumentCreated" || event.type === "DocumentForked") remember(payload.document_id, owner);
    if (event.type === "BlockCreated") {
      remember(payload.block_id, owner);
      remember(asRecord(payload.properties).reference_id, owner);
      remember(asRecord(payload.properties).model_reference_id, owner);
    }
    if (event.type === "BlockPropertyEdited" || event.type === "ChipEdited") {
      const path = event.type === "ChipEdited" ? payload.property : payload.property_path;
      if (["reference_id", "model_reference_id"].includes(String(path))) remember(payload.new_value, owner);
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
      payload.relation_id, payload.reference_id, payload.model_reference_id, payload.collection_id, payload.canvas_id,
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
