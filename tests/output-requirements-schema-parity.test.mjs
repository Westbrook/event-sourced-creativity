import assert from "node:assert/strict";
import test from "node:test";
import { coldProductionDatabase, outputSchema, outputMigration, runtimeOnly } from "./output-schema-test-helpers.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "../worker/output-requirements-schema.ts";
const hooks = registerOutputSourceImports();
const { ensureOutputRequirementsSchema } = await import("../worker/output-requirements-ledger.ts");
hooks.deregister();
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

const rows = ["output_atomic_assertions", "output_commands", "output_plan_revisions", "output_plan_targets", "output_preflights", "output_execution_grants", "output_operation_slots", "output_operation_routes", "output_provider_calls", "output_assets", "output_asset_storage_writes", "output_native_storage_writes", "output_results", "output_target_acceptances", "output_plan_fulfillments", "output_delivery_manifests"];
function valueFor(table, column) {
  const id = { scope_key: "scope", owner_user_id: "owner", actor_user_id: "owner", payer_user_id: "owner", created_by_user_id: "owner", reviewer_user_id: "reviewer", project_id: "project", document_id: "document", plan_revision_id: "plan", plan_id: "document", target_id: "target", preflight_id: "preflight", grant_id: "grant", slot_id: "slot", stage_key: "stage", call_key: "call", asset_id: "asset", result_id: "result", acceptance_id: "acceptance" };
  if (column.name in id) return id[column.name];
  if (column.name === "scope_kind") return "personal";
  if (column.name === "media_kind") return "image";
  if (column.name === "checks_status") return "passed";
  if (column.name === "content_sha256") return "a".repeat(64);
  if (column.name === "status") return table.includes("storage_writes") ? "writing" : table === "output_provider_calls" ? "pending" : "authorized";
  if (["organization_id", "project_access_id", "context_id", "previous_slot_id", "redacted_at", "provider_response_id", "settled_at", "used_microusd"].includes(column.name)) return null;
  if (column.name.endsWith("event_id")) return "event";
  if (column.name === "byte_length") return 100;
  if (column.name === "maximum_tokens") return 1000;
  if (column.name.includes("microusd")) return 100;
  if (["source_head", "ordinal", "attempt_ordinal", "write_acknowledged", "is_partial"].includes(column.name)) return 0;
  if (column.type.toUpperCase() === "INTEGER") return 1;
  return column.name;
}
function seedValidGraph(sqlite) {
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES('event','creative:owner',1,'now','now','user:owner','test','migration-proof',1,'SchemaFixture','{}')").run();
  for (const table of rows) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
    sqlite.prepare(`INSERT INTO ${quote(table)}(${columns.map((c) => quote(c.name)).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => valueFor(table, column)));
  }
}

const invalidChanges = [
  ["output_atomic_assertions", "passed", 0], ["output_plan_revisions", "scope_kind", "foreign"], ["output_plan_revisions", "revision", 0], ["output_plan_revisions", "revision", 1.5], ["output_plan_revisions", "source_head", -1], ["output_plan_revisions", "target_count", 1001], ["output_plan_revisions", "scope_kind", "project"],
  ["output_plan_targets", "media_kind", "invalid"], ["output_plan_targets", "required", 2], ["output_plan_targets", "selected", 2], ["output_plan_targets", "ordinal", -1],
  ["output_execution_grants", "maximum_microusd", 0], ["output_execution_grants", "maximum_microusd", 0.5], ["output_execution_grants", "maximum_microusd", 1000000000001], ["output_execution_grants", "maximum_calls", 10001], ["output_execution_grants", "status", "invalid"],
  ["output_operation_slots", "maximum_microusd", 0], ["output_operation_slots", "maximum_calls", 1001], ["output_operation_slots", "maximum_tokens", 0], ["output_operation_slots", "attempt_ordinal", -1], ["output_operation_slots", "previous_slot_id", "slot"], ["output_operation_slots", "status", "invalid"],
  ["output_operation_routes", "maximum_calls", 0], ["output_operation_routes", "maximum_calls", 1.5], ["output_provider_calls", "reserved_microusd", 0], ["output_provider_calls", "used_microusd", -1], ["output_provider_calls", "used_microusd", 0.5], ["output_provider_calls", "status", "invalid"],
  ["output_assets", "byte_length", 0], ["output_assets", "media_kind", "unknown"], ["output_native_storage_writes", "write_acknowledged", 2], ["output_native_storage_writes", "status", "invalid"],
  ["output_asset_storage_writes", "byte_length", 24000001], ["output_asset_storage_writes", "write_acknowledged", 2], ["output_asset_storage_writes", "status", "invalid"], ["output_asset_storage_writes", "organization_id", "org"], ["output_results", "checks_status", "invalid"], ["output_delivery_manifests", "is_partial", 2],
];

test("production migration and runtime-only bootstrap have identical actual columns, indexes, foreign keys and CHECK predicates", () => {
  const migrated = coldProductionDatabase(), runtime = coldProductionDatabase();
  migrated.sqlite.exec(outputMigration);
  runtimeOnly(runtime);
  const expected = outputSchema(runtime.sqlite);
  assert.equal(expected.length, 16);
  assert.deepEqual(outputSchema(migrated.sqlite), expected);
  const hashed = expected.filter((table) => table.columns.some((column) => column.name === "content_sha256"));
  assert.deepEqual(hashed.map((table) => table.name), ["output_asset_storage_writes", "output_assets", "output_native_storage_writes", "output_results", "output_target_acceptances"]);
  for (const table of hashed) assert.equal(table.columns.find((column) => column.name === "content_sha256").notnull, 1);
  assert.deepEqual(expected.find((table) => table.name === "output_plan_revisions").indexes.find((index) => index.name === "idx_output_plans_document").keys.map((key) => key.descending), [0, 0, 1]);
  for (const state of [migrated, runtime]) {
    state.sqlite.exec(outputMigration);
    state.sqlite.exec(outputMigration);
    runtimeOnly(state);
    runtimeOnly(state);
    assert.deepEqual(outputSchema(state.sqlite), expected, "both orders and repeated initialization preserve every physical index without duplicates");
  }
});

test("both cold construction paths enforce real hash, count, money, scope and graph constraints", () => {
  for (const kind of ["migration", "runtime"]) {
    const state = coldProductionDatabase();
    if (kind === "migration") state.sqlite.exec(outputMigration); else runtimeOnly(state);
    seedValidGraph(state.sqlite);
    for (const [table, field, value] of invalidChanges) assert.throws(() => state.sqlite.prepare(`UPDATE ${quote(table)} SET ${quote(field)}=?`).run(value), /CHECK constraint failed/u, `${kind}:${table}.${field}=${value}`);
    for (const table of ["output_assets", "output_native_storage_writes", "output_asset_storage_writes", "output_results", "output_target_acceptances"]) {
      assert.equal(state.sqlite.prepare(`SELECT content_sha256 FROM ${quote(table)}`).get().content_sha256, "a".repeat(64));
      assert.throws(() => state.sqlite.prepare(`UPDATE ${quote(table)} SET content_sha256=NULL`).run(), /NOT NULL constraint failed/u);
    }
    assert.throws(() => state.sqlite.prepare("UPDATE output_plan_targets SET scope_key='foreign'").run(), /FOREIGN KEY constraint failed/u);
    assert.throws(() => state.sqlite.prepare("UPDATE output_results SET asset_id='foreign'").run(), /FOREIGN KEY constraint failed/u);
    assert.throws(() => state.sqlite.prepare("UPDATE output_plan_fulfillments SET acceptance_id='foreign'").run(), /FOREIGN KEY constraint failed/u);
    assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    // Exercise each canonical unique index separately. Foreign keys are tested
    // above; disable only for constructing isolated duplicate-index candidates.
    state.sqlite.exec("PRAGMA foreign_keys=OFF");
    for (const table of rows) {
      const columns = state.sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
      const original = state.sqlite.prepare(`SELECT * FROM ${quote(table)}`).get();
      const indexes = state.sqlite.prepare(`PRAGMA index_list(${quote(table)})`).all().filter((index) => index.unique && index.origin === "c").map((index) => ({ ...index, keys: state.sqlite.prepare(`PRAGMA index_info(${quote(index.name)})`).all().map((key) => key.name) }));
      for (const index of indexes) {
        const candidate = { ...original };
        for (const column of columns.filter((column) => column.pk)) if (!index.keys.includes(column.name)) candidate[column.name] = `other-${column.name}`;
        for (const other of indexes.filter((other) => other.name !== index.name)) {
          const key = other.keys.find((key) => !index.keys.includes(key) && typeof candidate[key] === "string");
          if (key) candidate[key] = `other-${key}`;
        }
        assert.throws(() => state.sqlite.prepare(`INSERT INTO ${quote(table)}(${columns.map((column) => quote(column.name)).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => candidate[column.name])), /UNIQUE constraint failed/u, `${kind}:${index.name}`);
      }
    }
  }
});


test("a failed named unique index aborts the entire runtime schema batch and does not mark initialization ready", async () => {
  const state = coldProductionDatabase();
  const assets = OUTPUT_REQUIREMENTS_SCHEMA.find((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS output_assets("));
  assert.ok(assets);
  state.sqlite.exec(assets);
  state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES('event','creative:owner',1,'now','now','user:owner','test','schema-failure',1,'SchemaFixture','{}')").run();
  const columns = state.sqlite.prepare("PRAGMA table_info(output_assets)").all();
  for (const assetId of ["one", "two"]) {
    const values = columns.map((column) => column.name === "asset_id" ? assetId : valueFor("output_assets", column));
    state.sqlite.prepare(`INSERT INTO output_assets(${columns.map((column) => quote(column.name)).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...values);
  }
  await assert.rejects(ensureOutputRequirementsSchema(state.env), /UNIQUE constraint failed/u);
  assert.equal(outputSchema(state.sqlite).length, 1, "all newly created tables roll back with the failed index");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets").get().count, 2);
  state.sqlite.prepare("DELETE FROM output_assets WHERE asset_id='two'").run();
  await ensureOutputRequirementsSchema(state.env);
  assert.equal(outputSchema(state.sqlite).length, 16, "the failed initializer was not cached as ready");
  assert.ok(state.sqlite.prepare("PRAGMA index_list(output_assets)").all().some((index) => index.name === "idx_output_assets_unique_1" && index.unique === 1));
});
