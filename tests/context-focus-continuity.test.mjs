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
  const focusBefore = native.nativeFocus.length, activeBefore = native.document.activeElement;
  deferred.first.resolve(true); await f.settle();
  assert.equal(JSON.stringify(f.store.events.get()), beforeEvents, "focus produces no authored events");
  assert.equal(f.storeHost.requests.length, beforeRequests, "focus does not request new private or paid work");
  if (mode === "owned") assert.ok(String(native.document.activeElement?.attributes?.class ?? "").includes(action === "open" ? "context-controls-panel" : "context-controls-toggle"));
  else {
    assert.equal(native.nativeFocus.length, focusBefore, "the retired effect never focuses after a newer intent");
    assert.equal(native.document.activeElement === activeBefore, true);
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
  const calls = native.nativeFocus.length;
  deferred.first.resolve(true); await f.settle();
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
  const calls = native.nativeFocus.length;
  deferred.first.resolve(true); await f.settle();
  if (moved) { assert.equal(native.document.activeElement === newer, true); assert.equal(native.nativeFocus.length, calls); }
  else if (action === "begin-edit") assert.equal(native.document.activeElement?.tag, "textarea");
  else assert.ok(String(native.document.activeElement?.attributes?.class).includes("block-copy"));
});
