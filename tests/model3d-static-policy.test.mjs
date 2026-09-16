import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset } from "../src/model/model3d-assets.ts";
import { MODEL3D_STATIC_POLICY, qualifyStaticModel3dAsset, inspectTransferredStaticModel3dAsset } from "../src/model/model3d-static-policy.ts";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("consuming inspection detaches aliases and hashes only the exact offset view", async () => {
  const original = fixture().bytes(), expected = hash(original);
  const backing = new Uint8Array(original.length + 16); backing.fill(29); backing.set(original, 8);
  const selected = backing.subarray(8, 8 + original.length);
  Object.defineProperty(selected, 'buffer', {get(){throw Error('supplied getter');}});
  selected[Symbol.iterator] = () => { throw Error('supplied iterator'); };
  const pending = inspectTransferredStaticModel3dAsset(selected, 'model/gltf-binary');
  assert.equal(backing.byteLength, 0); assert.equal(selected.byteLength, 0);
  const result = await pending;
  assert.equal(result.qualification.status, 'qualified'); assert.equal(result.sha256, expected);
  assert.equal(result.byteLength, original.length); assert(Object.isFrozen(result));
  const bad = new Uint8Array([1,2,3]), badHash = hash(bad);
  const unqualified = await inspectTransferredStaticModel3dAsset(bad, 'model/gltf-binary');
  assert.equal(unqualified.qualification.status, 'unqualified'); assert.equal(unqualified.sha256, badHash);
});

test("consuming inspection refuses shared, resizable, subclassed and oversized backing stores", async () => {
  class Custom extends Uint8Array {};
  class CustomBuffer extends ArrayBuffer {};
  const cases = [new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(new ArrayBuffer(8,{maxByteLength:16})),
    new Custom(8), new Uint8Array(new CustomBuffer(8)), new Uint8Array(MAX_MODEL3D_UPLOAD_BYTES + 1).subarray(0,8),
    new Proxy(new Uint8Array(8), {})];
  for (const value of cases) assert.equal(await inspectTransferredStaticModel3dAsset(value, 'model/gltf-binary'), null);
});
// New, synthetic in-memory GLBs. No app fixture, provider file, reference or external resource.
function fixture() {
  const parts = [];
  const model = {
    asset: { version: "2.0" }, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0, 1] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
  const add = (values, type, bounds = {}, componentType = 5126) => {
    const width = componentType === 5121 ? 1 : 4;
    const bytes = new Uint8Array(values.length * width), view = new DataView(bytes.buffer);
    values.forEach((value, index) => componentType === 5121 ? view.setUint8(index, value) : view.setFloat32(index * 4, value, true));
    const at = parts.reduce((sum, part) => sum + part.length, 0);
    const bufferView = model.bufferViews.length, index = model.accessors.length;
    parts.push(bytes);
    model.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
    model.accessors.push({ bufferView, componentType, count: values.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]), type, ...bounds });
    return index;
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", { min: [0, 0, 0], max: [1, 1, 0] });
  const bytes = () => {
    const binLength = parts.reduce((sum, part) => sum + part.length, 0);
    model.buffers[0].byteLength = binLength;
    const json = new TextEncoder().encode(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4;
    const result = new Uint8Array(12 + 8 + jsonLength + 8 + binLength), view = new DataView(result.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
    result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
    const binAt = 20 + jsonLength;
    view.setUint32(binAt, binLength, true); view.setUint32(binAt + 4, 0x004e4942, true);
    let at = binAt + 8;
    for (const part of parts) { result.set(part, at); at += part.length; }
    return result;
  };
  return { model, add, bytes };
}
async function refused(bytes, reason) {
  const result = await qualifyStaticModel3dAsset(bytes);
  assert.deepEqual(result, { status: "unqualified", policy: MODEL3D_STATIC_POLICY, reason });
  assert.ok(Object.isFrozen(result));
}
async function generallyValidButRefused(make, reason) {
  const f = fixture(); make(f);
  const bytes = f.bytes();
  assert.doesNotThrow(() => validateModel3dAsset(bytes));
  await refused(bytes, reason);
}

test("static rooted assembly permits multiple meshes, primitives and materials, not semantic object proof", async () => {
  const f = fixture();
  f.model.nodes = [{ children: [1, 2], translation: [1, 2, 3] }, { mesh: 0 }, { mesh: 1, scale: [2, 2, 2] }];
  f.model.materials.push({ extensions: { KHR_materials_unlit: {} } });
  f.model.extensionsUsed = ["KHR_materials_unlit"];
  f.model.meshes[0].primitives.push({ attributes: { POSITION: 0 }, material: 1 });
  f.model.meshes.push({ primitives: [{ attributes: { POSITION: 0 }, material: 1 }] });
  const bytes = f.bytes(), result = await qualifyStaticModel3dAsset(bytes);
  assert.deepEqual(result, {
    status: "qualified", policy: MODEL3D_STATIC_POLICY, sha256: hash(bytes), byteLength: bytes.length,
    sceneIndex: 0, rootNodeIndex: 0, nodeCount: 3, meshNodeCount: 2, meshDefinitionCount: 2,
    primitiveDefinitionCount: 3, materialDefinitionCount: 2, semanticObjectCount: "unverified",
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(Object.hasOwn(result, "singleObject"), false);
  assert.equal(Object.hasOwn(result, "approved"), false);
  assert.equal(Object.hasOwn(result, "reference"), false);
});

test("valid animation tracks remain accepted generally but cannot qualify as static", async () => {
  await generallyValidButRefused(f => {
    const input = f.add([0, 1], "SCALAR"), output = f.add([0, 0, 0, 1, 0, 0], "VEC3");
    f.model.animations = [{ samplers: [{ input, output }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }];
  }, "animations");
});

test("valid skeleton/skin and latent joint attributes remain general-only", async () => {
  await generallyValidButRefused(f => {
    f.model.nodes = [{ children: [1, 2] }, { mesh: 0, skin: 0 }, {}];
    f.model.skins = [{ joints: [2], skeleton: 2 }];
    f.model.meshes[0].primitives[0].attributes.JOINTS_0 = f.add(Array(12).fill(0), "VEC4", {}, 5121);
    f.model.meshes[0].primitives[0].attributes.WEIGHTS_0 = f.add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4");
  }, "skins");
  await generallyValidButRefused(f => {
    f.model.meshes[0].primitives[0].attributes.WEIGHTS_0 = f.add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4");
  }, "skins");
});

test("morph targets, weights and GPU instances cannot qualify as an ordinary static assembly", async () => {
  await generallyValidButRefused(f => { f.model.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; }, "morph_targets");
  await generallyValidButRefused(f => { f.model.meshes[0].weights = [0]; }, "morph_targets");
  await generallyValidButRefused(f => { f.model.nodes[0].weights = [0]; }, "morph_targets");
  await generallyValidButRefused(f => {
    f.model.extensionsUsed = ["EXT_mesh_gpu_instancing"];
    f.model.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } };
  }, "instancing");
});

test("one selected rooted assembly is required; a primitive is not an object counter", async () => {
  for (const mutate of [
    f => { f.model.nodes.push({ mesh: 0 }); f.model.scenes[0].nodes.push(1); },
    f => { f.model.scenes.push({ nodes: [0] }); },
    f => { f.model.nodes.push({ mesh: 0 }); },
    f => { f.model.meshes.push(structuredClone(f.model.meshes[0])); },
    f => { f.model.scenes[0].nodes = []; },
    f => { delete f.model.scenes; delete f.model.scene; },
  ]) await generallyValidButRefused(mutate, "scene_assembly");
  const f = fixture();
  // Two disconnected triangles in one primitive can still be two semantic objects.
  f.model.meshes[0].primitives[0].attributes.POSITION = f.add(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0],
    "VEC3", { min: [0, 0, 0], max: [11, 1, 0] },
  );
  delete f.model.scene;
  const result = await qualifyStaticModel3dAsset(f.bytes());
  assert.equal(result.status, "qualified");
  assert.equal(result.primitiveDefinitionCount, 1);
  assert.equal(result.semanticObjectCount, "unverified");
});

test("unknown optional extensions fail closed; inert extras do not acquire rendering semantics", async () => {
  await generallyValidButRefused(f => { f.model.extensionsUsed = ["VENDOR_animation_behavior"]; }, "unsupported_extension");
  await generallyValidButRefused(f => { f.model.nodes[0].extensions = { VENDOR_animation_behavior: {} }; }, "unsupported_extension");
  const f = fixture();
  f.model.extras = { animations: [{}], extensions: { VENDOR_animation_behavior: {} }, url: "https://inert.invalid/metadata" };
  assert.equal((await qualifyStaticModel3dAsset(f.bytes())).status, "qualified");
});

test("large generally accepted array is iterated without argument-spread RangeError", async () => {
  const f = fixture();
  f.model.vendorData = Array(150_000).fill(0);
  const bytes = f.bytes();
  assert.doesNotThrow(() => validateModel3dAsset(bytes));
  const result = await qualifyStaticModel3dAsset(bytes);
  assert.equal(result.status, "qualified");
  assert.equal(result.sha256, hash(bytes));
});

test("general framing, MIME, finite geometry and self-contained resource guards remain mandatory", async () => {
  await refused(new Uint8Array([1, 2, 3]), "invalid_glb");
  const f = fixture();
  f.model.images = [{ uri: "https://unowned.invalid/image.png" }];
  await refused(f.bytes(), "invalid_glb");
  const invalid = fixture();
  invalid.model.bufferViews[0].byteOffset = 999999;
  await refused(invalid.bytes(), "invalid_glb");
  const nonfinite = fixture();
  nonfinite.model.meshes[0].primitives[0].attributes.POSITION = nonfinite.add([NaN, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", { min: [0, 0, 0], max: [1, 1, 0] });
  await refused(nonfinite.bytes(), "invalid_glb");
  assert.equal((await qualifyStaticModel3dAsset(fixture().bytes(), "image/png")).reason, "invalid_glb");
});

test("private byte snapshot binds exact hash despite caller mutation, accessors and custom iterator", async () => {
  const bytes = fixture().bytes(), expected = hash(bytes);
  let invoked = 0;
  Object.defineProperty(bytes, Symbol.iterator, { value() { invoked++; throw Error("must not iterate input"); } });
  Object.defineProperty(bytes, "byteLength", { get() { invoked++; throw Error("must not read own getter"); } });
  const pending = qualifyStaticModel3dAsset(bytes);
  bytes.fill(0);
  const result = await pending;
  assert.equal(result.status, "qualified");
  assert.equal(result.sha256, expected);
  assert.equal(invoked, 0);
  const original = fixture().bytes();
  assert.equal((await qualifyStaticModel3dAsset(original.buffer)).sha256, hash(original));
  const slice = new Uint8Array(original.length + 16);
  slice.set(original, 8);
  assert.equal((await qualifyStaticModel3dAsset(slice.subarray(8, 8 + original.length))).sha256, hash(original));
});

test("metadata, URLs, owned-reference assertions and coercion cannot substitute for exact asset bytes", async () => {
  const bytes = fixture().bytes(), sha256 = hash(bytes);
  for (const input of [
    "/api/media/owned-but-not-read.glb", "https://unowned.invalid/mesh.glb",
    { bytes, sha256, owned: true, rightsConfirmed: true, modelView: { version: 1 } },
    { file: { sha256, mimeType: "model/gltf-binary" }, referenceId: "claimed", approved: true },
    [], null, new SharedArrayBuffer(16), new Uint8Array(new SharedArrayBuffer(16)),
    new Uint8Array(MAX_MODEL3D_UPLOAD_BYTES + 1),
  ]) await refused(input, "invalid_bytes");
  let coerced = 0;
  const mimeType = { toString() { coerced++; return "model/gltf-binary"; } };
  const result = await qualifyStaticModel3dAsset(bytes, mimeType);
  assert.equal(result.reason, "invalid_glb");
  assert.equal(coerced, 0);
  // This slice deliberately has no rights/adoption result: authoritative reference
  // admission still belongs to the unchanged Worker source/custody path.
});
