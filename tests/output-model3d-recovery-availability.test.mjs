import test from "node:test";
import assert from "node:assert/strict";
import { model3dRecoveryFixture, model3dRecoverySnapshot as snapshot } from "./helpers/output-model3d-recovery-fixture.mjs";
import { outputModel3dRecoveryAvailable } from "../worker/output-model3d-recovery-availability.ts";

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = () => { networkAttempts++; throw Error("Recovery availability must not contact any network or provider"); };
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });

function changeJson(f, column, change) {
  const value = JSON.parse(f.readJob()[column]); change(value);
  f.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(JSON.stringify(value), f.job.job_id);
}
const changeResult = (f, change) => changeJson(f, "result_json", change);
const changeRequest = (f, change) => changeJson(f, "request_json", change);

/** Synthetic admission rows only. Availability is advice; these tests do not
 * claim full recovery authority, source custody or provider acceptance. */
async function fixture(kind = "image", completed = false) {
  const f = await model3dRecoveryFixture({ referenceKind: kind });
  try {
    if (completed) {
      changeResult(f, result => Object.assign(result.providerSubmissions[f.provider.clientRequestId], {
        status: "completed", costMicrousd: 400000, inputTokens: 0, outputTokens: 0, totalTokens: 0,
      }));
      f.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=400000");
      f.sqlite.exec("UPDATE budget_reservations SET status='released',used_tokens=0");
      f.sqlite.exec("UPDATE cost_budget_reservations SET status='settled',used_microusd=400000");
    }
    return f;
  } catch (error) { f.close(); throw error; }
}

async function assertReadOnly(f, expected, suppliedJob = f.readJob()) {
  const before = snapshot(f), prepared = f.env.DB.prepare.bind(f.env.DB), batch = f.env.DB.batch;
  const media = f.env.MEDIA, statements = [];
  let writeAttempts = 0, mediaAttempts = 0;
  f.env.DB.prepare = sql => {
    statements.push(sql);
    if (!/^\s*SELECT\b/iu.test(sql)) { writeAttempts++; throw Error("Availability attempted a database write"); }
    return prepared(sql);
  };
  f.env.DB.batch = () => { writeAttempts++; throw Error("Availability attempted a database batch"); };
  f.env.MEDIA = new Proxy({}, { get() { mediaAttempts++; throw Error("Availability attempted a private-media read"); } });
  try {
    assert.equal(await outputModel3dRecoveryAvailable(f.env, f.scope, f.slot, suppliedJob), expected);
    assert.equal(writeAttempts, 0); assert.equal(mediaAttempts, 0);
    assert.deepEqual(snapshot(f), before);
    return statements;
  } finally { f.env.DB.prepare = prepared; f.env.DB.batch = batch; f.env.MEDIA = media; }
}

for (const kind of [null, "image", "saved-model-view"]) for (const completed of [false, true]) {
  test(`SQLite availability accepts exact original ${kind ?? "text"} ${completed ? "completed" : "accepted"} receipt without effects`, async () => {
    const f = await fixture(kind, completed);
    try {
      const statements = await assertReadOnly(f, true);
      assert.equal(statements.length, 1, "read-only advice is one actual SQLite query");
      assert.equal(f.readJob().status, "failed"); assert.equal(f.readJob().attempt_count, 1);
    } finally { f.close(); }
  });
}

const receiptChanges = [
  ["missing prepared input", result => { delete result.model3dInputReceipt; }],
  ["changed prompt", result => { result.model3dInputReceipt.submittedPrompt += " changed"; }],
  ["changed settings", result => { result.model3dInputReceipt.settings.seed = 7; }],
  ["changed image hash", result => { result.model3dInputReceipt.referenceInputs[0].sha256 = "0".repeat(64); }],
  ["changed copied block", result => { result.model3dInputReceipt.referenceInputs[0].blockId = "another-copy"; }],
  ["changed reference identity", result => { result.model3dInputReceipt.referenceInputs[0].referenceId = "another-reference"; }],
  ["changed image MIME", result => { result.model3dInputReceipt.referenceInputs[0].mimeType = "image/jpeg"; }],
  ["changed image length", result => { result.model3dInputReceipt.referenceInputs[0].byteLength++; }],
  ["missing image", result => { result.model3dInputReceipt.referenceInputs = []; }],
  ["extra image", result => { result.model3dInputReceipt.referenceInputs.push(structuredClone(result.model3dInputReceipt.referenceInputs[0])); }],
  ["denied pixel use", result => { result.model3dInputReceipt.usedReferencePixels = false; }],
  ["changed request digest", result => { result.model3dInputReceipt.requestDigest = "0".repeat(64); }],
];
for (const [name, change] of receiptChanges) test(`single-image recovery advice rejects ${name}`, async () => {
  const f = await fixture();
  try { changeResult(f, change); await assertReadOnly(f, false); } finally { f.close(); }
});

for (const count of [0, 2]) test(`single-image recovery advice rejects sourceFilesTransferred=${count}`, async () => {
  const f = await fixture();
  try {
    changeRequest(f, request => { request.model3dCostPreview.sourceFilesTransferred = count; request.model3dCostConsent.sourceFilesTransferred = count; });
    await assertReadOnly(f, false);
  } finally { f.close(); }
});

test("single-image original cannot be relabeled as a paid replacement", async () => {
  const f = await fixture();
  try {
    const replacement = { version: "model3d-mini-app-replacement-cost-v1", replacementCycleId: "e".repeat(64),
      previousSlotId: "previous-slot", previousJobId: "model3d-" + "f".repeat(64), previousProviderRequestId: "previous-provider", priorHeldMicrousd: 400000, cumulativeMaximumMicrousd: 800000 };
    changeRequest(f, request => { Object.assign(request.model3dCostPreview, replacement); Object.assign(request.model3dCostConsent, replacement); });
    Object.assign(f.slot, { attemptOrdinal: 1, previousSlotId: replacement.previousSlotId });
    assert.deepEqual(await assertReadOnly(f, false), [], "an image replacement envelope is invalid before database advice");
  } finally { f.close(); }
});

const joinChanges = [
  ["foreign grant actor", f => f.sqlite.exec("UPDATE output_execution_grants SET actor_user_id='foreign'")],
  ["foreign grant payer", f => f.sqlite.exec("UPDATE output_execution_grants SET payer_user_id='foreign'")],
  ["context grant", f => f.sqlite.exec("UPDATE output_execution_grants SET context_id='context'")],
  ["revoked grant", f => f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'")],
  ["different stored job owner", f => f.sqlite.exec("UPDATE document_jobs SET owner_id='foreign'")],
  ["different stored Document", f => f.sqlite.exec("UPDATE document_jobs SET document_id='foreign'")],
  ["wrong job kind", f => f.sqlite.exec("UPDATE document_jobs SET kind='generate'")],
  ["wrong source surface", f => f.sqlite.exec("UPDATE document_jobs SET source_surface='document'")],
  ["restarted job", f => f.sqlite.exec("UPDATE document_jobs SET attempt_count=2")],
  ["expired job", f => f.sqlite.exec("UPDATE document_jobs SET expires_at='2020-01-01T00:00:00.000Z'")],
  ["live execution lease", f => f.sqlite.exec("UPDATE document_jobs SET lease_expires_at='2099-01-01T00:00:00.000Z'")],
  ["different stored slot model", f => f.sqlite.exec("UPDATE output_operation_slots SET model='foreign'")],
  ["different stored slot attempt", f => f.sqlite.exec("UPDATE output_operation_slots SET attempt_ordinal=1,previous_slot_id=slot_id")],
  ["different stored call model", f => f.sqlite.exec("UPDATE output_provider_calls SET model='foreign'")],
  ["different stored call digest", f => f.sqlite.exec("UPDATE output_provider_calls SET request_digest='foreign'")],
  ["different provider response", f => f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='foreign'")],
  ["unknown provider response", f => f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='unknown'")],
  ["pending call", f => f.sqlite.exec("UPDATE output_provider_calls SET status='pending'")],
  ["wrong call stage", f => {
    f.sqlite.exec("INSERT INTO output_operation_routes SELECT scope_key,slot_id,'model3d:retry',provider,model,maximum_calls FROM output_operation_routes");
    f.sqlite.exec("UPDATE output_provider_calls SET stage_key='model3d:retry'");
  }],
  ["duplicate call", f => f.sqlite.exec("INSERT INTO output_provider_calls SELECT scope_key,slot_id,'second',client_request_id||'-second',request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,provider_response_id,created_at,settled_at FROM output_provider_calls")],
  ["pending submission", f => changeResult(f, result => { result.providerSubmissions[f.provider.clientRequestId].status = "pending"; })],
  ["mismatched submission identity", f => changeResult(f, result => { result.providerSubmissions[f.provider.clientRequestId].clientRequestId = "foreign"; })],
  ["duplicate submission", f => changeResult(f, result => { result.providerSubmissions.second = { ...result.providerSubmissions[f.provider.clientRequestId], clientRequestId: "second" }; })],
  ["stopped original", f => changeResult(f, result => { result.outputModel3dStop = {}; })],
  ["live recovery lease", f => changeResult(f, result => { result.outputModel3dRecovery = { version: "output-model3d-recovery-v1", expiresAt: "2099-01-01T00:00:00.000Z" }; })],
];
for (const [name, change] of joinChanges) test(`SQLite single-image availability enforces ${name} refusal without effects`, async () => {
  const f = await fixture();
  try { change(f); await assertReadOnly(f, false); } finally { f.close(); }
});

for (const column of ["request_json", "result_json"]) test(`SQLite availability refuses stale captured ${column}`, async () => {
  const f = await fixture();
  try {
    const captured = f.readJob();
    changeJson(f, column, value => { value.localChange = true; });
    await assertReadOnly(f, false, captured);
  } finally { f.close(); }
});
