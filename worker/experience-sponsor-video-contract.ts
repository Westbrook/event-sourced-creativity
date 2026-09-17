import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readVideoExecutionOffer } from "../src/model/output-video-offer.ts";
import { VIDEO_OUTPUT_POLICY } from "../src/model/output-video-contract.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { OUTPUT_VIDEO_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { OUTPUT_VIDEO_TRANSPORT, outputVideoMediaPrice } from "./output-video-execution.ts";
import { VIDEO_PLANNER_MODEL } from "./output-video-planner.ts";
import { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** Inert leaf version. Future shared policy V7 is reserved, not implemented. */
export type SponsorVideoCampaignTemplate = {
  version: 1; family: "canonical-owned-still-video@1"; appId: "video"; recipeVersion: string; releaseDigest: string;
  outputKind: "video"; inputMode: "authorized-document-one-owned-still"; outputCount: 1; durationMs: 4000; width: 0; height: 0;
  route: "document-video-owned-still-four-seconds-manual-v1"; maximumCalls: 2; maximumTokens: 152000;
  maximumInputTokens: 61000; maximumOutputTokens: 3000; maximumMicrousd: number;
  plannerModel: typeof VIDEO_PLANNER_MODEL; videoModel: typeof OUTPUT_VIDEO_TRANSPORT.model;
  contract: typeof VIDEO_OUTPUT_POLICY; frameSizes: ["1280x720", "720x1280"];
  maximumReferenceBytes: 31457280; maximumResultBytes: 24000000;
  referenceMimeTypes: ["image/png", "image/jpeg", "image/webp"];
  pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION; videoPricingVersion: string;
  adapterVersion: "2.0.0"; promptAdapterVersion: "1.1.0";
  transport: typeof OUTPUT_VIDEO_TRANSPORT;
  cachePolicy: "disabled-explicit"; reasoningEffort: "low"; executionPolicy: typeof OUTPUT_VIDEO_EXECUTION_POLICY;
};
export class SponsorVideoContractError extends Error {
  readonly code = "sponsor_video_contract_invalid";
  constructor() { super("sponsor_video_contract_invalid"); this.name = "SponsorVideoContractError"; }
}
const keys = (v: unknown, names: readonly string[]): v is Record<string, unknown> => record(v) && exactKeys(v, names);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumInputTokens", "maximumOutputTokens", "maximumMicrousd", "plannerModel", "videoModel", "contract", "frameSizes", "maximumReferenceBytes", "maximumResultBytes", "referenceMimeTypes", "pricingVersion", "videoPricingVersion", "adapterVersion", "promptAdapterVersion", "transport", "cachePolicy", "reasoningEffort", "executionPolicy"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
const maximumCost = (input: number) => estimateOpenAITextCallMaximumMicrousd(VIDEO_PLANNER_MODEL, input, 3000) + outputVideoMediaPrice().maximumMicrousd;
function validTemplate(v: unknown): v is SponsorVideoCampaignTemplate {
  return keys(v, templateKeys) && v.version === 1 && v.family === "canonical-owned-still-video@1" && v.appId === "video"
    && typeof v.recipeVersion === "string" && /^video@[1-9]\d{0,8}$/u.test(v.recipeVersion) && hash(v.releaseDigest)
    && v.outputKind === "video" && v.inputMode === "authorized-document-one-owned-still" && v.outputCount === 1 && v.durationMs === 4000
    && v.width === 0 && v.height === 0 && v.route === "document-video-owned-still-four-seconds-manual-v1"
    && v.maximumCalls === 2 && v.maximumTokens === 152000 && v.maximumInputTokens === 61000 && v.maximumOutputTokens === 3000
    && v.maximumMicrousd === maximumCost(61000) && v.plannerModel === VIDEO_PLANNER_MODEL && v.videoModel === OUTPUT_VIDEO_TRANSPORT.model
    && same(v.contract, VIDEO_OUTPUT_POLICY) && same(v.frameSizes, ["1280x720", "720x1280"])
    && v.maximumReferenceBytes === VIDEO_ADAPTER_CONTRACT.maxReferenceBytes && v.maximumResultBytes === OUTPUT_VIDEO_TRANSPORT.maximumResultBytes
    && same(v.referenceMimeTypes, ["image/png", "image/jpeg", "image/webp"])
    && v.pricingVersion === OPENAI_TEXT_PRICING_VERSION && v.videoPricingVersion === outputVideoMediaPrice().pricingVersion
    && v.adapterVersion === VIDEO_ADAPTER_CONTRACT.adapterVersion && v.promptAdapterVersion === VIDEO_ADAPTER_CONTRACT.promptAdapterVersion
    && same(v.transport, OUTPUT_VIDEO_TRANSPORT)
    && v.cachePolicy === "disabled-explicit" && v.reasoningEffort === "low" && same(v.executionPolicy, OUTPUT_VIDEO_EXECUTION_POLICY);
}
/** Review material only: no source, payer, dispatch or read capability. */
export function readSponsorVideoCampaignTemplate(raw: unknown): SponsorVideoCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorVideoContractError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorVideoCampaignTemplate);
}
export function recipeMatchesSponsorVideoTemplate(raw: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(raw).length || jsonIssues(recipe).length || !validTemplate(raw) || !keys(recipe, recipeKeys)) return false;
  return recipe.appId === raw.appId && recipe.recipeVersion === raw.recipeVersion && recipe.releaseDigest === raw.releaseDigest
    && recipe.outputKind === "video" && recipe.provider === "fal" && recipe.model === raw.videoModel
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 4000
    && recipe.width === 0 && recipe.height === 0 && recipe.maximumTokens === 152000
    && same(recipe.calls, { parsing: 0, planning: 1, render: 1, repair: 0 })
    && Number.isSafeInteger(recipe.maximumMicrousd) && Number(recipe.maximumMicrousd) >= maximumCost(4096) && Number(recipe.maximumMicrousd) <= raw.maximumMicrousd;
}
/** The native reader supplies actuals. A matching DTO is never authority. */
export async function matchSponsorVideoTemplate(raw: unknown, actual: { recipe: unknown; offered: unknown }): Promise<boolean> {
  if (jsonIssues(raw).length || jsonIssues(actual).length || !keys(actual, ["recipe", "offered"])) return false;
  const template = JSON.parse(canonicalJson(raw)) as SponsorVideoCampaignTemplate;
  const captured = JSON.parse(canonicalJson(actual)) as { recipe: unknown; offered: unknown };
  if (!recipeMatchesSponsorVideoTemplate(template, captured.recipe)) return false;
  const recipe = captured.recipe, offer = readVideoExecutionOffer(captured.offered);
  if (!offer || offer.maximumMicrousd !== recipe.maximumMicrousd || offer.maximumMicrousd !== maximumCost(Number(offer.planner.maximumInputTokens))
    || await digest(captured.offered) !== recipe.routeDigest || await digest(offer.settings) !== recipe.settingsDigest) return false;
  return offer.calls[0]!.maximumMicrousd === estimateOpenAITextCallMaximumMicrousd(VIDEO_PLANNER_MODEL, Number(offer.planner.maximumInputTokens), 3000)
    && offer.calls[1]!.maximumMicrousd === outputVideoMediaPrice().maximumMicrousd;
}
