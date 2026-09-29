import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, sha } from "./helpers/model3d-native-execution-fixture.mjs";
import { captureOutputModel3dRecoveryCheckpoint as capture } from "../worker/output-model3d-recovery-checkpoint.ts";
import { outputModel3dRecoveryAssertions } from "../worker/output-model3d-recovery-lease.ts";

const at = Date.parse("2026-09-15T12:00:00.000Z");
async function original(kind = null) {
  const f = await fixture(kind);
  const scope = { kind: "personal", key: "scope", actorUserId: "owner", ownerUserId: "owner", projectId: "project", documentId: "document", contextId: null, organizationId: null, projectAccessId: null };
  const slot = { scopeKey: "scope", slotId: "slot", grantId: "grant", planRevisionId: "plan", targetId: "target", targetContractDigest: "a".repeat(64), routeDigest: "e".repeat(64),
    sourceDigest: f.preview.sourceDigest, jobId: f.preview.requestId, status: "uncertain", attemptOrdinal: 0, previousSlotId: null,
    maximumCalls: 1, maximumTokens: 1, maximumMicrousd: f.preview.maximumMicrousd, provider: "fal", model: f.preview.model, tokenReservationId: "token", costReservationId: "cost" };
  const execution = Object.fromEntries(["scopeKey", "slotId", "grantId", "planRevisionId", "targetId", "targetContractDigest", "sourceDigest"].map(key => [key, slot[key]]));
  const submission = { clientRequestId: "forma-model3d-original", provider: "fal", operation: "model3d", model: f.preview.model, status: "accepted", providerRequestId: "original-provider" };
  const request = { ...f.payload, outputExecution: execution, model3dCostConsent: { ...f.preview, confirmed: true, providerTransferConfirmed: true } };
  const result = { artifactId: "artifact", artifactKind: "model3d", outputExecution: execution, model3dInputReceipt: f.receipt,
    providerSubmissions: { [submission.clientRequestId]: submission }, reservationId: "token", costReservationId: "cost", costReservationPeriod: "2026-09" };
  const job = { job_id: slot.jobId, owner_id: "owner", stream_id: "creative:owner", document_id: "document", correlation_id: slot.jobId,
    kind: "render_document", source_surface: "outputs", status: "failed", attempt_count: 1, output_slot_id: "slot", lease_expires_at: null,
    expires_at: "2026-10-01T00:00:00.000Z", request_json: JSON.stringify(request), result_json: JSON.stringify(result) };
  const grant = { scope_key: "scope", grant_id: "grant", actor_user_id: "owner", payer_user_id: "owner", context_id: null, status: "active" };
  const call = { scope_key: "scope", slot_id: "slot", call_key: "model3d:initial", stage_key: "model3d:initial", client_request_id: submission.clientRequestId,
    provider_response_id: submission.providerRequestId, request_digest: f.receipt.requestDigest, provider: "fal", model: f.preview.model,
    status: "uncertain", reserved_microusd: f.preview.maximumMicrousd, used_microusd: null };
  const common = { owner_id: "owner", stream_id: job.stream_id, correlation_id: job.correlation_id, operation: "document-render:model3d", period: "2026-09" };
  return { scope, slot, job, grant, calls: [call], current: { sourceDigest: slot.sourceDigest, requirementsDigest: f.preview.requirementsDigest, retentionExpiresAt: "2026-09-30T00:00:00.000Z" },
    token: { ...common, reservation_id: "token", status: "active", reserved_tokens: 1, used_tokens: null },
    cost: { ...common, reservation_id: "cost", status: "executing", reserved_microusd: f.preview.maximumMicrousd, used_microusd: null } };
}
function resultChange(f, change) { const result = JSON.parse(f.job.result_json); change(result); f.job.result_json = JSON.stringify(result); }
async function refused(change) { const f = await original(); change(f); const before = structuredClone(f); await assert.rejects(capture(f, at), /output_model3d|request_not_authorized/); assert.deepEqual(f, before); }
function requestChange(f, change) { const request = JSON.parse(f.job.request_json); change(request); f.job.request_json = JSON.stringify(request); }
function receiptDigest(receipt) {
  return sha(JSON.stringify({ model: receipt.model, parameters: receipt.parameters, referenceInputs: receipt.referenceInputs }, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
}
async function imageRefused(change, message) {
  const f = await original("image"); change(f); const before = structuredClone(f);
  await assert.rejects(capture(f, at), /output_model3d|request_not_authorized/, message); assert.deepEqual(f, before, message);
}

test("single-image accepted originals retain exact input, identity and holds without network or upload", async () => {
  const priorFetch = globalThis.fetch; globalThis.fetch = () => { throw Error("no network"); };
  try {
    for (const kind of ["image", "saved-model-view"]) {
      const f = await original(kind), before = structuredClone(f), result = await capture(f, at);
      assert.equal(result.providerRequestId, "original-provider"); assert.equal(result.clientRequestId, "forma-model3d-original");
      assert.equal(result.jobId, before.job.job_id); assert.deepEqual(result.execution, JSON.parse(before.job.request_json).outputExecution);
      assert.equal(result.offer.preview.sourceFilesTransferred, 1); assert.equal(result.offer.preview.sourceKind, kind);
      assert.equal(result.prepared.usedReferencePixels, true); assert.equal(result.prepared.referenceInputs.length, 1);
      assert.deepEqual(structuredClone(result.prepared.referenceInputs), JSON.parse(before.job.result_json).model3dInputReceipt.referenceInputs);
      assert.equal(result.offer.preview.maximumMicrousd, 400000); assert.equal(result.settled, false);
      assert.equal(result.reservationId, before.token.reservation_id); assert.equal(result.costReservationId, before.cost.reservation_id);
      assert.deepEqual(f, before);
    }
  } finally { globalThis.fetch = priorFetch; }
});

test("single-image receipts bind reference fields even when a changed receipt has a matching digest", async () => {
  const changes = {
    sha256: value => { value.sha256 = "0".repeat(64); },
    blockId: value => { value.blockId = "foreign-copy"; },
    referenceId: value => { value.referenceId = "foreign-reference"; },
    mimeType: value => { value.mimeType = "image/jpeg"; },
    byteLength: value => { value.byteLength += 1; },
    index: value => { value.index = 1; },
    transport: value => { value.transport = "url"; },
  };
  for (const [key, change] of Object.entries(changes)) await imageRefused(f => resultChange(f, result => {
    change(result.model3dInputReceipt.referenceInputs[0]);
    result.model3dInputReceipt.requestDigest = receiptDigest(result.model3dInputReceipt);
    f.calls[0].request_digest = result.model3dInputReceipt.requestDigest;
  }), key);
  for (const change of [receipt => { receipt.referenceInputs = []; }, receipt => { receipt.referenceInputs.push({ ...receipt.referenceInputs[0], index: 1 }); },
    receipt => { receipt.usedReferencePixels = false; }]) await imageRefused(f => resultChange(f, result => {
      change(result.model3dInputReceipt); result.model3dInputReceipt.requestDigest = receiptDigest(result.model3dInputReceipt);
      f.calls[0].request_digest = result.model3dInputReceipt.requestDigest;
    }));
});

test("single-image offer, source-file count and separate transfer consent cannot drift", async () => {
  for (const change of [request => { request.outputModel3d.reference.selection.sha256 = "0".repeat(64); },
    request => { request.outputModel3d.reference.copiedBlockId = "foreign-copy"; },
    request => { request.outputModel3d.reference.selection.referenceId = "foreign-reference"; },
    request => { request.model3dPreparation.references[0].mimeType = "image/jpeg"; },
    request => { request.model3dPreparation.references[0].byteLength += 1; },
    request => { request.model3dPreparation.references.push({ ...request.model3dPreparation.references[0] }); },
    request => { request.model3dCostPreview.sourceFilesTransferred = 0; request.model3dCostConsent.sourceFilesTransferred = 0; },
    request => { request.model3dCostPreview.sourceFilesTransferred = 2; request.model3dCostConsent.sourceFilesTransferred = 2; },
    request => { request.model3dCostConsent.providerTransferConfirmed = false; },
    request => { request.model3dCostConsent.referenceSha256 = "0".repeat(64); }]) await imageRefused(f => requestChange(f, change));
});

test("image originals keep expired dispatch quotes and existing paid accounting without renewal", async () => {
  const f = await original("image"); requestChange(f, request => {
    request.model3dCostPreview.expiresAt = "2020-01-01T00:00:00.000Z"; request.model3dCostConsent.expiresAt = request.model3dCostPreview.expiresAt;
  });
  const held = structuredClone(f), captured = await capture(f, at);
  assert.equal(captured.offer.preview.expiresAt, "2020-01-01T00:00:00.000Z"); assert.equal(captured.expiresAt, f.current.retentionExpiresAt); assert.deepEqual(f, held);
  resultChange(f, result => Object.assign(result.providerSubmissions["forma-model3d-original"], { status: "completed", costMicrousd: 400000, inputTokens: 0, outputTokens: 0, totalTokens: 0 }));
  Object.assign(f.calls[0], { status: "settled", used_microusd: 400000 }); Object.assign(f.token, { status: "released", used_tokens: 0 }); Object.assign(f.cost, { status: "settled", used_microusd: 400000 });
  const settled = structuredClone(f); assert.equal((await capture(f, at)).settled, true); assert.deepEqual(f, settled);
  for (const change of [value => { value.cost.used_microusd = 0; }, value => { value.token.used_tokens = 1; }, value => { value.calls[0].used_microusd = 1; },
    value => { value.current.retentionExpiresAt = "2020-01-01T00:00:00.000Z"; }]) {
    const invalid = structuredClone(f); change(invalid); const before = structuredClone(invalid); await assert.rejects(capture(invalid, at)); assert.deepEqual(invalid, before);
  }
});

test("image evidence cannot admit a replacement, duplicate call or mismatched original request", async () => {
  for (const change of [f => { f.slot.attemptOrdinal = 1; f.slot.previousSlotId = "previous"; },
    f => { f.calls.push(structuredClone(f.calls[0])); }, f => { f.calls[0].provider_response_id = "another-original"; },
    f => { f.calls[0].request_digest = "0".repeat(64); }, f => { f.current.sourceDigest = "0".repeat(64); },
    f => resultChange(f, result => { result.providerSubmissions["forma-model3d-original"].status = "pending"; }),
    f => requestChange(f, request => {
      const replacement = { version: "model3d-mini-app-replacement-cost-v1", replacementCycleId: "a".repeat(64), previousSlotId: "previous",
        previousJobId: "model3d-" + "c".repeat(64), previousProviderRequestId: "previous-provider", priorHeldMicrousd: 400000, cumulativeMaximumMicrousd: 800000 };
      Object.assign(request.model3dCostPreview, replacement); Object.assign(request.model3dCostConsent, replacement); f.slot.attemptOrdinal = 1; f.slot.previousSlotId = "previous";
    })]) await imageRefused(change);
});

test('attempt ordinal retains strict numeric identity',async()=>{
  for(const ordinal of ['0','1',null,undefined]) await refused(f=>{f.slot.attemptOrdinal=ordinal;});
});

test("accepted original checkpoint is captured without IO, mutable aliases, or new identities", async () => {
  const priorFetch = globalThis.fetch; globalThis.fetch = () => { throw Error("no network"); };
  try {
    const f = await original(), before = structuredClone(f), pending = capture(f, at); f.calls[0].provider_response_id = "changed-after-capture";
    const result = await pending; assert.equal(result.providerRequestId, "original-provider"); assert.equal(result.clientRequestId, "forma-model3d-original");
    assert.equal(result.prepared.estimatedCostMicrousd, 400000); assert.equal(result.settled, false); assert.equal(result.expiresAt, before.current.retentionExpiresAt);
    assert(Object.isFrozen(result)); assert(Object.isFrozen(result.prepared)); assert.equal(result.requestJson, before.job.request_json); assert.equal(result.resultJson, before.job.result_json);
    const unchanged = await original(); await capture(unchanged, at); assert.deepEqual(unchanged, before);
  } finally { globalThis.fetch = priorFetch; }
});

test("pending/unknown/rejected or missing acceptance/input cannot become original retrieval authority", async () => {
  for (const status of ["pending", "unknown", "rejected"]) await refused(f => resultChange(f, r => { r.providerSubmissions["forma-model3d-original"].status = status; }));
  for (const key of ["model3dInputReceipt", "providerSubmissions", "outputExecution"]) await refused(f => resultChange(f, r => { delete r[key]; }));
  await refused(f => resultChange(f, r => { delete r.providerSubmissions["forma-model3d-original"].providerRequestId; }));
  await refused(f => { f.calls = []; });
});

test("foreign original/call/reservation/source joins and duplicate call are denied", async () => {
  for (const change of [f => { f.scope.actorUserId = "foreign"; }, f => { f.job.document_id = "foreign"; }, f => { f.slot.jobId = "foreign"; },
    f => { f.grant.payer_user_id = "foreign"; }, f => { f.calls[0].provider_response_id = "foreign"; }, f => { f.calls[0].client_request_id = "foreign"; },
    f => { f.calls[0].request_digest = "0".repeat(64); }, f => { f.calls[0].model = "foreign"; }, f => { f.calls[0].call_key = "model3d:retry"; },
    f => { f.calls.push(structuredClone(f.calls[0])); }, f => { f.cost.correlation_id = "foreign"; }, f => { f.token.period = "foreign"; },
    f => { f.current.sourceDigest = "0".repeat(64); }, f => { f.current.requirementsDigest = "0".repeat(64); },
    f => resultChange(f, r => { r.providerJobId = "foreign"; }), f => resultChange(f, r => { r.model3dInputReceipt.submittedPrompt += " changed"; })]) await refused(change);
});

test("canceled/revoked/expired original or retention and competing execution refuse without resetting", async () => {
  for (const change of [f => { f.job.status = "canceled"; }, f => { f.slot.status = "cancelled"; }, f => { f.grant.status = "revoked"; },
    f => { f.grant.status = "exceeded"; }, f => { f.job.attempt_count = 2; }, f => { f.slot.previousSlotId = "previous"; },
    f => { f.job.expires_at = "2020-01-01T00:00:00.000Z"; }, f => { f.current.retentionExpiresAt = "2020-01-01T00:00:00.000Z"; },
    f => { f.job.lease_expires_at = "2099-01-01T00:00:00.000Z"; }, f => resultChange(f, r => { r.outputModel3dStop = {}; })]) await refused(change);
});

test("expired dispatch preview is preserved rather than renewed; retained data must remain current", async () => {
  const f = await original(), request = JSON.parse(f.job.request_json); request.model3dCostPreview.expiresAt = "2020-01-01T00:00:00.000Z";
  request.model3dCostConsent.expiresAt = request.model3dCostPreview.expiresAt; f.job.request_json = JSON.stringify(request);
  const before = structuredClone(f), result = await capture(f, at); assert.equal(result.offer.preview.expiresAt, "2020-01-01T00:00:00.000Z"); assert.deepEqual(f, before);
});

test("already paid original requires exact zero-token released/positive-cost settled pair", async () => {
  const f = await original(); resultChange(f, r => Object.assign(r.providerSubmissions["forma-model3d-original"], { status: "completed", costMicrousd: 400000, inputTokens: 0, outputTokens: 0, totalTokens: 0 }));
  Object.assign(f.calls[0], { status: "settled", used_microusd: 400000 }); Object.assign(f.token, { status: "released", used_tokens: 0 }); Object.assign(f.cost, { status: "settled", used_microusd: 400000 });
  const before = structuredClone(f); assert.equal((await capture(f, at)).settled, true); assert.deepEqual(f, before);
  for (const change of [v => { v.token.status = "settled"; }, v => { v.cost.used_microusd = 0; }, v => { v.calls[0].used_microusd = 1; }, v => resultChange(v, r => { r.providerSubmissions["forma-model3d-original"].totalTokens = 1; })]) {
    const changed = structuredClone(f); change(changed); await assert.rejects(capture(changed, at));
  }
});

test("duplicate completed/acknowledged jobs are not admitted to the failed-original reader", async () => {
  await refused(f => { f.job.status = "completed"; f.job.notified_at = "2026-09-15T11:00:00.000Z"; });
  // Completed replay/ordinary ACK belong to the existing strict retained reader
  // and notification handler, not this failed-original checkpoint capture.
});

test("lease guards keep complete original joins as bounded independent SQL statements", async () => {
  const f = await original(), checkpoint = await capture(f, at), guards = outputModel3dRecoveryAssertions(f.scope, f.slot, f.job, checkpoint, checkpoint.expiresAt);
  assert.equal(guards.length, 12);
  for (const guard of guards) {
    assert.equal((guard.sql.match(/\?/gu) ?? []).length, guard.bindings.length);
    assert(guard.bindings.length <= 100); assert(!guard.bindings.includes(undefined));
    assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/iu.test(guard.sql));
  }
  const identity = guards.find(g => g.sql.includes("JOIN output_plan_revisions"));
  for (const fragment of ["job.status='failed'", "job.attempt_count=1", "job.request_json=?", "slot.attempt_ordinal=?", "slot.previous_slot_id IS ?",
    "slot.maximum_calls=1", "grant_row.payer_user_id=job.owner_id", "grant_row.status IN('authorized','active','completed')", "NOT EXISTS(SELECT 1 FROM project_resource_scopes", "plan.requirements_digest=?"]) assert(identity.sql.includes(fragment), fragment);
  const call = guards.find(g => g.sql.includes("JOIN json_each"));
  const attempt = guards.find(g => g.sql.includes("parent.attempt_ordinal=0"));
  assert(attempt.sql.includes("slot.attempt_ordinal=0"));
  assert(attempt.sql.includes("slot.previous_slot_id IS NULL"));
  assert(attempt.sql.includes("slot.attempt_ordinal=1"));
  assert.deepEqual(attempt.bindings, [f.job.job_id, f.scope.key, f.slot.slotId]);
  assert(call.sql.includes("call.provider_response_id=?")); assert(call.sql.includes("call.request_digest=?")); assert(call.sql.includes("COUNT(*) FROM output_provider_calls"));
  assert(call.sql.includes("IN('accepted','completed')")); assert(call.sql.includes("call.status IN('uncertain','settled')"));
  assert(!guards.some(g => g.sql.includes("result_json IS ?")), "full mutable result is CAS-bound only at claim, not across settlement");
  assert.equal(guards.at(-1).deadlineMs, Date.parse(checkpoint.expiresAt));
});

test("missing immutable checkpoint fields are refused before undefined SQL bindings", async () => {
  const f = await original(), checkpoint = await capture(f, at);
  for (const key of ["artifactId", "artifactKind", "outputExecution", "model3dInputReceipt", "reservationId", "costReservationId", "costReservationPeriod"]) {
    const damaged = JSON.parse(checkpoint.resultJson); delete damaged[key];
    assert.throws(() => outputModel3dRecoveryAssertions(f.scope, f.slot, f.job, { ...checkpoint, resultJson: JSON.stringify(damaged) }, checkpoint.expiresAt), /output_model3d_recovery_unavailable/);
  }
});

test("claim source keeps failed history, exact initial CAS, independent guards and no dispatch/reset writes", () => {
  const source = readFileSync(new URL("../worker/output-model3d-recovery-lease.ts", import.meta.url), "utf8");
  for (const required of ["outputModel3dRecoveryHistory[#]", "originalSubmission: checkpoint.submission", "priorStatus: job.status", "priorErrorCode: job.error_message",
    "priorCompletedAt: job.completed_at", "AND result_json IS ?", "outputModel3dRecoveryHistory'),0)<32", "changes()=1", "enteredAt + 120000"]) assert(source.includes(required), required);
  assert(!/\b(?:fetch|runDocumentJob|claimOutputProviderCall|reserveBudget|reserveCostBudget)\s*\(/u.test(source));
  assert(!/SET\s+(?:status|notified_at|attempt_count|request_json|correlation_id)\s*=/iu.test(source));
  assert(!/\b(?:INSERT|UPDATE)\s+(?:INTO\s+)?(?:output_provider_calls|output_execution_grants|budget_reservations|cost_budget_reservations)\b/iu.test(source));
  const capture = source.indexOf("const job = captureModel3dComparisonData(suppliedJob)"), firstRead = source.indexOf("const grantRows = await guardedRead");
  assert(capture >= 0 && firstRead >= 0 && capture < firstRead);
});
