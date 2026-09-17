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
  return { client, calls, replies, controller, lease, options, retire() { current = false; },
    json(value) { replies.push(Response.json(value)); },
    async enable() { replies.push(Response.json({ creationAvailable: true })); assert.equal(await client.availability(), true); },
  };
}
async function prepare(f, value) {
  value ??= await candidate();
  f.json({ candidateId: "candidate-1", candidate: value, replayed: false });
  return f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-1");
}

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
