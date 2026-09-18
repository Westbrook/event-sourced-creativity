import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { compileSqliteExpressionDepth, enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { database, captureOutputGovernanceAssertions, synchronizeProjectScope, org, targetOwner } from "./output-governance-budget-fixture.mjs";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const productionSource = readFileSync(new URL("../worker/output-requirement-governance-assertions.ts", import.meta.url), "utf8");
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const sizeCode = "output_source_governance_proof_too_large";
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("native_governance_network_disabled"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

// Reuse the real fixture declarations without registering the existing suites
// twice. In particular, no disk-backed SQLite backup helper is called here.
async function fixtureDeclarations(file, exports, constants = {}) {
  const url = new URL(file, import.meta.url);
  const raw = readFileSync(url, "utf8");
  const parsed = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = parsed.statements.flatMap(node => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
      const name = node.declarationList.declarations[0].name.getText(parsed);
      if (Object.hasOwn(constants, name)) return ["const " + name + "=" + JSON.stringify(constants[name]) + ";"];
    }
    if (ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
      || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "deregister")
      return [node.getText(parsed)];
    return [];
  }).join("\n") + "\nexport { " + exports.join(",") + " };";
  url.search = "?native-governance-depth-fixture";
  const hooks = registerHooks({ load(request, context, nextLoad) {
    if (request === url.href) return { format: "module", source, shortCircuit: true };
    return nextLoad(request, context);
  } });
  try { return await import(url.href); } finally { hooks.deregister(); }
}

const tail = await fixtureDeclarations("./output-governance-owner-tail.test.mjs",
  ["sameOwner", "outputTail", "appendTarget", "synchronizeTarget", "capture", "check", "cursor", "nativeFixture", "storedPrivate", "replacePrivate"]);
const sizes = await fixtureDeclarations("./output-governance-proof-size.test.mjs", ["fixture", "strictPython", "valueLimit"], { source: productionSource });
const personal = await fixtureDeclarations("./output-requirements-api.test.mjs", ["fixture", "imageSpec"]);
const shared = await fixtureDeclarations("./output-requirements-project-read.test.mjs", ["fixture", "governedFixture"]);

// The accepted compiler runs before prepare; the second check supplies the
// original bindings before a real capture/final transaction can execute. Keep
// failures outside the route so a worker catch cannot turn a depth error green.
function strictFixture(t, state) {
  state = { ...state, env: state.env ?? state.proof().env };
  const guard = enforceD1ExpressionDepth(state), failures = [], checked = [];
  const batch = state.env.DB.batch;
  state.env.DB.batch = async function (statements) {
    for (const statement of statements) {
      const bindings = statement.bindings ?? statement.args ?? [];
      const compiled = compileSqliteExpressionDepth(state.sqlite, statement.sql, { bindings });
      checked.push({ sql: statement.sql, bindings: [...bindings], ...compiled });
      if (!compiled.ok) failures.push(compiled);
      assert.equal(compiled.ok, true, compiled.error);
    }
    return batch.call(this, statements);
  };
  t.after(() => {
    state.env.DB.batch = batch;
    guard.restore();
    guard.assertVerified();
    assert.deepEqual(failures, []);
    assert.ok(checked.length > 0);
    assert.ok(checked.every(row => row.limit === 100 && row.ok && row.bindings.length <= 100 && Buffer.byteLength(row.sql, "utf8") <= 100_000));
  });
  return { guard, checked };
}

function fixtureSnapshot(sqlite) {
  const schema = sqlite.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all();
  const tables = schema.filter(row => row.type === "table").map(row => {
    assert.match(row.name, /^[a-zA-Z0-9_]+$/u);
    const columns = sqlite.prepare("PRAGMA table_xinfo(" + row.name + ")").all().filter(column => column.hidden === 0).map(column => column.name);
    const rows = sqlite.prepare("SELECT " + columns.map(column => '"' + column + '"').join(",") + " FROM " + row.name).all();
    return { name: row.name, columns, rows: rows.map(row => columns.map(column => row[column])) };
  });
  return { schema, tables };
}

// Execute the existing size suite's native assertions, with its same actual
// schema and rows restored only in memory. No backup, file, fake SQL or raised
// limit; framing also detects incomplete large UTF-8 fixture transport.
function nativeReplay(t, state, captures, assertions = []) {
  const statements = captures.map(({ sql, bindings }) => {
    const result = state.sqlite.prepare(sql).get(...bindings);
    return Object.hasOwn(result, "proof_json")
      ? { sql, bindings, kind: "proof", expected: result.proof_json === null ? null : hash(result.proof_json) }
      : { sql, bindings, kind: "assertion", expected: result.proof_current };
  });
  for (const assertion of assertions) {
    const sql = "SELECT CASE WHEN (" + assertion.sql + ") THEN 1 ELSE 0 END";
    const row = state.sqlite.prepare(sql).get(...(assertion.bindings ?? []));
    statements.push({ sql, bindings: assertion.bindings ?? [], kind: "assertion", expected: Object.values(row)[0] });
  }
  const originalStart = "request=json.load(sys.stdin)\ndb=sqlite3.connect(request['database'])";
  assert.ok(sizes.strictPython.includes(originalStart));
  const startup = [
    "expected=int(sys.argv[1]); frame=sys.stdin.buffer.read(expected)",
    "assert len(frame)==expected, 'truncated native fixture frame'",
    "request=json.loads(frame)",
    "db=sqlite3.connect(':memory:',cached_statements=0)",
    "for row in request['schema']:",
    "    if row['type']=='table': db.execute(row['sql'])",
    "for table in request['tables']:",
    "    columns=','.join('\"'+column+'\"' for column in table['columns'])",
    "    parameters=','.join('?' for column in table['columns'])",
    "    db.executemany('INSERT INTO '+table['name']+'('+columns+') VALUES('+parameters+')',table['rows'])",
    "for row in request['schema']:",
    "    if row['type']!='table': db.execute(row['sql'])",
    "db.commit()",
    "db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)",
    "assert db.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH)==100",
    "try:",
    "    db.execute('EXPLAIN SELECT '+' AND '.join(['1']*120)).fetchall()",
    "except sqlite3.OperationalError as error:",
    "    assert 'Expression tree is too large' in str(error)",
    "else: raise AssertionError('over-depth negative control succeeded')",
  ].join("\n");
  const script = sizes.strictPython.replace(originalStart, startup)
    .replace("result=db.execute(statement['sql'],statement['bindings']).fetchall()", "db.execute('EXPLAIN '+statement['sql'],statement['bindings']).fetchall()\n    result=db.execute(statement['sql'],statement['bindings']).fetchall()");
  const input = JSON.stringify({ ...fixtureSnapshot(state.sqlite), statements });
  const replay = spawnSync(process.env.FORMA_SQLITE_PYTHON ?? "python3", ["-I", "-S", "-B", "-c", script, String(Buffer.byteLength(input, "utf8"))],
    { input, encoding: "utf8", maxBuffer: 1_000_000, timeout: 30_000 });
  assert.equal(replay.status, 0, replay.stderr || String(replay.error));
  const receipt = JSON.parse(replay.stdout);
  assert.equal(receipt.functionArgumentLimit, 32);
  assert.equal(receipt.lengthLimit, 2_000_000);
  t.diagnostic(JSON.stringify({ ...receipt, expressionDepthLimit: 100 }));
  return receipt;
}

test("the native compiler rejects an over-depth SQL control before execution", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    assert.equal(compileSqliteExpressionDepth(sqlite, "SELECT " + Array(120).fill("1").join(" AND ")).ok, false);
    assert.equal(compileSqliteExpressionDepth(sqlite, "SELECT ?", { bindings: ["界\u0000🙂"] }).ok, true);
  } finally { sqlite.close(); }
});

for (const licensed of [false, true]) test("capture and final " + (licensed ? "licensed" : "institutional") + " proofs execute within every D1 SQL limit", async t => {
  const f = await database({ licensed }); t.after(() => f.sqlite.close());
  const strict = strictFixture(t, f);
  const before = f.transport.d1;
  const assertions = await captureOutputGovernanceAssertions(f.env, org, [f.block], { deferValidation: true, maximumCaptureBatches: 2 });
  assert.equal(f.transport.d1 - before, licensed ? 2 : 1, "no additional capture network batch");
  const captures = f.statements.filter(row => / AS proof_(?:json|current)$/u.test(row.sql));
  assert.equal(captures.filter(row => row.sql.endsWith(" AS proof_current")).length, licensed ? 1 : 0);
  assert.equal(await tail.check(f, assertions), true);
  const pairedRows = assertions.filter(row => row.sql.endsWith("=?") && row.sql.includes("proof_source"));
  for (const row of pairedRows) {
    const current = f.sqlite.prepare("SELECT " + row.sql.slice(0, -2) + " AS proof_json").get(...row.bindings.slice(0, -1)).proof_json;
    assert.equal(current, row.bindings.at(-1), "identical complete ordered bytes in capture and final proof");
  }
  assert.ok(strict.checked.some(row => row.sql.includes(" AS current")));
  nativeReplay(t, f, captures, assertions);
});

for (const kind of ["personal", "shared", "institutional", "licensed"]) test("actual " + kind + " Output HTTP confirmation keeps strict-depth governance", async t => {
  const f = kind === "personal" ? await personal.fixture() : kind === "shared" ? await shared.fixture() : await shared.governedFixture({ licensed: kind === "licensed" });
  t.after(() => f.sqlite.close());
  strictFixture(t, f);
  if (kind === "personal") {
    const spec = personal.imageSpec();
    await f.command({ action: "save", blockId: spec.id, spec });
  }
  const response = await f.command({ action: "confirm" });
  assert.ok(response.snapshot.confirmedPlan);
  assert.deepEqual(response.snapshot.sourceProblems ?? [], []);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0);
});

test("the resource predicate remains mandatory when the exact metadata row has not changed", async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  await tail.outputTail(f);
  strictFixture(t, f);
  const assertions = await tail.capture(f), companion = assertions.find(row => row.sql.includes("tail_resources"));
  const metadata = assertions.find(row => row.sql.includes("origin_project_access_id") && row.sql.endsWith("=?"));
  assert.ok(companion && metadata);
  assert.equal(companion.bindings[0], metadata.bindings[0], "same pinned complete owner head and cursor");
  const unchanged = () => f.sqlite.prepare("SELECT CASE WHEN (" + metadata.sql + ") THEN 1 ELSE 0 END AS current").get(...metadata.bindings).current;
  assert.equal(await tail.check(f, assertions), true);
  f.sqlite.exec("UPDATE project_resource_scopes SET visibility='actor_private' WHERE project_access_id='target-access' AND resource_kind='block' AND resource_id='new-output'");
  assert.equal(unchanged(), 1, "the decomposed row proof does not masquerade as current resource authority");
  assert.equal(await tail.check(f, [companion]), false);
  assert.equal(await tail.check(f, assertions), false);
  await assert.rejects(() => tail.capture(f), { code: "output_source_projection_stale" });
});

for (const mutation of [
  "UPDATE project_resource_scopes SET visibility='actor_private' WHERE project_access_id='target-access' AND resource_id='new-output'",
  "UPDATE project_resource_scopes SET owner_user_id='foreign-owner' WHERE project_access_id='target-access' AND resource_id='new-output'",
  "DELETE FROM project_resource_scopes WHERE project_access_id='target-access' AND resource_id='new-output'",
  "UPDATE project_migration_states SET status='disabled' WHERE project_access_id='target-access'",
  "UPDATE organization_memberships SET status='revoked',revoked_at='2000-01-01T00:00:00.000Z' WHERE user_id='document-owner'",
]) test("a current tail authority change rolls back the actual final decision: " + mutation.split(" ")[0] + "/" + hash(mutation).slice(0, 8), async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  await tail.outputTail(f);
  strictFixture(t, f);
  const assertions = await tail.capture(f);
  const priorEvents = f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const priorBodies = f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n;
  const name = f.sqlite.prepare("SELECT name FROM organizations WHERE organization_id=?").get(org).name;
  await assert.rejects(() => f.decisions(assertions, [
    f.env.DB.prepare("UPDATE organizations SET name='must roll back' WHERE organization_id=?").bind(org),
    f.env.DB.prepare(mutation).bind(),
  ]), /CHECK constraint/u);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, priorEvents);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n, priorBodies);
  assert.equal(f.sqlite.prepare("SELECT name FROM organizations WHERE organization_id=?").get(org).name, name);
  assert.equal(await tail.check(f, assertions), true, "transaction rollback restores the original current proof");
});

test("a normal source cursor advance preserves the pinned tail, but later body erasure still rejects it", async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  const event = await tail.outputTail(f);
  strictFixture(t, f);
  const assertions = await tail.capture(f), previousCursor = tail.cursor(f);
  await synchronizeProjectScope(f.env, { organizationId: org, projectAccessId: "source-access", projectId: "source-project", ownerUserId: targetOwner });
  assert.ok(tail.cursor(f) > previousCursor);
  assert.equal(await tail.check(f, assertions), true);
  f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
  assert.equal(await tail.check(f, assertions), false);
});

test("a native queue keeps exact original custody while terminal job status may legitimately change", async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  const native = await tail.nativeFixture(f); native.append();
  strictFixture(t, f);
  const assertions = await tail.capture(f);
  f.sqlite.exec("UPDATE document_jobs SET status='completed'; UPDATE output_operation_slots SET status='succeeded'; UPDATE output_execution_grants SET status='completed'");
  assert.equal(await tail.check(f, assertions), true);
  f.sqlite.exec("UPDATE document_jobs SET requested_sequence=requested_sequence+1");
  assert.equal(await tail.check(f, assertions), false);
});

for (const raw of ['{"project_id":', '{"project_id":"target-project","project_id":"foreign","document_id":"target-document","block_id":"new-output"}',
  '{"project_id":"target-project","document_id":"target-document","block_id":"new-output\\u0000foreign"}']) test("malformed, duplicate and NUL identities remain unavailable: " + hash(raw).slice(0, 8), async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  const event = await tail.outputTail(f);
  strictFixture(t, f);
  const assertions = await tail.capture(f);
  tail.replacePrivate(f, event, raw);
  assert.equal(await tail.check(f, assertions), false);
  await assert.rejects(() => tail.capture(f));
});


for (const erase of [false, true]) test("removed-reference custody executes its complete retained witnesses at depth 100, erased=" + erase, async t => {
  const f = await tail.sameOwner(); t.after(() => f.sqlite.close());
  tail.appendTarget(f, "ReferenceIngested", { reference_id: "scratch-reference", content_hash: "b".repeat(64), source_ref: "/api/media/scratch.png", rights_class: "owned_or_licensed" }, { clientId: "project:" + targetOwner });
  tail.appendTarget(f, "RightsAsserted", { reference_id: "scratch-reference", rights_class: "owned_or_licensed" }, { clientId: "project:" + targetOwner });
  const created = tail.appendTarget(f, "BlockCreated", { block_id: "scratch-block", type: "reference", scope: "document", properties: { reference_id: "scratch-reference", text: "Retained scratch \u0000界🙂" } });
  await tail.synchronizeTarget(f);
  tail.appendTarget(f, "BlockRemoved", { block_id: "scratch-block" });
  await tail.synchronizeTarget(f);
  strictFixture(t, f);
  const assertions = await tail.capture(f);
  assert.equal(await tail.check(f, assertions), true);
  const captures = f.statements.filter(row => / AS proof_(?:json|current)$/u.test(row.sql));
  if (erase) {
    f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(created.eventId);
    assert.equal(await tail.check(f, assertions), false);
    await assert.rejects(() => tail.capture(f), { code: "output_source_projection_stale" });
  }
  nativeReplay(t, f, captures, assertions);
});

test("the database deadline assertion stays mandatory in the same final decision", async t => {
  const deadline = new Date(Date.now() + 3_600_000).toISOString();
  const f = await database({ expiresAt: deadline }); t.after(() => f.sqlite.close());
  strictFixture(t, f);
  const assertions = await captureOutputGovernanceAssertions(f.env, org, [f.block], { deferValidation: true, maximumCaptureBatches: 2 });
  const expiry = assertions.find(assertion => assertion.sql === "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  assert.ok(expiry);
  assert.deepEqual(expiry.bindings, [deadline]);
  assert.equal(await tail.check(f, assertions), true);
  const elapsed = assertions.map(assertion => assertion === expiry ? { ...expiry, bindings: ["2000-01-01T00:00:00.000Z"] } : assertion);
  assert.equal(await tail.check(f, elapsed), false);
  const count = f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  await assert.rejects(() => f.decisions(elapsed), /CHECK constraint/u);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, count);
});

test("wide ordered proof rows preserve nulls, embedded NULs and multibyte boundaries at depth 100", async t => {
  const columns = ["id", ...Array.from({ length: 36 }, (_, index) => "field_" + index)];
  const f = sizes.fixture(t, columns);
  strictFixture(t, f);
  const empty = f.proof(); assert.deepEqual(await empty.batch([f.read()]), [[]]);
  f.insert({ id: 2 });
  f.insert({ id: 1, field_0: "x".repeat(4095) + "界\u0000🙂", field_35: "tail" });
  const proof = f.proof(), rows = await proof.batch([f.read()]);
  assert.deepEqual(rows[0].map(row => row.id), [1, 2]);
  assert.equal(rows[0][0].field_0, "x".repeat(4095) + "界\u0000🙂");
  assert.equal(rows[0][0].field_16, null);
  assert.equal(f.current(empty.assertions[0]), 0);
  assert.equal(f.current(proof.assertions[0]), 1);
  nativeReplay(t, f, f.captures, [...empty.assertions, ...proof.assertions]);
});

for (const [name, count, body] of [
  ["raw ASCII aggregate over 2 MB", 16, "a".repeat(140_000)],
  ["multibyte aggregate over 2 MB", 16, "界".repeat(45_000)],
  ["escaped ASCII value over 2 MB", 1, '"'.repeat(1_100_000)],
  ["NUL escape value over 2 MB", 1, "\u0000".repeat(350_000)],
]) test(name + " refuses before oversized JSON materialization under native limits", async t => {
  const f = sizes.fixture(t);
  for (let id = 1; id <= count; id++) f.insert({ id, body });
  strictFixture(t, f);
  const proof = f.proof();
  await assert.rejects(() => proof.batch([f.read()]), { code: sizeCode });
  assert.equal(proof.assertions.length, 0);
  assert.equal(f.transport.batches, 1);
  assert.equal(nativeReplay(t, f, f.captures).capacitySentinels, 1);
});

test("a joined row of individually legal values refuses before any oversized sort or raw-row materialization", async t => {
  const f = sizes.fixture(t); f.insert({ id: 1, body: "x".repeat(1_100_000) });
  f.sqlite.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, missing TEXT, position INTEGER)");
  f.sqlite.prepare("INSERT INTO notes VALUES(1,?,1)").run("y".repeat(1_100_000));
  strictFixture(t, f);
  const proof = f.proof();
  await assert.rejects(() => proof.batch([f.read(20, "SELECT inputs.id,inputs.body,notes.missing FROM inputs JOIN notes ON notes.id=inputs.id", [], "missing DESC,id")]), { code: sizeCode });
  assert.equal(proof.assertions.length, 0);
  assert.equal(nativeReplay(t, f, f.captures).capacitySentinels, 1);
});

test("the exact safe JSON boundary and a later one-byte expansion share the same current proof", async t => {
  const f = sizes.fixture(t);
  const overhead = Buffer.byteLength(JSON.stringify([{ id: 1, body: "", missing: null }]), "utf8");
  f.insert({ id: 1, body: "x".repeat(sizes.valueLimit - overhead) });
  strictFixture(t, f);
  const proof = f.proof();
  await proof.batch([f.read()]);
  assert.equal(nativeReplay(t, f, f.captures, proof.assertions).maximumJsonBytes, sizes.valueLimit);
  f.sqlite.exec("UPDATE inputs SET body=body||'x'");
  assert.equal(f.current(proof.assertions[0]), 0);
  await assert.rejects(() => f.proof().batch([f.read()]), { code: sizeCode });
  assert.equal(nativeReplay(t, f, f.captures, proof.assertions).capacitySentinels, 2);
});
