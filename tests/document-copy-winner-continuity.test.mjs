import assert from "node:assert/strict";
import test from "node:test";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork, copyHost, failedFolder, enterRevision } from "./helpers/document-copy-recovery-host.mjs";
import { savedOriginalCandidate, history, changes, privateFields } from "./helpers/document-copy-continuity-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) for (const committed of [false, true]) {
  test("B original winner and unsubmitted candidate remain distinct across Close/reopen: " + locale + "/" + committed,
    { timeout: 30_000 }, async t => {
      const p = await savedOriginalCandidate(t, locale, committed), { h, f, target } = p, money = financial(h.worker);
      const events = history(p), receipts = p.receipts(), raw = p.winning.revisionDraft, candidate = p.winning.revisedIntent;
      for (let cycle = 0; cycle < 2; cycle++) {
        await f.act(p.byLabel("action.close")); await p.join();
        const closed = h.store.documentCopyReview(target);
        assert.deepEqual(closed.revisedIntent, candidate); assert.deepEqual(closed.revisionDraft, raw);
        if (committed) {
          assert.equal(closed.intent, null); assert.equal(closed.preview, null);
          assert.equal(closed.sourceTitle, ""); assert.equal(closed.sourceRevision, "");
          assert.deepEqual(closed.receipt, p.winning.receipt);
        }
        await f.act(p.open()); await p.join();
        const reopened = h.store.documentCopyReview(target);
        assert.equal(reopened.operationId, p.original.operationId); assert.equal(reopened.previewId, p.winner.previewId);
        assert.equal(reopened.phase, committed ? "applied" : "review"); assert.equal(reopened.reviewDisposition, "saved-original");
        assert.deepEqual(reopened.revisedIntent, candidate); assert.deepEqual(reopened.revisionDraft, raw);
        assert.ok(p.paragraphs().some(row => row.text.includes(p.candidate) && row.text.includes(f.i18n.t("document.copy.revisedDraft"))));
        assert.ok(p.paragraphs().some(row => row.text === f.i18n.t("document.copy.savedOriginal")));
        // Applied UI can omit redundant Check. This deliberately uses the
        // existing current Store read API, never a fabricated hidden UI button.
        const writes = changes(p); await h.store.checkDocumentCopy(target); await f.settle();
        assert.equal(changes(p), writes); assert.deepEqual(history(p), events); assert.deepEqual(p.receipts(), receipts);
        assert.equal(h.store.documentCopyReview(target).revisedIntent.title, p.candidate);
      }
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
      assert.equal(p.calls().filter(row => row.body.action === "revise").length, 1);
      if (committed) {
        await f.act(p.byLabel("context.changes.done")); await p.join();
        assert.equal(h.store.documentCopyReview(target), null, "only deliberate Done releases the record and unused candidate");
        assert.deepEqual(p.receipts().map(row => row.preview_id), receipts.map(row => row.preview_id));
        assert.deepEqual(history(p), events);
      }
      assertNoPaidWork(p, money);
    });
}

for (const revised of [false, true]) {
  test("B ordinary applied receipt compaction still erases private accepted intent: revised=" + revised, { timeout: 30_000 }, async t => {
    const p = revised ? await failedFolder(t, "en") : await copyHost(t, "en"), { h, f, target } = p;
    if (revised) { await enterRevision(p, "Accepted candidate"); await f.act(p.form(), "submit"); await p.join(); }
    else await p.review();
    const review = h.store.documentCopyReview(target), money = financial(h.worker);
    if (revised) assert.equal(review.reviewDisposition, "requested");
    await f.act(p.byLabel("document.copy.apply")); await p.join();
    const receipt = h.store.documentCopyReview(target).receipt;
    await f.act(p.byLabel("action.close")); await p.join();
    const compact = h.store.documentCopyReview(target);
    assert.equal(compact.phase, "applied"); assert.deepEqual(compact.receipt, receipt);
    assert.ok(privateFields(compact).every(value => value === null)); assert.equal(compact.sourceTitle, ""); assert.equal(compact.sourceRevision, "");
    assert.equal(p.receipts().length, 1); assertNoPaidWork(p, money);
  });
}

test("B source retirement irreversibly clears the unused candidate but keeps the actual original receipt", { timeout: 30_000 }, async t => {
  const p = await savedOriginalCandidate(t, "en", true), { h, f, target } = p, money = financial(h.worker);
  const receipt = p.winning.receipt, events = history(p), before = p.receipts(), token = h.store.captureSourceOwnership();
  await f.act(p.byLabel("action.close")); await h.deny(); await f.settle();
  h.restore(); await h.store.refreshEvents(); await f.settle();
  assert.equal(h.store.sourceOwnershipActive(token), false);
  const reference = h.store.documentCopyReview(target);
  assert.deepEqual(reference.receipt, receipt); assert.ok(privateFields(reference).every(value => value === null));
  await f.act(p.open()); await p.join(); await h.store.checkDocumentCopy(target); await f.settle();
  const restored = h.store.documentCopyReview(target);
  assert.equal(restored.revisedIntent, null); assert.equal(restored.revisionDraft, null); assert.deepEqual(restored.receipt, receipt);
  assert.equal(p.paragraphs().some(row => row.text.includes(p.candidate)), false);
  assert.deepEqual(history(p), events); assert.deepEqual(p.receipts(), before);
  assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0); assertNoPaidWork(p, money);
});
