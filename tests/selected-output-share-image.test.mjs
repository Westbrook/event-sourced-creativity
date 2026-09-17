import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { inspectOutputAsset } from "../src/model/output-asset-inspection.ts";
import { qualifySelectedOutputShareImage, copySelectedOutputShareImageBytes, SELECTED_OUTPUT_SHARE_IMAGE_POLICY,
  SELECTED_OUTPUT_SHARE_IMAGE_LIMITS } from "../src/model/selected-output-share-image.ts";
import { png, pngChunk, join, utf8, jpeg } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = (bytes, width = 3, height = 2) => ({ sha256: digest(bytes), width, height, byteLength: bytes.length });
const qualify = (bytes, expected = facts(bytes)) => qualifySelectedOutputShareImage(bytes, expected);
const refused = result => { assert.equal(result.status, "unqualified"); assert.equal(copySelectedOutputShareImageBytes(result), null); };
function chunks(bytes) {
  const result = []; let at = 8;
  while (at < bytes.length) { const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at); result.push(bytes.slice(at, at + length + 12)); at += length + 12; }
  return result;
}
const unsigned = values => { const data = new Uint8Array(values.length * 4), view = new DataView(data.buffer); values.forEach((value, index) => view.setUint32(index * 4, value)); return data; };
function rgb(extraChunks = []) {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 3); view.setUint32(4, 2); header.set([8, 2, 0, 0, 0], 8);
  return join(png().slice(0, 8), pngChunk("IHDR", header), ...extraChunks, pngChunk("IDAT", deflateSync(new Uint8Array(20))), pngChunk("IEND", new Uint8Array()));
}

for (const [label, width, height] of [["native synthetic original", 24, 24], ["native synthetic current edit", 1536, 864]]) {
  test(`${label} retains exact PNG bytes and expected facts`, async () => {
    // Same pure fixture and dimensions as existing generated-image-edit tests.
    const bytes = png({ width, height }), expected = facts(bytes, width, height), result = await qualify(bytes, expected);
    assert.equal(result.status, "qualified"); assert.ok(Object.isFrozen(result));
    assert.deepEqual(result, { status: "qualified", policy: SELECTED_OUTPUT_SHARE_IMAGE_POLICY, mimeType: "image/png", ...expected });
    assert.deepEqual(copySelectedOutputShareImageBytes(result), bytes);
  });
}
test("8-bit RGB with validated transparent color is supported", async () => {
  const bytes = rgb([pngChunk("tRNS", Uint8Array.from([0, 1, 0, 2, 0, 3]))]);
  assert.equal((await qualify(bytes)).status, "qualified");
});
test("bounded sRGB rendering intent and exact standard gamma/chromaticities survive unchanged", async () => {
  for (const intent of [0, 1, 2, 3]) {
    const bytes = png({ extraChunks: [pngChunk("sRGB", Uint8Array.of(intent)), pngChunk("gAMA", unsigned([45455])),
      pngChunk("cHRM", unsigned([31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]))] });
    const result = await qualify(bytes); assert.equal(result.status, "qualified"); assert.deepEqual(copySelectedOutputShareImageBytes(result), bytes);
  }
});
test("original and returned byte mutations cannot change the qualified source", async () => {
  const input = png(), original = input.slice(), expected = facts(input), pending = qualify(input, expected);
  input.fill(0); expected.sha256 = "0".repeat(64); expected.width = 99;
  const result = await pending; assert.equal(result.status, "qualified");
  const first = copySelectedOutputShareImageBytes(result); assert.deepEqual(first, original); first.fill(1);
  assert.deepEqual(copySelectedOutputShareImageBytes(result), original);
  assert.equal(result.sha256, digest(original));
});
test("subarray captures only selected bytes and ignores shadowed array getters/iterators", async () => {
  const original = png(), backing = join(utf8("prefix"), original, utf8("private suffix")), input = backing.subarray(6, 6 + original.length);
  let calls = 0;
  for (const key of ["byteLength", "buffer", Symbol.iterator]) Object.defineProperty(input, key, { get() { calls++; throw Error("Must not run"); } });
  const result = await qualify(input, facts(original)); assert.equal(result.status, "qualified"); assert.equal(calls, 0);
  assert.deepEqual(copySelectedOutputShareImageBytes(result), original);
});
test("forged, copied and serialized qualifications never supply byte authority", async () => {
  const result = await qualify(png()); assert.equal(result.status, "qualified");
  for (const value of [{ ...result }, JSON.parse(JSON.stringify(result)), {}, null, 1, new Proxy(result, {})]) assert.equal(copySelectedOutputShareImageBytes(value), null);
});
test("expected fields are closed data, without invoking accessors", async () => {
  const bytes = png(); let calls = 0;
  const accessor = facts(bytes); Object.defineProperty(accessor, "sha256", { get() { calls++; return digest(bytes); } });
  for (const expected of [accessor, { ...facts(bytes), ownerId: "private" }, { ...facts(bytes), mimeType: "image/png" },
    { ...facts(bytes), width: 0 }, { ...facts(bytes), width: 1.5 }, { ...facts(bytes), height: 16385 },
    { ...facts(bytes), byteLength: 0 }, { ...facts(bytes), sha256: digest(bytes).toUpperCase() }, Object.create(facts(bytes))]) refused(await qualify(bytes, expected));
  assert.equal(calls, 0);
  assert.equal((await qualify(bytes, Object.assign(Object.create(null), facts(bytes)))).status, "qualified");
});
test("expected hash, size and dimensions each bind the selected bytes", async () => {
  const bytes = png();
  for (const patch of [{ sha256: "0".repeat(64) }, { width: 4 }, { height: 3 }, { byteLength: bytes.length + 1 }]) {
    const result = await qualify(bytes, { ...facts(bytes), ...patch }); refused(result); assert.equal(result.reason, "selection_mismatch");
  }
});
test("shared, detached, proxy, subclass, oversized and nonbyte inputs refuse", async () => {
  const bytes = png(), detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  class Bytes extends Uint8Array {}
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  for (const input of [shared, detached, new Proxy(bytes, {}), new Bytes(bytes), bytes.buffer, [], null, new Uint8Array(),
    new Uint8Array(SELECTED_OUTPUT_SHARE_IMAGE_LIMITS.bytes + 1)]) refused(await qualifySelectedOutputShareImage(input, facts(bytes)));
});

for (const type of ["tEXt", "zTXt", "iTXt", "eXIf", "iCCP", "pHYs", "tIME", "sPLT", "bKGD", "sBIT", "cICP", "mDCv", "cLLi", "vpAg", "acTL", "fcTL", "fdAT", "PLTE", "ABCD"]) {
  test(`${type} cannot carry unqualified data into a public PNG`, async () => {
    const bytes = png({ extraChunks: [pngChunk(type, utf8("SYNTHETIC_PRIVATE_PROMPT"))] });
    const result = await qualify(bytes); refused(result); assert.equal(result.reason, "unqualified_metadata");
  });
}
test("private PNG ancillary data accepted by the private inspector is refused here", async () => {
  const bytes = png({ extraChunks: [pngChunk("tEXt", utf8("Comment\0SYNTHETIC_PRIVATE_PROMPT"))] });
  assert.equal((await inspectOutputAsset(bytes)).status, "inspected"); refused(await qualify(bytes));
});
test("duplicate, post-IDAT and malformed rendering chunks refuse", async () => {
  const standard = pngChunk("sRGB", Uint8Array.of(0)), [header, data, end] = chunks(png());
  const values = [png({ extraChunks: [standard, standard] }), join(png().slice(0, 8), header, data, standard, end),
    png({ extraChunks: [pngChunk("sRGB", Uint8Array.of(4))] }), png({ extraChunks: [pngChunk("sRGB", new Uint8Array(2))] }),
    png({ extraChunks: [pngChunk("gAMA", new Uint8Array(3))] }), png({ extraChunks: [pngChunk("cHRM", new Uint8Array(31))] }),
    png({ extraChunks: [pngChunk("tRNS", new Uint8Array(6))] }), rgb([pngChunk("tRNS", Uint8Array.from([1, 0, 0, 0, 0, 0]))]),
    rgb([pngChunk("tRNS", new Uint8Array(5))])];
  for (const bytes of values) refused(await qualify(bytes));
});
test("nonstandard gamma and chromaticity payloads remain unsupported without stripping", async () => {
  for (const extra of [pngChunk("gAMA", unsigned([45456])), pngChunk("cHRM", unsigned([1, 2, 3, 4, 5, 6, 7, 8]))]) {
    const bytes = png({ extraChunks: [extra] }), before = bytes.slice(), result = await qualify(bytes);
    refused(result); assert.equal(result.reason, "unqualified_metadata"); assert.deepEqual(bytes, before);
  }
});
test("unsupported bit depth, grayscale, indexed color, interlace and JPEG do not masquerade as a public PNG", async () => {
  for (const [bitDepth, color, interlace] of [[16, 6, 0], [8, 0, 0], [8, 3, 0], [8, 4, 0], [8, 6, 1]]) {
    const [header, data, end] = chunks(png()), payload = header.slice(8, -4); payload[8] = bitDepth; payload[9] = color; payload[12] = interlace;
    const result = await qualify(join(png().slice(0, 8), pngChunk("IHDR", payload), data, end)); refused(result); assert.equal(result.reason, "unsupported_png");
  }
  refused(await qualify(jpeg(), facts(jpeg(), 1, 1)));
});
test("native CRC, inflate, filter and exact IEND validation remain effective", async () => {
  const corrupt = png(); corrupt[29] ^= 1;
  const filter = new Uint8Array(26); filter[0] = 5;
  const [header, data, end] = chunks(png());
  for (const bytes of [corrupt, png({ raw: new Uint8Array(1) }), png({ raw: filter }), png().slice(0, -1), join(png(), utf8("private trailer")),
    join(png().slice(0, 8), header, pngChunk("IDAT", join(data.slice(8, -4), utf8("private compressed trailer"))), end)]) refused(await qualify(bytes));
});
test("chunk-count and expanded-byte limits are finite", async () => {
  const [header, data, end] = chunks(png()), empty = pngChunk("IDAT", new Uint8Array());
  const atLimit = join(png().slice(0, 8), header, data, ...Array(4093).fill(empty), end);
  assert.equal((await qualify(atLimit)).status, "qualified");
  refused(await qualify(join(png().slice(0, 8), header, data, ...Array(4094).fill(empty), end)));
  refused(await qualify(png({ width: 16384, height: 16384, raw: new Uint8Array(1) }), facts(png({ width: 16384, height: 16384, raw: new Uint8Array(1) }), 16384, 16384)));
});
test("declared chunk overrun and duplicate IHDR cannot bypass native framing", async () => {
  const bytes = png(); new DataView(bytes.buffer).setUint32(8, 0xffffffff); refused(await qualify(bytes));
  const [header, data, end] = chunks(png()); refused(await qualify(join(png().slice(0, 8), header, header, data, end)));
});
