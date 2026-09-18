import {
  beginGuestImageResultCopy, guestImageResultCopyPlan, startGuestImageResultCopy, takeGuestImageResultCopyDispatch,
  recordGuestImageResultCopySettlement, guestImageResultCopyStillCurrent, chargeGuestImageResultCopyPutMetadata,
  chargeGuestImageResultCopyDestination, beginGuestImageResultDestinationProof, finishGuestImageResultCopyReady,
  beginGuestImageResultCopyCleanup, chargeGuestImageResultCopyCleanup, finishGuestImageResultCopyCleanup,
  guestImageResultCopyOutcome, type GuestImageResultCopyOwner, type GuestImageResultReadySource,
} from "./experience-guest-image-result-claim-source.ts";
import type { GuestImageResultCopyUse } from "./experience-guest-image-result-media.ts";
import type { GuestImageResultCopyDescriptor } from "./experience-guest-image-result-copy-contract.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Dormant one-attempt writer. This module cannot mint a reservation, select a
 * key, recover an uncertain write, publish custody or renew the original owner. */
const fail = (): never => { throw new Error("guest_image_result_copy_unavailable"); };
const encoder = new TextEncoder();
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const getReader = ReadableStream.prototype.getReader;
const readChunk = ReadableStreamDefaultReader.prototype.read;
const cancelReader = ReadableStreamDefaultReader.prototype.cancel;
const releaseReader = ReadableStreamDefaultReader.prototype.releaseLock;
const cancelBody = ReadableStream.prototype.cancel;
type Outcome = "success" | "conditional-null" | "unknown";
type Bound = { request: Request; env: WorkerEnv; owner: GuestImageResultCopyOwner };
declare const settlementBrand: unique symbol;
declare const destinationBrand: unique symbol;
declare const cleanupBrand: unique symbol;
export type GuestImageResultPutSettlement = Readonly<{ [settlementBrand]: true }>;
export type GuestImageResultDestinationProof = Readonly<{ [destinationBrand]: true }>;
export type GuestImageResultCleanupProof = Readonly<{ [cleanupBrand]: true }>;
const settlements = new WeakMap<GuestImageResultPutSettlement, Bound & { outcome: Outcome; at: number }>();
const destinations = new WeakMap<GuestImageResultDestinationProof, Bound>();
const cleanups = new WeakMap<GuestImageResultCleanupProof, Bound & { outcome: "success" | "conditional-null" }>();
function binding(value: Bound | undefined, request: Request, env: WorkerEnv, owner: GuestImageResultCopyOwner): asserts value is Bound {
  if (!value || value.request !== request || value.env !== env || value.owner !== owner) return fail();
}
/** Only observations minted below by the actual native promise are accepted. */
export function takeGuestImageResultPutSettlement(request: Request, env: WorkerEnv, owner: GuestImageResultCopyOwner,
  token: GuestImageResultPutSettlement) {
  const value = token && typeof token === "object" ? settlements.get(token) : undefined;
  binding(value, request, env, owner); settlements.delete(token);
  return Object.freeze({ outcome: value!.outcome, at: value!.at });
}
export function takeGuestImageResultDestinationProof(request: Request, env: WorkerEnv, owner: GuestImageResultCopyOwner,
  token: GuestImageResultDestinationProof): void {
  const value = token && typeof token === "object" ? destinations.get(token) : undefined;
  binding(value, request, env, owner); destinations.delete(token);
}
export function takeGuestImageResultCleanupProof(request: Request, env: WorkerEnv, owner: GuestImageResultCopyOwner,
  token: GuestImageResultCleanupProof, outcome: string): void {
  const value = token && typeof token === "object" ? cleanups.get(token) : undefined;
  binding(value, request, env, owner);
  if (value!.outcome !== outcome) return fail(); cleanups.delete(token);
}

type Plan = ReturnType<typeof guestImageResultCopyPlan>;
type Run = Bound & { plan: Plan; bucket: WorkerEnv["MEDIA"] };
type Metadata = Readonly<{ size: number; httpEtag: string; key: string; version: string; etag: string;
  custom: Readonly<Record<string, string>>; http: readonly (readonly [string, string])[] }>;
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum
  && value.isWellFormed() && !/[\p{Cc}]/u.test(value) && encoder.encode(value).byteLength <= maximum;
function current(run: Bound): void {
  if (!guestImageResultCopyStillCurrent(run.request, run.env, run.owner)) return fail();
}
/** Foreground reads share the admitted deadline. This never wraps the PUT:
 * actual PUT settlement must continue owning its original upload buffer. */
async function bounded<T>(run: Run, work: () => Promise<T>, late?: (value: T) => void): Promise<T> {
  current(run); let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
  let refused = false, delivered = false, cleaned = false; let deliveredValue: T;
  const cleanup = () => { if (delivered && !cleaned && late) { cleaned = true; late(deliveredValue); } };
  const ended = new Promise<never>((_, reject) => {
    const refuse = () => { refused = true; cleanup(); reject(new Error("guest_image_result_copy_lifetime_ended")); };
    timer = setTimeout(refuse, Math.max(1, Math.min(run.plan.monotonicDeadline - performance.now(), run.plan.expiresAtMs - Date.now())));
    stop = refuse; run.request.signal.addEventListener("abort", stop, { once: true }); if (run.request.signal.aborted) stop();
  });
  const pending = Promise.resolve().then(() => { current(run); return work(); });
  void pending.then(value => { delivered = true; deliveredValue = value; if (refused) cleanup(); }, () => undefined);
  try { const result = await Promise.race([pending, ended]); current(run); return result; }
  catch (error) { refused = true; cleanup(); throw error; }
  finally { clearTimeout(timer); if (stop) run.request.signal.removeEventListener("abort", stop); }
}
/** Destination metadata has a different closed contract from the original
 * guest object. In particular its exact twelve fields REQUIRE outputId. */
function capture(run: Run, object: unknown, lane: "put" | "destination" | "cleanup"): Metadata {
  if (lane === "put") chargeGuestImageResultCopyPutMetadata(run.request, run.env, run.owner, "capture");
  else if (lane === "destination") chargeGuestImageResultCopyDestination(run.request, run.env, run.owner, "metadata");
  else chargeGuestImageResultCopyCleanup(run.request, run.env, run.owner, "metadata");
  if (!object || typeof object !== "object") return fail();
  const size: unknown = Reflect.get(object, "size", object), httpEtag: unknown = Reflect.get(object, "httpEtag", object);
  const custom: unknown = Reflect.get(object, "customMetadata", object), write: unknown = Reflect.get(object, "writeHttpMetadata", object);
  const descriptor: GuestImageResultCopyDescriptor = run.plan.descriptor;
  if (size !== run.plan.byteLength || !text(httpEtag, 1024) || !httpEtag || !custom || typeof custom !== "object"
    || ![Object.prototype, null].includes(Object.getPrototypeOf(custom)) || typeof write !== "function") return fail();
  const expected = descriptor.destinationMetadata, keys = Reflect.ownKeys(custom);
  if (keys.length !== 12 || Object.keys(expected).length !== 12) return fail();
  const captured: Record<string, string> = Object.create(null); let total = encoder.encode(httpEtag).byteLength;
  for (const key of keys) {
    if (typeof key !== "string" || !Object.hasOwn(expected, key)) return fail();
    const field = Object.getOwnPropertyDescriptor(custom, key);
    if (!field || !field.enumerable || !Object.hasOwn(field, "value") || !text(field.value, 8192)
      || field.value !== expected[key as keyof typeof expected]) return fail();
    captured[key] = field.value; total += encoder.encode(key).byteLength + encoder.encode(field.value).byteLength;
  }
  const identity: Record<"key" | "version" | "etag", string> = { key: "", version: "", etag: "" };
  for (const key of ["key", "version", "etag"] as const) {
    const value: unknown = Reflect.get(object, key, object);
    if (!text(value, 1024) || !value || key === "key" && value !== descriptor.destinationKey) return fail();
    identity[key] = value; total += encoder.encode(key).byteLength + encoder.encode(value).byteLength;
  }
  const headers = new Headers(); Reflect.apply(write, object, [headers]);
  const http: (readonly [string, string])[] = [];
  for (const [key, value] of headers) {
    if (http.length >= 32 || !text(key, 128) || !text(value, 8192)) return fail();
    total += encoder.encode(key).byteLength + encoder.encode(value).byteLength; http.push(Object.freeze([key, value] as const));
  }
  if (headers.get("content-type") !== "image/png" || total > 32768) return fail();
  http.sort(([a], [b]) => a.localeCompare(b));
  if (lane === "put") chargeGuestImageResultCopyPutMetadata(run.request, run.env, run.owner, "bytes", total);
  else if (lane === "destination") chargeGuestImageResultCopyDestination(run.request, run.env, run.owner, "metadataBytes", total);
  else chargeGuestImageResultCopyCleanup(run.request, run.env, run.owner, "metadataBytes", total);
  return Object.freeze({ size, httpEtag, ...identity, custom: Object.freeze(captured), http: Object.freeze(http) });
}
function same(left: Metadata, right: Metadata): boolean {
  const custom = (value: Readonly<Record<string, string>>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return left.size === right.size && left.httpEtag === right.httpEtag && left.key === right.key && left.etag === right.etag
    && left.version === right.version && JSON.stringify(left.http) === JSON.stringify(right.http)
    && JSON.stringify(custom(left.custom)) === JSON.stringify(custom(right.custom));
}
function cancelObject(value: unknown) {
  try {
    if (value && typeof value === "object") {
      const body = Reflect.get(value, "body", value); if (body) void cancelBody.call(body).catch(() => undefined);
    }
  } catch { /* Best-effort cancellation does not turn an unknown write into proof. */ }
}
async function destination(run: Run, upload: Uint8Array<ArrayBuffer>, put: Metadata): Promise<GuestImageResultDestinationProof> {
  await beginGuestImageResultDestinationProof(run.request, run.env, run.owner); current(run);
  chargeGuestImageResultCopyDestination(run.request, run.env, run.owner, "get");
  const object = await bounded(run, () => run.bucket.get(run.plan.descriptor.destinationKey), cancelObject);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let complete = false;
  try {
    const metadata = capture(run, object, "destination"); if (!same(put, metadata)) return fail();
    const body = object && Reflect.get(object, "body", object); if (!body) return fail();
    reader = getReader.call(body) as ReadableStreamDefaultReader<Uint8Array>;
    let offset = 0;
    for (;;) {
      current(run); chargeGuestImageResultCopyDestination(run.request, run.env, run.owner, "stream");
      const chunk = await bounded(run, () => readChunk.call(reader!) as Promise<ReadableStreamReadResult<Uint8Array>>);
      current(run);
      if (chunk.done === true) { if (chunk.value !== undefined || offset !== upload.byteLength) return fail(); complete = true; break; }
      if (chunk.done !== false || !chunk.value || Object.getPrototypeOf(chunk.value) !== Uint8Array.prototype) return fail();
      const length = byteLengthOf.call(chunk.value), backing = bufferOf.call(chunk.value);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > upload.byteLength - offset) return fail();
      for (let i = 0; i < length; i++) if (chunk.value[i] !== upload[offset + i]) return fail();
      offset += length;
    }
    current(run); chargeGuestImageResultCopyDestination(run.request, run.env, run.owner, "head");
    const head = await bounded(run, () => run.bucket.head(run.plan.descriptor.destinationKey));
    if (!same(metadata, capture(run, head, "destination"))) return fail();
    current(run); const proof = Object.freeze({}) as GuestImageResultDestinationProof;
    destinations.set(proof, { request: run.request, env: run.env, owner: run.owner }); return proof;
  } finally {
    const release = () => { try { if (reader) releaseReader.call(reader); } catch { /* Pending native read still owns the lock. */ } };
    if (!complete) {
      if (reader) { try { void cancelReader.call(reader).then(release, release); } catch { release(); } }
      else cancelObject(object);
    }
    release();
  }
}
async function cleanup(run: Run, outcome: "success" | "conditional-null", put: Metadata | null): Promise<boolean> {
  current(run);
  if (!await beginGuestImageResultCopyCleanup(run.request, run.env, run.owner)) return false;
  current(run);
  if (outcome === "success") {
    if (!put) return fail();
    chargeGuestImageResultCopyCleanup(run.request, run.env, run.owner, "head");
    const before = await bounded(run, () => run.bucket.head(run.plan.descriptor.destinationKey));
    if (before !== null) {
      if (!same(put, capture(run, before, "cleanup"))) return false;
      current(run); chargeGuestImageResultCopyCleanup(run.request, run.env, run.owner, "delete");
      const ack: unknown = await bounded(run, () => run.bucket.delete(run.plan.descriptor.destinationKey));
      if (ack !== undefined) return false;
      current(run); chargeGuestImageResultCopyCleanup(run.request, run.env, run.owner, "head");
      if (await bounded(run, () => run.bucket.head(run.plan.descriptor.destinationKey)) !== null) return false;
    }
  }
  // Conditional null proves this attempt did not write. Its colliding object is
  // never inspected/deleted or treated as this attempt's successful copy.
  current(run); const proof = Object.freeze({}) as GuestImageResultCleanupProof;
  cleanups.set(proof, { request: run.request, env: run.env, owner: run.owner, outcome });
  return finishGuestImageResultCopyCleanup(run.request, run.env, run.owner, proof);
}
export type GuestImageResultCopyResult = Readonly<{ status: "ready"; ready: GuestImageResultReadySource }>
  | Readonly<{ status: "pending" | "cleaned"; recovery: ReturnType<typeof guestImageResultCopyOutcome> }>;
type CopyContinuation = Readonly<{ result: Promise<GuestImageResultCopyResult> }>;
function continuation(result: Promise<GuestImageResultCopyResult>): CopyContinuation {
  // Foreground expiry can discard the handoff before its caller receives it.
  // Observe rejection now without replacing the original continuation promise.
  void result.catch(() => undefined);
  return Object.freeze({ result });
}
/** The sole physical PUT call lives here. A pending native promise remains the
 * active media consumer after the foreground request stops; its settlement may
 * use only the original prepaid journal lane, never fresh I/O/currentness.
 * The first promise ends at PUT settlement; the journal cannot retain an active
 * byte consumer after that boundary. Its independently observed continuation
 * may compare bytes only synchronously behind fresh currentness checks. */
export async function writeGuestImageResultCopy(request: Request, env: WorkerEnv, use: GuestImageResultCopyUse,
  upload: Uint8Array<ArrayBuffer>): Promise<CopyContinuation> {
  const owner = beginGuestImageResultCopy(request, env, use, upload);
  const pending = (): GuestImageResultCopyResult => Object.freeze({ status: "pending", recovery: guestImageResultCopyOutcome(request, env, owner) });
  try {
    const plan = guestImageResultCopyPlan(request, env, owner), dispatch = await startGuestImageResultCopy(request, env, owner);
    if (!dispatch) return continuation(Promise.resolve(pending()));
    const admitted = takeGuestImageResultCopyDispatch(request, env, owner, dispatch);
    const run: Run = { request, env, owner, plan, bucket: admitted.bucket };
    let outcome: Outcome = "unknown", put: Metadata | null = null;
    try {
      // Await the actual native promise. Never race this await against a timer.
      const native = await run.bucket.put(plan.descriptor.destinationKey, upload.buffer, {
        onlyIf: { etagDoesNotMatch: "*" }, customMetadata: plan.descriptor.destinationMetadata,
        httpMetadata: { contentType: "image/png" },
      });
      if (native === null) outcome = "conditional-null";
      else { put = capture(run, native, "put"); outcome = "success"; }
    } catch { outcome = "unknown"; }
    return continuation((async (): Promise<GuestImageResultCopyResult> => {
      try {
        const observation = Object.freeze({}) as GuestImageResultPutSettlement;
        settlements.set(observation, { request, env, owner, outcome, at: Date.now() });
        if (!await recordGuestImageResultCopySettlement(request, env, owner, observation)
          || !guestImageResultCopyStillCurrent(request, env, owner)) return pending();
        if (outcome === "unknown") return pending();
        if (outcome === "conditional-null") return Object.freeze({ status: await cleanup(run, outcome, null) ? "cleaned" : "pending",
          recovery: guestImageResultCopyOutcome(request, env, owner) });
        let proof: GuestImageResultDestinationProof;
        try { proof = await destination(run, upload, put!); }
        catch {
          if (!guestImageResultCopyStillCurrent(request, env, owner)) return pending();
          const cleaned = await cleanup(run, "success", put);
          return Object.freeze({ status: cleaned ? "cleaned" : "pending", recovery: guestImageResultCopyOutcome(request, env, owner) });
        }
        const ready = await finishGuestImageResultCopyReady(request, env, owner, proof);
        return ready ? Object.freeze({ status: "ready", ready }) : pending();
      } catch { return pending(); }
    })());
  } catch { return continuation(Promise.resolve(pending())); }
}
