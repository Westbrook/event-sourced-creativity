import { parseModel3dMiniAppCostPreview, model3dMiniAppCostApprovalMatches } from "../model/model3d-mini-app-consent.ts";
import { EXPERIENCE_BODY_TIMEOUT_MS, experienceResponseTimeout } from "./output-transport-lifetime.ts";
import { readModel3dExecutionPayload } from "../model/output-model3d-offer.ts";
import type { ExperienceModel3dCostApproval } from "./output-binding-contract.ts";
import type { ExperienceAudioCostApproval, ExperienceNativeState, ExperienceNativeUnavailable } from "./output-binding-contract.ts";
import { parseSceneMiniAppCostPreview, sceneMiniAppCostApprovalMatches, type SceneMiniAppCostApproval } from "../model/scene-mini-app-consent.ts";

import { parseAudioMiniAppCostPreview, audioMiniAppCostApprovalMatches } from "../model/audio-mini-app-consent.ts";

export type ExperienceBindingIdentity = Readonly<{ draftId: string; draftHash: string; releaseHash: string; documentId: string; projectId: string; output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "video" | "model3d"; actorUserId: string }>;
export type ExperienceBindingResponse = ExperienceNativeState | ExperienceNativeUnavailable;
export type ExperienceBindingAction = "prepare" | "authorize" | "run" | "resumeRun" | "recoverResult";
const status = new Set(["absent", "preparing", "review", "authorized", "queued", "running", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"]);
const stages = new Set([null, "save", "confirm", "preflight", "authorize", "run"]);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\p{Cc}]/u.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function json(value: unknown, depth = 0, budget = { nodes: 0 }, maximumDepth = 16): boolean {
  if (++budget.nodes > 8192 || depth > maximumDepth) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 65536;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > 4096) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || !json(descriptor.value, depth + 1, budget, maximumDepth)) return false;
    }
    return true;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => typeof key === "string" && key.length <= 256 && key !== "__proto__"
    && "value" in descriptors[key]! && descriptors[key]!.enumerable && json(descriptors[key]!.value, depth + 1, budget, maximumDepth));
}
export function bindingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(bindingJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + bindingJson(value[key])).join(",")}}`;
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new TypeError("binding_json_invalid");
  return serialized;
}
const commandIdentity = (value: unknown) => record(value) && ["key", "eventId"].every(key => text(value[key]));
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function unavailableBinding(error = "original_unavailable"): ExperienceNativeUnavailable {
  return Object.freeze({ version: 1, status: "unavailable", error, originalIntent: "unknown_or_retained", permitted: Object.freeze({ prepare: false, authorize: false, run: false, resumeRun: false }) });
}
/** Decode a bounded server record. This is not admission or Source authority. */
export function decodeExperienceBinding(value: unknown, identity: ExperienceBindingIdentity): ExperienceBindingResponse | null {
  try {
    // A Scene quote embeds its closed response schema (19 levels in offer,
    // 21 through an original grant disclosure). Other limits are unchanged.
    if (!json(value, 0, {nodes: 0}, identity.output === "scene" ? 24 : 16) || !record(value) || value.version !== 1 || !record(value.permitted)) return null;
    const permitted = value.permitted;
    if (permitted.recoverResult !== undefined && typeof permitted.recoverResult !== "boolean") return null;
    if (value.recovery !== undefined && !["pending", "completed"].includes(String(value.recovery))) return null;
    if (!["prepare", "authorize", "run", "resumeRun"].every(key => typeof permitted[key] === "boolean")) return null;
    if (value.status === "unavailable" && value.originalIntent === "unknown_or_retained") {
      return text(value.error) && !permitted.prepare && !permitted.authorize && !permitted.run && !permitted.resumeRun && !permitted.recoverResult ? freeze(structuredClone(value)) as ExperienceNativeUnavailable : null;
    }
    if (!["draftId", "draftHash", "releaseHash", "documentId", "projectId", "output"].every(key => value[key] === identity[key as keyof ExperienceBindingIdentity])
      || value.sourceSurface !== "outputs" || !status.has(String(value.status)) || !stages.has(value.stage as never)
      || !record(value.current) || value.current.custody !== "verified" || value.current.source !== "verified"
      || !text(value.current.sourceDigest) || !text(value.current.requirementsDigest)) return null;
    const plan = value.plan, preflight = value.preflight, original = value.original, grant = value.grant;
    if (value.output === "scene") {
      if (!Object.hasOwn(value, "sceneCostPreview")) return null;
      const preview = value.sceneCostPreview === null ? null : parseSceneMiniAppCostPreview(value.sceneCostPreview);
      if (value.sceneCostPreview !== null && (!preview || preview.actorUserId !== identity.actorUserId
        || preview.documentId !== identity.documentId || preview.projectId !== identity.projectId)) return null;
      if (permitted.authorize || permitted.run || permitted.resumeRun) {
        if (!preview || !record(preflight) || preview.maximumMicrousd !== preflight.maximumMicrousd
          || preview.maximumProviderCallCount !== preflight.maximumCalls) return null;
      }
      if (record(original) && (!preview || preview.requestId !== original.jobId)) return null;
    } else if (Object.hasOwn(value, "sceneCostPreview")) return null;
    if (value.output === "audio") {
      if (!Object.hasOwn(value, "audioCostPreview")) return null;
      const preview = value.audioCostPreview === null ? null : parseAudioMiniAppCostPreview(value.audioCostPreview);
      if (value.audioCostPreview !== null && (!preview || preview.actorUserId !== identity.actorUserId
        || preview.documentId !== identity.documentId || preview.projectId !== identity.projectId
        || preview.draftId !== identity.draftId || preview.sourceDigest !== value.current.sourceDigest
        || preview.requirementsDigest !== value.current.requirementsDigest)) return null;
      if (permitted.authorize || permitted.run || permitted.resumeRun) {
        if (!preview || !record(preflight) || preview.maximumMicrousd !== preflight.maximumMicrousd
          || preview.maximumCalls !== preflight.maximumCalls) return null;
      }
      if (record(original) && (!preview || preview.requestId !== original.jobId)) return null;
    } else if (Object.hasOwn(value, "audioCostPreview")) return null;
    if (value.output === "model3d") {
      if (!Object.hasOwn(value, "model3dCostPreview")) return null;
      const preview = value.model3dCostPreview === null ? null : parseModel3dMiniAppCostPreview(value.model3dCostPreview);
      if (value.model3dCostPreview !== null && (!preview || preview.actorUserId !== identity.actorUserId
        || preview.documentId !== identity.documentId || preview.projectId !== identity.projectId
        || preview.draftId !== identity.draftId || preview.sourceDigest !== value.current.sourceDigest
        || preview.requirementsDigest !== value.current.requirementsDigest)) return null;
      if (permitted.authorize || permitted.run || permitted.resumeRun) {
        if (!preview || !record(preflight) || preview.maximumMicrousd !== preflight.maximumMicrousd
          || preview.maximumCalls !== preflight.maximumCalls) return null;
      }
      if (record(original) && (!preview || preview.requestId !== original.jobId)) return null;
      if (preview) {
        const target = record(preflight) && Array.isArray(preflight.targets) ? preflight.targets[0] : null;
        const payload = record(target) && record(target.settings) ? readModel3dExecutionPayload(target.settings.payload) : null;
        if (!payload || bindingJson(payload.preview) !== bindingJson(preview)) return null;
      }
    } else if (Object.hasOwn(value, "model3dCostPreview")) return null;
    if (plan !== null && (!record(plan) || !["revisionId", "targetId", "targetContractDigest", "sourceDigest", "requirementsDigest"].every(key => text(plan[key]))
      || plan.sourceDigest !== value.current.sourceDigest || plan.requirementsDigest !== value.current.requirementsDigest)) return null;
    if (preflight !== null) {
      if (!record(preflight) || !record(plan) || !["id", "planRevisionId", "termsDigest", "sourceDigest", "requirementsDigest", "createdAt", "expiresAt"].every(key => text(preflight[key]))
        || preflight.planRevisionId !== plan.revisionId || preflight.sourceDigest !== plan.sourceDigest || preflight.requirementsDigest !== plan.requirementsDigest
        || !count(preflight.maximumMicrousd) || !count(preflight.maximumCalls) || !Array.isArray(preflight.targets) || preflight.targets.length !== 1
        || !record(preflight.targets[0]) || preflight.targets[0].targetId !== plan.targetId || !record(preflight.operationAttempts)) return null;
    }
    if (original !== null) {
      if (!record(original) || !record(plan) || !record(grant) || !record(preflight)
        || !["grantId", "grantStatus", "slotId", "slotStatus", "jobId", "jobStatus", "correlationId", "jobExpiresAt", "targetId", "targetContractDigest", "routeDigest", "planRevisionId", "sourceDigest", "requirementsDigest", "expiresAt"].every(key => text(original[key]))
        || original.targetId !== plan.targetId || original.targetContractDigest !== plan.targetContractDigest || original.planRevisionId !== plan.revisionId
        || original.sourceDigest !== plan.sourceDigest || original.requirementsDigest !== plan.requirementsDigest || !commandIdentity(original.authorization)
        || original.run !== null && !commandIdentity(original.run)) return null;
      if (grant.id !== original.grantId || grant.status !== original.grantStatus || grant.planRevisionId !== plan.revisionId
        || grant.actorUserId !== identity.actorUserId || !text(grant.payerUserId) || !text(grant.expiresAt) || grant.expiresAt !== original.expiresAt
        || grant.maximumMicrousd !== preflight.maximumMicrousd || grant.maximumCalls !== preflight.maximumCalls
        || !["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"].every(key => count(grant[key]))
        || !Array.isArray(grant.operations) || grant.operations.length !== 1 || !record(grant.operations[0])
        || !record(grant.disclosure) || bindingJson(grant.disclosure) !== bindingJson(preflight)) return null;
      const slot = grant.operations[0];
      if (slot.id !== original.slotId || slot.targetId !== plan.targetId || slot.jobId !== original.jobId || slot.status !== original.slotStatus
        || slot.maximumMicrousd !== (preflight.targets as Record<string, unknown>[])[0]!.maximumMicrousd
        || slot.maximumCalls !== (preflight.targets as Record<string, unknown>[])[0]!.maximumCalls
        || !["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"].every(key => count(slot[key]))) return null;
    } else if (grant !== null) return null;
    if (!new Set(["never_admitted", "prepared", "original_authorized", "original_run_recorded"]).has(String(value.disposition))) return null;
    if (value.disposition === "never_admitted" && (original !== null || preflight !== null || !["absent", "preparing"].includes(String(value.status)))) return null;
    if (value.disposition === "prepared" && (original !== null || !record(plan) || !record(preflight))) return null;
    if (value.disposition === "original_authorized" && (!record(original) || original.run !== null)) return null;
    if (value.disposition === "original_run_recorded" && (!record(original) || !record(original.run))) return null;
    if (permitted.prepare && (!new Set(["absent", "preparing"]).has(String(value.status)) || original !== null || preflight !== null || permitted.authorize || permitted.run || permitted.resumeRun)) return null;
    if (permitted.authorize && (value.status !== "review" || value.disposition !== "prepared" || !record(preflight) || original !== null || permitted.prepare || permitted.run || permitted.resumeRun)) return null;
    if (permitted.run && (value.status !== "authorized" || value.disposition !== "original_authorized" || !record(original) || original.run !== null || !record(grant)
      || grant.status !== "authorized" || original.slotStatus !== "authorized" || permitted.prepare || permitted.authorize || permitted.resumeRun)) return null;
    if (permitted.resumeRun && (value.disposition !== "original_run_recorded" || !["queued", "running"].includes(String(value.status))
      || !record(original) || !commandIdentity(original.run) || !["queued", "running"].includes(String(original.slotStatus))
      || !["queued", "running"].includes(String(original.jobStatus)) || !record(grant) || !["authorized", "active"].includes(String(grant.status))
      || grant.pendingCalls !== 0 || !Array.isArray(grant.operations) || !record(grant.operations[0]) || grant.operations[0].pendingCalls !== 0
      || permitted.prepare || permitted.authorize || permitted.run)) return null;
    if (["queued", "running", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"].includes(String(value.status)) && (permitted.prepare || permitted.authorize || permitted.run)) return null;
    if (["succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"].includes(String(value.status)) && permitted.resumeRun) return null;
    if (permitted.recoverResult && (value.output !== "image" || value.disposition !== "original_run_recorded"
      || !["failed", "uncertain", "unavailable"].includes(String(value.status)) || !record(original) || original.jobStatus !== "failed"
      || !record(grant) || !["authorized", "active", "completed"].includes(String(grant.status))
      || !record(preflight) || !Array.isArray(preflight.targets) || !record(preflight.targets[0])
      || preflight.targets[0].provider !== "fal" || preflight.targets[0].model !== "ideogram/v4" || preflight.targets[0].route !== "document-image-fal-manual-v1"
      || permitted.prepare || permitted.authorize || permitted.run || permitted.resumeRun)) return null;
    if (value.recovery === "completed" && (value.status !== "succeeded" || value.output !== "image" || value.disposition !== "original_run_recorded"
      || !record(original) || original.jobStatus !== "completed" || original.slotStatus !== "succeeded" || !record(grant) || grant.status !== "completed"
      || !record(preflight) || !Array.isArray(preflight.targets) || !record(preflight.targets[0]) || preflight.targets[0].provider !== "fal"
      || preflight.targets[0].model !== "ideogram/v4" || preflight.targets[0].route !== "document-image-fal-manual-v1")
      || value.recovery === "pending" && !permitted.recoverResult) return null;
    return freeze(structuredClone(value)) as ExperienceNativeState;
  } catch { return null; }
}

type Controls = { origin: string; current(): boolean; request?: typeof fetch; /** Short bounded test seam; production waits follow the original action. */ timeoutMs?: number };
/** Original-intent transport. No browser UUID, automatic POST, rebase or replacement. */
export class ExperienceOutputBindingClient {
  readonly identity: ExperienceBindingIdentity;
  #controls: Controls;
  #state: ExperienceBindingResponse = unavailableBinding("not_loaded");
  #pending = false;
  #abort?: AbortController;
  #epoch = 0;
  constructor(identity: ExperienceBindingIdentity, controls: Controls) { this.identity = Object.freeze({ ...identity }); this.#controls = controls; }
  get state() { return this.#state; }
  get pending() { return this.#pending; }
  dispose() { this.#epoch++; this.#abort?.abort(); this.#state = unavailableBinding("withdrawn"); this.#pending = false; }
  async read() { return this.#request("GET"); }
  async command(action: ExperienceBindingAction, shown: ExperienceNativeState, sceneApproval?: SceneMiniAppCostApproval, audioApproval?: ExperienceAudioCostApproval, model3dApproval?: ExperienceModel3dCostApproval) {
    if (this.#pending || shown !== this.#state || !shown.permitted[action] || !this.#controls.current()) return this.#state;
    // Never manufacture Scene consent from a server preview. It is a separate
    // explicit host action, sent only with Authorize and tied to this exact state.
    if (shown.output === "scene" && action === "authorize") {
      if (!sceneMiniAppCostApprovalMatches(sceneApproval, shown.sceneCostPreview)) return this.#state;
    } else if (sceneApproval !== undefined) return this.#state;
    if (shown.output === "audio" && action === "authorize") {
      if (!audioMiniAppCostApprovalMatches(audioApproval, shown.audioCostPreview)) return this.#state;
    } else if (audioApproval !== undefined) return this.#state;
    if (shown.output === "model3d" && action === "authorize") {
      if (!model3dMiniAppCostApprovalMatches(model3dApproval, shown.model3dCostPreview)) return this.#state;
    } else if (model3dApproval !== undefined) return this.#state;
    const body = action === "prepare" ? { draftHash: this.identity.draftHash, explicitRequirementsConfirmation: true }
      : action === "authorize" && shown.preflight ? { draftHash: this.identity.draftHash, termsDigest: shown.preflight.termsDigest, maximumMicrousd: shown.preflight.maximumMicrousd, explicitAuthorization: true,
        ...(shown.output === "scene" ? {sceneCostConsent: sceneApproval} : {}), ...(shown.output === "audio" ? {audioCostConsent: audioApproval} : {}), ...(shown.output === "model3d" ? {model3dCostConsent: model3dApproval} : {}) }
      : action === "recoverResult" && shown.original ? { draftHash: this.identity.draftHash, grantId: shown.original.grantId, jobId: shown.original.jobId, explicitRecovery: true }
      : (action === "run" || action === "resumeRun") && shown.original ? { draftHash: this.identity.draftHash, grantId: shown.original.grantId, explicitRun: true } : null;
    if (!body) return this.#state;
    return this.#request("POST", action === "resumeRun" ? "run" : action, body);
  }
  async #request(method: "GET" | "POST", action?: ExperienceBindingAction, body?: object) {
    if (this.#pending || !this.#controls.current()) return this.#state;
    const epoch = ++this.#epoch, abort = new AbortController(); this.#abort = abort; this.#pending = true;
    const current = () => epoch === this.#epoch && !abort.signal.aborted && this.#controls.current();
    const path = `/api/experiences/drafts/${encodeURIComponent(this.identity.draftId)}/output${action ? "/" + (action === "recoverResult" ? "recover-result" : action) : ""}`;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const testTimeout = Number.isSafeInteger(this.#controls.timeoutMs) && Number(this.#controls.timeoutMs) > 0 && Number(this.#controls.timeoutMs) <= 20000 ? Number(this.#controls.timeoutMs) : undefined;
    const timeoutMs = testTimeout ?? experienceResponseTimeout(action ? { action, output: this.identity.output } : undefined);
    let rejectStopped: (reason: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
    void stopped.catch(() => {});
    const withdrawn = () => rejectStopped(new Error("withdrawn"));
    abort.signal.addEventListener("abort", withdrawn, { once: true });
    let timer = setTimeout(() => abort.abort(), timeoutMs);
    const limited = <T>(promise: Promise<T>) => Promise.race([promise, stopped]);
    try {
      const url = new URL(path, this.#controls.origin);
      if (url.origin !== this.#controls.origin || !current()) throw new Error("withdrawn");
      const response = await limited((this.#controls.request ?? fetch)(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      if (!current() || response.redirected || response.url !== url.href || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") || !response.body) throw new Error("unavailable");
      // A long foreground execution must not grant a long or renewable body read.
      if (timeoutMs > EXPERIENCE_BODY_TIMEOUT_MS) {
        clearTimeout(timer);
        timer = setTimeout(() => abort.abort(), EXPERIENCE_BODY_TIMEOUT_MS);
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > 262144)) throw new Error("unavailable");
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      for (;;) { const next = await limited(reader.read()); if (!current()) throw new Error("withdrawn"); if (next.done) break;
        if (!(next.value instanceof Uint8Array) || next.value.length === 0 || (length += next.value.length) > 262144) throw new Error("unavailable"); chunks.push(next.value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const decoded = decodeExperienceBinding(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), this.identity);
      if (!current() || !decoded || response.status !== 200 && !(decoded.status === "unavailable" && "originalIntent" in decoded)) throw new Error("unavailable");
      this.#state = decoded;
    } catch { if (epoch === this.#epoch) this.#state = unavailableBinding(method === "POST" ? "submission_unconfirmed" : "original_unavailable"); }
    finally {
      clearTimeout(timer); abort.signal.removeEventListener("abort", withdrawn);
      // A hostile/stalled cancel promise cannot retain the original pending UI.
      try { void reader?.cancel().catch(() => {}); } catch { /* Observed best-effort cleanup only. */ }
      if (epoch === this.#epoch) { this.#pending = false; this.#abort = undefined; }
    }
    return this.#state;
  }
}


/** Result lifetime is separate from the expired permission to buy generation. */
export function experienceResultGrantCurrent(state:ExperienceNativeState,now:number){
  if(!state.original||!state.grant||!Number.isFinite(now)||!["authorized","active","completed"].includes(state.grant.status))return false;
  if(state.output==="storyboard"&&(state.status!=="succeeded"||state.disposition!=="original_run_recorded"||!commandIdentity(state.original.run)
    ||state.original.jobStatus!=="completed"||state.original.slotStatus!=="succeeded"))return false;
  const spendingDeadline=Date.parse(state.original.expiresAt);
  if(!Number.isFinite(spendingDeadline))return false;
  if(spendingDeadline>now)return true;
  return ["image","slides","short_story","scene","storyboard","audio","video","model3d"].includes(state.output)&&state.status==="succeeded"
    &&state.disposition==="original_run_recorded"&&commandIdentity(state.original.run)&&state.original.jobStatus==="completed"
    &&state.original.slotStatus==="succeeded"&&state.original.grantStatus==="completed"&&state.grant.status==="completed"
    &&!state.permitted.prepare&&!state.permitted.authorize&&!state.permitted.run&&!state.permitted.resumeRun&&!state.permitted.recoverResult
    &&Date.parse(state.original.jobExpiresAt)>now;
}
