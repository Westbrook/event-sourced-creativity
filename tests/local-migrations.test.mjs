import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readLocalMigrations, migrateLocalDatabase } from "../scripts/lib/local-migrations.mjs";
import { outputGraphTables, seedValidGraph } from "./helpers/output-schema-graph.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const actualDirectory = process.env.FORMA_MIGRATION_TEST_DIRECTORY ?? new URL("../drizzle/", import.meta.url);
const actualMigrations = readLocalMigrations(actualDirectory);
const assistantTags = ["0020_assistant_runtime_tables", "0021_assistant_specialist_consent"];
const assistantMigrations = actualMigrations.some(migration => migration.tag === assistantTags[1])
  ? assistantTags.map(tag => actualMigrations.find(migration => migration.tag === tag))
  : readLocalMigrations(new URL("./fixtures/local-migrations/", import.meta.url));
const receiptTable = "__forma_local_migrations";
const memoryFinanceMigration = actualMigrations.find(migration => migration.tag === "0045_memory_derivation_finance");
const beforeMemoryFinance = memoryFinanceMigration ? actualMigrations.slice(0, actualMigrations.indexOf(memoryFinanceMigration)) : [];

function memoryCapUpgradeFixture(t) {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: beforeMemoryFinance });
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  const created = '2026-08-01T00:00:00.000Z', expires = '2027-01-01T00:00:00.000Z';
  insert('memory_live_enrollments', { enrollment_id: 'cap-parent', actor_user_id: 'cap-payer', owner_user_id: 'cap-payer',
    project_id: 'cap-project', document_id: 'cap-document', permission_epoch: 'fixture', policy_version: 'personal-memory-v2',
    revision: 1, learn_enabled: 1, recall_enabled: 1, background_enabled: 1, retention_days: 30, time_zone: 'UTC',
    enrolled_at: created, expires_at: expires, cursor_sequence: 0, next_due_at: created });
  // SQL upgrade evidence only, not a runtime-qualified provider or consent.
  insert('memory_derivation_qualifications', { qualification_id: 'cap-qualification', source_sha256: 'a'.repeat(64), origin: 'https://fixture.invalid',
    deployment_id: 'fixture', terms_json: '{}', terms_sha256: 'b'.repeat(64), status: 'qualified', qualified_at: created, expires_at: expires });
  for (const [index, cap, consented, revoked] of [[1, 900, created, expires], [2, 2000, created, null], [3, 3000, '2026-09-01T00:00:00.000Z', null]]) {
    insert('memory_derivation_grants', { consent_id: String(index).repeat(36), grant_id: String(index).repeat(64), revision: 1,
      actor_user_id: 'cap-payer', owner_user_id: 'cap-payer', project_id: 'cap-project', document_id: 'cap-document',
      enrollment_id: 'cap-parent', enrollment_revision: 1, permission_epoch: 'fixture', policy_version: 'personal-memory-derivation-v1',
      purpose: ['rolling-summary', 'profile', 'suggestion'][index - 1], qualification_id: 'cap-qualification', terms_sha256: 'b'.repeat(64),
      payer_user_id: 'cap-payer', monthly_cap_microusd: cap, source_after_sequence: 0, retention_days: 30, background_enabled: 1,
      consented_at: consented, expires_at: expires, revoked_at: revoked });
  }
  return sqlite;
}

test('Memory finance migration is schema-only; grant retirement preserves original cross-purpose month floors', { skip: !memoryFinanceMigration }, t => {
  const sqlite = memoryCapUpgradeFixture(t), before = rows(sqlite, 'memory_derivation_grants');
  const result = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.equal(result.migrations.find(migration => migration.tag === memoryFinanceMigration.tag).executedStatements, 49);
  assert.deepEqual(rows(sqlite, 'memory_derivation_month_caps'), []);
  assert.deepEqual(rows(sqlite, 'memory_derivation_grants'), before);
  sqlite.exec('DELETE FROM memory_live_enrollments');
  assert.deepEqual(sqlite.prepare('SELECT period,cap_microusd FROM memory_derivation_month_caps ORDER BY period').all().map(row => ({ ...row })),
    [{ period: '2026-08', cap_microusd: 900 }, { period: '2026-09', cap_microusd: 3000 }]);
  sqlite.exec("UPDATE memory_derivation_month_caps SET cap_microusd=700 WHERE period='2026-08'");
  const retained = rows(sqlite, 'memory_derivation_month_caps');
  assert.equal(migrateLocalDatabase(sqlite, { migrations: actualMigrations }).migrations.at(-1).status, 'already-applied');
  assert.deepEqual(rows(sqlite, 'memory_derivation_month_caps'), retained);
});

test('Memory finance migration dry run rolls back schema and its receipt without touching accepted consent', { skip: !memoryFinanceMigration }, t => {
  const sqlite = memoryCapUpgradeFixture(t), before = schema(sqlite), receipts = rows(sqlite, receiptTable), grants = rows(sqlite, 'memory_derivation_grants');
  migrateLocalDatabase(sqlite, { migrations: actualMigrations, dryRun: true });
  assert.deepEqual(schema(sqlite), before); assert.deepEqual(rows(sqlite, receiptTable), receipts); assert.deepEqual(rows(sqlite, 'memory_derivation_grants'), grants);
});

for (const floor of [null, 901]) test('Memory finance retirement captures earlier lower consent before erasure: ' + floor, { skip: !memoryFinanceMigration }, t => {
  const sqlite = memoryCapUpgradeFixture(t);
  sqlite.exec(memoryFinanceMigration.sql);
  if (floor !== null) sqlite.prepare('INSERT INTO memory_derivation_month_caps VALUES(?,?,?)').run('cap-payer', '2026-08', floor);
  assert.equal(migrateLocalDatabase(sqlite, { migrations: actualMigrations }).migrations.find(migration => migration.tag === memoryFinanceMigration.tag).status,'verified-existing');
  // Deleting the higher cap first must still capture the older lower cap.
  sqlite.prepare('DELETE FROM memory_derivation_grants WHERE grant_id=?').run('2'.repeat(64));
  assert.equal(sqlite.prepare("SELECT cap_microusd FROM memory_derivation_month_caps WHERE period='2026-08'").get().cap_microusd,900);
  sqlite.exec('DELETE FROM memory_live_enrollments');
  assert.equal(sqlite.prepare("SELECT cap_microusd FROM memory_derivation_month_caps WHERE period='2026-08'").get().cap_microusd,900);
});

test('Memory finance migration has no exception for unreviewed data changes', { skip: !memoryFinanceMigration }, t => {
  for (const sql of ["DELETE FROM memory_derivation_month_caps", "INSERT INTO memory_derivation_month_caps VALUES('payer','2026-09',1000)"]) {
    const sqlite = database(t), candidate = { ...memoryFinanceMigration, sql:memoryFinanceMigration.sql+'\n--> statement-breakpoint\n'+sql }; delete candidate.hash;
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: [...beforeMemoryFinance, candidate] }), /migration_sql_unsupported/);
    assert.deepEqual(schema(sqlite), []);
  }
});
const model3dTag = "0022_output_model3d";
const model3dStatementCount = 33;
const model3dSourceHash = "393bf222f1aa1210d679af3d588ffdf0e989cc6b9bd4db02eeef78cfb9907206";
const model3dLegacyHash = "e857a9750002d068c76651768835d5cc4b93ec484a657fc0bc58fe52e69dd291";
const model3dMigration = actualMigrations.find(migration => migration.tag === model3dTag);
const model3dOptions = { skip: !model3dMigration };
const beforeModel3dMigrations = model3dMigration ? actualMigrations.slice(0, actualMigrations.indexOf(model3dMigration)) : actualMigrations;
const throughModel3dMigrations = model3dMigration ? [...beforeModel3dMigrations, model3dMigration] : actualMigrations;

function database(t, path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON");
  t.after(() => sqlite.close());
  return sqlite;
}
function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "forma-local-migrations-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function history(t, definitions) {
  const directory = temporaryDirectory(t);
  mkdirSync(join(directory, "meta"));
  const entries = definitions.map((definition, idx) => {
    const tag = definition.tag ?? `${String(idx).padStart(4, "0")}_fixture`;
    writeFileSync(join(directory, `${tag}.sql`), definition.sql);
    return { idx, tag, when: definition.when ?? idx + 1, version: "6", breakpoints: true };
  });
  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries }));
  return { directory, migrations: readLocalMigrations(directory) };
}
function schema(sqlite) {
  return sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
}
function rows(sqlite, table, { bigints = false } = {}) {
  const statement = sqlite.prepare(`SELECT rowid AS original_rowid,* FROM "${table}" ORDER BY rowid`);
  if (bigints) statement.setReadBigInts(true);
  return statement.all().map(row => ({ ...row }));
}
function task(sqlite, id, overrides = {}) {
  const row = {
    task_id: id, actor_user_id: "actor", scope_key: "scope", turn_id: "turn",
    route_family: "document", task_kind: id, selected_model: "fixture-model",
    token_reservation_id: `${id}-tokens`, cost_reservation_id: `${id}-cost`, estimated_microusd: 120,
    maximum_input_tokens: 100, maximum_output_tokens: 10, locale: "ja", permission_epoch: "epoch",
    status: "completed", created_at: "2026-07-14T12:34:56Z", updated_at: "2026-07-14T12:34:56Z",
    ...overrides,
  };
  sqlite.prepare(`INSERT INTO assistant_specialist_tasks (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
}
function seedEvent(sqlite) {
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("event", "stream", 1, "2026-07-14", "2026-07-14", "actor", "client", "correlation", "fixture", '{"text":"Preserve 日本語"}');
}
function legacyModel3dDatabase(t, { seed = true } = {}) {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: beforeModel3dMigrations });
  if (seed) seedValidGraph(sqlite);
  return sqlite;
}
function model3dSnapshot(sqlite, extraTables = []) {
  const objects = schema(sqlite);
  const present = new Set(objects.filter(object => object.type === "table").map(object => object.name));
  return {
    schema: objects,
    rows: Object.fromEntries(["events", ...outputGraphTables, receiptTable, ...extraTables].filter(table => present.has(table))
      .map(table => [table, rows(sqlite, table, { bigints: true })])),
  };
}
function assertModel3dConnectionReady(sqlite) {
  assert.equal(sqlite.isTransaction, false);
  assert.equal(sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(sqlite.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys, 0);
  assert.equal(sqlite.prepare("PRAGMA ignore_check_constraints").get().ignore_check_constraints, 0);
}

test("local migrations: the actual journal installs and reruns without changing rows, rowids, receipts or triggers", t => {
  const sqlite = database(t);
  const first = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.equal(first.migrations.length, actualMigrations.length);
  seedEvent(sqlite);
  const beforeSchema = schema(sqlite), beforeEvents = rows(sqlite, "events"), beforeReceipts = rows(sqlite, receiptTable);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
    assert.ok(result.migrations.every(migration => migration.status === "already-applied"));
    assert.deepEqual(schema(sqlite), beforeSchema);
    assert.deepEqual(rows(sqlite, "events"), beforeEvents);
    assert.deepEqual(rows(sqlite, receiptTable), beforeReceipts);
  }
  assert.throws(() => sqlite.exec("UPDATE events SET payload='changed'"), /append-only/);
  assert.throws(() => sqlite.exec("DELETE FROM events"), /append-only/);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});

test("local migrations: an existing schema without receipts is verified without replaying unguarded CREATE", t => {
  const sqlite = database(t);
  sqlite.exec("BEGIN");
  for (const migration of actualMigrations) sqlite.exec(migration.sql);
  sqlite.exec("COMMIT");
  seedEvent(sqlite);
  const beforeSchema = schema(sqlite), beforeEvents = rows(sqlite, "events");
  const result = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.ok(result.migrations.every(migration => migration.status === "verified-existing"));
  assert.deepEqual(schema(sqlite).filter(object => object.tbl_name !== receiptTable), beforeSchema);
  assert.deepEqual(rows(sqlite, "events"), beforeEvents);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='__drizzle_migrations'").get(), undefined);
});

test("local migrations: Sites version 170 retains its 19-migration baseline when newer migrations are added", {
  skip: !actualMigrations.some(migration => migration.tag === assistantTags[1]),
}, t => {
  // Pin the historical baseline, not a growing complement of known additions.
  const baseline = actualMigrations.filter(migration => Number(migration.tag.slice(0,4)) < 18 || migration.tag === "0018_output_requirements");
  const additions = new Set(actualMigrations.filter(migration => !baseline.includes(migration)).map(migration => migration.tag));
  assert.equal(baseline.length, 19);
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: baseline });
  seedEvent(sqlite);
  const events = rows(sqlite, "events"), receipts = rows(sqlite, receiptTable);
  const result = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.deepEqual(result.migrations.filter(migration => migration.status === "applied").map(migration => migration.tag), [...additions]);
  assert.deepEqual(rows(sqlite, "events"), events);
  for (const original of receipts) assert.deepEqual(rows(sqlite, receiptTable).find(row => row.tag === original.tag), original);
  const upgradedSchema = schema(sqlite), upgradedReceipts = rows(sqlite, receiptTable);
  migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.deepEqual(schema(sqlite), upgradedSchema);
  assert.deepEqual(rows(sqlite, receiptTable), upgradedReceipts);
});

test("local migrations: the qualified 0022 preserves the populated graph and large rowids through preview, apply and repeat", model3dOptions, t => {
  const sqlite = legacyModel3dDatabase(t);
  // Odd values beyond Number.MAX_SAFE_INTEGER expose lossy rowid hashing or
  // copies. Do not update events: its audit triggers are intentionally immutable.
  sqlite.exec("UPDATE output_plan_targets SET rowid=9007199254740993");
  sqlite.exec("UPDATE output_assets SET rowid=9007199254740995");
  sqlite.exec("UPDATE output_asset_storage_writes SET rowid=9007199254740997");
  sqlite.prepare("UPDATE output_assets SET mime_type=?").run(new Uint8Array([0, 255, 128]));
  const before = model3dSnapshot(sqlite);
  assert.equal(before.rows.output_assets[0].original_rowid, 9007199254740995n);
  assert.throws(() => sqlite.exec("UPDATE output_plan_targets SET media_kind='model3d'"), /CHECK constraint/);
  assert.throws(() => sqlite.exec("UPDATE output_assets SET media_kind='model3d'"), /CHECK constraint/);
  assert.throws(() => sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108864"), /CHECK constraint/);
  const preview = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations, dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.migrations.at(-1), { tag: model3dTag, status: "applied", executedStatements: model3dStatementCount, skippedStatements: 0 });
  assert.deepEqual(model3dSnapshot(sqlite), before);
  assertModel3dConnectionReady(sqlite);

  const applied = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.deepEqual(applied.migrations.at(-1), { tag: model3dTag, status: "applied", executedStatements: model3dStatementCount, skippedStatements: 0 });
  for (const table of ["events", ...outputGraphTables]) assert.deepEqual(rows(sqlite, table, { bigints: true }), before.rows[table], table);
  assert.deepEqual(rows(sqlite, receiptTable, { bigints: true }).filter(row => row.tag !== model3dTag), before.rows[receiptTable]);
  assert.equal(rows(sqlite, receiptTable).find(row => row.tag === model3dTag).hash, model3dSourceHash);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assertModel3dConnectionReady(sqlite);
  sqlite.exec("UPDATE output_plan_targets SET media_kind='model3d'");
  sqlite.exec("UPDATE output_assets SET media_kind='model3d'");
  sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108864");
  assert.throws(() => sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=67108865"), /CHECK constraint/);
  const upgraded = model3dSnapshot(sqlite);
  const repeat = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.deepEqual(repeat.migrations.at(-1), { tag: model3dTag, status: "already-applied", executedStatements: 0, skippedStatements: model3dStatementCount });
  assert.deepEqual(model3dSnapshot(sqlite), upgraded);
  assertModel3dConnectionReady(sqlite);

  // Runtime initialization may finish 0022 before the local receipt exists.
  sqlite.prepare(`DELETE FROM ${receiptTable} WHERE tag=?`).run(model3dTag);
  const unreceipted = model3dSnapshot(sqlite);
  const verified = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.deepEqual(verified.migrations.at(-1), { tag: model3dTag, status: "verified-existing", executedStatements: 0, skippedStatements: model3dStatementCount });
  assert.deepEqual(schema(sqlite), unreceipted.schema);
  for (const table of ["events", ...outputGraphTables]) assert.deepEqual(rows(sqlite, table, { bigints: true }), unreceipted.rows[table], table);
  assert.deepEqual(rows(sqlite, receiptTable, { bigints: true }).filter(row => row.tag !== model3dTag), unreceipted.rows[receiptTable]);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: earlier additive history completes a partially present old Output schema before 0022", model3dOptions, t => {
  const sqlite = database(t);
  const output = beforeModel3dMigrations.find(migration => migration.tag === "0018_output_requirements");
  assert.ok(output);
  const prior = beforeModel3dMigrations.slice(0, beforeModel3dMigrations.indexOf(output));
  migrateLocalDatabase(sqlite, { migrations: prior });
  const oldAssets = output.sql.split("--> statement-breakpoint").find(sql => /CREATE TABLE IF NOT EXISTS output_assets\(/u.test(sql));
  assert.ok(oldAssets);
  sqlite.exec(oldAssets);
  const result = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.equal(result.migrations.find(migration => migration.tag === output.tag).status, "applied");
  assert.equal(result.migrations.at(-1).status, "applied");
  seedValidGraph(sqlite);
  sqlite.exec("UPDATE output_assets SET media_kind='model3d'");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: 0022 alone cannot manufacture its missing predecessor schema", model3dOptions, t => {
  const sqlite = database(t);
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: [model3dMigration] }), /migration_(?:schema_mismatch|sql_unsupported)/);
  assert.deepEqual(schema(sqlite), []);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: the destructive exception requires the exact 0022 bytes, tag and journal time", model3dOptions, t => {
  const variants = [
    { label: "changed source", migration: { ...model3dMigration, hash: undefined, sql: `${model3dMigration.sql}\n-- changed after qualification\n` }, error: /migration_hash_mismatch/ },
    { label: "different tag", migration: { ...model3dMigration, tag: "0023_copied_rebuild" }, error: /migration_sql_unsupported/ },
    { label: "different journal time", migration: { ...model3dMigration, when: 1788192000001 }, error: /migration_sql_unsupported/ },
  ];
  for (const { label, migration, error } of variants) {
    const sqlite = legacyModel3dDatabase(t), before = model3dSnapshot(sqlite);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: [...beforeModel3dMigrations, migration] }), error, label);
    assert.deepEqual(model3dSnapshot(sqlite), before, label);
    assertModel3dConnectionReady(sqlite);
  }
});

test("local migrations: mixed 0022 shapes and inconsistent applied receipts are refused", model3dOptions, t => {
  for (const state of ["mixed", "receipt-backed-old", "split-count-receipt"]) {
    const sqlite = legacyModel3dDatabase(t, { seed: false });
    if (state === "mixed") {
      // The graph is empty while this fixture widens only the targets table.
      const statements = model3dMigration.sql.split("--> statement-breakpoint");
      sqlite.exec([8, 9, 11, 12].map(index => statements[index]).join("\n"));
    } else if (state === "split-count-receipt") {
      migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
      sqlite.prepare(`UPDATE ${receiptTable} SET executed_statements=32,skipped_statements=1 WHERE tag=?`).run(model3dTag);
    } else {
      sqlite.prepare(`INSERT INTO ${receiptTable}(tag,hash,journal_when,disposition,executed_statements,skipped_statements,recorded_at) VALUES(?,?,?,'applied',33,0,'fixture')`)
        .run(model3dTag, model3dMigration.hash, model3dMigration.when);
    }
    seedValidGraph(sqlite);
    const before = model3dSnapshot(sqlite);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), state === "split-count-receipt" ? /migration_receipt_mismatch/ : /migration_schema_mismatch/, state);
    assert.deepEqual(model3dSnapshot(sqlite), before, state);
    assertModel3dConnectionReady(sqlite);
  }
});

test("local migrations: 0022 refuses altered tables, custom indexes and triggers, staging tables and an existing proof token", model3dOptions, t => {
  const fixtures = [
    ["extra column", "ALTER TABLE output_assets ADD local_note TEXT"],
    ["custom index", "CREATE INDEX local_output_asset_mime ON output_assets(mime_type)"],
    ["custom trigger", "CREATE TRIGGER local_output_asset_delete BEFORE DELETE ON output_assets BEGIN SELECT RAISE(ABORT,'custom asset trigger'); END"],
    ["staging table", "CREATE TABLE __output_assets_model3d(marker TEXT); INSERT INTO __output_assets_model3d VALUES('preserve')"],
    ["proof token", "INSERT INTO output_atomic_assertions(token,passed) VALUES('output-model3d-schema-foreign-keys',1)"],
  ];
  for (const [label, sql] of fixtures) {
    const sqlite = legacyModel3dDatabase(t);
    sqlite.exec(sql);
    const before = model3dSnapshot(sqlite, ["__output_assets_model3d"]);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), /migration_schema_mismatch/, label);
    assert.deepEqual(model3dSnapshot(sqlite, ["__output_assets_model3d"]), before, label);
    assertModel3dConnectionReady(sqlite);
  }
});

test("local migrations: an unjournaled inbound cascade cannot lose its rows during a 0022 parent rebuild", model3dOptions, t => {
  const sqlite = legacyModel3dDatabase(t);
  // sqlitex_ is a valid user prefix; LIKE 'sqlite_%' would hide it because _ is
  // a wildcard. A cascade can delete this row without leaving a failed FK check.
  sqlite.exec("CREATE TABLE sqlitex_asset_notes(marker TEXT PRIMARY KEY NOT NULL,scope_key TEXT NOT NULL,asset_id TEXT NOT NULL,FOREIGN KEY(scope_key,asset_id) REFERENCES output_assets(scope_key,asset_id) ON DELETE CASCADE)");
  sqlite.exec("INSERT INTO sqlitex_asset_notes VALUES('must-survive','scope','asset')");
  const before = model3dSnapshot(sqlite, ["sqlitex_asset_notes"]);
  assert.equal(before.rows.sqlitex_asset_notes[0].marker, "must-survive");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), /migration_schema_mismatch/);
  assert.deepEqual(model3dSnapshot(sqlite, ["sqlitex_asset_notes"]), before);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: 0022 requires enabled foreign keys and CHECKs with no caller deferral", model3dOptions, t => {
  for (const [pragma, value] of [["foreign_keys", 0], ["defer_foreign_keys", 1], ["ignore_check_constraints", 1]]) {
    const sqlite = legacyModel3dDatabase(t);
    const before = model3dSnapshot(sqlite);
    // A standalone schema read can end an implicit transaction and reset
    // defer_foreign_keys. Set the caller's flag after taking that snapshot.
    sqlite.exec(`PRAGMA ${pragma}=${value}`);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), /migration_schema_mismatch/, pragma);
    assert.equal(sqlite.prepare(`PRAGMA ${pragma}`).get()[pragma], value, "caller settings are not silently weakened or reset");
    assert.deepEqual(model3dSnapshot(sqlite), before, pragma);
    assert.equal(sqlite.isTransaction, false);
  }
});

test("local migrations: a failed 0022 foreign-key proof rolls back the graph, tables and receipts before a repaired retry", model3dOptions, t => {
  const sqlite = database(t);
  // Leave earlier additive assistant migrations pending, so a failed full
  // attempt must also retain the original set of tables and local receipts.
  migrateLocalDatabase(sqlite, { migrations: beforeModel3dMigrations.filter(migration => !assistantTags.includes(migration.tag)) });
  seedValidGraph(sqlite);
  sqlite.exec("PRAGMA foreign_keys=OFF");
  sqlite.exec("UPDATE output_results SET asset_id='missing'");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const before = model3dSnapshot(sqlite), brokenKeys = sqlite.prepare("PRAGMA foreign_key_check").all();
  assert.ok(brokenKeys.length);
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), /migration_schema_mismatch/);
  assert.deepEqual(model3dSnapshot(sqlite), before);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), brokenKeys);
  assertModel3dConnectionReady(sqlite);
  sqlite.exec("UPDATE output_results SET asset_id='asset'");
  const result = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.equal(result.migrations.at(-1).status, "applied");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: a later unrelated additive table coexists with 0022 and retains its rows on repeat", model3dOptions, t => {
  const sqlite = legacyModel3dDatabase(t);
  const { migrations: [later] } = history(t, [{ tag: "0023_local_notes", when: model3dMigration.when + 1, sql: "CREATE TABLE local_notes(id TEXT PRIMARY KEY NOT NULL,content TEXT NOT NULL);" }]);
  const migrations = [...throughModel3dMigrations, later];
  const original = model3dSnapshot(sqlite);
  const result = migrateLocalDatabase(sqlite, { migrations });
  assert.equal(result.migrations.find(migration => migration.tag === model3dTag).status, "applied");
  assert.equal(result.migrations.at(-1).status, "applied");
  for (const table of ["events", ...outputGraphTables]) assert.deepEqual(rows(sqlite, table, { bigints: true }), original.rows[table], table);
  sqlite.exec("INSERT INTO local_notes VALUES('note','Keep 日本語')");
  const before = model3dSnapshot(sqlite, ["local_notes"]);
  const repeat = migrateLocalDatabase(sqlite, { migrations });
  assert.ok(repeat.migrations.every(migration => migration.status === "already-applied"));
  assert.deepEqual(model3dSnapshot(sqlite, ["local_notes"]), before);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: a late 0022 copy failure restores earlier parent rebuilds and pending additive history", model3dOptions, t => {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: beforeModel3dMigrations.filter(migration => !assistantTags.includes(migration.tag)) });
  seedValidGraph(sqlite);
  sqlite.exec("PRAGMA ignore_check_constraints=ON");
  sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=0");
  sqlite.exec("PRAGMA ignore_check_constraints=OFF");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const before = model3dSnapshot(sqlite), attempted = [];
  const observed = {
    get isTransaction() { return sqlite.isTransaction; },
    prepare: sqlite.prepare.bind(sqlite),
    exec(sql) { attempted.push(sql); return sqlite.exec(sql); },
  };
  assert.throws(() => migrateLocalDatabase(observed, { migrations: throughModel3dMigrations }), /CHECK constraint/);
  assert.ok(attempted.some(sql => /^\s*DROP TABLE output_plan_targets;/u.test(sql)));
  assert.ok(attempted.some(sql => /^\s*DROP TABLE output_assets;/u.test(sql)));
  assert.ok(attempted.some(sql => /^\s*INSERT INTO __output_asset_storage_writes_model3d/u.test(sql)));
  assert.equal(attempted.some(sql => /^\s*DROP TABLE output_asset_storage_writes;/u.test(sql)), false);
  assert.deepEqual(model3dSnapshot(sqlite), before, "both completed parent rebuilds and every earlier pending migration roll back");
  assertModel3dConnectionReady(sqlite);
  sqlite.exec("UPDATE output_asset_storage_writes SET byte_length=120");
  const result = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations });
  assert.equal(result.migrations.at(-1).status, "applied");
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assertModel3dConnectionReady(sqlite);
});

test("local migrations: an exact historical 0022 receipt is verified without rewriting its source history", model3dOptions, t => {
  const legacySql = readFileSync(new URL("./fixtures/output-model3d-legacy.sql", import.meta.url), "utf8");
  for (const disposition of ["applied", "verified-existing"]) {
    const sqlite = legacyModel3dDatabase(t);
    sqlite.exec("BEGIN"); sqlite.exec(legacySql); sqlite.exec("COMMIT");
    sqlite.prepare(`INSERT INTO ${receiptTable}(tag,hash,journal_when,disposition,executed_statements,skipped_statements,recorded_at) VALUES(?,?,?,?,?,?,?)`)
      .run(model3dTag, model3dLegacyHash, model3dMigration.when, disposition, disposition === "applied" ? 19 : 0,
        disposition === "applied" ? 0 : 19, "2026-08-31T12:34:56Z");
    const before = model3dSnapshot(sqlite);
    for (const dryRun of [true, false, false]) {
      const result = migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations, dryRun });
      assert.deepEqual(result.migrations.at(-1), { tag: model3dTag, status: "verified-legacy-source",
        executedStatements: 0, skippedStatements: model3dStatementCount, recordedHash: model3dLegacyHash, verifiedHash: model3dSourceHash });
      assert.deepEqual(model3dSnapshot(sqlite), before, "historical hash, date, rowid and execution counts stay exact");
      assertModel3dConnectionReady(sqlite);
    }
  }
});

test("local migrations: legacy 0022 receipt compatibility refuses old schemas, altered counts and other hashes", model3dOptions, t => {
  for (const boundary of ["old-schema", "split-count", "wrong-count", "other-hash", "wrong-time"]) {
    const sqlite = legacyModel3dDatabase(t);
    if (boundary !== "old-schema") {
      sqlite.exec("BEGIN"); sqlite.exec(model3dMigration.sql); sqlite.exec("COMMIT");
    }
    sqlite.prepare(`INSERT INTO ${receiptTable}(tag,hash,journal_when,disposition,executed_statements,skipped_statements,recorded_at) VALUES(?,?,?,'applied',?,?,'original')`)
      .run(model3dTag, boundary === "other-hash" ? "0".repeat(64) : model3dLegacyHash,
        model3dMigration.when + (boundary === "wrong-time" ? 1 : 0), boundary === "split-count" ? 18 : boundary === "wrong-count" ? 33 : 19,
        boundary === "split-count" ? 1 : 0);
    const before = model3dSnapshot(sqlite);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: throughModel3dMigrations }), /migration_(?:schema|receipt|hash)_mismatch/, boundary);
    assert.deepEqual(model3dSnapshot(sqlite), before, boundary);
    assertModel3dConnectionReady(sqlite);
  }
});

test("local migrations: later changes to rebuilt tables and their dependencies require separate qualification", model3dOptions, t => {
  for (const sql of [
    "ALTER TABLE output_assets ADD local_note TEXT;",
    "CREATE INDEX later_asset_mime ON output_assets(mime_type);",
    "ALTER TABLE output_results ADD local_note TEXT;",
    "CREATE TABLE later_asset_consumer(scope_key TEXT,asset_id TEXT,FOREIGN KEY(scope_key,asset_id) REFERENCES output_assets(scope_key,asset_id));",
  ]) {
    const sqlite = legacyModel3dDatabase(t), before = model3dSnapshot(sqlite);
    const { migrations: [later] } = history(t, [{ tag: "0023_unqualified_output_change", when: model3dMigration.when + 1, sql }]);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: [...throughModel3dMigrations, later] }), /migration_sql_unsupported/, sql);
    assert.deepEqual(model3dSnapshot(sqlite), before, sql);
    assertModel3dConnectionReady(sqlite);
  }
});

test("local migrations: the real 0021 upgrade preserves populated legacy tasks and can be repeated", t => {
  const sqlite = database(t);
  sqlite.exec(assistantMigrations[0].sql);
  task(sqlite, "paid", { provider_submitted: 1 });
  task(sqlite, "uncertain", { status: "needs-review" });
  const before = rows(sqlite, "assistant_specialist_tasks");
  migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  const upgraded = rows(sqlite, "assistant_specialist_tasks");
  assert.deepEqual(upgraded.map(({ result_json, ...row }) => { assert.equal(result_json, null); return row; }), before);
  migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  assert.deepEqual(rows(sqlite, "assistant_specialist_tasks"), upgraded);
  task(sqlite, "signed", { result_json: '{"retained":"original"}' });
  assert.throws(() => task(sqlite, "another-kind", { result_json: "{}" }), /UNIQUE constraint/);
  task(sqlite, "another-unsigned");
});

test("local migrations: already added consent columns keep their existing values and exact rowids", t => {
  const sqlite = database(t);
  for (const migration of assistantMigrations) sqlite.exec(migration.sql);
  task(sqlite, "signed", { result_json: '{"retained":"Private 日本語"}', provider_submitted: 1 });
  sqlite.prepare("INSERT INTO assistant_turns(turn_id,actor_user_id,scope_key,route_family,user_content_ref,assistant_content_ref,permission_epoch,status,created_at,completed_at,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("turn", "actor", "scope", "document", "user-ref", "answer-ref", "epoch", "completed", "then", "then", '{"original":"request"}');
  const beforeTasks = rows(sqlite, "assistant_specialist_tasks"), beforeTurns = rows(sqlite, "assistant_turns");
  const result = migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  assert.ok(result.migrations.every(migration => migration.status === "verified-existing"));
  assert.deepEqual(rows(sqlite, "assistant_specialist_tasks"), beforeTasks);
  assert.deepEqual(rows(sqlite, "assistant_turns"), beforeTurns);
});

test("local migrations: the original runtime schema upgrades while preserving inline constraints and audit triggers", t => {
  const sqlite = database(t);
  sqlite.exec(readFileSync(new URL("./fixtures/assistant-legacy-runtime.sql", import.meta.url), "utf8"));
  task(sqlite, "original", { provider_submitted: 1 });
  sqlite.prepare("INSERT INTO assistant_billing_reconciliations(reconciliation_id,task_id,actor_user_id,reviewer_user_id,evidence_classification,occurred_at) VALUES(?,?,?,?,?,?)")
    .run("audit", "original", "actor", "reviewer", "verified-no-provider-charge", "then");
  const beforeTasks = rows(sqlite, "assistant_specialist_tasks"), beforeAudit = rows(sqlite, "assistant_billing_reconciliations");
  migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  assert.deepEqual(rows(sqlite, "assistant_specialist_tasks").map(({ result_json, ...row }) => { assert.equal(result_json, null); return row; }), beforeTasks);
  assert.deepEqual(rows(sqlite, "assistant_billing_reconciliations"), beforeAudit);
  assert.throws(() => task(sqlite, "duplicate", { task_kind: "original" }), /UNIQUE constraint/);
  assert.throws(() => sqlite.exec("UPDATE assistant_billing_reconciliations SET occurred_at='changed'"), /append-only/);
  assert.throws(() => sqlite.exec("DELETE FROM assistant_billing_reconciliations"), /append-only/);
});

test("local migrations: a partially executed 0021 resumes only its missing effects", t => {
  const sqlite = database(t);
  sqlite.exec(assistantMigrations[0].sql);
  sqlite.exec("ALTER TABLE assistant_specialist_tasks ADD result_json TEXT");
  task(sqlite, "signed", { result_json: '{"existing":true}' });
  const before = rows(sqlite, "assistant_specialist_tasks");
  const result = migrateLocalDatabase(sqlite, { migrations: assistantMigrations });
  assert.equal(result.migrations[1].status, "applied");
  assert.equal(result.migrations[1].executedStatements, 2);
  assert.deepEqual(rows(sqlite, "assistant_specialist_tasks"), before);
  assert.ok(sqlite.prepare("PRAGMA table_info(assistant_turns)").all().some(column => column.name === "request_json"));
});

for (const definition of ["BLOB", "TEXT DEFAULT 'adopted'", "TEXT NOT NULL DEFAULT ''", "TEXT GENERATED ALWAYS AS (task_kind) VIRTUAL"]) {
  test(`local migrations: an existing incompatible consent column is rejected (${definition})`, t => {
    const sqlite = database(t);
    sqlite.exec(assistantMigrations[0].sql);
    sqlite.exec(`ALTER TABLE assistant_specialist_tasks ADD result_json ${definition}`);
    const before = schema(sqlite);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: assistantMigrations }), /migration_schema_mismatch/);
    assert.deepEqual(schema(sqlite), before);
  });
}

for (const definition of [
  "CREATE INDEX idx_assistant_single_consented_turn ON assistant_specialist_tasks(actor_user_id,scope_key,turn_id) WHERE result_json IS NOT NULL",
  "CREATE UNIQUE INDEX idx_assistant_single_consented_turn ON assistant_specialist_tasks(actor_user_id,scope_key,turn_id) WHERE result_json IS NULL",
  "CREATE UNIQUE INDEX idx_assistant_single_consented_turn ON assistant_specialist_tasks(turn_id DESC,scope_key,actor_user_id) WHERE result_json IS NOT NULL",
]) {
  test(`local migrations: an incompatible consent index cannot be silently skipped (${definition})`, t => {
    const sqlite = database(t);
    for (const migration of assistantMigrations) sqlite.exec(migration.sql);
    sqlite.exec("DROP INDEX idx_assistant_single_consented_turn");
    sqlite.exec(definition);
    const before = schema(sqlite);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations: assistantMigrations }), /migration_schema_mismatch/);
    assert.deepEqual(schema(sqlite), before);
  });
}

test("local migrations: unique-index failure rolls back earlier changes and never discards duplicate data", t => {
  const sqlite = database(t);
  sqlite.exec(assistantMigrations[0].sql);
  sqlite.exec("ALTER TABLE assistant_specialist_tasks ADD result_json TEXT");
  task(sqlite, "first", { result_json: "{}" });
  task(sqlite, "second", { result_json: "{}" });
  const beforeSchema = schema(sqlite), beforeRows = rows(sqlite, "assistant_specialist_tasks");
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: assistantMigrations }), /UNIQUE constraint/);
  assert.deepEqual(schema(sqlite), beforeSchema);
  assert.deepEqual(rows(sqlite, "assistant_specialist_tasks"), beforeRows);
});

test("local migrations: newer Drizzle history never hides an earlier missing migration or gets rewritten", t => {
  const { migrations } = history(t, [
    { tag: "0000_earlier", when: 10, sql: "CREATE TABLE earlier(id TEXT PRIMARY KEY NOT NULL);" },
    { tag: "0001_later", when: 20, sql: "CREATE TABLE later(id TEXT PRIMARY KEY NOT NULL);" },
  ]);
  const sqlite = database(t);
  sqlite.exec(migrations[1].sql);
  sqlite.exec("CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT NOT NULL,created_at NUMERIC)");
  sqlite.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(migrations[1].hash, 20);
  const before = rows(sqlite, "__drizzle_migrations");
  const result = migrateLocalDatabase(sqlite, { migrations });
  assert.equal(result.migrations[0].status, "applied");
  assert.equal(result.migrations[1].status, "verified-existing");
  assert.deepEqual(rows(sqlite, "__drizzle_migrations"), before);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='earlier'").get());
});

test("local migrations: recorded SQL changes are rejected and receipt-backed schema drift is still checked", t => {
  const { directory, migrations } = history(t, [{ sql: "CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL);--> statement-breakpoint\nCREATE INDEX item_id ON items(id);" }]);
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations });
  const receipts = rows(sqlite, receiptTable);
  writeFileSync(join(directory, "0000_fixture.sql"), migrations[0].sql.replace("TEXT", "BLOB"));
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: readLocalMigrations(directory) }), /migration_hash_mismatch/);
  assert.deepEqual(rows(sqlite, receiptTable), receipts);
  sqlite.exec("DROP INDEX item_id");
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_schema_mismatch/);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='item_id'").get(), undefined);
  assert.deepEqual(rows(sqlite, receiptTable), receipts);
});

test("local migrations: unexpected attached objects on an ordinary table roll back pending additive history", t => {
  for (const object of [
    "CREATE INDEX local_item_name ON items(name)",
    "CREATE TRIGGER local_item_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT,'local item guard'); END",
  ]) {
    const { migrations } = history(t, [{ sql: "CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL,name TEXT);" }, { sql: "CREATE TABLE pending(id TEXT);" }]);
    const sqlite = database(t);
    migrateLocalDatabase(sqlite, { migrations: migrations.slice(0, 1) });
    sqlite.exec("INSERT INTO items VALUES('item','preserve')");
    sqlite.exec(object);
    const beforeSchema = schema(sqlite), beforeRows = rows(sqlite, "items"), beforeReceipts = rows(sqlite, receiptTable);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_schema_mismatch/);
    assert.deepEqual(schema(sqlite), beforeSchema);
    assert.deepEqual(rows(sqlite, "items"), beforeRows);
    assert.deepEqual(rows(sqlite, receiptTable), beforeReceipts);
    assert.equal(sqlite.isTransaction, false);
  }
});

test("local migrations: dry runs roll back schema and local receipts", t => {
  const sqlite = database(t);
  const result = migrateLocalDatabase(sqlite, { migrations: assistantMigrations, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(schema(sqlite), []);
});

test("local migrations: CHECK literal values are compared without losing case", t => {
  const { migrations } = history(t, [{ sql: "CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL,status TEXT CHECK(status='Allowed'));" }]);
  const sqlite = database(t);
  sqlite.exec("CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL,status TEXT CHECK(status='allowed'))");
  const before = schema(sqlite);
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_schema_mismatch/);
  assert.deepEqual(schema(sqlite), before);
});

for (const sql of [
  'CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL,label TEXT DEFAULT "Allowed");',
  "CREATE TABLE items(id INTEGER,value INTEGER GENERATED ALWAYS AS (id+1) VIRTUAL);",
  "CREATE TABLE items(a TEXT,b TEXT,UNIQUE(a) ON CONFLICT IGNORE,UNIQUE(b) ON CONFLICT ABORT);",
]) {
  test(`local migrations: unsupported schema semantics are rejected instead of compared loosely (${sql})`, t => {
    const { migrations } = history(t, [{ sql }]);
    const sqlite = database(t);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_sql_unsupported/);
    assert.deepEqual(schema(sqlite), []);
  });
}

test("local migrations: temporary triggers cannot mutate application data during receipt insertion", t => {
  const initial = "CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL);";
  const { migrations } = history(t, [{ sql: initial }]);
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations });
  sqlite.exec("INSERT INTO items VALUES('preserve'); CREATE TEMP TRIGGER erase_items AFTER INSERT ON main.__forma_local_migrations BEGIN DELETE FROM items; END;");
  const beforeItems = rows(sqlite, "items"), beforeReceipts = rows(sqlite, receiptTable), beforeSchema = schema(sqlite);
  const expanded = history(t, [{ sql: initial }, { sql: "CREATE TABLE additional(id TEXT);" }]).migrations;
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations: expanded }), /migration_(?:schema|receipt)_mismatch/);
  assert.deepEqual(rows(sqlite, "items"), beforeItems);
  assert.deepEqual(rows(sqlite, receiptTable), beforeReceipts);
  assert.deepEqual(schema(sqlite), beforeSchema);
});

test("local migrations: future data-changing SQL is rejected before any target mutation", t => {
  for (const sql of [
    "CREATE TABLE items(id TEXT);--> statement-breakpoint\nDELETE FROM items;",
    "CREATE TABLE items(id TEXT); DELETE FROM items;",
    "CREATE TABLE items(id TEXT); COMMIT;",
  ]) {
    const { migrations } = history(t, [{ sql }]);
    const sqlite = database(t);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_sql_unsupported/);
    assert.deepEqual(schema(sqlite), []);
  }
});

test("local migrations: default CLI preview does not persist changes, while --apply is repeatable", t => {
  const { directory } = history(t, [{ sql: "CREATE TABLE items(id TEXT PRIMARY KEY NOT NULL);" }]);
  const path = join(temporaryDirectory(t), "local.sqlite");
  const args = [join(root, "scripts/migrate-local.mjs"), "--database", path, "--migrations", directory];
  const preview = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).dryRun, true);
  assert.equal(existsSync(path), false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const applied = spawnSync(process.execPath, [...args, "--apply"], { encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).migrations[0].status, attempt ? "already-applied" : "applied");
  }
  const sqlite = database(t, path);
  const before = rows(sqlite, receiptTable);
  const anotherPreview = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(anotherPreview.status, 0, anotherPreview.stderr);
  assert.deepEqual(rows(sqlite, receiptTable), before);
});

test("local migrations: assistant regression fixtures retain the exact source SQL when the checkpoint is present", () => {
  for (const tag of assistantTags) {
    const actual = actualMigrations.find(migration => migration.tag === tag);
    if (actual) assert.equal(readFileSync(new URL(`./fixtures/local-migrations/${tag}.sql`, import.meta.url), "utf8"), actual.sql);
  }
});

test("local migrations: swapped foreign-key deferral cannot become verified-existing", t => {
  const parents = ["CREATE TABLE parent_a(id INTEGER PRIMARY KEY);", "CREATE TABLE parent_b(id INTEGER PRIMARY KEY);"];
  const expectedChild = "CREATE TABLE child(a INTEGER,b INTEGER,FOREIGN KEY(a) REFERENCES parent_a(id) DEFERRABLE INITIALLY DEFERRED,FOREIGN KEY(b) REFERENCES parent_b(id) NOT DEFERRABLE INITIALLY IMMEDIATE);";
  const existingChild = "CREATE TABLE child(a INTEGER,b INTEGER,FOREIGN KEY(a) REFERENCES parent_a(id) NOT DEFERRABLE INITIALLY IMMEDIATE,FOREIGN KEY(b) REFERENCES parent_b(id) DEFERRABLE INITIALLY DEFERRED);";
  const { migrations } = history(t, [{ sql: [...parents, expectedChild].join("--> statement-breakpoint\n") }]);
  const sqlite = database(t), expected = database(t);
  for (const [current, definition, deferred, immediate] of [
    [expected, expectedChild, "a", "b"], [sqlite, existingChild, "b", "a"],
  ]) {
    current.exec([...parents, definition].join("\n"));
    current.exec("INSERT INTO parent_a VALUES(1); INSERT INTO parent_b VALUES(1); INSERT INTO child VALUES(1,1);");
    const original = rows(current, "child");
    // These are real SQLite timing witnesses, not normalized SQL comparisons.
    current.exec("BEGIN");
    try {
      assert.throws(() => current.exec(`INSERT INTO child(${immediate},${deferred}) VALUES(999,1)`), /FOREIGN KEY constraint failed/);
      assert.doesNotThrow(() => current.exec(`INSERT INTO child(${deferred},${immediate}) VALUES(999,1)`));
      assert.equal(rows(current, "child").length, original.length + 1);
      assert.throws(() => current.exec("COMMIT"), /FOREIGN KEY constraint failed/);
    } finally { if (current.isTransaction) current.exec("ROLLBACK"); }
    assert.deepEqual(rows(current, "child"), original);
    assert.deepEqual(current.prepare("PRAGMA foreign_key_check").all(), []);
  }
  const beforeSchema = schema(sqlite);
  const beforeRows = ["parent_a", "parent_b", "child"].map(table => [table, rows(sqlite, table)]);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(receiptTable), undefined);
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_sql_unsupported/);
  assert.deepEqual(schema(sqlite), beforeSchema);
  for (const [table, original] of beforeRows) assert.deepEqual(rows(sqlite, table), original);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(receiptTable), undefined);
  assert.equal(sqlite.isTransaction, false);
});

test("local migrations: bare and NOT DEFERRABLE source clauses are rejected before target mutation", t => {
  for (const clause of ["DEFERRABLE", "NOT DEFERRABLE INITIALLY IMMEDIATE"]) {
    const { migrations } = history(t, [{ sql: "CREATE TABLE parent(id INTEGER PRIMARY KEY);--> statement-breakpoint\n"
      + `CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) ${clause});` }]);
    const sqlite = database(t);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_sql_unsupported/);
    assert.deepEqual(schema(sqlite), []);
    assert.equal(sqlite.isTransaction, false);
  }
});

test("local migrations: existing unsupported deferral preserves prior receipts and every original row", t => {
  const parent = "CREATE TABLE parent(id INTEGER PRIMARY KEY);";
  const { migrations } = history(t, [
    { tag: "0000_parent", sql: parent },
    { tag: "0001_child", sql: "CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));" },
  ]);
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: migrations.slice(0, 1) });
  sqlite.exec("INSERT INTO parent VALUES(1); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED); INSERT INTO child VALUES(1);");
  const beforeSchema = schema(sqlite), beforeReceipts = rows(sqlite, receiptTable);
  const beforeParent = rows(sqlite, "parent"), beforeChild = rows(sqlite, "child");
  assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_schema_mismatch/);
  assert.deepEqual(schema(sqlite), beforeSchema);
  assert.deepEqual(rows(sqlite, receiptTable), beforeReceipts);
  assert.deepEqual(rows(sqlite, "parent"), beforeParent); assert.deepEqual(rows(sqlite, "child"), beforeChild);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(sqlite.isTransaction, false);
});

test("local migrations: quoted names, literal values and comments containing deferral words remain supported", t => {
  const { migrations } = history(t, [{ sql: "CREATE TABLE keyword_text(id INTEGER PRIMARY KEY, \"deferrable\" TEXT NOT NULL DEFAULT 'INITIALLY DEFERRED', \"initially\" TEXT NOT NULL DEFAULT 'Deferrable' /* NOT DEFERRABLE INITIALLY IMMEDIATE */);" }]);
  const sqlite = database(t);
  const applied = migrateLocalDatabase(sqlite, { migrations });
  assert.equal(applied.migrations[0].status, "applied");
  sqlite.exec("INSERT INTO keyword_text(id) VALUES(1)");
  const original = rows(sqlite, "keyword_text"), beforeSchema = schema(sqlite), beforeReceipts = rows(sqlite, receiptTable);
  assert.deepEqual(original, [{ original_rowid: 1, id: 1, deferrable: "INITIALLY DEFERRED", initially: "Deferrable" }]);
  const repeated = migrateLocalDatabase(sqlite, { migrations });
  assert.equal(repeated.migrations[0].status, "already-applied");
  assert.deepEqual(schema(sqlite), beforeSchema);
  assert.deepEqual(rows(sqlite, "keyword_text"), original);
  assert.deepEqual(rows(sqlite, receiptTable), beforeReceipts);
});

test('pending Memory qualification is disposable and rejects source drift or journal assignment', async () => {
  const { memoryMigrationCandidates, prepareMemoryMigrationCandidate, qualifyMemoryMigrationCandidates } = await import('../scripts/lib/memory-migration-candidates.mjs');
  const report = qualifyMemoryMigrationCandidates();
  assert.equal(report.qualification, 'local-disposable-sqlite-schema');
  assert.equal(report.hostedQualified, false);assert.equal(report.productionApplied, false);assert.equal(report.migrationsAssigned, false);
  assert.equal(report.candidates.length, 3);assert.ok(report.candidates.every(candidate => candidate.status === 'passed'));
  for (const candidate of memoryMigrationCandidates) {
    const sql = readFileSync(new URL('../db/' + candidate.file, import.meta.url), 'utf8');
    assert.equal(prepareMemoryMigrationCandidate(candidate, sql, actualMigrations).statements.length, candidate.statements);
    assert.throws(() => prepareMemoryMigrationCandidate(candidate, sql + '\n', actualMigrations), /source identity/);
    assert.throws(() => prepareMemoryMigrationCandidate(candidate, sql, [...actualMigrations, {hash:candidate.hash,tag:'unexpected'}]), /assigned to journal/);
  }
});

test('pending Memory qualification CLI has no target or apply capability', () => {
  const command = join(root, 'scripts/qualify-memory-migrations.mjs');
  for (const args of [['--apply'],['--database',':memory:'],['--migrations','drizzle'],['--url','https://example.invalid']]) {
    const result = spawnSync(process.execPath, [command,...args], {cwd:root,encoding:'utf8'});
    assert.equal(result.status, 1);assert.match(result.stderr, /accepts no target or apply options/);
  }
  const result = spawnSync(process.execPath, [command], {cwd:root,encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);assert.equal(JSON.parse(result.stdout).productionApplied, false);
});
test('Memory recovery migration is additive, schema-only and preserves the retained accounting floor and scan generation', t => {
  const target=actualMigrations.find(migration=>migration.tag==='0046_memory_derivation_recovery_cursor');
  if(!target){t.skip('Recovery migration not present in this migration fixture');return;}
  const sqlite=database(t),before=actualMigrations.slice(0,actualMigrations.indexOf(target));
  migrateLocalDatabase(sqlite,{migrations:before});
  sqlite.prepare('INSERT INTO memory_derivation_month_caps VALUES(?,?,?)').run('recovery-fixture-payer','2026-09',450);
  const floors=rows(sqlite,'memory_derivation_month_caps'),oldSchema=schema(sqlite),oldReceipts=rows(sqlite,receiptTable);
  migrateLocalDatabase(sqlite,{migrations:actualMigrations,dryRun:true});
  assert.deepEqual(schema(sqlite),oldSchema);assert.deepEqual(rows(sqlite,receiptTable),oldReceipts);assert.deepEqual(rows(sqlite,'memory_derivation_month_caps'),floors);
  const applied=migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(migration=>migration.tag===target.tag);
  assert.equal(applied.status,'applied');assert.equal(applied.executedStatements,4);assert.deepEqual(rows(sqlite,'memory_derivation_recovery_cursor'),[]);
  sqlite.prepare('INSERT INTO memory_derivation_recovery_cursor VALUES(1,NULL,0,?)').run('2026-09-18T00:00:00.000Z');
  sqlite.exec('UPDATE memory_derivation_recovery_cursor SET generation=1');const scan=rows(sqlite,'memory_derivation_recovery_cursor');
  assert.equal(migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(migration=>migration.tag===target.tag).status,'already-applied');
  assert.deepEqual(rows(sqlite,'memory_derivation_month_caps'),floors);assert.deepEqual(rows(sqlite,'memory_derivation_recovery_cursor'),scan);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('Memory semantic results migration is additive, schema-only and exact on rerun', t => {
  const target=actualMigrations.find(migration=>migration.tag==='0047_memory_derivation_results');assert.ok(target);
  const sqlite=database(t),before=actualMigrations.slice(0,actualMigrations.indexOf(target));migrateLocalDatabase(sqlite,{migrations:before});
  const oldSchema=schema(sqlite),receipts=rows(sqlite,receiptTable);
  migrateLocalDatabase(sqlite,{migrations:actualMigrations,dryRun:true});assert.deepEqual(schema(sqlite),oldSchema);assert.deepEqual(rows(sqlite,receiptTable),receipts);
  const applied=migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===target.tag);
  assert.equal(applied.executedStatements,39);assert.equal(applied.status,'applied');
  assert.deepEqual(rows(sqlite,'memory_derivation_results'),[]);assert.deepEqual(rows(sqlite,'memory_derivation_result_dependencies'),[]);
  assert.equal(migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===target.tag).status,'already-applied');
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const [tag,statementCount,tables] of [
  ['0048_memory_derivation_user_controls',11,['memory_derivation_user_controls']],
  ['0049_memory_derivation_completion',8,['memory_derivation_completions','memory_derivation_completion_cursors']],
  ['0050_memory_derivation_lifecycle',4,[]],
  ['0051_memory_derivation_split',5,['memory_derivation_split_commands']],
  ['0052_memory_derivation_history_privacy',3,[]],
  ['0054_memory_derivation_index_intents',8,['memory_derivation_index_intents']],
  ['0055_memory_derivation_relation_lifecycle',4,[]],
  ['0056_memory_derivation_reuse_lifecycle',3,[]],
  ['0057_memory_derivation_observation_controls',19,['memory_derivation_observation_controls']],
  ['0060_memory_derivation_contexts',2,['memory_derivation_contexts']],
  ['0061_memory_derivation_consumers',21,['memory_derivation_consumers','memory_derivation_consumer_contents']],
  ['0062_memory_derivation_consumer_sources',12,['memory_derivation_consumer_sources']],
  ['0063_memory_derivation_consumer_parents',8,['memory_derivation_consumer_parents']],
  ['0064_memory_derivation_asset_edges',24,['memory_derivation_asset_edges']],
  ['0065_memory_recall_organization_ranges',5,['memory_recall_organization_ranges']],
  ['0066_organization_project_nesting',15,['organization_project_nesting']],
])test('Memory additive controls/completion migration '+tag+' preserves rows and reruns exactly',t=>{
  const target=actualMigrations.find(m=>m.tag===tag);assert.ok(target);const sqlite=database(t);
  migrateLocalDatabase(sqlite,{migrations:actualMigrations.slice(0,actualMigrations.indexOf(target))});
  sqlite.prepare('INSERT INTO memory_derivation_month_caps VALUES(?,?,?)').run('isolated-retained-payer','2026-09',450);
  const oldSchema=schema(sqlite),receipts=rows(sqlite,receiptTable),caps=rows(sqlite,'memory_derivation_month_caps');
  migrateLocalDatabase(sqlite,{migrations:actualMigrations,dryRun:true});assert.deepEqual(schema(sqlite),oldSchema);assert.deepEqual(rows(sqlite,receiptTable),receipts);
  const applied=migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===tag);assert.equal(applied.executedStatements,statementCount);assert.equal(applied.status,'applied');
  for(const table of tables)assert.deepEqual(rows(sqlite,table),[]);assert.deepEqual(rows(sqlite,'memory_derivation_month_caps'),caps);
  assert.equal(migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===tag).status,'already-applied');
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const fault of ['altered-upgrade','missing-old-trigger','modified-old-trigger','reverted-receipted-trigger'])test('Memory split upgrade refuses '+fault+' without changing rows',t=>{
  const target=actualMigrations.find(m=>m.tag==='0051_memory_derivation_split'),sqlite=database(t);
  const before=actualMigrations.slice(0,actualMigrations.indexOf(target));migrateLocalDatabase(sqlite,{migrations:before});
  const old=sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_job_insert'").get().sql;
  if(fault==='reverted-receipted-trigger')migrateLocalDatabase(sqlite,{migrations:actualMigrations});
  if(fault!=='altered-upgrade'){
    sqlite.exec('DROP TRIGGER memory_derivation_job_insert');
    if(fault==='modified-old-trigger')sqlite.exec(old.replace("NEW.state!='waiting'","NEW.state='waiting'"));
    if(fault==='reverted-receipted-trigger')sqlite.exec(old);
  }
  const snapshot=schema(sqlite),receipts=rows(sqlite,receiptTable);
  const migrations=fault==='altered-upgrade'?actualMigrations.map(m=>m===target?{...m,hash:undefined,sql:m.sql+'\n-- not the qualified replacement'}:m):actualMigrations;
  assert.throws(()=>migrateLocalDatabase(sqlite,{migrations}),/migration_hash_mismatch|migration_schema_mismatch/);
  assert.deepEqual(schema(sqlite),snapshot);assert.deepEqual(rows(sqlite,receiptTable),receipts);
});

test('Memory producer migration is schema-only, preserves existing data and qualifies exact chained replacements',t=>{
  const target=actualMigrations.find(m=>m.tag==='0053_memory_derivation_producers');assert.ok(target);const sqlite=database(t);
  migrateLocalDatabase(sqlite,{migrations:actualMigrations.slice(0,actualMigrations.indexOf(target))});
  sqlite.prepare('INSERT INTO memory_derivation_month_caps VALUES(?,?,?)').run('retained-producer-payer','2026-09',450);
  const oldSchema=schema(sqlite),receipts=rows(sqlite,receiptTable),caps=rows(sqlite,'memory_derivation_month_caps');
  migrateLocalDatabase(sqlite,{migrations:actualMigrations,dryRun:true});assert.deepEqual(schema(sqlite),oldSchema);assert.deepEqual(rows(sqlite,receiptTable),receipts);
  const applied=migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===target.tag);
  assert.equal(applied.executedStatements,12);assert.equal(applied.status,'applied');
  for(const table of ['memory_derivation_producer_cursors','memory_derivation_producer_jobs'])assert.deepEqual(rows(sqlite,table),[]);
  assert.deepEqual(rows(sqlite,'memory_derivation_month_caps'),caps);
  assert.equal(migrateLocalDatabase(sqlite,{migrations:actualMigrations}).migrations.find(m=>m.tag===target.tag).status,'already-applied');
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
for(const fault of ['altered-upgrade','old-receipted-trigger','old-receipted-index','deferred-fk-changed'])test('Memory producer migration rejects '+fault+' without changing rows',t=>{
  const target=actualMigrations.find(m=>m.tag==='0053_memory_derivation_producers'),sqlite=database(t);
  migrateLocalDatabase(sqlite,{migrations:actualMigrations.slice(0,actualMigrations.indexOf(target))});
  const old=sqlite.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name IN('memory_derivation_job_insert','idx_memory_derivation_job_interval')").all();
  if(fault!=='altered-upgrade')migrateLocalDatabase(sqlite,{migrations:actualMigrations});
  if(fault.startsWith('old-receipted-')){const row=old.find(row=>row.type===fault.slice('old-receipted-'.length));sqlite.exec('DROP '+row.type+' '+row.name+';'+row.sql);}
  if(fault==='deferred-fk-changed'){
    // No data in these new tables. Even a narrower-looking changed declaration
    // must not be reconciled using pragma_foreign_key_list (which loses deferral).
    const table=sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_producer_jobs'").get().sql;
    const attached=sqlite.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='memory_derivation_producer_jobs' AND type='trigger'").all();
    sqlite.exec('DROP TABLE memory_derivation_producer_jobs;'+table.replace('DEFERRABLE INITIALLY DEFERRED','NOT DEFERRABLE INITIALLY IMMEDIATE'));
    for(const row of attached)sqlite.exec(row.sql);
  }
  const snapshot=schema(sqlite),receipts=rows(sqlite,receiptTable);
  const migrations=fault==='altered-upgrade'?actualMigrations.map(m=>m===target?{...m,hash:undefined,sql:m.sql+'\n-- drift'}:m):actualMigrations;
  assert.throws(()=>migrateLocalDatabase(sqlite,{migrations}),/migration_hash_mismatch|migration_schema_mismatch/);
  assert.deepEqual(schema(sqlite),snapshot);assert.deepEqual(rows(sqlite,receiptTable),receipts);
});

for(const fault of ['altered-upgrade','missing-old-trigger','modified-old-trigger','reverted-receipted-trigger'])test('Memory consumer parent upgrade refuses '+fault+' without changing rows',t=>{
 const target=actualMigrations.find(m=>m.tag==='0063_memory_derivation_consumer_parents'),sqlite=database(t);
 migrateLocalDatabase(sqlite,{migrations:actualMigrations.slice(0,actualMigrations.indexOf(target))});
 const old=sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_consumer_update'").get().sql;
 if(fault==='reverted-receipted-trigger')migrateLocalDatabase(sqlite,{migrations:actualMigrations});
 if(fault!=='altered-upgrade'){
  sqlite.exec('DROP TRIGGER memory_derivation_consumer_update');
  if(fault==='modified-old-trigger')sqlite.exec(old.replace("OLD.state='active'","OLD.state='retired'"));
  if(fault==='reverted-receipted-trigger')sqlite.exec(old);
 }
 const before=schema(sqlite),receipts=rows(sqlite,receiptTable);
 const migrations=fault==='altered-upgrade'?actualMigrations.map(m=>m===target?{...m,hash:undefined,sql:m.sql+'\n-- unqualified replacement'}:m):actualMigrations;
 assert.throws(()=>migrateLocalDatabase(sqlite,{migrations}),/migration_hash_mismatch|migration_schema_mismatch/);
 assert.deepEqual(schema(sqlite),before);assert.deepEqual(rows(sqlite,receiptTable),receipts);
});
