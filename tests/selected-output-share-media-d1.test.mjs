import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareMediaLifecycleFixture, retainAuthoredMedia, forbidSelectedOutputShareNetwork } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";
import { originalOutputsMediaFixture } from "./helpers/selected-output-share-media-outputs-fixture.mjs";
import { captureNativeStatements, syntheticSnapshot, qualifyCapturedSql, SELECTED_SHARE_D1_LIMITS } from "./helpers/selected-output-share-d1-qualification.mjs";
import { compileSqliteExpressionDepth } from "./helpers/selected-output-share-d1-limits.mjs";

const imports = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare, selectedShareProofStatement;
let SELECTED_OUTPUT_SHARE_SCHEMA, SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
  ({ selectedShareProofStatement } = await import("../worker/selected-output-share-proof.ts"));
  ({ SELECTED_OUTPUT_SHARE_SCHEMA } = await import("../worker/selected-output-share-schema.ts"));
  ({ SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY } = await import("../src/model/selected-output-share.ts"));
} finally { imports.deregister(); }

const request = (identity, body) => new Request("https://forma.test/detached-media-d1-regression", {
  method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": identity.userId,
    "oai-authenticated-user-email": identity.email }, body: JSON.stringify(body),
});

/** Test-only allowance for the dedicated share writes. Original Outputs native
 * reads still traverse their existing SELECT-only fixture guard. No application
 * SQL, result, authority or byte reader is rewritten by this wrapper. */
function permitDedicatedShareWrites(f) {
  const native = f.env.DB;
  f.env.DB = { prepare(sql) {
    const shareWrite = /^WITH selected_share_proof_/u.test(sql)
      && /\)\s+(?:INSERT INTO selected_output_shares\(|UPDATE selected_output_shares SET token_hash=)/u.test(sql);
    return (shareWrite ? f.DB : native).prepare(sql);
  }, batch() { throw new Error("Unexpected lifecycle batch"); } };
}

for (const kind of ["video-prefix", "original-outputs-glb"]) {
  test(`${kind}: actual prepare and token UPDATE compile under the four recorded D1 query limits`, async t => {
    let f, selection;
    if (kind === "video-prefix") {
      f = await selectedOutputShareMediaLifecycleFixture(t, "video", { editable: true });
      await retainAuthoredMedia(f); selection = f.selection();
    } else {
      forbidSelectedOutputShareNetwork(t);
      f = await originalOutputsMediaFixture(t, "model3d", { mediaBytes: true });
      for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
      permitDedicatedShareWrites(f);
      selection = { ...f.selection, projectionPolicy: SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY };
    }
    const snapshot = syntheticSnapshot(f.sqlite), captured = captureNativeStatements(f);
    t.after(() => captured.restore());
    const expiry = f.sqlite.prepare("SELECT expires_at FROM document_jobs WHERE job_id=?").get(f.jobId).expires_at;
    const review = { title: "Reviewed synthetic media", expiresAt: new Date(Math.min(Date.now() + 60_000, Date.parse(expiry) - 1_000)).toISOString() };
    captured.operation("media-prepare");
    const response = await prepareSelectedOutputShare(request(f.identity, { intentKey: "d1-" + kind, selection, review }), f.env);
    const prepared = await response.json(); assert.equal(response.status, 200, JSON.stringify(prepared));
    captured.operation("media-commit");
    const committed = await commitSelectedOutputShare(request(f.identity, { candidateId: prepared.candidateId,
      approval: { purpose: "selected-output-read-v1", candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
    const issued = await committed.json(); assert.equal(committed.status, 200, JSON.stringify(issued));
    assert.equal(issued.replayed, false); assert.match(issued.share.token, /^[A-Za-z0-9_-]{32}$/u);
    const updates = captured.records.filter(row => row.operation === "media-commit" && row.mode === "run"
      && row.sql.includes(" UPDATE selected_output_shares SET token_hash="));
    assert.equal(updates.length, 1, "Capture the actual atomic issue statement, not a stand-alone SELECT approximation");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM selected_output_shares WHERE token_hash IS NOT NULL").get().n, 1);
    const qualified = qualifyCapturedSql(snapshot, captured.records);
    assert.deepEqual(qualified.failures, []);
    assert.ok(qualified.statements.length > 0);
    assert.ok(qualified.statements.every(row => row.ok && row.limit === 100));
    assert.ok(qualified.maxBindings <= 100); assert.ok(qualified.maxBytes <= 100_000);
    // These tests execute SQLite and separately compile with strict limits.
    // Actual bundled workerd/D1 execution is independently recorded evidence.
  });
}

test("balanced media issue proof requires every sibling, including false, NULL and absent rows", t => {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE issue_target(id INTEGER PRIMARY KEY,issued INTEGER NOT NULL); INSERT INTO issue_target VALUES(1,0)");
  const run = (proofs, expected) => {
    sqlite.prepare("UPDATE issue_target SET issued=0 WHERE id=1").run();
    const linear = selectedShareProofStatement(proofs), balanced = selectedShareProofStatement(proofs, "balanced");
    assert.equal(balanced.withSql, linear.withSql); assert.deepEqual(balanced.bindings, linear.bindings);
    const sql = `${balanced.withSql} UPDATE issue_target SET issued=1 WHERE id=1 AND issued=0 AND (${balanced.sql})`;
    const compiled = compileSqliteExpressionDepth(sqlite, sql, { bindings: balanced.bindings, limit: 100, queryLimits: SELECTED_SHARE_D1_LIMITS });
    assert.equal(compiled.ok, true, compiled.error);
    assert.equal(sqlite.prepare(sql).run(...balanced.bindings).changes, expected);
    assert.equal(sqlite.prepare("SELECT issued FROM issue_target WHERE id=1").get().issued, expected);
  };
  const admitted = () => Array.from({ length: 7 }, () => ({ sql: "SELECT ? AS admitted", bindings: [1] }));
  run(admitted(), 1);
  for (let missing = 0; missing < 7; missing++) {
    for (const refused of [{ sql: "SELECT ? AS admitted", bindings: [0] },
      { sql: "SELECT ? AS admitted", bindings: [null] }, { sql: "SELECT 1 AS admitted WHERE 0", bindings: [] }]) {
      const proofs = admitted(); proofs[missing] = refused; run(proofs, 0);
    }
  }
});
