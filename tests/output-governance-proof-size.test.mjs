import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the actual private capture class without exporting a server-internal
// constructor or replacing its SQL with a test implementation. Public helper/API
// tests separately cover rights, retained bodies and Output command behavior.
const require = createRequire(join(process.cwd(), "package.json"));
const ts = require("typescript");
const source = readFileSync(new URL("../worker/output-requirement-governance-assertions.ts", import.meta.url), "utf8");
const snippet = source.slice(source.indexOf("const MAX_PROOF_BYTES"), source.indexOf("/**\n * Bind Output decisions"));
assert.ok(snippet.includes("class GovernanceProof"), "extract the complete production class and its constants");
class OutputConflictError extends Error { constructor(code) { super(code); this.code = code; } }
const GovernanceProof = new Function("OutputConflictError", ts.transpileModule(`${snippet}\nreturn GovernanceProof;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText)(OutputConflictError);
const sizeCode = "output_source_governance_proof_too_large";
const valueLimit = 2_000_000 - 64;
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");

function fixture(t, columns = ["id", "body", "missing"]) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE inputs(${columns.map(column => `${column} ${column === "id" ? "INTEGER PRIMARY KEY" : "TEXT"}`).join(",")})`);
  const captures = [], transport = { batches: 0 };
  const env = { DB: {
    prepare(sql) { return { bind(...bindings) { return { sql, bindings }; } }; },
    async batch(statements) {
      transport.batches++;
      return statements.map(({ sql, bindings }) => {
        assert.ok(Buffer.byteLength(sql, "utf8") <= 100_000);
        assert.ok(bindings.length <= 100);
        captures.push({ sql, bindings });
        return { success: true, results: sqlite.prepare(sql).all(...bindings) };
      });
    },
  } };
  const insert = row => sqlite.prepare(`INSERT INTO inputs(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column] ?? null));
  const read = (maximum = 20, select = "SELECT * FROM inputs", bindings = [], orderBy = "id") => ({ select, orderBy, columns, bindings, maximum });
  const proof = () => new GovernanceProof(env, { deferValidation: true, maximumCaptureBatches: 2 });
  const current = assertion => sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).get(...assertion.bindings).current;
  return { sqlite, captures, transport, insert, read, proof, current };
}

const strictPython = String.raw`
import hashlib,json,sqlite3,sys
request=json.load(sys.stdin)
db=sqlite3.connect(request['database'])
db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100)
db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,2000000)
assert db.getlimit(sqlite3.SQLITE_LIMIT_LENGTH)==2000000
try:
    db.execute("SELECT json_object("+','.join(["'field'","NULL"]*17)+")")
except sqlite3.OperationalError as error:
    assert 'arguments' in str(error)
else:
    raise AssertionError('negative arity control succeeded')
try:
    db.execute('SELECT json_quote(?)', ['\x00'*400000]).fetchone()
except sqlite3.DataError as error:
    assert 'too big' in str(error)
else:
    raise AssertionError('negative unguarded escaping control succeeded')
maximum=0; sentinels=0
for statement in request['statements']:
    assert len(statement['sql'].encode('utf8'))<=100000
    assert len(statement['bindings'])<=100
    result=db.execute(statement['sql'],statement['bindings']).fetchall()
    assert len(result)==1 and len(result[0])==1
    value=result[0][0]
    if statement['kind']=='proof':
        if value is None:
            sentinels+=1
            assert statement['expected'] is None
        else:
            length=len(value.encode('utf8')); maximum=max(maximum,length)
            assert length<=2000000-64, length
            assert hashlib.sha256(value.encode('utf8')).hexdigest()==statement['expected']
    else:
        assert value==statement['expected']
print(json.dumps({'sqlite':sqlite3.sqlite_version,'statements':len(request['statements']),'maximumJsonBytes':maximum,'capacitySentinels':sentinels,'functionArgumentLimit':32,'lengthLimit':2000000}))
`;

async function strictReplay(t, fixture, assertions = []) {
  const statements = fixture.captures.map(({ sql, bindings }) => {
    const json = fixture.sqlite.prepare(sql).get(...bindings).proof_json;
    return { sql, bindings, kind: "proof", expected: json === null ? null : hash(json) };
  });
  for (const assertion of assertions) statements.push({ sql: `SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END`, bindings: assertion.bindings, kind: "assertion", expected: fixture.current(assertion) });
  const directory = mkdtempSync(join(tmpdir(), "forma-governance-size-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, "fixture.sqlite");
  await backup(fixture.sqlite, database);
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", strictPython], {
    input: JSON.stringify({ database, statements }), encoding: "utf8", maxBuffer: 1_000_000, timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const receipt = JSON.parse(result.stdout);
  t.diagnostic(JSON.stringify(receipt));
  return receipt;
}

test("SQL size guard preserves an empty complete set, order, nulls and the 32-argument JSON construction", async t => {
  const columns = ["id", ...Array.from({ length: 36 }, (_, index) => `field_${index}`)];
  const f = fixture(t, columns), empty = f.proof();
  assert.deepEqual(await empty.batch([f.read()]), [[]]);
  assert.equal(f.current(empty.assertions[0]), 1);
  const second = { id: 2 }, first = { id: 1, field_0: "two\u0000three\n界🙂", field_35: "tail" };
  f.insert(second); f.insert(first);
  const proof = f.proof(), result = await proof.batch([f.read()]);
  assert.equal(result[0][0].id, 1); assert.equal(result[0][1].id, 2);
  assert.equal(result[0][0].field_0, first.field_0);
  assert.equal(result[0][0].field_35, "tail"); assert.equal(result[0][0].field_16, null);
  assert.equal(Object.keys(result[0][0]).length, columns.length);
  assert.equal(f.current(proof.assertions[0]), 1);
  assert.equal(f.current(empty.assertions[0]), 0, "the empty-set witness rejects later members");
  await strictReplay(t, f, [...empty.assertions, ...proof.assertions]);
});

for (const [name, count, body] of [
  ["16 individually legal 140KB ASCII rows", 16, "a".repeat(140_000)],
  ["16 individually legal UTF-8 rows", 16, "界".repeat(45_000)],
  ["16 escaped quote rows", 16, '"'.repeat(70_000)],
  ["one serialized row beyond 2M after escaping", 1, '"'.repeat(1_100_000)],
  ["one NUL/control row beyond 2M after escaping", 1, "\u0000".repeat(350_000)],
]) test(`${name} returns a capacity sentinel before constructing oversized JSON`, async t => {
  const f = fixture(t);
  for (let id = 1; id <= count; id++) f.insert({ id, body });
  const proof = f.proof();
  await assert.rejects(() => proof.batch([f.read()]), error => error.code === sizeCode);
  assert.equal(f.transport.batches, 1, "sizing uses the same capture call");
  assert.equal(proof.assertions.length, 0, "no incomplete set can become a witness");
  assert.equal(f.sqlite.prepare(f.captures[0].sql).get().proof_json, null);
  assert.equal((await strictReplay(t, f)).capacitySentinels, 1);
});

test("actual SQLite accepts the exact safe JSON boundary and refuses one byte above it", async t => {
  const f = fixture(t), baseline = Buffer.byteLength(JSON.stringify([{ id: 1, body: "", missing: null }]), "utf8");
  f.insert({ id: 1, body: "x".repeat(valueLimit - baseline) });
  const proof = f.proof();
  const rows = await proof.batch([f.read()]);
  assert.equal(Buffer.byteLength(JSON.stringify(rows[0]), "utf8"), valueLimit);
  assert.equal(f.current(proof.assertions[0]), 1);
  assert.equal((await strictReplay(t, f, proof.assertions)).maximumJsonBytes, valueLimit);
  f.sqlite.exec("UPDATE inputs SET body=body||'x'");
  await assert.rejects(() => f.proof().batch([f.read()]), error => error.code === sizeCode);
  assert.equal(f.current(proof.assertions[0]), 0, "the saved exact-set assertion also guards expansion");
  assert.equal((await strictReplay(t, f, proof.assertions)).capacitySentinels, 2);
});

test("chunk measurement is exact at 4095–4097 byte boundaries for escaped bytes and 2/3/4-byte Unicode", async t => {
  const f = fixture(t);
  let id = 0;
  for (const char of ["é", "界", "🙂", "\u0000", "\u0001", "\b", "\t", "\n", "\f", "\r", '"', "\\"]) {
    for (const boundary of [4095, 4096, 4097]) {
      const body = "x".repeat(boundary - 1) + char + "y".repeat(4097) + char;
      f.insert({ id: ++id, body });
    }
  }
  const proof = f.proof(), rows = await proof.batch([f.read(40)]);
  assert.equal(rows[0].length, 36);
  for (const row of rows[0]) assert.equal(row.body, f.sqlite.prepare("SELECT body FROM inputs WHERE id=?").get(row.id).body);
  assert.equal(f.current(proof.assertions[0]), 1);
  await strictReplay(t, f, proof.assertions);
});

test("the remaining proof budget spans batches without changing earlier assertions", async t => {
  const f = fixture(t); f.insert({ id: 1, body: "x".repeat(1_100_000) }); f.insert({ id: 2, body: "y".repeat(1_000_000) });
  const proof = f.proof();
  await proof.batch([f.read(1, "SELECT * FROM inputs WHERE id=?", [1])]);
  assert.equal(proof.assertions.length, 1);
  await assert.rejects(() => proof.batch([f.read(1, "SELECT * FROM inputs WHERE id=?", [2])]), error => error.code === sizeCode);
  assert.equal(proof.assertions.length, 1);
  assert.equal(f.current(proof.assertions[0]), 1, "a later budget cannot rewrite a captured assertion");
  assert.equal(f.transport.batches, 2);
  await strictReplay(t, f, proof.assertions);
});

test("a late over-budget result does not retain a partial batch of witnesses", async t => {
  const f = fixture(t); f.insert({ id: 1, body: "x".repeat(1_100_000) }); f.insert({ id: 2, body: "y".repeat(1_000_000) });
  const proof = f.proof();
  await assert.rejects(() => proof.batch([f.read(1, "SELECT * FROM inputs WHERE id=?", [1]), f.read(1, "SELECT * FROM inputs WHERE id=?", [2])]), error => error.code === sizeCode);
  assert.equal(proof.assertions.length, 0);
  assert.equal(f.transport.batches, 1);
  await strictReplay(t, f);
});

test("an extra row cannot be filtered away to make a proof fit", async t => {
  const f = fixture(t); f.insert({ id: 1, body: "first" }); f.insert({ id: 2, body: "second" });
  const proof = f.proof();
  await assert.rejects(() => proof.batch([f.read(1)]), error => error.code === sizeCode);
  assert.equal(proof.assertions.length, 0); assert.equal(f.transport.batches, 1);
  await strictReplay(t, f);
});

test("ordinary mutation and growth beyond capacity reject the same transactional proof without writing", async t => {
  const f = fixture(t); f.insert({ id: 1, body: "retained original" });
  f.sqlite.exec("CREATE TABLE decisions(id INTEGER PRIMARY KEY); CREATE TABLE guards(current INTEGER CHECK(current=1))");
  const proof = f.proof(); await proof.batch([f.read()]);
  const assertion = proof.assertions[0];
  for (const body of ["changed", '"'.repeat(1_100_000)]) {
    f.sqlite.prepare("UPDATE inputs SET body=? WHERE id=1").run(body);
    assert.equal(f.current(assertion), 0);
    f.sqlite.exec("BEGIN");
    try {
      f.sqlite.exec("INSERT INTO decisions(id) VALUES(1)");
      assert.throws(() => f.sqlite.prepare(`INSERT INTO guards(current) SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END`).run(...assertion.bindings), /CHECK constraint/u);
    } finally { f.sqlite.exec("ROLLBACK"); }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM decisions").get().n, 0);
  }
  await strictReplay(t, f, proof.assertions);
});

test("genuine database errors are not converted into governance capacity", async t => {
  const f = fixture(t), proof = f.proof();
  await assert.rejects(() => proof.batch([f.read(1, "SELECT * FROM missing_table")]), error => error.code !== sizeCode && /missing_table/u.test(error.message));
  assert.equal(proof.assertions.length, 0);
});

test("a joined row assembled from separate legal values is rejected before an oversized sort record", async t => {
  const f = fixture(t); f.insert({ id: 1, body: "x".repeat(1_100_000) });
  f.sqlite.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, missing TEXT, position INTEGER)");
  f.sqlite.prepare("INSERT INTO notes VALUES(1,?,1)").run("y".repeat(1_100_000));
  const read = f.read(20, "SELECT inputs.id,inputs.body,notes.missing FROM inputs JOIN notes ON notes.id=inputs.id", [], "missing DESC,id");
  const proof = f.proof();
  await assert.rejects(() => proof.batch([read]), error => error.code === sizeCode);
  assert.equal(proof.assertions.length, 0);
  await strictReplay(t, f);
});

test("numeric capacity projection does not change the final declared source order", async t => {
  const f = fixture(t);
  f.insert({ id: 1, body: "alpha" }); f.insert({ id: 2, body: "zeta" }); f.insert({ id: 3, body: "alpha" });
  const read = f.read(10, "SELECT * FROM inputs", [], "body DESC,id DESC"), proof = f.proof();
  assert.deepEqual((await proof.batch([read]))[0].map(row => row.id), [2, 3, 1]);
  assert.equal(f.current(proof.assertions[0]), 1);
  await strictReplay(t, f, proof.assertions);
});

test("SQL, parameter and assertion capacity have the governance-only code before any database call", async t => {
  const f = fixture(t);
  const long = f.read(1, `SELECT * FROM inputs /* ${"x".repeat(100_000)} */`);
  await assert.rejects(() => f.proof().batch([long]), error => error.code === sizeCode);
  await assert.rejects(() => f.proof().batch([f.read(1, "SELECT * FROM inputs", Array(100).fill(null))]), error => error.code === sizeCode);
  const proof = f.proof(); proof.assertions.push(...Array.from({ length: 256 }, () => ({ sql: "1", bindings: [] })));
  await assert.rejects(() => proof.batch([f.read()]), error => error.code === sizeCode);
  assert.equal(f.transport.batches, 0);
});
