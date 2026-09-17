import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorEnvelope, SponsorEntitlementError, type SponsorEnvelopeV2 } from "./experience-sponsor-policy.ts";
import { loadApprovedSponsorCampaign, readSponsorInternalCommand, sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { createSponsorAdmissionAuthority, describeSponsorImageAdmission, sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { matchSponsorImageTemplate } from "./experience-sponsor-campaign.ts";
import { readSponsorImageTemplateEvidence, sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { prepareSponsorResourcePlan } from "./experience-sponsor-resources.ts";
import { outputAssertionStatements, rememberOutputPrivateBody } from "./output-command-core.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
export type SponsorDriverCommand = { action: "run-sponsored-image"; campaignId: string; documentId: string; planRevisionId: string; targetId: string; intentKey: string };
export function readSponsorDriverCommand(raw: unknown): SponsorDriverCommand {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "campaignId", "documentId", "planRevisionId", "targetId", "intentKey"])
    || raw.action !== "run-sponsored-image" || ![raw.campaignId, raw.documentId, raw.planRevisionId, raw.targetId, raw.intentKey].every(id)
    || String(raw.intentKey).length > 80) return fail("sponsor_driver_command_invalid");
  return Object.freeze(JSON.parse(canonicalJson(raw)) as SponsorDriverCommand);
}
/** Identity does not change when a caller changes content under the same intent. */
export async function sponsorIssuerIntentKey(raw: unknown) {
  const body = readSponsorDriverCommand(raw);
  return `sponsor-authorize-${(await digest({ campaignId: body.campaignId, intentKey: body.intentKey })).slice(7)}`;
}
export const SPONSOR_ISSUER_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_issuances(grant_id TEXT PRIMARY KEY NOT NULL REFERENCES experience_sponsor_grants(grant_id),
    campaign_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,intent_key TEXT NOT NULL,policy_digest TEXT NOT NULL,
    driver_command_json TEXT NOT NULL,command_digest TEXT NOT NULL,envelope_digest TEXT NOT NULL,envelope_json TEXT NOT NULL,
    UNIQUE(campaign_id,actor_user_id,intent_key))`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_issuance_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_issuances BEGIN SELECT RAISE(ABORT,'sponsor_issuance_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_issuance_no_replace BEFORE INSERT ON experience_sponsor_issuances
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_issuances old WHERE old.grant_id=NEW.grant_id OR (old.campaign_id=NEW.campaign_id AND old.actor_user_id=NEW.actor_user_id AND old.intent_key=NEW.intent_key))
    BEGIN SELECT RAISE(ABORT,'sponsor_issuance_exists'); END`,
]);
declare const issuerAuthority: unique symbol;
export type SponsorIssuerAuthority = Readonly<{ [issuerAuthority]: true }>;
type State = { request: Request; env: OutputTrustedContext["env"]; database: OutputTrustedContext["env"]["DB"];
  actorUserId: string; documentId: string; scopeJson: string; sourceBinding: string; driverCommand: SponsorDriverCommand;
  approved: Awaited<ReturnType<typeof loadApprovedSponsorCampaign>> };
const issuers = new WeakMap<SponsorIssuerAuthority, State>();
const sourceBinding = (trusted: OutputTrustedContext) => canonicalJson({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
  snapshot: trusted.context?.snapshot ?? null, assertions: trusted.sourceAssertions });
function stateFor(authority: SponsorIssuerAuthority, trusted: OutputTrustedContext) {
  const state = issuers.get(authority);
  if (!state || state.request !== trusted.request || state.env !== trusted.env || state.database !== trusted.env.DB
    || state.actorUserId !== trusted.scope.actorUserId || state.documentId !== trusted.scope.documentId || state.scopeJson !== canonicalJson(trusted.scope)
    || state.sourceBinding !== sourceBinding(trusted)) return fail("sponsor_issuer_authority_changed");
  return state;
}

/** Only an eligible authenticated actor explicitly requesting this original
 * Image may receive an issuer seal, under the payer's recorded approval. There
 * is no public issuer route and no caller-selected financial owner. */
export async function createSponsorIssuerAuthority(trusted: OutputTrustedContext, campaignId: string): Promise<SponsorIssuerAuthority> {
  const captured = { request: trusted.request, env: trusted.env, database: trusted.env.DB, actorUserId: trusted.scope.actorUserId,
    documentId: trusted.scope.documentId, scopeJson: canonicalJson(trusted.scope), sourceBinding: sourceBinding(trusted) };
  const driverCommand = readSponsorDriverCommand(await readSponsorInternalCommand(captured.request));
  if (driverCommand.campaignId !== campaignId || driverCommand.documentId !== captured.documentId || trusted.scope.kind !== "personal"
    || trusted.scope.ownerUserId !== captured.actorUserId || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== captured.actorUserId) return fail("sponsor_issuer_scope_unsupported");
  const approved = await loadApprovedSponsorCampaign(captured.request, captured.env, campaignId);
  if (approved.actor.userId !== captured.actorUserId) return fail("sponsor_issuer_authority_changed");
  const authority = Object.freeze({}) as SponsorIssuerAuthority;
  issuers.set(authority, { ...captured, driverCommand, approved });
  stateFor(authority, trusted);
  return authority;
}

/** Pin the very same native plan, selected target and quote requested by the
 * actor. Exact private bytes are retained for the final issuance transaction. */
async function issuerNativeIntentProof(trusted: OutputTrustedContext, command: Record<string, unknown>, requested: SponsorDriverCommand) {
  const row = await trusted.env.DB.prepare(`SELECT preflight.plan_revision_id,preflight.event_id,preflight.terms_digest,quote.private_json AS quote_json,
      plan.confirmed_event_id,body.private_json AS plan_json
    FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
    JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
    JOIN event_private_payloads body ON body.private_event_id=plan.confirmed_event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
      AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?`)
    .bind(trusted.scope.key,String(command.preflightId),trusted.scope.actorUserId,trusted.scope.ownerUserId,trusted.scope.projectId,trusted.scope.documentId,
      trusted.sourceDigest,trusted.requirementsDigest).first<{plan_revision_id:string;event_id:string;terms_digest:string;quote_json:string;confirmed_event_id:string;plan_json:string}>();
  if (!row || row.plan_revision_id !== requested.planRevisionId || row.terms_digest !== command.termsDigest) return fail("sponsor_issuer_intent_mismatch");
  const quote = rememberOutputPrivateBody(trusted.scope,row.event_id,row.quote_json), planBody = rememberOutputPrivateBody(trusted.scope,row.confirmed_event_id,row.plan_json);
  const preflight = record(quote.preflight) ? quote.preflight : null, confirmed = record(planBody.confirmed_plan) ? planBody.confirmed_plan : null;
  const plan = confirmed && record(confirmed.plan) ? confirmed.plan : null;
  const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 && record(preflight.targets[0]) ? preflight.targets[0] : null;
  const selected = plan && Array.isArray(plan.targets) ? plan.targets.filter(target => record(target) && target.selected === true) : [];
  if (confirmed?.revisionId !== requested.planRevisionId || offered?.targetId !== requested.targetId || selected.length !== 1
    || !record(selected[0]) || selected[0].id !== requested.targetId || selected[0].media_kind !== "image") return fail("sponsor_issuer_intent_mismatch");
}

/** Idempotent server issuance. Resource debit, exact grant and immutable issuer
 * receipt commit together. Failed financial admission never rewrites this
 * original issuance and never refunds previously consumed resource work. */
export async function issueSponsorGrant(authority: SponsorIssuerAuthority, trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  if (jsonIssues(rawCommand).length) return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>, state = stateFor(authority, trusted);
  const { policy, policyDigest, assertions } = state.approved;
  const intentKey = await sponsorIssuerIntentKey(state.driverCommand), commandDigest = await digest(command), driverCommandJson = canonicalJson(state.driverCommand);
  if (command.action !== "authorize" || command.clientMutationId !== intentKey || command.documentId !== state.documentId) return fail("sponsor_issuer_intent_mismatch");
  await state.env.DB.batch(assertions.flatMap(proof => outputAssertionStatements(state.env, proof)));
  stateFor(authority, trusted);
  const existing = await state.env.DB.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
    .bind(policy.campaignId, state.actorUserId, intentKey).first<Record<string, string>>();
  const finish = async (row: Record<string, string>, replayed: boolean) => {
    if (row.policy_digest !== policyDigest || row.driver_command_json !== driverCommandJson || row.command_digest !== commandDigest) return fail("sponsor_issuer_intent_conflict");
    await issuerNativeIntentProof(trusted, command, state.driverCommand);
    const currentSource = sponsorCurrentSourceAssertions(trusted);
    const compiled = await compileSponsorEnvelope(policy, JSON.parse(row.envelope_json!));
    if (compiled.envelopeDigest !== row.envelope_digest) return fail("sponsor_issuer_original_unavailable");
    stateFor(authority, trusted);
    const admissionAuthority = await createSponsorAdmissionAuthority({ trusted, command, policy, envelope: compiled.envelope, grantId: row.grant_id! });
    await state.env.DB.batch([...assertions, ...currentSource].flatMap(proof => outputAssertionStatements(state.env, proof)));
    stateFor(authority, trusted);
    return { policy, envelope: compiled.envelope, grantId: row.grant_id!, admissionAuthority, replayed };
  };
  if (existing) return finish(existing, true);
  await issuerNativeIntentProof(trusted, command, state.driverCommand);
  const description = await describeSponsorImageAdmission(trusted, command), evidence = await readSponsorImageTemplateEvidence(trusted, command, description.recipe);
  const template = policy.templates.find(value => matchSponsorImageTemplate(value, evidence));
  if (!template || description.actorUserId !== state.actorUserId || description.sessionDigest !== await sponsorPrincipalDigest(state.approved.actor)) return fail("sponsor_campaign_template_mismatch");
  const clock = await state.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms").first<{ now_ms: number }>();
  if (!clock || !Number.isSafeInteger(clock.now_ms)) return fail("sponsor_database_clock_unavailable");
  const stable = (await digest({ campaignId: policy.campaignId, actorUserId: state.actorUserId, intentKey })).slice(7), grantId = `sponsor-issued-${stable}`;
  const { preflightExpiresAtMs, ...native } = description;
  const envelope: SponsorEnvelopeV2 = { version: 2, campaignId: policy.campaignId, policyVersion: policy.policyVersion, payerUserId: policy.payerUserId,
    consumptionId: `sponsor-consume-${stable}`, intentKey, ...native, templateDigest: await digest(template), issuedAtMs: clock.now_ms,
    expiresAtMs: Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, preflightExpiresAtMs, clock.now_ms + policy.maximumGrantLifetimeMs) };
  const compiled = await compileSponsorEnvelope(policy, envelope);
  const textBytes = new TextEncoder().encode(canonicalJson(trusted.context?.snapshot ?? {})).byteLength;
  const resource = await prepareSponsorResourcePlan({ limits: policy.resources, campaignId: policy.campaignId, policyDigest, actorUserId: state.actorUserId,
    sessionDigest: description.sessionDigest, intentKey, operation: "issuance", payloadDigest: compiled.envelopeDigest, textBytes, resourceId: `sponsor-resource-issue-${stable}`, issuedGrantId: grantId });
  const issuedProof = await sponsorIssuedAuthorityAssertion({ policy, policyDigest, grantId, actorUserId: state.actorUserId, sessionDigest: description.sessionDigest, intentKey, envelopeDigest: compiled.envelopeDigest });
  stateFor(authority, trusted);
  try {
    await state.env.DB.batch([
      ...[...assertions, ...sponsorCurrentSourceAssertions(trusted)].flatMap(proof => outputAssertionStatements(state.env, proof)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)")
        .bind(grantId,policy.campaignId,policyDigest,state.actorUserId,description.sessionDigest,intentKey,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
      ...resource.statements.map(statement => state.env.DB.prepare(statement.sql).bind(...statement.bindings)),
      state.env.DB.prepare("INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(grantId,policy.campaignId,state.actorUserId,intentKey,policyDigest,driverCommandJson,commandDigest,compiled.envelopeDigest,compiled.envelopeJson),
      ...outputAssertionStatements(state.env,issuedProof),
    ]);
  } catch (error) {
    // Recover only an exact committed original after a lost acknowledgment. No
    // regenerated timestamps, new grant or counter adjustment is attempted.
    const original = await state.env.DB.prepare("SELECT * FROM experience_sponsor_issuances WHERE campaign_id=? AND actor_user_id=? AND intent_key=?")
      .bind(policy.campaignId,state.actorUserId,intentKey).first<Record<string,string>>();
    if (!original) throw error;
    return finish(original,true);
  }
  return finish({grant_id:grantId,policy_digest:policyDigest,driver_command_json:driverCommandJson,command_digest:commandDigest,envelope_digest:compiled.envelopeDigest,envelope_json:compiled.envelopeJson},false);
}
