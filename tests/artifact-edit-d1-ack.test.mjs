import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleArtifactEdit, runtime, model;
try {
  ({ handleArtifactEdit } = await import("../worker/artifact-api.ts"));
  runtime = await import("../worker/runtime.ts");
  model = await import("../src/model/document-artifacts.ts");
} finally { imports.deregister(); }

const OWNER = "ordinary-artifact-ack-owner", EMAIL = "ordinary-artifact-ack@example.test";
const PROJECT = "ordinary-artifact-ack-project", DOCUMENT = "ordinary-artifact-ack-document";
const ARTIFACT = "ordinary-artifact-ack-story", CONTENT = "ordinary-artifact-ack-content";
const ORIGINAL_MARKDOWN = "The harbor opened at dawn.\n\nMina kept the original log.";
const REVISED_MARKDOWN = "The harbor opened at noon.\n\nMina corrected the departure log.";
const hash = value => createHash("sha256").update(value).digest("hex");
const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const json = value => ({ method: "PATCH", headers: { ...headers, "content-type": "application/json", origin: "https://forma.test" }, body: JSON.stringify(value) });

async function fixture(t) {
  const state = outputTestDatabase();
  t.after(() => { try { state.sqlite.close(); } finally { state.media.clear(); } });
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString(), streamId = `creative:${OWNER}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Ordinary artifact fixture", "creator", "pilot-2026-08-10", now, now, now);
  await runtime.appendAuditEvent(state.env, streamId, "user", "ProjectCreated", { project_id: PROJECT, name: "Ordinary artifact acknowledgement" });
  await runtime.appendAuditEvent(state.env, streamId, "user", "DocumentCreated", { project_id: PROJECT, document_id: DOCUMENT, title: "Harbor log" });
  const original = model.parseDocumentArtifactContent(JSON.stringify({
    title: "Harbor log", summary: "An authored ordinary short story.", content_markdown: ORIGINAL_MARKDOWN, presentation: null,
    items: [{ title: "Departure", body: ORIGINAL_MARKDOWN, notes: "Keep the original log in history.", image_prompt: "", slide: null }],
  }));
  assert(original);
  const raw = JSON.stringify(original);
  const editedRaw = JSON.stringify({ ...original, content_markdown: REVISED_MARKDOWN, items: [{ ...original.items[0], body: REVISED_MARKDOWN }] });
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, "2099-01-01T00:00:00.000Z");
  const completion = await runtime.appendAuditEvent(state.env, streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: PROJECT, document_id: DOCUMENT, artifact_id: ARTIFACT, artifact_kind: "short_story", requested_by_user_id: OWNER,
    title: "Harbor log", content_ref: CONTENT, input_ref: "ordinary-artifact-authored-input", item_count: 1,
    items: [{ id: "ordinary-artifact-story-part", title: "Departure" }],
  });
  const initialCompletion = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(completion.eventId).private_json;
  return {
    ...state, streamId, raw, editedRaw, completion, initialCompletion,
    currentRaw: () => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND owner_id=?").get(CONTENT, OWNER).content,
    edit: (input = { markdown: REVISED_MARKDOWN, expectedRevision: 0 }) => handleArtifactEdit(
      new Request(`https://forma.test/api/artifacts/${ARTIFACT}`, json(input)), state.env, ARTIFACT),
    restore: (selected, expectedRevision) => handleArtifactEdit(
      new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/${selected}/restore`, { ...json({ expectedRevision }), method: "POST" }),
      state.env, ARTIFACT, ["revisions", String(selected), "restore"]),
  };
}

function ownedSnapshot(f) {
  const rows = (sql, ...bindings) => f.sqlite.prepare(sql).all(...bindings).map(row => ({ ...row }));
  return {
    content: f.currentRaw(),
    events: rows("SELECT event_id,sequence,payload FROM events WHERE stream_id=? AND type='DocumentArtifactEdited' AND json_extract(payload,'$.artifact_id')=? ORDER BY sequence", f.streamId, ARTIFACT),
    privateEvents: rows("SELECT p.private_event_id,p.private_json FROM event_private_payloads p JOIN events e ON e.event_id=p.private_event_id WHERE e.stream_id=? AND e.type='DocumentArtifactEdited' AND json_extract(e.payload,'$.artifact_id')=? ORDER BY e.sequence", f.streamId, ARTIFACT),
    history: rows("SELECT revision,owner_id,content_json,content_sha256 FROM artifact_revisions WHERE owner_id=? AND artifact_id=? ORDER BY revision", OWNER, ARTIFACT),
    stagedEvents: rows("SELECT event_id FROM event_write_stage WHERE stream_id=?", f.streamId),
    completion: f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId).private_json,
  };
}

function assertCommitted(f, revision, raw, { restoredFrom } = {}) {
  const snapshot = ownedSnapshot(f);
  assert.equal(snapshot.content, raw, "the intended content committed before its acknowledgement is judged");
  assert.equal(snapshot.events.length, revision);
  assert.equal(snapshot.privateEvents.length, revision);
  const event = snapshot.events.at(-1), privateEvent = snapshot.privateEvents.at(-1);
  assert.equal(privateEvent.private_event_id, event.event_id);
  const publicPayload = JSON.parse(event.payload), payload = JSON.parse(privateEvent.private_json);
  assert.equal(publicPayload.revision, revision);
  assert.equal(payload.revision, revision);
  assert.equal(payload.artifact_id, ARTIFACT);
  assert.equal(payload.artifact_kind, "short_story");
  assert.equal(payload.document_id, DOCUMENT);
  assert.equal(payload.project_id, PROJECT);
  assert.equal(payload.content_ref, CONTENT);
  assert.equal(payload.content_sha256, hash(raw));
  assert.equal(payload.edited_by_user_id, OWNER);
  if (restoredFrom === undefined) {
    assert.equal(payload.source_surface, "document-artifact-editor");
    assert.equal(Object.hasOwn(payload, "restored_from_revision"), false);
    assert.equal(Object.hasOwn(payload, "revision_action"), false);
  } else {
    assert.equal(payload.source_surface, "document-artifact-history");
    assert.equal(payload.restored_from_revision, restoredFrom);
    assert.equal(payload.revision_action, "restore");
  }
  assert.equal(snapshot.history.length, revision + 1);
  assert.deepEqual(snapshot.history[0], { revision: 0, owner_id: OWNER, content_json: f.raw, content_sha256: hash(f.raw) });
  assert.deepEqual(snapshot.history[1], { revision: 1, owner_id: OWNER, content_json: f.editedRaw, content_sha256: hash(f.editedRaw) });
  assert.deepEqual(snapshot.history.at(-1), { revision, owner_id: OWNER, content_json: raw, content_sha256: hash(raw) });
  assert.deepEqual(snapshot.stagedEvents, []);
  assert.equal(snapshot.completion, f.initialCompletion, "the original completion remains immutable");
  assert.equal(f.media.size, 0, "ordinary writing does not create media");
  return { event, payload };
}

async function assertAck(response, committed, revision, raw) {
  assert.equal(response.status, 200, await response.clone().text());
  const ack = await response.json();
  assert.equal(ack.revision, revision);
  assert.equal(ack.head, committed.event.sequence);
  assert.deepEqual(ack.content, { [CONTENT]: raw });
  assert.equal(ack.appended.length, 1);
  assert.equal(ack.appended[0].eventId, committed.event.event_id);
  assert.equal(ack.appended[0].sequence, committed.event.sequence);
  assert.equal(ack.appended[0].type, "DocumentArtifactEdited");
  assert.deepEqual(ack.appended[0].payload, committed.payload);
}

// Keep the real transaction and trigger. Only its returned accounting changes,
// using SQLite's measured per-statement total rather than a fabricated count.
function observeD1Changes(t, f, { beforeBatch, mapResults = results => results } = {}) {
  const originalBatch = f.env.DB.batch, batch = originalBatch.bind(f.env.DB), observed = [];
  f.env.DB.batch = async statements => {
    if (!statements[0]?.sql.includes("INSERT INTO event_write_stage") || !statements[0]?.sql.includes("private_content")) return batch(statements);
    if (beforeBatch) await beforeBatch();
    const originals = statements.map(statement => statement.execute), metrics = [];
    observed.push(metrics);
    statements.forEach((statement, index) => {
      statement.execute = function(kind) {
        const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
        const result = originals[index].call(this, kind);
        const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n - before;
        metrics.push({ success: result.success, directChanges: result.meta.changes, changes });
        return { ...result, meta: { ...result.meta, changes } };
      };
    });
    try { return mapResults(await batch(statements)); }
    finally { statements.forEach((statement, index) => { statement.execute = originals[index]; }); }
  };
  t.after(() => { f.env.DB.batch = originalBatch; });
  return observed;
}

function assertTriggerCounts(observed) {
  assert.equal(observed.length, 1);
  assert(observed[0].length >= 3, "stage, retained revision and current content statements were observed");
  assert.equal(observed[0][0].directChanges, 1);
  assert(observed[0][0].changes > observed[0][0].directChanges, "the real stage trigger contributes writes");
  assert(observed[0].every(metric => metric.success === true && Number.isSafeInteger(metric.changes) && metric.changes > 0));
}

async function seedEditedRevision(f) {
  // The existing helper reports direct changes. This independent setup lets the
  // restore regression run even while trigger-inclusive Save acknowledgement is RED.
  const response = await f.edit();
  const committed = assertCommitted(f, 1, f.editedRaw);
  await assertAck(response, committed, 1, f.editedRaw);
}

test("ordinary personal Save acknowledges its exact commit with trigger-inclusive D1 changes", async t => {
  const f = await fixture(t), observed = observeD1Changes(t, f);
  const response = await f.edit();
  const committed = assertCommitted(f, 1, f.editedRaw);
  assertTriggerCounts(observed);
  await assertAck(response, committed, 1, f.editedRaw);
});

test("ordinary personal restore acknowledges a new exact revision with trigger-inclusive D1 changes", async t => {
  const f = await fixture(t);
  await seedEditedRevision(f);
  const before = ownedSnapshot(f), observed = observeD1Changes(t, f);
  const response = await f.restore(0, 1);
  const committed = assertCommitted(f, 2, f.raw, { restoredFrom: 0 });
  assert.deepEqual(ownedSnapshot(f).history.slice(0, 2), before.history);
  assertTriggerCounts(observed);
  await assertAck(response, committed, 2, f.raw);
});

test("stale ordinary Save and restore do not create another revision", async t => {
  for (const operation of ["save", "restore"]) await t.test(operation, async child => {
    const f = await fixture(child);
    await seedEditedRevision(f);
    const before = ownedSnapshot(f), observed = observeD1Changes(child, f);
    const response = operation === "save" ? await f.edit() : await f.restore(0, 0);
    assert.equal(response.status, 409, await response.clone().text());
    assert.deepEqual(await response.json(), { error: "artifact_revision_conflict", revision: 1 });
    assert.deepEqual(ownedSnapshot(f), before);
    assert.deepEqual(observed, [], "a stale expected revision is refused before its write batch");
  });
});

test("a commit-time source change leaves all guarded ordinary statements at zero", async t => {
  const f = await fixture(t), before = ownedSnapshot(f), changedSource = f.raw + " ";
  const observed = observeD1Changes(t, f, { beforeBatch: () => {
    f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=? AND owner_id=?").run(changedSource, CONTENT, OWNER);
  } });
  const response = await f.edit();
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "artifact_revision_conflict", revision: 0 });
  assert.deepEqual(ownedSnapshot(f), { ...before, content: changedSource });
  assert.equal(observed.length, 1);
  assert(observed[0].length >= 3);
  assert(observed[0].every(metric => metric.directChanges === 0 && metric.changes === 0));
});

test("ordinary unchanged content remains an exact no-op without an edit batch", async t => {
  const f = await fixture(t), before = ownedSnapshot(f), observed = observeD1Changes(t, f);
  const response = await f.edit({ markdown: ORIGINAL_MARKDOWN, expectedRevision: 0 });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { appended: [], content: { [CONTENT]: f.raw }, revision: 0 });
  assert.deepEqual(ownedSnapshot(f), before);
  assert.deepEqual(observed, []);
});

test("malformed ordinary batch metadata never fabricates an ACK for an already committed edit", async t => {
  const faults = ["not-array", "empty-array", "missing-result", "extra-result", "hole", "false-success", "missing-success", "numeric-success", "missing-meta", "missing-changes",
    "zero", "negative", "fraction", "nan", "infinity", "unsafe-integer", "numeric-string", "boolean", "last-zero", "last-false-success"];
  for (const fault of faults) await t.test(fault, async child => {
    const f = await fixture(child);
    const observed = observeD1Changes(child, f, { mapResults: results => {
      if (fault === "not-array") return null;
      if (fault === "empty-array") return [];
      if (fault === "missing-result") return results.slice(1);
      if (fault === "extra-result") return [...results, results[0]];
      if (fault === "hole") { delete results[0]; return results; }
      if (fault === "false-success") { results[0].success = false; return results; }
      if (fault === "missing-success") { delete results[0].success; return results; }
      if (fault === "numeric-success") { results[0].success = 1; return results; }
      if (fault === "missing-meta") { delete results[0].meta; return results; }
      if (fault === "missing-changes") { delete results[0].meta.changes; return results; }
      if (fault === "last-zero") { results.at(-1).meta.changes = 0; return results; }
      if (fault === "last-false-success") { results.at(-1).success = false; return results; }
      results[0].meta.changes = { zero: 0, negative: -1, fraction: 0.5, nan: NaN, infinity: Infinity, "unsafe-integer": Number.MAX_SAFE_INTEGER + 1, "numeric-string": "1", boolean: true }[fault];
      return results;
    } });
    let response, failure;
    try { response = await f.edit(); } catch (error) { failure = error; }
    assertCommitted(f, 1, f.editedRaw);
    assertTriggerCounts(observed);
    // A rejected/malformed acknowledgement does not imply rollback. In particular,
    // do not retry the edit or label the committed rows as an actual source conflict.
    assert.equal(failure, undefined, "invalid result metadata must produce a controlled non-success response");
    assert(response instanceof Response);
    assert.equal(response.ok, false, "invalid metadata cannot acknowledge a successful write");
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(Object.hasOwn(body, "appended"), false);
    assert.equal(Object.hasOwn(body, "content"), false);
    assert.equal(Object.hasOwn(body, "head"), false);
  });
});

test("a committed ordinary restore with missing final metadata retains its exact history without a success ACK", async t => {
  const f = await fixture(t);
  await seedEditedRevision(f);
  const before = ownedSnapshot(f);
  const observed = observeD1Changes(t, f, { mapResults: results => { delete results.at(-1).meta; return results; } });
  let response, failure;
  try { response = await f.restore(0, 1); } catch (error) { failure = error; }
  assertCommitted(f, 2, f.raw, { restoredFrom: 0 });
  assert.deepEqual(ownedSnapshot(f).history.slice(0, 2), before.history);
  assertTriggerCounts(observed);
  assert.equal(failure, undefined);
  assert(response instanceof Response);
  assert.equal(response.ok, false);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.equal(Object.hasOwn(body, "appended"), false);
  assert.equal(Object.hasOwn(body, "content"), false);
  assert.equal(Object.hasOwn(body, "head"), false);
});
