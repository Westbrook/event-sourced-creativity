import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compileSqliteExpressionDepth, enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

// Exercise the actual child program, including its frame reader. String.raw has
// no substitutions here; fail if that changes instead of testing a stale copy.
const helper = readFileSync(new URL("./helpers/d1-expression-depth.mjs", import.meta.url), "utf8");
const program = helper.match(/const COMPILE = String\.raw`([\s\S]*?)`;/u)?.[1];
assert.ok(program && !program.includes("${"));
const python = () => process.env.FORMA_SQLITE_PYTHON ?? "python3";
const options = input => ({ input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
const args = (input, childProgram = program, length = String(Buffer.byteLength(input, "utf8"))) => ["-I", "-S", "-B", "-c", childProgram, length];
const stages = stderr => stderr.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const notParsed = stderr => assert.doesNotMatch(stderr, /"stage": "(?:input-parsed|schema-created|before-explain)"/u);

function fixture() {
  const sqlite = new DatabaseSync(":memory:"); let calls = 0;
  sqlite.function("確認_é", { deterministic: true }, value => { calls++; return value; });
  sqlite.exec('CREATE TABLE "資料"(value TEXT); CREATE INDEX "順序" ON "資料"(value);');
  sqlite.exec("CREATE TRIGGER never_execute_transport_probe BEFORE INSERT ON \"資料\" BEGIN SELECT RAISE(ABORT,'target_statement_executed'); END;");
  const schema = sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all().map(row => row.sql);
  const functions = sqlite.prepare("PRAGMA function_list").all().filter(row => !row.builtin).map(({ name, narg, type, flags }) => ({ name, narg, type, flags }));
  const sql = 'INSERT INTO "資料"(value) VALUES("確認_é"(?)) /*' + "frame".repeat(14_000) + "*/";
  const payload = { schema, sql, limit: 100, functions, bindings: ['日本語 · العربية · é · 😀\n"quoted"'] };
  return { sqlite, payload, get calls() { return calls; } };
}
function heldFrame(input, length = String(Buffer.byteLength(input, "utf8"))) {
  const child = spawn(python(), args(input, program, length), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", ended = false;
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
  child.stdin.on("error", () => {}); // A rejected frame can close before the writer.
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { ended = true; resolve({ code, signal, stdout, stderr }); });
  });
  // A deterministic regression must finish quickly without changing the real
  // synchronous compiler's unchanged 30-second timeout.
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  result.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
  return { child, result, get ended() { return ended; }, get stderr() { return stderr; },
    write(value) { return new Promise((resolve, reject) => child.stdin.write(value, error => error ? reject(error) : resolve())); } };
}
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

test("d1 transport: UTF-8 schema, functions and binding values survive exactly; EXPLAIN never executes the target", () => {
  const state = fixture(), input = JSON.stringify(state.payload);
  try {
    assert.ok(Buffer.byteLength(input) > 65_536);
    const identity = program.replace('milestone("input-parsed")', 'milestone("input-parsed")\nprint(json.dumps(data))\nsys.exit(0)');
    assert.notEqual(identity, program);
    const roundTrip = spawnSync(python(), args(input, identity), options(input));
    assert.equal(roundTrip.status, 0, roundTrip.stderr);
    assert.deepEqual(JSON.parse(roundTrip.stdout), state.payload);
    const result = compileSqliteExpressionDepth(state.sqlite, state.payload.sql, { bindings: state.payload.bindings });
    assert.equal(result.ok, true); assert.equal(result.limit, 100);
    assert.equal(state.calls, 0); assert.equal(state.sqlite.prepare('SELECT COUNT(*) AS n FROM "資料"').get().n, 0);
  } finally { state.sqlite.close(); }
});

test("d1 transport: a complete frame compiles while its stdin writer deliberately keeps EOF open", async () => {
  const state = fixture(), input = JSON.stringify(state.payload), run = heldFrame(input);
  try {
    await run.write(input);
    const result = await run.result;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(run.child.stdin.writableEnded, false, "The parent never ended stdin.");
    assert.equal(JSON.parse(result.stdout).ok, true);
    const read = stages(result.stderr).find(item => item.stage === "input-read-complete");
    assert.equal(read.expectedBytes, Buffer.byteLength(input)); assert.equal(read.receivedBytes, Buffer.byteLength(input));
    assert.ok(stages(result.stderr).some(item => item.stage === "after-explain"));
  } finally { run.child.stdin.destroy(); run.child.kill(); state.sqlite.close(); }
});

test("d1 transport: a missing byte waits without compiling, then compiles only when that exact byte arrives", async () => {
  const state = fixture(), input = JSON.stringify(state.payload), run = heldFrame(input);
  try {
    await run.write(input.slice(0, -1)); await pause();
    assert.equal(run.ended, false); notParsed(run.stderr);
    await run.write(input.slice(-1));
    const result = await run.result;
    assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(run.child.stdin.writableEnded, false);
  } finally { run.child.stdin.destroy(); run.child.kill(); state.sqlite.close(); }
});

test("d1 transport: an EOF-short frame rejects before parsing or SQL preparation", async () => {
  const state = fixture(), input = JSON.stringify(state.payload), run = heldFrame(input);
  try {
    await run.write(input.slice(0, -1)); await pause();
    assert.equal(run.ended, false); notParsed(run.stderr);
    run.child.stdin.end();
    const result = await run.result;
    assert.notEqual(result.code, 0); assert.match(result.stderr, /input frame is truncated/u); notParsed(result.stderr);
    const read = stages(result.stderr).find(item => item.stage === "input-read-complete");
    assert.equal(read.receivedBytes, Buffer.byteLength(input) - 1);
  } finally { run.child.stdin.destroy(); run.child.kill(); state.sqlite.close(); }
});

test("d1 transport: malformed JSON and invalid finite decimal lengths cannot reach SQL preparation", () => {
  const state = fixture(), input = JSON.stringify(state.payload);
  try {
    for (const length of ["0", "-1", "01", "1e5", "1.1", "NaN", "Infinity", "9223372036854775808"]) {
      const result = spawnSync(python(), args(input, program, length), options(input));
      assert.notEqual(result.status, 0, length); notParsed(result.stderr);
    }
    const malformed = "!" + input.slice(1);
    const result = spawnSync(python(), args(malformed), options(malformed));
    assert.notEqual(result.status, 0); notParsed(result.stderr);
  } finally { state.sqlite.close(); }
});

test("d1 transport: native depth-100 rejection still happens before fixture preparation", () => {
  const sqlite = new DatabaseSync(":memory:"), sql = "SELECT " + Array(125).fill("1").join(" AND ") + " AS permitted";
  let prepared = 0;
  const state = { sqlite, env: { DB: { prepare() { prepared++; } } } }, depth = enforceD1ExpressionDepth(state);
  try {
    assert.equal(sqlite.prepare(sql).get().permitted, 1);
    assert.equal(compileSqliteExpressionDepth(sqlite, sql, { limit: 1000 }).ok, true);
    assert.throws(() => state.env.DB.prepare(sql), /maximum depth 100/u);
    assert.equal(prepared, 0); assert.equal(depth.failures.length, 1); assert.throws(() => depth.assertVerified());
  } finally { depth.restore(); sqlite.close(); }
});

test("d1 transport: compiler exceptions remain recorded and uncached; only completed byte-identical proofs are reused", () => {
  const sqlite = new DatabaseSync(":memory:"), sql = "SELECT 8719 AS exact_transport_cache";
  let prepared = 0;
  const state = { sqlite, env: { DB: { prepare() { prepared++; return {}; } } } }, depth = enforceD1ExpressionDepth(state);
  const previous = process.env.FORMA_SQLITE_PYTHON, originalError = console.error, diagnostics = [];
  const restorePython = () => { if (previous === undefined) delete process.env.FORMA_SQLITE_PYTHON; else process.env.FORMA_SQLITE_PYTHON = previous; };
  console.error = value => diagnostics.push(value);
  try {
    process.env.FORMA_SQLITE_PYTHON = "/__forma_missing_d1_compiler_transport_probe__";
    assert.throws(() => state.env.DB.prepare(sql));
    assert.equal(prepared, 0); assert.equal(depth.records.length, 0); assert.equal(depth.failures.length, 1);
    assert.equal(depth.failures[0].kind, "compiler-exception"); assert.throws(() => depth.assertVerified());
    assert.equal(diagnostics.length, 1); assert.match(diagnostics[0], /ENOENT/u);
    restorePython(); state.env.DB.prepare(sql);
    assert.equal(prepared, 1); assert.equal(depth.records.length, 1);
    process.env.FORMA_SQLITE_PYTHON = "/__forma_missing_d1_compiler_transport_probe__";
    state.env.DB.prepare(sql); assert.equal(prepared, 2, "A completed exact proof is cached.");
    sqlite.exec("CREATE TABLE changed_transport_schema(value TEXT)");
    assert.throws(() => state.env.DB.prepare(sql)); assert.equal(prepared, 2);
    restorePython(); state.env.DB.prepare(sql);
    process.env.FORMA_SQLITE_PYTHON = "/__forma_missing_d1_compiler_transport_probe__";
    sqlite.function("changed_transport_function", value => value);
    assert.throws(() => state.env.DB.prepare(sql)); assert.equal(prepared, 3);
  } finally { console.error = originalError; restorePython(); depth.restore(); sqlite.close(); }
});
