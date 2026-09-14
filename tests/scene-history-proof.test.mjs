import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// New isolated helper only. No old fixture, source suite, provider or app server.
// This is test SOURCE supplied for root execution; no execution is claimed by its author.
const source = await readFile(new URL("../worker/scene-history-proof.ts", import.meta.url), "utf8");
const javascript = stripTypeScriptTypes(source, { mode: "transform" });
const { captureSceneHistoryProof, SCENE_HISTORY_PROOF_LIMITS } = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));
const stream = "creative:owner";
const project = { projectAccessId: "access", organizationId: "org", projectId: "project", ownerUserId: "owner" };

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,payload TEXT,
    type TEXT NOT NULL DEFAULT 'FixtureEvent',occurred_at TEXT NOT NULL DEFAULT '2026-09-13T00:00:00Z',
    recorded_at TEXT NOT NULL DEFAULT '2026-09-13T00:00:00Z',actor TEXT NOT NULL DEFAULT 'user:owner',
    client_id TEXT NOT NULL DEFAULT 'fixture',correlation_id TEXT NOT NULL DEFAULT 'fixture-correlation',
    causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE project_event_scopes(event_id TEXT NOT NULL,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,
      project_sequence INTEGER,source_stream_id TEXT,source_sequence INTEGER,actor_user_id TEXT,created_at TEXT);
    CREATE TABLE guarded_jobs(job_id TEXT PRIMARY KEY);
    CREATE TABLE assertions(token TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));`);
  const add = (id, sequence, value = "{}", options = {}) => {
    db.prepare("INSERT INTO events(event_id,stream_id,sequence,payload) VALUES(?,?,?,?)").run(id, stream, sequence, options.publicValue ?? "{}");
    if (!options.missing) db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,?)").run(id, "owner", "project", "scene", value, options.redacted ?? null);
    if (options.project) db.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, "access", "org", "project", "owner", options.order ?? sequence, stream, sequence, "owner", "2026-09-13T00:00:00Z");
  };
  let reads = 0, verifications = 0;
  const checked = [];
  const verify = (assertions) => {
    db.exec("BEGIN");
    try {
      for (const assertion of assertions) {
        const result = db.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).get(...(assertion.bindings ?? []));
        assert.equal(result.current, 1, "original full proof must remain true");
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const port = {
    async read(sql, bindings) { reads++; checked.push({ sql, bindings }); return db.prepare(sql).all(...bindings); },
    async verify(assertions) { verifications++; verify(assertions); },
  };
  const capture = (options = {}, limits) => captureSceneHistoryProof(port, {
    streamId: stream, expectedOwnerHead: db.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events").get().head, ...options,
  }, limits);
  return { db, add, port, capture, verify, checked, get reads() { return reads; }, get verifications() { return verifications; } };
}

test("small Scene with more than 2 MB complete historical bodies uses bounded exact proof pieces", async () => {
  const f = fixture();
  try {
    f.add("scene", 1, JSON.stringify({ title: "Two people in one room", direction: "A short exchange." }));
    for (let index = 0; index < 33; index++) f.add(`history-${index}`, index + 2, JSON.stringify({ earlier: "x".repeat(65536) }));
    const proof = await f.capture();
    assert.equal(proof.rows, 34); assert.ok(proof.rawBytes > 2_000_000); assert.ok(proof.assertions.length > 1);
    assert.equal(f.verifications, 1); f.verify(proof.assertions);
    for (const statement of [...f.checked, ...proof.assertions]) {
      assert.ok(!statement.sql.includes("json_group_array"));
      assert.ok(Buffer.byteLength(statement.sql) < 100_000);
      assert.ok((statement.bindings ?? []).length < 100);
      for (const value of statement.bindings ?? []) if (typeof value === "string") assert.ok(Buffer.byteLength(value) <= 128 * 1024);
    }
    assert.ok(Object.isFrozen(proof.assertions)); assert.ok(Object.isFrozen(proof.assertions[0].bindings));
  } finally { f.db.close(); }
});

test("NUL, Unicode byte-boundary splits, missing/NULL/redacted and empty TEXT/BLOB remain distinct", async () => {
  const f = fixture();
  try {
    const text = "x".repeat(8191) + "🙂é\u0000e\u0301";
    f.add("unicode", 1, text); f.add("missing", 2, null, { missing: true }); f.add("null", 3, null);
    f.add("empty", 4, ""); f.add("blob", 5, Buffer.alloc(0)); f.add("redacted", 6, "retained", { redacted: "2026-09-12T00:00:00Z" });
    const proof = await f.capture(); f.verify(proof.assertions);
    f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='unicode'").run(text.replace("🙂", "🙃"));
    assert.throws(() => f.verify(proof.assertions));
    f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='unicode'").run(text);
    f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='blob'").run("");
    assert.throws(() => f.verify(proof.assertions));
    f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='blob'").run(Buffer.alloc(0));
    f.db.prepare("INSERT INTO event_private_payloads VALUES('missing','owner','project','scene',NULL,NULL)").run();
    assert.throws(() => f.verify(proof.assertions));
  } finally { f.db.close(); }
});

test("no-head private edit, public edit, redaction and private custody change all invalidate the original proof", async () => {
  const f = fixture();
  try {
    f.add("row", 1, '{"v":1}'); const proof = await f.capture();
    const mutations = [
      ["UPDATE event_private_payloads SET private_json='{\"v\":2}'", "UPDATE event_private_payloads SET private_json='{\"v\":1}'"],
      ["UPDATE events SET payload='{\"v\":2}'", "UPDATE events SET payload='{}'"],
      ["UPDATE event_private_payloads SET redacted_at='2026-09-13T00:00:00Z'", "UPDATE event_private_payloads SET redacted_at=NULL"],
      ["UPDATE event_private_payloads SET owner_id='other'", "UPDATE event_private_payloads SET owner_id='owner'"],
    ];
    for (const [change, restore] of mutations) { f.db.exec(change); assert.throws(() => f.verify(proof.assertions)); f.db.exec(restore); f.verify(proof.assertions); }
    assert.equal(f.db.prepare("SELECT MAX(sequence) AS head FROM events").get().head, 1);
  } finally { f.db.close(); }
});

test("all serialized event metadata remains bound even when payloads and the stream head are unchanged", async () => {
  const f = fixture();
  try {
    f.add('row',1,'{"value":"unchanged"}');
    const original=f.db.prepare('SELECT * FROM events WHERE event_id=?').get('row'), proof=await f.capture();
    for(const [field,value] of [
      ['type','DifferentEvent'],['actor','user:other'],['client_id','other-client'],['correlation_id','other-correlation'],
      ['occurred_at','2026-09-12T00:00:00Z'],['recorded_at','2026-09-12T00:00:00Z'],
      ['causation_id','other-event'],['compensates_event_id','other-event'],['schema_version',2],
    ]) {
      f.db.prepare(`UPDATE events SET ${field}=? WHERE event_id=?`).run(value,'row');
      assert.throws(()=>f.verify(proof.assertions),field);
      assert.equal(f.db.prepare('SELECT MAX(sequence) AS head FROM events').get().head,1);
      assert.equal(f.db.prepare('SELECT payload FROM events WHERE event_id=?').get('row').payload,original.payload);
      assert.equal(f.db.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get('row').private_json,'{"value":"unchanged"}');
      f.db.prepare(`UPDATE events SET ${field}=? WHERE event_id=?`).run(original[field],'row');
      f.verify(proof.assertions);
    }
  } finally { f.db.close(); }
});

test("complete membership catches deletion, same-count replacement, reassignment and reordering", async () => {
  const f = fixture();
  try {
    f.add("a", 1, "a", { project: true }); f.add("b", 2, "b", { project: true }); f.add("outside", 3, "c");
    const proof = await f.capture({ project });
    f.db.exec("UPDATE project_event_scopes SET event_id='outside' WHERE event_id='a'"); assert.throws(() => f.verify(proof.assertions));
    f.db.exec("UPDATE project_event_scopes SET event_id='a' WHERE event_id='outside'"); f.verify(proof.assertions);
    f.db.exec("UPDATE project_event_scopes SET project_sequence=9 WHERE event_id='a'"); assert.throws(() => f.verify(proof.assertions));
    f.db.exec("UPDATE project_event_scopes SET project_sequence=1 WHERE event_id='a'");
    f.db.exec("UPDATE project_event_scopes SET project_id='another' WHERE event_id='a'"); assert.throws(() => f.verify(proof.assertions));
    f.db.exec("UPDATE project_event_scopes SET project_id='project' WHERE event_id='a'");
    f.db.exec("DELETE FROM project_event_scopes WHERE event_id='a'"); assert.throws(() => f.verify(proof.assertions));
  } finally { f.db.close(); }
});

test("orphan project memberships cannot disappear from the complete-set proof", async () => {
  const f = fixture();
  try {
    f.add("a", 1, "a", { project: true }); const proof = await f.capture({ project });
    f.db.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("missing-event", "access", "org", "project", "owner", 2, stream, 2, "owner", "2026-09-13T00:00:00Z");
    assert.throws(() => f.verify(proof.assertions));
    await assert.rejects(f.capture({ project }), error => error.code === "scene_cost_history_unavailable");
  } finally { f.db.close(); }
});

test("project proof retains the actual event stream and its exact membership origin tuple", async () => {
  const f = fixture();
  try {
    f.add("a", 1, "a", { project: true }); f.add("b", 2, "b", { project: true });
    const proof = await f.capture({ project });
    f.db.exec("UPDATE events SET stream_id='creative:other' WHERE event_id='a'");
    assert.throws(() => f.verify(proof.assertions));
    await assert.rejects(f.capture({ project }), error => error.code === "scene_cost_history_unavailable");
    f.db.prepare("UPDATE events SET stream_id=? WHERE event_id='a'").run(stream);
    f.db.exec("UPDATE project_event_scopes SET source_sequence=999 WHERE event_id='a'");
    assert.throws(() => f.verify(proof.assertions));
    await assert.rejects(f.capture({ project }), error => error.code === "scene_cost_history_unavailable");
  } finally { f.db.close(); }
});

test("empty history is positively certified and later additions invalidate it", async () => {
  const f = fixture();
  try {
    const proof = await f.capture(); assert.equal(proof.rows, 0); assert.equal(proof.assertions.length, 1); f.verify(proof.assertions);
    f.add("new", 1); assert.throws(() => f.verify(proof.assertions));
  } finally { f.db.close(); }
});

test("keyset tie-breaking uses SQLite UTF-8 binary order rather than JavaScript UTF-16 order", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 64; index++) f.add(`ascii-${String(index).padStart(3, "0")}`, 1);
    f.add("\uE000", 1); f.add("\u{10000}", 1);
    const proof = await f.capture(); assert.equal(proof.rows, 66); f.verify(proof.assertions);
  } finally { f.db.close(); }
});

test("same-count replacement and mutation between capture pages/pieces cannot return a partial proof", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 65; index++) f.add(`row-${String(index).padStart(3, "0")}`, index + 1, "x".repeat(20000));
    const originalRead = f.port.read; let mutated = false;
    f.port.read = async (sql, bindings) => {
      const result = await originalRead(sql, bindings);
      if (!mutated && sql.includes(" AS part")) { mutated = true; f.db.exec("UPDATE event_private_payloads SET private_json='y'||substr(private_json,2) WHERE private_event_id='row-000'"); }
      return result;
    };
    await assert.rejects(f.capture()); assert.equal(mutated, true);
  } finally { f.db.close(); }
});

test("capacity limits refuse before final verification, never raising limits or accepting truncation", async () => {
  for (const limits of [{ rows: 1 }, { rawBytes: 3 }, { proofBytes: 1 }, { assertions: 1 }, { reads: 1 }, { bindingBytes: 1 }]) {
    const f = fixture();
    try {
      f.add("one", 1, "1234"); f.add("two", 2, "5678");
      await assert.rejects(f.capture({}, limits), error => error.code === "scene_cost_history_capacity_exceeded");
      assert.equal(f.verifications, 0);
    } finally { f.db.close(); }
  }
  const f = fixture();
  try {
    await assert.rejects(f.capture({}, { rows: SCENE_HISTORY_PROOF_LIMITS.rows + 1 }), error => error.code === "scene_cost_history_capacity_exceeded");
    assert.equal(f.reads, 0);
  } finally { f.db.close(); }
});

test("lowered exact raw-byte limit succeeds; one below fails without accepted evidence", async () => {
  const f = fixture();
  try {
    f.add("row", 1, "abcd"); const exact = 6; // public {} is two bytes; private abcd is four.
    assert.equal((await f.capture({}, { rawBytes: exact })).rawBytes, exact);
    await assert.rejects(f.capture({}, { rawBytes: exact - 1 }), error => error.code === "scene_cost_history_capacity_exceeded");
  } finally { f.db.close(); }
});

test("captured scope cannot be changed while awaiting a read, and expiry is rechecked after final verification", async () => {
  const f = fixture();
  try {
    f.add("row", 1, "{}", { project: true });
    const originalRead = f.port.read, supplied = { streamId: stream, expectedOwnerHead: 1, project: { ...project } };
    f.port.read = async (sql, bindings) => { const rows = await originalRead(sql, bindings); supplied.project.projectId = "other"; return rows; };
    const proof = await captureSceneHistoryProof(f.port, supplied); assert.equal(proof.scope.project.projectId, "project");
    const originalNow = Date.now; let now = 10;
    try {
      Date.now = () => now;
      f.port.verify = async assertions => { f.verify(assertions); now = 21; };
      await assert.rejects(f.capture({ deadlineMs: 20 }), error => error.code === "scene_cost_history_changed");
    } finally { Date.now = originalNow; }
  } finally { f.db.close(); }
});

test("the retained original proof rejects a no-head change inside the consequential write transaction", async () => {
  const f = fixture();
  try {
    f.add("row", 1, "original"); const proof = await f.capture();
    f.db.exec("UPDATE event_private_payloads SET private_json='modified'");
    f.db.exec("BEGIN");
    try {
      for (const [index, assertion] of proof.assertions.entries()) {
        // Same CHECK-abort pattern as existing outputAssertionStatements; this is
        // a fresh SQLite control, not a claim that production consumers are wired.
        f.db.prepare(`INSERT INTO assertions VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`)
          .run(String(index), ...(assertion.bindings ?? []));
      }
      f.db.exec("INSERT INTO guarded_jobs VALUES('must-not-commit'); COMMIT");
      assert.fail("the altered original proof must abort the write");
    } catch { f.db.exec("ROLLBACK"); }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM guarded_jobs").get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM assertions").get().n, 0);
  } finally { f.db.close(); }
});

test("an unchanged original proof permits the isolated guarded-write control", async () => {
  const f = fixture();
  try {
    f.add("row", 1, "original"); const proof = await f.capture();
    f.db.exec("BEGIN");
    try {
      for (const [index, assertion] of proof.assertions.entries()) f.db.prepare(`INSERT INTO assertions VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`)
        .run(String(index), ...(assertion.bindings ?? []));
      f.db.exec("INSERT INTO guarded_jobs VALUES('permitted'); COMMIT");
    } catch (error) { f.db.exec("ROLLBACK"); throw error; }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM guarded_jobs").get().n, 1);
  } finally { f.db.close(); }
});
