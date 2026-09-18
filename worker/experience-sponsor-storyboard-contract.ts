import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { STORYBOARD_OUTPUT_POLICY } from "../src/model/output-storyboard-contract.ts";
import { readStoryboardExecutionOffer, STORYBOARD_TRANSFER } from "../src/model/output-storyboard-offer.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { createOutputFalImageContract, OUTPUT_FAL_PLANNING_MODEL, type OutputFalImageContract } from "./output-fal-image-contract.ts";
import { OPENAI_IMAGE_MODERATION_CONTRACT } from "./openai-image-route-contract.ts";
import { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** Separate from the five paid stages. These facts confer no transfer permission. */
export const STORYBOARD_SPONSOR_TRANSFER = freeze({
  planning: { provider: "openai", model: OUTPUT_FAL_PLANNING_MODEL, maximumCalls: 1, input: "authorized-document-context" },
  frames: { provider: "fal", model: "ideogram/v4", maximumCalls: 4, input: "adapted-frame-text", maximumReferences: 0 },
  moderation: { provider: "openai", api: OPENAI_IMAGE_MODERATION_CONTRACT.api, model: OPENAI_IMAGE_MODERATION_CONTRACT.model,
    maximumCalls: STORYBOARD_OUTPUT_POLICY.maximumFrameCalls * OPENAI_IMAGE_MODERATION_CONTRACT.maximumCalls,
    input: "exact-adapted-frame-text", coverage: OPENAI_IMAGE_MODERATION_CONTRACT.input },
  repairCalls: 0, automaticRetries: 0, disclosure: STORYBOARD_TRANSFER,
} as const);
type Call = { stage: string; provider: "openai" | "fal"; model: string; maximumMicrousd: number; maximumInputTokens: number; maximumOutputTokens: number };
/** Inert leaf version 1; global sponsor policy version 9 is reserved separately.
 * The 224000 native reservation includes a 128000 planning slice and 4×24000
 * media slices. It is not interchangeable with the planner context ceiling. */
export type SponsorStoryboardCampaignTemplate = {
  version: 1; family: "canonical-four-frame-storyboard@1"; appId: "storyboard"; recipeVersion: string; releaseDigest: string;
  outputKind: "storyboard"; inputMode: "authorized-document-text"; outputCount: 1; frameCount: 4;
  durationMs: 0; width: 1536; height: 1024; route: "document-storyboard-four-frames-manual-v1";
  maximumCalls: 5; maximumTokens: 224000; maximumMicrousd: number; calls: Call[];
  storyboardPolicy: typeof STORYBOARD_OUTPUT_POLICY; frameContract: OutputFalImageContract;
  pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION; transfer: typeof STORYBOARD_SPONSOR_TRANSFER;
  executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY;
};
export type SponsorStoryboardPlanningEvidence = {
  requestDigest: string; schemaDigest: string; contractDigest: string; maximumInputTokens: number; maximumOutputTokens: 4000;
  model: typeof OUTPUT_FAL_PLANNING_MODEL; store: false; serviceTier: "default"; cacheMode: "explicit"; reasoningEffort: "low";
};
export class SponsorStoryboardContractError extends Error {
  readonly code = "sponsor_storyboard_contract_invalid";
  constructor() { super("sponsor_storyboard_contract_invalid"); this.name = "SponsorStoryboardContractError"; }
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "frameCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumMicrousd", "calls", "storyboardPolicy", "frameContract", "pricingVersion", "transfer", "executionPolicy"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
function callsAt(input: number, frame: OutputFalImageContract): Call[] {
  return [{ stage: "planning:0:initial", provider: "openai", model: OUTPUT_FAL_PLANNING_MODEL,
    maximumMicrousd: estimateOpenAITextCallMaximumMicrousd(OUTPUT_FAL_PLANNING_MODEL, input, 4000), maximumInputTokens: input, maximumOutputTokens: 4000 },
  ...Array.from({ length: 4 }, (_, i): Call => ({ stage: `image:frame:${i + 1}`, provider: "fal", model: frame.model,
    maximumMicrousd: frame.maximumMicrousd, maximumInputTokens: 0, maximumOutputTokens: 0 }))];
}
function validTemplate(raw: unknown): raw is SponsorStoryboardCampaignTemplate {
  const frame = createOutputFalImageContract("ideogram/v4", "1536x1024");
  if (!frame || !keys(raw, templateKeys) || raw.version !== 1 || raw.family !== "canonical-four-frame-storyboard@1" || raw.appId !== "storyboard"
    || typeof raw.recipeVersion !== "string" || !/^storyboard@[1-9]\d{0,8}$/u.test(raw.recipeVersion) || !hash(raw.releaseDigest)
    || raw.outputKind !== "storyboard" || raw.inputMode !== "authorized-document-text" || raw.outputCount !== 1 || raw.frameCount !== 4
    || raw.durationMs !== 0 || raw.width !== 1536 || raw.height !== 1024 || raw.route !== "document-storyboard-four-frames-manual-v1"
    || raw.maximumCalls !== 5 || raw.maximumTokens !== 224000 || raw.pricingVersion !== OPENAI_TEXT_PRICING_VERSION
    || !same(raw.storyboardPolicy, STORYBOARD_OUTPUT_POLICY) || !same(raw.frameContract, frame)
    || !same(raw.transfer, STORYBOARD_SPONSOR_TRANSFER) || !same(raw.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY)) return false;
  const calls = callsAt(124000, frame);
  return same(raw.calls, calls) && raw.maximumMicrousd === calls.reduce((sum, call) => sum + call.maximumMicrousd, 0);
}

/** Finite review material only: no grant, issuance, provider, payer or read power. */
export function readSponsorStoryboardCampaignTemplate(raw: unknown): SponsorStoryboardCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorStoryboardContractError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorStoryboardCampaignTemplate);
}
export function recipeMatchesSponsorStoryboardTemplate(raw: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(raw).length || jsonIssues(recipe).length || !validTemplate(raw) || !keys(recipe, recipeKeys)) return false;
  return recipe.appId === raw.appId && recipe.recipeVersion === raw.recipeVersion && recipe.releaseDigest === raw.releaseDigest
    && recipe.outputKind === "storyboard" && recipe.provider === "fal" && recipe.model === raw.frameContract.model
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 0
    && recipe.width === 1536 && recipe.height === 1024 && recipe.maximumTokens === 224000
    && same(recipe.calls, { parsing: 0, planning: 1, render: 4, repair: 0 }) && Number.isSafeInteger(recipe.maximumMicrousd)
    && Number(recipe.maximumMicrousd) > 4 * raw.frameContract.maximumMicrousd && Number(recipe.maximumMicrousd) <= raw.maximumMicrousd;
}

/** Match actual native evidence. Hash-shaped caller data never supplies custody.
 * No frame digest is invented before the original planner response exists. */
export async function matchSponsorStoryboardTemplate(raw: unknown, actual: { recipe: unknown; offered: unknown; planning: unknown; transfer: unknown }): Promise<boolean> {
  if (jsonIssues(raw).length || jsonIssues(actual).length || !keys(actual, ["recipe", "offered", "planning", "transfer"])) return false;
  const template = JSON.parse(canonicalJson(raw)) as SponsorStoryboardCampaignTemplate;
  const captured = JSON.parse(canonicalJson(actual)) as typeof actual;
  if (!recipeMatchesSponsorStoryboardTemplate(template, captured.recipe) || !same(captured.transfer, template.transfer)) return false;
  const { recipe, planning } = captured, native = readStoryboardExecutionOffer(captured.offered);
  if (!native || native.offer.maximumTokens !== template.maximumTokens || !same(native.fal, template.frameContract) || native.contract.source.releaseHash !== template.releaseDigest
    || native.maximumMicrousd !== recipe.maximumMicrousd || await digest(native.offer) !== recipe.routeDigest
    || await digest(native.settings) !== recipe.settingsDigest || !same(native.calls, callsAt(Number(native.planner.maximumInputTokens), template.frameContract))) return false;
  return keys(planning, ["requestDigest", "schemaDigest", "contractDigest", "maximumInputTokens", "maximumOutputTokens", "model", "store", "serviceTier", "cacheMode", "reasoningEffort"])
    && hash(planning.schemaDigest) && planning.requestDigest === `sha256:${native.planner.requestDigest}`
    && planning.contractDigest === await digest(native.contract) && planning.maximumInputTokens === native.planner.maximumInputTokens
    && planning.maximumOutputTokens === 4000 && planning.model === OUTPUT_FAL_PLANNING_MODEL && planning.store === false
    && planning.serviceTier === "default" && planning.cacheMode === "explicit" && planning.reasoningEffort === "low";
}
