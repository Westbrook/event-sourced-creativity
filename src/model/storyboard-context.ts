import type { DocumentArtifact, DocumentArtifactDraft } from "./document-artifacts";
import type { EventInput } from "./events";

export type StoryboardContextOptions = {
  documentId: string;
  projectId: string;
  sourceSurface: string;
  content?: DocumentArtifactDraft | null;
  existingSourceItemIds?: Iterable<string>;
  positionStart?: number;
  positionPrefix?: string;
  contextSetId?: string;
  contextRootBlockId?: string;
  memberOrderOffset?: number;
  sourceCanvasId?: string;
  sourceCanvasItemIds?: string[];
  idFactory?: () => string;
};

export type StoryboardContextResult = {
  events: EventInput[];
  blockIds: string[];
  sourceItemIds: string[];
  availableFrameCount: number;
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "storyboard";

/**
 * Materialize each rendered storyboard frame as an independently editable,
 * ordered reference block. The shared context-set metadata keeps the frames
 * usable as one storyboard without hiding the individual images from the
 * document projection or image compiler.
 */
export function storyboardFrameContextEvents(artifact: DocumentArtifact, options: StoryboardContextOptions): StoryboardContextResult {
  if (artifact.kind !== "storyboard") return { events: [], blockIds: [], sourceItemIds: [], availableFrameCount: 0 };
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const existing = new Set(options.existingSourceItemIds ?? []);
  const available = artifact.items.map((item, index) => ({ item, index })).filter(({ item }) => Boolean(item.mediaUrl));
  const pending = available.filter(({ item }) => !existing.has(item.id));
  const contextSetId = options.contextSetId ?? idFactory();
  const records = pending.map(({ item, index }) => ({ item, index, blockId: idFactory(), referenceId: idFactory() }));
  const rootBlockId = options.contextRootBlockId ?? records[0]?.blockId ?? "";
  const events: EventInput[] = [];
  for (const [ordinal, record] of records.entries()) {
    const authored = options.content?.items[record.index];
    const title = authored?.title?.trim() || record.item.title.trim() || `Frame ${record.index + 1}`;
    const body = authored?.body?.trim() || record.item.body.trim();
    const notes = authored?.notes?.trim() || record.item.notes.trim();
    const instruction = [body, notes].filter(Boolean).join(" ") || `Use frame ${record.index + 1} from ${artifact.title} as visual context.`;
    const shared = {
      project_id: options.projectId,
      document_id: options.documentId,
      source_artifact_id: artifact.id,
      source_artifact_item_id: record.item.id,
      source_artifact_kind: artifact.kind,
      source_surface: options.sourceSurface,
      ...(options.sourceCanvasId ? { source_canvas_id: options.sourceCanvasId } : {}),
      ...(options.sourceCanvasItemIds?.length ? { source_canvas_item_ids: options.sourceCanvasItemIds } : {}),
    };
    events.push({
      type: "ReferenceIngested",
      payload: {
        ...shared,
        reference_id: record.referenceId,
        source_type: "generated-artifact",
        source_ref: record.item.mediaUrl,
        media_url: record.item.mediaUrl,
        media_type: record.item.mediaType,
        rights_class: "account-generated",
        artifact_frame_index: record.index + 1,
      },
    });
    events.push({
      type: "BlockCreated",
      payload: {
        ...shared,
        block_id: record.blockId,
        type: "reference",
        handle: `reference/${slug(artifact.title)}-frame-${String(record.index + 1).padStart(2, "0")}`,
        position: `${options.positionPrefix ?? "z"}${String((options.positionStart ?? 0) + ordinal).padStart(8, "0")}`,
        properties: {
          reference_id: record.referenceId,
          label: `${artifact.title} · Frame ${record.index + 1} · ${title}`,
          text: instruction,
          media_url: record.item.mediaUrl,
          media_type: record.item.mediaType,
          width: record.item.width,
          height: record.item.height,
          focal_point: record.item.focalPoint,
          subtype: "Composition",
          intent: "include",
          authority: "authored",
          weight: 0.8,
          // Keep every frame visible and semantically active without silently
          // attaching a multi-image payload. Creators can opt individual frame
          // pixels into a later render from the ordinary Reference controls.
          pixel_reference_mode: "context_only",
          source_artifact_id: artifact.id,
          source_artifact_item_id: record.item.id,
          source_artifact_kind: artifact.kind,
          source_document_id: artifact.documentId,
          storyboard_frame_index: record.index + 1,
          storyboard_frame_count: available.length,
          storyboard_title: artifact.title,
          storyboard_shot_title: title,
          storyboard_shot_direction: body,
          storyboard_camera_direction: notes,
          storyboard_frame_prompt: authored?.image_prompt?.trim() || "",
          reference_set_id: contextSetId,
          reference_set_kind: "storyboard",
          reference_set_role: "ordered-video-sequence",
          reference_set_order: "storyboard_frame_index",
          context_set_id: contextSetId,
          context_set_root_id: rootBlockId,
          copied_as_context_set: records.length > 1,
          combined_context_memberships: [{
            contextSetId,
            name: artifact.title,
            role: "sequence",
            target: `${artifact.title} ordered shot sequence`,
            application: "ordered",
            relativity: 1,
            memberOrder: record.index + (options.memberOrderOffset ?? 0),
            sourceCanvasId: options.sourceCanvasId ?? "",
          }],
          semantic_isolation: true,
          created_from: options.sourceSurface,
          ...(options.sourceCanvasItemIds?.length ? { source_canvas_item_ids: options.sourceCanvasItemIds } : {}),
        },
      },
    });
  }
  return {
    events,
    blockIds: records.map((record) => record.blockId),
    sourceItemIds: records.map((record) => record.item.id),
    availableFrameCount: available.length,
  };
}
