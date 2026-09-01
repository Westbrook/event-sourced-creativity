import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { libraryBlockEditorFromRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Complete existing Shell/Editor/Store/native fixture and real isolated Worker.
// The opt-in source is a genuine separate project before the accounting floor;
// no Store projection, permission, app method or response is substituted.
const options = { concurrency: false, timeout: 120_000 };
const plain = { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" };
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };

async function openEmptyPicker(x, mode) {
  const { f, h } = x, route = h.store.route.get(), requests = h.requests.length;
  const trigger = f.find("button", node => node.owner === mode && classed(node, "context-set-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  await f.act(trigger, "click", { button: 0 });
  let tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy && inside(node, dialogs[0]));
  assert.equal(choices.length, 2); assert.deepEqual(choices.map(node => node.component.value), ["create", "reuse"]);
  const reuse = choices.find(node => node.component.value === "reuse").component;
  const button = f.find("button", node => node.owner === reuse && node.attributes["data-choice-value"] === "reuse");
  assert.equal(reuse.closest("forma-studio-mode-nav"), mode); assert.equal(button.port.matches(":disabled"), false);
  const trace = f.trace.length; f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  await f.act(button, "click", { button: 0 }); await x.settle();
  assert.ok(f.trace.slice(trace).includes("event:forma-action"), "Actual native choice emitted its existing semantic action");
  tree = f.tree(); dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  assert.equal(tree.visible("div").filter(node => node.owner === mode && classed(node, "context-set-picker-empty") && inside(node, dialogs[0])).length, 1);
  assert.equal(tree.visible("input").filter(node => inside(node, dialogs[0])).length, 0);
  assert.equal(tree.visible("textarea").filter(node => inside(node, dialogs[0])).length, 0);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, requests, "Read-only picker setup has no destination request");
  return dialogs[0];
}

for (const [state, locale] of [["clean", "en"], ["raw", "ja"]])
test("C ordinary empty reusable picker keeps sibling work / " + state + " / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale, { emptyReusableContext: true }), { f, h, owner, native } = x;
  await registerCalmFullPageComponents(f, ["forma-library", "forma-library-block-editor", "forma-ui-choice-card"]); await x.settle();
  const projection = h.store.projection.get();
  assert.equal(projection.projectId, "empty-reusable-context-project");
  assert.equal(projection.documentId, "empty-reusable-context-document");
  assert.deepEqual(projection.libraryBlocks.map(block => block.id), [x.selected.id]);
  assert.equal(x.selected.scope, "document"); assert.deepEqual(projection.libraryArtifacts, []);
  assert.equal(projection.libraryOutputs.some(output => output.mediaUrl && !output.discarded), false);
  const modes = f.components().filter(element => element.tag === "forma-studio-mode-nav" && element.store === h.store);
  assert.equal(modes.length, 1); const mode = modes[0];
  assert.ok(mode.isConnected); assert.equal(mode.closest("forma-creative-editor"), owner);
  assert.equal(mode.closest("forma-shell"), f.host); assert.ok(f.host.contains(mode));
  assert.deepEqual(native.raw(), plain);
  const raw = { ...plain, copy: "  Unsent picker sibling B — 未保存\n  " };
  if (state === "raw") { assert.deepEqual(native.change({ copy: raw.copy }), raw); await f.settle(); }
  const originalForm = native.current().form;
  await openEmptyPicker(x, mode);
  const activate = async () => {
    const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
    assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
    const links = tree.visible("a").filter(node => node.owner === mode && node.attributes.href === "/library/blocks/editor/new" && inside(node, dialogs[0]));
    assert.equal(links.length, 1); const link = links[0];
    assert.ok(link.port.isConnected && f.renderer.nodes.includes(link.port)); assert.equal(link.port.matches(":disabled"), false);
    f.native.emit("pointerdown", link.port); f.native.focus(link.port);
    const gesture = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length, trace: f.trace.length };
    await f.act(link, "click", { button: 0, defaultPrevented: false }); await x.settle(); return gesture;
  };
  const before = await x.snapshot(), gesture = await activate(); await x.safety(before);
  t.diagnostic("C_READONLY_PICKER_DEPARTURE " + JSON.stringify({ state, locale, originalRoute: before.route, actualRoute: h.store.route.get(),
    originalEditorConnected: owner.isConnected, attributableRequests: h.requests.slice(before.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    exactSourceHistoryReceiptsFiscalUnchanged: true, evidence: "actual empty-source project/Editor/choice/link/Store/Worker; no physical, provider or review proof" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), before.route, "A read-only picker cannot authorize discarding its sibling Editor draft");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
    assert.ok(owner.isConnected && mode.isConnected); assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
    assert.equal(h.requests.length, before.requests); assert.equal(f.native.nativeScroll.length, gesture.scroll);
    assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.attributes?.id === "main-content"), false);
    const current = f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
    assert.equal(current.length, 1); assert.equal(current[0].port.open, true, "Refusal leaves the exact current picker presentation available");
    assert.equal(f.trace.slice(gesture.trace).some(value => value === "close:modal context-set-picker-dialog"), false,
      "Admission cannot be obtained by first closing its own picker");
    await f.act(current[0], "cancel", { cancelable: true }); await x.settle();
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog")).length, 0);
    assert.deepEqual(native.raw(), raw, "Explicit picker Cancel does not consume sibling text");
    assert.deepEqual(await native.escape(), plain); assert.equal(native.current().form, originalForm);
    await openEmptyPicker(x, mode); const resolved = await x.snapshot(); await activate(); await x.safety(resolved);
  }
  const destination = withProjectTaskDocumentInRoute("/library/blocks/editor/new", h.worker.documentId, before.route);
  assert.equal(h.store.route.get(), destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
  assert.deepEqual(libraryBlockEditorFromRoute(destination), { blockId: null });
  assert.equal(owner.isConnected, false); assert.equal(mode.isConnected, false); assert.equal(originalForm.isConnected, false);
  const editors = f.components().filter(element => element.tag === "forma-library-block-editor" && element.store === h.store);
  assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(editors[0].blockId, null);
  assert.equal(f.tree().visible("dialog").filter(node => classed(node, "context-set-picker-dialog")).length, 0);
  assert.equal(h.store.ui.commandOpen, false); await x.safety(before);
});
