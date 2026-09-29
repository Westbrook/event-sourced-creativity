import assert from "node:assert/strict";
import test from "node:test";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { copyHost, failedFolder, enterRevision, copyJson, assertNoPaidWork } from "./helpers/document-copy-recovery-host.mjs";

// Deliberately corrupted transport envelopes around actual Worker outcomes.
// They are client negative controls, never claims that the Worker emits them.
for (const fault of ["missing", "operation", "preview", "hash", "extra", "lost"]) {
  test("E an unverified guarded-dismiss reply keeps the sole original owner: " + fault, { timeout: 30_000 }, async t => {
    const p = await copyHost(t, "en"), { h, f, target } = p, review = await p.review(), money = financial(h.worker);
    let terminal = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "dismiss") return;
      const response = await h.worker.request(request.url, request.init);
      terminal = await response.clone().json(); assert.equal(response.status, 200); assert.equal(terminal.status, "dismissed");
      if (fault === "lost") throw new Error("test transport loses the actual terminal dismiss reply");
      const body = structuredClone(terminal);
      if (fault === "missing") { delete body.operationId; delete body.previewId; delete body.approvalHash; }
      if (fault === "operation") body.operationId = "foreign-operation-0001";
      if (fault === "preview") body.previewId = "foreign-preview";
      if (fault === "hash") body.approvalHash = "0".repeat(64);
      if (fault === "extra") body.replacement = true;
      return Response.json(body);
    };
    await f.act(p.byLabel("document.copy.discard")); await p.join();
    assert.ok(terminal); const current = h.store.documentCopyReview(target);
    assert.equal(current.phase, "uncertain"); assert.equal(current.operationId, review.operationId);
    assert.equal(current.previewId, review.previewId); assert.equal(current.approvalHash, review.approvalHash);
    assert.equal(current.receipt, null); assert.ok(p.byLabel("document.copy.check"));
    assert.equal(Boolean(p.byLabel("document.copy.apply")), false); assert.equal(Boolean(p.byLabel("document.copy.discard")), false);
    const count = p.calls().length;
    assert.equal(await h.store.previewDocumentCopy(target, { title: "Must not replace an unknown original" }), null);
    assert.equal(p.calls().length, count); assert.equal(p.receipts().length, 0);
    assertNoPaidWork(p, money);
  });
}

for (const fault of ["missing-disposition", "array-disposition", "false-requested", "operation", "project", "document"]) {
  test("F revised canonical replies cannot bypass exact identity or disposition: " + fault, { timeout: 30_000 }, async t => {
    const p = await failedFolder(t, "en"), { h, f, target } = p, money = financial(h.worker);
    await enterRevision(p, "Candidate for explicit request");
    let original = null;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "revise") return;
      if (fault === "false-requested") {
        const prior = await copyJson(p, { action: "revise", ...target, operationId: p.original.operationId,
          title: "Different earlier canonical name", collectionId: null });
        assert.equal(prior.response.status, 200); assert.ok(prior.body.preview);
      }
      const response = await h.worker.request(request.url, request.init);
      const body = await response.clone().json(); assert.equal(response.status, 200); assert.ok(body.preview); original = structuredClone(body);
      if (fault === "missing-disposition") delete body.reviewDisposition;
      if (fault === "array-disposition") body.reviewDisposition = ["requested"];
      if (fault === "false-requested") { assert.equal(body.reviewDisposition, "saved-original"); body.reviewDisposition = "requested"; }
      if (fault === "operation") body.preview.duplication.operationId = "foreign-operation-0001";
      if (fault === "project") body.preview.projectId = "foreign-project";
      if (fault === "document") body.preview.documentId = "foreign-source-document";
      return Response.json(body);
    };
    await f.act(p.form(), "submit"); h.intercept = null;
    const unknown = h.store.documentCopyReview(target); assert.ok(original);
    assert.equal(unknown.phase, "uncertain"); assert.equal(unknown.operationId, p.original.operationId);
    assert.equal(unknown.previewId, ""); assert.equal(unknown.revisedIntent.title, "Candidate for explicit request");
    assert.equal(Boolean(p.byLabel("document.copy.revise")), false); assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
    assert.equal(Boolean(p.byLabel("document.copy.discard")), false); assert.equal(p.receipts().length, 0);
    await f.act(p.byLabel("document.copy.check")); await p.join();
    const recovered = h.store.documentCopyReview(target);
    assert.deepEqual(p.calls().at(-1).body, { action: "resume", ...target, operationId: p.original.operationId });
    assert.equal(recovered.previewId, original.preview.previewId); assert.equal(recovered.approvalHash, original.preview.approvalHash);
    assert.equal(recovered.phase, "review"); assert.equal(recovered.operationId, p.original.operationId);
    assert.equal(p.calls().filter(row => row.body.action === "revise").length, 1);
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 0);
    assertNoPaidWork(p, money);
  });
}
