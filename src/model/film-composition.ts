import { inspectVideoPrefix, VIDEO_PREFIX_TRIM_MAX_BYTES, VIDEO_PREFIX_TRIM_MAX_SAMPLES } from "./video-container.ts";
import type { VideoPrefixInfo } from "./video-container.ts";

/** Ordered concatenation of compatible, independently decodable silent AVC clips.
 * This prepares bytes only: ownership, recipe coverage, review and saving remain
 * the caller's existing governed Output responsibilities. No decoding is claimed.
 */
export const FILM_COMPOSITION_MAX_CLIPS = 32;
export type FilmClip = Readonly<{ id: string; bytes: Uint8Array; sha256: string }>;
export type FilmComposition = Readonly<{
  bytes: Uint8Array; sha256: string; info: VideoPrefixInfo;
  sources: readonly Readonly<{ id: string; sha256: string; byteLength: number;
    startSample: number; endSample: number; startTick: number; endTick: number }>[];
}>;
type Box = { type: string; start: number; data: number; end: number };
type Sample = { bytes: Uint8Array; ticks: number; sync: boolean };
type Layout = { bytes: Uint8Array; info: VideoPrefixInfo; ftyp: Box; mvhd: Box; tkhd: Box;
  mdhd: Box; hdlr: Box; vmhd: Box; dinf: Box; elst?: Box; entryHeader: Uint8Array;
  configuration: Uint8Array; aspect: Uint8Array; movieScale: number; samples: Sample[] };
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);
function check(value: unknown): asserts value { if (!value) throw new TypeError("Unsupported Film composition"); }
function uint(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff; }
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  check(value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const keys = Reflect.ownKeys(value); check(keys.length === names.length && keys.every(key => typeof key === "string" && names.includes(key)));
  const result: Record<string, unknown> = Object.create(null);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor?.enumerable && Object.hasOwn(descriptor, "value")); result[key] = descriptor.value;
  }
  return result;
}
class Allocation {
  private total = 0;
  make(length: number): Uint8Array {
    check(Number.isSafeInteger(length) && length >= 0 && length <= VIDEO_PREFIX_TRIM_MAX_BYTES);
    check(this.total + length <= 144_000_000); this.total += length; return new Uint8Array(length);
  }
  copy(bytes: Uint8Array): Uint8Array { const out = this.make(bytes.byteLength); out.set(bytes); return out; }
  join(parts: readonly Uint8Array[]): Uint8Array {
    const out = this.make(parts.reduce((sum, part) => sum + part.byteLength, 0)); let at = 0;
    for (const part of parts) { out.set(part, at); at += part.byteLength; } return out;
  }
  words(values: readonly number[]): Uint8Array {
    const out = this.make(values.length * 4), data = view(out);
    values.forEach((value, index) => { check(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff); data.setUint32(index * 4, value); });
    return out;
  }
  box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const out = this.make(8 + parts.reduce((sum, part) => sum + part.length, 0)); view(out).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[i + 4] = type.charCodeAt(i);
    let at = 8; for (const part of parts) { out.set(part, at); at += part.length; } return out;
  }
}
function capture(input: readonly FilmClip[], expected: { timescale: number; durationTicks: number }, allocation: Allocation) {
  const duration = fields(expected, ["timescale", "durationTicks"]);
  check(uint(duration.timescale) && uint(duration.durationTicks));
  check(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
  const length = Object.getOwnPropertyDescriptor(input, "length")!.value;
  check(Number.isSafeInteger(length) && length >= 2 && length <= FILM_COMPOSITION_MAX_CLIPS);
  const clips: FilmClip[] = [], ids = new Set<string>(); let total = 0;
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(input, String(index)); check(entry && Object.hasOwn(entry, "value"));
    const row = fields(entry.value, ["id", "bytes", "sha256"]);
    check(typeof row.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(row.id) && !ids.has(row.id));
    check(typeof row.sha256 === "string" && /^[a-f0-9]{64}$/u.test(row.sha256));
    check(row.bytes instanceof Uint8Array && Object.getPrototypeOf(row.bytes) === Uint8Array.prototype);
    const buffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!.call(row.bytes);
    const size = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!.call(row.bytes);
    check(buffer instanceof ArrayBuffer && size > 0 && total + size <= VIDEO_PREFIX_TRIM_MAX_BYTES);
    total += size; const bytes = allocation.make(size); bytes.set(row.bytes);
    clips.push({ id: row.id, sha256: row.sha256, bytes }); ids.add(row.id);
  }
  return { clips, timescale: duration.timescale, durationTicks: duration.durationTicks };
}
// Container extraction is used only after the unchanged strict AVC validator.
// No codec parsing, hidden metadata or additional accepted format is introduced.
function extract(bytes: Uint8Array, info: VideoPrefixInfo): Layout {
  const data = view(bytes); let budget = 0;
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      check(++budget <= 8192 && start + 8 <= end); const size = data.getUint32(start);
      check(size >= 8 && start + size <= end);
      result.push({ type: String.fromCharCode(...bytes.subarray(start + 4, start + 8)), start, data: start + 8, end: start + size }); start += size;
    }
    check(start === end); return result;
  };
  const one = (list: Box[], type: string): Box => { const found = list.filter(box => box.type === type); check(found.length === 1); return found[0]!; };
  const read = (box: Box) => boxes(box.data, box.end), raw = (box: Box) => bytes.subarray(box.start, box.end);
  const top = boxes(0, bytes.length), ftyp = one(top, "ftyp"), movie = read(one(top, "moov"));
  const mvhd = one(movie, "mvhd"), track = read(one(movie, "trak")), tkhd = one(track, "tkhd");
  const mdia = read(one(track, "mdia")), mdhd = one(mdia, "mdhd"), hdlr = one(mdia, "hdlr");
  const minf = read(one(mdia, "minf")), tables = read(one(minf, "stbl"));
  const stsd = one(tables, "stsd"), entry = one(boxes(stsd.data + 8, stsd.end), "avc1");
  const extensions = boxes(entry.data + 78, entry.end), aspect = extensions.find(box => box.type === "pasp");
  const sizes = one(tables, "stsz"), mapping = one(tables, "stsc"), offsets = tables.find(box => box.type === "stco" || box.type === "co64"); check(offsets);
  const uniform = data.getUint32(sizes.data + 4), count = data.getUint32(sizes.data + 8);
  check(count === info.sampleCount);
  const mappings = Array.from({ length: data.getUint32(mapping.data + 4) }, (_, index) => ({
    first: data.getUint32(mapping.data + 8 + index * 12), count: data.getUint32(mapping.data + 12 + index * 12),
  }));
  const syncBox = tables.find(box => box.type === "stss"), sync = new Set<number>();
  if (syncBox) for (let i = 0; i < data.getUint32(syncBox.data + 4); i++) sync.add(data.getUint32(syncBox.data + 8 + i * 4));
  const samples: Sample[] = []; let map = 0;
  for (let chunk = 1; chunk <= data.getUint32(offsets.data + 4); chunk++) {
    while (map + 1 < mappings.length && mappings[map + 1]!.first <= chunk) map++;
    const at = offsets.data + 8 + (chunk - 1) * (offsets.type === "co64" ? 8 : 4);
    let start = offsets.type === "co64" ? Number(data.getBigUint64(at)) : data.getUint32(at);
    for (let item = 0; item < mappings[map]!.count; item++) {
      check(samples.length < count); const size = uniform || data.getUint32(sizes.data + 12 + samples.length * 4);
      check(Number.isSafeInteger(start) && size > 0 && top.some(box => box.type === "mdat" && start >= box.data && start + size <= box.end));
      samples.push({ bytes: bytes.subarray(start, start + size), ticks: info.sampleDurationTicks[samples.length]!, sync: !syncBox || sync.has(samples.length + 1) }); start += size;
    }
  }
  check(samples.length === count && samples[0]!.sync);
  const edits = track.find(box => box.type === "edts");
  return { bytes, info, ftyp, mvhd, tkhd, mdhd, hdlr, vmhd: one(minf, "vmhd"), dinf: one(minf, "dinf"),
    ...(edits ? { elst: one(read(edits), "elst") } : {}), entryHeader: bytes.subarray(entry.data, entry.data + 78),
    configuration: raw(one(extensions, "avcC")), aspect: aspect ? raw(aspect) : new Uint8Array(),
    movieScale: data.getUint32(mvhd.data + 12), samples };
}
function remux(first: Layout, samples: Sample[], ticks: number, allocation: Allocation): Uint8Array {
  const product = BigInt(ticks) * BigInt(first.movieScale), scale = BigInt(first.info.timescale);
  check(product % scale === 0n); const movieTicks = Number(product / scale); check(uint(movieTicks));
  const raw = (box: Box) => first.bytes.subarray(box.start, box.end);
  const clock = (box: Box, offset: number, duration: number) => { const out = allocation.copy(raw(box)); view(out).setUint32(8 + offset, duration); return out; };
  const timing: number[] = [], sync: number[] = [], sizes = [0, 0, samples.length];
  samples.forEach((sample, index) => {
    if (timing.length && timing[timing.length - 1] === sample.ticks) timing[timing.length - 2]!++;
    else timing.push(1, sample.ticks);
    if (sample.sync) sync.push(index + 1); sizes.push(sample.bytes.length);
  });
  const b = (name: string, ...parts: Uint8Array[]) => allocation.box(name, ...parts);
  const w = (values: number[]) => allocation.words(values);
  // Rebuild changing tables and omit validated empty padding/user metadata and
  // stale bitrate metadata. Preserve exact codec/display and compressed samples.
  const description = b("avc1", first.entryHeader, first.configuration, first.aspect);
  const makeMovie = (offset: number) => b("moov", clock(first.mvhd, 16, movieTicks),
    b("trak", clock(first.tkhd, 20, movieTicks), ...(first.elst ? [b("edts", clock(first.elst, 8, movieTicks))] : []),
      b("mdia", clock(first.mdhd, 16, ticks), raw(first.hdlr),
        b("minf", raw(first.vmhd), raw(first.dinf), b("stbl",
          b("stsd", w([0, 1]), description), b("stts", w([0, timing.length / 2].concat(timing))),
          b("stss", w([0, sync.length].concat(sync))), b("stsc", w([0, 1, 1, samples.length, 1])),
          b("stsz", w(sizes)), b("stco", w([0, 1, offset])))))));
  const preliminary = makeMovie(0), movie = makeMovie(raw(first.ftyp).length + preliminary.length + 8);
  const payload = allocation.join(samples.map(sample => sample.bytes));
  return allocation.join([raw(first.ftyp), movie, b("mdat", payload)]);
}

/** Snapshots all source bytes and declarations before any asynchronous work.
 * Incompatible codecs, clocks, source hashes, malformed data or a duration that
 * differs from the caller's explicit plan refuse with null. No implicit looping,
 * stretching, trimming, soundtrack, transitions or source-coverage claim.
 */
export async function composeFilmClips(clips: readonly FilmClip[], expected: { timescale: number; durationTicks: number }): Promise<FilmComposition | null> {
  try {
    const allocation = new Allocation(), captured = capture(clips, expected, allocation), layouts: Layout[] = [];
    const sources: FilmComposition["sources"][number][] = []; let totalSamples = 0, ticks = 0;
    for (const clip of captured.clips) {
      const info = await inspectVideoPrefix(clip.bytes); check(info && info.sourceSha256 === clip.sha256 && info.timescale === captured.timescale);
      check(totalSamples + info.sampleCount <= VIDEO_PREFIX_TRIM_MAX_SAMPLES && uint(ticks + info.durationTicks));
      const layout = extract(clip.bytes, info), first = layouts[0];
      if (first) check(info.width === first.info.width && info.height === first.info.height
        && same(layout.entryHeader, first.entryHeader) && same(layout.configuration, first.configuration) && same(layout.aspect, first.aspect));
      sources.push(Object.freeze({ id: clip.id, sha256: clip.sha256, byteLength: clip.bytes.length,
        startSample: totalSamples, endSample: totalSamples + info.sampleCount, startTick: ticks, endTick: ticks + info.durationTicks }));
      layouts.push(layout); totalSamples += info.sampleCount; ticks += info.durationTicks;
    }
    check(ticks === captured.durationTicks);
    const samples = layouts.flatMap(layout => layout.samples), bytes = remux(layouts[0]!, samples, ticks, allocation);
    const info = await inspectVideoPrefix(bytes); check(info && info.sampleCount === totalSamples && info.durationTicks === ticks && info.timescale === captured.timescale);
    const verified = extract(bytes, info); check(verified.samples.every((sample, index) => sample.ticks === samples[index]!.ticks
      && sample.sync === samples[index]!.sync && same(sample.bytes, samples[index]!.bytes)));
    return Object.freeze({ bytes, sha256: info.sourceSha256, info, sources: Object.freeze(sources) });
  } catch { return null; }
}
