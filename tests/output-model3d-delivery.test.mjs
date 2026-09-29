import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import test from "node:test";
import { MAX_OUTPUT_ASSET_BYTES, MAX_OUTPUT_MODEL3D_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { createOutputDeliveryArchive, createOutputDeliveryArchiveStream, MAX_OUTPUT_DELIVERY_MODEL3D_PAYLOAD_BYTES, MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES, planOutputDeliveryParts } from "../src/model/output-delivery-archive.ts";
import { streamOutputDeliveryZip } from "../src/model/output-delivery-zip.ts";
import { png, readStoredZip, utf8 } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const file = (id, bytes, name = `${id}.glb`) => ({ id, bytes, name, expectedSha256: digest(bytes) });
const request = files => ({ schemaVersion: 1, planId: "plan-3d", planRevision: "revision-3d", createdAt: "2026-08-31T12:00:00.000Z", targets: files.map((item, index) => ({ targetId: `target-${index + 1}`, fileId: item.id, acceptanceId: `acceptance-${index + 1}` })) });

/** Independent GLB fixture with a real indexed triangle and bounded unused BIN space. */
function triangleGlb(totalByteLength) {
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: 42 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  if (totalByteLength !== undefined) {
    assert.ok(totalByteLength % 4 === 0);
    for (;;) {
      const size = totalByteLength - 28 - Math.ceil(utf8(JSON.stringify(json)).length / 4) * 4;
      if (json.buffers[0].byteLength === size) break;
      json.buffers[0].byteLength = size;
    }
  }
  const encoded = utf8(JSON.stringify(json)), jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = Math.ceil(json.buffers[0].byteLength / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binaryLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(encoded, 20);
  view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  const start = 28 + jsonLength;
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(start + index * 4, value, true));
  view.setUint16(start + 36, 0, true); view.setUint16(start + 38, 1, true); view.setUint16(start + 40, 2, true);
  return bytes;
}

/** Validate local headers, checksums, directory offsets, and footer without collecting model bytes. */
async function inspectStreamedZip(archive, expectedPaths) {
  const reader = archive.stream.getReader(), records = [], metadata = new Map();
  let offset = 0;
  async function chunk() {
    const result = await reader.read();
    assert.equal(result.done, false);
    assert.ok(result.value.byteLength > 0 && result.value.byteLength <= 64 * 1024);
    assert.ok(result.value.buffer.byteLength <= 64 * 1024, "small chunks must not expose the whole model buffer");
    return result.value;
  }
  for (const path of expectedPaths) {
    const header = await chunk(), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(view.getUint16(6, true), 0x0800);
    assert.equal(view.getUint16(8, true), 0);
    assert.equal(view.getUint16(28, true), 0);
    const nameLength = view.getUint16(26, true), size = view.getUint32(22, true), checksum = view.getUint32(14, true);
    assert.equal(view.getUint32(18, true), size);
    assert.equal(header.length, 30 + nameLength);
    assert.equal(new TextDecoder().decode(header.subarray(30)), path);
    const hash = createHash("sha256"), collected = [];
    let remaining = size, actualCrc = 0;
    while (remaining) {
      const body = await chunk();
      assert.ok(body.length <= remaining);
      hash.update(body); actualCrc = crc32(body, actualCrc); remaining -= body.length;
      if (path.startsWith("manifest.")) collected.push(body);
      else body.fill(0xff); // Returned chunks cannot mutate later bytes.
    }
    assert.equal(actualCrc, checksum);
    records.push({ path, offset, size, checksum, sha256: hash.digest("hex") });
    if (collected.length) metadata.set(path, Buffer.concat(collected).toString("utf8"));
    offset += header.length + size;
  }
  const centralOffset = offset;
  for (const record of records) {
    const header = await chunk(), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    assert.equal(view.getUint32(0, true), 0x02014b50);
    assert.equal(view.getUint16(8, true), 0x0800);
    assert.equal(view.getUint16(10, true), 0);
    assert.equal(view.getUint32(16, true), record.checksum);
    assert.equal(view.getUint32(20, true), record.size);
    assert.equal(view.getUint32(24, true), record.size);
    assert.equal(view.getUint32(42, true), record.offset);
    assert.equal(view.getUint16(30, true), 0); assert.equal(view.getUint16(32, true), 0);
    assert.equal(header.length, 46 + view.getUint16(28, true));
    assert.equal(new TextDecoder().decode(header.subarray(46)), record.path);
    offset += header.length;
  }
  const footer = await chunk(), view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
  assert.equal(footer.length, 22); assert.equal(view.getUint32(0, true), 0x06054b50);
  assert.equal(view.getUint16(8, true), records.length); assert.equal(view.getUint16(10, true), records.length);
  assert.equal(view.getUint32(12, true), offset - centralOffset); assert.equal(view.getUint32(16, true), centralOffset);
  assert.equal(view.getUint16(20, true), 0); assert.equal(offset + footer.length, archive.byteLength);
  assert.equal((await reader.read()).done, true);
  return { records, manifest: JSON.parse(metadata.get("manifest.json")), csv: metadata.get("manifest.csv") };
}

test("a 38 MiB adopted GLB streams as an exact model file with a complete multipart inventory", async () => {
  const model = file("model", triangleGlb(38 * 1024 * 1024), "thumbnail.png"), picture = file("preview", png(), "preview.png");
  const input = request([model, picture]);
  const parts = planOutputDeliveryParts([{ id: model.id, byteLength: model.bytes.length, kind: "model3d" }, { id: picture.id, byteLength: picture.bytes.length, kind: "image" }], input);
  assert.equal(parts.length, 2); assert.deepEqual(parts[0].fileIds, [model.id]);
  const archive = await createOutputDeliveryArchiveStream([model], { ...input, packagePart: { index: 1, parts } }, { snapshot: false });
  assert.equal(archive.mimeType, "application/zip"); assert.equal(archive.sha256, undefined);
  assert.ok(archive.byteLength > MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES && archive.byteLength <= MAX_OUTPUT_DELIVERY_MODEL3D_PAYLOAD_BYTES);
  const result = await inspectStreamedZip(archive, ["files/model.glb", "manifest.json", "manifest.csv"]);
  assert.equal(result.records[0].sha256, model.expectedSha256);
  assert.equal(digest(model.bytes), model.expectedSha256, "mutating output chunks does not alter privately owned input bytes");
  assert.equal(result.manifest.files[0].sha256, model.expectedSha256);
  assert.equal(result.manifest.files[0].byteLength, model.bytes.length);
  assert.equal(result.manifest.files[0].kind, "model3d"); assert.equal(result.manifest.files[0].mimeType, "model/gltf-binary");
  assert.equal(result.manifest.files[0].facts.meshCount, 1); assert.equal(result.manifest.files[0].facts.width, undefined);
  assert.deepEqual(result.manifest.targets, input.targets); assert.equal(result.manifest.packagePart.containsCompletePackage, false);
  assert.match(result.csv, /file_in_other_part/);
});

test("only explicitly typed large model metadata gets the bounded singleton allowance", () => {
  const files = [{ id: "a-small", byteLength: 1 }, { id: "b-model", byteLength: MAX_OUTPUT_ASSET_BYTES + 1, kind: "model3d" }, { id: "c-small", byteLength: 1 }];
  const parts = planOutputDeliveryParts(files, request(files));
  assert.deepEqual(parts.map(part => part.fileIds), [["a-small"], ["b-model"], ["c-small"]]);
  assert.deepEqual(planOutputDeliveryParts([...files].reverse(), request(files)), parts);
  const maximum = [{ id: "maximum", byteLength: MAX_OUTPUT_MODEL3D_ASSET_BYTES, kind: "model3d" }];
  assert.equal(planOutputDeliveryParts(maximum, request(maximum))[0].payloadByteLength, 64 * 1024 * 1024);
  for (const kind of [undefined, "image", "video", "presentation", "audio"]) {
    const bad = [{ id: "claimed", byteLength: MAX_OUTPUT_ASSET_BYTES + 1, kind }];
    assert.throws(() => planOutputDeliveryParts(bad, request(bad)), /invalid_output_delivery_package_file/);
  }
  const tooLarge = [{ ...maximum[0], byteLength: MAX_OUTPUT_MODEL3D_ASSET_BYTES + 1 }];
  assert.throws(() => planOutputDeliveryParts(tooLarge, request(tooLarge)), /invalid_output_delivery_package_file/);
});

test("stream defaults preserve the accepted snapshot across caller mutations before and after preparation", async () => {
  const original = triangleGlb(), expected = original.slice(), files = [file("model", original)], input = request(files);
  const pending = createOutputDeliveryArchiveStream(files, input);
  original[30] ^= 1; files[0].name = "replacement.glb"; input.targets[0].targetId = "replacement";
  const archive = await pending;
  original.fill(0);
  const entries = readStoredZip(new Uint8Array(await new Response(archive.stream).arrayBuffer()));
  assert.deepEqual(entries.get("files/model.glb"), expected);
  assert.equal(archive.manifest.files[0].name, "model.glb"); assert.equal(archive.manifest.targets[0].targetId, "target-1");
});

test("small buffered and streaming archives retain the same canonical ZIP contents", async () => {
  const files = [file("model", triangleGlb()), file("preview", png(), "preview.png")], input = request(files);
  const buffered = await createOutputDeliveryArchive(files, input), streamed = await createOutputDeliveryArchiveStream(files, input);
  const bytes = new Uint8Array(await new Response(streamed.stream).arrayBuffer());
  assert.deepEqual(bytes, buffered.bytes); assert.equal(streamed.byteLength, buffered.bytes.length);
  assert.equal(digest(bytes), buffered.sha256);
});

test("stream preparation still rejects changed hashes, invalid GLBs, large non-models, and mixed large parts", async () => {
  const changed = file("changed", triangleGlb()); changed.bytes[30] ^= 1;
  await assert.rejects(createOutputDeliveryArchiveStream([changed], request([changed]), { snapshot: false }), /hash_mismatch/);
  const invalidBytes = new Uint8Array(100); invalidBytes.set(utf8("glTF"));
  const invalid = file("invalid", invalidBytes);
  await assert.rejects(createOutputDeliveryArchiveStream([invalid], request([invalid])), /file_inspection_failed/);
  const oversized = { id: "oversized", name: "claiming.glb", bytes: new Uint8Array(MAX_OUTPUT_ASSET_BYTES + 1), expectedSha256: "0".repeat(64) };
  await assert.rejects(createOutputDeliveryArchiveStream([oversized], request([oversized])), /invalid_output_delivery_file_size/);
  oversized.bytes.set(utf8("glTF"));
  const picture = file("preview", png(), "preview.png");
  await assert.rejects(createOutputDeliveryArchiveStream([oversized, picture], request([oversized, picture])), /large_model_requires_singleton/);
  const large = { ...oversized, bytes: new Uint8Array(MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES + 4) }; large.bytes.set(utf8("glTF"));
  await assert.rejects(createOutputDeliveryArchive([large], request([large])), /archive_too_large/);
});

test("stream options reject shared ownership and cancellation ends a partially consumed model", async () => {
  const files = [file("model", triangleGlb(128 * 1024))], input = request(files);
  for (const options of [null, [], { snapshot: "false" }]) await assert.rejects(createOutputDeliveryArchiveStream(files, input, options), /invalid_output_delivery_stream_options/);
  const shared = new Uint8Array(new SharedArrayBuffer(files[0].bytes.length)); shared.set(files[0].bytes);
  await assert.rejects(createOutputDeliveryArchiveStream([{ ...files[0], bytes: shared }], input, { snapshot: false }), /owned_bytes_required/);
  const archive = await createOutputDeliveryArchiveStream(files, input, { snapshot: false }), reader = archive.stream.getReader();
  assert.equal((await reader.read()).done, false); // Local header.
  const body = await reader.read(); assert.equal(body.value.byteLength, 64 * 1024);
  await reader.cancel(); assert.equal((await reader.read()).done, true);
});

test("stream chunks remain independent when privately owned input uses a Uint8Array subclass", async () => {
  const model = file("model", Buffer.from(triangleGlb(128 * 1024)));
  const archive = await createOutputDeliveryArchiveStream([model], request([model]), { snapshot: false });
  const result = await inspectStreamedZip(archive, ["files/model.glb", "manifest.json", "manifest.csv"]);
  assert.equal(result.records[0].sha256, model.expectedSha256);
  assert.equal(digest(model.bytes), model.expectedSha256);
});

test("the ZIP stream handles empty entries without stranding a read", { timeout: 1000 }, async () => {
  const result = streamOutputDeliveryZip([{ name: "empty", content: new Uint8Array() }, { name: "content", content: utf8("hello") }]);
  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  const entries = readStoredZip(bytes);
  assert.equal(bytes.length, result.byteLength); assert.equal(entries.get("empty").length, 0);
  assert.equal(new TextDecoder().decode(entries.get("content")), "hello");
});
