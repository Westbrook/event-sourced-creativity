import assert from "node:assert/strict";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { fixture, OWNER, EMAIL, ARTIFACT, CONTENT, INPUT, JOB, EXPIRY, MEDIA_HASH, digest } from "./helpers/native-stable-audio-proof-fixture.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";
import { captureNativeStatements, syntheticSnapshot, qualifyCapturedSql } from "./helpers/selected-output-share-d1-qualification.mjs";
const imports = registerOutputSourceImports();
let custodyApi, recipeApi, authorityApi, parseAudioMediaRevision, ownerMediaNamespace, SPONSOR_ENTITLEMENT_SCHEMA, SPONSOR_INTAKE_SCHEMA;
try {
  custodyApi = await import("../worker/native-retained-media-custody.ts");
  recipeApi = await import("../worker/native-stable-audio-share-proof.ts");
  authorityApi = await import("../worker/selected-output-share-authority.ts");
  ({ parseAudioMediaRevision } = await import("../src/model/document-artifacts.ts"));
  ({ ownerMediaNamespace } = await import("../src/model/media-ownership.ts"));
  ({ SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts"));
  ({ SPONSOR_INTAKE_SCHEMA } = await import("../worker/experience-sponsor-intake.ts"));
} finally { imports.deregister(); }
const unavailable = /selected_output_share_authority_unavailable/u;
const mediaSelection = selection => ({ ...selection, policy: "selected-output-share-audio-v1" });
const readCustody = (f, selection = f.selection, signal = new AbortController().signal) =>
  custodyApi.readNativeRetainedMediaCustody(f.env, f.identity, mediaSelection(selection), signal);
const readRecipe = (f, selection = f.selection, signal = new AbortController().signal) =>
  recipeApi.readNativeStableAudioRecipeProof(f.env, f.identity, selection, signal);
const read = async (f, selection = f.selection) => {
  const custody = await readCustody(f, selection), recipe = await readRecipe(f, selection);
  return { custody, recipe, authority: await authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe) };
};
async function evaluate(f, proof) {
  const leaves = authorityApi.selectedOutputShareAuthorityAssertion(proof, f.env);
  const statement = selectedShareProofStatement(leaves, "balanced");
  return (await f.env.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`).bind(...statement.bindings).first())?.admitted ?? 0;
}
function noEgress(t) {
  let attempted = 0; t.mock.method(globalThis, "fetch", () => { attempted++; throw Error("No network/provider requests"); });
  t.after(() => assert.equal(attempted, 0));
}
function installPilot(f) {
  const now = new Date().toISOString(), endsAt = new Date(Date.now() + 3_600_000).toISOString();
  f.insert("organizations", { organization_id: "stable-pilot-org", name: "Synthetic pilot", owner_user_id: OWNER,
    status: "active", created_at: now, updated_at: now });
  f.insert("pilot_cohorts", { cohort_id: "stable-pilot", organization_id: "stable-pilot-org", status: "active",
    starts_at: "2020-01-01T00:00:00.000Z", ends_at: endsAt, created_by_user_id: OWNER, created_at: now, updated_at: now });
  f.insert("pilot_participants", { participant_id: "stable-pilot-participant", cohort_id: "stable-pilot", organization_id: "stable-pilot-org",
    email_normalized: EMAIL, user_id: OWNER, status: "active", invited_by_user_id: OWNER, created_at: now });
  f.env.FORMA_PILOT_COHORT_ID = "stable-pilot";
  return endsAt;
}
async function edit(f, revision, raw, extra = {}) {
  f.replace(raw);
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "audio", content_ref: CONTENT,
    revision, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, ...extra });
  return f.select(revision);
}
for (const repair of [false, true]) for (const pilot of [false, true]) test(`native MP3 ${repair ? 3 : 2} original calls, ${pilot ? "pilot" : "ordinary"} authority joins seven complete proofs without asset reads`, async t => {
  noEgress(t); const f = await fixture(t, { repair }), deadline = pilot ? installPilot(f) : EXPIRY, before = f.changes();
  const { custody, recipe, authority } = await read(f), native = custodyApi.nativeRetainedMediaCustodySnapshot(custody, f.env);
  assert.equal(native.media.mimeType, "audio/mpeg"); assert.equal(native.media.sha256, MEDIA_HASH);
  assert.equal(native.media.readMode, "native-output-audio-mp3"); assert.equal(native.media.url, f.url);
  assert.equal(native.dto.selection.revision, 0); assert.equal(native.media.byteLength, null);
  assert.equal(await evaluate(f, authority), 1); assert.equal(f.changes(), before); assert.deepEqual(f.mediaCalls, []);
  assert.deepEqual(authorityApi.selectedOutputShareAuthoritySnapshot(authority, f.env), { jobId: JOB, completionId: f.completion.eventId, expiresAt: deadline });
  const leaves = authorityApi.selectedOutputShareAuthorityAssertion(authority, f.env), recipeLeaves = recipeApi.nativeStableAudioRecipeAssertions(recipe, f.env);
  assert.equal(leaves.length, 7); assert.deepEqual(leaves.slice(4), recipeLeaves);
  assert.deepEqual(leaves[1], custodyApi.nativeRetainedMediaCustodyAssertion(custody, f.env));
  assert.ok(Object.isFrozen(authority)); assert.deepEqual(Reflect.ownKeys(authority), []);
  await assert.rejects(authorityApi.readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
});
test("MP3 declaration cannot pass the old WAV custody path or supply either opaque capability", async t => {
  const f = await fixture(t), { custody, recipe, authority } = await read(f);
  const wav = mediaSelection(f.selection); delete wav.sourceProfile; delete wav.projectionPolicy;
  await assert.rejects(custodyApi.readNativeRetainedMediaCustody(f.env, f.identity, wav, new AbortController().signal), /unavailable/u);
  for (const forged of [undefined, null, {}, { ...custody }, Object.create(custody), new Proxy(custody, {})])
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, forged, recipe), unavailable);
  for (const forged of [undefined, null, {}, { ...recipe }, Object.create(recipe), new Proxy(recipe, {})])
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, forged), unavailable);
  for (const forged of [{}, { ...authority }, Object.create(authority), new Proxy(authority, {})])
    assert.throws(() => authorityApi.selectedOutputShareAuthoritySnapshot(forged, f.env), unavailable);
  assert.throws(() => authorityApi.selectedOutputShareAuthoritySnapshot(authority, { ...f.env }), unavailable);
});
test("genuine foreign environment and different current revision proofs cannot be crossed", async t => {
  const f = await fixture(t), other = await fixture(t), original = await read(f), foreign = await read(other);
  await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, original.custody, foreign.recipe), unavailable);
  await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, foreign.custody, original.recipe), unavailable);
  const selection = await edit(f, 1, { ...JSON.parse(f.raw()), title: "Current title" }, { source_surface: "document-artifact-editor" });
  const current = await read(f, selection);
  await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, current.custody, original.recipe), unavailable);
  await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, original.custody, current.recipe), unavailable);
  assert.equal(await evaluate(f, original.authority), 0); assert.equal(await evaluate(f, current.authority), 1);
});
test("genuine same-environment different owner, Document, artifact and job proofs cannot be cross-wired", async t => {
  const cases = [
    ["owner", f => ({ identity: { ...f.identity, userId: "other-audio-owner", email: "other-audio-owner@example.test" }, selection: f.selection,
      replacements: [[ownerMediaNamespace(OWNER), ownerMediaNamespace("other-audio-owner")], [OWNER, "other-audio-owner"]] })],
    ["Document", f => ({ identity: f.identity, selection: { ...f.selection, documentId: "other-audio-document" }, replacements: [[f.selection.documentId, "other-audio-document"]] })],
    ["artifact", f => ({ identity: f.identity, selection: { ...f.selection, artifactId: "other-audio-artifact" }, replacements: [[ARTIFACT, "other-audio-artifact"]] })],
    ["job", f => ({ identity: f.identity, selection: f.selection,
      replacements: [[JOB, `audio-${"8".repeat(64)}`], [f.completion.eventId, "other-audio-completion"]] })],
  ];
  for (const [name, change] of cases) await t.test(name, async child => {
    const f = await fixture(child), target = change(f), snapshot = syntheticSnapshot(f.sqlite), alternate = outputTestDatabase();
    child.after(() => alternate.sqlite.close());
    // Reconstruct a second synthetic canonical donor before inserting its
    // append-only events. No event update trigger or production invariant is
    // disabled. A stable DB facade lets both genuine observations have the
    // same environment and DB object while its backing donor changes.
    for (const sql of snapshot.schema) alternate.sqlite.exec(sql);
    alternate.sqlite.exec("PRAGMA foreign_keys=OFF");
    try {
      for (const row of snapshot.data) alternate.sqlite.prepare(row.sql).run(...row.bindings.map(value =>
        typeof value === "string" ? target.replacements.reduce((result, [from, to]) => result.replaceAll(from, to), value) : value));
    } finally { alternate.sqlite.exec("PRAGMA foreign_keys=ON"); }
    assert.deepEqual(alternate.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    let donor = f.env.DB;
    f.env.DB = { prepare(sql) { assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu); return donor.prepare(sql); } };
    const original = await read(f); donor = alternate.DB;
    const signal = new AbortController().signal;
    const custody = await custodyApi.readNativeRetainedMediaCustody(f.env, target.identity, mediaSelection(target.selection), signal);
    const recipe = await recipeApi.readNativeStableAudioRecipeProof(f.env, target.identity, target.selection, signal);
    assert.equal(await evaluate(f, await authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe)), 1);
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, original.custody, recipe), unavailable);
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, original.recipe), unavailable);
  });
});
test("current authored WAV refuses MP3 with either original or edited hash; explicit restore remains current", async t => {
  const f = await fixture(t), original = JSON.parse(f.raw()), hash = "b".repeat(64);
  const revision = parseAudioMediaRevision({ schemaVersion: 1, operation: "trim", media: { url: f.url.replace(".mp3", "-edit.wav"), mediaType: "audio/wav", sha256: hash, byteLength: 1764044 },
    source: { url: f.url, sha256: MEDIA_HASH, revision: 0, contentSha256: digest(f.originalRaw), frameCount: 882000 },
    startFrame: 0, endFrame: 441000, sampleRate: 44100, channels: 2, bitsPerSample: 16, frameCount: 441000, durationSeconds: 10 });
  assert.ok(revision);
  const selection = await edit(f, 1, { ...original, audio_revision: revision }, { audio_revision: revision, source_surface: "document-artifact-audio-trim" });
  await assert.rejects(readCustody(f, selection), /unavailable/u);
  await assert.rejects(readCustody(f, { ...selection, mediaSha256: hash }), /unavailable/u);
  const restored = await edit(f, 2, f.originalRaw, { audio_revision: null, revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  const current = await read(f, restored); assert.equal(await evaluate(f, current.authority), 1);
  assert.equal(custodyApi.nativeRetainedMediaCustodySnapshot(current.custody, f.env).dto.selection.revision, 2);
});
const changes = [
  ["native source", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(CONTENT)],
  ["completion input", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(INPUT)],
  ["job request", f => f.mutateJob("request_json", value => { value.audioCostConsent.confirmed = false; })],
  ["provider call", f => f.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=used_microusd+1 WHERE provider='fal'").run()],
  ["storage acknowledgement", f => f.sqlite.prepare("UPDATE output_native_storage_writes SET write_acknowledged=0").run()],
  ["authorization envelope", f => f.changePrivate(value => { value.output_command_envelope.explicitAuthorization = false; }, f.authorization.eventId)],
  ["payer", f => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='sponsor'").run()],
  ["current terms", f => f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(OWNER)],
  ["input deadline", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(INPUT)],
  ["job deadline", f => f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'").run()],
];
test("both retained proofs and original paid authority stay live in every final SQL leaf", async t => {
  const f = await fixture(t), { authority } = await read(f);
  for (const [name, mutate] of changes) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT mutation");
    try { mutate(f); assert.equal(await evaluate(f, authority), 0); }
    finally { f.sqlite.exec("ROLLBACK TO mutation; RELEASE mutation"); }
  });
});
test("late mutation during the actual authority final read refuses capability issuance", async t => {
  for (const [name, mutate] of changes) await t.test(name, async child => {
    const f = await fixture(child), custody = await readCustody(f), recipe = await readRecipe(f); let reached = false;
    f.setBeforeRead(sql => { if (sql.startsWith("WITH selected_share_proof_0")) { reached = true; mutate(f); } });
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe), unavailable);
    assert.equal(reached, true); assert.deepEqual(f.mediaCalls, []);
  });
});
test("recipe alone does not authorize an empty or mismatched original authorization envelope", async t => {
  const f = await fixture(t);
  f.changePrivate(value => { value.output_command_envelope = {}; }, f.authorization.eventId);
  const custody = await readCustody(f), recipe = await readRecipe(f);
  await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe), unavailable);
});
test("authority retains both cancellation capabilities and current operation lifetime", async t => {
  const f = await fixture(t), nativeSignal = new AbortController(), recipeSignal = new AbortController();
  const custody = await readCustody(f, f.selection, nativeSignal.signal), recipe = await readRecipe(f, f.selection, recipeSignal.signal);
  const authority = await authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe);
  recipeSignal.abort(); assert.throws(() => authorityApi.selectedOutputShareAuthoritySnapshot(authority, f.env), /unavailable/u);
  const freshRecipe = await readRecipe(f), fresh = await authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, freshRecipe);
  nativeSignal.abort(); assert.throws(() => authorityApi.selectedOutputShareAuthorityAssertion(fresh, f.env), /unavailable/u);
});
test("input lifetime and current pilot admission bound authority without persisting transient operation deadline", async t => {
  const f = await fixture(t), expiry = new Date(Date.now() + 600_000).toISOString(); installPilot(f);
  f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expiry, INPUT);
  const { authority } = await read(f);
  assert.equal(authorityApi.selectedOutputShareAuthoritySnapshot(authority, f.env).expiresAt, expiry);
  f.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=?").run(new Date().toISOString());
  assert.equal(await evaluate(f, authority), 0);
});
for (const [table, schema] of [["experience_sponsor_consumptions", SPONSOR_ENTITLEMENT_SCHEMA], ["experience_sponsor_active_jobs", SPONSOR_ENTITLEMENT_SCHEMA], ["experience_sponsor_intakes", SPONSOR_INTAKE_SCHEMA]])
  test(`MP3 authority retains optional ${table} schema and sponsor exclusion`, async t => {
    const f = await fixture(t), first = await read(f);
    f.sqlite.exec(schema.find(sql => sql.startsWith(`CREATE TABLE ${table}(`)));
    assert.equal(await evaluate(f, first.authority), 0);
    const current = await read(f); assert.equal(await evaluate(f, current.authority), 1);
    const linked = table === "experience_sponsor_intakes" ? "document_id" : "job_id";
    f.sqlite.exec("PRAGMA foreign_keys=OFF");
    try {
      const columns = f.sqlite.prepare(`PRAGMA table_info(${table})`).all();
      const row = Object.fromEntries(columns.filter(c => c.notnull || c.pk || c.name === linked).map(c => [c.name,
        c.name === linked ? linked === "job_id" ? JOB : f.selection.documentId : c.name === "actor_user_id" ? OWNER
          : /INT/iu.test(c.type) ? 1 : c.name === "expires_at" ? EXPIRY : "synthetic"]));
      f.insert(table, row);
    } finally { f.sqlite.exec("PRAGMA foreign_keys=ON"); }
    assert.equal(await evaluate(f, current.authority), 0);
    await assert.rejects(read(f), unavailable);
  });
test("genuine same-environment proof observations cross-match authorization epoch and source expiry", async t => {
  for (const [name, mutate] of [
    ["authorization", f => f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(new Date().toISOString(), OWNER)],
    ["source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2098-01-01T00:00:00.000Z", CONTENT)],
  ]) await t.test(name, async child => {
    const f = await fixture(child), custody = await readCustody(f); mutate(f);
    const recipe = await readRecipe(f);
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe), unavailable);
    const current = await readCustody(f); assert.equal(await evaluate(f,
      await authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, current, recipe)), 1);
  });
});
test("post-await capability checks refuse environment replacements and either abort after a successful final SQL result", async t => {
  for (const field of ["DB", "MEDIA", "FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS", "custody abort", "recipe abort"]) await t.test(field, async child => {
    const f = await fixture(child), custodySignal = new AbortController(), recipeSignal = new AbortController();
    // Install a stable DB object before minting either genuine proof. The
    // wrapper mutates only after the real underlying final read succeeds.
    const base = f.env.DB; let afterFinal = null;
    f.env.DB = { ...base, prepare(sql) {
      const wrap = statement => ({ bind: (...values) => wrap(statement.bind(...values)),
        async first() { const result = await statement.first(); if (afterFinal && sql.startsWith("WITH selected_share_proof_0")) {
          assert.equal(result?.admitted, 1, "Mutation follows a successful final SQL admission"); afterFinal();
        } return result; },
        all: () => statement.all() });
      return wrap(base.prepare(sql));
    } };
    const custody = await readCustody(f, f.selection, custodySignal.signal), recipe = await readRecipe(f, f.selection, recipeSignal.signal);
    let reached = false;
    afterFinal = () => {
      reached = true;
      if (field === "custody abort") custodySignal.abort(); else if (field === "recipe abort") recipeSignal.abort();
      else f.env[field] = typeof f.env[field] === "object" ? { ...f.env[field] } : "changed";
    };
    await assert.rejects(authorityApi.readSelectedOutputShareStableAudioAuthority(f.env, custody, recipe), unavailable);
    assert.equal(reached, true);
  });
});
for (const clock of ["wall", "monotonic"]) test(`stored authority rechecks the recipe ${clock} operation deadline`, async t => {
  const f = await fixture(t), { authority } = await read(f);
  if (clock === "wall") { const future = Date.now() + 30_001; t.mock.method(Date, "now", () => future); }
  else { const future = performance.now() + 30_001; t.mock.method(performance, "now", () => future); }
  assert.throws(() => authorityApi.selectedOutputShareAuthoritySnapshot(authority, f.env), /unavailable/u);
  assert.throws(() => authorityApi.selectedOutputShareAuthorityAssertion(authority, f.env), /unavailable/u);
});
test("actual ordinary/pilot original/text-edit authority SQL fits all four strict D1 limits", { timeout: 120000 }, async t => {
  for (const pilot of [false, true]) for (const edited of [false, true]) await t.test(`${pilot ? "pilot" : "ordinary"}-${edited ? "edited" : "original"}`, async child => {
    const f = await fixture(child, { repair: true }); if (pilot) installPilot(f);
    const selection = edited ? await edit(f, 1, { ...JSON.parse(f.raw()), title: "Edited" }, { source_surface: "document-artifact-editor" }) : f.selection;
    const source = syntheticSnapshot(f.sqlite), capture = captureNativeStatements(f); child.after(() => capture.restore());
    capture.operation("native-mp3-sharing-authority"); const { authority } = await read(f, selection); await evaluate(f, authority);
    const result = qualifyCapturedSql(source, capture.records); assert.deepEqual(result.failures, []);
    child.diagnostic(JSON.stringify({ maxBindings: result.maxBindings, maxSqlBytes: result.maxBytes, statements: result.statements.length }));
  });
});
