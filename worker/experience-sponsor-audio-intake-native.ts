import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, receiptPrefix, type ExperiencePlan } from "../src/experiences/intake.ts";
import { projectIntakeValue, type ProjectIntake } from "../src/model/project-intake.ts";
import { readDraft, retainedGuard } from "./experience-intake-read.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { requireSponsorAudioIntakeBudget, type SponsorAudioIntakeBudget, type SponsorAudioIntakeFinalization, type SponsorAudioIntakeAssertion } from "./experience-sponsor-audio-intake-reads.ts";
import { intakeGuard, projectIntakeAuthority, type AtomicIntakeOptions, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { reply, type ReceiptState } from "./project-intake-read.ts";
import type { EventRow } from "./event-write-primitives.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Guard = BudgetReservationGuard;
type Budget = ReturnType<typeof requireSponsorAudioIntakeBudget>;
const fail = (): never => { throw new SponsorEntitlementError("sponsor_audio_intake_native_unavailable"); };
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
function ownJson(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || active.has(value)) return fail();
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail();
  active.add(value);
  if (Reflect.ownKeys(value).some(k => typeof k !== "string")) return fail();
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === "length") continue;
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable
      || array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) return fail();
    ownJson(descriptor.value, active);
  }
  if (array && Object.keys(descriptors).length !== value.length + 1) return fail();
  active.delete(value); Object.freeze(value);
}
const children = new WeakMap<Guard, readonly Guard[]>();
function capture(proof: Guard): Guard {
  ownJson(proof);
  if (typeof proof.sql !== "string" || !proof.sql || !Array.isArray(proof.bindings)
    || proof.bindings.some(v => v !== null && typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))) return fail();
  const result = Object.freeze({ sql: proof.sql, bindings: Object.freeze([...proof.bindings]) }) as unknown as Guard;
  const parts = children.get(proof); if (parts) children.set(result, parts);
  return result;
}
const expand = (g: Guard): readonly Guard[] => children.get(g)?.flatMap(p => expand(p)) ?? [g];
const distinct = (proofs: readonly Guard[]) => proofs.filter((p, i) => !proofs.slice(0, i).some(q => p.sql === q.sql && same(p.bindings, q.bindings)));
export function composeSponsorAudioIntakeGuards(...proofs: Guard[]): Guard {
  if (!proofs.length) return fail();
  const parts = Object.freeze(proofs.map(capture));
  const result = capture({ sql: parts.map(p => `(${p.sql})`).join(" AND "), bindings: parts.flatMap(p => p.bindings) });
  children.set(result, parts); return result;
}
function gates(proofs: readonly Guard[], source = "") {
  const parts = distinct(proofs.flatMap(p => expand(capture(p))));
  if (!parts.length) return fail();
  let prefix = "audio_intake_gate";
  const text = source + parts.map(p => p.sql).join("\n");
  while (text.toLowerCase().includes(prefix)) prefix += "_";
  const names = parts.map((_, i) => `${prefix}_${i}`);
  return { parts, names, sql: names.map((name, i) => `${name} AS MATERIALIZED (SELECT 1 AS passed WHERE ${parts[i]!.sql})`).join(","),
    bindings: parts.flatMap(p => p.bindings) };
}
type Compiled = Omit<ReturnType<typeof gates>, "bindings"> & { cap: SponsorAudioIntakeBudget; bindings: readonly unknown[]; ctes: string };
const compiledGuards = new WeakMap<Guard, Compiled>();
export function composeSponsorAudioIntakeWriteGuard(cap: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv, ...proofs: Guard[]): Guard {
  const budget = requireSponsorAudioIntakeBudget(cap, request, env); budget.current();
  const compiled = gates([...proofs, ...budget.assertions.map(p => ({ sql: p.sql, bindings: [...p.bindings] }))]);
  const tail = ` SELECT 1 FROM ${compiled.names.join(" CROSS JOIN ")}`;
  const packed = packSponsorIntakeReadQuery(`WITH ${compiled.sql}${tail}`, compiled.bindings);
  if (!packed.sql.endsWith(tail)) return fail();
  const guard = capture({ sql: `EXISTS(${packed.sql})`, bindings: [...packed.bindings] });
  children.set(guard, compiled.parts);
  compiledGuards.set(guard, { ...compiled, cap, bindings: packed.bindings, ctes: packed.sql.slice(0, -tail.length) });
  return guard;
}

declare const cleanupBrand: unique symbol;
export type SponsorAudioIntakeCleanupRead = Readonly<{ [cleanupBrand]: true }>;
type CleanupSeal = { cap: SponsorAudioIntakeBudget; env: WorkerEnv; db: WorkerEnv["DB"]; auth: ProjectIntakeAuthorization;
  content: string; guard: Guard; guardSql: string; guardBindings: readonly unknown[]; identity: { contentId: string }; used: boolean };
const cleanups = new WeakMap<SponsorAudioIntakeCleanupRead, CleanupSeal>();
const cleanupBudgets = new WeakSet<SponsorAudioIntakeBudget>();
export function createSponsorAudioIntakeCleanupRead(cap: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, content: string, guard: Guard, identity: { contentId: string }): SponsorAudioIntakeCleanupRead {
  const budget = requireSponsorAudioIntakeBudget(cap, request, env);
  if (budget.auth !== auth || budget.operation !== "audio-intake-prepare" || budget.original || cleanupBudgets.has(cap) || identity.contentId !== budget.draftId
    || typeof content !== "string" || !content || !content.isWellFormed() || bytes(content) > 65_536 || !compiledGuards.has(guard)
    || compiledGuards.get(guard)!.cap !== cap) return fail();
  ownJson(identity); capture(guard);
  const token = Object.freeze({}) as SponsorAudioIntakeCleanupRead;
  cleanupBudgets.add(cap);
  cleanups.set(token, { cap, env, db: env.DB, auth, content, guard, guardSql: guard.sql, guardBindings: [...guard.bindings], identity, used: false });
  return token;
}
export function assertSponsorAudioIntakeCleanupRead(token: SponsorAudioIntakeCleanupRead, env: WorkerEnv, ownerId: string,
  kind: string, content: string, projectScope: unknown, admissionReads: unknown, guard: Guard | undefined,
  identity: { contentId: string } | undefined, expiryCeiling: string | undefined): void {
  const seal = cleanups.get(token); if (!seal) return fail();
  const budget = requireSponsorAudioIntakeBudget(seal.cap, undefined, env);
  if (seal.used || seal.env !== env || seal.db !== env.DB || seal.auth !== budget.auth || ownerId !== seal.auth.user.userId
    || kind !== "experience-draft" || content !== seal.content || projectScope !== undefined || admissionReads !== undefined
    || guard !== seal.guard || guard.sql !== seal.guardSql || !same(guard.bindings, seal.guardBindings) || identity !== seal.identity
    || identity.contentId !== budget.draftId || expiryCeiling !== undefined) return fail();
  budget.current();
}
const metadataSchema = (names: string) => `SELECT (SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(${names}) ORDER BY name LIMIT 64)) AS schema_json`;
const metadataSql = [
  metadataSchema("'memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions'"),
  metadataSchema("'memory_document_job_answer_origins','memory_document_job_origin_dependencies'"),
  "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins,EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='assistant_turns') AS turns",
];
/** Only the actual unchanged helper can consume this adapter. It has one exact
 * three-statement metadata batch, no private body access and no write methods. */
export async function readSponsorAudioIntakeCleanupExclusion(token: SponsorAudioIntakeCleanupRead, env: WorkerEnv, ownerId: string,
  kind: string, content: string, projectScope: unknown, admissionReads: unknown, guard: Guard | undefined,
  identity: { contentId: string } | undefined, expiryCeiling: string | undefined): Promise<Guard> {
  assertSponsorAudioIntakeCleanupRead(token, env, ownerId, kind, content, projectScope, admissionReads, guard, identity, expiryCeiling);
  const seal = cleanups.get(token)!, budget = requireSponsorAudioIntakeBudget(seal.cap, undefined, env);
  seal.used = true;
  const descriptors = new WeakMap<D1PreparedStatement, string>(); let batched = false;
  const DB = {
    prepare(sql: string) {
      if (!metadataSql.includes(sql) || batched) return fail();
      const statement = Object.freeze({ bind: () => fail(), all: () => fail(), first: () => fail(), run: () => fail(), raw: () => fail() }) as unknown as D1PreparedStatement;
      descriptors.set(statement, sql); return statement;
    },
    async batch(statements: D1PreparedStatement[]) {
      budget.current();
      if (batched || !Array.isArray(statements) || statements.length !== 3
        || [0, 1, 2].some(i => !Object.hasOwn(statements, i) || descriptors.get(statements[i]!) !== metadataSql[i])) return fail();
      batched = true;
      const gate = gates(budget.assertions.map(p => ({ sql: p.sql, bindings: [...p.bindings] }))), remaining = budget.remaining();
      // All three reads share one allowance. Bound each encoded returned row
      // to its share before transfer; account the complete actual batch below.
      const share = Math.floor(Math.max(0, remaining - 2) / 3);
      const prepared = metadataSql.map((sql, i) => {
        const columns = i < 2 ? ["schema_json"] : ["origins", "turns"];
        const json = `json_object(${columns.map(c => `'${c}',row.${c}`).join(",")})`;
        const schemaBound = i < 2 ? "length(CAST(schema_json AS BLOB))<=65536" : "1";
        const ioBound = `(length(CAST(json_object('native_bound',1,'io_bound',1,'body',(${json})||'') AS BLOB))+2)<=${share}`;
        const packed = packSponsorIntakeReadQuery(`WITH ${gate.sql},audio_cleanup_row AS MATERIALIZED (${sql})
          SELECT CASE WHEN ${schemaBound} THEN 1 ELSE 0 END AS native_bound,
            CASE WHEN ${schemaBound} AND ${ioBound} THEN 1 ELSE 0 END AS io_bound,
            CASE WHEN ${schemaBound} AND ${ioBound} THEN ${json} ELSE NULL END AS body
          FROM audio_cleanup_row row CROSS JOIN ${gate.names.join(" CROSS JOIN ")}`, gate.bindings);
        return budget.db.prepare(packed.sql).bind(...packed.bindings);
      });
      budget.count(3);
      const ack = await budget.wait(() => budget.db.batch(prepared));
      budget.account(ack); ownJson(ack);
      if (!Array.isArray(ack) || ack.length !== 3) return fail();
      const results = ack.map((result, i) => {
        validAck(result);
        if (result.results.length !== 1 || Object.keys(result.results[0]!).sort().join(",") !== "body,io_bound,native_bound") return fail();
        const row = result.results[0]!;
        if (row.native_bound === 0 && i < 2) throw new Error(i === 0 ? "native_structured_origin_schema_unavailable" : "native_document_job_origin_schema_unavailable");
        if (row.native_bound !== 1 || row.io_bound !== 1 || typeof row.body !== "string") return fail();
        let decoded: unknown; try { decoded = JSON.parse(row.body); } catch { return fail(); }
        ownJson(decoded);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return fail();
        return { ...result, results: [decoded] };
      });
      budget.current(); return results;
    }, exec: () => fail(),
  } as unknown as WorkerEnv["DB"];
  const bounded = { ...env, DB };
  const exclusion = await budget.wait(() => nativeMemoryAnswerExclusion(bounded, { answerAlias: "private_content" }));
  budget.current();
  if (!batched || seal.env !== env || seal.db !== env.DB) return fail();
  return capture(exclusion);
}

type Observation = { support: readonly Guard[]; witness: Guard };
type Saved = Awaited<ReturnType<typeof readDraft>> & {};
type NativeState = { draft?: Observation; receipt?: Observation; saved?: Saved; reading: boolean; receiptSealed: boolean;
  receiptState?: ReceiptState; intake?: ProjectIntake; appendAttempted?: boolean; receiptCalls: number };
const natives = new WeakMap<SponsorAudioIntakeBudget, NativeState>();
function state(cap: SponsorAudioIntakeBudget, finalization?: SponsorAudioIntakeFinalization) {
  requireSponsorAudioIntakeBudget(cap, undefined, undefined, finalization).current();
  let value = natives.get(cap);
  if (!value) { value = { reading: false, receiptSealed: false, receiptCalls: 0 }; natives.set(cap, value); }
  return value;
}
/** The response owner calls this itself: caller-supplied proofs cannot omit a body witness. */
export function sponsorAudioIntakeReadProofs(cap: SponsorAudioIntakeBudget, finalization?: SponsorAudioIntakeFinalization): readonly SponsorAudioIntakeAssertion[] {
  const budget = requireSponsorAudioIntakeBudget(cap, undefined, undefined, finalization), native = state(cap, finalization);
  if (native.reading || !native.saved || !native.draft
    || ["audio-intake-commit", "audio-intake-receipt"].includes(budget.operation) && !native.receipt) return fail();
  const deadlineMs = Date.parse(native.saved.expiresAt);
  if (!Number.isSafeInteger(deadlineMs)) return fail();
  return Object.freeze(distinct([...(native.draft.support), native.draft.witness,
    ...(native.receipt ? [...native.receipt.support, native.receipt.witness] : [])]).map(proof => proof === native.draft!.witness
      ? Object.freeze({ ...capture(proof), deadlineMs }) : capture(proof)));
}
export function sponsorAudioIntakeNativeReplayed(cap: SponsorAudioIntakeBudget): boolean {
  const budget = requireSponsorAudioIntakeBudget(cap), native = state(cap);
  if (!["audio-intake-commit", "audio-intake-receipt"].includes(budget.operation)
    || native.reading || !native.receipt || !native.receiptState) return fail();
  return !native.appendAttempted;
}
/** Validate the emitted DTO against native observations, including the actual
 * native reply helper's status/body. No unrelated caller body can borrow proof. */
export async function requireSponsorAudioIntakeResponse(cap: SponsorAudioIntakeBudget, value: unknown, status: number,
  finalization?: SponsorAudioIntakeFinalization): Promise<void> {
  const budget = requireSponsorAudioIntakeBudget(cap, undefined, undefined, finalization), native = state(cap, finalization);
  sponsorAudioIntakeReadProofs(cap, finalization); ownJson(value);
  if (!native.saved || !value || typeof value !== "object" || Array.isArray(value)) return fail();
  const plan = native.saved.plan;
  if (["audio-intake-prepare", "audio-intake-draft"].includes(budget.operation)) {
    const replayed = (value as Row).replayed;
    if (typeof replayed !== "boolean" || (budget.operation === "audio-intake-draft" || budget.original) && !replayed) return fail();
    // Fresh prepare's winner/lost-ACK outcome belongs to the actual storage
    // orchestration; identical retained bytes cannot establish which writer won.
    const expected = { status: "prepared", plan, expiresAt: native.saved.expiresAt, replayed };
    if (status !== 200 || canonicalJson(value) !== canonicalJson(expected)) return fail();
    return;
  }
  if (!native.intake || !native.receiptState) return fail();
  const response = reply(native.intake, native.receiptState);
  const serialized = await budget.wait(() => response.text()); budget.accountSerialized(serialized);
  const body = JSON.parse(serialized) as Row;
  const expected = { ...body, draftId: plan.draftId, draftHash: plan.draftHash, generation: "unavailable",
    ...(body.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}),
    replayed: budget.operation === "audio-intake-receipt" || !native.appendAttempted };
  if (status !== response.status || canonicalJson(value) !== canonicalJson(expected)) return fail();
  budget.current();
}
function validAck(result: unknown): asserts result is D1Result<Row> {
  ownJson(result);
  if (!result || typeof result !== "object" || (result as D1Result).success !== true
    || !Object.hasOwn(result, "success") || "error" in result || !Object.hasOwn(result, "results")
    || !Array.isArray((result as D1Result).results)
    || (result as D1Result).results.some(row => !row || typeof row !== "object" || Array.isArray(row))) return fail();
}
/** Bound complete row encoding before transfer. The failure sentinel distinguishes
 * an over-limit read from an authorized empty relation; the full ACK stays charged. */
async function boundedRows(budget: Budget, sql: string, bindings: readonly unknown[], columns: readonly string[], maximumRows: number,
  proofs: readonly Guard[]): Promise<{ result: D1Result<Row>; observation: Observation }> {
  budget.current();
  const gate = gates(proofs, sql), remaining = budget.remaining();
  const values = `json_array(${columns.map(c => `row.${c}`).join(",")})`;
  const data = `SELECT json_group_array(${values}) FROM (${sql}) row`;
  const fits = `n<=${maximumRows} AND (length(CAST(json_object('bounded',1,'body',body||'') AS BLOB))+2)<=${remaining}`;
  const packed = packSponsorIntakeReadQuery(`WITH ${gate.sql},audio_native_rows AS MATERIALIZED (${sql}),
    audio_native_json AS MATERIALIZED (SELECT COUNT(*) AS n,json_group_array(${values}) AS body FROM audio_native_rows row)
    SELECT CASE WHEN ${fits} THEN 1 ELSE 0 END AS bounded,
      CASE WHEN ${fits} THEN body ELSE NULL END AS body
    FROM audio_native_json CROSS JOIN ${gate.names.join(" CROSS JOIN ")}`, [...gate.bindings, ...bindings]);
  budget.count();
  const ack = await budget.wait(() => budget.db.prepare(packed.sql).bind(...packed.bindings).all<Row>());
  budget.account(ack); validAck(ack);
  if (ack.results.length !== 1 || Object.keys(ack.results[0]!).length !== 2
    || ack.results[0]!.bounded !== 1 || typeof ack.results[0]!.body !== "string") return fail();
  const body = ack.results[0]!.body;
  let rows: unknown; try { rows = JSON.parse(body); } catch { return fail(); }
  ownJson(rows);
  if (!Array.isArray(rows) || rows.length > maximumRows || rows.some(row => !Array.isArray(row) || row.length !== columns.length)) return fail();
  const result = { ...ack, results: rows.map(row => Object.fromEntries(columns.map((key, i) => [key, row[i]]))) } as D1Result<Row>;
  return { result, observation: { support: gate.parts, witness: capture({ sql: `(${data})=?`, bindings: [...bindings as (string | number | null)[], body] }) } };
}
function readonlyStatement(execute: (bindings: unknown[], kind: "first" | "all") => Promise<unknown>, bindings: unknown[] = []): D1PreparedStatement {
  return { bind: (...next: unknown[]) => readonlyStatement(execute, next), first: (column?: string) => column === undefined ? execute(bindings, "first") : fail(),
    all: () => execute(bindings, "all"), run: () => fail(), raw: () => fail() } as D1PreparedStatement;
}
function readonlyEnv(env: WorkerEnv, prepare: (sql: string) => D1PreparedStatement): WorkerEnv {
  return { ...env, DB: Object.freeze({ prepare, batch: () => fail(), exec: () => fail() }) as unknown as WorkerEnv["DB"] };
}
export async function readSponsorAudioIntakeNativeDraft(cap: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, draftId: string, additionalProof: Guard): Promise<Saved> {
  const budget = requireSponsorAudioIntakeBudget(cap, request, env), native = state(cap);
  if (budget.auth !== auth || budget.draftId !== draftId || native.reading || native.saved) return fail();
  const additional = composeSponsorAudioIntakeWriteGuard(cap, request, env, additionalProof);
  const base = projectIntakeAuthority(env, auth, { projectId: "", documentId: "" });
  let content: string | undefined, observation: Observation | undefined, calls = 0;
  native.reading = true;
  try {
    const bounded = readonlyEnv(env, sql => readonlyStatement(async (bindings, kind) => {
      budget.current();
      if (kind !== "first" || calls >= 2) return fail();
      let data: string, expected: string, vector: unknown[], columns: string[], support: Guard[];
      if (calls++ === 0) {
        data = `SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${base.sql})`;
        expected = `${data} AND (${additional.sql})`;
        vector = [draftId, auth.user.userId, ...base.bindings, ...additional.bindings];
        columns = ["content", "expires_at"]; support = [additional];
        if (sql !== expected || !same(bindings, vector)) return fail();
        const read = await boundedRows(budget, `${data} AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536`,
          [draftId, auth.user.userId, ...base.bindings], columns, 1, support);
        const row = read.result.results[0];
        if (!row || typeof row.content !== "string" || !row.content || !row.content.isWellFormed()
          || bytes(row.content) > 65_536 || typeof row.expires_at !== "string") return fail();
        content = row.content; observation = read.observation;
        return row;
      }
      if (content === undefined) return fail();
      const plan = JSON.parse(content) as ExperiencePlan;
      const core = composeSponsorAudioIntakeGuards(projectIntakeAuthority(env, auth, plan), retainedGuard(auth, plan, content));
      expected = `SELECT 1 AS current WHERE (${core.sql}) AND (${additional.sql})`;
      vector = [...core.bindings, ...additional.bindings];
      if (sql !== expected || !same(bindings, vector)) return fail();
      const read = await boundedRows(budget, "SELECT 1 AS current", [], ["current"], 1, [core, additional]);
      if (read.result.results[0]?.current !== 1) return fail();
      observation = { support: [...read.observation.support, ...observation!.support], witness: observation!.witness };
      return read.result.results[0];
    }));
    const saved = await budget.wait(() => readDraft(bounded, auth, draftId, additional));
    budget.current();
    if (!saved || !observation || calls !== 2) return fail();
    ownJson(saved);
    const plan = saved.plan, marked = plan as unknown as Row, marker = marked.sponsor_intake;
    if (!marker || typeof marker !== "object" || Array.isArray(marker) || Object.keys(marker).sort().join(",") !== "family,receiptId,version"
      || (marker as Row).version !== 1 || (marker as Row).family !== "canonical-audio-initial-intake@1"
      || typeof (marker as Row).receiptId !== "string" || plan.request.experienceId !== "audio" || plan.release.output.output !== "audio"
      || ![5, 6].includes(plan.events.length)
      || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")) return fail();
    const rebuilt = await budget.wait(() => buildExperiencePlan(auth.user.userId, plan.request, plan.release));
    const { draftHash: _originalHash, ...rebuiltBase } = rebuilt;
    const expectedBase = JSON.parse(canonicalJson({ ...rebuiltBase, sponsor_intake: marker }));
    const expectedPlan = { ...expectedBase, draftHash: await budget.wait(() => digest(expectedBase)) };
    if (canonicalJson(plan) !== canonicalJson(expectedPlan) || saved.content !== canonicalJson(plan)) return fail();
    if (budget.command?.action === "prepare-sponsored-audio-draft" && canonicalJson(budget.command.request) !== canonicalJson(plan.request)
      || budget.command?.action === "commit-sponsored-audio-draft" && budget.command.draftHash !== plan.draftHash) return fail();
    const original = budget.original;
    if (original) {
      const payloads = plan.events.map(event => JSON.stringify(event.payload));
      const [contentDigest, sourceDigest, eventPayloadDigest] = await budget.wait(() => Promise.all([
        digest(saved.content), digest(plan.events), digest(payloads),
      ]));
      budget.current();
      if ((marker as Row).receiptId !== original.receiptId || original.actorUserId !== auth.user.userId || original.draftId !== plan.draftId
        || original.projectId !== plan.projectId || original.documentId !== plan.documentId || original.draftHash !== plan.draftHash
        || original.nativeIntentId !== plan.request.intentId || original.expiresAt !== saved.expiresAt || original.contentDigest !== contentDigest
        || original.sourceDigest !== sourceDigest || original.eventPayloadDigest !== eventPayloadDigest || original.eventCount !== plan.events.length
        || original.draftBytes !== bytes(saved.content) || original.eventBytes !== payloads.reduce((n, value) => n + bytes(value), 0)
        || original.totalBytes !== original.draftBytes + original.eventBytes) return fail();
    }
    native.saved = saved; native.draft = observation;
    return saved;
  } finally { native.reading = false; }
}

declare const receiptBrand: unique symbol;
export type SponsorAudioIntakeNativeReceipt = Readonly<{ [receiptBrand]: true }>;
type ReceiptSeal = { cap: SponsorAudioIntakeBudget; env: WorkerEnv; db: WorkerEnv["DB"]; auth: ProjectIntakeAuthorization;
  intake: ProjectIntake; options: AtomicIntakeOptions; json: string; full: Guard; authority: Guard; calls: number; reading: boolean;
  head?: number; empty: boolean; appendHead?: number; rootPrepared: boolean; ackObserved?: boolean; retired?: boolean; continued?: boolean };
const receipts = new WeakMap<SponsorAudioIntakeNativeReceipt, ReceiptSeal>();
const receiptColumns = ["requested_key", "receipt_key", "event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor",
  "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload", "private_json", "receipt_total", "current_head"];
function receiptSource(full: Guard) {
  return `SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      event.*,secret.private_json,
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
    WHERE ${full.sql} ORDER BY CAST(expected.key AS INTEGER)`;
}
function currentReceipt(token: SponsorAudioIntakeNativeReceipt, env: WorkerEnv, auth: ProjectIntakeAuthorization,
  intake: ProjectIntake, options: AtomicIntakeOptions) {
  const seal = receipts.get(token); if (!seal) return fail();
  const budget = requireSponsorAudioIntakeBudget(seal.cap, undefined, env), native = state(seal.cap);
  if (seal.env !== env || seal.db !== env.DB || seal.auth !== auth || budget.auth !== auth || seal.intake !== intake
    || seal.options !== options || options.sponsorAudioIntakeRead !== token || options.sponsorIntakeRead !== undefined
    || options.sponsorStoryIntakeRead !== undefined || options.expectedHead !== undefined
    || canonicalJson(intake) !== seal.json || seal.reading || native.reading || seal.retired) return fail();
  budget.current(); return { seal, budget, native };
}
export function sealSponsorAudioIntakeNativeReceipt(cap: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions): AtomicIntakeOptions {
  const budget = requireSponsorAudioIntakeBudget(cap, request, env), native = state(cap), plan = native.saved?.plan;
  if (budget.auth !== auth || !plan || !native.draft || native.reading || native.receiptSealed
    || !["audio-intake-commit", "audio-intake-receipt", "audio-intake-prepare"].includes(budget.operation)
    || options.sponsorIntakeRead !== undefined || options.sponsorStoryIntakeRead !== undefined
    || options.sponsorAudioIntakeRead !== undefined || options.expectedHead !== undefined
    || options.receiptPrefix !== receiptPrefix(plan.draftId) || options.clientId !== "web:experience-intake"
    || options.correlationPrefix !== "experience-intake:") return fail();
  ownJson(intake);
  if (canonicalJson(intake) !== canonicalJson({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events })) return fail();
  const token = Object.freeze({}) as SponsorAudioIntakeNativeReceipt;
  const sealed = Object.freeze({ ...options, guard: composeSponsorAudioIntakeWriteGuard(cap, request, env, options.guard), sponsorAudioIntakeRead: token });
  receipts.set(token, { cap, env, db: env.DB, auth, intake, options: sealed, json: canonicalJson(intake),
    full: capture(intakeGuard(env, auth, intake, sealed)), authority: capture(projectIntakeAuthority(env, auth, intake)),
    calls: 0, reading: false, empty: false, rootPrepared: false });
  native.receiptSealed = true; return sealed;
}
/** A check may precede new-write eligibility. Continue that exact empty native
 * observation once, retire its token, and preserve every earlier proof. */
export function continueSponsorAudioIntakeNativeReceipt(cap: SponsorAudioIntakeBudget, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, priorOptions: AtomicIntakeOptions, newGuard: Guard): AtomicIntakeOptions {
  requireSponsorAudioIntakeBudget(cap, request, env);
  if (!priorOptions.sponsorAudioIntakeRead) return fail();
  const { seal, budget, native } = currentReceipt(priorOptions.sponsorAudioIntakeRead, env, auth, intake, priorOptions);
  if (seal.cap !== cap || budget.operation !== "audio-intake-commit" || seal.calls !== 1 || native.receiptCalls !== 1
    || !seal.empty || seal.head === undefined || seal.appendHead !== undefined || native.appendAttempted || !native.receipt
    || !native.receiptState?.authorized || native.receiptState.seen || native.receiptState.complete) return fail();
  const token = Object.freeze({}) as SponsorAudioIntakeNativeReceipt;
  const guard = composeSponsorAudioIntakeWriteGuard(cap, request, env, priorOptions.guard, newGuard);
  const options = Object.freeze({ ...priorOptions, guard, sponsorAudioIntakeRead: token });
  const next: ReceiptSeal = { cap, env, db: env.DB, auth, intake, options, json: seal.json,
    full: capture(intakeGuard(env, auth, intake, options)), authority: seal.authority,
    calls: 0, reading: false, empty: false, rootPrepared: false, continued: true };
  seal.retired = true; receipts.set(token, next); return options;
}
export async function readSponsorAudioIntakeNativeReceipt(token: SponsorAudioIntakeNativeReceipt, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions, sql: string, bindings: unknown[]): Promise<D1Result<Row>> {
  const { seal, budget, native } = currentReceipt(token, env, auth, intake, options);
  if (native.receiptCalls >= 3) return fail();
  const prefix = options.receiptPrefix, stream = auth.user.streamId;
  const vector = [stream, prefix.length, prefix, stream, JSON.stringify(intake.events.map(e => String(e.payload.client_event_id))), stream, auth.user.userId];
  if (sql !== receiptSource(seal.full) || !same(bindings, [...vector, ...seal.full.bindings])) return fail();
  const suffix = `\n    WHERE ${seal.full.sql} ORDER BY CAST(expected.key AS INTEGER)`;
  const data = sql.slice(0, -suffix.length).replace("event.*,secret.private_json", `${receiptColumns.slice(2, 15).map(c => `event.${c}`).join(",")},secret.private_json`)
    + " ORDER BY CAST(expected.key AS INTEGER)";
  seal.reading = true; native.reading = true; seal.calls++; native.receiptCalls++;
  try {
    const read = await boundedRows(budget, data, vector, receiptColumns, intake.events.length, [seal.authority, options.guard]);
    budget.current();
    const rows = read.result.results, head = rows[0]?.current_head;
    seal.head = typeof head === "number" && Number.isSafeInteger(head) && head >= 0 && rows.length === intake.events.length
      && rows.every(row => row.current_head === head) ? head : undefined;
    seal.empty = seal.head !== undefined && rows.every((row, i) => row.requested_key === intake.events[i]!.payload.client_event_id
      && row.receipt_total === 0 && row.receipt_key === null && receiptColumns.slice(2, 16).every(column => row[column] === null));
    // Same exact native state used by readOriginal. The native reply helper
    // remains responsible for translating that state into HTTP/body semantics.
    const authorized = rows.length === intake.events.length, events: EventRow[] = [];
    const seen = authorized && Number(rows[0]?.receipt_total ?? 0) > 0;
    let complete = authorized && Number(rows[0]?.receipt_total) === intake.events.length;
    if (authorized) for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, input = intake.events[i]!;
      if (row.receipt_key !== input.payload.client_event_id || row.requested_key !== input.payload.client_event_id
        || typeof row.private_json !== "string" || row.actor !== "user" || row.type !== input.type || row.stream_id !== stream) { complete = false; continue; }
      try {
        const event = serializeEvent(row);
        if (projectIntakeValue(event.payload) !== projectIntakeValue(input.payload) || event.compensatesEventId !== null) complete = false;
        events.push(event);
      } catch { complete = false; }
    }
    native.receiptState = { authorized, seen, complete: complete && events.length === intake.events.length,
      events: complete ? events : [], head: authorized ? Number(rows[0]?.current_head ?? 0) : 0 };
    native.intake = intake;
    native.receipt = read.observation;
    return read.result;
  } finally { seal.reading = false; native.reading = false; }
}
/** The head comes only from the charged native observation. A single initialHead
 * attempt avoids both hidden streamHead reads while retaining every native CAS. */
export function sponsorAudioIntakeNativeAppendOptions(token: SponsorAudioIntakeNativeReceipt, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions): { initialHead: number; retries: 1; observeBatchResult: (result: D1Result[]) => void } {
  const { seal, budget, native } = currentReceipt(token, env, auth, intake, options);
  if (budget.operation !== "audio-intake-commit" || !seal.continued || seal.calls !== 1 || native.receiptCalls !== 2
    || seal.head === undefined || !seal.empty || seal.appendHead !== undefined) return fail();
  budget.count(intake.events.length * 2);
  seal.appendHead = seal.head; state(seal.cap).appendAttempted = true;
  return { initialHead: seal.head, retries: 1, observeBatchResult(result) {
    currentReceipt(token, env, auth, intake, options);
    if (seal.ackObserved || !seal.rootPrepared) return fail();
    seal.ackObserved = true;
    budget.account(result); ownJson(result);
    if (!Array.isArray(result) || result.length !== intake.events.length * 2) return fail();
    result.forEach(validAck); budget.current();
  } };
}
const rootInsert = "INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)";
const rootValues = (guard: Guard) => `?,?,CASE WHEN ${guard.sql}
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN events saved
            ON saved.event_id=json_extract(expected.value,'$.id') AND saved.stream_id=? AND saved.actor='user'
              AND saved.type=json_extract(expected.value,'$.type') AND saved.sequence=json_extract(expected.value,'$.sequence')
            JOIN event_private_payloads secret ON secret.private_event_id=saved.event_id AND secret.owner_id=?
              AND secret.redacted_at IS NULL AND secret.private_json=json_extract(expected.value,'$.payload'))=?
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN event_client_receipts receipt
            ON receipt.stream_id=? AND receipt.client_event_id=json_extract(expected.value,'$.key')
              AND receipt.event_id=json_extract(expected.value,'$.id') AND receipt.sequence=json_extract(expected.value,'$.sequence')
            WHERE CAST(expected.key AS INTEGER)>0)=?
          AND NOT EXISTS(SELECT 1 FROM events prior WHERE prior.stream_id=? AND prior.type IN('ProjectCreated','DocumentCreated','DocumentForked','BlockCreated','ReferenceIngested')
            AND (json_extract(prior.payload,'$.project_id') IN(SELECT value FROM json_each(?)) AND prior.type='ProjectCreated'
              OR json_extract(prior.payload,'$.document_id') IN(SELECT value FROM json_each(?)) AND prior.type IN('DocumentCreated','DocumentForked')
              OR json_extract(prior.payload,'$.block_id') IN(SELECT value FROM json_each(?)) AND prior.type='BlockCreated'
              OR json_extract(prior.payload,'$.reference_id') IN(SELECT value FROM json_each(?)) AND prior.type='ReferenceIngested')
            AND prior.event_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
          THEN ? ELSE NULL END,?,?`;
export function prepareSponsorAudioIntakeNativeRootReceipt(token: SponsorAudioIntakeNativeReceipt, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions, sql: string, bindings: readonly unknown[]): D1PreparedStatement {
  const { seal, budget } = currentReceipt(token, env, auth, intake, options), at = 2 + seal.full.bindings.length;
  if (budget.operation !== "audio-intake-commit" || seal.appendHead === undefined || seal.rootPrepared
    || sql !== `${rootInsert}\n        VALUES(${rootValues(seal.full)})` || bindings.length !== at + 16
    || !same(bindings.slice(2, at), seal.full.bindings)) return fail();
  const tail = bindings.slice(at), stream = auth.user.streamId;
  const resources = JSON.stringify([...new Set(intake.events.flatMap(event => [event.payload.project_id, event.payload.document_id,
    event.payload.block_id, event.payload.reference_id].filter((id): id is string => typeof id === "string")))]);
  if (bindings[0] !== stream || bindings[1] !== intake.events[0]!.payload.client_event_id || typeof tail[0] !== "string"
    || tail[0] !== tail[4] || tail[0] !== tail[12] || tail[1] !== stream || tail[2] !== auth.user.userId || tail[3] !== intake.events.length
    || tail[5] !== stream || tail[6] !== intake.events.length - 1 || tail[7] !== stream || !tail.slice(8, 12).every(v => v === resources)
    || typeof tail[15] !== "string" || !Number.isFinite(Date.parse(tail[15]))) return fail();
  let assigned: unknown; try { assigned = JSON.parse(tail[0]); } catch { return fail(); }
  ownJson(assigned);
  if (!Array.isArray(assigned) || assigned.length !== intake.events.length) return fail();
  const ids = new Set<string>();
  for (let i = 0; i < assigned.length; i++) {
    const row = assigned[i], event = intake.events[i]!;
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "id,key,payload,sequence,type"
      || typeof row.id !== "string" || !/^[a-f0-9-]{36}$/u.test(row.id) || ids.has(row.id)
      || row.key !== event.payload.client_event_id || row.type !== event.type || row.sequence !== seal.appendHead + i + 1
      || row.payload !== JSON.stringify(event.payload)) return fail();
    ids.add(row.id);
  }
  if (tail[13] !== assigned[0].id || tail[14] !== assigned[0].sequence) return fail();
  const compiled = compiledGuards.get(options.guard);
  if (!compiled || compiled.cap !== seal.cap || !same(options.guard.bindings, compiled.bindings)) return fail();
  const condition = compiled.names.map(name => `${name}.passed IS NOT NULL`).join(" AND ");
  const values = rootValues({ sql: `(${seal.authority.sql}) AND (${condition})`, bindings: [] });
  // LEFT JOIN preserves the native failure row: false or NULL still reaches
  // the original NOT NULL root assertion and rolls back the whole append batch.
  const statement = env.DB.prepare(`${rootInsert} ${compiled.ctes} SELECT ${values} FROM (SELECT 1) audio_intake_root_row ${compiled.names.map(name => `LEFT JOIN ${name} ON 1`).join(" ")}`)
    .bind(...compiled.bindings, ...bindings.slice(0, 2), ...seal.authority.bindings, ...tail);
  seal.rootPrepared = true; return statement;
}
