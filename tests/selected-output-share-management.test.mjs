import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, OWNER, EMAIL, DOCUMENT, ARTIFACT, PROJECT, JOB, PURPOSE, digest } from "./helpers/selected-output-share-fixture.mjs";
import { SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS, SELECTED_OUTPUT_SHARE_SCHEMA } from "../worker/selected-output-share-schema.ts";

const imports = registerOutputSourceImports();
let listSelectedOutputShares, prepareSelectedOutputShare, commitSelectedOutputShare;
try {
  ({ listSelectedOutputShares } = await import("../worker/selected-output-share-management.ts"));
  ({ prepareSelectedOutputShare, commitSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
} finally { imports.deregister(); }

const created = "2020-01-01T00:00:00.000Z", issued = "2020-01-01T00:00:01.000Z", expiry = "2099-01-01T00:00:00.000Z";
const metadataRead = sql => sql.startsWith("WITH permitted AS (");
const query = params => new URLSearchParams({ documentId: DOCUMENT, artifactId: ARTIFACT, ...params }).toString();
const request = (params = {}, headers = {}, options = {}) => new Request(`https://forma.test/api/selected-output-shares?${typeof params === "string" ? params : query(params)}`, {
  method: "GET", headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers }, ...options,
});
const cursor = (createdAt, shareId) => Buffer.from(JSON.stringify([createdAt, shareId]), "utf8").toString("base64url");
function insertShare(f, shareId, changes = {}) {
  const row = { share_id: shareId, purpose: PURPOSE, replay_key: digest("replay:" + shareId), owner_id: OWNER, owner_email: EMAIL,
    intent_key: "intent:" + shareId, project_id: PROJECT, job_id: JOB, completion_event_id: f.completion.eventId,
    selection_json: JSON.stringify(f.selection()), review_title: "Reviewed " + shareId, source_expires_at: expiry, provenance_expires_at: expiry,
    expires_at: expiry, candidate_sha256: digest("candidate:" + shareId), issuer_authority_sha256: digest("authority:" + shareId),
    created_at: created, token_hash: digest("token:" + shareId), issued_at: issued, revoked_at: null, minimized_at: null, ...changes };
  f.insert("selected_output_shares", row); return row;
}
function minimize(f, shareId) {
  f.sqlite.prepare(`UPDATE selected_output_shares SET ${SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column}=NULL`).join(",")},
    revoked_at=?,minimized_at=? WHERE share_id=?`).run("2021-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z", shareId);
}
async function fixture(t, options = {}) {
  let network = 0;
  t.mock.method(globalThis, "fetch", () => { network++; throw Error("No network or provider calls in owner metadata tests"); });
  t.after(() => assert.equal(network, 0));
  return selectedOutputShareFixture(t, options);
}
function restrictToMetadata(f) {
  f.calls.length = 0; f.statements.length = 0;
  f.setBeforeStatement(sql => {
    assert.match(sql, /^(?:WITH|SELECT) /u);
    assert.doesNotMatch(sql, /\b(?:private_content|event_private_payloads|document_jobs|events|budget_reservations|cost_budget_reservations)\b/u);
  });
}
async function list(f, req = request()) {
  const response = await listSelectedOutputShares(req, f.env);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  return { response, body: await response.json() };
}

test("metadata selects only owned issued unrevoked unminimized links for the exact Document and artifact", async t => {
  const f = await fixture(t);
  insertShare(f, "included");
  insertShare(f, "expired", { expires_at: "2021-01-01T00:00:00.000Z", source_expires_at: "2021-01-01T00:00:00.000Z", provenance_expires_at: "2021-01-01T00:00:00.000Z" });
  insertShare(f, "foreign-owner", { owner_id: "other-owner", owner_email: "other@example.test" });
  insertShare(f, "foreign-document", { selection_json: JSON.stringify({ ...f.selection(), documentId: "other-document" }) });
  insertShare(f, "foreign-artifact", { selection_json: JSON.stringify({ ...f.selection(), artifactId: "other-artifact" }) });
  insertShare(f, "unissued", { issued_at: null, token_hash: null });
  insertShare(f, "revoked", { revoked_at: "2021-01-01T00:00:00.000Z" });
  insertShare(f, "minimized"); minimize(f, "minimized");
  restrictToMetadata(f); const before = f.changes(), { response, body } = await list(f);
  assert.equal(response.status, 200); assert.equal(body.nextCursor, null);
  assert.deepEqual(body.shares.map(row => row.shareId), ["included", "expired"]);
  for (const row of body.shares) assert.deepEqual(Object.keys(row).sort(), ["expiresAt", "issuedAt", "output", "revision", "shareId", "title"]);
  assert.deepEqual(body.shares[0], { shareId: "included", title: "Reviewed included", output: "short_story", revision: 0, expiresAt: expiry, issuedAt: issued });
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|source|owner|token|contentSha256|active|available/u);
  assert.equal(f.changes(), before); assert.equal(f.calls.length, 2);
  const read = f.statements.find(statement => metadataRead(statement.sql));
  assert.match(read.sql, /EXISTS\(SELECT 1 FROM users WHERE user_id=\? AND email=\?\)/u);
  assert.match(read.sql, /main\.sqlite_schema/u); assert.match(read.sql, /LIMIT 51/u);
});

test("canonical owner can manage after role, consent and source expiry and after a canonical email change", async t => {
  const f = await fixture(t); insertShare(f, "old-link", { source_expires_at: "2021-01-01T00:00:00.000Z", provenance_expires_at: "2021-01-01T00:00:00.000Z", expires_at: "2021-01-01T00:00:00.000Z" });
  f.sqlite.prepare("UPDATE users SET role='viewer',consent_version=NULL WHERE user_id=?").run(OWNER);
  f.sqlite.prepare("UPDATE private_content SET redacted_at=?").run(new Date().toISOString());
  restrictToMetadata(f); let result = await list(f); assert.equal(result.response.status, 200); assert.equal(result.body.shares.length, 1);
  f.sqlite.prepare("UPDATE users SET email='changed@example.test' WHERE user_id=?").run(OWNER);
  result = await list(f); assert.equal(result.response.status, 404);
  const before = f.changes(); result = await list(f, request({}, { "oai-authenticated-user-email": "changed@example.test" }));
  assert.equal(result.response.status, 200); assert.equal(result.body.shares[0].shareId, "old-link"); assert.equal(f.changes(), before);
});

test("metadata reopening after a lost actual commit response exposes no original or replacement secret", async t => {
  const f = await fixture(t);
  const preparedResponse = await prepareSelectedOutputShare(f.request({ intentKey: "metadata-lost-commit", selection: f.selection(), review: f.review() }), f.env);
  assert.equal(preparedResponse.status, 200); const prepared = await preparedResponse.json();
  const committed = await commitSelectedOutputShare(f.request({ candidateId: prepared.candidateId,
    approval: { purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
  assert.equal(committed.status, 200); const original = await committed.json(); assert.ok(original.share.token);
  restrictToMetadata(f); const before = f.changes();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await list(f); assert.equal(result.response.status, 200); assert.equal(result.body.shares[0].shareId, original.share.shareId);
    assert.equal(JSON.stringify(result.body).includes(original.share.token), false); assert.equal(result.body.nextCursor, null);
  }
  assert.equal(f.shares().length, 1); assert.equal(f.changes(), before);
});

test("pagination is bounded and stable across tied creation times and uses the 50th owned row as cursor", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 123; index++) insertShare(f, `share-${String(index).padStart(3, "0")}`);
  restrictToMetadata(f); const before = f.changes(), expected = f.shares().map(row => row.share_id).sort().reverse();
  const first = await list(f); assert.equal(first.response.status, 200); assert.equal(first.body.shares.length, 50);
  assert.deepEqual(first.body.shares.map(row => row.shareId), expected.slice(0, 50));
  assert.equal(first.body.nextCursor, cursor(created, expected[49]));
  const second = await list(f, request({ cursor: first.body.nextCursor })); assert.equal(second.body.shares.length, 50);
  const third = await list(f, request({ cursor: second.body.nextCursor })); assert.equal(third.body.shares.length, 23); assert.equal(third.body.nextCursor, null);
  assert.deepEqual([...first.body.shares, ...second.body.shares, ...third.body.shares].map(row => row.shareId), expected);
  assert.equal(f.changes(), before);
});

test("exactly fifty rows need no continuation and an authorized empty selection remains empty", async t => {
  const f = await fixture(t); for (let index = 0; index < 50; index++) insertShare(f, `share-${index}`);
  restrictToMetadata(f);
  const result = await list(f); assert.equal(result.response.status, 200); assert.equal(result.body.shares.length, 50); assert.equal(result.body.nextCursor, null);
  const empty = await list(f, request({ artifactId: "no-issued-artifact" })); assert.equal(empty.response.status, 200); assert.deepEqual(empty.body, { shares: [], nextCursor: null });
});

test("maximum valid percent-encoded selection identifiers remain pageable with a full-length share cursor", async t => {
  const f = await fixture(t), documentId = "D" + ":".repeat(159), artifactId = "A" + ":".repeat(159);
  for (let index = 0; index < 51; index++) insertShare(f, "S" + ":".repeat(156) + String(index).padStart(3, "0"), {
    review_title: "Reviewed maximum identifiers", selection_json: JSON.stringify({ ...f.selection(), documentId, artifactId }),
  });
  restrictToMetadata(f);
  const first = await list(f, request({ documentId, artifactId })); assert.equal(first.response.status, 200); assert.equal(first.body.shares.length, 50);
  const next = request({ documentId, artifactId, cursor: first.body.nextCursor }); assert(new URL(next.url).search.length > 1024);
  const second = await list(f, next); assert.equal(second.response.status, 200); assert.equal(second.body.shares.length, 1); assert.equal(second.body.nextCursor, null);
});

for (const [name, changes] of [
  ["foreign owner", { owner_id: "other-owner" }],
  ["other Document", { selection_json: JSON.stringify({ output: "short_story", documentId: "other", artifactId: ARTIFACT, revision: 0, contentSha256: "a".repeat(64) }) }],
  ["other artifact", { selection_json: JSON.stringify({ output: "short_story", documentId: DOCUMENT, artifactId: "other", revision: 0, contentSha256: "a".repeat(64) }) }],
  ["unissued", { token_hash: null, issued_at: null }],
  ["revoked", { revoked_at: "2021-01-01T00:00:00.000Z" }],
]) test(`${name} cursor cannot serve as the selected owner's pagination anchor`, async t => {
  const f = await fixture(t); insertShare(f, "anchor", changes); restrictToMetadata(f); const before = f.changes();
  const result = await list(f, request({ cursor: cursor(created, "anchor") })); assert.equal(result.response.status, 404); assert.equal(f.changes(), before);
});

for (const value of ["", "documentId=x", query() + "&ownerId=other", query() + "&documentId=other", query() + "&artifactId=other",
  query() + "&cursor=&cursor=x", query({ cursor: "" }), query({ cursor: "%%%" }), query({ cursor: "a".repeat(321) }),
  query({ cursor: Buffer.from('["2020-01-01T00:00:00Z","anchor"]').toString("base64url") }),
  query({ cursor: cursor(created, "anchor") + "=" }), query({ documentId: "../other" }), query({ artifactId: "a".repeat(161) })])
test(`closed metadata query refuses ${JSON.stringify(value).slice(0, 90)}`, async t => {
  const f = await fixture(t), before = f.changes(), result = await list(f, request(value));
  assert.equal(result.response.status, 400); assert.equal(f.calls.length, 0); assert.equal(f.changes(), before);
});

for (const [name, headers, status] of [
  ["missing principal", { "oai-authenticated-user-id": "" }, 401],
  ["missing email", { "oai-authenticated-user-email": "" }, 401],
  ["project cookie", { cookie: "forma_project_context=selected" }, 403],
  ["impersonation cookie", { cookie: "forma_impersonation=other" }, 403],
  ["foreign origin", { origin: "https://other.test" }, 403],
  ["cross site", { "sec-fetch-site": "cross-site" }, 403],
  ["same site other origin", { "sec-fetch-site": "same-site" }, 403],
]) test(`${name} cannot inspect selected share management metadata`, async t => {
  const f = await fixture(t), before = f.changes(), result = await list(f, request({}, headers));
  assert.equal(result.response.status, status); assert.equal(f.calls.length, 0); assert.equal(f.changes(), before);
});

test("non-GET management calls cannot mutate or query state", async t => {
  const f = await fixture(t); const before = f.changes();
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const response = await listSelectedOutputShares(request({}, {}, { method }), f.env); assert.equal(response.status, 405);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.changes(), before);
});

for (const absent of [true, false]) test(`${absent ? "absent" : "partial"} share schema refuses without installing or reading share rows`, async t => {
  const f = await fixture(t, { installShareSchema: !absent });
  if (!absent) f.sqlite.exec("DROP TRIGGER selected_output_share_immutable");
  const before = f.changes(), result = await list(f);
  assert.equal(result.response.status, 404); assert.equal(f.calls.length, 1); assert.equal(f.changes(), before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='selected_output_share_immutable'").get().n, 0);
});

for (const mutation of ["missing principal", "email changed", "schema changed", "minimized", "revoked"]) test(`final metadata statement rechecks ${mutation} after readiness`, async t => {
  const f = await fixture(t); insertShare(f, "before-race"); let changed = false;
  f.setBeforeStatement(sql => {
    if (metadataRead(sql) && !changed) {
      changed = true;
      if (mutation === "missing principal") f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(OWNER);
      if (mutation === "email changed") f.sqlite.prepare("UPDATE users SET email='foreign@example.test' WHERE user_id=?").run(OWNER);
      if (mutation === "schema changed") f.sqlite.exec("DROP TRIGGER selected_output_share_immutable");
      if (mutation === "minimized") minimize(f, "before-race");
      if (mutation === "revoked") f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=? WHERE share_id='before-race'").run(new Date().toISOString());
    }
  });
  const result = await list(f); assert.equal(changed, true);
  if (["minimized", "revoked"].includes(mutation)) { assert.equal(result.response.status, 200); assert.deepEqual(result.body.shares, []); }
  else assert.equal(result.response.status, 404);
});

for (const when of ["readiness", "metadata"]) for (const mutation of ["database", "config", "request identity", "abort"])
test(`${mutation} changed across ${when} await retires captured metadata`, async t => {
  const f = await fixture(t), controller = new AbortController(), req = request({}, {}, { signal: controller.signal }); insertShare(f, "retired");
  let changed = false;
  f.setAfterStatement(sql => {
    if (!changed && (when === "metadata" ? metadataRead(sql) : !metadataRead(sql))) {
      changed = true;
      if (mutation === "database") f.env.DB = { prepare() { throw Error("replacement database must not be queried"); } };
      if (mutation === "config") f.env.FORMA_PILOT_COHORT_ID = "changed-configuration";
      if (mutation === "request identity") req.headers.set("oai-authenticated-user-id", "foreign");
      if (mutation === "abort") controller.abort();
    }
  });
  const before = f.changes(), result = await list(f, req); assert.equal(changed, true); assert.equal(result.response.status, 404); assert.equal(f.changes(), before);
});

test("malformed D1 metadata receipts and rows never invoke getters or return partial pages", async t => {
  const f = await fixture(t); insertShare(f, "valid");
  const raw = { permitted: 1, metadata_valid: 1, share_id: "valid", review_title: "Reviewed", output: "short_story", revision: 0, expires_at: expiry, issued_at: issued, created_at: created };
  let getters = 0;
  const getter = (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true, get() { getters++; throw Error("getter forbidden"); } });
  const receipts = [null, {}, [], { success: false, results: [raw] }, { success: true, error: "failed", results: [raw] },
    getter({ results: [raw] }, "success"), getter({ success: true }, "results"), getter({ success: true, results: [raw] }, "error"),
    { success: true, results: [] }, { success: true, results: Array(1) }, { success: true, results: getter([raw], 0) },
    { success: true, results: [getter({ ...raw }, "review_title")] }, { success: true, results: [{ ...raw, private_body: "PRIVATE" }] },
    { success: true, results: [{ ...raw, output: getter({}, "toString") }] }, { success: true, results: [{ ...raw, revision: -1 }] },
    { success: true, results: [{ ...raw, issued_at: "2099-02-01T00:00:00.000Z" }] },
    { success: true, results: [{ ...raw, review_title: "A\nB" }] }, { success: true, results: Array(52).fill(raw) },
    { success: true, results: [raw, raw] }, { success: true, results: [{ ...raw, share_id: null }] }];
  const db = f.env.DB;
  for (const receipt of receipts) {
    f.env.DB = { prepare(sql) {
      const stmt = db.prepare(sql);
      return { bind(...bindings) { const bound = stmt.bind(...bindings); return { all: async () => metadataRead(sql) ? receipt : bound.all() }; } };
    } };
    const before = f.changes(), result = await list(f); assert.equal(result.response.status, 404); assert.equal(f.changes(), before);
  }
  assert.equal(getters, 0);
});

test("the 51st lookahead row is validated before returning any bounded page", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 51; index++) insertShare(f, `share-${String(index).padStart(3, "0")}`, index === 0 ? { review_title: "Invalid\nreview" } : {});
  restrictToMetadata(f); const result = await list(f); assert.equal(result.response.status, 404); assert.deepEqual(result.body, { error: "selected_output_share_unavailable" });
});

for (const [name, selection] of [
  ["boolean revision", { revision: true }], ["fractional revision", { revision: 0.5 }], ["extra source property", { prompt: "PRIVATE" }],
  ["unsupported output", { output: "image" }], ["invalid content identity", { contentSha256: "not-a-hash" }],
  ["NUL-suffixed content identity", { contentSha256: "a".repeat(64) + "\u0000invalid" }],
  ["embedded NUL content identity", { contentSha256: "a".repeat(32) + "\u0000" + "a".repeat(31) }],
]) test(`malformed stored ${name} refuses metadata without coercion or partial disclosure`, async t => {
  const f = await fixture(t); insertShare(f, "malformed", { selection_json: JSON.stringify({ ...f.selection(), ...selection }) });
  restrictToMetadata(f); const result = await list(f); assert.equal(result.response.status, 404);
});

test("oversized stored share identity is refused before it crosses the SQL transport", async t => {
  const f = await fixture(t); insertShare(f, "a".repeat(20_000), { review_title: "Bounded review title" }); let observed = false;
  f.setAfterStatement((sql, _bindings, _mode, result) => {
    if (metadataRead(sql)) { observed = true; assert.equal(result.results[0].share_id, null); assert.equal(result.results[0].metadata_valid, 0); }
  });
  const result = await list(f); assert.equal(result.response.status, 404); assert.equal(observed, true);
});

test("metadata array length is captured without invoking a Proxy get trap", async t => {
  const f = await fixture(t), db = f.env.DB; let reads = 0;
  const values = new Proxy([{ permitted: 1, metadata_valid: null, share_id: null, review_title: null, output: null, revision: null, expires_at: null, issued_at: null, created_at: null }],
    { get() { reads++; throw Error("raw property reads forbidden"); } });
  f.env.DB = { prepare(sql) { const stmt = db.prepare(sql); return { bind(...bindings) {
    const bound = stmt.bind(...bindings); return { all: async () => metadataRead(sql) ? { success: true, results: values } : bound.all() };
  } }; } };
  const result = await list(f); assert.equal(result.response.status, 200); assert.deepEqual(result.body.shares, []); assert.equal(reads, 0);
});

test("management source owns no native content, provider, provisioning, budget or schema mutation entry", async () => {
  const source = await readFile(new URL("../worker/selected-output-share-management.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:requireUser|ensureSchema|readNativeRetainedTextCustody|readSelectedOutputShareAuthority|prepareSelectedOutputShare|commitSelectedOutputShare)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|CREATE INDEX|CREATE TRIGGER|DROP TABLE)\b/u);
  assert.doesNotMatch(source, /\b(?:private_content|event_private_payloads|document_jobs|budget_reservations|cost_budget_reservations)\b/u);
  assert.ok(SELECTED_OUTPUT_SHARE_SCHEMA.length > 0, "the tests use the actual source-owned schema");
});
