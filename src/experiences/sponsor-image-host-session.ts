import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { isDraftId, isIntentId } from "./intake.ts";
import type { ExperienceIntakeRuntime } from "./intake-runtime.ts";
import { createSponsorImageTransport, type SponsorImageBootstrap, type SponsorImageFetcher } from "./sponsor-image-transport.ts";
import { createSponsorImageConfirmationClient, type SponsorImageConfirmation, type SponsorImageConfirmationClient, type SponsorImageConfirmationState } from "./sponsor-image-confirmation-client.ts";

export type SponsorImageEntrySelector = Readonly<{ kind: "fresh" }> | Readonly<{ draftId: string }> | Readonly<{ intentId: string }>;
export type SponsorImageEntryMode = Readonly<{ version: 1; mode: "ordinary"; selector: SponsorImageEntrySelector }>
  | Readonly<{ version: 1; mode: "sponsor-image"; actorUserId: string; selector: SponsorImageEntrySelector }>;
type Opened = Readonly<{ bootstrap: SponsorImageBootstrap; runtime: ExperienceIntakeRuntime }>;
export type SponsorImageHostSession = Readonly<{
  readonly signal: AbortSignal; readonly mode: SponsorImageEntryMode | null;
  readonly runtime: ExperienceIntakeRuntime | undefined; readonly bootstrap: SponsorImageBootstrap | undefined;
  readonly confirmationState: SponsorImageConfirmationState | null; readonly pending: boolean;
  resolveMode(): Promise<SponsorImageEntryMode>;
  openSponsor(): Promise<Opened>;
  readConfirmation(): Promise<SponsorImageConfirmation>;
  confirm(action: Readonly<{ explicitRequirementsConfirmation: true }>): Promise<SponsorImageConfirmation>;
  dispose(): void;
}>;
const fail = (code = "invalid"): never => { throw new Error(`sponsor_image_host_${code}`); };
const actor = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && ![...value].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
function selectorFrom(value: unknown): SponsorImageEntrySelector {
  if (jsonIssues(value).length || !record(value)) return fail();
  if (exactKeys(value, ["kind"]) && value.kind === "fresh") return Object.freeze({ kind: "fresh" });
  if (exactKeys(value, ["draftId"]) && typeof value.draftId === "string" && isDraftId(value.draftId)) return Object.freeze({ draftId: value.draftId });
  if (exactKeys(value, ["intentId"]) && isIntentId(value.intentId)) return Object.freeze({ intentId: value.intentId });
  return fail();
}
function signalFrom(value: unknown): AbortSignal {
  if (!record(value) || Reflect.ownKeys(value).length !== 1 || !exactKeys(value, ["signal"])
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, "signal")!, "value") || !(value.signal instanceof AbortSignal)) return fail();
  return value.signal;
}

/** The entry descriptor is a transport selection, never custody or spend
 * authority. Every private bootstrap, intake and confirmation request retains
 * its own unchanged server allowance. No constructor I/O or default fetch. */
export function createSponsorImageHostSession(rawSelector: SponsorImageEntrySelector, injectedFetcher: SponsorImageFetcher, options: Readonly<{ signal: AbortSignal }>): SponsorImageHostSession {
  const selector = selectorFrom(rawSelector), outside = signalFrom(options);
  if (typeof injectedFetcher !== "function") return fail();
  const send = injectedFetcher, lifetime = new AbortController();
  let disposed = false, pending = false, mode: SponsorImageEntryMode | null = null, opened: Opened | undefined;
  let confirmation: SponsorImageConfirmationClient | undefined, confirmedContext: string | undefined;
  const check = () => { if (disposed || lifetime.signal.aborted) return fail("disposed"); };
  function dispose() {
    if (disposed) return;
    disposed = true; lifetime.abort(); outside.removeEventListener("abort", dispose);
    confirmation?.dispose(); opened?.runtime.dispose();
    confirmation = undefined; confirmedContext = undefined; opened = undefined; mode = null;
  }
  outside.addEventListener("abort", dispose, { once: true });
  if (outside.aborted) dispose();

  // Buffer the original bytes unchanged. This extends cancellation to the
  // runtime's response.json() after bootstrap has removed its temporary listener.
  // The exact server URL is checked before constructing the buffered Response.
  async function boundedFetch(path: string, init: RequestInit, maximumBytes: number, maximumChunks: number, milliseconds: number): Promise<Response> {
    check();
    if (!(init.signal instanceof AbortSignal)) return fail();
    const supplied = init.signal, controller = new AbortController(), deadline = performance.now() + milliseconds;
    let stopped: Error | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, received: Response | undefined;
    let rejectStop!: (error: Error) => void;
    const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    void stopping.catch(() => {});
    const stop = (code: string) => { if (!stopped) {
      stopped = new Error(`sponsor_image_host_${code}`); rejectStop(stopped); controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    } };
    const retired = () => stop("disposed"), cancelled = () => stop("cancelled");
    lifetime.signal.addEventListener("abort", retired, { once: true }); supplied.addEventListener("abort", cancelled, { once: true });
    const timer = setTimeout(() => stop("deadline"), milliseconds);
    const current = () => { if (disposed || lifetime.signal.aborted) retired(); if (supplied.aborted) cancelled(); if (performance.now() >= deadline) stop("deadline"); if (stopped) throw stopped; };
    const wait = async <T>(work: Promise<T>): Promise<T> => {
      const observed = Promise.race([work, stopping]); void observed.catch(() => {});
      current(); const value = await observed; current(); return value;
    };
    try {
      current();
      const response = await wait(send(path, { ...init, signal: controller.signal }).then(value => {
        received = value; if (stopped && value instanceof Response) void value.body?.cancel().catch(() => {}); return value;
      }));
      if (!(response instanceof Response) || response.redirected || response.type === "opaque" || response.type === "opaqueredirect") return fail("response_invalid");
      if (response.url) {
        const url = new URL(response.url);
        if (typeof location === "undefined" || url.origin !== location.origin || url.username || url.password || url.hash
          || `${url.pathname}${url.search}` !== path) return fail("response_invalid");
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) return fail("response_invalid");
      if (!response.body) return fail("response_invalid");
      reader = response.body.getReader();
      const parts: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const part = await wait(reader.read()); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || parts.length >= maximumChunks || (bytes += part.value.byteLength) > maximumBytes) return fail("response_invalid");
        parts.push(part.value.slice());
      }
      const body = new Uint8Array(bytes); let position = 0;
      for (const part of parts) { body.set(part, position); position += part.byteLength; }
      current();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timer); lifetime.signal.removeEventListener("abort", retired); supplied.removeEventListener("abort", cancelled); controller.abort();
      if (reader) void reader.cancel().catch(() => {}); else if (received instanceof Response) void received.body?.cancel().catch(() => {});
    }
  }
  const fetcher: SponsorImageFetcher = (path, init) => boundedFetch(path, init, 524_288, 1024, 30_000);
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    check(); if (pending) return fail("busy"); pending = true;
    let rejectStop!: (error: Error) => void;
    const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    void stopping.catch(() => {});
    const retired = () => rejectStop(new Error("sponsor_image_host_disposed"));
    lifetime.signal.addEventListener("abort", retired, { once: true });
    try { const value = await Promise.race([work(), stopping]); check(); return value; }
    finally { lifetime.signal.removeEventListener("abort", retired); pending = false; }
  }
  function context() {
    check();
    const plan = opened?.runtime.committedPlan, receipt = opened?.runtime.receipt;
    if (!opened || mode?.mode !== "sponsor-image" || !plan || !receipt || opened.runtime.state.phase !== "complete") return fail("unavailable");
    return { version: 1 as const, actorUserId: mode.actorUserId, campaignId: opened.bootstrap.campaignId, plan, receipt };
  }
  async function client() {
    const captured = context(), identity = canonicalJson(captured);
    if (confirmation) { if (identity !== confirmedContext) { confirmation.dispose(); confirmation = undefined; return fail("context_changed"); } return confirmation; }
    const created = await createSponsorImageConfirmationClient(captured, fetcher);
    try { check(); if (canonicalJson(context()) !== identity) return fail("context_changed"); }
    catch (error) { created.dispose(); throw error; }
    confirmation = created; confirmedContext = identity; return created;
  }
  async function readOrConfirm(action?: Readonly<{ explicitRequirementsConfirmation: true }>) {
    const selected = await client(), identity = confirmedContext;
    const value = action ? await selected.confirm(action, { signal: lifetime.signal }) : await selected.read({ signal: lifetime.signal });
    check();
    if (canonicalJson(context()) !== identity) { selected.dispose(); confirmation = undefined; return fail("context_changed"); }
    return value;
  }
  return Object.freeze({
    get signal() { return lifetime.signal; }, get mode() { return mode; }, get runtime() { return opened?.runtime; }, get bootstrap() { return opened?.bootstrap; },
    get confirmationState() { return confirmation?.state ?? null; }, get pending() { return pending; },
    resolveMode() { return operation(async () => {
      if (mode) return mode;
      const deadline = performance.now() + 5000;
      const query = "draftId" in selector ? `?draftId=${selector.draftId}` : "intentId" in selector ? `?intentId=${selector.intentId}` : "";
      const response = await boundedFetch(`/api/experiences/image/entry-mode${query}`,
        { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: lifetime.signal }, 1024, 64, 5000);
      if (!response.ok) return fail("unavailable");
      let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer())); } catch { return fail("response_invalid"); }
      if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["version", "mode", "selector", ...(value.mode === "sponsor-image" ? ["actorUserId"] : [])])
        || value.version !== 1 || value.mode !== "ordinary" && value.mode !== "sponsor-image" || canonicalJson(value.selector) !== canonicalJson(selector)
        || value.mode === "sponsor-image" && !actor(value.actorUserId)) return fail("response_invalid");
      check(); if (performance.now() >= deadline) return fail("deadline");
      return mode = freeze(structuredClone(value)) as SponsorImageEntryMode;
    }); },
    openSponsor() { return operation(async () => {
      if (mode?.mode !== "sponsor-image") return fail("unavailable");
      if (opened) return opened;
      const transport = createSponsorImageTransport({ version: 1, enabled: true, audience: "canonical-principal", output: "image", expectedActorUserId: mode.actorUserId }, fetcher)!;
      const result = await transport.bootstrap("kind" in selector ? undefined : selector, { signal: lifetime.signal });
      try { check(); } catch (error) { result.runtime.dispose(); throw error; }
      return opened = Object.freeze(result);
    }); },
    readConfirmation() { return operation(() => readOrConfirm()); },
    confirm(action) {
      if (jsonIssues(action).length || !record(action) || !exactKeys(action, ["explicitRequirementsConfirmation"]) || action.explicitRequirementsConfirmation !== true) return Promise.reject(new Error("sponsor_image_host_explicit_confirmation_required"));
      const captured = Object.freeze({ explicitRequirementsConfirmation: true as const });
      return operation(() => readOrConfirm(captured));
    }, dispose,
  });
}
