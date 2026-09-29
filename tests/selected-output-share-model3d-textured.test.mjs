import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { png, pngChunk, utf8 } from "./output-asset-fixtures.mjs";
import { validateModel3dAsset } from "../src/model/model3d-assets.ts";
import { qualifySelectedOutputShareModel3d, qualifySelectedOutputShareTexturedModel3d,
  copySelectedOutputShareModel3dBytes, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY } from "../src/model/selected-output-share-model3d.ts";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = bytes => ({ sha256: digest(bytes), byteLength: bytes.length });
const qualify = (bytes, expected = facts(bytes)) => qualifySelectedOutputShareTexturedModel3d(bytes, expected);
const refused = result => { assert.equal(result.status, "unqualified"); assert.equal(copySelectedOutputShareModel3dBytes(result), null); };
const labels = ["texture_normal", "texture_diffuse", "texture_metallic-texture_roughness"];
function fixture({ images = [png(), png(), png()], declaredPadding = false } = {}) {
  const model = { asset: { version: "2.0", generator: "Khronos glTF Blender I/O v4.3.47" }, scene: 0,
    scenes: [{ name: "Scene", nodes: [0] }], nodes: [{ mesh: 0, name: "model" }],
    meshes: [{ name: "model", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: "model", normalTexture: { index: 0 }, pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicRoughnessTexture: { index: 2 } } }],
    textures: images.map((_, source) => ({ source, sampler: 0 })),
    images: [], samplers: [{ magFilter: 9729, minFilter: 9987 }], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] };
  const parts = [];
  const append = bytes => {
    const used = parts.reduce((sum, part) => sum + part.length, 0), offset = Math.ceil(used / 4) * 4;
    if (used !== offset) parts.push(new Uint8Array(offset - used));
    const index = model.bufferViews.length; parts.push(bytes); model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); return index;
  };
  const add = (values, components, type, integer = false, bounds = {}) => {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, i) => integer ? view.setUint32(i * 4, value, true) : view.setFloat32(i * 4, value, true));
    const bufferView = append(bytes); model.accessors.push({ bufferView, componentType: integer ? 5125 : 5126, count: values.length / components, type, ...bounds });
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], 3, "VEC3", false, { min: [0, 0, 0], max: [1, 1, 0] });
  add([0, 0, 1, 0, 0, 1, 0, 0, 1], 3, "VEC3"); add([0, 0, 1, 0, 0, 1], 2, "VEC2"); add([0, 1, 2], 1, "SCALAR", true);
  images.forEach((image, i) => model.images.push({ bufferView: append(image), mimeType: "image/png", name: labels[i] }));
  function bytes({ tail = new Uint8Array(), jsonText } = {}) {
    const used = parts.reduce((sum, part) => sum + part.length, 0), rawLength = used + tail.length, binLength = Math.ceil(rawLength / 4) * 4;
    model.buffers[0].byteLength = declaredPadding ? binLength : rawLength;
    const json = utf8(jsonText?.(model) ?? JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4;
    const result = new Uint8Array(28 + jsonLength + binLength), view = new DataView(result.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
    view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
    let at = 28 + jsonLength; for (const part of parts) { result.set(part, at); at += part.length; } result.set(tail, at);
    return result;
  }
  return { model, parts, append, bytes, primitive: model.meshes[0].primitives[0] };
}
test("closed three-PNG material graph qualifies exact bytes under its explicit textured policy", async () => {
  const bytes = fixture().bytes(), expected = facts(bytes), result = await qualify(bytes);
  assert.equal(result.status, "qualified"); assert.equal(result.policy, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY);
  assert.equal(result.texturePolicy, "selected-output-share-png-resolution-v1");
  assert.equal(result.sha256, expected.sha256); assert.ok(Object.isFrozen(result)); assert.deepEqual(copySelectedOutputShareModel3dBytes(result), bytes);
  refused(await qualifySelectedOutputShareModel3d(bytes, expected));
});
test("finite generic labels can be absent and explicit UV0 remains supported", async () => {
  const f = fixture(); delete f.model.asset.generator;
  for (const values of [f.model.scenes, f.model.nodes, f.model.meshes, f.model.materials, f.model.images]) for (const value of values) delete value.name;
  f.model.materials[0].normalTexture.texCoord = 0;
  assert.equal((await qualify(f.bytes())).status, "qualified");
});
test("each material texture role remains optional when its entire unused resource graph is absent", async () => {
  for (const keep of [0, 1, 2]) {
    const f = fixture({ images: [png()] });
    f.model.images[0].name = labels[keep];
    f.model.materials[0] = keep === 0 ? { normalTexture: { index: 0 } } : { pbrMetallicRoughness: { [keep === 1 ? "baseColorTexture" : "metallicRoughnessTexture"]: { index: 0 } } };
    assert.equal((await qualify(f.bytes())).status, "qualified");
  }
});
test("only exact required final zero alignment can be inside the declared buffer", async () => {
  const f = fixture({ declaredPadding: true }); assert.equal((await qualify(f.bytes())).status, "qualified");
  refused(await qualify(f.bytes({ tail: new Uint8Array(4) })));
  refused(await qualify(f.bytes({ tail: new Uint8Array([1]) })));
});
for (const [label, mutate] of [
  ["unused texture", f => f.model.textures.push({ source: 0, sampler: 0 })],
  ["unused image", f => f.model.images.push({ ...f.model.images[0] })],
  ["unused sampler", f => f.model.samplers.push({})],
  ["alias image", f => { f.model.textures[2].source = 1; }],
  ["alias image view", f => { f.model.images[2].bufferView = f.model.images[1].bufferView; }],
  ["missing UV", f => { delete f.primitive.attributes.TEXCOORD_0; }],
  ["alternate UV set", f => { f.model.materials[0].normalTexture.texCoord = 1; }],
  ["missing source", f => { delete f.model.textures[0].source; }],
  ["out-of-range texture", f => { f.model.materials[0].normalTexture.index = 8; }],
  ["one image serving different roles", f => { f.model.materials[0].normalTexture.index = 1; }],
]) test(`${label} cannot masquerade as a fully consumed render graph`, async () => { const f = fixture(); mutate(f); refused(await qualify(f.bytes())); });
for (const [label, select] of [["texture", f => f.model.textures[0]], ["image", f => f.model.images[0]],
  ["sampler", f => f.model.samplers[0]], ["texture reference", f => f.model.materials[0].normalTexture]]) {
  test(`${label} cannot carry arbitrary hidden metadata`, async () => { const f = fixture(); select(f).extras = { private: "SYNTHETIC_PRIVATE_PROMPT" }; refused(await qualify(f.bytes())); });
}
test("arbitrary or mismatched exporter labels are refused without normalization", async () => {
  for (const change of [f => { f.model.asset.generator += " private"; }, f => { f.model.nodes[0].name = "private"; },
    f => { f.model.images[0].name = labels[1]; }, f => { f.model.meshes[0].name = "model-42"; }]) {
    const f = fixture(); change(f); const bytes = f.bytes(), original = bytes.slice(); refused(await qualify(bytes)); assert.deepEqual(bytes, original);
  }
});
test("every PNG's metadata, CRC and compressed data must pass the existing PNG gate", async () => {
  const privatePng = png({ extraChunks: [pngChunk("tEXt", utf8("Comment\0SYNTHETIC_PRIVATE_PROMPT"))] }), corrupt = png(); corrupt[29] ^= 1;
  for (const bad of [privatePng, corrupt, png({ raw: new Uint8Array(1) })]) {
    const f = fixture({ images: [png(), png(), bad] }); const bytes = f.bytes(); assert.doesNotThrow(() => validateModel3dAsset(bytes)); refused(await qualify(bytes));
  }
});
test("exact resolution-only texture metadata qualifies through the independently reviewed PNG profile", async () => {
  const extras = [pngChunk("eXIf", new Uint8Array(Buffer.from("4d4d002a00000018000000480000000100000048000000010002011a00050000000100000008011b0005000000010000001000000000", "hex"))),
    pngChunk("oFFs", new Uint8Array(9)), pngChunk("pHYs", new Uint8Array(Buffer.from("00000b1200000b1201", "hex")))];
  const f = fixture({ images: [png(), png(), png({ extraChunks: extras })] }), bytes = f.bytes();
  const result = await qualify(bytes); assert.equal(result.status, "qualified"); assert.equal(result.texturePolicy, "selected-output-share-png-resolution-v1");
  assert.deepEqual(copySelectedOutputShareModel3dBytes(result), bytes);
  refused(await qualifySelectedOutputShareModel3d(bytes, facts(bytes)));
});
test("C2PA and arbitrary resolution payloads still cannot enter through a texture image", async () => {
  for (const chunk of [pngChunk("caBX", utf8("UNKNOWN_SYNTHETIC_PROVENANCE")), pngChunk("eXIf", utf8("SYNTHETIC_PRIVATE_PROMPT"))]) {
    const f = fixture({ images: [png(), png(), png({ extraChunks: [chunk] })] }); refused(await qualify(f.bytes()));
  }
});
test("pixel-budget refusal happens before inflate and permits no package-sized decompression expansion", async () => {
  const image = png({ width: 4096, height: 4096, raw: new Uint8Array(1) }), f = fixture({ images: [image, image, image] });
  // Native framing accepts these image headers; 3x16.7M pixels exceed this gate's
  // aggregate32M budget before compressed body validation is reached.
  assert.doesNotThrow(() => validateModel3dAsset(f.bytes()));
  const result = await qualify(f.bytes()); refused(result); assert.equal(result.reason, "unsupported_geometry");
});
test("the package accepts eight fully reached textures and refuses nine before image decoding", async () => {
  for (const count of [8, 9]) {
    const f = fixture({ images: Array.from({ length: count }, () => png()) }); f.model.materials = []; f.model.meshes[0].primitives = [];
    for (let index = 0; index < count; index += 3) {
      const material = { pbrMetallicRoughness: {} }, materialIndex = f.model.materials.length;
      for (let role = 0; role < 3 && index + role < count; role++) {
        const reference = { index: index + role }; f.model.images[index + role].name = labels[role];
        if (role === 0) material.normalTexture = reference;
        else material.pbrMetallicRoughness[role === 1 ? "baseColorTexture" : "metallicRoughnessTexture"] = reference;
      }
      f.model.materials.push(material); f.model.meshes[0].primitives.push({ ...f.primitive, material: materialIndex });
    }
    const result = await qualify(f.bytes()); assert.equal(result.status, count === 8 ? "qualified" : "unqualified");
  }
});
test("top-level digest mismatch refuses before reaching bad embedded PNG compressed data", async () => {
  const f = fixture({ images: [png(), png(), png({ raw: new Uint8Array(1) })] }), bytes = f.bytes();
  const result = await qualify(bytes, { ...facts(bytes), sha256: "0".repeat(64) }); refused(result); assert.equal(result.reason, "selection_mismatch");
});
test("top-level selection identity and private snapshot bind all embedded image slices", async () => {
  const bytes = fixture().bytes(), expected = facts(bytes), original = bytes.slice(), pending = qualify(bytes, expected);
  bytes.fill(0); expected.sha256 = "0".repeat(64); const result = await pending; assert.equal(result.status, "qualified");
  const returned = copySelectedOutputShareModel3dBytes(result); assert.deepEqual(returned, original); returned.fill(0);
  assert.deepEqual(copySelectedOutputShareModel3dBytes(result), original);
  refused(await qualify(original, { ...facts(original), sha256: "0".repeat(64) }));
  assert.equal(copySelectedOutputShareModel3dBytes({ ...result }), null);
});
test("unused data and parser normalization remain excluded by the original shared graph checks", async () => {
  const f = fixture(); refused(await qualify(f.bytes({ tail: utf8("PRIVATE_PAYLOAD") })));
  refused(await qualify(f.bytes({ jsonText: model => JSON.stringify(model).replace('"generator":', '"generator":"private","generator":') })));
});
