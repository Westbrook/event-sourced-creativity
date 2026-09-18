import assert from "node:assert/strict";
import test from "node:test";
import { createVideoReconciliationController, VIDEO_RECONCILIATION_JOB } from "../src/model/managed-video-reconciliation.ts";
const id = "forma-video-reconciliation-20260911-01a040b4", digest = "a".repeat(64);
const treatment = { id, jobId: VIDEO_RECONCILIATION_JOB, period: "2026-08", kind: "operator_adjudicated_zero", providerVerified: false,
  usedMicrousd: 98484, usedTokens: 15580, unusedMicrousd: 19545516, unusedTokens: 136420 };
const preview = () => ({ preview: { treatment, ownerId: "test-owner", treatmentSha256: digest, snapshotSha256: digest, evidenceSha256: digest, acknowledgement: "Exact test acknowledgement" } });
const receipt = () => ({ verification: { treatmentId: id, found: true, verified: true, transactionVerified: true, requiresReview: false,
  providerVerified: false, recordSha256: digest, createdAt: "2026-09-11T12:00:00.000Z", treatment,
  record: { operatorId: "test-owner", treatment, commandSha256: digest, treatmentSha256: digest, command: { treatmentId: id } } } });
function fixture() {
  const controller = createVideoReconciliationController(), calls = [];
  const f = { controller, calls, current: true, response: () => Response.json(preview()) };
  f.ports = { ownerId: "test-owner", current: () => f.current, changed() {}, fetch: async (url, init, current) => {
    assert(current()); calls.push({ url, init }); return f.response(url, init);
  } };
  return f;
}
test("one explicit POST is followed by separate GET verification; duplicate apply is inert", async () => {
  const f = fixture(); await f.controller.read(f.ports); assert.equal(f.controller.state().status, "ready");
  f.response = () => Response.json(receipt()); await f.controller.apply(f.ports); await f.controller.apply(f.ports);
  assert.deepEqual(f.calls.map(call => call.init.method), ["GET", "POST", "GET"]); assert.equal(f.controller.state().status, "verified");
  assert.deepEqual(Object.keys(JSON.parse(f.calls[1].init.body)).sort(), ["acknowledgement", "evidenceSha256", "snapshotSha256", "treatmentId", "treatmentSha256"]);
});
for (const [label, change] of [
  ["not found success", v => { v.found = false; }],
  ["unverified transaction", v => { v.transactionVerified = false; }],
  ["contradictory review", v => { v.requiresReview = true; }],
  ["wrong owner", v => { v.record.operatorId = "other"; }],
  ["wrong treatment", v => { v.treatment = { ...v.treatment, usedMicrousd: 0 }; }],
  ["missing digest", v => { v.recordSha256 = null; }],
]) test("rejects contradictory verification: " + label, async () => {
  const f = fixture(), value = receipt(); change(value.verification); f.response = () => Response.json(value);
  await f.controller.verify(f.ports); assert.equal(f.controller.state().status, "unavailable"); assert.equal(f.controller.state().receipt, null);
});
test("lost POST and failed verification retain uncertainty without a second POST", async () => {
  const f = fixture(); await f.controller.read(f.ports); f.response = () => { throw new Error("lost response"); };
  await f.controller.apply(f.ports); assert.equal(f.controller.state().status, "uncertain");
  await f.controller.verify(f.ports); assert.equal(f.controller.state().status, "uncertain");
  await f.controller.apply(f.ports); assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  f.response = () => Response.json(receipt()); await f.controller.verify(f.ports); assert.equal(f.controller.state().status, "verified");
});
test("late body cannot promote after owner cancellation; reopened owner gets no stale command", async () => {
  const f = fixture(); let resolve;
  f.response = () => new Promise(done => { resolve = done; });
  const pending = f.controller.read(f.ports); f.controller.cancel(); resolve(Response.json(preview())); await pending;
  assert.equal(f.controller.state().status, "idle"); await f.controller.apply(f.ports); assert.equal(f.calls.length, 1);
});
test("stale identity and oversized response refuse without an apply affordance", async () => {
  const f = fixture(); f.current = false; await f.controller.read(f.ports); assert.equal(f.calls.length, 0);
  f.current = true; f.response = () => new Response(" ".repeat(131073), { headers: { "content-type": "application/json" } });
  await f.controller.read(f.ports); assert.equal(f.controller.state().status, "unavailable"); await f.controller.apply(f.ports);
  assert.equal(f.calls.length, 1);
});
