import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDraftId, experienceResourceId } from "../src/experiences/intake.ts";
import { matchSponsorImageTemplate, readSponsorCampaignTemplate, recipeMatchesSponsorTemplate, type SponsorImageCampaignTemplate, type SponsorImageTransport } from "./experience-sponsor-campaign.ts";
import { sponsorImageTextSource, sponsorImageTextSourceForRetainedFormat, requireRetainedSponsorImageFormat, type RetainedSponsorImageFormat } from "./experience-sponsor-image-format.ts";
import { readSponsorResourceLimits, type SponsorResourceLimits } from "./experience-sponsor-resources.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { OutputPreflight } from "../src/model/output-delivery-contract.ts";

/** Candidate contracts only. No database, policy installation, payer approval,
 * guest proof, native admission, dispatch or read authority is created here.
 * Canonical v1/v2 retain their own compiler and continue to reject guests. */
export class GuestSponsorContractError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "GuestSponsorContractError"; }
}
const fail = (part: string): never => { throw new GuestSponsorContractError(`guest_sponsor_${part}`); };
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const nativeHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
const guestPolicyId = (value: unknown): value is string => id(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const guest = (value: unknown): value is string => typeof value === "string" && value.startsWith("guest:") && uuid(value.slice(6));
const draft = (value: unknown): value is string => typeof value === "string" && /^experience-draft-[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, names);
const maxTime = 8_000_000_000_000;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function capture(raw: unknown, part: string): unknown {
  if (jsonIssues(raw).length || new TextEncoder().encode(canonicalJson(raw)).byteLength > 131072) return fail(`${part}_invalid`);
  return freeze(JSON.parse(canonicalJson(raw)) as unknown);
}
function origin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}
function isoTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return integer(time, 0, maxTime) && new Date(time).toISOString() === value ? time : null;
}

export type GuestSponsorAdmissionBinding = Readonly<{
  protocol: "guest-image-source@1"; origin: string;
  sessionPolicyId: string; sessionTermsDigest: string;
  sourcePolicyId: string; sourcePolicyDigest: string; releaseHash: string;
}>;
export type GuestSponsorPolicyV3 = Readonly<{
  version: 3; mode: "candidate"; campaignId: string; policyVersion: string; payerUserId: string;
  audience: "guest-session"; approvalReceiptDigest: string;
  startsAtMs: number; expiresAtMs: number; maximumGrantLifetimeMs: number;
  maximumAdmissions: number; maximumMicrousd: number; maximumAdmissionsPerActor: number;
  windowMs: number; maximumAdmissionsPerWindow: number; maximumAdmissionsPerActorWindow: number;
  templates: readonly [SponsorImageCampaignTemplate]; resources: Readonly<SponsorResourceLimits>;
  guestAdmission: GuestSponsorAdmissionBinding;
}>;
const policyKeys = ["version", "mode", "campaignId", "policyVersion", "payerUserId", "audience", "approvalReceiptDigest", "startsAtMs", "expiresAtMs", "maximumGrantLifetimeMs", "maximumAdmissions", "maximumMicrousd", "maximumAdmissionsPerActor", "windowMs", "maximumAdmissionsPerWindow", "maximumAdmissionsPerActorWindow", "templates", "resources", "guestAdmission"];
const admissionKeys = ["protocol", "origin", "sessionPolicyId", "sessionTermsDigest", "sourcePolicyId", "sourcePolicyDigest", "releaseHash"];
export function readGuestSponsorPolicy(raw: unknown): GuestSponsorPolicyV3 {
  const value = capture(raw, "policy");
  if (!keys(value, policyKeys) || value.version !== 3 || value.mode !== "candidate" || value.audience !== "guest-session"
    || ![value.campaignId, value.policyVersion, value.payerUserId].every(id) || String(value.payerUserId).startsWith("guest:")
    || !hash(value.approvalReceiptDigest) || !integer(value.startsAtMs, 0, maxTime)
    || !integer(value.expiresAtMs, value.startsAtMs + 1, maxTime) || !integer(value.maximumGrantLifetimeMs, 1, 900000)
    || !integer(value.maximumMicrousd, 1, 1_000_000_000_000) || !integer(value.windowMs, 1, 86400000)
    || ![value.maximumAdmissions, value.maximumAdmissionsPerActor, value.maximumAdmissionsPerWindow, value.maximumAdmissionsPerActorWindow].every(v => integer(v, 1, 100000))
    || !Array.isArray(value.templates) || value.templates.length !== 1 || !keys(value.guestAdmission, admissionKeys)) return fail("policy_invalid");
  const admission = value.guestAdmission;
  if (admission.protocol !== "guest-image-source@1" || !origin(admission.origin)
    || ![admission.sessionPolicyId, admission.sourcePolicyId].every(guestPolicyId)
    || ![admission.sessionTermsDigest, admission.sourcePolicyDigest, admission.releaseHash].every(hash)
    || Number(value.maximumAdmissionsPerActor) > Number(value.maximumAdmissions)
    || Number(value.maximumAdmissionsPerWindow) > Number(value.maximumAdmissions)
    || Number(value.maximumAdmissionsPerActorWindow) > Number(value.maximumAdmissionsPerActor)
    || Number(value.maximumAdmissionsPerActorWindow) > Number(value.maximumAdmissionsPerWindow)) return fail("policy_invalid");
  let template: SponsorImageCampaignTemplate, resources: Readonly<SponsorResourceLimits>;
  try { template = readSponsorCampaignTemplate(value.templates[0]); resources = readSponsorResourceLimits(value.resources); }
  catch { return fail("policy_invalid"); }
  if (template.releaseDigest !== admission.releaseHash || template.maximumMicrousd > Number(value.maximumMicrousd)
    || resources.startsAtMs < value.startsAtMs || resources.expiresAtMs > value.expiresAtMs) return fail("policy_invalid");
  return value as GuestSponsorPolicyV3;
}

export type GuestSponsorApprovalProposalV1 = Readonly<{
  version: 1; purpose: "guest-sponsored-image";
  policy: Omit<GuestSponsorPolicyV3, "approvalReceiptDigest">;
  issuerProtocol: "guest-image-source@1";
}>;
/** Hashing proposed terms is not payer approval; no accepted approval is inferred. */
export async function compileGuestSponsorApprovalProposal(raw: unknown) {
  const value = capture(raw, "approval_proposal");
  if (!keys(value, ["version", "purpose", "policy", "issuerProtocol"]) || value.version !== 1
    || value.purpose !== "guest-sponsored-image" || value.issuerProtocol !== "guest-image-source@1"
    || !record(value.policy) || Object.hasOwn(value.policy, "approvalReceiptDigest")) return fail("approval_proposal_invalid");
  // A placeholder validates finite shape before hashing; it never passes through
  // the canonical-principal policy compiler or becomes an approval receipt.
  readGuestSponsorPolicy({ ...value.policy, approvalReceiptDigest: `sha256:${"0".repeat(64)}` });
  const proposal = value as GuestSponsorApprovalProposalV1;
  const termsJson = canonicalJson(proposal), termsDigest = await digest(proposal);
  const policy = readGuestSponsorPolicy({ ...proposal.policy, approvalReceiptDigest: termsDigest });
  return freeze({ qualification: "validation-only" as const, proposal, policy, policyJson: canonicalJson(policy), policyDigest: await digest(policy), termsJson, termsDigest });
}

export type GuestSponsorSessionBinding = Readonly<{
  domain: "forma-sponsor-guest-session@1";
  sessionId: string; guestSubject: string; projectId: string; documentId: string;
  sessionPolicyId: string; sessionTermsDigest: string; expiresAtMs: number;
}>;
const sessionKeys = ["domain", "sessionId", "guestSubject", "projectId", "documentId", "sessionPolicyId", "sessionTermsDigest", "expiresAtMs"];
export async function compileGuestSponsorSessionBinding(raw: unknown) {
  const value = capture(raw, "session_binding");
  if (!keys(value, sessionKeys) || value.domain !== "forma-sponsor-guest-session@1"
    || ![value.sessionId, value.projectId, value.documentId].every(uuid) || !guest(value.guestSubject)
    || !guestPolicyId(value.sessionPolicyId) || !hash(value.sessionTermsDigest) || !integer(value.expiresAtMs, 1, maxTime)) return fail("session_binding_invalid");
  const binding = value as GuestSponsorSessionBinding;
  const draftId = await experienceDraftId(binding.guestSubject, binding.sessionId);
  const [projectId, documentId] = await Promise.all([experienceResourceId(draftId, "project"), experienceResourceId(draftId, "document")]);
  if (binding.projectId !== projectId || binding.documentId !== documentId) return fail("session_binding_invalid");
  return freeze({ binding, bindingJson: canonicalJson(binding), sessionDigest: await digest(binding) });
}
export type GuestSponsorSourceBinding = Readonly<{
  domain: "forma-sponsor-guest-source@1"; sessionDigest: string;
  sourcePolicyId: string; sourcePolicyDigest: string;
  draftId: string; draftHash: string; requestDigest: string; contentDigest: string; releaseHash: string;
  sourceHead: number; sourceEventIds: readonly string[]; expiresAtMs: number;
}>;
const sourceKeys = ["domain", "sessionDigest", "sourcePolicyId", "sourcePolicyDigest", "draftId", "draftHash", "requestDigest", "contentDigest", "releaseHash", "sourceHead", "sourceEventIds", "expiresAtMs"];
export async function compileGuestSponsorSourceBinding(raw: unknown) {
  const value = capture(raw, "source_binding");
  if (!keys(value, sourceKeys) || value.domain !== "forma-sponsor-guest-source@1" || !guestPolicyId(value.sourcePolicyId) || !draft(value.draftId)
    || ![value.sessionDigest, value.sourcePolicyDigest, value.draftHash, value.requestDigest, value.contentDigest, value.releaseHash].every(hash)
    || !integer(value.sourceHead, 3, 16) || !integer(value.expiresAtMs, 1, maxTime)
    || !Array.isArray(value.sourceEventIds) || value.sourceEventIds.length !== value.sourceHead
    || !value.sourceEventIds.every(uuid) || new Set(value.sourceEventIds).size !== value.sourceEventIds.length) return fail("source_binding_invalid");
  const binding = value as GuestSponsorSourceBinding;
  return freeze({ binding, bindingJson: canonicalJson(binding), guestSourceDigest: await digest(binding) });
}

export type GuestSponsorDriverCommand = Readonly<{
  version: 1; action: "run-guest-sponsored-image"; campaignId: string; sessionId: string;
  documentId: string; draftId: string; draftHash: string; guestSourceDigest: string;
}>;
export async function deriveGuestSponsorDriver(raw: unknown) {
  const value = capture(raw, "driver");
  if (!keys(value, ["version", "action", "campaignId", "sessionId", "documentId", "draftId", "draftHash", "guestSourceDigest"])
    || value.version !== 1 || value.action !== "run-guest-sponsored-image" || !id(value.campaignId)
    || !uuid(value.sessionId) || !uuid(value.documentId) || !draft(value.draftId)
    || !hash(value.draftHash) || !hash(value.guestSourceDigest)) return fail("driver_invalid");
  const command = value as GuestSponsorDriverCommand;
  if (command.documentId !== await experienceResourceId(command.draftId, "document")) return fail("driver_invalid");
  // Payload changes conflict at the same intent/stage keys rather than acquire
  // a second purchase identity. Native issuer/receipt replay enforces conflict.
  const root = (await digest({ domain: "guest-sponsored-image-intent@1", campaignId: command.campaignId, sessionId: command.sessionId, draftId: command.draftId })).slice(7);
  return freeze({ command, commandJson: canonicalJson(command), commandDigest: await digest(command),
    intentKey: `guest-sponsor-intent-${root}`, driverId: `guest-sponsor-driver-${root}`,
    stageKeys: { preflight: `guest-sponsor-preflight-${root}`, authorize: `guest-sponsor-authorize-${root}`, run: `guest-sponsor-run-${root}` } });
}

export type GuestImageAuthorizationV1 = Readonly<{
  version: 1; purpose: "authorize-guest-sponsored-image"; sessionDigest: string; guestSourceDigest: string;
  policyDigest: string; termsDigest: string; maximumMicrousd: number; preflightId: string; explicitAuthorization: true;
}>;
export type GuestSponsorEnvelopeV3 = Readonly<{
  version: 3; campaignId: string; policyVersion: string; consumptionId: string; intentKey: string;
  actorKind: "guest"; actorUserId: string; sessionDigest: string; payerUserId: string;
  ownerUserId: string; projectId: string; documentId: string; sourceRevision: number; sourceDigest: string;
  orderedAssetDigests: readonly []; rightsDigest: string; compiledInputDigest: string; transferEnvelopeDigest: string;
  recipe: SponsorRecipe; templateDigest: string; issuedAtMs: number; expiresAtMs: number;
  guestSource: GuestSponsorSourceBinding; guestAuthorizationDigest: string;
}>;
export type GuestSponsorEnvelopeEvidence = Readonly<{
  sessionBinding: GuestSponsorSessionBinding;
  authorization: GuestImageAuthorizationV1;
  native: Readonly<{ sourceRevision: number; preflight: OutputPreflight; contextSnapshot: Record<string, unknown>; transport: SponsorImageTransport }>;
}>;
const envelopeKeys = ["version", "campaignId", "policyVersion", "consumptionId", "intentKey", "actorKind", "actorUserId", "sessionDigest", "payerUserId", "ownerUserId", "projectId", "documentId", "sourceRevision", "sourceDigest", "orderedAssetDigests", "rightsDigest", "compiledInputDigest", "transferEnvelopeDigest", "recipe", "templateDigest", "issuedAtMs", "expiresAtMs", "guestSource", "guestAuthorizationDigest"];
const authorizationKeys = ["version", "purpose", "sessionDigest", "guestSourceDigest", "policyDigest", "termsDigest", "maximumMicrousd", "preflightId", "explicitAuthorization"];
const preflightKeys = ["id", "planRevisionId", "sourceDigest", "requirementsDigest", "targets", "operationAttempts", "maximumMicrousd", "maximumCalls", "expiresAt", "createdAt", "termsDigest"];

const factKeys = ["block_id", "document_id", "type", "role", "intent", "handle", "position", "locked", "active", "effect", "properties", "authority", "source_event_refs"];
/** The unchanged intake has no composed relationships, pins, canvas, tail or
 * extra media properties. This is shape/lineage consistency only: the issuer
 * must still prove these exact facts against the retained native source. */
function closedImageSnapshot(snapshot: Record<string, unknown>, documentId: string, source: GuestSponsorSourceBinding) {
  if (!keys(snapshot, ["facts", "relationships", "context_groups", "pins", "tail"]) || !Array.isArray(snapshot.facts)
    || snapshot.facts.length < 1 || snapshot.facts.length > 13
    || [snapshot.relationships, snapshot.context_groups, snapshot.pins, snapshot.tail].some(value => !Array.isArray(value) || value.length !== 0)) return false;
  const blocks = new Set<string>();
  return snapshot.facts.every(fact => {
    if (!keys(fact, factKeys) || !uuid(fact.block_id) || blocks.has(fact.block_id) || fact.document_id !== documentId
      || fact.role !== fact.type || typeof fact.type !== "string" || typeof fact.intent !== "string" || typeof fact.effect !== "string"
      || typeof fact.handle !== "string" || typeof fact.position !== "string" || typeof fact.locked !== "boolean" || fact.active !== true
      || !Array.isArray(fact.source_event_refs) || fact.source_event_refs.length !== 1 || !source.sourceEventIds.includes(String(fact.source_event_refs[0]))
      || !record(fact.properties)) return false;
    blocks.add(fact.block_id);
    const p = fact.properties, decision = Object.hasOwn(p, "experience_binding");
    const ratio = fact.type === "format" && fact.handle === "format/experience-ratio";
    if (Object.hasOwn(p, "image_format") !== ratio || ratio && !decision) return false;
    if (!keys(p, ["text", "subtype", "weight", "authority", "experience_origin", "experience_release", "spatial_scope",
      ...(decision ? ["experience_binding", "experience_value"] : []), ...(Object.hasOwn(p, "image_format") ? ["image_format"] : [])])
      || typeof p.text !== "string" || typeof p.subtype !== "string" || p.weight !== .8
      || !["authored", "inferred"].includes(String(p.authority)) || fact.authority !== p.authority
      || !["authored", "default"].includes(String(p.experience_origin)) || p.experience_release !== source.releaseHash
      || decision && (typeof p.experience_binding !== "string" || !ratio && typeof p.experience_value !== "string")
      || !same(p.spatial_scope, { schema_version: 1, kind: "document", coordinate_space: "document-normalized", feather: 0, falloff: "hard", polarity: "inside" })) return false;
    return true;
  });
}

/** Supplied native evidence is checked for exact contract consistency, not read
 * from storage. The future issuer must independently prove original source,
 * native plan/preflight, current guest possession and payer approval. */
export async function compileGuestSponsorEnvelope(rawPolicy: unknown, rawEnvelope: unknown, rawEvidence: unknown) {
  return compileGuestEnvelope(rawPolicy, rawEnvelope, rawEvidence);
}
export async function compileRetainedGuestSponsorEnvelope(rawPolicy: unknown, rawEnvelope: unknown, rawEvidence: unknown, format: RetainedSponsorImageFormat) {
  requireRetainedSponsorImageFormat(format);
  return compileGuestEnvelope(rawPolicy, rawEnvelope, rawEvidence, format);
}
async function compileGuestEnvelope(rawPolicy: unknown, rawEnvelope: unknown, rawEvidence: unknown, format?: RetainedSponsorImageFormat) {
  // Capture ALL caller-owned data before the first await, including nested
  // transport/settings. Hash completion cannot incorporate later mutation.
  const policy = readGuestSponsorPolicy(rawPolicy), value = capture(rawEnvelope, "envelope"), evidence = capture(rawEvidence, "evidence");
  const retained = format ? requireRetainedSponsorImageFormat(format) : null;
  if (retained && retained.release.releaseHash !== policy.guestAdmission.releaseHash) return fail("binding_mismatch");
  if (!keys(value, envelopeKeys) || value.version !== 3 || value.actorKind !== "guest"
    || ![value.campaignId, value.policyVersion, value.consumptionId, value.intentKey, value.payerUserId].every(id)
    || !guest(value.actorUserId) || value.ownerUserId !== value.actorUserId || value.payerUserId === value.actorUserId
    || !uuid(value.projectId) || !uuid(value.documentId) || !integer(value.sourceRevision, 0, Number.MAX_SAFE_INTEGER)
    || ![value.sessionDigest, value.sourceDigest, value.rightsDigest, value.compiledInputDigest, value.transferEnvelopeDigest, value.templateDigest, value.guestAuthorizationDigest].every(hash)
    || !Array.isArray(value.orderedAssetDigests) || value.orderedAssetDigests.length !== 0
    || !integer(value.issuedAtMs, policy.startsAtMs, policy.expiresAtMs) || !integer(value.expiresAtMs, value.issuedAtMs + 1, maxTime)
    || !keys(evidence, ["sessionBinding", "authorization", "native"]) || !keys(evidence.authorization, authorizationKeys)
    || !keys(evidence.native, ["sourceRevision", "preflight", "contextSnapshot", "transport"])) return fail("envelope_invalid");
  const envelope = value as GuestSponsorEnvelopeV3, auth = evidence.authorization, native = evidence.native;
  if (auth.version !== 1 || auth.purpose !== "authorize-guest-sponsored-image" || auth.explicitAuthorization !== true
    || ![auth.sessionDigest, auth.guestSourceDigest, auth.policyDigest].every(hash) || !nativeHash(auth.termsDigest)
    || !id(auth.preflightId) || !integer(auth.maximumMicrousd, 1, 1_000_000_000_000)
    || !integer(native.sourceRevision, 0, Number.MAX_SAFE_INTEGER) || !keys(native.preflight, preflightKeys)
    || !record(native.contextSnapshot) || !Array.isArray(native.contextSnapshot.facts) || native.contextSnapshot.facts.length < 1) return fail("evidence_invalid");
  const preflight = native.preflight;
  if (!id(preflight.id) || !id(preflight.planRevisionId) || ![preflight.sourceDigest, preflight.requirementsDigest, preflight.termsDigest].every(nativeHash)
    || !Array.isArray(preflight.targets) || preflight.targets.length !== 1 || !record(preflight.targets[0])
    || !id(preflight.targets[0].targetId) || !keys(preflight.operationAttempts, [preflight.targets[0].targetId])
    || preflight.maximumCalls !== 2 || preflight.maximumMicrousd !== envelope.recipe?.maximumMicrousd) return fail("evidence_invalid");
  const attempt = preflight.operationAttempts[preflight.targets[0].targetId];
  if (!keys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null) return fail("evidence_invalid");
  const preflightExpiry = isoTime(preflight.expiresAt), preflightCreated = isoTime(preflight.createdAt);
  if (preflightExpiry === null || preflightCreated === null || preflightExpiry <= preflightCreated || preflightCreated > envelope.issuedAtMs) return fail("evidence_invalid");
  const session = await compileGuestSponsorSessionBinding(evidence.sessionBinding), source = await compileGuestSponsorSourceBinding(envelope.guestSource);
  const admission = policy.guestAdmission, s = session.binding, g = source.binding;
  if (retained && retained.release.releaseHash !== g.releaseHash) return fail("binding_mismatch");
  if (envelope.campaignId !== policy.campaignId || envelope.policyVersion !== policy.policyVersion || envelope.payerUserId !== policy.payerUserId
    || envelope.actorUserId !== s.guestSubject || envelope.projectId !== s.projectId || envelope.documentId !== s.documentId
    || envelope.sessionDigest !== session.sessionDigest || g.sessionDigest !== session.sessionDigest
    || s.sessionPolicyId !== admission.sessionPolicyId || s.sessionTermsDigest !== admission.sessionTermsDigest
    || g.sourcePolicyId !== admission.sourcePolicyId || g.sourcePolicyDigest !== admission.sourcePolicyDigest || g.releaseHash !== admission.releaseHash
    || g.draftId !== await experienceDraftId(s.guestSubject, s.sessionId) || g.expiresAtMs > s.expiresAtMs
    || native.sourceRevision < g.sourceHead || !closedImageSnapshot(native.contextSnapshot, s.documentId, g)
    || envelope.issuedAtMs < policy.resources.startsAtMs
    || envelope.expiresAtMs > Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, s.expiresAtMs, g.expiresAtMs, preflightExpiry, envelope.issuedAtMs + policy.maximumGrantLifetimeMs)) return fail("binding_mismatch");
  const offered = preflight.targets[0];
  if (!recipeMatchesSponsorTemplate(policy.templates[0], envelope.recipe)
    || !matchSponsorImageTemplate(policy.templates[0], { recipe: envelope.recipe, offered, transport: native.transport })
    || !await (format ? sponsorImageTextSourceForRetainedFormat(native.contextSnapshot.facts, format) : sponsorImageTextSource(native.contextSnapshot.facts))
    || !native.contextSnapshot.facts.some(fact => record(fact) && fact.active !== false && String(fact.type).toLowerCase() !== "output" && fact.intent !== "prohibit" && fact.effect !== "must_not_include")) return fail("recipe_mismatch");
  const { termsDigest: ignoredTerms, ...quoted } = preflight; void ignoredTerms;
  const [policyDigest, templateDigest, termsDigest, routeDigest, settingsDigest, rightsDigest, compiledInputDigest, transferEnvelopeDigest, authorizationDigest] = await Promise.all([
    digest(policy), digest(policy.templates[0]), digest(quoted), digest(offered), digest(offered.settings),
    digest({ domain: "forma-sponsor-guest-source-rights@1", guestAdmission: admission, guestSource: g, sourceRevision: native.sourceRevision, sourceDigest: preflight.sourceDigest }),
    digest({ snapshot: native.contextSnapshot, settings: offered.settings }),
    digest({ sourceDigest: preflight.sourceDigest, requirementsDigest: preflight.requirementsDigest, settings: offered.settings }), digest(auth),
  ]);
  const driver = await deriveGuestSponsorDriver({ version: 1, action: "run-guest-sponsored-image", campaignId: policy.campaignId,
    sessionId: s.sessionId, documentId: s.documentId, draftId: g.draftId, draftHash: g.draftHash, guestSourceDigest: source.guestSourceDigest });
  const consumptionId = `sponsor-consume-${(await digest({ campaignId: policy.campaignId, actorUserId: s.guestSubject, intentKey: driver.stageKeys.authorize })).slice(7)}`;
  if (envelope.intentKey !== driver.stageKeys.authorize || envelope.consumptionId !== consumptionId
    || envelope.sourceRevision !== native.sourceRevision || envelope.sourceDigest !== `sha256:${preflight.sourceDigest}`
    || envelope.templateDigest !== templateDigest || envelope.recipe.routeDigest !== routeDigest || envelope.recipe.settingsDigest !== settingsDigest
    || preflight.termsDigest !== termsDigest.slice(7) || envelope.rightsDigest !== rightsDigest || envelope.compiledInputDigest !== compiledInputDigest
    || envelope.transferEnvelopeDigest !== transferEnvelopeDigest || envelope.guestAuthorizationDigest !== authorizationDigest
    || auth.sessionDigest !== session.sessionDigest || auth.guestSourceDigest !== source.guestSourceDigest || auth.policyDigest !== policyDigest
    || auth.preflightId !== preflight.id || auth.termsDigest !== preflight.termsDigest || auth.maximumMicrousd !== envelope.recipe.maximumMicrousd) return fail("binding_mismatch");
  return freeze({ qualification: "validation-only" as const, policy, envelope, policyJson: canonicalJson(policy), envelopeJson: canonicalJson(envelope),
    policyDigest, envelopeDigest: await digest(envelope), evidence: evidence as GuestSponsorEnvelopeEvidence });
}
