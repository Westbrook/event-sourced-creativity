import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Exact new catch callback, with explicit reservation/release/logger ports.
// This does not run the full HTTP handler or classify uncertain cost commits.
const source = await readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8");
const start = source.indexOf("if(!costReservationId){const costReservation=await reserveCostBudget");
assert.ok(start >= 0);
const callbackStart = source.indexOf(".catch(async(error:unknown)=>{", start);
const callbackEnd = source.indexOf(");if(!costReservation.ok)", callbackStart);
assert.ok(callbackStart > start && callbackEnd > callbackStart);
const callback = source.slice(callbackStart + ".catch(".length, callbackEnd);
assert.doesNotMatch(callback, /releaseCostBudget|settleCostBudget|Response\.json|costReservationId/);
const createCatch = new Function("scenePrepared", "reservationCreated", "releaseBudget", "console", "env", "billingOwnerId", "reservationId",
  `return (${stripTypeScriptTypes(callback)});`);
function fixture({ scene = true, fresh = true, cleanupError } = {}) {
  const releases = [], warnings = [];
  const env = { fixture: true };
  const caught = createCatch(scene ? { assertions: [] } : null, fresh, async (...args) => {
    releases.push(args);
    if (cleanupError) throw cleanupError;
  }, { warn: (...args) => warnings.push(args) }, env, "owner", "original-token");
  return { caught, releases, warnings, env };
}

test("a thrown cost-source check releases only this request's fresh Scene token then preserves the original error", async () => {
  const f = fixture();
  const error = new Error("CHECK constraint failed: passed=1");
  await assert.rejects(Promise.reject(error).catch(f.caught), value => value === error);
  assert.deepEqual(f.releases, [[f.env, "owner", "original-token", { reason: "scene_cost_reservation_failed" }]]);
  assert.deepEqual(f.warnings, []);
});

test("retained token IDs and non-Scene reservations are never released by this catch", async () => {
  for (const options of [{ fresh: false }, { scene: false }, { scene: false, fresh: false }]) {
    const f = fixture(options), error = new Error("unavailable");
    await assert.rejects(Promise.reject(error).catch(f.caught), value => value === error);
    assert.deepEqual(f.releases, []);
    assert.deepEqual(f.warnings, []);
  }
});

test("unknown cost-commit failure stays the exact primary error even if token cleanup also fails", async () => {
  const primary = { opaqueCommitFailure: true }, cleanupError = new Error("private cleanup detail");
  const f = fixture({ cleanupError });
  await assert.rejects(Promise.reject(primary).catch(f.caught), value => value === primary);
  assert.equal(f.releases.length, 1);
  assert.deepEqual(f.warnings, [["scene_fresh_token_cleanup_failed"]]);
});

test("successful cost reservation and ordinary nonthrowing refusal bypass the catch unchanged", async () => {
  for (const value of [{ ok: true, reservationId: "cost" }, { ok: false, scope: "user" }]) {
    const f = fixture();
    assert.equal(await Promise.resolve(value).catch(f.caught), value);
    assert.deepEqual(f.releases, []);
    assert.deepEqual(f.warnings, []);
  }
});
