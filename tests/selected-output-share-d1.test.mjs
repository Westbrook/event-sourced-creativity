import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, OWNER, PROJECT, DOCUMENT, POLICY, EXPIRY, CONTENT, PURPOSE, digest } from "./helpers/selected-output-share-fixture.mjs";
import { captureNativeStatements, localWorkerdFixture, qualifyCapturedSql, syntheticSnapshot } from "./helpers/selected-output-share-d1-qualification.mjs";

const imports = registerOutputSourceImports();
let lifecycle, handleEventPrivacy, optionalTables, ensureSchema;
try {
  ({ ensureSchema } = await import("../worker/runtime.ts"));
  lifecycle = await import("../worker/selected-output-share-lifecycle.ts");
  ({ handleEventPrivacy } = await import("../worker/privacy-api.ts"));
  const { SPONSOR_ENTITLEMENT_SCHEMA } = await import("../worker/experience-sponsor-entitlement.ts");
  const { SPONSOR_INTAKE_SCHEMA } = await import("../worker/experience-sponsor-intake.ts");
  optionalTables = [
    SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_consumptions(")),
    SPONSOR_ENTITLEMENT_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_active_jobs(")),
    SPONSOR_INTAKE_SCHEMA.find(sql => sql.startsWith("CREATE TABLE experience_sponsor_intakes(")),
  ];
} finally { imports.deregister(); }
const confirmation = { action: "erase-personal-authored-context", confirmation: "ERASE_MY_PERSONAL_AUTHORED_CONTEXT" };
const memoryRef = "synthetic-structured-ledger-body";
const privacyEnvironment = (f, DB = f.baseEnv.DB) => ({ ...f.baseEnv, DB, FORMA_PILOT_COHORT_ID: f.env.FORMA_PILOT_COHORT_ID,
  MEDIA: new Proxy({}, { get() { throw new Error("No privacy media access"); } }) });
function installMemory(f) {
  f.sqlite.exec(readFileSync(new URL("../drizzle/0032_memory_structured_conversation_ledger.sql", import.meta.url), "utf8"));
  const created = "2020-01-01T00:00:00.000Z", content = "SYNTHETIC_PRIVATE_LEDGER_BODY", hash = digest(content);
  const ledger = digest(JSON.stringify([OWNER, OWNER, null, null, PROJECT, DOCUMENT]));
  f.insert("private_content", { content_id: memoryRef, owner_id: OWNER, kind: "memory-structured-ledger", content,
    created_at: created, expires_at: EXPIRY, redacted_at: null });
  f.insert("memory_structured_conversation_heads", { ledger_id: ledger, actor_user_id: OWNER, owner_user_id: OWNER,
    organization_id: null, project_access_id: null, project_id: PROJECT, document_id: DOCUMENT,
    enrollment_id: "synthetic-ledger-enrollment", enrollment_revision: 1, permission_epoch: "synthetic-permission", policy_version: POLICY,
    storage_revision: 1, current_body_ref: memoryRef, current_body_hash: hash, annotation_count: 1,
    coverage_after_sequence: 0, coverage_through_sequence: 1, state: "active", first_terminal_at: null, cleanup_turn: 0,
    expires_at: EXPIRY, created_at: created, updated_at: created });
  f.insert("memory_structured_conversation_revisions", { ledger_id: ledger, revision: 1, predecessor_revision: 0,
    predecessor_hash: null, body_ref: memoryRef, body_hash: hash, schema_version: 1, recipe_version: "native-declared-ledger-v1",
    annotation_count: 1, coverage_after_sequence: 0, coverage_through_sequence: 1, created_at: created, expires_at: EXPIRY });
}
async function fixture(t, { pilot = false, mask = 0, memory = false, slot = "actor", kind = "short_story" } = {}) {
  const f = await selectedOutputShareFixture(t, { slot, kind });
  if (pilot) f.installPilot();
  for (let index = 0; index < optionalTables.length; index++) if (mask & (1 << index)) f.sqlite.exec(optionalTables[index]);
  if (memory) installMemory(f);
  return f;
}
async function responseBody(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
async function exercise(f, env, privacyEnv, capture) {
  capture.operation("prepare");
  const prepared = await responseBody(await lifecycle.prepareSelectedOutputShare(f.request({ intentKey: "d1-qualified-intent",
    selection: f.selection(), review: f.review() }), env));
  const command = { candidateId: prepared.candidateId, approval: { purpose: PURPOSE,
    candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } };
  capture.operation("commit");
  const issued = await responseBody(await lifecycle.commitSelectedOutputShare(f.request(command), env));
  assert.ok(issued.share.token); assert.equal(issued.replayed, false);
  capture.operation("commit-replay");
  const replay = await responseBody(await lifecycle.commitSelectedOutputShare(f.request(command), env));
  assert.equal(replay.replayed, true); assert.equal(Object.hasOwn(replay.share, "token"), false);
  capture.operation("read");
  assert.deepEqual(await responseBody(await lifecycle.readSelectedOutputShare(new Request("https://forma.test/api/selected-output-shared/token"), env, issued.share.token)), prepared.candidate.publicOutput);
  capture.operation("revoke");
  await responseBody(await lifecycle.revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), env, issued.share.shareId));
  capture.operation("read-revoked");
  await responseBody(await lifecycle.readSelectedOutputShare(new Request("https://forma.test/api/selected-output-shared/token"), env, issued.share.token), 404);
  capture.operation("privacy");
  const erased = await responseBody(await handleEventPrivacy(f.request(confirmation, { origin: "https://forma.test" }), privacyEnv));
  assert.equal(erased.selectedOutputShareMetadataMinimizedCount, 1);
  assert.equal(erased.selectedOutputShareTombstonesRetained, true);
  assert.equal(erased.authoredContentErasurePending, false);
  assert.equal(erased.finishedOutputsRetained, true);
  return erased;
}
function qualified(t, snapshot, records) {
  assert.equal(globalThis.fetch.mock.callCount(), 0, "production handlers must not attempt Node network access");
  const result = qualifyCapturedSql(snapshot, records);
  t.diagnostic(JSON.stringify({ strictD1: { qualified: result.statements.length - result.failures.length, total: result.statements.length, failures: result.failures, maxBindings: result.maxBindings, maxBytes: result.maxBytes }, executed: records.length }));
  assert.deepEqual(result.failures, [], "every actually generated full statement must fit all four D1 limits");
  assert.ok(result.statements.length > 0);
  for (const operation of ["prepare", "commit", "commit-replay", "read", "revoke", "privacy"]) assert.ok(records.some(row => row.operation === operation), operation);
}
async function verifyMemory(DB) {
  const head = await DB.prepare("SELECT * FROM memory_structured_conversation_heads").first();
  assert.equal(head.state, "retired"); assert.equal(head.cleanup_turn, 0); assert.ok(head.first_terminal_at);
  for (const field of ["enrollment_id", "enrollment_revision", "permission_epoch", "policy_version", "current_body_ref", "current_body_hash", "annotation_count", "coverage_after_sequence", "coverage_through_sequence", "expires_at"]) assert.equal(head[field], null, field);
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM memory_structured_conversation_revisions").first()).n, 0);
  const body = await DB.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").bind(memoryRef).first();
  assert.equal(body.content, ""); assert.ok(body.redacted_at);
}

for (const pilot of [false, true]) for (let mask = 0; mask < 8; mask++) test(`all D1 limits cover ${pilot ? "pilot" : "ordinary"} lifecycle with exact optional sponsor mask ${mask}`, { timeout: 120000 }, async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or provider calls"); });
  const f = await fixture(t, { pilot, mask, slot: mask % 2 ? "actor" : null, kind: ["short_story", "scene", "slides"][mask % 3] });
  const snapshot = syntheticSnapshot(f.sqlite), capture = captureNativeStatements(f);
  t.after(() => capture.restore());
  await exercise(f, f.env, privacyEnvironment(f), capture);
  qualified(t, snapshot, capture.records);
});

for (const pilot of [false, true]) test(`all D1 limits cover complete ${pilot ? "pilot" : "ordinary"} structured-memory privacy composition`, { timeout: 120000 }, async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or provider calls"); });
  const f = await fixture(t, { pilot, mask: 7, memory: true }), original = f.raw();
  const snapshot = syntheticSnapshot(f.sqlite), capture = captureNativeStatements(f); t.after(() => capture.restore());
  await exercise(f, f.env, privacyEnvironment(f), capture);
  await verifyMemory(f.DB);
  assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content, original);
  assert.ok(capture.records.some(row => row.operation === "privacy" && row.sql.includes("heads_json")), "actual structured ledger retirement was reached");
  qualified(t, snapshot, capture.records);
});

for (const pilot of [false, true]) for (const kind of ["short_story", "scene", "slides"]) test(`actual local workerd executes ${pilot ? "pilot" : "ordinary"} ${kind} complete lifecycle`, { timeout: 120000 }, async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No Node network or provider calls"); });
  const mask = kind === "short_story" ? 0 : 7;
  const f = await fixture(t, { pilot, mask, slot: mask ? "actor" : null, kind });
  const snapshot = syntheticSnapshot(f.sqlite), local = await localWorkerdFixture(t, snapshot);
  const env = { ...f.env, DB: local.DB }, privacyEnv = privacyEnvironment(f, local.DB);
  // Match the native fixture: finish existing schema initialization before capture.
  // Its temporary migration-guard tables are not part of a lifecycle request.
  await ensureSchema(privacyEnv); local.records.length = 0;
  await exercise(f, env, privacyEnv, local);
  t.diagnostic(JSON.stringify({ workerdFullFlow: { pilot, kind, prepared: 200, issued: 200, duplicateApprovalReplay: 200, publicRead: 200, revoked: 200, revokedRead: 404, privacy: 200 }, egress: local.egress }));
  qualified(t, snapshot, local.records);
  assert.deepEqual(local.egress, []);
});

test("actual local workerd executes selected-share erasure with complete structured-memory terminal proofs", { timeout: 120000 }, async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No Node network or provider calls"); });
  const f = await fixture(t, { pilot: true, mask: 7, memory: true }), original = f.raw();
  const snapshot = syntheticSnapshot(f.sqlite), local = await localWorkerdFixture(t, snapshot);
  const privacyEnv = privacyEnvironment(f, local.DB);
  await ensureSchema(privacyEnv); local.records.length = 0;
  await exercise(f, { ...f.env, DB: local.DB }, privacyEnv, local);
  t.diagnostic(JSON.stringify({ workerdFullFlow: { pilot: true, structuredMemory: true, prepared: 200, issued: 200, duplicateApprovalReplay: 200, publicRead: 200, revoked: 200, revokedRead: 404, privacy: 200 }, egress: local.egress }));
  await verifyMemory(local.DB);
  assert.equal((await local.DB.prepare("SELECT content FROM private_content WHERE content_id=?").bind(CONTENT).first()).content, original);
  qualified(t, snapshot, local.records);
  assert.deepEqual(local.egress, []);
});
