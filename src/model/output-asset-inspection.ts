/**
 * Bounded, dependency-free inspection of adopted deliverable bytes.
 *
 * An inspected result proves the checks listed here, not successful playback,
 * meaningful content, grounding, accessibility, ownership, or acceptance.
 * Callers must bind these facts to this SHA-256 and run their separate review
 * and authorization gates. A filename and a browser-supplied MIME are not proof.
 */
import { MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset } from "./model3d-assets.ts";

export const MAX_OUTPUT_ASSET_BYTES = 24_000_000;
export const MAX_OUTPUT_MODEL3D_ASSET_BYTES = MAX_MODEL3D_UPLOAD_BYTES;
export const MAX_OUTPUT_ASSET_NAME_BYTES = 180;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_XML_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_NODES = 50_000;
const MAX_DIMENSION = 16_384;
const MAX_DURATION_SECONDS = 6 * 60 * 60;
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type OutputAssetKind = "image" | "audio" | "video" | "presentation" | "model3d" | "document";
export type OutputAssetFacts = {
  width?: number;
  height?: number;
  codedWidth?: number;
  codedHeight?: number;
  durationSeconds?: number;
  durationBasis?: "pcm-samples" | "mpeg-frame-samples" | "mp4-track-timeline";
  sampleRate?: number;
  channels?: number;
  sampleCount?: number;
  frameCount?: number;
  slideCount?: number;
  hiddenSlideCount?: number;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  codec?: string;
  audioCodec?: string;
  rotationDegrees?: number;
  externalHyperlinkCount?: number;
  meshCount?: number;
  primitiveCount?: number;
  vertexCount?: number;
  materialCount?: number;
  textureCount?: number;
  animationCount?: number;
  nodeCount?: number;
};
export type OutputAssetInspection = {
  status: "inspected" | "unsupported" | "invalid";
  kind: OutputAssetKind | null;
  mimeType: string | null;
  extension: "png" | "jpg" | "wav" | "mp3" | "mp4" | "pptx" | "glb" | "md" | null;
  byteLength: number;
  sha256: string | null;
  facts: OutputAssetFacts;
  checks: string[];
  limitations: string[];
  limitationCodes?: string[];
  errors: string[];
};
type ParsedAsset = Pick<OutputAssetInspection, "kind" | "mimeType" | "extension" | "facts" | "checks" | "limitations">;
class InspectionFailure extends Error {
  readonly code: string;
  readonly unsupported: boolean;
  constructor(code: string, unsupported = false) { super(code); this.code = code; this.unsupported = unsupported; }
}
function fail(code: string, unsupported = false): never { throw new InspectionFailure(code, unsupported); }
function requireFact(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function ascii(bytes: Uint8Array, start: number, length = 4): string {
  requireFact(start >= 0 && start + length <= bytes.length, "truncated_asset");
  let value = "";
  for (let index = start; index < start + length; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
}
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function checkedDimensions(width: number, height: number) {
  requireFact(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION, "invalid_or_excessive_dimensions");
}
function checkedDuration(value: number) {
  requireFact(Number.isFinite(value) && value > 0 && value <= MAX_DURATION_SECONDS, "invalid_or_excessive_duration");
  return value;
}
export function validOutputAssetName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name === name.normalize("NFC") && name === name.trim()
    && encoder.encode(name).length <= MAX_OUTPUT_ASSET_NAME_BYTES && !/[\p{Cc}\p{Cf}<>:"/\\|?*]/u.test(name)
    && !name.startsWith(".") && !/[. ]$/u.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name);
}
export async function outputAssetSha256(bytes: Uint8Array): Promise<string> {
  // Public callers should not mutate bytes while hashing. Inspection snapshots
  // its input before awaiting, and delivery snapshots each supplied file.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
async function inflateBounded(bytes: Uint8Array, format: "deflate" | "deflate-raw", limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") fail("decompression_unavailable", true);
  let decompressor: DecompressionStream;
  try { decompressor = new DecompressionStream(format); } catch { return fail("decompression_format_unavailable", true); }
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(decompressor).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit) { await reader.cancel().catch(() => undefined); fail("expanded_asset_too_large"); }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof InspectionFailure) throw error;
    fail("invalid_compressed_stream");
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

async function inspectPng(bytes: Uint8Array): Promise<ParsedAsset> {
  requireFact(bytes.length >= 57 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n", "invalid_png_signature");
  const view = viewOf(bytes);
  let cursor = 8, width = 0, height = 0, bitDepth = 0, color = 0, seenData = false, endedData = false, palette = false, ended = false, count = 0;
  const compressed: Uint8Array[] = [];
  let compressedSize = 0;
  while (cursor + 12 <= bytes.length) {
    requireFact(++count <= 4096, "too_many_png_chunks");
    const length = view.getUint32(cursor), type = ascii(bytes, cursor + 4), start = cursor + 8, end = start + length;
    requireFact(end + 4 <= bytes.length && /^[A-Za-z]{4}$/u.test(type), "invalid_png_chunk");
    requireFact(crc32(bytes.subarray(cursor + 4, end)) === view.getUint32(end), "png_crc_mismatch");
    requireFact(count !== 1 || type === "IHDR", "missing_png_header");
    if (type === "IHDR") {
      requireFact(count === 1 && length === 13, "invalid_png_header");
      width = view.getUint32(start); height = view.getUint32(start + 4); bitDepth = bytes[start + 8]!; color = bytes[start + 9]!;
      checkedDimensions(width, height);
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      requireFact(depths[color]?.includes(bitDepth) && bytes[start + 10] === 0 && bytes[start + 11] === 0, "invalid_png_encoding");
      if (bytes[start + 12] === 1) fail("interlaced_png_unsupported", true);
      requireFact(bytes[start + 12] === 0, "invalid_png_interlace");
    } else if (type === "PLTE") {
      requireFact(!seenData && !palette && length > 0 && length % 3 === 0 && length <= 768 && color !== 0 && color !== 4, "invalid_png_palette");
      if (color === 3) requireFact(length / 3 <= 2 ** bitDepth, "invalid_png_palette");
      palette = true;
    } else if (type === "IDAT") {
      requireFact(!endedData && (color !== 3 || palette), "invalid_png_data_order");
      seenData = true; compressed.push(bytes.subarray(start, end)); compressedSize += length;
    } else if (type === "IEND") {
      requireFact(length === 0 && seenData && compressedSize > 0 && end + 4 === bytes.length, "invalid_png_end");
      ended = true; break;
    } else {
      if (seenData) endedData = true;
      if (type === "acTL" || type === "fcTL" || type === "fdAT") fail("animated_png_unsupported", true);
      if (type.charCodeAt(0) < 97) fail("unknown_critical_png_chunk", true);
    }
    cursor = end + 4;
  }
  requireFact(ended, "missing_png_end");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]!;
  const rowLength = Math.ceil(width * channels * bitDepth / 8) + 1;
  const expected = rowLength * height;
  requireFact(expected <= MAX_EXPANDED_BYTES, "expanded_asset_too_large");
  const compressedBytes = new Uint8Array(compressedSize);
  let offset = 0;
  for (const chunk of compressed) { compressedBytes.set(chunk, offset); offset += chunk.length; }
  const scanlines = await inflateBounded(compressedBytes, "deflate", expected);
  requireFact(scanlines.length === expected, "png_scanline_size_mismatch");
  for (let row = 0; row < height; row += 1) requireFact(scanlines[row * rowLength]! <= 4, "invalid_png_filter");
  return { kind: "image", mimeType: "image/png", extension: "png", facts: { width, height }, checks: ["png-chunks-and-crc", "png-inflated-scanline-layout"], limitations: ["Pixel reconstruction and visual content were not reviewed."] };
}

function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 6 || ascii(bytes, start, 6) !== "Exif\0\0") return null;
  const tiff = start + 6;
  requireFact(tiff + 8 <= end, "invalid_jpeg_exif");
  const order = ascii(bytes, tiff, 2), little = order === "II", view = viewOf(bytes);
  requireFact((little || order === "MM") && view.getUint16(tiff + 2, little) === 42, "invalid_jpeg_exif");
  const ifd = tiff + view.getUint32(tiff + 4, little);
  requireFact(ifd >= tiff + 8 && ifd + 2 <= end, "invalid_jpeg_exif");
  const count = view.getUint16(ifd, little);
  requireFact(count <= 1024 && ifd + 2 + count * 12 + 4 <= end, "invalid_jpeg_exif");
  let orientation: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    requireFact(orientation === null && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1, "invalid_jpeg_orientation");
    orientation = view.getUint16(entry + 8, little);
    requireFact(orientation >= 1 && orientation <= 8, "invalid_jpeg_orientation");
  }
  return orientation;
}
function inspectJpeg(bytes: Uint8Array): ParsedAsset {
  const view = viewOf(bytes);
  let cursor = 2, width = 0, height = 0, sof = 0, scans = 0, markers = 0, ended = false, orientation = 1, hasOrientation = false;
  const components = new Map<number, number>(), quantization = new Set<number>(), huffman = new Set<number>();
  while (cursor < bytes.length) {
    requireFact(++markers <= 4096 && bytes[cursor++] === 255, "invalid_jpeg_marker");
    while (bytes[cursor] === 255) cursor += 1;
    requireFact(cursor < bytes.length, "truncated_jpeg");
    const marker = bytes[cursor++]!;
    if (marker === 0xd9) { requireFact(scans > 0 && cursor === bytes.length, "invalid_jpeg_end"); ended = true; break; }
    requireFact(marker !== 0 && marker !== 0xd8 && marker !== 1 && !(marker >= 0xd0 && marker <= 0xd7) && cursor + 2 <= bytes.length, "unexpected_jpeg_marker");
    const length = view.getUint16(cursor), start = cursor + 2, end = cursor + length;
    requireFact(length >= 2 && end <= bytes.length, "truncated_jpeg_segment");
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (![0xc0, 0xc1, 0xc2].includes(marker)) fail("jpeg_encoding_unsupported", true);
      requireFact(!sof && length >= 11 && bytes[start] === 8, "invalid_jpeg_frame");
      sof = marker; height = view.getUint16(start + 1); width = view.getUint16(start + 3);
      checkedDimensions(width, height);
      const count = bytes[start + 5]!;
      if (count !== 1 && count !== 3) fail("jpeg_component_layout_unsupported", true);
      requireFact(length === 8 + 3 * count, "invalid_jpeg_frame");
      let samplingTotal = 0;
      for (let index = 0; index < count; index += 1) {
        const offset = start + 6 + index * 3, id = bytes[offset]!, sampling = bytes[offset + 1]!, table = bytes[offset + 2]!;
        const horizontal = sampling >> 4, vertical = sampling & 15;
        requireFact(!components.has(id) && horizontal >= 1 && horizontal <= 4 && vertical >= 1 && vertical <= 4 && table <= 3, "invalid_jpeg_component");
        components.set(id, table); samplingTotal += horizontal * vertical;
      }
      requireFact(samplingTotal <= 10, "invalid_jpeg_sampling");
    } else if (marker === 0xdb) {
      let offset = start;
      while (offset < end) {
        const descriptor = bytes[offset++]!, precision = descriptor >> 4, id = descriptor & 15;
        requireFact(precision <= 1 && id <= 3 && offset + 64 * (precision + 1) <= end, "invalid_jpeg_quantization");
        for (let index = 0; index < 64; index += 1) requireFact(precision ? view.getUint16(offset + index * 2) > 0 : bytes[offset + index]! > 0, "invalid_jpeg_quantization");
        offset += 64 * (precision + 1); quantization.add(id);
      }
    } else if (marker === 0xc4) {
      let offset = start;
      while (offset < end) {
        const table = bytes[offset++]!;
        requireFact(table >> 4 <= 1 && (table & 15) <= 3 && offset + 16 <= end, "invalid_jpeg_huffman");
        let count = 0, slots = 1;
        for (let index = 0; index < 16; index += 1) { slots = slots * 2 - bytes[offset + index]!; count += bytes[offset + index]!; requireFact(slots >= 0, "invalid_jpeg_huffman"); }
        offset += 16;
        requireFact(count > 0 && count <= 256 && offset + count <= end, "invalid_jpeg_huffman");
        offset += count; huffman.add(table);
      }
    } else if (marker === 0xe1) {
      const found = exifOrientation(bytes, start, end);
      if (found !== null) { requireFact(!hasOrientation || found === orientation, "conflicting_jpeg_orientation"); orientation = found; hasOrientation = true; }
    } else if (marker === 0xcc || marker === 0xdc) fail("jpeg_encoding_unsupported", true);
    else if (marker === 0xdd) requireFact(length === 4, "invalid_jpeg_restart_interval");
    else if (marker === 0xda) {
      requireFact(sof && length >= 8, "missing_jpeg_frame");
      const count = bytes[start]!;
      requireFact(count > 0 && count <= components.size && length === 6 + 2 * count, "invalid_jpeg_scan");
      const spectralStart = bytes[end - 3]!, spectralEnd = bytes[end - 2]!, approximation = bytes[end - 1]!;
      requireFact(spectralStart <= spectralEnd && spectralEnd <= 63 && approximation >> 4 <= 13 && (approximation & 15) <= 13, "invalid_jpeg_scan");
      requireFact(sof === 0xc2 || spectralStart === 0 && spectralEnd === 63 && approximation === 0, "invalid_jpeg_scan");
      const seen = new Set<number>();
      for (let index = 0; index < count; index += 1) {
        const id = bytes[start + 1 + index * 2]!, table = bytes[start + 2 + index * 2]!;
        requireFact(components.has(id) && !seen.has(id) && quantization.has(components.get(id)!) && table >> 4 <= 3 && (table & 15) <= 3, "invalid_jpeg_scan_component");
        if (spectralStart === 0 && approximation >> 4 === 0) requireFact(huffman.has(table >> 4), "missing_jpeg_huffman_table");
        if (spectralEnd > 0) requireFact(huffman.has(16 | table & 15), "missing_jpeg_huffman_table");
        seen.add(id);
      }
      cursor = end;
      let entropyBytes = 0;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 255) { entropyBytes += 1; cursor += 1; continue; }
        const markerStart = cursor;
        while (bytes[cursor] === 255) cursor += 1;
        requireFact(cursor < bytes.length, "truncated_jpeg_entropy");
        const next = bytes[cursor]!;
        if (next === 0 || next >= 0xd0 && next <= 0xd7) { entropyBytes += next === 0 ? 1 : 0; cursor += 1; continue; }
        cursor = markerStart; break;
      }
      requireFact(entropyBytes > 0, "empty_jpeg_scan"); scans += 1; continue;
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe && marker !== 0xdb && marker !== 0xc4) fail("jpeg_marker_unsupported", true);
    cursor = end;
  }
  requireFact(ended, "missing_jpeg_end");
  const rotated = orientation >= 5;
  return { kind: "image", mimeType: "image/jpeg", extension: "jpg", facts: { width: rotated ? height : width, height: rotated ? width : height, codedWidth: width, codedHeight: height }, checks: ["jpeg-markers-and-tables", "jpeg-scan-boundaries", "jpeg-exif-orientation"], limitations: ["JPEG entropy was not decoded into pixels. Visual content requires review."] };
}

function inspectWav(bytes: Uint8Array): ParsedAsset {
  const view = viewOf(bytes);
  requireFact(bytes.length >= 44 && view.getUint32(4, true) === bytes.length - 8 && ascii(bytes, 8) === "WAVE", "invalid_wav_container");
  let cursor = 12, count = 0, format = 0, channels = 0, sampleRate = 0, byteRate = 0, blockAlign = 0, bits = 0, dataLength = 0;
  while (cursor + 8 <= bytes.length) {
    requireFact(++count <= 4096, "too_many_wav_chunks");
    const type = ascii(bytes, cursor), length = view.getUint32(cursor + 4, true), start = cursor + 8, end = start + length;
    requireFact(end + length % 2 <= bytes.length, "truncated_wav_chunk");
    if (type === "fmt ") {
      requireFact(!format && !dataLength && (length === 16 || length >= 18 && view.getUint16(start + 16, true) === length - 18), "invalid_wav_format");
      format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); sampleRate = view.getUint32(start + 4, true);
      byteRate = view.getUint32(start + 8, true); blockAlign = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true);
      if (format !== 1 && format !== 3) fail("wav_encoding_unsupported", true);
      requireFact(length === 16 || length === 18, "invalid_wav_format");
      requireFact(channels >= 1 && channels <= 8 && sampleRate >= 8000 && sampleRate <= 384000
        && (format === 1 ? [8, 16, 24, 32].includes(bits) : [32, 64].includes(bits))
        && blockAlign === channels * bits / 8 && byteRate === sampleRate * blockAlign, "inconsistent_wav_format");
    } else if (type === "data") {
      requireFact(format && !dataLength && length > 0 && length % blockAlign === 0, "invalid_wav_data");
      dataLength = length;
    }
    cursor = end + length % 2;
  }
  requireFact(cursor === bytes.length && dataLength > 0, "incomplete_wav");
  const durationSeconds = checkedDuration(dataLength / byteRate);
  return { kind: "audio", mimeType: "audio/wav", extension: "wav", facts: { durationSeconds, durationBasis: "pcm-samples", sampleRate, channels, sampleCount: dataLength / blockAlign, codec: format === 1 ? `pcm-${bits}` : `ieee-float-${bits}` }, checks: ["wav-riff-boundaries", "wav-format-consistency", "wav-sample-byte-count"], limitations: ["Audio samples were not listened to or assessed for intelligibility, silence, content, or loudness."] };
}
function inspectMp3(bytes: Uint8Array): ParsedAsset {
  const rates = [44100, 48000, 32000];
  const bitrates1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitrates2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let cursor = 0, end = bytes.length, frames = 0, samples = 0, sampleRate = 0, channels = 0, initialVersion = 0;
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") {
    requireFact(bytes.length >= 10 && [3, 4].includes(bytes[3]!) && bytes[4] !== 255 && bytes.subarray(6, 10).every(value => value < 128), "invalid_mp3_id3");
    const flags = bytes[5]!, version = bytes[3]!;
    requireFact((flags & (version === 3 ? 0x1f : 0x0f)) === 0, "invalid_mp3_id3_flags");
    const length = (bytes[6]! << 21) + (bytes[7]! << 14) + (bytes[8]! << 7) + bytes[9]!;
    requireFact(length <= MAX_XML_BYTES && 10 + length <= bytes.length, "invalid_mp3_id3_size");
    cursor = 10 + length;
    if (version === 4 && flags & 0x10) {
      requireFact(cursor + 10 <= bytes.length && ascii(bytes, cursor, 3) === "3DI" && bytes.subarray(cursor + 3, cursor + 10).every((value, index) => value === bytes[index + 3]), "invalid_mp3_id3_footer");
      cursor += 10;
    }
  }
  if (end - cursor >= 128 && ascii(bytes, end - 128, 3) === "TAG") end -= 128;
  while (cursor + 4 <= end) {
    const first = bytes[cursor]!, second = bytes[cursor + 1]!, third = bytes[cursor + 2]!, fourth = bytes[cursor + 3]!;
    const version = second >> 3 & 3, layer = second >> 1 & 3, rateIndex = third >> 4, frequencyIndex = third >> 2 & 3;
    requireFact(first === 255 && (second & 0xe0) === 0xe0 && version !== 1 && layer === 1 && rateIndex > 0 && rateIndex < 15 && frequencyIndex < 3 && (fourth & 3) !== 2, "invalid_mp3_frame_header");
    const frameRate = rates[frequencyIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4), frameChannels = fourth >> 6 === 3 ? 1 : 2;
    const bitrate = (version === 3 ? bitrates1 : bitrates2)[rateIndex]! * 1000;
    const length = Math.floor((version === 3 ? 144 : 72) * bitrate / frameRate) + (third >> 1 & 1);
    const sideBytes = version === 3 ? frameChannels === 1 ? 17 : 32 : frameChannels === 1 ? 9 : 17;
    const crcBytes = second & 1 ? 0 : 2;
    requireFact(length > 4 + crcBytes + sideBytes && cursor + length <= end, "truncated_mp3_frame");
    if (!frames) { sampleRate = frameRate; channels = frameChannels; initialVersion = version; }
    requireFact(frameRate === sampleRate && frameChannels === channels && initialVersion === version, "inconsistent_mp3_stream");
    requireFact(++frames <= 500_000, "too_many_mp3_frames");
    samples += version === 3 ? 1152 : 576; cursor += length;
  }
  requireFact(cursor === end && frames >= 2, "incomplete_mp3_stream");
  return { kind: "audio", mimeType: "audio/mpeg", extension: "mp3", facts: { durationSeconds: checkedDuration(samples / sampleRate), durationBasis: "mpeg-frame-samples", sampleRate, channels, sampleCount: samples, frameCount: frames, codec: "mpeg-layer-iii" }, checks: ["mp3-contiguous-frame-boundaries", "mp3-consistent-sample-clock"], limitations: ["MPEG audio was not decoded or listened to. Frame duration includes encoder delay/padding; audible duration and content require review."] };
}

type Mp4Box = { type: string; start: number; data: number; end: number };
type BoxBudget = { count: number };
function mp4Boxes(bytes: Uint8Array, start: number, end: number, budget: BoxBudget): Mp4Box[] {
  const view = viewOf(bytes), result: Mp4Box[] = [];
  let cursor = start;
  while (cursor < end) {
    requireFact(++budget.count <= 8192 && cursor + 8 <= end, "invalid_mp4_box_boundary");
    let length = view.getUint32(cursor), header = 8;
    const type = ascii(bytes, cursor + 4);
    requireFact(/^[\x20-\x7e]{4}$/u.test(type), "invalid_mp4_box_type");
    if (length === 1) { requireFact(cursor + 16 <= end, "truncated_mp4_large_box"); length = safeUint64(view, cursor + 8); header = 16; }
    else if (length === 0) length = end - cursor;
    requireFact(length >= header && cursor + length <= end, "invalid_mp4_box_size");
    result.push({ type, start: cursor, data: cursor + header, end: cursor + length }); cursor += length;
  }
  requireFact(cursor === end, "invalid_mp4_box_boundary");
  return result;
}
function safeUint64(view: DataView, offset: number) {
  const value = view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4);
  requireFact(Number.isSafeInteger(value), "excessive_container_integer");
  return value;
}
function uniqueBox(boxes: Mp4Box[], type: string, required = true): Mp4Box | undefined {
  const matches = boxes.filter(box => box.type === type);
  requireFact(matches.length <= 1 && (!required || matches.length === 1), `invalid_mp4_${type}_count`);
  return matches[0];
}
function fullBox(bytes: Uint8Array, box: Mp4Box, versions = [0]) {
  requireFact(box.data + 4 <= box.end && versions.includes(bytes[box.data]!), "invalid_mp4_box_version");
  return bytes[box.data]!;
}
function mp4Clock(bytes: Uint8Array, box: Mp4Box) {
  const version = fullBox(bytes, box, [0, 1]), view = viewOf(bytes), start = box.data;
  requireFact(box.end - start >= (version ? 36 : 24), "truncated_mp4_clock");
  const scale = view.getUint32(start + (version ? 20 : 12));
  const duration = version ? safeUint64(view, start + 24) : view.getUint32(start + 16);
  requireFact(scale > 0 && scale <= 1_000_000_000 && duration > 0, "invalid_mp4_clock");
  checkedDuration(duration / scale);
  return { scale, duration };
}
class H264Bits {
  private offset = 0;
  private bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  read(count: number): number {
    requireFact(count >= 0 && count <= 32 && this.offset + count <= this.bytes.length * 8, "truncated_h264_sps");
    let value = 0;
    for (let index = 0; index < count; index += 1) { value = value * 2 + (this.bytes[this.offset >> 3]! >> (7 - (this.offset & 7)) & 1); this.offset += 1; }
    return value;
  }
  ue() {
    let zeros = 0;
    while (this.read(1) === 0) { requireFact(++zeros <= 24, "invalid_h264_exp_golomb"); }
    return 2 ** zeros - 1 + this.read(zeros);
  }
  se() { const value = this.ue(); return value & 1 ? (value + 1) / 2 : -value / 2; }
}
function h264SpsDimensions(nal: Uint8Array) {
  requireFact(nal.length >= 5 && nal.length <= 4096 && (nal[0]! & 0x9f) === 7, "invalid_h264_sps");
  const rbsp: number[] = [];
  for (let index = 1; index < nal.length; index += 1) {
    if (index >= 3 && nal[index] === 3 && nal[index - 1] === 0 && nal[index - 2] === 0) {
      requireFact(index + 1 < nal.length && nal[index + 1]! <= 3, "invalid_h264_emulation_prevention");
      continue;
    }
    rbsp.push(nal[index]!);
  }
  const bits = new H264Bits(Uint8Array.from(rbsp));
  const profile = bits.read(8); bits.read(8); bits.read(8); requireFact(bits.ue() <= 31, "invalid_h264_sps_id");
  let chroma = 1, separateColorPlane = 0;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = bits.ue(); requireFact(chroma <= 3, "invalid_h264_chroma");
    if (chroma === 3) separateColorPlane = bits.read(1);
    if (bits.ue() !== 0 || bits.ue() !== 0) fail("h264_bit_depth_unsupported", true);
    bits.read(1);
    if (bits.read(1)) {
      const count = chroma !== 3 ? 8 : 12;
      for (let index = 0; index < count; index += 1) if (bits.read(1)) {
        let last = 8, next = 8;
        for (let scaling = 0; scaling < (index < 6 ? 16 : 64); scaling += 1) { if (next !== 0) next = (last + bits.se() + 256) % 256; if (next !== 0) last = next; }
      }
    }
  } else if (![66, 77, 88].includes(profile)) fail("h264_profile_unsupported", true);
  requireFact(bits.ue() <= 12, "invalid_h264_frame_number");
  const order = bits.ue();
  if (order === 0) requireFact(bits.ue() <= 12, "invalid_h264_picture_order");
  else if (order === 1) { bits.read(1); bits.se(); bits.se(); const count = bits.ue(); requireFact(count <= 255, "invalid_h264_picture_order"); for (let index = 0; index < count; index += 1) bits.se(); }
  else requireFact(order === 2, "invalid_h264_picture_order");
  requireFact(bits.ue() <= 16, "invalid_h264_reference_count"); bits.read(1);
  const widthMbs = bits.ue() + 1, heightUnits = bits.ue() + 1, frameOnly = bits.read(1);
  requireFact(widthMbs <= 1024 && heightUnits <= 1024, "invalid_h264_dimensions");
  if (!frameOnly) bits.read(1);
  bits.read(1);
  let left = 0, right = 0, top = 0, bottom = 0;
  if (bits.read(1)) { left = bits.ue(); right = bits.ue(); top = bits.ue(); bottom = bits.ue(); }
  const chromaArray = separateColorPlane ? 0 : chroma;
  const cropX = chromaArray === 0 || chromaArray === 3 ? 1 : 2;
  const cropY = (chromaArray === 1 ? 2 : 1) * (2 - frameOnly);
  const width = widthMbs * 16 - (left + right) * cropX, height = heightUnits * 16 * (2 - frameOnly) - (top + bottom) * cropY;
  checkedDimensions(width, height);
  if (!frameOnly) fail("interlaced_h264_unsupported", true);
  if (bits.read(1) && bits.read(1)) {
    const aspect = bits.read(8);
    if (aspect === 255) { const numerator = bits.read(16), denominator = bits.read(16); requireFact(numerator > 0 && denominator > 0, "invalid_h264_sample_aspect"); if (numerator !== denominator) fail("nonsquare_video_pixels_unsupported", true); }
    else if (aspect !== 0 && aspect !== 1) fail("nonsquare_video_pixels_unsupported", true);
  }
  return { width, height };
}
function avcConfiguration(bytes: Uint8Array, box: Mp4Box, width: number, height: number) {
  const view = viewOf(bytes), start = box.data;
  requireFact(box.end - start >= 7 && bytes[start] === 1 && (bytes[start + 4]! & 0xfc) === 0xfc && (bytes[start + 5]! & 0xe0) === 0xe0, "invalid_avc_configuration");
  const lengthSize = (bytes[start + 4]! & 3) + 1;
  requireFact(lengthSize !== 3, "invalid_avc_nal_length_size");
  const spsCount = bytes[start + 5]! & 31;
  requireFact(spsCount > 0 && spsCount <= 16, "missing_avc_sps");
  let cursor = start + 6;
  for (let index = 0; index < spsCount; index += 1) {
    requireFact(cursor + 2 <= box.end, "truncated_avc_sps"); const length = view.getUint16(cursor); cursor += 2;
    requireFact(length > 0 && cursor + length <= box.end, "truncated_avc_sps");
    const dimensions = h264SpsDimensions(bytes.subarray(cursor, cursor + length));
    requireFact(dimensions.width === width && dimensions.height === height, "mp4_coded_dimensions_mismatch"); cursor += length;
  }
  requireFact(cursor < box.end, "missing_avc_pps"); const ppsCount = bytes[cursor++]!;
  requireFact(ppsCount > 0 && ppsCount <= 32, "missing_avc_pps");
  for (let index = 0; index < ppsCount; index += 1) {
    requireFact(cursor + 2 <= box.end, "truncated_avc_pps"); const length = view.getUint16(cursor); cursor += 2;
    requireFact(length >= 2 && cursor + length <= box.end && (bytes[cursor]! & 0x9f) === 8, "invalid_avc_pps"); cursor += length;
  }
  // High-profile extension bytes are metadata, not additional media samples.
  if (cursor < box.end) {
    requireFact([100, 110, 122, 144].includes(bytes[start + 1]!) && cursor + 4 <= box.end, "invalid_avc_extension");
    requireFact((bytes[cursor]! & 0xfc) === 0xfc && (bytes[cursor + 1]! & 0xf8) === 0xf8 && (bytes[cursor + 2]! & 0xf8) === 0xf8, "invalid_avc_extension");
    const extensions = bytes[cursor + 3]!; cursor += 4;
    for (let index = 0; index < extensions; index += 1) { requireFact(cursor + 2 <= box.end, "invalid_avc_extension"); const length = view.getUint16(cursor); cursor += 2; requireFact(cursor + length <= box.end, "invalid_avc_extension"); cursor += length; }
  }
  requireFact(cursor === box.end, "invalid_avc_configuration_end");
  return lengthSize;
}
type Mp4Track = { type: "vide" | "soun"; durationSeconds: number; width?: number; height?: number; codedWidth?: number; codedHeight?: number; rotationDegrees?: number; sampleCount: number; codec: string };
function inspectMp4Track(bytes: Uint8Array, track: Mp4Box, movieScale: number, media: Mp4Box[], budget: BoxBudget, occupied: Array<[number, number]>): Mp4Track {
  const view = viewOf(bytes), trackBoxes = mp4Boxes(bytes, track.data, track.end, budget);
  const header = uniqueBox(trackBoxes, "tkhd")!, mdia = uniqueBox(trackBoxes, "mdia")!;
  const version = fullBox(bytes, header, [0, 1]), headerStart = header.data;
  requireFact(header.end - headerStart >= (version ? 96 : 84), "truncated_mp4_track_header");
  requireFact((view.getUint32(headerStart) & 1) === 1, "disabled_mp4_track_unsupported");
  const mediaBoxes = mp4Boxes(bytes, mdia.data, mdia.end, budget), clock = mp4Clock(bytes, uniqueBox(mediaBoxes, "mdhd")!);
  const handler = uniqueBox(mediaBoxes, "hdlr")!;
  requireFact(handler.end - handler.data >= 24, "truncated_mp4_handler");
  const type = ascii(bytes, handler.data + 8);
  if (type !== "vide" && type !== "soun") fail("mp4_track_type_unsupported", true);
  const minf = uniqueBox(mediaBoxes, "minf")!, info = mp4Boxes(bytes, minf.data, minf.end, budget);
  const dinf = uniqueBox(info, "dinf")!, dref = uniqueBox(mp4Boxes(bytes, dinf.data, dinf.end, budget), "dref")!;
  fullBox(bytes, dref); requireFact(dref.end - dref.data >= 8 && view.getUint32(dref.data + 4) === 1, "external_mp4_reference_unsupported");
  const references = mp4Boxes(bytes, dref.data + 8, dref.end, budget);
  requireFact(references.length === 1 && references[0]!.type === "url " && references[0]!.end - references[0]!.data === 4 && view.getUint32(references[0]!.data) === 1, "external_mp4_reference_unsupported");
  const stbl = uniqueBox(info, "stbl")!, tables = mp4Boxes(bytes, stbl.data, stbl.end, budget), stsd = uniqueBox(tables, "stsd")!;
  fullBox(bytes, stsd); requireFact(stsd.end - stsd.data >= 8 && view.getUint32(stsd.data + 4) === 1, "multiple_mp4_sample_descriptions_unsupported");
  const entries = mp4Boxes(bytes, stsd.data + 8, stsd.end, budget);
  requireFact(entries.length === 1, "invalid_mp4_sample_description");
  const entry = entries[0]!;
  requireFact(entry.end - entry.start >= (type === "vide" ? 86 : 36) && view.getUint16(entry.start + 14) === 1, "invalid_mp4_sample_entry");
  let width = 0, height = 0, rotation = 0, lengthSize = 0;
  if (type === "vide") {
    if (entry.type !== "avc1") fail("mp4_video_codec_unsupported", true);
    width = view.getUint16(entry.start + 32); height = view.getUint16(entry.start + 34); checkedDimensions(width, height);
    const extensions = mp4Boxes(bytes, entry.start + 86, entry.end, budget);
    if (uniqueBox(extensions, "sinf", false)) fail("encrypted_mp4_unsupported", true);
    if (uniqueBox(extensions, "clap", false)) fail("mp4_clean_aperture_unsupported", true);
    const pasp = uniqueBox(extensions, "pasp", false);
    if (pasp) { requireFact(pasp.end - pasp.data === 8 && view.getUint32(pasp.data) > 0 && view.getUint32(pasp.data + 4) > 0, "invalid_mp4_pixel_aspect"); if (view.getUint32(pasp.data) !== view.getUint32(pasp.data + 4)) fail("nonsquare_video_pixels_unsupported", true); }
    lengthSize = avcConfiguration(bytes, uniqueBox(extensions, "avcC")!, width, height);
    const matrix = headerStart + (version ? 52 : 40);
    requireFact(view.getInt32(matrix + 8) === 0 && view.getInt32(matrix + 20) === 0 && view.getUint32(matrix + 32) === 0x40000000, "mp4_transform_unsupported");
    const a = view.getInt32(matrix), b = view.getInt32(matrix + 4), c = view.getInt32(matrix + 12), d = view.getInt32(matrix + 16);
    if (a === 65536 && d === 65536 && b === 0 && c === 0) rotation = 0;
    else if (a === 0 && d === 0 && b === 65536 && c === -65536) rotation = 90;
    else if (a === -65536 && d === -65536 && b === 0 && c === 0) rotation = 180;
    else if (a === 0 && d === 0 && b === -65536 && c === 65536) rotation = 270;
    else fail("mp4_transform_unsupported", true);
    const dimensions = headerStart + (version ? 88 : 76);
    requireFact(view.getUint32(dimensions) === width * 65536 && view.getUint32(dimensions + 4) === height * 65536, "mp4_track_dimensions_mismatch");
  } else {
    if (entry.type !== "mp4a" || view.getUint16(entry.start + 16) !== 0) fail("mp4_audio_codec_unsupported", true);
    const extensions = mp4Boxes(bytes, entry.start + 36, entry.end, budget);
    if (uniqueBox(extensions, "sinf", false)) fail("encrypted_mp4_unsupported", true);
    const esds = uniqueBox(extensions, "esds")!;
    requireFact(esds.end - esds.data >= 8, "invalid_mp4_audio_description");
    // Codec configuration remains container evidence; AAC is not decoded here.
  }
  const stsz = uniqueBox(tables, "stsz")!, stts = uniqueBox(tables, "stts")!, stsc = uniqueBox(tables, "stsc")!;
  for (const table of [stsz, stts, stsc]) { fullBox(bytes, table); requireFact(table.end - table.data >= 8, "truncated_mp4_sample_table"); }
  requireFact(stsz.end - stsz.data >= 12, "truncated_mp4_sample_sizes");
  const uniformSize = view.getUint32(stsz.data + 4), sampleCount = view.getUint32(stsz.data + 8);
  requireFact(sampleCount > 0 && sampleCount <= 500_000 && stsz.end - stsz.data === 12 + (uniformSize ? 0 : sampleCount * 4), "invalid_mp4_sample_sizes");
  const sampleSize = (index: number) => uniformSize || view.getUint32(stsz.data + 12 + index * 4);
  const timingCount = view.getUint32(stts.data + 4);
  requireFact(timingCount > 0 && timingCount <= sampleCount && stts.end - stts.data === 8 + timingCount * 8, "invalid_mp4_sample_timing");
  let timedSamples = 0, ticks = 0;
  for (let index = 0; index < timingCount; index += 1) {
    const count = view.getUint32(stts.data + 8 + index * 8), delta = view.getUint32(stts.data + 12 + index * 8);
    requireFact(count > 0 && delta > 0, "invalid_mp4_sample_timing"); timedSamples += count; ticks += count * delta;
  }
  requireFact(timedSamples === sampleCount && Number.isSafeInteger(ticks) && ticks === clock.duration, "mp4_sample_duration_mismatch");
  const ctts = uniqueBox(tables, "ctts", false);
  if (ctts) {
    fullBox(bytes, ctts, [0, 1]); requireFact(ctts.end - ctts.data >= 8, "invalid_mp4_composition_timing");
    const count = view.getUint32(ctts.data + 4); requireFact(count > 0 && count <= sampleCount && ctts.end - ctts.data === 8 + count * 8, "invalid_mp4_composition_timing");
    let covered = 0;
    for (let index = 0; index < count; index += 1) { const samples = view.getUint32(ctts.data + 8 + index * 8); requireFact(samples > 0, "invalid_mp4_composition_timing"); covered += samples; }
    requireFact(covered === sampleCount, "invalid_mp4_composition_timing");
  }
  const stco = uniqueBox(tables, "stco", false), co64 = uniqueBox(tables, "co64", false);
  requireFact(Boolean(stco) !== Boolean(co64), "invalid_mp4_chunk_offset_tables");
  const offsets = (stco ?? co64)!; fullBox(bytes, offsets); requireFact(offsets.end - offsets.data >= 8, "truncated_mp4_chunk_offsets");
  const chunks = view.getUint32(offsets.data + 4), offsetWidth = co64 ? 8 : 4;
  requireFact(chunks > 0 && chunks <= sampleCount && offsets.end - offsets.data === 8 + chunks * offsetWidth, "invalid_mp4_chunk_offsets");
  const mappingCount = view.getUint32(stsc.data + 4);
  requireFact(mappingCount > 0 && mappingCount <= chunks && stsc.end - stsc.data === 8 + mappingCount * 12, "invalid_mp4_chunk_mapping");
  const mappings: Array<{ first: number; count: number }> = [];
  for (let index = 0; index < mappingCount; index += 1) {
    const at = stsc.data + 8 + index * 12, first = view.getUint32(at), count = view.getUint32(at + 4);
    requireFact(first >= 1 && first <= chunks && (index === 0 ? first === 1 : first > mappings[index - 1]!.first) && count > 0 && count <= sampleCount && view.getUint32(at + 8) === 1, "invalid_mp4_chunk_mapping");
    mappings.push({ first, count });
  }
  let sampleIndex = 0, mappingIndex = 0, nalCount = 0;
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    while (mappingIndex + 1 < mappings.length && chunk >= mappings[mappingIndex + 1]!.first) mappingIndex += 1;
    const offset = offsets.data + 8 + (chunk - 1) * offsetWidth, start = co64 ? safeUint64(view, offset) : view.getUint32(offset);
    let cursor = start;
    for (let index = 0; index < mappings[mappingIndex]!.count; index += 1) {
      requireFact(sampleIndex < sampleCount, "mp4_chunk_sample_count_mismatch");
      const size = sampleSize(sampleIndex++); requireFact(size > 0 && cursor + size <= bytes.length, "invalid_mp4_sample_range");
      const end = cursor + size;
      if (type === "vide") {
        let foundPicture = false;
        while (cursor < end) {
          requireFact(++nalCount <= 1_000_000 && cursor + lengthSize <= end, "invalid_mp4_nal_boundary");
          let length = 0;
          for (let byte = 0; byte < lengthSize; byte += 1) length = length * 256 + bytes[cursor++]!;
          requireFact(length >= 1 && cursor + length <= end && (bytes[cursor]! & 128) === 0, "invalid_mp4_nal_boundary");
          const nalType = bytes[cursor]! & 31;
          requireFact(nalType >= 1 && nalType <= 23, "invalid_mp4_nal_type");
          if (nalType === 1 || nalType === 5) { requireFact(length >= 2, "empty_mp4_picture"); foundPicture = true; }
          cursor += length;
        }
        requireFact(foundPicture, "missing_mp4_picture_sample");
      } else cursor = end;
    }
    requireFact(media.some(box => start >= box.data && cursor <= box.end), "mp4_samples_outside_media_data");
    occupied.push([start, cursor]);
  }
  requireFact(sampleIndex === sampleCount, "mp4_chunk_sample_count_mismatch");
  let durationSeconds = checkedDuration(ticks / clock.scale);
  const edits = uniqueBox(trackBoxes, "edts", false);
  if (edits) {
    const elst = uniqueBox(mp4Boxes(bytes, edits.data, edits.end, budget), "elst")!, editVersion = fullBox(bytes, elst, [0, 1]);
    requireFact(elst.end - elst.data >= 8, "invalid_mp4_edit_list");
    const count = view.getUint32(elst.data + 4), width = editVersion ? 20 : 12;
    if (count !== 1) fail("mp4_multisegment_edit_unsupported", true);
    requireFact(elst.end - elst.data === 8 + width, "invalid_mp4_edit_list");
    const start = elst.data + 8, segment = editVersion ? safeUint64(view, start) : view.getUint32(start);
    const mediaTime = editVersion ? Number(view.getBigInt64(start + 8)) : view.getInt32(start + 4);
    const rate = start + (editVersion ? 16 : 8);
    requireFact(Number.isSafeInteger(mediaTime) && mediaTime >= 0 && view.getInt16(rate) === 1 && view.getInt16(rate + 2) === 0 && segment > 0, "invalid_mp4_edit_list");
    const edited = segment / movieScale;
    if (Math.abs(edited - durationSeconds) > 1 || mediaTime / clock.scale > 1) fail("mp4_trimmed_timeline_unsupported", true);
    durationSeconds = checkedDuration(edited);
  }
  const trackTicks = version ? safeUint64(view, headerStart + 28) : view.getUint32(headerStart + 20);
  requireFact(Math.abs(trackTicks / movieScale - durationSeconds) <= Math.max(1 / movieScale, 1 / clock.scale) + 0.000001, "mp4_track_duration_mismatch");
  const rotated = rotation === 90 || rotation === 270;
  return { type, durationSeconds, sampleCount, codec: entry.type, ...(type === "vide" ? { width: rotated ? height : width, height: rotated ? width : height, codedWidth: width, codedHeight: height, rotationDegrees: rotation } : {}) };
}
function inspectMp4(bytes: Uint8Array): ParsedAsset {
  const budget = { count: 0 }, boxes = mp4Boxes(bytes, 0, bytes.length, budget), view = viewOf(bytes);
  const ftyp = uniqueBox(boxes, "ftyp")!;
  requireFact(boxes[0] === ftyp && ftyp.end - ftyp.data >= 8 && (ftyp.end - ftyp.data) % 4 === 0, "invalid_mp4_file_type");
  const brands = [ascii(bytes, ftyp.data)];
  for (let at = ftyp.data + 8; at < ftyp.end; at += 4) brands.push(ascii(bytes, at));
  if (!brands.some(value => ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1"].includes(value))) fail("mp4_brand_unsupported", true);
  if (boxes.some(box => box.type === "moof")) fail("fragmented_mp4_unsupported", true);
  const moov = uniqueBox(boxes, "moov")!, media = boxes.filter(box => box.type === "mdat");
  requireFact(media.length > 0 && media.every(box => box.end > box.data), "missing_mp4_media_data");
  const movieBoxes = mp4Boxes(bytes, moov.data, moov.end, budget);
  if (movieBoxes.some(box => box.type === "mvex")) fail("fragmented_mp4_unsupported", true);
  const clock = mp4Clock(bytes, uniqueBox(movieBoxes, "mvhd")!);
  const tracks = movieBoxes.filter(box => box.type === "trak");
  if (tracks.length < 1 || tracks.length > 2) fail("mp4_track_layout_unsupported", true);
  const occupied: Array<[number, number]> = [];
  const inspected = tracks.map(track => inspectMp4Track(bytes, track, clock.scale, media, budget, occupied));
  const videos = inspected.filter(track => track.type === "vide"), audio = inspected.filter(track => track.type === "soun");
  requireFact(videos.length === 1 && audio.length <= 1, "invalid_mp4_video_track_count");
  occupied.sort((first, second) => first[0] - second[0]);
  for (let index = 1; index < occupied.length; index += 1) requireFact(occupied[index]![0] >= occupied[index - 1]![1], "overlapping_mp4_samples");
  const maximum = Math.max(...inspected.map(track => track.durationSeconds));
  requireFact(Math.abs(clock.duration / clock.scale - maximum) <= 1 / clock.scale + 0.000001, "mp4_movie_duration_mismatch");
  // Consume view for validation only; no claimed browser MIME or file extension.
  requireFact(view.byteLength === bytes.length, "invalid_mp4_view");
  const video = videos[0]!;
  return { kind: "video", mimeType: "video/mp4", extension: "mp4", facts: { width: video.width, height: video.height, codedWidth: video.codedWidth, codedHeight: video.codedHeight, durationSeconds: video.durationSeconds, durationBasis: "mp4-track-timeline", frameCount: video.sampleCount, codec: "avc1", rotationDegrees: video.rotationDegrees, ...(audio[0] ? { audioCodec: "mp4a" } : {}) }, checks: ["mp4-box-boundaries", "mp4-self-contained-sample-tables", "mp4-avc-sps-dimensions", "mp4-nal-boundaries", "mp4-track-timing"], limitations: ["Container, sample clocks, and AVC sequence headers were checked; full video/audio decoding, playback, synchronization, and content require review."] };
}

type ZipEntry = { name: string; method: number; flags: number; crc: number; compressed: number; expanded: number; local: number; data: number; end: number; directory: boolean };
function safePackagePath(name: string, directory = false) {
  const parts = (directory ? name.slice(0, -1) : name).split("/");
  return name.length > 0 && encoder.encode(name).length <= 240 && /^[A-Za-z0-9_.[\] /-]+$/u.test(name)
    && !name.startsWith("/") && !name.includes("\\") && parts.every(part => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}
function validateZipExtra(bytes: Uint8Array, start: number, length: number) {
  const view = viewOf(bytes), end = start + length;
  requireFact(length <= 4096, "excessive_zip_extra_data");
  while (start < end) {
    requireFact(start + 4 <= end, "invalid_zip_extra_data");
    const id = view.getUint16(start, true), size = view.getUint16(start + 2, true);
    if ([0x0001, 0x0017, 0x7075, 0x9901].includes(id)) fail("zip_extension_unsupported", true);
    start += 4 + size; requireFact(start <= end, "invalid_zip_extra_data");
  }
}
function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = viewOf(bytes);
  let footer = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 4096); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { footer = at; break; }
  }
  requireFact(footer >= 0, "missing_zip_directory");
  const count = view.getUint16(footer + 10, true), size = view.getUint32(footer + 12, true), centralStart = view.getUint32(footer + 16, true);
  requireFact(view.getUint16(footer + 4, true) === 0 && view.getUint16(footer + 6, true) === 0 && view.getUint16(footer + 8, true) === count, "multidisk_zip_unsupported");
  requireFact(count > 0 && count <= MAX_ENTRIES && centralStart + size === footer, "invalid_zip_directory");
  let cursor = centralStart, expandedTotal = 0;
  const entries: ZipEntry[] = [], seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    requireFact(cursor + 46 <= footer && view.getUint32(cursor, true) === 0x02014b50, "invalid_zip_directory_entry");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true), local = view.getUint32(cursor + 42, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    requireFact(nameLength > 0 && nameLength <= 240 && commentLength <= 1024 && cursor + 46 + nameLength + extraLength + commentLength <= footer, "invalid_zip_entry_lengths");
    if ((flags & ~0x080e) !== 0 || method !== 0 && method !== 8 || method === 0 && (flags & 6)) fail("zip_encoding_unsupported", true);
    requireFact(view.getUint16(cursor + 34, true) === 0 && local < centralStart, "invalid_zip_local_reference");
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)), directory = name.endsWith("/");
    const canonical = (directory ? name.slice(0, -1) : name).toLowerCase();
    requireFact(safePackagePath(name, directory) && !seen.has(canonical), "unsafe_or_aliased_zip_path");
    seen.add(canonical);
    const attributes = view.getUint32(cursor + 38, true), mode = attributes >>> 16 & 0xf000;
    requireFact(mode === 0 || mode === 0x8000 && !directory || mode === 0x4000 && directory, "zip_special_file_unsupported");
    requireFact((attributes & 8) === 0 && (!(attributes & 16) || directory), "zip_special_file_unsupported");
    validateZipExtra(bytes, cursor + 46 + nameLength, extraLength);
    requireFact(expanded <= MAX_OUTPUT_ASSET_BYTES && compressed <= MAX_OUTPUT_ASSET_BYTES && (method !== 0 || compressed === expanded), "invalid_zip_entry_size");
    requireFact(!directory || expanded === 0, "invalid_zip_directory_payload");
    requireFact(expanded <= compressed * 200 + 4096, "excessive_zip_expansion_ratio");
    expandedTotal += expanded; requireFact(expandedTotal <= MAX_EXPANDED_BYTES, "expanded_asset_too_large");
    entries.push({ name, method, flags, crc, compressed, expanded, local, data: 0, end: 0, directory });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  requireFact(cursor === footer, "invalid_zip_directory_size");
  const files = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name.toLowerCase()));
  for (const entry of entries) {
    const parts = entry.name.toLowerCase().split("/");
    for (let depth = 1; depth < parts.length; depth += 1) requireFact(!files.has(parts.slice(0, depth).join("/")), "aliased_zip_file_directory");
  }
  let localCursor = 0;
  for (const entry of [...entries].sort((first, second) => first.local - second.local)) {
    requireFact(entry.local === localCursor && entry.local + 30 <= centralStart && view.getUint32(entry.local, true) === 0x04034b50, "overlapping_or_hidden_zip_entry");
    const at = entry.local, nameLength = view.getUint16(at + 26, true), extraLength = view.getUint16(at + 28, true);
    requireFact(view.getUint16(at + 6, true) === entry.flags && view.getUint16(at + 8, true) === entry.method && at + 30 + nameLength + extraLength <= centralStart, "zip_local_metadata_mismatch");
    requireFact(decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength)) === entry.name, "zip_local_name_mismatch");
    validateZipExtra(bytes, at + 30 + nameLength, extraLength);
    const localCrc = view.getUint32(at + 14, true), localCompressed = view.getUint32(at + 18, true), localExpanded = view.getUint32(at + 22, true);
    requireFact(entry.flags & 8 ? (localCrc === 0 || localCrc === entry.crc) && (localCompressed === 0 || localCompressed === entry.compressed) && (localExpanded === 0 || localExpanded === entry.expanded)
      : localCrc === entry.crc && localCompressed === entry.compressed && localExpanded === entry.expanded, "zip_local_size_or_crc_mismatch");
    entry.data = at + 30 + nameLength + extraLength; entry.end = entry.data + entry.compressed;
    requireFact(entry.end <= centralStart, "truncated_zip_entry");
    if (entry.flags & 8) {
      let descriptor = entry.end;
      requireFact(descriptor + 12 <= centralStart, "truncated_zip_descriptor");
      if (view.getUint32(descriptor, true) === 0x08074b50) descriptor += 4;
      requireFact(descriptor + 12 <= centralStart && view.getUint32(descriptor, true) === entry.crc && view.getUint32(descriptor + 4, true) === entry.compressed && view.getUint32(descriptor + 8, true) === entry.expanded, "zip_descriptor_mismatch");
      entry.end = descriptor + 12;
    }
    localCursor = entry.end;
  }
  requireFact(localCursor === centralStart, "hidden_zip_payload");
  return entries;
}

type XmlAttribute = { name: string; namespace: string; value: string };
type XmlNode = { name: string; namespace: string; attributes: XmlAttribute[]; parent: number | null };
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PRESENTATION_NAMESPACES = new Set(["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"]);
const OFFICE_NAMESPACES = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"]);
function xmlValue(value: string): string {
  requireFact(!/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(value), "invalid_office_xml_character");
  return value.replace(/&([^;]*);|&/gu, (whole, entity: string | undefined) => {
    const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity && Object.hasOwn(predefined, entity)) return predefined[entity]!;
    requireFact(entity && /^#(?:[0-9]+|x[0-9a-fA-F]+)$/u.test(entity), "unsupported_office_xml_entity");
    const point = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    requireFact(Number.isSafeInteger(point) && (point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && point !== 0xfffe && point !== 0xffff), "invalid_office_xml_entity");
    return String.fromCodePoint(point);
  });
}
function parseOfficeXml(bytes: Uint8Array): XmlNode[] {
  requireFact(bytes.length > 0 && bytes.length <= MAX_XML_BYTES, "office_xml_too_large");
  const text = decoder.decode(bytes).replace(/^\ufeff/u, "");
  requireFact(!/<!\s*(?:DOCTYPE|ENTITY)/iu.test(text), "office_xml_entities_forbidden");
  const nodes: XmlNode[] = [], stack: Array<{ index: number; qualified: string; namespaces: Map<string, string> }> = [];
  let cursor = 0, roots = 0, declaration = false;
  while (cursor < text.length) {
    const opening = text.indexOf("<", cursor), endText = opening < 0 ? text.length : opening, value = text.slice(cursor, endText);
    xmlValue(value); requireFact(stack.length > 0 || !value.trim(), "text_outside_office_xml_root");
    if (opening < 0) { cursor = text.length; break; }
    if (text.startsWith("<!--", opening)) {
      const end = text.indexOf("-->", opening + 4); requireFact(end >= 0 && !text.slice(opening + 4, end).includes("--"), "invalid_office_xml_comment"); cursor = end + 3; continue;
    }
    if (text.startsWith("<![CDATA[", opening)) {
      const end = text.indexOf("]]>", opening + 9); requireFact(end >= 0 && stack.length > 0, "invalid_office_xml_cdata"); cursor = end + 3; continue;
    }
    if (text.startsWith("<?", opening)) {
      const end = text.indexOf("?>", opening + 2), content = text.slice(opening + 2, end);
      requireFact(end >= 0 && opening === 0 && !declaration && /^xml\s+version\s*=\s*["']1\.0["'](?:\s+encoding\s*=\s*["']UTF-8["'])?(?:\s+standalone\s*=\s*["'](?:yes|no)["'])?\s*$/iu.test(content), "unsupported_office_xml_instruction");
      declaration = true; cursor = end + 2; continue;
    }
    let end = opening + 1, quote = "";
    for (; end < text.length; end += 1) {
      const character = text[end]!;
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    requireFact(end < text.length && !quote, "unterminated_office_xml_tag");
    let content = text.slice(opening + 1, end); cursor = end + 1;
    if (content.startsWith("/")) { const qualified = content.slice(1).trim(); requireFact(stack.length > 0 && /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/u.test(qualified) && stack.pop()!.qualified === qualified, "mismatched_office_xml_tag"); continue; }
    const closed = content.endsWith("/"); if (closed) content = content.slice(0, -1);
    const name = content.match(/^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=\s|$)/u);
    requireFact(name, "invalid_office_xml_tag");
    const rawAttributes: Array<[string, string]> = [], seen = new Set<string>();
    let attributes = content.slice(name[0].length);
    while (attributes.trim()) {
      const match = attributes.match(/^\s+([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/u);
      requireFact(match && !seen.has(match[1]!), "invalid_office_xml_attribute");
      seen.add(match[1]!); rawAttributes.push([match[1]!, xmlValue(match[2] ?? match[3] ?? "")]); attributes = attributes.slice(match[0].length);
      requireFact(rawAttributes.length <= 128, "too_many_office_xml_attributes");
    }
    const namespaces = new Map(stack.at(-1)?.namespaces ?? [["xml", XML_NS], ["", ""]]);
    for (const [qualified, value] of rawAttributes) if (qualified === "xmlns" || qualified.startsWith("xmlns:")) {
      const prefix = qualified === "xmlns" ? "" : qualified.slice(6);
      requireFact(prefix !== "xmlns" && (prefix !== "xml" || value === XML_NS) && (prefix === "" || value.length > 0), "invalid_office_xml_namespace"); namespaces.set(prefix, value);
    }
    requireFact(namespaces.size <= 128, "excessive_office_xml_namespaces");
    const split = (qualified: string, attribute = false) => {
      const parts = qualified.split(":"), prefix = parts.length === 2 ? parts[0]! : "", local = parts.at(-1)!;
      const namespace = prefix ? namespaces.get(prefix) : attribute ? "" : namespaces.get("");
      requireFact(namespace !== undefined, "unknown_office_xml_namespace"); return { name: local, namespace };
    };
    const resolved = split(name[1]!), resolvedAttributes: XmlAttribute[] = [], attributeNames = new Set<string>();
    for (const [qualified, value] of rawAttributes) {
      if (qualified === "xmlns" || qualified.startsWith("xmlns:")) continue;
      const resolved = split(qualified, true), key = `${resolved.namespace}|${resolved.name}`;
      requireFact(!attributeNames.has(key), "duplicate_office_xml_attribute"); attributeNames.add(key); resolvedAttributes.push({ ...resolved, value });
    }
    requireFact(nodes.length < MAX_NODES && stack.length < 64, "excessive_office_xml_structure");
    if (!stack.length) requireFact(++roots === 1, "multiple_office_xml_roots");
    const index = nodes.length; nodes.push({ ...resolved, attributes: resolvedAttributes, parent: stack.at(-1)?.index ?? null });
    if (!closed) stack.push({ index, qualified: name[1]!, namespaces });
  }
  requireFact(roots === 1 && !stack.length, "incomplete_office_xml");
  return nodes;
}
const xmlAttribute = (node: XmlNode, name: string, namespace = "") => node.attributes.find(attribute => attribute.name === name && attribute.namespace === namespace)?.value;
function requiredAttribute(node: XmlNode, name: string, namespace = "") {
  const value = xmlAttribute(node, name, namespace); requireFact(value !== undefined && value.length > 0, "missing_office_xml_attribute"); return value;
}
function resolvePackageTarget(source: string, target: string): string {
  requireFact(target.length > 0 && target.length <= 512 && !/[\\\p{Cc}\p{Cf}:?#]/u.test(target) && !/%(?:2f|5c|00)/iu.test(target), "unsafe_office_relationship_target");
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { return fail("invalid_office_relationship_encoding"); }
  requireFact(!/%[0-9a-f]{2}/iu.test(decoded) && !decoded.startsWith("//"), "aliased_office_relationship_target");
  const parts = decoded.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const part of decoded.replace(/^\//u, "").split("/")) {
    if (part === ".") continue;
    if (part === "..") { requireFact(parts.length > 0, "office_relationship_escapes_package"); parts.pop(); }
    else { requireFact(part.length > 0, "invalid_office_relationship_target"); parts.push(part); }
  }
  const result = parts.join("/"); requireFact(safePackagePath(result), "unsafe_office_relationship_target"); return result;
}
type OfficeRelationship = { id: string; type: string; target: string; external: boolean };
function officeRelationships(nodes: XmlNode[], source: string, names: Set<string>): OfficeRelationship[] {
  const root = nodes[0]!; requireFact(root.name === "Relationships" && root.namespace === PKG_NS, "invalid_office_relationship_root");
  const relationships: OfficeRelationship[] = [], ids = new Set<string>();
  const kinds = new Set(["officeDocument", "slide", "slideMaster", "slideLayout", "notesSlide", "notesMaster", "handoutMaster", "theme", "themeOverride", "image", "hyperlink", "presProps", "viewProps", "tableStyles", "tags", "comments", "commentAuthors", "extended-properties", "custom-properties"]);
  for (const node of nodes.slice(1)) {
    requireFact(node.parent === 0 && node.name === "Relationship" && node.namespace === PKG_NS, "invalid_office_relationship_element");
    const id = requiredAttribute(node, "Id"), type = requiredAttribute(node, "Type"), target = requiredAttribute(node, "Target"), mode = xmlAttribute(node, "TargetMode");
    requireFact(id.length <= 128 && !ids.has(id) && (!mode || mode === "Internal" || mode === "External"), "invalid_office_relationship"); ids.add(id);
    const kind = type.slice(type.lastIndexOf("/") + 1), family = type.slice(0, type.lastIndexOf("/"));
    if (!(OFFICE_NAMESPACES.has(family) && kinds.has(kind)) && ![`${PKG_NS}/metadata/core-properties`, `${PKG_NS}/metadata/thumbnail`].includes(type)) fail("office_relationship_type_unsupported", true);
    if (mode === "External") {
      if (kind !== "hyperlink") fail("external_office_media_unsupported", true);
      let url: URL; try { url = new URL(target); } catch { return fail("unsafe_office_external_link"); }
      requireFact((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && target.length <= 2048, "unsafe_office_external_link");
      relationships.push({ id, type, target: url.href, external: true });
    } else {
      const resolved = resolvePackageTarget(source, target); requireFact(names.has(resolved), "missing_office_relationship_part");
      relationships.push({ id, type, target: resolved, external: false });
    }
  }
  return relationships;
}
async function inspectPptx(bytes: Uint8Array): Promise<ParsedAsset> {
  const entries = readZipDirectory(bytes), names = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name));
  requireFact(names.has("[Content_Types].xml") && names.has("_rels/.rels"), "not_an_ooxml_package");
  const retained = new Map<string, XmlNode[]>(), allRelationships = new Map<string, OfficeRelationship[]>(), slideParts = new Map<string, boolean>();
  let externalHyperlinkCount = 0, xmlBytes = 0;
  for (const entry of entries) {
    const lowered = entry.name.toLowerCase();
    if (/(?:^|\/)(?:vbaproject|vbadata|activex|embeddings|customui)(?:\.|\/|$)/u.test(lowered) || /\.(?:bin|exe|dll|com|js|vbs|ps1|bat|cmd|scr|msi|html?)$/u.test(lowered)) fail("active_office_content_forbidden");
    if (!entry.directory && !/\.(?:xml|rels|png|jpe?g|webp)$/iu.test(entry.name)) fail("office_embedded_format_unsupported", true);
    const compressed = bytes.subarray(entry.data, entry.data + entry.compressed);
    const expanded = entry.method === 0 ? compressed : await inflateBounded(compressed, "deflate-raw", entry.expanded);
    requireFact(expanded.length === entry.expanded && crc32(expanded) === entry.crc, "zip_entry_size_or_crc_mismatch");
    if (entry.directory) continue;
    if (!/\.(?:xml|rels)$/iu.test(entry.name)) continue;
    xmlBytes += expanded.length; requireFact(xmlBytes <= 12 * MAX_XML_BYTES, "excessive_office_xml_total");
    const nodes = parseOfficeXml(expanded);
    for (const node of nodes) {
      if (/^(?:oleObj|control|controls|vbaProject|activeX)$/iu.test(node.name)) fail("active_office_content_forbidden");
      for (const attribute of node.attributes) if (attribute.name === "action") {
        let action: string; try { action = decodeURIComponent(attribute.value); } catch { return fail("invalid_office_action"); }
        if (/(?:macro|program|script|hlinkfile|oleverb)/iu.test(action)) fail("active_office_content_forbidden");
      }
    }
    if (entry.name.endsWith(".rels")) {
      const source = entry.name === "_rels/.rels" ? "" : entry.name.replace(/(^|\/)_rels\/([^/]+)\.rels$/u, "$1$2");
      requireFact(source === "" || source !== entry.name && names.has(source), "orphan_office_relationship_part");
      const relations = officeRelationships(nodes, source, names);
      allRelationships.set(source, relations); externalHyperlinkCount += relations.filter(relation => relation.external).length;
    }
    if (entry.name === "[Content_Types].xml" || entry.name === "ppt/presentation.xml") retained.set(entry.name, nodes);
    if (/^ppt\/slides\/[^/]+\.xml$/u.test(entry.name)) {
      const root = nodes[0]!; requireFact(root.name === "sld" && PRESENTATION_NAMESPACES.has(root.namespace), "invalid_presentation_slide_root");
      const common = nodes.findIndex(node => node.parent === 0 && node.name === "cSld" && node.namespace === root.namespace);
      requireFact(common > 0 && nodes.some(node => node.parent === common && node.name === "spTree" && node.namespace === root.namespace), "missing_presentation_slide_tree");
      const show = xmlAttribute(root, "show"); requireFact(show === undefined || ["0", "1", "false", "true"].includes(show), "invalid_presentation_slide_visibility");
      slideParts.set(entry.name, show === "0" || show === "false");
    }
  }
  const types = retained.get("[Content_Types].xml")!;
  requireFact(types[0]!.name === "Types" && types[0]!.namespace === TYPES_NS, "invalid_office_content_types");
  const defaults = new Map<string, string>(), overrides = new Map<string, string>();
  for (const node of types.slice(1)) {
    requireFact(node.parent === 0 && node.namespace === TYPES_NS && (node.name === "Default" || node.name === "Override"), "invalid_office_content_type_element");
    const type = requiredAttribute(node, "ContentType");
    if (/macroenabled|vbaproject|vbaData|activex|oleobject|x-msdownload/iu.test(type)) fail("active_office_content_forbidden");
    requireFact(type.length <= 200 && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/u.test(type), "invalid_office_content_type");
    if (node.name === "Default") {
      const extension = requiredAttribute(node, "Extension").toLowerCase(); requireFact(/^[a-z0-9]+$/u.test(extension) && !defaults.has(extension), "duplicate_office_content_type"); defaults.set(extension, type);
    } else {
      const part = requiredAttribute(node, "PartName"); requireFact(part.startsWith("/"), "invalid_office_content_type_part");
      const target = resolvePackageTarget("", part); requireFact(names.has(target) && !overrides.has(target), "invalid_office_content_type_part"); overrides.set(target, type);
    }
  }
  const contentType = (name: string) => overrides.get(name) ?? defaults.get(name.slice(name.lastIndexOf(".") + 1).toLowerCase());
  for (const name of names) if (name !== "[Content_Types].xml") requireFact(contentType(name), "missing_office_content_type");
  requireFact(contentType("ppt/presentation.xml") === "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", "not_a_macro_free_presentation");
  const rootRelations = allRelationships.get("") ?? [], officeRoots = rootRelations.filter(relation => relation.type.endsWith("/officeDocument"));
  requireFact(officeRoots.length === 1 && !officeRoots[0]!.external && officeRoots[0]!.target === "ppt/presentation.xml", "invalid_presentation_root_relationship");
  const presentation = retained.get("ppt/presentation.xml"); requireFact(presentation, "missing_presentation_main_part");
  const root = presentation[0]!; requireFact(root.name === "presentation" && PRESENTATION_NAMESPACES.has(root.namespace), "invalid_presentation_root");
  const lists = presentation.map((node, index) => ({ node, index })).filter(({ node }) => node.parent === 0 && node.name === "sldIdLst" && node.namespace === root.namespace);
  requireFact(lists.length === 1, "invalid_presentation_slide_list");
  const slides = presentation.filter(node => node.parent === lists[0]!.index);
  requireFact(slides.length > 0 && slides.length <= 200, "invalid_or_excessive_presentation_slide_count");
  const relationships = allRelationships.get("ppt/presentation.xml") ?? [], usedIds = new Set<string>(), usedParts = new Set<string>(), usedNumericIds = new Set<string>();
  let hiddenSlideCount = 0;
  for (const node of slides) {
    requireFact(node.name === "sldId" && node.namespace === root.namespace, "invalid_presentation_slide_list_entry");
    const id = node.attributes.find(attribute => attribute.name === "id" && OFFICE_NAMESPACES.has(attribute.namespace))?.value;
    const numericId = requiredAttribute(node, "id");
    requireFact(/^[0-9]+$/u.test(numericId) && Number(numericId) >= 256 && Number(numericId) < 2 ** 31 && !usedNumericIds.has(String(Number(numericId))), "invalid_presentation_slide_id");
    requireFact(id && !usedIds.has(id), "invalid_presentation_slide_relationship_id");
    usedNumericIds.add(String(Number(numericId))); usedIds.add(id);
    const relation = relationships.find(relation => relation.id === id);
    requireFact(relation && !relation.external && relation.type.endsWith("/slide") && slideParts.has(relation.target) && !usedParts.has(relation.target), "invalid_presentation_slide_relationship");
    requireFact(contentType(relation.target) === "application/vnd.openxmlformats-officedocument.presentationml.slide+xml", "invalid_presentation_slide_content_type");
    usedParts.add(relation.target); if (slideParts.get(relation.target)) hiddenSlideCount += 1;
  }
  const sizes = presentation.filter(node => node.parent === 0 && node.name === "sldSz" && node.namespace === root.namespace);
  requireFact(sizes.length === 1, "invalid_presentation_slide_size");
  const width = requiredAttribute(sizes[0]!, "cx"), height = requiredAttribute(sizes[0]!, "cy");
  requireFact(/^[0-9]+$/u.test(width) && /^[0-9]+$/u.test(height) && Number(width) >= 914400 && Number(height) >= 914400 && Number(width) <= 51_206_400 && Number(height) <= 51_206_400, "invalid_presentation_slide_size");
  return { kind: "presentation", mimeType: PPTX_MIME, extension: "pptx", facts: { slideCount: slides.length, hiddenSlideCount, slideWidthEmu: Number(width), slideHeightEmu: Number(height), externalHyperlinkCount }, checks: ["zip-local-central-consistency", "zip-crc-and-expansion-bounds", "office-xml-structure", "macro-and-external-media-rejection", "ordered-presentation-slide-relationships"], limitations: ["Slide count includes hidden slides, which are separately counted. Slide rendering, useful content, citations, accessibility, and linked-page safety require review; external hyperlinks were not fetched."] };
}

function inspectGlb(bytes: Uint8Array): ParsedAsset {
  let model: Record<string, unknown>;
  try { model = validateModel3dAsset(bytes).json; }
  catch { return fail("invalid_glb_model"); }
  const meshes = model.meshes as Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
  const accessors = model.accessors as Array<{ count: number }>;
  let primitiveCount = 0, vertexCount = 0;
  for (const mesh of meshes) for (const primitive of mesh.primitives) {
    primitiveCount += 1;
    vertexCount += accessors[primitive.attributes.POSITION]!.count;
  }
  const count = (key: string) => Array.isArray(model[key]) ? model[key].length : 0;
  return {
    kind: "model3d", mimeType: "model/gltf-binary", extension: "glb",
    facts: { meshCount: meshes.length, primitiveCount, vertexCount, materialCount: count("materials"), textureCount: count("textures"), animationCount: count("animations"), nodeCount: count("nodes") },
    checks: ["glb-v2-chunk-boundaries", "gltf-self-contained-resources", "gltf-buffer-and-accessor-bounds", "gltf-finite-geometry-and-index-ranges", "gltf-embedded-image-framing", "gltf-scene-references"],
    limitations: ["Geometry and embedded resource boundaries were checked. Model appearance, materials, animation playback, and the selected view require visual review. Counts describe stored mesh primitives and their vertex attributes, not visible or unique vertices."],
  };
}

function inspectMarkdown(bytes: Uint8Array): ParsedAsset {
  let text: string;
  try { text = decoder.decode(bytes); } catch { return fail("invalid_markdown_text"); }
  requireFact(text.trim().length > 0, "invalid_markdown_text");
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    requireFact(!(code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      && !(code >= 0x7f && code <= 0x9f), "invalid_markdown_text");
  }
  return {
    kind: "document", mimeType: "text/markdown", extension: "md", facts: {},
    checks: ["explicit-safe-markdown-filename", "fatal-utf8-decode", "nonblank-text", "binary-control-rejection"],
    limitations: ["Only bounded, nonblank UTF-8 text was checked. Markdown rendering, screenplay structure, completeness, source coverage, rights, linked-content safety and film composition require separate review; no links or embedded media were fetched."],
  };
}

/**
 * Inspect exact file bytes; no MIME or dimension assertions from the caller are accepted.
 * Snapshotting is the public default. Internal callers may disable it only when
 * they own immutable input bytes and guarantee no mutation until inspection ends.
 */
export async function inspectOutputAsset(input: Uint8Array, declaredName?: string, options: { snapshot?: boolean } = {}): Promise<OutputAssetInspection> {
  const empty: OutputAssetInspection = { status: "invalid", kind: null, mimeType: null, extension: null, byteLength: input instanceof Uint8Array ? input.byteLength : 0, sha256: null, facts: {}, checks: [], limitations: ["Inspection does not grant acceptance, rights, provenance, or a claim of useful or grounded content."], limitationCodes: ["output_inspection_not_acceptance"], errors: [] };
  if (!(input instanceof Uint8Array) || !input.byteLength) return { ...empty, errors: ["empty_output_asset"] };
  const isGlb = input.byteLength >= 4 && input[0] === 0x67 && input[1] === 0x6c && input[2] === 0x54 && input[3] === 0x46;
  if (input.byteLength > (isGlb ? MAX_OUTPUT_MODEL3D_ASSET_BYTES : MAX_OUTPUT_ASSET_BYTES)) return { ...empty, errors: ["output_asset_too_large"] };
  if (declaredName !== undefined && !validOutputAssetName(declaredName)) return { ...empty, errors: ["unsafe_output_asset_name"] };
  const bytes = options.snapshot === false ? input : new Uint8Array(input);
  empty.sha256 = await outputAssetSha256(bytes);
  try {
    let parsed: ParsedAsset;
    if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") parsed = await inspectPng(bytes);
    else if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 0xd8) parsed = inspectJpeg(bytes);
    else if (bytes.length >= 12 && ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "WAVE") parsed = inspectWav(bytes);
    else if (bytes.length >= 3 && (ascii(bytes, 0, 3) === "ID3" || bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0)) parsed = inspectMp3(bytes);
    else if (bytes.length >= 8 && ascii(bytes, 4) === "ftyp") parsed = inspectMp4(bytes);
    else if (bytes.length >= 4 && ascii(bytes, 0) === "PK\x03\x04") parsed = await inspectPptx(bytes);
    else if (isGlb) parsed = inspectGlb(bytes);
    // These recognizable unsupported formats must not become documents merely
    // because their headers can be decoded as text and their suffix is .md.
    else if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
      || bytes.length >= 12 && ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "WEBP"
      || bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") fail("output_asset_format_unsupported", true);
    else if (declaredName !== undefined && /\.md$/iu.test(declaredName)) parsed = inspectMarkdown(bytes);
    else fail("output_asset_format_unsupported", true);
    const formatLimitations = { png: "output_png_visual_review_required", jpg: "output_jpeg_decode_review_required", wav: "output_wav_listening_review_required", mp3: "output_mp3_listening_review_required", mp4: "output_mp4_playback_review_required", pptx: "output_pptx_content_review_required", glb: "output_model3d_visual_review_required", md: "output_markdown_content_review_required" };
    return { ...empty, ...parsed, status: "inspected", errors: [], limitations: [...empty.limitations, ...parsed.limitations], limitationCodes: [...empty.limitationCodes!, ...(parsed.extension ? [formatLimitations[parsed.extension]] : [])] };
  } catch (error) {
    return { ...empty, status: error instanceof InspectionFailure && error.unsupported ? "unsupported" : "invalid", errors: [error instanceof InspectionFailure ? error.code : "asset_inspection_failed"] };
  }
}
