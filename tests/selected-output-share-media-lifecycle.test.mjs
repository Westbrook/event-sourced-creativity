import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareMediaLifecycleFixture as fixture, OWNER, EMAIL, ARTIFACT, CONTENT, PURPOSE,
  digest, retainAuthoredMedia, retainOriginalMediaRestore, finalShareRead, shareTokenWrite, sharePreparationWrite, forbidSelectedOutputShareNetwork } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";
import { selectedOutputShareFixture } from "./helpers/selected-output-share-fixture.mjs";
import { SELECTED_OUTPUT_SHARE_VIDEO_POLICY } from "../src/model/selected-output-share-video.ts";
const imports = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare, readSelectedOutputShareMediaFile, revokeSelectedOutputShare, handleSelectedOutputShareApi;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare, readSelectedOutputShareMediaFile, revokeSelectedOutputShare }
    = await import("../worker/selected-output-share-lifecycle.ts"));
  ({ handleSelectedOutputShareApi } = await import("../worker/selected-output-share-api.ts"));
} finally { imports.deregister(); }
const request = (token, suffix = "", method = "GET", signal, headers = {}) => new Request(`https://forma.test/api/selected-output-shared/${token}${suffix}`, { method, headers, ...(signal ? { signal } : {}) });
const approval = prepared => ({ candidateId: prepared.candidateId, approval: { purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } });
const readJson = (f, token) => readSelectedOutputShare(request(token), f.env, token);
const readFile = (f, token, options = {}) => readSelectedOutputShareMediaFile(request(token, "/file", options.method ?? "GET", options.signal, options.headers), f.env, token);
const count = (f, table) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const flush = () => new Promise(resolve => setImmediate(resolve));
async function prepare(f, options = {}) {
  const body = { intentKey: options.intentKey ?? "deliberate-media-review", selection: options.selection ?? f.selection(), review: options.review ?? f.review() };
  const response = await prepareSelectedOutputShare(f.request(body), f.env), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); return { body, ...result };
}
async function issue(f, options = {}) {
  const prepared = await prepare(f, options), response = await commitSelectedOutputShare(f.request(approval(prepared)), f.env), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.replayed, false);
  assert.match(result.share.token, /^[A-Za-z0-9_-]{32}$/u); return { prepared, ...result };
}
function responseHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("etag"), null); assert.equal(response.headers.get("location"), null);
}
async function refusal(response) {
  assert.equal(response.status, 404); responseHeaders(response);
  assert.deepEqual(await response.json(), { error: "selected_output_share_unavailable" });
  assert.equal(response.headers.get("content-disposition"), null);
}

// All issuance below uses detached functions in synthetic SQLite after the
// fixture installs reviewed DDL. The production dispatcher remains closed for
// prepare/commit. These are neither live shares nor new provider journeys.
for (const [output, options] of [["audio", {}], ["video", {}], ["video", { encoder: true }], ["model3d", {}], ["model3d", { textured: true }]]) {
  test(`${output} ${JSON.stringify(options)}: prepare, approve, JSON and exact file use current opaque proofs`, async t => {
    const f = await fixture(t, output, options), before = f.changes();
    const unchanged = Object.fromEntries(["events", "private_content", "document_jobs", "shares", "share_scopes", "budget_reservations", "cost_budget_reservations"].map(table => [table, count(f, table)]));
    const issued = await issue(f); assert.equal(f.shares().length, 1); assert.equal(f.changes() - before, 2);
    const row = f.shares()[0]; assert.equal(row.token_hash, digest(`${PURPOSE}\0${issued.share.token}`));
    assert.equal(JSON.stringify(row).includes(issued.share.token), false);
    assert.doesNotMatch(JSON.stringify(row), /Private|lyrics|prompt|original\.(?:wav|mp4|glb)|\/api\/media\//u);
    assert.equal(issued.prepared.candidate.publicOutput.title, "Reviewed media output");
    assert.equal(issued.prepared.candidate.mediaIdentity.sourceMediaSha256, digest(f.currentBytes));
    assert.equal(issued.prepared.candidate.mediaIdentity.publicMediaSha256, digest(f.currentBytes));
    const json = await readJson(f, issued.share.token); assert.equal(json.status, 200); responseHeaders(json);
    const publicOutput = await json.json(); assert.deepEqual(publicOutput, issued.prepared.candidate.publicOutput);
    const serialized = JSON.stringify(publicOutput);
    for (const privateValue of [OWNER, EMAIL, ARTIFACT, CONTENT, f.url, f.key, "Private", "selection", "candidateSha256", "inputRef", "sourceMediaSha256", "qualificationPolicy", "projectionPolicy"])
      assert.equal(serialized.includes(privateValue), false, privateValue);
    const file = await handleSelectedOutputShareApi(request(issued.share.token, "/file", "GET", undefined, { range: "bytes=0-1" }), f.env);
    assert.equal(file.status, 200); responseHeaders(file); assert.equal(file.headers.get("content-type"), f.mimeType);
    assert.equal(file.headers.get("content-length"), String(f.currentBytes.length)); assert.equal(file.headers.get("content-range"), null);
    assert.equal(file.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(file.headers.get("content-disposition"), `attachment; filename="${output === "audio" ? "forma-audio.wav" : output === "video" ? "forma-video.mp4" : "forma-3d.glb"}"`);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), f.currentBytes);
    assert.deepEqual(f.mediaCalls, [f.key, f.key, f.key, f.key], "one exact owned file per fresh operation; no redirect or companion read");
    assert.equal(f.writes.filter(write => sharePreparationWrite(write.sql)).length, 1);
    assert.equal(f.writes.filter(write => shareTokenWrite(write.sql)).length, 1);
    assert.equal(f.changes() - before, 2); for (const [table, n] of Object.entries(unchanged)) assert.equal(count(f, table), n);
  });
}

test("creation remains closed in the API despite installed schema, a valid media principal and an approved candidate", async t => {
  const f = await fixture(t), before = f.changes(), prepared = await prepare(f), after = f.changes();
  assert.equal(after - before, 1);
  for (const [path, body] of [["prepare", prepared.body], ["commit", approval(prepared)]]) {
    const command = new Request(`https://forma.test/api/selected-output-shares/${path}`, f.request(body));
    const response = await handleSelectedOutputShareApi(command, f.env);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "selected_output_share_creation_unavailable" });
  }
  const availability = await handleSelectedOutputShareApi(new Request("https://forma.test/api/selected-output-shares/availability"), f.env);
  assert.deepEqual(await availability.json(), { creationAvailable: false }); assert.equal(f.changes(), after); assert.equal(f.shares()[0].token_hash, null);
});
test("preparation replay preserves reviewed identity; approval replay never rotates or rediscloses a token", async t => {
  const f = await fixture(t), prepared = await prepare(f), afterPrepare = f.changes();
  const replayResponse = await prepareSelectedOutputShare(f.request(prepared.body), f.env), replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.candidateId, prepared.candidateId);
  assert.deepEqual(replay.candidate, prepared.candidate); assert.equal(f.changes(), afterPrepare);
  const changed = await prepareSelectedOutputShare(f.request({ ...prepared.body, review: { ...prepared.body.review, title: "Unreviewed replacement" } }), f.env);
  await refusal(changed); assert.equal(f.changes(), afterPrepare);
  const issued = await commitSelectedOutputShare(f.request(approval(prepared)), f.env), initial = await issued.json(); assert.equal(issued.status, 200);
  const stored = { ...f.shares()[0] }, afterIssue = f.changes();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await commitSelectedOutputShare(f.request(approval(prepared)), f.env); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { share: { shareId: initial.share.shareId, expiresAt: initial.share.expiresAt, active: true }, replayed: true });
  }
  assert.deepEqual({ ...f.shares()[0] }, stored); assert.equal(f.changes(), afterIssue);
  assert.equal((await readFile(f, initial.share.token)).status, 200);
});
test("simultaneous approvals consume one media preparation and expose one secret", async t => {
  const f = await fixture(t, "video"), prepared = await prepare(f), before = f.changes();
  const responses = await Promise.all([1, 2].map(() => commitSelectedOutputShare(f.request(approval(prepared)), f.env)));
  const results = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(results.filter(result => result.share.token).length, 1); assert.equal(f.shares().length, 1); assert.equal(f.changes() - before, 1);
});
test("reviewed public hash, profile and projection cannot be substituted at approval", async t => {
  const f = await fixture(t, "video", { encoder: true }), prepared = await prepare(f), baseline = f.changes();
  for (const body of [
    { ...approval(prepared), approval: { ...approval(prepared).approval, candidateSha256: digest(JSON.stringify({ ...prepared.candidate.publicOutput, title: "Replacement" })) } },
    { ...approval(prepared), approval: { ...approval(prepared).approval, publicMediaSha256: "a".repeat(64) } },
    { ...approval(prepared), selection: { ...prepared.body.selection, policy: SELECTED_OUTPUT_SHARE_VIDEO_POLICY } },
    { ...approval(prepared), candidate: { ...prepared.candidate, mediaIdentity: { ...prepared.candidate.mediaIdentity, publicMediaSha256: "a".repeat(64) } } },
    { ...approval(prepared), approval: { ...approval(prepared).approval, projectionPolicy: "selected-output-share-glb-current-view-v1" } },
  ]) assert.equal((await commitSelectedOutputShare(f.request(body), f.env)).status, 400);
  assert.equal(f.changes(), baseline); assert.equal(f.shares()[0].token_hash, null);
  for (const [patch, status] of [[{ mediaSha256: "f".repeat(64) }, 404], [{ contentSha256: "f".repeat(64) }, 404],
    [{ revision: 1 }, 404], [{ policy: SELECTED_OUTPUT_SHARE_VIDEO_POLICY }, 404], [{ projectionPolicy: "selected-output-share-glb-current-view-v1" }, 400]]) {
    const response = await prepareSelectedOutputShare(f.request({ ...prepared.body, intentKey: "replaced-profile", selection: { ...prepared.body.selection, ...patch } }), f.env);
    assert.equal(response.status, status); assert.equal(f.changes(), baseline);
  }
});

test("file route accepts GET only and cannot recover files from native URLs, bad token shapes or extra paths", async t => {
  const f = await fixture(t), issued = await issue(f), baseline = f.changes(), priorReads = f.mediaCalls.length;
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await handleSelectedOutputShareApi(request(issued.share.token, "/file", method), f.env);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET");
  }
  for (const suffix of ["/file?source=" + encodeURIComponent(f.url), "/file/extra", "/file/", "/original", "/file#download"]) await refusal(await handleSelectedOutputShareApi(request(issued.share.token, suffix), f.env));
  for (const token of ["", "x".repeat(31), "x".repeat(33), issued.prepared.candidate.candidateSha256, "z".repeat(32), f.url]) await refusal(await readFile(f, token));
  assert.equal(f.mediaCalls.length, priorReads); assert.equal(f.changes(), baseline);
});
test("an accepted text share retains JSON delivery but never acquires a file endpoint", async t => {
  forbidSelectedOutputShareNetwork(t);
  const f = await selectedOutputShareFixture(t), prepared = await prepare(f), response = await commitSelectedOutputShare(f.request(approval(prepared)), f.env);
  assert.equal(response.status, 200); const issued = await response.json();
  assert.equal((await readJson(f, issued.share.token)).status, 200); await refusal(await readFile(f, issued.share.token));
});
test("revocation is idempotent and remains available after source retirement and creator-consent loss", async t => {
  const f = await fixture(t), issued = await issue(f);
  f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
  f.sqlite.prepare("UPDATE users SET role='viewer',consent_version='withdrawn' WHERE user_id=?").run(OWNER);
  const response = await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId); assert.equal(response.status, 200);
  const revoked = f.shares()[0].revoked_at, baseline = f.changes(); assert.ok(revoked);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  assert.equal(f.shares()[0].revoked_at, revoked); assert.equal(f.changes(), baseline);
  await refusal(await readJson(f, issued.share.token)); await refusal(await readFile(f, issued.share.token));
});
for (const phase of ["issue", "JSON", "file"]) test(`${phase}: the last SQL joins source, principal and token custody`, async t => {
  for (const fault of ["redaction", "revision", "role", "job-expiry", "revocation"]) await t.test(fault, async child => {
    const f = await fixture(child), issued = phase === "issue" ? { prepared: await prepare(f) } : await issue(f);
    let entered = false;
    f.setBeforeStatement(async sql => {
      if (!(phase === "issue" ? shareTokenWrite(sql) : finalShareRead(sql))) return;
      entered = true; f.setBeforeStatement(null);
      if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
      if (fault === "revision") { f.replace({ ...JSON.parse(f.raw()), title: "Unapproved edit" });
        await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER }); }
      if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      if (fault === "job-expiry") f.updateJob({ expires_at: "2000-01-01T00:00:00.000Z" });
      if (fault === "revocation") assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, phase === "issue" ? issued.prepared.candidateId : issued.share.shareId)).status, 200);
    });
    const response = phase === "issue" ? await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)
      : phase === "JSON" ? await readJson(f, issued.share.token) : await readFile(f, issued.share.token);
    await refusal(response); assert.ok(entered, "must reach the intended final write/read race");
    if (phase === "issue") assert.equal(f.shares()[0].token_hash, null);
  });
});
for (const fault of ["payer", "sponsor", "provider"]) test(`late ${fault} provenance change refuses file bytes`, async t => {
  const f = await fixture(t, "audio", { slot: true }), issued = await issue(f); let entered = false;
  f.setBeforeStatement(sql => {
    if (!finalShareRead(sql)) return; entered = true; f.setBeforeStatement(null);
    if (fault === "payer") f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='other' WHERE grant_id=?").run(f.slot.grantId);
    if (fault === "provider") f.sqlite.prepare("UPDATE output_operation_slots SET provider='other' WHERE slot_id=?").run(f.slot.slotId);
    if (fault === "sponsor") f.updateJob({ request_json: JSON.stringify({ ...JSON.parse(f.job().request_json), sponsor_entitlement: { id: "synthetic-sponsor" } }) });
  });
  await refusal(await readFile(f, issued.share.token)); assert.ok(entered);
});
for (const fault of ["missing", "foreign-owner", "bad-hash", "bad-stream", "source-retired-during-get"]) test(`selected file ${fault} refuses before any body`, async t => {
  const f = await fixture(t), issued = await issue(f), before = f.changes();
  if (fault === "missing") f.media.delete(f.key);
  if (fault === "foreign-owner") f.media.get(f.key).metadata.ownerId = "other";
  if (fault === "bad-hash") f.media.get(f.key).bytes[50] ^= 1;
  if (fault === "bad-stream") { const get = f.env.MEDIA.get.bind(f.env.MEDIA); f.env.MEDIA.get = async key => ({ ...await get(key), body: new ReadableStream({ start(controller) { controller.error(new Error("synthetic-stream-failure")); } }) }); }
  if (fault === "source-retired-during-get") f.setBeforeMediaGet(() => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT));
  await refusal(await readFile(f, issued.share.token));
  assert.equal(f.changes() - before, fault === "source-retired-during-get" ? 1 : 0);
});
for (const output of ["audio", "video", "model3d"]) test(`current ${output} edits and restores require fresh review; scaled GLB remains unsupported`, async t => {
  const f = await fixture(t, output, { editable: output === "video" }), original = await issue(f), edited = await retainAuthoredMedia(f);
  await refusal(await readFile(f, original.share.token));
  const chosen = { ...edited.selection, projectionPolicy: original.prepared.body.selection.projectionPolicy };
  let derivative;
  if (output === "model3d") {
    assert.equal((await f.readNative(edited.selection)).status, 200);
    await refusal(await prepareSelectedOutputShare(f.request({ intentKey: "scaled-current", selection: chosen, review: f.review() }), f.env));
    assert.equal(f.shares().length, 1, "unsupported unused GLB data cannot create a prepared share");
  } else {
    derivative = await issue(f, { intentKey: "edited-current", selection: chosen });
    const file = await readFile(f, derivative.share.token); assert.equal(file.status, 200); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), edited.bytes);
  }
  const restored = await retainOriginalMediaRestore(f);
  if (derivative) await refusal(await readFile(f, derivative.share.token));
  const fresh = await issue(f, { intentKey: "restored-current", selection: { ...restored.selection, projectionPolicy: chosen.projectionPolicy } });
  const file = await readFile(f, fresh.share.token); assert.equal(file.status, 200); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), f.originalBytes);
  await refusal(await readFile(f, original.share.token));
});

for (const phase of ["schema", "token", "final SQL"]) test(`whole file-operation deadline bounds a stalled ${phase} read`, async t => {
  const f = await fixture(t), issued = await issue(f); let reached = false;
  f.setBeforeStatement(sql => {
    if (phase === "schema" && sql.startsWith("SELECT CASE WHEN") || phase === "token" && sql.includes("JOIN users owner") || phase === "final SQL" && finalShareRead(sql)) {
      reached = true; return new Promise(() => {});
    }
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = readFile(f, issued.share.token);
  for (let i = 0; i < 60 && !reached; i++) await flush(); assert.ok(reached, "exact pending phase must be reached before clock advances");
  t.mock.timers.tick(30_000); await refusal(await pending);
});
for (const phase of ["schema", "R2 stream", "final SQL"]) test(`request abort promptly ends stalled ${phase} without a replacement identity`, async t => {
  const f = await fixture(t), issued = await issue(f), controller = new AbortController(); let reached = false, cancelled = 0;
  if (phase === "R2 stream") {
    const get = f.env.MEDIA.get.bind(f.env.MEDIA);
    f.env.MEDIA.get = async key => ({ ...await get(key), body: new ReadableStream({ pull() { reached = true; return new Promise(() => {}); }, cancel() { cancelled++; return new Promise(() => {}); } }) });
  } else f.setBeforeStatement(sql => { if (phase === "schema" ? sql.startsWith("SELECT CASE WHEN") : finalShareRead(sql)) { reached = true; return new Promise(() => {}); } });
  const pending = readFile(f, issued.share.token, { signal: controller.signal });
  for (let i = 0; i < 60 && !reached; i++) await flush(); assert.ok(reached); controller.abort();
  await refusal(await pending); if (phase === "R2 stream") { await flush(); assert.equal(cancelled, 1); }
});

for (const output of ["audio", "video", "model3d"]) for (const phase of ["issue", "JSON", "file"])
  test(`${output} ${phase}: final-await storage replacement cannot disclose approval or media`, async t => {
    const f = await fixture(t, output), issued = phase === "issue" ? { prepared: await prepare(f) } : await issue(f);
    const originalMedia = f.env.MEDIA; let reached = false;
    const hook = sql => {
      if (!(phase === "issue" ? shareTokenWrite(sql) : finalShareRead(sql))) return;
      reached = true; f.setAfterStatement(null); f.setBeforeStatement(null); f.env.MEDIA = { ...f.env.MEDIA };
    };
    if (phase === "issue") f.setAfterStatement(hook); else f.setBeforeStatement(hook);
    const response = phase === "issue" ? await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)
      : phase === "JSON" ? await readJson(f, issued.share.token) : await readFile(f, issued.share.token);
    await refusal(response); assert.ok(reached, "must cross the intended last SQL boundary");
    if (phase === "issue") {
      assert.ok(f.shares()[0].token_hash, "the completed conditional UPDATE is preserved, but no secret was returned");
      const before = f.changes(); f.env.MEDIA = originalMedia;
      const replay = await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env); assert.equal(replay.status, 200);
      const body = await replay.json(); assert.equal(body.replayed, true); assert.equal(Object.hasOwn(body.share, "token"), false); assert.equal(f.changes(), before);
    }
  });
for (const phase of ["issue", "JSON", "file"]) test(`GLB ${phase}: rights expiry crossing the final SQL await refuses disclosure`, async t => {
  const f = await fixture(t, "model3d"), issued = phase === "issue" ? { prepared: await prepare(f) } : await issue(f);
  const deadline = Date.now() + 1000; f.media.get(f.key).metadata.rights_expires_at = new Date(deadline).toISOString();
  let reached = false;
  const hook = async sql => {
    if (!(phase === "issue" ? shareTokenWrite(sql) : finalShareRead(sql))) return;
    reached = true; f.setAfterStatement(null); f.setBeforeStatement(null);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 20)));
  };
  if (phase === "issue") f.setAfterStatement(hook); else f.setBeforeStatement(hook);
  const response = phase === "issue" ? await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)
    : phase === "JSON" ? await readJson(f, issued.share.token) : await readFile(f, issued.share.token);
  await refusal(response); assert.ok(reached); assert.ok(Date.now() >= deadline);
});
