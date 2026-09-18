import { canonicalJson, compileExperience, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import type { CompiledRelease } from "./contracts.ts";
import { experienceDraftId, isDraftId, isIntentId, registeredExperience } from "./intake.ts";
import { createSponsorImageIntakeRuntime, type SponsorImageIntakeCommand, type SponsorImageIntakeTransport } from "./sponsor-intake-client.ts";

export type SponsorImageTransportConfig = Readonly<{ version: 1; enabled: false }> | Readonly<{
  version: 1; enabled: true; audience: "canonical-principal"; output: "image"; expectedActorUserId?: string;
}>;
export type SponsorImageBootstrapSelector = Readonly<{ draftId: string }> | Readonly<{ intentId: string }>;
export type SponsorImageFetcher = (path: string, init: RequestInit) => Promise<Response>;
export type SponsorImageBootstrap = Readonly<{
  version: 1; kind: "sponsor-image-intake"; actorUserId: string; campaignId: string;
  release: CompiledRelease; generation: "unavailable";
} & ({ mode: "fresh" } | { mode: "retained"; draftId: string; draftHash: string })>;
const base = "/api/experiences/sponsor/image";
const fail = (code = "sponsor_image_transport_invalid"): never => { throw new Error(code); };
const actor = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && ![...value].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
const campaign = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const options = (signal: AbortSignal, body?: unknown): RequestInit => ({ method: body === undefined ? "GET" : "POST",
  credentials: "same-origin", cache: "no-store", redirect: "error", signal,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
function responseAt(response: Response, path: string) {
  if (!(response instanceof Response) || response.redirected || response.type === "opaque" || response.type === "opaqueredirect") fail();
  if (response.url) {
    const url = new URL(response.url);
    if (typeof location === "undefined" || url.origin !== location.origin || url.username || url.password || url.hash
      || `${url.pathname}${url.search}` !== path) fail();
  }
  return response;
}
function selectorFrom(value: unknown): SponsorImageBootstrapSelector | undefined {
  if (value === undefined) return undefined;
  if (jsonIssues(value).length || !record(value)) return fail();
  if (exactKeys(value, ["draftId"]) && typeof value.draftId === "string" && isDraftId(value.draftId)) return Object.freeze({ draftId: value.draftId });
  if (exactKeys(value, ["intentId"]) && isIntentId(value.intentId)) return Object.freeze({ intentId: value.intentId as string });
  return fail();
}
function commandPath(command: SponsorImageIntakeCommand, campaignId: string) {
  if (jsonIssues(command).length || !record(command)) return fail();
  if (command.action === "prepare-sponsored-image-draft") {
    if (!exactKeys(command, ["action", "campaignId", "request"]) || command.campaignId !== campaignId
      || !record(command.request) || !exactKeys(command.request, ["intentId", "experienceId", "releaseHash", "values"])
      || !isIntentId(command.request.intentId) || command.request.experienceId !== "image" || !hash(command.request.releaseHash)
      || !record(command.request.values)) return fail();
    return { path: `${base}/drafts`, body: command };
  }
  if (command.action === "commit-sponsored-image-draft") {
    if (!exactKeys(command, ["action", "campaignId", "draftId", "draftHash"]) || command.campaignId !== campaignId
      || !isDraftId(command.draftId) || !hash(command.draftHash)) return fail();
    return { path: `${base}/drafts/${command.draftId}/commit`, body: command };
  }
  if (command.action === "read-experience-draft") {
    if (exactKeys(command, ["action", "draftId"]) && "draftId" in command && isDraftId(command.draftId)) return { path: `${base}/drafts/${command.draftId}` };
    if (exactKeys(command, ["action", "intentId"]) && "intentId" in command && isIntentId(command.intentId)) return { path: `${base}/drafts?intentId=${command.intentId}` };
  }
  if (command.action === "read-experience-intake-receipt" && exactKeys(command, ["action", "draftId"]) && isDraftId(command.draftId)) return { path: `${base}/drafts/${command.draftId}/receipt` };
  return fail();
}

/** Dormant client composition. Only an explicit host and injected same-origin
 * fetcher can use this adapter; it grants no generation authority. */
export function createSponsorImageTransport(config?: unknown, fetcher?: SponsorImageFetcher) {
  if (config === undefined) return null;
  if (jsonIssues(config).length || !record(config)) return fail();
  if (exactKeys(config, ["version", "enabled"]) && config.version === 1 && config.enabled === false) return null;
  const configKeys = ["version", "enabled", "audience", "output", ...(Object.hasOwn(config, "expectedActorUserId") ? ["expectedActorUserId"] : [])];
  if (!exactKeys(config, configKeys) || config.version !== 1 || config.enabled !== true || config.audience !== "canonical-principal" || config.output !== "image"
    || Object.hasOwn(config, "expectedActorUserId") && !actor(config.expectedActorUserId) || typeof fetcher !== "function") return fail();
  const expectedActor = config.expectedActorUserId as string | undefined, send = fetcher;
  return Object.freeze({ async bootstrap(selector: SponsorImageBootstrapSelector | undefined, supplied: Readonly<{ signal: AbortSignal }>) {
    const selected = selectorFrom(selector);
    if (!record(supplied) || Reflect.ownKeys(supplied).length !== 1 || !exactKeys(supplied, ["signal"])
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(supplied, "signal")!, "value") || !(supplied.signal instanceof AbortSignal)) return fail();
    const signal = supplied.signal;
    let stopped: Error | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, received: Response | undefined;
    const deadline = performance.now() + 30_000;
    let runtime: ReturnType<typeof createSponsorImageIntakeRuntime> | undefined;
    let rejectStop!: (error: Error) => void;
    const stopping = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    // Attach a handler immediately, including for a signal already aborted.
    void stopping.catch(() => {});
    const stop = (code: string) => { if (!stopped) { stopped = new Error(code); rejectStop(stopped); runtime?.dispose(); if (reader) void reader.cancel().catch(() => {}); } };
    const aborted = () => stop("sponsor_image_transport_cancelled");
    signal.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(() => stop("sponsor_image_transport_timeout"), 30_000);
    const check = () => { if (signal.aborted) aborted(); if (performance.now() >= deadline) stop("sponsor_image_transport_timeout"); if (stopped) throw stopped; };
    const wait = async <T>(work: Promise<T>): Promise<T> => {
      const observed = Promise.race([work, stopping]); void observed.catch(() => {});
      check(); const result = await observed; check(); return result;
    };
    try {
      check();
      const suffix = selected ? "draftId" in selected ? `?draftId=${selected.draftId}` : `?intentId=${selected.intentId}` : "";
      const path = `${base}/bootstrap${suffix}`;
      const pending = send(path, options(signal)).then(response => {
        received = response; if (stopped) void response.body?.cancel().catch(() => {}); return response;
      });
      const response = responseAt(await wait(pending), path);
      if (!response.ok || !response.body) return fail("sponsor_image_bootstrap_unavailable");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 524_288)) return fail();
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let source = "", bytes = 0, chunks = 0;
      while (true) {
        const part = await wait(reader.read()); if (part.done) break;
        if (++chunks > 1024 || (bytes += part.value.byteLength) > 524_288) return fail();
        source += decoder.decode(part.value, { stream: true });
      }
      source += decoder.decode();
      let value: unknown; try { value = JSON.parse(source); } catch { return fail(); }
      if (jsonIssues(value).length || !record(value)) return fail();
      const fields = ["version", "kind", "mode", "actorUserId", "campaignId", "release", "generation", ...(selected ? ["draftId", "draftHash"] : [])];
      if (!exactKeys(value, fields) || value.version !== 1 || value.kind !== "sponsor-image-intake" || value.mode !== (selected ? "retained" : "fresh")
        || value.generation !== "unavailable" || !actor(value.actorUserId) || !campaign(value.campaignId)
        || expectedActor !== undefined && value.actorUserId !== expectedActor || !record(value.release)) return fail();
      const release = value.release as unknown as CompiledRelease;
      if (!record(release.definition) || release.definition.id !== "image" || !record(release.output) || release.output.output !== "image"
        || !record(release.interactions) || !record(release.copy)) return fail();
      const current = await wait(registeredExperience("image")); if (!current) return fail();
      if (!selected) { if (canonicalJson(release) !== canonicalJson(current)) return fail(); }
      else {
        if (typeof value.draftId !== "string" || !isDraftId(value.draftId) || !hash(value.draftHash)) return fail();
        const expectedDraft = "draftId" in selected ? selected.draftId : await wait(experienceDraftId(value.actorUserId, selected.intentId));
        if (value.draftId !== expectedDraft) return fail();
        const compiled = await wait(compileExperience(release.definition, { version: "forma-experience-context@2", qualification: "context-authoring",
          interactions: Object.fromEntries(Object.values(release.interactions).map(item => [item.id, item])), outputs: { [release.output.id]: release.output }, copy: release.copy }));
        if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(release)) return fail();
      }
      const bootstrap = freeze(structuredClone(value)) as SponsorImageBootstrap;
      const transport: SponsorImageIntakeTransport = async (command, operation) => {
        if (!operation || !(operation.signal instanceof AbortSignal) || operation.signal.aborted) return fail("sponsor_image_transport_cancelled");
        commandPath(command, bootstrap.campaignId);
        const captured = freeze(structuredClone(command)), mapped = commandPath(captured, bootstrap.campaignId);
        const response = await send(mapped.path, options(operation.signal, mapped.body));
        try {
          if (operation.signal.aborted) return fail("sponsor_image_transport_cancelled");
          return responseAt(response, mapped.path);
        } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      };
      runtime = createSponsorImageIntakeRuntime(current, { version: 1, campaignId: bootstrap.campaignId, actorUserId: bootstrap.actorUserId }, transport);
      if (selected && bootstrap.mode === "retained") {
        await wait(runtime.resume("draftId" in selected ? selected.draftId : selected.intentId, "intentId" in selected));
        const plan = runtime.preparedPlan;
        if (!plan || plan.draftId !== bootstrap.draftId || plan.draftHash !== bootstrap.draftHash
          || canonicalJson(plan.release) !== canonicalJson(bootstrap.release)) return fail();
      }
      check(); return Object.freeze({ bootstrap, runtime });
    } catch (error) { runtime?.dispose(); throw error; }
    finally { clearTimeout(timer); signal.removeEventListener("abort", aborted); if (reader) void reader.cancel().catch(() => {}); else if (received) void received.body?.cancel().catch(() => {}); }
  } });
}
