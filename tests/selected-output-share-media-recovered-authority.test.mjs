import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { recoveredOutputsMediaFixture } from "./helpers/selected-output-share-media-recovery-fixture.mjs";
import { originalOutputsMediaFixture, retainOriginalOutputsModel3dRevision } from "./helpers/selected-output-share-media-outputs-fixture.mjs";
import { selectedShareProofStatement } from "../worker/selected-output-share-proof.ts";
const imports = registerOutputSourceImports();
let readSelectedOutputShareMediaAuthority, selectedOutputShareAuthorityAssertion, selectedOutputShareAuthoritySnapshot;
let nativeRetainedMediaCustodySnapshot;
try {
  ({ readSelectedOutputShareMediaAuthority, selectedOutputShareAuthorityAssertion, selectedOutputShareAuthoritySnapshot }
    = await import("../worker/selected-output-share-authority.ts"));
  ({ nativeRetainedMediaCustodySnapshot } = await import("../worker/native-retained-media-custody.ts"));
} finally { imports.deregister(); }
const unavailable = /selected_output_share_authority_unavailable/u;
const evaluate = async (f, proof) => {
  const query = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(proof, f.env));
  return (await f.env.DB.prepare(`${query.withSql} SELECT 1 AS admitted WHERE ${query.sql}`).bind(...query.bindings).first())?.admitted ?? 0;
};
const offline = t => { const old = globalThis.fetch; globalThis.fetch = () => { throw Error("No network in recovered authority fixture"); }; t.after(() => { globalThis.fetch = old; }); };

for (const output of ["video", "model3d"]) for (const completion of ["new", "existing"])
  for (const evidenceMode of output === "video" ? ["original", "retrieved"] : ["original"])
    test(`${output} ${completion}/${evidenceMode}: actual retained completed recovery composes authority after historical lease expiry`, async t => {
      offline(t);
      const f = await recoveredOutputsMediaFixture(t, output, { completion, evidenceMode }), before = f.changes(), custody = await f.read();
      const gets = f.stats.gets, proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
      assert.equal(await evaluate(f, proof), 1);
      assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).completionId, f.completed.eventId);
      assert.ok(Date.parse(f.recovery.expiresAt) < Date.now());
      assert.ok(Date.parse(selectedOutputShareAuthoritySnapshot(proof, f.env).expiresAt) > Date.now());
      assert.equal(f.changes(), before); assert.equal(f.stats.gets, gets); assert.equal(f.stats.writes, 0);
    });

for (const output of ["video", "model3d"]) test(`${output}: closed recovery grammar rejects metadata the actual native reader alone accepts`, async t => {
  offline(t);
  const f = await recoveredOutputsMediaFixture(t, output);
  const change = fn => f.mutateJob("result_json", value => fn(value[f.recoveryKey], value));
  const cases = {
    "non-UUID historical token": () => change(cp => { cp.token = "bad-token"; }),
    "invalid historical timestamp": () => change(cp => { cp.expiresAt = "yesterday"; }),
    "wrong completion identity": () => change(cp => { cp.completionEventId = "other"; }),
    "wrong prior status": () => change(cp => { cp.priorStatus = "running"; }),
    "malformed prior timestamp": () => change(cp => { cp.priorCompletedAt = 17; }),
    "nontext prior error": () => change(cp => { cp.priorErrorCode = {}; }),
    "extra checkpoint authority field": () => change(cp => { cp.unexpected = true; }),
    "nested recovery key outside exception": () => change((_cp, result) => { result.extra = { recovery: false }; }),
    "sponsor nested under historical field": () => change(cp => { cp.extra = { sponsor: null }; }),
    "cross-kind recovery": () => change((_cp, result) => { result[output === "video" ? "outputModel3dRecovery" : "outputVideoRecovery"] = {}; }),
    "recovery marker in request": () => f.mutateJob("request_json", request => { request.recovery = null; }),
    "recovery marker in authorization": () => f.mutateAuthorization(body => { body.output_command_envelope.recovery = null; }),
    "recovered false on recovery client": () => f.mutateCompletion(body => { body.recovered = false; }),
    "recovered marker absent on recovery client": () => f.mutateCompletion(body => { delete body.recovered; }),
    "nested private recovery marker": () => f.mutateCompletion(body => { body.extra = { recovered: true }; }),
  };
  if (output === "video") cases["storage identity mismatch"] = () => change(cp => { cp.storageKey = "owner/generated/other.mp4"; });
  else Object.assign(cases, {
    "original result digest malformed": () => change(cp => { cp.originalResultSha256 = "bad"; }),
    "immutable history missing": () => change((_cp, result) => { delete result.outputModel3dRecoveryHistory; }),
    "history last identity mismatch": () => change((_cp, result) => { result.outputModel3dRecoveryHistory[0].token = "66666666-7777-4888-8999-aaaaaaaaaaaa"; }),
    "companion files carry different token": () => change((_cp, result) => { result.outputModel3dRecoveryFiles[0].token = "66666666-7777-4888-8999-aaaaaaaaaaaa"; }),
    "companion envelope malformed": () => change((_cp, result) => { result.outputModel3dRecoveryEnvelopes[0].sha256 = "bad"; }),
  });
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT recovered_grammar");
    try {
      mutate(); const before = f.changes(), custody = await f.read(), gets = f.stats.gets;
      await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
      assert.equal(f.changes(), before); assert.equal(f.stats.gets, gets); assert.equal(f.stats.writes, 0);
    } finally { f.sqlite.exec("ROLLBACK TO recovered_grammar; RELEASE recovered_grammar"); }
  });
});

test("Video retrieved proof retires when either separately retained decisive envelope is erased", async t => {
  offline(t);
  const f = await recoveredOutputsMediaFixture(t, "video", { evidenceMode: "retrieved" });
  const custody = await f.read(), proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  for (const phase of ["status", "result"]) {
    f.sqlite.exec("SAVEPOINT retrieved_body");
    try {
      f.sqlite.prepare("UPDATE private_content SET redacted_at='retired' WHERE content_id=?").run(`recovery-video-${phase}`);
      assert.equal(await evaluate(f, proof), 0);
      await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
    } finally { f.sqlite.exec("ROLLBACK TO retrieved_body; RELEASE retrieved_body"); }
  }
  assert.equal(f.stats.gets, 1);
});

for (const completion of ["new", "existing"]) test(`GLB ${completion}: recovered original explicit current restore preserves revision2 and original proof`, async t => {
  offline(t);
  const f = await recoveredOutputsMediaFixture(t, "model3d", { completion });
  await retainOriginalOutputsModel3dRevision(f, "scale");
  const restored = await retainOriginalOutputsModel3dRevision(f, "restore"), before = f.changes();
  const custody = await f.read(restored.selection), native = nativeRetainedMediaCustodySnapshot(custody, f.env);
  assert.equal(native.selection.revision, 2); assert.deepEqual({ ...native.selection }, restored.selection);
  assert.equal(native.media.sha256, f.selection.mediaSha256); assert.equal(native.media.model3dRevision, null);
  const proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(await evaluate(f, proof), 1); assert.equal(f.changes(), before); assert.equal(f.stats.gets, 0);
  f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at='retired' WHERE revision=0").run();
  assert.equal(await evaluate(f, proof), 0);
  await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), unavailable);
});

test("GLB: a second retained and storage-witnessed GLB cannot replace receipt primary for restored authority", async t => {
  offline(t);
  const f = await originalOutputsMediaFixture(t, "model3d", { secondaryModel3d: true, selectSecondaryModel3d: true });
  const original = await f.read(), snapshot = nativeRetainedMediaCustodySnapshot(original, f.env);
  const payload = JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completed.eventId).private_json);
  assert.equal(payload.settings.model3d_files.length, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_native_storage_writes WHERE status='written' AND write_acknowledged=1").get().n, 2);
  assert.equal(snapshot.media.sha256, payload.settings.model3d_files[1].sha256);
  assert.notEqual(snapshot.media.sha256, payload.settings.output_model3d.receipt.primarySha256);
  const scaled = await retainOriginalOutputsModel3dRevision(f, "scale"); await f.read(scaled.selection);
  const restored = await retainOriginalOutputsModel3dRevision(f, "restore");
  await assert.rejects(f.read(restored.selection));
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 });
});

test("Video retrieved legacy token fallback preserves the native decisive-envelope rule", async t => {
  offline(t);
  const f = await recoveredOutputsMediaFixture(t, "video", { evidenceMode: "retrieved" });
  f.mutateJob("result_json", result => {
    delete result.outputVideoRecovery.evidenceToken;
    result.outputVideoRecoveryEnvelopes.forEach(envelope => { envelope.token = result.outputVideoRecovery.token; });
  });
  const custody = await f.read(), gets = f.stats.gets;
  assert.equal(await evaluate(f, await readSelectedOutputShareMediaAuthority(f.env, custody)), 1);
  assert.equal(f.stats.gets, gets);
});

test("GLB historical accepted submission can precede the independently proven completed paid receipt", async t => {
  offline(t);
  const f = await recoveredOutputsMediaFixture(t, "model3d");
  f.mutateJob("result_json", result => {
    const paid = result.outputModel3dRecovery.originalSubmission;
    const accepted = Object.fromEntries(["clientRequestId", "provider", "operation", "model", "providerRequestId"].map(key => [key, paid[key]]));
    accepted.status = "accepted";
    result.outputModel3dRecovery.originalSubmission = accepted;
    result.outputModel3dRecoveryHistory.at(-1).originalSubmission = accepted;
  });
  // The old originalResultSha256 remains historical opaque audit metadata. This
  // test does not claim access to or validation of the pre-lease result bytes.
  const custody = await f.read(), before = f.changes();
  assert.equal(await evaluate(f, await readSelectedOutputShareMediaAuthority(f.env, custody)), 1);
  assert.equal(f.changes(), before); assert.equal(f.stats.gets, 0);
});
