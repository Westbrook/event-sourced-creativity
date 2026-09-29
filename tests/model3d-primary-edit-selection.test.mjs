import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const imports = registerOutputSourceImports();
let model;
try { model = await import("../src/model/document-artifacts.ts"); } finally { imports.deregister(); }
const file = (name) => ({ url: "/api/media/" + encodeURIComponent("owner/generated/" + name + ".glb"),
  fileName: name + ".glb", mimeType: "model/gltf-binary", fileSize: 100, role: "mesh", format: "glb", sha256: "a".repeat(64) });
const first = file("primary"), second = file("shaded");
const select = (files, mediaUrl) => model.model3dArtifactMediaFile({ kind: "model3d", settings: { model3d_files: files }, ...(mediaUrl === undefined ? {} : { mediaUrl }) });
test("multiple retained GLBs require the exact eligible primary, independent of inventory order", () => {
  for (const primary of [first, second]) for (const files of [[first, second], [second, first]]) {
    assert.deepEqual(select(files, primary.url), primary);
  }
  for (const primary of [undefined, null, "", file("foreign").url]) assert.equal(select([first, second], primary), null);
  assert.equal(select([{ ...first, previewSupported: false }, second], first.url), null);
  assert.equal(select([first, { ...second, previewSupported: false }], second.url), null);
});
test("selection does not relax inventory validation or single-GLB compatibility", () => {
  assert.deepEqual(select([first]), first);
  assert.equal(select([{ ...first, previewSupported: false }]), null);
  assert.equal(select([first, { ...second, url: first.url }], first.url), null);
  assert.equal(select([first, { ...second, sha256: "bad" }], first.url), null);
  assert.equal(select([first, { ...second, url: "https://example.test/foreign.glb" }], first.url), null);
  assert.equal(select([], first.url), null);
});
