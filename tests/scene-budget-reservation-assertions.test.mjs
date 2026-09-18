import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// New isolated controls: actual selected preparation/reservation function bodies
// and the existing CHECK helper, with explicit authority/policy/module-load ports.
// They do not exercise live authorization, D1, Scene routes, a provider, or a held
// suite. Root must apply the companion patch before running this repo-relative file.
const pilot = await readFile(new URL("../worker/pilot-policy.ts", import.meta.url), "utf8");
const core = await readFile(new URL("../worker/output-command-core.ts", import.meta.url), "utf8");
function between(source, start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, `missing source start: ${start}`);
  const finish = source.indexOf(end, offset + start.length);
  assert.ok(finish > offset, `missing source end: ${end}`);
  return source.slice(offset, finish);
}
const admitted = pilot.split("\n").find(line => line.startsWith("async function budgetReservationAdmitted("));
assert.ok(admitted);
let selected = [
  admitted,
  between(pilot, "async function budgetReservationAssertionStatements(", "\ntype BudgetReservationContext"),
  between(pilot, "function budgetCounterRowStatements(", "\nexport async function readBudgets("),
  between(pilot, "export async function prepareBudgetReservation(", "\nasync function budgetReservation("),
  between(pilot, "function costBudgetRowStatements(", "\n/** Initialize existing counter metadata"),
  between(pilot, "export async function prepareCostBudgetReservation(", "\nasync function resolveCostReservation("),
  between(core, "export function outputAssertionStatements(", "\n/** Repeat live authority"),
].join("\n");
const importPort = 'const {outputAssertionStatements}=await import("./output-command-core.ts");';
assert.equal(selected.split(importPort).length, 2, "replace exactly one module-load port, not proof logic");
selected = selected.replace(importPort, "await Promise.resolve();").replace(/^export /gm, "");
const javascript = stripTypeScriptTypes(selected, { mode: "transform" });
const createApi = new Function("ports", `
  const { period, budgetLimits, costBudgetLimits, uuidV7, outputSchemaIsReady,
    assertOutputAdmissionBudget, readOutputAdmissionValue, projectBudgetPolicy,
    activeProjectBillingSql, pilotExecutionAllowance, initializeOutputAdmissionCounters,
    budgetReservation, costBudgetReservation, readBudgets } = ports;
  ${javascript}
  return {prepareBudgetReservation,reserveBudget,prepareCostBudgetReservation,reserveCostBudget};
`);

const fixedPeriod = "2026-09";
const projectScope = { organizationId: "org", projectAccessId: "access", actorUserId: "owner" };
const proof = () => ({ sql: "EXISTS(SELECT 1 FROM source_evidence WHERE id=? AND body=?)", bindings: ["source", "original"] });
function fixture({ ready = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
    CREATE TABLE source_evidence(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    INSERT INTO source_evidence VALUES('source','original');
    CREATE TABLE budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_tokens INTEGER,reserved_tokens INTEGER,hard_limit_tokens INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
    CREATE TABLE cost_budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_microusd INTEGER,reserved_microusd INTEGER,hard_limit_microusd INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
    CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_tokens INTEGER,used_tokens INTEGER,status TEXT,settlement_reason TEXT,created_at TEXT,settled_at TEXT,updated_at TEXT);
    CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,workspace_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_microusd INTEGER,used_microusd INTEGER,status TEXT,allow_user_overage INTEGER,created_at TEXT,settled_at TEXT,updated_at TEXT);
    CREATE TABLE project_budget_reservation_scopes(reservation_kind TEXT,reservation_id TEXT,organization_id TEXT,project_access_id TEXT,actor_user_id TEXT,workspace_scope_id TEXT,created_at TEXT,PRIMARY KEY(reservation_kind,reservation_id));
    CREATE TABLE budget_scope_policies(scope TEXT,scope_id TEXT,organization_id TEXT,token_limit INTEGER,microusd_limit INTEGER);
    INSERT INTO budget_scope_policies VALUES('workspace','org','org',1000,1000);
  `);
  let serial = 0, outsideWrites = 0, batches = 0, initializationCalls = 0;
  const seen = [];
  const env = { DB: {
    prepare(sql) {
      const statement = {
        sql, bindings: [],
        bind(...bindings) { return { ...statement, bindings }; },
        async run() { outsideWrites++; const result = db.prepare(this.sql).run(...this.bindings); return { success: true, meta: { changes: Number(result.changes) } }; },
        async first() { return db.prepare(this.sql).get(...this.bindings) ?? null; },
        async all() { return { success: true, results: db.prepare(this.sql).all(...this.bindings) }; },
      };
      return statement;
    },
    async batch(statements) {
      batches++; seen.push(statements.map(statement => ({ sql: statement.sql, bindings: [...statement.bindings] })));
      db.exec("BEGIN");
      try {
        const results = statements.map(statement => {
          const prepared = db.prepare(statement.sql);
          if (/^\s*SELECT\b/u.test(statement.sql)) return { success: true, results: prepared.all(...statement.bindings), meta: { changes: 0 } };
          const result = prepared.run(...statement.bindings);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec("COMMIT"); return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } };
  const api = createApi({
    period: () => fixedPeriod,
    budgetLimits: () => ({ user: 100, workspace: 1000 }),
    costBudgetLimits: () => ({ user: 10, workspace: 1000 }),
    uuidV7: () => `isolated-${++serial}`,
    outputSchemaIsReady: candidate => candidate === env.DB && ready,
    assertOutputAdmissionBudget: () => {},
    readOutputAdmissionValue: (_reads, _key, read) => read(),
    projectBudgetPolicy: async () => ({ token_limit: 1000, microusd_limit: 1000 }),
    // Five bindings, matching the existing caller contract; this deliberately
    // permits the fixture principal and makes no live authority claim.
    activeProjectBillingSql: "(?=? AND ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL)",
    pilotExecutionAllowance: async () => ({ allowed: true, pilot: null }),
    initializeOutputAdmissionCounters: async () => { initializationCalls++; throw new Error("separate counter initialization must not run in asserted controls"); },
    budgetReservation: async (_env, user, id) => db.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").get(id, user) ?? null,
    costBudgetReservation: async (_env, user, id) => db.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").get(id, user) ?? null,
    readBudgets: async () => { throw new Error("unexpected budget-limit fallback in this control"); },
  });
  const options = extra => ({ reservationId: "reservation", period: fixedPeriod, streamId: "creative:owner", correlationId: "scene", operation: "scene", ...extra });
  const prepare = (kind, extra = {}) => kind === "tokens"
    ? api.prepareBudgetReservation(env, "owner", 20, options(extra))
    : api.prepareCostBudgetReservation(env, "owner", 20, { maximumMicrousd: 100, allowUserOverage: true, ...options(extra) });
  const reserve = (kind, extra = {}) => kind === "tokens"
    ? api.reserveBudget(env, "owner", 20, options(extra))
    : api.reserveCostBudget(env, "owner", 20, { maximumMicrousd: 100, allowUserOverage: true, ...options(extra) });
  const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return { db, env, prepare, reserve, count, seen, get outsideWrites() { return outsideWrites; }, get batches() { return batches; }, get initializationCalls() { return initializationCalls; } };
}

test("all original proofs, counters, reservations and project scopes share the rejecting transaction", async () => {
  for (const kind of ["tokens", "cost"]) for (const failed of [0, 1]) {
    const f = fixture();
    try {
      f.db.exec("INSERT INTO source_evidence VALUES('second','original')");
      const assertions = [proof(), { sql: "EXISTS(SELECT 1 FROM source_evidence WHERE id=? AND body=?)", bindings: ["second", "original"] }];
      const prepared = await f.prepare(kind, { projectScope, outputAdmissionReads: {}, reservationAssertions: assertions });
      assert.equal(prepared.ok, true); assert.equal(f.outsideWrites, 0); assert.equal(f.batches, 0); assert.equal(f.initializationCalls, 0);
      assert.equal(prepared.reservationStatementIndex, kind === "tokens" ? 10 : 11);
      if (kind === "cost") assert.equal(prepared.userBeforeStatementIndex, 10);
      assert.equal(prepared.statements.filter(statement => statement.sql.startsWith("INSERT INTO output_atomic_assertions")).length, 2);
      // Each refusal changes the corresponding database row after capture;
      // neither case modifies retained assertion SQL or bindings.
      f.db.prepare("UPDATE source_evidence SET body='changed' WHERE id=?").run(failed === 0 ? "source" : "second");
      await assert.rejects(f.env.DB.batch(prepared.statements));
      for (const table of ["budget_counters", "cost_budget_counters", "budget_reservations", "cost_budget_reservations", "project_budget_reservation_scopes", "output_atomic_assertions"]) assert.equal(f.count(table), 0, table);
      assert.equal(f.outsideWrites, 0);
    } finally { f.db.close(); }
  }
});

test("successful guarded token/cost reservations and exact replay keep result indexes and counters", async () => {
  for (const kind of ["tokens", "cost"]) {
    const f = fixture();
    try {
      const options = { projectScope, outputAdmissionReads: {}, reservationAssertions: [proof(), { sql: "1=1" }] };
      const result = await f.reserve(kind, options); assert.equal(result.ok, true);
      if (kind === "cost") assert.equal(result.userOverageMicrousd, 10, "userBefore must be the SELECT, not a prepended proof result");
      const replay = await f.reserve(kind, options); assert.equal(replay.ok, true); assert.equal(replay.reused, true);
      const table = kind === "tokens" ? "budget_counters" : "cost_budget_counters", column = kind === "tokens" ? "reserved_tokens" : "reserved_microusd";
      const rows = f.db.prepare(`SELECT ${column} AS reserved FROM ${table}`).all();
      assert.equal(rows.length, 3); assert.deepEqual(rows.map(row => row.reserved), [20, 20, 20]);
      assert.equal(f.count("project_budget_reservation_scopes"), 1); assert.equal(f.count("output_atomic_assertions"), 0);
      assert.equal(f.outsideWrites, 0); assert.equal(f.initializationCalls, 0);
      f.db.exec("UPDATE source_evidence SET body='changed'");
      await assert.rejects(f.reserve(kind, options), "a failed proof must not fall through to successful replay");
      assert.equal(f.count("project_budget_reservation_scopes"), 1);
    } finally { f.db.close(); }
  }
});

test("missing schema readiness fails closed before counter initialization, without ensuring schema", async () => {
  for (const kind of ["tokens", "cost"]) {
    const f = fixture({ ready: false });
    try {
      await assert.rejects(f.prepare(kind, { reservationAssertions: [proof()] }), /output_budget_assertion_schema_unavailable/u);
      assert.equal(f.outsideWrites, 0); assert.equal(f.batches, 0); assert.equal(f.count("budget_counters"), 0); assert.equal(f.count("cost_budget_counters"), 0);
    } finally { f.db.close(); }
  }
});

test("a missing physical assertion table aborts without committing counters or reservations", async () => {
  for (const kind of ["tokens", "cost"]) {
    const f = fixture();
    try {
      f.db.exec("DROP TABLE output_atomic_assertions");
      await assert.rejects(f.reserve(kind, { reservationAssertions: [proof()] }), /output_atomic_assertions/u);
      for (const table of ["budget_counters", "cost_budget_counters", "budget_reservations", "cost_budget_reservations", "project_budget_reservation_scopes"]) assert.equal(f.count(table), 0);
      assert.equal(f.outsideWrites, 0);
    } finally { f.db.close(); }
  }
});

test("omitted and empty proof arrays preserve ordinary reservation behavior with split counter indexes", async () => {
  for (const kind of ["tokens", "cost"]) for (const extra of [{}, { reservationAssertions: [] }]) {
    const f = fixture({ ready: false });
    try {
      const prepared = await f.prepare(kind, { batchCounterInitialization: true, ...extra });
      assert.equal(prepared.ok, true); assert.equal(prepared.reservationStatementIndex, kind === "tokens" ? 4 : 5);
      if (kind === "cost") assert.equal(prepared.userBeforeStatementIndex, 4);
      assert.equal(prepared.statements.some(statement => statement.sql.includes("output_atomic_assertions")), false);
      await f.env.DB.batch(prepared.statements);
      assert.equal(f.count(kind === "tokens" ? "budget_reservations" : "cost_budget_reservations"), 1);
      assert.equal(f.outsideWrites, 0);
    } finally { f.db.close(); }
  }
});

test("the existing reservationGuard still refuses independently of source proof success", async () => {
  for (const kind of ["tokens", "cost"]) {
    const f = fixture();
    try {
      const result = await f.reserve(kind, { reservationAssertions: [proof()], reservationGuard: { sql: "?=?", bindings: [1, 0] } });
      assert.deepEqual(result, { ok: false, scope: "authorization" });
      assert.equal(f.count("budget_reservations"), 0); assert.equal(f.count("cost_budget_reservations"), 0);
    } finally { f.db.close(); }
  }
});

test("source assertion bindings are captured before the optional module-load yield", async () => {
  const f = fixture();
  try {
    const original = proof(), pending = f.prepare("tokens", { reservationAssertions: [original] });
    original.bindings[1] = "changed";
    const prepared = await pending; assert.equal(prepared.ok, true);
    await f.env.DB.batch(prepared.statements); assert.equal(f.count("budget_reservations"), 1);
  } finally { f.db.close(); }
});
