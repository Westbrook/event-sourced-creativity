import { projectGeneratedImageEdit, projectGuestImageResultEdit, type EditableGeneratedImageOutput, type GeneratedImageEditSnapshot, type GuestImageResultEditSnapshot } from "./generated-image-revision.ts";
import { originalGeneratedImageUrl } from "./generated-image-original-url.ts";
import { foldEvents, type CreativeEvent, type CreativeBlock } from "./events.ts";
import { referenceCompositionMediaUrl, referenceCompositionSources, referenceCompositionSourcesFingerprint, type ReferenceCompositionSource } from "./reference-composition.ts";
import { mediaKeyMatchesOwnerNamespace } from "./media-ownership.ts";
import { outputAssetSha256 } from "./output-asset-inspection.ts";
import { GENERATED_IMAGE_EDIT_LIMITS, parseGuestImageResultCompletedCustodyReview, parseGuestImageResultMediaUrl,
  type GeneratedImageEditBasis, type GeneratedImageEditCurrent, type GuestImageResultCompletedCustodyReview,
  type GuestImageResultEditBasis, type GuestImageResultEditCurrent } from "./generated-image-edit.ts";
import { parseGuestImageResultClaimEvent, type GuestImageResultClaimPresentation } from "./guest-image-result-presentation.ts";
import { creativeContextRightsIssue } from "./context-health.ts";

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

/** Opening-owned readable facts only. No generic private-content map, selector,
 * or parsed review creates current custody or permission to read these bytes. */
export type GuestImageResultEditRead = Readonly<{
  ownerId: string; projectId: string; documentId: string; outputId: string;
  events: readonly CreativeEvent[]; head: number;
  planner: Readonly<{ contentRef: string; rawJson: string; expiresAt: string; claim: GuestImageResultCompletedCustodyReview }>;
}>;
/** Body-free association facts from an owning completed-custody reader.
 * contentDigest is the proved qualified canonical planner-copy digest. It is
 * not the raw planner-text hash used by the strict editor. This type grants
 * no storage or edit access. */
export type GuestImageResultMetadataRead = Readonly<{
  ownerId: string; projectId: string; documentId: string; outputId: string;
  events: readonly CreativeEvent[]; head: number;
  planner: Readonly<{ contentRef: string; contentDigest: string; expiresAt: string; claim: GuestImageResultCompletedCustodyReview }>;
}>;
/** Inert equality material, not a strict edit snapshot. Original revision zero
 * has no observed raw planner hash. A later projected hash must still be joined
 * to the genuine retained origin/revision chain by the owning native reader. */
export type GuestImageResultMetadataSnapshot = Readonly<Omit<GuestImageResultEditSnapshot, "rawJson" | "contentSha256"> & {
  contentSha256: string | null;
}>;
export type GuestImageResultLocalPair = Readonly<{
  sourceId: string; blockId: string; referenceId: string; receiptEventId: string; creationEventId: string;
  sourceExpiresAt: string; locked: boolean; sourceEvents: readonly string[];
  source: Readonly<ReferenceCompositionSource>;
  /** Exact receipt/creation/current-properties/lock/sourceEvents equality data,
   * not a signature, private read receipt, or mutation capability. */
  proof: string;
}>;
export type GuestImageResultMetadataFacts = Readonly<{
  status: "current"; snapshot: GuestImageResultMetadataSnapshot;
  title: string; plannerExpiresAt: string; contentExpiresAt: string;
  localPair: GuestImageResultLocalPair | null;
}>;
type GuestImageResultMetadataSelectionRead = Omit<GuestImageResultMetadataRead, "planner"> & Readonly<{
  planner: Omit<GuestImageResultMetadataRead["planner"], "contentDigest">;
}>;
export type CurrentGuestImageResultEdit = Readonly<{
  status: "captured"; sourceId: string; editEventId: string | null; basis: GuestImageResultEditBasis;
  sources: readonly ReferenceCompositionSource[];
  current(): GuestImageResultEditCurrent | null;
}>;
type ClaimedRow = Record<string, unknown>;
const claimedUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const claimedIso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
function claimedData(value: unknown, keys?: readonly string[]): value is ClaimedRow {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  return (!keys || names.length === keys.length && keys.every(key => Object.hasOwn(descriptors, key)))
    && names.every(key => typeof key === "string" && descriptors[key]!.enumerable && Object.hasOwn(descriptors[key]!, "value"));
}
function sameClaim(actual: unknown, expected: GuestImageResultCompletedCustodyReview): boolean {
  const parsed = parseGuestImageResultCompletedCustodyReview(actual);
  return parsed !== null && equalSnapshotData(parsed, expected);
}
function reservedClaimedMedia(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.startsWith("/api/media/") ? value.slice("/api/media/".length) : value;
  const family = "guest-image-result-media-v1";
  if (raw === family || raw.startsWith(family + "/") || raw.toLowerCase().startsWith(family + "%2f")) return true;
  try { const key = decodeURIComponent(raw); return key === family || key.startsWith(family + "/"); } catch { return false; }
}
function claimedLocalMarker(value: unknown): boolean {
  return claimedData(value) && (Object.hasOwn(value, "claim") || value.source_type === "claimed-generated-output"
    || value.operation_scope === "local-image-composition" || reservedClaimedMedia(value.media_url) || reservedClaimedMedia(value.source_ref));
}
const localReceiptKeys = ["project_id", "document_id", "source_surface", "reference_id", "source_type", "operation_scope", "source_ref", "media_url", "media_type",
  "content_hash", "rights_class", "source_output_id", "source_generation_id", "source_document_id", "source_event_id", "source_revision", "source_edit_event_id",
  "source_content_ref", "source_prompt_ref", "claim", "source_expires_at", "provider", "model_id", "source_rights_digest"] as const;
const localPropertyKeys = ["reference_id", "label", "media_url", "media_type", "source_mime_type", "source_content_hash", "width", "height", "source_output_id",
  "source_generation_id", "source_document_id", "source_event_id", "source_output_content_ref", "source_output_prompt_ref", "source_revision", "source_edit_event_id",
  "claim", "operation_scope", "source_type", "rights_class", "source_expires_at", "pixel_reference_mode", "intent", "authority", "weight", "created_from", "source_rights_digest"] as const;
const localHeaderKeys = ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"] as const;
function localHeader(event: CreativeEvent, ownerId: string, type: string): boolean {
  return claimedData(event, localHeaderKeys) && event.type === type && claimedUuid(event.eventId) && claimedUuid(event.correlationId)
    && event.streamId === "creative:" + ownerId && event.actor === "user" && event.clientId === "server:guest-image-local-context"
    && event.schemaVersion === 1 && event.causationId === null && event.compensatesEventId === null
    && integer(event.sequence, 1) && claimedIso(event.occurredAt) && event.recordedAt === event.occurredAt;
}
/** Persisted legacy block IDs use String(), while rights consumers also trim
 * string IDs. Match their JSON scalar/array aliases without invoking hooks.
 * This only detects contradictory history; it never qualifies an alias pair. */
function claimedHistoryId(value: unknown): string | null {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): string | null => {
    if (++nodes > 4096 || depth > 24) return null;
    if (item === null || item === undefined || ["string", "number", "boolean"].includes(typeof item)) return String(item);
    if (!Array.isArray(item) || Object.getPrototypeOf(item) !== Array.prototype || seen.has(item)
      || Object.hasOwn(item, "toString") || Object.hasOwn(item, "join") || Object.hasOwn(item, Symbol.toPrimitive)) return null;
    const length = Object.getOwnPropertyDescriptor(item, "length");
    if (!length || !Object.hasOwn(length, "value") || !integer(length.value) || length.value > 4096) return null;
    seen.add(item); const parts: string[] = [];
    for (let index = 0; index < length.value; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
      if (descriptor && !Object.hasOwn(descriptor, "value")) return null;
      const child = descriptor?.value, part = child === null || child === undefined ? "" : visit(child, depth + 1);
      if (part === null) return null;
      parts.push(part);
    }
    seen.delete(item); return parts.join(",");
  };
  return visit(value, 0);
}
// Indeterminate bounded legacy identities may alias the source. Refuse them
// in relevant history instead of treating a parse limit as proof of absence.
function claimedHistoryMatches(value: unknown, expected: string): boolean {
  const id = claimedHistoryId(value); return id === null || id === expected;
}
function claimedReferenceIdMatches(value: unknown, expected: string): boolean {
  const id = claimedHistoryId(value); return id === null || id.trim() === expected;
}
function claimedPropertyMatches(value: unknown, properties: ReadonlySet<string>): boolean {
  const id = claimedHistoryId(value); return id === null || properties.has(id);
}
type ClaimedLocalContext = Readonly<{
  ownerId: string; projectId: string; documentId: string; outputId: string; origin: GuestImageResultClaimPresentation;
  claim: GuestImageResultCompletedCustodyReview; mediaUrl: string; mediaSha256: string; width: number; height: number;
  revision: number; editEventId: string | null; editSequence: number; expiresAt: string;
}>;
/** Pure exact local-pair join. A rights label alone never supplies this source.
 * The owning reader separately proves the current revision's native retention. */
function claimedLocalSource(block: CreativeBlock, events: readonly CreativeEvent[], context: ClaimedLocalContext, now: number) {
  if (block.type !== "reference" || block.scope !== "document" || block.removed || block.projectId !== context.projectId
    || block.documentId !== context.documentId || !claimedUuid(block.id) || !claimedData(block.properties)) return null;
  const current = block.properties, ref = current.reference_id;
  if (!claimedUuid(ref)) return null;
  const creations = events.filter(event => event.type === "BlockCreated" && claimedHistoryMatches(event.payload.block_id, block.id));
  const references = events.filter(event => event.type === "ReferenceIngested" && claimedReferenceIdMatches(event.payload.reference_id, ref));
  if (creations.length !== 1 || references.length !== 1 || events.some(event => event.type === "RightsAsserted" && claimedReferenceIdMatches(event.payload.reference_id, ref))
    || events.filter(event => event.type === "BlockCreated" && claimedData(event.payload.properties) && claimedReferenceIdMatches(event.payload.properties.reference_id, ref)).length !== 1) return null;
  const creation = creations[0]!, receipt = references[0]!, b = creation.payload, r = receipt.payload, initial = b.properties;
  if (!localHeader(receipt, context.ownerId, "ReferenceIngested") || !localHeader(creation, context.ownerId, "BlockCreated")
    || creation.sequence !== receipt.sequence + 1 || creation.correlationId !== receipt.correlationId || creation.eventId === receipt.eventId
    || receipt.sequence <= context.editSequence || receipt.recordedAt < context.origin.recordedAt || creation.recordedAt < receipt.recordedAt
    || Date.parse(creation.recordedAt) > now || !claimedData(r, localReceiptKeys)
    || !claimedData(b, ["project_id", "document_id", "source_surface", "block_id", "type", "scope", "handle", "position", "properties"])
    || !claimedData(initial, localPropertyKeys) || b.block_id !== block.id || b.project_id !== context.projectId || b.document_id !== context.documentId
    || b.source_surface !== "generated-image-editor" || b.type !== "reference" || b.scope !== "document"
    || b.handle !== `reference/claimed-${context.outputId.slice(-8)}-r${context.revision}` || !token(b.position)
    || typeof initial.label !== "string" || initial.label.length > 160 || initial.label !== initial.label.trim()
    || initial.weight !== 0.8 || events.some(event => event.sequence > creation.sequence && event.type === "BlockRehomed" && claimedHistoryMatches(event.payload.block_id, block.id))) return null;
  const p = context.origin.payload;
  const receiptValues: ClaimedRow = { project_id: context.projectId, document_id: context.documentId, source_surface: "generated-image-editor",
    reference_id: ref, source_type: "claimed-generated-output", operation_scope: "local-image-composition", source_ref: context.mediaUrl, media_url: context.mediaUrl,
    media_type: "image/png", content_hash: context.mediaSha256, rights_class: "owned", source_output_id: context.outputId,
    source_generation_id: p.generation_id, source_document_id: context.documentId, source_event_id: context.origin.eventId, source_revision: context.revision,
    source_edit_event_id: context.editEventId, source_content_ref: p.output_ref, source_prompt_ref: p.prompt_ref, provider: p.provider,
    model_id: p.model_id, source_rights_digest: p.source_rights_digest };
  if (Object.entries(receiptValues).some(([key, value]) => r[key] !== value) || !sameClaim(r.claim, context.claim)
    || !claimedIso(r.source_expires_at) || Date.parse(r.source_expires_at) <= now || r.source_expires_at > context.expiresAt
    || context.revision === 0 && r.source_expires_at !== context.expiresAt || r.source_expires_at <= creation.recordedAt) return null;
  const propertyValues: ClaimedRow = { reference_id: ref, media_url: context.mediaUrl, media_type: "image/png", source_mime_type: "image/png",
    source_content_hash: context.mediaSha256, width: context.width, height: context.height, source_output_id: context.outputId,
    source_generation_id: p.generation_id, source_document_id: context.documentId, source_event_id: context.origin.eventId,
    source_output_content_ref: p.output_ref, source_output_prompt_ref: p.prompt_ref, source_revision: context.revision, source_edit_event_id: context.editEventId,
    operation_scope: "local-image-composition", source_type: "claimed-generated-output", rights_class: "owned", source_expires_at: r.source_expires_at,
    pixel_reference_mode: "context_only", intent: "include", authority: "authored", created_from: "generated-image-editor", source_rights_digest: p.source_rights_digest };
  const immutableProperties = new Set([...Object.keys(propertyValues), "claim"]);
  if (events.some(event => event.sequence > creation.sequence && claimedHistoryMatches(event.payload.block_id, block.id) && (
    event.type === "BlockPropertyEdited" && (claimedHistoryMatches(event.payload.property_path, "type") || claimedPropertyMatches(event.payload.property_path, immutableProperties))
    || event.type === "ChipEdited" && claimedPropertyMatches(event.payload.property, immutableProperties)
    || event.type === "ExtractionCompleted" && Array.isArray(event.payload.chips)
      && event.payload.chips.some(chip => claimedData(chip) && claimedPropertyMatches(chip.property, immutableProperties))))) return null;
  if (Object.entries(propertyValues).some(([key, value]) => initial[key] !== value || current[key] !== value)
    || !sameClaim(initial.claim, context.claim) || !sameClaim(current.claim, context.claim) || current.active === false
    || typeof current.weight !== "number" || !Number.isFinite(current.weight) || current.weight <= 0 || current.weight > 1
    || typeof current.label !== "string" || current.label.length > 160 || creativeContextRightsIssue(current, now)) return null;
  const source: ReferenceCompositionSource = { id: `${block.id}:image`, blockId: block.id, label: current.label.trim() || block.handle,
    mediaUrl: context.mediaUrl, contentHash: context.mediaSha256, kind: "image", ...(block.locked ? { requiresUnlock: true } : {}) };
  return { source, proof: JSON.stringify({ receipt, creation, current, locked: block.locked, sourceEvents: block.sourceEvents }),
    referenceId: ref, receiptEventId: receipt.eventId, creationEventId: creation.eventId,
    sourceExpiresAt: r.source_expires_at, locked: block.locked, sourceEvents: block.sourceEvents };
}

/** Shared full-history selection only. The edit wrapper separately requires
 * and hashes its real planner body; metadata inspection never supplies one. */
function selectGuestImageResultMetadataCore(input: GuestImageResultMetadataSelectionRead | null, sourceId: string | null, now: number) {
  if (!claimedData(input, ["ownerId", "projectId", "documentId", "outputId", "events", "head", "planner"])
    || typeof input.ownerId !== "string" || ![input.projectId, input.documentId, input.outputId].every(token) || sourceId !== null && !token(sourceId)
    || !Array.isArray(input.events) || input.events.length > 50_000 || !Number.isFinite(now) || !integer(input.head)
    || !claimedData(input.planner, ["contentRef", "expiresAt", "claim"])) return null;
  const planner = input.planner, claim = parseGuestImageResultCompletedCustodyReview(planner.claim), events = [...input.events];
  if (!claim || !claimedIso(planner.expiresAt) || Date.parse(planner.expiresAt) <= now
    || events.some(event => !claimedData(event) || !claimedData(event.payload) || event.streamId !== "creative:" + input.ownerId
      || !token(event.eventId) || !integer(event.sequence, 1))
    || new Set(events.map(event => event.eventId)).size !== events.length
    || events.some((event, index) => index > 0 && events[index - 1]!.sequence >= event.sequence)
    || input.head < (events.at(-1)?.sequence ?? 0)) return null;
  const selected = events.filter(event => event.eventId === claim.claimEventId);
  if (selected.length !== 1) return null;
  const origin = parseGuestImageResultClaimEvent(selected[0]);
  if (!origin || origin.payload.custody_id !== claim.custodyId || origin.payload.object_id !== input.outputId
    || origin.payload.document_id !== input.documentId || origin.payload.project_id !== input.projectId
    || origin.payload.output_ref !== planner.contentRef || origin.payload.content_expires_at > planner.expiresAt
    || Date.parse(origin.payload.content_expires_at) <= now || Date.parse(origin.recordedAt) > now) return null;
  const p = origin.payload, projection = foldEvents(events, Infinity, input.documentId, input.projectId);
  const document = projection.documents.find(value => value.id === input.documentId);
  if (!document || document.removed || document.projectId !== input.projectId || projection.documentId !== input.documentId || projection.projectId !== input.projectId) return null;
  const visible = projection.libraryOutputs.filter(value => value.id === input.outputId);
  const originals = foldEvents(events.filter(event => event.type !== "GeneratedImageEdited"), Infinity, input.documentId, input.projectId)
    .libraryOutputs.filter(value => value.id === input.outputId);
  if (visible.length !== 1 || originals.length !== 1) return null;
  let output: EditableGeneratedImageOutput = originals[0]!;
  if (output.discarded || output.documentId !== input.documentId || output.sourceEventId !== origin.eventId || output.sequence !== origin.sequence
    || output.generationId !== p.generation_id || output.contentRef !== p.output_ref || output.promptRef !== p.prompt_ref
    || output.mediaUrl !== p.media_url || output.mediaType !== "image/png" || output.width !== p.image_width || output.height !== p.image_height
    || !equalSnapshotData(output.claimedOrigin, p.claimed_origin)) return null;
  for (const event of events.filter(event => event.type === "GeneratedImageEdited" && (event.payload.output_id === input.outputId
    || event.payload.object_id === input.outputId || event.payload.source_event_id === origin.eventId
    || claimedData(event.payload.claim) && (event.payload.claim.claimEventId === claim.claimEventId || event.payload.claim.custodyId === claim.custodyId)))) {
    const next = projectGuestImageResultEdit(output, event, { ownerId: input.ownerId, projectId: input.projectId, claim });
    if (!next) return null;
    output = next;
  }
  // Keep the visible fold join. A private helper must not invent a current edit
  // before the separately allocated model dispatcher can display it.
  const projected = visible[0]!;
  if (projected.discarded || projected.mediaUrl !== output.mediaUrl || projected.mediaType !== output.mediaType
    || projected.width !== output.width || projected.height !== output.height || !equalSnapshotData(projected.claimedOrigin, output.claimedOrigin)
    || !equalSnapshotData(projected.imageRevision ?? null, output.imageRevision ?? null)) return null;
  const mediaUrl = output.mediaUrl, parsedMedia = parseGuestImageResultMediaUrl(mediaUrl);
  if (!mediaUrl || !parsedMedia || parsedMedia.ownerId !== input.ownerId || parsedMedia.custodyId !== claim.custodyId || parsedMedia.outputId !== input.outputId
    || parsedMedia.revisionId !== (output.imageRevision?.revisionId ?? null)) return null;
  const revision = output.imageRevision?.revision ?? 0, editEventId = output.imageRevision?.editEventId ?? null;
  const mediaSha256 = output.imageRevision?.mediaSha256 ?? p.source_content_hash;
  const localContext: ClaimedLocalContext = { ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId, outputId: input.outputId,
    origin, claim, mediaUrl, mediaSha256, width: output.width!, height: output.height!, revision, editEventId,
    editSequence: output.imageRevision?.editSequence ?? origin.sequence, expiresAt: p.content_expires_at };
  const blocks = projection.libraryBlocks.filter(block => block.documentId === input.documentId && block.projectId === input.projectId);
  const markedBlocks = new Set<string>(), markedReferences = new Set<string>();
  for (const event of events) {
    const data = event.type === "BlockCreated" ? event.payload.properties : event.type === "ReferenceIngested" || event.type === "RightsAsserted" ? event.payload : null;
    if (!claimedLocalMarker(data) || !claimedData(data)) continue;
    if (typeof event.payload.block_id === "string") markedBlocks.add(event.payload.block_id);
    if (typeof data.reference_id === "string") markedReferences.add(data.reference_id);
  }
  const ordinaryBlocks = blocks.filter(block => !markedBlocks.has(block.id) && !claimedLocalMarker(block.properties)
    && !markedReferences.has(String(block.properties.reference_id ?? "")));
  const ordinary = referenceCompositionSources(ordinaryBlocks, events, now).filter(source => {
    if (reservedClaimedMedia(source.mediaUrl) || referenceCompositionMediaUrl(source.mediaUrl) !== source.mediaUrl) return false;
    try { return mediaKeyMatchesOwnerNamespace(decodeURIComponent(source.mediaUrl.slice("/api/media/".length)), input.ownerId); } catch { return false; }
  });
  const localBlocks = blocks.filter(block => markedBlocks.has(block.id) || claimedLocalMarker(block.properties)
    || markedReferences.has(String(block.properties.reference_id ?? "")));
  if (localBlocks.length > 128) return null;
  const local = localBlocks.map(block => claimedLocalSource(block, events, localContext, now)).filter((value): value is NonNullable<typeof value> => value !== null);
  // The deliberate adoption protocol owns one exact current pair. Ambiguous
  // duplicates never become two interchangeable references to the same output.
  if (local.length > 1) return null;
  const sources = [...ordinary, ...local.map(value => value.source)];
  if (sources.length > 128 || new Set(sources.map(source => source.id)).size !== sources.length) return null;
  const sourceIds = local.filter(value => !value.source.requiresUnlock).map(value => value.source.id);
  if (sourceId !== null && !sourceIds.includes(sourceId)) return null;
  return { ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId, outputId: input.outputId,
    generationId: p.generation_id, sourceEventId: origin.eventId, sequence: origin.sequence, contentRef: p.output_ref,
    plannerExpiresAt: planner.expiresAt, contentExpiresAt: p.content_expires_at, claim,
    mediaUrl, mediaSha256, width: output.width!, height: output.height!, revision, editEventId,
    expectedRawSha256: output.imageRevision?.contentSha256 ?? null, byteLength: output.imageRevision?.byteLength ?? p.image_byte_length,
    head: input.head, sources, sourceIds, sourceProof: JSON.stringify({ ordinary: referenceCompositionSourcesFingerprint(ordinary), local: local.map(value => value.proof) }),
    title: projected.title ?? "", localPair: local[0] ?? null };
}
function selectGuestImageResultEdit(input: GuestImageResultEditRead | null, sourceId: string | null, now: number) {
  if (!claimedData(input, ["ownerId", "projectId", "documentId", "outputId", "events", "head", "planner"])
    || !claimedData(input.planner, ["contentRef", "rawJson", "expiresAt", "claim"])) return null;
  const planner = input.planner;
  if (typeof planner.rawJson !== "string" || !planner.rawJson.length
    || new TextEncoder().encode(planner.rawJson).byteLength > GENERATED_IMAGE_EDIT_LIMITS.rawBytes || !planner.rawJson.isWellFormed()) return null;
  try { if (!claimedData(JSON.parse(planner.rawJson))) return null; } catch { return null; }
  const selected = selectGuestImageResultMetadataCore({ ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId,
    outputId: input.outputId, events: input.events, head: input.head,
    planner: { contentRef: planner.contentRef, expiresAt: planner.expiresAt, claim: planner.claim } }, sourceId, now);
  if (!selected) return null;
  // Keep metadata-only display/reuse facts outside the existing edit snapshot
  // and edit equality material. Existing real-body hash/rejoin checks follow.
  const { title, localPair, ...edit } = selected; void title; void localPair;
  return { ...edit, rawJson: planner.rawJson };
}

/** Explicit body-free inspection over complete immutable history. Its caller
 * owns the original Request, canonical association/hash proof, required native
 * revision retention and media qualification. No edit snapshot is invented. */
export function inspectCurrentGuestImageResultMetadata(
  read: () => GuestImageResultMetadataRead | null, now: () => number = Date.now,
): GuestImageResultMetadataFacts | typeof refused {
  try {
    const input = read();
    if (!claimedData(input, ["ownerId", "projectId", "documentId", "outputId", "events", "head", "planner"])
      || !claimedData(input.planner, ["contentRef", "contentDigest", "expiresAt", "claim"])
      || typeof input.planner.contentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(input.planner.contentDigest)) return refused;
    const planner = input.planner;
    const selected = selectGuestImageResultMetadataCore({ ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId,
      outputId: input.outputId, events: input.events, head: input.head,
      planner: { contentRef: planner.contentRef, expiresAt: planner.expiresAt, claim: planner.claim } }, null, now());
    if (!selected) return refused;
    const snapshot: GuestImageResultMetadataSnapshot = {
      status: "current", ownerId: selected.ownerId, projectId: selected.projectId, documentId: selected.documentId, outputId: selected.outputId,
      generationId: selected.generationId, sourceEventId: selected.sourceEventId, contentRef: selected.contentRef, contentSha256: selected.expectedRawSha256,
      revision: selected.revision, editEventId: selected.editEventId,
      media: Object.freeze({ url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256,
        width: selected.width, height: selected.height, byteLength: selected.byteLength }),
      sources: selected.sources.map(source => Object.freeze({ ...source })), sourceIds: [...selected.sourceIds],
      head: selected.head, claim: selected.claim,
    };
    Object.freeze(snapshot.sources); Object.freeze(snapshot.sourceIds);
    const pair = selected.localPair;
    const localPair: GuestImageResultLocalPair | null = pair ? Object.freeze({ sourceId: pair.source.id, blockId: pair.source.blockId,
      referenceId: pair.referenceId, receiptEventId: pair.receiptEventId, creationEventId: pair.creationEventId,
      sourceExpiresAt: pair.sourceExpiresAt, locked: pair.locked, sourceEvents: Object.freeze([...pair.sourceEvents]),
      source: Object.freeze({ ...pair.source }), proof: pair.proof }) : null;
    return Object.freeze({ status: "current", snapshot: Object.freeze(snapshot), title: selected.title,
      plannerExpiresAt: selected.plannerExpiresAt, contentExpiresAt: selected.contentExpiresAt, localPair });
  } catch { return refused; }
}
function guestImageResultSnapshot(selected: NonNullable<ReturnType<typeof selectGuestImageResultEdit>>, contentSha256: string): GuestImageResultEditSnapshot {
  return { status: "current", ownerId: selected.ownerId, projectId: selected.projectId, documentId: selected.documentId, outputId: selected.outputId,
    generationId: selected.generationId, sourceEventId: selected.sourceEventId, contentRef: selected.contentRef, contentSha256, rawJson: selected.rawJson,
    revision: selected.revision, editEventId: selected.editEventId,
    media: { url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256, width: selected.width, height: selected.height, byteLength: selected.byteLength },
    sources: selected.sources.map(source => ({ ...source })), sourceIds: [...selected.sourceIds], head: selected.head, claim: selected.claim };
}

/** Pure current-data inspection; an empty sourceIds roster does not adopt a source. */
export async function inspectCurrentGuestImageResultEdit(read: () => GuestImageResultEditRead | null, now: () => number = Date.now): Promise<Readonly<GuestImageResultEditSnapshot> | typeof refused> {
  try {
    const selected = selectGuestImageResultEdit(read(), null, now());
    if (!selected) return refused;
    const proof = JSON.stringify(selected), contentSha256 = await outputAssetSha256(new TextEncoder().encode(selected.rawJson));
    const current = selectGuestImageResultEdit(read(), null, now());
    if (!current || JSON.stringify(current) !== proof || selected.expectedRawSha256 !== null && selected.expectedRawSha256 !== contentSha256) return refused;
    const snapshot = guestImageResultSnapshot(selected, contentSha256);
    Object.freeze(snapshot.media); snapshot.sources.forEach(Object.freeze); Object.freeze(snapshot.sources); Object.freeze(snapshot.sourceIds);
    return Object.freeze(snapshot);
  } catch { return refused; }
}
export async function matchGuestImageResultEditSnapshot(snapshot: unknown, read: () => GuestImageResultEditRead | null, now: () => number = Date.now): Promise<Readonly<GuestImageResultEditSnapshot> | typeof refused> {
  try {
    const current = await inspectCurrentGuestImageResultEdit(read, now);
    if (current.status !== "current") return refused;
    const before = selectGuestImageResultEdit(read(), null, now());
    if (!before || !equalSnapshotData(guestImageResultSnapshot(before, current.contentSha256), current)) return refused;
    // Retain private role expiry and local-pair provenance as well as the wire
    // fields: response reflection must not change either invisible boundary.
    const proof = JSON.stringify(before);
    if (!equalSnapshotData(snapshot, current)) return refused;
    const final = selectGuestImageResultEdit(read(), null, now());
    return final && JSON.stringify(final) === proof && (final.expectedRawSha256 === null || final.expectedRawSha256 === current.contentSha256)
      && equalSnapshotData(guestImageResultSnapshot(final, current.contentSha256), current) ? current : refused;
  } catch { return refused; }
}
export async function captureCurrentGuestImageResultEdit(read: () => GuestImageResultEditRead | null, sourceId: string, now: () => number = Date.now): Promise<CurrentGuestImageResultEdit | typeof refused> {
  try {
    const selected = selectGuestImageResultEdit(read(), sourceId, now());
    if (!selected) return refused;
    const proof = JSON.stringify(selected), contentSha256 = await outputAssetSha256(new TextEncoder().encode(selected.rawJson));
    const matches = () => { try { const current = selectGuestImageResultEdit(read(), sourceId, now()); return current !== null && JSON.stringify(current) === proof; } catch { return false; } };
    if (!matches() || selected.expectedRawSha256 !== null && selected.expectedRawSha256 !== contentSha256) return refused;
    const basis: GuestImageResultEditBasis = Object.freeze({ kind: "generated-image", ownerId: selected.ownerId, documentId: selected.documentId,
      outputId: selected.outputId, generationId: selected.generationId, sourceEventId: selected.sourceEventId, contentRef: selected.contentRef,
      revision: selected.revision, rawJson: selected.rawJson, contentSha256,
      media: Object.freeze({ url: selected.mediaUrl, mediaType: "image/png", sha256: selected.mediaSha256, width: selected.width, height: selected.height }), claim: selected.claim });
    const sources = Object.freeze(selected.sources.map(source => Object.freeze({ ...source }))), captured = Object.freeze({ basis, sources });
    let retired = false;
    return Object.freeze({ status: "captured", sourceId, editEventId: selected.editEventId, basis, sources,
      current() { if (retired || !matches()) { retired = true; return null; } return captured; } });
  } catch { return refused; }
}
