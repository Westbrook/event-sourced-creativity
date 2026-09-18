import { canonicalJson, digest, freeze, record } from "../src/experiences/compiler.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { readGuestImageResultManifest, type GuestImageResultManifest } from "./experience-guest-image-result-contract.ts";

/** Dormant JSON contracts only. Neither parsing, hashing nor a valid transition
 * proves a read, a PUT, settlement, custody or permission to change any row. */
export const GUEST_IMAGE_RESULT_MEDIA_FAMILY = "guest-image-result-media-v1";
export const GUEST_IMAGE_RESULT_COPY_MAX_BYTES = 24_000_000;
export const GUEST_IMAGE_RESULT_COPY_MAX_DIMENSION = 8192;
export type GuestImageResultCopyLeaseSnapshot = Readonly<{
  session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string;
  request_id: string; request_ids_json: string; acquisitions: number; created_at_ms: number; expires_at_ms: number;
}>;
export type GuestImageResultCopyProducerMetadata = Readonly<{
  model: string; provider: "openai"; adapter: string; providerRequestId: string;
}>;
export type GuestImageResultCopyMetadata = Readonly<{
  version: "1"; kind: "guest-image-result-copy"; attemptId: string; custodyId: string; ownerId: string;
  generationId: string; outputId: string; manifestDigest: string; nativeSnapshotDigest: string;
  sha256: string; mimeType: "image/png"; writerNonce: string;
}>;
export type GuestImageResultCopyDescriptor = Readonly<{
  version: 1; kind: "guest-image-result-copy"; attemptId: string; custodyId: string; requestId: string;
  destinationUserId: string; manifestDigest: string; manifest: GuestImageResultManifest;
  leaseSnapshot: GuestImageResultCopyLeaseSnapshot;
  source: Readonly<{ byteLength: number; producerMetadata: GuestImageResultCopyProducerMetadata }>;
  destinationKey: string; destinationMetadata: GuestImageResultCopyMetadata; writerNonce: string;
}>;
export type GuestImageResultCopyState = "reserved" | "writing" | "ready" | "cleanup_pending" | "deleted" | "published";
export type GuestImageResultCopyPutOutcome = "pending" | "unknown" | "success" | "conditional-null";
export type GuestImageResultCopyAttemptRow = Readonly<{
  attempt_id: string; custody_id: string; session_id: string; destination_user_id: string;
  lease_id: string; lease_acquisition: number; request_id: string; manifest_digest: string;
  descriptor_json: string; descriptor_digest: string; lease_snapshot_json: string; source_expires_at_ms: number;
  destination_key: string; writer_nonce: string; content_sha256: string; byte_length: number; mime_type: "image/png";
  width: number; height: number; destination_metadata_json: string;
  state: GuestImageResultCopyState; row_version: number; put_outcome: GuestImageResultCopyPutOutcome;
  created_at_ms: number; updated_at_ms: number; put_started_at_ms: number | null; put_settled_at_ms: number | null;
  verified_at_ms: number | null; published_at_ms: number | null; published_claim_digest: string | null;
}>;

export const GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS = [
  "attempt_id", "custody_id", "session_id", "destination_user_id", "lease_id", "lease_acquisition", "request_id", "manifest_digest",
  "descriptor_json", "descriptor_digest", "lease_snapshot_json", "source_expires_at_ms", "destination_key", "writer_nonce", "content_sha256",
  "byte_length", "mime_type", "width", "height", "destination_metadata_json", "created_at_ms",
] as const;
export const GUEST_IMAGE_RESULT_COPY_COLUMNS = [...GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS,
  "state", "row_version", "put_outcome", "updated_at_ms", "put_started_at_ms", "put_settled_at_ms", "verified_at_ms", "published_at_ms", "published_claim_digest",
] as const;
const fail = (): never => { throw new Error("guest_image_result_copy_contract_invalid"); };
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
const wellFormed = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value: unknown, empty = false): value is string => typeof value === "string" && (empty || value.length > 0)
  // eslint-disable-next-line no-control-regex -- Identifier values must reject ASCII control characters.
  && wellFormed(value) && byteLength(value) <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
const owner = (value: unknown): value is string => text(value) && !value.startsWith("guest:") && !/^forma-guest-(session|claim)-v1\./u.test(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));

/** Check descriptors before reading properties. Aliases, getters, hidden keys,
 * sparse arrays and ill-formed UTF-16 are not our closed serialized values. */
function json(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 14) return fail();
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { if (!wellFormed(item) || byteLength(item) > 65536) return fail(); return; }
    if (typeof item === "number") { if (!Number.isFinite(item) || Object.is(item, -0)) return fail(); return; }
    if (!item || typeof item !== "object" || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item)) || seen.has(item)) return fail();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (["__proto__", "prototype", "constructor"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
        || Array.isArray(item) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && (item.length > 100 || Object.keys(item).length !== item.length)) return fail();
  };
  visit(value, 0);
}
function closed(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  json(value); if (!record(value) || !keys(value, expected)) return fail();
}
function parsed(raw: unknown, maximum: number): unknown {
  if (typeof raw !== "string" || !wellFormed(raw) || byteLength(raw) < 1 || byteLength(raw) > maximum) return fail();
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail(); }
  json(value); if (canonicalJson(value) !== raw) return fail(); return value;
}
const leaseKeys = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"] as const;
export function readGuestImageResultCopyLeaseSnapshot(value: unknown): GuestImageResultCopyLeaseSnapshot {
  closed(value, leaseKeys);
  if (!id(value.session_id) || !uuid(value.lease_id) || !owner(value.destination_user_id) || !sha(value.manifest_digest) || !id(value.request_id)
    || !integer(value.acquisitions, 1, 100) || !integer(value.created_at_ms, 1) || !integer(value.expires_at_ms, 1)
    || value.created_at_ms >= value.expires_at_ms) return fail();
  const history = parsed(value.request_ids_json, 16301);
  if (!Array.isArray(history) || history.length !== value.acquisitions || history.some(item => !id(item))
    || new Set(history).size !== history.length || history.at(-1) !== value.request_id) return fail();
  return freeze(structuredClone(value)) as GuestImageResultCopyLeaseSnapshot;
}

export function guestImageResultOriginalOutputId(generationId: unknown): string {
  if (!uuid(generationId)) return fail(); return `object-${generationId.slice(-8)}`;
}
type MediaKeyInput = Readonly<{ destinationUserId: string; custodyId: string; outputId: string; revisionId?: string }>;
export function guestImageResultMediaKey(value: MediaKeyInput): string {
  closed(value, ["destinationUserId", "custodyId", "outputId", ...(Object.hasOwn(value, "revisionId") ? ["revisionId"] : [])]);
  if (!owner(value.destinationUserId) || !uuid(value.custodyId) || typeof value.outputId !== "string" || !/^object-[a-f0-9]{8}$/u.test(value.outputId)
    || Object.hasOwn(value, "revisionId") && !uuid(value.revisionId)) return fail();
  const base = `${GUEST_IMAGE_RESULT_MEDIA_FAMILY}/${ownerMediaNamespace(value.destinationUserId)}/${value.custodyId}/${value.outputId}`;
  return Object.hasOwn(value, "revisionId") ? `${base}/revisions/${value.revisionId}.png` : `${base}.png`;
}
/** Classification intentionally includes malformed reserved-family keys. A
 * future denied reader must never fall through to legacy owner matching. */
export function isGuestImageResultMediaFamily(value: unknown): value is string {
  return typeof value === "string" && (value === GUEST_IMAGE_RESULT_MEDIA_FAMILY || value.startsWith(`${GUEST_IMAGE_RESULT_MEDIA_FAMILY}/`));
}
export function readGuestImageResultMediaKey(value: unknown): Readonly<{ destinationUserId: string; custodyId: string; outputId: string; revisionId: string | null }> {
  if (typeof value !== "string" || byteLength(value) > 1024) return fail();
  const match = /^guest-image-result-media-v1\/(u-(?:[a-f0-9]{2})+)\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/(object-[a-f0-9]{8})(?:\/revisions\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}))?\.png$/u.exec(value);
  if (!match) return fail();
  let destinationUserId: string;
  try { destinationUserId = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(match[1]!.slice(2).match(/../gu)!, pair => Number.parseInt(pair, 16))); }
  catch { return fail(); }
  const input = { destinationUserId, custodyId: match[2]!, outputId: match[3]!, ...(match[4] ? { revisionId: match[4] } : {}) };
  if (guestImageResultMediaKey(input) !== value) return fail();
  return freeze({ destinationUserId, custodyId: input.custodyId, outputId: input.outputId, revisionId: match[4] ?? null });
}
type MetadataInput = Pick<GuestImageResultCopyDescriptor, "attemptId" | "custodyId" | "destinationUserId" | "manifestDigest" | "manifest" | "writerNonce">;
export function guestImageResultCopyMetadata(value: MetadataInput): GuestImageResultCopyMetadata {
  closed(value, ["attemptId", "custodyId", "destinationUserId", "manifestDigest", "manifest", "writerNonce"]);
  const manifest = readGuestImageResultManifest(value.manifest);
  if (!uuid(value.attemptId) || !uuid(value.custodyId) || !owner(value.destinationUserId) || !sha(value.manifestDigest) || !uuid(value.writerNonce)
    || new Set([value.attemptId, value.custodyId, value.writerNonce]).size !== 3) return fail();
  return freeze({ version: "1", kind: "guest-image-result-copy", attemptId: value.attemptId, custodyId: value.custodyId,
    ownerId: value.destinationUserId, generationId: manifest.generationId, outputId: guestImageResultOriginalOutputId(manifest.generationId),
    manifestDigest: value.manifestDigest, nativeSnapshotDigest: manifest.nativeSnapshotDigest,
    sha256: manifest.object.contentSha256, mimeType: "image/png", writerNonce: value.writerNonce });
}

const descriptorKeys = ["version", "kind", "attemptId", "custodyId", "requestId", "destinationUserId", "manifestDigest", "manifest", "leaseSnapshot", "source", "destinationKey", "destinationMetadata", "writerNonce"] as const;
export function readGuestImageResultCopyDescriptor(value: unknown): GuestImageResultCopyDescriptor {
  closed(value, descriptorKeys);
  const manifest = readGuestImageResultManifest(value.manifest), lease = readGuestImageResultCopyLeaseSnapshot(value.leaseSnapshot);
  if (value.version !== 1 || value.kind !== "guest-image-result-copy" || !uuid(value.attemptId) || !uuid(value.custodyId) || !uuid(value.writerNonce)
    || new Set([value.attemptId, value.custodyId, value.writerNonce, lease.lease_id]).size !== 4 || !id(value.requestId)
    || !owner(value.destinationUserId) || !sha(value.manifestDigest) || lease.session_id !== manifest.sessionId
    || lease.destination_user_id !== value.destinationUserId || lease.request_id !== value.requestId || lease.manifest_digest !== value.manifestDigest
    || lease.created_at_ms < Date.parse(manifest.completedAt) || lease.created_at_ms >= Date.parse(manifest.expiresAt)
    || byteLength(canonicalJson(value)) > 65536) return fail();
  closed(value.source, ["byteLength", "producerMetadata"]);
  if (!integer(value.source.byteLength, 1, GUEST_IMAGE_RESULT_COPY_MAX_BYTES)) return fail();
  closed(value.source.producerMetadata, ["model", "provider", "adapter", "providerRequestId"]);
  const producer = value.source.producerMetadata;
  if (!text(producer.model) || producer.provider !== "openai" || !text(producer.adapter) || !text(producer.providerRequestId, true)) return fail();
  const expectedKey = guestImageResultMediaKey({ destinationUserId: value.destinationUserId, custodyId: value.custodyId,
    outputId: guestImageResultOriginalOutputId(manifest.generationId) });
  const expectedMetadata = guestImageResultCopyMetadata({ attemptId: value.attemptId, custodyId: value.custodyId,
    destinationUserId: value.destinationUserId, manifestDigest: value.manifestDigest, manifest, writerNonce: value.writerNonce });
  if (value.destinationKey !== expectedKey || canonicalJson(value.destinationMetadata) !== canonicalJson(expectedMetadata)) return fail();
  return freeze(structuredClone(value)) as GuestImageResultCopyDescriptor;
}
/** Hash equality only, never a substitute for native producer/source proof. */
export async function validateGuestImageResultCopyDescriptor(value: unknown): Promise<GuestImageResultCopyDescriptor> {
  const captured = readGuestImageResultCopyDescriptor(value);
  if (await digest(captured.manifest) !== captured.manifestDigest) return fail(); return captured;
}
export async function guestImageResultCopyDescriptorDigest(value: unknown): Promise<string> {
  return digest(await validateGuestImageResultCopyDescriptor(value));
}

function rowShape(value: unknown): { row: GuestImageResultCopyAttemptRow; descriptor: GuestImageResultCopyDescriptor } {
  closed(value, GUEST_IMAGE_RESULT_COPY_COLUMNS);
  const descriptor = readGuestImageResultCopyDescriptor(parsed(value.descriptor_json, 65536)), manifest = descriptor.manifest, lease = descriptor.leaseSnapshot;
  if (!sha(value.descriptor_digest) || value.lease_snapshot_json !== canonicalJson(lease) || value.destination_metadata_json !== canonicalJson(descriptor.destinationMetadata)) return fail();
  const expected = { attempt_id: descriptor.attemptId, custody_id: descriptor.custodyId, session_id: manifest.sessionId, destination_user_id: descriptor.destinationUserId,
    lease_id: lease.lease_id, lease_acquisition: lease.acquisitions, request_id: descriptor.requestId, manifest_digest: descriptor.manifestDigest,
    source_expires_at_ms: Date.parse(manifest.expiresAt), destination_key: descriptor.destinationKey, writer_nonce: descriptor.writerNonce,
    content_sha256: manifest.object.contentSha256, byte_length: descriptor.source.byteLength, mime_type: "image/png", width: manifest.object.width, height: manifest.object.height };
  if (Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)
    || !integer(value.row_version) || !integer(value.created_at_ms, 1) || !integer(value.updated_at_ms, value.created_at_ms)
    || value.created_at_ms < lease.created_at_ms || value.created_at_ms >= Math.min(lease.expires_at_ms, Number(value.source_expires_at_ms))
    || !["reserved", "writing", "ready", "cleanup_pending", "deleted", "published"].includes(String(value.state))
    || !["pending", "unknown", "success", "conditional-null"].includes(String(value.put_outcome))) return fail();
  for (const field of ["put_started_at_ms", "put_settled_at_ms", "verified_at_ms", "published_at_ms"] as const)
    if (value[field] !== null && !integer(value[field], value.created_at_ms, value.updated_at_ms)) return fail();
  const started = value.put_started_at_ms as number | null, settled = value.put_settled_at_ms as number | null;
  const verified = value.verified_at_ms as number | null, published = value.published_at_ms as number | null;
  const settledOutcome = value.put_outcome === "success" || value.put_outcome === "conditional-null";
  if (started === null ? value.put_outcome !== "pending" || settled !== null || verified !== null
    : started >= Math.min(lease.expires_at_ms, Number(value.source_expires_at_ms))) return fail();
  if (settledOutcome !== (settled !== null) || settled !== null && (started === null || settled < started)
    || value.put_outcome === "unknown" && started === null
    || verified !== null && (value.put_outcome !== "success" || settled === null || verified < settled
      || verified >= Math.min(lease.expires_at_ms, Number(value.source_expires_at_ms)))) return fail();
  if (value.state === "reserved" && (value.row_version !== 0 || value.updated_at_ms !== value.created_at_ms || started !== null)
    || value.state !== "reserved" && value.row_version === 0
    || value.state === "writing" && (started === null || verified !== null)
    || (value.state === "ready" || value.state === "published") && (value.put_outcome !== "success" || verified === null)
    || value.state === "deleted" && (value.put_outcome === "unknown" || started !== null && !settledOutcome)) return fail();
  if (value.state === "published") {
    if (!sha(value.published_claim_digest) || published === null || verified === null || published < verified
      || published !== value.updated_at_ms || published >= Math.min(lease.expires_at_ms, Number(value.source_expires_at_ms))) return fail();
  } else if (published !== null || value.published_claim_digest !== null) return fail();
  return { row: freeze(structuredClone(value)) as GuestImageResultCopyAttemptRow, descriptor };
}
async function rowDigests(captured: ReturnType<typeof rowShape>): Promise<void> {
  if (await digest(captured.descriptor.manifest) !== captured.row.manifest_digest
    || await digest(captured.descriptor) !== captured.row.descriptor_digest) return fail();
}
export async function readGuestImageResultCopyAttemptRow(value: unknown): Promise<GuestImageResultCopyAttemptRow> {
  const captured = rowShape(value); await rowDigests(captured); return captured.row;
}

/** Describes one exact CAS successor. It grants no dispatch token, SQL bypass,
 * settlement acknowledgement, readback proof, cleanup or publication authority. */
export async function assertGuestImageResultCopyTransition(before: unknown, after: unknown): Promise<void> {
  // Capture both full tuples before the first asynchronous hash operation.
  const first = rowShape(before), second = rowShape(after), previous = first.row, next = second.row;
  await rowDigests(first); await rowDigests(second);
  if (GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS.some(column => previous[column] !== next[column])
    || next.row_version !== previous.row_version + 1 || next.updated_at_ms < previous.updated_at_ms
    || previous.state === "published" || previous.state === "deleted") return fail();
  const allowed = previous.state === "reserved" ? ["writing", "cleanup_pending"] : previous.state === "writing" ? ["writing", "ready", "cleanup_pending"]
    : previous.state === "ready" ? ["published", "cleanup_pending"] : ["cleanup_pending", "deleted"];
  if (!allowed.includes(next.state)) return fail();
  const outcomes = previous.put_outcome === "pending" ? ["pending", "unknown", "success", "conditional-null"]
    : previous.put_outcome === "unknown" ? ["unknown", "success", "conditional-null"] : [previous.put_outcome];
  if (!outcomes.includes(next.put_outcome) || previous.state === next.state && previous.put_outcome === next.put_outcome) return fail();
  for (const field of ["put_started_at_ms", "put_settled_at_ms", "verified_at_ms"] as const)
    if (previous[field] !== null && next[field] !== previous[field]) return fail();
  if (previous.put_started_at_ms === null && next.put_started_at_ms !== null
    && !(previous.state === "reserved" && next.state === "writing" && next.put_outcome === "pending" && next.put_started_at_ms === next.updated_at_ms)) return fail();
  if (previous.put_settled_at_ms === null && next.put_settled_at_ms !== null
    && (previous.put_started_at_ms === null || next.put_settled_at_ms !== next.updated_at_ms)) return fail();
  if (previous.verified_at_ms === null && next.verified_at_ms !== null
    && !(previous.state === "writing" && previous.put_outcome === "success" && next.state === "ready" && next.verified_at_ms === next.updated_at_ms)) return fail();
  if (next.state === "published" && (previous.state !== "ready" || next.published_at_ms !== next.updated_at_ms)) return fail();
}
