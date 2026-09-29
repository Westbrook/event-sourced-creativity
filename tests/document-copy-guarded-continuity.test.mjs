import assert from "node:assert/strict";
import test from "node:test";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork, exact } from "./helpers/document-copy-recovery-host.mjs";
import { expiredUnknown, askGuardedEligibility, history, tuple, privateFields } from "./helpers/document-copy-continuity-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("C explicit guarded disposition, then separate fresh review and Apply: " + locale, { timeout: 30_000 }, async t => {
    const p = await expiredUnknown(t, locale), { h, f, target } = p, money = financial(h.worker), events = history(p);
    const qualified = await askGuardedEligibility(p), original = p.original;
    assert.equal(qualified.state.commitSubmitted, true); assert.equal(qualified.state.retirement, null); assert.equal(p.receipts().length, 0);
    await f.act(p.byLabel("document.copy.discard")); await p.join();
    assert.deepEqual(p.calls().at(-1).body, { ...exact(p, original, "dismiss"), operationId: original.operationId, onlyIfUnapplied: true });
    assert.equal(h.store.documentCopyReview(target), null); assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), events);
    const row = h.worker.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE content_id=?").get(original.previewId);
    assert.equal(JSON.parse(row.content).state, "dismissed"); assert.equal(row.expires_at, "2020-01-01T00:00:00.000Z");
    assert.equal(p.calls().filter(row => row.body.action === "preview").length, 1, "completion never auto-starts another review");
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
    const fresh = await p.review();
    assert.notEqual(fresh.operationId, original.operationId); assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), events);
    await f.act(p.byLabel("document.copy.apply")); await p.join();
    assert.equal(p.receipts().length, 1); assert.equal(h.store.documentCopyReview(target).receipt.operationId, fresh.operationId);
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 2);
    assertNoPaidWork(p, money);
  });
}

test("C lost guarded-dismiss acknowledgment never resets the original; explicit exact recovery is idempotent", { timeout: 30_000 }, async t => {
  const p = await expiredUnknown(t), { h, f, target } = p, money = financial(h.worker), events = history(p);
  await askGuardedEligibility(p);
  let actual = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "dismiss") return;
    const response = await h.worker.request(request.url, request.init);
    actual = { status: response.status, body: await response.clone().json() };
    assert.equal(actual.status, 200); assert.deepEqual(actual.body, { status: "dismissed",
      previewId: p.original.previewId, approvalHash: p.original.approvalHash, operationId: p.original.operationId });
    throw new Error("named loss of the actual exact guarded-dismiss acknowledgment");
  };
  try { await f.act(p.byLabel("document.copy.discard")); await p.join(); } finally { h.intercept = null; }
  assert.ok(actual);
  const unknown = h.store.documentCopyReview(target);
  assert.deepEqual(tuple(unknown), tuple(p.original)); assert.equal(unknown.phase, "uncertain"); assert.equal(unknown.commitSubmitted, true);
  assert.equal(Boolean(unknown.guardedDismissAvailable), false); assert.ok(privateFields(unknown).every(value => value === null));
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join();
  assert.deepEqual(tuple(h.store.documentCopyReview(target)), tuple(p.original));
  assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
  await askGuardedEligibility(p); await f.act(p.byLabel("document.copy.discard")); await p.join();
  assert.equal(h.store.documentCopyReview(target), null);
  const dismissals = p.calls().filter(row => row.body.action === "dismiss");
  assert.equal(dismissals.length, 2); assert.deepEqual(dismissals[0].body, dismissals[1].body);
  assert.equal(p.calls().filter(row => row.body.action === "preview").length, 1);
  assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
  assert.equal(p.receipts().length, 0); assert.deepEqual(history(p), events); assertNoPaidWork(p, money);
});
