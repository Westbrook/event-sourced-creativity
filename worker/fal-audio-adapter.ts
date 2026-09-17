import { ApiError, createFalClient } from "@fal-ai/client";
import { captureOutputAudioAttempt, readOutputAudioEnvelope, type OutputAudioAttempt } from "./output-audio-execution.ts";
import { parseAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { definitiveProviderRejection, type PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import {
  AUDIO_ADAPTER_CONTRACT, MAX_AUDIO_UPLOAD_BYTES, audioAdapterContractForModel,
  AudioAdapterSelectionError, estimateAudioProviderCostMicrousd, normalizeAudioRequestProfile,
  selectAudioAdapterContract, type AudioRequestProfile,
} from "../src/model/audio.ts";
import { serializeAudioRequest } from "./audio-adapters/index.ts";
import { AudioProviderInputError } from "./audio-adapters/types.ts";
import { audioCharacterCount, validateAudioProviderParameters } from "../src/model/audio-provider-contracts.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse } from "./provider-errors.ts";
import type { WorkerEnv } from "./runtime.ts";

type FalAudioQueueState = {
  request_id?: string;
  model?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  queue_position?: number;
  logs?: Array<{ message?: string }>;
  error?: unknown;
};

type FalAudioFile = { url?: string; content_type?: string; file_name?: string; file_size?: number; duration?: number };
type FalAudioResult = { audio?: FalAudioFile | string; lyrics?: string; data?: { audio?: FalAudioFile | string; lyrics?: string } };

export type AudioImageReference = {
  bytes: Uint8Array;
  mimeType: string;
  blockId: string;
  referenceId: string;
  label: string;
};

export type AudioVideoReference = {
  bytes: Uint8Array;
  mimeType: string;
  artifactId: string;
  referenceId: string;
  label: string;
  durationSeconds: number;
};

export type CreativeAudioPreparedReceipt = {
  provider: "fal";
  model: string;
  submittedPrompt: string;
  parameters: Record<string, unknown>;
  imageReference: Record<string, unknown> | null;
  videoReference?: Record<string, unknown> | null;
  sourceAudioTreatment: "none" | "authored-description-only";
  audioWaveformSubmitted: false;
};

/** A completed original provider result priced by the app's published rate.
 * This is neither a preview nor evidence of an invoiced provider charge. */
export type AudioCompletedResultObservation = Readonly<{
  provider: "fal"; model: string; providerRequestId: string; costMicrousd: number;
  costBasis: "published-audio-rate"; inputTokens: 0; outputTokens: 0; totalTokens: 0;
}>;
const completedAudioResults = new WeakMap<AudioCompletedResultObservation, { env: WorkerEnv; database: WorkerEnv["DB"] }>();
export function readAudioCompletedResultObservation(observation: AudioCompletedResultObservation, env: WorkerEnv,
  original: { model: string; providerRequestId: string }): AudioCompletedResultObservation {
  const captured = completedAudioResults.get(observation);
  if (!captured || captured.env !== env || captured.database !== env.DB || observation.model !== original.model
    || observation.providerRequestId !== original.providerRequestId) throw new Error("output_audio_result_observation_invalid");
  return observation;
}

export type CreativeAudioOptions = {
  outputAudio?: unknown;
  onBeforeProviderAttempt?: (attempt: ProviderAttemptPreflight) => void | Promise<void>;
  onBeforeProviderDispatch?: (clientRequestId: string) => void;
  onBeforeSourceTransmission?: () => Promise<void>;
  onProviderSubmission?: PaidProviderSubmissionObserver;
  onOutputAudioRequest?: (request: OutputAudioAttempt & {clientRequestId:string; requestDigest:string}) => Promise<void>;
  imageReference?: AudioImageReference;
  videoReference?: AudioVideoReference;
  profile?: AudioRequestProfile;
  spokenScript?: string;
  voiceDirection?: string;
  estimatedCostMicrousd?: number;
  sourceAudioBlockIds?: string[];
  providerJobId?: string;
  providerModel?: string;
  providerStatusUrl?: string;
  providerResponseUrl?: string;
  providerCancelUrl?: string;
  retainedReceipt?: CreativeAudioPreparedReceipt;
  signal?: AbortSignal;
  onStage?: (stage: string, message: string) => void | Promise<void>;
  onPrepared?: (receipt: CreativeAudioPreparedReceipt) => void | Promise<void>;
  onReceipt?: (receipt: { providerJobId: string; provider: "fal"; model: string; providerStatusUrl: string; providerResponseUrl: string; providerCancelUrl: string }) => void | Promise<void>;
};

const providerError = (code: string, message: string, prompt: string, options: { requestId?: string | null; retryable?: boolean; status?: number | null; category?: "provider" | "server" | "authentication" | "access"; action?: "edit_request" | "retry" | "check_credentials" | "contact_support" } = {}) =>
  new ProviderRequestError({ code, category: options.category ?? "provider", scope: options.category === "authentication" ? "account" : options.category === "server" ? "provider" : "request", action: options.action ?? (options.retryable ? "retry" : "edit_request"), message, retryable: options.retryable ?? false, retryAfterMs: options.retryable ? 1_000 : null, requestId: options.requestId ?? null, httpStatus: options.status ?? 400 }, prompt);

const headers = (env: WorkerEnv) => ({ authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json", "x-fal-store-io": "0" });

function queueUrls(model: string, requestId: string, receipt: Partial<FalAudioQueueState> = {}) {
  const parts = model.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error("fal_audio_model_invalid");
  const base = `https://queue.fal.run/${parts.slice(0, 2).join("/")}/requests/${encodeURIComponent(requestId)}`;
  const trusted = (value: unknown, fallback: string) => {
    try { const url = new URL(String(value ?? "")); return url.protocol === "https:" && url.hostname === "queue.fal.run" ? url.toString() : fallback; } catch { return fallback; }
  };
  return { statusUrl: trusted(receipt.status_url, `${base}/status`), responseUrl: trusted(receipt.response_url, base), cancelUrl: trusted(receipt.cancel_url, `${base}/cancel`) };
}

async function fetchJson(url: string, init: RequestInit, prompt: string, requestId: string | null = null, bounded = false): Promise<{ response: Response; body: Record<string, unknown> }> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId }, prompt); }
  if (response.status >= 300 && response.status < 400) {
    throw providerError("fal_audio_redirect_refused", "The original audio request returned an unexpected redirect. No redirected request was sent.", prompt, { requestId, status: response.status, category: "server" });
  }
  let body: Record<string, unknown>;
  try { body = (bounded ? JSON.parse(await readOutputAudioEnvelope(response)) : await response.json()) as Record<string, unknown>; }
  catch { if(bounded)throw new Error("output_audio_response_unreadable"); throw providerError("fal_audio_response_invalid", "Fal returned an invalid audio-generation response. The original request can be recovered without purchasing another output.", prompt, { requestId, retryable: true, status: response.status, category: "server" }); }
  if (!response.ok) {
    const error = providerErrorFromResponse(response, body, `fal_audio_${response.status}`, prompt);
    throw new ProviderRequestError({ ...error.detail, code: error.detail.code.startsWith("fal_") ? error.detail.code : `fal_${error.detail.code}`, requestId: error.detail.requestId ?? requestId }, prompt);
  }
  return { response, body };
}

const wait = (duration: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("The operation was aborted.", "AbortError"));
  const timeout = setTimeout(resolve, duration);
  signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new DOMException("The operation was aborted.", "AbortError")); }, { once: true });
});

function normalizeAudioFile(result: FalAudioResult, prompt: string, requestId: string): FalAudioFile {
  const raw = result.audio ?? result.data?.audio;
  if (typeof raw === "string") return { url: raw, content_type: "audio/mpeg" };
  if (raw && typeof raw === "object" && typeof raw.url === "string") return raw;
  throw providerError("fal_audio_result_missing", "Fal completed the request without returning a playable audio file. The retained request can be recovered.", prompt, { requestId, retryable: true, status: 502, category: "server" });
}

/** Both supported result locations must describe the same original result.
 * Optional echoes may be absent, but an ignored branch cannot contradict it. */
function assertCompletedAudioResultEnvelope(result: Record<string, unknown>, model: string, requestId: string, prompt: string) {
  const nested = result.data;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return;
  const data = nested as Record<string, unknown>;
  if (data.request_id !== undefined && data.request_id !== requestId || data.model !== undefined && data.model !== model) {
    throw providerError("fal_audio_receipt_mismatch", "The nested audio result does not identify the original native request.", prompt, { requestId, status: 409 });
  }
  if (data.error != null) {
    throw providerError("fal_audio_result_rejected", "The saved audio result contains a provider error; no replacement was submitted.", prompt, { requestId, status: 422 });
  }
  if (result.audio != null && data.audio != null) {
    const outer = normalizeAudioFile({ audio: result.audio } as FalAudioResult, prompt, requestId);
    const inner = normalizeAudioFile({ audio: data.audio } as FalAudioResult, prompt, requestId);
    const fields = ["url", "content_type", "file_name", "file_size", "duration"] as const;
    if (fields.some(key => (outer[key] ?? null) !== (inner[key] ?? null))) {
      throw providerError("fal_audio_result_ambiguous", "The provider returned conflicting audio result locations.", prompt, { requestId, status: 409 });
    }
  }
}

async function imageReceipt(reference: AudioImageReference) {
  const bytes = new Uint8Array(reference.bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return { block_id: reference.blockId, reference_id: reference.referenceId, label: reference.label, mime_type: reference.mimeType, byte_length: bytes.length, sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""), pixels_submitted: true };
}

async function videoReceipt(reference: AudioVideoReference) {
  const bytes = new Uint8Array(reference.bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return {
    artifact_id: reference.artifactId, reference_id: reference.referenceId, label: reference.label,
    mime_type: reference.mimeType, byte_length: bytes.length, duration_seconds: reference.durationSeconds,
    sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""),
    video_transmitted: true, embedded_audio_may_be_transmitted: true,
  };
}

/** Already-accepted result retrieval, shared without submission or cancellation. */
async function readAcceptedAudio(
  env: WorkerEnv,
  accepted: { model: string; providerJobId: string; urls: ReturnType<typeof queueUrls>; profile: AudioRequestProfile; prepared: CreativeAudioPreparedReceipt; estimatedCostMicrousd: number; started: number },
  options: Pick<CreativeAudioOptions, "signal" | "onStage" | "onBeforeSourceTransmission"> & { verifyIdentity?: boolean;
    onCompletedResult?: (observation: AudioCompletedResultObservation) => void | Promise<void> },
) {
  const { model, providerJobId, urls, profile, prepared, estimatedCostMicrousd, started } = accepted;
  const observationDatabase = env.DB;
  if (options.onCompletedResult) verifiedAudioRecoveryQueue(model, providerJobId,
    { providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl });
  const contract = audioAdapterContractForModel(model)!;
  const submittedPrompt = prepared.submittedPrompt;
  const deadline = Date.now() + 15 * 60_000;
  let state: FalAudioQueueState = { status: "IN_QUEUE" };
  while (state.status !== "COMPLETED") {
    if (Date.now() >= deadline) throw providerError("fal_audio_timeout", `${contract.label} has not finished yet. Resume the saved provider request instead of purchasing another audio output.`, submittedPrompt, { requestId: providerJobId, retryable: true, status: 504, category: "server" });
    await options.onBeforeSourceTransmission?.();
    const checked = await fetchJson(`${urls.statusUrl}${urls.statusUrl.includes("?") ? "&" : "?"}logs=1`, { method: "GET", headers: headers(env), signal: options.signal, ...(options.verifyIdentity ? { redirect: "manual" as const } : {}) }, submittedPrompt, providerJobId, options.verifyIdentity === true);
    state = checked.body as FalAudioQueueState;
    if (options.verifyIdentity && state.request_id !== undefined && state.request_id !== providerJobId) throw providerError("fal_audio_receipt_mismatch", "The provider returned a different audio request identifier.", submittedPrompt, { requestId: providerJobId, status: 409 });
    if (options.verifyIdentity && state.error != null) throw providerError("fal_audio_result_rejected", "The saved audio request returned a provider error; no replacement was submitted.", submittedPrompt, { requestId: providerJobId, status: 422 });
    if (state.status === "FAILED" || state.status === "CANCELLED") throw providerError(`fal_audio_${state.status.toLowerCase()}`, `Fal marked the ${contract.label} audio request as ${state.status.toLowerCase()}. Review the retained creative direction before starting a changed request.`, submittedPrompt, { requestId: providerJobId, status: 422 });
    if (!state.status || !["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(state.status)) throw providerError("fal_audio_status_invalid", "Fal returned an unrecognized audio-generation queue status. The original request remains recoverable.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
    if (state.status !== "COMPLETED") {
      const log = state.logs?.at(-1)?.message?.trim();
      await options.onStage?.(state.status === "IN_QUEUE" ? "queued" : "rendering-audio", log ? `${contract.label} · ${log}` : state.status === "IN_QUEUE" ? "The audio request is queued with the provider." : `${contract.label} is producing the requested audio.`);
      await wait(2_000, options.signal);
    }
  }

  await options.onStage?.("finalizing", "The requested audio is complete. Verifying its provider receipt.");
  await options.onBeforeSourceTransmission?.();
  const response = await fetchJson(urls.responseUrl, { method: "GET", headers: headers(env), signal: options.signal, ...(options.verifyIdentity ? { redirect: "manual" as const } : {}) }, submittedPrompt, providerJobId, options.verifyIdentity === true);
  if (options.verifyIdentity && response.body.request_id !== undefined && response.body.request_id !== providerJobId) throw providerError("fal_audio_receipt_mismatch", "The provider returned a different audio result identifier.", submittedPrompt, { requestId: providerJobId, status: 409 });
  if (options.verifyIdentity && response.body.error != null) throw providerError("fal_audio_result_rejected", "The saved audio result contains a provider error; no replacement was submitted.", submittedPrompt, { requestId: providerJobId, status: 422 });
  if (options.onCompletedResult) assertCompletedAudioResultEnvelope(response.body, model, providerJobId, submittedPrompt);
  const result = response.body as FalAudioResult;
  const audio = normalizeAudioFile(result, submittedPrompt, providerJobId);
  const resultCost = () => {
    const measuredDuration = Number(audio.duration ?? (result as Record<string, unknown>).duration ?? 0);
    if (contract.pricing.mode === "per_minute" && measuredDuration > contract.maximumAdvertisedDurationSeconds) {
      throw providerError("audio_provider_duration_exceeds_contract", "The audio provider reported a duration outside its approved generation contract; inspect the saved provider request before continuing.", submittedPrompt, { requestId: providerJobId, status: 502, category: "server", action: "contact_support" });
    }
    const measuredCost = estimateAudioProviderCostMicrousd(contract, profile, {
      ...(contract.pricing.mode === "per_minute" && measuredDuration > 0 && measuredDuration <= contract.maximumAdvertisedDurationSeconds ? { durationSeconds: Math.ceil(measuredDuration) } : {}),
      ...(contract.pricing.mode === "per_1000_characters" ? { characterCount: audioCharacterCount(submittedPrompt) } : {}),
    });
    if (measuredCost > estimatedCostMicrousd) {
      throw providerError("audio_provider_cost_exceeds_reservation", "The provider reported usage above the authorized audio reservation; the original provider request remains available for review.", submittedPrompt, { requestId: providerJobId, status: 502, category: "server", action: "contact_support" });
    }
    return measuredCost;
  };
  let observedCost: number | undefined;
  if (options.onCompletedResult) {
    if (!options.verifyIdentity || model !== "fal-ai/stable-audio-3/medium/text-to-audio"
      || state.model !== undefined && state.model !== model
      || response.body.model !== undefined && response.body.model !== model || env.DB !== observationDatabase) {
      throw providerError("fal_audio_receipt_mismatch", "The completed audio result does not identify the original native request.", submittedPrompt, { requestId: providerJobId, status: 409 });
    }
    observedCost = resultCost();
    if (!Number.isSafeInteger(observedCost) || observedCost <= 0 || !Number.isSafeInteger(estimatedCostMicrousd)) {
      throw providerError("audio_provider_cost_exceeds_reservation", "The original completed audio result has no verified app cost.", submittedPrompt, { requestId: providerJobId, status: 502 });
    }
    const observation: AudioCompletedResultObservation = Object.freeze({ provider: "fal", model, providerRequestId: providerJobId,
      costMicrousd: observedCost, costBasis: "published-audio-rate", inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    completedAudioResults.set(observation, { env, database: observationDatabase });
    // Financial evidence survives a later creative-authority or media failure.
    // The next GET still executes the separate current-source/lease guard.
    await options.onCompletedResult(observation);
  }
  let media: URL;
  try { media = new URL(audio.url!); } catch { throw providerError("fal_audio_url_invalid", "Fal returned an invalid audio location.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" }); }
  if (options.verifyIdentity && (media.username || media.password || media.port)) throw providerError("fal_audio_url_untrusted", "The audio location has an unapproved authority.", submittedPrompt, { requestId: providerJobId, status: 409 });
  if (media.protocol !== "https:" || media.hostname !== "fal.media" && !media.hostname.endsWith(".fal.media")) throw providerError("fal_audio_url_untrusted", "Fal returned audio outside its trusted media domain; that location was not requested.", submittedPrompt, { requestId: providerJobId, status: 502, action: "contact_support" });
  await options.onStage?.("downloading", "Saving the generated audio to private project storage.");
  let downloaded: Response;
  // Workers support manual/follow only. Manual also keeps redirects from
  // escaping the trusted media host; the non-2xx check below rejects them.
  await options.onBeforeSourceTransmission?.();
  try { downloaded = await fetch(media.toString(), { signal: options.signal, redirect: "manual" }); }
  catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId: providerJobId }, submittedPrompt); }
  if (!downloaded.ok) throw providerError("fal_audio_download_failed", "Fal completed the audio request but its media could not be downloaded. Resume the retained provider request.", submittedPrompt, { requestId: providerJobId, retryable: true, status: downloaded.status, category: "server" });
  const advertised = Number(audio.file_size ?? downloaded.headers.get("content-length") ?? 0);
  if (advertised > MAX_AUDIO_UPLOAD_BYTES) throw providerError("fal_audio_too_large", "The generated audio exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId });
  const reader = downloaded.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > MAX_AUDIO_UPLOAD_BYTES) { try { void reader.cancel().catch(() => undefined); } catch { /* Preserve overflow. */ } throw providerError("fal_audio_too_large", "The generated audio exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId }); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
  else { const fallback = new Uint8Array(await downloaded.arrayBuffer()); total = fallback.byteLength; if (total > MAX_AUDIO_UPLOAD_BYTES) throw providerError("fal_audio_too_large", "The generated audio exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId }); chunks.push(fallback); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!bytes.length) throw providerError("fal_audio_empty", "Fal returned empty audio. The original provider request can be inspected and recovered.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
  const advertisedType = String(audio.content_type ?? "").split(";")[0]!.trim().toLowerCase();
  const downloadedType = String(downloaded.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (options.verifyIdentity && downloadedType && downloadedType !== "application/octet-stream"
    && (!contract.supportedOutputMimeTypes.includes(downloadedType) || advertisedType && advertisedType !== "application/octet-stream" && advertisedType !== downloadedType)) {
    throw providerError("fal_audio_type_invalid", "The downloaded recording does not match the provider's supported audio format.", submittedPrompt, { requestId: providerJobId, status: 502, category: "server", retryable: true });
  }
  let mimeType = advertisedType && advertisedType !== "application/octet-stream" ? advertisedType : downloadedType && downloadedType !== "application/octet-stream" ? downloadedType : "";
  if (!mimeType && (media.pathname.toLowerCase().endsWith(".mp3") || String(audio.file_name ?? "").toLowerCase().endsWith(".mp3"))) mimeType = "audio/mpeg";
  if (!mimeType && model === AUDIO_ADAPTER_CONTRACT.model) mimeType = "audio/mpeg";
  if (!contract.supportedOutputMimeTypes.includes(mimeType)) throw providerError("fal_audio_type_invalid", `Fal returned ${mimeType || "an unknown format"} instead of a supported ${contract.label} recording.`, submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
  const costMicrousd = observedCost ?? resultCost();
  return {
    provider: "fal" as const, model, providerJobId, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl,
    bytes, mimeType, fileName: audio.file_name ?? null, fileSize: typeof audio.file_size === "number" ? audio.file_size : bytes.byteLength,
    lyrics: typeof result.lyrics === "string" ? result.lyrics : typeof result.data?.lyrics === "string" ? result.data.lyrics : "",
    latencyMs: Date.now() - started, costMicrousd, submittedPrompt, preparedReceipt: prepared,
  };
}

/** Exact model/request binding is mandatory for read-only recovery. */
export function verifiedAudioRecoveryQueue(model: string, requestId: string, receipt: Pick<CreativeAudioOptions, "providerStatusUrl" | "providerResponseUrl" | "providerCancelUrl">) {
  if (!audioAdapterContractForModel(model) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(requestId) || ["pending", "submitted", "unknown"].includes(requestId.toLowerCase())) {
    throw providerError("audio_recovery_receipt_invalid", "A verified original audio model and request are required.", "", { status: 409 });
  }
  const canonical = queueUrls(model, requestId);
  if (receipt.providerStatusUrl !== canonical.statusUrl || receipt.providerResponseUrl !== canonical.responseUrl || receipt.providerCancelUrl !== canonical.cancelUrl) {
    throw providerError("audio_recovery_receipt_invalid", "The retained queue locations do not identify the original audio request.", "", { requestId, status: 409 });
  }
  return canonical;
}

/** Retrieve an accepted recording using GET only. Never submit, upload, or cancel. */
export async function recoverAcceptedAudio(env: WorkerEnv, options: CreativeAudioOptions & { providerJobId: string; providerModel: string; retainedReceipt: CreativeAudioPreparedReceipt;
  onCompletedResult?: (observation: AudioCompletedResultObservation) => void | Promise<void> }) {
  const urls = verifiedAudioRecoveryQueue(options.providerModel, options.providerJobId, options);
  const prepared = options.retainedReceipt;
  if (prepared.provider !== "fal" || prepared.model !== options.providerModel || typeof prepared.submittedPrompt !== "string" || !prepared.submittedPrompt.trim() || prepared.audioWaveformSubmitted !== false) {
    throw providerError("audio_recovery_receipt_invalid", "The original audio input and provider identity must agree.", "", { requestId: options.providerJobId, status: 409 });
  }
  if (!env.FAL_KEY?.trim() || env.FORMA_AUDIO_PROVIDER && env.FORMA_AUDIO_PROVIDER !== "fal") {
    throw providerError("audio_provider_not_configured", "The original audio provider is unavailable.", "", { status: 503, category: "authentication", action: "check_credentials" });
  }
  const estimatedCostMicrousd = Number(prepared.parameters.published_cost_microusd);
  if (!Number.isSafeInteger(estimatedCostMicrousd) || estimatedCostMicrousd <= 0) {
    throw providerError("audio_recovery_receipt_invalid", "The original audio cost evidence is unavailable.", "", { requestId: options.providerJobId, status: 409 });
  }
  return readAcceptedAudio(env, { model: options.providerModel, providerJobId: options.providerJobId, urls, profile: normalizeAudioRequestProfile(options.profile), prepared, estimatedCostMicrousd, started: Date.now() }, { signal: options.signal, onStage: options.onStage, onBeforeSourceTransmission: options.onBeforeSourceTransmission, verifyIdentity: true, onCompletedResult: options.onCompletedResult });
}

/** Route an approved specialist schema through one recoverable Fal queue transport. */
export async function generateCreativeAudio(env: WorkerEnv, prompt: string, options: CreativeAudioOptions = {}) {
  const nativePresent=Object.hasOwn(options,"outputAudio"), nativeAudio=nativePresent?parseAudioOutputContract(options.outputAudio):null;
  if(nativePresent&&(!nativeAudio||options.providerJobId||options.retainedReceipt||options.imageReference||options.videoReference||options.spokenScript||options.voiceDirection
    ||options.providerModel!=="fal-ai/stable-audio-3/medium/text-to-audio"||!options.onBeforeProviderAttempt||!options.onBeforeProviderDispatch||!options.onBeforeSourceTransmission||!options.onProviderSubmission||!options.onOutputAudioRequest))throw new Error("output_audio_dispatch_hooks_required");
  if (!env.FAL_KEY?.trim()) throw providerError("audio_provider_not_configured", "Fal audio generation is not configured for this environment.", prompt, { status: 503, category: "authentication", action: "check_credentials" });
  if (env.FORMA_AUDIO_PROVIDER && env.FORMA_AUDIO_PROVIDER !== "fal") throw providerError("audio_provider_unsupported", "The configured audio provider is not supported.", prompt, { status: 503, category: "access", action: "check_credentials" });
  const model = options.retainedReceipt?.model ?? options.providerModel ?? env.FAL_AUDIO_MODEL ?? AUDIO_ADAPTER_CONTRACT.model;
  const contract = audioAdapterContractForModel(model);
  if (!contract || options.retainedReceipt && options.providerModel && options.providerModel !== options.retainedReceipt.model) {
    throw providerError("audio_provider_model_unsupported", "The requested audio specialist is not approved for this generation.", prompt);
  }
  let profile = normalizeAudioRequestProfile(options.profile);
  if (options.providerJobId && options.retainedReceipt && model !== AUDIO_ADAPTER_CONTRACT.model) {
    const retainedDuration = Number(options.retainedReceipt.parameters.duration_seconds ?? options.retainedReceipt.videoReference?.duration_seconds ?? 0);
    const retainedSpeakers = Number(options.retainedReceipt.parameters.speaker_count ?? 0);
    profile = normalizeAudioRequestProfile({
      ...profile,
      ...(typeof options.retainedReceipt.parameters.goal === "string" ? { goal: options.retainedReceipt.parameters.goal } : {}),
      ...(typeof options.retainedReceipt.parameters.destination === "string" ? { destination: options.retainedReceipt.parameters.destination } : {}),
      ...(retainedDuration > 0 ? { durationSeconds: retainedDuration } : {}),
      ...(retainedSpeakers > 0 ? { speakerCount: retainedSpeakers } : {}),
    });
  }
  if (!options.providerJobId && profile.role === "silence") throw providerError("audio_silence_requested", "Silence does not require a paid provider request.", prompt);
  const image = options.providerJobId ? undefined : options.imageReference;
  const video = options.providerJobId ? undefined : options.videoReference;
  if (image && (!image.bytes.length || !image.mimeType.startsWith("image/") || !image.blockId || !image.referenceId || !contract.maximumImageReferences)) {
    throw providerError("audio_image_reference_invalid", "This audio specialist cannot use the selected image reference.", prompt);
  }
  if (video && (!contract.supportsVideoReference || video.mimeType !== "video/mp4" || !video.bytes.length || video.bytes.length > MAX_AUDIO_UPLOAD_BYTES || !video.artifactId || !video.referenceId || !Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0 || video.durationSeconds > contract.maximumAdvertisedDurationSeconds)) {
    throw providerError("audio_video_reference_invalid", "Video synchronization requires one explicitly approved MP4 clip within the supported duration and size limits.", prompt);
  }
  if (!options.providerJobId && contract.supportsVideoReference && !video) throw providerError("audio_video_reference_required", "This audio specialist requires an explicitly approved video clip.", prompt);
  if (!options.providerJobId && options.profile !== undefined) {
    try { profile = selectAudioAdapterContract(options.profile, { preferredModel: model, videoReferenceAvailable: Boolean(video) }).profile; }
    catch (error) {
      if (error instanceof AudioAdapterSelectionError) throw providerError(error.code, error.message, prompt);
      throw error;
    }
  }
  if (!options.providerJobId && profile.durationSeconds && profile.durationSeconds > contract.maximumAdvertisedDurationSeconds) {
    throw providerError("audio_duration_unsupported", `${contract.label} cannot generate the requested duration.`, prompt);
  }
  if (video && contract.supportsVideoReference) {
    if (profile.durationSeconds && profile.durationSeconds > video.durationSeconds) {
      throw providerError("audio_duration_exceeds_video", "Synchronized audio cannot be longer than the approved video clip.", prompt);
    }
    // Both end-user video goals explicitly score the complete approved clip.
    profile = { ...profile, durationSeconds: video.durationSeconds };
  }
  if (!video && options.providerJobId && contract.supportsVideoReference) {
    const retainedDuration = Number(options.retainedReceipt?.videoReference?.duration_seconds ?? options.retainedReceipt?.parameters.duration_seconds ?? 0);
    if (retainedDuration > 0 && retainedDuration <= contract.maximumAdvertisedDurationSeconds) {
      profile = { ...profile, durationSeconds: retainedDuration };
    }
  }
  let preview: Record<string, unknown>;
  try {
    preview = options.providerJobId ? { prompt: options.retainedReceipt?.submittedPrompt ?? prompt } : serializeAudioRequest(model, {
      prompt: (options.retainedReceipt?.submittedPrompt ?? prompt).trim(), profile,
      ...(image ? { imageUrl: "https://fal.media/approved-image" } : {}),
      ...(video ? { videoUrl: "https://fal.media/approved-video", videoDurationSeconds: video.durationSeconds } : {}),
      ...(options.spokenScript ? { spokenScript: options.spokenScript } : {}),
      ...(options.voiceDirection ? { voiceDirection: options.voiceDirection } : {}),
    });
  } catch (error) {
    if (options.providerJobId && options.retainedReceipt) preview = { prompt: options.retainedReceipt.submittedPrompt };
    else if (error instanceof AudioProviderInputError) throw providerError(error.code, error.message, prompt);
    else throw error;
  }
  const submittedPrompt = options.retainedReceipt?.submittedPrompt ?? String(preview.prompt ?? "").trim();
  if (!submittedPrompt) throw providerError("audio_prompt_required", "The document did not produce usable audio direction.", prompt);
  const minimumCostMicrousd = estimateAudioProviderCostMicrousd(contract, profile, {
    ...(contract.pricing.mode === "per_1000_characters" ? { characterCount: audioCharacterCount(submittedPrompt) } : {}),
  });
  const estimatedCostMicrousd = options.estimatedCostMicrousd ?? minimumCostMicrousd;
  if (!options.providerJobId && (!Number.isFinite(estimatedCostMicrousd) || estimatedCostMicrousd < minimumCostMicrousd)) {
    throw providerError("audio_provider_reservation_insufficient", "The approved audio reservation does not cover the actual script or complete video clip.", submittedPrompt);
  }
  const started = Date.now();
  let providerJobId = options.providerJobId ?? "";
  let urls = providerJobId ? queueUrls(model, providerJobId, { status_url: options.providerStatusUrl, response_url: options.providerResponseUrl, cancel_url: options.providerCancelUrl }) : { statusUrl: "", responseUrl: "", cancelUrl: "" };
  const imageReference = image ? await imageReceipt(image) : options.retainedReceipt?.imageReference ?? null;
  const videoReference = video ? await videoReceipt(video) : options.retainedReceipt?.videoReference ?? null;
  const sourceAudioTreatment = options.sourceAudioBlockIds?.length ? "authored-description-only" : options.retainedReceipt?.sourceAudioTreatment ?? "none";
  const prepared: CreativeAudioPreparedReceipt = {
    provider: "fal", model, submittedPrompt,
    parameters: {
      accepted_fields: Object.keys(preview), image_reference_count: image ? 1 : 0,
      audio_waveform_submitted: false, semantic_audio_reference_count: options.sourceAudioBlockIds?.length ?? 0,
      published_cost_microusd: estimatedCostMicrousd,
      ...(model === AUDIO_ADAPTER_CONTRACT.model ? {} : {
        goal: profile.goal, destination: profile.destination, pricing_mode: contract.pricing.mode,
        ...(profile.durationSeconds ? { duration_seconds: profile.durationSeconds } : {}),
        ...(profile.speakerCount ? { speaker_count: profile.speakerCount } : {}),
        provider_parameters: Object.fromEntries(Object.entries(preview).filter(([key]) => !["prompt", "image_url", "video_url"].includes(key))),
      }),
      ...(videoReference ? { video_reference_count: 1, duration_seconds: profile.durationSeconds, embedded_audio_may_be_transmitted: true } : {}),
    },
    imageReference, sourceAudioTreatment, audioWaveformSubmitted: false,
    ...(videoReference ? { videoReference } : {}),
  };
  await options.onPrepared?.(options.retainedReceipt ?? prepared);
  let nativeAttempt: Awaited<ReturnType<typeof captureOutputAudioAttempt>> | null=null, nativeDispatched=false;
  const nativeReceipt=(status:"pending"|"accepted"|"completed"|"rejected")=>({clientRequestId:nativeAttempt!.clientRequestId,provider:"fal" as const,operation:"audio" as const,model,status,unitId:"audio:initial",requestDigest:nativeAttempt!.requestDigest,...(providerJobId?{providerRequestId:providerJobId}:{})});

  try {
    if (!providerJobId) {
      let imageUrl: string | undefined;
      let videoUrl: string | undefined;
      if (image) {
        await options.onStage?.("uploading-references", "Uploading one explicitly approved image as musical inspiration.");
        try { imageUrl = await createFalClient({ credentials: env.FAL_KEY }).storage.upload(new Blob([new Uint8Array(image.bytes).buffer], { type: image.mimeType }), { lifecycle: { expiresIn: "1d" } }); }
        catch (error) {
          if (error instanceof ApiError) {
            const response = new Response(null, { status: error.status || 502 });
            throw providerErrorFromResponse(response, error.body ?? { error: { message: error.message } }, "fal_audio_image_upload_failed", submittedPrompt);
          }
          throw new ProviderRequestError({ ...classifyProviderFailure(error), code: "fal_audio_image_upload_failed" }, submittedPrompt);
        }
      }
      if (video) {
        await options.onStage?.("uploading-references", "Uploading the separately approved video, including any embedded sound, for synchronization.");
        try {
          videoUrl = await createFalClient({ credentials: env.FAL_KEY }).storage.upload(new Blob([new Uint8Array(video.bytes).buffer], { type: video.mimeType }), { lifecycle: { expiresIn: "1d" } });
        } catch (error) {
          if (error instanceof ApiError) {
            const response = new Response(null, { status: error.status || 502 });
            throw providerErrorFromResponse(response, error.body ?? { error: { message: error.message } }, "fal_audio_video_upload_failed", submittedPrompt);
          }
          throw new ProviderRequestError({ ...classifyProviderFailure(error), code: "fal_audio_video_upload_failed" }, submittedPrompt);
        }
      }
      let input: Record<string, unknown>;
      try {
        // Keep the validated script, aliases and cost basis unchanged after upload.
        input = validateAudioProviderParameters(model, {
          ...preview, ...(imageUrl ? { image_url: imageUrl } : {}), ...(videoUrl ? { video_url: videoUrl } : {}),
        }, { videoDurationSeconds: video?.durationSeconds });
      } catch (error) {
        if (error instanceof AudioProviderInputError) throw providerError(error.code, error.message, submittedPrompt);
        throw error;
      }
      await options.onStage?.("submitting", `Submitting the approved audio request to ${contract.label}.`);
      const requestBody=JSON.stringify(input);
      if(nativeAudio){
        nativeAttempt=await captureOutputAudioAttempt(nativeAudio,requestBody,`forma-audio-${crypto.randomUUID()}`,"audio:initial");
        await options.onBeforeProviderAttempt!(nativeAttempt);
        await options.onOutputAudioRequest!({...nativeAttempt.audio,clientRequestId:nativeAttempt.clientRequestId,requestDigest:nativeAttempt.requestDigest});
        await options.onBeforeSourceTransmission!();
        await options.onProviderSubmission!(nativeReceipt("pending"));
        options.onBeforeProviderDispatch!(nativeAttempt.clientRequestId);nativeDispatched=true;
      }
      const submitted = await fetchJson(`https://queue.fal.run/${model}`, { method: "POST", headers: headers(env), body: requestBody, signal: options.signal, ...(nativeAudio?{redirect:"manual" as const}:{}) }, submittedPrompt, null, Boolean(nativeAudio));
      providerJobId = String(submitted.body.request_id ?? submitted.response.headers.get("x-fal-request-id") ?? "");
      if (!providerJobId) throw providerError("fal_audio_submission_receipt_missing", "Fal accepted no durable audio request identifier. No completed output can be reported.", submittedPrompt, { retryable: true, status: 502, category: "server" });
      urls = queueUrls(model, providerJobId, submitted.body as FalAudioQueueState);
      if(nativeAudio){
        if(submitted.body.request_id!==providerJobId||!/^[-A-Za-z0-9_]{1,200}$/u.test(providerJobId))throw new Error("output_audio_receipt_invalid");
        urls=verifiedAudioRecoveryQueue(model,providerJobId,{providerStatusUrl:urls.statusUrl,providerResponseUrl:urls.responseUrl,providerCancelUrl:urls.cancelUrl});
        await options.onProviderSubmission!(nativeReceipt("accepted"));
      }
      await options.onReceipt?.({ providerJobId, provider: "fal", model, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl });
    } else {
      await options.onReceipt?.({ providerJobId, provider: "fal", model, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl });
    }

    const result=await readAcceptedAudio(env, { model, providerJobId, urls, profile, prepared: options.retainedReceipt ?? prepared, estimatedCostMicrousd, started }, {...options,...(nativeAudio?{verifyIdentity:true,
      onCompletedResult:async(observed:AudioCompletedResultObservation)=>{await options.onProviderSubmission!({...nativeReceipt("completed"),costMicrousd:observed.costMicrousd,inputTokens:0,outputTokens:0,totalTokens:0});}}:{})});
    if(nativeAudio&&result.lyrics.trim())throw new Error("output_audio_lyrics_returned");
    return result;
  } catch (error) {
    if(nativeAttempt&&nativeDispatched&&!providerJobId&&error instanceof ProviderRequestError&&definitiveProviderRejection(Number(error.detail.httpStatus)))await options.onProviderSubmission!({...nativeReceipt("rejected"),costMicrousd:0});
    if (options.signal?.aborted && providerJobId) {
      try { await fetch(urls.cancelUrl, { method: "PUT", headers: headers(env) }); } catch { /* Cancellation is best-effort and the durable job records the local stop. */ }
    }
    throw error;
  }
}
