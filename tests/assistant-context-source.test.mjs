import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AssistantContextReadWitness, assistantOwnSendGuard, assistantStructuredOwnSendGuard,
  assistantStructuredOwnSendProjectIndexGuard, assistantStructuredOwnSendOwnerHeadGuard, assistantStructuredOwnSendProjectHeadGuard,
  copyAssistantStructuredOwnSendFootprint } from "../worker/assistant-context-source.ts";

// Synthetic SQL unit tests only. The sole product import has type-only imports;
// no Worker, application bootstrap, hosted D1, provider or workerd is started.
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE source_rows(bucket TEXT NOT NULL,value TEXT,amount INTEGER); CREATE TABLE writes(tag TEXT NOT NULL)");
  const executed = [];
  class Prepared {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = [...bindings]; }
    bind(...bindings) { return new Prepared(this.sql, bindings); }
    async all() {
      executed.push(this.sql);
      const results = sqlite.prepare(this.sql).all(...this.bindings);
      return { success: true, results };
    }
  }
  const DB = {
    prepare: sql => new Prepared(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const context = { scope: { actorUserId: "synthetic-unit-actor", organizationId: null, projectAccessId: null, projectId: "project-a", documentId: "doc-a" },
    documentTitle: "Captured page", selectedItems: [], decisionAtoms: [], recentTurns: [], totals: { decisions: 0, outputs: 0, outputsByKind: {} } };
  const write = tag => DB.prepare("INSERT INTO writes(tag) VALUES(?)").bind(tag);
  const tags = () => sqlite.prepare("SELECT tag FROM writes ORDER BY rowid").all().map(row => row.tag);
  async function capture(sql, bindings = [], transform = result => result) {
    const statement = DB.prepare(sql).bind(...bindings), result = transform(await statement.all());
    const descriptor = { sql, bindings }, witness = new AssistantContextReadWitness({ DB });
    witness.observe([statement], [result], [descriptor]); witness.seal(context);
    return { witness, statement, result, descriptor };
  }
  return { sqlite, DB, context, executed, write, tags, capture };
}

function memoryOwnFootprint() {
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 3_600_000).toISOString();
  const actor = "synthetic-memory-actor", turn = "synthetic-memory-turn", stream = "creative:" + actor;
  const rows = ["user", "assistant"].map((role, index) => {
    const contentId = "synthetic-content-" + role, eventId = "synthetic-event-" + role;
    const payload = { actor_user_id: actor, turn_id: turn, project_id: "synthetic-project", document_id: "synthetic-document", content_ref: contentId,
      ...(index ? { operation: "creative-chat", memory_origin_version: 1, organization_id: null, project_access_id: null, owner_user_id: actor } : {}) };
    return { event: [eventId, stream, index + 1, now, now, "user:" + actor, "web:assistant", actor + ":" + turn,
      index ? "synthetic-event-user" : null, null, 1, index ? "AssistantReasoned" : "ChatMessageSent", JSON.stringify(payload), actor, "synthetic-project", "synthetic-document", null],
      content: [contentId, actor, index ? "chat-assistant-memory" : "chat-user", role + " bytes", now, expiry, null],
      receipt: [stream, "synthetic-receipt-" + role, eventId, index + 1, now] };
  });
  return { streamId: stream, sourceHead: 0, actorUserId: actor, turnId: turn, memoryAnswer: { version: 1 }, scope: null,
    eventWrites: rows.map(row => row.event), contents: rows.map(row => row.content), receipts: rows.map(row => row.receipt), resources: [], retentions: [] };
}

test("context source SQL: memory own-send requires the exact two-event marked variant", () => {
  const valid = memoryOwnFootprint();
  assert.doesNotThrow(() => assistantOwnSendGuard(valid));
  const ordinary = structuredClone(valid); delete ordinary.memoryAnswer; ordinary.contents[1][2] = "chat-assistant";
  const ordinaryPayload = JSON.parse(ordinary.eventWrites[1][12]); delete ordinaryPayload.memory_origin_version;
  ordinary.eventWrites[1][12] = JSON.stringify(ordinaryPayload);
  assert.doesNotThrow(() => assistantOwnSendGuard(ordinary));
  for (const alter of [
    value => { delete value.memoryAnswer; },
    value => { value.memoryAnswer.version = 2; },
    value => { value.memoryAnswer.action = true; },
    value => { value.contents[1][2] = "chat-assistant"; },
    value => { const payload = JSON.parse(value.eventWrites[1][12]); delete payload.memory_origin_version; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][12]); payload.proposal_count = 0; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][12]); payload.organization_id = "different-organization"; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][12]); delete payload.owner_user_id; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { value.eventWrites.push([...value.eventWrites[1]]); },
  ]) {
    const invalid = structuredClone(valid); alter(invalid);
    assert.throws(() => assistantOwnSendGuard(invalid), /context_own/u);
  }
  const disguised = structuredClone(ordinary); const payload = JSON.parse(disguised.eventWrites[1][12]); payload.memory_origin_version = null;
  disguised.eventWrites[1][12] = JSON.stringify(payload);
  assert.throws(() => assistantOwnSendGuard(disguised), /context_own_memory_payload/u);
});

test("context source SQL: an empty captured rowset rejects a late inserted source before writes", async t => {
  const f = fixture(t), sql = "SELECT value,amount FROM source_rows WHERE bucket=?";
  const { witness } = await f.capture(sql, ["empty"]);
  await f.DB.batch([...witness.precommitStatements(), f.write("empty-certified")]);
  assert.deepEqual(f.tags(), ["empty-certified"]);
  f.sqlite.prepare("INSERT INTO source_rows VALUES(?,?,?)").run("empty", "late source", 1);
  f.executed.length = 0;
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("must-not-run")]), /malformed JSON/u);
  assert.equal(f.executed.length, 1, "the first real SQL assertion fails before the own INSERT");
  assert.deepEqual(f.tags(), ["empty-certified"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM source_rows").get().n, 1, "the preexisting late source is not undone");
});

test("context source SQL: duplicate row multiplicity is certified rather than reduced to a set", async t => {
  const f = fixture(t), insert = f.sqlite.prepare("INSERT INTO source_rows VALUES('same','repeated',7)");
  insert.run(); insert.run();
  const { witness } = await f.capture("SELECT value,amount FROM source_rows WHERE bucket='same'");
  await f.DB.batch([...witness.precommitStatements(), f.write("two-copies")]);
  insert.run();
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("three-copies")]), /malformed JSON/u);
  f.sqlite.exec("DELETE FROM source_rows WHERE rowid IN(SELECT rowid FROM source_rows ORDER BY rowid LIMIT 2)");
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("one-copy")]), /malformed JSON/u);
  insert.run();
  await f.DB.batch([...witness.precommitStatements(), f.write("two-again")]);
  assert.deepEqual(f.tags(), ["two-copies", "two-again"]);
});

test("context source SQL: row order and object property order are not source changes", async t => {
  const f = fixture(t), insert = f.sqlite.prepare("INSERT INTO source_rows VALUES('ordered',?,?)");
  insert.run("first", 1); insert.run("second", 2);
  const sql = "SELECT value,amount FROM source_rows WHERE bucket='ordered'";
  const { witness } = await f.capture(sql, [], result => ({ ...result,
    results: result.results.map(row => Object.fromEntries(Object.entries(row).reverse())).reverse(),
  }));
  assert.equal(witness.matches(await f.DB.batch(witness.statements())), true);
  f.sqlite.exec("DELETE FROM source_rows"); insert.run("second", 2); insert.run("first", 1);
  assert.equal(witness.matches(await f.DB.batch(witness.statements())), true);
  await f.DB.batch([...witness.precommitStatements(), f.write("same-multiset")]);
  assert.deepEqual(f.tags(), ["same-multiset"]);
});

test("context source SQL: SQLite JSON-subtype columns remain exact JSON strings", async t => {
  const f = fixture(t);
  f.sqlite.prepare("INSERT INTO source_rows VALUES(?,?,?)").run("json", '[1,{"nested":[true,null]}]', 7);
  const sql = "SELECT json_array(value,amount) AS provenance,json_array(json(value),amount) AS nested FROM source_rows WHERE bucket=?";
  const { witness, result } = await f.capture(sql, ["json"]);
  assert.equal(typeof result.results[0].provenance, "string"); assert.equal(typeof result.results[0].nested, "string");
  assert.equal(result.results[0].provenance, JSON.stringify(['[1,{"nested":[true,null]}]', 7]));
  assert.equal(result.results[0].nested, '[[1,{"nested":[true,null]}],7]');
  await f.DB.batch([...witness.precommitStatements(), f.write("exact-json-text")]);
  // Semantically equivalent inner JSON changes provenance text. It is not a
  // license to normalize the stored source string into a different snapshot.
  f.sqlite.prepare("UPDATE source_rows SET value=? WHERE bucket='json'").run('[1, {"nested":[true,null]}]');
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("normalized-json")]), /malformed JSON/u);
  assert.deepEqual(f.tags(), ["exact-json-text"]);
});

test("context source SQL: caller mutation cannot retarget captured bindings, descriptors, rows or context", async t => {
  const f = fixture(t), insert = f.sqlite.prepare("INSERT INTO source_rows VALUES(?,?,1)");
  insert.run("original", "captured"); insert.run("replacement", "different");
  const bindings = ["original"], { witness, result, descriptor } = await f.capture("SELECT value FROM source_rows WHERE bucket=?", bindings);
  bindings[0] = "replacement"; descriptor.sql = "SELECT value FROM source_rows WHERE bucket=? AND 0";
  result.results[0].value = "different"; result.results.push({ value: "extra" }); f.context.documentTitle = "Mutated after sealing";
  assert.equal(witness.context().documentTitle, "Captured page");
  await f.DB.batch([...witness.precommitStatements(), f.write("original-snapshot")]);
  f.sqlite.prepare("UPDATE source_rows SET value='different' WHERE bucket='original'").run();
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("retargeted")]), /malformed JSON/u);
  assert.deepEqual(f.tags(), ["original-snapshot"]);
});

test("context source SQL: invalid or unbounded certificates reject before writes and native assertion failures roll back", async t => {
  const f = fixture(t);
  for (const kind of ["mismatched", "expired", "oversized-rows", "oversized-bytes", "missing-descriptor"]) {
    const sql = kind === "oversized-rows"
      ? "WITH RECURSIVE numbers(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<8193) SELECT n FROM numbers"
      : kind === "oversized-bytes" ? "SELECT printf('%0*d',2097153,0) AS value" : "SELECT 1 AS value";
    const statement = f.DB.prepare(sql), result = await statement.all(), witness = new AssistantContextReadWitness({ DB: f.DB });
    witness.observe([statement], kind === "mismatched" ? [] : [result], kind === "missing-descriptor" ? undefined : [{ sql, bindings: [] }]);
    if (kind === "expired") witness.before("2000-01-01T00:00:00.000Z");
    witness.seal(f.context); f.executed.length = 0;
    assert.throws(() => witness.precommitStatements(), /assistant_context_source_unavailable/u, kind);
    assert.equal(f.executed.length, 0, kind + " cannot reach any write or SQL execution");
    assert.deepEqual(f.tags(), []);
  }
  f.sqlite.exec("INSERT INTO source_rows VALUES('atomic','before',1)");
  const { witness } = await f.capture("SELECT value FROM source_rows WHERE bucket='atomic'");
  f.sqlite.exec("UPDATE source_rows SET value='changed' WHERE bucket='atomic'");
  f.executed.length = 0;
  await assert.rejects(f.DB.batch([...witness.precommitStatements(), f.write("after-failed-guard")]), /malformed JSON/u);
  assert.equal(f.executed.length, 1); assert.deepEqual(f.tags(), []);
  // Deliberately place a synthetic marker before the failing assertion to prove
  // that this tiny adapter really rolls back native SQLite writes on failure.
  // Product-style guard-before-write ordering was checked immediately above.
  await assert.rejects(f.DB.batch([f.write("rollback-control"), ...witness.precommitStatements()]), /malformed JSON/u);
  assert.deepEqual(f.tags(), []);
  await f.DB.batch([f.write("new-transaction-after-rollback")]);
  assert.deepEqual(f.tags(), ["new-transaction-after-rollback"]);
});


// Structured v2 uses the existing synthetic SQLite adapter above. These are
// source-authored unit cases, not native issuance or hosted qualification.
function structuredMemoryOwnFootprint(shared = false) {
  const own = memoryOwnFootprint();
  own.memoryAnswer = { version: 2 };
  own.projectId = "synthetic-project"; own.documentId = "synthetic-document"; own.manifestContentId = "synthetic-manifest";
  own.contents.push([own.manifestContentId, own.actorUserId, "memory-structured-origin", '{"schemaVersion":1,"context":"private manifest"}',
    own.contents[1][4], own.contents[1][5], null]);
  if (shared) {
    own.scope = { organizationId: "synthetic-organization", projectAccessId: "synthetic-access",
      projectId: own.projectId, ownerUserId: "synthetic-owner" };
    own.streamId = "creative:" + own.scope.ownerUserId;
  }
  own.eventWrites.forEach((event, index) => {
    event[1] = own.streamId; event[13] = own.scope?.ownerUserId ?? own.actorUserId;
    const payload = JSON.parse(event[12]);
    if (index) Object.assign(payload, { memory_origin_version: 2, organization_id: own.scope?.organizationId ?? null,
      project_access_id: own.scope?.projectAccessId ?? null, owner_user_id: own.scope?.ownerUserId ?? own.actorUserId });
    event[12] = JSON.stringify(payload); own.receipts[index][0] = own.streamId;
  });
  if (own.scope) {
    const scope = own.scope;
    own.resources = own.contents.map(content => [scope.projectAccessId, "content", content[0], scope.organizationId,
      scope.projectId, scope.ownerUserId, "actor_private", null, own.actorUserId, content[4]]);
    own.retentions = own.contents.map(content => [content[0], scope.organizationId, scope.projectAccessId, scope.projectId,
      own.actorUserId, "transient-private", 1, content[5], content[4]]);
  }
  return own;
}

function structuredOwnFixture(t, shared = false) {
  const f = fixture(t), own = structuredMemoryOwnFootprint(shared);
  f.sqlite.exec(`
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,occurred_at TEXT,recorded_at TEXT,actor TEXT,client_id TEXT,
      correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,created_at TEXT,redacted_at TEXT);
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER,created_at TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_id TEXT,
      owner_user_id TEXT,visibility TEXT,source_event_id TEXT,actor_user_id TEXT,created_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,
      classification TEXT,policy_version INTEGER,assigned_expires_at TEXT,created_at TEXT);
    CREATE TABLE project_event_scopes(event_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,
      source_stream_id TEXT,source_sequence INTEGER,project_sequence INTEGER,actor_user_id TEXT,created_at TEXT);
  `);
  const insert = (table, row) => f.sqlite.prepare("INSERT INTO " + table + " VALUES(" + row.map(() => "?").join(",") + ")").run(...row);
  const body = index => {
    insert("private_content", own.contents[index]);
    if (own.scope) { insert("project_resource_scopes", own.resources[index]); insert("private_content_retention_scopes", own.retentions[index]); }
  };
  const event = index => {
    const row = own.eventWrites[index]; insert("events", row.slice(0, 13));
    if (row[16] !== null) insert("event_private_payloads", [row[0], row[13], row[14], row[15], row[16], row[4], null]);
  };
  const receipt = index => insert("event_client_receipts", own.receipts[index]);
  const projectIndex = index => {
    const scope = own.scope, row = own.eventWrites[index];
    insert("project_event_scopes", [row[0], scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId,
      own.streamId, row[2], index + 1, own.actorUserId, row[4]]);
  };
  const publish = () => {
    [0, 1, 2].forEach(body); [0, 1].forEach(index => { event(index); receipt(index); if (own.scope) projectIndex(index); });
  };
  const accepts = guard => f.sqlite.prepare("SELECT CASE WHEN (" + guard.sql + ") THEN 1 ELSE 0 END AS allowed").get(...guard.bindings).allowed === 1;
  async function witness({ declaredHead = false, legacyOnly = false, deadline = null } = {}) {
    const result = new AssistantContextReadWitness({ DB: f.DB }), descriptors = [
      { sql: "SELECT value FROM source_rows WHERE bucket='structured'", bindings: [] },
      { sql: "SELECT event_id,sequence FROM events WHERE stream_id=? ORDER BY sequence ASC LIMIT 40", bindings: [own.streamId], role: "ascending-events" },
      { sql: "SELECT resource_kind,resource_id FROM project_resource_scopes ORDER BY resource_id", bindings: [], role: "resources" },
      { sql: "SELECT content_id FROM private_content ORDER BY content_id", bindings: [], role: "content-allowlist" },
    ];
    if (!declaredHead) descriptors.push({ sql: "SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?", bindings: [own.streamId], role: "owner-head", streamId: own.streamId });
    if (own.scope) descriptors.push({ sql: "SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?",
      bindings: [own.scope.projectAccessId, own.scope.organizationId], role: "project-head",
      projectAccessId: own.scope.projectAccessId, organizationId: own.scope.organizationId });
    for (const descriptor of descriptors) {
      const statement = f.DB.prepare(descriptor.sql).bind(...descriptor.bindings);
      result.observe([statement], [await statement.all()], [descriptor]);
    }
    if (declaredHead) result.requireStructuredOwnGuard({
      sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [own.streamId, own.sourceHead],
    }, footprint => assistantStructuredOwnSendOwnerHeadGuard(footprint, own.streamId, own.sourceHead),
    { streamId: own.streamId, sourceHead: own.sourceHead });
    if (legacyOnly) result.require({ sql: "1=1", bindings: [] }, () => ({ sql: "1=1", bindings: [] }));
    result.before(deadline); result.seal(f.context); return result;
  }
  return { ...f, own, insert, body, event, receipt, projectIndex, publish, accepts, witness };
}

test("context source SQL: structured v2 is a separate exact two-event three-body footprint", () => {
  for (const shared of [false, true]) {
    const valid = structuredMemoryOwnFootprint(shared);
    assert.doesNotThrow(() => assistantStructuredOwnSendGuard(valid));
    assert.throws(() => assistantOwnSendGuard(valid), /context_own/u);
    for (const alter of [
      own => { own.memoryAnswer.version = 1; },
      own => { own.memoryAnswer.extra = true; },
      own => { own.sourceHead = Number.MAX_SAFE_INTEGER; },
      own => { own.eventWrites.push([...own.eventWrites[1]]); },
      own => { own.receipts.push([...own.receipts[1]]); },
      own => { own.contents.pop(); },
      own => { own.contents[2][0] = own.contents[1][0]; },
      own => { own.manifestContentId = "different-manifest"; },
      own => { own.contents[2][2] = "memory-structured-ledger"; },
      own => { own.contents[2][1] = "foreign-actor"; },
      own => { own.contents[2][3] = "x".repeat(65537); },
      own => { own.contents[2][5] = "September 1, 2020"; },
      own => { own.contents[2][4] = "January 1, 2000"; },
      own => { own.eventWrites[1][3] = "September 1, 2020"; },
      own => { delete own.scope; },
      own => { own.eventWrites[1][11] = "AssistantAnswered"; },
      own => { own.eventWrites[1][15] = "foreign-document"; },
      own => { own.receipts[1][2] = own.eventWrites[0][0]; },
      own => { own.receipts[1][4] = "2001-01-01T00:00:00.000Z"; },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload.memory_origin_version = "2"; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); delete payload.memory_origin_version; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload.manifest_content_ref = own.manifestContentId; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload.source_surface = { manifest: "private bytes" }; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload.deterministic = ["private bytes"]; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload.proposal_count = 0; own.eventWrites[1][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[0][12]); payload.memory_origin_version = 2; own.eventWrites[0][12] = JSON.stringify(payload); },
      own => { const payload = JSON.parse(own.eventWrites[1][12]); payload._private_ref = own.eventWrites[1][0]; own.eventWrites[1][12] = JSON.stringify(payload); own.eventWrites[1][16] = '{"memory_origin_version":2}'; },
      ...(shared ? [
        own => { own.resources.pop(); },
        own => { own.retentions[2][2] = "foreign-access"; },
        own => { own.resources[2][6] = "shared"; },
        own => { own.scope.projectId = "foreign-project"; },
      ] : [own => { own.resources = [["access", "content", own.manifestContentId, "org", own.projectId, own.actorUserId, "actor_private", null, own.actorUserId, own.contents[2][4]]]; }]),
    ]) {
      const invalid = structuredClone(valid); alter(invalid);
      assert.throws(() => assistantStructuredOwnSendGuard(invalid), /context_own/u);
    }
  }
  assert.doesNotThrow(() => assistantOwnSendGuard(memoryOwnFootprint()), "legacy v1 remains admitted by the unchanged path");
});

test("context source SQL: structured final proof rejects every partial suffix and requires complete shared indexes", t => {
  for (const shared of [false, true]) {
    const f = structuredOwnFixture(t, shared), guard = assistantStructuredOwnSendGuard(f.own);
    assert.equal(f.accepts(guard), false);
    [0, 1, 2].forEach(f.body); assert.equal(f.accepts(guard), false);
    f.event(0); f.receipt(0); assert.equal(f.accepts(guard), false);
    f.event(1); assert.equal(f.accepts(guard), false, "missing final receipt is not publication");
    f.receipt(1); assert.equal(f.accepts(guard), true, "all exact body/event/receipt/custody rows now exist");
    if (shared) {
      const indexes = assistantStructuredOwnSendProjectIndexGuard(f.own);
      assert.equal(f.accepts(indexes), false); f.projectIndex(0);
      assert.equal(f.accepts(indexes), false); f.projectIndex(1); assert.equal(f.accepts(indexes), true);
      assert.equal(f.accepts(assistantStructuredOwnSendProjectHeadGuard(f.own, f.own.scope.projectAccessId, f.own.scope.organizationId, 0)), true);
      assert.throws(() => assistantStructuredOwnSendProjectHeadGuard(f.own, "foreign-access", f.own.scope.organizationId, 0), /context_own/u);
    }
    const foreign = [...f.own.eventWrites[1].slice(0, 13)]; foreign[0] = "foreign-event"; foreign[2] = 3;
    f.insert("events", foreign); assert.equal(f.accepts(guard), false, "non-own head advancement cannot be excused");
  }
});

test("context source SQL: structured manifest bytes expiry redaction and all custody remain exact", t => {
  for (const shared of [false, true]) {
    const f = structuredOwnFixture(t, shared); f.publish();
    const guard = assistantStructuredOwnSendGuard(f.own), manifest = f.own.manifestContentId;
    assert.equal(f.accepts(guard), true);
    const mutations = [
      ["DELETE FROM private_content WHERE content_id=?", [manifest]],
      ["UPDATE private_content SET content='different manifest' WHERE content_id=?", [manifest]],
      ["UPDATE private_content SET redacted_at='2001-01-01T00:00:00.000Z' WHERE content_id=?", [manifest]],
      ["UPDATE private_content SET expires_at='2001-01-01T00:00:00.000Z' WHERE content_id=?", [manifest]],
      ["UPDATE private_content SET owner_id='foreign-actor' WHERE content_id=?", [manifest]],
      ["UPDATE event_client_receipts SET client_event_id='foreign-receipt' WHERE event_id=?", [f.own.eventWrites[1][0]]],
      ["UPDATE events SET payload='{}' WHERE event_id=?", [f.own.eventWrites[1][0]]],
      ["INSERT INTO event_private_payloads VALUES(?,?,?,?,?,?,NULL)", [f.own.eventWrites[1][0], f.own.actorUserId, f.own.projectId, f.own.documentId, "{}", f.own.eventWrites[1][4]]],
      ...(shared ? [
        ["DELETE FROM project_resource_scopes WHERE resource_id=?", [manifest]],
        ["UPDATE private_content_retention_scopes SET assigned_expires_at='2099-01-01T00:00:00.000Z' WHERE content_id=?", [manifest]],
        ["INSERT INTO project_resource_scopes SELECT * FROM project_resource_scopes WHERE resource_id=?", [manifest]],
        ["INSERT INTO private_content_retention_scopes SELECT * FROM private_content_retention_scopes WHERE content_id=?", [manifest]],
      ] : [
        ["INSERT INTO project_resource_scopes VALUES('foreign','content',?,'org','project','owner','actor_private',NULL,'actor','date')", [manifest]],
        ["INSERT INTO private_content_retention_scopes VALUES(?,'org','access','project','actor','transient-private',1,'expiry','date')", [manifest]],
      ]),
    ];
    for (const [sql, bindings] of mutations) {
      f.sqlite.exec("BEGIN");
      try { f.sqlite.prepare(sql).run(...bindings); assert.equal(f.accepts(guard), false, sql); }
      finally { f.sqlite.exec("ROLLBACK"); }
      assert.equal(f.accepts(guard), true, "the original full footprint is restored, not rewritten");
    }
  }
});

test("context source SQL: structured witness preserves original strict source and aborts incomplete or stale final batches", async t => {
  for (const shared of [false, true]) {
    const f = structuredOwnFixture(t, shared);
    f.sqlite.exec("INSERT INTO source_rows VALUES('structured','retained negative history',1)");
    const original = await f.witness(), own = structuredClone(f.own), bound = original.bindStructuredOwnSend(own);
    assert.ok(bound.statements().length > original.statements().length);
    assert.equal(original.matches(await f.DB.batch(original.statements())), true);
    assert.equal(bound.matches(await f.DB.batch(bound.statements())), false);
    assert.throws(() => bound.precommitStatements(), /assistant_context_source_unavailable/u);
    await assert.rejects(f.DB.batch([f.write("partial-final"), ...bound.structuredOwnPrecommitStatements()]), /malformed JSON/u);
    assert.deepEqual(f.tags(), []);
    f.publish(); own.contents[2][3] = "mutated caller manifest";
    assert.equal(original.matches(await f.DB.batch(original.statements())), false, "original witness never gained an exemption");
    const certified = await f.DB.batch(bound.statements());
    assert.equal(bound.matches(certified), true);
    for (const malformed of ["missing-success", "error", "false-success"]) {
      for (let index = 0; index < certified.length; index++) {
        const ambiguous = structuredClone(certified);
        if (malformed === "missing-success") delete ambiguous[index].success;
        else if (malformed === "error") ambiguous[index].error = "synthetic result envelope error";
        else ambiguous[index].success = false;
        assert.equal(bound.matches(ambiguous), false, malformed + " at original or own-proof result " + index);
      }
    }
    await f.DB.batch([...bound.structuredOwnPrecommitStatements(), f.write("complete-final")]);
    assert.deepEqual(f.tags(), ["complete-final"]);
    f.sqlite.exec("UPDATE source_rows SET value='changed negative history' WHERE bucket='structured'");
    assert.equal(bound.matches(await f.DB.batch(bound.statements())), false);
    await assert.rejects(f.DB.batch([f.write("changed-final"), ...bound.structuredOwnPrecommitStatements()]), /malformed JSON/u);
    assert.deepEqual(f.tags(), ["complete-final"], "failed terminal evidence rolls the same batch back");
    assert.equal(bound.bindStructuredOwnSend(f.own).statements().length, 0, "bound evidence cannot be rebound");
    assert.equal(bound.bindOwnSend(memoryOwnFootprint()).statements().length, 0, "v2 cannot downgrade through the legacy binder");
  }
});

test("context source SQL: structured native head callbacks are explicit copied and cannot substitute for absent anchors", async t => {
  const f = structuredOwnFixture(t), original = await f.witness({ declaredHead: true }), bound = original.bindStructuredOwnSend(f.own);
  assert.ok(bound.statements().length); f.publish();
  assert.equal(bound.matches(await f.DB.batch(bound.statements())), true);
  await f.DB.batch([...bound.structuredOwnPrecommitStatements(), f.write("declared-final")]);
  assert.deepEqual(f.tags(), ["declared-final"]);
  assert.throws(() => assistantStructuredOwnSendOwnerHeadGuard(f.own, "creative:foreign", 0), /context_own/u);
  assert.throws(() => assistantStructuredOwnSendOwnerHeadGuard(f.own, f.own.streamId, 1), /context_own/u);
  const absent = new AssistantContextReadWitness({ DB: f.DB }), sql = "SELECT 1 AS captured", statement = f.DB.prepare(sql);
  absent.observe([statement], [await statement.all()], [{ sql, bindings: [] }]); absent.seal(f.context);
  assert.equal(absent.bindStructuredOwnSend(f.own).statements().length, 0);
  for (const altered of [{ streamId: "creative:foreign", sourceHead: 0 }, { streamId: f.own.streamId, sourceHead: 1 }]) {
    const disagree = new AssistantContextReadWitness({ DB: f.DB });
    disagree.observe([statement], [await statement.all()], [{ sql, bindings: [] }]);
    disagree.requireStructuredOwnGuard({ sql: "1=1", bindings: [] }, () => ({ sql: "1=1", bindings: [] }), altered);
    disagree.seal(f.context);
    assert.equal(disagree.bindStructuredOwnSend(f.own).statements().length, 0);
  }
});

test("context source SQL: structured callback admission keeps legacy-only guards and original deadlines strict", async t => {
  const f = structuredOwnFixture(t), legacyOnly = await f.witness({ legacyOnly: true });
  assert.equal(legacyOnly.bindStructuredOwnSend(f.own).statements().length, 0, "a v1 callback is never cast into v2 authority");
  const deadline = new Date(Date.now() + 60_000).toISOString(), original = await f.witness({ deadline });
  const bound = original.bindStructuredOwnSend(f.own); f.publish();
  assert.equal(bound.matches(await f.DB.batch(bound.statements())), true);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 120_000);
  assert.equal(bound.matches(await f.DB.batch(bound.statements())), false, "new proof does not renew original lease");
  assert.throws(() => bound.structuredOwnPrecommitStatements(), /assistant_context_source_unavailable/u);
});

test("context source SQL: structured public marker stays authoritative with the genuine full private envelope", t => {
  const f = structuredOwnFixture(t), own = f.own;
  const full = { ...JSON.parse(own.eventWrites[1][12]), deterministic: true };
  const visible = { ...full, _private_ref: own.eventWrites[1][0] }; delete visible.deterministic;
  own.eventWrites[1][12] = JSON.stringify(visible); own.eventWrites[1][16] = JSON.stringify(full);
  const guard = assistantStructuredOwnSendGuard(own);
  f.publish(); assert.equal(f.accepts(guard), true, "full original private JSON legitimately repeats public scalar2");
  for (const change of [
    value => { const payload = JSON.parse(value.eventWrites[1][12]); delete payload.memory_origin_version; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][16]); payload.memory_origin_version = 1; value.eventWrites[1][16] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][12]); payload.actor_user_id = "foreign-actor"; value.eventWrites[1][12] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][16]); delete payload.content_ref; value.eventWrites[1][16] = JSON.stringify(payload); },
    value => { const payload = JSON.parse(value.eventWrites[1][16]); payload.ledger_history = ["private dependency"]; value.eventWrites[1][16] = JSON.stringify(payload); },
  ]) {
    const invalid = structuredClone(own); change(invalid);
    assert.throws(() => assistantStructuredOwnSendGuard(invalid), /context_own/u);
  }
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(own.eventWrites[1][0]);
  assert.equal(f.accepts(guard), false, "native full-envelope bytes cannot drift after footprint binding");
});

test("context source SQL: structured copy rejects unbounded or nested undeclared input before copying", () => {
  const own = structuredMemoryOwnFootprint(), copy = copyAssistantStructuredOwnSendFootprint(own);
  assert.deepEqual(copy, own); own.contents[2][3] = "later caller mutation";
  assert.notEqual(copy.contents[2][3], own.contents[2][3]);
  const extra = structuredMemoryOwnFootprint(); extra.undeclared = { circular: null }; extra.undeclared.circular = extra;
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(extra), /context_own_structured_shape/u);
  const large = structuredMemoryOwnFootprint(); large.contents[0][3] = "x".repeat(2 * 1024 * 1024 + 1);
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(large), /context_source_limit/u);
  const nested = structuredMemoryOwnFootprint(); nested.contents[0][3] = { private: "not scalar" };
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(nested), /context_own_structured_shape/u);
  const head = structuredMemoryOwnFootprint(); head.sourceHead = { circular: null }; head.sourceHead.circular = head.sourceHead;
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(head), /context_own_structured_shape/u);
  let invoked = 0;
  const getter = structuredMemoryOwnFootprint();
  Object.defineProperty(getter, "contents", { enumerable: true, get() { invoked++; return []; } });
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(getter), /context_own_structured_shape/u);
  const rowGetter = structuredMemoryOwnFootprint();
  Object.defineProperty(rowGetter.contents[0], "3", { enumerable: true, get() { invoked++; return "private bytes"; } });
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(rowGetter), /context_own_structured_shape/u);
  const iterator = structuredMemoryOwnFootprint();
  iterator.contents[Symbol.iterator] = function* () { invoked++; yield* []; };
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(iterator), /context_own_structured_shape/u);
  const oversized = structuredMemoryOwnFootprint(); oversized.contents = new Array(1_000_000);
  oversized.contents[Symbol.iterator] = function* () { invoked++; yield* []; };
  assert.throws(() => copyAssistantStructuredOwnSendFootprint(oversized), /context_own_structured_shape/u);
  assert.equal(invoked, 0, "bounded copying never invokes accessor or iterator code");
  const frozen = structuredMemoryOwnFootprint();
  for (const table of [frozen.eventWrites, frozen.contents, frozen.receipts, frozen.resources, frozen.retentions]) {
    table.forEach(Object.freeze); Object.freeze(table);
  }
  Object.freeze(frozen.memoryAnswer); Object.freeze(frozen);
  assert.deepEqual(copyAssistantStructuredOwnSendFootprint(frozen), frozen, "ordinary frozen scalar rows remain compatible");
});

test("context source SQL: structured proof stays bound to original database after equal-result replacement", async t => {
  const f = structuredOwnFixture(t), env = { DB: f.DB }, original = new AssistantContextReadWitness(env);
  const descriptor = { sql: "SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?",
    bindings: [f.own.streamId], role: "owner-head", streamId: f.own.streamId };
  const statement = f.DB.prepare(descriptor.sql).bind(...descriptor.bindings);
  original.observe([statement], [await statement.all()], [descriptor]); original.seal(f.context);
  const bound = original.bindStructuredOwnSend(f.own); f.publish();
  const exact = await f.DB.batch(bound.statements());
  assert.equal(bound.matches(exact), true);
  let replacementPrepares = 0;
  env.DB = { ...f.DB, prepare(sql) { replacementPrepares++; return f.DB.prepare(sql); } };
  assert.equal(bound.matches(exact), false, "even transparent same-row replacement cannot renew DB identity");
  assert.equal(original.bindStructuredOwnSend(f.own).statements().length, 0);
  assert.throws(() => bound.structuredOwnPrecommitStatements(), /assistant_context_source_unavailable/u);
  assert.equal(replacementPrepares, 0, "the new final path never prepares against the substituted database");
  env.DB = f.DB;
  assert.equal(bound.matches(exact), true, "this direct witness check observes the original binding; caller still owns request lifecycle");
});
