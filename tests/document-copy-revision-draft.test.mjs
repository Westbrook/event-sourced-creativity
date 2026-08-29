import assert from "node:assert/strict";
import test from "node:test";
import { financial, sceneDeferred } from "./helpers/event-source-retirement-fixture.mjs";
import { failedFolder, enterRevision, assertNoPaidWork, awaitBoundary } from "./helpers/document-copy-recovery-host.mjs";

for (const [locale, title] of [["en", "New unsent copy"], ["fr", "  Nom partiel  "], ["ar", "مسودة جزئية   "], ["ja", ""]]) {
  test("F raw unsent revision survives Close/reopen without preparation: " + locale, { timeout: 30_000 }, async t => {
    const p = await failedFolder(t, locale), { h, f, target } = p;
    await enterRevision(p, title);
    const count = p.calls().length, money = financial(h.worker), operationId = p.original.operationId;
    const typed = p.title().port.value; assert.equal(typed, title);
    await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
    const state = h.store.documentCopyReview(target);
    assert.equal(state.phase, "editing"); assert.equal(state.operationId, operationId);
    assert.equal(p.calls().length, count, "Close/reopen neither prepares nor replaces this operation");
    t.diagnostic(JSON.stringify({ locale, expectedTitle: title, actualTitle: p.title().port.value, expectedFolder: "root", actualFolder: p.folder().port.value, operationId, requestsBefore: count, requestsAfter: p.calls().length }));
    assert.equal(state.revisionDraft.title, title);
    assert.equal(state.revisionDraft.collectionId, null);
    assert.equal(p.folder().port.value, "root");
    assert.equal(p.title().port.value, title, "the same current raw unsubmitted draft survives, including an empty name");
    assert.equal(p.receipts().length, 0); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    if (!title) assert.equal(Object.hasOwn(p.byLabel("document.copy.preview").attributes, "disabled"), true);
    assertNoPaidWork(p, money);
  });
}

test("F source retirement erases the raw unsent revision and cannot recertify it from generic source recovery", { timeout: 30_000 }, async t => {
  const p = await failedFolder(t, "en"), { h, f, target } = p;
  const privateTitle = "PRIVATE_RAW_UNSUBMITTED_COPY_NAME";
  await enterRevision(p, privateTitle);
  const originalSource = h.store.captureSourceOwnership(), auth = h.store.captureAuthorizationScope(), money = financial(h.worker);
  const key = JSON.stringify([target.projectId, target.documentId]);
  assert.equal(h.store.documentCopyReview(target).revisionDraft.title, privateTitle);
  await h.deny(); await f.settle();
  assert.equal(h.store.documentCopyReview(target), null);
  const retired = h.store.documentCopyReviews.get()[key];
  assert.equal(retired.operationId, p.original.operationId);
  assert.equal(retired.intent, null); assert.equal(retired.revisedIntent, null); assert.equal(retired.revisionDraft, null);
  assert.equal(JSON.stringify(retired).includes(privateTitle), false);
  assert.equal(h.store.sourceOwnershipActive(originalSource), false); assert.equal(h.store.authorizationScopeActive(auth), true);
  h.restore(); await h.store.refreshEvents(); await f.settle();
  assert.equal(h.store.sourceOwnershipActive(originalSource), false);
  await f.act(p.open()); await p.join();
  const current = h.store.documentCopyReview(target);
  assert.equal(current.operationId, p.original.operationId); assert.equal(current.phase, "unavailable");
  assert.equal(current.revisionDraft, null); assert.equal(current.revisedIntent, null);
  assert.equal(Boolean(p.byLabel("document.copy.revise")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  assert.equal(f.tree().nodes.some(node => node.text.includes(privateTitle)), false);
  assert.deepEqual(p.calls().at(-1).body, { action: "resume", ...target, operationId: p.original.operationId });
  assert.equal(p.calls().filter(row => ["preview", "revise"].includes(row.body.action)).length, 1);
  assertNoPaidWork(p, money);
});

test("F a late actual revised preview cannot republish retired candidate bytes after source recovery", { timeout: 30_000 }, async t => {
  const p = await failedFolder(t, "en"), { h, f, target } = p, privateTitle = "PRIVATE_HELD_REVISED_NAME";
  await enterRevision(p, privateTitle);
  const source = h.store.captureSourceOwnership(), auth = h.store.captureAuthorizationScope(), money = financial(h.worker);
  const entered = sceneDeferred(), release = sceneDeferred(), key = JSON.stringify([target.projectId, target.documentId]);
  t.after(() => release.resolve());
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "revise") return;
    const response = await h.worker.request(request.url, request.init);
    actual = await response.clone().json(); assert.equal(response.status, 200); assert.equal(actual.reviewDisposition, "requested");
    entered.resolve(); await release.promise; return response;
  };
  const pending = f.act(p.form(), "submit");
  try {
    await awaitBoundary(entered, pending, "actual revised preview");
    await h.deny(); await f.settle();
    assert.equal(h.store.documentCopyReview(target), null);
    const retired = h.store.documentCopyReviews.get()[key];
    assert.equal(retired.operationId, p.original.operationId); assert.equal(retired.revisedRequestSubmitted, true);
    assert.equal(retired.revisionDraft, null); assert.equal(retired.revisedIntent, null); assert.equal(retired.intent, null);
    assert.equal(JSON.stringify(retired).includes(privateTitle), false);
    h.restore(); await h.store.refreshEvents(); await f.settle();
    assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(h.store.authorizationScopeActive(auth), true);
    release.resolve(); await pending; h.intercept = null;
    const withheld = h.store.documentCopyReviews.get()[key];
    assert.equal(withheld.preview, null); assert.equal(withheld.revisedIntent, null); assert.equal(withheld.revisionDraft, null);
    assert.equal(withheld.operationId, p.original.operationId); assert.equal(withheld.previewId, "");
    assert.equal(JSON.stringify(withheld).includes(privateTitle), false);
    let read = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
      const before = h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
      const response = await h.worker.request(request.url, request.init);
      read = { status: response.status, before, after: h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n };
      return response;
    };
    await f.act(p.open()); await p.join(); h.intercept = null;
    const recovered = h.store.documentCopyReview(target);
    assert.deepEqual(p.calls().at(-1).body, { action: "resume", ...target, operationId: p.original.operationId });
    assert.equal(read.status, 200); assert.equal(read.after, read.before);
    assert.equal(recovered.phase, "review"); assert.equal(recovered.previewId, actual.preview.previewId);
    assert.equal(recovered.approvalHash, actual.preview.approvalHash); assert.equal(recovered.preview.duplication.title, privateTitle);
    assert.equal(recovered.reviewDisposition, "recovered"); assert.equal(recovered.revisedIntent, null); assert.equal(recovered.revisionDraft, null);
    assert.ok(p.paragraphs().some(node => node.text === f.i18n.t("document.copy.recoveredRevision")));
    assert.equal(p.calls().filter(row => row.body.action === "revise").length, 1);
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0); assert.equal(p.receipts().length, 0);
    assertNoPaidWork(p, money);
  } finally { release.resolve(); await pending; h.intercept = null; }
});
