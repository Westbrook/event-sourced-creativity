import type { CreativeEvent } from "../src/model/events.ts";
import type { GuestImageResultMetadataSnapshot } from "../src/model/generated-image-edit-current.ts";
import { parseGuestImageResultCompletedCustodyReview, parseGuestImageResultMediaUrl,
  type GuestImageResultCompletedCustodyReview } from "../src/model/generated-image-edit.ts";
import { parseGuestImageResultClaimEvent, type GuestImageResultClaimPresentation } from "../src/model/guest-image-result-presentation.ts";

/** Pure command and exact pair bytes. None of these values is completed
 * custody, a native read/write receipt, or permission for provider reuse.
 * The private original-Request owner proves the real canonical association,
 * complete current history/revision chain, immutable IDs and fixed clocks. */
export type GuestImageResultLocalAdoptionCommand = Readonly<{
  operation: "adopt-claimed-local-source"; claim: GuestImageResultCompletedCustodyReview;
  expectedRevision: number; expectedEditEventId: string | null; expectedMediaSha256: string;
}>;
export type GuestImageResultLocalAdoptionPair = Readonly<{ receipt: CreativeEvent; block: CreativeEvent }>;
export type GuestImageResultLocalAdoptionPairInput = Readonly<{
  snapshot: GuestImageResultMetadataSnapshot;
  title: string; canonical: GuestImageResultClaimPresentation;
  /** Already proved exact min(canonical, required current revision retention).
   * This field is not an optional requested expiry or an authority token. */
  retainedExpiresAt: string;
  ids: Readonly<{ referenceId: string; blockId: string; receiptEventId: string; blockEventId: string; correlationId: string }>;
  occurredAt: string;
}>;
export const GUEST_IMAGE_LOCAL_ADOPTION_LIMITS = Object.freeze({
  commandBytes: 8192, payloadBytes: 8192, pairBytes: 32768,
  captureNodes: 512, captureDepth: 12, captureStringUnits: 32768, captureKeys: 64,
});
type Row = Record<string, unknown>;
const encoder = new TextEncoder();
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const qualifiedHash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const historyRef = (value: unknown): value is string => typeof value === "string" && /^guest-image-result-history-[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
function exact(value: unknown, keys: readonly string[]): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const names = Reflect.ownKeys(value);
  return names.length === keys.length && keys.every(key => Object.hasOwn(value, key)) && names.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && !!field && field.enumerable && Object.hasOwn(field, "value");
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze((value as Row)[key]);
    Object.freeze(value);
  }
  return value;
}
/** Bounded own-data capture. No getters, toJSON, prototype hooks, sparse
 * arrays or cycles are accepted; finite geometry is not involved. */
function capture(value: unknown): unknown {
  const seen = new Set<object>(); let nodes = 0, stringUnits = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.captureNodes || depth > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.captureDepth) throw new Error("invalid");
    if (typeof item === "string") {
      stringUnits += item.length;
      if (stringUnits > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.captureStringUnits) throw new Error("invalid");
      return item;
    }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || seen.has(item)) throw new Error("invalid");
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error("invalid");
    const names = Reflect.ownKeys(item);
    if (names.length > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.captureKeys) throw new Error("invalid");
    seen.add(item);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(item, "length");
      if (!length || !Object.hasOwn(length, "value") || !integer(length.value, 0, 63) || names.length !== length.value + 1) throw new Error("invalid");
      const result: unknown[] = [];
      for (let index = 0; index < length.value; index++) {
        const field = Object.getOwnPropertyDescriptor(item, String(index));
        if (!field || !field.enumerable || !Object.hasOwn(field, "value")) throw new Error("invalid");
        result.push(visit(field.value, depth + 1));
      }
      seen.delete(item); return result;
    }
    const result: Row = {};
    for (const key of names) {
      const field = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)
        || !field.enumerable || !Object.hasOwn(field, "value")) throw new Error("invalid");
      stringUnits += key.length;
      if (stringUnits > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.captureStringUnits) throw new Error("invalid");
      result[key] = visit(field.value, depth + 1);
    }
    seen.delete(item); return result;
  };
  return visit(value, 0);
}
function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && same((left as Row)[key], (right as Row)[key]));
}
const commandKeys = ["operation", "claim", "expectedRevision", "expectedEditEventId", "expectedMediaSha256"] as const;
export function parseGuestImageResultLocalAdoptionCommand(value: unknown): GuestImageResultLocalAdoptionCommand | null {
  try {
    const data = capture(value);
    if (!exact(data, commandKeys) || data.operation !== "adopt-claimed-local-source" || !integer(data.expectedRevision)
      || (data.expectedRevision === 0 ? data.expectedEditEventId !== null : !uuid(data.expectedEditEventId))
      || !hash(data.expectedMediaSha256) || encoder.encode(JSON.stringify(data)).byteLength > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.commandBytes) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(data.claim);
    if (!claim) return null;
    return Object.freeze({ operation: "adopt-claimed-local-source", claim, expectedRevision: data.expectedRevision,
      expectedEditEventId: data.expectedEditEventId as string | null, expectedMediaSha256: data.expectedMediaSha256 });
  } catch { return null; }
}
const headerKeys = ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId",
  "compensatesEventId", "schemaVersion", "type", "payload"] as const;
const receiptKeys = ["project_id", "document_id", "source_surface", "reference_id", "source_type", "operation_scope", "source_ref", "media_url", "media_type",
  "content_hash", "rights_class", "source_output_id", "source_generation_id", "source_document_id", "source_event_id", "source_revision", "source_edit_event_id",
  "source_content_ref", "source_prompt_ref", "claim", "source_expires_at", "provider", "model_id", "source_rights_digest"] as const;
const blockKeys = ["project_id", "document_id", "source_surface", "block_id", "type", "scope", "handle", "position", "properties"] as const;
const propertyKeys = ["reference_id", "label", "media_url", "media_type", "source_mime_type", "source_content_hash", "width", "height", "source_output_id",
  "source_generation_id", "source_document_id", "source_event_id", "source_output_content_ref", "source_output_prompt_ref", "source_revision", "source_edit_event_id",
  "claim", "operation_scope", "source_type", "rights_class", "source_expires_at", "pixel_reference_mode", "intent", "authority", "weight", "created_from", "source_rights_digest"] as const;
function header(value: unknown, type: string): value is Row {
  return exact(value, headerKeys) && value.type === type && uuid(value.eventId) && uuid(value.correlationId)
    && integer(value.sequence, 1) && iso(value.occurredAt) && value.recordedAt === value.occurredAt
    && value.actor === "user" && value.clientId === "server:guest-image-local-context" && value.schemaVersion === 1
    && value.causationId === null && value.compensatesEventId === null;
}
/** Closed pair grammar/equality material only. Full-history alias exclusion,
 * active Block state, locks, current expiry and authority stay with the owner. */
function parsePair(value: unknown): GuestImageResultLocalAdoptionPair | null {
  const data = capture(value);
  if (!exact(data, ["receipt", "block"]) || !header(data.receipt, "ReferenceIngested") || !header(data.block, "BlockCreated")) return null;
  const receipt = data.receipt, block = data.block, r = receipt.payload, b = block.payload;
  if (!exact(r, receiptKeys) || !exact(b, blockKeys) || !exact(b.properties, propertyKeys)) return null;
  const p = b.properties, claim = parseGuestImageResultCompletedCustodyReview(r.claim), media = parseGuestImageResultMediaUrl(r.media_url);
  if (!claim || !media || !same(p.claim, claim) || !uuid(r.project_id) || !uuid(r.document_id) || !uuid(r.reference_id) || !uuid(b.block_id)
    || !uuid(r.source_generation_id) || !uuid(r.source_event_id) || r.source_output_id !== `object-${r.source_generation_id.slice(-8)}`
    || r.source_event_id !== claim.claimEventId || media.custodyId !== claim.custodyId || media.outputId !== r.source_output_id
    || !integer(r.source_revision) || (r.source_revision === 0 ? r.source_edit_event_id !== null || media.revisionId !== null
      : !uuid(r.source_edit_event_id) || !uuid(media.revisionId)) || !hash(r.content_hash) || !qualifiedHash(r.source_rights_digest)
    || !historyRef(r.source_content_ref) || !historyRef(r.source_prompt_ref) || r.source_content_ref === r.source_prompt_ref
    || !iso(r.source_expires_at) || r.source_expires_at <= (receipt.recordedAt as string)
    || r.source_surface !== "generated-image-editor" || r.source_type !== "claimed-generated-output" || r.operation_scope !== "local-image-composition"
    || r.source_ref !== r.media_url || r.media_type !== "image/png" || r.rights_class !== "owned" || r.provider !== "openai" || r.model_id !== "gpt-image-2"
    || r.source_document_id !== r.document_id || receipt.streamId !== "creative:" + media.ownerId || block.streamId !== receipt.streamId
    || !integer(receipt.sequence, 1, Number.MAX_SAFE_INTEGER - 1) || block.sequence !== receipt.sequence + 1
    || block.correlationId !== receipt.correlationId || block.recordedAt !== receipt.recordedAt
    || new Set([receipt.eventId, block.eventId, r.reference_id, b.block_id, receipt.correlationId]).size !== 5
    || b.project_id !== r.project_id || b.document_id !== r.document_id || b.source_surface !== r.source_surface || b.type !== "reference" || b.scope !== "document"
    || b.handle !== `reference/claimed-${media.outputId.slice(-8)}-r${r.source_revision}` || b.position !== "z" + String(block.sequence).padStart(8, "0")
    || typeof p.label !== "string" || !p.label.length || p.label.length > 160 || p.label !== p.label.trim()
    || !integer(p.width, 1, 16_384) || !integer(p.height, 1, 16_384) || p.pixel_reference_mode !== "context_only"
    || p.intent !== "include" || p.authority !== "authored" || p.weight !== 0.8 || p.created_from !== "generated-image-editor") return null;
  const fields: Row = { reference_id: r.reference_id, media_url: r.media_url, media_type: r.media_type, source_mime_type: r.media_type,
    source_content_hash: r.content_hash, source_output_id: r.source_output_id, source_generation_id: r.source_generation_id,
    source_document_id: r.source_document_id, source_event_id: r.source_event_id, source_output_content_ref: r.source_content_ref,
    source_output_prompt_ref: r.source_prompt_ref, source_revision: r.source_revision, source_edit_event_id: r.source_edit_event_id,
    operation_scope: r.operation_scope, source_type: r.source_type, rights_class: r.rights_class,
    source_expires_at: r.source_expires_at, source_rights_digest: r.source_rights_digest };
  if (Object.entries(fields).some(([key, expected]) => p[key] !== expected)
    || encoder.encode(JSON.stringify(r)).byteLength > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.payloadBytes
    || encoder.encode(JSON.stringify(b)).byteLength > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.payloadBytes
    || encoder.encode(JSON.stringify(data)).byteLength > GUEST_IMAGE_LOCAL_ADOPTION_LIMITS.pairBytes) return null;
  // Restore the controlling fixed completed-review order in both payloads.
  r.claim = claim; p.claim = claim;
  return freeze(data) as unknown as GuestImageResultLocalAdoptionPair;
}

/** Server-supplied IDs/time plus already qualified body-free facts produce
 * only candidate bytes. The owning writer must still qualify the prospective
 * full history, stage atomically, and compare the actual native readback. */
export function createGuestImageResultLocalAdoptionPair(input: GuestImageResultLocalAdoptionPairInput): GuestImageResultLocalAdoptionPair | null {
  try {
    if (!exact(input, ["snapshot", "title", "canonical", "retainedExpiresAt", "ids", "occurredAt"])
      || !exact(input.ids, ["referenceId", "blockId", "receiptEventId", "blockEventId", "correlationId"])) return null;
    const canonical = parseGuestImageResultClaimEvent(input.canonical), s = input.snapshot, ids = input.ids;
    if (!canonical || !exact(s, ["status", "ownerId", "projectId", "documentId", "outputId", "generationId", "sourceEventId", "contentRef", "contentSha256",
      "revision", "editEventId", "media", "sources", "sourceIds", "head", "claim"])
      || !exact(s.media, ["url", "mediaType", "sha256", "width", "height", "byteLength"])) return null;
    const p = canonical.payload, claim = parseGuestImageResultCompletedCustodyReview(s.claim), media = parseGuestImageResultMediaUrl(s.media.url);
    if (!claim || !media || s.status !== "current" || s.ownerId !== media.ownerId || canonical.streamId !== "creative:" + s.ownerId
      || s.projectId !== p.project_id || s.documentId !== p.document_id || s.outputId !== p.object_id || s.generationId !== p.generation_id
      || s.sourceEventId !== canonical.eventId || s.contentRef !== p.output_ref
      || claim.custodyId !== p.custody_id || claim.claimEventId !== canonical.eventId || media.custodyId !== claim.custodyId || media.outputId !== s.outputId
      || !integer(s.revision) || (s.revision === 0 ? s.editEventId !== null || media.revisionId !== null || s.contentSha256 !== null
        : !uuid(s.editEventId) || !uuid(media.revisionId) || !hash(s.contentSha256)) || !integer(s.head, canonical.sequence, Number.MAX_SAFE_INTEGER - 2)
      || s.media.mediaType !== "image/png" || !hash(s.media.sha256) || !integer(s.media.width, 1, 16_384) || !integer(s.media.height, 1, 16_384)
      || !integer(s.media.byteLength, 1, 24_000_000) || !Array.isArray(s.sources) || !Array.isArray(s.sourceIds)
      || s.sources.length > 128 || s.sourceIds.length > 128 || typeof input.title !== "string"
      || !iso(input.occurredAt) || input.occurredAt < canonical.recordedAt || !iso(input.retainedExpiresAt)
      || input.retainedExpiresAt <= input.occurredAt || input.retainedExpiresAt > p.content_expires_at
      || s.revision === 0 && (input.retainedExpiresAt !== p.content_expires_at || s.media.url !== p.media_url
        || s.media.sha256 !== p.source_content_hash || s.media.width !== p.image_width || s.media.height !== p.image_height || s.media.byteLength !== p.image_byte_length)
      || !Object.values(ids).every(uuid) || new Set(Object.values(ids)).size !== 5
      || Object.values(ids).some(id => [canonical.eventId, p.project_id, p.document_id, p.custody_id, p.generation_id, s.editEventId, media.revisionId].includes(id))) return null;
    const receiptPayload = { project_id: s.projectId, document_id: s.documentId, source_surface: "generated-image-editor",
      reference_id: ids.referenceId, source_type: "claimed-generated-output", operation_scope: "local-image-composition",
      source_ref: s.media.url, media_url: s.media.url, media_type: "image/png", content_hash: s.media.sha256, rights_class: "owned",
      source_output_id: s.outputId, source_generation_id: p.generation_id, source_document_id: s.documentId, source_event_id: canonical.eventId,
      source_revision: s.revision, source_edit_event_id: s.editEventId, source_content_ref: p.output_ref, source_prompt_ref: p.prompt_ref,
      claim, source_expires_at: input.retainedExpiresAt, provider: p.provider, model_id: p.model_id, source_rights_digest: p.source_rights_digest };
    const properties = { reference_id: ids.referenceId, label: input.title.trim().slice(0, 160).trim() || "Image", media_url: s.media.url,
      media_type: "image/png", source_mime_type: "image/png", source_content_hash: s.media.sha256, width: s.media.width, height: s.media.height,
      source_output_id: s.outputId, source_generation_id: p.generation_id, source_document_id: s.documentId, source_event_id: canonical.eventId,
      source_output_content_ref: p.output_ref, source_output_prompt_ref: p.prompt_ref, source_revision: s.revision, source_edit_event_id: s.editEventId,
      claim, operation_scope: "local-image-composition", source_type: "claimed-generated-output", rights_class: "owned",
      source_expires_at: input.retainedExpiresAt, pixel_reference_mode: "context_only", intent: "include", authority: "authored", weight: 0.8,
      created_from: "generated-image-editor", source_rights_digest: p.source_rights_digest };
    const event = (eventId: string, sequence: number, type: string, payload: Row): CreativeEvent => ({ eventId, streamId: "creative:" + s.ownerId,
      sequence, occurredAt: input.occurredAt, recordedAt: input.occurredAt, actor: "user", clientId: "server:guest-image-local-context",
      correlationId: ids.correlationId, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
    return parsePair({ receipt: event(ids.receiptEventId, s.head + 1, "ReferenceIngested", receiptPayload),
      block: event(ids.blockEventId, s.head + 2, "BlockCreated", { project_id: s.projectId, document_id: s.documentId,
        source_surface: "generated-image-editor", block_id: ids.blockId, type: "reference", scope: "document",
        handle: `reference/claimed-${s.outputId.slice(-8)}-r${s.revision}`, position: "z" + String(s.head + 2).padStart(8, "0"), properties }) });
  } catch { return null; }
}

/** Compare actual native two-event readback to the exact prospectively proved
 * candidate or the exact existing witness-selected pair. This does not fold
 * an incomplete history, refresh an owner, or turn candidate bytes into proof
 * that a transaction committed. The private full before/after proofs govern. */
export function matchGuestImageResultLocalAdoptionPair(actual: unknown, expected: GuestImageResultLocalAdoptionPair): GuestImageResultLocalAdoptionPair | null {
  try {
    const wanted = parsePair(expected), observed = parsePair(actual);
    return wanted && observed && same(observed, wanted) ? observed : null;
  } catch { return null; }
}

/** Same conservative JSON String/trim identity policy as the claimed model.
 * Null means bounded-indeterminate and must never be treated as absence. */
function historyIdentity(value: unknown): string | null {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): string | null => {
    if (++nodes > 4096 || depth > 24) return null;
    if (item === null || item === undefined || ["string", "number", "boolean"].includes(typeof item)) return String(item);
    if (!Array.isArray(item) || Object.getPrototypeOf(item) !== Array.prototype || seen.has(item)
      || Object.hasOwn(item, "toString") || Object.hasOwn(item, "join") || Object.hasOwn(item, Symbol.toPrimitive)) return null;
    const length = Object.getOwnPropertyDescriptor(item, "length");
    if (!length || !Object.hasOwn(length, "value") || !integer(length.value, 0, 4096)) return null;
    seen.add(item); const parts: string[] = [];
    for (let index = 0; index < length.value; index++) {
      const field = Object.getOwnPropertyDescriptor(item, String(index));
      if (field && !Object.hasOwn(field, "value")) return null;
      const child = field?.value, part = child === null || child === undefined ? "" : visit(child, depth + 1);
      if (part === null) return null;
      parts.push(part);
    }
    seen.delete(item); return parts.join(",");
  };
  return visit(value, 0);
}
function historyOwn(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("invalid");
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field) return undefined;
  if (!field.enumerable || !Object.hasOwn(field, "value")) throw new Error("invalid");
  return field.value;
}
const blockIdentityEvents = new Set(["BlockCreated", "BlockRehomed", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet",
  "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored", "ChipEdited", "ExtractionRequested", "ExtractionCompleted", "ExtractionFailed"]);
const collectionIdentityEvents = new Set(["CollectionItemAdded", "CollectionItemRemoved", "CollectionItemMoved"]);
/** Exact closed identity-field scan over the already retained complete owner
 * history, including orphan Block operations and authored reference_id values.
 * This is not a generic text search, ownership proof, or SQL UUID reservation.
 * The private owner still checks canonical resource/event/private/stage scopes
 * at both boundaries and qualifies the entire prospective model history. */
export function guestImageResultLocalAdoptionIdentitiesUnused(
  events: readonly CreativeEvent[], ids: GuestImageResultLocalAdoptionPairInput["ids"],
): boolean {
  try {
    if (!exact(ids, ["referenceId", "blockId", "receiptEventId", "blockEventId", "correlationId"]) || !Object.values(ids).every(uuid)
      || new Set(Object.values(ids)).size !== 5 || !Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype
      || !integer(events.length, 0, 50_000)) return false;
    const newIds = new Set(Object.values(ids));
    const conflicts = (value: unknown, expected: string, trim = false) => {
      const id = historyIdentity(value); return id === null || (trim ? id.trim() : id) === expected;
    };
    const referenceValue = (value: unknown) => conflicts(value, ids.referenceId, true);
    const propertyValue = (property: unknown, value: unknown) => {
      const key = historyIdentity(property);
      return key === null || key === "reference_id" && referenceValue(value);
    };
    for (let index = 0; index < events.length; index++) {
      const field = Object.getOwnPropertyDescriptor(events, String(index));
      if (!field || !field.enumerable || !Object.hasOwn(field, "value")) return false;
      const event: unknown = field.value, type = historyOwn(event, "type"), payload = historyOwn(event, "payload");
      if (typeof type !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      for (const key of ["eventId", "correlationId"]) {
        const value = historyOwn(event, key);
        if (typeof value === "string" && newIds.has(value)) return false;
      }
      if (blockIdentityEvents.has(type) && conflicts(historyOwn(payload, "block_id"), ids.blockId)) return false;
      if (type === "BlockRelationAdded" && (conflicts(historyOwn(payload, "from_block_id") ?? "", ids.blockId)
        || conflicts(historyOwn(payload, "to_block_id") ?? "", ids.blockId))) return false;
      if (collectionIdentityEvents.has(type)) {
        const item = historyOwn(payload, "item_ref");
        const selected = historyOwn(item, "document_id") ?? historyOwn(item, "block_id") ?? historyOwn(item, "collection_id") ?? historyOwn(item, "object_id") ?? "";
        if (conflicts(selected, ids.blockId)) return false;
      }
      if (type === "ImageFocalPointCalculated" && historyOwn(payload, "target_kind") !== "generation" && historyOwn(payload, "target_kind") !== "artifact"
        && conflicts(historyOwn(payload, "block_id") ?? historyOwn(payload, "target_id") ?? "", ids.blockId)) return false;
      if ((type === "ReferenceIngested" || type === "RightsAsserted") && referenceValue(historyOwn(payload, "reference_id"))) return false;
      if (type === "BlockCreated" && referenceValue(historyOwn(historyOwn(payload, "properties"), "reference_id"))) return false;
      if (type === "BlockPropertyEdited" && propertyValue(historyOwn(payload, "property_path") ?? "", historyOwn(payload, "new_value"))) return false;
      if (type === "ChipEdited" && propertyValue(historyOwn(payload, "property") ?? "value", historyOwn(payload, "new_value"))) return false;
      if (type === "ExtractionCompleted") {
        const chips = historyOwn(payload, "chips");
        if (!Array.isArray(chips)) continue;
        if (Object.getPrototypeOf(chips) !== Array.prototype) return false;
        const length = Object.getOwnPropertyDescriptor(chips, "length");
        // Every chip consumes at least two JSON bytes in the already bounded
        // 128,000-byte native witness row. This is a derived traversal bound.
        if (!length || !Object.hasOwn(length, "value") || !integer(length.value, 0, 64_000)) return false;
        for (let chipIndex = 0; chipIndex < length.value; chipIndex++) {
          const chipField = Object.getOwnPropertyDescriptor(chips, String(chipIndex));
          if (chipField && !Object.hasOwn(chipField, "value")) return false;
          const chip = chipField?.value;
          if (propertyValue(historyOwn(chip, "property") ?? "", historyOwn(chip, "value"))) return false;
        }
      }
    }
    return true;
  } catch { return false; }
}
