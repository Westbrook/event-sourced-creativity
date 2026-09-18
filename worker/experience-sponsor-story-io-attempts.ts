import { freeze } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_STORY_IO_OPERATIONS, type SponsorStoryIoOperation } from "./experience-sponsor-story-io-policy.ts";
import { readApprovedSponsorStoryIoPolicy } from "./experience-sponsor-story-io-approval.ts";
import { requireSponsorStoryReadAuthority, type SponsorStoryReadAuthority } from "./experience-sponsor-story-read.ts";
import type { WorkerEnv } from "./runtime.ts";

type Assertion = Readonly<{ sql: string; bindings?: readonly (string | number | null)[]; deadlineMs?: number }>;
type Receipt = { attempt_id: string; campaign_id: string; sponsor_policy_digest: string; io_policy_digest: string;
  actor_user_id: string; job_id: string; operation: SponsorStoryIoOperation; maximum_bytes: number;
  admitted_at_ms: number; deadline_at_ms: number; charged_through_ms: number };
declare const attemptBrand: unique symbol;
export type SponsorStoryIoAttempt = Readonly<{ [attemptBrand]: true }>;
type AttemptState = { authority: SponsorStoryReadAuthority; request: Request; env: WorkerEnv; db: WorkerEnv["DB"];
  receipt: Readonly<Receipt>; assertions: readonly Assertion[]; monotonicDeadline: number; controlBytes: number; taken: boolean };
const attempts = new WeakMap<SponsorStoryIoAttempt, AttemptState>();
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail("sponsor_story_io_accounting_unavailable");
  return Number(value);
};
function ownDataFields(value: object, fields: readonly PropertyKey[]): boolean {
  return fields.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field?.enumerable === true && Object.hasOwn(field, "value");
  });
}
function acknowledged<T>(result: D1Result<T>[], expected: number): boolean {
  if (!Array.isArray(result) || result.length !== expected) return false;
  for (let index = 0; index < expected; index += 1) {
    const row = result[index];
    if (!Object.hasOwn(result, index) || !row || typeof row !== "object" || Array.isArray(row)
      || !ownDataFields(row, ["success", "results"]) || row.success !== true || !Array.isArray(row.results)) return false;
    for (let item = 0; item < row.results.length; item += 1) if (!Object.hasOwn(row.results, item)) return false;
  }
  return true;
}
function singleRow<T>(result: D1Result<T> | undefined, fields: readonly (keyof T)[]): T | undefined {
  if (!result || !ownDataFields(result, ["results"])) return undefined;
  const rows = result?.results;
  if (!Array.isArray(rows) || rows.length !== 1 || !Object.hasOwn(rows, 0)) return undefined;
  const row = rows[0];
  return row && typeof row === "object" && !Array.isArray(row) && ownDataFields(row, fields) ? row : undefined;
}

export class SponsorStoryIoLimitError extends SponsorEntitlementError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("sponsor_story_io_limit_reached"); this.retryAfterMs = retryAfterMs; }
}

/** Dormant selected-result IO receipts. A fresh actual request reserves its full
 * operation ceiling through deadline + window, even after denied disclosure,
 * cancellation or lost acknowledgement. No intent, refund or cleanup exists.
 * The assertion table is only an atomic transaction guard; importing installs
 * neither table and changes no generation or financial ledger. */
export const SPONSOR_STORY_IO_ATTEMPT_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_story_io_attempts(
    attempt_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    io_policy_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,job_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('short-story-status','short-story-result')),
    maximum_bytes INTEGER NOT NULL CHECK(typeof(maximum_bytes)='integer' AND maximum_bytes>0 AND maximum_bytes<=192000000),
    admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
    deadline_at_ms INTEGER NOT NULL CHECK(typeof(deadline_at_ms)='integer' AND deadline_at_ms>admitted_at_ms AND deadline_at_ms<=admitted_at_ms+30000),
    charged_through_ms INTEGER NOT NULL CHECK(typeof(charged_through_ms)='integer' AND charged_through_ms>deadline_at_ms AND charged_through_ms<=deadline_at_ms+31536000000),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_story_io_policies(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  `CREATE INDEX experience_sponsor_story_io_campaign_window ON experience_sponsor_story_io_attempts(campaign_id,charged_through_ms)`,
  `CREATE INDEX experience_sponsor_story_io_actor_window ON experience_sponsor_story_io_attempts(campaign_id,actor_user_id,charged_through_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_story_io_attempts_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_story_io_attempts BEGIN SELECT RAISE(ABORT,'sponsor_story_io_attempt_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_story_io_attempts_no_replace BEFORE INSERT ON experience_sponsor_story_io_attempts
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_story_io_attempts old WHERE old.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_story_io_attempt_exists'); END`,
  `CREATE TABLE experience_sponsor_story_io_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1)) WITHOUT ROWID`,
]);

function guardedStatements(db: WorkerEnv["DB"], assertions: readonly Assertion[]) {
  return assertions.flatMap(assertion => {
    const token = crypto.randomUUID();
    return [db.prepare(`INSERT INTO experience_sponsor_story_io_assertions(token,passed) VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`)
      .bind(token, ...(assertion.bindings ?? [])), db.prepare("DELETE FROM experience_sponsor_story_io_assertions WHERE token=?").bind(token)];
  });
}
const cloneAssertions = (assertions: readonly Assertion[]) => assertions.map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] }));

/** Only native opaque authority and a closed operation enter this boundary.
 * Separate CASE/CHECK witnesses share the debit's one atomic batch, so neither
 * FALSE nor NULL can bypass a proof and compound SQL depth is not accumulated. */
export async function reserveSponsorStoryIoAttempt(authority: SponsorStoryReadAuthority, request: Request, env: WorkerEnv,
  operation: SponsorStoryIoOperation): Promise<SponsorStoryIoAttempt> {
  if (!SPONSOR_STORY_IO_OPERATIONS.includes(operation)) return fail("sponsor_story_io_operation_invalid");
  const database = env.DB;
  let waitDeadline = performance.now() + 30_000;
  const unchanged = () => {
    if (env.DB !== database || request.signal.aborted) return fail("sponsor_story_io_authority_changed");
    return requireSponsorStoryReadAuthority(authority, request, env);
  };
  const checked = async <T>(work: () => Promise<T>): Promise<T> => {
    unchanged();
    const remaining = Math.floor(waitDeadline - performance.now());
    if (remaining <= 0) return fail("sponsor_story_io_attempt_unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        cancel = () => reject(new SponsorEntitlementError("sponsor_story_io_attempt_unavailable"));
        request.signal.addEventListener("abort", cancel, { once: true });
        if (request.signal.aborted) cancel();
        timer = setTimeout(cancel, remaining);
      })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (cancel) request.signal.removeEventListener("abort", cancel);
      unchanged();
    }
  };
  const native = unchanged();
  const approved = await checked(() => readApprovedSponsorStoryIoPolicy(env, native.campaignId, native.policyDigest));
  unchanged();
  const { policy } = approved, limit = policy.operations[operation];
  const assertions = freeze([...cloneAssertions(native.assertions), ...cloneAssertions(approved.assertions)]);
  const controlBytes = count(native.controlBytes) + count(approved.controlBytes), attemptId = crypto.randomUUID();
  const campaignWindow = `FROM experience_sponsor_story_io_attempts WHERE campaign_id=? AND charged_through_ms>${clock}`;
  const actorWindow = `FROM experience_sponsor_story_io_attempts WHERE campaign_id=? AND actor_user_id=? AND charged_through_ms>${clock}`;
  unchanged();
  const guards = guardedStatements(database, assertions), statements = [...guards,
    database.prepare(`INSERT INTO experience_sponsor_story_io_attempts(attempt_id,campaign_id,sponsor_policy_digest,io_policy_digest,
      actor_user_id,job_id,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms)
      SELECT ?,?,?,?,?,?,?,?,${clock},${clock}+?,${clock}+?+?
      WHERE (SELECT COUNT(*) ${campaignWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow})<=?-?
        AND (SELECT COUNT(*) ${actorWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow})<=?-?`)
      .bind(attemptId, native.campaignId, native.policyDigest, approved.ioPolicyDigest, native.actorUserId, native.jobId,
        operation, limit.maximumBytes, limit.deadlineMs, limit.deadlineMs, policy.windowMs,
        native.campaignId, policy.campaign.maximumRequestsPerWindow, native.campaignId, policy.campaign.maximumBytesPerWindow, limit.maximumBytes,
        native.campaignId, native.actorUserId, policy.actor.maximumRequestsPerWindow,
        native.campaignId, native.actorUserId, policy.actor.maximumBytesPerWindow, limit.maximumBytes),
    database.prepare(`SELECT attempt_id,campaign_id,sponsor_policy_digest,io_policy_digest,actor_user_id,job_id,operation,maximum_bytes,
      admitted_at_ms,deadline_at_ms,charged_through_ms FROM experience_sponsor_story_io_attempts WHERE attempt_id=?`).bind(attemptId),
  ];
  unchanged();
  const started = performance.now();
  waitDeadline = Math.min(waitDeadline, started + limit.deadlineMs);
  const result = await checked(() => database.batch<Receipt>(statements));
  unchanged();
  const receipt = singleRow(result?.[guards.length + 1], ["attempt_id", "campaign_id", "sponsor_policy_digest", "io_policy_digest",
    "actor_user_id", "job_id", "operation", "maximum_bytes", "admitted_at_ms", "deadline_at_ms", "charged_through_ms"]);
  const debit = result?.[guards.length], meta = debit && ownDataFields(debit, ["meta"]) ? debit.meta : undefined;
  if (!acknowledged(result, statements.length) || !meta || typeof meta !== "object" || Array.isArray(meta)
    || !ownDataFields(meta, ["changes"]) || meta.changes !== 1 || !receipt) {
    unchanged();
    const usage = await checked(() => database.prepare(`SELECT ${clock} AS now_ms,
      (SELECT COUNT(*) ${campaignWindow}) AS campaign_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow}) AS campaign_bytes,
      (SELECT COUNT(*) ${actorWindow}) AS actor_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow}) AS actor_bytes,
      (SELECT MAX(charged_through_ms) ${campaignWindow}) AS retry_at_ms`)
      .bind(native.campaignId, native.campaignId, native.campaignId, native.actorUserId,
        native.campaignId, native.actorUserId, native.campaignId)
      .first<{ now_ms: number; campaign_requests: number; campaign_bytes: number; actor_requests: number; actor_bytes: number; retry_at_ms: number | null }>());
    unchanged();
    if (usage && Number.isSafeInteger(usage.now_ms) && [usage.campaign_requests, usage.campaign_bytes, usage.actor_requests, usage.actor_bytes].every(Number.isSafeInteger)
      && (usage.campaign_requests >= policy.campaign.maximumRequestsPerWindow || usage.campaign_bytes > policy.campaign.maximumBytesPerWindow - limit.maximumBytes
        || usage.actor_requests >= policy.actor.maximumRequestsPerWindow || usage.actor_bytes > policy.actor.maximumBytesPerWindow - limit.maximumBytes))
      throw new SponsorStoryIoLimitError(Math.max(1, (usage.retry_at_ms ?? usage.now_ms + policy.windowMs) - usage.now_ms));
    return fail("sponsor_story_io_attempt_unavailable");
  }
  if (receipt.attempt_id !== attemptId || receipt.campaign_id !== native.campaignId || receipt.sponsor_policy_digest !== native.policyDigest
    || receipt.io_policy_digest !== approved.ioPolicyDigest || receipt.actor_user_id !== native.actorUserId || receipt.job_id !== native.jobId
    || receipt.operation !== operation || receipt.maximum_bytes !== limit.maximumBytes || !Number.isSafeInteger(receipt.admitted_at_ms)
    || receipt.deadline_at_ms !== receipt.admitted_at_ms + limit.deadlineMs || receipt.charged_through_ms !== receipt.deadline_at_ms + policy.windowMs
    || performance.now() >= waitDeadline) return fail("sponsor_story_io_attempt_unavailable");
  unchanged();
  const attempt = Object.freeze({}) as SponsorStoryIoAttempt;
  attempts.set(attempt, { authority, request, env, db: database, receipt: freeze({ ...receipt }), assertions,
    monotonicDeadline: waitDeadline, controlBytes: count(controlBytes + bytes(result)), taken: false });
  return attempt;
}

/** Consume before any asynchronous work or private-byte resolution. The exact
 * source-free IO review, current native lineage and immutable attempt are
 * returned separately for the caller's final same-transaction disclosure proof. */
export async function takeSponsorStoryIoAttempt(attempt: SponsorStoryIoAttempt, authority: SponsorStoryReadAuthority,
  request: Request, env: WorkerEnv) {
  const state = attempts.get(attempt);
  if (!state || state.taken || state.authority !== authority || state.request !== request || state.env !== env || state.db !== env.DB)
    return fail("sponsor_story_io_attempt_unavailable");
  state.taken = true;
  const unchanged = () => {
    if (state.request !== request || state.env !== env || state.db !== env.DB || request.signal.aborted) return fail("sponsor_story_io_attempt_unavailable");
    requireSponsorStoryReadAuthority(authority, request, env);
  };
  unchanged();
  const receipt = state.receipt;
  const assertions = freeze([...cloneAssertions(state.assertions), {
    sql: `EXISTS(SELECT 1 FROM experience_sponsor_story_io_attempts WHERE attempt_id=? AND campaign_id=? AND sponsor_policy_digest=?
      AND io_policy_digest=? AND actor_user_id=? AND job_id=? AND operation=? AND maximum_bytes=?
      AND admitted_at_ms=? AND deadline_at_ms=? AND charged_through_ms=? AND deadline_at_ms>${clock})`,
    bindings: [receipt.attempt_id, receipt.campaign_id, receipt.sponsor_policy_digest, receipt.io_policy_digest, receipt.actor_user_id,
      receipt.job_id, receipt.operation, receipt.maximum_bytes, receipt.admitted_at_ms, receipt.deadline_at_ms, receipt.charged_through_ms],
  }]);
  const started = performance.now(), remaining = Math.floor(state.monotonicDeadline - started);
  if (remaining <= 0) return fail("sponsor_story_io_attempt_unavailable");
  unchanged();
  const statements = [...assertions.map(assertion => state.db.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`)
    .bind(...assertion.bindings)), state.db.prepare(`SELECT ${clock} AS now_ms`)];
  unchanged();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  let result: D1Result<Record<string, unknown>>[];
  try {
    result = await Promise.race([state.db.batch<Record<string, unknown>>(statements), new Promise<never>((_, reject) => {
      cancel = () => reject(new SponsorEntitlementError("sponsor_story_io_attempt_unavailable"));
      request.signal.addEventListener("abort", cancel, { once: true });
      if (request.signal.aborted) cancel();
      timer = setTimeout(cancel, remaining);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) request.signal.removeEventListener("abort", cancel);
    unchanged();
  }
  unchanged();
  const sampled = singleRow(result?.[assertions.length], ["now_ms"])?.now_ms;
  if (!acknowledged(result, statements.length)
    || assertions.some((_, index) => singleRow(result[index], ["current"])?.current !== 1) || !Number.isSafeInteger(sampled))
    return fail("sponsor_story_io_attempt_unavailable");
  const monotonicDeadline = Math.min(state.monotonicDeadline, started + receipt.deadline_at_ms - Number(sampled));
  const remainingMs = Math.floor(monotonicDeadline - performance.now());
  if (remainingMs <= 0 || remainingMs > receipt.deadline_at_ms - receipt.admitted_at_ms) return fail("sponsor_story_io_attempt_unavailable");
  unchanged();
  return freeze({ operation: receipt.operation, maximumBytes: receipt.maximum_bytes, deadlineAtMs: receipt.deadline_at_ms,
    chargedThroughMs: receipt.charged_through_ms, monotonicDeadline, remainingMs, assertions,
    controlBytes: count(state.controlBytes + bytes(result)) });
}
