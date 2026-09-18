import { canonicalJson, digest, freeze, exactKeys, record } from "../src/experiences/compiler.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { GUEST_DB_NOW, guestId } from "./experience-guest-session.ts";
import { readGuestImageStageClaimLeaseRow } from "./experience-guest-image-stage-claim-inventory.ts";
import { guestImageResultReservedAttemptProof, guestImageResultWritingAttemptProof, guestImageResultReadyAttemptProof, guestImageResultCleanupAttemptProof } from "./experience-guest-image-result-facts.ts";
import {
  handoffGuestImageResultInventory, guestImageResultClaimSeedData, guestImageResultClaimSeedBounds,
  assertGuestImageResultClaimSeedLocal, type GuestImageResultInventory, type GuestImageResultClaimSeed,
  inspectRetainedGuestImageResultReady, takeGuestImageResultRetainedReadySeed,
  assertGuestImageResultRetainedReadyLocal, assertGuestImageResultRetainedReadyCurrent,
  type GuestImageResultRetainedReadyOwner, type GuestImageResultRetainedReadyData,
} from "./experience-guest-image-result-inventory.ts";
import {
  GUEST_IMAGE_RESULT_COPY_COLUMNS, GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS, assertGuestImageResultCopyTransition, readGuestImageResultCopyAttemptRow, validateGuestImageResultCopyDescriptor,
  guestImageResultCopyMetadata, guestImageResultMediaKey, guestImageResultOriginalOutputId,
  type GuestImageResultCopyAttemptRow, type GuestImageResultCopyDescriptor, type GuestImageResultCopyLeaseSnapshot,
} from "./experience-guest-image-result-copy-contract.ts";
import { takeGuestImageResultClaimMediaAdmission, retireGuestImageResultClaimMediaAdmission, takeGuestImageResultCopyUse, type GuestImageResultClaimMediaAdmission, type GuestImageResultCopyUse } from "./experience-guest-image-result-media.ts";
import { takeGuestImageResultPutSettlement, takeGuestImageResultDestinationProof, takeGuestImageResultCleanupProof, proveGuestImageResultFinalDestination, verifyRetainedGuestImageResultDestination, type GuestImageResultCleanupProof, type GuestImageResultPutSettlement, type GuestImageResultDestinationProof } from "./experience-guest-image-result-copy-writer.ts";
import type { Proof } from "./experience-guest-image-history.ts";
import type { WorkerEnv } from "./runtime.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeStructuredOriginSchemaRead } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchemaRead } from "./memory-document-job-origin-schema.ts";
import { draftGuestImageResultClaimCandidate, finishGuestImageResultClaimCandidate } from "./experience-guest-image-result-claim.ts";
import { guestImageResultClaimPublicationAvailable, guestImageResultPublishedGraphProofs, type GuestImageResultPublishedGraph } from "./experience-guest-image-result-facts.ts";
import { guestImageResultWholeGraphProof } from "./experience-guest-image-result-custody.ts";
import { readGuestImageResultClaimLineage, type GuestImageResultCompletedCustodyReview } from "./experience-guest-image-result-claim-contract.ts";
import { insertEventAtHead } from "./event-append.ts";
import { MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";

/** Dormant fixed lease/reserve, copy journal and atomic custody owner.
 * No schema installation, route, lease reacquisition or physical PUT is provided here. */
const fail = (part = "unavailable"): never => { throw new Error(`guest_image_result_claim_source_${part}`); };
const own = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
const successful = (value: unknown) => own(value, "success") === true
  && (!(value && typeof value === "object" && "error" in value) || own(value, "error") === undefined
    && !!Object.getOwnPropertyDescriptor(value, "error") && Object.hasOwn(Object.getOwnPropertyDescriptor(value, "error")!, "value"));
const leaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"] as const;
const tuple = (value: Record<string, unknown>, columns: readonly string[]) => JSON.stringify(columns.map(column => value[column]));
const leaseProof = (row: GuestImageResultCopyLeaseSnapshot): Proof => ({
  sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE json_array(${leaseColumns.join(",")})=?
    AND created_at_ms<=${GUEST_DB_NOW} AND expires_at_ms>${GUEST_DB_NOW})`,
  bindings: [tuple(row, leaseColumns)],
});

declare const sourceBrand: unique symbol;
declare const resourceBrand: unique symbol;
declare const reservedBrand: unique symbol;
export type GuestImageResultClaimSource = Readonly<{ [sourceBrand]: true }>;
export type GuestImageResultClaimResource = Readonly<{ [resourceBrand]: true }>;
export type GuestImageResultReservedSource = Readonly<{ [reservedBrand]: true }>;
type Phase = "acquiring" | "leased" | "reserving" | "reserved" | "unknown" | "copy" | "ready" | "claiming" | "claimed";
type SeedData = ReturnType<typeof guestImageResultClaimSeedData>;
class Owner {
  readonly request: Request; readonly env: WorkerEnv; readonly database: WorkerEnv["DB"]; readonly bucket: WorkerEnv["MEDIA"];
  readonly seed: GuestImageResultClaimSeed; readonly data: SeedData; readonly requestId: string;
  readonly deadline: number; readonly signal: AbortSignal;
  readonly resource: GuestImageResultClaimResource;
  expiresAtMs: number; stopped = false; phase: Phase = "acquiring";
  destinationUserId: string | null = null; lease: GuestImageResultCopyLeaseSnapshot | null = null;
  constructor(request: Request, env: WorkerEnv, seed: GuestImageResultClaimSeed, requestId: string) {
    this.request = request; this.env = env; this.database = env.DB; this.bucket = env.MEDIA; this.signal = request.signal;
    this.seed = seed; this.data = guestImageResultClaimSeedData(request, env, seed); this.requestId = requestId;
    const bounds = guestImageResultClaimSeedBounds(request, env, seed);
    this.deadline = bounds.monotonicDeadline; this.expiresAtMs = bounds.expiresAtMs;
    this.resource = Object.freeze({}) as GuestImageResultClaimResource;
    this.check();
  }
  check() {
    try {
      if (this.stopped || this.request.signal !== this.signal || this.signal.aborted || this.env.DB !== this.database
        || this.env.MEDIA !== this.bucket || performance.now() >= this.deadline || Date.now() >= this.expiresAtMs) return fail("lifetime_ended");
      assertGuestImageResultClaimSeedLocal(this.request, this.env, this.seed);
    } catch (error) { this.stopped = true; throw error; }
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check(); let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    const ended = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("guest_image_result_claim_source_deadline")),
        Math.max(1, Math.min(this.deadline - performance.now(), this.expiresAtMs - Date.now())));
      stop = () => reject(new Error("guest_image_result_claim_source_aborted"));
      this.signal.addEventListener("abort", stop, { once: true }); if (this.signal.aborted) stop();
    });
    const pending = Promise.resolve().then(() => { this.check(); return work(); });
    try { const value = await Promise.race([pending, ended]); this.check(); return value; }
    catch (error) { this.stopped = true; throw error; }
    finally { clearTimeout(timer); if (stop) this.signal.removeEventListener("abort", stop); void pending.catch(() => undefined); }
  }
}
const sources = new WeakMap<GuestImageResultClaimSource, Owner>();
const resources = new WeakMap<GuestImageResultClaimResource, Owner>();
type Reserved = { owner: Owner; row: GuestImageResultCopyAttemptRow; descriptor: GuestImageResultCopyDescriptor; admission: GuestImageResultClaimMediaAdmission };
const reservations = new WeakMap<GuestImageResultReservedSource, Reserved>();
function bound<T extends { owner: Owner }>(request: Request, env: WorkerEnv, value: T | undefined): T {
  if (!value || value.owner.request !== request || value.owner.env !== env) return fail("capability_unavailable");
  value.owner.check(); return value;
}
function source(request: Request, env: WorkerEnv, token: GuestImageResultClaimSource): Owner {
  const value = token && typeof token === "object" ? sources.get(token) : undefined;
  const owner = bound(request, env, value ? { owner: value } : undefined).owner;
  if (owner.phase !== "leased") return fail("source_retired"); return owner;
}
function reserved(request: Request, env: WorkerEnv, token: GuestImageResultReservedSource): Reserved {
  const value = token && typeof token === "object" ? reservations.get(token) : undefined;
  try {
    const current = bound(request, env, value);
    if (current.owner.phase !== "reserved") return fail("reservation_retired"); return current;
  } catch (error) {
    if (value?.owner.request === request && value.owner.env === env && value.owner.stopped)
      retireGuestImageResultClaimMediaAdmission(request, env, value.admission);
    throw error;
  }
}
function statements(owner: Owner, parts: readonly Proof[], throwing: boolean) {
  owner.check(); if (!parts.length || parts.length > 256) return fail("proof_bound");
  return parts.map(part => {
    const sql = `SELECT CASE WHEN (${part.sql}) THEN 1 ELSE ${throwing ? "json_extract('invalid', '$.assertion')" : "0"} END AS current`;
    if (new TextEncoder().encode(sql).byteLength > 100000 || part.bindings.length > 100) return fail("proof_bound");
    return owner.database.prepare(sql).bind(...part.bindings);
  });
}
function proofResults(value: unknown, count: number): boolean {
  if (!Array.isArray(value) || value.length !== count) return false;
  for (let index = 0; index < count; index++) {
    const result = own(value, index), rows = own(result, "results");
    if (!successful(result) || !Array.isArray(rows) || rows.length !== 1 || own(own(rows, 0), "current") !== 1) return false;
  }
  return true;
}
async function prove(owner: Owner, parts: readonly Proof[]) {
  const result = await owner.wait(() => owner.database.batch(statements(owner, parts, false)));
  if (!proofResults(result, parts.length)) { owner.stopped = true; return fail("proof_unavailable"); }
  owner.check();
}
async function authority(owner: Owner, copy?: CopyState): Promise<Proof> {
  owner.check();
  if ((owner.request.headers.get("cookie") ?? "").split(";").some(part =>
    ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("personal_principal_required");
  const auth = await owner.wait(() => readExistingPrincipalRequest(owner.request, copy ? copyPrincipalEnvironment(copy) : owner.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")
    || owner.destinationUserId !== null && owner.destinationUserId !== auth.user.userId) return fail("destination_unavailable");
  const { manifest } = owner.data.data;
  const native = projectIntakeAuthority(owner.env, { user: auth.user, principal: auth.user, impersonation: null },
    { projectId: manifest.projectId, documentId: manifest.documentId });
  owner.destinationUserId = auth.user.userId; owner.check(); return freeze({ sql: native.sql, bindings: [...native.bindings] });
}
async function now(owner: Owner) {
  const row = await owner.wait(() => owner.database.prepare(`SELECT ${GUEST_DB_NOW} AS now`).first<{ now: number }>());
  const value = own(row, "now");
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < owner.data.session.row.created_at_ms
    || value < Date.parse(owner.data.data.manifest.completedAt) || value >= owner.expiresAtMs) return fail("clock_invalid");
  return value;
}
function common(owner: Owner | RetainedOwner, auth: Proof): Proof[] { return [...owner.data.claimSourceProofs.common, auth]; }
function leasedParts(owner: Owner, auth: Proof): Proof[] {
  if (!owner.lease) return fail("lease_unavailable");
  return [...common(owner, auth), leaseProof(owner.lease), owner.data.claimSourceProofs.attemptAbsent];
}
/** Fixed batches use throwing read assertions to force the native transaction
 * to roll back on any before/after failure. No assertion table is mutated. */
async function transition(owner: Owner, before: readonly Proof[], mutation: D1PreparedStatement, after: readonly Proof[]): Promise<boolean> {
  const pre = statements(owner, before, true), post = statements(owner, after, true), all = [...pre, mutation, ...post];
  if (all.length > 512) return fail("transaction_bound");
  // A captured transport/ACK failure is uncertain, not permission to retry.
  const observed = await owner.wait(async () => { try { return { result: await owner.database.batch(all) }; } catch { return { result: undefined }; } });
  const result: unknown = observed.result;
  if (!Array.isArray(result) || result.length !== all.length || !proofResults(result.slice(0, pre.length), pre.length)
    || !proofResults(result.slice(pre.length + 1), post.length)) return false;
  const written = own(result, pre.length), meta = own(written, "meta");
  return successful(written) && own(meta, "changes") === 1;
}

export async function acquireGuestImageResultClaimSource(request: Request, env: WorkerEnv,
  input: { inventory: GuestImageResultInventory; requestId: string }): Promise<GuestImageResultClaimSource> {
  if (!record(input) || !exactKeys(input, ["inventory", "requestId"]) || !guestId(own(input, "requestId"))
    || /^forma-guest-(session|claim)-v1\./u.test(own(input, "requestId") as string)) return fail("input_invalid");
  const inventory = own(input, "inventory") as GuestImageResultInventory;
  const requestId = own(input, "requestId") as string;
  const seed = handoffGuestImageResultInventory(request, env, inventory), owner = new Owner(request, env, seed, requestId);
  try {
    if (!owner.data.claimSourceProofs.resultCopySchemaInstalled) return fail("result_schema_required");
    const auth = await authority(owner), clock = await now(owner), session = owner.data.session;
    const lease = readGuestImageStageClaimLeaseRow({ session_id: owner.data.data.manifest.sessionId, lease_id: crypto.randomUUID(),
      destination_user_id: owner.destinationUserId, manifest_digest: owner.data.data.manifestDigest, request_id: owner.requestId,
      request_ids_json: JSON.stringify([owner.requestId]), acquisitions: 1, created_at_ms: clock,
      expires_at_ms: Math.min(clock + session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms) }, session,
    owner.destinationUserId!, owner.data.data.manifestDigest);
    owner.lease = lease; owner.expiresAtMs = Math.min(owner.expiresAtMs, lease.expires_at_ms); owner.check();
    const mutation = owner.database.prepare(`INSERT INTO experience_guest_claim_leases(${leaseColumns.join(",")}) VALUES(${leaseColumns.map(() => "?").join(",")})`)
      .bind(...leaseColumns.map(column => lease[column]));
    await transition(owner, [...common(owner, auth), owner.data.claimSourceProofs.leaseAbsent, owner.data.claimSourceProofs.attemptAbsent], mutation, leasedParts(owner, auth));
    // Both known and uncertain ACKs have exactly one bounded actual row read;
    // no mutation retry occurs and all nine values must match our native tuple.
    const actual = await owner.wait(() => owner.database.prepare(`SELECT ${leaseColumns.join(",")} FROM experience_guest_claim_leases
      WHERE session_id=? AND length(CAST(request_ids_json AS BLOB))<=32768`).bind(lease.session_id).first());
    const retained = readGuestImageStageClaimLeaseRow(actual, session, owner.destinationUserId!, owner.data.data.manifestDigest);
    if (canonicalJson(retained) !== canonicalJson(lease)) return fail("lease_changed");
    await prove(owner, leasedParts(owner, await authority(owner))); owner.check();
    owner.phase = "leased";
    const token = Object.freeze({}) as GuestImageResultClaimSource;
    sources.set(token, owner); resources.set(owner.resource, owner); return token;
  } catch (error) { owner.stopped = true; throw error; }
}
export function guestImageResultClaimSourceData(request: Request, env: WorkerEnv, token: GuestImageResultClaimSource) {
  const owner = source(request, env, token);
  return freeze({ manifest: owner.data.data.manifest, manifestDigest: owner.data.data.manifestDigest,
    producerMetadata: owner.data.producerMetadata, bounds: { monotonicDeadline: owner.deadline, expiresAtMs: owner.expiresAtMs } });
}
export function guestImageResultClaimSourceResource(request: Request, env: WorkerEnv, token: GuestImageResultClaimSource) {
  const owner = source(request, env, token);
  return freeze({ ...guestImageResultClaimSourceData(request, env, token), resource: owner.resource, accountingKey: owner.data.accountingKey });
}
/** Resource currentness only: this survives a normal reserve to account for its
 * one admitted copy. It can never substitute for a source/attempt proof. */
export function assertGuestImageResultClaimResourceLocal(request: Request, env: WorkerEnv, resource: GuestImageResultClaimResource) {
  const owner = resource && typeof resource === "object" ? resources.get(resource) : undefined;
  bound(request, env, owner ? { owner } : undefined);
}
export async function assertGuestImageResultClaimSourceCurrent(request: Request, env: WorkerEnv, token: GuestImageResultClaimSource) {
  const owner = source(request, env, token);
  try { await prove(owner, leasedParts(owner, await authority(owner))); source(request, env, token); }
  catch (error) { owner.stopped = true; throw error; }
}

/** The only reservation entry consumes a genuine media-producer admission.
 * Its actual inspected byte length and source are not supplied by a caller DTO. */
export async function reserveGuestImageResultClaimAdmission(request: Request, env: WorkerEnv, admission: GuestImageResultClaimMediaAdmission) {
  const media = takeGuestImageResultClaimMediaAdmission(request, env, admission), owner = source(request, env, media.source);
  owner.phase = "reserving";
  try {
    const auth = await authority(owner); await prove(owner, leasedParts(owner, auth));
    const clock = await now(owner), lease = owner.lease!, manifest = owner.data.data.manifest;
    const attemptId = crypto.randomUUID(), custodyId = crypto.randomUUID(), writerNonce = crypto.randomUUID();
    const base = { version: 1 as const, kind: "guest-image-result-copy" as const, attemptId, custodyId, requestId: owner.requestId,
      destinationUserId: owner.destinationUserId!, manifestDigest: owner.data.data.manifestDigest, manifest, leaseSnapshot: lease,
      source: { byteLength: media.review.byteLength, producerMetadata: owner.data.producerMetadata }, writerNonce };
    const descriptor = await owner.wait(() => validateGuestImageResultCopyDescriptor({ ...base,
      destinationKey: guestImageResultMediaKey({ destinationUserId: base.destinationUserId, custodyId, outputId: guestImageResultOriginalOutputId(manifest.generationId) }),
      destinationMetadata: guestImageResultCopyMetadata({ attemptId, custodyId, destinationUserId: base.destinationUserId,
        manifestDigest: base.manifestDigest, manifest, writerNonce }) }));
    const descriptorDigest = await owner.wait(() => digest(descriptor));
    const expected = await owner.wait(() => readGuestImageResultCopyAttemptRow({ attempt_id: attemptId, custody_id: custodyId,
      session_id: manifest.sessionId, destination_user_id: base.destinationUserId, lease_id: lease.lease_id, lease_acquisition: lease.acquisitions,
      request_id: owner.requestId, manifest_digest: base.manifestDigest, descriptor_json: canonicalJson(descriptor), descriptor_digest: descriptorDigest,
      lease_snapshot_json: canonicalJson(lease), source_expires_at_ms: Date.parse(manifest.expiresAt), destination_key: descriptor.destinationKey,
      writer_nonce: writerNonce, content_sha256: manifest.object.contentSha256, byte_length: media.review.byteLength, mime_type: "image/png",
      width: manifest.object.width, height: manifest.object.height, destination_metadata_json: canonicalJson(descriptor.destinationMetadata),
      state: "reserved", row_version: 0, put_outcome: "pending", created_at_ms: clock, updated_at_ms: clock,
      put_started_at_ms: null, put_settled_at_ms: null, verified_at_ms: null, published_at_ms: null, published_claim_digest: null }));
    const rowProof = guestImageResultReservedAttemptProof(owner.data.claimSourceFacts, expected);
    const after = [...common(owner, auth), leaseProof(lease), rowProof];
    const mutation = owner.database.prepare(`INSERT INTO experience_guest_image_result_copy_attempts(${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")})
      VALUES(${GUEST_IMAGE_RESULT_COPY_COLUMNS.map(() => "?").join(",")})`).bind(...GUEST_IMAGE_RESULT_COPY_COLUMNS.map(column => expected[column]));
    const known = await transition(owner, leasedParts(owner, auth), mutation, after);
    const actual = await owner.wait(() => owner.database.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
      WHERE attempt_id=? AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=32768
      AND length(CAST(destination_metadata_json AS BLOB))<=16384`).bind(attemptId).first());
    const retained = await owner.wait(() => readGuestImageResultCopyAttemptRow(actual));
    if (canonicalJson(retained) !== canonicalJson(expected)) return fail("attempt_changed");
    await prove(owner, [...common(owner, await authority(owner)), leaseProof(lease), guestImageResultReservedAttemptProof(owner.data.claimSourceFacts, retained)]);
    owner.check();
    if (!known) {
      owner.phase = "unknown";
      return freeze({ status: "reservation-unknown" as const, recovery: { version: 1 as const, kind: "guest-image-result-reservation-unknown" as const,
        attemptId, custodyId, manifestDigest: base.manifestDigest, dispatchAllowed: false as const, custodyTransferred: false as const } });
    }
    owner.phase = "reserved";
    const reservation = Object.freeze({}) as GuestImageResultReservedSource;
    reservations.set(reservation, { owner, row: retained, descriptor, admission });
    return freeze({ status: "reserved" as const, reservation });
  } catch (error) { owner.stopped = true; throw error; }
}
export function guestImageResultReservedReview(request: Request, env: WorkerEnv, token: GuestImageResultReservedSource) {
  const { owner, row } = reserved(request, env, token);
  return freeze({ version: 1 as const, kind: "guest-image-result-reservation" as const, status: "reserved" as const,
    attemptId: row.attempt_id, custodyId: row.custody_id, destinationUserId: row.destination_user_id,
    manifestDigest: row.manifest_digest, byteLength: row.byte_length, expiresAtMs: owner.expiresAtMs,
    freshBytesVerified: true as const, custodyTransferred: false as const, publicReadAvailable: false as const });
}
export async function assertGuestImageResultReservedCurrent(request: Request, env: WorkerEnv, token: GuestImageResultReservedSource) {
  const value = reserved(request, env, token), { owner, row } = value;
  try {
    await prove(owner, [...common(owner, await authority(owner)), leaseProof(owner.lease!), guestImageResultReservedAttemptProof(owner.data.claimSourceFacts, row)]);
    reserved(request, env, token);
  } catch (error) {
    owner.stopped = true; retireGuestImageResultClaimMediaAdmission(request, env, value.admission); throw error;
  }
}

/** Fixed writer phases extend the original accounting identity. They do not
 * replenish any source-media count, start another lifetime or change money. */
export const GUEST_IMAGE_RESULT_WRITER_LIMITS = Object.freeze({
  maximumProofParts: 255, statements: 1825, principalInvocations: 7, principalReads: 21, clockReads: 3,
  sqlBytesPerStatement: 100_000, bindings: 100, bindingEnvelopeBytes: 1_048_576,
  largeEnvelopeBytes: 1_048_576, scalarEnvelopeBytes: 16_384, batchWrapperBytes: 512,
  returnedEnvelopeReservation: 56_741_888,
  put: 1, destinationGet: 1, destinationHead: 1, destinationStreamReads: 65_536,
  destinationMetadataCaptures: 3, destinationMetadataBytes: 98_304,
  cleanupHead: 2, cleanupDelete: 1, cleanupMetadataCaptures: 2, cleanupMetadataBytes: 65_536,
});
type WriterLane = "writing" | "destination" | "ready" | "settlement" | "cleanup-fence" | "cleanup-finish" | "principal" | "clock";
type SqlItem = Readonly<{ sql: string; bindings: readonly unknown[] }>;
type LaneState = { statements: number; batches: number; large: number; spentStatements: number; spentBatches: number; spentLarge: number };
type StorageCharge = "put" | "destinationGet" | "destinationHead" | "destinationStreamReads" | "destinationMetadataCaptures" | "destinationMetadataBytes"
  | "cleanupHead" | "cleanupDelete" | "cleanupMetadataCaptures" | "cleanupMetadataBytes";
const encode = new TextEncoder();
const unavailableCopy = (): never => fail("copy_unavailable");

/** A complete own-data envelope measurement. Undefined is measured as the
 * explicit thirteen-byte ["undefined"] marker, not omitted by JSON.stringify.
 * This is an accounting convention, not a claim about HTTP wire encoding. */
function envelopeBytes(value: unknown, maximum: number): number {
  const seen = new Set<object>(); let total = 0, nodes = 0;
  const add = (n: number) => { total += n; if (!Number.isSafeInteger(total) || total > maximum) return unavailableCopy(); };
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 131072 || depth > 16) return unavailableCopy();
    if (item === undefined) { add(13); return; }
    if (item === null) { add(4); return; }
    if (typeof item === "boolean") { add(item ? 4 : 5); return; }
    if (typeof item === "number") { if (!Number.isFinite(item) || Object.is(item, -0)) return unavailableCopy(); add(String(item).length); return; }
    if (typeof item === "string") {
      if (!item.isWellFormed() || item.length > maximum) return unavailableCopy();
      add(encode.encode(JSON.stringify(item)).byteLength); return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return unavailableCopy();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return unavailableCopy();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 4096 || keys.some(key => typeof key !== "string")) return unavailableCopy();
    if (array) {
      const length = own(item, "length");
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length > 2048 || keys.length !== length + 1) return unavailableCopy();
      add(2 + Math.max(0, length - 1));
      for (let i = 0; i < length; i++) {
        const d = descriptors[String(i)]; if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return unavailableCopy(); visit(d.value, depth + 1);
      }
    } else {
      add(2 + Math.max(0, keys.length - 1));
      for (const key of keys as string[]) {
        const d = descriptors[key]!;
        if (!d.enumerable || !Object.hasOwn(d, "value") || !key.isWellFormed()) return unavailableCopy();
        add(encode.encode(JSON.stringify(key)).byteLength + 1); visit(d.value, depth + 1);
      }
    }
  };
  visit(value, 0); return total;
}

class CopyBudget {
  readonly lanes: Record<WriterLane, LaneState>;
  readonly storage = new Map<StorageCharge, number>();
  readonly requestReservation: number;
  readonly resultReservation: number;
  actualRequestBytes = 0; actualResultBytes = 0; principalCalls = 0; failed = false;
  constructor(parts: number) {
    if (!Number.isSafeInteger(parts) || parts < 1 || parts > GUEST_IMAGE_RESULT_WRITER_LIMITS.maximumProofParts) unavailableCopy();
    const lane = (statements: number, batches: number, large: number): LaneState => ({ statements, batches, large, spentStatements: 0, spentBatches: 0, spentLarge: 0 });
    this.lanes = {
      writing: lane(3 * parts + 2, 2, 1), destination: lane(parts, 1, 0), ready: lane(3 * parts + 2, 2, 1),
      settlement: lane(4, 1, 1), "cleanup-fence": lane(4, 1, 1), "cleanup-finish": lane(4, 1, 1),
      principal: lane(21, 0, 21), clock: lane(3, 0, 0),
    };
    // All maxima are reserved once. Actual measurements never refund a slot or
    // make an unspent source allowance usable by these new phases.
    const statements = 7 * parts + 40;
    this.requestReservation = statements * (100_000 + 1_048_576);
    this.resultReservation = 26 * 1_048_576 + (statements - 26) * 16_384 + 8 * 512;
    if (statements > GUEST_IMAGE_RESULT_WRITER_LIMITS.statements || this.resultReservation > GUEST_IMAGE_RESULT_WRITER_LIMITS.returnedEnvelopeReservation) return unavailableCopy();
  }
  admit(laneName: WriterLane, items: readonly SqlItem[], batch: boolean, large: boolean) {
    const lane = this.lanes[laneName];
    if (!items.length || items.length > 511 || lane.spentStatements + items.length > lane.statements
      || batch && lane.spentBatches + 1 > lane.batches || large && (items.length !== 1 || lane.spentLarge + 1 > lane.large)) return unavailableCopy();
    let bytes = 0;
    for (const item of items) {
      const sqlBytes = encode.encode(item.sql).byteLength;
      if (sqlBytes > 100_000 || item.bindings.length > 100) return unavailableCopy();
      bytes += sqlBytes + envelopeBytes([...item.bindings], 1_048_576);
    }
    if (this.actualRequestBytes + bytes > this.requestReservation) return unavailableCopy();
    lane.spentStatements += items.length; if (batch) lane.spentBatches++; if (large) lane.spentLarge++;
    this.actualRequestBytes += bytes;
  }
  result(value: unknown, count: number, batch: boolean, large: boolean) {
    let bytes = 0;
    if (batch) {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== count || count > 511) return unavailableCopy();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(descriptors).length !== count + 1) return unavailableCopy();
      bytes = count + 1;
      if (bytes > 512) return unavailableCopy();
      for (let i = 0; i < count; i++) {
        const d = descriptors[String(i)]; if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return unavailableCopy();
        bytes += envelopeBytes(d.value, 16_384);
      }
    } else bytes = envelopeBytes(value, large ? 1_048_576 : 16_384);
    if (this.actualResultBytes + bytes > this.resultReservation) return unavailableCopy();
    this.actualResultBytes += bytes;
  }
  charge(kind: StorageCharge, count = 1) {
    const maximum = GUEST_IMAGE_RESULT_WRITER_LIMITS[kind], next = (this.storage.get(kind) ?? 0) + count;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(next) || next > maximum) return unavailableCopy();
    this.storage.set(kind, next);
  }
}

declare const copyOwnerBrand: unique symbol;
declare const dispatchBrand: unique symbol;
declare const readyBrand: unique symbol;
export type GuestImageResultCopyOwner = Readonly<{ [copyOwnerBrand]: true }>;
export type GuestImageResultCopyDispatch = Readonly<{ [dispatchBrand]: true }>;
export type GuestImageResultReadySource = Readonly<{ [readyBrand]: true }>;
type CopyState = Reserved & { token: GuestImageResultCopyOwner; budget: CopyBudget; dispatchTaken: boolean; settlementTaken: boolean;
  destinationAdmitted: boolean; readyTaken: boolean; cleanupTaken: boolean; cleanupFinished: boolean; settled: boolean };
const copyOwners = new WeakMap<GuestImageResultCopyOwner, CopyState>();
const copyAccounts = new WeakSet<object>();
const dispatches = new WeakMap<GuestImageResultCopyDispatch, CopyState>();
const readySources = new WeakMap<GuestImageResultReadySource, CopyState>();
function copyState(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner, current = true): CopyState {
  const state = token && typeof token === "object" ? copyOwners.get(token) : undefined;
  if (!state || state.owner.request !== request || state.owner.env !== env) return unavailableCopy();
  if (current) { state.owner.check(); if (state.owner.phase !== "copy") return unavailableCopy(); }
  return state;
}
function spec(sql: string, bindings: readonly unknown[] = []): SqlItem { return { sql, bindings }; }
function copyStatements(parts: readonly Proof[], throwing: boolean): SqlItem[] {
  if (!parts.length || parts.length > 255) return unavailableCopy();
  return parts.map(part => spec(`SELECT CASE WHEN (${part.sql}) THEN 1 ELSE ${throwing ? "json_extract('invalid', '$.assertion')" : "0"} END AS current`, part.bindings));
}
async function copyBatch(state: CopyState, lane: WriterLane, items: readonly SqlItem[], retained = false): Promise<unknown> {
  if (!retained) state.owner.check();
  try { state.budget.admit(lane, items, true, false); } catch (error) { state.budget.failed = true; state.owner.stopped = true; throw error; }
  const prepared = items.map(item => state.owner.database.prepare(item.sql).bind(...item.bindings));
  const run = async () => { const value: unknown = await state.owner.database.batch(prepared);
    try { state.budget.result(value, items.length, true, false); } catch (error) { state.budget.failed = true; state.owner.stopped = true; throw error; }
    return value; };
  if (retained) return run();
  // A lost native acknowledgement is observed inside the original wait, so its
  // existing bounded readback can run without treating transport loss as an
  // owner retirement. Accounting and currentness failures still stop the owner.
  const observed = await state.owner.wait(async () => {
    try { return { ok: true as const, value: await run() }; }
    catch (error) { return { ok: false as const, error }; }
  });
  if (!observed.ok) throw observed.error;
  return observed.value;
}
async function copyFirst(state: CopyState, lane: WriterLane, item: SqlItem, large = true, retained = false): Promise<unknown> {
  if (!retained) state.owner.check();
  try { state.budget.admit(lane, [item], false, large); } catch (error) { state.budget.failed = true; state.owner.stopped = true; throw error; }
  const native = state.owner.database.prepare(item.sql).bind(...item.bindings);
  const run = async () => { const value: unknown = await native.first();
    try { state.budget.result(value, 1, false, large); } catch (error) { state.budget.failed = true; state.owner.stopped = true; throw error; }
    return value; };
  return retained ? run() : state.owner.wait(run);
}
async function copyProve(state: CopyState, lane: WriterLane, parts: readonly Proof[]) {
  const result = await copyBatch(state, lane, copyStatements(parts, false));
  if (!proofResults(result, parts.length)) return unavailableCopy();
}
function writerRowProof(state: FinalCopy, row: GuestImageResultCopyAttemptRow): Proof {
  if (row.state === "reserved") return guestImageResultReservedAttemptProof(state.owner.data.claimSourceFacts, row);
  if (row.state === "writing") return guestImageResultWritingAttemptProof(state.owner.data.claimSourceFacts, row);
  if (row.state === "ready") return guestImageResultReadyAttemptProof(state.owner.data.claimSourceFacts, row);
  if (row.state === "cleanup_pending" || row.state === "deleted") return guestImageResultCleanupAttemptProof(state.owner.data.claimSourceFacts, row);
  return unavailableCopy();
}
function writerParts(state: FinalCopy, auth: Proof, row = state.row): Proof[] {
  return [...common(state.owner, auth), leaseProof(state.owner.lease!), writerRowProof(state, row)];
}
const mutableCopyColumns = GUEST_IMAGE_RESULT_COPY_COLUMNS.filter(column => !GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS.some(immutable => immutable === column));
function exactCopyRow(row: GuestImageResultCopyAttemptRow): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_image_result_copy_attempts a WHERE json_array(${GUEST_IMAGE_RESULT_COPY_COLUMNS.map(c => `a.${c}`).join(",")})=?)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_image_result_custodies WHERE copy_attempt_id=? OR custody_id=?)`,
    bindings: [tuple(row, GUEST_IMAGE_RESULT_COPY_COLUMNS), row.attempt_id, row.custody_id] };
}
function updateCopyRow(before: GuestImageResultCopyAttemptRow, after: GuestImageResultCopyAttemptRow): SqlItem {
  return spec(`UPDATE experience_guest_image_result_copy_attempts SET ${mutableCopyColumns.map(column => `${column}=?`).join(",")}
    WHERE json_array(${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")})=?`,
  [...mutableCopyColumns.map(column => after[column]), tuple(before, GUEST_IMAGE_RESULT_COPY_COLUMNS)]);
}
async function readCopyRow(state: CopyState, lane: WriterLane, retained = false) {
  const raw = await copyFirst(state, lane, spec(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
    WHERE attempt_id=? AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=32768
    AND length(CAST(destination_metadata_json AS BLOB))<=16384`, [state.row.attempt_id]), true, retained);
  return readGuestImageResultCopyAttemptRow(raw);
}
async function changedRow(state: FinalCopy, change: Partial<GuestImageResultCopyAttemptRow>, retained = false) {
  const work = async () => {
    const next = await readGuestImageResultCopyAttemptRow({ ...state.row, ...change, row_version: state.row.row_version + 1 });
    await assertGuestImageResultCopyTransition(state.row, next); return next;
  };
  return retained ? work() : state.owner.wait(work);
}
async function fixedCopyCas(state: CopyState, lane: WriterLane, next: GuestImageResultCopyAttemptRow,
  before: readonly Proof[], after: readonly Proof[], retained = false): Promise<boolean> {
  const pre = copyStatements(before, true), post = copyStatements(after, true), all = [...pre, updateCopyRow(state.row, next), ...post];
  let result: unknown;
  try { result = await copyBatch(state, lane, all, retained); } catch { return false; }
  return Array.isArray(result) && result.length === all.length && proofResults(result.slice(0, pre.length), pre.length)
    && proofResults(result.slice(pre.length + 1), post.length) && successful(result[pre.length]) && own(own(result[pre.length], "meta"), "changes") === 1;
}
function sameCopyRow(left: GuestImageResultCopyAttemptRow, right: GuestImageResultCopyAttemptRow) { return canonicalJson(left) === canonicalJson(right); }
async function copyClock(state: CopyState): Promise<number> {
  const raw = await copyFirst(state, "clock", spec(`SELECT ${GUEST_DB_NOW} AS now`), false);
  const clock = own(raw, "now");
  if (typeof clock !== "number" || !Number.isSafeInteger(clock) || clock < state.row.updated_at_ms || clock >= state.owner.expiresAtMs) return unavailableCopy();
  return clock;
}
function observedClock(state: CopyState): number {
  const clock = Date.now();
  if (!Number.isSafeInteger(clock) || clock < state.row.updated_at_ms) return unavailableCopy(); return clock;
}

/** Only the fixed media producer can authenticate the exact retained buffer. */
export function beginGuestImageResultCopy(request: Request, env: WorkerEnv, use: GuestImageResultCopyUse,
  bytes: Uint8Array<ArrayBuffer>): GuestImageResultCopyOwner {
  const media = takeGuestImageResultCopyUse(request, env, use, bytes), captured = reserved(request, env, media.reservation);
  const { owner } = captured;
  if (copyAccounts.has(owner.data.accountingKey) || media.review.byteLength !== captured.row.byte_length) return unavailableCopy();
  const budget = new CopyBudget(owner.data.claimSourceProofs.common.length + 3);
  copyAccounts.add(owner.data.accountingKey); reservations.delete(media.reservation); owner.phase = "copy";
  const token = Object.freeze({}) as GuestImageResultCopyOwner;
  copyOwners.set(token, { ...captured, token, budget, dispatchTaken: false, settlementTaken: false,
    destinationAdmitted: false, readyTaken: false, cleanupTaken: false, cleanupFinished: false, settled: false });
  return token;
}
export function guestImageResultCopyPlan(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner) {
  const state = copyState(request, env, token);
  return freeze({ descriptor: state.descriptor, byteLength: state.row.byte_length,
    monotonicDeadline: state.owner.deadline, expiresAtMs: state.owner.expiresAtMs });
}
export async function startGuestImageResultCopy(request: Request, env: WorkerEnv,
  token: GuestImageResultCopyOwner): Promise<GuestImageResultCopyDispatch | null> {
  const state = copyState(request, env, token);
  if (state.row.state !== "reserved" || state.dispatchTaken) return unavailableCopy();
  // Retire repeated start admission even if the CAS/ACK later becomes uncertain.
  state.dispatchTaken = true;
  const auth = await authority(state.owner, state), clock = await copyClock(state);
  const next = await changedRow(state, { state: "writing", updated_at_ms: clock, put_started_at_ms: clock });
  const known = await fixedCopyCas(state, "writing", next, writerParts(state, auth), writerParts(state, auth, next));
  let actual: GuestImageResultCopyAttemptRow;
  try { actual = await readCopyRow(state, "writing"); } catch { return null; }
  if (!sameCopyRow(actual, next)) return null;
  state.row = actual;
  await copyProve(state, "writing", writerParts(state, await authority(state.owner, state)));
  if (!known) return null;
  const dispatch = Object.freeze({}) as GuestImageResultCopyDispatch; dispatches.set(dispatch, state); return dispatch;
}
export function takeGuestImageResultCopyDispatch(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  dispatch: GuestImageResultCopyDispatch) {
  const state = copyState(request, env, token), actual = dispatch && typeof dispatch === "object" ? dispatches.get(dispatch) : undefined;
  if (actual !== state || state.row.state !== "writing" || state.row.put_outcome !== "pending") return unavailableCopy();
  dispatches.delete(dispatch); state.budget.charge("put");
  return Object.freeze({ bucket: state.owner.bucket, descriptor: state.descriptor });
}
/** Only the genuine writer's observed actual promise can supply settlement. */
export async function recordGuestImageResultCopySettlement(request: Request, env: WorkerEnv,
  token: GuestImageResultCopyOwner, observation: GuestImageResultPutSettlement): Promise<boolean> {
  const state = copyState(request, env, token, false);
  if (state.settlementTaken) return unavailableCopy();
  const observed = takeGuestImageResultPutSettlement(request, env, token, observation);
  state.settlementTaken = true;
  const outcome = observed.outcome;
  try {
    if (!state.dispatchTaken || state.row.state !== "writing" && state.row.state !== "cleanup_pending"
      || state.row.put_outcome !== "pending" && state.row.put_outcome !== "unknown") return false;
    const clock = observed.at;
    if (!Number.isSafeInteger(clock) || clock < state.row.updated_at_ms) return false;
    const next = await changedRow(state, { put_outcome: outcome, updated_at_ms: clock,
      put_settled_at_ms: outcome === "success" || outcome === "conditional-null" ? clock : null }, true);
    await fixedCopyCas(state, "settlement", next, [exactCopyRow(state.row)], [exactCopyRow(next)], true);
    if (state.budget.failed) return false;
    const actual = await readCopyRow(state, "settlement", true);
    if (!sameCopyRow(actual, next)) return false;
    state.row = actual; state.settled = outcome === "success" || outcome === "conditional-null"; return true;
  } catch { return false; }
}
export function guestImageResultCopyStillCurrent(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner): boolean {
  try { copyState(request, env, token); return true; } catch { return false; }
}
export function chargeGuestImageResultCopyPutMetadata(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  kind: "capture" | "bytes", bytes = 0): void {
  const state = copyState(request, env, token, false);
  if (!state.dispatchTaken || state.settlementTaken) return unavailableCopy();
  state.budget.charge(kind === "capture" ? "destinationMetadataCaptures" : "destinationMetadataBytes", kind === "capture" ? 1 : bytes);
}
export function chargeGuestImageResultCopyDestination(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  kind: "get" | "head" | "stream" | "metadata" | "metadataBytes", bytes = 0): void {
  const state = copyState(request, env, token);
  if (!state.destinationAdmitted || !state.settled || state.row.put_outcome !== "success") return unavailableCopy();
  if (kind === "metadata" || kind === "metadataBytes") state.budget.charge(kind === "metadata" ? "destinationMetadataCaptures" : "destinationMetadataBytes", kind === "metadata" ? 1 : bytes);
  else state.budget.charge(kind === "get" ? "destinationGet" : kind === "head" ? "destinationHead" : "destinationStreamReads");
}
export async function beginGuestImageResultDestinationProof(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner) {
  const state = copyState(request, env, token);
  if (state.destinationAdmitted || !state.settled || state.row.state !== "writing" || state.row.put_outcome !== "success") return unavailableCopy();
  state.destinationAdmitted = true;
  await copyProve(state, "destination", writerParts(state, await authority(state.owner, state)));
}
export async function finishGuestImageResultCopyReady(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  proof: GuestImageResultDestinationProof): Promise<GuestImageResultReadySource | null> {
  const state = copyState(request, env, token);
  if (state.readyTaken || !state.destinationAdmitted || !state.settled || state.row.put_outcome !== "success") return unavailableCopy();
  takeGuestImageResultDestinationProof(request, env, token, proof); state.readyTaken = true;
  const auth = await authority(state.owner, state), clock = await copyClock(state);
  const next = await changedRow(state, { state: "ready", updated_at_ms: clock, verified_at_ms: clock });
  await fixedCopyCas(state, "ready", next, writerParts(state, auth), writerParts(state, auth, next));
  let actual: GuestImageResultCopyAttemptRow;
  try { actual = await readCopyRow(state, "ready"); } catch { return null; }
  if (!sameCopyRow(actual, next)) return null;
  state.row = actual;
  await copyProve(state, "ready", writerParts(state, await authority(state.owner, state)));
  state.owner.phase = "ready";
  const ready = Object.freeze({}) as GuestImageResultReadySource; readySources.set(ready, state); return ready;
}
function readyState(request: Request, env: WorkerEnv, ready: GuestImageResultReadySource): CopyState {
  const state = ready && typeof ready === "object" ? readySources.get(ready) : undefined;
  if (!state || state.owner.request !== request || state.owner.env !== env) return unavailableCopy();
  state.owner.check(); if (state.owner.phase !== "ready" || state.row.state !== "ready") return unavailableCopy(); return state;
}
export function guestImageResultReadyReview(request: Request, env: WorkerEnv, ready: GuestImageResultReadySource) {
  const state = readyState(request, env, ready), row = state.row;
  return freeze({ version: 1 as const, kind: "guest-image-result-ready" as const, status: "ready" as const,
    attemptId: row.attempt_id, custodyId: row.custody_id, destinationUserId: row.destination_user_id,
    manifestDigest: row.manifest_digest, byteLength: row.byte_length, expiresAtMs: state.owner.expiresAtMs,
    freshDestinationBytesVerified: true as const, custodyTransferred: false as const, publicReadAvailable: false as const });
}
export async function beginGuestImageResultCopyCleanup(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner): Promise<boolean> {
  const state = copyState(request, env, token);
  if (state.cleanupTaken || !["reserved", "writing", "ready"].includes(state.row.state)) return false;
  state.cleanupTaken = true;
  const auth = await authority(state.owner, state), clock = await copyClock(state);
  const next = await changedRow(state, { state: "cleanup_pending", updated_at_ms: clock });
  await fixedCopyCas(state, "cleanup-fence", next, [joinedCleanupProof(state.row, auth)], [joinedCleanupProof(next, auth)]);
  let actual: GuestImageResultCopyAttemptRow;
  try { actual = await readCopyRow(state, "cleanup-fence"); } catch { return false; }
  if (!sameCopyRow(actual, next)) return false;
  state.row = actual; return true;
}
export function chargeGuestImageResultCopyCleanup(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  kind: "head" | "delete" | "metadata" | "metadataBytes", bytes = 0): void {
  const state = copyState(request, env, token);
  if (state.row.state !== "cleanup_pending" || !state.settled || state.row.put_outcome !== "success") return unavailableCopy();
  if (kind === "metadata" || kind === "metadataBytes") state.budget.charge(kind === "metadata" ? "cleanupMetadataCaptures" : "cleanupMetadataBytes", kind === "metadata" ? 1 : bytes);
  else state.budget.charge(kind === "head" ? "cleanupHead" : "cleanupDelete");
}
export async function finishGuestImageResultCopyCleanup(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner,
  proof: GuestImageResultCleanupProof): Promise<boolean> {
  const state = copyState(request, env, token);
  if (state.cleanupFinished || state.row.state !== "cleanup_pending" || !state.settled) return false;
  takeGuestImageResultCleanupProof(request, env, token, proof, state.row.put_outcome);
  state.cleanupFinished = true;
  const auth = await authority(state.owner, state), clock = observedClock(state);
  const next = await changedRow(state, { state: "deleted", updated_at_ms: clock });
  await fixedCopyCas(state, "cleanup-finish", next, [joinedCleanupProof(state.row, auth)], [joinedCleanupProof(next, auth)]);
  let actual: GuestImageResultCopyAttemptRow;
  try { actual = await readCopyRow(state, "cleanup-finish"); } catch { return false; }
  if (!sameCopyRow(actual, next)) return false;
  state.row = actual; return true;
}
export function guestImageResultCopyOutcome(request: Request, env: WorkerEnv, token: GuestImageResultCopyOwner) {
  const state = copyState(request, env, token, false), row = state.row;
  return freeze({ attemptId: row.attempt_id, custodyId: row.custody_id, state: row.state, outcome: row.put_outcome,
    dispatchAllowed: false as const, custodyTransferred: false as const, publicReadAvailable: false as const });
}

function joinedCleanupProof(row: GuestImageResultCopyAttemptRow, auth: Proof): Proof {
  const exact = exactCopyRow(row);
  return { sql: `(${exact.sql}) AND (${auth.sql})`, bindings: [...exact.bindings, ...auth.bindings] };
}

// Byte-exact existing helper forms, not a SELECT parser or general DB adapter.
const copyPrincipalForms = new Map<string, number>([[PRINCIPAL_WITH_ACCESS_SQL, 1],
  [`SELECT participant.participant_id,participant.user_id,cohort.cohort_id,cohort.participant_cap_microusd
      FROM pilot_cohorts cohort JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.organization_id=(SELECT selected.organization_id FROM pilot_cohorts selected WHERE selected.cohort_id=?)
        AND cohort.status IN ('active','paused') AND cohort.starts_at<=? AND cohort.ends_at>?
        AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL
        AND (participant.user_id IS NULL OR participant.user_id=?) ORDER BY cohort.created_at DESC LIMIT 1`, 5],
  [`SELECT 1 AS authorized FROM pilot_cohorts cohort
        JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
        JOIN organization_memberships member ON member.organization_id=cohort.organization_id AND member.user_id=? AND member.role='owner'
          AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
        JOIN users principal ON principal.user_id=member.user_id AND principal.email=?
        WHERE cohort.cohort_id=? AND (cohort.status='closed' OR cohort.ends_at<=? OR cohort.starts_at>?)
          AND NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id
            AND successor.status IN ('active','paused') AND successor.starts_at<=? AND successor.ends_at>?)`, 7],
 ]);
function copyPrincipalEnvironment(state: CopyState): WorkerEnv {
  state.owner.check();
  if (++state.budget.principalCalls > GUEST_IMAGE_RESULT_WRITER_LIMITS.principalInvocations) return unavailableCopy();
  const statement = (sql: string, bindings: readonly unknown[] = []): D1PreparedStatement => new Proxy({} as D1PreparedStatement, { get(_target, key) {
    state.owner.check();
    if (key === "bind") return (...values: unknown[]) => {
      if (values.length !== copyPrincipalForms.get(sql)) return unavailableCopy();
      envelopeBytes(values, 1_048_576); return statement(sql, values);
    };
    if (key === "first") return (...args: unknown[]) => {
      if (args.length || bindings.length !== copyPrincipalForms.get(sql)) return unavailableCopy();
      return copyFirst(state, "principal", spec(sql, bindings));
    };
    return unavailableCopy();
  } });
  const database = new Proxy(state.owner.database, { get(_target, key) {
    state.owner.check();
    if (key !== "prepare") return unavailableCopy();
    return (sql: string) => { if (!copyPrincipalForms.has(sql)) return unavailableCopy(); return statement(sql); };
  } });
  return new Proxy(state.owner.env, { get(target, key, receiver) {
    state.owner.check(); return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}


// Fixed final publication accounting is separate from the spent writer lanes.
// It never refunds, replaces or extends their original owner/lifetime.
function finalStatements(parts: readonly Proof[], throwing: boolean): SqlItem[] {
  if (!parts.length || parts.length > 511) return unavailableCopy();
  return parts.map(part => spec(`SELECT CASE WHEN (${part.sql}) THEN 1 ELSE ${throwing ? "json_extract('invalid', '$.assertion')" : "0"} END AS current`, part.bindings));
}
type ClaimLane = "principal" | "preparation" | "clock" | "head" | "before" | "transaction" | "winner" | "winner-proof";
type ClaimLaneState = { statements: number; batches: number; spentStatements: number; spentBatches: number; large: boolean };
class FinalClaimBudget {
  readonly lanes: Record<ClaimLane, ClaimLaneState>;
  readonly storage = { head: 0, metadata: 0, metadataBytes: 0 };
  actualRequestBytes = 0; actualResultBytes = 0; principalCalls = 0;
  requestReservation = 0; resultReservation = 0; transactionReserved = false;
  constructor(prefix: number, beforeParts: number) {
    if (!Number.isSafeInteger(prefix) || prefix < 3 || prefix > 16 || !Number.isSafeInteger(beforeParts) || beforeParts < 1) unavailableCopy();
    const lane = (statements: number, batches: number, large: boolean): ClaimLaneState => ({ statements, batches, large, spentStatements: 0, spentBatches: 0 });
    this.lanes = {
      principal: lane(9, 0, true), preparation: lane(18, 6, true), clock: lane(1, 0, false), head: lane(1, 0, false),
      before: lane(beforeParts, 1, false), transaction: lane(0, 0, false),
      winner: lane(prefix + 9, 0, true), "winner-proof": lane(0, 0, false),
    };
    for (const entry of Object.values(this.lanes)) this.reserve(entry.statements, entry.batches, entry.large);
  }
  private reserve(count: number, batches: number, large: boolean) {
    this.requestReservation += count * (100_000 + 1_048_576);
    this.resultReservation += count * (large ? 1_048_576 : 16_384) + batches * 512;
    if (!Number.isSafeInteger(this.requestReservation) || !Number.isSafeInteger(this.resultReservation)) return unavailableCopy();
  }
  reservePublication(before: number, after: number, writes: number) {
    if (this.transactionReserved || ![before, after, writes].every(n => Number.isSafeInteger(n) && n > 0)) return unavailableCopy();
    // This is the actual constructor size, not an assumed cost per recipe.
    const transaction = before + writes + after;
    if (transaction > 511 || after > 511) return fail("claim_native_batch_bound");
    this.transactionReserved = true;
    Object.assign(this.lanes.transaction, { statements: transaction, batches: 1 });
    Object.assign(this.lanes["winner-proof"], { statements: after, batches: 1 });
    this.reserve(transaction, 1, false); this.reserve(after, 1, false);
  }
  admit(name: ClaimLane, items: readonly SqlItem[], batch: boolean) {
    const lane = this.lanes[name];
    if (!items.length || items.length > 511 || lane.spentStatements + items.length > lane.statements
      || batch && lane.spentBatches + 1 > lane.batches || !batch && items.length !== 1) return unavailableCopy();
    let measured = 0;
    for (const item of items) {
      const sql = encode.encode(item.sql).byteLength;
      if (sql > 100_000 || item.bindings.length > 100) return unavailableCopy();
      measured += sql + envelopeBytes([...item.bindings], 1_048_576);
    }
    if (this.actualRequestBytes + measured > this.requestReservation) return unavailableCopy();
    lane.spentStatements += items.length; if (batch) lane.spentBatches++; this.actualRequestBytes += measured;
  }
  transactionResult(value: unknown) {
    // A bounded malformed ACK is uncertainty, not proof of rollback. Measure
    // its complete own data (including holes/extras) before the fixed readback.
    // Accessors, cycles or oversized envelopes still end the original owner.
    let measured: number;
    if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (value.length > 511 || keys.length > 512 || keys.some(key => typeof key !== "string")) return unavailableCopy();
      measured = 2 + Math.max(0, value.length - 1);
      for (let index = 0; index < value.length; index++) {
        const field = descriptors[String(index)];
        if (!field) { measured += 13; continue; }
        if (!field.enumerable || !Object.hasOwn(field, "value")) return unavailableCopy();
        measured += envelopeBytes(field.value, 16_384);
      }
      for (const key of keys as string[]) {
        if (key === "length" || /^(0|[1-9]\d*)$/u.test(key) && Number(key) < value.length) continue;
        const field = descriptors[key]!;
        if (!field.enumerable || !Object.hasOwn(field, "value")) return unavailableCopy();
        measured += encode.encode(JSON.stringify(key)).byteLength + 1 + envelopeBytes(field.value, 16_384);
      }
    } else measured = envelopeBytes(value, 16_384);
    if (measured > this.lanes.transaction.statements * 16_384 + 512
      || this.actualResultBytes + measured > this.resultReservation) return unavailableCopy();
    this.actualResultBytes += measured;
  }
  result(name: ClaimLane, value: unknown, count: number, batch: boolean) {
    const maximum = this.lanes[name].large ? 1_048_576 : 16_384;
    let measured = 0;
    if (batch) {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== count
        || Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).length !== count + 1) return unavailableCopy();
      measured = count + 1;
      for (let i = 0; i < count; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return unavailableCopy();
        measured += envelopeBytes(d.value, maximum);
      }
    } else measured = envelopeBytes(value, maximum);
    if (this.actualResultBytes + measured > this.resultReservation) return unavailableCopy();
    this.actualResultBytes += measured;
  }
}
/** A fresh request can qualify an already-ready, unpublished immutable attempt.
 * This is a distinct owner: no original seed, upload, reservation, dispatch,
 * settlement or spent writer budget is invented or inherited. */
class RetainedOwner {
  readonly request: Request; readonly env: WorkerEnv; readonly database: WorkerEnv["DB"]; readonly bucket: WorkerEnv["MEDIA"];
  readonly signal: AbortSignal; readonly deadline: number; readonly expiresAtMs: number;
  readonly inventoryOwner: GuestImageResultRetainedReadyOwner; readonly data: GuestImageResultRetainedReadyData;
  readonly destinationUserId: string; readonly lease: GuestImageResultCopyLeaseSnapshot;
  stopped = false; phase: "retained-reading" | "claiming" | "claimed" = "retained-reading";
  constructor(request: Request, env: WorkerEnv, captured: ReturnType<typeof takeGuestImageResultRetainedReadySeed>) {
    this.request = request; this.env = env; this.database = env.DB; this.bucket = env.MEDIA; this.signal = request.signal;
    this.inventoryOwner = captured.owner; this.data = captured.data; this.deadline = captured.bounds.monotonicDeadline;
    this.expiresAtMs = captured.bounds.expiresAtMs; this.destinationUserId = this.data.destinationUserId; this.lease = this.data.lease;
    this.check();
  }
  check() {
    try {
      if (this.stopped || this.request.signal !== this.signal || this.signal.aborted || this.env.DB !== this.database
        || this.env.MEDIA !== this.bucket || performance.now() >= this.deadline || Date.now() >= this.expiresAtMs) return fail("retained_lifetime_ended");
      assertGuestImageResultRetainedReadyLocal(this.request, this.env, this.inventoryOwner);
    } catch (error) { this.stopped = true; throw error; }
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check(); let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    const ended = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("guest_image_result_retained_deadline")),
        Math.max(1, Math.min(this.deadline - performance.now(), this.expiresAtMs - Date.now())));
      stop = () => reject(new Error("guest_image_result_retained_aborted"));
      this.signal.addEventListener("abort", stop, { once: true }); if (this.signal.aborted) stop();
    });
    const pending = Promise.resolve().then(() => { this.check(); return work(); });
    try { const value = await Promise.race([pending, ended]); this.check(); return value; }
    catch (error) { this.stopped = true; throw error; }
    finally { clearTimeout(timer); if (stop) this.signal.removeEventListener("abort", stop); void pending.catch(() => undefined); }
  }
}
declare const retainedDestinationBrand: unique symbol;
export type GuestImageResultRetainedDestinationOwner = Readonly<{ [retainedDestinationBrand]: true }>;
export type GuestImageResultFinalClaimOwner = GuestImageResultCopyOwner | GuestImageResultRetainedDestinationOwner;
type RetainedCharge = "get" | "head" | "stream" | "bytes" | "scratch" | "metadata" | "metadataBytes" | "inspect";
type RetainedCopy = { owner: RetainedOwner; token: GuestImageResultRetainedDestinationOwner; row: GuestImageResultCopyAttemptRow;
  descriptor: GuestImageResultCopyDescriptor; storage: Map<RetainedCharge, number>; sourceProofs: number };
type FinalCopy = CopyState | RetainedCopy;
const retainedDestinations = new WeakMap<GuestImageResultRetainedDestinationOwner, RetainedCopy>();
function retainedDestination(request: Request, env: WorkerEnv, token: GuestImageResultRetainedDestinationOwner): RetainedCopy {
  const state = token && typeof token === "object" ? retainedDestinations.get(token) : undefined;
  if (!state || state.owner.request !== request || state.owner.env !== env) return unavailableCopy();
  state.owner.check(); if (state.owner.phase !== "retained-reading" || state.row.state !== "ready") return unavailableCopy(); return state;
}
export function guestImageResultRetainedDestinationPlan(request: Request, env: WorkerEnv, token: GuestImageResultRetainedDestinationOwner) {
  const state = retainedDestination(request, env, token);
  return freeze({ descriptor: state.descriptor, byteLength: state.row.byte_length,
    monotonicDeadline: state.owner.deadline, expiresAtMs: state.owner.expiresAtMs });
}
export function assertGuestImageResultRetainedDestinationCurrent(request: Request, env: WorkerEnv, token: GuestImageResultRetainedDestinationOwner): void {
  retainedDestination(request, env, token);
}
export async function assertGuestImageResultRetainedDestinationSourceCurrent(request: Request, env: WorkerEnv, token: GuestImageResultRetainedDestinationOwner): Promise<void> {
  const state = retainedDestination(request, env, token);
  if (++state.sourceProofs > 2) return unavailableCopy();
  await state.owner.wait(() => assertGuestImageResultRetainedReadyCurrent(request, env, state.owner.inventoryOwner));
  retainedDestination(request, env, token);
}
/** Separate fixed read-only storage reservation. Every native stream read,
 * detached body and PNG scratch allocation is charged; nothing refunds an old
 * writer lane. Its only capability is the exact recorded destination read. */
export function chargeGuestImageResultRetainedDestination(request: Request, env: WorkerEnv, token: GuestImageResultRetainedDestinationOwner,
  kind: RetainedCharge, count = 1): void {
  const state = retainedDestination(request, env, token), bytes = state.row.byte_length;
  const limits: Record<RetainedCharge, number> = { get: 1, head: 1, stream: 65_536, bytes,
    scratch: 2 * bytes + 2 * 32 * 1024 * 1024, metadata: 2, metadataBytes: 65_536, inspect: 1 };
  const next = (state.storage.get(kind) ?? 0) + count;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_OUTPUT_ASSET_BYTES || !Number.isSafeInteger(count)
    || count < 0 || !Number.isSafeInteger(next) || !Object.hasOwn(limits, kind) || next > limits[kind]) return unavailableCopy();
  state.storage.set(kind, next);
}

type FinalClaimState = { copy: FinalCopy; budget: FinalClaimBudget; retention: WorkerEnv["FORMA_RETENTION_DAYS"];
  sourceEnv: WorkerEnv; prepared: WeakMap<D1PreparedStatement, SqlItem>; claimed: boolean };
const finalClaims = new WeakMap<GuestImageResultFinalClaimOwner, FinalClaimState>();
function finalState(request: Request, env: WorkerEnv, token: GuestImageResultFinalClaimOwner): FinalClaimState {
  const state = finalClaims.get(token);
  if (!state || state.copy.owner.request !== request || state.copy.owner.env !== env) return unavailableCopy();
  state.copy.owner.check();
  if (state.copy.owner.phase !== "claiming" || state.claimed || env.FORMA_RETENTION_DAYS !== state.retention) return unavailableCopy();
  return state;
}
export function assertGuestImageResultFinalClaimCurrent(request: Request, env: WorkerEnv, token: GuestImageResultFinalClaimOwner): void {
  finalState(request, env, token);
}
export function chargeGuestImageResultFinalClaimDestination(request: Request, env: WorkerEnv, token: GuestImageResultFinalClaimOwner,
  kind: "head" | "metadata" | "metadataBytes", count = 0): void {
  const state = finalState(request, env, token), maximum = kind === "metadataBytes" ? 32_768 : 1;
  const addition = kind === "metadataBytes" ? count : 1;
  if (!Number.isSafeInteger(addition) || addition < 0 || state.budget.storage[kind] + addition > maximum) return unavailableCopy();
  state.budget.storage[kind] += addition;
}
async function finalRead(state: FinalClaimState, name: ClaimLane, item: SqlItem): Promise<unknown> {
  const { owner } = state.copy; finalState(owner.request, owner.env, state.copy.token);
  state.budget.admit(name, [item], false);
  return owner.wait(async () => {
    const result: unknown = await owner.database.prepare(item.sql).bind(...item.bindings).first();
    state.budget.result(name, result, 1, false); return result;
  });
}
async function finalBatch(state: FinalClaimState, name: ClaimLane, items: readonly SqlItem[]): Promise<unknown> {
  const { owner } = state.copy; finalState(owner.request, owner.env, state.copy.token);
  state.budget.admit(name, items, true);
  return owner.wait(async () => {
    const result: unknown = await owner.database.batch(items.map(item => owner.database.prepare(item.sql).bind(...item.bindings)));
    state.budget.result(name, result, items.length, true); return result;
  });
}
function finalPrincipalEnvironment(state: FinalClaimState): WorkerEnv {
  const { owner } = state.copy;
  if (++state.budget.principalCalls > 3) return unavailableCopy();
  const statement = (sql: string, bindings: readonly unknown[] = []): D1PreparedStatement => new Proxy({} as D1PreparedStatement, { get(_target, key) {
    finalState(owner.request, owner.env, state.copy.token);
    if (key === "bind") return (...values: unknown[]) => {
      if (values.length !== copyPrincipalForms.get(sql)) return unavailableCopy(); return statement(sql, values);
    };
    if (key === "first") return (...args: unknown[]) => {
      if (args.length || bindings.length !== copyPrincipalForms.get(sql)) return unavailableCopy(); return finalRead(state, "principal", spec(sql, bindings));
    };
    return unavailableCopy();
  } });
  const database = new Proxy(owner.database, { get(_target, key) {
    finalState(owner.request, owner.env, state.copy.token);
    if (key !== "prepare") return unavailableCopy();
    return (sql: string) => { if (!copyPrincipalForms.has(sql)) return unavailableCopy(); return statement(sql); };
  } });
  return new Proxy(owner.env, { get(target, key, receiver) {
    finalState(owner.request, owner.env, state.copy.token); return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}
async function finalAuthority(state: FinalClaimState): Promise<Proof> {
  const { owner } = state.copy;
  const auth = await owner.wait(() => readExistingPrincipalRequest(owner.request, finalPrincipalEnvironment(state), "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId !== owner.destinationUserId || !auth.user.access.capabilities.includes("project.author")
    || (owner.request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return unavailableCopy();
  const m = state.copy.descriptor.manifest;
  const proof = projectIntakeAuthority(owner.env, { user: auth.user, principal: auth.user, impersonation: null }, { projectId: m.projectId, documentId: m.documentId });
  return freeze({ sql: proof.sql, bindings: [...proof.bindings] });
}

/** This private adapter is available only to the fixed native body preparer.
 * It permits the exact three Memory schema reads and captures prepared native
 * insert statements; captured writes are never executable through the adapter. */
function finalPreparationEnvironment(state: FinalClaimState): WorkerEnv {
  const { owner } = state.copy;
  const statements = new WeakMap<D1PreparedStatement, SqlItem>();
  const readForms = new Set<string>();
  const collect = new Proxy(owner.database, { get(_target, key) {
    if (key !== "prepare") return unavailableCopy();
    return (sql: string) => { readForms.add(sql); return owner.database.prepare(sql); };
  } });
  nativeStructuredOriginSchemaRead(collect); nativeDocumentJobOriginSchemaRead(collect);
  readForms.add("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins,EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='assistant_turns') AS turns");
  const statement = (sql: string, bindings: readonly unknown[] = []): D1PreparedStatement => {
    if (encode.encode(sql).byteLength > 100_000 || bindings.length > 100) return unavailableCopy();
    envelopeBytes([...bindings], 1_048_576);
    const token = new Proxy({} as D1PreparedStatement, { get(_target, key) {
      finalState(owner.request, owner.env, state.copy.token);
      if (key === "bind") return (...values: unknown[]) => statement(sql, values);
      return unavailableCopy();
    } });
    const item = spec(sql, bindings); statements.set(token, item); state.prepared.set(token, item); return token;
  };
  const database = new Proxy(owner.database, { get(_target, key) {
    finalState(owner.request, owner.env, state.copy.token);
    if (key === "prepare") return (sql: string) => statement(sql);
    if (key === "batch") return async (prepared: D1PreparedStatement[]) => {
      if (!Array.isArray(prepared) || prepared.length !== 3) return unavailableCopy();
      const items = prepared.map(token => statements.get(token));
      if (items.some(item => !item || !readForms.has(item.sql) || item.bindings.length)
        || new Set(items.map(item => item!.sql)).size !== 3) return unavailableCopy();
      return finalBatch(state, "preparation", items as SqlItem[]);
    };
    return unavailableCopy();
  } });
  return new Proxy(owner.env, { get(target, key, receiver) {
    finalState(owner.request, owner.env, state.copy.token); return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}

const claimColumns = {
  context: ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "lineage_json", "lineage_digest", "created_at_ms"],
  save: ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "context_lineage_digest", "lineage_json", "lineage_digest", "created_at_ms"],
  stage: ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "context_lineage_digest", "save_lineage_digest", "lineage_json", "lineage_digest", "created_at_ms"],
  result: ["custody_id", "session_id", "destination_user_id", "lease_id", "lease_acquisition", "request_id", "manifest_digest", "native_snapshot_digest", "context_lineage_digest", "save_lineage_digest", "stage_lineage_digest", "claim_event_id", "claim_event_sequence", "original_completion_event_id", "generation_id", "output_id", "copy_attempt_id", "lineage_json", "lineage_digest", "created_at_ms", "canonical_expires_at"],
  stageCopy: ["session_id", "role", "content_id", "original_digest", "byte_length", "created_at", "expires_at"],
  resultCopy: ["custody_id", "role", "content_id", "original_content_id", "original_kind", "original_digest", "byte_length", "created_at", "expires_at"],
  receipt: ["stream_id", "client_event_id", "event_id", "sequence", "created_at"],
  command: ["scope_key", "actor_user_id", "command_key", "request_digest", "action", "event_id", "created_at"],
} as const;
function claimInsert(table: string, columns: readonly string[], row: Readonly<Record<string, unknown>>): SqlItem {
  // All callers below select literal table/column pairs, never a caller selector.
  if (!exactKeys(row, [...columns])) return unavailableCopy();
  return spec(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, columns.map(column => row[column]));
}
function finalNativeItem(state: FinalClaimState, statement: D1PreparedStatement): SqlItem {
  const item = state.prepared.get(statement); if (!item) return unavailableCopy(); return item;
}
function finalExtraProofs(state: FinalClaimState, graph: GuestImageResultPublishedGraph, exclusion: Proof): Proof[] {
  const { owner } = state.copy, ids = JSON.stringify(graph.eventEnvelopes.map(value => value.event.event_id));
  const bodyIds = JSON.stringify(graph.privateContents.map(value => value.content_id));
  const result: Proof[] = [{ sql: `NOT EXISTS(SELECT 1 FROM private_content content WHERE content.content_id IN(SELECT value FROM json_each(?)) AND NOT (${exclusion.sql}))`,
    bindings: [bodyIds, ...exclusion.bindings] }];
  for (const table of owner.data.source.history.memory.registries) {
    if (!["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"].includes(table)) return unavailableCopy();
    result.push({ sql: `NOT EXISTS(SELECT 1 FROM ${table} WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?)))`, bindings: [ids, ids] });
  }
  return result;
}
function claimCollision(state: FinalClaimState, draft: Awaited<ReturnType<typeof draftGuestImageResultClaimCandidate>>): Proof {
  const source = state.copy.owner.data.source, plan = source.history.original.plan;
  if (!plan) return unavailableCopy();
  const ids = JSON.stringify([...new Set([...plan.events.flatMap(event => [event.payload.project_id, event.payload.document_id, event.payload.block_id]
    .filter(value => typeof value === "string")), source.history.saved.requirementId])]);
  return { sql: `NOT EXISTS(SELECT 1 FROM events prior,json_tree(prior.payload) item WHERE prior.stream_id=? AND prior.sequence<=?
    AND item.type='text' AND item.value IN(SELECT value FROM json_each(?)))`, bindings: [`creative:${state.copy.row.destination_user_id}`, draft.destinationHead, ids] };
}
async function claimWinner(state: FinalClaimState, exclusion: Proof): Promise<{ review: GuestImageResultCompletedCustodyReview; replayed: boolean }> {
  const { owner, descriptor } = state.copy;
  const raw = await finalRead(state, "winner", spec(`SELECT ${claimColumns.result.join(",")} FROM experience_guest_image_result_custodies
    WHERE custody_id=? AND length(CAST(lineage_json AS BLOB))<=262144`, [descriptor.custodyId]));
  if (!record(raw) || !exactKeys(raw, [...claimColumns.result]) || typeof raw.lineage_json !== "string") return unavailableCopy();
  const lineage = await owner.wait(() => readGuestImageResultClaimLineage(JSON.parse(raw.lineage_json as string)));
  if (canonicalJson(lineage.copy) !== canonicalJson(descriptor) || raw.lineage_digest !== await owner.wait(() => digest(lineage))) return unavailableCopy();
  const actual = await finalRead(state, "winner", spec(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
    WHERE attempt_id=? AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=32768
    AND length(CAST(destination_metadata_json AS BLOB))<=16384`, [descriptor.attemptId]));
  const publishedAttempt = await owner.wait(() => readGuestImageResultCopyAttemptRow(actual));
  await owner.wait(() => assertGuestImageResultCopyTransition(state.copy.row, publishedAttempt));
  const eventIds = [...lineage.contextLineage.events.map(event => event.id), lineage.saveLineage.target.id, lineage.canonical.eventId];
  const bodies: string[] = [];
  for (const id of eventIds) {
    const row = await finalRead(state, "winner", spec(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?
      AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=131072`, [id, descriptor.destinationUserId]));
    if (!record(row) || !exactKeys(row, ["private_json"]) || typeof row.private_json !== "string") return unavailableCopy(); bodies.push(row.private_json);
  }
  const copied: string[] = [];
  for (const entry of [...lineage.stageCopies, ...lineage.resultCopies]) {
    const row = await finalRead(state, "winner", spec(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND redacted_at IS NULL
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=131072`, [entry.content_id, descriptor.destinationUserId]));
    if (!record(row) || !exactKeys(row, ["content"]) || typeof row.content !== "string") return unavailableCopy(); copied.push(row.content);
  }
  const witness = await owner.wait(() => guestImageResultWholeGraphProof({ lineage, publishedAttempt, prefixBodies: bodies.slice(0, -2),
    saveBody: bodies[bodies.length - 2]!, claimBody: bodies[bodies.length - 1]!, stageBodies: copied.slice(0, 3), resultBodies: copied.slice(3) }));
  const auth = await finalAuthority(state), after = [...guestImageResultPublishedGraphProofs(owner.data.claimSourceFacts, witness.afterGraph), auth,
    ...witness.currentParts, ...finalExtraProofs(state, witness.afterGraph, exclusion)];
  const checked = await finalBatch(state, "winner-proof", finalStatements(after, false));
  if (!proofResults(checked, after.length)) return unavailableCopy();
  owner.check(); state.claimed = true; owner.phase = "claimed";
  return { review: witness.completedReview, replayed: false };
}

/** Dormant fixed final consumer. The actual writer's one ready token is consumed
 * before any await. No caller-supplied proof, body, SQL, destination or deadline
 * can substitute for its original owner. There is exactly one candidate batch
 * and one bounded complete winner readback; no PUT or mutation retry is possible. */
export async function claimGuestImageResult(request: Request, env: WorkerEnv, ready: GuestImageResultReadySource): Promise<Readonly<{
  status: "claimed"; completedReview: GuestImageResultCompletedCustodyReview; replayed: boolean; custodyTransferred: true; publicReadAvailable: false;
}>> {
  const copy = readyState(request, env, ready);
  readySources.delete(ready);
  return publishGuestImageResultClaim(request, env, copy);
}

/** Fresh authenticated retry reads the exact retained ready attempt and its
 * destination PNG. An old ready token/review, expired lease or already-published
 * graph is not admitted. No upload, new lease or mutation retry is available. */
export async function retryGuestImageResultClaim(request: Request, env: WorkerEnv,
  input: Parameters<typeof inspectRetainedGuestImageResultReady>[2]): ReturnType<typeof claimGuestImageResult> {
  const seed = await inspectRetainedGuestImageResultReady(request, env, input);
  const owner = new RetainedOwner(request, env, takeGuestImageResultRetainedReadySeed(request, env, seed));
  const token = Object.freeze({}) as GuestImageResultRetainedDestinationOwner;
  const copy: RetainedCopy = { owner, token, row: owner.data.row, descriptor: owner.data.descriptor, storage: new Map(), sourceProofs: 0 };
  retainedDestinations.set(token, copy);
  try {
    await owner.wait(() => verifyRetainedGuestImageResultDestination(request, env, token));
    if (copy.sourceProofs !== 2 || copy.storage.get("get") !== 1 || copy.storage.get("head") !== 1
      || copy.storage.get("bytes") !== copy.row.byte_length || copy.storage.get("scratch") !== 2 * copy.row.byte_length + 2 * 32 * 1024 * 1024
      || copy.storage.get("inspect") !== 1 || copy.storage.get("metadata") !== 2) return unavailableCopy();
    retainedDestinations.delete(token);
    return await publishGuestImageResultClaim(request, env, copy);
  } catch (error) { retainedDestinations.delete(token); owner.stopped = true; throw error; }
}

async function publishGuestImageResultClaim(request: Request, env: WorkerEnv, copy: FinalCopy): ReturnType<typeof claimGuestImageResult> {
  const { owner } = copy; owner.check(); owner.phase = "claiming";
  const state: FinalClaimState = { copy, budget: new FinalClaimBudget(copy.descriptor.manifest.sourceHead, owner.data.claimSourceProofs.common.length + 3),
    retention: env.FORMA_RETENTION_DAYS, sourceEnv: env, prepared: new WeakMap(), claimed: false };
  finalClaims.set(copy.token, state); state.sourceEnv = finalPreparationEnvironment(state);
  try {
    guestImageResultClaimPublicationAvailable(owner.data.claimSourceFacts);
    const auth = await finalAuthority(state), initial = writerParts(copy, auth);
    const live = await finalBatch(state, "before", finalStatements(initial, false));
    if (!proofResults(live, initial.length)) return unavailableCopy();
    const headRow = await finalRead(state, "head", spec("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?", [`creative:${copy.row.destination_user_id}`]));
    const head = own(headRow, "head");
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) return unavailableCopy();
    const draft = await owner.wait(() => draftGuestImageResultClaimCandidate({ source: owner.data.source, descriptor: copy.descriptor, destinationHead: head }));
    const storageGuard: Proof = { sql: `(${auth.sql}) AND (${leaseProof(owner.lease!).sql}) AND (${exactCopyRow(copy.row).sql})`,
      bindings: [...auth.bindings, ...leaseProof(owner.lease!).bindings, ...exactCopyRow(copy.row).bindings] };
    const preparations: Awaited<ReturnType<typeof preparePrivateContent>>[] = [];
    for (const body of draft.bodies) {
      const prepared = await owner.wait(() => preparePrivateContent(state.sourceEnv, copy.row.destination_user_id, body.kind, body.content,
        undefined, undefined, storageGuard, { contentId: body.contentId }));
      if (prepared.requiredInserts !== 1 || prepared.contentId !== body.contentId || !Array.isArray(prepared.statements) || !prepared.statements.length) return unavailableCopy();
      preparations.push(prepared);
    }
    const exclusion = await owner.wait(() => nativeMemoryAnswerExclusion(state.sourceEnv, { answerAlias: "content" }));
    const clockRow = await finalRead(state, "clock", spec(`SELECT ${GUEST_DB_NOW} AS now`)), observedClock = own(clockRow, "now");
    if (typeof observedClock !== "number" || !Number.isSafeInteger(observedClock) || observedClock < copy.row.updated_at_ms || observedClock >= owner.expiresAtMs) return unavailableCopy();
    const receiptCreatedTimes = preparations.map(value => Date.parse(value.createdAt));
    if (receiptCreatedTimes.length !== 5 || receiptCreatedTimes.some((createdAt, index) => !Number.isSafeInteger(createdAt)
      || new Date(createdAt).toISOString() !== preparations[index]!.createdAt || createdAt > observedClock + 1)) return unavailableCopy();
    // Native receipts stay unchanged; the final atomic DB clock must still reach this common claim time.
    const clock = Math.max(observedClock, ...receiptCreatedTimes);
    if (clock >= owner.expiresAtMs) return unavailableCopy();
    const candidate = await owner.wait(() => finishGuestImageResultClaimCandidate(draft, preparations.map(value => ({ contentId: value.contentId,
      createdAt: value.createdAt, expiresAt: value.expiresAt })), clock));
    const publishedAttempt = await changedRow(copy, { state: "published", updated_at_ms: clock, published_at_ms: clock, published_claim_digest: candidate.lineageDigest });
    const graph: GuestImageResultPublishedGraph = { ...candidate.afterGraph, publishedAttempt };
    const canonical = await owner.wait(() => guestImageResultWholeGraphProof({ lineage: candidate.lineage, publishedAttempt,
      prefixBodies: candidate.prefixBodies, saveBody: candidate.saveBody, claimBody: candidate.claimBody,
      stageBodies: candidate.stageBodies, resultBodies: candidate.resultBodies }));
    if (canonicalJson(canonical.afterGraph) !== canonicalJson(graph)) return fail("claim_reconstruction_changed");
    const currentAuthority = await finalAuthority(state);
    const before = [...writerParts(copy, currentAuthority), claimCollision(state, draft),
      { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${copy.row.destination_user_id}`, head] },
      { sql: "NOT EXISTS(SELECT 1 FROM private_content WHERE content_id IN(SELECT value FROM json_each(?)))", bindings: [JSON.stringify(draft.bodies.map(body => body.contentId))] }];
    const after = [...guestImageResultPublishedGraphProofs(owner.data.claimSourceFacts, graph), currentAuthority,
      ...canonical.currentParts, ...finalExtraProofs(state, graph, exclusion)];
    const writes: SqlItem[] = candidate.events.map((event, index) => finalNativeItem(state, insertEventAtHead(state.sourceEnv, event, head + index)));
    for (const row of graph.eventClientReceipts) writes.push(claimInsert("event_client_receipts", claimColumns.receipt, row));
    writes.push(claimInsert("output_commands", claimColumns.command, graph.saveCommand));
    for (const prepared of preparations) writes.push(finalNativeItem(state, prepared.statements[0]!));
    writes.push(claimInsert("experience_guest_context_adoptions", claimColumns.context, graph.contextMapping));
    writes.push(claimInsert("experience_guest_image_claims", claimColumns.save, graph.saveMapping));
    writes.push(claimInsert("experience_guest_image_stage_custodies", claimColumns.stage, graph.stageMapping));
    for (const row of graph.stageCopies) writes.push(claimInsert("experience_guest_image_stage_copies", claimColumns.stageCopy, row));
    writes.push(claimInsert("experience_guest_image_result_custodies", claimColumns.result, graph.resultMapping));
    for (const row of graph.resultCopies) writes.push(claimInsert("experience_guest_image_result_copies", claimColumns.resultCopy, row));
    writes.push(spec("UPDATE experience_guest_sessions SET revoked_at_ms=? WHERE session_id=? AND revoked_at_ms IS NULL", [clock, copy.row.session_id]));
    writes.push(updateCopyRow(copy.row, publishedAttempt));
    if (writes.length !== 2 * copy.descriptor.manifest.sourceHead + 19) return fail("claim_constructor_count");
    state.budget.reservePublication(before.length, after.length, writes.length);
    await owner.wait(() => proveGuestImageResultFinalDestination(request, env, copy.token));
    const batch = [...finalStatements(before, true), ...writes, ...finalStatements(after, true)];
    // The transport may throw after committing. Capture that uncertainty inside
    // the original wait without stopping its one bounded winner inspection.
    state.budget.admit("transaction", batch, true);
    const preparedBatch = batch.map(item => owner.database.prepare(item.sql).bind(...item.bindings));
    const observed = await owner.wait(async () => {
      let result: unknown;
      try { result = await owner.database.batch(preparedBatch); }
      catch { return { result: undefined, failed: true }; }
      state.budget.transactionResult(result);
      return { result, failed: false };
    });
    const ack = observed.result;
    const dense = Array.isArray(ack) && Object.getPrototypeOf(ack) === Array.prototype && ack.length === batch.length
      && Reflect.ownKeys(Object.getOwnPropertyDescriptors(ack)).length === batch.length + 1
      && Array.from({ length: batch.length }, (_, index) => Object.getOwnPropertyDescriptor(ack, String(index)))
        .every(field => !!field && field.enumerable && Object.hasOwn(field, "value"));
    const known = dense && proofResults(Array.prototype.slice.call(ack, 0, before.length), before.length)
      && proofResults(Array.prototype.slice.call(ack, before.length + writes.length), after.length)
      && Array.prototype.slice.call(ack, before.length, before.length + writes.length).every((value: unknown, index: number) => {
        const changes = own(own(value, "meta"), "changes");
        return successful(value) && typeof changes === "number" && Number.isSafeInteger(changes)
          && (index < candidate.events.length ? changes > 0 : changes === 1);
      });
    const winner = await claimWinner(state, exclusion);
    return freeze({ status: "claimed" as const, completedReview: winner.review, replayed: !known || winner.review.claimEventId !== candidate.completedReview.claimEventId,
      custodyTransferred: true as const, publicReadAvailable: false as const });
  } catch (error) { owner.stopped = true; throw error; }
}
