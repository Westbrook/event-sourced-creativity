import assert from "node:assert/strict";
import test from "node:test";
import { storageFixture, policy, row, snapshot } from "./helpers/private-identity-admission-fixture.mjs";
import { atSql } from "./helpers/canvas-expired-disposition-fixture.mjs";

const day = 86_400_000;
const identity = suffix => ({ contentId: "experience-draft-" + suffix.repeat(64) });
const admitted = { sql: "1", bindings: [] };
const future = (milliseconds = day) => new Date(Date.now() + milliseconds).toISOString();
const prepare = (f, options = {}) => policy.preparePrivateContent(f.state.env, f.owner,
  options.kind ?? "experience-draft", options.content ?? "Exact native draft bytes 日本語\n",
  f.scope, undefined, Object.hasOwn(options, "guard") ? options.guard : admitted,
  Object.hasOwn(options, "identity") ? options.identity : identity("a"), options.ceiling);
async function persist(f, prepared) {
  const results = await f.state.env.DB.batch(prepared.statements);
  assert.ok(results.slice(0, prepared.requiredInserts).every(result => Number(result.meta.changes) === 1));
  return row(f.state, prepared.contentId);
}
function setPolicy(f, transientDays) {
  f.state.sqlite.prepare(`INSERT INTO organization_retention_policies
    (organization_id,transient_days,evidence_days,revision_days,legal_hold,version,updated_by_user_id,updated_at)
    VALUES(?,?,365,365,0,1,?,?)`).run(f.scope.organizationId, transientDays, f.owner, new Date().toISOString());
}
async function passDeadline(ceiling) {
  while (Date.now() <= Date.parse(ceiling)) await new Promise(resolve => setTimeout(resolve, Math.max(1, Date.parse(ceiling) - Date.now() + 2)));
}

for (const mode of ["personal", "scoped"]) test("bounded native draft persists the exact shorter source ceiling / " + mode, async t => {
  const f = await storageFixture(t, mode), ceiling = future(), content = "Retained draft\n日本語\u0000exact end";
  const prepared = await prepare(f, { ceiling, content }), stored = await persist(f, prepared);
  assert.equal(prepared.contentId, identity("a").contentId);
  assert.equal(stored.content, content); assert.equal(stored.owner_id, f.owner); assert.equal(stored.kind, "experience-draft");
  assert.equal(stored.expires_at, ceiling); assert.equal(prepared.expiresAt, ceiling); assert.equal(stored.redacted_at, null);
  const retention = f.state.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(prepared.contentId);
  const resource = f.state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(prepared.contentId);
  if (f.scope) {
    assert.equal(retention.assigned_expires_at, ceiling); assert.equal(retention.classification, "transient-private");
    assert.equal(retention.actor_user_id, f.owner); assert.equal(resource.project_access_id, f.scope.projectAccessId);
    assert.equal(resource.visibility, "actor_private");
  } else { assert.equal(retention, undefined); assert.equal(resource, undefined); }
});

test("a later source ceiling never extends tighter ordinary native retention", async t => {
  const f = await storageFixture(t, "personal"); f.state.env.FORMA_RETENTION_DAYS = "1";
  const prepared = await prepare(f, { ceiling: future(5 * day) }), stored = await persist(f, prepared);
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), day);
});

test("a later source ceiling never extends tighter project retention or its assigned custody record", async t => {
  const f = await storageFixture(t, "scoped"); setPolicy(f, 2); f.state.env.FORMA_RETENTION_DAYS = "30";
  const prepared = await prepare(f, { ceiling: future(5 * day) }), stored = await persist(f, prepared);
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 2 * day);
  const retention = f.state.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(prepared.contentId);
  assert.equal(retention.assigned_expires_at, stored.expires_at); assert.equal(retention.policy_version, 1);
});

test("ordinary drafts keep unbounded-input compatibility and their native default lifetime", async t => {
  const f = await storageFixture(t, "personal"), content = "x".repeat(65_537);
  const prepared = await prepare(f, { content, guard: undefined, identity: undefined }), stored = await persist(f, prepared);
  assert.match(stored.content_id, /^[a-f0-9-]{36}$/u); assert.equal(stored.content, content);
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 30 * day);
});

test("ordinary storePrivateContent keeps native draft identity and lifetime without a new ceiling API", async t => {
  const f = await storageFixture(t, "personal"); f.state.env.FORMA_RETENTION_DAYS = "2";
  const saved = await policy.storePrivateContent(f.state.env, f.owner, "experience-draft", "Ordinary stored draft", undefined,
    admitted, undefined, identity("b")), stored = row(f.state, saved.contentId);
  assert.equal(saved.contentId, identity("b").contentId); assert.equal(saved.expiresAt, stored.expires_at);
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 2 * day);
});

test("bounded draft admits exactly 65536 UTF-8 bytes and refuses oversized, empty or ill-formed text", async t => {
  const f = await storageFixture(t, "personal"), content = "😀".repeat(16_384), ceiling = future();
  assert.equal(new TextEncoder().encode(content).byteLength, 65_536);
  const stored = await persist(f, await prepare(f, { content, ceiling })); assert.equal(stored.content, content);
  const before = snapshot(f.state);
  for (const rejected of [content + "a", "é".repeat(32_769), "", "\ud800", "valid\udfff", 42]) {
    await assert.rejects(prepare(f, { content: rejected, ceiling, identity: identity("b") }),
      { message: "private_content_draft_bound_invalid" });
  }
  assert.deepEqual(snapshot(f.state), before);
});

test("source ceilings require both a guard and an allowed stable draft identity before any write", async t => {
  const f = await storageFixture(t, "personal"), ceiling = future();
  await persist(f, await prepare(f, { ceiling, identity: identity("f") }));
  const before = snapshot(f.state);
  for (const input of [{ guard: undefined }, { identity: undefined }, { guard: undefined, identity: undefined },
    { identity: { contentId: "experience-draft-wrong" } }, { identity: { contentId: "copy-preview-" + "a".repeat(64) } }]) {
    await assert.rejects(prepare(f, { ceiling, ...input }), { message: "private_content_draft_bound_invalid" });
  }
  assert.deepEqual(snapshot(f.state), before);
});

test("bounded draft rejects expired, noncanonical and invalid ceilings without private writes", async t => {
  const f = await storageFixture(t, "personal");
  await persist(f, await prepare(f, { ceiling: future(), identity: identity("f") }));
  const before = snapshot(f.state);
  const later = future();
  for (const ceiling of [new Date(Date.now() - 1).toISOString(), "not-a-date", "", null, 123,
    later.replace("Z", "+00:00"), later.slice(0, 19) + "Z", "99999-01-01T00:00:00.000Z"]) {
    await assert.rejects(prepare(f, { ceiling }), { message: "private_content_expiry_ceiling_invalid" });
  }
  assert.deepEqual(snapshot(f.state), before);
});

test("unrelated prompt ceilings remain rejected while ordinary prompt storage is unchanged", async t => {
  const f = await storageFixture(t, "personal"), before = snapshot(f.state);
  await assert.rejects(prepare(f, { kind: "prompt", ceiling: future(), guard: undefined, identity: undefined }),
    { message: "private_content_expiry_ceiling_invalid" });
  assert.deepEqual(snapshot(f.state), before);
  const prepared = await prepare(f, { kind: "prompt", guard: undefined, identity: undefined }), stored = await persist(f, prepared);
  assert.equal(stored.kind, "prompt"); assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 30 * day);
});

for (const mode of ["personal", "scoped"]) test("withdrawn bound guard atomically refuses body, custody and subsequent publication / " + mode, async t => {
  const f = await storageFixture(t, mode);
  const guard = { sql: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role='admin')", bindings: [f.owner] };
  const prepared = await prepare(f, { guard, ceiling: future() });
  f.state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.owner);
  const before = snapshot(f.state);
  await assert.rejects(f.state.env.DB.batch([...prepared.statements,
    f.state.env.DB.prepare("UPDATE users SET role='admin' WHERE user_id=?").bind(f.owner)]), /NOT NULL constraint failed: private_content\.content/u);
  assert.deepEqual(snapshot(f.state), before);
  assert.equal(f.state.sqlite.prepare("SELECT role FROM users WHERE user_id=?").get(f.owner).role, "viewer");
});

test("a changed project retention policy denies the prepared bounded draft transaction", async t => {
  const f = await storageFixture(t, "scoped"); setPolicy(f, 2);
  const prepared = await prepare(f, { ceiling: future() });
  f.state.sqlite.prepare("UPDATE organization_retention_policies SET version=version+1,transient_days=1 WHERE organization_id=?").run(f.scope.organizationId);
  const before = snapshot(f.state);
  await assert.rejects(f.state.env.DB.batch(prepared.statements), /NOT NULL constraint failed: private_content\.content/u);
  assert.deepEqual(snapshot(f.state), before);
});

test("a ceiling that expires while native project policy is awaited cannot yield insert statements", async t => {
  const f = await storageFixture(t, "scoped"), before = snapshot(f.state), ceiling = future(100);
  const hook = atSql(f.state, "SELECT transient_days,evidence_days,version FROM organization_retention_policies", () => passDeadline(ceiling));
  try { await assert.rejects(prepare(f, { ceiling }), { message: "private_content_expiry_ceiling_invalid" }); }
  finally { hook.restore(); }
  assert.equal(hook.hits(), 1); assert.deepEqual(snapshot(f.state), before);
});

test("optional cleanup schema awaits cannot return a bounded draft after its source deadline", async t => {
  const f = await storageFixture(t, "personal"), before = snapshot(f.state), ceiling = future(100);
  const batch = f.state.env.DB.batch.bind(f.state.env.DB); let crossed = false;
  f.state.env.DB.batch = async statements => {
    const results = await batch(statements);
    if (!crossed && statements.some(statement => statement.sql.includes("sqlite_schema"))) {
      crossed = true; await passDeadline(ceiling);
    }
    return results;
  };
  try { await assert.rejects(prepare(f, { ceiling }), { message: "private_content_expiry_ceiling_invalid" }); }
  finally { f.state.env.DB.batch = batch; }
  assert.equal(crossed, true); assert.deepEqual(snapshot(f.state), before);
});

test("database replacement during native policy proof invalidates bounded draft preparation", async t => {
  const f = await storageFixture(t, "scoped"), original = f.state.env.DB, before = snapshot(f.state);
  const hook = atSql(f.state, "SELECT transient_days,evidence_days,version FROM organization_retention_policies", () => { f.state.env.DB = { ...original }; });
  try { await assert.rejects(prepare(f, { ceiling: future() }), { message: "private_content_preparation_database_changed" }); }
  finally { f.state.env.DB = original; hook.restore(); }
  assert.equal(hook.hits(), 1); assert.deepEqual(snapshot(f.state), before);
});
