// Complete actual Creator Shell/Workspace/Projects with the existing real
// Store/RAM Worker and explicitly synthetic lifecycle projection. Native
// notification ordering only; no held/replaced updateComplete, fake navigation,
// private setter, provider, paid turn, or physical task-priority certificate.
import assert from "node:assert/strict";
import test from "node:test";
import { lifecyclePage, ports } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { financial, readWorkspaceEvents } from "./helpers/event-source-retirement-fixture.mjs";

const options = { concurrency: false, timeout: 45_000 };
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])";
const inside = (row, parent) => { for (let at = row.parent; at; at = at.parent) if (at === parent) return true; return false; };

function one(f, tag, predicate) {
  const rows = f.tree().nodes.filter(row => row.tag === tag && predicate(row));
  assert.equal(rows.length, 1, "one actual current " + tag); assert.ok(rows[0].port?.isConnected);
  return rows[0];
}
function command(f) {
  const row = one(f, "button", row => row.owner === f.host && classed(row, "command-trigger"));
  assert.equal(row.hiddenBy, null); assert.equal(row.port.matches(":disabled"), false);
  assert.equal(row.attributes["aria-expanded"], "false", "focus alone does not invoke the palette");
  return row.port;
}
function account(f) {
  const tree = f.tree(), panels = tree.nodes.filter(row => row.owner === f.host && row.attributes.id === "account-popover");
  const triggers = tree.visible("button").filter(row => row.owner === f.host && row.attributes.popovertarget === "account-popover");
  assert.equal(panels.length, 1); assert.equal(triggers.length, 1);
  const panel = panels[0].port, trigger = triggers[0].port;
  assert.ok(panel?.isConnected && trigger?.isConnected);
  assert.equal(panel.attributes.popover, "auto"); assert.equal(trigger.attributes["aria-controls"], panel.attributes.id);
  return { panel, trigger };
}
function pressFocus(f, target) {
  assert.ok(target.isConnected && f.renderer.nodes.includes(target), "the later interaction uses a real currently emitted native control");
  assert.equal(target.matches(":disabled"), false);
  f.native.emit("pointerdown", target); f.native.focus(target);
}
function key(f, target, name) {
  assert.ok(target?.isConnected);
  const event = { type: "keydown", key: name, target, currentTarget: ports.windowPort,
    isComposing: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, composedPath: () => [target, f.host, f.native.document],
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  // Existing complete classes' original native listeners; no private handler
  // extraction or synthetic route/authority notification is substituted.
  for (const listener of [...(f.listeners.get("keydown") ?? [])]) listener(event);
  return event;
}
function queuedToggle(panel) {
  const original = { show: panel.showPopover, hide: panel.hidePopover, toggle: panel.handlers.toggle };
  assert.equal(typeof original.toggle, "function");
  let queued = null, delivered = 0;
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
      assert.ok(queued, "an actual native state change queued this exact panel's toggle");
      const event = { type: "toggle", target: panel, currentTarget: panel, ...queued };
      queued = null; delivered++; original.toggle.call(panel.owner, event);
    },
  };
}
async function page(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No live network, provider or external navigation"));
  const f = await lifecyclePage(t, { route: "document", mode: "context" }), h = f.storeHost;
  assert.equal(f.host.tag, "forma-shell"); assert.ok(f.host.isConnected);
  assert.ok(ports.ElementPort.hasStoreIdentity(f.host, h.store));
  // This exact native query is new to this full-host witness. The shared finite
  // query splits selector alternatives and does not model :not([disabled]).
  // Resolve only the actual emitted account descendant grammar in DOM order;
  // no label, expected target, focus, default value or currentness is supplied.
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (selector !== focusableSelector || owner?.owner !== f.host || owner.attributes?.id !== "account-popover")
      return query(owner, selector);
    const tree = f.tree(), roots = tree.nodes.filter(row => row.port === owner);
    assert.equal(roots.length, 1, "the compound native query belongs to this exact current account panel");
    return tree.nodes.filter(row => inside(row, roots[0]) && row.port?.isConnected
      && (row.tag === "a" && Object.hasOwn(row.attributes, "href")
        || ["button", "input", "select"].includes(row.tag) && !Object.hasOwn(row.attributes, "disabled")))
      .map(row => row.port);
  };
  t.after(() => { f.renderer.query = query; });
  // Same native-window join already used by the actual navigation controls.
  // Forward the ORIGINAL Store event object; never manufacture a path/event.
  f.routeEvents = [];
  const forward = event => {
    f.routeEvents.push(event);
    for (const listener of [...(f.listeners.get("forma-route-changed") ?? [])]) listener(event);
  };
  h.window.addEventListener("forma-route-changed", forward);
  t.after(() => h.window.removeEventListener("forma-route-changed", forward));
  const observed = [];
  const onFocus = event => {
    const target = event.target, current = f.renderer.nodes.includes(target) && target.isConnected;
    observed.push({ target, current, main: target === f.host.querySelector("#main-content"),
      command: target === command(f), account: target === account(f).trigger,
      route: h.store.route.get() });
  };
  f.native.document.addEventListener("focusin", onFocus, true);
  t.after(() => f.native.document.removeEventListener("focusin", onFocus, true));
  const originalCommand = command(f); await f.settle();
  assert.equal(command(f), originalCommand, "reuse the shared exact EventPart native command-trigger lifetime");
  assert.equal(f.routeEvents.length, 0); f.focusObserved = observed;
  const baseline = {
    route: h.store.route.get(), location: { ...h.location }, session: h.store.session.get(),
    authority: h.store.captureAuthorizationScope(), source: h.store.captureSourceOwnership(),
    project: h.store.projection.get().projectId, document: h.store.projection.get().documentId,
    events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(),
    requests: h.requests.slice(), history: await readWorkspaceEvents(h.worker.env, h.worker.streamId),
    money: financial(h.worker),
  };
  assert.ok(h.store.sourceOwnershipActive(baseline.source)); return { f, h, baseline };
}
async function unchanged(p, { route = p.baseline.route, allowReads = false } = {}) {
  const { f, h, baseline: b } = p;
  assert.equal(h.store.route.get(), route); assert.equal(h.store.session.get(), b.session);
  assert.ok(h.store.authorizationScopeActive(b.authority)); assert.ok(h.store.sourceOwnershipActive(b.source));
  assert.equal(h.store.projection.get().projectId, b.project);
  assert.equal(h.store.events.get(), b.events); assert.equal(h.store.head.get(), b.head); assert.equal(h.store.content.get(), b.content);
  assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), b.history);
  assert.deepEqual(financial(h.worker), b.money);
  assert.deepEqual(h.requests.slice(0, b.requests.length), b.requests);
  if (allowReads) assert.ok(h.requests.slice(b.requests.length).every(row => (row.init.method ?? "GET") === "GET"),
    "ordinary Projects arrival may read, but cannot submit, retry, reserve or mutate");
  else { assert.equal(h.requests.length, b.requests.length); assert.deepEqual(h.location, b.location); }
  assert.equal(h.store.ui.commandOpen, false); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.ok(f.host.isConnected);
}

for (const newer of [false, true]) test("C Creator account queued opening focus / " +
  (newer ? "newer current command focus wins" : "healthy first current native control"), options, async t => {
  const p = await page(t), { f } = p, current = account(f), queue = queuedToggle(current.panel);
  const retainedCommand = command(f);
  pressFocus(f, current.trigger); current.trigger.click();
  assert.equal(current.panel.matches(":popover-open"), true); assert.ok(queue.pending); assert.equal(queue.delivered, 0);
  const focusables = current.panel.querySelectorAll(focusableSelector); assert.ok(focusables.length);
  assert.ok(focusables.every(node => current.panel.contains(node) && node.isConnected));
  if (newer) pressFocus(f, retainedCommand);
  const mark = f.focusObserved.length; queue.deliver();
  const late = f.focusObserved.slice(mark);
  t.diagnostic(JSON.stringify({ newer, late: late.map(row => ({ tag: row.target.tag,
    current: row.current, command: row.command, account: row.account })), nativeOpen: current.panel.matches(":popover-open"),
    boundary: "native toggle notification delivery; not physical event-task priority" }));
  if (newer) { assert.equal(late.length, 0); assert.equal(f.native.document.activeElement, retainedCommand); }
  else { assert.equal(late.length, 1); assert.equal(late[0].target, focusables[0]); assert.equal(late[0].current, true); }
  assert.equal(queue.pending, false); assert.equal(f.store.ui.accountOpen, true);
  await f.settle(); assert.equal(command(f), retainedCommand);
  assert.equal(account(f).panel.matches(":popover-open"), true);
  await unchanged(p);
});

for (const newer of [false, true]) test("C Creator account Escape return focus / " +
  (newer ? "newer current command focus wins" : "healthy current avatar returns"), options, async t => {
  const p = await page(t), { f } = p;
  let current = account(f), queue = queuedToggle(current.panel);
  pressFocus(f, current.trigger); current.trigger.click(); queue.deliver(); await f.settle();
  current = account(f); queue = queuedToggle(current.panel);
  assert.equal(f.store.ui.accountOpen, true); assert.equal(current.panel.matches(":popover-open"), true);
  const first = current.panel.querySelectorAll(focusableSelector)[0]; assert.ok(first?.isConnected); f.native.focus(first);
  const retainedCommand = command(f), escape = key(f, first, "Escape");
  assert.equal(escape.defaultPrevented, false, "actual Shell leaves native popover Escape dismissal intact");
  current.panel.hidePopover(); assert.equal(current.panel.matches(":popover-open"), false); assert.ok(queue.pending);
  if (newer) pressFocus(f, retainedCommand);
  const mark = f.focusObserved.length;
  // Let the original queued microtask run, then deliver the native close
  // notification. No application promise or updateComplete is held/replaced.
  await Promise.resolve(); queue.deliver(); await Promise.resolve();
  const late = f.focusObserved.slice(mark);
  t.diagnostic(JSON.stringify({ newer, late: late.map(row => ({ tag: row.target.tag,
    current: row.current, command: row.command, account: row.account })), nativeOpen: current.panel.matches(":popover-open"),
    boundary: "same-turn newer native interaction before original queued return; not physical scheduling proof" }));
  if (newer) { assert.equal(late.length, 0); assert.equal(f.native.document.activeElement, retainedCommand); }
  else { assert.equal(late.length, 1); assert.equal(late[0].target, current.trigger); assert.equal(late[0].current, true); }
  assert.equal(queue.pending, false); assert.equal(f.store.ui.accountOpen, false);
  await f.settle(); assert.equal(command(f), retainedCommand); assert.equal(account(f).panel.matches(":popover-open"), false);
  await unchanged(p);
});

for (const newer of [false, true]) test("C Creator ordinary Projects route main focus / " +
  (newer ? "newer current command focus wins" : "healthy current main receives focus"), options, async t => {
  const p = await page(t), { f, h, baseline } = p, retainedCommand = command(f);
  const brand = one(f, "button", row => row.owner === f.host && classed(row, "brand"));
  assert.equal(brand.hiddenBy, null); assert.equal(typeof brand.handlers.click, "function");
  const workspace = f.components().filter(owner => owner.tag === "forma-workspace" && owner.isConnected);
  assert.equal(workspace.length, 1);
  pressFocus(f, brand.port); brand.port.click();
  assert.equal(h.store.route.get(), "/projects", "the original actual header handler committed its real destination");
  assert.equal(f.routeEvents.length, 1); assert.equal(f.routeEvents[0].detail.path, "/projects");
  assert.equal(h.location.pathname, "/projects");
  // Draw the genuine committed destination normally. Its actual updated()
  // schedules the existing native updateComplete continuation itself.
  f.draw();
  assert.equal(workspace[0].isConnected, false);
  const projects = f.components().filter(owner => owner.tag === "forma-projects" && owner.isConnected);
  assert.equal(projects.length, 1); assert.equal(projects[0].store, h.store);
  assert.equal(command(f), retainedCommand);
  if (newer) pressFocus(f, retainedCommand);
  const mark = f.focusObserved.length;
  await new Promise(setImmediate);
  const late = f.focusObserved.slice(mark), main = late.filter(row => row.main);
  t.diagnostic(JSON.stringify({ newer, late: late.map(row => ({ tag: row.target.tag,
    current: row.current, main: row.main, command: row.command, route: row.route })),
    originalRoute: baseline.route, currentRoute: h.store.route.get(), routeEvents: f.routeEvents.length,
    boundary: "same-turn native interaction before untouched finite render microtask; not physical scheduling proof" }));
  if (newer) {
    assert.equal(main.length, 0, "the old route continuation cannot take focus after a newer native interaction");
    assert.equal(late.length, 0); assert.equal(f.native.document.activeElement, retainedCommand);
  } else {
    assert.equal(main.length, 1); assert.equal(main[0].current, true); assert.equal(main[0].route, "/projects");
    assert.equal(late.length, 1, "exactly the current actual main is focused, not another native target");
  }
  assert.equal(command(f), retainedCommand); assert.ok(retainedCommand.isConnected);
  await f.settle(); assert.equal(f.routeEvents.length, 1);
  await unchanged(p, { route: "/projects", allowReads: true });
});

for (const newer of ["none", "pointer", "key"]) test("D428 Creator account beforetoggle microtask checkpoint / " + newer, options, async t => {
  const p = await page(t), { f } = p, current = account(f), retainedCommand = command(f);
  const nativeShow = current.panel.showPopover, queue = queuedToggle(current.panel);
  assert.equal(typeof nativeShow, "function");
  pressFocus(f, current.trigger);
  const before = { type: "beforetoggle", target: current.panel, currentTarget: current.panel,
    oldState: "closed", newState: "open", cancelable: true, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  // Finite native lifecycle input: a browser callback can return through a
  // microtask checkpoint before its UA caller updates popover state. Keep
  // the existing actual EventPart, native state method and queued toggle;
  // this is not a browser keyboard/event-task-priority certificate.
  current.panel.handlers.beforetoggle.call(current.panel.owner, before);
  await Promise.resolve();
  assert.equal(before.defaultPrevented, false);
  assert.equal(current.panel.matches(":popover-open"), false);
  assert.equal(queue.pending, false);
  assert.equal(f.native.document.activeElement, current.trigger);
  assert.ok(current.panel.isConnected && current.trigger.isConnected);
  nativeShow.call(current.panel);
  assert.equal(current.panel.matches(":popover-open"), true);
  assert.ok(queue.pending);
  assert.equal(queue.delivered, 0);
  if (newer === "pointer") pressFocus(f, retainedCommand);
  if (newer === "key") key(f, current.trigger, "ArrowRight");
  // The original state change has completed. Deliver its queued notification
  // without a duration-based wait or changing the application focus guard.
  const focusables = current.panel.querySelectorAll(focusableSelector);
  assert.ok(focusables.length && focusables.every(node => current.panel.contains(node) && node.isConnected));
  const mark = f.focusObserved.length;
  queue.deliver();
  const late = f.focusObserved.slice(mark);
  t.diagnostic(JSON.stringify({ newer, late: late.map(row => ({ tag: row.target.tag,
    current: row.current, command: row.command, account: row.account })),
    nativeOpen: current.panel.matches(":popover-open"),
    boundary: "declared beforetoggle callback checkpoint before original native state change; browser evidence is separate" }));
  if (newer === "none") {
    assert.equal(late.length, 1, "the original uninterrupted opening focuses its first current native control");
    assert.equal(late[0].target, focusables[0]);
    assert.equal(late[0].current, true);
  } else {
    assert.equal(late.length, 0, "a newer pointer or key must still retire the original focus handoff");
    assert.equal(f.native.document.activeElement, newer === "pointer" ? retainedCommand : current.trigger);
  }
  assert.equal(queue.pending, false);
  assert.equal(queue.delivered, 1);
  assert.equal(f.store.ui.accountOpen, true, "a genuine native open still updates presentation state");
  await f.settle();
  assert.equal(account(f).panel.matches(":popover-open"), true);
  assert.equal(command(f), retainedCommand);
  await unchanged(p);
});
