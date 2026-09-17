import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { videoNotesFixture } from "./helpers/selected-output-share-video-notes-fixture.mjs";
import { forbidSelectedOutputShareNetwork } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";
import { captureNativeStatements, syntheticSnapshot, qualifyCapturedSql } from "./helpers/selected-output-share-d1-qualification.mjs";

const imports = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare, handleSelectedOutputShareApi;
let readSelectedOutputShareMediaAuthority, selectedOutputShareAuthorityAssertion, selectedShareProofStatement;
let SELECTED_OUTPUT_SHARE_SCHEMA, SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
  ({ handleSelectedOutputShareApi } = await import("../worker/selected-output-share-api.ts"));
  ({ readSelectedOutputShareMediaAuthority, selectedOutputShareAuthorityAssertion } = await import("../worker/selected-output-share-authority.ts"));
  ({ selectedShareProofStatement } = await import("../worker/selected-output-share-proof.ts"));
  ({ SELECTED_OUTPUT_SHARE_SCHEMA } = await import("../worker/selected-output-share-schema.ts"));
  ({ SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY } = await import("../src/model/selected-output-share.ts"));
} finally { imports.deregister(); }

const request = (identity, body) => new Request("https://forma.test/detached-video-notes-d1", {
  method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": identity.userId,
    "oai-authenticated-user-email": identity.email }, body: JSON.stringify(body),
});

function permitDedicatedShareWrites(f) {
  const native = f.env.DB;
  f.env.DB = { prepare(sql) {
    const shareWrite = /^WITH selected_share_proof_/u.test(sql)
      && /\)\s+(?:INSERT INTO selected_output_shares\(|UPDATE selected_output_shares SET token_hash=)/u.test(sql);
    return (shareWrite ? f.DB : native).prepare(sql);
  }, batch() { throw new Error("Unexpected sharing batch"); } };
}

for (const spec of [
  { name: "higher current Notes revision", edits: 3, options: {} },
  { name: "recovered retrieved original with current Notes", edits: 1,
    options: { recovered: true, completion: "new", evidenceMode: "retrieved" } },
]) {
  test(`${spec.name}: complete prepare, commit and file SQL compiles under the four recorded D1 query limits`, async t => {
    forbidSelectedOutputShareNetwork(t);
    const f = await videoNotesFixture(t, { ...spec.options, qualifiedBytes: true });
    for (let i = 0; i < spec.edits; i++) await f.editNotes(`Synthetic current Notes ${i + 1}`);
    for (const ddl of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(ddl);
    permitDedicatedShareWrites(f);
    const selection = { ...f.selection(), projectionPolicy: SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY };
    assert.equal(selection.revision, spec.edits);
    const originalHash = f.sqlite.prepare("SELECT content_sha256 FROM artifact_revisions WHERE revision=0").get().content_sha256;
    assert.notEqual(selection.contentSha256, originalHash, "The bridge must preserve a genuinely changed current hash");
    const snapshot = syntheticSnapshot(f.sqlite), captured = captureNativeStatements(f);
    t.after(() => captured.restore());
    const expiry = f.sqlite.prepare("SELECT expires_at FROM document_jobs WHERE job_id=?").get(f.jobId).expires_at;
    const review = { title: "Reviewed synthetic Video", expiresAt: new Date(Math.min(Date.now() + 30_000, Date.parse(expiry) - 1_000)).toISOString() };
    captured.operation("video-notes-prepare");
    const response = await prepareSelectedOutputShare(request(f.identity, { intentKey: `notes-${spec.edits}`, selection, review }), f.env);
    const prepared = await response.json(); assert.equal(response.status, 200, JSON.stringify(prepared));
    assert.deepEqual(prepared.candidate.selection, selection);
    captured.operation("video-notes-commit");
    const committed = await commitSelectedOutputShare(request(f.identity, { candidateId: prepared.candidateId,
      approval: { purpose: "selected-output-read-v1", candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
    const issued = await committed.json(); assert.equal(committed.status, 200, JSON.stringify(issued));
    assert.equal(issued.replayed, false);
    const issue = captured.records.filter(row => row.operation === "video-notes-commit" && row.mode === "run"
      && row.sql.includes(" UPDATE selected_output_shares SET token_hash="));
    assert.equal(issue.length, 1, "Compile the actual final atomic issue statement");
    captured.operation("video-notes-file");
    const gets = f.stats.gets;
    const file = await handleSelectedOutputShareApi(new Request(`https://forma.test/api/selected-output-shared/${issued.share.token}/file`), f.env);
    assert.equal(file.status, 200, await file.clone().text());
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(f.expectedBytes));
    assert.equal(f.stats.gets - gets, 1, "Serve the native reader's exact owned bytes without a second get");
    const qualified = qualifyCapturedSql(snapshot, captured.records);
    assert.deepEqual(qualified.failures, []); assert.ok(qualified.statements.length > 0);
    assert.ok(qualified.maxBytes <= 100_000); assert.ok(qualified.maxBindings <= 100);
    // Application functions execute against actual Node SQLite here. The exact
    // local workerd/D1 lifecycle and race matrix has its own frozen receipt.
  });
}

test("default native Video donor with current Notes: complete authority SQL passes without claiming public-byte qualification", async t => {
  forbidSelectedOutputShareNetwork(t);
  const f = await videoNotesFixture(t);
  await f.editNotes("Synthetic current Notes");
  const snapshot = syntheticSnapshot(f.sqlite), captured = captureNativeStatements(f);
  t.after(() => captured.restore()); captured.operation("video-notes-authority");
  const custody = await f.read(), authority = await readSelectedOutputShareMediaAuthority(f.env, custody);
  const proof = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(authority, f.env));
  assert.equal((await f.env.DB.prepare(`${proof.withSql} SELECT 1 AS admitted WHERE ${proof.sql}`).bind(...proof.bindings).first())?.admitted, 1);
  const qualified = qualifyCapturedSql(snapshot, captured.records);
  assert.deepEqual(qualified.failures, []); assert.ok(qualified.statements.length > 0);
});
