import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// This suite exercises pure validation and native identity SELECT construction.
// Native principal/source authorization is covered by the composed app fixture.
globalThis.fetch = async () => { throw new Error("external_fetch_forbidden"); };
const root = new URL("../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const local = typeof context.parentURL === "string" && context.parentURL.startsWith(root) && !context.parentURL.includes("/node_modules/");
  return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const [reader, origin, { liveMemorySourceQuery }, { AssistantContextReadWitness }] = await Promise.all([
  import("../worker/memory-native-origin-reader.ts"), import("../worker/memory-native-origin.ts"),
  import("../worker/memory-live-sources.ts"), import("../worker/assistant-context-source.ts"),
]).finally(() => resolution.deregister());

const at = Date.parse("2026-09-04T12:00:00.000Z");
const recorded = "2026-09-04T10:00:00.000Z", created = "2026-09-04T11:00:00.000Z", expires = "2026-09-10T12:00:00.000Z";
function dependency(sequence, segmented = true) {
  return {
    origin_id: "origin", ordinal: sequence - 1, event_stream_id: "creative:alice", event_id: "source-" + sequence,
    source_sequence: sequence, event_type: "AssistantReasoned", recorded_at: recorded, block_id: null,
    turn_id: "turn-" + sequence, user_content_id: "user-" + sequence, assistant_content_id: "answer-" + sequence,
    projection_sha256: "a".repeat(64), source_retention_ceiling: expires, consumed: 1,
    segment_enrollment_id: segmented ? "enrollment" : null, segment_revision: segmented ? 1 : null,
    segment_recipe: segmented ? "live-conversation-references-v1" : null, segment_first_sequence: segmented ? 1 : null,
    segment_last_sequence: segmented ? 2 : null, segment_member_count: segmented ? 2 : null,
    segment_ordinal: segmented ? sequence - 1 : null, segment_created_at: segmented ? created : null,
    segment_retention_ceiling: segmented ? expires : null,
  };
}
function segment() {
  return { enrollment_id: "enrollment", enrollment_revision: 1, recipe_version: "live-conversation-references-v1",
    first_sequence: 1, last_sequence: 2, member_count: 2,
    members_json: JSON.stringify([1, 2].map(sequence => ({ eventId: "source-" + sequence, sequence, turnId: "turn-" + sequence }))),
    created_at: created, expires_at: expires };
}
function nativeQueryFixture() {
  const scopeKey = JSON.stringify(["", "", "project", "document"]);
  const e = { enrollment_id: "enrollment", actor_user_id: "alice", owner_user_id: "alice", organization_id: null,
    project_access_id: null, project_id: "project", document_id: "document", permission_epoch: "epoch",
    policy_version: "personal-memory-v2", revision: 1, enrolled_at: "2026-09-01T00:00:00.000Z", expires_at: expires,
    retention_days: 30, cursor_sequence: 20, recall_enabled: 1 };
  const binding = { actorUserId: "alice", streamId: "creative:alice", projectId: "project", documentId: "document", scope: null };
  const actor = { principal: { userId: "alice", streamId: "creative:alice", access: { permissionEpoch: "epoch" } },
    project: null, surface: { documentId: "document", canvasId: null }, projectId: "project" };
  return { e, q: liveMemorySourceQuery(e, { binding, actor, principal: actor.principal, scopeKey }) };
}

test("native origin reader: saved selector preserves the full real native source predicate and binding order", () => {
  const { e, q } = nativeQueryFixture(), dependencies = [dependency(1), dependency(2, false)];
  const query = reader.nativeMemoryOriginSourcesQuery(e, q, { selection_cursor: 7 }, dependencies);
  assert.ok(query.sql.includes(q.joins)); assert.ok(query.sql.includes(q.condition));
  assert.deepEqual(query.bindings.slice(0, 6), q.bindings.slice(0, 6));
  assert.equal(query.bindings[6], e.enrollment_id);
  const saved = JSON.parse(query.bindings[7]);
  assert.deepEqual(saved, dependencies.map(row => ({ eventId: row.event_id, streamId: row.event_stream_id,
    sequence: row.source_sequence, type: row.event_type, turnId: row.turn_id, userContentId: row.user_content_id,
    assistantContentId: row.assistant_content_id, segmented: row.segment_enrollment_id === null ? 0 : 1 })));
  assert.deepEqual(query.bindings.slice(8, -1), q.bindings.slice(6)); assert.equal(query.bindings.at(-1), 7);
  assert.equal((query.sql.match(/\?/gu) ?? []).length, query.bindings.length);
  assert.ok(query.bindings.length <= 99); assert.ok(query.sql.length <= 90_000);
  assert.match(query.sql, /remembered\.sequence=event\.sequence/u);
  assert.match(query.sql, /authored\.content_id IS json_extract/u);
  assert.match(query.sql, /answer\.content_id IS json_extract/u);
  assert.match(query.sql, /ORDER BY event\.sequence LIMIT 129/u);
});

test("native origin reader: original legacy sources cannot bypass current segment retirement or memory recursion", () => {
  const { e, q } = nativeQueryFixture();
  const query = reader.nativeMemoryOriginSourcesQuery(e, q, { selection_cursor: 2 }, [dependency(1, false)]);
  assert.match(query.sql, /remembered\.conversation_segmented=0 AND NOT EXISTS/u);
  assert.match(query.sql, /event\.sequence BETWEEN segment\.first_sequence AND segment\.last_sequence/u);
  assert.match(query.sql, /NOT EXISTS\(SELECT 1 FROM memory_native_answer_origins derived WHERE derived\.answer_content_id IN\(authored\.content_id,answer\.content_id\)\)/u);
  assert.match(query.sql, /json_extract\(ancestor\.payload,'\$\.content_ref'\) IN\(authored\.content_id,answer\.content_id\)/u);
});

test("native origin reader: exact source marker projection distinguishes missing from explicit null or retyped markers", t => {
  const { e, q } = nativeQueryFixture(), db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const query = reader.nativeMemoryOriginSourcesQuery(e, q, { selection_cursor: 2 }, [dependency(1, false)]);
  const expression = "CASE WHEN json_type(event.payload,'$.memory_origin_version') IS NULL THEN NULL ELSE COALESCE(json_extract(event.payload,'$.memory_origin_version'),'null') END";
  assert.ok(query.sql.includes(expression + " AS source_memory_origin_version"));
  const statement = db.prepare("SELECT " + expression + " AS marker FROM (SELECT ? AS payload) event");
  assert.equal(statement.get("{}").marker, null);
  for (const marker of [null, 1, 0, "1", true, false, {}])
    assert.notEqual(statement.get(JSON.stringify({ memory_origin_version: marker })).marker, null);
});

test("native origin reader: empty and excessive original dependency lists are denied before query creation", () => {
  const { e, q } = nativeQueryFixture();
  for (const rows of [[], Array.from({ length: 129 }, (_, index) => dependency(index + 1, false))])
    assert.throws(() => reader.nativeMemoryOriginSourcesQuery(e, q, { selection_cursor: 129 }, rows), /dependency_limit/u);
});

test("native origin reader: exact segment SELECT ignores newer windows and foreign enrollment/revision", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  // Column-exact identity selector fixture only, not a replacement authority model.
  db.exec("CREATE TABLE memory_live_conversation_segments(enrollment_id TEXT,enrollment_revision INTEGER,recipe_version TEXT,first_sequence INTEGER,last_sequence INTEGER,member_count INTEGER,members_json TEXT,created_at TEXT,expires_at TEXT)");
  const row = segment(), insert = db.prepare("INSERT INTO memory_live_conversation_segments VALUES(?,?,?,?,?,?,?,?,?)");
  for (const value of [row, { ...row, enrollment_id: "foreign" }, { ...row, enrollment_revision: 2 },
    ...Array.from({ length: 10 }, (_, index) => ({ ...row, first_sequence: index + 10, last_sequence: index + 10 }))])
    insert.run(...Object.values(value));
  const query = reader.nativeMemoryOriginSegmentsQuery([dependency(1), dependency(2)]);
  const rows = db.prepare(query.sql).all(...query.bindings);
  assert.equal(rows.length, 1); assert.equal(rows[0].first_sequence, 1); assert.equal(rows[0].enrollment_id, "enrollment");
  assert.equal(reader.nativeMemoryOriginSegmentsMatch([dependency(1), dependency(2)], rows, at), true);
  db.prepare("DELETE FROM memory_live_conversation_segments WHERE first_sequence=1 AND enrollment_id='enrollment' AND enrollment_revision=1").run();
  assert.deepEqual(db.prepare(query.sql).all(...query.bindings), []);
});

test("native origin reader: a complete segment remains valid when returned rows are reordered", () => {
  const dependencies = [dependency(2), dependency(1)], snapshot = structuredClone(dependencies);
  assert.equal(reader.nativeMemoryOriginSegmentsMatch(dependencies, [segment()], at), true);
  assert.deepEqual(dependencies, snapshot, "matcher must not mutate caller dependencies");
  assert.equal(reader.nativeMemoryOriginSegmentsMatch([dependency(1, false)], [], at), true);
});

const changes = {
  "missing member": (row) => { row.members_json = JSON.stringify(JSON.parse(row.members_json).slice(0, 1)); },
  "reordered member": (row) => { row.members_json = JSON.stringify(JSON.parse(row.members_json).reverse()); },
  "duplicate member": (row) => { const members = JSON.parse(row.members_json); row.members_json = JSON.stringify([members[0], members[0]]); },
  "changed turn": (row) => { const members = JSON.parse(row.members_json); members[0].turnId = "other"; row.members_json = JSON.stringify(members); },
  "changed source sequence": (row) => { const members = JSON.parse(row.members_json); members[0].sequence = 40; row.members_json = JSON.stringify(members); },
  "extra member key": (row) => { const members = JSON.parse(row.members_json); members[0].grant = "not authority"; row.members_json = JSON.stringify(members); },
  "malformed membership": (row) => { row.members_json = "not json"; },
  "changed group count": (row) => { row.member_count = 1; },
  "changed group boundary": (row) => { row.last_sequence = 3; },
  "changed creation": (row) => { row.created_at = "2026-09-04T10:30:00.000Z"; },
  "expired group": (row) => { row.expires_at = new Date(at).toISOString(); },
  "foreign enrollment": (row) => { row.enrollment_id = "other"; },
};
for (const [name, mutate] of Object.entries(changes)) test("native origin reader: complete membership rejects " + name, () => {
  const row = segment(); mutate(row);
  assert.equal(reader.nativeMemoryOriginSegmentsMatch([dependency(1), dependency(2)], [row], at), false);
});

test("native origin reader: missing unconsumed segment member and duplicate actual manifest fail closed", () => {
  const rows = [dependency(1), { ...dependency(2), consumed: 0 }];
  assert.equal(reader.nativeMemoryOriginSegmentsMatch(rows, [segment()], at), true);
  assert.equal(reader.nativeMemoryOriginSegmentsMatch(rows.slice(0, 1), [segment()], at), false);
  assert.equal(reader.nativeMemoryOriginSegmentsMatch(rows, [segment(), segment()], at), false);
});

test("native origin reader: source fingerprint is stable across clocks but binds exact native identities and consumed Unicode", async () => {
  const row = { event_stream_id: "creative:alice", event_id: "event", sequence: 5, type: "AssistantReasoned", recorded_at: recorded,
    source_actor: "user:alice", source_client_id: "web:assistant", source_correlation_id: "alice:turn", source_causation_id: "message",
    source_memory_origin_version: null,
    block_id: null, turn_id: "turn", user_content_id: "user", assistant_content_id: "answer", user_text: "Question 文書", assistant_text: "Answer 文書" };
  const hash = await origin.nativeMemoryFingerprint(origin.nativeMemorySourceProjection(row));
  assert.equal(await origin.nativeMemoryFingerprint(origin.nativeMemorySourceProjection({ ...row, valid_until: "later", cursor: 100 })), hash);
  for (const field of ["event_stream_id", "event_id", "turn_id", "user_content_id", "assistant_content_id", "assistant_text", "user_text",
    "source_actor", "source_client_id", "source_correlation_id", "source_causation_id"])
    assert.notEqual(await origin.nativeMemoryFingerprint(origin.nativeMemorySourceProjection({ ...row, [field]: row[field] + "changed" })), hash, field);
  assert.notEqual(await origin.nativeMemoryFingerprint(origin.nativeMemorySourceProjection({ ...row, sequence: 6 })), hash);
  for (const marker of [undefined, 1, 0, "1", "null", true])
    assert.throws(() => origin.nativeMemorySourceProjection({ ...row, source_memory_origin_version: marker }), undefined, "marked sources cannot become ordinary dependencies");
});

test("native origin reader: standalone use without an observer never reads the database", async () => {
  const forbidden = () => { throw new Error("unexpected database call"); }, env = { DB: { prepare: forbidden, batch: forbidden } };
  assert.equal(await reader.revalidateNativeAnswerOrigin(env, {}, {}, undefined), null);
  assert.equal(await reader.revalidateNativeAnswerOrigin(env, {}, {}, { observe() {}, require() {} }), null);
});

test("native origin reader: disabled or forged prepared identity fails before schema access", async () => {
  const forbidden = () => { throw new Error("unexpected database call"); }, env = { DB: { prepare: forbidden, batch: forbidden } };
  const observer = { observe() {}, require() {}, before() {} };
  assert.equal(await reader.revalidateNativeAnswerOrigin(env, {}, {}, observer), null);
  assert.equal(await reader.revalidateNativeAnswerOrigin(env, { principal: { userId: "alice" }, binding: {} },
    { originId: "o", turnId: "t", answerEventId: "e", answerContentId: "c", answer: "private" }, observer), null);
});

function pairSelectorFixture(t, shared = false) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  // This isolates the native pair identity SELECT, not principal admission or
  // source eligibility. Composed runtime tests supply those real outer guards.
  for (const sql of [
    "CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,occurred_at TEXT,recorded_at TEXT,actor TEXT,client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT)",
    "CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT)",
    "CREATE TABLE assistant_turns(actor_user_id TEXT,scope_key TEXT,turn_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,user_content_ref TEXT,assistant_content_ref TEXT,status TEXT,proposal_json TEXT,created_at TEXT,completed_at TEXT)",
    "CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,created_at TEXT,redacted_at TEXT)",
    "CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER,created_at TEXT,PRIMARY KEY(stream_id,client_event_id))",
    "CREATE TABLE project_event_scopes(event_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,source_stream_id TEXT,source_sequence INTEGER,project_sequence INTEGER,actor_user_id TEXT,created_at TEXT)",
    "CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,assigned_expires_at TEXT)",
    "CREATE TABLE assistant_specialist_tasks(actor_user_id TEXT,scope_key TEXT,turn_id TEXT)",
    "CREATE TABLE assistant_action_proposals(actor_user_id TEXT,scope_key TEXT,turn_id TEXT)",
    "CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT,answer_event_id TEXT)",
  ]) db.exec(sql);
  const stamp = new Date().toISOString(), deadline = new Date(Date.now() + 60_000).toISOString();
  const header = { origin_id: "origin", actor_user_id: "alice", owner_user_id: shared ? "owner" : "alice",
    organization_id: shared ? "org" : null, project_access_id: shared ? "access" : null, project_id: "project", document_id: "document",
    scope_key: JSON.stringify([shared ? "org" : "", shared ? "access" : "", "project", "document"]), turn_id: "turn",
    user_event_id: "own-user", user_source_sequence: 21, user_content_id: "user-private",
    answer_event_id: "own-answer", answer_source_sequence: 22, answer_content_id: "answer-private", answer_expires_at: deadline };
  const insert = (table, row) => db.prepare("INSERT INTO " + table + "(" + Object.keys(row).join(",") + ") VALUES(" + Object.keys(row).map(() => "?").join(",") + ")").run(...Object.values(row));
  const base = { stream_id: "creative:" + header.owner_user_id, occurred_at: stamp, recorded_at: stamp, actor: "user:alice", client_id: "web:assistant",
    correlation_id: "alice:turn", causation_id: null, compensates_event_id: null, schema_version: 1 };
  for (const [role, type, sequence, contentId, kind, text] of [
    ["user", "ChatMessageSent", 21, "user-private", "chat-user", "Original user message"],
    ["answer", "AssistantReasoned", 22, "answer-private", "chat-assistant-memory", "Original answer"],
  ]) {
    insert("private_content", { content_id: contentId, owner_id: "alice", kind, content: text, created_at: stamp, expires_at: deadline, redacted_at: null });
    insert("events", { ...base, event_id: "own-" + role, sequence, type, causation_id: role === "answer" ? "own-user" : null,
      payload: JSON.stringify({ actor_user_id: "alice", project_id: "project", document_id: "document", turn_id: "turn", content_ref: contentId,
        ...(role === "answer" ? { operation: "creative-chat", memory_origin_version: 1, organization_id: header.organization_id,
          project_access_id: header.project_access_id, owner_user_id: header.owner_user_id } : {}) }) });
    insert("event_client_receipts", { stream_id: base.stream_id,
      client_event_id: "assistant:alice:" + (shared ? "access" : "personal") + ":document:turn:" + (role === "answer" ? "assistant" : "user"),
      event_id: "own-" + role, sequence, created_at: stamp });
    if (shared) insert("project_event_scopes", { event_id: "own-" + role, project_access_id: "access", organization_id: "org", project_id: "project",
      owner_user_id: "owner", source_stream_id: base.stream_id, source_sequence: sequence, project_sequence: sequence, actor_user_id: "alice", created_at: stamp });
  }
  insert("assistant_turns", { actor_user_id: "alice", scope_key: header.scope_key, turn_id: "turn", organization_id: header.organization_id,
    project_access_id: header.project_access_id, project_id: "project", document_id: "document", user_content_ref: "user-private",
    assistant_content_ref: "answer-private", status: "completed", created_at: stamp, completed_at: stamp });
  const query = reader.nativeMemoryOriginPairQuery(header, { sql: "turn.status='completed'", bindings: [] });
  assert.equal((query.sql.match(/\?/gu) ?? []).length, query.bindings.length);
  const read = () => db.prepare(query.sql).all(...query.bindings);
  return { db, header, read, insert, stamp, deadline, base };
}

for (const shared of [false, true]) {
  test("native origin reader: original pair identity selector accepts the exact native " + (shared ? "shared" : "personal") + " pair", t => {
    const state = pairSelectorFixture(t, shared), rows = state.read();
    assert.equal(rows.length, 1); assert.equal(rows[0].user_text, "Original user message"); assert.equal(rows[0].answer_text, "Original answer");
  });
  test("native origin reader: repointing an erased authored pointer cannot revive the " + (shared ? "shared" : "personal") + " pair", t => {
    const state = pairSelectorFixture(t, shared);
    state.insert("private_content", { content_id: "replacement", owner_id: "alice", kind: "chat-user", content: "Original user message",
      created_at: state.stamp, expires_at: state.deadline, redacted_at: null });
    state.db.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id='user-private'").run(state.stamp);
    state.db.prepare("UPDATE assistant_turns SET user_content_ref='replacement'").run();
    assert.deepEqual(state.read(), []);
  });
}

for (const field of ["organization_id", "project_access_id"]) {
  for (const shape of ["missing", "text"])
    test("native origin reader: personal marker rejects " + shape + " " + field + " instead of explicit null", t => {
      const state = pairSelectorFixture(t);
      const expression = shape === "missing" ? "json_remove(payload,?)" : "json_set(payload,?,'')";
      state.db.prepare("UPDATE events SET payload=" + expression + " WHERE event_id='own-answer'").run("$." + field);
      assert.deepEqual(state.read(), []);
    });
}

test("native origin reader: late alternate-role immutable ancestry invalidates the exact final replay", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT); CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT)");
  const query = origin.nativeMemoryOriginAncestryQuery([{ user_content_id: "retyped-memory-answer", assistant_content_id: "ordinary-answer" }]);
  const read = () => ({ success: true, results: db.prepare(query.sql).all(...query.bindings), meta: {} });
  const captured = read(), witness = new AssistantContextReadWitness({ DB: {} });
  witness.observe([query], [captured], [query]); witness.seal({ recentTurns: [] });
  assert.equal(witness.matches([read()]), true);
  db.prepare("INSERT INTO events VALUES(?,?,?)").run("memory-event", "AssistantReasoned",
    JSON.stringify({ content_ref: "retyped-memory-answer", memory_origin_version: 1 }));
  assert.equal(captured.results.length, 0); assert.equal(witness.matches([read()]), false);
});

for (const [name, sql] of [
  ["answer causation", "UPDATE events SET causation_id='replacement-message' WHERE event_id='own-answer'"],
  ["user correlation", "UPDATE events SET correlation_id='different' WHERE event_id='own-user'"],
  ["answer client", "UPDATE events SET client_id='other-client' WHERE event_id='own-answer'"],
  ["missing answer origin marker", "UPDATE events SET payload=json_remove(payload,'$.memory_origin_version') WHERE event_id='own-answer'"],
  ["wrong answer origin marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',2) WHERE event_id='own-answer'"],
  ["string answer origin marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version','1') WHERE event_id='own-answer'"],
  ["boolean answer origin marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',json('true')) WHERE event_id='own-answer'"],
  ["null answer origin marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',NULL) WHERE event_id='own-answer'"],
  ["missing marker organization", "UPDATE events SET payload=json_remove(payload,'$.organization_id') WHERE event_id='own-answer'"],
  ["changed marker organization", "UPDATE events SET payload=json_set(payload,'$.organization_id','other-org') WHERE event_id='own-answer'"],
  ["missing marker access", "UPDATE events SET payload=json_remove(payload,'$.project_access_id') WHERE event_id='own-answer'"],
  ["changed marker access", "UPDATE events SET payload=json_set(payload,'$.project_access_id','other-access') WHERE event_id='own-answer'"],
  ["missing marker owner", "UPDATE events SET payload=json_remove(payload,'$.owner_user_id') WHERE event_id='own-answer'"],
  ["changed marker owner", "UPDATE events SET payload=json_set(payload,'$.owner_user_id','other-owner') WHERE event_id='own-answer'"],
  ["user event sequence", "UPDATE events SET sequence=20 WHERE event_id='own-user'"],
  ["user receipt deletion", "DELETE FROM event_client_receipts WHERE event_id='own-user'"],
  ["answer receipt sequence", "UPDATE event_client_receipts SET sequence=99 WHERE event_id='own-answer'"],
  ["user receipt time", "UPDATE event_client_receipts SET created_at='2020-01-01T00:00:00.000Z' WHERE event_id='own-user'"],
  ["user event custody", "DELETE FROM project_event_scopes WHERE event_id='own-user'"],
  ["answer event actor custody", "UPDATE project_event_scopes SET actor_user_id='other' WHERE event_id='own-answer'"],
  ["stored proposal metadata", "UPDATE assistant_turns SET proposal_json='{}'"],
  ["answer proposal count", "UPDATE events SET payload=json_set(payload,'$.proposal_count',0) WHERE event_id='own-answer'"],
  ["stored action proposal", "INSERT INTO assistant_action_proposals SELECT actor_user_id,scope_key,turn_id FROM assistant_turns"],
  ["proposal event", "INSERT INTO events(event_id,stream_id,type,payload) SELECT 'proposal',stream_id,'MutationProposed',json_object('turn_id','turn') FROM events WHERE event_id='own-answer'"],
]) test("native origin reader: native paired selector rejects changed " + name, t => {
  const state = pairSelectorFixture(t, true); state.db.exec(sql); assert.deepEqual(state.read(), []);
});

function paidSourceSelectorFixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE assistant_specialist_tasks(task_id TEXT PRIMARY KEY,actor_user_id TEXT,scope_key TEXT,turn_id TEXT,status TEXT)");
  const header = { actor_user_id: "alice", scope_key: JSON.stringify(["org", "access", "project", "document"]) };
  const dependencies = [dependency(1), { ...dependency(2), consumed: 0 }];
  const query = reader.nativeMemoryOriginPaidSourcesQuery(header, dependencies);
  const read = () => ({ success: true, results: db.prepare(query.sql).all(...query.bindings), meta: {} });
  const insert = (id, actor = "alice", scope = header.scope_key, turn = "turn-2", status = "queued") =>
    db.prepare("INSERT INTO assistant_specialist_tasks VALUES(?,?,?,?,?)").run(id, actor, scope, turn, status);
  return { db, query, read, insert, header };
}

test("native origin reader: paid-source lookup checks required unconsumed members without widening actor or scope", t => {
  const state = paidSourceSelectorFixture(t);
  state.insert("other-actor", "bob"); state.insert("other-scope", "alice", "different-scope");
  state.insert("other-turn", "alice", state.header.scope_key, "unrelated-turn");
  assert.deepEqual(state.read().results, []);
  state.insert("adopted-required-member");
  assert.deepEqual(state.read().results.map(row => row.task_id), ["adopted-required-member"]);
  assert.equal((state.query.sql.match(/\?/gu) ?? []).length, state.query.bindings.length);
  assert.ok(!/private_content|\.content\b|result_json/u.test(state.query.sql), "same answer bytes cannot make a paid adoption eligible");
});

test("native origin reader: late paid adoption invalidates the required final replay even with an unchanged answer", t => {
  const state = paidSourceSelectorFixture(t), captured = state.read();
  const witness = new AssistantContextReadWitness({ DB: {} });
  witness.observe([state.query], [captured], [state.query]); witness.seal({ recentTurns: [] });
  assert.equal(witness.matches([state.read()]), true);
  state.insert("late-paid", "alice", state.header.scope_key, "turn-1", "completed");
  assert.equal(captured.results.length, 0);
  assert.equal(witness.matches([state.read()]), false);
});

for (const status of ["queued", "running", "completed", "failed", "canceled"])
test("native origin reader: paid source remains excluded for task status " + status, t => {
  const state = paidSourceSelectorFixture(t); state.insert("task", "alice", state.header.scope_key, "turn-1", status);
  assert.equal(state.read().results.length, 1);
});

test("native origin reader: paid-source selector rejects over-limit dependency input", () => {
  assert.throws(() => reader.nativeMemoryOriginPaidSourcesQuery({ actor_user_id: "alice", scope_key: "scope" },
    Array.from({ length: 129 }, (_, index) => dependency(index + 1, false))), /dependency_limit/u);
});

// Structured v2 fixtures extend the existing SELECT-only fixture. They do not
// issue source frames, ledger authority, consent or native publication.
function structuredPairSelectorFixture(t, shared = false) {
  const state = pairSelectorFixture(t, shared), { db, insert, stamp, deadline } = state;
  db.exec("CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT,visibility TEXT,source_event_id TEXT,created_at TEXT)");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN classification TEXT");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN policy_version INTEGER");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN created_at TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN user_event_id TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN user_content_id TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN actor_user_id TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN scope_key TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN turn_id TEXT");
  db.exec("CREATE TABLE memory_structured_answer_origins(origin_id TEXT,user_event_id TEXT,user_content_id TEXT,answer_event_id TEXT,answer_content_id TEXT,manifest_content_ref TEXT,actor_user_id TEXT,scope_key TEXT,turn_id TEXT)");
  db.prepare("UPDATE events SET payload=json_set(payload,'$.memory_origin_version',2) WHERE event_id='own-answer'").run();
  const header = { ...state.header, manifest_content_ref: "manifest-private", manifest_sha256: "b".repeat(64),
    manifest_expires_at: deadline, created_at: stamp, source_head: 20 };
  const manifestText = JSON.stringify({ fixture: "selector-only manifest 文書" });
  insert("private_content", { content_id: header.manifest_content_ref, owner_id: "alice", kind: "memory-structured-origin",
    content: manifestText, created_at: stamp, expires_at: deadline, redacted_at: null });
  if (shared) for (const contentId of [header.user_content_id, header.answer_content_id, header.manifest_content_ref]) {
    insert("project_resource_scopes", { resource_kind: "content", resource_id: contentId, project_access_id: "access",
      organization_id: "org", project_id: "project", owner_user_id: "owner", actor_user_id: "alice", visibility: "actor_private",
      source_event_id: null, created_at: stamp });
    insert("private_content_retention_scopes", { content_id: contentId, organization_id: "org", project_access_id: "access",
      project_id: "project", actor_user_id: "alice", assigned_expires_at: deadline, classification: "transient-private",
      policy_version: 1, created_at: stamp });
  }
  const query = reader.nativeStructuredMemoryOriginPairQuery(header, { sql: "turn.status='completed'", bindings: [] });
  assert.equal((query.sql.match(/\?/gu) ?? []).length, query.bindings.length);
  const read = () => db.prepare(query.sql).all(...query.bindings);
  return { ...state, header, query, read, manifestText };
}

for (const shared of [false, true]) {
  const label = shared ? "shared" : "personal";
  test("native structured origin reader: exact " + label + " selector retains the third private manifest", t => {
    const state = structuredPairSelectorFixture(t, shared), rows = state.read();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_text, "Original user message");
    assert.equal(rows[0].answer_text, "Original answer");
    assert.equal(rows[0].manifest_text, state.manifestText);
    assert.equal(rows[0].manifest_expires_at, state.header.manifest_expires_at);
    assert.ok(state.query.bindings.length <= 99);
    assert.ok(state.query.sql.length <= 90_000);
  });
  for (const [name, sql] of [
    ["absent manifest", "DELETE FROM private_content WHERE content_id='manifest-private'"],
    ["wrong manifest kind", "UPDATE private_content SET kind='memory-structured-ledger' WHERE content_id='manifest-private'"],
    ["foreign manifest owner", "UPDATE private_content SET owner_id='bob' WHERE content_id='manifest-private'"],
    ["redacted manifest", "UPDATE private_content SET redacted_at=created_at WHERE content_id='manifest-private'"],
    ["shortened manifest expiry", "UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id='manifest-private'"],
    ["reassigned manifest expiry", "UPDATE private_content SET expires_at='2099-01-01T00:00:00.000Z' WHERE content_id='manifest-private'"],
    ["changed manifest creation", "UPDATE private_content SET created_at='2020-01-01T00:00:00.000Z' WHERE content_id='manifest-private'"],
    ["v1 marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',1) WHERE event_id='own-answer'"],
    ["missing marker", "UPDATE events SET payload=json_remove(payload,'$.memory_origin_version') WHERE event_id='own-answer'"],
    ["string marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version','2') WHERE event_id='own-answer'"],
    ["real-valued marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',json('2.0')) WHERE event_id='own-answer'"],
    ["null marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',NULL) WHERE event_id='own-answer'"],
    ["boolean marker", "UPDATE events SET payload=json_set(payload,'$.memory_origin_version',json('true')) WHERE event_id='own-answer'"],
  ]) test("native structured origin reader: " + label + " selector rejects " + name, t => {
    const state = structuredPairSelectorFixture(t, shared);
    assert.equal(state.read().length, 1, "the unmodified three-body identity fixture is eligible");
    state.db.exec(sql);
    assert.deepEqual(state.read(), []);
  });
}

for (const [name, sql] of [
  ["missing manifest resource", "DELETE FROM project_resource_scopes WHERE resource_id='manifest-private'"],
  ["wrong manifest actor", "UPDATE project_resource_scopes SET actor_user_id='bob' WHERE resource_id='manifest-private'"],
  ["wrong manifest owner", "UPDATE project_resource_scopes SET owner_user_id='alice' WHERE resource_id='manifest-private'"],
  ["wrong manifest access", "UPDATE project_resource_scopes SET project_access_id='other-access' WHERE resource_id='manifest-private'"],
  ["wrong manifest visibility", "UPDATE project_resource_scopes SET visibility='project' WHERE resource_id='manifest-private'"],
  ["changed manifest source event", "UPDATE project_resource_scopes SET source_event_id='own-answer' WHERE resource_id='manifest-private'"],
  ["missing manifest retention", "DELETE FROM private_content_retention_scopes WHERE content_id='manifest-private'"],
  ["wrong retention actor", "UPDATE private_content_retention_scopes SET actor_user_id='bob' WHERE content_id='manifest-private'"],
  ["wrong retention class", "UPDATE private_content_retention_scopes SET classification='durable' WHERE content_id='manifest-private'"],
  ["invalid retention policy", "UPDATE private_content_retention_scopes SET policy_version=-1 WHERE content_id='manifest-private'"],
  ["changed retention creation", "UPDATE private_content_retention_scopes SET created_at='2020-01-01T00:00:00.000Z' WHERE content_id='manifest-private'"],
  ["expired assigned retention", "UPDATE private_content_retention_scopes SET assigned_expires_at='2020-01-01T00:00:00.000Z' WHERE content_id='manifest-private'"],
  ["missing authored resource", "DELETE FROM project_resource_scopes WHERE resource_id='user-private'"],
  ["missing answer resource", "DELETE FROM project_resource_scopes WHERE resource_id='answer-private'"],
]) test("native structured origin reader: shared three-body custody rejects " + name, t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.db.exec(sql);
  assert.deepEqual(state.read(), []);
});

for (const identity of ["user_event_id", "user_content_id", "answer_event_id", "answer_content_id"])
test("native structured origin reader: v1 claim on original " + identity + " is contradictory even with the same origin id", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.insert("memory_native_answer_origins", { origin_id: state.header.origin_id, [identity]: state.header[identity] });
  assert.deepEqual(state.read(), []);
});

test("native structured origin reader: unrelated v1 and v2 identity rows do not suppress the selected pair", t => {
  const state = structuredPairSelectorFixture(t, true);
  for (const table of ["memory_native_answer_origins", "memory_structured_answer_origins"])
    state.insert(table, { origin_id: "other-origin", user_event_id: "other-user", user_content_id: "other-user-body",
      answer_event_id: "other-answer", answer_content_id: "other-answer-body" });
  assert.equal(state.read().length, 1);
});

for (const contentId of ["user-private", "answer-private", "manifest-private"])
test("native structured origin reader: personal selector rejects foreign sidecars for " + contentId, t => {
  const state = structuredPairSelectorFixture(t);
  assert.equal(state.read().length, 1);
  state.insert("project_resource_scopes", { resource_kind: "content", resource_id: contentId, project_access_id: "foreign-access",
    organization_id: "foreign-org", project_id: "foreign-project", owner_user_id: "owner", actor_user_id: "alice",
    visibility: "actor_private", source_event_id: null, created_at: state.stamp });
  assert.deepEqual(state.read(), []);
  state.db.prepare("DELETE FROM project_resource_scopes").run();
  assert.equal(state.read().length, 1);
  state.insert("private_content_retention_scopes", { content_id: contentId, organization_id: "foreign-org",
    project_access_id: "foreign-access", project_id: "foreign-project", actor_user_id: "alice",
    assigned_expires_at: state.deadline, classification: "transient-private", policy_version: 1, created_at: state.stamp });
  assert.deepEqual(state.read(), []);
});

test("native structured origin reader: shared selector rejects duplicate custody or retention for the manifest", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.db.prepare("INSERT INTO project_resource_scopes SELECT * FROM project_resource_scopes WHERE resource_id='manifest-private'").run();
  assert.deepEqual(state.read(), []);
  state.db.prepare("DELETE FROM project_resource_scopes WHERE rowid=(SELECT MAX(rowid) FROM project_resource_scopes)").run();
  assert.equal(state.read().length, 1);
  state.db.prepare("INSERT INTO private_content_retention_scopes SELECT * FROM private_content_retention_scopes WHERE content_id='manifest-private'").run();
  assert.deepEqual(state.read(), []);
});

for (const contentId of ["user-private", "answer-private", "manifest-private"])
test("native structured origin reader: " + contentId + " has a prehydration UTF-8 byte ceiling", t => {
  const state = structuredPairSelectorFixture(t, true), update = state.db.prepare("UPDATE private_content SET content=? WHERE content_id=?");
  assert.equal(state.read().length, 1);
  // This selector checks custody and bounded bytes, not manifest semantics.
  const exact = "文".repeat(21_845) + "x";
  assert.equal(Buffer.byteLength(exact, "utf8"), 65_536);
  update.run(exact, contentId);
  assert.equal(state.read().length, 1, "the exact byte ceiling is admitted");
  update.run(exact + "x", contentId);
  assert.deepEqual(state.read(), [], "one extra byte must fail before body hydration");
  update.run("", contentId);
  assert.deepEqual(state.read(), []);
});

for (const eventId of ["own-user", "own-answer"])
test("native structured origin reader: " + eventId + " public envelope is bounded before hydration", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  const original = state.db.prepare("SELECT payload FROM events WHERE event_id=?").get(eventId).payload;
  const exact = original + " ".repeat(65_536 - Buffer.byteLength(original, "utf8"));
  assert.equal(Buffer.byteLength(exact, "utf8"), 65_536);
  state.db.prepare("UPDATE events SET payload=? WHERE event_id=?").run(exact, eventId);
  assert.equal(state.read().length, 1, "valid JSON at the exact byte ceiling remains an identity match");
  state.db.prepare("UPDATE events SET payload=? WHERE event_id=?").run(exact + " ", eventId);
  assert.deepEqual(state.read(), []);
});

for (const eventId of ["own-user", "own-answer"])
test("native structured origin reader: " + eventId + " private envelope has exact custody and bounded bytes", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.db.prepare("UPDATE events SET payload=json_set(payload,'$._private_ref',?) WHERE event_id=?").run(eventId, eventId);
  const exact = "{}" + " ".repeat(65_534);
  state.insert("event_private_payloads", { private_event_id: eventId, owner_id: "owner", project_id: "project",
    document_id: "document", private_json: exact, created_at: state.stamp, redacted_at: null });
  assert.equal(state.read().length, 1, "bounded JSON envelope joins its exact persisted custody");
  state.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(exact + " ", eventId);
  assert.deepEqual(state.read(), []);
  state.db.prepare("UPDATE event_private_payloads SET private_json=?,owner_id='alice' WHERE private_event_id=?").run(exact, eventId);
  assert.deepEqual(state.read(), [], "the acting user cannot replace shared event-envelope owner custody");
});

for (const identity of ["user_event_id", "user_content_id", "answer_event_id", "answer_content_id", "manifest_content_ref"])
test("native structured origin reader: alternate v2 origin cannot reuse " + identity, t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.insert("memory_structured_answer_origins", { origin_id: "contradictory-origin", [identity]: state.header[identity] });
  assert.deepEqual(state.read(), []);
});

test("native structured origin reader: exact expired manifest is denied independently of expiry identity drift", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  const expiredAt = "2020-01-01T00:00:00.000Z";
  state.db.prepare("UPDATE private_content SET expires_at=? WHERE content_id='manifest-private'").run(expiredAt);
  const query = reader.nativeStructuredMemoryOriginPairQuery({ ...state.header, manifest_expires_at: expiredAt },
    { sql: "turn.status='completed'", bindings: [] });
  assert.deepEqual(state.db.prepare(query.sql).all(...query.bindings), []);
});

test("native structured origin reader: current assigned retention is returned without renewing the manifest deadline", t => {
  const state = structuredPairSelectorFixture(t, true), shortened = new Date(Date.parse(state.stamp) + 30_000).toISOString();
  assert.equal(state.read().length, 1);
  state.db.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id='manifest-private'").run(shortened);
  const rows = state.read();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assigned_expires_at, shortened, "the enclosing reader must receive the stricter current retention ceiling");
  assert.equal(rows[0].manifest_expires_at, state.header.manifest_expires_at);
});

for (const [table, claimedField, ownField] of [
  ["memory_native_answer_origins", "user_content_id", "answer_content_id"],
  ["memory_native_answer_origins", "answer_content_id", "manifest_content_ref"],
  ["memory_native_answer_origins", "user_event_id", "answer_event_id"],
  ["memory_structured_answer_origins", "manifest_content_ref", "user_content_id"],
]) test("native structured origin reader: " + table + " cannot retype " + ownField + " as " + claimedField, t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.insert(table, { origin_id: "cross-role-origin", [claimedField]: state.header[ownField] });
  assert.deepEqual(state.read(), []);
});

const structuredOriginalRef = row => ({ eventId: row.eventId, sequence: row.sequence, turnId: row.turnId, role: row.role,
  contentRef: row.contentRef, contentHash: row.contentHash });

// Plain comparison data only. This helper never issues a native source frame,
// a ledger read or a publication. The composed fixture verifies those authorities.
async function structuredEvidenceFixture(shared = false) {
  const ownerId = shared ? "owner" : "alice", organizationId = shared ? "org" : null, accessId = shared ? "access" : null;
  const ledgerId = "d".repeat(64);
  const scope = { actorUserId: "alice", ownerUserId: ownerId, streamId: "creative:" + ownerId, projectId: "project",
    documentId: "document", organizationId, projectAccessId: accessId };
  const rows = [];
  for (const [index, sequence] of [2, 3, 5, 6].entries()) {
    const user = index % 2 === 0, turnId = "historical-" + Math.floor(index / 2);
    const text = (index === 0 ? "Use old route. Do not use old route. " : index === 1 ? "Acknowledged withdrawal. " : "Continue with newer route. ")
      + "文書 e" + String.fromCodePoint(0x301) + " ".repeat(4)
      + "historical context ".repeat(40) + (user ? "user" : "assistant");
    rows.push({ eventId: "original-" + sequence, sequence, turnId, role: user ? "user" : "assistant",
      actor: user ? (shared ? "user:alice" : "user") : "model:forma-chat", correlationId: "job-" + turnId,
      causationId: user ? "budget-" + turnId : "original-" + (sequence - 1), contentRef: "original-body-" + sequence,
      text, contentHash: await origin.nativeMemoryAnswerFingerprint(text), occurredAt: recorded, recordedAt: recorded, expiresAt: expires });
  }
  const references = rows.map(structuredOriginalRef);
  const annotations = [
    { itemId: "route", revision: 1, category: "proposal", operation: "assert", predecessor: null,
      source: references[0], start: 0, end: 14, text: "Use old route." },
    { itemId: "route", revision: 2, category: "proposal", operation: "withdraw", predecessor: { itemId: "route", revision: 1 },
      source: references[0], start: Array.from("Use old route. ").length, end: 36, text: "Do not use old route." },
    { itemId: "new-route", revision: 1, category: "goal", operation: "assert", predecessor: null,
      source: references[2], start: 0, end: 26, text: "Continue with newer route." },
  ];
  // Code-point spans include only the literal quote, not the following space.
  for (const annotation of annotations) annotation.end = annotation.start + Array.from(annotation.text).length;
  const priorLedger = { schemaVersion: 1, recipeVersion: "native-declared-ledger-v1", semanticCompleteness: false,
    annotations: annotations.slice(0, 2), originals: references.slice(0, 2) };
  const ledger = { ...priorLedger, annotations, originals: references };
  const bodies = [priorLedger, ledger].map(value => origin.nativeMemoryCanonical(value));
  const bodyHashes = await Promise.all(bodies.map(value => origin.nativeMemoryAnswerFingerprint(value)));
  const revisions = [0, 1].map(index => ({ origin_id: "structured-origin", ordinal: index, ledger_id: ledgerId,
    storage_revision: index + 1, predecessor_revision: index, predecessor_hash: index === 0 ? null : bodyHashes[index - 1],
    body_ref: "ledger-body-" + (index + 1), body_hash: bodyHashes[index],
    created_at: index === 0 ? "2026-09-04T10:30:00.000Z" : "2026-09-04T10:45:00.000Z", expires_at: expires }));
  const originals = await Promise.all(rows.map(async (row, index) => ({ origin_id: "structured-origin", ordinal: index,
    event_stream_id: scope.streamId, event_id: row.eventId, source_sequence: row.sequence,
    event_type: row.role === "user" ? "ChatMessageSent" : "AssistantReasoned", role: row.role, turn_id: row.turnId,
    content_id: row.contentRef, content_sha256: row.contentHash,
    projection_sha256: await origin.nativeMemoryFingerprint(origin.nativeStructuredOriginalProjection(row)),
    recorded_at: row.recordedAt, source_retention_ceiling: expires, retained_by_ledger: 1, presented_in_context: index < 2 ? 0 : 1 })));
  const publicationValidUntil = "2026-09-04T11:01:00.000Z";
  const intervals = [{ afterSequence: 1, throughSequence: 3 }, { afterSequence: 4, throughSequence: 6 }];
  // Only the comparison helper's consumed-presentation membership is modeled
  // here. Full R5 projection reconstruction is tested with genuine caller frames.
  const contextJson = origin.nativeMemoryCanonical({ recentOriginals: rows.slice(2),
    coverage: { sourceHead: 10 }, lifetime: { validUntil: publicationValidUntil } });
  const manifest = { schemaVersion: 1, recipeVersion: "native-structured-answer-origin-v1", contextJson,
    projectionOptions: { maxBytes: 16_384, specifiedMaxBytes: false }, intervals, sourceHead: 10,
    publicationValidUntil, originals: references };
  const enrollment = { ...nativeQueryFixture().e, owner_user_id: ownerId, organization_id: organizationId,
    project_access_id: accessId, cursor_sequence: 10 };
  const header = { origin_id: "structured-origin", schema_version: 1, recipe_version: "native-structured-answer-origin-v1",
    actor_user_id: "alice", owner_user_id: ownerId, organization_id: organizationId, project_access_id: accessId,
    project_id: "project", document_id: "document", scope_key: JSON.stringify([organizationId ?? "", accessId ?? "", "project", "document"]),
    turn_id: "own-turn", user_event_id: "own-user", user_content_id: "own-user-body", user_source_sequence: 11,
    user_sha256: await origin.nativeMemoryAnswerFingerprint("Current question"),
    answer_event_id: "own-answer", answer_content_id: "own-answer-body", answer_source_sequence: 12,
    answer_sha256: await origin.nativeMemoryAnswerFingerprint("Current answer"), answer_expires_at: expires,
    enrollment_id: enrollment.enrollment_id, enrollment_revision: enrollment.revision,
    permission_epoch: enrollment.permission_epoch, policy_version: enrollment.policy_version,
    enrolled_at: enrollment.enrolled_at, enrollment_expires_at: enrollment.expires_at, retention_days: enrollment.retention_days,
    source_head: 10, ledger_id: ledgerId, ledger_storage_revision: 2, ledger_body_ref: "ledger-body-2",
    ledger_body_sha256: bodyHashes[1], consumed_context_sha256: await origin.nativeMemoryAnswerFingerprint(contextJson),
    source_list_sha256: await origin.nativeMemoryFingerprint(originals), source_count: originals.length,
    ledger_history_sha256: await origin.nativeMemoryFingerprint(revisions), ledger_revision_count: revisions.length,
    manifest_content_ref: "manifest-private", manifest_sha256: await origin.nativeMemoryAnswerFingerprint(origin.nativeMemoryCanonical(manifest)),
    manifest_expires_at: expires, source_retention_ceiling: expires, created_at: created,
    status: "active", withdrawn_at: null, withdrawal_reason: null };
  const source = { scope, enrollmentId: enrollment.enrollment_id, enrollmentRevision: enrollment.revision,
    read: { status: "active", ledgerId, revision: 2, ledger, validUntil: "2026-09-04T12:01:00.000Z", expiresAt: expires },
    originals: rows, sourceHead: 14, frameCount: intervals.length };
  const sourceEvidence = { enrollment, intervals, sourceRetentionCeiling: expires,
    head: { ledger_id: ledgerId, storage_revision: 2, current_body_ref: "ledger-body-2", current_body_hash: bodyHashes[1] },
    ledgerRevisions: revisions.map((revision, index) => ({
      revision: { ledger_id: revision.ledger_id, revision: revision.storage_revision,
        predecessor_revision: revision.predecessor_revision, predecessor_hash: revision.predecessor_hash,
        body_ref: revision.body_ref, body_hash: revision.body_hash, created_at: revision.created_at, expires_at: revision.expires_at },
      body: { content_id: revision.body_ref, owner_id: "alice", kind: "memory-structured-ledger", content: bodies[index],
        created_at: revision.created_at, expires_at: expires, redacted_at: null },
    })) };
  assert.ok(origin.validateNativeStructuredOriginRows(header, originals, revisions), "comparison metadata obeys the dedicated persisted row contract");
  assert.ok(origin.validateNativeStructuredOriginManifest(origin.nativeMemoryCanonical(manifest)), "comparison manifest obeys its bounded data contract");
  return { header, originals, revisions, manifest: structuredClone(manifest), evidence: structuredClone({ source, sourceEvidence }) };
}

const structuredEvidenceMatches = state => reader.nativeStructuredMemoryOriginEvidenceMatches(
  state.header, state.originals, state.revisions, state.manifest, state.evidence);

for (const shared of [false, true])
test("native structured origin reader: complete " + (shared ? "shared" : "personal") + " comparison retains undisplayed negative history", async () => {
  const state = await structuredEvidenceFixture(shared), snapshot = structuredClone(state);
  assert.equal(await structuredEvidenceMatches(state), true);
  assert.deepEqual(state, snapshot, "pure comparison does not mutate caller data");
  assert.equal(state.originals[0].presented_in_context, 0);
  assert.equal(state.originals[0].retained_by_ledger, 1);
  assert.equal(state.evidence.source.read.ledger.annotations[1].operation, "withdraw");
  assert.equal(state.evidence.source.read.ledger.annotations[1].source.eventId, state.originals[0].event_id);
  assert.equal(state.revisions.length, 2);
  assert.ok(state.evidence.source.originals[0].text.length > 512);
  assert.notEqual(state.evidence.source.sourceHead, state.manifest.sourceHead);
  assert.notEqual(state.evidence.source.read.validUntil, state.manifest.publicationValidUntil);
});

for (const [name, mutate] of [
  ["missing older unpresented withdrawal original", state => { state.evidence.source.originals.splice(0, 1); }],
  ["reordered current originals", state => { state.evidence.source.originals.reverse(); }],
  ["forgotten retained withdrawal source", state => { state.evidence.source.read.ledger.originals.splice(0, 1); }],
  ["changed presentation membership", state => {
    const context = JSON.parse(state.manifest.contextJson); context.recentOriginals.unshift(state.evidence.source.originals[0]);
    state.manifest.contextJson = origin.nativeMemoryCanonical(context);
  }],
  ["missing older ledger revision", state => { state.evidence.sourceEvidence.ledgerRevisions.shift(); }],
  ["changed older ledger hash", state => { state.evidence.sourceEvidence.ledgerRevisions[0].revision.body_hash = "f".repeat(64); }],
  ["changed current predecessor hash", state => { state.evidence.sourceEvidence.ledgerRevisions[1].revision.predecessor_hash = "e".repeat(64); }],
  ["changed current head revision", state => { state.evidence.sourceEvidence.head.storage_revision = 3; }],
  ["changed current head body", state => { state.evidence.sourceEvidence.head.current_body_ref = "replacement-ledger-body"; }],
  ["changed current head hash", state => { state.evidence.sourceEvidence.head.current_body_hash = "e".repeat(64); }],
  ["changed read revision", state => { state.evidence.source.read.revision = 3; }],
  ["nonactive ledger", state => { state.evidence.source.read.status = "initial"; }],
  ["changed original intervals", state => { state.evidence.sourceEvidence.intervals[0].afterSequence = 0; }],
  ["changed original source head", state => { state.manifest.sourceHead = 9; }],
  ["current head before own answer", state => { state.evidence.source.sourceHead = 11; }],
  ["changed enrollment revision", state => { state.evidence.sourceEvidence.enrollment.revision = 2; }],
  ["disabled current recall", state => { state.evidence.sourceEvidence.enrollment.recall_enabled = 0; }],
  ["changed current actor custody", state => { state.evidence.sourceEvidence.enrollment.actor_user_id = "bob"; }],
  ["changed source retention policy", state => { state.evidence.sourceEvidence.enrollment.retention_days = 1; }],
  ["changed source-list digest", state => { state.header.source_list_sha256 = "f".repeat(64); }],
  ["changed ledger-history digest", state => { state.header.ledger_history_sha256 = "e".repeat(64); }],
]) test("native structured origin reader: complete evidence comparison rejects " + name, async () => {
  const state = await structuredEvidenceFixture(true);
  assert.equal(await structuredEvidenceMatches(state), true);
  mutate(state);
  assert.equal(await structuredEvidenceMatches(state), false);
});

for (const [name, mutate] of [
  ["full Unicode normalization", row => { row.text = row.text.normalize("NFC"); }],
  ["actor attribution", row => { row.actor = "user:bob"; }],
  ["original causation", row => { row.causationId = "another-budget"; }],
  ["original correlation", row => { row.correlationId = "another-job"; }],
  ["occurrence and recording timestamp agreement", row => { row.occurredAt = "2026-09-04T09:00:00.000Z"; }],
]) test("native structured origin reader: full original projection binds " + name, async () => {
  const state = await structuredEvidenceFixture();
  assert.equal(await structuredEvidenceMatches(state), true);
  mutate(state.evidence.source.originals[0]);
  assert.equal(await structuredEvidenceMatches(state), false, "matching content IDs and copied body hash do not replace the complete original projection");
});

test("native structured origin reader: standalone v2 reader rejects missing observer or forged preparation before database access", async () => {
  let databaseCalls = 0;
  const forbidden = () => { databaseCalls++; throw new Error("unexpected database call"); };
  const env = { DB: { prepare: forbidden, batch: forbidden }, FORMA_MEMORY_ENABLED: "true", FORMA_MEMORY_USER_IDS: "alice" };
  const target = { originId: "origin", turnId: "turn", answerEventId: "answer", answerContentId: "answer-body", answer: "private answer" };
  assert.equal(await reader.revalidateNativeStructuredAnswerOrigin(env, {}, target, undefined), null);
  assert.equal(await reader.revalidateNativeStructuredAnswerOrigin(env, {}, target, { observe() {}, require() {} }), null);
  const observer = { observe() {}, require() {}, before() {} };
  assert.equal(await reader.revalidateNativeStructuredAnswerOrigin(env, {}, target, observer), null);
  assert.equal(await reader.revalidateNativeStructuredAnswerOrigin(env, { principal: { userId: "alice" }, binding: {} }, target, observer), null);
  assert.equal(await reader.revalidateNativeStructuredAnswerOrigin({ ...env, FORMA_MEMORY_ENABLED: "false" },
    { principal: { userId: "alice" }, binding: {} }, target, observer), null);
  assert.equal(databaseCalls, 0, "caught database errors must not disguise an unauthorized read attempt");
});

test("native structured origin reader: copied read metadata never becomes an issued private statement channel", () => {
  let databaseCalls = 0;
  const forbidden = () => { databaseCalls++; throw new Error("unexpected database call"); }, env = { DB: { prepare: forbidden, batch: forbidden } };
  for (const read of [undefined, {}, { originId: "origin", validUntil: "2099-01-01T00:00:00.000Z" },
    Object.freeze({ originId: "origin", validUntil: "2099-01-01T00:00:00.000Z" })]) {
    assert.equal(reader.nativeStructuredMemoryOriginReadStatements(env, read), null);
    assert.equal(reader.nativeStructuredMemoryOriginReadCurrent(env, read), false);
    assert.equal(reader.nativeStructuredMemoryOriginReadMatches(env, read,
      [{ success: true, results: [{ context_source_asserted: 1 }] }]), false);
  }
  assert.equal(databaseCalls, 0, "returning null after a caught database call is not a valid private-channel denial");
});

for (const table of ["memory_native_answer_origins", "memory_structured_answer_origins"])
test("native structured origin reader: " + table + " cannot claim the same actor scope and turn with replacement identities", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.insert(table, { origin_id: "other-origin", actor_user_id: "alice", scope_key: state.header.scope_key, turn_id: "turn",
    user_event_id: "replacement-user", user_content_id: "replacement-user-body",
    answer_event_id: "replacement-answer", answer_content_id: "replacement-answer-body" });
  assert.deepEqual(state.read(), []);
});

for (const contentId of ["user-private", "answer-private", "manifest-private"])
test("native structured origin reader: an ordinary event cannot alias " + contentId, t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.insert("events", { ...state.base, event_id: "body-alias", stream_id: "creative:bob", sequence: 1,
    type: "AssistantReasoned", payload: JSON.stringify({ content_ref: contentId }) });
  assert.deepEqual(state.read(), []);
});

test("native structured origin reader: selector supports externally witnessed total v1 table absence without querying that table", t => {
  const state = structuredPairSelectorFixture(t, true);
  assert.equal(state.read().length, 1);
  state.db.exec("DROP TABLE memory_native_answer_origins");
  // false is selector data, not proof of absence. The enclosing native reader
  // must witness exact schema absence and invalidate it if the table appears.
  const query = reader.nativeStructuredMemoryOriginPairQuery(state.header, { sql: "turn.status='completed'", bindings: [] }, false);
  assert.ok(!query.sql.includes("memory_native_answer_origins"));
  assert.equal(state.db.prepare(query.sql).all(...query.bindings).length, 1);
});

import { readFileSync as structuredBoundaryReadFileSync } from "node:fs";
const { nativeMemoryAnswerExclusion: structuredBoundaryExclusion } = await import("../worker/memory-native-boundary.ts");

async function structuredBoundaryFixture(t, { schema = true, shared = false } = {}) {
  const state = pairSelectorFixture(t, shared), { db, insert, stamp, deadline } = state;
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN actor_user_id TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN scope_key TEXT");
  db.exec("ALTER TABLE memory_native_answer_origins ADD COLUMN turn_id TEXT");
  // Exact existing migration, including its real indexes/triggers. Never replace
  // native schema fingerprint results with a manufactured success or digest.
  const migration = structuredBoundaryReadFileSync(new URL("../drizzle/0033_memory_structured_answer_provenance.sql", import.meta.url), "utf8");
  if (schema) db.exec(migration);
  const data = await structuredEvidenceFixture(shared);
  const header = { ...data.header, ...state.header, created_at: stamp, enrolled_at: stamp,
    source_head: 20, source_retention_ceiling: deadline, enrollment_expires_at: deadline, manifest_expires_at: deadline };
  insert("private_content", { content_id: header.manifest_content_ref, owner_id: "alice", kind: "memory-structured-origin",
    content: "Constrained exclusion fixture; not an issued manifest", created_at: stamp, expires_at: deadline, redacted_at: null });
  for (const [id, kind] of [["ordinary-body", "chat-assistant"], ["ordinary-user", "chat-user"]])
    insert("private_content", { content_id: id, owner_id: "alice", kind, content: "Unrelated ordinary sibling",
      created_at: stamp, expires_at: deadline, redacted_at: null });
  const ownTurn = { ...db.prepare("SELECT * FROM assistant_turns").get() };
  insert("assistant_turns", { ...ownTurn, scope_key: JSON.stringify([header.organization_id ?? "", header.project_access_id ?? "", "project", "other-document"]),
    document_id: "other-document", user_content_ref: "ordinary-user", assistant_content_ref: "ordinary-body" });
  const trace = [];
  const query = (sql, bindings = []) => ({ bind(...values) { return query(sql, values); },
    async all() { trace.push(sql); return { success: true, results: db.prepare(sql).all(...bindings).map(row => ({ ...row })), meta: {} }; },
    async first() { trace.push(sql); const row = db.prepare(sql).get(...bindings); return row ? { ...row } : null; },
  });
  const env = { DB: { prepare: sql => query(sql) } };
  const input = { answerAlias: "private_content" };
  const read = (guard, options = input) => {
    const alias = options.answerAlias, turn = options.turnAlias;
    const join = turn ? " JOIN assistant_turns " + turn + " ON " + alias + ".content_id IN(" + turn + ".user_content_ref," + turn + ".assistant_content_ref)" : "";
    return db.prepare("SELECT " + alias + ".content_id AS id FROM private_content " + alias + join
      + " WHERE " + guard.sql + " ORDER BY id").all(...guard.bindings).map(row => row.id);
  };
  const ordinaryTreatment = () => {
    db.prepare("UPDATE events SET payload=json_remove(payload,'$.memory_origin_version') WHERE event_id='own-answer'").run();
    db.prepare("UPDATE private_content SET kind='chat-assistant' WHERE content_id IN('answer-private','manifest-private')").run();
  };
  // A constraint-valid persisted denial marker is enough to exclude. Missing
  // dependencies/private proof must never be interpreted as ordinary authority.
  // This is not an issued or replay-valid structured answer publication.
  const registerOrigin = () => insert("memory_structured_answer_origins", header);
  return { ...state, env, header, migration, input, read, ordinaryTreatment, registerOrigin, trace };
}

const structuredBoundaryOrdinaryIds = ["answer-private", "manifest-private", "ordinary-body", "ordinary-user", "user-private"];
const structuredBoundarySiblingIds = ["ordinary-body", "ordinary-user"];

for (const shared of [false, true])
test("native structured boundary: " + (shared ? "shared" : "personal") + " registration excludes retyped bodies after public marker removal", async t => {
  const state = await structuredBoundaryFixture(t, { shared });
  state.ordinaryTreatment();
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)), structuredBoundaryOrdinaryIds);
  state.registerOrigin();
  const guard = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(guard), structuredBoundarySiblingIds, "all three registered bodies remain excluded and unrelated same-actor content survives");
  assert.equal(state.db.prepare("SELECT COUNT(*) AS count FROM memory_structured_answer_origins").get().count, 1);
  assert.ok(state.trace.length > 0 && state.trace.every(sql => /^(?:SELECT|WITH)\b/u.test(sql.trim())), "helper schema discovery remains read-only");
});

for (const [answerAlias, turnAlias] of [["private_content", undefined], ["answer", "turn"], ["authored", "prior"], ["content", "metadata"]])
test("native structured boundary: " + answerAlias + "/" + (turnAlias ?? "linked-turn") + " excludes repointed registered turns without widening scope", async t => {
  const state = await structuredBoundaryFixture(t, { shared: true }), input = { answerAlias, ...(turnAlias ? { turnAlias } : {}) };
  state.ordinaryTreatment();
  const originalAllowed = turnAlias ? ["answer-private", "ordinary-body", "ordinary-user", "user-private"] : structuredBoundaryOrdinaryIds;
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, input), input), originalAllowed);
  state.registerOrigin();
  for (const [id, kind] of [["replacement-user", "chat-user"], ["replacement-answer", "chat-assistant"]])
    state.insert("private_content", { content_id: id, owner_id: "alice", kind, content: "Same readable bytes cannot erase origin",
      created_at: state.stamp, expires_at: state.deadline, redacted_at: null });
  state.db.prepare("UPDATE assistant_turns SET user_content_ref='replacement-user',assistant_content_ref='replacement-answer' WHERE scope_key=?")
    .run(state.header.scope_key);
  const guard = await structuredBoundaryExclusion(state.env, input);
  assert.deepEqual(state.read(guard, input), structuredBoundarySiblingIds,
    "the other document reuses actor and turn ID, so only the exact scope binding may suppress it");
});

test("native structured boundary: captured total schema absence fails on late migration arrival before any origin exists", async t => {
  const state = await structuredBoundaryFixture(t, { schema: false });
  state.ordinaryTreatment();
  const absent = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(absent), structuredBoundaryOrdinaryIds);
  state.db.exec(state.migration);
  assert.equal(state.db.prepare("SELECT COUNT(*) AS count FROM memory_structured_answer_origins").get().count, 0);
  assert.deepEqual(state.read(absent), [], "schema arrival alone invalidates the captured absence guard");
  const present = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(present), structuredBoundaryOrdinaryIds, "a fresh exact schema check does not suppress unrelated ordinary content");
});

test("native structured boundary: unknown additive schema never becomes a permissive ordinary-content fallback", async t => {
  const state = await structuredBoundaryFixture(t);
  state.ordinaryTreatment();
  const known = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(known), structuredBoundaryOrdinaryIds);
  state.db.exec("CREATE INDEX boundary_unrecognized_index ON memory_structured_answer_origins(document_id)");
  assert.deepEqual(state.read(known), [], "the captured exact schema fingerprint no longer matches");
  await assert.rejects(structuredBoundaryExclusion(state.env, state.input), /native_structured_origin_schema_unavailable/u);
  state.db.exec("DROP INDEX boundary_unrecognized_index");
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)), structuredBoundaryOrdinaryIds);
});

test("native structured boundary: late linked-turn table arrival invalidates a captured generic-hydration guard", async t => {
  const state = await structuredBoundaryFixture(t, { shared: true });
  state.ordinaryTreatment(); state.registerOrigin();
  const turnSchema = state.db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='assistant_turns'").get().sql;
  const ownTurn = { ...state.db.prepare("SELECT * FROM assistant_turns WHERE scope_key=?").get(state.header.scope_key) };
  state.db.exec("DROP TABLE assistant_turns");
  state.insert("private_content", { content_id: "replacement-answer", owner_id: "alice", kind: "chat-assistant",
    content: "Ordinary until linked to registered provenance", created_at: state.stamp, expires_at: state.deadline, redacted_at: null });
  const absent = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(absent), ["ordinary-body", "ordinary-user", "replacement-answer"]);
  state.db.exec(turnSchema);
  state.insert("assistant_turns", { ...ownTurn, assistant_content_ref: "replacement-answer" });
  assert.deepEqual(state.read(absent), [], "the old guard cannot omit linked-turn exclusion after its supporting table appears");
  const present = await structuredBoundaryExclusion(state.env, state.input);
  assert.deepEqual(state.read(present), structuredBoundarySiblingIds, "fresh linked-turn exclusion removes the repointed body without suppressing unrelated content");
});

const structuredTombstoneRetainedFields = [
  "origin_id", "schema_version", "recipe_version", "actor_user_id", "scope_key", "turn_id",
  "user_event_id", "user_content_id", "answer_event_id", "answer_content_id", "manifest_content_ref",
  "status", "withdrawn_at", "withdrawal_reason",
];
const structuredTombstoneShape = (header, withdrawnAt, reason = "erased") => ({
  ...Object.fromEntries(Object.entries(header).map(([key, value]) => [key, structuredTombstoneRetainedFields.includes(key) ? value : null])),
  status: "minimized", withdrawn_at: withdrawnAt, withdrawal_reason: reason,
});

async function structuredMinimizedBoundaryFixture(t, { shared = false } = {}) {
  const state = await structuredBoundaryFixture(t, { shared }), { db, insert, stamp, header } = state;
  db.exec("CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT,visibility TEXT,source_event_id TEXT,created_at TEXT)");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN classification TEXT");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN policy_version INTEGER");
  db.exec("ALTER TABLE private_content_retention_scopes ADD COLUMN created_at TEXT");
  if (shared) for (const contentId of structuredBoundaryOrdinaryIds) {
    insert("project_resource_scopes", { resource_kind: "content", resource_id: contentId, project_access_id: header.project_access_id,
      organization_id: header.organization_id, project_id: header.project_id, owner_user_id: header.owner_user_id,
      actor_user_id: header.actor_user_id, visibility: "actor_private", source_event_id: null, created_at: stamp });
    insert("private_content_retention_scopes", { content_id: contentId, organization_id: header.organization_id,
      project_access_id: header.project_access_id, project_id: header.project_id, actor_user_id: header.actor_user_id,
      assigned_expires_at: state.deadline, classification: "transient-private", policy_version: 1, created_at: stamp });
  }
  const originRow = () => ({ ...db.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(header.origin_id) });
  const protectedRows = () => ({
    bodies: db.prepare("SELECT * FROM private_content WHERE content_id IN('user-private','ordinary-user','ordinary-body') ORDER BY content_id").all().map(row => ({ ...row })),
    resources: db.prepare("SELECT * FROM project_resource_scopes WHERE resource_id IN('user-private','ordinary-user','ordinary-body') ORDER BY resource_id").all().map(row => ({ ...row })),
    retentions: db.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id IN('user-private','ordinary-user','ordinary-body') ORDER BY content_id").all().map(row => ({ ...row })),
  });
  const ownedRows = () => ({
    bodies: db.prepare("SELECT * FROM private_content WHERE content_id IN('answer-private','manifest-private') ORDER BY content_id").all().map(row => ({ ...row })),
    resources: db.prepare("SELECT * FROM project_resource_scopes WHERE resource_id IN('answer-private','manifest-private') ORDER BY resource_id").all().map(row => ({ ...row })),
    retentions: db.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id IN('answer-private','manifest-private') ORDER BY content_id").all().map(row => ({ ...row })),
  });
  const minimize = () => {
    const active = originRow();
    assert.equal(active.status, "active");
    const result = db.prepare("UPDATE memory_structured_answer_origins SET status='withdrawn',withdrawn_at=?,withdrawal_reason='erased' WHERE origin_id=? AND status='active'")
      .run(stamp, header.origin_id);
    assert.equal(Number(result.changes), 1);
    const withdrawn = originRow();
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal(withdrawn.withdrawn_at, stamp);
    // Raw fixture setup obeys schema transitions. It is not the production
    // cleanup executor, a hold decision or proof that any real data was erased.
    db.prepare("DELETE FROM private_content WHERE content_id IN('answer-private','manifest-private')").run();
    db.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN('answer-private','manifest-private')").run();
    db.prepare("DELETE FROM private_content_retention_scopes WHERE content_id IN('answer-private','manifest-private')").run();
    const cleared = Object.keys(withdrawn).filter(key => !structuredTombstoneRetainedFields.includes(key));
    assert.equal(cleared.length, 31);
    const changed = db.prepare("UPDATE memory_structured_answer_origins SET status='minimized',"
      + cleared.map(key => key + "=NULL").join(",") + " WHERE origin_id=? AND status='withdrawn'").run(header.origin_id);
    assert.equal(Number(changed.changes), 1);
    return originRow();
  };
  return { ...state, originRow, protectedRows, ownedRows, minimize };
}

for (const shared of [false, true])
test("native structured tombstone: " + (shared ? "shared" : "personal") + " minimized registration retains denial after body and sidecar resurrection", async t => {
  const state = await structuredMinimizedBoundaryFixture(t, { shared });
  state.ordinaryTreatment();
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)), structuredBoundaryOrdinaryIds);
  const protectedBefore = state.protectedRows(), ownedBefore = state.ownedRows();
  assert.equal(protectedBefore.bodies.length, 3);
  assert.ok(protectedBefore.bodies.every(row => row.content.length > 0 && row.redacted_at === null));
  if (shared) assert.equal(protectedBefore.resources.length, 3, "nonempty authored and unrelated resource custody is part of the preservation oracle");
  state.registerOrigin();
  const minimized = state.minimize();
  assert.deepEqual(Object.entries(minimized).filter(([, value]) => value !== null).map(([key]) => key).sort(),
    [...structuredTombstoneRetainedFields].sort());
  assert.equal(Object.values(minimized).filter(value => value === null).length, 31);
  assert.equal(minimized.scope_key, state.header.scope_key, "the retained denial tuple still contains scope; this is not complete scope-data erasure");
  assert.ok(origin.validateNativeStructuredOriginTombstone(minimized));
  assert.deepEqual(state.ownedRows(), { bodies: [], resources: [], retentions: [] });
  assert.deepEqual(state.protectedRows(), protectedBefore, "minimizing an answer does not erase the original authored body or its resource");
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)), structuredBoundarySiblingIds);

  for (const body of ownedBefore.bodies) state.insert("private_content", { ...body, kind: "chat-assistant",
    content: "Resurrected ordinary bytes: " + body.content, redacted_at: null });
  for (const resource of ownedBefore.resources) state.insert("project_resource_scopes", resource);
  for (const retention of ownedBefore.retentions) state.insert("private_content_retention_scopes", retention);
  const resurrected = state.ownedRows();
  assert.equal(resurrected.bodies.length, 2);
  assert.ok(resurrected.bodies.every(row => row.kind === "chat-assistant" && row.content.length > 0));
  if (shared) assert.equal(resurrected.resources.length, 2);
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)), structuredBoundarySiblingIds,
    "physically present, retyped same-ID bodies stay unavailable without a public marker");
  assert.deepEqual(state.originRow(), minimized);
  assert.deepEqual(state.protectedRows(), protectedBefore);

  // An independent valid full-metadata control isolates the full-metadata decoder's
  // rejection of the minimal shape; empty or mismatched dependencies would mask it.
  const data = await structuredEvidenceFixture(shared);
  assert.ok(origin.validateNativeStructuredOriginRows(data.header, data.originals, data.revisions));
  const minimalData = structuredTombstoneShape(data.header, data.header.created_at);
  assert.ok(origin.validateNativeStructuredOriginTombstone(minimalData));
  assert.equal(origin.validateNativeStructuredOriginRows(minimalData, data.originals, data.revisions), null);
});

test("native structured tombstone: retained actor scope and turn exclude new linked bodies while preserving another document", async t => {
  const state = await structuredMinimizedBoundaryFixture(t, { shared: true });
  state.ordinaryTreatment(); state.registerOrigin();
  const protectedBefore = state.protectedRows(), minimized = state.minimize();
  for (const [contentId, kind] of [["minimized-replacement-user", "chat-user"], ["minimized-replacement-answer", "chat-assistant"]])
    state.insert("private_content", { content_id: contentId, owner_id: "alice", kind, content: "Fresh unlinked ordinary body",
      created_at: state.stamp, expires_at: state.deadline, redacted_at: null });
  assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, state.input)),
    ["minimized-replacement-answer", "minimized-replacement-user", ...structuredBoundarySiblingIds]);
  state.db.prepare("UPDATE assistant_turns SET user_content_ref='minimized-replacement-user',assistant_content_ref='minimized-replacement-answer' WHERE scope_key=?")
    .run(state.header.scope_key);
  for (const input of [state.input, { answerAlias: "answer", turnAlias: "turn" }, { answerAlias: "authored", turnAlias: "prior" },
    { answerAlias: "content", turnAlias: "metadata" }])
    assert.deepEqual(state.read(await structuredBoundaryExclusion(state.env, input), input), structuredBoundarySiblingIds);
  assert.deepEqual(state.originRow(), minimized);
  assert.deepEqual(state.protectedRows(), protectedBefore);
});

test("native structured tombstone: schema prohibits shortcut minimization, identity replacement and first-withdrawal changes", async t => {
  const state = await structuredMinimizedBoundaryFixture(t);
  state.ordinaryTreatment(); state.registerOrigin();
  const active = state.originRow(), direct = structuredTombstoneShape(active, state.stamp);
  assert.ok(origin.validateNativeStructuredOriginTombstone(direct), "the shortcut candidate has a valid final shape, so shape failure is not the intended oracle");
  const keys = Object.keys(direct);
  assert.throws(() => state.db.prepare("UPDATE memory_structured_answer_origins SET " + keys.map(key => key + "=?").join(",")
    + " WHERE origin_id=?").run(...keys.map(key => direct[key]), state.header.origin_id), /permits only first withdrawal and final minimization/u);
  assert.deepEqual(state.originRow(), active);
  const minimized = state.minimize();
  const originalKeys = Object.keys(state.header);
  assert.throws(() => state.db.prepare("UPDATE memory_structured_answer_origins SET " + originalKeys.map(key => key + "=?").join(",")
    + " WHERE origin_id=?").run(...originalKeys.map(key => state.header[key]), state.header.origin_id),
    /permits only first withdrawal and final minimization/u);
  assert.deepEqual(state.originRow(), minimized, "a complete formerly valid active shape cannot reactivate a minimized origin");
  for (const sql of [
    "UPDATE memory_structured_answer_origins SET status='withdrawn'",
    "UPDATE memory_structured_answer_origins SET answer_content_id='replacement-identity'",
    "UPDATE memory_structured_answer_origins SET withdrawn_at='2099-01-01T00:00:00.000Z'",
    "UPDATE memory_structured_answer_origins SET withdrawal_reason='manual'",
    "DELETE FROM memory_structured_answer_origins",
  ]) {
    assert.throws(() => state.db.exec(sql), /structured answer origin/u);
    assert.deepEqual(state.originRow(), minimized);
  }
  assert.throws(() => state.db.prepare("INSERT OR REPLACE INTO memory_structured_answer_origins("
    + originalKeys.join(",") + ") VALUES(" + originalKeys.map(() => "?").join(",") + ")")
    .run(...originalKeys.map(key => state.header[key])), /requires new active identities/u);
  assert.deepEqual(state.originRow(), minimized);
});
