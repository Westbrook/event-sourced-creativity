import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export type SponsorResourceOperation = "text-intake" | "preflight" | "issuance" | "image-text-draft-storage";
export type SponsorResourceAllowance = {
  maximumOperations: number; maximumTextBytes: number;
  maximumOperationsPerWindow: number; maximumTextBytesPerWindow: number;
  maximumPendingGrants: number; maximumInflightJobs: number;
};
export type SponsorResourceLimitsV1 = {
  version: 1; startsAtMs: number; expiresAtMs: number; windowMs: number;
  maximumOperationTextBytes: number; campaign: SponsorResourceAllowance; actor: SponsorResourceAllowance;
};
export type SponsorResourceLimitsV2 = Omit<SponsorResourceLimitsV1, "version"> & {
  version: 2;
  allowedOperations: ["text-intake", "preflight", "issuance", "image-text-draft-storage"];
};
export type SponsorResourceLimits = SponsorResourceLimitsV1 | SponsorResourceLimitsV2;
export type SponsorResourceSql = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
export type SponsorResourceInput = {
  limits: unknown; campaignId: string; policyDigest: string; actorUserId: string; sessionDigest: string;
  intentKey: string; operation: SponsorResourceOperation; payloadDigest: string; textBytes: number; resourceId: string;
  issuedGrantId?: string;
};
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const statement = (sql: string, ...bindings: (string | number | null)[]): SponsorResourceSql => freeze({ sql, bindings });
const instant = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const allowanceKeys = ["maximumOperations", "maximumTextBytes", "maximumOperationsPerWindow", "maximumTextBytesPerWindow", "maximumPendingGrants", "maximumInflightJobs"];
const limitKeys = ["version", "startsAtMs", "expiresAtMs", "windowMs", "maximumOperationTextBytes", "campaign", "actor"];
const operations = ["text-intake", "preflight", "issuance", "image-text-draft-storage"] as const;
const reviewedOperations = (value: unknown): boolean => Array.isArray(value) && value.length === operations.length
  && operations.every((operation, index) => value[index] === operation);

/** Explicit server-approved limits only. No default allowance or caller clock.
 * V1 text-intake remains existing-Document text preparation. V2 separately
 * authorizes an initial Image text draft write; it adds no upload allowance. */
export function readSponsorResourceLimits(raw: unknown): Readonly<SponsorResourceLimits> {
  if (jsonIssues(raw).length || !record(raw) || (raw.version !== 1 && raw.version !== 2)
    || !exactKeys(raw, [...limitKeys, ...(raw.version === 2 ? ["allowedOperations"] : [])])
    || (raw.version === 2 && !reviewedOperations(raw.allowedOperations))
    || !integer(raw.startsAtMs, 0, 8_000_000_000_000) || !integer(raw.expiresAtMs, raw.startsAtMs + 1, 8_000_000_000_000)
    || !integer(raw.windowMs, 1, 31_536_000_000) || !integer(raw.maximumOperationTextBytes, 1, 1_048_576)) return fail("sponsor_resource_limits_invalid");
  for (const allowance of [raw.campaign, raw.actor]) {
    if (!record(allowance) || !exactKeys(allowance, allowanceKeys)
      || !allowanceKeys.every(key => integer(allowance[key], 1, key.includes("Bytes") ? 1_000_000_000_000 : 1_000_000))) return fail("sponsor_resource_limits_invalid");
    if (Number(allowance.maximumOperationsPerWindow) > Number(allowance.maximumOperations)
      || Number(allowance.maximumTextBytesPerWindow) > Number(allowance.maximumTextBytes)) return fail("sponsor_resource_limits_invalid");
  }
  const limits = raw as SponsorResourceLimits;
  if (allowanceKeys.some(key => limits.actor[key as keyof SponsorResourceAllowance] > limits.campaign[key as keyof SponsorResourceAllowance])
    || limits.maximumOperationTextBytes > limits.actor.maximumTextBytesPerWindow || limits.actor.maximumInflightJobs !== 1) return fail("sponsor_resource_limits_invalid");
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorResourceLimits);
}

/** Dormant schema: importing does not install or enable it. Counters record
 * bounded preparation/preflight/issuance and V2 initial-draft operations and
 * bytes, never money or invoices. Existing installed schemas require a separate
 * reviewed migration before enabling V2; this export performs no migration.
 * Campaign totals intentionally survive policy versions and terminal jobs. */
export const SPONSOR_RESOURCE_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_resource_policies(
    campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    limits_digest TEXT NOT NULL,limits_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)))`,
  `CREATE TABLE experience_sponsor_resource_receipts(
    resource_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    policy_digest TEXT NOT NULL,limits_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('text-intake','preflight','issuance','image-text-draft-storage')),intent_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL,text_bytes INTEGER NOT NULL CHECK(typeof(text_bytes)='integer' AND text_bytes>=0 AND text_bytes<=1048576),
    issued_grant_id TEXT REFERENCES experience_sponsor_grants(grant_id),recorded_at_ms INTEGER NOT NULL,
    CHECK((operation='issuance' AND issued_grant_id IS NOT NULL) OR (operation<>'issuance' AND issued_grant_id IS NULL)),
    UNIQUE(campaign_id,actor_user_id,operation,intent_key),UNIQUE(issued_grant_id))`,
  `CREATE INDEX experience_sponsor_resource_campaign_time ON experience_sponsor_resource_receipts(campaign_id,recorded_at_ms)`,
  `CREATE INDEX experience_sponsor_resource_actor_time ON experience_sponsor_resource_receipts(campaign_id,actor_user_id,recorded_at_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_resource_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_resource_receipts BEGIN SELECT RAISE(ABORT,'sponsor_resource_receipt_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_resource_no_replace BEFORE INSERT ON experience_sponsor_resource_receipts
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts old WHERE old.resource_id=NEW.resource_id
      OR (old.campaign_id=NEW.campaign_id AND old.actor_user_id=NEW.actor_user_id AND old.operation=NEW.operation AND old.intent_key=NEW.intent_key)
      OR (NEW.issued_grant_id IS NOT NULL AND old.issued_grant_id=NEW.issued_grant_id))
    BEGIN SELECT RAISE(ABORT,'sponsor_resource_receipt_exists'); END`,
]);

/** Required post-admission proof. The native transaction appends this after
 * inserting active_jobs, so separately issued pending grants cannot race beyond
 * approved concurrent campaign capacity. This is not a standalone executor. */
export async function sponsorResourceAdmissionAssertion(raw: {
  limits: unknown; campaignId: string; policyDigest: string; actorUserId: string;
}): Promise<SponsorResourceSql> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["limits", "campaignId", "policyDigest", "actorUserId"])
    || !id(raw.campaignId) || !id(raw.actorUserId) || !hash(raw.policyDigest)) return fail("sponsor_resource_input_invalid");
  const limits = readSponsorResourceLimits(raw.limits);
  const input = freeze(JSON.parse(canonicalJson(raw)) as { campaignId: string; policyDigest: string; actorUserId: string });
  const limitsJson = canonicalJson(limits), limitsDigest = await digest(limits);
  return statement(`EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign
    JOIN experience_sponsor_resource_policies resources ON resources.campaign_id=campaign.campaign_id
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=?
      AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=${instant} AND ?>${instant})
    AND (SELECT COUNT(*) FROM experience_sponsor_active_jobs active JOIN experience_sponsor_consumptions used ON used.consumption_id=active.consumption_id
      WHERE used.campaign_id=?)<=?
    AND (SELECT COUNT(*) FROM experience_sponsor_active_jobs active JOIN experience_sponsor_consumptions used ON used.consumption_id=active.consumption_id
      WHERE used.campaign_id=? AND active.actor_user_id=?)<=?`,
  input.campaignId, input.policyDigest, limitsDigest, limitsJson, limits.startsAtMs, limits.expiresAtMs,
  input.campaignId, limits.campaign.maximumInflightJobs, input.campaignId, input.actorUserId, limits.actor.maximumInflightJobs);
}

export type SponsorResourceReplay = {
  resource_id: string; campaign_id: string; actor_user_id: string; session_digest: string; operation: string;
  intent_key: string; payload_digest: string; text_bytes: number; issued_grant_id: string | null;
};
/** A replay locates original metadata only; the caller must recheck current
 * principal, approved policy and source authority before disclosure or use. */
export function resolveSponsorResourceReplay(row: SponsorResourceReplay | null, expected: Pick<SponsorResourceInput,
  "campaignId" | "actorUserId" | "sessionDigest" | "operation" | "intentKey" | "payloadDigest" | "textBytes">) {
  if (!row) return null;
  if (row.campaign_id !== expected.campaignId || row.actor_user_id !== expected.actorUserId || row.session_digest !== expected.sessionDigest)
    return fail("sponsor_resource_replay_authority_changed");
  if (row.operation !== expected.operation || row.intent_key !== expected.intentKey || row.payload_digest !== expected.payloadDigest || row.text_bytes !== expected.textBytes)
    return fail("sponsor_resource_intent_conflict");
  if (!id(row.resource_id) || expected.operation === "issuance" && !id(row.issued_grant_id) || expected.operation !== "issuance" && row.issued_grant_id !== null)
    return fail("sponsor_resource_original_unavailable");
  return freeze({ resourceId: row.resource_id, issuedGrantId: row.issued_grant_id });
}

/** Pure plan, no executor. Callers derive bytes/digests from actual bounded text
 * and provide server-approved limits. All statements, original authority checks
 * and final receipt assertion MUST share the caller's one DB.batch. Issuance
 * requires the exact grant to exist before this receipt is inserted; the final
 * proof establishes matching state, not a same-transaction creation witness. */
export async function prepareSponsorResourcePlan(raw: SponsorResourceInput) {
  if (jsonIssues(raw).length || !record(raw)
    || !exactKeys(raw, ["limits", "campaignId", "policyDigest", "actorUserId", "sessionDigest", "intentKey", "operation", "payloadDigest", "textBytes", "resourceId", ...(Object.hasOwn(raw, "issuedGrantId") ? ["issuedGrantId"] : [])])
    || ![raw.campaignId, raw.actorUserId, raw.intentKey, raw.resourceId].every(id)
    || ![raw.policyDigest, raw.sessionDigest, raw.payloadDigest].every(hash)
    || !operations.includes(raw.operation)
    || !integer(raw.textBytes, 0, 1_048_576)
    || (raw.operation === "issuance" ? !id(raw.issuedGrantId) : Object.hasOwn(raw, "issuedGrantId"))) return fail("sponsor_resource_input_invalid");
  const limits = readSponsorResourceLimits(raw.limits);
  if (raw.operation === "image-text-draft-storage" && limits.version !== 2) return fail("sponsor_resource_input_invalid");
  if (raw.textBytes > limits.maximumOperationTextBytes) return fail("sponsor_resource_text_too_large");
  // Capture every binding before the first asynchronous hash.
  const input = freeze(JSON.parse(canonicalJson(raw)) as SponsorResourceInput);
  const limitsJson = canonicalJson(limits), limitsDigest = await digest(limits);
  const { campaignId, actorUserId, sessionDigest, policyDigest, operation, intentKey, payloadDigest, textBytes, resourceId } = input;
  const grantId = input.issuedGrantId ?? null;
  const replayLookup = statement(`SELECT resource_id,campaign_id,actor_user_id,session_digest,operation,intent_key,payload_digest,text_bytes,issued_grant_id
    FROM experience_sponsor_resource_receipts WHERE campaign_id=? AND actor_user_id=? AND operation=? AND intent_key=?`,
  campaignId, actorUserId, operation, intentKey);
  const authority = statement(`EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign
    JOIN experience_sponsor_resource_policies resources ON resources.campaign_id=campaign.campaign_id
    WHERE campaign.campaign_id=? AND campaign.enabled=1 AND campaign.policy_digest=?
      AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?
      AND ?<=${instant} AND ?>${instant})`, campaignId, policyDigest, limitsDigest, limitsJson, limits.startsAtMs, limits.expiresAtMs);
  const check = (assertion: SponsorResourceSql) => [statement(`INSERT INTO experience_sponsor_assertions(token,passed)
    VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`, `resource:${resourceId}`, ...assertion.bindings),
  statement("DELETE FROM experience_sponsor_assertions WHERE token=?", `resource:${resourceId}`)];
  const grants = statement(`EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=?
    AND issued.campaign_id=? AND issued.policy_digest=? AND issued.actor_user_id=? AND issued.session_digest=?
    AND issued.intent_key=? AND issued.envelope_digest=? AND issued.enabled=1
    AND issued.issued_at_ms<=${instant} AND issued.expires_at_ms>${instant})`,
  grantId, campaignId, policyDigest, actorUserId, sessionDigest, intentKey, payloadDigest);
  const predicates: string[] = [], bindings: (string | number | null)[] = [];
  for (const [actorScoped, allowance] of [[false, limits.campaign], [true, limits.actor]] as const) {
    const actorPredicate = actorScoped ? " AND actor_user_id=?" : "";
    const scopeBindings = actorScoped ? [campaignId, actorUserId] : [campaignId];
    predicates.push(`(SELECT COUNT(*) FROM experience_sponsor_resource_receipts WHERE campaign_id=?${actorPredicate})<?`);
    bindings.push(...scopeBindings, allowance.maximumOperations);
    predicates.push(`(SELECT COALESCE(SUM(text_bytes),0) FROM experience_sponsor_resource_receipts WHERE campaign_id=?${actorPredicate})<=?-?`);
    bindings.push(...scopeBindings, allowance.maximumTextBytes, textBytes);
    predicates.push(`(SELECT COUNT(*) FROM experience_sponsor_resource_receipts WHERE campaign_id=?${actorPredicate} AND recorded_at_ms>instant.now_ms-?)<?`);
    bindings.push(...scopeBindings, limits.windowMs, allowance.maximumOperationsPerWindow);
    predicates.push(`(SELECT COALESCE(SUM(text_bytes),0) FROM experience_sponsor_resource_receipts WHERE campaign_id=?${actorPredicate} AND recorded_at_ms>instant.now_ms-?)<=?-?`);
    bindings.push(...scopeBindings, limits.windowMs, allowance.maximumTextBytesPerWindow, textBytes);
    // Issuance is checked after its exact grant insert, so the new pending grant
    // is already included. Expiry/revocation never removes historical usage.
    predicates.push(`(SELECT COUNT(*) FROM experience_sponsor_grants issued WHERE issued.campaign_id=?${actorScoped ? " AND issued.actor_user_id=?" : ""}
      AND issued.enabled=1 AND issued.expires_at_ms>instant.now_ms
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.grant_id=issued.grant_id))<=?`);
    bindings.push(...scopeBindings, allowance.maximumPendingGrants);
    predicates.push(`(SELECT COUNT(*) FROM experience_sponsor_active_jobs active JOIN experience_sponsor_consumptions used ON used.consumption_id=active.consumption_id
      WHERE used.campaign_id=?${actorScoped ? " AND active.actor_user_id=?" : ""})<=?`);
    bindings.push(...scopeBindings, allowance.maximumInflightJobs);
  }
  const receiptAssertion = statement(`EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts WHERE resource_id=?
    AND campaign_id=? AND policy_digest=? AND limits_digest=? AND actor_user_id=? AND session_digest=?
    AND operation=? AND intent_key=? AND payload_digest=? AND text_bytes=? AND issued_grant_id IS ?)${operation === "issuance" ? ` AND (${grants.sql})` : ""}`,
  resourceId, campaignId, policyDigest, limitsDigest, actorUserId, sessionDigest, operation, intentKey, payloadDigest, textBytes, grantId,
  ...(operation === "issuance" ? grants.bindings : []));
  const insertion = statement(`WITH instant(now_ms) AS (SELECT ${instant})
    INSERT INTO experience_sponsor_resource_receipts(resource_id,campaign_id,policy_digest,limits_digest,actor_user_id,session_digest,
      operation,intent_key,payload_digest,text_bytes,issued_grant_id,recorded_at_ms)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,instant.now_ms FROM instant
    WHERE (${authority.sql}) AND ${predicates.join(" AND ")}
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts WHERE campaign_id=? AND actor_user_id=? AND operation=? AND intent_key=?)`,
  resourceId, campaignId, policyDigest, limitsDigest, actorUserId, sessionDigest, operation, intentKey, payloadDigest, textBytes, grantId,
  ...authority.bindings, ...bindings, campaignId, actorUserId, operation, intentKey);
  const assertions = [authority, ...(operation === "issuance" ? [grants] : [])];
  const statements = [...assertions.flatMap(check), insertion, ...check(receiptAssertion)];
  return freeze({ kind: "dormant-resource-transaction-plan" as const, limits, limitsDigest, limitsJson, input,
    replayLookup, assertions, statements, receiptAssertion, ...(operation === "issuance" ? { issuedGrantAssertion: grants } : {}) });
}
