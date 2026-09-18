import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GeometryScaleError, scaleModel3dGeometry } from "../src/model/model3d-geometry-edit.ts";
import { MAX_MODEL3D_JSON_BYTES, MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset } from "../src/model/model3d-assets.ts";

// Complete local GLBs exercise binary geometry, not WebGL/camera rendering.
const hash = value => createHash("sha256").update(value).digest("hex");
const triangle = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const pointsBytes = points => {
  const bytes = Buffer.alloc(points.length * 12);
  points.flat().forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
};
function fixture(points = triangle) {
  const bin = pointsBytes(points);
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: points.length, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }] };
  return { model, bin };
}
function glb({ model, bin }, includeBin = true) {
  const json = Buffer.from(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const bytes = Buffer.alloc(20 + jsonLength + (includeBin ? 8 + binLength : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.fill(0x20, 20, 20 + jsonLength); json.copy(bytes, 20);
  if (includeBin) {
    bytes.writeUInt32LE(binLength, 20 + jsonLength); bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
    bin.copy(bytes, 28 + jsonLength);
  }
  return bytes;
}
// Independent output reading: no writer helpers or returned bounds are used.
function decoded(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(8, true), bytes.length); assert.equal(jsonLength % 4, 0);
  const model = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const start = 28 + jsonLength, length = view.getUint32(20 + jsonLength, true);
  assert.equal(view.getUint32(24 + jsonLength, true), 0x004e4942); assert.equal(length % 4, 0); assert.equal(start + length, bytes.length);
  const bin = new Uint8Array(bytes.buffer, bytes.byteOffset + start, length), binary = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const positions = index => {
    const accessor = model.accessors[index], bufferView = model.bufferViews[accessor.bufferView];
    return Array.from({ length: accessor.count }, (_, vertex) => [0, 1, 2].map(axis => binary.getFloat32(
      (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * (bufferView.byteStride ?? 12) + axis * 4, true)));
  };
  return { model, bin, positions };
}
const geometryBounds = points => {
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
};
const refusal = (bytes, factor, code, message) => assert.throws(() => scaleModel3dGeometry(bytes, factor), error => {
  assert.ok(error instanceof GeometryScaleError); assert.equal(error.code, code);
  if (message) assert.match(error.message, message);
  return true;
});

test("uniform factor two changes actual triangle vertices, preserves input and old BIN, and survives repeated scaling", () => {
  const bytes = glb(fixture()), original = decoded(bytes), originalHash = hash(bytes);
  const result = scaleModel3dGeometry(bytes, 2), edited = decoded(result.bytes);
  validateModel3dAsset(result.bytes);
  assert.equal(result.changed, true); assert.equal(result.factor, 2); assert.equal(result.vertexCount, 3); assert.equal(result.positionAccessorCount, 1);
  assert.deepEqual(edited.positions(edited.model.meshes[0].primitives[0].attributes.POSITION), [[0, 0, 0], [2, 0, 0], [0, 2, 0]]);
  assert.deepEqual(result.beforeBounds, { min: [0, 0, 0], max: [1, 1, 0], size: [1, 1, 0] });
  assert.deepEqual(result.afterBounds, { min: [0, 0, 0], max: [2, 2, 0], size: [2, 2, 0] });
  assert.deepEqual(edited.bin.subarray(0, original.bin.length), original.bin);
  assert.deepEqual(edited.model.accessors.slice(0, original.model.accessors.length), original.model.accessors);
  assert.deepEqual(edited.model.bufferViews.slice(0, original.model.bufferViews.length), original.model.bufferViews);
  assert.equal(hash(bytes), originalHash);
  const repeated = scaleModel3dGeometry(result.bytes, 0.5), readRepeated = decoded(repeated.bytes);
  assert.deepEqual(readRepeated.positions(readRepeated.model.meshes[0].primitives[0].attributes.POSITION), triangle);
  assert.deepEqual(readRepeated.bin.subarray(0, edited.bin.length), edited.bin);
  assert.ok(repeated.bytes.length > result.bytes.length, "a later edit retains the entire earlier payload");
});

test("signed non-power-of-two scaling derives bounds from rounded binary values, not declared bounds", () => {
  const bytes = glb(fixture([[-1.1, 2.3, -0.5], [0.2, -3.3, 1.7], [2.5, 1, -2.2]]));
  const holder = Buffer.concat([Buffer.from([91, 92, 93]), bytes, Buffer.from([94, 95])]);
  const input = new Uint8Array(holder.buffer, holder.byteOffset + 3, bytes.length), beforeHash = hash(holder);
  const original = decoded(input), points = original.positions(0), expected = points.map(point => point.map(value => Math.fround(value * 1.1)));
  const result = scaleModel3dGeometry(input, 1.1), edited = decoded(result.bytes), index = edited.model.meshes[0].primitives[0].attributes.POSITION;
  assert.deepEqual(edited.positions(index), expected);
  assert.deepEqual(result.beforeBounds, geometryBounds(points)); assert.deepEqual(result.afterBounds, geometryBounds(expected));
  assert.deepEqual(edited.model.accessors[index].min, result.afterBounds.min); assert.deepEqual(edited.model.accessors[index].max, result.afterBounds.max);
  assert.equal(hash(holder), beforeHash, "a sliced input and its surrounding bytes remain unchanged");
});

test("shared and interleaved POSITION streams preserve normals, UVs, indices and full BIN padding", () => {
  const f = fixture(), bin = Buffer.alloc(111, 0x31);
  triangle.forEach((point, vertex) => {
    [...point, 0, 0, 1, vertex / 2, 0.5].forEach((value, component) => bin.writeFloatLE(value, 12 + vertex * 32 + component * 4));
  });
  bin.set([0, 1, 2], 108); f.bin = bin; f.model.buffers[0].byteLength = bin.length;
  f.model.bufferViews = [{ buffer: 0, byteOffset: 8, byteLength: 100, byteStride: 32, target: 34962 }, { buffer: 0, byteOffset: 108, byteLength: 3, target: 34963 }];
  f.model.accessors = [
    { bufferView: 0, byteOffset: 4, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 0, byteOffset: 16, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 0, byteOffset: 28, componentType: 5126, count: 3, type: "VEC2" },
    { bufferView: 1, componentType: 5121, count: 3, type: "SCALAR" },
  ];
  const primitive = { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, mode: 4 };
  f.model.meshes[0].primitives = [primitive, structuredClone(primitive)];
  f.model.extras = { untouched: { extensions: { KHR_draco_mesh_compression: {} }, animations: "metadata", uri: "not-an-active-resource" } };
  const bytes = glb(f); validateModel3dAsset(bytes); const old = decoded(bytes);
  assert.equal(old.bin.length, 112); assert.equal(old.bin.at(-1), 0);
  const result = scaleModel3dGeometry(bytes, 3), edited = decoded(result.bytes);
  assert.equal(result.positionAccessorCount, 1); assert.equal(result.vertexCount, 3);
  assert.equal(edited.model.accessors.length, 5); assert.equal(edited.model.bufferViews.length, 3);
  assert.equal(edited.model.bufferViews[2].byteOffset, 112, "append after the entire padded BIN, not buffer.byteLength=111");
  assert.deepEqual(edited.bin.subarray(0, old.bin.length), old.bin);
  for (const primitive of edited.model.meshes[0].primitives) {
    assert.deepEqual(primitive, { attributes: { POSITION: 4, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, mode: 4 });
  }
  assert.deepEqual(edited.positions(4), [[0, 0, 0], [3, 0, 0], [0, 3, 0]]);
  assert.deepEqual(edited.model.extras, old.model.extras);
});

test("POSITION aliases with NORMAL and embedded image storage preserve all original data and references", () => {
  const f = fixture();
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=", "base64");
  f.bin = image; f.model.buffers[0].byteLength = image.length;
  f.model.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: image.length });
  f.model.images = [{ bufferView: 1, mimeType: "image/png" }]; f.model.textures = [{ source: 0 }];
  f.model.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.25 } }];
  Object.assign(f.model.meshes[0].primitives[0], { attributes: { POSITION: 0, NORMAL: 0 }, material: 0 });
  const bytes = glb(f); validateModel3dAsset(bytes); const old = decoded(bytes);
  const result = scaleModel3dGeometry(bytes, 0.5), edited = decoded(result.bytes);
  assert.equal(edited.model.meshes[0].primitives[0].attributes.NORMAL, 0);
  assert.equal(edited.model.meshes[0].primitives[0].attributes.POSITION, 1);
  assert.deepEqual(edited.bin.subarray(0, old.bin.length), old.bin);
  for (const key of ["images", "textures", "materials", "nodes", "scenes"]) assert.deepEqual(edited.model[key], old.model[key]);
  assert.deepEqual(edited.positions(1), old.positions(0).map(point => point.map(value => Math.fround(value * 0.5))));
});

test("unit, Float32-ineffective and zero-geometry edits return unchanged independent bytes", () => {
  for (const [points, factor] of [[triangle, 1], [triangle, 1 + Number.EPSILON], [Array.from({ length: 3 }, () => [0, 0, 0]), 2]]) {
    const input = glb(fixture(points)), original = Buffer.from(input), result = scaleModel3dGeometry(input, factor);
    assert.equal(result.changed, false); assert.deepEqual(result.bytes, new Uint8Array(input)); assert.notEqual(result.bytes.buffer, input.buffer);
    assert.deepEqual(result.afterBounds, result.beforeBounds); result.bytes[0] = 0; assert.deepEqual(input, original);
  }
});

test("ArrayBuffer no-ops own their bytes and changed interior vertices count even when outer bounds do not change", () => {
  const source = new Uint8Array(glb(fixture())), result = scaleModel3dGeometry(source.buffer, 1);
  assert.equal(result.changed, false); assert.deepEqual(result.bytes, source); assert.notEqual(result.bytes.buffer, source.buffer);
  result.bytes[0] = 0; assert.equal(source[0], 0x67);
  const input = glb(fixture([[0, 0, 0], [2, 2, 0], [1.5, 1.5, 0]])), edited = scaleModel3dGeometry(input, 1 + 5e-8), output = decoded(edited.bytes);
  assert.equal(edited.changed, true); assert.deepEqual(edited.afterBounds, edited.beforeBounds);
  const actual = output.positions(output.model.meshes[0].primitives[0].attributes.POSITION);
  assert.deepEqual(actual[1], [2, 2, 0]); assert.ok(actual[2][0] > 1.5); assert.equal(actual[2][0], Math.fround(1.5 * (1 + 5e-8)));
});

test("invalid factors and malformed GLBs return typed, bounded refusal categories", () => {
  const bytes = glb(fixture());
  for (const factor of [0, -1, NaN, Infinity, -Infinity, "2", null]) refusal(bytes, factor, "factor");
  refusal(new Uint8Array([0, 1, 2]), 2, "unsupported");
  refusal(null, 2, "unsupported");
});

test("finite scaling refuses Float32 overflow, nonzero underflow and per-accessor extent collapse", () => {
  refusal(glb(fixture([[3.4028234663852886e38, 0, 0], [1, 0, 0], [0, 1, 0]])), 2, "precision", /range/);
  const s = 2 ** -149;
  refusal(glb(fixture([[s, 0, 0], [1, 0, 0], [0, 1, 0]])), 0.25, "precision", /nonzero coordinate/);
  const f = fixture([[s, 1, 0], [2 * s, 1, 0], [s, 2, 0]]), extra = pointsBytes([[1, 1, 0], [2, 1, 0], [1, 2, 0]]);
  f.bin = Buffer.concat([f.bin, extra]); f.model.buffers[0].byteLength = f.bin.length;
  f.model.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 });
  f.model.accessors.push({ ...f.model.accessors[0], bufferView: 1 });
  f.model.meshes.push({ primitives: [{ attributes: { POSITION: 1 }, mode: 4 }] }); f.model.nodes.push({ mesh: 1 }); f.model.scenes[0].nodes.push(1);
  const bytes = glb(f); validateModel3dAsset(bytes);
  assert.notEqual(Math.fround(s * 0.6), 0); assert.equal(Math.fround(s * 0.6), Math.fround(2 * s * 0.6));
  refusal(bytes, 0.6, "precision", /collapses/, "a larger second mesh must not hide the first accessor's collapsed extent");
});

test("static eligibility rejects every nonidentity node transform, including unused nodes", () => {
  for (const transform of [{ translation: [1, 0, 0] }, { scale: [2, 2, 2] }, { rotation: [0, 0, 0, -1] },
    { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1] }]) {
    const f = fixture(); f.model.nodes.push(transform); const bytes = glb(f); validateModel3dAsset(bytes);
    refusal(bytes, 1, "unsupported", /identity/); refusal(bytes, 2, "unsupported", /identity/);
  }
  const f = fixture(); Object.assign(f.model.nodes[0], { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(scaleModel3dGeometry(glb(f), 2).changed, true);
});

test("validated animation, skinning, morph targets and weights refuse without stripping their contents", () => {
  const fixtures = [];
  const animation = fixture(); animation.bin = Buffer.concat([animation.bin, pointsBytes([[0, 1, 2]])]); animation.model.buffers[0].byteLength = animation.bin.length;
  animation.model.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 12 });
  animation.model.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: "SCALAR" });
  animation.model.animations = [{ samplers: [{ input: 1, output: 0 }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }]; fixtures.push(animation);
  const skin = fixture(); skin.model.skins = [{ joints: [0] }]; skin.model.nodes[0].skin = 0; fixtures.push(skin);
  const morph = fixture(); morph.model.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; fixtures.push(morph);
  const meshWeights = fixture(); meshWeights.model.meshes[0].weights = [1]; fixtures.push(meshWeights);
  const nodeWeights = fixture(); nodeWeights.model.nodes[0].weights = [1]; fixtures.push(nodeWeights);
  for (const f of fixtures) {
    const bytes = glb(f), original = hash(bytes); validateModel3dAsset(bytes); refusal(bytes, 2, "unsupported", /static|morph|skinning/); assert.equal(hash(bytes), original);
  }
});

test("active empty extension values and nonempty declarations refuse, while opaque extras survive", () => {
  for (const mutate of [
    model => { model.extensionsUsed = ["KHR_materials_unlit"]; },
    model => { model.extensionsUsed = ["KHR_materials_unlit"]; model.extensionsRequired = ["KHR_materials_unlit"]; },
    model => { model.extensions = { SOME_optional_extension: {} }; },
    model => { model.materials = [{ extensions: { KHR_materials_unlit: {} } }]; },
    model => { model.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } }; },
  ]) {
    const f = fixture(); mutate(f.model); const bytes = glb(f); validateModel3dAsset(bytes); refusal(bytes, 2, "unsupported", /extensions/);
  }
});

test("data URI, implicit and quantized POSITION storage refuse through the supported contract", () => {
  const uri = fixture(); uri.model.buffers[0].uri = "data:application/octet-stream;base64," + uri.bin.toString("base64");
  const uriBytes = glb(uri, false); validateModel3dAsset(uriBytes); refusal(uriBytes, 2, "unsupported", /BIN/);
  const implicit = fixture(); delete implicit.model.accessors[0].bufferView; delete implicit.model.buffers; delete implicit.model.bufferViews;
  const implicitBytes = glb(implicit, false); validateModel3dAsset(implicitBytes); refusal(implicitBytes, 2, "unsupported", /BIN/);
  const quantized = fixture(); quantized.bin = Buffer.alloc(22); triangle.forEach((point, vertex) => point.forEach((value, axis) => quantized.bin.writeUInt16LE(value, vertex * 8 + axis * 2)));
  quantized.model.buffers[0].byteLength = 22; quantized.model.bufferViews[0].byteLength = 22; quantized.model.bufferViews[0].byteStride = 8;
  quantized.model.accessors[0].componentType = 5123; quantized.model.extensionsUsed = ["KHR_mesh_quantization"];
  const quantizedBytes = glb(quantized); validateModel3dAsset(quantizedBytes); refusal(quantizedBytes, 2, "unsupported");
});

test("existing sparse, external-resource and compressed-geometry refusals remain intact", () => {
  for (const mutate of [
    model => { model.accessors[0].sparse = {}; },
    model => { model.images = [{ uri: "https://example.invalid/texture.png" }]; },
    model => { model.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: {} }; },
    model => { model.bufferViews[0].extensions = { EXT_meshopt_compression: {} }; },
  ]) {
    const f = fixture(); mutate(f.model); const bytes = glb(f);
    assert.throws(() => validateModel3dAsset(bytes)); refusal(bytes, 2, "unsupported");
  }
});

test("new accessor metadata and retained repeated-edit payloads cannot exceed GLB limits", () => {
  const metadata = fixture(); metadata.model.extras = { padding: "" };
  metadata.model.extras.padding = "x".repeat(MAX_MODEL3D_JSON_BYTES - 4 - Buffer.byteLength(JSON.stringify(metadata.model)));
  const metadataBytes = glb(metadata); validateModel3dAsset(metadataBytes);
  refusal(metadataBytes, 2, "unsupported", /metadata size/);
  const large = fixture();
  // Leave one aligned block of headroom in the original; a retained POSITION
  // stream plus its new accessor metadata must exceed the same upload limit.
  const fixedJsonLength = Math.ceil(Buffer.byteLength(JSON.stringify({ ...large.model, buffers: [{ byteLength: MAX_MODEL3D_UPLOAD_BYTES }] })) / 4) * 4;
  const length = MAX_MODEL3D_UPLOAD_BYTES - 28 - fixedJsonLength - 4;
  large.bin = Buffer.alloc(length); pointsBytes(triangle).copy(large.bin); large.model.buffers[0].byteLength = length;
  const largeBytes = glb(large); assert.ok(largeBytes.length <= MAX_MODEL3D_UPLOAD_BYTES); validateModel3dAsset(largeBytes);
  refusal(largeBytes, 2, "unsupported", /file or metadata size/);
});
