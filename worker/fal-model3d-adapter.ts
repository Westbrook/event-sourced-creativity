import { ApiError, createFalClient } from "@fal-ai/client";
import {
  isModel3dFormat, isRodinModel, MODEL3D_FORMAT_MIME_TYPES, MODEL3D_PRIVATE_TRANSFER_MAX_BYTES, Model3dInputError,
  RODIN_ADAPTER_VERSION, RODIN_IMAGE_MODEL, RODIN_PROMPT_MAX_CHARS,
  serializeRodinInput, validateModel3dRequest, type Model3dFormat, type Model3dSettings, type RodinModelId,
} from "../src/model/model3d.ts";
import { definitiveProviderRejection, type PaidProviderSubmission, type PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";
import { classifyProviderFailure, ProviderRequestError, providerRetryAfterMs, type ProviderFailureDetail } from "./provider-errors.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import type { WorkerEnv } from "./runtime.ts";

export type Model3dImageReference = { bytes: Uint8Array; mimeType: string; blockId?: string; referenceId?: string; label?: string };
export type Model3dReferenceReceipt = {
  index: number; blockId: string | null; referenceId: string | null; label: string | null;
  mimeType: string; byteLength: number; sha256: string; transport: "fal-storage-upload";
};
export type Model3dPreparedReceipt = {
  provider: "fal"; model: RodinModelId; adapterVersion: string; submittedPrompt: string;
  settings: Model3dSettings; parameters: Record<string, unknown>; acceptedFields: string[];
  referenceInputs: Model3dReferenceReceipt[]; usedReferencePixels: boolean; estimatedCostMicrousd: number; requestDigest: string;
};
export type FalModel3dProviderReceipt = {
  provider: "fal"; model: RodinModelId; providerJobId: string;
  providerStatusUrl: string; providerResponseUrl: string; providerCancelUrl: string;
};
export type Model3dGeneratedFile = {
  bytes: Uint8Array; mimeType: string; fileName: string; fileSize: number; format: Model3dFormat | null;
  providerMediaUrl: string; sha256: string; role: "mesh" | "texture" | "preview";
};
export type Model3dProviderArtifactDescriptor = {
  providerMediaUrl: string; mimeType: string; fileName: string; fileSize: number | null;
  format: Model3dFormat | null; role: Model3dGeneratedFile["role"];
};
/** Forma's bounded private-transfer policy; this is not a published Rodin limit. */
export const MAX_MODEL3D_GENERATED_FILE_BYTES = MODEL3D_PRIVATE_TRANSFER_MAX_BYTES;
export type FalModel3dOptions = {
  settings?: unknown; references?: Model3dImageReference[]; estimatedCostMicrousd?: number;
  providerJobId?: string; providerModel?: string; providerStatusUrl?: string; providerResponseUrl?: string; providerCancelUrl?: string;
  retainedReceipt?: Model3dPreparedReceipt; retainedSubmission?: PaidProviderSubmission;
  signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number;
  onStage?: (stage: string, message: string) => void | Promise<void>;
  onPrepared?: (receipt: Model3dPreparedReceipt) => void | Promise<void>;
  onReceipt?: (receipt: FalModel3dProviderReceipt) => void | Promise<void>;
  onProviderSubmission?: PaidProviderSubmissionObserver;
  onBeforeSourceTransmission?: () => void | Promise<void>;
  onBeforeProviderAttempt?: (attempt: ProviderAttemptPreflight) => void | Promise<void>;
  onBeforeProviderDispatch?: (clientRequestId: string) => void;
  /** Persist each file promptly to avoid retaining a complete multi-mesh bundle in Worker memory. */
  onGeneratedFile?: (file: Model3dGeneratedFile, index: number) => void | Promise<void>;
  /** Retain original provider descriptors before a local transfer or preview limitation can fail. */
  onResultManifest?: (files: Model3dProviderArtifactDescriptor[]) => void | Promise<void>;
  /** Requires onGeneratedFile; metadata remains available after bytes have been persisted. */
  retainFileBytes?: boolean;
};

type QueueState = { request_id?: string; status?: string; status_url?: string; response_url?: string; cancel_url?: string; error?: unknown; error_type?: string; queue_position?: number; logs?: Array<{ message?: string }> };
type ProviderFile = { url?: unknown; content_type?: unknown; file_name?: unknown; file_size?: unknown };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const falHeaders = (env: Pick<WorkerEnv, "FAL_KEY">) => ({ authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json", "x-fal-store-io": "0" });
const requestError = (code: string, message: string, prompt: string, options: Partial<ProviderFailureDetail> = {}) => new ProviderRequestError({
  code, message, category: "provider", scope: "request", action: "edit_request", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400, ...options,
}, prompt);
const sha256 = async (bytes: Uint8Array) => {
  const owned = bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : new Uint8Array(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", owned)), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  return item;
});
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError"); };
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("The operation was aborted.", "AbortError")); return; }
  const onAbort = () => { clearTimeout(timer); reject(new DOMException("The operation was aborted.", "AbortError")); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

/** Exact request-path binding prevents credentials being sent to a supplied foreign queue URL. */
export function falModel3dProviderReceipt(model: string, requestId: string, urls: Pick<FalModel3dOptions, "providerStatusUrl" | "providerResponseUrl" | "providerCancelUrl"> = {}): FalModel3dProviderReceipt {
  if (!isRodinModel(model) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(requestId) || ["pending", "submitted", "unknown"].includes(requestId.toLowerCase())) {
    throw requestError("model3d_provider_receipt_invalid", "The original Rodin model and a valid provider request ID are required to recover this generation. A replacement request was not submitted.", "", { httpStatus: 409, action: "contact_support" });
  }
  const base = `https://queue.fal.run/fal-ai/hyper3d/requests/${encodeURIComponent(requestId)}`;
  const legacy = `/${model}/requests/${encodeURIComponent(requestId)}`;
  const verified = (raw: string | undefined, suffix: string) => {
    if (!raw) return `${base}${suffix}`;
    let url: URL;
    try { url = new URL(raw); } catch { throw requestError("model3d_queue_url_untrusted", "The saved provider queue URL is invalid. Recover the original request using its ID.", "", { requestId, httpStatus: 409, action: "contact_support" }); }
    const paths = [new URL(base).pathname + suffix, legacy + suffix, ...(suffix === "" ? [new URL(base).pathname + "/response", legacy + "/response"] : [])];
    if (url.origin !== "https://queue.fal.run" || url.username || url.password || url.hash || !paths.includes(url.pathname)) throw requestError("model3d_queue_url_untrusted", "The provider queue URL does not belong to the original Rodin request. A replacement request was not submitted.", "", { requestId, httpStatus: 409, action: "contact_support" });
    return url.toString();
  };
  return { provider: "fal", model, providerJobId: requestId, providerStatusUrl: verified(urls.providerStatusUrl, "/status"), providerResponseUrl: verified(urls.providerResponseUrl, ""), providerCancelUrl: verified(urls.providerCancelUrl, "/cancel") };
}

/** Provider error types are the primary classifier; old partner codes remain supported. */
export function falModel3dError(response: Response, body: unknown, prompt: string, requestId: string | null = null) {
  const root = record(body), nested = record(root.error);
  const details = Array.isArray(root.detail) ? root.detail.map(record) : [];
  const first = details[0] ?? {}, context = record(first.ctx), extra = record(context.extra_info);
  const rawCode = String(first.type ?? nested.code ?? nested.type ?? root.error_type ?? root.code ?? extra.reason ?? (typeof root.error === "string" ? root.error : "")).trim();
  const rawMessage = String(first.msg ?? first.message ?? nested.message ?? root.message ?? (typeof root.detail === "string" ? root.detail : typeof root.error === "string" ? root.error : "Fal could not complete the 3D request."));
  const code = rawCode.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // Some partner integrations wrap their stable upstream code in a generic error message.
  const upstream = ["IMAGE_CONTENT_VIOLATION", "API_OBJECT_NOT_FOUND_ON_IMAGE", "API_PARALLELISM_LIMIT_REACHED", "API_INSUFFICIENT_FUNDS", "API_NO_ACTIVE_SUBSCRIPTION", "API_SUBSCRIPTION_PLAN_TOO_LOW", "NO_SUCH_TASK"].find((name) => rawCode.includes(name) || rawMessage.includes(name));
  const effective = upstream?.toLowerCase() ?? code;
  let detail = { ...classifyProviderFailure(new Error(rawMessage), response, { error: { code: effective, message: rawMessage } }), requestId: response.headers.get("x-fal-request-id") ?? requestId };
  const amend = (change: Partial<ProviderFailureDetail>) => { detail = { ...detail, ...change }; };
  if (effective === "image_content_violation" || /content_policy|safety|moderation/u.test(effective)) amend({ category: "safety", scope: "request", action: "edit_request", retryable: false, message: "The provider could not accept this content. Choose another reference or revise the prompt. Rodin also checks the image created internally from a text-only prompt." });
  else if (effective === "api_object_not_found_on_image") amend({ category: "provider", scope: "request", action: "edit_request", retryable: false, message: "Rodin could not identify a supported subject in the reference. Try another image with the subject clearly visible." });
  else if (effective === "api_parallelism_limit_reached") amend({ category: "rate_limit", scope: "provider", action: "wait_and_retry", retryable: false, message: "Rodin's concurrent-generation limit has been reached. Wait for a running generation to finish before submitting a new request." });
  else if (effective === "api_insufficient_funds") amend({ category: "quota", scope: "account", action: "add_credits", retryable: false, message: "The provider account has insufficient credit for this 3D generation. Check the Fal balance before submitting again." });
  else if (["api_no_active_subscription", "api_subscription_plan_too_low"].includes(effective)) amend({ category: "access", scope: "provider", action: "contact_support", retryable: false, message: "The provider could not authorize this Rodin generation. Check the Fal account's access to this model." });
  else if (effective === "no_such_task") amend({ category: "provider", action: "contact_support", retryable: false, message: "The original Rodin task is unavailable or has expired. Its saved receipt has been retained; no replacement generation was purchased." });
  else if (["string_too_long", "string_max_length"].includes(effective) && details.some((item) => Array.isArray(item.loc) && item.loc.includes("prompt")) || /prompt.*(?:maximum length|string too long)/iu.test(rawMessage)) amend({ category: "provider", action: "edit_request", retryable: false, message: `Shorten the exact 3D prompt to ${RODIN_PROMPT_MAX_CHARS.toLocaleString("en-US")} characters or fewer. Your text has been retained without truncation.` });
  else if (["unsupported_image_format", "image_load_error"].includes(effective)) amend({ action: "edit_request", retryable: false, message: "The provider could not read a reference image. Replace it or save a new JPG, PNG, or WebP view before generating." });
  else if (effective === "file_download_error") amend({ action: "edit_request", retryable: false, message: "The provider could not retrieve an uploaded reference. Prepare the selected images again before submitting a new generation." });
  else if (["image_too_small", "image_too_large", "file_too_large"].includes(effective)) {
    const limits = Object.entries(context).filter(([, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => `${key}: ${String(value)}`).join(", ");
    amend({ action: "edit_request", retryable: false, message: `A reference is outside the provider's accepted size. ${limits ? `Provider limits: ${limits}. ` : ""}Resize or replace it before generating.` });
  } else if (details.length && response.status === 422) amend({ action: "edit_request", retryable: false, message: details.map((item) => `${Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") + ": " : ""}${String(item.msg ?? item.message ?? "Invalid setting")}`).join("; ") });
  if (response.headers.get("x-fal-retryable") === "false") amend({ retryable: false });
  return new ProviderRequestError({ ...detail, code: `fal_model3d_${effective || detail.code}`, retryAfterMs: detail.retryable ? providerRetryAfterMs(response) : null }, prompt);
}

async function fetchJson(url: string, init: RequestInit, prompt: string, requestId: string | null = null) {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "manual" }); }
  catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId }, prompt); }
  let body: Record<string, unknown> = {}, malformed = false;
  try { const json: unknown = await response.json(); body = record(json); malformed = json === null || typeof json !== "object" || Array.isArray(json); }
  catch { malformed = true; }
  if (!response.ok) throw falModel3dError(response, body, prompt, requestId);
  return { response, body, malformed };
}

const hasError = (body: Record<string, unknown>) => body.error != null && body.error !== "" || Boolean(body.error_type) || Array.isArray(body.detail) && body.detail.length > 0;
function verifyResponseIdentity(body: Record<string, unknown>, receipt: FalModel3dProviderReceipt, prompt: string) {
  if (body.request_id !== undefined && body.request_id !== receipt.providerJobId) throw requestError("model3d_response_identity_mismatch", "The provider returned a different request ID. The original 3D receipt was retained for recovery.", prompt, { requestId: receipt.providerJobId, httpStatus: 409, action: "contact_support" });
}
function trustedMediaUrl(value: unknown, prompt: string, requestId: string | null = null) {
  let url: URL;
  try { url = new URL(String(value ?? "")); } catch { throw requestError("model3d_media_url_invalid", "The provider returned an invalid artifact URL. Recover the original request to retrieve its files.", prompt, { requestId, httpStatus: 502 }); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.hostname !== "fal.media" && !url.hostname.endsWith(".fal.media")) throw requestError("model3d_media_url_untrusted", "The provider returned an artifact outside its trusted media service. The original request remains recorded.", prompt, { requestId, httpStatus: 502, action: "contact_support" });
  return url;
}

function imageSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return mime === "image/webp" && bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
}

async function uploadReferences(env: Pick<WorkerEnv, "FAL_KEY">, references: Model3dImageReference[], expected: Model3dReferenceReceipt[], prompt: string, options: FalModel3dOptions) {
  const client = createFalClient({ credentials: env.FAL_KEY, fetch: async (input, init) => {
    aborted(options.signal);
    await options.onBeforeSourceTransmission?.();
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["rest.alpha.fal.ai", "rest.fal.ai", "fal.media"].includes(url.hostname) && !url.hostname.endsWith(".fal.media")) throw requestError("model3d_upload_url_untrusted", "Fal returned an untrusted reference-upload location. No generation was submitted.", prompt);
    return fetch(input, { ...init, signal: options.signal, redirect: "manual" });
  } });
  const urls: string[] = [];
  for (const [index, reference] of references.entries()) {
    aborted(options.signal);
    await options.onStage?.("uploading-references", `Preparing reference ${index + 1} of ${references.length} for Rodin.`);
    try {
      // Snapshot one image at a time. Copying all five 12 MiB references at
      // once would double the caller's live source buffers before any upload.
      const pixels = reference.bytes.buffer instanceof ArrayBuffer ? reference.bytes as Uint8Array<ArrayBuffer> : new Uint8Array(reference.bytes);
      const file = new Blob([pixels], { type: reference.mimeType });
      if (await sha256(new Uint8Array(await file.arrayBuffer())) !== expected[index]?.sha256) throw requestError("model3d_reference_changed", "A reference changed after the reviewed input was prepared. Prepare the selected views again before generating.", prompt);
      const url = await client.storage.upload(file, { lifecycle: { expiresIn: "1d" } });
      urls.push(trustedMediaUrl(url, prompt).toString());
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (error instanceof ApiError) throw falModel3dError(new Response(null, { status: error.status || 502 }), error.body ?? { message: error.message }, prompt);
      throw new ProviderRequestError({ ...classifyProviderFailure(error), code: "model3d_reference_upload_failed" }, prompt);
    }
  }
  return urls;
}

function fileName(file: ProviderFile, url: URL, fallback: string) {
  let name = typeof file.file_name === "string" && file.file_name ? file.file_name : url.pathname.split("/").at(-1) ?? fallback;
  try { name = decodeURIComponent(name); } catch { /* Keep a readable literal name. */ }
  const leaf = name.split(/[\\/]/u).at(-1) ?? "";
  return Array.from(leaf).filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127).join("").trim().slice(0, 240) || fallback;
}
function fileKind(name: string, requested: Model3dFormat, primary: boolean, expected: "mesh" | "texture") {
  const extension = name.toLowerCase().split(".").at(-1) ?? "";
  const format = isModel3dFormat(extension) ? extension : null;
  const imageMimes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", exr: "image/x-exr", tga: "image/x-tga" };
  const role = format ? "mesh" : imageMimes[extension] ? /(?:^|[_-])(?:preview|render|thumbnail)(?:[_.-]|$)/iu.test(name) ? "preview" : "texture" : expected;
  const mimeType = format ? MODEL3D_FORMAT_MIME_TYPES[format] : imageMimes[extension] ?? (extension === "mtl" ? "text/plain" : extension === "zip" ? "application/zip" : primary ? MODEL3D_FORMAT_MIME_TYPES[requested] : "application/octet-stream");
  return { format: format ?? (primary && !["zip", "mtl"].includes(extension) && !imageMimes[extension] ? requested : null), mimeType, role: extension === "mtl" ? "texture" as const : role as Model3dGeneratedFile["role"] };
}
function validModelSignature(bytes: Uint8Array, format: Model3dFormat | null) {
  if (!format) return true;
  if (format === "glb") {
    if (bytes.length < 20) return false;
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return header.getUint32(0, true) === 0x46546c67 && header.getUint32(4, true) === 2 && header.getUint32(8, true) === bytes.length;
  }
  if (format === "usdz") return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  if (format === "fbx") return text.startsWith("Kaydara FBX Binary") || /FBXHeaderExtension|;\s*FBX/iu.test(text);
  if (format === "obj") return /^v\s+[+-]?(?:\d|\.\d)/mu.test(text);
  if (/^\s*solid\s/iu.test(text) && /facet\s+normal/iu.test(text)) return true;
  return bytes.length >= 84 && 84 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) * 50 === bytes.length;
}

function transferLimitError(prompt: string, requestId: string) {
  return requestError("model3d_artifact_transfer_limit", "Rodin produced a file larger than Forma's 64 MiB private-transfer limit. The original provider files and paid receipt are retained for recovery; a replacement generation was not purchased.", prompt, { requestId, httpStatus: 413, action: "contact_support" });
}

async function boundedArtifactBytes(response: Response, advertisedSize: unknown, prompt: string, requestId: string) {
  const declared = typeof advertisedSize === "number" && Number.isSafeInteger(advertisedSize) && advertisedSize >= 0 ? advertisedSize : null;
  const lengthHeader = response.headers.get("content-length");
  const length = lengthHeader !== null && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : null;
  if (declared !== null && declared > MAX_MODEL3D_GENERATED_FILE_BYTES || length !== null && length > MAX_MODEL3D_GENERATED_FILE_BYTES) {
    await response.body?.cancel();
    throw transferLimitError(prompt, requestId);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  // Provider File metadata normally supplies an exact length. Allocate once for
  // that common case instead of retaining chunks plus a second complete model.
  const expected = declared && declared > 0 ? declared : length && length > 0 ? length : null;
  const buffer = expected !== null ? new Uint8Array(expected) : null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_MODEL3D_GENERATED_FILE_BYTES) { await reader.cancel(); throw transferLimitError(prompt, requestId); }
      if (buffer) {
        if (total > buffer.byteLength) { await reader.cancel(); throw requestError("model3d_artifact_length_mismatch", "A provider file exceeded its declared length. The original receipt is retained; resume it to retrieve the complete artifact.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true }); }
        buffer.set(chunk.value, total - chunk.value.byteLength);
      } else chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (buffer) {
    if (total !== buffer.byteLength) throw requestError("model3d_artifact_length_mismatch", "A provider file was shorter than its declared length. The original receipt is retained; resume it to retrieve the complete artifact.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true });
    return buffer;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function downloadFile(file: ProviderFile, receipt: FalModel3dProviderReceipt, prepared: Model3dPreparedReceipt, primary: boolean, expected: "mesh" | "texture", options: FalModel3dOptions): Promise<Model3dGeneratedFile> {
  const prompt = prepared.submittedPrompt, requestId = receipt.providerJobId;
  const url = trustedMediaUrl(file.url, prompt, requestId);
  if (typeof file.file_size === "number" && file.file_size > MAX_MODEL3D_GENERATED_FILE_BYTES) throw transferLimitError(prompt, requestId);
  let response: Response;
  try { response = await fetch(url.toString(), { signal: options.signal, redirect: "manual" }); }
  catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId }, prompt); }
  if (!response.ok) throw requestError("model3d_download_failed", "Rodin finished, but an artifact could not be downloaded. Resume the saved request to retrieve its files without another generation.", prompt, { requestId, httpStatus: response.status, category: "server", scope: "provider", action: "retry", retryable: true, retryAfterMs: providerRetryAfterMs(response) ?? 5000 });
  const bytes = await boundedArtifactBytes(response, file.file_size, prompt, requestId);
  if (!bytes.length) throw requestError("model3d_empty_artifact", "Rodin returned an empty artifact. Resume the original request to retrieve its files.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true });
  const name = fileName(file, url, primary ? `model.${prepared.settings.geometry_file_format}` : "artifact.bin");
  const kind = fileKind(name, prepared.settings.geometry_file_format, primary, expected);
  if (primary && kind.format !== prepared.settings.geometry_file_format && kind.mimeType !== "application/zip") throw requestError("model3d_primary_format_mismatch", "The provider did not return the requested 3D format. The original request is retained for recovery.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true });
  const responseType = String(response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const advertisedType = typeof file.content_type === "string" ? file.content_type.split(";")[0]!.trim().toLowerCase() : "";
  if ([responseType, advertisedType].some((type) => ["text/html", "application/json", "application/javascript", "text/javascript", "image/svg+xml"].includes(type)) || !validModelSignature(bytes, kind.format)) throw requestError("model3d_artifact_invalid", "A downloaded file does not match the returned 3D format. The original provider request is retained for recovery.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true });
  if (["image/png", "image/jpeg", "image/webp"].includes(kind.mimeType) && !imageSignature(bytes, kind.mimeType)) throw requestError("model3d_texture_invalid", "A returned texture or preview is not a readable image. Resume the original provider request to retrieve it again.", prompt, { requestId, httpStatus: 502, action: "retry", retryable: true });
  const mimeType = kind.mimeType === "application/octet-stream" && advertisedType && advertisedType !== "application/octet-stream" ? advertisedType : kind.mimeType;
  return { bytes, mimeType, fileName: name, fileSize: bytes.byteLength, format: kind.format, role: kind.role, providerMediaUrl: url.toString(), sha256: await sha256(bytes) };
}

/** No automatic submission retries. An accepted receipt is always resumed with GET requests. */
export async function generateFalModel3d(env: Pick<WorkerEnv, "FAL_KEY">, prompt: string, options: FalModel3dOptions = {}) {
  if (!env.FAL_KEY?.trim()) throw requestError("model3d_provider_not_configured", "Fal 3D generation is not configured for this environment.", prompt, { category: "authentication", scope: "account", action: "check_credentials", httpStatus: 503 });
  if (options.retainFileBytes === false && !options.onGeneratedFile) throw requestError("model3d_file_sink_required", "Private artifact storage is required before model bytes can be released.", prompt);
  aborted(options.signal);
  const started = Date.now();
  const retained = options.retainedSubmission;
  const originalId = options.providerJobId || retained?.providerRequestId || "";
  if (retained && (retained.provider !== "fal" || retained.operation !== "model3d" || !isRodinModel(retained.model) || options.providerJobId && retained.providerRequestId && options.providerJobId !== retained.providerRequestId)) throw requestError("model3d_submission_mismatch", "The saved paid request does not belong to this Rodin generation. No replacement was submitted.", prompt, { httpStatus: 409, action: "contact_support" });
  if (retained && !originalId) throw requestError("model3d_submission_unresolved", retained.status === "rejected" ? "The saved 3D request was rejected. Review its input before starting a new generation." : "The earlier 3D submission has no confirmed provider ID. Check its retained receipt before purchasing another generation.", prompt, { httpStatus: 409, action: "contact_support" });
  let prepared: Model3dPreparedReceipt;
  let receipt: FalModel3dProviderReceipt | null = null;
  let references: Model3dImageReference[] = [];
  if (originalId) {
    const saved = options.retainedReceipt;
    if (!saved || saved.provider !== "fal" || !isRodinModel(saved.model) || typeof saved.submittedPrompt !== "string" || !Array.isArray(saved.referenceInputs)
      || options.providerModel && options.providerModel !== saved.model || retained && retained.model !== saved.model) throw requestError("model3d_prepared_receipt_missing", "The original 3D input receipt is required to recover this generation. A replacement request was not submitted.", prompt, { requestId: originalId, httpStatus: 409, action: "contact_support" });
    const checked = validateModel3dRequest({ prompt: saved.submittedPrompt, settings: saved.settings, referenceCount: saved.referenceInputs.length, mode: saved.model === RODIN_IMAGE_MODEL ? "image" : "text" });
    if (!checked.valid || !Number.isFinite(saved.estimatedCostMicrousd) || saved.estimatedCostMicrousd !== checked.estimatedCostMicrousd) throw requestError("model3d_prepared_receipt_invalid", "The saved 3D settings or cost receipt cannot be verified. No replacement generation was submitted.", saved.submittedPrompt, { requestId: originalId, httpStatus: 409, action: "contact_support" });
    const originalInput = serializeRodinInput(saved.submittedPrompt, saved.settings, saved.referenceInputs.map((_, index) => `https://fal.media/reference-${index + 1}`)).input;
    const originalParameters = Object.fromEntries(Object.entries(originalInput).filter(([key]) => key !== "image_urls"));
    const referencesValid = saved.referenceInputs.every((reference, index) => reference && reference.index === index
      && Number.isSafeInteger(reference.byteLength) && reference.byteLength > 0 && /^[a-f0-9]{64}$/u.test(reference.sha256)
      && ["image/jpeg", "image/png", "image/webp"].includes(reference.mimeType) && reference.transport === "fal-storage-upload"
      && [reference.blockId, reference.referenceId, reference.label].every((value) => value === null || typeof value === "string"));
    const digest = await sha256(new TextEncoder().encode(stableJson({ model: saved.model, parameters: originalParameters, referenceInputs: saved.referenceInputs })));
    if (!referencesValid || !Array.isArray(saved.acceptedFields) || stableJson([...saved.acceptedFields].sort()) !== stableJson(Object.keys(originalInput).sort())
      || stableJson(saved.parameters) !== stableJson(originalParameters) || saved.requestDigest !== digest
      || saved.usedReferencePixels !== (saved.model === RODIN_IMAGE_MODEL)) throw requestError("model3d_prepared_receipt_mismatch", "The saved prompt, settings, and image evidence do not match the original 3D input receipt. A replacement request was not submitted.", saved.submittedPrompt, { requestId: originalId, httpStatus: 409, action: "contact_support" });
    prepared = saved;
    receipt = falModel3dProviderReceipt(saved.model, originalId, options);
  } else {
    const selected = options.references ?? [];
    const checked = validateModel3dRequest({ prompt, settings: options.settings, referenceCount: selected.length, referenceMimeTypes: selected.map((reference) => reference.mimeType) });
    if (!checked.valid) throw requestError(checked.issues[0]!.code, checked.issues.map((issue) => issue.message).join(" "), prompt);
    if (options.providerModel && options.providerModel !== checked.model) throw requestError("model3d_endpoint_mismatch", "The selected Rodin endpoint does not match the prepared references.", prompt);
    if (options.estimatedCostMicrousd !== undefined && (!Number.isFinite(options.estimatedCostMicrousd) || options.estimatedCostMicrousd < checked.estimatedCostMicrousd)) throw requestError("model3d_reservation_insufficient", "The approved budget does not cover the selected Rodin tier and add-ons.", prompt);
    references = selected.map((reference, index) => {
      if (!(reference.bytes instanceof Uint8Array) || !reference.bytes.length || !imageSignature(reference.bytes, reference.mimeType)) throw requestError("model3d_reference_bytes_invalid", `Reference ${index + 1} is not a readable ${reference.mimeType} image. Save a new JPG, PNG, or WebP view before generating.`, prompt);
      return { ...reference, bytes: reference.bytes };
    });
    const referenceInputs = await Promise.all(references.map(async (reference, index): Promise<Model3dReferenceReceipt> => ({ index, blockId: reference.blockId ?? null, referenceId: reference.referenceId ?? null, label: reference.label ?? null, mimeType: reference.mimeType, byteLength: reference.bytes.byteLength, sha256: await sha256(reference.bytes), transport: "fal-storage-upload" })));
    const preview = serializeRodinInput(prompt, checked.settings, references.map((_, index) => `https://fal.media/reference-${index + 1}`));
    const parameters = Object.fromEntries(Object.entries(preview.input).filter(([key]) => key !== "image_urls"));
    const requestDigest = await sha256(new TextEncoder().encode(stableJson({ model: checked.model, parameters, referenceInputs })));
    prepared = { provider: "fal", model: checked.model, adapterVersion: RODIN_ADAPTER_VERSION, submittedPrompt: prompt, settings: checked.settings, parameters, acceptedFields: Object.keys(preview.input), referenceInputs, usedReferencePixels: references.length > 0, estimatedCostMicrousd: checked.estimatedCostMicrousd, requestDigest };
  }
  const submittedPrompt = prepared.submittedPrompt;
  let submission: PaidProviderSubmission = retained ?? { clientRequestId: `forma-model3d-${crypto.randomUUID()}`, provider: "fal", operation: "model3d", model: prepared.model, status: originalId ? "accepted" : "pending", ...(originalId ? { providerRequestId: originalId } : {}) };
  let attempted = false, pendingObserved = false, state: QueueState | null = null;
  await options.onPrepared?.(prepared);
  try {
    if (!receipt) {
      const urls = await uploadReferences(env, references, prepared.referenceInputs, submittedPrompt, options);
      const input = serializeRodinInput(submittedPrompt, prepared.settings, urls).input;
      await options.onBeforeProviderAttempt?.({ model: prepared.model, maximumInputTokens: 0, maximumOutputTokens: 0, clientRequestId: submission.clientRequestId, logicalCallKey: "model3d:initial", requestDigest: prepared.requestDigest });
      await options.onBeforeSourceTransmission?.();
      await options.onStage?.("submitting", "Submitting the reviewed 3D prompt and selected views to Rodin.");
      pendingObserved = true;
      await options.onProviderSubmission?.(submission);
      aborted(options.signal);
      options.onBeforeProviderDispatch?.(submission.clientRequestId);
      attempted = true;
      const accepted = await fetchJson(`https://queue.fal.run/${prepared.model}`, { method: "POST", headers: falHeaders(env), body: JSON.stringify(input), signal: options.signal }, submittedPrompt);
      const requestId = String(accepted.body.request_id ?? accepted.response.headers.get("x-fal-request-id") ?? "");
      if (!requestId) {
        if (hasError(accepted.body)) throw falModel3dError(new Response(null, { status: 422 }), accepted.body, submittedPrompt);
        throw requestError("model3d_submission_receipt_missing", "Fal returned no confirmed 3D request ID. The pending receipt has been retained to prevent a duplicate purchase.", submittedPrompt, { httpStatus: 502, action: "contact_support" });
      }
      receipt = falModel3dProviderReceipt(prepared.model, requestId);
      submission = { ...submission, status: "accepted", providerRequestId: requestId };
      await options.onProviderSubmission?.(submission);
      await options.onReceipt?.(receipt);
      // Only hashes and identifiers are needed after acceptance. Release the
      // borrowed reference pixels before downloading potentially large meshes.
      references.length = 0;
      const body = accepted.body as QueueState;
      receipt = falModel3dProviderReceipt(prepared.model, requestId, { providerStatusUrl: body.status_url, providerResponseUrl: body.response_url, providerCancelUrl: body.cancel_url });
      await options.onReceipt?.(receipt);
      if (hasError(accepted.body)) throw falModel3dError(new Response(null, { status: 422 }), accepted.body, submittedPrompt, requestId);
      state = accepted.malformed ? null : body;
    } else {
      await options.onReceipt?.(receipt);
      await options.onStage?.("provider-resume", "Recovering the original Rodin generation without submitting another paid request.");
    }
    const requestId = receipt.providerJobId;
    const deadline = Date.now() + (Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) >= 0 ? Number(options.timeoutMs) : 20 * 60_000);
    const interval = Number.isFinite(options.pollIntervalMs) && Number(options.pollIntervalMs) >= 0 ? Number(options.pollIntervalMs) : 5000;
    while (state?.status !== "COMPLETED") {
      aborted(options.signal);
      if (Date.now() > deadline) throw requestError("model3d_generation_timeout", "Rodin is still processing. Resume this saved request to check for its result without purchasing another generation.", submittedPrompt, { requestId, category: "server", scope: "provider", httpStatus: 504, action: "retry", retryable: true, retryAfterMs: 30_000 });
      const checked = await fetchJson(`${receipt.providerStatusUrl}${receipt.providerStatusUrl.includes("?") ? "&" : "?"}logs=1`, { headers: falHeaders(env), signal: options.signal }, submittedPrompt, requestId);
      verifyResponseIdentity(checked.body, receipt, submittedPrompt);
      if (hasError(checked.body)) throw falModel3dError(new Response(null, { status: 422, headers: checked.response.headers }), checked.body, submittedPrompt, requestId);
      state = checked.body as QueueState;
      if (["FAILED", "CANCELLED", "CANCELED"].includes(state.status ?? "")) throw requestError("model3d_generation_terminated", "The provider ended this 3D generation without a result. Review the retained input before starting a new request.", submittedPrompt, { requestId, httpStatus: 422 });
      if (checked.malformed || !["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(state.status ?? "")) throw requestError("model3d_queue_state_invalid", "Fal returned an unrecognized 3D queue state. Resume the original request to check its status again.", submittedPrompt, { requestId, category: "server", scope: "provider", httpStatus: 502, action: "retry", retryable: true, retryAfterMs: 5000 });
      if (state.status !== "COMPLETED") {
        await options.onStage?.(state.status === "IN_QUEUE" ? "queued" : "rendering-model3d", state.status === "IN_QUEUE" ? "The 3D generation is queued with Rodin." : "Rodin is generating the geometry and materials.");
        await wait(interval, options.signal);
      }
    }
    verifyResponseIdentity(state as Record<string, unknown>, receipt, submittedPrompt);
    if (hasError(state as Record<string, unknown>)) throw falModel3dError(new Response(null, { status: 422 }), state, submittedPrompt, requestId);
    await options.onStage?.("finalizing", "Rodin finished. Retrieving every model, texture, and preview from the original request.");
    const result = await fetchJson(receipt.providerResponseUrl, { headers: falHeaders(env), signal: options.signal }, submittedPrompt, requestId);
    verifyResponseIdentity(result.body, receipt, submittedPrompt);
    if (hasError(result.body)) throw falModel3dError(new Response(null, { status: 422, headers: result.response.headers }), result.body, submittedPrompt, requestId);
    const data = record(result.body.data ?? result.body);
    if (hasError(data)) throw falModel3dError(new Response(null, { status: 422 }), data, submittedPrompt, requestId);
    const mesh = record(data.model_mesh);
    if (result.malformed || typeof mesh.url !== "string" || !Array.isArray(data.textures) || data.model_meshes !== undefined && !Array.isArray(data.model_meshes)
      || !Number.isInteger(data.seed) || Number(data.seed) < 0 || Number(data.seed) > 65535) throw requestError("model3d_result_incomplete", "The provider result is missing a model, texture list, or generation seed. Resume the retained request to retrieve the complete result.", submittedPrompt, { requestId, category: "server", scope: "provider", httpStatus: 502, action: "retry", retryable: true });
    if (submission.status !== "completed") {
      submission = { ...submission, status: "completed", providerRequestId: requestId, costMicrousd: prepared.estimatedCostMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      await options.onProviderSubmission?.(submission);
    }
    const entries: Array<{ file: ProviderFile; primary: boolean; group: "mesh" | "texture" }> = [
      { file: mesh, primary: true, group: "mesh" },
      ...(data.model_meshes as unknown[] ?? []).map((file) => ({ file: record(file), primary: false, group: "mesh" as const })),
      ...data.textures.map((file) => ({ file: record(file), primary: false, group: "texture" as const })),
    ];
    const described = new Set<string>();
    const manifest: Model3dProviderArtifactDescriptor[] = [];
    for (const entry of entries) {
      const url = trustedMediaUrl(entry.file.url, submittedPrompt, requestId);
      if (described.has(url.toString())) continue;
      described.add(url.toString());
      const name = fileName(entry.file, url, entry.primary ? `model.${prepared.settings.geometry_file_format}` : "artifact.bin");
      const kind = fileKind(name, prepared.settings.geometry_file_format, entry.primary, entry.group);
      manifest.push({ providerMediaUrl: url.toString(), ...kind, fileName: name, fileSize: typeof entry.file.file_size === "number" && Number.isSafeInteger(entry.file.file_size) && entry.file.file_size >= 0 ? entry.file.file_size : null });
    }
    await options.onResultManifest?.(manifest);
    const seen = new Set<string>(), files: Model3dGeneratedFile[] = [], additionalMeshes: Model3dGeneratedFile[] = [], textures: Model3dGeneratedFile[] = [];
    for (const entry of entries) {
      const url = trustedMediaUrl(entry.file.url, submittedPrompt, requestId).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      aborted(options.signal);
      const file = await downloadFile(entry.file, receipt, prepared, entry.primary, entry.group, options);
      await options.onGeneratedFile?.(file, files.length);
      const retainedFile = options.retainFileBytes === false ? { ...file, bytes: new Uint8Array() } : file;
      files.push(retainedFile);
      if (!entry.primary) (entry.group === "texture" ? textures : additionalMeshes).push(retainedFile);
    }
    return { ...files[0]!, ...receipt, providerRequestId: requestId, adapterVersion: RODIN_ADAPTER_VERSION, additionalMeshes, textures, seed: Number(data.seed), submittedPrompt, preparedReceipt: prepared, latencyMs: Date.now() - started, costMicrousd: prepared.estimatedCostMicrousd, costPrecision: "published-provider-estimate" as const };
  } catch (error) {
    if (pendingObserved && !attempted && !receipt) await options.onProviderSubmission?.({ ...submission, status: "rejected", costMicrousd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    else if (attempted && !receipt && error instanceof ProviderRequestError && definitiveProviderRejection(Number(error.detail.httpStatus))) await options.onProviderSubmission?.({ ...submission, status: "rejected", costMicrousd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    else if (attempted && !receipt) throw requestError("model3d_submission_uncertain", "The 3D submission may have reached Fal, but its request ID was not confirmed. The pending receipt prevents a second paid submission. Check the provider receipt before retrying.", submittedPrompt, { httpStatus: error instanceof ProviderRequestError ? error.detail.httpStatus : null, action: "contact_support" });
    if (error instanceof Model3dInputError) throw requestError(error.issues[0]?.code ?? "model3d_input_invalid", error.message, submittedPrompt);
    if (error instanceof ProviderRequestError) throw new ProviderRequestError({ ...error.detail, requestId: error.detail.requestId ?? receipt?.providerJobId ?? null,
      ...(error.detail.category === "safety" ? { contributingBlockIds: prepared.referenceInputs.map((reference) => reference.blockId).filter((id): id is string => Boolean(id)), contributingReferenceIds: prepared.referenceInputs.map((reference) => reference.referenceId).filter((id): id is string => Boolean(id)), probe: "fal-rodin-provider-content-validation" } : {}),
    }, submittedPrompt);
    throw error;
  }
}
