import { OPENAI_IMAGE_MODERATION_CONTRACT } from "./openai-image-route-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { ImageReference } from "./openai-adapter.ts";
import type { PromptTechnique } from "../src/model/prompt-structures.ts";
import { providerErrorFromResponse } from "./provider-errors.ts";

type ModerationResult = { flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> };
type ModerationResponse = { id?: string; model?: string; results?: ModerationResult[]; error?: { message?: string; code?: string; type?: string } };
export type GenerationModerationReceipt = {
  available: boolean;
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
  blockIds: string[];
  referenceIds: string[];
  model: string;
  requestId: string | null;
  requestIds: string[];
  probeCount: number;
  latencyMs: number;
  coverage: "text" | "text-and-images" | "text-and-some-images";
  // Retained only to read historical receipts; new preflights preserve exact text.
  promptNormalization?: "fictional-software-mystery";
};

const headers = (env: WorkerEnv) => ({
  authorization: `Bearer ${env.OPENAI_API_KEY}`,
  "content-type": "application/json",
  ...(env.OPENAI_PROJECT ? { "OpenAI-Project": env.OPENAI_PROJECT } : {}),
});

const factText = (fact: unknown) => {
  if (!fact || typeof fact !== "object") return "";
  const record = fact as Record<string, unknown>; const properties = record.properties && typeof record.properties === "object" ? record.properties as Record<string, unknown> : {};
  return [record.type, record.role, record.intent, record.effect, record.handle, properties.text, properties.instruction, properties.value, properties.label, properties.description].filter(Boolean).join(" · ").slice(0, 6_000);
};

async function requestModeration(env: WorkerEnv, input: unknown, signal?: AbortSignal) {
  const started = Date.now();
  const response = await fetch(OPENAI_IMAGE_MODERATION_CONTRACT.api, { method: "POST", headers: headers(env), signal, body: JSON.stringify({ model: OPENAI_IMAGE_MODERATION_CONTRACT.model, input }) });
  let body: ModerationResponse = {}; try { body = await response.json() as ModerationResponse; } catch { /* Status still provides a useful provider receipt. */ }
  if (!response.ok) throw providerErrorFromResponse(response, body, `openai_moderation_${response.status}`);
  return { body, requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id"), latencyMs: Date.now() - started };
}

const summarize = (results: ModerationResult[]) => {
  const categories = new Set<string>(); const scores: Record<string, number> = {};
  for (const result of results) {
    for (const [category, value] of Object.entries(result.categories ?? {})) if (value) categories.add(category);
    for (const [category, value] of Object.entries(result.category_scores ?? {})) scores[category] = Math.max(scores[category] ?? 0, Number(value) || 0);
  }
  return { flagged: results.some((result) => Boolean(result.flagged)), categories: [...categories].sort(), scores };
};

export async function moderateGenerationSnapshot(env: WorkerEnv, snapshot: Record<string, unknown>, signal?: AbortSignal): Promise<GenerationModerationReceipt> {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : []; const mapped = facts.map((fact) => ({ id: String((fact as Record<string, unknown>)?.block_id ?? ""), text: factText(fact) })).filter((item) => item.text);
  const canonical = JSON.stringify(snapshot).slice(0, 28_000); const inputs = [canonical, ...mapped.slice(0, 24).map((item) => item.text)];
  const { body, requestId, latencyMs } = await requestModeration(env, inputs, signal); const results = body.results ?? []; const summary = summarize(results);
  const blockIds = mapped.slice(0, 24).filter((_, index) => Boolean(results[index + 1]?.flagged)).map((item) => item.id).filter(Boolean);
  return { available: true, ...summary, blockIds, referenceIds: [], model: body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model, requestId, requestIds: requestId ? [requestId] : [], probeCount: 1, latencyMs, coverage: "text" };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; const size = 0x4000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  return btoa(binary);
}

export async function moderateExactImagePrompt(env: WorkerEnv, prompt: string, references: ImageReference[], signal?: AbortSignal): Promise<GenerationModerationReceipt> {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  // The moderation endpoint accepts one image per multimodal input. Image edits,
  // including GPT Image 2 reference workflows, can legitimately receive more
  // than one image. Probe the exact text once, then every image independently;
  // never truncate safety coverage or submit an invalid multi-image probe.
  const probes: Array<{ reference: ImageReference | null; input: unknown }> = [
    { reference: null, input: [{ type: OPENAI_IMAGE_MODERATION_CONTRACT.input, text: prompt }] },
    ...references.map((reference) => ({
      reference,
      input: [{ type: "image_url", image_url: { url: `data:${reference.mimeType};base64,${bytesToBase64(reference.bytes)}` } }],
    })),
  ];
  const categories = new Set<string>(); const scores: Record<string, number> = {}; const referenceIds = new Set<string>(); const requestIds: string[] = [];
  let flagged = false; let latencyMs = 0; let model: string = OPENAI_IMAGE_MODERATION_CONTRACT.model; let flaggedRequestId: string | null = null;
  for (const probe of probes) {
    const result = await requestModeration(env, probe.input, signal); const summary = summarize(result.body.results ?? []);
    latencyMs += result.latencyMs; model = result.body.model ?? model;
    if (result.requestId) requestIds.push(result.requestId);
    for (const category of summary.categories) categories.add(category);
    for (const [category, score] of Object.entries(summary.scores)) scores[category] = Math.max(scores[category] ?? 0, score);
    if (!summary.flagged) continue;
    flagged = true; flaggedRequestId ??= result.requestId;
    if (probe.reference) referenceIds.add(probe.reference.referenceId ?? probe.reference.blockId ?? probe.reference.label ?? probe.reference.source);
  }
  return {
    available: true, flagged, categories: [...categories].sort(), scores, blockIds: [], referenceIds: [...referenceIds], model,
    requestId: flaggedRequestId ?? requestIds[0] ?? null, requestIds, probeCount: probes.length, latencyMs,
    coverage: references.length ? "text-and-images" : "text",
  };
}

export type PromptTechniqueModerationResult = {
  technique: PromptTechnique;
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
  requestId: string | null;
  latencyMs: number;
};

/**
 * Compare all four exact prompt representations without making an image request.
 * Text is sent as one moderation batch; each selected image is checked once and
 * shared across the four results so reference pixels are never multiplied by the
 * number of prompt techniques.
 */
export async function moderatePromptTechniqueSet(
  env: WorkerEnv,
  prompts: Array<{ technique: PromptTechnique; prompt: string }>,
  references: ImageReference[],
  signal?: AbortSignal,
) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const textResponse = await requestModeration(env, prompts.map((entry) => entry.prompt), signal);
  const perPromptLatency = Math.round(textResponse.latencyMs / Math.max(1, prompts.length));
  const promptResults: PromptTechniqueModerationResult[] = prompts.map((entry, index) => {
    const result = textResponse.body.results?.[index];
    const summary = summarize(result ? [result] : []);
    return { technique: entry.technique, ...summary, requestId: textResponse.requestId, latencyMs: perPromptLatency };
  });

  const categories = new Set<string>();
  const scores: Record<string, number> = {};
  const referenceIds = new Set<string>();
  const requestIds: string[] = [];
  let flagged = false;
  let latencyMs = 0;
  let flaggedRequestId: string | null = null;
  let model = textResponse.body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model;
  for (const reference of references) {
    const result = await requestModeration(env, [{ type: "image_url", image_url: { url: `data:${reference.mimeType};base64,${bytesToBase64(reference.bytes)}` } }], signal);
    const summary = summarize(result.body.results ?? []);
    latencyMs += result.latencyMs;
    model = result.body.model ?? model;
    if (result.requestId) requestIds.push(result.requestId);
    for (const category of summary.categories) categories.add(category);
    for (const [category, score] of Object.entries(summary.scores)) scores[category] = Math.max(scores[category] ?? 0, score);
    if (!summary.flagged) continue;
    flagged = true;
    flaggedRequestId ??= result.requestId;
    referenceIds.add(reference.referenceId ?? reference.blockId ?? reference.label ?? reference.source);
  }
  return {
    promptResults,
    references: {
      flagged,
      categories: [...categories].sort(),
      scores,
      referenceIds: [...referenceIds],
      requestId: flaggedRequestId ?? requestIds[0] ?? null,
      requestIds,
      probeCount: references.length,
      latencyMs,
      model,
      coverage: references.length ? "images" as const : "none" as const,
    },
    textRequestId: textResponse.requestId,
    textModel: textResponse.body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model,
  };
}
