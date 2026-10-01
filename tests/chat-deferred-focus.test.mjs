// Actual Shell/Chat/ChoiceCard/ConversationComposer and existing RAM Store.
// The countercontrol is a same-turn newer native interaction before the finite
// update microtask; no promise is held or replaced. It is an ownership contract,
// not evidence that a later physical user task interleaves with ordinary Lit.
import assert from "node:assert/strict";
import test from "node:test";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { blockTypeDefinition } from "../src/model/block-types.ts";

const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
async function chatPage(t) {
  const external = t.mock.method(globalThis, "fetch", async () => assert.fail("No external or provider request in local Chat focus controls"));
  const f = await createCalmFullPage(t), h = f.storeHost;
  // Same finite History/Location port as navigationPage and mountedFallback.
  // Only the actual Store's push/replace calls publish a subsequent URL here;
  // this does not set its route, bypass its origin guard, or grant authority.
  const previousHistory = globalThis.history, historyCalls = [];
  const updateLocation = route => {
    const url = new URL(route, h.location.origin);
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  };
  updateLocation(f.store.route.get()); f.nativeHistoryLocation = h.location;
  globalThis.history = {
    pushState(_state, _title, route) { historyCalls.push({ method: "pushState", route }); updateLocation(route); },
    replaceState(_state, _title, route) { historyCalls.push({ method: "replaceState", route }); updateLocation(route); },
  };
  t.after(() => { globalThis.history = previousHistory; });
  await registerCalmFullPageComponents(f, ["forma-chat-studio"]);
  const native = installOutputNavigationFocusNative(t, f, ports), projection = f.store.projection.get();
  const href = withDocumentInRoute("/studio/chat", projection.documentId, projection.documentTitle);
  const navigators = f.components().filter(owner => owner.tag === "forma-studio-mode-nav" && owner.isConnected);
  assert.equal(navigators.length, 1); const navigator = navigators[0];
  const menus = f.components().filter(owner => owner.tag === "forma-ui-popover" && owner.parentElement === navigator
    && owner.isConnected && classed(owner, "studio-view-menu"));
  assert.equal(menus.length, 1); const menu = menus[0];
  const trigger = f.find("button", node => node.owner === menu && classed(node, "ui-popover-trigger"));
  const panel = menu.querySelector(".ui-popover-panel");
  assert.ok(panel?.isConnected); assert.equal(panel.owner, menu);
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  assert.equal(trigger.port.matches(":disabled"), false); assert.equal(panel.matches(":popover-open"), false);
  native.emit("pointerdown", trigger.port); native.focus(trigger.port);
  // Existing native port executes the real click handler and popovertarget default.
  // f.act alone deliberately does not implement that browser default action.
  trigger.port.click(); await f.settle();
  assert.equal(menu.querySelector(".ui-popover-panel")?.matches(":popover-open"), true);
  const link = f.find("a", node => node.owner === menu && node.attributes["data-studio-view"] === "chat"
    && node.attributes.href === href);
  assert.equal(menu.contains(link.port), true); assert.equal(link.port.closest("forma-ui-popover"), menu);
  // Observe only this actual link's original public navigation call. Preserve
  // its exact return Promise, scheduler, owner checks, and all focus assertions.
  const routeBefore = f.store.route.get(), navigationCalls = [], navigateFrom = f.host.navigateFrom;
  const navigationObserver = t.mock.method(f.host, "navigateFrom", function (...args) {
    const call = { origin: args[0]?.tag, exactOwner: args[0] === navigator, sameHost: this === f.host, settled: false };
    navigationCalls.push(call);
    const pending = Reflect.apply(navigateFrom, this, args);
    void Promise.resolve(pending).then(value => { call.settled = true; call.result = value; },
      error => { call.settled = true; call.error = String(error?.message ?? error); });
    return pending;
  });
  native.emit("pointerdown", link.port); native.focus(link.port); await f.act(link, "click", { button: 0 });
  await f.settle();
  const owners = f.components().filter(owner => owner.tag === "forma-chat-studio" && owner.isConnected);
  navigationObserver.mock.restore();
  t.diagnostic("C_CHAT_MOUNT_PREREQUISITE " + JSON.stringify({ routeBefore, requested: href,
    routeAfter: f.store.route.get(), routeReady: f.store.routeDataReady(), sourceCurrent: f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),
    registered: typeof f.renderer.registry["forma-chat-studio"], navigationCalls, connectedChatOwners: owners.length,
    connectedOwners: f.components().map(owner => owner.tag), commandOpen: f.store.ui.commandOpen,
    currentToast: f.store.ui.toast, componentFrames: f.frames.size,
    storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length }));
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner instanceof f.renderer.registry["forma-chat-studio"]); assert.equal(owner.store, f.store);
  assert.equal(f.store.route.get(), href);
  assert.ok(historyCalls.some(call => call.route === href), "The actual Store committed this URL through native History");
  assert.equal(h.location.pathname + h.location.search + h.location.hash, href);
  const field = () => f.find("textarea", node => node.attributes.id === "creative-chat-message"
    && node.owner.tag === "forma-ui-conversation-composer" && node.owner.parentElement === owner);
  const toggle = () => f.find("button", node => node.owner === owner && classed(node, "chat-result-toggle"));
  assert.equal(field().port.matches(":disabled"), false); assert.equal(field().port.value, "");
  return { f, h, owner, native, external, field, toggle };
}

for (const action of ["prepare", "close-result"]) for (const newer of [false, true])
  test("C Chat deferred " + action + " / " + (newer ? "same-turn newer native interaction wins" : "healthy current focus"),
    { concurrency: false, timeout: 45_000 }, async t => {
      const x = await chatPage(t), { f, h, owner, native } = x;
      let control;
      if (action === "prepare") {
        control = f.find("button", node => node.owner.tag === "forma-ui-choice-card" && node.owner.parentElement === owner
          && node.attributes["data-choice-value"] === "direction");
        assert.equal(control.port.matches(":disabled"), false);
      } else {
        const show = x.toggle(); native.emit("pointerdown", show.port); native.focus(show.port); await f.act(show);
        assert.equal(x.toggle().attributes["aria-expanded"], true);
        control = f.find("button", node => node.owner === owner && classed(node, "chat-result-close"));
      }
      const baseline = { events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
        route: f.store.route.get(), session: f.store.session.get(), source: f.store.captureSourceOwnership(),
        authority: f.store.captureAuthorizationScope(), requests: h.requests.length, financial: financial(h.worker) };
      assert.ok(control.port.isConnected); native.emit("pointerdown", control.port); native.focus(control.port);
      const pending = f.act(control);
      const later = action === "prepare" ? x.toggle() : x.field();
      assert.ok(later.port.isConnected); assert.equal(later.port.matches(":disabled"), false);
      if (newer) { native.emit("pointerdown", later.port); native.focus(later.port); }
      const mark = native.nativeFocus.length; await pending; await f.settle();
      const late = native.nativeFocus.slice(mark).filter(row => row.node.owner === owner || row.node.owner.parentElement === owner);
      t.diagnostic(JSON.stringify({ action, newer, lateFocus: late.map(row => ({ tag: row.node.tag,
        id: row.node.attributes.id ?? null, class: row.node.attributes.class ?? null })),
        boundary: "actual native listener; same-turn intervention; unchanged finite update scheduler" }));
      if (newer) assert.equal(late.length, 0, "old deferred presentation cannot overwrite newer native focus");
      else {
        assert.equal(late.length, 1);
        if (action === "prepare") assert.equal(late[0].node.attributes.id, "creative-chat-message");
        else assert.ok(classed(late[0].node, "chat-result-toggle"));
      }
      assert.equal(x.field().port.value, action === "prepare" ? f.i18n.system(blockTypeDefinition("direction").prompt) : "");
      if (action === "close-result") assert.equal(x.toggle().attributes["aria-expanded"], false);
      assert.equal(owner.isConnected, true); assert.equal(owner.store, f.store);
      assert.equal(f.store.route.get(), baseline.route); assert.equal(f.store.session.get(), baseline.session);
      assert.ok(f.store.sourceOwnershipActive(baseline.source)); assert.ok(f.store.authorizationScopeActive(baseline.authority));
      assert.equal(f.store.events.get(), baseline.events); assert.equal(f.store.content.get(), baseline.content); assert.equal(f.store.head.get(), baseline.head);
      assert.equal(h.requests.length, baseline.requests); assert.deepEqual(financial(h.worker), baseline.financial);
      assert.equal(x.external.mock.callCount(), 0);
    });
