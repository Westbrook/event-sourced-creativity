import { digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { collectRetainedGuestImageHistory, current, type Context, type Proof } from "./experience-guest-image-history.ts";
import { collectGuestImageResultFacts } from "./experience-guest-image-result-facts.ts";
import { readGuestImageResultManifest, type GuestImageResultManifest } from "./experience-guest-image-result-contract.ts";
import type { GuestClaimProof } from "./experience-guest-session.ts";
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
  readonly deadline: number; readonly signal: AbortSignal; readonly ctx: Context;
  expiresAtMs = Infinity; stopped = false;
  constructor(request: Request, env: WorkerEnv, deadline?: number) {
    if (!(request instanceof Request) || deadline !== undefined && !Number.isFinite(deadline)) fail("input_invalid");
    this.request = request; this.env = env; this.database = env.DB; this.signal = request.signal;
    this.deadline = Math.min(performance.now() + 30_000, deadline ?? Infinity);
    this.ctx = { request, env, db: env.DB, url: request.url, headers: JSON.stringify(Array.from(request.headers)),
      origin: new URL(request.url).origin, signal: request.signal };
    if (new TextEncoder().encode(this.ctx.headers).byteLength > 32768) return fail("input_invalid");
    this.check();
  }
  check() {
    current(this.ctx);
    if (this.stopped || performance.now() >= this.deadline || Date.now() >= this.expiresAtMs) return fail("lifetime_ended");
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
export type GuestImageResultReview = Readonly<{
  version: 1; kind: "guest-image-result-inventory"; sessionId: string; documentId: string; projectId: string;
  generationId: string; originalPayerUserId: string; manifestDigest: string; sourceHead: number; resultHead: number;
  expiresAt: string; privateBodyCount: 2; recordedObjectCount: 1;
  custodyTransferred: false; publicReadAvailable: false; freshBytesVerified: false;
}>;
type Data = Readonly<{ manifest: GuestImageResultManifest; manifestDigest: string; review: GuestImageResultReview; proof: readonly Proof[] }>;
type ProducerMetadata = Readonly<{ model: string; provider: string; adapter: string; providerRequestId: string }>;
type Captured = { life: ReadLifetime; readEnv: WorkerEnv; data: Data; producerMetadata: ProducerMetadata };
const inventories = new WeakMap<GuestImageResultInventory, Captured>();

function state(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Captured {
  const captured = inventory && typeof inventory === "object" ? inventories.get(inventory) : undefined;
  if (!captured || captured.life.request !== request || captured.life.env !== env || captured.life.database !== env.DB) return fail("capability_unavailable");
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

async function inspect(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }, deadline?: number): Promise<GuestImageResultInventory> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof"])) return fail("input_invalid");
  const copied = freeze(structuredClone(input)), life = new ReadLifetime(request, env, deadline), readEnv = readEnvironment(life);
  try {
    const history = await life.wait(() => collectRetainedGuestImageHistory(request, readEnv, copied));
    const facts = await life.wait(() => collectGuestImageResultFacts(history));
    const { identity, rows } = facts, source = history.original.source;
    life.expiresAtMs = Math.min(Date.parse(identity.expiresAt), Number(history.original.session.expires_at_ms)); life.check();
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
    await prove(life, readEnv, data.proof);
    const inventory = Object.freeze({}) as GuestImageResultInventory;
    life.check(); inventories.set(inventory, { life, readEnv, data, producerMetadata }); return inventory;
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
/** Recheck the original captured graph; this cannot renew the deadline, replace
 * missing private content, accept a changed manifest or grant another purchase. */
export function assertGuestImageResultInventoryCurrent(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Promise<void> {
  const captured = state(request, env, inventory);
  return prove(captured.life, captured.readEnv, captured.data.proof);
}
