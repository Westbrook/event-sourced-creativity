import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { fixture, OWNER, ARTIFACT, CONTENT, INPUT, ADMISSION_INPUT, JOB, EXPIRY, MEDIA_HASH, digest } from "./helpers/native-stable-audio-proof-fixture.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";
import { captureNativeStatements, syntheticSnapshot, qualifyCapturedSql, localWorkerdFixture } from "./helpers/selected-output-share-d1-qualification.mjs";
const imports = registerOutputSourceImports();
let readNativeStableAudioRecipeProof, nativeStableAudioRecipeSnapshot, nativeStableAudioRecipeAssertions, assertNativeStableAudioRecipeCurrent;
let parseAudioMediaRevision;
try {
  ({ readNativeStableAudioRecipeProof, nativeStableAudioRecipeSnapshot, nativeStableAudioRecipeAssertions, assertNativeStableAudioRecipeCurrent }
    = await import("../worker/native-stable-audio-share-proof.ts"));
  ({ parseAudioMediaRevision } = await import("../src/model/document-artifacts.ts"));
} finally { imports.deregister(); }
const unavailable = /native_stable_audio_share_proof_unavailable/u;
const read = (f, selection = f.selection, signal = new AbortController().signal, identity = f.identity, env = f.env) =>
  readNativeStableAudioRecipeProof(env, identity, selection, signal);
const check = (f, proof) => assertNativeStableAudioRecipeCurrent(proof, f.env);
const final = sql => sql.startsWith("WITH selected_share_proof_");
function noEgress(t) {
  let attempted = 0; t.mock.method(globalThis, "fetch", () => { attempted++; throw Error("No network/provider requests"); });
  t.after(() => assert.equal(attempted, 0));
}
for (const repair of [false, true]) test(`actual native current source + ${repair ? 3 : 2} original calls produce only an opaque recipe proof`, async t => {
  noEgress(t); const f = await fixture(t, { repair }), before = f.changes();
  assert.ok(Date.parse(f.costPreview.expiresAt) < Date.now(), "original completed quote is historical, not current read permission");
  const proof = await read(f), observed = nativeStableAudioRecipeSnapshot(proof, f.env);
  assert.equal(Object.keys(proof).length, 0); assert.ok(Object.isFrozen(proof));
  assert.deepEqual(observed.selection, f.selection); assert.equal(observed.media.sha256, MEDIA_HASH);
  assert.equal(observed.media.mimeType, "audio/mpeg"); assert.equal(observed.media.url, f.url);
  assert.equal(observed.inputId, INPUT); assert.notEqual(observed.inputId, ADMISSION_INPUT);
  assert.equal(observed.recipe, "forma.audio.instrumental-20@1"); assert.equal(observed.expiresAt, EXPIRY);
  const queries = nativeStableAudioRecipeAssertions(proof, f.env); assert.equal(queries.length, 3);
  queries.forEach(query => { assert.ok(Object.isFrozen(query)); assert.ok(Object.isFrozen(query.bindings)); });
  await check(f, proof); assert.equal(f.changes(), before); assert.deepEqual(f.mediaCalls, []);
});

const changes = [
  ["input bytes", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(INPUT)],
  ["input redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(EXPIRY, INPUT)],
  ["input owner", f => f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(INPUT)],
  ["input expiry extension", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2099-02-01T00:00:00.000Z' WHERE content_id=?").run(INPUT)],
  ["input expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(INPUT)],
  ["source bytes", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(CONTENT)],
  ["source redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(EXPIRY, CONTENT)],
  ["source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
  ["job request", f => f.mutateJob("request_json", value => { value.audioProfile.durationSeconds = 19; })],
  ["job result", f => f.mutateJob("result_json", value => { value.plannerResponseId = "other"; })],
  ["job expiry", f => f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(JOB)],
  ["consent", f => f.mutateJob("request_json", value => { value.audioCostConsent.confirmed = false; })],
  ["provider call", f => f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE provider='fal'").run("b".repeat(64))],
  ["provider cost", f => f.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=used_microusd+1 WHERE provider='fal'").run()],
  ["provider status", f => f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain' WHERE provider='fal'").run()],
  ["storage acknowledgement", f => f.sqlite.prepare("UPDATE output_native_storage_writes SET write_acknowledged=0").run()],
  ["storage publication", f => f.sqlite.prepare("UPDATE output_native_storage_writes SET publication_event_id=NULL").run()],
  ["completion recipe", f => f.changePrivate(value => { value.settings.output_audio.durationSeconds = 19; })],
  ["completion input selection", f => f.changePrivate(value => { value.input_ref = ADMISSION_INPUT; })],
  ["principal terms", f => f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(OWNER)],
  ["principal epoch", f => f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(EXPIRY, OWNER)],
  ["grant owner", f => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='other'").run()],
  ["preflight terms", f => f.sqlite.prepare("UPDATE output_preflights SET terms_digest='changed'").run()],
];
test("every captured source/input/job/paid-call/terms change invalidates the exact final SQL proof", async t => {
  noEgress(t); const f = await fixture(t), proof = await read(f);
  for (const [name, change] of changes) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT proof_change");
    try { change(f); const after = f.changes(); await assert.rejects(check(f, proof), unavailable); assert.equal(f.changes(), after); }
    finally { f.sqlite.exec("ROLLBACK TO proof_change; RELEASE proof_change"); }
  });
  await check(f, proof);
});
test("late mutations during the final database read cannot mint a witness", async t => {
  for (const [name, change] of changes.filter(([name]) => ["input bytes", "provider call", "job request", "completion recipe", "principal terms"].includes(name))) {
    await t.test(name, async child => { const f = await fixture(child); let changed = false;
      f.setBeforeRead(sql => { if (!changed && final(sql)) { changed = true; change(f); } });
      await assert.rejects(read(f), unavailable); assert.ok(changed); assert.deepEqual(f.mediaCalls, []);
    });
  }
});
test("pre-read normal input substitutions fail even if the basic native recipe still matches", async t => {
  const mutations = [
    ["source facts", f => f.changeInput(value => { value.document_snapshot.facts = [{ secret: "different source" }]; })],
    ["missing normal source snapshot", f => f.changeInput(value => { delete value.document_snapshot; })],
    ["source block versions", f => f.changePrivate(value => { value.source_block_versions = [{ block_id: "other", version: 1 }]; })],
    ["source document", f => f.mutateJob("request_json", value => { value.documentId = "other"; })],
    ["native input uses Document surface", f => f.changeInput(value => { value.request.source_surface = "document"; })],
    ["render unknown field", f => f.changeInput(value => { value.render.unbound = true; })],
    ["paid-call unknown field", f => f.changeInput(value => { value.output_audio_calls[0].unbound = true; })],
    ["scope key", f => f.changePrivate(value => { value.settings.output_audio_execution.scopeKey = "other"; })],
    ["consent actor", f => f.mutateJob("request_json", value => { value.audioCostConsent.actorUserId = "other"; })],
    ["source model", f => f.mutateJob("request_json", value => { value.audioProviderModel = "other"; })],
    ["completion provider", f => f.changePrivate(value => { value.provider = "other"; })],
    ["admission row mistaken for completion input", f => f.changePrivate(value => { value.input_ref = ADMISSION_INPUT; })],
  ];
  for (const [name, change] of mutations) await t.test(name, async child => { const f = await fixture(child); change(f); await assert.rejects(read(f), unavailable); });
});
test("closed identity/selection, native abort signal, and opaque environment affinity are enforced", async t => {
  const f = await fixture(t); let getters = 0;
  const getter = { ...f.selection }; Object.defineProperty(getter, "mediaSha256", { enumerable: true, get() { getters++; return MEDIA_HASH; } });
  for (const value of [{ ...f.selection, policy: "wav" }, { ...f.selection, sourceProfile: "generic-mp3" }, { ...f.selection, mediaSha256: "b".repeat(64) },
    { ...f.selection, revision: 1 }, Object.create(f.selection), getter]) await assert.rejects(read(f, value), unavailable);
  for (const actor of [{ ...f.identity, email: "other@example.test" }, { ...f.identity, userId: "other" }, { ...f.identity, source: "local-development" }])
    await assert.rejects(read(f, f.selection, undefined, actor), unavailable);
  await assert.rejects(read(f, f.selection, { aborted: false }), unavailable); assert.equal(getters, 0);
  const proof = await read(f);
  for (const forged of [{}, { ...proof }, JSON.parse(JSON.stringify(proof)), Object.create(proof), new Proxy(proof, {})]) {
    assert.throws(() => nativeStableAudioRecipeSnapshot(forged, f.env), unavailable);
    assert.throws(() => nativeStableAudioRecipeAssertions(forged, f.env), unavailable);
    await assert.rejects(check(f, forged), unavailable);
  }
  assert.throws(() => nativeStableAudioRecipeSnapshot(proof, { ...f.env }), unavailable);
});
for (const field of ["DB", "MEDIA", "FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"]) test(`late ${field} replacement invalidates the source witness`, async t => {
  const f = await fixture(t); let changed = false;
  f.setBeforeRead(sql => { if (!changed && final(sql)) { changed = true; f.env[field] = typeof f.env[field] === "object" ? { ...f.env[field] } : "changed"; } });
  await assert.rejects(read(f), unavailable); assert.ok(changed);
});
test("an unresponsive DB read is abandoned on abort; late completion cannot expose a proof", async t => {
  const f = await fixture(t), abort = new AbortController(); let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.setBeforeRead(async sql => { if (sql.startsWith("SELECT content,expires_at") && sql.includes("document-artifact-input")) {
    entered(); await new Promise(resolve => { finish = resolve; });
  } });
  const pending = read(f, f.selection, abort.signal); await started; abort.abort();
  await assert.rejects(pending, unavailable); finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(final), false); assert.deepEqual(f.mediaCalls, []);
});
test("source/input/job lifetimes and both clocks fence proof access", async t => {
  for (const kind of ["source", "input", "job", "operation", "monotonic"]) await t.test(kind, async child => {
    const f = await fixture(child), now = Date.now(), limit = new Date(now + 5000).toISOString();
    if (kind === "job") f.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(limit, JOB);
    else if (kind !== "operation" && kind !== "monotonic") f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(limit, kind === "input" ? INPUT : CONTENT);
    const proof = await read(f), monotonic = performance.now();
    if (kind === "monotonic") child.mock.method(performance, "now", () => monotonic + 30_001);
    else child.mock.method(Date, "now", () => now + (kind === "operation" ? 30_001 : 5001));
    assert.throws(() => nativeStableAudioRecipeSnapshot(proof, f.env), unavailable); await assert.rejects(check(f, proof), unavailable);
  });
});
test("bounded source reads reject oversized input and job JSON before creating a witness", async t => {
  for (const kind of ["input", "job"]) await t.test(kind, async child => {
    const f = await fixture(child);
    if (kind === "input") f.sqlite.prepare("UPDATE private_content SET content=content||? WHERE content_id=?").run(" ".repeat(1_000_001), INPUT);
    else f.mutateJob("request_json", value => { value.extra = "x".repeat(131_073); });
    await assert.rejects(read(f), unavailable); assert.equal(f.calls.some(final), false);
  });
});
test("the actual 30-second deadline abandons a stalled DB read without waiting for it", { timeout: 45000 }, async t => {
  const f = await fixture(t); let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.setBeforeRead(async sql => { if (sql.startsWith("SELECT content,expires_at") && sql.includes("document-artifact-input")) {
    entered(); await new Promise(resolve => { finish = resolve; });
  } });
  const before = performance.now(), pending = read(f); await started;
  try { await assert.rejects(pending, unavailable); const elapsed = performance.now() - before; assert.ok(elapsed >= 29_000 && elapsed < 35_000, String(elapsed)); }
  finally { finish(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(f.calls.some(final), false); assert.deepEqual(f.mediaCalls, []);
});
async function appendEdit(f, revision, raw, extra = {}) {
  f.replace(raw);
  return f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "audio", content_ref: CONTENT,
    revision, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, ...extra });
}
test("current text edit and explicit restore can retain MP3; current authored WAV never falls back to original", async t => {
  const f = await fixture(t), original = JSON.parse(f.raw());
  await appendEdit(f, 1, { ...original, title: "Current text edit" }, { source_surface: "document-artifact-editor" });
  await check(f, await read(f, f.select(1)));
  const wavUrl = f.url.replace(".mp3", "-edit.wav"), wavHash = "b".repeat(64);
  const revision = parseAudioMediaRevision({ schemaVersion: 1, operation: "trim", media: { url: wavUrl, mediaType: "audio/wav", sha256: wavHash, byteLength: 1764044 },
    source: { url: f.url, sha256: MEDIA_HASH, revision: 0, contentSha256: digest(f.originalRaw), frameCount: 882000 },
    startFrame: 0, endFrame: 441000, sampleRate: 44100, channels: 2, bitsPerSample: 16, frameCount: 441000, durationSeconds: 10 });
  assert.ok(revision);
  await appendEdit(f, 2, { ...original, audio_revision: revision }, { audio_revision: revision, source_surface: "document-artifact-audio-trim" });
  await assert.rejects(read(f, f.select(2)), unavailable);
  await assert.rejects(read(f, f.select(2, { mediaSha256: wavHash })), unavailable);
  await appendEdit(f, 3, f.originalRaw, { audio_revision: null, revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  await check(f, await read(f, f.select(3)));
});

test("all generated standalone and full source-proof SQL fit actual D1 limits", { timeout: 120000 }, async t => {
  noEgress(t); const f = await fixture(t, { repair: true }), source = syntheticSnapshot(f.sqlite), capture = captureNativeStatements(f);
  t.after(() => capture.restore()); capture.operation("native-audio-source-proof");
  const proof = await read(f); await check(f, proof);
  const queries = nativeStableAudioRecipeAssertions(proof, f.env);
  for (const query of queries) await f.env.DB.prepare(query.sql).bind(...query.bindings).first();
  const result = qualifyCapturedSql(source, capture.records); assert.deepEqual(result.failures, []);
  t.diagnostic(JSON.stringify({ target: "source helper only; final sharing composition remains a separate integration check", maxBindings: result.maxBindings,
    maxSqlBytes: result.maxBytes, statements: result.statements.length }));
});
test("the actual source helper executes against local workerd D1; no Worker bundle or sharing route is claimed", { timeout: 120000 }, async t => {
  const f = await fixture(t, { repair: true }), local = await localWorkerdFixture(t, syntheticSnapshot(f.sqlite));
  const env = { ...f.env, DB: local.DB }, proof = await read(f, f.selection, undefined, f.identity, env);
  await assertNativeStableAudioRecipeCurrent(proof, env);
  assert.equal(nativeStableAudioRecipeSnapshot(proof, env).inputId, INPUT);
  const statement = selectedShareProofStatement(nativeStableAudioRecipeAssertions(proof, env), "balanced");
  await local.DB.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").bind(INPUT).run();
  assert.equal(await local.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`).bind(...statement.bindings).first(), null);
  await assert.rejects(assertNativeStableAudioRecipeCurrent(proof, env), unavailable);
  assert.deepEqual(f.mediaCalls, []);
});
