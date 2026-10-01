import {
  captureNativeImageSetup, captureNativeImageHandle, captureNativeImageSubmission,
  captureNativeImageRead, joinNativeImageCompletion,
  type NativeImageSetup, type NativeImageHandle, type NativeImageSubmission,
  type NativeImageRead, type NativeImageMatch,
} from "../model/native-image-generation.ts";

// Newly reconstructed from the surviving Host/launcher contract. This is not
// the missing original controller and does not adopt background job-feed rows.
export type NativeImageOpening = Readonly<{ id: number; documentId: string }>;
export type NativeImageOperation = Readonly<{ ui: Promise<void>; settled: Promise<void> }>;
export type NativeImageEditTarget = Readonly<{
  openingId: number; submissionId: number; readId: number; documentId: string;
  jobId: string; outputId: string; sourceEventId: string; generationId: string; mediaUrl: string;
}>;
export type NativeImageControllerState = Readonly<{
  openingId: number; documentId: string; submissionId: number | null; readId: number | null;
  status: "ready" | "blocked" | "submitting" | "submitted" | "not-dispatched" | "uncertain"
    | "checking" | "pending" | "terminal" | "unavailable" | "matched" | "retired";
  canCreate: boolean; canCheck: boolean; reason: string | null;
  handle: NativeImageHandle | null; reused: boolean | null; image: NativeImageMatch | null;
}>;
export type NativeImageControllerPorts = Readonly<{
  submit: (setup: NativeImageSetup, controls: {
    current: () => boolean;
    /** Ends only Store's original pre-run queue wait, never a dispatched run. */
    signal?: AbortSignal;
    onAcknowledgment?: (acknowledgment: Extract<NativeImageSubmission, { disposition: "acknowledged" }>) => void;
  }) => Promise<NativeImageSubmission>;
  read: (handle: NativeImageHandle, controls: { current: () => boolean; signal: AbortSignal }) => Promise<NativeImageRead>;
  changed?: (state: NativeImageControllerState) => void;
}>;
export type NativeImageControllerClock = Readonly<{
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}>;
type Deferred = { promise: Promise<void>; finish: (failures?: readonly unknown[]) => void };
type Attempt = Readonly<{ id: number; openingId: number }>;
type Work = {
  opening: NativeImageOpening; ui: Deferred; settled: Deferred;
  stopped: boolean; failures: unknown[]; abort: AbortController | null;
  timer: unknown; scheduled: boolean; cleaned: boolean;
};
type ReadEvidence = {
  opening: NativeImageOpening; submissionId: number; readId: number;
  handle: NativeImageHandle; data: Extract<NativeImageRead, { status: "data" }>["data"];
  image: NativeImageMatch;
};
const clock: NativeImageControllerClock = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
};
function deferred(): Deferred {
  let resolve!: () => void, reject!: (reason: unknown) => void, finished = false;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, finish(failures = []) {
    if (finished) return;
    finished = true;
    if (failures.length === 0) resolve();
    else if (failures.length === 1) reject(failures[0]);
    else reject(new AggregateError(failures, "native_image_operation_failed", { cause: failures[0] }));
  } };
}
function cell(opening: NativeImageOpening, read = false): Work {
  return { opening, ui: deferred(), settled: deferred(), stopped: false, failures: [],
    abort: read ? new AbortController() : null, timer: undefined, scheduled: false, cleaned: false };
}
function operation(work: Work): NativeImageOperation {
  return Object.freeze({ ui: work.ui.promise, settled: work.settled.promise });
}
function idle(): NativeImageOperation {
  return Object.freeze({ ui: Promise.resolve(), settled: Promise.resolve() });
}
const empty = (opening: NativeImageOpening, status: NativeImageControllerState["status"]): NativeImageControllerState => ({
  openingId: opening.id, documentId: opening.documentId, submissionId: null, readId: null,
  status, canCreate: status === "ready", canCheck: false, reason: null, handle: null, reused: null, image: null,
});

/** One persistent owner. Only explicit Create establishes submission authority;
 * only its exact ACK permits explicit Check. No polling, feed adoption or ACK
 * write is performed here. UI retirement cannot settle an underlying request. */
export class NativeImageController {
  readonly #ports: NativeImageControllerPorts;
  readonly #clock: NativeImageControllerClock;
  // Tombstones contain no setup, result, authorization or media data.
  readonly #attempts = new Map<string, Attempt>();
  readonly #claimedJobs = new Map<string, Attempt>();
  #epoch = 0;
  #submissionId = 0;
  #readId = 0;
  #opening: { token: NativeImageOpening; current: () => boolean; withdrawn: boolean } | null = null;
  #submission: Work | null = null;
  #read: Work | null = null;
  #evidence: ReadEvidence | null = null;
  #state: NativeImageControllerState = Object.freeze(empty({ id: 0, documentId: "" }, "retired"));

  constructor(ports: NativeImageControllerPorts, timing: NativeImageControllerClock = clock) {
    this.#ports = Object.freeze({ ...ports });
    this.#clock = Object.freeze({ ...timing });
  }
  get state(): NativeImageControllerState { return this.#state; }
  get completionReadPending(): boolean { return this.#read !== null; }
  get submitPending(): boolean { return this.#submission !== null; }
  get readPending(): boolean { return this.#read !== null; }

  #publish(state: NativeImageControllerState): void {
    this.#state = Object.freeze(state);
    this.#ports.changed?.(this.#state);
  }
  #current(opening: NativeImageOpening): boolean {
    const owner = this.#opening;
    if (!owner || owner.token !== opening || owner.withdrawn) return false;
    let current: boolean;
    try { current = owner.current() === true; }
    catch (error) { owner.withdrawn = true; throw error; }
    if (!current) owner.withdrawn = true;
    return current && !owner.withdrawn && this.#opening === owner;
  }
  #live(opening: NativeImageOpening): boolean {
    if (this.#current(opening)) return true;
    this.retire(opening);
    return false;
  }
  open(input: { documentId: string; current: () => boolean }): NativeImageOpening {
    const documentId = input.documentId, current = input.current;
    if (typeof documentId !== "string" || documentId.length === 0 || documentId.length > 512
      // eslint-disable-next-line no-control-regex -- Reject control characters in captured Document identifiers.
      || documentId.trim() !== documentId || /[\u0000-\u001f\u007f]/u.test(documentId) || typeof current !== "function")
      throw new TypeError("invalid_native_image_opening");
    const token = Object.freeze({ id: ++this.#epoch, documentId });
    const previous = this.#opening?.token;
    const expected = token.id + (previous ? 1 : 0);
    if (previous) this.retire(previous);
    // A retirement callback can open a newer intent. Never return its authority.
    if (this.#epoch !== expected) return token;
    this.#opening = { token, current, withdrawn: false };
    const blocked = this.#attempts.has(documentId) || this.#submission !== null;
    this.#publish(empty(token, blocked ? "blocked" : "ready"));
    this.#live(token);
    return token;
  }

  #refreshAvailability(): void {
    const owner = this.#opening;
    if (!owner || !this.#live(owner.token)) return;
    const state = this.#state;
    const canCreate = this.#submission === null && !this.#attempts.has(owner.token.documentId)
      && ["ready", "blocked", "not-dispatched"].includes(state.status);
    const canCheck = this.#read === null && state.handle !== null
      && ["submitted", "pending", "unavailable"].includes(state.status);
    if (state.canCreate === canCreate && state.canCheck === canCheck) return;
    this.#publish({ ...state, status: state.status === "blocked" && canCreate ? "ready" : state.status, canCreate, canCheck });
  }

  #cleanup(work: Work): void {
    if (work.cleaned) return;
    work.cleaned = true;
    if (work.scheduled) {
      try { this.#clock.clearTimeout(work.timer); } catch (error) { work.failures.push(error); }
    }
    try { work.abort?.abort(); } catch (error) { work.failures.push(error); }
  }
  #stop(work: Work): void {
    work.stopped = true;
    this.#cleanup(work);
    work.ui.finish(work.failures);
  }
  retire(opening: NativeImageOpening): void {
    if (this.#opening?.token !== opening) return;
    this.#opening.withdrawn = true;
    this.#opening = null;
    this.#evidence = null;
    ++this.#epoch;
    const works = [this.#submission, this.#read].filter((work): work is Work => work?.opening === opening);
    const failures: unknown[] = [];
    // Publish retirement before abort listeners can synchronously open again.
    try { this.#publish(empty(opening, "retired")); } catch (error) { failures.push(error); }
    for (const work of works) {
      work.failures.push(...failures);
      const before = work.failures.length;
      this.#stop(work);
      failures.push(...work.failures.slice(before));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "native_image_retirement_failed", { cause: failures[0] });
  }

  create(opening: NativeImageOpening, input: unknown): NativeImageOperation {
    if (!this.#live(opening) || !this.#state.canCreate || this.#submission
      || this.#attempts.has(opening.documentId)) return idle();
    const setup = captureNativeImageSetup(input);
    if (!this.#live(opening) || !this.#state.canCreate || this.#submission
      || this.#attempts.has(opening.documentId)) return idle();
    if (!setup || setup.documentId !== opening.documentId) {
      this.#publish({ ...this.#state, status: "not-dispatched", reason: "unavailable", canCreate: true });
      return idle();
    }
    const work = cell(opening, true), attempt = Object.freeze({ id: ++this.#submissionId, openingId: opening.id });
    this.#submission = work;
    this.#attempts.set(opening.documentId, attempt);
    this.#evidence = null;
    // Reserve before callbacks. The async worker captures synchronous failures
    // into both originals, which the caller receives in this same invocation.
    void this.#runCreate(work, attempt, setup);
    return operation(work);
  }
  async #runCreate(work: Work, attempt: Attempt, setup: NativeImageSetup): Promise<void> {
    let invoked = false, finished = false;
    let acknowledged: Extract<NativeImageSubmission, { disposition: "acknowledged" }> | null = null;
    const current = () => this.#submission === work && !work.stopped && this.#live(work.opening)
      && this.#state.submissionId === attempt.id;
    const accept = (raw: unknown): void => {
      if (finished) throw new Error("settled_native_image_acknowledgment");
      try {
      if (acknowledged !== null) throw new Error("duplicate_native_image_acknowledgment");
      const outcome = captureNativeImageSubmission(raw, setup);
      if (outcome.disposition !== "acknowledged") throw new Error("invalid_native_image_acknowledgment");
      const handle = captureNativeImageHandle(outcome.handle, setup);
      if (!handle || this.#claimedJobs.has(handle.jobId)) throw new Error("reappearing_native_image_acknowledgment");
      this.#claimedJobs.set(handle.jobId, attempt);
      acknowledged = Object.freeze({ disposition: "acknowledged", handle, reused: outcome.reused });
      // Store owns the single run after this exact Create ACK. UI may finish
      // now, but settled still observes that original submit/run Promise.
      if (!current()) return;
      this.#publish({ ...this.#state, status: "submitted", reason: null, handle,
        reused: outcome.reused, image: null, canCreate: false, canCheck: this.#read === null });
      if (current()) work.ui.finish();
      } catch (error) {
        work.failures.push(error);
        work.ui.finish(work.failures);
        throw error;
      }
    };
    try {
      if (!this.#live(work.opening) || work.stopped) return;
      this.#publish({ ...empty(work.opening, "submitting"), submissionId: attempt.id });
      if (!current()) return;
      invoked = true;
      const raw = await this.#ports.submit(setup, { current, signal: work.abort!.signal, onAcknowledgment: accept });
      const outcome = captureNativeImageSubmission(raw, setup);
      if (acknowledged !== null) {
        const original = acknowledged as Extract<NativeImageSubmission, { disposition: "acknowledged" }>;
        if (outcome.disposition !== "acknowledged" || outcome.reused !== original.reused
          || JSON.stringify(outcome.handle) !== JSON.stringify(original.handle))
          throw new Error("conflicting_native_image_submission_settlement");
        return;
      }
      if (outcome.disposition === "acknowledged") { accept(outcome); return; }
      // Only a typed, exact negative result can release an invoked attempt.
      if (outcome.disposition === "not-dispatched" && this.#attempts.get(setup.documentId) === attempt)
        this.#attempts.delete(setup.documentId);
      if (!current()) return;
      const negative = outcome.disposition === "not-dispatched";
      this.#publish({ ...this.#state, status: negative ? "not-dispatched" : "uncertain",
        reason: negative ? outcome.reason : null, handle: null, reused: null, image: null,
        canCreate: negative, canCheck: false });
    } catch (error) {
      if (!work.failures.some(original => Object.is(original, error))) work.failures.push(error);
      try {
        // A late physical failure cannot erase the exact ACK or a newer read.
        if (current() && acknowledged === null) this.#publish({ ...this.#state,
          status: invoked ? "uncertain" : "not-dispatched", reason: null, handle: null,
          image: null, canCreate: !invoked, canCheck: false });
      } catch (error) { work.failures.push(error); }
    } finally {
      finished = true;
      if (!invoked && this.#attempts.get(setup.documentId) === attempt) this.#attempts.delete(setup.documentId);
      if (this.#submission === work) this.#submission = null;
      this.#cleanup(work);
      try { this.#refreshAvailability(); } catch (error) { work.failures.push(error); }
      work.ui.finish(work.failures);
      work.settled.finish(work.failures);
    }
  }

  check(opening: NativeImageOpening): NativeImageOperation {
    if (!this.#live(opening) || !this.#state.canCheck || this.#read || !this.#state.handle) return idle();
    const handle = captureNativeImageHandle(this.#state.handle), submissionId = this.#state.submissionId;
    const attempt = this.#attempts.get(opening.documentId);
    if (!handle || handle.documentId !== opening.documentId || submissionId === null
      || !attempt || attempt.id !== submissionId || attempt.openingId !== opening.id
      || this.#claimedJobs.get(handle.jobId) !== attempt) return idle();
    const work = cell(opening, true), readId = ++this.#readId;
    this.#read = work;
    this.#evidence = null;
    void this.#runRead(work, handle, attempt, readId);
    return operation(work);
  }
  async #runRead(work: Work, handle: NativeImageHandle, attempt: Attempt, readId: number): Promise<void> {
    const current = () => this.#read === work && !work.stopped && !work.abort!.signal.aborted
      && this.#live(work.opening) && this.#state.submissionId === attempt.id && this.#state.readId === readId;
    try {
      if (!this.#live(work.opening) || work.stopped) return;
      this.#publish({ ...this.#state, readId, status: "checking", canCreate: false, canCheck: false, image: null });
      if (!current()) return;
      work.timer = this.#clock.setTimeout(() => {
        try {
          if (current()) this.#publish({ ...this.#state, status: "unavailable", canCheck: false, image: null });
        } catch (error) { work.failures.push(error); }
        this.#stop(work);
      }, 10_000);
      work.scheduled = true;
      // A test clock can fire synchronously during installation. Still release
      // the returned timer exactly once if stop ran before its token existed.
      if (work.cleaned) {
        try { this.#clock.clearTimeout(work.timer); } catch (error) { work.failures.push(error); }
      }
      if (!current()) return;
      const raw = await this.#ports.read(handle, { current, signal: work.abort!.signal });
      if (!current()) return;
      const captured = captureNativeImageRead(raw, current);
      const joined = captured.status === "data" ? joinNativeImageCompletion(handle, captured.data, current) : captured;
      if (!current()) return;
      if (joined.status === "matched" && captured.status === "data") {
        this.#evidence = { opening: work.opening, submissionId: attempt.id, readId, handle,
          data: captured.data, image: joined.image };
        if (this.#attempts.get(handle.documentId) === attempt) this.#attempts.delete(handle.documentId);
      }
      this.#publish({ ...this.#state, status: joined.status === "superseded" ? "unavailable" : joined.status,
        image: joined.status === "matched" ? joined.image : null,
        canCheck: joined.status === "pending" || joined.status === "unavailable", canCreate: false });
    } catch (error) {
      work.failures.push(error);
      try { if (current()) this.#publish({ ...this.#state, status: "unavailable", canCheck: false, image: null }); }
      catch (error) { work.failures.push(error); }
    } finally {
      if (this.#read === work) this.#read = null;
      this.#cleanup(work);
      try { this.#refreshAvailability(); } catch (error) { work.failures.push(error); }
      work.ui.finish(work.failures);
      work.settled.finish(work.failures);
    }
  }

  /** Fresh validation of the same captured result; no route, list read or state
   * publication. A withdrawn owner never becomes current again in this opening. */
  editTarget(opening: NativeImageOpening): NativeImageEditTarget | null {
    const state = this.#state, evidence = this.#evidence;
    if (!this.#current(opening) || state.status !== "matched" || !state.image || !evidence
      || evidence.opening !== opening || evidence.image !== state.image || state.handle?.jobId !== evidence.handle.jobId
      || state.submissionId !== evidence.submissionId || state.readId !== evidence.readId) return null;
    const current = () => this.#current(opening) && this.#state === state && this.#evidence === evidence;
    const joined = joinNativeImageCompletion(evidence.handle, evidence.data, current);
    if (joined.status !== "matched" || !current()) return null;
    const original = evidence.image, image = joined.image;
    if (Object.keys(original).length !== Object.keys(image).length
      || Object.keys(original).some(key => original[key as keyof NativeImageMatch] !== image[key as keyof NativeImageMatch])) return null;
    return Object.freeze({ openingId: opening.id, submissionId: evidence.submissionId, readId: evidence.readId,
      documentId: opening.documentId, jobId: image.jobId, outputId: image.id,
      sourceEventId: image.sourceEventId, generationId: image.generationId, mediaUrl: image.mediaUrl });
  }
}
