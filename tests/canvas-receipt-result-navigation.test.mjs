import assert from "node:assert/strict";
import test from "node:test";
import { receiptFixture, unchanged, close, documentPort, adaptiveProposalScope, turn, event, ITEM, listenerCounts } from "./helpers/canvas-receipt-result-navigation-host.mjs";

for (const locale of ["en", "fr", "ar", "ja"]) for (const action of ["inspect", "open-item"]) {
  test(locale + " exact model-native receipt " + action + " retains its own read identity without a planning guess", async () => {
    const h = await receiptFixture(locale), { f } = h;
    try {
      h.button.focus();
      if (action === "open-item") h.button.handlers.click.call(f.host, event(h.button));
      await f.flush(); await turn();
      assert.equal(f.proposalReview.receipt === h.receipt, true, "retain only the exact original receipt");
      if (action === "inspect") {
        assert.equal(f.proposalReview.visible, true); assert.equal(f.store.canvasPlanningDocumentId(), "document-0");
      } else {
        const target = f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]');
        assert.ok(target?.isConnected); assert.equal(documentPort.activeElement === target, true, "focus the selected exact native result");
        assert.deepEqual(f.state.selected, [ITEM]); assert.equal(f.proposalReview.visible, false);
        assert.equal(f.store.canvasPlanningDocumentId(), "", "global planning selection remains genuinely unresolved");
        assert.equal(adaptiveProposalScope(f.store, "document-0", "board-a"), null, "ordinary planning scope is not overridden");
        const scope = f.proposalReview.ports.scope(); assert.equal(scope?.key, h.scope.key); assert.equal(scope.documentId, "document-0");
        assert.equal(scope.canAuthor, false); assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
        for (const action of ["preview", "apply", "dismiss"]) await assert.rejects(f.proposalReview.ports.request({
          action, projectId: "p", documentId: "document-0", canvasId: "board-a" }), /adaptive_changes_scope_changed/u);
        assert.deepEqual(listenerCounts(f), h.listeners);
      }
      unchanged(h);
    } finally { close(h); }
  });
}
