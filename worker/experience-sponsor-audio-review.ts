import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { readSponsoredAudioReview } from "../src/experiences/sponsored-audio-actor-intent.ts";
import type { SponsorAudioReviewResponse } from "../src/experiences/sponsor-audio-review-transport.ts";
import { loadApprovedSponsorAudioCampaign } from "./experience-sponsor-approval.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { outputExperienceCommands, type OutputTrustedContext } from "./output-requirements-api.ts";
import { requireAudioSponsorReviewForDisplay } from "./output-audio-sponsored-handoff.ts";
import { outputActiveSourceDeadlineAssertions, outputProofReadStatements } from "./output-disclosure-proof.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

/** Server-selected existing quote and campaign; never a public payer selector. */
export type SponsorAudioServerConfiguration = Readonly<{ campaignId: string; templateDigest: string; preflightId: string }>;
function fail(): never { throw new SponsorEntitlementError("sponsor_audio_review_changed"); }
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const clone = <T>(value: T): T => structuredClone(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
function configuration(value: SponsorAudioServerConfiguration): SponsorAudioServerConfiguration {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["campaignId", "templateDigest", "preflightId"])
    || !identifier(value.campaignId) || !identifier(value.preflightId) || !/^sha256:[a-f0-9]{64}$/u.test(value.templateDigest)) fail();
  return freeze(clone(value));
}
function lifetime(trusted: OutputTrustedContext) {
  const request = trusted.request, signal = request.signal, env = trusted.env, database = env.DB;
  const identities = { scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events };
  // The unchanged native owner appends exactly these current-source deadlines
  // on its first use. Permit that one known append, not arbitrary proof drift.
  const nativeDeadlines = trusted.context ? outputActiveSourceDeadlineAssertions(trusted.context) : [];
  const originalAssertions = canonicalJson(trusted.sourceAssertions);
  const preparedAssertions = canonicalJson([...trusted.sourceAssertions, ...nativeDeadlines]);
  const sourceDeadline = Math.min(Infinity, ...[...trusted.sourceAssertions, ...nativeDeadlines]
    .flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]));
  const facts = () => canonicalJson({ scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events,
    ownerHead: trusted.ownerHead, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    sourceAssertions: originalAssertions, sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    projectContext: trusted.projectContext, request: { url: request.url, method: request.method, headers: [...request.headers] },
    configuration: { model: env.OPENAI_MODEL ?? null, key: env.OPENAI_API_KEY ?? null, fal: env.FAL_KEY ?? null,
      audioProvider: env.FORMA_AUDIO_PROVIDER ?? null, audioModel: env.FAL_AUDIO_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null,
      admins: env.FORMA_ADMIN_EMAILS ?? null } });
  const captured = facts();
  const current = () => {
    let actualSignal: unknown, aborted: unknown;
    try { actualSignal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request);
      aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal); } catch { fail(); }
    if (trusted.request !== request || request.signal !== signal || actualSignal !== signal || aborted !== false || trusted.env !== env || env.DB !== database
      || trusted.scope !== identities.scope || trusted.principal !== identities.principal || trusted.context !== identities.context || trusted.events !== identities.events
      || ![originalAssertions, preparedAssertions].includes(canonicalJson(trusted.sourceAssertions))
      || facts() !== captured || !Number.isFinite(Date.now()) || Date.now() >= sourceDeadline) fail();
  };
  current(); return { request, env, database, current };
}
type Native = Awaited<ReturnType<typeof requireAudioSponsorReviewForDisplay>>;
type State = { trusted: OutputTrustedContext; display: SponsorAudioReviewResponse; displayJson: string; native: Native;
  assertions: OutputSqlAssertion[]; deadlineMs: number; current: () => void; database: OutputTrustedContext["env"]["DB"] };
const reviews = new WeakMap<SponsorAudioReviewResponse, State>();
async function prove(state: State) {
  state.current();
  const assertions = state.assertions;
  if (!assertions.length || assertions.length > 272 || new TextEncoder().encode(canonicalJson(assertions)).byteLength > 2 * 1024 * 1024) fail();
  const results = await state.database.batch<Record<string, unknown>>(outputProofReadStatements(state.trusted.env, assertions));
  state.current();
  if (!Array.isArray(results) || own(results, "length") !== assertions.length) fail();
  for (let index = 0; index < assertions.length; index++) {
    const result = own(results, index), rows = own(result, "results");
    const error = result && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "error") : null;
    if (own(result, "success") !== true || !result || typeof result !== "object"
      || (error ? !Object.hasOwn(error, "value") || error.value !== undefined : "error" in result)
      || !Array.isArray(rows) || own(rows, "length") !== 1 || own(own(rows, 0), "current") !== 1) fail();
  }
  state.current();
}
/** Dormant passive review of an already-owned, ordinary, confirmed Audio
 * Document. No plan, preflight, consent, operational receipt or grant is written. */
export async function readSponsorAudioCurrentReview(trusted: OutputTrustedContext, rawConfiguration: SponsorAudioServerConfiguration): Promise<SponsorAudioReviewResponse> {
  const config = configuration(rawConfiguration), captured = lifetime(trusted), current = captured.current;
  const url = new URL(captured.request.url);
  const validPath = captured.request.method === "GET"
    ? /^\/api\/experiences\/sponsor\/audio\/drafts\/experience-draft-[a-f0-9]{64}\/review$/u.test(url.pathname)
    : /^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(url.pathname);
  if (url.search || url.hash || !["GET", "POST"].includes(captured.request.method) || captured.request.bodyUsed
    || !validPath
    || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || !trusted.context
    || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length) fail();
  const handle = await outputExperienceCommands.prepareSponsoredAudioReview(trusted, config.preflightId); current();
  const native = await requireAudioSponsorReviewForDisplay(handle, trusted); current(); native.assertCurrent();
  const nativeCurrent = () => { current(); native.assertCurrent(); };
  const expectedPath = captured.request.method === "GET" ? `/api/experiences/sponsor/audio/drafts/${native.preview.draftId}/review`
    : `/api/experiences/drafts/${native.preview.draftId}/output/authorize`;
  if (url.pathname !== expectedPath) fail();
  const approved = await loadApprovedSponsorAudioCampaign(captured.request, captured.env, config.campaignId); nativeCurrent();
  if (approved.actor.userId !== trusted.scope.actorUserId || approved.policy.payerUserId === trusted.scope.actorUserId) fail();
  const template = approved.policy.templates[0]!;
  const templateDigest = await digest(template); nativeCurrent();
  const release = await registeredExperience("audio"); nativeCurrent();
  if (!release || templateDigest !== config.templateDigest || template.recipeVersion !== `audio@${release.definition.revision}`
    || template.releaseDigest !== release.releaseHash || native.releaseHash !== release.releaseHash
    || native.preview.maximumMicrousd > template.maximumMicrousd) fail();
  const limitsDigest = await digest(approved.policy.resources); nativeCurrent();
  const resourceAssertion: OutputSqlAssertion = {
    sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies WHERE campaign_id=? AND enabled=1 AND limits_digest=? AND limits_json=?
      AND ?<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`,
    bindings: [approved.policy.campaignId, limitsDigest, canonicalJson(approved.policy.resources), approved.policy.resources.startsAtMs, approved.policy.resources.expiresAtMs],
    deadlineMs: approved.policy.resources.expiresAtMs,
  };
  const assertions = [...clone(native.assertions), ...clone(approved.assertions), resourceAssertion];
  const deadlineMs = Math.min(native.deadlineMs, approved.policy.expiresAtMs, approved.policy.resources.expiresAtMs,
    ...assertions.flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]));
  const currentReview = () => { nativeCurrent(); if (!Number.isFinite(deadlineMs) || Date.now() >= deadlineMs) fail(); };
  currentReview();
  const review = readSponsoredAudioReview({ version: "sponsor-audio-review@1", campaignId: config.campaignId,
    approvalReceiptDigest: approved.policy.approvalReceiptDigest, policyDigest: approved.policyDigest, templateDigest,
    payerUserId: approved.policy.payerUserId, actorChargeMicrousd: 0, termsDigest: native.quote.termsDigest,
    preview: native.preview, expiresAt: new Date(deadlineMs).toISOString() });
  const reviewDigest = await digest(review); currentReview();
  const display: SponsorAudioReviewResponse = freeze({ version: 1, kind: "sponsor-audio-review", binding: {
    version: 1, campaignId: config.campaignId, actorUserId: trusted.scope.actorUserId, draftId: native.preview.draftId,
    draftHash: native.draftHash, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
  }, review, reviewDigest, native: { draftHash: native.draftHash, termsDigest: native.quote.termsDigest,
    preview: native.preview, expiresAt: native.quote.expiresAt } });
  const displayJson = canonicalJson(display);
  const finalCurrent = () => { currentReview(); if (canonicalJson(display) !== displayJson) fail(); };
  const state: State = { trusted, display, displayJson, native, assertions, deadlineMs, current: finalCurrent, database: captured.database };
  await prove(state); finalCurrent(); reviews.set(display, state); return display;
}
/** Internal exact-object accessor; a parsed wire response cannot recover this
 * proof. Its callback is never included in the transport response. */
export async function sponsorAudioCurrentReviewNative(display: SponsorAudioReviewResponse, trusted: OutputTrustedContext) {
  const state = reviews.get(display);
  if (!state || state.trusted !== trusted || state.display !== display) fail();
  state.current(); await prove(state); state.current();
  const result = { display, preflightId: state.native.quote.id, expectedRevision: state.native.expectedRevision,
    planRevisionId: state.native.quote.planRevisionId, targetId: state.native.targetId,
    assertions: clone(state.assertions), assertCurrent: state.current };
  state.current(); return result;
}
