import assert from "node:assert/strict";
import test from "node:test";
import { sourceFixture } from "./helpers/event-source-retirement-fixture.mjs";

// Independent actual full Store + RAM Worker proof for the source token used by
// the Canvas handoff. No Canvas render/synchronize is invoked between A/B/A.
// The Canvas focus tests remain separately labelled full-component/finite-port
// evidence; this file does not claim an adaptive API insertion or browser result.
test("actual full Store source generation stays retired after genuine 403 then restored 200 without rendering", async t => {
  const h = await sourceFixture(t), original = h.store.captureSourceOwnership();
  assert.ok(h.store.sourceOwnershipActive(original));
  h.revoke();
  const denial = await h.worker.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(denial.status, 403);
  await assert.rejects(h.store.refreshEvents(), /403/u);
  assert.equal(h.store.sourceOwnershipActive(original), false);
  h.restoreMembership(); await h.store.refreshEvents();
  const recovered = h.store.captureSourceOwnership();
  assert.equal(recovered.authorization.key, original.authorization.key, "same source scope can return");
  assert.ok(recovered.generation > original.generation, "the actual private generation cannot roll back");
  assert.equal(h.store.sourceOwnershipActive(original), false);
  assert.equal(h.store.sourceOwnershipActive(recovered), true);
});

test("actual full Store authority A to B to A advances source generation without rendering", async t => {
  const h = await sourceFixture(t), original = h.store.captureSourceOwnership(), audience = h.store.session.get().audience ?? "creative";
  const alternate = audience === "canvas" ? "creative" : "canvas";
  const responseB = await h.worker.request("/api/session?audience=" + alternate);
  assert.equal(responseB.status, 200, await responseB.clone().text());
  await h.store.refreshSession(Promise.resolve(responseB));
  const changed = h.store.captureSourceOwnership();
  assert.notEqual(changed.authorization.key, original.authorization.key);
  assert.ok(changed.generation > original.generation); assert.equal(h.store.sourceOwnershipActive(original), false);
  const responseA = await h.worker.request("/api/session?audience=" + audience);
  assert.equal(responseA.status, 200, await responseA.clone().text());
  await h.store.refreshSession(Promise.resolve(responseA));
  const returned = h.store.captureSourceOwnership();
  assert.equal(returned.authorization.key, original.authorization.key);
  assert.ok(returned.generation > changed.generation);
  assert.equal(h.store.sourceOwnershipActive(original), false);
  assert.equal(h.store.sourceOwnershipActive(returned), true);
});
