// Complete current PlatformShell/WorkspaceSwitcher and the existing actual RAM
// Product session. Only native toggle EVENT DELIVERY is queued here. No route,
// permission, callback result or application updateComplete is replaced.
// This is finite native ordering evidence, not browser/AT/task-priority proof.
import assert from "node:assert/strict";
import test from "node:test";
import { platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
function one(f, owner, tag, predicate) {
  const nodes = f.renderer.nodes.filter(node => node.owner === owner && node.tag === tag && predicate(node));
  assert.equal(nodes.length, 1, "one exact currently emitted " + tag); return nodes[0];
}
function controls(f) {
  const owners = [...f.renderer.instances.values()].map(record => record.instance)
    .filter(owner => owner.isConnected && owner.tag === "forma-ui-workspace-switcher");
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner.destinations.filter(row => !row.disabled).length >= 3,
    "the unchanged actual RAM session, not a supplied destination DTO, exposes popover mode");
  const trigger = one(f, owner, "button", node => classed(node, "ui-workspace-switcher-trigger"));
  const panel = one(f, owner, "nav", node => classed(node, "ui-workspace-switcher-panel"));
  const current = one(f, owner, "a", node => node.attributes["aria-current"] === "page");
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  assert.equal(trigger.attributes["aria-controls"], panel.attributes.id);
  assert.equal(panel.attributes.popover, "auto");
  assert.ok(trigger.attributes["aria-label"] && panel.attributes["aria-label"]);
  assert.ok(trigger.isConnected && panel.isConnected && current.isConnected);
  return { owner, trigger, panel, current };
}

function queuedToggle(panel) {
  const original = { show: panel.showPopover, hide: panel.hidePopover, toggle: panel.handlers.toggle };
  assert.equal(typeof original.toggle, "function");
  let queued = null, delivered = 0;
  // The existing native methods own :popover-open. Coalescing retains the
  // earliest old state and latest new state for this exact native panel.
  panel.handlers.toggle = event => {
    queued = { oldState: queued?.oldState ?? (event.newState === "open" ? "closed" : "open"), newState: event.newState };
  };
  const change = (open, nativeMethod) => {
    const oldState = panel.matches(":popover-open") ? "open" : "closed", newState = open ? "open" : "closed";
    if (oldState === newState) return;
    const event = { type: "beforetoggle", target: panel, currentTarget: panel, oldState, newState,
      cancelable: open, defaultPrevented: false,
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, stopPropagation() {} };
    panel.handlers.beforetoggle?.call(panel.owner, event);
    if (!event.defaultPrevented) nativeMethod.call(panel);
  };
  panel.showPopover = () => change(true, original.show);
  panel.hidePopover = () => change(false, original.hide);
  return {
    get pending() { return queued !== null; }, get delivered() { return delivered; },
    deliver() {
      assert.ok(queued, "a genuine native state change queued its notification");
      const event = { type: "toggle", target: panel, currentTarget: panel, ...queued };
      queued = null; delivered++;
      original.toggle.call(panel.owner, event);
    },
  };
}

function unchanged(f, baseline) {
  assert.equal(f.platformSession.get(), baseline.session);
  assert.equal(f.nativeHistoryLocation.href, baseline.href);
  assert.equal(f.store.route.get(), baseline.route);
  assert.deepEqual(f.calls, baseline.calls, "no session, report, mutation or navigation request");
  assert.deepEqual(f.financial(), baseline.financial);
  assert.deepEqual(f.decisions(), baseline.decisions);
  assert.deepEqual(f.creationEvents(), baseline.events);
  assert.equal(f.formResets, baseline.resets);
  assert.deepEqual(f.external, []);
}

for (const phase of ["open", "close"]) for (const newer of [false, true])
  test("C switcher queued " + phase + " / " + (newer ? "newer current language focus wins" : "healthy native focus"),
    { concurrency: false, timeout: 45_000 }, async t => {
      const f = await platformDeliveryFixture(t), native = installOutputNavigationFocusNative(t, f, ports);
      await f.settle();
      const baseline = { session: f.platformSession.get(), href: f.nativeHistoryLocation.href, route: f.store.route.get(),
        calls: structuredClone(f.calls), financial: f.financial(), decisions: f.decisions(), events: f.creationEvents(), resets: f.formResets };
      let current = controls(f), queue = queuedToggle(current.panel);
      native.emit("pointerdown", current.trigger); native.focus(current.trigger);
      current.trigger.click();
      assert.ok(queue.pending); assert.equal(queue.delivered, 0);
      assert.equal(current.panel.matches(":popover-open"), true);
      if (phase === "close") {
        queue.deliver(); assert.equal(native.nativeFocus.at(-1)?.node, current.current);
        await f.flush(); current = controls(f); queue = queuedToggle(current.panel);
        assert.equal(current.panel.matches(":popover-open"), true);
        native.focus(current.current); native.emit("keydown", current.current);
        let prevented = false;
        assert.equal(typeof current.panel.handlers.keydown, "function");
        current.panel.handlers.keydown.call(current.owner, { type: "keydown", key: "Escape", target: current.current,
          currentTarget: current.panel, preventDefault() { prevented = true; }, stopPropagation() {} });
        assert.equal(prevented, false, "the actual handler leaves native Escape dismissal intact");
        current.panel.hidePopover();
        assert.equal(current.panel.matches(":popover-open"), false); assert.ok(queue.pending);
      }
      const language = f.renderer.nodes.filter(node => node.owner.tag === "forma-ui-language-picker" && node.tag === "select");
      assert.equal(language.length, 1); assert.ok(language[0].isConnected);
      assert.equal(language[0].matches(":disabled"), false);
      if (newer) { native.emit("pointerdown", language[0]); native.focus(language[0]); }
      const before = native.nativeFocus.length;
      queue.deliver();
      const calls = native.nativeFocus.slice(before);
      t.diagnostic(JSON.stringify({ phase, newer, nativeState: current.panel.matches(":popover-open"),
        focused: calls.map(row => ({ tag: row.node.tag, owner: row.node.owner.tag,
          href: row.node.attributes.href ?? null, class: row.node.attributes.class ?? null })),
        queuedEvents: queue.delivered, mutations: f.calls.filter(call => call.method !== "GET").length,
        boundary: "actual state change and original native toggle listener; finite queued delivery" }));
      if (newer) {
        assert.equal(calls.length, 0, "queued notification cannot take focus from a newer current native field");
        assert.equal(native.document.activeElement, language[0]);
      } else {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].node, phase === "open" ? current.current : current.trigger);
        assert.ok(calls[0].node.isConnected && f.renderer.nodes.includes(calls[0].node));
      }
      assert.equal(queue.pending, false); unchanged(f, baseline);
      await f.flush();
      const settled = controls(f);
      assert.equal(settled.trigger.attributes["aria-expanded"], String(phase === "open"));
      assert.equal(settled.panel.matches(":popover-open"), phase === "open");
      unchanged(f, baseline);
    });

test("C switcher actual current workspace destination / queued close cannot undo its main focus",
  { concurrency: false, timeout: 45_000 }, async t => {
    const f = await platformDeliveryFixture(t), native = installOutputNavigationFocusNative(t, f, ports);
    await f.settle(); let current = controls(f), queue = queuedToggle(current.panel);
    native.emit("pointerdown", current.trigger); native.focus(current.trigger); current.trigger.click(); queue.deliver();
    await f.flush(); current = controls(f); queue = queuedToggle(current.panel);
    assert.equal(current.panel.matches(":popover-open"), true);
    assert.equal(current.current.attributes.href, "/product/insights", "actual authorized workspace home uses the existing real report fixture");
    const baseline = { session: f.platformSession.get(), route: f.store.route.get(), financial: f.financial(),
      decisions: f.decisions(), events: f.creationEvents(), calls: f.calls.length, resets: f.formResets };
    native.emit("pointerdown", current.current); native.focus(current.current);
    const mark = native.nativeFocus.length;
    current.current.click();
    assert.ok(queue.pending); assert.equal(current.panel.matches(":popover-open"), false);
    await f.settle();
    assert.equal(f.nativeHistoryLocation.pathname, "/product/insights");
    assert.equal(f.platformSession.get(), baseline.session);
    const destination = f.renderer.component("forma-product-insights"); assert.ok(destination?.isConnected);
    const mainCalls = native.nativeFocus.slice(mark).filter(row => row.node.owner === f.host && row.node.attributes.id === "main-content");
    assert.equal(mainCalls.length, 1, "the actual existing Platform load focuses its completed destination");
    const deliveredAfter = native.nativeFocus.length; queue.deliver();
    const late = native.nativeFocus.slice(deliveredAfter);
    t.diagnostic(JSON.stringify({ destination: f.nativeHistoryLocation.pathname, mainCalls: mainCalls.length,
      lateFocus: late.map(row => ({ tag: row.node.tag, owner: row.node.owner.tag, class: row.node.attributes.class ?? null })),
      nativeCloseDelivered: queue.delivered, boundary: "actual link -> parent navigation/load -> exact queued close listener" }));
    assert.equal(late.length, 0, "old switcher close cannot replace the current destination's main focus");
    assert.equal(f.store.route.get(), baseline.route, "Platform navigation does not mutate the unrelated Creator Store route");
    assert.deepEqual(f.calls.slice(baseline.calls).map(row => [row.method, row.url]), [["GET", "/api/portfolio/product/insights"]]);
    assert.deepEqual(f.financial(), baseline.financial); assert.deepEqual(f.decisions(), baseline.decisions);
    assert.deepEqual(f.creationEvents(), baseline.events); assert.equal(f.formResets, baseline.resets); assert.equal(f.external.length, 0);
  });
