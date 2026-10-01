import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { nativeMemoryCanonical, nativeMemoryFingerprint, nativeMemoryAnswerFingerprint, nativeMemoryExcerpt,
  nativeMemorySourceProjection, captureNativeMemoryOrigin, nativeMemoryOriginCapture, prepareNativeMemoryOrigin,
  nativeMemoryOriginWithdrawal, nativeMemoryOriginPaidSourcesQuery, nativeMemoryOriginAncestryQuery, nativeMemoryOriginSourceExclusion,
  validateNativeMemoryOriginRows } from "../worker/memory-native-origin.ts";

function captureFixture() {
  const now = Date.now(), iso = n => new Date(n).toISOString();
  const enrollment = { enrollment_id: "e", actor_user_id: "actor", owner_user_id: "actor", organization_id: null,
    project_access_id: null, project_id: "project", document_id: "document", revision: 1, policy_version: "personal-memory-v2",
    permission_epoch: "epoch", enrolled_at: iso(now - 60_000), expires_at: iso(now + 3_600_000), retention_days: 1, cursor_sequence: 2 };
  const source = { event_stream_id: "creative:actor", event_id: "source", sequence: 2, type: "AssistantReasoned",
    recorded_at: iso(now - 1000), source_actor: "user:actor", source_client_id: "web:assistant",
    source_memory_origin_version: null,
    source_correlation_id: "actor:old", source_causation_id: "old-user-event", block_id: null, turn_id: "old",
    user_content_id: "old-user", assistant_content_id: "old-answer", user_text: "original user", assistant_text: "original answer",
    valid_until: iso(now + 600_000), segment: null };
  const value = { mode: "native-document-reference-memory", treatment: "untrusted-historical-evidence", inferredPreferences: false,
    scope: { organizationId: null, projectAccessId: null, projectId: "project", documentId: "document" },
    lifetime: { checkedAt: iso(now), validUntil: iso(now + 60_000) }, actions: [], conversationPairs: [{ eventId: "source", turnId: "old",
      sequence: 2, recordedAt: source.recorded_at, user: source.user_text, assistant: source.assistant_text, validUntil: source.valid_until }] };
  return { value, source, enrollment, scopeKey: JSON.stringify(["", "", "project", "document"]) };
}

test("native origin primitives: canonical fingerprints own exact UTF8 values and role excerpts", async () => {
  assert.equal(nativeMemoryCanonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(await nativeMemoryFingerprint({ b: 2, a: 1 }), await nativeMemoryFingerprint({ a: 1, b: 2 }));
  assert.notEqual(await nativeMemoryAnswerFingerprint("é"), await nativeMemoryAnswerFingerprint("e\u0301"));
  assert.equal(Buffer.byteLength(nativeMemoryExcerpt("😀".repeat(129))), 512);
  assert.throws(() => nativeMemoryCanonical({ x: undefined }));
  await assert.rejects(nativeMemoryAnswerFingerprint("x".repeat(65537)));
  await assert.rejects(nativeMemoryAnswerFingerprint("\ud800"));
});

test("native origin primitives: exact source role and causation identities affect projection digest", async () => {
  const { source } = captureFixture(), original = await nativeMemoryFingerprint(nativeMemorySourceProjection(source));
  for (const key of ["event_id", "user_content_id", "assistant_content_id", "source_actor", "source_client_id", "source_correlation_id", "source_causation_id"])
    assert.notEqual(await nativeMemoryFingerprint(nativeMemorySourceProjection({ ...source, [key]: "changed" })), original, key);
  assert.equal(await nativeMemoryFingerprint(nativeMemorySourceProjection({ ...source, valid_until: "later" })), original);
  for (const marker of [0, 1, 2, "1", {}, undefined]) assert.throws(() => nativeMemorySourceProjection({ ...source, source_memory_origin_version: marker }));
});

test("native origin primitives: capture is exact identity, detached, bounded and distinct from source retention", async () => {
  const f = captureFixture(); assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source] }), true);
  const held = await nativeMemoryOriginCapture(f.value); assert.ok(held);
  assert.equal(held.sourceRetentionCeiling, f.source.valid_until); assert.notEqual(held.sourceRetentionCeiling, held.freshUntil);
  assert.equal(await nativeMemoryOriginCapture(structuredClone(f.value)), null);
  held.enrollment.revision++; assert.equal((await nativeMemoryOriginCapture(f.value)).enrollment.revision, 1);
  f.value.conversationPairs[0].assistant = "replaced"; assert.equal(await nativeMemoryOriginCapture(f.value), null);
});

test("native origin primitives: partial segment membership cannot authorize a surviving excerpt", async () => {
  const f = captureFixture(), second = { ...f.source, event_id: "source2", sequence: 3, turn_id: "old2",
    user_content_id: "user2", assistant_content_id: "answer2" };
  f.enrollment.cursor_sequence = 3;
  const segment = { enrollment_id: "e", revision: 1, recipe: "live-conversation-references-v1", first_sequence: 2,
    last_sequence: 3, member_count: 2, created_at: f.value.lifetime.checkedAt, retention_ceiling: f.source.valid_until };
  f.source.segment = { ...segment, ordinal: 0 }; second.segment = { ...segment, ordinal: 1 };
  assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source] }), false);
  assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source, second] }), true);
  const capture = await nativeMemoryOriginCapture(f.value); assert.deepEqual(capture.dependencies.map(row => row.consumed), [1, 0]);
});

test("native origin primitives: publication needs real capture and rejects incomplete or unsupported identity", async () => {
  const f = captureFixture(), answer = { originId: "origin", turnId: "new", userEventId: "u", userContentId: "uc", userSourceSequence: 3,
    user: "localized user", answerEventId: "a", answerContentId: "ac", answerSourceSequence: 4, answer: "localized answer",
    createdAt: new Date().toISOString(), answerExpiresAt: f.source.valid_until };
  assert.equal(await prepareNativeMemoryOrigin(f.value, answer), null);
  assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source] }), true);
  answer.createdAt = new Date().toISOString();
  const prepared = await prepareNativeMemoryOrigin(f.value, answer); assert.ok(prepared);
  assert.equal(prepared.statements.length, 3); assert.ok(prepared.statements.every(query => query.bindings.length < 100));
  assert.equal(prepared.header.user_sha256, await nativeMemoryAnswerFingerprint(answer.user));
  assert.equal(prepared.header.answer_sha256, await nativeMemoryAnswerFingerprint(answer.answer));
  assert.equal(prepared.header.answer_expires_at, answer.answerExpiresAt);
  assert.equal(JSON.stringify(prepared.header).includes(answer.answer), false);
  assert.equal(JSON.stringify(prepared.dependencies).includes(f.source.assistant_text), false);
  assert.equal(await prepareNativeMemoryOrigin(f.value, { ...answer, userSourceSequence: 2 }), null);
  assert.equal(await prepareNativeMemoryOrigin(f.value, { ...answer, answerSourceSequence: 5 }), null);
  assert.equal(await prepareNativeMemoryOrigin(f.value, { ...answer, answerExpiresAt: undefined, expiresAt: answer.answerExpiresAt }), null);
});

test("native origin primitives: original answer expiry is immutable and distinct from the source retention ceiling", async () => {
  const f = captureFixture(); assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source] }), true);
  const answerExpiresAt = new Date(Date.now() + 30_000).toISOString();
  const publication = await prepareNativeMemoryOrigin(f.value, { originId: "origin", turnId: "new", userEventId: "u", userContentId: "uc",
    userSourceSequence: 3, user: "user", answerEventId: "a", answerContentId: "ac", answerSourceSequence: 4, answer: "answer",
    createdAt: new Date().toISOString(), answerExpiresAt });
  assert.ok(publication);
  assert.equal(publication.header.answer_expires_at, answerExpiresAt);
  assert.equal(publication.header.source_retention_ceiling, f.source.valid_until);
  assert.ok(Date.parse(answerExpiresAt) < Date.parse(publication.header.source_retention_ceiling));
  assert.ok(validateNativeMemoryOriginRows(publication.header, publication.dependencies));
  for (const invalid of [null, undefined, "bad", publication.header.created_at,
    new Date(Date.parse(publication.header.source_retention_ceiling) + 1).toISOString()])
    assert.equal(validateNativeMemoryOriginRows({ ...publication.header, answer_expires_at: invalid }, publication.dependencies), null);
});

for (const role of ["user_content_id", "assistant_content_id"]) {
  for (const provenance of ["origin", "event"])
    test("native origin primitives: ancestry excludes " + role + " through " + provenance + " even without the other provenance", t => {
      const db = new DatabaseSync(":memory:"); t.after(() => db.close());
      db.exec("CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT); CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT)");
      const refs = { user_content_id: "user", assistant_content_id: "answer" }, query = nativeMemoryOriginAncestryQuery([refs]);
      const read = () => db.prepare(query.sql).all(...query.bindings);
      assert.deepEqual(read(), []);
      if (provenance === "origin") db.prepare("INSERT INTO memory_native_answer_origins VALUES(?,?)").run("old-origin", refs[role]);
      else db.prepare("INSERT INTO events VALUES(?,?,?)").run("old-event", "AssistantReasoned",
        JSON.stringify({ memory_origin_version: 1, content_ref: refs[role] }));
      assert.deepEqual(read().map(row => ({ ...row })), [{ kind: provenance, id: "old-" + provenance, content_id: refs[role] }]);
      assert.equal(query.bindings.length, 1);
      assert.equal(query.sql.includes("private_content"), false, "role/kind changes do not remove immutable ancestry");
    });
}

test("native origin primitives: ancestry proof is bounded, owns refs, and treats every present marker fail-closed", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT); CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT)");
  const refs = [{ user_content_id: "user", assistant_content_id: "answer" }], query = nativeMemoryOriginAncestryQuery(refs);
  refs[0].user_content_id = "mutated";
  assert.deepEqual(JSON.parse(query.bindings[0]), ["answer", "user"]);
  const insert = db.prepare("INSERT INTO events VALUES(?,?,?)");
  for (const [index, marker] of [1, 0, 2, "1", true, null, {}].entries())
    insert.run("marked-" + index, "AssistantReasoned", JSON.stringify({ content_ref: "user", memory_origin_version: marker }));
  insert.run("ordinary", "AssistantReasoned", JSON.stringify({ content_ref: "user" }));
  insert.run("unrelated", "AssistantReasoned", JSON.stringify({ content_ref: "other", memory_origin_version: 1 }));
  assert.equal(db.prepare(query.sql).all(...query.bindings).length, 7);
  assert.throws(() => nativeMemoryOriginAncestryQuery(Array.from({ length: 129 }, () => refs[0])));
  assert.throws(() => nativeMemoryOriginAncestryQuery([{ user_content_id: undefined, assistant_content_id: "answer" }]));
  for (let index = 0; index < 130; index++) db.prepare("INSERT INTO memory_native_answer_origins VALUES(?,?)").run("origin-" + index, "answer");
  assert.equal(db.prepare(query.sql).all(...query.bindings).length, 129);
});

for (const present of [false, true]) for (const role of ["user", "answer"])
test("native origin primitives: public source wrapper with " + (present ? "present" : "absent") + " origins denies marked " + role, t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT)");
  if (present) db.exec("CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT)");
  const refs = [{ user_content_id: "user", assistant_content_id: "answer" }];
  const query = nativeMemoryOriginAncestryQuery(refs, present);
  const sql = "SELECT 1 AS eligible FROM (SELECT 'user' AS content_id) authored CROSS JOIN (SELECT 'answer' AS content_id) answer WHERE "
    + nativeMemoryOriginSourceExclusion(present);
  assert.equal(db.prepare(sql).all().length, 1); assert.deepEqual(db.prepare(query.sql).all(...query.bindings), []);
  db.prepare("INSERT INTO events VALUES(?,?,?)").run("derived", "AssistantReasoned", JSON.stringify({ memory_origin_version: 1, content_ref: role }));
  assert.deepEqual(db.prepare(sql).all(), []);
  assert.equal(db.prepare(query.sql).all(...query.bindings).length, 1);
  // Deleting the manifest cannot restore an eligible public source.
  if (present) { db.exec("DELETE FROM memory_native_answer_origins"); assert.deepEqual(db.prepare(sql).all(), []); }
});

test("native origin primitives: public source wrapper also denies manifest-only ancestry without a current marker", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT);CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT)");
  const sql = "SELECT 1 FROM (SELECT ? AS content_id) authored CROSS JOIN (SELECT ? AS content_id) answer WHERE " + nativeMemoryOriginSourceExclusion(true);
  db.prepare("INSERT INTO memory_native_answer_origins VALUES('origin','derived')").run();
  assert.deepEqual(db.prepare(sql).all("derived", "ordinary"), []);
  assert.deepEqual(db.prepare(sql).all("ordinary", "derived"), []);
  assert.equal(db.prepare(sql).all("ordinary-user", "ordinary-answer").length, 1);
});

test("native origin primitives: pending schema enforces immutable tombstones and exact marked inverse redaction", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../drizzle/0027_memory_native_origins.sql", import.meta.url), "utf8"));
    db.exec("CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT)");
    const f = captureFixture(); await captureNativeMemoryOrigin(f.value, { ...f, sources: [f.source] });
    const p = await prepareNativeMemoryOrigin(f.value, { originId: "origin", turnId: "new", userEventId: "u", userContentId: "uc", userSourceSequence: 3,
      user: "user", answerEventId: "a", answerContentId: "ac", answerSourceSequence: 4, answer: "answer",
      createdAt: new Date().toISOString(), answerExpiresAt: f.source.valid_until }); assert.ok(p);
    for (const q of p.statements.slice(0, 2)) db.prepare(q.sql).run(...q.bindings);
    db.prepare("INSERT INTO private_content VALUES('ac','actor','chat-assistant-memory','answer',NULL),('ordinary','actor','chat-assistant','keep',NULL)").run();
    assert.throws(() => db.exec("UPDATE memory_native_answer_origins SET user_content_id='changed'"), /immutable/);
    assert.throws(() => db.exec("UPDATE memory_native_answer_origins SET answer_expires_at='2999-01-01T00:00:00.000Z'"), /immutable/);
    assert.throws(() => db.exec("UPDATE memory_native_answer_dependencies SET consumed=0"), /immutable/);
    assert.throws(() => db.exec("DELETE FROM memory_native_answer_origins"), /withdraw_first/);
    const when = new Date().toISOString();
    for (const q of nativeMemoryOriginWithdrawal({ contentId: "old-user" }, "source-unavailable", when)) db.prepare(q.sql).run(...q.bindings);
    assert.equal(db.prepare("SELECT content FROM private_content WHERE content_id='ac'").get().content, "");
    assert.equal(db.prepare("SELECT content FROM private_content WHERE content_id='ordinary'").get().content, "keep");
    for (const q of nativeMemoryOriginWithdrawal({ originId: "origin" }, "manual", new Date(Date.now() + 1).toISOString())) db.prepare(q.sql).run(...q.bindings);
    assert.equal(db.prepare("SELECT withdrawn_at FROM memory_native_answer_origins").get().withdrawn_at, when);
    assert.throws(() => db.exec("UPDATE memory_native_answer_origins SET status='active',withdrawn_at=NULL,withdrawal_reason=NULL"), /immutable/);
  } finally { db.close(); }
});

test("native origin primitives: paid-source lookup covers unconsumed members and every task state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE assistant_specialist_tasks(task_id TEXT,actor_user_id TEXT,scope_key TEXT,turn_id TEXT,status TEXT)");
    const query = nativeMemoryOriginPaidSourcesQuery("actor", "scope", ["consumed", "unconsumed"]);
    assert.deepEqual(db.prepare(query.sql).all(...query.bindings), []);
    for (const status of ["pending", "completed", "cancelled"]) {
      db.prepare("INSERT INTO assistant_specialist_tasks VALUES(?,'actor','scope','unconsumed',?)").run(status, status);
    }
    assert.equal(db.prepare(query.sql).all(...query.bindings).length, 3);
    const foreign = nativeMemoryOriginPaidSourcesQuery("other", "scope", ["unconsumed"]);
    assert.deepEqual(db.prepare(foreign.sql).all(...foreign.bindings), []);
    assert.throws(() => nativeMemoryOriginPaidSourcesQuery("actor", "scope", Array(129).fill("turn")));
  } finally { db.close(); }
});

function inverseDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../drizzle/0027_memory_native_origins.sql", import.meta.url), "utf8"));
  db.exec(`CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT);
    CREATE TABLE memory_live_enrollments(enrollment_id TEXT PRIMARY KEY,revision INTEGER);
    CREATE TABLE memory_live_sources(enrollment_id TEXT,event_id TEXT,sequence INTEGER,expires_at TEXT);
    CREATE TABLE memory_live_conversation_segments(enrollment_id TEXT,enrollment_revision INTEGER,recipe_version TEXT,
      first_sequence INTEGER,last_sequence INTEGER,member_count INTEGER,members_json TEXT,created_at TEXT,expires_at TEXT);`);
  return db;
}
async function seedInverse(db, name, { actor = "actor", organization = null, grouped = false } = {}) {
  const f = captureFixture(), e = f.enrollment;
  e.actor_user_id = actor; e.owner_user_id = actor; e.organization_id = organization; e.project_access_id = organization ? "access-" + organization : null;
  e.enrollment_id = "enrollment-" + name; f.scopeKey = JSON.stringify([organization ?? "", e.project_access_id ?? "", e.project_id, e.document_id]);
  f.value.scope.organizationId = organization; f.value.scope.projectAccessId = e.project_access_id;
  f.source.event_stream_id = "creative:" + actor; f.source.source_actor = "user:" + actor;
  f.source.event_id += "-" + name; f.value.conversationPairs[0].eventId = f.source.event_id;
  const sources = [f.source];
  if (grouped) {
    e.cursor_sequence = 3;
    const group = { enrollment_id: e.enrollment_id, revision: 1, recipe: "live-conversation-references-v1", first_sequence: 2,
      last_sequence: 3, member_count: 2, created_at: f.value.lifetime.checkedAt, retention_ceiling: f.source.valid_until };
    f.source.segment = { ...group, ordinal: 0 };
    sources.push({ ...f.source, event_id: "hidden-" + name, sequence: 3, turn_id: "hidden-turn-" + name,
      user_content_id: "hidden-user-" + name, assistant_content_id: "hidden-answer-" + name, segment: { ...group, ordinal: 1 } });
    db.prepare("INSERT INTO memory_live_conversation_segments VALUES(?,?,?,?,?,?,?,?,?)").run(e.enrollment_id, 1, group.recipe,
      2, 3, 2, JSON.stringify(sources.map(row => ({ eventId: row.event_id, sequence: row.sequence, turnId: row.turn_id }))), group.created_at, group.retention_ceiling);
  }
  assert.equal(await captureNativeMemoryOrigin(f.value, { ...f, sources }), true);
  const p = await prepareNativeMemoryOrigin(f.value, { originId: name, turnId: "target-" + name,
    userEventId: "user-event-" + name, userContentId: "user-content-" + name, userSourceSequence: 4,
    user: "USER", answerEventId: "answer-event-" + name, answerContentId: "answer-content-" + name,
    answerSourceSequence: 5, answer: "ANSWER", createdAt: new Date().toISOString(), answerExpiresAt: f.source.valid_until });
  assert.ok(p);
  for (const q of p.statements.slice(0, 2)) db.prepare(q.sql).run(...q.bindings);
  db.prepare("INSERT INTO private_content VALUES(?,?,'chat-assistant-memory','ANSWER',NULL)").run(p.header.answer_content_id, actor);
  db.prepare("INSERT INTO memory_live_enrollments VALUES(?,1)").run(e.enrollment_id);
  for (const row of sources) db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(e.enrollment_id, row.event_id, row.sequence, row.valid_until);
  return { ...f, p, sources };
}
function applyInverse(db, selector, reason = "erased", now = new Date().toISOString()) {
  const statements = nativeMemoryOriginWithdrawal(selector, reason, now); assert.ok(statements);
  for (const q of statements) { assert.ok(q.bindings.length < 100); db.prepare(q.sql).run(...q.bindings); }
}

test("native origin withdrawal: personal-only and organization selectors cannot cross custody", async () => {
  const db = inverseDatabase();
  try {
    await seedInverse(db, "personal"); await seedInverse(db, "other-personal", { actor: "other" });
    await seedInverse(db, "org-a", { organization: "A" }); await seedInverse(db, "org-a-other", { actor: "other", organization: "A" });
    await seedInverse(db, "org-b", { organization: "B" });
    const states = () => Object.fromEntries(db.prepare("SELECT origin_id,status FROM memory_native_answer_origins ORDER BY origin_id").all().map(row => [row.origin_id, row.status]));
    applyInverse(db, { actorUserId: "actor", personalOnly: true });
    assert.deepEqual(states(), { "org-a": "active", "org-a-other": "active", "org-b": "active", "other-personal": "active", personal: "withdrawn" });
    applyInverse(db, { organizationId: "A" });
    assert.deepEqual(states(), { "org-a": "withdrawn", "org-a-other": "withdrawn", "org-b": "active", "other-personal": "active", personal: "withdrawn" });
    applyInverse(db, { actorUserId: "actor" }); assert.equal(states()["org-b"], "withdrawn"); assert.equal(states()["other-personal"], "active");
    assert.equal(nativeMemoryOriginWithdrawal({ actorUserId: "actor", personalOnly: false }, "erased", new Date().toISOString()), null);
  } finally { db.close(); }
});

test("native origin withdrawal: stale enrollment revision is a no-op across every inverse statement", async () => {
  const db = inverseDatabase();
  try {
    const f = await seedInverse(db, "revision"); db.prepare("UPDATE memory_live_enrollments SET revision=2").run();
    applyInverse(db, { enrollmentId: f.enrollment.enrollment_id, currentRevision: 1 });
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins").get().status, "active");
    assert.equal(db.prepare("SELECT content FROM private_content").get().content, "ANSWER");
    applyInverse(db, { enrollmentId: f.enrollment.enrollment_id, currentRevision: 2 });
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins").get().status, "withdrawn");
    assert.equal(db.prepare("SELECT content FROM private_content").get().content, "");
  } finally { db.close(); }
});

for (const change of ["missing reference", "changed sequence", "expired reference", "missing segment", "changed membership", "malformed membership", "retagged segment"])
test("native origin withdrawal: maintenance detects " + change + " without source prose", async () => {
  const db = inverseDatabase();
  try {
    const f = await seedInverse(db, "pruned", { grouped: true }); await seedInverse(db, "healthy");
    const selector = { enrollmentId: f.enrollment.enrollment_id, currentRevision: 1, unavailableDependencies: true };
    applyInverse(db, selector, "source-unavailable");
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins WHERE origin_id='pruned'").get().status, "active");
    if (change === "missing reference") db.prepare("DELETE FROM memory_live_sources WHERE event_id=?").run(f.sources[1].event_id);
    else if (change === "changed sequence") db.prepare("UPDATE memory_live_sources SET sequence=99 WHERE event_id=?").run(f.sources[1].event_id);
    else if (change === "expired reference") db.prepare("UPDATE memory_live_sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE event_id=?").run(f.sources[1].event_id);
    else if (change === "missing segment") db.prepare("DELETE FROM memory_live_conversation_segments").run();
    else if (change === "changed membership") db.prepare("UPDATE memory_live_conversation_segments SET members_json=json_set(members_json,'$[1].eventId','different')").run();
    else if (change === "malformed membership") db.prepare("UPDATE memory_live_conversation_segments SET members_json='not-json'").run();
    else db.prepare("UPDATE memory_live_conversation_segments SET enrollment_revision=2").run();
    applyInverse(db, selector, "source-unavailable");
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins WHERE origin_id='pruned'").get().status, "withdrawn");
    assert.equal(db.prepare("SELECT content FROM private_content WHERE content_id=?").get(f.p.header.answer_content_id).content, "");
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins WHERE origin_id='healthy'").get().status, "active");
  } finally { db.close(); }
});

test("native origin withdrawal: later transaction failure rolls back tombstone, redaction and source deletion", async () => {
  const db = inverseDatabase();
  try {
    const f = await seedInverse(db, "rollback");
    db.exec("BEGIN");
    assert.throws(() => {
      applyInverse(db, { enrollmentId: f.enrollment.enrollment_id, currentRevision: 1 });
      db.prepare("DELETE FROM memory_live_sources").run(); db.prepare("SELECT json('forced_failure')").get();
    }, /malformed JSON/u);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT status FROM memory_native_answer_origins").get().status, "active");
    assert.equal(db.prepare("SELECT content FROM private_content").get().content, "ANSWER");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_live_sources").get().n, 1);
  } finally { db.close(); }
});


// R6 structured-origin primitives. These structural fixtures are deliberately
// not native publication grants; genuine publication is covered by consumption
// and Creator caller fixtures, using actual issued context/source handles.
import { nativeStructuredOriginalProjection, validateNativeStructuredOriginRows, validateNativeStructuredOriginManifest,
  nativeStructuredOriginSchema, nativeStructuredMemoryOriginAnswerExclusion, nativeStructuredMemoryOriginCapture,
  prepareNativeStructuredMemoryOrigin, nativeStructuredMemoryOriginPublicationCurrent,
  NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS,
  validateNativeStructuredOriginTombstone, nativeStructuredOriginMinimizedCondition } from "../worker/memory-native-origin.ts";
import { registerHooks } from "node:module";

test("structured origin primitives: full Unicode original projection preserves every role and causation field", async () => {
  const original = { eventId: "original-user", sequence: 2, turnId: "turn", role: "user", actor: "user", correlationId: "correlation",
    causationId: "budget", contentRef: "user-body", text: "  " + "🙂e\u0301".repeat(180) + "\n\tend  ", contentHash: "a".repeat(64),
    occurredAt: "2026-09-01T10:00:00.000Z", recordedAt: "2026-09-01T10:00:00.000Z", expiresAt: "2026-09-20T10:00:00.000Z" };
  const projected = nativeStructuredOriginalProjection(original);
  assert.deepEqual(projected, original); assert.notEqual(projected, original);
  assert.ok(Buffer.byteLength(projected.text) > 512);
  const hash = await nativeMemoryFingerprint(projected);
  for (const [key, value] of [["role", "assistant"], ["actor", "model:forma-chat"], ["causationId", "different"],
    ["contentRef", "different"], ["text", original.text.normalize("NFC")], ["expiresAt", "2026-09-19T10:00:00.000Z"]]) {
    assert.notEqual(await nativeMemoryFingerprint(nativeStructuredOriginalProjection({ ...original, [key]: value })), hash, key);
  }
  original.text = "caller mutation"; assert.notEqual(projected.text, original.text);
  for (const changed of [{ ...projected, text: "x".repeat(16385) }, { ...projected, text: "\ud800" },
    { ...projected, extra: true }, { ...projected, occurredAt: "2026-09-01T10:00:01.000Z" }]) {
    assert.throws(() => nativeStructuredOriginalProjection(changed), /native_memory_origin_invalid/u);
  }
});

test("structured origin primitives: typed complete metadata cannot omit an older ledger revision or change roles", t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("primitive");
  const header = structuredClone(seeded.header), originals = structuredClone(seeded.originals);
  const revisions = [0, 1, 2].map(ordinal => ({ ...seeded.revision, ordinal, storage_revision: ordinal + 1, predecessor_revision: ordinal,
    predecessor_hash: ordinal ? String(ordinal).repeat(64) : null, body_ref: "revision-body-" + ordinal,
    body_hash: String(ordinal + 1).repeat(64), created_at: new Date(Date.parse(header.created_at) - (3 - ordinal) * 1000).toISOString() }));
  header.ledger_storage_revision = 3; header.ledger_revision_count = 3;
  header.ledger_body_ref = revisions[2].body_ref; header.ledger_body_sha256 = revisions[2].body_hash;
  const accepted = validateNativeStructuredOriginRows(header, originals, revisions); assert.ok(accepted);
  assert.deepEqual(accepted.ledgerRevisions, revisions); assert.notEqual(accepted.header, header);
  assert.equal(validateNativeStructuredOriginRows(header, originals, [revisions[0], revisions[2]]), null);
  assert.equal(validateNativeStructuredOriginRows(header, originals, revisions.map((row, index) => index === 2 ? { ...row, predecessor_hash: "f".repeat(64) } : row)), null);
  for (const changed of [{ ...header, recipe_version: "native-answer-origin-v1" }, { ...header, schema_version: 2 },
    { ...header, answer_source_sequence: header.source_head + 3 }, { ...header, manifest_content_ref: header.answer_content_id },
    { ...header, source_count: 1 },
    { ...header, ledger_body_sha256: "f".repeat(64) }, { ...header, unknown: true }]) {
    assert.equal(validateNativeStructuredOriginRows(changed, originals, revisions), null);
  }
  assert.equal(validateNativeStructuredOriginRows({ ...header, ledger_id: "not-a-native-ledger" }, originals,
    revisions.map(row => ({ ...row, ledger_id: "not-a-native-ledger" }))), null);
  for (const changed of [{ ...originals[1], role: "user" }, { ...originals[1], event_type: "ChatMessageSent" },
    { ...originals[1], content_id: originals[0].content_id }, { ...originals[1], retained_by_ledger: 2 }]) {
    assert.equal(validateNativeStructuredOriginRows(header, [originals[0], changed], revisions), null);
  }
});

for (const organization of [null, "organization"])
test("structured origin minimal tombstone: exact negative-only shape retains " + (organization ? "shared" : "personal") + " scope", t => {
  const f = structuredOriginLifecycleFixture(t), { header, originals, revision } = f.seed("minimal-shape", { organization });
  const retained = new Set(NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS);
  const row = Object.fromEntries(NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.map(column => [column, retained.has(column) ? header[column] : null]));
  row.status = "minimized"; row.withdrawn_at = f.now; row.withdrawal_reason = "erased";
  const accepted = validateNativeStructuredOriginTombstone(row);
  assert.deepEqual(accepted, row); assert.notEqual(accepted, row); assert.ok(Object.isFrozen(accepted));
  assert.equal(row.organization_id, null); assert.equal(JSON.parse(row.scope_key)[0], organization ?? "");
  assert.equal(validateNativeStructuredOriginRows(row, originals, [revision]), null, "a minimal negative record is not a full replay header");
  const condition = nativeStructuredOriginMinimizedCondition("origin");
  const sqlValid = value => f.db.prepare(`WITH origin AS(SELECT ${NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.map(column => "? AS " + column).join(",")})
    SELECT CASE WHEN (${condition.condition}) THEN 1 ELSE 0 END AS valid FROM origin`)
    .get(...NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.map(column => value[column]), ...condition.bindings).valid;
  assert.equal(sqlValid(row), 1);
  for (const column of NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.filter(column => !retained.has(column))) {
    const restored = { ...row, [column]: header[column] ?? "restored" };
    assert.equal(validateNativeStructuredOriginTombstone(restored), null, column);
    assert.equal(sqlValid(restored), 0, column);
  }
  for (const changed of [{ ...row, status: "withdrawn" }, { ...row, schema_version: 2 }, { ...row, recipe_version: "native-answer-origin-v1" },
    { ...row, actor_user_id: "" }, { ...row, user_event_id: row.answer_event_id }, { ...row, manifest_content_ref: row.answer_content_id },
    { ...row, withdrawn_at: null }, { ...row, withdrawn_at: "2026-09-01" },
    { ...row, withdrawn_at: "2026-02-30T00:00:00.000Z" }, { ...row, withdrawn_at: "2026-02-29T12:34:56.789Z" },
    { ...row, withdrawal_reason: "unknown" },
    { ...row, scope_key: "[" }, { ...row, scope_key: JSON.stringify(["organization", "", "project", "document"]) },
    { ...row, scope_key: '[ "", "", "project", "document" ]' }, { ...row, scope_key: JSON.stringify(["", "", "", "document"]) }]) {
    assert.equal(validateNativeStructuredOriginTombstone(changed), null);
    assert.equal(sqlValid(changed), 0);
  }
  for (const [identifier, valid] of [["🙂".repeat(120), true], ["🙂".repeat(121), false], ["x".repeat(239) + "🙂", false],
    ["a\u0000b", true], ["a\u0000" + "x".repeat(239), false]]) {
    for (const changed of [{ ...row, actor_user_id: identifier }, { ...row, scope_key: JSON.stringify(["", "", identifier, "document"]) }]) {
      assert.equal(validateNativeStructuredOriginTombstone(changed) !== null, valid, "UTF-16 identifier units include the NUL suffix");
      assert.equal(sqlValid(changed), valid ? 1 : 0, `SQL scalar scan agrees with the native UTF-16 bound (${JSON.stringify(identifier)} in ${changed.actor_user_id === identifier ? "actor_user_id" : "scope_key"})`);
    }
  }
  const leapDay = { ...row, withdrawn_at: "2024-02-29T12:34:56.789Z" };
  assert.ok(validateNativeStructuredOriginTombstone(leapDay)); assert.equal(sqlValid(leapDay), 1);
  assert.equal(validateNativeStructuredOriginTombstone({ ...row, extra: true }), null);
  const missing = { ...row }; delete missing.answer_content_id;
  assert.equal(validateNativeStructuredOriginTombstone(missing), null);
  assert.equal(validateNativeStructuredOriginTombstone({ ...row, actor_user_id: "\ud800" }), null);
  assert.throws(() => nativeStructuredOriginMinimizedCondition("origin; DELETE"), /native_memory_origin_invalid/u);
});

function structuredOriginPrimitiveManifest() {
  return { schemaVersion: 1, recipeVersion: "native-structured-answer-origin-v1", contextJson: JSON.stringify({ fixture: "not authority", quote: "🙂e\u0301" }),
    projectionOptions: { maxBytes: 16384, specifiedMaxBytes: false }, intervals: [{ afterSequence: 0, throughSequence: 2 }],
    sourceHead: 2, publicationValidUntil: "2026-09-01T12:00:00.000Z",
    originals: ["user", "assistant"].map((role, index) => ({ eventId: "source-" + role, sequence: index + 1, turnId: "turn", role,
      contentRef: "content-" + role, contentHash: "a".repeat(64) })) };
}
test("structured origin primitives: canonical manifest rejects ambiguous JSON and uncovered or oversized membership", () => {
  const manifest = structuredOriginPrimitiveManifest(), text = nativeMemoryCanonical(manifest);
  assert.deepEqual(validateNativeStructuredOriginManifest(text), manifest);
  assert.equal(validateNativeStructuredOriginManifest(text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), null);
  assert.equal(validateNativeStructuredOriginManifest(" " + text), null);
  for (const changed of [{ ...manifest, sql: "SELECT 1" }, { ...manifest, sourceHead: 1 },
    { ...manifest, intervals: [{ afterSequence: 1, throughSequence: 2 }] }, { ...manifest, originals: manifest.originals.slice(1) },
    { ...manifest, projectionOptions: { maxBytes: 16385, specifiedMaxBytes: true } },
    { ...manifest, contextJson: "x".repeat(16385) }]) {
    assert.equal(validateNativeStructuredOriginManifest(nativeMemoryCanonical(changed)), null);
  }
  assert.equal(validateNativeStructuredOriginManifest("x".repeat(65537)), null);
});

test("structured origin schema: exact additive schema and total absence are witnessed without installation", async t => {
  const f = structuredOriginLifecycleFixture(t, { schema: false }), absent = await nativeStructuredOriginSchema(f.env);
  assert.equal(absent.present, false);
  const allowed = () => f.db.prepare("SELECT CASE WHEN (" + absent.guard.condition + ") THEN 1 ELSE 0 END AS allowed").get(...absent.guard.bindings).allowed;
  assert.equal(allowed(), 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'memory_structured_answer_%'").get().n, 0);
  f.db.exec(f.migration); assert.equal(allowed(), 0);
  const present = await nativeStructuredOriginSchema(f.env); assert.equal(present.present, true);
  f.db.exec("CREATE INDEX unexpected_structured_origin_index ON memory_structured_answer_origins(document_id)");
  await assert.rejects(nativeStructuredOriginSchema(f.env), /native_structured_origin_schema_unavailable/u);
});

test("structured origin schema: DB drift remains distinct even when the caller restores the original handle", async t => {
  const f = structuredOriginLifecycleFixture(t), originalDb = f.env.DB;
  f.env.DB = { ...originalDb, prepare(sql) {
    const statement = originalDb.prepare(sql);
    return { ...statement, async all() { const result = await statement.all(); f.env.DB = originalDb; return result; } };
  } };
  let error; try { await nativeStructuredOriginSchema(f.env); } catch (caught) { error = caught; }
  assert.equal(f.env.DB, originalDb);
  assert.equal(error?.message, "native_structured_origin_schema_database_changed");
});

for (const present of [false, true])
test("structured origin cleanup exclusion: " + (present ? "present" : "absent") + " v2 schema preserves exact v1 behavior", t => {
  const f = structuredOriginLifecycleFixture(t, { schema: present });
  const run = (marker, includeMarker = true) => {
    f.db.prepare("DELETE FROM events").run();
    f.db.prepare("INSERT INTO events(event_id,stream_id,type,payload) VALUES('marked','creative:actor','AssistantReasoned',?)")
      .run(JSON.stringify({ content_ref: "ordinary-body", ...(includeMarker ? { memory_origin_version: marker } : {}) }));
    const query = nativeStructuredMemoryOriginAnswerExclusion(present);
    return f.db.prepare("SELECT CASE WHEN (" + query.sql + ") THEN 1 ELSE 0 END AS allowed FROM private_content WHERE content_id='ordinary-body'").get(...query.bindings).allowed;
  };
  f.db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES('ordinary-body','actor','chat-assistant-memory','answer',?,?,NULL)").run(f.created, f.expiry);
  assert.equal(run(undefined, false), 1); assert.equal(run(1), 1);
  for (const marker of [2, null, "1", false, 0, "unknown"]) assert.equal(run(marker), 0, JSON.stringify(marker));
  if (present) {
    const seeded = f.seed("registered");
    f.db.prepare("UPDATE events SET payload=? WHERE event_id=?").run(JSON.stringify({ memory_origin_version: 1, content_ref: seeded.header.answer_content_id }), seeded.header.answer_event_id);
    const query = nativeStructuredMemoryOriginAnswerExclusion(true);
    assert.equal(f.db.prepare("SELECT CASE WHEN (" + query.sql + ") THEN 1 ELSE 0 END AS allowed FROM private_content WHERE content_id=?").get(...query.bindings, seeded.header.answer_content_id).allowed, 0);
  }
  assert.throws(() => nativeStructuredMemoryOriginAnswerExclusion(present, "private_content; DELETE"), /native_memory_origin_invalid/u);
});

test("structured origin publication: copied or serialized context and publication data are never native authority", async () => {
  let reads = 0;
  const env = { DB: { prepare() { reads++; throw new Error("unexpected database read"); }, batch() { reads++; throw new Error("unexpected database read"); } } };
  const wrapper = Object.freeze({ context: Object.freeze({ mode: "native-document-structured-conversation" }), proof: Object.freeze(Object.create(null)) });
  const now = new Date().toISOString(), expires = new Date(Date.now() + 60000).toISOString();
  const input = { originId: "origin", turnId: "turn", userEventId: "user-event", userContentId: "user-body", userSourceSequence: 2, user: "user",
    answerEventId: "answer-event", answerContentId: "answer-body", answerSourceSequence: 3, answer: "answer",
    createdAt: now, answerExpiresAt: expires, manifestContentRef: "manifest", manifestExpiresAt: expires };
  // Reuse the neighboring native suite's extension resolver; explicitly load the
  // real context bridge so a caught import failure cannot masquerade as denial.
  const root = new URL("../", import.meta.url).href;
  const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
    const local = typeof context.parentURL === "string" && context.parentURL.startsWith(root) && !context.parentURL.includes("/node_modules/");
    return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? `${specifier}.ts` : specifier, context);
  } });
  try {
    const context = await import("../worker/memory-live-context.ts");
    assert.equal(typeof context.nativeStructuredConversationContextEvidence, "function");
    assert.equal(await context.nativeStructuredConversationContextEvidence(env, wrapper), null);
    assert.equal(await nativeStructuredMemoryOriginCapture(env, wrapper), null);
    assert.equal(await prepareNativeStructuredMemoryOrigin(env, wrapper, input), null);
    assert.equal(nativeStructuredMemoryOriginPublicationCurrent(env, wrapper, Object.freeze({ validUntil: expires, header: {}, statements: [] })), false);
    assert.equal(reads, 0);
  } finally { resolution.deregister(); }
});


// R6 structured-origin lifecycle. These are constrained persisted provenance
// fixtures, not issued publication/source proofs or provider-backed answers.
import { prepareNativeStructuredOriginWithdrawal, prepareNativeStructuredOriginRetentionStep, nativeStructuredOriginRetentionBacklog,
  nativeStructuredOriginMinimizedIntegrity,
  NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS } from "../worker/memory-native-origin.ts";

function structuredOriginLifecycleFixture(t, { schema = true } = {}) {
  const db = inverseDatabase(); t.after(() => db.close());
  db.exec(`ALTER TABLE private_content ADD COLUMN created_at TEXT; ALTER TABLE private_content ADD COLUMN expires_at TEXT;
    ALTER TABLE memory_live_enrollments ADD COLUMN recall_enabled INTEGER; ALTER TABLE memory_live_enrollments ADD COLUMN expires_at TEXT;
    CREATE TABLE memory_structured_conversation_heads(ledger_id TEXT PRIMARY KEY,storage_revision INTEGER,state TEXT,current_body_ref TEXT,current_body_hash TEXT);
    CREATE TABLE memory_structured_conversation_revisions(ledger_id TEXT,revision INTEGER,predecessor_revision INTEGER,predecessor_hash TEXT,body_ref TEXT,body_hash TEXT,created_at TEXT,expires_at TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_id TEXT,
      owner_user_id TEXT,actor_user_id TEXT,visibility TEXT,source_event_id TEXT,created_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,
      classification TEXT,policy_version INTEGER,assigned_expires_at TEXT,created_at TEXT);
    CREATE TABLE organization_retention_policies(organization_id TEXT,legal_hold INTEGER);
    CREATE TABLE organization_legal_holds(organization_id TEXT,status TEXT,scope_kind TEXT,resource_id TEXT);
    CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT,sequence INTEGER,recorded_at TEXT);`);
  const migration = readFileSync(new URL("../drizzle/0033_memory_structured_answer_provenance.sql", import.meta.url), "utf8");
  if (schema) db.exec(migration);
  const now = new Date().toISOString(), created = new Date(Date.parse(now) - 1000).toISOString(), expiry = new Date(Date.parse(now) + 600_000).toISOString();
  const query = (sql, bindings = []) => ({ sql, bindings, bind(...values) { return query(sql, values); }, async all() {
    const results = db.prepare(sql).all(...bindings).map(row => ({ ...row }));
    const changes = /^(?:UPDATE|DELETE|INSERT)\b/u.test(sql.trim()) ? Number(db.prepare("SELECT changes() AS n").get().n) : 0;
    return { success: true, results, meta: { changes } };
  } });
  const env = { DB: { prepare: sql => query(sql), async batch(statements) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.all()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const run = plan => env.DB.batch(plan.statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.bindings)));
  const rows = table => db.prepare("SELECT * FROM " + table + " ORDER BY 1,2").all().map(row => ({ ...row }));
  const insert = (table, columns, row) => db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column]));
  const body = (header, ref, kind, content) => {
    db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
      .run(ref, header.actor_user_id, kind, content, header.created_at, expiry);
    if (header.organization_id !== null) {
      db.prepare("INSERT INTO project_resource_scopes VALUES(?,'content',?,?,?,?,?,'actor_private',NULL,?)")
        .run(header.project_access_id, ref, header.organization_id, header.project_id, header.owner_user_id, header.actor_user_id, header.created_at);
      db.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,'transient-private',1,?,?)")
        .run(ref, header.organization_id, header.project_access_id, header.project_id, header.actor_user_id, expiry, header.created_at);
    }
  };
  const seed = (name, { actor = "actor", organization = null, sharedHistory = "shared", at = created } = {}) => {
    const historyKey = [actor, organization ?? "personal", sharedHistory].join(":"), ledger = Buffer.from(historyKey).toString("hex").padEnd(64, "0").slice(0, 64);
    const hash = "b".repeat(64), access = organization ? "access-" + organization : null;
    const header = { origin_id: name, schema_version: 1, recipe_version: "native-structured-answer-origin-v1", actor_user_id: actor,
      owner_user_id: organization ? "owner-" + organization : actor, organization_id: organization, project_access_id: access,
      project_id: "project", document_id: "document", scope_key: JSON.stringify([organization ?? "", access ?? "", "project", "document"]), turn_id: "turn-" + name,
      user_event_id: "user-event-" + name, user_content_id: "user-body-" + name, user_source_sequence: 3, user_sha256: hash,
      answer_event_id: "answer-event-" + name, answer_content_id: "answer-body-" + name, answer_source_sequence: 4, answer_sha256: hash, answer_expires_at: expiry,
      enrollment_id: "enrollment-" + name, enrollment_revision: 1, permission_epoch: "epoch", policy_version: "policy", enrolled_at: at,
      enrollment_expires_at: expiry, retention_days: 1, source_head: 2, ledger_id: ledger, ledger_storage_revision: 1,
      ledger_body_ref: "ledger-body-" + historyKey, ledger_body_sha256: hash, consumed_context_sha256: hash, source_list_sha256: hash, source_count: 2,
      ledger_history_sha256: hash, ledger_revision_count: 1, manifest_content_ref: "manifest-" + name, manifest_sha256: hash,
      manifest_expires_at: expiry, source_retention_ceiling: expiry, created_at: at, status: "active", withdrawn_at: null, withdrawal_reason: null };
    insert("memory_structured_answer_origins", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, header);
    const originals = ["user", "assistant"].map((role, ordinal) => ({ origin_id: name, ordinal, event_stream_id: "creative:" + header.owner_user_id,
      event_id: "original-" + role + "-" + historyKey, source_sequence: ordinal + 1, event_type: role === "user" ? "ChatMessageSent" : "AssistantReasoned",
      role, turn_id: "original-turn-" + historyKey, content_id: "original-body-" + role + "-" + historyKey,
      content_sha256: hash, projection_sha256: hash, recorded_at: at, source_retention_ceiling: expiry, retained_by_ledger: 1, presented_in_context: 1 }));
    for (const original of originals) insert("memory_structured_answer_originals", NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, original);
    const revision = { origin_id: name, ordinal: 0, ledger_id: ledger, storage_revision: 1, predecessor_revision: 0, predecessor_hash: null,
      body_ref: header.ledger_body_ref, body_hash: hash, created_at: at, expires_at: expiry };
    insert("memory_structured_answer_ledger_revisions", NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS, revision);
    for (const original of originals) {
      if (!db.prepare("SELECT 1 FROM private_content WHERE content_id=?").get(original.content_id))
        body(header, original.content_id, original.role === "user" ? "chat-user" : "chat-assistant", "native original " + original.role);
      if (!db.prepare("SELECT 1 FROM events WHERE event_id=? AND stream_id=?").get(original.event_id, original.event_stream_id))
        db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(original.event_id, original.event_stream_id, original.event_type,
          JSON.stringify({ content_ref: original.content_id, turn_id: original.turn_id }), original.source_sequence, original.recorded_at);
    }
    if (!db.prepare("SELECT 1 FROM private_content WHERE content_id=?").get(header.ledger_body_ref)) body(header, header.ledger_body_ref, "memory-structured-ledger", "retained history");
    if (!db.prepare("SELECT 1 FROM memory_structured_conversation_revisions WHERE ledger_id=? AND revision=1").get(ledger))
      db.prepare("INSERT INTO memory_structured_conversation_revisions VALUES(?,1,0,NULL,?,?,?,?)").run(ledger, header.ledger_body_ref, hash, at, expiry);
    body(header, header.user_content_id, "chat-user", "unrelated authored user remains");
    body(header, header.answer_content_id, "chat-assistant-memory", "derived answer " + name);
    body(header, header.manifest_content_ref, "memory-structured-origin", "private manifest " + name);
    db.prepare("INSERT INTO memory_live_enrollments VALUES(?,1,1,?)").run(header.enrollment_id, expiry);
    db.prepare("INSERT OR IGNORE INTO memory_structured_conversation_heads VALUES(?,1,'active',?,?)").run(ledger, header.ledger_body_ref, hash);
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(header.answer_event_id, "creative:" + header.owner_user_id, "AssistantReasoned",
      JSON.stringify({ memory_origin_version: 2, content_ref: header.answer_content_id }), header.answer_source_sequence, header.created_at);
    return { header, originals, revision };
  };
  return { db, env, now, created, expiry, migration, run, rows, seed, insert };
}

test("structured origin lifecycle: full shared dependency fanout withdraws without erasure or sibling crossing", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a", { organization: "A" }), b = f.seed("b", { organization: "A" });
  const sibling = f.seed("sibling", { actor: "other", organization: "B", sharedHistory: "different" });
  const before = f.rows("private_content"), originalBefore = f.rows("memory_structured_answer_originals"), revisionBefore = f.rows("memory_structured_answer_ledger_revisions");
  f.db.exec("DELETE FROM memory_live_enrollments;DELETE FROM memory_structured_conversation_heads");
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { eventStreamId: a.originals[0].event_stream_id, eventId: a.originals[0].event_id }, "erased", f.now);
  assert.ok(plan); assert.ok(plan.assertionIndexes.length); assert.equal(plan.acknowledge(await f.run(plan)), true);
  assert.deepEqual(f.rows("memory_structured_answer_origins").map(row => [row.origin_id, row.status]), [["a", "withdrawn"], ["b", "withdrawn"], ["sibling", "active"]]);
  assert.deepEqual(f.rows("private_content"), before); assert.deepEqual(f.rows("memory_structured_answer_originals"), originalBefore);
  assert.deepEqual(f.rows("memory_structured_answer_ledger_revisions"), revisionBefore);
  for (const query of plan.terminalAssertions) assert.deepEqual((await f.env.DB.prepare(query.sql).bind(...query.bindings).all()).results, [{ verified: 1 }]);
  assert.notEqual(a.header.answer_content_id, b.header.answer_content_id); assert.equal(sibling.header.organization_id, "B");
});

for (const selectorKind of ["actor", "personal", "organization", "enrollment", "content", "manifest", "ledger body", "ledger", "head changed"])
test("structured origin lifecycle: explicit " + selectorKind + " selector keeps immutable first withdrawal", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a"), b = f.seed("b", { organization: "A" });
  const selector = selectorKind === "actor" ? { actorUserId: "actor" } : selectorKind === "personal" ? { actorUserId: "actor", personalOnly: true }
    : selectorKind === "organization" ? { organizationId: "A" } : selectorKind === "enrollment" ? { enrollmentId: a.header.enrollment_id }
      : selectorKind === "content" ? { contentId: a.originals[0].content_id } : selectorKind === "manifest" ? { contentId: a.header.manifest_content_ref }
        : selectorKind === "ledger body" ? { ledgerBodyRef: a.revision.body_ref } : selectorKind === "ledger" ? { ledgerId: a.header.ledger_id }
          : { ledgerId: a.header.ledger_id, currentStorageRevision: 2 };
  if (selectorKind === "head changed") f.db.exec("UPDATE memory_structured_conversation_heads SET storage_revision=2");
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, selector, "manual", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true);
  const rows = f.rows("memory_structured_answer_origins"), withdrawn = rows.filter(row => row.status === "withdrawn"); assert.ok(withdrawn.length);
  assert.deepEqual(withdrawn.map(row => row.origin_id), selectorKind === "actor" ? ["a", "b"] : selectorKind === "organization" ? ["b"] : ["a"]);
  const again = await prepareNativeStructuredOriginWithdrawal(f.env, selector, "erased", new Date(Date.parse(f.now) + 1000).toISOString());
  assert.ok(again); assert.equal(again.acknowledge(await f.run(again)), true); assert.deepEqual(f.rows("memory_structured_answer_origins"), rows);
  if (selectorKind === "personal") assert.equal(rows.find(row => row.origin_id === b.header.origin_id).status, "active");
  if (selectorKind === "organization") assert.equal(rows.find(row => row.origin_id === a.header.origin_id).status, "active");
});

test("structured origin lifecycle: empty capture arrivals and stale enrollment revisions roll back atomically", async t => {
  const f = structuredOriginLifecycleFixture(t), empty = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor" }, "erased", f.now); assert.ok(empty);
  const a = f.seed("a"); await assert.rejects(f.run(empty), /malformed JSON/u);
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { enrollmentId: a.header.enrollment_id, currentRevision: 1 }, "erased", f.now); assert.ok(plan);
  f.db.exec("UPDATE memory_live_enrollments SET revision=2"); await assert.rejects(f.run(plan), /malformed JSON/u);
  assert.equal(f.rows("memory_structured_answer_origins")[0].status, "active");
  assert.equal(f.rows("private_content").filter(row => row.redacted_at !== null).length, 0);
});

test("structured origin lifecycle: complete fanout exceeds twelve origins and terminal proof survives enrollment removal", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = Array.from({ length: 13 }, (_, index) => f.seed("fanout-" + index));
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { contentId: seeded[0].originals[0].content_id }, "erased", f.now); assert.ok(plan);
  assert.equal(plan.acknowledge(await f.run(plan)), true); assert.equal(f.rows("memory_structured_answer_origins").filter(row => row.status === "withdrawn").length, 13);
  const revisionBound = await prepareNativeStructuredOriginWithdrawal(f.env, { enrollmentId: seeded[0].header.enrollment_id, currentRevision: 1 }, "erased", f.now); assert.ok(revisionBound);
  assert.equal(revisionBound.acknowledge(await f.run(revisionBound)), true);
  f.db.exec("DELETE FROM memory_live_enrollments;DELETE FROM memory_structured_conversation_heads");
  for (const query of [...plan.terminalAssertions, ...revisionBound.terminalAssertions])
    assert.deepEqual((await f.env.DB.prepare(query.sql).bind(...query.bindings).all()).results, [{ verified: 1 }]);
  assert.equal(f.rows("memory_structured_answer_originals").length, 26); assert.equal(f.rows("memory_structured_answer_ledger_revisions").length, 13);
});

test("structured origin lifecycle: unknown withdrawal acknowledgements are not terminal evidence", async t => {
  const f = structuredOriginLifecycleFixture(t); f.seed("a");
  for (const change of ["missing meta", "error", "inherited error", "missing rows", "assertion", "inherited success", "array meta", "inherited changes", "short"]) {
    const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { originId: "a" }, "erased", f.now); assert.ok(plan);
    const results = await f.run(plan), bad = structuredClone(results), write = plan.statements.findIndex(query => query.sql.startsWith("UPDATE"));
    if (change === "missing meta") delete bad[write].meta;
    else if (change === "error") bad[0].error = "unconfirmed";
    else if (change === "inherited error") Object.setPrototypeOf(bad[0], { error: "unconfirmed" });
    else if (change === "missing rows") delete bad[write].results;
    else if (change === "assertion") bad[plan.assertionIndexes[0]].results = [{ verified: 0 }];
    else if (change === "inherited success") { delete bad[0].success; Object.setPrototypeOf(bad[0], { success: true }); }
    else if (change === "array meta") bad[write].meta = Object.assign([], { changes: results[write].meta.changes });
    else if (change === "inherited changes") bad[write].meta = Object.create({ changes: results[write].meta.changes });
    else bad.pop();
    assert.equal(plan.acknowledge(bad), false, change); assert.equal(plan.acknowledge(results), false, "unknown attempt is consumed: " + change);
  }
  assert.equal(f.rows("memory_structured_answer_origins")[0].status, "withdrawn");
});

test("structured origin lifecycle: cleanup survives missing enrollment and ledger and charges one persisted unit", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a");
  f.db.exec("DELETE FROM memory_live_enrollments;DELETE FROM memory_structured_conversation_heads");
  const operations = [];
  for (let index = 0; index < 9; index++) {
    const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
    assert.equal(step.workUnits, 1); assert.equal(step.selectionKey, "a"); assert.ok(Date.parse(step.oldest) <= Date.parse(f.now));
    if (index === 0) {
      assert.throws(() => { step.selectionKey = "foreign"; }, TypeError);
      assert.throws(() => { step.statements.push({ sql: "SELECT 1", bindings: [] }); }, TypeError);
    }
    const before = f.rows("memory_structured_answer_origins")[0], count = f.rows("memory_structured_answer_originals").length + f.rows("memory_structured_answer_ledger_revisions").length;
    const results = await f.run(step); assert.equal(step.acknowledge(results), true); assert.equal(step.acknowledge(results), false);
    operations.push(f.rows("private_content").filter(row => row.redacted_at !== null).length);
    if (index === 0) assert.equal(f.rows("memory_structured_answer_origins")[0].status, "withdrawn");
    else if (index < 8) assert.deepEqual(f.rows("memory_structured_answer_origins")[0], before);
    else assert.ok(validateNativeStructuredOriginTombstone(f.rows("memory_structured_answer_origins")[0]));
    if (index < 3) assert.equal(f.rows("memory_structured_answer_originals").length + f.rows("memory_structured_answer_ledger_revisions").length, count);
    else if (index < 6) assert.equal(f.rows("memory_structured_answer_originals").length + f.rows("memory_structured_answer_ledger_revisions").length, count - 1);
    else assert.equal(f.rows("memory_structured_answer_originals").length + f.rows("memory_structured_answer_ledger_revisions").length, 0);
  }
  assert.deepEqual(operations, [0, 1, 2, 2, 2, 2, 1, 0, 0]);
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
  assert.deepEqual(await nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), { count: 0, oldest: null });
  const user = f.rows("private_content").find(row => row.content_id === a.header.user_content_id); assert.equal(user.redacted_at, null); assert.notEqual(user.content, "");
});

test("structured origin lifecycle: shared held fanout remains pending while an unrelated sibling progresses", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a", { organization: "A" }), b = f.seed("b", { organization: "A" });
  const sibling = f.seed("sibling", { organization: "B", sharedHistory: "different" });
  f.db.prepare("INSERT INTO organization_legal_holds VALUES('A','active','project',?)").run(a.header.project_access_id);
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor" }, "erased", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true);
  const heldBodies = f.rows("private_content").filter(row => [a.header.answer_content_id, a.header.manifest_content_ref, b.header.answer_content_id, b.header.manifest_content_ref].includes(row.content_id));
  for (let index = 0; index < 8; index++) { const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
    assert.equal(step.selectionKey, sibling.header.origin_id); assert.equal(step.acknowledge(await f.run(step)), true); }
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
  assert.deepEqual(f.rows("private_content").filter(row => heldBodies.some(held => held.content_id === row.content_id)), heldBodies);
  assert.equal(f.rows("memory_structured_answer_originals").length, 4); assert.equal(f.rows("memory_structured_answer_ledger_revisions").length, 2);
  f.db.exec("DELETE FROM organization_legal_holds");
  for (let index = 0; index < 16; index++) { const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step); assert.equal(step.acknowledge(await f.run(step)), true); }
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
  assert.equal(f.rows("memory_structured_answer_origins").length, 3);
});

test("structured origin lifecycle: late hold or custody drift rejects physical writes and missing sidecars do not cancel scope holds", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a", { organization: "A" });
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { originId: "a" }, "erased", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true);
  const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
  f.db.prepare("INSERT INTO organization_legal_holds VALUES('A','active','content',?)").run(a.header.answer_content_id);
  await assert.rejects(f.run(step), /malformed JSON/u); assert.equal(f.rows("private_content").find(row => row.content_id === a.header.answer_content_id).redacted_at, null);
  f.db.prepare("DELETE FROM project_resource_scopes WHERE resource_id IN(?,?)").run(a.header.answer_content_id, a.header.manifest_content_ref);
  f.db.prepare("DELETE FROM private_content_retention_scopes WHERE content_id IN(?,?)").run(a.header.answer_content_id, a.header.manifest_content_ref);
  f.db.prepare("INSERT INTO organization_legal_holds VALUES('A','active','content',?)").run(a.header.manifest_content_ref);
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
  f.db.exec("DELETE FROM organization_legal_holds");
  await assert.rejects(prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), /cleanup-unavailable/u);
  assert.equal(f.rows("memory_structured_answer_originals").length, 2);
});

test("structured origin lifecycle: post-preparation custody change rolls back body and both sidecar operations", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a", { organization: "A" });
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { originId: "a" }, "erased", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true);
  const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
  f.db.prepare("UPDATE project_resource_scopes SET actor_user_id='foreign' WHERE resource_id=?").run(a.header.answer_content_id);
  const before = [f.rows("private_content"), f.rows("project_resource_scopes"), f.rows("private_content_retention_scopes")];
  await assert.rejects(f.run(step), /malformed JSON/u);
  assert.deepEqual([f.rows("private_content"), f.rows("project_resource_scopes"), f.rows("private_content_retention_scopes")], before);
  assert.equal(f.rows("memory_structured_answer_originals").length, 2);
});

test("structured origin lifecycle: malformed oldest custody does not starve an eligible sibling or become clean empty", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a"), sibling = f.seed("b", { actor: "other", sharedHistory: "different" });
  for (const originId of [a.header.origin_id, sibling.header.origin_id]) { const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { originId }, "erased", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true); }
  f.db.prepare("UPDATE private_content SET owner_id='foreign' WHERE content_id IN(?,?)").run(a.header.answer_content_id, a.header.manifest_content_ref);
  for (let index = 0; index < 8; index++) { const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step); assert.equal(step.selectionKey, "b"); assert.equal(step.acknowledge(await f.run(step)), true); }
  await assert.rejects(prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), /cleanup-unavailable/u);
  await assert.rejects(nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), /cleanup-unavailable/u);
  assert.equal(f.rows("memory_structured_answer_originals").length, 2);
});

test("structured origin lifecycle: absent schema arrival and orphan manifest or v2 answer never certify empty cleanup", async t => {
  const f = structuredOriginLifecycleFixture(t, { schema: false });
  assert.equal(await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor", personalOnly: false }, "erased", f.now), null);
  const absent = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor" }, "erased", f.now); assert.ok(absent);
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
  f.db.exec(f.migration); await assert.rejects(f.run(absent), /malformed JSON/u);
  f.db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES('orphan','actor','memory-structured-origin','private',?,?)").run(f.created, f.expiry);
  await assert.rejects(prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), /cleanup-unavailable/u);
  f.db.exec("DELETE FROM private_content WHERE content_id='orphan'");
  f.db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES('v2','actor','chat-assistant-memory','answer',?,?)").run(f.created, f.expiry);
  f.db.prepare("INSERT INTO events(event_id,stream_id,type,payload) VALUES('v2-event','creative:actor','AssistantReasoned',?)").run(JSON.stringify({ memory_origin_version: 2, content_ref: "v2" }));
  await assert.rejects(nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), /cleanup-unavailable/u);
  f.db.exec("DELETE FROM private_content WHERE content_id='v2'");
  f.db.prepare("INSERT INTO private_content_retention_scopes VALUES('v2','A','access-A','project','actor','transient-private',1,?,?)").run(f.expiry, f.created);
  await assert.rejects(prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), /cleanup-unavailable/u);
  await assert.rejects(nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), /cleanup-unavailable/u);
  assert.equal(f.rows("private_content_retention_scopes").length, 1, "missing body does not conceal orphan custody");
});

for (const schemaPresent of [false, true]) for (const operation of ["step", "backlog"])
test("structured origin lifecycle: " + operation + " rechecks " + (schemaPresent ? "empty candidates" : "schema absence") + " before its read-only return", async t => {
  const f = structuredOriginLifecycleFixture(t, { schema: schemaPresent }); if (schemaPresent) f.seed("a");
  const batch = f.env.DB.batch, captures = []; let injected = false;
  f.env.DB.batch = async statements => {
    const verification = statements.length > 0 && statements.every(statement => statement.sql.endsWith(" END AS verified"));
    if (!injected && verification) { injected = true; if (schemaPresent) f.db.exec("UPDATE memory_live_enrollments SET revision=2"); else f.db.exec(f.migration); }
    const result = await batch(statements);
    if (schemaPresent && operation === "backlog" && !verification) captures.push({ beforeInjection: !injected, result: structuredClone(result) });
    return result;
  };
  await assert.rejects(operation === "step" ? prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now })
    : nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), /malformed JSON|cleanup-unavailable/u);
  assert.equal(injected, true);
  if (schemaPresent && operation === "backlog") {
    assert.equal(captures.length, 1);
    assert.equal(captures[0].beforeInjection, true, "initial metadata capture completed before the verification race");
    assert.deepEqual(captures[0].result.map(result => result.results), [[{ count: 0, oldest: null }], [{ stray: 0 }]]);
  }
  if (schemaPresent) { assert.equal(f.rows("memory_live_enrollments")[0].revision, 2);
    assert.equal(f.rows("memory_structured_answer_origins")[0].status, "active");
    assert.equal(f.rows("private_content").filter(row => row.redacted_at !== null).length, 0); }
});

test("structured origin lifecycle: unavailable maintenance ignores v1 sidecars and binds genuine native dependencies", async t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a");
  const selector = { enrollmentId: a.header.enrollment_id, currentRevision: 1, unavailableDependencies: true };
  f.db.exec("DELETE FROM memory_live_sources;DELETE FROM memory_live_conversation_segments");
  const healthy = await prepareNativeStructuredOriginWithdrawal(f.env, selector, "source-unavailable", f.now); assert.ok(healthy);
  assert.equal(healthy.acknowledge(await f.run(healthy)), true); assert.equal(f.rows("memory_structured_answer_origins")[0].status, "active");
  f.db.prepare("DELETE FROM events WHERE event_id=?").run(a.originals[0].event_id);
  const missing = await prepareNativeStructuredOriginWithdrawal(f.env, selector, "source-unavailable", f.now); assert.ok(missing);
  assert.equal(missing.acknowledge(await f.run(missing)), true); assert.equal(f.rows("memory_structured_answer_origins")[0].status, "withdrawn");
  assert.equal(f.rows("private_content").find(row => row.content_id === a.header.answer_content_id).redacted_at, null);
});

for (const table of ["memory_live_enrollments", "memory_structured_conversation_heads", "memory_structured_conversation_revisions"])
test("structured origin lifecycle: complete " + table + " loss retains cleanup and late arrival invalidates preparation", async t => {
  const f = structuredOriginLifecycleFixture(t); f.seed("a");
  const schema = f.db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table).sql;
  f.db.exec("DROP TABLE " + table);
  const stale = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(stale);
  f.db.exec(schema); await assert.rejects(f.run(stale), /malformed JSON/u);
  assert.equal(f.rows("memory_structured_answer_origins")[0].status, "active");
  f.db.exec("DROP TABLE " + table);
  const current = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(current);
  assert.equal(current.acknowledge(await f.run(current)), true); assert.equal(f.rows("memory_structured_answer_origins")[0].status, "withdrawn");
  const next = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(next); assert.equal(next.acknowledge(await f.run(next)), true);
});

test("structured origin lifecycle: unknown committed cleanup can be rediscovered but not re-acknowledged or recharged", async t => {
  const f = structuredOriginLifecycleFixture(t); f.seed("a");
  const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { originId: "a" }, "erased", f.now); assert.ok(plan); assert.equal(plan.acknowledge(await f.run(plan)), true);
  const first = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(first);
  const results = await f.run(first), partial = structuredClone(results); delete partial[first.assertionIndexes[0]].results;
  assert.equal(first.acknowledge(partial), false); assert.equal(first.acknowledge(results), false);
  const next = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(next); assert.equal(next.acknowledge(await f.run(next)), true);
  assert.equal(f.rows("private_content").filter(row => row.redacted_at !== null).length, 2);
  assert.equal(f.rows("memory_structured_answer_originals").length, 2);
});

test("structured origin lifecycle: replacement guards retain permanent headers and local uniqueness permits common dependencies", t => {
  const f = structuredOriginLifecycleFixture(t), a = f.seed("a"), b = f.seed("b");
  assert.equal(f.db.prepare("PRAGMA recursive_triggers").get().recursive_triggers, 0);
  const before = [f.rows("memory_structured_answer_origins"), f.rows("memory_structured_answer_originals"), f.rows("memory_structured_answer_ledger_revisions")];
  const replace = (table, columns, row) => f.db.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column]));
  assert.throws(() => replace("memory_structured_answer_origins", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, a.header), /requires new active identities/u);
  assert.throws(() => replace("memory_structured_answer_origins", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, { ...b.header, origin_id: "replacement", answer_content_id: a.header.user_content_id }), /requires new active identities/u);
  assert.throws(() => replace("memory_structured_answer_originals", NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, a.originals[0]), /active bounded origin/u);
  assert.throws(() => replace("memory_structured_answer_ledger_revisions", NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS, a.revision), /active bounded origin/u);
  assert.deepEqual([f.rows("memory_structured_answer_origins"), f.rows("memory_structured_answer_originals"), f.rows("memory_structured_answer_ledger_revisions")], before);
  assert.equal(a.originals[0].event_id, b.originals[0].event_id); assert.equal(a.revision.body_ref, b.revision.body_ref);
});

async function structuredOriginReadyToMinimize(f, seeded) {
  const withdrawal = await prepareNativeStructuredOriginWithdrawal(f.env, { originId: seeded.header.origin_id }, "erased", f.now);
  assert.ok(withdrawal); assert.equal(withdrawal.acknowledge(await f.run(withdrawal)), true);
  for (let index = 0; index < 7; index++) {
    const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
    assert.equal(step.selectionKey, seeded.header.origin_id); assert.equal(step.workUnits, 1); assert.equal(step.acknowledge(await f.run(step)), true);
  }
  const before = f.rows("memory_structured_answer_origins").find(row => row.origin_id === seeded.header.origin_id);
  assert.equal(before.status, "withdrawn");
  for (const ref of [seeded.header.answer_content_id, seeded.header.manifest_content_ref])
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM private_content WHERE content_id=?").get(ref).n, 0);
  const step = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(step);
  assert.ok(step.statements.some(query => query.sql.startsWith("UPDATE memory_structured_answer_origins SET status='minimized'")));
  return { before, step };
}

for (const organization of [null, "A"])
test("structured origin lifecycle: " + (organization ? "shared" : "personal") + " minimization retains exactly fourteen keys and survives missing public marker", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a", { organization }), { before, step } = await structuredOriginReadyToMinimize(f, seeded);
  const streams = ["creative:" + seeded.header.owner_user_id, "creative:unrelated-owner"], staleEventPlans = [];
  for (const eventStreamId of streams) {
    const plan = await prepareNativeStructuredOriginWithdrawal(f.env, { eventStreamId, eventId: seeded.header.answer_event_id }, "erased", f.now);
    assert.ok(plan); staleEventPlans.push(plan);
  }
  assert.equal(step.acknowledge(await f.run(step)), true);
  const minimal = f.rows("memory_structured_answer_origins")[0], cleared = NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.filter(column => !NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.includes(column));
  assert.equal(NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.length, 14); assert.equal(cleared.length, 31);
  for (const column of NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS) assert.equal(minimal[column], column === "status" ? "minimized" : before[column], column);
  for (const column of cleared) assert.equal(minimal[column], null, column);
  assert.ok(validateNativeStructuredOriginTombstone(minimal));
  assert.equal(f.rows("private_content").find(row => row.content_id === seeded.header.user_content_id).redacted_at, null);
  for (const [index, eventStreamId] of streams.entries()) {
    assert.equal(await prepareNativeStructuredOriginWithdrawal(f.env, { eventStreamId, eventId: seeded.header.answer_event_id }, "erased", f.now), null);
    await assert.rejects(f.run(staleEventPlans[index]), /malformed JSON/u);
    await assert.rejects(f.env.DB.batch(staleEventPlans[index].terminalAssertions.map(query => f.env.DB.prepare(query.sql).bind(...query.bindings))), /malformed JSON/u);
  }
  const unrelatedEvent = await prepareNativeStructuredOriginWithdrawal(f.env, { eventStreamId: streams[0], eventId: "unclaimed-event" }, "manual", f.now);
  assert.ok(unrelatedEvent); assert.equal(unrelatedEvent.acknowledge(await f.run(unrelatedEvent)), true);
  assert.deepEqual(f.rows("memory_structured_answer_origins")[0], minimal);
  f.db.prepare("UPDATE events SET payload=json_remove(payload,'$.memory_origin_version') WHERE event_id=?").run(seeded.header.answer_event_id);
  const exclusion = nativeStructuredMemoryOriginAnswerExclusion(true);
  assert.deepEqual(f.db.prepare(`SELECT 1 FROM (SELECT ? AS content_id) private_content WHERE ${exclusion.sql}`).all(seeded.header.answer_content_id, ...exclusion.bindings), []);
  assert.equal(f.db.prepare(`SELECT 1 FROM (SELECT ? AS content_id) private_content WHERE ${exclusion.sql}`).all("unclaimed-ordinary", ...exclusion.bindings).length, 1);
  assert.deepEqual(await nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), { count: 0, oldest: null });
});

test("structured origin lifecycle: retained scope never reclassifies minimized shared rows as personal", async t => {
  const f = structuredOriginLifecycleFixture(t), shared = f.seed("shared", { organization: "A" });
  const selectedIds = plan => {
    const terminalRowset = plan.terminalAssertions.find(query => query.sql.includes("WHERE origin_id IN(SELECT value FROM json_each(?)) ORDER BY origin_id"));
    assert.ok(terminalRowset); return JSON.parse(terminalRowset.bindings[0]);
  };
  const ready = await structuredOriginReadyToMinimize(f, shared); assert.equal(ready.step.acknowledge(await f.run(ready.step)), true);
  const minimal = f.rows("memory_structured_answer_origins")[0]; assert.equal(minimal.organization_id, null);
  f.seed("personal"); f.seed("shared-more", { organization: "A" }); f.seed("other-org", { organization: "B" });
  const personal = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor", personalOnly: true }, "manual", f.now); assert.ok(personal);
  assert.deepEqual(selectedIds(personal), ["personal"]);
  assert.equal(personal.acknowledge(await f.run(personal)), true);
  assert.deepEqual(f.rows("memory_structured_answer_origins").map(row => [row.origin_id, row.status]),
    [["other-org", "active"], ["personal", "withdrawn"], ["shared", "minimized"], ["shared-more", "active"]]);
  const organization = await prepareNativeStructuredOriginWithdrawal(f.env, { organizationId: "A" }, "manual", f.now); assert.ok(organization);
  assert.deepEqual(selectedIds(organization), ["shared", "shared-more"]);
  assert.equal(organization.acknowledge(await f.run(organization)), true);
  assert.deepEqual(f.rows("memory_structured_answer_origins").map(row => [row.origin_id, row.status]),
    [["other-org", "active"], ["personal", "withdrawn"], ["shared", "minimized"], ["shared-more", "withdrawn"]]);
  const actor = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor" }, "manual", f.now); assert.ok(actor);
  assert.equal(actor.acknowledge(await f.run(actor)), true);
  assert.deepEqual(f.rows("memory_structured_answer_origins").find(row => row.origin_id === "shared"), minimal);
  for (const query of organization.terminalAssertions) assert.deepEqual((await f.env.DB.prepare(query.sql).bind(...query.bindings).all()).results, [{ verified: 1 }]);
});

for (const scope of ["organization", "project", "content"])
test("structured origin lifecycle: late " + scope + " hold preserves the complete pre-minimization header", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a", { organization: "A" }), { before, step } = await structuredOriginReadyToMinimize(f, seeded);
  f.db.prepare("INSERT INTO organization_legal_holds VALUES('A','active',?,?)").run(scope,
    scope === "organization" ? "A" : scope === "project" ? seeded.header.project_access_id : seeded.header.answer_content_id);
  await assert.rejects(f.run(step), /malformed JSON/u);
  assert.deepEqual(f.rows("memory_structured_answer_origins")[0], before);
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
});

test("structured origin lifecycle: post-UPDATE hold proof uses captured old scope after nullable columns are cleared", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a", { organization: "A" }), { before, step } = await structuredOriginReadyToMinimize(f, seeded);
  const prepare = f.env.DB.prepare; let observedClearedScope = false;
  f.env.DB.prepare = sql => {
    const query = prepare(sql);
    return { ...query, bind(...values) { const bound = query.bind(...values); return { ...bound, async all() {
      const result = await bound.all();
      if (sql.startsWith("UPDATE memory_structured_answer_origins SET status='minimized'")) {
        const during = f.rows("memory_structured_answer_origins")[0]; observedClearedScope = during.status === "minimized" && during.organization_id === null;
        // Isolated same-transaction fault injection, not a production trigger or
        // schema bypass: the following OLD-scope assertion must roll back both.
        f.db.prepare("INSERT INTO organization_legal_holds VALUES('A','active','project',?)").run(seeded.header.project_access_id);
      }
      return result;
    } }; } };
  };
  await assert.rejects(f.run(step), /malformed JSON/u); f.env.DB.prepare = prepare;
  assert.equal(observedClearedScope, true); assert.deepEqual(f.rows("memory_structured_answer_origins")[0], before);
  assert.deepEqual(f.rows("organization_legal_holds"), []);
  const retry = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(retry); assert.equal(retry.acknowledge(await f.run(retry)), true);
});

for (const corruption of ["error", "missing-meta", "short"])
test("structured origin lifecycle: unconfirmed minimized " + corruption + " result is not replayed or charged twice", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a"), { step } = await structuredOriginReadyToMinimize(f, seeded);
  const concurrent = await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }); assert.ok(concurrent);
  const results = await f.run(step), bad = structuredClone(results), write = step.statements.findIndex(query => query.sql.startsWith("UPDATE memory_structured_answer_origins SET status='minimized'"));
  if (corruption === "error") bad[write].error = "unconfirmed"; else if (corruption === "missing-meta") delete bad[write].meta; else bad.pop();
  assert.equal(step.acknowledge(bad), false); assert.equal(step.acknowledge(results), false);
  await assert.rejects(f.run(concurrent), /malformed JSON/u);
  assert.ok(validateNativeStructuredOriginTombstone(f.rows("memory_structured_answer_origins")[0]));
  assert.equal(await prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), null);
});

for (const resurrection of ["blank answer", "manifest prose", "resource", "retention", "original dependency", "revision dependency"])
test("structured origin lifecycle: minimized " + resurrection + " resurrection is unavailable and never ordinary cleanup", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a", { organization: "A" }), { step } = await structuredOriginReadyToMinimize(f, seeded);
  assert.equal(step.acknowledge(await f.run(step)), true);
  if (resurrection === "blank answer" || resurrection === "manifest prose") {
    const answer = resurrection === "blank answer";
    f.db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,?)")
      .run(answer ? seeded.header.answer_content_id : seeded.header.manifest_content_ref, seeded.header.actor_user_id,
        answer ? "chat-assistant-memory" : "memory-structured-origin", answer ? "" : "unexpected", f.created, f.expiry, answer ? f.now : null);
  } else if (resurrection === "resource") f.db.prepare("INSERT INTO project_resource_scopes VALUES(?,'content',?,'A','project',?,'actor','actor_private',NULL,?)")
    .run(seeded.header.project_access_id, seeded.header.manifest_content_ref, seeded.header.owner_user_id, f.created);
  else if (resurrection === "retention") f.db.prepare("INSERT INTO private_content_retention_scopes VALUES(?,'A',?,'project','actor','transient-private',1,?,?)")
    .run(seeded.header.answer_content_id, seeded.header.project_access_id, f.expiry, f.created);
  else {
    const original = resurrection === "original dependency", table = original ? "memory_structured_answer_originals" : "memory_structured_answer_ledger_revisions";
    const columns = original ? NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS : NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS;
    const row = original ? seeded.originals[0] : seeded.revision, trigger = original ? "memory_structured_original_insert" : "memory_structured_origin_revision_insert";
    assert.throws(() => f.insert(table, columns, row), /active bounded origin/u);
    // Explicit owner-approved negative corruption fixture only. Ordinary native
    // insertion was just rejected. Restore the exact sole trigger before any
    // API call; this persisted row is never presented as valid native authority.
    const triggerSql = f.db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(trigger).sql;
    f.db.exec("DROP TRIGGER " + trigger); f.insert(table, columns, row); f.db.exec(triggerSql);
    assert.equal((await nativeStructuredOriginSchema(f.env)).present, true);
  }
  const tables = ["memory_structured_answer_origins", "private_content", "project_resource_scopes", "private_content_retention_scopes",
    "memory_structured_answer_originals", "memory_structured_answer_ledger_revisions"], before = tables.map(f.rows);
  const guard = nativeStructuredOriginMinimizedIntegrity();
  assert.equal(f.db.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS intact`).get(...guard.bindings).intact, 0);
  await assert.rejects(prepareNativeStructuredOriginRetentionStep(f.env, { now: f.now }), /cleanup-unavailable/u);
  await assert.rejects(nativeStructuredOriginRetentionBacklog(f.env, { now: f.now }), /cleanup-unavailable/u);
  const withdrawal = await prepareNativeStructuredOriginWithdrawal(f.env, { actorUserId: "actor" }, "erased", f.now); assert.ok(withdrawal);
  await assert.rejects(f.run(withdrawal), /malformed JSON/u);
  assert.deepEqual(tables.map(f.rows), before);
});

test("structured origin lifecycle: minimized state cannot reactivate, partially refill metadata or replace its permanent identity", async t => {
  const f = structuredOriginLifecycleFixture(t), seeded = f.seed("a"), { step } = await structuredOriginReadyToMinimize(f, seeded);
  assert.equal(step.acknowledge(await f.run(step)), true); const before = f.rows("memory_structured_answer_origins");
  for (const status of ["active", "withdrawn"]) assert.throws(() => f.db.prepare("UPDATE memory_structured_answer_origins SET status=?").run(status), /first withdrawal and final minimization|CHECK/u);
  assert.throws(() => f.db.prepare("UPDATE memory_structured_answer_origins SET ledger_body_ref='returned'").run(), /first withdrawal and final minimization|CHECK/u);
  assert.throws(() => f.db.prepare("UPDATE memory_structured_answer_origins SET scope_key='[\"\",\"\",\"other\",\"document\"]'").run(), /first withdrawal and final minimization|CHECK/u);
  assert.throws(() => f.db.prepare("DELETE FROM memory_structured_answer_origins").run(), /tombstones/u);
  const columns = NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS;
  assert.throws(() => f.db.prepare(`INSERT OR REPLACE INTO memory_structured_answer_origins(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`)
    .run(...columns.map(column => seeded.header[column])), /new active identities/u);
  assert.deepEqual(f.rows("memory_structured_answer_origins"), before);
});
