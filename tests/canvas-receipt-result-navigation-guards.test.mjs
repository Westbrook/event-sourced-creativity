import assert from "node:assert/strict";
import test from "node:test";
import { receiptFixture, unchanged, close, documentPort, turn, event, ITEM, SOURCE_BLOCK, EXECUTION, BINDING, listenerCounts } from "./helpers/canvas-receipt-result-navigation-host.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const focusCount = f => f.trace.filter(value => value.startsWith("focus:")).length;
const resultTarget = f => f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]');
const ordinaryControl = f => f.native("button", node => node.attributes.class?.includes("canvas-focus-toggle"));
const changes = ["none", "pointer", "keyboard", "focus", "focus-ABA", "pointer-body", "same-document", "other-document",
  "selection-ABA", "route", "route-ABA", "board", "board-ABA", "actor", "authority", "authority-ABA", "access",
  "source-withdrawal", "source-ABA", "item-removed", "item-changed", "block-removed", "block-changed", "document-removed",
  "new-presentation", "new-review", "disconnect", "modal"];

for (const locale of ["en", "fr", "ar", "ja"]) for (const change of changes) {
  test(locale + " healthy exact receipt handoff yields to " + change, async () => {
    const h = await receiptFixture(locale), { f } = h, gate = deferred(), originalTick = f.tick;
    let renders = 0;
    f.tick = owner => {
      const completed = originalTick(owner);
      if (owner !== f.host) return completed;
      renders++; return completed.then(() => gate.promise);
    };
    try {
      h.button.focus(); h.button.handlers.click.call(f.host, event(h.button)); await turn();
      assert.ok(renders >= 2, "actual native Close and result render completions are held");
      assert.equal(f.proposalReview.receipt === h.receipt, true, "establish healthy read context before testing a later interruption");
      assert.equal(f.store.canvasPlanningDocumentId(), ""); assert.deepEqual(f.state.selected, [ITEM]);
      unchanged(h);
      const originalEvents = f.state.events.length, control = ordinaryControl(f);
      assert.ok(control?.isConnected);
      if (change === "pointer") documentPort.emit("pointerdown", control);
      if (change === "keyboard") documentPort.emit("keydown", control);
      if (change === "focus") control.focus();
      if (change === "focus-ABA") { control.focus(); documentPort.activeElement = documentPort.body; }
      if (change === "pointer-body") { documentPort.emit("pointerdown", control); control.focus(); documentPort.activeElement = documentPort.body; }
      if (change === "same-document" || change === "other-document") await f.select(change === "same-document" ? 0 : 1, "document");
      if (change === "selection-ABA") {
        await f.select(0, "document");
        const target = resultTarget(f); assert.ok(target?.isConnected);
        target.handlers.click.call(f.host, event(target)); f.draw();
        assert.deepEqual(f.state.selected, [ITEM]);
      }
      if (change === "route" || change === "route-ABA") {
        const previous = f.route; f.route = "/canvas/board-a/board-a?view=list"; f.draw();
        if (change === "route-ABA") { f.route = previous; f.draw(); }
      }
      if (change === "board" || change === "board-ABA") {
        f.state.boardId = "board-b"; f.draw();
        if (change === "board-ABA") { f.state.boardId = "board-a"; f.draw(); }
      }
      if (change === "actor" || change === "access") {
        const session = f.store.session.get;
        f.store.session.get = () => { const value = session(); return change === "actor"
          ? { ...value, user: { ...value.user, userId: "other-actor" } }
          : { ...value, canvas: { ...value.canvas, access: false } }; };
        f.draw();
      }
      if (change === "authority" || change === "authority-ABA") {
        f.state.authorization = "new-authority"; f.draw();
        if (change === "authority-ABA") { f.state.authorization = "actor-a"; f.draw(); }
      }
      if (change === "source-withdrawal" || change === "source-ABA") {
        // Read-only source metadata port, not a fabricated job or paid source.
        // The unchanged real controller observes its withdrawal revision.
        let withdrawalRevision = 1;
        f.store.adaptiveProposalSource = (documentId, canvasId, executionId) => {
          if (executionId !== EXECUTION) return null;
          f.proposalSourceReads.push({ documentId, canvasId, executionId });
          return { executionId: EXECUTION, bindingHash: BINDING, structure: null, readable: false, withdrawalRevision };
        };
        f.draw();
        if (change === "source-ABA") { withdrawalRevision = 0; f.draw(); }
      }
      if (change === "item-removed") f.append({ type: "CanvasItemRemoved", payload: { project_id: "p", canvas_id: "board-a", item_id: ITEM } });
      if (change === "item-changed") f.append({ type: "CanvasRegisterSet", payload: { project_id: "p", canvas_id: "board-a",
        item_id: ITEM, prop: "x", value: 900, hlc: { pt: Date.now(), c: 0, site: "external-fixture-change" } } });
      if (change === "block-removed") f.append({ type: "BlockRemoved", payload: { project_id: "p", canvas_id: "board-a", scope: "canvas", block_id: SOURCE_BLOCK } });
      if (change === "block-changed") f.append({ type: "BlockPropertyEdited", payload: { project_id: "p", canvas_id: "board-a", scope: "canvas",
        block_id: SOURCE_BLOCK, property_path: "text", old_value: "Previously saved original decision", new_value: "Changed exact result after opening" } });
      if (change === "document-removed") f.append({ type: "DocumentRemoved", payload: { project_id: "p", document_id: "document-0" } });
      const externalChange = ["item-removed", "item-changed", "block-removed", "block-changed", "document-removed"].includes(change);
      if (externalChange) {
        assert.equal(f.state.events.length, originalEvents + 1, "one explicitly seeded external change, not handoff authoring"); f.draw();
        if (change === "item-changed") assert.equal(f.store.canvasProjection.get().items.find(value => value.id === ITEM).x, 900);
        if (change === "block-changed") assert.equal(f.store.projection.get().libraryBlocks.find(value => value.id === SOURCE_BLOCK).properties.text, "Changed exact result after opening");
      }
      if (change === "new-presentation") { f.proposalReview.reopen(); f.draw(); }
      if (change === "new-review") { f.proposalReview.open("different-execution", ["/suggested_blocks/0"]); f.draw(); }
      if (change === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
      if (change === "modal") await f.sources();
      const currentEvents = JSON.stringify(f.state.events), before = focusCount(f), currentFocus = documentPort.activeElement;
      const route = f.store.route.get(), selection = [...f.state.selected];
      gate.resolve(true); await turn();
      assert.equal(focusCount(f) - before, change === "none" ? 1 : 0, "old handoff cannot move focus after a newer owner or input");
      if (change === "none") assert.equal(documentPort.activeElement === resultTarget(f), true);
      else assert.equal(documentPort.activeElement === currentFocus, true);
      assert.equal(f.store.route.get(), route); assert.deepEqual(f.state.selected, selection);
      unchanged({ ...h, events: currentEvents });
      if (change !== "disconnect") assert.deepEqual(listenerCounts(f), h.listeners);
      else { assert.equal(listenerCounts(f).pointerdown, 0); assert.equal(listenerCounts(f).focusin, 0); }
      if (["none", "pointer", "keyboard", "focus", "focus-ABA", "pointer-body", "modal"].includes(change)) {
        assert.equal(f.proposalReview.receipt === h.receipt, true);
        assert.equal(f.proposalReview.ports.scope()?.canAuthor, false);
        assert.equal(h.notifications.size, 1, "only the exact current read context remains observed");
      } else {
        assert.equal(h.notifications.size, 0, "invalidated contexts unsubscribe immediately");
      }
      if (["selection-ABA", "route-ABA", "board-ABA", "authority-ABA", "source-ABA"].includes(change)) {
        f.proposalReview.synchronize(); assert.equal(f.proposalReview.receipt, null, "returning old values cannot revive the retired context");
      }
    } finally { f.tick = originalTick; gate.resolve(true); await turn(); close(h); }
  });
}
