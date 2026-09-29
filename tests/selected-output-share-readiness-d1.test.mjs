import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "../worker/selected-output-share-schema.ts";
import { selectedOutputShareSchemaAssertion, selectedOutputShareSchemaState } from "../worker/selected-output-share-readiness.ts";

const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve("wrangler"))("miniflare");

test("exact catalog readiness queries qualify disposable local workerd D1 without remote access", { timeout: 60000 }, async t => {
  const egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", host: "127.0.0.1", port: 0,
    script: "export default {fetch(){return new Response('Local readiness qualification only',{status:404});}};",
    d1Databases: ["SelectedShare"], log: new Log(LogLevel.NONE),
    outboundService(request) { egress.push(request.url); throw new Error("External requests prohibited"); },
  });
  t.after(async () => { await mf.dispose(); assert.deepEqual(egress, []); });
  const DB = await mf.getD1Database("SelectedShare"), env = { DB };
  // Local D1 creates its own _cf_METADATA lazily after the first statement.
  // Establish that platform state before measuring application schema changes.
  await DB.prepare("SELECT 1 AS initialized").first();
  const before = (await DB.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all()).results;
  assert.equal(await selectedOutputShareSchemaState(env), "absent");
  assert.deepEqual((await DB.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all()).results, before);
  await DB.batch(SELECTED_OUTPUT_SHARE_SCHEMA.map(sql => DB.prepare(sql)));
  const installed = (await DB.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all()).results;
  assert.equal(await selectedOutputShareSchemaState(env), "ready");
  const ready = selectedOutputShareSchemaAssertion(), absent = selectedOutputShareSchemaAssertion("absent");
  for (const guard of [ready, absent]) {
    assert.ok(guard.bindings.length <= 100);
    assert.ok(Buffer.byteLength(guard.sql) < 100_000);
  }
  assert.equal((await DB.prepare(`SELECT (${ready.sql}) AS permitted`).bind(...ready.bindings).first()).permitted, 1);
  assert.equal((await DB.prepare(`SELECT (${absent.sql}) AS permitted`).bind(...absent.bindings).first()).permitted, 0);
  assert.deepEqual((await DB.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all()).results, installed);
  await DB.prepare("DROP TRIGGER selected_output_share_immutable").run();
  assert.equal(await selectedOutputShareSchemaState(env), "unavailable");
  assert.equal((await DB.prepare(`SELECT (${ready.sql}) AS permitted`).bind(...ready.bindings).first()).permitted, 0);
  await DB.prepare(SELECTED_OUTPUT_SHARE_SCHEMA.find(sql => sql.startsWith("CREATE TRIGGER selected_output_share_immutable "))).run();
  assert.equal(await selectedOutputShareSchemaState(env), "ready");
  t.diagnostic("Actual bundled local workerd D1 executes main.sqlite_schema + temp.sqlite_schema guards. Synthetic schema only; no production migration or real share.");
});
