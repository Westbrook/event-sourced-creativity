import { disposeSelectedOutputShareMp3, isOwnedSelectedOutputShareMp3,
  selectedOutputShareMp3ProjectionBusy, selectedOutputShareMp3ProjectionDrained,
  type ProjectedSelectedOutputShareMp3 } from "./selected-output-share-mp3-projection.ts";

/** Resource ownership only. This module grants no source or publication access. */
export const SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS = Object.freeze({ deadlineMs: 30_000,
  sourceBytes: 1_000_000, publicBytes: 3_840_044, chunkBytes: 65_536,
  ownedPayloadAndWasmBytes: 26_653_912 });
declare const operationBrand: unique symbol;
export type SelectedOutputShareMp3Operation = Readonly<{ [operationBrand]: true }>;
export type SelectedOutputShareMp3Deadline = Readonly<{ wallDeadline: number; monotonicDeadline: number }>;
type State = {
  controller: AbortController; requestSignal: AbortSignal; onAbort: () => void;
  wallDeadline: number; monotonicDeadline: number; timer: ReturnType<typeof setTimeout>;
  stop: Promise<never>; rejectStop: (error: Error) => void;
  stopped: boolean; finishing: boolean; released: boolean; poisoned: boolean;
  pending: Set<Promise<unknown>>; waitingDecoder: boolean;
  source: Uint8Array<ArrayBuffer> | null; projection: ProjectedSelectedOutputShareMp3 | null;
  response: Uint8Array<ArrayBuffer> | null; copied: boolean; handedOff: boolean;
  body: ReadableStreamDefaultController<Uint8Array> | null;
};
const owners = new WeakMap<SelectedOutputShareMp3Operation, State>();
let occupied = false;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const addEvent = EventTarget.prototype.addEventListener, removeEvent = EventTarget.prototype.removeEventListener;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const offsetOf = Object.getOwnPropertyDescriptor(typed, "byteOffset")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const zero = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array.prototype.fill.call(bytes, 0);
const unavailable = () => new Error("selected_output_share_unavailable");
function state(operation: SelectedOutputShareMp3Operation): State {
  const value = owners.get(operation); if (!value || value.released) throw unavailable(); return value;
}
function release(value: State) {
  if (!value.finishing || value.pending.size || value.released || value.poisoned) return;
  // The projector can have returned a refusal while its internal digest or
  // qualification still runs. Its private drain is part of this operation.
  if (selectedOutputShareMp3ProjectionBusy()) {
    if (!value.waitingDecoder) {
      value.waitingDecoder = true;
      void selectedOutputShareMp3ProjectionDrained().then(() => { value.waitingDecoder = false; release(value); }, () => { value.poisoned = true; });
    }
    return;
  }
  try {
    if (value.source) zero(value.source); value.source = null;
    if (value.projection) disposeSelectedOutputShareMp3(value.projection); value.projection = null;
    if (value.response) zero(value.response); value.response = null;
  } catch { value.poisoned = true; return; }
  clearTimeout(value.timer); removeEvent.call(value.requestSignal, "abort", value.onAbort);
  value.body = null; value.released = true; occupied = false;
}
function stop(value: State) {
  if (!value.stopped) {
    value.stopped = true; if (value.handedOff) value.finishing = true;
    clearTimeout(value.timer); removeEvent.call(value.requestSignal, "abort", value.onAbort);
    value.controller.abort(); value.rejectStop(unavailable());
    try { value.body?.error(unavailable()); } catch { /* Already closed/cancelled. */ }
    value.body = null;
  }
  release(value);
}
function current(value: State) {
  if (value.stopped || value.released || value.finishing || aborted.call(value.requestSignal)
    || performance.now() >= value.monotonicDeadline || Date.now() >= value.wallDeadline) {
    stop(value); throw unavailable();
  }
}
function exactBuffer(bytes: unknown, cap: number): bytes is Uint8Array<ArrayBuffer> {
  try {
    return !!bytes && typeof bytes === "object" && Object.getPrototypeOf(bytes) === Uint8Array.prototype
      && lengthOf.call(bytes) > 0 && lengthOf.call(bytes) <= cap && offsetOf.call(bytes) === 0
      && bufferLength.call(bufferOf.call(bytes)) === lengthOf.call(bytes);
  } catch { return false; }
}

/** One immediate admission per isolate; no waiting queue and no deadline reset. */
export function acquireSelectedOutputShareMp3Operation(requestSignal: AbortSignal,
  inherited?: SelectedOutputShareMp3Deadline): SelectedOutputShareMp3Operation | null {
  try { if (aborted.call(requestSignal) || occupied || selectedOutputShareMp3ProjectionBusy()) return null; } catch { return null; }
  const wallNow = Date.now(), monotonicNow = performance.now();
  let wallDeadline = wallNow + SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.deadlineMs;
  let monotonicDeadline = monotonicNow + SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.deadlineMs;
  if (inherited !== undefined) {
    try {
      if (!inherited || typeof inherited !== "object" || Object.getPrototypeOf(inherited) !== Object.prototype
        && Object.getPrototypeOf(inherited) !== null) return null;
      const fields = Object.getOwnPropertyDescriptors(inherited);
      if (Reflect.ownKeys(fields).length !== 2 || !Object.hasOwn(fields.wallDeadline ?? {}, "value")
        || !Object.hasOwn(fields.monotonicDeadline ?? {}, "value")) return null;
      const capturedWall = fields.wallDeadline!.value, capturedMonotonic = fields.monotonicDeadline!.value;
      if (typeof capturedWall !== "number" || typeof capturedMonotonic !== "number") return null;
      wallDeadline = capturedWall; monotonicDeadline = capturedMonotonic;
      if (!Number.isFinite(wallDeadline) || !Number.isFinite(monotonicDeadline) || wallDeadline <= wallNow
        || monotonicDeadline <= monotonicNow || wallDeadline > wallNow + SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.deadlineMs
        || monotonicDeadline > monotonicNow + SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.deadlineMs) return null;
    } catch { return null; }
  }
  occupied = true;
  const controller = new AbortController(), operation = Object.freeze({}) as SelectedOutputShareMp3Operation;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; }); void stopped.catch(() => {});
  const value = { controller, requestSignal, onAbort: () => {}, wallDeadline, monotonicDeadline,
    stop: stopped, rejectStop, stopped: false, finishing: false, released: false, poisoned: false,
    pending: new Set<Promise<unknown>>(), waitingDecoder: false, source: null, projection: null, response: null,
    copied: false, handedOff: false, body: null } as Omit<State, "timer"> as State;
  value.onAbort = () => stop(value);
  owners.set(operation, value);
  addEvent.call(requestSignal, "abort", value.onAbort, { once: true });
  value.timer = setTimeout(value.onAbort, Math.max(0, Math.min(wallDeadline - Date.now(), monotonicDeadline - performance.now())));
  if (aborted.call(requestSignal)) stop(value);
  return value.released ? null : operation;
}
export function selectedOutputShareMp3OperationSignal(operation: SelectedOutputShareMp3Operation): AbortSignal {
  const value = state(operation); current(value); return value.controller.signal;
}
export function assertSelectedOutputShareMp3OperationCurrent(operation: SelectedOutputShareMp3Operation): void { current(state(operation)); }

/** Register the thunk before racing it. Disposers also remain charged until
 * settled; failure to dispose quarantines admission instead of guessing safe. */
export async function runSelectedOutputShareMp3Operation<T>(operation: SelectedOutputShareMp3Operation,
  thunk: () => Promise<T>, disposeLate?: (result: T) => void | Promise<void>, adopt?: (result: T) => void): Promise<T> {
  const value = state(operation); current(value);
  let delivered = false, available = false, disposed = false, result: T;
  let workSettled = false, decisionComplete = false, disposing = false;
  let resolveTicket: () => void = () => {};
  const ticket = new Promise<void>(resolve => { resolveTicket = resolve; });
  value.pending.add(ticket);
  const done = () => {
    if (!workSettled || !decisionComplete || disposing) return;
    value.pending.delete(ticket); resolveTicket(); release(value);
  };
  const dispose = () => {
    if (!available || delivered || disposed) return;
    disposed = true; disposing = true;
    void Promise.resolve().then(() => disposeLate?.(result)).catch(() => { value.poisoned = true; })
      .finally(() => { disposing = false; done(); });
  };
  // Defer invoking the thunk until the promise has been added to the registry.
  const pending = Promise.resolve().then(() => { current(value); return thunk(); }).then(item => {
    result = item; available = true;
    current(value); adopt?.(item);
    return item;
  });
  void pending.then(() => { workSettled = true; if (decisionComplete && !delivered) dispose(); done(); },
    () => { workSettled = true; if (decisionComplete && !delivered) dispose(); done(); });
  try { const item = await Promise.race([pending, value.stop]); current(value); delivered = true; return item; }
  finally {
    decisionComplete = true; if (!delivered) dispose(); done();
  }
}

/** Allocation-site cleanup is allowed after stop and charged until settled.
 * Call it before the outer owner finishes; it can never start a new work stage. */
export function cleanupSelectedOutputShareMp3Operation(operation: SelectedOutputShareMp3Operation,
  thunk: () => void | Promise<void>): Promise<void> {
  const value = state(operation);
  const pending = Promise.resolve().then(thunk).catch(() => { value.poisoned = true; });
  value.pending.add(pending);
  void pending.finally(() => { value.pending.delete(pending); release(value); });
  return pending;
}

/** Transfer a caller-owned complete buffer without copying it. */
export function ownSelectedOutputShareMp3Source(operation: SelectedOutputShareMp3Operation, bytes: Uint8Array<ArrayBuffer>): void {
  if (!exactBuffer(bytes, SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.sourceBytes)) throw unavailable();
  try { const value = state(operation); if (value.source) throw unavailable(); value.source = bytes; current(value); }
  catch (error) { zero(bytes); throw error; }
}
export function retireSelectedOutputShareMp3Source(operation: SelectedOutputShareMp3Operation): void {
  const value = owners.get(operation); if (!value) return; if (value.source) zero(value.source); value.source = null;
}
export function ownSelectedOutputShareMp3Projection(operation: SelectedOutputShareMp3Operation, projection: ProjectedSelectedOutputShareMp3): void {
  if (!isOwnedSelectedOutputShareMp3(projection)) throw unavailable();
  try { const value = state(operation); if (value.projection) throw unavailable(); value.projection = projection; current(value); }
  catch (error) { disposeSelectedOutputShareMp3(projection); throw error; }
}
export function retireSelectedOutputShareMp3Projection(operation: SelectedOutputShareMp3Operation): void {
  const value = owners.get(operation); if (!value) return; if (value.projection) disposeSelectedOutputShareMp3(value.projection); value.projection = null;
}
/** Register the only final copy before final SQL, so failure still retires it. */
export function ownSelectedOutputShareMp3ResponseBytes(operation: SelectedOutputShareMp3Operation, bytes: Uint8Array<ArrayBuffer>): void {
  if (!exactBuffer(bytes, SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.publicBytes)) throw unavailable();
  try {
    const value = state(operation);
    if (value.copied || value.source || selectedOutputShareMp3ProjectionBusy()) throw unavailable();
    value.copied = true; value.response = bytes; current(value);
  } catch (error) { zero(bytes); throw error; }
}
/** End an operation that has not handed a successful response body to its caller.
 * It is safe and idempotent after release, but cannot finish a handed-off body. */
export function finishSelectedOutputShareMp3Operation(operation: SelectedOutputShareMp3Operation): void {
  const value = owners.get(operation); if (!value || value.released || value.handedOff) return;
  value.finishing = true; stop(value);
}

/** No read/projection/proof takes place here. The caller must finish its final
 * SQL and synchronous byte proof before transferring this already owned copy. */
export function selectedOutputShareMp3Response(operation: SelectedOutputShareMp3Operation,
  bytes: Uint8Array<ArrayBuffer>, init: ResponseInit): Response {
  const value = state(operation); current(value);
  if (value.handedOff || value.response !== bytes || !value.copied || value.source || value.projection || value.pending.size) throw unavailable();
  let offset = 0;
  const finishBody = () => { value.finishing = true; value.body = null; release(value); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { value.body = controller; },
    pull(controller) {
      try {
        current(value);
        if (offset === bytes.byteLength) { controller.close(); finishBody(); return; }
        const end = Math.min(offset + SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.chunkBytes, bytes.byteLength);
        const chunk = bytes.slice(offset, end);
        try { controller.enqueue(chunk); } catch (error) { zero(chunk); throw error; }
        offset = end;
        // Close on the next pull, after the last emitted chunk was consumed.
      } catch { stop(value); }
    },
    cancel() { finishBody(); },
  }, { highWaterMark: 0 });
  try {
    const response = new Response(stream, init); value.handedOff = true; return response;
  } catch (error) {
    void stream.cancel().catch(() => {}); stop(value); throw error;
  }
}
