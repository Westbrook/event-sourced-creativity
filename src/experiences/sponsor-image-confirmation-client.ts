import { canonicalJson, compileExperience, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, experienceResourceId, isDraftId, type ExperiencePlan } from "./intake.ts";
import type { ExperienceIntakeReceipt } from "./native-host.ts";
import { experienceOutputBinding, experienceOutputCommandKey, type ExperienceOutputBinding } from "../../worker/experience-output-binding.ts";
import { createExperienceOutputRecipe } from "../../worker/experience-output-recipe.ts";
import type { SponsorImageFetcher } from "./sponsor-image-transport.ts";

export type SponsorImageConfirmationInput = Readonly<{
  version: 1; campaignId: string; actorUserId: string; plan: ExperiencePlan; receipt: ExperienceIntakeReceipt;
}>;
type OriginalReceipt = Readonly<{ key: string; eventId: string; requestDigest: string }>;
type ConfirmationBase = Readonly<{
  version: 1; kind: "sponsor-image-confirmation"; generation: "unavailable";
  actorUserId: string; campaignId: string; binding: ExperienceOutputBinding; replayed: boolean;
}>;
export type SponsorImageConfirmation = ConfirmationBase & (
  | Readonly<{ status: "unconfirmed" }>
  | Readonly<{ status: "confirmed"; planRevisionId: string; targetId: string;
      receipts: Readonly<{ save: OriginalReceipt; confirm: OriginalReceipt }> }>
);
export type SponsorImageConfirmationState = Readonly<{
  phase: "idle" | "reading" | "confirming" | "ready" | "unavailable" | "disposed";
  confirmation: SponsorImageConfirmation | null; error: string | null;
}>;
export type SponsorImageConfirmationClient = Readonly<{
  readonly state: SponsorImageConfirmationState; readonly pending: boolean;
  read(options: Readonly<{ signal: AbortSignal }>): Promise<SponsorImageConfirmation>;
  confirm(action: Readonly<{ explicitRequirementsConfirmation: true }>, options: Readonly<{ signal: AbortSignal }>): Promise<SponsorImageConfirmation>;
  dispose(): void;
}>;
const prefix = "sponsor_image_confirmation_";
const fail = (code = "invalid"): never => { throw new Error(prefix + code); };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const actor = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && ![...value].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
const campaign = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);

function signalFrom(value: unknown): AbortSignal {
  if (!record(value) || Reflect.ownKeys(value).length !== 1 || !exactKeys(value, ["signal"])
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, "signal")!, "value") || !(value.signal instanceof AbortSignal)) return fail();
  return value.signal;
}
function nativeReceiptMatches(value: unknown, plan: ExperiencePlan) {
  if (!record(value) || value.status !== "complete" || value.generation !== "unavailable"
    || value.draftId !== plan.draftId || value.draftHash !== plan.draftHash || value.projectId !== plan.projectId
    || value.documentId !== plan.documentId || value.documentRoute !== experienceDocumentRoute(plan)
    || !Array.isArray(value.rejected) || value.rejected.length || !Number.isSafeInteger(value.head)
    || !Array.isArray(value.appended) || value.appended.length !== plan.events.length) return false;
  const events: Record<string, unknown>[] = [];
  for (const [index, event] of value.appended.entries()) {
    if (!record(event) || !uuid(event.eventId) || event.actor !== "user" || event.streamId !== plan.streamId
      || event.clientId !== "web:experience-intake" || event.correlationId !== `experience-intake:${plan.projectId}`
      || event.schemaVersion !== 1 || event.compensatesEventId !== null || !Number.isSafeInteger(event.sequence)
      || Number(event.sequence) < 1 || index > 0 && event.sequence !== Number(events[index - 1]!.sequence) + 1
      || event.type !== plan.events[index]!.type || canonicalJson(event.payload) !== canonicalJson(plan.events[index]!.payload)) return false;
    events.push(event);
  }
  return events.length > 0 && new Set(events.map(event => event.eventId)).size === events.length
    && Number(value.head) >= Number(events[events.length - 1]!.sequence);
}

/** Dormant confirmation-only client. These local identity checks never mint
 * server authority. Construction performs no I/O; reopening is a passive GET.
 * All server reads and native writes still require their own metered custody. */
export async function createSponsorImageConfirmationClient(input: SponsorImageConfirmationInput, injectedFetcher: SponsorImageFetcher): Promise<SponsorImageConfirmationClient> {
  if (typeof injectedFetcher !== "function" || jsonIssues(input).length || !record(input)
    || !exactKeys(input, ["version", "campaignId", "actorUserId", "plan", "receipt"]) || input.version !== 1
    || !campaign(input.campaignId) || !actor(input.actorUserId)) return fail();
  // Capture closed data and the transport before the first asynchronous digest.
  const captured = freeze(structuredClone(input)), send = injectedFetcher;
  const { plan, actorUserId, campaignId } = captured;
  if (!record(plan) || plan.version !== 1 || typeof plan.draftId !== "string" || !isDraftId(plan.draftId)
    || !record(plan.request) || !exactKeys(plan.request, ["intentId", "experienceId", "releaseHash", "values"])
    || plan.request.experienceId !== "image" || Object.hasOwn(plan, "reference") || plan.streamId !== `creative:${actorUserId}`
    || !record(plan.release) || !record(plan.release.definition) || plan.release.definition.id !== "image"
    || !record(plan.release.output) || plan.release.output.output !== "image" || !record(plan.release.interactions) || !record(plan.release.copy)) return fail();
  const compiled = await compileExperience(plan.release.definition, { version: "forma-experience-context@2", qualification: "context-authoring",
    interactions: Object.fromEntries(Object.values(plan.release.interactions).map(item => [item.id, item])),
    outputs: { [plan.release.output.id]: plan.release.output }, copy: plan.release.copy });
  if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(plan.release)) return fail();
  const native = await buildExperiencePlan(actorUserId, plan.request, plan.release);
  const { draftHash: _nativeHash, ...nativeBase } = native;
  const receiptId = `sponsor-intake-${(await digest({ campaignId, actor: actorUserId, intent: plan.request.intentId })).slice(7)}`;
  const marked = { ...nativeBase, sponsor_intake: { version: 1 as const, receiptId } };
  const expected = { ...marked, draftHash: await digest(marked) };
  if (canonicalJson(expected) !== canonicalJson(plan) || !nativeReceiptMatches(captured.receipt, plan)) return fail();
  const binding = await experienceOutputBinding(plan);
  const saveKey = await experienceOutputCommandKey(binding, "save"), confirmKey = await experienceOutputCommandKey(binding, "confirm");
  const recipe = createExperienceOutputRecipe({ output: "image",
    requirementId: await experienceResourceId(plan.draftId, "native-output-requirement"),
    deliverableId: await experienceResourceId(plan.draftId, "native-output-deliverable"),
    variantId: await experienceResourceId(plan.draftId, "native-output-variant"),
    aspectRatio: plan.request.values.ratio!.value as { width: number; height: number } });
  const path = `/api/experiences/sponsor/image/drafts/${plan.draftId}/output-confirmation`;
  const draftHash = plan.draftHash;
  let state: SponsorImageConfirmationState = freeze({ phase: "idle", confirmation: null, error: null });
  let pending = false, disposed = false, stopCurrent: (() => void) | undefined, originalIdentity: string | undefined;

  function validateResponse(value: unknown, confirming: boolean): SponsorImageConfirmation {
    if (jsonIssues(value).length || !record(value)) return fail("response_invalid");
    const confirmed = value.status === "confirmed";
    const keys = ["version", "kind", "status", "generation", "actorUserId", "campaignId", "binding", "replayed",
      ...(confirmed ? ["planRevisionId", "targetId", "receipts"] : [])];
    if (!exactKeys(value, keys) || value.version !== 1 || value.kind !== "sponsor-image-confirmation" || value.generation !== "unavailable"
      || value.actorUserId !== actorUserId || value.campaignId !== campaignId || typeof value.replayed !== "boolean"
      || canonicalJson(value.binding) !== canonicalJson(binding) || !confirmed && value.status !== "unconfirmed"
      || confirming && !confirmed || !confirming && value.replayed !== true) return fail("response_invalid");
    if (confirmed) {
      if (!uuid(value.planRevisionId) || value.targetId !== recipe.targetId || !record(value.receipts)
        || !exactKeys(value.receipts, ["save", "confirm"])) return fail("response_invalid");
      for (const stage of ["save", "confirm"] as const) {
        const receipt = value.receipts[stage];
        if (!record(receipt) || !exactKeys(receipt, ["key", "eventId", "requestDigest"])
          || receipt.key !== (stage === "save" ? saveKey : confirmKey) || !uuid(receipt.eventId)
          || typeof receipt.requestDigest !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.requestDigest)) return fail("response_invalid");
      }
      const receipts = value.receipts as unknown as { save: OriginalReceipt; confirm: OriginalReceipt };
      if (receipts.save.eventId === receipts.confirm.eventId) return fail("response_invalid");
      const identity = canonicalJson({ planRevisionId: value.planRevisionId, targetId: value.targetId, receipts });
      if (originalIdentity !== undefined && identity !== originalIdentity) return fail("response_invalid");
    } else if (originalIdentity !== undefined) return fail("response_invalid");
    return freeze(structuredClone(value)) as SponsorImageConfirmation;
  }

  async function perform(confirming: boolean, supplied: Readonly<{ signal: AbortSignal }>): Promise<SponsorImageConfirmation> {
    if (disposed) return fail("disposed");
    if (pending) return fail("busy");
    const signal = signalFrom(supplied), controller = new AbortController();
    pending = true;
    state = freeze({ phase: confirming ? "confirming" : "reading", confirmation: null, error: null });
    const deadline = performance.now() + 30_000;
    let stopped: Error | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, received: Response | undefined;
    let rejectStop!: (error: Error) => void;
    const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    void stopping.catch(() => {});
    const stop = (code: string) => { if (!stopped) {
      stopped = new Error(prefix + code); rejectStop(stopped); controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    } };
    stopCurrent = () => stop("disposed");
    const aborted = () => stop("cancelled");
    signal.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(() => stop("deadline"), 30_000);
    const check = () => { if (signal.aborted) aborted(); if (disposed) stop("disposed"); if (performance.now() >= deadline) stop("deadline"); if (stopped) throw stopped; };
    const wait = async <T>(work: Promise<T>): Promise<T> => {
      const observed = Promise.race([work, stopping]); void observed.catch(() => {});
      check(); const result = await observed; check(); return result;
    };
    try {
      check();
      const init: RequestInit = { method: confirming ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        ...(confirming ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ draftHash, explicitRequirementsConfirmation: true }) } : {}) };
      const response = await wait(send(path, init).then(value => {
        received = value; if (stopped && value instanceof Response) void value.body?.cancel().catch(() => {}); return value;
      }));
      if (!(response instanceof Response) || response.redirected || response.type === "opaque" || response.type === "opaqueredirect") return fail("response_invalid");
      if (response.url) {
        const url = new URL(response.url);
        if (typeof location === "undefined" || url.origin !== location.origin || url.username || url.password || url.hash
          || `${url.pathname}${url.search}` !== path) return fail("response_invalid");
      }
      if (!response.ok || !response.body) return fail("unavailable");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 524_288)) return fail("response_invalid");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let source = "", bytes = 0, chunks = 0;
      while (true) {
        const part = await wait(reader.read()); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || ++chunks > 1024 || (bytes += part.value.byteLength) > 524_288) return fail("response_invalid");
        source += decoder.decode(part.value, { stream: true });
      }
      source += decoder.decode();
      let value: unknown; try { value = JSON.parse(source); } catch { return fail("response_invalid"); }
      check(); const confirmation = validateResponse(value, confirming); check();
      if (confirmation.status === "confirmed") originalIdentity = canonicalJson({ planRevisionId: confirmation.planRevisionId, targetId: confirmation.targetId, receipts: confirmation.receipts });
      state = freeze({ phase: "ready", confirmation, error: null });
      return confirmation;
    } catch (error) {
      if (!disposed) state = freeze({ phase: "unavailable", confirmation: null, error: error instanceof Error && error.message.startsWith(prefix) ? error.message : prefix + "unavailable" });
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", aborted); controller.abort();
      if (reader) void reader.cancel().catch(() => {}); else if (received instanceof Response) void received.body?.cancel().catch(() => {});
      pending = false; stopCurrent = undefined;
    }
  }
  return Object.freeze({ get state() { return state; }, get pending() { return pending; },
    read(options) { return perform(false, options); },
    async confirm(action, options) {
      if (jsonIssues(action).length || !record(action) || !exactKeys(action, ["explicitRequirementsConfirmation"])
        || action.explicitRequirementsConfirmation !== true) return fail("explicit_confirmation_required");
      return perform(true, options);
    },
    dispose() { if (disposed) return; disposed = true; stopCurrent?.(); originalIdentity = undefined;
      state = freeze({ phase: "disposed", confirmation: null, error: null }); }
  });
}
