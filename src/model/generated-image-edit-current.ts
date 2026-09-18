import { projectGeneratedImageEdit, type EditableGeneratedImageOutput, type GeneratedImageEditSnapshot } from "./generated-image-revision.ts";
import { originalGeneratedImageUrl } from "./generated-image-original-url.ts";
import { foldEvents, type CreativeEvent } from "./events.ts";
import { referenceCompositionMediaUrl, referenceCompositionSources, referenceCompositionSourcesFingerprint, type ReferenceCompositionSource } from "./reference-composition.ts";
import { mediaKeyMatchesOwnerNamespace } from "./media-ownership.ts";
import { outputAssetSha256 } from "./output-asset-inspection.ts";
import { GENERATED_IMAGE_EDIT_LIMITS, type GeneratedImageEditBasis, type GeneratedImageEditCurrent } from "./generated-image-edit.ts";

/** Already-readable Store facts. This is not a transport parser or an access
 * grant; the owning Store retains authenticated read/source lifetime control. */
export type GeneratedImageEditRead = Readonly<{
  ownerId: string; projectId: string; documentId: string; outputId: string;
  events: readonly CreativeEvent[]; content: Readonly<Record<string, string>>;
  /** Current Store head, including events omitted by a workspace read profile.
   * Required by inspection/GET matching; legacy preparation capture may omit it. */
  head?: number;
}>;
export type CurrentGeneratedImageEdit = Readonly<{
  status: "captured"; sourceId: string; editEventId: string | null; basis: GeneratedImageEditBasis;
  sources: readonly ReferenceCompositionSource[];
  /** Synchronous rejoin for the existing preparation core's current callback. */
  current(): GeneratedImageEditCurrent | null;
}>;
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const refused = Object.freeze({ status: "unavailable" } as const);

function select(input: GeneratedImageEditRead | null, sourceId: string | null, now: number, requireHead = false) {
  if (!input || ![input.ownerId, input.projectId, input.documentId, input.outputId].every(token) || sourceId !== null && !token(sourceId)
    || !Array.isArray(input.events) || input.events.length > 50_000 || !input.content || typeof input.content !== "object"
    || !Number.isFinite(now)) return null;
  const stream = "creative:" + input.ownerId, events = [...input.events];
  if (events.some(event => !event || event.streamId !== stream || !token(event.eventId) || !integer(event.sequence, 1)
    || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))
    || new Set(events.map(event => event.eventId)).size !== events.length
    || events.some((event, index) => index > 0 && events[index - 1]!.sequence >= event.sequence)
    || (requireHead || input.head !== undefined) && (!integer(input.head) || input.head < (events.at(-1)?.sequence ?? 0))) return null;
  const aliases = events.filter(event => (event.type === "GenerationCompleted" || event.type === "IdeationPreviewCompleted")
    && (event.payload.object_id === input.outputId || Array.isArray(event.payload.object_ids) && event.payload.object_ids.includes(input.outputId)));
  if (aliases.length !== 1) return null;
  const event = aliases[0]!, p = event.payload;
  if (event.type !== "GenerationCompleted" || event.actor !== "worker:generator" || p.report_space === "scout"
    || p.document_id !== input.documentId || p.object_id !== input.outputId || !Array.isArray(p.object_ids)
    || p.object_ids.length !== 1 || p.object_ids[0] !== input.outputId || !token(p.generation_id)
    || !/^[A-Za-z0-9._-]+$/u.test(p.generation_id) || !token(p.output_ref)
    || p.media_type !== "image/png" || !digest(p.source_content_hash) || !integer(p.image_width, 1) || !integer(p.image_height, 1)
    || p.image_width > 16_384 || p.image_height > 16_384 || p.quality !== "high" || p.purpose !== "final" || p.simulation !== false
    || events.some(other => other !== event && ["GenerationCompleted", "IdeationPreviewCompleted"].includes(other.type)
      && other.payload.generation_id === p.generation_id)) return null;
  const originalMediaUrl = originalGeneratedImageUrl(input.ownerId,event);
  if (!originalMediaUrl) return null;
  if (p.content_expires_at != null) {
    if (typeof p.content_expires_at !== "string" || !(Date.parse(p.content_expires_at) > now)
      || new Date(p.content_expires_at).toISOString() !== p.content_expires_at) return null;
  }
  const raw = input.content[p.output_ref];
  if (typeof raw !== "string" || !raw.length || new TextEncoder().encode(raw).byteLength > GENERATED_IMAGE_EDIT_LIMITS.rawBytes) return null;
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) return null; } catch { return null; }
  const projection = foldEvents(events, Infinity, input.documentId, input.projectId);
  const document = projection.documents.find(value => value.id === input.documentId);
  if (!document || document.removed || document.projectId !== input.projectId || projection.documentId !== input.documentId) return null;
  const outputs = projection.libraryOutputs.filter(value => value.id === input.outputId);
  if (outputs.length !== 1) return null;
  const original = foldEvents(events.filter(value => value.type !== "GeneratedImageEdited"), Infinity, input.documentId, input.projectId)
    .libraryOutputs.find(value => value.id === input.outputId);
  if (!original) return null;
  let output: EditableGeneratedImageOutput = original;
  if (output.discarded || output.documentId !== input.documentId || output.sourceEventId !== event.eventId || output.sequence !== event.sequence
    || output.generationId !== p.generation_id || output.contentRef !== p.output_ref || output.mediaUrl !== originalMediaUrl
    || output.mediaType !== "image/png" || output.width !== p.image_width || output.height !== p.image_height) return null;
  for (const edit of events.filter(value => value.type === "GeneratedImageEdited" && (value.payload.output_id === input.outputId
    || value.payload.object_id === input.outputId || value.payload.source_event_id === event.eventId))) {
    const next = projectGeneratedImageEdit(output, edit, { ownerId: input.ownerId, projectId: input.projectId });
    if (!next) return null;
    output = next;
  }
  const projected = outputs[0]! as EditableGeneratedImageOutput;
  // The visible CreativeOutput must actually include the same current edit;
  // recognizing private history in a helper cannot substitute for projection.
  if (projected.mediaUrl !== output.mediaUrl || projected.width !== output.width || projected.height !== output.height
    || JSON.stringify(projected.imageRevision ?? null) !== JSON.stringify(output.imageRevision ?? null)) return null;
  const mediaUrl = output.mediaUrl!, mediaSha256 = output.imageRevision?.mediaSha256 ?? p.source_content_hash;
  const revision = output.imageRevision?.revision ?? 0, editEventId = output.imageRevision?.editEventId ?? null;
  // Only actual eligible reference blocks already present in this Document may
  // supply the compositor. A generated output alone does not create one.
  const sources = referenceCompositionSources(projection.libraryBlocks.filter(block => block.documentId === input.documentId
    && block.projectId === input.projectId), events, now).filter(source => {
    if (referenceCompositionMediaUrl(source.mediaUrl) !== source.mediaUrl) return false;
    try { return mediaKeyMatchesOwnerNamespace(decodeURIComponent(source.mediaUrl.slice("/api/media/".length)), input.ownerId); }
    catch { return false; }
  });
  if (sources.length > 128 || new Set(sources.map(source => source.id)).size !== sources.length) return null;
  const sourceIds = sources.filter(source => {
    if (source.kind !== "image" || source.requiresUnlock || source.mediaUrl !== mediaUrl || source.contentHash !== mediaSha256) return false;
    const block = projection.libraryBlocks.find(value => value.id === source.blockId);
    if (!block || block.type !== "reference" || !token(block.properties.reference_id)
      || block.properties.source_output_id !== input.outputId || block.properties.source_generation_id !== p.generation_id
      || block.properties.source_output_content_ref !== p.output_ref || block.properties.source_document_id !== input.documentId) return false;
    const receipt = [...events].reverse().find(value => value.type === "ReferenceIngested"
      && value.payload.reference_id === block.properties.reference_id)?.payload;
    return receipt?.source_type === "generated-output" && receipt.source_output_id === input.outputId
      && receipt.source_generation_id === p.generation_id && receipt.source_document_id === input.documentId
      && receipt.document_id === input.documentId && receipt.project_id === input.projectId;
  }).map(source => source.id);
  if (sourceId !== null && !sourceIds.includes(sourceId)) return null;
  return { ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId, outputId: input.outputId,
    generationId: p.generation_id, sourceEventId: event.eventId, sequence: event.sequence, contentRef: p.output_ref,
    rawJson: raw, mediaUrl, mediaSha256, width: output.width!, height: output.height!, revision, editEventId,
    expectedRawSha256: output.imageRevision?.contentSha256 ?? null,
    byteLength: output.imageRevision?.byteLength, head: input.head ?? events.at(-1)!.sequence,
    sources, sourceIds, sourceProof: referenceCompositionSourcesFingerprint(sources) };
}

/** Exact local identity for a current authoritative GET, including a legitimate
 * empty sourceIds roster before explicit adoption. This creates no reference
 * and does not prove transport authority or native raster provenance. */
function snapshotOf(selected: NonNullable<ReturnType<typeof select>>, contentSha256: string): GeneratedImageEditSnapshot {
  return { status: "current", ownerId: selected.ownerId, projectId: selected.projectId,
    documentId: selected.documentId, outputId: selected.outputId, generationId: selected.generationId, sourceEventId: selected.sourceEventId,
    contentRef: selected.contentRef, contentSha256, rawJson: selected.rawJson, revision: selected.revision, editEventId: selected.editEventId,
    media: { url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256, width: selected.width, height: selected.height,
      ...(selected.byteLength === undefined ? {} : { byteLength: selected.byteLength }) },
    sources: selected.sources.map(source => ({ ...source })), sourceIds: [...selected.sourceIds], head: selected.head };
}

export async function inspectCurrentGeneratedImageEdit(
  read: () => GeneratedImageEditRead | null, now: () => number = Date.now,
): Promise<Readonly<GeneratedImageEditSnapshot> | typeof refused> {
  try {
    const selected = select(read(), null, now(), true);
    if (!selected) return refused;
    // Keep the complete returned roster (including labels) stable across the
    // digest, rather than checking only the compositor's semantic fingerprint.
    const proof = JSON.stringify(selected);
    const contentSha256 = await outputAssetSha256(new TextEncoder().encode(selected.rawJson));
    const current = select(read(), null, now(), true);
    if (!current || JSON.stringify(current) !== proof || selected.expectedRawSha256 !== null && selected.expectedRawSha256 !== contentSha256) return refused;
    const snapshot = snapshotOf(selected, contentSha256);
    Object.freeze(snapshot.media); snapshot.sources.forEach(Object.freeze); Object.freeze(snapshot.sources); Object.freeze(snapshot.sourceIds);
    return Object.freeze(snapshot);
  } catch { return refused; }
}

// Traverse only the already bounded expected structure. Extra keys, symbols,
// accessors, holes and custom prototypes are not accepted transport data.
function equalSnapshotData(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(expected) !== Array.isArray(actual)) return false;
  const prototype = Object.getPrototypeOf(actual);
  if (Array.isArray(actual) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(actual), keys = Reflect.ownKeys(descriptors), expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !Object.hasOwn(expected, key))) return false;
  return expectedKeys.every(key => {
    const descriptor = descriptors[key as string];
    return descriptor && "value" in descriptor && (key === "length" && Array.isArray(expected) || descriptor.enumerable)
      && equalSnapshotData(descriptor.value, (expected as Record<string, unknown>)[key as string]);
  });
}

/** Reject a GET response that differs from the exact current local projection,
 * private raw string, source roster or explicit Store head. Return only our
 * independently rebuilt frozen copy, never the caller's response object. */
export async function matchGeneratedImageEditSnapshot(
  snapshot: unknown, read: () => GeneratedImageEditRead | null, now: () => number = Date.now,
): Promise<Readonly<GeneratedImageEditSnapshot> | typeof refused> {
  try {
    const current = await inspectCurrentGeneratedImageEdit(read, now);
    if (current.status !== "current" || !equalSnapshotData(snapshot, current)) return refused;
    // Reflection on an untrusted response can itself reenter the Store. Rejoin
    // after comparison as well as across the digest before publishing a copy.
    const final = select(read(), null, now(), true);
    return final && (final.expectedRawSha256 === null || final.expectedRawSha256 === current.contentSha256)
      && equalSnapshotData(snapshotOf(final, current.contentSha256), current) ? current : refused;
  } catch { return refused; }
}

/** Capture the original output plus its contiguous server-edited projection.
 * Revision zero is explicit initial state, never generation sequence or
 * ObjectSaved. Private row/authority validation remains with Store and API. */
export async function captureCurrentGeneratedImageEdit(
  read: () => GeneratedImageEditRead | null, sourceId: string, now: () => number = Date.now,
): Promise<CurrentGeneratedImageEdit | typeof refused> {
  try {
    const selected = select(read(), sourceId, now());
    if (!selected) return refused;
    const { sources, head: omittedHead, ...identity } = selected; void omittedHead;
    const proof = JSON.stringify(identity);
    const contentSha256 = await outputAssetSha256(new TextEncoder().encode(selected.rawJson));
    const matches = () => {
      try { const value = select(read(), sourceId, now()); if (!value) return false;
        const { sources: omitted, head: omittedCurrentHead, ...current } = value; void omitted; void omittedCurrentHead; return JSON.stringify(current) === proof;
      } catch { return false; }
    };
    if (!matches() || selected.expectedRawSha256 !== null && selected.expectedRawSha256 !== contentSha256) return refused;
    const basis: GeneratedImageEditBasis = Object.freeze({ kind: "generated-image", ownerId: selected.ownerId, documentId: selected.documentId,
      outputId: selected.outputId, generationId: selected.generationId, sourceEventId: selected.sourceEventId, contentRef: selected.contentRef,
      revision: selected.revision, rawJson: selected.rawJson, contentSha256,
      media: Object.freeze({ url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256, width: selected.width, height: selected.height }) });
    const capturedSources = Object.freeze(sources.map(source => Object.freeze({ ...source })));
    const captured = Object.freeze({ basis, sources: capturedSources });
    let retired = false;
    return Object.freeze({ status: "captured", sourceId, editEventId: selected.editEventId, basis, sources: capturedSources,
      current() { if (retired || !matches()) { retired = true; return null; } return captured; } });
  } catch { return refused; }
}
