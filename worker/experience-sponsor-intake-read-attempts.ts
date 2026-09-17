import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_IMAGE_INTAKE_READ_OPERATIONS, readSponsorIntakeReadPolicy, type SponsorImageIntakeReadOperation } from "./experience-sponsor-intake-read-policy.ts";
import { requireSponsorIntakeReadAuthority, type SponsorIntakeReadAuthority } from "./experience-sponsor-intake-reads.ts";
import type { WorkerEnv } from "./runtime.ts";

type SqlAssertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type PolicyRow = { campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string; policy_json: string;
  review_receipt_digest: string; approval_id: string; original_approval_id: string; payer_user_id: string;
  terms_digest: string; terms_json: string; review_receipt_json: string; approval_command_json: string;
  original_terms_digest: string; payer_authority_json: string };
type AttemptRow = { attempt_id: string; campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string;
  actor_user_id: string; resource_key: string; operation: SponsorImageIntakeReadOperation; maximum_bytes: number;
  admitted_at_ms: number; deadline_at_ms: number; charged_through_ms: number };
export type SponsorIntakeReadAttempt = Readonly<{ kind: "sponsor-image-intake-read-attempt" }>;
type AttemptState = { authority: SponsorIntakeReadAuthority; request: Request; env: WorkerEnv; db: WorkerEnv["DB"];
  receipt: AttemptRow; assertions: SqlAssertion[]; monotonicDeadline: number; taken: boolean };
const attempts = new WeakMap<SponsorIntakeReadAttempt, AttemptState>();
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const and = (assertions: readonly SqlAssertion[]): SqlAssertion => ({
  sql: assertions.map(item => `(${item.sql})`).join(" AND "), bindings: assertions.flatMap(item => [...item.bindings]),
});

export class SponsorIntakeReadLimitError extends SponsorEntitlementError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("sponsor_intake_read_limit_reached"); this.retryAfterMs = retryAfterMs; }
}

/** Dormant, immutable resource receipts. Each actual HTTP attempt gets a fresh
 * identity, never an intent key, resource alias or idempotency credit. Full request and byte
 * reservations remain charged through deadline + window, including failures,
 * cancelled streams and lost acknowledgements. There is deliberately no finish,
 * refund, cleanup or replay-to-service operation. Importing installs nothing. */
export const SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_intake_read_attempts(
    attempt_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    read_policy_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,resource_key TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('image-intake-bootstrap','image-intake-draft','image-intake-receipt')),
    maximum_bytes INTEGER NOT NULL CHECK(typeof(maximum_bytes)='integer' AND maximum_bytes>0 AND maximum_bytes<=192000000),
    admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
    deadline_at_ms INTEGER NOT NULL CHECK(typeof(deadline_at_ms)='integer' AND deadline_at_ms>admitted_at_ms AND deadline_at_ms<=admitted_at_ms+30000),
    charged_through_ms INTEGER NOT NULL CHECK(typeof(charged_through_ms)='integer' AND charged_through_ms>deadline_at_ms AND charged_through_ms<=deadline_at_ms+31536000000),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_intake_read_policies(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  `CREATE INDEX experience_sponsor_intake_read_campaign_window ON experience_sponsor_intake_read_attempts(campaign_id,charged_through_ms)`,
  `CREATE INDEX experience_sponsor_intake_read_actor_window ON experience_sponsor_intake_read_attempts(campaign_id,actor_user_id,charged_through_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_intake_read_attempts_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_intake_read_attempts BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_attempt_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_intake_read_attempts_no_replace BEFORE INSERT ON experience_sponsor_intake_read_attempts
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_intake_read_attempts old WHERE old.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_attempt_exists'); END`,
]);

const boundedText = (column: string, maximumBytes: number) => `CASE WHEN typeof(${column})='text'
  AND length(CAST(${column} AS BLOB))<=${maximumBytes} AND instr(${column},char(0))=0 THEN ${column} END`;
const approvedFrom = `FROM experience_sponsor_intake_read_policies policy
  JOIN experience_sponsor_intake_read_approvals approval ON approval.campaign_id=policy.campaign_id
    AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.read_policy_digest=policy.read_policy_digest
    AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
  JOIN experience_sponsor_approvals original ON original.approval_id=approval.original_approval_id
    AND original.campaign_id=policy.campaign_id AND original.policy_digest=policy.sponsor_policy_digest
    AND original.payer_user_id=approval.payer_user_id AND original.approved_by_user_id=original.payer_user_id`;

/** Consume the immutable, explicit payer review, not a standalone digest. This
 * checks original provenance without reviving generation authority or making
 * current campaign/consent/expiry a prerequisite for an already owned draft.
 * The native read authority separately supplies current actor and custody proof. */
async function approvedPolicy(db: WorkerEnv["DB"], campaignId: string, sponsorPolicyDigest: string) {
  const row = await db.prepare(`SELECT policy.campaign_id,policy.sponsor_policy_digest,policy.read_policy_digest,
    ${boundedText("policy.policy_json", 8192)} AS policy_json,policy.review_receipt_digest,
    ${boundedText("approval.approval_id", 200)} AS approval_id,${boundedText("approval.original_approval_id", 200)} AS original_approval_id,
    ${boundedText("approval.payer_user_id", 200)} AS payer_user_id,approval.terms_digest,
    ${boundedText("approval.terms_json", 16384)} AS terms_json,
    ${boundedText("approval.review_receipt_json", 262144)} AS review_receipt_json,
    ${boundedText("approval.approval_command_json", 32768)} AS approval_command_json,
    original.terms_digest AS original_terms_digest,${boundedText("original.payer_authority_json", 131072)} AS payer_authority_json
    ${approvedFrom} WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=?`)
    .bind(campaignId, sponsorPolicyDigest).first<PolicyRow>();
  if (!row || row.campaign_id !== campaignId || row.sponsor_policy_digest !== sponsorPolicyDigest
    || ![row.read_policy_digest, row.review_receipt_digest, row.terms_digest, row.original_terms_digest].every(hash)
    || ![row.policy_json, row.approval_id, row.original_approval_id, row.payer_user_id, row.terms_json,
      row.review_receipt_json, row.approval_command_json, row.payer_authority_json].every(value => typeof value === "string"))
    return fail("sponsor_intake_read_policy_unavailable");
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return fail("sponsor_intake_read_policy_unavailable"); }
  const policy = readSponsorIntakeReadPolicy(raw);
  if (row.policy_json !== canonicalJson(policy) || row.read_policy_digest !== await digest(policy)) return fail("sponsor_intake_read_policy_unavailable");
  const proposal = { version: 1, campaignId, sponsorPolicyDigest, readPolicy: policy };
  const terms = { purpose: "sponsor-image-intake-read-policy", proposal, payerUserId: row.payer_user_id,
    originalApprovalId: row.original_approval_id, originalTermsDigest: row.original_terms_digest };
  if (row.terms_json !== canonicalJson(terms) || row.terms_digest !== await digest(terms)) return fail("sponsor_intake_read_policy_unavailable");
  const command = { action: "approve-sponsor-intake-read-policy", approvalId: row.approval_id, proposal,
    reviewedTermsDigest: row.terms_digest, confirmation: "APPROVE_SPONSOR_INTAKE_READ_POLICY" };
  const receipt = { version: 1, purpose: "sponsor-image-intake-read-policy-approval", approvalId: row.approval_id,
    termsDigest: row.terms_digest, readPolicyDigest: row.read_policy_digest, approvedByUserId: row.payer_user_id,
    payerAuthorityJson: row.payer_authority_json, approvalCommandDigest: await digest(command) };
  if (row.approval_command_json !== canonicalJson(command) || row.review_receipt_json !== canonicalJson(receipt)
    || row.review_receipt_digest !== await digest(receipt)) return fail("sponsor_intake_read_policy_unavailable");
  const assertion: SqlAssertion = { sql: `EXISTS(SELECT 1 ${approvedFrom} WHERE policy.campaign_id=?
    AND policy.sponsor_policy_digest=? AND policy.read_policy_digest=? AND policy.policy_json=? AND policy.review_receipt_digest=?
    AND approval.approval_id=? AND approval.original_approval_id=? AND approval.payer_user_id=? AND approval.terms_digest=?
    AND approval.terms_json=? AND approval.review_receipt_json=? AND approval.approval_command_json=?
    AND original.terms_digest=? AND original.payer_authority_json=?)`,
    bindings: [campaignId, sponsorPolicyDigest, row.read_policy_digest, row.policy_json, row.review_receipt_digest,
      row.approval_id, row.original_approval_id, row.payer_user_id, row.terms_digest, row.terms_json,
      row.review_receipt_json, row.approval_command_json, row.original_terms_digest, row.payer_authority_json] };
  return { row, policy, assertion };
}

/** This internal boundary accepts a native opaque resource authority and a
 * closed operation, never client limits, bytes, clocks or receipt identities.
 * Commit the debit before accessing retained creative content or media. */
export async function reserveSponsorIntakeReadAttempt(authority: SponsorIntakeReadAuthority, request: Request, env: WorkerEnv,
  operation: SponsorImageIntakeReadOperation): Promise<SponsorIntakeReadAttempt> {
  if (!SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.includes(operation)) return fail("sponsor_intake_read_operation_invalid");
  const database = env.DB;
  const native = requireSponsorIntakeReadAuthority(authority, request, env);
  if (native.operation !== operation) return fail("sponsor_intake_read_operation_invalid");
  const unchanged = () => {
    if (env.DB !== database) return fail("sponsor_intake_read_authority_changed");
    requireSponsorIntakeReadAuthority(authority, request, env);
  };
  const approved = await approvedPolicy(database, native.campaignId, native.policyDigest);
  unchanged();
  const { policy } = approved, limit = policy.operations[operation];
  const assertions = [...native.assertions.map(item => ({ sql: item.sql, bindings: [...item.bindings] })), approved.assertion];
  const proof = and(assertions), attemptId = crypto.randomUUID();
  // Materialize each complete native/read assertion separately: combining their
  // expression trees with all quota checks exceeds D1's depth limit. Each gate
  // emits exactly zero or one row; all proofs and quotas remain in this INSERT.
  let gatePrefix = "sponsor_intake_read_gate";
  while (proof.sql.toLowerCase().includes(gatePrefix)) gatePrefix += "_";
  const gates = assertions.map((item, index) => ({ name: `${gatePrefix}_${index}`, sql: item.sql }));
  const proofCtes = gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(",");
  const campaignWindow = `FROM experience_sponsor_intake_read_attempts WHERE campaign_id=? AND charged_through_ms>${clock}`;
  const actorWindow = `FROM experience_sponsor_intake_read_attempts WHERE campaign_id=? AND actor_user_id=? AND charged_through_ms>${clock}`;
  const started = performance.now();
  const statements = [
    database.prepare(`INSERT INTO experience_sponsor_intake_read_attempts(attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,
      actor_user_id,resource_key,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms)
      WITH ${proofCtes}
      SELECT ?,?,?,?,?,?,?,?,${clock},${clock}+?,${clock}+?+? FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}
      WHERE (SELECT COUNT(*) ${campaignWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow})+?<=?
      AND (SELECT COUNT(*) ${actorWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow})+?<=?`)
      // CTE parameters precede the original payload, clock and quota parameters.
      .bind(...proof.bindings, attemptId, native.campaignId, native.policyDigest, approved.row.read_policy_digest,
        native.actorUserId, native.resourceKey, operation, limit.maximumBytes, limit.deadlineMs, limit.deadlineMs, policy.windowMs,
        native.campaignId, policy.campaign.maximumRequestsPerWindow,
        native.campaignId, limit.maximumBytes, policy.campaign.maximumBytesPerWindow,
        native.campaignId, native.actorUserId, policy.actor.maximumRequestsPerWindow,
        native.campaignId, native.actorUserId, limit.maximumBytes, policy.actor.maximumBytesPerWindow),
    database.prepare(`SELECT attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,actor_user_id,resource_key,
      operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms
      FROM experience_sponsor_intake_read_attempts WHERE attempt_id=?`).bind(attemptId),
  ];
  unchanged();
  const result = await database.batch<AttemptRow>(statements);
  unchanged();
  const receipt = result[1]?.results[0];
  if (!receipt || !result[0]?.success || Number(result[0]?.meta.changes) !== 1 || !result[1]?.success) {
    const usage = await database.prepare(`SELECT ${clock} AS now_ms,
      (SELECT COUNT(*) ${campaignWindow}) AS campaign_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow}) AS campaign_bytes,
      (SELECT COUNT(*) ${actorWindow}) AS actor_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow}) AS actor_bytes,
      (SELECT MAX(charged_through_ms) ${campaignWindow}) AS retry_at_ms`)
      .bind(native.campaignId, native.campaignId, native.campaignId, native.actorUserId,
        native.campaignId, native.actorUserId, native.campaignId)
      .first<{ now_ms: number; campaign_requests: number; campaign_bytes: number; actor_requests: number; actor_bytes: number; retry_at_ms: number | null }>();
    unchanged();
    if (usage && (usage.campaign_requests >= policy.campaign.maximumRequestsPerWindow
      || usage.campaign_bytes + limit.maximumBytes > policy.campaign.maximumBytesPerWindow
      || usage.actor_requests >= policy.actor.maximumRequestsPerWindow || usage.actor_bytes + limit.maximumBytes > policy.actor.maximumBytesPerWindow))
      throw new SponsorIntakeReadLimitError(Math.max(1, (usage.retry_at_ms ?? usage.now_ms + policy.windowMs) - usage.now_ms));
    return fail("sponsor_intake_read_authority_changed");
  }
  if (receipt.attempt_id !== attemptId || receipt.campaign_id !== native.campaignId || receipt.sponsor_policy_digest !== native.policyDigest
    || receipt.read_policy_digest !== approved.row.read_policy_digest || receipt.actor_user_id !== native.actorUserId || receipt.resource_key !== native.resourceKey
    || receipt.operation !== operation || receipt.maximum_bytes !== limit.maximumBytes || !Number.isSafeInteger(receipt.admitted_at_ms)
    || receipt.deadline_at_ms !== receipt.admitted_at_ms + limit.deadlineMs || receipt.charged_through_ms !== receipt.deadline_at_ms + policy.windowMs)
    return fail("sponsor_intake_read_attempt_unavailable");
  const ticket = Object.freeze({ kind: "sponsor-image-intake-read-attempt" } as const);
  attempts.set(ticket, { authority, request, env, db: database, receipt: freeze({ ...receipt }), assertions: freeze(assertions),
    monotonicDeadline: started + limit.deadlineMs, taken: false });
  return ticket;
}

/** A ticket may enter its exact native intake resolver once. Its assertion
 * must also be checked at final disclosure, alongside refreshed native custody.
 * The DB clock and receipt stay authoritative when the local clock moves. */
export async function takeSponsorIntakeReadAttempt(attempt: SponsorIntakeReadAttempt, authority: SponsorIntakeReadAuthority,
  request: Request, env: WorkerEnv) {
  const state = attempts.get(attempt);
  if (!state || state.taken || state.authority !== authority || state.request !== request || state.env !== env || state.db !== env.DB)
    return fail("sponsor_intake_read_attempt_unavailable");
  const unchanged = () => {
    if (state.env !== env || state.request !== request || state.db !== env.DB) return fail("sponsor_intake_read_attempt_unavailable");
    requireSponsorIntakeReadAuthority(authority, request, env);
  };
  unchanged();
  state.taken = true;
  const receipt = state.receipt;
  const assertions: SqlAssertion[] = [...state.assertions, {
    sql: `EXISTS(SELECT 1 FROM experience_sponsor_intake_read_attempts WHERE attempt_id=? AND campaign_id=? AND sponsor_policy_digest=?
      AND read_policy_digest=? AND actor_user_id=? AND resource_key=? AND operation=? AND maximum_bytes=?
      AND admitted_at_ms=? AND deadline_at_ms=? AND charged_through_ms=? AND deadline_at_ms>${clock})`,
    bindings: [receipt.attempt_id, receipt.campaign_id, receipt.sponsor_policy_digest, receipt.read_policy_digest,
      receipt.actor_user_id, receipt.resource_key, receipt.operation, receipt.maximum_bytes, receipt.admitted_at_ms, receipt.deadline_at_ms, receipt.charged_through_ms],
  }];
  const assertion = freeze(and(assertions));
  // Keep the full returned proof unchanged. Only this sample's statement shape
  // separates its complete predicates, including the immutable attempt gate.
  let gatePrefix = "sponsor_intake_sample_gate";
  while (assertion.sql.toLowerCase().includes(gatePrefix)) gatePrefix += "_";
  const gates = assertions.map((item, index) => ({ name: `${gatePrefix}_${index}`, sql: item.sql }));
  const proofCtes = gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(",");
  const started = performance.now(), localRemaining = Math.floor(state.monotonicDeadline - started);
  if (localRemaining <= 0) return fail("sponsor_intake_read_attempt_unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sampled: { available: number; now_ms: number } | null;
  try {
    sampled = await Promise.race([
      state.db.prepare(`WITH ${proofCtes} SELECT 1 AS available,${clock} AS now_ms
        FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`).bind(...assertion.bindings)
        .first<{ available: number; now_ms: number }>(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_intake_read_attempt_unavailable")), localRemaining); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
  unchanged();
  // Anchor the sampled DB remainder to the start of the whole round trip,
  // conservatively subtracting even time before the DB sampled its clock.
  // Consumers use this absolute cutoff; delayed continuation cannot rebase it.
  const monotonicDeadline = sampled && Number.isSafeInteger(sampled.now_ms)
    ? Math.min(state.monotonicDeadline, started + receipt.deadline_at_ms - sampled.now_ms) : 0;
  const remainingMs = Math.floor(monotonicDeadline - performance.now());
  if (!sampled || sampled.available !== 1 || remainingMs <= 0 || remainingMs > receipt.deadline_at_ms - receipt.admitted_at_ms)
    return fail("sponsor_intake_read_attempt_unavailable");
  return freeze({ operation: receipt.operation, maximumBytes: receipt.maximum_bytes,
    deadlineAtMs: receipt.deadline_at_ms, chargedThroughMs: receipt.charged_through_ms, monotonicDeadline, remainingMs, assertion, assertions });
}
