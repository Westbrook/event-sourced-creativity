import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, MAX_OUTPUT_MODEL3D_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { validateModel3dAsset, validateModel3dContainer } from "../src/model/model3d-assets.ts";
import { jpeg, join, png, pngChunk, utf8 } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = result => {
  assert.notEqual(result.status, "inspected");
  assert.deepEqual(result.facts, {});
  assert.ok(result.errors.length);
};

/** A complete indexed triangle with real float positions and optional embedded PNG. */
function triangle({ embeddedImage = false, bufferBytes } = {}) {
  const positions = new Uint8Array(36), positionView = new DataView(positions.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positionView.setFloat32(index * 4, value, true));
  const indices = Uint8Array.from([0, 0, 1, 0, 2, 0]);
  let binary = join(positions, indices);
  const json = {
    asset: { version: "2.0", generator: "Forma independent inspection test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  if (embeddedImage) {
    const picture = png();
    binary = join(binary, new Uint8Array(2), picture);
    json.buffers[0].byteLength = binary.byteLength;
    json.bufferViews.push({ buffer: 0, byteOffset: 44, byteLength: picture.byteLength });
    json.images = [{ bufferView: 2, mimeType: "image/png" }];
    json.textures = [{ source: 0 }];
  }
  if (bufferBytes !== undefined) {
    const expanded = new Uint8Array(bufferBytes);
    expanded.set(binary);
    binary = expanded;
    json.buffers[0].byteLength = binary.byteLength;
  }
  return { json, binary };
}

function glb({ json, binary }, { jsonText = JSON.stringify(json), jsonPadding = 0x20, binaryPadding = 0 } = {}) {
  const encoded = utf8(jsonText), jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const binaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(jsonPadding, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  view.setUint32(20 + jsonLength, binaryLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.fill(binaryPadding, 28 + jsonLength);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}

test("GLB inspection identifies real 3D bytes, preserves their hash, and never substitutes image facts", async () => {
  const source = glb(triangle({ embeddedImage: true })), expected = digest(source);
  const pending = inspectOutputAsset(source, "misleading.png");
  source[source.length - 4] ^= 1;
  const result = await pending;
  assert.equal(result.status, "inspected", result.errors.join(","));
  assert.equal(result.kind, "model3d");
  assert.equal(result.mimeType, "model/gltf-binary");
  assert.equal(result.extension, "glb");
  assert.equal(result.sha256, expected);
  assert.equal(result.facts.meshCount, 1);
  assert.equal(result.facts.width, undefined);
  assert.equal(result.facts.height, undefined);
  assert.deepEqual(result.limitationCodes, ["output_inspection_not_acceptance", "output_model3d_visual_review_required"]);
  assert.match(result.limitations.join(" "), /render|visual|appearance/i);
});

test("export container validation retains framed output while preview validation enforces decoder support", () => {
  const fixture = triangle();
  fixture.json.extensionsUsed = ["KHR_draco_mesh_compression"];
  const bytes = glb(fixture);
  const container = validateModel3dContainer(bytes);
  assert.equal(container.mimeType, "model/gltf-binary");
  assert.equal(container.byteLength, bytes.byteLength);
  assert.deepEqual(container.json, fixture.json);
  assert.throws(() => validateModel3dAsset(bytes), /decoder|compress/i);
  assert.throws(() => validateModel3dContainer(bytes.subarray(0, bytes.length - 1)), /glb/i);
});

test("the larger 3D allowance applies only to GLB bytes and remains bounded before hashing", async () => {
  assert.equal(MAX_OUTPUT_ASSET_BYTES, 24_000_000);
  assert.equal(MAX_OUTPUT_MODEL3D_ASSET_BYTES, 64 * 1024 * 1024);
  const model = glb(triangle({ bufferBytes: MAX_OUTPUT_ASSET_BYTES + 4 }));
  const accepted = await inspectOutputAsset(model, "large-model.glb");
  assert.equal(accepted.status, "inspected", accepted.errors.join(","));
  const fake = new Uint8Array(MAX_OUTPUT_ASSET_BYTES + 1);
  const mediaResult = await inspectOutputAsset(fake, "claiming-model.glb");
  assert.equal(mediaResult.sha256, null);
  assert.deepEqual(mediaResult.errors, ["output_asset_too_large"]);
  const tooLarge = new Uint8Array(MAX_OUTPUT_MODEL3D_ASSET_BYTES + 1);
  tooLarge.set(utf8("glTF"));
  const result = await inspectOutputAsset(tooLarge, "too-large.glb");
  assert.equal(result.sha256, null);
  assert.deepEqual(result.errors, ["output_asset_too_large"]);
});

test("GLB framing rejects version, length, chunk order, duplicate chunks, and trailing payload lies", async () => {
  const source = glb(triangle());
  for (const mutate of [
    view => view.setUint32(4, 1, true),
    view => view.setUint32(8, source.byteLength - 4, true),
    view => view.setUint32(12, 3, true),
    view => view.setUint32(16, 0x004e4942, true),
    view => view.setUint32(24 + view.getUint32(12, true), 0x4e4f534a, true),
  ]) {
    const bytes = source.slice();
    mutate(new DataView(bytes.buffer));
    rejected(await inspectOutputAsset(bytes));
  }
  for (const bytes of [source.slice(0, -1), join(source, utf8("tail"))]) rejected(await inspectOutputAsset(bytes));
});

test("GLB accepts lawful BIN alignment padding but rejects views into the padding", async () => {
  const fixture = triangle(); // 42 binary bytes require two zero padding bytes.
  assert.equal((await inspectOutputAsset(glb(fixture))).status, "inspected");
  fixture.json.bufferViews[1].byteLength = 8;
  rejected(await inspectOutputAsset(glb(fixture)));
  rejected(await inspectOutputAsset(glb(triangle(), { binaryPadding: 7 })));
});

test("GLB matrix accessors account for padded columns while allowing omitted final padding", async () => {
  for (const [type, componentType, length] of [["MAT2", 5121, 14], ["MAT3", 5121, 23], ["MAT3", 5123, 46]]) {
    const fixture = triangle();
    fixture.binary = join(fixture.binary, new Uint8Array(2 + length));
    fixture.json.buffers[0].byteLength = fixture.binary.byteLength;
    fixture.json.bufferViews.push({ buffer: 0, byteOffset: 44, byteLength: length });
    fixture.json.accessors.push({ bufferView: 2, componentType, count: 2, type });
    const accepted = await inspectOutputAsset(glb(fixture));
    assert.equal(accepted.status, "inspected", `${type}/${componentType}: ${accepted.errors.join(",")}`);
    fixture.json.bufferViews[2].byteLength -= 1;
    rejected(await inspectOutputAsset(glb(fixture)));
  }
});

test("GLB permits two-byte aligned uint16 index offsets without imposing vertex alignment", async () => {
  const fixture = triangle();
  fixture.binary = join(fixture.binary.subarray(0, 36), new Uint8Array(2), fixture.binary.subarray(36));
  fixture.json.buffers[0].byteLength = fixture.binary.byteLength;
  fixture.json.bufferViews[1].byteLength = 8;
  fixture.json.accessors[1].byteOffset = 2;
  const result = await inspectOutputAsset(glb(fixture));
  assert.equal(result.status, "inspected", result.errors.join(","));
});

test("GLB rejects malformed JSON and unsupported asset versions", async () => {
  for (const jsonText of ["{", "null", "[]", '{"asset":{"version":"1.0"}}']) {
    rejected(await inspectOutputAsset(glb(triangle(), { jsonText })));
  }
  const fixture = triangle();
  fixture.json.asset.minVersion = "3.0";
  rejected(await inspectOutputAsset(glb(fixture)));
});

test("GLB never follows external buffer, image, or extension URIs", async () => {
  for (const uri of ["https://example.test/model.bin", "../model.bin", "file:///private/model.bin"]) {
    const fixture = triangle();
    fixture.json.buffers[0].uri = uri;
    rejected(await inspectOutputAsset(glb(fixture)));
  }
  const fixture = triangle({ embeddedImage: true });
  fixture.json.images = [{ uri: "https://example.test/texture.png" }];
  rejected(await inspectOutputAsset(glb(fixture)));
  const required = triangle();
  required.json.extensionsUsed = ["VENDOR_remote_geometry"];
  required.json.extensionsRequired = ["VENDOR_remote_geometry"];
  required.json.extensions = { VENDOR_remote_geometry: { uri: "https://example.test/mesh.bin" } };
  rejected(await inspectOutputAsset(glb(required)));
});

test("GLB preserves harmless URL metadata and empty unused scenes", async () => {
  const fixture = triangle();
  fixture.json.asset.extras = { url: "https://example.test/model-license" };
  fixture.json.scenes.push({ name: "Empty unused scene" });
  const result = await inspectOutputAsset(glb(fixture));
  assert.equal(result.status, "inspected", result.errors.join(","));
});

test("GLB buffer and accessor bounds cannot exceed their proven binary storage", async () => {
  const mutations = [
    fixture => { fixture.json.buffers[0].byteLength += 4; },
    fixture => { fixture.json.bufferViews[0].buffer = 1; },
    fixture => { fixture.json.bufferViews[0].byteOffset = 1000; },
    fixture => { fixture.json.bufferViews[0].byteLength = 1000; },
    fixture => { fixture.json.accessors[0].bufferView = 3; },
    fixture => { fixture.json.accessors[0].count = 4; },
    fixture => { fixture.json.accessors[0].byteOffset = 2; },
    fixture => { fixture.json.accessors[0].componentType = 5129; },
    fixture => { fixture.json.accessors[0].type = "VEC5"; },
    fixture => { fixture.json.bufferViews[0].byteStride = 8; },
  ];
  for (const mutate of mutations) {
    const fixture = triangle();
    mutate(fixture);
    rejected(await inspectOutputAsset(glb(fixture)));
  }
});

test("GLB rejects out-of-range geometry references and nonfinite positions", async () => {
  for (const mutate of [
    fixture => { fixture.json.meshes[0].primitives[0].attributes.POSITION = 12; },
    fixture => { new DataView(fixture.binary.buffer).setUint16(40, 3, true); },
    fixture => { new DataView(fixture.binary.buffer).setFloat32(0, Number.NaN, true); },
    fixture => { fixture.json.nodes[0].mesh = 1; },
    fixture => { fixture.json.nodes[0].children = [0]; },
    fixture => { fixture.json.scenes[0].nodes = [1]; },
  ]) {
    const fixture = triangle();
    mutate(fixture);
    rejected(await inspectOutputAsset(glb(fixture)));
  }
});

test("GLB embedded image boundaries and MIME assertions must describe the actual embedded bytes", async () => {
  for (const mutate of [
    fixture => { fixture.json.images[0].bufferView = 99; },
    fixture => { fixture.json.bufferViews[2].byteLength += 8; },
    fixture => { fixture.json.images[0].mimeType = "image/jpeg"; },
    fixture => { fixture.binary[44] = 0; },
    fixture => { fixture.json.images[0].uri = `data:image/png;base64,${Buffer.from(png()).toString("base64")}`; },
    fixture => { fixture.json.bufferViews[2].byteStride = 4; },
    fixture => { fixture.json.bufferViews[2].byteLength -= 8; },
  ]) {
    const fixture = triangle({ embeddedImage: true });
    mutate(fixture);
    rejected(await inspectOutputAsset(glb(fixture)));
  }
});

test("GLB supports framed embedded JPEG textures and refuses truncated JPEG scans", async () => {
  const fixture = triangle({ embeddedImage: true }), picture = jpeg();
  fixture.binary = join(fixture.binary.subarray(0, 44), picture);
  fixture.json.buffers[0].byteLength = fixture.binary.byteLength;
  fixture.json.bufferViews[2].byteLength = picture.byteLength;
  fixture.json.images[0].mimeType = "image/jpeg";
  const accepted = await inspectOutputAsset(glb(fixture));
  assert.equal(accepted.status, "inspected", accepted.errors.join(","));
  fixture.json.bufferViews[2].byteLength -= 2;
  rejected(await inspectOutputAsset(glb(fixture)));
});

test("GLB image framing rejects interrupted PNG data and inconsistent JPEG scan headers", async () => {
  const original = png(), iend = original.length - 12;
  const interrupted = join(original.subarray(0, iend), pngChunk("tEXt", utf8("Label\0test")), pngChunk("IDAT", Uint8Array.from([1])), original.subarray(iend));
  const malformedJpeg = jpeg();
  const sos = Buffer.from(malformedJpeg).indexOf(Buffer.from([255, 218]));
  malformedJpeg[sos + 4] = 3;
  for (const [picture, mimeType] of [[interrupted, "image/png"], [malformedJpeg, "image/jpeg"]]) {
    const fixture = triangle({ embeddedImage: true });
    fixture.binary = join(fixture.binary.subarray(0, 44), picture);
    fixture.json.buffers[0].byteLength = fixture.binary.byteLength;
    fixture.json.bufferViews[2].byteLength = picture.byteLength;
    fixture.json.images[0].mimeType = mimeType;
    rejected(await inspectOutputAsset(glb(fixture)));
  }
});

test("GLB validates an actual WebP texture and rejects contradictory canvas dimensions", async () => {
  // Independently encoded 2×2 RGBA image, verified by libwebp during fixture creation.
  const picture = new Uint8Array(Buffer.from("UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggMAAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7y63/82BXNc+/3/9Lg/S4P0uD/0pAAAA==", "base64"));
  const fixture = triangle({ embeddedImage: true });
  fixture.binary = join(fixture.binary.subarray(0, 44), picture);
  fixture.json.buffers[0].byteLength = fixture.binary.byteLength;
  fixture.json.bufferViews[2].byteLength = picture.byteLength;
  fixture.json.images[0].mimeType = "image/webp";
  fixture.json.extensionsUsed = ["EXT_texture_webp"];
  fixture.json.extensionsRequired = ["EXT_texture_webp"];
  fixture.json.textures = [{ extensions: { EXT_texture_webp: { source: 0 } } }];
  const accepted = await inspectOutputAsset(glb(fixture));
  assert.equal(accepted.status, "inspected", accepted.errors.join(","));
  fixture.binary[44 + 24] = 2; // VP8X now claims a 3×2 canvas; VP8 remains 2×2.
  rejected(await inspectOutputAsset(glb(fixture)));
});

test("GLB bounds zero-filled accessor allocations before a viewer expands them", async () => {
  const fixture = triangle();
  for (let index = 0; index < 10; index += 1) {
    fixture.json.accessors.push({ componentType: 5121, count: 2_000_000, type: "VEC4" });
  }
  rejected(await inspectOutputAsset(glb(fixture)));
});

test("GLB validates instancing semantics and cumulative instance allocations", async () => {
  const invalidShape = triangle();
  invalidShape.json.extensionsUsed = ["EXT_mesh_gpu_instancing"];
  invalidShape.json.accessors.push({ componentType: 5126, count: 3, type: "SCALAR" });
  invalidShape.json.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 2 } } };
  rejected(await inspectOutputAsset(glb(invalidShape)));

  const excessive = triangle();
  excessive.json.extensionsUsed = ["EXT_mesh_gpu_instancing"];
  excessive.json.accessors.push({ componentType: 5126, count: 1_000_000, type: "VEC3" });
  excessive.json.nodes = Array.from({ length: 2 }, () => ({ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 2 } } } }));
  excessive.json.scenes[0].nodes = [0, 1];
  rejected(await inspectOutputAsset(glb(excessive)));
});

test("GLB checks punctual light references before a scene loader accesses them", async () => {
  const fixture = triangle();
  fixture.json.extensionsUsed = ["KHR_lights_punctual"];
  fixture.json.extensions = { KHR_lights_punctual: { lights: [{ type: "point" }] } };
  fixture.json.nodes[0].extensions = { KHR_lights_punctual: { light: 0 } };
  const accepted = await inspectOutputAsset(glb(fixture));
  assert.equal(accepted.status, "inspected", accepted.errors.join(","));
  fixture.json.nodes[0].extensions.KHR_lights_punctual.light = 1;
  rejected(await inspectOutputAsset(glb(fixture)));
});

test("GLB truncations and deterministic malformed mutations return no partial success facts", async () => {
  const source = glb(triangle({ embeddedImage: true }));
  for (const end of [1, 4, 9, 20, Math.floor(source.length / 2), source.length - 1]) {
    rejected(await inspectOutputAsset(source.slice(0, end)));
  }
  let seed = 0x5eed1234;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bytes = source.slice();
    for (let mutation = 0; mutation < 3; mutation += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[seed % bytes.length] ^= (seed >>> 24) || 1;
    }
    const result = await inspectOutputAsset(bytes);
    assert.ok(["inspected", "unsupported", "invalid"].includes(result.status));
    assert.equal(result.sha256, digest(bytes));
    if (result.status !== "inspected") rejected(result);
  }
});
