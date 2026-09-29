import assert from "node:assert/strict";
import { copyHost, copyJson, failedFolder, enterRevision } from "./document-copy-recovery-host.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "./event-source-retirement-fixture.mjs";

const tuple = state => [state.operationId, state.previewId, state.approvalHash];
const privateFields = state => [state.intent, state.preview, state.revisedIntent, state.revisionDraft];
const history = p => p.h.worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
const changes = p => p.h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
const flaggedBody = (p, original) => ({ action: "resume", ...p.target, operationId: original.operationId,
  includeRetirement: true, previewId: original.previewId, approvalHash: original.approvalHash });

// All actions below use the complete connected Shell/Project/Store and real
// Worker/SQLite. Folder seeds and explicit expiry boundaries are RAM fixtures,
// not live incidents, production time, browser/AT or provider evidence.
async function repeatedRefusal(t, locale) {
  const p = await failedFolder(t, locale), { h, f, target } = p;
  const folderId = "repeated-correction-" + locale;
  await appendAuditEvent(h.worker.env, h.worker.streamId, "user:" + h.worker.owner, "CollectionCreated", {
    project_id: target.projectId, collection_id: folderId, handle: "Second current folder", position: "b0",
  });
  await h.store.refreshEvents(); await f.settle();
  await enterRevision(p, "Current corrected candidate · " + locale);
  assert.ok(f.tree().visible("option").some(row => row.attributes.value === "folder:" + folderId));
  const field = p.folder(); field.port.value = "folder:" + folderId; await f.act(field, "change");
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "revise") return;
    assert.equal(actual, null);
    const removed = await h.worker.request("/api/events", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "append",
        event: { type: "CollectionRemoved", payload: { project_id: target.projectId, collection_id: folderId } } }) });
    assert.equal(removed.status, 200, await removed.clone().text());
    const response = await h.worker.request(request.url, request.init);
    actual = { request: structuredClone(request.body), status: response.status, body: await response.clone().json() };
    return response;
  };
  try { await f.act(p.form(), "submit"); await p.join(); } finally { h.intercept = null; }
  assert.equal(actual.status, 409); assert.equal(actual.body.status, "not-applied");
  assert.equal(actual.body.error, "document_duplicate_folder_unavailable");
  assert.equal(actual.request.operationId, p.original.operationId); assert.equal(actual.request.collectionId, folderId);
  const state = h.store.documentCopyReview(target);
  assert.equal(state.phase, "unavailable"); assert.equal(state.issue, actual.body.error);
  assert.equal(state.commitSubmitted, false); assert.equal(state.revisedRequestSubmitted, true);
  assert.equal(state.previewId, ""); assert.equal(p.receipts().length, 0);
  assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 0);
  await h.store.refreshEvents(); await f.settle();
  return { ...p, repeated: state, repeatedReply: actual };
}

async function savedOriginalCandidate(t, locale, committed) {
  const p = await failedFolder(t, locale), { h, f, target } = p;
  const candidate = "Unsubmitted distinct candidate · " + locale;
  await enterRevision(p, candidate);
  const earlier = await copyJson(p, { action: "revise", ...target, operationId: p.original.operationId,
    title: "Earlier canonical original", collectionId: null });
  assert.equal(earlier.response.status, 200); assert.equal(earlier.body.status, "not-applied");
  const winner = earlier.body.preview;
  let saved = null;
  if (committed) {
    saved = await copyJson(p, { ...target, action: "apply", previewId: winner.previewId, approvalHash: winner.approvalHash });
    assert.equal(saved.response.status, 200); assert.equal(saved.body.status, "applied");
  }
  await f.act(p.form(), "submit"); await p.join();
  const state = h.store.documentCopyReview(target);
  assert.equal(state.phase, committed ? "applied" : "review"); assert.equal(state.reviewDisposition, "saved-original");
  assert.equal(state.revisedIntent.title, candidate); assert.equal(state.revisionDraft.title, candidate);
  assert.equal(state.operationId, p.original.operationId); assert.equal(state.previewId, winner.previewId);
  return { ...p, candidate, winner, saved, winning: state };
}

async function expiredUnknown(t, locale = "en") {
  const p = await copyHost(t, locale), { h, f, target } = p, original = await p.review();
  const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
  let advanced = false, rejected = null;
  h.worker.controls.beforeBatch = async statements => {
    if (!advanced && statements.some(row => /\bINSERT INTO event_write_stage\b/u.test(row.sql))) {
      advanced = true;
      const held = JSON.parse(h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(original.previewId).content);
      assert.equal(held.state, "applying", "the actual Worker has already claimed the original Apply");
      // Only these existing RAM deadlines move to the past. No fabricated
      // receipt, event, lease, retention extension or successful response.
      h.worker.sqlite.prepare("UPDATE private_content SET expires_at=?,content=json_set(content,'$.leaseExpiresAt',?) WHERE content_id=?")
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", original.previewId);
    }
  };
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return;
    const response = await h.worker.request(request.url, request.init);
    rejected = { status: response.status, body: await response.clone().json() };
    assert.equal(response.status, 409); assert.equal(rejected.body.status, "not-applied");
    assert.equal(rejected.body.previewId, original.previewId);
    throw new Error("named lost transport response after the actual original was not applied");
  };
  try { await f.act(p.byLabel("document.copy.apply")); await p.join(); }
  finally { h.intercept = null; h.worker.controls.beforeBatch = null; }
  assert.ok(advanced); assert.equal(h.store.documentCopyReview(target).commitSubmitted, true);
  const row = h.worker.sqlite.prepare("SELECT content,redacted_at,expires_at FROM private_content WHERE content_id=?").get(original.previewId);
  assert.equal(row.redacted_at, null); assert.equal(JSON.parse(row.content).state, "review");
  assert.equal(row.expires_at, "2020-01-01T00:00:00.000Z");
  assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before); assert.equal(p.receipts().length, 0);
  // Automatic Begin is deliberately unflagged. It withholds private data but
  // cannot, by itself, make the new guarded action available.
  await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
  assert.equal(p.calls().at(-1).body.action, "retrieve"); assert.equal(p.calls().at(-1).body.includeRetirement, undefined);
  const withheld = h.store.documentCopyReview(target);
  assert.equal(withheld.phase, "uncertain"); assert.equal(withheld.commitSubmitted, true);
  assert.deepEqual(tuple(withheld), tuple(original)); assert.ok(privateFields(withheld).every(value => value === null));
  assert.equal(Boolean(withheld.guardedDismissAvailable), false);
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  return { ...p, original, rejected };
}

async function askGuardedEligibility(p) {
  const { h, f, target } = p;
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
    const before = changes(p), response = await h.worker.request(request.url, request.init);
    actual = { request: structuredClone(request.body), status: response.status, body: await response.clone().json(), before, after: changes(p) };
    return response;
  };
  try { await f.act(p.byLabel("document.copy.check")); await p.join(); } finally { h.intercept = null; }
  assert.ok(actual); assert.deepEqual(actual.request, flaggedBody(p, p.original));
  assert.equal(actual.status, 403); assert.deepEqual(actual.body, { error: "authoring_preview_unavailable" });
  assert.equal(actual.after, actual.before, "flagged original Check is read-only");
  const state = h.store.documentCopyReview(target);
  assert.deepEqual(tuple(state), tuple(p.original)); assert.equal(state.commitSubmitted, true);
  assert.equal(state.phase, "uncertain"); assert.equal(state.receipt, null); assert.equal(state.retirement, null);
  assert.equal(state.guardedDismissAvailable, true, "only permission to ask, never cancellation evidence");
  assert.ok(privateFields(state).every(value => value === null));
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  assert.ok(p.byLabel("document.copy.discard"));
  return { state, actual };
}
export { tuple, privateFields, history, changes, flaggedBody, repeatedRefusal, savedOriginalCandidate, expiredUnknown, askGuardedEligibility };
