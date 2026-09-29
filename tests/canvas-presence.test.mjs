import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { CanvasPresenceHub as ProductionHub } from "../src/canvas/presence.ts";
import { createPresenceBrowser } from "./helpers/canvas-presence-runtime.mjs";
import { canvasLegacySourceOwnership } from "./helpers/canvas-source-queue-host.mjs";
import { canvasViewFromRoute } from "../src/canvas/routes.ts";
import { outcomeDeskRouteState } from "../src/model/outcome-desk.ts";
import { OutcomeArrangementController } from "../src/state/outcome-desk-controller.ts";

const scope = { userId: "account-a", projectId: "project-a", canvasId: "board-a", authorizationKey: "principal\u0000permission-1" };

// Execute the real hub with deterministic BroadcastChannel/timer ports.
// This is local-transport and host-logic evidence, not a native-browser check.
const browser = () => createPresenceBrowser(scope);
function pair() {
  const local = browser(), a = local.hub("tab-a"), b = local.hub("tab-b");
  local.advance(2_000);
  b.hub.update({ x: 24, y: 60, selectedItemId: "item-a" }); local.flush();
  return { ...local, a, b, frame: () => b.channel.posts.at(-1) };
}

test("same-account other tabs meet; the same tab and foreign accounts do not", () => {
  const f = pair();
  assert.equal(f.a.peers().length, 1);
  assert.equal(f.a.peers()[0].tabId, "tab-b");
  assert.equal(f.a.peers()[0].hasPosition, true);
  assert.equal(f.b.peers()[0].hasPosition, false, "No fabricated origin cursor before a position update");
  const own = f.hub("tab-a"), foreign = f.hub("tab-c", { ...scope, userId: "account-b" });
  own.hub.update({ x: 7, y: 9 }); foreign.hub.update({ x: 80, y: 90 }); f.flush();
  assert.deepEqual(f.a.peers().map(peer => peer.tabId), ["tab-b"]);
  assert.equal(foreign.peers().length, 0);
  assert.notEqual(f.a.channel.name, foreign.channel.name);
});

test("only exact typed scope, session, finite position and fresh timestamp frames are admitted", () => {
  const f = pair(), original = structuredClone(f.a.peers()), frame = { ...f.frame(), sequence: f.frame().sequence + 1 };
  const invalid = [
    null, [], "presence", { ...frame, version: 2 }, { ...frame, kind: ["presence"] },
    { ...frame, kind: "cursor" }, { ...frame, userId: "account-b" },
    { ...frame, projectId: "project-b" }, { ...frame, canvasId: "board-b" },
    { ...frame, authorizationKey: "revoked" }, { ...frame, tabId: "tab-a" },
    { ...frame, tabId: "" }, { ...frame, tabId: "x".repeat(129) },
    { ...frame, connectionId: "<unsafe>" }, { ...frame, generation: 0 },
    { ...frame, sequence: 1.5 }, { ...frame, sentAt: f.now() - 6_000 },
    { ...frame, sentAt: f.now() + 1_001 }, { ...frame, sentAt: Infinity },
    { ...frame, x: NaN }, { ...frame, x: Infinity }, { ...frame, x: -1_000_001 },
    { ...frame, y: "60" }, { ...frame, y: 1_000_001 }, { ...frame, hasPosition: "yes" },
    { ...frame, selectedItemId: ["item-a"] }, { ...frame, selectedItemId: "item<script>" },
  ];
  for (const value of invalid) {
    f.inject(f.a.channel, value);
    assert.deepEqual(f.a.peers(), original);
  }
  f.inject(f.a.channel, { ...frame, sequence: frame.sequence + 1, x: -1_000_000, y: 1_000_000,
    name: "Administrator", color: "url(https://not-used.invalid)" });
  assert.equal(f.a.peers()[0].x, -1_000_000);
  assert.ok(!("name" in f.a.peers()[0]) && !("color" in f.a.peers()[0]) && !("userId" in f.a.peers()[0]));
});

test("replays and out-of-order frames cannot move peers or prolong their lifetime", () => {
  const f = pair(), first = structuredClone(f.frame());
  f.advance(1_000, false);
  f.b.hub.update({ x: 40, y: 70 }); f.flush();
  const newest = structuredClone(f.a.peers()[0]);
  f.inject(f.a.channel, first);
  f.inject(f.a.channel, { ...first, sentAt: f.now(), x: 999 });
  f.inject(f.a.channel, { ...f.frame(), sequence: f.frame().sequence + 1, sentAt: first.sentAt, x: 999 });
  assert.deepEqual(f.a.peers()[0], newest);
  f.advance(4_000, false);
  f.inject(f.a.channel, f.frame());
  assert.equal(f.a.peers()[0].expiresAt, newest.expiresAt);
});

test("a newer connection replaces its tab; old and unknown leaves cannot erase it", () => {
  const f = pair(), oldFrame = structuredClone(f.frame());
  f.b.hub.disconnect();
  const oldLeave = structuredClone(f.b.channel.posts.at(-1));
  f.b.hub.connect(scope, () => true);
  const newChannel = f.channels.at(-1);
  f.b.hub.update({ x: 100, y: 200 });
  const newFrame = structuredClone(newChannel.posts.at(-1));
  f.inject(f.a.channel, newFrame);
  const current = structuredClone(f.a.peers()[0]);
  for (const stale of [oldLeave, { ...oldFrame, sequence: 999 },
    { ...newFrame, kind: "leave", generation: newFrame.generation + 1 },
    { ...newFrame, kind: "leave", connectionId: "unknown", sequence: 999 }])
    f.inject(f.a.channel, stale);
  assert.deepEqual(f.a.peers()[0], current);
  f.flush();
  assert.deepEqual(f.a.peers()[0], current);
  f.b.hub.disconnect(); f.flush();
  assert.deepEqual(f.a.peers(), []);
  f.inject(f.a.channel, { ...newFrame, sequence: 999 });
  assert.deepEqual(f.a.peers(), [], "A closed connection stays closed for the replay window");
});

test("TTL removes silent peers and bounded tombstones reject late replay", () => {
  const f = browser();
  let active = true;
  const a = f.hub("tab-a"), b = f.hub("tab-b", scope, () => active);
  b.hub.update({ x: 1, y: 2 }); f.flush();
  const frame = structuredClone(b.channel.posts.at(-1));
  active = false;
  f.advance(6_000);
  assert.deepEqual(a.peers(), []);
  assert.equal(b.channel.closed, true);
  f.inject(a.channel, frame);
  assert.deepEqual(a.peers(), []);
  for (let index = 0; index < 100; index++)
    f.inject(a.channel, { ...frame, tabId: "many-" + index, connectionId: "conn-" + index, sentAt: f.now() });
  assert.ok(a.peers().length <= 64);
});

test("closed-channel callbacks and timers are fenced even after reconnect", () => {
  const f = pair(), oldChannel = f.a.channel, callback = oldChannel.onmessage;
  const timer = [...f.timers.values()][0], oldFrame = structuredClone(f.frame());
  const nextScope = { ...scope, canvasId: "board-next" };
  assert.equal(f.a.hub.connect(nextScope, () => true), true);
  const currentChannel = f.channels.at(-1), postCount = currentChannel.posts.length;
  callback({ data: { ...oldFrame, ...nextScope } }); timer();
  assert.deepEqual(f.a.peers(), []);
  assert.equal(currentChannel.posts.length, postCount);
  assert.equal(oldChannel.closed, true);
  assert.equal(oldChannel.onmessage, null);
  assert.equal(f.timers.size, 2);
});

test("current authority is checked before inbound, outbound and heartbeat activity", () => {
  for (const trigger of ["inbound", "outbound", "heartbeat"]) {
    const f = browser(); let active = true;
    const a = f.hub("tab-a", scope, () => active), b = f.hub("tab-b");
    b.hub.update({ x: 4, y: 5 }); f.flush();
    active = false;
    const count = a.channel.posts.length;
    if (trigger === "inbound") f.inject(a.channel, b.channel.posts.at(-1));
    if (trigger === "outbound") assert.equal(a.hub.update({ x: 9, y: 9 }), false);
    if (trigger === "heartbeat") f.advance(2_000);
    assert.equal(a.channel.closed, true);
    assert.deepEqual(a.peers(), []);
    assert.equal(a.channel.posts.length, count, "No frame is sent under a revoked local scope");
  }
});

test("invalid local patches, anonymous scopes and unavailable channels fail quietly", () => {
  const f = pair(), count = f.a.channel.posts.length;
  for (const patch of [null, {}, { x: 1 }, { x: 1, y: Infinity },
    { x: "1", y: 2 }, { selectedItemId: {} }, { name: "Guest" }])
    assert.equal(f.a.hub.update(patch), false);
  assert.equal(f.a.channel.posts.length, count);
  const invalid = new ProductionHub(f.runtime("tab-invalid")), opened = f.channels.length;
  for (const wanted of [{ ...scope, userId: "anonymous" }, { ...scope, userId: "" },
    { ...scope, authorizationKey: "" }, { ...scope, canvasId: "" }])
    assert.equal(invalid.connect(wanted, () => true), false);
  assert.equal(f.channels.length, opened);
  const unavailable = new ProductionHub({ ...f.runtime("tab-off"), channel: () => { throw new Error("unavailable"); } });
  assert.equal(unavailable.connect(scope, () => true), false);
  const failedPost = new ProductionHub({ ...f.runtime("tab-fail"), channel: () => ({
    onmessage: null, postMessage() { throw new Error("closed"); }, close() {},
  }) });
  assert.equal(failedPost.connect(scope, () => true), false);
  assert.equal(f.timers.size, 2);
});

const hostSource = readFileSync(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8");
function between(start, end) {
  const a = hostSource.indexOf(start), b = hostSource.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Production presence method boundary changed: " + start);
  return hostSource.slice(a, b);
}
// Keep the complete production lifecycle slices, including Phase4 controls and
// Phase7 arrangement/Undo calls. The actual arrangement controller stays idle;
// its external ports fail on unexpected work. Full-component controller/recovery
// coverage remains in canvas-calm-controls-host and the arrangement suites.
const hostSyntax=ts.createSourceFile("canvas-application.ts",hostSource,ts.ScriptTarget.Latest,true);
const hostClass=hostSyntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="CanvasApplication");
const popoverCleanup=hostClass?.members.find(node=>node.name?.getText(hostSyntax)==="#closePopovers");
assert.ok(popoverCleanup,"the actual native cleanup method must be included, not replaced by a stub");
const productionMethods = [
  popoverCleanup.getText(hostSyntax),
  ...["#queueOwner", "#captureQueueOwner", "#queueScope"].map(name => {
    const member = hostClass?.members.find(node => node.name?.getText(hostSyntax) === name);
    assert.ok(member, "the actual Canvas source dependency must be included: " + name);
    return member.getText(hostSyntax);
  }),
  between("  override disconnectedCallback(){", "  protected override updated(){"),
  between("  protected override updated(){", "  #currentPresenceScope()"),
  between("  #currentPresenceScope()", "  #go(path:string)"),
  between("  #nearbyPresence()", "  #orderedItems("),
  between("  #canEditCanvas()", "  #trackCanvasInteraction("),
  between("  #arrangementScope()", "  #deskCurrent()"),
].join("\n").replaceAll("#", "_");

function hostFixture() {
  const local = browser(), trace = [], state = {
    session: { user: { userId: "account-a", role: "creator" }, impersonation: null,
      policy: { accepted: true, version: "policy-1" }, canvas: { access: true, version: "canvas-1" },
      capabilities: ["project.read", "project.author"], permissionEpoch: "permission-1" },
    canvas: { projectId: "project-a", selectedCanvasId: "board-a",
      canvases: [{ id: "board-a", projectId: "project-a", removed: false }], items: [] },
    authorizationActive: true, undoRequest: null, events: [], optimisticEvents: [], popovers: [],
  };
  const key = () => state.session ? [state.session.user.userId, state.session.permissionEpoch].join("\u0000") : "";
  const store = new Proxy({
    session: { get: () => state.session }, canvasProjection: { get: () => state.canvas },
    route: { get: () => "/canvas/board-a" }, setCanvasPlanningSelection() {},
    events: { get: () => state.events }, optimisticEvents: { get: () => state.optimisticEvents },
    asOf: { get: () => Infinity },
    canvasArrangementUndoRequest: { get: () => state.undoRequest, set: value => { state.undoRequest = value; } },
    captureAuthorizationScope: () => state.session ? { key: key(), shared: Boolean(state.session.projectContext) } : null,
    authorizationScopeActive: captured => state.authorizationActive && captured?.key === key(),
  }, { get(target, field) { assert.ok(field in target, "Canvas lifecycle accessed an unexpected store operation: " + String(field)); return target[field]; } });
  canvasLegacySourceOwnership(store);
  const Date = class extends globalThis.Date { static now() { return local.now(); } };
  const document = { documentElement: { toggleAttribute() {}, removeAttribute() {} } };
  const window = { innerWidth: 1_200, innerHeight: 800, removeEventListener() {}, clearInterval() {}, clearTimeout() {} };
  const RENDER_OVERSCAN_PX = 200, ResizeObserver = undefined;
  const canvasFocusFromRoute = () => true, ensureModalDialog = () => assert.fail("Unrelated dialog");
  const requestAnimationFrame = () => assert.fail("Unexpected viewport restore");
  const html = (strings, ...values) => strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  class CanvasPresenceHub extends ProductionHub { constructor() { super(local.runtime("host-tab")); } }
  const unexpectedArrangementPort = name => () => assert.fail("Unexpected arrangement port in idle presence fixture: " + name);
  class PresenceArrangementController extends OutcomeArrangementController {
    constructor(host) {
      super({
        scope: () => host._arrangementScope(), stamp: () => host._arrangementStamp(),
        context: unexpectedArrangementPort("context"), post: unexpectedArrangementPort("post"),
        remember: unexpectedArrangementPort("remember"), refresh: unexpectedArrangementPort("refresh"),
        operationId: unexpectedArrangementPort("operationId"), recoveryIdentity: unexpectedArrangementPort("recoveryIdentity"),
        captureRecoveryOwnership: unexpectedArrangementPort("captureRecoveryOwnership"),
        captureRefusalOwnership: unexpectedArrangementPort("captureRefusalOwnership"),
        changed: () => host.requestUpdate(), now: () => local.now(),
      });
    }
    revalidate() {
      trace.push("arrangement:revalidate");
      return super.revalidate();
    }
  }
  class Base { disconnectedCallback() { trace.push("super:disconnect"); } }
  const navigator = { onLine: true };
  const suspendContextControls = () => assert.fail("No controls are mounted in the focused fixture");
  const ports = { store, state, Date, document, window, navigator, RENDER_OVERSCAN_PX, ResizeObserver, canvasFocusFromRoute,
    canvasViewFromRoute, outcomeDeskRouteState, suspendContextControls,
    ensureModalDialog, requestAnimationFrame, html, CanvasPresenceHub, PresenceArrangementController, Base, trace };
  const Probe = Function(...Object.keys(ports), "return " + stripTypeScriptTypes("(class extends Base {\n" +
    "isConnected=true; store=store; i18n={t:(_key,fallback)=>fallback}; _presence=[]; _presenceKey=''; _presenceHub; _presenceUnsubscribe;\n" +
    "_selected=new Set(['existing-selection']); _interactionCanvas='board-a'; _viewportCanvas='board-a'; _viewportElement=null; _viewportObserver;\n" +
    "_touchPointers=new Map(); _suppressedPointers=new Set(); _zoom=1; _cameraX=0; _cameraY=0;\n" +
    "_offline={count:0}; _arrangementOpening=0; _arrangementCheckedStamp=''; _arrangementUndoRequest;\n" +
    "_arrangement=new PresenceArrangementController(this);\n" +
    "_proposalReview={synchronize(){trace.push('proposal:synchronize');},suspend(){trace.push('proposal:suspend');}};\n" +
    "_controlsScope=''; _selectionKey=''; _selectionContexts=new Set(); _selectedSourceIds=new Set(); _deskDismissed=new Set();\n" +
    "_reviewArrangementUndo(operationId){trace.push('arrangement:undo:'+operationId);}\n" +
    "_closeArrangement(){trace.push('arrangement:close');} _closeDocumentOutputs(){trace.push('outputs:close');}\n" +
    "requestUpdate(){trace.push('render-request');} removeEventListener(){} querySelectorAll(selector){return selector==='forma-ui-popover'?state.popovers:[];} querySelector(){return null;}\n" +
    "_persistViewport(){} _restoreViewport(){return true;} _bindTouchViewport(){} _trackCanvasInteraction(){} _scheduleViewportPersistence(){}\n" +
    productionMethods + "\n})"))(...Object.values(ports));
  const host = new Probe();
  function meet() {
    host.willUpdate(); host.updated();
    const remote = local.hub("other-tab", host._currentPresenceScope().scope);
    remote.hub.update({ x: 10, y: 20, selectedItemId: "different-selection" }); local.flush();
    assert.equal(host._presence.length, 1);
    return remote;
  }
  return { ...local, host, state, trace, meet, Date };
}

test("production updated resets the same board on actor, project and permission changes", () => {
  for (const change of [
    f => { f.state.canvas.selectedCanvasId = "board-b"; f.state.canvas.canvases[0].id = "board-b"; },
    f => { f.state.session.user.userId = "account-b"; },
    f => { f.state.canvas.projectId = "project-b"; f.state.canvas.canvases[0].projectId = "project-b"; },
    f => { f.state.session.permissionEpoch = "permission-2"; },
    f => { f.state.session.capabilities = ["project.read"]; },
    f => { f.state.session.user.role = "viewer"; },
    f => { f.state.session.policy.version = "policy-2"; },
    f => { f.state.session.canvas.version = "canvas-2"; },
  ]) {
    const f = hostFixture(); f.meet();
    const old = f.channels[0], previousKey = f.host._presenceKey;
    change(f);
    assert.deepEqual(f.host._nearbyPresence(), [], "Stale peers are hidden before updated");
    f.host.updated();
    assert.equal(old.closed, true);
    assert.notEqual(f.host._presenceKey, previousKey);
    assert.deepEqual(f.host._presence, []);
    assert.ok(f.host._presenceHub);
    assert.deepEqual([...f.host._selected], ["existing-selection"], "Inbound selection is not an action");
  }
});

test("production host clears removed boards, sign-out, anonymous and revoked access", () => {
  for (const change of [
    f => { f.state.canvas.canvases[0].removed = true; },
    f => { f.state.canvas.selectedCanvasId = ""; },
    f => { f.state.session = null; },
    f => { f.state.session.user.userId = "anonymous"; },
    f => { f.state.session.canvas.access = false; },
    f => { f.state.session.policy.accepted = false; },
    f => { f.state.session.capabilities = []; },
    f => { f.state.session.permissionEpoch = ""; },
    f => { f.state.authorizationActive = false; },
    f => { f.state.session.impersonation = { active: true }; },
  ]) {
    const f = hostFixture(); f.meet(); const channel = f.channels[0];
    change(f); f.host.updated();
    assert.equal(channel.closed, true);
    assert.deepEqual(f.host._presence, []);
    assert.equal(f.host._presenceHub, undefined);
    assert.equal(f.host._presenceKey, "");
  }
});

test("production host reattaches on the same board and ignores a late old callback", () => {
  const f = hostFixture(), remote = f.meet(), old = f.channels[0], callback = old.onmessage;
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.deepEqual(f.host._presence, []);
  assert.equal(f.host._presenceKey, "");
  assert.equal(old.closed, true);
  f.host.isConnected = true; f.host.updated();
  const current = f.host._presenceHub, channel = f.channels.at(-1);
  callback({ data: { ...remote.channel.posts.at(-1), sequence: 999 } });
  assert.deepEqual(f.host._presence, []);
  assert.equal(f.host._presenceHub, current);
  assert.notEqual(channel, old);
  assert.ok(f.trace.includes("super:disconnect"));
});

test("shared expiry, membership and exact project guard stay current between renders", () => {
  const f = hostFixture();
  f.state.session.projectContext = { organizationId: "org-a", projectAccessId: "access-a",
    projectId: "project-a", ownerUserId: "owner-a", role: "viewer",
    permissions: ["project.read", "project.canvas.use"], expiresAt: new f.Date(f.now() + 10_000).toISOString() };
  const remote = f.meet(), firstScope = f.host._currentPresenceScope().scope, old = f.channels[0];
  f.state.session.projectContext.expiresAt = new f.Date(f.now() + 20_000).toISOString();
  assert.equal(f.host._currentPresenceScope().scope.authorizationKey, firstScope.authorizationKey,
    "Different session expiries do not prevent same-grant tabs meeting");
  f.host.updated(); assert.equal(old.closed, true);
  const channel = f.channels.at(-1);
  f.inject(channel, { ...remote.channel.posts.at(-1), sequence: 999 });
  assert.equal(f.host._presence.length, 1);
  f.state.session.projectContext.permissions = ["project.read"];
  f.inject(channel, remote.channel.posts.at(-1));
  assert.equal(channel.closed, true);
  assert.deepEqual(f.host._presence, []);
  assert.equal(f.host._presenceHub, undefined);
  f.state.session.projectContext.permissions = ["project.read", "project.canvas.use"];
  f.state.session.projectContext.projectId = "project-wrong";
  f.host.updated(); assert.equal(f.host._presenceHub, undefined);
  f.state.session.projectContext.projectId = "project-a";
  f.host.updated();
  f.advance(20_000);
  assert.equal(f.host._presenceHub, undefined);
  assert.deepEqual(f.host._nearbyPresence(), []);
});

test("production badge is position-only, locally labelled and never a live announcement", () => {
  const f = hostFixture(); const remote = f.meet();
  f.inject(f.channels[0], { ...remote.channel.posts.at(-1), sequence: 999,
    name: "Someone else", color: "red; background:url(https://not-used.invalid)" });
  const markup = f.host._renderPresence().join("");
  assert.match(markup, /forma-ui-badge tone="neutral"/);
  assert.match(markup, /Your other tab · this browser/);
  assert.match(markup, /Last board position/);
  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label=/);
  assert.doesNotMatch(markup, /Someone else|not-used|aria-live|role="status"|--presence|scale\(/);
  f.host._presence[0].hasPosition = false;
  assert.deepEqual(f.host._renderPresence(), []);
  f.host._presence[0].hasPosition = true;
  f.host._presence[0].expiresAt = f.now();
  assert.deepEqual(f.host._renderPresence(), []);
});

test("all four actual catalogs provide the local-tab label and accessible explanation", async () => {
  const previousElement = globalThis.HTMLElement, previousRegistry = globalThis.customElements;
  globalThis.HTMLElement ??= class {};
  globalThis.customElements ??= { get: () => true, define() {} };
  try {
    const { FORMA_DEFAULT_MESSAGES } = await import("../src/components/design-system/localization.ts");
    const catalogs = [FORMA_DEFAULT_MESSAGES];
    for (const locale of ["fr", "ar", "ja"])
      catalogs.push((await import("../src/components/design-system/locales/" + locale + ".ts")).default);
    const labels = new Set(), descriptions = new Set();
    for (const messages of catalogs) {
      assert.ok(messages["canvas.presence.otherTab"]?.trim());
      assert.ok(messages["canvas.presence.localOnly"]?.trim());
      labels.add(messages["canvas.presence.otherTab"]); descriptions.add(messages["canvas.presence.localOnly"]);
      const f = hostFixture(); f.host.i18n.t = (key, fallback) => messages[key] ?? fallback; f.meet();
      const markup = f.host._renderPresence().join("");
      assert.ok(markup.includes(messages["canvas.presence.otherTab"]));
      assert.ok(markup.includes(messages["canvas.presence.localOnly"]));
    }
    assert.equal(labels.size, 4); assert.equal(descriptions.size, 4);
  } finally {
    if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement;
    if (previousRegistry === undefined) delete globalThis.customElements; else globalThis.customElements = previousRegistry;
  }
});


test("the composed lifecycle keeps real controls, arrangement validation and exact Undo consumption", () => {
  const f = hostFixture();
  f.meet();
  assert.ok(f.host._controlsScope);
  assert.equal(f.trace.filter(value => value === "arrangement:revalidate").length, 1);
  f.host.updated();
  assert.equal(f.trace.filter(value => value === "arrangement:revalidate").length, 1, "unchanged validation stamp stays quiet");
  f.state.events.push({ eventId: "source-changed" }); f.host.updated();
  assert.equal(f.trace.filter(value => value === "arrangement:revalidate").length, 2);
  const identity = { authorityKey: f.host.store.captureAuthorizationScope().key,
    canvasId: "board-a", projectId: "project-a", operationId: "original-undo" };
  f.state.undoRequest = identity; f.host.updated(); f.host.updated();
  assert.equal(f.state.undoRequest, null);
  assert.equal(f.trace.filter(value => value === "arrangement:undo:original-undo").length, 1);
  f.state.undoRequest = { ...identity, authorityKey: "different-account", operationId: "wrong-undo" };
  f.host.updated();
  assert.equal(f.state.undoRequest, null);
  assert.ok(!f.trace.includes("arrangement:undo:wrong-undo"));
  assert.deepEqual([...f.host._selected], ["existing-selection"]);
  assert.equal(f.host._presence.length, 1);
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.host._presence.length, 0);
  assert.ok(f.trace.includes("super:disconnect"));
});


test("actual focused callbacks retain adaptive synchronization and suspension alongside presence", () => {
  const f = hostFixture();
  f.host.updated(); f.host.updated();
  assert.equal(f.trace.filter(value => value === "proposal:synchronize").length, 2);
  f.state.session = null; f.host.updated();
  assert.equal(f.trace.filter(value => value === "proposal:synchronize").length, 3);
  assert.equal(f.host._presenceHub, undefined);
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.trace.filter(value => value === "proposal:suspend").length, 1);
  assert.ok(f.trace.indexOf("proposal:suspend") < f.trace.indexOf("super:disconnect"));
});
test("presence stays outside canonical board synchronization and persistence", () => {
  const source = readFileSync(new URL("../src/canvas/presence.ts", import.meta.url), "utf8");
  assert.match(source, /BroadcastChannel is not authenticated collaboration/);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|\.hot\(|append/);
  assert.match(hostSource, /setInterval\(\(\)=>void this\.#refreshSharedStream\(\),1_500\)/);
  assert.match(hostSource, /#refreshSharedStream\(\)/);
  assert.ok(!hostSource.includes("peer.name") && !hostSource.includes("peer.color"));
});

test("actual lifecycle cleanup invokes owned native-popover ports while retaining presence and review boundaries",()=>{
  const f=hostFixture();let closed=0;f.state.popovers.push({close(){closed++;}});
  f.host.willUpdate();f.host.updated();assert.equal(closed,1);
  f.state.session.permissionEpoch="permission-new";f.host.willUpdate();f.host.updated();assert.equal(closed,2);
  f.host.disconnectedCallback();assert.equal(closed,3);
  assert.equal(f.trace.filter(value=>value==="proposal:synchronize").length,2);
  assert.equal(f.trace.filter(value=>value==="proposal:suspend").length,1);
  assert.equal(f.host._presenceHub,undefined);assert.deepEqual(f.state.events,[]);
});
