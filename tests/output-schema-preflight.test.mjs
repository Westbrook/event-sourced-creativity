import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { canReadOutputSchemaPreflight, handleOutputSchemaPreflight, OUTPUT_SCHEMA_PREFLIGHT_PATH, OUTPUT_SCHEMA_PREFLIGHT_QUERIES, readOutputSchemaPreflight } from "../worker/output-schema-preflight.ts";

const access = capabilities => ({ capabilities, grants: [], organizations: [], projects: [], permissionEpoch: "fixture", canvasAccess: false });
const identity = "platform.identity.manage", diagnostics = "engineering.diagnostics.read";
test("schema preflight requires both independent platform capabilities", () => {
  for (const capabilities of [[], [identity], [diagnostics]]) assert.equal(canReadOutputSchemaPreflight(access(capabilities)), false);
  assert.equal(canReadOutputSchemaPreflight(access([identity, diagnostics])), true);
});

for (const [method, suffix, cookie, expected] of [
  ["POST", "", "", 405], ["HEAD", "", "", 405], ["GET", "?sql=DROP%20TABLE%20users", "", 400],
  ["GET", "", "forma_impersonation=anything", 409], ["GET", "", "forma_project_context=anything", 409],
]) test(`schema preflight rejects ${method}/${suffix || cookie || "method"} before database access`, async () => {
  const env = { get DB() { assert.fail("Rejected input must not reach startup or a DB binding"); } };
  const response = await handleOutputSchemaPreflight(new Request("http://localhost" + OUTPUT_SCHEMA_PREFLIGHT_PATH + suffix, { method, headers: { cookie } }), env);
  assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("schema preflight actual Worker returns exact metadata and aggregate counts without writes or retention", async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close()); await f.drainBackground();
  const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const response = await f.request(OUTPUT_SCHEMA_PREFLIGHT_PATH);
  assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await response.json();
  assert.equal(snapshot.complete, true); assert.equal(snapshot.execution.hostedMigrationCertified, false);
  assert.deepEqual(Object.keys(snapshot.groups), OUTPUT_SCHEMA_PREFLIGHT_QUERIES.map(query => query.id));
  assert.equal(snapshot.groups.output_assets[0].row_count, "0");
  assert.ok(snapshot.groups.catalog.some(row => row.name === "output_assets" && row.sql.includes("CREATE TABLE")));
  assert.ok(snapshot.groups.inboundKeys.some(row => row.child_table === "output_results"));
  assert.equal(snapshot.groups.foreignKeyHealth[0].foreign_key_violation_count, "0");
  assert.doesNotMatch(JSON.stringify(snapshot), /The keeper checks|Saved complete story|in-memory-scene-test/);
  await f.drainBackground();
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
});

test("schema preflight denies the current unprivileged principal without querying metadata", async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close()); await f.drainBackground();
  f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(f.owner);
  const original = f.env.DB.batch; let metadataBatches = 0;
  f.env.DB.batch = async statements => { metadataBatches++; return original(statements); };
  const response = await f.request(OUTPUT_SCHEMA_PREFLIGHT_PATH);
  assert.equal(response.status, 403); assert.equal(metadataBatches, 0);
});

test("schema preflight withholds all partial or oversized metadata", async () => {
  const replies = () => OUTPUT_SCHEMA_PREFLIGHT_QUERIES.map(() => ({ success: true, results: [] }));
  for (const change of [rows => rows.pop(), rows => { rows[0].success = false; },
    rows => { rows[0].results = Array.from({ length: 1001 }, () => ({})); },
    rows => { rows[0].results = [{ sql: "x".repeat(512001) }]; }]) {
    const rows = replies(); change(rows);
    await assert.rejects(readOutputSchemaPreflight({ prepare: sql => sql, batch: async () => rows }), /schema_preflight_(incomplete|too_large)/);
  }
});

test("schema preflight masks database failures and keeps diagnostics noncacheable", async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close()); await f.drainBackground();
  f.env.DB.batch = async () => { throw new Error("sensitive database failure details"); };
  const response = await f.request(OUTPUT_SCHEMA_PREFLIGHT_PATH);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "schema_preflight_unavailable" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("schema checkpoint has no 3D migration or runtime upgrade and preserves normal API retention", async () => {
  const runtime = await readFile(new URL("../worker/runtime.ts", import.meta.url), "utf8");
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.doesNotMatch(runtime, /upgradeOutputRequirementsSchema/);
  assert.equal(journal.entries.some(entry => entry.tag === "0022_output_model3d"), false);
  const router = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(router, /pathname!==OUTPUT_SCHEMA_PREFLIGHT_PATH\)schedulePrivateContentRetention/);
});
