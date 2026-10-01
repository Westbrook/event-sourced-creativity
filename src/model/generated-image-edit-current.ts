import { foldEvents, type CreativeEvent } from "./events.ts";
import { referenceCompositionSources, referenceCompositionSourcesFingerprint, type ReferenceCompositionSource } from "./reference-composition.ts";
import { ownerMediaNamespace } from "./media-ownership.ts";
import { outputAssetSha256 } from "./output-asset-inspection.ts";
import { GENERATED_IMAGE_EDIT_LIMITS, type GeneratedImageEditBasis, type GeneratedImageEditCurrent } from "./generated-image-edit.ts";

/** Already-readable Store facts. This is not a transport parser or an access
 * grant; the owning Store retains authenticated read/source lifetime control. */
export type GeneratedImageEditRead = Readonly<{
  ownerId: string; projectId: string; documentId: string; outputId: string;
  events: readonly CreativeEvent[]; content: Readonly<Record<string, string>>;
}>;
export type CurrentGeneratedImageEdit = Readonly<{
  status: "captured"; sourceId: string; basis: GeneratedImageEditBasis;
  sources: readonly ReferenceCompositionSource[];
  /** Synchronous rejoin for the existing preparation core's current callback. */
  current(): GeneratedImageEditCurrent | null;
}>;
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const refused = Object.freeze({ status: "unavailable" } as const);

function select(input: GeneratedImageEditRead | null, sourceId: string, now: number) {
  if (!input || ![input.ownerId, input.projectId, input.documentId, input.outputId, sourceId].every(token)
    || !Array.isArray(input.events) || input.events.length > 50_000 || !input.content || typeof input.content !== "object"
    || !Number.isFinite(now)) return null;
  const stream = "creative:" + input.ownerId, events = [...input.events];
  if (events.some(event => !event || event.streamId !== stream || !token(event.eventId) || !integer(event.sequence, 1)
    || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))
    || new Set(events.map(event => event.eventId)).size !== events.length
    || events.some((event, index) => index > 0 && events[index - 1]!.sequence >= event.sequence)) return null;
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
  const mediaUrl = "/api/media/" + encodeURIComponent(ownerMediaNamespace(input.ownerId) + "/generated/" + p.generation_id + ".png");
  if (p.media_url !== mediaUrl) return null;
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
  const output = outputs[0]!;
  if (output.discarded || output.documentId !== input.documentId || output.sourceEventId !== event.eventId || output.sequence !== event.sequence
    || output.generationId !== p.generation_id || output.contentRef !== p.output_ref || output.mediaUrl !== mediaUrl
    || output.mediaType !== "image/png" || output.width !== p.image_width || output.height !== p.image_height) return null;
  // Only actual eligible reference blocks already present in this Document may
  // supply the compositor. A generated output alone does not create one.
  const sources = referenceCompositionSources(projection.libraryBlocks.filter(block => block.documentId === input.documentId
    && block.projectId === input.projectId), events, now);
  const matching = sources.filter(source => source.id === sourceId);
  if (matching.length !== 1 || matching[0]!.kind !== "image" || matching[0]!.requiresUnlock
    || matching[0]!.mediaUrl !== mediaUrl || matching[0]!.contentHash !== p.source_content_hash) return null;
  const block = projection.libraryBlocks.find(value => value.id === matching[0]!.blockId);
  if (!block || block.type !== "reference" || !token(block.properties.reference_id)
    || block.properties.source_output_id !== input.outputId || block.properties.source_generation_id !== p.generation_id
    || block.properties.source_output_content_ref !== p.output_ref || block.properties.source_document_id !== input.documentId) return null;
  const receipt = [...events].reverse().find(value => value.type === "ReferenceIngested"
    && value.payload.reference_id === block.properties.reference_id)?.payload;
  if (!receipt || receipt.source_type !== "generated-output" || receipt.source_output_id !== input.outputId
    || receipt.source_generation_id !== p.generation_id || receipt.source_document_id !== input.documentId
    || receipt.document_id !== input.documentId || receipt.project_id !== input.projectId) return null;
  return { ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId, outputId: input.outputId,
    generationId: p.generation_id, sourceEventId: event.eventId, sequence: event.sequence, contentRef: p.output_ref,
    rawJson: raw, mediaUrl, mediaSha256: p.source_content_hash, width: p.image_width, height: p.image_height,
    sources, sourceProof: referenceCompositionSourcesFingerprint(sources) };
}

/** Capture the existing, unedited GenerationCompleted output. Revision zero is
 * explicit initial state, not generation sequence, ObjectSaved or approval.
 * Actual edited-image history requires its own later authoritative integration. */
export async function captureCurrentGeneratedImageEdit(
  read: () => GeneratedImageEditRead | null, sourceId: string, now: () => number = Date.now,
): Promise<CurrentGeneratedImageEdit | typeof refused> {
  try {
    const selected = select(read(), sourceId, now());
    if (!selected) return refused;
    const { sources, ...identity } = selected;
    const proof = JSON.stringify(identity);
    const contentSha256 = await outputAssetSha256(new TextEncoder().encode(selected.rawJson));
    const matches = () => {
      try { const value = select(read(), sourceId, now()); if (!value) return false;
        const { sources: omitted, ...current } = value; void omitted; return JSON.stringify(current) === proof;
      } catch { return false; }
    };
    if (!matches()) return refused;
    const basis: GeneratedImageEditBasis = Object.freeze({ kind: "generated-image", ownerId: selected.ownerId, documentId: selected.documentId,
      outputId: selected.outputId, generationId: selected.generationId, sourceEventId: selected.sourceEventId, contentRef: selected.contentRef,
      revision: 0, rawJson: selected.rawJson, contentSha256,
      media: Object.freeze({ url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256, width: selected.width, height: selected.height }) });
    const capturedSources = Object.freeze(sources.map(source => Object.freeze({ ...source })));
    const captured = Object.freeze({ basis, sources: capturedSources });
    let retired = false;
    return Object.freeze({ status: "captured", sourceId, basis, sources: capturedSources,
      current() { if (retired || !matches()) { retired = true; return null; } return captured; } });
  } catch { return refused; }
}
