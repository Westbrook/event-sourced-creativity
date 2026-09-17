import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseSelectedOutputShareMediaRequestSelection as parse, selectedOutputShareNativeMediaSelection as nativeSelection,
  parseSelectedOutputShareAnySelection as anySelection, selectedOutputShareMediaDefaultTitle as defaultTitle,
  projectSelectedOutputShareMediaCandidate as project, validateSelectedOutputShareMediaPublicOutput as validate,
  validateSelectedOutputShareAnyPublicOutput as anyPublic, parseSelectedOutputShareMediaApproval as approve,
  parseSelectedOutputShareAnyApproval as anyApproval, SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY as projectionPolicy,
  parseSelectedOutputShareSelection as oldParse, projectSelectedOutputShareCandidate as oldProject,
  validateSelectedOutputSharePublicOutput as oldPublic, parseSelectedOutputShareApproval as oldApproval,
  selectedOutputShareDefaultTitle as oldTitle, SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS as maxLifetime } from "../src/model/selected-output-share.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY as audioPolicy } from "../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_POLICY as videoPolicy, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY as encoderPolicy } from "../src/model/selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_POLICY as modelPolicy, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY as texturePolicy } from "../src/model/selected-output-share-model3d.ts";
const NOW = Date.parse("2030-01-01T00:00:00.000Z"), DAY = 86_400_000, iso = time => new Date(time).toISOString();
const mediaHash = "b".repeat(64), contentHash = "a".repeat(64), hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const profiles = [["audio", audioPolicy], ["video", videoPolicy], ["video", encoderPolicy], ["model3d", modelPolicy], ["model3d", texturePolicy]];
const selected = (output = "audio", policy = audioPolicy) => ({ output, documentId: "private-document", artifactId: "private-artifact",
  revision: 2, contentSha256: contentHash, mediaSha256: mediaHash, policy, projectionPolicy });
// Deliberately declared data only. These records establish neither byte
// qualification nor canonical custody. The server has separate opaque proofs.
const descriptor = output => ({ kind: output, mimeType: output === "audio" ? "audio/wav" : output === "video" ? "video/mp4" : "model/gltf-binary",
  sha256: mediaHash, byteLength: output === "audio" ? 8044 : output === "video" ? 782 : 408,
  ...(output === "audio" ? { sampleRate: 8000, channels: 1, sampleCount: 4000, durationSeconds: 0.5, durationBasis: "pcm-samples" }
    : output === "video" ? { width: 16, height: 16, durationSeconds: 1 } : {}) });
const data = (output = "audio", policy = audioPolicy) => ({ descriptor: descriptor(output), sourceExpiresAt: iso(NOW + 10 * DAY),
  disclosure: output === "audio" ? { watermark: "synthid-declared" } : output === "video" ? { encoderDeclaration: policy === encoderPolicy ? "x264-163-r3060" : null } : {} });
const review = () => ({ title: "Reviewed public title", expiresAt: iso(NOW + DAY) });
const approval = candidate => ({ purpose: "selected-output-read-v1", candidateSha256: candidate.candidateSha256, allowPublicRead: true });
const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
const frozen = value => { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } };

for (const [output, policy] of profiles) {
  test(`${policy}: explicit requested projection remains closed and native selection has exactly seven fields`, () => {
    const source = selected(output, policy), parsed = parse(source), native = nativeSelection(source);
    assert.deepEqual(parsed, source); assert.notEqual(parsed, source); frozen(parsed);
    const { projectionPolicy: _projection, ...seven } = source; assert.deepEqual({ ...native }, seven);
    assert.equal(Object.keys(native).length, 7); assert.ok(Buffer.byteLength(JSON.stringify(parsed)) <= 1024);
    assert.deepEqual(anySelection(source), parsed); assert.equal(oldParse(source), null);
  });
  test(`${policy}: candidate binds distinct source/public identities and exact reviewed public data`, async () => {
    const input = data(output, policy), request = selected(output, policy), choices = review();
    const candidate = await project(request, input, choices, NOW); assert.ok(candidate); frozen(candidate);
    assert.deepEqual(candidate.selection, request); assert.equal(candidate.sourceExpiresAt, input.sourceExpiresAt);
    assert.deepEqual(candidate.mediaIdentity, { sourceMediaSha256: mediaHash, publicMediaSha256: mediaHash,
      qualificationPolicy: policy, projectionPolicy });
    assert.deepEqual(candidate.publicOutput, { schemaVersion: 1, kind: "selected-output-read", output,
      title: choices.title, expiresAt: choices.expiresAt, attribution: "Forma", content: { media: input.descriptor, disclosure: input.disclosure } });
    const { candidateSha256, ...preimage } = candidate; assert.equal(candidateSha256, hash(preimage));
    assert.deepEqual(validate(candidate.publicOutput, NOW), candidate.publicOutput); assert.deepEqual(anyPublic(candidate.publicOutput, NOW), candidate.publicOutput);
    assert.equal(oldPublic(candidate.publicOutput, NOW), null); assert.equal(oldApproval(approval(candidate), candidate), null);
    assert.deepEqual(approve(approval(candidate), candidate), approval(candidate)); assert.deepEqual(anyApproval(approval(candidate), candidate), approval(candidate));
    assert.equal(await oldProject(request, input, choices, NOW), null);
    const publicJson = JSON.stringify(candidate.publicOutput);
    for (const secret of ["private-document", "private-artifact", contentHash, "projectionPolicy", "qualificationPolicy", "sourceExpiresAt", "candidateSha256", "inputRef", "fileName", "/api/", "prompt", "provider", "sourceMediaSha256"])
      assert.equal(publicJson.includes(secret), false, secret);
  });
  test(`${policy}: property order does not alter canonical projection or hash`, async () => {
    assert.deepEqual(await project(reverse(selected(output, policy)), reverse(data(output, policy)), reverse(review()), NOW),
      await project(selected(output, policy), data(output, policy), review(), NOW));
  });
  test(`${policy}: all inputs are captured before hashing and output is deeply immutable`, async () => {
    const request = selected(output, policy), input = data(output, policy), choices = review(), expected = await project(request, input, choices, NOW);
    const pending = project(request, input, choices, NOW);
    request.documentId = "changed"; request.mediaSha256 = "c".repeat(64); input.descriptor.sha256 = "d".repeat(64);
    input.sourceExpiresAt = iso(NOW); input.disclosure = { leak: "private" }; choices.title = "Changed title";
    const candidate = await pending; assert.deepEqual(candidate, expected); frozen(candidate);
    assert.throws(() => { candidate.publicOutput.content.media.sha256 = "0".repeat(64); }, TypeError);
  });
  test(`${policy}: each private identity or reviewed field participates in the digest`, async () => {
    const base = await project(selected(output, policy), data(output, policy), review(), NOW);
    for (const [requestChange, dataChange, reviewChange] of [
      [{ documentId: "another-document" }, {}, {}], [{ artifactId: "another-artifact" }, {}, {}], [{ revision: 3 }, {}, {}],
      [{ contentSha256: "c".repeat(64) }, {}, {}], [{ mediaSha256: "c".repeat(64) }, { descriptor: { ...descriptor(output), sha256: "c".repeat(64) } }, {}],
      [{}, { sourceExpiresAt: iso(NOW + 9 * DAY) }, {}], [{}, {}, { title: "Another reviewed title" }], [{}, {}, { expiresAt: iso(NOW + 2 * DAY) }],
    ]) {
      const candidate = await project({ ...selected(output, policy), ...requestChange }, { ...data(output, policy), ...dataChange }, { ...review(), ...reviewChange }, NOW);
      assert.ok(candidate); assert.notEqual(candidate.candidateSha256, base.candidateSha256);
    }
  });
  test(`${policy}: source/public hash differences and unsupported projection policies refuse`, async () => {
    assert.equal(await project(selected(output, policy), { ...data(output, policy), descriptor: { ...descriptor(output), sha256: "e".repeat(64) } }, review(), NOW), null);
    for (const projection of [undefined, null, "selected-output-share-glb-current-view-v1", "exact-bytes", ""]) {
      const input = { ...selected(output, policy), projectionPolicy: projection };
      if (projection === undefined) delete input.projectionPolicy;
      assert.equal(parse(input), null); assert.equal(nativeSelection(input), null); assert.equal(await project(input, data(output, policy), review(), NOW), null);
    }
  });
}

test("functional media default titles do not broaden old text defaults", () => {
  for (const [output, title] of [["audio", "Audio"], ["video", "Video"], ["model3d", "3D"]]) {
    assert.equal(defaultTitle(output), title); assert.throws(() => oldTitle(output), TypeError);
  }
  assert.throws(() => defaultTitle("image"), TypeError);
});
test("all cross-kind policy substitutions and unknown profiles refuse", async () => {
  for (const [output, policy] of profiles) for (const [other, otherPolicy] of profiles) {
    if (output === other) continue;
    const input = { ...selected(output, policy), policy: otherPolicy };
    assert.equal(parse(input), null); assert.equal(await project(input, data(output, policy), review(), NOW), null);
  }
  for (const policy of ["", "image-png-v1", "selected-output-share-glb-current-view-v1", "mp3", 1, null]) assert.equal(parse({ ...selected(), policy }), null);
});
test("selection fields are noncoercing, closed, bounded and capture no accessors", () => {
  const controls = [["documentId", ""], ["documentId", "a".repeat(161)], ["artifactId", "x/y"], ["revision", -1], ["revision", 0.5],
    ["revision", "2"], ["revision", NaN], ["revision", Number.MAX_SAFE_INTEGER + 1], ["contentSha256", "A".repeat(64)], ["mediaSha256", "x"]];
  for (const [name, value] of controls) assert.equal(parse({ ...selected(), [name]: value }), null);
  let getters = 0;
  for (const name of Object.keys(selected())) {
    const input = selected(); Object.defineProperty(input, name, { enumerable: true, get() { getters++; return selected()[name]; } });
    assert.equal(parse(input), null); assert.equal(nativeSelection(input), null);
  }
  for (const input of [{ ...selected(), extra: true }, Object.create(selected()), new Proxy(selected(), { ownKeys() { throw new Error("hostile"); } })]) assert.equal(parse(input), null);
  const hidden = selected(); Object.defineProperty(hidden, "private", { value: "secret" }); assert.equal(parse(hidden), null);
  const symbol = selected(); symbol[Symbol("private")] = true; assert.equal(parse(symbol), null); assert.equal(getters, 0);
});
test("candidate data refuses private metadata, binary buffers, getters and serializers without executing them", async () => {
  let executions = 0;
  const getter = data(); Object.defineProperty(getter, "descriptor", { enumerable: true, get() { executions++; return descriptor("audio"); } });
  const nested = data(); Object.defineProperty(nested.descriptor, "sha256", { enumerable: true, get() { executions++; return mediaHash; } });
  const disclosure = data(); Object.defineProperty(disclosure.disclosure, "watermark", { enumerable: true, get() { executions++; return "synthid-declared"; } });
  const serializer = { ...data(), toJSON() { executions++; return data(); } };
  for (const input of [getter, nested, disclosure, serializer, { ...data(), source: "private" }, { ...data(), bytes: new Uint8Array(24_000_000) },
    { ...data(), descriptor: new Uint8Array(24_000_000) }, { ...data(), descriptor: { ...descriptor("audio"), url: "/api/media/private" } },
    { ...data(), disclosure: { watermark: "synthid-declared", provider: "private" } }]) {
    assert.equal(await project(selected(), input, review(), NOW), null);
  }
  assert.equal(executions, 0);
});
test("recipient parser refuses accessors and every extra public field at each nesting level", async () => {
  const candidate = await project(selected(), data(), review(), NOW), publicOutput = candidate.publicOutput; let executions = 0;
  for (const path of [[], ["content"], ["content", "media"], ["content", "disclosure"]]) {
    const malformed = structuredClone(publicOutput); let at = malformed; for (const key of path) at = at[key]; at.private = "private";
    assert.equal(validate(malformed, NOW), null); assert.equal(anyPublic(malformed, NOW), null);
    delete at.private; const name = Object.keys(at)[0]; Object.defineProperty(at, name, { enumerable: true, get() { executions++; return "private"; } });
    assert.equal(validate(malformed, NOW), null);
  }
  assert.equal(executions, 0);
});
for (const [output, mutations] of [
  ["audio", { mimeType: "audio/mpeg", sampleRate: 7999, channels: 9, sampleCount: 0, durationSeconds: 0.49, durationBasis: "estimated", byteLength: 8043 }],
  ["video", { mimeType: "application/mp4", width: 16385, height: 0, durationSeconds: 21601, byteLength: 24_000_001 }],
  ["model3d", { mimeType: "model/obj", byteLength: 67_108_865 }],
]) test(`${output}: descriptor bounds, kind, MIME, clocks and hashes remain strict data`, async () => {
  const policy = profiles.find(entry => entry[0] === output)[1];
  for (const [field, value] of Object.entries({ ...mutations, kind: "image", sha256: "F".repeat(64) }))
    assert.equal(await project(selected(output, policy), { ...data(output, policy), descriptor: { ...descriptor(output), [field]: value } }, review(), NOW), null);
  for (const byteLength of [NaN, Infinity, -1, 0, 1.5, "408", Number.MAX_SAFE_INTEGER + 1])
    assert.equal(await project(selected(output, policy), { ...data(output, policy), descriptor: { ...descriptor(output), byteLength } }, review(), NOW), null);
});
test("Audio does not silently narrow the accepted PCM bit depths, fmt lengths, channels or sample rates", async () => {
  for (const channels of [1, 8]) for (const sampleRate of [8000, 384000]) for (const bytesPerSample of [1, 2, 3, 4]) for (const header of [44, 46]) {
    const sampleCount = 3, dataLength = channels * sampleCount * bytesPerSample;
    const input = data(); Object.assign(input.descriptor, { channels, sampleRate, sampleCount, durationSeconds: sampleCount / sampleRate,
      byteLength: header + dataLength + dataLength % 2 });
    assert.ok(await project(selected(), input, review(), NOW));
  }
});
test("watermark disclosure is explicit declared data and participates in review hash", async () => {
  const declared = await project(selected(), data(), review(), NOW);
  const unspecified = await project(selected(), { ...data(), disclosure: { watermark: "not-declared" } }, review(), NOW);
  assert.ok(unspecified); assert.notEqual(declared.candidateSha256, unspecified.candidateSha256);
  for (const disclosure of [{}, { watermark: null }, { watermark: false }, { watermark: "none" }, { watermark: "verified" }])
    assert.equal(await project(selected(), { ...data(), disclosure }, review(), NOW), null);
});
test("Video encoder declaration is required, exact and bound to the chosen profile", async () => {
  for (const policy of [videoPolicy, encoderPolicy]) for (const encoderDeclaration of [undefined, "x264-165-r3222", false, "", policy === videoPolicy ? "x264-163-r3060" : null])
    assert.equal(await project(selected("video", policy), { ...data("video", policy), disclosure: { encoderDeclaration } }, review(), NOW), null);
  const strict = await project(selected("video", videoPolicy), data("video", videoPolicy), review(), NOW);
  const encoder = await project(selected("video", encoderPolicy), data("video", encoderPolicy), review(), NOW);
  assert.notEqual(strict.candidateSha256, encoder.candidateSha256);
});
test("GLB texture profile remains separately approved although its finite public descriptor has the same shape", async () => {
  const plain = await project(selected("model3d", modelPolicy), data("model3d", modelPolicy), review(), NOW);
  const texture = await project(selected("model3d", texturePolicy), data("model3d", texturePolicy), review(), NOW);
  assert.deepEqual(plain.publicOutput, texture.publicOutput); assert.notEqual(plain.candidateSha256, texture.candidateSha256);
  for (const disclosure of [{ texture: true }, { encoderDeclaration: null }, null, []])
    assert.equal(await project(selected("model3d", modelPolicy), { ...data("model3d", modelPolicy), disclosure }, review(), NOW), null);
});
test("review title and expiry preserve original text review rules with no source clamping", async () => {
  for (const title of ["", " ", "x\n", "a".repeat(513), "é".repeat(257)]) assert.equal(await project(selected(), data(), { ...review(), title }, NOW), null);
  assert.ok(await project(selected(), data(), { ...review(), title: "é".repeat(256) }, NOW));
  for (const expiresAt of [iso(NOW), iso(NOW - 1), iso(NOW + maxLifetime + 1), "2030-02-30T00:00:00.000Z", "2030-01-02T00:00:00Z"])
    assert.equal(await project(selected(), data(), { ...review(), expiresAt }, NOW), null);
  assert.ok(await project(selected(), data(), { ...review(), expiresAt: iso(NOW + maxLifetime) }, NOW));
  const exact = { ...data(), sourceExpiresAt: review().expiresAt }; assert.ok(await project(selected(), exact, review(), NOW));
  assert.equal(await project(selected(), { ...exact, sourceExpiresAt: iso(NOW + DAY - 1) }, review(), NOW), null);
  for (const sourceExpiresAt of [null, "bad", iso(NOW), "2030-01-01T00:00:00Z"]) assert.equal(await project(selected(), { ...data(), sourceExpiresAt }, review(), NOW), null);
  for (const now of [NaN, Infinity, -1, 0.5, "now"]) assert.equal(await project(selected(), data(), review(), now), null);
});
test("approval is an exact deliberate digest shape and never reconstructs authority", async () => {
  const candidate = await project(selected(), data(), review(), NOW), yes = approval(candidate);
  for (const malformed of [{ ...yes, candidateSha256: "c".repeat(64) }, { ...yes, allowPublicRead: false }, { ...yes, allowPublicRead: "true" },
    { ...yes, purpose: "share" }, { ...yes, send: true }]) { assert.equal(approve(malformed, candidate), null); assert.equal(anyApproval(malformed, candidate), null); }
  for (const field of ["sourceMediaSha256", "publicMediaSha256", "qualificationPolicy", "projectionPolicy"]) {
    const forged = structuredClone(candidate); forged.mediaIdentity[field] = "changed";
    assert.equal(approve(yes, forged), null); assert.equal(anyApproval(yes, forged), null);
  }
  const missing = structuredClone(candidate); delete missing.mediaIdentity;
  assert.equal(approve(yes, missing), null); assert.equal(anyApproval(yes, missing), null, "media cannot fall back to weak text approval shape");
  const extra = { ...candidate, bytes: new Uint8Array(1) }; assert.equal(approve(yes, extra), null);
  let executions = 0; const getter = { ...yes }; Object.defineProperty(getter, "candidateSha256", { enumerable: true, get() { executions++; return yes.candidateSha256; } });
  assert.equal(approve(getter, candidate), null); assert.equal(executions, 0);
});
test("legitimate existing text candidate hashing and approval remain unchanged through additive Any dispatch", async () => {
  const request = { output: "short_story", documentId: "story-doc", artifactId: "story-art", revision: 0, contentSha256: contentHash };
  const { output: _output, ...selection } = request;
  const dto = { schemaVersion: 1, kind: "native-retained-short-story", selection, title: "PRIVATE original", contentMarkdown: "Literal public text", expiresAt: data().sourceExpiresAt };
  const candidate = await oldProject(request, dto, review(), NOW); assert.ok(candidate);
  const { candidateSha256, ...preimage } = candidate; assert.equal(candidateSha256, hash(preimage));
  assert.deepEqual(anySelection(request), oldParse(request)); assert.deepEqual(anyPublic(candidate.publicOutput, NOW), oldPublic(candidate.publicOutput, NOW));
  assert.deepEqual(anyApproval(approval(candidate), candidate), oldApproval(approval(candidate), candidate));
  assert.equal(approve(approval(candidate), candidate), null); assert.equal(validate(candidate.publicOutput, NOW), null);
  assert.equal(await project(request, dto, review(), NOW), null);
});
