import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsoredAudioReview, readSponsoredAudioActorRequest, digestSponsoredAudioReview,
  sponsoredAudioActorIntentMatchesNative } from "../src/experiences/sponsored-audio-actor-intent.ts";
import { audioMiniAppCostApprovalMatches, parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { parseAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { describeSponsorAudioAdmission, readSponsorAudioTemplateEvidence } from "./experience-sponsor-audio-evidence.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

const fail = (code = "sponsor_audio_actor_evidence_invalid"): never => { throw new SponsorEntitlementError(code); };
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"];

/** Dormant request evidence for an already-authorized ordinary native context.
 * No route, actor gesture attestation, payer approval, sponsor allowance, receipt
 * write or spending authority is created. The supplied review remains metadata.
 * Future sponsored custody requires its own finite read capability. */
export async function readSponsorAudioActorEvidence(trusted: OutputTrustedContext, rawCommand: Record<string, unknown>, rawReview: unknown) {
  const review = readSponsoredAudioReview(rawReview);
  if (jsonIssues(rawCommand).length || !record(rawCommand) || !exactKeys(rawCommand, commandKeys)) return fail();
  const command = freeze(JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>);
  if (command.action !== "authorize" || command.documentId !== trusted.scope.documentId || command.explicitAuthorization !== true
    || trusted.scope.kind !== "personal" || trusted.scope.actorUserId !== trusted.scope.ownerUserId
    || trusted.scope.actorUserId !== trusted.principal.userId || trusted.scope.contextId || trusted.scope.organizationId || trusted.scope.projectAccessId
    || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId
    || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length) return fail();
  const request = trusted.request, signal = request.signal, env = trusted.env, database = env.DB;
  const url = new URL(request.url);
  // This unregistered helper inspects the actual ordinary native request. A
  // future sponsored route needs a reviewed typed seam, never a rewritten URL.
  if (url.pathname !== `/api/experiences/drafts/${review.preview.draftId}/output/authorize` || url.search || url.hash
    || request.method !== "POST" || request.bodyUsed || review.preview.actorUserId !== trusted.scope.actorUserId
    || review.preview.projectId !== trusted.scope.projectId || review.preview.documentId !== trusted.scope.documentId
    || review.preview.sourceDigest !== trusted.sourceDigest || review.preview.requirementsDigest !== trusted.requirementsDigest) return fail();
  const identities = { scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events };
  const source = () => canonicalJson({ scope: trusted.scope, principal: { userId: trusted.principal.userId,
    consentVersion: trusted.principal.consentVersion, fictional: trusted.principal.fictional ?? false,
    projectExecution: trusted.principal.projectExecution ?? null, billingUserId: trusted.principal.billingUserId ?? null,
    authorizationSnapshot: trusted.principal.authorizationSnapshot ?? null }, projectContext: Boolean(trusted.projectContext),
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    ownerHead: trusted.ownerHead, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    context: trusted.context, events: trusted.events, assertions: trusted.sourceAssertions,
    configuration: { model: env.OPENAI_MODEL ?? null, audioProvider: env.FORMA_AUDIO_PROVIDER ?? null,
      audioModel: env.FAL_AUDIO_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null } });
  const requestIdentity = () => canonicalJson({ url: request.url, method: request.method, headers: [...request.headers] });
  const capturedSource = source(), capturedRequest = requestIdentity(), credentials = [env.OPENAI_API_KEY, env.FAL_KEY];
  const deadlines = sponsorCurrentSourceAssertions(trusted).flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]);
  const deadline = Math.min(Date.parse(review.expiresAt), Date.parse(review.preview.expiresAt), ...deadlines);
  const current = () => {
    if (signal.aborted || request.signal !== signal || trusted.request !== request || trusted.env !== env || env.DB !== database
      || trusted.scope !== identities.scope || trusted.principal !== identities.principal || trusted.context !== identities.context || trusted.events !== identities.events
      || source() !== capturedSource || requestIdentity() !== capturedRequest || env.OPENAI_API_KEY !== credentials[0] || env.FAL_KEY !== credentials[1]
      || !Number.isFinite(deadline) || !Number.isFinite(Date.now()) || Date.now() >= deadline) return fail("sponsor_audio_actor_lifetime_changed");
  };
  const checked = async <T>(work: () => Promise<T>): Promise<T> => {
    current(); const result = await work(); current(); return result;
  };
  current();
  // The inherited parser bounds decoded request bytes. It cannot preempt an
  // unresolved body read; abort/deadline is checked when that owned await ends.
  // No private native read starts before a complete supplied command matches.
  const supplied = readSponsoredAudioActorRequest(await checked(() => readSponsorInternalCommand(request, 4096)));
  if (supplied.termsDigest !== command.termsDigest || supplied.maximumMicrousd !== command.maximumMicrousd
    || supplied.explicitAuthorization !== command.explicitAuthorization || canonicalJson(supplied.audioCostConsent) !== canonicalJson(command.audioCostConsent)
    || supplied.termsDigest !== review.termsDigest || supplied.sponsorReview.campaignId !== review.campaignId
    || !audioMiniAppCostApprovalMatches(supplied.audioCostConsent, review.preview)) return fail();
  const reviewDigest = await checked(() => digestSponsoredAudioReview(review));
  if (supplied.sponsorReview.reviewDigest !== reviewDigest) return fail();
  // Hash owned copies before the final native proof reads. There is no async
  // hashing or caller callback between the final native proof and this return.
  const requestDigest = await checked(() => digest(supplied));
  const commandDigest = await checked(() => digest(command));
  const classification = await checked(() => classifySponsorIntakeDraft(env, review.preview.draftId));
  if (classification.kind !== "ordinary") return fail("sponsor_audio_actor_ordinary_context_required");
  // Negative classification grants no sponsored access. Retain it in the native
  // final proof as well; never reclassify a changed original as a new intent.
  const nativeTrusted = { ...trusted, sourceAssertions: [...trusted.sourceAssertions, classification.guard] };
  const description = await checked(() => describeSponsorAudioAdmission(nativeTrusted, command));
  const native = await checked(() => readSponsorAudioTemplateEvidence(nativeTrusted, command, description.recipe));
  current();
  const settings = record(native.offered.settings) ? native.offered.settings : null;
  const payload = settings && record(settings.payload) ? settings.payload : null;
  const contract = payload ? parseAudioOutputContract(payload.outputAudio) : null;
  const preview = settings ? parseAudioMiniAppCostPreview(settings.costPreview) : null;
  if (supplied.sponsorReview.reviewDigest !== reviewDigest || !contract || !preview || !sponsoredAudioActorIntentMatchesNative(review, supplied, {
    draftHash: contract.source.draftHash, termsDigest: command.termsDigest, preview,
    expiresAt: new Date(description.preflightExpiresAtMs).toISOString(),
  }) || canonicalJson(supplied.audioCostConsent) !== canonicalJson(native.consent)) return fail();
  const result = freeze({ version: 1 as const, kind: "sponsor-audio-actor-evidence" as const,
    review, reviewDigest, request: supplied, requestDigest, commandDigest, native: { description, ...native } });
  current();
  return result;
}
