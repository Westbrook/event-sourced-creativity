import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Exact paid-dispatch module and existing proof-read function, with explicit
// policy/consent ports. SQLite provides real snapshot/query behavior, but this
// does not claim native admission, real pilot entitlement, D1, or provider use.
const paidSource = await readFile(new URL("../worker/scene-paid-dispatch.ts", import.meta.url), "utf8");
const proofSource = await readFile(new URL("../worker/output-disclosure-proof.ts", import.meta.url), "utf8");
const start = proofSource.indexOf("function outputProofReadStatements(");
const end = proofSource.indexOf("\nfunction assertOutputProofRead(", start);
assert.ok(start >= 0 && end > start);
const selected = paidSource.replace(/^import .*;\n/gm, "").replace(/^export /gm, "") + "\n" + proofSource.slice(start, end);
assert.equal(/^import /m.test(selected), false, "all module ports must be explicit");
const javascript = stripTypeScriptTypes(selected, { mode: "transform" });
const createApi = new Function("ports", `
  const {claimedSceneBudgetGuard,requireSceneCostDeadline,ProviderRequestError,fail}=ports;
  ${javascript}
  return {scenePaidDispatchDeadline,ScenePaidPolicyStopError};
`);

function fixture({ pilot = true, now = Date.now(), sourceUntil = now + 600_000, consentUntil = now + 600_000, pilotUntil = now + 300_000 } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE source_history(event_id TEXT PRIMARY KEY,body TEXT NOT NULL);
    INSERT INTO source_history VALUES('current','current source'),('historical','original historical source');
    CREATE TABLE paid_holds(reservation_id TEXT PRIMARY KEY,cohort_id TEXT,status TEXT NOT NULL);
    CREATE TABLE pilot_cohorts(cohort_id TEXT,organization_id TEXT,ends_at TEXT,PRIMARY KEY(cohort_id,organization_id));`);
  db.prepare("INSERT INTO paid_holds VALUES(?,?,?)").run("original-cost", pilot ? "original-cohort" : null, "executing");
  if (pilot) db.prepare("INSERT INTO pilot_cohorts VALUES(?,?,?)").run("original-cohort", "org", new Date(pilotUntil).toISOString());
  const sourceRows = db.prepare("SELECT event_id,body FROM source_history ORDER BY event_id").all();
  const assertions = Object.freeze(sourceRows.map(row => Object.freeze({
    sql: "EXISTS(SELECT 1 FROM source_history WHERE event_id=? AND body=?)",
    bindings: Object.freeze([row.event_id, row.body]), deadlineMs: sourceUntil,
  })));
  const scope = pilot ? { organizationId: "org", projectAccessId: "access", projectId: "project", ownerUserId: "owner", actorUserId: "owner" } : undefined;
  const prepared = Object.freeze({
    binding: Object.freeze({ actorUserId: "owner", streamId: "creative:owner", period: "2026-09" }),
    scope, assertions, validUntil: new Date(consentUntil).toISOString(),
  });
  const claim = Object.freeze({ actorUserId: "owner", streamId: "creative:owner", period: "2026-09", projectScope: scope,
    costReservationId: "original-cost", tokenReservationId: "original-tokens", reservedTokens: 20, reservedMicrousd: 40,
    pilotCohortId: pilot ? "original-cohort" : null });
  const controls = { beforeSnapshot: null, afterSnapshot: null, transform: null, transportError: null, calls: [] };
  const env = { DB: {
    prepare(sql) { return { sql, values: [], bind(...values) { return { ...this, values }; } }; },
    async batch(statements) {
      controls.calls.push(statements.map(statement => ({ sql: statement.sql, values: [...statement.values] })));
      if (controls.transportError) throw controls.transportError;
      await controls.beforeSnapshot?.();
      let results; db.exec("BEGIN");
      try {
        results = statements.map(statement => ({ success: true, results: db.prepare(statement.sql).all(...statement.values), meta: { changes: 0 } }));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      await controls.afterSnapshot?.();
      return controls.transform ? controls.transform(results) : results;
    },
  } };
  const api = createApi({
    claimedSceneBudgetGuard: (_env, original) => ({
      sql: "EXISTS(SELECT 1 FROM paid_holds WHERE reservation_id=? AND cohort_id IS ? AND status='executing')",
      bindings: [original.costReservationId, original.pilotCohortId ?? null],
    }),
    requireSceneCostDeadline: value => { if (!(Date.parse(value.validUntil) > Date.now())) throw Object.assign(new Error("fixture consent deadline expired"), { code: "fixture_consent_expired" }); },
    ProviderRequestError: class extends Error { constructor(detail) { super(detail.message); this.detail = detail; } },
    fail: (code, status) => { throw Object.assign(new Error(code), { code, status }); },
  });
  return { db, env, controls, prepared, claim, api, sourceRows,
    invoke: () => api.scenePaidDispatchDeadline(env, prepared, claim),
    stop: error => error instanceof api.ScenePaidPolicyStopError && error.code === "scene_paid_authority_changed",
    close: () => db.close(),
  };
}

for (const pilot of [false, true]) test("all original source predicates and " + (pilot ? "pinned pilot" : "no-pilot") + " hold share one successful snapshot", async () => {
  const f = fixture({ pilot });
  try {
    assert.equal(Object.hasOwn(f.prepared, "guard"), false, "the old monolithic guard is not supplied");
    const result = await f.invoke();
    assert.equal(f.controls.calls.length, 1);
    const statements = f.controls.calls[0]; assert.equal(statements.length, f.prepared.assertions.length + 1);
    for (const [index, original] of f.prepared.assertions.entries()) {
      assert.ok(statements[index].sql.includes(original.sql)); assert.deepEqual(statements[index].values, original.bindings);
    }
    assert.match(statements.at(-1).sql, /pilot_ends_at/u); assert.ok(statements.at(-1).values.includes("original-cost"));
    assert.equal(result.pilotValidUntil, pilot ? f.db.prepare("SELECT ends_at FROM pilot_cohorts").get().ends_at : null);
    assert.equal(result.validUntil, pilot ? result.pilotValidUntil : f.prepared.validUntil);
    assert.deepEqual(f.db.prepare("SELECT event_id,body FROM source_history ORDER BY event_id").all(), f.sourceRows);
  } finally { f.close(); }
});

for (const target of ["current", "historical", "paid"]) test("the original " + target + " witness cannot change before final paid snapshot", async () => {
  const f = fixture();
  try {
    f.controls.beforeSnapshot = () => {
      if (target === "paid") f.db.exec("UPDATE paid_holds SET reservation_id='successor-cost'");
      else f.db.prepare("UPDATE source_history SET body=? WHERE event_id=?").run("changed " + target + " source", target);
    };
    await assert.rejects(f.invoke(), f.stop);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM source_history").get().count, 2);
    assert.equal(f.controls.calls.length, 1);
  } finally { f.close(); }
});

const malformed = [
  ["non-array null batch", () => null],
  ["non-array object batch", () => ({ length: 3 })],
  ["missing batch result", rows => rows.slice(1)],
  ["extra batch result", rows => [...rows, rows[0]]],
  ["null source result", rows => { rows[0] = null; return rows; }],
  ["undefined source result", rows => { rows[0] = undefined; return rows; }],
  ["sparse source slot", rows => { delete rows[0]; return rows; }],
  ["source success omitted", rows => { delete rows[0].success; return rows; }],
  ["source success false", rows => { rows[0].success = false; return rows; }],
  ["source row missing", rows => { rows[0].results = []; return rows; }],
  ["source extra row", rows => { rows[0].results.push({ current: 1 }); return rows; }],
  ["coercible source truth", rows => { rows[0].results[0].current = "1"; return rows; }],
  ["null paid result", rows => { rows[rows.length - 1] = null; return rows; }],
  ["paid success omitted", rows => { delete rows.at(-1).success; return rows; }],
  ["paid success false", rows => { rows.at(-1).success = false; return rows; }],
  ["paid row missing", rows => { rows.at(-1).results = []; return rows; }],
  ["paid extra row", rows => { rows.at(-1).results.push({ ...rows.at(-1).results[0] }); return rows; }],
  ["coercible paid truth", rows => { rows.at(-1).results[0].current = "1"; return rows; }],
  ["pilot deadline omitted", rows => { delete rows.at(-1).results[0].pilot_ends_at; return rows; }],
  ["pilot deadline invalid", rows => { rows.at(-1).results[0].pilot_ends_at = "not a date"; return rows; }],
];
for (const [name, transform] of malformed) test("returned " + name + " is a nominal policy stop, not accepted evidence", async () => {
  const f = fixture();
  try { f.controls.transform = transform; await assert.rejects(f.invoke(), f.stop); }
  finally { f.close(); }
});

for (const boundary of ["source", "pilot", "consent"]) test(boundary + " expiry after the final snapshot is checked again after await", async t => {
  const initial = Date.now(), expiry = initial + 60_000; let now = initial;
  t.mock.method(Date, "now", () => now);
  const f = fixture({ now: initial, sourceUntil: boundary === "source" ? expiry : initial + 600_000,
    pilotUntil: boundary === "pilot" ? expiry : initial + 600_000,
    consentUntil: boundary === "consent" ? expiry : initial + 600_000 });
  try {
    f.controls.afterSnapshot = () => { now = expiry + 1; };
    await assert.rejects(f.invoke(), boundary === "consent" ? error => error.code === "fixture_consent_expired" : f.stop);
    assert.equal(f.controls.calls.length, 1);
  } finally { f.close(); }
});

test("a still-current post-await snapshot returns its original earlier pilot deadline", async t => {
  const initial = Date.now(); let now = initial; t.mock.method(Date, "now", () => now);
  const f = fixture({ now: initial });
  try {
    f.controls.afterSnapshot = () => { now = initial + 1; };
    const result = await f.invoke();
    assert.equal(result.validUntil, new Date(initial + 300_000).toISOString());
    assert.equal(result.pilotValidUntil, result.validUntil);
  } finally { f.close(); }
});

test("an unknown thrown DB/transport failure retains its exact identity", async () => {
  const f = fixture(), error = new Error("unknown snapshot transport failure");
  try {
    f.controls.transportError = error;
    await assert.rejects(f.invoke(), actual => actual === error && !f.stop(actual));
  } finally { f.close(); }
});
