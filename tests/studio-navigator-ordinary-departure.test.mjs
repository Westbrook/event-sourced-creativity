import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";

// Actual Editor composition contains StudioNavigator but deliberately omits
// DocumentContinuity. The separate Guided pair owns that real baseline link.
const options = { concurrency: false, timeout: 120_000 };
const plain = { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" };
for (const [state, locale] of [["clean", "en"], ["raw", "ja"]])
test("C StudioNavigator actual Editor breadcrumb / " + state + " / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale), { f, h, owner, native } = x;
  await registerCalmFullPageComponents(f, ["forma-projects"]); await x.settle();
  const navigators = f.components().filter(element => element.tag === "forma-studio-navigator" && element.store === h.store);
  assert.equal(navigators.length, 1); const navigator = navigators[0];
  assert.ok(navigator.isConnected); assert.equal(navigator.parentElement, owner);
  assert.equal(navigator.closest("forma-shell"), f.host); assert.ok(f.host.contains(navigator));
  assert.equal(f.components().filter(element => element.tag === "forma-document-continuity").length, 0,
    "The real Editor omits continuity; no hidden or manufactured baseline control");
  const link = () => f.find("a", node => node.owner === navigator && node.attributes.href === "/projects");
  const activate = async () => {
    const current = link(); assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port));
    assert.equal(current.port.matches(":disabled"), false); assert.equal(typeof current.handlers.click, "function");
    assert.equal(h.store.ui.commandOpen, false);
    f.native.emit("pointerdown", current.port); f.native.focus(current.port);
    const gesture = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length };
    await f.act(current, "click", { button: 0, defaultPrevented: false }); await x.settle(); return gesture;
  };
  const raw = { ...plain, copy: "  Unsent breadcrumb direction B — 未保存\n  " };
  assert.deepEqual(native.raw(), plain);
  if (state === "raw") { assert.deepEqual(native.change({ copy: raw.copy }), raw); await f.settle(); }
  const form = native.current().form, before = await x.snapshot(), gesture = await activate();
  await x.safety(before);
  t.diagnostic("C_STUDIO_NAVIGATOR_BREADCRUMB " + JSON.stringify({ state, locale, before: before.route, after: h.store.route.get(),
    originalEditorConnected: owner.isConnected, requests: h.requests.slice(before.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    originalHistoryReceiptAndFiscalUnchanged: true, evidence: "actual native Editor/breadcrumb/Store/Worker; no physical or provider claim" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), before.route, "The actual breadcrumb cannot discard current native Editor work");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
    assert.ok(owner.isConnected && navigator.isConnected); assert.equal(native.current().form, form);
    assert.deepEqual(native.raw(), raw); assert.equal(h.requests.length, before.requests);
    assert.equal(f.native.nativeScroll.length, gesture.scroll);
    assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.attributes?.id === "main-content"), false);
    assert.deepEqual(await native.escape(), plain, "The existing actual Escape restores the source before a new gesture");
    assert.equal(native.current().form, form); assert.deepEqual(native.raw(), plain);
    const resolved = await x.snapshot(); await activate(); await x.safety(resolved);
  }
  assert.equal(h.store.route.get(), "/projects"); assert.equal(h.location.pathname + h.location.search + h.location.hash, "/projects");
  assert.equal(owner.isConnected, false); assert.equal(navigator.isConnected, false); assert.equal(form.isConnected, false);
  const projects = f.components().filter(element => element.tag === "forma-projects" && element.store === h.store);
  assert.equal(projects.length, 1); assert.ok(projects[0].isConnected);
  assert.equal(h.store.ui.commandOpen, false); await x.safety(before);
});
