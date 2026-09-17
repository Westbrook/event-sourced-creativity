import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { readSponsorPolicy, SponsorEntitlementError, type SponsorPolicyV2 } from "./experience-sponsor-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const columns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const databaseNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

/** Dormant tables only. No schema initializer, route, configuration switch or
 * automatic enrollment installs or invokes this approval path. */
export const SPONSOR_APPROVAL_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_approvals(approval_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT UNIQUE NOT NULL,
    payer_user_id TEXT NOT NULL,terms_digest TEXT NOT NULL,terms_json TEXT NOT NULL,policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    approved_by_user_id TEXT NOT NULL,payer_authority_json TEXT NOT NULL,approval_command_json TEXT NOT NULL,approved_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER,
    CHECK(approved_by_user_id=payer_user_id),CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=approved_at_ms))`,
  `CREATE TRIGGER experience_sponsor_approval_immutable BEFORE UPDATE ON experience_sponsor_approvals
    WHEN NEW.approval_id IS NOT OLD.approval_id OR NEW.campaign_id IS NOT OLD.campaign_id OR NEW.payer_user_id IS NOT OLD.payer_user_id
      OR NEW.terms_digest IS NOT OLD.terms_digest OR NEW.terms_json IS NOT OLD.terms_json OR NEW.policy_digest IS NOT OLD.policy_digest
      OR NEW.policy_json IS NOT OLD.policy_json OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id
      OR NEW.payer_authority_json IS NOT OLD.payer_authority_json OR NEW.approval_command_json IS NOT OLD.approval_command_json OR NEW.approved_at_ms IS NOT OLD.approved_at_ms
      OR OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NOT OLD.revoked_at_ms
    BEGIN SELECT RAISE(ABORT,'sponsor_approval_is_immutable'); END`,
  `CREATE TRIGGER experience_sponsor_approval_no_delete BEFORE DELETE ON experience_sponsor_approvals BEGIN SELECT RAISE(ABORT,'sponsor_approval_is_immutable'); END`,
  `CREATE TRIGGER experience_sponsor_approval_no_replace BEFORE INSERT ON experience_sponsor_approvals
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_approvals old WHERE old.approval_id=NEW.approval_id OR old.campaign_id=NEW.campaign_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_approval_already_exists'); END`,
]);
export type SponsorApprovalProposal = {
  policy: Omit<SponsorPolicyV2, "approvalReceiptDigest">;
  eligibleActorUserIds: string[];
  issuerUserIds: string[];
};

/** Approval metadata is not authority. The digest covers all reviewed terms
 * except its own reference, avoiding a circular hash. The authenticated record
 * below additionally retains the full final policy JSON and its exact digest. */
export async function compileSponsorApprovalProposal(raw: unknown) {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["policy", "eligibleActorUserIds", "issuerUserIds"])
    || !record(raw.policy) || Object.hasOwn(raw.policy, "approvalReceiptDigest") || raw.policy.version !== 2
    || ![raw.eligibleActorUserIds, raw.issuerUserIds].every(value => Array.isArray(value) && value.length > 0 && value.length <= 100
      && value.every(id) && new Set(value).size === value.length)) return fail("sponsor_approval_terms_invalid");
  const copied = JSON.parse(canonicalJson(raw)) as SponsorApprovalProposal;
  const validated = readSponsorPolicy({ ...copied.policy, approvalReceiptDigest: `sha256:${"0".repeat(64)}` });
  if (validated.mode !== "candidate" || validated.version !== 2 || copied.eligibleActorUserIds.includes(validated.payerUserId)
    || copied.issuerUserIds.some(actor => !copied.eligibleActorUserIds.includes(actor))) return fail("sponsor_approval_terms_invalid");
  const termsJson = canonicalJson(copied), termsDigest = await digest(copied);
  const policy = readSponsorPolicy({ ...copied.policy, approvalReceiptDigest: termsDigest }) as SponsorPolicyV2;
  return { policy, policyJson: canonicalJson(policy), policyDigest: await digest(policy), termsJson, termsDigest };
}
async function principal(request: Request, env: WorkerEnv) {
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_canonical_principal_required");
  return auth.user;
}
async function authoritySnapshot(env: WorkerEnv, userId: string) {
  const row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(userId).first<Record<string, unknown>>();
  if (!row || !["creator", "admin"].includes(String(row.role)) || row.consent_version !== POLICY_VERSION) return fail("sponsor_approval_principal_changed");
  const json = JSON.stringify(columns.map(column => row[column] ?? null));
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${columns.map(column => `captured.${column}`).join(",")})=?)`, bindings: [userId, json] };
  return { json, assertion };
}

/** Explicit payer-authenticated review action, not an admin-role shortcut. A
 * caller cannot approve another payer or substitute a raw approval digest. No
 * registered HTTP path calls this function. Tests invoke it on disposable SQLite. */
export async function readSponsorInternalCommand(request: Request, maximumBytes = 131072): Promise<unknown> {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";",1)[0] !== "application/json") return fail("sponsor_explicit_command_required");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 131072) return fail("sponsor_command_invalid");
  const reader = request.clone().body?.getReader();
  if (!reader) return fail("sponsor_command_invalid");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const result = await reader.read(); if (result.done) break;
    length += result.value.byteLength;
    if (length > maximumBytes) { void reader.cancel().catch(() => {}); return fail("sponsor_command_too_large"); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); } catch { return fail("sponsor_command_invalid"); }
}
export async function approveSponsorCampaign(request: Request, env: WorkerEnv) {
  const raw = await readSponsorInternalCommand(request);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "approvalId", "proposal", "confirmation", "reviewedTermsDigest"])
    || raw.action !== "approve-sponsor-campaign" || !id(raw.approvalId) || raw.confirmation !== "APPROVE_SPONSOR_CAMPAIGN") return fail("sponsor_explicit_approval_required");
  const input = JSON.parse(canonicalJson(raw)) as typeof raw;
  const compiled = await compileSponsorApprovalProposal(input.proposal), payer = await principal(request, env);
  if (payer.userId !== compiled.policy.payerUserId || input.reviewedTermsDigest !== compiled.termsDigest) return fail("sponsor_payer_approval_required");
  const payerAuthority = await authoritySnapshot(env, payer.userId);
  const existing = await env.DB.prepare("SELECT * FROM experience_sponsor_approvals WHERE campaign_id=? OR approval_id=?")
    .bind(compiled.policy.campaignId, input.approvalId as string).first<Record<string, unknown>>();
  const currentProof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_approvals approval JOIN experience_sponsor_campaigns campaign ON campaign.campaign_id=approval.campaign_id
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.payer_user_id=? AND approval.terms_digest=? AND approval.terms_json=?
      AND approval.policy_digest=? AND approval.policy_json=? AND approval.approved_by_user_id=? AND approval.payer_authority_json=? AND approval.revoked_at_ms IS NULL
      AND campaign.enabled=1 AND campaign.policy_digest=approval.policy_digest AND campaign.policy_json=approval.policy_json)`,
    bindings: [input.approvalId as string, compiled.policy.campaignId, payer.userId, compiled.termsDigest, compiled.termsJson, compiled.policyDigest, compiled.policyJson, payer.userId, payerAuthority.json] };
  if (existing) {
    if (existing.approval_id !== input.approvalId || existing.campaign_id !== compiled.policy.campaignId || existing.terms_json !== compiled.termsJson
      || existing.policy_json !== compiled.policyJson || existing.revoked_at_ms !== null) return fail("sponsor_approval_conflict");
    await env.DB.batch([payerAuthority.assertion, currentProof].flatMap(proof => outputAssertionStatements(env, proof)));
    return { replayed: true, approvalId: String(input.approvalId), ...compiled };
  }
  const resourceDigest = await digest(compiled.policy.resources), resourceJson = canonicalJson(compiled.policy.resources);
  await env.DB.batch([
    ...outputAssertionStatements(env, payerAuthority.assertion),
    ...outputAssertionStatements(env, { sql: `${databaseNow}>=? AND ${databaseNow}<?`, bindings: [compiled.policy.startsAtMs, compiled.policy.expiresAtMs] }),
    env.DB.prepare("INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,1)")
      .bind(compiled.policy.campaignId, compiled.policyDigest, compiled.policyJson),
    env.DB.prepare("INSERT INTO experience_sponsor_resource_policies(campaign_id,limits_digest,limits_json,enabled) VALUES(?,?,?,1)")
      .bind(compiled.policy.campaignId, resourceDigest, resourceJson),
    env.DB.prepare(`INSERT INTO experience_sponsor_approvals(approval_id,campaign_id,payer_user_id,terms_digest,terms_json,policy_digest,policy_json,approved_by_user_id,payer_authority_json,approval_command_json,approved_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,${databaseNow})`).bind(input.approvalId as string, compiled.policy.campaignId, payer.userId, compiled.termsDigest, compiled.termsJson, compiled.policyDigest, compiled.policyJson, payer.userId, payerAuthority.json, canonicalJson(input)),
    ...outputAssertionStatements(env, currentProof),
  ]);
  return { replayed: false, approvalId: String(input.approvalId), ...compiled };
}

/** Live v2 approval predicate for issuance, native admission and every paid stage.
 * Original incurred monetary settlement deliberately never uses this predicate. */
export function sponsorApprovalAssertion(policy: SponsorPolicyV2, actorUserId: string, requireIssuer = false): OutputSqlAssertion {
  // Keep the complete approval and principal proofs as sibling materialized
  // relations. Nesting the principal query inside the approval WHERE exceeds
  // D1's expression depth when this predicate is an atomic-write witness.
  // Both relations and their exact snapshot join still execute in that write;
  // their order preserves every original parameter's position and SQLite type.
  return { sql: `EXISTS(WITH sponsor_approval_terms AS MATERIALIZED (
    SELECT approval.payer_authority_json FROM experience_sponsor_approvals approval JOIN users payer ON payer.user_id=approval.payer_user_id
    WHERE approval.campaign_id=? AND approval.payer_user_id=? AND approval.approved_by_user_id=approval.payer_user_id
      AND approval.terms_digest=? AND approval.policy_json=? AND approval.revoked_at_ms IS NULL
      AND json_extract(approval.approval_command_json,'$.action')='approve-sponsor-campaign' AND json_extract(approval.approval_command_json,'$.confirmation')='APPROVE_SPONSOR_CAMPAIGN'
      AND json_extract(approval.approval_command_json,'$.reviewedTermsDigest')=approval.terms_digest
      AND EXISTS(SELECT 1 FROM json_each(approval.terms_json,'$.eligibleActorUserIds') eligible WHERE eligible.value=?)
      ${requireIssuer ? "AND EXISTS(SELECT 1 FROM json_each(approval.terms_json,'$.issuerUserIds') issuer WHERE issuer.value=?)" : ""}
      AND payer.role IN('creator','admin') AND payer.consent_version=?),
    sponsor_payer_principal AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL})
    SELECT 1 FROM sponsor_approval_terms approval JOIN sponsor_payer_principal captured
      ON json_array(${columns.map(column => `captured.${column}`).join(",")})=approval.payer_authority_json)`,
    bindings: [policy.campaignId, policy.payerUserId, policy.approvalReceiptDigest, canonicalJson(policy), actorUserId, ...(requireIssuer ? [actorUserId] : []), POLICY_VERSION, policy.payerUserId], deadlineMs: policy.expiresAtMs };
}

export async function loadApprovedSponsorCampaign(request: Request, env: WorkerEnv, campaignId: string) {
  if (!id(campaignId)) return fail("sponsor_campaign_invalid");
  const actor = await principal(request, env);
  const row = await env.DB.prepare("SELECT policy_json,policy_digest FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1").bind(campaignId).first<{ policy_json: string; policy_digest: string }>();
  if (!row) return fail("sponsor_approved_campaign_unavailable");
  const policy = readSponsorPolicy(JSON.parse(row.policy_json));
  if (policy.mode !== "candidate" || policy.version !== 2 || policy.campaignId !== campaignId || await digest(policy) !== row.policy_digest) return fail("sponsor_approved_campaign_unavailable");
  const actorAuthority = await authoritySnapshot(env, actor.userId);
  const assertions = [actorAuthority.assertion, sponsorApprovalAssertion(policy, actor.userId, true),
    { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE participant.user_id IN(?,?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
      bindings: [actor.userId, policy.payerUserId] },
    { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 AND policy_digest=? AND policy_json=?) AND ${databaseNow}>=? AND ${databaseNow}<?`,
      bindings: [campaignId, row.policy_digest, row.policy_json, policy.startsAtMs, policy.expiresAtMs], deadlineMs: policy.expiresAtMs }];
  await env.DB.batch(assertions.flatMap(proof => outputAssertionStatements(env, proof)));
  return { actor, policy, policyDigest: row.policy_digest, assertions };
}

/** Monotonic payer kill switch. No approval renewal, budget reset or refund is
 * implied; existing known incurred costs retain their source-free authority. */
export async function revokeSponsorCampaign(request: Request, env: WorkerEnv) {
  const raw = await readSponsorInternalCommand(request);
  if (!record(raw) || !exactKeys(raw, ["action", "campaignId", "confirmation"]) || raw.action !== "revoke-sponsor-campaign" || raw.confirmation !== "REVOKE_SPONSOR_CAMPAIGN" || !id(raw.campaignId)) return fail("sponsor_explicit_command_required");
  const campaignId = raw.campaignId;
  const payer = await principal(request, env), authority = await authoritySnapshot(env, payer.userId);
  const proof: OutputSqlAssertion = { sql: "EXISTS(SELECT 1 FROM experience_sponsor_approvals WHERE campaign_id=? AND payer_user_id=? AND approved_by_user_id=?)", bindings: [campaignId, payer.userId, payer.userId] };
  await env.DB.batch([...[authority.assertion, proof].flatMap(value => outputAssertionStatements(env, value)),
    env.DB.prepare(`UPDATE experience_sponsor_approvals SET revoked_at_ms=COALESCE(revoked_at_ms,${databaseNow}) WHERE campaign_id=?`).bind(campaignId),
    env.DB.prepare("UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?").bind(campaignId),
    env.DB.prepare("UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?").bind(campaignId),
    env.DB.prepare("UPDATE experience_sponsor_grants SET enabled=0 WHERE campaign_id=?").bind(campaignId),
  ]);
  return { revoked: true as const };
}

/** Exact server issuance evidence. A v2 grant row alone is insufficient: it
 * must have the immutable issuer record and atomic resource receipt for this
 * same actor/session/intent/envelope and approved policy. */
export async function sponsorIssuedAuthorityAssertion(input: {
  policy: SponsorPolicyV2; policyDigest: string; grantId: string; actorUserId: string;
  sessionDigest: string; intentKey: string; envelopeDigest: string;
}): Promise<OutputSqlAssertion> {
  const { policy, policyDigest, grantId, actorUserId, sessionDigest, intentKey, envelopeDigest } = input;
  const limitsDigest = await digest(policy.resources);
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_issuances issuance
    JOIN experience_sponsor_resource_receipts resource ON resource.issued_grant_id=issuance.grant_id
    WHERE issuance.grant_id=? AND issuance.campaign_id=? AND issuance.actor_user_id=? AND issuance.intent_key=?
      AND issuance.policy_digest=? AND issuance.envelope_digest=?
      AND json_extract(issuance.envelope_json,'$.sessionDigest')=? AND json_extract(issuance.envelope_json,'$.actorUserId')=issuance.actor_user_id
      AND resource.campaign_id=issuance.campaign_id AND resource.actor_user_id=issuance.actor_user_id AND resource.intent_key=issuance.intent_key
      AND resource.operation='issuance' AND resource.session_digest=? AND resource.policy_digest=? AND resource.limits_digest=? AND resource.payload_digest=issuance.envelope_digest)`,
    bindings: [grantId, policy.campaignId, actorUserId, intentKey, policyDigest, envelopeDigest, sessionDigest, sessionDigest, policyDigest, limitsDigest] };
}
