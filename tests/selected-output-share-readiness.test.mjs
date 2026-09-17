import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "../worker/selected-output-share-schema.ts";
import { selectedOutputShareSchemaAssertion, selectedOutputShareSchemaState } from "../worker/selected-output-share-readiness.ts";

function fixture(t, statements = SELECTED_OUTPUT_SHARE_SCHEMA) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const sql of statements) sqlite.exec(sql);
  const queries = [];
  const env = { DB: { prepare(sql) {
    assert.match(sql, /^SELECT /u, "readiness cannot perform DDL or data writes");
    assert.ok(Buffer.byteLength(sql) < 100_000);
    return { bind(...bindings) {
      assert.ok(bindings.length <= 100);
      return { async all() {
        queries.push({ sql, bindings });
        return { success: true, results: sqlite.prepare(sql).all(...bindings) };
      } };
    } };
  } } };
  return { sqlite, env, queries };
}
function assertGuard(sqlite, state) {
  const guard = selectedOutputShareSchemaAssertion(state);
  return sqlite.prepare(`SELECT (${guard.sql}) AS permitted`).get(...guard.bindings).permitted;
}
const triggerNames = SELECTED_OUTPUT_SHARE_SCHEMA.filter(sql => sql.startsWith("CREATE TRIGGER "))
  .map(sql => /^CREATE TRIGGER (\w+)/u.exec(sql)[1]);

test("readiness and reusable assertions accept only the actual canonical installed schema without writes", async t => {
  const f = fixture(t);
  const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready");
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready");
  assert.equal(f.queries.length, 2, "success is never cached");
  assert.equal(assertGuard(f.sqlite, "ready"), 1);
  assert.equal(assertGuard(f.sqlite, "absent"), 0);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  assert.ok(f.queries.every(query => !/\b(?:selected_output_shares WHERE|ensureSchema)\b/u.test(query.sql)));
});

test("total absence is distinguished from unavailable without installing anything", async t => {
  const f = fixture(t, []);
  assert.equal(await selectedOutputShareSchemaState(f.env), "absent");
  assert.equal(assertGuard(f.sqlite, "absent"), 1);
  assert.equal(assertGuard(f.sqlite, "ready"), 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM sqlite_schema").get().n, 0);
  for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
  assert.equal(assertGuard(f.sqlite, "absent"), 0, "an earlier absence cannot authorize a later transaction");
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready");
});

for (const name of triggerNames) test(`a missing ${name} immediately invalidates readiness and the final assertion`, async t => {
  const f = fixture(t);
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready");
  f.sqlite.exec(`DROP TRIGGER ${name}`);
  assert.equal(assertGuard(f.sqlite, "ready"), 0);
  assert.equal(await selectedOutputShareSchemaState(f.env), "unavailable");
  assert.equal(assertGuard(f.sqlite, "absent"), 0);
  f.sqlite.exec(SELECTED_OUTPUT_SHARE_SCHEMA.find(sql => sql.startsWith(`CREATE TRIGGER ${name} `)));
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready", "a repaired installation is freshly observed");
});

for (const [label, mutate] of [
  ["table only", f => {
    for (const row of f.sqlite.prepare("SELECT name,type FROM sqlite_schema WHERE tbl_name='selected_output_shares' AND type IN('index','trigger') AND sql IS NOT NULL").all())
      f.sqlite.exec(`DROP ${row.type} ${row.name}`);
  }],
  ["missing owner index", f => f.sqlite.exec("DROP INDEX selected_output_shares_owner")],
  ["wrong owner index", f => f.sqlite.exec("DROP INDEX selected_output_shares_owner; CREATE INDEX selected_output_shares_owner ON selected_output_shares(share_id)")],
  ["weakened trigger", f => f.sqlite.exec(`DROP TRIGGER ${triggerNames[0]}; CREATE TRIGGER ${triggerNames[0]} BEFORE UPDATE ON selected_output_shares BEGIN SELECT 1; END`)],
  ["extra trigger", f => f.sqlite.exec("CREATE TRIGGER selected_share_unexpected AFTER INSERT ON SELECTED_OUTPUT_SHARES BEGIN SELECT 1; END")],
  ["extra index", f => f.sqlite.exec("CREATE INDEX selected_share_unexpected ON SELECTED_OUTPUT_SHARES(share_id)")],
  ["temp table shadow", f => f.sqlite.exec("CREATE TEMP TABLE selected_output_shares(share_id TEXT)")],
  ["temp trigger", f => f.sqlite.exec("CREATE TEMP TRIGGER selected_share_unexpected AFTER INSERT ON main.selected_output_shares BEGIN SELECT 1; END")],
]) test(`installed ${label} fails closed`, async t => {
  const f = fixture(t);
  mutate(f);
  assert.equal(await selectedOutputShareSchemaState(f.env), "unavailable");
  assert.equal(assertGuard(f.sqlite, "ready"), 0);
  assert.equal(assertGuard(f.sqlite, "absent"), 0);
});

for (const [label, table] of [
  ["wrong purpose constraint", SELECTED_OUTPUT_SHARE_SCHEMA[0].replace("purpose='selected-output-read-v1'", "purpose!=''")],
  ["rowid table", SELECTED_OUTPUT_SHARE_SCHEMA[0].replace(" WITHOUT ROWID", "")],
  ["same-name view", "CREATE VIEW selected_output_shares AS SELECT 'pretend' AS share_id"],
  ["same-name temp table only", "CREATE TEMP TABLE selected_output_shares(share_id TEXT)"],
]) test(`${label} is neither absent nor ready`, async t => {
  const f = fixture(t, [table]);
  if (!label.includes("same-name")) for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA.slice(1)) f.sqlite.exec(sql);
  assert.equal(await selectedOutputShareSchemaState(f.env), "unavailable");
  assert.equal(assertGuard(f.sqlite, "ready"), 0);
  assert.equal(assertGuard(f.sqlite, "absent"), 0);
});

test("unrelated main and temp schema objects do not block this bounded feature", async t => {
  const f = fixture(t);
  f.sqlite.exec("CREATE TABLE unrelated(value TEXT); CREATE TEMP TABLE scratch(value TEXT); CREATE INDEX unrelated_index ON unrelated(value)");
  assert.equal(await selectedOutputShareSchemaState(f.env), "ready");
});

test("invalid D1 receipts and transport errors never qualify a schema", async () => {
  const receipts = [null, {}, [], { success: false, results: [{ state: "ready" }] },
    { success: true, error: "failure", results: [{ state: "ready" }] }, { success: true, results: [] },
    { success: true, results: [{ state: "ready" }, { state: "ready" }] }, { success: true, results: [{ state: "ready", extra: 1 }] },
    { success: true, results: [{ state: "READY" }] }, { success: true, results: [{ state: 1 }] },
    { success: true, results: Array(1) }, { success: true, results: [Object.create({ state: "ready" })] }];
  const getter = Object.defineProperty({}, "success", { get() { throw new Error("must not invoke getter"); } });
  receipts.push(getter);
  receipts.push(Object.defineProperty({ success: true, results: [{ state: "ready" }] }, "error", { get() { throw new Error("must not invoke getter"); } }));
  for (const receipt of receipts) {
    const env = { DB: { prepare() { return { bind() { return { async all() { return receipt; } }; } }; } } };
    assert.equal(await selectedOutputShareSchemaState(env), "unavailable");
  }
  assert.equal(await selectedOutputShareSchemaState({ DB: { prepare() { throw new Error("unavailable"); } } }), "unavailable");
});

test("a database binding changed while reading cannot qualify the replacement database", async t => {
  const f = fixture(t), original = f.env.DB;
  f.env.DB = { prepare(sql) {
    const prepared = original.prepare(sql);
    return { bind(...bindings) {
      const bound = prepared.bind(...bindings);
      return { async all() { const result = await bound.all(); f.env.DB = original; return result; } };
    } };
  } };
  assert.equal(await selectedOutputShareSchemaState(f.env), "unavailable");
});
