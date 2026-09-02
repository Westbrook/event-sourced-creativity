import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coldProductionDatabase, outputSchema } from "./output-schema-test-helpers.mjs";
import { outputGraphTables, seedValidGraph } from "./helpers/output-schema-graph.mjs";
import {
  OUTPUT_REQUIREMENTS_SCHEMA,
  OUTPUT_MODEL3D_SCHEMA_MIGRATION,
  OUTPUT_MODEL3D_SCHEMA_STATE_SQL,
  upgradeOutputRequirementsSchema,
} from "../worker/output-requirements-schema.ts";
import { renderOutputModel3dMigration } from "../worker/output-model3d-migration.ts";

const legacySchema = readFileSync(new URL("../drizzle/0018_output_requirements.sql", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../drizzle/0022_output_model3d.sql", import.meta.url), "utf8");
const historicalMigrationSql = readFileSync(new URL("./fixtures/output-model3d-legacy.sql", import.meta.url), "utf8");
const guardTable = "__output_model3d_migration_guard";
const quote = value => `"${value.replaceAll('"', '""')}"`;
const splitStatements = sql => sql.replace(/^--(?!>).*$/gmu, "").split("--> statement-breakpoint")
  .map(statement => statement.trim().replace(/;$/u, "")).filter(Boolean);
const rawStatements = splitStatements(migrationSql);
const historicalStatements = splitStatements(historicalMigrationSql);
const parentDrop = sql => /^DROP TABLE output_(?:plan_targets|assets|asset_storage_writes)\s*;?$/u.test(sql.trim());

/** This binding supplies atomic node:sqlite batches for the tests. It does not
 * establish deployed D1 or hosted migration transaction semantics. Fault hooks
 * below exercise failures inside this transaction, without altering source SQL.
 */
function binding(sqlite) {
  const state = { sqlite, attempted: [], completed: [], afterStatement: undefined, batches: 0 };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values), success: true, meta: { changes: 0 } };
    }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
  }
  state.DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      state.batches++;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) {
          state.attempted.push(statement.sql);
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          state.completed.push(statement.sql);
          state.afterStatement?.(statement.sql);
          results.push({ results: [], success: true, meta: { changes: Number(result.changes) } });
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return state;
}

function database(t, { current = false, legacy = legacySchema } = {}) {
  // Reuse the actual pre-Output migration fixture; only its SQLite connection
  // is used. All model3d batches pass through the explicit binding above.
  const { sqlite } = coldProductionDatabase();
  t.after(() => sqlite.close());
  if (current) for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) sqlite.exec(sql);
  else sqlite.exec(legacy);
  seedValidGraph(sqlite);
  return binding(sqlite);
}
const raw = (state, statements = rawStatements) => state.DB.batch(statements.map(sql => state.DB.prepare(sql)));
const apply = (path, state) => path === "runtime" ? upgradeOutputRequirementsSchema(state.DB) : raw(state);
function schema(sqlite, name = "main") {
  return sqlite.prepare(`SELECT type,name,tbl_name,sql FROM ${quote(name)}.sqlite_schema ORDER BY type,name`).all();
}
function rows(sqlite, table, name = "main") {
  const statement = sqlite.prepare(`SELECT rowid AS original_rowid,* FROM ${quote(name)}.${quote(table)} ORDER BY rowid`);
  statement.setReadBigInts(true);
  return statement.all();
}
function snapshot(sqlite, extraMain = [], extraTemp = []) {
  const main = schema(sqlite), temporary = schema(sqlite, "temp");
  const present = new Set(main.filter(object => object.type === "table").map(object => object.name));
  return {
    main, temporary,
    rows: Object.fromEntries([
      ...["events", ...outputGraphTables, ...extraMain].filter(table => present.has(table)).map(table => [`main.${table}`, rows(sqlite, table)]),
      ...extraTemp.map(table => [`temp.${table}`, rows(sqlite, table, "temp")]),
    ]),
  };
}
function graphRows(sqlite) {
  return Object.fromEntries(["events", ...outputGraphTables].map(table => [table, rows(sqlite, table)]));
}
function connectionReady(sqlite) {
  assert.equal(sqlite.isTransaction, false);
  for (const [pragma, expected] of [["foreign_keys", 1], ["defer_foreign_keys", 0], ["ignore_check_constraints", 0], ["writable_schema", 0], ["legacy_alter_table", 0]]) {
    assert.equal(sqlite.prepare(`PRAGMA ${pragma}`).get()[pragma], expected, pragma);
  }
}
async function rejectsBeforeDrop(path, state, extraMain = [], extraTemp = []) {
  const before = snapshot(state.sqlite, extraMain, extraTemp);
  await assert.rejects(apply(path, state), /NOT NULL constraint failed|already exists/u);
  assert.deepEqual(state.attempted.filter(parentDrop), [], "unknown schema must be rejected before the first parent DROP");
  assert.deepEqual(snapshot(state.sqlite, extraMain, extraTemp), before, "rejected preconditions preserve every original object and row");
  connectionReady(state.sqlite);
}

test("model3d migration: the raw journal is the exact rendered runtime statement sequence", () => {
  assert.equal(migrationSql, renderOutputModel3dMigration(OUTPUT_MODEL3D_SCHEMA_MIGRATION));
  assert.deepEqual(rawStatements, OUTPUT_MODEL3D_SCHEMA_MIGRATION);
});

for (const kind of ["runtime declarations", "historical 0022", "guarded 0022"]) {
  test(`model3d migration: exact ${kind} post-schema is verified without rebuilding`, async t => {
    const state = database(t, { current: kind === "runtime declarations" });
    if (kind !== "runtime declarations") await raw(state, kind === "historical 0022" ? historicalStatements : rawStatements);
    state.attempted.length = 0;
    state.completed.length = 0;
    const before = snapshot(state.sqlite);
    await upgradeOutputRequirementsSchema(state.DB);
    assert.deepEqual(snapshot(state.sqlite), before, "the validation path retains exact SQL declarations as well as rows");
    assert.deepEqual(state.attempted.filter(parentDrop), [], "already-current tables are not rebuilt");
    assert.ok(state.attempted.some(sql => sql.startsWith("INSERT INTO main.\"__output_model3d_migration_guard\"")), "current state still executes the guarded validation batch");
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    connectionReady(state.sqlite);
  });
}

for (const path of ["runtime", "raw"]) {
  test(`model3d migration: ${path} preserves populated rows, large rowids, BLOB storage classes and constraints`, async t => {
    const state = database(t), current = database(t, { current: true });
    state.sqlite.exec("UPDATE output_plan_targets SET rowid=9007199254740993");
    state.sqlite.exec("UPDATE output_assets SET rowid=9007199254740995");
    state.sqlite.exec("UPDATE output_asset_storage_writes SET rowid=9007199254740997");
    state.sqlite.prepare("UPDATE output_assets SET mime_type=?").run(new Uint8Array([0, 255, 128]));
    const before = graphRows(state.sqlite);
    assert.equal(before.output_assets[0].original_rowid, 9007199254740995n);
    assert.equal(state.sqlite.prepare("SELECT typeof(mime_type) AS kind FROM output_assets").get().kind, "blob");
    assert.throws(() => state.sqlite.exec("UPDATE output_assets SET media_kind='model3d'"), /CHECK constraint failed/u);
    assert.throws(() => state.sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108864"), /CHECK constraint failed/u);

    await apply(path, state);
    assert.deepEqual(graphRows(state.sqlite), before);
    assert.deepEqual(outputSchema(state.sqlite), outputSchema(current.sqlite), "physical columns, indexes, checks and FKs agree with current bootstrap");
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    connectionReady(state.sqlite);
    state.sqlite.exec("UPDATE output_plan_targets SET media_kind='model3d'; UPDATE output_assets SET media_kind='model3d'; UPDATE output_asset_storage_writes SET byte_length=67108864");
    assert.throws(() => state.sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108865"), /CHECK constraint failed/u);
    assert.throws(() => state.sqlite.exec("UPDATE output_results SET asset_id='missing'"), /FOREIGN KEY constraint failed/u);

    const upgraded = snapshot(state.sqlite);
    await raw(state);
    assert.deepEqual(snapshot(state.sqlite), upgraded, "a journal deployment following runtime or earlier journal execution preserves the graph");
    const freshBinding = binding(state.sqlite);
    await upgradeOutputRequirementsSchema(freshBinding.DB);
    assert.deepEqual(snapshot(state.sqlite), upgraded, "a fresh runtime binding validates the renamed post-schema");
    assert.deepEqual(freshBinding.attempted.filter(parentDrop), []);
    connectionReady(state.sqlite);
  });
}

const drifts = [
  { name: "an extra copy column", sql: "ALTER TABLE output_assets ADD local_note TEXT; UPDATE output_assets SET local_note='must survive'" },
  { name: "a custom parent index", sql: "CREATE INDEX local_asset_mime ON output_assets(mime_type)" },
  { name: "a missing required unique index", sql: "DROP INDEX idx_output_assets_unique_1" },
  { name: "a wrong definition behind the expected index name", sql: "DROP INDEX idx_output_assets_unique_1; CREATE UNIQUE INDEX idx_output_assets_unique_1 ON output_assets(mime_type)" },
  { name: "a parent trigger", sql: "CREATE TRIGGER local_asset_trigger AFTER INSERT ON output_assets BEGIN SELECT 1; END" },
  { name: "a known-child trigger", sql: "CREATE TRIGGER local_result_trigger AFTER INSERT ON output_results BEGIN SELECT 1; END" },
  {
    name: "an unjournaled cascading child", extraMain: ["sqlitex_asset_notes"],
    sql: "CREATE TABLE sqlitex_asset_notes(marker TEXT PRIMARY KEY NOT NULL,scope_key TEXT NOT NULL,asset_id TEXT NOT NULL,FOREIGN KEY(scope_key,asset_id) REFERENCES output_assets(scope_key,asset_id) ON DELETE CASCADE); INSERT INTO sqlitex_asset_notes VALUES('must-survive','scope','asset')",
  },
  {
    name: "an engine-like table name with a mixed-case foreign key", extraMain: ["_cf_application_notes"],
    sql: "CREATE TABLE _cf_application_notes(marker TEXT PRIMARY KEY NOT NULL,scope_key TEXT NOT NULL,asset_id TEXT NOT NULL,FOREIGN KEY(scope_key,asset_id) ReFeReNcEs /* retained dependency */ output_assets(scope_key,asset_id) ON DELETE CASCADE); INSERT INTO _cf_application_notes VALUES('must-survive','scope','asset')",
  },
  {
    name: "an occupied proof token",
    sql: "INSERT INTO output_atomic_assertions(token,passed) VALUES('output-model3d-schema-foreign-keys',1)",
  },
];
for (const path of ["runtime", "raw"]) for (const current of [false, true]) for (const drift of drifts) {
  test(`model3d migration: ${path} rejects ${drift.name} on ${current ? "post" : "pre"}-schema`, async t => {
    const state = database(t, { current });
    state.sqlite.exec(drift.sql);
    await rejectsBeforeDrop(path, state, drift.extraMain ?? []);
  });
}

for (const path of ["runtime", "raw"]) {
  test(`model3d migration: ${path} does not trust a weakened assertions CHECK on pre- or post-schema`, async t => {
    for (const source of [legacySchema, OUTPUT_REQUIREMENTS_SCHEMA.join(";\n")]) {
      const state = database(t, { legacy: source.replace("passed INTEGER NOT NULL CHECK(passed=1)", "passed INTEGER NOT NULL") });
      state.sqlite.exec("INSERT INTO output_atomic_assertions(token,passed) VALUES('weak-check-witness',0)");
      await rejectsBeforeDrop(path, state);
    }
  });

  test(`model3d migration: ${path} refuses a mixed pre- and post-upgrade schema`, async t => {
    const mixed = legacySchema.replace("media_kind IN('image','slides','audio','video','document')", "media_kind IN('image','slides','audio','video','document','model3d')");
    const state = database(t, { legacy: mixed });
    await rejectsBeforeDrop(path, state);
  });

  test(`model3d migration: ${path} rejects a cascading action on a known child`, async t => {
    const state = database(t, { legacy: legacySchema.replace("REFERENCES output_assets(scope_key,asset_id)", "REFERENCES output_assets(scope_key,asset_id) ON DELETE CASCADE") });
    await rejectsBeforeDrop(path, state);
  });

  test(`model3d migration: ${path} refuses model3d substrings that do not widen the actual CHECKs`, async t => {
    const deceptiveSchema = legacySchema
      .replaceAll("media_kind TEXT NOT NULL CHECK(", "media_kind TEXT NOT NULL /* 'model3d' */ CHECK(")
      .replace("byte_length<=24000000", "byte_length<=24000000 /* 67108864 */");
    const state = database(t, { legacy: deceptiveSchema });
    const declarations = state.sqlite.prepare("SELECT name,sql FROM main.sqlite_schema WHERE type='table' AND name IN('output_plan_targets','output_assets','output_asset_storage_writes')").all();
    assert.equal(declarations.length, 3);
    assert.ok(declarations.every(row => row.sql.includes(row.name === "output_asset_storage_writes" ? "67108864" : "'model3d'")));
    assert.throws(() => state.sqlite.exec("UPDATE output_plan_targets SET media_kind='model3d'"), /CHECK constraint failed/u);
    assert.throws(() => state.sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108864"), /CHECK constraint failed/u);
    await rejectsBeforeDrop(path, state);
  });

  test(`model3d migration: ${path} rejects a nullable TEMP guard without writing or dropping it`, async t => {
    const state = database(t);
    state.sqlite.exec(`CREATE TEMP TABLE ${quote(guardTable)}(token TEXT); INSERT INTO temp.${quote(guardTable)} VALUES('preserve-temp-row')`);
    await rejectsBeforeDrop(path, state, [], [guardTable]);
  });

  test(`model3d migration: ${path} preserves an occupied main guard and staging table`, async t => {
    for (const table of [guardTable, "__output_assets_model3d"]) {
      const state = database(t);
      state.sqlite.exec(`CREATE TABLE ${quote(table)}(marker TEXT); INSERT INTO ${quote(table)} VALUES('preserve')`);
      await rejectsBeforeDrop(path, state, [table]);
    }
  });

  test(`model3d migration: ${path} rejects an unrelated view that RENAME could rewrite`, async t => {
    const state = database(t);
    state.sqlite.exec("CREATE VIEW staging_name_consumer AS SELECT * FROM __output_plan_targets_model3d");
    await rejectsBeforeDrop(path, state);
  });

  test(`model3d migration: ${path} rejects an empty unknown NO ACTION child`, async t => {
    const state = database(t);
    state.sqlite.exec("CREATE TABLE unrelated_asset_reference(scope_key TEXT,asset_id TEXT,FOREIGN KEY(scope_key,asset_id) REFERENCES output_assets(scope_key,asset_id))");
    await rejectsBeforeDrop(path, state, ["unrelated_asset_reference"]);
  });

  test(`model3d migration: ${path} checks pre-existing foreign keys outside Output`, async t => {
    const state = database(t);
    state.sqlite.exec("CREATE TABLE unrelated_refs(id TEXT PRIMARY KEY NOT NULL,event_id TEXT NOT NULL,FOREIGN KEY(event_id) REFERENCES events(event_id)); INSERT INTO unrelated_refs VALUES('retained','event')");
    state.sqlite.exec("PRAGMA foreign_keys=OFF; UPDATE unrelated_refs SET event_id='missing'; PRAGMA foreign_keys=ON");
    const violations = state.sqlite.prepare("PRAGMA foreign_key_check").all();
    assert.equal(violations[0].table, "unrelated_refs");
    await rejectsBeforeDrop(path, state, ["unrelated_refs"]);
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), violations);
  });

  test(`model3d migration: ${path} refuses a changed staged copy before dropping its source`, async t => {
    const state = database(t);
    const before = snapshot(state.sqlite);
    let injected = false;
    state.afterStatement = sql => {
      if (!injected && sql.startsWith("INSERT INTO __output_plan_targets_model3d(")) {
        injected = true;
        state.sqlite.exec("UPDATE __output_plan_targets_model3d SET target_contract_digest='changed-copy'");
      }
    };
    await assert.rejects(apply(path, state), /NOT NULL constraint failed/u);
    assert.equal(injected, true);
    assert.deepEqual(state.attempted.filter(parentDrop), [], "the copied-row proof must run before its original table is dropped");
    assert.deepEqual(snapshot(state.sqlite), before);
    connectionReady(state.sqlite);
  });

  test(`model3d migration: ${path} proves all foreign keys after rebuilding before clearing deferral`, async t => {
    const state = database(t);
    state.sqlite.exec("CREATE TABLE unrelated_refs(id TEXT PRIMARY KEY NOT NULL,event_id TEXT NOT NULL,FOREIGN KEY(event_id) REFERENCES events(event_id)); INSERT INTO unrelated_refs VALUES('retained','event')");
    const before = snapshot(state.sqlite, ["unrelated_refs"]);
    let injected = false;
    state.afterStatement = sql => {
      if (!injected && /^ALTER TABLE __output_asset_storage_writes_model3d RENAME TO output_asset_storage_writes\s*;?$/u.test(sql.trim())) {
        injected = true;
        assert.equal(state.sqlite.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys, 1);
        // Model a violation arising inside the batch after initial validation.
        // It is intentionally outside output_% and is legal only while deferred.
        state.sqlite.exec("UPDATE unrelated_refs SET event_id='missing'");
      }
    };
    await assert.rejects(apply(path, state), /NOT NULL constraint failed/u);
    assert.equal(injected, true);
    assert.equal(state.completed.filter(parentDrop).length, 3);
    assert.equal(state.completed.some(sql => /^PRAGMA defer_foreign_keys=OFF\s*;?$/u.test(sql.trim())), false, "the failed full-FK proof must abort before stale counters are cleared");
    assert.deepEqual(snapshot(state.sqlite, ["unrelated_refs"]), before);
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    connectionReady(state.sqlite);
  });

  test(`model3d migration: ${path} rolls back a late third-copy failure and permits retry on the same binding`, async t => {
    const state = database(t);
    state.sqlite.exec("PRAGMA ignore_check_constraints=ON; UPDATE output_asset_storage_writes SET byte_length=0; PRAGMA ignore_check_constraints=OFF");
    const before = snapshot(state.sqlite);
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), [], "the initial FK guard cannot reject this historical CHECK violation");
    await assert.rejects(apply(path, state), /CHECK constraint failed/u);
    assert.deepEqual(state.completed.filter(parentDrop), ["DROP TABLE output_plan_targets", "DROP TABLE output_assets"], "both earlier parent rebuilds really completed before the copy failure");
    assert.ok(state.attempted.some(sql => sql.startsWith("INSERT INTO __output_asset_storage_writes_model3d(")));
    assert.deepEqual(snapshot(state.sqlite), before);
    connectionReady(state.sqlite);

    state.sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=100");
    const repaired = graphRows(state.sqlite), failedBatches = state.batches;
    await apply(path, state);
    assert.equal(state.batches, failedBatches + 1, "runtime must discard its failed cached promise and execute the repaired retry");
    assert.deepEqual(graphRows(state.sqlite), repaired);
    state.sqlite.exec("UPDATE output_assets SET media_kind='model3d'");
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    connectionReady(state.sqlite);
  });

  for (const [pragma, value] of [["foreign_keys", 0], ["ignore_check_constraints", 1]]) {
    test(`model3d migration: ${path} rejects ${pragma}=${value} without trusting disabled CHECK enforcement`, async t => {
      const state = database(t);
      state.sqlite.exec(`PRAGMA ${pragma}=${value}`);
      const before = snapshot(state.sqlite);
      await assert.rejects(apply(path, state), /NOT NULL constraint failed/u);
      assert.deepEqual(state.attempted.filter(parentDrop), []);
      assert.deepEqual(snapshot(state.sqlite), before);
      assert.equal(state.sqlite.isTransaction, false);
      assert.equal(state.sqlite.prepare(`PRAGMA ${pragma}`).get()[pragma], value);
    });
  }
}

for (const current of [false, true]) test(`model3d migration: batched bootstrap hint selects the guarded path without another read; current=${current}`, async t => {
  const state = database(t, { current }), before = graphRows(state.sqlite);
  const hint = state.sqlite.prepare(OUTPUT_MODEL3D_SCHEMA_STATE_SQL).get().current;
  const prepare = state.DB.prepare.bind(state.DB);
  state.DB.prepare = sql => {
    assert.notEqual(sql, OUTPUT_MODEL3D_SCHEMA_STATE_SQL, "bootstrap already read the routing hint");
    return prepare(sql);
  };
  await upgradeOutputRequirementsSchema(state.DB, hint);
  assert.equal(state.batches, 1);
  assert.deepEqual(graphRows(state.sqlite), before);
  assert.equal(state.attempted.some(parentDrop), !current);
  assert.ok(state.attempted.some(sql => sql.startsWith('INSERT INTO main."__output_model3d_migration_guard"')));
  assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  connectionReady(state.sqlite);
});

test("model3d migration: a bootstrap hint cannot bypass schema changes before guarded validation", async t => {
  const state = database(t, { current: true });
  const hint = state.sqlite.prepare(OUTPUT_MODEL3D_SCHEMA_STATE_SQL).get().current;
  state.sqlite.exec("CREATE TRIGGER local_asset_trigger AFTER INSERT ON output_assets BEGIN SELECT 1; END");
  const before = snapshot(state.sqlite);
  await assert.rejects(upgradeOutputRequirementsSchema(state.DB, hint), /NOT NULL constraint failed/u);
  assert.deepEqual(state.attempted.filter(parentDrop), []);
  assert.deepEqual(snapshot(state.sqlite), before);
  connectionReady(state.sqlite);
});
