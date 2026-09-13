import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { parseVideoOutputContract, type VideoOutputContract } from "../src/model/output-video-contract.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";

export const VIDEO_PLANNER_MODEL = "gpt-5.6-terra";
export const VIDEO_PLANNER_MAX_OUTPUT_TOKENS = 3000;
export type VideoPlannerExecution = Readonly<{ contract: VideoOutputContract; requestDigest: string; maximumInputTokens: number }>;
export type VideoPlannerAttempt = Readonly<{ contract: VideoOutputContract; requestBody: string }>;
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key]!, "value"));
};
export function readVideoPlannerExecution(value: unknown): VideoPlannerExecution | null {
  if (!exact(value, ["contract", "requestDigest", "maximumInputTokens"])) return null;
  const contract = parseVideoOutputContract(value.contract);
  return contract && typeof value.requestDigest === "string" && /^[a-f0-9]{64}$/u.test(value.requestDigest)
    && Number.isSafeInteger(value.maximumInputTokens) && Number(value.maximumInputTokens) >= 4096 && Number(value.maximumInputTokens) <= 61000
    ? freeze({ contract, requestDigest: value.requestDigest, maximumInputTokens: Number(value.maximumInputTokens) }) : null;
}
/** Capture the actual compiler wire, never re-create a substitute prompt for a
 * quote. One initial planning call; no paid content repair or editorial rewrite. */
export async function captureVideoPlannerRequest(value: unknown, requestBody: string, clientRequestId: string) {
  const contract = parseVideoOutputContract(value), bytes = typeof requestBody === "string" ? new TextEncoder().encode(requestBody).byteLength : 0;
  if (!contract || !bytes || bytes + 4096 > 61000 || !/^forma-video-[A-Za-z0-9._:-]{1,150}$/u.test(clientRequestId)) throw new Error("output_video_planner_request_invalid");
  const wire: unknown = JSON.parse(requestBody);
  if (!exact(wire, ["model", "instructions", "input", "text", "reasoning", "max_output_tokens", "store", "safety_identifier", "service_tier", "prompt_cache_options"])
    || wire.model !== VIDEO_PLANNER_MODEL || wire.max_output_tokens !== VIDEO_PLANNER_MAX_OUTPUT_TOKENS || wire.store !== false || wire.service_tier !== "default"
    || typeof wire.input !== "string" || typeof wire.instructions !== "string" || !wire.instructions.trim() || !wire.input.trim()
    || typeof wire.safety_identifier !== "string" || !/^forma_[a-f0-9]{32}$/u.test(wire.safety_identifier)
    || canonicalJson(wire.reasoning) !== canonicalJson({ effort: "low" }) || canonicalJson(wire.prompt_cache_options) !== canonicalJson({ mode: "explicit" })
    || !exact(wire.text, ["verbosity", "format"]) || wire.text.verbosity !== "medium" || !exact(wire.text.format, ["type", "name", "strict", "schema"])
    || wire.text.format.type !== "json_schema" || wire.text.format.name !== "document_video" || wire.text.format.strict !== true
    || !wire.text.format.schema || typeof wire.text.format.schema !== "object") throw new Error("output_video_planner_request_invalid");
  const context = JSON.parse(wire.input) as Record<string, unknown>;
  const schema = wire.text.format.schema as { properties?: { items?: { minItems?: number; maxItems?: number } } };
  if (!context || typeof context !== "object" || canonicalJson(context.video) !== canonicalJson({ duration_seconds: 4,
    frame: contract.frameSize === "1280x720" ? "landscape" : "portrait", resolution: "480p", reference_count: 1,
    aspect_ratio: contract.frameSize === "1280x720" ? "16:9" : "9:16", audio_mode: "silent", generate_audio: false })
    || schema.properties?.items?.minItems !== 1 || schema.properties.items.maxItems !== 1) throw new Error("output_video_planner_request_invalid");
  const requestDigest = await hash(requestBody), maximumInputTokens = bytes + 4096;
  const attempt: ProviderAttemptPreflight = freeze({ model: VIDEO_PLANNER_MODEL, maximumInputTokens, maximumOutputTokens: VIDEO_PLANNER_MAX_OUTPUT_TOKENS,
    clientRequestId, logicalCallKey: "planning:0:initial", requestDigest, videoPlanning: { contract, requestBody } });
  return freeze({ contract, requestBody, requestDigest, maximumInputTokens, maximumOutputTokens: VIDEO_PLANNER_MAX_OUTPUT_TOKENS, attempt });
}
export async function assertVideoPlannerAttempt(expectedValue: unknown, attempt: ProviderAttemptPreflight) {
  const expected = readVideoPlannerExecution(expectedValue);
  if (!expected || !attempt.videoPlanning || canonicalJson(expected.contract) !== canonicalJson(attempt.videoPlanning.contract)) throw new Error("output_video_planner_not_authorized");
  const captured = await captureVideoPlannerRequest(expected.contract, attempt.videoPlanning.requestBody, attempt.clientRequestId);
  if (captured.requestDigest !== expected.requestDigest || captured.maximumInputTokens !== expected.maximumInputTokens
    || canonicalJson(captured.attempt) !== canonicalJson(attempt)) throw new Error("output_video_planner_not_authorized");
}
