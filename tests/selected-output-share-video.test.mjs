import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectOutputAsset } from "../src/model/output-asset-inspection.ts";
import { qualifySelectedOutputShareVideo as qualify, copySelectedOutputShareVideoBytes as copy, SELECTED_OUTPUT_SHARE_VIDEO_POLICY as policy, SELECTED_OUTPUT_SHARE_VIDEO_LIMITS as limits } from "../src/model/selected-output-share-video.ts";
import { join, mp4, utf8 } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const box = (type, data) => { const result = new Uint8Array(data.length + 8); view(result).setUint32(0, result.length); result.set(utf8(type), 4); result.set(data, 8); return result; };
function boxes(bytes, start = 0, end = bytes.length) {
  const result = []; for (let at = start; at < end;) { const length = view(bytes).getUint32(at); assert.ok(length >= 8 && at + length <= end); result.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, data: at + 8, end: at + length }); at += length; } return result;
}
function locate(bytes, path) {
  let list = boxes(bytes), found;
  for (const type of path.split("/")) { found = list.find(value => value.type === type); assert.ok(found, path); const skip = type === "stsd" ? 8 : type === "avc1" ? 78 : 0; if (type !== path.split("/").at(-1)) list = boxes(bytes, found.data + skip, found.end); }
  return found;
}
const stbl = "moov/trak/mdia/minf/stbl";
/** Test-only fixture derivation. Preserve the donor's actual two encoded black
 * pictures, remove its known descriptive boxes/SEI and rebuild sample offsets.
 * Production qualification never transforms any file. */
export function cleanVideo() {
  const original = mp4(), source = locate(original, "mdat"), sizes = locate(original, stbl + "/stsz");
  const samples = []; let cursor = source.data;
  for (let index = 0; index < 2; index += 1) {
    const end = cursor + view(original).getUint32(sizes.data + 12 + index * 4), nals = [];
    while (cursor < end) { const length = view(original).getUint32(cursor), next = cursor + 4 + length; if ((original[cursor + 4] & 31) !== 6) nals.push(original.slice(cursor, next)); cursor = next; }
    samples.push(join(...nals));
  }
  function rebuild(start, end) {
    return join(...boxes(original, start, end).flatMap(item => {
      if (["udta", "btrt"].includes(item.type)) return [];
      let data = original.slice(item.data, item.end);
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(item.type)) data = rebuild(item.data, item.end);
      if (item.type === "stsd") data = join(data.slice(0, 8), rebuild(item.data + 8, item.end));
      if (item.type === "avc1") { const header = data.slice(0, 78); header.fill(0, 42, 74); data = join(header, rebuild(item.data + 78, item.end)); }
      if (item.type === "stsz") { view(data).setUint32(12, samples[0].length); view(data).setUint32(16, samples[1].length); }
      if (item.type === "mdat") data = join(...samples);
      return [box(item.type, data)];
    }));
  }
  const result = rebuild(0, original.length), offsets = locate(result, stbl + "/stco"), media = locate(result, "mdat"); view(result).setUint32(offsets.data + 8, media.data); return result;
}
function expected(bytes, overrides = {}) { return { sha256: digest(bytes), byteLength: bytes.length, width: 16, height: 16, durationSeconds: 1, ...overrides }; }
async function refused(bytes, reason) { const result = await qualify(bytes, expected(bytes)); assert.equal(result.status, "unqualified"); if (reason) assert.equal(result.reason, reason); assert.equal(copy(result), null); return result; }
function replace(bytes, path, replacement) {
  const target = locate(bytes, path), delta = replacement.length - (target.end - target.start), result = join(bytes.slice(0, target.start), replacement, bytes.slice(target.end));
  const ancestors = path.split("/"); ancestors.pop(); let prefix = "";
  for (const type of ancestors) { prefix = prefix ? prefix + "/" + type : type; const ancestor = locate(bytes, prefix); view(result).setUint32(ancestor.start, ancestor.end - ancestor.start + delta); }
  const offsets = locate(result, stbl + "/stco"), media = locate(result, "mdat"); view(result).setUint32(offsets.data + 8, media.data); return result;
}
function appendChild(bytes, path, child) { const parent = locate(bytes, path); return replace(bytes, path, box(parent.type, join(bytes.slice(parent.data, parent.end), child))); }
function modify(bytes, path, offset, value, width = 4) { const result = bytes.slice(), at = locate(result, path).data + offset; if (width === 4) view(result).setUint32(at, value); else if (width === 2) view(result).setUint16(at, value); else result[at] = value; return result; }

test("clean real two-picture derivative qualifies exact native facts and privately owns bytes", async () => {
  const bytes = cleanVideo(), native = await inspectOutputAsset(bytes, "video.mp4"); assert.equal(native.status, "inspected", native.errors.join(","));
  const result = await qualify(bytes, expected(bytes)); assert.equal(result.status, "qualified", JSON.stringify(result)); assert.equal(result.policy, policy); assert.ok(Object.isFrozen(result)); assert.deepEqual(copy(result), bytes);
  assert.equal(native.facts.frameCount, 2); assert.equal(native.facts.durationSeconds, 1); assert.equal(native.facts.audioCodec, undefined);
  assert.equal(copy(JSON.parse(JSON.stringify(result))), null); assert.equal(copy({ ...result }), null); assert.equal(copy(Object.create(result)), null);
  const owned = copy(result); owned.fill(0); assert.deepEqual(copy(result), bytes);
});
test("donor's private-compatible metadata is not qualified for sharing", async () => { const bytes = mp4(); assert.equal((await inspectOutputAsset(bytes)).status, "inspected"); await refused(bytes, "unqualified_metadata"); });
test("captures bytes and expected facts synchronously before asynchronous inspection", async () => {
  const bytes = cleanVideo(), pristine = bytes.slice(), facts = expected(bytes), pending = qualify(bytes, facts); bytes.fill(0); facts.sha256 = "0".repeat(64); const result = await pending; assert.equal(result.status, "qualified"); assert.deepEqual(copy(result), pristine);
});
test("subarray copies only the selected exact region", async () => { const bytes = cleanVideo(), framed = join(utf8("private prefix"), bytes, utf8("private suffix")); const result = await qualify(framed.subarray(14, 14 + bytes.length), expected(bytes)); assert.equal(result.status, "qualified"); assert.deepEqual(copy(result), bytes); });
for (const [name, value] of [["hash", { sha256: "0".repeat(64) }], ["width", { width: 17 }], ["height", { height: 17 }], ["duration", { durationSeconds: 2 }], ["length", { byteLength: 1 }]]) test(`exact selected ${name} mismatch refuses`, async () => { const bytes = cleanVideo(), result = await qualify(bytes, expected(bytes, value)); assert.equal(result.status, "unqualified"); assert.equal(result.reason, "selection_mismatch"); });
for (const [name, construct] of [
  ["plain array", () => Array.from(cleanVideo())], ["buffer subtype", () => Buffer.from(cleanVideo())], ["proxy", () => new Proxy(cleanVideo(), {})], ["shared bytes", () => new Uint8Array(new SharedArrayBuffer(8))], ["detached bytes", () => { const bytes = cleanVideo(); structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); return bytes; }], ["subclass", () => new (class extends Uint8Array {})(cleanVideo())], ["oversize", () => new Uint8Array(limits.bytes + 1)], ["empty", () => new Uint8Array()]
]) test(`non-native or bounded input refuses: ${name}`, async () => { const result = await qualify(construct(), expected(cleanVideo())); assert.equal(result.status, "unqualified"); assert.equal(result.reason, "invalid_input"); });
test("expected getters never execute and unknown fields refuse", async () => { const bytes = cleanVideo(), facts = expected(bytes); let reads = 0; Object.defineProperty(facts, "sha256", { enumerable: true, get() { reads++; return digest(bytes); } }); assert.equal((await qualify(bytes, facts)).reason, "invalid_input"); assert.equal(reads, 0); assert.equal((await qualify(bytes, { ...expected(bytes), owner: "private" })).reason, "invalid_input"); });
for (const type of ["uuid", "udta", "meta", "loci", "XMP_", "skip", "moof"]) test(`top-level ${type} refuses`, async () => { await refused(join(cleanVideo(), box(type, utf8("PRIVATE_LOCAL_SYNTHETIC_MARKER"))), "unqualified_metadata"); });
for (const path of ["moov", "moov/trak", "moov/trak/mdia", "moov/trak/mdia/minf", stbl, stbl + "/stsd/avc1"]) test(`unknown nested metadata refuses at ${path}`, async () => { await refused(appendChild(cleanVideo(), path, box("uuid", utf8("PRIVATE"))), "unqualified_metadata"); });
for (const [name, path, offset, value, width] of [
  ["movie creation time", "moov/mvhd", 4, 7], ["movie reserved", "moov/mvhd", 28, 7], ["track modification time", "moov/trak/tkhd", 8, 7], ["track ID", "moov/trak/tkhd", 12, 42], ["media language", "moov/trak/mdia/mdhd", 20, 1234, 2], ["handler reserved", "moov/trak/mdia/hdlr", 12, 7], ["compressor name", stbl + "/stsd/avc1", 42, 7, 1], ["sample flags", stbl + "/stsz", 0, 1]
]) test(`closed fixed field refuses: ${name}`, async () => { await refused(modify(cleanVideo(), path, offset, value, width)); });
test("handler freeform name refuses", async () => { const bytes = cleanVideo(), item = locate(bytes, "moov/trak/mdia/hdlr"), data = bytes.slice(item.data, item.end); data.set(utf8("SECRET"), 24); await refused(replace(bytes, "moov/trak/mdia/hdlr", box("hdlr", data)), "unqualified_metadata"); });
test("nonempty free padding refuses even zero-filled", async () => { const bytes = cleanVideo(); await refused(replace(bytes, "free", box("free", new Uint8Array(4))), "unqualified_metadata"); });
test("unreferenced mdat tail refuses although private native inspection accepts", async () => { const bytes = cleanVideo(), media = locate(bytes, "mdat"), changed = replace(bytes, "mdat", box("mdat", join(bytes.slice(media.data, media.end), utf8("PRIVATE")))); assert.equal((await inspectOutputAsset(changed)).status, "inspected"); await refused(changed, "unqualified_metadata"); });
test("unreferenced prefix and discontinuous chunk offsets refuse", async () => { const bytes = cleanVideo(); await refused(modify(bytes, stbl + "/stco", 8, locate(bytes, "mdat").data + 1), "unqualified_metadata"); });
test("SEI private user data inside a referenced sample refuses", async () => {
  const bytes = cleanVideo(), media = locate(bytes, "mdat"), nal = join(new Uint8Array([0, 0, 0, 8, 6]), utf8("PRIVATE")); let changed = replace(bytes, "mdat", box("mdat", join(nal, bytes.slice(media.data, media.end)))); const sizes = locate(changed, stbl + "/stsz"); view(changed).setUint32(sizes.data + 12, view(changed).getUint32(sizes.data + 12) + nal.length); assert.equal((await inspectOutputAsset(changed)).status, "inspected"); await refused(changed, "unqualified_metadata");
});
for (const type of [7, 8, 9, 12, 14, 20]) test(`in-sample non-picture NAL ${type} refuses`, async () => { const bytes = cleanVideo(), media = locate(bytes, "mdat"); bytes[media.data + 4] = type; await refused(bytes, "unqualified_metadata"); });
test("SPS and PPS unconsumed tails refuse", async () => {
  for (const set of ["sps", "pps"]) {
    const bytes = cleanVideo(), path = stbl + "/stsd/avc1/avcC", item = locate(bytes, path), data = bytes.slice(item.data, item.end), spsLength = view(data).getUint16(6), sizeOffset = set === "sps" ? 6 : 9 + spsLength, length = view(data).getUint16(sizeOffset), end = sizeOffset + 2 + length;
    const changedData = join(data.slice(0, end), utf8("PRIVATE"), data.slice(end)); view(changedData).setUint16(sizeOffset, length + 7); const changed = replace(bytes, path, box("avcC", changedData)); assert.equal((await inspectOutputAsset(changed)).status, "inspected"); await refused(changed);
  }
});
test("duplicate mandatory box, extended/zero size and trailing bytes refuse", async () => {
  const bytes = cleanVideo(), movie = locate(bytes, "moov/mvhd"); await refused(appendChild(bytes, "moov", bytes.slice(movie.start, movie.end)));
  for (const size of [0, 1, 7, bytes.length + 1]) { const changed = bytes.slice(); view(changed).setUint32(0, size); await refused(changed); }
  await refused(join(bytes, utf8("tail"))); await refused(bytes.slice(0, -1));
});
test("malformed sample counts, tables, offsets, sync references and timings refuse", async () => {
  const bytes = cleanVideo(); for (const [path, offset, value] of [["stsz", 8, 100001], ["stsz", 12, 0], ["stsc", 8, 2], ["stsc", 12, 3], ["stco", 4, 2], ["stco", 8, 0], ["stss", 8, 3], ["stts", 12, 1]]) await refused(modify(bytes, stbl + "/" + path, offset, value));
});
test("sync sample table must match actual IDR samples, including absent-table semantics", async () => {
  const bytes = cleanVideo();
  await refused(modify(bytes, stbl + "/stss", 8, 2));
  await refused(replace(bytes, stbl + "/stss", new Uint8Array()));
});
test("parameter sets and IDR require nonzero reference priority", async () => {
  const bytes = cleanVideo(), config = locate(bytes, stbl + "/stsd/avc1/avcC"), media = locate(bytes, "mdat");
  for (const at of [config.data + 8, config.data + 11 + view(bytes).getUint16(config.data + 6), media.data + 4]) { const changed = bytes.slice(); changed[at] &= 31; await refused(changed); }
});

function composition(entries, version = 0) {
  const data = new Uint8Array(8 + entries.length * 8); data[0] = version; view(data).setUint32(4, entries.length);
  entries.forEach(([count, offset], index) => { view(data).setUint32(8 + index * 8, count); view(data).setInt32(12 + index * 8, offset); });
  return box("ctts", data);
}
function timed(bytes = cleanVideo(), entries = [[2, 1024]], version = 0, start = 1024) {
  return modify(appendChild(bytes, stbl, composition(entries, version)), "moov/trak/edts/elst", 12, start);
}
function rateBox(bytes = cleanVideo(), overrides = {}) {
  const media = locate(bytes, "mdat"), payload = media.end - media.data, facts = { buffer: payload, maximum: payload * 8, average: payload * 8, ...overrides }, data = new Uint8Array(12);
  view(data).setUint32(0, facts.buffer); view(data).setUint32(4, facts.maximum); view(data).setUint32(8, facts.average); return box("btrt", data);
}
const emptyAppleWrapper = () => new Uint8Array(Buffer.from("0000003d75647461000000356d657461000000000000002168646c7200000000000000006d6469726170706c00000000000000000000000008696c7374", "hex"));
async function qualifies(bytes, facts = expected(bytes)) { const result = await qualify(bytes, facts); assert.equal(result.status, "qualified", JSON.stringify(result)); assert.equal(result.policy, "selected-output-share-avc-mp4-v2"); assert.deepEqual(copy(result), bytes); return result; }

test("v2 permits only the exact empty Apple item wrapper without changing any byte", async () => { await qualifies(appendChild(cleanVideo(), "moov", emptyAppleWrapper())); });
for (const at of [16, 24, 36, 40, 44, 60]) test(`empty metadata wrapper mutation refuses at byte ${at}`, async () => { const wrapper = emptyAppleWrapper(); wrapper[at] ^= 1; await refused(appendChild(cleanVideo(), "moov", wrapper), "unqualified_metadata"); });
test("empty metadata wrapper plus appended descriptive item refuses", async () => { const wrapper = emptyAppleWrapper(); await refused(appendChild(cleanVideo(), "moov", box("udta", join(wrapper.slice(8), box("name", utf8("PRIVATE"))))), "unqualified_metadata"); });
test("version0 positive composition shift preserves complete presentation using matching edit origin", async () => { await qualifies(timed()); });
test("version1 signed composition offsets can reorder the full timeline without dropping samples", async () => { await qualifies(timed(cleanVideo(), [[1, 8192], [1, -8192]], 1, 0)); });
test("version1 positive shift and zero-offset table remain valid", async () => { await qualifies(timed(cleanVideo(), [[2, 1024]], 1)); await qualifies(timed(cleanVideo(), [[2, 0]], 0, 0)); });
test("fractional media duration permits movie-clock floor or ceiling rounding", async () => {
  let bytes = cleanVideo(); for (const path of ["moov/mvhd", "moov/trak/tkhd"]) bytes = modify(bytes, path, path.endsWith("mvhd") ? 16 : 20, 667);
  bytes = modify(bytes, "moov/trak/edts/elst", 8, 667); bytes = modify(bytes, "moov/trak/mdia/mdhd", 12, 3); bytes = modify(bytes, "moov/trak/mdia/mdhd", 16, 2); bytes = modify(bytes, stbl + "/stts", 12, 1);
  await qualifies(bytes, expected(bytes, { durationSeconds: 0.667 }));
  bytes = modify(bytes, "moov/mvhd", 16, 666); bytes = modify(bytes, "moov/trak/tkhd", 20, 666); bytes = modify(bytes, "moov/trak/edts/elst", 8, 666);
  await qualifies(bytes, expected(bytes, { durationSeconds: 0.666 }));
});
for (const [name, entries, version, start] of [
  ["zero run", [[0, 0], [2, 1024]], 0, 1024], ["missing sample", [[1, 1024]], 0, 1024], ["extra sample", [[3, 1024]], 0, 1024],
  ["duplicate presentation time", [[1, 0], [1, -8192]], 1, 0], ["gap", [[1, 0], [1, 1]], 0, 0], ["end omission", [[2, 1023]], 0, 1024],
  ["negative presentation", [[1, -1], [1, 0]], 1, 0], ["unsigned ffffffff is not negative one", [[1, -1], [1, 0]], 0, 0],
  ["maximum signed offset", [[2, 2147483647]], 1, 0], ["minimum signed offset", [[2, -2147483648]], 1, 0],
  ["unsupported version", [[2, 1024]], 2, 1024], ["empty table", [], 0, 1024]
]) test(`composition timeline refuses ${name}`, async () => { await refused(timed(cleanVideo(), entries, version, start)); });
test("composition flags, duplicate boxes, trailing bytes and excessive entry count refuse", async () => {
  const bytes = timed(); await refused(modify(bytes, stbl + "/ctts", 0, 1)); await refused(modify(bytes, stbl + "/ctts", 4, 100001));
  await refused(appendChild(bytes, stbl, composition([[2, 1024]]))); const table = locate(bytes, stbl + "/ctts"); await refused(replace(bytes, stbl + "/ctts", box("ctts", join(bytes.slice(table.data, table.end), new Uint8Array(4)))));
});
for (const start of [1023, 1025, 0xffffffff, 16385]) test(`nonmatching/unsupported edit origin ${start} refuses`, async () => { await refused(modify(timed(), "moov/trak/edts/elst", 12, start)); });
test("shifted presentation without matching edit and an edit that trims ordinary time refuse", async () => { await refused(replace(timed(), "moov/trak/edts/elst", new Uint8Array())); await refused(modify(cleanVideo(), "moov/trak/edts/elst", 12, 1)); });
test("integral movie duration allows no one-tick or two-tick trim or extension", async () => {
  for (const ticks of [998, 999, 1001, 1002]) { let bytes = cleanVideo(); bytes = modify(bytes, "moov/mvhd", 16, ticks); bytes = modify(bytes, "moov/trak/tkhd", 20, ticks); bytes = modify(bytes, "moov/trak/edts/elst", 8, ticks); await refused(bytes, "unsupported_mp4"); }
});
test("closed numeric bitrate box preserves exact bytes with matching actual average", async () => { const bytes = cleanVideo(); await qualifies(appendChild(bytes, stbl + "/stsd/avc1", rateBox(bytes))); });
for (const [name, overrides] of [["buffer too small", { buffer: 1 }], ["buffer beyond payload", { buffer: 999999 }], ["zero average", { average: 0 }], ["incorrect average", { average: 1 }], ["maximum below average", { maximum: 1 }]]) test(`numeric bitrate subset refuses ${name}`, async () => { const bytes = cleanVideo(); await refused(appendChild(bytes, stbl + "/stsd/avc1", rateBox(bytes, overrides)), "unsupported_mp4"); });
test("bitrate extra payload, short payload and duplicate fields refuse", async () => {
  const bytes = cleanVideo(), rate = rateBox(bytes); await refused(appendChild(bytes, stbl + "/stsd/avc1", box("btrt", join(rate.slice(8), utf8("PRIVATE")))));
  await refused(appendChild(bytes, stbl + "/stsd/avc1", box("btrt", rate.slice(8, -1)))); await refused(appendChild(appendChild(bytes, stbl + "/stsd/avc1", rate), stbl + "/stsd/avc1", rate));
});
test("ordinary descriptive user data and SEI remain refused after timing expansion", async () => { await refused(mp4(), "unqualified_metadata"); await refused(appendChild(timed(), "moov", box("udta", utf8("PRIVATE"))), "unqualified_metadata"); });
