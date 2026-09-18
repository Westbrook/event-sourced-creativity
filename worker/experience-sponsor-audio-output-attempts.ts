import { exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { isDraftId } from "../src/experiences/intake.ts";
import { sponsorPrincipalDigest } from "./experience-sponsor-admission.ts";
import { captureSponsorAudioJson, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS, type SponsorAudioOutputReadOperation, type SponsorAudioOutputReadOperationLimit } from "./experience-sponsor-audio-output-policy.ts";
import { captureSponsorAudioOutputAbort, createSponsorAudioOutputReadBoundary, readApprovedSponsorAudioOutputReadPolicy, readSponsorAudioOutputPrincipal,
  qualifySponsorAudioOutputReadAssertionSink, type SponsorAudioOutputReadLimits } from "./experience-sponsor-audio-output-approval.ts";
import { readApprovedSponsorAudioIntakePolicy, SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA } from "./experience-sponsor-audio-intake-approval.ts";
import { SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA } from "./experience-sponsor-audio-intake-policy.ts";
import { readStoredSponsorAudioIntake, sponsorAudioIntakeReceiptLookup, SPONSOR_AUDIO_INTAKE_RECEIPT_COLUMNS,
  SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA, type SponsorAudioIntakeReceipt } from "./experience-sponsor-audio-intake-resources.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

type Binding = string | number | null;
type Usage = { bytes: number; queries: number; rows: number };
type Selector = { operation: SponsorAudioOutputReadOperation; draftId: string };
type Principal = Awaited<ReturnType<typeof readSponsorAudioOutputPrincipal>>;
type Approved = Awaited<ReturnType<typeof readApprovedSponsorAudioOutputReadPolicy>>;
type Assertion = Readonly<{ sql: string; bindings: readonly Binding[] }>;
type Receipt = { attempt_id: string; campaign_id: string; sponsor_policy_digest: string; read_policy_digest: string;
  actor_user_id: string; session_digest: string; draft_id: string; operation: SponsorAudioOutputReadOperation;
  maximum_bytes: number; maximum_queries: number; maximum_rows: number;
  admitted_at_ms: number; deadline_at_ms: number; charged_through_ms: number };
declare const attemptBrand: unique symbol;
declare const budgetBrand: unique symbol;
/** Non-serializable resource debit only. Neither brand grants creative custody. */
export type SponsorAudioOutputReadAttempt = Readonly<{ [attemptBrand]: true }>;
export type SponsorAudioOutputReadBudget = Readonly<{ [budgetBrand]: true }>;
const attempts = new WeakMap<SponsorAudioOutputReadAttempt, Attempt>();
const budgets = new WeakMap<SponsorAudioOutputReadBudget, Attempt>();
const requests = new WeakSet<Request>();
const encoder = new TextEncoder();
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const table = "experience_sponsor_audio_output_read_attempts";
const columns = ["attempt_id", "campaign_id", "sponsor_policy_digest", "read_policy_digest", "actor_user_id", "session_digest", "draft_id", "operation",
  "maximum_bytes", "maximum_queries", "maximum_rows", "admitted_at_ms", "deadline_at_ms", "charged_through_ms"] as const;
const failure = (code = "sponsor_audio_output_read_attempt_unavailable"): never => { throw new SponsorEntitlementError(code); };
const scalar = (value: unknown): value is Binding => value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const bytes = (value: string) => encoder.encode(value).byteLength;
const proof = (value: OutputSqlAssertion): Assertion => freeze({ sql: value.sql, bindings: [...value.bindings ?? []] });
const pathFor = (selected: Selector) => selected.operation === "audio-output-review"
  ? `/api/experiences/sponsor/audio/drafts/${selected.draftId}/review`
  : `/api/experiences/drafts/${selected.draftId}/output${selected.operation === "audio-output-state" ? "" : selected.operation === "audio-output-prepare" ? "/prepare" : "/authorize"}`;
function selector(request: Request, raw: unknown): Readonly<Selector> {
  raw = captureSponsorAudioJson(raw);
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["operation", "draftId"])
    || !SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS.includes(raw.operation as SponsorAudioOutputReadOperation)
    || typeof raw.draftId !== "string" || !isDraftId(raw.draftId) || request.bodyUsed) return failure();
  const selected = { operation: raw.operation as SponsorAudioOutputReadOperation, draftId: raw.draftId };
  const url = new URL(request.url), method = selected.operation === "audio-output-state" || selected.operation === "audio-output-review" ? "GET" : "POST";
  if (request.method !== method || url.pathname !== pathFor(selected) || url.search || url.hash) return failure();
  return freeze(selected);
}

/** Immutable full-ceiling resource reservations, never financial holds. Every
 * actual request has a fresh identity; failures and unknown ACKs retain their
 * whole charge through deadline + window. There is no refund or replay credit.
 * Dormant declarations only: importing this module installs nothing. */
export const SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA = Object.freeze([
  `CREATE TABLE ${table}(
    attempt_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    read_policy_digest TEXT NOT NULL,actor_user_id TEXT NOT NULL,session_digest TEXT NOT NULL,draft_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN('audio-output-state','audio-output-prepare','audio-output-review','audio-output-authorize')),
    maximum_bytes INTEGER NOT NULL CHECK(typeof(maximum_bytes)='integer' AND maximum_bytes BETWEEN 1 AND 192000000),
    maximum_queries INTEGER NOT NULL CHECK(typeof(maximum_queries)='integer' AND maximum_queries BETWEEN 1 AND 100000),
    maximum_rows INTEGER NOT NULL CHECK(typeof(maximum_rows)='integer' AND maximum_rows BETWEEN 1 AND 1000000),
    admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
    deadline_at_ms INTEGER NOT NULL CHECK(typeof(deadline_at_ms)='integer' AND deadline_at_ms>admitted_at_ms AND deadline_at_ms<=admitted_at_ms+30000),
    charged_through_ms INTEGER NOT NULL CHECK(typeof(charged_through_ms)='integer' AND charged_through_ms>deadline_at_ms AND charged_through_ms<=deadline_at_ms+31536000000),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_audio_output_read_policies(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  `CREATE INDEX experience_sponsor_audio_output_read_campaign_window ON ${table}(campaign_id,charged_through_ms)`,
  `CREATE INDEX experience_sponsor_audio_output_read_actor_window ON ${table}(campaign_id,actor_user_id,charged_through_ms)`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table}
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_attempt_immutable'); END`),
  `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
    WHEN EXISTS(SELECT 1 FROM main.${table} old WHERE old.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_attempt_exists'); END`,
]);
const schemaObjects = (statements: readonly string[]) => statements.map(sql => {
  const found = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql);
  if (!found) return failure();
  return [found[1]!.toLowerCase(), found[2]!, sql];
}).sort((a, b) => a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0);
const objects = schemaObjects(SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA), snapshot = JSON.stringify(objects);
const schemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name='${table}' AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${objects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${objects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
const schemaProof = (): Assertion => ({ sql: `EXISTS(SELECT 1 FROM (${schemaQuery}) WHERE snapshot=?)`, bindings: [snapshot] });

function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return failure("sponsor_audio_output_read_acknowledgement_missing");
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (!property || !property.enumerable || !Object.hasOwn(property, "value")) return failure("sponsor_audio_output_read_acknowledgement_missing");
  return property.value;
}
/** Inspect dense own data without invoking getters/toJSON, then charge exact
 * UTF-8 JSON bytes. This is for complete native ACKs and server responses only. */
function captureJson(value: unknown, maximum: number): { value: unknown; bytes: number } {
  let total = 0, nodes = 0;
  const seen = new Set<object>();
  const charge = (amount: number) => { total += amount; if (!integer(total) || total > maximum) return failure("sponsor_audio_output_read_byte_limit"); };
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 262144 || depth > 24) return failure("sponsor_audio_output_read_acknowledgement_missing");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) { charge(bytes(JSON.stringify(item))); return item; }
    if (typeof item === "string") {
      if (!item.isWellFormed() || item.length > maximum) return failure("sponsor_audio_output_read_byte_limit");
      charge(bytes(JSON.stringify(item))); return item;
    }
    if (!item || typeof item !== "object" || !Array.isArray(item) && !record(item) || seen.has(item)) return failure("sponsor_audio_output_read_acknowledgement_missing");
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 1000000 || Reflect.ownKeys(item).length !== item.length + 1) return failure("sponsor_audio_output_read_acknowledgement_missing");
      charge(2 + Math.max(0, item.length - 1));
      const copied: unknown[] = []; for (let index = 0; index < item.length; index++) copied.push(visit(own(item, String(index)), depth + 1));
      seen.delete(item); return copied;
    }
    const keys = Reflect.ownKeys(item); if (keys.length > 128 || keys.some(key => typeof key !== "string")) return failure("sponsor_audio_output_read_acknowledgement_missing");
    charge(2 + Math.max(0, keys.length - 1));
    const copied: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) { charge(bytes(JSON.stringify(key)) + 1); copied[key] = visit(own(item, key), depth + 1); }
    seen.delete(item); return copied;
  };
  return { value: visit(value, 0), bytes: total };
}
function acknowledgements(value: unknown, count: number, maximum: number) {
  const captured = captureJson(value, maximum), list = captured.value;
  if (!Array.isArray(list) || list.length !== count) return failure("sponsor_audio_output_read_acknowledgement_missing");
  let rows = 0;
  for (const item of list) {
    if (!record(item) || item.success !== true || Object.hasOwn(item, "error") || !Array.isArray(item.results)) return failure("sponsor_audio_output_read_acknowledgement_missing");
    rows += Math.max(1, item.results.length);
  }
  return { list: list as Record<string, unknown>[], bytes: captured.bytes, rows };
}
function lifecycle(request: Request, env: WorkerEnv) {
  const database = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  const cancellation = captureSponsorAudioOutputAbort(request), signal = cancellation.signal;
  const method = request.method, url = request.url, headers = JSON.stringify([...request.headers]);
  const started = performance.now(); let deadline = started + 30000, closed = false, bootstrap = true;
  let limit: SponsorAudioOutputReadOperationLimit | undefined;
  const used: Usage = { bytes: bytes(headers), queries: 0, rows: 0 };
  if (used.bytes > 32768) return failure("sponsor_audio_output_read_control_limit");
  const check = () => {
    try {
      cancellation.current();
      if (closed || env.DB !== database || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
        || request.method !== method || request.url !== url || request.signal !== signal
        || JSON.stringify([...request.headers]) !== headers || performance.now() >= deadline)
        return failure("sponsor_audio_output_read_authority_changed");
    } catch (error) { closed = true; throw error; }
  };
  const ceilings = (): Usage => ({ bytes: Math.min(limit?.maximumBytes ?? Infinity, bootstrap ? 4194304 : Infinity),
    queries: Math.min(limit?.maximumQueries ?? Infinity, bootstrap ? 1024 : Infinity), rows: Math.min(limit?.maximumRows ?? Infinity, bootstrap ? 65536 : Infinity) });
  const remaining = (): Usage => {
    check(); const maximum = ceilings(), result = { bytes: maximum.bytes - used.bytes, queries: maximum.queries - used.queries, rows: maximum.rows - used.rows };
    if (Object.values(result).some(value => !integer(value))) { closed = true; return failure("sponsor_audio_output_read_limit_reached"); }
    return result;
  };
  const account = (usage: Usage) => {
    check();
    if (jsonIssues(usage).length || !record(usage) || !exactKeys(usage, ["bytes", "queries", "rows"]) || !Object.values(usage).every(integer)) { closed = true; return failure("sponsor_audio_output_read_accounting_invalid"); }
    for (const key of ["bytes", "queries", "rows"] as const) used[key] += usage[key];
    remaining();
  };
  const wait = async <T>(work: () => Promise<T>): Promise<T> => {
    check(); let timer: ReturnType<typeof setTimeout> | undefined, cleanup: (() => void) | undefined;
    try {
      const stopped = new Promise<never>((_, reject) => {
        const cancel = () => { closed = true; reject(new SponsorEntitlementError("sponsor_audio_output_read_authority_changed")); };
        cleanup = cancellation.listen(cancel);
        timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
      });
      const result = await Promise.race([stopped, Promise.resolve().then(() => { check(); return work(); })]); check(); return result;
    } finally { if (timer !== undefined) clearTimeout(timer); cleanup?.(); check(); }
  };
  const narrow = (selected: SponsorAudioOutputReadOperationLimit) => { check(); limit = selected; deadline = Math.min(deadline, started + selected.deadlineMs); remaining(); };
  const narrowDeadline = (value: number) => { if (!Number.isFinite(value)) return failure(); deadline = Math.min(deadline, value); check(); };
  const active = () => { check(); if (!limit) return failure(); bootstrap = false; remaining(); };
  return { database, signal, check, wait, account, remaining, narrow, narrowDeadline, active,
    retire() { closed = true; }, get used() { check(); return { ...used }; }, get deadline() { check(); return deadline; } };
}
type Life = ReturnType<typeof lifecycle>;
const ownerCurrent = (life: Life, principal: Principal) => () => {
  try { life.check(); principal.assertCurrent(); } catch (error) { life.retire(); throw error; }
};
type Attempt = { request: Request; env: WorkerEnv; life: Life; selected: Readonly<Selector>; principal: Principal;
  original: SponsorAudioIntakeReceipt; approved: Approved; receipt: Readonly<Receipt>; assertions: readonly Assertion[]; taken: boolean };
const limitsFor = (life: Life, current: () => void): SponsorAudioOutputReadLimits => ({ current,
  monotonicDeadline: life.deadline, signal: life.signal, sharedControl: { remaining: life.remaining, account: life.account } });

// Exact positive Audio A descriptors. Their own local 4MiB counters do not
// become fresh allowances: only the shared transport's actual ACKs are debited.
// No missing-original fallback, SQL prefix matching or arbitrary statement runs.
// Positive sequence copied from accepted Audio A: intake-resources.ts schema +
// sponsorAudioIntakeReceiptLookup; intake-approval.ts retained reader schema +
// retained policy/approval join + original approval. All use maximum=1 despite
// their native LIMIT 2 duplicate sentinel. The old files remain unchanged.
type Descriptor = { sql: string; bindings: readonly Binding[]; fields: readonly string[] };
function existingSchemaQuery(statements: readonly string[], names: readonly string[], storage: boolean) {
  const selected = schemaObjects(statements);
  return `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema${storage ? " WHERE" : "\n    WHERE"} tbl_name IN(${names.map(name => `'${name}'`).join(",")}) AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${selected.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${selected.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
}
async function provenance<T>(request: Request, env: WorkerEnv, life: Life, current: () => void,
  expected: readonly Descriptor[], work: (nativeEnv: WorkerEnv, limits: SponsorAudioOutputReadLimits) => Promise<T>): Promise<T> {
  const limits = limitsFor(life, current), bounded = createSponsorAudioOutputReadBoundary(request, env, limits);
  let next = 0;
  const deny = (): never => failure("sponsor_audio_output_read_control_query_invalid");
  const database = new Proxy(life.database, { get(_target, key) {
    if (key !== "prepare") return deny();
    return (sql: string) => {
      current(); const descriptor = expected[next]; if (!descriptor || sql !== descriptor.sql) return deny();
      const statement = life.database.prepare(sql); let bound = false, used = false;
      const view = new Proxy(statement, { get(_statement, method) {
        if (method === "bind") return (...bindings: unknown[]) => {
          current(); if (bound || used || bindings.length !== descriptor.bindings.length
            || bindings.some((value, index) => !Object.is(value, descriptor.bindings[index]))) return deny();
          bound = true; return view;
        };
        if (method === "all") return async () => {
          current(); if (!bound || used || expected[next] !== descriptor) return deny(); used = true; next++;
          const rows = await life.wait(() => bounded.query<Record<string, Binding>>(descriptor.sql, descriptor.bindings, descriptor.fields)); current();
          return { success: true, results: rows, meta: { changes: 0 } };
        };
        return deny();
      } });
      // The returned object remains a view of the genuine native statement.
      // Its only execution method delegates to the closed bounded descriptor.
      return view;
    };
  } });
  const nativeEnv = Object.create(env) as WorkerEnv;
  Object.defineProperty(nativeEnv, "DB", { value: database, enumerable: true });
  const result = await life.wait(() => work(nativeEnv, limits)); current();
  if (next !== expected.length) return deny(); return result;
}
const boundedText = (column: string, maximum: number) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} AND instr(${column},char(0))=0 THEN ${column} END`;
const intakeRetainedFrom = `FROM main.experience_sponsor_audio_intake_policies policy
  JOIN main.experience_sponsor_audio_intake_approvals approval ON approval.campaign_id=policy.campaign_id
    AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.intake_policy_digest=policy.intake_policy_digest
    AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
  JOIN main.experience_sponsor_approvals original ON original.approval_id=approval.original_approval_id
    AND original.campaign_id=policy.campaign_id AND original.policy_digest=policy.sponsor_policy_digest
    AND original.payer_user_id=approval.payer_user_id AND original.approved_by_user_id=original.payer_user_id`;
function intakeApprovalDescriptors(original: SponsorAudioIntakeReceipt, originalApprovalId: string): Descriptor[] {
  const projections = [["policy.campaign_id", "campaign_id", 200], ["policy.sponsor_policy_digest", "sponsor_policy_digest", 71],
    ["policy.intake_policy_digest", "intake_policy_digest", 71], ["policy.policy_json", "policy_json", 8192],
    ["policy.review_receipt_digest", "review_receipt_digest", 71], ["approval.approval_id", "approval_id", 200],
    ["approval.original_approval_id", "original_approval_id", 200], ["approval.payer_user_id", "payer_user_id", 200],
    ["approval.terms_json", "terms_json", 16384], ["approval.terms_digest", "terms_digest", 71],
    ["approval.review_receipt_json", "review_receipt_json", 262144], ["approval.approval_command_json", "approval_command_json", 32768]] as const;
  const originals = [["approval_id", 200], ["campaign_id", 200], ["payer_user_id", 200], ["terms_json", 131072], ["terms_digest", 71],
    ["policy_digest", 71], ["policy_json", 262144], ["payer_authority_json", 131072], ["approval_command_json", 131072]] as const;
  return [{ sql: existingSchemaQuery([...SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA, ...SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA],
    ["experience_sponsor_audio_intake_policies", "experience_sponsor_audio_intake_approvals"], false), bindings: [], fields: ["snapshot"] },
  { sql: `SELECT ${projections.map(([column, alias, cap]) => `${boundedText(column, cap)} AS ${alias}`).join(",")} ${intakeRetainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? LIMIT 2`, bindings: [original.campaignId, original.sponsorPolicyDigest], fields: projections.map(field => field[1]) },
  { sql: `SELECT ${originals.map(([column, cap]) => `${boundedText(`approval.${column}`, cap)} AS ${column}`).join(",")}
    FROM main.experience_sponsor_approvals approval WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.policy_digest=? LIMIT 2`,
    bindings: [originalApprovalId, original.campaignId, original.sponsorPolicyDigest], fields: originals.map(field => field[0]) }];
}

function joined(assertions: readonly Assertion[]): Assertion {
  let prefix = "audio_output_attempt_gate"; while (assertions.some(item => item.sql.toLowerCase().includes(prefix))) prefix += "_";
  return { sql: `EXISTS(WITH ${assertions.map((item, i) => `${prefix}_${i} AS MATERIALIZED(SELECT 1 WHERE ${item.sql})`).join(",")}
    SELECT 1 FROM ${assertions.map((_, i) => `${prefix}_${i}`).join(" CROSS JOIN ")})`, bindings: assertions.flatMap(item => [...item.bindings]) };
}
function receiptProof(receipt: Readonly<Receipt>): Assertion {
  return { sql: `EXISTS(SELECT 1 FROM main.${table} WHERE attempt_id=? AND json_array(${columns.join(",")})=? AND deadline_at_ms>${clock})`,
    bindings: [receipt.attempt_id, JSON.stringify(columns.map(column => receipt[column]))] };
}
function guardStatements(database: WorkerEnv["DB"], assertions: readonly Assertion[]) {
  return assertions.flatMap(assertion => {
    const token = crypto.randomUUID(), packed = packSponsorIntakeReadQuery(`INSERT INTO main.output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`, [token, ...assertion.bindings]);
    return [database.prepare(packed.sql).bind(...packed.bindings), database.prepare("DELETE FROM main.output_atomic_assertions WHERE token=?").bind(token)];
  });
}
function nativeReceipt(value: unknown, fields: readonly string[]): Record<string, Binding> {
  if (!record(value) || !exactKeys(value, fields) || fields.some(field => !scalar(value[field]))) return failure();
  return value as Record<string, Binding>;
}
async function debitBatch(life: Life, current: () => void, statements: D1PreparedStatement[]) {
  current(); const room = life.remaining();
  if (!statements.length || statements.length > room.queries || statements.length > room.rows || room.bytes < statements.length * 4096)
    return failure("sponsor_audio_output_read_limit_reached");
  life.account({ bytes: 0, queries: statements.length, rows: 0 });
  const raw = await life.wait(() => life.database.batch(statements)); current();
  const ack = acknowledgements(raw, statements.length, room.bytes);
  life.account({ bytes: ack.bytes, queries: 0, rows: ack.rows }); current(); return ack.list;
}

/** Reserve bounded control work using the actual request/principal and exact
 * paired immutable Audio A provenance. No draft, event, native receipt, quote,
 * financial ledger, generation, append, media or provider authority is minted. */
export async function reserveSponsorAudioOutputReadAttempt(request: Request, env: WorkerEnv, raw: Selector): Promise<SponsorAudioOutputReadAttempt> {
  const selected = selector(request, raw);
  if (requests.has(request)) return failure(); requests.add(request);
  const life = lifecycle(request, env);
  try {
    const principal = await life.wait(() => readSponsorAudioOutputPrincipal(request, env, limitsFor(life, life.check)));
    const current = ownerCurrent(life, principal);
    current(); const sessionDigest = await life.wait(() => sponsorPrincipalDigest(principal.principal)); current();
    const lookup = sponsorAudioIntakeReceiptLookup(selected.draftId);
    const stored = await provenance(request, env, life, current, [
      { sql: existingSchemaQuery(SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA, ["experience_sponsor_audio_intake_allocations", "experience_sponsor_audio_intakes"], true), bindings: [], fields: ["snapshot"] },
      { ...lookup, fields: SPONSOR_AUDIO_INTAKE_RECEIPT_COLUMNS },
    ], (nativeEnv, limits) => readStoredSponsorAudioIntake(request, nativeEnv, { draftId: selected.draftId, actorUserId: principal.principal.userId }, limits)); current();
    const original = stored.receipt;
    if (!original || original.sessionDigest !== sessionDigest) return failure();
    const approved = await life.wait(() => readApprovedSponsorAudioOutputReadPolicy(request, env, original.campaignId, original.sponsorPolicyDigest, limitsFor(life, current))); current();
    const limit = approved.policy.operations[selected.operation]; life.narrow(limit); current();
    const intake = await provenance(request, env, life, current, intakeApprovalDescriptors(original, approved.originalApprovalId),
      (nativeEnv, limits) => readApprovedSponsorAudioIntakePolicy(request, nativeEnv, original.campaignId, original.sponsorPolicyDigest, limits)); current();
    if (intake.approvalId !== original.intakeApprovalId || intake.intakePolicyDigest !== original.intakePolicyDigest
      || intake.originalApprovalId !== approved.originalApprovalId || intake.payerUserId !== approved.payerUserId) return failure();
    const limits = limitsFor(life, current), bound = createSponsorAudioOutputReadBoundary(request, env, limits);
    const schema = await life.wait(() => bound.query<{ snapshot: string }>(schemaQuery, [], ["snapshot"])); current();
    if (schema.length !== 1 || schema[0]!.snapshot !== snapshot) return failure("sponsor_audio_output_read_attempt_schema_unavailable");
    const sink = await life.wait(() => qualifySponsorAudioOutputReadAssertionSink(request, env, limits)); current();
    const validity: Assertion = { sql: `${clock}>=? AND ${clock}<?`, bindings: [approved.policy.startsAtMs, approved.policy.expiresAtMs] };
    const assertions = freeze([...principal.assertions.map(proof), ...stored.assertions.map(proof), ...intake.assertions.map(proof),
      ...approved.assertions.map(proof), schemaProof(), proof(sink.assertion), validity]);
    const attemptId = crypto.randomUUID(), before = guardStatements(life.database, assertions), after = guardStatements(life.database, assertions);
    const quotaSql: string[] = [], quotaBindings: Binding[] = [];
    for (const scope of ["campaign", "actor"] as const) {
      const allowance = approved.policy[scope], where = `FROM main.${table} WHERE campaign_id=?${scope === "actor" ? " AND actor_user_id=?" : ""} AND charged_through_ms>${clock}`;
      for (const [column, maximum, wanted] of [["*", allowance.maximumRequestsPerWindow, 1], ["maximum_bytes", allowance.maximumBytesPerWindow, limit.maximumBytes],
        ["maximum_queries", allowance.maximumQueriesPerWindow, limit.maximumQueries], ["maximum_rows", allowance.maximumRowsPerWindow, limit.maximumRows]] as const) {
        quotaSql.push(`(SELECT ${column === "*" ? "COUNT(*)" : `COALESCE(SUM(${column}),0)`} ${where})<=?-?`);
        quotaBindings.push(original.campaignId, ...(scope === "actor" ? [original.actorUserId] : []), maximum, wanted);
      }
    }
    const insert = packSponsorIntakeReadQuery(`INSERT INTO main.${table}(${columns.join(",")})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,${clock},MIN(${clock}+?,?),MIN(${clock}+?,?)+? WHERE ${quotaSql.join(" AND ")}`,
    [attemptId, original.campaignId, original.sponsorPolicyDigest, approved.readPolicyDigest, original.actorUserId, sessionDigest, original.draftId,
      selected.operation, limit.maximumBytes, limit.maximumQueries, limit.maximumRows, limit.deadlineMs, approved.policy.expiresAtMs,
      limit.deadlineMs, approved.policy.expiresAtMs, approved.policy.windowMs, ...quotaBindings]);
    // The PK and exact schema bound this to one source-free metadata row.
    const sample = life.database.prepare(`SELECT ${columns.join(",")} FROM main.${table} WHERE attempt_id=?
      AND ${columns.slice(0, 8).map(column => `typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=200`).join(" AND ")}
      AND ${columns.slice(8).map(column => `typeof(${column})='integer' AND ${column} BETWEEN 0 AND 8031536000000`).join(" AND ")} LIMIT 2`).bind(attemptId);
    const statements = [...before, life.database.prepare(insert.sql).bind(...insert.bindings), ...after, sample];
    const started = performance.now(), result = await debitBatch(life, current, statements); current();
    const mutation = result[before.length], metadata = mutation && own(mutation, "meta");
    if (!record(metadata) || own(metadata, "changes") !== 1 || (mutation!.results as unknown[]).length !== 0
      || result.slice(0, before.length).some(item => (item.results as unknown[]).length !== 0)
      || result.slice(before.length + 1, -1).some(item => (item.results as unknown[]).length !== 0)) return failure();
    const rows = result.at(-1)!.results;
    if (!Array.isArray(rows) || rows.length !== 1) return failure();
    const observed = nativeReceipt(rows[0], columns), receipt = observed as Receipt;
    if (columns.slice(0, 11).some((column, i) => receipt[column] !== [attemptId, original.campaignId, original.sponsorPolicyDigest, approved.readPolicyDigest,
      original.actorUserId, sessionDigest, original.draftId, selected.operation, limit.maximumBytes, limit.maximumQueries, limit.maximumRows][i])
      || !integer(receipt.admitted_at_ms) || !integer(receipt.deadline_at_ms) || !integer(receipt.charged_through_ms)
      || receipt.deadline_at_ms !== Math.min(receipt.admitted_at_ms + limit.deadlineMs, approved.policy.expiresAtMs)
      || receipt.deadline_at_ms <= receipt.admitted_at_ms || receipt.charged_through_ms !== receipt.deadline_at_ms + approved.policy.windowMs) return failure();
    life.narrowDeadline(started + receipt.deadline_at_ms - receipt.admitted_at_ms); current();
    const attempt = Object.freeze({}) as SponsorAudioOutputReadAttempt;
    attempts.set(attempt, { request, env, life, selected, principal, original, approved, receipt: freeze(receipt), assertions, taken: false });
    current(); return attempt;
  } catch (error) { life.retire(); throw error; }
}

/** Mark taken before the first await. The resulting budget adopts the SAME
 * original counter and lifetime; it is not a native custody/receipt capability.
 * Reserve and take precede body consumption. After take, currentness intentionally
 * permits the same actual Request body to be consumed by a future native owner;
 * that owner must meter/capture the real command and add its own custody proof.
 * No existing handler ordering or POST parser is changed by this contract. */
export async function takeSponsorAudioOutputReadAttempt(attempt: SponsorAudioOutputReadAttempt, request: Request, env: WorkerEnv): Promise<SponsorAudioOutputReadBudget> {
  const state = attempts.get(attempt);
  if (!state || state.taken || state.request !== request || state.env !== env || request.bodyUsed) return failure();
  state.taken = true;
  const { life } = state, current = ownerCurrent(life, state.principal);
  try {
    current(); const assertions = freeze([...state.assertions, receiptProof(state.receipt)]), joinedProof = joined(assertions);
    const bound = createSponsorAudioOutputReadBoundary(request, env, limitsFor(life, current)), started = performance.now();
    const rows = await life.wait(() => bound.query<{ available: number; now_ms: number }>(`SELECT 1 AS available,${clock} AS now_ms WHERE ${joinedProof.sql}`, joinedProof.bindings, ["available", "now_ms"])); current();
    if (rows.length !== 1 || rows[0]!.available !== 1 || !integer(rows[0]!.now_ms)) return failure();
    life.narrowDeadline(started + state.receipt.deadline_at_ms - rows[0]!.now_ms); current();
    state.assertions = assertions; life.active();
    const budget = Object.freeze({}) as SponsorAudioOutputReadBudget; budgets.set(budget, state); current(); return budget;
  } catch (error) { life.retire(); throw error; }
}

/** Internal only: this genuine authentication graph may contain private Project labels.
 * Never serialize this view or send it to a provider. A future native reader
 * must adopt this exact budget and add its own current custody predicates. */
export function requireSponsorAudioOutputReadBudget(budget: SponsorAudioOutputReadBudget, request: Request, env: WorkerEnv) {
  const state = budgets.get(budget);
  if (!state || state.request !== request || state.env !== env) return failure();
  const current = ownerCurrent(state.life, state.principal);
  current();
  return Object.freeze({ operation: state.selected.operation, draftId: state.selected.draftId, principal: state.principal.principal,
    authenticated: state.principal.authenticated, original: state.original, policy: state.approved.policy, receipt: state.receipt, assertions: state.assertions,
    current, remaining() { current(); return state.life.remaining(); }, account(usage: Usage) { current(); state.life.account(usage); current(); },
    async wait<T>(work: () => Promise<T>) { current(); const result = await state.life.wait(work); current(); return result; },
    get usage() { current(); return state.life.used; }, get monotonicDeadline() { current(); return state.life.deadline; },
    accountResponse(serialized: string) { current(); if (typeof serialized !== "string" || !serialized.isWellFormed()) return failure(); state.life.account({ bytes: bytes(serialized), queries: 0, rows: 0 }); current(); } });
}
export function retireSponsorAudioOutputReadBudget(budget: SponsorAudioOutputReadBudget, request: Request, env: WorkerEnv): void {
  const state = budgets.get(budget);
  if (!state || state.request !== request || state.env !== env) return failure(); state.life.retire(); budgets.delete(budget);
}
