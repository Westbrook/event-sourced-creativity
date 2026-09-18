import test from "node:test";
import assert from "node:assert/strict";
import { registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
registerOutputSourceImports();
const { model3dRecoveryFixture, model3dRecoveryBudgets } = await import("./helpers/output-model3d-recovery-fixture.mjs");
const { glb } = await import("./helpers/model3d-native-execution-fixture.mjs");
const { executeOutputModel3dRecovery } = await import("../worker/output-model3d-recovery.ts");
const { MODEL3D_REFERENCE_HEAD_SQL } = await import("../worker/output-model3d-publication-head.ts");
const { appendAuditEvent } = await import("../worker/runtime.ts");
const realFetch = globalThis.fetch;
const deny = () => { throw Error("Only explicit synthetic original-result GETs are allowed"); };
globalThis.fetch = deny; test.after(() => { globalThis.fetch = realFetch; });

// Actual service, original-only reader, SQL/custody assertions, accounting,
// private storage and publication. This witness is a declared source-authority
// port; separate source-loader tests exercise how current reference proof is made.
// No real source, credential, database, provider request or image decode is used.
async function fixture(kind = "image") {
  const f = await model3dRecoveryFixture({ referenceKind: kind });
  const reference = f.original.receipt.referenceInputs[0];
  f.sqlite.exec("CREATE TABLE reference_recovery_witness(owner TEXT,sha TEXT,reference_id TEXT,copied_block TEXT,rights TEXT,expires_at TEXT)");
  f.sqlite.prepare("INSERT INTO reference_recovery_witness VALUES(?,?,?,?,?,?)").run("owner", reference.sha256, reference.referenceId, reference.blockId, "owned", f.current.retentionExpiresAt);
  f.assertions.push({ sql: "EXISTS(SELECT 1 FROM reference_recovery_witness WHERE owner=? AND sha=? AND reference_id=? AND copied_block=? AND rights=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    bindings: ["owner", reference.sha256, reference.referenceId, reference.blockId, "owned", f.current.retentionExpiresAt], deadlineMs: Date.parse(f.current.retentionExpiresAt) });
  const head = { sql: MODEL3D_REFERENCE_HEAD_SQL, bindings: [f.job.stream_id, 0] };
  const refreshHead = () => { head.bindings[1] = f.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(f.job.stream_id).head; };
  refreshHead(); f.assertions.push(head);
  return { ...f, refreshHead };
}
function ports(f, { pending = false, onRequest = () => {} } = {}) {
  const requests = [], requestId = f.provider.providerRequestId, base = "https://queue.fal.run/fal-ai/hyper3d/requests/" + requestId;
  const asset = "https://v3.fal.media/files/test/reference-original.glb", bytes = glb();
  f.env.FAL_KEY = "synthetic-unit-test-key-not-a-credential";
  const put = f.env.MEDIA.put.bind(f.env.MEDIA);
  f.env.MEDIA.put = async (key, value, options) => { assert.equal(options.onlyIf.etagDoesNotMatch, "*"); return f.mediaMap.has(key) ? null : put(key, value, options); };
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push({ url, method: init.method });
    assert.equal(init.method, "GET", "recovery must never upload or POST a new model");
    assert.equal(init.redirect, "manual"); assert(init.signal instanceof AbortSignal);
    await onRequest(url, requests.length);
    if (url === base + "/status") return Response.json({ request_id: requestId, status: pending ? "IN_PROGRESS" : "COMPLETED" });
    if (url === base) return Response.json({ request_id: requestId, seed: 4,
      model_mesh: { url: asset, content_type: "model/gltf-binary", file_name: "original.glb", file_size: bytes.length }, textures: [] });
    if (url === asset) { assert.equal(init.headers, undefined); return new Response(bytes, { headers: { "content-type": "model/gltf-binary", "content-length": String(bytes.length) } }); }
    return deny();
  };
  return requests;
}
const run = f => executeOutputModel3dRecovery(f.env, f.user, f.readJob(), { scope: f.scope, slot: f.slot, retentionPolicy: null }, { assertions: f.assertions, current: f.current });
const completed = f => {
  const result = f.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.correlation_id=? AND event.type='DocumentRenderCompleted'").all(f.job.correlation_id);
  assert.equal(result.length, 1); return JSON.parse(result[0].private_json);
};
function assertOriginal(f) {
  for (const table of ["document_jobs", "output_operation_slots", "output_execution_grants", "output_provider_calls", "budget_reservations", "cost_budget_reservations"])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1, table);
  const call = f.sqlite.prepare("SELECT * FROM output_provider_calls").get();
  assert.equal(call.provider_response_id, f.provider.providerRequestId); assert.equal(call.model, "fal-ai/hyper3d/rodin/v2.5");
  assert.equal(call.request_digest, f.original.receipt.requestDigest); assert.equal(call.used_microusd, 400000);
  assert.equal(f.readJob().job_id, f.job.job_id); assert.equal(f.readJob().attempt_count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE correlation_id=? AND type='GenerationUsageRecorded'").get(f.job.correlation_id).n, 1);
  const event = completed(f), input = JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(event.input_ref).content);
  assert.equal(event.used_reference_pixels, true); assert.deepEqual(event.reference_inputs, f.original.receipt.referenceInputs);
  assert.equal(input.render.used_reference_pixels, true); assert.equal(input.render.usedReferencePixels, true);
  assert.deepEqual(input.render.reference_inputs, f.original.receipt.referenceInputs);
  assert.deepEqual(event.settings.output_model3d.contract, f.original.offer.contract);
}
for (const kind of ["image", "saved-model-view"]) test(`${kind} accepted original retains exact reference proof and publishes under its strict source head`, async () => {
  const f = await fixture(kind);
  try {
    const requests = ports(f); assert.equal((await run(f)).status, "completed"); assertOriginal(f); assert.equal(requests.length, 3);
    const budget = model3dRecoveryBudgets(f), job = f.readJob(), media = [...f.mediaMap.keys()];
    // A subsequent invocation obtains a fresh current source head; it does not
    // reuse the old request-local publication witness or expired generation grant.
    f.refreshHead(); globalThis.fetch = deny;
    assert.equal((await run(f)).status, "completed"); assertOriginal(f);
    assert.deepEqual(model3dRecoveryBudgets(f), budget); assert.deepEqual(f.readJob(), job); assert.deepEqual([...f.mediaMap.keys()], media);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("reference recovery with a lost final acknowledgement returns only its exact published pair", async () => {
  const f = await fixture();
  try {
    const requests = ports(f), batch = f.env.DB.batch.bind(f.env.DB); let lost = false;
    f.env.DB.batch = async statements => {
      const final = statements.some(statement => /UPDATE document_jobs SET status='completed'/u.test(statement.sql));
      const value = await batch(statements); if (final && !lost) { lost = true; throw Error("synthetic_lost_ack"); } return value;
    };
    assert.equal((await run(f)).status, "completed"); assert(lost); assertOriginal(f); assert.equal(requests.length, 3);
  } finally { globalThis.fetch = deny; f.close(); }
});

for (const mutation of ["owner", "sha", "reference_id", "copied_block", "rights", "expires_at"])
  test(`changed ${mutation} after original status read denies further retrieval and preserves held liability`, async () => {
    const f = await fixture();
    try {
      const budget = model3dRecoveryBudgets(f), requests = ports(f, { onRequest(_url, count) {
        if (count === 1) f.sqlite.prepare(`UPDATE reference_recovery_witness SET ${mutation}=?`).run(mutation === "expires_at" ? "2000-01-01T00:00:00.000Z" : "changed");
      } });
      await assert.rejects(run(f)); assert.equal(requests.length, 1); assert.deepEqual(model3dRecoveryBudgets(f), budget);
      assert.equal(f.readJob().status, "failed"); assert.equal(f.mediaMap.size, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n, 0);
    } finally { globalThis.fetch = deny; f.close(); }
  });

test("an initially expired reference witness refuses before any provider read or lease", async () => {
  const f = await fixture();
  try {
    const budget = model3dRecoveryBudgets(f), requests = ports(f);
    f.sqlite.exec("UPDATE reference_recovery_witness SET expires_at='2000-01-01T00:00:00.000Z'");
    await assert.rejects(run(f)); assert.equal(requests.length, 0); assert.deepEqual(model3dRecoveryBudgets(f), budget);
    assert.equal(JSON.parse(f.readJob().result_json).outputModel3dRecovery, undefined);
  } finally { globalThis.fetch = deny; f.close(); }
});

test("pending image original remains one status GET with unchanged call, hold and image source", async () => {
  const f = await fixture();
  try {
    const budget = model3dRecoveryBudgets(f), source = f.sqlite.prepare("SELECT * FROM reference_recovery_witness").get(), requests = ports(f, { pending: true });
    assert.equal((await run(f)).status, "pending"); assert.equal(requests.length, 1);
    assert.deepEqual(model3dRecoveryBudgets(f), budget); assert.deepEqual(f.sqlite.prepare("SELECT * FROM reference_recovery_witness").get(), source);
    assert.equal(f.readJob().status, "failed"); assert.equal(f.mediaMap.size, 0);
  } finally { globalThis.fetch = deny; f.close(); }
});

for (const change of ["extra-event", "private-body"]) test(`post-publication ${change} does not gain authority from the recovery's own event pair`, async () => {
  const f = await fixture();
  try {
    ports(f); const batch = f.env.DB.batch.bind(f.env.DB); let changed = false;
    f.env.DB.batch = async statements => {
      const final = statements.some(statement => /UPDATE document_jobs SET status='completed'/u.test(statement.sql));
      const value = await batch(statements);
      if (final && !changed) {
        changed = true;
        if (change === "extra-event") await appendAuditEvent(f.env, f.job.stream_id, "user", "UnrelatedWitnessChanged", { synthetic: true });
        else f.sqlite.exec("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.extra','changed') WHERE private_event_id IN(SELECT event_id FROM events WHERE type='GenerationUsageRecorded')");
        throw Error("synthetic_lost_ack_after_change");
      }
      return value;
    };
    await assert.rejects(run(f)); assert(changed);
    // The already committed outcome remains historical fact; rejecting a stale
    // return does not undo publication, settle twice, create another call or refund.
    assertOriginal(f);
  } finally { globalThis.fetch = deny; f.close(); }
});
