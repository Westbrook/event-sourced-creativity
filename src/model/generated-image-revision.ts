import { GENERATED_IMAGE_EDIT_LIMITS, parseGuestImageResultCompletedCustodyReview, parseGuestImageResultMediaUrl,
  type GuestImageResultCompletedCustodyReview } from "./generated-image-edit.ts";
import { parseGuestImageResultClaimEventOrigin } from "./guest-image-result-presentation.ts";
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
    || event.sequence <= (previous?.editSequence ?? output.sequence) || !row(p) || Object.hasOwn(p, "claim")
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

/** Explicit claimed contracts. Existing native request, revision, hash and
 * projector entrypoints above remain native-only. These values do not prove
 * completed custody or authorize an edit, private read, or media write. */
export type GuestImageResultEditRequest = GeneratedImageEditRequest & {
  schemaVersion: 2; claim: GuestImageResultCompletedCustodyReview;
};
export type GuestImageResultRevision = Omit<GeneratedImageRevision, "schemaVersion"> & {
  schemaVersion: 2; claim: GuestImageResultCompletedCustodyReview;
};
export type GuestImageResultEditSnapshot = GeneratedImageEditSnapshot & {
  claim: GuestImageResultCompletedCustodyReview;
};

const claimUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const claimIso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const claimRef = (value: unknown): value is string => typeof value === "string" && /^guest-image-result-history-[a-f0-9]{64}$/u.test(value);
const sameClaim = (left: GuestImageResultCompletedCustodyReview, right: GuestImageResultCompletedCustodyReview) =>
  left.version === right.version && left.kind === right.kind && left.custodyId === right.custodyId
  && left.claimEventId === right.claimEventId && left.lineageDigest === right.lineageDigest;

// Only the new opted-in branch uses this descriptor-safe detached capture.
// Never JSON.stringify a caller's object or invoke its getters/toJSON.
function claimedEditData(value: unknown): unknown {
  const seen = new Set<object>(); let count = 0, bytes = 0;
  const invalid = (): never => { throw new TypeError("invalid_claimed_image_edit"); };
  const charge = (text: string) => { bytes += new TextEncoder().encode(text).byteLength; if (bytes > GENERATED_IMAGE_EDIT_LIMITS.rawBytes) invalid(); };
  const visit = (item: unknown, depth: number): unknown => {
    if (++count > GENERATED_IMAGE_EDIT_LIMITS.nodes || depth > GENERATED_IMAGE_EDIT_LIMITS.depth) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { charge(item); return item; }
    if (typeof item === "number") return Number.isFinite(item) ? item : invalid();
    if (!item || typeof item !== "object" || seen.has(item)) return invalid();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), names = Reflect.ownKeys(descriptors);
    if (array) {
      const length = descriptors.length;
      if (!length || !Object.hasOwn(length, "value") || !uint(length.value) || length.value > GENERATED_IMAGE_EDIT_LIMITS.nodes
        || names.length !== length.value + 1) return invalid();
      const result: unknown[] = [];
      for (let index = 0; index < length.value; index++) {
        const property = descriptors[index];
        if (!property || !Object.hasOwn(property, "value") || !property.enumerable) return invalid();
        result.push(visit(property.value, depth + 1));
      }
      return Object.freeze(result);
    }
    const result: Row = {};
    for (const name of names) {
      if (typeof name !== "string" || ["__proto__", "prototype", "constructor"].includes(name)) return invalid();
      const property = descriptors[name]!;
      if (!Object.hasOwn(property, "value") || !property.enumerable) return invalid();
      charge(name); result[name] = visit(property.value, depth + 1);
    }
    return Object.freeze(result);
  };
  return visit(value, 0);
}

export function parseGuestImageResultEditRequest(value: unknown): GuestImageResultEditRequest | null {
  try {
    const data = claimedEditData(value);
    if (!row(data) || !keys(data, ["expectedRevision", "expectedEditEventId", "expectedContentSha256", "generationId", "sourceEventId",
      "contentRef", "sourceMediaUrl", "sourceMediaSha256", "sourceId", "recipe", "resultMediaSha256", "resultByteLength", "schemaVersion", "claim"])
      || data.schemaVersion !== 2) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(data.claim);
    const { schemaVersion: omittedVersion, claim: omittedClaim, ...nativeShape } = data; void omittedVersion; void omittedClaim;
    const request = parseGeneratedImageEditRequest(nativeShape), media = parseGuestImageResultMediaUrl(data.sourceMediaUrl);
    if (!claim || !request || Object.is(request.expectedRevision, -0) || !claimUuid(request.generationId) || request.sourceEventId !== claim.claimEventId || !claimRef(request.contentRef)
      || !media || media.custodyId !== claim.custodyId || media.outputId !== `object-${request.generationId.slice(-8)}`
      || (request.expectedRevision === 0 ? media.revisionId !== null : media.revisionId === null
        || !claimUuid(request.expectedEditEventId) || request.expectedEditEventId === claim.claimEventId)) return null;
    // Native request reconstruction establishes its twelve-key order. The claim
    // parser reconstructs its five keys, independent of caller insertion order.
    return claimedEditData({ ...request, schemaVersion: 2, claim }) as GuestImageResultEditRequest;
  } catch { return null; }
}

/** Optional row ID joins the derivative key to its separately stored revision
 * row. Without it, this parser validates only the closed serialized record. */
export function parseGuestImageResultRevision(value: unknown, ownerId: string, expectedRevisionId?: string): GuestImageResultRevision | null {
  try {
    const data = claimedEditData(value);
    if (!row(data) || !keys(data, ["schemaVersion", "operation", "revision", "editEventId", "outputId", "documentId", "generationId", "sourceEventId",
      "contentRef", "contentSha256", "source", "media", "sourceId", "recipe", "recipeSha256", "operationSha256", "claim"])
      || data.schemaVersion !== 2 || data.operation !== "composition" || !uint(data.revision, 1)
      || ![data.editEventId, data.documentId, data.generationId].every(claimUuid) || !token(data.sourceId)
      || !claimRef(data.contentRef) || !sha(data.contentSha256) || !sha(data.recipeSha256) || !sha(data.operationSha256)) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(data.claim);
    if (!claim || data.sourceEventId !== claim.claimEventId || data.outputId !== `object-${String(data.generationId).slice(-8)}`
      || data.editEventId === claim.claimEventId) return null;
    const source = data.source, media = data.media, composition = recipe(data.recipe);
    if (!row(source) || !keys(source, ["revision", "eventId", "mediaUrl", "sha256", "width", "height"])
      || !uint(source.revision) || Object.is(source.revision, -0) || source.revision !== data.revision - 1 || !claimUuid(source.eventId)
      || source.eventId === data.editEventId || (source.revision === 0 ? source.eventId !== claim.claimEventId : source.eventId === claim.claimEventId)
      || !sha(source.sha256) || !dimension(source.width) || !dimension(source.height)
      || !row(media) || !keys(media, ["url", "mediaType", "sha256", "byteLength", "width", "height"])
      || media.mediaType !== "image/png" || !sha(media.sha256) || !uint(media.byteLength, 1)
      || media.byteLength > GENERATED_IMAGE_EDIT_LIMITS.pngBytes || !dimension(media.width) || !dimension(media.height)
      || !composition || media.width !== composition.width || media.height !== composition.height
      || !composition.sources.some(item => item.id === data.sourceId && item.kind === "image" && item.mediaUrl === source.mediaUrl && item.contentHash === source.sha256)
      || !composition.layers.some(layer => layer.opacity > 0)) return null;
    const sourceKey = parseGuestImageResultMediaUrl(source.mediaUrl), mediaKey = parseGuestImageResultMediaUrl(media.url);
    if (!sourceKey || !mediaKey || sourceKey.ownerId !== ownerId || mediaKey.ownerId !== ownerId
      || sourceKey.custodyId !== claim.custodyId || mediaKey.custodyId !== claim.custodyId
      || sourceKey.outputId !== data.outputId || mediaKey.outputId !== data.outputId || mediaKey.revisionId === null
      || (source.revision === 0 ? sourceKey.revisionId !== null : sourceKey.revisionId === null)
      || source.mediaUrl === media.url || expectedRevisionId !== undefined && (!claimUuid(expectedRevisionId) || mediaKey.revisionId !== expectedRevisionId)) return null;
    return claimedEditData({ schemaVersion: 2, operation: "composition", revision: data.revision, editEventId: data.editEventId,
      outputId: data.outputId, documentId: data.documentId, generationId: data.generationId, sourceEventId: data.sourceEventId,
      contentRef: data.contentRef, contentSha256: data.contentSha256,
      source: { revision: source.revision, eventId: source.eventId, mediaUrl: source.mediaUrl, sha256: source.sha256, width: source.width, height: source.height },
      media: { url: media.url, mediaType: "image/png", sha256: media.sha256, byteLength: media.byteLength, width: media.width, height: media.height },
      sourceId: data.sourceId, recipe: composition, recipeSha256: data.recipeSha256, operationSha256: data.operationSha256, claim }) as GuestImageResultRevision;
  } catch { return null; }
}

export async function guestImageResultEditOperationSha256(
  context: { ownerId: string; projectId: string; documentId: string; outputId: string }, value: unknown,
): Promise<string | null> {
  try {
    const scope = claimedEditData(context), request = parseGuestImageResultEditRequest(value);
    if (!row(scope) || !keys(scope, ["ownerId", "projectId", "documentId", "outputId"])
      || !claimUuid(scope.projectId) || !claimUuid(scope.documentId) || !request) return null;
    const media = parseGuestImageResultMediaUrl(request.sourceMediaUrl);
    if (!media || media.ownerId !== scope.ownerId || media.outputId !== scope.outputId) return null;
    return outputAssetSha256(new TextEncoder().encode(JSON.stringify({ domain: "guest-image-result-edit@1", ownerId: scope.ownerId,
      projectId: scope.projectId, documentId: scope.documentId, outputId: scope.outputId, request })));
  } catch { return null; }
}

/** Structural replay of a server-owned claimed edit. The supplied full review
 * must come from the current owner for read/edit use; event data alone cannot
 * establish that review's freshness or authority. */
export function projectGuestImageResultEdit(
  output: EditableGeneratedImageOutput, event: CreativeEvent,
  context: { ownerId: string; projectId: string; claim: GuestImageResultCompletedCustodyReview },
): EditableGeneratedImageOutput | null {
  try {
    const scope = claimedEditData(context), capturedEvent = claimedEditData(event);
    if (!row(scope) || !keys(scope, ["ownerId", "projectId", "claim"]) || !claimUuid(scope.projectId)
      || !row(capturedEvent) || !keys(capturedEvent, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId",
        "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"])
      || capturedEvent.schemaVersion !== 1 || !claimUuid(capturedEvent.correlationId) || capturedEvent.causationId !== null
      || capturedEvent.compensatesEventId !== null || !claimIso(capturedEvent.occurredAt)
      || capturedEvent.recordedAt !== capturedEvent.occurredAt || !row(capturedEvent.payload)) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(scope.claim), p = capturedEvent.payload;
    if (!keys(p, ["output_id", "object_id", "document_id", "project_id", "generation_id", "source_event_id", "content_ref", "content_sha256",
      "revision", "previous_revision", "previous_edit_event_id", "image_revision_id", "image_revision_sha256", "image_edit_operation_sha256",
      "media_url", "media_type", "source_content_hash", "image_width", "image_height", "image_byte_length", "source_surface", "edited_by_user_id", "claim"])) return null;
    const eventClaim = parseGuestImageResultCompletedCustodyReview(p.claim);
    const origin = parseGuestImageResultClaimEventOrigin(output.claimedOrigin), previous = output.imageRevision;
    const currentKey = parseGuestImageResultMediaUrl(output.mediaUrl), nextKey = parseGuestImageResultMediaUrl(p.media_url);
    if (!claim || !eventClaim || !sameClaim(claim, eventClaim) || !origin || origin.custodyId !== claim.custodyId
      || origin.claimEventId !== claim.claimEventId || origin.outputId !== output.id || origin.generationId !== output.generationId
      || output.sourceEventId !== claim.claimEventId || !claimRef(output.contentRef) || !claimUuid(output.documentId)
      || output.mediaType !== "image/png" || output.quality !== "high" || output.purpose !== "final" || output.discarded
      || !currentKey || currentKey.ownerId !== scope.ownerId || currentKey.custodyId !== claim.custodyId || currentKey.outputId !== output.id
      || (previous ? currentKey.revisionId !== previous.revisionId : currentKey.revisionId !== null)
      || !nextKey || nextKey.ownerId !== scope.ownerId || nextKey.custodyId !== claim.custodyId || nextKey.outputId !== output.id
      || !claimUuid(p.image_revision_id) || nextKey.revisionId !== p.image_revision_id || p.media_url === output.mediaUrl
      || capturedEvent.type !== "GeneratedImageEdited" || capturedEvent.actor !== "user" || capturedEvent.clientId !== "web:generated-image-editor"
      || capturedEvent.streamId !== `creative:${String(scope.ownerId)}` || !claimUuid(capturedEvent.eventId) || !uint(capturedEvent.sequence, 1)
      || capturedEvent.sequence <= (previous?.editSequence ?? output.sequence) || capturedEvent.eventId === output.sourceEventId
      || p.output_id !== output.id || p.object_id !== output.id || p.document_id !== output.documentId || p.project_id !== scope.projectId
      || p.generation_id !== output.generationId || p.source_event_id !== output.sourceEventId || p.content_ref !== output.contentRef
      || p.edited_by_user_id !== scope.ownerId || p.source_surface !== "generated-image-editor"
      || !uint(p.revision, 1) || p.revision !== (previous?.revision ?? 0) + 1 || p.previous_revision !== (previous?.revision ?? 0)
      || p.previous_edit_event_id !== (previous?.editEventId ?? null)
      || !sha(p.image_revision_sha256) || !sha(p.image_edit_operation_sha256) || !sha(p.content_sha256)
      || previous && p.content_sha256 !== previous.contentSha256 || p.media_type !== "image/png"
      || !sha(p.source_content_hash) || !dimension(p.image_width) || !dimension(p.image_height)
      || !uint(p.image_byte_length, 1) || p.image_byte_length > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) return null;
    return { ...output, mediaUrl: p.media_url as string, mediaType: "image/png", width: p.image_width, height: p.image_height, focalPoint: null,
      imageRevision: Object.freeze({ revision: p.revision, editEventId: capturedEvent.eventId, editSequence: capturedEvent.sequence,
        revisionId: p.image_revision_id, revisionSha256: p.image_revision_sha256, operationSha256: p.image_edit_operation_sha256,
        contentSha256: p.content_sha256, mediaSha256: p.source_content_hash, byteLength: p.image_byte_length }) };
  } catch { return null; }
}
