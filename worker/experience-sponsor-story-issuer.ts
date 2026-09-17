import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorEnvelope, SponsorEntitlementError, type SponsorEnvelopeV4 } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorStoryCampaign, readSponsorInternalCommand, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { createSponsorAdmissionAuthority, sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { matchSponsorStoryTemplate } from "./experience-sponsor-story-contract.ts";
import { describeSponsorStoryAdmission, readSponsorStoryTemplateEvidence } from "./experience-sponsor-story-evidence.ts";
import { parseShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements, rememberOutputPrivateBody, readOutputCommand, outputCommandReceiptAssertion, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
export type SponsorStoryDriverCommand = { action: "run-sponsored-short-story"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
export function readSponsorStoryDriverCommand(raw: unknown): SponsorStoryDriverCommand {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"])
    || raw.action !== "run-sponsored-short-story" || ![raw.campaignId, raw.documentId, raw.planRevisionId, raw.targetId, raw.intentKey].every(id)
    || String(raw.intentKey).length > 80) return fail("sponsor_driver_command_invalid");
  return Object.freeze(JSON.parse(canonicalJson(raw)) as SponsorStoryDriverCommand);
}
/** Identity does not change when a caller changes content under the same intent. */
export async function sponsorStoryIssuerIntentKey(raw: unknown) {
  const body = readSponsorStoryDriverCommand(raw);
  return `sponsor-story-authorize-${(await digest({ family: "canonical-short-story@1", campaignId: body.campaignId, intentKey: body.intentKey })).slice(7)}`;
}
// Uses the existing immutable, output-neutral issuance schema. This module
// exports no DDL, installs nothing and has no registered route.
declare const issuerAuthority: unique symbol;
export type SponsorStoryIssuerAuthority = Readonly<{ [issuerAuthority]: true }>;
type State = { request: Request; env: OutputTrustedContext["env"]; database: OutputTrustedContext["env"]["DB"];
  actorUserId: string; documentId: string; scopeJson: string; sourceBinding: string; driverCommand: SponsorStoryDriverCommand;
  approved: Awaited<ReturnType<typeof loadApprovedSponsorStoryCampaign>> };
const issuers = new WeakMap<SponsorStoryIssuerAuthority, State>();
type Guard = () => void;
async function guarded<T>(current: Guard, work: () => Promise<T>): Promise<T> {
  current();
  const value = await work();
  current();
  return value;
}
const sourceBinding = (trusted: OutputTrustedContext) => canonicalJson({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
  context: trusted.context, assertions: trusted.sourceAssertions, ownerHead: trusted.ownerHead, sourceProblems: trusted.sourceProblems,
  sourcePrivateCaptured: trusted.sourcePrivateCaptured, principal: trusted.principal, projectContext: trusted.projectContext,
  configuration: { cohort: trusted.env.FORMA_PILOT_COHORT_ID ?? null, model: trusted.env.OPENAI_MODEL ?? null, providerConfigured: Boolean(trusted.env.OPENAI_API_KEY) } });
function stateFor(authority: SponsorStoryIssuerAuthority, trusted: OutputTrustedContext) {
  const state = issuers.get(authority);
  if (!state || trusted.request.signal.aborted || state.request !== trusted.request || state.env !== trusted.env || state.database !== trusted.env.DB
    || state.actorUserId !== trusted.scope.actorUserId || state.documentId !== trusted.scope.documentId || state.scopeJson !== canonicalJson(trusted.scope)
    || state.sourceBinding !== sourceBinding(trusted)) return fail("sponsor_issuer_authority_changed");
  return state;
}

/** Only an eligible authenticated actor explicitly requesting this original
 * Short story may receive an issuer seal, under the payer's recorded approval. There
 * is no public issuer route and no caller-selected financial owner. */
export async function createSponsorStoryIssuerAuthority(trusted: OutputTrustedContext, campaignId: string): Promise<SponsorStoryIssuerAuthority> {
  const captured = { request: trusted.request, env: trusted.env, database: trusted.env.DB, actorUserId: trusted.scope.actorUserId,
    documentId: trusted.scope.documentId, scopeJson: canonicalJson(trusted.scope), sourceBinding: sourceBinding(trusted) };
  const current = () => {
    if (captured.request.signal.aborted || trusted.request !== captured.request || trusted.env !== captured.env || trusted.env.DB !== captured.database
      || canonicalJson(trusted.scope) !== captured.scopeJson || sourceBinding(trusted) !== captured.sourceBinding) return fail("sponsor_issuer_authority_changed");
  };
  const driverCommand = readSponsorStoryDriverCommand(await guarded(current, () => readSponsorInternalCommand(captured.request, 4096)));
  if (driverCommand.campaignId !== campaignId || driverCommand.documentId !== captured.documentId || trusted.scope.kind !== "personal"
    || trusted.scope.ownerUserId !== captured.actorUserId || trusted.scope.contextId || trusted.scope.organizationId || trusted.scope.projectAccessId
    || trusted.projectContext || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== captured.actorUserId) return fail("sponsor_issuer_scope_unsupported");
  const approved = await guarded(current, () => loadApprovedSponsorStoryCampaign(captured.request, captured.env, campaignId));
  if (approved.actor.userId !== captured.actorUserId) return fail("sponsor_issuer_authority_changed");
  const authority = Object.freeze({}) as SponsorStoryIssuerAuthority;
  issuers.set(authority, { ...captured, driverCommand, approved });
  stateFor(authority, trusted);
  return authority;
}

/** Pin the very same native plan, selected target and quote requested by the
 * actor. Exact private bytes are retained for the final issuance transaction. */
async function issuerNativeIntentProof(trusted: OutputTrustedContext, command: Record<string, unknown>, requested: SponsorStoryDriverCommand, current: Guard) {
  const row = await guarded(current, () => trusted.env.DB.prepare(`SELECT preflight.plan_revision_id,preflight.event_id,preflight.terms_digest,quote.private_json AS quote_json,
      plan.confirmed_event_id,body.private_json AS plan_json
    FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
    JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
    JOIN event_private_payloads body ON body.private_event_id=plan.confirmed_event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
      AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?`)
    .bind(trusted.scope.key,String(command.preflightId),trusted.scope.actorUserId,trusted.scope.ownerUserId,trusted.scope.projectId,trusted.scope.documentId,
      trusted.sourceDigest,trusted.requirementsDigest).first<{plan_revision_id:string;event_id:string;terms_digest:string;quote_json:string;confirmed_event_id:string;plan_json:string}>());
  if (!row || row.plan_revision_id !== requested.planRevisionId || row.terms_digest !== command.termsDigest) return fail("sponsor_issuer_intent_mismatch");
  const quote = rememberOutputPrivateBody(trusted.scope,row.event_id,row.quote_json), planBody = rememberOutputPrivateBody(trusted.scope,row.confirmed_event_id,row.plan_json);
  const preflight = record(quote.preflight) ? quote.preflight : null, confirmed = record(planBody.confirmed_plan) ? planBody.confirmed_plan : null;
  const plan = confirmed && record(confirmed.plan) ? confirmed.plan : null;
  const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 && record(preflight.targets[0]) ? preflight.targets[0] : null;
  const selected = plan && Array.isArray(plan.targets) ? plan.targets.filter(target => record(target) && target.selected === true) : [];
  if (confirmed?.revisionId !== requested.planRevisionId || offered?.targetId !== requested.targetId || selected.length !== 1
    || !record(selected[0]) || selected[0].id !== requested.targetId || selected[0].media_kind !== "document" || !parseShortStoryNarrativeContract(selected[0].narrative_contract)) return fail("sponsor_issuer_intent_mismatch");
}

/** A committed native authorization has advanced the owner stream. Recover its
 * exact original receipt rather than constructing a fresh admission capability
 * against an obsolete expectedRevision. This returns no execution authority. */
async function originalAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>, issuedGrantId: string,
  compiled: Awaited<ReturnType<typeof compileSponsorEnvelope>>, requested: SponsorStoryDriverCommand, current: Guard): Promise<{ receipt: OutputCommandReceipt; assertions: OutputSqlAssertion[] } | null> {
  if (compiled.policy.version !== 4 || compiled.envelope.version !== 4) return fail("sponsor_issuer_original_unavailable");
  const policy = compiled.policy, envelope = compiled.envelope, marker = { envelope_digest: compiled.envelopeDigest, policy_digest: compiled.policyDigest,
    consumption_id: envelope.consumptionId, campaign_id: policy.campaignId, payer_user_id: policy.payerUserId };
  const nativeCommand = { ...command, sponsor_entitlement: marker };
  const nativeDigest = await guarded(current, () => outputDigest(nativeCommand));
  const receipt = await guarded(current, () => readOutputCommand(trusted.env, trusted.scope, String(command.clientMutationId), nativeDigest));
  if (!receipt) return null;
  if (receipt.action !== "authorize" || !id(receipt.payload.grant_id)
    || canonicalJson(receipt.payload.output_command_envelope) !== canonicalJson(nativeCommand)) return fail("sponsor_issuer_original_unavailable");
  const issued = await guarded(current, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest: compiled.policyDigest,
    grantId: issuedGrantId, actorUserId: trusted.scope.actorUserId, sessionDigest: envelope.sessionDigest,
    intentKey: envelope.intentKey, envelopeDigest: compiled.envelopeDigest }));
  const lineage: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_execution_grants execution
    JOIN output_operation_slots slot ON slot.scope_key=execution.scope_key AND slot.grant_id=execution.grant_id
    JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id
    WHERE execution.scope_key=? AND execution.grant_id=? AND execution.actor_user_id=? AND execution.payer_user_id=?
      AND execution.authorization_event_id=? AND execution.context_id IS NULL AND execution.maximum_calls=1
      AND execution.plan_revision_id=? AND execution.preflight_id=? AND slot.plan_revision_id=execution.plan_revision_id AND slot.target_id=?
      AND execution.maximum_microusd=slot.maximum_microusd AND slot.provider=? AND slot.model=?
      AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL AND slot.maximum_calls=1
      AND slot.source_digest=? AND slot.route_digest=? AND slot.maximum_microusd=? AND slot.maximum_tokens=?
      AND job.kind='render_document' AND job.source_surface='outputs' AND job.owner_id=? AND job.document_id=? AND job.stream_id=?
      AND used.consumption_id=? AND used.grant_id=? AND used.campaign_id=? AND used.actor_user_id=?
      AND used.session_digest=? AND used.intent_key=? AND used.envelope_digest=? AND used.maximum_microusd=slot.maximum_microusd
      AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1)`,
    bindings: [trusted.scope.key, receipt.payload.grant_id, trusted.scope.actorUserId, envelope.payerUserId, receipt.eventId, requested.planRevisionId, String(command.preflightId), requested.targetId, envelope.recipe.provider, envelope.recipe.model,
      trusted.sourceDigest, envelope.recipe.routeDigest.slice(7), envelope.recipe.maximumMicrousd, envelope.recipe.maximumTokens,
      trusted.scope.actorUserId, trusted.scope.documentId, `creative:${trusted.scope.actorUserId}`,
      envelope.consumptionId, issuedGrantId, envelope.campaignId, trusted.scope.actorUserId, envelope.sessionDigest, envelope.intentKey, compiled.envelopeDigest] };
  return { receipt, assertions: [issued, outputCommandReceiptAssertion(trusted.scope, receipt), lineage] };
}

/** Idempotent server issuance. Resource debit, exact grant and immutable issuer
 * receipt commit together. Failed financial admission never rewrites this
 * original issuance and never refunds previously consumed resource work. */
export async function issueSponsorStoryGrant(authority: SponsorStoryIssuerAuthority, trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  if (jsonIssues(rawCommand).length) return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>, state = stateFor(authority, trusted);
  const current = () => { stateFor(authority, trusted); };
  const { policy, policyDigest, assertions } = state.approved;
  const intentKey = await guarded(current, () => sponsorStoryIssuerIntentKey(state.driverCommand)), commandDigest = await guarded(current, () => digest(command)), driverCommandJson = canonicalJson(state.driverCommand);
  if (command.action !== "authorize" || command.clientMutationId !== intentKey || command.documentId !== state.documentId) return fail("sponsor_issuer_intent_mismatch");
  await guarded(current, () => state.database.batch(assertions.flatMap(proof => outputAssertionStatements(state.env, proof))));
  stateFor(authority, trusted);
  const existing = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(policy.campaignId, state.actorUserId, intentKey).first<Record<string, string>>());
  const finish = async (row: Record<string, string>, replayed: boolean) => {
    if (row.policy_digest !== policyDigest || row.driver_command_json !== driverCommandJson || row.command_digest !== commandDigest) return fail("sponsor_issuer_intent_conflict");
    await issuerNativeIntentProof(trusted, command, state.driverCommand, current);
    const compiled = await guarded(current, () => compileSponsorEnvelope(policy, JSON.parse(row.envelope_json!)));
    if (compiled.envelopeDigest !== row.envelope_digest || compiled.policy.version !== 4 || compiled.envelope.version !== 4) return fail("sponsor_issuer_original_unavailable");
    stateFor(authority, trusted);
    const admitted = await originalAdmission(trusted, command, row.grant_id!, compiled, state.driverCommand, current);
    if (admitted) {
      await guarded(current, () => state.database.batch([...assertions, ...sponsorCurrentSourceAssertions(trusted), ...admitted.assertions]
        .flatMap(proof => outputAssertionStatements(state.env, proof))));
      stateFor(authority, trusted);
      return { kind: "admitted" as const, policy, envelope: compiled.envelope, grantId: row.grant_id!, nativeReceipt: admitted.receipt, replayed };
    }
    const admissionAuthority = await guarded(current, () => createSponsorAdmissionAuthority({ trusted, command, policy, envelope: compiled.envelope, grantId: row.grant_id! }));
    await guarded(current, () => state.database.batch([...assertions, ...sponsorCurrentSourceAssertions(trusted)].flatMap(proof => outputAssertionStatements(state.env, proof))));
    stateFor(authority, trusted);
    return { kind: "issued" as const, policy, envelope: compiled.envelope, grantId: row.grant_id!, admissionAuthority, replayed };
  };
  if (existing) return finish(existing, true);
  await issuerNativeIntentProof(trusted, command, state.driverCommand, current);
  const description = await guarded(current, () => describeSponsorStoryAdmission(trusted, command));
  const evidence = await guarded(current, () => readSponsorStoryTemplateEvidence(trusted, command, description.recipe));
  const template = policy.templates[(await guarded(current, () => Promise.all(policy.templates.map(value => matchSponsorStoryTemplate(value, evidence))))).findIndex(Boolean)];
  if (!template || description.actorUserId !== state.actorUserId || description.sessionDigest !== await guarded(current, () => sponsorPrincipalDigest(state.approved.actor))) return fail("sponsor_campaign_template_mismatch");
  const clock = await guarded(current, () => state.database.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms").first<{ now_ms: number }>());
  if (!clock || !Number.isSafeInteger(clock.now_ms)) return fail("sponsor_database_clock_unavailable");
  const stable = (await guarded(current, () => digest({ campaignId: policy.campaignId, actorUserId: state.actorUserId, intentKey }))).slice(7), grantId = `sponsor-story-issued-${stable}`;
  const { preflightExpiresAtMs, ...native } = description;
  const envelope: SponsorEnvelopeV4 = { version: 4, family: "canonical-short-story@1", campaignId: policy.campaignId, policyVersion: policy.policyVersion, payerUserId: policy.payerUserId,
    consumptionId: `sponsor-story-consume-${stable}`, intentKey, ...native, templateDigest: await guarded(current, () => digest(template)), issuedAtMs: clock.now_ms,
    expiresAtMs: Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, preflightExpiresAtMs, clock.now_ms + policy.maximumGrantLifetimeMs) };
  const compiled = await guarded(current, () => compileSponsorEnvelope(policy, envelope));
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context?.snapshot ?? {})).byteLength;
  const resource = await guarded(current, () => prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId, policyDigest, actorUserId: state.actorUserId,
    sessionDigest: description.sessionDigest, intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest, textBytes, resourceId: `sponsor-story-resource-issue-${stable}`, issuedGrantId: grantId }));
  const issuedProof = await guarded(current, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId: state.actorUserId, sessionDigest: description.sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
  stateFor(authority, trusted);
  try {
    await guarded(current, () => state.database.batch([
      ...[...assertions, ...sponsorCurrentSourceAssertions(trusted)].flatMap(proof => outputAssertionStatements(state.env, proof)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)")
        .bind(grantId,policy.campaignId,policyDigest,state.actorUserId,description.sessionDigest,intentKey,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
      ...resource.statements.map(statement => state.env.DB.prepare(statement.sql).bind(...statement.bindings)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(grantId,policy.campaignId,state.actorUserId,intentKey,policyDigest,driverCommandJson,commandDigest,compiled.envelopeDigest,compiled.envelopeJson),
      ...outputAssertionStatements(state.env,issuedProof),
    ]));
  } catch (error) {
    // Recover only an exact committed original after a lost acknowledgment. No
    // regenerated timestamps, new grant or counter adjustment is attempted.
    const original = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
      .bind(policy.campaignId,state.actorUserId,intentKey).first<Record<string,string>>());
    if (!original) throw error;
    return finish(original,true);
  }
  return finish({grant_id:grantId,policy_digest:policyDigest,driver_command_json:driverCommandJson,command_digest:commandDigest,envelope_digest:compiled.envelopeDigest,envelope_json:compiled.envelopeJson},false);
}
