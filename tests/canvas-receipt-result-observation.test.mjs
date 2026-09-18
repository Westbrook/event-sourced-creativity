import assert from "node:assert/strict";
import test from "node:test";
import { receiptFixture, unchanged, close, documentPort, turn, event, ITEM, EXECUTION, BINDING } from "./helpers/canvas-receipt-result-navigation-host.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const locale of ["en", "fr", "ar", "ja"]) for (const change of ["healthy-notifications", "route-ABA", "scope-port-ABA", "source-metadata-ABA"]) {
  test(locale + " exact handoff Store observation owns " + change + " without a render or recursive notification", async () => {
    const h = await receiptFixture(locale), { f } = h, gate = deferred(), tick = f.tick;
    f.tick = owner => { const rendered = tick(owner); return owner === f.host ? rendered.then(() => gate.promise) : rendered; };
    try {
      h.button.focus(); h.button.handlers.click.call(f.host, event(h.button)); await turn();
      assert.equal(h.notifications.size, 1); assert.equal(f.proposalReview.receipt === h.receipt, true);
      const route = f.store.route.get(), count = () => f.trace.filter(value => value.startsWith("focus:")).length;
      if (change === "healthy-notifications") { f.store.notify(); f.store.notify(); f.store.notify(); }
      if (change === "route-ABA") { f.store.setRoute("/canvas/board-a/board-a?view=list"); f.store.setRoute(route); }
      if (change === "scope-port-ABA") {
        // Scope port coverage only. Separate full Store tests prove the real
        // #applySession source-generation barrier without simulating its epoch.
        f.state.authorization = "different-scope"; f.store.notify(); f.state.authorization = "actor-a"; f.store.notify();
      }
      if (change === "source-metadata-ABA") {
        // Read-only withdrawal metadata, not Worker authority or an applied API.
        const original = f.store.adaptiveProposalSource;
        f.store.adaptiveProposalSource = (_document, _canvas, id) => id === EXECUTION
          ? { executionId: EXECUTION, bindingHash: BINDING, structure: null, readable: false, withdrawalRevision: 1 } : null;
        f.store.notify(); f.store.adaptiveProposalSource = original; f.store.notify();
      }
      assert.equal(h.notifications.size, change === "healthy-notifications" ? 1 : 0);
      const before = count(); gate.resolve(true); await turn();
      assert.equal(count() - before, change === "healthy-notifications" ? 1 : 0);
      if (change === "healthy-notifications") assert.equal(documentPort.activeElement === f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]'), true);
      else { f.proposalReview.synchronize(); assert.equal(f.proposalReview.receipt, null); }
      unchanged(h);
    } finally { f.tick = tick; gate.resolve(true); await turn(); close(h); }
  });
}
