import assert from "node:assert/strict";
import test from "node:test";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork } from "./helpers/document-copy-recovery-host.mjs";
import { repeatedRefusal, changes, history } from "./helpers/document-copy-continuity-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("A repeated same-operation correction survives Close and exact read-only none: " + locale, { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, locale), { h, f, target } = p, money = financial(h.worker);
    const before = history(p), draft = p.repeated.revisionDraft, candidate = p.repeated.revisedIntent;
    for (let cycle = 0; cycle < 2; cycle++) {
      const count = p.calls().length, writes = changes(p);
      await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
      assert.equal(p.calls().length, count + 1);
      assert.deepEqual(p.calls().at(-1).body, { action: "resume", ...target, operationId: p.original.operationId });
      assert.equal(changes(p), writes); assert.deepEqual(history(p), before);
      const state = h.store.documentCopyReview(target);
      assert.equal(state.operationId, p.original.operationId); assert.equal(state.issue, "document_duplicate_folder_unavailable");
      assert.equal(state.phase, "unavailable"); assert.equal(state.previewId, ""); assert.equal(state.commitSubmitted, false);
      assert.deepEqual(state.revisionDraft, draft); assert.deepEqual(state.revisedIntent, candidate);
      assert.ok(p.byLabel("document.copy.revise")); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    }
    await f.act(p.byLabel("document.copy.revise"));
    const folder = p.folder(); folder.port.value = "root"; await f.act(folder, "change");
    await f.act(p.form(), "submit"); await p.join();
    const review = h.store.documentCopyReview(target);
    assert.equal(review.phase, "review"); assert.equal(review.operationId, p.original.operationId);
    assert.equal(review.preview.duplication.collectionId, null); assert.equal(p.receipts().length, 0);
    assert.deepEqual(history(p), before); assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
    await f.act(p.byLabel("document.copy.apply")); await p.join();
    assert.equal(p.receipts().length, 1); assert.equal(h.store.documentCopyReview(target).receipt.operationId, p.original.operationId);
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
    assert.equal(p.calls().filter(row => row.body.action === "preview").length, 1);
    assert.equal(p.calls().filter(row => row.body.action === "revise").length, 2);
    assertNoPaidWork(p, money);
  });
}

for (const mode of ["lost", "extra-none", "server-error"]) {
  test("A only the exact successful none can carry a known refusal: " + mode, { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, "en"), { h, f, target } = p, money = financial(h.worker);
    const before = history(p), original = h.store.documentCopyReview(target);
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 200); assert.deepEqual(await response.clone().json(), { status: "none" });
      if (mode === "lost") throw new Error("named negative transport loss after actual read-only none");
      // Named negative transport corruption. Neither reply is positive server evidence.
      return mode === "extra-none" ? Response.json({ status: "none", unrelated: true })
        : Response.json({ error: "named_transient_failure" }, { status: 500 });
    };
    try { await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join(); } finally { h.intercept = null; }
    const state = h.store.documentCopyReview(target);
    assert.equal(state.operationId, original.operationId); assert.equal(state.previewId, "");
    assert.notEqual(state.issue, "document_duplicate_folder_unavailable");
    assert.equal(Boolean(p.byLabel("document.copy.revise")), false);
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(p.receipts().length, 0);
    assert.deepEqual(history(p), before); assertNoPaidWork(p, money);
  });
}

test("A genuine source withdrawal cannot revive a known refusal's private candidate", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "en"), { h, f, target } = p, old = h.store.captureSourceOwnership(), money = financial(h.worker);
  await h.deny(); await f.settle(); h.restore(); await h.store.refreshEvents(); await f.settle();
  assert.equal(h.store.sourceOwnershipActive(old), false);
  const privateState = h.store.documentCopyReview(target);
  assert.equal(privateState.operationId, p.original.operationId);
  assert.equal(privateState.intent, null); assert.equal(privateState.revisedIntent, null); assert.equal(privateState.revisionDraft, null);
  await f.act(p.open()); await p.join();
  const current = h.store.documentCopyReview(target);
  assert.equal(current.operationId, p.original.operationId); assert.notEqual(current.issue, "document_duplicate_folder_unavailable");
  assert.equal(Boolean(p.byLabel("document.copy.revise")), false); assert.equal(p.receipts().length, 0);
  assertNoPaidWork(p, money);
});
