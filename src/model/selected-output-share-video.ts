import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";

/** Container/metadata qualification of exact bytes, never publishing authority. */
export const SELECTED_OUTPUT_SHARE_VIDEO_POLICY = "selected-output-share-avc-mp4-v2" as const;
/** Explicit opt-in to publishing the declared encoder configuration, including
 * thread counts. This is not an authenticity, custody or privacy assertion. */
export const SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY = "selected-output-share-avc-mp4-x264-163-r3060-v1" as const;
type VideoPolicy = typeof SELECTED_OUTPUT_SHARE_VIDEO_POLICY | typeof SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY;
export const SELECTED_OUTPUT_SHARE_VIDEO_LIMITS = Object.freeze({ bytes: MAX_OUTPUT_ASSET_BYTES, boxes: 4096, samples: 100_000, nals: 200_000 });
export type SelectedOutputShareVideoExpected = Readonly<{ sha256: string; byteLength: number; width: number; height: number; durationSeconds: number }>;
export type SelectedOutputShareVideoRefusal = "invalid_input" | "unsupported_mp4" | "unqualified_metadata" | "invalid_mp4" | "selection_mismatch";
declare const videoQualification: unique symbol;
export type QualifiedSelectedOutputShareVideo<Policy extends VideoPolicy = typeof SELECTED_OUTPUT_SHARE_VIDEO_POLICY> = Readonly<{
  [videoQualification]: true;
  status: "qualified";
  policy: Policy;
  mimeType: "video/mp4";
  sha256: string; byteLength: number; width: number; height: number; durationSeconds: number;
}>;
export type SelectedOutputShareVideoQualification<Policy extends VideoPolicy = typeof SELECTED_OUTPUT_SHARE_VIDEO_POLICY> = QualifiedSelectedOutputShareVideo<Policy>
  | Readonly<{ status: "unqualified"; policy: Policy; reason: SelectedOutputShareVideoRefusal }>;

const ownedVideos = new WeakMap<QualifiedSelectedOutputShareVideo<VideoPolicy>, Uint8Array<ArrayBuffer>>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const expectedKeys = ["sha256", "byteLength", "width", "height", "durationSeconds"] as const;
class Refusal extends Error { readonly reason: SelectedOutputShareVideoRefusal; constructor(reason: SelectedOutputShareVideoRefusal) { super(reason); this.reason = reason; } }
function requireValue(value: unknown, reason: SelectedOutputShareVideoRefusal = "invalid_mp4"): asserts value { if (!value) throw new Refusal(reason); }
function expectedFacts(value: unknown): SelectedOutputShareVideoExpected | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  const keys = Reflect.ownKeys(value), result: Record<string, unknown> = Object.create(null);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key as typeof expectedKeys[number]))) return null;
  for (const key of expectedKeys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return null;
    result[key] = field.value;
  }
  if (typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(result.sha256)
    || ![result.width, result.height].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 16_384)
    || typeof result.byteLength !== "number" || !Number.isSafeInteger(result.byteLength) || result.byteLength < 1 || result.byteLength > SELECTED_OUTPUT_SHARE_VIDEO_LIMITS.bytes
    || typeof result.durationSeconds !== "number" || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || result.durationSeconds > 86_400) return null;
  return Object.freeze(result) as SelectedOutputShareVideoExpected;
}
function captureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value) as number;
  bufferLength.call(typedBuffer.call(value)); // Reject shared buffers and proxy impostors.
  if (!length || length > SELECTED_OUTPUT_SHARE_VIDEO_LIMITS.bytes) return null;
  const copy = new Uint8Array(length); setBytes.call(copy, value as Uint8Array); return copy;
}

type Box = { type: string; start: number; data: number; end: number };
/** Only explicit 32-bit sizes: zero/large boxes and all unknown branches refuse. */
class Container {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  private count = 0;
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u32(at: number) { return this.view.getUint32(at); }
  u16(at: number) { return this.view.getUint16(at); }
  text(at: number, length: number) { return String.fromCharCode(...this.bytes.subarray(at, at + length)); }
  zero(start: number, end: number) { requireValue(this.bytes.subarray(start, end).every(value => value === 0), "unqualified_metadata"); }
  boxes(start: number, end: number, allowed: readonly string[]) {
    const result: Box[] = [], seen = new Set<string>();
    while (start < end) {
      requireValue(++this.count <= SELECTED_OUTPUT_SHARE_VIDEO_LIMITS.boxes && start + 8 <= end);
      const length = this.u32(start), type = this.text(start + 4, 4);
      requireValue(length >= 8 && length <= end - start);
      requireValue(allowed.includes(type), "unqualified_metadata");
      requireValue(!seen.has(type)); seen.add(type);
      result.push({ type, start, data: start + 8, end: start + length }); start += length;
    }
    requireValue(start === end); return result;
  }
  one(boxes: Box[], type: string) { const box = boxes.find(value => value.type === type); requireValue(box); return box; }
  full(box: Box, size?: number, flags = 0) { requireValue(box.end - box.data >= 4 && (size === undefined || box.end - box.data === size) && this.u32(box.data) === flags); }
  matrix(at: number) { [65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000].forEach((value, index) => requireValue(this.u32(at + index * 4) === value, "unsupported_mp4")); }
}

/** Parse parameter-set syntax to its RBSP stop bit, not just dimensions. This
 * intentionally excludes scaling lists, slice groups, HRD and AVC extensions. */
class Bits {
  private offset = 0;
  readonly bytes: Uint8Array;
  constructor(nal: Uint8Array, type: number) {
    requireValue(nal.length >= 2 && nal.length <= 4096 && (nal[0]! & 0x9f) === type);
    requireValue(![5, 7, 8].includes(type) || (nal[0]! & 0x60) !== 0);
    const raw: number[] = [];
    for (let index = 1, zeros = 0; index < nal.length; index += 1) {
      const value = nal[index]!;
      if (zeros === 2 && value === 3) {
        requireValue(index + 1 < nal.length && nal[index + 1]! <= 3); zeros = 0; continue;
      }
      requireValue(zeros < 2 || value > 2); raw.push(value); zeros = value === 0 ? zeros + 1 : 0;
    }
    this.bytes = Uint8Array.from(raw);
  }
  read(count = 1) {
    requireValue(count >= 0 && count <= 32 && this.offset + count <= this.bytes.length * 8);
    let value = 0;
    for (let index = 0; index < count; index += 1) { value = value * 2 + (this.bytes[this.offset >> 3]! >> (7 - (this.offset & 7)) & 1); this.offset += 1; }
    return value;
  }
  ue(maximum = 65535) { let zeros = 0; while (this.read() === 0) requireValue(++zeros <= 16); const value = 2 ** zeros - 1 + this.read(zeros); requireValue(value <= maximum); return value; }
  se(minimum = -32768, maximum = 32767) { const code = this.ue(65535), value = code & 1 ? (code + 1) / 2 : -code / 2; requireValue(value >= minimum && value <= maximum); return value; }
  more() {
    let at = this.offset;
    if (at >= this.bytes.length * 8 || !(this.bytes[at >> 3]! >> (7 - (at & 7)) & 1)) return true;
    for (at += 1; at < this.bytes.length * 8; at += 1) if (this.bytes[at >> 3]! >> (7 - (at & 7)) & 1) return true;
    return false;
  }
  end() { requireValue(this.read() === 1); while (this.offset % 8) requireValue(this.read() === 0); requireValue(this.offset === this.bytes.length * 8, "unqualified_metadata"); }
}
function parameterSets(sps: Uint8Array, pps: Uint8Array, config: Uint8Array) {
  const s = new Bits(sps, 7), profile = s.read(8), constraints = s.read(8), level = s.read(8);
  requireValue([66, 77, 88, 100].includes(profile), "unsupported_mp4");
  requireValue((constraints & 3) === 0 && level >= 10 && level <= 62 && profile === config[1] && constraints === config[2] && level === config[3]);
  const spsId = s.ue(31);
  if (profile === 100) { requireValue(s.ue(3) === 1 && s.ue(6) === 0 && s.ue(6) === 0 && s.read() === 0 && s.read() === 0, "unsupported_mp4"); }
  s.ue(12); const order = s.ue(2);
  if (order === 0) s.ue(12);
  else if (order === 1) { s.read(); s.se(); s.se(); const count = s.ue(255); for (let index = 0; index < count; index += 1) s.se(); }
  s.ue(16); s.read(); s.ue(1023); s.ue(1023);
  requireValue(s.read() === 1, "unsupported_mp4"); s.read();
  if (s.read()) for (let index = 0; index < 4; index += 1) s.ue(16_383);
  if (s.read()) {
    if (s.read()) { const aspect = s.read(8); requireValue(aspect === 1, "unsupported_mp4"); }
    requireValue(s.read() === 0 && s.read() === 0 && s.read() === 0, "unsupported_mp4"); // overscan, video signal, chroma location
    if (s.read()) { requireValue(s.read(32) > 0 && s.read(32) > 0); s.read(); }
    requireValue(s.read() === 0 && s.read() === 0, "unsupported_mp4"); // no HRD
    s.read();
    if (s.read()) { s.read(); s.ue(16); s.ue(16); s.ue(16); s.ue(16); s.ue(16); s.ue(16); }
  }
  s.end();
  const p = new Bits(pps, 8), ppsId = p.ue(255);
  requireValue(p.ue(31) === spsId); p.read(); p.read(); requireValue(p.ue(7) === 0, "unsupported_mp4");
  p.ue(31); p.ue(31); p.read(); p.read(2); p.se(-26, 25); p.se(-26, 25); p.se(-12, 12); p.read(); p.read(); p.read();
  if (p.more()) { p.read(); requireValue(p.read() === 0, "unsupported_mp4"); p.se(-12, 12); }
  p.end(); return ppsId;
}
function codec(c: Container, box: Box) {
  const { bytes } = c, at = box.data;
  requireValue(box.end - at >= 11 && bytes[at] === 1 && bytes[at + 4] === 255 && bytes[at + 5] === 225, "unsupported_mp4");
  let cursor = at + 6;
  const spsLength = c.u16(cursor); cursor += 2;
  requireValue(spsLength >= 5 && cursor + spsLength + 3 <= box.end);
  const sps = bytes.subarray(cursor, cursor + spsLength); cursor += spsLength;
  requireValue(bytes[cursor++] === 1, "unsupported_mp4");
  const ppsLength = c.u16(cursor); cursor += 2;
  requireValue(ppsLength >= 2 && cursor + ppsLength <= box.end);
  const pps = bytes.subarray(cursor, cursor + ppsLength); cursor += ppsLength;
  if (cursor < box.end) {
    requireValue(bytes[at + 1] === 100 && box.end - cursor === 4 && bytes[cursor] === 253 && bytes[cursor + 1] === 248 && bytes[cursor + 2] === 248 && bytes[cursor + 3] === 0, "unqualified_metadata"); cursor += 4;
  }
  requireValue(cursor === box.end); return parameterSets(sps, pps, bytes.subarray(at, at + 4));
}

/** Composition offsets are playback timing, not descriptive metadata. Keep
 * every sample and prove its presentation interval; this never rewrites clocks. */
function timeline(c: Container, tables: Box[], samples: number, scale: number, duration: number, mediaScale: number, mediaDuration: number, mediaStart: number) {
  requireValue(mediaScale > 0 && mediaDuration > 0 && mediaStart >= 0 && mediaStart <= mediaScale);
  // Integer cross-products avoid the native reader's broader edit tolerance.
  const movieNumerator = BigInt(mediaDuration) * BigInt(scale), movieFloor = movieNumerator / BigInt(mediaScale), movieCeiling = (movieNumerator + BigInt(mediaScale) - 1n) / BigInt(mediaScale);
  requireValue(BigInt(duration) === movieFloor || BigInt(duration) === movieCeiling, "unsupported_mp4");
  const stts = c.one(tables, "stts"), decodeDurations: number[] = [];
  let ticks = 0;
  for (let at = stts.data + 8; at < stts.end; at += 8) {
    const count = c.u32(at), delta = c.u32(at + 4);
    requireValue(count > 0 && delta > 0 && count <= samples - decodeDurations.length);
    ticks += count * delta; requireValue(Number.isSafeInteger(ticks) && ticks <= mediaDuration);
    for (let index = 0; index < count; index += 1) decodeDurations.push(delta);
  }
  requireValue(decodeDurations.length === samples && ticks === mediaDuration);
  const ctts = tables.find(box => box.type === "ctts"), offsets: number[] = [];
  if (ctts) {
    requireValue(ctts.end - ctts.data >= 8 && [0, 0x01000000].includes(c.u32(ctts.data)));
    const count = c.u32(ctts.data + 4); requireValue(count > 0 && count <= samples && ctts.end - ctts.data === 8 + count * 8);
    for (let at = ctts.data + 8; at < ctts.end; at += 8) {
      const run = c.u32(at), offset = c.bytes[ctts.data] === 1 ? c.view.getInt32(at + 4) : c.u32(at + 4);
      requireValue(run > 0 && run <= samples - offsets.length);
      for (let index = 0; index < run; index += 1) offsets.push(offset);
    }
    requireValue(offsets.length === samples);
  }
  const intervals: Array<{ start: number; end: number }> = [];
  let decode = 0;
  for (let index = 0; index < samples; index += 1) {
    const start = decode + (offsets[index] ?? 0), delta = decodeDurations[index]!;
    requireValue(Number.isSafeInteger(start) && start >= mediaStart && start + delta <= mediaStart + mediaDuration, "unsupported_mp4");
    intervals.push({ start, end: start + delta }); decode += delta;
  }
  intervals.sort((first, second) => first.start - second.start);
  let end = mediaStart;
  for (const interval of intervals) { requireValue(interval.start === end, "unsupported_mp4"); end = interval.end; }
  requireValue(end === mediaStart + mediaDuration, "unsupported_mp4");
}

function bitrate(c: Container, box: Box, stsz: Box, samples: number, payloadBytes: number, mediaScale: number, mediaDuration: number) {
  requireValue(box.end - box.data === 12);
  const buffer = c.u32(box.data), maximum = c.u32(box.data + 4), average = c.u32(box.data + 8), uniform = c.u32(stsz.data + 4);
  let largestSample = 0;
  for (let index = 0; index < samples; index += 1) largestSample = Math.max(largestSample, uniform || c.u32(stsz.data + 12 + index * 4));
  // Deliberately supported declared-rate subset. Peak rate and full decoder
  // buffer adequacy are not measured; no strings or additional bytes exist.
  requireValue(buffer >= largestSample && buffer <= payloadBytes && average > 0 && maximum >= average, "unsupported_mp4");
  const numerator = BigInt(payloadBytes) * 8n * BigInt(mediaScale), floor = numerator / BigInt(mediaDuration), ceiling = (numerator + BigInt(mediaDuration) - 1n) / BigInt(mediaDuration);
  requireValue(BigInt(average) === floor || BigInt(average) === ceiling, "unsupported_mp4");
}

// Each value is a deliberately reviewed singleton encoder setting, not a
// generic number/string allowance. Other builds or settings require a new
// profile review. In particular x264's caller-supplied `zones` string is absent.
const x264Fields = [
  ["cabac", "1"], ["ref", "1"], ["deblock", "1:0:0"], ["analyse", "0x3:0x113"], ["me", "hex"], ["subme", "2"],
  ["psy", "1"], ["psy_rd", "1.00:0.00"], ["mixed_ref", "0"], ["me_range", "16"], ["chroma_me", "1"], ["trellis", "0"],
  ["8x8dct", "1"], ["cqm", "0"], ["deadzone", "21,11"], ["fast_pskip", "1"], ["chroma_qp_offset", "0"],
  ["threads", "6"], ["lookahead_threads", "2"], ["sliced_threads", "0"], ["nr", "0"], ["decimate", "1"], ["interlaced", "0"],
  ["bluray_compat", "0"], ["constrained_intra", "0"], ["bframes", "3"], ["b_pyramid", "2"], ["b_adapt", "1"], ["b_bias", "0"],
  ["direct", "1"], ["weightb", "1"], ["open_gop", "0"], ["weightp", "1"], ["keyint", "250"], ["keyint_min", "24"], ["scenecut", "40"],
  ["intra_refresh", "0"], ["rc_lookahead", "10"], ["rc", "abr"], ["mbtree", "1"], ["bitrate", "1149"], ["ratetol", "1.0"],
  ["qcomp", "0.60"], ["qpmin", "0"], ["qpmax", "69"], ["qpstep", "4"], ["vbv_maxrate", "1724"], ["vbv_bufsize", "2299"],
  ["nal_hrd", "none"], ["filler", "0"], ["ip_ratio", "1.40"], ["aq", "1:1.00"],
] as const;
const x264Header = "x264 - core 163 r3060 5db6aa6 - H.264/MPEG-4 AVC codec - Copyleft 2003-2021 - http://www.videolan.org/x264.html - options: ";
const x264Uuid = [0xdc, 0x45, 0xe9, 0xbd, 0xe6, 0xd9, 0x48, 0xb7, 0x96, 0x2c, 0xd8, 0x20, 0xd9, 0x23, 0xee, 0xef];
function encoderDeclaration(nal: Uint8Array) {
  requireValue(nal.length >= 20 && nal.length <= 2048 && nal[0] === 6, "unqualified_metadata");
  const rbsp: number[] = [];
  for (let index = 1, zeros = 0; index < nal.length; index += 1) {
    const value = nal[index]!;
    if (zeros === 2 && value === 3) { requireValue(index + 1 < nal.length && nal[index + 1]! <= 3); zeros = 0; continue; }
    requireValue(zeros < 2 || value > 2); rbsp.push(value); zeros = value === 0 ? zeros + 1 : 0;
  }
  let cursor = 0;
  const extendedByte = () => {
    let value = 0, byte = 255;
    while (byte === 255) { requireValue(cursor < rbsp.length); byte = rbsp[cursor++]!; value += byte; requireValue(value <= 2048); }
    return value;
  };
  requireValue(extendedByte() === 5, "unqualified_metadata");
  const length = extendedByte(), end = cursor + length;
  requireValue(length > 17 && end + 1 === rbsp.length && rbsp[end] === 128, "unqualified_metadata");
  requireValue(x264Uuid.every((value, index) => rbsp[cursor + index] === value), "unqualified_metadata"); cursor += 16;
  requireValue(rbsp[end - 1] === 0 && rbsp.slice(cursor, end - 1).every(value => value >= 32 && value <= 126), "unqualified_metadata");
  const text = String.fromCharCode(...rbsp.slice(cursor, end - 1));
  requireValue(text.startsWith(x264Header), "unqualified_metadata");
  const fields = text.slice(x264Header.length).split(" "); requireValue(fields.length === x264Fields.length, "unqualified_metadata");
  x264Fields.forEach(([name, reviewedValue], index) => {
    const field = fields[index]!, equals = field.indexOf("=");
    requireValue(equals > 0 && field.slice(0, equals) === name && field.slice(equals + 1) === reviewedValue, "unqualified_metadata");
  });
}

function publicMp4(bytes: Uint8Array, allowKnownEncoderDeclaration = false) {
  const c = new Container(bytes), top = c.boxes(0, bytes.length, ["ftyp", "moov", "mdat", "free"]);
  const ftyp = c.one(top, "ftyp"), moov = c.one(top, "moov"), mdat = c.one(top, "mdat");
  requireValue(top[0] === ftyp && ftyp.end - ftyp.data >= 12 && ftyp.end - ftyp.data <= 44 && (ftyp.end - ftyp.data) % 4 === 0);
  const brands = ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1"];
  requireValue(brands.includes(c.text(ftyp.data, 4)) && [0, 512].includes(c.u32(ftyp.data + 4)), "unsupported_mp4");
  const seenBrands = new Set<string>();
  for (let at = ftyp.data + 8; at < ftyp.end; at += 4) { const brand = c.text(at, 4); requireValue(brands.includes(brand) && !seenBrands.has(brand), "unqualified_metadata"); seenBrands.add(brand); }
  const free = top.find(box => box.type === "free"); if (free) requireValue(free.end === free.data, "unqualified_metadata");
  const movie = c.boxes(moov.data, moov.end, ["mvhd", "trak", "udta"]), mvhd = c.one(movie, "mvhd"), udta = movie.find(box => box.type === "udta");
  if (udta) {
    const empty = "0000003d75647461000000356d657461000000000000002168646c7200000000000000006d6469726170706c00000000000000000000000008696c7374";
    requireValue(udta.end - udta.start === empty.length / 2 && Array.from({ length: empty.length / 2 }, (_, index) => Number.parseInt(empty.slice(index * 2, index * 2 + 2), 16)).every((value, index) => bytes[udta.start + index] === value), "unqualified_metadata");
  }
  c.full(mvhd, 100); c.zero(mvhd.data + 4, mvhd.data + 12);
  const scale = c.u32(mvhd.data + 12), duration = c.u32(mvhd.data + 16);
  requireValue(scale > 0 && duration > 0 && c.u32(mvhd.data + 20) === 65536 && [0, 256].includes(c.u16(mvhd.data + 24)));
  c.zero(mvhd.data + 26, mvhd.data + 36); c.matrix(mvhd.data + 36); c.zero(mvhd.data + 72, mvhd.data + 96); requireValue(c.u32(mvhd.data + 96) === 2);
  const trak = c.one(movie, "trak"), track = c.boxes(trak.data, trak.end, ["tkhd", "edts", "mdia"]), tkhd = c.one(track, "tkhd");
  requireValue([1, 3].includes(c.u32(tkhd.data))); c.full(tkhd, 84, c.u32(tkhd.data)); c.zero(tkhd.data + 4, tkhd.data + 12);
  requireValue(c.u32(tkhd.data + 12) === 1 && c.u32(tkhd.data + 20) === duration); c.zero(tkhd.data + 16, tkhd.data + 20); c.zero(tkhd.data + 24, tkhd.data + 40); c.matrix(tkhd.data + 40);
  const edts = track.find(box => box.type === "edts"); let mediaStart = 0;
  if (edts) { const elst = c.one(c.boxes(edts.data, edts.end, ["elst"]), "elst"); c.full(elst, 20); requireValue(c.u32(elst.data + 4) === 1 && c.u32(elst.data + 8) === duration && c.u32(elst.data + 16) === 65536, "unsupported_mp4"); mediaStart = c.view.getInt32(elst.data + 12); }
  const mdia = c.one(track, "mdia"), media = c.boxes(mdia.data, mdia.end, ["mdhd", "hdlr", "minf"]), mdhd = c.one(media, "mdhd"), hdlr = c.one(media, "hdlr");
  c.full(mdhd, 24); c.zero(mdhd.data + 4, mdhd.data + 12); requireValue([0, 0x55c4].includes(c.u16(mdhd.data + 20)), "unqualified_metadata"); c.zero(mdhd.data + 22, mdhd.data + 24);
  c.full(hdlr); requireValue(hdlr.end - hdlr.data >= 24 && hdlr.end - hdlr.data <= 37); c.zero(hdlr.data + 4, hdlr.data + 8); requireValue(c.text(hdlr.data + 8, 4) === "vide", "unsupported_mp4"); c.zero(hdlr.data + 12, hdlr.data + 24);
  const name = c.text(hdlr.data + 24, hdlr.end - hdlr.data - 24); requireValue(name === "" || name === "\0" || name === "VideoHandler\0", "unqualified_metadata");
  const minf = c.one(media, "minf"), info = c.boxes(minf.data, minf.end, ["vmhd", "dinf", "stbl"]), vmhd = c.one(info, "vmhd"); c.full(vmhd, 12, 1); c.zero(vmhd.data + 4, vmhd.end);
  const dinf = c.one(info, "dinf"), dref = c.one(c.boxes(dinf.data, dinf.end, ["dref"]), "dref"); c.full(dref); requireValue(c.u32(dref.data + 4) === 1);
  const url = c.one(c.boxes(dref.data + 8, dref.end, ["url "]), "url "); c.full(url, 4, 1);
  const stbl = c.one(info, "stbl"), tables = c.boxes(stbl.data, stbl.end, ["stsd", "stts", "ctts", "stss", "stsc", "stsz", "stco"]), stsd = c.one(tables, "stsd"); c.full(stsd); requireValue(c.u32(stsd.data + 4) === 1);
  const avc = c.one(c.boxes(stsd.data + 8, stsd.end, ["avc1"]), "avc1"); requireValue(avc.end - avc.start >= 86);
  c.zero(avc.data, avc.start + 14); requireValue(c.u16(avc.start + 14) === 1); c.zero(avc.start + 16, avc.start + 32);
  requireValue(c.u32(avc.start + 36) === 0x00480000 && c.u32(avc.start + 40) === 0x00480000 && c.u32(avc.start + 44) === 0 && c.u16(avc.start + 48) === 1);
  c.zero(avc.start + 50, avc.start + 82); requireValue(c.u16(avc.start + 82) === 24 && c.u16(avc.start + 84) === 65535);
  const extensions = c.boxes(avc.start + 86, avc.end, ["avcC", "pasp", "btrt"]), ppsId = codec(c, c.one(extensions, "avcC"));
  const pasp = extensions.find(box => box.type === "pasp"); if (pasp) requireValue(pasp.end - pasp.data === 8 && c.u32(pasp.data) === 1 && c.u32(pasp.data + 4) === 1);
  const stsz = c.one(tables, "stsz"), stsc = c.one(tables, "stsc"), stco = c.one(tables, "stco"), stts = c.one(tables, "stts");
  for (const table of [stsz, stsc, stco, stts]) c.full(table);
  requireValue(stsz.end - stsz.data >= 12); const uniform = c.u32(stsz.data + 4), samples = c.u32(stsz.data + 8);
  requireValue(samples > 0 && samples <= SELECTED_OUTPUT_SHARE_VIDEO_LIMITS.samples && stsz.end - stsz.data === 12 + (uniform ? 0 : samples * 4));
  const chunks = c.u32(stco.data + 4), mappingCount = c.u32(stsc.data + 4), timingCount = c.u32(stts.data + 4);
  requireValue(chunks > 0 && chunks <= samples && stco.end - stco.data === 8 + chunks * 4 && mappingCount > 0 && mappingCount <= chunks && stsc.end - stsc.data === 8 + mappingCount * 12
    && timingCount > 0 && timingCount <= samples && stts.end - stts.data === 8 + timingCount * 8);
  const mediaScale = c.u32(mdhd.data + 12), mediaDuration = c.u32(mdhd.data + 16);
  timeline(c, tables, samples, scale, duration, mediaScale, mediaDuration, mediaStart);
  const btrt = extensions.find(box => box.type === "btrt"); if (btrt) bitrate(c, btrt, stsz, samples, mdat.end - mdat.data, mediaScale, mediaDuration);
  const stss = tables.find(box => box.type === "stss"), syncSamples = new Set<number>();
  if (stss) { c.full(stss); const count = c.u32(stss.data + 4); requireValue(count > 0 && count <= samples && stss.end - stss.data === 8 + count * 4); let previous = 0; for (let at = stss.data + 8; at < stss.end; at += 4) { const sample = c.u32(at); requireValue(sample > previous && sample <= samples); previous = sample; syncSamples.add(sample); } }
  let mapping = 0, sample = 0, end = mdat.data, nals = 0, declaredEncoder = false;
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    if (mapping + 1 < mappingCount && chunk === c.u32(stsc.data + 8 + (mapping + 1) * 12)) mapping += 1;
    const at = stsc.data + 8 + mapping * 12, first = c.u32(at), count = c.u32(at + 4);
    requireValue((mapping !== 0 || first === 1) && first <= chunk && count > 0 && count <= samples && c.u32(at + 8) === 1);
    requireValue(c.u32(stco.data + 8 + (chunk - 1) * 4) === end, "unqualified_metadata");
    for (let index = 0; index < count; index += 1) {
      requireValue(sample < samples); const size = uniform || c.u32(stsz.data + 12 + sample * 4); sample += 1;
      let cursor = end, idr: boolean | undefined; end += size; requireValue(size > 0 && end <= mdat.end);
      while (cursor < end) {
        requireValue(++nals <= SELECTED_OUTPUT_SHARE_VIDEO_LIMITS.nals && cursor + 4 <= end);
        const length = c.u32(cursor); cursor += 4; requireValue(length >= 2 && length <= end - cursor);
        const type = bytes[cursor]! & 31;
        if (type === 6 && allowKnownEncoderDeclaration) {
          requireValue(!declaredEncoder && sample === 1 && idr === undefined, "unqualified_metadata");
          encoderDeclaration(bytes.subarray(cursor, cursor + length)); declaredEncoder = true; cursor += length; continue;
        }
        requireValue((bytes[cursor]! & 128) === 0 && (type === 1 || type === 5), "unqualified_metadata");
        // Closed slice prefix binds the only configured PPS. Remaining coded
        // picture bytes require decoding/playback review, not a metadata claim.
        const bits = new Bits(bytes.subarray(cursor, Math.min(cursor + length, cursor + 64)), type); bits.ue(); const sliceType = bits.ue(9); requireValue(bits.ue(255) === ppsId && (type !== 5 || sliceType % 5 === 2));
        requireValue(idr === undefined || idr === (type === 5), "unsupported_mp4"); idr = type === 5;
        cursor += length;
      }
      requireValue(cursor === end && idr === (stss ? syncSamples.has(sample) : true));
      requireValue(!declaredEncoder || sample !== 1 || idr === true, "unsupported_mp4");
    }
  }
  requireValue(sample === samples && mapping + 1 === mappingCount && end === mdat.end, "unqualified_metadata");
  requireValue(!allowKnownEncoderDeclaration || declaredEncoder, "unqualified_metadata");
}

/** Captures exact bytes before awaiting. No source custody, rights, visible
 * content, covert encoded-picture data, or publication permission is inferred.
 * No stripping, transcoding, provider call or public route is performed. */
async function qualifyVideo<Policy extends VideoPolicy>(input: unknown, expected: unknown, policy: Policy): Promise<SelectedOutputShareVideoQualification<Policy>> {
  const refused = (reason: SelectedOutputShareVideoRefusal): SelectedOutputShareVideoQualification<Policy> => Object.freeze({ status: "unqualified", policy, reason });
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const facts = expectedFacts(expected); if (!facts) return refused("invalid_input"); bytes = captureBytes(input); if (!bytes) return refused("invalid_input");
    if (bytes.length !== facts.byteLength) return refused("selection_mismatch");
    publicMp4(bytes, policy === SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY);
    const inspection = await inspectOutputAsset(bytes, "video.mp4", { snapshot: false });
    if (inspection.status !== "inspected" || inspection.kind !== "video" || inspection.mimeType !== "video/mp4" || inspection.extension !== "mp4"
      || inspection.facts.codec !== "avc1" || inspection.facts.audioCodec !== undefined || inspection.facts.durationBasis !== "mp4-track-timeline") return refused("invalid_mp4");
    if (inspection.sha256 !== facts.sha256 || inspection.byteLength !== facts.byteLength || inspection.facts.width !== facts.width || inspection.facts.height !== facts.height || inspection.facts.durationSeconds !== facts.durationSeconds) return refused("selection_mismatch");
    const result = Object.freeze({ status: "qualified", policy, mimeType: "video/mp4", ...facts }) as QualifiedSelectedOutputShareVideo<Policy>;
    ownedVideos.set(result, bytes); retained = true; return result;
  } catch (error) { return refused(error instanceof Refusal ? error.reason : "invalid_input"); }
  finally { if (!retained) bytes?.fill(0); }
}
/** Default v2 policy remains unchanged: every SEI NAL refuses. */
export function qualifySelectedOutputShareVideo(input: unknown, expected: unknown): Promise<SelectedOutputShareVideoQualification> {
  return qualifyVideo(input, expected, SELECTED_OUTPUT_SHARE_VIDEO_POLICY);
}
/** Explicit known-declaration profile. Preserves the disclosed encoder build,
 * thread counts and coding/rate settings verbatim; no authenticity, absence of
 * visible/covert private content, or permission to publish is established. */
export function qualifySelectedOutputShareVideoWithX264Declaration(input: unknown, expected: unknown): Promise<SelectedOutputShareVideoQualification<typeof SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY>> {
  return qualifyVideo(input, expected, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY);
}
/** Fresh copy; serialized/forged facts are not a byte-access capability. The
 * caller must separately recheck current source and publishing authority. */
export function copySelectedOutputShareVideoBytes(qualification: unknown): Uint8Array<ArrayBuffer> | null {
  if (qualification === null || typeof qualification !== "object") return null;
  const bytes = ownedVideos.get(qualification as QualifiedSelectedOutputShareVideo<VideoPolicy>); return bytes ? new Uint8Array(bytes) : null;
}
