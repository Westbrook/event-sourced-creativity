import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readLocalMigrations, migrateLocalDatabase } from "../scripts/lib/local-migrations.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const actualDirectory = process.env.FORMA_MIGRATION_TEST_DIRECTORY ?? new URL("../drizzle/", import.meta.url);
const actualMigrations = readLocalMigrations(actualDirectory);
const assistantTags = ["0020_assistant_runtime_tables", "0021_assistant_specialist_consent"];
const assistantMigrations = actualMigrations.some(migration => migration.tag === assistantTags[1])
  ? assistantTags.map(tag => actualMigrations.find(migration => migration.tag === tag))
  : readLocalMigrations(new URL("./fixtures/local-migrations/", import.meta.url));
const receiptTable = "__forma_local_migrations";

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
  return sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}
function rows(sqlite, table) {
  return sqlite.prepare(`SELECT rowid AS original_rowid,* FROM "${table}" ORDER BY rowid`).all().map(row => ({ ...row }));
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
  for (const migration of actualMigrations) sqlite.exec(migration.sql);
  seedEvent(sqlite);
  const beforeSchema = schema(sqlite), beforeEvents = rows(sqlite, "events");
  const result = migrateLocalDatabase(sqlite, { migrations: actualMigrations });
  assert.ok(result.migrations.every(migration => migration.status === "verified-existing"));
  assert.deepEqual(schema(sqlite).filter(object => object.tbl_name !== receiptTable), beforeSchema);
  assert.deepEqual(rows(sqlite, "events"), beforeEvents);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='__drizzle_migrations'").get(), undefined);
});

test("local migrations: Sites version 170 source upgrades through the four pending migrations despite its later Output timestamp", {
  skip: !actualMigrations.some(migration => migration.tag === assistantTags[1]),
}, t => {
  const additions = new Set(["0018_consequential_consent", "0019_authoring_commits", ...assistantTags]);
  const baseline = actualMigrations.filter(migration => !additions.has(migration.tag));
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
