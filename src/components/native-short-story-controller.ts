import {
  captureNativeStoryHandle, captureNativeStorySetup, nativeStoryRetainedRoute,
  validateNativeStoryCompletion, type NativeStoryCompletion, type NativeStoryFailureReason,
  type NativeStoryHandle, type NativeStorySetup, type NativeStorySubmission,
} from "../model/native-short-story-generation.ts";
import { readNativeStoryCompletion } from "../model/retained-short-story-client.ts";

export type NativeStoryOpening = Readonly<{ id: number; documentId: string }>;
export type NativeStoryControllerState = Readonly<{
  openingId: number; documentId: string; submissionId: number | null; readId: number | null;
  status: "ready" | "submitting" | "submitted" | "not-dispatched" | "uncertain"
    | "checking" | "available" | "unavailable" | "retired";
  reason: NativeStoryFailureReason | null; handle: NativeStoryHandle | null;
  reused: boolean | null; completion: NativeStoryCompletion | null;
}>;
export type NativeStoryControllerPorts = {
  submit: (setup: NativeStorySetup, controls: { current: () => boolean }) => Promise<NativeStorySubmission>;
  origin: string;
  request: (path: string, init: RequestInit) => Promise<Response>;
  changed?: (state: NativeStoryControllerState) => void;
  /** Deterministic test seam; production uses the unchanged bounded completion client. */
  readCompletion?: typeof readNativeStoryCompletion;
};
export type NativeStoryControllerClock = {
  now: () => number;
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};
type Attempt = Readonly<{ id: number; openingId: number }>;
type Read = {
  id: number; opening: NativeStoryOpening; abort: AbortController;
  timer: unknown; stop: () => void; cleaned: boolean;
};
const READ_DEADLINE_MS = 10_000;
const clock: NativeStoryControllerClock = {
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
};

/** One persistent dialog-owner instance; retirement never grants another attempt. */
export class NativeShortStoryController {
  readonly #ports: NativeStoryControllerPorts;
  readonly #clock: NativeStoryControllerClock;
  // No retired setup, handle, receipt or authorization data is retained here.
  readonly #attempts = new Map<string, Attempt>();
  #epoch = 0;
  #submissionId = 0;
  #readId = 0;
  #opening: { token: NativeStoryOpening; current: () => boolean } | null = null;
  #read: Read | null = null;
  #pendingRead: Read | null = null;
  #state: NativeStoryControllerState = Object.freeze({
    openingId: 0, documentId: "", submissionId: null, readId: null, status: "retired",
    reason: null, handle: null, reused: null, completion: null,
  });

  constructor(ports: NativeStoryControllerPorts, timing: NativeStoryControllerClock = clock) {
    // Capture ports once, rather than consulting mutable host fields after an await.
    this.#ports = Object.freeze({ ...ports });
    this.#clock = Object.freeze({ ...timing });
  }

  get state(): NativeStoryControllerState { return this.#state; }
  get completionReadPending(): boolean { return this.#pendingRead !== null; }

  #publish(state: NativeStoryControllerState): void {
    this.#state = Object.freeze(state);
    this.#ports.changed?.(this.#state);
  }

  #live(opening: NativeStoryOpening): boolean {
    const active = this.#opening;
    if (!active || active.token !== opening) return false;
    let current = false;
    try { current = active.current(); } catch { /* A failed ownership check withdraws this opening. */ }
    if (!current) { this.retire(opening); return false; }
    return this.#opening === active;
  }

  open(input: { documentId: string; current: () => boolean }): NativeStoryOpening {
    const documentId = input.documentId, current = input.current;
    if (typeof current !== "function" || !captureNativeStorySetup({ documentId, audience: "", tone: "", locale: "en" }))
      throw new TypeError("invalid_native_story_opening");
    const token = Object.freeze({ id: ++this.#epoch, documentId });
    const previous = this.#opening?.token;
    const expectedEpoch = token.id + (previous ? 1 : 0);
    if (previous) this.retire(previous);
    // Retirement callbacks may synchronously open/retire a newer intent. Return
    // this abandoned intent's inert token, never that newer opening's authority.
    if (this.#epoch !== expectedEpoch) return token;
    this.#opening = { token, current };
    this.#publish({ openingId: token.id, documentId, submissionId: null, readId: null,
      status: this.#attempts.has(documentId) ? "uncertain" : "ready",
      reason: null, handle: null, reused: null, completion: null });
    this.#live(token);
    return token;
  }

  /** Root calls this synchronously for every close, hide, replacement and ownership withdrawal. */
  retire(opening: NativeStoryOpening): void {
    if (this.#opening?.token !== opening) return;
    this.#opening = null;
    ++this.#epoch;
    const read = this.#read;
    this.#read = null;
    const failures: unknown[] = [];
    // Publish withdrawal before abort listeners can synchronously open another dialog.
    try {
      this.#publish({ openingId: opening.id, documentId: opening.documentId, submissionId: null,
        readId: null, status: "retired", reason: null, handle: null, reused: null, completion: null });
    } catch (error) { failures.push(error); }
    try { if (read) this.#cleanRead(read); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "native_story_retirement_failed", { cause: failures[0] });
  }

  async create(opening: NativeStoryOpening, input: { audience: string; tone: string; locale: string }): Promise<void> {
    if (!this.#live(opening) || (this.#state.status !== "ready" && this.#state.status !== "not-dispatched")
      || this.#attempts.has(opening.documentId)) return;
    let setup: NativeStorySetup | null = null;
    try { setup = captureNativeStorySetup({ documentId: opening.documentId,
      audience: input.audience, tone: input.tone, locale: input.locale }); } catch { /* No submission was invoked. */ }
    if (!this.#live(opening) || (this.#state.status !== "ready" && this.#state.status !== "not-dispatched")
      || this.#attempts.has(opening.documentId)) return;
    if (!setup) {
      this.#publish({ ...this.#state, status: "not-dispatched", reason: "unavailable" });
      return;
    }
    const attempt = Object.freeze({ id: ++this.#submissionId, openingId: opening.id });
    this.#attempts.set(opening.documentId, attempt);
    try {
      this.#publish({ openingId: opening.id, documentId: opening.documentId, submissionId: attempt.id,
        readId: null, status: "submitting", reason: null, handle: null, reused: null, completion: null });
      // A synchronous rendering callback can retire the opening before invocation.
      if (!this.#live(opening)) {
        if (this.#attempts.get(opening.documentId) === attempt) this.#attempts.delete(opening.documentId);
        return;
      }
    } catch (error) {
      // This span has not invoked submit. Release only its own fence, then retain
      // the original presentation/currentness error without changing any opening.
      if (this.#attempts.get(opening.documentId) === attempt) this.#attempts.delete(opening.documentId);
      throw error;
    }
    let outcome: NativeStorySubmission | null = null;
    try {
      outcome = await this.#ports.submit(setup, { current: () => this.#live(opening) });
    } catch { /* An unexpected rejection does not establish whether dispatch occurred. */ }
    let handle: NativeStoryHandle | null = null;
    let reason: NativeStoryFailureReason | null = null;
    let reused: boolean | null = null;
    try {
      const disposition = outcome?.disposition;
      if (outcome !== null && disposition === "acknowledged") {
        const candidateReused = outcome.reused, candidateHandle = outcome.handle;
        const candidate = captureNativeStoryHandle(candidateHandle);
        if (typeof candidateReused === "boolean" && candidate?.documentId === opening.documentId) {
          handle = candidate; reused = candidateReused;
        }
      } else if (outcome !== null && disposition === "not-dispatched") {
        const candidateHandle = outcome.handle, candidateReason = outcome.reason;
        if (candidateHandle === null && ["budget-blocked", "user-canceled", "unavailable"].includes(candidateReason))
          reason = candidateReason;
      }
    } catch {
      // Commit no partial outcome when any field read or validation throws.
      handle = null; reason = null; reused = null;
    }
    // Within submission settlement, only the exact typed negative result can clear an invoked attempt.
    // This bookkeeping may finish after retirement; it never publishes into a new opening.
    if (reason && this.#attempts.get(opening.documentId) === attempt) this.#attempts.delete(opening.documentId);
    if (!this.#live(opening) || this.#state.submissionId !== attempt.id) return;
    this.#publish({ ...this.#state, status: handle ? "submitted" : reason ? "not-dispatched" : "uncertain",
      reason, handle, reused, completion: null });
  }

  #cleanRead(read: Read): void {
    if (read.cleaned) return;
    read.cleaned = true;
    // Release the UI waiter first, even if an injected cleanup port fails.
    read.stop();
    const failures: unknown[] = [];
    try { this.#clock.clearTimeout(read.timer); } catch (error) { failures.push(error); }
    try { read.abort.abort(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "native_story_read_cleanup_failed", { cause: failures[0] });
  }

  async check(opening: NativeStoryOpening): Promise<void> {
    if (!this.#live(opening) || this.#read || this.#pendingRead || !this.#state.handle) return;
    const handle = captureNativeStoryHandle(this.#state.handle);
    if (!handle || handle.documentId !== opening.documentId) return;
    const originAttempt = this.#attempts.get(opening.documentId), submissionId = this.#state.submissionId;
    let stop!: () => void;
    const stopped = new Promise<null>((resolve) => { stop = () => resolve(null); });
    const read: Read = { id: ++this.#readId, opening, abort: new AbortController(), timer: undefined, stop, cleaned: false };
    this.#read = read;
    this.#pendingRead = read;
    const current = () => this.#read === read && !read.cleaned && !read.abort.signal.aborted && this.#live(opening);
    // Reserve one underlying read across every opening until actual settlement.
    // These handlers release bookkeeping only; they never publish a stale result.
    const release = () => { if (this.#pendingRead === read) this.#pendingRead = null; };
    const work = Promise.resolve().then(() => {
      if (!current()) return null;
      return (this.#ports.readCompletion ?? readNativeStoryCompletion)(handle, {
        origin: this.#ports.origin, request: this.#ports.request, signal: read.abort.signal, current,
      });
    }).then((value) => { release(); return value; }, () => { release(); return null; });
    const failures: unknown[] = [];
    try {
      read.timer = this.#clock.setTimeout(stop, READ_DEADLINE_MS);
      this.#publish({ ...this.#state, readId: read.id, status: "checking", completion: null });
      // Both fulfillment and rejection remain observed after the UI race ends.
      // The port can ignore abort; neither its settlement nor physical work is bounded here.
      const value = await Promise.race([work, stopped]);
      if (current()) {
        const completion = validateNativeStoryCompletion(value, handle, this.#clock.now());
        if (current()) {
          // A live exact completion proves this attempt finished. Release only
          // its captured fence; later expiry affects Open, not that historical proof.
          if (completion && originAttempt && originAttempt.openingId === opening.id
            && originAttempt.id === submissionId && this.#state.openingId === opening.id
            && this.#state.submissionId === submissionId && this.#attempts.get(opening.documentId) === originAttempt)
            this.#attempts.delete(opening.documentId);
          this.#publish({ ...this.#state, status: completion ? "available" : "unavailable", completion });
        }
      }
    } catch (error) { failures.push(error); }
    finally {
      if (this.#read === read) this.#read = null;
      try { this.#cleanRead(read); } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "native_story_check_failed", { cause: failures[0] });
  }

  /** Root uses this route immediately and forwards the same opening guard through navigation. */
  openStory(opening: NativeStoryOpening): string | null {
    if (!this.#live(opening) || this.#state.status !== "available" || !this.#state.handle || !this.#state.completion) return null;
    const handle = captureNativeStoryHandle(this.#state.handle);
    const completion = handle && handle.documentId === opening.documentId
      ? validateNativeStoryCompletion(this.#state.completion, handle, this.#clock.now()) : null;
    // This unchanged helper performs its own Date.now expiry check now; never cache its route.
    const route = completion && handle ? nativeStoryRetainedRoute(completion, handle) : null;
    if (!this.#live(opening)) return null;
    if (!route) { this.#publish({ ...this.#state, status: "unavailable", completion: null }); return null; }
    return route;
  }
}
