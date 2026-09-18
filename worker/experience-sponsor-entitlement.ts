import { compileSponsorEnvelope, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { canonicalJson, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";

type Sql = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
const statement = (sql: string, ...bindings: (string | number | null)[]): Sql => Object.freeze({ sql, bindings: Object.freeze(bindings) });
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };

/** Not registered with schema initialization or migrations. Installation and
 * issuance need a separately reviewed integration; importing this does nothing.
 * Campaign amounts are consumed entitlement ceilings, NEVER provider invoices,
 * balances, holds, refunds or the financial settlement ledger. */
export const SPONSOR_ENTITLEMENT_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_campaigns(
    campaign_id TEXT PRIMARY KEY NOT NULL,policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)))`,
  `CREATE TABLE experience_sponsor_grants(
    grant_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    policy_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,intent_key TEXT NOT NULL,
    envelope_digest TEXT NOT NULL,issued_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
    UNIQUE(campaign_id,actor_user_id,intent_key),CHECK(expires_at_ms>issued_at_ms))`,
  `CREATE TABLE experience_sponsor_consumptions(
    consumption_id TEXT PRIMARY KEY NOT NULL,grant_id TEXT NOT NULL UNIQUE REFERENCES experience_sponsor_grants(grant_id),
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),actor_user_id TEXT NOT NULL,
    session_digest TEXT NOT NULL,intent_key TEXT NOT NULL,envelope_digest TEXT NOT NULL,job_id TEXT NOT NULL UNIQUE,
    maximum_microusd INTEGER NOT NULL CHECK(typeof(maximum_microusd)='integer' AND maximum_microusd>0 AND maximum_microusd<=1000000000000),
    admitted_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id,actor_user_id,intent_key))`,
  `CREATE INDEX experience_sponsor_campaign_consumption ON experience_sponsor_consumptions(campaign_id,admitted_at_ms)`,
  `CREATE INDEX experience_sponsor_actor_consumption ON experience_sponsor_consumptions(campaign_id,actor_user_id,admitted_at_ms)`,
  `CREATE TABLE experience_sponsor_active_jobs(
    actor_user_id TEXT PRIMARY KEY NOT NULL,consumption_id TEXT NOT NULL UNIQUE REFERENCES experience_sponsor_consumptions(consumption_id),
    job_id TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE experience_sponsor_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_consumptions_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_consumptions BEGIN SELECT RAISE(ABORT,'sponsor_consumption_is_immutable'); END`),
  // REPLACE must not erase original consumption even with recursive triggers off.
  `CREATE TRIGGER experience_sponsor_consumptions_no_replace BEFORE INSERT ON experience_sponsor_consumptions
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_consumptions old WHERE old.consumption_id=NEW.consumption_id
      OR old.grant_id=NEW.grant_id OR old.job_id=NEW.job_id
      OR (old.campaign_id=NEW.campaign_id AND old.actor_user_id=NEW.actor_user_id AND old.intent_key=NEW.intent_key))
    BEGIN SELECT RAISE(ABORT,'sponsor_consumption_already_exists'); END`,
]);

export type SponsorNativeAdmission = {
  scopeKey: string; planRevisionId: string; slotId: string; executionGrantId: string;
  jobId: string; costReservationId: string; tokenReservationId: string; commandKey: string;
};
export type SponsorReplay = {
  consumption_id: string; actor_user_id: string; session_digest: string; envelope_digest: string; job_id: string;
};

/** A replay is only an internal locator. The caller must recheck current principal,
 * session and Document read authority before disclosure; this returns no content. */
export function resolveSponsorReplay(row: SponsorReplay | null, expected: {
  actorUserId: string; sessionDigest: string; envelopeDigest: string;
}) {
  if (!row) return null;
  if (row.actor_user_id !== expected.actorUserId || row.session_digest !== expected.sessionDigest) return fail("sponsor_replay_authority_changed");
  if (row.envelope_digest !== expected.envelopeDigest) return fail("sponsor_intent_conflict");
  if (!identifier(row.consumption_id) || !identifier(row.job_id)) return fail("sponsor_original_unavailable");
  return Object.freeze({ kind: "original" as const, consumptionId: row.consumption_id, jobId: row.job_id });
}

/** Pure SQL construction only. All returned statements MUST run in the SAME
 * DB.batch as existing native command/source authority, job/outbox and financial
 * reservations. No standalone executor is exported. A final CHECK rejects a
 * missing or mismatched native admission; it cannot prove whether matching rows
 * were written in this transaction. Atomic composition remains the integrating
 * caller's obligation. The current native route does not create the required sponsor
 * marker or distinct-payer authorization and cannot activate this candidate. */
export async function prepareSponsorEntitlement(input: {
  policy?: unknown; envelope: unknown; grantId: string; native: SponsorNativeAdmission;
}) {
  if (!record(input)) return fail("sponsor_admission_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== "string")
    || Object.keys(descriptors).some(key => !["policy", "envelope", "grantId", "native"].includes(key))
    || Object.values(descriptors).some(value => value.get || value.set || !value.enumerable)) return fail("sponsor_admission_invalid");
  const metadata = { grantId: descriptors.grantId?.value, native: descriptors.native?.value };
  if (jsonIssues(metadata).length || !identifier(metadata.grantId) || !record(metadata.native)
    || !exactKeys(metadata.native, ["scopeKey", "planRevisionId", "slotId", "executionGrantId", "jobId", "costReservationId", "tokenReservationId", "commandKey"])
    || !Object.values(metadata.native).every(identifier))
    return fail("sponsor_admission_invalid");
  const { grantId, native } = JSON.parse(canonicalJson(metadata)) as { grantId: string; native: SponsorNativeAdmission };
  const compiled = await compileSponsorEnvelope(descriptors.policy?.value, descriptors.envelope?.value);
  const { policy, envelope, policyDigest, envelopeDigest, policyJson } = compiled;
  const recipe = envelope.recipe;
  const calls = Object.values(recipe.calls).reduce((sum, count) => sum + count, 0);
  const replayLookup = statement(`SELECT consumption_id,actor_user_id,session_digest,envelope_digest,job_id
    FROM experience_sponsor_consumptions WHERE campaign_id=? AND actor_user_id=? AND intent_key=?`,
  policy.campaignId, envelope.actorUserId, envelope.intentKey);
  const token = `sponsor:${envelope.consumptionId}`;
  const check = (sql: string, bindings: readonly (string | number | null)[]) => [
    statement(`INSERT INTO experience_sponsor_assertions(token,passed) VALUES(?,CASE WHEN (${sql}) THEN 1 ELSE 0 END)`, token, ...bindings),
    statement("DELETE FROM experience_sponsor_assertions WHERE token=?", token),
  ];
  const nativeAssertion = Object.freeze({ sql: `EXISTS(SELECT 1 FROM output_operation_slots slot
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
    JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
    JOIN output_commands command ON command.scope_key=slot.scope_key AND command.actor_user_id=grant_row.actor_user_id AND command.command_key=?
    JOIN event_private_payloads body ON body.private_event_id=command.event_id
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.job_id=?
      AND slot.cost_reservation_id=? AND slot.token_reservation_id=? AND slot.status='authorized'
      AND slot.source_digest=? AND slot.provider=? AND slot.model=? AND slot.route_digest=?
      AND slot.maximum_microusd=? AND slot.maximum_tokens=? AND slot.maximum_calls=?
      AND grant_row.actor_user_id=? AND grant_row.payer_user_id=? AND grant_row.status='authorized'
      AND grant_row.context_id IS NULL AND grant_row.plan_revision_id=plan.plan_revision_id
      AND grant_row.maximum_microusd=slot.maximum_microusd AND grant_row.maximum_calls=slot.maximum_calls
      AND grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND plan.scope_kind='personal' AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=?
      AND plan.source_digest=slot.source_digest AND plan.source_head=?
      AND job.owner_id=plan.owner_user_id AND job.stream_id=? AND job.document_id=plan.document_id AND job.status='queued'
      AND tokens.owner_id=grant_row.payer_user_id AND tokens.status='active' AND tokens.reserved_tokens=slot.maximum_tokens
      AND cost.owner_id=grant_row.payer_user_id AND cost.status='active' AND cost.reserved_microusd=slot.maximum_microusd AND cost.allow_user_overage=0
      AND tokens.correlation_id=job.correlation_id AND cost.correlation_id=job.correlation_id
      AND tokens.stream_id=job.stream_id AND cost.stream_id=job.stream_id
      AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
      AND json_extract(body.private_json,'$.output_command_envelope.sponsor_entitlement.envelope_digest')=?
      AND json_extract(body.private_json,'$.output_command_envelope.sponsor_entitlement.policy_digest')=?
      AND json_extract(body.private_json,'$.output_command_envelope.sponsor_entitlement.consumption_id')=?)`, bindings: [native.commandKey, native.scopeKey, native.slotId, native.executionGrantId, native.planRevisionId, native.jobId,
    native.costReservationId, native.tokenReservationId, envelope.sourceDigest.slice(7), recipe.provider, recipe.model, recipe.routeDigest.slice(7),
    recipe.maximumMicrousd, recipe.maximumTokens, calls, envelope.actorUserId, envelope.payerUserId, envelope.ownerUserId,
    envelope.projectId, envelope.documentId, envelope.sourceRevision, `creative:${envelope.ownerUserId}`, envelopeDigest, policyDigest, envelope.consumptionId] });
  // Only the database clock can move a rolling-window cutoff. A caller clock,
  // even when combined with MAX(dbNow,...), could discard recent consumption.
  const statements: Sql[] = [statement(`WITH instant(now_ms) AS (
      SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
    INSERT INTO experience_sponsor_consumptions(consumption_id,grant_id,campaign_id,actor_user_id,session_digest,intent_key,envelope_digest,job_id,maximum_microusd,admitted_at_ms)
    SELECT ?,grant_row.grant_id,campaign.campaign_id,grant_row.actor_user_id,grant_row.session_digest,grant_row.intent_key,grant_row.envelope_digest,?,?,instant.now_ms
    FROM instant JOIN experience_sponsor_campaigns campaign JOIN experience_sponsor_grants grant_row ON grant_row.campaign_id=campaign.campaign_id
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=? AND campaign.policy_json=?
      AND grant_row.grant_id=? AND grant_row.enabled=1 AND grant_row.policy_digest=campaign.policy_digest
      AND grant_row.actor_user_id=? AND grant_row.session_digest=? AND grant_row.intent_key=? AND grant_row.envelope_digest=?
      AND grant_row.issued_at_ms=? AND grant_row.expires_at_ms=? AND grant_row.issued_at_ms<=instant.now_ms AND grant_row.expires_at_ms>instant.now_ms
      AND ?<=instant.now_ms AND ?>instant.now_ms
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id)<?
      AND (SELECT COALESCE(SUM(used.maximum_microusd),0) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id)<=?-?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.actor_user_id=grant_row.actor_user_id)<?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.admitted_at_ms>instant.now_ms-?)<?
      AND (SELECT COUNT(*) FROM experience_sponsor_consumptions used WHERE used.campaign_id=campaign.campaign_id AND used.actor_user_id=grant_row.actor_user_id AND used.admitted_at_ms>instant.now_ms-?)<?`,
  envelope.consumptionId, native.jobId, recipe.maximumMicrousd,
  policy.campaignId, policyDigest, policyJson, grantId, envelope.actorUserId, envelope.sessionDigest, envelope.intentKey, envelopeDigest,
  envelope.issuedAtMs, envelope.expiresAtMs, policy.startsAtMs, policy.expiresAtMs,
  policy.maximumAdmissions, policy.maximumMicrousd, recipe.maximumMicrousd, policy.maximumAdmissionsPerActor,
  policy.windowMs, policy.maximumAdmissionsPerWindow, policy.windowMs, policy.maximumAdmissionsPerActorWindow),
  ...check("changes()=1", []),
  // Principal-wide across campaigns/output types. No automatic release is
  // supplied: uncertain/failed/cancelled work must not free this slot by accident.
  statement("INSERT INTO experience_sponsor_active_jobs(actor_user_id,consumption_id,job_id) VALUES(?,?,?)", envelope.actorUserId, envelope.consumptionId, native.jobId),
  ...check(nativeAssertion.sql, nativeAssertion.bindings),
  ];
  return Object.freeze({ kind: "dormant-transaction-plan" as const, ...compiled, replayLookup, statements: Object.freeze(statements),
    admissionStatements: Object.freeze(statements.slice(0, -2)), nativeAssertion });
}
