import { digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDraftId, experienceResourceId, isDraftId, isIntentId, registeredExperience, validateIntakeRequest, type IntakeRequest } from "../src/experiences/intake.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest, decodedCookieValue, identityFromRequest } from "./principal-request-core.ts";
import { continueExperienceAuthorization } from "./experience-intake-read.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorAudioPolicy, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { classifySponsorAudioIntakeDraft } from "./experience-sponsor-audio-intake-classification.ts";
import { SPONSOR_INTAKE_SCHEMA } from "./experience-sponsor-intake.ts";
import { SPONSOR_STORY_INTAKE_STORAGE_SCHEMA } from "./experience-sponsor-story-intake-resources.ts";
import { readApprovedSponsorAudioIntakePolicy } from "./experience-sponsor-audio-intake-approval.ts";
import { readStoredSponsorAudioIntake, type SponsorAudioIntakeReceipt } from "./experience-sponsor-audio-intake-resources.ts";
import { takeSponsorAudioIntakeAttempt, type SponsorAudioIntakeAttempt } from "./experience-sponsor-audio-intake-attempts.ts";
import { sponsorAudioIntakeReadProofs, requireSponsorAudioIntakeResponse } from "./experience-sponsor-audio-intake-native.ts";
import type { SponsorAudioIntakeIoOperation as SponsorAudioIntakeOperation } from "./experience-sponsor-audio-intake-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export type SponsorAudioIntakeAssertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[]; deadlineMs?: number }>;
export type SponsorAudioIntakeCommand = Readonly<{
  action: "prepare-sponsored-audio-draft"; campaignId: string; request: IntakeRequest;
} | { action: "commit-sponsored-audio-draft"; campaignId: string; draftId: string; draftHash: string }>;
type Row = Record<string, unknown>;
type PolicyFacts = Awaited<ReturnType<typeof readApprovedSponsorAudioIntakePolicy>>;
declare const authorityBrand: unique symbol;
declare const budgetBrand: unique symbol;
declare const finalizationBrand: unique symbol;
export type SponsorAudioIntakeAuthority = Readonly<{ [authorityBrand]: true }>;
export type SponsorAudioIntakeBudget = Readonly<{ [budgetBrand]: true }>;
export type SponsorAudioIntakeFinalization = Readonly<{ [finalizationBrand]: true }>;
const encoder = new TextEncoder();
const fail = (code: string): never => { throw new SponsorEntitlementError(`sponsor_audio_intake_${code}`); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const databaseNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const snapshotColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements", "email", "display_name", "consented_at"];
const principalColumns = ["user_id", "email", "display_name", "role", "consent_version", "consented_at", "created_at", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const copyProofs = (proofs: readonly { sql: string; bindings?: readonly (string | number | null)[]; deadlineMs?: number }[]) => freeze(proofs.map(proof => ({ ...proof, bindings: [...(proof.bindings ?? [])] })));

/** Own every JSON field before using it, with exact escaped UTF-8 accounting
 * while copying. These are transport bounds, not payer terms or authority. */
export function captureSponsorAudioIntakeJson(value: unknown, maximumBytes = 2_000_000): unknown {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 192_000_000) return fail("data_limit");
  let nodes = 0, bytes = 0;
  const path = new Set<object>();
  const charge = (count: number) => {
    bytes += count;
    if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) return fail("data_limit");
  };
  const string = (text: string) => {
    if (text.length > maximumBytes) return fail("data_limit");
    charge(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      let length = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      if (code === 0x22 || code === 0x5c) length = 2;
      else if (code < 0x20) length = [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        length = 4; index++;
      } else if (code >= 0xd800 && code <= 0xdfff) length = 6;
      charge(length);
    }
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 131072 || depth > 32) return fail("data_limit");
    if (typeof item === "string") { string(item); return item; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      charge(JSON.stringify(item).length); return item;
    }
    if (!item || typeof item !== "object" || !Array.isArray(item) && !record(item) || path.has(item)) return fail("data_invalid");
    const keys = Reflect.ownKeys(item), array = Array.isArray(item);
    if ("error" in item && !Object.hasOwn(item, "error")) return fail("data_invalid");
    if (keys.length > 131072 || keys.some(key => typeof key !== "string")) return fail("data_invalid");
    let length = 0;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(item, "length");
      if (Object.getPrototypeOf(item) !== Array.prototype || !descriptor || !Object.hasOwn(descriptor, "value")
        || descriptor.enumerable || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0
        || descriptor.value > 4096 || keys.length !== descriptor.value + 1) return fail("data_invalid");
      length = descriptor.value as number;
    }
    path.add(item);
    try {
      charge(2 + Math.max(0, (array ? length : keys.length) - 1));
      const output: unknown[] | Row = array ? [] : Object.create(null) as Row;
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype", "toJSON"].includes(key)
          || array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)) return fail("data_invalid");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return fail("data_invalid");
        if (!array) { string(key); charge(1); }
        Object.defineProperty(output, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return output;
    } finally { path.delete(item); }
  };
  return copy(value, 0);
}
export function sponsorAudioIntakeAcknowledgments(value: unknown, expected: number, maximumBytes = 2_000_000): D1Result<Row>[] {
  const copied = captureSponsorAudioIntakeJson(value, maximumBytes);
  if (!Array.isArray(copied) || copied.length !== expected) return fail("acknowledgment_invalid");
  for (const item of copied) if (!record(item) || item.success !== true || !Object.hasOwn(item, "success") || Object.hasOwn(item, "error")
    || !Object.hasOwn(item, "results") || !Array.isArray(item.results) || item.results.some(row => !record(row))) return fail("acknowledgment_invalid");
  return copied as D1Result<Row>[];
}
const scalarProofs = (value: unknown, count: number) => {
  const result = sponsorAudioIntakeAcknowledgments(value, count);
  for (const item of result) if (item.results.length !== 1 || !exactKeys(item.results[0]!, ["current"]) || item.results[0]!.current !== 1)
    return fail("authority_changed");
  return result;
};

/** Technical control bounds are transport protections, never payer terms.
 * The operation's approved full-byte ceiling replaces this bound only when a
 * genuine one-use attempt is consumed. Captured state never accepts a DTO. */
class Lifetime {
  readonly maximumBytes: number;
  monotonicDeadline: number;
  readonly request: Request;
  readonly contextCurrent: () => void;
  used = 0;
  queries = 0;
  previous: number;
  failed = false;
  phase: "open" | "finalizing" | "finished" = "open";
  constructor(maximumBytes: number, monotonicDeadline: number, request: Request,
    contextCurrent: () => void) {
    const now = performance.now();
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 192_000_000
      || !Number.isFinite(monotonicDeadline) || !Number.isFinite(now) || now < 0 || monotonicDeadline <= now)
      fail("io_deadline");
    this.previous = now;
    this.maximumBytes = maximumBytes;
    this.monotonicDeadline = monotonicDeadline;
    this.request = request;
    this.contextCurrent = contextCurrent;
  }
  sample() {
    const now = performance.now();
    if (!Number.isFinite(now) || now < this.previous || !Number.isFinite(this.monotonicDeadline)) return this.refuse("io_deadline");
    this.previous = now; return now;
  }
  current() {
    if (this.failed) return fail("io_unavailable");
    try {
      this.contextCurrent();
      if (this.request.signal.aborted || this.sample() >= this.monotonicDeadline) return this.refuse("io_deadline");
    } catch (error) { this.failed = true; throw error; }
  }
  refuse(code: string): never { this.failed = true; return fail(code); }
  accountBytes(bytes: number) {
    this.current();
    if (this.phase === "finished" || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maximumBytes - this.used) return this.refuse("io_byte_capacity");
    this.used += bytes;
  }
  accountSerialized(value: string) {
    this.current();
    const remaining = this.maximumBytes - this.used;
    if (typeof value !== "string" || value.length > remaining) return this.refuse("io_byte_capacity");
    let bytes = 0;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4; index++;
      } else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      if (bytes > remaining) return this.refuse("io_byte_capacity");
    }
    this.accountBytes(bytes);
  }
  account(value: unknown) {
    try { this.accountSerialized(JSON.stringify(captureSponsorAudioIntakeJson(value, this.maximumBytes - this.used))); }
    catch (error) { this.failed = true; throw error; }
  }
  count(count = 1) {
    this.current();
    if (this.phase === "finished" || !Number.isSafeInteger(count) || count < 1 || this.queries + count > 128) return this.refuse("io_query_capacity");
    this.queries += count;
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.current(); if (this.phase === "finished") return fail("io_consumed");
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      const stopped = new Promise<never>((_, reject) => {
        abort = () => reject(new SponsorEntitlementError("sponsor_audio_intake_io_deadline"));
        this.request.signal.addEventListener("abort", abort, { once: true });
        if (this.request.signal.aborted) abort();
        timer = setTimeout(abort, Math.max(0, this.monotonicDeadline - this.sample()));
      });
      return await Promise.race([stopped, Promise.resolve().then(() => { this.current(); return work(); })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) this.request.signal.removeEventListener("abort", abort);
      this.current();
    }
  }
}
type Capture = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; current(): void };
function capture(request: Request, env: WorkerEnv): Capture {
  const requestSignal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get;
  const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (!requestSignal || !signalAborted) return fail("request_invalid");
  const db = env.DB, method = request.method, url = request.url, signal = requestSignal.call(request) as AbortSignal;
  const headers = JSON.stringify([...request.headers]), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  if (encoder.encode(headers).byteLength > 32768) return fail("request_invalid");
  return { request, env, db, current() {
    if (env.DB !== db || request.method !== method || request.url !== url || request.signal !== signal
      || requestSignal.call(request) !== signal || signalAborted.call(signal) !== false
      || JSON.stringify([...request.headers]) !== headers || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins)
      return fail("authority_changed");
  } };
}
type AuthorityState = Capture & { auth: ProjectIntakeAuthorization; actorUserId: string; campaignId: string; sponsorPolicyDigest: string;
  payerUserId: string; sessionDigest: string; draftId: string; operation: SponsorAudioIntakeOperation; command?: SponsorAudioIntakeCommand;
  original?: SponsorAudioIntakeReceipt; assertions: readonly SponsorAudioIntakeAssertion[]; freshAbsenceAssertions: readonly SponsorAudioIntakeAssertion[];
  controlBytes: number; policyfacts: PolicyFacts; principalRow: Row };
const authorities = new WeakMap<SponsorAudioIntakeAuthority, AuthorityState>();
const identified = new WeakSet<Request>();

async function query(control: Lifetime, captured: Capture, sql: string, bindings: readonly unknown[], maximumRows: number) {
  control.count();
  const raw = await control.wait(() => captured.db.prepare(sql).bind(...bindings).all<Row>());
  control.current();
  const [result] = sponsorAudioIntakeAcknowledgments([raw], 1);
  control.account(result);
  if (result!.results.length > maximumRows) return fail("control_rows");
  control.current(); return result!.results;
}
async function prove(control: Lifetime, captured: Capture, proofs: readonly SponsorAudioIntakeAssertion[]) {
  if (!proofs.length || proofs.length > 64) return fail("proof_invalid");
  const deadlines = proofs.flatMap(proof => proof.deadlineMs === undefined ? [] : [proof.deadlineMs]);
  if (deadlines.some(deadline => !Number.isSafeInteger(deadline) || deadline <= 0)) return fail("proof_invalid");
  control.count(proofs.length + (deadlines.length ? 1 : 0));
  const statements = proofs.map(proof => {
    if (proof.bindings.length > 100 || encoder.encode(proof.sql).byteLength > 95000) return fail("proof_capacity");
    return captured.db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings);
  });
  if (deadlines.length) statements.push(captured.db.prepare(`SELECT ${databaseNow} AS now_ms`));
  const started = control.sample();
  const raw = await control.wait(() => captured.db.batch<Row>(statements));
  control.current();
  const result = sponsorAudioIntakeAcknowledgments(raw, statements.length); control.account(result);
  scalarProofs(result.slice(0, proofs.length), proofs.length);
  if (deadlines.length) {
    const rows = result[proofs.length]!.results;
    if (rows.length !== 1 || !exactKeys(rows[0]!, ["now_ms"]) || !Number.isSafeInteger(rows[0]!.now_ms)) return fail("clock_invalid");
    control.monotonicDeadline = Math.min(control.monotonicDeadline, started + Math.min(...deadlines) - (rows[0]!.now_ms as number));
  }
  control.current();
}
function principalEnvironment(captured: Capture, control: Lifetime) {
  let observed: Row | undefined;
  const statement = (sql: string, values: readonly unknown[] = []): D1PreparedStatement => ({
    bind(...bindings: unknown[]) { control.current(); return statement(sql, [...bindings]); },
    async first<T>(column?: string) {
      control.current();
      const identity = identityFromRequest(captured.request);
      if (column !== undefined || sql !== PRINCIPAL_WITH_ACCESS_SQL || values.length !== 1 || values[0] !== identity?.userId) return fail("principal_query_invalid");
      const rows = await query(control, captured, `WITH native AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL}), packed AS (
        SELECT json_object(${principalColumns.flatMap(name => [`'${name}'`, name]).join(",")}) AS principal_json FROM native)
        SELECT CASE WHEN length(CAST(principal_json AS BLOB))<=131072 THEN principal_json END AS principal_json FROM packed LIMIT 2`, values, 1);
      if (!rows.length) return null;
      if (typeof rows[0]!.principal_json !== "string") return fail("principal_capacity");
      const row = captureSponsorAudioIntakeJson(JSON.parse(rows[0]!.principal_json));
      if (!record(row) || !exactKeys(row, principalColumns)) return fail("principal_invalid");
      observed = row; control.current(); return row as T;
    },
    all() { return fail("principal_query_invalid"); }, run() { return fail("principal_query_invalid"); }, raw() { return fail("principal_query_invalid"); },
  } as D1PreparedStatement);
  const DB = { prepare(sql: string) { control.current(); return statement(sql); }, batch() { return fail("principal_query_invalid"); },
    exec() { return fail("principal_query_invalid"); }, dump() { return fail("principal_query_invalid"); } } as unknown as WorkerEnv["DB"];
  return { env: { ...captured.env, DB }, observed: () => observed };
}
/** The retained command must be structurally closed before lookup, while its
 * exact immutable original owns historical release/value validation. Fresh
 * commands additionally pass the actual current native validator below. */
function structuralAudioRequest(value: unknown): value is IntakeRequest {
  if (!record(value) || !exactKeys(value, ["intentId", "experienceId", "releaseHash", "values"])
    || !isIntentId(value.intentId) || value.experienceId !== "audio" || !hash(value.releaseHash) || !record(value.values)) return false;
  return Object.values(value.values).every(entry => {
    if (!record(entry) || !exactKeys(entry, ["value", "provenance"]) || entry.provenance !== "default" && entry.provenance !== "authored") return false;
    const field = entry.value;
    return typeof field === "string"
      || Array.isArray(field) && field.every(item => record(item) && exactKeys(item, ["id", "text"]) && typeof item.id === "string" && typeof item.text === "string")
      || record(field) && Object.values(field).every(item => typeof item === "string" || typeof item === "number" && Number.isFinite(item));
  });
}
async function command(request: Request, control: Lifetime): Promise<SponsorAudioIntakeCommand> {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json" || request.bodyUsed) return fail("command_invalid");
  const reader = request.body?.getReader(); if (!reader) return fail("command_invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await control.wait(() => reader.read()); control.current();
      if (part.done) break;
      size += part.value.byteLength; if (size > 131072) return fail("command_capacity");
      chunks.push(part.value.slice());
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  control.accountBytes(size);
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let raw: unknown; try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail("command_invalid"); }
  if (jsonIssues(raw).length || !record(raw) || !id(raw.campaignId)) return fail("command_invalid");
  if (raw.action === "prepare-sponsored-audio-draft" && exactKeys(raw, ["action", "campaignId", "request"])) {
    if (!structuralAudioRequest(raw.request)) return fail("command_invalid");
    return freeze({ action: raw.action, campaignId: raw.campaignId, request: raw.request });
  }
  if (raw.action === "commit-sponsored-audio-draft" && exactKeys(raw, ["action", "campaignId", "draftId", "draftHash"])
    && typeof raw.draftId === "string" && isDraftId(raw.draftId) && hash(raw.draftHash)) return freeze(raw) as SponsorAudioIntakeCommand;
  return fail("command_invalid");
}

/** Read-only equivalent of the exact V8 loader's live actor, issuer, payer,
 * campaign and cohort witnesses. The pure native approval predicate is reused
 * verbatim; no INSERT/DELETE acknowledgment is synthesized. */
async function writeAuthority(captured: Capture, control: Lifetime, auth: ProjectIntakeAuthorization, principalRow: Row, campaignId: string) {
  const rows = await query(control, captured, `SELECT CASE WHEN typeof(policy_json)='text' AND length(CAST(policy_json AS BLOB))<=131072 THEN policy_json END AS policy_json,
    CASE WHEN typeof(policy_digest)='text' AND length(CAST(policy_digest AS BLOB))<=71 THEN policy_digest END AS policy_digest
    FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 LIMIT 2`, [campaignId], 1);
  const row = rows[0]; if (!row || typeof row.policy_json !== "string" || !hash(row.policy_digest)) return fail("write_authority_unavailable");
  const policy = readSponsorAudioPolicy(JSON.parse(row.policy_json));
  if (policy.version !== 8 || policy.family !== "canonical-instrumental-cue@1" || policy.mode !== "candidate" || policy.campaignId !== campaignId
    || await control.wait(() => digest(policy)) !== row.policy_digest) return fail("write_authority_unavailable");
  control.current();
  const release = await control.wait(() => registeredExperience("audio")); control.current();
  if (!release || !policy.templates.some(template => template.appId === "audio" && template.releaseDigest === release.releaseHash)) return fail("write_authority_unavailable");
  const actor = auth.user, assertions: SponsorAudioIntakeAssertion[] = [
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${snapshotColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [actor.userId, JSON.stringify(snapshotColumns.map(column => principalRow[column] ?? null))] },
    { ...sponsorApprovalAssertion(policy, actor.userId, true), bindings: [...(sponsorApprovalAssertion(policy, actor.userId, true).bindings ?? [])] },
    { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE participant.user_id IN(?,?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`, bindings: [actor.userId, policy.payerUserId] },
    { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 AND policy_digest=? AND policy_json=?) AND ${databaseNow}>=? AND ${databaseNow}<?`,
      bindings: [campaignId, row.policy_digest, row.policy_json, policy.startsAtMs, policy.expiresAtMs], deadlineMs: policy.expiresAtMs },
  ];
  await prove(control, captured, assertions); control.current();
  const sessionDigest = await control.wait(() => digest({ version: "sponsor-canonical-principal@1", userId: actor.userId,
    consentVersion: actor.consentVersion, authorizationSnapshot: actor.authorizationSnapshot ?? null })); control.current();
  return freeze({ policy, policyDigest: row.policy_digest, actorUserId: actor.userId, sessionDigest, assertions: copyProofs(assertions) });
}

/** This wrapper is private to the fixed refusal classifier. It cannot escape
 * as a general DB capability and never forwards a mutation. Its existing
 * source-free query/field and aggregate catalog bounds remain authoritative. */
async function classification(captured: Capture, control: Lifetime, draftId: string) {
  const statement = (sql: string, bindings: readonly unknown[] = []): D1PreparedStatement => ({
    bind(...values: unknown[]) { control.current(); return statement(sql, [...values]); },
    async all<T>() {
      control.current();
      if (!/^(?:SELECT|WITH)\s/u.test(sql) || bindings.length > 100 || encoder.encode(sql).byteLength > 95000) return fail("classification_query_invalid");
      control.count(); const raw = await control.wait(() => captured.db.prepare(sql).bind(...bindings).all<Row>());
      control.current(); const result = sponsorAudioIntakeAcknowledgments([raw], 1)[0]!; control.account(result);
      if (result.results.length > 2) return fail("classification_capacity");
      control.current(); return result as D1Result<T>;
    },
    first() { return fail("classification_query_invalid"); }, run() { return fail("classification_query_invalid"); }, raw() { return fail("classification_query_invalid"); },
  } as D1PreparedStatement);
  const DB = { prepare(sql: string) { control.current(); return statement(sql); }, batch() { return fail("classification_query_invalid"); },
    exec() { return fail("classification_query_invalid"); }, dump() { return fail("classification_query_invalid"); } } as unknown as WorkerEnv["DB"];
  const result = await control.wait(() => classifySponsorAudioIntakeDraft(captured.request, { ...captured.env, DB }, draftId));
  control.current(); if (result.kind === "unavailable" || result.kind === "sponsored" || result.kind === "story-sponsored") return fail("classification_unavailable");
  return result;
}
const limits = (control: Lifetime) => ({ current: () => control.current(), monotonicDeadline: control.monotonicDeadline, signal: control.request.signal });

async function noImageAssociation(captured: Capture, control: Lifetime, draftId: string): Promise<SponsorAudioIntakeAssertion> {
  const expected = SPONSOR_INTAKE_SCHEMA[1]!;
  const rows = await query(control, captured, `SELECT type,name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql END AS sql
    FROM main.sqlite_schema WHERE lower(name)='experience_sponsor_intakes' LIMIT 2`, [], 1);
  if (!rows.length) return { sql: "NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(name)='experience_sponsor_intakes')", bindings: [] };
  const row = rows[0]!;
  if (!exactKeys(row, ["type", "name", "sql"]) || row.type !== "table" || row.name !== "experience_sponsor_intakes" || row.sql !== expected)
    return fail("image_association_unavailable");
  return { sql: `EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name='experience_sponsor_intakes' AND type='table' AND sql=?)
    AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_intakes WHERE draft_id=?)`, bindings: [expected, draftId] };
}

// Full Story storage declarations and both association keys remain negative
// at every later proof, including a collision arriving after classification.
const storyTables = ["experience_sponsor_story_intake_allocations", "experience_sponsor_story_intakes"] as const;
const storyObjects = SPONSOR_STORY_INTAKE_STORAGE_SCHEMA.map(sql => {
  const declaration = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql)!;
  return [declaration[1]!.toLowerCase(), declaration[2]!, sql];
}).sort((left, right) => left[1]! < right[1]! ? -1 : left[1]! > right[1]! ? 1 : 0);
const storySnapshot = JSON.stringify(storyObjects);
const storySchemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name IN('${storyTables[0]}','${storyTables[1]}') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${storyObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT total,CASE WHEN total<=${storyObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
async function noStoryAssociation(captured: Capture, control: Lifetime, draftId: string): Promise<SponsorAudioIntakeAssertion> {
  const rows = await query(control, captured, storySchemaQuery, [], 1), row = rows[0];
  if (!row || !exactKeys(row, ["total", "snapshot"])) return fail("story_association_unavailable");
  if (row.total === 0 && row.snapshot === "[]") return {
    sql: "NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(name) IN(?,?) OR lower(tbl_name) IN(?,?))",
    bindings: [...storyTables, ...storyTables],
  };
  if (row.total !== storyObjects.length || row.snapshot !== storySnapshot) return fail("story_association_unavailable");
  return { sql: `EXISTS(SELECT 1 FROM (${storySchemaQuery}) WHERE total=? AND snapshot=?)
    AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_story_intakes WHERE draft_id COLLATE BINARY=?)
    AND NOT EXISTS(SELECT 1 FROM main.experience_sponsor_story_intake_allocations WHERE draft_id COLLATE BINARY=?)`,
    bindings: [storyObjects.length, storySnapshot, draftId, draftId] };
}

/** Explicit internal entry only. POST command bytes come from the actual
 * request once; retained GET selectors resolve their original allocation and
 * cannot replace its campaign/payer. No stored private body is read here. */
export async function identifySponsorAudioIntake(request: Request, env: WorkerEnv, selector: unknown): Promise<SponsorAudioIntakeAuthority> {
  const rawSelector = freeze(captureSponsorAudioIntakeJson(selector));
  if (identified.has(request) || jsonIssues(rawSelector).length || !record(rawSelector)) return fail("request_invalid");
  identified.add(request);
  const captured = capture(request, env), control = new Lifetime(2_000_000, performance.now() + 30000, request, captured.current);
  control.current();
  if (env.FORMA_PILOT_COHORT_ID?.trim() || decodedCookieValue(request, "forma_impersonation") || decodedCookieValue(request, "forma_project_context")) return fail("personal_principal_required");
  const operation = rawSelector.operation;
  const post = operation === "audio-intake-prepare" || operation === "audio-intake-commit";
  if (post ? request.method !== "POST" || !exactKeys(rawSelector, ["operation"])
    : request.method !== "GET" || !["audio-intake-draft", "audio-intake-receipt"].includes(String(operation))
      || !(exactKeys(rawSelector, ["operation", "draftId"]) && typeof rawSelector.draftId === "string" && isDraftId(rawSelector.draftId)
        || exactKeys(rawSelector, ["operation", "intentId"]) && isIntentId(rawSelector.intentId))) return fail("request_invalid");
  const selectedOperation = operation as SponsorAudioIntakeOperation;
  const parsed = post ? await command(request, control) : undefined; control.current();
  if (parsed && (operation === "audio-intake-prepare") !== (parsed.action === "prepare-sponsored-audio-draft")) return fail("command_invalid");
  const principal = principalEnvironment(captured, control);
  const authenticated = await control.wait(() => readExistingPrincipalRequest(request, principal.env, "creator", { account: "principal" })); control.current();
  if ("kind" in authenticated || authenticated.response || !authenticated.user || authenticated.user.fictional || authenticated.user.projectExecution
    || authenticated.user.billingUserId && authenticated.user.billingUserId !== authenticated.user.userId) return fail("personal_principal_required");
  const authorized = await control.wait(() => continueExperienceAuthorization(request, principal.env, authenticated)); control.current();
  if (authorized instanceof Response || !principal.observed()) return fail("personal_principal_required");
  const auth = freeze(authorized), actorUserId = auth.user.userId, principalRow = freeze(principal.observed()!);
  const nativeIntent = parsed?.action === "prepare-sponsored-audio-draft" ? parsed.request.intentId : rawSelector.intentId;
  const draftId = parsed?.action === "commit-sponsored-audio-draft" ? parsed.draftId
    : typeof nativeIntent === "string" ? await control.wait(() => experienceDraftId(actorUserId, nativeIntent)) : String(rawSelector.draftId);
  control.current();
  const stored = await control.wait(() => readStoredSponsorAudioIntake(request, env, { draftId, actorUserId }, limits(control)));
  control.current(); control.accountBytes(stored.controlBytes);
  const classified = await classification(captured, control, draftId); control.current();
  const imageNegative = await noImageAssociation(captured, control, draftId); control.current();
  const storyNegative = await noStoryAssociation(captured, control, draftId); control.current();
  let original = stored.receipt ?? undefined, campaignId: string, sponsorPolicyDigest: string, sessionDigest: string;
  const assertions: SponsorAudioIntakeAssertion[] = [imageNegative, storyNegative], freshAbsenceAssertions: SponsorAudioIntakeAssertion[] = [];
  let projectId: string, documentId: string;
  if (original) {
    if (classified.kind !== "audio-sponsored" || parsed && parsed.campaignId !== original.campaignId
      || parsed?.action === "commit-sponsored-audio-draft" && parsed.draftHash !== original.draftHash) return fail("original_changed");
    if (parsed?.action === "prepare-sponsored-audio-draft" && (parsed.request.intentId !== original.nativeIntentId
      || await control.wait(() => digest(parsed)) !== original.bodyDigest)) return fail("original_changed");
    control.current();
    campaignId = original.campaignId; sponsorPolicyDigest = original.sponsorPolicyDigest; sessionDigest = original.sessionDigest;
    projectId = original.projectId; documentId = original.documentId;
    assertions.push(...copyProofs(stored.assertions), {
      sql: `EXISTS(SELECT 1 FROM main.private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
        AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS(SELECT 1 FROM main.project_resource_scopes WHERE resource_kind='content' AND resource_id=?)
        AND NOT EXISTS(SELECT 1 FROM main.private_content_retention_scopes WHERE content_id=?)
        AND NOT EXISTS(SELECT 1 FROM main.events WHERE stream_id=? AND type IN('DocumentRemoved','ProjectRemoved')
          AND (type='DocumentRemoved' AND json_extract(payload,'$.document_id')=? OR type='ProjectRemoved' AND json_extract(payload,'$.project_id')=?))`,
      bindings: [draftId, actorUserId, original.expiresAt, draftId, draftId, auth.user.streamId, documentId, projectId], deadlineMs: Date.parse(original.expiresAt),
    });
  } else {
    if (parsed?.action !== "prepare-sponsored-audio-draft" || classified.kind !== "ordinary") return fail("original_unavailable");
    const validated = await control.wait(() => validateIntakeRequest(parsed.request)); control.current();
    if (!validated || validated.release.output.output !== "audio") return fail("command_invalid");
    const absent: SponsorAudioIntakeAssertion = { sql: "NOT EXISTS(SELECT 1 FROM main.private_content WHERE content_id=?)", bindings: [draftId] };
    freshAbsenceAssertions.push(...copyProofs(stored.assertions), classified.guard, absent);
    await prove(control, captured, freshAbsenceAssertions); control.current();
    campaignId = parsed.campaignId;
    const live = await writeAuthority(captured, control, auth, principalRow, campaignId); control.current();
    sponsorPolicyDigest = live.policyDigest; sessionDigest = live.sessionDigest; assertions.push(...live.assertions);
    projectId = await control.wait(() => experienceResourceId(draftId, "project"));
    documentId = await control.wait(() => experienceResourceId(draftId, "document")); control.current();
  }
  const policyfacts = await control.wait(() => readApprovedSponsorAudioIntakePolicy(request, env, campaignId, sponsorPolicyDigest, limits(control)));
  control.current(); control.accountBytes(policyfacts.controlBytes); const payerUserId = policyfacts.payerUserId;
  if (original && (original.intakePolicyDigest !== policyfacts.intakePolicyDigest || original.intakeApprovalId !== policyfacts.approvalId)) return fail("original_changed");
  assertions.push(projectIntakeAuthority(env, auth, { projectId, documentId }), ...copyProofs(policyfacts.assertions));
  await prove(control, captured, assertions); control.current();
  original = original ? freeze(original) : undefined;
  const authority = Object.freeze({}) as SponsorAudioIntakeAuthority;
  authorities.set(authority, { ...captured, current: () => control.current(), auth, actorUserId, campaignId, sponsorPolicyDigest, payerUserId, sessionDigest, draftId,
    operation: selectedOperation, command: parsed, original, assertions: copyProofs(assertions), freshAbsenceAssertions: copyProofs(freshAbsenceAssertions),
    controlBytes: control.used, policyfacts: freeze(policyfacts), principalRow });
  control.current(); return authority;
}

export function requireSponsorAudioIntakeAuthority(authority: SponsorAudioIntakeAuthority, request: Request, env: WorkerEnv) {
  const state = authorities.get(authority);
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB) return fail("authority_unavailable");
  state.current();
  return Object.freeze({ auth: state.auth, actorUserId: state.actorUserId, campaignId: state.campaignId, sponsorPolicyDigest: state.sponsorPolicyDigest,
    payerUserId: state.payerUserId, sessionDigest: state.sessionDigest, draftId: state.draftId, operation: state.operation,
    command: state.command, original: state.original, assertions: state.assertions, freshAbsenceAssertions: state.freshAbsenceAssertions,
    controlBytes: state.controlBytes, policyfacts: state.policyfacts, current: state.current });
}

type BudgetState = { authority: SponsorAudioIntakeAuthority; captured: AuthorityState; lifetime: Lifetime;
  assertions: readonly SponsorAudioIntakeAssertion[]; policyfacts: PolicyFacts; active: number; response?: Response };
const budgets = new WeakMap<SponsorAudioIntakeBudget, BudgetState>();
const finalizations = new WeakMap<SponsorAudioIntakeFinalization, SponsorAudioIntakeBudget>();
export async function createSponsorAudioIntakeBudget(authority: SponsorAudioIntakeAuthority, attempt: SponsorAudioIntakeAttempt, request: Request, env: WorkerEnv) {
  requireSponsorAudioIntakeAuthority(authority, request, env);
  const captured = authorities.get(authority)!;
  const ticket = await takeSponsorAudioIntakeAttempt(attempt, authority, request, env);
  requireSponsorAudioIntakeAuthority(authority, request, env);
  const lifetime = new Lifetime(ticket.maximumBytes, ticket.monotonicDeadline, request, captured.current);
  lifetime.accountBytes(ticket.controlBytes);
  const capability = Object.freeze({}) as SponsorAudioIntakeBudget;
  budgets.set(capability, { authority, captured, lifetime, active: 0, assertions: copyProofs(ticket.assertions), policyfacts: freeze({ ...captured.policyfacts,
    policy: ticket.policy, intakePolicyDigest: ticket.intakePolicyDigest, reviewReceiptDigest: ticket.reviewReceiptDigest,
    approvalId: ticket.approvalId, originalApprovalId: ticket.originalApprovalId, payerUserId: ticket.payerUserId }) });
  lifetime.current(); return capability;
}
export function requireSponsorAudioIntakeBudget(capability: SponsorAudioIntakeBudget, request?: Request, env?: WorkerEnv, finalization?: SponsorAudioIntakeFinalization) {
  const state = budgets.get(capability);
  const finishing = finalization !== undefined && finalizations.get(finalization) === capability;
  if (!state || request && state.captured.request !== request || env && state.captured.env !== env
    || finalization !== undefined && !finishing || state.lifetime.phase !== (finishing ? "finalizing" : "open")) return fail("budget_unavailable");
  const { lifetime, captured } = state;
  const current = () => { lifetime.current(); if (lifetime.phase !== (finishing ? "finalizing" : "open")) return fail("budget_unavailable"); };
  current();
  const wait = async <T>(work: () => Promise<T>): Promise<T> => {
    current(); state.active++;
    try { return await lifetime.wait(() => { current(); return work(); }); }
    finally { state.active--; current(); }
  };
  return Object.freeze({ authority: state.authority, auth: captured.auth, operation: captured.operation, draftId: captured.draftId,
    campaignId: captured.campaignId, sponsorPolicyDigest: captured.sponsorPolicyDigest,
    command: captured.command, original: captured.original, policyfacts: state.policyfacts, db: captured.db,
    current, assertOpen: () => { current(); if (finishing) return fail("budget_unavailable"); }, wait,
    account: (value: unknown) => { current(); lifetime.account(value); current(); },
    accountBytes: (count: number) => { current(); lifetime.accountBytes(count); current(); },
    accountSerialized: (value: string) => { current(); lifetime.accountSerialized(value); current(); },
    remaining: () => { current(); return lifetime.maximumBytes - lifetime.used; }, count: (count = 1) => { current(); lifetime.count(count); },
    monotonicDeadline: lifetime.monotonicDeadline, assertions: state.assertions, freshAbsenceAssertions: captured.freshAbsenceAssertions });
}
export async function readSponsorAudioIntakeWriteAuthority(capability: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv) {
  const budget = requireSponsorAudioIntakeBudget(capability, request, env);
  const state = budgets.get(capability)!, { captured, lifetime } = state;
  const before = lifetime.used;
  const result = await budget.wait(() => writeAuthority(captured, lifetime, captured.auth, captured.principalRow, captured.campaignId));
  budget.current();
  if (result.policyDigest !== captured.sponsorPolicyDigest || result.policy.payerUserId !== captured.payerUserId) return fail("write_authority_changed");
  return freeze({ ...result, controlBytes: lifetime.used - before });
}

/** One actual body serialization, followed by all captured attempt/policy and
 * native original observations in one final read snapshot. Native proof
 * ownership stays in its opaque module; caller additions cannot replace it. */
export async function finishSponsorAudioIntakeResponse(capability: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  value: unknown, additional: readonly SponsorAudioIntakeAssertion[] = [], status = 200) {
  requireSponsorAudioIntakeBudget(capability, request, env);
  const state = budgets.get(capability)!;
  if (state.lifetime.phase !== "open" || state.active !== 0 || ![200, 409].includes(status)) return fail("response_invalid");
  const safe = captureSponsorAudioIntakeJson(value, state.lifetime.maximumBytes - state.lifetime.used);
  const additions = copyProofs(captureSponsorAudioIntakeJson(additional) as SponsorAudioIntakeAssertion[]);
  state.lifetime.phase = "finalizing";
  const finalization = Object.freeze({}) as SponsorAudioIntakeFinalization;
  finalizations.set(finalization, capability);
  await state.lifetime.wait(() => requireSponsorAudioIntakeResponse(capability, safe, status, finalization));
  state.lifetime.current();
  const native = sponsorAudioIntakeReadProofs(capability, finalization), proofs = copyProofs([...state.assertions, ...native, ...additions]);
  const serialized = JSON.stringify(safe);
  const bytes = encoder.encode(serialized);
  state.lifetime.accountBytes(bytes.byteLength);
  await prove(state.lifetime, state.captured, proofs); state.lifetime.current();
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    try {
      state.lifetime.current();
      if (offset === bytes.byteLength) { bytes.fill(0); controller.close(); return; }
      const end = Math.min(offset + 65536, bytes.byteLength); controller.enqueue(bytes.slice(offset, end)); offset = end;
    } catch (error) { bytes.fill(0); controller.error(error); }
  }, cancel() { bytes.fill(0); } }, { highWaterMark: 0 });
  const response = new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
  state.lifetime.current(); state.response = response; state.lifetime.phase = "finished"; return response;
}

/** Export-only lifetime check after the outer operation adopts nested helper
 * promises. A finished response never reopens the consumed private budget. */
export function requireSponsorAudioIntakeFinishedResponse(capability: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  response: Response): Response {
  const state = budgets.get(capability);
  if (!state || state.lifetime.phase !== "finished" || state.response !== response
    || state.captured.request !== request || state.captured.env !== env || state.captured.db !== env.DB) return fail("response_unavailable");
  state.lifetime.current(); return response;
}
