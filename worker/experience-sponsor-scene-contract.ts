import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { SCENE_OUTPUT_POLICY } from "../src/model/output-scene-contract.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { OUTPUT_SCENE_MODEL } from "./output-scene-request.ts";
import { outputScenePreflightConfiguration } from "./output-scene-preflight-contract.ts";
import { OPENAI_TEXT_PRICING_VERSION } from "./openai-text-cost.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** Dormant local contract version. The future sponsor protocol V6 is not enabled. */
export type SponsorSceneCampaignTemplate = {
  version: 1; family: "canonical-scene-screenplay@1"; appId: "scene"; recipeVersion: string; releaseDigest: string;
  outputKind: "scene"; inputMode: "authorized-document-text"; outputCount: 1; durationMs: 0; width: 0; height: 0;
  route: "document-scene-screenplay-manual-v1"; maximumCalls: 1; maximumTokens: 128000;
  maximumInputTokens: 125000; maximumOutputTokens: 3000; maximumMicrousd: 1000000;
  call: { stage: "planning:0:initial"; provider: "openai"; model: typeof OUTPUT_SCENE_MODEL };
  scenePolicy: typeof SCENE_OUTPUT_POLICY; pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION;
  cachePolicy: "disabled-explicit"; reasoningEffort: "low"; executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY;
};
export class SponsorSceneContractError extends Error {
  readonly code = "sponsor_scene_contract_invalid";
  constructor() { super("sponsor_scene_contract_invalid"); this.name = "SponsorSceneContractError"; }
}

/** Bounded own-data snapshot before any await. Scene's native schema/input are
 * deeper/larger than the generic small-form JSON limit. No accessor is invoked;
 * cycles, sparse arrays, prototypes, symbols and hidden properties are refused. */
export function captureSponsorSceneJson(raw: unknown): unknown {
  let nodes = 0, characters = 0;
  const ancestors = new Set<object>();
  const invalid = (): never => { throw new SponsorSceneContractError(); };
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 24) return invalid();
    if (typeof value === "string") { characters += value.length; return characters <= 524288 ? value : invalid(); }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : invalid();
    if (!value || typeof value !== "object" || ancestors.has(value)) return invalid();
    const array = Array.isArray(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== "string") || names.length > 8192) return invalid();
    const length = array ? descriptors.length?.value : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > 8192 || names.length !== length + 1
      || !("value" in descriptors.length!) || descriptors.length!.enumerable)) return invalid();
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const name of names as string[]) {
      if (array && name === "length") continue;
      const descriptor = descriptors[name]!;
      if (!descriptor.enumerable || !("value" in descriptor)
        || array && (!/^(?:0|[1-9]\d*)$/u.test(name) || Number(name) >= length)) return invalid();
      characters += name.length;
      if (characters > 524288) return invalid();
      Object.defineProperty(result, name, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value);
    return result;
  };
  return visit(raw, 0);
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumInputTokens", "maximumOutputTokens", "maximumMicrousd", "call", "scenePolicy", "pricingVersion", "cachePolicy", "reasoningEffort", "executionPolicy"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
function validTemplate(raw: unknown): raw is SponsorSceneCampaignTemplate {
  return keys(raw, templateKeys) && raw.version === 1 && raw.family === "canonical-scene-screenplay@1" && raw.appId === "scene"
    && typeof raw.recipeVersion === "string" && /^scene@[1-9]\d{0,8}$/u.test(raw.recipeVersion) && hash(raw.releaseDigest)
    && raw.outputKind === "scene" && raw.inputMode === "authorized-document-text" && raw.outputCount === 1
    && raw.durationMs === 0 && raw.width === 0 && raw.height === 0 && raw.route === "document-scene-screenplay-manual-v1"
    && raw.maximumCalls === 1 && raw.maximumTokens === 128000 && raw.maximumInputTokens === 125000 && raw.maximumOutputTokens === 3000
    && raw.maximumMicrousd === 1000000 && same(raw.call, { stage: "planning:0:initial", provider: "openai", model: OUTPUT_SCENE_MODEL })
    && same(raw.scenePolicy, SCENE_OUTPUT_POLICY) && raw.pricingVersion === OPENAI_TEXT_PRICING_VERSION
    && raw.cachePolicy === "disabled-explicit" && raw.reasoningEffort === "low" && same(raw.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY);
}
export function readSponsorSceneCampaignTemplate(raw: unknown): SponsorSceneCampaignTemplate {
  const captured = captureSponsorSceneJson(raw);
  if (!validTemplate(captured)) throw new SponsorSceneContractError();
  return freeze(captured);
}
export function recipeMatchesSponsorSceneTemplate(raw: unknown, candidate: unknown): candidate is SponsorRecipe {
  try {
    const template = captureSponsorSceneJson(raw), recipe = captureSponsorSceneJson(candidate);
    return validTemplate(template) && keys(recipe, recipeKeys) && recipe.appId === template.appId
      && recipe.recipeVersion === template.recipeVersion && recipe.releaseDigest === template.releaseDigest
      && recipe.outputKind === "scene" && recipe.provider === "openai" && recipe.model === OUTPUT_SCENE_MODEL
      && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 0 && recipe.width === 0 && recipe.height === 0
      && same(recipe.calls, { parsing: 0, planning: 1, render: 0, repair: 0 }) && recipe.maximumTokens === 128000 && recipe.maximumMicrousd === 1000000;
  } catch { return false; }
}

/** Pure matching only. Native readers own source, proof, consent and authority.
 * Reconstruct the entire existing native offer; never replace its actual quote
 * with a template ceiling or infer any paid render/repair call. */
export async function matchSponsorSceneTemplate(raw: unknown, actual: unknown): Promise<boolean> {
  try {
    const template = readSponsorSceneCampaignTemplate(raw), captured = captureSponsorSceneJson(actual);
    if (!keys(captured, ["recipe", "offered"]) || !recipeMatchesSponsorSceneTemplate(template, captured.recipe)) return false;
    const recipe = captured.recipe, offered = captured.offered;
    if (!record(offered) || typeof offered.targetId !== "string" || !record(offered.settings)) return false;
    const native = await outputScenePreflightConfiguration(offered.targetId, offered.settings.payload);
    const release = await registeredExperience("scene");
    return native !== null && release !== null && release.output.output === "scene"
      && template.recipeVersion === `scene@${release.definition.revision}` && template.releaseDigest === release.releaseHash
      && native.settings.payload.outputScene.intake.releaseHash === template.releaseDigest && same(offered, native) && native.maximumMicrousd === template.maximumMicrousd
      && native.settings.payload.outputScene.contract.maximumInputTokens <= template.maximumInputTokens
      && await digest(offered) === recipe.routeDigest && await digest(offered.settings) === recipe.settingsDigest;
  } catch { return false; }
}
