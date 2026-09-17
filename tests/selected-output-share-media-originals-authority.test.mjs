import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { originalOutputsMediaFixture, retainOriginalOutputsModel3dRevision } from "./helpers/selected-output-share-media-outputs-fixture.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";
const imports = registerOutputSourceImports();
let readSelectedOutputShareMediaAuthority, selectedOutputShareAuthoritySnapshot, selectedOutputShareAuthorityAssertion;
let SPONSOR_ENTITLEMENT_SCHEMA, readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes, nativeRetainedMediaCustodySnapshot;
let qualifySelectedOutputShareVideo, inspectOutputAsset;
try {
  ({ readSelectedOutputShareMediaAuthority, selectedOutputShareAuthoritySnapshot, selectedOutputShareAuthorityAssertion }
    = await import("../worker/selected-output-share-authority.ts"));
  ({ SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts"));
  ({ readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes } = await import("../worker/native-retained-media-bytes.ts"));
  ({ nativeRetainedMediaCustodySnapshot } = await import("../worker/native-retained-media-custody.ts"));
  ({ qualifySelectedOutputShareVideo } = await import("../src/model/selected-output-share-video.ts"));
  ({ inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts"));
} finally { imports.deregister(); }
const unavailable = /selected_output_share_authority_unavailable/u;
const evaluate = async (f, proof) => {
  const statement = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(proof, f.env));
  return (await f.env.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`)
    .bind(...statement.bindings).first())?.admitted ?? 0;
};
const withoutNetwork = t => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw Error("original media authority must not access network"); };
  t.after(() => { globalThis.fetch = previous; });
};

for (const output of ["video", "model3d"]) {
  test(`${output}: actual original Outputs native custody composes actor-paid authority without another media read`, async t => {
    withoutNetwork(t);
    const f = await originalOutputsMediaFixture(t, output), before = f.changes(), custody = await f.read();
    assert.equal(f.stats.gets, output === "video" ? 1 : 0);
    const job = f.sqlite.prepare("SELECT request_json,result_json FROM document_jobs").get();
    assert.equal(Object.hasOwn(JSON.parse(job.request_json), "outputExecution"), output !== "video");
    assert.deepEqual(JSON.parse(job.result_json).outputExecution, f.reference);
    assert.equal(JSON.parse(job.request_json).itemCount, 1, "native request count is one for both original generators");
    const proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
    assert.deepEqual(Object.keys(proof), []); assert.ok(Object.isFrozen(proof));
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).completionId, f.completed.eventId);
    assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).jobId, f.jobId);
    assert.equal(await evaluate(f, proof), 1);
    const authority = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(proof, f.env));
    assert.match(authority.withSql, output === "video" ? /video_proof AS MATERIALIZED/u : /model3d_proof AS MATERIALIZED/u);
    assert.ok(authority.bindings.length <= 100);
    assert.ok(Buffer.byteLength(`${authority.withSql} SELECT 1 AS admitted WHERE ${authority.sql}`) <= 100000);
    assert.equal(f.changes(), before); assert.deepEqual(f.stats, { gets: output === "video" ? 1 : 0, heads: 0, writes: 0 });
  });

  test(`${output}: original native authority keeps grant, request, paid call, storage and private input witnesses current`, async t => {
    withoutNetwork(t);
    const f = await originalOutputsMediaFixture(t, output), custody = await f.read();
    const proof = await readSelectedOutputShareMediaAuthority(f.env, custody), gets = f.stats.gets;
    const cases = {
      "different payer": () => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='different-payer'").run(),
      "different actor": () => f.sqlite.prepare("UPDATE output_execution_grants SET actor_user_id='different-actor'").run(),
      "selected context": () => f.sqlite.prepare("UPDATE output_execution_grants SET context_id='different-context'").run(),
      "revoked completed grant": () => f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run(),
      "private authorization retired": () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='retired' WHERE private_event_id=?").run(f.authorization.eventId),
      "different preflight terms": () => f.sqlite.prepare("UPDATE output_preflights SET terms_digest='changed'").run(),
      "wrong authorized route": () => f.mutateAuthorization(value => { value.authorized_targets[0].route_digest = "changed"; }),
      "duplicate authorized selected slot": () => f.mutateAuthorization(value => { value.authorized_targets.push(value.authorized_targets[0]); }),
      "sponsor marker false despite same payer": () => f.mutateAuthorization(value => { value.output_command_envelope.sponsor_entitlement = false; }),
      "sponsor marker null despite same payer": () => f.mutateAuthorization(value => { value.output_command_envelope.sponsor_entitlement = null; }),
      "sponsor marker nested despite same payer": () => f.mutateAuthorization(value => { value.output_command_envelope.extra = { sponsor_entitlement: {} }; }),
      "result reference changed": () => f.mutateJob("result_json", value => { value.outputExecution.sourceDigest = "changed"; }),
      "result reference missing": () => f.mutateJob("result_json", value => { delete value.outputExecution; }),
      "request reference contradicts original": () => f.mutateJob("request_json", value => { value.outputExecution = { ...f.reference, grantId: "changed" }; }),
      "call receipt unsettled": () => f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain'").run(),
      "call response identity changed": () => f.sqlite.prepare("UPDATE output_provider_calls SET provider_response_id='changed'").run(),
      "call digest changed": () => f.sqlite.prepare("UPDATE output_provider_calls SET request_digest='changed'").run(),
      "call settled cost changed": () => f.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=used_microusd+1").run(),
      "storage acknowledgment missing": () => f.sqlite.prepare("UPDATE output_native_storage_writes SET write_acknowledged=0").run(),
      "storage publication changed": () => f.sqlite.prepare("UPDATE output_native_storage_writes SET publication_event_id=?").run(f.authorization.eventId),
      "storage hash changed": () => f.sqlite.prepare("UPDATE output_native_storage_writes SET content_sha256=?").run("a".repeat(64)),
      "private input retired": () => f.sqlite.prepare("UPDATE private_content SET redacted_at='retired' WHERE content_id='input'").run(),
      "completion body retired": () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='retired' WHERE private_event_id=?").run(f.completed.eventId),
    };
    if (output === "model3d") cases["GLB request reference missing"] = () => f.mutateJob("request_json", value => { delete value.outputExecution; });
    for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
      f.sqlite.exec("SAVEPOINT original_media_change");
      try {
        mutate(); const after = f.changes();
        assert.equal(await evaluate(f, proof), 0, "complete held assertion must observe the change");
        await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
        assert.equal(f.changes(), after); assert.equal(f.stats.gets, gets); assert.equal(f.stats.writes, 0);
      } finally { f.sqlite.exec("ROLLBACK TO original_media_change; RELEASE original_media_change"); }
      assert.equal(await evaluate(f, proof), 1);
    });
  });

  test(`${output}: late private input retirement during provenance observation prevents authority minting`, async t => {
    withoutNetwork(t);
    const f = await originalOutputsMediaFixture(t, output), custody = await f.read(); let retired = false;
    f.setBeforeRead(sql => {
      if (!retired && sql.includes("bounded_selected_share_jobs LIMIT 2")) {
        retired = true; f.sqlite.prepare("UPDATE private_content SET redacted_at='retired' WHERE content_id='input'").run();
      }
    });
    await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
    assert.ok(retired); assert.deepEqual(f.stats, { gets: output === "video" ? 1 : 0, heads: 0, writes: 0 });
  });

  test(`${output}: a linked imported sponsor job refuses even when payer equals actor`, async t => {
    withoutNetwork(t);
    const f = await originalOutputsMediaFixture(t, output), custody = await f.read();
    f.sqlite.exec(SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_active_jobs(")));
    // Exercise an incomplete imported sponsor record with the real optional DDL.
    // No sponsor admission runs; FK enforcement is restored after synthetic setup.
    f.sqlite.exec("PRAGMA foreign_keys=OFF");
    try { f.insert("experience_sponsor_active_jobs", { actor_user_id: "owner", consumption_id: "synthetic-consumption", job_id: f.jobId }); }
    finally { f.sqlite.exec("PRAGMA foreign_keys=ON"); }
    const before = f.changes();
    await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
    assert.equal(f.changes(), before);
    assert.deepEqual(f.stats, { gets: output === "video" ? 1 : 0, heads: 0, writes: 0 });
  });

  test(`${output}: late sponsor schema appearance invalidates held authority without initializing sponsor state`, async t => {
    withoutNetwork(t);
    const f = await originalOutputsMediaFixture(t, output), custody = await f.read();
    const proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
    f.sqlite.exec(SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_active_jobs(")));
    assert.equal(await evaluate(f, proof), 0);
    // An empty optional table is safe after a fresh schema observation.
    const fresh = await readSelectedOutputShareMediaAuthority(f.env, custody);
    assert.equal(await evaluate(f, fresh), 1);
    assert.deepEqual(f.stats, { gets: output === "video" ? 1 : 0, heads: 0, writes: 0 });
  });
}

test("Video: an exact optional duplicate request reference remains compatible with real native custody", async t => {
  withoutNetwork(t);
  const f = await originalOutputsMediaFixture(t, "video");
  f.mutateJob("request_json", value => { value.outputExecution = { ...f.reference }; });
  const custody = await f.read(), proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(await evaluate(f, proof), 1); assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
});


test("GLB: explicit synthetic byte mode serves the same qualified 400-byte owned original", async t => {
  withoutNetwork(t);
  const f = await originalOutputsMediaFixture(t, "model3d", { mediaBytes: true }), before = f.changes();
  const custody = await f.read(), authority = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(f.stats.gets, 0);
  const bytes = await readNativeRetainedMediaBytes(custody, f.env), copy = await copyCurrentNativeRetainedMediaBytes(bytes, f.env);
  assert.equal(f.expectedBytes.length, 400); assert.deepEqual(copy, f.expectedBytes);
  assert.equal(await evaluate(f, authority), 1); assert.equal(f.changes(), before);
  assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
});

test("Video: the unchanged original donor remains unqualified by the strict public-byte gate", async t => {
  withoutNetwork(t);
  const f = await originalOutputsMediaFixture(t, "video", { mediaBytes: true }), custody = await f.read();
  const inspected = await inspectOutputAsset(f.expectedBytes, "video.mp4", { snapshot: false });
  assert.equal(inspected.status, "inspected"); assert.equal(inspected.kind, "video");
  const gate = await qualifySelectedOutputShareVideo(f.expectedBytes, { sha256: f.selection.mediaSha256, byteLength: f.expectedBytes.length,
    width: inspected.facts.width, height: inspected.facts.height, durationSeconds: inspected.facts.durationSeconds });
  assert.equal(gate.status, "unqualified"); assert.equal(gate.reason, "unqualified_metadata");
  await assert.rejects(readNativeRetainedMediaBytes(custody, f.env));
  assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 }, "cached native bytes do not trigger a fallback GET");
});

test("GLB: current Outputs scale refuses authority while a genuinely witnessed original restore composes", async t => {
  withoutNetwork(t);
  const f = await originalOutputsMediaFixture(t, "model3d"), original = await f.read();
  const authority = await readSelectedOutputShareMediaAuthority(f.env, original);
  for (const action of ["scale", "restore"]) {
    const edited = await retainOriginalOutputsModel3dRevision(f, action), before = f.changes();
    const current = await f.read(edited.selection), snapshot = nativeRetainedMediaCustodySnapshot(current, f.env);
    assert.equal(snapshot.selection.revision, action === "scale" ? 1 : 2);
    assert.equal(snapshot.media.sha256, edited.selection.mediaSha256);
    assert.deepEqual(snapshot.media.model3dRevision, edited.record);
    assert.equal(await evaluate(f, authority), 0, "old original authority also sees current-selection replacement");
    if (action === "scale") await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, current), unavailable);
    else assert.equal(await evaluate(f, await readSelectedOutputShareMediaAuthority(f.env, current)), 1);
    assert.equal(f.changes(), before);
  }
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 });
});
