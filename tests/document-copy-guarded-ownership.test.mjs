import assert from "node:assert/strict";
import test from "node:test";
import { financial, sceneDeferred } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork, awaitBoundary, copyHost, copyJson, exact } from "./helpers/document-copy-recovery-host.mjs";
import { eraseOriginal } from "./helpers/document-copy-erasure-host.mjs";
import { expiredUnknown, askGuardedEligibility, tuple, privateFields, history, changes, flaggedBody } from "./helpers/document-copy-continuity-host.mjs";

for (const outcome of ["live-lease", "committed-receipt"]) {
  test("C guarded ask respects the actual competing " + outcome + " after a real disclosure race", { timeout: 30_000 }, async t => {
    const p = await copyHost(t, "en"), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
    // A named transport failure at real client dispatch leaves the client
    // honestly uncertain. The server has not yet handled this first request.
    h.intercept = request => {
      if (request.url === "/api/documents/duplicate" && request.body.action === "apply")
        throw new Error("named transport loss before the original Apply reaches the Worker");
    };
    await f.act(p.byLabel("document.copy.apply")); await p.join(); h.intercept = null;
    assert.equal(h.store.documentCopyReview(target).commitSubmitted, true); assert.equal(p.receipts().length, 0);
    const entered = sceneDeferred(), release = sceneDeferred();
    let advanced = false, leased = false, competing = null, competingResult = null;
    h.worker.controls.beforeBatch = async statements => {
      if (!leased && statements.some(row => /\bINSERT INTO event_write_stage\b/u.test(row.sql))) {
        leased = true; entered.resolve(); await release.promise;
      }
    };
    h.worker.controls.beforeRead = async statement => {
      const sql = statement.sql;
      if (!advanced && /SELECT EXISTS\(SELECT 1 FROM private_content saved/u.test(sql) && /\bAS retained\b/u.test(sql)) {
        advanced = true;
        // The read has captured the real review wrapper. A different actual
        // request now claims (or commits) that SAME original operation before
        // final private disclosure. No fake response, row or deadline.
        competing = copyJson(p, exact(p, original, "apply"));
        await awaitBoundary(entered, competing, "actual competing Apply claim");
        if (outcome === "committed-receipt") { release.resolve(); competingResult = await competing; assert.equal(competingResult.response.status, 200); }
      }
    };
    try {
      // Deliberate existing Store API read: this is not a claim that the UI
      // exposes a flagged Check while its original private preview is present.
      const observed = await h.store.checkDocumentCopy(target, { includeRetirement: true }); await f.settle();
      assert.ok(advanced); assert.ok(leased);
      assert.deepEqual(p.calls().at(-1).body, flaggedBody(p, original));
      assert.equal(observed.guardedDismissAvailable, true);
      assert.equal(observed.phase, "uncertain"); assert.equal(observed.commitSubmitted, true);
      assert.ok(privateFields(observed).every(value => value === null)); assert.deepEqual(tuple(observed), tuple(original));
      assert.equal(observed.retirement, null); assert.equal(observed.receipt, null);
      assert.ok(p.byLabel("document.copy.discard"));
      h.worker.controls.beforeRead = null;
      await f.act(p.byLabel("document.copy.discard")); await p.join();
      const adjudicated = h.store.documentCopyReview(target);
      assert.deepEqual(tuple(adjudicated), tuple(original)); assert.equal(Boolean(adjudicated.guardedDismissAvailable), false);
      if (outcome === "live-lease") {
        assert.equal(adjudicated.phase, "applying"); assert.equal(adjudicated.receipt, null);
        assert.equal(p.receipts().length, 0); assert.ok(p.byLabel("document.copy.check"));
        assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
        release.resolve(); competingResult = await competing; assert.equal(competingResult.response.status, 200);
        await f.act(p.byLabel("document.copy.check")); await p.join();
      } else assert.equal(adjudicated.phase, "applied");
      assert.equal(competingResult.body.status, "applied");
      const current = h.store.documentCopyReview(target);
      assert.equal(current.phase, "applied"); assert.equal(current.receipt.documentId, competingResult.body.documentId);
      assert.equal(current.receipt.operationId, original.operationId); assert.equal(current.previewId, original.previewId);
      assert.equal(p.receipts().length, 1); assert.notEqual(JSON.parse(p.receipts()[0].result_json).dismissed, true);
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1, "the UI never sends a replacement Apply");
      assert.equal(p.calls().filter(row => row.body.action === "dismiss").length, 1);
      assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.ok(p.byLabel("context.changes.done"));
      assertNoPaidWork(p, money);
    } finally {
      release.resolve(); if (competing) await competing;
      h.worker.controls.beforeBatch = null; h.worker.controls.beforeRead = null; h.intercept = null;
    }
  });
}

for (const mode of ["status-500", "status-401", "status-404", "wrong-error", "extra-field", "array", "malformed-json", "lost"]) {
  test("C transport failures and unmatched flagged responses never authorize guarded dispatch: " + mode, { timeout: 30_000 }, async t => {
    const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker), before = history(p);
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 403); assert.deepEqual(await response.clone().json(), { error: "authoring_preview_unavailable" });
      // Negative response-corruption controls only; never a positive authority
      // substitute or a successful cancellation receipt.
      if (mode === "lost") throw new Error("named lost flagged Check response");
      if (mode === "malformed-json") return new Response("{", { status: 403, headers: { "content-type": "application/json" } });
      if (mode.startsWith("status-")) return Response.json({ error: "authoring_preview_unavailable" }, { status: Number(mode.slice(7)) });
      return Response.json(mode === "wrong-error" ? { error: "context_authorization_changed" }
        : mode === "extra-field" ? { error: "authoring_preview_unavailable", extra: true }
        : [{ error: "authoring_preview_unavailable" }], { status: 403 });
    };
    try { await f.act(p.byLabel("document.copy.check")); await p.join(); } finally { h.intercept = null; }
    const state = h.store.documentCopyReview(target), count = p.calls().length;
    assert.deepEqual(tuple(state), tuple(p.original)); assert.equal(state.commitSubmitted, true);
    assert.equal(Boolean(state.guardedDismissAvailable), false); assert.equal(state.receipt, null); assert.equal(state.retirement, null);
    assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    assert.equal(await h.store.dismissDocumentCopy(target, p.original.previewId, p.original.approvalHash), null);
    assert.equal(p.calls().length, count); assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), before);
    assertNoPaidWork(p, money);
  });
}

test("C current Store requires the exact retained target, preview and hash before a guarded dispatch", { timeout: 30_000 }, async t => {
  const p = await expiredUnknown(t), { h, target } = p, money = financial(h.worker);
  const { state } = await askGuardedEligibility(p), count = p.calls().length;
  for (const [scope, id, hash] of [
    [{ ...target, documentId: "not-the-original-document" }, state.previewId, state.approvalHash],
    [{ ...target, projectId: "not-the-original-project" }, state.previewId, state.approvalHash],
    [target, state.previewId + "-other", state.approvalHash],
    [target, state.previewId, "0".repeat(64)],
  ]) assert.equal(await h.store.dismissDocumentCopy(scope, id, hash), null);
  assert.equal(p.calls().length, count); assert.deepEqual(tuple(h.store.documentCopyReview(target)), tuple(state));
  assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
});

test("C genuine source retirement drops eligibility and requires a fresh exact Check after recovery", { timeout: 30_000 }, async t => {
  const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker);
  const { state } = await askGuardedEligibility(p), token = h.store.captureSourceOwnership();
  await h.deny(); await f.settle();
  const count = p.calls().length;
  assert.equal(await h.store.dismissDocumentCopy(target, state.previewId, state.approvalHash), null);
  assert.equal(p.calls().length, count);
  h.restore(); await h.store.refreshEvents(); await f.settle();
  assert.equal(h.store.sourceOwnershipActive(token), false);
  assert.equal(Boolean(h.store.documentCopyReview(target).guardedDismissAvailable), false);
  assert.equal(await h.store.dismissDocumentCopy(target, state.previewId, state.approvalHash), null);
  assert.equal(p.calls().length, count);
  await f.act(p.open()); await p.join(); assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
  const fresh = await askGuardedEligibility(p);
  assert.ok(fresh.state.request > state.request); assert.deepEqual(tuple(fresh.state), tuple(state));
  await f.act(p.byLabel("document.copy.discard")); await p.join();
  assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
});

test("C a genuine server denial at guarded dispatch retains the original and clears eligibility", { timeout: 30_000 }, async t => {
  const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker);
  await askGuardedEligibility(p); h.revoke();
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "dismiss") return;
    const response = await h.worker.request(request.url, request.init);
    actual = { status: response.status, body: await response.clone().json() }; return response;
  };
  try { await f.act(p.byLabel("document.copy.discard")); await p.join(); } finally { h.intercept = null; h.restore(); }
  assert.equal(actual.status, 403); assert.notEqual(actual.body.status, "dismissed");
  const current = h.store.documentCopyReview(target);
  assert.deepEqual(tuple(current), tuple(p.original)); assert.equal(Boolean(current.guardedDismissAvailable), false);
  assert.equal(current.commitSubmitted, true); assert.equal(p.receipts().length, 0); assert.equal(current.receipt, null);
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assertNoPaidWork(p, money);
});

for (const change of ["source", "actor", "permission-scope"]) {
  test("C a late matching Check cannot publish eligibility after " + change + " withdrawal", { timeout: 30_000 }, async t => {
    const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker), session = h.store.session.get();
    const entered = sceneDeferred(), release = sceneDeferred(); let pending;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
      const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
      assert.equal(response.status, 403); assert.deepEqual(body, { error: "authoring_preview_unavailable" });
      response.json = async () => { entered.resolve(); await release.promise; return body; }; return response;
    };
    try {
      await f.act(p.byLabel("document.copy.check")); pending = p.join(); await awaitBoundary(entered, pending, "actual flagged Check JSON");
      if (change === "source") {
        await h.deny(); await f.settle(); h.restore(); await h.store.refreshEvents(); await f.settle();
      } else {
        // Client identity withdrawal ports, not invented server authority or
        // a claimed live account switch. The real original response is held.
        h.store.session.set(change === "actor" ? { ...session, user: { ...session.user, userId: "different-actor-boundary" } }
          : { ...session, permissionEpoch: session.permissionEpoch + ":changed" });
        h.store.notify(); await f.settle();
      }
      release.resolve(); await pending; pending = null; h.intercept = null;
      const retained = Object.values(h.store.documentCopyReviews.get()).find(row => row.target.projectId === target.projectId && row.target.documentId === target.documentId);
      assert.ok(retained); assert.deepEqual(tuple(retained), tuple(p.original));
      assert.equal(Boolean(retained.guardedDismissAvailable), false); assert.equal(retained.receipt, null);
      const count = p.calls().length;
      assert.equal(await h.store.dismissDocumentCopy(target, p.original.previewId, p.original.approvalHash), null);
      assert.equal(p.calls().length, count); assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
    } finally { release.resolve(); if (pending) await pending; h.intercept = null; h.store.session.set(session); }
  });
}

for (const change of ["close-reopen", "route"]) {
  test("C an actual guarded acknowledgment cannot close or navigate a newer opening: " + change, { timeout: 30_000 }, async t => {
    const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker);
    await askGuardedEligibility(p);
    const entered = sceneDeferred(), release = sceneDeferred(); let pending, actual;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "dismiss") return;
      const response = await h.worker.request(request.url, request.init); actual = await response.clone().json();
      assert.equal(response.status, 200); assert.equal(actual.status, "dismissed");
      entered.resolve(); await release.promise; return response;
    };
    try {
      await f.act(p.byLabel("document.copy.discard")); pending = p.join(); await awaitBoundary(entered, pending, "actual guarded-dismiss acknowledgment");
      await f.act(p.byLabel("action.close"));
      if (change === "close-reopen") await f.act(p.open());
      else { h.store.setRoute("/studio/library"); await f.settle(); }
      const count = p.calls().length, writes = changes(p);
      release.resolve(); await pending; pending = null; h.intercept = null; await f.settle();
      assert.equal(h.store.documentCopyReview(target), null, "the actual original terminal acknowledgment is preserved");
      assert.equal(p.calls().length, count); assert.equal(changes(p), writes); assert.equal(p.receipts().length, 0);
      if (change === "close-reopen") assert.ok(p.byLabel("action.close"), "the newer current dialog remains open");
      else { assert.equal(h.store.route.get(), "/studio/library"); assert.equal(Boolean(p.byLabel("action.close")), false); }
      assertNoPaidWork(p, money);
    } finally { release.resolve(); if (pending) await pending; h.intercept = null; }
  });
}

test("C a later exact erasure certificate replaces ask eligibility and requires deliberate local Done", { timeout: 30_000 }, async t => {
  const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker);
  await askGuardedEligibility(p);
  // Existing explicit RAM retention-cleanup fixture. This is a separate state
  // transition control, not a prerequisite for ordinary guarded completion.
  await eraseOriginal(p, p.original.preview);
  await f.act(p.byLabel("document.copy.check")); await p.join();
  const state = h.store.documentCopyReview(target);
  assert.equal(state.phase, "retired"); assert.ok(state.retirement); assert.equal(state.commitSubmitted, true);
  assert.equal(Boolean(state.guardedDismissAvailable), false); assert.deepEqual(tuple(state), tuple(p.original));
  assert.equal(state.receipt, null); assert.ok(privateFields(state).every(value => value === null));
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.ok(p.byLabel("context.changes.done"));
  const count = p.calls().length;
  await f.act(p.byLabel("context.changes.done")); await p.join();
  assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.calls().length, count);
  assert.equal(p.receipts().length, 0); assertNoPaidWork(p, money);
});
