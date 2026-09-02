import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { registerHooks } from "node:module";
import test from "node:test";

const root = new URL("../", import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  const local = context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return next(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
} });
const { readOutputSchemaPreflight } = await import("../worker/output-schema-preflight.ts");
hook.deregister();
const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve("wrangler"))("miniflare");

test("schema preflight queries execute read-only against disposable actual local D1", { timeout: 60000 }, async t => {
  const egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", host: "127.0.0.1", port: 0,
    script: "export default { fetch() { return new Response('Local qualification only', {status:404}); } };",
    d1Databases: ["Preflight"], log: new Log(LogLevel.NONE),
    outboundService: request => { egress.push(request.url); throw new Error("External requests prohibited"); },
  });
  t.after(async () => { await mf.dispose(); assert.deepEqual(egress, []); });
  const db = await mf.getD1Database("Preflight");
  for (const file of ["0000_lively_owl.sql", "0018_output_requirements.sql"]) {
    const sql = await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8");
    await db.batch(sql.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
  const before = await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();
  const snapshot = await readOutputSchemaPreflight(db);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.groups.settings[0].foreign_keys, 1);
  assert.equal(snapshot.groups.settings[0].defer_foreign_keys, 0);
  assert.equal(snapshot.groups.output_assets[0].row_count, "0");
  assert.equal(snapshot.groups.foreignKeyHealth[0].foreign_key_violation_count, "0");
  assert.deepEqual((await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()).results, before.results);
});
