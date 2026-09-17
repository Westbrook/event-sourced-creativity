import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorApprovalProposal, readSponsorInternalCommand, sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorIntakeReadPolicy, type SponsorIntakeReadPolicyV1 } from "./experience-sponsor-intake-read-policy.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const boundedJson = (column: string, maximumBytes: number) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximumBytes} AND instr(${column},char(0))=0 THEN ${column} END`;
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export type SponsorIntakeReadApprovalProposal = {
  version: 1; campaignId: string; sponsorPolicyDigest: string; readPolicy: SponsorIntakeReadPolicyV1;
};
type OriginalApproval = { approval_id: string; campaign_id: string; payer_user_id: string; terms_json: string; terms_digest: string;
  policy_json: string; policy_digest: string; payer_authority_json: string; approval_command_json: string };

/** Dormant pre-job provenance only: no initializer, registered route or launch
 * policy. This separately approved allocation leaves generated-result reads and
 * V2 storage terms unchanged. Both new rows are installed together by the actual
 * payer's transaction below; neither digest alone is authority. */
export const SPONSOR_INTAKE_READ_APPROVAL_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_intake_read_approvals(
    approval_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    original_approval_id TEXT NOT NULL REFERENCES experience_sponsor_approvals(approval_id),payer_user_id TEXT NOT NULL,
    read_policy_digest TEXT NOT NULL,terms_json TEXT NOT NULL,terms_digest TEXT NOT NULL,
    review_receipt_json TEXT NOT NULL,review_receipt_digest TEXT UNIQUE NOT NULL,
    approval_command_json TEXT NOT NULL,approved_by_user_id TEXT NOT NULL,approved_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id,sponsor_policy_digest),CHECK(approved_by_user_id=payer_user_id),
    CHECK(typeof(approved_at_ms)='integer' AND approved_at_ms>=0),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_intake_read_policies(campaign_id,sponsor_policy_digest)
      DEFERRABLE INITIALLY DEFERRED) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_intake_read_approvals_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_intake_read_approvals BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_approval_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_intake_read_approvals_no_replace BEFORE INSERT ON experience_sponsor_intake_read_approvals
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_intake_read_approvals old WHERE old.approval_id=NEW.approval_id
      OR (old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
      OR old.review_receipt_digest=NEW.review_receipt_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_approval_exists'); END`,
]);

function proposal(raw: unknown): Readonly<SponsorIntakeReadApprovalProposal> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "campaignId", "sponsorPolicyDigest", "readPolicy"])
    || raw.version !== 1 || !id(raw.campaignId) || !hash(raw.sponsorPolicyDigest)) return fail("sponsor_intake_read_approval_terms_invalid");
  return freeze({ version: 1, campaignId: raw.campaignId, sponsorPolicyDigest: raw.sponsorPolicyDigest,
    readPolicy: readSponsorIntakeReadPolicy(raw.readPolicy) });
}

/** Reuse native authentication and the original approved campaign predicate.
 * The known original issuer is only a witness to that recorded approval, never
 * an impersonated principal or a delegated payer. The actual caller must be the
 * original payer. Its original captured canonical authority must still match. */
async function review(request: Request, env: WorkerEnv, raw: unknown) {
  const input = proposal(raw);
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_canonical_principal_required");
  const original = await env.DB.prepare(`SELECT approval.approval_id,approval.campaign_id,approval.payer_user_id,
    ${boundedJson("approval.terms_json", 131072)} AS terms_json,
    approval.terms_digest,approval.policy_digest,${boundedJson("approval.policy_json", 262144)} AS policy_json,
    ${boundedJson("approval.payer_authority_json", 131072)} AS payer_authority_json,
    ${boundedJson("approval.approval_command_json", 131072)} AS approval_command_json
    FROM experience_sponsor_approvals approval WHERE approval.campaign_id=? AND approval.policy_digest=?`)
    .bind(input.campaignId, input.sponsorPolicyDigest).first<OriginalApproval>();
  if (!original || original.payer_user_id !== auth.user.userId) return fail("sponsor_intake_read_payer_approval_required");
  if (![original.terms_json, original.policy_json, original.payer_authority_json, original.approval_command_json].every(value => typeof value === "string")
    || !id(original.approval_id) || !hash(original.terms_digest)) return fail("sponsor_intake_read_original_approval_unavailable");
  let originalTerms: unknown; try { originalTerms = JSON.parse(original.terms_json); } catch { return fail("sponsor_intake_read_original_approval_unavailable"); }
  const compiled = await compileSponsorApprovalProposal(originalTerms);
  if (!record(originalTerms) || !Array.isArray(originalTerms.issuerUserIds) || !id(originalTerms.issuerUserIds[0])
    || compiled.policy.campaignId !== input.campaignId || compiled.policy.payerUserId !== auth.user.userId
    || compiled.policyDigest !== input.sponsorPolicyDigest || original.policy_json !== compiled.policyJson
    || original.terms_json !== compiled.termsJson || original.terms_digest !== compiled.termsDigest
    || original.approval_command_json !== canonicalJson({ action: "approve-sponsor-campaign", approvalId: original.approval_id,
      proposal: originalTerms, confirmation: "APPROVE_SPONSOR_CAMPAIGN", reviewedTermsDigest: compiled.termsDigest })) return fail("sponsor_intake_read_original_approval_unavailable");
  const assertions: OutputSqlAssertion[] = [
    sponsorApprovalAssertion(compiled.policy, originalTerms.issuerUserIds[0], true),
    { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns campaign JOIN experience_sponsor_approvals approval
        ON approval.campaign_id=campaign.campaign_id WHERE campaign.campaign_id=? AND campaign.enabled=1
        AND campaign.policy_digest=? AND campaign.policy_json=? AND approval.approval_id=? AND approval.terms_json=?
        AND approval.terms_digest=? AND approval.policy_digest=? AND approval.payer_authority_json=? AND approval.approval_command_json=?)
        AND ${clock}>=? AND ${clock}<?`,
      bindings: [input.campaignId, compiled.policyDigest, compiled.policyJson, original.approval_id, compiled.termsJson,
        compiled.termsDigest, compiled.policyDigest, original.payer_authority_json, original.approval_command_json,
        compiled.policy.startsAtMs, compiled.policy.expiresAtMs] },
    { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE (participant.user_id=? OR participant.email_normalized=?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
      bindings: [auth.user.userId, auth.user.email] },
    { sql: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=?)", bindings: [auth.user.userId, auth.user.email] },
  ];
  const terms = freeze({ purpose: "sponsor-image-intake-read-policy" as const, proposal: input, payerUserId: auth.user.userId,
    originalApprovalId: original.approval_id, originalTermsDigest: compiled.termsDigest });
  const termsJson = canonicalJson(terms), termsDigest = await digest(terms), readPolicyDigest = await digest(input.readPolicy);
  return { input, original, assertions, terms, termsJson, termsDigest, readPolicyDigest, policyJson: canonicalJson(input.readPolicy) };
}

/** Payer-authenticated preparation retains no policy, approval or business state.
 * Native assertion rows are checked and removed in one transaction. The returned
 * digest describes a review, never a capability or substitute for commit proof. */
export async function prepareSponsorIntakeReadApproval(request: Request, env: WorkerEnv) {
  const raw = await readSponsorInternalCommand(request);
  if (!record(raw) || !exactKeys(raw, ["action", "proposal"]) || raw.action !== "prepare-sponsor-intake-read-policy") return fail("sponsor_explicit_command_required");
  const checked = await review(request, env, raw.proposal);
  await env.DB.batch(checked.assertions.flatMap(assertion => outputAssertionStatements(env, assertion)));
  return freeze({ terms: checked.terms, termsDigest: checked.termsDigest, readPolicyDigest: checked.readPolicyDigest });
}

/** Exact explicit payer review, immutable one-time policy, source-free replay.
 * Active campaign authority is required to provision/replay this command; it
 * never becomes a requirement for consuming already provisioned original-draft/receipt read terms.
 * No grant, provider call, financial hold or read-attempt credit is created. */
export async function approveSponsorIntakeReadPolicy(request: Request, env: WorkerEnv) {
  const raw = await readSponsorInternalCommand(request);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || raw.action !== "approve-sponsor-intake-read-policy" || !id(raw.approvalId) || !hash(raw.reviewedTermsDigest)
    || raw.confirmation !== "APPROVE_SPONSOR_INTAKE_READ_POLICY") return fail("sponsor_explicit_approval_required");
  const input = JSON.parse(canonicalJson(raw)) as typeof raw;
  const checked = await review(request, env, input.proposal);
  if (input.reviewedTermsDigest !== checked.termsDigest) return fail("sponsor_intake_read_terms_not_reviewed");
  const approvalId = String(input.approvalId), approvalCommandJson = canonicalJson(input);
  const receipt = freeze({ version: 1, purpose: "sponsor-image-intake-read-policy-approval", approvalId,
    termsDigest: checked.termsDigest, readPolicyDigest: checked.readPolicyDigest, approvedByUserId: checked.terms.payerUserId,
    payerAuthorityJson: checked.original.payer_authority_json, approvalCommandDigest: await digest(input) });
  const receiptJson = canonicalJson(receipt), receiptDigest = await digest(receipt);
  const proof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_intake_read_approvals approval
    JOIN experience_sponsor_intake_read_policies policy ON policy.campaign_id=approval.campaign_id AND policy.sponsor_policy_digest=approval.sponsor_policy_digest
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.sponsor_policy_digest=? AND approval.original_approval_id=?
      AND approval.payer_user_id=? AND approval.approved_by_user_id=? AND approval.read_policy_digest=? AND approval.terms_json=? AND approval.terms_digest=?
      AND approval.review_receipt_json=? AND approval.review_receipt_digest=? AND approval.approval_command_json=?
      AND policy.read_policy_digest=approval.read_policy_digest AND policy.policy_json=? AND policy.review_receipt_digest=approval.review_receipt_digest)`,
    bindings: [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
      checked.terms.payerUserId, checked.terms.payerUserId, checked.readPolicyDigest, checked.termsJson, checked.termsDigest,
      receiptJson, receiptDigest, approvalCommandJson, checked.policyJson] };
  const finish = async (replayed: boolean) => {
    await env.DB.batch([...checked.assertions, proof].flatMap(assertion => outputAssertionStatements(env, assertion)));
    return freeze({ replayed, approvalId, campaignId: checked.input.campaignId, sponsorPolicyDigest: checked.input.sponsorPolicyDigest,
      readPolicyDigest: checked.readPolicyDigest, reviewReceiptDigest: receiptDigest, termsDigest: checked.termsDigest });
  };
  const exists = async () => env.DB.prepare(`SELECT 1 AS present FROM experience_sponsor_intake_read_approvals
    WHERE approval_id=? OR (campaign_id=? AND sponsor_policy_digest=?)`).bind(approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest).first();
  if (await exists()) return finish(true);
  try {
    await env.DB.batch([
      ...checked.assertions.flatMap(assertion => outputAssertionStatements(env, assertion)),
      env.DB.prepare(`INSERT INTO experience_sponsor_intake_read_policies(campaign_id,sponsor_policy_digest,read_policy_digest,policy_json,review_receipt_digest)
        VALUES(?,?,?,?,?)`).bind(checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.readPolicyDigest, checked.policyJson, receiptDigest),
      env.DB.prepare(`INSERT INTO experience_sponsor_intake_read_approvals(approval_id,campaign_id,sponsor_policy_digest,original_approval_id,payer_user_id,
        read_policy_digest,terms_json,terms_digest,review_receipt_json,review_receipt_digest,approval_command_json,approved_by_user_id,approved_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,${clock})`).bind(approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
        checked.terms.payerUserId, checked.readPolicyDigest, checked.termsJson, checked.termsDigest, receiptJson, receiptDigest, approvalCommandJson, checked.terms.payerUserId),
      ...outputAssertionStatements(env, proof),
    ]);
  } catch (error) {
    // Recover the exact committed row after an ambiguous acknowledgment. A
    // conflict fails the full proof; never overwrite a row or reset read usage.
    if (!await exists()) throw error;
    return finish(true);
  }
  return finish(false);
}
