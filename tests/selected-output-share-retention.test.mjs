import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let SELECTED_OUTPUT_SHARE_SCHEMA, preparePersonalSelectedOutputShareErasure;
let prepareSelectedOutputShareRetentionStep, selectedOutputShareRetentionBacklog;
try {
  ({ SELECTED_OUTPUT_SHARE_SCHEMA } = await import("../worker/selected-output-share-schema.ts"));
  ({ preparePersonalSelectedOutputShareErasure, prepareSelectedOutputShareRetentionStep, selectedOutputShareRetentionBacklog }
    = await import("../worker/selected-output-share-retention.ts"));
} finally { imports.deregister(); }

const PURPOSE = "selected-output-read-v1", OWNER = "retention-owner", FOREIGN = "another-owner";
const digest = text => createHash("sha256").update(text).digest("hex");
const unchangedKeys = ["share_id", "purpose", "replay_key", "token_hash", "issued_at"];
const tombstoneKeys = new Set([...unchangedKeys, "revoked_at", "minimized_at"]);

/** Only this disposable SQLite fixture installs schema. Production retention
 * may read or update the dedicated table; it cannot initialize the application,
 * access media, call a provider, or perform unrelated writes.
 */
function fixture(t, { installed = true } = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  t.mock.method(globalThis, "fetch", () => { throw new Error("retention must not call the network"); });
  if (installed) for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) state.sqlite.exec(sql);
  const calls = [];
  const DB = {
    prepare(sql) {
      assert.match(sql, /^\s*(?:SELECT|WITH|UPDATE\s+(?:main\.)?selected_output_shares\b)/iu);
      calls.push(sql);
      return state.DB.prepare(sql);
    },
    batch: statements => state.DB.batch(statements),
  };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get() { throw new Error("retention must not enter MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("retention must not enter ASSETS"); } } };
  const insert = row => state.sqlite.prepare(`INSERT INTO selected_output_shares(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const now = new Date().toISOString();
  const seed = (id, patch = {}) => {
    const row = {
      share_id: id, purpose: PURPOSE, replay_key: digest(`synthetic-replay:${patch.owner_id ?? OWNER}:${id}`),
      owner_id: OWNER, owner_email: "private-owner@example.test", intent_key: `private-intent-${id}`,
      project_id: "private-project", job_id: "private-native-job", completion_event_id: "private-completion",
      selection_json: JSON.stringify({ output: "short_story", documentId: "private-document", artifactId: "private-artifact", revision: 2, contentSha256: digest("native-bytes") }),
      review_title: "Private reviewed title", source_expires_at: "2099-01-01T00:00:00.000Z", provenance_expires_at: "2099-01-01T00:00:00.000Z",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), candidate_sha256: digest(`private-candidate-${id}`),
      issuer_authority_sha256: digest(`private-authority-${id}`), created_at: "2020-01-01T00:00:00.000Z",
      token_hash: null, issued_at: null, revoked_at: null, minimized_at: null, ...patch,
    };
    insert(row);
    return row;
  };
  return { ...state, env, calls, now, seed, insert,
    rows: () => state.sqlite.prepare("SELECT * FROM selected_output_shares ORDER BY share_id").all().map(row => ({ ...row })),
    row: id => ({ ...state.sqlite.prepare("SELECT * FROM selected_output_shares WHERE share_id=?").get(id) }),
  };
}

const complete = plan => [...plan.statements, ...plan.terminalAssertions];
const compile = (f, step) => step.statements.map(value => f.env.DB.prepare(value.sql).bind(...value.bindings));
async function erase(f, owner = OWNER) {
  const plan = await preparePersonalSelectedOutputShareErasure(f.env, owner, f.now);
  const receipts = await f.env.DB.batch(complete(plan));
  return { plan, receipts, summary: plan.acknowledge(receipts) };
}
function assertMinimized(row, original, now) {
  for (const key of unchangedKeys) assert.equal(row[key], original[key], `${key} must remain an inert tombstone witness`);
  for (const key of Object.keys(original)) if (!tombstoneKeys.has(key)) assert.equal(row[key], null, `${key} must be minimized`);
  assert.equal(row.revoked_at, original.revoked_at ?? row.minimized_at);
  assert.ok(row.minimized_at >= now);
  assert.equal(Number.isFinite(Date.parse(row.minimized_at)), true);
}

test("personal erasure minimizes all owned raw metadata and preserves foreign custody plus inert replay witnesses", async t => {
  const f = fixture(t);
  const candidate = f.seed("candidate"), issued = f.seed("issued", { token_hash: digest("issued-token"), issued_at: "2020-01-01T00:00:01.000Z" });
  const revoked = f.seed("revoked", { token_hash: digest("revoked-token"), issued_at: "2020-01-01T00:00:01.000Z", revoked_at: "2021-01-01T00:00:00.000Z" });
  const foreign = f.seed("foreign", { owner_id: FOREIGN, owner_email: "foreign@example.test" });
  const { plan, receipts, summary } = await erase(f);
  assert.equal(plan.installed, true);
  assert.deepEqual(summary, { minimizedCount: 3 });
  for (const original of [candidate, issued, revoked]) assertMinimized(f.row(original.share_id), original, f.now);
  assert.deepEqual(f.row(foreign.share_id), foreign);
  assert.equal(plan.acknowledge(receipts), null, "a consumed acknowledgement cannot count erasure twice");
  assert.deepEqual((await erase(f)).summary, { minimizedCount: 0 });
  assert.equal(f.rows().length, 4);
  assert.equal(f.calls.some(sql => /\b(?:CREATE|ALTER|DROP|DELETE|budget|private_content|document_jobs)\b/iu.test(sql)), false);
});

test("wrong-owner erasure is an acknowledged no-op and cannot touch another owner's candidate", async t => {
  const f = fixture(t), original = f.seed("owned");
  assert.deepEqual((await erase(f, FOREIGN)).summary, { minimizedCount: 0 });
  assert.deepEqual(f.row(original.share_id), original);
});

test("erasure tombstones cannot resurrect raw fields or free token and replay uniqueness", async t => {
  const f = fixture(t), original = f.seed("inert", { token_hash: digest("inert-token"), issued_at: "2020-01-01T00:00:01.000Z" });
  await erase(f);
  const tombstone = f.row(original.share_id);
  assert.throws(() => f.sqlite.prepare("UPDATE selected_output_shares SET owner_id=? WHERE share_id=?").run(OWNER, original.share_id));
  assert.throws(() => f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=NULL WHERE share_id=?").run(original.share_id));
  assert.throws(() => f.sqlite.prepare("DELETE FROM selected_output_shares WHERE share_id=?").run(original.share_id));
  assert.throws(() => f.insert({ ...original, share_id: "new-share-same-replay", token_hash: null, issued_at: null }));
  assert.throws(() => f.insert({ ...original, share_id: "new-share-same-token", replay_key: digest("another-replay"), intent_key: "another-intent" }));
  assert.deepEqual(f.row(original.share_id), tombstone);
});

test("a missing installation has only schema bookends, zero backlog and no implicit initializer", async t => {
  const f = fixture(t, { installed: false });
  const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now);
  assert.equal(plan.installed, false);
  assert.ok(plan.statements.length > 0 && plan.terminalAssertions.length > 0);
  assert.deepEqual(plan.acknowledge(await f.env.DB.batch(complete(plan))), { minimizedCount: 0 });
  assert.deepEqual(await selectedOutputShareRetentionBacklog(f.env, { now: f.now }), { count: 0, oldest: null });
  assert.equal(await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now }), null);
  assert.deepEqual(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(), []);
});

test("partial installations and temp shadow tables refuse erasure, sweeping and backlog reads", async t => {
  for (const fault of ["table-only", "missing-trigger", "changed-trigger", "temp-shadow"]) await t.test(fault, async child => {
    const f = fixture(child, { installed: fault !== "table-only" });
    if (fault === "table-only") f.sqlite.exec(SELECTED_OUTPUT_SHARE_SCHEMA.find(sql => sql.startsWith("CREATE TABLE ")));
    else if (fault === "temp-shadow") f.sqlite.exec("CREATE TEMP TABLE selected_output_shares(share_id TEXT)");
    else {
      f.sqlite.exec("DROP TRIGGER selected_output_share_no_delete");
      if (fault === "changed-trigger") f.sqlite.exec("CREATE TRIGGER selected_output_share_no_delete BEFORE DELETE ON selected_output_shares BEGIN SELECT 1; END");
    }
    await assert.rejects(preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now), /unavailable/u);
    await assert.rejects(prepareSelectedOutputShareRetentionStep(f.env, { now: f.now }), /unavailable/u);
    await assert.rejects(selectedOutputShareRetentionBacklog(f.env, { now: f.now }), /unavailable/u);
  });
});

test("absent or ready schema must remain identical inside the actual erasure batch", async t => {
  for (const fault of ["installed-after-absence", "trigger-removed", "temp-shadow"]) await t.test(fault, async child => {
    const f = fixture(child, { installed: fault !== "installed-after-absence" });
    const original = fault === "installed-after-absence" ? null : f.seed("unchanged");
    const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now);
    if (fault === "installed-after-absence") for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
    else if (fault === "trigger-removed") f.sqlite.exec("DROP TRIGGER selected_output_share_no_delete");
    else f.sqlite.exec("CREATE TEMP TABLE selected_output_shares(share_id TEXT)");
    await assert.rejects(f.env.DB.batch(complete(plan)));
    if (original) assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM main.selected_output_shares WHERE share_id=?").get(original.share_id) }, original);
  });
});

test("a dropped minimization write is detected by terminal SQL and rolls back earlier writes in the same batch", async t => {
  const f = fixture(t), original = f.seed("rollback");
  f.sqlite.exec("CREATE TABLE retention_test_sentinel(value INTEGER NOT NULL)");
  f.sqlite.prepare("INSERT INTO retention_test_sentinel VALUES(0)").run();
  const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now);
  const omitted = complete(plan).filter(statement => !/^\s*UPDATE\s+(?:main\.)?selected_output_shares\b/iu.test(statement.sql));
  assert.ok(omitted.length < complete(plan).length);
  await assert.rejects(f.DB.batch([f.DB.prepare("UPDATE retention_test_sentinel SET value=1"), ...omitted]));
  assert.equal(f.sqlite.prepare("SELECT value FROM retention_test_sentinel").get().value, 0);
  assert.deepEqual(f.row(original.share_id), original);
});

test("an owner-row change after erasure preparation cannot silently change the acknowledged count", async t => {
  const f = fixture(t), first = f.seed("first"), plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now);
  const late = f.seed("late-arrival");
  await assert.rejects(f.env.DB.batch(complete(plan)));
  assert.deepEqual(f.row(first.share_id), first);
  assert.deepEqual(f.row(late.share_id), late);
});

test("erasure acknowledges only exact contiguous successful receipts without invoking getters", async t => {
  const faults = {
    missing: receipts => receipts.slice(1),
    extra: receipts => [...receipts, receipts[0]],
    sparse: receipts => { delete receipts[0]; return receipts; },
    failed: receipts => { receipts[0].success = false; return receipts; },
    error: receipts => { receipts[0].error = "unconfirmed"; return receipts; },
    "invalid count": (receipts, index) => { receipts[index].meta.changes = "1"; return receipts; },
    "wrong count": (receipts, index) => { receipts[index].meta.changes = 0; return receipts; },
    "missing terminal proof": receipts => { receipts.at(-1).results = []; return receipts; },
    "false terminal proof": receipts => { receipts.at(-1).results = [{ verified: 0 }]; return receipts; },
    "extra terminal proof": receipts => { receipts.at(-1).results = [{ verified: 1 }, { verified: 1 }]; return receipts; },
    "write has rows": (receipts, index) => { receipts[index].results = [{ unexpected: 1 }]; return receipts; },
  };
  for (const [name, corrupt] of Object.entries(faults)) await t.test(name, async child => {
    const f = fixture(child); f.seed("one");
    const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now), statements = complete(plan);
    const receipts = await f.env.DB.batch(statements), writeIndex = statements.findIndex(statement => /^\s*UPDATE\b/iu.test(statement.sql));
    assert.equal(plan.acknowledge(corrupt(structuredClone(receipts), writeIndex)), null);
    assert.equal(plan.acknowledge(receipts), null, "an uncertain acknowledgement consumes the plan");
  });
  await t.test("getter receipt", async child => {
    const f = fixture(child); f.seed("one");
    const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now), receipts = await f.env.DB.batch(complete(plan));
    let invoked = 0;
    Object.defineProperty(receipts[0], "success", { get() { invoked++; throw new Error("must not invoke receipt getters"); } });
    assert.equal(plan.acknowledge(receipts), null);
    assert.equal(invoked, 0);
  });
});

test("a changed database identity cannot acknowledge already dispatched erasure receipts", async t => {
  const f = fixture(t); f.seed("one");
  const plan = await preparePersonalSelectedOutputShareErasure(f.env, OWNER, f.now), receipts = await f.env.DB.batch(complete(plan));
  f.env.DB = f.DB;
  assert.equal(plan.acknowledge(receipts), null);
});

test("retention backlog counts only expired or already revoked raw rows and each step minimizes one row", async t => {
  const f = fixture(t);
  const expired = f.seed("expired", { expires_at: "2022-01-01T00:00:00.000Z" });
  const revoked = f.seed("revoked", { revoked_at: "2021-01-01T00:00:00.000Z" });
  const live = f.seed("live-candidate"), issued = f.seed("live-issued", { token_hash: digest("live-token"), issued_at: "2020-01-01T00:00:01.000Z" });
  assert.deepEqual(await selectedOutputShareRetentionBacklog(f.env, { now: f.now }), { count: 2, oldest: revoked.revoked_at });
  for (const original of [revoked, expired]) {
    const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
    assert.equal(step.workUnits, 1);
    assert.equal(step.oldest, original.revoked_at ?? original.expires_at);
    assert.equal(typeof step.selectionKey, "string"); assert.ok(step.selectionKey.length > 0 && step.selectionKey.length <= 240);
    assert.ok(Array.isArray(step.assertionIndexes) && step.assertionIndexes.length > 0);
    const receipts = await f.env.DB.batch(compile(f, step));
    assert.equal(step.acknowledge(receipts), true);
    assert.equal(step.acknowledge(receipts), false);
    assertMinimized(f.row(original.share_id), original, f.now);
  }
  assert.deepEqual(await selectedOutputShareRetentionBacklog(f.env, { now: f.now }), { count: 0, oldest: null });
  assert.equal(await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now }), null);
  assert.deepEqual(f.row(live.share_id), live);
  assert.deepEqual(f.row(issued.share_id), issued);
});

test("valid old abandoned candidates have no invented early cleanup lifetime", async t => {
  const f = fixture(t), original = f.seed("old-valid-candidate");
  assert.equal(original.created_at, "2020-01-01T00:00:00.000Z");
  assert.equal(await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now }), null);
  assert.deepEqual(await selectedOutputShareRetentionBacklog(f.env, { now: f.now }), { count: 0, oldest: null });
  assert.deepEqual(f.row(original.share_id), original);
});

test("the exact expiry boundary becomes one eligible retention unit", async t => {
  const f = fixture(t), original = f.seed("boundary", { expires_at: f.now });
  assert.deepEqual(await selectedOutputShareRetentionBacklog(f.env, { now: f.now }), { count: 1, oldest: f.now });
  const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
  assert.equal(step.workUnits, 1);
  assert.equal(step.acknowledge(await f.env.DB.batch(compile(f, step))), true);
  assertMinimized(f.row(original.share_id), original, f.now);
});

test("a future caller timestamp cannot cause retention before the database clock permits it", async t => {
  const f = fixture(t), original = f.seed("still-valid");
  const future = new Date(Date.now() + 7_200_000).toISOString();
  let step;
  try { step = await prepareSelectedOutputShareRetentionStep(f.env, { now: future }); }
  catch (error) { assert.match(String(error), /unavailable/u); }
  if (step) await assert.rejects(f.env.DB.batch(compile(f, step)));
  assert.deepEqual(f.row(original.share_id), original);
});

test("retention preparation pins the exact selected row and rolls back after a legitimate late revocation", async t => {
  const f = fixture(t), original = f.seed("late-revocation", { expires_at: "2022-01-01T00:00:00.000Z" });
  const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
  f.sqlite.prepare("UPDATE selected_output_shares SET revoked_at=? WHERE share_id=?").run(f.now, original.share_id);
  const changed = f.row(original.share_id);
  await assert.rejects(f.env.DB.batch(compile(f, step)));
  assert.deepEqual(f.row(original.share_id), changed);
  const fresh = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
  assert.equal(fresh.acknowledge(await f.env.DB.batch(compile(f, fresh))), true);
  assertMinimized(f.row(original.share_id), changed, f.now);
});

test("a dropped sweep write cannot advance work acknowledgement or leave an earlier same-batch write committed", async t => {
  const f = fixture(t), original = f.seed("expired", { expires_at: "2022-01-01T00:00:00.000Z" });
  f.sqlite.exec("CREATE TABLE retention_test_sentinel(value INTEGER NOT NULL)"); f.sqlite.prepare("INSERT INTO retention_test_sentinel VALUES(0)").run();
  const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
  const statements = compile(f, step).filter(statement => !/^\s*UPDATE\b/iu.test(statement.sql));
  await assert.rejects(f.DB.batch([f.DB.prepare("UPDATE retention_test_sentinel SET value=1"), ...statements]));
  assert.equal(f.sqlite.prepare("SELECT value FROM retention_test_sentinel").get().value, 0);
  assert.deepEqual(f.row(original.share_id), original);
});

test("sweep acknowledgement rejects truncated, failed or forged changed-row counts", async t => {
  for (const fault of ["truncated", "failed", "zero-write", "missing-proof"]) await t.test(fault, async child => {
    const f = fixture(child); f.seed("expired", { expires_at: "2022-01-01T00:00:00.000Z" });
    const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
    const receipts = await f.env.DB.batch(compile(f, step)), corrupted = structuredClone(receipts);
    if (fault === "truncated") corrupted.pop();
    else if (fault === "failed") corrupted[0].success = false;
    else if (fault === "missing-proof") corrupted[step.assertionIndexes.at(-1)].results = [];
    else corrupted[step.statements.findIndex(value => /^\s*UPDATE\b/iu.test(value.sql))].meta.changes = 0;
    assert.equal(step.acknowledge(corrupted), false);
    assert.equal(step.acknowledge(receipts), false);
  });
});

test("retention work rechecks exact schema after preparation before minimizing anything", async t => {
  const f = fixture(t), original = f.seed("expired", { expires_at: "2022-01-01T00:00:00.000Z" });
  const step = await prepareSelectedOutputShareRetentionStep(f.env, { now: f.now });
  f.sqlite.exec("DROP TRIGGER selected_output_share_no_delete");
  await assert.rejects(f.env.DB.batch(compile(f, step)));
  assert.deepEqual(f.row(original.share_id), original);
});
