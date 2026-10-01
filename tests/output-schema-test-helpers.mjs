import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { outputTestDatabase } from "./output-server-test-helpers.mjs";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "../worker/output-requirements-schema.ts";

const localRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.FORMA_SOURCE_ROOT ?? localRoot;
const legacyOutputMigration = readFileSync(resolve(localRoot, "drizzle/0018_output_requirements.sql"), "utf8");
const model3dOutputMigration = readFileSync(resolve(localRoot, "drizzle/0022_output_model3d.sql"), "utf8");
const outputMigration = `${legacyOutputMigration}\n${model3dOutputMigration}`;
const priorMigrations = readdirSync(resolve(sourceRoot, "drizzle")).filter((name) => /^\d{4}_.*\.sql$/u.test(name) && Number(name.slice(0, 4)) < 18).sort();
function coldProductionDatabase() {
  assert.equal(priorMigrations.length, 18);
  const state = outputTestDatabase();
  for (const name of priorMigrations) state.sqlite.exec(readFileSync(resolve(sourceRoot, "drizzle", name), "utf8"));
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'output_%'").get().count, 0);
  return state;
}
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
function checks(sql) {
  const values = [];
  const pattern = /\bCHECK\s*\(/giu;
  for (; pattern.exec(sql);) {
    let cursor = pattern.lastIndex, start = cursor, depth = 1, quoted = false;
    while (cursor < sql.length && depth) {
      const char = sql[cursor++];
      if (char === "'") { if (quoted && sql[cursor] === "'") { cursor++; continue; } quoted = !quoted; }
      if (!quoted) { if (char === "(") depth++; if (char === ")") depth--; }
    }
    assert.equal(depth, 0);
    values.push(sql.slice(start, cursor - 1).replace(/\s+/gu, " ").trim());
    pattern.lastIndex = cursor;
  }
  return values.sort();
}
function outputSchema(sqlite) {
  const tables = sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'output_%' ORDER BY name").all();
  return tables.map((table) => ({
    name: table.name,
    columns: sqlite.prepare(`PRAGMA table_xinfo(${quote(table.name)})`).all().map((row) => ({ name: row.name, type: row.type.toUpperCase(), notnull: row.notnull, default: row.dflt_value, pk: row.pk, hidden: row.hidden })),
    foreignKeys: sqlite.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all().map((row) => ({ table: row.table, from: row.from, to: row.to, sequence: row.seq, onUpdate: row.on_update, onDelete: row.on_delete, match: row.match })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    indexes: sqlite.prepare(`PRAGMA index_list(${quote(table.name)})`).all().map((row) => ({ name: row.name, unique: row.unique, origin: row.origin, partial: row.partial,
      keys: sqlite.prepare(`PRAGMA index_xinfo(${quote(row.name)})`).all().filter((key) => key.key).map((key) => ({ name: key.name, descending: key.desc, collation: key.coll })) })).sort((a, b) => a.name.localeCompare(b.name)),
    checks: checks(table.sql),
  }));
}
function runtimeOnly(state) { for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) state.sqlite.exec(sql); }

export { coldProductionDatabase, outputSchema, outputMigration, legacyOutputMigration, model3dOutputMigration, runtimeOnly };
