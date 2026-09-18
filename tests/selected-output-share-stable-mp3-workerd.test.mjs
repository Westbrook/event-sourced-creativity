import assert from "node:assert/strict";
import test from "node:test";
import { selectedOutputShareStableMp3Fixture, OWNER, EMAIL, DOCUMENT, ARTIFACT, INPUT, PURPOSE, digest,
  STEREO_MP3_SHA256, STEREO_WAV_SHA256 } from "./helpers/selected-output-share-stable-mp3-fixture.mjs";
import { localCompiledMp3Lifecycle } from "./helpers/audio-share-mp3-lifecycle-workerd.mjs";

const ownerHeaders = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const command = body => ({ method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" }, body: JSON.stringify(body) });
const approval = prepared => ({ candidateId: prepared.candidateId,
  approval: { purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } });
const privacyHeaders = response => {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("etag"), null); assert.equal(response.headers.get("location"), null);
};
async function result(response, status = 200) {
  const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); privacyHeaders(response); return body;
}
async function file(response) {
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text()); privacyHeaders(response);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  // Workerd normalizes Content-Length away for a bounded streaming Response.
  // Direct Node checks assert the source-declared header; this transport check
  // always enforces complete length and digest after consuming the body.
  assert.ok(response.headers.get("content-length") === null || response.headers.get("content-length") === "3528044");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("content-range"), null);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.byteLength, 3_528_044); assert.equal(digest(bytes), STEREO_WAV_SHA256);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), "WAVE");
  assert.equal(Buffer.from(bytes).includes(Buffer.from("SYNTHETIC_PRIVATE_TITLE")), false);
  return bytes;
}

test("compiled production lifecycle + static WASM on one real D1/R2 donor: exact prepared WAV, replay, issue, listing, public file and revoke", { timeout: 120_000 }, async t => {
  const f = await selectedOutputShareStableMp3Fixture(t, { trapNetwork: false }), seed = f.mediaSeed();
  const runtime = await localCompiledMp3Lifecycle(t, { snapshot: f.snapshot(), source: {
    key: seed.key, bytes: seed.bytes, customMetadata: seed.metadata, httpMetadata: { contentType: seed.contentType },
  } });
  const body = { intentKey: "compiled-stable-audio-intent", selection: f.selection(), review: f.review() };
  assert.deepEqual(await result(await runtime.dispatch("/api/selected-output-shares/availability")), { creationAvailable: false });
  assert.deepEqual(await result(await runtime.dispatch("/api/selected-output-shares/prepare", command(body)), 503),
    { error: "selected_output_share_creation_unavailable" });
  const prepared = await result(await runtime.dispatch("/__synthetic__/prepare", command(body)));
  assert.equal(prepared.replayed, false);
  assert.equal(prepared.candidate.mediaIdentity.sourceMediaSha256, STEREO_MP3_SHA256);
  assert.equal(prepared.candidate.mediaIdentity.publicMediaSha256, STEREO_WAV_SHA256);
  assert.notEqual(prepared.candidate.mediaIdentity.sourceMediaSha256, prepared.candidate.mediaIdentity.publicMediaSha256);
  const replay = await result(await runtime.dispatch("/__synthetic__/prepare", command(body)));
  assert.equal(replay.replayed, true); assert.equal(replay.candidateId, prepared.candidateId); assert.deepEqual(replay.candidate, prepared.candidate);
  const sameOriginHeaders = { ...ownerHeaders, "sec-fetch-site": "same-origin", origin: runtime.origin };
  const preparedPath = "/__synthetic__/prepared/" + prepared.candidateId;
  assert.deepEqual(await result(await runtime.dispatch(`/api/selected-output-shares/${prepared.candidateId}/file`, { headers: sameOriginHeaders }), 503),
    { error: "selected_output_share_creation_unavailable" });
  for (const site of [undefined, "none", "same-site", "cross-site"]) {
    const headers = { ...ownerHeaders, origin: runtime.origin, ...(site ? { "sec-fetch-site": site } : {}) };
    await result(await runtime.dispatch(preparedPath, { headers }), 403);
  }
  await result(await runtime.dispatch(preparedPath, { headers: { ...sameOriginHeaders, origin: "https://other.invalid" } }), 403);
  await result(await runtime.dispatch(preparedPath, { headers: { "sec-fetch-site": "same-origin", origin: runtime.origin } }), 401);
  const preparedBytes = await file(await runtime.dispatch(preparedPath, { headers: sameOriginHeaders }));
  // Test setup changes the actual retained input after review. The production
  // prepared/read and commit paths must observe that same live D1 state; no
  // canned query result, identity, recipe, byte proof or decoder is substituted.
  const retainedInput = await runtime.DB.prepare("SELECT content FROM private_content WHERE content_id=?").bind(INPUT).first();
  try {
    await runtime.DB.prepare("UPDATE private_content SET content=json_set(content,'$.request.audio_profile.durationSeconds',19) WHERE content_id=?").bind(INPUT).run();
    await result(await runtime.dispatch(preparedPath, { headers: sameOriginHeaders }), 404);
    await result(await runtime.dispatch("/__synthetic__/commit", command(approval(prepared))), 404);
    assert.equal((await runtime.DB.prepare("SELECT token_hash FROM selected_output_shares WHERE share_id=?").bind(prepared.candidateId).first()).token_hash, null);
  } finally {
    await runtime.DB.prepare("UPDATE private_content SET content=? WHERE content_id=?").bind(retainedInput.content, INPUT).run();
  }
  assert.deepEqual(await file(await runtime.dispatch(preparedPath, { headers: sameOriginHeaders })), preparedBytes,
    "Refusal releases local operation state; a fresh valid observation remains usable");
  assert.deepEqual(await result(await runtime.dispatch("/api/selected-output-shares/commit", command(approval(prepared))), 503),
    { error: "selected_output_share_creation_unavailable" });
  const issued = await result(await runtime.dispatch("/__synthetic__/commit", command(approval(prepared))));
  assert.equal(issued.replayed, false); assert.match(issued.share.token, /^[A-Za-z0-9_-]{32}$/u);
  const issueReplay = await result(await runtime.dispatch("/__synthetic__/commit", command(approval(prepared))));
  assert.deepEqual(issueReplay, { share: { shareId: issued.share.shareId, expiresAt: issued.share.expiresAt, active: true }, replayed: true });
  await result(await runtime.dispatch(preparedPath, { headers: sameOriginHeaders }), 404);
  const listing = await result(await runtime.dispatch(`/api/selected-output-shares?documentId=${DOCUMENT}&artifactId=${ARTIFACT}`, { headers: ownerHeaders }));
  assert.equal(listing.nextCursor, null); assert.equal(listing.shares.length, 1);
  assert.equal(listing.shares[0].shareId, issued.share.shareId); assert.equal(listing.shares[0].output, "audio");
  assert.doesNotMatch(JSON.stringify(listing), /candidateSha256|mediaSha256|projectionPolicy|sourceProfile|token|\/api\/media\//u);
  const publicPath = "/api/selected-output-shared/" + issued.share.token;
  const publicOutput = await result(await runtime.dispatch(publicPath));
  assert.deepEqual(publicOutput, prepared.candidate.publicOutput);
  for (const privateValue of [OWNER, EMAIL, ARTIFACT, DOCUMENT, seed.key, f.url, "Synthetic private", "candidateSha256", "sourceMediaSha256", "sourceProfile"])
    assert.equal(JSON.stringify(publicOutput).includes(privateValue), false, privateValue);
  const publicBytes = await file(await runtime.dispatch(publicPath + "/file", { headers: { range: "bytes=0-1" } }));
  assert.deepEqual(publicBytes, preparedBytes);
  const stored = (await runtime.DB.prepare("SELECT * FROM selected_output_shares").all()).results;
  assert.equal(stored.length, 1); assert.equal(stored[0].token_hash, digest(`${PURPOSE}\0${issued.share.token}`));
  assert.equal(JSON.stringify(stored).includes(issued.share.token), false);
  await runtime.assertUnchangedNative(); await runtime.assertUnchangedMedia();
  assert.deepEqual(await result(await runtime.dispatch(`/api/selected-output-shares/${issued.share.shareId}`, { method: "DELETE", headers: ownerHeaders })), { ok: true });
  await result(await runtime.dispatch(publicPath + "/file"), 404);
  assert.deepEqual(runtime.egress, []);
  assert.equal(runtime.build.evidence.staticWorkerModule, true); assert.equal(runtime.build.evidence.clientDecoderAbsent, true);
  t.diagnostic(JSON.stringify({ status: "passed", donor: "checked-in synthetic stereo20", sourceSha256: STEREO_MP3_SHA256,
    publicSha256: STEREO_WAV_SHA256, publicBytes: publicBytes.length, singleD1: true, actualR2: true,
    ...runtime.build.evidence, requests: runtime.requests }));
});
