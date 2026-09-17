import { readSponsorSlidesTemplateEvidence } from "./experience-sponsor-slides-evidence.ts";
import { matchSponsorSlidesTemplate } from "./experience-sponsor-slides-contract.ts";
import { readSponsorStoryTemplateEvidence } from "./experience-sponsor-story-evidence.ts";
import { matchSponsorStoryTemplate } from "./experience-sponsor-story-contract.ts";
import { sponsorApprovalAssertion, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { matchSponsorImageTemplate } from "./experience-sponsor-campaign.ts";
import { sponsorImageEvidence } from "./experience-sponsor-image-evidence.ts";
import { sponsorResourceAdmissionAssertion } from "./experience-sponsor-resources.ts";
import { canonicalJson, digest, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsorPolicy, compileSponsorEnvelope, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
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
type Financial = { profile: "image" | "short_story" | "slides"; env: WorkerEnv; database: WorkerEnv["DB"]; actorUserId: string; payerUserId: string; jobId: string;
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

// Separate original monetary shape; never selected from a current campaign or caller DTO.
const STORY_FINANCIAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions consumption ON consumption.job_id=job.job_id AND consumption.actor_user_id=execution.actor_user_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id AND issued.campaign_id=consumption.campaign_id
 JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
 WHERE ((((((job.job_id=?)
 AND (job.owner_id=?))
 AND ((execution.actor_user_id=job.owner_id)
 AND ((plan.scope_kind='personal')
 AND (plan.owner_user_id=job.owner_id))))
 AND (((plan.document_id=job.document_id)
 AND (job.stream_id='creative:'||job.owner_id))
 AND ((job.kind='render_document')
 AND ((job.source_surface='outputs')
 AND (execution.context_id IS NULL)))))
 AND ((((execution.plan_revision_id=slot.plan_revision_id)
 AND (execution.payer_user_id<>execution.actor_user_id))
 AND ((slot.attempt_ordinal=0)
 AND ((slot.previous_slot_id IS NULL)
 AND (execution.maximum_microusd=slot.maximum_microusd))))
 AND (((execution.maximum_calls=1)
 AND (slot.maximum_calls=1))
 AND (((SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1)
 AND ((consumption.maximum_microusd=slot.maximum_microusd)
 AND (issued.actor_user_id=consumption.actor_user_id))))))
 AND (((((issued.session_digest=consumption.session_digest)
 AND (issued.intent_key=consumption.intent_key))
 AND ((issued.envelope_digest=consumption.envelope_digest)
 AND ((tokens.owner_id=execution.payer_user_id)
 AND (cost.owner_id=execution.payer_user_id))))
 AND (((tokens.stream_id=job.stream_id)
 AND (cost.stream_id=job.stream_id))
 AND ((tokens.correlation_id=job.correlation_id)
 AND ((cost.correlation_id=job.correlation_id)
 AND (tokens.operation='document-render:short_story')))))
 AND ((((cost.operation=tokens.operation)
 AND (cost.period=tokens.period))
 AND ((tokens.reserved_tokens=slot.maximum_tokens)
 AND ((cost.reserved_microusd=slot.maximum_microusd)
 AND (cost.allow_user_overage=0))))
 AND (((slot.provider='openai')
 AND (slot.maximum_tokens=128000))
 AND ((EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
   AND route.stage_key='planning:0:initial' AND route.provider=slot.provider AND route.model=slot.model AND route.maximum_calls=1))
 AND (((SELECT COUNT(*) FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id)=1)
 AND (EXISTS(SELECT 1 FROM experience_sponsor_issuances original WHERE original.grant_id=issued.grant_id
   AND original.envelope_digest=consumption.envelope_digest AND original.policy_digest=issued.policy_digest
   AND json_extract(original.envelope_json,'$.version')=4 AND json_extract(original.envelope_json,'$.family')='canonical-short-story@1'
   AND json_extract(original.envelope_json,'$.recipe.appId')='short-story' AND json_extract(original.envelope_json,'$.recipe.outputKind')='short_story'))))))))`;

// V5 monetary identity is separate from current creative/approval authority.
// Repair retains its own native route model; an unused repair has no call row.
const SLIDES_FINANCIAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions consumption ON consumption.job_id=job.job_id AND consumption.actor_user_id=execution.actor_user_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id AND issued.campaign_id=consumption.campaign_id
 JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
 WHERE ((((((job.job_id=?)
 AND (job.owner_id=?))
 AND ((execution.actor_user_id=job.owner_id)
 AND ((plan.scope_kind='personal')
 AND (plan.owner_user_id=job.owner_id))))
 AND (((plan.document_id=job.document_id)
 AND (job.stream_id='creative:'||job.owner_id))
 AND ((job.kind='render_document')
 AND ((job.source_surface='outputs')
 AND (execution.context_id IS NULL)))))
 AND ((((execution.plan_revision_id=slot.plan_revision_id)
 AND (execution.payer_user_id<>execution.actor_user_id))
 AND ((slot.attempt_ordinal=0)
 AND ((slot.previous_slot_id IS NULL)
 AND (execution.maximum_microusd=slot.maximum_microusd))))
 AND (((execution.maximum_calls=2)
 AND (slot.maximum_calls=2))
 AND (((SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1)
 AND ((consumption.maximum_microusd=slot.maximum_microusd)
 AND (issued.actor_user_id=consumption.actor_user_id))))))
 AND (((((issued.session_digest=consumption.session_digest)
 AND (issued.intent_key=consumption.intent_key))
 AND ((issued.envelope_digest=consumption.envelope_digest)
 AND ((tokens.owner_id=execution.payer_user_id)
 AND (cost.owner_id=execution.payer_user_id))))
 AND (((tokens.stream_id=job.stream_id)
 AND (cost.stream_id=job.stream_id))
 AND ((tokens.correlation_id=job.correlation_id)
 AND ((cost.correlation_id=job.correlation_id)
 AND (tokens.operation='document-render:slides')))))
 AND ((((cost.operation=tokens.operation)
 AND (cost.period=tokens.period))
 AND ((tokens.reserved_tokens=slot.maximum_tokens)
 AND ((cost.reserved_microusd=slot.maximum_microusd)
 AND (cost.allow_user_overage=0))))
 AND (((slot.provider='openai')
 AND ((slot.maximum_tokens=128000)
 AND (EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
   AND route.stage_key='planning:0:initial' AND route.provider=slot.provider AND route.model=slot.model AND route.maximum_calls=1))))
 AND (((SELECT COUNT(*) FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id)=2)
 AND ((EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
   AND route.stage_key='planning:0:repair' AND route.provider=slot.provider AND route.maximum_calls=1))
 AND (EXISTS(SELECT 1 FROM experience_sponsor_issuances original WHERE (((((original.grant_id=issued.grant_id)
 AND ((original.campaign_id=issued.campaign_id)
 AND (original.actor_user_id=job.owner_id)))
 AND ((original.intent_key=consumption.intent_key)
 AND ((original.envelope_digest=consumption.envelope_digest)
 AND (original.policy_digest=issued.policy_digest))))
 AND (((json_extract(original.envelope_json,'$.version')=5)
 AND ((json_extract(original.envelope_json,'$.family')='canonical-five-slide-deck@1')
 AND (json_extract(original.envelope_json,'$.recipe.appId')='slides')))
 AND ((json_extract(original.envelope_json,'$.recipe.outputKind')='slides')
 AND ((json_extract(original.envelope_json,'$.recipe.provider')=slot.provider)
 AND (json_extract(original.envelope_json,'$.recipe.model')=slot.model)))))
 AND ((((json_extract(original.envelope_json,'$.recipe.routeDigest')='sha256:'||slot.route_digest)
 AND ((json_extract(original.envelope_json,'$.sourceDigest')='sha256:'||slot.source_digest)
 AND (json_extract(original.envelope_json,'$.recipe.maximumTokens')=slot.maximum_tokens)))
 AND ((json_extract(original.envelope_json,'$.recipe.maximumMicrousd')=slot.maximum_microusd)
 AND ((json_extract(original.envelope_json,'$.recipe.calls.parsing')=0)
 AND (json_extract(original.envelope_json,'$.recipe.calls.planning')=1))))
 AND (((json_extract(original.envelope_json,'$.recipe.calls.render')=0)
 AND ((json_extract(original.envelope_json,'$.recipe.calls.repair')=1)
 AND (json_extract(original.envelope_json,'$.recipe.outputCount')=1)))
 AND ((json_extract(original.envelope_json,'$.recipe.durationMs')=0)
 AND ((json_extract(original.envelope_json,'$.recipe.width')=0)
 AND (json_extract(original.envelope_json,'$.recipe.height')=0))))))))))))))`;

/** Source-free, original financial authority. Call only after identifying a
 * sponsored personal native job; ordinary installations have no sponsor schema. */
export async function readSponsorFinancialBinding(env: WorkerEnv, actorUserId: string, jobId: string): Promise<SponsorFinancialBinding> {
  const database = env.DB;
  let from = FINANCIAL_FROM, profile: Financial["profile"] = "image";
  let row = await database.prepare(`SELECT execution.payer_user_id,execution.grant_id,slot.scope_key,slot.slot_id,
    consumption.consumption_id,consumption.campaign_id,issued.grant_id AS issued_grant_id,issued.policy_digest,
    consumption.envelope_digest,slot.cost_reservation_id,slot.token_reservation_id ${FINANCIAL_FROM}`)
    .bind(jobId, actorUserId).first<Record<string, string>>();
  if (!row) {
    const job = await database.prepare("SELECT kind FROM document_jobs WHERE job_id=? AND owner_id=?").bind(jobId, actorUserId).first<{ kind: string }>();
    if (job?.kind !== "render_document") return fail("sponsor_financial_binding_unavailable");
    from = STORY_FINANCIAL_FROM; profile = "short_story";
    row = await database.prepare(`SELECT execution.payer_user_id,execution.grant_id,slot.scope_key,slot.slot_id,
      consumption.consumption_id,consumption.campaign_id,issued.grant_id AS issued_grant_id,issued.policy_digest,
      consumption.envelope_digest,slot.cost_reservation_id,slot.token_reservation_id ${STORY_FINANCIAL_FROM}`)
      .bind(jobId, actorUserId).first<Record<string, string>>();
  }
  if (!row) {
    from = SLIDES_FINANCIAL_FROM; profile = "slides";
    row = await database.prepare(`SELECT execution.payer_user_id,execution.grant_id,slot.scope_key,slot.slot_id,
      consumption.consumption_id,consumption.campaign_id,issued.grant_id AS issued_grant_id,issued.policy_digest,
      consumption.envelope_digest,slot.cost_reservation_id,slot.token_reservation_id ${SLIDES_FINANCIAL_FROM}`)
      .bind(jobId, actorUserId).first<Record<string, string>>();
  }
  if (!row || env.DB !== database) return fail("sponsor_financial_binding_unavailable");
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 ${from}
    AND execution.payer_user_id=? AND execution.grant_id=? AND slot.scope_key=? AND slot.slot_id=?
    AND consumption.consumption_id=? AND consumption.campaign_id=? AND issued.grant_id=? AND issued.policy_digest=?
    AND consumption.envelope_digest=? AND slot.cost_reservation_id=? AND slot.token_reservation_id=?)`,
  bindings: [jobId, actorUserId, row.payer_user_id!, row.grant_id!, row.scope_key!, row.slot_id!, row.consumption_id!,
    row.campaign_id!, row.issued_grant_id!, row.policy_digest!, row.envelope_digest!, row.cost_reservation_id!, row.token_reservation_id!] };
  const binding = Object.freeze({}) as SponsorFinancialBinding;
  finances.set(binding, { profile, env, database, actorUserId, jobId, payerUserId: row.payer_user_id!, grantId: row.grant_id!, scopeKey: row.scope_key!,
    slotId: row.slot_id!, consumptionId: row.consumption_id!, campaignId: row.campaign_id!, issuedGrantId: row.issued_grant_id!, policyDigest: row.policy_digest!,
    envelopeDigest: row.envelope_digest!, costReservationId: row.cost_reservation_id!, tokenReservationId: row.token_reservation_id!, assertion });
  return binding;
}
export function sponsorFinancialIdentity(binding: SponsorFinancialBinding, env: WorkerEnv, actorUserId: string, jobId: string) {
  const state = finances.get(binding);
  if (!state || state.env !== env || state.database !== env.DB || state.actorUserId !== actorUserId || state.jobId !== jobId) return fail("sponsor_financial_authority_unavailable");
  return { payerUserId: state.payerUserId, assertion: structuredClone(state.assertion) };
}
/** Narrow events gate: the original monetary branch supplies the profile.
 * No action, artifactKind, payer field or mutable campaign chooses it. */
export function sponsorFinancialEventProfile(binding: SponsorFinancialBinding, env: WorkerEnv, actorUserId: string,
  reference: { scopeKey: string; grantId: string; slotId: string }) {
  const state = finances.get(binding);
  if (!state || state.env !== env || state.database !== env.DB || state.actorUserId !== actorUserId
    || state.scopeKey !== reference.scopeKey || state.grantId !== reference.grantId || state.slotId !== reference.slotId)
    return fail("sponsor_financial_authority_unavailable");
  return state.profile;
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
    body.private_json,quote.private_json AS preflight_private_json,campaign.policy_json,campaign.policy_digest,issued.issued_at_ms,issued.expires_at_ms,execution.expires_at AS execution_expires_at
    FROM output_execution_grants execution JOIN output_operation_slots slot ON slot.scope_key=execution.scope_key AND slot.grant_id=execution.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN event_private_payloads body ON body.private_event_id=execution.authorization_event_id AND body.owner_id=plan.owner_user_id
      AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    JOIN output_preflights preflight ON preflight.scope_key=execution.scope_key AND preflight.preflight_id=execution.preflight_id
    JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id
      AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
    JOIN experience_sponsor_consumptions consumption ON consumption.job_id=slot.job_id
    JOIN experience_sponsor_campaigns campaign ON campaign.campaign_id=consumption.campaign_id
    JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id
    WHERE execution.scope_key=? AND execution.grant_id=? AND execution.actor_user_id=? AND plan.document_id=?`)
    .bind(scope.key, command.grantId, actorUserId, scope.documentId).first<Record<string, unknown>>();
  if (!row) return fail("sponsor_execution_original_unavailable");
  const financial = await readSponsorFinancialBinding(env, actorUserId, String(row.job_id));
  const f = finances.get(financial)!;
  const policy = readSponsorPolicy(JSON.parse(String(row.policy_json)));
  if (policy.mode !== "candidate") return fail("sponsor_execution_binding_changed");
  const approvalAssertions: OutputSqlAssertion[] = [];
  let recipeEligible = policy.version === 1 && policy.recipes.some(recipe => recipe.appId === "image" && recipe.outputKind === "image" && recipe.outputCount === 1
    && recipe.routeDigest === `sha256:${row.route_digest}` && recipe.provider === row.provider && recipe.model === row.model
    && recipe.maximumTokens === row.maximum_tokens && recipe.maximumMicrousd === row.maximum_microusd
    && recipe.calls.parsing === 0 && recipe.calls.planning === 1 && recipe.calls.render === 1 && recipe.calls.repair === 0);
  if (policy.version === 2 || policy.version === 4 || policy.version === 5) {
    const issued = await env.DB.prepare("SELECT envelope_json FROM experience_sponsor_issuances WHERE grant_id=? AND envelope_digest=? AND policy_digest=?").bind(f.issuedGrantId,f.envelopeDigest,f.policyDigest).first<{envelope_json:string}>();
    if (!issued) return fail("sponsor_execution_binding_changed");
    const compiled = await compileSponsorEnvelope(policy,JSON.parse(issued.envelope_json));
    const quote: unknown = JSON.parse(String(row.preflight_private_json));
    const preflight = record(quote) && record(quote.preflight) ? quote.preflight : null;
    const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 ? preflight.targets[0] : null;
    if (policy.version === 2) {
      const evidence = await sponsorImageEvidence(env,compiled.envelope.recipe,offered);
      recipeEligible = f.profile === "image" && compiled.envelopeDigest === f.envelopeDigest && compiled.envelope.recipe.routeDigest === `sha256:${row.route_digest}`
        && policy.templates.some(template => matchSponsorImageTemplate(template,evidence));
    } else if (policy.version === 4) {
      const authorization: unknown = JSON.parse(String(row.private_json));
      const original = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
      if (!original) return fail("sponsor_execution_binding_changed");
      const { sponsor_entitlement: ignored, ...authorize } = original; void ignored;
      // A fresh read checks the original authorization quote against current
      // native source; rebasing its read revision emits no authorization/write.
      const evidence = await readSponsorStoryTemplateEvidence(trusted, { ...authorize, expectedRevision: `output:${trusted.ownerHead}` }, compiled.envelope.recipe);
      recipeEligible = f.profile === "short_story" && compiled.envelopeDigest === f.envelopeDigest
        && compiled.envelope.recipe.routeDigest === `sha256:${row.route_digest}` && compiled.envelope.recipe.provider === row.provider
        && compiled.envelope.recipe.model === row.model && compiled.envelope.recipe.maximumTokens === row.maximum_tokens
        && compiled.envelope.recipe.maximumMicrousd === row.maximum_microusd
        && (await Promise.all(policy.templates.map(template => matchSponsorStoryTemplate(template,evidence)))).some(Boolean);
      approvalAssertions.push({ sql: "EXISTS(SELECT 1 FROM event_private_payloads quote JOIN output_preflights preflight ON preflight.event_id=quote.private_event_id WHERE preflight.scope_key=? AND preflight.preflight_id=? AND quote.owner_id=? AND quote.private_json=? AND quote.redacted_at IS NULL)",
        bindings: [scope.key, String(authorize.preflightId), actorUserId, String(row.preflight_private_json)] });
    } else {
      const authorization: unknown = JSON.parse(String(row.private_json));
      const original = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
      if (!original) return fail("sponsor_execution_binding_changed");
      const { sponsor_entitlement: ignored, ...authorize } = original; void ignored;
      // A fresh read checks the original authorization quote against current
      // native source; rebasing its read revision emits no authorization/write.
      const evidence = await readSponsorSlidesTemplateEvidence(trusted, { ...authorize, expectedRevision: `output:${trusted.ownerHead}` }, compiled.envelope.recipe);
      recipeEligible = f.profile === "slides" && compiled.envelopeDigest === f.envelopeDigest
        && compiled.envelope.recipe.routeDigest === `sha256:${row.route_digest}` && compiled.envelope.recipe.provider === row.provider
        && compiled.envelope.recipe.model === row.model && compiled.envelope.recipe.maximumTokens === row.maximum_tokens
        && compiled.envelope.recipe.maximumMicrousd === row.maximum_microusd
        && (await Promise.all(policy.templates.map(template => matchSponsorSlidesTemplate(template,evidence)))).some(Boolean);
      approvalAssertions.push({ sql: "EXISTS(SELECT 1 FROM event_private_payloads quote JOIN output_preflights preflight ON preflight.event_id=quote.private_event_id WHERE preflight.scope_key=? AND preflight.preflight_id=? AND quote.owner_id=? AND quote.private_json=? AND quote.redacted_at IS NULL)",
        bindings: [scope.key, String(authorize.preflightId), actorUserId, String(row.preflight_private_json)] });
    }
    approvalAssertions.push(sponsorApprovalAssertion(policy,actorUserId),await sponsorIssuedAuthorityAssertion({policy,policyDigest:f.policyDigest,grantId:f.issuedGrantId,
      actorUserId,sessionDigest:compiled.envelope.sessionDigest,intentKey:compiled.envelope.intentKey,envelopeDigest:f.envelopeDigest}));
    const resource=await sponsorResourceAdmissionAssertion({limits:policy.resources,campaignId:policy.campaignId,policyDigest:f.policyDigest,actorUserId});
    approvalAssertions.push({sql:resource.sql,bindings:[...resource.bindings],deadlineMs:policy.resources.expiresAtMs});
  }
  const authorization: unknown = JSON.parse(String(row.private_json));
  const envelope = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
  const marker = envelope && record(envelope.sponsor_entitlement) ? envelope.sponsor_entitlement : null;
  if (row.provider !== "openai" || policy.mode !== "candidate" || await digest(policy) !== f.policyDigest || row.policy_digest !== f.policyDigest || policy.payerUserId !== f.payerUserId
    || policy.campaignId !== f.campaignId || marker?.payer_user_id !== f.payerUserId || marker.campaign_id !== f.campaignId
    || marker.policy_digest !== f.policyDigest || marker.envelope_digest !== f.envelopeDigest || marker.consumption_id !== f.consumptionId
    || !recipeEligible) return fail("sponsor_execution_binding_changed");
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
  const assertions = [f.assertion, live, ...approvalAssertions, { sql: "EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=(SELECT authorization_event_id FROM output_execution_grants WHERE scope_key=? AND grant_id=?) AND owner_id=? AND private_json=? AND redacted_at IS NULL)", bindings: [f.scopeKey, f.grantId, actorUserId, String(row.private_json)] }];
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
