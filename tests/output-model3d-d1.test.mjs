import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OUTPUT_MODEL3D_SCHEMA_MIGRATION, OUTPUT_MODEL3D_SCHEMA_VALIDATION, upgradeOutputRequirementsSchema } from "../worker/output-requirements-schema.ts";
import { outputGraphTables, valueFor } from "./helpers/output-schema-graph.mjs";

// This is the pinned Wrangler/Miniflare workerd D1 binding, not a node:sqlite
// batch mock. It owns disposable local databases and denies Worker egress.
// It establishes local D1 execution, not the hosted Sites migration runner.
const requireWrangler = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, Log, LogLevel } = requireWrangler("miniflare");
const quote = value => `"${value.replaceAll('"', '""')}"`;
const statements = sql => sql.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);

async function install(db) {
  for (const file of ["0000_lively_owl.sql", "0018_output_requirements.sql"]) {
    const sql = await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8");
    await db.batch(statements(sql).map(sql => db.prepare(sql)));
  }
  await db.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES('event','creative:owner',1,'now','now','user:owner','test','migration-proof',1,'SchemaFixture','{}')").run();
  for (const table of outputGraphTables) {
    const { results: columns } = await db.prepare(`PRAGMA table_info(${quote(table)})`).all();
    await db.prepare(`INSERT INTO ${quote(table)}(${columns.map(column => quote(column.name)).join(",")}) VALUES(${columns.map(() => "?").join(",")})`)
      .bind(...columns.map(column => valueFor(table, column))).run();
  }
  await db.batch([
    db.prepare("UPDATE output_plan_targets SET rowid=9007199254740993"),
    db.prepare("UPDATE output_assets SET rowid=9007199254740995,mime_type=X'00FF80'"),
    db.prepare("UPDATE output_asset_storage_writes SET rowid=9007199254740997"),
  ]);
}

async function snapshot(db, extras = []) {
  const names = ["events", ...outputGraphTables, ...extras];
  const { results: schema } = await db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN(${names.map(() => "?").join(",")}) ORDER BY type,name`).bind(...names).all();
  const rows = {};
  for (const table of names) {
    const { results: columns } = await db.prepare(`PRAGMA table_info(${quote(table)})`).all();
    // Text encodings preserve integers above JS's safe range and SQLite types.
    rows[table] = (await db.prepare(`SELECT CAST(rowid AS TEXT) AS original_rowid,${columns.flatMap(column => [
      `typeof(${quote(column.name)}) AS ${quote(column.name + "_type")}`,
      `quote(${quote(column.name)}) AS ${quote(column.name + "_value")}`,
    ]).join(",")} FROM ${quote(table)} ORDER BY rowid`).all()).results;
  }
  return { schema, rows };
}

// D1's batch error omits the failing statement. On a failed upgrade, replay
// prefixes with an intentional final assertion failure so each diagnostic
// rolls back in the same disposable database. Never accept a diagnostic run
// as qualification or replace the original error with its outcome.
async function explainFailure(t, db) {
  for (let index = 0; index < OUTPUT_MODEL3D_SCHEMA_MIGRATION.length; index++) {
    try {
      await db.batch([
        ...OUTPUT_MODEL3D_SCHEMA_MIGRATION.slice(0, index + 1).map(sql => db.prepare(sql)),
        db.prepare("INSERT INTO output_atomic_assertions(token,passed) VALUES('diagnostic-rollback',0)"),
      ]);
      t.diagnostic("D1 diagnostic assertion unexpectedly committed");
      return;
    } catch (error) {
      if (!String(error).includes("CHECK constraint failed: passed=1")) {
        t.diagnostic(`First failing migration statement ${index}: ${OUTPUT_MODEL3D_SCHEMA_MIGRATION[index]}\n${String(error)}`);
        return;
      }
    }
  }
}

test("actual local D1 executes the complete 3D migration and rolls every parent back on a late batch failure", { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "forma-3d-d1-")), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", host: "127.0.0.1", port: 0,
    script: "export default { fetch() { return new Response('Only local D1 bindings are exercised.', {status: 404}); } };",
    d1Databases: ["Upgrade", "Rollback", "Dependency"], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: request => { egress.push(request.url); throw new Error("The D1 migration fixture permits no external fetch."); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  const upgrade = await mf.getD1Database("Upgrade");
  await assert.rejects(upgrade.prepare("PRAGMA writable_schema").all(), /not authorized/);
  await assert.rejects(upgrade.prepare("PRAGMA writable_schema=ON").run(), /not authorized/);
  await install(upgrade);
  const before = await snapshot(upgrade);
  assert.equal(before.rows.output_assets[0].original_rowid, "9007199254740995");
  try { await upgradeOutputRequirementsSchema(upgrade); }
  catch (error) { await explainFailure(t, upgrade); throw error; }
  assert.deepEqual((await snapshot(upgrade)).rows, before.rows);
  assert.deepEqual((await upgrade.prepare("PRAGMA foreign_key_check").all()).results, []);
  const after = await snapshot(upgrade);
  await upgrade.batch(OUTPUT_MODEL3D_SCHEMA_VALIDATION.map(sql => upgrade.prepare(sql)));
  assert.deepEqual(await snapshot(upgrade), after, "guarded no-op retains every table, index, row and rowid");
  await upgrade.batch([
    upgrade.prepare("UPDATE output_plan_targets SET media_kind='model3d'"),
    upgrade.prepare("UPDATE output_assets SET media_kind='model3d'"),
    upgrade.prepare("UPDATE output_asset_storage_writes SET byte_length=67108864"),
  ]);

  const rollback = await mf.getD1Database("Rollback");
  await install(rollback);
  const original = await snapshot(rollback);
  await assert.rejects(rollback.batch([
    rollback.prepare("INSERT INTO output_atomic_assertions(token,passed) VALUES('earlier-same-batch',1)"),
    ...OUTPUT_MODEL3D_SCHEMA_MIGRATION.map(sql => rollback.prepare(sql)),
    rollback.prepare("INSERT INTO output_atomic_assertions(token,passed) VALUES('late-batch-failure',0)"),
  ]), /CHECK constraint failed/);
  assert.deepEqual(await snapshot(rollback), original, "D1 rolls back the earlier insert and all three completed parent rebuilds");
  assert.deepEqual((await rollback.prepare("PRAGMA foreign_key_check").all()).results, []);
  await upgradeOutputRequirementsSchema(rollback);
  assert.deepEqual((await snapshot(rollback)).rows, original.rows);

  const dependency = await mf.getD1Database("Dependency");
  await install(dependency);
  await dependency.batch([
    dependency.prepare("CREATE TABLE sqlitex_asset_notes(id TEXT PRIMARY KEY NOT NULL,scope_key TEXT,asset_id TEXT,FOREIGN KEY(scope_key,asset_id) REFERENCES output_assets(scope_key,asset_id) ON DELETE CASCADE)"),
    dependency.prepare("INSERT INTO sqlitex_asset_notes VALUES('must-survive','scope','asset')"),
  ]);
  const withChild = await snapshot(dependency, ["sqlitex_asset_notes"]);
  await assert.rejects(upgradeOutputRequirementsSchema(dependency), /NOT NULL constraint failed/);
  assert.deepEqual(await snapshot(dependency, ["sqlitex_asset_notes"]), withChild);
  assert.deepEqual((await dependency.prepare("PRAGMA foreign_key_check").all()).results, []);
  assert.deepEqual(egress, []);
});
