import { canonicalJson, digest, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsorPolicy, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
declare const executionAuthority: unique symbol;
export type SponsorExecutionAuthority = Readonly<{ [executionAuthority]: true }>;
declare const financialAuthority: unique symbol;
export type SponsorFinancialBinding = Readonly<{ [financialAuthority]: true }>;
type Financial = { env: WorkerEnv; database: WorkerEnv["DB"]; actorUserId: string; payerUserId: string; jobId: string;
  grantId: string; scopeKey: string; slotId: string; consumptionId: string; campaignId: string; issuedGrantId: string;
  policyDigest: string; envelopeDigest: string; costReservationId: string; tokenReservationId: string; assertion: OutputSqlAssertion };
type Execution = { request: Request; env: WorkerEnv; database: WorkerEnv["DB"]; actorUserId: string; commandJson: string;
  financial: SponsorFinancialBinding; assertions: OutputSqlAssertion[] };
const finances = new WeakMap<SponsorFinancialBinding, Financial>();
const executions = new WeakMap<SponsorExecutionAuthority, Execution>();

// Monetary identities only. No creative source/private body or current campaign
// policy/consent is needed to record money already incurred by the original job.
const FINANCIAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions consumption ON consumption.job_id=job.job_id AND consumption.actor_user_id=execution.actor_user_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id AND issued.campaign_id=consumption.campaign_id
 JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
 WHERE job.job_id=? AND job.owner_id=? AND execution.actor_user_id=job.owner_id
 AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
 AND job.stream_id='creative:'||job.owner_id AND job.kind='generate' AND job.source_surface='outputs'
 AND execution.context_id IS NULL AND execution.plan_revision_id=slot.plan_revision_id
 AND execution.payer_user_id<>execution.actor_user_id AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
 AND execution.maximum_microusd=slot.maximum_microusd AND execution.maximum_calls=2 AND slot.maximum_calls=2
 AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1
 AND consumption.maximum_microusd=slot.maximum_microusd AND issued.actor_user_id=consumption.actor_user_id
 AND issued.session_digest=consumption.session_digest AND issued.intent_key=consumption.intent_key AND issued.envelope_digest=consumption.envelope_digest
 AND tokens.owner_id=execution.payer_user_id AND cost.owner_id=execution.payer_user_id
 AND tokens.stream_id=job.stream_id AND cost.stream_id=job.stream_id AND tokens.correlation_id=job.correlation_id AND cost.correlation_id=job.correlation_id
 AND tokens.operation='image-generation' AND cost.operation=tokens.operation AND cost.period=tokens.period
 AND tokens.reserved_tokens=slot.maximum_tokens AND cost.reserved_microusd=slot.maximum_microusd AND cost.allow_user_overage=0`;

/** Source-free, original financial authority. Call only after identifying a
 * sponsored personal native job; ordinary installations have no sponsor schema. */
export async function readSponsorFinancialBinding(env: WorkerEnv, actorUserId: string, jobId: string): Promise<SponsorFinancialBinding> {
  const row = await env.DB.prepare(`SELECT execution.payer_user_id,execution.grant_id,slot.scope_key,slot.slot_id,
    consumption.consumption_id,consumption.campaign_id,issued.grant_id AS issued_grant_id,issued.policy_digest,
    consumption.envelope_digest,slot.cost_reservation_id,slot.token_reservation_id ${FINANCIAL_FROM}`)
    .bind(jobId, actorUserId).first<Record<string, string>>();
  if (!row) return fail("sponsor_financial_binding_unavailable");
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 ${FINANCIAL_FROM}
    AND execution.payer_user_id=? AND execution.grant_id=? AND slot.scope_key=? AND slot.slot_id=?
    AND consumption.consumption_id=? AND consumption.campaign_id=? AND issued.grant_id=? AND issued.policy_digest=?
    AND consumption.envelope_digest=? AND slot.cost_reservation_id=? AND slot.token_reservation_id=?)`,
  bindings: [jobId, actorUserId, row.payer_user_id!, row.grant_id!, row.scope_key!, row.slot_id!, row.consumption_id!,
    row.campaign_id!, row.issued_grant_id!, row.policy_digest!, row.envelope_digest!, row.cost_reservation_id!, row.token_reservation_id!] };
  const binding = Object.freeze({}) as SponsorFinancialBinding;
  finances.set(binding, { env, database: env.DB, actorUserId, jobId, payerUserId: row.payer_user_id!, grantId: row.grant_id!, scopeKey: row.scope_key!,
    slotId: row.slot_id!, consumptionId: row.consumption_id!, campaignId: row.campaign_id!, issuedGrantId: row.issued_grant_id!, policyDigest: row.policy_digest!,
    envelopeDigest: row.envelope_digest!, costReservationId: row.cost_reservation_id!, tokenReservationId: row.token_reservation_id!, assertion });
  return binding;
}
export function sponsorFinancialIdentity(binding: SponsorFinancialBinding, env: WorkerEnv, actorUserId: string, jobId: string) {
  const state = finances.get(binding);
  if (!state || state.env !== env || state.database !== env.DB || state.actorUserId !== actorUserId || state.jobId !== jobId) return fail("sponsor_financial_authority_unavailable");
  return { payerUserId: state.payerUserId, assertion: structuredClone(state.assertion) };
}
async function current(env: WorkerEnv, assertions: OutputSqlAssertion[]) {
  const result = await env.DB.batch<Record<string, unknown>>(assertions.map(a => env.DB.prepare(`SELECT CASE WHEN (${a.sql}) THEN 1 ELSE 0 END AS current`).bind(...(a.bindings ?? []))));
  if (result.length !== assertions.length || result.some(r => r.success !== true || r.results.length !== 1 || r.results[0]?.current !== 1)) return fail("sponsor_execution_authority_revoked");
}

/** Dormant internal constructor. No registered route or loader calls this. A new
 * authenticated request reconstructs its payer from the original monetary joins;
 * no request JSON or caller-selected billing identity supplies financial authority. */
export async function createSponsorExecutionAuthority(trusted: OutputTrustedContext, rawCommand: Record<string, unknown>): Promise<SponsorExecutionAuthority> {
  if (jsonIssues(rawCommand).length) return fail("sponsor_execution_command_invalid");
  const commandJson = canonicalJson(rawCommand), command = JSON.parse(commandJson) as Record<string, unknown>;
  const { request, env } = trusted, scope = structuredClone(trusted.scope), database = env.DB, actorUserId = scope.actorUserId;
  if (scope.kind !== "personal" || scope.ownerUserId !== actorUserId || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== actorUserId || env.FORMA_PILOT_COHORT_ID?.trim()
    || command.action !== "run" || command.documentId !== scope.documentId || typeof command.grantId !== "string"
    || typeof command.clientMutationId !== "string" || Object.hasOwn(command, "sponsor_entitlement")) return fail("sponsor_execution_scope_unsupported");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || auth.user.userId !== actorUserId || auth.user.consentVersion !== POLICY_VERSION) return fail("sponsor_execution_principal_changed");
  const row = await env.DB.prepare(`SELECT slot.job_id,slot.route_digest,slot.provider,slot.model,slot.maximum_tokens,slot.maximum_microusd,
    body.private_json,campaign.policy_json,campaign.policy_digest,issued.issued_at_ms,issued.expires_at_ms,execution.expires_at AS execution_expires_at
    FROM output_execution_grants execution JOIN output_operation_slots slot ON slot.scope_key=execution.scope_key AND slot.grant_id=execution.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN event_private_payloads body ON body.private_event_id=execution.authorization_event_id AND body.owner_id=plan.owner_user_id
      AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    JOIN experience_sponsor_consumptions consumption ON consumption.job_id=slot.job_id
    JOIN experience_sponsor_campaigns campaign ON campaign.campaign_id=consumption.campaign_id
    JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id
    WHERE execution.scope_key=? AND execution.grant_id=? AND execution.actor_user_id=? AND plan.document_id=?`)
    .bind(scope.key, command.grantId, actorUserId, scope.documentId).first<Record<string, unknown>>();
  if (!row) return fail("sponsor_execution_original_unavailable");
  const financial = await readSponsorFinancialBinding(env, actorUserId, String(row.job_id));
  const f = finances.get(financial)!;
  const policy = readSponsorPolicy(JSON.parse(String(row.policy_json)));
  const authorization: unknown = JSON.parse(String(row.private_json));
  const envelope = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
  const marker = envelope && record(envelope.sponsor_entitlement) ? envelope.sponsor_entitlement : null;
  if (row.provider !== "openai" || policy.mode !== "candidate" || await digest(policy) !== f.policyDigest || row.policy_digest !== f.policyDigest || policy.payerUserId !== f.payerUserId
    || policy.campaignId !== f.campaignId || marker?.payer_user_id !== f.payerUserId || marker.campaign_id !== f.campaignId
    || marker.policy_digest !== f.policyDigest || marker.envelope_digest !== f.envelopeDigest || marker.consumption_id !== f.consumptionId
    || !policy.recipes.some(recipe => recipe.appId === "image" && recipe.outputKind === "image" && recipe.outputCount === 1
      && recipe.routeDigest === `sha256:${row.route_digest}` && recipe.provider === row.provider && recipe.model === row.model
      && recipe.maximumTokens === row.maximum_tokens && recipe.maximumMicrousd === row.maximum_microusd
      && recipe.calls.parsing === 0 && recipe.calls.planning === 1 && recipe.calls.render === 1 && recipe.calls.repair === 0)) return fail("sponsor_execution_binding_changed");
  const live: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign
    JOIN experience_sponsor_grants issued ON issued.campaign_id=campaign.campaign_id
    JOIN experience_sponsor_active_jobs active ON active.consumption_id=? AND active.actor_user_id=? AND active.job_id=?
    JOIN users actor ON actor.user_id=? JOIN users payer ON payer.user_id=?
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=? AND campaign.policy_json=?
    AND issued.grant_id=? AND issued.enabled=1 AND issued.policy_digest=campaign.policy_digest AND issued.issued_at_ms=? AND issued.expires_at_ms=?
    AND issued.issued_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND issued.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND ?<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND actor.role IN('creator','admin') AND payer.role IN('creator','admin') AND actor.consent_version=? AND payer.consent_version=?)`,
  bindings: [f.consumptionId, actorUserId, f.jobId, actorUserId, f.payerUserId, f.campaignId, f.policyDigest, String(row.policy_json), f.issuedGrantId, Number(row.issued_at_ms), Number(row.expires_at_ms),
    policy.startsAtMs, policy.expiresAtMs, POLICY_VERSION, POLICY_VERSION], deadlineMs: Math.min(policy.expiresAtMs, Number(row.expires_at_ms), Date.parse(String(row.execution_expires_at))) };
  const assertions = [f.assertion, live, { sql: "EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=(SELECT authorization_event_id FROM output_execution_grants WHERE scope_key=? AND grant_id=?) AND owner_id=? AND private_json=? AND redacted_at IS NULL)", bindings: [f.scopeKey, f.grantId, actorUserId, String(row.private_json)] }];
  await current(env, assertions);
  if (trusted.request !== request || trusted.env !== env || env.DB !== database || canonicalJson(trusted.scope) !== canonicalJson(scope)) return fail("sponsor_execution_authority_changed");
  const authority = Object.freeze({}) as SponsorExecutionAuthority;
  executions.set(authority, { request, env, database, actorUserId, commandJson, financial, assertions });
  return authority;
}

export async function requireSponsorExecution(authority: SponsorExecutionAuthority | undefined, env: WorkerEnv, actorUserId: string,
  input: { request?: Request; command?: Record<string, unknown>; jobId?: string; grantId?: string; scopeKey?: string }) {
  const state = authority && executions.get(authority);
  if (!state || state.env !== env || state.database !== env.DB || state.actorUserId !== actorUserId
    || input.request && input.request !== state.request || input.command && canonicalJson(input.command) !== state.commandJson) return fail("sponsor_execution_not_enabled");
  const f = finances.get(state.financial)!;
  if (input.jobId && input.jobId !== f.jobId || input.grantId && input.grantId !== f.grantId || input.scopeKey && input.scopeKey !== f.scopeKey) return fail("sponsor_execution_binding_changed");
  await current(env, state.assertions);
  return { financial: state.financial, payerUserId: f.payerUserId, assertions: structuredClone(state.assertions), marker: {
    payer_user_id: f.payerUserId, campaign_id: f.campaignId, policy_digest: f.policyDigest, envelope_digest: f.envelopeDigest, consumption_id: f.consumptionId } };
}

/** Remove occupancy only after terminal native truth and fully resolved original
 * reservations/calls. Cumulative consumption remains untouched. No active-policy
 * check can prevent accounting for work already incurred. */
export function sponsorTerminalReleaseStatement(binding: SponsorFinancialBinding, env: WorkerEnv, actorUserId: string, jobId: string) {
  const { assertion } = sponsorFinancialIdentity(binding, env, actorUserId, jobId), f = finances.get(binding)!;
  return env.DB.prepare(`DELETE FROM experience_sponsor_active_jobs WHERE actor_user_id=? AND consumption_id=? AND job_id=?
    AND (${assertion.sql}) AND EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
      WHERE job.job_id=? AND job.lease_expires_at IS NULL AND job.status IN('completed','failed','canceled')
      AND slot.status IN('succeeded','failed','cancelled') AND tokens.status IN('settled','released') AND cost.status IN('settled','released')
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id AND (calls.status IN('pending','uncertain') OR calls.used_microusd IS NULL)))`)
    .bind(actorUserId, f.consumptionId, jobId, ...(assertion.bindings ?? []), jobId);
}
