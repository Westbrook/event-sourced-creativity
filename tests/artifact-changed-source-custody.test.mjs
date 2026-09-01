import assert from "node:assert/strict";
import test from "node:test";
import {
  writeFixture, appendAuditEvent, readWorkspaceEvents, financial, withDocumentInRoute,
} from "./helpers/event-source-retirement-fixture.mjs";
import {
  createCalmFullPage, calmFullPageNativePorts as ports, registerCalmFullPageComponents,
} from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { installManualOutputNativeLifetime } from "./helpers/manual-output-native-lifetime.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { artifactReviewState } from "../src/model/context-health.ts";
import { documentContextBlockRoute, libraryFocusFromRoute } from "../src/model/routes.ts";

// One ordinary changed-decision link, not a generation/recovery/protocol test.
// The existing retained story is historical fixture data, never provider proof.
const ARTIFACT = "saved-scene-story", BLOCK = "scene-reuse-direction";
const RAW = "  Keep my unsubmitted review correction — 文書\nنور  ";
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const privateRows = worker => Object.fromEntries([
  "events", "event_private_payloads", "private_content", "private_content_retention_scopes", "event_client_receipts",
].map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all()]));

async function drain(x) {
  for (let turn = 0; turn < 8; turn++) {
    await x.f.settle();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.resume.settleOriginalRequests(); await x.worker.drainBackground();
    await x.dialogs?.settle(); await new Promise(setImmediate);
    if (x.resume.pendingOriginalCount() === 0 && x.f.frames.size === 0 && !x.f.requested
      && ![...x.h.timers.values()].some(timer => timer.delay === 16) && !x.dialogs?.pendingCloseCount()) return;
  }
  assert.fail("The original finite component, Store-frame and actual transport queues must settle");
}
async function click(x, row) {
  assert.ok(row.port?.isConnected && x.f.renderer.nodes.includes(row.port));
  assert.equal(row.hiddenBy, null); assert.equal(row.port.matches(":disabled"), false);
  assert.equal(typeof row.handlers.click, "function");
  x.f.native.emit("pointerdown", row.port); x.f.native.focus(row.port);
  await x.f.act(row, "click", { button: 0, defaultPrevented: false }); await drain(x);
}
function review(x) {
  const tree = x.f.tree(), dialogs = tree.visible("dialog").filter(row => row.owner === x.viewer
    && classed(row, "document-artifact-view") && row.port.open);
  assert.equal(dialogs.length, 1); const dialog = dialogs[0];
  assert.ok(dialog.port.isConnected && x.f.renderer.nodes.includes(dialog.port));
  assert.equal(dialog.port.getAttribute("aria-label"), x.artifact.title);
  const panels = tree.visible("div").filter(row => row.owner === x.viewer && inside(row, dialog)
    && row.attributes.id === "artifact-review-panel-" + ARTIFACT);
  assert.equal(panels.length, 1); const panel = panels[0];
  const notes = tree.visible("textarea").filter(row => row.owner === x.viewer && inside(row, panel)
    && row.attributes.rows === "2" && row.attributes.maxlength === "500");
  assert.equal(notes.length, 1); const note = notes[0];
  assert.ok(note.port.isConnected && x.f.renderer.nodes.includes(note.port));
  assert.equal(note.port.matches(":disabled"), false); assert.equal(Object.hasOwn(note.attributes, "readonly"), false);
  assert.equal(typeof note.handlers.input, "function");
  const links = tree.visible("a").filter(row => row.owner === x.viewer && inside(row, panel)
    && row.attributes.href === x.destination);
  assert.equal(links.length, 1); const link = links[0];
  assert.ok(link.port.isConnected && x.f.renderer.nodes.includes(link.port));
  assert.equal(link.port.closest("forma-document-artifacts"), x.viewer);
  assert.equal(link.port.closest(x.workspace ? "forma-workspace" : "forma-library"), x.workspace ?? x.library);
  assert.equal(link.port.closest("forma-shell"), x.f.host);
  assert.equal(link.port.matches(":disabled"), false); assert.equal(link.attributes["aria-disabled"], undefined);
  assert.equal(link.attributes.target, undefined); assert.equal(link.attributes.download, undefined);
  assert.equal(link.text, x.block.handle); assert.equal(link.port.getAttribute("href"), x.destination);
  return { tree, dialog, panel, note, link };
}
async function page(t) {
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); }); // Join native/transport work before the existing SQLite close hooks.
  const h = await writeFixture(t, { shared: false }), worker = h.worker;
  const changed = await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "BlockPropertyEdited", {
    project_id: worker.projectId, document_id: worker.documentId, block_id: BLOCK,
    property_path: "text", new_value: "The keeper checks the harbor after sunrise.",
  });
  await h.store.refreshEvents();
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  assert.ok(original.events.some(event => event.eventId === changed.eventId));
  const resume = observeActualSceneResumeReads(h);
  const f = await createCalmFullPage(t, { locale: "en", storeHost: h });
  // Restore every original Worker projection input; the helper's study blocks and session alteration are not evidence.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.setRoute(withDocumentInRoute("/", worker.documentId, "One current authored direction"));
  await h.store.syncDocumentFromRoute();
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library"]);
  f.nativeHistoryLocation = h.location; f.native = installOutputNavigationFocusNative(t, f, ports);
  const x = { f, h, worker, resume, viewer: null, defaults: [] };
  cleanup = async () => { await drain(x); resume.restore(); };
  x.dialogs = installManualOutputNativeLifetime(t, { f, h, ports,
    dialogOwner: owner => owner === x.viewer, routeEvents: true });
  await drain(x);
  await click(x, f.find("a", row => row.owner.tag === "forma-ui-audience-navigation"
    && new URL(row.attributes.href, "https://fixture.invalid").pathname === "/library"));
  const libraries = f.components().filter(owner => owner.tag === "forma-library" && owner.isConnected && owner.store === h.store);
  assert.equal(libraries.length, 1); x.library = libraries[0];
  const viewers = f.components().filter(owner => owner.tag === "forma-document-artifacts" && owner.isConnected
    && owner.store === h.store && owner.closest("forma-library") === x.library && owner.source === "library");
  assert.equal(viewers.length, 1); x.viewer = viewers[0]; assert.equal(x.viewer.launcherOnly, true);
  const actual = f.modules.get("src/components/document-artifacts.ts")?.DocumentArtifacts;
  assert.equal(typeof actual, "function"); assert.ok(x.viewer instanceof actual);
  await drain(x);
  // Use the real Outputs tab before the opening; never retain an All-tab link across a genuine part change.
  await click(x, f.find("button", row => row.owner.tag === "forma-ui-segmented-control"
    && row.owner.parentElement === x.library && row.owner.label === f.i18n.t("projects.libraryContent", "Library content")
    && row.text === f.i18n.t("projects.filter.outputs", "Outputs")));
  assert.equal(h.store.ui.libraryView, "outputs");
  const projection = h.store.projection.get();
  x.artifact = structuredClone(projection.libraryArtifacts.find(value => value.id === ARTIFACT));
  x.block = structuredClone(projection.libraryBlocks.find(value => value.id === BLOCK));
  assert.ok(x.artifact && x.block); assert.equal(x.artifact.documentId, worker.documentId);
  assert.equal(x.block.documentId, worker.documentId); assert.equal(x.block.projectId, worker.projectId);
  assert.equal(x.block.sourceEvents.length, 2);
  const completed = h.store.events.get().find(event => event.eventId === x.artifact.sourceEventId);
  assert.equal(completed.type, "DocumentRenderCompleted");
  assert.deepEqual(completed.payload.source_block_versions, [{ block_id: BLOCK, version: 1 }]);
  const status = artifactReviewState(x.artifact, projection.libraryBlocks, h.store.events.get());
  assert.equal(status.status, "stale"); assert.deepEqual(status.changedBlockIds, [BLOCK]);
  assert.equal(h.store.content.get()[worker.contentRef], worker.content);
  assert.equal(Boolean(h.store.session.get().projectContext), false, "This is the actual personal reviewer-note path, not a fabricated review grant");
  x.destination = documentContextBlockRoute(worker.documentId, projection.documentTitle, BLOCK);
  const opener = f.find("a", row => row.owner === x.library && classed(row, "library-artifact-open")
    && libraryFocusFromRoute(row.attributes.href)?.kind === "artifact" && libraryFocusFromRoute(row.attributes.href)?.id === ARTIFACT);
  x.dialogs.retainArtifactOpener(opener.port, ARTIFACT); await click(x, opener);
  assert.ok(opener.port.isConnected && f.renderer.nodes.includes(opener.port));
  assert.equal(libraryFocusFromRoute(h.store.route.get())?.id, ARTIFACT);
  await click(x, f.find("button", row => row.owner === x.viewer && classed(row, "artifact-viewer-review-toggle")));
  const current = review(x); assert.equal(current.note.port.value, "");
  const actions = current.tree.visible("button").filter(row => row.owner === x.viewer && inside(row, current.panel)
    && ["ArtifactReviewRequested", "ArtifactChangesRequested", "ArtifactApproved"].some(type => row.handlers.click?.toString().includes('"' + type + '"')));
  assert.equal(actions.length, 3); assert.ok(actions.every(row => row.port.matches(":disabled")), "Stale review cannot silently become an approval");
  return x;
}
async function typeNote(x, raw) {
  const { note } = review(x); x.f.native.emit("pointerdown", note.port); x.f.native.focus(note.port);
  note.port.value = raw; await x.f.act(note, "input", { inputType: "insertText" }); await drain(x);
  assert.equal(review(x).note.port.value, raw);
}
async function before(x) {
  await drain(x);
  return { route: x.h.store.route.get(), events: structuredClone(x.h.store.events.get()), head: x.h.store.head.get(),
    history: await readWorkspaceEvents(x.worker.env, x.worker.streamId), private: privateRows(x.worker), money: financial(x.worker),
    source: x.h.store.captureSourceOwnership(), authority: x.h.store.captureAuthorizationScope(), requests: x.h.requests.length };
}
async function unchanged(x, original, refusal = false) {
  await drain(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), original.history);
  assert.deepEqual(privateRows(x.worker), original.private); assert.deepEqual(financial(x.worker), original.money);
  assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
  assert.equal(x.h.store.content.get()[x.worker.contentRef], x.worker.content);
  assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.authority));
  const requests = x.h.requests.slice(original.requests);
  assert.deepEqual(requests.filter(row => (row.init.method ?? "GET") !== "GET" && !x.resume.isReadOnlyResume(row)), [],
    "No authoring, review, export, generation, retry or paid request; only an exact certified original free Resume read can use POST");
  if (refusal) assert.deepEqual(requests, [], "Dirty refusal starts no destination request");
}
async function activate(x) {
  const current = review(x), { link, dialog } = current, path = [];
  for (let row = link; row; row = row.parent) path.push(row);
  assert.equal(path.filter(row => row.port === dialog.port).length, 1);
  assert.equal(typeof dialog.handlers.click, "function", "The real backdrop handler is an ancestor of this anchor");
  assert.equal((x.f.listeners.get("click") ?? []).length, 0, "No document click listener is omitted by this finite native path");
  for (const row of path) assert.equal(row.port?.listeners?.click, undefined, "No imperative click listener is omitted");
  x.f.native.emit("pointerdown", link.port); x.f.native.focus(link.port);
  const focusStart = x.f.native.nativeFocus.length;
  let stopped = false, immediate = false;
  const trace = [], pending = [], event = { type: "click", target: link.port, currentTarget: null, eventPhase: 0,
    bubbles: true, cancelable: true, button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; immediate = true; },
    composedPath: () => path.map(row => row.port ?? row.component).filter(Boolean) };
  const invoke = (row, phase, capture) => {
    const callback = row.handlers?.click;
    if (!callback || Boolean(typeof callback === "object" && callback.capture) !== capture || immediate) return;
    assert.ok(row.port?.isConnected); event.currentTarget = row.port; event.eventPhase = phase === "target" ? 2 : capture ? 1 : 3;
    trace.push({ phase, owner: row.owner.tag, tag: row.tag, dialog: row.port === dialog.port });
    const result = typeof callback === "function" ? callback.call(row.owner, event) : callback.handleEvent(event);
    if (result && typeof result.then === "function") pending.push(result);
  };
  // Synchronous finite capture/target/bubble delivery of the original EventParts.
  // In particular the actual dialog #closeOnBackdrop sees target !== currentTarget.
  for (const row of path.slice(1).reverse()) { invoke(row, "capture", true); if (stopped) break; }
  if (!stopped) { invoke(link, "target", true); invoke(link, "target", false); }
  if (!stopped) for (const row of path.slice(1)) { invoke(row, "bubble", false); if (stopped) break; }
  event.currentTarget = null; event.eventPhase = 0;
  if (!event.defaultPrevented) x.defaults.push({ href: link.attributes.href, disposition: "same-context" });
  // Observe the browser's default request only: never fabricate unload, history,
  // a delegate router, a replacement opener, or a successful Store destination.
  await Promise.all(pending); await drain(x);
  return { event, trace, originalDialog: dialog.port, focusStart };
}
function requested(t, x, result, original) {
  if (!result.event.defaultPrevented) {
    assert.deepEqual(x.defaults, [{ href: x.destination, disposition: "same-context" }]);
    assert.equal(x.h.store.route.get(), original.route);
    t.diagnostic("C_ARTIFACT_CHANGED_SOURCE_CLEAN " + JSON.stringify({ kind: "native-anchor-default-request", destination: x.destination,
      destinationMounted: false, physicalUnload: false, provider: false }));
    return;
  }
  assert.deepEqual(x.defaults, []); assert.equal(x.h.store.route.get(), x.destination);
  const workspaces = x.f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === x.h.store && owner.isConnected);
  assert.equal(workspaces.length, 1); assert.equal(x.library.isConnected, false);
  const blocks = x.f.tree().visible("article").filter(row => row.attributes["data-block-id"] === BLOCK
    && row.owner.tag === "forma-context-block" && row.owner.store === x.h.store && row.owner.surface === "document");
  assert.equal(blocks.length, 1); assert.ok(blocks[0].port.isConnected);
  assert.equal(blocks[0].owner.block.id, BLOCK); assert.equal(blocks[0].owner.block.documentId, x.worker.documentId);
  assert.ok(x.f.native.nativeFocus.slice(result.focusStart).some(value => value.node === blocks[0].port),
    "The original admitted gesture reaches the actual linked block native focus, not just a route flag");
  assert.equal(x.f.native.document.activeElement, blocks[0].port);
  t.diagnostic("C_ARTIFACT_CHANGED_SOURCE_CLEAN " + JSON.stringify({ kind: "actual-admitted-Store-route", destination: x.destination,
    destinationMounted: true, exactContextBlock: BLOCK, physicalUnload: false, provider: false }));
}

test("C changed artifact source / exact decision link protects an unsent review note until explicit clear", { concurrency: false, timeout: 120_000 }, async t => {
  // The pristine native default would leave its document. Use a fresh real host
  // for the dirty branch, never a fabricated return from a recorded unload.
  for (const phase of ["clean", "raw"]) {
    const cleanups = [], owned = { mock: t.mock, diagnostic: value => t.diagnostic(value), after: callback => cleanups.push(callback) };
    try {
      const x = await page(owned);
      if (phase === "clean") {
        const original = await before(x), result = await activate(x);
        requested(t, x, result, original); await unchanged(x, original); continue;
      }
      await typeNote(x, RAW);
      const original = await before(x), originalDialog = review(x).dialog.port, result = await activate(x);
      await unchanged(x, original, true);
      t.diagnostic("C_ARTIFACT_CHANGED_SOURCE_RAW " + JSON.stringify({ defaultPrevented: result.event.defaultPrevented,
        defaults: x.defaults, trace: result.trace, originalRoute: original.route, route: x.h.store.route.get(),
        sameLibrary: x.library.isConnected, sameViewer: x.viewer.isConnected, originalDialogOpen: originalDialog.open,
        nativeScope: "original finite EventParts and anchor default request, not physical unload or full browser timing" }));
      assert.deepEqual(x.defaults, [], "Unsent review work must refuse the changed-source same-tab departure before native navigation");
      assert.equal(result.event.defaultPrevented, true); assert.equal(x.h.store.route.get(), original.route);
      const current = review(x); assert.equal(current.dialog.port, originalDialog); assert.equal(current.note.port.value, RAW);
      assert.ok(x.viewer.isConnected && x.library.isConnected && x.viewer.store === x.h.store);
      assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen"));
      await typeNote(x, ""); const clear = await before(x), fresh = await activate(x);
      requested(t, x, fresh, clear); await unchanged(x, clear);
    } finally { for (const cleanup of cleanups) await cleanup(); }
  }
});

// Separate actual Workspace parent: its real queued close event clears the
// workbench viewer flag before the existing linked-block focus can proceed.
test("C changed artifact source / Workspace healthy current viewer reaches the same exact decision", { concurrency: false, timeout: 120_000 }, async t => {
  const x = await page(t), { f, h } = x;
  const prior = review(x), oldViewer = x.viewer;
  const close = prior.tree.visible("button").filter(row => row.owner === oldViewer && inside(row, prior.dialog)
    && row.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
  assert.equal(close.length, 1); await click(x, close[0]);
  assert.equal(prior.dialog.port.open, false);
  assert.equal(x.dialogs.deliveries.filter(value => value.node === prior.dialog.port).length, 1,
    "The original Library setup ends through its genuine queued native Close");
  assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
  await click(x, f.find("a", row => row.owner.tag === "forma-ui-audience-navigation"
    && row.attributes.href.startsWith("/document/") && row.attributes.href.includes(encodeURIComponent(x.worker.documentId))));
  assert.equal(x.library.isConnected, false);
  const workspaces = f.components().filter(owner => owner.tag === "forma-workspace" && owner.isConnected && owner.store === h.store);
  assert.equal(workspaces.length, 1); x.workspace = workspaces[0];
  installImageFormatNativeLifetime({ f, h, after: callback => t.after(callback) });
  await drain(x);
  await click(x, f.find("button", row => row.owner === x.workspace && row.attributes["data-workbench-pane"] === "result"));
  const viewers = f.components().filter(owner => owner.tag === "forma-document-artifacts" && owner.isConnected
    && owner.store === h.store && owner.closest("forma-workspace") === x.workspace && owner.source === "document");
  assert.equal(viewers.length, 1); x.viewer = viewers[0];
  assert.notEqual(x.viewer, oldViewer); assert.equal(oldViewer.isConnected, false); assert.equal(x.viewer.launcherOnly, false);
  await drain(x);
  const tree = f.tree(), lists = tree.visible("div").filter(row => row.owner === x.viewer && classed(row, "document-artifact-list"));
  assert.equal(lists.length, 1);
  const openers = tree.visible("button").filter(row => row.owner === x.viewer && inside(row, lists[0])
    && tree.visible("b").some(label => inside(label, row) && label.text === x.artifact.title));
  assert.equal(openers.length, 1);
  x.dialogs.retainArtifactOpener(openers[0].port, ARTIFACT); await click(x, openers[0]);
  assert.ok(openers[0].port.isConnected && f.renderer.nodes.includes(openers[0].port));
  await click(x, f.find("button", row => row.owner === x.viewer && classed(row, "artifact-viewer-review-toggle")));
  const current = review(x); assert.equal(current.note.port.value, "");
  assert.equal(current.link.port.closest("forma-workspace"), x.workspace);
  const original = await before(x), result = await activate(x);
  requested(t, x, result, original); await unchanged(x, original);
  if (result.event.defaultPrevented) {
    assert.equal(x.dialogs.deliveries.filter(value => value.node === current.dialog.port).length, 1,
      "Healthy admission preserves the actual Workspace parent native close event");
    assert.equal(current.dialog.port.open, false);
    assert.equal(f.tree().visible("dialog").some(row => classed(row, "document-artifact-view")), false);
    assert.equal(h.store.ui.focusBlockId, BLOCK);
    assert.equal(f.find("button", row => row.owner === x.workspace && row.attributes["data-workbench-pane"] === "write").attributes["aria-pressed"], "true");
  }
});

// Borrow only the exact committed native-ancestor port from cSessionWideNative
// and project-rail-native-fixture. Geometry, media, focus, raw state and the
// actual Rail willUpdate/capture/target methods are unchanged.
async function cCrossDocumentRailAncestor(t, x, rail) {
  const { f, h } = x, parent = rail.parentElement, store = rail.store;
  assert.equal(store, h.store); assert.equal(parent, x.library);
  const originalDraw = f.draw, originalClosest = rail.closest;
  const descriptor = Object.getOwnPropertyDescriptor(rail, "closest");
  let committedShell = null, retired = false, drawing = false, renderReads = 0, missingNativeReads = 0;
  const capture = () => {
    if (!rail.isConnected) { retired = true; committedShell = null; return; }
    if (retired) return;
    assert.equal(rail.parentElement, parent); assert.equal(rail.store, store);
    assert.ok(f.host.isConnected && f.host.store === store && parent.isConnected);
    const tree = f.tree(), rows = tree.nodes.filter(row => row.component === rail);
    const shells = tree.visible("div").filter(row => row.owner === f.host && classed(row, "app-shell"));
    assert.equal(rows.length, 1); assert.equal(shells.length, 1);
    assert.ok(shells[0].port.isConnected && f.renderer.nodes.includes(shells[0].port));
    assert.ok(inside(rows[0], shells[0]), "The exact current Rail is inside this actual committed native Shell");
    assert.equal(originalClosest.call(rail, ".app-shell"), shells[0].port);
    assert.equal(typeof shells[0].port.getAttribute("data-nav-posture"), "string");
    committedShell = shells[0].port;
  };
  capture();
  const closest = function(selector) {
    if (selector !== ".app-shell") return originalClosest.call(this, selector);
    const native = originalClosest.call(this, selector);
    if (this !== rail || retired || !rail.isConnected || rail.parentElement !== parent
      || rail.store !== store || !f.host.isConnected || f.host.store !== store || !committedShell?.isConnected) return native;
    if (drawing) {
      if (f.renderer.updatingOwner === rail) { renderReads += 1; if (native === null) missingNativeReads += 1; }
    } else assert.equal(native, committedShell, "Outside render this port agrees with the exact current native ancestry");
    // During the same update, the previous committed literal remains the
    // actual ancestor until commit. Never return an unrelated Shell or node.
    return committedShell;
  };
  const draw = () => {
    drawing = true; let markup;
    try { markup = originalDraw(); } finally { drawing = false; }
    capture(); return markup;
  };
  rail.closest = closest; f.draw = draw;
  t.after(() => {
    if (rail.closest === closest) { if (descriptor) Object.defineProperty(rail, "closest", descriptor); else delete rail.closest; }
    if (f.draw === draw) f.draw = originalDraw;
  });
  await drain(x);
  assert.ok(renderReads > 0 && missingNativeReads > 0,
    "The actual Rail render reached the disclosed missing literal-ancestor port, not a fabricated current() result");
  const tree = f.tree(), shells = tree.visible("div").filter(row => row.owner === f.host && classed(row, "app-shell"));
  assert.equal(shells.length, 1); assert.equal(rail.closest(".app-shell"), shells[0].port);
  assert.equal(rail.closest("forma-shell"), f.host); assert.ok(rail.isConnected && shells[0].port.isConnected);
  t.diagnostic("C_ARTIFACT_RAIL_NATIVE_ANCESTOR " + JSON.stringify({ renderReads, missingNativeReads,
    currentNativeRoot: rail.closest(".app-shell") === shells[0].port, sameStore: rail.store === h.store,
    posture: shells[0].port.getAttribute("data-nav-posture"), viewportWidth: ports.windowPort.innerWidth,
    nativeFocusRemapped: false, geometryChanged: false }));
}

// One ordinary cross-Document journey over the existing bootstrap and retained
// artifact. No new fixture record, copy, job, provider request, or second receipt.
async function cCrossDocumentRailClick(x, link, rail) {
  assert.ok(link.port.isConnected && x.f.renderer.nodes.includes(link.port));
  assert.equal(link.hiddenBy, null); assert.equal(link.port.matches(":disabled"), false);
  assert.equal(link.port.closest("forma-project-rail"), rail);
  const path = []; for (let row = link; row; row = row.parent) path.push(row);
  const captures = path.filter(row => row.owner === rail && row.tag === "aside" && classed(row, "project-rail"));
  assert.equal(captures.length, 1); assert.equal(captures[0].handlers.click.capture, true);
  assert.equal(typeof captures[0].handlers.click.handleEvent, "function");
  assert.equal(typeof link.handlers.click, "function");
  assert.equal((x.f.listeners.get("click") ?? []).length, 0);
  for (const row of path) assert.equal(row.port?.listeners?.click, undefined);
  x.f.native.emit("pointerdown", link.port); x.f.native.focus(link.port);
  let stopped = false, immediate = false;
  const trace = [], pending = [], event = { type: "click", target: link.port, currentTarget: null, eventPhase: 0,
    bubbles: true, cancelable: true, button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; immediate = true; },
    composedPath: () => path.map(row => row.port ?? row.component).filter(Boolean) };
  const invoke = (row, phase, capture) => {
    const callback = row.handlers?.click;
    if (!callback || Boolean(typeof callback === "object" && callback.capture) !== capture || immediate) return;
    assert.ok(row.port?.isConnected); event.currentTarget = row.port; event.eventPhase = phase === "target" ? 2 : capture ? 1 : 3;
    trace.push({ row, phase });
    const result = typeof callback === "function" ? callback.call(row.owner, event) : callback.handleEvent(event);
    if (result && typeof result.then === "function") pending.push(result);
  };
  // Same finite synchronous original-EventPart path as activate(), now including
  // this actual ProjectRail capture guard. No fake default route or UA claim.
  for (const row of path.slice(1).reverse()) { invoke(row, "capture", true); if (stopped) break; }
  if (!stopped) { invoke(link, "target", true); invoke(link, "target", false); }
  if (!stopped) for (const row of path.slice(1)) { invoke(row, "bubble", false); if (stopped) break; }
  event.currentTarget = null; event.eventPhase = 0;
  assert.equal(trace.filter(entry => entry.row === captures[0] && entry.phase === "capture").length, 1);
  assert.equal(trace.filter(entry => entry.row === link && entry.phase === "target").length, 1);
  assert.equal(event.defaultPrevented, true, "The actual current rail selection, not native default navigation, owns setup");
  await Promise.all(pending); await drain(x);
}

// Read the existing Worker's same-binding readiness; never set or repair it.
import { outputSchemaIsReady } from "../worker/output-schema-state.ts";

function cCrossDocumentEmptyReads(t, x, original, document) {
  const { h, worker } = x, database = worker.env.DB, media = worker.env.MEDIA, network = globalThis.fetch;
  assert.equal(database, worker.DB); assert.equal(outputSchemaIsReady(database), true);
  assert.equal(document.id, "doc-atmosphere"); assert.equal(worker.documentId, "scene-reuse-document");
  const sourceDocument = h.store.projection.get().documents.find(value => value.id === worker.documentId && !value.removed);
  assert.ok(sourceDocument); assert.equal(sourceDocument.projectId, worker.projectId);
  const selected = { id: document.id, route: withDocumentInRoute("/", document.id, document.title) };
  const source = { id: worker.documentId, route: documentContextBlockRoute(worker.documentId, sourceDocument.title, BLOCK) };
  assert.equal(source.route, x.destination, "The original source route retains its exact Context hash");
  const targets = new Map([
    ["/api/document-jobs/presentation-candidates?document=doc-atmosphere", selected],
    ["/api/output-requirements?documentId=doc-atmosphere", selected],
    ["/api/document-jobs/presentation-candidates?document=scene-reuse-document", source],
    ["/api/output-requirements?documentId=scene-reuse-document", source],
  ]);
  const targetFor = url => { const target = targets.get(url); assert.ok(target, "Only the four exact existing-Document reads"); return target; };
  assert.equal(typeof network.mock?.callCount, "function");
  const storage = Object.entries(media).filter(([, value]) => typeof value === "function").map(([name, value]) =>
    [name, t.mock.method(media, name, function (...args) { return Reflect.apply(value, this, args); })]);
  const noCalls = () => {
    assert.equal(worker.env.DB, database); assert.equal(outputSchemaIsReady(database), true);
    assert.equal(worker.env.MEDIA, media); assert.equal(globalThis.fetch, network);
    assert.equal(network.mock.callCount(), 0, "No swallowed provider or external request");
    for (const [name, observation] of storage) {
      assert.equal(media[name], observation); assert.equal(observation.mock.callCount(), 0, "No storage call: " + name);
    }
  };
  const effects = () => {
    noCalls();
    const schema = worker.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const outputs = schema.filter(row => row.type === "table" && row.name.startsWith("output_")).map(row => row.name);
    assert.ok(outputs.includes("output_atomic_assertions") && outputs.includes("output_plan_revisions") && outputs.includes("output_assets"));
    const tables = ["users", "organizations", "organization_projects", "organization_memberships", "project_memberships",
      "capability_grants", "project_context_sessions", "pilot_participants", "impersonation_sessions", "external_content",
      "artifact_revisions", "platform_assistant_private_content", "organization_retention_policies", "organization_legal_holds",
      "retention_sweep_runs", ...outputs];
    const rows = Object.fromEntries(tables.map(table => {
      assert.match(table, /^[a-z0-9_]+$/u);
      return [table, schema.some(row => row.type === "table" && row.name === table)
        ? worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all() : null];
    }));
    for (const table of outputs) assert.deepEqual(rows[table], [], "The inherited Output ledger is empty: " + table);
    const money = financial(worker); assert.deepEqual(money.document_jobs, []);
    return { writes: [...worker.controls.writes], changes: worker.sqlite.prepare("SELECT total_changes() AS changes").get().changes,
      schemaVersion: worker.sqlite.prepare("PRAGMA schema_version").get().schema_version, schema, rows,
      private: privateRows(worker), money };
  };
  const admit = request => {
    const target = targetFor(request.url);
    assert.equal(request.init.method ?? "GET", "GET"); assert.equal(request.init.body, undefined); assert.equal(request.body, null);
    const headers = new Headers(request.init.headers);
    for (const name of ["cookie", "oai-authenticated-user-id", "oai-authenticated-user-email",
      "oai-authenticated-user-full-name", "oai-authenticated-user-full-name-encoding"]) assert.equal(headers.has(name), false);
    assert.equal(worker.sharing, null); assert.equal(worker.env.FORMA_PILOT_COHORT_ID ?? "", "");
    const session = h.store.session.get(), user = worker.sqlite.prepare("SELECT * FROM users WHERE user_id=?").get(worker.owner);
    assert.ok(user); assert.equal(session.projectContext ?? null, null); assert.equal(session.impersonation ?? null, null);
    assert.equal(session.policy.accepted, true);
    assert.deepEqual([user.user_id, user.email, user.display_name, user.role, user.consent_version],
      ["dev-local-creative", "creative@local.forma", "Local creative", session.user.role, session.policy.version]);
    assert.equal(session.user.userId, worker.owner);
    assert.ok(h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authority));
    assert.equal(h.store.route.get(), target.route);
    const projection = h.store.projection.get();
    assert.equal(projection.documentId, target.id); assert.equal(projection.projectId, worker.projectId);
    if (target === source) {
      assert.deepEqual(projection.blocks.map(block => [block.id, block.type]), [[BLOCK, "direction"]]);
      assert.equal(projection.blocks[0].properties.source_evidence_hash, undefined);
      assert.equal(projection.blocks[0].properties.extraction_status, undefined);
    }
    assert.ok(projection.blocks.length > 0, "Empty extracted-source claims do not mean a fabricated blank Document");
    assert.deepEqual(projection.blocks.filter(block => String(block.type).toLowerCase() === "output" && !block.removed), []);
    assert.deepEqual(projection.blocks.filter(block => block.type === "reference"
      && (block.properties.source_evidence_hash || block.properties.extraction_status === "ready")), []);
    assert.deepEqual(h.store.events.get().filter(event => event.type.startsWith("Output") && event.payload.document_id === target.id), []);
    noCalls();
  };
  return { admit, checkpoint: effects,
    async begin(request, baseline) {
      assert.ok(baseline, "The original setup append and private receipt precede these reads");
      await worker.drainBackground(); admit(request);
      const before = effects(); assert.deepEqual(before, baseline, "No effect since the original canonical selection barrier");
      return before;
    },
    async certify(row, before, baseline) {
      const documentId = targetFor(row.url).id;
      assert.equal(row.response.headers.get("cache-control"), "private, no-store");
      assert.match(row.response.headers.get("content-type") ?? "", /^application\/json\b/u);
      if (row.kind === "empty-preserved-draft-list") assert.deepEqual(row.body, { documentId, jobs: [] });
      else {
        const body = row.body;
        assert.equal(body.schemaVersion, 1); assert.equal(body.documentId, documentId); assert.equal(body.projectId, worker.projectId);
        assert.deepEqual(body.scope, { kind: "personal", organizationId: null, projectAccessId: null, actorUserId: worker.owner });
        assert.equal(body.revision, "output:" + (original.head + 1));
        for (const key of ["sourceRevision", "requirementRevision"]) assert.match(body[key], /^[a-f0-9]{64}$/u);
        for (const key of ["requirements", "targetStates", "scopeAmendments", "assets", "results", "grants"]) assert.deepEqual(body[key], []);
        assert.equal(body.confirmedPlan, null); assert.equal(body.summary, null);
        assert.deepEqual(body.requirementSummaries, {}); assert.deepEqual(body.requirementFileCounts, {});
        assert.ok(["verified", "unavailable"].includes(body.sourceVerification.status));
        assert.ok(Array.isArray(body.sourceVerification.reasonCodes) && body.sourceVerification.reasonCodes.every(code => typeof code === "string"));
        const capacity = body.sourceVerification.capacity;
        assert.equal(capacity.referenceCount, 0); assert.equal(capacity.distinctObjectCount, 0); assert.equal(capacity.countsComplete, true);
        assert.deepEqual(capacity.sources, []); assert.equal(capacity.sourcesComplete, true);
        for (const key of ["canAuthor", "canRequest", "canReview", "canDownload", "independentReview"])
          assert.equal(typeof body.permissions[key], "boolean");
        assert.equal(body.permissions.independentReview, false);
      }
      await worker.drainBackground();
      assert.deepEqual(effects(), before, "The original empty read, including ordinary background retention, has no durable effects");
      assert.deepEqual(before, baseline); row.emptyReadCertified = true;
    },
    verify(baseline, records) {
      assert.ok(baseline); assert.deepEqual(effects(), baseline, "The complete post-selection journey remains no-write");
      for (const url of targets.keys()) assert.ok(records.some(row => row.url === url && row.emptyReadCertified === true),
        "Each exact existing-Document read reaches its own original 200 and no-effect proof: " + url);
    },
    restore() { for (const [name, observation] of storage) if (media[name] === observation) observation.mock.restore(); },
  };
}

function cCrossDocumentOperations(t, x, original, document) {
  const { h, worker, resume } = x, prior = h.transport, priorIntercept = h.intercept;
  assert.equal(typeof prior, "function"); assert.equal(priorIntercept, null);
  const input = { type: "DocumentOpened", payload: { document_id: document.id,
    previous_document_id: worker.documentId, source_surface: "project-rail" } };
  const records = [], pending = new Set(), failures = []; let selection = null, canonicalWrite = null;
  const emptyReads = cCrossDocumentEmptyReads(t, x, original, document); let afterSelection = null;
  const diagnostic = phase => t.diagnostic("C_ARTIFACT_CROSS_DOCUMENT_REQUESTS " + JSON.stringify({ phase,
    pending: pending.size, failureCount: failures.length, records: records.map((row, index) => ({ index,
      kind: row.kind || "unclassified", method: row.method, url: row.url, interceptFailed: Boolean(row.interceptFailed),
      responseStatus: row.response?.status ?? null, bodyInspected: row.body !== null, delivered: row.delivered,
      sameInit: row.request.init === row.init, sameBody: row.request.init.body === row.bytes })) }));
  const intercept = request => {
    const method = request.init.method ?? "GET", row = { request, init: request.init, bytes: request.init.body,
      url: request.url, method, kind: "", response: null, body: null, delivered: false };
    records.push(row);
    try {
    if (request.url === "/api/events" && method === "POST") {
      assert.equal(selection, null, "Exactly one original setup navigation append; no retry or final-link write");
      assert.deepEqual(request.body, { action: "append", event: input, events: [input],
        expectedSequence: original.head, clientId: "web:lit" });
      assert.equal(request.init.body, JSON.stringify(request.body)); row.kind = "selection"; selection = row;
    } else if (method === "GET" && ["/api/document-jobs", "/api/document-jobs?document=doc-atmosphere",
      "/api/document-jobs?document=scene-reuse-document"].includes(request.url)) {
      const path = new URL(h.store.route.get(), "https://fixture.invalid").pathname;
      const expected = path.startsWith("/document/" + document.id + "/") ? "/api/document-jobs?document=" + document.id
        : path.startsWith("/document/" + worker.documentId + "/") ? "/api/document-jobs?document=" + worker.documentId
          : path === "/library" || path.startsWith("/library/") ? "/api/document-jobs" : null;
      assert.equal(request.url, expected, "Only this actual route's empty passive list is admitted"); row.kind = "empty-job-list";
    } else if (method === "GET" && ["/api/document-jobs/presentation-candidates?document=doc-atmosphere",
      "/api/output-requirements?documentId=doc-atmosphere",
      "/api/document-jobs/presentation-candidates?document=scene-reuse-document",
      "/api/output-requirements?documentId=scene-reuse-document"].includes(request.url)) {
      emptyReads.admit(request);
      row.kind = request.url === "/api/document-jobs/presentation-candidates?document=doc-atmosphere"
        || request.url === "/api/document-jobs/presentation-candidates?document=scene-reuse-document"
        ? "empty-preserved-draft-list" : "empty-output-snapshot";
    } else if (method === "GET" && request.url === "/api/events?after=" + h.store.head.get() + "&limit=1&content=1") {
      row.kind = "all-content-hydration";
    } else if (method === "POST" && request.url === "/api/workspace/quick-edit") {
      const projection = h.store.projection.get();
      assert.ok([worker.documentId, document.id].includes(projection.documentId));
      assert.deepEqual(request.body, { action: "resume", projectId: worker.projectId, documentId: projection.documentId });
      row.kind = "candidate-resume"; // Success and no-write certification are still required below.
    } else assert.fail("Unclassified cross-Document operation: " + method + " " + request.url);
    // A deny-only observer: undefined preserves the original host transport.
    // In particular a job detail/run/POST cannot reach the host's legacy run stub.
    return undefined;
    } catch (error) {
      row.interceptFailed = true; failures.push(error); diagnostic("intercept-failure"); throw error;
    }
  };
  const execute = async request => {
    const row = records.find(value => value.request === request); assert.ok(row);
    assert.ok(h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authority));
    let release;
    if (row.kind === "selection") {
      // Reuse the original ACK fixture's content-free canonical-write barrier:
      // finish earlier certified reads first, and start later reads only after
      // this real append. No request/response replacement or held result gate.
      canonicalWrite = new Promise(resolve => { release = resolve; });
    }
    try {
      if (row.kind === "selection") await resume.settleOriginalRequests();
      else if (canonicalWrite) await canonicalWrite;
      const emptyBefore = ["empty-preserved-draft-list", "empty-output-snapshot"].includes(row.kind)
        ? await emptyReads.begin(request, afterSelection) : null;
      const response = await prior(request); row.response = response;
      assert.equal(response.status, 200, await response.clone().text());
      row.body = await response.clone().json();
      assert.equal(request.init, row.init); assert.equal(request.init.body, row.bytes); assert.equal(request.url, row.url);
      assert.equal(response.bodyUsed, false, "Only clones are inspected; the original response is delivered once");
      if (row.kind === "selection") {
        const receipt = row.body;
        assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
        assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
        const event = receipt.appended[0];
        assert.equal(event.type, input.type); assert.deepEqual(event.payload, input.payload);
        assert.equal(event.streamId, worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
        assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
        assert.equal(event.compensatesEventId, null); assert.equal(event.payload.client_event_id, undefined);
        await worker.drainBackground();
        assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, event]);
        const actual = privateRows(worker), rows = actual.event_private_payloads.filter(value => value.private_event_id === event.eventId);
        row.canonicalPrivate = actual;
        assert.equal(rows.length, 1); assert.equal(rows[0].owner_id, worker.owner);
        assert.equal(rows[0].document_id, document.id); assert.equal(rows[0].redacted_at, null);
        assert.deepEqual(JSON.parse(rows[0].private_json), input.payload);
        assert.equal(actual.events.filter(value => value.event_id === event.eventId).length, 1);
        assert.deepEqual(actual.events.filter(value => value.event_id !== event.eventId), original.private.events);
        assert.deepEqual(actual.event_private_payloads.filter(value => value.private_event_id !== event.eventId), original.private.event_private_payloads);
        for (const table of ["private_content", "private_content_retention_scopes", "event_client_receipts"])
          assert.deepEqual(actual[table], original.private[table]);
        assert.deepEqual(financial(worker), original.money);
        afterSelection = emptyReads.checkpoint();
      } else if (row.kind === "empty-job-list") {
        assert.ok(Array.isArray(row.body.jobs)); assert.deepEqual(row.body.jobs, []);
      } else if (["empty-preserved-draft-list", "empty-output-snapshot"].includes(row.kind)) {
        await emptyReads.certify(row, emptyBefore, afterSelection);
      } else if (row.kind === "candidate-resume") {
        assert.deepEqual(row.body, { status: "none" }); assert.equal(resume.isReadOnlyResume(request), true);
      } else {
        assert.ok(row.body.content && typeof row.body.content === "object");
        assert.equal(row.body.content[worker.contentRef], worker.content);
      }
      row.delivered = true; return response;
    } finally { release?.(); }
  };
  const transport = request => {
    const operation = execute(request); pending.add(operation);
    operation.then(() => pending.delete(operation), error => { pending.delete(operation); failures.push(error); });
    return operation;
  };
  h.intercept = intercept; h.transport = transport;
  const join = async () => { await Promise.allSettled([...pending]); if (failures.length) { diagnostic("join-failure"); throw failures[0]; } };
  const restore = () => { if (h.transport === transport) h.transport = prior; if (h.intercept === intercept) h.intercept = priorIntercept; emptyReads.restore(); };
  t.after(async () => { try { await join(); } finally { restore(); } });
  return { records, selection: () => selection, join, restore,
    verify() {
      const observed = h.requests.slice(original.requests);
      diagnostic("verify");
      assert.deepEqual(records.map(row => row.request), observed, "Every incremental original request is individually classified");
      assert.equal(records.filter(row => row.kind === "selection").length, 1);
      assert.ok(records.every(row => row.delivered && row.response.status === 200));
      for (const kind of ["empty-preserved-draft-list", "empty-output-snapshot"]) {
        assert.ok(records.some(row => row.kind === kind), "The actual mount issued the exact empty read: " + kind);
        assert.ok(records.filter(row => row.kind === kind).every(row => row.emptyReadCertified === true));
      }
      emptyReads.verify(afterSelection, records);
      for (const row of records) {
        assert.equal(row.request.init, row.init); assert.equal(row.request.init.body, row.bytes);
        if (row.kind === "candidate-resume") assert.equal(resume.isReadOnlyResume(row.request), true);
      }
    } };
}

test("C changed artifact source / another legitimately selected document preserves the exact original source arrival", { concurrency: false, timeout: 120_000 }, async t => {
  const x = await page(t), { f, h, worker } = x, initialLibrary = x.library, initialViewer = x.viewer;
  const projection = h.store.projection.get(), other = projection.documents.find(value => value.id === "doc-atmosphere");
  assert.ok(other); assert.equal(other.title, "Atmosphere studies"); assert.equal(other.projectId, worker.projectId);
  assert.equal(other.removed, false); assert.equal(projection.documentId, worker.documentId);
  const bootstrap = h.store.events.get().filter(event => event.type === "DocumentCreated" && event.payload.document_id === other.id);
  assert.equal(bootstrap.length, 1); assert.equal(bootstrap[0].clientId, "seed:lit-studio");
  assert.ok((await readWorkspaceEvents(worker.env, worker.streamId)).some(event => event.eventId === bootstrap[0].eventId));
  const prior = review(x), close = prior.tree.visible("button").filter(row => row.owner === initialViewer && inside(row, prior.dialog)
    && row.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
  assert.equal(close.length, 1); await click(x, close[0]);
  assert.equal(prior.dialog.port.open, false);
  assert.equal(x.dialogs.deliveries.filter(value => value.node === prior.dialog.port).length, 1);
  assert.equal(libraryFocusFromRoute(h.store.route.get()), null);

  const setup = await before(x), operations = cCrossDocumentOperations(t, x, setup, other);
  assert.deepEqual(setup.money.document_jobs, []);
  const rails = f.components().filter(owner => owner.tag === "forma-project-rail" && owner.isConnected
    && owner.store === h.store && owner.closest("forma-library") === initialLibrary);
  assert.equal(rails.length, 1); const rail = rails[0];
  await cCrossDocumentRailAncestor(t, x, rail);
  const railTree = f.tree();
  const documentRoute = withDocumentInRoute("/", other.id, other.title);
  const links = railTree.visible("a").filter(row => row.owner === rail && row.attributes.href === documentRoute);
  assert.equal(links.length, 1); await cCrossDocumentRailClick(x, links[0], rail);
  await operations.join(); await drain(x);
  const selection = operations.selection(); assert.ok(selection?.delivered);
  assert.equal(h.store.route.get(), documentRoute); assert.equal(h.store.projection.get().documentId, other.id);
  assert.equal(initialLibrary.isConnected, false); assert.equal(initialViewer.isConnected, false);
  assert.deepEqual(h.store.events.get(), [...setup.events, ...selection.body.appended]);
  assert.equal(h.store.head.get(), setup.head + 1);

  await click(x, f.find("a", row => row.owner.tag === "forma-ui-audience-navigation"
    && new URL(row.attributes.href, "https://fixture.invalid").pathname === "/library"));
  const libraries = f.components().filter(owner => owner.tag === "forma-library" && owner.isConnected && owner.store === h.store);
  assert.equal(libraries.length, 1); x.library = libraries[0]; assert.notEqual(x.library, initialLibrary);
  assert.equal(h.store.projection.get().documentId, other.id);
  assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").searchParams.get("document"), other.id);
  const viewers = f.components().filter(owner => owner.tag === "forma-document-artifacts" && owner.isConnected
    && owner.store === h.store && owner.closest("forma-library") === x.library && owner.source === "library");
  assert.equal(viewers.length, 1); x.viewer = viewers[0]; assert.notEqual(x.viewer, initialViewer);
  assert.equal(x.viewer.launcherOnly, true); await drain(x);
  await click(x, f.find("button", row => row.owner.tag === "forma-ui-segmented-control"
    && row.owner.parentElement === x.library && row.owner.label === f.i18n.t("projects.libraryContent", "Library content")
    && row.text === f.i18n.t("projects.filter.outputs", "Outputs")));
  assert.deepEqual(h.store.projection.get().libraryArtifacts.find(value => value.id === ARTIFACT), x.artifact);
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === BLOCK), x.block);
  const opener = f.find("a", row => row.owner === x.library && classed(row, "library-artifact-open")
    && libraryFocusFromRoute(row.attributes.href)?.kind === "artifact" && libraryFocusFromRoute(row.attributes.href)?.id === ARTIFACT);
  x.dialogs.retainArtifactOpener(opener.port, ARTIFACT); await click(x, opener);
  assert.ok(opener.port.isConnected && f.renderer.nodes.includes(opener.port));
  assert.equal(h.store.projection.get().documentId, other.id);
  assert.equal(libraryFocusFromRoute(h.store.route.get())?.id, ARTIFACT);
  await click(x, f.find("button", row => row.owner === x.viewer && classed(row, "artifact-viewer-review-toggle")));
  const current = review(x); assert.equal(current.note.port.value, "");
  assert.equal(x.artifact.documentId, worker.documentId); assert.equal(x.block.documentId, worker.documentId);
  assert.notEqual(h.store.projection.get().documentId, x.artifact.documentId);
  const original = await before(x);
  assert.deepEqual(original.history, [...setup.history, ...selection.body.appended]);
  assert.deepEqual(original.events, [...setup.events, ...selection.body.appended]);
  assert.equal(original.head, setup.head + 1); assert.deepEqual(original.private, selection.canonicalPrivate);
  assert.deepEqual(original.money, setup.money);
  const result = await activate(x);
  assert.equal(result.event.defaultPrevented, true, "The existing admitted source path, not a recorded native default, must arrive");
  requested(t, x, result, original); await unchanged(x, original); await operations.join(); operations.verify();
  assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.equal(x.dialogs.deliveries.filter(value => value.node === current.dialog.port).length, 1);
  assert.equal(current.dialog.port.open, false);
  assert.equal(f.tree().visible("dialog").some(row => classed(row, "document-artifact-view")), false);
  assert.equal(h.store.ui.focusBlockId, BLOCK);
  t.diagnostic("C_ARTIFACT_CROSS_DOCUMENT_ORIGINAL " + JSON.stringify({ setupDocument: other.id, sourceDocument: worker.documentId,
    originalEventId: selection.body.appended[0].eventId, originalStatus: selection.response.status, setupWrites: 1,
    finalSourceLinkWrites: operations.records.filter(row => row.kind === "selection").length - 1,
    exactContextBlock: BLOCK, operations: operations.records.map(row => ({ kind: row.kind, method: row.method, url: row.url })),
    physicalUnload: false, provider: false }));
  operations.restore(); // Existing page cleanup can restore its own Resume observer normally.
});
