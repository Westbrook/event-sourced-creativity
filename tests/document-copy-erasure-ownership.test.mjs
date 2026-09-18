import assert from "node:assert/strict";
import test from "node:test";
import { financial, readWorkspaceEvents, sceneDeferred } from "./helpers/event-source-retirement-fixture.mjs";
import { awaitBoundary, assertNoPaidWork, copyHost, copyJson, exact } from "./helpers/document-copy-recovery-host.mjs";
import { erasedHost, checkRetirement, eraseOriginal, privateFields } from "./helpers/document-copy-erasure-host.mjs";

const doneOwner = state => ({ operationId: state.operationId, request: state.request, retirement: state.retirement });

for (const lost of [false, true]) {
  test("a real original applied receipt always wins opt-in Check after erasure: lost=" + lost, { timeout: 30_000 }, async t => {
    const p = await copyHost(t, "en"), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
    let committed = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return;
      const response = await h.worker.request(request.url, request.init);
      committed = { status: response.status, body: await response.clone().json() };
      assert.equal(committed.status, 200); assert.equal(committed.body.status, "applied");
      if (lost) throw new Error("named transport loss after the actual original canonical copy committed");
      return response;
    };
    await f.act(p.byLabel("document.copy.apply")); await p.join(); h.intercept = null;
    assert.ok(committed); assert.equal(p.receipts().length, 1);
    assert.equal(Boolean(h.store.documentCopyReview(target).receipt), !lost);
    await eraseOriginal(p, original.preview);
    const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    let observed = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
      const changes = h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
      const response = await h.worker.request(request.url, request.init);
      observed = { body: await response.clone().json(), status: response.status, request: structuredClone(request.body),
        changes, after: h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n };
      return response;
    };
    // The public Store option is an explicit read; the ordinary live-preview UI Check stays unflagged.
    await h.store.checkDocumentCopy(target, { includeRetirement: true }); await f.settle(); h.intercept = null;
    assert.ok(observed); assert.equal(observed.status, 200); assert.equal(observed.body.status, "applied");
    assert.equal(observed.after, observed.changes); assert.equal(observed.body.retirement, undefined);
    assert.deepEqual(observed.request, { action: "resume", ...target, operationId: original.operationId,
      previewId: original.previewId, approvalHash: original.approvalHash, includeRetirement: true });
    const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "applied"); assert.equal(Boolean(current.retirement), false);
    assert.equal(current.receipt.operationId, original.operationId); assert.equal(current.receipt.documentId, committed.body.documentId);
    assert.equal(current.previewId, original.previewId); assert.equal(current.approvalHash, original.approvalHash);
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.ok(p.byLabel("context.changes.done"));
    await f.act(p.byLabel("context.changes.done")); await p.join();
    assert.equal(h.store.documentCopyReview(target), null);
    assert.deepEqual(p.calls().at(-1).body, exact(p, original, "dismiss"), "known applied Done remains the existing server protocol, not local erasure completion");
    assert.equal(p.receipts().length, 1); assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before);
    assertNoPaidWork(p, money);
  });
}

test("an already submitted Apply that is globally fenced can finish only after actual erasure certification", { timeout: 30_000 }, async t => {
  const p = await copyHost(t, "en"), { h, f, target } = p, original = await p.review(), money = financial(h.worker);
  p.original = original; p.proposed = original.preview;
  const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
  const entered = sceneDeferred(), release = sceneDeferred(); let held = false, originalResponse = null, pending;
  h.worker.controls.beforeBatch = async statements => {
    if (!held && statements.some(row => /\bINSERT INTO event_write_stage\b/u.test(row.sql))) {
      held = true; entered.resolve(); await release.promise;
    }
  };
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return;
    const response = await h.worker.request(request.url, request.init);
    originalResponse = { status: response.status, body: await response.clone().json() };
    assert.notEqual(response.status, 200); assert.notEqual(originalResponse.body.status, "applied");
    throw new Error("named transport loses the real fenced original response, not a successful or invented receipt");
  };
  try {
    await f.act(p.byLabel("document.copy.apply")); pending = p.join(); await awaitBoundary(entered, pending, "original claimed Apply");
    const submitted = h.store.documentCopyReview(target);
    assert.equal(submitted.commitSubmitted, true); assert.equal(submitted.busy, true);
    const leased = JSON.parse(h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(original.previewId).content);
    assert.equal(leased.state, "applying"); assert.equal(p.receipts().length, 0);
    p.tombstone = await eraseOriginal(p, original.preview);
    release.resolve(); await pending; pending = null; h.intercept = null; h.worker.controls.beforeBatch = null;
    assert.ok(originalResponse); assert.equal(p.receipts().length, 0);
    assert.equal(h.store.documentCopyReview(target).phase, "uncertain"); assert.equal(h.store.documentCopyReview(target).commitSubmitted, true);
    let withdrawalReply = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "retrieve") return;
      const response = await h.worker.request(request.url, request.init);
      withdrawalReply = { status: response.status, body: await response.clone().json() }; return response;
    };
    await f.act(p.byLabel("document.copy.check")); await p.join(); h.intercept = null;
    const withheld = h.store.documentCopyReview(target);
    t.diagnostic(JSON.stringify({ originalResponse, withdrawalReply, phase: withheld.phase, commitSubmitted: withheld.commitSubmitted }));
    assert.equal(withdrawalReply.status, 403);
    assert.equal(withheld.phase, "uncertain"); assert.equal(withheld.commitSubmitted, true);
    assert.ok(privateFields(withheld).every(value => value === null));
    assert.equal(Boolean(p.byLabel("context.changes.done")), false); assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
    const { state } = await checkRetirement(p);
    assert.equal(state.commitSubmitted, true, "the server certificate, not the local submitted flag, proves the old writer is fenced");
    await f.act(p.byLabel("context.changes.done")); await p.join();
    assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.receipts().length, 0);
    const calls = p.calls().filter(row => row.body.action === "apply");
    assert.equal(calls.length, 1); assert.equal(calls[0].body.previewId, original.previewId);
    const fenced = await copyJson(p, exact(p, original, "apply"));
    assert.equal(fenced.response.status, 403); assert.notEqual(fenced.body.status, "applied");
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(original.previewId), p.tombstone);
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before); assertNoPaidWork(p, money);
  } finally { release.resolve(); if (pending) await pending; h.worker.controls.beforeBatch = null; h.intercept = null; }
});

test("a newer exact Check replaces only its certificate owner; an older Done proof cannot release it", { timeout: 30_000 }, async t => {
  const p = await erasedHost(t), { h, f, target } = p, first = (await checkRetirement(p)).state;
  // Explicit current Store read, not an old detached button invocation.
  const second = await h.store.checkDocumentCopy(target, { includeRetirement: true }); await f.settle();
  assert.equal(second.phase, "retired"); assert.ok(second.request > first.request); assert.notEqual(second.retirement, first.retirement);
  const calls = p.calls().length;
  assert.equal(await h.store.dismissDocumentCopy(target, first.previewId, first.approvalHash, doneOwner(first)), null);
  assert.equal(h.store.documentCopyReview(target).request, second.request); assert.equal(p.calls().length, calls);
  const copied = { ...doneOwner(second), retirement: Object.freeze({ ...second.retirement }) };
  assert.equal(await h.store.dismissDocumentCopy(target, second.previewId, second.approvalHash, copied), null, "equal data is not the exact owned certificate");
  await f.act(p.byLabel("context.changes.done")); await p.join(); assert.equal(h.store.documentCopyReview(target), null);
  assert.equal(p.calls().length, calls);
});

for (const known of [true, false]) test("genuine source retirement invalidates a certificate even after fresh source publication: " + known, { timeout: 30_000 }, async t => {
  const p = await erasedHost(t, "en", known), { h, f, target } = p, first = (await checkRetirement(p)).state, money = financial(h.worker);
  const token = h.store.captureSourceOwnership();
  await h.deny(); await f.settle(); assert.equal(h.store.sourceOwnershipActive(token), false);
  const whileDenied = p.calls().length;
  assert.equal(await h.store.dismissDocumentCopy(target, first.previewId, first.approvalHash, doneOwner(first)), null);
  assert.equal(p.calls().length, whileDenied);
  h.restore(); await h.store.refreshEvents(); await f.settle();
  assert.equal(h.store.sourceOwnershipActive(token), false, "fresh source does not revive the retired original generation");
  const withheld = h.store.documentCopyReview(target);
  assert.equal(withheld.operationId, first.operationId); assert.equal(Boolean(withheld.retirement), false);
  assert.equal(await h.store.dismissDocumentCopy(target, first.previewId, first.approvalHash, doneOwner(first)), null);
  await f.act(p.open()); await p.join();
  const current = await checkRetirement(p);
  assert.notEqual(current.state.retirement, first.retirement); assert.ok(current.state.request > first.request);
  await f.act(p.byLabel("context.changes.done")); await p.join(); assert.equal(h.store.documentCopyReview(target), null);
  assertNoPaidWork(p, money);
});

test("a late actual certificate cannot publish across genuine source retirement and recovery", { timeout: 30_000 }, async t => {
  const p = await erasedHost(t), { h, f, target } = p, original = h.store.documentCopyReview(target);
  const entered = sceneDeferred(), release = sceneDeferred(); let observed = null, pending;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
    const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(body.status, "retired"); observed = body;
    response.json = async () => { entered.resolve(); await release.promise; return body; };
    return response;
  };
  try {
    await f.act(p.byLabel("document.copy.check")); pending = p.join(); await awaitBoundary(entered, pending, "actual certificate JSON");
    await h.deny(); await f.settle(); h.restore(); await h.store.refreshEvents(); await f.settle();
    release.resolve(); await pending; pending = null; h.intercept = null; await f.settle();
    assert.ok(observed);
    const current = h.store.documentCopyReview(target);
    assert.equal(current.operationId, original.operationId); assert.equal(Boolean(current.retirement), false);
    assert.equal(current.phase, "unavailable"); assert.equal(current.receipt, null); assert.ok(privateFields(current).every(value => value === null));
    assert.equal(p.receipts().length, 0);
    await f.act(p.open()); await p.join(); const fresh = await checkRetirement(p);
    assert.equal(fresh.state.operationId, original.operationId);
    assert.notEqual(fresh.state.retirement, observed.retirement);
  } finally { release.resolve(); if (pending) await pending; h.intercept = null; }
});

test("ordinary unknown absence remains Check-only and cannot impersonate a retirement certificate", { timeout: 30_000 }, async t => {
  const p = await erasedHost(t, "en", false), { h, f, target } = p, original = h.store.documentCopyReview(target);
  // Named negative storage port: a missing record is not evidence of an irreversible erasure fence.
  h.worker.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(p.proposed.previewId);
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
    const response = await h.worker.request(request.url, request.init);
    actual = { status: response.status, body: await response.clone().json() }; return response;
  };
  await f.act(p.byLabel("document.copy.check")); await p.join(); h.intercept = null;
  assert.equal(actual.status, 200); assert.equal(actual.body.status, "none"); assert.equal(actual.body.retirement, undefined);
  const current = h.store.documentCopyReview(target);
  assert.equal(current.operationId, original.operationId); assert.equal(Boolean(current.retirement), false);
  assert.equal(Boolean(p.byLabel("context.changes.done")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.ok(p.byLabel("document.copy.check")); assert.equal(p.receipts().length, 0);
});

for (const change of ["close-reopen", "route"]) test("a late actual certificate leaves the newer current opening or route in control: " + change, { timeout: 30_000 }, async t => {
  const p = await erasedHost(t), { h, f, target } = p, original = h.store.documentCopyReview(target);
  const entered = sceneDeferred(), release = sceneDeferred(); let pending;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
    const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(body.status, "retired");
    entered.resolve(); await release.promise; return response;
  };
  try {
    await f.act(p.byLabel("document.copy.check")); pending = p.join(); await awaitBoundary(entered, pending, "actual current Check");
    await f.act(p.byLabel("action.close"));
    if (change === "close-reopen") await f.act(p.open());
    else { h.store.setRoute("/studio/library"); await f.settle(); }
    const beforeRelease = p.calls().length;
    release.resolve(); await pending; pending = null; h.intercept = null; await f.settle();
    const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "retired"); assert.equal(current.operationId, original.operationId);
    assert.equal(p.calls().length, beforeRelease); assert.equal(p.receipts().length, 0);
    if (change === "route") {
      assert.equal(h.store.route.get(), "/studio/library"); assert.equal(Boolean(p.byLabel("context.changes.done")), false);
      h.store.setRoute("/studio/project"); await f.settle(); await f.act(p.open()); await p.join();
    }
    assert.ok(p.byLabel("context.changes.done"), "only the current opening exposes the deliberate completion control");
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(Boolean(p.byLabel("document.copy.preview")), false);
    await f.act(p.byLabel("context.changes.done")); await p.join();
    assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.calls().length, beforeRelease);
  } finally { release.resolve(); if (pending) await pending; h.intercept = null; }
});
