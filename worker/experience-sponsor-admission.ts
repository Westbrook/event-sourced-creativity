import { sponsorApprovalAssertion, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { matchSponsorImageTemplate } from "./experience-sponsor-campaign.ts";
import { readSponsorImageTemplateEvidence } from "./experience-sponsor-image-evidence.ts";
import { sponsorResourceAdmissionAssertion } from "./experience-sponsor-resources.ts";
import { canonicalJson, digest, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { compileSponsorEnvelope, SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { prepareSponsorEntitlement, type SponsorNativeAdmission } from "./experience-sponsor-entitlement.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

declare const sponsorAdmission: unique symbol;
export type SponsorAdmissionAuthority = Readonly<{ [sponsorAdmission]: true }>;
type Compiled = Awaited<ReturnType<typeof compileSponsorEnvelope>>;
type Identity = { request: Request; env: WorkerEnv; actorUserId: string; documentId: string };
type State = Identity & { database: WorkerEnv["DB"]; scope: string; sourceDigest: string; requirementsDigest: string;
  sourceBindingJson: string; commandJson: string; grantId: string; compiled: Compiled; assertions: OutputSqlAssertion[]; principalDigest: string };
const authorities = new WeakMap<SponsorAdmissionAuthority, State>();
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const sourceBinding = (trusted: OutputTrustedContext) => canonicalJson({ snapshot: trusted.context?.snapshot ?? null, assertions: trusted.sourceAssertions });

/** Existing canonical identity binding, not a new login session or guest cookie. */
export function sponsorPrincipalDigest(principal: PilotUser) {
  return digest({ version: "sponsor-canonical-principal@1", userId: principal.userId,
    consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null });
}
function stateFor(authority: SponsorAdmissionAuthority, identity: Identity) {
  const state = authorities.get(authority);
  if (!state || state.request !== identity.request || state.env !== identity.env || state.database !== identity.env.DB
    || state.actorUserId !== identity.actorUserId || state.documentId !== identity.documentId) return fail("sponsor_authority_unavailable");
  return state;
}
export function sponsorAdmissionPayer(authority: SponsorAdmissionAuthority, identity: Identity) {
  const state = stateFor(authority, identity);
  return { payerUserId: state.compiled.policy.payerUserId, assertions: structuredClone(state.assertions) };
}
function identity(trusted: OutputTrustedContext): Identity {
  return { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId };
}
async function principalFor(trusted: OutputTrustedContext) {
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId
    || trusted.env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_scope_unsupported");
  const auth = await readExistingPrincipalRequest(trusted.request, trusted.env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || auth.user.userId !== trusted.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user.authorizationSnapshot) !== canonicalJson(trusted.principal.authorizationSnapshot)) return fail("sponsor_principal_changed");
  return auth.user;
}

/** Read-only contract description from retained native evidence. Only this first
 * text-only Image mapping is qualified; this does not choose a launch recipe. */
export async function describeSponsorImageAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const principal = await principalFor(trusted);
  if (jsonIssues(command).length || command.action !== "authorize" || typeof command.clientMutationId !== "string"
    || command.documentId !== trusted.scope.documentId || typeof command.preflightId !== "string"
    || Object.hasOwn(command, "sponsor_entitlement") || !trusted.context || trusted.sourceProblems.length) return fail("sponsor_command_invalid");
  const row = await trusted.env.DB.prepare(`SELECT preflight.terms_digest,preflight.expires_at,body.private_json,plan.source_head
    FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
    JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
      AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?`)
    .bind(trusted.scope.key, command.preflightId, principal.userId, principal.userId, trusted.scope.projectId, trusted.scope.documentId,
      trusted.sourceDigest, trusted.requirementsDigest).first<{ terms_digest: string; expires_at: string; private_json: string; source_head: number }>();
  if (!row || row.terms_digest !== command.termsDigest) return fail("sponsor_native_terms_changed");
  const body: unknown = JSON.parse(row.private_json), preflight = record(body) && record(body.preflight) ? body.preflight : null;
  const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 && record(preflight.targets[0]) ? preflight.targets[0] : null;
  const settings = offered && record(offered.settings) ? offered.settings : null;
  const calls = settings && Array.isArray(settings.calls) ? settings.calls : [];
  const planning = record(calls[0]) ? calls[0] : null, rendering = record(calls[1]) ? calls[1] : null;
  const render = settings && record(settings.imageRender) ? settings.imageRender : null;
  const size = typeof render?.size === "string" ? /^(\d+)x(\d+)$/u.exec(render.size) : null;
  const facts = Array.isArray(trusted.context.snapshot.facts) ? trusted.context.snapshot.facts : [];
  const attempts = preflight && record(preflight.operationAttempts) ? preflight.operationAttempts : {};
  const attempt = offered && record(attempts[String(offered.targetId)]) ? attempts[String(offered.targetId)] as Record<string, unknown> : null;
  const textTypes = new Set(["subject", "message", "style", "mood", "lighting", "composition", "color", "palette", "medium", "constraint", "detail", "text", "treatment", "negative", "output"]);
  if (!offered?.available || settings?.kind !== "generate" || !size || calls.length !== 2 || offered.maximumCalls !== 2
    || planning?.stage !== "planning:initial" || planning.provider !== "openai" || typeof planning.model !== "string"
    || rendering?.stage !== "image:initial" || rendering.provider !== offered.provider || rendering.model !== offered.model
    || facts.some(fact => !record(fact) || !textTypes.has(String(fact.type).toLowerCase()))
    || !record(settings.payload) || Object.hasOwn(settings.payload, "sourcePreviewId") || Object.hasOwn(settings.payload, "references")
    || attempt?.ordinal !== 0 || attempt.previousSlotId !== null || preflight?.maximumMicrousd !== command.maximumMicrousd
    || command.explicitAuthorization !== true) return fail("sponsor_recipe_unsupported");
  const release = await registeredExperience("image");
  if (!release) return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "image", recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "image", provider: String(offered.provider), model: String(offered.model), routeDigest: await digest(offered),
    settingsDigest: await digest(settings), outputCount: 1, durationMs: 0, width: Number(size[1]), height: Number(size[2]),
    calls: { parsing: 0, planning: 1, render: 1, repair: 0 }, maximumTokens: Number(offered.maximumTokens), maximumMicrousd: Number(offered.maximumMicrousd) };
  return { actorKind: "canonical-principal" as const, actorUserId: principal.userId, sessionDigest: await sponsorPrincipalDigest(principal),
    ownerUserId: principal.userId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId,
    sourceRevision: row.source_head, sourceDigest: `sha256:${trusted.sourceDigest}`, orderedAssetDigests: [] as string[],
    rightsDigest: await digest(trusted.sourceAssertions), compiledInputDigest: await digest({ snapshot: trusted.context.snapshot, settings }),
    transferEnvelopeDigest: await digest({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, settings }), recipe,
    preflightExpiresAtMs: Date.parse(row.expires_at) };
}

/** Dormant server-only capability constructor. No registered route or enrollment
 * calls it; only the disabled internal issuer composes it. Public fields cannot recreate a seal: the original Request/DB,
 * independently read principal and exact stored campaign/grant are required. */
export async function createSponsorAdmissionAuthority(input: {
  trusted: OutputTrustedContext; command: Record<string, unknown>; policy: unknown; envelope: unknown; grantId: string;
}): Promise<SponsorAdmissionAuthority> {
  if (jsonIssues(input.command).length) return fail("sponsor_command_invalid");
  const trusted = input.trusted, commandJson = canonicalJson(input.command), grantId = input.grantId;
  const captured = { ...identity(trusted), database: trusted.env.DB, scope: canonicalJson(trusted.scope),
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, sourceBindingJson: sourceBinding(trusted) };
  const current = () => captured.request === trusted.request && captured.env === trusted.env && captured.database === trusted.env.DB
    && captured.scope === canonicalJson(trusted.scope) && captured.sourceDigest === trusted.sourceDigest && captured.requirementsDigest === trusted.requirementsDigest && captured.sourceBindingJson === sourceBinding(trusted);
  const command = JSON.parse(commandJson) as Record<string, unknown>;
  if (typeof grantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(grantId)) return fail("sponsor_grant_invalid");
  const [compiled, description] = await Promise.all([compileSponsorEnvelope(input.policy, input.envelope), describeSponsorImageAdmission(trusted, command)]);
  if (!current()) return fail("sponsor_authority_changed");
  if (compiled.policy.version === 2) {
    const evidence = await readSponsorImageTemplateEvidence(trusted, command, description.recipe);
    if (!compiled.policy.templates.some(template => matchSponsorImageTemplate(template, evidence))) return fail("sponsor_campaign_template_mismatch");
  }
  for (const [key, value] of Object.entries(description)) {
    if (key === "preflightExpiresAtMs") continue;
    if (canonicalJson(compiled.envelope[key as keyof typeof compiled.envelope]) !== canonicalJson(value)) return fail("sponsor_native_envelope_mismatch");
  }
  if (compiled.envelope.intentKey !== command.clientMutationId || compiled.envelope.expiresAtMs > description.preflightExpiresAtMs)
    return fail("sponsor_native_envelope_mismatch");
  const e = compiled.envelope, p = compiled.policy;
  const principalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
  const principalAssertions: OutputSqlAssertion[] = [];
  for (const userId of [e.actorUserId, p.payerUserId]) {
    const row = await trusted.env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(userId).first<Record<string, unknown>>();
    if (!row) return fail("sponsor_principal_changed");
    principalAssertions.push({ sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [userId, JSON.stringify(principalColumns.map(column => row[column] ?? null))] });
  }
  const issuedAssertions: OutputSqlAssertion[] = p.version === 2 ? [sponsorApprovalAssertion(p, e.actorUserId), await sponsorIssuedAuthorityAssertion({ policy:p, policyDigest:compiled.policyDigest, grantId,
    actorUserId:e.actorUserId,sessionDigest:e.sessionDigest,intentKey:e.intentKey,envelopeDigest:compiled.envelopeDigest })] : [];
  const assertions: OutputSqlAssertion[] = [...principalAssertions, ...issuedAssertions, { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign JOIN experience_sponsor_grants grant_row ON grant_row.campaign_id=campaign.campaign_id
    JOIN users actor ON actor.user_id=grant_row.actor_user_id JOIN users payer ON payer.user_id=?
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=? AND campaign.policy_json=?
      AND grant_row.grant_id=? AND grant_row.enabled=1 AND grant_row.policy_digest=campaign.policy_digest
      AND grant_row.actor_user_id=? AND grant_row.session_digest=? AND grant_row.intent_key=? AND grant_row.envelope_digest=?
      AND grant_row.issued_at_ms=? AND grant_row.expires_at_ms=?
      AND grant_row.issued_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND grant_row.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND actor.consent_version=? AND payer.consent_version=? AND actor.role IN('creator','admin') AND payer.role IN('creator','admin')
      AND NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
        WHERE participant.user_id IN(actor.user_id,payer.user_id) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed')))
    AND NOT EXISTS(SELECT 1 FROM organization_projects project
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN budget_scope_policies policy ON policy.scope='workspace' AND policy.scope_id=project.organization_id AND policy.organization_id=project.organization_id
      WHERE project.owner_user_id=? AND project.status='active' AND project.project_id=?)`,
  bindings: [p.payerUserId, p.campaignId, compiled.policyDigest, compiled.policyJson, grantId, e.actorUserId, e.sessionDigest, e.intentKey,
    compiled.envelopeDigest, e.issuedAtMs, e.expiresAtMs, POLICY_VERSION, POLICY_VERSION, e.actorUserId, e.actorUserId, e.projectId] }];
  const authority = Object.freeze({}) as SponsorAdmissionAuthority;
  if (!current()) return fail("sponsor_authority_changed");
  const state: State = { ...captured, commandJson, grantId, compiled, assertions, principalDigest: e.sessionDigest };
  authorities.set(authority, state);
  await requireSponsorAdmission(authority, trusted, command);
  return authority;
}

/** Must run before the immutable command digest and its early replay lookup. */
export async function requireSponsorAdmission(authority: SponsorAdmissionAuthority, trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const state = stateFor(authority, identity(trusted));
  const unchanged = () => {
  stateFor(authority, identity(trusted));
  if (state.sourceBindingJson !== sourceBinding(trusted) || state.scope !== canonicalJson(trusted.scope) || state.sourceDigest !== trusted.sourceDigest || state.requirementsDigest !== trusted.requirementsDigest
    || state.commandJson !== canonicalJson(command)) return fail("sponsor_authority_changed");
  };
  unchanged();
  const principal = await principalFor(trusted);
  if (await sponsorPrincipalDigest(principal) !== state.principalDigest) return fail("sponsor_principal_changed");
  const checks = await trusted.env.DB.batch<Record<string, unknown>>(state.assertions.map(proof => trusted.env.DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...(proof.bindings ?? []))));
  if (checks.length !== state.assertions.length || checks.some(result => result.success !== true || result.results.length !== 1 || result.results[0]?.current !== 1)) return fail("sponsor_authority_revoked");
  unchanged();
  return { payerUserId: state.compiled.policy.payerUserId, assertions: structuredClone(state.assertions), marker: {
    envelope_digest: state.compiled.envelopeDigest, policy_digest: state.compiled.policyDigest, consumption_id: state.compiled.envelope.consumptionId,
    campaign_id: state.compiled.policy.campaignId, payer_user_id: state.compiled.policy.payerUserId,
  } };
}

export async function sponsorAdmissionPlan(authority: SponsorAdmissionAuthority, trusted: OutputTrustedContext, native: SponsorNativeAdmission) {
  const state = stateFor(authority, identity(trusted));
  const plan = await prepareSponsorEntitlement({ policy: state.compiled.policy, envelope: state.compiled.envelope, grantId: state.grantId, native });
  if (state.compiled.policy.version === 1) return plan;
  const resource = await sponsorResourceAdmissionAssertion({ limits: state.compiled.policy.resources, campaignId: state.compiled.policy.campaignId,
    policyDigest: state.compiled.policyDigest, actorUserId: state.compiled.envelope.actorUserId });
  const approval = sponsorApprovalAssertion(state.compiled.policy, state.compiled.envelope.actorUserId);
  return { ...plan, nativeAssertion: { sql: `(${plan.nativeAssertion.sql}) AND (${resource.sql}) AND (${approval.sql})`,
    bindings: [...plan.nativeAssertion.bindings, ...resource.bindings, ...(approval.bindings ?? [])] } };
}
