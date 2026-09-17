import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { PRESENTATION_ADAPTER_VERSION } from "./openai-adapter.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import { readFrozenPresentationModelRoutes, type PresentationModelRoute } from "./presentation-model-routing.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

export type SponsorSlidesCallTemplate = {
  stage: "planning:0:initial" | "planning:0:repair"; provider: "openai"; model: PresentationModelRoute["model"];
  optional: boolean; presentationRoute: PresentationModelRoute;
  maximumInputTokens: 121500; maximumOutputTokens: 6500; maximumMicrousd: number;
};
/** Inert leaf version, not the reserved future sponsor policy V5. Each call has
 * a finite ceiling; both calls still share the native 128000-token reservation. */
export type SponsorSlidesCampaignTemplate = {
  version: 1; family: "canonical-five-slide-deck@1"; appId: "slides"; recipeVersion: string; releaseDigest: string;
  outputKind: "slides"; inputMode: "authorized-document-text"; outputCount: 1; durationMs: 0; width: 0; height: 0;
  slideCountPolicy: { kind: "exact"; unit: "slide"; value: 5 }; route: "document-slides-manual-v1";
  maximumCalls: 2; maximumTokens: 128000; maximumMicrousd: number;
  calls: [SponsorSlidesCallTemplate, SponsorSlidesCallTemplate];
  adapterVersion: typeof PRESENTATION_ADAPTER_VERSION; sourceContractVersion: 2;
  executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY;
};
export type SponsorSlidesCompositionEvidence = {
  phase: "composition"; requestDigest: string; schemaDigest: string; sourceContractDigest: string; sourceContractVersion: 2;
  maximumInputTokens: number; maximumOutputTokens: 6500; route: PresentationModelRoute;
};
export class SponsorSlidesContractError extends Error {
  readonly code = "sponsor_slides_contract_invalid";
  constructor() { super("sponsor_slides_contract_invalid"); this.name = "SponsorSlidesContractError"; }
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "slideCountPolicy", "route", "maximumCalls", "maximumTokens", "maximumMicrousd", "calls", "adapterVersion", "sourceContractVersion", "executionPolicy"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
const routeKeys = ["workflow", "model", "reasoningEffort", "serviceTier", "cachePolicy", "modelSource", "effortSource", "routingVersion", "pricingVersion"];
const countPolicy = { kind: "exact", unit: "slide", value: 5 };
const callCost = (model: string, input: number) => Math.max(500000, estimateOpenAITextCallMaximumMicrousd(model, input, 6500));
function validTemplate(raw: unknown): raw is SponsorSlidesCampaignTemplate {
  if (!keys(raw, templateKeys) || raw.version !== 1 || raw.family !== "canonical-five-slide-deck@1" || raw.appId !== "slides"
    || typeof raw.recipeVersion !== "string" || !/^slides@[1-9]\d{0,8}$/u.test(raw.recipeVersion) || !hash(raw.releaseDigest)
    || raw.outputKind !== "slides" || raw.inputMode !== "authorized-document-text" || raw.outputCount !== 1
    || raw.durationMs !== 0 || raw.width !== 0 || raw.height !== 0 || !same(raw.slideCountPolicy, countPolicy)
    || raw.route !== "document-slides-manual-v1" || raw.maximumCalls !== 2 || raw.maximumTokens !== 128000
    || raw.adapterVersion !== PRESENTATION_ADAPTER_VERSION || raw.sourceContractVersion !== 2
    || !same(raw.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY) || !Array.isArray(raw.calls) || raw.calls.length !== 2) return false;
  const calls = raw.calls;
  if (!calls.every(call => keys(call, ["stage", "provider", "model", "optional", "presentationRoute", "maximumInputTokens", "maximumOutputTokens", "maximumMicrousd"])
    && keys(call.presentationRoute, routeKeys))) return false;
  try {
    const routes = readFrozenPresentationModelRoutes({ composition: calls[0].presentationRoute, repair: calls[1].presentationRoute });
    return calls.every((call, index) => call.stage === (index === 0 ? "planning:0:initial" : "planning:0:repair")
      && call.provider === "openai" && call.optional === (index === 1) && call.maximumInputTokens === 121500 && call.maximumOutputTokens === 6500
      && same(call.presentationRoute, index === 0 ? routes.composition : routes.repair) && call.model === call.presentationRoute.model
      && call.maximumMicrousd === callCost(call.model, 121500))
      && raw.maximumMicrousd === calls.reduce((sum, call) => sum + call.maximumMicrousd, 0);
  } catch { return false; }
}

/** Review material only: no issuance, provider, read, admission or payer power. */
export function readSponsorSlidesCampaignTemplate(raw: unknown): SponsorSlidesCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorSlidesContractError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorSlidesCampaignTemplate);
}
export function recipeMatchesSponsorSlidesTemplate(raw: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(raw).length || jsonIssues(recipe).length || !validTemplate(raw) || !keys(recipe, recipeKeys)) return false;
  return recipe.appId === raw.appId && recipe.recipeVersion === raw.recipeVersion && recipe.releaseDigest === raw.releaseDigest
    && recipe.outputKind === "slides" && recipe.provider === "openai" && recipe.model === raw.calls[0].model
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 0 && recipe.width === 0 && recipe.height === 0
    && same(recipe.calls, { parsing: 0, planning: 1, render: 0, repair: 1 }) && recipe.maximumTokens === 128000
    && Number.isSafeInteger(recipe.maximumMicrousd) && Number(recipe.maximumMicrousd) >= 1000000 && Number(recipe.maximumMicrousd) <= raw.maximumMicrousd;
}

/** The native reader supplies these actuals. This pure match is not authority:
 * a digest-shaped caller object cannot substitute for retained current proof. */
export async function matchSponsorSlidesTemplate(raw: unknown, actual: { recipe: unknown; offered: unknown; composition: unknown }): Promise<boolean> {
  if (jsonIssues(raw).length || jsonIssues(actual).length || !keys(actual, ["recipe", "offered", "composition"])) return false;
  const template = JSON.parse(canonicalJson(raw)) as SponsorSlidesCampaignTemplate;
  const captured = JSON.parse(canonicalJson(actual)) as { recipe: unknown; offered: unknown; composition: unknown };
  if (!recipeMatchesSponsorSlidesTemplate(template, captured.recipe)) return false;
  const { recipe, offered, composition } = captured;
  if (!keys(offered, ["targetId", "available", "reasonCode", "reason", "reasonValues", "transferCode", "provider", "model", "route", "maximumMicrousd", "maximumTokens", "maximumCalls", "settings", "transferDescription"])
    || typeof offered.targetId !== "string" || !offered.targetId || offered.available !== true || offered.reasonCode !== "output_native_slides_ready"
    || offered.transferCode !== "output_transfer_document_after_authorization" || offered.provider !== "openai" || offered.model !== template.calls[0].model
    || offered.route !== template.route || offered.maximumCalls !== 2 || offered.maximumTokens !== 128000 || offered.maximumMicrousd !== recipe.maximumMicrousd
    || !keys(offered.settings, ["kind", "payload", "calls", "executionPolicy"])) return false;
  if (await digest(offered) !== recipe.routeDigest || await digest(offered.settings) !== recipe.settingsDigest) return false;
  const settings = offered.settings, payload = settings.payload;
  if (settings.kind !== "render_document" || !same(settings.executionPolicy, template.executionPolicy)
    || !keys(payload, ["artifactKind", "productionMode", "itemCount", "requestedSlideCount", "slideCountPolicy", "budgetAcknowledged", "preflightAcknowledged", "outputTargetInstructions"])
    || payload.artifactKind !== "slides" || payload.productionMode !== "manual" || payload.itemCount !== 5 || payload.requestedSlideCount !== 5
    || !same(payload.slideCountPolicy, countPolicy) || payload.budgetAcknowledged !== true || payload.preflightAcknowledged !== true
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()
    || !Array.isArray(settings.calls) || settings.calls.length !== 2) return false;
  let total = 0;
  for (const [index, call] of settings.calls.entries()) {
    const cap = template.calls[index]!;
    if (!keys(call, ["stage", "provider", "model", "presentationRoute", "maximumInputTokens", "maximumOutputTokens", "maximumMicrousd"])
      || call.stage !== cap.stage || call.provider !== cap.provider || call.model !== cap.model || !same(call.presentationRoute, cap.presentationRoute)
      || !Number.isSafeInteger(call.maximumInputTokens) || Number(call.maximumInputTokens) < 25000 || Number(call.maximumInputTokens) > cap.maximumInputTokens
      || call.maximumOutputTokens !== 6500 || call.maximumMicrousd !== callCost(cap.model, Number(call.maximumInputTokens))) return false;
    total += Number(call.maximumMicrousd);
  }
  const initial = settings.calls[0] as Record<string, unknown>;
  return total === offered.maximumMicrousd && same(initial.maximumInputTokens, (settings.calls[1] as Record<string, unknown>).maximumInputTokens)
    && keys(composition, ["phase", "requestDigest", "schemaDigest", "sourceContractDigest", "sourceContractVersion", "maximumInputTokens", "maximumOutputTokens", "route"])
    && composition.phase === "composition" && [composition.requestDigest, composition.schemaDigest, composition.sourceContractDigest].every(hash)
    && composition.sourceContractVersion === 2 && same(composition.route, template.calls[0].presentationRoute)
    && Number.isSafeInteger(composition.maximumInputTokens) && Number(composition.maximumInputTokens) > 4096
    && Number(composition.maximumInputTokens) <= Number(initial.maximumInputTokens) && composition.maximumOutputTokens === 6500;
}
