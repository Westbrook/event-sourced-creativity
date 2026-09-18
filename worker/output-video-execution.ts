import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { parseVideoOutputContract, type VideoOutputContract } from "../src/model/output-video-contract.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { definitiveProviderRejection, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { adaptVideoPrompt } from "./video-prompt-adapter.ts";
import type { CreativeVideoOptions, ProviderAttemptPreflight } from "./openai-adapter.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Internal adapter boundary, not a grant or a public route. Admission owns the
 * callbacks below and must recheck original source, consent, expiry and budget. */
export const OUTPUT_VIDEO_TRANSPORT = Object.freeze({
  id: "forma.video.fal-480p-transport@1", model: "bytedance/seedance-2.0/reference-to-video",
  maximumEnvelopeBytes: 262144, maximumResultBytes: MAX_OUTPUT_ASSET_BYTES,
  maximumChunks: 65536, requestTimeoutMs: 30000, executionTimeoutMs: 900000,
  maximumStatusReads: 180,
} as const);
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), b => b.toString(16).padStart(2, "0")).join("");
const textHash = (text: string) => hash(new TextEncoder().encode(text));
export type OutputVideoAttempt = Readonly<{ contract: VideoOutputContract; requestBody: string; mediaMaximumMicrousd: number }>;
/** Local adopted rate, not a live provider invoice or a complete planner quote. */
export function outputVideoMediaPrice() {
  const perSecond = VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd["480p"], maximumMicrousd = 4 * perSecond;
  requireValue(VIDEO_ADAPTER_CONTRACT.model === OUTPUT_VIDEO_TRANSPORT.model && VIDEO_ADAPTER_CONTRACT.adapterVersion === "2.0.0"
    && Number.isSafeInteger(perSecond) && perSecond > 0 && Number.isSafeInteger(maximumMicrousd), "output_video_pricing_unavailable");
  return Object.freeze({ model: OUTPUT_VIDEO_TRANSPORT.model, resolution: "480p" as const, seconds: 4 as const, maximumMicrousd,
    pricingVersion: `${OUTPUT_VIDEO_TRANSPORT.id}:${VIDEO_ADAPTER_CONTRACT.adapterVersion}:${perSecond}` });
}
export type OutputVideoRawEnvelope = Readonly<{
  schemaVersion: 1; phase: "submission" | "status" | "result"; clientRequestId: string; requestDigest: string;
  providerRequestId: string | null; requestUrl: string; httpStatus: number;
  headers: ReadonlyArray<readonly [string, string]>; decodedByteLength: number; decodedBodySha256: string; decodedBodyBase64: string;
}>;
export type OutputVideoHookLease = Readonly<{ signal: AbortSignal; deadlineMs: number; assertCurrent: () => void }>;
export type OutputVideoExecutionOptions = Omit<CreativeVideoOptions, "onPrepared" | "onReceipt"> & {
  onPrepared?: (receipt: Parameters<NonNullable<CreativeVideoOptions["onPrepared"]>>[0], lease: OutputVideoHookLease) => void | Promise<void>;
  onReceipt?: (receipt: Parameters<NonNullable<CreativeVideoOptions["onReceipt"]>>[0], lease: OutputVideoHookLease) => void | Promise<void>;
  /** Persist the bounded original response bytes privately before interpretation.
   * The signal belongs to this execution and is retired on every terminal path. */
  onOutputVideoEnvelope?: (envelope: OutputVideoRawEnvelope, lease: OutputVideoHookLease) => void | Promise<void>;
  outputVideo: unknown;
  onBeforeSourceTransmission?: (lease: OutputVideoHookLease) => void | Promise<void>;
  onBeforeProviderAttempt?: (attempt: ProviderAttemptPreflight, lease: OutputVideoHookLease) => void | Promise<void>;
  onBeforeProviderDispatch?: (id: string, lease: OutputVideoHookLease) => void;
  onProviderSubmission?: (receipt: PaidProviderSubmission, lease: OutputVideoHookLease) => void | Promise<void>;
};
function requireValue(value: unknown, code = "output_video_request_invalid"): asserts value { if (!value) throw new Error(code); }
const responseEnvelopes = new WeakMap<Response, { bytes: Uint8Array; status: number; headers: Array<[string, string]> }>();
function cancel(body: ReadableStream<Uint8Array> | null) { try { void body?.cancel().catch(() => undefined); } catch { /* Retain original failure. */ } }

/** Fetch acquisition, authorization and decoded reads share one finite lease.
 * A late fetch response is retired; cancellation promises never delay exit. */
export async function requestOutputVideoResponse(url: string, init: RequestInit, before: () => void | Promise<void>, maximum = OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes as number,
  beforeDispatch?: () => void): Promise<Response> {
  return requestBoundedResponse(url,init,before,maximum,beforeDispatch,OUTPUT_VIDEO_TRANSPORT.requestTimeoutMs);
}
/** The OpenAI planner is not a FAL status request. Its fixed sub-deadline
 * remains inside the consented overall execution window; parent abort wins.
 * This changes neither request bytes, call/cost caps nor retry behavior. */
export async function requestOutputVideoPlannerResponse(url:string,init:RequestInit,beforeDispatch:()=>void):Promise<Response>{
  requireValue(url==='https://api.openai.com/v1/responses'&&init.method==='POST','output_video_planner_transport_invalid');
  return requestBoundedResponse(url,init,()=>{},524288,beforeDispatch,240000);
}
async function requestBoundedResponse(url:string,init:RequestInit,before:()=>void|Promise<void>,maximum:number,beforeDispatch:(()=>void)|undefined,timeoutMs:number):Promise<Response>{
  requireValue(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= OUTPUT_VIDEO_TRANSPORT.maximumResultBytes);
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(init.signal?.reason ?? new Error("output_video_aborted"));
  if (init.signal?.aborted) abort(); else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("output_video_request_timeout")), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { rejectAbort = () => reject(signal.reason); if (signal.aborted) rejectAbort(); else signal.addEventListener("abort", rejectAbort, { once: true }); });
  const race = <T>(work: Promise<T>) => Promise.race([work, stopped]);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    signal.throwIfAborted(); await race(Promise.resolve().then(before)); signal.throwIfAborted();
    // Synchronous final gate; no await or callback between it and the fetch.
    const gateResult: unknown = beforeDispatch?.();
    if (gateResult !== undefined) { void Promise.resolve(gateResult).catch(() => undefined); throw new Error("output_video_dispatch_gate_invalid"); }
    signal.throwIfAborted();
    // workerd supports manual/follow, not error. Never follow a redirect with
    // provider credentials or source bytes; reject every 3xx before reading.
    response = await race(fetch(url, { ...init, redirect: "manual", signal }).then(result => {
      if (signal.aborted) { cancel(result.body); throw signal.reason; } return result;
    }));
    requireValue(response);
    requireValue(response.status < 300 || response.status >= 400, "output_video_redirect_refused");
    requireValue(!response.redirected && response.status >= 200 && response.status <= 599, "output_video_response_invalid");
    const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding"), identity = !encoding || encoding.trim().toLowerCase() === "identity";
    requireValue(length === null || /^(0|[1-9]\d*)$/u.test(length) && Number.isSafeInteger(Number(length)) && (!identity || Number(length) <= maximum), "output_video_response_limit");
    const chunks: Uint8Array[] = []; let bytes = 0, count = 0;
    if (response.body) {
      reader = response.body.getReader();
      for (;;) {
        const next = await race(reader.read()); if (next.done) break;
        requireValue(next.value instanceof Uint8Array && next.value.byteLength > 0 && ++count <= OUTPUT_VIDEO_TRANSPORT.maximumChunks
          && bytes + next.value.byteLength <= maximum, "output_video_response_limit");
        // Copy: a hostile/misbehaving stream must not mutate an earlier chunk.
        chunks.push(new Uint8Array(next.value)); bytes += next.value.byteLength;
      }
    }
    requireValue(!identity || length === null || Number(length) === bytes, "output_video_response_length_mismatch");
    const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    complete = true;
    const headers = new Headers(response.headers); headers.delete("content-encoding"); headers.set("content-length", String(bytes));
    const bounded = new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers });
    if (maximum <= OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes) {
      // Explicitly a selected-header receipt, not a claim to preserve the wire.
      const retainedHeaders: Array<[string, string]> = ["content-type", "content-length", "content-encoding", "x-fal-request-id", "date"]
        .flatMap(name => { const value = response!.headers.get(name); return value === null ? [] : [[name, value] as [string, string]]; });
      requireValue(retainedHeaders.reduce((sum, entry) => sum + entry[0].length + entry[1].length, 0) <= 32768, "output_video_response_headers_limit");
      responseEnvelopes.set(bounded, { bytes: body, status: response.status, headers: retainedHeaders });
    }
    return bounded;
  } finally {
    if (!signal.aborted) controller.abort(new Error("output_video_transport_retired"));
    clearTimeout(timer); init.signal?.removeEventListener("abort", abort); if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
    if (!complete) { if (reader) { try { void reader.cancel().catch(() => undefined); } catch { /* No secondary error. */ } } else if (response) cancel(response.body); }
    reader?.releaseLock();
  }
}
/** A callback must observe its current lease. Owners must call assertCurrent
 * after async work and before a write, and include source/expiry SQL guards in
 * that write. A lease cannot undo an external write already committed. */
function hookLease(parent: AbortSignal) {
  const controller = new AbortController(); let active = true, observed = false;
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true });
  const deadlineMs = Date.now() + OUTPUT_VIDEO_TRANSPORT.requestTimeoutMs;
  const lease: OutputVideoHookLease = Object.freeze({ signal: controller.signal, deadlineMs, assertCurrent() {
    requireValue(active, "output_video_hook_retired"); requireValue(Date.now() < deadlineMs, "output_video_hook_timeout"); controller.signal.throwIfAborted(); observed = true;
  } });
  return { lease, check() { requireValue(observed, "output_video_hook_lease_unobserved"); lease.assertCurrent(); }, retire() {
    active = false; controller.abort(new Error("output_video_hook_retired")); parent.removeEventListener("abort", abort);
  } };
}
async function runHook<T>(controller: AbortController, hook: (lease: OutputVideoHookLease) => T | Promise<T>): Promise<T> {
  const signal = controller.signal; signal.throwIfAborted(); const current = hookLease(signal);
  let rejectStop: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => { rejectStop = () => reject(signal.reason); signal.addEventListener("abort", rejectStop, { once: true }); });
  const timer = setTimeout(() => controller.abort(new Error("output_video_hook_timeout")), OUTPUT_VIDEO_TRANSPORT.requestTimeoutMs);
  try { const value = await Promise.race([Promise.resolve().then(() => hook(current.lease)), stop]); current.check(); return value; }
  finally { current.retire(); clearTimeout(timer); if (rejectStop) signal.removeEventListener("abort", rejectStop); }
}
/** A native callback keeps the same observable, nonrenewable30-second lease. */
export async function withOutputVideoHook<T>(signal: AbortSignal | undefined, hook: (lease: OutputVideoHookLease) => T | Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  try { return await runHook(controller, hook); }
  finally { controller.abort(new Error("output_video_hook_retired")); signal?.removeEventListener("abort", abort); }
}
function mediaUrl(value: unknown) {
  requireValue(typeof value === "string" && value.length <= 4096, "output_video_media_url_invalid");
  const url = new URL(value);
  requireValue(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
    && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")), "output_video_media_url_invalid");
  return url.href;
}
async function envelope(response: Response) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
  const value: unknown = JSON.parse(text);
  requireValue(value && typeof value === "object" && !Array.isArray(value), "output_video_envelope_invalid");
  return value as Record<string, unknown>;
}
/** One exact still, snapshotted before async work; no original provider URL reuse. */
export async function captureOutputVideoSource(value: unknown, options: Pick<CreativeVideoOptions, "seconds" | "resolution" | "audioMode" | "generateAudio" | "size" | "providerModel" | "references" | "audioReferences" | "endUserId" | "referencePromptProfile">) {
  const contract = parseVideoOutputContract(value);
  requireValue(contract && options.seconds === 4 && options.resolution === "480p" && options.audioMode === "silent" && options.generateAudio === false
    && options.size === contract.frameSize && options.providerModel === OUTPUT_VIDEO_TRANSPORT.model
    && options.references?.length === 1 && (options.audioReferences?.length ?? 0) === 0
    && typeof options.endUserId === "string" && options.endUserId.length > 0 && options.endUserId.length <= 240
    && !["providerJobId", "providerStatusUrl", "providerResponseUrl", "providerCancelUrl", "retainedReceipt", "productionContinuity"].some(key => Object.hasOwn(options, key))
    && (options.referencePromptProfile === undefined || options.referencePromptProfile === "positive-only"));
  const original = options.references[0]!;
  requireValue(original.bytes instanceof Uint8Array && Object.getPrototypeOf(original.bytes) === Uint8Array.prototype);
  const prototype = Object.getPrototypeOf(Uint8Array.prototype);
  const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(original.bytes);
  const length = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(original.bytes);
  requireValue(buffer instanceof ArrayBuffer && length > 0 && length <= VIDEO_ADAPTER_CONTRACT.maxReferenceBytes);
  requireValue(original.blockId === contract.reference.sourceBlockId && original.referenceId === contract.reference.referenceId
    && ["image/png", "image/jpeg", "image/webp"].includes(original.mimeType)
    && original.mode === "inspiration" && !original.sourceArtifactId && !original.sourceArtifactItemId && !original.sourceArtifactKind
    && !original.sequence && !original.contextGroups?.length);
  const reference = { ...original, bytes: new Uint8Array(original.bytes), provider: null, providerModel: null, providerRequestId: null, providerMediaUrl: null, contextGroups: [] };
  requireValue(await hash(reference.bytes) === contract.reference.sha256, "output_video_reference_hash_mismatch");
  return { contract, reference };
}
/** Exact paid wire and captured policy. This is data; native admission is authority. */
export async function captureOutputVideoAttempt(contractValue: unknown, body: string, clientRequestId: string) {
  const contract = parseVideoOutputContract(contractValue);
  requireValue(contract && typeof body === "string" && new TextEncoder().encode(body).byteLength <= 131072 && /^forma-video-[A-Za-z0-9._:-]{1,150}$/u.test(clientRequestId));
  const wire = JSON.parse(body) as Record<string, unknown>;
  requireValue(wire && typeof wire === "object" && !Array.isArray(wire) && typeof wire.prompt === "string" && wire.prompt === wire.prompt.trim()
    && wire.prompt.length > 0 && wire.prompt.length <= VIDEO_ADAPTER_CONTRACT.maxPromptCharacters && Array.isArray(wire.image_urls) && wire.image_urls.length === 1
    && typeof wire.end_user_id === "string" && /^[a-f0-9]{64}$/u.test(wire.end_user_id));
  const exact = { prompt: wire.prompt, aspect_ratio: contract.frameSize === "1280x720" ? "16:9" : "9:16", duration: 4, resolution: "480p", generate_audio: false,
    end_user_id: wire.end_user_id, image_urls: [mediaUrl(wire.image_urls[0])] };
  requireValue(canonicalJson(wire) === canonicalJson(exact));
  const price = outputVideoMediaPrice();
  return freeze({ model: OUTPUT_VIDEO_TRANSPORT.model, pricingVersion: price.pricingVersion, maximumInputTokens: 0, maximumOutputTokens: 0, clientRequestId,
    logicalCallKey: "video:initial", requestDigest: await textHash(body), video: { contract, requestBody: body, mediaMaximumMicrousd: price.maximumMicrousd } });
}
export async function generateOutputVideo(env: WorkerEnv, prompt: string, options: OutputVideoExecutionOptions) {
  options = { ...options, snapshot: structuredClone(options.snapshot ?? {}), plan: options.plan ? structuredClone(options.plan) : undefined };
  // Never fall through to generic Video on malformed native input or absent hooks.
  requireValue([options.onBeforeSourceTransmission, options.onBeforeProviderAttempt, options.onBeforeProviderDispatch,
    options.onProviderSubmission, options.onPrepared, options.onReceipt, options.onOutputVideoEnvelope].every(hook => typeof hook === "function"), "output_video_hooks_required");
  const captured = await captureOutputVideoSource(options.outputVideo, options);
  requireValue(typeof env.FAL_KEY === "string" && env.FAL_KEY.length > 0 && (env.FORMA_VIDEO_PROVIDER ?? "fal") === "fal", "output_video_provider_unavailable");
  requireValue(VIDEO_ADAPTER_CONTRACT.model === OUTPUT_VIDEO_TRANSPORT.model && VIDEO_ADAPTER_CONTRACT.adapterVersion === "2.0.0", "output_video_adapter_changed");
  requireValue(typeof prompt === "string" && prompt.trim().length > 0 && prompt.length <= 20000);
  const { contract, reference } = captured;
  const adaptation = adaptVideoPrompt(prompt.trim(), { snapshot: structuredClone(options.snapshot ?? {}), plan: options.plan ? structuredClone(options.plan) : undefined,
    references: [reference], seconds: 4, size: contract.frameSize, model: OUTPUT_VIDEO_TRANSPORT.model, promptProfile: "positive-only", audioMode: "silent", generateAudio: false, providedSoundtrack: false });
  const submittedPrompt = adaptation.prompt;
  const controller = new AbortController(), signal = controller.signal, start = Date.now();
  const abort = () => controller.abort(options.signal?.reason ?? new Error("output_video_aborted"));
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("output_video_execution_timeout")), OUTPUT_VIDEO_TRANSPORT.executionTimeoutMs);
  const source = () => runHook(controller, lease => options.onBeforeSourceTransmission!(lease));
  const headers = { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
  let submission: PaidProviderSubmission | undefined, providerJobId = "";
  try {
    // Protocol follows installed @fal-ai/client storage v3. No SDK retries,
    // multipart, alternate origin, original asset probe or lifetime extension.
    const initialized = await requestOutputVideoResponse("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
      method: "POST", headers: { ...headers, "X-Fal-Object-Lifecycle": JSON.stringify({ expiration_duration_seconds: 86400 }) }, signal,
      body: JSON.stringify({ content_type: reference.mimeType, file_name: `forma-${contract.reference.sha256}.${reference.mimeType === "image/jpeg" ? "jpg" : reference.mimeType.slice(6)}` }),
    }, source);
    requireValue(initialized.ok, "output_video_reference_staging_failed"); const upload = await envelope(initialized);
    const uploadUrl = mediaUrl(upload.upload_url), imageUrl = mediaUrl(upload.file_url);
    const staged = await requestOutputVideoResponse(uploadUrl, { method: "PUT", headers: { "Content-Type": reference.mimeType }, signal,
      body: new Blob([new Uint8Array(reference.bytes).buffer], { type: reference.mimeType }) }, source);
    requireValue(staged.ok, "output_video_reference_transfer_failed");
    const body = JSON.stringify({ prompt: submittedPrompt, aspect_ratio: contract.frameSize === "1280x720" ? "16:9" : "9:16", duration: 4, resolution: "480p", generate_audio: false,
      end_user_id: await textHash(options.endUserId!), image_urls: [imageUrl] });
    const attempt = await captureOutputVideoAttempt(contract, body, `forma-video-${crypto.randomUUID()}`);
    await runHook(controller, lease => options.onBeforeProviderAttempt!(attempt, lease));
    const referenceInputs = [{ index: 1, block_id: reference.blockId, reference_id: reference.referenceId, label: reference.label, mode: reference.mode,
      mime_type: reference.mimeType, byte_length: reference.bytes.byteLength, sha256: contract.reference.sha256, pixels_submitted: true,
      provider_reference_mode: "pixel", transport: "fal-storage-upload", original_provider_asset_reused: false }];
    const providerParameters = { aspect_ratio: contract.frameSize === "1280x720" ? "16:9" : "9:16", duration: 4, resolution: "480p", generate_audio: false,
      audio_mode: "silent", native_audio_mode: "silent", soundtrack_mode: "none", provider_pixel_count: 1, reference_requested_count: 1,
      adapter_id: VIDEO_ADAPTER_CONTRACT.adapterId, adapter_version: VIDEO_ADAPTER_CONTRACT.adapterVersion, output_video_contract: contract,
      output_video_transport: OUTPUT_VIDEO_TRANSPORT.id, request_digest: attempt.requestDigest };
    await runHook(controller, lease => options.onPrepared!({ provider: "fal", model: OUTPUT_VIDEO_TRANSPORT.model, submittedPrompt, parameters: structuredClone(providerParameters), referenceInputs: structuredClone(referenceInputs), usedReferencePixels: true, adaptation: structuredClone(adaptation) }, lease));
    submission = { clientRequestId: attempt.clientRequestId, provider: "fal", operation: "video", model: OUTPUT_VIDEO_TRANSPORT.model, status: "pending", unitId: "video:initial", requestDigest: attempt.requestDigest };
    await runHook(controller, lease => options.onProviderSubmission!({ ...submission! }, lease));
    const retainEnvelope = async (response: Response, phase: OutputVideoRawEnvelope["phase"], requestUrl: string) => {
      const original = responseEnvelopes.get(response); requireValue(original, "output_video_response_custody_unavailable");
      // Immutable base64 holds even non-UTF8/malformed JSON. Decode only after
      // private persistence succeeds; never substitute synthesized queue URLs.
      let binary = ""; for (let offset = 0; offset < original.bytes.length; offset += 32768)
        binary += String.fromCharCode(...original.bytes.subarray(offset, offset + 32768));
      const record = freeze({ schemaVersion: 1 as const, phase, clientRequestId: attempt.clientRequestId, requestDigest: attempt.requestDigest,
        providerRequestId: providerJobId || null, requestUrl, httpStatus: original.status, headers: original.headers,
        decodedByteLength: original.bytes.byteLength, decodedBodySha256: await hash(original.bytes), decodedBodyBase64: btoa(binary) });
      await runHook(controller, lease => options.onOutputVideoEnvelope!(record, lease));
      responseEnvelopes.delete(response);
    };
    const created = await requestOutputVideoResponse(`https://queue.fal.run/${OUTPUT_VIDEO_TRANSPORT.model}`, { method: "POST", headers, body, signal }, source,
      OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes, () => {
        const current = hookLease(signal);
        try {
          const value: unknown = options.onBeforeProviderDispatch!(attempt.clientRequestId, current.lease);
          if (value !== undefined) { void Promise.resolve(value).catch(() => undefined); throw new Error("output_video_dispatch_gate_invalid"); }
          current.check();
        } finally { current.retire(); }
      });
    // An unreadable/error envelope is not proof of rejection or zero cost.
    await retainEnvelope(created, "submission", `https://queue.fal.run/${OUTPUT_VIDEO_TRANSPORT.model}`);
    const accepted = await envelope(created);
    if (!created.ok) {
      if (definitiveProviderRejection(created.status)) await runHook(controller, lease => options.onProviderSubmission!({ ...submission!, status: "rejected", costMicrousd: 0 }, lease));
      throw new Error("output_video_provider_submission_failed");
    }
    requireValue(typeof accepted.request_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(accepted.request_id), "output_video_provider_receipt_invalid");
    requireValue(created.headers.get("x-fal-request-id") === null || created.headers.get("x-fal-request-id") === accepted.request_id, "output_video_provider_receipt_mismatch");
    providerJobId = accepted.request_id;
    submission = { ...submission, status: "accepted", providerRequestId: providerJobId }; await runHook(controller, lease => options.onProviderSubmission!({ ...submission! }, lease));
    const base = `https://queue.fal.run/bytedance/seedance-2.0/requests/${providerJobId}`;
    const receipt = { providerJobId, provider: "fal", model: OUTPUT_VIDEO_TRANSPORT.model, providerStatusUrl: `${base}/status`, providerResponseUrl: base, providerCancelUrl: `${base}/cancel` };
    // Ignore provider-supplied route changes; pin GETs to this exact job.
    await runHook(controller, lease => options.onReceipt!({ ...receipt }, lease));
    let completed = false;
    for (let read = 0; read < OUTPUT_VIDEO_TRANSPORT.maximumStatusReads; read++) {
      const response = await requestOutputVideoResponse(receipt.providerStatusUrl, { method: "GET", headers, signal }, source);
      await retainEnvelope(response, "status", receipt.providerStatusUrl);
      requireValue(response.headers.get("x-fal-request-id") === null || response.headers.get("x-fal-request-id") === providerJobId, "output_video_provider_receipt_mismatch");
      requireValue(response.ok, "output_video_status_unavailable"); const status = await envelope(response);
      requireValue(status.request_id === undefined || status.request_id === providerJobId, "output_video_provider_receipt_mismatch");
      if (status.status === "COMPLETED") { completed = true; break; }
      requireValue(status.status === "IN_QUEUE" || status.status === "IN_PROGRESS", "output_video_status_unavailable");
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(wait); signal.removeEventListener("abort", stop); reject(signal.reason); };
        const wait = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, 5000);
        if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
      });
    }
    requireValue(completed, "output_video_status_limit");
    const response = await requestOutputVideoResponse(receipt.providerResponseUrl, { method: "GET", headers, signal }, source);
    await retainEnvelope(response, "result", receipt.providerResponseUrl);
    requireValue(response.headers.get("x-fal-request-id") === null || response.headers.get("x-fal-request-id") === providerJobId, "output_video_provider_receipt_mismatch");
    requireValue(response.ok, "output_video_result_unavailable"); const result = await envelope(response);
    requireValue(result.request_id === undefined || result.request_id === providerJobId, "output_video_provider_receipt_mismatch");
    requireValue(result.data === undefined || result.data && typeof result.data === "object" && !Array.isArray(result.data), "output_video_result_invalid");
    const data = result.data as Record<string, unknown> | undefined;
    requireValue(data?.request_id === undefined || data.request_id === providerJobId, "output_video_provider_receipt_mismatch");
    requireValue(!(result.video !== undefined && data?.video !== undefined), "output_video_result_ambiguous");
    const video = (result.video ?? data?.video) as Record<string, unknown> | undefined;
    requireValue(video && typeof video === "object" && !Array.isArray(video), "output_video_result_invalid");
    requireValue(video.request_id === undefined || video.request_id === providerJobId, "output_video_provider_receipt_mismatch");
    const media = await requestOutputVideoResponse(mediaUrl(video.url), { method: "GET", signal }, source, OUTPUT_VIDEO_TRANSPORT.maximumResultBytes);
    requireValue(media.ok && media.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "video/mp4"
      && (video.content_type === undefined || video.content_type === "video/mp4"), "output_video_result_invalid");
    const bytes = new Uint8Array(await media.arrayBuffer()); requireValue(bytes.length > 0, "output_video_result_invalid");
    requireValue(video.file_size === undefined || Number.isSafeInteger(video.file_size) && video.file_size === bytes.length, "output_video_result_length_mismatch");
    const costMicrousd = attempt.video.mediaMaximumMicrousd;
    await runHook(controller, lease => options.onProviderSubmission!({ ...submission!, status: "completed", costMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, lease));
    // Requested seconds/frame, not measured facts or requirement fulfillment.
    return { ...receipt, bytes, mimeType: "video/mp4", seconds: 4 as const, size: contract.frameSize, latencyMs: Date.now() - start, costMicrousd,
      submittedPrompt, providerParameters, referenceInputs, usedReferencePixels: true, adaptation };
  } finally { controller.abort(new Error("output_video_execution_retired")); clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

/** Read one original accepted request. This function has no upload, submission,
 * planner, retry or cancellation path. The required callbacks establish live
 * server custody; the supplied identities are only data. */
export async function readOriginalOutputVideo(env:WorkerEnv,original:{contract:unknown;requestBody:string;clientRequestId:string;requestDigest:string;providerRequestId:string},options:{signal?:AbortSignal;
 onBeforeRead:(lease:OutputVideoHookLease)=>Promise<void>;
 onEnvelope:(envelope:OutputVideoRawEnvelope,lease:OutputVideoHookLease)=>Promise<void>}){
 requireValue(typeof options.onBeforeRead==="function"&&typeof options.onEnvelope==="function","output_video_recovery_hooks_required");
 const attempt=await captureOutputVideoAttempt(original.contract,original.requestBody,original.clientRequestId);
 requireValue(attempt.requestDigest===original.requestDigest&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(original.providerRequestId)
  &&!["pending","submitted","unknown"].includes(original.providerRequestId.toLowerCase()),"output_video_recovery_identity_invalid");
 requireValue(typeof env.FAL_KEY==="string"&&env.FAL_KEY.length>0&&(env.FORMA_VIDEO_PROVIDER??"fal")==="fal","output_video_provider_unavailable");
 const providerRequestId=original.providerRequestId,base=`https://queue.fal.run/bytedance/seedance-2.0/requests/${providerRequestId}`;
 const controller=new AbortController(),abort=()=>controller.abort(options.signal?.reason??Error("output_video_recovery_interrupted"));
 if(options.signal?.aborted)abort();else options.signal?.addEventListener("abort",abort,{once:true});
 const timer=setTimeout(()=>controller.abort(Error("output_video_recovery_timeout")),120000),signal=controller.signal;
 const before=()=>runHook(controller,lease=>options.onBeforeRead(lease)),headers={Authorization:`Key ${env.FAL_KEY}`,Accept:"application/json"};
 const retained=async(response:Response,phase:"status"|"result",requestUrl:string)=>{
  const raw=responseEnvelopes.get(response);requireValue(raw,"output_video_response_custody_unavailable");let binary="";
  for(let offset=0;offset<raw.bytes.length;offset+=32768)binary+=String.fromCharCode(...raw.bytes.subarray(offset,offset+32768));
  const saved=freeze({schemaVersion:1 as const,phase,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,providerRequestId,requestUrl,httpStatus:raw.status,headers:raw.headers,
   decodedByteLength:raw.bytes.length,decodedBodySha256:await hash(raw.bytes),decodedBodyBase64:btoa(binary)});
  await runHook(controller,lease=>options.onEnvelope(saved,lease));responseEnvelopes.delete(response);
 };
 try{
  const statusResponse=await requestOutputVideoResponse(base+"/status",{method:"GET",headers,signal},before);
  await retained(statusResponse,"status",base+"/status");
  requireValue(statusResponse.headers.get("x-fal-request-id")===null||statusResponse.headers.get("x-fal-request-id")===providerRequestId,"output_video_provider_receipt_mismatch");
  requireValue(statusResponse.ok,"output_video_status_unavailable");const status=await envelope(statusResponse);
  requireValue(status.request_id===undefined||status.request_id===providerRequestId,"output_video_provider_receipt_mismatch");
  if(status.status==="IN_QUEUE"||status.status==="IN_PROGRESS")return{status:"pending" as const,providerRequestId};
  requireValue(status.status==="COMPLETED","output_video_status_unavailable");
  const response=await requestOutputVideoResponse(base,{method:"GET",headers,signal},before);await retained(response,"result",base);
  requireValue(response.headers.get("x-fal-request-id")===null||response.headers.get("x-fal-request-id")===providerRequestId,"output_video_provider_receipt_mismatch");
  requireValue(response.ok,"output_video_result_unavailable");const result=await envelope(response);
  requireValue(result.request_id===undefined||result.request_id===providerRequestId,"output_video_provider_receipt_mismatch");
  requireValue(result.data===undefined||result.data&&typeof result.data==="object"&&!Array.isArray(result.data),"output_video_result_invalid");
  const data=result.data as Record<string,unknown>|undefined;
  requireValue(data?.request_id===undefined||data.request_id===providerRequestId,"output_video_provider_receipt_mismatch");
  requireValue(!(result.video!==undefined&&data?.video!==undefined),"output_video_result_ambiguous");
  const video=(result.video??data?.video) as Record<string,unknown>|undefined;
  requireValue(video&&typeof video==="object"&&!Array.isArray(video),"output_video_result_invalid");
  requireValue(video.request_id===undefined||video.request_id===providerRequestId,"output_video_provider_receipt_mismatch");
  const responseMedia=await requestOutputVideoResponse(mediaUrl(video.url),{method:"GET",signal},before,OUTPUT_VIDEO_TRANSPORT.maximumResultBytes);
  requireValue(responseMedia.ok&&responseMedia.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()==="video/mp4"
   &&(video.content_type===undefined||video.content_type==="video/mp4"),"output_video_result_invalid");
  const bytes=new Uint8Array(await responseMedia.arrayBuffer());requireValue(bytes.length>0&&(video.file_size===undefined||Number.isSafeInteger(video.file_size)&&video.file_size===bytes.length),"output_video_result_length_mismatch");
  await before();return{status:"completed" as const,providerRequestId,bytes,mimeType:"video/mp4" as const,costMicrousd:attempt.video.mediaMaximumMicrousd,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,model:attempt.model};
 }finally{controller.abort(Error("output_video_recovery_retired"));clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
}
