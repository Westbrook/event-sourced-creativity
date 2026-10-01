// New reconstruction from surviving Image Host/Store contracts. No recovered I1 source identity is claimed.
import { documentGenerationRequestKey } from "./document-jobs.ts";
export type NativeImageSetup = Readonly<{
  documentId: string; documentRevision: string; sourceSurface: "native-image";
  promptTechnique: "prose" | "bullets" | "json" | "xml";
  kind: "generate"; productionMode: "manual"; sourcePreviewId: null; requestKey: string;
}>;
export type NativeImageHandle = NativeImageSetup & Readonly<{
  jobId: string; requestedSequence: number; promptFanId: null; parentJobId: null;
  fanKind: null; members: readonly [];
}>;
export type NativeImageSubmission =
  | Readonly<{ disposition: "acknowledged"; handle: NativeImageHandle; reused: boolean }>
  | Readonly<{ disposition: "not-dispatched"; handle: null; reason: "budget-blocked" | "user-canceled" | "unavailable" }>
  | Readonly<{ disposition: "dispatched-unconfirmed"; handle: null }>;
type DataRecord = Readonly<Record<string, unknown>>;
export type NativeImageData = Readonly<{
  inspection: DataRecord & Readonly<{ job: DataRecord }>;
  events: readonly DataRecord[]; outputs: readonly DataRecord[];
}>;
export type NativeImageRead =
  | Readonly<{ status: "data"; data: NativeImageData }>
  | Readonly<{ status: "unavailable" | "superseded" }>;
export type NativeImageMatch = Readonly<{
  id: string; jobId: string; documentId: string; sourceEventId: string; generationId: string;
  ownerId: string; mediaUrl: string; mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number; height: number; title: string | null; sourceContentHash: string; expiresAt: string | null;
}>;
export type NativeImageJoin =
  | Readonly<{ status: "matched"; image: NativeImageMatch }>
  | Readonly<{ status: "pending" | "terminal" | "unavailable" | "superseded" }>;

// The 64-candidate and 1 MiB limits survive in the Store contract. Other capture
// bounds are new defensive limits on this pure snapshot, not timing guarantees.
export const NATIVE_IMAGE_LIMITS = Object.freeze({ candidates: 64, bytes: 1_048_576, depth: 24, nodes: 16_384 });
const setupKeys = ["documentId", "documentRevision", "sourceSurface", "promptTechnique", "kind", "productionMode", "sourcePreviewId", "requestKey"] as const;
const handleKeys = [...setupKeys, "jobId", "requestedSequence", "promptFanId", "parentJobId", "fanKind", "members"] as const;
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();
const unavailable = Object.freeze({ status: "unavailable" } as const);
const superseded = Object.freeze({ status: "superseded" } as const);
const unconfirmed = Object.freeze({ disposition: "dispatched-unconfirmed", handle: null } as const);

function record(value: unknown): value is DataRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(row: DataRecord, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

// Capture only enumerable data properties. Neither getters nor toJSON are run.
// Currentness errors remain their original exceptions; malformed input is data.
function snapshot(value: unknown, current: () => boolean): unknown {
  let bytes = 0, nodes = 0;
  const ancestors = new WeakSet<object>();
  const charge = (value: string) => {
    bytes += encoder.encode(value).length;
    if (bytes > NATIVE_IMAGE_LIMITS.bytes) throw new TypeError("native_image_snapshot_size");
  };
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > NATIVE_IMAGE_LIMITS.nodes || depth > NATIVE_IMAGE_LIMITS.depth) throw new TypeError("native_image_snapshot_bounds");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") { charge(input); return input; }
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (!input || typeof input !== "object" || ancestors.has(input)) throw new TypeError("native_image_snapshot_value");
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new TypeError("native_image_snapshot_prototype");
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    ancestors.add(input);
    try {
      if (array) {
        const length = descriptors.length;
        if (!length || !("value" in length) || !integer(length.value) || length.value > NATIVE_IMAGE_LIMITS.nodes
          || keys.length !== length.value + 1) throw new TypeError("native_image_snapshot_array");
        const out: unknown[] = [];
        for (let index = 0; index < length.value; index++) {
          const property = descriptors[String(index)];
          if (!property || !("value" in property) || !property.enumerable) throw new TypeError("native_image_snapshot_accessor");
          out.push(copy(property.value, depth + 1));
        }
        return Object.freeze(out);
      }
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (typeof key !== "string") throw new TypeError("native_image_snapshot_symbol");
        const property = descriptors[key]!;
        if (!("value" in property) || !property.enumerable) throw new TypeError("native_image_snapshot_accessor");
        charge(key);
        Object.defineProperty(out, key, { value: copy(property.value, depth + 1), enumerable: true });
      }
      return Object.freeze(out);
    } finally { ancestors.delete(input); }
  };
  if (!current()) return null;
  let result: unknown = null;
  try {
    result = copy(value, 0);
    if (encoder.encode(JSON.stringify(result)).length > NATIVE_IMAGE_LIMITS.bytes) result = null;
  } catch { /* A malformed snapshot is not a receipt. */ }
  return current() ? result : null;
}

function setup(row: DataRecord): NativeImageSetup | null {
  if (typeof row.documentId !== "string" || !opaque.test(row.documentId)
    || !text(row.documentRevision, 512) || !text(row.requestKey, 1024)
    || row.sourceSurface !== "native-image" || row.kind !== "generate" || row.productionMode !== "manual"
    || row.sourcePreviewId !== null || !["prose", "bullets", "json", "xml"].includes(row.promptTechnique as string)
    || row.requestKey !== documentGenerationRequestKey("generate", row.documentRevision, null, row.promptTechnique as string)) return null;
  return Object.freeze({ documentId: row.documentId, documentRevision: row.documentRevision,
    sourceSurface: "native-image", promptTechnique: row.promptTechnique as NativeImageSetup["promptTechnique"],
    kind: "generate", productionMode: "manual", sourcePreviewId: null, requestKey: row.requestKey });
}
function sameSetup(left: NativeImageSetup, right: NativeImageSetup): boolean {
  return setupKeys.every(key => left[key] === right[key]);
}
function handle(row: DataRecord, expected?: NativeImageSetup): NativeImageHandle | null {
  const captured = setup(row);
  if (!captured || expected && !sameSetup(captured, expected)
    || typeof row.jobId !== "string" || !opaque.test(row.jobId) || !integer(row.requestedSequence)
    || row.promptFanId !== null || row.parentJobId !== null || row.fanKind !== null
    || !Array.isArray(row.members) || row.members.length !== 0
    || Object.hasOwn(row, "canvasId") && row.canvasId !== null) return null;
  return Object.freeze({ ...captured, jobId: row.jobId, requestedSequence: row.requestedSequence,
    promptFanId: null, parentJobId: null, fanKind: null, members: Object.freeze([]) as readonly [] });
}
function sameHandle(left: NativeImageHandle, right: NativeImageHandle): boolean {
  return handleKeys.every(key => key === "members" || left[key] === right[key]);
}

export function captureNativeImageSetup(value: unknown): NativeImageSetup | null {
  const row = snapshot(value, () => true);
  return record(row) && exact(row, setupKeys) ? setup(row) : null;
}
export function captureNativeImageHandle(value: unknown, expectedSetup?: NativeImageSetup): NativeImageHandle | null {
  const expected = expectedSetup === undefined ? undefined : captureNativeImageSetup(expectedSetup);
  if (expected === null) return null;
  const row = snapshot(value, () => true);
  return record(row) ? handle(row, expected) : null;
}

// An invalid post-invocation value never becomes a safe-to-retry refusal.
export function captureNativeImageSubmission(value: unknown, expectedSetup: NativeImageSetup): NativeImageSubmission {
  const expected = captureNativeImageSetup(expectedSetup), row = snapshot(value, () => true);
  if (!expected || !record(row)) return unconfirmed;
  if (row.disposition === "acknowledged" && exact(row, ["disposition", "handle", "reused"]) && typeof row.reused === "boolean" && record(row.handle)) {
    const captured = handle(row.handle, expected);
    return captured ? Object.freeze({ disposition: "acknowledged", handle: captured, reused: row.reused }) : unconfirmed;
  }
  if (row.disposition === "not-dispatched" && exact(row, ["disposition", "handle", "reason"]) && row.handle === null
    && (row.reason === "budget-blocked" || row.reason === "user-canceled" || row.reason === "unavailable"))
    return Object.freeze({ disposition: "not-dispatched", handle: null, reason: row.reason });
  return unconfirmed;
}

export function nativeImageInspectionPath(value: NativeImageHandle | null): string | null {
  const captured = captureNativeImageHandle(value);
  return captured ? `/api/document-jobs/${encodeURIComponent(captured.jobId)}?inspection=1` : null;
}

export function captureNativeImageRead(value: unknown, current: () => boolean): NativeImageRead {
  if (!current()) return superseded;
  const row = snapshot(value, current);
  if (!current()) return superseded;
  if (!record(row)) return unavailable;
  if (row.status === "superseded" && exact(row, ["status"])) return superseded;
  if (row.status === "unavailable" && exact(row, ["status"])) return unavailable;
  if (row.status !== "data" || !exact(row, ["status", "data"]) || !record(row.data)
    || !exact(row.data, ["inspection", "events", "outputs"]) || !record(row.data.inspection) || !record(row.data.inspection.job)
    || !Array.isArray(row.data.events) || !Array.isArray(row.data.outputs)
    || row.data.events.length > NATIVE_IMAGE_LIMITS.candidates || row.data.outputs.length > NATIVE_IMAGE_LIMITS.candidates
    || !row.data.events.every(record) || !row.data.outputs.every(record)) return unavailable;
  return Object.freeze({ status: "data", data: row.data as NativeImageData });
}

function ownedMedia(value: unknown, ownerId: string): value is string {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/api/media/")) return false;
  const ownerHex = Array.from(encoder.encode(ownerId), byte => byte.toString(16).padStart(2, "0")).join("");
  try {
    const path = value.slice("/api/media/".length), decoded = decodeURIComponent(path);
    return encodeURIComponent(decoded) === path && decoded.startsWith(`u-${ownerHex}/generated/`)
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(decoded.slice(`u-${ownerHex}/generated/`.length));
  } catch { return false; }
}
function identity(value: unknown): value is string { return typeof value === "string" && opaque.test(value); }

// A passive join over the acknowledged job and the caller's confirmed, current
// evidence census. It admits no work, chooses no newest output and executes no URL.
export function joinNativeImageCompletion(value: NativeImageHandle, data: unknown, current: () => boolean, now = Date.now()): NativeImageJoin {
  if (!current()) return superseded;
  const expected = captureNativeImageHandle(value);
  const read = captureNativeImageRead({ status: "data", data }, current);
  if (!current() || read.status === "superseded") return superseded;
  if (!expected || read.status !== "data" || !Number.isFinite(now)) return unavailable;
  const { inspection, events, outputs } = read.data, job = inspection.job;
  const actual = handle(job, expected);
  if (!actual || !sameHandle(actual, expected)) return unavailable;
  if (job.status === "queued" || job.status === "running" || job.status === "committing") return Object.freeze({ status: "pending" });
  if (job.status === "partial" || job.status === "failed" || job.status === "canceled") return Object.freeze({ status: "terminal" });
  if (job.status !== "completed" || !record(job.result) || job.result.promoted !== false
    || !integer(job.result.head) || job.result.head < expected.requestedSequence) return unavailable;
  const references = job.result.appendedEventIds;
  if (!Array.isArray(references) || !references.length || references.length > NATIVE_IMAGE_LIMITS.candidates
    || !references.every(identity) || new Set(references).size !== references.length
    || new Set(events.map(event => event.eventId)).size !== events.length
    || new Set(events.map(event => event.sequence)).size !== events.length) return unavailable;
  const selected = references.map(id => events.find(event => event.eventId === id));
  if (selected.some(event => !event)) return unavailable;
  const completed = selected.filter(event => event!.type === "GenerationCompleted");
  if (completed.length !== 1 || outputs.length !== 1) return unavailable;
  const event = completed[0]!, payload = event.payload, output = outputs[0]!;
  if (!record(payload) || !identity(event.eventId) || !integer(event.sequence, expected.requestedSequence + 1)
    || event.sequence > job.result.head || typeof event.streamId !== "string" || !event.streamId.startsWith("creative:")
    || !text(event.streamId.slice(9), 160) || event.actor !== "worker:generator"
    || event.clientId !== "server:document-job:generate" || !text(event.correlationId, 512)
    || payload.document_id !== expected.documentId || payload.source_surface !== expected.sourceSurface
    || payload.prompt_technique !== expected.promptTechnique || !identity(payload.generation_id)
    || !text(payload.model_id, 160) || !text(payload.provider, 160)
    || !identity(payload.object_id) || !Array.isArray(payload.object_ids) || payload.object_ids.length !== 1
    || payload.object_ids[0] !== payload.object_id || payload.simulation !== false
    || payload.quality !== "high" || payload.purpose !== "final" || payload.used_ideation_preview_pixels !== false
    || typeof payload.source_content_hash !== "string" || !sha256.test(payload.source_content_hash)) return unavailable;
  for (const key of ["canvas_id", "context_set_id", "prompt_fan_id", "promotion_id", "reference_preview_event_id",
    "promoted_from_generation_id", "promoted_from_object_id", "promotion_outcome"])
    if (payload[key] !== null) return unavailable;
  for (const candidate of selected) {
    if (!candidate || !record(candidate.payload) || candidate.payload.document_id !== expected.documentId
      || candidate.streamId !== event.streamId || !integer(candidate.sequence, expected.requestedSequence + 1)
      || candidate.sequence > job.result.head) return unavailable;
    if (candidate.type === "ContextCompiled" && (candidate.payload.generation_id !== payload.generation_id
      || candidate.correlationId !== event.correlationId)) return unavailable;
  }
  // The Store supplies related aliases as well as selected references. Never
  // let a Map fold or a matching newest record hide a duplicate producer.
  for (const candidate of events) {
    if (!identity(candidate.eventId)) return unavailable;
    if (candidate === event) continue;
    if (candidate.type !== "GenerationCompleted" && candidate.type !== "IdeationPreviewCompleted") continue;
    if (!record(candidate.payload)) return unavailable;
    const ids = candidate.payload.object_ids;
    if (candidate.payload.generation_id === payload.generation_id || candidate.payload.object_id === payload.object_id
      || Array.isArray(ids) && ids.includes(payload.object_id)) return unavailable;
  }
  const ownerId = event.streamId.slice(9);
  if (!ownedMedia(payload.media_url, ownerId) || !["image/png", "image/jpeg", "image/webp"].includes(payload.media_type as string)
    || !integer(payload.image_width, 1) || !integer(payload.image_height, 1)
    || payload.image_width > 16_384 || payload.image_height > 16_384
    || output.id !== payload.object_id || output.documentId !== expected.documentId
    || output.generationId !== payload.generation_id || output.sourceEventId !== event.eventId || output.sequence !== event.sequence
    || output.mediaUrl !== payload.media_url || output.mediaType !== payload.media_type
    || output.width !== payload.image_width || output.height !== payload.image_height
    || output.promptTechnique !== expected.promptTechnique || output.sourceSurface !== expected.sourceSurface
    || output.modelId !== payload.model_id || output.provider !== payload.provider
    || output.quality !== "high" || output.purpose !== "final" || output.discarded !== false
    || output.standalone !== true || output.standaloneSequence !== event.sequence
    || ["canvasId", "contextSetId", "promptFanId", "promotionId", "promotedFromId", "promotedFromEventId"].some(key => output[key] !== null)) return unavailable;
  let expiresAt: string | null = null;
  if (payload.content_expires_at !== undefined && payload.content_expires_at !== null) {
    if (typeof payload.content_expires_at !== "string" || !(Date.parse(payload.content_expires_at) > now)) return unavailable;
    try { if (new Date(payload.content_expires_at).toISOString() !== payload.content_expires_at) return unavailable; } catch { return unavailable; }
    expiresAt = payload.content_expires_at;
  }
  if (output.title !== undefined && (typeof output.title !== "string" || output.title.length > 4096)) return unavailable;
  const image: NativeImageMatch = Object.freeze({ id: output.id as string, jobId: expected.jobId,
    documentId: expected.documentId, sourceEventId: event.eventId, generationId: payload.generation_id,
    ownerId, mediaUrl: payload.media_url, mediaType: payload.media_type as NativeImageMatch["mediaType"],
    width: payload.image_width, height: payload.image_height, title: (output.title as string | undefined) ?? null,
    sourceContentHash: payload.source_content_hash, expiresAt });
  return current() ? Object.freeze({ status: "matched", image }) : superseded;
}
