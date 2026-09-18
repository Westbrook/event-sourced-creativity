import { GENERATED_IMAGE_EDIT_LIMITS } from "./generated-image-edit.ts";
import { outputAssetSha256 } from "./output-asset-inspection.ts";
import type { CreativeEvent, CreativeOutput } from "./events.ts";
import { ownerMediaNamespace } from "./media-ownership.ts";
import { normalizeReferenceComposition, type ReferenceCompositionRecipe, type ReferenceCompositionSource } from "./reference-composition.ts";

/** Serialized personal generated-output edit contract. Parsing proves shape,
 * never ownership, currentness, compositor provenance, or write authority. */
export type GeneratedImageEditRequest = {
  expectedRevision: number; expectedEditEventId: string | null; expectedContentSha256: string;
  generationId: string; sourceEventId: string; contentRef: string; sourceMediaUrl: string; sourceMediaSha256: string;
  sourceId: string; recipe: ReferenceCompositionRecipe;
  resultMediaSha256: string; resultByteLength: number;
};
export type GeneratedImageRevision = {
  schemaVersion: 1; operation: "composition"; revision: number; editEventId: string;
  outputId: string; documentId: string; generationId: string; sourceEventId: string;
  contentRef: string; contentSha256: string;
  source: { revision: number; eventId: string; mediaUrl: string; sha256: string; width: number; height: number };
  media: { url: string; mediaType: "image/png"; sha256: string; byteLength: number; width: number; height: number };
  sourceId: string; recipe: ReferenceCompositionRecipe; recipeSha256: string; operationSha256: string;
};
export type GeneratedImageEditResult =
  | { status: "saved"; code: "saved"; imageRevision: GeneratedImageRevision }
  | { status: "unchanged"; code: "unchanged" }
  | { status: "unconfirmed"; code: "unconfirmed" }
  | { status: "refused"; code: "unavailable" | "source_changed" | "invalid" | "forbidden" };

export type GeneratedImageEditSnapshot = {
  status: "current"; ownerId: string; projectId: string; documentId: string; outputId: string;
  generationId: string; sourceEventId: string; contentRef: string; contentSha256: string; rawJson: string;
  revision: number; editEventId: string | null;
  media: { url: string; mediaType: "image/png"; sha256: string; width: number; height: number; byteLength?: number };
  sources: ReferenceCompositionSource[]; sourceIds: string[]; head: number;
};
export type GeneratedImageEditAcknowledgment =
  | { status: "saved"; code: "saved"; imageRevision: GeneratedImageRevision; operationSha256: string;
      stillCurrent: boolean; currentRevision?: number; currentEditEventId?: string | null }
  | Exclude<GeneratedImageEditResult, { status: "saved" }>;

/** Current visible metadata only. The private recipe/revision row is checked by
 * the endpoint and owning Store, not inferred from this projection. */
export type GeneratedImageOutputEdit = Readonly<{
  revision: number; editEventId: string; editSequence: number; revisionId: string;
  revisionSha256: string; operationSha256: string; contentSha256: string;
  mediaSha256: string; byteLength: number;
}>;
export type EditableGeneratedImageOutput = CreativeOutput & { imageRevision?: GeneratedImageOutputEdit };

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Row, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const uint = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const dimension = (value: unknown): value is number => uint(value, 1) && value <= 16_384;
const sameData = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameData(value, right[index]));
  if (!row(left) || !row(right) || !keys(left, Object.keys(right))) return false;
  return Object.keys(left).every(key => sameData(left[key], right[key]));
};
function recipe(value: unknown): ReferenceCompositionRecipe | null {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > GENERATED_IMAGE_EDIT_LIMITS.recipeBytes) return null;
    const normalized = normalizeReferenceComposition(value);
    return normalized && sameData(value, normalized) ? normalized : null;
  } catch { return null; }
}

export function parseGeneratedImageEditRequest(value: unknown): GeneratedImageEditRequest | null {
  if (!row(value) || !keys(value, ["expectedRevision", "expectedEditEventId", "expectedContentSha256", "generationId", "sourceEventId", "contentRef", "sourceMediaUrl", "sourceMediaSha256", "sourceId", "recipe", "resultMediaSha256", "resultByteLength"])
    || !uint(value.expectedRevision) || (value.expectedRevision === 0 ? value.expectedEditEventId !== null : !token(value.expectedEditEventId)) || !sha(value.expectedContentSha256) || !sha(value.sourceMediaSha256)
    || ![value.generationId, value.sourceEventId, value.contentRef].every(token)
    || typeof value.sourceMediaUrl !== "string" || !token(value.sourceId) || !sha(value.resultMediaSha256) || !uint(value.resultByteLength, 1)
    || value.resultByteLength > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) return null;
  const composition = recipe(value.recipe);
  if (!composition || !composition.sources.some(source => source.id === value.sourceId && source.kind === "image" && source.mediaUrl === value.sourceMediaUrl && source.contentHash === value.sourceMediaSha256)
    || !composition.layers.some(layer => layer.opacity > 0)) return null;
  return { expectedRevision: value.expectedRevision, expectedEditEventId: value.expectedEditEventId as string | null, expectedContentSha256: value.expectedContentSha256,
    generationId: value.generationId as string, sourceEventId: value.sourceEventId as string, contentRef: value.contentRef as string,
    sourceMediaUrl: value.sourceMediaUrl, sourceMediaSha256: value.sourceMediaSha256, sourceId: value.sourceId, recipe: composition,
    resultMediaSha256: value.resultMediaSha256, resultByteLength: value.resultByteLength };
}

export function generatedImageOwnedMediaUrl(value: unknown, ownerId: string, derivative = false): value is string {
  if (typeof value !== "string" || !token(ownerId)) return false;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length)), prefix = ownerMediaNamespace(ownerId) + "/generated/";
    if (value !== "/api/media/" + encodeURIComponent(key) || !key.startsWith(prefix)) return false;
    const name = key.slice(prefix.length);
    return derivative ? /^image-edit-[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.png$/u.test(name)
      : /^[A-Za-z0-9._-]+\.png$/u.test(name);
  } catch { return false; }
}

export function parseGeneratedImageRevision(value: unknown, ownerId: string): GeneratedImageRevision | null {
  if (!row(value) || !keys(value, ["schemaVersion", "operation", "revision", "editEventId", "outputId", "documentId", "generationId", "sourceEventId", "contentRef", "contentSha256", "source", "media", "sourceId", "recipe", "recipeSha256", "operationSha256"])
    || value.schemaVersion !== 1 || value.operation !== "composition" || !uint(value.revision, 1)
    || ![value.editEventId, value.outputId, value.documentId, value.generationId, value.sourceEventId, value.contentRef, value.sourceId].every(token)
    || !sha(value.contentSha256) || !sha(value.recipeSha256) || !sha(value.operationSha256)) return null;
  const source = value.source, media = value.media, composition = recipe(value.recipe);
  if (!row(source) || !keys(source, ["revision", "eventId", "mediaUrl", "sha256", "width", "height"])
    || !uint(source.revision) || !token(source.eventId) || source.eventId === value.editEventId || value.editEventId === value.sourceEventId
    || (source.revision === 0 ? source.eventId !== value.sourceEventId : source.eventId === value.sourceEventId) || source.revision !== value.revision - 1 || !generatedImageOwnedMediaUrl(source.mediaUrl, ownerId)
    || !sha(source.sha256) || !dimension(source.width) || !dimension(source.height)
    || !row(media) || !keys(media, ["url", "mediaType", "sha256", "byteLength", "width", "height"])
    || !generatedImageOwnedMediaUrl(media.url, ownerId, true) || media.url === source.mediaUrl || media.mediaType !== "image/png"
    || !sha(media.sha256) || !uint(media.byteLength, 1) || media.byteLength > GENERATED_IMAGE_EDIT_LIMITS.pngBytes
    || !dimension(media.width) || !dimension(media.height) || !composition
    || media.width !== composition.width || media.height !== composition.height
    || !composition.sources.some(item => item.id === value.sourceId && item.kind === "image" && item.mediaUrl === source.mediaUrl && item.contentHash === source.sha256)
    || !composition.layers.some(layer => layer.opacity > 0)) return null;
  return { schemaVersion: 1, operation: "composition", revision: value.revision, editEventId: value.editEventId as string,
    outputId: value.outputId as string, documentId: value.documentId as string, generationId: value.generationId as string,
    sourceEventId: value.sourceEventId as string, contentRef: value.contentRef as string, contentSha256: value.contentSha256,
    source: { revision: source.revision, eventId: source.eventId, mediaUrl: source.mediaUrl, sha256: source.sha256, width: source.width, height: source.height },
    media: { url: media.url, mediaType: "image/png", sha256: media.sha256, byteLength: media.byteLength, width: media.width, height: media.height },
    sourceId: value.sourceId as string, recipe: composition, recipeSha256: value.recipeSha256, operationSha256: value.operationSha256 };
}

/** Same canonical request identity for the authenticated handler and its owning
 * Store. Context is supplied by those owners; this hash is not an access grant. */
export async function generatedImageEditOperationSha256(
  context: { ownerId: string; projectId: string; documentId: string; outputId: string },
  value: unknown,
): Promise<string | null> {
  if (!row(context) || !keys(context, ["ownerId", "projectId", "documentId", "outputId"])
    || ![context.ownerId, context.projectId, context.documentId, context.outputId].every(token)) return null;
  const request = parseGeneratedImageEditRequest(value);
  if (!request || !generatedImageOwnedMediaUrl(request.sourceMediaUrl, context.ownerId)) return null;
  return outputAssetSha256(new TextEncoder().encode(JSON.stringify({ ownerId: context.ownerId, projectId: context.projectId,
    documentId: context.documentId, outputId: context.outputId, request })));
}

/** Apply one server-owned event to its exact predecessor. Generic event ingress
 * does not permit this event; this pure function does not authenticate history. */
export function projectGeneratedImageEdit(
  output: EditableGeneratedImageOutput, event: CreativeEvent, context: { ownerId: string; projectId: string },
): EditableGeneratedImageOutput | null {
  const p = event.payload, previous = output.imageRevision;
  if (output.mediaType !== "image/png" || output.quality !== "high" || output.purpose !== "final"
    || !generatedImageOwnedMediaUrl(output.mediaUrl, context.ownerId) || output.discarded
    || event.type !== "GeneratedImageEdited" || event.actor !== "user" || event.clientId !== "web:generated-image-editor"
    || event.streamId !== "creative:" + context.ownerId || !token(event.eventId) || !uint(event.sequence, 1)
    || event.sequence <= (previous?.editSequence ?? output.sequence) || !row(p)
    || p.output_id !== output.id || p.object_id !== output.id || p.document_id !== output.documentId
    || p.project_id !== context.projectId || p.generation_id !== output.generationId || p.source_event_id !== output.sourceEventId
    || p.content_ref !== output.contentRef || p.edited_by_user_id !== context.ownerId || p.source_surface !== "generated-image-editor"
    || !uint(p.revision, 1) || p.revision !== (previous?.revision ?? 0) + 1 || p.previous_revision !== (previous?.revision ?? 0)
    || p.previous_edit_event_id !== (previous?.editEventId ?? null) || event.eventId === output.sourceEventId
    || !token(p.image_revision_id) || !sha(p.image_revision_sha256) || !sha(p.image_edit_operation_sha256)
    || !sha(p.content_sha256) || previous && p.content_sha256 !== previous.contentSha256
    || !generatedImageOwnedMediaUrl(p.media_url, context.ownerId, true) || p.media_url === output.mediaUrl
    || p.media_type !== "image/png" || !sha(p.source_content_hash) || !dimension(p.image_width) || !dimension(p.image_height)
    || !uint(p.image_byte_length, 1) || p.image_byte_length > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) return null;
  return { ...output, mediaUrl: p.media_url, mediaType: "image/png", width: p.image_width, height: p.image_height, focalPoint: null,
    imageRevision: Object.freeze({ revision: p.revision, editEventId: event.eventId, editSequence: event.sequence,
      revisionId: p.image_revision_id, revisionSha256: p.image_revision_sha256, operationSha256: p.image_edit_operation_sha256,
      contentSha256: p.content_sha256, mediaSha256: p.source_content_hash, byteLength: p.image_byte_length }) };
}
