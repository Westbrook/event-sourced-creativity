import assert from "node:assert/strict";
import test from "node:test";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork } from "./helpers/document-copy-recovery-host.mjs";
import { repeatedRefusal, history } from "./helpers/document-copy-continuity-host.mjs";
import { interruptRefusalRead, freshExactRead } from "./helpers/document-copy-refusal-read-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("known revised refusal survives a lost read then deliberate exact Check/free review/separate Apply: " + locale,
    { timeout: 30_000 }, async t => {
      const p = await repeatedRefusal(t, locale), { h, f, target } = p, money = financial(h.worker);
      const source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope(), before = history(p);
      const { original, state: interrupted } = await interruptRefusalRead(p);
      assert.equal(interrupted.phase, "uncertain");
      const recovered = await freshExactRead(p), state = recovered.state;
      assert.equal(state.operationId, original.operationId); assert.equal(state.issue, "document_duplicate_folder_unavailable");
      assert.equal(state.phase, "unavailable"); assert.equal(state.commitSubmitted, false); assert.equal(state.previewId, "");
      assert.equal(h.store.sourceOwnershipActive(source), true); assert.equal(h.store.authorizationScopeActive(authority), true);
      assert.deepEqual(state.revisedIntent, original.revisedIntent); assert.deepEqual(state.revisionDraft, original.revisionDraft);
      assert.ok(p.byLabel("document.copy.revise")); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
      assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), before);
      const provenance = state.refusedRevision;
      assert.ok(provenance); assert.equal(Object.isFrozen(provenance), true);
      assert.equal(provenance.intent, state.intent); assert.equal(provenance.revisedIntent, state.revisedIntent);
      assert.equal(Object.isFrozen(provenance.intent), true); assert.equal(Object.isFrozen(provenance.revisedIntent), true);
      await f.act(p.byLabel("document.copy.revise"));
      const name = p.title(); name.port.value = "Explicit new correction · " + locale; await f.act(name, "input");
      const folder = p.folder(); folder.port.value = "root"; await f.act(folder, "change");
      const callCount = p.calls().length;
      await f.act(p.form(), "submit"); await p.join();
      const review = h.store.documentCopyReview(target);
      assert.equal(review.phase, "review"); assert.equal(review.operationId, original.operationId);
      assert.equal(review.preview.duplication.title, "Explicit new correction · " + locale);
      assert.equal(review.preview.duplication.collectionId, null); assert.equal(review.refusedRevision, undefined);
      assert.equal(p.calls().length, callCount + 1); assert.equal(p.calls().at(-1).body.action, "revise");
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
      assert.deepEqual(history(p), before); assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
      await f.act(p.byLabel("document.copy.apply")); await p.join();
      const saved = h.store.documentCopyReview(target);
      assert.equal(saved.phase, "applied"); assert.equal(saved.receipt.operationId, original.operationId);
      assert.equal(saved.refusedRevision, undefined); assert.equal(p.receipts().length, 1);
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
      assert.equal(p.calls().filter(row => row.body.action === "preview").length, 1);
      assert.equal(p.calls().filter(row => row.body.action === "revise").length, 2);
      assert.equal(h.worker.controls.bindings.every(count => count <= 100), true); assertNoPaidWork(p, money);
    });
}

for (const mode of ["server-error", "malformed-json", "extra-none", "array-none", "wrong-status", "folder-error"]) {
  test("nonqualifying read cannot unlock correction, but a later exact success can: " + mode, { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, "en"), { h } = p, money = financial(h.worker);
    const { original } = await interruptRefusalRead(p, mode);
    const recovered = await freshExactRead(p), state = recovered.state;
    assert.equal(state.operationId, original.operationId); assert.equal(state.issue, "document_duplicate_folder_unavailable");
    assert.equal(state.phase, "unavailable"); assert.ok(p.byLabel("document.copy.revise"));
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(p.receipts().length, 0);
    assert.deepEqual(state.revisedIntent, original.revisedIntent); assert.deepEqual(state.revisionDraft, original.revisionDraft);
    assertNoPaidWork(p, money);
  });
}

test("two interrupted exact reads preserve provenance without permitting an intermediate correction", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "ja"), money = financial(p.h.worker);
  const first = await interruptRefusalRead(p, "lost"), second = await interruptRefusalRead(p, "malformed-json");
  assert.equal(second.state.operationId, first.original.operationId);
  assert.equal(second.state.refusedRevision, first.state.refusedRevision);
  assert.ok(p.byLabel("document.copy.check"));
  const recovered = await freshExactRead(p);
  assert.equal(recovered.state.issue, "document_duplicate_folder_unavailable"); assert.ok(p.byLabel("document.copy.revise"));
  assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
});
