import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { compileSqliteExpressionDepth } from "./selected-output-share-d1-limits.mjs";

// The strict compiler is the unmodified guest-retirement qualification helper,
// SHA-256 50782c3f194e9f51370380b388de8cea1280ca7e8c330c83d0b721c1eff154f0.
// This harness uses synthetic records only. It never rewrites production SQL.
export const SELECTED_SHARE_D1_LIMITS = Object.freeze({ functionArguments: 32, parameters: 100, sqlBytes: 100_000 });
const identifier = value => `"${value.replaceAll('"', '""')}"`;
export function syntheticSnapshot(sqlite) {
  const schema = sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all().map(row => row.sql);
  const data = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().flatMap(({ name }) => {
    const columns = sqlite.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(row => row.name);
    return sqlite.prepare(`SELECT * FROM ${identifier(name)}`).all().map(row => ({
      sql: `INSERT INTO ${identifier(name)}(${columns.map(identifier).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      bindings: columns.map(column => row[column]),
    }));
  });
  return { schema, data };
}

/** Captures actual execution including each statement inside the privacy batch.
 * The original native fixture still performs all real SQLite work and checks. */
export function captureNativeStatements(fixture) {
  const db = fixture.DB, original = db.prepare, records = [];
  let operation = "unset";
  db.prepare = function (sql) {
    function wrap(statement) {
      const execute = statement.execute, bind = statement.bind;
      statement.execute = function (mode) {
        if (/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(sql)) records.push({ operation, sql, bindings: [...this.bindings], mode });
        return execute.call(this, mode);
      };
      statement.bind = function (...bindings) { return wrap(bind.call(this, ...bindings)); };
      return statement;
    }
    return wrap(original.call(this, sql));
  };
  return { records, operation(value) { operation = value; }, restore() { db.prepare = original; } };
}

const compiled = new Map();
export function qualifyCapturedSql(snapshot, records) {
  const failures = [], statements = [];
  const schemaHash = createHash("sha256").update(JSON.stringify(snapshot.schema)).digest("hex");
  const seen = new Set();
  for (const row of records) {
    if (!/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(row.sql)) continue;
    const sqlSha256 = createHash("sha256").update(row.sql).digest("hex");
    const key = schemaHash + ":" + sqlSha256;
    assert.ok(row.bindings.length <= SELECTED_SHARE_D1_LIMITS.parameters);
    assert.ok(Buffer.byteLength(row.sql, "utf8") <= SELECTED_SHARE_D1_LIMITS.sqlBytes);
    if (seen.has(key)) continue;
    seen.add(key);
    let result = compiled.get(key);
    if (!result) {
      result = compileSqliteExpressionDepth(null, row.sql, { schema: snapshot.schema, functions: [], bindings: row.bindings,
        limit: 100, queryLimits: SELECTED_SHARE_D1_LIMITS });
      compiled.set(key, result);
    }
    const current = { operation: row.operation, sqlSha256, ...result };
    statements.push(current);
    if (!result.ok) {
      failures.push(current);
      if (process.env.FORMA_SELECTED_SHARE_D1_EVIDENCE_DIRECTORY) writeFileSync(join(process.env.FORMA_SELECTED_SHARE_D1_EVIDENCE_DIRECTORY, sqlSha256 + ".json"),
        JSON.stringify({ ...current, sql: row.sql, bindings: row.bindings, schema: snapshot.schema }, null, 2));
    }
  }
  return { statements, failures, maxBindings: Math.max(0, ...records.map(row => row.bindings.length)),
    maxBytes: Math.max(0, ...records.map(row => Buffer.byteLength(row.sql, "utf8"))) };
}

/** A disposable actual workerd/D1 database seeded exclusively from the synthetic
 * fixture. All outbound network is forbidden; only a local test socket opens. */
export async function localWorkerdFixture(t, snapshot) {
  const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve("wrangler"))("miniflare");
  const egress = [], records = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", host: "127.0.0.1", port: 0,
    script: "export default {fetch(){return new Response('Synthetic selected-share qualification only',{status:404});}};",
    d1Databases: ["SelectedShare"], log: new Log(LogLevel.NONE),
    outboundService(request) { egress.push(request.url); throw new Error("External requests prohibited"); },
  });
  t.after(async () => { await mf.dispose(); assert.deepEqual(egress, []); });
  const raw = await mf.getD1Database("SelectedShare");
  for (const sql of snapshot.schema) await raw.prepare(sql).run();
  if (snapshot.data.length) await raw.batch([raw.prepare("PRAGMA defer_foreign_keys=ON"),
    ...snapshot.data.map(row => raw.prepare(row.sql).bind(...row.bindings)), raw.prepare("PRAGMA defer_foreign_keys=OFF")]);
  let operation = "unset";
  const DB = {
    prepare(sql) {
      function wrap(statement, bindings = []) {
        return { sql, bindings, underlying: statement,
          bind(...values) { return wrap(statement.bind(...values), values); },
          async first(...args) { records.push({ operation, sql, bindings, mode: "first" }); return statement.first(...args); },
          async all() { records.push({ operation, sql, bindings, mode: "all" }); return statement.all(); },
          async run() { records.push({ operation, sql, bindings, mode: "run" }); return statement.run(); },
        };
      }
      return wrap(raw.prepare(sql));
    },
    async batch(statements) {
      records.push(...statements.map(row => ({ operation, sql: row.sql, bindings: row.bindings, mode: "batch" })));
      return raw.batch(statements.map(row => row.underlying));
    },
  };
  return { DB, raw, records, operation(value) { operation = value; }, egress };
}
