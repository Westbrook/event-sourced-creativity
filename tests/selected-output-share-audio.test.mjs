import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectOutputAsset } from "../src/model/output-asset-inspection.ts";
import { trimPcmWav } from "../src/model/audio-container.ts";
import { qualifySelectedOutputShareAudio, copySelectedOutputShareAudioBytes, SELECTED_OUTPUT_SHARE_AUDIO_POLICY,
  SELECTED_OUTPUT_SHARE_AUDIO_LIMITS } from "../src/model/selected-output-share-audio.ts";
import { wav, mp3, join, utf8 } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = (bytes, mimeType = "audio/wav") => ({ sha256: digest(bytes), byteLength: bytes.length, mimeType });
const qualify = (bytes, expected = facts(bytes)) => qualifySelectedOutputShareAudio(bytes, expected);
const refused = result => { assert.equal(result.status, "unqualified"); assert.equal(copySelectedOutputShareAudioBytes(result), null); };
function chunk(type, payload, pad = 0) {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2), view = new DataView(bytes.buffer);
  bytes.set(utf8(type)); view.setUint32(4, payload.length, true); bytes.set(payload, 8);
  if (payload.length % 2) bytes[bytes.length - 1] = pad;
  return bytes;
}
function container(...chunks) {
  const bytes = join(utf8("RIFF"), new Uint8Array(4), utf8("WAVE"), ...chunks);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true); return bytes;
}
function pcm({ bits = 16, channels = 1, sampleRate = 8000, samples = 7, extension = false } = {}) {
  const fmt = new Uint8Array(extension ? 18 : 16), view = new DataView(fmt.buffer), size = bits * channels / 8;
  view.setUint16(0, 1, true); view.setUint16(2, channels, true); view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * size, true); view.setUint16(12, size, true); view.setUint16(14, bits, true);
  const data = Uint8Array.from({ length: samples * size }, (_, index) => index * 31 % 256);
  return { fmt, data, bytes: container(chunk("fmt ", fmt), chunk("data", data)) };
}

for (const bits of [8, 16, 24, 32]) for (const channels of [1, 2]) {
  test(`${bits}-bit ${channels}-channel non-silent PCM remains byte identical`, async () => {
    const { bytes } = pcm({ bits, channels }), expected = facts(bytes), result = await qualify(bytes);
    assert.equal(result.status, "qualified"); assert.ok(Object.isFrozen(result));
    assert.deepEqual(result, { status: "qualified", policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, ...expected,
      sampleRate: 8000, channels, sampleCount: 7, durationSeconds: 7 / 8000, durationBasis: "pcm-samples" });
    assert.deepEqual(copySelectedOutputShareAudioBytes(result), bytes);
  });
}
test("existing native original WAV fixture qualifies without a live journey", async () => {
  const bytes = wav(), result = await qualify(bytes);
  assert.equal(result.status, "qualified"); assert.equal(result.durationSeconds, .5);
  assert.deepEqual(copySelectedOutputShareAudioBytes(result), bytes);
});
test("actual native PCM trim output qualifies with its current exact samples and clock", async () => {
  const { bytes } = pcm({ channels: 2, samples: 8 }), before = bytes.slice(), trimmed = trimPcmWav(bytes, 1, 6);
  assert.ok(trimmed?.changed);
  const result = await qualify(trimmed.bytes);
  assert.equal(result.status, "qualified"); assert.equal(result.sampleCount, 5);
  assert.equal(result.channels, 2); assert.deepEqual(copySelectedOutputShareAudioBytes(result), trimmed.bytes);
  assert.deepEqual(bytes, before);
});
test("zero-length PCM extension and zero odd-byte padding are supported", async () => {
  assert.equal((await qualify(pcm({ bits: 8, extension: true }).bytes)).status, "qualified");
});
test("native-supported multichannel and sample clock bounds stay qualified", async () => {
  for (const options of [{ channels: 8 }, { sampleRate: 384000 }, { channels: 3, sampleRate: 44100 }]) {
    const bytes = pcm(options).bytes; assert.equal((await qualify(bytes)).status, "qualified");
  }
});
test("capture before await and fresh copy prevent input, expected, and result mutation", async () => {
  const input = pcm().bytes, original = input.slice(), expected = facts(input), pending = qualify(input, expected);
  input.fill(0); expected.sha256 = "0".repeat(64); expected.mimeType = "audio/mpeg";
  const result = await pending; assert.equal(result.status, "qualified"); assert.equal(result.sha256, digest(original));
  const copy = copySelectedOutputShareAudioBytes(result); assert.deepEqual(copy, original); copy.fill(0);
  assert.deepEqual(copySelectedOutputShareAudioBytes(result), original);
});
test("selected subarray ignores input getters and captures no surrounding bytes", async () => {
  const original = wav(), backing = join(utf8("private-prefix"), original, utf8("private-suffix"));
  const input = backing.subarray(14, 14 + original.length); let calls = 0;
  for (const key of ["buffer", "byteLength", Symbol.iterator]) Object.defineProperty(input, key, { get() { calls++; throw Error("unexpected"); } });
  const result = await qualify(input, facts(original)); assert.equal(result.status, "qualified"); assert.equal(calls, 0);
  assert.deepEqual(copySelectedOutputShareAudioBytes(result), original);
});
test("forged, serialized, copied and proxy qualifications provide no bytes", async () => {
  const result = await qualify(wav()); assert.equal(result.status, "qualified");
  for (const value of [{ ...result }, JSON.parse(JSON.stringify(result)), {}, null, 1, new Proxy(result, {})]) assert.equal(copySelectedOutputShareAudioBytes(value), null);
});
test("closed expected data does not invoke accessors or accept undeclared selection fields", async () => {
  const bytes = wav(); let calls = 0;
  const accessor = facts(bytes); Object.defineProperty(accessor, "sha256", { get() { calls++; return digest(bytes); } });
  for (const expected of [accessor, { ...facts(bytes), owner: "private" }, { ...facts(bytes), sampleRate: 8000 },
    { ...facts(bytes), mimeType: "audio/x-wav" }, { ...facts(bytes), mimeType: "audio/WAV" },
    { ...facts(bytes), sha256: digest(bytes).toUpperCase() }, { ...facts(bytes), byteLength: 0 },
    { ...facts(bytes), byteLength: 1.5 }, Object.create(facts(bytes))]) refused(await qualify(bytes, expected));
  assert.equal(calls, 0);
  assert.equal((await qualify(bytes, Object.assign(Object.create(null), facts(bytes)))).status, "qualified");
});
test("exact expected digest, size and format bind the recording", async () => {
  const bytes = wav();
  for (const patch of [{ sha256: "0".repeat(64) }, { byteLength: bytes.length + 1 }, { mimeType: "audio/mpeg" }]) refused(await qualify(bytes, { ...facts(bytes), ...patch }));
});
test("shared, detached, subclass, proxy, oversized and nonbyte input refuse", async () => {
  const bytes = wav(), detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  class Bytes extends Uint8Array {}
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  for (const input of [shared, detached, new Bytes(bytes), new Proxy(bytes, {}), bytes.buffer, [], null, new Uint8Array(),
    new Uint8Array(SELECTED_OUTPUT_SHARE_AUDIO_LIMITS.bytes + 1)]) refused(await qualifySelectedOutputShareAudio(input, facts(bytes)));
});
for (const type of ["LIST", "bext", "iXML", "axml", "ID3 ", "id3 ", "JUNK", "PAD ", "cue ", "smpl", "fact", "PEAK", "DISP", "cart", "zzzz"]) {
  test(`opaque ${JSON.stringify(type)} chunk is refused even when accepted by the private inspector`, async () => {
    const { fmt, data } = pcm(), bytes = container(chunk("fmt ", fmt), chunk(type, utf8("SYNTHETIC_PRIVATE_PROMPT")), chunk("data", data));
    assert.equal((await inspectOutputAsset(bytes)).status, "inspected");
    const before = bytes.slice(), result = await qualify(bytes); refused(result); assert.equal(result.reason, "unqualified_metadata"); assert.deepEqual(bytes, before);
  });
}
test("nonzero RIFF padding is unqualified data rather than silently discarded", async () => {
  const { fmt, data } = pcm({ bits: 8 }), bytes = container(chunk("fmt ", fmt), chunk("data", data, 65));
  assert.equal((await inspectOutputAsset(bytes)).status, "inspected"); refused(await qualify(bytes));
});
test("IEEE float, compressed/extensible WAV and extra format payload remain unsupported", async () => {
  const { fmt, data } = pcm();
  for (const code of [3, 6, 7, 0xfffe]) { const f = fmt.slice(); new DataView(f.buffer).setUint16(0, code, true); refused(await qualify(container(chunk("fmt ", f), chunk("data", data)))); }
  refused(await qualify(container(chunk("fmt ", join(fmt, Uint8Array.of(2, 0, 55, 66))), chunk("data", data))));
  const extended = join(fmt, Uint8Array.of(1, 0)); refused(await qualify(container(chunk("fmt ", extended), chunk("data", data))));
});
test("duplicate, reordered, missing and extra data/format chunks cannot qualify", async () => {
  const { fmt, data } = pcm(), f = chunk("fmt ", fmt), d = chunk("data", data);
  for (const bytes of [container(d, f), container(f, f, d), container(f, d, d), container(f), container(d), container(f, chunk("data", new Uint8Array()))]) refused(await qualify(bytes));
});
test("native PCM field consistency remains enforced", async () => {
  for (const [offset, value, size] of [[22, 0, 2], [22, 9, 2], [24, 7999, 4], [24, 384001, 4], [28, 1234, 4], [32, 3, 2], [34, 12, 2]]) {
    const bytes = wav(), view = new DataView(bytes.buffer);
    if (size === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
    refused(await qualify(bytes));
  }
});
test("RIFF exact length, chunk overrun, truncation and arbitrary trailers refuse", async () => {
  const overrun = wav(); new DataView(overrun.buffer).setUint32(40, 0xffffffff, true);
  const shortData = wav(); new DataView(shortData.buffer).setUint32(40, shortData.length - 45, true);
  const badRiff = wav(); new DataView(badRiff.buffer).setUint32(4, 44, true);
  for (const bytes of [overrun, shortData, badRiff, wav().slice(0, -1), join(wav(), utf8("private trailer")), new Uint8Array(8)]) refused(await qualify(bytes));
});
test("MP3 remains explicitly unsupported, including clean native and tagged fixtures", async () => {
  for (const bytes of [mp3(), mp3({ id3: true }), join(mp3(), utf8("APETAGEX"))]) refused(await qualify(bytes, facts(bytes, "audio/mpeg")));
});

test("MP3 declared granule allocation cannot hide ignored private payload inside a qualified recording", async () => {
  // Independent review decoded this exact marker fixture and its zeroed variant
  // with FFmpeg to identical 13,824 zero PCM bytes. No decoder is a dependency.
  const marker = utf8("PRIVATE_PROJECT_TITLE=PAYROLL_DEMO"), number = (value, count) => value.toString(2).padStart(count, "0");
  let bits = number(0, 9) + number(0, 3) + number(0, 8);
  for (let granule = 0; granule < 4; granule++) bits += number(granule === 0 ? marker.length * 8 : 0, 12)
    + number(288, 9) + number(210, 8) + number(0, 4) + number(0, 1)
    + number(0, 15) + number(0, 4) + number(0, 3) + number(0, 3);
  assert.equal(bits.length, 256);
  const frame = new Uint8Array(417); frame.set([255, 251, 144, 0]);
  for (let at = 0; at < 32; at++) frame[4 + at] = parseInt(bits.slice(at * 8, at * 8 + 8), 2);
  frame.set(marker, 36);
  const bytes = join(frame, frame, frame);
  assert.equal(digest(bytes), "482e1e384181e45fb26acca8063ecd8463012a7a3df80271b2f44926dd4ed581");
  assert.equal((await inspectOutputAsset(bytes)).status, "inspected");
  const result = await qualify(bytes, facts(bytes, "audio/mpeg")); refused(result); assert.equal(result.reason, "unsupported_audio");
});
