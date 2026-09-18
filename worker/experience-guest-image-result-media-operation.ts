import { MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import {
  admitGuestImageResultInventoryMedia, assertGuestImageResultInventoryCurrent, guestImageResultInventoryAccountingKey,
  guestImageResultInventoryBounds, guestImageResultInventoryData, guestImageResultInventoryProducerMetadata,
  type GuestImageResultInventory,
} from "./experience-guest-image-result-inventory.ts";
import {
  assertGuestImageResultClaimResourceLocal, assertGuestImageResultClaimSourceCurrent,
  guestImageResultClaimSourceResource, type GuestImageResultClaimSource,
} from "./experience-guest-image-result-claim-source.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Cumulative admission limits for one original inventory, never replenished by
 * another reader or a later consumer. Scratch includes compressed concatenation,
 * Blob input and both bounded inflated buffers in the unchanged PNG inspector. */
export const GUEST_IMAGE_RESULT_MEDIA_LIMITS = Object.freeze({
  readAttempts: 1, consumeAttempts: 1, get: 1, head: 1, metadataCaptures: 2,
  metadataBytes: 65_536, streamReads: 65_536, hash: 1, inspection: 1, proofs: 3,
  ownedBytes: 2 * MAX_OUTPUT_ASSET_BYTES,
  inspectionScratchBytes: 2 * MAX_OUTPUT_ASSET_BYTES + 2 * 32 * 1024 * 1024,
});
type Charge = keyof typeof GUEST_IMAGE_RESULT_MEDIA_LIMITS;
type BufferState = { users: number };
type MediaSource = Readonly<{ kind: "inventory"; inventory: GuestImageResultInventory }>
  | Readonly<{ kind: "leased"; source: GuestImageResultClaimSource;
    capture: ReturnType<typeof guestImageResultClaimSourceResource> }>;
const unavailable = () => new Error("guest_image_result_media_operation_unavailable");
const ownerToken = Symbol("guest-image-result-media-owner");
const fillBytes = Uint8Array.prototype.fill;

class MediaOperation {
  readonly manifest;
  readonly producer;
  readonly bucket: WorkerEnv["MEDIA"];
  readonly #request: Request;
  readonly #env: WorkerEnv;
  readonly #database: WorkerEnv["DB"];
  readonly #source: MediaSource;
  readonly #signal: AbortSignal;
  readonly #deadline: number;
  readonly #expiresAtMs: number;
  readonly #used = new Map<Charge, number>();
  readonly #buffers = new Map<Uint8Array<ArrayBuffer>, BufferState>();
  readonly #ownedStores = new WeakSet<ArrayBuffer>();
  readonly #cleanups = new Set<() => void>();
  readonly #waiters = new Set<() => void>();
  readonly #abort: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(token: typeof ownerToken, request: Request, env: WorkerEnv, source: MediaSource) {
    if (token !== ownerToken) throw unavailable();
    const bounds = source.kind === "inventory" ? guestImageResultInventoryBounds(request, env, source.inventory) : source.capture.bounds;
    const manifest = source.kind === "inventory" ? guestImageResultInventoryData(request, env, source.inventory).manifest : source.capture.manifest;
    const producer = source.kind === "inventory" ? guestImageResultInventoryProducerMetadata(request, env, source.inventory) : source.capture.producerMetadata;
    this.#request = request; this.#env = env; this.#database = env.DB; this.#source = source;
    this.#signal = request.signal; this.bucket = env.MEDIA;
    this.manifest = manifest;
    this.producer = producer;
    this.#expiresAtMs = bounds.expiresAtMs;
    this.#deadline = Math.min(bounds.monotonicDeadline, performance.now() + bounds.expiresAtMs - Date.now());
    this.#abort = () => this.stop();
    this.check();
    // Also retire idle observations. A timer does not preempt synchronous work;
    // every admitted operation rechecks both clocks before and after its await.
    this.#signal.addEventListener("abort", this.#abort, { once: true });
    this.#timer = setTimeout(this.#abort, this.#remaining());
    Object.freeze(this);
  }

  #remaining() {
    return Math.max(0, Math.min(this.#deadline - performance.now(), this.#expiresAtMs - Date.now()));
  }

  check(): void {
    try {
      if (this.#stopped || this.#signal.aborted || this.#request.signal !== this.#signal
        || this.#env.DB !== this.#database || this.#env.MEDIA !== this.bucket
        || performance.now() >= this.#deadline || Date.now() >= this.#expiresAtMs) throw unavailable();
      // This is only the original brand/request/context/lifetime fence. Database
      // currentness is separately proved by fullProof at every disclosure gate.
      if (this.#source.kind === "inventory") guestImageResultInventoryData(this.#request, this.#env, this.#source.inventory);
      else assertGuestImageResultClaimResourceLocal(this.#request, this.#env, this.#source.capture.resource);
    } catch (error) { this.stop(); throw error; }
  }

  charge(kind: Charge, count = 1): void {
    this.check();
    const limit = GUEST_IMAGE_RESULT_MEDIA_LIMITS[kind], used = (this.#used.get(kind) ?? 0) + count;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(used) || !Number.isFinite(limit) || used > limit) {
      this.stop(); throw unavailable();
    }
    this.#used.set(kind, used);
  }

  /** Cleanup must be synchronous/best effort and observe any promise it starts.
   * No cancellation promise can delay foreground refusal or mint new authority. */
  onStop(cleanup: () => void): () => void {
    this.check();
    if (typeof cleanup !== "function" || this.#cleanups.size >= 8) { this.stop(); throw unavailable(); }
    this.#cleanups.add(cleanup);
    return () => { this.#cleanups.delete(cleanup); };
  }

  async wait<T>(work: () => Promise<T>, delivered?: (value: T) => void): Promise<T> {
    this.check();
    let rejectStop: (() => void) | undefined;
    const ended = new Promise<never>((_, reject) => {
      rejectStop = () => reject(unavailable());
      this.#waiters.add(rejectStop);
    });
    const timer = setTimeout(() => this.stop(), this.#remaining());
    // The handlers exist before dispatch. Delivery runs even after retirement,
    // so an R2 body arriving late can be acquired and immediately cancelled.
    const pending = Promise.resolve().then(() => { this.check(); return work(); }).then(value => {
      delivered?.(value); this.check(); return value;
    });
    try { const value = await Promise.race([pending, ended]); this.check(); return value; }
    catch (error) { this.stop(); throw error; }
    finally {
      clearTimeout(timer);
      if (rejectStop) this.#waiters.delete(rejectStop);
      void pending.catch(() => undefined);
    }
  }

  fullProof(): Promise<void> {
    this.charge("proofs");
    return this.wait(() => this.#source.kind === "inventory"
      ? assertGuestImageResultInventoryCurrent(this.#request, this.#env, this.#source.inventory)
      : assertGuestImageResultClaimSourceCurrent(this.#request, this.#env, this.#source.source));
  }

  own(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    this.check();
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset !== 0
      || bytes.byteLength !== bytes.buffer.byteLength || bytes.byteLength < 1 || bytes.byteLength > MAX_OUTPUT_ASSET_BYTES
      || this.#buffers.has(bytes) || this.#ownedStores.has(bytes.buffer)) { this.stop(); throw unavailable(); }
    this.charge("ownedBytes", bytes.byteLength);
    this.#ownedStores.add(bytes.buffer);
    this.#buffers.set(bytes, { users: 0 }); return bytes;
  }

  /** The actual promise, not the foreground race, controls buffer retirement.
   * The inspector and consumer may still read after the foreground times out. */
  use<T>(bytes: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
    this.check();
    const state = this.#buffers.get(bytes);
    if (!state) { this.stop(); throw unavailable(); }
    return this.wait(() => {
      state.users++;
      let pending: Promise<T>;
      try { pending = Promise.resolve(work()); }
      catch (error) { state.users--; if (this.#stopped) this.#retire(bytes, state); throw error; }
      return pending.finally(() => { state.users--; if (this.#stopped) this.#retire(bytes, state); });
    });
  }

  #retire(bytes: Uint8Array<ArrayBuffer>, state: BufferState) {
    if (state.users) return;
    try { Reflect.apply(fillBytes, bytes, [0]); } catch { /* A consumer may have detached its own copy. */ }
    this.#buffers.delete(bytes);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true; clearTimeout(this.#timer);
    this.#signal.removeEventListener("abort", this.#abort);
    for (const reject of this.#waiters) reject();
    this.#waiters.clear();
    for (const cleanup of this.#cleanups) { try { cleanup(); } catch { /* Best effort only. */ } }
    this.#cleanups.clear();
    for (const [bytes, state] of this.#buffers) this.#retire(bytes, state);
  }
}

export type GuestImageResultMediaOperation = MediaOperation;
type CapturedOperation = { request: Request; env: WorkerEnv;
  source: GuestImageResultInventory | GuestImageResultClaimSource; operation: MediaOperation };
const operations = new WeakMap<object, CapturedOperation>();
const sourceOperations = new WeakMap<GuestImageResultInventory | GuestImageResultClaimSource, CapturedOperation>();

/** There is exactly one terminal accounting owner per genuine inventory. A
 * repeated request cannot replace its lifetime, bucket, resources or budget. */
export function guestImageResultMediaOperation(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): GuestImageResultMediaOperation {
  const captured = sourceOperations.get(inventory);
  if (captured) {
    // A foreign caller cannot retire another request's owner. For the original
    // caller, any observed identity/expiry failure is terminal even if the
    // mutable environment or clock is subsequently restored.
    if (captured.request !== request || captured.env !== env || captured.source !== inventory) throw unavailable();
    captured.operation.check(); return captured.operation;
  }
  const accountingKey = guestImageResultInventoryAccountingKey(request, env, inventory);
  if (operations.has(accountingKey)) throw unavailable();
  const admission = admitGuestImageResultInventoryMedia(request, env, inventory);
  if (admission.accountingKey !== accountingKey) throw unavailable();
  const operation = new MediaOperation(ownerToken, request, env, { kind: "inventory", inventory });
  const entry = { request, env, source: inventory, operation };
  operations.set(accountingKey, entry); sourceOperations.set(inventory, entry);
  operation.check(); return operation;
}

/** A leased source shares the inventory's original accounting identity. Its
 * local resource fence outlives phase retirement only for already owned bytes;
 * fullProof always checks the closed leased source itself. */
export function guestImageResultLeasedMediaOperation(request: Request, env: WorkerEnv,
  source: GuestImageResultClaimSource): GuestImageResultMediaOperation {
  const captured = sourceOperations.get(source);
  if (captured) {
    if (captured.request !== request || captured.env !== env || captured.source !== source) throw unavailable();
    // A retired phase may not acquire its retained resource again. Checking the
    // resource before that refusal still makes lifetime/context failures stop
    // bytes immediately, without treating phase-only refusal as resource loss.
    captured.operation.check();
    guestImageResultClaimSourceResource(request, env, source);
    return captured.operation;
  }
  const capture = guestImageResultClaimSourceResource(request, env, source);
  if (operations.has(capture.accountingKey)) throw unavailable();
  const operation = new MediaOperation(ownerToken, request, env, { kind: "leased", source, capture });
  const entry = { request, env, source, operation };
  operations.set(capture.accountingKey, entry); sourceOperations.set(source, entry);
  operation.check(); return operation;
}
