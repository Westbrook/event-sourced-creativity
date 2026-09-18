import { validateProviderImageSize } from "../src/model/image-format.ts";
import { hasKnownImageModelPricing, priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";

export const OUTPUT_IMAGE_MAX_PROMPT_BYTES = 32_000;
const PROMPT_TOKEN_OVERHEAD = 4_096;

/**
 * The official GPT Image 2 calculator maps quality and exact dimensions to output
 * tokens. This is an estimate, not a provider-enforced dollar limit. The Output
 * route reserves twice that estimate and records any reported overrun in full.
 * https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
 * Calculator verified 2026-08-27; no GPT Image 1 tile rule is reused for Image 2.
 */
export function outputImageBudget(model: string, size: string, promptBytes = OUTPUT_IMAGE_MAX_PROMPT_BYTES) {
  if (!["gpt-image-2", "gpt-image-2.5-sunburst"].includes(model) || !hasKnownImageModelPricing(model) || !validateProviderImageSize(size).valid) return null;
  if (!Number.isSafeInteger(promptBytes) || promptBytes < 0 || promptBytes > OUTPUT_IMAGE_MAX_PROMPT_BYTES) return null;
  const [width, height] = size.split("x").map(Number);
  const long = Math.max(width!, height!), short = Math.min(width!, height!);
  const longCells = 96; // high quality; this route does not authorize auto quality
  const shortCells = Math.round(longCells * short / long);
  const estimatedOutputTokens = Math.ceil(longCells * shortCells * (2_000_000 + width! * height!) / 4_000_000);
  const maximumOutputTokens = estimatedOutputTokens * 2;
  // UTF-8 bytes bound ordinary text tokenization; retain extra protocol headroom.
  const maximumInputTokens = promptBytes + PROMPT_TOKEN_OVERHEAD;
  const maximumMicrousd = priceImageUsageBreakdownMicrousd(model, {
    inputTokens: maximumInputTokens, textInputTokens: maximumInputTokens, imageInputTokens: 0,
    outputTokens: maximumOutputTokens, totalTokens: maximumInputTokens + maximumOutputTokens,
  }, false).totalMicrousd;
  return { version: "gpt-image-2-doc-calculator-2026-08-27", quality: "high" as const,
    maximumPromptBytes: OUTPUT_IMAGE_MAX_PROMPT_BYTES, maximumReferenceImages: 0,
    estimatedOutputTokens, maximumOutputTokens, maximumInputTokens, maximumMicrousd,
    allowanceCode: "output_native_image_allowance_verified",
    allowanceDescription: "UTF-8 prompt bytes plus protocol headroom, and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no additional request is allowed after an overrun or uncertain response." };
}
