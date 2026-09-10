import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { composeFilmClips, FILM_COMPOSITION_MAX_CLIPS } from "../src/model/film-composition.ts";
import { inspectVideoPrefix, trimVideoPrefix, VIDEO_PREFIX_TRIM_MAX_BYTES } from "../src/model/video-container.ts";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";

const SHA = "9cabce6d2873d95f9d1210f230361b9afcbb6f34bdbdf9849f09b6ad5aefd999";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const clip = (id, bytes = ownedSocialVideo("16:9")) => ({ id, bytes, sha256: digest(bytes) });
const duration = seconds => ({ timescale: 16384, durationTicks: seconds * 16384 });
const dataView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Independent finite MP4 table reader adapted from the accepted Video trim
// control. Expected payloads/timing come directly from source bytes, not from
// the composer or its returned source map. It is not a video decoder.
function boxes(bytes, start = 0, end = bytes.length) {
  const out = [], view = dataView(bytes);
  while (start < end) {
    assert.ok(out.length < 100 && start + 8 <= end); const size = view.getUint32(start);
    assert.ok(size >= 8 && start + size <= end);
    out.push({ type: String.fromCharCode(...bytes.subarray(start + 4, start + 8)), start, data: start + 8, end: start + size }); start += size;
  }
  assert.equal(start, end); return out;
}
function one(list, name) { const rows = list.filter(row => row.type === name); assert.equal(rows.length, 1, name); return rows[0]; }
function table(bytes) {
  const view = dataView(bytes), top = boxes(bytes), moov = one(top, "moov"), movie = boxes(bytes, moov.data, moov.end);
  const trak = one(movie, "trak"), track = boxes(bytes, trak.data, trak.end), mdia = one(track, "mdia"), media = boxes(bytes, mdia.data, mdia.end);
  const minf = one(media, "minf"), stbl = one(boxes(bytes, minf.data, minf.end), "stbl"), tables = boxes(bytes, stbl.data, stbl.end);
  const row = (name, columns) => {
    const box = one(tables, name), count = view.getUint32(box.data + 4); assert.ok(count <= 100);
    assert.equal(box.end - box.data, 8 + count * columns * 4);
    return Array.from({ length: count }, (_, index) => Array.from({ length: columns }, (_, column) => view.getUint32(box.data + 8 + (index * columns + column) * 4)));
  };
  const sizesBox = one(tables, "stsz"), uniform = view.getUint32(sizesBox.data + 4), count = view.getUint32(sizesBox.data + 8);
  assert.ok(count > 0 && count <= 100); assert.equal(sizesBox.end - sizesBox.data, 12 + (uniform ? 0 : count * 4));
  const sizes = Array.from({ length: count }, (_, index) => uniform || view.getUint32(sizesBox.data + 12 + index * 4));
  const durations = row("stts", 2).flatMap(([amount, ticks]) => Array(amount).fill(ticks)); assert.equal(durations.length, count);
  const mappings = row("stsc", 3), chunks = row("stco", 1).flat(), samples = [];
  for (let index = 0; index < chunks.length; index++) {
    const mapping = mappings.filter(item => item[0] <= index + 1).at(-1); assert.equal(mapping[2], 1); let offset = chunks[index];
    for (let n = 0; n < mapping[1]; n++) {
      const end = offset + sizes[samples.length]; assert.ok(top.some(box => box.type === "mdat" && offset >= box.data && end <= box.end));
      samples.push(bytes.slice(offset, end)); offset = end;
    }
  }
  assert.equal(samples.length, count);
  const stsd = one(tables, "stsd"), avc1 = one(boxes(bytes, stsd.data + 8, stsd.end), "avc1"), extensions = boxes(bytes, avc1.data + 78, avc1.end);
  const avcC = one(extensions, "avcC"), mvhd = one(movie, "mvhd"), tkhd = one(track, "tkhd"), mdhd = one(media, "mdhd");
  return { top, movie, track, media, tables, extensions, samples, durations, sync: row("stss", 1).flat(),
    configuration: bytes.slice(avcC.start, avcC.end), description: bytes.slice(avc1.data, avc1.data + 78),
    movieScale: view.getUint32(mvhd.data + 12), movieTicks: view.getUint32(mvhd.data + 16), trackTicks: view.getUint32(tkhd.data + 20),
    timescale: view.getUint32(mdhd.data + 12), ticks: view.getUint32(mdhd.data + 16) };
}
function distinctSei() {
  const bytes = ownedSocialVideo("16:9"), label = new TextEncoder().encode("x264 - core"), matches = [];
  for (let i = 0; i <= bytes.length - label.length; i++) if (label.every((value, at) => value === bytes[i + at])) matches.push(i);
  assert.equal(matches.length, 1); bytes[matches[0]] = "X".charCodeAt(0);
  // Only opaque encoder user-data text changes; no invented new picture/quality.
  return bytes;
}

test("composition preserves exact ordered compressed samples, codec and clocks across distinct source bytes", async () => {
  const first = clip("first"), second = clip("second", distinctSei());
  const prefix = await trimVideoPrefix(first.bytes, { startSample: 0, endSample: 2 }); assert.ok(prefix);
  const last = clip("last", prefix.bytes), input = [first, second, last], originals = input.map(row => row.bytes.slice());
  assert.equal(first.sha256, SHA); assert.notEqual(second.sha256, first.sha256);
  const sourceTables = input.map(row => table(row.bytes)), expectedSamples = sourceTables.flatMap(row => row.samples);
  const result = await composeFilmClips(input, duration(5)); assert.ok(result);
  const actual = table(result.bytes);
  assert.deepEqual(actual.samples, expectedSamples); assert.deepEqual(actual.durations, Array(10).fill(8192));
  assert.deepEqual(actual.sync, [1, 5, 9]); assert.deepEqual(actual.configuration, sourceTables[0].configuration);
  assert.deepEqual(actual.description, sourceTables[0].description); assert.deepEqual(actual.top.map(row => row.type), ["ftyp", "moov", "mdat"]);
  assert.equal(actual.extensions.some(row => row.type === "btrt"), false);
  assert.equal(actual.movieTicks, 5000); assert.equal(actual.trackTicks, 5000); assert.equal(actual.movieScale, 1000);
  assert.equal(actual.timescale, 16384); assert.equal(actual.ticks, 81920);
  assert.equal(result.sha256, digest(result.bytes)); assert.equal(result.info.durationSeconds, 5);
  assert.deepEqual(result.sources, input.map((row, index) => ({ id: row.id, sha256: row.sha256, byteLength: row.bytes.length,
    startSample: index * 4, endSample: index === 2 ? 10 : (index + 1) * 4, startTick: index * 32768, endTick: index === 2 ? 81920 : (index + 1) * 32768 })));
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.sources), true); assert.ok(result.sources.every(Object.isFrozen));
  input.forEach((row, index) => assert.deepEqual(row.bytes, originals[index]));
  const reversed = await composeFilmClips([second, first, last], duration(5)); assert.ok(reversed);
  assert.notEqual(result.sha256, reversed.sha256); assert.deepEqual(table(reversed.bytes).samples, [sourceTables[1], sourceTables[0], sourceTables[2]].flatMap(row => row.samples));
});

test("fifteen explicitly repeated local slots form one exact30-second container without inferred looping", async () => {
  const input = Array.from({ length: 15 }, (_, index) => clip(`declared-slot-${index + 1}`));
  const result = await composeFilmClips(input, duration(30)); assert.ok(result);
  const decodedTables = table(result.bytes), source = table(input[0].bytes);
  assert.equal(result.info.sampleCount, 60); assert.equal(result.info.durationSeconds, 30);
  assert.equal(decodedTables.ticks, 491520); assert.equal(decodedTables.movieTicks, 30000);
  assert.deepEqual(decodedTables.samples, input.flatMap(() => source.samples));
  assert.deepEqual(decodedTables.sync, Array.from({ length: 15 }, (_, i) => i * 4 + 1));
  assert.equal(result.sources.at(-1).endTick, 491520);
  assert.equal(await composeFilmClips([clip("only-one")], duration(30)), null);
  assert.equal(await composeFilmClips([clip("one"), clip("two")], duration(30)), null);
});

test("source bytes, order, ids, hashes and expected clock are captured before the first await", async () => {
  const a = clip("a"), b = clip("b", distinctSei()), expected = duration(4), input = [a, b];
  const retained = [a.bytes.slice(), b.bytes.slice()], hashes = [a.sha256, b.sha256];
  const pending = composeFilmClips(input, expected);
  a.bytes.fill(0); b.bytes.fill(0); a.id = "changed"; b.sha256 = "0".repeat(64); input.reverse(); expected.durationTicks = 1;
  const result = await pending; assert.ok(result);
  assert.deepEqual(result.sources.map(row => row.id), ["a", "b"]); assert.deepEqual(result.sources.map(row => row.sha256), hashes);
  assert.deepEqual(table(result.bytes).samples, retained.flatMap(bytes => table(bytes).samples));
});

test("wrong source hash, dimensions, codec description, timing and malformed source all refuse", async () => {
  const wrongHash = clip("b"); wrongHash.sha256 = "0".repeat(64);
  assert.equal(await composeFilmClips([clip("a"), wrongHash], duration(4)), null);
  assert.equal(await composeFilmClips([clip("a"), clip("b", ownedSocialVideo("9:16"))], duration(4)), null);
  const broken = ownedSocialVideo("16:9"); broken[4] = 0;
  assert.equal(await composeFilmClips([clip("a"), clip("b", broken)], duration(4)), null);
  const description = ownedSocialVideo("16:9"), avc = table(description).tables.find(row => row.type === "stsd");
  // Compressor label differs while the standalone strict parser still accepts.
  description[avc.data + 8 + 8 + 43] ^= 1;
  assert.ok(await inspectVideoPrefix(description));
  assert.equal(await composeFilmClips([clip("a"), clip("b", description)], duration(4)), null);
  assert.equal(await composeFilmClips([clip("a"), clip("b")], { timescale: 1000, durationTicks: 4000 }), null);
  for (const seconds of [0, 3.5, 4.5, NaN, Infinity]) assert.equal(await composeFilmClips([clip("a"), clip("b")], duration(seconds)), null);
});

test("invalid and accessor-backed declarations refuse without calling getters", async () => {
  let getters = 0; const a = clip("a"), b = clip("b");
  const accessed = { id: "b", sha256: b.sha256, get bytes() { getters++; return b.bytes; } };
  assert.equal(await composeFilmClips([a, accessed], duration(4)), null);
  const list = [a, b]; Object.defineProperty(list, "1", { get() { getters++; return b; } });
  assert.equal(await composeFilmClips(list, duration(4)), null);
  assert.equal(await composeFilmClips([a, b], { timescale: 16384, get durationTicks() { getters++; return 65536; } }), null);
  assert.equal(getters, 0);
  for (const input of [[], [a], [a, a], [a, { ...b, extra: 1 }], [a, { ...b, id: "../outside" }], [a, { ...b, sha256: b.sha256.toUpperCase() }]])
    assert.equal(await composeFilmClips(input, duration(4)), null);
  assert.equal(await composeFilmClips(Array.from({ length: FILM_COMPOSITION_MAX_CLIPS + 1 }, (_, i) => clip(`slot${i}`)), duration(66)), null);
  assert.equal(await composeFilmClips([a, b], { ...duration(4), ignored: true }), null);
  const subclass = new (class extends Uint8Array {})(b.bytes);
  assert.equal(await composeFilmClips([a, { ...b, bytes: subclass }], duration(4)), null);
  const shared = new Uint8Array(new SharedArrayBuffer(b.bytes.length)); shared.set(b.bytes);
  Object.defineProperty(shared, "buffer", { value: b.bytes.buffer });
  assert.equal(await composeFilmClips([a, { ...b, bytes: shared }], duration(4)), null);
});

test("total byte budget refuses oversized input sets", async () => {
  const bytes = new Uint8Array(VIDEO_PREFIX_TRIM_MAX_BYTES / 2 + 1);
  const input = [{ id: "a", bytes, sha256: SHA }, { id: "b", bytes, sha256: SHA }];
  assert.equal(await composeFilmClips(input, duration(4)), null);
});
