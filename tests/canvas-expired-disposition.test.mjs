import assert from "node:assert/strict";
import test from "node:test";
import { consentHash } from "../worker/consequential-consent.ts";
import {
  fixture, intent, preview, apply, assertFree, countEvents, actor, changes, retained, identity, retrieve, dismiss,
  canonicalState, financialState, disclosureDbClock, pauseClaim, atSql, pauseSql, atGuardedBatch, pauseGuardedBatch, changedSql,
} from "./helpers/canvas-expired-disposition-fixture.mjs";

const disclosureSql = "SELECT saved.content_id AS retained_id,";
const releaseSql = "UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','')";
function clocks(t, state, time, databaseTime = time) {
  const clock = disclosureDbClock(state);
  t.mock.timers.enable({ apis: ["Date"], now: time }); clock.set(new Date(databaseTime).toISOString());
  t.after(() => { t.mock.timers.reset(); clock.close(); });
  return { set(next, database = next) { t.mock.timers.setTime(next); clock.set(new Date(database).toISOString()); } };
}
function exactDescriptor(body, state, input, saved) {
  assert.deepEqual(Object.keys(body).sort(), ["disposition", "error", "maximumMicrousd", "providerCalls"]);
  assert.equal(body.error, "canvas_arrangement_preview_expired");
  assert.equal(body.providerCalls, 0); assert.equal(body.maximumMicrousd, 0);
  assert.deepEqual(body.disposition, { version: 1, actorUserId: actor(state), ...identity(input),
    previewId: saved.previewId, approvalHash: saved.approvalHash });
  assert.equal(JSON.stringify(body).includes(input.name), false);
  for (const key of ["preview", "events", "digest", "name", "sources", "before", "after"]) assert.equal(body[key], undefined);
}
function exactTerminal(body, status, input, saved) {
  assert.deepEqual(body, { status, ...identity(input), previewId: saved.previewId, approvalHash: saved.approvalHash });
}
const modes = ["personal", "selected", "owner-custody", "editor"];
for (const mode of modes) test("Canvas expired disposition exact original recovery " + mode, async t => {
  const state = await fixture(mode);
  try {
    const input = await intent(state, { name: "PRIVATE_原稿_لا يعاد إنشاؤه" }), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    const raw = retained(state, saved.previewId), before = canonicalState(state), eventCount = countEvents(state), financial = financialState(state), count = changes(state);
    const response = await retrieve(state, input); assert.equal(response.status, 409);
    exactDescriptor(await response.json(), state, input, saved);
    assert.equal(changes(state), count, "the fresh owner has only the original URL identity; descriptor read performs zero writes");
    assert.deepEqual(retained(state, saved.previewId), raw); assert.deepEqual(canonicalState(state), before);
    const done = await dismiss(state, input, saved); assert.equal(done.status, 200, await done.clone().text());
    exactTerminal(await done.json(), "dismissed", input, saved);
    const after = retained(state, saved.previewId);
    assert.equal(after.expires_at, raw.expires_at); assert.equal(after.redacted_at, raw.redacted_at);
    assert.deepEqual(JSON.parse(after.content).plan, JSON.parse(raw.content).plan);
    const finished = changes(state), again = await retrieve(state, input);
    assert.equal(again.status, 200); exactTerminal(await again.json(), "dismissed", input, saved);
    assert.equal(changes(state), finished); assert.deepEqual(canonicalState(state), before);
    assert.equal((await apply(state, input, saved)).status, 409, "old original cannot apply after explicit resolution");
    const next = await intent(state, { name: "Deliberately separate free review" });
    const nextPreview = await preview(state, next);
    assert.notEqual(nextPreview.previewId, saved.previewId); assert.notEqual(next.operationId, input.operationId);
    assert.deepEqual(canonicalState(state), before, "a new free review still does not Apply");
    assert.equal((await apply(state, next, nextPreview)).status, 200);
    assert.equal(countEvents(state) - eventCount, 1 + 2 * state.selectedItemIds.length);
    assert.deepEqual(financialState(state), financial); assertFree(state);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas disposition default and live read contracts " + mode, async t => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input), row = retained(state, saved.previewId);
    const count = changes(state), current = await retrieve(state, input), old = await retrieve(state, input, {});
    assert.equal(current.status, 200); assert.deepEqual(await current.json(), await old.json());
    assert.equal(changes(state), count); assert.deepEqual(retained(state, saved.previewId), row);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    const expired = await retrieve(state, input, {});
    assert.equal(expired.status, 409); assert.deepEqual(await expired.json(),
      { error: "canvas_arrangement_preview_expired", providerCalls: 0, maximumMicrousd: 0 });
    const missing = { ...input, operationId: crypto.randomUUID() }, before = changes(state);
    const normal = await retrieve(state, missing, {});
    assert.equal(normal.status, 200); assert.equal((await normal.json()).status, "not-applied");
    const guarded = await retrieve(state, missing); assert.equal(guarded.status, 409);
    assert.equal((await guarded.json()).status, undefined); assert.equal(changes(state), before);
  } finally { state.sqlite.close(); }
});

for (const order of ["database-first", "javascript-first"]) test("Canvas disposition uses positive database plan expiry " + order, async t => {
  const state = await fixture();
  try {
    const input = await intent(state), saved = await preview(state, input), expiry = Date.parse(saved.expiresAt);
    clocks(t, state, expiry + (order === "database-first" ? -1 : 1), expiry + (order === "database-first" ? 1 : -1));
    const before = changes(state), response = await retrieve(state, input), value = await response.json();
    assert.equal(changes(state), before);
    if (order === "database-first") { assert.equal(response.status, 409); exactDescriptor(value, state, input, saved); }
    else { assert.equal(response.status, 200); assert.equal(value.status, "review"); assert.equal(value.disposition, undefined); }
  } finally { state.sqlite.close(); }
});

for (const expiry of [null, "", "not-a-date", "9999-z", 1, {}, "2000-01-01", "2020-02-31T00:00:00.000Z"])
test("Canvas malformed expiry cannot create a disposition " + JSON.stringify(expiry), async () => {
  const state = await fixture();
  try {
    const input = await intent(state), saved = await preview(state, input), value = JSON.parse(retained(state, saved.previewId).content);
    if (expiry === null) delete value.plan.expiresAt; else value.plan.expiresAt = expiry;
    // Defensive malformed retained-data control, not an ordinary client mutation or forged HTTP reply.
    value.approvalHash = await consentHash(value.plan);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(value), saved.previewId);
    const before = changes(state), response = await retrieve(state, input), body = await response.json();
    assert.ok(response.status >= 400); assert.equal(body.disposition, undefined); assert.equal(body.preview, undefined);
    assert.equal(body.status, undefined); assert.equal(changes(state), before);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const fault of ["erased", "missing", "redacted", "bytes", "hash", "owner", "kind", "private-expiry", "custody", "principal"])
test("Canvas disposition final read fence " + mode + "/" + fault, async t => {
  const state = await fixture(mode); let gate;
  try {
    const input = await intent(state, { name: "PRIVATE_FINAL_BODY" }), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    // Complete unchanged traffic housekeeping before the fault. Separate cold controls
    // below prove its real cleanup; this assertion isolates the read endpoint itself.
    assert.equal((await state.request("/api/session", { headers: state.headers })).status, 200);
    let count, after;
    gate = atSql(state, disclosureSql, () => {
      mutate(state, saved.previewId, fault); count = changes(state); after = retained(state, saved.previewId);
    });
    const canonical = canonicalState(state), financial = financialState(state), response = await retrieve(state, input), body = await response.json();
    assert.equal(gate.hits(), 1); assert.ok(response.status >= 400);
    assert.equal(body.disposition, undefined); assert.equal(body.preview, undefined); assert.equal(body.status, undefined);
    assert.equal(JSON.stringify(body).includes(input.name), false); assert.equal(changes(state), count);
    assert.deepEqual(retained(state, saved.previewId), after);
    assert.deepEqual(canonicalState(state), canonical); assert.deepEqual(financialState(state), financial);
  } finally { gate?.restore(); state.sqlite.close(); }
});
function mutate(state, previewId, fault) {
  if (fault === "erased") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), previewId);
  if (fault === "missing") state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(previewId);
  if (fault === "redacted") state.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), previewId);
  if (fault === "bytes") state.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(previewId);
  if (fault === "hash") state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.approvalHash',?) WHERE content_id=?").run("0".repeat(64), previewId);
  if (fault === "owner") state.sqlite.prepare("UPDATE private_content SET owner_id='defensive-foreign-owner' WHERE content_id=?").run(previewId);
  if (fault === "kind") state.sqlite.prepare("UPDATE private_content SET kind='defensive-foreign-kind' WHERE content_id=?").run(previewId);
  if (fault === "private-expiry") state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(previewId);
  if (fault === "principal") state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-revoked' WHERE user_id=?").run(actor(state));
  if (fault === "custody") {
    if (state.projectAccessId) state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='defensive-foreign-actor' WHERE resource_kind='content' AND resource_id=?").run(previewId);
    else state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
      .run("defensive-access", previewId, "defensive-org", state.projectId, state.ownerId, actor(state), new Date().toISOString());
  }
}
for (const mode of ["personal", "selected"]) for (const fault of ["erased", "missing", "redacted", "bytes", "hash", "owner", "kind", "private-expiry", "custody", "principal"])
test("Canvas guarded discard final write fence " + mode + "/" + fault, async t => {
  const state = await fixture(mode); let gate;
  try {
    const input = await intent(state), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    assert.equal((await state.request("/api/session", { headers: state.headers })).status, 200);
    let count, row;
    gate = atGuardedBatch(state, () => { mutate(state, saved.previewId, fault); count = changes(state); row = retained(state, saved.previewId); });
    const canonical = canonicalState(state), financial = financialState(state), response = await dismiss(state, input, saved), body = await response.json();
    assert.equal(gate.hits(), 1); assert.ok(response.status >= 400, JSON.stringify(body));
    assert.equal(body.status, undefined); assert.equal(changes(state), count);
    assert.deepEqual(retained(state, saved.previewId), row); assert.deepEqual(canonicalState(state), canonical);
    assert.deepEqual(financialState(state), financial);
  } finally { gate?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas active lease stays pending and plan expiry fences writer " + mode, async t => {
  const state = await fixture(mode); let gate, pending;
  try {
    const input = await intent(state), saved = await preview(state, input);
    const clock = clocks(t, state, Date.parse(saved.expiresAt) - 60_000);
    gate = pauseClaim(state); pending = apply(state, input, saved); await gate.entered;
    clock.set(Date.parse(saved.expiresAt) + 1);
    const before = changes(state), raw = retained(state, saved.previewId), canonical = canonicalState(state);
    const checked = await retrieve(state, input); assert.equal(checked.status, 202);
    exactTerminal(await checked.json(), "applying", input, saved); assert.equal(changes(state), before);
    const asked = await dismiss(state, input, saved); assert.equal(asked.status, 202);
    exactTerminal(await asked.json(), "applying", input, saved);
    assert.equal(changes(state), before); assert.deepEqual(retained(state, saved.previewId), raw); assert.deepEqual(canonicalState(state), canonical);
    gate.release(); const completed = await pending; pending = null;
    assert.equal(completed.status, 409); assert.equal((await completed.json()).error, "canvas_arrangement_preview_expired");
    assert.deepEqual(canonicalState(state), canonical, "the unchanged final DB plan-expiry guard refuses the late writer");
    const checkedAgain = await retrieve(state, input); assert.equal(checkedAgain.status, 409);
    exactDescriptor(await checkedAgain.json(), state, input, saved);
    const done = await dismiss(state, input, saved); assert.equal(done.status, 200);
    exactTerminal(await done.json(), "dismissed", input, saved);
    assert.deepEqual(canonicalState(state), canonical); assertFree(state);
  } finally { gate?.release(); if (pending) await pending; gate?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas expired lease explicit resolution fences old writer " + mode, async t => {
  const state = await fixture(mode); let gate, pending;
  try {
    const input = await intent(state), saved = await preview(state, input);
    const clock = clocks(t, state, Date.parse(saved.expiresAt) - 60_000);
    gate = pauseClaim(state); pending = apply(state, input, saved); await gate.entered;
    clock.set(Date.parse(saved.expiresAt) + 60_001);
    const before = changes(state), raw = retained(state, saved.previewId), canonical = canonicalState(state);
    const checked = await retrieve(state, input); assert.equal(checked.status, 409); exactDescriptor(await checked.json(), state, input, saved);
    assert.equal(changes(state), before); assert.deepEqual(retained(state, saved.previewId), raw);
    const asked = await dismiss(state, input, saved); assert.equal(asked.status, 200);
    exactTerminal(await asked.json(), "dismissed", input, saved);
    assert.equal(changes(state) - before, 2, "existing expired lease release and exact discard, no canonical write");
    gate.release(); const late = await pending; pending = null;
    assert.equal((await late.json()).status, undefined); assert.deepEqual(canonicalState(state), canonical);
    const check = await retrieve(state, input); exactTerminal(await check.json(), "dismissed", input, saved); assertFree(state);
  } finally { gate?.release(); if (pending) await pending; gate?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const winnerKind of ["live", "committed"])
test("Canvas guarded expired release preserves newer winner " + mode + "/" + winnerKind, async t => {
  const state = await fixture(mode); let oldGate, releaseGate, winnerGate, old, contender, winner;
  try {
    const input = await intent(state), saved = await preview(state, input), started = Date.now();
    const clock = clocks(t, state, started);
    oldGate = pauseClaim(state); old = apply(state, input, saved); await oldGate.entered;
    clock.set(started + 120_001);
    releaseGate = pauseSql(state, releaseSql, { method: "run" });
    contender = dismiss(state, input, saved); await releaseGate.entered;
    if (winnerKind === "live") winnerGate = pauseClaim(state);
    winner = apply(state, input, saved);
    if (winnerGate) await winnerGate.entered;
    else { const response = await winner; winner = null; assert.equal(response.status, 200); assert.equal((await response.json()).status, "applied"); }
    const raw = retained(state, saved.previewId), before = changes(state), canonical = canonicalState(state);
    releaseGate.release(); const response = await contender; contender = null;
    assert.equal(response.status, winnerKind === "live" ? 202 : 200);
    assert.equal((await response.json()).status, winnerKind === "live" ? "applying" : "applied");
    assert.equal(changes(state), before); assert.deepEqual(retained(state, saved.previewId), raw); assert.deepEqual(canonicalState(state), canonical);
    oldGate.release(); await old; old = null; assert.deepEqual(canonicalState(state), canonical);
    if (winner) { winnerGate.release(); assert.equal((await winner).status, 200); winner = null; }
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 1); assertFree(state);
  } finally {
    winnerGate?.release(); releaseGate?.release(); oldGate?.release();
    if (contender) await contender; if (winner) await winner; if (old) await old;
    winnerGate?.restore(); releaseGate?.restore(); oldGate?.restore(); state.sqlite.close();
  }
});

for (const mode of ["personal", "selected"]) for (const point of ["before", "batch"])
test("Canvas guarded discard returns actual winning receipt " + mode + "/" + point, async () => {
  const state = await fixture(mode); let gate, request;
  try {
    const input = await intent(state), saved = await preview(state, input);
    if (point === "batch") { gate = pauseGuardedBatch(state); request = dismiss(state, input, saved); await gate.entered; }
    const applied = await apply(state, input, saved); assert.equal(applied.status, 200);
    const receipt = await applied.json(), before = canonicalState(state), raw = retained(state, saved.previewId), count = changes(state);
    if (gate) gate.release(); else request = dismiss(state, input, saved);
    const resolved = await request; request = null; assert.equal(resolved.status, 200);
    assert.deepEqual(await resolved.json(), receipt); assert.deepEqual(canonicalState(state), before);
    assert.deepEqual(retained(state, saved.previewId), raw); assert.equal(changes(state), count);
    mutate(state, saved.previewId, "erased");
    const read = await retrieve(state, input); assert.equal(read.status, 200); assert.deepEqual(await read.json(), receipt);
    const done = await dismiss(state, input, saved, { onlyIfUnapplied: undefined });
    assert.equal(done.status, 200); assert.equal((await done.json()).dismissed, true, "default known-applied Done stays intact");
    assertFree(state);
  } finally { gate?.release(); if (request) await request; gate?.restore(); state.sqlite.close(); }
});

test("Canvas disposition flags and exact targets reject without mutation", async () => {
  const state = await fixture();
  try {
    const input = await intent(state), saved = await preview(state, input), before = changes(state), canonical = canonicalState(state);
    for (const flag of ["includeDisposition", "onlyIfUnapplied"]) for (const value of [false, null, 1, "true", {}, []]) {
      const response = await state.call({ action: flag === "includeDisposition" ? "retrieve" : "dismiss", ...identity(input),
        previewId: saved.previewId, approvalHash: saved.approvalHash, [flag]: value });
      assert.equal(response.status, 400); assert.equal((await response.json()).error, "canvas_arrangement_request_invalid");
    }
    for (const action of ["preview", "undo-preview", "apply", "dismiss"]) {
      const response = await state.call({ ...input, action, includeDisposition: true });
      assert.equal(response.status, 400);
    }
    for (const action of ["preview", "undo-preview", "apply", "retrieve"]) {
      const response = await state.call({ ...input, action, onlyIfUnapplied: true });
      assert.equal(response.status, 400);
    }
    for (const change of [{ operationId: crypto.randomUUID() }, { canvasId: "arrangement-other-board" },
      { projectId: "wrong-project" }, { previewId: crypto.randomUUID() }, { approvalHash: "0".repeat(64) }]) {
      const response = await dismiss(state, { ...input, ...change }, { ...saved, ...change });
      assert.ok(response.status >= 400); assert.equal((await response.json()).status, undefined);
    }
    assert.equal(changes(state), before); assert.deepEqual(canonicalState(state), canonical);
  } finally { state.sqlite.close(); }
});

test("Canvas disposition keeps current read-only historical rights without authoring", async t => {
  const state = await fixture("editor");
  try {
    const input = await intent(state), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    state.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE project_access_id=? AND user_id='arrangement-member'").run(state.projectAccessId);
    const before = changes(state), response = await retrieve(state, input);
    assert.equal(response.status, 409); exactDescriptor(await response.json(), state, input, saved); assert.equal(changes(state), before);
    const done = await dismiss(state, input, saved); assert.equal(done.status, 200); exactTerminal(await done.json(), "dismissed", input, saved);
    const newIntent = await intent(state); assert.equal((await state.call({ ...newIntent, action: "preview" })).status, 403);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0); assertFree(state);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas opted recovery never unlocks a foreign original target " + mode, async t => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    const before = changes(state), row = retained(state, saved.previewId);
    const response = await retrieve(state, { ...input, canvasId: "arrangement-other-board" }), body = await response.json();
    assert.ok(response.status >= 400); assert.equal(body.disposition, undefined); assert.equal(body.status, undefined);
    assert.equal(changes(state), before); assert.deepEqual(retained(state, saved.previewId), row);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas discarded original lost response recovers exact positive state " + mode, async t => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    const response = await dismiss(state, input, saved); assert.equal(response.status, 200);
    // Transport loss: deliberately do not deliver the actual successful body to a client.
    await response.arrayBuffer();
    const before = changes(state), checked = await retrieve(state, input);
    assert.equal(checked.status, 200); exactTerminal(await checked.json(), "dismissed", input, saved); assert.equal(changes(state), before);
    const missing = await retrieve(state, { ...input, operationId: crypto.randomUUID() });
    assert.ok(missing.status >= 400); assert.equal((await missing.json()).status, undefined);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0); assertFree(state);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas real retention cleanup never becomes an absence disposition " + mode, async () => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now() - 1000).toISOString(), saved.previewId);
    const separate = await intent(state, { name: "Separate human free review runs ordinary retention cleanup" });
    await preview(state, separate);
    const row = retained(state, saved.previewId); assert.equal(row.content, ""); assert.ok(row.redacted_at);
    const before = changes(state), canonical = canonicalState(state), read = await retrieve(state, input), body = await read.json();
    assert.equal(read.status, 409); assert.equal(body.status, undefined); assert.equal(body.disposition, undefined);
    assert.equal(changes(state), before); assert.deepEqual(retained(state, saved.previewId), row); assert.deepEqual(canonicalState(state), canonical);
    const oldApply = await apply(state, input, saved); assert.ok(oldApply.status >= 400);
    assert.equal(changes(state), before); assert.deepEqual(canonicalState(state), canonical); assertFree(state);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const point of ["during-read", "after-descriptor"])
test("Canvas database expiry fences near-clock Apply " + mode + "/" + point, async t => {
  const state = await fixture(mode); let gate, reading;
  try {
    const input = await intent(state), saved = await preview(state, input), expiry = Date.parse(saved.expiresAt);
    // A controlled 2ms difference between the actual JS and native SQL clocks.
    // The existing final DB-expiry guard must still fence Apply; no receipt is fabricated.
    clocks(t, state, expiry - 1, expiry + 1);
    if (point === "during-read") {
      gate = pauseSql(state, disclosureSql); reading = retrieve(state, input); await gate.entered;
    } else {
      const descriptor = await retrieve(state, input); assert.equal(descriptor.status, 409);
      exactDescriptor(await descriptor.json(), state, input, saved);
    }
    const canonical = canonicalState(state), applied = await apply(state, input, saved);
    assert.equal(applied.status, 403); assert.equal((await applied.json()).error, "canvas_arrangement_preview_unavailable");
    assert.deepEqual(canonicalState(state), canonical, "SQL expiry is authoritative despite JS being 2ms earlier");
    const count = changes(state);
    if (gate) {
      gate.release(); const response = await reading; reading = null;
      assert.equal(response.status, 403); assert.equal((await response.json()).disposition, undefined,
        "failed Apply's lease transition invalidates the older raw-wrapper proof");
    }
    const current = await retrieve(state, input); assert.equal(current.status, 409);
    exactDescriptor(await current.json(), state, input, saved); assert.equal(changes(state), count);
    const resolved = await dismiss(state, input, saved); assert.equal(resolved.status, 200);
    exactTerminal(await resolved.json(), "dismissed", input, saved);
    assert.deepEqual(canonicalState(state), canonical); assertFree(state);
  } finally { gate?.release(); if (reading) await reading; gate?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas canonical receipt in another target cannot unlock this request " + mode, async () => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    assert.equal((await apply(state, input, saved)).status, 200);
    mutate(state, saved.previewId, "erased");
    const before = changes(state), canonical = canonicalState(state), foreign = { ...input, canvasId: "arrangement-other-board" };
    for (const response of [await retrieve(state, foreign), await dismiss(state, foreign, saved)]) {
      assert.ok(response.status >= 400);
      const body = await response.json();
      assert.equal(body.status, undefined); assert.equal(body.disposition, undefined); assert.equal(body.arrangementId, undefined);
    }
    assert.equal(changes(state), before); assert.deepEqual(canonicalState(state), canonical);
    const actual = await retrieve(state, input); assert.equal(actual.status, 200); assert.equal((await actual.json()).status, "applied");
    assert.equal(changes(state), before); assertFree(state);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const action of ["retrieve", "dismiss"])
test("Canvas cold traffic retains ordinary private cleanup " + mode + "/" + action, async t => {
  const state = await fixture(mode); let boundary, trace;
  try {
    const input = await intent(state), saved = await preview(state, input);
    clocks(t, state, Date.parse(saved.expiresAt) + 1);
    trace = changedSql(state);
    let count;
    const expire = () => { mutate(state, saved.previewId, "private-expiry"); count = changes(state); };
    boundary = action === "retrieve" ? atSql(state, disclosureSql, expire) : atGuardedBatch(state, expire);
    const canonical = canonicalState(state), financial = financialState(state);
    const response = await (action === "retrieve" ? retrieve(state, input) : dismiss(state, input, saved));
    const body = await response.json();
    assert.equal(boundary.hits(), 1); assert.equal(response.status, 403);
    assert.equal(body.disposition, undefined); assert.equal(body.status, undefined); assert.equal(body.preview, undefined);
    assert.equal(changes(state) - count, 1); assert.equal(trace.trace.length, 1); assert.equal(trace.trace[0].delta, 1);
    assert.match(trace.trace[0].sql, /^UPDATE private_content SET content='',redacted_at=\?/u,
      "the sole mutation is the unchanged traffic-triggered retention sweep, not a read lease or dismissal");
    const row = retained(state, saved.previewId);
    assert.equal(row.content, ""); assert.ok(row.redacted_at); assert.equal(row.expires_at, "2000-01-01T00:00:00.000Z");
    assert.deepEqual(canonicalState(state), canonical); assert.deepEqual(financialState(state), financial); assertFree(state);
  } finally { boundary?.restore(); trace?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const fault of ["bytes", "erased", "private-expiry", "custody", "principal"])
test("Canvas guarded disposition rechecks after actual expired lease release " + mode + "/" + fault, async t => {
  const state = await fixture(mode); let claim, boundary, pending;
  try {
    const input = await intent(state), saved = await preview(state, input);
    const clock = clocks(t, state, Date.parse(saved.expiresAt) - 60_000);
    claim = pauseClaim(state); pending = apply(state, input, saved); await claim.entered;
    clock.set(Date.parse(saved.expiresAt) + 60_001);
    assert.equal((await state.request("/api/session", { headers: state.headers })).status, 200);
    const check = await retrieve(state, input); assert.equal(check.status, 409);
    exactDescriptor(await check.json(), state, input, saved);
    let count, row;
    boundary = atGuardedBatch(state, () => {
      const current = JSON.parse(retained(state, saved.previewId).content);
      assert.equal(current.state, "review"); assert.equal(current.leaseId, "", "the real explicit lease release already occurred");
      mutate(state, saved.previewId, fault); count = changes(state); row = retained(state, saved.previewId);
    });
    const canonical = canonicalState(state), financial = financialState(state), response = await dismiss(state, input, saved);
    assert.equal(boundary.hits(), 1); assert.equal(response.status, 403); assert.equal((await response.json()).status, undefined);
    assert.equal(changes(state), count, "the final transaction cannot discard through changed post-release evidence");
    assert.deepEqual(retained(state, saved.previewId), row); assert.deepEqual(canonicalState(state), canonical);
    claim.release(); const late = await pending; pending = null; assert.ok(late.status >= 400);
    assert.deepEqual(canonicalState(state), canonical); assert.deepEqual(financialState(state), financial); assertFree(state);
  } finally { claim?.release(); if (pending) await pending; boundary?.restore(); claim?.restore(); state.sqlite.close(); }
});
