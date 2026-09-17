import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, OWNER, EMAIL, PROJECT, CONTENT, ARTIFACT, JOB,
  POLICY, PURPOSE, LITERAL, digest, nativeContent } from "./helpers/selected-output-share-fixture.mjs";
import { SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS } from "../worker/selected-output-share-schema.ts";

const imports = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare, revokeSelectedOutputShare;
let handleRetainedStoryRead, retainedStoryRequestPath;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare, readSelectedOutputShare, revokeSelectedOutputShare }
    = await import("../worker/selected-output-share-lifecycle.ts"));
  ({ handleRetainedStoryRead } = await import("../worker/retained-story-api.ts"));
  ({ retainedStoryRequestPath } = await import("../src/model/retained-short-story.ts"));
} finally { imports.deregister(); }

const publicRequest = (method = "GET", headers = {}) => new Request("https://forma.test/detached-selected-output-read", { method, headers });
const approval = prepared => ({ candidateId: prepared.candidateId, approval: {
  purpose: PURPOSE, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true,
} });
async function prepare(f, options = {}) {
  const body = { intentKey: options.intentKey ?? "deliberate-review-intent", selection: options.selection ?? f.selection(), review: options.review ?? f.review() };
  const response = await prepareSelectedOutputShare(f.request(body), f.env);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return { body, ...result };
}
async function issue(f, options = {}) {
  const prepared = await prepare(f, options);
  const response = await commitSelectedOutputShare(f.request(approval(prepared)), f.env);
  const issued = await response.json();
  assert.equal(response.status, 200, JSON.stringify(issued));
  assert.equal(issued.replayed, false);
  assert.match(issued.share.token, /^[A-Za-z0-9_-]{32}$/u);
  return { prepared, ...issued };
}
function headers(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("etag"), null);
}
function countRows(f, table) { return f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
function finalRead(sql) { return sql.startsWith("WITH selected_share_proof_") && sql.includes(" SELECT 1 AS permitted WHERE") && sql.includes("selected_output_shares"); }
function tokenWrite(sql) { return sql.startsWith("WITH selected_share_proof_") && sql.includes(" UPDATE selected_output_shares SET token_hash="); }
function preparationWrite(sql) { return sql.startsWith("WITH selected_share_proof_") && sql.includes(" INSERT INTO selected_output_shares("); }
async function edit(f) {
  f.replace({ ...nativeContent(), content_markdown: "Edited exact selected output", items: [{ title: "Changed", body: "Edited slide", notes: "Private", image_prompt: "", slide: null }] });
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1,
    content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
}

for (const kind of ["short_story", "scene", "slides"]) test(`${kind} deliberately publishes one exact native result without context, native identity or side effects`, async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network, provider or remote media is allowed"); });
  const f = await selectedOutputShareFixture(t, { kind }), before = f.changes();
  const unchanged = Object.fromEntries(["events", "private_content", "document_jobs", "shares", "share_scopes", "budget_reservations", "cost_budget_reservations"]
    .map(table => [table, countRows(f, table)]));
  const issued = await issue(f);
  assert.deepEqual(Object.keys(issued.prepared.candidate).sort(), ["candidateSha256", "kind", "publicOutput", "purpose", "schemaVersion", "selection", "sourceExpiresAt"]);
  assert.equal(f.shares().length, 1);
  const stored = f.shares()[0];
  assert.equal(stored.token_hash, digest(`${PURPOSE}\0${issued.share.token}`));
  assert.notEqual(stored.token_hash, digest(issued.share.token), "the stored digest is purpose separated");
  assert.equal(JSON.stringify(stored).includes(issued.share.token), false, "only a token digest is persisted");
  assert.doesNotMatch(JSON.stringify(stored), /PRIVATE_|<script>|untrusted\.invalid/u, "candidate rows contain no native body copy");
  assert.equal(f.changes() - before, 2, "prepare and issue are the only writes");
  const response = await readSelectedOutputShare(publicRequest(), f.env, issued.share.token);
  assert.equal(response.status, 200); headers(response);
  const output = await response.json();
  assert.deepEqual(output, issued.prepared.candidate.publicOutput);
  assert.deepEqual(Object.keys(output).sort(), ["attribution", "content", "expiresAt", "kind", "output", "schemaVersion", "title"]);
  assert.equal(kind === "slides" ? output.content.items[0].body : output.content.text, LITERAL);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|selection|artifactId|documentId|contentSha256|candidateSha256|ownerId|claim_token|sourceExpiresAt/u);
  assert.equal(f.changes() - before, 2, "public delivery is read only");
  for (const [table, count] of Object.entries(unchanged)) assert.equal(countRows(f, table), count, table);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("an actor-paid dynamic native slot uses its actual durable provenance", async t => {
  const f = await selectedOutputShareFixture(t, { slot: "actor" });
  assert.equal(Object.hasOwn(f.job(), "output_slot_id"), false, "the real schema derives slot identity from output_operation_slots");
  assert.equal(f.job().source_surface, "outputs");
  assert.deepEqual(JSON.parse(f.job().request_json).outputExecution, f.slot);
  const issued = await issue(f);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
  assert.equal(f.shares()[0].job_id, JOB);
  assert.equal(f.shares()[0].completion_event_id, f.completion.eventId);
});

test("the same preparation intent replays exactly, and changed review choices cannot replace it", async t => {
  const f = await selectedOutputShareFixture(t), prepared = await prepare(f), before = f.changes();
  const replayResponse = await prepareSelectedOutputShare(f.request(prepared.body), f.env);
  assert.equal(replayResponse.status, 200);
  const replay = await replayResponse.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.candidateId, prepared.candidateId);
  assert.deepEqual(replay.candidate, prepared.candidate);
  assert.equal(f.changes(), before);
  const conflict = await prepareSelectedOutputShare(f.request({ ...prepared.body, review: { ...prepared.body.review, title: "Different reviewed title" } }), f.env);
  assert.equal(conflict.status, 404);
  assert.equal(f.changes(), before);
  assert.equal(f.shares().length, 1);
  assert.equal(f.shares()[0].token_hash, null);
});

test("a supplied candidate digest is never an approval for different choices or another subject", async t => {
  const f = await selectedOutputShareFixture(t), prepared = await prepare(f), baseline = f.changes();
  const cases = [
    { ...approval(prepared), approval: { ...approval(prepared).approval, candidateSha256: "0".repeat(64) } },
    { ...approval(prepared), approval: { ...approval(prepared).approval, purpose: "document-share" } },
    { ...approval(prepared), approval: { ...approval(prepared).approval, allowPublicRead: false } },
    { ...approval(prepared), approval: { ...approval(prepared).approval, actorUserId: OWNER } },
    { ...approval(prepared), candidate: prepared.candidate },
  ];
  for (const body of cases) assert.equal((await commitSelectedOutputShare(f.request(body), f.env)).status, 400);
  const otherSubject = f.request(approval(prepared), { "oai-authenticated-user-id": "different-canonical-subject" });
  assert.equal((await commitSelectedOutputShare(otherSubject, f.env)).status, 404);
  assert.equal(f.changes(), baseline);
  assert.equal(f.shares()[0].token_hash, null);
});

test("duplicate approval and lost-acknowledgment replay never rotate or disclose a second token", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), baseline = f.changes(), stored = { ...f.shares()[0] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env);
    assert.equal(response.status, 200); headers(response);
    assert.deepEqual(await response.json(), { share: { shareId: issued.share.shareId, expiresAt: issued.share.expiresAt, active: true }, replayed: true });
  }
  assert.deepEqual({ ...f.shares()[0] }, stored);
  assert.equal(f.changes(), baseline);
  assert.equal((await prepareSelectedOutputShare(f.request(issued.prepared.body), f.env)).status, 409);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
});

test("two simultaneous approvals issue exactly one secret and converge on one grant", async t => {
  const f = await selectedOutputShareFixture(t), prepared = await prepare(f), baseline = f.changes();
  const responses = await Promise.all([1, 2].map(() => commitSelectedOutputShare(f.request(approval(prepared)), f.env)));
  for (const response of responses) assert.equal(response.status, 200);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  const secrets = results.flatMap(result => result.share.token ? [result.share.token] : []);
  assert.equal(secrets.length, 1);
  assert.equal(new Set(results.map(result => result.share.shareId)).size, 1);
  assert.equal(f.shares().length, 1);
  assert.equal(f.changes() - baseline, 1);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, secrets[0])).status, 200);
});

test("revocation is monotonic and idempotent despite lost output custody or generation consent", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
  f.sqlite.prepare("UPDATE users SET role='viewer',consent_version='old' WHERE user_id=?").run(OWNER);
  const response = await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  const revokedAt = f.shares()[0].revoked_at, baseline = f.changes();
  assert.ok(revokedAt);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  assert.equal(f.shares()[0].revoked_at, revokedAt); assert.equal(f.changes(), baseline);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
  assert.equal((await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)).status, 404);
});

test("revocation requires the same canonical subject and never merges an email into another owner", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), baseline = f.changes();
  const other = f.request(undefined, { "oai-authenticated-user-id": "same-email-another-subject" }, "DELETE");
  assert.equal((await revokeSelectedOutputShare(other, f.env, issued.share.shareId)).status, 404);
  assert.equal(f.shares()[0].revoked_at, null); assert.equal(f.changes(), baseline);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
});

test("revision pinning never discloses an edit that was not approved", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), oldSelection = issued.prepared.body.selection;
  await edit(f);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
  assert.equal((await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)).status, 404);
  assert.equal((await prepareSelectedOutputShare(f.request({ ...issued.prepared.body, intentKey: "old-again", selection: oldSelection }), f.env)).status, 404);
  const fresh = await issue(f, { intentKey: "review-edited-version", selection: f.selection(1) });
  const response = await readSelectedOutputShare(publicRequest(), f.env, fresh.share.token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content.text, "Edited exact selected output");
  assert.equal(f.shares().length, 2);
});

test("source, native provenance and principal changes between review and approval refuse without issuing", async t => {
  for (const fault of ["edit", "redaction", "source-expiry", "job-expiry", "document-removal", "principal-role", "consent", "email"]) {
    await t.test(fault, async child => {
      const f = await selectedOutputShareFixture(child), prepared = await prepare(f);
      if (fault === "edit") await edit(f);
      else if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
      else if (fault === "source-expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
      else if (fault === "job-expiry") f.updateJob({ expires_at: "2020-01-01T00:00:00.000Z" });
      else if (fault === "document-removal") await f.append("DocumentRemoved");
      else if (fault === "principal-role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      else if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version='old' WHERE user_id=?").run(OWNER);
      else f.sqlite.prepare("UPDATE users SET email='changed@example.test' WHERE user_id=?").run(OWNER);
      const baseline = f.changes(), response = await commitSelectedOutputShare(f.request(approval(prepared)), f.env);
      assert.equal(response.status, 404); headers(response);
      assert.equal(f.shares()[0].token_hash, null); assert.equal(f.changes(), baseline);
    });
  }
});

test("commit rechecks custody and source expiry in the exact token-write statement", async t => {
  for (const fault of ["edit", "redaction", "source-expiry", "job-expiry", "role"]) await t.test(fault, async child => {
    const f = await selectedOutputShareFixture(child), prepared = await prepare(f);
    let raced = false;
    f.setBeforeStatement(async sql => {
      if (!tokenWrite(sql)) return;
      raced = true; f.setBeforeStatement(null);
      if (fault === "edit") await edit(f);
      else if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
      else if (fault === "source-expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
      else if (fault === "job-expiry") f.updateJob({ expires_at: "2020-01-01T00:00:00.000Z" });
      else f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
    });
    assert.equal((await commitSelectedOutputShare(f.request(approval(prepared)), f.env)).status, 404);
    assert.equal(raced, true, "the intended final-write race must run");
    assert.equal(f.shares()[0].token_hash, null); assert.equal(f.shares()[0].issued_at, null);
  });
});

test("public delivery joins token revocation with the final current-custody proof", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  let raced = false;
  f.setBeforeStatement(async sql => {
    if (!finalRead(sql)) return;
    raced = true; f.setBeforeStatement(null);
    assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  });
  const response = await readSelectedOutputShare(publicRequest(), f.env, issued.share.token);
  assert.equal(raced, true); assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /مرحبا|Japanese|PRIVATE_/u);
});

test("a revocation after the final proof blocks later reads but does not promise cancellation of an in-flight response", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  let raced = false;
  f.setAfterStatement(async sql => {
    if (!finalRead(sql)) return;
    raced = true; f.setAfterStatement(null);
    assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  });
  const response = await readSelectedOutputShare(publicRequest(), f.env, issued.share.token);
  assert.equal(raced, true); assert.equal(response.status, 200);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
});

test("public delivery refuses edit, redaction, expiry and principal races at its final SELECT", async t => {
  for (const fault of ["edit", "redaction", "source-expiry", "job-expiry", "role"]) await t.test(fault, async child => {
    const f = await selectedOutputShareFixture(child), issued = await issue(f);
    let raced = false;
    f.setBeforeStatement(async sql => {
      if (!finalRead(sql)) return;
      raced = true; f.setBeforeStatement(null);
      if (fault === "edit") await edit(f);
      else if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
      else if (fault === "source-expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
      else if (fault === "job-expiry") f.updateJob({ expires_at: "2020-01-01T00:00:00.000Z" });
      else f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
    });
    assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
    assert.equal(raced, true, "the intended final-read race must run");
  });
});

test("requested lifetime obeys the existing seven-day ceiling and all native retention deadlines", async t => {
  for (const fault of ["already-expired", "exact-now", "over-seven-days", "source-deadline", "job-deadline"]) await t.test(fault, async child => {
    const now = Date.now(), earlier = new Date(now + 60_000).toISOString();
    const f = await selectedOutputShareFixture(child, { ...(fault === "source-deadline" ? { sourceExpiresAt: earlier } : {}),
      ...(fault === "job-deadline" ? { jobExpiresAt: earlier } : {}) });
    const expiresAt = new Date(fault === "already-expired" ? now - 1 : fault === "exact-now" ? now
      : fault === "over-seven-days" ? now + 8 * 86_400_000 : now + 120_000).toISOString();
    const baseline = f.changes();
    const response = await prepareSelectedOutputShare(f.request({ intentKey: "expiry-boundary", selection: f.selection(), review: f.review({ expiresAt }) }), f.env);
    assert.equal(response.status, 404); assert.equal(f.shares().length, 0); assert.equal(f.changes(), baseline);
  });
});

test("public token expiry is closed at equality even when a conditional-cache header is supplied", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), expiry = Date.parse(issued.share.expiresAt);
  t.mock.method(Date, "now", () => expiry);
  const response = await readSelectedOutputShare(publicRequest("GET", { "if-none-match": "*" }), f.env, issued.share.token);
  assert.equal(response.status, 404); headers(response);
  assert.equal((await commitSelectedOutputShare(f.request(approval(issued.prepared)), f.env)).status, 404);
});

test("public token syntax, purpose and unrelated credentials never grant access", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), baseline = f.changes();
  for (const value of ["", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "/", "z".repeat(32),
    issued.prepared.candidate.candidateSha256, issued.prepared.candidateId, "PRIVATE_CLAIM_TOKEN"]) {
    assert.equal((await readSelectedOutputShare(publicRequest("GET", { authorization: `Bearer ${issued.share.token}` }), f.env, value)).status, 404);
  }
  assert.equal(f.changes(), baseline);
  assert.equal((await readSelectedOutputShare(publicRequest("HEAD"), f.env, issued.share.token)).status, 405);
});

test("strict command shapes and methods reject before granting any publication", async t => {
  const f = await selectedOutputShareFixture(t), body = { intentKey: "literal-command", selection: f.selection(), review: f.review() };
  const invalid = ["not JSON", "[]", JSON.stringify({ ...body, ownerId: OWNER }), JSON.stringify({ ...body, candidateSha256: "0".repeat(64) }),
    JSON.stringify({ ...body, selection: { ...body.selection, output: "model3d" } }),
    JSON.stringify({ ...body, selection: { ...body.selection, revision: "0" } }), JSON.stringify({ ...body, hidden: "x".repeat(9000) })];
  const baseline = f.changes();
  for (const value of invalid) assert.equal((await prepareSelectedOutputShare(f.request(value), f.env)).status, 400);
  assert.equal((await prepareSelectedOutputShare(f.request(undefined, {}, "GET"), f.env)).status, 405);
  assert.equal((await prepareSelectedOutputShare(f.request(body, { "content-type": "text/plain" }), f.env)).status, 400);
  assert.equal((await commitSelectedOutputShare(f.request(undefined, {}, "GET"), f.env)).status, 405);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "GET"), f.env, "unknown")).status, 405);
  assert.equal(f.shares().length, 0); assert.equal(f.changes(), baseline);
});

test("guest, project-context, impersonation and cross-origin requests refuse without provisioning", async t => {
  const f = await selectedOutputShareFixture(t), body = { intentKey: "restricted-principal", selection: f.selection(), review: f.review() }, baseline = f.changes();
  const guest = new Request("https://forma.test/detached-selected-output-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await prepareSelectedOutputShare(guest, f.env)).status, 401);
  for (const cookie of ["forma_project_context=selected", "forma_project_context=", "forma_impersonation=%ZZ"]) {
    assert.equal((await prepareSelectedOutputShare(f.request(body, { cookie }), f.env)).status, 403);
  }
  for (const requestHeaders of [{ origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await prepareSelectedOutputShare(f.request(body, requestHeaders), f.env)).status, 403);
  }
  assert.equal(f.shares().length, 0); assert.equal(countRows(f, "users"), 1); assert.equal(f.changes(), baseline);
});

test("same-email identity substitution and project registration invalidate existing publication", async t => {
  for (const fault of ["different-subject", "changed-email", "registered-project"]) await t.test(fault, async child => {
    const f = await selectedOutputShareFixture(child), issued = await issue(f), now = new Date().toISOString();
    if (fault === "different-subject") {
      f.sqlite.prepare("UPDATE users SET email='former@example.test' WHERE user_id=?").run(OWNER);
      f.insert("users", { user_id: "replacement-subject", email: EMAIL, display_name: "Different subject", role: "creator",
        consent_version: POLICY, consented_at: now, created_at: now, updated_at: now });
    } else if (fault === "changed-email") f.sqlite.prepare("UPDATE users SET email='renamed@example.test' WHERE user_id=?").run(OWNER);
    else f.insert("organization_projects", { project_access_id: "registered-access", project_id: PROJECT,
      organization_id: "registered-org", owner_user_id: OWNER, status: "active", created_at: now, updated_at: now });
    const baseline = f.changes();
    assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
    assert.equal(f.changes(), baseline);
  });
});

test("request abortion or environment replacement while reading fails closed", async t => {
  for (const fault of ["abort", "database-replacement"]) await t.test(fault, async child => {
    const f = await selectedOutputShareFixture(child), issued = await issue(f), controller = new AbortController();
    const request = new Request("https://forma.test/detached-read", { signal: controller.signal });
    let changed = false;
    f.setAfterStatement(sql => {
      if (!sql.includes("FROM selected_output_shares share")) return;
      f.setAfterStatement(null); changed = true;
      if (fault === "abort") controller.abort(); else f.env.DB = f.baseEnv.DB;
    });
    assert.equal((await readSelectedOutputShare(request, f.env, issued.share.token)).status, 404);
    assert.equal(changed, true);
  });
});

test("schema preserves candidate bindings, one issuance and permanent revocation against direct replacement", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  assert.match(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='selected_output_shares'").get().sql, /WITHOUT ROWID/iu);
  assert.throws(() => f.sqlite.prepare("SELECT rowid FROM selected_output_shares").get(), /no such column: rowid/u);
  for (const [column, value] of [["review_title", "Changed"], ["selection_json", "{}"], ["owner_id", "other"],
    ["candidate_sha256", "0".repeat(64)], ["expires_at", "2098-01-01T00:00:00.000Z"], ["token_hash", "a".repeat(64)]]) {
    assert.throws(() => f.sqlite.prepare(`UPDATE selected_output_shares SET ${column}=? WHERE share_id=?`).run(value, issued.share.shareId), /selected_output_share_immutable|CHECK/u);
  }
  assert.throws(() => f.sqlite.prepare("DELETE FROM selected_output_shares WHERE share_id=?").run(issued.share.shareId), /selected_output_share_immutable/u);
  const row = f.shares()[0], columns = Object.keys(row);
  assert.throws(() => f.sqlite.prepare(`INSERT OR REPLACE INTO selected_output_shares(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`)
    .run(...columns.map(column => row[column])), /selected_output_share_exists/u);
  assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, issued.share.shareId)).status, 200);
  assert.throws(() => f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=NULL WHERE share_id=?").run(issued.share.shareId), /selected_output_share_immutable/u);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
});

test("INSERT OR REPLACE cannot erase an issued share through its unique token digest", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  f.sqlite.exec("PRAGMA recursive_triggers=OFF");
  const before = f.shares().map(row => ({ ...row }));
  const replacement = { ...before[0], share_id: "another-share-id", intent_key: "another-intent", replay_key: digest("different-token-collision-replay-key") }, columns = Object.keys(replacement);
  assert.throws(() => f.sqlite.prepare(`INSERT OR REPLACE INTO selected_output_shares(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`)
    .run(...columns.map(column => replacement[column])), /selected_output_share_exists/u);
  assert.deepEqual(f.shares().map(row => ({ ...row })), before);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
});

test("UPDATE OR REPLACE cannot transfer an issued token to another unissued candidate", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f);
  const next = await prepare(f, { intentKey: "another-deliberate-review" });
  f.sqlite.exec("PRAGMA recursive_triggers=OFF");
  const before = f.shares().map(row => ({ ...row })), original = before.find(row => row.share_id === issued.share.shareId);
  assert.throws(() => f.sqlite.prepare("UPDATE OR REPLACE selected_output_shares SET token_hash=?,issued_at=? WHERE share_id=?")
    .run(original.token_hash, new Date().toISOString(), next.candidateId), /selected_output_share_immutable/u);
  assert.deepEqual(f.shares().map(row => ({ ...row })), before);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
});

test("preparation rechecks custody within the candidate INSERT and stores no candidate after a source race", async t => {
  const f = await selectedOutputShareFixture(t);
  let raced = false;
  f.setBeforeStatement(sql => {
    if (!preparationWrite(sql)) return;
    raced = true; f.setBeforeStatement(null);
    f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
  });
  const response = await prepareSelectedOutputShare(f.request({ intentKey: "race-at-prepare", selection: f.selection(), review: f.review() }), f.env);
  assert.equal(raced, true); assert.equal(response.status, 404); assert.equal(f.shares().length, 0);
});

test("a configured canonical pilot can issue and read within the real D1 statement limits", async t => {
  const f = await selectedOutputShareFixture(t), pilot = f.installPilot();
  const issued = await issue(f);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
  assert.equal(f.env.FORMA_PILOT_COHORT_ID, pilot.cohortId);
  const largestBindings = Math.max(...f.statements.map(statement => statement.bindings?.length ?? 0));
  assert.ok(largestBindings > 30, "exercise the composed current-principal/native/provenance witness");
  assert.ok(largestBindings <= 100);
  assert.ok(Math.max(...f.calls.map(sql => Buffer.byteLength(sql, "utf8"))) <= 100_000);
});

test("configured pilot expiry crossing after the final SELECT refuses in-flight delivery", async t => {
  const f = await selectedOutputShareFixture(t), endsAt = new Date(Date.now() + 60_000).toISOString();
  f.installPilot({ endsAt });
  const issued = await issue(f, { review: f.review({ expiresAt: endsAt }) });
  assert.equal(f.shares()[0].provenance_expires_at, endsAt, "the effective authoritative cohort deadline is recorded");
  let raced = false;
  f.setAfterStatement(sql => {
    if (!finalRead(sql)) return;
    f.setAfterStatement(null); raced = true;
    t.mock.method(Date, "now", () => Date.parse(endsAt) + 1);
  });
  const response = await readSelectedOutputShare(publicRequest(), f.env, issued.share.token);
  assert.equal(raced, true);
  assert.equal(response.status, 404);
});

test("a selected output cannot outlive its actual configured cohort admission", async t => {
  const f = await selectedOutputShareFixture(t), endsAt = new Date(Date.now() + 60_000).toISOString();
  f.installPilot({ endsAt });
  const baseline = f.changes();
  const response = await prepareSelectedOutputShare(f.request({ intentKey: "over-cohort-deadline", selection: f.selection(), review: f.review() }), f.env);
  assert.equal(response.status, 404); assert.equal(f.shares().length, 0); assert.equal(f.changes(), baseline);
});

test("explicit native breakglass admission does not inherit an unrelated expired cohort deadline", async t => {
  const f = await selectedOutputShareFixture(t);
  f.installPilot({ endsAt: "2020-01-02T00:00:00.000Z" });
  f.env.FORMA_ADMIN_EMAILS = EMAIL;
  const issued = await issue(f);
  assert.ok(f.shares()[0].provenance_expires_at >= issued.share.expiresAt);
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 200);
});

test("an organization domain policy permits the actual authenticated owner while refusing public delivery", async t => {
  const f = await selectedOutputShareFixture(t), issued = await issue(f), now = new Date().toISOString();
  f.insert("organizations", { organization_id: "share-policy-org", name: "Synthetic restricted organization", owner_user_id: OWNER,
    status: "active", created_at: now, updated_at: now });
  f.insert("organization_memberships", { membership_id: "share-policy-member", organization_id: "share-policy-org", user_id: OWNER,
    role: "owner", status: "active", invited_by_user_id: OWNER, accepted_at: now, created_at: now, updated_at: now });
  f.insert("organization_security_policies", { organization_id: "share-policy-org", allowed_domains_json: JSON.stringify(["example.test"]),
    updated_by_user_id: OWNER, updated_at: now });
  const { output: ignoredOutput, ...selection } = f.selection(); void ignoredOutput;
  const authenticated = await handleRetainedStoryRead(new Request(`https://forma.test${retainedStoryRequestPath(selection)}`, {
    headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL },
  }), f.env);
  assert.equal(authenticated.status, 200); assert.equal((await authenticated.json()).contentMarkdown, LITERAL);
  const baseline = f.changes(); f.calls.length = 0;
  assert.equal((await readSelectedOutputShare(publicRequest(), f.env, issued.share.token)).status, 404);
  assert.equal((await prepareSelectedOutputShare(f.request({ intentKey: "restricted-policy-review", selection: f.selection(), review: f.review() }), f.env)).status, 404);
  assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false, "public policy refuses before private artifact selection");
  assert.equal(f.changes(), baseline);
});

function minimizeDirect(f, shareId) {
  const now = new Date().toISOString();
  f.sqlite.prepare(`UPDATE selected_output_shares SET ${SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column}=NULL`).join(",")},
    revoked_at=COALESCE(revoked_at,?),minimized_at=? WHERE share_id=?`).run(now, now, shareId);
}

test("preparation binds the exact canonical subject and intent in a purpose-separated immutable replay key", async t => {
  const f = await selectedOutputShareFixture(t), prepared = await prepare(f);
  const expected = digest(`selected-output-replay-v1\0${JSON.stringify([PURPOSE, OWNER, prepared.body.intentKey])}`);
  const stored = f.shares()[0];
  assert.equal(stored.replay_key, expected);
  assert.notEqual(stored.replay_key, digest(JSON.stringify([PURPOSE, OWNER, prepared.body.intentKey])));
  assert.notEqual(stored.replay_key, digest(`selected-output-replay-v1\0${JSON.stringify([PURPOSE, EMAIL, prepared.body.intentKey])}`));
  assert.equal(stored.minimized_at, null);
});

test("minimized review intents and tokens stay consumed while a fresh intent still needs current native custody", async t => {
  for (const state of ["prepared", "issued"]) await t.test(state, async child => {
    const f = await selectedOutputShareFixture(child);
    const result = state === "issued" ? await issue(f) : { prepared: await prepare(f) };
    const original = { ...f.shares()[0] }, shareId = result.prepared.candidateId;
    minimizeDirect(f, shareId);
    const tombstone = { ...f.shares()[0] }, baseline = f.changes(); f.calls.length = 0;
    for (const column of SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS) assert.equal(tombstone[column], null, column);
    assert.equal(tombstone.replay_key, original.replay_key);
    assert.equal(tombstone.token_hash, original.token_hash);
    assert.equal((await prepareSelectedOutputShare(f.request(result.prepared.body), f.env)).status, 404);
    assert.equal((await commitSelectedOutputShare(f.request(approval(result.prepared)), f.env)).status, 404);
    if (result.share) assert.equal((await readSelectedOutputShare(publicRequest(), f.env, result.share.token)).status, 404);
    assert.equal((await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, shareId)).status, 404);
    assert.equal(f.calls.some(sql => sql.includes("event_base AS") || sql.includes("native_principal AS")), false,
      "a terminal replay refuses before native authorization or private selection");
    assert.equal(f.changes(), baseline);
    assert.deepEqual({ ...f.shares()[0] }, tombstone);
    const next = await issue(f, { intentKey: "fresh-explicit-review-after-minimization" });
    assert.notEqual(next.share.shareId, shareId);
    assert.equal((await readSelectedOutputShare(publicRequest(), f.env, next.share.token)).status, 200);
    assert.equal(f.shares().length, 2);
    f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
    const beforeRefusal = f.changes();
    assert.equal((await prepareSelectedOutputShare(f.request({ ...result.prepared.body, intentKey: "fresh-intent-without-custody" }), f.env)).status, 404);
    assert.equal(f.shares().length, 2); assert.equal(f.changes(), beforeRefusal);
  });
});

test("absent or partial share schema rejects every lifecycle entry before authorization, private reads or initialization", async t => {
  for (const schema of ["absent", "partial"]) for (const operation of ["prepare", "commit", "read", "revoke"]) {
    await t.test(`${schema} ${operation}`, async child => {
      const f = await selectedOutputShareFixture(child, { installShareSchema: false });
      if (schema === "partial") f.sqlite.exec("CREATE TABLE selected_output_shares(share_id TEXT PRIMARY KEY NOT NULL)");
      const before = f.changes(), tables = f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
      let response;
      if (operation === "prepare") response = await prepareSelectedOutputShare(f.request({ intentKey: "schema-unready", selection: f.selection(), review: f.review() }), f.env);
      else if (operation === "commit") response = await commitSelectedOutputShare(f.request({ candidateId: "unavailable-share", approval: {
        purpose: PURPOSE, candidateSha256: "0".repeat(64), allowPublicRead: true } }), f.env);
      else if (operation === "read") response = await readSelectedOutputShare(publicRequest(), f.env, "a".repeat(32));
      else response = await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, "unavailable-share");
      assert.equal(response.status, 404); headers(response);
      assert.equal(f.calls.length, 1, "only the read-only readiness statement is reached");
      assert.match(f.calls[0], /main\.sqlite_schema/u);
      assert.doesNotMatch(f.calls[0], /native_principal AS|event_base AS|FROM private_content|UPDATE selected_output_shares/u);
      assert.equal(f.changes(), before);
      assert.deepEqual(f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all(), tables);
    });
  }
});

test("each final lifecycle statement rechecks schema integrity after the initial readiness observation", async t => {
  for (const operation of ["prepare", "commit", "read", "revoke"]) await t.test(operation, async child => {
    const f = await selectedOutputShareFixture(child);
    const result = operation === "prepare" ? null : operation === "commit" ? { prepared: await prepare(f) } : await issue(f);
    const before = f.changes(), original = f.shares().map(row => ({ ...row })); let raced = false;
    f.setBeforeStatement(sql => {
      const boundary = operation === "prepare" ? preparationWrite(sql)
        : operation === "commit" ? tokenWrite(sql) : operation === "read" ? finalRead(sql)
          : sql.startsWith("UPDATE selected_output_shares SET revoked_at=");
      if (!boundary) return;
      f.setBeforeStatement(null); raced = true;
      f.sqlite.exec("DROP TRIGGER selected_output_share_no_delete");
    });
    let response;
    if (operation === "prepare") response = await prepareSelectedOutputShare(f.request({ intentKey: "schema-race", selection: f.selection(), review: f.review() }), f.env);
    else if (operation === "commit") response = await commitSelectedOutputShare(f.request(approval(result.prepared)), f.env);
    else if (operation === "read") response = await readSelectedOutputShare(publicRequest(), f.env, result.share.token);
    else response = await revokeSelectedOutputShare(f.request(undefined, {}, "DELETE"), f.env, result.share.shareId);
    assert.equal(raced, true, "the final schema boundary must be reached");
    assert.equal(response.status, 404); headers(response);
    assert.equal(f.changes(), before, "no grant, revocation or candidate is written under the altered schema");
    assert.deepEqual(f.shares().map(row => ({ ...row })), original);
  });
});
