import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { compileSqliteExpressionDepth } from "./helpers/selected-output-share-d1-limits.mjs";

// Execute the actual closed pure SQL builder and its native column lists. This
// AST seam does not rewrite the builder or load any retention/provider runtime.
const source = readFileSync(new URL("../worker/memory-live-store.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("memory-live-store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["structuredHeadColumns", "structuredRevisionColumns", "structuredBodyColumns",
  "structuredResourceColumns", "structuredRetentionColumns", "structuredRetirementJsonRow"];
const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
const extracted = names.map(name => {
  const matches = declarations.filter(node => ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(matches.length, 1, `one actual ${name} declaration`);
  return `const ${ts.createPrinter().printNode(ts.EmitHint.Unspecified, matches[0], ast)};`;
}).join("\n");
const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const actual = new Function(`${compiled}\nreturn {${names.join(",")}};`)();

// Preserved pre-correction SQL expression: compare exact bytes, not merely
// parsed objects, so a lost NULL key or changed property order cannot pass.
const original = (alias, columns) => "json_object(" + columns.map(column =>
  `'${column}',CASE WHEN typeof(${alias}.${column})='blob' OR typeof(${alias}.${column})='text' AND length(CAST(${alias}.${column} AS BLOB))>1024 THEN NULL ELSE ${alias}.${column} END`).join(",") + ")";
const limits = { functionArguments: 32, parameters: 100, sqlBytes: 100_000 };

test("retirement head witness retains exact bytes, NULL keys, UTF-8 boundaries and SQLite value types", t => {
  const columns = actual.structuredHeadColumns;
  assert.equal(columns.length, 23);
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE heads(${columns.join(",")})`);
  const insert = db.prepare(`INSERT INTO heads VALUES(${columns.map(() => "?").join(",")})`);
  const next = actual.structuredRetirementJsonRow("head", columns);
  const previous = original("head", columns);
  const scenarios = [
    columns.map(() => null),
    columns.map((_, index) => [null, 0, -7, 1.25, "", "日本語 مرحبا", "quotes\"\\slashes\n", "é".repeat(512), "é".repeat(512) + "a", new Uint8Array([0, 127, 255])][index % 10]),
    columns.map((_, index) => index < 15 ? `field-${index}` : null),
  ];
  for (const values of scenarios) {
    db.exec("DELETE FROM heads"); insert.run(...values);
    const row = db.prepare(`SELECT ${next} AS current,${previous} AS original FROM heads head`).get();
    assert.equal(row.current, row.original);
    const decoded = JSON.parse(row.current);
    assert.deepEqual(Object.keys(decoded), columns);
    for (let index = 0; index < columns.length; index++) {
      const value = values[index];
      const expected = value instanceof Uint8Array || typeof value === "string" && Buffer.byteLength(value, "utf8") > 1024 ? null : value;
      assert.equal(decoded[columns[index]], expected, columns[index]);
    }
  }
});

test("all native retirement projections fit the strict function budget without altering shorter rows", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  for (const name of names.filter(name => name.endsWith("Columns"))) {
    const columns = actual[name];
    const ddl = `CREATE TABLE head(${columns.join(",")})`;
    const next = actual.structuredRetirementJsonRow("head", columns), previous = original("head", columns);
    if (columns.length <= 15) assert.equal(next, previous, name);
    const result = compileSqliteExpressionDepth(null, `SELECT ${next} FROM head`, { schema: [ddl], functions: [], queryLimits: limits });
    assert.equal(result.ok, true, JSON.stringify({ name, result }));
    if (name === "structuredHeadColumns") {
      const baseline = compileSqliteExpressionDepth(null, `SELECT ${previous} FROM head`, { schema: [ddl], functions: [], queryLimits: limits });
      assert.equal(baseline.ok, false);
      assert.match(baseline.error, /too many arguments on function json_object/u);
    }
  }
});
