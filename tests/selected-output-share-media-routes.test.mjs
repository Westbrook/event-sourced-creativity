import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareMediaLifecycleFixture, forbidSelectedOutputShareNetwork, finalShareRead, CONTENT, digest } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";
import { selectedOutputShareFixture } from "./helpers/selected-output-share-fixture.mjs";

const imports = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
} finally { imports.deregister(); }

// Direct source functions prepare synthetic shares because creation remains
// closed in the actual built dispatcher. Every recipient request below goes
// through that built Worker; these are not live shares or provider journeys.
async function issue(f) {
  const preparation = await prepareSelectedOutputShare(f.request({ intentKey: "synthetic-media-route-review", selection: f.selection(), review: f.review() }), f.env);
  const prepared = await preparation.json(); assert.equal(preparation.status, 200, JSON.stringify(prepared));
  const response = await commitSelectedOutputShare(f.request({ candidateId: prepared.candidateId,
    approval: { purpose: prepared.candidate.purpose, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
  const issued = await response.json(); assert.equal(response.status, 200, JSON.stringify(issued)); assert.equal(issued.replayed, false);
  return { prepared, share: issued.share };
}
function dispatcher(t, f) {
  let assets = 0, background = 0;
  f.env.ASSETS = { fetch() { assets++; throw new Error("Selected media routes may not fall back to assets"); } };
  const context = { waitUntil() { background++; throw new Error("Selected media routes may not schedule background work"); } };
  t.after(() => { assert.equal(assets, 0, "Caught asset fallback attempts still fail"); assert.equal(background, 0, "Caught background attempts still fail"); });
  return (path, options = {}) => worker.fetch(new Request("https://forma.invalid" + path, options), f.env, context);
}
function safeHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("location"), null); assert.equal(response.headers.get("etag"), null);
}
async function unavailable(response) {
  assert.equal(response.status, 404); safeHeaders(response);
  assert.deepEqual(await response.json(), { error: "selected_output_share_unavailable" });
  assert.equal(response.headers.get("content-disposition"), null);
}

for (const output of ["audio", "video", "model3d"]) test(`built ${output} dispatcher returns the reviewed JSON and exact selected file`, async t => {
  const f = await selectedOutputShareMediaLifecycleFixture(t, output), fetchRoute = dispatcher(t, f), issued = await issue(f);
  const before = f.changes(), reads = f.mediaCalls.length, writes = f.writes.length;
  const path = "/api/selected-output-shared/" + issued.share.token;
  const json = await fetchRoute(path); assert.equal(json.status, 200); safeHeaders(json);
  assert.deepEqual(await json.json(), issued.prepared.candidate.publicOutput);
  const file = await fetchRoute(path + "/file", { headers: { range: "bytes=0-1" } }); assert.equal(file.status, 200); safeHeaders(file);
  assert.equal(file.headers.get("content-type"), f.mimeType); assert.equal(file.headers.get("content-length"), String(f.currentBytes.length));
  assert.equal(file.headers.get("content-range"), null); assert.equal(file.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(file.headers.get("content-disposition"), `attachment; filename="${output === "audio" ? "forma-audio.wav" : output === "video" ? "forma-video.mp4" : "forma-3d.glb"}"`);
  const bytes = new Uint8Array(await file.arrayBuffer()); assert.deepEqual(bytes, f.currentBytes);
  assert.equal(digest(bytes), issued.prepared.candidate.mediaIdentity.publicMediaSha256);
  assert.deepEqual(f.mediaCalls.slice(reads), [f.key, f.key], "each public operation reads only its selected retained file");
  assert.equal(f.changes(), before); assert.equal(f.writes.length, writes);
});

test("built media routes reject unknown tokens, query, method and extra paths without fallback or creation", async t => {
  const f = await selectedOutputShareMediaLifecycleFixture(t), fetchRoute = dispatcher(t, f), issued = await issue(f);
  const before = f.changes(), reads = f.mediaCalls.length, statements = f.statements.length;
  const path = "/api/selected-output-shared/" + issued.share.token;
  for (const suffix of ["?source=private", "/file?source=private", "/file/extra", "/file/", "/original"]) await unavailable(await fetchRoute(path + suffix));
  for (const suffix of ["", "/file"]) for (const method of ["HEAD", "POST", "OPTIONS"]) {
    const response = await fetchRoute(path + suffix, { method }); assert.equal(response.status, 405); safeHeaders(response);
    assert.equal(response.headers.get("allow"), "GET"); assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  const availability = await fetchRoute("/api/selected-output-shares/availability"); assert.equal(availability.status, 200);
  assert.deepEqual(await availability.json(), { creationAvailable: false });
  for (const operation of ["prepare", "commit"]) {
    const response = await fetchRoute("/api/selected-output-shares/" + operation, { method: "POST", body: "{}" });
    assert.equal(response.status, 503); safeHeaders(response); assert.deepEqual(await response.json(), { error: "selected_output_share_creation_unavailable" });
  }
  assert.equal(f.statements.length, statements, "finite route refusal and closed creation do not reach SQL");
  const unknown = issued.share.token[0] === "z" ? "a".repeat(32) : "z".repeat(32);
  await unavailable(await fetchRoute("/api/selected-output-shared/" + unknown));
  await unavailable(await fetchRoute("/api/selected-output-shared/" + unknown + "/file"));
  assert.equal(f.changes(), before); assert.equal(f.mediaCalls.length, reads);
});

test("built file dispatcher does not reinterpret an accepted text share as media", async t => {
  forbidSelectedOutputShareNetwork(t);
  const f = await selectedOutputShareFixture(t), fetchRoute = dispatcher(t, f), issued = await issue(f);
  let mediaAttempts = 0;
  f.env.MEDIA = new Proxy({}, { get() { mediaAttempts++; throw new Error("Text share must not retrieve media"); } });
  t.after(() => assert.equal(mediaAttempts, 0, "Caught text-to-media attempts still fail"));
  const before = f.changes(), path = "/api/selected-output-shared/" + issued.share.token;
  const json = await fetchRoute(path); assert.equal(json.status, 200); safeHeaders(json);
  assert.deepEqual(await json.json(), issued.prepared.candidate.publicOutput);
  await unavailable(await fetchRoute(path + "/file")); assert.equal(f.changes(), before);
});

test("built media file route rechecks source custody at its final SQL before releasing bytes", async t => {
  const f = await selectedOutputShareMediaLifecycleFixture(t), fetchRoute = dispatcher(t, f), issued = await issue(f);
  const before = f.changes(); let reached = false;
  f.setBeforeStatement(sql => {
    if (!finalShareRead(sql)) return;
    reached = true; f.setBeforeStatement(null);
    f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
  });
  const path = "/api/selected-output-shared/" + issued.share.token;
  await unavailable(await fetchRoute(path + "/file")); assert.ok(reached, "built final SQL reached the source withdrawal hook");
  await unavailable(await fetchRoute(path)); assert.equal(f.changes(), before + 1, "only the synthetic source withdrawal changes state");
});
