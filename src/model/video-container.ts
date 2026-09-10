import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";

/** A deliberately small remux subset, not a decoder, general movie editor or saved artifact. */
export const VIDEO_PREFIX_TRIM_MAX_BYTES = MAX_OUTPUT_ASSET_BYTES;
export const VIDEO_PREFIX_TRIM_MAX_SAMPLES = 100_000;
export const VIDEO_PREFIX_TRIM_MAX_NALS = 200_000;
const MAX_BOXES = 8192;
const MAX_ALLOCATED_BYTES = 96_000_000;
type Box = { type: string; start: number; data: number; end: number };
type Sample = { start: number; size: number; ticks: number; idr: boolean };
type AvcSubset = { pps: number; frameBits: number };
export type VideoPrefixInfo = Readonly<{
  sampleCount: number; timescale: number; durationTicks: number; durationSeconds: number;
  width: number; height: number; sourceSha256: string; sampleDurationTicks: readonly number[];
}>;
export type VideoPrefixResult = Readonly<{
  changed: boolean; bytes: Uint8Array; sourceSha256: string; sha256: string; info: VideoPrefixInfo;
}>;
type Layout = {
  bytes: Uint8Array; ftyp: Box; mvhd: Box; tkhd: Box; mdhd: Box; hdlr: Box; vmhd: Box; dinf: Box;
  entry: Box; configuration: Box; aspect?: Box; elst?: Box; samples: Sample[];
  movieScale: number; timescale: number; durationTicks: number; width: number; height: number; sha256: string;
};
function requireValue(value: unknown): asserts value { if (!value) throw new TypeError("Unsupported video prefix input"); }
class Allocator {
  private allocated = 0;
  make(length: number): Uint8Array {
    requireValue(Number.isSafeInteger(length) && length >= 0 && length <= VIDEO_PREFIX_TRIM_MAX_BYTES);
    requireValue(this.allocated + length <= MAX_ALLOCATED_BYTES); this.allocated += length;
    return new Uint8Array(length);
  }
  copy(source: Uint8Array): Uint8Array { const result = this.make(source.byteLength); result.set(source); return result; }
}
function snapshot(input: Uint8Array, allocator: Allocator): Uint8Array {
  requireValue(input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype);
  // Use intrinsic getters: an own buffer/byteLength property must not disguise
  // shared memory or change the bounded copy's interpretation.
  const prototype = Object.getPrototypeOf(Uint8Array.prototype);
  const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(input);
  const length = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(input);
  requireValue(buffer instanceof ArrayBuffer && length > 0 && length <= VIDEO_PREFIX_TRIM_MAX_BYTES);
  const result = allocator.make(length); result.set(input); return result;
}
const dataView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes: Uint8Array, start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
function boxes(bytes: Uint8Array, start: number, end: number, budget: { boxes: number }): Box[] {
  const result: Box[] = [], view = dataView(bytes);
  while (start < end) {
    requireValue(++budget.boxes <= MAX_BOXES && start + 8 <= end);
    const size = view.getUint32(start), type = ascii(bytes, start + 4);
    // Extended/implicit sizes are outside this writer's explicit bounded subset.
    requireValue(size >= 8 && start + size <= end && /^[\x20-\x7e]{4}$/u.test(type));
    result.push({ type, start, data: start + 8, end: start + size }); start += size;
  }
  requireValue(start === end); return result;
}
function only(values: Box[], allowed: readonly string[]): void { requireValue(values.every(value => allowed.includes(value.type))); }
function one(values: Box[], type: string, required = true): Box | undefined {
  const selected = values.filter(value => value.type === type);
  requireValue(selected.length <= 1 && (!required || selected.length === 1)); return selected[0];
}
function full(bytes: Uint8Array, box: Box, flags = 0): void {
  requireValue(box.end >= box.data + 4 && dataView(bytes).getUint32(box.data) === flags);
}
function identity(view: DataView, offset: number): void {
  const matrix = [65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000];
  requireValue(matrix.every((value, index) => view.getInt32(offset + index * 4) === value));
}
/** Reads only the bounded Exp-Golomb prefix needed for baseline slice/PPS identity. */
class Bits {
  private cursor: number; private bit = 8; private byte = 0; private zeros = 0; private reads = 0;
  constructor(privateSource: Uint8Array, start: number, privateEnd: number) {
    this.source = privateSource; this.cursor = start; this.end = privateEnd;
  }
  private source: Uint8Array; private end: number;
  private next(): number {
    requireValue(this.cursor < this.end); let value = this.source[this.cursor++]!;
    if (this.zeros >= 2 && value === 3) {
      requireValue(this.cursor < this.end && this.source[this.cursor]! <= 3);
      value = this.source[this.cursor++]!; this.zeros = 0;
    }
    this.zeros = value === 0 ? this.zeros + 1 : 0; return value;
  }
  read(): number {
    requireValue(++this.reads <= 192);
    if (this.bit === 8) { this.byte = this.next(); this.bit = 0; }
    return this.byte >> (7 - this.bit++) & 1;
  }
  ue(): number {
    let zeros = 0; while (this.read() === 0) requireValue(++zeros <= 30);
    let value = 1; for (let index = 0; index < zeros; index++) value = value * 2 + this.read();
    return value - 1;
  }
  fixed(count: number): number {
    requireValue(Number.isSafeInteger(count) && count >= 0 && count <= 16);
    let value = 0; for (let index = 0; index < count; index++) value = value * 2 + this.read(); return value;
  }
  se(): number { const value = this.ue(); return value % 2 ? (value + 1) / 2 : -value / 2; }
  finish(): void {
    requireValue(this.read() === 1);
    while (this.bit < 8) requireValue(this.read() === 0);
    requireValue(this.cursor === this.end);
  }
}
function avcSubset(bytes: Uint8Array, box: Box): AvcSubset {
  const view = dataView(bytes), at = box.data;
  // Baseline AVC, four-byte NAL lengths, exactly one out-of-band SPS and PPS.
  requireValue(box.end - at >= 13 && bytes[at] === 1 && bytes[at + 1] === 66
    && bytes[at + 4] === 255 && bytes[at + 5] === 225);
  const spsLength = view.getUint16(at + 6), spsStart = at + 8, spsEnd = spsStart + spsLength;
  requireValue(spsLength >= 5 && spsEnd + 3 <= box.end && bytes[spsStart] === 0x67
    && bytes[spsStart + 1] === 66 && bytes[spsStart + 2] === bytes[at + 2] && bytes[spsStart + 3] === bytes[at + 3]);
  const sequence = new Bits(bytes, spsStart + 4, spsEnd), sps = sequence.ue(), frameBits = sequence.ue() + 4;
  requireValue(sps <= 31 && frameBits <= 16 && sequence.ue() === 2); // POC type 2: decoding order, no reordering fields.
  requireValue(sequence.ue() <= 16 && sequence.read() === 0); // No frame-number gaps.
  requireValue(sequence.ue() < 1024 && sequence.ue() < 1024 && sequence.read() === 1); // Progressive frames only.
  requireValue(bytes[spsEnd] === 1);
  const ppsLength = view.getUint16(spsEnd + 1), ppsStart = spsEnd + 3;
  requireValue(ppsLength >= 2 && ppsStart + ppsLength === box.end && bytes[ppsStart] === 0x68);
  const bits = new Bits(bytes, ppsStart + 1, box.end), pps = bits.ue();
  requireValue(pps <= 255 && bits.ue() === sps && bits.read() === 0 && bits.read() === 0 && bits.ue() === 0);
  // CAVLC, no bottom-field order, slice groups, weighted prediction or redundant pictures.
  requireValue(bits.ue() <= 31 && bits.ue() <= 31 && bits.read() === 0 && bits.fixed(2) === 0);
  const qp = bits.se(), qs = bits.se(), chroma = bits.se();
  requireValue(qp >= -26 && qp <= 25 && qs >= -26 && qs <= 25 && chroma >= -12 && chroma <= 12);
  bits.read(); bits.read(); requireValue(bits.read() === 0); bits.finish();
  return { pps, frameBits };
}
function samplePicture(bytes: Uint8Array, start: number, end: number, avc: AvcSubset, budget: { nals: number }): { idr: boolean; frame: number } {
  const view = dataView(bytes); let pictures = 0, idr = false, frame = -1;
  while (start < end) {
    requireValue(++budget.nals <= VIDEO_PREFIX_TRIM_MAX_NALS && start + 4 <= end);
    const size = view.getUint32(start); start += 4;
    requireValue(size > 0 && start + size <= end && (bytes[start]! & 128) === 0);
    const type = bytes[start]! & 31;
    if (type === 1 || type === 5) {
      requireValue(++pictures === 1 && size >= 2 && (bytes[start]! & 96) !== 0);
      const bits = new Bits(bytes, start + 1, start + size), firstMacroblock = bits.ue(), slice = bits.ue();
      requireValue(firstMacroblock === 0 && slice <= 9 && (slice % 5 === 0 || slice % 5 === 2) && bits.ue() === avc.pps);
      idr = type === 5; requireValue(!idr || slice % 5 === 2);
      frame = bits.fixed(avc.frameBits);
      if (idr) requireValue(frame === 0 && bits.ue() <= 65535);
    } else {
      // No in-band configuration, partitions, scalable layers or hidden pictures.
      requireValue(pictures === 0 && (type === 6 || type === 9));
    }
    start += size;
  }
  requireValue(start === end && pictures === 1); return { idr, frame };
}
async function parse(bytes: Uint8Array): Promise<Layout> {
  const budget = { boxes: 0 }, view = dataView(bytes);
  const read = (box: Box) => boxes(bytes, box.data, box.end, budget);
  const top = boxes(bytes, 0, bytes.length, budget); only(top, ["ftyp", "moov", "mdat", "free"]);
  const ftyp = one(top, "ftyp")!, moov = one(top, "moov")!, media = top.filter(box => box.type === "mdat");
  requireValue(top[0] === ftyp && media.length > 0);
  const movie = read(moov); only(movie, ["mvhd", "trak", "udta"]);
  const userData = one(movie, "udta", false);
  if (userData) {
    // Only the known empty Apple item-list wrapper is disposable. Unknown user
    // metadata could affect appearance or carry stale values after an edit.
    const values = read(userData); only(values, ["meta"]);
    const meta = one(values, "meta")!; full(bytes, meta);
    const items = boxes(bytes, meta.data + 4, meta.end, budget); only(items, ["hdlr", "ilst"]);
    const handler = one(items, "hdlr")!, list = one(items, "ilst")!;
    requireValue(list.data === list.end && handler.end - handler.data === 25);
    const knownHandler = [0, 0, 0, 0, 0, 0, 0, 0, 109, 100, 105, 114, 97, 112, 112, 108, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    requireValue(knownHandler.every((value, index) => bytes[handler.data + index] === value));
  }
  const mvhd = one(movie, "mvhd")!, track = read(one(movie, "trak")!); full(bytes, mvhd);
  requireValue(mvhd.end - mvhd.data === 100); identity(view, mvhd.data + 36);
  const movieScale = view.getUint32(mvhd.data + 12), movieTicks = view.getUint32(mvhd.data + 16);
  only(track, ["tkhd", "mdia", "edts"]);
  const tkhd = one(track, "tkhd")!; full(bytes, tkhd, 3);
  requireValue(tkhd.end - tkhd.data === 84 && view.getUint32(tkhd.data + 12) > 0); identity(view, tkhd.data + 40);
  const mdia = read(one(track, "mdia")!); only(mdia, ["mdhd", "hdlr", "minf"]);
  const mdhd = one(mdia, "mdhd")!, hdlr = one(mdia, "hdlr")!; full(bytes, mdhd); full(bytes, hdlr);
  requireValue(mdhd.end - mdhd.data === 24 && ascii(bytes, hdlr.data + 8) === "vide");
  const timescale = view.getUint32(mdhd.data + 12), durationTicks = view.getUint32(mdhd.data + 16);
  requireValue(movieScale > 0 && timescale > 0 && movieTicks > 0 && durationTicks > 0
    && BigInt(durationTicks) * BigInt(movieScale) === BigInt(movieTicks) * BigInt(timescale)
    && view.getUint32(tkhd.data + 20) === movieTicks);
  const edits = one(track, "edts", false); let elst: Box | undefined;
  if (edits) {
    const values = read(edits); only(values, ["elst"]); elst = one(values, "elst")!; full(bytes, elst);
    requireValue(elst.end - elst.data === 20 && view.getUint32(elst.data + 4) === 1
      && view.getUint32(elst.data + 8) === movieTicks && view.getInt32(elst.data + 12) === 0
      && view.getUint32(elst.data + 16) === 65536);
  }
  const minf = read(one(mdia, "minf")!); only(minf, ["vmhd", "dinf", "stbl"]);
  const vmhd = one(minf, "vmhd")!, dinf = one(minf, "dinf")!; full(bytes, vmhd, 1);
  requireValue(vmhd.end - vmhd.data === 12 && bytes.subarray(vmhd.data + 4, vmhd.end).every(value => value === 0));
  const references = read(dinf); only(references, ["dref"]);
  const dref = one(references, "dref")!; full(bytes, dref);
  requireValue(view.getUint32(dref.data + 4) === 1);
  const urls = boxes(bytes, dref.data + 8, dref.end, budget); only(urls, ["url "]);
  const url = one(urls, "url ")!; full(bytes, url, 1); requireValue(url.end - url.data === 4);
  const tables = read(one(minf, "stbl")!); only(tables, ["stsd", "stts", "stss", "stsc", "stsz", "stco", "co64"]);
  const stsd = one(tables, "stsd")!; full(bytes, stsd); requireValue(view.getUint32(stsd.data + 4) === 1);
  const descriptions = boxes(bytes, stsd.data + 8, stsd.end, budget); only(descriptions, ["avc1"]);
  const entry = one(descriptions, "avc1")!;
  const extensions = boxes(bytes, entry.start + 86, entry.end, budget); only(extensions, ["avcC", "pasp", "btrt"]);
  const configuration = one(extensions, "avcC")!, aspect = one(extensions, "pasp", false), bitrate = one(extensions, "btrt", false);
  if (bitrate) requireValue(bitrate.end - bitrate.data === 12);
  if (aspect) requireValue(aspect.end - aspect.data === 8 && view.getUint32(aspect.data) === 1 && view.getUint32(aspect.data + 4) === 1);
  const avc = avcSubset(bytes, configuration), sizes = one(tables, "stsz")!, timing = one(tables, "stts")!, mapping = one(tables, "stsc")!;
  for (const table of [sizes, timing, mapping]) full(bytes, table);
  const count = view.getUint32(sizes.data + 8), uniform = view.getUint32(sizes.data + 4);
  requireValue(count > 0 && count <= VIDEO_PREFIX_TRIM_MAX_SAMPLES && sizes.end - sizes.data === 12 + (uniform ? 0 : count * 4));
  const durations: number[] = [], runs = view.getUint32(timing.data + 4); let ticks = 0;
  requireValue(runs > 0 && runs <= count && timing.end - timing.data === 8 + runs * 8);
  for (let index = 0; index < runs; index++) {
    const run = view.getUint32(timing.data + 8 + index * 8), delta = view.getUint32(timing.data + 12 + index * 8);
    requireValue(run > 0 && delta > 0 && durations.length + run <= count);
    for (let item = 0; item < run; item++) durations.push(delta);
    ticks += run * delta; requireValue(Number.isSafeInteger(ticks));
  }
  requireValue(durations.length === count && ticks === durationTicks);
  const stco = one(tables, "stco", false), co64 = one(tables, "co64", false);
  requireValue(Boolean(stco) !== Boolean(co64)); const offsets = (stco ?? co64)!; full(bytes, offsets);
  const chunks = view.getUint32(offsets.data + 4), width = co64 ? 8 : 4;
  requireValue(chunks > 0 && chunks <= count && offsets.end - offsets.data === 8 + chunks * width);
  const mappingCount = view.getUint32(mapping.data + 4), mappings: Array<{ first: number; count: number }> = [];
  requireValue(mappingCount > 0 && mappingCount <= chunks && mapping.end - mapping.data === 8 + mappingCount * 12);
  for (let index = 0; index < mappingCount; index++) {
    const at = mapping.data + 8 + index * 12, first = view.getUint32(at), amount = view.getUint32(at + 4);
    requireValue(first >= 1 && first <= chunks && (index === 0 ? first === 1 : first > mappings[index - 1]!.first)
      && amount > 0 && amount <= count && view.getUint32(at + 8) === 1);
    mappings.push({ first, count: amount });
  }
  const samples: Sample[] = [], nalBudget = { nals: 0 }; let map = 0, previousFrame = -1;
  for (let chunk = 1; chunk <= chunks; chunk++) {
    while (map + 1 < mappings.length && mappings[map + 1]!.first <= chunk) map++;
    const at = offsets.data + 8 + (chunk - 1) * width;
    const offset = co64 ? Number(view.getBigUint64(at)) : view.getUint32(at); let cursor = offset;
    requireValue(Number.isSafeInteger(offset));
    for (let index = 0; index < mappings[map]!.count; index++) {
      requireValue(samples.length < count); const size = uniform || view.getUint32(sizes.data + 12 + samples.length * 4);
      requireValue(size > 0 && cursor + size <= bytes.length && media.some(value => cursor >= value.data && cursor + size <= value.end));
      const picture = samplePicture(bytes, cursor, cursor + size, avc, nalBudget);
      requireValue(picture.idr || (samples.length > 0 && picture.frame === (previousFrame + 1) % (2 ** avc.frameBits)));
      previousFrame = picture.frame;
      samples.push({ start: cursor, size, ticks: durations[samples.length]!, idr: picture.idr }); cursor += size;
    }
  }
  requireValue(samples.length === count && samples[0]!.idr);
  const sync = one(tables, "stss", false), actual = samples.flatMap((sample, index) => sample.idr ? [index + 1] : []);
  if (sync) {
    full(bytes, sync); requireValue(view.getUint32(sync.data + 4) === actual.length && sync.end - sync.data === 8 + actual.length * 4);
    requireValue(actual.every((value, index) => view.getUint32(sync.data + 8 + index * 4) === value));
  } else requireValue(actual.length === count);
  // Apply the tighter local table/NAL budgets before the general inspector.
  // That independent reader additionally checks SPS dimensions, progressive
  // coding, display dimensions and nonoverlapping chunk ranges.
  const inspection = await inspectOutputAsset(bytes, "video.mp4", { snapshot: false });
  requireValue(inspection.status === "inspected" && inspection.kind === "video" && inspection.sha256
    && inspection.facts.codec === "avc1" && inspection.facts.audioCodec === undefined && inspection.facts.rotationDegrees === 0);
  return { bytes, ftyp, mvhd, tkhd, mdhd, hdlr, vmhd, dinf, entry, configuration, aspect, elst, samples,
    movieScale, timescale, durationTicks, width: inspection.facts.width!, height: inspection.facts.height!, sha256: inspection.sha256 };
}
function info(layout: Layout): VideoPrefixInfo {
  return Object.freeze({ sampleCount: layout.samples.length, timescale: layout.timescale, durationTicks: layout.durationTicks,
    durationSeconds: layout.durationTicks / layout.timescale, width: layout.width, height: layout.height,
    sourceSha256: layout.sha256, sampleDurationTicks: Object.freeze(layout.samples.map(sample => sample.ticks)) });
}
function join(allocator: Allocator, parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0), result = allocator.make(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function box(allocator: Allocator, type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((total, part) => total + part.length, 0), result = allocator.make(size), view = dataView(result);
  view.setUint32(0, size); for (let index = 0; index < 4; index++) result[4 + index] = type.charCodeAt(index);
  let offset = 8; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function words(allocator: Allocator, values: readonly number[]): Uint8Array {
  const result = allocator.make(values.length * 4), view = dataView(result);
  values.forEach((value, index) => { requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff); view.setUint32(index * 4, value); }); return result;
}
function remux(layout: Layout, end: number, allocator: Allocator): Uint8Array {
  const selected = layout.samples.slice(0, end), ticks = selected.reduce((total, sample) => total + sample.ticks, 0);
  const movie = BigInt(ticks) * BigInt(layout.movieScale);
  requireValue(movie % BigInt(layout.timescale) === 0n); const movieTicks = Number(movie / BigInt(layout.timescale));
  requireValue(movieTicks > 0 && movieTicks <= 0xffffffff);
  const raw = (value: Box) => layout.bytes.subarray(value.start, value.end);
  const clock = (value: Box, offset: number, duration: number) => {
    const result = allocator.copy(raw(value)); dataView(result).setUint32(value.data - value.start + offset, duration); return result;
  };
  // Keep codec/display configuration byte-for-byte. Padding, the validated empty
  // user-metadata wrapper and stale bitrate metadata are omitted.
  const header = allocator.copy(layout.bytes.subarray(layout.entry.data, layout.entry.start + 86));
  const description = box(allocator, "avc1", header, raw(layout.configuration), ...(layout.aspect ? [raw(layout.aspect)] : []));
  const timing: number[] = []; for (const sample of selected) {
    if (timing.length && timing[timing.length - 1] === sample.ticks) timing[timing.length - 2]!++;
    else timing.push(1, sample.ticks);
  }
  const sync = selected.flatMap((sample, index) => sample.idr ? [index + 1] : []);
  const stco = box(allocator, "stco", words(allocator, [0, 1, 0]));
  const stbl = box(allocator, "stbl",
    box(allocator, "stsd", words(allocator, [0, 1]), description),
    box(allocator, "stts", words(allocator, [0, timing.length / 2, ...timing])),
    box(allocator, "stss", words(allocator, [0, sync.length, ...sync])),
    box(allocator, "stsc", words(allocator, [0, 1, 1, end, 1])),
    box(allocator, "stsz", words(allocator, [0, 0, end, ...selected.map(sample => sample.size)])), stco);
  const mdia = box(allocator, "mdia", clock(layout.mdhd, 16, ticks), raw(layout.hdlr),
    box(allocator, "minf", raw(layout.vmhd), raw(layout.dinf), stbl));
  const trak = box(allocator, "trak", clock(layout.tkhd, 20, movieTicks),
    ...(layout.elst ? [box(allocator, "edts", clock(layout.elst, 8, movieTicks))] : []), mdia);
  const moov = box(allocator, "moov", clock(layout.mvhd, 16, movieTicks), trak);
  // Find the single generated offset structurally, never by scanning arbitrary codec bytes.
  const budget = { boxes: 0 }, read = (value: Box) => boxes(moov, value.data, value.end, budget);
  const movieBox = boxes(moov, 0, moov.length, budget)[0]!;
  const trackBox = one(read(movieBox), "trak")!, mdiaBox = one(read(trackBox), "mdia")!;
  const tableBox = one(read(one(read(mdiaBox), "minf")!), "stbl")!, offsetBox = one(read(tableBox), "stco")!;
  dataView(moov).setUint32(offsetBox.data + 8, raw(layout.ftyp).length + moov.length + 8);
  const payload = join(allocator, selected.map(sample => layout.bytes.subarray(sample.start, sample.start + sample.size)));
  return join(allocator, [raw(layout.ftyp), moov, box(allocator, "mdat", payload)]);
}
/** Snapshot synchronously before inspection/hash awaits. Unsupported or malformed files return null. */
export async function inspectVideoPrefix(input: Uint8Array): Promise<VideoPrefixInfo | null> {
  try { return info(await parse(snapshot(input, new Allocator()))); } catch { return null; }
}
export async function trimVideoPrefix(input: Uint8Array, range: { startSample: number; endSample: number }): Promise<VideoPrefixResult | null> {
  try {
    requireValue(range && (Object.getPrototypeOf(range) === Object.prototype || Object.getPrototypeOf(range) === null));
    const keys = Reflect.ownKeys(range); requireValue(keys.length === 2 && keys.includes("startSample") && keys.includes("endSample"));
    const start = Object.getOwnPropertyDescriptor(range, "startSample"), end = Object.getOwnPropertyDescriptor(range, "endSample");
    requireValue(start?.enumerable && end?.enumerable && Object.hasOwn(start, "value") && Object.hasOwn(end, "value")
      && start.value === 0 && Number.isSafeInteger(end.value) && end.value >= 1);
    const endSample: number = end.value, allocator = new Allocator(), bytes = snapshot(input, allocator), layout = await parse(bytes);
    requireValue(endSample <= layout.samples.length);
    if (endSample === layout.samples.length) return Object.freeze({ changed: false, bytes, sourceSha256: layout.sha256, sha256: layout.sha256, info: info(layout) });
    const result = remux(layout, endSample, allocator), verified = await parse(result);
    requireValue(verified.samples.length === endSample && verified.width === layout.width && verified.height === layout.height
      && verified.samples.every((sample, index) => sample.ticks === layout.samples[index]!.ticks && sample.size === layout.samples[index]!.size
        && result.subarray(sample.start, sample.start + sample.size).every((value, at) => value === bytes[layout.samples[index]!.start + at])));
    return Object.freeze({ changed: true, bytes: result, sourceSha256: layout.sha256, sha256: verified.sha256, info: info(verified) });
  } catch { return null; }
}
