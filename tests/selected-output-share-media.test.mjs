import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseSelectedOutputShareMediaSelection as parse, attachSelectedOutputShareMedia as attach,
  copySelectedOutputShareMediaBytes as copy } from "../src/model/selected-output-share-media.ts";
import { qualifySelectedOutputShareAudio as audio, SELECTED_OUTPUT_SHARE_AUDIO_POLICY as audioPolicy } from "../src/model/selected-output-share-audio.ts";
import { qualifySelectedOutputShareVideo as video, qualifySelectedOutputShareVideoWithX264Declaration as encoderVideo,
  SELECTED_OUTPUT_SHARE_VIDEO_POLICY as videoPolicy, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY as encoderPolicy } from "../src/model/selected-output-share-video.ts";
import { qualifySelectedOutputShareModel3d as model3d, qualifySelectedOutputShareTexturedModel3d as texturedModel3d,
  SELECTED_OUTPUT_SHARE_MODEL3D_POLICY as modelPolicy, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY as texturePolicy } from "../src/model/selected-output-share-model3d.ts";
import { wav, mp3, png, join, utf8 } from "./output-asset-fixtures.mjs";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const facts = bytes => ({ sha256: digest(bytes), byteLength: bytes.length });
const selected = (output, policy, sha256) => ({ output, policy, documentId: "private-document", artifactId: "private-artifact",
  revision: 2, contentSha256: "a".repeat(64), mediaSha256: sha256 });
// Retained test-only cleanVideo fixture from the Video gate's existing two-picture
// black donor. Derived once without executing its suite. Production never transforms bytes.
const videoFixture = () => new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK7bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABam1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASpzdGJsAAAAqnN0c2QAAAAAAAAAAQAAAJphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABMAAAAMAAAAFHN0Y28AAAAAAAAAAQAAAusAAAAIZnJlZQAAACdtZGF0AAAAD2WIhAAU//73x0/ApurcJwAAAAhBmiFsQS/+4A==", "base64"));
const encoderFixture = () => new Uint8Array(Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK7bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABam1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASpzdGJsAAAAqnN0c2QAAAAAAAAAAQAAAJphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAwwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAAusAAAAIZnJlZQAAAyBtZGF0AAAC9QYF///x3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2MyByMzA2MCA1ZGI2YWE2IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTEgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9MiBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0yIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MSBrZXlpbnQ9MjUwIGtleWludF9taW49MjQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD0xMCByYz1hYnIgbWJ0cmVlPTEgYml0cmF0ZT0xMTQ5IHJhdGV0b2w9MS4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCB2YnZfbWF4cmF0ZT0xNzI0IHZidl9idWZzaXplPTIyOTkgbmFsX2hyZD1ub25lIGZpbGxlcj0wIGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEABT//vfHT8Cm6twnAAAACEGaIWxBL/7g", "base64"));
function glb(textured = false) {
  const model = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: 36 }], bufferViews: [], accessors: [] };
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
  if (textured) {
    add([0, 0, 1, 0, 0, 1, 0, 0, 1], "VEC3", 3); add([0, 0, 1, 0, 0, 1], "VEC2", 2);
    model.meshes[0].primitives[0].attributes.NORMAL = 1; model.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
    model.meshes[0].primitives[0].material = 0;
    model.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    model.textures = [{ source: 0 }]; model.images = [{ bufferView: append(png()), mimeType: "image/png" }];
  }
  const bin = join(...parts); model.buffers[0].byteLength = bin.length;
  const json = utf8(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(bin.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength); return bytes;
}
const profiles = [
  ["audio", audioPolicy, () => wav(), bytes => audio(bytes, { ...facts(bytes), mimeType: "audio/wav" })],
  ["video", videoPolicy, videoFixture, bytes => video(bytes, { ...facts(bytes), width: 16, height: 16, durationSeconds: 1 })],
  ["video", encoderPolicy, encoderFixture, bytes => encoderVideo(bytes, { ...facts(bytes), width: 16, height: 16, durationSeconds: 1 })],
  ["model3d", modelPolicy, () => glb(), bytes => model3d(bytes, facts(bytes))],
  ["model3d", texturePolicy, () => glb(true), bytes => texturedModel3d(bytes, facts(bytes))],
];
const qualified = await Promise.all(profiles.map(async ([output, policy, fixture, qualify]) => {
  const bytes = fixture(), proof = await qualify(bytes); assert.equal(proof.status, "qualified", JSON.stringify(proof));
  return { output, policy, bytes, proof, selection: selected(output, policy, digest(bytes)) };
}));
for (const value of qualified) {
  test(`actual opaque ${value.policy} qualification yields one exact private attachment`, () => {
    const result = attach(value.selection, value.proof); assert.ok(result); assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.selection)); assert.ok(Object.isFrozen(result.descriptor));
    assert.deepEqual({ ...result.selection }, value.selection); assert.equal(result.descriptor.kind, value.output);
    assert.equal(result.descriptor.sha256, digest(value.bytes)); assert.equal(result.descriptor.byteLength, value.bytes.length);
    assert.deepEqual(copy(result), value.bytes);
  });
  test(`${value.policy} descriptor contains only fixed recipient fields`, () => {
    const result = attach(value.selection, value.proof), fields = Object.keys(result.descriptor).sort();
    const common = ["kind", "mimeType", "sha256", "byteLength"];
    const additional = value.output === "audio" ? ["sampleRate", "channels", "sampleCount", "durationSeconds", "durationBasis"]
      : value.output === "video" ? ["width", "height", "durationSeconds"] : [];
    assert.deepEqual(fields, [...common, ...additional].sort());
    const serialized = JSON.stringify(result.descriptor);
    for (const privateValue of [value.selection.documentId, value.selection.artifactId, value.selection.contentSha256,
      "/api/", "inputRef", "owner", "source", "fileName", "http", "policy"]) assert.equal(serialized.includes(privateValue), false);
  });
  test(`${value.policy} byte/identity copies cannot mutate their source attachment`, () => {
    const selection = { ...value.selection }, result = attach(selection, value.proof); selection.documentId = "changed"; selection.mediaSha256 = "0".repeat(64);
    assert.equal(result.selection.documentId, value.selection.documentId); assert.equal(result.selection.mediaSha256, digest(value.bytes));
    const first = copy(result); first.fill(0); assert.deepEqual(copy(result), value.bytes);
    const another = attach(value.selection, value.proof); assert.deepEqual(copy(another), value.bytes);
  });
  test(`${value.policy} rejects serialized, forged and proxied qualifications`, () => {
    for (const candidate of [{ ...value.proof }, JSON.parse(JSON.stringify(value.proof)), new Proxy(value.proof, {}), Object.create(value.proof), {}, null, 1])
      assert.equal(attach(value.selection, candidate), null);
  });
  test(`${value.policy} attachment cannot be recovered from serialized facts`, () => {
    const result = attach(value.selection, value.proof);
    for (const candidate of [{ ...result }, JSON.parse(JSON.stringify(result)), new Proxy(result, {}), Object.create(result), {}, null, 1]) assert.equal(copy(candidate), null);
  });
  test(`${value.policy} binds exactly the selected media hash`, () => {
    assert.equal(attach({ ...value.selection, mediaSha256: "0".repeat(64) }, value.proof), null);
    assert.deepEqual(copy(attach(value.selection, value.proof)), value.bytes, "refusal cannot wipe original gate bytes");
  });
}
test("every cross-kind/profile substitution refuses with no broader fallback", () => {
  for (const selectedProfile of qualified) for (const different of qualified) {
    if (selectedProfile.policy === different.policy) continue;
    const selection = { ...selectedProfile.selection, mediaSha256: different.proof.sha256 };
    assert.equal(attach(selection, different.proof), null);
  }
});
test("unknown, mismatched and broader future policy declarations refuse", () => {
  const input = qualified[0];
  for (const patch of [{ output: "image" }, { output: "storyboard" }, { policy: "selected-output-share-audio-v2" },
    { policy: "selected-output-share-png-resolution-v1" }, { output: "video" }, { policy: encoderPolicy }]) {
    assert.equal(parse({ ...input.selection, ...patch }), null); assert.equal(attach({ ...input.selection, ...patch }, input.proof), null);
  }
});
test("expected selection is closed data and invokes no accessor or toJSON", () => {
  const input = qualified[0]; let calls = 0;
  const accessor = { ...input.selection }; Object.defineProperty(accessor, "documentId", { get() { calls++; return "private-document"; } });
  for (const selection of [accessor, { ...input.selection, owner: "private-owner" }, { ...input.selection, url: "/api/media/private" },
    { ...input.selection, toJSON() { calls++; return input.selection; } }, Object.create(input.selection),
    Object.assign({}, input.selection, { [Symbol("secret")]: true })]) assert.equal(attach(selection, input.proof), null);
  assert.equal(calls, 0);
  const result = attach(Object.assign(Object.create(null), input.selection), input.proof); assert.ok(result);
});
test("malformed exact identity fields refuse before inspecting qualification fields", () => {
  const input = qualified[0]; let calls = 0;
  const proof = new Proxy({}, { get() { calls++; throw Error("Unexpected read"); } });
  for (const patch of [{ documentId: "" }, { artifactId: "../private" }, { revision: -1 }, { revision: .5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { contentSha256: "ABC" }, { mediaSha256: "0".repeat(63) }]) {
    assert.equal(attach({ ...input.selection, ...patch }, proof), null);
  }
  assert.equal(calls, 0);
});
test("a well-formed declared identity remains data rather than a custody assertion", () => {
  const input = qualified[0], selection = { ...input.selection, documentId: "declared-only-document", artifactId: "declared-only-artifact", revision: 9 };
  const result = attach(selection, input.proof); assert.ok(result); assert.equal(result.selection.documentId, "declared-only-document");
  assert.deepEqual(Object.keys(result).sort(), ["descriptor", "selection"]);
  assert.equal(Object.hasOwn(result, "authorized"), false); assert.equal(Object.hasOwn(result, "custody"), false);
});
test("unqualified MP3 result cannot become a WAV attachment", async () => {
  const bytes = mp3(), unqualified = await audio(bytes, { ...facts(bytes), mimeType: "audio/mpeg" });
  assert.equal(unqualified.status, "unqualified"); assert.equal(attach(selected("audio", audioPolicy, digest(bytes)), unqualified), null);
});
