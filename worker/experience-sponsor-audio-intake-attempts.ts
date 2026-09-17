import { freeze } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_AUDIO_INTAKE_IO_OPERATIONS, type SponsorAudioIntakeIoOperation } from "./experience-sponsor-audio-intake-policy.ts";
import { readApprovedSponsorAudioIntakePolicy } from "./experience-sponsor-audio-intake-approval.ts";
import { captureSponsorAudioIntakeJson, requireSponsorAudioIntakeAuthority, type SponsorAudioIntakeAuthority } from "./experience-sponsor-audio-intake-reads.ts";
import type { WorkerEnv } from "./runtime.ts";

type Assertion = Readonly<{ sql: string; bindings?: readonly (string | number | null)[]; deadlineMs?: number }>;
type Receipt = {
  attempt_id: string; campaign_id: string; sponsor_policy_digest: string; intake_policy_digest: string;
  review_receipt_digest: string; payer_user_id: string; actor_user_id: string; session_digest: string; draft_id: string;
  operation: SponsorAudioIntakeIoOperation; maximum_bytes: number; admitted_at_ms: number; deadline_at_ms: number; charged_through_ms: number;
};
type Approved = Awaited<ReturnType<typeof readApprovedSponsorAudioIntakePolicy>>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = Record<string, Json>;
declare const attemptBrand: unique symbol;
export type SponsorAudioIntakeAttempt = Readonly<{ [attemptBrand]: true }>;
type AttemptState = {
  authority: SponsorAudioIntakeAuthority; request: Request; env: WorkerEnv; db: WorkerEnv["DB"];
  receipt: Readonly<Receipt>; approved: Approved; assertions: readonly Assertion[];
  current: () => void; sample: () => number; monotonicDeadline: number; controlBytes: number; taken: boolean;
};
const attempts = new WeakMap<SponsorAudioIntakeAttempt, AttemptState>();
const reservedRequests = new WeakSet<Request>();
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const fail = (code = "sponsor_audio_intake_attempt_unavailable"): never => { throw new SponsorEntitlementError(code); };
const bytes = (value: Json) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail("sponsor_audio_intake_accounting_unavailable");
  return Number(value);
};
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** Capture the complete ACK once, including metadata, before any field read.
 * The runtime copier charges exact escaped JSON UTF-8 against this remainder. */
function snapshot(value: unknown, maximumBytes: number): Json {
  return captureSponsorAudioIntakeJson(value, maximumBytes) as Json;
}
function object(value: Json | undefined): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value;
}
function acknowledgments(raw: unknown, expected: number, single = false, maximumBytes = 2_000_000): { entries: Row[]; controlBytes: number } {
  const data = snapshot(raw, maximumBytes);
  const results = single ? [data] : data;
  if (!Array.isArray(results) || results.length !== expected) return fail();
  const entries: Row[] = [];
  for (let index = 0; index < expected; index += 1) {
    const entry = object(results[index]);
    if (entry.success !== true || Object.hasOwn(entry, "error") || !Array.isArray(entry.results)) return fail();
    entries.push(entry);
  }
  return { entries, controlBytes: bytes(data) };
}
function singleRow(entry: Row, fields: readonly string[]): Row {
  const rows = entry.results;
  if (!Array.isArray(rows) || rows.length !== 1) return fail();
  const row = object(rows[0]);
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) return fail();
  return row;
}
const receiptFields = ["attempt_id", "campaign_id", "sponsor_policy_digest", "intake_policy_digest", "review_receipt_digest",
  "payer_user_id", "actor_user_id", "session_digest", "draft_id", "operation", "maximum_bytes", "admitted_at_ms", "deadline_at_ms", "charged_through_ms"] as const;
const cloneAssertions = (items: readonly Assertion[]) => items.map(item => ({ ...item, bindings: [...(item.bindings ?? [])] }));

export class SponsorAudioIntakeLimitError extends SponsorEntitlementError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("sponsor_audio_intake_io_limit_reached"); this.retryAfterMs = retryAfterMs; }
}

/** Dormant non-monetary IO reservations. Each actual request gets a fresh full
 * ceiling through deadline + window. Failure, cancellation and ambiguous ACKs
 * do not refund, recycle, delete or extend an original receipt. The assertion
 * table holds only same-transaction CHECK witnesses, never resource credit. */
export const SPONSOR_AUDIO_INTAKE_ATTEMPT_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_audio_intake_attempts(
    attempt_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    intake_policy_digest TEXT NOT NULL,review_receipt_digest TEXT NOT NULL,payer_user_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,draft_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('audio-intake-prepare','audio-intake-commit','audio-intake-draft','audio-intake-receipt')),
    maximum_bytes INTEGER NOT NULL CHECK(typeof(maximum_bytes)='integer' AND maximum_bytes>0 AND maximum_bytes<=192000000),
    admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
    deadline_at_ms INTEGER NOT NULL CHECK(typeof(deadline_at_ms)='integer' AND deadline_at_ms>admitted_at_ms AND deadline_at_ms<=admitted_at_ms+30000),
    charged_through_ms INTEGER NOT NULL CHECK(typeof(charged_through_ms)='integer' AND charged_through_ms>deadline_at_ms AND charged_through_ms<=deadline_at_ms+31536000000),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_audio_intake_policies(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  `CREATE INDEX experience_sponsor_audio_intake_attempt_campaign_window ON experience_sponsor_audio_intake_attempts(campaign_id,charged_through_ms)`,
  `CREATE INDEX experience_sponsor_audio_intake_attempt_actor_window ON experience_sponsor_audio_intake_attempts(campaign_id,actor_user_id,charged_through_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_audio_intake_attempts_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_audio_intake_attempts BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_attempt_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_audio_intake_attempts_no_replace BEFORE INSERT ON experience_sponsor_audio_intake_attempts
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_audio_intake_attempts old WHERE old.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_attempt_exists'); END`,
  `CREATE TABLE experience_sponsor_audio_intake_attempt_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1)) WITHOUT ROWID`,
]);

function guards(db: WorkerEnv["DB"], assertions: readonly Assertion[]) {
  return assertions.flatMap(assertion => {
    const token = crypto.randomUUID();
    return [db.prepare(`INSERT INTO main.experience_sponsor_audio_intake_attempt_assertions(token,passed) VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`)
      .bind(token, ...(assertion.bindings ?? [])), db.prepare("DELETE FROM main.experience_sponsor_audio_intake_attempt_assertions WHERE token=?").bind(token)];
  });
}

const schemaTables = ["experience_sponsor_audio_intake_attempts", "experience_sponsor_audio_intake_attempt_assertions"] as const;
const schemaDefinitions = SPONSOR_AUDIO_INTAKE_ATTEMPT_SCHEMA.map(sql => {
  const declaration = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z_]+)/u.exec(sql)!;
  const type = declaration[1]!.toLowerCase(), name = declaration[2]!;
  const table = type === "table" ? name : / ON ([a-z_]+)/u.exec(sql)![1]!;
  return { type, name, tbl_name: table, sql };
});
const boundedCatalogCell = (column: string, maximum: number) => `CASE WHEN typeof(${column})='text'
  AND length(CAST(${column} AS BLOB))<=${maximum} AND instr(${column},char(0))=0 THEN ${column} END AS ${column}`;

/** Exact owned schema is authority for the CHECK and immutable debit. Qualify
 * only the two source-free catalog identities, then carry every definition and
 * the complete object count into the same transaction as each later proof. */
async function schema(db: WorkerEnv["DB"], current: () => void, signal: AbortSignal, deadline: () => number, maximumBytes: number) {
  const raw = await wait(current, signal, deadline, () => db.prepare(`SELECT ${boundedCatalogCell("type", 16)},
    ${boundedCatalogCell("name", 200)},${boundedCatalogCell("tbl_name", 200)},${boundedCatalogCell("sql", 8192)}
    FROM main.sqlite_schema WHERE tbl_name IN (?,?) ORDER BY type,name LIMIT ?`)
    .bind(...schemaTables, schemaDefinitions.length + 1).all());
  current();
  const ack = acknowledgments(raw, 1, true, maximumBytes), rows = ack.entries[0]!.results;
  if (!Array.isArray(rows) || rows.length !== schemaDefinitions.length) return fail("sponsor_audio_intake_attempt_schema_unavailable");
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = object(rows[index]), expected = schemaDefinitions.find(item => item.name === row.name);
    if (Object.keys(row).length !== 4 || !expected || seen.has(expected.name)
      || row.type !== expected.type || row.tbl_name !== expected.tbl_name || row.sql !== expected.sql)
      return fail("sponsor_audio_intake_attempt_schema_unavailable");
    seen.add(expected.name);
  }
  const assertions: Assertion[] = [{
    sql: "(SELECT COUNT(*) FROM main.sqlite_schema WHERE tbl_name IN (?,?))=?",
    bindings: [...schemaTables, schemaDefinitions.length],
  }, ...schemaDefinitions.map(item => ({
    sql: "EXISTS(SELECT 1 FROM main.sqlite_schema WHERE type=? AND name=? AND tbl_name=? AND sql=?)",
    bindings: [item.type, item.name, item.tbl_name, item.sql],
  }))];
  current();
  return { assertions, controlBytes: ack.controlBytes };
}

/** Register cancellation before dispatch. All waits use a captured signal and
 * absolute cutoff; a late DB commit remains charged but cannot return a ticket. */
async function wait<T>(current: () => void, signal: AbortSignal, deadline: () => number, work: () => Promise<T>): Promise<T> {
  current();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => reject(new SponsorEntitlementError("sponsor_audio_intake_attempt_unavailable"));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    timer = setTimeout(cancel, Math.max(0, deadline() - performance.now()));
  });
  try {
    const value = await Promise.race([stopped, Promise.resolve().then(() => { current(); return work(); })]);
    current();
    return value;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal.removeEventListener("abort", cancel);
    current();
  }
}

export async function reserveSponsorAudioIntakeAttempt(authority: SponsorAudioIntakeAuthority, request: Request, env: WorkerEnv,
  operation: SponsorAudioIntakeIoOperation): Promise<SponsorAudioIntakeAttempt> {
  if (!SPONSOR_AUDIO_INTAKE_IO_OPERATIONS.includes(operation)) return fail("sponsor_audio_intake_operation_invalid");
  const database = env.DB, signal = request.signal, method = request.method, url = request.url;
  const headers = JSON.stringify([...request.headers]), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  let previous = performance.now();
  if (!Number.isFinite(previous) || previous < 0) return fail();
  let monotonicDeadline = previous + 30_000;
  const monotonic = () => {
    const now = performance.now();
    if (!Number.isFinite(now) || now < previous || !Number.isFinite(monotonicDeadline)) return fail();
    previous = now; return now;
  };
  const native = requireSponsorAudioIntakeAuthority(authority, request, env);
  if (native.operation !== operation) return fail("sponsor_audio_intake_operation_invalid");
  const selected = { actorUserId: native.actorUserId, campaignId: native.campaignId, sponsorPolicyDigest: native.sponsorPolicyDigest,
    payerUserId: native.payerUserId, sessionDigest: native.sessionDigest, draftId: native.draftId };
  const assertions = cloneAssertions(native.assertions), initialBytes = count(native.controlBytes);
  const current = () => {
    if (env.DB !== database || request.signal !== signal || signal.aborted || request.method !== method || request.url !== url
      || JSON.stringify([...request.headers]) !== headers || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
      || monotonic() >= monotonicDeadline) return fail("sponsor_audio_intake_authority_changed");
    const facts = requireSponsorAudioIntakeAuthority(authority, request, env);
    facts.current();
    if (facts.operation !== operation || Object.entries(selected).some(([key, value]) => facts[key as keyof typeof selected] !== value))
      return fail("sponsor_audio_intake_authority_changed");
  };
  current();
  // The real request may enter admission once. An explicit retry must carry a
  // new Request; failure or a lost ACK never restores this admission identity.
  if (reservedRequests.has(request)) return fail();
  reservedRequests.add(request);
  const approved = await wait(current, signal, () => monotonicDeadline, () => readApprovedSponsorAudioIntakePolicy(request, env,
    selected.campaignId, selected.sponsorPolicyDigest, { current, signal, monotonicDeadline }));
  current();
  if (approved.payerUserId !== selected.payerUserId) return fail("sponsor_audio_intake_payer_changed");
  const limits = approved.policy.io, limit = limits.operations[operation];
  let usedBytes = count(initialBytes + count(approved.controlBytes));
  const account = (amount: number) => {
    current();
    if (count(amount) > limit.maximumBytes - usedBytes) return fail("sponsor_audio_intake_accounting_unavailable");
    usedBytes = count(usedBytes + amount);
  };
  account(0);
  const supported = await schema(database, current, signal, () => monotonicDeadline, limit.maximumBytes - usedBytes);
  account(supported.controlBytes);
  current();
  const proof = freeze([...supported.assertions, ...assertions, ...cloneAssertions(approved.assertions)]);
  const attemptId = crypto.randomUUID();
  const campaignWindow = `FROM main.experience_sponsor_audio_intake_attempts WHERE campaign_id=? AND charged_through_ms>${clock}`;
  const actorWindow = `FROM main.experience_sponsor_audio_intake_attempts WHERE campaign_id=? AND actor_user_id=? AND charged_through_ms>${clock}`;
  // The CHECK cannot attest to its own integrity after a schema replacement.
  // Repeat only these shallow catalog predicates in the debit itself, so a
  // removed CHECK or an added IGNORE trigger cannot bypass a native witness.
  const schemaGate = supported.assertions.map(item => `(${item.sql})`).join(" AND ");
  current();
  const witnesses = guards(database, proof), statements = [...witnesses,
    database.prepare(`INSERT INTO main.experience_sponsor_audio_intake_attempts(${receiptFields.join(",")})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,${clock},${clock}+?,${clock}+?+?
      WHERE ${schemaGate}
        AND (SELECT COUNT(*) ${campaignWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow})<=?-?
        AND (SELECT COUNT(*) ${actorWindow})<? AND (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow})<=?-?`)
      .bind(attemptId, selected.campaignId, selected.sponsorPolicyDigest, approved.intakePolicyDigest, approved.reviewReceiptDigest,
        selected.payerUserId, selected.actorUserId, selected.sessionDigest, selected.draftId, operation, limit.maximumBytes,
        limit.deadlineMs, limit.deadlineMs, limits.windowMs,
        ...supported.assertions.flatMap(item => [...(item.bindings ?? [])]),
        selected.campaignId, limits.campaign.maximumRequestsPerWindow, selected.campaignId, limits.campaign.maximumBytesPerWindow, limit.maximumBytes,
        selected.campaignId, selected.actorUserId, limits.actor.maximumRequestsPerWindow,
        selected.campaignId, selected.actorUserId, limits.actor.maximumBytesPerWindow, limit.maximumBytes),
    database.prepare(`SELECT ${receiptFields.join(",")} FROM main.experience_sponsor_audio_intake_attempts WHERE attempt_id=? LIMIT 2`).bind(attemptId),
  ];
  current();
  monotonicDeadline = Math.min(monotonicDeadline, monotonic() + limit.deadlineMs);
  const raw = await wait(current, signal, () => monotonicDeadline, () => database.batch(statements));
  current();
  const ack = acknowledgments(raw, statements.length, false, limit.maximumBytes - usedBytes);
  account(ack.controlBytes);
  const debit = ack.entries[witnesses.length]!;
  for (let index = 0; index <= witnesses.length; index += 1) {
    const rows = ack.entries[index]!.results;
    if (!Array.isArray(rows) || rows.length !== 0) return fail();
  }
  const changes = object(debit.meta).changes;
  if (changes !== 1) {
    if (changes !== 0) return fail();
    const missingReceipt = ack.entries[witnesses.length + 1]!.results;
    if (!Array.isArray(missingReceipt) || missingReceipt.length !== 0) return fail();
    // A known zero-change debit may describe a cap refusal. Missing or malformed
    // acknowledgments never reach this diagnostic and never recover a ticket.
    const observed = await wait(current, signal, () => monotonicDeadline, () => database.prepare(`SELECT ${clock} AS now_ms,
      (SELECT COUNT(*) ${campaignWindow}) AS campaign_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${campaignWindow}) AS campaign_bytes,
      (SELECT COUNT(*) ${actorWindow}) AS actor_requests,
      (SELECT COALESCE(SUM(maximum_bytes),0) ${actorWindow}) AS actor_bytes,
      (SELECT MAX(charged_through_ms) ${campaignWindow}) AS retry_at_ms`)
      .bind(selected.campaignId, selected.campaignId, selected.campaignId, selected.actorUserId,
        selected.campaignId, selected.actorUserId, selected.campaignId).all());
    current();
    const usageAck = acknowledgments(observed, 1, true, limit.maximumBytes - usedBytes);
    account(usageAck.controlBytes);
    const usage = singleRow(usageAck.entries[0]!,
      ["now_ms", "campaign_requests", "campaign_bytes", "actor_requests", "actor_bytes", "retry_at_ms"]);
    const used = [usage.now_ms, usage.campaign_requests, usage.campaign_bytes, usage.actor_requests, usage.actor_bytes];
    if (!used.every(integer) || usage.retry_at_ms !== null && !integer(usage.retry_at_ms)) return fail();
    const now = Number(usage.now_ms), retry = usage.retry_at_ms === null ? now + limits.windowMs : Number(usage.retry_at_ms);
    current();
    if (Number(usage.campaign_requests) >= limits.campaign.maximumRequestsPerWindow
      || Number(usage.campaign_bytes) > limits.campaign.maximumBytesPerWindow - limit.maximumBytes
      || Number(usage.actor_requests) >= limits.actor.maximumRequestsPerWindow
      || Number(usage.actor_bytes) > limits.actor.maximumBytesPerWindow - limit.maximumBytes) {
      const retryAfterMs = Math.max(1, retry - now);
      if (!Number.isSafeInteger(retryAfterMs)) return fail();
      throw new SponsorAudioIntakeLimitError(retryAfterMs);
    }
    return fail();
  }
  const row = singleRow(ack.entries[witnesses.length + 1]!, receiptFields);
  if (row.attempt_id !== attemptId || row.campaign_id !== selected.campaignId || row.sponsor_policy_digest !== selected.sponsorPolicyDigest
    || row.intake_policy_digest !== approved.intakePolicyDigest || row.review_receipt_digest !== approved.reviewReceiptDigest
    || row.payer_user_id !== selected.payerUserId || row.actor_user_id !== selected.actorUserId || row.session_digest !== selected.sessionDigest
    || row.draft_id !== selected.draftId || row.operation !== operation || row.maximum_bytes !== limit.maximumBytes
    || !integer(row.admitted_at_ms) || !integer(row.deadline_at_ms) || !integer(row.charged_through_ms)
    || row.deadline_at_ms !== row.admitted_at_ms + limit.deadlineMs || row.charged_through_ms !== row.deadline_at_ms + limits.windowMs) return fail();
  const receipt: Readonly<Receipt> = freeze({ attempt_id: attemptId, campaign_id: selected.campaignId,
    sponsor_policy_digest: selected.sponsorPolicyDigest, intake_policy_digest: approved.intakePolicyDigest,
    review_receipt_digest: approved.reviewReceiptDigest, payer_user_id: selected.payerUserId, actor_user_id: selected.actorUserId,
    session_digest: selected.sessionDigest, draft_id: selected.draftId, operation, maximum_bytes: limit.maximumBytes,
    admitted_at_ms: row.admitted_at_ms, deadline_at_ms: row.deadline_at_ms, charged_through_ms: row.charged_through_ms });
  const ticket = Object.freeze({}) as SponsorAudioIntakeAttempt;
  const state: AttemptState = { authority, request, env, db: database, receipt, approved, assertions: proof, current, sample: monotonic,
    monotonicDeadline, controlBytes: usedBytes, taken: false };
  current();
  attempts.set(ticket, state);
  return ticket;
}

/** A genuine request ticket is consumed synchronously before any asynchronous
 * work. Separate complete scalar witnesses avoid compounding native SQL depth.
 * Database time can only shorten the original absolute monotonic deadline. */
export async function takeSponsorAudioIntakeAttempt(attempt: SponsorAudioIntakeAttempt, authority: SponsorAudioIntakeAuthority,
  request: Request, env: WorkerEnv) {
  const state = attempts.get(attempt);
  if (!state || state.taken || state.authority !== authority || state.request !== request || state.env !== env || state.db !== env.DB) return fail();
  state.taken = true;
  const current = () => {
    state.current();
    if (state.sample() >= state.monotonicDeadline) return fail();
  };
  current();
  const receipt = state.receipt, assertions = freeze([...cloneAssertions(state.assertions), {
    sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_audio_intake_attempts WHERE ${receiptFields.map(field => `${field}=?`).join(" AND ")}
      AND deadline_at_ms>${clock})`, bindings: receiptFields.map(field => receipt[field]),
  }]);
  const statements = [...assertions.map(assertion => state.db.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`)
    .bind(...(assertion.bindings ?? []))), state.db.prepare(`SELECT ${clock} AS now_ms`)];
  const started = state.sample();
  current();
  const raw = await wait(current, request.signal, () => state.monotonicDeadline, () => state.db.batch(statements));
  current();
  const ack = acknowledgments(raw, statements.length, false, state.receipt.maximum_bytes - state.controlBytes);
  state.controlBytes = count(state.controlBytes + ack.controlBytes);
  for (let index = 0; index < assertions.length; index += 1) if (singleRow(ack.entries[index]!, ["current"]).current !== 1) return fail();
  const sampled = singleRow(ack.entries[assertions.length]!, ["now_ms"]).now_ms;
  if (!integer(sampled)) return fail();
  state.monotonicDeadline = Math.min(state.monotonicDeadline, started + receipt.deadline_at_ms - sampled);
  const remainingMs = Math.floor(state.monotonicDeadline - state.sample());
  if (remainingMs <= 0 || remainingMs > receipt.deadline_at_ms - receipt.admitted_at_ms) return fail();
  const result = freeze({ operation: receipt.operation, maximumBytes: receipt.maximum_bytes, deadlineAtMs: receipt.deadline_at_ms,
    chargedThroughMs: receipt.charged_through_ms, monotonicDeadline: state.monotonicDeadline, remainingMs, assertions,
    controlBytes: state.controlBytes, policy: state.approved.policy,
    intakePolicyDigest: state.approved.intakePolicyDigest, reviewReceiptDigest: state.approved.reviewReceiptDigest,
    approvalId: state.approved.approvalId, originalApprovalId: state.approved.originalApprovalId, payerUserId: receipt.payer_user_id });
  current();
  return result;
}
