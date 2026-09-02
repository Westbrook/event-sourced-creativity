import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";

// All cases mount the actual ordinary /studio/editor under the full Creator
// Shell and use its current command search/row. Native value/option/radio and
// focus ports are finite adapters, not a browser/IME/AT or geometry certificate.
const options = { concurrency: false, timeout: 120_000 };
const plain = { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" };

function assertExactEditor(x, raw) {
  const { h, owner, native, selected } = x;
  assert.ok(owner.isConnected); assert.equal(owner.store, h.store);
  const current = h.store.projection.get();
  assert.equal(current.projectId, h.worker.projectId); assert.equal(current.documentId, h.worker.documentId);
  assert.equal(current.blocks[0].id, selected.id); assert.equal(current.blocks[0].documentId, selected.documentId);
  assert.deepEqual(native.raw(), raw); assert.ok(native.current().form.isConnected);
  for (const name of ["item-type", "item-intent"]) {
    const select = native.field(name); assert.equal(select.selectedOptions.length, 1);
    assert.equal(select.selectedOptions[0].value, raw[name]); assert.ok(select.selectedOptions[0].isConnected);
  }
  assert.equal(native.field("copy").value, raw.copy);
  assert.equal([...native.current().fields.values()].filter(item => item.name === "strength" && item.node.checked).length, 1);
  assert.equal([...native.current().fields.values()].find(item => item.name === "strength" && item.node.checked).node.value, raw.strength);
}

function assertDestination(x, before) {
  const { f, h, owner } = x;
  assert.equal(h.store.route.get(), x.desiredDestination(before.title));
  assert.notEqual(h.store.route.get(), before.route); assert.equal(owner.isConnected, false);
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port?.open);
  assert.equal(dialogs.length, 1); const chooser = dialogs[0];
  assert.ok(x.classed(chooser, "next-format-dialog")); assert.equal(chooser.owner.tag, "forma-workspace");
  assert.equal(chooser.owner.store, h.store); assert.ok(chooser.owner.isConnected);
  const formats = tree.visible("button").filter(node => node.owner.tag === "forma-ui-choice-card" && x.within(node, chooser));
  assert.equal(formats.length, 7, "The actual healthy command reaches all seven free format controls");
}

test("C ordinary Editor command / pristine populated native source / en", options, async t => {
  const x = await creativeEditorCommandPage(t, "en"); assertExactEditor(x, plain);
  const before = await x.snapshot(); assert.equal(x.selected.properties.weight, 1);
  assert.equal(x.native.field("copy").properties.value, plain.copy);
  t.diagnostic("C_EDITOR_COMMAND prerequisite: complete Editor, populated controlled copy, categorical Lead, actual Source/actor/document and zero pending setup");
  await x.prepare(); await x.safety(before); assertDestination(x, before);
});

for (const [kind, locale, changes] of [
  ["raw copy", "ja", { copy: "  A genuine unsent direction — 未保存  " }],
  ["deliberately cleared copy", "en", { copy: "" }],
  ["native role intent and radio", "ja", { "item-type": "subject", "item-intent": "prohibit", strength: "supporting" }],
]) test("C ordinary Editor command / " + kind + " remains until actual Escape / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale), raw = { ...plain, ...changes };
  assert.deepEqual(x.native.change(changes), raw); await x.f.settle(); assertExactEditor(x, raw);
  const before = await x.snapshot();
  t.diagnostic("C_EDITOR_COMMAND prerequisite: current native " + kind + ", unchanged source/owner and complete current preparation row");
  await x.prepare(); await x.safety(before);
  assert.equal(x.h.store.route.get(), before.route, "An ordinary named command must retain the same unsaved native Editor fields");
  assertExactEditor(x, raw);
  assert.equal(x.f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
  assert.equal(x.h.requests.length, before.requests, "Refusal must not begin destination reads or writes");
  assert.deepEqual(await x.native.escape(), plain, "The existing real Escape handler restores the current canonical source");
  assertExactEditor(x, plain);
  const afterCancel = await x.snapshot(); await x.prepare(); await x.safety(afterCancel); assertDestination(x, afterCancel);
});

test("C ordinary Editor command / real saved feed before original Save response settles / en", options, async t => {
  const x = await creativeEditorCommandPage(t, "en"), text = "A real edited harbor direction.";
  const raw = { ...plain, copy: text }; assert.deepEqual(x.native.change({ copy: text }), raw);
  assert.equal(x.resume.pendingOriginalCount(), 0);
  const held = x.holdSave(); let finished = false;
  const pending = x.native.submit().then(() => { finished = true; });
  try {
    let observed = null; void held.ready.then(value => { observed = value; });
    await x.untilScene(() => observed !== null, "The actual current native Save must receive its original committed Worker response");
    const record = observed; assert.equal(record.released, false); assert.equal(finished, false);
    assert.deepEqual(record.receipt.appended[0].payload, { block_id: x.selected.id, property_path: "text", old_value: plain.copy, new_value: text, source_surface: "creative-editor" });
    assert.deepEqual(record.receipt.appended[1].payload, { block_id: x.selected.id, weight: .94, previous_weight: 1, source_surface: "creative-editor" });
    // Public current feed sees the real committed event while only that same
    // original response is held. No fake success, private saving bit, or source
    // assignment is used to make the native form appear canonical.
    await x.h.store.refreshEvents({ fromStart: true }); await x.settle();
    const current = x.h.store.projection.get().blocks.find(item => item.id === x.selected.id);
    assert.equal(current.properties.text, text); assert.equal(current.properties.weight, .94);
    assertExactEditor(x, raw); assert.equal(x.native.field("copy").properties.value, text);
    assert.equal(finished, false); assert.equal(record.released, false);
    const before = await x.snapshot();
    t.diagnostic("C_EDITOR_SAVE_PENDING reached: original actual Worker batch committed, current public feed matches the native form, original Save handler remains unsettled");
    await x.prepare(); await x.safety(before);
    assert.equal(finished, false); assert.equal(record.released, false);
    assert.equal(x.h.store.route.get(), before.route, "A canonical-looking form must not erase the still-pending original Save boundary");
    assertExactEditor(x, raw); assert.equal(x.h.requests.length, before.requests);
    held.release(); await pending; held.restore(); await x.settle(); assert.equal(finished, true);
    const settled = await x.snapshot(); await x.prepare(); await x.safety(settled); assertDestination(x, settled);
  } finally { held.release(); await pending; held.restore(); }
});

test("C ordinary Editor command / actual Create and reference Cancel resolve local fields / ja", options, async t => {
  const x = await creativeEditorCommandPage(t, "ja"), { f, owner } = x;
  const before = await x.snapshot();
  const open = f.tree().visible("button").find(node => node.owner === owner && String(node.handlers.click).includes("#openCreate"));
  assert.ok(open); await f.act(open);
  let tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === owner && x.classed(node, "creative-add-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const copy = tree.visible("textarea").filter(node => x.within(node, dialogs[0])); assert.equal(copy.length, 1);
  copy[0].port.value = "  Cancelled ordinary creation — 取り消し  "; await f.act(copy[0], "input");
  tree = f.tree(); const createCancel = tree.visible("button").filter(node => node.owner === owner
    && x.classed(node, "ghost") && String(node.handlers.click).includes("#closeCreate"));
  assert.equal(createCancel.length, 1); await f.act(createCancel[0]);
  assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && x.classed(node, "creative-add-dialog")).length, 0);
  const file = f.find("input", node => node.owner === owner && node.attributes.type === "file" && node.attributes.accept === "image/*" && Boolean(node.handlers.change));
  file.port.files = [new File(["finite cancelled image bytes"], "cancelled-reference.png", { type: "image/png" })];
  await f.act(file, "change");
  tree = f.tree(); dialogs = tree.visible("dialog").filter(node => node.owner === owner && x.classed(node, "creative-reference-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const rights = tree.visible("input").filter(node => x.within(node, dialogs[0]) && node.attributes.type === "checkbox");
  assert.equal(rights.length, 1); rights[0].port.checked = true; await f.act(rights[0], "change");
  const cancel = f.tree().visible("button").filter(node => node.owner === owner && x.classed(node, "ghost") && String(node.handlers.click).includes("#cancelReference"));
  assert.equal(cancel.length, 1); await f.act(cancel[0]);
  assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && x.classed(node, "creative-reference-dialog")).length, 0);
  assertExactEditor(x, plain); await x.safety(before);
  assert.equal(x.h.requests.length, before.requests, "Cancelling never uploads, creates or extracts the reference");
  const resolved = await x.snapshot(); await x.prepare(); await x.safety(resolved); assertDestination(x, resolved);
});
