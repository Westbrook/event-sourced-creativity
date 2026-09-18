import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
const { createSelectedOutputShareClient } = await import("../src/selected-output-share-client.ts");
const { projectSelectedOutputShareCandidate, projectSelectedOutputShareMediaCandidate,
  SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY: projectionPolicy } = await import("../src/model/selected-output-share.ts");
const { SELECTED_OUTPUT_SHARE_AUDIO_POLICY: audioPolicy } = await import("../src/model/selected-output-share-audio.ts");
const { SELECTED_OUTPUT_SHARE_VIDEO_POLICY: videoPolicy, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY: encoderPolicy } = await import("../src/model/selected-output-share-video.ts");
const { SELECTED_OUTPUT_SHARE_MODEL3D_POLICY: modelPolicy, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY: texturePolicy } = await import("../src/model/selected-output-share-model3d.ts");
const { SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE: sourceProfile,
  SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY: derivativePolicy } = await import("../src/model/selected-output-share-mp3-contract.ts");
const { accessVerifiedSelectedOutputShareMedia, disposeVerifiedSelectedOutputShareMedia } = await import("../src/selected-output-share-media-client.ts");
const { wav } = await import("./output-asset-fixtures.mjs");
imports.deregister();

const origin = "https://forma.test", base = origin + "/api/selected-output-shares";
const unavailable = error => error instanceof Error && error.message === "selected_output_share_unavailable";
const selection = output => ({ output, documentId: "document-1", artifactId: "artifact-1", revision: 0, contentSha256: "a".repeat(64) });
const review = () => ({ title: "  Reviewed 日本語 العربية  ", expiresAt: new Date(Date.now() + 3600000).toISOString() });
const metadata = () => ({ shareId: "old-share", title: "Old reviewed title", output: "short_story", revision: 0,
  issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" });
const cursor = (id = "old-share") => Buffer.from(JSON.stringify(["2020-01-01T00:00:00.000Z", id])).toString("base64url");
async function candidate(output = "short_story", choices = review()) {
  const selected = selection(output), { output: _output, ...nativeSelection } = selected;
  const native = { schemaVersion: 1, selection: nativeSelection, title: "Private native title",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    ...(output === "short_story" ? { kind: "native-retained-short-story", contentMarkdown: "Exact retained <script>literal</script>." }
      : { kind: "native-retained-output", output, content: output === "scene"
        ? { content_markdown: "Exact scene text", medium: "audio" }
        : { presentation: null, items: [{ title: "Slide", body: "Exact slide text", notes: "", image_prompt: "", slide: null }] } }),
  };
  const value = await projectSelectedOutputShareCandidate(selected, native, choices); assert(value);
  return value;
}
const profiles = [["audio", audioPolicy], ["video", videoPolicy], ["video", encoderPolicy], ["model3d", modelPolicy], ["model3d", texturePolicy]];
const mediaSelection = (output, policy) => ({ ...selection(output), mediaSha256: "b".repeat(64), policy, projectionPolicy });
// Declared fixture descriptors exercise the actual client/model boundary. They
// are not proof of qualified bytes, custody, a live provider or permission.
async function mediaCandidate(output = "audio", policy = audioPolicy, choices = review()) {
  const selected = mediaSelection(output, policy), descriptor = { kind: output,
    mimeType: output === "audio" ? "audio/wav" : output === "video" ? "video/mp4" : "model/gltf-binary",
    sha256: selected.mediaSha256, byteLength: output === "audio" ? 8044 : output === "video" ? 782 : 408,
    ...(output === "audio" ? { sampleRate: 8000, channels: 1, sampleCount: 4000, durationSeconds: 0.5, durationBasis: "pcm-samples" }
      : output === "video" ? { width: 16, height: 16, durationSeconds: 1 } : {}) };
  const value = await projectSelectedOutputShareMediaCandidate(selected, { descriptor,
    sourceExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    disclosure: output === "audio" ? { watermark: "synthid-declared" }
      : output === "video" ? { encoderDeclaration: policy === encoderPolicy ? "x264-163-r3060" : null } : {},
  }, choices); assert(value); return value;
}
async function derivativeCandidate(choices = review(), bytes) {
  const selected = { ...mediaSelection("audio", audioPolicy), sourceProfile, projectionPolicy: derivativePolicy };
  const descriptor = { kind: "audio", mimeType: "audio/wav", sha256: bytes
    ? createHash("sha256").update(bytes).digest("hex") : "c".repeat(64), byteLength: 1_280_044,
    sampleRate: 32000, channels: 1, sampleCount: 640000, durationSeconds: 20, durationBasis: "pcm-samples" };
  const value = await projectSelectedOutputShareMediaCandidate(selected, { descriptor,
    sourceExpiresAt: new Date(Date.now() + 86400000).toISOString(), disclosure: { watermark: "not-declared" } }, choices);
  assert(value, "actual model accepts the closed Stable20 derivative fixture"); return value;
}
function rehash(value) {
  const { candidateSha256: _digest, ...preimage } = value;
  return { ...preimage, candidateSha256: createHash("sha256").update(JSON.stringify(preimage)).digest("hex") };
}
function fixture(selected = selection("short_story"), readMedia) {
  const controller = new AbortController(), calls = [], replies = []; let current = true;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    assert(replies.length, "unexpected request: " + url);
    const reply = replies.shift(), response = await (typeof reply === "function" ? reply(url, init) : reply);
    if (!Object.hasOwn(response, "url")) Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const lease = { selection: selected, signal: controller.signal, isCurrent: () => current, ...(readMedia ? { readMedia } : {}) };
  const options = { origin, fetcher }, client = createSelectedOutputShareClient(lease, options);
  return { client, calls, replies, controller, lease, options, retire() { current = false; }, setCurrent(value) { current = value; },
    json(value) { replies.push(Response.json(value)); },
    async enable() { replies.push(Response.json({ creationAvailable: true })); assert.equal(await client.availability(), true); },
  };
}
async function prepare(f, value) {
  value ??= await candidate();
  f.json({ candidateId: "candidate-1", candidate: value, replayed: false });
  return f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-1");
}
const mediaUnavailable = error => error instanceof Error && /^selected_output_(?:share|media)_unavailable$/u.test(error.message);
async function eventually(check, label) {
  for (let index = 0; index < 40; index++) { if (check()) return; await new Promise(setImmediate); }
  assert(check(), label);
}
async function previewFixture(t, choices = review()) {
  // Synthetic public WAV only. No MP3 decoding, native custody or provider call
  // is represented by this client transport fixture.
  const bytes = wav({ samples: 640000, sampleRate: 32000 }), value = await derivativeCandidate(choices, bytes);
  const f = fixture(value.selection), controller = new AbortController(), handles = [];
  let current = true;
  const controls = { signal: controller.signal, isCurrent: () => current };
  await f.enable(); const result = await prepare(f, value);
  t.after(() => { controller.abort(); f.controller.abort(); handles.forEach(disposeVerifiedSelectedOutputShareMedia); });
  return { ...f, bytes, value, result, controls, reviewController: controller,
    retireReview() { current = false; },
    response(body = bytes) { return new Response(body, { headers: { "content-type": "audio/wav",
      "content-length": String(bytes.byteLength), "content-disposition": 'attachment; filename="forma-audio.wav"' } }); },
    async read(reader, output = value.publicOutput, inputControls = controls) {
      const handle = await reader(output, inputControls); handles.push(handle); return handle;
    },
  };
}

test("Stable20 derivative identity and closed profile cannot be repaired by recomputing the candidate digest", async () => {
  const original = await derivativeCandidate();
  for (const mutate of [
    value => { value.mediaIdentity.sourceMediaSha256 = value.mediaIdentity.publicMediaSha256; },
    value => { value.mediaIdentity.publicMediaSha256 = value.mediaIdentity.sourceMediaSha256; },
    value => { value.mediaIdentity.qualificationPolicy = derivativePolicy; },
    value => { value.mediaIdentity.projectionPolicy = projectionPolicy; },
    value => { value.mediaIdentity.sourceProfile = sourceProfile; },
    value => { value.selection.sourceProfile = "forma.audio.instrumental-20.wav@1"; },
    value => { delete value.selection.sourceProfile; },
    value => { value.selection.projectionPolicy = projectionPolicy; },
    value => { value.selection.policy = derivativePolicy; },
    value => { value.publicOutput.content.media.mimeType = "audio/mpeg"; },
    value => { value.publicOutput.content.media.byteLength += 2; },
    value => { const media = value.publicOutput.content.media; media.sampleCount--; media.durationSeconds = media.sampleCount / media.sampleRate; media.byteLength -= 2; },
    value => { const media = value.publicOutput.content.media; media.sampleRate = 8000; media.sampleCount = 160000; media.byteLength = 320044; },
    value => { value.publicOutput.content.disclosure.watermark = "verified"; },
    value => { value.publicOutput.content.media.sourceMediaSha256 = value.selection.mediaSha256; },
    value => { value.publicOutput.sourceProfile = sourceProfile; },
  ]) {
    const f = fixture(original.selection); await f.enable(); const changed = structuredClone(original); mutate(changed);
    f.json({ candidateId: "candidate-1", candidate: rehash(changed), replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
    const before = f.calls.length; await assert.rejects(f.client.commit("candidate-1", original), unavailable); assert.equal(f.calls.length, before);
  }
});

test("exact-byte WAV, Video and GLB policies still reject distinct source and public hashes after rehash", async () => {
  for (const [output, policy] of profiles) {
    const value = await mediaCandidate(output, policy), changed = structuredClone(value), f = fixture(value.selection); await f.enable();
    changed.publicOutput.content.media.sha256 = "c".repeat(64); changed.mediaIdentity.publicMediaSha256 = "c".repeat(64);
    f.json({ candidateId: "candidate-1", candidate: rehash(changed), replayed: false });
    await assert.rejects(f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent"), unavailable);
    assert.equal(f.calls.length, 2);
  }
});

test("prepared media reader is synchronous, performs no factory transport and reads the exact private candidate file", async t => {
  const f = await previewFixture(t), before = f.calls.length;
  const reader = f.client.createPreparedMediaReader(f.result);
  assert.equal(typeof reader, "function"); assert.equal(f.calls.length, before);
  let substitutedFetch = 0;
  f.options.fetcher = async () => { substitutedFetch++; throw Error("mutated options must not replace captured fetcher"); };
  f.options.origin = "https://foreign.test";
  f.replies.push(f.response()); const handle = await f.read(reader), accessed = accessVerifiedSelectedOutputShareMedia(handle, f.value.publicOutput);
  assert(accessed); assert.equal(accessed.fileName, "forma-audio.wav");
  assert.deepEqual(new Uint8Array(await accessed.blob.arrayBuffer()), f.bytes);
  const call = f.calls.at(-1); assert.equal(call.url, base + "/candidate-1/file");
  assert.equal(call.init.method, "GET"); assert.equal(call.init.credentials, "same-origin"); assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.redirect, "error"); assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.equal(new Headers(call.init.headers).get("accept"), "audio/wav"); assert.equal(new Headers(call.init.headers).get("range"), null);
  assert.equal(call.init.body, undefined); assert.equal(substitutedFetch, 0); assert.equal(f.calls.length, before + 1);
});

test("prepared media reader factory requires the exact genuine object from the same client and rejects text", async t => {
  const f = await previewFixture(t), foreign = fixture(f.value.selection); await foreign.enable(); const other = await prepare(foreign, f.value);
  let getters = 0;
  const getter = { get candidateId() { getters++; return f.result.candidateId; }, candidate: f.result.candidate, replayed: false };
  for (const value of [undefined, null, {}, structuredClone(f.result), { ...f.result }, other, getter,
    Object.assign(Object.create(f.result), {}), { ...f.result, candidateId: "candidate-2" }]) {
    const before = f.calls.length; assert.throws(() => f.client.createPreparedMediaReader(value), unavailable); assert.equal(f.calls.length, before);
  }
  assert.equal(getters, 0);
  const text = fixture(); await text.enable(); const result = await prepare(text); const before = text.calls.length;
  assert.throws(() => text.client.createPreparedMediaReader(result), unavailable); assert.equal(text.calls.length, before);
});

test("prepared reader binds the complete canonical public output before any file transport", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), original = f.value.publicOutput;
  for (const mutate of [
    value => { value.title = "Different reviewed title"; },
    value => { value.expiresAt = new Date(Date.parse(value.expiresAt) - 1).toISOString(); },
    value => { value.attribution = "Other"; },
    value => { value.content.disclosure.watermark = "synthid-declared"; },
    value => { value.content.media.sha256 = f.value.selection.mediaSha256; },
    value => { value.content.media.sampleRate = 48000; value.content.media.durationSeconds = value.content.media.sampleCount / 48000; },
    value => { value.content.media.url = "/api/media/private"; },
    value => { value.output = "video"; },
  ]) {
    const changed = structuredClone(original); mutate(changed); const before = f.calls.length;
    await assert.rejects(reader(changed, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  }
  f.replies.push(f.response()); const handle = await f.read(reader, structuredClone(original));
  assert(accessVerifiedSelectedOutputShareMedia(handle, original), "equal closed data is accepted without requiring the output object's identity");
});

test("new prepare immediately retires an older reader even when its request is pending or fails", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), delayed = Promise.withResolvers();
  f.replies.push(() => delayed.promise);
  const next = f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-2");
  const before = f.calls.length;
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  delayed.reject(Error("prepare acknowledgment lost")); await assert.rejects(next, /acknowledgment lost/u);
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
});

test("same-ID successful reprepare replaces only the genuine object and cannot revive the old reader", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result);
  f.json({ candidateId: f.result.candidateId, candidate: f.value, replayed: true });
  const replacement = await f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-1");
  assert.notEqual(replacement, f.result); assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  const before = f.calls.length; await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  const current = f.client.createPreparedMediaReader(replacement); f.replies.push(f.response());
  assert(accessVerifiedSelectedOutputShareMedia(await f.read(current), f.value.publicOutput));
});

test("any availability request immediately retires previews and later success cannot revive them", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), delayed = Promise.withResolvers();
  f.replies.push(() => delayed.promise); const pending = f.client.availability(), before = f.calls.length;
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  delayed.resolve(Response.json({ creationAvailable: true })); assert.equal(await pending, true);
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
});

test("rejecting an old-epoch preparation factory leaves the newer epoch's genuine preview usable", async t => {
  const f = await previewFixture(t); await f.enable(); const current = await prepare(f, f.value), before = f.calls.length;
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  const reader = f.client.createPreparedMediaReader(current); assert.equal(f.calls.length, before);
  f.replies.push(f.response()); const handle = await f.read(reader);
  assert(accessVerifiedSelectedOutputShareMedia(handle, f.value.publicOutput));
  assert.equal(f.calls.at(-1).url, base + "/candidate-1/file"); assert.equal(f.calls.length, before + 1);
});

test("a delayed prepare response from an old epoch cannot retire the newer epoch's current preview", async t => {
  const f = await previewFixture(t), delayed = Promise.withResolvers(); f.replies.push(() => delayed.promise);
  const older = f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-old-epoch");
  await f.enable(); const current = await prepare(f, f.value);
  delayed.resolve(Response.json({ candidateId: "candidate-old-epoch", candidate: f.value, replayed: false }));
  await assert.rejects(older, unavailable); const before = f.calls.length, reader = f.client.createPreparedMediaReader(current);
  assert.equal(f.calls.length, before); f.replies.push(f.response()); const handle = await f.read(reader);
  assert(accessVerifiedSelectedOutputShareMedia(handle, f.value.publicOutput));
  assert.equal(f.calls.at(-1).url, base + "/candidate-1/file"); assert.equal(f.calls.length, before + 1);
});

test("lost commit acknowledgment closes previews permanently but preserves explicit metadata-only replay", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), delayed = Promise.withResolvers();
  f.replies.push(() => delayed.promise); const pending = f.client.commit(f.result.candidateId, f.result.candidate);
  const noRead = f.calls.length; assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable);
  await eventually(() => f.calls.length === noRead + 1, "explicit commit reaches transport after hashing");
  delayed.reject(Error("lost commit acknowledgment")); await assert.rejects(pending, /lost commit acknowledgment/u);
  assert.equal(f.calls.length, noRead + 1, "only the pending commit may reach transport after candidate hashing");
  f.json({ candidateId: f.result.candidateId, candidate: f.value, replayed: true });
  const replayPreparation = await f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-1");
  assert.throws(() => f.client.createPreparedMediaReader(replayPreparation), unavailable);
  const share = { shareId: f.result.candidateId, expiresAt: f.value.publicOutput.expiresAt, active: true };
  f.json({ share, replayed: true }); assert.deepEqual(await f.client.commit(f.result.candidateId, f.result.candidate), { share, replayed: true });
});

test("a known-ID malformed commit attempt still retires preview without discarding the accepted digest", async t => {
  const f = await previewFixture(t), before = f.calls.length;
  await assert.rejects(f.client.commit(f.result.candidateId, { ...f.result.candidate, candidateSha256: "0".repeat(64) }), unavailable);
  assert.equal(f.calls.length, before); assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  const share = { shareId: f.result.candidateId, expiresAt: f.value.publicOutput.expiresAt, active: true, token: "M".repeat(32) };
  f.json({ share, replayed: false }); assert.deepEqual(await f.client.commit(f.result.candidateId, f.result.candidate), { share, replayed: false });
});

test("revocation closes the affected preview before transport and failed acknowledgment cannot reopen it", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), delayed = Promise.withResolvers();
  f.replies.push(() => delayed.promise); const pending = f.client.revoke(f.result.candidateId), before = f.calls.length;
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  delayed.reject(Error("lost revoke acknowledgment")); await assert.rejects(pending, /lost revoke acknowledgment/u);
  const replacement = await prepare(f, f.value); assert.throws(() => f.client.createPreparedMediaReader(replacement), unavailable);
});

test("revoking another owned ID does not retire the current preparation", async t => {
  const f = await previewFixture(t); f.json({ ok: true }); await f.client.revoke("other-owned-share");
  const reader = f.client.createPreparedMediaReader(f.result); f.replies.push(f.response());
  assert(accessVerifiedSelectedOutputShareMedia(await f.read(reader), f.value.publicOutput));
});

test("prepared preview factory and reader refuse expired, aborted or noncurrent source leases without transport", async t => {
  for (const mode of ["expiry", "abort", "retire"]) await t.test(mode, async child => {
    const f = await previewFixture(child), reader = f.client.createPreparedMediaReader(f.result), before = f.calls.length;
    if (mode === "expiry") child.mock.method(Date, "now", () => Date.parse(f.value.publicOutput.expiresAt));
    else if (mode === "abort") f.controller.abort(); else f.retire();
    assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
    await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
  });
});

test("prepared preview captures supplied read controls instead of accepting later signal or currentness replacement", async t => {
  for (const mode of ["abort", "retire"]) await t.test(mode, async child => {
    const f = await previewFixture(child), reader = f.client.createPreparedMediaReader(f.result), delayed = Promise.withResolvers();
    f.replies.push(() => delayed.promise); const pending = f.read(reader); let cancelled = false;
    f.controls.signal = new AbortController().signal; f.controls.isCurrent = () => true;
    if (mode === "abort") f.reviewController.abort(); else f.retireReview();
    const response = f.response(new ReadableStream({ cancel() { cancelled = true; } })); delayed.resolve(response);
    await assert.rejects(pending, mediaUnavailable); await eventually(() => cancelled, "retired late body is cancelled");
    assert.equal(f.calls.length, 3);
  });
});

test("in-flight candidate file reads and retained handles retire on preparation, availability, commit and revoke", async t => {
  for (const mode of ["prepare", "availability", "commit", "revoke"]) await t.test(mode, async child => {
    const f = await previewFixture(child), reader = f.client.createPreparedMediaReader(f.result);
    f.replies.push(f.response()); const handle = await f.read(reader); assert(accessVerifiedSelectedOutputShareMedia(handle, f.value.publicOutput));
    const delayed = Promise.withResolvers(); f.replies.push(() => delayed.promise); const pendingRead = f.read(reader);
    let operation;
    if (mode === "prepare") operation = prepare(f, f.value);
    else if (mode === "availability") { f.json({ creationAvailable: true }); operation = f.client.availability(); }
    else if (mode === "commit") {
      f.json({ share: { shareId: f.result.candidateId, expiresAt: f.value.publicOutput.expiresAt, active: true, token: "R".repeat(32) }, replayed: false });
      operation = f.client.commit(f.result.candidateId, f.result.candidate);
    } else { f.json({ ok: true }); operation = f.client.revoke(f.result.candidateId); }
    assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.value.publicOutput), null);
    let cancelled = false; delayed.resolve(f.response(new ReadableStream({ cancel() { cancelled = true; } })));
    await assert.rejects(pendingRead, mediaUnavailable); await operation;
    await eventually(() => cancelled, "retired in-flight candidate response is cancelled");
  });
});

test("prepared lifetime is monotonic across repeated factory calls, wall clock rollback and same-ID reprepare", async t => {
  const wallStart = Date.now(); let wall = wallStart, monotonic = 100;
  t.mock.method(Date, "now", () => wall); t.mock.method(performance, "now", () => monotonic);
  const f = await previewFixture(t, { title: "Audio", expiresAt: new Date(wallStart + 2000).toISOString() });
  const originalReader = f.client.createPreparedMediaReader(f.result);
  monotonic = 1000; wall = wallStart - 10000;
  assert.equal(typeof f.client.createPreparedMediaReader(f.result), "function", "locale/rerender factory calls do not read bytes");
  const replacement = await prepare(f, f.value), currentReader = f.client.createPreparedMediaReader(replacement);
  monotonic = 2100;
  const before = f.calls.length; assert.throws(() => f.client.createPreparedMediaReader(replacement), unavailable);
  await assert.rejects(originalReader(f.value.publicOutput, f.controls), mediaUnavailable);
  await assert.rejects(currentReader(f.value.publicOutput, f.controls), mediaUnavailable);
  assert.equal(f.calls.length, before, "reprepare preserves the earliest deadline for this candidate ID");
});

test("initial prepare network delay cannot reset a candidate lifetime after wall clock rollback", async t => {
  const wallStart = Date.now(); let wall = wallStart, monotonic = 100;
  t.mock.method(Date, "now", () => wall); t.mock.method(performance, "now", () => monotonic);
  const value = await derivativeCandidate({ title: "Audio", expiresAt: new Date(wallStart + 2000).toISOString() });
  const f = fixture(value.selection); await f.enable(); const delayed = Promise.withResolvers();
  f.replies.push(() => delayed.promise);
  const pending = f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-1");
  wall = wallStart - 10000; monotonic = 1000;
  delayed.resolve(Response.json({ candidateId: "candidate-1", candidate: value, replayed: false })); const result = await pending;
  assert.equal(typeof f.client.createPreparedMediaReader(result), "function");
  monotonic = 2100; const before = f.calls.length;
  assert.throws(() => f.client.createPreparedMediaReader(result), unavailable); assert.equal(f.calls.length, before);
});

async function commitClockFixture(t, kind = "derivative") {
  const start = Date.now(), clock = { wall: start, monotonic: 100 };
  t.mock.method(Date, "now", () => clock.wall); t.mock.method(performance, "now", () => clock.monotonic);
  const choices = { title: "Reviewed output", expiresAt: new Date(start + 2000).toISOString() };
  const value = kind === "derivative" ? await derivativeCandidate(choices)
    : kind === "audio" ? await mediaCandidate("audio", audioPolicy, choices) : await candidate("short_story", choices);
  const f = fixture(value.selection); await f.enable(); const result = await prepare(f, value);
  const share = { shareId: result.candidateId, expiresAt: value.publicOutput.expiresAt, active: true };
  clock.wall = start - 10000;
  return { ...f, value, result, share, clock, deadline: 2100 };
}

test("commit monotonic: Stable20 refuses at the original deadline before hashing or approval transport despite wall rollback", async t => {
  const f = await commitClockFixture(t), before = f.calls.length; f.clock.monotonic = f.deadline;
  const digest = crypto.subtle.digest.bind(crypto.subtle); let hashes = 0;
  t.mock.method(crypto.subtle, "digest", (...args) => { hashes++; return digest(...args); });
  f.json({ share: { ...f.share, token: "S".repeat(32) }, replayed: false });
  await assert.rejects(f.client.commit(f.result.candidateId, f.result.candidate), unavailable,
    "expired Stable20 commit must not use rolled-back wall time to create approval");
  assert.equal(hashes, 0); assert.equal(f.calls.length, before);
});

test("commit monotonic: Stable20 expiry during candidate hashing prevents approval transport", async t => {
  const f = await commitClockFixture(t), before = f.calls.length, blocked = Promise.withResolvers(), release = Promise.withResolvers();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args) => { blocked.resolve(); await release.promise; return digest(...args); });
  f.json({ share: { ...f.share, token: "T".repeat(32) }, replayed: false });
  const pending = f.client.commit(f.result.candidateId, f.result.candidate); await blocked.promise;
  f.clock.monotonic = f.deadline; release.resolve();
  await assert.rejects(pending, unavailable, "hash completion must recheck the original monotonic deadline");
  assert.equal(f.calls.length, before);
});

test("commit monotonic: Stable20 expiry while awaiting final acknowledgment prevents successful token return", async t => {
  const f = await commitClockFixture(t), before = f.calls.length, requested = Promise.withResolvers(), response = Promise.withResolvers();
  f.replies.push(() => { requested.resolve(); return response.promise; });
  const pending = f.client.commit(f.result.candidateId, f.result.candidate); await requested.promise;
  assert.equal(f.calls.length, before + 1); f.clock.monotonic = f.deadline;
  response.resolve(Response.json({ share: { ...f.share, token: "U".repeat(32) }, replayed: false }));
  await assert.rejects(pending, unavailable, "a late successful acknowledgment cannot revive an expired Stable20 commit");
  assert.equal(f.calls.length, before + 1, "the client never retries a late acknowledgment automatically");
});

test("commit monotonic: Stable20 lost-acknowledgment retry and same-ID reprepare remain usable within the original deadline", async t => {
  const f = await commitClockFixture(t), before = f.calls.length; f.clock.monotonic = 600;
  f.replies.push(() => { throw Error("synthetic lost acknowledgment within original deadline"); });
  await assert.rejects(f.client.commit(f.result.candidateId, f.result.candidate), /synthetic lost acknowledgment/u);
  assert.equal(f.calls.length, before + 1);
  f.clock.monotonic = 1000;
  f.json({ candidateId: f.result.candidateId, candidate: f.value, replayed: true });
  const replacement = await f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-1");
  assert.throws(() => f.client.createPreparedMediaReader(replacement), unavailable, "retry never reopens preview after a commit attempt");
  f.clock.monotonic = f.deadline - 1; f.json({ share: f.share, replayed: true });
  assert.deepEqual(await f.client.commit(f.result.candidateId, f.result.candidate), { share: f.share, replayed: true });
  assert.equal(f.calls.length, before + 3); assert.equal(Object.hasOwn(f.share, "token"), false);
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body), { candidateId: f.result.candidateId,
    approval: { purpose: "selected-output-read-v1", candidateSha256: f.value.candidateSha256, allowPublicRead: true } });
});

test("commit monotonic: Stable20 same-ID reprepare cannot renew a lost-acknowledgment retry deadline", async t => {
  const f = await commitClockFixture(t); f.clock.monotonic = 600;
  f.replies.push(() => { throw Error("synthetic lost acknowledgment"); });
  await assert.rejects(f.client.commit(f.result.candidateId, f.result.candidate), /synthetic lost acknowledgment/u);
  f.clock.monotonic = 1000;
  f.json({ candidateId: f.result.candidateId, candidate: f.value, replayed: true });
  const replacement = await f.client.prepare({ title: f.value.publicOutput.title, expiresAt: f.value.publicOutput.expiresAt }, "intent-1");
  f.clock.monotonic = f.deadline; const before = f.calls.length;
  f.json({ share: f.share, replayed: true });
  await assert.rejects(f.client.commit(replacement.candidateId, replacement.candidate), unavailable,
    "same-ID reprepare must preserve the earliest monotonic deadline even after wall rollback");
  assert.equal(f.calls.length, before);
});

test("commit monotonic: existing exact-byte and text commit policies remain unchanged", async t => {
  for (const kind of ["audio", "short_story"]) await t.test(kind, async child => {
    const f = await commitClockFixture(child, kind), before = f.calls.length; f.clock.monotonic = f.deadline;
    f.json({ share: { ...f.share, token: "V".repeat(32) }, replayed: false });
    assert.deepEqual(await f.client.commit(f.result.candidateId, f.result.candidate),
      { share: { ...f.share, token: "V".repeat(32) }, replayed: false });
    assert.equal(f.calls.length, before + 1);
  });
});

test("a previously observed loss of owner currentness cannot resurrect the same preview", async t => {
  const f = await previewFixture(t), reader = f.client.createPreparedMediaReader(f.result), before = f.calls.length;
  f.setCurrent(false); await assert.rejects(f.client.list(), unavailable); f.setCurrent(true);
  assert.throws(() => f.client.createPreparedMediaReader(f.result), unavailable);
  await assert.rejects(reader(f.value.publicOutput, f.controls), mediaUnavailable); assert.equal(f.calls.length, before);
});

test("an older prepare response or digest cannot replace the latest successfully returned preparation", async t => {
  for (const mode of ["response", "digest"]) await t.test(mode, async child => {
    const value = await derivativeCandidate(), f = fixture(value.selection); await f.enable();
    const delayed = Promise.withResolvers(), blocked = Promise.withResolvers();
    if (mode === "response") f.replies.push(() => { blocked.resolve(); return delayed.promise; });
    else {
      const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
      child.mock.method(crypto.subtle, "digest", async (...args) => {
        if (first) { first = false; blocked.resolve(); await delayed.promise; } return digest(...args);
      });
      f.json({ candidateId: "candidate-old", candidate: value, replayed: false });
    }
    const older = f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-old"); await blocked.promise;
    f.json({ candidateId: "candidate-new", candidate: value, replayed: false });
    const newer = await f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-new");
    delayed.resolve(mode === "response" ? Response.json({ candidateId: "candidate-old", candidate: value, replayed: false }) : undefined);
    await assert.rejects(older, unavailable); const before = f.calls.length;
    assert.equal(typeof f.client.createPreparedMediaReader(newer), "function");
    await assert.rejects(f.client.commit("candidate-old", value), unavailable); assert.equal(f.calls.length, before);
  });
});

test("the prepared derivative factory does not widen existing exact-byte profiles into candidate file readers", async () => {
  for (const [output, policy] of profiles) {
    const value = await mediaCandidate(output, policy), f = fixture(value.selection); await f.enable(); const result = await prepare(f, value);
    const before = f.calls.length; assert.throws(() => f.client.createPreparedMediaReader(result), unavailable); assert.equal(f.calls.length, before);
  }
});

test("derivative canonical hashing rejects reordered-preimage digests and altered data retaining the original digest", async () => {
  const original = await derivativeCandidate();
  const altered = [Object.fromEntries(Object.entries(structuredClone(original)).reverse()), structuredClone(original), structuredClone(original)];
  altered[0] = rehash(altered[0]); altered[1].mediaIdentity.publicMediaSha256 = "f".repeat(64);
  altered[2].publicOutput.content.disclosure.watermark = "synthid-declared";
  assert.notEqual(altered[0].candidateSha256, original.candidateSha256);
  for (const value of altered) {
    const f = fixture(original.selection); await f.enable(); f.json({ candidateId: "candidate-1", candidate: value, replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent-1"), unavailable);
    assert.equal(f.calls.length, 2);
  }
});

test("Stable20 actual model derivative candidate preserves distinct source and public hashes through prepare and approval", async () => {
  const value = await derivativeCandidate(), f = fixture(value.selection); await f.enable();
  assert.notEqual(value.mediaIdentity.sourceMediaSha256, value.mediaIdentity.publicMediaSha256);
  const result = await prepare(f, value);
  assert.equal(JSON.stringify(result.candidate), JSON.stringify(value));
  for (const item of [result, result.candidate, result.candidate.selection, result.candidate.mediaIdentity,
    result.candidate.publicOutput, result.candidate.publicOutput.content, result.candidate.publicOutput.content.media,
    result.candidate.publicOutput.content.disclosure]) assert(Object.isFrozen(item));
  assert.deepEqual(result.candidate.selection, value.selection);
  assert.equal(result.candidate.selection.sourceProfile, sourceProfile);
  assert.equal(result.candidate.mediaIdentity.projectionPolicy, derivativePolicy);
  const share = { shareId: result.candidateId, expiresAt: value.publicOutput.expiresAt, active: true, token: "D".repeat(32) };
  f.json({ share, replayed: false }); assert.deepEqual(await f.client.commit(result.candidateId, result.candidate), { share, replayed: false });
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body), { candidateId: result.candidateId,
    approval: { purpose: "selected-output-read-v1", candidateSha256: value.candidateSha256, allowPublicRead: true } });
  assert.equal(f.calls.length, 3, "decoding and approval do not fetch source bytes or run a decoder");
});

test("actual model candidates for all three outputs retain exact reviewed data and fixed request policy", async () => {
  for (const output of ["short_story", "scene", "slides"]) {
    const f = fixture(selection(output)), value = await candidate(output); await f.enable();
    const result = await prepare(f, value);
    assert.deepEqual(result, { candidateId: "candidate-1", candidate: value, replayed: false });
    assert(Object.isFrozen(result) && Object.isFrozen(result.candidate) && Object.isFrozen(result.candidate.publicOutput.content));
    const sent = f.calls[1]; assert.equal(sent.url, base + "/prepare");
    assert.deepEqual(JSON.parse(sent.init.body), { intentKey: "intent-1", selection: selection(output),
      review: { title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt } });
    for (const { url, init } of f.calls) {
      assert.equal(new URL(url).origin, origin); assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.headers.Accept, "application/json"); assert.equal(init.signal, f.controller.signal);
    }
    assert.equal(sent.init.headers["Content-Type"], "application/json");
  }
});

for (const [output, policy] of profiles) test(`media ${policy}: exact model candidate, private identity and explicit approval survive the client`, async () => {
  const value = await mediaCandidate(output, policy), f = fixture(mediaSelection(output, policy)); await f.enable();
  const result = await prepare(f, value);
  assert.deepEqual(result, { candidateId: "candidate-1", candidate: value, replayed: false });
  assert.equal(JSON.stringify(result.candidate), JSON.stringify(value), "canonical media digest input order survives decoding");
  for (const item of [result, result.candidate, result.candidate.selection, result.candidate.mediaIdentity,
    result.candidate.publicOutput, result.candidate.publicOutput.content, result.candidate.publicOutput.content.media,
    result.candidate.publicOutput.content.disclosure]) assert(Object.isFrozen(item));
  assert.notEqual(result.candidate.selection.contentSha256, result.candidate.mediaIdentity.sourceMediaSha256);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { intentKey: "intent-1", selection: value.selection,
    review: { title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt } });
  const share = { shareId: result.candidateId, expiresAt: value.publicOutput.expiresAt, active: true, token: "A".repeat(32) };
  f.json({ share, replayed: false }); assert.deepEqual(await f.client.commit(result.candidateId, result.candidate), { share, replayed: false });
  assert.equal(f.calls[2].url, base + "/commit");
  assert.deepEqual(JSON.parse(f.calls[2].init.body), { candidateId: result.candidateId,
    approval: { purpose: "selected-output-read-v1", candidateSha256: value.candidateSha256, allowPublicRead: true } });
  assert.equal(f.calls.length, 3, "candidate decoding performs no media fetch or provider call");
});

test("media identity is closed and cannot be silently repaired even with an attacker-recomputed candidate digest", async () => {
  const original = await mediaCandidate();
  for (const mutate of [
    value => { delete value.mediaIdentity; }, value => { value.mediaIdentity.extra = true; },
    ...["sourceMediaSha256", "publicMediaSha256", "qualificationPolicy", "projectionPolicy"].flatMap(key => [
      value => { delete value.mediaIdentity[key]; }, value => { value.mediaIdentity[key] = "c".repeat(64); },
    ]),
    value => { value.selection.mediaSha256 = value.selection.contentSha256; },
    value => { value.selection.policy = videoPolicy; }, value => { value.selection.projectionPolicy = "future-transform"; },
    value => { value.publicOutput.content.media.sha256 = value.selection.contentSha256; },
    value => { value.publicOutput.content.media.kind = "video"; },
    value => { value.publicOutput.content.media.byteLength--; },
    value => { value.publicOutput.content.media.mimeType = "audio/mpeg"; },
    value => { value.publicOutput.content.disclosure.watermark = "verified"; },
    value => { value.publicOutput.content.media.url = "/api/private-media"; },
    value => { value.publicOutput.content.media.fileName = "Private filename.wav"; },
    value => { value.publicOutput.content.media.bytes = [0, 1]; },
    value => { value.publicOutput.content.disclosure.provider = "private"; },
    value => { value.publicOutput.attribution = "Other"; },
    value => { value.publicOutput.kind = "native-retained-output"; },
    value => { value.publicOutput.schemaVersion = 2; },
    value => { value.sourceExpiresAt = new Date(Date.parse(value.publicOutput.expiresAt) - 1).toISOString(); },
    value => { value.sourceExpiresAt = "2000-01-01T00:00:00.000Z"; },
    value => { value.sourceExpiresAt = value.sourceExpiresAt.replace(/\.\d{3}Z$/u, "Z"); },
    value => { value.publicOutput.title = "Unreviewed title"; },
    value => { value.publicOutput.expiresAt = new Date(Date.parse(value.publicOutput.expiresAt) - 1).toISOString(); },
    value => { value.selection.documentId = "another-document"; },
    value => { value.selection.revision++; }, value => { value.purpose = "selected-output-media-read-v1"; },
    value => { value.bytes = [0, 1]; },
  ]) {
    const f = fixture(original.selection); await f.enable(); const changed = structuredClone(original); mutate(changed);
    f.json({ candidateId: "candidate-1", candidate: rehash(changed), replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
    const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", original), unavailable); assert.equal(f.calls.length, count);
  }
});

test("media profile policies and disclosures cannot be substituted or downgraded into text", async () => {
  for (const [output, policy] of profiles) {
    const original = await mediaCandidate(output, policy);
    const changed = structuredClone(original);
    if (output === "audio") changed.publicOutput.content.disclosure = {};
    else if (output === "video") changed.publicOutput.content.disclosure.encoderDeclaration = policy === encoderPolicy ? null : "x264-163-r3060";
    else changed.publicOutput.content.disclosure = { textures: true };
    const f = fixture(original.selection); await f.enable(); f.json({ candidateId: "candidate-1", candidate: rehash(changed), replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
    await assert.rejects(prepare(f, await candidate()), unavailable);
  }
  for (const output of ["image", "storyboard", "short_story"]) {
    assert.throws(() => fixture(mediaSelection(output, audioPolicy)), unavailable);
  }
  const f = fixture(); await f.enable(); const text = await candidate();
  assert.deepEqual(Object.keys(text.publicOutput), ["schemaVersion", "kind", "title", "expiresAt", "attribution", "output", "content"]);
  const parsed = await prepare(f, text); assert.equal(JSON.stringify(parsed.candidate), JSON.stringify(text));
  assert.deepEqual(Object.keys(parsed.candidate), ["schemaVersion", "kind", "purpose", "selection", "sourceExpiresAt", "publicOutput", "candidateSha256"]);
  f.json({ candidateId: "candidate-2", candidate: rehash({ ...text, mediaIdentity: (await mediaCandidate()).mediaIdentity }), replayed: false });
  await assert.rejects(f.client.prepare({ title: text.publicOutput.title, expiresAt: text.publicOutput.expiresAt }, "intent-2"), unavailable);
});

test("media normalization cannot discard malformed private identity or public fields while retaining the original valid digest", async () => {
  const original = await mediaCandidate();
  for (const mutate of [
    value => { delete value.mediaIdentity; }, value => { value.mediaIdentity.extra = true; },
    ...["sourceMediaSha256", "publicMediaSha256", "qualificationPolicy", "projectionPolicy"].flatMap(key => [
      value => { delete value.mediaIdentity[key]; }, value => { value.mediaIdentity[key] = "changed"; },
    ]),
    value => { value.publicOutput.attribution = "Changed"; },
    value => { value.publicOutput.sourceUrl = "/api/private-media"; },
    value => { value.publicOutput.content.private = "discarded private data"; },
    value => { value.publicOutput.content.media.fileName = "Private file.wav"; },
    value => { value.publicOutput.content.disclosure.private = true; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.equal(changed.candidateSha256, original.candidateSha256);
    const f = fixture(original.selection); await f.enable();
    f.json({ candidateId: "candidate-1", candidate: changed, replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
  }
});

test("media stays creation-closed while expired owned metadata remains listable and revocable", async () => {
  const value = await mediaCandidate(), f = fixture(value.selection);
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable);
  await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, 0);
  f.json({ creationAvailable: false }); assert.equal(await f.client.availability(), false);
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, 1);
  const rows = ["audio", "video", "model3d"].map((output, index) => ({ ...metadata(), shareId: "old-media-" + index, output }));
  f.json({ shares: rows, nextCursor: null }); assert.deepEqual((await f.client.list()).shares, rows);
  f.json({ ok: true }); await f.client.revoke(rows[0].shareId);
  for (const changed of [{ ...rows[0], token: "secret" }, { ...rows[0], output: "image" }, { ...rows[0], mediaSha256: "b".repeat(64) }]) {
    f.json({ shares: [changed], nextCursor: null }); await assert.rejects(f.client.list(), unavailable);
  }
});

test("media lost acknowledgment performs no retry and replay never restores a token", async () => {
  const value = await mediaCandidate(), f = fixture(value.selection); await f.enable(); const result = await prepare(f, value);
  const before = f.calls.length; f.replies.push(() => { throw Error("Lost media acknowledgment"); });
  await assert.rejects(f.client.commit(result.candidateId, result.candidate), /Lost media acknowledgment/u);
  assert.equal(f.calls.length, before + 1);
  const share = { shareId: result.candidateId, expiresAt: value.publicOutput.expiresAt, active: true };
  f.json({ share, replayed: true }); assert.deepEqual(await f.client.commit(result.candidateId, result.candidate), { share, replayed: true });
  f.json({ share: { ...share, token: "B".repeat(32) }, replayed: true });
  await assert.rejects(f.client.commit(result.candidateId, result.candidate), unavailable);
});

test("media candidate decoding neither invokes the trusted review port nor captures accessors", async () => {
  let mediaReads = 0, accesses = 0;
  const value = await mediaCandidate(), f = fixture(value.selection, async () => { mediaReads++; throw Error("not a media review gesture"); });
  await f.enable(); await prepare(f, value);
  for (const path of [["mediaIdentity"], ["mediaIdentity", "publicMediaSha256"], ["publicOutput", "attribution"],
    ["publicOutput", "content", "media", "sha256"], ["publicOutput", "content", "disclosure", "watermark"]]) {
    const malformed = structuredClone(value); let at = malformed;
    for (const key of path.slice(0, -1)) at = at[key];
    Object.defineProperty(at, path.at(-1), { enumerable: true, get() { accesses++; throw Error("must not invoke getter"); } });
    const before = f.calls.length; await assert.rejects(f.client.commit("candidate-1", malformed), unavailable); assert.equal(f.calls.length, before);
  }
  assert.equal(accesses, 0); assert.equal(mediaReads, 0);
});

test("media commit captures identity and exact reviewed metadata before asynchronous hashing", async t => {
  const value = await mediaCandidate(), f = fixture(value.selection); await f.enable(); await prepare(f, value);
  const supplied = structuredClone(value), digest = crypto.subtle.digest.bind(crypto.subtle);
  const hashing = Promise.withResolvers(), release = Promise.withResolvers();
  t.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
  const share = { shareId: "candidate-1", expiresAt: value.publicOutput.expiresAt, active: true, token: "C".repeat(32) };
  f.json({ share, replayed: false }); const pending = f.client.commit("candidate-1", supplied); await hashing.promise;
  supplied.selection.documentId = "another-source";
  supplied.mediaIdentity.publicMediaSha256 = "f".repeat(64);
  supplied.publicOutput.title = "Changed after review";
  supplied.publicOutput.content.media.byteLength = 1;
  supplied.publicOutput.content.disclosure.watermark = "not-declared";
  supplied.candidateSha256 = "d".repeat(64);
  release.resolve(); assert.deepEqual(await pending, { share, replayed: false });
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body), { candidateId: "candidate-1",
    approval: { purpose: "selected-output-read-v1", candidateSha256: value.candidateSha256, allowPublicRead: true } });
});

test("media projector hashing cannot outlive source, capability or expiry", async t => {
  for (const operation of ["prepare", "commit"]) for (const mode of ["retire", "abort", "capability", "expiry"]) await t.test(`${operation} ${mode}`, async child => {
    const value = await mediaCandidate(), f = fixture(value.selection); await f.enable();
    if (operation === "commit") await prepare(f, value);
    let now = Date.now(); child.mock.method(Date, "now", () => now);
    const digest = crypto.subtle.digest.bind(crypto.subtle), hashing = Promise.withResolvers(), release = Promise.withResolvers();
    child.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
    const before = f.calls.length, pending = operation === "prepare" ? prepare(f, value) : f.client.commit("candidate-1", value);
    await hashing.promise;
    if (mode === "retire") f.retire(); else if (mode === "abort") f.controller.abort();
    else if (mode === "expiry") now = Date.parse(value.publicOutput.expiresAt);
    else { f.json({ creationAvailable: false }); await f.client.availability(); await f.enable(); }
    release.resolve(); await assert.rejects(pending, unavailable);
    assert.equal(f.calls.length, before + (operation === "prepare" ? 1 : 0) + (mode === "capability" ? 2 : 0));
    if (operation === "prepare" && mode === "capability") {
      const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, count);
    }
  });
});

test("availability alone enables creation; false or malformed responses close the gate while management remains usable", async () => {
  const f = fixture(), value = await candidate();
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable);
  await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, 0);
  f.json({ creationAvailable: false }); assert.equal(await f.client.availability(), false);
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, 1);
  f.json({ shares: [metadata()], nextCursor: null }); assert.deepEqual((await f.client.list()).shares, [metadata()]);
  f.json({ ok: true }); await f.client.revoke("old-share");
  for (const response of [{ creationAvailable: "true" }, { creationAvailable: true, authority: true }, {}]) {
    await f.enable(); f.json(response); await assert.rejects(f.client.availability(), unavailable);
    const count = f.calls.length; await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, count);
  }
});

test("late capability success cannot override a newer unavailable result", async () => {
  const f = fixture(), delayed = Promise.withResolvers(); f.replies.push(() => delayed.promise);
  const previous = f.client.availability(); f.json({ creationAvailable: false });
  assert.equal(await f.client.availability(), false);
  delayed.resolve(Response.json({ creationAvailable: true })); await assert.rejects(previous, unavailable);
  const count = f.calls.length; await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, count);
});

test("captured selection and origin cannot be retargeted; invalid origins and accessor requests refuse", async () => {
  const f = fixture(); f.lease.selection.documentId = "changed"; f.options.origin = "https://foreign.test";
  f.json({ shares: [], nextCursor: null }); await f.client.list();
  const url = new URL(f.calls[0].url); assert.equal(url.origin, origin); assert.equal(url.searchParams.get("documentId"), "document-1");
  for (const supplied of ["https://forma.test/path", "https://user@forma.test", "data:text/plain,x", "https://forma.test/"]) {
    assert.throws(() => createSelectedOutputShareClient(f.lease, { origin: supplied, fetcher: async () => { throw Error("never"); } }));
  }
  await f.enable(); let accesses = 0;
  await assert.rejects(f.client.prepare({ get title() { accesses++; return "Forged"; }, expiresAt: review().expiresAt }, "intent"), unavailable);
  assert.equal(accesses, 0);
});

test("stale or aborted leases refuse before transport and discard delayed responses", async () => {
  for (const mode of ["retire", "abort"]) {
    const f = fixture(); if (mode === "abort") f.controller.abort(); else f.retire();
    await assert.rejects(f.client.list(), unavailable); assert.equal(f.calls.length, 0);
    const active = fixture(), delayed = Promise.withResolvers(); active.replies.push(() => delayed.promise);
    const pending = active.client.list(); if (mode === "abort") active.controller.abort(); else active.retire();
    delayed.resolve(Response.json({ shares: [metadata()], nextCursor: null }));
    await assert.rejects(pending, unavailable); assert.equal(active.calls.length, 1);
  }
});

test("a lease change while response bytes arrive prevents parsing and cancels the body", async () => {
  const f = fixture(); let cancelled = false;
  f.replies.push(new Response(new ReadableStream({ pull(controller) {
    f.retire(); controller.enqueue(new TextEncoder().encode('{"shares":[],'));
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(f.client.list(), unavailable); assert.equal(cancelled, true);
});

test("prepare rejects forged digests, foreign selections, changed review, extra data and expired candidates", async () => {
  const original = await candidate();
  for (const mutate of [
    value => { value.candidateSha256 = "0".repeat(64); },
    value => { value.publicOutput.content.text = "Forged text"; },
    value => { value.selection.documentId = "foreign"; },
    value => { value.publicOutput.title = "Unreviewed title"; },
    value => { value.owner = "foreign"; },
    value => { value.publicOutput.content.secret = "unexpected"; },
    value => { value.sourceExpiresAt = "2000-01-01T00:00:00.000Z"; },
    value => { value.publicOutput.expiresAt = "2000-01-01T00:00:00.000Z"; },
  ]) {
    const f = fixture(); await f.enable(); const forged = structuredClone(original); mutate(forged);
    f.json({ candidateId: "candidate-1", candidate: forged, replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
    const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", original), unavailable); assert.equal(f.calls.length, count);
  }
});

test("commit requires its own prepared ID and hash, sends only explicit approval, and never recreates a lost token", async () => {
  const f = fixture(), value = await candidate(); await f.enable();
  await assert.rejects(f.client.commit("unprepared", value), unavailable); assert.equal(f.calls.length, 1);
  const prepared = await prepare(f, value);
  await assert.rejects(f.client.commit(prepared.candidateId, { ...prepared.candidate, candidateSha256: "0".repeat(64) }), unavailable);
  const before = f.calls.length;
  f.replies.push(() => { throw Error("Lost acknowledgment"); });
  await assert.rejects(f.client.commit(prepared.candidateId, prepared.candidate), /Lost acknowledgment/u);
  assert.equal(f.calls.length, before + 1, "no automatic retry or replacement intent");
  f.json({ share: { shareId: prepared.candidateId, expiresAt: value.publicOutput.expiresAt, active: true }, replayed: true });
  const replay = await f.client.commit(prepared.candidateId, prepared.candidate);
  assert.equal(Object.hasOwn(replay.share, "token"), false); assert.equal(replay.replayed, true);
  for (const sent of f.calls.slice(before)) {
    assert.equal(sent.url, base + "/commit");
    assert.deepEqual(JSON.parse(sent.init.body), { candidateId: prepared.candidateId,
      approval: { purpose: "selected-output-read-v1", candidateSha256: value.candidateSha256, allowPublicRead: true } });
  }
});

test("commit validates one-time token versus metadata-only replay and rejects changed identities", async () => {
  const f = fixture(), value = await candidate(); await f.enable(); const prepared = await prepare(f, value);
  const share = { shareId: prepared.candidateId, expiresAt: value.publicOutput.expiresAt, active: true }, token = "A".repeat(32);
  f.json({ share: { ...share, token }, replayed: false });
  assert.deepEqual(await f.client.commit(prepared.candidateId, prepared.candidate), { share: { ...share, token }, replayed: false });
  for (const body of [{ share, replayed: false }, { share: { ...share, token }, replayed: true },
    { share: { ...share, token: "https://foreign.test" }, replayed: false },
    { share: { ...share, shareId: "foreign", token }, replayed: false },
    { share: { ...share, active: false }, replayed: true }, { share, replayed: true, token }]) {
    f.json(body); await assert.rejects(f.client.commit(prepared.candidateId, prepared.candidate), unavailable);
  }
});

test("management allows expired revisions but refuses malformed pages, secrets and cursor substitution", async () => {
  const f = fixture(), row = metadata(); f.json({ shares: [row], nextCursor: null });
  const page = await f.client.list(); assert.deepEqual(page, { shares: [row], nextCursor: null });
  assert(Object.isFrozen(page) && Object.isFrozen(page.shares) && Object.isFrozen(page.shares[0]));
  const rows = Array.from({ length: 50 }, (_, index) => ({ ...row, shareId: "share-" + index }));
  f.json({ shares: rows, nextCursor: cursor("share-49") }); await f.client.list();
  f.json({ shares: [], nextCursor: null }); await f.client.list(cursor("share-49"));
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get("cursor"), cursor("share-49"));
  for (const body of [{ shares: [{ ...row, token: "secret" }], nextCursor: null },
    { shares: [row, row], nextCursor: null }, { shares: [row], nextCursor: cursor() },
    { shares: [{ ...row, issuedAt: row.expiresAt }], nextCursor: null },
    { shares: [{ ...row, revision: -1 }], nextCursor: null }, { shares: [{ ...row, output: ["scene"] }], nextCursor: null }, { shares: [{ ...row, title: "bad\n" }], nextCursor: null },
    { shares: Array(51).fill(row), nextCursor: null }, { shares: [], nextCursor: "https://foreign.test" }]) {
    f.json(body); await assert.rejects(f.client.list(), unavailable);
  }
  const before = f.calls.length;
  await assert.rejects(f.client.list("not-a-cursor"), unavailable);
  await assert.rejects(f.client.revoke("../foreign"), unavailable); assert.equal(f.calls.length, before);
  f.json({ ok: true, token: "secret" }); await assert.rejects(f.client.revoke("old-share"), unavailable);
});

test("a full valid management page fits even when maximum titles require JSON escaping", async () => {
  const f = fixture(), rows = Array.from({ length: 50 }, (_, index) => ({ ...metadata(),
    shareId: "s".repeat(157) + String(index).padStart(3, "0"), title: "\\".repeat(512), revision: Number.MAX_SAFE_INTEGER }));
  const response = { shares: rows, nextCursor: cursor(rows.at(-1).shareId) };
  assert(new TextEncoder().encode(JSON.stringify(response)).byteLength > 65536);
  f.json(response); assert.deepEqual(await f.client.list(), response);
});

test("transport rejects oversized, malformed, non-JSON, redirected and unsuccessful responses", async () => {
  for (const response of [new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "99999999" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("not JSON", { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    Response.json({ shares: [], nextCursor: null }, { status: 403 })]) {
    const f = fixture(); f.replies.push(response); await assert.rejects(f.client.list()); assert.equal(f.calls.length, 1);
  }
  const f = fixture(), redirected = Response.json({ shares: [], nextCursor: null });
  Object.defineProperty(redirected, "redirected", { value: true }); f.replies.push(redirected);
  await assert.rejects(f.client.list(), unavailable);
});

test("transport pins final URL, validates identity length and cancels early refusal bodies", async () => {
  for (const patch of [{ url: "" }, { url: "https://foreign.test/data" }, { status: 503 }]) {
    const f = fixture(); let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
    for (const [key, value] of Object.entries(patch)) Object.defineProperty(response, key, { value });
    f.replies.push(response); await assert.rejects(f.client.list(), unavailable); assert.equal(cancelled, true);
  }
  for (const encoding of [undefined, "identity", "gzip"]) {
    const f = fixture(), body = { shares: [], nextCursor: null };
    f.replies.push(Response.json(body, { headers: { "content-length": "1", ...(encoding ? { "content-encoding": encoding } : {}) } }));
    if (encoding === "gzip") assert.deepEqual(await f.client.list(), body, "encoded length does not describe decoded bytes");
    else await assert.rejects(f.client.list(), unavailable);
  }
});

test("capability refresh during candidate hashing cannot resurrect pending preparation", async t => {
  const f = fixture(), value = await candidate(); await f.enable();
  const digest = crypto.subtle.digest.bind(crypto.subtle), hashing = Promise.withResolvers(), release = Promise.withResolvers();
  t.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
  const pending = prepare(f, value); await hashing.promise;
  f.json({ creationAvailable: false }); assert.equal(await f.client.availability(), false);
  await f.enable();
  release.resolve(); await assert.rejects(pending, unavailable);
  const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, count);
});

test("expiry during asynchronous hashing prevents candidate return or approval transport", async t => {
  for (const operation of ["prepare", "commit"]) await t.test(operation, async child => {
    const f = fixture(), value = await candidate(); await f.enable();
    if (operation === "commit") await prepare(f, value);
    let now = Date.now(); child.mock.method(Date, "now", () => now);
    const digest = crypto.subtle.digest.bind(crypto.subtle), hashing = Promise.withResolvers(), release = Promise.withResolvers();
    child.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
    const count = f.calls.length;
    const pending = operation === "prepare" ? prepare(f, value) : f.client.commit("candidate-1", value);
    await hashing.promise; now = Date.parse(value.publicOutput.expiresAt); release.resolve();
    await assert.rejects(pending, unavailable);
    assert.equal(f.calls.length, count + (operation === "prepare" ? 1 : 0));
  });
});
