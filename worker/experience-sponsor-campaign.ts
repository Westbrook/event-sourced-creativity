import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { outputExactImageRender } from "./output-image-slides-preflight.ts";
import { outputImageBudget } from "./output-image-budget.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** A closed, stable campaign allowance. Source, intent, and quote digests remain
 * in each issued envelope; this template never substitutes for those bindings.
 * Only the currently qualified original, text-only OpenAI Image route is named. */
export type SponsorImageTransport = {
  planning: { api: "https://api.openai.com/v1/responses"; maximumOutputTokens: 1200;
    reasoningEffort: "low"; verbosity: "low"; format: { type: "json_schema"; name: "forma_creative_direction"; strict: true; schemaDigest: string }; store: false };
  image: { api: "https://api.openai.com/v1/images/generations"; adapterId: "openai-image"; adapterVersion: "v5";
    quality: "high"; outputFormat: "png"; partialImages: 0; outputCount: 1 };
  safety: { api: "https://api.openai.com/v1/moderations"; provider: "openai"; model: "omni-moderation-latest";
    maximumCalls: 1; input: "text" };
};
type ImageRender = NonNullable<ReturnType<typeof outputExactImageRender>>;
type ImageBudget = NonNullable<ReturnType<typeof outputImageBudget>>;
export type SponsorImageCampaignTemplate = {
  version: 2; appId: "image"; recipeVersion: string; releaseDigest: string; outputKind: "image"; inputMode: "text-only";
  outputCount: 1; durationMs: 0; width: number; height: number; route: "document-image-manual-v1";
  maximumCalls: 2; maximumTokens: 128000; maximumMicrousd: number;
  calls: [
    { stage: "planning:initial"; provider: "openai"; model: "gpt-5.6-terra"; maximumMicrousd: number },
    { stage: "image:initial"; provider: "openai"; model: "gpt-image-2" | "gpt-image-2.5-sunburst"; maximumMicrousd: number },
  ];
  settings: { kind: "generate"; productionMode: "manual"; budgetAcknowledged: true; preflightAcknowledged: true;
    imageRender: ImageRender; imageBudget: ImageBudget; executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY };
  transport: SponsorImageTransport;
};
export class SponsorCampaignTemplateError extends Error {
  readonly code = "sponsor_campaign_template_invalid";
  constructor() { super("sponsor_campaign_template_invalid"); this.name = "SponsorCampaignTemplateError"; }
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const callKeys = ["stage", "provider", "model", "maximumMicrousd"];
const templateKeys = ["version", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumMicrousd", "calls", "settings", "transport"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];

function validTransport(raw: unknown): raw is SponsorImageTransport {
  if (!keys(raw, ["planning", "image", "safety"])) return false;
  const { planning, image, safety } = raw;
  // These are identities/settings of the qualified native transport, not an
  // invented adapter version. Admission must supply actual transport evidence.
  return keys(planning, ["api", "maximumOutputTokens", "reasoningEffort", "verbosity", "format", "store"])
    && planning.api === "https://api.openai.com/v1/responses" && planning.maximumOutputTokens === 1200
    && planning.reasoningEffort === "low" && planning.verbosity === "low" && planning.store === false
    && keys(planning.format, ["type", "name", "strict", "schemaDigest"]) && planning.format.type === "json_schema"
    && planning.format.name === "forma_creative_direction" && planning.format.strict === true && hash(planning.format.schemaDigest)
    && keys(image, ["api", "adapterId", "adapterVersion", "quality", "outputFormat", "partialImages", "outputCount"])
    && image.api === "https://api.openai.com/v1/images/generations" && image.adapterId === "openai-image" && image.adapterVersion === "v5"
    && image.quality === "high" && image.outputFormat === "png" && image.partialImages === 0 && image.outputCount === 1
    && keys(safety, ["api", "provider", "model", "maximumCalls", "input"])
    && safety.api === "https://api.openai.com/v1/moderations" && safety.provider === "openai" && safety.model === "omni-moderation-latest"
    && safety.maximumCalls === 1 && safety.input === "text";
}

function validTemplate(raw: unknown): raw is SponsorImageCampaignTemplate {
  if (!keys(raw, templateKeys) || raw.version !== 2 || raw.appId !== "image" || raw.outputKind !== "image" || raw.inputMode !== "text-only"
    || typeof raw.recipeVersion !== "string" || !/^image@[1-9]\d{0,8}$/u.test(raw.recipeVersion) || !hash(raw.releaseDigest)
    || raw.outputCount !== 1 || raw.durationMs !== 0 || !integer(raw.width, 1, 3840) || !integer(raw.height, 1, 3840)
    || raw.route !== "document-image-manual-v1" || raw.maximumCalls !== 2 || raw.maximumTokens !== 128000
    || !integer(raw.maximumMicrousd, 1, 1_000_000_000_000) || !Array.isArray(raw.calls) || raw.calls.length !== 2
    || !raw.calls.every(call => keys(call, callKeys) && integer(call.maximumMicrousd, 1, 1_000_000_000_000))
    || !keys(raw.settings, ["kind", "productionMode", "budgetAcknowledged", "preflightAcknowledged", "imageRender", "imageBudget", "executionPolicy"])
    || !validTransport(raw.transport)) return false;
  const [planning, image] = raw.calls, settings = raw.settings;
  if (planning.stage !== "planning:initial" || planning.provider !== "openai" || planning.model !== "gpt-5.6-terra"
    || image.stage !== "image:initial" || image.provider !== "openai" || (image.model !== "gpt-image-2" && image.model !== "gpt-image-2.5-sunburst")
    || Number(planning.maximumMicrousd) < 100_000 || raw.maximumMicrousd !== Number(planning.maximumMicrousd) + Number(image.maximumMicrousd)
    || settings.kind !== "generate" || settings.productionMode !== "manual" || settings.budgetAcknowledged !== true
    || settings.preflightAcknowledged !== true || !same(settings.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY)) return false;
  const render = outputExactImageRender({ width: raw.width, height: raw.height });
  if (!render || render.size !== `${raw.width}x${raw.height}` || !same(settings.imageRender, render)) return false;
  const budget = outputImageBudget(image.model, render.size);
  return budget !== null && same(settings.imageBudget, budget) && image.maximumMicrousd === Math.max(900_000, budget.maximumMicrousd);
}

/** Pure review contract: accepts no wildcards, ranges, additional settings, or
 * caller clocks. Reading a template grants neither enrollment nor execution. */
export function readSponsorCampaignTemplate(raw: unknown): SponsorImageCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorCampaignTemplateError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorImageCampaignTemplate);
}

/** Cheap envelope check only. Full admission must additionally match retained
 * native settings and independently supplied transport with the function below. */
export function recipeMatchesSponsorTemplate(rawTemplate: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(rawTemplate).length || jsonIssues(recipe).length || !validTemplate(rawTemplate) || !keys(recipe, recipeKeys)) return false;
  const template = rawTemplate;
  return recipe.appId === template.appId && recipe.recipeVersion === template.recipeVersion && recipe.releaseDigest === template.releaseDigest
    && recipe.outputKind === template.outputKind && recipe.provider === "openai" && recipe.model === template.calls[1].model
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === template.outputCount && recipe.durationMs === template.durationMs
    && recipe.width === template.width && recipe.height === template.height && recipe.maximumTokens === template.maximumTokens
    && recipe.maximumMicrousd === template.maximumMicrousd && same(recipe.calls, { parsing: 0, planning: 1, render: 1, repair: 0 });
}

/** The issuer supplies a native description, never client-claimed actuals. No
 * omitted actual value is filled from the policy. Per-intent source/quote hashes
 * remain exact envelope bindings; only creative instructions and target identity
 * are intentionally absent from this reusable campaign template. */
export function matchSponsorImageTemplate(rawTemplate: unknown, actual: { recipe: unknown; offered: unknown; transport: unknown }): boolean {
  if (jsonIssues(actual).length || !keys(actual, ["recipe", "offered", "transport"])
    || !recipeMatchesSponsorTemplate(rawTemplate, actual.recipe) || !record(actual.offered)) return false;
  const template = rawTemplate as SponsorImageCampaignTemplate, offered = actual.offered;
  if (!keys(offered, ["targetId", "available", "reasonValues", "reasonCode", "transferCode", "reason", "provider", "model", "route", "maximumMicrousd", "maximumCalls", "maximumTokens", "settings", "transferDescription"])
    || offered.available !== true || offered.reasonCode !== "output_native_image_ready" || offered.transferCode !== "output_transfer_document_after_authorization"
    || typeof offered.targetId !== "string" || !offered.targetId
    || offered.provider !== "openai" || offered.model !== template.calls[1].model || offered.route !== template.route
    || offered.maximumCalls !== template.maximumCalls || offered.maximumTokens !== template.maximumTokens || offered.maximumMicrousd !== template.maximumMicrousd
    || !keys(offered.settings, ["kind", "payload", "calls", "executionPolicy", "imageRender", "imageBudget"])
    || !same(offered.settings.calls, template.calls) || !validTransport(actual.transport) || !same(actual.transport, template.transport)) return false;
  const settings = offered.settings, payload = settings.payload;
  if (!keys(payload, ["productionMode", "budgetAcknowledged", "preflightAcknowledged", "outputTargetInstructions", "outputImageFormat"])
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()
    || !same(payload.outputImageFormat, template.settings.imageRender.format)) return false;
  return same({ kind: settings.kind, productionMode: payload.productionMode, budgetAcknowledged: payload.budgetAcknowledged,
    preflightAcknowledged: payload.preflightAcknowledged, imageRender: settings.imageRender, imageBudget: settings.imageBudget,
    executionPolicy: settings.executionPolicy }, template.settings);
}
