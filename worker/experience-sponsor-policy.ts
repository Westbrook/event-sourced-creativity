import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsorCampaignTemplate, recipeMatchesSponsorTemplate, type SponsorImageCampaignTemplate } from "./experience-sponsor-campaign.ts";
import { captureSponsorSceneJson, readSponsorSceneCampaignTemplate, recipeMatchesSponsorSceneTemplate, type SponsorSceneCampaignTemplate } from "./experience-sponsor-scene-contract.ts";
import { readSponsorSlidesCampaignTemplate, recipeMatchesSponsorSlidesTemplate, type SponsorSlidesCampaignTemplate } from "./experience-sponsor-slides-contract.ts";
import { readSponsorStoryCampaignTemplate, recipeMatchesSponsorStoryTemplate, type SponsorStoryCampaignTemplate } from "./experience-sponsor-story-contract.ts";
import { readSponsorResourceLimits, type SponsorResourceLimits, type SponsorResourceLimitsV1 } from "./experience-sponsor-resources.ts";
import type { OutputKind } from "../src/experiences/contracts.ts";

/** Dormant contract only. No registered route issues sponsor authority; there is
 * no environment switch, registered policy loader, sponsor enrollment or public grant issuer. */
export const DEFAULT_SPONSOR_POLICY = Object.freeze({ version: 1, mode: "disabled" } as const);
export class SponsorEntitlementError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "SponsorEntitlementError"; }
}
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const outputs = new Set<OutputKind>(["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"]);
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export type SponsorRecipe = {
  appId: string; recipeVersion: string; releaseDigest: string; outputKind: OutputKind;
  provider: string; model: string; routeDigest: string; settingsDigest: string;
  outputCount: number; durationMs: number; width: number; height: number;
  calls: { parsing: number; planning: number; render: number; repair: number };
  maximumTokens: number; maximumMicrousd: number;
};
export type SponsorPolicyV1 = {
  version: 1; mode: "candidate"; campaignId: string; policyVersion: string; payerUserId: string;
  audience: "canonical-principal"; approvalReceiptDigest: string;
  startsAtMs: number; expiresAtMs: number; maximumGrantLifetimeMs: number;
  maximumAdmissions: number; maximumMicrousd: number; maximumAdmissionsPerActor: number;
  windowMs: number; maximumAdmissionsPerWindow: number; maximumAdmissionsPerActorWindow: number;
  recipes: SponsorRecipe[];
};
export type SponsorPolicyV2 = Omit<SponsorPolicyV1, "version" | "recipes"> & { version: 2; templates: SponsorImageCampaignTemplate[]; resources: SponsorResourceLimits };
export type SponsorPolicyV4 = Omit<SponsorPolicyV1, "version" | "recipes"> & {
  version: 4; family: "canonical-short-story@1"; templates: SponsorStoryCampaignTemplate[]; resources: SponsorResourceLimitsV1;
};
export type SponsorPolicyV5 = Omit<SponsorPolicyV1, "version" | "recipes"> & {
  version: 5; family: "canonical-five-slide-deck@1"; templates: SponsorSlidesCampaignTemplate[]; resources: SponsorResourceLimitsV1;
};
/** Scene review data; runtime callers additionally require the original native
 * proof and separately recorded admission/Run/dispatch transition. */
export type SponsorPolicyV6 = Omit<SponsorPolicyV1, "version" | "recipes"> & {
  version: 6; family: "canonical-scene-screenplay@1"; templates: SponsorSceneCampaignTemplate[]; resources: SponsorResourceLimitsV1;
};
export type SponsorApprovedPolicy = SponsorPolicyV2 | SponsorPolicyV4 | SponsorPolicyV5 | SponsorPolicyV6;
export type SponsorPolicy = SponsorPolicyV1 | SponsorApprovedPolicy;
export type SponsorEnvelopeV1 = {
  version: 1; campaignId: string; policyVersion: string; consumptionId: string; intentKey: string;
  actorKind: "canonical-principal"; actorUserId: string; sessionDigest: string; payerUserId: string;
  ownerUserId: string; projectId: string; documentId: string; sourceRevision: number;
  sourceDigest: string; orderedAssetDigests: string[]; rightsDigest: string;
  compiledInputDigest: string; transferEnvelopeDigest: string; recipe: SponsorRecipe;
  issuedAtMs: number; expiresAtMs: number;
};
export type SponsorEnvelopeV2 = Omit<SponsorEnvelopeV1, "version"> & { version: 2; templateDigest: string };
export type SponsorEnvelopeV4 = Omit<SponsorEnvelopeV1, "version"> & { version: 4; family: "canonical-short-story@1"; templateDigest: string };
export type SponsorEnvelopeV5 = Omit<SponsorEnvelopeV1, "version"> & { version: 5; family: "canonical-five-slide-deck@1"; templateDigest: string };
export type SponsorEnvelopeV6 = Omit<SponsorEnvelopeV1, "version"> & { version: 6; family: "canonical-scene-screenplay@1"; templateDigest: string };
export type SponsorEnvelope = SponsorEnvelopeV1 | SponsorEnvelopeV2 | SponsorEnvelopeV4 | SponsorEnvelopeV5 | SponsorEnvelopeV6;
const recipeKeys = ["appId", "recipeVersion", "releaseDigest", "outputKind", "provider", "model", "routeDigest", "settingsDigest", "outputCount", "durationMs", "width", "height", "calls", "maximumTokens", "maximumMicrousd"];
function validRecipe(value: unknown): value is SponsorRecipe {
  if (!keys(value, recipeKeys) || ![value.appId, value.recipeVersion, value.provider, value.model].every(id)
    || ![value.releaseDigest, value.routeDigest, value.settingsDigest].every(hash) || !outputs.has(value.outputKind as OutputKind)
    || !integer(value.outputCount, 1, 100) || !integer(value.durationMs, 0, 3_600_000)
    || !integer(value.width, 0, 16384) || !integer(value.height, 0, 16384)
    || !integer(value.maximumTokens, 1, 100_000_000) || !integer(value.maximumMicrousd, 1, 1_000_000_000_000)
    || !keys(value.calls, ["parsing", "planning", "render", "repair"])) return false;
  return Object.values(value.calls).every(count => integer(count, 0, 1000))
    && Object.values(value.calls).reduce<number>((sum, count) => sum + Number(count), 0) <= 1000
    && Number(value.calls.render) > 0;
}

/** Separate finite grammar: the native story has one planning call and no
 * render call. V1/V2 Image recipes and the guest lane's V3 are not reinterpreted. */
function readSponsorStoryPolicy(raw: unknown): SponsorPolicyV4 {
  if (!keys(raw, ["version", "family", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "templates", "resources"])
    || raw.version !== 4 || raw.family !== "canonical-short-story@1" || raw.mode !== "candidate" || raw.audience !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.payerUserId].every(id) || !hash(raw.approvalReceiptDigest)
    || !integer(raw.startsAtMs, 0, 8_640_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_640_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.maximumGrantLifetimeMs, 1, 900_000)
    || !integer(raw.maximumMicrousd, 1, 1_000_000_000_000)
    || ![raw.maximumAdmissions, raw.maximumAdmissionsPerActor, raw.maximumAdmissionsPerWindow, raw.maximumAdmissionsPerActorWindow].every(value => integer(value, 1, 100_000))
    || !integer(raw.windowMs, 1, 86_400_000) || !Array.isArray(raw.templates) || raw.templates.length !== 1
    || Number(raw.maximumAdmissionsPerActor) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerWindow) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerActorWindow) > Number(raw.maximumAdmissionsPerActor)) return fail("sponsor_policy_invalid");
  const templates = raw.templates.map(readSponsorStoryCampaignTemplate), resources = readSponsorResourceLimits(raw.resources);
  if (resources.version !== 1 || resources.startsAtMs < raw.startsAtMs || resources.expiresAtMs > raw.expiresAtMs
    || templates.some(template => template.maximumMicrousd > Number(raw.maximumMicrousd))) return fail("sponsor_policy_invalid");
  return freeze(JSON.parse(canonicalJson({ ...raw, templates, resources })) as SponsorPolicyV4);
}

/** Separate Slides V5 grammar: one deck, initial composition and at most one
 * repair share 128000 tokens. Resource V1 grants no draft storage or passive reads. */
function readSponsorSlidesPolicy(raw: unknown): SponsorPolicyV5 {
  if (!keys(raw, ["version", "family", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "templates", "resources"])
    || raw.version !== 5 || raw.family !== "canonical-five-slide-deck@1" || raw.mode !== "candidate" || raw.audience !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.payerUserId].every(id) || !hash(raw.approvalReceiptDigest)
    || !integer(raw.startsAtMs, 0, 8_640_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_640_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.maximumGrantLifetimeMs, 1, 900_000)
    || !integer(raw.maximumMicrousd, 1, 1_000_000_000_000)
    || ![raw.maximumAdmissions, raw.maximumAdmissionsPerActor, raw.maximumAdmissionsPerWindow, raw.maximumAdmissionsPerActorWindow].every(value => integer(value, 1, 100_000))
    || !integer(raw.windowMs, 1, 86_400_000) || !Array.isArray(raw.templates) || raw.templates.length !== 1
    || Number(raw.maximumAdmissionsPerActor) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerWindow) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerActorWindow) > Number(raw.maximumAdmissionsPerActor)) return fail("sponsor_policy_invalid");
  const templates = raw.templates.map(readSponsorSlidesCampaignTemplate), resources = readSponsorResourceLimits(raw.resources);
  if (resources.version !== 1 || resources.startsAtMs < raw.startsAtMs || resources.expiresAtMs > raw.expiresAtMs
    || templates.some(template => template.maximumMicrousd > Number(raw.maximumMicrousd))) return fail("sponsor_policy_invalid");
  return freeze(JSON.parse(canonicalJson({ ...raw, templates, resources })) as SponsorPolicyV5);
}

/** Candidate policies are inert review material, not runtime configuration. */
export function readSponsorPolicy(raw: unknown = DEFAULT_SPONSOR_POLICY): SponsorPolicy | typeof DEFAULT_SPONSOR_POLICY {
  if (jsonIssues(raw).length) return fail("sponsor_policy_invalid");
  if (keys(raw, ["version", "mode"]) && raw.version === 1 && raw.mode === "disabled") return DEFAULT_SPONSOR_POLICY;
  if (record(raw) && raw.version === 4) return readSponsorStoryPolicy(raw);
  if (record(raw) && raw.version === 5) return readSponsorSlidesPolicy(raw);
  if (record(raw) && raw.version === 6) return readSponsorScenePolicy(raw);
  if (record(raw) && raw.version === 2) {
    if (!keys(raw, ["version", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "templates", "resources"])
      || !Array.isArray(raw.templates) || raw.templates.length !== 1) return fail("sponsor_policy_invalid");
    const templates = raw.templates.map(readSponsorCampaignTemplate), resources = readSponsorResourceLimits(raw.resources);
    const { templates: ignoredTemplates, resources: ignoredResources, ...common } = raw;
    void ignoredTemplates; void ignoredResources;
    // Reuse the exact existing finite monetary and lifetime validator. The
    // synthetic digests here only validate common limits; they grant no intent.
    const base = readSponsorPolicy({ ...common, version: 1, recipes: templates.map(t => ({ appId:t.appId,recipeVersion:t.recipeVersion,releaseDigest:t.releaseDigest,
      outputKind:t.outputKind,provider:t.calls[1].provider,model:t.calls[1].model,routeDigest:`sha256:${"0".repeat(64)}`,settingsDigest:`sha256:${"0".repeat(64)}`,
      outputCount:t.outputCount,durationMs:t.durationMs,width:t.width,height:t.height,calls:{parsing:0,planning:1,render:1,repair:0},maximumTokens:t.maximumTokens,maximumMicrousd:t.maximumMicrousd })) });
    if (base.mode !== "candidate" || resources.startsAtMs < base.startsAtMs || resources.expiresAtMs > base.expiresAtMs) return fail("sponsor_policy_invalid");
    return freeze(JSON.parse(canonicalJson({ ...raw, templates, resources })) as SponsorPolicyV2);
  }
  if (!keys(raw, ["version", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "recipes"])
    || raw.version !== 1 || raw.mode !== "candidate" || raw.audience !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.payerUserId].every(id) || !hash(raw.approvalReceiptDigest)
    || !integer(raw.startsAtMs, 0, 8_640_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_640_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.maximumGrantLifetimeMs, 1, 900_000)
    || !integer(raw.maximumMicrousd, 1, 1_000_000_000_000)
    || ![raw.maximumAdmissions, raw.maximumAdmissionsPerActor, raw.maximumAdmissionsPerWindow, raw.maximumAdmissionsPerActorWindow].every(value => integer(value, 1, 100_000))
    || !integer(raw.windowMs, 1, 86_400_000) || !Array.isArray(raw.recipes) || !raw.recipes.length || raw.recipes.length > 64
    || !raw.recipes.every(validRecipe)) return fail("sponsor_policy_invalid");
  if (Number(raw.maximumAdmissionsPerActor) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerWindow) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerActorWindow) > Number(raw.maximumAdmissionsPerActor)
    || raw.recipes.some(recipe => recipe.maximumMicrousd > Number(raw.maximumMicrousd))
    || new Set(raw.recipes.map(recipe => canonicalJson(recipe))).size !== raw.recipes.length) return fail("sponsor_policy_invalid");
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorPolicy);
}

async function compileSponsorStoryEnvelope(policy: SponsorPolicyV4, raw: unknown) {
  if (jsonIssues(raw).length) return fail("sponsor_envelope_invalid");
  if (record(raw) && raw.actorKind === "guest") return fail("sponsor_guest_custody_not_integrated");
  if (!keys(raw, ["version", "family", "campaignId", "policyVersion", "consumptionId", "intentKey", "actorKind", "actorUserId", "sessionDigest", "payerUserId", "ownerUserId", "projectId", "documentId", "sourceRevision", "sourceDigest", "orderedAssetDigests", "rightsDigest", "compiledInputDigest", "transferEnvelopeDigest", "recipe", "issuedAtMs", "expiresAtMs", "templateDigest"])
    || raw.version !== 4 || raw.family !== policy.family || raw.actorKind !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.consumptionId, raw.intentKey, raw.actorUserId, raw.payerUserId, raw.ownerUserId, raw.projectId, raw.documentId].every(id)
    || ![raw.sessionDigest, raw.sourceDigest, raw.rightsDigest, raw.compiledInputDigest, raw.transferEnvelopeDigest, raw.templateDigest].every(hash)
    || !integer(raw.sourceRevision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(raw.orderedAssetDigests) || raw.orderedAssetDigests.length !== 0
    || !integer(raw.issuedAtMs, Math.max(policy.startsAtMs, policy.resources.startsAtMs), policy.expiresAtMs)
    || !integer(raw.expiresAtMs, Number(raw.issuedAtMs) + 1, Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, Number(raw.issuedAtMs) + policy.maximumGrantLifetimeMs))) return fail("sponsor_envelope_invalid");
  if (raw.campaignId !== policy.campaignId || raw.policyVersion !== policy.policyVersion || raw.payerUserId !== policy.payerUserId
    || raw.actorUserId !== raw.ownerUserId || raw.actorUserId === raw.payerUserId
    || !policy.templates.some(template => recipeMatchesSponsorStoryTemplate(template, raw.recipe))) return fail("sponsor_envelope_not_eligible");
  const envelope = freeze(JSON.parse(canonicalJson(raw)) as SponsorEnvelopeV4);
  const templateDigests = await Promise.all(policy.templates.map(template => digest(template)));
  if (!policy.templates.some((template, index) => templateDigests[index] === envelope.templateDigest
    && recipeMatchesSponsorStoryTemplate(template, envelope.recipe))) return fail("sponsor_envelope_not_eligible");
  const [policyDigest, envelopeDigest] = await Promise.all([digest(policy), digest(envelope)]);
  return freeze({ policy, envelope, policyJson: canonicalJson(policy), envelopeJson: canonicalJson(envelope), policyDigest, envelopeDigest });
}

async function compileSponsorSlidesEnvelope(policy: SponsorPolicyV5, raw: unknown) {
  if (jsonIssues(raw).length) return fail("sponsor_envelope_invalid");
  if (record(raw) && raw.actorKind === "guest") return fail("sponsor_guest_custody_not_integrated");
  if (!keys(raw, ["version", "family", "campaignId", "policyVersion", "consumptionId", "intentKey", "actorKind", "actorUserId", "sessionDigest", "payerUserId", "ownerUserId", "projectId", "documentId", "sourceRevision", "sourceDigest", "orderedAssetDigests", "rightsDigest", "compiledInputDigest", "transferEnvelopeDigest", "recipe", "issuedAtMs", "expiresAtMs", "templateDigest"])
    || raw.version !== 5 || raw.family !== policy.family || raw.actorKind !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.consumptionId, raw.intentKey, raw.actorUserId, raw.payerUserId, raw.ownerUserId, raw.projectId, raw.documentId].every(id)
    || ![raw.sessionDigest, raw.sourceDigest, raw.rightsDigest, raw.compiledInputDigest, raw.transferEnvelopeDigest, raw.templateDigest].every(hash)
    || !integer(raw.sourceRevision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(raw.orderedAssetDigests) || raw.orderedAssetDigests.length !== 0
    || !integer(raw.issuedAtMs, Math.max(policy.startsAtMs, policy.resources.startsAtMs), policy.expiresAtMs)
    || !integer(raw.expiresAtMs, Number(raw.issuedAtMs) + 1, Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, Number(raw.issuedAtMs) + policy.maximumGrantLifetimeMs))) return fail("sponsor_envelope_invalid");
  if (raw.campaignId !== policy.campaignId || raw.policyVersion !== policy.policyVersion || raw.payerUserId !== policy.payerUserId
    || raw.actorUserId !== raw.ownerUserId || raw.actorUserId === raw.payerUserId
    || !policy.templates.some(template => recipeMatchesSponsorSlidesTemplate(template, raw.recipe))) return fail("sponsor_envelope_not_eligible");
  const envelope = freeze(JSON.parse(canonicalJson(raw)) as SponsorEnvelopeV5);
  const templateDigests = await Promise.all(policy.templates.map(template => digest(template)));
  if (!policy.templates.some((template, index) => templateDigests[index] === envelope.templateDigest
    && recipeMatchesSponsorSlidesTemplate(template, envelope.recipe))) return fail("sponsor_envelope_not_eligible");
  const [policyDigest, envelopeDigest] = await Promise.all([digest(policy), digest(envelope)]);
  return freeze({ policy, envelope, policyJson: canonicalJson(policy), envelopeJson: canonicalJson(envelope), policyDigest, envelopeDigest });
}

/** Hashes source/rights/transfer evidence without copying creative text. They do
 * not prove rights, identity or custody; native commit-time authority is required. */
export async function compileSponsorEnvelope(rawPolicy: unknown, rawEnvelope: unknown) {
  const policy = readSponsorPolicy(rawPolicy);
  if (policy.version === 6) return compileSponsorSceneEnvelope(policy, rawEnvelope);
  if (policy.mode === "disabled") return fail("sponsor_disabled");
  if (policy.version === 4) return compileSponsorStoryEnvelope(policy, rawEnvelope);
  if (policy.version === 5) return compileSponsorSlidesEnvelope(policy, rawEnvelope);
  if (jsonIssues(rawEnvelope).length) return fail("sponsor_envelope_invalid");
  if (record(rawEnvelope) && rawEnvelope.actorKind === "guest") return fail("sponsor_guest_custody_not_integrated");
  if (!keys(rawEnvelope, ["version", "campaignId", "policyVersion", "consumptionId", "intentKey", "actorKind", "actorUserId", "sessionDigest", "payerUserId", "ownerUserId", "projectId", "documentId", "sourceRevision", "sourceDigest", "orderedAssetDigests", "rightsDigest", "compiledInputDigest", "transferEnvelopeDigest", "recipe", "issuedAtMs", "expiresAtMs", ...(policy.version === 2 ? ["templateDigest"] : [])])
    || rawEnvelope.version !== policy.version || policy.version === 2 && !hash(rawEnvelope.templateDigest) || rawEnvelope.actorKind !== "canonical-principal"
    || ![rawEnvelope.campaignId, rawEnvelope.policyVersion, rawEnvelope.consumptionId, rawEnvelope.intentKey, rawEnvelope.actorUserId, rawEnvelope.payerUserId, rawEnvelope.ownerUserId, rawEnvelope.projectId, rawEnvelope.documentId].every(id)
    || ![rawEnvelope.sessionDigest, rawEnvelope.sourceDigest, rawEnvelope.rightsDigest, rawEnvelope.compiledInputDigest, rawEnvelope.transferEnvelopeDigest].every(hash)
    || !integer(rawEnvelope.sourceRevision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(rawEnvelope.orderedAssetDigests) || rawEnvelope.orderedAssetDigests.length > 32 || !rawEnvelope.orderedAssetDigests.every(hash)
    || !validRecipe(rawEnvelope.recipe) || !integer(rawEnvelope.issuedAtMs, policy.startsAtMs, policy.expiresAtMs)
    || !integer(rawEnvelope.expiresAtMs, rawEnvelope.issuedAtMs + 1, Math.min(policy.expiresAtMs, rawEnvelope.issuedAtMs + policy.maximumGrantLifetimeMs))) return fail("sponsor_envelope_invalid");
  if (rawEnvelope.campaignId !== policy.campaignId || rawEnvelope.policyVersion !== policy.policyVersion
    || rawEnvelope.payerUserId !== policy.payerUserId || rawEnvelope.actorUserId !== rawEnvelope.ownerUserId
    || rawEnvelope.actorUserId === rawEnvelope.payerUserId
    || (policy.version === 1 && !policy.recipes.some(recipe => canonicalJson(recipe) === canonicalJson(rawEnvelope.recipe)))) return fail("sponsor_envelope_not_eligible");
  const envelope = freeze(JSON.parse(canonicalJson(rawEnvelope)) as SponsorEnvelope);
  if (policy.version === 2) {
    const templateDigests = await Promise.all(policy.templates.map(template => digest(template)));
    if (!policy.templates.some((template, index) => templateDigests[index] === (envelope as SponsorEnvelopeV2).templateDigest && recipeMatchesSponsorTemplate(template, envelope.recipe))) return fail("sponsor_envelope_not_eligible");
  }
  // Copy/freeze before hashing: mutation during WebCrypto must not change the envelope.
  const [policyDigest, envelopeDigest] = await Promise.all([digest(policy), digest(envelope)]);
  return freeze({ policy, envelope, policyJson: canonicalJson(policy), envelopeJson: canonicalJson(envelope), policyDigest, envelopeDigest });
}


/** Closed V6 grammar; the runtime separately requires genuine native preparation. */
export function readSponsorScenePolicy(raw: unknown): SponsorPolicyV6 {
  raw = captureSponsorSceneJson(raw);
  if (jsonIssues(raw).length) return fail("sponsor_policy_invalid");
  if (!keys(raw, ["version", "family", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "templates", "resources"])
    || raw.version !== 6 || raw.family !== "canonical-scene-screenplay@1" || raw.mode !== "candidate" || raw.audience !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.payerUserId].every(id) || !hash(raw.approvalReceiptDigest)
    || !integer(raw.startsAtMs, 0, 8_640_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_640_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.maximumGrantLifetimeMs, 1, 900_000)
    || !integer(raw.maximumMicrousd, 1, 1_000_000_000_000)
    || ![raw.maximumAdmissions, raw.maximumAdmissionsPerActor, raw.maximumAdmissionsPerWindow, raw.maximumAdmissionsPerActorWindow].every(value => integer(value, 1, 100_000))
    || !integer(raw.windowMs, 1, 86_400_000) || !Array.isArray(raw.templates) || raw.templates.length !== 1
    || Number(raw.maximumAdmissionsPerActor) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerWindow) > Number(raw.maximumAdmissions)
    || Number(raw.maximumAdmissionsPerActorWindow) > Number(raw.maximumAdmissionsPerActor)) return fail("sponsor_policy_invalid");
  const templates = raw.templates.map(readSponsorSceneCampaignTemplate), resources = readSponsorResourceLimits(raw.resources);
  if (resources.version !== 1 || resources.startsAtMs < raw.startsAtMs || resources.expiresAtMs > raw.expiresAtMs
    || templates.some(template => template.maximumMicrousd > Number(raw.maximumMicrousd))) return fail("sponsor_policy_invalid");
  return freeze(JSON.parse(canonicalJson({ ...raw, templates, resources })) as SponsorPolicyV6);
}


/** Digest-bearing review material only, never a grant or native source proof. */
export async function compileSponsorSceneEnvelope(rawPolicy: unknown, raw: unknown) {
  raw = captureSponsorSceneJson(raw);
  const policy = readSponsorScenePolicy(rawPolicy);
  if (jsonIssues(raw).length) return fail("sponsor_envelope_invalid");
  if (record(raw) && raw.actorKind === "guest") return fail("sponsor_guest_custody_not_integrated");
  if (!keys(raw, ["version", "family", "campaignId", "policyVersion", "consumptionId", "intentKey", "actorKind", "actorUserId", "sessionDigest", "payerUserId", "ownerUserId", "projectId", "documentId", "sourceRevision", "sourceDigest", "orderedAssetDigests", "rightsDigest", "compiledInputDigest", "transferEnvelopeDigest", "recipe", "issuedAtMs", "expiresAtMs", "templateDigest"])
    || raw.version !== 6 || raw.family !== policy.family || raw.actorKind !== "canonical-principal"
    || ![raw.campaignId, raw.policyVersion, raw.consumptionId, raw.intentKey, raw.actorUserId, raw.payerUserId, raw.ownerUserId, raw.projectId, raw.documentId].every(id)
    || ![raw.sessionDigest, raw.sourceDigest, raw.rightsDigest, raw.compiledInputDigest, raw.transferEnvelopeDigest, raw.templateDigest].every(hash)
    || !integer(raw.sourceRevision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(raw.orderedAssetDigests) || raw.orderedAssetDigests.length !== 0
    || !integer(raw.issuedAtMs, Math.max(policy.startsAtMs, policy.resources.startsAtMs), policy.expiresAtMs)
    || !integer(raw.expiresAtMs, Number(raw.issuedAtMs) + 1, Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, Number(raw.issuedAtMs) + policy.maximumGrantLifetimeMs))) return fail("sponsor_envelope_invalid");
  if (raw.campaignId !== policy.campaignId || raw.policyVersion !== policy.policyVersion || raw.payerUserId !== policy.payerUserId
    || raw.actorUserId !== raw.ownerUserId || raw.actorUserId === raw.payerUserId
    || !policy.templates.some(template => recipeMatchesSponsorSceneTemplate(template, raw.recipe))) return fail("sponsor_envelope_not_eligible");
  const envelope = freeze(JSON.parse(canonicalJson(raw)) as SponsorEnvelopeV6);
  const templateDigests = await Promise.all(policy.templates.map(template => digest(template)));
  if (!policy.templates.some((template, index) => templateDigests[index] === envelope.templateDigest
    && recipeMatchesSponsorSceneTemplate(template, envelope.recipe))) return fail("sponsor_envelope_not_eligible");
  const [policyDigest, envelopeDigest] = await Promise.all([digest(policy), digest(envelope)]);
  return freeze({ policy, envelope, policyJson: canonicalJson(policy), envelopeJson: canonicalJson(envelope), policyDigest, envelopeDigest });
}
