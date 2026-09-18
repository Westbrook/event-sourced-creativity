import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorEnvelope, SponsorEntitlementError, type SponsorEnvelopeV5 } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorSlidesCampaign, readSponsorInternalCommand, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { createSponsorAdmissionAuthority, sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { matchSponsorSlidesTemplate } from "./experience-sponsor-slides-contract.ts";
import { describeSponsorSlidesAdmission, readSponsorSlidesTemplateEvidence } from "./experience-sponsor-slides-evidence.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements, rememberOutputPrivateBody, readOutputCommand, outputCommandReceiptAssertion, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { outputDigest, type OutputTrustedContext } from "./output-requirements-api.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
export type SponsorSlidesDriverCommand = { action: "run-sponsored-slides"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
export function readSponsorSlidesDriverCommand(raw: unknown): SponsorSlidesDriverCommand {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"])
    || raw.action !== "run-sponsored-slides" || ![raw.campaignId, raw.documentId, raw.planRevisionId, raw.targetId, raw.intentKey].every(id)
    || String(raw.intentKey).length > 80) return fail("sponsor_driver_command_invalid");
  return Object.freeze(JSON.parse(canonicalJson(raw)) as SponsorSlidesDriverCommand);
}
/** Identity does not change when a caller changes content under the same intent. */
export async function sponsorSlidesIssuerIntentKey(raw: unknown) {
  const body = readSponsorSlidesDriverCommand(raw);
  return `sponsor-slides-authorize-${(await digest({ family: "canonical-five-slide-deck@1", campaignId: body.campaignId, intentKey: body.intentKey })).slice(7)}`;
}
// Uses the existing immutable, output-neutral issuance schema. This module
// exports no DDL, installs nothing and has no registered route.
declare const issuerAuthority: unique symbol;
export type SponsorSlidesIssuerAuthority = Readonly<{ [issuerAuthority]: true }>;
type State = { request: Request; signal: AbortSignal; scope: OutputTrustedContext["scope"]; capturedAssertions: OutputSqlAssertion[]; env: OutputTrustedContext["env"]; database: OutputTrustedContext["env"]["DB"];
  actorUserId: string; documentId: string; scopeJson: string; sourceBinding: string; driverCommand: SponsorSlidesDriverCommand;
  approved: Awaited<ReturnType<typeof loadApprovedSponsorSlidesCampaign>>; resourceAssertion: OutputSqlAssertion };
const issuers = new WeakMap<SponsorSlidesIssuerAuthority, State>();
type Guard = () => void;
async function guarded<T>(current: Guard, work: () => Promise<T>): Promise<T> {
  current();
  const value = await work();
  current();
  return value;
}
const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object"
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function checkBatch(results: unknown, count: number, proof: boolean) {
  if (!Array.isArray(results) || own(results, "length") !== count) return fail("sponsor_issuer_authority_changed");
  for (let index = 0; index < count; index++) {
    const result = own(results, index), rows = own(result, "results");
    if (own(result, "success") !== true || own(result, "error") !== undefined || !Array.isArray(rows)
      || own(rows, "length") !== (proof ? 1 : 0) || proof && own(own(rows, 0), "current") !== 1) return fail("sponsor_issuer_authority_changed");
  }
}
function beforeDeadline(assertions: readonly OutputSqlAssertion[]) {
  const deadline = Math.min(Number.POSITIVE_INFINITY, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (Number.isNaN(deadline) || Date.now() >= deadline) return fail("sponsor_issuer_authority_changed");
}
async function prove(state: State, assertions: OutputSqlAssertion[], current: Guard) {
  current(); beforeDeadline(assertions);
  const statements = outputProofReadStatements(state.env, assertions);
  const results = await guarded(current, () => state.database.batch<Record<string, unknown>>(statements));
  current(); beforeDeadline(assertions); checkBatch(results, statements.length, true); current();
}
async function commit(state: State, statements: D1PreparedStatement[], current: Guard) {
  const results = await guarded(current, () => state.database.batch(statements));
  current(); checkBatch(results, statements.length, false); current();
}
// Request metadata remains private to the lifecycle seal; it is never copied
// into a provider request, sponsor envelope or persisted receipt.
const sourceBinding = (trusted: OutputTrustedContext) => canonicalJson({ request: { url: trusted.request.url, method: trusted.request.method,
  headers: Array.from(trusted.request.headers.entries()) }, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
  context: trusted.context, assertions: trusted.sourceAssertions, ownerHead: trusted.ownerHead, sourceProblems: trusted.sourceProblems,
  sourcePrivateCaptured: trusted.sourcePrivateCaptured, principal: trusted.principal, projectContext: trusted.projectContext,
  configuration: { cohort: trusted.env.FORMA_PILOT_COHORT_ID ?? null, model: trusted.env.OPENAI_MODEL ?? null,
    compositionModel: trusted.env.OPENAI_SLIDES_COMPOSITION_MODEL ?? null, compositionEffort: trusted.env.OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT ?? null,
    repairModel: trusted.env.OPENAI_SLIDES_REPAIR_MODEL ?? null, repairEffort: trusted.env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT ?? null,
    providerConfigured: Boolean(trusted.env.OPENAI_API_KEY) } });
function stateFor(authority: SponsorSlidesIssuerAuthority, trusted: OutputTrustedContext) {
  const state = issuers.get(authority);
  if (!state || state.signal.aborted || state.request.signal !== state.signal || state.request !== trusted.request || state.scope !== trusted.scope || state.env !== trusted.env || state.database !== trusted.env.DB
    || state.actorUserId !== trusted.scope.actorUserId || state.documentId !== trusted.scope.documentId || state.scopeJson !== canonicalJson(trusted.scope)
    || state.sourceBinding !== sourceBinding(trusted)) return fail("sponsor_issuer_authority_changed");
  beforeDeadline([...state.capturedAssertions, { sql: "1", deadlineMs: Math.min(state.approved.policy.expiresAtMs, state.approved.policy.resources.expiresAtMs) }]);
  return state;
}

/** Only an eligible authenticated actor explicitly requesting this original
 * Slides may receive an issuer seal, under the payer's recorded approval. There
 * is no public issuer route and no caller-selected financial owner. */
export async function createSponsorSlidesIssuerAuthority(trusted: OutputTrustedContext, campaignId: string): Promise<SponsorSlidesIssuerAuthority> {
  const captured = { request: trusted.request, signal: trusted.request.signal, scope: trusted.scope, capturedAssertions: structuredClone(sponsorCurrentSourceAssertions(trusted)), env: trusted.env, database: trusted.env.DB, actorUserId: trusted.scope.actorUserId,
    documentId: trusted.scope.documentId, scopeJson: canonicalJson(trusted.scope), sourceBinding: sourceBinding(trusted) };
  const current = () => {
    if (captured.signal.aborted || captured.request.signal !== captured.signal || trusted.request !== captured.request || trusted.scope !== captured.scope || trusted.env !== captured.env || trusted.env.DB !== captured.database
      || canonicalJson(trusted.scope) !== captured.scopeJson || sourceBinding(trusted) !== captured.sourceBinding) return fail("sponsor_issuer_authority_changed");
  };
  const driverCommand = readSponsorSlidesDriverCommand(await guarded(current, () => readSponsorInternalCommand(captured.request, 4096)));
  current();
  if (driverCommand.campaignId !== campaignId || driverCommand.documentId !== captured.documentId || trusted.scope.kind !== "personal"
    || trusted.scope.ownerUserId !== captured.actorUserId || trusted.scope.contextId || trusted.scope.organizationId || trusted.scope.projectAccessId
    || trusted.projectContext || !trusted.context || !trusted.sourcePrivateCaptured || trusted.sourceProblems.length || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== captured.actorUserId) return fail("sponsor_issuer_scope_unsupported");
  // The shared loader has internal awaits. Its copied environment guards each
  // subsequent DB access, while the opaque issuer retains the original env.
  const approvalEnv = { ...captured.env, get DB() { current(); return captured.database; } };
  const approved = await guarded(current, () => loadApprovedSponsorSlidesCampaign(captured.request, approvalEnv, campaignId));
  current();
  if (approved.actor.userId !== captured.actorUserId) return fail("sponsor_issuer_authority_changed");
  current();
  const limitsDigest = await guarded(current, () => digest(approved.policy.resources));
  current();
  // This is current approved resource authority, not a renewed debit or a claim
  // that unused admission/inflight capacity is available on original replay.
  const resourceAssertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_policies resources
    WHERE resources.campaign_id=? AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`,
    bindings: [approved.policy.campaignId, limitsDigest, canonicalJson(approved.policy.resources), approved.policy.resources.startsAtMs, approved.policy.resources.expiresAtMs],
    deadlineMs: approved.policy.resources.expiresAtMs };
  const state = { ...captured, driverCommand, approved, resourceAssertion };
  await prove(state, [...approved.assertions, resourceAssertion, ...captured.capturedAssertions], current);
  current(); beforeDeadline([{ sql: "1", deadlineMs: Math.min(approved.policy.expiresAtMs, approved.policy.resources.expiresAtMs) }]);
  const authority = Object.freeze({}) as SponsorSlidesIssuerAuthority;
  issuers.set(authority, state);
  stateFor(authority, trusted);
  return authority;
}

/** Pin the very same native plan, selected target and quote requested by the
 * actor. Exact private bytes are retained for the final issuance transaction. */
async function issuerNativeIntentProof(trusted: OutputTrustedContext, command: Record<string, unknown>, requested: SponsorSlidesDriverCommand, current: Guard) {
  const sql = `SELECT preflight.plan_revision_id,preflight.event_id,preflight.terms_digest,preflight.expires_at,quote.private_json AS quote_json,
      plan.confirmed_event_id,plan.source_head,body.private_json AS plan_json
    FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
    JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
    JOIN event_private_payloads body ON body.private_event_id=plan.confirmed_event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
      AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?`;
  const bindings = [trusted.scope.key,String(command.preflightId),trusted.scope.actorUserId,trusted.scope.ownerUserId,trusted.scope.projectId,trusted.scope.documentId,
    trusted.sourceDigest,trusted.requirementsDigest];
  const row = await guarded(current, () => trusted.env.DB.prepare(sql).bind(...bindings)
    .first<{plan_revision_id:string;event_id:string;terms_digest:string;expires_at:string;quote_json:string;confirmed_event_id:string;source_head:number;plan_json:string}>());
  current();
  if (!row || row.plan_revision_id !== requested.planRevisionId || row.terms_digest !== command.termsDigest
    || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail("sponsor_issuer_intent_mismatch");
  const quote = rememberOutputPrivateBody(trusted.scope,row.event_id,row.quote_json), planBody = rememberOutputPrivateBody(trusted.scope,row.confirmed_event_id,row.plan_json);
  const preflight = record(quote.preflight) ? quote.preflight : null, confirmed = record(planBody.confirmed_plan) ? planBody.confirmed_plan : null;
  const plan = confirmed && record(confirmed.plan) ? confirmed.plan : null;
  const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 && record(preflight.targets[0]) ? preflight.targets[0] : null;
  const selected = plan && Array.isArray(plan.targets) ? plan.targets.filter(target => record(target) && target.selected === true) : [];
  if (preflight?.expiresAt !== row.expires_at || confirmed?.revisionId !== requested.planRevisionId || offered?.targetId !== requested.targetId || selected.length !== 1
    || !record(selected[0]) || selected[0].id !== requested.targetId || selected[0].media_kind !== "slides"
    || canonicalJson(selected[0].quantity) !== canonicalJson({ kind: "exact", unit: "presentation", value: 1 })
    || canonicalJson(selected[0].content_quantity) !== canonicalJson({ kind: "exact", unit: "slide", value: 5 })
    || canonicalJson(selected[0].count_policy) !== canonicalJson({ kind: "exact", unit: "slide", value: 5 })
    || canonicalJson(selected[0].source_scope) !== canonicalJson({ kind: "document" })
    || canonicalJson(selected[0].coverage) !== canonicalJson({ kind: "document_outline" })
    || !Array.isArray(selected[0].blocking_issues) || selected[0].blocking_issues.length
    || ["narrative_contract", "scene_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(selected[0], key))) return fail("sponsor_issuer_intent_mismatch");
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM (${sql}) captured WHERE plan_revision_id=? AND event_id=? AND terms_digest=?
    AND expires_at=? AND quote_json=? AND confirmed_event_id=? AND source_head=? AND plan_json=?)`,
    bindings: [...bindings, row.plan_revision_id, row.event_id, row.terms_digest, row.expires_at, row.quote_json, row.confirmed_event_id, row.source_head, row.plan_json],
    deadlineMs: Date.parse(row.expires_at) };
  return { sourceRevision: row.source_head, assertion };
}

/** A committed native authorization has advanced the owner stream. Recover its
 * exact original receipt rather than constructing a fresh admission capability
 * against an obsolete expectedRevision. This returns no execution authority. */
async function originalAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>, issuedGrantId: string,
  compiled: Awaited<ReturnType<typeof compileSponsorEnvelope>>, requested: SponsorSlidesDriverCommand, current: Guard): Promise<{ receipt: OutputCommandReceipt; assertions: OutputSqlAssertion[] } | null> {
  if (compiled.policy.version !== 5 || compiled.envelope.version !== 5) return fail("sponsor_issuer_original_unavailable");
  const policy = compiled.policy, envelope = compiled.envelope, marker = { envelope_digest: compiled.envelopeDigest, policy_digest: compiled.policyDigest,
    consumption_id: envelope.consumptionId, campaign_id: policy.campaignId, payer_user_id: policy.payerUserId };
  const nativeCommand = { ...command, sponsor_entitlement: marker };
  const nativeDigest = await guarded(current, () => outputDigest(nativeCommand));
  current();
  const receipt = await guarded(current, () => readOutputCommand(trusted.env, trusted.scope, String(command.clientMutationId), nativeDigest));
  current();
  if (!receipt) return null;
  const authorized = Array.isArray(receipt.payload.authorized_targets) && receipt.payload.authorized_targets.length === 1 && record(receipt.payload.authorized_targets[0])
    ? receipt.payload.authorized_targets[0] : null;
  if (!authorized || authorized.target_id !== requested.targetId || !id(authorized.operation_slot_id) || !id(authorized.job_id)
    || authorized.route_digest !== envelope.recipe.routeDigest.slice(7) || receipt.payload.plan_revision_id !== requested.planRevisionId
    || receipt.payload.preflight_id !== command.preflightId || receipt.payload.source_digest !== trusted.sourceDigest
    || receipt.payload.maximum_calls !== 2 || receipt.payload.maximum_microusd !== envelope.recipe.maximumMicrousd) return fail("sponsor_issuer_original_unavailable");
  if (receipt.action !== "authorize" || !id(receipt.payload.grant_id)
    || canonicalJson(receipt.payload.output_command_envelope) !== canonicalJson(nativeCommand)) return fail("sponsor_issuer_original_unavailable");
  // Only this read uses the current head. The original authorization command,
  // request digest and admission revision above remain byte-for-byte unchanged.
  const readCommand = { ...command, expectedRevision: `output:${trusted.ownerHead}` };
  const description = await guarded(current, () => describeSponsorSlidesAdmission(trusted, readCommand));
  current();
  const { preflightExpiresAtMs: ignoredExpiry, ...native } = description; void ignoredExpiry;
  if (Object.entries(native).some(([key, value]) => canonicalJson(value) !== canonicalJson(envelope[key as keyof SponsorEnvelopeV5])))
    return fail("sponsor_issuer_original_unavailable");
  const evidence = await guarded(current, () => readSponsorSlidesTemplateEvidence(trusted, readCommand, envelope.recipe));
  current();
  const templateDigests = await guarded(current, () => Promise.all(policy.templates.map(template => digest(template))));
  current();
  const matches = await guarded(current, () => Promise.all(policy.templates.map((template, index) =>
    templateDigests[index] === envelope.templateDigest ? matchSponsorSlidesTemplate(template, evidence) : Promise.resolve(false))));
  current();
  if (!matches.some(Boolean)) return fail("sponsor_issuer_original_unavailable");
  const settings = record(evidence.offered.settings) ? evidence.offered.settings : null;
  const calls = settings && Array.isArray(settings.calls) ? settings.calls : [];
  const initial = record(calls[0]) ? calls[0] : null, repair = record(calls[1]) ? calls[1] : null;
  if (!initial || !repair || calls.length !== 2) return fail("sponsor_issuer_original_unavailable");
  const issued = await guarded(current, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest: compiled.policyDigest,
    grantId: issuedGrantId, actorUserId: trusted.scope.actorUserId, sessionDigest: envelope.sessionDigest,
    intentKey: envelope.intentKey, envelopeDigest: compiled.envelopeDigest }));
  current();
  const lineage: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_execution_grants execution
    JOIN output_operation_slots slot ON slot.scope_key=execution.scope_key AND slot.grant_id=execution.grant_id
    JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id
    WHERE ((((((execution.scope_key=?)
 AND (execution.grant_id=?))
 AND ((execution.actor_user_id=?)
 AND (execution.payer_user_id=?)))
 AND (((execution.authorization_event_id=?)
 AND (execution.context_id IS NULL))
 AND ((execution.maximum_calls=2)
 AND ((execution.plan_revision_id=?)
 AND (execution.preflight_id=?)))))
 AND ((((slot.plan_revision_id=execution.plan_revision_id)
 AND (slot.target_id=?))
 AND ((execution.maximum_microusd=slot.maximum_microusd)
 AND (slot.provider=?)))
 AND (((slot.model=?)
 AND (slot.attempt_ordinal=0))
 AND ((slot.previous_slot_id IS NULL)
 AND ((slot.maximum_calls=2)
 AND (slot.source_digest=?))))))
 AND (((((slot.route_digest=?)
 AND (slot.maximum_microusd=?))
 AND ((slot.maximum_tokens=?)
 AND (slot.slot_id=?)))
 AND (((slot.job_id=?)
 AND (job.kind='render_document'))
 AND ((job.source_surface='outputs')
 AND ((job.owner_id=?)
 AND (job.document_id=?)))))
 AND ((((job.stream_id=?)
 AND (used.consumption_id=?))
 AND ((used.grant_id=?)
 AND ((used.campaign_id=?)
 AND (used.actor_user_id=?))))
 AND (((used.session_digest=?)
 AND (used.intent_key=?))
 AND ((used.envelope_digest=?)
 AND ((used.maximum_microusd=slot.maximum_microusd)
 AND ((SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1))))))))`,
    bindings: [trusted.scope.key, receipt.payload.grant_id, trusted.scope.actorUserId, envelope.payerUserId, receipt.eventId, requested.planRevisionId, String(command.preflightId), requested.targetId, envelope.recipe.provider, envelope.recipe.model,
      trusted.sourceDigest, envelope.recipe.routeDigest.slice(7), envelope.recipe.maximumMicrousd, envelope.recipe.maximumTokens, authorized.operation_slot_id, authorized.job_id,
      trusted.scope.actorUserId, trusted.scope.documentId, `creative:${trusted.scope.actorUserId}`,
      envelope.consumptionId, issuedGrantId, envelope.campaignId, trusted.scope.actorUserId, envelope.sessionDigest, envelope.intentKey, compiled.envelopeDigest] };
  // Route rows contain identity/count only. Full route settings and per-call
  // caps are proved by the exact retained quote bytes and accepted A matcher.
  const routes: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_operation_slots slot
    JOIN output_operation_routes initial ON initial.scope_key=slot.scope_key AND initial.slot_id=slot.slot_id AND initial.stage_key='planning:0:initial'
    JOIN output_operation_routes repair ON repair.scope_key=slot.scope_key AND repair.slot_id=slot.slot_id AND repair.stage_key='planning:0:repair'
    WHERE slot.scope_key=? AND slot.grant_id=? AND slot.target_id=? AND slot.slot_id=? AND slot.job_id=?
      AND initial.provider=? AND initial.model=? AND initial.model=slot.model AND initial.maximum_calls=1
      AND repair.provider=? AND repair.model=? AND repair.maximum_calls=1
      AND (SELECT COUNT(*) FROM output_operation_routes sibling WHERE sibling.scope_key=slot.scope_key AND sibling.slot_id=slot.slot_id)=2)`,
    bindings: [trusted.scope.key, receipt.payload.grant_id, requested.targetId, authorized.operation_slot_id, authorized.job_id, String(initial.provider), String(initial.model), String(repair.provider), String(repair.model)] };
  return { receipt, assertions: [issued, outputCommandReceiptAssertion(trusted.scope, receipt), lineage, routes] };
}

/** Idempotent server issuance. Resource debit, exact grant and immutable issuer
 * receipt commit together. Failed financial admission never rewrites this
 * original issuance and never refunds previously consumed resource work. */
export async function issueSponsorSlidesGrant(authority: SponsorSlidesIssuerAuthority, trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  if (jsonIssues(rawCommand).length || !record(rawCommand)
    || !exactKeys(rawCommand, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization"])
    || rawCommand.explicitAuthorization !== true || !Number.isSafeInteger(rawCommand.maximumMicrousd) || Number(rawCommand.maximumMicrousd) < 1)
    return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>, state = stateFor(authority, trusted);
  const current = () => { stateFor(authority, trusted); };
  const { policy, policyDigest, assertions } = state.approved;
  const intentKey = await guarded(current, () => sponsorSlidesIssuerIntentKey(state.driverCommand));
  current();
  const commandDigest = await guarded(current, () => digest(command));
  current();
  const driverCommandJson = canonicalJson(state.driverCommand);
  if (command.action !== "authorize" || command.clientMutationId !== intentKey || command.documentId !== state.documentId) return fail("sponsor_issuer_intent_mismatch");
  await prove(state, [...assertions, state.resourceAssertion, ...state.capturedAssertions], current);
  stateFor(authority, trusted);
  const existing = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(policy.campaignId, state.actorUserId, intentKey).first<Record<string, string>>());
  current();
  const finish = async (row: Record<string, string>, replayed: boolean) => {
    current();
    if (row.policy_digest !== policyDigest || row.driver_command_json !== driverCommandJson || row.command_digest !== commandDigest) return fail("sponsor_issuer_intent_conflict");
    const intent = await guarded(current, () => issuerNativeIntentProof(trusted, command, state.driverCommand, current));
    current();
    const compiled = await guarded(current, () => compileSponsorEnvelope(policy, JSON.parse(row.envelope_json!)));
    current();
    if (compiled.envelopeDigest !== row.envelope_digest || compiled.policy.version !== 5 || compiled.envelope.version !== 5 || compiled.envelope.sourceRevision !== intent.sourceRevision) return fail("sponsor_issuer_original_unavailable");
    const originalCurrent = () => { current(); if (Date.now() >= compiled.envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed"); };
    originalCurrent();
    const originalGrant: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?
      AND actor_user_id=? AND session_digest=? AND intent_key=? AND envelope_digest=? AND issued_at_ms=? AND expires_at_ms=? AND enabled=1)`,
      bindings: [row.grant_id!, policy.campaignId, policyDigest, state.actorUserId, compiled.envelope.sessionDigest, compiled.envelope.intentKey,
        compiled.envelopeDigest, compiled.envelope.issuedAtMs, compiled.envelope.expiresAtMs], deadlineMs: compiled.envelope.expiresAtMs };
    const admitted = await originalAdmission(trusted, command, row.grant_id!, compiled, state.driverCommand, originalCurrent);
    originalCurrent();
    if (admitted) {
      await prove(state, [...assertions, state.resourceAssertion, ...state.capturedAssertions, ...sponsorCurrentSourceAssertions(trusted), intent.assertion, originalGrant, ...admitted.assertions], originalCurrent);
      originalCurrent();
      return { kind: "admitted" as const, policy, envelope: compiled.envelope, grantId: row.grant_id!, nativeReceipt: admitted.receipt, replayed };
    }
    // Preserve the exact native opaque identities while checking lifetime before
    // nested helper access. The original scope also owns retained private proofs.
    const admissionTrusted: OutputTrustedContext = { ...trusted,
      get request() { originalCurrent(); return state.request; },
      get env() { originalCurrent(); return state.env; },
      get scope() { originalCurrent(); return state.scope; } };
    const admissionAuthority = await guarded(originalCurrent, () => createSponsorAdmissionAuthority({ trusted: admissionTrusted, command, policy, envelope: compiled.envelope, grantId: row.grant_id! }));
    originalCurrent();
    await prove(state, [...assertions, state.resourceAssertion, ...state.capturedAssertions, ...sponsorCurrentSourceAssertions(trusted), intent.assertion, originalGrant], originalCurrent);
    originalCurrent();
    return { kind: "issued" as const, policy, envelope: compiled.envelope, grantId: row.grant_id!, admissionAuthority, replayed };
  };
  if (existing) { const result = await finish(existing, true); current(); if (Date.now() >= result.envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed"); return result; }
  const nativeIntent = await guarded(current, () => issuerNativeIntentProof(trusted, command, state.driverCommand, current));
  current();
  const description = await guarded(current, () => describeSponsorSlidesAdmission(trusted, command));
  current();
  const evidence = await guarded(current, () => readSponsorSlidesTemplateEvidence(trusted, command, description.recipe));
  current();
  const template = policy.templates[(await guarded(current, () => Promise.all(policy.templates.map(value => matchSponsorSlidesTemplate(value, evidence))))).findIndex(Boolean)];
  current();
  const sessionDigest = await guarded(current, () => sponsorPrincipalDigest(state.approved.actor));
  current();
  if (!template || description.actorUserId !== state.actorUserId || description.sessionDigest !== sessionDigest) return fail("sponsor_campaign_template_mismatch");
  const clock = await guarded(current, () => state.database.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms").first<{ now_ms: number }>());
  current();
  if (!clock || !Number.isSafeInteger(clock.now_ms)) return fail("sponsor_database_clock_unavailable");
  const stable = (await guarded(current, () => digest({ campaignId: policy.campaignId, actorUserId: state.actorUserId, intentKey }))).slice(7), grantId = `sponsor-slides-issued-${stable}`;
  current();
  const { preflightExpiresAtMs, ...native } = description;
  const templateDigest = await guarded(current, () => digest(template));
  current();
  const envelope: SponsorEnvelopeV5 = { version: 5, family: "canonical-five-slide-deck@1", campaignId: policy.campaignId, policyVersion: policy.policyVersion, payerUserId: policy.payerUserId,
    consumptionId: `sponsor-slides-consume-${stable}`, intentKey, ...native, templateDigest, issuedAtMs: clock.now_ms,
    expiresAtMs: Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, preflightExpiresAtMs, clock.now_ms + policy.maximumGrantLifetimeMs) };
  const compiled = await guarded(current, () => compileSponsorEnvelope(policy, envelope));
  current();
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context?.snapshot ?? {})).byteLength;
  const resource = await guarded(current, () => prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId, policyDigest, actorUserId: state.actorUserId,
    sessionDigest: description.sessionDigest, intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest, textBytes, resourceId: `sponsor-slides-resource-issue-${stable}`, issuedGrantId: grantId }));
  current();
  const issuedProof = await guarded(current, () => sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId: state.actorUserId, sessionDigest: description.sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest }));
  stateFor(authority, trusted);
  try {
    await commit(state, [
      ...[...assertions, state.resourceAssertion, ...state.capturedAssertions, ...sponsorCurrentSourceAssertions(trusted), nativeIntent.assertion].flatMap(proof => outputAssertionStatements(state.env, proof)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)")
        .bind(grantId,policy.campaignId,policyDigest,state.actorUserId,description.sessionDigest,intentKey,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
      ...resource.statements.map(statement => state.env.DB.prepare(statement.sql).bind(...statement.bindings)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(grantId,policy.campaignId,state.actorUserId,intentKey,policyDigest,driverCommandJson,commandDigest,compiled.envelopeDigest,compiled.envelopeJson),
      ...outputAssertionStatements(state.env,issuedProof),
    ], current);
    current();
  } catch (error) {
    // Recover only an exact committed original after a lost acknowledgment. No
    // regenerated timestamps, new grant or counter adjustment is attempted.
    const original = await guarded(current, () => state.database.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
      .bind(policy.campaignId,state.actorUserId,intentKey).first<Record<string,string>>());
    current();
    if (!original) throw error;
    const result = await finish(original,true); current(); if (Date.now() >= result.envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed"); return result;
  }
  const result = await finish({grant_id:grantId,policy_digest:policyDigest,driver_command_json:driverCommandJson,command_digest:commandDigest,envelope_digest:compiled.envelopeDigest,envelope_json:compiled.envelopeJson},false);
  current(); if (Date.now() >= result.envelope.expiresAtMs) return fail("sponsor_issuer_authority_changed");
  return result;
}
