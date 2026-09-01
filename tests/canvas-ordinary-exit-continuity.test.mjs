// Actual complete Shell/Canvas/Workspace/Store and RAM Worker; no replacement
// renderer, app method, permission tuple, provider response or mutation oracle.
// The existing board fixture keeps its strict original-Resume/private/fiscal
// after-hooks. These are finite native-control cases, not browser/AT evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, RAW, classed, inside, drain, reached, dialogs, boardPage }
  from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { documentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { canvasIdFromRoute } from "../src/canvas/routes.ts";

function one(f, tag, predicate = () => true) {
  const owners = f.components().filter(owner => owner.tag === tag && owner.isConnected && predicate(owner));
  assert.equal(owners.length, 1, "one current actual " + tag);
  return owners[0];
}
function popover(f, name) { return one(f, "forma-ui-popover", owner => classed(owner, name)); }
async function toggle(f, owner, open) {
  const trigger = f.find("button", row => row.owner === owner && classed(row, "ui-popover-trigger"));
  const panel = owner.querySelector(".ui-popover-panel");
  assert.ok(trigger.port.isConnected && panel?.isConnected);
  assert.equal(trigger.attributes.popovertarget, panel.getAttribute("id"));
  trigger.port.click();
  await f.settle();
  assert.equal(owner.querySelector(".ui-popover-panel").matches(":popover-open"), open);
  assert.equal(f.find("button", row => row.owner === owner && classed(row, "ui-popover-trigger")).attributes["aria-expanded"], String(open));
}
const intent = f => f.find("input", row => row.attributes["aria-label"] === "Describe what you want to explore");
async function setRaw(f, value) {
  const dock = popover(f, "canvas-intent-dock");
  await toggle(f, dock, true);
  const field = intent(f);
  assert.ok(field.port.isConnected && !field.port.disabled);
  field.port.value = value; await f.act(field, "input");
  assert.equal(intent(f).port.value, value);
  await toggle(f, dock, false);
  return dock;
}
async function selectCurrentDocument(f) {
  const row = f.find("article", item => item.owner === f.canvas && item.attributes["data-canvas-item-id"] === "lifecycle-card-a");
  assert.ok(row.port.isConnected);
  const item = f.store.canvasProjection.get().items.find(value => value.id === "lifecycle-card-a");
  assert.equal(item.canvasId, BOARD); assert.equal(item.sourceKind, "document");
  assert.equal(item.sourceId, f.documentId);
  await f.act(row, "click", { button: 0, composedPath: () => [row.port] });
  assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds, [item.id]);
  assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
}
async function exitControl(f, kind) {
  if (kind === "boards") {
    const row = f.find("a", item => item.owner === f.canvas && item.attributes.href === "/canvas"
      && item.attributes["aria-label"] === f.i18n.t("canvas.backToProjectBoards", "Back to project boards"));
    return { row, destination: "/canvas", dialog: null };
  }
  if (kind === "document") {
    const row = f.find("button", item => item.owner === f.canvas
      && item.text === f.i18n.t("projects.openCreatorDocument", "Open document in Creator Workspace"));
    const current = f.store.projection.get().documents.find(document => document.id === f.documentId);
    assert.ok(current && current.projectId === f.projectId);
    return { row, destination: withDocumentInRoute("/", current.id, current.title), dialog: null };
  }
  const menu = popover(f, "canvas-view-menu");
  // This fixture's direct child click does not synthesize the parent's capture
  // listener. Reuse an already-open native View panel instead of toggling it shut.
  const panel = menu.querySelector(".ui-popover-panel");
  assert.ok(panel?.isConnected);
  if (!panel.matches(":popover-open")) await toggle(f, menu, true);
  assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), true);
  assert.equal(f.find("button", row => row.owner === menu && classed(row, "ui-popover-trigger")).attributes["aria-expanded"], "true");
  await f.act(f.find("button", row => row.owner === menu
    && row.text === f.i18n.t("projects.sharingHeading", "Project sharing")), "click", { button: 0 });
  await drain(f, 2);
  const tree = f.tree(), current = tree.visible("dialog").filter(row => row.owner === f.canvas
    && row.attributes["aria-labelledby"] === "canvas-members-title" && row.port.open);
  assert.equal(current.length, 1, "the exact current owned informational sharing dialog");
  const dialog = current[0];
  assert.deepEqual(tree.nodes.filter(row => ["input", "textarea", "select"].includes(row.tag) && inside(row, dialog)), [],
    "this specific presentation has no editable control; sibling raw work is not exempt");
  const rows = tree.visible("a").filter(row => inside(row, dialog) && row.attributes.href === "/settings/workspaces"
    && row.text === f.i18n.t("projects.openSharingSettings", "Open sharing in Creator Workspace"));
  assert.equal(rows.length, 1);
  return { row: rows[0], destination: "/settings/workspaces", dialog: dialog.port };
}
function observeSharing(t, f) {
  const session = f.store.session.get(), authority = f.store.captureAuthorizationScope(), source = f.store.captureSourceOwnership();
  const prior = f.storeHost.intercept, startTrace = f.trace.length;
  const records = []; let last = "", originalResponses = 0;
  const state = () => ({ route: f.store.route.get(), actorSame: f.store.session.get()?.user.userId === session.user.userId,
    audience: f.store.session.get()?.audience ?? null, sessionObjectSame: f.store.session.get() === session,
    authoritySame: f.store.captureAuthorizationScope()?.key === authority?.key,
    originalSourceActive: f.store.sourceOwnershipActive(source),
    sourceGenerationSame: f.store.captureSourceOwnership()?.generation === source?.generation,
    currentSourceActive: f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),
    canvasConnected: f.canvas.isConnected, originalResponses });
  const record = (phase, detail = {}) => {
    const value = { phase, ...state(), ...detail }, text = JSON.stringify(value);
    if (text !== last) { records.push(value); last = text; }
  };
  // Passive public Store observations only: no navigation callback/method wraps.
  const unsubscribe = f.store.subscribe(() => record("store-publication"));
  f.storeHost.intercept = async request => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/api/session" || url.searchParams.get("audience") !== "creative") return prior?.(request);
    assert.equal(request.init.method ?? "GET", "GET");
    record("original-session-request", { method: "GET", path: "/api/session", requestedAudience: "creative" });
    const response = await f.storeHost.worker.request(request.url, request.init), body = await response.clone().json();
    originalResponses += 1;
    record("original-session-response", { status: response.status, responseAudience: body.audience ?? null,
      responseActorSame: body.user?.userId === session.user.userId,
      responsePermissionEpochSame: body.permissionEpoch === session.permissionEpoch,
      responseCapabilitiesSame: JSON.stringify(body.capabilities ?? []) === JSON.stringify(session.capabilities ?? []) });
    return response; // The exact original Worker response, not a replacement.
  };
  f.sharingDiagnostic = (phase, row) => {
    const tree = f.tree(), current = tree.visible("dialog").filter(value => value.owner === f.canvas
      && value.attributes["aria-labelledby"] === "canvas-members-title");
    const menu = f.components().find(owner => owner.tag === "forma-ui-popover" && owner.isConnected && classed(owner, "canvas-view-menu"));
    const active = f.native.document.activeElement;
    record(phase, { clickedTag: row?.tag ?? null, clickedConnected: Boolean(row?.port.isConnected),
      clickedHidden: Boolean(row?.hiddenBy), sharingDialogs: current.map(value => ({ open: Boolean(value.port.open),
        connected: value.port.isConnected, openAttribute: Object.hasOwn(value.port.attributes, "open"),
        labelMatches: value.port.matches('[aria-labelledby="canvas-members-title"]'),
        qualifiedLabelMatches: value.port.matches('dialog[aria-labelledby="canvas-members-title"]'),
        wrongLabelMatches: value.port.matches('[aria-labelledby="not-the-current-sharing-dialog"]'),
        rectCount: value.port.getClientRects().length,
        exactOwnerQuery: f.canvas.querySelector('dialog[aria-labelledby="canvas-members-title"]') === value.port })),
      openDialogCount: tree.visible("dialog").filter(value => value.port.open).length,
      viewOpen: Boolean(menu?.querySelector(".ui-popover-panel")?.matches(":popover-open")),
      active: active ? { tag: active.tag ?? active.tagName ?? null, id: active.getAttribute?.("id") ?? null,
        connected: Boolean(active.isConnected) } : null,
      nativeCloseCount: f.trace.slice(startTrace).filter(value => value.startsWith("close:")).length });
  };
  t.after(() => { unsubscribe(); f.storeHost.intercept = prior; delete f.sharingDiagnostic;
    for (const record of records) t.diagnostic("CANVAS_SHARING_NATIVE_STATE " + JSON.stringify(record)); });
}
async function click(f, row) {
  assert.ok(row.port.isConnected && !row.hiddenBy && !row.port.disabled);
  f.sharingDiagnostic?.("before-current-click", row);
  let prevented = false;
  await f.act(row, "click", { button: 0, preventDefault() { prevented = true; } });
  f.sharingDiagnostic?.("after-current-click", row);
  if (row.tag === "a") assert.equal(prevented, true, "ordinary anchor uses the current in-app handler");
}
async function arrived(f, kind, destination, actor) {
  await reached(f, () => f.store.route.get() === destination, "the actual exact " + kind + " destination");
  await drain(f, 2);
  assert.equal(f.store.session.get().user.userId, actor);
  assert.equal(f.store.projection.get().projectId, f.projectId);
  assert.ok(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()));
  assert.equal(dialogs(f).length, 0, "the departed presentation is not carried into the destination");
  if (kind === "boards") {
    assert.ok(f.canvas.isConnected);
    assert.equal(canvasIdFromRoute(f.store.route.get()), null, "the Boards URL selects no individual board; projection defaults need not be cleared");
    assert.ok(f.tree().visible("section").some(row => row.owner === f.canvas && classed(row, "canvas-home")));
  } else if (kind === "document") {
    assert.equal(documentIdFromRoute(f.store.route.get()), f.documentId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    assert.ok(one(f, "forma-workspace").isConnected);
    assert.equal(f.canvas.isConnected, false);
  } else {
    assert.ok(one(f, "forma-workspace-settings").isConnected);
    assert.equal(f.canvas.isConnected, false);
  }
  await f.sourceUnchanged();
}
for (const kind of ["boards", "document", "sharing"]) for (const raw of [false, true]) test(
  "actual Canvas " + kind + " exit " + (raw ? "retains raw work until deliberate clear" : "admits its clean current owner"),
  options, async t => {
    const f = await boardPage(t);
    // Actual current CEM constructors, registered before a synchronous route
    // may make the finite focus port inspect the complete destination tree.
    await registerCalmFullPageComponents(f, ["forma-workspace", "forma-workspace-settings"]);
    await drain(f, 2);
    if (kind === "sharing") observeSharing(t, f);
    const actor = f.store.session.get().user.userId;
    assert.equal(f.store.session.get().canvas.access, true);
    assert.equal(one(f, "forma-shell"), f.host);
    assert.equal(f.canvas.store, f.store);
    assert.ok(f.store.routeDataReady());
    if (kind === "document") await selectCurrentDocument(f);
    const dock = raw ? await setRaw(f, RAW) : null;
    const route = f.store.route.get(), source = f.store.captureSourceOwnership();
    const control = await exitControl(f, kind);
    assert.ok(control.row.port.isConnected && !control.row.hiddenBy);
    assert.notEqual(control.destination, route);
    t.diagnostic("CANVAS_ORDINARY_EXIT_PREREQUISITE " + JSON.stringify({
      kind, raw, route, destination: control.destination, boardId: f.store.canvasProjection.get().selectedCanvasId,
      documentId: f.documentId, exactOwner: f.canvas.isConnected, controlTag: control.row.tag,
      informationalDialog: Boolean(control.dialog), sourceActive: f.store.sourceOwnershipActive(source),
    }));
    if (!raw) {
      await click(f, control.row);
      await arrived(f, kind, control.destination, actor);
      return;
    }
    const requests = f.storeHost.requests.length, history = [...f.history];
    await click(f, control.row); await drain(f);
    await f.sourceUnchanged();
    t.diagnostic("CANVAS_ORDINARY_EXIT_REACHED " + JSON.stringify({
      kind, actualRoute: f.store.route.get(), expectedRoute: route,
      currentCanvasConnected: f.canvas.isConnected, requestDelta: f.storeHost.requests.length - requests,
    }));
    assert.equal(f.store.route.get(), route, "this ordinary exit cannot retire the raw current board owner");
    assert.ok(f.canvas.isConnected && f.store.sourceOwnershipActive(source));
    assert.equal(f.storeHost.requests.length, requests, "a refused exit starts no destination or proposal request");
    assert.deepEqual(f.history, history);
    assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
    if (kind === "sharing") {
      const live = dialogs(f).filter(row => row.owner === f.canvas
        && row.attributes["aria-labelledby"] === "canvas-members-title");
      assert.equal(live.length, 1, "refusal does not hide the owned presentation first");
      const tree = f.tree(), currentDialog = tree.visible("dialog").find(row => row.owner === f.canvas
        && row.attributes["aria-labelledby"] === "canvas-members-title" && row.port.open);
      const closes = tree.visible("button").filter(row => inside(row, currentDialog) && classed(row, "modal-close"));
      assert.equal(closes.length, 1);
      await click(f, closes[0]); await drain(f, 2);
    }
    assert.equal(popover(f, "canvas-intent-dock"), dock);
    await toggle(f, dock, true);
    assert.equal(intent(f).port.value, RAW, "closed raw whitespace/multilingual work remains exact");
    const field = intent(f); field.port.value = ""; await f.act(field, "input");
    assert.equal(intent(f).port.value, "");
    await toggle(f, dock, false);
    const fresh = await exitControl(f, kind);
    assert.equal(fresh.destination, control.destination, "the same exact destination is available after deliberate clear");
    await click(f, fresh.row);
    await arrived(f, kind, fresh.destination, actor);
  });


// C193: one real Add sources → References journey. This appends to the same
// full Canvas/Shell/RAM Worker family; the six original cases stay byte-exact.
import { withProjectTaskDocumentInRoute as canvasReferenceRoute } from "../src/model/routes.ts";
import { readWorkspaceEvents as canvasReferenceEvents } from "../worker/runtime.ts";
import { financial as canvasReferenceFinancial } from "./helpers/event-source-retirement-fixture.mjs";

import { canvasQueueDatabase as canvasReferenceQueue } from "./helpers/canvas-source-queue-host.mjs";
import { accountCachePort as canvasReferenceAccountCache } from "./helpers/event-source-retirement-fixture.mjs";
import { isOutputFixtureReadOnlyResume as canvasReferenceResumeCandidate } from "./helpers/output-reachability-fixture.mjs";

// Root-authorized declared setup: place the already-owned bootstrap reference
// exactly once through its native row. No new reference, asset or provider call.
async function prepareCanvasReferencePlacement(t, { f, h, canvas, native, history, resume, boardId, projectId }, queue) {
  const activate = async row => {
    assert.ok(row.port.isConnected && !row.hiddenBy && !row.port.matches(":disabled"));
    native.emit("pointerdown", row.port); native.focus(row.port);
    await f.act(row, "click", { button: 0 }); await drain(f, 2);
  };
  const references = f.store.projection.get().libraryBlocks.filter(block => block.type === "reference" && block.projectId === projectId);
  assert.equal(references.length, 1, "reuse the existing single bootstrap reference, never replace the Source");
  const reference = references[0], originalReference = structuredClone(reference);
  assert.equal(f.store.canvasProjection.get().items.some(item => item.sourceId === reference.id), false);
  await activate(f.find("button", row => row.owner === canvas && classed(row, "canvas-sources-toggle")));
  let tree = f.tree(), dialog = tree.visible("dialog").find(row => row.owner === canvas && classed(row, "canvas-add-dialog") && row.port.open);
  assert.ok(dialog);
  const categories = tree.nodes.filter(row => row.owner === canvas && inside(row, dialog)
    && row.tag === "forma-ui-choice-card" && row.attributes["data-add-category"] === "reference");
  assert.equal(categories.length, 1);
  const choices = tree.visible("button").filter(row => inside(row, categories[0]));
  assert.equal(choices.length, 1); await activate(choices[0]);
  tree = f.tree(); dialog = tree.visible("dialog").find(row => row.owner === canvas && classed(row, "canvas-add-dialog") && row.port.open);
  assert.ok(dialog);
  const lists = tree.visible("div").filter(row => inside(row, dialog) && classed(row, "canvas-source-list"));
  assert.equal(lists.length, 1);
  const rows = tree.visible("button").filter(row => row.owner === canvas && inside(row, lists[0]));
  assert.equal(rows.length, 1);
  const row = rows[0], titles = tree.visible("b").filter(value => inside(value, row)), bodies = tree.visible("small").filter(value => inside(value, row));
  assert.equal(titles.length, 1); assert.equal(bodies.length, 1);
  assert.equal(titles[0].text, String(reference.properties.label ?? reference.handle));
  const bodyText = bodies[0].text, title = titles[0].text;
  await resume.settleOriginalRequests(); await h.worker.drainBackground();
  const before = { history: await canvasReferenceEvents(h.worker.env, h.worker.streamId), money: canvasReferenceFinancial(h.worker),
    privateContent: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
    receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    route: f.store.route.get(), browserHistory: [...history], source: f.store.captureSourceOwnership(),
    authority: f.store.captureAuthorizationScope(), documentId: f.store.projection.get().documentId };
  assert.equal(resume.pendingOriginalCount(), 0);
  const prior = h.transport; assert.equal(typeof prior, "function");
  let original = null, originalInit = null, originalBytes = "", pending = null, proof = null, failure = null;
  const isOriginal = request => Boolean(proof && request === original && request.init === originalInit
    && request.init.body === originalBytes && JSON.stringify(request.body) === originalBytes);
  const observe = async request => {
    originalInit = request.init; originalBytes = request.init.body;
    const envelope = JSON.parse(originalBytes);
    assert.deepEqual(Object.keys(envelope).sort(), ["action", "clientId", "events"]);
    assert.equal(envelope.action, "canvas_sync"); assert.equal(envelope.clientId, "web:canvas"); assert.equal(envelope.events.length, 1);
    const input = envelope.events[0], payload = input.payload;
    assert.equal(input.type, "CanvasItemPlaced");
    assert.equal(payload.project_id, projectId); assert.equal(payload.canvas_id, boardId);
    assert.equal(payload.source_kind, "reference"); assert.equal(payload.source_id, reference.id);
    assert.equal(payload.title, title); assert.equal(payload.body, bodyText); assert.equal(payload.block_type, "reference");
    assert.equal(payload.source_surface, "canvas-add-dialog"); assert.equal(payload.batch_index, 0); assert.equal(payload.batch_size, 1);
    assert.equal(payload.history_owner_id, h.worker.owner);
    for (const key of ["item_id", "client_event_id", "batch_id", "history_action_id"]) assert.ok(typeof payload[key] === "string" && payload[key]);
    assert.equal(before.history.some(event => event.payload.item_id === payload.item_id), false);
    assert.equal(payload.frame.w, 360); assert.equal(payload.frame.h, 280); assert.equal(payload.frame.rot, 0);
    assert.ok(Number.isFinite(payload.frame.x) && Number.isFinite(payload.frame.y));
    assert.ok(f.store.sourceOwnershipActive(before.source) && f.store.authorizationScopeActive(before.authority));
    assert.deepEqual(await canvasReferenceEvents(h.worker.env, h.worker.streamId), before.history);
    const response = await prior(request);
    assert.equal(response.status, 200, "the single native placement reaches the original Worker acknowledgment");
    const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "idempotent", "rejected"]);
    assert.equal(receipt.idempotent, true); assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
    const event = receipt.appended[0];
    assert.equal(event.type, "CanvasItemPlaced"); assert.deepEqual(event.payload, payload);
    assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:canvas");
    assert.equal(event.sequence, before.history.at(-1).sequence + 1); assert.equal(receipt.head, event.sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await canvasReferenceEvents(h.worker.env, h.worker.streamId), [...before.history, event]);
    assert.deepEqual(canvasReferenceFinancial(h.worker), before.money);
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
    const receipts = h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
    const added = receipts.filter(value => value.stream_id === h.worker.streamId && value.client_event_id === payload.client_event_id);
    assert.equal(added.length, 1); assert.equal(added[0].event_id, event.eventId); assert.equal(added[0].sequence, event.sequence);
    assert.deepEqual(receipts.filter(value => !added.includes(value)), before.receipts);
    assert.equal(request.init, originalInit); assert.equal(request.init.body, originalBytes);
    assert.equal(JSON.stringify(request.body), originalBytes);
    proof = { event, status: response.status };
    assert.equal(isOriginal({ ...request }), false);
    return response;
  };
  const transport = request => {
    if (request.url === "/api/events" && request.init.method === "POST") {
      assert.equal(original, null, "one original placement, never a retry or substitute setup");
      original = request; pending = observe(request); void pending.catch(error => { failure = error; }); return pending;
    }
    if (pending && !proof && canvasReferenceResumeCandidate(request, { projectId, documentId: before.documentId }))
      return pending.then(() => prior(request)); // Preserve the original read and its existing independent no-write proof.
    return prior(request);
  };
  h.transport = transport;
  try {
    // Snapshot reads above do not stand in for a still-current native row.
    // Reacquire the actual current control after every setup await.
    const currentTree = f.tree(), currentDialog = currentTree.visible("dialog").find(value => value.owner === canvas
      && classed(value, "canvas-add-dialog") && value.port.open);
    assert.ok(currentDialog);
    const currentLists = currentTree.visible("div").filter(value => inside(value, currentDialog) && classed(value, "canvas-source-list"));
    assert.equal(currentLists.length, 1);
    const currentRows = currentTree.visible("button").filter(value => value.owner === canvas && inside(value, currentLists[0]));
    assert.equal(currentRows.length, 1);
    assert.equal(currentTree.visible("b").find(value => inside(value, currentRows[0]))?.text, title);
    await activate(currentRows[0]);
    await reached(f, () => Boolean(proof || failure), "the actual native Reference placement has a terminal original response");
    if (failure) throw failure;
    await pending; await resume.settleOriginalRequests();
    await reached(f, () => queue.values.size === 0 && f.store.optimisticEvents.get().length === 0
      && f.store.events.get().some(event => event.eventId === proof.event.eventId), "the same original placement is canonical and its device queue is empty");
    assert.ok(queue.transactions.some(tx => tx.completed && tx.operations.some(operation => operation.method === "put")));
    assert.ok(queue.transactions.some(tx => tx.completed && tx.operations.some(operation => operation.method === "delete")));
    assert.deepEqual(f.store.projection.get().libraryBlocks.find(block => block.id === reference.id), originalReference);
    assert.equal(f.store.route.get(), before.route); assert.deepEqual(history, before.browserHistory);
    assert.deepEqual(f.store.canvasProjection.get().items.filter(item => item.sourceId === reference.id).map(item => item.id), [proof.event.payload.item_id]);
    assert.equal(f.tree().visible("dialog").some(value => value.owner === canvas && classed(value, "canvas-add-dialog")), false);
    await activate(f.find("button", value => value.owner === canvas && classed(value, "canvas-selection-close")
      && value.attributes["aria-label"] === "Clear selection"));
    assert.equal(f.tree().visible("article").some(value => value.owner === canvas && classed(value, "canvas-item") && classed(value, "selected")), false);
    assert.equal(canvas.captureCommandDeparture().blocked(), false);
    await resume.settleOriginalRequests();
    assert.deepEqual(h.requests.filter(request => (request.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(request)), [original]);
    assert.ok(isOriginal(original) && f.store.sourceOwnershipActive(before.source) && f.store.authorizationScopeActive(before.authority));
    t.diagnostic("CANVAS_REFERENCE_DECLARED_SETUP " + JSON.stringify({ status: proof.status, type: proof.event.type,
      eventId: proof.event.eventId, sequence: proof.event.sequence, sourceId: reference.id, boardId,
      exactOriginalRequests: 1, originalHistoryPrivateFiscalVerified: true, queueEmpty: queue.values.size === 0 }));
    return { request: original, isOriginal, event: proof.event };
  } finally {
    try { if (pending) await pending; await resume.settleOriginalRequests(); }
    finally { if (h.transport === transport) h.transport = prior; }
  }
}

test("actual Canvas References link retains collapsed Assistant raw until clear, then reaches its exact Library",
  { ...options, timeout: 120_000 }, async t => {
    // Existing finite queue and account database ports, never local persisted data.
    canvasReferenceAccountCache(t);
    const accountIndexedDB = globalThis.indexedDB, queue = canvasReferenceQueue();
    globalThis.indexedDB = { open(name, version) {
      return name === "canvas-offline-queue-v1" ? queue.indexedDB.open(name, version) : accountIndexedDB.open(name, version);
    } };
    let referenceSetup;
    const f = await boardPage(t, { referencePlacementSetup: async setup => {
      referenceSetup = await prepareCanvasReferencePlacement(t, setup, queue); return referenceSetup.request;
    } }), h = f.storeHost, pending = new Set(), reads = [], rejected = [];
    // Reuse the lifecycle Assistant fixture's no-provider setup, then obtain
    // the complete original session through the actual public Store read.
    h.worker.env.OPENAI_API_KEY = "";
    t.mock.method(globalThis, "fetch", (input, init = {}) => {
      const url = new URL(String(input), "http://localhost"), method = init.method ?? "GET";
      const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
      const allowed = ["http://localhost", "https://fixture.invalid"].includes(url.origin)
        && method === "GET" && url.pathname === "/api/assistant"
        && url.searchParams.get("route") === f.store.route.get()
        && url.searchParams.get("projectId") === f.projectId
        && url.searchParams.getAll("selected").length === 0
        && f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority);
      if (!allowed) {
        rejected.push({ method, path: url.pathname });
        throw new Error("Only this exact current authorized Assistant context read is allowed");
      }
      const reply = h.fetch(url.pathname + url.search, init).then(response => {
        reads.push({ method, path: url.pathname, status: response.status, route: url.searchParams.get("route") });
        assert.equal(response.status, 200, "the original authorized Assistant read must succeed");
        return response; // Same original Worker response, never a manufactured body.
      });
      pending.add(reply); void reply.then(() => pending.delete(reply), () => pending.delete(reply));
      return reply;
    });
    const settle = async () => {
      await drain(f, 2); await Promise.all([...pending]); await f.resume.settleOriginalRequests();
      await h.worker.drainBackground(); await drain(f, 2); await Promise.all([...pending]);
      assert.deepEqual(rejected, [], "no unexpected global/provider request was swallowed by application error handling");
      assert.ok(reads.every(read => read.status === 200), "every observed Assistant read returned its original authorized response");
    };
    try {
      await registerCalmFullPageComponents(f, ["forma-creative-assistant", "forma-library"]);
      const originalActor = f.store.session.get().user.userId;
      const session = await f.store.refreshSession(); await settle();
      assert.equal(f.store.session.get(), session);
      assert.equal(session.user.userId, originalActor);
      assert.equal(session.assistant?.enabled, true); assert.equal(session.provider.configured, false);
      assert.equal(session.policy.accepted, true); assert.equal(session.canvas.access, true);
      assert.ok(session.capabilities.includes("project.author"));
      assert.equal(one(f, "forma-shell"), f.host); assert.equal(f.canvas.store, f.store);
      assert.ok(f.store.routeDataReady());
      assert.equal(f.store.canvasProjection.get().selectedCanvasId, BOARD);
      assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
      const assistant = one(f, "forma-creative-assistant");
      const panel = one(f, "forma-assistant-panel", owner => owner.closest("forma-creative-assistant") === assistant);
      assert.equal(assistant.store, f.store); assert.ok(f.canvas.isConnected && panel.isConnected);

      const activate = async row => {
        assert.ok(row.port.isConnected && !row.hiddenBy && !row.port.matches(":disabled"));
        f.native.emit("pointerdown", row.port); f.native.focus(row.port);
        await f.act(row, "click", { button: 0, defaultPrevented: false }); await settle();
      };
      const assistantOpen = async open => {
        assert.notEqual(panel.open, open);
        await activate(f.find("button", row => row.owner === panel
          && classed(row, open ? "forma-assistant-launcher" : "forma-assistant-close")));
        assert.equal(panel.open, open);
        assert.ok(assistant.isConnected && panel.isConnected);
      };
      const field = () => {
        const tree = f.tree();
        const forms = tree.visible("form").filter(row => row.owner === panel && classed(row, "forma-assistant-composer"));
        assert.equal(forms.length, 1);
        const composers = tree.nodes.filter(row => row.owner === panel && inside(row, forms[0])
          && row.tag === "forma-ui-conversation-composer" && classed(row, "forma-assistant-shared-composer"));
        assert.equal(composers.length, 1);
        const composer = composers[0];
        assert.ok(composer.component?.isConnected && composer.component.closest("forma-assistant-panel") === panel);
        const inputs = tree.visible("textarea").filter(row => row.owner === composer.component
          && inside(row, composer) && classed(row, "forma-assistant-input"));
        assert.equal(inputs.length, 1);
        assert.ok(forms[0].port.isConnected && inputs[0].port.isConnected && !inputs[0].port.matches(":disabled"));
        return inputs[0];
      };
      const referenceControl = () => {
        const tree = f.tree(), open = tree.visible("dialog").filter(row => row.owner === f.canvas
          && classed(row, "canvas-add-dialog") && row.port.open);
        assert.equal(open.length, 1, "one actual current Sources dialog remains open");
        const dialog = open[0];
        assert.equal(f.canvas.querySelector(".canvas-add-dialog"), dialog.port);
        assert.ok(dialog.port.isConnected && dialog.port.getClientRects().length > 0);
        assert.equal(tree.visible("h2").filter(row => inside(row, dialog)
          && row.attributes.id === "canvas-sources-title" && row.text === f.i18n.system("References")).length, 1);
        assert.deepEqual(tree.nodes.filter(row => ["input", "textarea", "select"].includes(row.tag) && inside(row, dialog)), [],
          "this exact empty References presentation has no editable fields; this is not a blanket Sources exemption");
        const links = tree.visible("a").filter(row => row.owner === f.canvas && inside(row, dialog)
          && row.attributes.href === "/canvas/library"
          && row.text === f.i18n.t("projects.manageReferences", "Upload or manage references"));
        assert.equal(links.length, 1);
        assert.ok(links[0].port.isConnected && links[0].port.getClientRects().length > 0);
        assert.equal(links[0].attributes.target, undefined, "this is the current same-tab destination");
        assert.equal(links[0].port.closest(".canvas-add-dialog"), dialog.port);
        return { row: links[0], dialog };
      };
      const sources = async () => {
        await activate(f.find("button", row => row.owner === f.canvas && classed(row, "canvas-sources-toggle")));
        const tree = f.tree(), dialogs = tree.visible("dialog").filter(row => row.owner === f.canvas
          && classed(row, "canvas-add-dialog") && row.port.open);
        assert.equal(dialogs.length, 1);
        const choices = tree.nodes.filter(row => row.owner === f.canvas && inside(row, dialogs[0])
          && row.tag === "forma-ui-choice-card" && row.attributes["data-add-category"] === "reference");
        if (choices.length) {
          assert.equal(choices.length, 1);
          const buttons = tree.visible("button").filter(row => inside(row, choices[0]));
          assert.equal(buttons.length, 1); await activate(buttons[0]);
        }
        return referenceControl(); // A deliberate Close retains the existing chosen category.
      };
      const closeSources = async () => {
        const tree = f.tree(), dialog = tree.visible("dialog").find(row => row.owner === f.canvas
          && classed(row, "canvas-add-dialog") && row.port.open);
        assert.ok(dialog);
        const close = tree.visible("button").filter(row => inside(row, dialog) && classed(row, "modal-close")
          && row.attributes["aria-label"] === f.i18n.t("canvas.controls.closeSources", "Close sources"));
        assert.equal(close.length, 1); await activate(close[0]);
        assert.equal(f.tree().visible("dialog").some(row => row.owner === f.canvas && classed(row, "canvas-add-dialog")), false);
      };
      const follow = async ({ row, dialog }) => {
        assert.ok(row.port.isConnected && dialog.port.isConnected && dialog.port.open);
        assert.equal(f.canvas.querySelector(".canvas-add-dialog"), dialog.port);
        f.native.emit("pointerdown", row.port); f.native.focus(row.port);
        const path = [];
        for (let at = row; at; at = at.parent) {
          const node = at.port ?? at.component; if (node && !path.includes(node)) path.push(node);
        }
        path.push(f.native.document);
        let stopped = false;
        const event = { type: "click", target: row.port, currentTarget: row.port, button: 0,
          metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; },
          composedPath: () => path };
        // Existing finite click ports have no anchor loader. Invoke only the
        // real current EventPart, if present, and the real dialog bubble guard.
        // Never synthesize Store.setRoute, a Shell delegate, or native arrival.
        const completion = row.handlers.click?.call(row.owner, event);
        if (!stopped) {
          event.currentTarget = dialog.port;
          dialog.handlers.click?.call(dialog.owner, event);
        }
        event.currentTarget = null;
        await completion; await settle();
        return event;
      };

      await assistantOpen(true);
      assert.ok(reads.some(read => read.status === 200 && read.path === "/api/assistant"));
      assert.equal(field().port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
      await assistantOpen(false);
      assert.equal(f.canvas.captureCommandDeparture().blocked(), false, "pristine same-Store owners are clean before opening Sources");
      await sources(); await closeSources(); // Reach the actual empty state while pristine; not a route-pass claim.
      const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
      // Library's bare task href inherits the actual current projection context,
      // not the separately chosen Canvas planning Document. Do not replace either.
      const projection = f.store.projection.get();
      assert.ok(projection.documentId && projection.documents.some(document => document.id === projection.documentId
        && document.projectId === f.projectId));
      const before = { route: f.store.route.get(), history: [...f.history], projectId: f.projectId, documentId: projection.documentId,
        events: structuredClone(f.store.events.get()), content: structuredClone(f.store.content.get()), head: f.store.head.get(),
        authored: await canvasReferenceEvents(h.worker.env, h.worker.streamId), money: canvasReferenceFinancial(h.worker),
        privateContent: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
        receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
        scope: panel.conversationScope, messages: structuredClone(panel.messages), tasks: structuredClone(panel.tasks) };
      const quiet = async () => {
        await settle(); await f.sourceUnchanged();
        assert.deepEqual(await canvasReferenceEvents(h.worker.env, h.worker.streamId), before.authored);
        assert.deepEqual(canvasReferenceFinancial(h.worker), before.money);
        assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
        assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
        assert.deepEqual({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() },
          { events: before.events, content: before.content, head: before.head });
        assert.deepEqual(h.requests.filter(request => (request.init.method ?? "GET") !== "GET" && !f.resume.isReadOnlyResume(request)
          && !referenceSetup.isOriginal(request)), [],
          "only the single verified setup placement and existing exact original-response/database-certified free Resume may use POST");
        assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
        assert.equal(f.store.session.get().user.userId, originalActor);
        assert.equal(f.store.projection.get().projectId, before.projectId);
        assert.equal(f.store.projection.get().documentId, before.documentId);
      };

      await assistantOpen(true);
      const input = field(); f.native.emit("keydown", input.port); f.native.focus(input.port);
      input.port.value = RAW; await f.act(input, "input"); await settle();
      assert.equal(field().port.value, RAW); assert.equal(panel.commandDepartureBlocked, true);
      await assistantOpen(false); assert.equal(panel.commandDepartureBlocked, true);
      const control = await sources(), requestFloor = h.requests.length;
      const event = await follow(control); await quiet();
      t.diagnostic("CANVAS_REFERENCE_LINK_BASELINE " + JSON.stringify({
        phase: "raw-click", href: control.row.attributes.href, eventPart: typeof control.row.handlers.click,
        defaultPrevented: event.defaultPrevented, actualRoute: f.store.route.get(), originalRoute: before.route,
        currentCanvas: f.canvas.isConnected, assistantCollapsed: !panel.open, requestDelta: h.requests.length - requestFloor,
        sourceCurrent: f.store.sourceOwnershipActive(source), evidence: "uncancelled default is not a simulated hard-navigation arrival" }));
      assert.equal(event.defaultPrevented, true, "the actual current same-tab anchor must cancel native departure over sibling raw work");
      assert.equal(f.store.route.get(), before.route); assert.deepEqual(f.history, before.history);
      assert.equal(h.requests.length, requestFloor, "refusal dispatches no navigation, chat, plan or provider request");
      assert.ok(f.canvas.isConnected && assistant.isConnected && panel.isConnected);
      assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true);
      assert.equal(panel.conversationScope, before.scope);
      assert.deepEqual(panel.messages, before.messages); assert.deepEqual(panel.tasks, before.tasks);
      referenceControl(); // Refusal did not hide/replace the owned References state first.
      assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));

      await closeSources(); await assistantOpen(true);
      assert.equal(field().port.value, RAW, "actual reopen exposes the exact retained whitespace/multilingual draft");
      const clear = field(); f.native.emit("keydown", clear.port); f.native.focus(clear.port);
      clear.port.value = ""; await f.act(clear, "input"); await settle();
      assert.equal(field().port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
      await assistantOpen(false);
      const fresh = await sources(), admitted = await follow(fresh);
      assert.equal(admitted.defaultPrevented, true, "healthy navigation also uses its real in-app admission");
      const destination = canvasReferenceRoute("/canvas/library", before.documentId, before.route);
      await reached(f, () => f.store.route.get() === destination && !f.canvas.isConnected,
        "the actual Canvas Library replaces the source board after deliberate clear");
      await quiet();
      const library = one(f, "forma-library"), wrapper = one(f, "forma-canvas-application");
      assert.equal(library.store, f.store); assert.equal(library.closest("forma-canvas-application"), wrapper);
      assert.ok(library.isConnected && wrapper.isConnected && !f.canvas.isConnected);
      assert.ok(assistant.isConnected && panel.isConnected);
      assert.equal(dialogs(f).length, 0, "the departed Sources dialog is not carried into Library");
      assert.deepEqual(f.history.slice(before.history.length), [destination]);
      assert.equal(new URL(destination, "http://localhost").pathname, "/canvas/library");
      assert.deepEqual(new URL(f.store.route.get(), "http://localhost").searchParams.getAll("document"), [before.documentId]);
      assert.equal(panel.commandDepartureBlocked, false);
      t.diagnostic("CANVAS_REFERENCE_LINK_BASELINE " + JSON.stringify({
        phase: "resolved-arrival", destination, connectedLibrary: library.isConnected,
        sameStore: library.store === f.store, originalCanvasRetired: !f.canvas.isConnected,
        exactReadHistoryReceiptFiscal: true, evidence: "actual Store route and complete Canvas application/Library, not a default-request journal" }));
    } finally {
      await Promise.all([...pending]); await f.resume.settleOriginalRequests();
    }
  });


// One local-presentation contrast. Default board fixture only: no extra source
// placement, job setup, provider turn, application method or native port change.
// Retained Sources raw is a different owner from the route-scoped Assistant.
import { withCanvasView as canvasLocalViewRoute, canvasViewFromRoute as canvasLocalView }
  from "../src/canvas/routes.ts";

test("actual Canvas Reading order protects collapsed Assistant raw while retaining its local Sources draft",
  options, async t => {
    const f = await boardPage(t), h = f.storeHost, pending = new Set(), reads = [], rejected = [];
    h.worker.env.OPENAI_API_KEY = ""; // Existing no-provider Assistant fixture setup; use the real session read below.
    t.mock.method(globalThis, "fetch", (input, init = {}) => {
      const url = new URL(String(input), "http://localhost"), method = init.method ?? "GET";
      const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
      if (!["http://localhost", "https://fixture.invalid"].includes(url.origin) || method !== "GET"
        || url.pathname !== "/api/assistant" || url.searchParams.get("route") !== f.store.route.get()
        || url.searchParams.get("projectId") !== f.projectId || url.searchParams.getAll("selected").length !== 0
        || !f.store.sourceOwnershipActive(source) || !f.store.authorizationScopeActive(authority)) {
        rejected.push({ method, path: url.pathname });
        throw new Error("Only the current exact authorized Assistant context GET is permitted");
      }
      const response = h.fetch(url.pathname + url.search, init).then(original => {
        reads.push({ status: original.status, route: url.searchParams.get("route") });
        assert.equal(original.status, 200, "actual original Worker Assistant context response");
        return original;
      });
      pending.add(response); void response.then(() => pending.delete(response), () => pending.delete(response));
      return response;
    });
    const settle = async () => {
      await drain(f, 2); await Promise.all([...pending]); await f.resume.settleOriginalRequests();
      await h.worker.drainBackground(); await drain(f, 2); await Promise.all([...pending]);
      assert.deepEqual(rejected, [], "no swallowed global/provider request");
    };
    try {
      await registerCalmFullPageComponents(f, ["forma-creative-assistant"]);
      const actor = f.store.session.get().user.userId, session = await f.store.refreshSession(); await settle();
      assert.equal(f.store.session.get() === session, true);
      assert.equal(session.user.userId, actor); assert.equal(session.assistant?.enabled, true);
      assert.equal(session.provider.configured, false); assert.equal(session.policy.accepted, true);
      assert.equal(session.canvas.access, true); assert.ok(session.capabilities.includes("project.author"));
      assert.equal(f.store.ui.instrumentation, false, "existing finite fixture disables optional view-recording");
      assert.equal(one(f, "forma-shell") === f.host, true); assert.equal(f.canvas.store === f.store, true);
      assert.ok(f.store.routeDataReady()); assert.equal(f.store.canvasProjection.get().selectedCanvasId, BOARD);
      assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
      assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds, []);
      assert.equal(canvasLocalView(f.store.route.get()), "spatial");
      const wrapper = one(f, "forma-canvas-application"), assistant = one(f, "forma-creative-assistant");
      const panel = one(f, "forma-assistant-panel", owner => owner.closest("forma-creative-assistant") === assistant);
      assert.equal(assistant.store === f.store, true); assert.ok(panel.isConnected && f.canvas.isConnected);
      assert.equal(f.components().some(owner => owner.isConnected && classed(owner, "canvas-intent-dock")), false,
        "the real floating Assistant replaces the inline intent field; never fabricate both");
      const activate = async row => {
        assert.ok(row.port.isConnected && !row.hiddenBy && !row.port.matches(":disabled"));
        f.native.emit("pointerdown", row.port); f.native.focus(row.port);
        await f.act(row, "click", { button: 0, defaultPrevented: false }); await settle();
      };
      const assistantOpen = async open => {
        assert.notEqual(panel.open, open);
        await activate(f.find("button", row => row.owner === panel
          && classed(row, open ? "forma-assistant-launcher" : "forma-assistant-close")));
        assert.equal(panel.open, open); assert.ok(assistant.isConnected && panel.isConnected);
      };
      const assistantField = () => {
        const tree = f.tree(), forms = tree.visible("form").filter(row => row.owner === panel && classed(row, "forma-assistant-composer"));
        assert.equal(forms.length, 1);
        const composers = tree.nodes.filter(row => row.owner === panel && inside(row, forms[0])
          && row.tag === "forma-ui-conversation-composer" && classed(row, "forma-assistant-shared-composer"));
        assert.equal(composers.length, 1);
        const composer = composers[0];
        assert.ok(composer.component?.isConnected && composer.component.closest("forma-assistant-panel") === panel);
        const fields = tree.visible("textarea").filter(row => row.owner === composer.component && inside(row, composer)
          && classed(row, "forma-assistant-input"));
        assert.equal(fields.length, 1); assert.ok(fields[0].port.isConnected && !fields[0].port.matches(":disabled"));
        return fields[0];
      };
      const sourceControls = () => {
        const tree = f.tree(), dialogs = tree.visible("dialog").filter(row => row.owner === f.canvas
          && classed(row, "canvas-add-dialog") && row.port.open);
        assert.equal(dialogs.length, 1); const dialog = dialogs[0];
        const forms = tree.visible("form").filter(row => row.owner === f.canvas && inside(row, dialog)
          && classed(row, "canvas-context-create-form"));
        assert.equal(forms.length, 1); const form = forms[0];
        const names = tree.visible("input").filter(row => row.owner === f.canvas && inside(row, form));
        const bodies = tree.visible("textarea").filter(row => row.owner === f.canvas && inside(row, form));
        const closes = tree.visible("button").filter(row => row.owner === f.canvas && inside(row, dialog)
          && row.attributes["aria-label"] === f.i18n.t("canvas.controls.closeSources", "Close sources"));
        assert.equal(names.length, 1); assert.equal(bodies.length, 1); assert.equal(closes.length, 1);
        assert.ok(form.port.isConnected && names[0].port.isConnected && bodies[0].port.isConnected);
        assert.equal(f.canvas.querySelector(".canvas-add-dialog") === dialog.port, true);
        return { name: names[0], body: bodies[0], close: closes[0] };
      };
      const openSources = async choose => {
        await activate(f.find("button", row => row.owner === f.canvas && classed(row, "canvas-sources-toggle")));
        if (choose) {
          const tree = f.tree(), dialogs = tree.visible("dialog").filter(row => row.owner === f.canvas
            && classed(row, "canvas-add-dialog") && row.port.open);
          assert.equal(dialogs.length, 1);
          const choices = tree.nodes.filter(row => row.owner === f.canvas && inside(row, dialogs[0])
            && row.tag === "forma-ui-choice-card" && row.attributes["data-add-category"] === "context");
          assert.equal(choices.length, 1);
          const buttons = tree.visible("button").filter(row => inside(row, choices[0]));
          assert.equal(buttons.length, 1); await activate(buttons[0]);
        }
        return sourceControls();
      };
      const closeSources = async () => {
        await activate(sourceControls().close);
        assert.equal(f.tree().visible("dialog").some(row => row.owner === f.canvas && classed(row, "canvas-add-dialog")), false);
      };
      const readingOrder = async () => {
        const menu = popover(f, "canvas-view-menu");
        if (!menu.querySelector(".ui-popover-panel").matches(":popover-open")) await toggle(f, menu, true);
        const tree = f.tree(), rows = tree.visible("button").filter(row => row.owner === menu
          && row.text === f.i18n.t("canvas.readingOrder", "Reading order"));
        assert.equal(rows.length, 1); const row = rows[0];
        const wrappers = tree.visible("div").filter(value => value.owner === menu && classed(value, "canvas-view-actions") && inside(row, value));
        assert.equal(wrappers.length, 1); const capture = wrappers[0];
        assert.ok(row.port.isConnected && !row.hiddenBy && !row.port.matches(":disabled"));
        assert.equal(row.port.closest("forma-ui-popover") === menu, true);
        assert.equal(capture.handlers.click.capture, true); assert.equal(typeof capture.handlers.click.handleEvent, "function");
        assert.equal(typeof row.handlers.click, "function");
        f.native.emit("pointerdown", row.port); f.native.focus(row.port);
        const path = [];
        for (let at = row; at; at = at.parent) { const node = at.port ?? at.component; if (node && !path.includes(node)) path.push(node); }
        path.push(f.native.document);
        const event = { type: "click", target: row.port, currentTarget: capture.port, button: 0,
          metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, immediateStopped: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
          stopImmediatePropagation() { this.immediateStopped = true; }, composedPath: () => path };
        // Real emitted capture then target listener, in one finite native event.
        // No redraw between them: native capture may legitimately close its popover.
        capture.handlers.click.handleEvent(event);
        const targetReached = !event.immediateStopped;
        if (targetReached) { event.currentTarget = row.port; await row.handlers.click.call(row.owner, event); }
        event.currentTarget = null; await settle();
        return { targetReached, captureStopped: event.immediateStopped };
      };
      await assistantOpen(true); assert.ok(reads.some(read => read.status === 200));
      assert.equal(assistantField().port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
      await assistantOpen(false);
      const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
      const before = { route: f.store.route.get(), history: [...f.history], scope: panel.conversationScope,
        projectId: f.store.projection.get().projectId, documentId: f.store.projection.get().documentId,
        events: structuredClone(f.store.events.get()), content: structuredClone(f.store.content.get()), head: f.store.head.get(),
        canvasItems: structuredClone(f.store.canvasProjection.get().items),
        authored: await canvasReferenceEvents(h.worker.env, h.worker.streamId), money: canvasReferenceFinancial(h.worker),
        privateContent: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
        receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all() };
      const quiet = async () => {
        await settle(); await f.sourceUnchanged();
        assert.deepEqual(await canvasReferenceEvents(h.worker.env, h.worker.streamId), before.authored);
        assert.deepEqual(canvasReferenceFinancial(h.worker), before.money);
        assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
        assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
        assert.deepEqual({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() },
          { events: before.events, content: before.content, head: before.head });
        assert.deepEqual(f.store.canvasProjection.get().items, before.canvasItems);
        assert.deepEqual(h.requests.filter(request => (request.init.method ?? "GET") !== "GET" && !f.resume.isReadOnlyResume(request)), [],
          "only existing positively certified original free Resume may use POST; no new placement, Save, chat or provider request");
        assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
        assert.equal(f.store.session.get().user.userId, actor);
        assert.equal(f.store.projection.get().projectId, before.projectId); assert.equal(f.store.projection.get().documentId, before.documentId);
        assert.equal(f.store.canvasProjection.get().selectedCanvasId, BOARD); assert.equal(f.store.canvasPlanningDocumentId(), f.documentId);
        assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds, []);
      };
      const rawName = "  Retained source name — 未保存  ", rawBody = "  Keep this unsent board context.\nسياق محلي — 文書  ";
      await openSources(true);
      for (const [key, value] of [["name", rawName], ["body", rawBody]]) {
        const field = sourceControls()[key]; assert.equal(field.port.matches(":disabled"), false);
        f.native.emit("keydown", field.port); f.native.focus(field.port); field.port.value = value;
        await f.act(field, "input"); await settle(); assert.equal(sourceControls()[key].port.value, value);
      }
      await closeSources(); assert.equal(f.canvas.captureCommandDeparture().blocked(), true);
      await assistantOpen(true);
      const input = assistantField(); f.native.emit("keydown", input.port); f.native.focus(input.port);
      input.port.value = RAW; await f.act(input, "input"); await settle(); assert.equal(assistantField().port.value, RAW);
      await assistantOpen(false); assert.equal(panel.commandDepartureBlocked, true);
      const requestFloor = h.requests.length, observed = await readingOrder(); await quiet();
      t.diagnostic("CANVAS_LOCAL_READING_ORDER_BASELINE " + JSON.stringify({ phase: "raw-refusal", ...observed,
        originalRoute: before.route, actualRoute: f.store.route.get(), sameCanvas: f.canvas.isConnected,
        assistantCollapsed: !panel.open, assistantStillOwns: panel.commandDepartureBlocked,
        sameConversationScope: panel.conversationScope === before.scope, requests: h.requests.length - requestFloor,
        originalSourcePrivateReceiptsFiscalExact: true, evidence: "actual full hosts and RAM Worker; finite native dispatch, not physical proof" }));
      assert.equal(f.store.route.get(), before.route, "Reading order must not discard the collapsed Assistant draft");
      assert.deepEqual(f.history, before.history); assert.equal(h.requests.length, requestFloor);
      assert.ok(f.canvas.isConnected && assistant.isConnected && panel.isConnected);
      assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true); assert.equal(panel.conversationScope, before.scope);
      assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
      const menu = popover(f, "canvas-view-menu");
      if (menu.querySelector(".ui-popover-panel").matches(":popover-open")) await toggle(f, menu, false);
      await assistantOpen(true); assert.equal(assistantField().port.value, RAW);
      const clear = assistantField(); f.native.emit("keydown", clear.port); f.native.focus(clear.port);
      clear.port.value = ""; await f.act(clear, "input"); await settle(); assert.equal(assistantField().port.value, "");
      await assistantOpen(false); assert.equal(panel.commandDepartureBlocked, false);
      assert.equal(f.canvas.captureCommandDeparture().blocked(), true, "retained Sources raw still owns destructive departure, not this local view");
      await readingOrder(); await quiet();
      const destination = canvasLocalViewRoute(before.route, "list");
      assert.equal(f.store.route.get(), destination); assert.equal(canvasLocalView(destination), "list");
      assert.deepEqual(f.history.slice(before.history.length), [destination]);
      assert.equal(one(f, "forma-canvas-surface") === f.canvas, true); assert.equal(one(f, "forma-canvas-application") === wrapper, true);
      assert.ok(f.tree().visible("section").some(row => row.owner === f.canvas && classed(row, "canvas-list-view")));
      assert.equal(panel.commandDepartureBlocked, false);
      await openSources(false);
      assert.equal(sourceControls().name.port.value, rawName); assert.equal(sourceControls().body.port.value, rawBody);
      await closeSources(); await quiet();
      t.diagnostic("CANVAS_LOCAL_READING_ORDER_BASELINE " + JSON.stringify({ phase: "resolved-local-arrival", destination,
        sameCanvas: f.canvas.isConnected, sameWrapper: wrapper.isConnected, retainedSourceNameAndBody: true,
        assistantStillBlocks: panel.commandDepartureBlocked, originalSourcePrivateReceiptsFiscalExact: true,
        evidence: "no new source placement or canonical mutation; this is not cached ContextIntelligence or all-Canvas coverage" }));
    } finally { await Promise.all([...pending]); await f.resume.settleOriginalRequests(); }
  });
