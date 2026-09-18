import assert from "node:assert/strict";
import { test } from "node:test";
import * as cache from "../src/state/account-cache.ts";
import { AccountCacheIndexedDbFixture } from "./helpers/account-cache-indexeddb-fixture.mjs";

let identityCounter = 0;
const identity = (extra = {}) => ({
  userId: "cache-actor-" + ++identityCounter, principalUserId: "principal",
  accepted: true, impersonating: false, audience: "creative",
  policyVersion: "policy-current", permissionEpoch: "epoch-current", ...extra,
});
const key = (value) => [
  value.principalUserId ?? value.userId, value.userId, value.audience ?? "creative",
  value.organizationId ?? "personal", value.projectAccessId ?? "personal",
  value.permissionEpoch ?? "legacy", value.policyVersion,
].map(encodeURIComponent).join(":") + ":v3";
const events = (label = "CURRENT") => [
  { eventId: label + "-project", streamId: "test-owner", sequence: 1, type: "ProjectCreated",
    payload: { project_id: "project", name: label }, actorUserId: "test-owner",
    clientId: "test", correlationId: null, createdAt: "2026-08-28T00:00:00.000Z" },
  { eventId: label + "-private", streamId: "test-owner", sequence: 2, type: "BlockPropertyEdited",
    payload: { block_id: "private-block", key: "content", value: label + "-PRIVATE" },
    actorUserId: "test-owner", clientId: "test", correlationId: null, createdAt: "2026-08-28T00:00:00.000Z" },
];
const snapshot = (scope, label = "CACHED", profile = "full", savedAt = Date.now()) => ({
  key: key(scope), userId: scope.userId, principalUserId: scope.principalUserId ?? scope.userId,
  audience: scope.audience ?? "creative", organizationId: scope.organizationId ?? "personal",
  projectAccessId: scope.projectAccessId ?? "personal", permissionEpoch: scope.permissionEpoch ?? "legacy",
  policyVersion: scope.policyVersion, profile, head: 2, events: profile === "projects" ? events(label).slice(0, 1) : events(label),
  savedAt, schemaVersion: 3,
});
const guard = (scope, profile = "full", current = () => true, client = cache) => ({
  fence: client.captureAccountSnapshotFence(scope, profile), current,
});
const exactClear = (scope, controls, client = cache) => client.clearAccountSnapshots(scope, { scope: "source", fence: controls.fence });
const useFixture = (t, options) => {
  const fixture = new AccountCacheIndexedDbFixture(options);
  const restore = fixture.install();
  t.after(async () => { try { await fixture.quiet(); fixture.assertConsistent(); } finally { restore(); } });
  return fixture;
};
const read = async (scope, profile = "full", controls = guard(scope, profile), client = cache) => {
  const rows = await client.readAccountSnapshots(scope, controls);
  return client.matchingAccountSnapshot(rows, scope, profile, controls);
};

test("account cache retirement: native smoke preserves exact snapshot shape and verified recovery", async (t) => {
  const f = useFixture(t);
  const scope = identity();
  const original = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events(), 2, "full", original), true);
  assert.deepEqual(f.row(key(scope)), snapshot(scope, "CURRENT", "full", f.row(key(scope)).savedAt));
  const cached = await read(scope);
  assert.equal(cached.events[1].payload.value, "CURRENT-PRIVATE");
  const clear = exactClear(scope, original);
  assert.equal(cache.accountSnapshotFenceCurrent(scope, original.fence), false, "retirement is synchronous");
  assert.deepEqual(await cache.readAccountSnapshots(scope), []);
  assert.deepEqual(await clear, { status: "cleared" });
  assert.equal(f.row(key(scope)), undefined);
  const recovery = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events("RECOVERED"), 3, "full", recovery), true);
  assert.equal((await read(scope, "full", recovery)).head, 3);
});

test("account cache retirement: exact encoded source deletion preserves other scopes, broad privacy remains principal-wide", async (t) => {
  const scope = identity({ userId: "actor:α/✅", principalUserId: "principal:α", organizationId: "org:α", projectAccessId: "access/1" });
  const variants = [
    { ...scope, projectAccessId: "access/2" }, { ...scope, organizationId: "org:other" },
    { ...scope, audience: "reader" }, { ...scope, permissionEpoch: "epoch:new" },
    { ...scope, policyVersion: "policy:new" }, { ...scope, organizationId: null, projectAccessId: null },
    { ...scope, principalUserId: "different-principal" }, { ...scope, userId: "different-actor" },
  ];
  const rows = [scope, ...variants].map((value, index) => snapshot(value, "SCOPE-" + index));
  const f = useFixture(t, { rows });
  const original = guard(scope);
  assert.deepEqual(await exactClear(scope, original), { status: "cleared" });
  assert.equal(f.row(key(scope)), undefined);
  for (const other of variants) assert.deepEqual(f.row(key(other)), rows.find((row) => row.key === key(other)));
  assert.equal((await read(variants[0])).events[0].payload.name, "SCOPE-1");
  const broadResult = await cache.clearAccountSnapshots(scope);
  assert.equal(broadResult, undefined, "default explicit privacy API remains Promise<void>");
  assert.deepEqual(f.committed().map((row) => row.key).sort(), variants.slice(-2).map(key).sort());
});

for (const boundary of ["open:begin", "request:event:get", "transaction:complete"]) {
  test("account cache retirement: a read retired at " + boundary + " never returns cache rows", async (t) => {
    const scope = identity();
    const f = useFixture(t, { rows: [snapshot(scope)] });
    const original = guard(scope);
    const gate = f.gate(boundary);
    const pending = cache.readAccountSnapshots(scope, original);
    await gate.wait;
    const clearing = exactClear(scope, original);
    assert.equal(cache.accountSnapshotFenceCurrent(scope, original.fence), false);
    assert.equal(cache.matchingAccountSnapshot([snapshot(scope)], scope, "full", guard(scope)), null);
    assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
    gate.release();
    assert.deepEqual(await pending, []);
    assert.deepEqual(await clearing, { status: "cleared" });
    assert.equal(f.row(key(scope)), undefined);
  });
}

test("account cache retirement: returned/downscoped rows cannot regain ownership after denial or a newer write", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "ORIGINAL")] });
  const original = guard(scope);
  const rows = await cache.readAccountSnapshots(scope, original);
  const downscoped = cache.matchingAccountSnapshot(rows, scope, "projects", original);
  assert.ok(downscoped);
  assert.deepEqual(await exactClear(scope, original), { status: "cleared" });
  const recovery = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NEW"), 9, "full", recovery), true);
  assert.equal(cache.matchingAccountSnapshot(rows, scope, "full", recovery), null, "new token cannot rebind an old returned object");
  assert.equal(cache.matchingAccountSnapshot([downscoped], scope, "projects", recovery), null);
  assert.equal(cache.matchingAccountSnapshot([structuredClone(rows[0])], scope, "full", recovery), null, "untracked private rows cannot restore a retired key");
  assert.equal((await read(scope, "full", recovery)).head, 9);
  assert.equal(cache.matchingAccountSnapshot([f.row(key(scope))], scope, "full"), null, "guardless matching stays blocked after known retirement");
  assert.deepEqual(await cache.readAccountSnapshots(scope), []);
  assert.equal(await cache.writeAccountSnapshot(scope, events("LEGACY"), 10, "full"), false);

  const before = await cache.readAccountSnapshots(scope, recovery);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NEWER"), 11, "full", recovery), true);
  assert.equal(cache.matchingAccountSnapshot(before, scope, "full", recovery), null, "even reuse of the logical read token cannot revive its older cache revision");
});

test("account cache retirement: unscoped legacy reads do not disclose a retired key while preserving unrelated rows", async (t) => {
  const denied = identity(), other = identity();
  const f = useFixture(t, { rows: [snapshot(denied), snapshot(other, "UNRELATED")] });
  const gate = f.gate("request:event:getAll");
  const pending = cache.readAccountSnapshots();
  await gate.wait;
  const clearing = exactClear(denied, guard(denied));
  gate.release();
  const rows = await pending;
  assert.deepEqual(rows.map((row) => row.key), [key(other)]);
  assert.equal(cache.matchingAccountSnapshot(rows, denied, "full"), null);
  assert.equal(cache.matchingAccountSnapshot(rows, other, "full").events[0].payload.name, "UNRELATED");
  assert.deepEqual(await clearing, { status: "cleared" });
});

test("account cache retirement: delayed old logical callbacks cannot recreate a denied cache after cleanup failure or recovery", async (t) => {
  const scope = identity(), unrelated = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "OLD"), snapshot(unrelated, "OTHER")] });
  const original = guard(scope);
  f.failNext("request:delete", "UnknownError");
  assert.deepEqual(await exactClear(scope, original), { status: "unavailable" });
  assert.equal(f.row(key(scope)).events[0].payload.name, "OLD", "failed physical deletion is not reported as success");
  assert.equal(await cache.writeAccountSnapshot(scope, events("LATE"), 5, "full", original), false);
  assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
  assert.equal((await read(unrelated)).events[0].payload.name, "OTHER");
  const recovery = guard(scope);
  assert.equal(cache.accountSnapshotFenceCurrent(scope, recovery.fence), true, "new source-read ownership is independent of cache availability");
  assert.equal(await cache.writeAccountSnapshot(scope, events("VERIFIED"), 6, "full", recovery), true);
  assert.equal(await cache.writeAccountSnapshot(scope, events("VERY-LATE"), 4, "full", original), false);
  assert.equal((await read(scope, "full", recovery)).events[0].payload.name, "VERIFIED");
});

for (const boundary of ["open:begin", "request:event:get", "request:event:put", "request:event:getAll", "request:event:delete"]) {
  test("account cache retirement: write/cleanup ownership lost at " + boundary + " aborts without eviction", async (t) => {
    const scope = identity();
    const rows = [snapshot(scope, "PREVIOUS", "full", Date.now() - 1_000),
      ...Array.from({ length: 6 }, (_, index) => snapshot(identity(), "OTHER-" + index, "full", Date.now() - 10_000 - index))];
    const f = useFixture(t, { rows });
    let current = true;
    const controls = guard(scope, "full", () => current);
    const gate = f.gate(boundary);
    const pending = cache.writeAccountSnapshot(scope, events("MUST-NOT-COMMIT"), 10, "full", controls);
    await gate.wait;
    current = false;
    gate.release();
    assert.equal(await pending, false);
    assert.deepEqual(f.committed(), rows, "native abort rolls back both put and all staged cleanup deletes");
    assert.equal(f.trace.filter((entry) => entry.phase === "transaction:committed" && entry.mode === "readwrite").length, 0);
  });
}

test("account cache retirement: denial aborts pending same-key write, deletes old bytes, then allows later verified write", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "OLD")] });
  const original = guard(scope);
  const gate = f.gate("request:event:put");
  const oldWrite = cache.writeAccountSnapshot(scope, events("OLD-LATE"), 4, "full", original);
  await gate.wait;
  const clearing = exactClear(scope, original);
  const newRead = guard(scope);
  const newWrite = cache.writeAccountSnapshot(scope, events("CURRENT"), 5, "full", newRead);
  await f.quiet();
  const opensWhileOldWritePending = f.opens.length;
  const fallbackWhilePending = await cache.readAccountSnapshots(scope, newRead);
  gate.release();
  assert.equal(await oldWrite, false);
  assert.deepEqual(await clearing, { status: "cleared" });
  assert.equal(await newWrite, true);
  assert.equal(opensWhileOldWritePending, 1, "same-key clear and write reserve invocation order before opening DB");
  assert.deepEqual(fallbackWhilePending, [], "pending verified cache write cannot reopen fallback");
  assert.equal((await read(scope, "full", newRead)).events[0].payload.name, "CURRENT");
  const phases = f.trace.filter((entry) => ["request:delete", "request:put"].includes(entry.phase));
  assert.ok(phases.findLastIndex((entry) => entry.phase === "request:delete") < phases.findLastIndex((entry) => entry.phase === "request:put"));
});

test("account cache retirement: stale older denial cannot erase a later fully certified same-coverage source", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "OLD")] });
  const older = guard(scope);
  const newer = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NEW"), 9, "full", newer), true);
  const opensBefore = f.opens.length;
  assert.deepEqual(await exactClear(scope, older), { status: "superseded" });
  assert.equal(f.opens.length, opensBefore, "obsolete denial performs no DB operation");
  assert.equal(cache.accountSnapshotFenceCurrent(scope, newer.fence), true);
  assert.equal((await read(scope, "full", newer)).head, 9);
});

test("account cache retirement: pending newer read never immunizes a denied earlier source", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const older = guard(scope), merelyPending = guard(scope);
  assert.deepEqual(await exactClear(scope, older), { status: "cleared" });
  assert.equal(cache.accountSnapshotFenceCurrent(scope, merelyPending.fence), false);
  assert.equal(await cache.writeAccountSnapshot(scope, events("PENDING-REPLY"), 7, "full", merelyPending), false);
  assert.equal(f.row(key(scope)), undefined);
});

test("account cache retirement: narrow verified coverage does not suppress a richer denial", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "RICH-OLD")] });
  const full = guard(scope, "full"), narrow = guard(scope, "projects");
  assert.equal(await cache.writeAccountSnapshot(scope, events("NARROW"), 3, "projects", narrow), false, "ordinary valid richer-cache preservation remains unchanged");
  assert.deepEqual(await exactClear(scope, full), { status: "cleared" });
  assert.equal(cache.accountSnapshotFenceCurrent(scope, narrow.fence), false);
  assert.equal(f.row(key(scope)), undefined);
});

test("account cache retirement: later rich complete coverage can supersede an older narrow denial", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  const narrow = guard(scope, "projects"), full = guard(scope, "full");
  assert.equal(await cache.writeAccountSnapshot(scope, events("FULL"), 3, "full", full), true);
  assert.deepEqual(await exactClear(scope, narrow), { status: "superseded" });
  assert.equal(f.row(key(scope)).profile, "full");
});

test("account cache retirement: failed delete plus narrower recovery replaces rather than unblocks denied richer bytes", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "FORBIDDEN-RICH")] });
  const original = guard(scope);
  f.failNext("request:delete", "QuotaExceededError");
  assert.deepEqual(await exactClear(scope, original), { status: "unavailable" });
  const recovery = guard(scope, "projects");
  const putGate = f.gate("transaction:complete");
  const pending = cache.writeAccountSnapshot(scope, events("NARROW-CURRENT"), 8, "projects", recovery);
  await putGate.wait;
  assert.equal(f.row(key(scope)).profile, "projects", "actual replacement is physically committed before complete notification");
  assert.deepEqual(await cache.readAccountSnapshots(scope, recovery), [], "guarded put must complete before restoring fallback");
  putGate.release();
  assert.equal(await pending, true);
  assert.equal((await read(scope, "projects", recovery)).events.length, 1);
  assert.equal(await read(scope, "full", guard(scope, "full")), null);
  assert.equal(JSON.stringify(f.row(key(scope))).includes("FORBIDDEN"), false);
});

for (const failure of ["request:get", "request:put", "request:getAll", "request:delete", "transaction:commit"]) {
  test("account cache retirement: " + failure + " failure preserves retirement and rolls back the entire write", async (t) => {
    const scope = identity();
    const f = useFixture(t, { rows: [snapshot(scope, "DENIED"),
      ...Array.from({ length: 6 }, (_, index) => snapshot(identity(), "KEEP-" + index, "full", Date.now() - 10_000 - index))] });
    const original = guard(scope);
    f.failNext("request:delete", "UnknownError");
    assert.deepEqual(await exactClear(scope, original), { status: "unavailable" });
    const before = f.committed();
    const recovery = guard(scope);
    f.failNext(failure, failure === "request:put" ? "QuotaExceededError" : "UnknownError");
    assert.equal(await cache.writeAccountSnapshot(scope, events("UNCOMMITTED"), 10, "full", recovery), false);
    assert.deepEqual(f.committed(), before);
    assert.deepEqual(await cache.readAccountSnapshots(scope, recovery), []);
    assert.equal(cache.matchingAccountSnapshot([snapshot(scope)], scope, "full", recovery), null);
  });
}

test("account cache retirement: transaction completion, not request success, is the read/delete/write settlement boundary", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const original = guard(scope);
  for (const kind of ["read", "clear", "write"]) {
    const controls = kind === "read" ? original : guard(scope);
    const gate = f.gate("transaction:complete");
    let settled = false;
    const pending = (kind === "read" ? cache.readAccountSnapshots(scope, controls) :
      kind === "clear" ? exactClear(scope, controls) :
      cache.writeAccountSnapshot(scope, events("RECOVERED"), 5, "full", controls)).then((value) => { settled = true; return value; });
    await gate.wait;
    await f.quiet();
    assert.equal(settled, false, kind + " does not resolve at request success or physical commit");
    gate.release();
    const value = await pending;
    if (kind === "read") assert.equal(value.length, 1);
    else if (kind === "clear") assert.deepEqual(value, { status: "cleared" });
    else assert.equal(value, true);
  }
});

test("account cache retirement: loss after native commit is truthfully quarantined, not called rollback", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  let current = true;
  const original = guard(scope, "full", () => current);
  const gate = f.gate("transaction:complete");
  const pending = cache.writeAccountSnapshot(scope, events("COMMITTED-BUT-NOW-UNOWNED"), 12, "full", original);
  await gate.wait;
  assert.equal(f.row(key(scope)).head, 12);
  current = false;
  gate.release();
  assert.equal(await pending, false);
  assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
  assert.equal(f.trace.some((entry) => entry.phase === "transaction:rolled-back"), false);
  const recovery = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events("FRESH"), 13, "full", recovery), true);
  assert.equal((await read(scope, "full", recovery)).head, 13);
});

test("account cache retirement: same-page module clients share opaque fences and exact-key retirement", async (t) => {
  const second = await import("../src/state/account-cache.ts?cache-test-client=second");
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const original = guard(scope);
  assert.equal(second.accountSnapshotFenceCurrent(scope, original.fence), true);
  assert.equal(Object.keys(original.fence).length, 0, "opaque fence contains no serializable source or authority");
  assert.deepEqual(await exactClear(scope, original, second), { status: "cleared" });
  assert.equal(cache.accountSnapshotFenceCurrent(scope, original.fence), false);
  assert.equal(await cache.writeAccountSnapshot(scope, events("OLD-CLIENT"), 3, "full", original), false);
  const recovery = guard(scope, "full", () => true, second);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NEW-CLIENT"), 4, "full", recovery), true);
  assert.equal((await read(scope, "full", recovery, second)).head, 4);
  assert.equal(JSON.stringify(f.row(key(scope))).includes("fence"), false);
  assert.equal(f.version, 3);
});

test("account cache retirement: a retired key has no additional software lock over another key", async (t) => {
  const denied = identity(), other = { ...denied, projectAccessId: "other" };
  const f = useFixture(t, { rows: [snapshot(denied), snapshot(other, "OTHER")] });
  const original = guard(denied);
  const gate = f.gate("request:get", (entry) => entry.key === key(denied));
  const oldRead = cache.readAccountSnapshots(denied, original);
  await gate.wait;
  const clearing = exactClear(denied, original);
  const otherRead = await read(other);
  assert.equal(otherRead.events[0].payload.name, "OTHER", "another readonly transaction can finish while the first key is pending");
  assert.equal(gate.released, false);
  assert.equal(f.opens.length, 2);
  gate.release();
  assert.deepEqual(await oldRead, []);
  assert.deepEqual(await clearing, { status: "cleared" });
});

test("account cache retirement: broad privacy fences pending writers and previously unseen keys without blocking other principals", async (t) => {
  const scope = identity(), another = { ...scope, projectAccessId: "not-yet-seen" }, independent = identity({ principalUserId: "other-principal" });
  const f = useFixture(t, { rows: [snapshot(scope, "OLD"), snapshot(another, "OTHER-SOURCE"), snapshot(independent, "INDEPENDENT")] });
  const old = guard(scope);
  const gate = f.gate("request:get", (entry) => entry.key === key(scope));
  const pending = cache.readAccountSnapshots(scope, old);
  await gate.wait;
  const privacy = cache.clearAccountSnapshots(scope);
  const unseenRecovery = guard(another);
  assert.equal(cache.accountSnapshotFenceCurrent(scope, old.fence), false);
  assert.deepEqual(await cache.readAccountSnapshots(another), []);
  assert.equal((await read(independent)).events[0].payload.name, "INDEPENDENT");
  const recovering = cache.writeAccountSnapshot(another, events("VERIFIED-AFTER-PRIVACY"), 7, "full", unseenRecovery);
  await f.quiet();
  assert.equal(f.opens.length, 2, "new source write waits for explicit broad privacy, not its own late DB open");
  gate.release();
  assert.deepEqual(await pending, []);
  assert.equal(await privacy, undefined);
  assert.equal(await recovering, true);
  assert.equal(f.row(key(scope)), undefined);
  assert.equal(f.row(key(another)).head, 7);
  assert.equal(f.row(key(independent)).events[0].payload.name, "INDEPENDENT");
});

test("account cache retirement: a superseded pending exact clear cannot delete a new generation", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const first = guard(scope);
  const gate = f.gate("open:begin");
  const oldClear = exactClear(scope, first);
  await gate.wait;
  const next = guard(scope);
  const currentClear = exactClear(scope, next);
  const recovery = guard(scope);
  const writer = cache.writeAccountSnapshot(scope, events("LATEST"), 14, "full", recovery);
  gate.release();
  assert.deepEqual(await oldClear, { status: "superseded" });
  assert.deepEqual(await currentClear, { status: "cleared" });
  assert.equal(await writer, true);
  assert.equal(f.row(key(scope)).head, 14);
});

test("account cache retirement: invalid fence or invalid exact options cannot fall through to a broad clear", async (t) => {
  const scope = identity(), other = identity();
  const f = useFixture(t, { rows: [snapshot(scope), snapshot(other)] });
  const before = f.committed();
  assert.deepEqual(await cache.clearAccountSnapshots(scope, { scope: "source", fence: {} }), { status: "superseded" });
  assert.deepEqual(await cache.clearAccountSnapshots(scope, { scope: "source", fence: guard(other).fence }), { status: "superseded" });
  assert.deepEqual(await cache.clearAccountSnapshots(scope, { scope: "wrong" }), { status: "superseded" });
  assert.deepEqual(await cache.clearAccountSnapshots(scope, null), { status: "superseded" });
  assert.equal(f.opens.length, 0);
  assert.deepEqual(f.committed(), before);
});

for (const boundary of ["open:begin", "request:event:get", "request:event:put", "request:event:getAll", "request:event:delete"]) {
  test("account cache retirement: fresh expiry at " + boundary + " aborts the write and cleanup", async (t) => {
    const started = Date.now();
    t.mock.method(Date, "now", () => started);
    const scope = identity({ accessExpiresAt: new Date(started + 500).toISOString() });
    const rows = [snapshot(scope, "UNCHANGED"),
      ...Array.from({ length: 6 }, (_, index) => snapshot(identity(), "UNCHANGED-" + index, "full", started - 10_000 - index))];
    const f = useFixture(t, { rows });
    const controls = guard(scope);
    const gate = f.gate(boundary);
    const pending = cache.writeAccountSnapshot(scope, events("EXPIRED"), 8, "full", controls);
    await gate.wait;
    Date.now.mock.mockImplementation(() => started + 501);
    gate.release();
    assert.equal(await pending, false);
    assert.deepEqual(f.committed(), rows);
    assert.deepEqual(await cache.readAccountSnapshots(scope, controls), []);
  });
}

test("account cache retirement: expiry and TTL are rechecked when previously read rows are matched", async (t) => {
  const started = Date.now();
  t.mock.method(Date, "now", () => started);
  const scope = identity({ accessExpiresAt: new Date(started + 500).toISOString() });
  const f = useFixture(t, { rows: [snapshot(scope, "VALID")] });
  const controls = guard(scope);
  const rows = await cache.readAccountSnapshots(scope, controls);
  assert.ok(cache.matchingAccountSnapshot(rows, scope, "full", controls));
  Date.now.mock.mockImplementation(() => started + 501);
  assert.equal(cache.matchingAccountSnapshot(rows, scope, "full", controls), null);
  Date.now.mock.mockImplementation(() => started + 16 * 60_000);
  assert.equal(cache.matchingAccountSnapshot(rows, { ...scope, accessExpiresAt: null }, "full", controls), null);
  assert.equal(f.row(key(scope)).events[0].payload.name, "VALID", "matching does not pretend to delete storage");
});

test("account cache retirement: denied/invalid identity, missing coverage, throwing guards, and non-cloneable bytes fail closed", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  for (const invalid of [{ accepted: false }, { impersonating: true }, { accessExpiresAt: "not-a-time" }, { accessExpiresAt: new Date(Date.now() - 1).toISOString() }]) {
    const current = { ...scope, ...invalid };
    assert.equal(await cache.writeAccountSnapshot(current, events(), 2, "full", guard(current)), false);
    assert.deepEqual(await cache.readAccountSnapshots(current, guard(current)), []);
  }
  const narrow = guard(scope, "projects");
  assert.equal(await cache.writeAccountSnapshot(scope, events(), 2, "full", narrow), false);
  assert.equal(await cache.writeAccountSnapshot(scope, events(), 2, "full", guard(scope, "full", () => { throw new Error("source withdrawn"); })), false);
  const uncloneable = events(); uncloneable[0].payload.uncloneable = () => true;
  assert.equal(await cache.writeAccountSnapshot(scope, uncloneable, 2, "full", guard(scope)), false);
  assert.equal(f.opens.length, 0);
});

test("account cache retirement: request input is cloned at invocation, not from a mutated late array", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  const original = events("ORIGINAL");
  const gate = f.gate("open:begin");
  const pending = cache.writeAccountSnapshot(scope, original, 2, "full", guard(scope));
  await gate.wait;
  original[1].payload.value = "MUTATED-LATE";
  original.push(events("ADDED-LATE")[0]);
  gate.release();
  assert.equal(await pending, true);
  assert.equal(f.row(key(scope)).events.length, 2);
  assert.equal(f.row(key(scope)).events[1].payload.value, "ORIGINAL-PRIVATE");
});

test("account cache retirement: valid profile filtering and MAX_RECORDS remain the existing cache policy", async (t) => {
  const f = useFixture(t);
  const scopes = Array.from({ length: 7 }, () => identity());
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (let index = 0; index < scopes.length; index += 1) {
    now += 1;
    assert.equal(await cache.writeAccountSnapshot(scopes[index], events("KEY-" + index), 2, "projects", guard(scopes[index], "projects")), true);
  }
  assert.equal(f.committed().length, 6);
  assert.equal(f.row(key(scopes[0])), undefined);
  for (const row of f.committed()) {
    assert.equal(row.schemaVersion, 3);
    assert.equal(row.profile, "projects");
    assert.equal(row.events.length, 1);
    assert.deepEqual(Object.keys(row).sort(), Object.keys(snapshot(scopes[0])).sort());
  }
});

test("account cache retirement: an old writer cannot overwrite a newer complete write even without a denial", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  const older = guard(scope), newer = guard(scope);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NEW"), 10, "full", newer), true);
  assert.equal(await cache.writeAccountSnapshot(scope, events("OLD"), 3, "full", older), false);
  assert.equal(f.row(key(scope)).head, 10);
});

test("account cache retirement: missing IndexedDB remains optional, but failed cleanup keeps fallback retired", async (t) => {
  const scope = identity();
  const original = guard(scope);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; });
  assert.deepEqual(await exactClear(scope, original), { status: "unavailable" });
  assert.equal(cache.matchingAccountSnapshot([snapshot(scope)], scope, "full", guard(scope)), null);
  assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
  assert.equal(await cache.writeAccountSnapshot(scope, events(), 2, "full", guard(scope)), false);
});

test("account cache retirement: a blocked upgrade settles unavailable, closes late handles, and does not perform denied cleanup", async (t) => {
  const scope = identity();
  const row = snapshot(scope, "PERSISTED");
  const f = useFixture(t, { version: 2, rows: [row] });
  const blocker = f.holdConnection();
  const clearing = exactClear(scope, guard(scope));
  let settled = 0; clearing.then(() => { settled += 1; });
  assert.deepEqual(await clearing, { status: "unavailable" });
  assert.equal(settled, 1);
  assert.deepEqual(f.row(key(scope)), row);
  assert.equal(f.version, 2);
  assert.equal(f.opens[0].onblocked, null, "settled failure no longer listens for repeated blocked events");
  blocker.close();
  await f.until(() => f.opens[0].done && f.opens[0].onerror === null, "late upgrade abort and request cleanup");
  assert.equal(f.version, 2, "an abandoned versionchange must not clear or upgrade the existing cache");
  assert.deepEqual(f.row(key(scope)), row);
  assert.equal(settled, 1);
  assert.ok(f.opens.every((request) => ["onsuccess", "onerror", "onblocked", "onupgradeneeded"].every((name) => request[name] === null)));
  assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
});

test("account cache retirement: one-second open deadline settles once and closes a late success without any transaction", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope, "OLD")] });
  const gate = f.gate("open:begin");
  const clearing = exactClear(scope, guard(scope));
  let settlements = 0; clearing.then(() => { settlements += 1; });
  await gate.wait;
  t.mock.timers.tick(1_000);
  assert.deepEqual(await clearing, { status: "unavailable" });
  assert.equal(settlements, 1);
  assert.equal(f.transactions.length, 0);
  gate.release();
  await f.until(() => f.opens[0].done && f.opens[0].onsuccess === null, "late open success cleanup");
  assert.equal(settlements, 1);
  assert.equal(f.activeHandles(), 0);
  assert.equal(f.transactions.length, 0);
  assert.equal(f.row(key(scope)).events[0].payload.name, "OLD");
  assert.ok(f.opens.every((request) => ["onsuccess", "onerror", "onblocked", "onupgradeneeded"].every((name) => request[name] === null)));
  t.mock.timers.tick(5_000);
  await f.quiet();
  assert.equal(settlements, 1);
});

test("account cache retirement: a normally delayed open within the bound remains usable and cleans its timer/listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = identity();
  const f = useFixture(t);
  const gate = f.gate("open:begin");
  const writing = cache.writeAccountSnapshot(scope, events("DELAYED-VALID"), 6, "full", guard(scope));
  let settlements = 0; writing.then(() => { settlements += 1; });
  await gate.wait;
  t.mock.timers.tick(999);
  assert.equal(settlements, 0);
  gate.release();
  assert.equal(await writing, true);
  t.mock.timers.tick(10_000);
  await f.quiet();
  assert.equal(settlements, 1);
  assert.equal(f.row(key(scope)).head, 6);
  assert.ok(f.opens.every((request) => ["onsuccess", "onerror", "onblocked", "onupgradeneeded"].every((name) => request[name] === null)));
});

test("account cache retirement: blocked-open FIFO is native, but every optional queued caller has its own bounded wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const denied = identity(), other = identity();
  const f = useFixture(t, { version: 2, rows: [snapshot(denied), snapshot(other, "OTHER")] });
  const blocker = f.holdConnection();
  assert.deepEqual(await exactClear(denied, guard(denied)), { status: "unavailable" });
  const unrelated = cache.readAccountSnapshots(other, guard(other));
  await f.until(() => f.opens.length === 2, "independent key invokes its own optional open");
  assert.equal(f.trace.some((entry) => entry.phase === "open:begin" && entry.open === 2), false, "native connection FIFO forbids overtaking the blocked first open");
  t.mock.timers.tick(1_000);
  assert.deepEqual(await unrelated, []);
  blocker.close();
  await f.until(() => f.opens.every((request) => request.done && request.onerror === null && request.onsuccess === null), "both abandoned opens cleaned");
  assert.equal(f.version, 2);
  assert.equal(f.committed().length, 2);
});

test("account cache retirement: a fresh empty database follows the unchanged version3 upgrade", async (t) => {
  const scope = identity();
  const f = useFixture(t, { version: 0, storeExists: false });
  assert.equal(await cache.writeAccountSnapshot(scope, events("FRESH"), 2, "full", guard(scope)), true);
  assert.equal(f.version, 3);
  assert.equal(f.storeExists, true);
  assert.equal(f.row(key(scope)).head, 2);
});

test("account cache native port: unfinished opens are FIFO and never overtake a delayed predecessor", async (t) => {
  const f = useFixture(t);
  const gate = f.gate("open:begin");
  const first = f.indexedDB.open(f.name, 3), second = f.indexedDB.open(f.name, 3);
  first.onsuccess = () => first.result.close();
  second.onsuccess = () => second.result.close();
  await gate.wait;
  await f.quiet();
  assert.equal(f.trace.some((entry) => entry.phase === "open:begin" && entry.open === second.id), false);
  gate.release();
  await f.until(() => first.done && second.done && f.activeHandles() === 0, "both FIFO native opens complete");
  const begins = f.trace.filter((entry) => entry.phase === "open:begin").map((entry) => entry.open);
  assert.deepEqual(begins, [first.id, second.id]);
});

test("account cache native port: concurrent readonly is allowed, readwrite blocks all later overlapping-store work", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const connection = f.holdConnection();
  const gate = f.gate("request:get");
  const first = connection.transaction(f.storeName, "readonly");
  first.objectStore(f.storeName).get(key(scope));
  const second = connection.transaction(f.storeName, "readonly");
  second.objectStore(f.storeName).get(key(scope));
  const writer = connection.transaction(f.storeName, "readwrite");
  writer.objectStore(f.storeName).put(snapshot(scope, "WRITER"));
  const after = connection.transaction(f.storeName, "readonly");
  const lastRead = after.objectStore(f.storeName).get(key(scope));
  await gate.wait;
  await f.until(() => second.finished, "overlapping readonly transaction completes");
  assert.equal(first.finished, false);
  assert.equal(writer.started, false);
  assert.equal(after.started, false);
  gate.release();
  await f.until(() => after.finished, "writer and following read finish in native order");
  assert.equal(lastRead.result.events[0].payload.name, "WRITER");
  connection.close();
});

test("account cache native port: request cloning, active callbacks, and atomic rollback match IDB semantics", async (t) => {
  const scope = identity();
  const f = useFixture(t);
  const connection = f.holdConnection();
  const gate = f.gate("request:put");
  const transaction = connection.transaction(f.storeName, "readwrite");
  const store = transaction.objectStore(f.storeName);
  const row = snapshot(scope, "CLONED-AT-REQUEST");
  const put = store.put(row);
  row.events[0].payload.name = "MUTATED";
  let activeFollowup = false;
  put.onsuccess = () => { store.get(key(scope)); activeFollowup = true; };
  await gate.wait;
  assert.throws(() => store.put(snapshot(scope)), { name: "TransactionInactiveError" });
  assert.equal(f.row(key(scope)), undefined);
  gate.release();
  await f.until(() => transaction.finished, "valid transaction commits");
  assert.equal(activeFollowup, true);
  assert.equal(f.row(key(scope)).events[0].payload.name, "CLONED-AT-REQUEST");

  const before = f.committed();
  const aborting = connection.transaction(f.storeName, "readwrite");
  const changing = aborting.objectStore(f.storeName);
  const deletion = changing.delete(key(scope));
  deletion.onsuccess = () => {
    changing.put(snapshot(scope, "MUST-ROLL-BACK"));
    aborting.abort();
  };
  await f.until(() => aborting.finished, "aborted transaction ends");
  assert.deepEqual(f.committed(), before);
  connection.close();
});

test("account cache native port: close is pending until live transactions finish and rejects new transactions", async (t) => {
  const f = useFixture(t);
  const connection = f.holdConnection();
  const gate = f.gate("request:getAll");
  const transaction = connection.transaction(f.storeName, "readonly");
  transaction.objectStore(f.storeName).getAll();
  await gate.wait;
  connection.close();
  assert.equal(connection.closed, false);
  assert.throws(() => connection.transaction(f.storeName, "readonly"), { name: "InvalidStateError" });
  gate.release();
  await f.until(() => transaction.finished && connection.closed, "close-pending connection finishes");
});

for (const failure of ["request:get", "request:delete", "transaction:commit"]) {
  test("account cache retirement: exact deletion failure at " + failure + " cannot report cleared", async (t) => {
    const scope = identity();
    const before = snapshot(scope, "PHYSICAL-REMAINDER");
    const f = useFixture(t, { rows: [before] });
    f.failNext(failure, "UnknownError");
    assert.deepEqual(await exactClear(scope, guard(scope)), { status: "unavailable" });
    assert.deepEqual(f.row(key(scope)), before);
    assert.deepEqual(await cache.readAccountSnapshots(scope, guard(scope)), []);
    assert.equal(cache.matchingAccountSnapshot([before], scope, "full", guard(scope)), null);
  });
}

test("account cache retirement: a rejected write does not certify coverage over an earlier denial", async (t) => {
  const scope = identity();
  const f = useFixture(t, { rows: [snapshot(scope)] });
  const original = guard(scope), invalidNewer = guard(scope, "full", () => false);
  assert.equal(await cache.writeAccountSnapshot(scope, events("UNVERIFIED"), 4, "full", invalidNewer), false);
  assert.deepEqual(await exactClear(scope, original), { status: "cleared" });
  assert.equal(f.row(key(scope)), undefined);
});

test("account cache retirement: an empty verified source or no-source attempt never reopens old retained fallback", async (t) => {
  const scope = identity();
  const before = snapshot(scope, "RETAINED-BUT-DENIED");
  const f = useFixture(t, { rows: [before] });
  f.failNext("request:delete", "UnknownError");
  assert.deepEqual(await exactClear(scope, guard(scope)), { status: "unavailable" });
  const completedEmpty = guard(scope);
  const opensBefore = f.opens.length;
  assert.equal(cache.accountSnapshotFenceCurrent(scope, completedEmpty.fence), true);
  assert.deepEqual(await cache.readAccountSnapshots(scope, completedEmpty), [], "owned new read alone is not recovery");
  assert.equal(await cache.writeAccountSnapshot(scope, [], 0, "full", completedEmpty), false);
  assert.equal(await cache.writeAccountSnapshot(scope, events("NO-SOURCE"), 4, "full", guard(scope, "full", () => false)), false);
  assert.equal(f.opens.length, opensBefore, "neither case starts a storage write");
  assert.equal(cache.matchingAccountSnapshot([before], scope, "full", completedEmpty), null);
  assert.deepEqual(await cache.readAccountSnapshots(scope, completedEmpty), []);
  assert.deepEqual(f.row(key(scope)), before, "failed cleanup's physical remainder is still truthfully quarantined");
});
