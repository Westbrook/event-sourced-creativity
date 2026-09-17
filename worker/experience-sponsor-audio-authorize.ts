import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsoredAudioActorRequest, readSponsoredAudioReview, digestSponsoredAudioReview, type SponsoredAudioReview } from "../src/experiences/sponsored-audio-actor-intent.ts";
import { captureSponsorAudioReviewIdentity, prepareSponsorAudioAuthorize, type SponsorAudioAuthorizationResponse } from "../src/experiences/sponsor-audio-review-transport.ts";
import { captureSponsorAudioJson, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorAudioCampaign, readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { readSponsorAudioCurrentReview, sponsorAudioCurrentReviewNative } from "./experience-sponsor-audio-review.ts";
import { issueSponsorAudioGrant } from "./experience-sponsor-audio-issuer.ts";
import { loadOutputTrustedContext, outputExperienceCommands, outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputDocumentExecutionBridge } from "./output-document-execution.ts";
import { outputAssertionStatements, outputCommandReceiptAssertion, readOutputCommand, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputActiveSourceDeadlineAssertions, outputProofReadStatements } from "./output-disclosure-proof.ts";
import type { WorkerEnv, WorkerExecutionContext } from "./runtime.ts";

const fail = (code = "sponsor_audio_authorize_changed"): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"];
const intentKeys = ["driver_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "document_id", "command_json", "command_digest", "source_digest", "requirements_digest", "source_text_bytes"];
type Intent = { driver_id: string; campaign_id: string; actor_user_id: string; session_digest: string; intent_key: string;
  document_id: string; command_json: string; command_digest: string; source_digest: string; requirements_digest: string; source_text_bytes: number };
type Stage = { command_json: string; command_digest: string };
type Current = () => void;
export type SponsorAudioAuthorizeSelection = Readonly<{ campaignId: string; templateDigest: string; preflightId: string }>;
const noDetachedWork: WorkerExecutionContext = { waitUntil() { fail("sponsor_audio_authorize_detached_work_unsupported"); } };

async function guarded<T>(current: Current, work: () => Promise<T>): Promise<T> {
  current(); const result = await work(); current(); return result;
}
function dataRecord(value: unknown): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
function checkBatch(value: unknown, count: number, proof: boolean) {
  if (!Array.isArray(value) || own(value, "length") !== count) return fail("sponsor_audio_authorize_ack_unconfirmed");
  for (let index = 0; index < count; index++) {
    const result = own(value, index), rows = own(result, "results"), error = result && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "error") : undefined;
    if (!dataRecord(result) || own(result, "success") !== true || (error ? !Object.hasOwn(error, "value") || error.value !== undefined : "error" in result)
      || !Array.isArray(rows) || own(rows, "length") !== (proof ? 1 : 0)
      || proof && (!dataRecord(own(rows, 0)) || own(own(rows, 0), "current") !== 1)) return fail("sponsor_audio_authorize_ack_unconfirmed");
  }
}
function intentProof(intent: Intent): OutputSqlAssertion {
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_driver_intents WHERE ${intentKeys.map(key => `${key}=?`).join(" AND ")})`,
    bindings: intentKeys.map(key => intent[key as keyof Intent]) };
}
function stageProof(driverId: string, stage: Stage): OutputSqlAssertion {
  return { sql: "EXISTS(SELECT 1 FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize' AND command_json=? AND command_digest=?)",
    bindings: [driverId, stage.command_json, stage.command_digest] };
}
function lifetime(trusted: OutputTrustedContext, sourceAssertions = trusted.sourceAssertions) {
  return canonicalJson({ request: { url: trusted.request.url, method: trusted.request.method, headers: [...trusted.request.headers] },
    scope: trusted.scope, principal: trusted.principal, projectContext: trusted.projectContext, ownerHead: trusted.ownerHead, projectHead: trusted.projectHead,
    context: trusted.context, events: trusted.events, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    sourceAssertions, sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: trusted.env.OPENAI_MODEL ?? null, audioProvider: trusted.env.FORMA_AUDIO_PROVIDER ?? null, audioModel: trusted.env.FAL_AUDIO_MODEL ?? null,
      openai: trusted.env.OPENAI_API_KEY ?? null, fal: trusted.env.FAL_KEY ?? null, cohort: trusted.env.FORMA_PILOT_COHORT_ID ?? null, admins: trusted.env.FORMA_ADMIN_EMAILS ?? null } });
}

/** Dormant AUTHORIZE only for an already-owned, confirmed ordinary Document.
 * A bounded clone previews the actual wire; native preparation/replay verifies
 * the SAME original Request through its own bounded clone and complete content. No
 * Request, consent, creative intake, schema, public route or Run is fabricated.
 * Immutable operational rows precede admission and retain its original revision
 * even after native admission advances the source stream itself. */
export async function authorizeSponsoredAudio(trusted: OutputTrustedContext, rawSelection: SponsorAudioAuthorizeSelection): Promise<SponsorAudioAuthorizationResponse> {
  const selection = captureSponsorAudioJson(rawSelection);
  if (!record(selection) || !exactKeys(selection, ["campaignId", "templateDigest", "preflightId"])
    || !id(selection.campaignId) || !hash(selection.templateDigest) || !id(selection.preflightId)) return fail("sponsor_audio_authorize_selection_invalid");
  const options = freeze(selection as SponsorAudioAuthorizeSelection), selectionJson = canonicalJson(options);
  const request = trusted.request, env = trusted.env, database = env.DB, signal = request.signal;
  const identities = { scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events };
  if (request.method !== "POST" || request.bodyUsed || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
    || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.actorUserId !== trusted.principal.userId
    || trusted.scope.contextId || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional
    || trusted.principal.projectExecution || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId
    || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length) return fail("sponsor_audio_authorize_context_invalid");
  const originalAssertions = structuredClone(trusted.sourceAssertions), originalAssertionsJson = canonicalJson(originalAssertions);
  // requireCurrentSource may append this exact inherited deadline once. Keep
  // every other assertion and the source context pinned in its original order.
  const nativeDeadlines = outputActiveSourceDeadlineAssertions(trusted.context);
  const withNativeDeadlineJson = canonicalJson([...originalAssertions, ...nativeDeadlines]);
  const captured = lifetime(trusted, originalAssertions), proofEnv = { DB: database } as WorkerEnv;
  let deadline = Math.min(Infinity, ...[...originalAssertions, ...nativeDeadlines].flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  const current = () => {
    const actualSignal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!.call(request);
    const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal);
    if (trusted.request !== request || trusted.env !== env || env.DB !== database || actualSignal !== signal || request.signal !== signal || aborted !== false
      || trusted.scope !== identities.scope || trusted.principal !== identities.principal || trusted.context !== identities.context || trusted.events !== identities.events
      || ![originalAssertionsJson, withNativeDeadlineJson].includes(canonicalJson(trusted.sourceAssertions))
      || lifetime(trusted, originalAssertions) !== captured || canonicalJson(captureSponsorAudioJson(rawSelection)) !== selectionJson
      || !Number.isFinite(Date.now()) || Date.now() >= deadline) fail();
  };
  const prove = async (assertions: OutputSqlAssertion[], check: Current = current) => {
    check(); const statements = outputProofReadStatements(proofEnv, assertions); check();
    checkBatch(await guarded(check, () => database.batch(statements)), statements.length, true); check();
  };
  current();
  const supplied = readSponsoredAudioActorRequest(await guarded(current, () => readSponsorInternalCommand(Request.prototype.clone.call(request), 4096)));
  if (request.bodyUsed) return fail("sponsor_audio_authorize_original_consumed");
  const preview = supplied.audioCostConsent, url = new URL(request.url);
  if (url.search || url.hash || url.pathname !== `/api/experiences/drafts/${preview.draftId}/output/authorize`
    || supplied.sponsorReview.campaignId !== options.campaignId || preview.actorUserId !== trusted.scope.actorUserId
    || preview.projectId !== trusted.scope.projectId || preview.documentId !== trusted.scope.documentId
    || preview.sourceDigest !== trusted.sourceDigest || preview.requirementsDigest !== trusted.requirementsDigest) return fail("sponsor_audio_authorize_intent_mismatch");
  const actorRequestJson = canonicalJson(supplied), actorRequestDigest = await guarded(current, () => digest(supplied));
  const sessionDigest = await guarded(current, () => sponsorPrincipalDigest(trusted.principal));
  const stable = (await guarded(current, () => digest({ family: "canonical-instrumental-cue@1", actorUserId: trusted.scope.actorUserId, draftId: preview.draftId }))).slice(7);
  const intent: Intent = { driver_id: `sponsor-audio-driver-${stable}`, campaign_id: options.campaignId, actor_user_id: trusted.scope.actorUserId,
    session_digest: sessionDigest, intent_key: `audio-authorize-${stable}`, document_id: trusted.scope.documentId, command_json: actorRequestJson,
    command_digest: actorRequestDigest, source_digest: trusted.sourceDigest, requirements_digest: trusted.requirementsDigest,
    source_text_bytes: new TextEncoder().encode(canonicalJson(trusted.context.snapshot)).byteLength };
  const readOriginal = async () => {
    current(); const intentStatement = database.prepare(`SELECT ${intentKeys.join(",")} FROM experience_sponsor_driver_intents WHERE driver_id=?`).bind(intent.driver_id); current();
    const original = await guarded(current, () => intentStatement.first<Record<string, unknown>>());
    if (original !== null && (!dataRecord(original) || !exactKeys(original, intentKeys)
      || intentKeys.some(key => own(original, key) !== intent[key as keyof Intent]))) return fail("sponsor_audio_authorize_intent_conflict");
    current(); const stageStatement = database.prepare("SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='authorize'").bind(intent.driver_id); current();
    const row = await guarded(current, () => stageStatement.first<Stage>());
    if (row === null) { if (original) return fail("sponsor_audio_authorize_original_unavailable"); return null; }
    if (!original || !dataRecord(row) || !exactKeys(row, ["command_json", "command_digest"]) || typeof row.command_json !== "string"
      || row.command_json.length > 16384 || typeof row.command_digest !== "string") return fail("sponsor_audio_authorize_original_unavailable");
    let parsed: unknown; try { parsed = JSON.parse(row.command_json); } catch { return fail("sponsor_audio_authorize_original_unavailable"); }
    if (!record(parsed) || jsonIssues(parsed).length || !exactKeys(parsed, commandKeys) || parsed.action !== "authorize" || parsed.documentId !== intent.document_id
      || parsed.clientMutationId !== `sponsor-audio-authorize-${stable}` || parsed.preflightId !== options.preflightId
      || typeof parsed.expectedRevision !== "string" || !/^output:\d+$/u.test(parsed.expectedRevision)
      || parsed.termsDigest !== supplied.termsDigest || parsed.maximumMicrousd !== supplied.maximumMicrousd || parsed.explicitAuthorization !== supplied.explicitAuthorization
      || canonicalJson(parsed.audioCostConsent) !== canonicalJson(supplied.audioCostConsent) || canonicalJson(parsed) !== row.command_json
      || await guarded(current, () => outputDigest(parsed)) !== row.command_digest) return fail("sponsor_audio_authorize_original_unavailable");
    return { stage: freeze({ ...row }), command: freeze(parsed) };
  };
  const disclose = async (command: Record<string, unknown>, stage: Stage, receipt: OutputCommandReceipt, rawReview: unknown, replayed: boolean) => {
    const review = readSponsoredAudioReview(rawReview), reviewDigest = await guarded(current, () => digestSponsoredAudioReview(review));
    if (reviewDigest !== supplied.sponsorReview.reviewDigest || review.templateDigest !== options.templateDigest || review.campaignId !== options.campaignId
      || review.preview.requestId !== preview.requestId || review.termsDigest !== supplied.termsDigest
      || receipt.action !== "authorize" || receipt.key !== command.clientMutationId || receipt.privateUnavailable || !id(receipt.payload.grant_id)) return fail();
    deadline = Math.min(deadline, Date.parse(review.expiresAt), Date.parse(review.preview.expiresAt)); current();
    // Source is reloaded only for disclosure after the native command's own head
    // advance. The immutable original command is never reconstructed from it.
    const fresh = await guarded(current, () => loadOutputTrustedContext(request, env, intent.document_id, "request"));
    if (fresh instanceof Response || fresh.sourceDigest !== intent.source_digest || fresh.requirementsDigest !== intent.requirements_digest
      || fresh.scope.key !== trusted.scope.key || canonicalJson(fresh.principal) !== canonicalJson(trusted.principal)
      || await guarded(current, () => sponsorPrincipalDigest(fresh.principal)) !== intent.session_digest) return fail();
    const freshLifetime = lifetime(fresh);
    const disclosureCurrent = () => { current(); if (fresh.request !== request || fresh.env !== env || lifetime(fresh) !== freshLifetime) fail(); };
    const approved = await guarded(disclosureCurrent, () => loadApprovedSponsorAudioCampaign(request, env, options.campaignId));
    if (approved.actor.userId !== intent.actor_user_id || approved.policyDigest !== review.policyDigest || approved.policy.payerUserId !== review.payerUserId
      || approved.policy.approvalReceiptDigest !== review.approvalReceiptDigest || await guarded(disclosureCurrent, () => digest(approved.policy.templates[0])) !== options.templateDigest) return fail();
    const retained = await guarded(disclosureCurrent, () => readOutputCommand(env, fresh.scope, receipt.key, receipt.requestDigest));
    if (!retained || canonicalJson(retained) !== canonicalJson(receipt)) return fail();
    const grantId = receipt.payload.grant_id, jobId = review.preview.requestId;
    const assertions: OutputSqlAssertion[] = [...approved.assertions, ...sponsorCurrentSourceAssertions(fresh), intentProof(intent), stageProof(intent.driver_id, stage),
      outputCommandReceiptAssertion(fresh.scope, retained), {
        sql: `EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
          WHERE slot.scope_key=? AND slot.grant_id=? AND slot.job_id=? AND execution.actor_user_id=?
            AND execution.payer_user_id=? AND execution.authorization_event_id=?)`,
        bindings: [fresh.scope.key, grantId, jobId, intent.actor_user_id, review.payerUserId, receipt.eventId] },
      { sql: "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)<?", bindings: [deadline], deadlineMs: deadline }];
    deadline = Math.min(deadline, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
    const binding = captureSponsorAudioReviewIdentity({ version: 1, campaignId: options.campaignId, actorUserId: intent.actor_user_id,
      draftId: preview.draftId, draftHash: supplied.draftHash, projectId: trusted.scope.projectId, documentId: intent.document_id,
      sourceDigest: intent.source_digest, requirementsDigest: intent.requirements_digest });
    const response: SponsorAudioAuthorizationResponse = freeze({ version: 1, kind: "sponsor-audio-authorization", binding, reviewDigest, actorRequestDigest, grantId, jobId,
      receipt: { key: receipt.key, eventId: receipt.eventId, requestDigest: receipt.requestDigest }, replayed });
    await prove(assertions, disclosureCurrent); disclosureCurrent(); return response;
  };
  let original = await readOriginal(); current();
  if (original) {
    await prove([intentProof(intent), stageProof(intent.driver_id, original.stage)]);
    const replay = await guarded(current, () => outputExperienceCommands.readSponsoredAudioAdmissionReplay(trusted, original!.command));
    if (replay) {
      const actorIntent = own(replay.marker, "audio_actor_intent");
      const response = await guarded(current, () => disclose(original!.command, original!.stage, replay.receipt, own(actorIntent, "review"), true));
      current(); return response;
    }
  }
  // A fresh quote/current payer path begins only after native original replay
  // has been ruled out with the persisted original revision and command key.
  const shown = await guarded(current, () => readSponsorAudioCurrentReview(trusted, options));
  const native = await guarded(current, () => sponsorAudioCurrentReviewNative(shown, trusted));
  const freshCurrent = () => { current(); native.assertCurrent(); };
  const message = await guarded(freshCurrent, () => prepareSponsorAudioAuthorize(shown, supplied));
  if (message.body !== actorRequestJson || message.requestDigest !== actorRequestDigest || request.bodyUsed) return fail();
  const command = original?.command ?? freeze({ documentId: intent.document_id, action: "authorize", expectedRevision: native.expectedRevision,
    clientMutationId: `sponsor-audio-authorize-${stable}`, preflightId: native.preflightId, termsDigest: supplied.termsDigest,
    maximumMicrousd: supplied.maximumMicrousd, explicitAuthorization: supplied.explicitAuthorization, audioCostConsent: supplied.audioCostConsent });
  if (command.expectedRevision !== native.expectedRevision || command.preflightId !== native.preflightId) return fail("sponsor_audio_authorize_original_changed");
  const stage: Stage = { command_json: canonicalJson(command), command_digest: await guarded(freshCurrent, () => outputDigest(command)) };
  const assertions = [...native.assertions, ...sponsorCurrentSourceAssertions(trusted)];
  if (!original) {
    freshCurrent(); const statements = [...assertions.flatMap(assertion => outputAssertionStatements(proofEnv, assertion)),
      database.prepare(`INSERT INTO experience_sponsor_driver_intents(${intentKeys.join(",")},created_at_ms) VALUES(${intentKeys.map(() => "?").join(",")},CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`)
        .bind(...intentKeys.map(key => intent[key as keyof Intent])),
      database.prepare("INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,'authorize',?,?)")
        .bind(intent.driver_id, stage.command_json, stage.command_digest),
      ...[...assertions, intentProof(intent), stageProof(intent.driver_id, stage)].flatMap(assertion => outputAssertionStatements(proofEnv, assertion))];
    freshCurrent();
    try { checkBatch(await guarded(freshCurrent, () => database.batch(statements)), statements.length, false); }
    catch (error) {
      freshCurrent(); original = await readOriginal(); freshCurrent();
      if (!original || canonicalJson(original.command) !== canonicalJson(command)) throw error;
      await prove([...assertions, intentProof(intent), stageProof(intent.driver_id, stage)], freshCurrent);
    }
  } else await prove([...assertions, intentProof(intent), stageProof(intent.driver_id, stage)], freshCurrent);
  const preparation = await guarded(freshCurrent, () => outputExperienceCommands.prepareSponsoredAudioAdmission(trusted, command, shown.review));
  const issued = await guarded(freshCurrent, () => issueSponsorAudioGrant({ trusted, command, preparation, campaignId: options.campaignId, templateDigest: options.templateDigest }));
  const saved = await guarded(freshCurrent, () => outputExperienceCommands.executeSponsored(trusted, command, issued.admissionAuthority, outputDocumentExecutionBridge, noDetachedWork));
  if (saved instanceof Response) return fail("sponsor_audio_authorize_unavailable");
  const response = await guarded(current, () => disclose(command, stage, saved.receipt, shown.review as SponsoredAudioReview, saved.replayed));
  current(); return response;
}
