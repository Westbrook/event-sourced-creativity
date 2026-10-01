import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readLocalMigrations, migrateLocalDatabase } from "../scripts/lib/local-migrations.mjs";

const directory = process.env.FORMA_MIGRATION_TEST_DIRECTORY ?? new URL("../drizzle/", import.meta.url);
const migration = readLocalMigrations(directory).find(entry => entry.tag === "0023_experience_release_heads");
assert.ok(migration, "the managed-release migration must be present");
const migrations = [migration];
const tables = ["delivery_experience_bindings", "experience_release_heads"];

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  t.after(() => sqlite.close());
  return sqlite;
}
function schema(sqlite) {
  return sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}
function rows(sqlite, table) {
  return sqlite.prepare(`SELECT rowid AS original_rowid,* FROM "${table}" ORDER BY rowid`).all();
}
function insert(sqlite, table, row) {
  return sqlite.prepare(`INSERT INTO "${table}" (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
}
function binding(id, overrides = {}) {
  return {
    decision_id: id, proposal_event_id: `proposal-${id}`, binding_hash: `binding-${id}`,
    experience_id: "slides", channel: "managed-fixture", operation: "publish",
    release_hash: "release", source_hash: "source", build_hash: "build", evaluation_hash: "evaluation",
    expected_head_revision: 0, expected_head_event_id: null, rollback_event_id: null,
    created_at: "2026-09-05T12:00:00.000Z", ...overrides,
  };
}
function head(overrides = {}) {
  return {
    experience_id: "slides", channel: "managed-fixture", revision: 1,
    publication_event_id: "publication-1", decision_id: "decision-1", binding_hash: "binding-1",
    release_hash: "release", updated_at: "2026-09-05T12:00:00.000Z", ...overrides,
  };
}

test("experience release schema: fresh migration admits initial, replacement and rollback bindings without a second approval store", t => {
  const sqlite = database(t);
  const result = migrateLocalDatabase(sqlite, { migrations });
  assert.equal(result.migrations[0].status, "applied");
  insert(sqlite, tables[0], binding("initial"));
  insert(sqlite, tables[0], binding("replacement", { expected_head_revision: 1, expected_head_event_id: "publication-1" }));
  insert(sqlite, tables[0], binding("rollback", {
    operation: "rollback", expected_head_revision: 2, expected_head_event_id: "publication-2", rollback_event_id: "publication-1",
  }));
  insert(sqlite, tables[1], head());
  assert.equal(rows(sqlite, tables[0]).length, 3);
  assert.equal(rows(sqlite, tables[1])[0].revision, 1);
  assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
    ["__forma_local_migrations", ...tables]);
  for (const table of tables) assert.deepEqual(sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all(), []);
});

test("experience release schema: bindings reject invalid scope, predecessor, rollback and identity values and direct mutation", t => {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations });
  insert(sqlite, tables[0], binding("original"));
  const original = rows(sqlite, tables[0]);
  const invalid = [
    { channel: "public" }, { operation: "approve" },
    { expected_head_revision: -1 }, { expected_head_revision: 0.5 }, { expected_head_revision: "invalid" },
    { expected_head_revision: null }, { expected_head_event_id: "unexpected" },
    { expected_head_revision: 1, expected_head_event_id: null },
    { rollback_event_id: "unexpected" }, { operation: "rollback", rollback_event_id: null },
    { proposal_event_id: null }, { decision_id: null }, { binding_hash: null },
    { source_hash: null }, { build_hash: null }, { evaluation_hash: null },
  ];
  for (const [index, overrides] of invalid.entries()) {
    assert.throws(() => insert(sqlite, tables[0], binding(`invalid-${index}`, overrides)), /constraint/i, JSON.stringify(overrides));
  }
  assert.throws(() => insert(sqlite, tables[0], binding("original", { proposal_event_id: "different" })), /experience bindings are immutable/);
  assert.throws(() => insert(sqlite, tables[0], binding("different", { proposal_event_id: "proposal-original" })), /experience bindings are immutable/);
  assert.throws(() => sqlite.exec("UPDATE delivery_experience_bindings SET build_hash='changed' WHERE decision_id='original'"), /experience bindings are immutable/);
  assert.throws(() => sqlite.exec("DELETE FROM delivery_experience_bindings WHERE decision_id='original'"), /experience bindings are immutable/);
  assert.deepEqual(rows(sqlite, tables[0]), original);
});

test("experience release schema: conflicting INSERT OR REPLACE cannot replace retained bindings with recursive triggers disabled or enabled", t => {
  for (const recursive of [0, 1]) {
    const sqlite = database(t);
    sqlite.exec(`PRAGMA recursive_triggers=${recursive}`);
    migrateLocalDatabase(sqlite, { migrations });
    insert(sqlite, tables[0], binding("original"));
    const original = rows(sqlite, tables[0]);
    const replacements = [
      binding("original", { proposal_event_id: "new-proposal", build_hash: "changed" }),
      binding("new-decision", { proposal_event_id: "proposal-original", build_hash: "changed" }),
    ];
    for (const row of replacements) {
      const replacement = sqlite.prepare(`INSERT OR REPLACE INTO delivery_experience_bindings (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`);
      assert.throws(() => replacement.run(...Object.values(row)), /experience bindings are immutable/);
      assert.deepEqual(rows(sqlite, tables[0]), original);
    }
  }
});

test("experience release schema: heads require positive integer revisions, one channel head and unique publication identity", t => {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations });
  insert(sqlite, tables[1], head());
  const original = rows(sqlite, tables[1]);
  const invalid = [
    { channel: "public" }, { revision: 0 }, { revision: -1 }, { revision: 1.5 },
    { revision: "invalid" }, { revision: null }, { experience_id: null }, { channel: null },
    { publication_event_id: null }, { decision_id: null }, { binding_hash: null },
  ];
  for (const [index, overrides] of invalid.entries()) {
    assert.throws(() => insert(sqlite, tables[1], head({ experience_id: `experience-${index}`, publication_event_id: `event-${index}`, ...overrides })), /constraint/i, JSON.stringify(overrides));
  }
  assert.throws(() => insert(sqlite, tables[1], head({ publication_event_id: "publication-2" })), /UNIQUE constraint/);
  assert.throws(() => insert(sqlite, tables[1], head({ experience_id: "audio" })), /UNIQUE constraint/);
  assert.deepEqual(rows(sqlite, tables[1]), original);
});

test("experience release schema: migration-owned storage and repeated application preserve bindings, heads, receipts and triggers", t => {
  const runtime = readFileSync(new URL("../worker/runtime.ts", import.meta.url), "utf8");
  const bootstrap = [...runtime.matchAll(/env\.DB\.prepare\(("(?:[^"\\]|\\.)*")\)/gu)]
    .map(match => JSON.parse(match[1]))
    .filter(sql => /^CREATE (?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:delivery_experience_bindings|experience_release_heads|idx_delivery_experience_bindings_)/u.test(sql));
  assert.deepEqual(bootstrap, [], "managed-release storage is created by its migration, not runtime initialization");
  const sqlite = database(t);
  assert.equal(migrateLocalDatabase(sqlite, { migrations }).migrations[0].status, "applied");
  insert(sqlite, tables[0], binding("original"));
  insert(sqlite, tables[1], head());
  const originalBindings = rows(sqlite, tables[0]), originalHeads = rows(sqlite, tables[1]);
  const originalSchema = schema(sqlite), originalReceipts = rows(sqlite, "__forma_local_migrations");
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(migrateLocalDatabase(sqlite, { migrations }).migrations[0].status, "already-applied");
    assert.deepEqual(schema(sqlite), originalSchema);
    assert.deepEqual(rows(sqlite, tables[0]), originalBindings);
    assert.deepEqual(rows(sqlite, tables[1]), originalHeads);
    assert.deepEqual(rows(sqlite, "__forma_local_migrations"), originalReceipts);
  }
});

test("experience release schema: incompatible revision constraints or immutability triggers fail without repair", t => {
  const weaker = [
    migration.sql.replace("typeof(\"delivery_experience_bindings\".\"expected_head_revision\")='integer' AND ", ""),
    migration.sql.replace("typeof(\"experience_release_heads\".\"revision\")='integer' AND ", ""),
    migration.sql.replace("ON `delivery_experience_bindings` (`experience_id`,`channel`,`created_at`)", "ON `delivery_experience_bindings` (`experience_id`,`channel`)"),
    migration.sql.replace("decision_id=NEW.decision_id OR proposal_event_id=NEW.proposal_event_id", "decision_id=NEW.decision_id"),
    migration.sql.replace("BEFORE UPDATE ON delivery_experience_bindings BEGIN SELECT RAISE(ABORT,'experience bindings are immutable'); END", "BEFORE UPDATE ON delivery_experience_bindings BEGIN SELECT 1; END"),
  ];
  for (const sql of weaker) {
    assert.notEqual(sql, migration.sql);
    const sqlite = database(t);
    sqlite.exec(sql);
    insert(sqlite, tables[0], binding("original"));
    insert(sqlite, tables[1], head());
    const originalSchema = schema(sqlite), originalBindings = rows(sqlite, tables[0]), originalHeads = rows(sqlite, tables[1]);
    assert.throws(() => migrateLocalDatabase(sqlite, { migrations }), /migration_schema_mismatch/);
    assert.deepEqual(schema(sqlite), originalSchema);
    assert.deepEqual(rows(sqlite, tables[0]), originalBindings);
    assert.deepEqual(rows(sqlite, tables[1]), originalHeads);
  }
});

// SOURCE-only addition until the owner generates and supplies the reserved
// migration. These cases consume that migration; they do not synthesize SQL.
const maintenanceTables = ["delivery_experience_maintenance_bindings", "experience_maintenance_heads"];
function maintenanceMigrations() {
  const adoption = readLocalMigrations(directory).find(entry => entry.tag === "0030_experience_maintenance_adoption");
  assert.ok(adoption, "the owner-generated maintenance-adoption migration must be present");
  return [migration, adoption];
}
function maintenanceBinding(id, overrides = {}) {
  return {
    decision_id: id, proposal_event_id: `maintenance-proposal-${id}`, binding_hash: `maintenance-binding-${id}`,
    subject_hash: "subject", experience_id: "model3d", channel: "managed-fixture",
    release_hash: "release", source_hash: "source", build_hash: "build", evaluation_hash: "evaluation",
    binding_json: "{}", expected_head_revision: 0, expected_head_event_id: null,
    created_at: "2026-09-06T12:00:00.000Z", ...overrides,
  };
}
function maintenanceHead(overrides = {}) {
  return {
    subject_hash: "subject", experience_id: "model3d", channel: "managed-fixture", material_selection_hash: "material",
    revision: 1, adoption_event_id: "adoption-1", decision_id: "maintenance-decision-1", binding_hash: "maintenance-binding-1",
    baseline_observation_hash: "observation", profile_ref: "model3d.code-declarations@1", profile_hash: "profile", inventory_hash: "inventory",
    updated_at: "2026-09-06T12:00:00.000Z", ...overrides,
  };
}

test("maintenance adoption schema: adds only immutable bindings and exact-material heads without changing publication storage", t => {
  const sqlite = database(t), allocated = maintenanceMigrations();
  migrateLocalDatabase(sqlite, { migrations });
  insert(sqlite, tables[0], binding("publication-original"));
  insert(sqlite, tables[1], head());
  const retained = tables.map(table => rows(sqlite, table));
  assert.equal(migrateLocalDatabase(sqlite, { migrations: allocated }).migrations[1].status, "applied");
  insert(sqlite, maintenanceTables[0], maintenanceBinding("initial"));
  insert(sqlite, maintenanceTables[0], maintenanceBinding("replacement", { expected_head_revision: 1, expected_head_event_id: "adoption-1" }));
  insert(sqlite, maintenanceTables[1], maintenanceHead());
  assert.equal(rows(sqlite, maintenanceTables[0]).length, 2);
  assert.equal(rows(sqlite, maintenanceTables[1])[0].revision, 1);
  assert.deepEqual(tables.map(table => rows(sqlite, table)), retained);
  assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
    ["__forma_local_migrations", ...tables, ...maintenanceTables].sort());
  for (const table of maintenanceTables) assert.deepEqual(sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all(), []);
});

test("maintenance adoption schema: binding scope and predecessor are closed and retained originals cannot be replaced", t => {
  for (const recursive of [0, 1]) {
    const sqlite = database(t);
    sqlite.exec(`PRAGMA recursive_triggers=${recursive}`);
    migrateLocalDatabase(sqlite, { migrations: maintenanceMigrations() });
    insert(sqlite, maintenanceTables[0], maintenanceBinding("original"));
    const original = rows(sqlite, maintenanceTables[0]);
    for (const [index, overrides] of [
      { channel: "public" }, { expected_head_revision: -1 }, { expected_head_revision: 0.5 },
      { expected_head_revision: "invalid" }, { expected_head_revision: null }, { expected_head_event_id: "unexpected" },
      { expected_head_revision: 1, expected_head_event_id: null }, { decision_id: null }, { proposal_event_id: null },
      { subject_hash: null }, { binding_hash: null }, { binding_json: null }, { release_hash: null },
      { source_hash: null }, { build_hash: null }, { evaluation_hash: null },
    ].entries()) assert.throws(() => insert(sqlite, maintenanceTables[0], maintenanceBinding(`invalid-${index}`, overrides)), /constraint/i, JSON.stringify(overrides));
    for (const replacement of [
      maintenanceBinding("original", { proposal_event_id: "new-proposal", binding_json: '{"changed":true}' }),
      maintenanceBinding("new-decision", { proposal_event_id: "maintenance-proposal-original", binding_json: '{"changed":true}' }),
    ]) {
      assert.throws(() => insert(sqlite, maintenanceTables[0], replacement), /immutable/i);
      const statement = sqlite.prepare(`INSERT OR REPLACE INTO delivery_experience_maintenance_bindings (${Object.keys(replacement).join(",")}) VALUES (${Object.keys(replacement).map(() => "?").join(",")})`);
      assert.throws(() => statement.run(...Object.values(replacement)), /immutable/i);
    }
    assert.throws(() => sqlite.exec("UPDATE delivery_experience_maintenance_bindings SET binding_json='{}' WHERE decision_id='original'"), /immutable/i);
    assert.throws(() => sqlite.exec("DELETE FROM delivery_experience_maintenance_bindings WHERE decision_id='original'"), /immutable/i);
    assert.deepEqual(rows(sqlite, maintenanceTables[0]), original);
  }
});

test("maintenance adoption schema: positive revisions, fixed profiles and unique adoption identities fail closed", t => {
  const sqlite = database(t);
  migrateLocalDatabase(sqlite, { migrations: maintenanceMigrations() });
  insert(sqlite, maintenanceTables[1], maintenanceHead());
  const original = rows(sqlite, maintenanceTables[1]);
  for (const [index, overrides] of [
    { channel: "public" }, { revision: 0 }, { revision: -1 }, { revision: 1.5 }, { revision: "invalid" }, { revision: null },
    { profile_ref: "audio.code-declarations@1" }, { profile_ref: null }, { subject_hash: null }, { material_selection_hash: null },
    { adoption_event_id: null }, { binding_hash: null }, { baseline_observation_hash: null }, { profile_hash: null }, { inventory_hash: null },
  ].entries()) assert.throws(() => insert(sqlite, maintenanceTables[1], maintenanceHead({ subject_hash: `subject-${index}`, adoption_event_id: `adoption-${index + 2}`, ...overrides })), /constraint/i, JSON.stringify(overrides));
  assert.throws(() => insert(sqlite, maintenanceTables[1], maintenanceHead({ adoption_event_id: "adoption-2" })), /UNIQUE constraint/);
  assert.throws(() => insert(sqlite, maintenanceTables[1], maintenanceHead({ subject_hash: "different-material" })), /UNIQUE constraint/);
  assert.deepEqual(rows(sqlite, maintenanceTables[1]), original);
});

test("maintenance adoption schema: repeat migration retains bindings, heads and receipts without runtime bootstrap repair", t => {
  const runtime = readFileSync(new URL("../worker/runtime.ts", import.meta.url), "utf8");
  const bootstrap = [...runtime.matchAll(/env\.DB\.prepare\(("(?:[^"\\]|\\.)*")\)/gu)]
    .map(match => JSON.parse(match[1]))
    .filter(sql => /^CREATE (?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (?:delivery_experience_maintenance_bindings|experience_maintenance_heads|idx_delivery_experience_maintenance_bindings_)/u.test(sql));
  assert.deepEqual(bootstrap, [], "adoption storage must be owned by the allocated migration");
  const sqlite = database(t), allocated = maintenanceMigrations();
  migrateLocalDatabase(sqlite, { migrations: allocated });
  insert(sqlite, maintenanceTables[0], maintenanceBinding("original"));
  insert(sqlite, maintenanceTables[1], maintenanceHead());
  const originalSchema = schema(sqlite), originalRows = [...maintenanceTables, "__forma_local_migrations"].map(table => rows(sqlite, table));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(migrateLocalDatabase(sqlite, { migrations: allocated }).migrations.every(entry => entry.status === "already-applied"));
    assert.deepEqual(schema(sqlite), originalSchema);
    assert.deepEqual([...maintenanceTables, "__forma_local_migrations"].map(table => rows(sqlite, table)), originalRows);
  }
});
