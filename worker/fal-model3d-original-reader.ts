import { captureModel3dComparisonData, type OutputModel3dPayload } from "../src/model/output-model3d-offer.ts";
import { verifyModel3dPreparedReceipt } from "../src/model/model3d-mini-app-execution.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";
import {
  describeFalModel3dFiles, falModel3dError, falModel3dProviderReceipt, qualifyFalModel3dFile, verifyResponseIdentity,
  MAX_MODEL3D_GENERATED_FILE_BYTES, type Model3dPreparedReceipt, type Model3dGeneratedFile, type Model3dProviderArtifactDescriptor,
} from "./fal-model3d-adapter.ts";
import type { WorkerEnv } from "./runtime.ts";

export const MODEL3D_ORIGINAL_READ_LIMITS = Object.freeze({ timeoutMs: 120000, envelopeBytes: 524288, maximumChunks: 65536, maximumFiles: 64 });
export type Model3dOriginalReadLease = Readonly<{ signal: AbortSignal; deadlineMs: number; assertCurrent(): void }>;
export type Model3dOriginalEnvelope = Readonly<{
  version: "fal-model3d-original-envelope-v1"; phase: "status" | "result"; provider: "fal"; model: string;
  clientRequestId: string; providerRequestId: string; requestDigest: string; requestUrl: string; httpStatus: number;
  headers: ReadonlyArray<readonly [string, string]>; byteLength: number; sha256: string; bodyBase64: string;
}>;
export type Model3dOriginalFileMetadata = Omit<Model3dGeneratedFile, "bytes">;
export type Model3dOriginalReadOptions = {
  deadlineMs: number; signal?: AbortSignal;
  beforeRead(lease: Model3dOriginalReadLease): void | Promise<void>;
  onEnvelope(envelope: Model3dOriginalEnvelope, lease: Model3dOriginalReadLease): void | Promise<void>;
  onProviderSubmission(receipt: PaidProviderSubmission, lease: Model3dOriginalReadLease): void | Promise<void>;
  onResultManifest(files: readonly Model3dProviderArtifactDescriptor[], lease: Model3dOriginalReadLease): void | Promise<void>;
  onGeneratedFile(file: Model3dGeneratedFile, index: number, lease: Model3dOriginalReadLease): void | Promise<void>;
};
const fail = (code: string): never => { throw Error(code); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("model3d_original_response_invalid");
  return value as Record<string, unknown>;
};
const hasError = (body: Record<string, unknown>) => body.error != null && body.error !== "" || Boolean(body.error_type) || Array.isArray(body.detail) && body.detail.length > 0;
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
const cancel = (body: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => undefined); } catch { /* Preserve the original refusal. */ } };
const copy = <T>(value: T): T => captureModel3dComparisonData(value) as T;

/** Internal accepted-original reader, not authorization. Its caller owns the
 * exact job/call/slot/private receipt joins and live SQL assertions. There is no
 * generator invocation, upload, provider POST, retry, cancel request or new ID.
 * All files are delivered once to the required sink; the return retains only
 * metadata. Pending is one status GET, not an internal polling loop. */
export async function readOriginalFalModel3d(env: Pick<WorkerEnv, "FAL_KEY">,
  original: { offer: OutputModel3dPayload; prepared: Model3dPreparedReceipt; submission: PaidProviderSubmission },
  options: Model3dOriginalReadOptions) {
  // Own immutable data and callbacks before the first await; never re-read
  // caller-mutated receipt/settings/identity or replace an absent original.
  const input = copy(original), key = env.FAL_KEY;
  const callbacks = { beforeRead: options.beforeRead, onEnvelope: options.onEnvelope, onProviderSubmission: options.onProviderSubmission,
    onResultManifest: options.onResultManifest, onGeneratedFile: options.onGeneratedFile };
  const parent = options.signal, requestedDeadline = options.deadlineMs;
  if (Object.values(callbacks).some(value => typeof value !== "function")) return fail("model3d_original_hooks_required");
  if (typeof key !== "string" || !key.trim()) return fail("model3d_provider_not_configured");
  if (!Number.isFinite(requestedDeadline) || requestedDeadline <= Date.now()) return fail("model3d_original_read_expired");
  const deadlineMs = Math.min(requestedDeadline, Date.now() + MODEL3D_ORIGINAL_READ_LIMITS.timeoutMs);
  const controller = new AbortController(), signal = controller.signal;
  let active = true;
  const abort = () => controller.abort(parent?.reason ?? Error("model3d_original_read_aborted"));
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(Error("model3d_original_read_timeout")), Math.max(0, deadlineMs - Date.now()));
  let rejectStopped: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = () => reject(signal.reason);
    if (signal.aborted) rejectStopped(); else signal.addEventListener("abort", rejectStopped, { once: true });
  });
  // A caller already aborted at entry must not leave an unhandled promise.
  void stopped.catch(() => undefined);
  const check = () => {
    if (!active) return fail("model3d_original_read_retired");
    signal.throwIfAborted();
    if (Date.now() >= deadlineMs) return fail("model3d_original_read_expired");
  };
  const race = <T>(work: Promise<T>) => Promise.race([work, stopped]);
  const invoke = async (callback: (lease: Model3dOriginalReadLease) => void | Promise<void>) => {
    check(); let observed = false, owned = true;
    const lease = Object.freeze({ signal, deadlineMs, assertCurrent() {
      if (!owned) return fail("model3d_original_hook_retired");
      check(); observed = true;
    } });
    try {
      await race(Promise.resolve().then(() => { check(); return callback(lease); }));
      check(); if (!observed) return fail("model3d_original_hook_unobserved");
    } finally { owned = false; }
  };
  const current = () => invoke(callbacks.beforeRead);
  const effect = async (callback: (lease: Model3dOriginalReadLease) => void | Promise<void>) => {
    await current(); await invoke(callback); await current();
  };
  // Fetch and each body read share the original finite controller. Late
  // responses are canceled and no cancellation promise delays retirement.
  const get = async (url: string, authorized: boolean, maximum: number, advertised?: number | null) => {
    await current(); check();
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
    try {
      response = await race(fetch(url, { method: "GET", redirect: "manual", signal,
        ...(authorized ? { headers: { authorization: `Key ${key}`, accept: "application/json", "x-fal-store-io": "0" } } : {}) })
        .then(value => { if (!active || signal.aborted || Date.now() >= deadlineMs) { cancel(value.body); check(); } return value; }));
      check();
      if (!response) return fail("model3d_original_response_invalid");
      if (response.status >= 300 && response.status < 400) return fail("model3d_original_redirect_refused");
      if (response.redirected || response.status < 200 || response.status > 599) return fail("model3d_original_response_invalid");
      await current(); check();
      const lengthText = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
      const identity = !encoding || encoding.trim().toLowerCase() === "identity";
      if (lengthText !== null && (!/^(0|[1-9]\d*)$/u.test(lengthText) || !Number.isSafeInteger(Number(lengthText)))) return fail("model3d_original_length_invalid");
      const length = lengthText === null || !identity ? null : Number(lengthText);
      if (advertised !== undefined && advertised !== null && (!Number.isSafeInteger(advertised) || advertised < 0)) return fail("model3d_original_length_invalid");
      if (length !== null && length > maximum || advertised != null && advertised > maximum) return fail("model3d_original_response_limit");
      const expected = advertised != null ? advertised : length;
      // Unknown-length files use one bounded destination, never a retained
      // chunk list plus a second complete 64 MiB model allocation.
      const buffer = new Uint8Array(expected ?? maximum);
      let total = 0, count = 0;
      reader = response.body?.getReader();
      if (reader) for (;;) {
        const next = await race(reader.read()); check(); if (next.done) break;
        if (!(next.value instanceof Uint8Array) || next.value.length === 0 || ++count > MODEL3D_ORIGINAL_READ_LIMITS.maximumChunks
          || total + next.value.length > maximum || total + next.value.length > buffer.length) return fail("model3d_original_response_limit");
        buffer.set(next.value, total);
        total += next.value.length;
      }
      if (expected != null && total !== expected || length !== null && total !== length) return fail("model3d_original_length_mismatch");
      const bytes = buffer.subarray(0, total);
      complete = true; await current(); check();
      return { response, bytes };
    } finally {
      if (!complete) {
        if (reader) { try { void reader.cancel().catch(() => undefined); } catch { /* Retain original failure. */ } }
        else if (response) cancel(response.body);
      }
      reader?.releaseLock();
    }
  };
  try {
    check();
    const prepared = await race(verifyModel3dPreparedReceipt(input.offer, input.prepared)); check();
    const submission = input.submission;
    if (!submission || submission.provider !== "fal" || submission.operation !== "model3d" || submission.model !== prepared.model
      || !["accepted", "completed"].includes(submission.status) || !/^forma-model3d-[A-Za-z0-9._:-]{1,150}$/u.test(submission.clientRequestId)
      || typeof submission.providerRequestId !== "string" || submission.requestDigest !== undefined && submission.requestDigest !== prepared.requestDigest
      || submission.unitId !== undefined && submission.unitId !== "model3d:initial"
      || submission.status === "completed" && (submission.costMicrousd !== prepared.estimatedCostMicrousd
        || submission.inputTokens !== 0 || submission.outputTokens !== 0 || submission.totalTokens !== 0)) return fail("model3d_original_receipt_required");
    const receipt = Object.freeze(falModel3dProviderReceipt(prepared.model, submission.providerRequestId));
    const readJson = async (phase: "status" | "result", url: string) => {
      const { response, bytes } = await get(url, true, MODEL3D_ORIGINAL_READ_LIMITS.envelopeBytes);
      const headers = ["content-type", "content-length", "content-encoding", "x-fal-request-id", "date"]
        .flatMap(name => { const value = response.headers.get(name); return value === null ? [] : [[name, value] as const]; });
      if (headers.reduce((sum, entry) => sum + entry[0].length + entry[1].length, 0) > 32768) return fail("model3d_original_headers_limit");
      let binary = ""; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const envelope: Model3dOriginalEnvelope = Object.freeze({ version: "fal-model3d-original-envelope-v1", phase, provider: "fal",
        model: prepared.model, clientRequestId: submission.clientRequestId, providerRequestId: receipt.providerJobId,
        requestDigest: prepared.requestDigest, requestUrl: url, httpStatus: response.status, headers: Object.freeze(headers.map(entry => Object.freeze(entry))),
        byteLength: bytes.length, sha256: await race(hash(bytes)), bodyBase64: btoa(binary) });
      check(); await effect(lease => callbacks.onEnvelope(envelope, lease));
      let body: Record<string, unknown>;
      try { body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
      catch { return fail("model3d_original_response_invalid"); }
      verifyResponseIdentity(body, receipt, prepared.submittedPrompt, response.headers);
      if (!response.ok || hasError(body)) throw falModel3dError(response.ok ? new Response(null, { status: 422, headers: response.headers }) : response,
        body, prepared.submittedPrompt, receipt.providerJobId);
      return body;
    };
    const status = await readJson("status", receipt.providerStatusUrl);
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") return Object.freeze({ status: "pending" as const, receipt });
    if (status.status !== "COMPLETED") return fail("model3d_original_queue_state_invalid");
    const body = await readJson("result", receipt.providerResponseUrl), data = object(body.data ?? body);
    verifyResponseIdentity(data, receipt, prepared.submittedPrompt);
    if (hasError(data)) throw falModel3dError(new Response(null, { status: 422 }), data, prepared.submittedPrompt, receipt.providerJobId);
    const mesh = object(data.model_mesh);
    if (typeof mesh.url !== "string" || !Array.isArray(data.textures) || data.model_meshes !== undefined && !Array.isArray(data.model_meshes)
      || !Number.isInteger(data.seed) || Number(data.seed) < 0 || Number(data.seed) > 65535) return fail("model3d_result_incomplete");
    const completed = Object.freeze({ ...submission, status: "completed" as const, providerRequestId: receipt.providerJobId,
      costMicrousd: prepared.estimatedCostMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    // Preserve known original billability before URL/format/transfer limits can
    // fail. Never turn an accepted request into a free/rejected observation.
    await effect(lease => callbacks.onProviderSubmission(completed, lease));
    const { entries, manifest } = describeFalModel3dFiles(data, prepared, receipt.providerJobId);
    // The complete raw provider envelope above remains available if this
    // finite local transfer refuses an excessive descriptor count.
    if (manifest.length > MODEL3D_ORIGINAL_READ_LIMITS.maximumFiles) return fail("model3d_original_file_count_limit");
    const frozenManifest = copy(manifest);
    await effect(lease => callbacks.onResultManifest(frozenManifest, lease));
    const files: Model3dOriginalFileMetadata[] = [], seen = new Set<string>();
    for (const entry of entries) {
      // The shared descriptor helper validated all URLs before any file GET.
      const url = String(entry.file.url);
      if (seen.has(new URL(url).toString())) continue;
      const descriptor = manifest[files.length]!;
      seen.add(descriptor.providerMediaUrl);
      const { response, bytes } = await get(descriptor.providerMediaUrl, false, MAX_MODEL3D_GENERATED_FILE_BYTES, descriptor.fileSize);
      if (!response.ok) return fail("model3d_original_download_failed");
      const file = await race(qualifyFalModel3dFile(entry.file, receipt, prepared, entry.primary, entry.group, bytes, response.headers));
      check();
      const { bytes: deliveredBytes, ...metadata } = file;
      const capturedMetadata = copy(metadata);
      await effect(lease => callbacks.onGeneratedFile({ ...capturedMetadata, bytes: deliveredBytes }, files.length, lease));
      // The sink owns byte publication. Do not retain another mesh bundle.
      files.push(capturedMetadata);
    }
    await current(); check();
    return Object.freeze({ status: "completed" as const, receipt, preparedReceipt: prepared, submission: completed,
      seed: Number(data.seed), manifest: frozenManifest, files: Object.freeze(files), costPrecision: "published-provider-estimate" as const });
  } finally {
    active = false;
    if (!signal.aborted) controller.abort(Error("model3d_original_read_retired"));
    clearTimeout(timer); parent?.removeEventListener("abort", abort);
    if (rejectStopped) signal.removeEventListener("abort", rejectStopped);
  }
}
