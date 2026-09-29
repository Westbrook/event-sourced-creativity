import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareMediaLifecycleFixture as fixture, OWNER, EMAIL, DOCUMENT, ARTIFACT, CONTENT, PROJECT, JOB, PURPOSE, digest } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";
import { compileSqliteExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY as audioPolicy } from "../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_POLICY as videoPolicy, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY as encoderPolicy } from "../src/model/selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_POLICY as modelPolicy, SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY as texturePolicy } from "../src/model/selected-output-share-model3d.ts";
const imports = registerOutputSourceImports();
let listSelectedOutputShares, prepareSelectedOutputShare, commitSelectedOutputShare, revokeSelectedOutputShare;
try {
  ({ listSelectedOutputShares } = await import("../worker/selected-output-share-management.ts"));
  ({ prepareSelectedOutputShare, commitSelectedOutputShare, revokeSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
} finally { imports.deregister(); }
const profiles = [["audio", {}, audioPolicy], ["video", {}, videoPolicy], ["video", { encoder: true }, encoderPolicy],
  ["model3d", {}, modelPolicy], ["model3d", { textured: true }, texturePolicy]];
const created = "2020-01-01T00:00:00.000Z", issuedAt = "2020-01-01T00:00:01.000Z", expiry = "2099-01-01T00:00:00.000Z";
const metadataRead = sql => sql.startsWith("WITH permitted AS (");
const cursor = (createdAt, shareId) => Buffer.from(JSON.stringify([createdAt, shareId])).toString("base64url");
const request = (params = {}, headers = {}) => new Request(`https://forma.test/api/selected-output-shares?${new URLSearchParams({ documentId: DOCUMENT, artifactId: ARTIFACT, ...params })}`, {
  headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
});
async function issue(f) {
  const preparedResponse = await prepareSelectedOutputShare(f.request({ intentKey: "owner-reviewed-media", selection: f.selection(), review: f.review() }), f.env);
  const prepared = await preparedResponse.json(); assert.equal(preparedResponse.status, 200, JSON.stringify(prepared));
  const response = await commitSelectedOutputShare(f.request({ candidateId: prepared.candidateId,
    approval: { purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return { prepared, ...value };
}
function restrictToMetadata(f, hook) {
  const before = { changes: f.changes(), media: f.mediaCalls.length, writes: f.writes.length, statements: f.statements.length };
  const assertMetadataStatement = (sql, mode) => {
    assert.match(sql, /^(?:WITH|SELECT) /u); assert.notEqual(mode, "run");
    assert.doesNotMatch(sql, /\b(?:private_content|event_private_payloads|document_jobs|events|output_operation_slots|output_execution_grants|budget_reservations|cost_budget_reservations)\b/u);
  };
  f.setBeforeStatement((sql, bindings, mode) => { assertMetadataStatement(sql, mode); return hook?.(sql, bindings, mode); });
  return { ...before, verify({ mutations = 0 } = {}) {
    // Re-audit recorded attempts after the handler returns: an expected404
    // must not hide a caught assertion from an unauthorized native-source read.
    for (const statement of f.statements.slice(before.statements)) assertMetadataStatement(statement.sql, statement.mode);
    assert.equal(f.mediaCalls.length, before.media); assert.equal(f.writes.length, before.writes); assert.equal(f.changes() - before.changes, mutations);
  } };
}
async function list(f, req = request()) {
  const response = await listSelectedOutputShares(req, f.env), body = await response.json();
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer"); return { response, body };
}
// Synthetic stored metadata rows exercise bounded listing and corruption
// refusal only. They are not issued by a provider and cannot grant file access.
function seed(f, shareId, patch = {}) {
  const row = { share_id: shareId, purpose: PURPOSE, replay_key: digest("replay:" + shareId), owner_id: OWNER, owner_email: EMAIL,
    intent_key: "intent:" + shareId, project_id: PROJECT, job_id: JOB, completion_event_id: f.completion.eventId,
    selection_json: JSON.stringify(f.selection()), review_title: "Reviewed " + shareId, source_expires_at: expiry, provenance_expires_at: expiry,
    expires_at: expiry, candidate_sha256: digest("candidate:" + shareId), issuer_authority_sha256: digest("authority:" + shareId),
    created_at: created, token_hash: digest("token:" + shareId), issued_at: issuedAt, revoked_at: null, minimized_at: null, ...patch };
  f.insert("selected_output_shares", row); return row;
}
for (const [output, options, profile] of profiles) test(`${profile}: actual prepare/issue has metadata-only listing and can be revoked`, async t => {
  const f = await fixture(t, output, options), issued = await issue(f), stored = f.shares()[0];
  let guard = restrictToMetadata(f), result = await list(f); assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { shares: [{ shareId: issued.share.shareId, title: "Reviewed media output", output, revision: 0,
    expiresAt: issued.share.expiresAt, issuedAt: stored.issued_at }], nextCursor: null });
  const serialized = JSON.stringify(result.body);
  for (const privateValue of [issued.share.token, OWNER, EMAIL, ARTIFACT, CONTENT, f.url, f.key, "Private", "source", "candidateSha256", "mediaSha256", "policy", "available", "active"])
    assert.equal(serialized.includes(privateValue), false, privateValue);
  assert.equal(f.statements.length - guard.statements, 2, "one readiness read and one owner/schema/metadata SELECT"); guard.verify();
  f.setBeforeStatement(null);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  guard = restrictToMetadata(f); result = await list(f); assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { shares: [], nextCursor: null }); guard.verify();
});
test("media remains manageable after source expiry, redaction, creator withdrawal and canonical email change", async t => {
  const f = await fixture(t), issued = await issue(f);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
  f.sqlite.prepare("UPDATE users SET role='viewer',consent_version=NULL WHERE user_id=?").run(OWNER);
  let guard = restrictToMetadata(f), result = await list(f); assert.equal(result.response.status, 200); assert.equal(result.body.shares[0].shareId, issued.share.shareId); guard.verify();
  f.sqlite.prepare("UPDATE users SET email='current@example.test' WHERE user_id=?").run(OWNER);
  guard = restrictToMetadata(f); assert.equal((await list(f)).response.status, 404);
  result = await list(f, request({}, { "oai-authenticated-user-email": "current@example.test" })); assert.equal(result.response.status, 200); guard.verify();
  f.setBeforeStatement(null);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, { "oai-authenticated-user-email": "current@example.test" }, "DELETE"), f.env, issued.share.shareId)).status, 200);
  guard = restrictToMetadata(f); result = await list(f, request({}, { "oai-authenticated-user-email": "current@example.test" }));
  assert.equal(result.response.status, 200); assert.deepEqual(result.body.shares, []); guard.verify();
});
test("media and text metadata share bounded stable pagination without fetching any native source", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 57; index++) {
    const [output, , policy] = profiles[index % profiles.length];
    let selection = { ...f.selection(), output, policy };
    if (index === 0) selection = { output: "short_story", documentId: DOCUMENT, artifactId: ARTIFACT, revision: 0, contentSha256: "a".repeat(64) };
    seed(f, `mixed-${String(index).padStart(3, "0")}`, { selection_json: JSON.stringify(selection) });
  }
  const guard = restrictToMetadata(f), first = await list(f); assert.equal(first.response.status, 200); assert.equal(first.body.shares.length, 50);
  assert.equal(first.body.nextCursor, cursor(created, "mixed-007"));
  const second = await list(f, request({ cursor: first.body.nextCursor })); assert.equal(second.response.status, 200);
  assert.equal(second.body.shares.length, 7); assert.equal(second.body.nextCursor, null);
  assert.equal(second.body.shares.at(-1).output, "short_story");
  assert.deepEqual([...first.body.shares, ...second.body.shares].map(row => row.shareId), Array.from({ length: 57 }, (_, index) => `mixed-${String(56 - index).padStart(3, "0")}`));
  guard.verify(); assert.equal(f.mediaCalls.length, 0);
});
for (const [name, patch] of [
  ["future projection", { projectionPolicy: "selected-output-share-glb-current-view-v1" }], ["MP3 policy", { policy: "selected-output-share-mp3-v1" }],
  ["cross-kind video policy", { policy: videoPolicy }], ["cross-kind GLB policy", { policy: modelPolicy }], ["extra private field", { prompt: "private" }],
  ["uppercase media digest", { mediaSha256: "A".repeat(64) }], ["short media digest", { mediaSha256: "a".repeat(63) }],
  ["embedded NUL media digest", { mediaSha256: "a".repeat(32) + "\u0000" + "a".repeat(31) }],
  ["NUL-suffixed media digest", { mediaSha256: "a".repeat(64) + "\u0000private" }], ["invalid content digest", { contentSha256: "not-a-hash" }],
  ["boolean revision", { revision: true }], ["fractional revision", { revision: 0.5 }], ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 1 }],
]) test(`stored media ${name} refuses the whole metadata page without native reads`, async t => {
  const f = await fixture(t); seed(f, "good-row"); seed(f, "invalid-row", { selection_json: JSON.stringify({ ...f.selection(), ...patch }) });
  const guard = restrictToMetadata(f), result = await list(f); assert.equal(result.response.status, 404);
  assert.deepEqual(result.body, { error: "selected_output_share_unavailable" }); guard.verify(); assert.equal(f.mediaCalls.length, 0);
});
for (const field of ["mediaSha256", "policy", "projectionPolicy"]) test(`duplicate stored ${field} cannot satisfy closed media selection or cursor`, async t => {
  const f = await fixture(t), selection = f.selection();
  const duplicate = JSON.stringify(selection).slice(0, -1) + `,${JSON.stringify(field)}:${JSON.stringify(selection[field])}}`;
  seed(f, "duplicate", { selection_json: duplicate }); const guard = restrictToMetadata(f);
  assert.equal((await list(f)).response.status, 404); assert.equal((await list(f, request({ cursor: cursor(created, "duplicate") }))).response.status, 404);
  guard.verify();
});
test("the lookahead media row must pass full profile validation before any first page is returned", async t => {
  const f = await fixture(t); for (let index = 0; index < 51; index++) seed(f, `lookahead-${String(index).padStart(3, "0")}`,
    index === 0 ? { selection_json: JSON.stringify({ ...f.selection(), projectionPolicy: "future" }) } : {});
  const guard = restrictToMetadata(f), result = await list(f); assert.equal(result.response.status, 404); assert.equal(result.body.shares, undefined); guard.verify();
});
for (const fault of ["owner", "email", "schema"]) test(`last media metadata statement rejects late ${fault} withdrawal`, async t => {
  const f = await fixture(t); seed(f, "before-boundary"); let reached = false, mutations = 0;
  const guard = restrictToMetadata(f, sql => {
    if (!metadataRead(sql)) return; reached = true;
    if (fault === "owner") { f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(OWNER); mutations = 1; }
    if (fault === "email") { f.sqlite.prepare("UPDATE users SET email='other@example.test' WHERE user_id=?").run(OWNER); mutations = 1; }
    if (fault === "schema") f.sqlite.exec("DROP TRIGGER selected_output_share_immutable");
  });
  const result = await list(f); assert.ok(reached); assert.equal(result.response.status, 404); guard.verify({ mutations });
});
test("a media pagination anchor revoked after readiness cannot authorize the next page", async t => {
  const f = await fixture(t); seed(f, "anchor"); seed(f, "a-earlier"); let reached = false;
  const guard = restrictToMetadata(f, sql => { if (metadataRead(sql)) { reached = true; f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=? WHERE share_id='anchor'").run(new Date().toISOString()); } });
  const result = await list(f, request({ cursor: cursor(created, "anchor") })); assert.ok(reached); assert.equal(result.response.status, 404); guard.verify({ mutations: 1 });
});
test("new media metadata SQL compiles with strict D1 limits and executes actual SQLite for both cursor forms", async t => {
  const f = await fixture(t); for (let index = 0; index < 51; index++) seed(f, `strict-${String(index).padStart(3, "0")}`);
  const compiled = [];
  const guard = restrictToMetadata(f, (sql, bindings) => {
    if (!metadataRead(sql)) return;
    const result = compileSqliteExpressionDepth(f.sqlite, sql, { bindings, limit: 100, queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100_000 } });
    assert.equal(result.ok, true, result.error); compiled.push(result);
  });
  const first = await list(f); assert.equal(first.response.status, 200); assert.equal(first.body.shares.length, 50);
  const second = await list(f, request({ cursor: first.body.nextCursor })); assert.equal(second.response.status, 200); assert.equal(second.body.shares.length, 1);
  assert.equal(compiled.length, 2); guard.verify();
  // Strict EXPLAIN is a compiler-limit check. Actual workerd execution is
  // separately recorded by the integration verifier, not claimed here.
});
