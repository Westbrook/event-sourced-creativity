import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MODEL3D_UPLOAD_BYTES,
  model3dMimeType,
  validateModel3dAsset,
} from "../src/model/model3d-assets.ts";

const GLB_MIME = "model/gltf-binary";
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const EMBEDDED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=";

function triangleJson() {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
  };
}

function triangleBinary() {
  const binary = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  return binary;
}

function chunk(type, bytes) {
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const result = Buffer.alloc(8 + paddedLength, type === JSON_CHUNK ? 0x20 : 0);
  result.writeUInt32LE(paddedLength, 0);
  result.writeUInt32LE(type, 4);
  Buffer.from(bytes).copy(result, 8);
  return result;
}

function glbFromChunks(chunks) {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

function glb(json = triangleJson(), binary = triangleBinary()) {
  return glbFromChunks([
    chunk(JSON_CHUNK, Buffer.from(JSON.stringify(json))),
    chunk(BIN_CHUNK, binary),
  ]);
}

test("an embedded triangle is accepted as a GLB and retains its validated document", () => {
  const json = triangleJson();
  const bytes = glb(json);
  for (const input of [bytes, new Uint8Array(bytes).buffer]) {
    const result = validateModel3dAsset(input, GLB_MIME);
    assert.equal(result.mimeType, GLB_MIME);
    assert.equal(result.format, "glb");
    assert.equal(result.byteLength, bytes.byteLength);
    assert.deepEqual(result.json, json);
  }

  const padded = new Uint8Array(bytes.byteLength + 11);
  padded.set(bytes, 7);
  assert.deepEqual(validateModel3dAsset(padded.subarray(7, 7 + bytes.byteLength)).json, json,
    "validation uses the uploaded view's byte offset and length, not the whole backing buffer");
});

test("GLB upload detection accepts browser MIME fallbacks without overriding a conflicting MIME", () => {
  for (const file of [
    { name: "sculpture.glb", type: GLB_MIME },
    { name: "opaque-upload", type: GLB_MIME },
    { name: "sculpture.glb", type: "" },
    { name: "SCULPTURE.GLB", type: "application/octet-stream" },
  ]) assert.equal(model3dMimeType(file), GLB_MIME, JSON.stringify(file));

  for (const file of [
    { name: "sculpture.glb", type: "image/png" },
    { name: "sculpture.glb", type: "text/html" },
    { name: "sculpture.gltf", type: "model/gltf+json" },
    { name: "sculpture.obj", type: "application/octet-stream" },
    { name: "sculpture.glb.exe", type: "" },
    { name: "opaque-upload", type: "application/octet-stream" },
  ]) assert.ok(!model3dMimeType(file), JSON.stringify(file));
});

test("the model upload limit is enforced before parsing an oversized payload", () => {
  assert.equal(MAX_MODEL3D_UPLOAD_BYTES, 64 * 1024 * 1024);
  const oversized = new Uint8Array(MAX_MODEL3D_UPLOAD_BYTES + 1);
  assert.throws(() => validateModel3dAsset(oversized, GLB_MIME), /64|large|size|limit/i);
});

test("malformed GLB headers and truncated chunks fail with an actionable file error", () => {
  const invalidMagic = glb();
  invalidMagic.writeUInt32LE(0, 0);
  const invalidVersion = glb();
  invalidVersion.writeUInt32LE(1, 4);
  const incorrectLength = glb();
  incorrectLength.writeUInt32LE(incorrectLength.byteLength + 4, 8);
  const truncatedJson = glb().subarray(0, 28);
  truncatedJson.writeUInt32LE(truncatedJson.byteLength, 8);
  const unalignedJson = glb();
  unalignedJson.writeUInt32LE(unalignedJson.readUInt32LE(12) - 1, 12);

  for (const [description, bytes] of [
    ["short header", new Uint8Array(8)],
    ["wrong magic", invalidMagic],
    ["unsupported GLB version", invalidVersion],
    ["declared length differs from upload", incorrectLength],
    ["JSON chunk extends beyond upload", truncatedJson],
    ["JSON chunk has no four-byte alignment", unalignedJson],
    ["BIN chunk appears before JSON", glbFromChunks([
      chunk(BIN_CHUNK, triangleBinary()),
      chunk(JSON_CHUNK, Buffer.from(JSON.stringify(triangleJson()))),
    ])],
  ]) assert.throws(() => validateModel3dAsset(bytes, GLB_MIME), /glb|gltf|file|chunk|header|version|length|align/i, description);
});

test("invalid JSON and unsupported glTF versions are rejected before a viewer receives them", () => {
  const brokenJson = glbFromChunks([
    chunk(JSON_CHUNK, Buffer.from('{"asset":{"version":"2.0"},')),
    chunk(BIN_CHUNK, triangleBinary()),
  ]);
  assert.throws(() => validateModel3dAsset(brokenJson), /json|glb|gltf|file/i);
  assert.throws(() => validateModel3dAsset(glb([])), /json|document|object|asset|gltf|glb/i);

  const oldVersion = triangleJson();
  oldVersion.asset.version = "1.0";
  assert.throws(() => validateModel3dAsset(glb(oldVersion)), /version|2\.0|gltf|glb/i);
});

test("JSON size and nesting limits bound the work required to inspect an upload", () => {
  const oversizedJson = triangleJson();
  oversizedJson.extras = { description: "x".repeat(2 * 1024 * 1024) };
  assert.throws(() => validateModel3dAsset(glb(oversizedJson)), /json|large|size|limit/i);

  const deepJson = triangleJson();
  let current = {};
  deepJson.extras = current;
  for (let index = 0; index < 70; index += 1) {
    current.child = {};
    current = current.child;
  }
  assert.throws(() => validateModel3dAsset(glb(deepJson)), /depth|nest|complex|limit/i);
});

test("embedded image resources can be used without contacting another origin", () => {
  const json = triangleJson();
  json.images = [{ uri: EMBEDDED_PNG }];
  const result = validateModel3dAsset(glb(json));
  assert.deepEqual(result.json.images, json.images);
});

test("external image resources cannot turn a model preview into a network or local file request", () => {
  for (const uri of [
    "https://untrusted.example/track.png",
    "http://127.0.0.1/private.png",
    "//untrusted.example/track.png",
    "/api/private/image",
    "textures/albedo.png",
    "file:///etc/passwd",
    "blob:https://untrusted.example/opaque",
  ]) {
    const json = triangleJson();
    json.images = [{ uri }];
    assert.throws(() => validateModel3dAsset(glb(json)), /embed|self.contain|external|resource|uri|texture/i, uri);
  }
});

test("unsafe or malformed data URIs are rejected while safe base64 images remain supported", () => {
  for (const uri of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
    "data:image/png,not-base64",
    "data:image/png;base64,%%%",
  ]) {
    const json = triangleJson();
    json.images = [{ uri }];
    assert.throws(() => validateModel3dAsset(glb(json)), /embed|base64|image|resource|uri|texture|supported/i, uri);
  }
});

test("external buffers and missing embedded buffer bytes are rejected", () => {
  const externalBuffer = triangleJson();
  externalBuffer.buffers[0].uri = "https://untrusted.example/geometry.bin";
  assert.throws(() => validateModel3dAsset(glb(externalBuffer)), /embed|external|buffer|resource|uri/i);

  const extraBuffer = triangleJson();
  extraBuffer.buffers.push({ byteLength: 4, uri: "data:application/octet-stream;base64,AAAAAA==" });
  assert.throws(() => validateModel3dAsset(glb(extraBuffer)), /single|one|buffer|embed|complex/i);

  const missingBytes = triangleJson();
  missingBytes.buffers[0].byteLength = 40;
  assert.throws(() => validateModel3dAsset(glb(missingBytes)), /glb|buffer|bin|length|range|bounds/i);

  const missingBin = glbFromChunks([chunk(JSON_CHUNK, Buffer.from(JSON.stringify(triangleJson())))]);
  assert.throws(() => validateModel3dAsset(missingBin), /glb|buffer|bin|embed|chunk/i);
});

test("required unknown extensions and unavailable geometry or texture decoders fail before rendering", () => {
  const requiredUnknown = triangleJson();
  requiredUnknown.extensionsUsed = ["VENDOR_unavailable_extension"];
  requiredUnknown.extensionsRequired = ["VENDOR_unavailable_extension"];
  assert.throws(() => validateModel3dAsset(glb(requiredUnknown)), /extension|support/i);

  for (const extension of ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]) {
    const json = triangleJson();
    json.extensionsUsed = [extension];
    json.extensionsRequired = [extension];
    assert.throws(() => validateModel3dAsset(glb(json)), /extension|compress|decoder|draco|meshopt|ktx|basis|support/i, extension);
  }
});

test("buffer views cannot read outside the embedded buffer", () => {
  for (const [description, view] of [
    ["oversized view", { buffer: 0, byteOffset: 0, byteLength: 40 }],
    ["view extends beyond the buffer", { buffer: 0, byteOffset: 4, byteLength: 36 }],
    ["missing buffer", { buffer: 1, byteOffset: 0, byteLength: 36 }],
    ["negative offset", { buffer: 0, byteOffset: -4, byteLength: 36 }],
  ]) {
    const json = triangleJson();
    json.bufferViews[0] = view;
    assert.throws(() => validateModel3dAsset(glb(json)), /glb|buffer|view|offset|length|range|bounds|invalid/i, description);
  }
});

test("accessor counts and offsets cannot read beyond their own buffer view", () => {
  for (const [description, update] of [
    ["too many vertices", { count: 4 }],
    ["offset leaves too few bytes", { byteOffset: 4 }],
    ["missing buffer view", { bufferView: 1 }],
    ["negative accessor offset", { byteOffset: -4 }],
  ]) {
    const json = triangleJson();
    Object.assign(json.accessors[0], update);
    assert.throws(() => validateModel3dAsset(glb(json)), /glb|accessor|buffer|view|offset|range|bounds|invalid/i, description);
  }

  const shortView = triangleJson();
  shortView.bufferViews[0].byteLength = 24;
  assert.throws(() => validateModel3dAsset(glb(shortView)), /glb|accessor|view|range|bounds|length/i,
    "a valid backing buffer cannot hide an accessor extending beyond its declared view");
});
