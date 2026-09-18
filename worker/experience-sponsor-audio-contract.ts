import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { audioMiniAppCostApprovalMatches, parseAudioMiniAppCostPreview, type AudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { AUDIO_OUTPUT_POLICY, parseAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { AUDIO_PROVIDER_INPUT_CONTRACTS } from "../src/model/audio-provider-contracts.ts";
import { STABLE_AUDIO_ADAPTER_CONTRACT, estimateAudioProviderCostMicrousd } from "../src/model/audio.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { serializeStableAudioRequest } from "./audio-adapters/stable-audio.ts";
import { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

const planningModel = "gpt-5.6-terra";
const audioModel = "fal-ai/stable-audio-3/medium/text-to-audio";
const plannerCost = (input: number) => Math.max(500_000, estimateOpenAITextCallMaximumMicrousd(planningModel, input, 3000));
const audioCost = estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT, EXPERIENCE_AUDIO_INTENT);
export const SPONSOR_AUDIO_TRANSFER_DESCRIPTION = "This check sends nothing. A future separately authorized Start would send the current Document text to OpenAI for one planning call and at most one repair, then the adapted musical direction to fal.ai / Stable Audio 3 for one 20-second instrumental request. No reference file, recording, lyrics or spoken script is authorized. No automatic command retry. Prices are published-rate estimates, not provider billing evidence.";

type PlanningCall = {
  stage: "planning:0:initial" | "planning:0:repair"; provider: "openai"; model: typeof planningModel; optional: boolean;
  maximumInputTokens: 61000; maximumOutputTokens: 3000; maximumMicrousd: number;
};
type RenderCall = { stage: "audio:initial"; provider: "fal"; model: typeof audioModel; optional: false; maximumMicrousd: number };
export type SponsorAudioConsent = AudioMiniAppCostPreview & Readonly<{ confirmed: true; providerTransferConfirmed: true }>;
/** Inert review contract version 1. It is not a sponsor policy version, payer
 * authorization, source authority, or a representation of future paid bytes. */
export type SponsorAudioCampaignTemplate = {
  version: 1; family: "canonical-instrumental-cue@1"; appId: "audio"; recipeVersion: string; releaseDigest: string;
  outputKind: "audio"; inputMode: "authorized-document-text"; outputCount: 1; durationMs: 20000; width: 0; height: 0;
  route: "document-audio-timed-music-manual-v1"; maximumCalls: 3; maximumTokens: 128000; maximumMicrousd: number;
  calls: [PlanningCall, PlanningCall, RenderCall]; audioContract: typeof AUDIO_OUTPUT_POLICY;
  mediaRequest: { duration: 20; output_format: "mp3"; enable_safety_checker: true; negative_prompt: "singing, vocals, spoken dialogue" };
  sourceFilesTransferred: 0; pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION; adapterVersion: string;
  executionPolicy: typeof OUTPUT_NATIVE_EXECUTION_POLICY; transferDescription: typeof SPONSOR_AUDIO_TRANSFER_DESCRIPTION;
};
export class SponsorAudioContractError extends Error {
  readonly code = "sponsor_audio_contract_invalid";
  constructor() { super("sponsor_audio_contract_invalid"); this.name = "SponsorAudioContractError"; }
}
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const templateKeys = ["version", "family", "appId", "recipeVersion", "releaseDigest", "outputKind", "inputMode", "outputCount", "durationMs", "width", "height", "route", "maximumCalls", "maximumTokens", "maximumMicrousd", "calls", "audioContract", "mediaRequest", "sourceFilesTransferred", "pricingVersion", "adapterVersion", "executionPolicy", "transferDescription"];
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
const originalKeys = ["requestId", "expiresAt", "draftId", "actorUserId", "projectId", "documentId", "sourceDigest", "requirementsDigest"] as const;
const inputContract = AUDIO_PROVIDER_INPUT_CONTRACTS[audioModel]!;
// Capture native serializer choices, without making or claiming a provider
// request. The actual adapted musical prompt exists only after paid planning.
const { prompt: omittedPrompt, ...nativeMediaRequest } = serializeStableAudioRequest({ prompt: "Contract validation", profile: EXPERIENCE_AUDIO_INTENT });
void omittedPrompt;
const expectedMediaRequest = freeze(JSON.parse(canonicalJson(nativeMediaRequest)) as SponsorAudioCampaignTemplate["mediaRequest"]);
const expectedConstraints = freeze(JSON.parse(canonicalJson({
  model: audioModel, adapter_version: STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,
  maximum_prompt_characters: STABLE_AUDIO_ADAPTER_CONTRACT.maxPromptCharacters,
  provider_prompt_character_limit: inputContract.parameters.prompt?.maxLength ?? null,
  maximum_content_characters: STABLE_AUDIO_ADAPTER_CONTRACT.maxPromptCharacters, approved_script_present: false,
  supported_parameters: Object.keys(inputContract.parameters), parameter_limits: inputContract.parameters,
  duration: { parameter: inputContract.parameters.duration ?? null, requested_seconds: 20,
    default_seconds: STABLE_AUDIO_ADAPTER_CONTRACT.defaultDurationSeconds,
    maximum_seconds: STABLE_AUDIO_ADAPTER_CONTRACT.maximumAdvertisedDurationSeconds, exact: STABLE_AUDIO_ADAPTER_CONTRACT.supportsExactDuration },
})) as Record<string, unknown>);

function validTemplate(raw: unknown): raw is SponsorAudioCampaignTemplate {
  if (!keys(raw, templateKeys) || raw.version !== 1 || raw.family !== "canonical-instrumental-cue@1" || raw.appId !== "audio"
    || typeof raw.recipeVersion !== "string" || !/^audio@[1-9]\d{0,8}$/u.test(raw.recipeVersion) || !hash(raw.releaseDigest)
    || raw.outputKind !== "audio" || raw.inputMode !== "authorized-document-text" || raw.outputCount !== 1 || raw.durationMs !== 20000
    || raw.width !== 0 || raw.height !== 0 || raw.route !== "document-audio-timed-music-manual-v1" || raw.maximumCalls !== 3
    || raw.maximumTokens !== 128000 || raw.maximumMicrousd !== 2 * plannerCost(61000) + audioCost
    || !same(raw.audioContract, AUDIO_OUTPUT_POLICY) || !same(raw.mediaRequest, expectedMediaRequest) || raw.sourceFilesTransferred !== 0
    || raw.pricingVersion !== OPENAI_TEXT_PRICING_VERSION || raw.adapterVersion !== STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion
    || !same(raw.executionPolicy, OUTPUT_NATIVE_EXECUTION_POLICY) || raw.transferDescription !== SPONSOR_AUDIO_TRANSFER_DESCRIPTION
    || !Array.isArray(raw.calls) || raw.calls.length !== 3) return false;
  return raw.calls.every((call, index) => index === 2
    ? same(call, { stage: "audio:initial", provider: "fal", model: audioModel, optional: false, maximumMicrousd: audioCost })
    : same(call, { stage: index === 0 ? "planning:0:initial" : "planning:0:repair", provider: "openai", model: planningModel,
      optional: index === 1, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost(61000) }));
}

export function readSponsorAudioCampaignTemplate(raw: unknown): SponsorAudioCampaignTemplate {
  if (jsonIssues(raw).length || !validTemplate(raw)) throw new SponsorAudioContractError();
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorAudioCampaignTemplate);
}

export function recipeMatchesSponsorAudioTemplate(raw: unknown, recipe: unknown): recipe is SponsorRecipe {
  if (jsonIssues(raw).length || jsonIssues(recipe).length || !validTemplate(raw) || !keys(recipe, recipeKeys)) return false;
  return recipe.appId === raw.appId && recipe.recipeVersion === raw.recipeVersion && recipe.releaseDigest === raw.releaseDigest
    && recipe.outputKind === "audio" && recipe.provider === "fal" && recipe.model === audioModel
    && hash(recipe.routeDigest) && hash(recipe.settingsDigest) && recipe.outputCount === 1 && recipe.durationMs === 20000
    && recipe.width === 0 && recipe.height === 0 && same(recipe.calls, { parsing: 0, planning: 1, render: 1, repair: 1 })
    && recipe.maximumTokens === 128000 && Number.isSafeInteger(recipe.maximumMicrousd)
    && Number(recipe.maximumMicrousd) >= 2 * plannerCost(25000) + audioCost && Number(recipe.maximumMicrousd) <= raw.maximumMicrousd;
}

/** Pure comparison of native evidence. Even an exact match grants no admission
 * or transfer permission: the reader must prove the real current source and
 * quote, and later integration must bind a deliberate consent receipt. */
export async function matchSponsorAudioTemplate(raw: unknown, actual: { recipe: unknown; offered: unknown; consent: unknown }): Promise<boolean> {
  if (jsonIssues(raw).length || jsonIssues(actual).length || !keys(actual, ["recipe", "offered", "consent"])) return false;
  const template = freeze(JSON.parse(canonicalJson(raw)) as SponsorAudioCampaignTemplate);
  const captured = freeze(JSON.parse(canonicalJson(actual)) as { recipe: unknown; offered: unknown; consent: unknown });
  if (!recipeMatchesSponsorAudioTemplate(template, captured.recipe)) return false;
  const { recipe, offered, consent } = captured;
  if (!keys(offered, ["targetId", "available", "reasonCode", "reason", "transferCode", "transferDescription", "provider", "model", "route", "maximumMicrousd", "maximumCalls", "maximumTokens", "settings"])
    || typeof offered.targetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(offered.targetId)
    || offered.available !== true || offered.reasonCode !== "output_audio_ready_for_separate_approval"
    || offered.reason !== "1 instrumental track · 20-second target, not measured duration · review cost and transfer before Start"
    || offered.transferCode !== "output_transfer_audio_not_yet_authorized" || offered.transferDescription !== template.transferDescription
    || offered.provider !== "fal" || offered.model !== audioModel || offered.route !== template.route
    || offered.maximumCalls !== 3 || offered.maximumTokens !== 128000 || offered.maximumMicrousd !== recipe.maximumMicrousd
    || !keys(offered.settings, ["kind", "payload", "calls", "preparationOnly", "explicitCostAndTransferApprovalRequired", "executionAvailable", "costPreview", "executionPolicy", "original", "constraints", "duration"])) return false;
  const settings = offered.settings, payload = settings.payload;
  if (settings.kind !== "render_document" || settings.preparationOnly !== false || settings.explicitCostAndTransferApprovalRequired !== true
    || settings.executionAvailable !== true || !same(settings.executionPolicy, template.executionPolicy)
    || !same(settings.constraints, expectedConstraints) || !same(settings.duration, { requestedSeconds: 20, measuredSeconds: null })
    || !keys(payload, ["productionMode", "artifactKind", "itemCount", "audioProfile", "audioProviderModel", "audioEstimatedCostMicrousd", "outputTargetInstructions", "outputAudio"])
    || payload.productionMode !== "manual" || payload.artifactKind !== "audio" || payload.itemCount !== 1
    || !same(payload.audioProfile, EXPERIENCE_AUDIO_INTENT) || payload.audioProviderModel !== audioModel || payload.audioEstimatedCostMicrousd !== audioCost
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim() || payload.outputTargetInstructions.length > 4000
    || !Array.isArray(settings.calls) || settings.calls.length !== 3) return false;
  const output = parseAudioOutputContract(payload.outputAudio), preview = parseAudioMiniAppCostPreview(settings.costPreview);
  if (!output || !preview || output.source.releaseHash !== recipe.releaseDigest || output.source.draftId !== preview.draftId
    || preview.maximumMicrousd !== offered.maximumMicrousd || !keys(settings.original, originalKeys)
    || !originalKeys.every(key => (settings.original as Record<string, unknown>)[key] === preview[key])) return false;
  let total = audioCost;
  for (const [index, call] of settings.calls.entries()) {
    if (index === 2) {
      if (!same(call, { stage: "audio:initial", provider: "fal", model: audioModel, maximumMicrousd: audioCost })) return false;
    } else {
      if (!keys(call, ["stage", "provider", "model", "maximumMicrousd", "maximumInputTokens", "maximumOutputTokens"])
        || call.stage !== (index === 0 ? "planning:0:initial" : "planning:0:repair") || call.provider !== "openai" || call.model !== planningModel
        || !Number.isSafeInteger(call.maximumInputTokens) || Number(call.maximumInputTokens) < 25000 || Number(call.maximumInputTokens) > 61000
        || (Number(call.maximumInputTokens) - 25000) % 4 !== 0
        || call.maximumOutputTokens !== 3000 || call.maximumMicrousd !== plannerCost(Number(call.maximumInputTokens))) return false;
      total += Number(call.maximumMicrousd);
    }
  }
  if (total !== offered.maximumMicrousd || settings.calls[0].maximumInputTokens !== settings.calls[1].maximumInputTokens) return false;
  // These are retained quote/settings digests, never future provider wire digests.
  return await digest(offered) === recipe.routeDigest && await digest(settings) === recipe.settingsDigest
    && audioMiniAppCostApprovalMatches(consent, preview);
}
