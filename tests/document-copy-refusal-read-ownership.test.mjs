import assert from "node:assert/strict";
import test from "node:test";
import { financial, sceneDeferred } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork, awaitBoundary, copyJson, enterRevision, failedFolder } from "./helpers/document-copy-recovery-host.mjs";
import { repeatedRefusal, history } from "./helpers/document-copy-continuity-host.mjs";
import { originalRead, assertCorrectionLocked, interruptRefusalRead, freshExactRead, holdExactRead } from "./helpers/document-copy-refusal-read-host.mjs";

for (const prior of ["never-refused-revision", "previous-revision-refused"]) {
  test("a newly dispatched unknown revision cannot borrow an older refusal: " + prior, { timeout: 30_000 }, async t => {
    const p = await (prior === "previous-revision-refused" ? repeatedRefusal(t, "en") : failedFolder(t, "en"));
    const { h, f, target } = p, money = financial(h.worker), before = history(p);
    await enterRevision(p, "New current unsaved request");
    let submitted = null;
    h.intercept = request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "revise") return;
      submitted = structuredClone(request.body);
      throw new Error("named transport loss after dispatch, before the new revision reaches the Worker");
    };
    try { await f.act(p.form(), "submit"); await p.join(); } finally { h.intercept = null; }
    const unknown = h.store.documentCopyReview(target);
    assert.ok(submitted); assert.equal(submitted.operationId, p.original.operationId);
    assert.equal(unknown.phase, "uncertain"); assert.equal(unknown.refusedRevision, undefined);
    assert.equal(unknown.revisedIntent.title, "New current unsaved request");
    await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
    assert.deepEqual(p.calls().at(-1).body, originalRead(p, unknown));
    const state = assertCorrectionLocked(p, unknown);
    assert.equal(state.refusedRevision, undefined); assert.equal(state.revisedIntent.title, unknown.revisedIntent.title);
    assert.deepEqual(history(p), before); assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
  });
}

for (const winner of ["preview", "applying", "receipt"]) {
  test("an actual same-operation canonical winner supersedes refusal provenance: " + winner, { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, "en"), { h, f, target } = p, money = financial(h.worker);
    const { original } = await interruptRefusalRead(p);
    const candidate = original.revisedIntent, raw = original.revisionDraft, before = history(p);
    const canonical = await copyJson(p, { action: "revise", ...target, operationId: original.operationId,
      title: "Actual earlier canonical request", collectionId: null });
    assert.equal(canonical.response.status, 200); assert.equal(canonical.body.status, "not-applied");
    const plan = canonical.body.preview;
    const entered = sceneDeferred(), release = sceneDeferred(); let competing = null, actual = null, held = false;
    if (winner === "applying") h.worker.controls.beforeBatch = async statements => {
      if (!held && statements.some(row => /\bINSERT INTO event_write_stage\b/u.test(row.sql))) {
        held = true; entered.resolve(); await release.promise;
      }
    };
    try {
      if (winner !== "preview") {
        competing = copyJson(p, { action: "apply", ...target, previewId: plan.previewId, approvalHash: plan.approvalHash });
        if (winner === "applying") await awaitBoundary(entered, competing, "actual competing original Apply");
        else { actual = await competing; assert.equal(actual.response.status, 200); }
      }
      await f.act(p.byLabel("document.copy.check")); await p.join();
      const current = h.store.documentCopyReview(target);
      assert.equal(current.phase, winner === "receipt" ? "applied" : winner === "preview" ? "review" : "applying");
      assert.equal(current.operationId, original.operationId); assert.equal(current.previewId, plan.previewId);
      assert.equal(current.refusedRevision, undefined); assert.notEqual(current.issue, "document_duplicate_folder_unavailable");
      assert.equal(current.reviewDisposition, "saved-original"); assert.deepEqual(current.revisedIntent, candidate);
      assert.deepEqual(current.revisionDraft, raw); assert.equal(Boolean(p.byLabel("document.copy.revise")), false);
      if (winner !== "preview") assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
      if (winner === "applying") {
        assert.ok(held); assert.equal(p.receipts().length, 0);
        release.resolve(); actual = await competing; assert.equal(actual.response.status, 200);
        await f.act(p.byLabel("document.copy.check")); await p.join();
      }
      if (winner === "preview") {
        assert.deepEqual(history(p), before); assert.equal(p.receipts().length, 0);
      } else {
        assert.equal(actual.body.status, "applied"); assert.equal(p.receipts().length, 1);
        const saved = h.store.documentCopyReview(target);
        assert.equal(saved.receipt.operationId, original.operationId); assert.equal(saved.receipt.documentId, actual.body.documentId);
        await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
        const reopened = h.store.documentCopyReview(target);
        assert.equal(reopened.receipt.documentId, saved.receipt.documentId);
        assert.deepEqual(reopened.revisedIntent, candidate); assert.deepEqual(reopened.revisionDraft, raw);
        assert.equal(reopened.refusedRevision, undefined);
      }
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0,
        "only the separately identified competing Worker request applied, not the UI");
      assert.equal(p.calls().filter(row => row.body.action === "revise").length, 1);
      assertNoPaidWork(p, money);
    } finally { release.resolve(); if (competing) await competing; h.worker.controls.beforeBatch = null; }
  });
}

test("actual source denial and restoration cannot restore private refusal provenance", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "en"), { h, f, target } = p, money = financial(h.worker);
  const { original } = await interruptRefusalRead(p), source = h.store.captureSourceOwnership();
  await h.deny(); await f.settle();
  const stored = Object.values(h.store.documentCopyReviews.get()).find(row => row.operationId === original.operationId);
  assert.ok(stored); assert.equal(stored.refusedRevision, undefined);
  for (const field of ["intent", "revisedIntent", "revisionDraft", "preview"]) assert.equal(stored[field], null);
  h.restore(); await h.store.refreshEvents(); await f.settle(); assert.equal(h.store.sourceOwnershipActive(source), false);
  await f.act(p.open()); await p.join();
  const current = h.store.documentCopyReview(target);
  assert.equal(current.operationId, original.operationId); assert.equal(current.refusedRevision, undefined);
  assertCorrectionLocked(p, original); assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
});

test("a held actual exact read cannot republish refusal after real source retirement and recovery", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "ja"), { h, f, target } = p, money = financial(h.worker);
  const { original } = await interruptRefusalRead(p), source = h.store.captureSourceOwnership(), held = await holdExactRead(p);
  try {
    await h.deny(); await f.settle(); h.restore(); await h.store.refreshEvents(); await f.settle();
    await held.finish(); assert.equal(h.store.sourceOwnershipActive(source), false);
    const retained = h.store.documentCopyReview(target);
    assert.equal(retained.refusedRevision, undefined); assert.equal(retained.revisedIntent, null); assert.equal(retained.revisionDraft, null);
    await f.act(p.open()); await p.join(); assertCorrectionLocked(p, original);
    assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
  } finally { await held.finish(); }
});

test("actual authenticated scope refresh clears original refusal ownership before a late exact read", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "en"), { h, f } = p, money = financial(h.worker);
  await interruptRefusalRead(p);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope(), held = await holdExactRead(p);
  try {
    h.worker.setScopedHeaders({}); await h.store.refreshSession(); await h.store.refreshEvents(); await f.settle();
    assert.equal(h.store.session.get().projectContext ?? null, null);
    assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(h.store.authorizationScopeActive(authorization), false);
    assert.deepEqual(h.store.documentCopyReviews.get(), {});
    await held.finish(); assert.deepEqual(h.store.documentCopyReviews.get(), {});
    assert.equal(Boolean(p.byLabel("document.copy.revise")), false); assert.equal(p.receipts().length, 0);
    assertNoPaidWork(p, money);
  } finally { await held.finish(); }
});

for (const boundary of ["actor", "authority"]) {
  test("a late exact read cannot regain correction after client " + boundary + " withdrawal", { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, "en"), { h, f, target } = p, money = financial(h.worker);
    await interruptRefusalRead(p);
    const session = h.store.session.get(), held = await holdExactRead(p);
    try {
      // Negative client identity/authority projection ports, not fabricated
      // server grants or a claim that a real account switch occurred.
      h.store.session.set(boundary === "actor" ? { ...session, user: { ...session.user, userId: "different-refusal-reader" } }
        : { ...session, projectContext: { ...session.projectContext,
          permissions: session.projectContext.permissions.filter(value => value !== "project.author") } });
      h.store.notify(); await f.settle(); await held.finish();
      const current = h.store.documentCopyReview(target), count = p.calls().length;
      if (boundary === "actor") assert.equal(current, null);
      else {
        assert.ok(current); assert.equal(current.refusedRevision, undefined);
        assert.equal(current.intent, null); assert.equal(current.revisedIntent, null); assert.equal(current.revisionDraft, null);
      }
      assert.equal(h.store.beginDocumentCopyRevision(target, held.original.operationId), null);
      assert.equal(p.calls().length, count); assert.equal(Boolean(p.byLabel("document.copy.revise")), false);
      assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
    } finally { await held.finish(); h.store.session.set(session); }
  });
}

for (const boundary of ["request", "intent", "revised-intent", "operation"]) {
  test("exact current-owner publication rejects a changed " + boundary + " during actual read JSON", { timeout: 30_000 }, async t => {
    const p = await repeatedRefusal(t, "en"), { h, f, target } = p, money = financial(h.worker);
    const { original } = await interruptRefusalRead(p), before = history(p), held = await holdExactRead(p);
    try {
      // Explicit negative Store-signal ownership ports. These do not invent
      // server receipts or pretend the disabled UI can issue parallel edits.
      const entries = h.store.documentCopyReviews.get(), key = JSON.stringify([target.projectId, target.documentId]), current = entries[key];
      const newer = { ...current, busy: false, phase: "uncertain", issue: "document_copy_uncertain" };
      if (boundary === "request") newer.request++;
      if (boundary === "intent") newer.intent = Object.freeze({ ...current.intent, title: "Different original intent" });
      if (boundary === "revised-intent") newer.revisedIntent = Object.freeze({ ...current.revisedIntent, title: "Different revised intent" });
      if (boundary === "operation") newer.operationId = "different-operation-boundary-123";
      h.store.documentCopyReviews.set({ ...entries, [key]: newer }); h.store.notify(); await f.settle();
      await held.finish();
      const state = h.store.documentCopyReview(target);
      assert.notEqual(state.issue, "document_duplicate_folder_unavailable");
      assert.equal(Boolean(p.byLabel("document.copy.revise")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
      assert.equal(h.store.beginDocumentCopyRevision(target, state.operationId), null);
      if (boundary === "request") assert.equal(state.request, newer.request);
      assert.equal(state.operationId, newer.operationId); assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), before);
      assertNoPaidWork(p, money);
      if (boundary === "request") {
        const recovered = await freshExactRead(p);
        assert.equal(recovered.state.operationId, original.operationId); assert.equal(recovered.state.issue, "document_duplicate_folder_unavailable");
        assert.ok(p.byLabel("document.copy.revise"), "the superseding current request still may recover its own unchanged intent");
      }
    } finally { await held.finish(); }
  });
}

test("wrong target calls cannot use another original's refusal provenance", { timeout: 30_000 }, async t => {
  const p = await repeatedRefusal(t, "en"), { h, target } = p, money = financial(h.worker);
  const { original } = await interruptRefusalRead(p), count = p.calls().length;
  for (const other of [{ ...target, projectId: "different-project" }, { ...target, documentId: "different-document" }]) {
    assert.equal(h.store.beginDocumentCopyRevision(other, original.operationId), null);
    assert.equal(await h.store.checkDocumentCopy(other), null);
  }
  assert.equal(p.calls().length, count); assertCorrectionLocked(p, original);
  const recovered = await freshExactRead(p); assert.equal(recovered.state.issue, "document_duplicate_folder_unavailable");
  assert.equal(recovered.state.operationId, original.operationId); assert.ok(p.byLabel("document.copy.revise"));
  assertNoPaidWork(p, money);
});
