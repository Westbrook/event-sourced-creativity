import test from "node:test";
import assert from "node:assert/strict";
import { registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
registerOutputSourceImports();
const { model3dRecoveryFixture: fixture, model3dRecoveryBudgets: budgets } = await import("./helpers/output-model3d-recovery-fixture.mjs");
const { glb } = await import("./helpers/model3d-native-execution-fixture.mjs");
const { executeOutputModel3dRecovery, recoverOutputModel3d } = await import("../worker/output-model3d-recovery.ts");
const { remainingOutputModel3dRecoveryUsage, assertOutputModel3dRecoveryPrimarySize, MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES } = await import("../worker/output-model3d-recovery-completion.ts");
const realFetch = globalThis.fetch;
const deny = () => { throw Error("Unexpected network: this suite permits only its synthetic original-ID GET ports"); };
globalThis.fetch = deny; test.after(() => { globalThis.fetch = realFetch; });

function ports(f, mode = "completed", onRequest = () => {}, bytes = glb()) {
  const requests = [], requestId = f.provider.providerRequestId;
  const base = "https://queue.fal.run/fal-ai/hyper3d/requests/" + requestId;
  const asset = "https://v3.fal.media/files/test/original.glb";
  f.env.FAL_KEY = "synthetic-unit-test-key-not-a-credential";
  const originalPut = f.env.MEDIA.put.bind(f.env.MEDIA);
  f.env.MEDIA.put = async (key, value, options) => {
    assert.equal(options.onlyIf.etagDoesNotMatch, "*");
    if (f.mediaMap.has(key)) return null; // Test the actual conditional-create contract.
    return originalPut(key, value, options);
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "manual"); assert(init.signal instanceof AbortSignal);
    await onRequest(url, requests.length);
    if (url === base + "/status") return Response.json({ request_id: requestId, status: mode === "pending" ? "IN_PROGRESS" : "COMPLETED" });
    if (url === base) return Response.json({ request_id: mode === "wrong-id" ? "foreign" : requestId, seed: 1,
      model_mesh: { url: asset, content_type: "model/gltf-binary", file_name: "original.glb", file_size: bytes.length }, textures: [] });
    if (url === asset) {
      assert.equal(init.headers, undefined, "credentials never sent to media host");
      return new Response(mode === "bad-file" ? new Uint8Array(bytes.length) : bytes,
        { headers: { "content-type": "model/gltf-binary", "content-length": String(bytes.length) } });
    }
    return deny();
  };
  return { requests, bytes };
}
const run = f => executeOutputModel3dRecovery(f.env, f.user, f.readJob(), { scope: f.scope, slot: f.slot, retentionPolicy: null },
  { assertions: f.assertions, current: f.current });
const count = (f, type) => f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE correlation_id=? AND type=?").get(f.job.correlation_id, type).n;
test("throwing stage diagnostics cannot interrupt original recovery or alter billing",async()=>{
 const f=await fixture(),stages=[];
 try {const port=ports(f);const done=await executeOutputModel3dRecovery(f.env,f.user,f.readJob(),{scope:f.scope,slot:f.slot,retentionPolicy:null},
  {assertions:f.assertions,current:f.current,onStage(stage){stages.push(stage);throw Error('observer failure');}});
  assert.equal(done.status,'completed');successful(f);assert.equal(port.requests.length,3);
  assert.ok(stages.includes('model3d_file_qualify'));assert.ok(stages.includes('model3d_publish'));
 }finally{f.close();globalThis.fetch=deny;}
});
for (const stop of ["abort", "deadline"]) test(`whole recovery command retires a hung authority read on ${stop} without late continuation`, { timeout: 3000 }, async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const prepare = f.DB.prepare.bind(f.DB); let release, reads = 0;
    f.DB.prepare = sql => {
      reads++; const statement = prepare(sql), bind = statement.bind;
      statement.bind = function (...values) {
        const bound = bind.apply(this, values), first = bound.first.bind(bound);
        bound.first = () => new Promise(resolve => { release = async () => resolve(await first()); });
        return bound;
      }; return statement;
    };
    const assertions = stop === "deadline" ? [...f.assertions, { sql: "1", deadlineMs: Date.now() + 80 }] : f.assertions;
    const pending = recoverOutputModel3d(f.env, f.user, f.readJob(), { assertions, signal: controller.signal });
    if (stop === "abort") controller.abort(Error("whole command canceled"));
    await assert.rejects(pending, new RegExp(stop === "abort" ? "whole command canceled" : "deadline"));
    assert.equal(reads, 1); assert(release); await release(); await Promise.resolve();
    assert.equal(reads, 1); assert.equal(f.mediaMap.size, 0); assert.equal(count(f, "DocumentRenderCompleted"), 0);
    assert.equal(f.readJob().status, "failed"); assert.equal(result(f).outputModel3dRecovery, undefined);
  } finally { f.close(); }
});
const result = f => JSON.parse(f.readJob().result_json);
function successful(f) {
  assert.equal(f.readJob().status, "completed"); assert.equal(f.readJob().attempt_count, 1); assert.equal(f.readJob().notified_at, null);
  assert.equal(count(f, "DocumentRenderCompleted"), 1); assert.equal(count(f, "GenerationUsageRecorded"), 1);
  const slot = f.sqlite.prepare("SELECT * FROM output_operation_slots").get(); assert.equal(slot.status, "succeeded");
  assert.equal(slot.outcome_event_id, result(f).outputModel3dRecovery.completionEventId);
  assert.equal(f.sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "completed");
  const call = f.sqlite.prepare("SELECT * FROM output_provider_calls").get(); assert.equal(call.status, "settled"); assert.equal(call.used_microusd, 400000);
  assert.equal(call.provider_response_id, f.provider.providerRequestId);
  assert.equal(f.sqlite.prepare("SELECT status FROM budget_reservations").get().status, "released");
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations").get().used_microusd, 400000);
  for (const table of ["document_jobs", "output_operation_slots", "output_execution_grants", "output_provider_calls", "budget_reservations", "cost_budget_reservations"])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1, table);
  assert.deepEqual(result(f).outputModel3dRecoveryHistory[0].originalSubmission, f.provider);
  const payload = JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(slot.outcome_event_id).private_json);
  assert.equal(payload.settings.seed, 1);
  const exactTuples = f.sqlite.prepare(`SELECT json_extract(body.private_json,'$.settings.output_model3d.execution')=json_extract(job.request_json,'$.outputExecution') AS execution,
    json_extract(body.private_json,'$.settings.output_model3d.contract')=json_extract(job.request_json,'$.outputModel3d') AS contract
    FROM event_private_payloads body JOIN document_jobs job ON job.job_id=? WHERE body.private_event_id=?`).get(f.job.job_id, slot.outcome_event_id);
  assert.equal(exactTuples.execution, 1); assert.equal(exactTuples.contract, 1);
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(payload.input_ref).content).render.seed, 1);
  const rows = f.sqlite.prepare("SELECT * FROM output_native_storage_writes").all(); assert.equal(rows.length, 1);
  assert.equal(rows[0].write_acknowledged, 1); assert.equal(rows[0].publication_event_id, slot.outcome_event_id);
}

test("actual service + SQLite + original-only reader produces one retained completion and replays with zero GET/write/usage", async () => {
  const f = await fixture();
  try {
    const port = ports(f); const done = await run(f); assert.equal(done.status, "completed"); successful(f); assert.equal(port.requests.length, 3);
    const priorBudgets = budgets(f), previous = f.readJob(), media = [...f.mediaMap.keys()];
    globalThis.fetch = deny; await run(f); successful(f);
    assert.deepEqual(budgets(f), priorBudgets); assert.deepEqual(f.readJob(), previous); assert.deepEqual([...f.mediaMap.keys()], media);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("pending original is one status GET and preserves all financial liability without media/publication", async () => {
  const f = await fixture();
  try { const before = budgets(f), port = ports(f, "pending"); assert.equal((await run(f)).status, "pending");
    assert.equal(port.requests.length, 1); assert.deepEqual(budgets(f), before); assert.equal(f.readJob().status, "failed");
    assert.equal(count(f, "DocumentRenderCompleted"), 0); assert.equal(f.mediaMap.size, 0);
  } finally { globalThis.fetch = deny; f.close(); }
});

for (const mode of ["wrong-id", "bad-file"]) test(`original ${mode} refuses false completion and preserves honest billability`, async () => {
  const f = await fixture();
  try { const before = budgets(f); ports(f, mode); await assert.rejects(run(f)); assert.equal(f.readJob().status, "failed");
    assert.equal(count(f, "DocumentRenderCompleted"), 0);
    if (mode === "wrong-id") assert.deepEqual(budgets(f), before);
    else { assert.equal(f.sqlite.prepare("SELECT used_microusd FROM output_provider_calls").get().used_microusd, 400000);
      assert.equal(result(f).providerSubmissions[f.provider.clientRequestId].status, "completed"); }
  } finally { globalThis.fetch = deny; f.close(); }
});

test("authority change during original status GET prevents result/media/publication and retains holds", async () => {
  const f = await fixture();
  try { const before = budgets(f), port = ports(f, "completed", () => f.sqlite.exec("UPDATE recovery_test_source SET current=0"));
    await assert.rejects(run(f)); assert.equal(port.requests.length, 1); assert.deepEqual(budgets(f), before); assert.equal(f.mediaMap.size, 0);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("a settled original with a refused file can be recovered without another paid attempt", async () => {
  const f = await fixture();
  try {
    ports(f, "bad-file"); await assert.rejects(run(f));
    const settled = budgets(f);
    const port = ports(f);
    assert.equal((await run(f)).status, "completed");
    successful(f); assert.equal(port.requests.length, 3);
    assert.deepEqual(budgets(f), settled);
    assert.equal(result(f).outputModel3dRecoveryHistory.length, 2);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("lost acknowledgement after actual commit returns the same strict completed original", async () => {
  const f = await fixture();
  try {
    ports(f); const batch = f.env.DB.batch.bind(f.env.DB); let lost = false;
    f.env.DB.batch = async statements => {
      const final = statements.some(statement => /UPDATE document_jobs SET status='completed'/.test(statement.sql));
      const value = await batch(statements); if (final && !lost) { lost = true; throw Error("synthetic_lost_commit_ack"); } return value;
    };
    assert.equal((await run(f)).status, "completed"); assert(lost); successful(f);
  } finally { globalThis.fetch = deny; f.close(); }
});

for (const corrupt of [false, true]) test(`durable completion with lost terminal finalization ${corrupt ? "rejects changed bytes" : "reuses exact private bytes without GET"}`, async () => {
  const f = await fixture();
  try {
    ports(f); await run(f); successful(f);
    f.sqlite.exec("UPDATE document_jobs SET status='failed',error_message='local_persistence_failed',result_json=json_remove(result_json,'$.outputModel3dRecovery'); UPDATE output_operation_slots SET status='failed',outcome_event_id=NULL");
    const before = budgets(f); globalThis.fetch = deny;
    if (corrupt) f.mediaMap.values().next().value.bytes[0] ^= 1;
    if (corrupt) { await assert.rejects(run(f)); assert.equal(f.readJob().status, "failed"); }
    else { assert.equal((await run(f)).status, "completed"); successful(f); }
    assert.deepEqual(budgets(f), before); assert.equal(count(f, "DocumentRenderCompleted"), 1); assert.equal(count(f, "GenerationUsageRecorded"), 1);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("pure remaining-usage arithmetic denies malformed, foreign, negative and excessive prior usage", () => {
  const input = { rows: [], costMicrousd: 400000, artifactId: "a", documentId: "d", reservationId: "t", costReservationId: "c", providerRequestId: "p" };
  const row = { operation: "document-render:model3d", artifact_id: "a", document_id: "d", reservation_id: "t", cost_reservation_id: "c", provider_job_id: "p", input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_microusd: 100000 };
  assert.equal(remainingOutputModel3dRecoveryUsage(input).cost_microusd, 400000);
  assert.equal(remainingOutputModel3dRecoveryUsage({ ...input, rows: [row] }).cost_microusd, 300000);
  for (const patch of [{ cost_microusd: -1 }, { cost_microusd: 500000 }, { cost_microusd: "1" }, { total_tokens: 1 }, { provider_job_id: "foreign" }])
    assert.throws(() => remainingOutputModel3dRecoveryUsage({ ...input, rows: [{ ...row, ...patch }] }));
  assert.throws(() => remainingOutputModel3dRecoveryUsage({ ...input, rows: Array(65).fill(row) }));
});

test("recovery primary structural qualification shares the inclusive 64MiB transfer boundary", () => {
  assert.equal(MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES, 64 * 1024 * 1024);
  assert.doesNotThrow(() => assertOutputModel3dRecoveryPrimarySize(MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES));
  for (const size of [0, -1, 1.5, NaN, Infinity, MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES + 1])
    assert.throws(() => assertOutputModel3dRecoveryPrimarySize(size), /output_model3d_recovery_qualification_size_limit/);
});

test("actual recovery qualifies a GLB larger than the retired 16MiB cap", async () => {
  const f = await fixture();
  try {
    const port = ports(f, "completed", () => {}, glb({}, 18 * 1024 * 1024));
    assert.equal((await run(f)).status, "completed"); successful(f);
    assert.equal(port.requests.length, 3);
    assert.equal((await run(f)).status, "completed");
    assert.equal(port.requests.length, 3);
  } finally { globalThis.fetch = deny; f.close(); }
});
