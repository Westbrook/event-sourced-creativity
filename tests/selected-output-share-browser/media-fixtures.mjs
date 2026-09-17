// Pure synthetic browser fixtures. No private asset, provider, storage or
// generation API is read. Qualification below proves this bounded local format
// only; it does not prove canonical custody, consent or publication authority.
import { qualifySelectedOutputShareAudio } from "../../src/model/selected-output-share-audio.ts";
import { qualifySelectedOutputShareVideoWithX264Declaration } from "../../src/model/selected-output-share-video.ts";
import { qualifySelectedOutputShareTexturedModel3d } from "../../src/model/selected-output-share-model3d.ts";

const utf8 = value => new TextEncoder().encode(value);
function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0; for (const part of parts) { bytes.set(part, cursor); cursor += part.length; } return bytes;
}
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
function wav() {
  const samples = 8000, sampleRate = 8000, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  bytes.set(utf8("RIFF")); view.setUint32(4, bytes.length - 8, true); bytes.set(utf8("WAVEfmt "), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); bytes.set(utf8("data"), 36); view.setUint32(40, samples * 2, true);
  // Quiet synthetic 440 Hz tone, generated locally. Playback still needs the
  // actual native player's explicit user gesture; the fixture never starts it.
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(1000 * Math.sin(index * 2 * Math.PI * 440 / sampleRate)), true);
  return bytes;
}
// Exact reviewed synthetic two-black-picture x264 163 r3060 donor from
// tests/helpers/native-media-custody-fixture.mjs, not an uploaded/provider file.
const video = () => Uint8Array.from(atob("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK7bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABam1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASpzdGJsAAAAqnN0c2QAAAAAAAAAAQAAAJphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAwwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAAusAAAAIZnJlZQAAAyBtZGF0AAAC9QYF///x3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2MyByMzA2MCA1ZGI2YWE2IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTEgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9MiBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0yIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MSBrZXlpbnQ9MjUwIGtleWludF9taW49MjQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD0xMCByYz1hYnIgbWJ0cmVlPTEgYml0cmF0ZT0xMTQ5IHJhdGV0b2w9MS4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCB2YnZfbWF4cmF0ZT0xNzI0IHZidl9idWZzaXplPTIyOTkgbmFsX2hyZD1ub25lIGZpbGxlcj0wIGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEABT//vfHT8Cm6twnAAAACEGaIWxBL/7g"), byte => byte.charCodeAt(0));
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type, content) {
  const bytes = new Uint8Array(content.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, content.length); bytes.set(utf8(type), 4); bytes.set(content, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4))); return bytes;
}
function png() {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array([0, 64, 160, 224, 255]); // filter 0, one opaque blue pixel
  let a = 1, b = 0; for (const value of raw) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const checksum = new Uint8Array(4); new DataView(checksum.buffer).setUint32(0, (b << 16 | a) >>> 0);
  // A single final stored DEFLATE block, with a valid zlib header and Adler-32.
  const compressed = join(new Uint8Array([0x78, 0x01, 0x01, raw.length, 0, 255 - raw.length, 255]), raw, checksum);
  return join(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
}
function glb() {
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, mode: 4, material: 0 }] }],
    buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [] };
  const parts = [];
  const append = bytes => {
    const used = parts.reduce((sum, part) => sum + part.length, 0), offset = Math.ceil(used / 4) * 4;
    if (offset > used) parts.push(new Uint8Array(offset - used));
    const index = model.bufferViews.length; parts.push(bytes); model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); return index;
  };
  const add = (values, type, components, bounds = {}) => {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    model.accessors.push({ bufferView: append(bytes), componentType: 5126, count: values.length / components, type, ...bounds });
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", 3, { min: [0, 0, 0], max: [1, 1, 0] });
  add([0, 0, 1, 0, 0, 1, 0, 0, 1], "VEC3", 3); add([0, 0, 1, 0, 0, 1], "VEC2", 2);
  model.images.push({ bufferView: append(png()), mimeType: "image/png" });
  const binary = join(...parts); model.buffers[0].byteLength = binary.length;
  const json = utf8(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4, binaryLength = Math.ceil(binary.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binaryLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(binary, 28 + jsonLength); return bytes;
}
export async function syntheticMediaFixtures() {
  const media = new Map();
  for (const [kind, bytes] of [["audio", wav()], ["video", video()], ["model3d", glb()]]) {
    const expected = { sha256: await sha256(bytes), byteLength: bytes.length };
    const result = kind === "audio" ? await qualifySelectedOutputShareAudio(bytes, { ...expected, mimeType: "audio/wav" })
      : kind === "video" ? await qualifySelectedOutputShareVideoWithX264Declaration(bytes, { ...expected, width: 16, height: 16, durationSeconds: 1 })
        : await qualifySelectedOutputShareTexturedModel3d(bytes, expected);
    if (result.status !== "qualified") throw new Error(`Synthetic ${kind} qualification failed: ${result.reason}`);
    const descriptor = Object.freeze({ kind, mimeType: result.mimeType, sha256: result.sha256, byteLength: result.byteLength,
      ...(kind === "audio" ? { sampleRate: result.sampleRate, channels: result.channels, sampleCount: result.sampleCount,
        durationSeconds: result.durationSeconds, durationBasis: result.durationBasis }
        : kind === "video" ? { width: result.width, height: result.height, durationSeconds: result.durationSeconds } : {}) });
    media.set(kind, Object.freeze({ bytes, descriptor, policy: result.policy,
      disclosure: Object.freeze(kind === "audio" ? { watermark: "not-declared" } : kind === "video" ? { encoderDeclaration: "x264-163-r3060" } : {}) }));
  }
  return media;
}
