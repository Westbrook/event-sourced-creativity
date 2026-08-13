import type { WorkerEnv } from "./runtime";

export const MICRO_USD_PER_USD = 1_000_000;
export const LIVE_REPLAY_COST_CONTINGENCY = 0.2;
export const LIVE_REPLAY_PRICING_VERSION = "openai-2026-07-30";

type TokenRates = { input: number; output: number };
type ImageRates = { textInput: number; imageInput: number; output: number };
export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  textInputTokens?: number;
  imageInputTokens?: number;
};

export type ReplayCostLine = {
  key: "planning" | "reference" | "preview" | "fan";
  label: string;
  operations: number;
  estimatedMicrousd: number;
};

export type ReplayCostEstimate = {
  currency: "USD";
  pricingVersion: string;
  plannerModel: string;
  imageModel: string;
  operations: number;
  estimatedMicrousd: number;
  contingencyRate: number;
  authorizationMicrousd: number;
  lines: ReplayCostLine[];
  assumptions: {
    plannerInputTokens: number;
    plannerOutputTokens: number;
    imageTextInputTokens: number;
    imageInputTokens: number;
    imageOutputTokens: number;
    referenceImageInputs: number;
  };
};

const TEXT_RATES: Record<string, TokenRates> = {
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

const IMAGE_RATES: Record<string, ImageRates> = {
  "gpt-image-2": { textInput: 5, imageInput: 8, output: 30 },
};

const DEFAULT_TEXT_RATES: TokenRates = { input: 5, output: 30 };
const DEFAULT_IMAGE_RATES: ImageRates = { textInput: 5, imageInput: 8, output: 30 };
const asMicrousd = (tokens: number, dollarsPerMillion: number) => Math.ceil(Math.max(0, tokens) * dollarsPerMillion);
const textRates = (model: string) => TEXT_RATES[model] ?? DEFAULT_TEXT_RATES;
const imageRates = (model: string) => IMAGE_RATES[model] ?? DEFAULT_IMAGE_RATES;

export function priceTextUsageMicrousd(model: string, usage: ProviderUsage) {
  const rates = textRates(model);
  return asMicrousd(usage.inputTokens, rates.input) + asMicrousd(usage.outputTokens, rates.output);
}

export function priceImageUsageMicrousd(model: string, usage: ProviderUsage, hasImageInput: boolean) {
  const rates = imageRates(model);
  const detailedInput = Math.max(0, Number(usage.textInputTokens ?? 0)) + Math.max(0, Number(usage.imageInputTokens ?? 0));
  const unknownInput = Math.max(0, usage.inputTokens - detailedInput);
  const textInput = Math.max(0, Number(usage.textInputTokens ?? 0)) + (hasImageInput ? 0 : unknownInput);
  const imageInput = Math.max(0, Number(usage.imageInputTokens ?? 0)) + (hasImageInput ? unknownInput : 0);
  return asMicrousd(textInput, rates.textInput) + asMicrousd(imageInput, rates.imageInput) + asMicrousd(usage.outputTokens, rates.output);
}

function line(key: ReplayCostLine["key"], label: string, operations: number, estimatedMicrousd: number): ReplayCostLine {
  return { key, label, operations, estimatedMicrousd: Math.ceil(estimatedMicrousd) };
}

export function estimateLiveReplayCost(env: Pick<WorkerEnv, "OPENAI_MODEL" | "OPENAI_IMAGE_MODEL">, seed = ""): ReplayCostEstimate {
  const plannerModel = env.OPENAI_MODEL ?? "gpt-5.6-terra";
  const imageModel = env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const planner = textRates(plannerModel);
  const image = imageRates(imageModel);

  // The planner schema and block vocabulary dominate input size. The optional
  // seed adds at most 1,200 characters, estimated conservatively at 4 chars/token.
  const plannerInputTokens = 5_500 + Math.ceil(seed.trim().length / 4);
  const plannerOutputTokens = 4_200;

  // GPT Image 2 currently reports about 196 output tokens for a minimum-size
  // low-quality square and 5,500 for a 1536x1024 high-quality image.
  const lowOutputTokens = 196;
  const highOutputTokens = 5_500;
  const referenceInputTokens = 4_354;
  const referenceImageInputs = 9; // one draft edit + two inputs for each of four fan edits
  const imageInputTokens = referenceInputTokens * referenceImageInputs;
  const imageTextInputTokens = 29_350;

  const planningCost = asMicrousd(plannerInputTokens, planner.input) + asMicrousd(plannerOutputTokens, planner.output);
  const referenceCost = asMicrousd(350, image.textInput) + asMicrousd(lowOutputTokens, image.output);
  const previewCost = asMicrousd(5_000, image.textInput) + asMicrousd(referenceInputTokens, image.imageInput) + asMicrousd(lowOutputTokens, image.output);
  const fanCost = asMicrousd(imageTextInputTokens - 5_350, image.textInput) + asMicrousd(referenceInputTokens * 8, image.imageInput) + asMicrousd(highOutputTokens * 4, image.output);
  const lines = [
    line("planning", `Structured plan · ${plannerModel}`, 1, planningCost),
    line("reference", "Low-quality synthetic reference", 1, referenceCost),
    line("preview", "Low-quality reference-guided draft", 1, previewCost),
    line("fan", "Four high-quality reference-guided fan images", 4, fanCost),
  ];
  const estimatedMicrousd = lines.reduce((sum, item) => sum + item.estimatedMicrousd, 0);
  const authorizationMicrousd = Math.ceil(estimatedMicrousd * (1 + LIVE_REPLAY_COST_CONTINGENCY));
  return {
    currency: "USD",
    pricingVersion: LIVE_REPLAY_PRICING_VERSION,
    plannerModel,
    imageModel,
    operations: 7,
    estimatedMicrousd,
    contingencyRate: LIVE_REPLAY_COST_CONTINGENCY,
    authorizationMicrousd,
    lines,
    assumptions: { plannerInputTokens, plannerOutputTokens, imageTextInputTokens, imageInputTokens, imageOutputTokens: lowOutputTokens * 2 + highOutputTokens * 4, referenceImageInputs },
  };
}

export function formatMicrousd(microusd: number) {
  return `$${(Math.max(0, microusd) / MICRO_USD_PER_USD).toFixed(2)}`;
}
