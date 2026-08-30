import assert from "node:assert/strict";
import test from "node:test";
import { BLOCK_TYPES, suggestedSubtype } from "../src/model/block-types.ts";
import { buildAdaptiveProposalApplication } from "../src/model/adaptive-proposal-application.ts";
import { receiptFixture, unchanged, close, documentPort, turn, event, ITEM, SOURCE_BLOCK } from "./helpers/canvas-receipt-result-navigation-host.mjs";

for (const kind of BLOCK_TYPES.map(value => value.type)) test("actual retained adaptive Canvas model shape " + kind, () => {
  const structure = { interpretation: "Original interpretation", active_decision: { type: kind, label: "Exact result",
    prompt: "Exact original decision.", why: "Current work." }, suggested_blocks: [], hidden_until_later: [] };
  let id = 0;
  const result = buildAdaptiveProposalApplication({ projection: { projectId: "p", libraryBlocks: [] },
    documentId: "original-document", canvasId: "original-board", structure, executionId: "original-execution",
    bindingHash: "b".repeat(64), selections: [{ proposalId: "/active_decision", placement: { x: 0, y: 0, w: 300, h: 210 } }],
    createId: () => ["exact-block", "exact-item"][id++] });
  assert.deepEqual(result.events.map(row => row.type), ["BlockCreated", "CanvasItemPlaced"]);
  const [block, item] = result.events.map(row => row.payload);
  assert.equal(block.scope, "canvas"); assert.equal(block.canvas_id, "original-board"); assert.equal(block.document_id, undefined);
  assert.equal(block.properties.subtype, suggestedSubtype(kind));
  assert.equal(item.source_kind, kind === "sketch" ? "sketch" : "block"); assert.equal(item.source_id, block.block_id);
  assert.deepEqual(result.blockIds, [block.block_id]); assert.deepEqual(result.canvasItemIds, [item.item_id]);
  if (!["subject", "sketch"].includes(kind)) return;
  const existing = { id: block.block_id, projectId: "p", documentId: "", canvasId: "original-board", scope: "canvas",
    type: kind, properties: block.properties, removed: false, locked: false };
  const edit = buildAdaptiveProposalApplication({ projection: { projectId: "p", libraryBlocks: [existing] },
    documentId: "original-document", canvasId: "original-board", structure, executionId: "original-execution", bindingHash: "b".repeat(64),
    selections: [{ proposalId: "/active_decision", targetBlockId: block.block_id, edit: { text: "Explicitly changed current decision." } }] });
  assert.ok(edit.events.every(row => row.type === "BlockPropertyEdited")); assert.deepEqual(edit.canvasItemIds, []);
  assert.deepEqual(edit.blockIds, [block.block_id]);
});

for (const locale of ["en", "fr", "ar", "ja"]) test(locale + " actual model-native sketch receipt opens its own item", async () => {
  const h = await receiptFixture(locale, "sketch"), { f } = h;
  try {
    assert.equal(f.store.projection.get().libraryBlocks.find(row => row.id === SOURCE_BLOCK).type, "sketch");
    assert.equal(f.store.canvasProjection.get().items.find(row => row.id === ITEM).sourceKind, "sketch");
    h.button.focus(); h.button.handlers.click.call(f.host, event(h.button)); await f.flush(); await turn();
    assert.equal(f.proposalReview.receipt === h.receipt, true);
    assert.equal(documentPort.activeElement === f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]'), true);
    assert.equal(f.store.canvasPlanningDocumentId(), ""); assert.equal(f.proposalReview.ports.scope()?.canAuthor, false);
    unchanged(h);
  } finally { close(h); }
});
