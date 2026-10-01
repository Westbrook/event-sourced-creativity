import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { DOCUMENT_VIEWS } from "../src/model/document-view-signals.ts";
import {
  nativeMemoryConsumptionQuery, nativeMemoryConsumptionSchemaQuery, nativeMemoryConsumptionValue,
} from "../worker/memory-native-consumption.ts";

const NOW = Date.now();
const at = (offset) => new Date(NOW + offset).toISOString();
const CHECKED = at(0), OUTER = at(45_000), REMEMBERED = at(60_000);
const ROW_KEYS = ["event_id", "sequence", "type", "recorded_at", "block_id", "remembered_until", "payload_json"];
const PAYLOAD_KEYS = ["document_id", "project_id", "view", "focused", "route_family", "source_surface"];

let previousFetch;
before(() => {
  previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Native consumption fixtures cannot use network providers"); };
});
after(() => { globalThis.fetch = previousFetch; });

/** Isolated SQL composition seam. This is deliberately NOT the live native
 * authentication/access query and must not be cited as hosted authorization qualification. */
function fixture(t, { shared = false } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE events(event_id TEXT PRIMARY KEY, stream_id TEXT, sequence INTEGER, type TEXT,
      actor TEXT, client_id TEXT, recorded_at TEXT, payload TEXT, compensates_event_id TEXT,
      correlation_id TEXT, causation_id TEXT);
    CREATE TABLE event_private_payloads(private_event_id TEXT, owner_id TEXT, project_id TEXT,
      document_id TEXT, private_json TEXT, redacted_at TEXT);
    CREATE TABLE memory_live_sources(enrollment_id TEXT, event_id TEXT, sequence INTEGER, expires_at TEXT);
    CREATE TABLE memory_live_enrollments(enrollment_id TEXT, actor_user_id TEXT, owner_user_id TEXT,
      organization_id TEXT, project_access_id TEXT, project_id TEXT, document_id TEXT, permission_epoch TEXT,
      policy_version TEXT, revision INTEGER, enrolled_at TEXT, expires_at TEXT, retention_days INTEGER,
      cursor_sequence INTEGER, recall_enabled INTEGER);
    CREATE TABLE project_event_scopes(event_id TEXT, source_stream_id TEXT, source_sequence INTEGER,
      organization_id TEXT, project_access_id TEXT, project_id TEXT, owner_user_id TEXT, actor_user_id TEXT);
    CREATE TABLE fixture_authority_seam(marker TEXT, owner_id TEXT, enabled INTEGER);
  `);
  const enrollment = {
    enrollment_id: "enrollment-one", actor_user_id: shared ? "user-collaborator" : "user-owner",
    owner_user_id: "user-owner", organization_id: shared ? "org-one" : null,
    project_access_id: shared ? "access-one" : null, project_id: "project-one", document_id: "document-one",
    permission_epoch: "epoch-one", policy_version: "personal-memory-v2", revision: 3,
    enrolled_at: at(-86_400_000), expires_at: at(86_400_000), retention_days: 30, cursor_sequence: 64,
  };
  const enrollmentFields = Object.keys(enrollment);
  db.prepare(`INSERT INTO memory_live_enrollments(${enrollmentFields.join(",")},recall_enabled)
    VALUES(${enrollmentFields.map(() => "?").join(",")},1)`).run(...Object.values(enrollment));
  db.prepare("INSERT INTO fixture_authority_seam VALUES(?,?,?)").run("join-marker", enrollment.owner_user_id, 1);
  const q = {
    joins: "FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id "
      + "JOIN fixture_authority_seam seam ON seam.marker=? AND seam.owner_id=?",
    condition: "seam.enabled=? AND event.stream_id=? AND ?='condition-tail'",
    bindings: ["join-marker", enrollment.owner_user_id, 1, `creative:${enrollment.owner_user_id}`, "condition-tail"],
  };
  const normalized = (fields = {}) => ({
    document_id: enrollment.document_id, project_id: enrollment.project_id, view: "document",
    focused: true, route_family: "document", source_surface: "document-view-navigation",
    actor_user_id: enrollment.actor_user_id,
    private_note: "PRIVATE PROSE MUST NEVER BE SELECTED OR RETURNED",
    ...fields,
  });
  const putScope = (event, fields = {}) => {
    const row = {
      event_id: event.eventId, source_stream_id: `creative:${enrollment.owner_user_id}`,
      source_sequence: event.sequence, organization_id: enrollment.organization_id,
      project_access_id: enrollment.project_access_id, project_id: enrollment.project_id,
      owner_user_id: enrollment.owner_user_id, actor_user_id: enrollment.actor_user_id, ...fields,
    };
    db.prepare(`INSERT INTO project_event_scopes(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`)
      .run(...Object.values(row));
  };
  const addEvent = ({ eventId = "visit-one", sequence = 10, type = "DocumentViewVisited",
    recordedAt = at(-10_000), validUntil = REMEMBERED, payload = normalized(),
    actor = `user:${enrollment.actor_user_id}`, streamId = `creative:${enrollment.owner_user_id}`,
    compensates = null, remember = true, retainPrivate = true, scope = shared } = {}) => {
    const envelope = publicEventPayload(eventId, payload);
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(eventId, streamId, sequence, type, actor, "fixture-client", recordedAt,
        JSON.stringify(envelope.payload), compensates, "fixture-correlation", null);
    if (retainPrivate && envelope.privateJson !== null) db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,NULL)")
      .run(eventId, enrollment.owner_user_id, enrollment.project_id, enrollment.document_id, envelope.privateJson);
    if (remember) db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)")
      .run(enrollment.enrollment_id, eventId, sequence, validUntil);
    const selected = { eventId, sequence, type, blockId: payload.block_id ?? null, recordedAt, validUntil };
    if (scope) putScope(selected);
    return selected;
  };
  const visit = addEvent();
  const refs = [visit];
  const query = () => nativeMemoryConsumptionQuery(enrollment, q, refs);
  const execute = (descriptor = query()) => db.prepare(descriptor.sql).all(...descriptor.bindings);
  const project = (rows = execute(), checked = CHECKED, outer = OUTER, sources = refs, authority = enrollment) =>
    nativeMemoryConsumptionValue(rows, authority, sources, checked, outer);
  const changePublic = (fields) => {
    const stored = JSON.parse(db.prepare("SELECT payload FROM events WHERE event_id=?").get(visit.eventId).payload);
    db.prepare("UPDATE events SET payload=? WHERE event_id=?").run(JSON.stringify({ ...stored, ...fields }), visit.eventId);
  };
  const changePrivate = (fields) => {
    const stored = JSON.parse(db.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(visit.eventId).private_json);
    db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?")
      .run(JSON.stringify({ ...stored, ...fields }), visit.eventId);
  };
  const replaceNormalized = (fields) => {
    const envelope = publicEventPayload(visit.eventId, normalized(fields));
    db.prepare("UPDATE events SET payload=? WHERE event_id=?").run(JSON.stringify(envelope.payload), visit.eventId);
    db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(envelope.privateJson, visit.eventId);
  };
  return { db, enrollment, q, normalized, visit, refs, putScope, addEvent, query, execute, project,
    changePublic, changePrivate, replaceNormalized };
}

test("the schema descriptor checks the required tables in an isolated database", (t) => {
  const f = fixture(t), descriptor = nativeMemoryConsumptionSchemaQuery();
  assert.equal(f.db.prepare(descriptor.sql).get(...descriptor.bindings).ready, 1);
  f.db.exec("DROP TABLE project_event_scopes");
  assert.equal(f.db.prepare(descriptor.sql).get(...descriptor.bindings).ready, 0);
});

test("query composition keeps all caller seam bindings after the two generated JSON bindings", (t) => {
  const f = fixture(t), descriptor = f.query();
  assert.deepEqual(descriptor.bindings.slice(2), f.q.bindings);
  assert.equal(JSON.parse(descriptor.bindings[0]).enrollment_id, f.enrollment.enrollment_id);
  assert.deepEqual(JSON.parse(descriptor.bindings[1]), f.refs);
  assert.equal(f.execute(descriptor).length, 1);
  f.db.exec("UPDATE fixture_authority_seam SET enabled=0");
  assert.deepEqual(f.execute(descriptor), []);
});

test("genuine private-envelope navigation becomes only an explicit visit with unknown episode and revision", (t) => {
  const f = fixture(t), rows = f.execute();
  const stored = JSON.parse(f.db.prepare("SELECT payload FROM events").get().payload);
  assert.equal(stored._private_ref, f.visit.eventId);
  assert.equal(Object.hasOwn(stored, "focused"), false);
  assert.equal(Object.hasOwn(stored, "route_family"), false);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [...ROW_KEYS].sort());
  assert.deepEqual(Object.keys(JSON.parse(rows[0].payload_json)).sort(), [...PAYLOAD_KEYS].sort());
  assert.equal(JSON.stringify(rows).includes("PRIVATE PROSE"), false);
  const result = f.project(rows);
  assert.notEqual(result, null);
  assert.equal(result.coverage.observationCount, 1);
  assert.equal(result.episodes[0].episodeId, null);
  assert.equal(result.episodes[0].resourceRevision, null);
  assert.deepEqual(result.episodes[0].observations, [{ sourceIndex: 0, kind: "visit", copiedFrom: null }]);
  assert.equal(result.attention, "not-measured");
  assert.equal(result.comprehension, "not-measured");
  assert.equal(result.inferredPreferences, false);
  assert.equal(JSON.stringify(result).includes("focused"), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE PROSE"), false);
});

test("every actual document view is supported and focused false still means only a visit", (t) => {
  const f = fixture(t);
  for (const view of DOCUMENT_VIEWS) {
    f.replaceNormalized({ view, focused: false });
    const result = f.project();
    assert.notEqual(result, null, view);
    assert.equal(result.coverage.observationCount, 1, view);
    assert.equal(result.episodes[0].observations[0].kind, "visit", view);
  }
});

test("a null payload project preserves document-bound authority without inventing a project field", (t) => {
  const f = fixture(t);
  f.replaceNormalized({ project_id: null });
  const rows = f.execute(), result = f.project(rows);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].payload_json).project_id, null);
  assert.notEqual(result, null);
  assert.equal(result.episodes[0].documentId, f.enrollment.document_id);
});

test("selected sources retain their original positions when only recorded visits qualify", (t) => {
  const f = fixture(t);
  const other = f.addEvent({ eventId: "not-a-visit", sequence: 11, type: "ObjectSaved" });
  f.refs.splice(0, 1, other, f.visit);
  const result = f.project();
  assert.notEqual(result, null);
  assert.equal(result.coverage.observationCount, 1);
  assert.equal(result.episodes[0].observations[0].sourceIndex, 1);
});

test("legacy unprivated navigation and missing, mismatched, or redacted secret envelopes are omitted", (t) => {
  const alterations = [
    (f) => f.db.exec("DELETE FROM event_private_payloads"),
    (f) => f.changePublic({ _private_ref: "another-event" }),
    (f) => f.db.exec("UPDATE event_private_payloads SET redacted_at='redacted'"),
    (f) => f.db.exec("UPDATE event_private_payloads SET owner_id='other-owner'"),
    (f) => f.db.exec("UPDATE event_private_payloads SET project_id='other-project'"),
    (f) => f.db.exec("UPDATE event_private_payloads SET document_id='other-document'"),
    (f) => f.db.prepare("UPDATE events SET payload=?").run(JSON.stringify(f.normalized())),
  ];
  for (const alter of alterations) {
    const f = fixture(t);
    alter(f);
    assert.deepEqual(f.execute(), []);
  }
});

test("all six normalized fields must agree with any public copy of the private envelope", (t) => {
  for (const [field, value] of Object.entries({
    document_id: "another-document", project_id: "another-project", view: "chat",
    focused: false, route_family: "another-route", source_surface: "another-surface",
  })) {
    const f = fixture(t);
    f.changePublic({ [field]: value });
    assert.deepEqual(f.execute(), [], field);
  }
});

test("private normalized navigation requires actual view, boolean focus, route family, and source surface", (t) => {
  for (const fields of [
    { view: "invented-view" }, { focused: "true" }, { focused: 1 }, { focused: null },
    { route_family: "another-route" }, { route_family: null },
    { source_surface: "another-surface" }, { source_surface: null },
    { document_id: "another-document" }, { project_id: "another-project" },
  ]) {
    const f = fixture(t);
    f.replaceNormalized(fields);
    assert.deepEqual(f.execute(), [], JSON.stringify(fields));
  }
});

test("malformed, duplicate-key, nonobject, and oversized retained JSON never becomes visit evidence", (t) => {
  const privateValues = ["{", "null", "[]", '{"focused":true,"focused":false}',
    JSON.stringify({ oversized: "x".repeat(16_385) })];
  for (const value of privateValues) {
    const f = fixture(t);
    f.db.prepare("UPDATE event_private_payloads SET private_json=?").run(value);
    assert.deepEqual(f.execute(), []);
  }
  const duplicate = fixture(t);
  const full = duplicate.db.prepare("SELECT private_json FROM event_private_payloads").get().private_json;
  duplicate.db.prepare("UPDATE event_private_payloads SET private_json=?").run(full.slice(0, -1) + ',"focused":false}');
  assert.deepEqual(duplicate.execute(), []);
});

test("malformed public JSON fails closed at the database read; nonobjects and duplicate keys provide no evidence", (t) => {
  for (const value of ["{", "[]", "null"]) {
    const f = fixture(t);
    f.db.prepare("UPDATE events SET payload=?").run(value);
    let rows;
    try { rows = f.execute(); } catch (error) {
      // The trusted live-source seam can use raw JSON SQL. A failed database
      // read is an error, never a certified zero-history result or fallback.
      assert.equal(value, "{");
      assert.match(error.message, /malformed JSON/u);
      continue;
    }
    assert.deepEqual(rows, []);
  }
  const f = fixture(t), publicJson = f.db.prepare("SELECT payload FROM events").get().payload;
  f.db.prepare("UPDATE events SET payload=?").run(publicJson.slice(0, -1) + ',"view":"chat"}');
  assert.deepEqual(f.execute(), []);
});

test("nested duplicate synthetic keys are rejected in public and private JSON", (t) => {
  for (const side of ["public", "private"]) {
    const f = fixture(t);
    const [table, column] = side === "public" ? ["events", "payload"] : ["event_private_payloads", "private_json"];
    const stored = f.db.prepare(`SELECT ${column} AS value FROM ${table}`).get().value;
    f.db.prepare(`UPDATE ${table} SET ${column}=?`)
      .run(stored.slice(0, -1) + ',"origin":{"synthetic":false,"synthetic":true}}');
    assert.deepEqual(f.execute(), [], side);
  }
});

test("synthetic and alternate-data markers are rejected in either envelope", (t) => {
  const markers = [{ synthetic: true }, { simulation: true }, { origin: { synthetic: true } },
    ...["canvas_id", "context_set_id", "report_space", "replay_session_id", "mock_data_source", "fictional_user_id"]
      .map((field) => ({ [field]: "synthetic-fixture" }))];
  for (const marker of markers) for (const side of ["public", "private"]) {
    const f = fixture(t);
    if (side === "public") f.changePublic(marker); else f.changePrivate(marker);
    assert.deepEqual(f.execute(), [], `${side}:${JSON.stringify(marker)}`);
  }
});

test("personal actors may use the explicit or legacy identity but never another user or worker", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE events SET actor=?").run("user");
  assert.equal(f.execute().length, 1);
  for (const actor of ["user:someone-else", "worker:assistant", "user:user-owner:extra"]) {
    f.db.prepare("UPDATE events SET actor=?").run(actor);
    assert.deepEqual(f.execute(), [], actor);
  }
});

test("an optional private actor must match the enrolled actor", (t) => {
  const f = fixture(t);
  f.changePrivate({ actor_user_id: "another-actor" });
  assert.deepEqual(f.execute(), []);
});

test("personal evidence is omitted if any project custody row exists", (t) => {
  const f = fixture(t);
  f.putScope(f.visit, { organization_id: "another-org", project_access_id: "another-access" });
  assert.deepEqual(f.execute(), []);
});

test("shared evidence requires the exact actor and one matching custody tuple", (t) => {
  const f = fixture(t, { shared: true });
  assert.equal(f.execute().length, 1);
  f.db.exec("UPDATE events SET actor='user'");
  assert.deepEqual(f.execute(), []);
  f.db.prepare("UPDATE events SET actor=?").run(`user:${f.enrollment.actor_user_id}`);
  f.putScope(f.visit);
  assert.deepEqual(f.execute(), []);
});

test("every shared custody field is checked and missing custody is omitted", (t) => {
  const values = {
    source_stream_id: "creative:other-owner", source_sequence: 11, organization_id: "other-org",
    project_access_id: "other-access", project_id: "other-project", owner_user_id: "other-owner", actor_user_id: "other-actor",
  };
  for (const [field, value] of Object.entries(values)) {
    const f = fixture(t, { shared: true });
    f.db.prepare(`UPDATE project_event_scopes SET ${field}=?`).run(value);
    assert.deepEqual(f.execute(), [], field);
  }
  const f = fixture(t, { shared: true });
  f.db.exec("DELETE FROM project_event_scopes");
  assert.deepEqual(f.execute(), []);
});

test("replaying the same query observes enrollment disablement, revision, cursor, scope, and expiry changes", (t) => {
  const changes = {
    recall_enabled: 0, revision: 4, cursor_sequence: 63, policy_version: "old-policy",
    enrollment_id: "other-enrollment", actor_user_id: "other-actor", owner_user_id: "other-owner",
    organization_id: "other-org", project_access_id: "other-access", project_id: "other-project",
    document_id: "other-document", permission_epoch: "revoked-epoch", enrolled_at: at(-90_000),
    expires_at: at(-1), retention_days: 29,
  };
  for (const [field, value] of Object.entries(changes)) {
    const f = fixture(t), descriptor = f.query();
    assert.equal(f.execute(descriptor).length, 1, field);
    f.db.prepare(`UPDATE memory_live_enrollments SET ${field}=?`).run(value);
    assert.deepEqual(f.execute(descriptor), [], field);
  }
});

test("remembered selection identity and freshness are rechecked on every query replay", (t) => {
  for (const mutate of [
    (f) => f.db.exec("DELETE FROM memory_live_sources"),
    (f) => f.db.exec("UPDATE memory_live_sources SET sequence=11"),
    (f) => f.db.exec("UPDATE memory_live_sources SET enrollment_id='other-enrollment'"),
    (f) => f.db.prepare("UPDATE memory_live_sources SET expires_at=?").run(at(-1)),
    (f) => f.db.exec("UPDATE events SET type='ObjectSaved'"),
    (f) => f.db.prepare("UPDATE events SET recorded_at=?").run(at(-20_000)),
    (f) => f.db.exec("UPDATE events SET event_id='changed-event'"),
  ]) {
    const f = fixture(t), descriptor = f.query();
    mutate(f);
    assert.deepEqual(f.execute(descriptor), []);
  }
});

test("optimistic client records and event identities cannot be selected as native visits", (t) => {
  const f = fixture(t);
  f.db.exec("UPDATE events SET client_id='optimistic:local-client'");
  assert.deepEqual(f.execute(), []);
  const other = fixture(t), optimistic = other.addEvent({ eventId: "optimistic:visit-two", sequence: 11 });
  other.refs.splice(0, 1, optimistic);
  assert.deepEqual(other.execute(), []);
});

test("SQL omits selected visits recorded before enrollment, beyond retention, or in the future", (t) => {
  for (const state of ["before-enrollment", "retired", "future"]) {
    const f = fixture(t);
    const recordedAt = state === "future" ? at(120_000) : state === "retired" ? at(-31 * 86_400_000) : at(-2 * 86_400_000);
    f.visit.recordedAt = recordedAt;
    f.db.prepare("UPDATE events SET recorded_at=?").run(recordedAt);
    if (state === "retired") {
      f.enrollment.enrolled_at = at(-60 * 86_400_000);
      f.db.prepare("UPDATE memory_live_enrollments SET enrolled_at=?").run(f.enrollment.enrolled_at);
    } else if (state === "future") {
      f.visit.validUntil = at(180_000);
      f.db.prepare("UPDATE memory_live_sources SET expires_at=?").run(f.visit.validUntil);
    }
    assert.deepEqual(f.execute(), [], state);
  }
});

test("duplicate remembered identity cannot multiply a certified visit", (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)")
    .run(f.enrollment.enrollment_id, f.visit.eventId, f.visit.sequence, REMEMBERED);
  assert.deepEqual(f.execute(), []);
});

test("candidate outgoing compensation is omitted without creating an undo observation", (t) => {
  const f = fixture(t);
  f.db.exec("UPDATE events SET compensates_event_id='earlier-event'");
  assert.deepEqual(f.execute(), []);
});

test("all same-stream incoming compensation suppresses visits including unremembered, beyond-cursor, foreign, and future rows", (t) => {
  for (const fields of [
    { sequence: 11 }, { sequence: 65 }, { sequence: 66, actor: "user:foreign-user" },
    { sequence: 67, recordedAt: at(120_000) },
  ]) {
    const f = fixture(t), descriptor = f.query();
    assert.equal(f.execute(descriptor).length, 1);
    f.addEvent({ eventId: "incoming-compensation", type: "Anything", ...fields,
      compensates: f.visit.eventId, remember: false, retainPrivate: false, scope: false });
    assert.deepEqual(f.execute(descriptor), [], JSON.stringify(fields));
  }
});

test("incoming compensation in another stream or against another event does not suppress the selected visit", (t) => {
  const f = fixture(t);
  f.addEvent({ eventId: "other-stream-undo", sequence: 11, streamId: "creative:another-owner",
    compensates: f.visit.eventId, remember: false, retainPrivate: false, scope: false });
  f.addEvent({ eventId: "other-target-undo", sequence: 12, compensates: "different-target",
    remember: false, retainPrivate: false, scope: false });
  assert.equal(f.execute().length, 1);
});

test("native row parsing rejects changed source identities and duplicate rows", (t) => {
  const f = fixture(t), rows = f.execute();
  assert.equal(rows.length, 1);
  for (const fields of [
    { event_id: "another-event" }, { sequence: 11 }, { type: "ObjectSaved" },
    { recorded_at: at(-20_000) }, { block_id: "unexpected-block" },
  ]) assert.equal(f.project([{ ...rows[0], ...fields }]), null, JSON.stringify(fields));
  assert.equal(f.project([rows[0], rows[0]]), null);
});

test("trusted row payloads must remain exact normalized JSON rather than whole private metadata", (t) => {
  const f = fixture(t), rows = f.execute(), original = JSON.parse(rows[0].payload_json);
  for (const payload of [
    { ...original, private_note: "must-not-return" }, { ...original, focused: "true" },
    { ...original, view: "unknown-view" }, { ...original, document_id: "other-document" },
    { ...original, project_id: "other-project" }, { ...original, route_family: "wrong-route" },
    { ...original, source_surface: "wrong-source" },
  ]) assert.equal(f.project([{ ...rows[0], payload_json: JSON.stringify(payload) }]), null);
  for (const payload_json of ["{", "null", "[]", rows[0].payload_json.slice(0, -1) + ',"focused":false}']) {
    assert.equal(f.project([{ ...rows[0], payload_json }]), null);
  }
});

test("expired remembered rows or selected source leases reject stale parser input", (t) => {
  const f = fixture(t), rows = f.execute();
  assert.equal(f.project([{ ...rows[0], remembered_until: CHECKED }]), null);
  assert.equal(f.project(rows, CHECKED, OUTER, [{ ...f.visit, validUntil: CHECKED }]), null);
  assert.equal(f.project(rows, CHECKED, CHECKED), null);
  assert.equal(f.project(rows, CHECKED, OUTER, f.refs, { ...f.enrollment, expires_at: CHECKED }), null);
});

test("retention and enrollment boundaries limit parser evidence even when a supplied row otherwise matches", (t) => {
  const f = fixture(t), rows = f.execute();
  const future = at(1), futureRef = { ...f.visit, recordedAt: future };
  assert.equal(f.project([{ ...rows[0], recorded_at: future }], CHECKED, OUTER, [futureRef]), null);
  const beforeEnrollment = at(-86_400_001), olderRef = { ...f.visit, recordedAt: beforeEnrollment };
  assert.equal(f.project([{ ...rows[0], recorded_at: beforeEnrollment }], CHECKED, OUTER, [olderRef]), null);
  const retired = at(-31 * 86_400_000), retiredRef = { ...f.visit, recordedAt: retired };
  assert.equal(f.project([{ ...rows[0], recorded_at: retired }], CHECKED, OUTER, [retiredRef], {
    ...f.enrollment, enrolled_at: at(-60 * 86_400_000),
  }), null);
});

test("the returned lease respects the shortest remembered, source, enrollment, and retention deadline", (t) => {
  const f = fixture(t), rows = f.execute();
  const result = f.project([{ ...rows[0], remembered_until: at(20_000) }], CHECKED, OUTER,
    [{ ...f.visit, validUntil: at(18_000) }], { ...f.enrollment, expires_at: at(15_000) });
  assert.notEqual(result, null);
  assert.ok(Date.parse(result.validUntil) <= Date.parse(at(15_000)));
  assert.ok(Date.parse(result.episodes[0].validUntil) <= Date.parse(at(15_000)));
  const recorded = at(-86_400_000 + 5_000), ref = { ...f.visit, recordedAt: recorded };
  const retention = f.project([{ ...rows[0], recorded_at: recorded }], CHECKED, OUTER, [ref], {
    ...f.enrollment, enrolled_at: at(-2 * 86_400_000), retention_days: 1,
  });
  assert.notEqual(retention, null);
  assert.ok(Date.parse(retention.validUntil) <= Date.parse(at(5_000)));
});

test("row accessors, hidden properties, symbols, sparse arrays, and oversized results fail closed", (t) => {
  const f = fixture(t), row = f.execute()[0];
  let executions = 0;
  const accessor = { ...row };
  Object.defineProperty(accessor, "payload_json", { enumerable: true, get() { executions++; throw new Error("must-not-run"); } });
  assert.equal(f.project([accessor]), null);
  assert.equal(executions, 0);
  const hidden = { ...row }, symbolic = { ...row };
  Object.defineProperty(hidden, "extra", { enumerable: false, value: "unexpected" });
  symbolic[Symbol("extra")] = "unexpected";
  assert.equal(f.project([hidden]), null);
  assert.equal(f.project([symbolic]), null);
  assert.equal(f.project(new Array(1)), null);
  assert.equal(f.project(Array(65).fill(row)), null);
});

test("query selection rejects identity collisions, cursor overflow, and accessors before SQL execution", (t) => {
  const f = fixture(t);
  for (const refs of [
    [f.visit, { ...f.visit, sequence: 11 }], [f.visit, { ...f.visit, eventId: "other-event" }],
    [{ ...f.visit, sequence: 65 }], new Array(1), Array(65).fill(f.visit),
  ]) assert.throws(() => nativeMemoryConsumptionQuery(f.enrollment, f.q, refs));
  let reads = 0;
  const ref = { ...f.visit };
  Object.defineProperty(ref, "sequence", { enumerable: true, get() { reads++; throw new Error("must-not-run"); } });
  assert.throws(() => nativeMemoryConsumptionQuery(f.enrollment, f.q, [ref]));
  const e = { ...f.enrollment };
  Object.defineProperty(e, "permission_epoch", { enumerable: true, get() { reads++; throw new Error("must-not-run"); } });
  assert.throws(() => nativeMemoryConsumptionQuery(e, f.q, f.refs));
  assert.equal(reads, 0);
});

/** Compare only the newly optimized predicate with its preceding ordinary
 * correlated predicate. All other SQL and all bindings remain identical. */
function priorNegativePredicate(descriptor) {
  const current = "event.event_id NOT IN(SELECT negative.compensates_event_id FROM events negative WHERE negative.stream_id='creative:'||(SELECT json_extract(value,'$.owner_user_id') FROM binding) AND negative.compensates_event_id IS NOT NULL)";
  const prior = "NOT EXISTS(SELECT 1 FROM events negative WHERE negative.stream_id=event.stream_id AND negative.compensates_event_id=event.event_id)";
  assert.equal(descriptor.sql.split(current).length, 2, "replace exactly one reviewed negative-edge predicate");
  return { ...descriptor, sql: descriptor.sql.replace(current, prior) };
}

test("owner-bound negative target sets preserve unaffected visits with null, duplicate, unmatched, and other-stream targets", (t) => {
  for (const shared of [false, true]) {
    const f = fixture(t, { shared });
    const second = f.addEvent({ eventId: "visit-two", sequence: 11 });
    const third = f.addEvent({ eventId: "visit-three", sequence: 12 });
    f.refs.splice(0, 1, third, f.visit, second);
    const incoming = (eventId, sequence, fields) => f.addEvent({
      eventId, sequence, type: "CompensationRecorded", remember: false, retainPrivate: false, scope: false, ...fields,
    });
    incoming("null-target", 65, { compensates: null });
    incoming("second-target", 66, { compensates: second.eventId, actor: "user:foreign-actor" });
    incoming("duplicate-second-target", 67, { compensates: second.eventId, recordedAt: at(120_000) });
    incoming("unmatched-target", 68, { compensates: "unselected-missing-event" });
    incoming("other-stream-first-target", 69, { compensates: f.visit.eventId, streamId: "creative:other-owner" });
    incoming("nonowner-third-target", 70, { compensates: third.eventId,
      streamId: shared ? `creative:${f.enrollment.actor_user_id}` : "creative:another-owner" });

    const current = f.query(), prior = priorNegativePredicate(current);
    const rows = f.execute(current), priorRows = f.execute(prior);
    assert.deepEqual(rows, priorRows, shared ? "shared owner stream" : "personal owner stream");
    assert.deepEqual(rows.map((row) => row.event_id), [f.visit.eventId, third.eventId]);
    const projection = f.project(rows);
    assert.notEqual(projection, null);
    assert.deepEqual(projection, f.project(priorRows));
    assert.equal(projection.coverage.observationCount, 2);
    assert.deepEqual(projection.episodes.flatMap((episode) => episode.observations.map((entry) => entry.sourceIndex)), [1, 0]);
  }
});

test("the same optimized descriptor and prior predicate agree when negative targets change between replays", (t) => {
  const f = fixture(t), second = f.addEvent({ eventId: "visit-two", sequence: 11 });
  f.refs.push(second);
  f.addEvent({ eventId: "mutable-negative", sequence: 65, type: "CompensationRecorded", compensates: null,
    remember: false, retainPrivate: false, scope: false });
  const current = f.query(), prior = priorNegativePredicate(current);
  const check = (expected) => {
    const rows = f.execute(current);
    assert.deepEqual(rows, f.execute(prior));
    assert.deepEqual(rows.map((row) => row.event_id), expected);
  };
  check([f.visit.eventId, second.eventId]);
  f.db.prepare("UPDATE events SET compensates_event_id=? WHERE event_id='mutable-negative'").run(f.visit.eventId);
  check([second.eventId]);
  f.db.prepare("UPDATE events SET compensates_event_id=? WHERE event_id='mutable-negative'").run(second.eventId);
  check([f.visit.eventId]);
  f.db.exec("UPDATE events SET stream_id='creative:other-owner' WHERE event_id='mutable-negative'");
  check([f.visit.eventId, second.eventId]);
});
