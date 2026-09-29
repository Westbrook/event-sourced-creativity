import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { VIDEO_PREFIX_TRIM_MAX_BYTES, inspectVideoPrefix, trimVideoPrefix } from "../src/model/video-container.ts";
import { inspectOutputAsset } from "../src/model/output-asset-inspection.ts";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";

// Exact retained offline AVC supplier: 32×18, 2 seconds, IDR-I/P/P/P, no audio.
// No codec, provider, browser, helper mutation or file output is used here.
const ORIGINAL_SHA = "9cabce6d2873d95f9d1210f230361b9afcbb6f34bdbdf9849f09b6ad5aefd999";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const original = () => ownedSocialVideo("16:9");
const dataView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes, start, length = 4) => String.fromCharCode(...bytes.subarray(start, start + length));
const putType = (bytes, start, type) => { assert.equal(type.length, 4); for (let i = 0; i < 4; i++) bytes[start + i] = type.charCodeAt(i); };
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
function box(type, payload = new Uint8Array()) {
  const out = new Uint8Array(8 + payload.length); dataView(out).setUint32(0, out.length); putType(out, 4, type); out.set(payload, 8); return out;
}
function words(...values) {
  const out = new Uint8Array(values.length * 4); values.forEach((value, i) => dataView(out).setUint32(i * 4, value)); return out;
}

// Independent small-box/table reader for this donor and the emitted prefix.
// It reads bytes and timing directly; it does not call the implementation to
// obtain expected sample payloads, chunk offsets, clock values or output length.
function boxes(bytes, start = 0, end = bytes.length) {
  const result = [], view = dataView(bytes); let offset = start;
  while (offset < end) {
    assert.ok(result.length < 100); assert.ok(offset + 8 <= end);
    const size = view.getUint32(offset); assert.ok(size >= 8 && offset + size <= end);
    result.push({ type: ascii(bytes, offset + 4), start: offset, data: offset + 8, end: offset + size, size }); offset += size;
  }
  assert.equal(offset, end); return result;
}
function one(list, type) { const found = list.filter(entry => entry.type === type); assert.equal(found.length, 1, type); return found[0]; }
function path(bytes, names) {
  let list = boxes(bytes); const chain = [];
  for (let i = 0; i < names.length; i++) {
    const found = one(list, names[i]); chain.push(found);
    if (i + 1 < names.length) list = boxes(bytes, found.data, found.end);
  }
  return chain;
}
function nalBits(nal, skip = 1) {
  // Independent bounded prefix reader; it is not a codec encoder or decoder.
  const rbsp = [];
  for (let i = skip; i < nal.length; i++) {
    if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    rbsp.push(nal[i]);
  }
  let bit = 0;
  const next = () => { assert.ok(bit < rbsp.length * 8); const value = (rbsp[bit >> 3] >> (7 - (bit & 7))) & 1; bit++; return value; };
  const ue = () => { let zeros = 0; while (next() === 0) { zeros++; assert.ok(zeros < 24); } let value = 1; for (let i = 0; i < zeros; i++) value = value * 2 + next(); return value - 1; };
  const fixed = count => { assert.ok(count >= 0 && count <= 16); let value = 0; for (let i = 0; i < count; i++) value = value * 2 + next(); return value; };
  return { ue, read: next, fixed };
}
function slicePrefix(nal, frameBits = 0) {
  const bits = nalBits(nal), fields = [bits.ue(), bits.ue(), bits.ue()];
  if (frameBits) fields.push(bits.fixed(frameBits)); return fields;
}
function setBits(bytes, byteStart, bitStart, width, value) {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 16 && value >= 0 && value < 2 ** width);
  for (let i = 0; i < width; i++) {
    const at = bitStart + i, index = byteStart + (at >> 3), mask = 1 << (7 - (at & 7));
    bytes[index] = (bytes[index] & ~mask) | (((value >> (width - i - 1)) & 1) ? mask : 0);
  }
}
function parameterSets(bytes) {
  const config = tables(bytes).avcC, view = dataView(bytes), spsStart = config.data + 8;
  assert.equal(bytes[config.data + 5], 225);
  const spsEnd = spsStart + view.getUint16(config.data + 6); assert.equal(bytes[spsEnd], 1);
  const ppsStart = spsEnd + 3, ppsEnd = ppsStart + view.getUint16(spsEnd + 1); assert.equal(ppsEnd, config.end);
  return { spsStart, sps: bytes.subarray(spsStart, spsEnd), ppsStart, pps: bytes.subarray(ppsStart, ppsEnd) };
}
function ppsPrefix(nal) {
  const bits = nalBits(nal);
  return { id: bits.ue(), sps: bits.ue(), entropy: bits.read(), bottom: bits.read(), groups: bits.ue(), bits };
}
function tables(bytes) {
  const view = dataView(bytes), top = boxes(bytes), moov = one(top, "moov"), movie = boxes(bytes, moov.data, moov.end);
  const trak = one(movie, "trak"), track = boxes(bytes, trak.data, trak.end), tkhd = one(track, "tkhd");
  const mdia = one(track, "mdia"), media = boxes(bytes, mdia.data, mdia.end), mdhd = one(media, "mdhd"), hdlr = one(media, "hdlr");
  const minf = one(media, "minf"), stbl = one(boxes(bytes, minf.data, minf.end), "stbl"), st = boxes(bytes, stbl.data, stbl.end);
  const mvhd = one(movie, "mvhd"), stsd = one(st, "stsd"), avc1 = one(boxes(bytes, stsd.data + 8, stsd.end), "avc1");
  const extensions = boxes(bytes, avc1.data + 78, avc1.end), avcC = one(extensions, "avcC");
  const rows = (name, columns) => {
    const entry = one(st, name), count = view.getUint32(entry.data + 4);
    assert.equal(entry.size, 16 + count * columns * 4);
    return Array.from({ length: count }, (_, i) => Array.from({ length: columns }, (_, j) => view.getUint32(entry.data + 8 + (i * columns + j) * 4)));
  };
  const stsz = one(st, "stsz"), size = view.getUint32(stsz.data + 4), count = view.getUint32(stsz.data + 8);
  assert.ok(count > 0 && count < 100); assert.equal(stsz.size, 20 + (size ? 0 : count * 4));
  const sizes = Array.from({ length: count }, (_, i) => size || view.getUint32(stsz.data + 12 + i * 4));
  const durations = rows("stts", 2).flatMap(([n, duration]) => Array(n).fill(duration)); assert.equal(durations.length, count);
  const offsets = rows("stco", 1).flat(), mapping = rows("stsc", 3), samples = []; let sample = 0;
  for (let i = 0; i < offsets.length; i++) {
    const map = mapping.filter(row => row[0] <= i + 1).at(-1); assert.ok(map); assert.equal(map[2], 1);
    let offset = offsets[i];
    for (let n = 0; n < map[1]; n++) {
      assert.ok(sample < sizes.length); const end = offset + sizes[sample];
      assert.ok(top.some(entry => entry.type === "mdat" && offset >= entry.data && end <= entry.end));
      samples.push({ offset, end, bytes: bytes.slice(offset, end), duration: durations[sample] }); offset = end; sample++;
    }
  }
  assert.equal(sample, count);
  const nalLength = (bytes[avcC.data + 4] & 3) + 1;
  const slices = samples.map(({ bytes: payload }) => {
    let offset = 0; const nals = [];
    while (offset < payload.length) {
      let length = 0; for (let i = 0; i < nalLength; i++) length = length * 256 + payload[offset++];
      assert.ok(length > 0 && offset + length <= payload.length);
      nals.push({ type: payload[offset] & 31, start: offset, bytes: payload.slice(offset, offset + length) }); offset += length;
    }
    assert.equal(offset, payload.length); return nals;
  });
  return { top, moov, trak, tkhd, mdhd, hdlr, stbl, st, stsd, avc1, avcC, mvhd, track, extensions,
    samples, slices, sizes, durations, offsets, mapping,
    sync: rows("stss", 1).flat(), movieScale: view.getUint32(mvhd.data + 12), movieTicks: view.getUint32(mvhd.data + 16),
    timescale: view.getUint32(mdhd.data + 12), durationTicks: view.getUint32(mdhd.data + 16),
    trackTicks: view.getUint32(tkhd.data + 20), width: view.getUint16(avc1.data + 24), height: view.getUint16(avc1.data + 26) };
}

// Mutate only this in-memory donor for explicit refusal premises. Replacement
// changes ancestor sizes and relocates original chunk offsets outside the
// replacement. Callers relocate offsets contained inside their replacement.
function replaceBox(bytes, names, replacement) {
  const chain = path(bytes, names), old = chain.at(-1), oldTables = tables(bytes), delta = replacement.length - old.size;
  const out = concat(bytes.subarray(0, old.start), replacement, bytes.subarray(old.end));
  const view = dataView(out);
  for (const ancestor of chain.slice(0, -1)) view.setUint32(ancestor.start, ancestor.size + delta);
  const oldStco = one(oldTables.st, "stco");
  // The replacement may itself be stco; its caller sets all offsets explicitly.
  if (!(old.start <= oldStco.start && oldStco.end <= old.end)) {
    const stco = oldStco.start >= old.end ? oldStco.start + delta : oldStco.start;
    for (let i = 0; i < oldTables.offsets.length; i++) view.setUint32(stco + 16 + i * 4, oldTables.offsets[i] >= old.end ? oldTables.offsets[i] + delta : oldTables.offsets[i]);
  }
  return out;
}
const STBL = ["moov", "trak", "mdia", "minf", "stbl"];
function appendSampleTable(type, payload) {
  const input = original(), parsed = tables(input), old = parsed.stbl;
  // stco lies inside this replacement: update its one offset in the copied body.
  const added = box(type, payload), replacement = box("stbl", concat(input.subarray(old.data, old.end), added));
  dataView(replacement).setUint32(one(parsed.st, "stco").start - old.start + 16, parsed.offsets[0] + added.length);
  return replaceBox(input, STBL, replacement);
}
function replaceSample(index, payload) {
  const source = original(), parsed = tables(source);
  const replacement = box("mdat", concat(...parsed.samples.map((sample, i) => i === index ? payload : sample.bytes)));
  const changed = replaceBox(source, ["mdat"], replacement);
  dataView(changed).setUint32(one(parsed.st, "stsz").data + 12 + index * 4, payload.length);
  assert.deepEqual(tables(changed).samples.map(sample => sample.bytes), parsed.samples.map((sample, i) => i === index ? payload : sample.bytes));
  return changed;
}
async function refused(input) {
  const pinned = input instanceof Uint8Array ? input.slice() : null;
  assert.equal(await inspectVideoPrefix(input), null);
  assert.equal(await trimVideoPrefix(input, { startSample: 0, endSample: 2 }), null);
  // No-op must not bypass structural eligibility.
  assert.equal(await trimVideoPrefix(input, { startSample: 0, endSample: 4 }), null);
  if (pinned) assert.deepEqual(input, pinned);
}
function inspectFields(info, count, originalSha) {
  assert.ok(info); assert.equal(info.sampleCount, count); assert.equal(info.timescale, 16384);
  assert.equal(info.durationTicks, count * 8192); assert.equal(info.durationSeconds, count / 2);
  assert.equal(info.width, 32); assert.equal(info.height, 18); assert.equal(info.sourceSha256, originalSha);
  assert.deepEqual([...info.sampleDurationTicks], Array(count).fill(8192));
}

test("the exact donor is one silent AVC track with identity edits and IDR-I/P/P/P samples", async () => {
  const bytes = original(); assert.equal(bytes.length, 1513); assert.equal(hash(bytes), ORIGINAL_SHA);
  const parsed = tables(bytes);
  assert.equal(ascii(bytes, parsed.hdlr.data + 8), "vide");
  assert.deepEqual(parsed.sizes, [651, 10, 10, 10]); assert.deepEqual(parsed.durations, [8192, 8192, 8192, 8192]);
  assert.deepEqual(parsed.sync, [1]); assert.deepEqual(parsed.slices.map(nals => nals.map(nal => nal.type)), [[6, 5], [1], [1], [1]]);
  assert.deepEqual(parsed.slices.map(nals => slicePrefix(nals.find(nal => nal.type === 1 || nal.type === 5).bytes)), [[0, 7, 0], [0, 5, 0], [0, 5, 0], [0, 5, 0]]);
  assert.deepEqual(parsed.slices.map(nals => slicePrefix(nals.find(nal => nal.type === 1 || nal.type === 5).bytes, 4).at(-1)), [0, 1, 2, 3]);
  assert.deepEqual(parsed.offsets, [832]); assert.deepEqual(parsed.mapping, [[1, 4, 1]]);
  assert.equal(parsed.movieScale, 1000); assert.equal(parsed.movieTicks, 2000); assert.equal(parsed.trackTicks, 2000);
  assert.equal(parsed.st.some(entry => entry.type === "ctts"), false);
  const edits = one(parsed.track, "edts"), elst = one(boxes(bytes, edits.data, edits.end), "elst");
  const view = dataView(bytes); assert.equal(elst.size, 28); assert.equal(view.getUint32(elst.data + 4), 1);
  assert.equal(view.getUint32(elst.data + 8), 2000); assert.equal(view.getInt32(elst.data + 12), 0);
  assert.equal(view.getInt16(elst.data + 16), 1); assert.equal(view.getInt16(elst.data + 18), 0);
  inspectFields(await inspectVideoPrefix(bytes), 4, ORIGINAL_SHA); assert.equal(hash(bytes), ORIGINAL_SHA);
});

test("two-sample prefix physically contains only the original first two payloads and one second", async () => {
  const source = original(), pinned = source.slice(), before = tables(source);
  const result = await trimVideoPrefix(source, { startSample: 0, endSample: 2 }); assert.ok(result); assert.equal(result.changed, true);
  assert.equal(result.sourceSha256, ORIGINAL_SHA); assert.equal(result.sha256, hash(result.bytes)); assert.notEqual(result.sha256, ORIGINAL_SHA);
  const after = tables(result.bytes); assert.equal(after.samples.length, 2);
  assert.deepEqual(after.samples.map(sample => sample.bytes), before.samples.slice(0, 2).map(sample => sample.bytes));
  assert.deepEqual(after.durations, [8192, 8192]); assert.deepEqual(after.sizes, [651, 10]); assert.deepEqual(after.sync, [1]);
  assert.equal(after.durationTicks, 16384); assert.equal(after.movieTicks, after.movieScale); assert.equal(after.trackTicks, after.movieScale);
  const mdat = one(after.top, "mdat"); assert.equal(mdat.end - mdat.data, 661);
  assert.deepEqual(result.bytes.subarray(mdat.data, mdat.end), concat(before.samples[0].bytes, before.samples[1].bytes));
  assert.equal(after.samples[0].offset, mdat.data); assert.equal(after.samples.at(-1).end, mdat.end);
  assert.deepEqual(result.bytes.subarray(after.avcC.start, after.avcC.end), source.subarray(before.avcC.start, before.avcC.end));
  assert.ok(result.bytes.length < source.length); assert.deepEqual(source, pinned);
  inspectFields(result.info, 2, result.sha256);
  inspectFields(await inspectVideoPrefix(result.bytes), 2, result.sha256);
  const inspected = await inspectOutputAsset(result.bytes, "trimmed.mp4");
  assert.equal(inspected.status, "inspected"); assert.equal(inspected.sha256, result.sha256);
  assert.equal(inspected.facts.frameCount, 2); assert.equal(inspected.facts.durationSeconds, 1);
  assert.equal(inspected.facts.audioCodec, undefined); assert.equal(inspected.facts.codec, "avc1");
});

test("each shorter sample boundary is exact; full range is a separately owned byte-identical no-op", async () => {
  for (const endSample of [1, 3]) {
    const source = original(), result = await trimVideoPrefix(source, { startSample: 0, endSample }); assert.ok(result);
    assert.equal(result.changed, true); assert.deepEqual(tables(result.bytes).samples.map(sample => sample.bytes), tables(source).samples.slice(0, endSample).map(sample => sample.bytes));
    inspectFields(result.info, endSample, result.sha256);
  }
  const source = original(), result = await trimVideoPrefix(source, { startSample: 0, endSample: 4 }); assert.ok(result);
  assert.equal(result.changed, false); assert.deepEqual(result.bytes, source); assert.notEqual(result.bytes, source);
  assert.equal(result.sourceSha256, ORIGINAL_SHA); assert.equal(result.sha256, ORIGINAL_SHA); inspectFields(result.info, 4, ORIGINAL_SHA);
  source.fill(0); assert.equal(hash(result.bytes), ORIGINAL_SHA);
});

test("range is exact, noncoercing and prefix-only", async () => {
  const invalid = [null, undefined, [], {}, { startSample: 0 }, { endSample: 2 },
    { startSample: 1, endSample: 2 }, { startSample: -1, endSample: 2 }, { startSample: 0.5, endSample: 2 },
    { startSample: "0", endSample: 2 }, { startSample: false, endSample: 2 },
    { startSample: 0, endSample: 0 }, { startSample: 0, endSample: -1 }, { startSample: 0, endSample: 5 },
    { startSample: 0, endSample: 2.5 }, { startSample: 0, endSample: "2" }, { startSample: 0, endSample: true },
    { startSample: NaN, endSample: 2 }, { startSample: 0, endSample: NaN }, { startSample: 0, endSample: Infinity },
    { startSample: 0, endSample: 2, extra: 1 }, { startSample: 0, endSample: 2, scale: 2 }];
  const input = original();
  for (const range of invalid) assert.equal(await trimVideoPrefix(input, range), null, String(range));
  assert.equal(hash(input), ORIGINAL_SHA);
});

test("input and selected boundary are captured before hashing yields", async () => {
  const input = original(), inspection = inspectVideoPrefix(input); input.fill(0);
  inspectFields(await inspection, 4, ORIGINAL_SHA);
  const source = original(), range = { startSample: 0, endSample: 2 }, pending = trimVideoPrefix(source, range);
  source.fill(0); range.startSample = 1; range.endSample = 4;
  const result = await pending; assert.ok(result); assert.equal(result.sourceSha256, ORIGINAL_SHA);
  assert.deepEqual(tables(result.bytes).samples.map(sample => sample.bytes), tables(original()).samples.slice(0, 2).map(sample => sample.bytes));
  assert.equal(result.info.sampleCount, 2);
});

test("range inspection never invokes accessors and rejects inherited, symbolic or hidden fields", async () => {
  let calls = 0;
  const trap = () => { calls++; throw new Error("range getter must not run"); };
  const startGetter = { endSample: 2 }; Object.defineProperty(startGetter, "startSample", { enumerable: true, get: trap });
  const endGetter = { startSample: 0 }; Object.defineProperty(endGetter, "endSample", { enumerable: true, get: trap });
  const inherited = Object.create({ startSample: 0, endSample: 2 });
  const customPrototype = Object.assign(Object.create({ marker: true }), { startSample: 0, endSample: 2 });
  const symbol = { startSample: 0, endSample: 2 }; Object.defineProperty(symbol, Symbol("extra"), { get: trap });
  const hidden = { startSample: 0 }; Object.defineProperty(hidden, "endSample", { value: 2, enumerable: false });
  const extraGetter = { startSample: 0, endSample: 2 }; Object.defineProperty(extraGetter, "extra", { get: trap });
  for (const range of [startGetter, endGetter, inherited, customPrototype, symbol, hidden, extraGetter]) {
    assert.equal(await trimVideoPrefix(original(), range), null); assert.equal(calls, 0);
  }
  const exact = Object.assign(Object.create(null), { startSample: 0, endSample: 2 });
  const result = await trimVideoPrefix(original(), Object.freeze(exact)); assert.ok(result);
  inspectFields(result.info, 2, result.sha256); assert.equal(calls, 0);
});

test("native byte slots cannot be replaced by own getters or forged shared-buffer properties", async () => {
  for (const property of ["buffer", "byteLength", "byteOffset"]) {
    const input = original(); let calls = 0;
    Object.defineProperty(input, property, { get() { calls++; throw new Error("shadowed byte getter must not run"); } });
    const inspected = await inspectVideoPrefix(input); inspectFields(inspected, 4, ORIGINAL_SHA);
    const result = await trimVideoPrefix(input, { startSample: 0, endSample: 2 }); assert.ok(result);
    assert.equal(result.sourceSha256, ORIGINAL_SHA); inspectFields(result.info, 2, result.sha256); assert.equal(calls, 0);
  }
  const shared = new Uint8Array(new SharedArrayBuffer(original().length)); shared.set(original());
  // A data property cannot turn the actual shared backing store into an owned ArrayBuffer.
  Object.defineProperty(shared, "buffer", { value: original().buffer });
  assert.equal(await inspectVideoPrefix(shared), null);
  assert.equal(await trimVideoPrefix(shared, { startSample: 0, endSample: 2 }), null);
  let subclassCalls = 0;
  class ForeignBytes extends Uint8Array { get buffer() { subclassCalls++; throw new Error("subclass getter must not run"); } }
  const subclass = new ForeignBytes(original());
  assert.equal(await inspectVideoPrefix(subclass), null);
  assert.equal(await trimVideoPrefix(subclass, { startSample: 0, endSample: 2 }), null); assert.equal(subclassCalls, 0);
});

test("author byte bound and Uint8Array ownership are enforced before interpretation", async () => {
  assert.equal(VIDEO_PREFIX_TRIM_MAX_BYTES, 24_000_000);
  for (const invalid of [null, undefined, [], {}, original().buffer, new Uint8Array(), new Uint8Array(VIDEO_PREFIX_TRIM_MAX_BYTES + 1)]) await refused(invalid);
  const source = original(), backing = new Uint8Array(source.length + 16); backing.fill(0xaa); backing.set(source, 8);
  inspectFields(await inspectVideoPrefix(backing.subarray(8, 8 + source.length)), 4, ORIGINAL_SHA);
});

test("truncation, wrong sample sizes/counts and inconsistent clocks are refused", async () => {
  for (const length of [0, 8, 32, 831, 1503, 1512]) await refused(original().subarray(0, length));
  const source = original(), t = tables(source);
  for (const [offset, value] of [
    [one(t.st, "stsz").data + 8, 5], [one(t.st, "stsz").data + 12, 0], [one(t.st, "stsz").data + 12, 652],
    [one(t.st, "stts").data + 8, 3], [one(t.st, "stts").data + 12, 0],
    [one(t.st, "stsc").data + 12, 3], [one(t.st, "stco").data + 8, 0],
    [t.mdhd.data + 16, 32767], [t.mvhd.data + 16, 1999], [t.tkhd.data + 20, 1999],
  ]) { const bytes = source.slice(); dataView(bytes).setUint32(offset, value); await refused(bytes); }
});

test("overlapping two-chunk mapping is rejected instead of duplicating source samples", async () => {
  const source = original(), t = tables(source), old = one(t.st, "stco");
  const changed = replaceBox(source, [...STBL, "stco"], box("stco", words(0, 2, t.offsets[0] + 4, t.offsets[0] + 4)));
  assert.equal(changed.length, source.length + 4); assert.equal(old.size, 20);
  const stsc = one(boxes(changed, path(changed, STBL).at(-1).data, path(changed, STBL).at(-1).end), "stsc");
  dataView(changed).setUint32(stsc.data + 12, 2);
  const changedStco = path(changed, [...STBL, "stco"]).at(-1), view = dataView(changed);
  assert.equal(view.getUint32(changedStco.data + 4), 2);
  assert.equal(view.getUint32(changedStco.data + 8), view.getUint32(changedStco.data + 12));
  assert.equal(view.getUint32(stsc.data + 12), 2);
  await refused(changed);
});

test("sync table cannot declare a dependent P sample to be the sole random-access start", async () => {
  const source = original(), t = tables(source), stss = one(t.st, "stss");
  for (const sample of [0, 2, 5]) { const bytes = source.slice(); dataView(bytes).setUint32(stss.data + 8, sample); await refused(bytes); }
  const noIdr = source.slice(), idr = t.slices[0].find(nal => nal.type === 5);
  noIdr[t.samples[0].offset + idr.start] = 0x61; // Type1 I-slice is not an IDR.
  assert.equal(tables(noIdr).slices[0].at(-1).type, 1); await refused(noIdr);
});

test("a B slice-header substitution is refused even without a ctts table", async () => {
  const source = original(), t = tables(source), bytes = source.slice();
  // Original P first_mb=0/slice_type=5/PPS=0 starts 1|00110|1.
  // Substitute first_mb=0/slice_type=6 (B)/PPS=0 as 1|00111|1,
  // preserving field widths and all container sample lengths. This is a
  // deliberate header-negative, not a newly encoded/decoded B-frame fixture.
  const at = t.samples[1].offset + t.slices[1][0].start + 1;
  assert.equal(bytes[at] & 0xfe, 0x9a); bytes[at] = (bytes[at] & 1) | 0x9e;
  const changed = tables(bytes); assert.equal(changed.samples[1].bytes.length, 10);
  assert.deepEqual(slicePrefix(changed.slices[1][0].bytes), [0, 6, 0]); await refused(bytes);
});

test("a declared SPS POC mode outside decoding-order type 2 is refused", async () => {
  const source = original(), sets = parameterSets(source), before = nalBits(sets.sps, 4);
  assert.deepEqual([before.ue(), before.ue(), before.ue()], [0, 0, 2]);
  const changed = source.slice();
  // Exact donor RBSP positions: SPS id=0, frame-bits-minus4=0, then POC ue(2)=011.
  // Change that same-width field to ue(1)=010. This is a header refusal premise,
  // not a claim that the remaining bytes encode a working alternate POC movie.
  setBits(changed, sets.spsStart + 4, 2, 3, 2);
  const after = nalBits(parameterSets(changed).sps, 4);
  assert.deepEqual([after.ue(), after.ue(), after.ue()], [0, 0, 1]);
  assert.deepEqual(tables(changed).samples.map(sample => sample.bytes), tables(source).samples.map(sample => sample.bytes));
  await refused(changed);
});

test("PPS slice-group and redundant-picture declarations are explicit refusals", async () => {
  const source = original(), sets = parameterSets(source), prefix = ppsPrefix(sets.pps);
  assert.deepEqual([prefix.id, prefix.sps, prefix.entropy, prefix.bottom, prefix.groups], [0, 0, 0, 0, 0]);
  const groups = source.slice(); setBits(groups, sets.ppsStart + 1, 4, 1, 0);
  // Clearing the donor groups field's leading 1 exposes ue(6) from existing bits.
  // No complete FMO/slice-group map or decoded-media claim is supplied.
  assert.equal(ppsPrefix(parameterSets(groups).pps).groups, 6); await refused(groups);
  const redundantFlag = nal => {
    const { groups, bits } = ppsPrefix(nal); assert.equal(groups, 0);
    assert.deepEqual([bits.ue(), bits.ue(), bits.read(), bits.fixed(2)], [2, 0, 0, 0]);
    assert.deepEqual([bits.ue(), bits.ue(), bits.ue(), bits.read(), bits.read()], [6, 0, 4, 1, 0]);
    return [bits.read(), bits.read(), bits.fixed(5)]; // redundant flag, stop bit, padding.
  };
  assert.deepEqual(redundantFlag(sets.pps), [0, 1, 0]);
  const redundant = source.slice(); setBits(redundant, sets.ppsStart + 1, 25, 1, 1);
  assert.deepEqual(redundantFlag(parameterSets(redundant).pps), [1, 1, 0]); await refused(redundant);
});

test("slice PPS mismatch and a frame-number gap cannot pass the prefix eligibility check", async () => {
  const source = original(), t = tables(source), sample = t.samples[1], nal = t.slices[1][0];
  assert.deepEqual(slicePrefix(nal.bytes, 4), [0, 5, 0, 1]);
  const gap = source.slice(); setBits(gap, sample.offset + nal.start + 1, 7, 4, 3);
  assert.deepEqual(slicePrefix(tables(gap).slices[1][0].bytes, 4), [0, 5, 0, 3]); await refused(gap);
  const mismatch = source.slice(), payload = nal.bytes.subarray(1);
  const originalBits = [...payload].map(value => value.toString(2).padStart(8, "0")).join("");
  assert.equal(originalBits.slice(6, 7), "1");
  // Replace only the PPS field's ue(0) with ue(1), dropping two payload tail
  // bits to retain the original byte count. It is a negative header mutation.
  const changedBits = originalBits.slice(0, 6) + "010" + originalBits.slice(7, -2);
  assert.equal(changedBits.length, originalBits.length);
  for (let i = 0; i < payload.length; i++) mismatch[sample.offset + nal.start + 1 + i] = Number.parseInt(changedBits.slice(i * 8, i * 8 + 8), 2);
  assert.deepEqual(slicePrefix(tables(mismatch).slices[1][0].bytes, 4), [0, 5, 1, 1]);
  assert.equal(ppsPrefix(parameterSets(mismatch).pps).id, 0); await refused(mismatch);
});

test("multiple VCL NALs and a truncated slice header refuse despite coherent container lengths", async () => {
  const t = tables(original()), doubled = replaceSample(1, concat(t.samples[1].bytes, t.samples[1].bytes));
  assert.deepEqual(tables(doubled).slices[1].map(nal => nal.type), [1, 1]); await refused(doubled);
  const truncated = replaceSample(1, concat(words(1), Uint8Array.of(0x41)));
  assert.equal(tables(truncated).slices[1][0].bytes.length, 1);
  assert.throws(() => slicePrefix(tables(truncated).slices[1][0].bytes)); await refused(truncated);
});

test("even a structurally valid zero-offset ctts table is outside the prefix subset", async () => {
  const bytes = appendSampleTable("ctts", words(0, 1, 4, 0));
  assert.equal((await inspectOutputAsset(bytes, "with-composition-table.mp4")).status, "inspected");
  assert.ok(tables(bytes).st.some(entry => entry.type === "ctts")); await refused(bytes);
});

test("unpreserved color metadata is refused with the exact encoded sample payloads intact", async () => {
  const source = original(), t = tables(source);
  const nclx = Uint8Array.of(110, 99, 108, 120, 0, 1, 0, 1, 0, 1, 128);
  const replacement = box("avc1", concat(source.subarray(t.avc1.data, t.avc1.end), box("colr", nclx)));
  // stsd has a FullBox/count prefix, so replace the enclosing stbl with its
  // explicit adjusted stsd instead of treating that prefix as child boxes.
  const stsd = box("stsd", concat(source.subarray(t.stsd.data, t.stsd.data + 8), replacement));
  const delta = stsd.length - t.stsd.size;
  const stbl = box("stbl", concat(source.subarray(t.stbl.data, t.stsd.start), stsd, source.subarray(t.stsd.end, t.stbl.end)));
  dataView(stbl).setUint32(one(t.st, "stco").start - t.stbl.start + delta + 16, t.offsets[0] + delta);
  const changed = replaceBox(source, STBL, stbl), parsed = tables(changed);
  assert.deepEqual(changed.subarray(one(parsed.extensions, "colr").data, one(parsed.extensions, "colr").end), nclx);
  assert.deepEqual(parsed.samples.map(sample => sample.bytes), t.samples.map(sample => sample.bytes)); await refused(changed);
});

test("omitting stss cannot silently declare dependent P samples independently decodable", async () => {
  const source = original(), t = tables(source), sync = one(t.st, "stss");
  const changed = replaceBox(source, [...STBL, "stss"], new Uint8Array());
  const stbl = path(changed, STBL).at(-1), st = boxes(changed, stbl.data, stbl.end), mdat = one(boxes(changed), "mdat");
  assert.equal(st.some(entry => entry.type === "stss"), false);
  assert.equal(dataView(changed).getUint32(one(st, "stco").data + 8), t.offsets[0] - sync.size);
  assert.deepEqual(changed.subarray(mdat.data, mdat.end), concat(...t.samples.map(sample => sample.bytes))); await refused(changed);
});

test("nonidentity edits, matrix, pixels and fractional movie-clock conversion are refused", async () => {
  const source = original(), t = tables(source), edits = one(t.track, "edts"), elst = one(boxes(source, edits.data, edits.end), "elst"), pasp = one(t.extensions, "pasp");
  for (const [offset, value] of [[elst.data + 12, 8192], [elst.data + 8, 1000], [t.tkhd.data + 40, 131072], [pasp.data, 2]]) {
    const bytes = source.slice(); dataView(bytes).setUint32(offset, value); await refused(bytes);
  }
  // Three movie ticks/sec represents the original 2s duration exactly, but its
  // .5s boundary cannot be represented as an integer movie-clock duration.
  const fractional = source.slice(), view = dataView(fractional);
  view.setUint32(t.mvhd.data + 12, 3); view.setUint32(t.mvhd.data + 16, 6);
  view.setUint32(t.tkhd.data + 20, 6); view.setUint32(elst.data + 8, 6);
  assert.equal(await trimVideoPrefix(fractional, { startSample: 0, endSample: 1 }), null);
});

test("external, encrypted, audio-handler, fragmented and unknown timeline declarations are refused", async () => {
  const source = original(), t = tables(source);
  const dref = path(source, ["moov", "trak", "mdia", "minf", "dinf", "dref"]).at(-1);
  const url = one(boxes(source, dref.data + 8, dref.end), "url "), external = source.slice(); dataView(external).setUint32(url.data, 0); await refused(external);
  const encrypted = source.slice(); putType(encrypted, t.avc1.start + 4, "encv"); await refused(encrypted);
  const audio = source.slice(); putType(audio, t.hdlr.data + 8, "soun"); await refused(audio);
  const fragment = source.slice(), free = one(t.top, "free"); putType(fragment, free.start + 4, "moof"); await refused(fragment);
  const timeline = source.slice(); putType(timeline, free.start + 4, "sidx"); await refused(timeline);
  // Two video tracks are not a silent single-track file. Copied encoded bytes
  // are not called a real audio fixture or a newly composed movie.
  const trackBytes = source.slice(t.trak.start, t.trak.end), replacement = box("moov", concat(source.subarray(t.moov.data, t.moov.end), trackBytes));
  const oldStco = one(t.st, "stco"), replacementView = dataView(replacement);
  replacementView.setUint32(oldStco.start - t.moov.start + 16, t.offsets[0] + trackBytes.length);
  replacementView.setUint32(t.moov.size + oldStco.start - t.trak.start + 16, t.offsets[0] + trackBytes.length);
  const duplicate = replaceBox(source, ["moov"], replacement);
  assert.equal(boxes(duplicate, 40, 32 + replacement.length).filter(entry => entry.type === "trak").length, 2);
  await refused(duplicate);
});

test("unknown user metadata cannot be silently discarded as the known empty donor metadata", async () => {
  const source = original(), parsed = tables(source), udta = one(boxes(source, parsed.moov.data, parsed.moov.end), "udta");
  const meta = one(boxes(source, udta.data, udta.end), "meta"); assert.equal(dataView(source).getUint32(meta.data), 0);
  const entries = boxes(source, meta.data + 4, meta.end), handler = one(entries, "hdlr");
  assert.equal(one(entries, "ilst").size, 8); assert.equal(ascii(source, handler.data + 8), "mdir");
  const changed = source.slice(); putType(changed, handler.data + 8, "mdta");
  assert.equal(changed.length, source.length); assert.equal(ascii(changed, handler.data + 8), "mdta");
  assert.deepEqual(tables(changed).samples.map(sample => sample.bytes), parsed.samples.map(sample => sample.bytes));
  await refused(changed);
});
