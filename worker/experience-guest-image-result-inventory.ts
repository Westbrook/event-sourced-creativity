import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { collectRetainedGuestImageHistory, current, type Context, type Proof } from "./experience-guest-image-history.ts";
import { collectGuestImageResultFacts, guestImageResultClaimPublicationAvailable, guestImageResultReadyAttemptProof,
  type GuestImageResultClaimFacts } from "./experience-guest-image-result-facts.ts";
import { readGuestImageResultManifest, type GuestImageResultManifest } from "./experience-guest-image-result-contract.ts";
import { GUEST_DB_NOW, guestHash, guestId, type GuestClaimProof } from "./experience-guest-session.ts";
import { GUEST_IMAGE_RESULT_COPY_COLUMNS, readGuestImageResultCopyAttemptRow, validateGuestImageResultCopyDescriptor,
  type GuestImageResultCopyAttemptRow, type GuestImageResultCopyDescriptor, type GuestImageResultCopyLeaseSnapshot } from "./experience-guest-image-result-copy-contract.ts";
import { readGuestImageStageClaimLeaseRow } from "./experience-guest-image-stage-claim-inventory.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => { throw new Error(`guest_image_result_inventory_${part}`); };
const own = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};
const successful = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || own(value, "success") !== true) return false;
  if (!("error" in value)) return true;
  const descriptor = Object.getOwnPropertyDescriptor(value, "error");
  return !!descriptor && Object.hasOwn(descriptor, "value") && descriptor.value === undefined;
};
function readSql(sql: string): boolean {
  // The collectors use SELECT, with any read CTE nested inside an expression.
  // Top-level WITH also permits UPDATE/DELETE RETURNING and is not a read gate.
  if (!/^\s*SELECT\b/iu.test(sql)) return false;
  let quote = "";
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (quote !== "]" && sql[index + 1] === quote) index++;
        else quote = "";
      }
    } else if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "[") quote = "]";
    else if (character === ";" || sql.slice(index, index + 2) === "--" || sql.slice(index, index + 2) === "/*") return false;
  }
  return quote === "";
}

class ReadLifetime {
  readonly request: Request; readonly env: WorkerEnv; readonly database: WorkerEnv["DB"];
  readonly media: WorkerEnv["MEDIA"]; readonly cohort: WorkerEnv["FORMA_PILOT_COHORT_ID"];
  readonly admins: WorkerEnv["FORMA_ADMIN_EMAILS"]; readonly retention: WorkerEnv["FORMA_RETENTION_DAYS"];
  readonly evidenceRetention: WorkerEnv["FORMA_EVIDENCE_RETENTION_DAYS"];
  readonly deadline: number; readonly signal: AbortSignal; readonly ctx: Context;
  expiresAtMs = Infinity; stopped = false;
  constructor(request: Request, env: WorkerEnv, deadline?: number) {
    if (!(request instanceof Request) || deadline !== undefined && !Number.isFinite(deadline)) fail("input_invalid");
    this.request = request; this.env = env; this.database = env.DB; this.signal = request.signal;
    this.media = env.MEDIA; this.cohort = env.FORMA_PILOT_COHORT_ID; this.admins = env.FORMA_ADMIN_EMAILS;
    this.retention = env.FORMA_RETENTION_DAYS; this.evidenceRetention = env.FORMA_EVIDENCE_RETENTION_DAYS;
    this.deadline = Math.min(performance.now() + 30_000, deadline ?? Infinity);
    this.ctx = { request, env, db: env.DB, url: request.url, headers: JSON.stringify(Array.from(request.headers)),
      origin: new URL(request.url).origin, signal: request.signal };
    if (new TextEncoder().encode(this.ctx.headers).byteLength > 32768) return fail("input_invalid");
    this.check();
  }
  check() {
    try {
      if (this.stopped) return fail("lifetime_ended");
      current(this.ctx);
      if (this.env.DB !== this.database || this.env.MEDIA !== this.media || this.env.FORMA_PILOT_COHORT_ID !== this.cohort
        || this.env.FORMA_ADMIN_EMAILS !== this.admins || this.env.FORMA_RETENTION_DAYS !== this.retention
        || this.env.FORMA_EVIDENCE_RETENTION_DAYS !== this.evidenceRetention) return fail("environment_changed");
      if (performance.now() >= this.deadline || Date.now() >= this.expiresAtMs) return fail("lifetime_ended");
    } catch (error) { this.stopped = true; throw error; }
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check(); let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    const ended = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("guest_image_result_inventory_deadline")), Math.max(1, this.deadline - performance.now()));
      stop = () => reject(new Error("guest_image_result_inventory_cancelled"));
      this.signal.addEventListener("abort", stop, { once: true }); if (this.signal.aborted) stop();
    });
    try { const value = await Promise.race([work(), ended]); this.check(); return value; }
    catch (error) { this.stopped = true; throw error; }
    finally { clearTimeout(timer); if (stop) this.signal.removeEventListener("abort", stop); }
  }
}

/** The historical collectors receive the same underlying database through a
 * private read adapter. It cannot install schema or perform a mutation, and
 * late collector continuations cannot start another read after retirement. */
function readEnvironment(life: ReadLifetime): WorkerEnv {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statement = (native: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(native, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => { life.check(); return statement(target.bind(...values)); };
      if (key === "first" || key === "all") return (...args: unknown[]) => life.wait(async () => {
        const value: unknown = await Reflect.apply(Reflect.get(target, key), target, args);
        if (key === "all" && (!successful(value) || !Array.isArray(own(value, "results")))) return fail("read_ack_invalid");
        return value;
      });
      return fail("non_read_operation");
    } });
    originals.set(wrapped, native); return wrapped;
  };
  const database = new Proxy(life.database, { get(_target, key) {
    if (key === "prepare") return (sql: string) => {
      life.check();
      if (typeof sql !== "string" || new TextEncoder().encode(sql).byteLength > 100000 || !readSql(sql)) return fail("non_read_operation");
      return statement(life.database.prepare(sql));
    };
    if (key === "batch") return (statements: D1PreparedStatement[]) => life.wait(async () => {
      if (!Array.isArray(statements) || statements.length < 1 || statements.length > 256) return fail("proof_bound");
      const native = statements.map(value => originals.get(value) ?? fail("foreign_statement"));
      return life.database.batch(native);
    });
    return fail("non_read_operation");
  } });
  return new Proxy(life.env, { get(target, key, receiver) {
    life.check();
    if (key === "MEDIA") return fail("media_unavailable");
    return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}

declare const brand: unique symbol;
export type GuestImageResultInventory = Readonly<{ [brand]: true }>;
declare const claimSeedBrand: unique symbol;
/** One-way local ownership transfer only. A seed confers no lease, attempt or
 * byte authority; the claim owner must prove its complete current phase. */
export type GuestImageResultClaimSeed = Readonly<{ [claimSeedBrand]: true }>;
export type GuestImageResultReview = Readonly<{
  version: 1; kind: "guest-image-result-inventory"; sessionId: string; documentId: string; projectId: string;
  generationId: string; originalPayerUserId: string; manifestDigest: string; sourceHead: number; resultHead: number;
  expiresAt: string; privateBodyCount: 2; recordedObjectCount: 1;
  custodyTransferred: false; publicReadAvailable: false; freshBytesVerified: false;
}>;
type Data = Readonly<{ manifest: GuestImageResultManifest; manifestDigest: string; review: GuestImageResultReview; proof: readonly Proof[] }>;
type ProducerMetadata = Readonly<{ model: string; provider: string; adapter: string; providerRequestId: string }>;
type History = Awaited<ReturnType<typeof collectRetainedGuestImageHistory>>;
type ResultFacts = Awaited<ReturnType<typeof collectGuestImageResultFacts>>;
type ClaimSession = History["liveSource"]["session"] & { row: History["liveSource"]["session"]["row"] & { created_at_ms: number } };
type SourceSnapshot = Readonly<{
  history: Omit<History, "ctx" | "sponsor"> & { sponsor: { proof: Proof; tables: readonly string[]; snapshot: string } };
  stage: Omit<ResultFacts["stage"], "ctx" | "history">;
  result: Omit<ResultFacts, "ctx" | "history" | "stage" | "parts" | "claimSourceFacts" | "claimSourceProofs">;
}>;
export type GuestImageResultClaimSeedSnapshot = Readonly<{
  data: Data; producerMetadata: ProducerMetadata; accountingKey: object; source: SourceSnapshot;
  claimSourceFacts: GuestImageResultClaimFacts; claimSourceProofs: ResultFacts["claimSourceProofs"];
  session: ClaimSession; claimProof: GuestClaimProof;
}>;
type Captured = {
  life: ReadLifetime; readEnv: WorkerEnv; data: Data; producerMetadata: ProducerMetadata;
  seedData: GuestImageResultClaimSeedSnapshot; accountingKey: object;
  phase: "ordinary" | "claim-seed"; mediaAdmitted: boolean; ordinaryProofs: number;
};
const inventories = new WeakMap<GuestImageResultInventory, Captured>();
const claimSeeds = new WeakMap<GuestImageResultClaimSeed, Captured>();

/** Fixed producer projection. No request, environment, database, bucket,
 * callback, context or collector cycle can cross this private data seam. */
function captureSourceData(history: History, facts: ResultFacts, claimProof: GuestClaimProof) {
  const stage = facts.stage;
  const source: SourceSnapshot = {
    history: { mode: history.mode, original: history.original, saved: history.saved,
      sponsor: { proof: history.sponsor.proof, snapshot: history.sponsor.snapshot, tables: [...history.sponsor.tables] },
      memory: history.memory, liveSource: history.liveSource, currentGuards: history.currentGuards,
      currentPolicyProof: history.currentPolicyProof, currentSessionProof: history.currentSessionProof },
    stage: { sessionId: stage.sessionId, documentId: stage.documentId, sourceHead: stage.sourceHead,
      sourceSaveHead: stage.sourceSaveHead, stageHead: stage.stageHead, stageState: stage.stageState,
      expiresAt: stage.expiresAt, tails: stage.tails, resources: stage.resources, stageParts: stage.stageParts,
      blockCustodyProof: stage.blockCustodyProof, eventCountProof: stage.eventCountProof,
      recordedTimeProof: stage.recordedTimeProof, tailProofs: stage.tailProofs, scope: stage.scope,
      confirmed: stage.confirmed, quote: stage.quote, transport: stage.transport, rows: stage.rows },
    result: { immutableSnapshot: facts.immutableSnapshot, identity: facts.identity, rows: facts.rows,
      events: facts.events, sourceEvents: facts.sourceEvents, completion: facts.completion, usage: facts.usage },
  };
  const session: ClaimSession = { ...history.liveSource.session,
    row: { ...history.liveSource.session.row, created_at_ms: Number(history.original.session.created_at_ms) } };
  // Provenance and finite-accounting identities must survive by identity. Only
  // the inert source/session/proof values are cloned before recursive freezing.
  return freeze(structuredClone({ source, session, claimSourceProofs: facts.claimSourceProofs, claimProof }));
}
function captureClaimSeedData(history: History, facts: ResultFacts, data: Data,
  producerMetadata: ProducerMetadata, accountingKey: object, claimProof: GuestClaimProof): GuestImageResultClaimSeedSnapshot {
  const copied = captureSourceData(history, facts, claimProof);
  return Object.freeze({ data, producerMetadata, accountingKey, ...copied, claimSourceFacts: facts.claimSourceFacts });
}

function state(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Captured {
  const captured = inventory && typeof inventory === "object" ? inventories.get(inventory) : undefined;
  if (!captured || captured.life.request !== request || captured.life.env !== env) return fail("capability_unavailable");
  captured.life.check();
  if (captured.phase !== "ordinary") return fail("capability_unavailable");
  return captured;
}
function seedState(request: Request, env: WorkerEnv, seed: GuestImageResultClaimSeed): Captured {
  const captured = seed && typeof seed === "object" ? claimSeeds.get(seed) : undefined;
  if (!captured || captured.life.request !== request || captured.life.env !== env) return fail("capability_unavailable");
  captured.life.check(); return captured;
}
async function prove(life: ReadLifetime, env: WorkerEnv, parts: readonly Proof[]) {
  try {
    if (!parts.length || parts.length > 256) return fail("proof_bound");
    const statements = parts.map(part => env.DB.prepare(`SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS current`).bind(...part.bindings));
    const results = await life.wait(() => env.DB.batch(statements));
    if (!Array.isArray(results) || results.length !== parts.length) return fail("proof_ack_invalid");
    for (let index = 0; index < results.length; index++) {
      const result = own(results, index), rows = own(result, "results");
      if (!successful(result) || !Array.isArray(rows) || rows.length !== 1 || own(own(rows, 0), "current") !== 1) return fail("proof_unavailable");
    }
    life.check();
  } catch (error) { life.stopped = true; throw error; }
}

async function collectProjection(life: ReadLifetime, readEnv: WorkerEnv, copied: { proof: GuestClaimProof }, expiryCeiling = Infinity) {
  const history = await life.wait(() => collectRetainedGuestImageHistory(life.request, readEnv, copied));
  const facts = await life.wait(() => collectGuestImageResultFacts(history));
  const { identity, rows } = facts, source = history.original.source;
  life.expiresAtMs = Math.min(Date.parse(identity.expiresAt), Number(history.original.session.expires_at_ms), expiryCeiling); life.check();
  const { model_id: model, provider, adapter_version: adapter, provider_request_id: providerRequestId } = facts.completion.payload;
  if (typeof model !== "string" || typeof provider !== "string" || typeof adapter !== "string"
    || providerRequestId !== null && typeof providerRequestId !== "string") return fail("producer_metadata_invalid");
  const producerMetadata: ProducerMetadata = Object.freeze({ model, provider, adapter, providerRequestId: providerRequestId ?? "" });
  const privateContents = [];
  for (const body of rows.privateContents) privateContents.push({ contentId: body.content_id, kind: body.kind,
    contentDigest: await life.wait(() => digest(body.content)), bytes: new TextEncoder().encode(String(body.content)).byteLength,
    createdAt: body.created_at, expiresAt: body.expires_at });
  const nativeSnapshotDigest = await life.wait(() => digest(facts.immutableSnapshot));
  const manifest = readGuestImageResultManifest({ version: 1, kind: "original-image-completed-result",
    sessionId: history.original.session.session_id, guestSubject: identity.guestSubject, projectId: identity.projectId, documentId: identity.documentId,
    sourceHead: identity.sourceHead, sourceSaveHead: identity.saveHead, quoteHead: identity.quoteHead, runHead: identity.runHead, resultHead: identity.resultHead,
    expiresAt: identity.expiresAt, draftHash: source.draft_hash, contentDigest: source.content_digest, sourceEventIds: history.original.eventIds,
    originalPayerUserId: identity.payerUserId, generationId: identity.generationId, completionEventId: identity.completionEventId,
    usageEventId: identity.usageEventId, completedAt: identity.completedAt,
    nativeIdentity: { scopeKey: identity.scopeKey, jobId: rows.job.job_id, slotId: rows.slot.slot_id, executionGrantId: rows.grant.grant_id,
      issuerGrantId: rows.issuerGrant.grant_id, consumptionId: rows.consumption.consumption_id, planRevisionId: rows.slot.plan_revision_id,
      targetId: rows.slot.target_id, preflightId: rows.grant.preflight_id },
    financialReceipt: { period: rows.token.period, tokenReservationId: rows.token.reservation_id, costReservationId: rows.cost.reservation_id,
      usedTokens: rows.token.used_tokens, usedMicrousd: rows.cost.used_microusd }, privateContents,
    object: { storageKey: rows.storage[0]!.storage_key, contentSha256: rows.storage[0]!.content_sha256, mimeType: "image/png",
      width: facts.completion.payload.image_width, height: facts.completion.payload.image_height,
      publicationEventId: rows.storage[0]!.publication_event_id, recordedDescriptorOnly: true }, nativeSnapshotDigest });
  const manifestDigest = await life.wait(() => digest(manifest));
  const review: GuestImageResultReview = freeze({ version: 1, kind: "guest-image-result-inventory", sessionId: manifest.sessionId,
    documentId: manifest.documentId, projectId: manifest.projectId, generationId: manifest.generationId, originalPayerUserId: manifest.originalPayerUserId,
    manifestDigest, sourceHead: manifest.sourceHead, resultHead: manifest.resultHead, expiresAt: manifest.expiresAt,
    privateBodyCount: 2, recordedObjectCount: 1, custodyTransferred: false, publicReadAvailable: false, freshBytesVerified: false });
  const data = freeze({ manifest, manifestDigest, review, proof: structuredClone(facts.parts) });
  return { history, facts, data, producerMetadata };
}

async function inspect(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }, deadline?: number): Promise<GuestImageResultInventory> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof"])) return fail("input_invalid");
  const copied = freeze(structuredClone(input)), life = new ReadLifetime(request, env, deadline), readEnv = readEnvironment(life);
  try {
    const { history, facts, data, producerMetadata } = await collectProjection(life, readEnv, copied);
    await prove(life, readEnv, data.proof);
    const inventory = Object.freeze({}) as GuestImageResultInventory, accountingKey = Object.freeze({});
    const seedData = captureClaimSeedData(history, facts, data, producerMetadata, accountingKey, copied.proof);
    life.check(); inventories.set(inventory, { life, readEnv, data, producerMetadata, seedData, accountingKey,
      phase: "ordinary", mediaAdmitted: false, ordinaryProofs: 0 }); return inventory;
  } catch (error) { life.stopped = true; throw error; }
}

/** The direct promise belongs to the one request owner through final proof and
 * projection. No ambient current generation policy is accepted as custody. */
export function inspectGuestImageResultInventory(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }, deadline?: number) {
  return inspect(request, env, input, deadline);
}
export function guestImageResultInventoryData(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Data {
  return state(request, env, inventory).data;
}
/** Internal lifetime bounds only. This does not recheck the database, renew
 * either limit or authorize bytes; consumers still await the full assertion. */
export function guestImageResultInventoryBounds(
  request: Request,
  env: WorkerEnv,
  inventory: GuestImageResultInventory,
): Readonly<{ monotonicDeadline: number; expiresAtMs: number }> {
  const { life } = state(request, env, inventory);
  return Object.freeze({
    monotonicDeadline: life.deadline,
    expiresAtMs: life.expiresAtMs,
  });
}
/** Internal comparison data from the qualified original completion, not a
 * transferable proof or a substitute for the full asynchronous currentness check. */
export function guestImageResultInventoryProducerMetadata(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): ProducerMetadata {
  return state(request, env, inventory).producerMetadata;
}
/** The same finite accounting identity is retained across an unused inventory's
 * one-way handoff. Reading it does not admit a media owner. */
export function guestImageResultInventoryAccountingKey(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): object {
  return state(request, env, inventory).accountingKey;
}
/** Synchronous admission precedes any ordinary media constructor. It is never
 * reset after failure and permanently excludes a later claim handoff. */
export function admitGuestImageResultInventoryMedia(request: Request, env: WorkerEnv,
  inventory: GuestImageResultInventory): Readonly<{ accountingKey: object }> {
  const captured = state(request, env, inventory);
  if (captured.mediaAdmitted) return fail("media_already_admitted");
  captured.mediaAdmitted = true;
  return Object.freeze({ accountingKey: captured.accountingKey });
}
/** Consume the ordinary owner before any media admission or in-flight ordinary
 * proof. No await, callback or native mutation can split this state transition. */
export function handoffGuestImageResultInventory(request: Request, env: WorkerEnv,
  inventory: GuestImageResultInventory): GuestImageResultClaimSeed {
  const captured = state(request, env, inventory);
  if (captured.mediaAdmitted || captured.ordinaryProofs !== 0) return fail("handoff_unavailable");
  const seed = Object.freeze({}) as GuestImageResultClaimSeed;
  captured.phase = "claim-seed"; claimSeeds.set(seed, captured); return seed;
}
/** Private inert capture only. This local fence does not establish any native
 * lease/attempt phase or replace the claim owner's full current proof. */
export function guestImageResultClaimSeedData(request: Request, env: WorkerEnv,
  seed: GuestImageResultClaimSeed): GuestImageResultClaimSeedSnapshot {
  return seedState(request, env, seed).seedData;
}
export function guestImageResultClaimSeedBounds(request: Request, env: WorkerEnv,
  seed: GuestImageResultClaimSeed): Readonly<{ monotonicDeadline: number; expiresAtMs: number }> {
  const { life } = seedState(request, env, seed);
  return Object.freeze({ monotonicDeadline: life.deadline, expiresAtMs: life.expiresAtMs });
}
/** Check the original local lifetime only; never renew it or authorize a phase. */
export function assertGuestImageResultClaimSeedLocal(request: Request, env: WorkerEnv, seed: GuestImageResultClaimSeed): void {
  seedState(request, env, seed);
}
/** Recheck the original captured graph; this cannot renew the deadline, replace
 * missing private content, accept a changed manifest or grant another purchase. */
export function assertGuestImageResultInventoryCurrent(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Promise<void> {
  const captured = state(request, env, inventory);
  captured.ordinaryProofs++;
  return prove(captured.life, captured.readEnv, captured.data.proof).finally(() => { captured.ordinaryProofs--; });
}

declare const retainedSeedBrand: unique symbol;
declare const retainedOwnerBrand: unique symbol;
export type GuestImageResultRetainedReadySeed = Readonly<{ [retainedSeedBrand]: true }>;
export type GuestImageResultRetainedReadyOwner = Readonly<{ [retainedOwnerBrand]: true }>;
export type GuestImageResultRetainedReadyData = Readonly<{
  source: SourceSnapshot; data: Data; producerMetadata: ProducerMetadata;
  claimSourceFacts: GuestImageResultClaimFacts; claimSourceProofs: ResultFacts["claimSourceProofs"];
  session: ClaimSession; claimProof: GuestClaimProof;
  row: GuestImageResultCopyAttemptRow; descriptor: GuestImageResultCopyDescriptor;
  lease: GuestImageResultCopyLeaseSnapshot; destinationUserId: string;
}>;
export type GuestImageResultRetainedReadyInput = Readonly<{
  proof: GuestClaimProof;
  selector: Readonly<{ version: 1; attemptId: string; custodyId: string; manifestDigest: string }>;
}>;
type RetainedReady = {
  life: ReadLifetime; readEnv: WorkerEnv; data: GuestImageResultRetainedReadyData;
  proofBudget: RetainedProofBudget; taken: boolean; currentProofs: number; proving: boolean;
};
const retainedRequests = new WeakSet<Request>();
const retainedSeeds = new WeakMap<GuestImageResultRetainedReadySeed, RetainedReady>();
const retainedOwners = new WeakMap<GuestImageResultRetainedReadyOwner, RetainedReady>();
const retainedLeaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id",
  "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"] as const;

function retainedClosed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail("retained_input_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) return fail("retained_input_invalid");
  const copied: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("retained_input_invalid");
    copied[key] = descriptor.value;
  }
  return copied;
}
function retainedInput(value: unknown): GuestImageResultRetainedReadyInput {
  const input = retainedClosed(value, ["proof", "selector"]), proof = retainedClosed(input.proof, ["sessionId", "sessionToken", "claimToken"]);
  const selector = retainedClosed(input.selector, ["version", "attemptId", "custodyId", "manifestDigest"]);
  const uuid = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(id);
  if (!guestId(proof.sessionId) || typeof proof.sessionToken !== "string" || !/^forma-guest-session-v1\.[a-f0-9]{64}$/u.test(proof.sessionToken)
    || typeof proof.claimToken !== "string" || !/^forma-guest-claim-v1\.[a-f0-9]{64}$/u.test(proof.claimToken)
    || selector.version !== 1 || !uuid(selector.attemptId) || !uuid(selector.custodyId) || !guestHash(selector.manifestDigest)) return fail("retained_input_invalid");
  return freeze({ proof: { sessionId: proof.sessionId, sessionToken: proof.sessionToken, claimToken: proof.claimToken },
    selector: { version: 1, attemptId: selector.attemptId, custodyId: selector.custodyId, manifestDigest: selector.manifestDigest } });
}
/** Native D1 SELECT rows are flat scalar records. Bound the new reads before
 * any principal/parser receives them; no accessor or custom toJSON is used. */
function retainedReadRow(value: unknown): unknown {
  if (value === null) return value;
  if (!value || typeof value !== "object") return fail("retained_read_invalid");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("retained_read_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length > 128) return fail("retained_read_bound");
  const copied: Record<string, string | number | null> = {};
  let bytes = 2;
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 256 || ["__proto__", "constructor", "prototype"].includes(key)) return fail("retained_read_invalid");
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("retained_read_invalid");
    const item: unknown = descriptor.value;
    if (item !== null && (typeof item === "string" ? item.length > 1_048_576 || !item.isWellFormed()
      : typeof item !== "number" || !Number.isFinite(item))) return fail("retained_read_invalid");
    bytes += new TextEncoder().encode(JSON.stringify(key)).byteLength + new TextEncoder().encode(JSON.stringify(item)).byteLength + 2;
    if (bytes > 1_048_576) return fail("retained_read_bound");
    copied[key] = item as string | number | null;
  }
  return copied;
}

/** Complete own-data accounting, including ACK metadata and explicit undefined
 * values. This is the accepted writer's envelope convention, not wire bytes. */
function retainedEnvelopeBytes(value: unknown, maximum: number): number {
  const seen = new Set<object>(); let total = 0, nodes = 0;
  const add = (count: number) => { total += count; if (!Number.isSafeInteger(total) || total > maximum) return fail("retained_envelope_bound"); };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 131072 || depth > 16) return fail("retained_envelope_bound");
    if (item === undefined) { add(13); return; }
    if (item === null) { add(4); return; }
    if (typeof item === "boolean") { add(item ? 4 : 5); return; }
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0)) return fail("retained_envelope_invalid"); add(String(item).length); return;
    }
    if (typeof item === "string") {
      if (item.length > maximum || !item.isWellFormed()) return fail("retained_envelope_invalid");
      add(new TextEncoder().encode(JSON.stringify(item)).byteLength); return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return fail("retained_envelope_invalid");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail("retained_envelope_invalid");
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 4096 || keys.some(key => typeof key !== "string")) return fail("retained_envelope_bound");
    if (array) {
      const length = own(item, "length");
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length > 2048 || keys.length !== length + 1) return fail("retained_envelope_invalid");
      add(2 + Math.max(0, length - 1));
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("retained_envelope_invalid");
        visit(descriptor.value, depth + 1);
      }
    } else {
      add(2 + Math.max(0, keys.length - 1));
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !key.isWellFormed() || key.length > maximum) return fail("retained_envelope_invalid");
        add(new TextEncoder().encode(JSON.stringify(key)).byteLength + 1); visit(descriptor.value, depth + 1);
      }
    }
  };
  visit(value, 0); return total;
}

/** One native collection has 78 dispatches / 84 SELECTs: history20/22,
 * quoted-stage11/11, schema24/24, result19/19, body-Memory4/8. Its three
 * batches each contain three statements. Rows are91+2N+S, N<=16 and S<=512.
 * These reservations belong only to this new collector invocation. */
class RetainedReadBudget {
  readonly kind: "admission" | "collection";
  readonly statements: number; readonly dispatches: number; readonly batches: number; readonly rows: number;
  readonly rowBytes: number; readonly requestReservation: number; readonly resultReservation: number;
  spentStatements = 0; spentDispatches = 0; spentBatches = 0; spentRows = 0; requestBytes = 0; resultBytes = 0;
  constructor(kind: "admission" | "collection") {
    this.kind = kind;
    this.statements = kind === "admission" ? 5 : 84;
    this.dispatches = kind === "admission" ? 5 : 78;
    this.batches = kind === "admission" ? 0 : 3;
    this.rows = kind === "admission" ? 5 : 91 + 2 * 16 + 512;
    // A native witness is at most262144 UTF-8 bytes; JSON escaping can expand
    // each byte sixfold. The additional16KiB bounds row structure. Metadata
    // has its own16KiB capacity refusal, rather than being silently omitted.
    this.rowBytes = kind === "admission" ? 1_048_576 : 6 * 262_144 + 16_384;
    this.requestReservation = this.statements * (100_000 + 1_048_576);
    this.resultReservation = this.rows * this.rowBytes + this.statements * 16_384 + this.batches * 4;
  }
  admit(items: readonly Proof[], batch: boolean): void {
    if (!items.length || batch && (this.kind !== "collection" || items.length !== 3)
      || !batch && items.length !== 1 || this.spentStatements + items.length > this.statements
      || this.spentDispatches + 1 > this.dispatches || batch && this.spentBatches + 1 > this.batches) return fail("retained_read_bound");
    let bytes = 0;
    for (const item of items) {
      const sqlBytes = new TextEncoder().encode(item.sql).byteLength;
      if (sqlBytes > 100_000 || !readSql(item.sql) || item.bindings.length > 100) return fail("retained_read_bound");
      bytes += sqlBytes + retainedEnvelopeBytes(item.bindings, 1_048_576);
    }
    if (this.requestBytes + bytes > this.requestReservation) return fail("retained_read_bound");
    this.spentStatements += items.length; this.spentDispatches++; if (batch) this.spentBatches++;
    this.requestBytes += bytes;
  }
  acknowledgement(value: unknown, first: boolean): void {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail("read_ack_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 4096 || keys.some(key => typeof key !== "string")) return fail("read_ack_invalid");
    const metadata: Record<string, unknown> = {}, rowsDescriptor = descriptors.results;
    if (!rowsDescriptor || !rowsDescriptor.enumerable || !Object.hasOwn(rowsDescriptor, "value")) return fail("read_ack_invalid");
    const rows: unknown = rowsDescriptor.value;
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || first && rows.length > 1
      || this.spentRows + rows.length > this.rows) return fail("retained_read_bound");
    const rowDescriptors = Object.getOwnPropertyDescriptors(rows);
    if (Reflect.ownKeys(rowDescriptors).length !== rows.length + 1) return fail("read_ack_invalid");
    for (const key of keys as string[]) {
      if (key === "results") continue;
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key)) return fail("read_ack_invalid");
      metadata[key] = descriptor.value;
    }
    // Include the removed results key, comma and dense-array wrapper as well
    // as every ACK field. Nothing in meta/error/extra fields is uncharged.
    let bytes = retainedEnvelopeBytes(metadata, 16_384) + 12 + rows.length + 1;
    if (bytes > 16_384) return fail("retained_read_bound");
    for (let index = 0; index < rows.length; index++) {
      const descriptor = rowDescriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("read_ack_invalid");
      bytes += retainedEnvelopeBytes(descriptor.value, this.rowBytes);
    }
    if (this.resultBytes + bytes > this.resultReservation) return fail("retained_read_bound");
    this.spentRows += rows.length; this.resultBytes += bytes;
    if (!successful(value)) return fail("read_ack_invalid");
  }
  result(value: unknown, count: number, batch: boolean, first: boolean): void {
    if (!batch) { this.acknowledgement(value, first); return; }
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== count || count !== 3) return fail("read_ack_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== count + 1) return fail("read_ack_invalid");
    this.resultBytes += count + 1;
    if (this.resultBytes > this.resultReservation) return fail("retained_read_bound");
    for (let index = 0; index < count; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("read_ack_invalid");
      this.acknowledgement(descriptor.value, false);
    }
  }
  finish(): void {
    if (this.kind === "collection" ? this.spentStatements !== 84 || this.spentDispatches !== 78 || this.spentBatches !== 3
      : this.spentStatements < 3 || this.spentStatements !== this.spentDispatches || this.spentBatches !== 0) return fail("retained_read_schedule");
  }
}

/** Same native SELECTs, with first() expressed as all()+zero/one projection so
 * its complete ACK is charged. This adapter is never used by ordinary callers. */
function retainedReadEnvironment(life: ReadLifetime, budget: RetainedReadBudget): WorkerEnv {
  const prepared = new WeakMap<D1PreparedStatement, Proof>();
  const statement = (sql: string, bindings: readonly (string | number | null)[] = []): D1PreparedStatement => {
    const spec: Proof = { sql, bindings: [...bindings] };
    const wrapped = new Proxy({} as D1PreparedStatement, { get(_target, key) {
      life.check();
      if (key === "bind") return (...values: (string | number | null)[]) => statement(sql, values);
      if (key === "first" || key === "all") return async (...args: unknown[]) => {
        try {
          if (args.length) return fail("non_read_operation");
          budget.admit([spec], false);
          const value = await life.wait(async () => {
            const result = await life.database.prepare(sql).bind(...spec.bindings).all();
            budget.result(result, 1, false, key === "first"); return result;
          });
          const rows = own(value, "results") as unknown[];
          return key === "first" ? rows.length ? own(rows, 0) : null : value;
        } catch (error) { life.stopped = true; throw error; }
      };
      return fail("non_read_operation");
    } });
    prepared.set(wrapped, spec); return wrapped;
  };
  const database = new Proxy(life.database, { get(_target, key) {
    life.check();
    if (key === "prepare") return (sql: string) => {
      if (typeof sql !== "string" || new TextEncoder().encode(sql).byteLength > 100_000 || !readSql(sql)) return fail("non_read_operation");
      return statement(sql);
    };
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      try {
        if (!Array.isArray(statements) || Object.getPrototypeOf(statements) !== Array.prototype || statements.length !== 3
          || Reflect.ownKeys(statements).length !== 4) return fail("retained_read_bound");
        const items: Proof[] = [];
        for (let index = 0; index < statements.length; index++) items.push(prepared.get(own(statements, index) as D1PreparedStatement) ?? fail("foreign_statement"));
        budget.admit(items, true);
        return await life.wait(async () => {
          const value = await life.database.batch(items.map(item => life.database.prepare(item.sql).bind(...item.bindings)));
          budget.result(value, items.length, true, false); return value;
        });
      } catch (error) { life.stopped = true; throw error; }
    };
    return fail("non_read_operation");
  } });
  return new Proxy(life.env, { get(target, key, receiver) {
    life.check(); if (key === "MEDIA") return fail("media_unavailable");
    return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}

/** Three fixed passes over the actual full proof: initial qualification, then
 * before and after bytes. No unused writer/source allowance is transferred. */
class RetainedProofBudget {
  readonly parts: number; readonly requestReservation: number; readonly resultReservation: number;
  calls = 0; requestBytes = 0; resultBytes = 0;
  constructor(parts: number) {
    if (!Number.isSafeInteger(parts) || parts < 1 || parts > 256) fail("proof_bound");
    this.parts = parts;
    this.requestReservation = 3 * parts * (100_000 + 1_048_576);
    this.resultReservation = 3 * (parts * 16_384 + parts + 1);
  }
  admit(parts: readonly Proof[]): void {
    if (parts.length !== this.parts || ++this.calls > 3) return fail("retained_proof_bound");
    let bytes = 0;
    for (const part of parts) {
      const sql = `SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS current`;
      const sqlBytes = new TextEncoder().encode(sql).byteLength;
      if (sqlBytes > 100_000 || !readSql(sql) || part.bindings.length > 100) return fail("retained_proof_bound");
      bytes += sqlBytes + retainedEnvelopeBytes(part.bindings, 1_048_576);
    }
    if (this.requestBytes + bytes > this.requestReservation) return fail("retained_proof_bound");
    this.requestBytes += bytes;
  }
  result(value: unknown): void {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== this.parts) return fail("proof_ack_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== this.parts + 1) return fail("proof_ack_invalid");
    let bytes = this.parts + 1;
    for (let index = 0; index < this.parts; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("proof_ack_invalid");
      bytes += retainedEnvelopeBytes(descriptor.value, 16_384);
    }
    if (this.resultBytes + bytes > this.resultReservation) return fail("retained_proof_bound");
    this.resultBytes += bytes;
  }
}
async function proveRetained(life: ReadLifetime, budget: RetainedProofBudget, parts: readonly Proof[]): Promise<void> {
  try {
    life.check(); budget.admit(parts);
    const statements = parts.map(part => life.database.prepare(`SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS current`).bind(...part.bindings));
    const results = await life.wait(async () => { const value = await life.database.batch(statements); budget.result(value); return value; });
    for (let index = 0; index < results.length; index++) {
      const result = own(results, index), rows = own(result, "results");
      if (!successful(result) || !Array.isArray(rows) || rows.length !== 1 || own(own(rows, 0), "current") !== 1) return fail("proof_unavailable");
    }
    life.check();
  } catch (error) { life.stopped = true; throw error; }
}

// These are the three read-only forms used by readExistingPrincipalRequest.
// Each is admitted once for this fresh request; a lifecycle write is unavailable.
const retainedPrincipalForms = new Map<string, number>([[PRINCIPAL_WITH_ACCESS_SQL, 1],
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
function retainedPrincipalEnvironment(life: ReadLifetime, readEnv: WorkerEnv): WorkerEnv {
  const used = new Set<string>();
  const statement = (sql: string, bindings: readonly unknown[] = []): D1PreparedStatement => new Proxy({} as D1PreparedStatement, { get(_target, key) {
    life.check();
    if (key === "bind") return (...values: unknown[]) => {
      if (values.length !== retainedPrincipalForms.get(sql) || values.some(value => typeof value !== "string"
        || !value.isWellFormed() || new TextEncoder().encode(value).byteLength > 32768)) return fail("retained_principal_bound");
      return statement(sql, values);
    };
    if (key === "first") return async (...args: unknown[]) => {
      if (args.length || bindings.length !== retainedPrincipalForms.get(sql) || used.has(sql)) return fail("retained_principal_bound");
      used.add(sql);
      return retainedReadRow(await life.wait(() => readEnv.DB.prepare(sql).bind(...bindings).first()));
    };
    return fail("non_read_operation");
  } });
  const database = new Proxy(life.database, { get(_target, key) {
    life.check();
    if (key !== "prepare") return fail("non_read_operation");
    return (sql: string) => { if (!retainedPrincipalForms.has(sql)) return fail("non_read_operation"); return statement(sql); };
  } });
  return new Proxy(readEnv, { get(target, key, receiver) {
    life.check(); return key === "DB" ? database : Reflect.get(target, key, receiver);
  } });
}

/** A new request requalifies the original completed graph and its one ready,
 * unpublished attempt. Parsing a retained row is never the minting boundary. */
export async function inspectRetainedGuestImageResultReady(request: Request, env: WorkerEnv,
  input: GuestImageResultRetainedReadyInput): Promise<GuestImageResultRetainedReadySeed> {
  if (!(request instanceof Request) || retainedRequests.has(request)) return fail("retained_admission_unavailable");
  retainedRequests.add(request);
  const copied = retainedInput(input);
  const admissionBudget = new RetainedReadBudget("admission");
  let life = new ReadLifetime(request, env), readEnv = retainedReadEnvironment(life, admissionBudget);
  try {
    if ((request.headers.get("cookie") ?? "").split(";").some(part =>
      ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("personal_principal_required");
    const auth = await life.wait(() => readExistingPrincipalRequest(request, retainedPrincipalEnvironment(life, readEnv), "creator", { account: "principal" }));
    if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
      || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")) return fail("destination_unavailable");
    const destinationUserId = auth.user.userId, selector = copied.selector;
    const rawAttempt = retainedReadRow(await life.wait(() => readEnv.DB.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
      WHERE attempt_id=? AND custody_id=? AND session_id=? AND destination_user_id=? AND manifest_digest=?
        AND typeof(descriptor_json)='text' AND length(CAST(descriptor_json AS BLOB))<=65536
        AND typeof(lease_snapshot_json)='text' AND length(CAST(lease_snapshot_json AS BLOB))<=32768
        AND typeof(destination_metadata_json)='text' AND length(CAST(destination_metadata_json AS BLOB))<=16384`)
      .bind(selector.attemptId, selector.custodyId, copied.proof.sessionId, destinationUserId, selector.manifestDigest).first()));
    const row = await life.wait(() => readGuestImageResultCopyAttemptRow(rawAttempt));
    if (row.state !== "ready" || row.put_outcome !== "success" || row.verified_at_ms === null || row.published_at_ms !== null
      || row.published_claim_digest !== null || row.attempt_id !== selector.attemptId || row.custody_id !== selector.custodyId
      || row.session_id !== copied.proof.sessionId || row.destination_user_id !== destinationUserId || row.manifest_digest !== selector.manifestDigest) return fail("retained_attempt_unavailable");
    const descriptor = await life.wait(() => validateGuestImageResultCopyDescriptor(JSON.parse(row.descriptor_json)));
    life.expiresAtMs = Math.min(row.source_expires_at_ms, descriptor.leaseSnapshot.expires_at_ms); life.check();
    const leaseReadStarted = performance.now();
    const rawLease = retainedClosed(retainedReadRow(await life.wait(() => readEnv.DB.prepare(`SELECT ${retainedLeaseColumns.join(",")},${GUEST_DB_NOW} AS observed_at_ms
      FROM experience_guest_claim_leases WHERE session_id=? AND typeof(request_ids_json)='text' AND length(CAST(request_ids_json AS BLOB))<=32768`)
      .bind(row.session_id).first())), [...retainedLeaseColumns, "observed_at_ms"]);
    const observedAt = rawLease.observed_at_ms, leaseValue = Object.fromEntries(retainedLeaseColumns.map(column => [column, rawLease[column]]));
    if (canonicalJson(leaseValue) !== canonicalJson(descriptor.leaseSnapshot) || typeof observedAt !== "number" || !Number.isSafeInteger(observedAt)
      || observedAt < descriptor.leaseSnapshot.created_at_ms || observedAt < row.updated_at_ms || observedAt >= life.expiresAtMs) return fail("retained_lease_unavailable");
    admissionBudget.finish();
    const expiryCeiling = life.expiresAtMs;
    // Retire the admission adapter into a strictly shorter collection lifetime.
    // This preserves its original deadline and adds the observed lease/source
    // ceiling to the monotonic timer without changing ordinary ReadLifetime.
    life.check();
    const boundedLife = new ReadLifetime(request, env, Math.min(life.deadline, performance.now() + expiryCeiling - Date.now(),
      leaseReadStarted + expiryCeiling - observedAt));
    boundedLife.expiresAtMs = expiryCeiling; boundedLife.check();
    const collectionBudget = new RetainedReadBudget("collection");
    life.stopped = true; life = boundedLife; readEnv = retainedReadEnvironment(life, collectionBudget);
    const projected = await collectProjection(life, readEnv, { proof: copied.proof }, expiryCeiling);
    collectionBudget.finish();
    const { history, facts, producerMetadata } = projected;
    if (projected.data.manifestDigest !== descriptor.manifestDigest || canonicalJson(projected.data.manifest) !== canonicalJson(descriptor.manifest)
      || canonicalJson(producerMetadata) !== canonicalJson(descriptor.source.producerMetadata)) return fail("retained_source_changed");
    guestImageResultClaimPublicationAvailable(facts.claimSourceFacts);
    const sourceData = captureSourceData(history, facts, copied.proof);
    const lease = readGuestImageStageClaimLeaseRow(leaseValue, sourceData.session, destinationUserId, projected.data.manifestDigest);
    const nativeAuthority = projectIntakeAuthority(env, { user: auth.user, principal: auth.user, impersonation: null },
      { projectId: projected.data.manifest.projectId, documentId: projected.data.manifest.documentId });
    const authority: Proof = freeze({ sql: nativeAuthority.sql, bindings: [...nativeAuthority.bindings] });
    const leaseProof: Proof = freeze({ sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE json_array(${retainedLeaseColumns.join(",")})=?
      AND created_at_ms<=${GUEST_DB_NOW} AND expires_at_ms>${GUEST_DB_NOW})`, bindings: [JSON.stringify(retainedLeaseColumns.map(column => lease[column]))] });
    const proof = freeze([...facts.claimSourceProofs.common, authority, leaseProof, guestImageResultReadyAttemptProof(facts.claimSourceFacts, row)]);
    const data: GuestImageResultRetainedReadyData = Object.freeze({ ...sourceData,
      data: freeze({ ...projected.data, proof }), producerMetadata, claimSourceFacts: facts.claimSourceFacts,
      row, descriptor, lease, destinationUserId });
    const proofBudget = new RetainedProofBudget(proof.length);
    await proveRetained(life, proofBudget, proof);
    const seed = Object.freeze({}) as GuestImageResultRetainedReadySeed;
    life.check(); retainedSeeds.set(seed, { life, readEnv, data, proofBudget, taken: false, currentProofs: 0, proving: false }); return seed;
  } catch (error) { life.stopped = true; throw error; }
}
function retainedState(request: Request, env: WorkerEnv, owner: GuestImageResultRetainedReadyOwner): RetainedReady {
  const captured = owner && typeof owner === "object" ? retainedOwners.get(owner) : undefined;
  if (!captured || captured.life.request !== request || captured.life.env !== env || !captured.taken) return fail("retained_owner_unavailable");
  captured.life.check(); return captured;
}
/** One-way handoff of this fresh qualified owner. It cannot revive a previous
 * claim seed, reserve an attempt, dispatch a PUT or extend the original lease. */
export function takeGuestImageResultRetainedReadySeed(request: Request, env: WorkerEnv,
  seed: GuestImageResultRetainedReadySeed): Readonly<{ owner: GuestImageResultRetainedReadyOwner;
    data: GuestImageResultRetainedReadyData; bounds: Readonly<{ monotonicDeadline: number; expiresAtMs: number }> }> {
  const captured = seed && typeof seed === "object" ? retainedSeeds.get(seed) : undefined;
  if (!captured || captured.life.request !== request || captured.life.env !== env || captured.taken) return fail("retained_seed_unavailable");
  captured.life.check(); captured.taken = true; retainedSeeds.delete(seed);
  const owner = Object.freeze({}) as GuestImageResultRetainedReadyOwner;
  retainedOwners.set(owner, captured);
  return Object.freeze({ owner, data: captured.data, bounds: Object.freeze({ monotonicDeadline: Math.min(captured.life.deadline,
    performance.now() + captured.life.expiresAtMs - Date.now()), expiresAtMs: captured.life.expiresAtMs }) });
}
export function assertGuestImageResultRetainedReadyLocal(request: Request, env: WorkerEnv, owner: GuestImageResultRetainedReadyOwner): void {
  retainedState(request, env, owner);
}
/** Exactly two post-handoff proofs belong to the before/after destination-byte
 * read. The final claim owner must prove its own full publication boundary. */
export async function assertGuestImageResultRetainedReadyCurrent(request: Request, env: WorkerEnv,
  owner: GuestImageResultRetainedReadyOwner): Promise<void> {
  const captured = retainedState(request, env, owner);
  if (captured.proving || ++captured.currentProofs > 2) { captured.life.stopped = true; return fail("retained_proof_bound"); }
  captured.proving = true;
  try { await proveRetained(captured.life, captured.proofBudget, captured.data.data.proof); }
  finally { captured.proving = false; }
}
