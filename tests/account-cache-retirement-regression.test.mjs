import assert from "node:assert/strict";
import { test } from "node:test";
import * as cache from "../src/state/account-cache.ts";
import { AccountCacheIndexedDbFixture } from "./helpers/account-cache-indexeddb-fixture.mjs";

// These four assertions also execute the unchanged legacy implementation. The
// fallback token only preserves JavaScript call arity: old functions ignore the
// extra argument. No guard, matching function, or storage method is substituted.
let sequence = 0;
const scope = (extra = {}) => ({ userId: "causal-actor-" + ++sequence, principalUserId: "causal-principal",
  accepted: true, impersonating: false, policyVersion: "policy", permissionEpoch: "epoch", ...extra });
const key = (identity) => [identity.principalUserId ?? identity.userId, identity.userId, identity.audience ?? "creative",
  identity.organizationId ?? "personal", identity.projectAccessId ?? "personal", identity.permissionEpoch ?? "legacy",
  identity.policyVersion].map(encodeURIComponent).join(":") + ":v3";
const body = (label) => [{ eventId: label, sequence: 1, streamId: "causal-owner", type: "ProjectCreated",
  payload: { project_id: "project", name: label }, actorUserId: "causal-owner", createdAt: "2026-08-28T00:00:00.000Z",
  clientId: "causal", correlationId: null }];
const capture = (identity) => ({
  fence: cache.captureAccountSnapshotFence?.(identity, "full") ?? Object.freeze({}),
  current: () => true,
});
const clear = (identity, controls) => cache.clearAccountSnapshots(identity, { scope: "source", fence: controls.fence });
const useFixture = (t) => {
  const f = new AccountCacheIndexedDbFixture();
  const restore = f.install();
  t.after(async () => { try { await f.quiet(); f.assertConsistent(); } finally { restore(); } });
  return f;
};

test("cache causal: an old logical callback cannot write after exact source denial", async (t) => {
  const f = useFixture(t), identity = scope(), original = capture(identity);
  await cache.writeAccountSnapshot(identity, body("ORIGINAL"), 1, "full", original);
  await clear(identity, original);
  await cache.writeAccountSnapshot(identity, body("LATE-OLD-REPLY"), 2, "full", original);
  assert.equal(f.row(key(identity)), undefined, "retirement must fence the original source token even when its callback invokes write later");
});

test("cache causal: exact source denial preserves a different source of the same principal", async (t) => {
  const f = useFixture(t), identity = scope({ organizationId: "org", projectAccessId: "shared-1" });
  const other = { ...identity, projectAccessId: "shared-2" };
  const first = capture(identity), second = capture(other);
  await cache.writeAccountSnapshot(identity, body("DENIED"), 1, "full", first);
  await cache.writeAccountSnapshot(other, body("UNRELATED"), 2, "full", second);
  await clear(identity, first);
  assert.equal(f.row(key(other))?.events[0].payload.name, "UNRELATED", "source-mode cleanup must not use the legacy principal-wide predicate");
});

test("cache causal: a previously read private row cannot return after denial and a verified replacement", async (t) => {
  const f = useFixture(t), identity = scope(), original = capture(identity);
  await cache.writeAccountSnapshot(identity, body("OLD-PRIVATE"), 1, "full", original);
  const oldRows = await cache.readAccountSnapshots(identity, original);
  await clear(identity, original);
  const recovered = capture(identity);
  await cache.writeAccountSnapshot(identity, body("VERIFIED-NEW"), 3, "full", recovered);
  assert.equal(f.row(key(identity))?.head, 3, "a real replacement exists");
  assert.equal(cache.matchingAccountSnapshot(oldRows, identity, "full", recovered), null,
    "passing a new source token cannot attach current custody to an earlier returned row");
});

test("cache causal: a late older denial cannot delete a newer completed source", async (t) => {
  const f = useFixture(t), identity = scope(), older = capture(identity), newer = capture(identity);
  await cache.writeAccountSnapshot(identity, body("FULLY-VERIFIED-NEW"), 8, "full", newer);
  await clear(identity, older);
  assert.equal(f.row(key(identity))?.head, 8,
    "the older logical response arrives later; this control does not let DB opens overtake one another");
});
