import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { sceneDeferred, financial, readWorkspaceEvents } from "./helpers/event-source-retirement-fixture.mjs";
import { awaitBoundary, copyHost, copyJson, exact, duplicateRequests, assertNoPaidWork, failedFolder, enterRevision } from "./helpers/document-copy-recovery-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) for (const mode of ["known", "held", "lost"]) {
  test("actual copy status retains exact submitted ownership: " + locale + "/" + mode, { timeout: 30_000 }, async t => {
    const p = await copyHost(t, locale), { h, f, target } = p;
    const initial = await p.review(), preview = structuredClone(initial.preview);
    const tuple = [initial.operationId, initial.previewId, initial.approvalHash, initial.destinationDocumentId];
    const money = financial(h.worker), before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    const tupleOf = row => [row.operationId, row.previewId, row.approvalHash, row.destinationDocumentId];
    const atomic = f.i18n.t("context.changes.atomic");
    assert.ok(p.paragraphs().some(node => node.text === atomic), "unsubmitted editable preview retains confirmation guidance");
    assert.ok(p.byLabel("document.copy.apply")); assert.equal(p.receipts().length, 0);
    const entered = sceneDeferred(), release = sceneDeferred();
    t.after(() => release.resolve());
    let held = false, lost = false;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return;
      if (mode === "held" && !held) { held = true; entered.resolve(); await release.promise; }
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 200, await response.clone().text());
      if (mode === "lost" && !lost) { lost = true; throw new Error("test transport loses actual committed copy response"); }
      return response;
    };
    await f.act(p.byLabel("document.copy.apply"));
    if (mode === "held") {
      await awaitBoundary(entered, p.join(), "Apply"); await f.settle();
      const state = h.store.documentCopyReview(target);
      assert.equal(state.phase, "applying"); assert.equal(state.busy, true);
      assert.deepEqual(tupleOf(state), tuple); assert.deepEqual(state.preview, preview);
      assert.ok(p.paragraphs().some(node => node.attributes.role === "status" && node.text === f.i18n.t("context.changes.applying")));
      assert.equal(p.paragraphs().some(node => node.text === atomic), false, "pending submitted work cannot promise that nothing changes until confirmation");
      assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
      assert.equal(p.receipts().length, 0, "held request has not reached the Worker");
      release.resolve();
    }
    await p.join();
    if (mode === "lost") {
      const state = h.store.documentCopyReview(target);
      assert.equal(state.phase, "uncertain"); assert.equal(state.receipt, null); assert.equal(state.commitSubmitted, true);
      assert.deepEqual(tupleOf(state), tuple); assert.deepEqual(state.preview, preview);
      assert.equal(p.receipts().length, 1, "actual Worker committed exactly one original copy before response loss");
      assert.ok(p.paragraphs().some(node => node.attributes.role === "status" && node.text === f.i18n.t("document.copy.uncertain")),
        "live status must describe the original submitted save uncertainty");
      assert.equal(p.paragraphs().some(node => node.text === atomic), false,
        "uncertain submitted save cannot say nothing changes until confirmation");
      assert.ok(p.byLabel("document.copy.check")); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
      assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
      assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
      await f.act(p.byLabel("document.copy.check")); await p.join();
      const check = p.calls().at(-1).body;
      assert.deepEqual(check, { action: "retrieve", ...target, previewId: tuple[1], approvalHash: tuple[2] });
    }
    const applied = h.store.documentCopyReview(target);
    assert.equal(applied.phase, "applied"); assert.deepEqual(tupleOf(applied), tuple);
    assert.equal(applied.receipt.documentId, initial.destinationDocumentId);
    assert.equal(applied.receipt.operationId, initial.operationId);
    assert.ok(p.paragraphs().some(node => node.attributes.role === "status" && node.text === f.i18n.t("context.changes.applied", "", { blocks: f.i18n.number(preview.blockCount), relations: f.i18n.number(preview.relationCount) })));
    assert.equal(p.receipts().length, 1); assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
    const after = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    assert.deepEqual(after.slice(0, before.length), before);
    assert.equal(after.length - before.length, preview.events.length);
    assert.equal(after.filter(row => row.type === "DocumentCreated" && row.payload.source_document_id === target.documentId).length, 1);
    assert.deepEqual(financial(h.worker), money); assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && row.init.method === "POST").length, 0);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("E expired exact unsubmitted review uses authoritative guarded discard: " + locale, { timeout: 30_000 }, async t => {
    const p = await copyHost(t, locale), { h, f, target } = p, original = await p.review();
    const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
    // Named RAM retention negative, not a cleanup-job or browser-clock claim.
    h.worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2020-01-01T00:00:00.000Z", original.previewId);
    // Close and reopen through the current controls. The existing re-entry
    // path performs the exact original Check; no hidden callback is invoked.
    await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
    const expired = h.store.documentCopyReview(target);
    assert.equal(expired.phase, "unavailable"); assert.equal(expired.preview, null); assert.equal(expired.intent, null);
    assert.equal(expired.previewId, original.previewId); assert.equal(expired.approvalHash, original.approvalHash);
    assert.ok(p.byLabel("document.copy.discard")); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    await f.act(p.byLabel("document.copy.discard")); await p.join();
    const request = duplicateRequests(p).at(-1);
    assert.deepEqual(request, { ...exact(p, original, "dismiss"), operationId: original.operationId, onlyIfUnapplied: true });
    assert.equal(h.store.documentCopyReview(target), null, "only the server's exact terminal acknowledgment releases this owner");
    assert.equal(h.worker.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(original.previewId).expires_at, "2020-01-01T00:00:00.000Z");
    assert.equal(p.receipts().length, 0); assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before);
    assertNoPaidWork(p, money);
    const fresh = await p.review(); assert.notEqual(fresh.operationId, original.operationId);
    assert.equal(p.receipts().length, 0, "a fresh explicit review still cannot create a copy");
    await f.act(p.byLabel("document.copy.apply")); await p.join();
    assert.equal(p.receipts().length, 1); assert.equal(h.store.documentCopyReview(target).receipt.operationId, fresh.operationId);
    assertNoPaidWork(p, money);
  });

  test("E another current request's committed receipt wins over Discard: " + locale, { timeout: 30_000 }, async t => {
    const p = await copyHost(t, locale), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
    const other = await copyJson(p, exact(p, original, "apply"));
    assert.equal(other.response.status, 200); assert.equal(other.body.status, "applied");
    assert.equal(h.store.documentCopyReview(target).receipt, null, "the original component has not seen the other request's receipt");
    await f.act(p.byLabel("document.copy.discard")); await p.join();
    const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "applied"); assert.equal(current.receipt.documentId, other.body.documentId);
    assert.equal(current.receipt.operationId, original.operationId); assert.equal(current.previewId, original.previewId);
    assert.equal(p.receipts().length, 1);
    assert.notEqual(JSON.parse(p.receipts()[0].result_json).dismissed, true, "guarded discard cannot hide a newly discovered receipt");
    assert.equal(duplicateRequests(p).filter(row => row.action === "apply").length, 0, "the UI sends no replacement Apply");
    assert.ok(p.byLabel("context.changes.done")); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    await f.act(p.byLabel("context.changes.done")); await p.join();
    assert.equal(h.store.documentCopyReview(target), null);
    assert.deepEqual(duplicateRequests(p).at(-1), exact(p, original, "dismiss"), "known applied Done keeps its existing protocol");
    assert.equal(p.receipts().length, 1); assertNoPaidWork(p, money);
  });

  for (const mode of ["requested", "saved-original", "lost-original"]) {
    test("F explicit same-operation free re-review: " + locale + "/" + mode, { timeout: 30_000 }, async t => {
      const p = await failedFolder(t, locale), { h, f, target } = p, money = financial(h.worker);
      const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
      const candidateTitle = "Unsubmitted revised draft · " + locale;
      await enterRevision(p, candidateTitle);
      let winner = null, revisedReply = null, revisedRequest = null;
      h.intercept = async request => {
        if (request.url !== "/api/documents/duplicate" || request.body.action !== "revise") return;
        revisedRequest = structuredClone(request.body);
        if (mode !== "requested") {
          // A separate authenticated request with the same operation wins first.
          // This is a real Worker/SQLite competitor, not a fabricated saved plan.
          const prior = await copyJson(p, { action: "revise", ...target, operationId: p.original.operationId,
            title: "Earlier canonical copy", collectionId: null });
          assert.equal(prior.response.status, 200); assert.equal(prior.body.status, "not-applied");
          winner = prior.body.preview;
        }
        const response = await h.worker.request(request.url, request.init);
        revisedReply = await response.clone().json(); assert.equal(response.status, 200, JSON.stringify(revisedReply));
        assert.equal(revisedReply.reviewDisposition, mode === "requested" ? "requested" : "saved-original");
        if (mode === "lost-original") throw new Error("test transport loses actual revised-review response");
        return response;
      };
      await f.act(p.form(), "submit"); h.intercept = null; await p.join();
      assert.deepEqual(revisedRequest, { action: "revise", ...target, operationId: p.original.operationId, title: candidateTitle, collectionId: null });
      assert.equal(p.receipts().length, 0); assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before);
      if (mode === "lost-original") {
        const unknown = h.store.documentCopyReview(target);
        assert.equal(unknown.phase, "uncertain"); assert.equal(unknown.previewId, "");
        assert.equal(unknown.operationId, p.original.operationId); assert.equal(unknown.revisedIntent.title, candidateTitle);
        assert.ok(p.byLabel("document.copy.check")); assert.equal(Boolean(p.byLabel("document.copy.revise")), false);
        assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
        let recoveryRead = null;
        h.intercept = async request => {
          if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
          const before = h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
          const response = await h.worker.request(request.url, request.init);
          recoveryRead = { before, after: h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n, status: response.status };
          return response;
        };
        await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join(); h.intercept = null;
        assert.deepEqual(duplicateRequests(p).at(-1), { action: "resume", ...target, operationId: p.original.operationId });
        assert.equal(recoveryRead.status, 200); assert.equal(recoveryRead.after, recoveryRead.before, "exact recovery is read-only, not another free preparation");
      }
      const reviewed = h.store.documentCopyReview(target);
      assert.equal(reviewed.phase, "review"); assert.equal(reviewed.operationId, p.original.operationId);
      assert.equal(reviewed.revisedIntent.title, candidateTitle);
      assert.equal(reviewed.preview.duplication.title, winner ? winner.duplication.title : candidateTitle);
      assert.equal(reviewed.intent.title, reviewed.preview.duplication.title);
      assert.equal(p.title().port.value, reviewed.preview.duplication.title, "the locked name describes the actual winning preview");
      if (winner) {
        assert.equal(reviewed.previewId, winner.previewId); assert.equal(reviewed.approvalHash, winner.approvalHash);
        assert.equal(reviewed.reviewDisposition, "saved-original");
        assert.ok(p.paragraphs().some(node => node.text === f.i18n.t("document.copy.savedOriginal")));
        assert.ok(p.paragraphs().some(node => node.text.includes(f.i18n.t("document.copy.revisedDraft")) && node.text.includes(candidateTitle)));
        await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
        assert.equal(h.store.documentCopyReview(target).revisedIntent.title, candidateTitle, "an unsubmitted candidate survives close/reopen");
      }
      assert.equal(duplicateRequests(p).filter(row => row.action === "apply").length, 0);
      assert.equal(duplicateRequests(p).filter(row => row.action === "preview").length, 1);
      assert.equal(duplicateRequests(p).filter(row => row.action === "revise").length, 1);
      await f.act(p.byLabel("document.copy.apply")); await p.join();
      const applied = h.store.documentCopyReview(target);
      assert.equal(applied.receipt.operationId, p.original.operationId); assert.equal(applied.previewId, reviewed.previewId);
      assert.equal(applied.receipt.documentId, reviewed.destinationDocumentId); assert.equal(p.receipts().length, 1);
      const apply = duplicateRequests(p).filter(row => row.action === "apply");
      assert.equal(apply.length, 1); assert.deepEqual(apply[0], exact(p, reviewed, "apply"));
      assertNoPaidWork(p, money);
    });
  }
}

test("E actual active Apply remains Check-only and its original receipt is recovered", { timeout: 30_000 }, async t => {
  const p = await copyHost(t, "en"), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
  const entered = sceneDeferred(), release = sceneDeferred(); let held = false;
  t.after(() => release.resolve());
  h.worker.controls.beforeBatch = async statements => {
    if (!held && statements.some(row => /\bINSERT INTO event_write_stage\b/u.test(row.sql))) {
      held = true; entered.resolve(); await release.promise;
    }
  };
  t.after(() => { h.worker.controls.beforeBatch = null; });
  const other = copyJson(p, exact(p, original, "apply"));
  try {
  await awaitBoundary(entered, other, "other original Apply");
  const active = JSON.parse(h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(original.previewId).content);
  assert.equal(active.state, "applying");
  await f.act(p.byLabel("document.copy.discard")); await p.join();
  assert.equal(h.store.documentCopyReview(target).phase, "applying");
  assert.equal(h.store.documentCopyReview(target).operationId, original.operationId);
  assert.ok(p.byLabel("document.copy.check")); assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(p.receipts().length, 0);
  release.resolve(); const saved = await other; assert.equal(saved.response.status, 200);
  await f.act(p.byLabel("document.copy.check")); await p.join();
  assert.equal(h.store.documentCopyReview(target).receipt.operationId, original.operationId);
  assert.equal(p.receipts().length, 1); assert.equal(duplicateRequests(p).filter(row => row.action === "apply").length, 0);
  assertNoPaidWork(p, money);
  } finally { release.resolve(); await other; h.worker.controls.beforeBatch = null; }
});

for (const retained of [true, false]) {
  test("F an earlier exact committed operation wins revised preparation: retained=" + retained, { timeout: 30_000 }, async t => {
    const p = await failedFolder(t, "en"), { h, f, target } = p, money = financial(h.worker);
    const candidate = "Retained but unsubmitted candidate";
    await enterRevision(p, candidate);
    const earlier = await copyJson(p, { action: "revise", ...target, operationId: p.original.operationId,
      title: "Actual earlier committed name", collectionId: null });
    assert.equal(earlier.response.status, 200); assert.ok(earlier.body.preview);
    const preview = earlier.body.preview;
    const saved = await copyJson(p, { action: "apply", ...target, previewId: preview.previewId, approvalHash: preview.approvalHash });
    assert.equal(saved.response.status, 200); assert.equal(saved.body.status, "applied");
    if (!retained) {
      // Named RAM retention-boundary port; committed rows and their canonical
      // result remain untouched while the private preview becomes unavailable.
      h.worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2020-01-01T00:00:00.000Z", preview.previewId);
    }
    const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    await f.act(p.form(), "submit"); await p.join();
    const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "applied"); assert.equal(current.reviewDisposition, "saved-original");
    assert.equal(current.previewId, preview.previewId); assert.equal(current.approvalHash, preview.approvalHash);
    assert.equal(current.receipt.operationId, p.original.operationId); assert.equal(current.receipt.documentId, saved.body.documentId);
    assert.equal(current.revisedIntent.title, candidate);
    assert.equal(Boolean(current.preview), retained);
    if (retained) assert.equal(current.preview.duplication.title, "Actual earlier committed name");
    else assert.ok(p.paragraphs().some(node => node.text === f.i18n.t("document.copy.applied")));
    assert.ok(p.paragraphs().some(node => node.text === f.i18n.t("document.copy.savedOriginal")));
    assert.ok(p.paragraphs().some(node => node.text.includes(f.i18n.t("document.copy.revisedDraft")) && node.text.includes(candidate)));
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
    assert.equal(p.calls().filter(row => row.body.action === "revise").length, 1);
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.ok(p.byLabel("context.changes.done"));
    assert.equal(p.receipts().length, 1); assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before);
    assertNoPaidWork(p, money);
  });
}

test("E a second actual Store's saved original wins the first current dialog's guarded discard", { timeout: 30_000 }, async t => {
  const p = await copyHost(t, "en"), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
  // Two actual Store instances share one authenticated in-memory Worker account.
  // This is not evidence of two humans, browser tabs, or independent live sessions.
  const other = await createSceneStoreHost({ workerFixture: h.worker });
  t.after(() => other.timers.clear()); // The first host alone owns/ closes this shared SQLite fixture.
  assert.notEqual(other.store, h.store);
  const read = await other.store.beginDocumentCopy(target);
  assert.equal(read.phase, "review"); assert.equal(read.previewId, original.previewId);
  assert.equal(read.approvalHash, original.approvalHash); assert.equal(read.operationId, original.operationId);
  let wire = null;
  other.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return;
    const response = await h.worker.request(request.url, request.init);
    wire = { status: response.status, body: await response.clone().json() }; return response;
  };
  const saved = await other.store.applyDocumentCopy(target, read.previewId, read.approvalHash);
  assert.equal(wire.status, 200); assert.equal(wire.body.status, "applied");
  assert.equal(saved.receipt.documentId, wire.body.documentId); assert.equal(saved.receipt.operationId, original.operationId);
  assert.equal(h.store.documentCopyReview(target).receipt, null);
  await f.act(p.byLabel("document.copy.discard")); await p.join();
  const current = h.store.documentCopyReview(target);
  assert.equal(current.phase, "applied"); assert.deepEqual(current.receipt, saved.receipt);
  assert.equal(current.previewId, original.previewId); assert.equal(current.approvalHash, original.approvalHash);
  assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
  assert.equal(other.requests.filter(row => row.url === "/api/documents/duplicate" && row.body.action === "apply").length, 1);
  assert.equal(p.receipts().length, 1); assert.ok(p.byLabel("context.changes.done"));
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assertNoPaidWork(p, money);
});
