import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceResourceId } from "../src/experiences/intake.ts";
import { readSponsoredVideoActorRequest, readSponsoredVideoReview, sponsoredVideoActorIntentMatchesNative,
  type SponsoredVideoActorRequest, type SponsoredVideoReview } from "../src/experiences/sponsored-video-actor-intent.ts";
import { readVideoExecutionOffer } from "../src/model/output-video-offer.ts";
import { readExperienceBody } from "./experience-intake-body.ts";
import { continueExperienceAuthorization, readDraft, retainedGuard } from "./experience-intake-read.ts";
import { experienceOutputAuthorization, experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope } from "./experience-output-binding.ts";
import { readExperienceOutputLineage } from "./experience-output-originals.ts";
import { sceneRenewalIndexAssertion, sceneRenewalNoExecutionAssertion } from "./experience-scene-renewal-proof.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { describeSponsorVideoAdmission } from "./experience-sponsor-video-evidence.ts";
import { inheritRetainedOutputPrivateBodies, outputCommandReceiptAssertion, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import { outputVideoPreparationIdentity } from "./output-video-source.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";

declare const proofBrand: unique symbol;
/** Request-local native actor intent, never payer approval or a private-read grant. */
export type SponsorVideoIntentProof = Readonly<{ [proofBrand]: true }>;
type Intent = Readonly<{
  requestBody: Readonly<{ draftHash: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true }>;
  envelope: Readonly<Record<string, unknown>>;
  envelopeDigest: string;
  native: Awaited<ReturnType<typeof describeSponsorVideoAdmission>>;
  expiresAtMs: number;
}>;
const proofs = new WeakMap<SponsorVideoIntentProof, { trusted: OutputTrustedContext; assertCurrent(): void; intent: Intent }>();
declare const actorProofBrand: unique symbol;
/** Actual Request/review evidence only. Neither this token nor parsed sponsor
 * metadata authenticates the campaign, payer approval, or a private-read grant. */
export type SponsorVideoActorIntentProof = Readonly<{ [actorProofBrand]: true }>;
type ActorIntent = Omit<Intent, "requestBody"> & Readonly<{
  requestBody: SponsoredVideoActorRequest; requestDigest: string; review: SponsoredVideoReview; reviewDigest: string;
}>;
const actorProofs = new WeakMap<SponsorVideoActorIntentProof, { trusted: OutputTrustedContext; assertCurrent(): void; intent: ActorIntent }>();
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization"];

/** Opaque identity and the full native envelope must survive the later issuer
 * join. This checks the captured Request/source, not a fresh database snapshot;
 * the future atomic issuer still owns current authority and payer validation. */
export function requireSponsorVideoIntentProof(proof: SponsorVideoIntentProof, trusted: OutputTrustedContext, candidateEnvelope?: unknown): Intent {
  const state = proofs.get(proof);
  if (!state || state.trusted !== trusted) return fail("sponsor_video_intent_unavailable");
  state.assertCurrent();
  if (candidateEnvelope !== undefined && (jsonIssues(candidateEnvelope).length
    || canonicalJson(candidateEnvelope) !== canonicalJson(state.intent.envelope))) return fail("sponsor_native_envelope_mismatch");
  state.assertCurrent();
  return state.intent;
}

/** Separate provenance: an ordinary token or copied DTO cannot be promoted. */
export function requireSponsorVideoActorIntentProof(proof: SponsorVideoActorIntentProof, trusted: OutputTrustedContext, candidateEnvelope?: unknown): ActorIntent {
  const state = actorProofs.get(proof);
  if (!state || state.trusted !== trusted) return fail("sponsor_video_actor_intent_unavailable");
  state.assertCurrent();
  if (candidateEnvelope !== undefined && (jsonIssues(candidateEnvelope).length
    || canonicalJson(candidateEnvelope) !== canonicalJson(state.intent.envelope))) return fail("sponsor_native_envelope_mismatch");
  state.assertCurrent();
  return state.intent;
}

function readIntent(trusted: OutputTrustedContext): Promise<SponsorVideoIntentProof>;
function readIntent(trusted: OutputTrustedContext, actor: { review: unknown }): Promise<SponsorVideoActorIntentProof>;
async function readIntent(trusted: OutputTrustedContext, actor?: { review: unknown }): Promise<SponsorVideoIntentProof | SponsorVideoActorIntentProof> {
  // Capture the review before any owned await; later caller mutation cannot
  // change what the actual Request's digest must name. This is not approval.
  const review = actor ? readSponsoredVideoReview(actor.review) : null;
  const request = trusted.request, env = trusted.env, database = env.DB, media = env.MEDIA, scope = trusted.scope;
  const plannerKey = env.OPENAI_API_KEY, videoKey = env.FAL_KEY;
  const source = () => JSON.stringify({ scope: trusted.scope, principal: trusted.principal, projectContext: trusted.projectContext,
    ownerHead: trusted.ownerHead, projectHead: trusted.projectHead, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    context: trusted.context, events: trusted.events, projection: trusted.projection, requirements: trusted.requirements,
    sourceAssertions: trusted.sourceAssertions, sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL, videoProvider: env.FORMA_VIDEO_PROVIDER, cohort: env.FORMA_PILOT_COHORT_ID } });
  const captured = source(), headers = canonicalJson([...request.headers]);
  const assertCurrent = () => {
    if (trusted.request !== request || trusted.env !== env || trusted.scope !== scope || env.DB !== database || env.MEDIA !== media
      || env.OPENAI_API_KEY !== plannerKey || env.FAL_KEY !== videoKey || request.signal.aborted || source() !== captured
      || canonicalJson([...request.headers]) !== headers) fail("sponsor_video_intent_changed");
  };
  assertCurrent();
  const url = new URL(request.url), path = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/output\/authorize$/u.exec(url.pathname);
  if (request.method !== "POST" || !path || url.search || request.headers.get("sec-fetch-site") === "cross-site"
    || request.headers.has("origin") && request.headers.get("origin") !== url.origin || request.bodyUsed
    || scope.kind !== "personal" || scope.ownerUserId !== scope.actorUserId || scope.organizationId || scope.projectAccessId || scope.contextId
    || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId
    || trusted.principal.userId !== scope.actorUserId || env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) return fail("sponsor_video_intent_request_invalid");
  const native: OutputTrustedContext = { ...trusted, env: { ...env }, scope: structuredClone(scope), principal: structuredClone(trusted.principal),
    context: structuredClone(trusted.context), projection: structuredClone(trusted.projection), events: structuredClone(trusted.events), sourceAssertions: structuredClone(trusted.sourceAssertions),
    sourceProblems: [...trusted.sourceProblems] };
  inheritRetainedOutputPrivateBodies(scope, native.scope);
  // Ordinary helper reads retain their existing custody contract. The two
  // phases bound this caller's wait; they do not cancel an already issued SQL.
  const controller = new AbortController();
  let active = true, deadlineMs = Math.min(Date.now() + 30000, review ? Date.parse(review.expiresAt) : Infinity), rejectStop!: (error: unknown) => void;
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  const abort = () => { controller.abort(); rejectStop(new SponsorEntitlementError("sponsor_video_intent_interrupted")); };
  let timer = setTimeout(abort, Math.max(1, deadlineMs - Date.now()));
  request.signal.addEventListener("abort", abort, { once: true });
  const check = () => { assertCurrent(); if (!active || controller.signal.aborted || Date.now() >= deadlineMs) fail("sponsor_video_intent_interrupted"); };
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    const pending = Promise.race([work, stop]);
    try { check(); } catch (error) { void pending.catch(() => undefined); throw error; }
    const value = await pending; check(); return value;
  };
  try {
    check();
    const body: unknown = await wait(readExperienceBody(request, controller.signal));
    check();
    if (!review && (!record(body) || jsonIssues(body).length || !exactKeys(body, ["draftHash", "termsDigest", "maximumMicrousd", "explicitAuthorization"])
      || typeof body.draftHash !== "string" || typeof body.termsDigest !== "string" || body.explicitAuthorization !== true
      || !Number.isSafeInteger(body.maximumMicrousd) || Number(body.maximumMicrousd) <= 0)) return fail("sponsor_video_intent_approval_required");
    const requestBody = review ? readSponsoredVideoActorRequest(body) : freeze(structuredClone(body)) as Intent["requestBody"];
    // Keep the complete supplied five-field body. The internal native command
    // is ordinary command data, never an ordinary proxy Request or proof.
    const actorRequest = review ? requestBody as SponsoredVideoActorRequest : null;
    const reviewDigest = review ? await wait(digest(review)) : null;
    check();
    if (actorRequest && (actorRequest.sponsorReview.campaignId !== review!.campaignId
      || actorRequest.sponsorReview.reviewDigest !== reviewDigest)) return fail("sponsor_video_actor_review_changed");
    const requestDigest = actorRequest ? await wait(digest(actorRequest)) : null;
    check();
    const classification = await wait(classifySponsorIntakeDraft(native.env, path[1]!));
    check();
    if (classification.kind !== "ordinary") return fail("sponsor_video_intent_scope_unsupported");
    const principal = await wait(readExistingPrincipalRequest(request, native.env, "creator", { account: "principal" }));
    check();
    if ("kind" in principal || principal.response || !principal.user || principal.user.userId !== scope.actorUserId
      || canonicalJson(principal.user.authorizationSnapshot ?? null) !== canonicalJson(native.principal.authorizationSnapshot ?? null)) return fail("sponsor_principal_changed");
    const auth = await wait(continueExperienceAuthorization(request, native.env, principal));
    check();
    if (auth instanceof Response) return fail("sponsor_video_intent_scope_unsupported");
    const draft = await wait(readDraft(native.env, auth, path[1]!, classification.guard));
    check();
    if (!draft || draft.plan.draftHash !== requestBody.draftHash || draft.plan.release.output.output !== "video"
      || draft.plan.projectId !== scope.projectId || draft.plan.documentId !== scope.documentId
      || draft.plan.streamId !== `creative:${scope.ownerUserId}`) return fail("sponsor_video_intent_draft_changed");
    const root = await wait(experienceOutputBinding(draft.plan));
    check();
    const lineage = await wait(readExperienceOutputLineage(native, root));
    check();
    const selected = lineage.originals;
    if (!selected.save || !selected.confirm || !selected.preflight || selected.authorize || selected.run) return fail("sponsor_video_intent_lineage_unavailable");
    const requirementId = await wait(experienceResourceId(root.draftId, "native-output-requirement"));
    check();
    const blocks = native.projection.libraryBlocks.filter(block => block.id === requirementId);
    const saved = selected.save.receipt, savedEvents = native.events.filter(event => event.eventId === saved.eventId);
    if (blocks.length !== 1 || canonicalJson(blocks[0]!.sourceEvents) !== canonicalJson([saved.eventId])
      || saved.payload.block_id !== requirementId || saved.payload.type !== "output" || saved.payload.scope !== "document"
      || savedEvents.length !== 1 || savedEvents[0]!.type !== "BlockCreated" || savedEvents[0]!.actor !== `user:${scope.actorUserId}`
      || savedEvents[0]!.streamId !== `creative:${scope.ownerUserId}` || savedEvents[0]!.sequence !== selected.save.sequence
      || canonicalJson(savedEvents[0]!.payload) !== canonicalJson(saved.payload)) return fail("sponsor_video_intent_requirement_changed");
    const confirmed = selected.confirm.receipt.payload.confirmed_plan;
    const quote = selected.preflight.receipt.payload.preflight;
    if (!record(quote) || typeof quote.id !== "string" || typeof quote.termsDigest !== "string" || typeof quote.maximumMicrousd !== "number"
      || typeof quote.expiresAt !== "string" || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0])) return fail("sponsor_native_terms_changed");
    if (!record(confirmed) || typeof confirmed.revisionId !== "string" || confirmed.id !== scope.documentId
      || selected.confirm.receipt.payload.plan_revision_id !== confirmed.revisionId
      || selected.preflight.receipt.payload.plan_revision_id !== confirmed.revisionId || quote.planRevisionId !== confirmed.revisionId
      || selected.preflight.envelope.planRevisionId !== confirmed.revisionId || selected.preflight.receipt.payload.preflight_id !== quote.id
      || [quote.sourceDigest, confirmed.sourceDigest].some(value => value !== native.sourceDigest)
      || [quote.requirementsDigest, confirmed.requirementsDigest].some(value => value !== native.requirementsDigest)
      || !(selected.save.sequence < selected.confirm.sequence && selected.confirm.sequence < selected.preflight.sequence)) return fail("sponsor_video_intent_preflight_changed");
    const offered = quote.targets[0], video = readVideoExecutionOffer(offered);
    if (!video || video.contract.source.releaseHash !== root.releaseHash) return fail("sponsor_recipe_unsupported");
    const reviewFacts = { draftHash: draft.plan.draftHash, termsDigest: quote.termsDigest, offer: offered, expiresAt: quote.expiresAt };
    if (review && !sponsoredVideoActorIntentMatchesNative(review, actorRequest, reviewFacts)) return fail("sponsor_video_actor_review_changed");
    const envelope = freeze(await wait(experienceOutputEnvelope(lineage.binding, "authorize", native.ownerHead,
      { ...experienceOutputAuthorization(requestBody, { termsDigest: quote.termsDigest, maximumMicrousd: quote.maximumMicrousd }), preflightId: quote.id })));
    check();
    const envelopeDigest = await wait(digest(envelope));
    check();
    const routeDigest = await wait(digest(offered));
    check();
    const settingsDigest = await wait(digest(offered.settings));
    check();
    const rootKeys: string[] = [];
    for (const stage of ["save", "confirm", "preflight"] as const) {
      rootKeys.push(await wait(experienceOutputCommandKey(root, stage))); check();
    }
    const prefix = rootKeys[0]!.slice(0, -4);
    const rootIndex: OutputSqlAssertion = { sql: `(SELECT COUNT(*) FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=?)=3
      AND NOT EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=? AND command_key NOT IN(SELECT value FROM json_each(?)))`,
    bindings: [scope.key, scope.actorUserId, prefix.length, prefix, scope.key, scope.actorUserId, prefix.length, prefix, JSON.stringify(rootKeys)] };
    const requestIds: string[] = [], operations = new Map<string, { requestId: string; expiresAt: string }>();
    for (const witness of lineage.witnesses) {
      if (witness.receipt.action !== "confirm") continue;
      const plan = witness.receipt.payload.confirmed_plan;
      if (!record(plan) || typeof plan.revisionId !== "string" || typeof plan.confirmedAt !== "string"
        || witness.receipt.payload.plan_revision_id !== plan.revisionId || operations.has(plan.revisionId)) return fail("sponsor_video_intent_lineage_unavailable");
      const operation = await wait(outputVideoPreparationIdentity(video.contract,
        { revisionId: plan.revisionId, confirmedAt: plan.confirmedAt }, String(offered.targetId)));
      check();
      if (!operation) return fail("sponsor_video_intent_lineage_unavailable");
      operations.set(plan.revisionId, operation); requestIds.push(operation.requestId);
    }
    for (const item of lineage.witnesses) {
      if (item.receipt.action !== "preflight") continue;
      const preparation = item.receipt.payload.preflight;
      const prior = record(preparation) && Array.isArray(preparation.targets) && preparation.targets.length === 1 ? readVideoExecutionOffer(preparation.targets[0]) : null;
      const operation = record(preparation) && typeof preparation.planRevisionId === "string" ? operations.get(preparation.planRevisionId) : undefined;
      if (!prior || !operation || prior.original.requestId !== operation.requestId || prior.original.expiresAt !== operation.expiresAt)
        return fail("sponsor_video_intent_lineage_unavailable");
    }
    const selectedAssociations: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_plan_revisions plan
      JOIN output_preflights preflight ON preflight.scope_key=plan.scope_key AND preflight.plan_revision_id=plan.plan_revision_id
      JOIN events confirmation ON confirmation.event_id=plan.confirmed_event_id
      JOIN events preparation ON preparation.event_id=preflight.event_id
      WHERE plan.scope_key=? AND plan.document_id=? AND plan.owner_user_id=? AND plan.project_id=? AND plan.plan_revision_id=?
        AND plan.confirmed_event_id=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND preflight.event_id=?
        AND confirmation.type='OutputPlanConfirmed' AND confirmation.sequence=? AND preparation.type='OutputPlanPreflighted' AND preparation.sequence=?)
      AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND type='BlockCreated' AND sequence=? AND stream_id=? AND actor=?)`,
    bindings: [scope.key, scope.documentId, scope.ownerUserId, scope.projectId, confirmed.revisionId,
      selected.confirm.receipt.eventId, quote.id, scope.actorUserId, selected.preflight.receipt.eventId,
      selected.confirm.sequence, selected.preflight.sequence, saved.eventId, selected.save.sequence, `creative:${scope.ownerUserId}`, `user:${scope.actorUserId}`] };
    native.sourceAssertions.push(classification.guard, retainedGuard(auth, draft.plan, draft.content), rootIndex, selectedAssociations,
      sceneRenewalIndexAssertion(native.scope, root.draftId, lineage.cycleCommandKeys, "video"),
      sceneRenewalNoExecutionAssertion(native.scope, requestIds, "video"),
      ...lineage.witnesses.map(item => outputCommandReceiptAssertion(native.scope, item.receipt)));
    const expiresAtMs = Math.min(Date.parse(draft.expiresAt), Date.parse(quote.expiresAt), Date.parse(String(video.original.expiresAt)),
      ...[...native.sourceAssertions, ...outputActiveSourceDeadlineAssertions(native.context!)].flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]),
      ...(review ? [Date.parse(review.expiresAt)] : []), Date.now() + 30000);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return fail("sponsor_native_terms_changed");
    check();
    clearTimeout(timer); deadlineMs = expiresAtMs; timer = setTimeout(abort, Math.max(1, deadlineMs - Date.now()));
    // Last substantive read. It incorporates the exact private receipt bodies
    // remembered by native lineage reads and all new predicates in its final
    // dense-acknowledged source batch, with one accepted bounded media reader.
    const description = await wait(describeSponsorVideoAdmission(native, Object.fromEntries(commandKeys.map(key => [key, envelope[key as keyof typeof envelope]]))));
    check();
    if (description.recipe.releaseDigest !== root.releaseHash || description.recipe.routeDigest !== routeDigest
      || description.recipe.settingsDigest !== settingsDigest || description.preflightExpiresAtMs !== Date.parse(quote.expiresAt)) return fail("sponsor_native_envelope_mismatch");
    if (review && !sponsoredVideoActorIntentMatchesNative(review, actorRequest, reviewFacts)) return fail("sponsor_video_actor_review_changed");
    const intent = freeze({ requestBody, envelope, envelopeDigest, native: description, expiresAtMs });
    const requireCurrent = () => { assertCurrent(); if (Date.now() >= expiresAtMs) fail("sponsor_video_intent_expired"); };
    if (review && actorRequest && reviewDigest && requestDigest) {
      const proof = Object.freeze(Object.create(null)) as SponsorVideoActorIntentProof;
      const actorIntent = freeze({ ...intent, requestBody: actorRequest, review, reviewDigest, requestDigest });
      check(); requireCurrent();
      actorProofs.set(proof, { trusted, assertCurrent: requireCurrent, intent: actorIntent });
      check(); requireCurrent();
      return proof;
    }
    const proof = Object.freeze(Object.create(null)) as SponsorVideoIntentProof;
    check(); requireCurrent();
    proofs.set(proof, { trusted, assertCurrent: requireCurrent, intent });
    check(); requireCurrent();
    return proof;
  } finally {
    active = false; clearTimeout(timer); request.signal.removeEventListener("abort", abort);
    controller.abort(); rejectStop(new SponsorEntitlementError("sponsor_video_intent_retired"));
  }
}

export function readSponsorVideoIntentProof(trusted: OutputTrustedContext): Promise<SponsorVideoIntentProof> {
  // Return the owner's exact promise; no unchecked public adoption await.
  return readIntent(trusted);
}

export function readSponsorVideoActorIntentProof(trusted: OutputTrustedContext, review: unknown): Promise<SponsorVideoActorIntentProof> {
  return readIntent(trusted, { review });
}
