import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_SHARE_MP3_ENVELOPE_LIMITS, parseAudioShareMp3Envelope } from "../worker/audio-share-mp3-envelope.ts";

const text = value => new TextEncoder().encode(value);
const join = (...parts) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const put32 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);
const putSync = (bytes, offset, value) => { for (let i = 3; i >= 0; i--) { bytes[offset + i] = value & 127; value >>>= 7; } };
function id3(payload = text("SYNTHETIC_PRIVATE_METADATA"), { version = 4, id = "TXXX", flags = 0, padding = 0 } = {}) {
  const result = new Uint8Array(20 + payload.length + padding);
  result.set(text("ID3")); result[3] = version; putSync(result, 6, result.length - 10);
  result.set(text(id), 10);
  (version === 4 ? putSync : put32)(result, 14, payload.length);
  result[19] = flags; result.set(payload, 20);
  return result;
}
function fixture({ rate = 44100, channels = 2, count = 3, delay = 576, padding = 1008, flags = 15, kind = "Info", encoder = "Lavc62.28" } = {}) {
  const rateIndex = [44100, 48000, 32000].indexOf(rate);
  const size = Math.floor(144000 * 128 / rate);
  const result = new Uint8Array((count + 1) * size);
  for (let index = 0; index <= count; index++) result.set([255, 251, 0x90 | (rateIndex << 2), channels === 1 ? 0xc0 : 0], index * size);
  const marker = 4 + (channels === 1 ? 17 : 32);
  result.set(text(kind), marker); put32(result, marker + 4, flags);
  let cursor = marker + 8;
  put32(result, cursor, count); cursor += 4;
  put32(result, cursor, result.length); cursor += 4;
  if (flags & 4) { for (let i = 0; i < 100; i++) result[cursor + i] = i * 2; cursor += 100; }
  if (flags & 8) { put32(result, cursor, 0); cursor += 4; }
  const extension = cursor;
  result.set(text(encoder), extension);
  result[extension + 21] = delay >> 4;
  result[extension + 22] = ((delay & 15) << 4) | (padding >> 8);
  result[extension + 23] = padding & 255;
  put32(result, extension + 28, result.length);
  return { bytes: result, marker, extension, size };
}
const expectRefusal = (bytes, reason) => assert.deepEqual(parseAudioShareMp3Envelope(bytes), { ok: false, reason });

test("enumerates exact physical frames and independent gapless sample facts", () => {
  const { bytes, size } = fixture();
  const result = parseAudioShareMp3Envelope(bytes);
  assert.deepEqual(result, { ok: true, sampleRate: 44100, channels: 2,
    frames: Array.from({ length: 4 }, (_, index) => ({ offset: index * size, length: size })),
    firstAudioFrame: 1, encodedSamples: 3456, encoderDelay: 576, encoderPadding: 1008, outputSamples: 1872 });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.frames) && result.frames.every(Object.isFrozen));
});
for (const rate of [32000, 44100, 48000]) for (const channels of [1, 2]) {
  test(`supports ${rate} Hz and ${channels} channels within the explicit envelope`, () => {
    const result = parseAudioShareMp3Envelope(fixture({ rate, channels, kind: "Xing" }).bytes);
    assert.equal(result.ok, true); assert.equal(result.sampleRate, rate); assert.equal(result.channels, channels);
  });
}
for (const flags of [3, 7, 11, 15]) {
  test(`accounts for optional Xing fields for flags ${flags}`, () => {
    assert.equal(parseAudioShareMp3Envelope(fixture({ flags }).bytes).ok, true);
  });
}
for (const encoder of ["Lavc62.28", "Lavf62.12", "Lavf", "LAME3.100", "LAME3.99r"]) {
  test(`supports a known LAME-layout encoder representation ${encoder}`, () => {
    assert.equal(parseAudioShareMp3Envelope(fixture({ encoder }).bytes).ok, true);
  });
}
test("stereo and joint stereo can alternate without changing the PCM channel count", () => {
  const { bytes, size } = fixture(); bytes[size + 3] = 0x40;
  assert.equal(parseAudioShareMp3Envelope(bytes).ok, true);
});
test("frame padding and bitrate variation retain exact physical framing", () => {
  const { bytes, marker, extension, size } = fixture();
  const padded = join(bytes.subarray(0, size * 2), new Uint8Array(1), bytes.subarray(size * 2));
  padded[size + 2] |= 2; put32(padded, marker + 12, padded.length); put32(padded, extension + 28, padded.length);
  const result = parseAudioShareMp3Envelope(padded);
  assert.equal(result.ok, true); assert.deepEqual(result.frames.map(frame => frame.length), [size, size + 1, size, size]);
  const longerLength = Math.floor(144000 * 160 / 44100), longer = new Uint8Array(longerLength);
  longer.set([255, 251, 0xa0, 0]);
  const varied = join(bytes.subarray(0, size), longer, bytes.subarray(size * 2));
  put32(varied, marker + 12, varied.length); put32(varied, extension + 28, varied.length);
  assert.deepEqual(parseAudioShareMp3Envelope(varied).frames.map(frame => frame.length), [size, longerLength, size, size]);
});
for (const version of [3, 4]) {
  test(`excludes bounded ID3v2.${version} metadata and padding from every physical audio frame`, () => {
    const tag = id3(undefined, { version, padding: 11 }), { bytes } = fixture();
    const joined = join(tag, bytes), before = joined.slice();
    const result = parseAudioShareMp3Envelope(joined);
    assert.equal(result.ok, true); assert.equal(result.frames[0].offset, tag.length);
    assert.equal(result.outputSamples, 1872); assert.deepEqual(joined, before);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  });
}
test("ID3 arbitrary supported payload bytes never become returned facts", () => {
  const payload = Uint8Array.from({ length: 256 }, (_, index) => index), { bytes } = fixture();
  for (const id of ["APIC", "COMM", "GEOB", "PRIV", "TXXX", "WXXX"]) {
    const tag = id3(payload, { id }), result = parseAudioShareMp3Envelope(join(tag, bytes));
    assert.equal(result.ok, true); assert.equal(result.frames[0].offset, tag.length);
  }
});
test("exact twenty-second outputs pass and one-sample overshoot refuses", () => {
  for (const rate of [32000, 44100, 48000]) {
    const count = Math.ceil((20 * rate + 576 + 529) / 1152), padding = count * 1152 - 576 - 20 * rate;
    assert.equal(parseAudioShareMp3Envelope(fixture({ rate, count, padding }).bytes).outputSamples, rate * 20);
    expectRefusal(fixture({ rate, count, padding: padding - 1 }).bytes, "duration_limit");
  }
});
test("whole-frame truncation cannot be concealed by a valid last frame boundary", () => {
  const { bytes, size } = fixture(); expectRefusal(bytes.slice(0, -size), "inconsistent_stream");
});
test("extra whole frames cannot follow the declared gapless end", () => {
  const { bytes, size } = fixture(); expectRefusal(join(bytes, bytes.subarray(size, size * 2)), "inconsistent_stream");
});
test("truncated frame and trailing bytes are refused without resynchronization", () => {
  const { bytes } = fixture();
  expectRefusal(bytes.slice(0, -1), "invalid_frame");
  expectRefusal(join(bytes, new Uint8Array([0])), "invalid_frame");
  expectRefusal(join(new Uint8Array([0]), bytes), "unsupported_format");
});
test("declared count, Xing byte count and duplicate extension byte count must all agree", () => {
  for (const field of ["count", "xingBytes", "extensionBytes"]) {
    const { bytes, marker, extension } = fixture();
    const offset = field === "count" ? marker + 8 : field === "xingBytes" ? marker + 12 : extension + 28;
    put32(bytes, offset, field === "count" ? 2 : bytes.length - 1); expectRefusal(bytes, "inconsistent_stream");
  }
});
test("zero output and decoder-padding underflow are refused", () => {
  expectRefusal(fixture({ count: 1, delay: 576, padding: 576 }).bytes, "invalid_gapless");
  expectRefusal(fixture({ padding: 528 }).bytes, "invalid_gapless");
});
test("physical frame count is bounded independently of declared delay and padding", () => {
  expectRefusal(fixture({ rate: 32000, count: 563, delay: 4095, padding: 4095 }).bytes, "duration_limit");
});
test("full valid gapless padding can span more than the usual encoder frames", () => {
  const exact = fixture({ rate: 48000, count: 837, delay: 576, padding: 3648 });
  const result = parseAudioShareMp3Envelope(exact.bytes);
  assert.equal(result.ok, true); assert.equal(result.frames.length, 838); assert.equal(result.outputSamples, 960000);
  expectRefusal(fixture({ rate: 48000, count: 837, delay: 576, padding: 3647 }).bytes, "duration_limit");
});
test("one output sample and the minimum final decoder padding are supported", () => {
  const result = parseAudioShareMp3Envelope(fixture({ count: 1, delay: 622, padding: 529 }).bytes);
  assert.equal(result.ok, true); assert.equal(result.outputSamples, 1);
  const multipleFrames = parseAudioShareMp3Envelope(fixture({ count: 5, delay: 4095, padding: 529 }).bytes);
  assert.equal(multipleFrames.ok, true); assert.equal(multipleFrames.outputSamples, 1136);
});
test("unrecognized, truncated and nonzero-sideinfo gapless envelopes refuse", () => {
  const noMarker = fixture(); noMarker.bytes.fill(0, noMarker.marker, noMarker.marker + 4); expectRefusal(noMarker.bytes, "missing_gapless");
  const side = fixture(); side.bytes[4] = 1; expectRefusal(side.bytes, "missing_gapless");
  const unknown = fixture({ encoder: "UNKNOWN12" }); expectRefusal(unknown.bytes, "invalid_gapless");
  const revision = fixture(); revision.bytes[revision.extension + 9] = 0x10; expectRefusal(revision.bytes, "invalid_gapless");
  const residue = fixture(); residue.bytes[residue.size - 1] = 1; expectRefusal(residue.bytes, "invalid_gapless");
});
test("unknown flags, missing required counts and inconsistent seek tables refuse", () => {
  for (const flags of [0, 1, 2, 19, 0xffffffff]) {
    const { bytes, marker } = fixture(); put32(bytes, marker + 4, flags); expectRefusal(bytes, "invalid_gapless");
  }
  const toc = fixture(); toc.bytes[toc.marker + 16 + 20] = 1; expectRefusal(toc.bytes, "invalid_gapless");
  const quality = fixture(); put32(quality.bytes, quality.extension - 4, 101); expectRefusal(quality.bytes, "invalid_gapless");
});
test("unsupported MPEG families, CRC, free format, clock, dual channel and emphasis refuse", () => {
  for (const [offset, value] of [[1, 0xf3], [1, 0xfb & ~1], [1, 0xfd], [2, 0], [2, 0xf0], [2, 0x9c], [3, 0x80], [3, 1], [3, 2], [3, 3]]) {
    const { bytes } = fixture(); bytes[offset] = value; expectRefusal(bytes, "unsupported_format");
  }
});
test("midstream mono or clock changes fail before decoder invocation", () => {
  const mono = fixture(); mono.bytes[mono.size + 3] = 0xc0; expectRefusal(mono.bytes, "inconsistent_stream");
  const clock = fixture(); clock.bytes[clock.size + 2] |= 4; expectRefusal(clock.bytes, "inconsistent_stream");
});
test("ID3 flags, unknown frames, malformed boundaries and nonzero padding refuse", () => {
  const { bytes } = fixture();
  for (const tag of [id3(undefined, { version: 2 }), id3(undefined, { id: "ZZZZ" }), id3(undefined, { flags: 1 })]) {
    expectRefusal(join(tag, bytes), "unsupported_metadata");
  }
  const versionFlags = id3(); versionFlags[5] = 128; expectRefusal(join(versionFlags, bytes), "unsupported_metadata");
  const badSync = id3(); badSync[6] = 128; expectRefusal(join(badSync, bytes), "invalid_metadata");
  const badFrame = id3(); putSync(badFrame, 14, badFrame.length); expectRefusal(join(badFrame, bytes), "invalid_metadata");
  const badPadding = id3(undefined, { padding: 3 }); badPadding[badPadding.length - 1] = 1; expectRefusal(join(badPadding, bytes), "invalid_metadata");
  expectRefusal(join(text("ID3"), new Uint8Array(2)), "invalid_metadata");
});
test("ID3 size and frame count limits bound metadata work", () => {
  const { bytes } = fixture();
  expectRefusal(join(id3(new Uint8Array(AUDIO_SHARE_MP3_ENVELOPE_LIMITS.id3Bytes)), bytes), "invalid_metadata");
  const frame = id3(text("x")).subarray(10), tag = join(id3(new Uint8Array(1)).subarray(0, 10), ...Array(257).fill(frame));
  putSync(tag, 6, tag.length - 10); expectRefusal(join(tag, bytes), "invalid_metadata");
});
test("input kind and memory bounds refuse without invoking own buffer or length getters", () => {
  const { bytes } = fixture(); let accesses = 0;
  Object.defineProperty(bytes, "byteLength", { get() { accesses++; throw Error("unexpected"); } });
  Object.defineProperty(bytes, "buffer", { get() { accesses++; throw Error("unexpected"); } });
  assert.equal(parseAudioShareMp3Envelope(bytes).ok, true); assert.equal(accesses, 0);
  const detached = new Uint8Array(8); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  class Child extends Uint8Array {}
  for (const value of [null, {}, [], new Uint16Array(10), new Child(10), new Proxy(bytes, {}), detached,
    new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(), new Uint8Array(AUDIO_SHARE_MP3_ENVELOPE_LIMITS.bytes + 1)]) {
    expectRefusal(value, "invalid_bytes");
  }
});
test("an exact subarray excludes unrelated surrounding storage", () => {
  const { bytes } = fixture(), surrounded = join(text("PRIVATE_PREFIX"), bytes, text("PRIVATE_SUFFIX"));
  const result = parseAudioShareMp3Envelope(surrounded.subarray(14, 14 + bytes.length));
  assert.equal(result.ok, true); assert.equal(result.frames[0].offset, 0);
});
test("compressed ancillary markers may parse: only the decoder projection can prove exclusion", () => {
  const { bytes, size } = fixture(); bytes.set(text("SYNTHETIC_PRIVATE_IGNORED_PAYLOAD"), size + 60);
  assert.equal(parseAudioShareMp3Envelope(bytes).ok, true);
});
