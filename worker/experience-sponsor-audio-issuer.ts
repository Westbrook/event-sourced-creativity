import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { captureSponsorAudioJson, compileSponsorAudioEnvelope, SponsorEntitlementError, type SponsorEnvelopeV8, type SponsorPolicyV8 } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorAudioCampaign, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { createSponsorAdmissionAuthority, sponsorPrincipalDigest, type SponsorAdmissionAuthority } from "./experience-sponsor-admission.ts";
import { matchSponsorAudioTemplate } from "./experience-sponsor-audio-contract.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { requireAudioSponsorAdmissionForEvidence, type AudioSponsorAdmissionPreparation } from "./output-audio-sponsored-handoff.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code = "sponsor_audio_issuer_changed"): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const databaseNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
type Current = () => void;
type Issuance = { grant_id: string; campaign_id: string; actor_user_id: string; intent_key: string; policy_digest: string;
  driver_command_json: string; command_digest: string; envelope_digest: string; envelope_json: string };
export type SponsorAudioIssuedGrant = Readonly<{ kind: "issued"; policy: SponsorPolicyV8; envelope: SponsorEnvelopeV8;
  grantId: string; admissionAuthority: SponsorAdmissionAuthority; replayed: boolean }>;

async function guarded<T>(current: Current, work: () => Promise<T>): Promise<T> {
  current(); const value = await work(); current(); return value;
}
function dataRecord(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
function cleanError(value: Record<string, unknown>) {
  const descriptor = Object.getOwnPropertyDescriptor(value, "error");
  return descriptor ? Object.hasOwn(descriptor, "value") && descriptor.value === undefined : !("error" in value);
}
/** Every result must be an owned acknowledgement. A hole or inherited/error
 * accessor is never evidence that the immutable transaction committed. */
function checkBatch(results: unknown, count: number, proof: boolean) {
  if (!Array.isArray(results) || own(results, "length") !== count) fail();
  for (let index = 0; index < count; index++) {
    const result = own(results, index), rows = own(result, "results");
    if (!dataRecord(result) || own(result, "success") !== true || !cleanError(result) || !Array.isArray(rows)
      || own(rows, "length") !== (proof ? 1 : 0) || proof && (!dataRecord(own(rows, 0)) || own(own(rows, 0), "current") !== 1)) fail();
  }
}
function readIssuance(raw: unknown): Issuance | null {
  if (raw === null) return null;
  const names = ["grant_id", "campaign_id", "actor_user_id", "intent_key", "policy_digest", "driver_command_json", "command_digest", "envelope_digest", "envelope_json"];
  if (!dataRecord(raw) || !exactKeys(raw, names) || names.some(name => typeof own(raw, name) !== "string")
    || !id(raw.grant_id) || !hash(raw.policy_digest) || !hash(raw.command_digest) || !hash(raw.envelope_digest)
    || String(raw.envelope_json).length > 131072 || String(raw.driver_command_json).length > 131072) return fail("sponsor_audio_issuer_original_unavailable");
  return freeze(JSON.parse(canonicalJson(raw)) as Issuance);
}
function before(deadline: number) { const now = Date.now(); if (!Number.isFinite(now) || !Number.isFinite(deadline) || now >= deadline) fail(); }
const lifetime = (trusted: OutputTrustedContext) => canonicalJson({ request: { url: trusted.request.url, method: trusted.request.method,
  headers: [...trusted.request.headers.entries()] }, scope: trusted.scope, principal: trusted.principal,
  sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, ownerHead: trusted.ownerHead,
  sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems, projectContext: trusted.projectContext ?? null,
  configuration: { model: trusted.env.OPENAI_MODEL ?? null, openai: trusted.env.OPENAI_API_KEY ?? null, fal: trusted.env.FAL_KEY ?? null,
    audioProvider: trusted.env.FORMA_AUDIO_PROVIDER ?? null, audioModel: trusted.env.FAL_AUDIO_MODEL ?? null,
    cohort: trusted.env.FORMA_PILOT_COHORT_ID ?? null, admins: trusted.env.FORMA_ADMIN_EMAILS ?? null } });

/** Dormant server leaf for an already confirmed ordinary Audio Document. The
 * original Request was reviewed by the native preparation owner: this issuer
 * never reads its body, manufactures consent, installs tables or runs a job.
 * The caller must recover an already admitted original before requesting a new
 * preparation. This leaf recovers only an exact unadmitted issuance. */
export async function issueSponsorAudioGrant(input: { trusted: OutputTrustedContext; command: Record<string, unknown>;
  preparation: AudioSponsorAdmissionPreparation; campaignId: string; templateDigest: string }): Promise<SponsorAudioIssuedGrant> {
  const trusted = input.trusted, rawCommand = input.command, preparation = input.preparation;
  const campaignId = input.campaignId, templateDigest = input.templateDigest;
  const captured = captureSponsorAudioJson(rawCommand);
  if (!record(captured) || !exactKeys(captured, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"])
    || captured.action !== "authorize" || captured.explicitAuthorization !== true || !id(captured.clientMutationId)
    || !Number.isSafeInteger(captured.maximumMicrousd) || Number(captured.maximumMicrousd) < 1 || !id(campaignId) || !hash(templateDigest)) return fail("sponsor_command_invalid");
  const command = freeze(captured), commandJson = canonicalJson(command);
  const request = trusted.request, signal = request.signal, env = trusted.env, database = env.DB;
  const identities = { scope: trusted.scope, principal: trusted.principal, context: trusted.context, events: trusted.events };
  const capturedLifetime = lifetime(trusted), proofEnv = { DB: database } as WorkerEnv;
  let nativeCurrent: Current = () => {};
  let deadline = Infinity;
  const current = () => {
    if (input.trusted !== trusted || input.command !== rawCommand || input.preparation !== preparation || input.campaignId !== campaignId || input.templateDigest !== templateDigest
      || trusted.request !== request || trusted.env !== env || env.DB !== database || request.signal !== signal
      || Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!, signal, []) !== false
      || trusted.scope !== identities.scope || trusted.principal !== identities.principal || trusted.context !== identities.context || trusted.events !== identities.events
      || canonicalJson(captureSponsorAudioJson(rawCommand)) !== commandJson || lifetime(trusted) !== capturedLifetime) fail();
    if (deadline !== Infinity) before(deadline);
    nativeCurrent();
  };
  current();
  const native = await guarded(current, () => requireAudioSponsorAdmissionForEvidence(preparation, trusted, command));
  nativeCurrent = native.assertCurrent; deadline = native.deadlineMs; current();
  const approved = await guarded(current, () => loadApprovedSponsorAudioCampaign(request, env, campaignId));
  const { policy, policyDigest } = approved, { actorIntent, description } = native, review = actorIntent.review;
  deadline = Math.min(deadline, policy.expiresAtMs, policy.resources.expiresAtMs, description.preflightExpiresAtMs,
    Date.parse(review.expiresAt), Date.parse(review.preview.expiresAt));
  current();
  const selectedDigest = await guarded(current, () => digest(policy.templates[0]));
  const commandDigest = await guarded(current, () => digest(command));
  const sessionDigest = await guarded(current, () => sponsorPrincipalDigest(approved.actor));
  if (approved.actor.userId !== trusted.scope.actorUserId || description.actorUserId !== approved.actor.userId || description.sessionDigest !== sessionDigest
    || command.documentId !== description.documentId || command.clientMutationId === undefined || actorIntent.commandDigest !== commandDigest
    || templateDigest !== selectedDigest || templateDigest !== review.templateDigest || review.campaignId !== policy.campaignId
    || review.policyDigest !== policyDigest || review.payerUserId !== policy.payerUserId || review.approvalReceiptDigest !== policy.approvalReceiptDigest
    || canonicalJson(native.recipe) !== canonicalJson(description.recipe)) return fail("sponsor_audio_issuer_intent_mismatch");
  if (!await guarded(current, () => matchSponsorAudioTemplate(policy.templates[0], {
    recipe: description.recipe, offered: native.nativePreflight, consent: actorIntent.request.audioCostConsent,
  }))) return fail("sponsor_campaign_template_mismatch");
  const intentKey = String(command.clientMutationId), actorUserId = description.actorUserId;
  // The existing output-neutral column retains the actual supplied closed Audio
  // actor wire, not a fabricated driver command or a future provider request.
  const driverCommandJson = canonicalJson(actorIntent.request);
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context?.snapshot ?? {})).byteLength;
  const stable = (await guarded(current, () => digest({ campaignId, actorUserId, intentKey }))).slice(7);
  const grantId = `sponsor-audio-issued-${stable}`, resourceId = `sponsor-audio-resource-issue-${stable}`;
  const limitsDigest = await guarded(current, () => digest(policy.resources));
  const resourceAuthority: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies resources
    WHERE resources.campaign_id=? AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=${databaseNow} AND ?>${databaseNow})`,
    bindings: [campaignId, limitsDigest, canonicalJson(policy.resources), policy.resources.startsAtMs, policy.resources.expiresAtMs], deadlineMs: policy.resources.expiresAtMs };
  const originalDeadline: OutputSqlAssertion = { sql: `${databaseNow}<?`, bindings: [deadline], deadlineMs: deadline };
  const baseAssertions = [...structuredClone(approved.assertions), resourceAuthority, ...structuredClone(native.assertions), originalDeadline];
  const prove = async (assertions: OutputSqlAssertion[], check: Current = current) => {
    check(); const statements = outputProofReadStatements(proofEnv, assertions); check();
    const results = await guarded(check, () => database.batch<Record<string, unknown>>(statements));
    checkBatch(results, statements.length, true); check();
  };
  const lookup = async () => {
    current(); const statement = database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?").bind(campaignId, actorUserId, intentKey); current();
    const row = await guarded(current, () => statement.first<Record<string, unknown>>());
    return readIssuance(row);
  };
  const resourceFor = async (envelopeDigest: string) => guarded(current, () => prepareSponsorResourcePlan({ limits: policy.resources,
    campaignId, policyDigest, actorUserId, sessionDigest, intentKey, operation: "issuance", payloadDigest: envelopeDigest,
    textBytes, resourceId, issuedGrantId: grantId }));
  const finish = async (row: Issuance, replayed: boolean): Promise<SponsorAudioIssuedGrant> => {
    current();
    if (row.grant_id !== grantId || row.campaign_id !== campaignId || row.actor_user_id !== actorUserId || row.intent_key !== intentKey
      || row.policy_digest !== policyDigest || row.command_digest !== commandDigest || row.driver_command_json !== driverCommandJson) return fail("sponsor_issuer_intent_conflict");
    const compiled = await guarded(current, () => compileSponsorAudioEnvelope(policy, JSON.parse(row.envelope_json)));
    const envelope = compiled.envelope;
    if (compiled.policyDigest !== policyDigest || compiled.envelopeDigest !== row.envelope_digest || compiled.envelopeJson !== row.envelope_json
      || envelope.templateDigest !== templateDigest || envelope.audioActorRequestDigest !== actorIntent.requestDigest
      || envelope.audioSponsorReviewDigest !== actorIntent.reviewDigest || envelope.originalRequestId !== review.preview.requestId
      || envelope.originalExpiresAtMs !== Date.parse(review.preview.expiresAt) || envelope.expiresAtMs > deadline
      || envelope.consumptionId !== `sponsor-audio-consume-${stable}` || envelope.intentKey !== intentKey
      || Object.entries(description).some(([key, value]) => key !== "preflightExpiresAtMs" && canonicalJson(envelope[key as keyof SponsorEnvelopeV8]) !== canonicalJson(value))) return fail("sponsor_audio_issuer_original_unavailable");
    const originalCurrent = () => { current(); before(envelope.expiresAtMs); };
    originalCurrent();
    const originalGrant: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?
      AND actor_user_id=? AND session_digest=? AND intent_key=? AND envelope_digest=? AND issued_at_ms=? AND expires_at_ms=? AND enabled=1
      AND issued_at_ms<=${databaseNow} AND expires_at_ms>${databaseNow})`, bindings: [grantId, campaignId, policyDigest, actorUserId, sessionDigest,
      intentKey, compiled.envelopeDigest, envelope.issuedAtMs, envelope.expiresAtMs], deadlineMs: envelope.expiresAtMs };
    const resource = await guarded(originalCurrent, () => resourceFor(compiled.envelopeDigest));
    const receiptAssertion: OutputSqlAssertion = { sql: resource.receiptAssertion.sql, bindings: [...resource.receiptAssertion.bindings] };
    const issued = await guarded(originalCurrent, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId, sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
    await prove([...baseAssertions, originalGrant, receiptAssertion, issued], originalCurrent);
    const admissionAuthority = await guarded(originalCurrent, () => createSponsorAdmissionAuthority({ trusted, command, policy, envelope, grantId, audioPreparation: preparation }));
    await prove([...baseAssertions, originalGrant, receiptAssertion, issued], originalCurrent);
    originalCurrent();
    return Object.freeze({ kind: "issued", policy, envelope, grantId, admissionAuthority, replayed });
  };
  const deliver = (result: SponsorAudioIssuedGrant) => { current(); before(result.envelope.expiresAtMs); return result; };
  await prove(baseAssertions);
  // Original identity is consulted before database time or a fresh resource
  // operation. Current authorization is still required for unadmitted work.
  const existing = await lookup();
  if (existing) return deliver(await finish(existing, true));
  current(); const clockStatement = database.prepare(`SELECT ${databaseNow} AS now_ms`); current();
  const clock = await guarded(current, () => clockStatement.first<{ now_ms: number }>());
  if (!dataRecord(clock) || !Number.isSafeInteger(own(clock, "now_ms"))) return fail("sponsor_database_clock_unavailable");
  const issuedAtMs = Number(own(clock, "now_ms")), { preflightExpiresAtMs, ...descriptionFields } = description;
  const envelope: SponsorEnvelopeV8 = { version: 8, family: "canonical-instrumental-cue@1", campaignId, policyVersion: policy.policyVersion, payerUserId: policy.payerUserId,
    consumptionId: `sponsor-audio-consume-${stable}`, intentKey, ...descriptionFields, templateDigest,
    audioActorRequestDigest: actorIntent.requestDigest, audioSponsorReviewDigest: actorIntent.reviewDigest,
    originalRequestId: review.preview.requestId, originalExpiresAtMs: Date.parse(review.preview.expiresAt), issuedAtMs,
    expiresAtMs: Math.min(deadline, preflightExpiresAtMs, issuedAtMs + policy.maximumGrantLifetimeMs) };
  const compiled = await guarded(current, () => compileSponsorAudioEnvelope(policy, envelope));
  const issuanceCurrent = () => { current(); before(envelope.expiresAtMs); };
  const resource = await guarded(issuanceCurrent, () => resourceFor(compiled.envelopeDigest));
  const receiptAssertion: OutputSqlAssertion = { sql: resource.receiptAssertion.sql, bindings: [...resource.receiptAssertion.bindings] };
  const issued = await guarded(issuanceCurrent, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId, sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
  const envelopeDeadline: OutputSqlAssertion = { sql: `?<=${databaseNow} AND ?>${databaseNow}`, bindings: [issuedAtMs, envelope.expiresAtMs], deadlineMs: envelope.expiresAtMs };
  const closing = [...baseAssertions, envelopeDeadline];
  issuanceCurrent();
  const statements = [
    ...closing.flatMap(assertion => outputAssertionStatements(proofEnv, assertion)),
    database.prepare("INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)")
      .bind(grantId, campaignId, policyDigest, actorUserId, sessionDigest, intentKey, compiled.envelopeDigest, issuedAtMs, envelope.expiresAtMs),
    ...resource.statements.map(statement => database.prepare(statement.sql).bind(...statement.bindings)),
    database.prepare("INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(grantId, campaignId, actorUserId, intentKey, policyDigest, driverCommandJson, commandDigest, compiled.envelopeDigest, compiled.envelopeJson),
    ...[...closing, receiptAssertion, issued].flatMap(assertion => outputAssertionStatements(proofEnv, assertion)),
  ];
  issuanceCurrent();
  try {
    const results = await guarded(issuanceCurrent, () => database.batch(statements));
    checkBatch(results, statements.length, false); issuanceCurrent();
  } catch (error) {
    // A committed transaction may have lost its acknowledgement. Recover only
    // that exact immutable original; never rerun or renew the resource debit.
    // Abort or changed authority fails before any recovery read.
    issuanceCurrent(); const original = await lookup(); issuanceCurrent();
    if (!original) throw error;
    return deliver(await finish(original, true));
  }
  return deliver(await finish({ grant_id: grantId, campaign_id: campaignId, actor_user_id: actorUserId, intent_key: intentKey,
    policy_digest: policyDigest, driver_command_json: driverCommandJson, command_digest: commandDigest,
    envelope_digest: compiled.envelopeDigest, envelope_json: compiled.envelopeJson }, false));
}
