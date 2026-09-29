// Complete actual Shell/Canvas/Library/ProjectRail/Workspace, full Store and RAM
// Worker. The two tests opt in to one exact original DocumentOpened receipt.
// Native ports provide functional component evidence, not browser focus proof.
import assert from "node:assert/strict";
import test from "node:test";
import { options, OTHER_DOCUMENT, classed, inside, drain, reached, boardPage, sceneDeferred } from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { applicationIdFromRoute } from "../src/platform/applications.ts";
import { documentIdFromRoute, projectTaskDocumentIdFromRoute, routePathname, withDocumentInRoute } from "../src/model/routes.ts";

function one(f, tag) {
  const owners = f.components().filter(owner => owner.tag === tag && owner.isConnected);
  assert.equal(owners.length, 1, "one connected actual " + tag); return owners[0];
}
async function railPage(t) {
  // Exact authored ID from scene-cost-fixture; the returned planning anchor
  // below must agree. Do not overwrite the Library's actual global selection.
  const f = await boardPage(t, { railDocumentReceipt: "scene-reuse-document" }), h = f.storeHost;
  assert.equal(f.documentId, "scene-reuse-document", "the receipt target is the real original RAM planning Document");
  const shell = one(f, "forma-shell"); assert.equal(shell, f.host); assert.equal(shell.store, f.store);
  const link = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && routePathname(node.attributes.href ?? "") === "/canvas/library");
  assert.ok(link.port.isConnected); f.native.emit("pointerdown", link.port); f.native.focus(link.port);
  await f.act(link, "click", { button: 0 });
  await reached(f, () => routePathname(f.store.route.get()) === "/canvas/library"
    && f.components().some(owner => owner.tag === "forma-library" && owner.isConnected), "the real Canvas task opens its Library");
  const library = one(f, "forma-library"), rail = one(f, "forma-project-rail");
  assert.equal(library.store, f.store); assert.equal(rail.store, f.store);
  assert.equal(rail.closest("forma-library"), library); assert.equal(rail.closest("forma-shell"), shell);
  assert.equal(f.canvas.isConnected, false); assert.equal(applicationIdFromRoute(f.store.route.get()), "canvas");
  assert.equal(f.store.projection.get().documentId, OTHER_DOCUMENT, "the real Canvas Library task retains its actual global current Document");
  assert.notEqual(f.store.projection.get().documentId, f.documentId, "the planning-anchor target is genuinely different before the Rail gesture");
  const document = f.store.projection.get().documents.find(value => value.id === f.documentId);
  assert.ok(document && document.projectId === f.projectId);
  const destination = withDocumentInRoute("/", document.id, document.title);
  assert.equal(applicationIdFromRoute(destination), "creative");
  const row = f.find("a", node => node.owner === rail && node.attributes.href === destination);
  assert.equal(row.attributes["aria-label"], f.i18n.t("projects.openCreatorDocument", "Open document in Creator Workspace") + ": " + document.title);
  assert.equal(documentIdFromRoute(row.attributes.href), f.documentId);
  assert.ok(row.port.isConnected && !row.hiddenBy && typeof row.port.click === "function");
  return Object.assign(f, { railLibrary: library, railOwner: rail, railDestination: destination, railLink: row, railHost: h });
}
function holdPositiveSession(f) {
  const h = f.railHost, previous = h.intercept, release = sceneDeferred();
  const state = { entered: false, returned: false, count: 0, body: null };
  h.intercept = async request => {
    if (request.url !== "/api/session?audience=creative") return previous?.(request);
    assert.equal(request.init.method ?? "GET", "GET"); assert.equal(++state.count, 1);
    const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200, "The SAME actual positive audience response exists before the newer gesture");
    const body = await response.clone().json(); assert.equal(response.bodyUsed, false);
    assert.equal(body.audience, "creative"); assert.equal(body.user.userId, f.store.session.get().user.userId);
    state.body = { userId: body.user.userId, audience: body.audience, permissionEpoch: body.permissionEpoch };
    state.entered = true; await release.promise; state.returned = true; return response;
  };
  return { state, release, restore() { h.intercept = previous; } };
}
async function startRail(f, gate) {
  await f.railReceipt.arm();
  const row = f.find("a", node => node.owner === f.railOwner && node.attributes.href === f.railDestination);
  f.native.emit("pointerdown", row.port); f.native.focus(row.port);
  row.port.click(); // Invoke the genuine current native link, never the private method.
  await reached(f, () => gate.state.entered && f.railReceipt.acknowledged(), "both original audience response and exact real navigation ACK are reached");
  assert.equal(f.store.ui.commandOpen, false, "No command/palette substitutes for this ordinary Rail gesture");
  assert.ok(f.railLibrary.isConnected); assert.equal(routePathname(f.store.route.get()), "/canvas/library");
  const receipt = await f.railReceipt.verify();
  // The response clone proves the server commit, not Store body consumption.
  // The still-current Library URL separately owns its displayed Document.
  await reached(f, () => f.store.events.get().some(event => event.eventId === receipt.eventId)
    && f.store.head.get() === receipt.head, "the Store consumes and publishes the exact original DocumentOpened before the later gesture");
  const published = f.store.events.get().filter(event => event.eventId === receipt.eventId);
  assert.equal(published.length, 1); assert.equal(published[0].type, "DocumentOpened");
  assert.deepEqual(published[0].payload, { document_id: f.documentId, previous_document_id: OTHER_DOCUMENT, source_surface: "project-rail" });
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), OTHER_DOCUMENT);
  assert.equal(f.store.projection.get().documentId, OTHER_DOCUMENT, "The current Library task context remains authoritative until actual route handoff");
  return receipt;
}
async function effects(f, t, receipt, gate) {
  await f.resume.settleOriginalRequests(); await drain(f, 2);
  assert.deepEqual(await f.railReceipt.verify(), receipt);
  assert.equal(gate.state.returned, true); assert.equal(gate.state.count, 1);
  assert.equal(f.resume.pendingOriginalCount(), 0);
  assert.deepEqual(f.railHost.requests.filter(request => (request.init.method ?? "GET") !== "GET"
    && !f.resume.isReadOnlyResume(request) && !f.railReceipt.isOriginal(request)), []);
  await f.sourceUnchanged();
  t.diagnostic("C_RAIL_CROSS_AUDIENCE_ORIGINAL " + JSON.stringify({ receipt, positiveSession: gate.state.body,
    route: f.store.route.get(), sourceActive: f.store.sourceOwnershipActive(f.store.captureSourceOwnership()) }));
}

test("actual Canvas Library Rail opens a different Creator Document after its original positive response", options, async t => {
  const f = await railPage(t), gate = holdPositiveSession(f), actor = f.store.session.get().user.userId;
  try {
    const receipt = await startRail(f, gate);
    gate.release.resolve();
    await reached(f, () => f.store.route.get() === f.railDestination && !f.railLibrary.isConnected,
      "a healthy ordinary cross-audience Rail gesture reaches its exact Creator Document");
    const workspace = one(f, "forma-workspace"); assert.equal(workspace.store, f.store);
    assert.equal(f.store.session.get().user.userId, actor); assert.equal(f.store.projection.get().documentId, f.documentId);
    assert.ok(f.store.routeDataReady()); assert.ok(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()));
    await effects(f, t, receipt, gate);
  } finally { gate.release.resolve(); await drain(f); gate.restore(); }
});

test("actual Canvas Library Rail original positive response cannot override a newer native Search gesture", options, async t => {
  const f = await railPage(t), gate = holdPositiveSession(f);
  try {
    const receipt = await startRail(f, gate), route = f.store.route.get();
    const tree = f.tree(), toolbar = tree.visible("form").filter(node => node.owner === f.railLibrary && classed(node, "library-toolbar"));
    assert.equal(toolbar.length, 1);
    const fields = tree.visible("input").filter(node => node.owner.tag === "forma-ui-search" && inside(node, toolbar[0]));
    assert.equal(fields.length, 1, "one current real Library search input, not a hidden/background control");
    const input = fields[0], searchOwner = input.owner, raw = "  newer exact Library search — 文書  ";
    assert.equal(searchOwner.closest("forma-library"), f.railLibrary); assert.ok(input.port.isConnected);
    f.native.emit("pointerdown", input.port); f.native.focus(input.port);
    input.port.value = raw; await f.act(input, "input");
    const current = f.find("input", node => node.owner === searchOwner && node.attributes.type === "search");
    assert.equal(current.port.value, raw); assert.equal(searchOwner.value, raw);
    // Literal native ports may be rebuilt by the finite renderer. Focus the
    // CURRENT enabled input after its real redraw, never reconnect an old port.
    f.native.focus(current.port);
    const focusCount = f.native.nativeFocus.length, history = [...f.history];
    gate.release.resolve(); await drain(f);
    await effects(f, t, receipt, gate); // Receipt/history/fiscal prerequisites precede the desired refusal assertions.
    assert.equal(f.store.route.get(), route, "The earlier positive audience response does not force Creator navigation over newer Search");
    assert.ok(f.railLibrary.isConnected); assert.equal(one(f, "forma-library"), f.railLibrary);
    assert.equal(f.find("input", node => node.owner === searchOwner && node.attributes.type === "search").port.value, raw);
    assert.deepEqual(f.history, history, "No late history write or replacement route follows the retired gesture");
    assert.equal(f.native.nativeFocus.length, focusCount, "No late destination focus steals the newer native Search gesture");
    assert.equal(f.components().filter(owner => owner.tag === "forma-workspace" && owner.isConnected).length, 0);
  } finally { gate.release.resolve(); await drain(f); gate.restore(); }
});
