import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { financial, readWorkspaceEvents } from "./helpers/event-source-retirement-fixture.mjs";
import { assertNoPaidWork, copyJson } from "./helpers/document-copy-recovery-host.mjs";
import { erasedHost, checkRetirement, privateFields } from "./helpers/document-copy-erasure-host.mjs";
const sourceImports = registerOutputSourceImports();
const { documentCopyOutcome, documentCopyRequest } = await import("../src/model/document-copy-review.ts").finally(() => sourceImports.deregister());

const faults = [
  ["operation", value => { value.operationId = crypto.randomUUID(); }],
  ["preview", value => { value.previewId = "copy-preview-" + "f".repeat(64); }],
  ["preview-shape", value => { value.previewId = "unknown-erased-preview"; }],
  ["actor", value => { value.retirement.actorUserId = "other-real-actor"; }],
  ["project", value => { value.retirement.projectId = "other-authorized-project"; }],
  ["document", value => { value.retirement.documentId = "other-authorized-document"; }],
  ["version", value => { value.retirement.version = "document-copy-erased-operation-v2"; }],
  ["meaning", value => { value.retirement.meaning = "no-receipt-in-this-document"; }],
  ["scope", value => { value.retirement.scope = "historical-document"; }],
  ["missing", value => { delete value.retirement.actorUserId; }],
  ["extra-body", value => { value.approvalHash = "a".repeat(64); }],
  ["extra-proof", value => { value.retirement.privateTitle = "PRIVATE_ERASED_TITLE"; }],
  ["array-proof", value => { value.retirement = [value.retirement]; }],
];
for (const [fault, corrupt] of faults) {
  test("an exact current Check rejects malformed/foreign erased-operation evidence: " + fault, { timeout: 30_000 }, async t => {
    const p = await erasedHost(t), { h, f, target } = p, before = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
    const retained = h.store.documentCopyReview(target);
    let wire = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.includeRetirement !== true) return;
      const response = await h.worker.request(request.url, request.init), actual = await response.clone().json();
      assert.equal(response.status, 200); assert.equal(actual.status, "retired");
      // Named transport corruption of a real Worker certificate. No fabricated positive acknowledgment.
      const corrupted = structuredClone(actual); corrupt(corrupted); wire = { actual, corrupted };
      return Response.json(corrupted);
    };
    await f.act(p.byLabel("document.copy.check")); await p.join(); h.intercept = null;
    assert.ok(wire); const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "uncertain"); assert.equal(Boolean(current.retirement), false); assert.equal(current.receipt, null);
    assert.equal(current.operationId, retained.operationId); assert.equal(current.previewId, retained.previewId); assert.equal(current.approvalHash, retained.approvalHash);
    assert.ok(privateFields(current).every(value => value === null));
    assert.equal(Boolean(p.byLabel("context.changes.done")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.ok(p.byLabel("document.copy.check"));
    assert.equal(await h.store.previewDocumentCopy(target, { title: "Cannot replace the original unknown owner" }), null);
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before); assert.equal(p.receipts().length, 0);
    const recovered = await checkRetirement(p); assert.equal(recovered.state.operationId, retained.operationId);
    assertNoPaidWork(p, money);
  });
}

test("only the flagged resume protocol admits the actual exact immutable retirement certificate", { timeout: 30_000 }, async t => {
  const p = await erasedHost(t, "en", false), state = p.h.store.documentCopyReview(p.target), actor = p.h.store.session.get().user.userId;
  const result = await copyJson(p, { action: "resume", ...p.target, operationId: state.operationId, includeRetirement: true });
  assert.equal(result.response.status, 200); assert.equal(result.body.status, "retired");
  assert.deepEqual(documentCopyRequest(state, "resume", { includeRetirement: true }),
    { action: "resume", ...p.target, operationId: state.operationId, includeRetirement: true });
  assert.deepEqual(documentCopyRequest(state, "resume"), { action: "resume", ...p.target, operationId: state.operationId });
  assert.throws(() => documentCopyRequest({ ...state, operationId: null }, "resume", { includeRetirement: true }), /document_copy_invalid_target/);
  for (const action of ["preview", "revise", "retrieve", "apply", "dismiss"]) {
    assert.throws(() => documentCopyRequest(state, action, { includeRetirement: true }), /document_copy_invalid_target/);
    assert.throws(() => documentCopyOutcome(state, action, result.body, true, { retirementActorUserId: actor }), /document_copy_identity_changed/);
  }
  assert.throws(() => documentCopyOutcome(state, "resume", result.body, true), /document_copy_identity_changed/);
  assert.throws(() => documentCopyOutcome(state, "resume", result.body, false, { retirementActorUserId: actor }), /document_copy_identity_changed/);
  const returned = documentCopyOutcome(state, "resume", result.body, true, { retirementActorUserId: actor });
  assert.equal(returned.phase, "retired"); assert.ok(Object.isFrozen(returned.retirement));
  assert.deepEqual(documentCopyRequest(returned, "resume", { includeRetirement: true }),
    { action: "resume", ...p.target, operationId: state.operationId, includeRetirement: true }, "a learned ID does not reconstruct an erased approval hash");
  assert.throws(() => documentCopyRequest({ ...state, approvalHash: "a".repeat(64) }, "resume", { includeRetirement: true }), /document_copy_receipt_missing/);
  const snapshot = structuredClone(returned.retirement);
  result.body.retirement.actorUserId = "mutated-reply-object"; result.body.retirement.projectId = "mutated-reply-target";
  assert.deepEqual(returned.retirement, snapshot, "the current certificate is an immutable copy, not the response object's later mutable identity");
});

test("an unsolicited real certificate on ordinary Store Check cannot unlock local completion", { timeout: 30_000 }, async t => {
  const p = await erasedHost(t, "en", false), { h, f, target } = p, original = h.store.documentCopyReview(target);
  const actual = await copyJson(p, { action: "resume", ...target, operationId: original.operationId, includeRetirement: true });
  assert.equal(actual.response.status, 200); assert.equal(actual.body.status, "retired");
  let injected = false;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
    assert.equal(request.body.includeRetirement, undefined);
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 403);
    injected = true;
    // Explicit negative transport: a valid certificate sent on an unflagged reply is still unsolicited.
    return Response.json(actual.body);
  };
  await h.store.checkDocumentCopy(target); await f.settle(); h.intercept = null;
  assert.equal(injected, true);
  const current = h.store.documentCopyReview(target);
  assert.equal(current.phase, "uncertain"); assert.equal(Boolean(current.retirement), false); assert.equal(current.operationId, original.operationId);
  assert.equal(Boolean(p.byLabel("context.changes.done")), false);
  const recovered = await checkRetirement(p); assert.equal(recovered.state.operationId, original.operationId);
});
