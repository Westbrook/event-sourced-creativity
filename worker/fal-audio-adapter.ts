import { ApiError, createFalClient } from "@fal-ai/client";
import { AUDIO_ADAPTER_CONTRACT, MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse } from "./provider-errors.ts";
import type { WorkerEnv } from "./runtime.ts";

type FalAudioQueueState = {
  request_id?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  queue_position?: number;
  logs?: Array<{ message?: string }>;
  error?: unknown;
};

type FalAudioFile = { url?: string; content_type?: string; file_name?: string; file_size?: number };
type FalAudioResult = { audio?: FalAudioFile | string; lyrics?: string; data?: { audio?: FalAudioFile | string; lyrics?: string } };

export type AudioImageReference = {
  bytes: Uint8Array;
  mimeType: string;
  blockId: string;
  referenceId: string;
  label: string;
};

export type CreativeAudioPreparedReceipt = {
  provider: "fal";
  model: string;
  submittedPrompt: string;
  parameters: Record<string, unknown>;
  imageReference: Record<string, unknown> | null;
  sourceAudioTreatment: "none" | "authored-description-only";
  audioWaveformSubmitted: false;
};

export type CreativeAudioOptions = {
  imageReference?: AudioImageReference;
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

async function fetchJson(url: string, init: RequestInit, prompt: string, requestId: string | null = null): Promise<{ response: Response; body: Record<string, unknown> }> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId }, prompt); }
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw providerError("fal_audio_response_invalid", "Fal returned an invalid audio-generation response. The original request can be recovered without creating another track.", prompt, { requestId, retryable: true, status: response.status, category: "server" }); }
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
  throw providerError("fal_audio_result_missing", "Fal completed the track without returning a playable audio file. The retained request can be recovered.", prompt, { requestId, retryable: true, status: 502, category: "server" });
}

async function imageReceipt(reference: AudioImageReference) {
  const bytes = new Uint8Array(reference.bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return { block_id: reference.blockId, reference_id: reference.referenceId, label: reference.label, mime_type: reference.mimeType, byte_length: bytes.length, sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""), pixels_submitted: true };
}

/** Lyria accepts exactly prompt and, when explicitly authorized, one image_url. */
export async function generateCreativeAudio(env: WorkerEnv, prompt: string, options: CreativeAudioOptions = {}) {
  if (!env.FAL_KEY?.trim()) throw providerError("audio_provider_not_configured", "Fal music generation is not configured for this environment.", prompt, { status: 503, category: "authentication", action: "check_credentials" });
  if (env.FORMA_AUDIO_PROVIDER && env.FORMA_AUDIO_PROVIDER !== "fal") throw providerError("audio_provider_unsupported", "The configured audio provider is not supported.", prompt, { status: 503, category: "access", action: "check_credentials" });
  const submittedPrompt = (options.retainedReceipt?.submittedPrompt ?? prompt).trim();
  if (!submittedPrompt) throw providerError("audio_prompt_required", "The document did not produce a usable music direction.", prompt);
  const model = options.providerModel ?? options.retainedReceipt?.model ?? env.FAL_AUDIO_MODEL ?? AUDIO_ADAPTER_CONTRACT.model;
  if (model !== AUDIO_ADAPTER_CONTRACT.model || options.retainedReceipt && options.providerModel && options.providerModel !== options.retainedReceipt.model) throw providerError("audio_provider_model_unsupported", "Only the price-verified Lyria 3 Pro music model is authorized for this generation.", submittedPrompt);
  if (!options.providerJobId && submittedPrompt.length > AUDIO_ADAPTER_CONTRACT.maxPromptCharacters) throw providerError(
    "audio_prompt_too_long",
    `The music direction exceeds Lyria 3 Pro’s ${AUDIO_ADAPTER_CONTRACT.maxPromptCharacters.toLocaleString()}-character limit. Shorten the required composition direction and try again.`,
    submittedPrompt,
  );
  const image = options.imageReference;
  if (image && (!image.bytes.length || !image.mimeType.startsWith("image/") || !image.blockId || !image.referenceId)) throw providerError("audio_image_reference_invalid", "Music generation can use one explicitly approved, nonempty image reference.", submittedPrompt);
  const started = Date.now();
  let providerJobId = options.providerJobId ?? "";
  let urls = providerJobId ? queueUrls(model, providerJobId, { status_url: options.providerStatusUrl, response_url: options.providerResponseUrl, cancel_url: options.providerCancelUrl }) : { statusUrl: "", responseUrl: "", cancelUrl: "" };
  const imageReference = image ? await imageReceipt(image) : options.retainedReceipt?.imageReference ?? null;
  const sourceAudioTreatment = options.sourceAudioBlockIds?.length ? "authored-description-only" : options.retainedReceipt?.sourceAudioTreatment ?? "none";
  const prepared: CreativeAudioPreparedReceipt = {
    provider: "fal", model, submittedPrompt,
    parameters: { accepted_fields: ["prompt", ...(image ? ["image_url"] : [])], image_reference_count: image ? 1 : 0, audio_waveform_submitted: false, semantic_audio_reference_count: options.sourceAudioBlockIds?.length ?? 0, published_cost_microusd: AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd },
    imageReference, sourceAudioTreatment, audioWaveformSubmitted: false,
  };
  await options.onPrepared?.(options.retainedReceipt ?? prepared);

  try {
    if (!providerJobId) {
      let imageUrl: string | undefined;
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
      await options.onStage?.("submitting", "Submitting the original music brief to Lyria 3 Pro.");
      const input = { prompt: submittedPrompt, ...(imageUrl ? { image_url: imageUrl } : {}) };
      const submitted = await fetchJson(`https://queue.fal.run/${model}`, { method: "POST", headers: headers(env), body: JSON.stringify(input), signal: options.signal }, submittedPrompt);
      providerJobId = String(submitted.body.request_id ?? submitted.response.headers.get("x-fal-request-id") ?? "");
      if (!providerJobId) throw providerError("fal_audio_submission_receipt_missing", "Fal accepted no durable music request identifier. No completed track can be reported.", submittedPrompt, { retryable: true, status: 502, category: "server" });
      urls = queueUrls(model, providerJobId, submitted.body as FalAudioQueueState);
      await options.onReceipt?.({ providerJobId, provider: "fal", model, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl });
    } else {
      await options.onReceipt?.({ providerJobId, provider: "fal", model, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl });
    }

    const deadline = Date.now() + 15 * 60_000;
    let state: FalAudioQueueState = { status: "IN_QUEUE" };
    while (state.status !== "COMPLETED") {
      if (Date.now() >= deadline) throw providerError("fal_audio_timeout", "Lyria has not finished yet. Resume the saved provider request instead of purchasing another track.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 504, category: "server" });
      const checked = await fetchJson(`${urls.statusUrl}${urls.statusUrl.includes("?") ? "&" : "?"}logs=1`, { headers: headers(env), signal: options.signal }, submittedPrompt, providerJobId);
      state = checked.body as FalAudioQueueState;
      if (state.status === "FAILED" || state.status === "CANCELLED") throw providerError(`fal_audio_${state.status.toLowerCase()}`, `Fal marked the original music request as ${state.status.toLowerCase()}. Review the retained composition brief before starting a changed track.`, submittedPrompt, { requestId: providerJobId, status: 422 });
      if (!state.status || !["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(state.status)) throw providerError("fal_audio_status_invalid", "Fal returned an unrecognized music-generation queue status. The original request remains recoverable.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
      if (state.status !== "COMPLETED") {
        const log = state.logs?.at(-1)?.message?.trim();
        await options.onStage?.(state.status === "IN_QUEUE" ? "queued" : "rendering-audio", log ? `Lyria 3 Pro · ${log}` : state.status === "IN_QUEUE" ? "Original music is queued with the provider." : "Lyria 3 Pro is composing the original soundtrack.");
        await wait(2_000, options.signal);
      }
    }

    await options.onStage?.("finalizing", "The original soundtrack is complete. Verifying its provider receipt.");
    const response = await fetchJson(urls.responseUrl, { headers: headers(env), signal: options.signal }, submittedPrompt, providerJobId);
    const result = response.body as FalAudioResult;
    const audio = normalizeAudioFile(result, submittedPrompt, providerJobId);
    let media: URL;
    try { media = new URL(audio.url!); } catch { throw providerError("fal_audio_url_invalid", "Fal returned an invalid soundtrack location.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" }); }
    if (media.protocol !== "https:" || media.hostname !== "fal.media" && !media.hostname.endsWith(".fal.media")) throw providerError("fal_audio_url_untrusted", "Fal returned a soundtrack outside its trusted media domain; that location was not requested.", submittedPrompt, { requestId: providerJobId, status: 502, action: "contact_support" });
    await options.onStage?.("downloading", "Saving the generated soundtrack to private project storage.");
    let downloaded: Response;
    try { downloaded = await fetch(media.toString(), { signal: options.signal }); }
    catch (error) { throw new ProviderRequestError({ ...classifyProviderFailure(error), requestId: providerJobId }, submittedPrompt); }
    if (!downloaded.ok) throw providerError("fal_audio_download_failed", "Fal completed the soundtrack but its media could not be downloaded. Resume the retained provider request.", submittedPrompt, { requestId: providerJobId, retryable: true, status: downloaded.status, category: "server" });
    const advertised = Number(audio.file_size ?? downloaded.headers.get("content-length") ?? 0);
    if (advertised > MAX_AUDIO_UPLOAD_BYTES) throw providerError("fal_audio_too_large", "The generated soundtrack exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId });
    const reader = downloaded.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > MAX_AUDIO_UPLOAD_BYTES) { await reader.cancel(); throw providerError("fal_audio_too_large", "The generated soundtrack exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId }); } chunks.push(chunk.value); }
    else { const fallback = new Uint8Array(await downloaded.arrayBuffer()); total = fallback.byteLength; if (total > MAX_AUDIO_UPLOAD_BYTES) throw providerError("fal_audio_too_large", "The generated soundtrack exceeds Forma’s private 25 MB media limit.", submittedPrompt, { requestId: providerJobId }); chunks.push(fallback); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!bytes.length) throw providerError("fal_audio_empty", "Fal returned an empty soundtrack. The original provider request can be inspected and recovered.", submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
    const mimeType = String(audio.content_type ?? downloaded.headers.get("content-type") ?? "audio/mpeg").split(";")[0]!.trim().toLowerCase();
    if (!AUDIO_ADAPTER_CONTRACT.supportedOutputMimeTypes.includes(mimeType as typeof AUDIO_ADAPTER_CONTRACT.supportedOutputMimeTypes[number])) throw providerError("fal_audio_type_invalid", `Fal returned ${mimeType || "an unknown format"} instead of Lyria’s supported MP3 recording.`, submittedPrompt, { requestId: providerJobId, retryable: true, status: 502, category: "server" });
    return {
      provider: "fal" as const, model, providerJobId, providerStatusUrl: urls.statusUrl, providerResponseUrl: urls.responseUrl, providerCancelUrl: urls.cancelUrl,
      bytes, mimeType, fileName: audio.file_name ?? null, fileSize: typeof audio.file_size === "number" ? audio.file_size : bytes.byteLength,
      lyrics: typeof result.lyrics === "string" ? result.lyrics : typeof result.data?.lyrics === "string" ? result.data.lyrics : "",
      latencyMs: Date.now() - started, costMicrousd: AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd, submittedPrompt, preparedReceipt: options.retainedReceipt ?? prepared,
    };
  } catch (error) {
    if (options.signal?.aborted && providerJobId) {
      try { await fetch(urls.cancelUrl, { method: "PUT", headers: headers(env) }); } catch { /* Cancellation is best-effort and the durable job records the local stop. */ }
    }
    throw error;
  }
}
