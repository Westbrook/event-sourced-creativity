import { validateProviderImageSize } from "../src/model/image-format.ts";
import { hasKnownImageModelPricing, priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";

export const OUTPUT_IMAGE_MAX_PROMPT_BYTES = 32_000;
const PROMPT_TOKEN_OVERHEAD = 4_096;
const SUNBURST_CALCULATOR = Object.freeze({
  url: "https://developers.openai.com/_astro/GptImageTokenCalculator.react.DVgudqu4.js",
  sha256: "db420638507abf236e5535e83759631734d4b47837eb2edf1f53af2461b0d8fa",
  capturedAt: "2026-09-18T01:40:08Z",
  modelFamily: "gpt-image-2.5", qualityBase: 48,
});

/**
 * The model-specific official calculators map high quality and exact dimensions to output
 * tokens. This is an estimate, not a provider-enforced dollar limit. The Output
 * route reserves twice that estimate and records any reported overrun in full.
 * https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
 * Image 2's 2026-08-27 calculation/provenance is retained unchanged. Sunburst uses
 * the separately captured Image 2.5 calculator; neither qualifies reference input.
 */
export function outputImageBudget(model: string, size: string, promptBytes = OUTPUT_IMAGE_MAX_PROMPT_BYTES) {
  const sunburst = model === "gpt-image-2.5-sunburst";
  if ((!sunburst && model !== "gpt-image-2") || !hasKnownImageModelPricing(model) || !validateProviderImageSize(size).valid) return null;
  if (!Number.isSafeInteger(promptBytes) || promptBytes < 0 || promptBytes > OUTPUT_IMAGE_MAX_PROMPT_BYTES) return null;
  const [width, height] = size.split("x").map(Number);
  const long = Math.max(width!, height!), short = Math.min(width!, height!);
  const longCells = sunburst ? SUNBURST_CALCULATOR.qualityBase : 96;
  // Preserve shipped JS evaluation order and exact-half ties-to-even for Sunburst.
  // Algebraic/rational rewrites differ at floating-point boundaries (1536x944).
  const scaledShort = longCells / (long / short), lower = Math.floor(scaledShort);
  const shortCells = sunburst
    ? (scaledShort - lower === .5 ? lower + lower % 2 : Math.round(scaledShort))
    : Math.round(longCells * short / long);
  const estimatedOutputTokens = Math.ceil(longCells * shortCells * (2_000_000 + width! * height!) / 4_000_000);
  const maximumOutputTokens = estimatedOutputTokens * 2;
  // Existing application input allowance; the output calculator does not prove it.
  const maximumInputTokens = promptBytes + PROMPT_TOKEN_OVERHEAD;
  const maximumMicrousd = priceImageUsageBreakdownMicrousd(model, {
    inputTokens: maximumInputTokens, textInputTokens: maximumInputTokens, imageInputTokens: 0,
    outputTokens: maximumOutputTokens, totalTokens: maximumInputTokens + maximumOutputTokens,
  }, false).totalMicrousd;
  return { version: sunburst ? "gpt-image-2.5-sunburst-doc-calculator-2026-09-18" : "gpt-image-2-doc-calculator-2026-08-27",
    ...(sunburst ? { calculatorSource: SUNBURST_CALCULATOR } : {}), quality: "high" as const,
    maximumPromptBytes: OUTPUT_IMAGE_MAX_PROMPT_BYTES, maximumReferenceImages: 0,
    estimatedOutputTokens, maximumOutputTokens, maximumInputTokens, maximumMicrousd,
    allowanceCode: "output_native_image_allowance_verified",
    allowanceDescription: "UTF-8 prompt bytes plus protocol headroom, and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no additional request is allowed after an overrun or uncertain response." };
}
