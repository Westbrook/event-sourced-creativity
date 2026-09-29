import assert from "node:assert/strict";
import test from "node:test";
import { financial, readWorkspaceEvents } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork } from "./helpers/document-copy-recovery-host.mjs";
import { erasedHost, checkRetirement } from "./helpers/document-copy-erasure-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) for (const known of [true, false]) {
  test("erased copy requires exact explicit Check then local Done then a new deliberate review: " + locale + "/" + known, { timeout: 30_000 }, async t => {
    const p = await erasedHost(t, locale, known), { h, f, target } = p, money = financial(h.worker);
    const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    const { state, observed } = await checkRetirement(p);
    assert.deepEqual(observed.request, { action: "resume", ...target, operationId: p.original.operationId, includeRetirement: true,
      ...(known ? { previewId: p.proposed.previewId, approvalHash: p.proposed.approvalHash } : {}) });
    assert.deepEqual(observed.body, { status: "retired", previewId: p.proposed.previewId, operationId: p.original.operationId,
      retirement: { version: "document-copy-erased-operation-v1", meaning: "globally-erased-unapplied", scope: "authorized-request",
        ...target, actorUserId: h.store.session.get().user.userId } });
    assert.equal(state.approvalHash, known ? p.proposed.approvalHash : "", "no erased approval hash is reconstructed");
    const message = f.i18n.t("document.copy.retired", undefined, { done: f.i18n.t("context.changes.done"), apply: f.i18n.t("document.copy.apply") });
    assert.notEqual(message, "document.copy.retired");
    assert.ok(p.paragraphs().some(node => node.text === message && node.attributes.role === "status"));
    assert.equal(f.tree().visible("input").filter(node => node.owner.tag === "forma-project-contents" && node.handlers.input?.toString().includes("#title")).length, 0);
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(Boolean(p.byLabel("document.copy.preview")), false);
    assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.ok(p.byLabel("context.changes.done"));
    const reads = p.calls().length;
    assert.equal(await h.store.previewDocumentCopy(target, { title: "Must not automatically replace this owner" }), null);
    await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
    assert.equal(p.calls().length, reads, "a certified current terminal handle survives Close/reopen without another request");
    assert.equal(h.store.documentCopyReview(target).retirement, state.retirement);
    const beforeDone = h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
    await f.act(p.byLabel("context.changes.done")); await p.join();
    assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.calls().length, reads, "local Done sends no request");
    assert.equal(h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n, beforeDone);
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before); assert.equal(p.receipts().length, 0);
    const fresh = await p.review(); assert.notEqual(fresh.operationId, p.original.operationId);
    assert.notEqual(fresh.previewId, p.proposed.previewId); assert.equal(p.receipts().length, 0);
    const attempts = p.calls().length;
    assert.equal(await h.store.dismissDocumentCopy(target, state.previewId, state.approvalHash,
      { operationId: state.operationId, request: state.request, retirement: state.retirement }), null, "an old terminal owner cannot clear the newer live review");
    assert.equal(p.calls().length, attempts); assert.equal(h.store.documentCopyReview(target).previewId, fresh.previewId);
    await f.act(p.byLabel("document.copy.apply")); await p.join();
    assert.equal(p.receipts().length, 1); assert.equal(h.store.documentCopyReview(target).receipt.operationId, fresh.operationId);
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(p.proposed.previewId), p.tombstone);
    assertNoPaidWork(p, money);
  });
}
