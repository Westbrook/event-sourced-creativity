import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { readWorkerFetchWrapper } from "./helpers/worker-fetch-wrapper.mjs";
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
  const env = { get DB() { return assert.fail("Rejected input must not reach startup or a DB binding"); } };
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
  assert.equal(snapshot.groups.reservedReferences[0].row_count, "0");
  assert.equal(snapshot.groups.legacyAssertion[0].row_count, "0");
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

test("Engineering's actual session exposes the existing dual grant required by schema preflight", async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close()); await f.drainBackground();
  const response = await f.request("/api/session?audience=engineering");
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.audience, "engineering");
  assert.ok(session.capabilities.includes(identity));
  assert.ok(session.capabilities.includes(diagnostics));
  assert.equal(session.capabilities.includes("platform.provider.configure"), false);
});

test("schema preflight withholds all partial or oversized metadata", async () => {
  const replies = () => OUTPUT_SCHEMA_PREFLIGHT_QUERIES.map(query => ({ success: true, results:
    query.id === "settings" ? [{ sqlite_version: null, foreign_keys: 1, defer_foreign_keys: 0, ignore_check_constraints: 0, legacy_alter_table: 0, temp_object_count: 0 }]
      : query.id === "foreignKeyHealth" ? [{ foreign_key_violation_count: "0" }]
        : query.id.startsWith("output_") ? [{ table_name: query.id, row_count: "0" }]
          : ["reservedReferences", "legacyAssertion"].includes(query.id) ? [{ row_count: "0" }] : [] }));
  await assert.doesNotReject(readOutputSchemaPreflight({ prepare: sql => sql, batch: async () => replies() }));
  for (const [change, expected] of [
    [rows => rows.pop(), /schema_preflight_incomplete/],
    [rows => { rows[0].success = false; }, /schema_preflight_incomplete/],
    [rows => { rows[0].results = []; }, /schema_preflight_incomplete/],
    [rows => { rows[5].results[0].row_count = "-1"; }, /schema_preflight_incomplete/],
    [rows => { rows[1].results = Array.from({ length: 1001 }, () => ({})); }, /schema_preflight_too_large/],
    [rows => { rows[1].results = [{ sql: "x".repeat(512001) }]; }, /schema_preflight_too_large/],
  ]) {
    const rows = replies(); change(rows);
    await assert.rejects(readOutputSchemaPreflight({ prepare: sql => sql, batch: async () => rows }), expected);
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

test("integrated release retains the exact hosted-qualified 3D migration and normal API retention", async () => {
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.equal(journal.entries.filter(entry => entry.tag === "0022_output_model3d").length, 1);
  const migration = await readFile(new URL("../drizzle/0022_output_model3d.sql", import.meta.url));
  assert.equal(createHash("sha256").update(migration).digest("hex"), "393bf222f1aa1210d679af3d588ffdf0e989cc6b9bd4db02eeef78cfb9907206");
  const { preflightPath, wrapper } = await readWorkerFetchWrapper();
  assert.equal(preflightPath, OUTPUT_SCHEMA_PREFLIGHT_PATH);
  for (const [path, retentionCalls] of [[OUTPUT_SCHEMA_PREFLIGHT_PATH, 0], ["/api/events", 1], [OUTPUT_SCHEMA_PREFLIGHT_PATH + "-extra", 1]]) {
    const current = wrapper(200);
    const response = await current.fetch(new Request(`https://forma.invalid${path}`), {}, {});
    assert.equal(response.status, 200);
    assert.deepEqual(current.counts(), { retentionCalls, routes: 1 }, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

for (const [method, suffix, cookie, expected] of [
 ['PUT','','',405],['GET','?sql=SELECT%201','',400],['GET','','forma_impersonation=1',409],['GET','','forma_project_context=1',409],['POST','','',403],
]) test(`Memory repair administration rejects ${method}/${suffix||cookie||'origin'} before DB access`,async()=>{
 const {handleMemorySchemaRepair,MEMORY_SCHEMA_REPAIR_PATH}=await import('../worker/memory-schema-repair-api.ts');
 const env={get DB(){assert.fail('No database access for rejected input');}};
 const r=await handleMemorySchemaRepair(new Request('http://localhost'+MEMORY_SCHEMA_REPAIR_PATH+suffix,{method,headers:{cookie}}),env);
 assert.equal(r.status,expected);assert.equal(r.headers.get('cache-control'),'private, no-store');
});

test('Memory repair actual Worker inspection is read-only, capability-protected and default-disabled',async t=>{
 const {MEMORY_SCHEMA_REPAIR_PATH}=await import('../worker/memory-schema-repair-api.ts');
 const f=await createSceneCostFixture(1);t.after(()=>f.close());await f.drainBackground();
 const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
 const r=await f.request(MEMORY_SCHEMA_REPAIR_PATH);assert.equal(r.status,200,await r.clone().text());
 const html=await r.text();assert.match(html,/Memory schema repair inspection/);assert.doesNotMatch(html,/<form|keeper checks|in-memory-scene-test/);
 await f.drainBackground();assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
 const denied=await f.request(MEMORY_SCHEMA_REPAIR_PATH,{method:'POST',headers:{origin:'http://localhost','content-type':'application/x-www-form-urlencoded'},body:'proof='+'0'.repeat(64)});
 assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:'repair_not_enabled'});
 f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(f.owner);
 assert.equal((await f.request(MEMORY_SCHEMA_REPAIR_PATH)).status,403);
});

test('Memory repair native administrator form applies once and refuses enabled Memory',async t=>{
 const {MEMORY_SCHEMA_REPAIR_PATH}=await import('../worker/memory-schema-repair-api.ts');
 const {MEMORY_SCHEMA_REPAIR_MANIFEST}=await import('../worker/memory-schema-repair.ts');
 const {readLocalMigrations,migrateLocalDatabase}=await import('../scripts/lib/local-migrations.mjs');
 const f=await createSceneCostFixture(1);t.after(()=>f.close());await f.drainBackground();
 const {DatabaseSync}=await import('node:sqlite');const baseline=new DatabaseSync(':memory:');t.after(()=>baseline.close());
 migrateLocalDatabase(baseline,{migrations:readLocalMigrations(new URL('../drizzle/',import.meta.url)).slice(0,41)});
 const baselineObjects=baseline.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name!='__forma_local_migrations'").all();
 for(const kind of ['table','index','trigger'])for(const row of baselineObjects)if(row.type===kind&&!f.sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(row.name))f.sqlite.exec(row.sql);
 f.env.FORMA_MEMORY_SCHEMA_REPAIR_MANIFEST=MEMORY_SCHEMA_REPAIR_MANIFEST;
 const page=await f.request(MEMORY_SCHEMA_REPAIR_PATH);assert.equal(page.status,200,await page.clone().text());const html=await page.text();
 const proof=html.match(/name="proof" value="([a-f0-9]{64})"/)?.[1];assert.ok(proof,html);
 const request={method:'POST',headers:{origin:'http://localhost','content-type':'application/x-www-form-urlencoded'},body:'proof='+proof};
 f.env.FORMA_MEMORY_ENABLED='true';assert.equal((await f.request(MEMORY_SCHEMA_REPAIR_PATH,request)).status,403);delete f.env.FORMA_MEMORY_ENABLED;
 const result=await f.request(MEMORY_SCHEMA_REPAIR_PATH,request);assert.equal(result.status,200,await result.clone().text());assert.match(await result.text(),/Memory schema repair completed/);
 const after=await f.request(MEMORY_SCHEMA_REPAIR_PATH);assert.doesNotMatch(await after.text(),/<form/);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM __forma_memory_schema_repair_receipts').get().n,1);
});
