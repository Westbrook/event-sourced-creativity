import { canonicalJson, digest, freeze, exactKeys, record } from "../src/experiences/compiler.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { GUEST_DB_NOW, guestId } from "./experience-guest-session.ts";
import { readGuestImageStageClaimLeaseRow } from "./experience-guest-image-stage-claim-inventory.ts";
import { guestImageResultReservedAttemptProof } from "./experience-guest-image-result-facts.ts";
import {
  handoffGuestImageResultInventory, guestImageResultClaimSeedData, guestImageResultClaimSeedBounds,
  assertGuestImageResultClaimSeedLocal, type GuestImageResultInventory, type GuestImageResultClaimSeed,
} from "./experience-guest-image-result-inventory.ts";
import {
  GUEST_IMAGE_RESULT_COPY_COLUMNS, readGuestImageResultCopyAttemptRow, validateGuestImageResultCopyDescriptor,
  guestImageResultCopyMetadata, guestImageResultMediaKey, guestImageResultOriginalOutputId,
  type GuestImageResultCopyAttemptRow, type GuestImageResultCopyDescriptor, type GuestImageResultCopyLeaseSnapshot,
} from "./experience-guest-image-result-copy-contract.ts";
import { takeGuestImageResultClaimMediaAdmission, retireGuestImageResultClaimMediaAdmission, type GuestImageResultClaimMediaAdmission } from "./experience-guest-image-result-media.ts";
import type { Proof } from "./experience-guest-image-history.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Dormant fixed first-lease/reserve owner. No schema installation, route,
 * reacquisition, PUT, writing transition or final custody is provided here. */
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
type Phase = "acquiring" | "leased" | "reserving" | "reserved" | "unknown";
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
async function authority(owner: Owner): Promise<Proof> {
  owner.check();
  if ((owner.request.headers.get("cookie") ?? "").split(";").some(part =>
    ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("personal_principal_required");
  const auth = await owner.wait(() => readExistingPrincipalRequest(owner.request, owner.env, "creator", { account: "principal" }));
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
function common(owner: Owner, auth: Proof): Proof[] { return [...owner.data.claimSourceProofs.common, auth]; }
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
