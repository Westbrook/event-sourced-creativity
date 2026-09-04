import assert from "node:assert/strict";
import test from "node:test";
import { contextFocusFixture, contextFocusDeferred } from "./helpers/context-focus-continuity-fixture.mjs";


const contextFocusModes = ["owned", "newer-focus", "pointer", "keyboard", "focus-away-and-back", "selection-away-and-back", "route-away-and-back", "newer-opening", "disconnected"];
for (const locale of ["en", "fr", "ar", "ja"]) for (const action of ["open", "close"]) for (const mode of contextFocusModes) test("Context focus continuity: " + locale + " " + action + " " + mode, async t => {
  const { f, native, selector, toggle } = await contextFocusFixture(t, locale);
  if (action === "close") await f.act(toggle());
  const block = toggle().owner, originalRoute = f.store.route.get();
  const beforeEvents = JSON.stringify(f.store.events.get()), beforeRequests = f.storeHost.requests.length;
  const listenerCounts = Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, native.listeners(type)]));
  const deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  const newer = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  assert.ok(newer?.isConnected, "a real newer ordinary control is available");
  const initial = native.document.activeElement;
  if (mode === "newer-focus") native.focus(newer);
  else if (mode === "pointer") native.emit("pointerdown", newer);
  else if (mode === "keyboard") native.emit("keydown", newer);
  else if (mode === "focus-away-and-back") {
    native.focus(newer);
    if (initial?.isConnected) native.focus(initial);
  } else if (mode === "selection-away-and-back") {
    await f.act(selector("synthetic-1"), "change"); await f.act(selector("synthetic-0"), "change");
  } else if (mode === "route-away-and-back") {
    f.store.route.set(originalRoute + "-another-view"); await f.settle();
    f.store.route.set(originalRoute); await f.settle();
  } else if (mode === "newer-opening") {
    if (action === "open") { deferred.next(); await f.act(toggle()); }
    const newerOpening = deferred.next();
    await f.act(toggle()); newerOpening.resolve(true); await f.settle();
    assert.equal(String(native.document.activeElement?.attributes?.class), "context-controls-panel", "new opening gets its own ordinary focus");
    const currentLanguage = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
    native.focus(currentLanguage);
  } else if (mode === "disconnected") {
    block.isConnected = false; block.disconnectedCallback();
  }
  const focusBefore = native.nativeFocus.length, scrollBefore = native.nativeScroll.length, activeBefore = native.document.activeElement;
  deferred.first.resolve(true); await f.settle();
  assert.equal(JSON.stringify(f.store.events.get()), beforeEvents, "focus produces no authored events");
  assert.equal(f.storeHost.requests.length, beforeRequests, "focus does not request new private or paid work");
  if (mode === "owned") assert.ok(String(native.document.activeElement?.attributes?.class ?? "").includes(action === "open" ? "context-controls-panel" : "context-controls-toggle"));
  else {
    assert.equal(native.nativeFocus.length, focusBefore, "the retired effect never focuses after a newer intent");
    assert.equal(native.document.activeElement === activeBefore, true);
  }
  const reveals = native.nativeScroll.slice(scrollBefore);
  assert.equal(reveals.length, mode === "owned" && action === "close" ? 1 : 0, "only the current Document Close gesture reveals its toggle");
  if (reveals.length) {
    assert.equal(reveals[0].node, native.document.activeElement, "reveal and focus use the same native toggle");
    assert.equal(reveals[0].node.owner, block);
    assert.deepEqual(reveals[0].args, [{ block: "center", inline: "nearest", behavior: "instant" }]);
  }
  for (const type of ["pointerdown", "keydown", "focusin"]) assert.equal(native.listeners(type), listenerCounts[type], "terminal effect releases its " + type + " listener");
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const action of ["open", "close"]) for (const moved of [false, true]) test("Context focus continuity: " + locale + " reader " + action + " " + (moved ? "newer-focus" : "owned"), async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale, true);
  if (action === "close") await f.act(toggle());
  const block = toggle().owner, deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  const newer = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  if (moved) native.focus(newer);
  const calls = native.nativeFocus.length, scrollBefore = native.nativeScroll.length;
  deferred.first.resolve(true); await f.settle();
  const reveals = native.nativeScroll.slice(scrollBefore);
  assert.equal(reveals.length, !moved && action === "close" ? 1 : 0, "inspection only reveals the current Document Close target");
  if (reveals.length) {
    assert.equal(reveals[0].node, native.document.activeElement);
    assert.equal(reveals[0].node.owner, block);
    assert.deepEqual(reveals[0].args, [{ block: "center", inline: "nearest", behavior: "instant" }]);
  }
  assert.equal(f.tree().visible("form").some(node => node.owner === block && String(node.attributes.class).includes("block-editor")), false, "inspection does not create authoring controls");
  if (moved) { assert.equal(native.document.activeElement === newer, true); assert.equal(native.nativeFocus.length, calls); }
  else assert.ok(String(native.document.activeElement?.attributes?.class ?? "").includes(action === "open" ? "context-controls-panel" : "context-controls-toggle"));
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const action of ["begin-edit", "cancel-edit"]) for (const moved of [false, true]) test("Context focus continuity: " + locale + " " + action + " " + (moved ? "newer-focus" : "owned"), async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale);
  await f.act(toggle());
  const block = toggle().owner;
  const cancel = () => f.find("button", node => node.owner === block && node.attributes.type === "button" && node.attributes.class === "button ghost");
  if (action === "begin-edit") await f.act(cancel());
  const deferred = contextFocusDeferred(t, block);
  const target = action === "begin-edit" ? f.find("button", node => node.owner === block && String(node.attributes.class).split(/\s/u).includes("block-copy")) : cancel();
  await f.act(target);
  const newer = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  if (moved) native.focus(newer);
  const calls = native.nativeFocus.length, scrollBefore = native.nativeScroll.length;
  deferred.first.resolve(true); await f.settle();
  assert.equal(native.nativeScroll.length, scrollBefore, "editor entry and Cancel retain their original focus-only behavior");
  if (moved) { assert.equal(native.document.activeElement === newer, true); assert.equal(native.nativeFocus.length, calls); }
  else if (action === "begin-edit") assert.equal(native.document.activeElement?.tag, "textarea");
  else assert.ok(String(native.document.activeElement?.attributes?.class).includes("block-copy"));
});

for (const mode of ["newer-focus", "pointer", "keyboard", "selection"]) test("Context close reveal rechecks custody after synchronous scroll: " + mode, async t => {
  const { f, native, toggle } = await contextFocusFixture(t, "en");
  await f.act(toggle());
  const block = toggle().owner, route = f.store.route.get();
  const events = JSON.stringify(f.store.events.get()), requests = f.storeHost.requests.length;
  const listenerCounts = Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, native.listeners(type)]));
  const deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  const target = toggle().port;
  assert.equal(block.querySelector(".context-controls-toggle"), target, "instrument the current actual native return target");
  const newer = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  assert.ok(newer?.isConnected);
  const originalScroll = target.scrollIntoView;
  assert.equal(typeof originalScroll, "function", "reuse the existing native scroll recorder");
  let interrupted = null;
  target.scrollIntoView = (...args) => {
    const result = Reflect.apply(originalScroll, target, args);
    if (mode === "newer-focus") native.focus(newer);
    else if (mode === "pointer") native.emit("pointerdown", newer);
    else if (mode === "keyboard") native.emit("keydown", newer);
    else f.store.patchUi({ focusBlockId: "synthetic-1" });
    interrupted = { active: native.document.activeElement, focusCalls: native.nativeFocus.length };
    return result;
  };
  t.after(() => { target.scrollIntoView = originalScroll; });
  const scrollBefore = native.nativeScroll.length;
  deferred.first.resolve(true); await f.settle();
  const reveals = native.nativeScroll.slice(scrollBefore);
  assert.equal(reveals.length, 1, "the owned close reaches one native reveal before the newer intent");
  assert.equal(reveals[0].node, target);
  assert.deepEqual(reveals[0].args, [{ block: "center", inline: "nearest", behavior: "instant" }]);
  assert.ok(interrupted, "custody is withdrawn synchronously inside that reveal");
  assert.equal(native.nativeFocus.length, interrupted.focusCalls, "the retired return must not focus after scroll");
  assert.equal(native.document.activeElement, interrupted.active, "preserve the newer native focus owner");
  assert.equal(f.store.ui.focusBlockId, mode === "selection" ? "synthetic-1" : "synthetic-0");
  assert.equal(f.store.ui.editingBlockId, "");
  assert.equal(f.store.route.get(), route);
  assert.equal(JSON.stringify(f.store.events.get()), events);
  assert.equal(f.storeHost.requests.length, requests);
  for (const type of ["pointerdown", "keydown", "focusin"]) assert.equal(native.listeners(type), listenerCounts[type], "retired reveal releases its " + type + " listener");
});

for (const mode of ["target-replacement", "target-disconnection", "route", "dialog-opens"]) test("Context close reveal rechecks current target and presentation after synchronous scroll: " + mode, async t => {
  const { f, native, toggle } = await contextFocusFixture(t, "en");
  await f.act(toggle());
  const block = toggle().owner, route = f.store.route.get(), newerRoute = route + "?context-return-reveal=newer";
  const events = JSON.stringify(f.store.events.get()), requests = f.storeHost.requests.length;
  const listenerCounts = Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, native.listeners(type)]));
  const deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  const target = toggle().port;
  assert.equal(block.querySelector(".context-controls-toggle"), target);
  assert.equal(native.document.querySelector("dialog[open]"), null);
  const command = mode === "dialog-opens" ? f.find("button", node => node.owner === f.host && String(node.attributes.class).split(/\s+/).includes("command-trigger")) : null;
  if (command) assert.equal(typeof command.handlers.click, "function", "use the actual existing Shell command handler");
  const originalScroll = target.scrollIntoView;
  assert.equal(typeof originalScroll, "function");
  let interrupted = null;
  target.scrollIntoView = (...args) => {
    const result = Reflect.apply(originalScroll, target, args);
    if (mode === "target-replacement") {
      // The existing renderer replaces literal native ports on draw; it also
      // disconnects the old toggle. This does not isolate the identity guard.
      f.draw();
    } else if (mode === "target-disconnection") target.isConnected = false;
    else if (mode === "route") f.store.route.set(newerRoute);
    else {
      command.handlers.click.call(command.owner, { target: command.port, currentTarget: command.port, type: "click", preventDefault() {}, stopPropagation() {} });
      // Mount the actual new Shell dialog. This draw also replaces the toggle;
      // the witness covers both changes, not a mock query for an invented dialog.
      f.draw();
    }
    const currentTarget = block.querySelector(".context-controls-toggle");
    interrupted = {
      active: native.document.activeElement, focusCalls: native.nativeFocus.length,
      targetConnected: target.isConnected, currentTarget, currentTargetConnected: Boolean(currentTarget?.isConnected),
      route: f.store.route.get(), dialogs: native.document.querySelectorAll("dialog[open]"), commandOpen: f.store.ui.commandOpen,
    };
    return result;
  };
  t.after(() => { target.scrollIntoView = originalScroll; });
  const scrollBefore = native.nativeScroll.length;
  deferred.first.resolve(true); await f.settle();
  const reveals = native.nativeScroll.slice(scrollBefore);
  assert.equal(reveals.length, 1, "the current close reaches the callback boundary once");
  assert.equal(reveals[0].node, target);
  assert.deepEqual(reveals[0].args, [{ block: "center", inline: "nearest", behavior: "instant" }]);
  assert.ok(interrupted, "the current target or presentation changes inside scroll");
  if (mode === "target-replacement") {
    assert.equal(interrupted.currentTargetConnected, true);
    assert.notEqual(interrupted.currentTarget, target);
    assert.equal(interrupted.currentTarget.owner, block);
    assert.equal(interrupted.targetConnected, false);
  } else if (mode === "target-disconnection") assert.equal(interrupted.targetConnected, false);
  else if (mode === "route") assert.equal(interrupted.route, newerRoute);
  else {
    assert.equal(interrupted.commandOpen, true);
    assert.equal(interrupted.dialogs.length, 1);
    assert.equal(interrupted.dialogs[0].owner, f.host);
    assert.ok(String(interrupted.dialogs[0].attributes.class).split(/\s+/).includes("command-dialog"));
    assert.equal(f.store.ui.commandOpen, true, "the newer dialog remains open");
    assert.equal(native.document.querySelectorAll("dialog[open]").length, 1);
  }
  assert.equal(native.nativeFocus.length, interrupted.focusCalls, "the retired return adds no native focus after the callback");
  assert.equal(native.document.activeElement, interrupted.active);
  assert.equal(f.store.ui.focusBlockId, "synthetic-0");
  assert.equal(f.store.ui.editingBlockId, "");
  assert.equal(f.store.route.get(), mode === "route" ? newerRoute : route);
  assert.equal(JSON.stringify(f.store.events.get()), events);
  assert.equal(f.storeHost.requests.length, requests);
  for (const type of ["pointerdown", "keydown", "focusin"]) assert.equal(native.listeners(type), listenerCounts[type], "retired callback releases its " + type + " listener");
});
