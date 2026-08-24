import type { WorkerEnv } from "./runtime";
import { buildReplayDevelopmentStages, replayDevelopmentSummary, type CreativeStudyKind, type ReplayDevelopmentStage } from "../src/model/replay-development.ts";

export const MICRO_USD_PER_USD = 1_000_000;
export const LIVE_REPLAY_COST_CONTINGENCY = 0.2;
export const LIVE_REPLAY_PRICING_VERSION = "openai-2026-07-30";

export type ReplayStreamSize = 1_000 | 10_000 | 50_000;
export type ReplayProviderCoverage = "automatic" | "minimal" | "representative" | "dense";
export type ReplayGenerationProfile = {
  targetEventCount: ReplayStreamSize;
  requestedCoverage: ReplayProviderCoverage;
  resolvedCoverage: Exclude<ReplayProviderCoverage, "automatic">;
  milestoneCount: number;
  imageCount: number;
  operations: number;
  studyCount: number;
  compositionCount: number;
  studyTypes: CreativeStudyKind[];
  stageLabels: string[];
  developmentStages: ReplayDevelopmentStage[];
};

type TokenRates = { input: number; output: number };
type ImageRates = { textInput: number; imageInput: number; output: number };
export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  textInputTokens?: number;
  imageInputTokens?: number;
};

export type ProviderCostBreakdown = {
  textInputMicrousd: number;
  textOutputMicrousd: number;
  imageTextInputMicrousd: number;
  imageInputMicrousd: number;
  imageOutputMicrousd: number;
  totalMicrousd: number;
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
  profile: ReplayGenerationProfile;
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

const STREAM_SIZES: ReplayStreamSize[] = [1_000, 10_000, 50_000];
const COVERAGES: ReplayProviderCoverage[] = ["automatic", "minimal", "representative", "dense"];

export function normalizeReplayStreamSize(value: unknown): ReplayStreamSize {
  const numeric = Number(value);
  return STREAM_SIZES.includes(numeric as ReplayStreamSize) ? numeric as ReplayStreamSize : 1_000;
}

export function normalizeReplayProviderCoverage(value: unknown): ReplayProviderCoverage {
  return COVERAGES.includes(value as ReplayProviderCoverage) ? value as ReplayProviderCoverage : "automatic";
}

export function replayGenerationProfile(eventCount: unknown = 1_000, providerCoverage: unknown = "automatic", studyTypes: unknown = []): ReplayGenerationProfile {
  const targetEventCount = normalizeReplayStreamSize(eventCount);
  const requestedCoverage = normalizeReplayProviderCoverage(providerCoverage);
  const automaticMilestones = targetEventCount === 50_000 ? 3 : targetEventCount === 10_000 ? 2 : 1;
  const minimumMilestones = requestedCoverage === "automatic" ? automaticMilestones : requestedCoverage === "dense" ? 3 : requestedCoverage === "representative" ? 2 : 1;
  const developmentStages = buildReplayDevelopmentStages(studyTypes, minimumMilestones);
  const milestoneCount = developmentStages.length;
  const resolvedCoverage = milestoneCount >= 3 ? "dense" : milestoneCount === 2 ? "representative" : "minimal";
  const development = replayDevelopmentSummary(developmentStages);
  return { targetEventCount, requestedCoverage, resolvedCoverage, milestoneCount, imageCount: milestoneCount * 6, operations: milestoneCount * 7, ...development, developmentStages };
}

const TEXT_RATES: Record<string, TokenRates> = {
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

/** Fail closed when an application spending ceiling cannot price the configured model. */
export const hasKnownTextModelPricing=(model:string)=>Object.hasOwn(TEXT_RATES,model);

const IMAGE_RATES: Record<string, ImageRates> = {
  "gpt-image-2": { textInput: 5, imageInput: 8, output: 30 },
};

const DEFAULT_TEXT_RATES: TokenRates = { input: 5, output: 30 };
const DEFAULT_IMAGE_RATES: ImageRates = { textInput: 5, imageInput: 8, output: 30 };
const asMicrousd = (tokens: number, dollarsPerMillion: number) => Math.ceil(Math.max(0, tokens) * dollarsPerMillion);
const textRates = (model: string) => TEXT_RATES[model] ?? DEFAULT_TEXT_RATES;
const imageRates = (model: string) => IMAGE_RATES[model] ?? DEFAULT_IMAGE_RATES;

export function priceTextUsageMicrousd(model: string, usage: ProviderUsage) {
  return priceTextUsageBreakdownMicrousd(model,usage).totalMicrousd;
}

export function priceImageUsageMicrousd(model: string, usage: ProviderUsage, hasImageInput: boolean) {
  return priceImageUsageBreakdownMicrousd(model,usage,hasImageInput).totalMicrousd;
}

export function priceTextUsageBreakdownMicrousd(model:string,usage:ProviderUsage):ProviderCostBreakdown {
  const rates=textRates(model);const textInputMicrousd=asMicrousd(usage.inputTokens,rates.input);const textOutputMicrousd=asMicrousd(usage.outputTokens,rates.output);
  return{textInputMicrousd,textOutputMicrousd,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:0,totalMicrousd:textInputMicrousd+textOutputMicrousd};
}

export function priceImageUsageBreakdownMicrousd(model:string,usage:ProviderUsage,hasImageInput:boolean):ProviderCostBreakdown {
  const rates = imageRates(model);
  const detailedInput = Math.max(0, Number(usage.textInputTokens ?? 0)) + Math.max(0, Number(usage.imageInputTokens ?? 0));
  const unknownInput = Math.max(0, usage.inputTokens - detailedInput);
  const textInput = Math.max(0, Number(usage.textInputTokens ?? 0)) + (hasImageInput ? 0 : unknownInput);
  const imageInput = Math.max(0, Number(usage.imageInputTokens ?? 0)) + (hasImageInput ? unknownInput : 0);
  const imageTextInputMicrousd=asMicrousd(textInput,rates.textInput);const imageInputMicrousd=asMicrousd(imageInput,rates.imageInput);const imageOutputMicrousd=asMicrousd(usage.outputTokens,rates.output);
  return{textInputMicrousd:0,textOutputMicrousd:0,imageTextInputMicrousd,imageInputMicrousd,imageOutputMicrousd,totalMicrousd:imageTextInputMicrousd+imageInputMicrousd+imageOutputMicrousd};
}

export type FalIdeogramRenderingSpeed = "TURBO" | "BALANCED" | "QUALITY";

/**
 * fal bills Ideogram V4 per output megapixel. Keep this separate from token
 * pricing so provider receipts never pretend a pixel charge was token usage.
 */
export function priceFalIdeogramImageBreakdownMicrousd(model:string,width:number,height:number,speed:FalIdeogramRenderingSpeed,expansionModel:"None"|"Medium"|"Large"="Medium"):ProviderCostBreakdown {
  const standardRates:Record<FalIdeogramRenderingSpeed,number>={TURBO:.0075,BALANCED:.015,QUALITY:.025};
  const fastRates:Record<FalIdeogramRenderingSpeed,number>={TURBO:.00525,BALANCED:.0105,QUALITY:.0175};
  const dollarsPerMegapixel=(model.endsWith("/fast")?fastRates:standardRates)[speed];
  const megapixels=Math.max(0,width)*Math.max(0,height)/1_000_000;
  const imageOutputMicrousd=Math.ceil(megapixels*dollarsPerMegapixel*1_000_000);const textInputMicrousd=expansionModel==="None"?0:30_000;
  return{textInputMicrousd,textOutputMicrousd:0,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd,totalMicrousd:textInputMicrousd+imageOutputMicrousd};
}

function line(key: ReplayCostLine["key"], label: string, operations: number, estimatedMicrousd: number): ReplayCostLine {
  return { key, label, operations, estimatedMicrousd: Math.ceil(estimatedMicrousd) };
}

export function estimateLiveReplayCost(env: Pick<WorkerEnv, "OPENAI_MODEL" | "OPENAI_IMAGE_MODEL">, seed = "", options: { eventCount?: unknown; providerCoverage?: unknown; studyTypes?: unknown } = {}): ReplayCostEstimate {
  const plannerModel = env.OPENAI_MODEL ?? "gpt-5.6-terra";
  const imageModel = env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const planner = textRates(plannerModel);
  const image = imageRates(imageModel);
  const profile = replayGenerationProfile(options.eventCount, options.providerCoverage, options.studyTypes);

  // The planner schema, complete block vocabulary, and six form-specific output
  // plans dominate input size. The optional seed adds at most 1,200 characters,
  // estimated conservatively at 4 chars/token. Output reserves room for the
  // complete creative arc and distinct beats for every deliverable form.
  const plannerInputTokens = 7_500 + Math.ceil(seed.trim().length / 4);
  const plannerOutputTokens = 6_500;

  // GPT Image 2 currently reports about 196 output tokens for a minimum-size
  // low-quality square and 5,500 for a 1536x1024 high-quality image.
  const lowOutputTokens = 196;
  const highOutputTokens = 5_500;
  const referenceInputTokens = 4_354;
  // Every stage uses one reference for its draft and two inputs for each fan
  // member. Composition stages additionally receive one locked preferred image
  // from every selected study for each of their four fan members.
  const compositionStudyInputs = profile.compositionCount * profile.studyCount * 4;
  const referenceImageInputs = 9 * profile.milestoneCount + compositionStudyInputs;
  const imageInputTokens = referenceInputTokens * referenceImageInputs;
  const imageTextInputTokens = 29_350 * profile.milestoneCount;

  const planningCost = asMicrousd(plannerInputTokens, planner.input) + asMicrousd(plannerOutputTokens, planner.output);
  const referenceCost = asMicrousd(350, image.textInput) + asMicrousd(lowOutputTokens, image.output);
  const previewCost = asMicrousd(5_000, image.textInput) + asMicrousd(referenceInputTokens, image.imageInput) + asMicrousd(lowOutputTokens, image.output);
  const baseFanCost = asMicrousd(24_000, image.textInput) + asMicrousd(referenceInputTokens * 8, image.imageInput) + asMicrousd(highOutputTokens * 4, image.output);
  const compositionStudyInputCost = asMicrousd(referenceInputTokens * compositionStudyInputs, image.imageInput);
  const lines = [
    line("planning", `Structured plans · ${plannerModel}`, profile.milestoneCount, planningCost * profile.milestoneCount),
    line("reference", "Reference acquisition ceiling · low-quality generation fallback", profile.milestoneCount, referenceCost * profile.milestoneCount),
    line("preview", "Low-quality reference-guided drafts", profile.milestoneCount, previewCost * profile.milestoneCount),
    line("fan", profile.studyCount ? "High-quality study and composition fans · locked study pixels included in compositions" : "High-quality reference-guided fan images", 4 * profile.milestoneCount, baseFanCost * profile.milestoneCount + compositionStudyInputCost),
  ];
  const estimatedMicrousd = lines.reduce((sum, item) => sum + item.estimatedMicrousd, 0);
  const authorizationMicrousd = Math.ceil(estimatedMicrousd * (1 + LIVE_REPLAY_COST_CONTINGENCY));
  return {
    currency: "USD",
    pricingVersion: LIVE_REPLAY_PRICING_VERSION,
    plannerModel,
    imageModel,
    operations: profile.operations,
    estimatedMicrousd,
    contingencyRate: LIVE_REPLAY_COST_CONTINGENCY,
    authorizationMicrousd,
    profile,
    lines,
    assumptions: { plannerInputTokens: plannerInputTokens * profile.milestoneCount, plannerOutputTokens: plannerOutputTokens * profile.milestoneCount, imageTextInputTokens, imageInputTokens, imageOutputTokens: (lowOutputTokens * 2 + highOutputTokens * 4) * profile.milestoneCount, referenceImageInputs },
  };
}

export function formatMicrousd(microusd: number) {
  return `$${(Math.max(0, microusd) / MICRO_USD_PER_USD).toFixed(2)}`;
}
