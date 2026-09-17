import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_IMAGE_READ_OPERATIONS, readSponsorReadPolicy, type SponsorImageReadOperation } from "./experience-sponsor-read-policy.ts";
import { requireSponsorImageReadAuthority, type SponsorImageReadAuthority } from "./experience-sponsor-read-image.ts";
import type { WorkerEnv } from "./runtime.ts";

type SqlAssertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type PolicyRow = { campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string; policy_json: string; review_receipt_digest: string };
type AttemptRow = { attempt_id: string; campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string;
  actor_user_id: string; job_id: string; operation: SponsorImageReadOperation; maximum_bytes: number;
  admitted_at_ms: number; deadline_at_ms: number; charged_through_ms: number };
export type SponsorImageReadAttempt = Readonly<{ kind: "sponsor-image-read-attempt" }>;
type AttemptState = { authority: SponsorImageReadAuthority; request: Request; env: WorkerEnv; db: WorkerEnv["DB"];
  receipt: AttemptRow; assertions: SqlAssertion[]; monotonicDeadline: number; taken: boolean };
const attempts = new WeakMap<SponsorImageReadAttempt, AttemptState>();
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const and = (assertions: readonly SqlAssertion[]): SqlAssertion => ({
  sql: assertions.map(item => `(${item.sql})`).join(" AND "), bindings: assertions.flatMap(item => [...item.bindings]),
});

export class SponsorReadLimitError extends SponsorEntitlementError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("sponsor_read_limit_reached"); this.retryAfterMs = retryAfterMs; }
}

/** Dormant, immutable resource receipts. Each actual HTTP attempt gets a fresh
 * identity, never an intent key or idempotency credit. Full request and byte
 * reservations remain charged through deadline + window, including failures,
 * cancelled streams and lost acknowledgements. There is deliberately no finish,
 * refund, cleanup or replay-to-service operation. Importing installs nothing. */
export const SPONSOR_READ_ATTEMPT_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_read_attempts(
    attempt_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    read_policy_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,job_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('image-status','image-result','image-media')),
    maximum_bytes INTEGER NOT NULL CHECK(typeof(maximum_bytes)='integer' AND maximum_bytes>0 AND maximum_bytes<=192000000),
    admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
    deadline_at_ms INTEGER NOT NULL CHECK(typeof(deadline_at_ms)='integer' AND deadline_at_ms>admitted_at_ms AND deadline_at_ms<=admitted_at_ms+30000),
    charged_through_ms INTEGER NOT NULL CHECK(typeof(charged_through_ms)='integer' AND charged_through_ms>deadline_at_ms AND charged_through_ms<=deadline_at_ms+31536000000),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_read_policies(campaign_id,sponsor_policy_digest))`,
  `CREATE INDEX experience_sponsor_read_campaign_window ON experience_sponsor_read_attempts(campaign_id,charged_through_ms)`,
  `CREATE INDEX experience_sponsor_read_actor_window ON experience_sponsor_read_attempts(campaign_id,actor_user_id,charged_through_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_read_attempts_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_read_attempts BEGIN SELECT RAISE(ABORT,'sponsor_read_attempt_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_read_attempts_no_replace BEFORE INSERT ON experience_sponsor_read_attempts
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_read_attempts old WHERE old.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_read_attempt_exists'); END`,
]);

async function approvedPolicy(env: WorkerEnv, campaignId: string, sponsorPolicyDigest: string) {
  const row = await env.DB.prepare(`SELECT campaign_id,sponsor_policy_digest,read_policy_digest,
    CASE WHEN length(CAST(policy_json AS BLOB))<=8192 THEN policy_json END AS policy_json,review_receipt_digest
    FROM experience_sponsor_read_policies WHERE campaign_id=? AND sponsor_policy_digest=?`)
    .bind(campaignId, sponsorPolicyDigest).first<PolicyRow>();
  if (!row || row.campaign_id !== campaignId || row.sponsor_policy_digest !== sponsorPolicyDigest
    || !hash(row.read_policy_digest) || !hash(row.review_receipt_digest) || typeof row.policy_json !== "string" || row.policy_json.length > 8192)
    return fail("sponsor_read_policy_unavailable");
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return fail("sponsor_read_policy_unavailable"); }
  const policy = readSponsorReadPolicy(raw);
  if (row.policy_json !== canonicalJson(policy) || row.read_policy_digest !== await digest(policy)) return fail("sponsor_read_policy_unavailable");
  const assertion: SqlAssertion = { sql: `EXISTS(SELECT 1 FROM experience_sponsor_read_policies WHERE campaign_id=?
    AND sponsor_policy_digest=? AND read_policy_digest=? AND policy_json=? AND review_receipt_digest=?)`,
  bindings: [campaignId, sponsorPolicyDigest, row.read_policy_digest, row.policy_json, row.review_receipt_digest] };
  return { row, policy, assertion };
}

/** This internal boundary accepts a native opaque resource authority and a
 * closed operation, never client limits, bytes, clocks or receipt identities.
 * Commit the debit before accessing retained creative content or media. */
export async function reserveSponsorImageReadAttempt(authority: SponsorImageReadAuthority, request: Request, env: WorkerEnv,
  operation: SponsorImageReadOperation): Promise<SponsorImageReadAttempt> {
  if (!SPONSOR_IMAGE_READ_OPERATIONS.includes(operation)) return fail("sponsor_read_operation_invalid");
  const native = await requireSponsorImageReadAuthority(authority, request, env);
  const approved = await approvedPolicy(env, native.campaignId, native.policyDigest);
  const { policy } = approved, limit = policy.operations[operation];
  const assertions = [...native.assertions.map(item => ({ sql: item.sql, bindings: [...item.bindings] })), approved.assertion];
  const proof = and(assertions), attemptId = crypto.randomUUID();
  const campaignWindow = `FROM experience_sponsor_read_attempts WHERE campaign_id=? AND charged_through_ms>${clock}`;
  const actorWindow = `FROM experience_sponsor_read_attempts WHERE campaign_id=? AND actor_user_id=? AND charged_through_ms>${clock}`;
  const started = performance.now();
  const result = await env.DB.batch<AttemptRow>([
    env.DB.prepare(`INSERT INTO experience_sponsor_read_attempts(attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,
      actor_user_id,job_id,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms)
      SELECT ?,?,?,?,?,?,?,?,${clock},${clock}+?,${clock}+?+? WHERE ${proof.sql}
      AND (SELECT COUNT(*) ${campaignWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow})+?<=?
      AND (SELECT COUNT(*) ${actorWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow})+?<=?`)
      .bind(attemptId, native.campaignId, native.policyDigest, approved.row.read_policy_digest,
        native.actorUserId, native.jobId, operation, limit.maximumBytes, limit.deadlineMs, limit.deadlineMs, policy.windowMs,
        ...proof.bindings, native.campaignId, policy.campaign.maximumRequestsPerWindow,
        native.campaignId, limit.maximumBytes, policy.campaign.maximumBytesPerWindow,
        native.campaignId, native.actorUserId, policy.actor.maximumRequestsPerWindow,
        native.campaignId, native.actorUserId, limit.maximumBytes, policy.actor.maximumBytesPerWindow),
    env.DB.prepare(`SELECT attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,actor_user_id,job_id,
      operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms
      FROM experience_sponsor_read_attempts WHERE attempt_id=?`).bind(attemptId),
  ]);
  const receipt = result[1]?.results[0];
  if (!receipt || !result[0]?.success || Number(result[0]?.meta.changes) !== 1 || !result[1]?.success) {
    const usage = await env.DB.prepare(`SELECT ${clock} AS now_ms,
      (SELECT COUNT(*) ${campaignWindow}) AS campaign_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow}) AS campaign_bytes,
      (SELECT COUNT(*) ${actorWindow}) AS actor_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow}) AS actor_bytes,
      (SELECT MAX(charged_through_ms) ${campaignWindow}) AS retry_at_ms`)
      .bind(native.campaignId, native.campaignId, native.campaignId, native.actorUserId,
        native.campaignId, native.actorUserId, native.campaignId)
      .first<{ now_ms: number; campaign_requests: number; campaign_bytes: number; actor_requests: number; actor_bytes: number; retry_at_ms: number | null }>();
    if (usage && (usage.campaign_requests >= policy.campaign.maximumRequestsPerWindow
      || usage.campaign_bytes + limit.maximumBytes > policy.campaign.maximumBytesPerWindow
      || usage.actor_requests >= policy.actor.maximumRequestsPerWindow || usage.actor_bytes + limit.maximumBytes > policy.actor.maximumBytesPerWindow))
      throw new SponsorReadLimitError(Math.max(1, (usage.retry_at_ms ?? usage.now_ms + policy.windowMs) - usage.now_ms));
    return fail("sponsor_read_authority_changed");
  }
  if (receipt.attempt_id !== attemptId || receipt.campaign_id !== native.campaignId || receipt.sponsor_policy_digest !== native.policyDigest
    || receipt.read_policy_digest !== approved.row.read_policy_digest || receipt.actor_user_id !== native.actorUserId || receipt.job_id !== native.jobId
    || receipt.operation !== operation || receipt.maximum_bytes !== limit.maximumBytes || !Number.isSafeInteger(receipt.admitted_at_ms)
    || receipt.deadline_at_ms !== receipt.admitted_at_ms + limit.deadlineMs || receipt.charged_through_ms !== receipt.deadline_at_ms + policy.windowMs)
    return fail("sponsor_read_attempt_unavailable");
  const ticket = Object.freeze({ kind: "sponsor-image-read-attempt" } as const);
  attempts.set(ticket, { authority, request, env, db: env.DB, receipt: freeze({ ...receipt }), assertions: freeze(assertions),
    monotonicDeadline: started + limit.deadlineMs, taken: false });
  return ticket;
}

/** A ticket may enter the native result resolver exactly once. Its assertion
 * must also be checked at final disclosure, alongside refreshed native custody.
 * The DB clock and receipt stay authoritative when the local clock moves. */
export async function takeSponsorImageReadAttempt(attempt: SponsorImageReadAttempt, authority: SponsorImageReadAuthority,
  request: Request, env: WorkerEnv) {
  const state = attempts.get(attempt);
  if (!state || state.taken || state.authority !== authority || state.request !== request || state.env !== env || state.db !== env.DB)
    return fail("sponsor_read_attempt_unavailable");
  state.taken = true;
  const receipt = state.receipt;
  const assertion = freeze(and([...state.assertions, {
    sql: `EXISTS(SELECT 1 FROM experience_sponsor_read_attempts WHERE attempt_id=? AND campaign_id=? AND sponsor_policy_digest=?
      AND read_policy_digest=? AND actor_user_id=? AND job_id=? AND operation=? AND maximum_bytes=?
      AND admitted_at_ms=? AND deadline_at_ms=? AND charged_through_ms=? AND deadline_at_ms>${clock})`,
    bindings: [receipt.attempt_id, receipt.campaign_id, receipt.sponsor_policy_digest, receipt.read_policy_digest,
      receipt.actor_user_id, receipt.job_id, receipt.operation, receipt.maximum_bytes, receipt.admitted_at_ms, receipt.deadline_at_ms, receipt.charged_through_ms],
  }]));
  const started = performance.now(), localRemaining = Math.floor(state.monotonicDeadline - started);
  if (localRemaining <= 0) return fail("sponsor_read_attempt_unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sampled: { available: number; now_ms: number } | null;
  try {
    sampled = await Promise.race([
      env.DB.prepare(`SELECT 1 AS available,${clock} AS now_ms WHERE ${assertion.sql}`).bind(...assertion.bindings)
        .first<{ available: number; now_ms: number }>(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_read_attempt_unavailable")), localRemaining); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
  // Anchor the sampled DB remainder to the start of the whole round trip,
  // conservatively subtracting even time before the DB sampled its clock.
  // Consumers use this absolute cutoff; delayed continuation cannot rebase it.
  const monotonicDeadline = sampled && Number.isSafeInteger(sampled.now_ms)
    ? Math.min(state.monotonicDeadline, started + receipt.deadline_at_ms - sampled.now_ms) : 0;
  const remainingMs = Math.floor(monotonicDeadline - performance.now());
  if (!sampled || sampled.available !== 1 || remainingMs <= 0 || remainingMs > receipt.deadline_at_ms - receipt.admitted_at_ms)
    return fail("sponsor_read_attempt_unavailable");
  return freeze({ operation: receipt.operation, maximumBytes: receipt.maximum_bytes,
    deadlineAtMs: receipt.deadline_at_ms, chargedThroughMs: receipt.charged_through_ms, monotonicDeadline, remainingMs, assertion });
}
