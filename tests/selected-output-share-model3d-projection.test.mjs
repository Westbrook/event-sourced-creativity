import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { png, pngChunk, utf8 } from "./output-asset-fixtures.mjs";
import { scaleModel3dGeometry } from "../src/model/model3d-geometry-edit.ts";
import { validateModel3dAsset } from "../src/model/model3d-assets.ts";
import { qualifySelectedOutputShareModel3d, qualifySelectedOutputShareTexturedModel3d } from "../src/model/selected-output-share-model3d.ts";
import { projectSelectedOutputShareModel3d, copyProjectedSelectedOutputShareModel3dBytes } from "../src/model/selected-output-share-model3d-projection.ts";

const POLICY = "selected-output-share-glb-current-view-v1";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = bytes => ({ sha256: digest(bytes), byteLength: bytes.length });
const project = (bytes, expected = facts(bytes)) => projectSelectedOutputShareModel3d(bytes, expected);
const refused = result => {
  assert.equal(result.status, "unqualified"); assert.equal(result.policy, POLICY);
  assert.ok(Object.isFrozen(result)); assert.equal(copyProjectedSelectedOutputShareModel3dBytes(result), null);
};
const appendBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out;
};
function encode(model, bin, text = JSON.stringify(model)) {
  const json = utf8(text), jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(bin.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength);
  return bytes;
}
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(8, true), bytes.length); assert.equal(view.getUint32(24 + jsonLength, true), 0x004e4942);
  const model = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const bin = bytes.slice(28 + jsonLength); assert.equal(bin.length, view.getUint32(20 + jsonLength, true));
  return { model, bin };
}
function fixture({ textured = false, indices, points = [0, 0, 0, 1, 0, 0, 0, 1, 0], normals = false, images } = {}) {
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] };
  const primitive = model.meshes[0].primitives[0]; let bin = new Uint8Array();
  function append(bytes) {
    const offset = Math.ceil(bin.length / 4) * 4, index = model.bufferViews.length;
    bin = appendBytes(bin, new Uint8Array(offset - bin.length), bytes);
    model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); return index;
  }
  function add(values, type = "VEC3", componentType = 5126, bounds = {}) {
    const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[componentType], components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const bytes = new Uint8Array(values.length * width), view = new DataView(bytes.buffer);
    values.forEach((n, i) => componentType === 5126 ? view.setFloat32(i * width, n, true) : width === 1 ? view.setUint8(i, n) : width === 2 ? view.setUint16(i * width, n, true) : view.setUint32(i * width, n, true));
    const index = model.accessors.length; model.accessors.push({ bufferView: append(bytes), componentType, count: values.length / components, type, ...bounds }); return index;
  }
  const min = [0, 1, 2].map(axis => Math.min(...points.filter((_, i) => i % 3 === axis)));
  const max = [0, 1, 2].map(axis => Math.max(...points.filter((_, i) => i % 3 === axis)));
  add(points, "VEC3", 5126, { min, max });
  if (normals || textured) primitive.attributes.NORMAL = add([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  if (indices) primitive.indices = add([2, 0, 1], "SCALAR", indices);
  if (textured) {
    primitive.attributes.TEXCOORD_0 = add([0, 0, 1, 0, 0, 1], "VEC2"); primitive.material = 0;
    model.asset.generator = "Khronos glTF Blender I/O v4.3.47";
    model.scenes[0].name = "Scene"; model.nodes[0].name = "model"; model.meshes[0].name = "model";
    model.materials = [{ name: "model", normalTexture: { index: 0, texCoord: 0 }, pbrMetallicRoughness: {
      baseColorTexture: { index: 1 }, metallicRoughnessTexture: { index: 2 }, baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0.3, roughnessFactor: 0.7 } }];
    model.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33648 }];
    model.textures = [0, 1, 2].map(source => ({ source, sampler: 0 }));
    model.images = (images ?? [png(), png(), png()]).map((image, i) => ({ bufferView: append(image), mimeType: "image/png", name: ["texture_normal", "texture_diffuse", "texture_metallic-texture_roughness"][i] }));
  }
  return { model, add, primitive, bytes() { model.buffers[0].byteLength = bin.length; return encode(model, bin); } };
}
const edited = (options, factors = [2]) => factors.reduce((bytes, factor) => {
  const result = scaleModel3dGeometry(bytes, factor); assert.equal(result.changed, true); return result.bytes;
}, fixture(options).bytes());
const mutate = (bytes, change) => { const content = decode(bytes); change(content); return encode(content.model, content.bin); };

// Independently describe what the current rooted model renders. View/accessor
// indices and offsets are replaced by their exact component bytes; all other
// graph, material, sampler and attribute metadata must remain equal.
function currentRenderData(bytes) {
  const { model, bin } = decode(bytes), copy = structuredClone(model);
  const resource = index => {
    const v = model.bufferViews[index]; return bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  };
  const accessor = index => {
    const value = structuredClone(model.accessors[index]), data = resource(value.bufferView);
    delete value.bufferView; delete value.byteOffset; return { ...value, bytes: data };
  };
  for (const mesh of copy.meshes) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = accessor(primitive.attributes[key]);
    if (primitive.indices !== undefined) primitive.indices = accessor(primitive.indices);
  }
  for (const image of copy.images ?? []) { image.bytes = resource(image.bufferView); delete image.bufferView; }
  delete copy.accessors; delete copy.bufferViews; delete copy.buffers; return copy;
}
async function qualified(bytes, textured = false) {
  const result = await project(bytes); assert.equal(result.status, "qualified", JSON.stringify(result)); assert.equal(result.policy, POLICY);
  assert.deepEqual(result.source, facts(bytes)); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.source)); assert.ok(Object.isFrozen(result.public));
  const out = copyProjectedSelectedOutputShareModel3dBytes(result); assert.ok(out instanceof Uint8Array);
  assert.deepEqual({ sha256: result.public.sha256, byteLength: result.public.byteLength }, facts(out));
  assert.equal(result.public.mimeType, "model/gltf-binary");
  assert.equal(result.public.qualificationPolicy, textured ? "selected-output-share-glb-png-textures-v1" : "selected-output-share-glb-untextured-v1");
  const gate = textured ? qualifySelectedOutputShareTexturedModel3d : qualifySelectedOutputShareModel3d;
  const ordinary = await gate(out, facts(out)); assert.equal(ordinary.status, "qualified");
  assert.equal(result.public.staticPolicy, ordinary.staticPolicy);
  if (textured) assert.equal(result.public.texturePolicy, ordinary.texturePolicy); else assert.equal(result.public.texturePolicy, undefined);
  assert.deepEqual(currentRenderData(out), currentRenderData(bytes)); return { result, out };
}

for (const textured of [false, true]) {
  test(`${textured ? "textured" : "untextured"} native scale becomes a separately identified fully qualified current share copy`, async () => {
    const source = edited({ textured, indices: 5123, normals: true }), before = source.slice();
    const gate = textured ? qualifySelectedOutputShareTexturedModel3d : qualifySelectedOutputShareModel3d;
    const originalGate = await gate(source, facts(source)); assert.equal(originalGate.status, "unqualified"); assert.equal(originalGate.reason, "unreferenced_data");
    const { result, out } = await qualified(source, textured);
    assert.notEqual(result.source.sha256, result.public.sha256); assert.ok(out.length < source.length); assert.deepEqual(source, before);
    const a = decode(source), b = decode(out); assert.equal(b.model.accessors.length, a.model.accessors.length - 1); assert.equal(b.model.bufferViews.length, a.model.bufferViews.length - 1);
    assert.deepEqual(copyProjectedSelectedOutputShareModel3dBytes(await project(source)), out);
  });
  test(`${textured ? "textured" : "untextured"} repeated actual native edits lose every abandoned position stream`, async () => {
    const source = edited({ textured, indices: 5125, normals: true }, [2, 0.5, 1.1, 3]);
    const { out } = await qualified(source, textured), a = decode(source), b = decode(out);
    assert.equal(b.model.accessors.length, a.model.accessors.length - 4); assert.equal(b.model.bufferViews.length, a.model.bufferViews.length - 4);
    assert.equal(a.bin.length - b.bin.length, 4 * 36);
  });
}
for (const componentType of [5121, 5123, 5125]) test(`projection preserves exact ${componentType} index width and values with required zero alignment`, async () => {
  const source = edited({ indices: componentType, normals: true }); const { out } = await qualified(source);
  const { model } = decode(out), primitive = model.meshes[0].primitives[0]; assert.equal(model.accessors[primitive.indices].componentType, componentType);
});
test("already closed current data and supported transforms/materials remain intact", async () => {
  const f = fixture({ indices: 5123, normals: true }); f.model.nodes[0].translation = [1, 2, 3]; f.model.nodes[0].rotation = [0, 0, 0, 1]; f.model.nodes[0].scale = [2, 3, 4];
  f.model.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 0.5], metallicFactor: 0.4, roughnessFactor: 0.2 }, alphaMode: "MASK", alphaCutoff: 0.3, doubleSided: true }]; f.primitive.material = 0;
  await qualified(f.bytes());
});
test("multiple meshes sharing a current accessor preserve primitive references and geometry", async () => {
  const f = fixture({ normals: true, indices: 5123 }); f.model.meshes.push(structuredClone(f.model.meshes[0])); f.model.nodes = [{ children: [1, 2] }, { mesh: 0 }, { mesh: 1 }];
  const source = scaleModel3dGeometry(f.bytes(), 2).bytes; const { out } = await qualified(source), { model } = decode(out);
  assert.equal(model.meshes[0].primitives[0].attributes.POSITION, model.meshes[1].primitives[0].attributes.POSITION);
});
test("multiple unique position streams and color components survive repeated native edit remapping", async () => {
  const f = fixture({ normals: true, indices: 5123 });
  f.primitive.attributes.COLOR_0 = f.add([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0], "VEC4");
  const second = f.add([2, 0, 0, 3, 0, 0, 2, 1, 0], "VEC3", 5126, { min: [2, 0, 0], max: [3, 1, 0] });
  const primitive = structuredClone(f.primitive); primitive.attributes.POSITION = second; f.model.meshes[0].primitives.push(primitive);
  const source = scaleModel3dGeometry(scaleModel3dGeometry(f.bytes(), 2).bytes, 1.1).bytes;
  const { out } = await qualified(source); assert.equal(decode(source).model.accessors.length - decode(out).model.accessors.length, 4);
});
test("a detached second scene root remains outside the unchanged static sharing profile", async () => {
  const f = fixture(); f.model.meshes.push(structuredClone(f.model.meshes[0])); f.model.nodes.push({ mesh: 1 }); f.model.scenes[0].nodes.push(1);
  const result = await project(scaleModel3dGeometry(f.bytes(), 2).bytes); refused(result); assert.equal(result.reason, "unsupported_static_preview");
});
test("many-to-one Float32 scaling leaves identical current copies despite distinguishable predecessor bytes", async () => {
  const tiny = bits => { const buffer = new ArrayBuffer(4), view = new DataView(buffer); view.setUint32(0, bits, true); return view.getFloat32(0, true); };
  const a = edited({ points: [0, 0, 0, 1, 0, 0, tiny(3), 1, 0] }, [0.5]);
  const b = edited({ points: [0, 0, 0, 1, 0, 0, tiny(4), 1, 0] }, [0.5]);
  assert.notEqual(digest(a), digest(b)); assert.deepEqual(currentRenderData(a), currentRenderData(b));
  const pa = await qualified(a), pb = await qualified(b); assert.deepEqual(pa.out, pb.out); assert.equal(pa.result.public.sha256, pb.result.public.sha256);
  assert.notEqual(pa.result.source.sha256, pb.result.source.sha256); assert.equal(decode(pa.out).bin.length, 36);
});
test("signed-zero current components are preserved as bytes", async () => {
  const source = edited({ points: [-0, 0, 0, 1, -0, 0, 0, 1, -0] }); await qualified(source);
});
test("the native Three loader observes the projected current mesh and index data", async () => {
  const source = edited({ indices: 5123, normals: true }, [2, 3]), { out } = await qualified(source);
  const loaded = await new GLTFLoader().parseAsync(out.buffer, ""), meshes = []; loaded.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
  assert.equal(loaded.scenes.length, 1); assert.equal(loaded.animations.length, 0); assert.equal(meshes.length, 1);
  assert.deepEqual([...meshes[0].geometry.attributes.position.array], [0, 0, 0, 6, 0, 0, 0, 6, 0]);
  assert.deepEqual([...meshes[0].geometry.attributes.normal.array], [0, 0, 1, 0, 0, 1, 0, 0, 1]); assert.deepEqual([...meshes[0].geometry.index.array], [2, 0, 1]);
  meshes[0].geometry.dispose(); meshes[0].material.dispose();
});
for (const [label, select] of [
  ["root", x => x.model], ["asset", x => x.model.asset], ["stale accessor", x => x.model.accessors[0]],
  ["stale view", x => x.model.bufferViews[0]], ["active accessor", x => x.model.accessors.at(-1)],
  ["material", x => x.model.materials[0]], ["image", x => x.model.images[0]], ["sampler", x => x.model.samplers[0]],
]) test(`unknown ${label} metadata is refused before any stale-data projection`, async () => {
  const source = mutate(edited({ textured: true }), x => { select(x).extras = { note: "SYNTHETIC_PRIVATE_METADATA" }; });
  const before = source.slice(); refused(await project(source)); assert.deepEqual(source, before);
});
test("stale metadata cannot disappear through duplicate JSON keys or noncanonical encoding", async () => {
  const { model, bin } = decode(edited({}));
  for (const text of [JSON.stringify(model).replace('"version":"2.0"', '"version":"SYNTHETIC_PRIVATE","version":"2.0"'), JSON.stringify(model, null, 2)]) refused(await project(encode(model, bin, text)));
});
for (const [label, change] of [
  ["wrong bounds", x => { x.model.accessors[0].max = [999, 999, 999]; }],
  ["missing bounds", x => { delete x.model.accessors[0].min; }],
  ["normalized", x => { x.model.accessors[0].normalized = false; }],
  ["nonfinite component", x => { new DataView(x.bin.buffer).setFloat32(0, Infinity, true); }],
  ["non-position type", x => { x.model.accessors[0].type = "VEC2"; x.model.accessors[0].count = 4; }],
]) test(`abandoned accessor with ${label} cannot be silently discarded`, async () => refused(await project(mutate(edited({}), change))));
test("unused non-position accessors and orphan views remain refused", async () => {
  const f = fixture(); f.add([0, 1, 0, 1, 0, 1], "VEC2"); refused(await project(scaleModel3dGeometry(f.bytes(), 2).bytes));
  const source = mutate(edited({}), x => { const offset = x.bin.length; x.bin = appendBytes(x.bin, new Uint8Array(4)); x.model.buffers[0].byteLength = x.bin.length; x.model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: 4 }); }); refused(await project(source));
});
test("opaque tails and excessive zero tails are refused even when native framing is valid", async () => {
  for (const tail of [utf8("SYNTHETIC_PRIVATE"), new Uint8Array(4)]) {
    const source = mutate(edited({}), x => { x.bin = appendBytes(x.bin, tail); x.model.buffers[0].byteLength = x.bin.length; });
    assert.doesNotThrow(() => validateModel3dAsset(source)); refused(await project(source));
  }
});
test("nonzero alignment cannot be laundered through native scale history", async () => {
  const source = mutate(edited({ indices: 5121, normals: true }), x => {
    const index = x.model.meshes[0].primitives[0].indices, view = x.model.bufferViews[x.model.accessors[index].bufferView]; x.bin[view.byteOffset + view.byteLength] = 37;
  }); refused(await project(source));
});
test("interleaved original positions remain an explicit compatibility refusal", async () => {
  const base = decode(fixture().bytes()), interleaved = new Uint8Array(48);
  for (let i = 0; i < 3; i++) interleaved.set(base.bin.subarray(i * 12, i * 12 + 12), i * 16);
  base.model.bufferViews[0].byteLength = 48; base.model.bufferViews[0].byteStride = 16; base.model.buffers[0].byteLength = 48;
  const source = scaleModel3dGeometry(encode(base.model, interleaved), 2).bytes; refused(await project(source));
});
test("stale/current view aliasing is refused rather than guessing byte ownership", async () => {
  const source = mutate(edited({}), x => { const current = x.model.meshes[0].primitives[0].attributes.POSITION; x.model.accessors[0] = structuredClone(x.model.accessors[current]); }); refused(await project(source));
});
test("referenced views cannot carry hidden components beyond their exact packed accessor", async () => {
  const source = mutate(edited({}), x => {
    const current = x.model.meshes[0].primitives[0].attributes.POSITION, view = x.model.bufferViews[x.model.accessors[current].bufferView];
    view.byteLength += 4; x.bin = appendBytes(x.bin, utf8("HIDE")); x.model.buffers[0].byteLength = x.bin.length;
  }); refused(await project(source));
});
test("metadata-bearing or corrupt embedded PNGs cannot pass by projecting geometry", async () => {
  const corrupt = png(); corrupt[29] ^= 1;
  for (const image of [corrupt, png({ extraChunks: [pngChunk("tEXt", utf8("Comment\0SYNTHETIC_PRIVATE"))] }), png({ extraChunks: [pngChunk("caBX", utf8("SYNTHETIC_PROVENANCE"))] })]) {
    refused(await project(edited({ textured: true, images: [png(), png(), image] })));
  }
});
test("qualified resolution-only PNG metadata is preserved byte for byte", async () => {
  const extras = [pngChunk("eXIf", new Uint8Array(Buffer.from("4d4d002a00000018000000480000000100000048000000010002011a00050000000100000008011b0005000000010000001000000000", "hex"))),
    pngChunk("oFFs", new Uint8Array(9)), pngChunk("pHYs", new Uint8Array(Buffer.from("00000b1200000b1201", "hex")))];
  await qualified(edited({ textured: true, images: [png(), png(), png({ extraChunks: extras })] }), true);
});
test("malformed accessor counts and out-of-range references cannot trigger unbounded projection", async () => {
  for (const change of [x => { x.model.accessors[0].count = Number.MAX_SAFE_INTEGER; }, x => { x.model.meshes[0].primitives[0].attributes.POSITION = 999999; },
    x => { x.model.bufferViews[0].byteOffset = Number.MAX_SAFE_INTEGER; }]) refused(await project(mutate(edited({}), change)));
});
test("aggregate embedded texture limits remain in force before malformed large PNGs inflate", async () => {
  const image = png({ width: 4096, height: 4096, raw: new Uint8Array(1) });
  const source = edited({ textured: true, images: [image, image, image] }); refused(await project(source));
});
test("selected source hash and length must match before projection", async () => {
  const bytes = edited({});
  for (const patch of [{ sha256: "0".repeat(64) }, { byteLength: bytes.length + 1 }]) {
    const result = await project(bytes, { ...facts(bytes), ...patch }); refused(result); assert.equal(result.reason, "selection_mismatch");
  }
});
test("source bytes and expected facts are captured before the first await", async () => {
  const source = edited({ textured: true }), before = source.slice(), expected = facts(source), pending = project(source, expected);
  source.fill(0); expected.sha256 = "0".repeat(64); expected.byteLength = 1;
  const result = await pending; assert.equal(result.status, "qualified"); assert.deepEqual(result.source, facts(before));
  const out = copyProjectedSelectedOutputShareModel3dBytes(result); assert.deepEqual(currentRenderData(out), currentRenderData(before));
  out.fill(0); assert.equal(digest(copyProjectedSelectedOutputShareModel3dBytes(result)), result.public.sha256);
});
test("subarray selection copies exactly its range without invoking overridden getters", async () => {
  const source = edited({}), backing = new Uint8Array(source.length + 30); backing.fill(83); backing.set(source, 11);
  const selected = backing.subarray(11, 11 + source.length); let calls = 0;
  for (const key of ["buffer", "byteLength", Symbol.iterator]) Object.defineProperty(selected, key, { get() { calls++; throw Error("unexpected getter"); } });
  const result = await project(selected, facts(source)); assert.equal(result.status, "qualified"); assert.deepEqual(result.source, facts(source)); assert.equal(calls, 0);
});
test("forged or serialized results cannot retrieve projected bytes", async () => {
  const result = await project(edited({})); assert.equal(result.status, "qualified");
  for (const fake of [{ ...result }, JSON.parse(JSON.stringify(result)), new Proxy(result, {}), {}, null, 1]) assert.equal(copyProjectedSelectedOutputShareModel3dBytes(fake), null);
});
test("expected-facts getters, inheritance and extra fields are refused without execution", async () => {
  const bytes = edited({}); let calls = 0; const getter = facts(bytes); Object.defineProperty(getter, "sha256", { get() { calls++; return digest(bytes); } });
  for (const expected of [getter, Object.create(facts(bytes)), { ...facts(bytes), private: true }, { ...facts(bytes), byteLength: NaN }]) refused(await project(bytes, expected));
  assert.equal(calls, 0);
});
test("detached, shared, subclassed, proxied and nonbyte inputs cannot provide projection authority", async () => {
  const bytes = edited({}), detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  class Custom extends Uint8Array {}
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  for (const input of [detached, shared, new Custom(bytes), new Proxy(bytes, {}), bytes.buffer, {}, [], null, new Uint8Array()]) refused(await projectSelectedOutputShareModel3d(input, facts(bytes)));
});
