import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";

// Reuses the existing Scene admission test's source-extraction/SQLite approach.
// Actual current transaction branch + actual CHECK helper. The already-prepared
// insert/resource statements are explicit minimal ports: not a full HTTP/auth test.
const jobs = await readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8");
const core = await readFile(new URL("../worker/output-command-core.ts", import.meta.url), "utf8");
const proofSource = await readFile(new URL("../worker/output-disclosure-proof.ts", import.meta.url), "utf8");
const insertion = jobs.indexOf("const inserted=documentJobInsert(env,admissionUser,documentId,");
assert.ok(insertion >= 0);
const start = jobs.indexOf("  let created=false;", insertion);
const end = jobs.indexOf("  if(!created){", start);
assert.ok(start > insertion && end > start);
const selected = jobs.slice(start, end);
assert.match(jobs.slice(insertion, start), /scenePrepared\?sceneRequestExclusion\(jobId,\{sql:"1",bindings:\[\]\}\):undefined/);
const helperStart = core.indexOf("export function outputAssertionStatements(");
const helperEnd = core.indexOf("\n/** Repeat live authority", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const makeChecks = new Function("uuidV7", `${stripTypeScriptTypes(core.slice(helperStart, helperEnd)).replace(/^export /u, "")}\nreturn outputAssertionStatements;`);
// Include the actual retained-read branch, stopping before unrelated generic fallback.
const retainedEnd = jobs.indexOf('    if(kind==="render_document"||kind==="structure_adaptive"){', end);
assert.ok(retainedEnd > end);
const retainedBranch = jobs.slice(end, retainedEnd) + "\n  }\n";
const conflictStart = jobs.indexOf("async function sceneAdmissionSourceConflict(");
const conflictEnd = jobs.indexOf("\nfunction parentJobIdFromRequest(", conflictStart);
assert.ok(conflictStart >= 0 && conflictEnd > conflictStart);
const proofStart = proofSource.indexOf("function outputProofReadStatements(");
const proofEnd = proofSource.indexOf("\nfunction assertOutputProofRead(", proofStart);
assert.ok(proofStart >= 0 && proofEnd > proofStart);
const makeProofReads = new Function("fail", stripTypeScriptTypes(proofSource.slice(proofStart, proofEnd)) + "\nreturn outputProofReadStatements;");
const createExecute = new Function("ports", `
  const {user,documentId,payload,project,sceneInspection,readExistingSceneRequest,
    retainedSceneResponse,sceneCostErrorResponse,OutputConflictError,SceneCostConsentError,outputProofReadStatements}=ports;
  ${stripTypeScriptTypes(jobs.slice(conflictStart, conflictEnd))}
  ${stripTypeScriptTypes("async function execute(env,scenePrepared,inserted,resource,outputAssertionStatements){\n" + selected + "\n" + retainedBranch + "\nreturn {created};\n}")}
  return execute;
`);

function fixture({ resource = true, scene = true, beforeBatch, afterBatch, beforeDiagnostic, diagnosticResult, retained = null, retainedError = null } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
    CREATE TABLE source(id TEXT PRIMARY KEY,body TEXT NOT NULL,redacted INTEGER NOT NULL);
    INSERT INTO source VALUES('one','原始🙂',0),('two','second',0);
    CREATE TABLE membership(id TEXT PRIMARY KEY); INSERT INTO membership VALUES('one'),('two');
    CREATE TABLE jobs(id TEXT PRIMARY KEY);
    CREATE TABLE resources(id TEXT PRIMARY KEY);`);
  let serial = 0, batches = 0, outsideWrites = 0, retainedReads = 0, diagnosticBatches = 0, writeFailure;
  const seen = [];
  const env = { DB: {
    prepare(sql) {
      return { sql, bindings: [], bind(...bindings) { return { ...this, bindings }; }, async run() {
        outsideWrites++;
        const result = db.prepare(this.sql).run(...this.bindings);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      } };
    },
    async batch(statements) {
      batches++; seen.push(statements.map(statement => ({ sql: statement.sql, bindings: [...statement.bindings] })));
      const diagnostic = statements.every(statement => /^\s*(SELECT|WITH)\b/iu.test(statement.sql));
      if (diagnostic) { diagnosticBatches++; beforeDiagnostic?.(db); }
      else beforeBatch?.(db);
      db.exec("BEGIN");
      let results;
      try {
        results = statements.map(statement => {
          const prepared = db.prepare(statement.sql);
          if (/^\s*(SELECT|WITH)\b/iu.test(statement.sql)) return { success: true, results: prepared.all(...statement.bindings), meta: { changes: 0 } };
          const result = prepared.run(...statement.bindings);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); if (!diagnostic) writeFailure = error; throw error; }
      if (diagnostic) return diagnosticResult ? diagnosticResult(results) : results;
      return afterBatch ? afterBatch(results) : results;
    },
  } };
  const assertions = [
    { sql: "EXISTS(SELECT 1 FROM source WHERE id=? AND body=? AND redacted=0)", bindings: ["one", "原始🙂"] },
    { sql: "EXISTS(SELECT 1 FROM source WHERE id=? AND body=? AND redacted=0)", bindings: ["two", "second"] },
    { sql: "(SELECT COUNT(*) FROM membership)=?", bindings: [2] },
    { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: ["2099-01-01T00:00:00.000Z"], deadlineMs: Date.parse("2099-01-01T00:00:00.000Z") },
  ];
  const prepared = scene ? { assertions, validUntil: "2099-01-01T00:00:00.000Z" } : null;
  class OutputConflictError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
  class SceneCostConsentError extends OutputConflictError {}
  const user = { userId: "owner" }, payload = { sceneRequestId: "original-request" }, sceneInspection = { fixtureOriginal: true };
  const retainedResponse = Response.json({ retainedOriginal: retained }, { status: 202 });
  // Explicit authorized-read/response ports; authorization itself is covered by root's HTTP controls.
  const execute = createExecute({
    user, documentId: "document", payload, project: null, sceneInspection,
    readExistingSceneRequest: async (actualEnv, actualUser, documentId, requestId, contextId, options) => {
      retainedReads++; assert.equal(actualEnv, env); assert.equal(actualUser, user);
      assert.equal(documentId, "document"); assert.equal(requestId, payload.sceneRequestId); assert.equal(contextId, null);
      assert.equal(options.certifyUnused, sceneInspection);
      if (retainedError) throw retainedError; return retained;
    },
    retainedSceneResponse: original => { assert.equal(original, retained); return retainedResponse; },
    sceneCostErrorResponse: error => Response.json({ error: error.code, attemptSubmission: "not-submitted" }, { status: error.status ?? 409 }),
    OutputConflictError, SceneCostConsentError,
    outputProofReadStatements: makeProofReads((code, status) => { throw new OutputConflictError(code, status); }),
  });
  const checks = makeChecks(() => `check-${++serial}`);
  const inserted = env.DB.prepare("INSERT INTO jobs(id) SELECT 'job' WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE id='job')");
  const resourceStatement = resource ? env.DB.prepare("INSERT INTO resources(id) SELECT 'job' WHERE EXISTS(SELECT 1 FROM jobs WHERE id='job')") : null;
  const invoke = () => execute(env, prepared, inserted, resourceStatement, checks);
  const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return { db, assertions, prepared, invoke, count, seen, retainedResponse, get writeFailure() { return writeFailure; }, get retainedReads() { return retainedReads; }, get diagnosticBatches() { return diagnosticBatches; }, get batches() { return batches; }, get outsideWrites() { return outsideWrites; } };
}

test("each original source assertion refuses its own no-head edit in the same transaction as direct Scene admission", async () => {
  for (const id of ["one", "two"]) {
    const f = fixture({ beforeBatch: db => db.prepare("UPDATE source SET body=? WHERE id=?").run(id === "one" ? "改变🙂" : "change", id) });
    try {
      const response = await f.invoke(); assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "output_source_changed_during_read", attemptSubmission: "not-submitted" });
      assert.equal(f.batches, 2); assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, 1); assert.equal(f.outsideWrites, 0);
      for (const table of ["jobs", "resources", "output_atomic_assertions"]) assert.equal(f.count(table), 0);
      assert.equal(f.seen[0].filter(statement => statement.sql.startsWith("INSERT INTO output_atomic_assertions")).length, 4);
      assert.deepEqual(f.assertions[0].bindings, ["one", "原始🙂"]);
    } finally { f.db.close(); }
  }
});

test("redaction, removed membership and original deadline expiry independently roll back the job and resource", async () => {
  for (const mutation of [db => db.exec("UPDATE source SET redacted=1 WHERE id='one'"), db => db.exec("DELETE FROM membership WHERE id='two'"), null]) {
    const f = fixture({ beforeBatch: mutation });
    try {
      if (!mutation) f.assertions[3] = { ...f.assertions[3], bindings: ["2000-01-01T00:00:00.000Z"], deadlineMs: Date.parse("2000-01-01T00:00:00.000Z") };
      const response = await f.invoke(); assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "output_source_changed_during_read");
      assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, 1);
      for (const table of ["jobs", "resources", "output_atomic_assertions"]) assert.equal(f.count(table), 0);
    } finally { f.db.close(); }
  }
});

test("all original proofs precede successful personal and project writes with correct result offsets", async () => {
  for (const resource of [false, true]) {
    const f = fixture({ resource });
    try {
      assert.deepEqual(await f.invoke(), { created: true });
      assert.equal(f.batches, 1); assert.equal(f.outsideWrites, 0);
      assert.equal(f.seen[0].length, resource ? 10 : 9);
      assert.match(f.seen[0][8].sql, /^INSERT INTO jobs/u);
      assert.equal(f.count("jobs"), 1); assert.equal(f.count("resources"), resource ? 1 : 0);
      assert.equal(f.count("output_atomic_assertions"), 0);
    } finally { f.db.close(); }
  }
});

test("a resource write failure rolls back the preceding job and all CHECK bookkeeping", async () => {
  const f = fixture({ beforeBatch: db => db.exec("INSERT INTO resources VALUES('job')") });
  try {
    await assert.rejects(f.invoke(), /UNIQUE constraint failed/u);
    assert.equal(f.count("jobs"), 0);
    assert.equal(f.count("resources"), 1, "the pre-existing conflicting fixture row is unchanged");
    assert.equal(f.count("output_atomic_assertions"), 0);
  } finally { f.db.close(); }
});

test("legacy non-Scene personal and project paths do not gain proof statements or change batch behavior", async () => {
  for (const resource of [false, true]) {
    const f = fixture({ resource, scene: false });
    try {
      assert.deepEqual(await f.invoke(), { created: true });
      assert.equal(f.batches, resource ? 1 : 0);
      assert.equal(f.outsideWrites, resource ? 0 : 1);
      assert.equal(f.seen.flat().filter(statement => statement.sql.includes("output_atomic_assertions")).length, 0);
    } finally { f.db.close(); }
  }
});

test("a thrown batch remains the exact error and is never retried as unguarded insertion", async () => {
  const failure = new Error("unknown transport outcome");
  const f = fixture({ beforeBatch: () => { throw failure; } });
  try {
    await assert.rejects(f.invoke(), error => error === failure);
    assert.equal(f.batches, 1); assert.equal(f.outsideWrites, 0);
    assert.equal(f.count("jobs"), 0);
  } finally { f.db.close(); }
});

test("missing write-result evidence is not reported as a created Scene or retried", async () => {
  const f = fixture({ resource: false, afterBatch: results => results.slice(0, -1) });
  try {
    assert.deepEqual(await f.invoke(), { created: false });
    assert.equal(f.batches, 1); assert.equal(f.outsideWrites, 0);
    assert.equal(f.count("jobs"), 1, "the result transport is uncertain: do not pretend the committed job is absent");
  } finally { f.db.close(); }
});

for (const fault of ["sparse-write", "missing-success", "failed-write"]) test(fault + " cannot certify a committed direct Scene job", async () => {
  let faulted = false;
  const f = fixture({ resource: false, afterBatch: results => {
    assert.equal(results.length, 9);
    assert.equal(results[8].success, true);
    assert.equal(results[8].meta.changes, 1);
    faulted = true;
    const changed = [...results];
    if (fault === "sparse-write") delete changed[8];
    else if (fault === "missing-success") { changed[8] = { ...results[8] }; delete changed[8].success; }
    else changed[8] = { ...results[8], success: false };
    return changed;
  } });
  try {
    assert.deepEqual(await f.invoke(), { created: false });
    assert.equal(faulted, true); assert.equal(f.batches, 1); assert.equal(f.outsideWrites, 0);
    assert.equal(f.count("jobs"), 1, "the actual write committed; incomplete return evidence is not absence or permission to retry");
  } finally { f.db.close(); }
});

test("an authorized retained original wins after CHECK rollback without diagnostic or insertion retry", async () => {
  const retained = { jobId: "original-job" };
  const f = fixture({ resource: false, retained, beforeBatch: db => db.exec("UPDATE source SET body='changed' WHERE id='one'") });
  try {
    f.db.exec("INSERT INTO jobs VALUES('job')");
    assert.equal(await f.invoke(), f.retainedResponse);
    assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, 0); assert.equal(f.batches, 1);
    assert.equal(f.count("jobs"), 1); assert.equal(f.outsideWrites, 0);
  } finally { f.db.close(); }
});

const diagnosticFaults = [
  ["failed result", rows => { rows[0].success = false; return rows; }],
  ["missing success", rows => { delete rows[0].success; return rows; }],
  ["sparse result", rows => { delete rows[0]; return rows; }],
  ["missing result", rows => rows.slice(1)],
  ["non-array", () => null],
  ["extra row", rows => { rows[0].results.push({ current: 0 }); return rows; }],
  ["coercible truth", rows => { rows[0].results[0].current = "0"; return rows; }],
];
for (const [name, diagnosticResult] of diagnosticFaults) test(name + " diagnostic preserves the original CHECK failure identity", async () => {
  const f = fixture({ beforeBatch: db => db.exec("UPDATE source SET body='changed' WHERE id='one'"), diagnosticResult });
  try {
    await assert.rejects(f.invoke(), error => error === f.writeFailure);
    assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, 1); assert.equal(f.batches, 2);
    assert.equal(f.count("jobs"), 0); assert.equal(f.count("resources"), 0);
  } finally { f.db.close(); }
});

for (const mode of ["unknown diagnostic", "still-current diagnostic", "unknown retained read"]) test(mode + " never substitutes a new failure or safe refusal", async () => {
  const unknown = new Error("unknown recovery read failure");
  const f = fixture({
    beforeBatch: db => db.exec("UPDATE source SET body='changed' WHERE id='one'"),
    beforeDiagnostic: mode === "unknown diagnostic" ? () => { throw unknown; }
      : mode === "still-current diagnostic" ? db => db.prepare("UPDATE source SET body=? WHERE id='one'").run("原始🙂") : undefined,
    retainedError: mode === "unknown retained read" ? unknown : null,
  });
  try {
    await assert.rejects(f.invoke(), error => error === f.writeFailure && error !== unknown);
    assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, mode === "unknown retained read" ? 0 : 1);
  } finally { f.db.close(); }
});

for (const message of [
  "remote failure CHECK constraint failed: passed=1",
  "unknown prefix: CHECK constraint failed: output_atomic_assertions",
  "CHECK constraint failed: passed=1; unrelated transport failure",
  "D1_ERROR: CHECK constraint failed: passed=1 : SQLITE_CONSTRAINT_CHECK extra",
]) test("unknown CHECK-like error is preserved before retained lookup: " + message, async () => {
  const failure = new Error(message), f = fixture({ beforeBatch: () => { throw failure; } });
  try {
    await assert.rejects(f.invoke(), error => error === failure);
    assert.equal(f.retainedReads, 0); assert.equal(f.diagnosticBatches, 0); assert.equal(f.batches, 1);
  } finally { f.db.close(); }
});

test("empty original assertions cannot turn a CHECK failure into safe source-conflict evidence", async () => {
  const failure = new Error("CHECK constraint failed: passed=1");
  const f = fixture({ resource: false, beforeBatch: () => { throw failure; } });
  try {
    f.assertions.length = 0;
    await assert.rejects(f.invoke(), error => error === failure);
    assert.equal(f.retainedReads, 1); assert.equal(f.diagnosticBatches, 0); assert.equal(f.batches, 1);
  } finally { f.db.close(); }
});
