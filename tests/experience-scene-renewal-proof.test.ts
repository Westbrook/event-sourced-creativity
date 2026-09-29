import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sceneRenewalIndexAssertion, sceneRenewalNoExecutionAssertion, sceneRenewalWindowAssertion } from "../worker/experience-scene-renewal-proof.ts";
import type { OutputScope, OutputSqlAssertion } from "../worker/output-command-core.ts";

const scope: OutputScope = { kind: "personal", key: "personal:actor:project", ownerUserId: "actor", actorUserId: "actor",
  documentId: "document", projectId: "project", organizationId: null, projectAccessId: null, contextId: null };
const requestId = `scene-${"a".repeat(64)}`, predecessorRequestId = `scene-${"b".repeat(64)}`;
const draftId = `experience-draft-${"c".repeat(64)}`;
const key = `scene-cycle-v1:${"c".repeat(64)}:${"d".repeat(64)}:confirm`;
function database() {
  const db = new DatabaseSync(":memory:");
  // Local tables expose the actual columns consumed by the proof predicates.
  // No native admission, private evidence or successful write is fabricated.
  db.exec(`CREATE TABLE events(event_id TEXT,payload TEXT,stream_id TEXT,type TEXT);
    CREATE TABLE output_commands(scope_key TEXT,actor_user_id TEXT,command_key TEXT,action TEXT,event_id TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,document_id TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,plan_revision_id TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,plan_revision_id TEXT,job_id TEXT);
    CREATE TABLE document_jobs(owner_id TEXT,document_id TEXT,job_id TEXT);
    CREATE TABLE budget_reservations(owner_id TEXT,stream_id TEXT,correlation_id TEXT,status TEXT);
    CREATE TABLE cost_budget_reservations(owner_id TEXT,correlation_id TEXT,status TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT);
    CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,expires_at TEXT,redacted_at TEXT);
  `);
  return db;
}

test("renewal window checks the current retained row and rejects any deadline drift", () => {
  const db = database(), expiry = new Date(Date.now() + 3_600_000).toISOString();
  const proof = sceneRenewalWindowAssertion(scope, draftId, new Date(Date.now() - 60_000).toISOString(), expiry);
  try {
    db.prepare("INSERT INTO private_content VALUES(?,?,?,?,NULL)").run(draftId, scope.ownerUserId, "experience-draft", expiry);
    assert.equal(passed(db, proof), true);
    for (const offset of [60_000, 1_800_000, 7_200_000]) {
      db.prepare("UPDATE private_content SET expires_at=?").run(new Date(Date.now() + offset).toISOString());
      assert.equal(passed(db, proof), false);
    }
    db.prepare("UPDATE private_content SET expires_at=?,redacted_at=?").run(expiry, new Date().toISOString());
    assert.equal(passed(db, proof), false);
    db.exec("DELETE FROM private_content");
    assert.equal(passed(db, proof), false);
  } finally { db.close(); }
});
function passed(db: DatabaseSync, proof: OutputSqlAssertion) {
  const row = db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS passed`).get(...(proof.bindings ?? []));
  return row?.passed === 1;
}

test("actual absence predicate reads every durable class and does not confuse a missing schema with zero", () => {
  const db = database(), proof = sceneRenewalNoExecutionAssertion(scope, [predecessorRequestId, requestId]);
  try {
    assert.equal(passed(db, proof), true);
    db.exec("DROP TABLE output_provider_calls");
    assert.throws(() => passed(db, proof), /no such table/);
  } finally { db.close(); }
});

test("Video proof rejects prior financial history and isolates only its cycle namespace", () => {
  const db = database(), videoId = `video-${"a".repeat(64)}`, videoKey = key.replace("scene-", "video-");
  try {
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [videoId]));
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [requestId], "video"));
    const proof = sceneRenewalNoExecutionAssertion(scope, [videoId], "video");
    assert.equal(passed(db, proof), true);
    db.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?)").run("other-payer", videoId + ":attempt:1", "settled");
    assert.equal(passed(db, proof), false);
    db.exec("DELETE FROM cost_budget_reservations");
    const empty = sceneRenewalIndexAssertion(scope, draftId, [], "video");
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, key, "confirm", "scene-event");
    assert.equal(passed(db, empty), true);
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, videoKey, "confirm", "video-event");
    assert.equal(passed(db, empty), false);
    assert.equal(passed(db, sceneRenewalIndexAssertion(scope, draftId, [videoKey], "video")), true);
    assert.throws(() => sceneRenewalIndexAssertion(scope, draftId, [key], "video"));
    db.exec("DROP TABLE output_provider_calls");
    assert.throws(() => passed(db, proof));
  } finally { db.close(); }
});

test("Audio proof rejects prior financial history and isolates only its cycle namespace", () => {
  const db = database(), audioId = `audio-${"a".repeat(64)}`, audioKey = key.replace("scene-", "audio-");
  try {
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [audioId]));
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [requestId], "audio"));
    const proof = sceneRenewalNoExecutionAssertion(scope, [audioId], "audio");
    assert.equal(passed(db, proof), true);
    db.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?)").run("other-payer", audioId + ":attempt:1", "settled");
    assert.equal(passed(db, proof), false);
    db.exec("DELETE FROM cost_budget_reservations");
    const empty = sceneRenewalIndexAssertion(scope, draftId, [], "audio");
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, key, "confirm", "scene-event");
    assert.equal(passed(db, empty), true);
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, audioKey, "confirm", "audio-event");
    assert.equal(passed(db, empty), false);
    assert.equal(passed(db, sceneRenewalIndexAssertion(scope, draftId, [audioKey], "audio")), true);
    assert.throws(() => sceneRenewalIndexAssertion(scope, draftId, [key], "audio"));
    db.exec("DROP TABLE output_provider_calls");
    assert.throws(() => passed(db, proof));
  } finally { db.close(); }
});

test("Storyboard proof rejects prior financial history and isolates only its cycle namespace", () => {
  const db = database(), storyboardId = `storyboard-${"a".repeat(64)}`, storyboardKey = key.replace("scene-", "storyboard-");
  try {
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [storyboardId]));
    assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [requestId], "storyboard"));
    const proof = sceneRenewalNoExecutionAssertion(scope, [storyboardId], "storyboard");
    assert.equal(passed(db, proof), true);
    db.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?)").run("other-payer", storyboardId + ":attempt:1", "settled");
    assert.equal(passed(db, proof), false);
    db.exec("DELETE FROM cost_budget_reservations");
    const empty = sceneRenewalIndexAssertion(scope, draftId, [], "storyboard");
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, key, "confirm", "scene-event");
    assert.equal(passed(db, empty), true);
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, scope.actorUserId, storyboardKey, "confirm", "storyboard-event");
    assert.equal(passed(db, empty), false);
    assert.equal(passed(db, sceneRenewalIndexAssertion(scope, draftId, [storyboardKey], "storyboard")), true);
    assert.throws(() => sceneRenewalIndexAssertion(scope, draftId, [key], "storyboard"));
    db.exec("DROP TABLE output_provider_calls");
    assert.throws(() => passed(db, proof));
  } finally { db.close(); }
});

test("all retained lineage reservation outcomes block renewal, including settled charges", () => {
  for (const status of ["active", "settled", "cancelled", "uncertain"]) {
    const db = database(), proof = sceneRenewalNoExecutionAssertion(scope, [predecessorRequestId, requestId]);
    try {
      db.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?)").run("actor", "creative:actor", predecessorRequestId, status);
      assert.equal(passed(db, proof), false);
      db.exec("DELETE FROM budget_reservations");
      db.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?)").run("actor", predecessorRequestId, status);
      assert.equal(passed(db, proof), false);
    } finally { db.close(); }
  }
});

test("lineage correlation families block even orphan billing-owner/stream rows and attempt-suffixed reservations", () => {
  for (const status of ["active", "settled", "cancelled", "uncertain"]) for (const suffix of ["", ":attempt:1", ":attempt:unknown"]) {
    const db = database(), proof = sceneRenewalNoExecutionAssertion(scope, [predecessorRequestId, requestId]);
    try {
      db.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?)").run("different-billing-owner", "different-stream", predecessorRequestId + suffix, status);
      assert.equal(passed(db, proof), false);
      db.exec("DELETE FROM budget_reservations");
      db.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?)").run("different-billing-owner", predecessorRequestId + suffix, status);
      assert.equal(passed(db, proof), false);
    } finally { db.close(); }
  }
});

test("native authorization, jobs and orphan records prevent a positive never-authorized proof", () => {
  const fixtures = [
    (db: DatabaseSync) => db.prepare("INSERT INTO output_execution_grants VALUES(?,?)").run(scope.key, "missing-plan"),
    (db: DatabaseSync) => db.prepare("INSERT INTO output_operation_slots VALUES(?,?,?,?)").run(scope.key, "slot", "missing-plan", requestId),
    (db: DatabaseSync) => db.prepare("INSERT INTO output_provider_calls VALUES(?,?)").run(scope.key, "missing-slot"),
    (db: DatabaseSync) => db.prepare("INSERT INTO document_jobs VALUES(?,?,?)").run("actor", "document", "native-unrelated-id"),
    (db: DatabaseSync) => db.prepare("INSERT INTO document_jobs VALUES(?,?,?)").run("different-owner", "different-document", requestId),
    (db: DatabaseSync) => db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, "actor", "native-authorize", "authorize", "missing-event"),
  ];
  for (const seed of fixtures) {
    const db = database();
    try { seed(db); assert.equal(passed(db, sceneRenewalNoExecutionAssertion(scope, [requestId])), false); }
    finally { db.close(); }
  }
});

test("positively associated unrelated Document records do not block the selected Document", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO output_plan_revisions VALUES(?,?,?)").run(scope.key, "other-plan", "other-document");
    db.prepare("INSERT INTO output_execution_grants VALUES(?,?)").run(scope.key, "other-plan");
    db.prepare("INSERT INTO output_operation_slots VALUES(?,?,?,?)").run(scope.key, "other-slot", "other-plan", "other-job");
    db.prepare("INSERT INTO output_provider_calls VALUES(?,?)").run(scope.key, "other-slot");
    db.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?)").run("actor", "creative:actor", "other-job", "settled");
    assert.equal(passed(db, sceneRenewalNoExecutionAssertion(scope, [requestId])), true);
  } finally { db.close(); }
});

test("index predicate rejects newly appended or replaced keys, not only changed counts", () => {
  const db = database();
  try {
    const empty = sceneRenewalIndexAssertion(scope, draftId, []);
    assert.equal(passed(db, empty), true);
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, "actor", key, "confirm", "event");
    assert.equal(passed(db, empty), false, "the earlier selection must be rechecked at commit");
    const saved = sceneRenewalIndexAssertion(scope, draftId, [key]);
    assert.equal(passed(db, saved), true);
    db.prepare("UPDATE output_commands SET command_key=?").run(key.replace(":confirm", ":preflight"));
    assert.equal(passed(db, saved), false, "same-count replacement is not the recorded lineage");
  } finally { db.close(); }
});

test("late authorization invalidates the same predicate retained for the final transaction", () => {
  const db = database(), proof = sceneRenewalNoExecutionAssertion(scope, [requestId]);
  try {
    assert.equal(passed(db, proof), true);
    db.prepare("INSERT INTO events(event_id,payload) VALUES(?,?)").run("authorized", JSON.stringify({ document_id: scope.documentId }));
    db.prepare("INSERT INTO output_commands VALUES(?,?,?,?,?)").run(scope.key, "actor", "native-authorize", "authorize", "authorized");
    assert.equal(passed(db, proof), false);
  } finally { db.close(); }
});

test("retained execution events block without any command/grant/slot index, including damaged Document association", () => {
  for (const type of ["OutputExecutionAuthorized", "OutputExecutionRunRequested"]) {
    for (const payload of [JSON.stringify({document_id: scope.documentId}), "{}", '{"document_id":42}', "malformed-json",
      ...["", "   ", "\t", "invalid/id", "a".repeat(161)].map(document_id => JSON.stringify({document_id}))]) {
      const db = database();
      try {
        db.prepare("INSERT INTO events VALUES(?,?,?,?)").run("retained-event", payload, "creative:actor", type);
        assert.equal(passed(db, sceneRenewalNoExecutionAssertion(scope, [requestId])), false);
      } finally { db.close(); }
    }
    const db = database();
    try {
      db.prepare("INSERT INTO events VALUES(?,?,?,?)").run("other-event", JSON.stringify({document_id:"other-document"}), "creative:actor", type);
      assert.equal(passed(db, sceneRenewalNoExecutionAssertion(scope, [requestId])), true);
    } finally { db.close(); }
  }
});

test("proof construction refuses missing lineage and foreign or incomplete personal scope", () => {
  assert.throws(() => sceneRenewalNoExecutionAssertion(scope, []));
  assert.throws(() => sceneRenewalNoExecutionAssertion(scope, [requestId, requestId]));
  assert.throws(() => sceneRenewalNoExecutionAssertion({ ...scope, actorUserId: "foreign" }, [requestId]));
  assert.throws(() => sceneRenewalNoExecutionAssertion({ ...scope, organizationId: "organization" }, [requestId]));
  assert.throws(() => sceneRenewalIndexAssertion(scope, draftId, ["unrelated-key"]));
});
