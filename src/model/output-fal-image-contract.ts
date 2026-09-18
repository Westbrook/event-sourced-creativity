import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, IDEOGRAM_PROMPT_ADAPTER_VERSION, IDEOGRAM_PROMPT_MAX_CHARS } from "./fal-image-identity.ts";

export const OUTPUT_FAL_PLANNING_MODEL = "gpt-5.6-terra";
const VERSION = "output-fal-image-v1";
// Published standard ideogram/v4 QUALITY: $0.10/output MP plus $0.03 expansion.
// https://fal.ai/ideogram-4 (verified 2026-09-13). This is a published-rate
// estimate, not invoice precision or an assertion of provider billing rounding.
const PRICING_VERSION = "fal-ideogram-v4-quality-2026-09-13";
export function createOutputFalImageContract(model: string, size: string) {
  if (model !== "ideogram/v4" || !/^[1-9]\d{2,3}x[1-9]\d{2,3}$/u.test(size)) return null;
  const [width, height] = size.split("x").map(Number);
  // Intersection with the existing Fal adapter's custom-size validator.
  if (!width || !height || width < 512 || height < 512 || width > 3840 || height > 3840 || width % 16 || height % 16) return null;
  const imageOutputMicrousd = Math.ceil(width * height / 10), expansionMicrousd = 30_000;
  return Object.freeze({ version: VERSION, plannerModel: OUTPUT_FAL_PLANNING_MODEL, provider: "fal" as const, model: "ideogram/v4" as const,
    adapterId: FAL_IDEOGRAM_ADAPTER_ID, adapterVersion: FAL_IDEOGRAM_ADAPTER_VERSION,
    promptAdapterVersion: IDEOGRAM_PROMPT_ADAPTER_VERSION, promptMode: "expanded_plain" as const,
    captionStrategy: "production_director" as const, expansionModel: "Large" as const,
    renderingSpeed: "QUALITY" as const, acceleration: "none" as const, outputFormat: "png" as const,
    width, height, maximumReferences: 0, maximumPromptCharacters: IDEOGRAM_PROMPT_MAX_CHARS,
    pricingVersion: PRICING_VERSION, imageOutputMicrousd, expansionMicrousd,
    estimatedMicrousd: imageOutputMicrousd + expansionMicrousd,
    // Application allowance, not a provider-enforced price or invoice forecast.
    maximumMicrousd: Math.max(900_000, imageOutputMicrousd + expansionMicrousd) });
}
export type OutputFalImageContract = NonNullable<ReturnType<typeof createOutputFalImageContract>>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function readOutputFalImageContract(value: unknown): OutputFalImageContract | null {
  if (!record(value)) return null;
  const expected = createOutputFalImageContract(String(value.model), `${value.width}x${value.height}`);
  return expected && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, item]) => value[key] === item) ? expected : null;
}
export function outputFalImageCost(contract: OutputFalImageContract) {
  const checked = readOutputFalImageContract(contract); if (!checked) throw new Error("output_fal_contract_invalid");
  return { textInputMicrousd: checked.expansionMicrousd, textOutputMicrousd: 0, imageTextInputMicrousd: 0,
    imageInputMicrousd: 0, imageOutputMicrousd: checked.imageOutputMicrousd, totalMicrousd: checked.estimatedMicrousd };
}
function same(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  return record(actual) && record(expected) && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => same(actual[key], value));
}
/** Bind the actual adapted provider body, not the earlier canonical prompt. */
export async function captureOutputFalImageRequest(value: unknown, model: string, input: Record<string, unknown>,
  behavior: { promptMode: string; promptAdapterVersion: string; captionStrategy: string; adapterVersion: string }, clientRequestId: string) {
  const contract = readOutputFalImageContract(value), prompt = input.prompt;
  if (!contract || model !== contract.model || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(clientRequestId)
    || behavior.promptMode !== contract.promptMode || behavior.promptAdapterVersion !== contract.promptAdapterVersion
    || behavior.captionStrategy !== contract.captionStrategy || behavior.adapterVersion !== contract.adapterVersion
    || typeof prompt !== "string" || !prompt.trim() || prompt.length > contract.maximumPromptCharacters) throw new Error("output_fal_request_outside_contract");
  const body = { prompt, expansion_model: contract.expansionModel, image_size: { width: contract.width, height: contract.height },
    rendering_speed: contract.renderingSpeed, acceleration: contract.acceleration, num_images: 1, sync_mode: false,
    enable_safety_checker: true, output_format: contract.outputFormat };
  if (!same(input, body)) throw new Error("output_fal_request_outside_contract");
  const serialized = JSON.stringify(body);
  const bytes = new TextEncoder().encode(JSON.stringify({ contract, body: serialized }));
  const requestDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return Object.freeze({ body: serialized, contract, attempt: Object.freeze({ model: contract.model,
    maximumInputTokens: 0, maximumOutputTokens: 0, logicalCallKey: "image:initial", clientRequestId, requestDigest, falImage: contract }) });
}
