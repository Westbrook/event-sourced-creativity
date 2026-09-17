import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SHORT_STORY_NARRATIVE_CONTRACT, parseShortStoryNarrativeContract, type ShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { OUTPUT_NARRATIVE_MODEL, readOutputNarrativeExecution } from "./output-narrative-request.ts";
import { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** Inert, namespaced contract; version 1 here is not a sponsor policy version.
 * The source-dependent native quote remains exact inside each envelope. */
export type SponsorStoryCampaignTemplate = {
  version: 1; family: "canonical-short-story@1"; appId: "short-story"; recipeVersion: string; releaseDigest: string;
  outputKind: "short_story"; inputMode: "authorized-document-text"; outputCount: 1; durationMs: 0; width: 0; height: 0;
  route: "document-short-story-manual-v1"; maximumCalls: 1; maximumTokens: 128000;
  maximumInputTokens: 122000; maximumOutputTokens: 6000; maximumMicrousd: number;
  call: { stage: "planning:0:initial"; provider: "openai"; model: typeof OUTPUT_NARRATIVE_MODEL };
  narrativeContract: ShortStoryNarrativeContract; pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION;
  cachePolicy: "disabled-explicit"; reasoningEffort: "low"; executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY;
};
export class SponsorStoryContractError extends Error {
  readonly code = "sponsor_story_contract_invalid";
  constructor() { super("sponsor_story_contract_invalid"); this.name = "SponsorStoryContractError"; }
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumInputTokens", "maximumOutputTokens", "maximumMicrousd", "call", "narrativeContract", "pricingVersion", "cachePolicy", "reasoningEffort", "executionPolicy"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
const maximumCost = (input: number) => Math.max(1_000_000, estimateOpenAITextCallMaximumMicrousd(OUTPUT_NARRATIVE_MODEL, input, 6000));
function validTemplate(raw: unknown): raw is SponsorStoryCampaignTemplate {
  return keys(raw, templateKeys) && raw.version === 1 && raw.family === "canonical-short-story@1" && raw.appId === "short-story"
    && typeof raw.recipeVersion === "string" && /^short-story@[1-9]\d{0,8}$/u.test(raw.recipeVersion) && hash(raw.releaseDigest)
    && raw.outputKind === "short_story" && raw.inputMode === "authorized-document-text" && raw.outputCount === 1
    && raw.durationMs === 0 && raw.width === 0 && raw.height === 0 && raw.route === "document-short-story-manual-v1"
    && raw.maximumCalls === 1 && raw.maximumTokens === 128000 && raw.maximumInputTokens === 122000 && raw.maximumOutputTokens === 6000
    && raw.maximumMicrousd === maximumCost(122000) && same(raw.call, { stage: "planning:0:initial", provider: "openai", model: OUTPUT_NARRATIVE_MODEL })
    && parseShortStoryNarrativeContract(raw.narrativeContract) !== null && raw.pricingVersion === OPENAI_TEXT_PRICING_VERSION
    && raw.cachePolicy === "disabled-explicit" && raw.reasoningEffort === "low" && same(raw.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY);
}

/** Finite review material only. No enrollment, provider capability or permission. */
export function readSponsorStoryCampaignTemplate(raw: unknown): SponsorStoryCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorStoryContractError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorStoryCampaignTemplate);
}

export function recipeMatchesSponsorStoryTemplate(raw: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(raw).length || jsonIssues(recipe).length || !validTemplate(raw) || !keys(recipe, recipeKeys)) return false;
  return recipe.appId === raw.appId && recipe.recipeVersion === raw.recipeVersion && recipe.releaseDigest === raw.releaseDigest
    && recipe.outputKind === raw.outputKind && recipe.provider === raw.call.provider && recipe.model === raw.call.model
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 0 && recipe.width === 0 && recipe.height === 0
    && same(recipe.calls, { parsing: 0, planning: 1, render: 0, repair: 0 }) && recipe.maximumTokens === raw.maximumTokens
    && Number.isSafeInteger(recipe.maximumMicrousd) && Number(recipe.maximumMicrousd) >= 1_000_000 && Number(recipe.maximumMicrousd) <= raw.maximumMicrousd;
}

/** The caller must obtain actuals through the native reader. This pure match is
 * not an authority: source, principal, quote and exact digest checks live there.
 * The cap is fixed, while source-derived token/cost actuals are never replaced. */
export async function matchSponsorStoryTemplate(raw: unknown, actual: { recipe: unknown; offered: unknown }): Promise<boolean> {
  if (jsonIssues(raw).length || jsonIssues(actual).length || !keys(actual, ["recipe", "offered"])) return false;
  // Capture once before hashing/native asynchronous validation.
  const template = JSON.parse(canonicalJson(raw)) as SponsorStoryCampaignTemplate;
  const captured = JSON.parse(canonicalJson(actual)) as { recipe: unknown; offered: unknown };
  if (!recipeMatchesSponsorStoryTemplate(template, captured.recipe)) return false;
  const recipe = captured.recipe, offered = captured.offered;
  if (!keys(offered, ["targetId", "available", "reasonCode", "reason", "reasonValues", "transferCode", "provider", "model", "route", "maximumMicrousd", "maximumTokens", "maximumCalls", "settings", "transferDescription"])
    || typeof offered.targetId !== "string" || !offered.targetId || offered.available !== true || offered.reasonCode !== "output_narrative_ready"
    || offered.transferCode !== "output_transfer_narrative_after_authorization" || offered.provider !== "openai" || offered.model !== template.call.model
    || offered.route !== template.route || offered.maximumCalls !== 1 || offered.maximumTokens !== 128000 || offered.maximumMicrousd !== recipe.maximumMicrousd
    || !keys(offered.settings, ["kind", "payload", "calls", "executionPolicy"])) return false;
  if (await digest(offered) !== recipe.routeDigest || await digest(offered.settings) !== recipe.settingsDigest) return false;
  const settings = offered.settings, payload = settings.payload;
  if (settings.kind !== "render_document" || !same(settings.executionPolicy, template.executionPolicy)
    || !keys(payload, ["artifactKind", "productionMode", "itemCount", "budgetAcknowledged", "preflightAcknowledged", "outputTargetInstructions", "outputNarrative"])
    || payload.artifactKind !== "short_story" || payload.productionMode !== "manual" || payload.itemCount !== 3
    || payload.budgetAcknowledged !== true || payload.preflightAcknowledged !== true
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()) return false;
  const narrative = await readOutputNarrativeExecution(payload.outputNarrative);
  return narrative !== null && same(narrative.contract, SHORT_STORY_NARRATIVE_CONTRACT)
    && narrative.maximumInputTokens <= template.maximumInputTokens && offered.maximumMicrousd === maximumCost(narrative.maximumInputTokens)
    && same(settings.calls, [{ ...template.call, maximumMicrousd: offered.maximumMicrousd, maximumInputTokens: narrative.maximumInputTokens, maximumOutputTokens: 6000 }]);
}
