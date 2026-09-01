// Complete current Shell/Canvas/Store and RAM Worker. Only free chooser/settings
// actions run. One declared historical artifact has an unavailable private body;
// its actual authorized GET is held, never replaced with a success or a job.
import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, RAW, classed, inside, drain, reached, dialogs, boardPage, sceneDeferred }
  from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { canvasQueueDatabase } from "./helpers/canvas-source-queue-host.mjs";
import { accountCachePort } from "./helpers/event-source-retirement-fixture.mjs";
import { canvasIdFromRoute } from "../src/canvas/routes.ts";
import { documentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

const MISSING_ARTIFACT = "canvas-chooser-unavailable-story";
const MISSING_CONTENT = "canvas-chooser-expired-private-body";
const ARTIFACT_ITEM = "canvas-chooser-unavailable-story-card";
function one(f, tag, predicate = () => true) {
  const rows = f.components().filter(owner => owner.tag === tag && owner.isConnected && predicate(owner));
  assert.equal(rows.length, 1, "one current actual " + tag); return rows[0];
}
async function page(t) {
  const f = await boardPage(t);
  await registerCalmFullPageComponents(f, ["forma-workspace"]);
  await drain(f, 2);
  assert.equal(f.canvas.store, f.store); assert.equal(one(f, "forma-shell"), f.host);
  assert.equal(f.store.session.get().canvas.access, true);
  assert.ok(f.store.routeDataReady()); return f;
}
async function select(f, id, additive = false) {
  const row = f.find("article", value => value.owner === f.canvas && value.attributes["data-canvas-item-id"] === id);
  assert.ok(row.port.isConnected && !row.hiddenBy);
  await f.act(row, "click", { button: 0, shiftKey: additive, composedPath: () => [row.port] });
}
async function toggle(f, owner, open) {
  const row = f.find("button", value => value.owner === owner && classed(value, "ui-popover-trigger"));
  const panel = owner.querySelector(".ui-popover-panel");
  assert.ok(row.port.isConnected && panel?.isConnected);
  assert.equal(row.attributes.popovertarget, panel.getAttribute("id"));
  row.port.click(); await f.settle();
  assert.equal(owner.querySelector(".ui-popover-panel").matches(":popover-open"), open);
}
const intent = f => f.find("input", row => row.attributes["aria-label"] === "Describe what you want to explore");
async function raw(f, value) {
  const owner = one(f, "forma-ui-popover", row => classed(row, "canvas-intent-dock"));
  await toggle(f, owner, true);
  const field = intent(f); assert.ok(field.port.isConnected && !field.port.disabled);
  field.port.value = value; await f.act(field, "input");
  assert.equal(intent(f).port.value, value); await toggle(f, owner, false); return owner;
}
async function openChooser(f) {
  assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
  const control = f.find("button", row => row.owner === f.canvas && classed(row, "canvas-render-action"));
  assert.ok(control.port.isConnected && !control.hiddenBy && !control.port.disabled);
  await f.act(control, "click", { button: 0 }); await drain(f, 2);
  return chooser(f);
}
function chooser(f) {
  const tree = f.tree(), rows = tree.visible("dialog").filter(row => row.owner === f.canvas
    && classed(row, "canvas-render-dialog") && row.port.open);
  assert.equal(rows.length, 1, "one exact current native render chooser");
  assert.deepEqual(tree.nodes.filter(row => ["input", "textarea", "select"].includes(row.tag) && inside(row, rows[0])), [],
    "chooser contains choices, not the later editable configuration");
  return { tree, dialog: rows[0] };
}
function chooserButton(f, predicate) {
  const { tree, dialog } = chooser(f), rows = tree.visible("button").filter(row => inside(row, dialog) && predicate(row));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.isConnected && !rows[0].port.disabled); return rows[0];
}
async function closeChooser(f) {
  const button = chooserButton(f, row => row.attributes["aria-label"] === "Close render options");
  await f.act(button, "click", { button: 0 }); await drain(f, 2);
  assert.equal(dialogs(f).filter(row => row.owner === f.canvas && classed(row, "canvas-render-dialog")).length, 0);
}
function footer(f) {
  return chooserButton(f, row => classed(row, "text-button")
    && row.text === f.i18n.t("projects.openCreatorDocument", "Open document in Creator Workspace"));
}
function back(f) {
  return f.find("a", row => row.owner === f.canvas && row.attributes.href === "/canvas"
    && row.attributes["aria-label"] === f.i18n.t("canvas.backToProjectBoards", "Back to project boards"));
}
async function home(f, actor) {
  await reached(f, () => f.store.route.get() === "/canvas", "exact Boards destination after settled free work");
  assert.equal(canvasIdFromRoute(f.store.route.get()), null);
  assert.ok(f.canvas.isConnected);
  assert.ok(f.tree().visible("section").some(row => row.owner === f.canvas && classed(row, "canvas-home")));
  assert.equal(f.store.session.get().user.userId, actor); await f.sourceUnchanged();
}
async function document(f, actor) {
  const current = f.store.projection.get().documents.find(row => row.id === f.documentId);
  assert.ok(current && current.projectId === f.projectId);
  await reached(f, () => f.store.route.get() === withDocumentInRoute("/", current.id, current.title), "exact current Document");
  assert.equal(documentIdFromRoute(f.store.route.get()), f.documentId);
  assert.equal(f.store.projection.get().documentId, f.documentId);
  assert.equal(f.store.session.get().user.userId, actor);
  assert.ok(one(f, "forma-workspace").isConnected); assert.equal(f.canvas.isConnected, false);
  assert.equal(dialogs(f).length, 0); await f.sourceUnchanged();
}
for (const dirty of [false, true]) test("actual idle Canvas render footer " + (dirty ? "retains raw work until deliberate clear" : "opens the exact current Document"), options, async t => {
  const f = await page(t), actor = f.store.session.get().user.userId;
  await select(f, "lifecycle-card-a");
  const dock = dirty ? await raw(f, RAW) : null;
  const route = f.store.route.get(), source = f.store.captureSourceOwnership();
  await openChooser(f);
  const row = footer(f), requests = f.storeHost.requests.length, history = [...f.history];
  t.diagnostic("CANVAS_RENDER_FOOTER_PREREQUISITE " + JSON.stringify({ dirty, route, documentId: f.documentId,
    exactOwner: f.canvas.isConnected, nativeChooser: true, storeBusy: Boolean(f.store.busy.get()) }));
  await f.act(row, "click", { button: 0 }); await drain(f);
  await f.sourceUnchanged();
  if (!dirty) { await document(f, actor); return; }
  t.diagnostic("CANVAS_RENDER_FOOTER_REACHED " + JSON.stringify({ actualRoute: f.store.route.get(), expectedRoute: route,
    exactOwner: f.canvas.isConnected, requestDelta: f.storeHost.requests.length - requests }));
  assert.equal(f.store.route.get(), route, "the footer cannot retire hidden raw work");
  assert.ok(f.canvas.isConnected && f.store.sourceOwnershipActive(source));
  assert.equal(f.storeHost.requests.length, requests); assert.deepEqual(f.history, history);
  assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
  chooser(f); // Refusal must not close first and then discover the raw owner.
  await closeChooser(f);
  assert.equal(one(f, "forma-ui-popover", value => classed(value, "canvas-intent-dock")), dock);
  await toggle(f, dock, true); assert.equal(intent(f).port.value, RAW);
  const field = intent(f); field.port.value = ""; await f.act(field, "input");
  assert.equal(intent(f).port.value, ""); await toggle(f, dock, false);
  await openChooser(f); await f.act(footer(f), "click", { button: 0 }); await document(f, actor);
});

test("actual idle Canvas render chooser Close permits a fresh ordinary Boards exit", options, async t => {
  const f = await page(t), actor = f.store.session.get().user.userId;
  await select(f, "lifecycle-card-a"); await openChooser(f);
  assert.equal(Boolean(f.store.busy.get()), false);
  const requests = f.storeHost.requests.length;
  await closeChooser(f);
  assert.equal(f.storeHost.requests.length, requests, "closing idle choices starts no work");
  await f.act(back(f), "click", { button: 0 }); await home(f, actor);
});

test("actual pending free Canvas artifact preparation survives chooser Close until its original unavailable-content response settles", options, async t => {
  // Reuse the existing exact database-name router used by the full Canvas
  // arrangement host. The account port owns restoration of prior IndexedDB.
  accountCachePort(t);
  const accountIndexedDB = globalThis.indexedDB, queue = canvasQueueDatabase();
  globalThis.indexedDB = { open(name, version) {
    return name === "canvas-offline-queue-v1" ? queue.indexedDB.open(name, version) : accountIndexedDB.open(name, version);
  } };
  const f = await page(t), actor = f.store.session.get().user.userId;
  // Declared historical metadata with expired/unavailable retained content. This
  // is the existing real event-source setup port, not a fabricated provider job.
  await f.external("DocumentRenderCompleted", { document_id: f.documentId, artifact_id: MISSING_ARTIFACT,
    artifact_kind: "short_story", title: "Original story with unavailable private body", summary: "Retained output metadata",
    content_ref: MISSING_CONTENT, source_block_versions: [], item_count: 0, items: [] });
  await f.external("CanvasItemPlaced", { canvas_id: BOARD, item_id: ARTIFACT_ITEM, source_kind: "artifact",
    source_id: MISSING_ARTIFACT, block_type: "short_story", title: "Original story with unavailable private body",
    frame: { x: 0, y: 260, w: 300, h: 200, z: "b", rot: 0 } });
  await drain(f);
  const artifact = f.store.projection.get().libraryArtifacts.find(row => row.id === MISSING_ARTIFACT);
  assert.ok(artifact && artifact.documentId === f.documentId && artifact.contentRef === MISSING_CONTENT);
  assert.equal(f.store.content.get()[MISSING_CONTENT], undefined);
  await select(f, "lifecycle-card-a"); await select(f, ARTIFACT_ITEM, true);
  assert.deepEqual([...f.store.canvasPlanningSelection.get().itemIds].sort(), [ARTIFACT_ITEM, "lifecycle-card-a"].sort());
  await openChooser(f);
  const choice = chooserButton(f, row => row.children.some(child => typeof child !== "string" && child.tag === "span"
    && child.text === f.i18n.system("Short story")));
  assert.equal(Boolean(f.store.busy.get()), false);
  const counts = f.storeHost.worker.counts(), route = f.store.route.get(), source = f.store.captureSourceOwnership();
  const release = sceneDeferred(), prior = f.storeHost.intercept;
  let entered = false, returned = false, reads = 0;
  f.storeHost.intercept = async request => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/api/events" || url.searchParams.get("limit") !== "1" || url.searchParams.get("content") !== "1")
      return prior?.(request);
    assert.equal(request.init.method ?? "GET", "GET"); assert.equal(++reads, 1, "one original preparation read");
    const response = await f.storeHost.worker.request(request.url, request.init);
    assert.equal(response.status, 200, "the actual authorized Worker read completed, not a manufactured success");
    const body = await response.clone().json();
    assert.equal(Object.hasOwn(body.content ?? {}, MISSING_CONTENT), false, "the historical private body is genuinely unavailable");
    entered = true; await release.promise; returned = true; return response;
  };
  try {
    choice.port.click(); // Native dispatch does not await the actual async handler.
    await reached(f, () => entered, "Short story entered its actual free adoption preflight read");
    assert.ok(queue.transactions.some(transaction => transaction.completed
      && transaction.operations.some(operation => operation.method === "getAll")), "the real Canvas queue drained through the existing finite IndexedDB port");
    assert.equal(returned, false); assert.equal(Boolean(f.store.busy.get()), false);
    assert.deepEqual(f.storeHost.worker.counts(), counts, "no job/reservation/counter admission before this read");
    await f.sourceUnchanged();
    t.diagnostic("CANVAS_RENDER_PENDING_PREREQUISITE " + JSON.stringify({ route, documentId: f.documentId,
      artifactId: MISSING_ARTIFACT, entered, returned, reads, storeBusy: Boolean(f.store.busy.get()), originalStatus: 200 }));
    await closeChooser(f);
    const requests = f.storeHost.requests.length, history = [...f.history];
    await f.act(back(f), "click", { button: 0 }); await drain(f, 2);
    await f.sourceUnchanged(); assert.deepEqual(f.storeHost.worker.counts(), counts);
    t.diagnostic("CANVAS_RENDER_PENDING_REACHED " + JSON.stringify({ actualRoute: f.store.route.get(), expectedRoute: route,
      currentOwner: f.canvas.isConnected, returned, requestDelta: f.storeHost.requests.length - requests }));
    assert.equal(f.store.route.get(), route, "closing presentation cannot erase an unsettled local preparation operation");
    assert.ok(f.canvas.isConnected && f.store.sourceOwnershipActive(source));
    assert.equal(returned, false); assert.equal(f.storeHost.requests.length, requests); assert.deepEqual(f.history, history);
    assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
    release.resolve(); await reached(f, () => returned, "the same original response is delivered"); await drain(f);
    assert.equal(reads, 1); assert.equal(dialogs(f).length, 0, "unavailable adoption creates no configuration or result");
    assert.deepEqual(f.storeHost.worker.counts(), counts); await f.sourceUnchanged();
    await f.act(back(f), "click", { button: 0 }); await home(f, actor);
  } finally {
    release.resolve(); await drain(f); f.storeHost.intercept = prior;
  }
});
