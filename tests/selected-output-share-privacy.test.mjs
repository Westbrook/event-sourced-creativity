import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, CONTENT, PURPOSE, digest } from "./helpers/selected-output-share-fixture.mjs";

const sourceImports = registerOutputSourceImports();
let handleEventPrivacy, pendingMemoryPrivacy, prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare, SELECTED_OUTPUT_SHARE_SCHEMA;
try {
  ({ handleEventPrivacy } = await import("../worker/privacy-api.ts"));
  ({ prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
  ({ SELECTED_OUTPUT_SHARE_SCHEMA } = await import("../worker/selected-output-share-schema.ts"));
  const pendingUrl = new URL("../worker/privacy-api.ts?selected-share-pending-memory-port", import.meta.url).href;
  const memoryPort = new URL("./helpers/selected-output-share-privacy-memory-port.mjs", import.meta.url).href;
  const port = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === pendingUrl && specifier === "./memory-live-store.ts") return { url: memoryPort, shortCircuit: true };
    return next(specifier, context);
  } });
  try { ({ handleEventPrivacy: pendingMemoryPrivacy } = await import(pendingUrl)); }
  finally { port.deregister(); }
} finally { sourceImports.deregister(); }

const confirmation = Object.freeze({ action: "erase-personal-authored-context", confirmation: "ERASE_MY_PERSONAL_AUTHORED_CONTEXT" });
const privateFields = ["owner_id", "owner_email", "intent_key", "project_id", "job_id", "completion_event_id", "selection_json",
  "review_title", "source_expires_at", "provenance_expires_at", "expires_at", "candidate_sha256", "issuer_authority_sha256", "created_at"];
const publicRequest = () => new Request("https://forma.test/api/selected-output-shared/test");
const shareWrite = sql => /^UPDATE (?:main\.)?selected_output_shares\b/u.test(sql);
const genericWrite = sql => /^UPDATE event_private_payloads SET private_json=''/u.test(sql);
const acknowledgmentError = { error: "memory_erasure_unconfirmed", authoredContentErasurePending: true,
  memoryJobCleanupPending: true, continuationRequired: true };

async function fixture(t, options = {}) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("privacy integration must not call providers or network"); });
  const f = await selectedOutputShareFixture(t, options);
  f.privacyEnv = { ...f.baseEnv, MEDIA: new Proxy({}, { get() { throw new Error("privacy integration must not access media"); } }) };
  f.erase = (body = confirmation, headers = {}, handler = handleEventPrivacy) => handler(f.request(body, { origin: "https://forma.test", ...headers }), f.privacyEnv);
  return f;
}
async function prepare(f, intentKey) {
  const body = { intentKey, selection: f.selection(), review: f.review() };
  const response = await prepareSelectedOutputShare(f.request(body), f.env), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return { ...result, body };
}
async function issue(f, intentKey) {
  const prepared = await prepare(f, intentKey);
  const command = { candidateId: prepared.candidateId, approval: { purpose: PURPOSE,
    candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } };
  const response = await commitSelectedOutputShare(f.request(command), f.env), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return { ...result, prepared, command };
}
function insertCopy(f, source, patch) {
  const row = { ...source, ...patch };
  f.insert("selected_output_shares", row);
  return row;
}
function footprint(f) {
  return structuredClone({ shares: f.shares(), content: f.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
    envelopes: f.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all(),
    events: f.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all(),
    budgets: f.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),
    costs: f.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all() });
}
function minimized(row, original) {
  for (const field of privateFields) assert.equal(row[field], null, field);
  assert.ok(row.revoked_at); assert.ok(row.minimized_at);
  for (const field of ["share_id", "purpose", "replay_key", "token_hash", "issued_at"]) assert.equal(row[field], original[field], field);
}
function intercept(f, { before, after } = {}) {
  const db = f.privacyEnv.DB, original = db.batch;
  let calls = 0;
  db.batch = async statements => {
    if (!statements.some(statement => shareWrite(statement.sql))) return original.call(db, statements);
    calls++;
    const selected = before ? before(statements) : statements;
    const results = await original.call(db, selected);
    return after ? after(results, statements) : results;
  };
  return { get calls() { return calls; }, restore() { db.batch = original; } };
}
async function unconfirmed(response) {
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), acknowledgmentError);
}

// Real native source, lifecycle preparation/issuance, confirmed privacy handler,
// optional share-retention helper and SQLite transaction. No paid outputs.
test("confirmed personal erasure retires every own selected share and preserves finished outputs and other owners", async t => {
  const f = await fixture(t), issued = await issue(f, "issued-intent"), prepared = await prepare(f, "unissued-intent");
  const originalIssued = { ...f.shares().find(row => row.share_id === issued.share.shareId) };
  const old = "2020-01-01T00:00:00.000Z", oldExpiry = "2020-01-02T00:00:00.000Z";
  insertCopy(f, originalIssued, { share_id: "already-expired", intent_key: "expired-intent", replay_key: digest("expired-test-key"),
    created_at: old, issued_at: old, expires_at: oldExpiry, token_hash: digest("expired-test-token") });
  insertCopy(f, originalIssued, { share_id: "already-revoked", intent_key: "revoked-intent", replay_key: digest("revoked-test-key"),
    revoked_at: new Date().toISOString(), token_hash: digest("revoked-test-token") });
  const foreign = insertCopy(f, originalIssued, { share_id: "foreign-owner-share", owner_id: "foreign-owner", owner_email: "foreign@example.test",
    intent_key: "foreign-intent", replay_key: digest("foreign-test-key"), token_hash: digest("foreign-test-token") });
  const before = footprint(f);
  const response = await f.erase(), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.selectedOutputShareMetadataMinimizedCount, 4);
  assert.equal(body.selectedOutputShareTombstonesRetained, true);
  assert.equal(body.authoredContentErasurePending, false);
  assert.equal(body.finishedOutputsRetained, true); assert.equal(body.sharedOrganizationContextRetained, true);
  assert.equal(body.uploadedFilesRetained, true); assert.equal(body.otherDevicesAndBackupsPurged, false);
  for (const row of f.shares()) {
    if (row.share_id === foreign.share_id) assert.deepEqual({ ...row }, foreign);
    else minimized(row, before.shares.find(original => original.share_id === row.share_id));
  }
  assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(CONTENT) }, before.content.find(row => row.content_id === CONTENT));
  assert.deepEqual(footprint(f).events, before.events); assert.deepEqual(footprint(f).budgets, before.budgets); assert.deepEqual(footprint(f).costs, before.costs);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
  assert.equal((await commitSelectedOutputShare(f.request(issued.command), f.env)).status, 404);
  assert.equal((await prepareSelectedOutputShare(f.request(prepared.body), f.env)).status, 404);
  const second = await f.erase(), secondBody = await second.json();
  assert.equal(second.status, 200, JSON.stringify(secondBody)); assert.equal(secondBody.selectedOutputShareMetadataMinimizedCount, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("an absent inactive share table preserves the existing personal-erasure result", async t => {
  const f = await fixture(t, { installShareSchema: false });
  const response = await f.erase(), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(Object.hasOwn(body, "selectedOutputShareMetadataMinimizedCount"), false);
  assert.equal(Object.hasOwn(body, "selectedOutputShareTombstonesRetained"), false);
  assert.equal(body.finishedOutputsRetained, true); assert.equal(body.erasedAuthoredEventBodies, 3);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='selected_output_shares'").get().n, 0);
});

test("partial or altered share schema refuses a successful erasure claim before destructive writes", async t => {
  for (const fault of ["table-only", "missing-trigger", "changed-trigger"]) await t.test(fault, async child => {
    const f = await fixture(child, { installShareSchema: fault !== "table-only" });
    if (fault === "table-only") f.sqlite.exec("CREATE TABLE selected_output_shares(share_id TEXT,owner_id TEXT)");
    else {
      f.sqlite.exec("DROP TRIGGER selected_output_share_immutable");
      if (fault === "changed-trigger") f.sqlite.exec("CREATE TRIGGER selected_output_share_immutable BEFORE UPDATE ON selected_output_shares BEGIN SELECT 1; END");
    }
    const before = footprint(f);
    await unconfirmed(await f.erase()); assert.deepEqual(footprint(f), before);
  });
});

test("the existing confirmation and same-origin gates cannot retire links", async t => {
  const f = await fixture(t); await issue(f, "protected-intent"); const before = footprint(f);
  for (const [body, headers, status] of [[{ ...confirmation, confirmation: "wrong" }, {}, 400], [confirmation, { origin: "https://foreign.test" }, 403]]) {
    const response = await f.erase(body, headers); assert.equal(response.status, status); assert.deepEqual(footprint(f), before);
  }
});

test("a share schema installed after absent preparation cannot silently bypass same-batch erasure", async t => {
  const f = await fixture(t, { installShareSchema: false });
  const before = structuredClone(f.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all());
  const db = f.privacyEnv.DB, batch = db.batch; let raced = 0;
  db.batch = async statements => {
    if (statements.some(statement => genericWrite(statement.sql))) {
      raced++;
      for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
    }
    return batch.call(db, statements);
  };
  try {
    await unconfirmed(await f.erase()); assert.equal(raced, 1);
    assert.deepEqual(structuredClone(f.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all()), before);
  } finally { db.batch = batch; }
});

test("a dropped selected-share write fails its same-transaction proof and rolls back authored erasure", async t => {
  const f = await fixture(t); await issue(f, "dropped-write-intent"); const before = footprint(f);
  const hook = intercept(f, { before: statements => statements.map(statement => shareWrite(statement.sql)
    ? f.privacyEnv.DB.prepare("UPDATE selected_output_shares SET revoked_at=revoked_at WHERE 0") : statement) });
  try { await unconfirmed(await f.erase()); assert.equal(hook.calls, 1); assert.deepEqual(footprint(f), before); }
  finally { hook.restore(); }
});

test("invalid selected-share batch receipts never become a successful erasure acknowledgment", async t => {
  for (const fault of ["write-success", "write-count", "write-inflated-count", "post-write-proof-zero", "terminal-zero", "missing-receipt", "database-swapped"]) await t.test(fault, async child => {
    const f = await fixture(child); await issue(f, "bad-receipt-intent"); const originalDb = f.privacyEnv.DB;
    const hook = intercept(f, { after: (receipts, statements) => {
      const rows = structuredClone(receipts), write = statements.findIndex(statement => shareWrite(statement.sql));
      assert.ok(write >= 0);
      if (fault === "write-success") rows[write].success = false;
      else if (fault === "write-count") rows[write].meta.changes = -1;
      else if (fault === "write-inflated-count") rows[write].meta.changes = 99;
      else if (fault === "terminal-zero" || fault === "post-write-proof-zero") {
        const assertion = fault === "terminal-zero" ? statements.findIndex((statement, index) => index > write
          && /NOT EXISTS\(SELECT 1 FROM main\.selected_output_shares WHERE owner_id=\?\)/u.test(statement.sql))
          : rows.findIndex((receipt, index) => index > write && receipt.results.length === 1 && Object.hasOwn(receipt.results[0], "verified"));
        assert.ok(assertion > write, "share terminal assertion must be present");
        for (const key of Object.keys(rows[assertion].results[0])) rows[assertion].results[0][key] = 0;
      } else if (fault === "missing-receipt") rows.splice(write, 1);
      else f.privacyEnv.DB = { prepare() { throw new Error("swapped database must never be used"); } };
      return rows;
    } });
    try { await unconfirmed(await f.erase()); assert.equal(hook.calls, 1); }
    finally { f.privacyEnv.DB = originalDb; hook.restore(); }
  });
});

for (const dropWrite of [false, true]) test(`pending memory-boundary integration still retires selected links${dropWrite ? " or rolls back a dropped share write" : ""}`, async t => {
  const f = await fixture(t), issued = await issue(f, "pending-memory-intent");
  f.sqlite.exec("CREATE TABLE selected_share_privacy_memory_fixture(id TEXT PRIMARY KEY,withdrawn INTEGER NOT NULL); INSERT INTO selected_share_privacy_memory_fixture VALUES('pending',0)");
  f.privacyEnv.selectedSharePrivacyMemoryPort = { prepared: 0, acknowledged: 0 };
  const before = footprint(f), original = before.shares[0];
  let sawGeneric = false;
  const hook = intercept(f, { before: statements => {
    sawGeneric = statements.some(statement => genericWrite(statement.sql));
    return dropWrite ? statements.map(statement => shareWrite(statement.sql)
      ? f.privacyEnv.DB.prepare("UPDATE selected_output_shares SET revoked_at=revoked_at WHERE 0") : statement) : statements;
  } });
  try {
    const response = await f.erase(confirmation, {}, pendingMemoryPrivacy);
    assert.equal(hook.calls, 1); assert.equal(sawGeneric, false); assert.equal(f.privacyEnv.selectedSharePrivacyMemoryPort.prepared, 1);
    if (dropWrite) {
      await unconfirmed(response); assert.deepEqual(footprint(f), before);
      assert.equal(f.sqlite.prepare("SELECT withdrawn FROM selected_share_privacy_memory_fixture").get().withdrawn, 0);
      assert.equal(f.privacyEnv.selectedSharePrivacyMemoryPort.acknowledged, 0);
    } else {
      const body = await response.json(); assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(body.memoryJobCleanupPending, true); assert.equal(body.authoredContentErasurePending, true); assert.equal(body.continuationRequired, true);
      assert.equal(body.selectedOutputShareMetadataMinimizedCount, 1); assert.equal(body.selectedOutputShareTombstonesRetained, true);
      assert.equal(body.erasedAuthoredEventBodies, 0); assert.equal(body.finishedOutputsRetained, true);
      assert.equal(f.privacyEnv.selectedSharePrivacyMemoryPort.acknowledged, 1);
      assert.deepEqual(footprint(f).content, before.content); assert.deepEqual(footprint(f).envelopes, before.envelopes);
      minimized(f.shares()[0], original);
      assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
    }
  } finally { hook.restore(); }
});
