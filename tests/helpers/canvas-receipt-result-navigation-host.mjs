import assert from "node:assert/strict";
import { fixture, documentPort, loadActual } from "./canvas-focus-repair-host.mjs";
import { buildAdaptiveProposalApplication } from "../../src/model/adaptive-proposal-application.ts";
import { suggestedSubtype } from "../../src/model/block-types.ts";

const { adaptiveProposalScope } = await loadActual("src/components/adaptive-proposal-review.ts");
const turn = () => new Promise(setImmediate);
const event = target => ({ type: "click", target, currentTarget: target, button: 0, shiftKey: false,
  composedPath: () => [target], preventDefault() {}, stopPropagation() {} });
const SOURCE_BLOCK = "receipt-native-block", ITEM = "receipt-native-item";
const EXECUTION = "original-paid-execution", BINDING = "b".repeat(64);
const listenerCounts = f => Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, (f.listeners.get(type) ?? []).length]));

// Model-shaped retained fixture setup, not a generation/API insertion claim.
// The full Canvas, real controller, event builder, resolver and renderers run.
// Store/resource/replies/native DOM remain the existing finite read-only ports.
async function receiptFixture(locale, kind = "subject") {
  const f = fixture({ populated: true, chosen: "document-0", documentCount: 2, locale });
  // The legacy full-render fixture's finite Store port has no base-element
  // subscription. Mirror its synchronous subscribe/notify contract explicitly.
  const notifications = new Set(), setRoute = f.store.setRoute;
  let notificationDepth = 0;
  f.store.subscribe = listener => { notifications.add(listener); return () => notifications.delete(listener); };
  f.store.notify = () => {
    assert.equal(notificationDepth, 0, "handoff observation must not recursively notify Store"); notificationDepth++;
    try { notifications.forEach(listener => listener()); } finally { notificationDepth--; }
  };
  f.store.setRoute = (...args) => { setRoute(...args); f.store.notify(); };
  const query = f.host.querySelector.bind(f.host);
  f.host.querySelector = selector => {
    const match = /^\[data-canvas-item-id="([^"]+)"\]$/u.exec(selector);
    if (!match) return query(selector);
    const matches = f.renderer.ownNodes(f.host, "article").filter(node => node.attributes["data-canvas-item-id"] === match[1]);
    return matches.length === 1 ? matches[0] : null;
  };
  const structure = { interpretation: "Original paid interpretation",
    active_decision: { type: "subject", label: "Next decision", prompt: "Choose an exact subject.", why: "Focus the work." },
    suggested_blocks: [{ type: kind, subtype: suggestedSubtype(kind), label: "Saved exact result",
      instruction: "Previously saved original decision", reason: "Make intent concrete.", relationship_to: "Audience" }], hidden_until_later: [] };
  const ids = [SOURCE_BLOCK, ITEM];
  const plan = buildAdaptiveProposalApplication({ projection: f.store.projection.get(), documentId: "document-0",
    canvasId: "board-a", structure, executionId: EXECUTION, bindingHash: BINDING,
    selections: [{ proposalId: "/suggested_blocks/0", placement: { x: 100, y: 100, w: 300, h: 210 } }], createId: () => ids.shift() });
  for (const input of plan.events) f.append(input); f.draw();
  const block = f.store.projection.get().libraryBlocks.find(value => value.id === SOURCE_BLOCK);
  assert.equal(block.scope, "canvas"); assert.equal(block.canvasId, "board-a"); assert.equal(block.documentId, "");
  assert.equal(f.host.querySelector('[data-canvas-item-id="absent-exact-id"]'), null);
  assert.equal(f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]')?.attributes["data-canvas-item-id"], ITEM);
  f.state.replies.push({ status: "none" });
  await f.click("button", node => node.handlers.click?.name === "#resumeProposalReview"); await f.flush();
  const receipt = { status: "applied", previewId: "original-preview", approvalHash: "a".repeat(64), executionId: EXECUTION,
    bindingHash: BINDING, selectionKey: "c".repeat(64), blockIds: [SOURCE_BLOCK], canvasItemIds: [ITEM],
    relationCount: 0, idempotent: true, createdAt: "2026-08-27T12:00:00Z", dismissed: false };
  f.state.replies.push({ status: "receipts", discovery: "destination", projectId: "p", documentId: "document-0",
    canvasId: "board-a", executionId: null, bindingHash: null, receipts: [receipt], nextCursor: null,
    pageSize: 20, readOnly: true, canApply: false, noPayment: true });
  await f.click("button", node => node.handlers.click?.toString().includes("discoverDestinationReceipts")); await f.flush();
  f.state.replies.push(receipt);
  await f.click("button", node => node.handlers.click?.toString().includes("chooseReceipt")); await f.flush();
  assert.equal(f.proposalReview.phase, "applied"); assert.equal(f.proposalReview.canOpen("canvas-item", ITEM), true);
  const button = f.native("button", node => node.handlers.click?.toString().includes('options.open("canvas-item", id)'));
  assert.ok(button?.isConnected && !button.disabled);
  return { wireReceipt: receipt, f, button, receipt: f.proposalReview.receipt, scope: f.proposalReview.ports.scope(),
    events: JSON.stringify(f.state.events), listeners: listenerCounts(f), notifications };
}
function unchanged(h) {
  assert.equal(JSON.stringify(h.f.state.events), h.events);
  assert.deepEqual(h.f.state.requests.map(value => value.body.action), ["resume", "receipts", "retrieve"]);
  assert.equal(h.f.state.batches.length, 0);
}
function close(h) { h.f.host.isConnected = false; h.f.host.disconnectedCallback(); assert.equal(h.notifications.size, 0, "no handoff subscription survives its Canvas owner"); }


export { receiptFixture, unchanged, close, documentPort, adaptiveProposalScope, turn, event, ITEM, SOURCE_BLOCK, EXECUTION, BINDING, listenerCounts };
