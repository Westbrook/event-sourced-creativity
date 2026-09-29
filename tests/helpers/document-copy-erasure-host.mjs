import assert from "node:assert/strict";
import { copyHost, copyJson } from "./document-copy-recovery-host.mjs";

const privateFields = state => [state.intent, state.preview, state.revisedIntent, state.revisionDraft];
async function erasedHost(t, locale = "en", known = true) {
  const p = await copyHost(t, locale), { h, f, target } = p;
  let proposed, original;
  if (known) { original = await p.review(); proposed = original.preview; }
  else {
    await f.act(p.open());
    const field = p.title(); field.port.value = "PRIVATE_LOST_ERASED_COPY_NAME"; await f.act(field, "input");
    const folder = p.folder(); folder.port.value = "root"; await f.act(folder, "change");
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "preview") return;
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 200); proposed = (await response.clone().json()).preview;
      throw new Error("named negative transport loses the actual original preview reply");
    };
    await f.act(p.form(), "submit"); h.intercept = null; original = h.store.documentCopyReview(target);
    assert.equal(original.phase, "uncertain"); assert.equal(original.previewId, ""); assert.ok(proposed);
  }
  assert.equal(original.operationId, proposed.duplication.operationId);
  const tombstone = await eraseOriginal(p, proposed);
  await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
  const current = h.store.documentCopyReview(target);
  assert.equal(current.phase, "unavailable"); assert.equal(current.operationId, original.operationId);
  assert.equal(current.previewId, known ? proposed.previewId : "");
  assert.ok(privateFields(current).every(value => value === null));
  assert.equal(p.calls().some(row => row.body.includeRetirement), false, "automatic Begin keeps the original unflagged protocol");
  return { ...p, original, proposed, tombstone };
}
async function checkRetirement(p) {
  const { h, f, target } = p;
  let observed = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume" || request.body.includeRetirement !== true) return;
    const before = h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
    const response = await h.worker.request(request.url, request.init);
    observed = { request: structuredClone(request.body), status: response.status, body: await response.clone().json(),
      before, after: h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n };
    return response;
  };
  await f.act(p.byLabel("document.copy.check")); await p.join(); h.intercept = null;
  assert.ok(observed, "the deliberate current Check alone opts in");
  assert.equal(observed.status, 200); assert.equal(observed.body.status, "retired");
  assert.equal(observed.after, observed.before, "the original-operation certificate is a read, not a lease cleanup or new preview");
  const state = h.store.documentCopyReview(target);
  assert.equal(state.phase, "retired"); assert.equal(state.receipt, null);
  assert.equal(state.operationId, p.original.operationId); assert.equal(state.previewId, p.proposed.previewId);
  assert.ok(Object.isFrozen(state.retirement)); assert.deepEqual(state.retirement, observed.body.retirement);
  assert.ok(privateFields(state).every(value => value === null)); assert.equal(state.sourceTitle, ""); assert.equal(state.sourceRevision, "");
  return { state, observed };
}

async function eraseOriginal(p, proposed) {
  const { h, target } = p;
  // Named RAM expiry boundary. The real private-content policy performs erasure
  // during a distinct explicit free preview, which is then actually discarded.
  // No new Document/authoring receipt or guessed original identity is created.
  h.worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?")
    .run("2020-01-01T00:00:00.000Z", proposed.previewId);
  const cleanup = await copyJson(p, { action: "preview", ...target, operationId: crypto.randomUUID(),
    title: "Separate explicit retention-cleanup fixture", collectionId: null });
  assert.equal(cleanup.response.status, 200); assert.ok(cleanup.body.preview);
  const cleanupPreview = cleanup.body.preview;
  const discarded = await copyJson(p, { action: "dismiss", ...target, previewId: cleanupPreview.previewId,
    approvalHash: cleanupPreview.approvalHash, operationId: cleanupPreview.duplication.operationId, onlyIfUnapplied: true });
  assert.equal(discarded.response.status, 200); assert.equal(discarded.body.status, "dismissed");
  const tombstone = h.worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(proposed.previewId);
  assert.equal(tombstone.content, ""); assert.ok(tombstone.redacted_at);
  return tombstone;
}
export { erasedHost, checkRetirement, eraseOriginal, privateFields };
