import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { validateModel3dAsset } from "../src/model/model3d-assets.ts";
import { qualifyStaticModel3dAsset, MODEL3D_STATIC_POLICY } from "../src/model/model3d-static-policy.ts";
import { qualifySelectedOutputShareModel3d, copySelectedOutputShareModel3dBytes,
  SELECTED_OUTPUT_SHARE_MODEL3D_POLICY, SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS } from "../src/model/selected-output-share-model3d.ts";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = bytes => ({ sha256: digest(bytes), byteLength: bytes.length });
const qualify = (bytes, expected = facts(bytes)) => qualifySelectedOutputShareModel3d(bytes, expected);
const refused = result => { assert.equal(result.status, "unqualified"); assert.ok(Object.isFrozen(result)); assert.equal(copySelectedOutputShareModel3dBytes(result), null); };

// Same synthetic triangle, JSON-chunk and BIN construction used by native
// model3d-assets/static-policy tests. No retained user or provider asset is read.
function fixture() {
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [], accessors: [] };
  const parts = [];
  const add = (values, type = "VEC3", componentType = 5126, bounds = {}) => {
    const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[componentType], bytes = new Uint8Array(values.length * width), data = new DataView(bytes.buffer);
    values.forEach((value, i) => componentType === 5126 ? data.setFloat32(i * width, value, true) : width === 1 ? data.setUint8(i, value) : width === 2 ? data.setUint16(i * width, value, true) : data.setUint32(i * width, value, true));
    const before = parts.reduce((sum, part) => sum + part.length, 0), offset = Math.ceil(before / 4) * 4;
    if (offset > before) parts.push(new Uint8Array(offset - before));
    parts.push(bytes);
    const bufferView = model.bufferViews.length, index = model.accessors.length;
    model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    model.accessors.push({ bufferView, componentType, count: values.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], type, ...bounds });
    return index;
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", 5126, { min: [0, 0, 0], max: [1, 1, 0] });
  function bytes({ text, trailing = new Uint8Array(), binPadding = 0 } = {}) {
    const rawLength = parts.reduce((sum, part) => sum + part.length, 0) + trailing.length;
    model.buffers[0].byteLength = rawLength;
    const json = new TextEncoder().encode(text?.(model) ?? JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4;
    const binLength = Math.ceil(rawLength / 4) * 4, result = new Uint8Array(28 + jsonLength + binLength), view = new DataView(result.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
    view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
    let at = 28 + jsonLength; for (const part of parts) { result.set(part, at); at += part.length; }
    result.set(trailing, at); result.fill(binPadding, 28 + jsonLength + rawLength);
    return result;
  }
  return { model, add, parts, bytes, primitive: model.meshes[0].primitives[0] };
}

test("native synthetic static triangle qualifies exact bytes with closed facts", async () => {
  const bytes = fixture().bytes(), expected = facts(bytes), result = await qualify(bytes);
  assert.equal(result.status, "qualified"); assert.ok(Object.isFrozen(result));
  assert.deepEqual(result, { status: "qualified", policy: SELECTED_OUTPUT_SHARE_MODEL3D_POLICY,
    staticPolicy: MODEL3D_STATIC_POLICY, mimeType: "model/gltf-binary", ...expected });
  assert.deepEqual(copySelectedOutputShareModel3dBytes(result), bytes);
});
test("the actual native Three.js loader parses the qualified static indexed geometry", async () => {
  const f = fixture(); f.primitive.indices = f.add([0, 1, 2], "SCALAR", 5123);
  f.primitive.attributes.NORMAL = f.add([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  f.model.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0, 1] } }]; f.primitive.material = 0;
  const qualification = await qualify(f.bytes()); assert.equal(qualification.status, "qualified");
  const bytes = copySelectedOutputShareModel3dBytes(qualification), loaded = await new GLTFLoader().parseAsync(bytes.buffer, "");
  const meshes = []; loaded.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
  assert.equal(loaded.scenes.length, 1); assert.equal(meshes.length, 1); assert.equal(loaded.animations.length, 0);
  assert.deepEqual([...meshes[0].geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...meshes[0].geometry.index.array], [0, 1, 2]);
  assert.equal(meshes[0].material.isMeshStandardMaterial, true);
  meshes[0].geometry.dispose(); meshes[0].material.dispose();
});
test("rooted multiple mesh nodes and numeric material factors remain native-preview qualified", async () => {
  const f = fixture(); f.model.nodes = [{ children: [1, 2], translation: [1, 2, 3] }, { mesh: 0 }, { mesh: 1, scale: [2, 2, 2] }];
  f.model.meshes.push(structuredClone(f.model.meshes[0]));
  f.model.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0, 0.5], metallicFactor: 0.1, roughnessFactor: 0.4 },
    emissiveFactor: [0.1, 0.2, 0.3], doubleSided: true, alphaMode: "MASK", alphaCutoff: 0.3 }];
  f.primitive.material = 0; f.model.meshes[1].primitives[0].material = 0;
  const bytes = f.bytes(); assert.equal((await qualifyStaticModel3dAsset(bytes)).status, "qualified");
  assert.equal((await qualify(bytes)).status, "qualified");
});
test("packed float normal and color attributes plus every used indexed vertex qualify", async () => {
  for (const componentType of [5121, 5123, 5125]) {
    const f = fixture(); f.primitive.attributes.NORMAL = f.add([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    f.primitive.attributes.COLOR_0 = f.add([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    f.primitive.indices = f.add([2, 0, 1], "SCALAR", componentType);
    assert.equal((await qualify(f.bytes())).status, "qualified");
  }
});
test("required zero alignment padding between packed index and position views is supported", async () => {
  const f = fixture(); f.primitive.indices = f.add([0, 1, 2], "SCALAR", 5123);
  f.primitive.attributes.NORMAL = f.add([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.equal((await qualify(f.bytes())).status, "qualified");
  f.parts[2][0] = 1; refused(await qualify(f.bytes()));
});
test("capture precedes async digest and returned copies cannot change future reads", async () => {
  const input = fixture().bytes(), before = input.slice(), expected = facts(input), pending = qualify(input, expected);
  input.fill(0); expected.sha256 = "0".repeat(64); expected.byteLength = 1;
  const result = await pending; assert.equal(result.status, "qualified");
  const copy = copySelectedOutputShareModel3dBytes(result); assert.deepEqual(copy, before); copy.fill(9);
  assert.deepEqual(copySelectedOutputShareModel3dBytes(result), before);
});
test("subarray capture excludes surrounding bytes and does not invoke supplied array getters", async () => {
  const bytes = fixture().bytes(), backing = new Uint8Array(bytes.length + 20); backing.fill(97); backing.set(bytes, 7);
  const selected = backing.subarray(7, 7 + bytes.length); let calls = 0;
  for (const key of ["buffer", "byteLength", Symbol.iterator]) Object.defineProperty(selected, key, { get() { calls++; throw Error("unexpected"); } });
  const result = await qualify(selected, facts(bytes)); assert.equal(result.status, "qualified"); assert.equal(calls, 0);
  assert.deepEqual(copySelectedOutputShareModel3dBytes(result), bytes);
});
test("serialized and forged qualifications cannot retrieve any bytes", async () => {
  const result = await qualify(fixture().bytes()); assert.equal(result.status, "qualified");
  for (const fake of [{ ...result }, JSON.parse(JSON.stringify(result)), new Proxy(result, {}), {}, null, 1]) assert.equal(copySelectedOutputShareModel3dBytes(fake), null);
});
test("expected hash and length bind selection exactly", async () => {
  const bytes = fixture().bytes();
  for (const patch of [{ sha256: "0".repeat(64) }, { byteLength: bytes.length + 1 }]) {
    const result = await qualify(bytes, { ...facts(bytes), ...patch }); refused(result); assert.equal(result.reason, "selection_mismatch");
  }
});
test("expected facts reject nondata getters, inheritance, extras and nonfinite lengths", async () => {
  const bytes = fixture().bytes(); let calls = 0;
  const getter = facts(bytes); Object.defineProperty(getter, "sha256", { get() { calls++; return digest(bytes); } });
  for (const value of [getter, Object.create(facts(bytes)), { ...facts(bytes), name: "private" }, { ...facts(bytes), byteLength: NaN },
    { ...facts(bytes), byteLength: 0 }, { ...facts(bytes), byteLength: 1.5 }, { ...facts(bytes), sha256: digest(bytes).toUpperCase() }]) refused(await qualify(bytes, value));
  assert.equal(calls, 0); assert.equal((await qualify(bytes, Object.assign(Object.create(null), facts(bytes)))).status, "qualified");
});
test("shared, detached, subclassed, proxied, oversized and nonbyte input cannot supply bytes", async () => {
  const bytes = fixture().bytes(), detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  class Custom extends Uint8Array {}
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  for (const input of [shared, detached, new Custom(bytes), new Proxy(bytes, {}), bytes.buffer, null, {}, [], new Uint8Array(),
    new Uint8Array(SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS.bytes + 1)]) refused(await qualifySelectedOutputShareModel3d(input, facts(bytes)));
});

for (const [label, select] of [
  ["root", f => f.model], ["asset", f => f.model.asset], ["scene", f => f.model.scenes[0]], ["node", f => f.model.nodes[0]],
  ["mesh", f => f.model.meshes[0]], ["primitive", f => f.primitive], ["buffer", f => f.model.buffers[0]],
  ["view", f => f.model.bufferViews[0]], ["accessor", f => f.model.accessors[0]],
]) test(`${label} metadata remains private even though the native reader accepts it`, async () => {
  const f = fixture(); select(f).extras = { privatePrompt: "SYNTHETIC_PRIVATE_PROMPT" }; const bytes = f.bytes();
  assert.doesNotThrow(() => validateModel3dAsset(bytes)); assert.equal((await qualifyStaticModel3dAsset(bytes)).status, "qualified");
  const result = await qualify(bytes); refused(result); assert.equal(result.reason, "unqualified_metadata");
});
for (const field of ["name", "copyright", "generator", "extensions", "uri", "arbitraryPrivateField"]) {
  test(`asset ${field} cannot carry arbitrary strings`, async () => {
    const f = fixture(); f.model.asset[field] = field === "extensions" ? {} : "SYNTHETIC_PRIVATE_PROMPT"; refused(await qualify(f.bytes()));
  });
}
for (const field of ["images", "textures", "samplers", "animations", "skins", "cameras", "extensionsUsed", "extensionsRequired", "extensions"]) {
  test(`${field} is not silently accepted even when empty`, async () => { const f = fixture(); f.model[field] = field === "extensions" ? {} : []; refused(await qualify(f.bytes())); });
}
test("embedded image and data URI accepted by native inspection cannot bypass the untextured gate", async () => {
  const f = fixture(); f.model.images = [{ uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=" }];
  assert.doesNotThrow(() => validateModel3dAsset(f.bytes())); refused(await qualify(f.bytes()));
});
test("unused native-valid accessor, view, material and opaque BIN tail refuse", async () => {
  for (const mutate of [
    f => f.add([7, 8, 9]),
    f => { f.model.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }]; },
    f => { f.model.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 4 }); f.parts.push(new Uint8Array([1, 2, 3, 4])); },
    f => { f.parts.push(new Uint8Array([1, 2, 3, 4])); },
  ]) {
    const f = fixture(); mutate(f); const bytes = f.bytes(); assert.doesNotThrow(() => validateModel3dAsset(bytes));
    const result = await qualify(bytes); refused(result); assert.equal(result.reason, "unreferenced_data");
  }
});
test("native-valid unused leading and interior binary bytes refuse", async () => {
  const f = fixture(); f.parts.unshift(new Uint8Array([65, 66, 67, 68])); f.model.bufferViews[0].byteOffset = 4;
  const bytes = f.bytes(); assert.doesNotThrow(() => validateModel3dAsset(bytes)); refused(await qualify(bytes));
});
test("native-valid inflated view, interleaved stride and aliased accessors refuse", async () => {
  for (const mutate of [
    f => { f.parts.push(new Uint8Array(4)); f.model.bufferViews[0].byteLength += 4; },
    f => { f.model.bufferViews[0].byteStride = 12; },
    f => { f.model.accessors.push({ ...f.model.accessors[0] }); f.primitive.attributes.NORMAL = 1; },
  ]) { const f = fixture(); mutate(f); assert.doesNotThrow(() => validateModel3dAsset(f.bytes())); refused(await qualify(f.bytes())); }
});
test("an index list cannot leave unreferenced geometry in its position and attribute arrays", async () => {
  const f = fixture(); f.primitive.indices = f.add([0, 1, 1], "SCALAR", 5123);
  assert.doesNotThrow(() => validateModel3dAsset(f.bytes())); const result = await qualify(f.bytes()); refused(result); assert.equal(result.reason, "unreferenced_data");
});
test("unused bounds, custom attributes and inconsistent position bounds refuse", async () => {
  for (const mutate of [
    f => { f.primitive.attributes._PRIVATE_PROMPT = f.add([1, 2, 3, 1, 2, 3, 1, 2, 3]); },
    f => { f.primitive.attributes.NORMAL = f.add([0, 0, 1, 0, 0, 1, 0, 0, 1], "VEC3", 5126, { min: [0, 0, 0] }); },
    f => { f.model.accessors[0].max = [9, 9, 9]; },
  ]) { const f = fixture(); mutate(f); assert.doesNotThrow(() => validateModel3dAsset(f.bytes())); refused(await qualify(f.bytes())); }
});
test("packed index padding must be zero and outside the declared buffer only", async () => {
  const f = fixture(); f.primitive.indices = f.add([0, 1, 2], "SCALAR", 5121);
  assert.equal((await qualify(f.bytes())).status, "qualified"); refused(await qualify(f.bytes({ binPadding: 1 })));
  refused(await qualify(f.bytes({ trailing: new Uint8Array(1) })));
});
test("detached nodes, multiple scene roots and unused meshes cannot pass static preview qualification", async () => {
  for (const mutate of [f => f.model.nodes.push({}), f => { f.model.nodes.push({ mesh: 0 }); f.model.scenes[0].nodes.push(1); },
    f => f.model.meshes.push(structuredClone(f.model.meshes[0]))]) {
    const f = fixture(); mutate(f); const bytes = f.bytes(); assert.doesNotThrow(() => validateModel3dAsset(bytes));
    const result = await qualify(bytes); refused(result); assert.ok(["unsupported_static_preview", "unreferenced_data"].includes(result.reason));
  }
});
test("duplicate keys, escaped keys, ignored whitespace and alternate number encoding cannot hide data in raw JSON", async () => {
  for (const text of [
    model => JSON.stringify(model).replace('"version":"2.0"', '"version":"SYNTHETIC_PRIVATE_PROMPT","version":"2.0"'),
    model => JSON.stringify(model).replace('"version"', '"versi\\u006fn"'),
    model => JSON.stringify(model, null, 2),
    model => JSON.stringify(model).replace('"scene":0', '"scene":0e0'),
    model => JSON.stringify(model) + "    ",
  ]) {
    const bytes = fixture().bytes({ text }); assert.doesNotThrow(() => validateModel3dAsset(bytes));
    const result = await qualify(bytes); refused(result); assert.equal(result.reason, "unqualified_metadata");
  }
});
test("native-invalid framing, lengths, floating geometry and indices still refuse", async () => {
  const header = fixture().bytes(); header[0] = 0;
  const position = fixture(); new DataView(position.parts[0].buffer).setFloat32(0, NaN, true);
  const index = fixture(); index.primitive.indices = index.add([0, 1, 9], "SCALAR", 5123);
  for (const bytes of [header, fixture().bytes().slice(0, -1), position.bytes(), index.bytes()]) {
    const result = await qualify(bytes); refused(result); assert.equal(result.reason, "invalid_glb");
  }
});
test("numeric materials have closed shape and finite rendering ranges", async () => {
  for (const material of [{ name: "private" }, { extras: {} }, { pbrMetallicRoughness: { extras: {} } },
    { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, "private"] } }, { pbrMetallicRoughness: { roughnessFactor: 2 } },
    { emissiveFactor: [-1, 0, 0] }, { alphaMode: "private" }, { alphaCutoff: 0.5 }, { doubleSided: "private" }]) {
    const f = fixture(); f.model.materials = [material]; f.primitive.material = 0; refused(await qualify(f.bytes()));
  }
});
test("qualifier leaves refused original bytes unchanged", async () => {
  const f = fixture(); f.model.extras = { private: "SYNTHETIC_PRIVATE_PROMPT" }; const bytes = f.bytes(), before = bytes.slice();
  refused(await qualify(bytes)); assert.deepEqual(bytes, before);
});
test("reachable empty branches cannot carry unused transforms", async () => {
  const f = fixture(); f.model.nodes = [{ children: [1, 2] }, { mesh: 0 }, { translation: [83, 69, 67] }];
  const bytes = f.bytes(); assert.equal((await qualifyStaticModel3dAsset(bytes)).status, "qualified"); refused(await qualify(bytes));
});
test("matrix transforms remain unsupported because native loader decomposition ignores non-affine cells", async () => {
  const f = fixture(); f.model.nodes[0].matrix = [1, 0, 0, 83, 0, 1, 0, 69, 0, 0, 1, 67, 0, 0, 0, 82];
  const bytes = f.bytes(); assert.doesNotThrow(() => validateModel3dAsset(bytes)); refused(await qualify(bytes));
});
test("nonunit quaternions do not qualify as supported transforms", async () => {
  for (const rotation of [[0, 0, 0, 0], [1, 2, 3, 4]]) { const f = fixture(); f.model.nodes[0].rotation = rotation; refused(await qualify(f.bytes())); }
  const f = fixture(); f.model.nodes[0].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; assert.equal((await qualify(f.bytes())).status, "qualified");
});
test("normal attributes require unit vectors within float tolerance", async () => {
  const f = fixture(); f.primitive.attributes.NORMAL = f.add([9, 0, 0, 9, 0, 0, 9, 0, 0]); refused(await qualify(f.bytes()));
});
test("float vertex color channels stay within glTF's finite zero-to-one range", async () => {
  const f = fixture(); f.primitive.attributes.COLOR_0 = f.add([9, -1, 0, 9, -1, 0, 9, -1, 0]); refused(await qualify(f.bytes()));
});
