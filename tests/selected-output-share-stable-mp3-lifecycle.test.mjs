import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { registerAudioShareNodeWasm } from "./helpers/audio-share-node-wasm.mjs";
import { selectedOutputShareStableMp3Fixture as fixture, OWNER, EMAIL, DOCUMENT, ARTIFACT, CONTENT, INPUT, JOB, PURPOSE,
  digest, STEREO_MP3_SHA256, STEREO_WAV_SHA256 } from "./helpers/selected-output-share-stable-mp3-fixture.mjs";
import { qualifyCapturedSql } from "./helpers/selected-output-share-d1-qualification.mjs";
const imports = registerOutputSourceImports(), wasm = registerAudioShareNodeWasm();
after(() => { wasm.deregister(); imports.deregister(); });
let lifecycle, listSelectedOutputShares, handleSelectedOutputShareApi, parseAudioMediaRevision, SPONSOR_ENTITLEMENT_SCHEMA, SPONSOR_INTAKE_SCHEMA;
try {
  lifecycle = await import("../worker/selected-output-share-lifecycle.ts");
  ({ listSelectedOutputShares } = await import("../worker/selected-output-share-management.ts"));
  ({ handleSelectedOutputShareApi } = await import("../worker/selected-output-share-api.ts"));
  ({ parseAudioMediaRevision } = await import("../src/model/document-artifacts.ts"));
  ({ SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts"));
  ({ SPONSOR_INTAKE_SCHEMA } = await import("../worker/experience-sponsor-intake.ts"));
} catch (error) { wasm.deregister(); imports.deregister(); throw error; }
const approve = prepared => ({ candidateId: prepared.candidateId,
  approval: { purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } });
const finalRead = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" SELECT 1 AS permitted WHERE") && sql.includes("selected_output_shares");
const tokenWrite = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" UPDATE selected_output_shares SET token_hash=");
const preparationWrite = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" INSERT INTO selected_output_shares(");
const publicRequest = (token, file = true, options = {}) => new Request(`https://forma.test/api/selected-output-shared/${token}${file ? "/file" : ""}`, options);
const preparedRequest = (f, candidateId, headers = {}, signal) => f.request(undefined,
  { "sec-fetch-site": "same-origin", origin: "https://forma.test", ...headers }, "GET", signal, `/api/selected-output-shares/${candidateId}/file`);
async function json(response, status = 200) {
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
async function prepare(f, { intent = "synthetic-mp3-review", selection = f.selection(), review = f.review() } = {}) {
  const body = { intentKey: intent, selection, review };
  const value = await json(await lifecycle.prepareSelectedOutputShare(f.request(body), f.env));
  return { ...value, body };
}
async function issue(f, options) {
  const prepared = await prepare(f, options);
  return { ...await json(await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env)), prepared };
}
const preparedFile = (f, prepared, request = preparedRequest(f, prepared.candidateId)) =>
  lifecycle.readPreparedSelectedOutputShareMediaFile(request, f.env, prepared.candidateId);
const publicFile = (f, issued, request = publicRequest(issued.share.token)) => lifecycle.readSelectedOutputShareMediaFile(request, f.env, issued.share.token);
async function verifyFile(response) {
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  assert.equal(response.headers.get("content-type"), "audio/wav"); assert.equal(response.headers.get("content-length"), "3528044");
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(digest(bytes), STEREO_WAV_SHA256);
  assert.equal(bytes.length, 3_528_044); assert.equal(Buffer.from(bytes).includes(Buffer.from("SYNTHETIC_PRIVATE_TITLE")), false);
  return bytes;
}
async function refused(response, status = 404) {
  assert.equal(response.status, status); assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const text = await response.text(); assert.doesNotMatch(text, /RIFF|SYNTHETIC_PRIVATE_TITLE|\/api\/media\//u); return text;
}

test("actual native MP3 lifecycle keeps source and public identities separate through prepare/replay/preview/commit/list/read", async t => {
  const f = await fixture(t), before = f.changes(), nativeBefore = f.nativeSnapshot(), prepared = await prepare(f);
  assert.equal(prepared.candidate.mediaIdentity.sourceMediaSha256, STEREO_MP3_SHA256);
  assert.equal(prepared.candidate.mediaIdentity.publicMediaSha256, STEREO_WAV_SHA256);
  assert.notEqual(prepared.candidate.mediaIdentity.sourceMediaSha256, prepared.candidate.mediaIdentity.publicMediaSha256);
  const replay = await json(await lifecycle.prepareSelectedOutputShare(f.request(prepared.body), f.env));
  assert.equal(replay.replayed, true); assert.equal(replay.candidateId, prepared.candidateId); assert.deepEqual(replay.candidate, prepared.candidate);
  const preview = await verifyFile(await preparedFile(f, prepared));
  const issued = await json(await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env));
  assert.match(issued.share.token, /^[A-Za-z0-9_-]{32}$/u);
  assert.deepEqual(await json(await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env)),
    { share: { shareId: issued.share.shareId, expiresAt: issued.share.expiresAt, active: true }, replayed: true });
  await refused(await preparedFile(f, prepared));
  const output = await json(await lifecycle.readSelectedOutputShare(publicRequest(issued.share.token, false), f.env, issued.share.token));
  assert.deepEqual(output, prepared.candidate.publicOutput);
  for (const value of [f.key, f.url, OWNER, EMAIL, CONTENT, DOCUMENT, ARTIFACT, "Synthetic private", "candidateSha256", "sourceMediaSha256"])
    assert.equal(JSON.stringify(output).includes(value), false, value);
  assert.deepEqual(await verifyFile(await publicFile(f, issued)), preview);
  const list = await json(await listSelectedOutputShares(f.request(undefined, {}, "GET", undefined,
    `/api/selected-output-shares?documentId=${DOCUMENT}&artifactId=${ARTIFACT}`), f.env));
  assert.equal(list.shares.length, 1); assert.equal(list.shares[0].shareId, issued.share.shareId);
  assert.equal(f.shares().length, 1); assert.equal(f.changes() - before, 2); assert.equal(f.nativeSnapshot(), nativeBefore);
  assert.equal(f.shares()[0].token_hash, digest(`${PURPOSE}\0${issued.share.token}`));
  assert.equal(f.media.size, 1); assert.ok(f.mediaReads.length > 0); assert.ok(f.mediaReads.every(key => key === f.key));
  assert.equal(digest(f.media.get(f.key).bytes), STEREO_MP3_SHA256); assert.equal(f.writes.length, 2);
});

test("prepared file is authenticated, purpose-bound and strictly same-origin while production creation stays closed", async t => {
  const f = await fixture(t), prepared = await prepare(f), before = f.changes(), reads = f.mediaReads.length;
  for (const site of [null, "none", "same-site", "cross-site"]) {
    const request = preparedRequest(f, prepared.candidateId);
    if (site === null) request.headers.delete("sec-fetch-site"); else request.headers.set("sec-fetch-site", site);
    await refused(await preparedFile(f, prepared, request), 403);
  }
  await refused(await preparedFile(f, prepared, preparedRequest(f, prepared.candidateId, { origin: "https://other.invalid" })), 403);
  await refused(await preparedFile(f, prepared, preparedRequest(f, prepared.candidateId,
    { "oai-authenticated-user-id": "different-canonical-owner" })), 404);
  const noAuth = preparedRequest(f, prepared.candidateId); noAuth.headers.delete("oai-authenticated-user-id"); noAuth.headers.delete("oai-authenticated-user-email");
  await refused(await preparedFile(f, prepared, noAuth), 401);
  assert.equal(f.mediaReads.length, reads, "Policy refusal does not read any retained object");
  assert.equal(f.changes(), before);
  assert.equal((await handleSelectedOutputShareApi(preparedRequest(f, prepared.candidateId), f.env)).status, 503);
  for (const path of ["prepare", "commit"]) {
    const request = f.request(path === "prepare" ? prepared.body : approve(prepared), {}, "POST", undefined, `/api/selected-output-shares/${path}`);
    assert.equal((await handleSelectedOutputShareApi(request, f.env)).status, 503);
  }
  assert.equal(f.mediaReads.length, reads); assert.equal(f.changes(), before);
  await verifyFile(await preparedFile(f, prepared));
});

const mutations = [
  ["completion input", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(INPUT)],
  ["original job", f => f.mutateJob("request_json", value => { value.audioCostConsent.confirmed = false; })],
  ["original paid call", f => f.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=used_microusd+1 WHERE provider='fal'").run()],
  ["source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
  ["job expiry", f => f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(JOB)],
  ["current terms", f => f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(OWNER)],
];
for (const phase of ["prepare", "prepared-file", "commit", "public-file"]) test(`${phase}: complete final SQL refuses late original source/recipe/paid/terms mutations`, async t => {
  for (const [name, mutate] of mutations) await t.test(name, async child => {
    const f = await fixture(child), issued = phase === "public-file" ? await issue(f) : null;
    const prepared = issued?.prepared ?? (phase === "prepare" ? null : await prepare(f));
    let reached = false;
    f.setBeforeStatement(sql => {
      if (!(phase === "prepare" ? preparationWrite(sql) : phase === "commit" ? tokenWrite(sql) : finalRead(sql))) return;
      reached = true; f.setBeforeStatement(null); mutate(f);
    });
    const response = phase === "prepare" ? await lifecycle.prepareSelectedOutputShare(f.request({ intentKey: "late-source", selection: f.selection(), review: f.review() }), f.env)
      : phase === "prepared-file" ? await preparedFile(f, prepared)
        : phase === "commit" ? await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env) : await publicFile(f, issued);
    await refused(response); assert.equal(reached, true, "Must reach the exact final publication/file boundary");
    if (phase === "prepare") assert.deepEqual(f.shares(), []);
    if (phase === "commit" || phase === "prepared-file") assert.equal(f.shares()[0].token_hash, null);
  });
});

test("prepared final SQL includes exact unissued row state and late revocation", async t => {
  const f = await fixture(t), prepared = await prepare(f); let reached = false;
  f.setBeforeStatement(sql => {
    if (!finalRead(sql)) return; reached = true; f.setBeforeStatement(null);
    f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=? WHERE share_id=?").run(new Date().toISOString(), prepared.candidateId);
  });
  await refused(await preparedFile(f, prepared)); assert.equal(reached, true); assert.equal(f.shares()[0].token_hash, null);
});

test("file response rechecks signal and storage affinity after a successful final SQL result", async t => {
  for (const fault of ["abort", "MEDIA"]) await t.test(fault, async child => {
    const f = await fixture(child), prepared = await prepare(f), controller = new AbortController(); let reached = false;
    f.setAfterStatement(sql => {
      if (!finalRead(sql)) return; reached = true; f.setAfterStatement(null);
      if (fault === "abort") controller.abort(); else f.env.MEDIA = { ...f.env.MEDIA };
    });
    await refused(await preparedFile(f, prepared, preparedRequest(f, prepared.candidateId, {}, controller.signal)));
    assert.equal(reached, true); assert.equal(f.shares()[0].token_hash, null);
  });
});

test("stalled preselection SQL settles on abort or an explicitly accelerated 30-second timer without subsequent source/media reads", { timeout: 60_000 }, async t => {
  // Only the timer delay is accelerated. This proves the outer deadline is
  // armed and raced; it is not a physical 30-second latency measurement.
  const realTimeout = globalThis.setTimeout;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (const phase of ["prepare", "commit", "prepared-file", "public-file", "public-JSON"])
    for (const lookup of ["schema", "row"]) for (const stop of ["abort", "accelerated-deadline"])
      await t.test(`${phase}-${lookup}-${stop}`, async child => {
        const f = await fixture(child);
        const issued = phase.startsWith("public-") ? await issue(f) : null;
        const prepared = issued?.prepared ?? (phase === "prepare" ? null : await prepare(f));
        const controller = new AbortController();
        let enter, release, accelerated = 0, fired = 0, settled = false;
        const entered = new Promise(resolve => { enter = resolve; }), stalled = new Promise(resolve => { release = resolve; });
        const before = { writes: f.writes.length, media: f.mediaReads.length, changes: f.changes() };
        let held = false;
        f.setBeforeStatement(async sql => {
          const target = lookup === "schema" ? sql.startsWith("SELECT CASE WHEN")
            : phase === "prepare" ? sql.startsWith("SELECT share_id,") && sql.includes("WHERE replay_key=?")
              : phase.startsWith("public-") ? sql.startsWith("SELECT share.share_id,")
                : sql.startsWith("SELECT share_id,") && sql.includes("WHERE share_id=? AND owner_id=?");
          if (!held && target) { held = true; enter(); await stalled; }
        });
        if (stop === "accelerated-deadline") child.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
          if (milliseconds >= 29_000 && milliseconds <= 30_000) {
            accelerated++; return realTimeout((...values) => { fired++; callback(...values); }, 20, ...args);
          }
          return realTimeout(callback, milliseconds, ...args);
        });
        const request = phase === "prepare" ? f.request({ intentKey: "stalled-prepare", selection: f.selection(), review: f.review() }, {}, "POST", controller.signal)
          : phase === "commit" ? f.request(approve(prepared), {}, "POST", controller.signal)
            : phase === "prepared-file" ? preparedRequest(f, prepared.candidateId, {}, controller.signal)
              : publicRequest(issued.share.token, phase === "public-file", { signal: controller.signal });
        const pending = phase === "prepare" ? lifecycle.prepareSelectedOutputShare(request, f.env)
          : phase === "commit" ? lifecycle.commitSelectedOutputShare(request, f.env)
            : phase === "prepared-file" ? preparedFile(f, prepared, request)
              : phase === "public-file" ? publicFile(f, issued, request) : lifecycle.readSelectedOutputShare(request, f.env, issued.share.token);
        void pending.then(() => { settled = true; }, () => { settled = true; });
        let watchdog;
        try {
          await Promise.race([entered, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("Missing target preselection SQL")), 1000); })]);
          clearTimeout(watchdog); watchdog = undefined;
          if (stop === "abort") { assert.equal(settled, false, "Operation must be pending on the intercepted query before abort"); controller.abort(); }
          const response = await Promise.race([pending, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("Stalled preselection operation did not settle")), 1000); })]);
          clearTimeout(watchdog); watchdog = undefined;
          await refused(response); assert.equal(held, true);
          if (stop === "accelerated-deadline") {
            assert.ok(accelerated >= 1, "Actual 30-second deadline timer must be armed");
            assert.ok(fired >= 1, "Refusal must follow the actual accelerated deadline callback");
          }
          assert.equal(f.writes.length, before.writes); assert.equal(f.mediaReads.length, before.media); assert.equal(f.changes(), before.changes);
          const statements = f.statements.length;
          release(); await pending; await tick(); await tick();
          assert.equal(f.statements.length, statements, "A late SQL result cannot continue into source/capability reads");
          assert.equal(f.writes.length, before.writes); assert.equal(f.mediaReads.length, before.media); assert.equal(f.changes(), before.changes);
        } finally {
          clearTimeout(watchdog); controller.abort(); release();
          try { await Promise.race([pending, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("SQL test cleanup did not drain")), 1000); })]); }
          finally { clearTimeout(watchdog); }
          await tick(); f.setBeforeStatement(null);
        }
      });
});

test("stalled command bodies settle before source admission on abort or an explicitly accelerated 30-second timer", { timeout: 15_000 }, async t => {
  const realTimeout = globalThis.setTimeout, tick = () => new Promise(resolve => setImmediate(resolve));
  for (const phase of ["prepare", "commit"]) for (const stop of ["abort", "accelerated-deadline"])
    await t.test(`${phase}-${stop}`, async child => {
      const f = await fixture(child), prepared = phase === "commit" ? await prepare(f) : null;
      const body = phase === "commit" ? approve(prepared) : { intentKey: "stalled-body", selection: f.selection(), review: f.review() };
      const before = { statements: f.statements.length, media: f.mediaReads.length, writes: f.writes.length, changes: f.changes() };
      let enter, release, bodyController, accelerated = 0, fired = 0, settled = false;
      const entered = new Promise(resolve => { enter = resolve; }), stalled = new Promise(resolve => { release = resolve; });
      const stream = new ReadableStream({ start(controller) { bodyController = controller; }, pull() { enter(); return stalled; } });
      const controller = new AbortController();
      const request = new Request("https://forma.test/detached-selected-output-share", { method: "POST", duplex: "half", body: stream,
        headers: { "content-type": "application/json", "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL }, signal: controller.signal });
      if (stop === "accelerated-deadline") child.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
        if (milliseconds >= 29_000 && milliseconds <= 30_000) {
          accelerated++; return realTimeout((...values) => { fired++; callback(...values); }, 20, ...args);
        }
        return realTimeout(callback, milliseconds, ...args);
      });
      const pending = phase === "prepare" ? lifecycle.prepareSelectedOutputShare(request, f.env) : lifecycle.commitSelectedOutputShare(request, f.env);
      void pending.then(() => { settled = true; }, () => { settled = true; });
      let watchdog;
      try {
        await Promise.race([entered, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("Command body was not pulled")), 1000); })]);
        clearTimeout(watchdog); watchdog = undefined; await tick();
        if (stop === "abort") { assert.equal(settled, false, "Operation must be pending on the local body before abort"); controller.abort(); }
        const response = await Promise.race([pending, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("Stalled command body did not settle")), 1000); })]);
        clearTimeout(watchdog); watchdog = undefined; await refused(response);
        if (stop === "accelerated-deadline") { assert.ok(accelerated >= 1); assert.ok(fired >= 1, "Accelerated deadline callback must actually fire"); }
        assert.equal(f.statements.length, before.statements); assert.equal(f.mediaReads.length, before.media); assert.equal(f.writes.length, before.writes);
      } finally {
        clearTimeout(watchdog); controller.abort();
        try { bodyController.enqueue(new TextEncoder().encode(JSON.stringify(body))); bodyController.close(); } catch { /* A canceled native stream is already retired. */ }
        release();
        try { await Promise.race([pending, new Promise((_, reject) => { watchdog = realTimeout(() => reject(Error("Body test cleanup did not drain")), 1000); })]); }
        finally { clearTimeout(watchdog); }
        await tick(); await tick();
      }
      assert.equal(f.statements.length, before.statements); assert.equal(f.mediaReads.length, before.media);
      assert.equal(f.writes.length, before.writes); assert.equal(f.changes(), before.changes);
    });
});

test("a genuine current authored WAV cannot fall back to the original MP3; explicit current restore is separately reviewed", async t => {
  const f = await fixture(t), issued = await issue(f), originalRaw = f.raw();
  const revision = parseAudioMediaRevision({ schemaVersion: 1, operation: "trim",
    media: { url: f.url.replace(".mp3", "-edit.wav"), mediaType: "audio/wav", sha256: "b".repeat(64), byteLength: 1764044 },
    source: { url: f.url, sha256: STEREO_MP3_SHA256, revision: 0, contentSha256: digest(originalRaw), frameCount: 882000 },
    startFrame: 0, endFrame: 441000, sampleRate: 44100, channels: 2, bitsPerSample: 16, frameCount: 441000, durationSeconds: 10 });
  assert.ok(revision); f.replace({ ...JSON.parse(originalRaw), audio_revision: revision });
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "audio", content_ref: CONTENT, revision: 1,
    content_sha256: digest(f.raw()), edited_by_user_id: OWNER, audio_revision: revision, source_surface: "document-artifact-audio-trim" });
  const before = f.mediaReads.length;
  await refused(await publicFile(f, issued));
  for (const mediaSha256 of [STEREO_MP3_SHA256, "b".repeat(64)]) await refused(await lifecycle.prepareSelectedOutputShare(f.request({
    intentKey: "forbidden-wav-fallback", selection: f.selection(1, { mediaSha256 }), review: f.review() }), f.env));
  assert.equal(f.mediaReads.length, before, "Current WAV refusal never fetches the older source MP3");
  f.replace(originalRaw);
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "audio", content_ref: CONTENT, revision: 2,
    content_sha256: digest(f.raw()), edited_by_user_id: OWNER, audio_revision: null,
    revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  await refused(await publicFile(f, issued));
  const restored = await issue(f, { intent: "review-current-restored-mp3", selection: f.selection(2) });
  assert.equal(restored.prepared.candidate.selection.revision, 2); await verifyFile(await publicFile(f, restored));
});

function installPilot(f) {
  const now = new Date().toISOString(), endsAt = new Date(Date.now() + 7_200_000).toISOString();
  f.insert("organizations", { organization_id: "mp3-sharing-pilot-org", name: "Synthetic MP3 pilot", owner_user_id: OWNER,
    status: "active", created_at: now, updated_at: now });
  f.insert("pilot_cohorts", { cohort_id: "mp3-sharing-pilot", organization_id: "mp3-sharing-pilot-org", status: "active",
    starts_at: "2020-01-01T00:00:00.000Z", ends_at: endsAt, created_by_user_id: OWNER, created_at: now, updated_at: now });
  f.insert("pilot_participants", { participant_id: "mp3-sharing-participant", cohort_id: "mp3-sharing-pilot", organization_id: "mp3-sharing-pilot-org",
    email_normalized: EMAIL, user_id: OWNER, status: "active", invited_by_user_id: OWNER, created_at: now });
  f.env.FORMA_PILOT_COHORT_ID = "mp3-sharing-pilot";
}
test("actual lifecycle SQL with three original calls and full optional sponsor schema fits all four D1 limits for ordinary/pilot and original/text edit", { timeout: 120_000 }, async t => {
  for (const pilot of [false, true]) for (const edited of [false, true]) await t.test(`${pilot ? "pilot" : "ordinary"}-${edited ? "text-edit" : "original"}`, async child => {
    const f = await fixture(child, { repair: true }); if (pilot) installPilot(f);
    for (const sql of [...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_INTAKE_SCHEMA]) f.sqlite.exec(sql);
    if (edited) {
      f.replace({ ...JSON.parse(f.raw()), title: "Current edited title" });
      await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "audio", content_ref: CONTENT, revision: 1,
        content_sha256: digest(f.raw()), edited_by_user_id: OWNER, source_surface: "document-artifact-editor" });
    }
    const snapshot = f.snapshot(); f.operation("prepare"); const prepared = await prepare(f, { selection: f.selection(edited ? 1 : 0) });
    f.operation("prepare-replay"); await json(await lifecycle.prepareSelectedOutputShare(f.request(prepared.body), f.env));
    f.operation("prepared-file"); await verifyFile(await preparedFile(f, prepared));
    f.operation("commit"); const issued = await json(await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env));
    f.operation("commit-replay"); await json(await lifecycle.commitSelectedOutputShare(f.request(approve(prepared)), f.env));
    f.operation("public-file"); await verifyFile(await publicFile(f, issued));
    f.operation("public-JSON"); await json(await lifecycle.readSelectedOutputShare(publicRequest(issued.share.token, false), f.env, issued.share.token));
    f.operation("list"); await json(await listSelectedOutputShares(f.request(undefined, {}, "GET", undefined,
      `/api/selected-output-shares?documentId=${DOCUMENT}&artifactId=${ARTIFACT}`), f.env));
    const qualified = qualifyCapturedSql(snapshot, f.statements); assert.deepEqual(qualified.failures, []);
    child.diagnostic(JSON.stringify({ pilot, edited, calls: 3, optionalSponsorTables: 3,
      maxBindings: qualified.maxBindings, maxSqlBytes: qualified.maxBytes, distinctSql: qualified.statements.length, strict: qualified.statements }));
  });
});
