import { outputAssertionStatements, type OutputOperationSlot, type OutputScope } from "./output-requirements-ledger.ts";
import { settleDocumentGenerationBudgets } from "./pilot-policy.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";

/** Called only by the live Scene adapter's before-dispatch failure branch.
 * Missing responses, cancellation, expired leases and provider errors cannot
 * select this branch. The caller must reject any attempt already dispatched.
 * This source-free witness survives erasure; it never refunds the call slot. */
export async function recordOutputSceneLocalStop(env: WorkerEnv, input: {
  job: DocumentJobRow; scope: OutputScope; slot: OutputOperationSlot; billingOwner: string;
  bindingHash: string; attempt: ProviderAttemptPreflight;
}) {
  const { job, scope, slot, attempt } = input;
  if (scope.kind !== "personal" || attempt.model !== "gpt-5.6-terra" || attempt.logicalCallKey !== "planning:0:initial"
    || !/^forma-scene-[a-f0-9-]{36}$/u.test(attempt.clientRequestId) || !/^[a-f0-9]{64}$/u.test(attempt.requestDigest ?? "")
    || !/^[a-f0-9]{64}$/u.test(input.bindingHash) || slot.maximumCalls !== 1 || slot.attemptOrdinal !== 0 || slot.previousSlotId) return false;
  const at = new Date().toISOString();
  const witness = { version: "scene-local-stop-v1", disposition: "not_submitted", jobId: job.job_id,
    correlationId: job.correlation_id, attemptCount: job.attempt_count, leaseExpiresAt: job.lease_expires_at,
    scopeKey: slot.scopeKey, grantId: slot.grantId, slotId: slot.slotId, callKey: attempt.logicalCallKey,
    clientRequestId: attempt.clientRequestId, requestDigest: attempt.requestDigest, routeDigest: slot.routeDigest,
    sceneCostBindingHash: input.bindingHash, provider: "openai", model: attempt.model, recordedAt: at };
  // Existing allowance accounting uses rejected for a definitively uncharged
  // request. completionStatus and the separate witness distinguish this LOCAL
  // refusal from a provider response. No response ID or provider usage is minted.
  const receipt = { clientRequestId: attempt.clientRequestId, provider: "openai", operation: "planning", model: attempt.model,
    unitId: attempt.logicalCallKey, status: "rejected", completionStatus: "not_submitted", requestDigest: attempt.requestDigest,
    incompleteReason: "scene_local_pre_dispatch_stop", costMicrousd: 0 };
  const authority = { sql: `EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.correlation_id=? AND job.attempt_count=?
      AND job.status='running' AND job.lease_expires_at=? AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.route_digest=? AND slot.maximum_calls=1
      AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL AND EXISTS(SELECT 1 FROM output_plan_revisions plan WHERE plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id AND plan.scope_kind='personal')
      AND slot.token_reservation_id=? AND slot.cost_reservation_id=? AND grant_row.actor_user_id=? AND grant_row.payer_user_id=?
      AND json_extract(job.request_json,'$.artifactKind')='scene' AND json_extract(job.request_json,'$.productionMode')='manual'
      AND json_extract(job.request_json,'$.outputScene.costPreview.bindingHash')=?
      AND json_extract(job.request_json,'$.sceneCostConsent.bindingHash')=?
      AND json_extract(job.request_json,'$.sceneCostConsent.confirmed')=1
      AND json_type(job.result_json,'$.sceneDispatchStop') IS NULL
      AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(job.result_json,'$.providerSubmissions'),'{}')) receipt
        WHERE receipt.key<>? OR COALESCE(json_extract(receipt.value,'$.status'),'pending')<>'pending'
          OR json_extract(receipt.value,'$.providerRequestId') IS NOT NULL OR json_extract(receipt.value,'$.responseRef') IS NOT NULL
          OR json_extract(receipt.value,'$.responseReceivedAt') IS NOT NULL OR json_extract(receipt.value,'$.costMicrousd') IS NOT NULL))`,
    bindings: [job.job_id, scope.actorUserId, job.stream_id, job.correlation_id, job.attempt_count, job.lease_expires_at,
      slot.scopeKey, slot.slotId, slot.grantId, slot.routeDigest, slot.tokenReservationId, slot.costReservationId,
      scope.actorUserId, input.billingOwner, input.bindingHash, input.bindingHash, attempt.clientRequestId] };
  const pending = { sql: `EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=?
    AND client_request_id=? AND request_digest=? AND stage_key='planning:0:initial' AND provider='openai' AND model='gpt-5.6-terra'
    AND status='pending' AND used_microusd IS NULL AND provider_response_id IS NULL)
    AND (SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=1`,
    bindings: [slot.scopeKey, slot.slotId, attempt.logicalCallKey, attempt.clientRequestId, attempt.requestDigest!, slot.scopeKey, slot.slotId] };
  try {
    await env.DB.batch([
      ...[authority, pending].flatMap(assertion => outputAssertionStatements(env, assertion)),
      env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),?),updated_at=? WHERE job_id=? AND correlation_id=?")
        .bind(JSON.stringify({ sceneDispatchStop: witness, providerSubmissions: { [attempt.clientRequestId]: receipt },
          generationReceipt: { actual_provider_call_count: 0, source_transmission_status: "not_transmitted", provider_request_status: "not_submitted" } }), at, job.job_id, job.correlation_id),
      ...outputAssertionStatements(env, { sql: "changes()=1" }),
      env.DB.prepare("UPDATE output_provider_calls SET status='rejected',used_microusd=0,settled_at=? WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=? AND request_digest=? AND status='pending' AND used_microusd IS NULL")
        .bind(at, slot.scopeKey, slot.slotId, attempt.logicalCallKey, attempt.clientRequestId, attempt.requestDigest!),
      ...outputAssertionStatements(env, { sql: "changes()=1" }),
    ]);
  } catch { return false; }
  // The witness and zero-cost ledger disposition are atomic. If this next step
  // loses its acknowledgement, existing source-free reconciliation can replay it.
  await settleDocumentGenerationBudgets(env, input.billingOwner, { reservationId: slot.tokenReservationId,
    costReservationId: slot.costReservationId, reason: "scene_verified_pre_dispatch_stop" });
  return true;
}

/** Read a historical local-stop certificate, not permission for another call.
 * Rechecks its original job/slot/grant/call and source-free receipt. The original
 * lease is historical here; only the writer above can certify it while live. */
export async function readOutputSceneLocalStop(env: WorkerEnv, job: DocumentJobRow, actorId: string, payerId: string) {
  let checkpoint: Record<string, unknown>;
  try { checkpoint = JSON.parse(job.result_json || "{}"); } catch { return null; }
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return null;
  const stop = checkpoint.sceneDispatchStop as Record<string, unknown> | undefined;
  if (!stop || stop.version !== "scene-local-stop-v1" || stop.disposition !== "not_submitted"
    || stop.jobId !== job.job_id || stop.correlationId !== job.correlation_id || stop.attemptCount !== job.attempt_count
    || stop.provider !== "openai" || stop.model !== "gpt-5.6-terra" || stop.callKey !== "planning:0:initial"
    || typeof stop.clientRequestId !== "string" || typeof stop.requestDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(stop.requestDigest) || typeof stop.recordedAt !== "string" || typeof stop.leaseExpiresAt !== "string"
    || !Number.isFinite(Date.parse(stop.recordedAt)) || !(Date.parse(stop.recordedAt) < Date.parse(stop.leaseExpiresAt))) return null;
  const guard = { sql: `EXISTS(SELECT 1 FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_provider_calls call ON call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.correlation_id=? AND job.attempt_count=?
      AND grant_row.actor_user_id=? AND grant_row.payer_user_id=? AND EXISTS(SELECT 1 FROM output_plan_revisions plan WHERE plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id AND plan.scope_kind='personal')
      AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.route_digest=? AND slot.maximum_calls=1
      AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
      AND json_extract(job.request_json,'$.artifactKind')='scene' AND json_extract(job.request_json,'$.productionMode')='manual'
      AND json_extract(job.request_json,'$.outputScene.costPreview.bindingHash')=?
      AND json_extract(job.request_json,'$.sceneCostConsent.bindingHash')=? AND json_extract(job.request_json,'$.sceneCostConsent.confirmed')=1
      AND json_extract(job.result_json,'$.sceneDispatchStop')=?
      AND call.call_key='planning:0:initial' AND call.stage_key='planning:0:initial' AND call.provider='openai' AND call.model='gpt-5.6-terra'
      AND call.client_request_id=? AND call.request_digest=? AND call.status='rejected' AND call.used_microusd=0 AND call.provider_response_id IS NULL
      AND (SELECT COUNT(*) FROM output_provider_calls other WHERE other.scope_key=slot.scope_key AND other.slot_id=slot.slot_id)=1
      AND (SELECT COUNT(*) FROM json_each(json_extract(job.result_json,'$.providerSubmissions')))=1
      AND EXISTS(SELECT 1 FROM json_each(json_extract(job.result_json,'$.providerSubmissions')) receipt WHERE receipt.key=call.client_request_id
        AND json_extract(receipt.value,'$.clientRequestId')=call.client_request_id AND json_extract(receipt.value,'$.requestDigest')=call.request_digest
        AND json_extract(receipt.value,'$.provider')=call.provider AND json_extract(receipt.value,'$.model')=call.model
        AND json_extract(receipt.value,'$.operation')='planning' AND json_extract(receipt.value,'$.unitId')=call.stage_key
        AND json_extract(receipt.value,'$.status')='rejected' AND json_extract(receipt.value,'$.completionStatus')='not_submitted'
        AND json_extract(receipt.value,'$.incompleteReason')='scene_local_pre_dispatch_stop' AND json_extract(receipt.value,'$.costMicrousd')=0
        AND json_extract(receipt.value,'$.providerRequestId') IS NULL AND json_extract(receipt.value,'$.responseRef') IS NULL
        AND json_extract(receipt.value,'$.responseReceivedAt') IS NULL))`,
    bindings: [job.job_id, actorId, job.stream_id, job.correlation_id, job.attempt_count, actorId, payerId,
      String(stop.scopeKey), String(stop.slotId), String(stop.grantId), String(stop.routeDigest),
      String(stop.sceneCostBindingHash), String(stop.sceneCostBindingHash), JSON.stringify(stop), stop.clientRequestId, stop.requestDigest] };
  const valid = await env.DB.prepare(`SELECT (${guard.sql}) AS valid`).bind(...guard.bindings).first<{ valid: number }>();
  return valid?.valid === 1 ? { stoppedRequestId: stop.clientRequestId, guard } : null;
}
