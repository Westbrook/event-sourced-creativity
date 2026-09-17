import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY as policy, qualifySelectedOutputShareAudio,
  copySelectedOutputShareAudioBytes } from "../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE as sourceProfile,
  SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY as projectionPolicy,
  parseSelectedOutputShareStableAudioSelection as parseStable, isSelectedOutputShareStableAudioSelection as isStable,
  selectedOutputShareStableAudioDescriptorMatches as descriptorMatches } from "../src/model/selected-output-share-mp3-contract.ts";
import { parseSelectedOutputShareMediaSelection as parseNative, attachSelectedOutputShareMedia as attach }
  from "../src/model/selected-output-share-media.ts";
import { parseSelectedOutputShareMediaRequestSelection as parseRequest, selectedOutputShareNativeMediaSelection as nativeSelection,
  parseSelectedOutputShareAnySelection as parseAny, projectSelectedOutputShareMediaCandidate as project,
  parseSelectedOutputShareMediaApproval as approve, parseSelectedOutputShareAnyApproval as approveAny,
  validateSelectedOutputShareMediaPublicOutput as parsePublic, SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY as exactProjection }
  from "../src/model/selected-output-share.ts";
import { wav } from "./output-asset-fixtures.mjs";

const NOW = Date.parse("2030-01-01T00:00:00.000Z"), DAY = 86_400_000;
const iso = time => new Date(time).toISOString();
const digest = value => createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value)).digest("hex");
const selected = () => ({ output: "audio", documentId: "private-document", artifactId: "private-artifact", revision: 2,
  contentSha256: "a".repeat(64), mediaSha256: "b".repeat(64), policy, sourceProfile, projectionPolicy });
const descriptor = (sampleRate = 44100, channels = 2) => ({ kind: "audio", mimeType: "audio/wav", sha256: "c".repeat(64),
  byteLength: 44 + sampleRate * 20 * channels * 2, sampleRate, channels, sampleCount: sampleRate * 20,
  durationSeconds: 20, durationBasis: "pcm-samples" });
const data = (media = descriptor()) => ({ descriptor: media, sourceExpiresAt: iso(NOW + 2 * DAY), disclosure: { watermark: "not-declared" } });
const review = () => ({ title: "Audio", expiresAt: iso(NOW + DAY) });
const approval = candidate => ({ purpose: "selected-output-read-v1", candidateSha256: candidate.candidateSha256, allowPublicRead: true });
const reverse = value => value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
const frozen = value => { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } };

test("the derivative is an immutable closed nine-field selection at every model boundary", () => {
  const input = selected();
  for (const parse of [parseStable, parseNative, parseRequest, nativeSelection, parseAny]) {
    const result = parse(input); assert.deepEqual(result, input); assert.notEqual(result, input);
    assert.equal(Object.keys(result).length, 9); frozen(result); assert.ok(isStable(result));
    assert.deepEqual(parse(Object.assign(Object.create(null), input)), result);
    assert.deepEqual(parse(reverse(input)), result);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  }
  const maximum = parseStable({ ...selected(), documentId: "d".repeat(160), artifactId: "a".repeat(160), revision: Number.MAX_SAFE_INTEGER });
  assert.ok(maximum); assert.equal(Buffer.byteLength(JSON.stringify(maximum)), 719);
  input.mediaSha256 = "d".repeat(64); assert.equal(parseStable(selected()).mediaSha256, "b".repeat(64));
});

test("neither incomplete derivative shapes nor a projection/policy substitution falls back to exact bytes", () => {
  const patches = [{ output: "video" }, { output: "model3d" }, { output: "short_story" }, { policy: "selected-output-share-mp3-v1" },
    { policy: "selected-output-share-audio-v2" }, { sourceProfile: "forma.audio.instrumental-20.wav@1" },
    { sourceProfile: null }, { projectionPolicy: exactProjection }, { projectionPolicy: "selected-output-share-stable-mp3-pcm16-v2" },
    { documentId: "" }, { artifactId: "../artifact" }, { revision: -1 }, { revision: 0.1 }, { revision: "2" },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { contentSha256: "A".repeat(64) }, { mediaSha256: "invalid" }];
  for (const patch of patches) for (const parse of [parseStable, parseNative, parseRequest, nativeSelection])
    assert.equal(parse({ ...selected(), ...patch }), null, JSON.stringify(patch));
  for (const key of Object.keys(selected())) {
    const input = selected(); delete input[key];
    for (const parse of [parseStable, parseNative, parseRequest, nativeSelection]) assert.equal(parse(input), null, key);
  }
});

test("selection capture refuses accessors, serializers, hidden keys and inheritance without executing them", () => {
  let calls = 0;
  const malformed = [null, [], 1, { ...selected(), extra: true }, Object.create(selected()),
    { ...selected(), toJSON() { calls++; return selected(); } }, Object.assign(selected(), { [Symbol("private")]: true }),
    new Proxy(selected(), { ownKeys() { throw new Error("hostile"); } })];
  const hidden = selected(); Object.defineProperty(hidden, "private", { value: true }); malformed.push(hidden);
  for (const key of Object.keys(selected())) {
    const getter = selected(); Object.defineProperty(getter, key, { enumerable: true, get() { calls++; return selected()[key]; } }); malformed.push(getter);
    const nonEnumerable = selected(); Object.defineProperty(nonEnumerable, key, { enumerable: false }); malformed.push(nonEnumerable);
  }
  for (const input of malformed) {
    assert.equal(isStable(input), false);
    for (const parse of [parseStable, parseNative, parseRequest, nativeSelection]) assert.equal(parse(input), null);
  }
  assert.equal(calls, 0);
});

for (const sampleRate of [32000, 44100, 48000]) for (const channels of [1, 2])
  test(`${sampleRate} Hz/${channels} channels: exact 20-second PCM16 candidate separates source and public digests`, async () => {
    const input = data(descriptor(sampleRate, channels)), candidate = await project(selected(), input, review(), NOW);
    assert.ok(descriptorMatches(input.descriptor)); assert.ok(candidate); frozen(candidate);
    assert.equal(candidate.publicOutput.content.media.byteLength, 44 + sampleRate * 20 * channels * 2);
    assert.deepEqual(candidate.mediaIdentity, { sourceMediaSha256: selected().mediaSha256, publicMediaSha256: input.descriptor.sha256,
      qualificationPolicy: policy, projectionPolicy });
    assert.notEqual(candidate.mediaIdentity.sourceMediaSha256, candidate.mediaIdentity.publicMediaSha256);
    assert.deepEqual(parsePublic(candidate.publicOutput, NOW), candidate.publicOutput);
    assert.deepEqual(approve(approval(candidate), candidate), approval(candidate));
    assert.deepEqual(approveAny(approval(candidate), candidate), approval(candidate));
    const { candidateSha256, ...preimage } = candidate; assert.equal(candidateSha256, digest(preimage));
    const publicJson = JSON.stringify(candidate.publicOutput);
    for (const privateValue of ["private-document", "private-artifact", selected().contentSha256, selected().mediaSha256,
      "sourceProfile", sourceProfile, "projectionPolicy", projectionPolicy, "qualificationPolicy", "candidateSha256", "sourceExpiresAt"])
      assert.equal(publicJson.includes(privateValue), false, privateValue);
  });

test("candidate capture and canonical hashing ignore property order and later input mutation", async () => {
  const request = selected(), input = data(), choices = review(), expected = await project(request, input, choices, NOW);
  assert.deepEqual(await project(reverse(request), reverse(input), reverse(choices), NOW), expected);
  const pending = project(request, input, choices, NOW);
  request.mediaSha256 = "e".repeat(64); request.sourceProfile = "changed"; input.descriptor.sha256 = "f".repeat(64);
  input.descriptor.byteLength = 0; input.disclosure.watermark = "changed"; choices.title = "changed";
  assert.deepEqual(await pending, expected); frozen(expected);
});

test("source digest, public digest and current source identity each independently bind the candidate", async () => {
  const original = await project(selected(), data(), review(), NOW);
  const changes = [
    [{ ...selected(), mediaSha256: "d".repeat(64) }, data()],
    [selected(), data({ ...descriptor(), sha256: "d".repeat(64) })],
    [{ ...selected(), documentId: "another-document" }, data()],
    [{ ...selected(), artifactId: "another-artifact" }, data()],
    [{ ...selected(), revision: 3 }, data()],
    [{ ...selected(), contentSha256: "d".repeat(64) }, data()],
  ];
  for (const [request, input] of changes) {
    const candidate = await project(request, input, review(), NOW); assert.ok(candidate);
    assert.notEqual(candidate.candidateSha256, original.candidateSha256);
  }
});

test("derivative envelope refuses alternate bit depths, fmt18, duration, rate, channel and container sizes", async () => {
  const baseline = descriptor();
  const alternatives = [
    ...[1, 3, 4].map(bytesPerSample => ({ ...baseline, byteLength: 44 + baseline.sampleCount * baseline.channels * bytesPerSample })),
    { ...baseline, byteLength: baseline.byteLength + 2 },
    { ...baseline, sampleCount: baseline.sampleCount - 1, durationSeconds: 20 - 1 / baseline.sampleRate, byteLength: baseline.byteLength - 4 },
    { ...baseline, sampleCount: baseline.sampleRate * 19, durationSeconds: 19, byteLength: 44 + baseline.sampleRate * 19 * 4 },
    { ...descriptor(48000, 2), byteLength: 3_840_045 },
    descriptor(8000, 1), descriptor(22050, 2), descriptor(96000, 1), descriptor(44100, 3),
    ...Object.entries({ kind: "video", mimeType: "audio/mpeg", sha256: "A".repeat(64), byteLength: NaN,
      sampleRate: "44100", channels: 0, sampleCount: Infinity, durationSeconds: 19.99, durationBasis: "estimated" })
      .map(([key, value]) => ({ ...baseline, [key]: value })),
  ];
  const candidate = await project(selected(), data(), review(), NOW);
  for (const media of alternatives) {
    assert.equal(descriptorMatches(media), false, JSON.stringify(media));
    assert.equal(await project(selected(), data(media), review(), NOW), null);
    const malformed = structuredClone(candidate); malformed.publicOutput.content.media = media;
    assert.equal(approve(approval(candidate), malformed), null);
  }
});

test("the derivative descriptor is closed data and never reads getters or binary payloads", async () => {
  let calls = 0;
  const invalid = [null, [], new Uint8Array(1), Object.create(descriptor()), { ...descriptor(), bytes: new Uint8Array(1) },
    { ...descriptor(), url: "/api/media/private" }, { ...descriptor(), toJSON() { calls++; return descriptor(); } }];
  for (const key of Object.keys(descriptor())) {
    const getter = descriptor(); Object.defineProperty(getter, key, { enumerable: true, get() { calls++; return descriptor()[key]; } }); invalid.push(getter);
    const missing = descriptor(); delete missing[key]; invalid.push(missing);
  }
  for (const media of invalid) {
    assert.equal(descriptorMatches(media), false);
    assert.equal(await project(selected(), data(media), review(), NOW), null);
  }
  assert.equal(calls, 0);
});

test("approval binds the derivative branch and both identities without becoming a publication capability", async () => {
  const candidate = await project(selected(), data(), review(), NOW), yes = approval(candidate);
  for (const [key, value] of Object.entries({ sourceMediaSha256: "d".repeat(64), publicMediaSha256: "e".repeat(64),
    qualificationPolicy: "mp3", projectionPolicy: exactProjection })) {
    const malformed = structuredClone(candidate); malformed.mediaIdentity[key] = value;
    assert.equal(approve(yes, malformed), null); assert.equal(approveAny(yes, malformed), null);
  }
  for (const key of ["sourceProfile", "projectionPolicy", "policy"]) {
    const malformed = structuredClone(candidate); delete malformed.selection[key]; assert.equal(approve(yes, malformed), null);
  }
  assert.equal(approve({ ...yes, bytes: new Uint8Array(1) }, candidate), null);
  assert.equal(approve({ ...yes, allowPublicRead: false }, candidate), null);
  assert.equal(approve({ ...yes, candidateSha256: "d".repeat(64) }, candidate), null);
  assert.deepEqual(Object.keys(approve(yes, candidate)).sort(), ["allowPublicRead", "candidateSha256", "purpose"]);
});

test("derivative review expiry still cannot extend source lifetime or clamp the reviewed choice", async () => {
  const exact = { ...data(), sourceExpiresAt: review().expiresAt };
  assert.ok(await project(selected(), exact, review(), NOW));
  assert.equal(await project(selected(), { ...exact, sourceExpiresAt: iso(NOW + DAY - 1) }, review(), NOW), null);
  assert.equal(await project(selected(), data(), { ...review(), expiresAt: iso(NOW) }, NOW), null);
});

test("the exact-byte factory refuses derivative selections before inspecting a qualification", async () => {
  let reads = 0;
  assert.equal(attach(selected(), new Proxy({}, { get() { reads++; throw new Error("unexpected read"); } })), null);
  assert.equal(reads, 0);
  const bytes = wav(), sha256 = digest(bytes), qualified = await qualifySelectedOutputShareAudio(bytes,
    { sha256, byteLength: bytes.length, mimeType: "audio/wav" });
  assert.equal(qualified.status, "qualified");
  assert.equal(attach({ ...selected(), mediaSha256: sha256 }, qualified), null, "even a matching WAV hash cannot authorize the derivative factory");
  assert.deepEqual(copySelectedOutputShareAudioBytes(qualified), bytes, "refusal must not retire the input qualification");
});

test("existing exact-byte selection and recipient data keep their independent broader PCM envelope", async () => {
  const { sourceProfile: _source, projectionPolicy: _projection, ...seven } = selected();
  assert.equal(isStable(seven), false); assert.deepEqual({ ...parseNative(seven) }, seven);
  const eight = { ...seven, projectionPolicy: exactProjection };
  assert.deepEqual(parseRequest(eight), eight); assert.deepEqual({ ...nativeSelection(eight) }, seven);
  const media = { ...descriptor(96000, 3), sha256: seven.mediaSha256 };
  assert.equal(descriptorMatches(media), false);
  const exact = await project(eight, data(media), review(), NOW); assert.ok(exact);
  assert.equal(exact.mediaIdentity.sourceMediaSha256, exact.mediaIdentity.publicMediaSha256);
  assert.deepEqual(parsePublic(exact.publicOutput, NOW), exact.publicOutput);
  assert.equal(await project(eight, data({ ...media, sha256: "f".repeat(64) }), review(), NOW), null);
});
