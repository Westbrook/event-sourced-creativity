import { exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { captureSponsorAudioReviewIdentity, prepareSponsorAudioAuthorize, readSponsorAudioAuthorizationResponse,
  readSponsorAudioReviewResponse, sponsorAudioReviewPath, type SponsorAudioAuthorizationResponse,
  type SponsorAudioReviewResponse } from "./sponsor-audio-review-transport.ts";

export type SponsorAudioReviewFetcher = (path: string, init: RequestInit) => Promise<Response>;
export type SponsorAudioReviewClientState = Readonly<{
  phase: "idle" | "reading" | "review" | "authorizing" | "authorized" | "unavailable" | "disposed";
  review: SponsorAudioReviewResponse | null;
  authorization: SponsorAudioAuthorizationResponse | null;
  error: string | null;
  /** Failure cannot prove that an attempted authorization did not commit. */
  originalIntent: "unknown_or_retained";
}>;
export type SponsorAudioReviewClient = Readonly<{
  readonly state: SponsorAudioReviewClientState;
  readonly pending: boolean;
  read(options: Readonly<{ signal: AbortSignal }>): Promise<SponsorAudioReviewResponse>;
  authorize(shown: SponsorAudioReviewResponse, suppliedActorRequest: unknown,
    options: Readonly<{ signal: AbortSignal }>): Promise<SponsorAudioAuthorizationResponse>;
  dispose(): void;
}>;

const prefix = "sponsor_audio_review_client_";
const fail = (code: string): never => { throw new Error(prefix + code); };
const timeoutMs = 20_000, maximumBytes = 65_536, maximumChunks = 1024;
function currentReview(shown: SponsorAudioReviewResponse) {
  const now = Date.now();
  if (!Number.isFinite(now) || now >= Math.min(Date.parse(shown.review.expiresAt), Date.parse(shown.review.preview.expiresAt), Date.parse(shown.native.expiresAt)))
    return fail("review_expired");
}
function suppliedSignal(raw: unknown): AbortSignal {
  if (!record(raw) || Reflect.ownKeys(raw).length !== 1 || !exactKeys(raw, ["signal"])
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, "signal")!, "value") || !(raw.signal instanceof AbortSignal)) return fail("options_invalid");
  return raw.signal;
}

/** Dormant injected transport only. No host imports this client; no server
 * review route is installed. Parsed wire metadata never supplies payer/native
 * authority. Construction, reading and reopening cannot authorize or Run. */
export function createSponsorAudioReviewClient(rawIdentity: unknown, injectedFetcher: SponsorAudioReviewFetcher): SponsorAudioReviewClient {
  const identity = captureSponsorAudioReviewIdentity(rawIdentity);
  if (typeof injectedFetcher !== "function") return fail("transport_required");
  const send = injectedFetcher;
  let disposed = false, pending = false, epoch = 0, stopCurrent: (() => void) | undefined;
  let originalAttempt: string | undefined;
  let originalAcknowledgement: string | undefined;
  let state: SponsorAudioReviewClientState = freeze({ phase: "idle", review: null, authorization: null,
    error: null, originalIntent: "unknown_or_retained" });

  async function perform(authorizing: boolean, options: Readonly<{ signal: AbortSignal }>, shown?: SponsorAudioReviewResponse, supplied?: unknown) {
    const signal = suppliedSignal(options);
    if (disposed || pending || signal.aborted) return fail("unavailable");
    if (authorizing && (!shown || shown !== state.review || state.phase !== "review")) return fail("stale_review");
    // Capture the caller's command before any owned await. The transport parser
    // rejects accessors/extra JSON data and retains the actual supplied flags.
    if (authorizing && jsonIssues(supplied).length) return fail("request_invalid");
    const captured = authorizing ? structuredClone(supplied) : undefined;
    const operationEpoch = ++epoch, controller = new AbortController(), deadline = performance.now() + timeoutMs;
    pending = true;
    state = freeze({ ...state, phase: authorizing ? "authorizing" : "reading", error: null });
    let rejectStopped!: (reason: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    // A pre-aborted listener must not leave an unobserved rejection before wait.
    void stopped.catch(() => {});
    const stop = () => { controller.abort(); rejectStopped(new Error(prefix + "stopped")); };
    stopCurrent = stop;
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, received: Response | undefined;
    const current = () => {
      if (disposed || epoch !== operationEpoch || signal.aborted || controller.signal.aborted || performance.now() >= deadline) return fail("stopped");
    };
    const wait = async <T>(operation: Promise<T>): Promise<T> => {
      // The operation can already be settling when the synchronous deadline
      // check fails. Observe its rejection even when no race can be awaited.
      void operation.catch(() => {});
      current(); const value = await Promise.race([operation, stopped]); current(); return value;
    };
    try {
      current();
      const message = authorizing ? await wait(prepareSponsorAudioAuthorize(shown!, captured)) : undefined;
      current();
      if (message) currentReview(shown!);
      const path = message?.path ?? sponsorAudioReviewPath(identity);
      const init: RequestInit = { method: authorizing ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        redirect: "error", signal: controller.signal, headers: { accept: "application/json", ...(authorizing ? { "content-type": "application/json" } : {}) },
        ...(message ? { body: message.body } : {}) };
      if (message) {
        const attempted = JSON.stringify({ path: message.path, body: message.body, requestDigest: message.requestDigest });
        if (originalAttempt !== undefined && originalAttempt !== attempted) return fail("original_intent_changed");
        // A lost acknowledgement still belongs to this one original attempt.
        // Only an explicit exact replay may be sent by the same client instance.
        originalAttempt = attempted;
      }
      const response = await wait(send(path, init).then(value => {
        // Own the arriving body before wait's lifetime check. A fetch can settle
        // after cancellation, including after this operation's finally ran.
        if (!(value instanceof Response)) return fail("response_invalid");
        received = value;
        try { current(); } catch (error) { void value.body?.cancel().catch(() => {}); throw error; }
        return value;
      }));
      if (!(response instanceof Response) || response.redirected || !response.ok || !response.body
        || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) return fail("response_invalid");
      if (response.url) {
        const url = new URL(response.url);
        if (typeof location === "undefined" || url.origin !== location.origin || url.username || url.password || url.hash
          || `${url.pathname}${url.search}` !== path) return fail("response_invalid");
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) return fail("response_invalid");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let source = "", bytes = 0, chunks = 0;
      for (;;) {
        const item = await wait(reader.read());
        if (item.done) break;
        if (!(item.value instanceof Uint8Array) || ++chunks > maximumChunks || (bytes += item.value.byteLength) > maximumBytes) return fail("response_invalid");
        source += decoder.decode(item.value, { stream: true });
      }
      source += decoder.decode();
      let raw: unknown;
      try { raw = JSON.parse(source); } catch { return fail("response_invalid"); }
      current();
      if (message) {
        const authorization = await wait(readSponsorAudioAuthorizationResponse(raw, shown!, message));
        current(); currentReview(shown!);
        // An acknowledgement may repeat the exact original identity; it cannot
        // replace a retained purchase with a different grant, job or receipt.
        const original = JSON.stringify({ grantId: authorization.grantId, jobId: authorization.jobId, receipt: authorization.receipt,
          reviewDigest: authorization.reviewDigest, actorRequestDigest: authorization.actorRequestDigest });
        if (originalAcknowledgement !== undefined && originalAcknowledgement !== original) return fail("original_changed");
        originalAcknowledgement = original;
        state = freeze({ ...state, phase: "authorized", authorization, error: null });
        return authorization;
      }
      const review = await wait(readSponsorAudioReviewResponse(raw, identity));
      current(); currentReview(review);
      state = freeze({ ...state, phase: "review", review, error: null });
      return review;
    } catch (error) {
      if (!disposed && epoch === operationEpoch) state = freeze({ ...state, phase: "unavailable", review: null,
        error: error instanceof Error && error.message.startsWith(prefix) ? error.message : prefix + "unavailable" });
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", stop); controller.abort();
      if (reader) void reader.cancel().catch(() => {}); else if (received instanceof Response) void received.body?.cancel().catch(() => {});
      pending = false; stopCurrent = undefined;
    }
  }

  return Object.freeze({
    get state() { return state; }, get pending() { return pending; },
    read(options) { return perform(false, options) as Promise<SponsorAudioReviewResponse>; },
    authorize(shown, suppliedActorRequest, options) { return perform(true, options, shown, suppliedActorRequest) as Promise<SponsorAudioAuthorizationResponse>; },
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; stopCurrent?.(); originalAttempt = undefined; originalAcknowledgement = undefined;
      state = freeze({ phase: "disposed", review: null, authorization: null, error: null, originalIntent: "unknown_or_retained" });
    },
  });
}
