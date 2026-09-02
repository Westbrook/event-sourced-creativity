import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";

// Actual editor controls and handlers with the existing finite native ports.
// The upload method is a boundary observation, not a storage or WebGL fixture.
const options = { concurrency: false, timeout: 120_000 };

test("Creative Editor requires explicit rights before dispatching the original GLB upload", options, async t => {
  const x = await creativeEditorCommandPage(t, "en"), { f, h, owner } = x;
  const calls = [];
  t.mock.method(h.store, "uploadModel3dFile", async (file, current, options) => {
    calls.push({ file, current, options, currentAtDispatch: current() });
    return false;
  });
  const picker = f.find("input", node => node.owner === owner && node.attributes.type === "file"
    && node.attributes.accept === ".glb,model/gltf-binary");
  const file = new File(["finite consent-only fixture; bytes are never uploaded"], "licensed-model.glb", { type: "model/gltf-binary" });
  picker.port.files = [file];
  await f.act(picker, "change");
  let tree = f.tree();
  const dialog = tree.visible("dialog").find(node => node.owner === owner && x.classed(node, "creative-reference-dialog"));
  assert.ok(dialog?.port.open);
  assert.match(dialog.text, /Review this 3D model/);
  assert.match(dialog.text, /Choose and save a view/);
  assert.equal(calls.length, 0, "Choosing a model does not assert rights or upload it");
  const submit = () => {
    const tree = f.tree(), form = tree.visible("form").find(node => node.owner === owner && x.classed(node, "creative-reference-card"));
    assert.ok(form);
    form.handlers.submit.call(owner, { preventDefault() {} });
  };
  submit(); await f.settle();
  assert.equal(calls.length, 0, "Even direct submission without the checkbox cannot dispatch");
  tree = f.tree();
  const rights = tree.visible("input").find(node => node.owner === owner && node.attributes["aria-describedby"] === "creative-reference-rights-hint");
  assert.ok(rights); rights.port.checked = true; await f.act(rights, "change");
  submit(); await f.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, file);
  assert.deepEqual(calls[0].options, { documentId: h.worker.documentId, rightsConfirmed: true });
  assert.equal(calls[0].currentAtDispatch, true);
  const cancel = f.tree().visible("button").find(node => node.owner === owner && x.classed(node, "ghost")
    && String(node.handlers.click).includes("#cancelReference"));
  assert.ok(cancel); await f.act(cancel);
  assert.equal(calls[0].current(), false, "Cancelling retires the original picker and confirmation");
  assert.equal(h.store.projection.get().blocks.some(block => block.type === "model3d"), false);
});

test("Creative Editor offers GLB upload instead of a text-only model role", options, async t => {
  const x = await creativeEditorCommandPage(t, "en"), { f, owner } = x;
  assert.equal(f.tree().nodes.some(node => node.owner === owner && node.tag === "option" && node.attributes.value === "model3d"), false);
  const open = f.tree().visible("button").find(node => node.owner === owner && String(node.handlers.click).includes("#openCreate"));
  assert.ok(open); await f.act(open);
  const tree = f.tree(), dialog = tree.visible("dialog").find(node => node.owner === owner && x.classed(node, "creative-add-dialog"));
  assert.ok(dialog?.port.open);
  assert.ok(tree.visible("input").some(node => x.within(node, dialog) && node.attributes.accept === ".glb,model/gltf-binary"));
  assert.equal(tree.nodes.some(node => x.within(node, dialog) && node.tag === "option" && node.attributes.value === "model3d"), false);
});
