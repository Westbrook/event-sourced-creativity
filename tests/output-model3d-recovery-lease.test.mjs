import test from "node:test";
import assert from "node:assert/strict";
import { model3dRecoveryFixture as fixture, model3dRecoverySnapshot as snapshot, withoutModel3dRecovery as withoutRecovery, model3dRecoveryBudgets as budgets } from "./helpers/output-model3d-recovery-fixture.mjs";
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = () => { networkAttempts++; throw Error("SQLite lease controls deny all provider/network requests"); };
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
const { settleOutputProviderCall } = await import("../worker/output-requirements-ledger.ts");
const { reconcileKnownOutputProviderReceipts } = await import("../worker/output-execution-control.ts");

test("actual SQLite claim preserves all original rows/schema/media except its private lease and history; release retires only token", async () => {
  const f = await fixture();
  try {
    const before = snapshot(f); assert.equal(await f.available(), true); assert.deepEqual(snapshot(f), before);
    const lease = await f.claim(); await lease.assertCurrent(); assert.equal(await f.available(), false);
    const after = snapshot(f); assert.deepEqual(withoutRecovery(after), before); assert.equal(f.readJob().status, "failed");
    const result = JSON.parse(f.readJob().result_json); assert.equal(result.outputModel3dRecoveryHistory.length, 1); assert.equal(result.outputModel3dRecovery.token, lease.token);
    assert.deepEqual(result.outputModel3dRecovery.originalSubmission, f.provider);
    const priorBudgets = budgets(f); await lease.release(); const released = JSON.parse(f.readJob().result_json);
    assert.equal(released.outputModel3dRecovery.token, lease.token); assert(Date.parse(released.outputModel3dRecovery.expiresAt) <= Date.now());
    assert.deepEqual(released.outputModel3dRecoveryHistory, result.outputModel3dRecoveryHistory); assert.deepEqual(budgets(f), priorBudgets);
    assert.deepEqual(withoutRecovery(snapshot(f)), before); await assert.rejects(lease.assertCurrent());
    const afterRelease = snapshot(f); assert.equal(await f.available(), true); assert.deepEqual(snapshot(f), afterRelease);
  } finally { f.close(); }
});

test("actual SQLite accepted-to-completed receipt and actual budget reconciliation survive the same lease without new holds/calls", async () => {
  const f = await fixture();
  try {
    const lease = await f.claim(), beforeCounts = snapshot(f), paid = { ...f.provider, status: "completed", costMicrousd: 400000, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    f.sqlite.prepare("UPDATE document_jobs SET result_json=json_patch(result_json,?) WHERE job_id=?").run(JSON.stringify({ providerSubmissions: { [paid.clientRequestId]: paid } }), f.job.job_id);
    await lease.assertCurrent();
    await settleOutputProviderCall(f.env, { scopeKey: "scope", slotId: "slot", callKey: "model3d:initial", clientRequestId: paid.clientRequestId, providerResponseId: paid.providerRequestId,
      status: "settled", usedMicrousd: 400000, assertions: lease.assertions() });
    await lease.assertCurrent();
    const settlement = await reconcileKnownOutputProviderReceipts(f.env, f.user, { jobId: f.job.job_id, assertions: lease.assertions() }); assert.equal(settlement.status, "known");
    await lease.assertCurrent();
    const token = f.sqlite.prepare("SELECT * FROM budget_reservations").get(), cost = f.sqlite.prepare("SELECT * FROM cost_budget_reservations").get();
    assert.equal(token.status, "released"); assert.equal(token.used_tokens, 0); assert.equal(cost.status, "settled"); assert.equal(cost.used_microusd, 400000);
    for (const table of ["document_jobs", "output_operation_slots", "output_execution_grants", "output_provider_calls", "budget_reservations", "cost_budget_reservations"])
      assert.equal(snapshot(f).tables[table].length, beforeCounts.tables[table].length, table);
    assert.equal(f.readJob().status, "failed"); assert.equal(f.readJob().attempt_count, 1); assert.equal(f.readJob().notified_at, null);
    const paidState = budgets(f); await reconcileKnownOutputProviderReceipts(f.env, f.user, { jobId: f.job.job_id, assertions: lease.assertions() }); assert.deepEqual(budgets(f), paidState);
    await lease.release();
  } finally { f.close(); }
});

for (const change of ["canceled", "revoked", "source", "retention", "job-expiry", "call", "pending", "duplicate-call"]) test(`actual SQLite refuses ${change} without claim side effects`, async () => {
  const f = await fixture();
  try {
    if (change === "canceled") f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
    if (change === "revoked") f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'");
    if (change === "source") f.sqlite.exec("UPDATE recovery_test_source SET current=0");
    if (change === "retention") f.current.retentionExpiresAt = "2020-01-01T00:00:00.000Z";
    if (change === "job-expiry") f.sqlite.exec("UPDATE document_jobs SET expires_at='2020-01-01T00:00:00.000Z'");
    if (change === "call") f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='foreign'");
    if (change === "pending") f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.\"forma-model3d-test-original\".status','pending')");
    if (change === "duplicate-call") f.sqlite.exec("INSERT INTO output_provider_calls SELECT scope_key,slot_id,'second',client_request_id||'-second',request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,provider_response_id,created_at,settled_at FROM output_provider_calls");
    const before = snapshot(f);
    if (!["source", "retention"].includes(change)) assert.equal(await f.available(), false);
    await assert.rejects(f.claim()); assert.deepEqual(snapshot(f), before);
  } finally { f.close(); }
});

for (const change of ["cancel", "source", "expiry", "abort"]) test(`actual SQLite live lease refuses ${change} and preserves financial rows`, async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const lease = await f.claim({ signal: controller.signal }), before = budgets(f);
    if (change === "cancel") f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
    if (change === "source") f.sqlite.exec("UPDATE recovery_test_source SET current=0");
    if (change === "expiry") f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.expiresAt','2020-01-01T00:00:00.000Z')");
    if (change === "abort") controller.abort();
    await assert.rejects(lease.assertCurrent()); assert.deepEqual(budgets(f), before);
    const prior = snapshot(f); await lease.release(); if (change === "cancel") assert.deepEqual(snapshot(f), prior);
  } finally { f.close(); }
});

test("actual SQLite concurrent/repeated claims cannot replace a live token; later explicit claim preserves earlier history", async () => {
  const f = await fixture();
  try {
    const first = await f.claim(), before = snapshot(f); await assert.rejects(f.claim()); assert.deepEqual(snapshot(f), before); await first.assertCurrent();
    await first.release(); const next = await f.claim(); assert.notEqual(next.token, first.token); await next.assertCurrent();
    const result = JSON.parse(f.readJob().result_json); assert.equal(result.outputModel3dRecoveryHistory.length, 2); assert.equal(result.outputModel3dRecoveryHistory[0].token, first.token);
    const current = snapshot(f); await first.release(); assert.deepEqual(snapshot(f), current); await next.release();
  } finally { f.close(); }
});

test("two interleaved SQLite claim attempts admit exactly one original lease and preserve all financial identities", async () => {
  const f = await fixture();
  try {
    const before = budgets(f), outcomes = await Promise.allSettled([f.claim(), f.claim()]);
    assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1); assert.equal(outcomes.filter(value => value.status === "rejected").length, 1);
    const lease = outcomes.find(value => value.status === "fulfilled").value; await lease.assertCurrent(); assert.deepEqual(budgets(f), before);
    const result = JSON.parse(f.readJob().result_json); assert.equal(result.outputModel3dRecoveryHistory.length, 1); assert.equal(result.outputModel3dRecovery.token, lease.token);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 1); await lease.release();
  } finally { f.close(); }
});
