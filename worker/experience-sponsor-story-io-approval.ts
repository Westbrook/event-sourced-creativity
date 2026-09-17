import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorApprovalProposal, readSponsorInternalCommand, sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorStoryIoPolicy, type SponsorStoryIoPolicyV1 } from "./experience-sponsor-story-io-policy.ts";
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
export type SponsorStoryIoApprovalProposal = {
  version: 1; family: "canonical-short-story-io@1"; campaignId: string; sponsorPolicyDigest: string; ioPolicy: SponsorStoryIoPolicyV1;
};
type OriginalApproval = { approval_id: string; campaign_id: string; payer_user_id: string; terms_json: string; terms_digest: string;
  policy_json: string; policy_digest: string; payer_authority_json: string; approval_command_json: string };

/** Dormant selected-result allocation: no initializer, registered route or launch
 * policy. Both new rows are installed together by the actual original V4 payer.
 * Neither a detached policy nor its digest is authority. */
export const SPONSOR_STORY_IO_APPROVAL_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_story_io_approvals(
    approval_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    original_approval_id TEXT NOT NULL REFERENCES experience_sponsor_approvals(approval_id),payer_user_id TEXT NOT NULL,
    io_policy_digest TEXT NOT NULL,terms_json TEXT NOT NULL,terms_digest TEXT NOT NULL,
    review_receipt_json TEXT NOT NULL,review_receipt_digest TEXT UNIQUE NOT NULL,
    approval_command_json TEXT NOT NULL,approved_by_user_id TEXT NOT NULL,approved_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id,sponsor_policy_digest),CHECK(approved_by_user_id=payer_user_id),
    CHECK(typeof(approved_at_ms)='integer' AND approved_at_ms>=0),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_story_io_policies(campaign_id,sponsor_policy_digest)
      DEFERRABLE INITIALLY DEFERRED) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_story_io_approvals_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_story_io_approvals BEGIN SELECT RAISE(ABORT,'sponsor_story_io_approval_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_story_io_approvals_no_replace BEFORE INSERT ON experience_sponsor_story_io_approvals
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_story_io_approvals old WHERE old.approval_id=NEW.approval_id
      OR (old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
      OR old.review_receipt_digest=NEW.review_receipt_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_story_io_approval_exists'); END`,
]);

function proposal(raw: unknown): Readonly<SponsorStoryIoApprovalProposal> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "family", "campaignId", "sponsorPolicyDigest", "ioPolicy"])
    || raw.version !== 1 || raw.family !== "canonical-short-story-io@1" || !id(raw.campaignId) || !hash(raw.sponsorPolicyDigest)) return fail("sponsor_story_io_approval_terms_invalid");
  return freeze({ version: 1, family: "canonical-short-story-io@1", campaignId: raw.campaignId, sponsorPolicyDigest: raw.sponsorPolicyDigest,
    ioPolicy: readSponsorStoryIoPolicy(raw.ioPolicy) });
}

/** Capture the database before any await; identity changes and cancellation
 * stop disclosure even when the original transaction already committed. */
function boundary(env: WorkerEnv, request?: Request) {
  const database = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  // Internal callers can construct mutable Requests. Pin the original request
  // through authentication, including its principal-only impersonation cookie.
  const requestIdentity = () => request ? JSON.stringify([request.method, request.url, ...[
    "oai-authenticated-user-id", "oai-authenticated-user-email", "oai-authenticated-user-full-name",
    "oai-authenticated-user-full-name-encoding", "cookie",
  ].map(name => request.headers.get(name))]) : null;
  const identity = requestIdentity();
  const check = () => {
    if (env.DB !== database || request && (request.signal.aborted || env.FORMA_PILOT_COHORT_ID !== cohort
      || env.FORMA_ADMIN_EMAILS !== admins || requestIdentity() !== identity))
      return fail("sponsor_story_io_authority_changed");
  };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    try { const result = await operation(); check(); return result; }
    catch (error) { check(); throw error; }
  };
  // outputAssertionStatements only needs DB; never consult a substituted env.
  const assertions = (items: readonly OutputSqlAssertion[]) => items.flatMap(item => outputAssertionStatements({ DB: database } as WorkerEnv, item));
  const batch = async (statements: ReturnType<typeof outputAssertionStatements>) => {
    const receipts = await wait(() => database.batch(statements));
    // A resolved batch is not its acknowledgement. Check every own array slot:
    // Array.some/every skip sparse holes and could silently lose a proof ACK.
    if (!Array.isArray(receipts) || receipts.length !== statements.length) return fail("sponsor_story_io_approval_acknowledgement_missing");
    for (let index = 0; index < statements.length; index++) {
      if (!Object.hasOwn(receipts, index) || !record(receipts[index]) || !Object.hasOwn(receipts[index], "success")
        || receipts[index].success !== true) return fail("sponsor_story_io_approval_acknowledgement_missing");
    }
    return receipts;
  };
  return { database, check, wait, assertions, batch };
}
type Boundary = ReturnType<typeof boundary>;

async function originalProof(original: OriginalApproval, campaignId: string, sponsorPolicyDigest: string, bound: Boundary) {
  if (![original.terms_json, original.policy_json, original.payer_authority_json, original.approval_command_json].every(value => typeof value === "string")
    || !id(original.approval_id) || !id(original.payer_user_id) || !hash(original.terms_digest)) return fail("sponsor_story_io_original_approval_unavailable");
  let originalTerms: unknown; try { originalTerms = JSON.parse(original.terms_json); } catch { return fail("sponsor_story_io_original_approval_unavailable"); }
  const compiled = await bound.wait(() => compileSponsorApprovalProposal(originalTerms));
  if (!record(originalTerms) || !Array.isArray(originalTerms.issuerUserIds) || !id(originalTerms.issuerUserIds[0])
    || compiled.policy.version !== 4 || compiled.policy.family !== "canonical-short-story@1"
    || original.campaign_id !== campaignId || original.policy_digest !== sponsorPolicyDigest
    || compiled.policy.campaignId !== campaignId || compiled.policy.payerUserId !== original.payer_user_id
    || compiled.policyDigest !== sponsorPolicyDigest || original.policy_json !== compiled.policyJson
    || original.terms_json !== compiled.termsJson || original.terms_digest !== compiled.termsDigest
    || original.approval_command_json !== canonicalJson({ action: "approve-sponsor-campaign", approvalId: original.approval_id,
      proposal: originalTerms, confirmation: "APPROVE_SPONSOR_CAMPAIGN", reviewedTermsDigest: compiled.termsDigest })) return fail("sponsor_story_io_original_approval_unavailable");
  return { compiled, issuerUserId: originalTerms.issuerUserIds[0] };
}
const termsFor = (input: Readonly<SponsorStoryIoApprovalProposal>, original: OriginalApproval) => freeze({
  purpose: "sponsor-short-story-selected-result-policy" as const, proposal: input, payerUserId: original.payer_user_id,
  originalApprovalId: original.approval_id, originalTermsDigest: original.terms_digest,
});
const originalSelect = (alias: string) => [
  ["approval_id", 200], ["campaign_id", 200], ["payer_user_id", 200], ["terms_json", 131072], ["terms_digest", 71],
  ["policy_digest", 71], ["policy_json", 262144], ["payer_authority_json", 131072], ["approval_command_json", 131072],
].map(([column, limit]) => `${boundedJson(`${alias}.${column}`, Number(limit))} AS ${column}`).join(",");

/** Native authentication supplies the actual caller. The original issuer is
 * only a witness to that recorded approval, never an impersonated payer. */
async function review(request: Request, env: WorkerEnv, raw: unknown, bound: Boundary) {
  const input = proposal(raw);
  const auth = await bound.wait(() => readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_canonical_principal_required");
  const original = await bound.wait(() => bound.database.prepare(`SELECT ${originalSelect("approval")}
    FROM experience_sponsor_approvals approval WHERE approval.campaign_id=? AND approval.policy_digest=?`)
    .bind(input.campaignId, input.sponsorPolicyDigest).first<OriginalApproval>());
  if (!original || original.payer_user_id !== auth.user.userId) return fail("sponsor_story_io_payer_approval_required");
  const { compiled, issuerUserId } = await originalProof(original, input.campaignId, input.sponsorPolicyDigest, bound);
  const assertions: OutputSqlAssertion[] = [
    sponsorApprovalAssertion(compiled.policy, issuerUserId, true),
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
  const terms = termsFor(input, original), termsJson = canonicalJson(terms);
  const termsDigest = await bound.wait(() => digest(terms)), ioPolicyDigest = await bound.wait(() => digest(input.ioPolicy));
  return { input, original, assertions, terms, termsJson, termsDigest, ioPolicyDigest, policyJson: canonicalJson(input.ioPolicy) };
}

/** Payer-authenticated preparation retains no policy, approval or business state.
 * Native assertion rows are checked and removed in one transaction. The returned
 * digest describes a review, never a capability or substitute for commit proof. */
export async function prepareSponsorStoryIoApproval(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorInternalCommand(request));
  if (!record(raw) || !exactKeys(raw, ["action", "proposal"]) || raw.action !== "prepare-sponsor-story-io-policy") return fail("sponsor_explicit_command_required");
  const checked = await review(request, env, raw.proposal, bound);
  await bound.batch(bound.assertions(checked.assertions));
  return freeze({ terms: checked.terms, termsDigest: checked.termsDigest, ioPolicyDigest: checked.ioPolicyDigest });
}

/** Exact explicit payer review, immutable one-time policy, source-free replay.
 * Active campaign authority is required to provision/replay this command; it
 * never becomes a requirement for consuming already provisioned selected-result read terms.
 * No grant, provider call, financial hold or read-attempt credit is created. */
export async function approveSponsorStoryIoPolicy(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorInternalCommand(request));
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || raw.action !== "approve-sponsor-story-io-policy" || !id(raw.approvalId) || !hash(raw.reviewedTermsDigest)
    || raw.confirmation !== "APPROVE_SPONSOR_STORY_IO_POLICY") return fail("sponsor_explicit_approval_required");
  const input = JSON.parse(canonicalJson(raw)) as typeof raw;
  const checked = await review(request, env, input.proposal, bound);
  if (input.reviewedTermsDigest !== checked.termsDigest) return fail("sponsor_story_io_terms_not_reviewed");
  const approvalId = String(input.approvalId), approvalCommandJson = canonicalJson(input);
  const receipt = freeze({ version: 1, purpose: "sponsor-short-story-selected-result-policy-approval", approvalId,
    termsDigest: checked.termsDigest, ioPolicyDigest: checked.ioPolicyDigest, approvedByUserId: checked.terms.payerUserId,
    payerAuthorityJson: checked.original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(input)) });
  const receiptJson = canonicalJson(receipt), receiptDigest = await bound.wait(() => digest(receipt));
  const proof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_story_io_approvals approval
    JOIN experience_sponsor_story_io_policies policy ON policy.campaign_id=approval.campaign_id AND policy.sponsor_policy_digest=approval.sponsor_policy_digest
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.sponsor_policy_digest=? AND approval.original_approval_id=?
      AND approval.payer_user_id=? AND approval.approved_by_user_id=? AND approval.io_policy_digest=? AND approval.terms_json=? AND approval.terms_digest=?
      AND approval.review_receipt_json=? AND approval.review_receipt_digest=? AND approval.approval_command_json=?
      AND policy.io_policy_digest=approval.io_policy_digest AND policy.policy_json=? AND policy.review_receipt_digest=approval.review_receipt_digest)`,
    bindings: [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
      checked.terms.payerUserId, checked.terms.payerUserId, checked.ioPolicyDigest, checked.termsJson, checked.termsDigest,
      receiptJson, receiptDigest, approvalCommandJson, checked.policyJson] };
  const finish = async (replayed: boolean) => {
    await bound.batch(bound.assertions([...checked.assertions, proof]));
    return freeze({ replayed, approvalId, campaignId: checked.input.campaignId, sponsorPolicyDigest: checked.input.sponsorPolicyDigest,
      ioPolicyDigest: checked.ioPolicyDigest, reviewReceiptDigest: receiptDigest, termsDigest: checked.termsDigest });
  };
  const exists = async () => bound.wait(() => bound.database.prepare(`SELECT 1 AS present FROM experience_sponsor_story_io_approvals
    WHERE approval_id=? OR (campaign_id=? AND sponsor_policy_digest=?)`).bind(approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest).first());
  if (await exists()) return finish(true);
  try {
    await bound.batch([
      ...bound.assertions(checked.assertions),
      bound.database.prepare(`INSERT INTO experience_sponsor_story_io_policies(campaign_id,sponsor_policy_digest,io_policy_digest,policy_json,review_receipt_digest)
        VALUES(?,?,?,?,?)`).bind(checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.ioPolicyDigest, checked.policyJson, receiptDigest),
      bound.database.prepare(`INSERT INTO experience_sponsor_story_io_approvals(approval_id,campaign_id,sponsor_policy_digest,original_approval_id,payer_user_id,
        io_policy_digest,terms_json,terms_digest,review_receipt_json,review_receipt_digest,approval_command_json,approved_by_user_id,approved_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,${clock})`).bind(approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
        checked.terms.payerUserId, checked.ioPolicyDigest, checked.termsJson, checked.termsDigest, receiptJson, receiptDigest, approvalCommandJson, checked.terms.payerUserId),
      ...bound.assertions([proof]),
    ]);
  } catch (error) {
    bound.check();
    // Recover the exact committed row after an ambiguous acknowledgment. A
    // conflict fails the full proof; never overwrite a row or reset read usage.
    if (!await exists()) throw error;
    return finish(true);
  }
  return finish(false);
}

type RetainedIoRow = { campaign_id: string; sponsor_policy_digest: string; io_policy_digest: string; policy_json: string;
  review_receipt_digest: string; approval_id: string; original_approval_id: string; payer_user_id: string;
  terms_json: string; terms_digest: string; review_receipt_json: string; approval_command_json: string };
const retainedFrom = `FROM experience_sponsor_story_io_policies policy
  JOIN experience_sponsor_story_io_approvals approval ON approval.campaign_id=policy.campaign_id
    AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.io_policy_digest=policy.io_policy_digest
    AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
  JOIN experience_sponsor_approvals original ON original.approval_id=approval.original_approval_id
    AND original.campaign_id=policy.campaign_id AND original.policy_digest=policy.sponsor_policy_digest
    AND original.payer_user_id=approval.payer_user_id AND original.approved_by_user_id=original.payer_user_id`;

/** Read-only, bounded immutable provenance, never a raw read capability. Current
 * actor/custody and request/byte reservations belong to the separate consumer.
 * Revocation, expiry or changed payer consent cannot erase an owned result's
 * original allocation; no current generation predicate is used here. */
export async function readApprovedSponsorStoryIoPolicy(env: WorkerEnv, campaignId: string, sponsorPolicyDigest: string) {
  const bound = boundary(env), unavailable = () => fail("sponsor_story_io_policy_unavailable");
  if (!id(campaignId) || !hash(sponsorPolicyDigest)) return unavailable();
  const projections = [
    ["policy.campaign_id", "campaign_id", 200], ["policy.sponsor_policy_digest", "sponsor_policy_digest", 71],
    ["policy.io_policy_digest", "io_policy_digest", 71], ["policy.policy_json", "policy_json", 8192],
    ["policy.review_receipt_digest", "review_receipt_digest", 71], ["approval.approval_id", "approval_id", 200],
    ["approval.original_approval_id", "original_approval_id", 200], ["approval.payer_user_id", "payer_user_id", 200],
    ["approval.terms_json", "terms_json", 16384], ["approval.terms_digest", "terms_digest", 71],
    ["approval.review_receipt_json", "review_receipt_json", 262144], ["approval.approval_command_json", "approval_command_json", 32768],
  ].map(([column, alias, maximum]) => `${boundedJson(String(column), Number(maximum))} AS ${alias}`).join(",");
  const row = await bound.wait(() => bound.database.prepare(`SELECT ${projections} ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=?`).bind(campaignId, sponsorPolicyDigest).first<RetainedIoRow>());
  if (!row || row.campaign_id !== campaignId || row.sponsor_policy_digest !== sponsorPolicyDigest
    || ![row.io_policy_digest, row.review_receipt_digest, row.terms_digest].every(hash)
    || ![row.approval_id, row.original_approval_id, row.payer_user_id].every(id)
    || ![row.policy_json, row.terms_json, row.review_receipt_json, row.approval_command_json].every(value => typeof value === "string")) return unavailable();
  const original = await bound.wait(() => bound.database.prepare(`SELECT ${originalSelect("approval")}
    FROM experience_sponsor_approvals approval WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.policy_digest=?`)
    .bind(row.original_approval_id, campaignId, sponsorPolicyDigest).first<OriginalApproval>());
  if (!original || original.payer_user_id !== row.payer_user_id) return unavailable();
  await originalProof(original, campaignId, sponsorPolicyDigest, bound);
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return unavailable(); }
  const policy = readSponsorStoryIoPolicy(raw);
  if (row.policy_json !== canonicalJson(policy) || row.io_policy_digest !== await bound.wait(() => digest(policy))) return unavailable();
  const input = proposal({ version: 1, family: "canonical-short-story-io@1", campaignId, sponsorPolicyDigest, ioPolicy: policy });
  const terms = termsFor(input, original);
  if (row.terms_json !== canonicalJson(terms) || row.terms_digest !== await bound.wait(() => digest(terms))) return unavailable();
  const command = { action: "approve-sponsor-story-io-policy", approvalId: row.approval_id, proposal: input,
    reviewedTermsDigest: row.terms_digest, confirmation: "APPROVE_SPONSOR_STORY_IO_POLICY" };
  const receipt = { version: 1, purpose: "sponsor-short-story-selected-result-policy-approval", approvalId: row.approval_id,
    termsDigest: row.terms_digest, ioPolicyDigest: row.io_policy_digest, approvedByUserId: row.payer_user_id,
    payerAuthorityJson: original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(command)) };
  if (row.approval_command_json !== canonicalJson(command) || row.review_receipt_json !== canonicalJson(receipt)
    || row.review_receipt_digest !== await bound.wait(() => digest(receipt))) return unavailable();
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? AND policy.io_policy_digest=? AND policy.policy_json=?
      AND policy.review_receipt_digest=? AND approval.approval_id=? AND approval.original_approval_id=? AND approval.payer_user_id=?
      AND approval.terms_json=? AND approval.terms_digest=? AND approval.review_receipt_json=? AND approval.approval_command_json=?
      AND original.terms_json=? AND original.terms_digest=? AND original.policy_json=? AND original.payer_authority_json=?
      AND original.approval_command_json=?)`,
    bindings: [campaignId, sponsorPolicyDigest, row.io_policy_digest, row.policy_json, row.review_receipt_digest,
      row.approval_id, row.original_approval_id, row.payer_user_id, row.terms_json, row.terms_digest, row.review_receipt_json,
      row.approval_command_json, original.terms_json, original.terms_digest, original.policy_json, original.payer_authority_json,
      original.approval_command_json] };
  // Count actual returned scalar rows, including JSON escaping of retained JSON
  // strings. The consumer adds its own native/proof/response reads to this debit.
  const encoder = new TextEncoder(), controlBytes = encoder.encode(JSON.stringify(row)).byteLength + encoder.encode(JSON.stringify(original)).byteLength;
  bound.check();
  return freeze({ policy, ioPolicyDigest: row.io_policy_digest, reviewReceiptDigest: row.review_receipt_digest,
    assertions: [assertion], controlBytes });
}
