import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SELECTED_OUTPUT_SHARE_SCHEMA, SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS } from "../worker/selected-output-share-schema.ts";

// This independent expected list is the approved minimization boundary, not a
// projection copied from the implementation under test.
const privateColumns = ["owner_id", "owner_email", "intent_key", "project_id", "job_id", "completion_event_id",
  "selection_json", "review_title", "source_expires_at", "provenance_expires_at", "expires_at",
  "candidate_sha256", "issuer_authority_sha256", "created_at"];
const operationalColumns = ["share_id", "purpose", "replay_key", "token_hash", "issued_at", "revoked_at", "minimized_at"];
const purpose = "selected-output-read-v1";
const created = "2020-01-01T00:00:00.000Z";
const issued = "2020-01-02T00:00:00.000Z";
const revoked = "2020-01-03T00:00:00.000Z";
const minimized = "2020-01-04T00:00:00.000Z";
const sha = value => createHash("sha256").update(value).digest("hex");
const replayKey = (owner, intent) => sha(`selected-output-replay-v1\0${JSON.stringify([purpose, owner, intent])}`);
function candidate(id = "one", patch = {}) {
  const owner = `owner-${id}`, intent = `intent-${id}`;
  return { share_id: `share-${id}`, purpose, replay_key: replayKey(owner, intent), owner_id: owner,
    owner_email: `${owner}@example.test`, intent_key: intent, project_id: `project-${id}`, job_id: `job-${id}`,
    completion_event_id: `completion-${id}`, selection_json: JSON.stringify({ output: "short_story", documentId: `document-${id}`,
      artifactId: `artifact-${id}`, revision: 0, contentSha256: sha(`native-${id}`) }), review_title: `Private reviewed title ${id}`,
    source_expires_at: "2099-01-01T00:00:00.000Z", provenance_expires_at: "2099-01-01T00:00:00.000Z",
    expires_at: "2098-01-01T00:00:00.000Z", candidate_sha256: sha(`candidate-${id}`), issuer_authority_sha256: sha(`authority-${id}`),
    created_at: created, token_hash: null, issued_at: null, revoked_at: null, minimized_at: null, ...patch };
}
function fixture(t, rows = [candidate()]) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec("PRAGMA recursive_triggers=OFF");
  for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) sqlite.exec(sql);
  const insert = (row, verb = "INSERT") => {
    const columns = Object.keys(row);
    return sqlite.prepare(`${verb} INTO selected_output_shares(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`)
      .run(...columns.map(column => row[column]));
  };
  for (const row of rows) insert(row);
  const update = (shareId, patch, verb = "UPDATE") => sqlite.prepare(`${verb} selected_output_shares SET ${Object.keys(patch).map(column => `${column}=?`).join(",")} WHERE share_id=?`)
    .run(...Object.values(patch), shareId);
  const read = shareId => ({ ...sqlite.prepare("SELECT * FROM selected_output_shares WHERE share_id=?").get(shareId) });
  const all = () => sqlite.prepare("SELECT * FROM selected_output_shares ORDER BY share_id").all().map(row => ({ ...row }));
  const minimize = (shareId, patch = {}) => update(shareId, { ...Object.fromEntries(privateColumns.map(column => [column, null])),
    revoked_at: read(shareId).revoked_at ?? minimized, minimized_at: minimized, ...patch });
  return { sqlite, insert, update, read, all, minimize };
}
const immutableFailure = /selected_output_share_immutable|CHECK constraint failed/u;

test("the schema names the exact approved private fields, including creation time", () => {
  assert.deepEqual([...SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS], privateColumns);
});

test("unissued, issued and previously revoked shares each permit the same one-way complete minimization", async t => {
  for (const state of ["unissued", "issued", "revoked"]) await t.test(state, child => {
    const original = candidate(state, state === "unissued" ? {} : { token_hash: sha(`token-${state}`), issued_at: issued,
      ...(state === "revoked" ? { revoked_at: revoked } : {}) });
    const f = fixture(child, [original]);
    assert.equal(f.minimize(original.share_id).changes, 1);
    const terminal = f.read(original.share_id);
    for (const column of privateColumns) assert.equal(terminal[column], null, column);
    for (const column of ["share_id", "purpose", "replay_key", "token_hash", "issued_at"]) assert.equal(terminal[column], original[column], column);
    assert.equal(terminal.revoked_at, original.revoked_at ?? minimized);
    assert.equal(terminal.minimized_at, minimized);
    assert.deepEqual(Object.keys(terminal).filter(column => terminal[column] !== null).sort(),
      operationalColumns.filter(column => terminal[column] !== null).sort());
    assert.doesNotMatch(JSON.stringify(terminal), /owner-|@example|intent-|project-|job-|completion-|document-|artifact-|Private reviewed/u);
    assert.equal(f.all().length, 1, "an operational replay tombstone survives");
  });
});

test("clearing any single private field without a terminal transition refuses", async t => {
  for (const column of privateColumns) await t.test(column, child => {
    const original = candidate(), f = fixture(child, [original]);
    assert.throws(() => f.update(original.share_id, { [column]: null }), immutableFailure);
    assert.deepEqual(f.read(original.share_id), original);
  });
});

test("minimization cannot leave even one approved private field behind", async t => {
  for (const column of privateColumns) await t.test(column, child => {
    const original = candidate(), f = fixture(child, [original]);
    assert.throws(() => f.minimize(original.share_id, { [column]: original[column] }), immutableFailure);
    assert.deepEqual(f.read(original.share_id), original);
  });
});

test("minimization requires revocation and ordered creation, issuance and revocation timestamps", async t => {
  const cases = [
    ["no revocation", candidate(), { revoked_at: null }],
    ["initial revocation differs from minimization", candidate(), { revoked_at: revoked }],
    ["before creation", candidate(), { minimized_at: "2019-12-31T00:00:00.000Z", revoked_at: "2019-12-31T00:00:00.000Z" }],
    ["before issuance", candidate("one", { token_hash: sha("token"), issued_at: issued }), { minimized_at: created, revoked_at: created }],
    ["before existing revocation", candidate("one", { revoked_at: revoked }), { minimized_at: issued }],
    ["changed existing revocation", candidate("one", { revoked_at: revoked }), { revoked_at: minimized }],
    ["cleared existing token", candidate("one", { token_hash: sha("token"), issued_at: issued }), { token_hash: null, issued_at: null }],
    ["new issuance while minimizing", candidate(), { token_hash: sha("new-token"), issued_at: issued }],
    ["token rotation while minimizing", candidate("one", { token_hash: sha("token"), issued_at: issued }), { token_hash: sha("rotated-token") }],
  ];
  for (const [label, original, patch] of cases) await t.test(label, child => {
    const f = fixture(child, [original]);
    assert.throws(() => f.minimize(original.share_id, patch), immutableFailure);
    assert.deepEqual(f.read(original.share_id), original);
  });
});

test("a minimized row cannot reanimate, mutate private data, rotate a token or replace operational identity", async t => {
  const changes = [
    ...privateColumns.map(column => [column, candidate()[column]]),
    ["minimized_at", null], ["minimized_at", "2020-01-05T00:00:00.000Z"], ["revoked_at", null],
    ["revoked_at", "2020-01-05T00:00:00.000Z"], ["issued_at", null], ["issued_at", "2020-01-03T00:00:00.000Z"],
    ["token_hash", null], ["token_hash", sha("rotated")], ["share_id", "replacement-share"],
    ["purpose", "another-purpose"], ["replay_key", sha("replacement-intent")],
  ];
  for (const [column, value] of changes) await t.test(`${column}=${value === null ? "null" : "different"}`, child => {
    const original = candidate("one", { token_hash: sha("token"), issued_at: issued }), f = fixture(child, [original]);
    f.minimize(original.share_id); const before = f.read(original.share_id);
    assert.throws(() => f.update(original.share_id, { [column]: value }), immutableFailure);
    assert.deepEqual(f.read(original.share_id), before);
  });
});

test("the whole original private row cannot be restored after minimization", t => {
  const original = candidate(), f = fixture(t, [original]);
  f.minimize(original.share_id); const before = f.read(original.share_id);
  assert.throws(() => f.update(original.share_id, original), immutableFailure);
  assert.deepEqual(f.read(original.share_id), before);
  assert.throws(() => f.sqlite.prepare("DELETE FROM selected_output_shares WHERE share_id=?").run(original.share_id), immutableFailure);
  assert.deepEqual(f.read(original.share_id), before);
});

test("a tombstone cannot be directly inserted, even with a complete internally consistent operational shape", t => {
  const f = fixture(t, []), row = candidate();
  for (const column of privateColumns) row[column] = null;
  row.revoked_at = minimized; row.minimized_at = minimized;
  assert.throws(() => f.insert(row), /selected_output_share_exists/u);
  assert.equal(f.all().length, 0);
});

test("the replay key is immutable before minimization as well as afterward", t => {
  const original = candidate(), f = fixture(t, [original]);
  assert.throws(() => f.update(original.share_id, { replay_key: sha("different-review") }), immutableFailure);
  assert.deepEqual(f.read(original.share_id), original);
});

test("INSERT OR REPLACE cannot erase a tombstone through any retained unique key", async t => {
  for (const unique of ["share_id", "replay_key", "token_hash"]) await t.test(unique, child => {
    const original = candidate("one", { token_hash: sha("token-one"), issued_at: issued }), f = fixture(child, [original]);
    f.minimize(original.share_id); const before = f.all(), terminal = before[0];
    const next = candidate("two", { token_hash: sha("token-two"), issued_at: issued, [unique]: terminal[unique] });
    assert.throws(() => f.insert(next, "INSERT OR REPLACE"), /selected_output_share_exists/u);
    assert.deepEqual(f.all(), before);
  });
});

test("UPDATE OR REPLACE cannot erase a tombstone through any retained unique key", async t => {
  for (const unique of ["share_id", "replay_key", "token_hash"]) await t.test(unique, child => {
    const original = candidate("one", { token_hash: sha("token-one"), issued_at: issued }), next = candidate("two"), f = fixture(child, [original, next]);
    f.minimize(original.share_id); const before = f.all(), terminal = f.read(original.share_id);
    const patch = { [unique]: terminal[unique], ...(unique === "token_hash" ? { issued_at: issued } : {}) };
    assert.throws(() => f.update(next.share_id, patch, "UPDATE OR REPLACE"), immutableFailure);
    assert.deepEqual(f.all(), before);
  });
});

test("the active owner-and-intent unique key cannot delete a live row through REPLACE", t => {
  const original = candidate(), f = fixture(t, [original]), replacement = candidate("two", { owner_id: original.owner_id, intent_key: original.intent_key });
  assert.throws(() => f.insert(replacement, "INSERT OR REPLACE"), /selected_output_share_exists/u);
  assert.deepEqual(f.all(), [original]);
});

test("WITHOUT ROWID closes implicit row-identity replacement while unrelated fresh replay keys remain usable", t => {
  const original = candidate(), f = fixture(t, [original]);
  assert.match(f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='selected_output_shares'").get().sql, /WITHOUT ROWID/iu);
  assert.throws(() => f.sqlite.prepare("SELECT rowid FROM selected_output_shares").get(), /no such column: rowid/u);
  f.minimize(original.share_id);
  const next = candidate("next", { owner_id: original.owner_id, owner_email: original.owner_email,
    replay_key: replayKey(original.owner_id, "intent-next") });
  assert.equal(f.insert(next).changes, 1);
  assert.equal(f.all().length, 2);
});
