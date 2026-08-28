import { deflateSync, deflateRawSync } from "node:zlib";

const encoder = new TextEncoder();
export const utf8 = value => encoder.encode(value);
export function join(...arrays) {
  const bytes = new Uint8Array(arrays.reduce((length, value) => length + value.length, 0));
  let cursor = 0; for (const value of arrays) { bytes.set(value, cursor); cursor += value.length; } return bytes;
}
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
export function pngChunk(type, content) {
  const bytes = new Uint8Array(content.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, content.length); bytes.set(utf8(type), 4); bytes.set(content, 8); view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4))); return bytes;
}
export function png({ width = 3, height = 2, interlace = 0, raw, extraChunks = [] } = {}) {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6, 0, 0, interlace], 8);
  const pixels = raw ?? new Uint8Array((width * 4 + 1) * height);
  return join(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), ...extraChunks, pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", new Uint8Array()));
}
function jpegMarker(marker, payload) { const bytes = new Uint8Array(payload.length + 4); bytes.set([255, marker]); new DataView(bytes.buffer).setUint16(2, payload.length + 2); bytes.set(payload, 4); return bytes; }
/** Real grayscale baseline JPEG: one zero DC coefficient and EOB per MCU. */
export function jpeg({ width = 1, height = 1, orientation } = {}) {
  const dqt = new Uint8Array(65).fill(1); dqt[0] = 0;
  const dc = new Uint8Array(18), ac = new Uint8Array(18); dc[1] = 1; ac[0] = 16; ac[1] = 1;
  const frame = new Uint8Array(9), frameView = new DataView(frame.buffer); frame[0] = 8; frameView.setUint16(1, height); frameView.setUint16(3, width); frame.set([1, 1, 17, 0], 5);
  const exif = [];
  if (orientation !== undefined) {
    const payload = new Uint8Array(32), view = new DataView(payload.buffer); payload.set(utf8("Exif\0\0II")); view.setUint16(8, 42, true); view.setUint32(10, 8, true); view.setUint16(14, 1, true); view.setUint16(16, 0x112, true); view.setUint16(18, 3, true); view.setUint32(20, 1, true); view.setUint16(24, orientation, true); exif.push(jpegMarker(0xe1, payload));
  }
  return join(Uint8Array.from([255, 216]), ...exif, jpegMarker(0xdb, dqt), jpegMarker(0xc0, frame), jpegMarker(0xc4, join(dc, ac)), jpegMarker(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])), Uint8Array.from([63, 255, 217]));
}
export function wav({ samples = 4000, sampleRate = 8000, channels = 1 } = {}) {
  const bytes = new Uint8Array(44 + samples * channels * 2), view = new DataView(bytes.buffer);
  bytes.set(utf8("RIFF")); view.setUint32(4, bytes.length - 8, true); bytes.set(utf8("WAVEfmt "), 8); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); bytes.set(utf8("data"), 36); view.setUint32(40, bytes.length - 44, true); return bytes;
}
/** Structurally complete silent Layer III frames; tests do not claim listening QA. */
export function mp3({ frames = 3, id3 = false } = {}) {
  const parts = [];
  if (id3) parts.push(Uint8Array.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]));
  for (let index = 0; index < frames; index += 1) { const frame = new Uint8Array(417); frame.set([255, 251, 144, 0]); parts.push(frame); }
  return join(...parts);
}
// Deterministically retained real one-second, 16x16 AVC MP4 fixture, created once
// with ffmpeg's lavfi black source/libx264 (two frames), not a header-only mock.
export function mp4() {
  return new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMMbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHTbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABfm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAT5zdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABaAAAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAAAgAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAACxAAAAAwAAAAUc3RjbwAAAAAAAAABAAADPAAAAD11ZHRhAAAANW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAACGlsc3QAAAAIZnJlZQAAAthtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEABT//vfHT8Cm6twnAAAACEGaIWxBL/7g", "base64"));
}
const P = "http://schemas.openxmlformats.org/presentationml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
export function presentationEntries({ slides = 2, hidden = [], external } = {}) {
  const entries = [
    { name: "[Content_Types].xml", content: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${Array.from({ length: slides }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: "ppt/presentation.xml", content: `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${Array.from({ length: slides }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", content: `<Relationships xmlns="${PKG}">${Array.from({ length: slides }, (_, index) => `<Relationship Id="rId${index + 1}" Type="${R}/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>` },
    ...Array.from({ length: slides }, (_, index) => ({ name: `ppt/slides/slide${index + 1}.xml`, content: `<p:sld xmlns:p="${P}"${hidden.includes(index + 1) ? ' show="0"' : ""}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>` })),
  ];
  if (external) entries.push({ name: "ppt/slides/_rels/slide1.xml.rels", content: `<Relationships xmlns="${PKG}"><Relationship Id="hyperlink1" Type="${R}/${external.kind ?? "hyperlink"}" Target="${external.url}" TargetMode="External"/></Relationships>` });
  return entries;
}
/** Independent ZIP fixture writer, optionally raw DEFLATE, including unsafe paths for rejection tests. */
export function zip(entries, { compressed = false } = {}) {
  const parts = entries.map(entry => {
    const name = utf8(entry.name), raw = typeof entry.content === "string" ? utf8(entry.content) : entry.content;
    return { name, raw, body: compressed ? new Uint8Array(deflateRawSync(raw)) : raw, crc: crc32(raw) };
  });
  const localSize = parts.reduce((sum, entry) => sum + 30 + entry.name.length + entry.body.length, 0), centralSize = parts.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const bytes = new Uint8Array(localSize + centralSize + 22), view = new DataView(bytes.buffer); let local = 0, central = localSize;
  for (const entry of parts) {
    view.setUint32(local, 0x04034b50, true); view.setUint16(local + 4, 20, true); view.setUint16(local + 6, 0x0800, true); view.setUint16(local + 8, compressed ? 8 : 0, true); view.setUint32(local + 14, entry.crc, true); view.setUint32(local + 18, entry.body.length, true); view.setUint32(local + 22, entry.raw.length, true); view.setUint16(local + 26, entry.name.length, true); bytes.set(entry.name, local + 30); bytes.set(entry.body, local + 30 + entry.name.length);
    view.setUint32(central, 0x02014b50, true); view.setUint16(central + 4, 20, true); view.setUint16(central + 6, 20, true); view.setUint16(central + 8, 0x0800, true); view.setUint16(central + 10, compressed ? 8 : 0, true); view.setUint32(central + 16, entry.crc, true); view.setUint32(central + 20, entry.body.length, true); view.setUint32(central + 24, entry.raw.length, true); view.setUint16(central + 28, entry.name.length, true); view.setUint32(central + 42, local, true); bytes.set(entry.name, central + 46); local += 30 + entry.name.length + entry.body.length; central += 46 + entry.name.length;
  }
  view.setUint32(central, 0x06054b50, true); view.setUint16(central + 8, parts.length, true); view.setUint16(central + 10, parts.length, true); view.setUint32(central + 12, centralSize, true); view.setUint32(central + 16, localSize, true); return bytes;
}
export function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = new Map(), footer = bytes.length - 22;
  if (view.getUint32(footer, true) !== 0x06054b50) throw new Error("invalid fixture ZIP footer");
  let central = view.getUint32(footer + 16, true);
  for (let index = 0; index < view.getUint16(footer + 10, true); index += 1) {
    const nameLength = view.getUint16(central + 28, true), local = view.getUint32(central + 42, true), size = view.getUint32(central + 24, true);
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength)), start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), body = bytes.slice(start, start + size);
    if (view.getUint16(local + 8, true) !== 0 || crc32(body) !== view.getUint32(central + 16, true)) throw new Error("invalid fixture ZIP contents");
    result.set(name, body); central += 46 + nameLength + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  }
  if (central !== footer) throw new Error("invalid fixture ZIP boundary"); return result;
}
