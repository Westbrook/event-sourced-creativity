import { readOutputModel3dPayload, verifyModel3dPreparedReceipt } from "./output-model3d-execution.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { OutputOperationSlot, OutputScope } from "./output-requirements-ledger.ts";

/** Read-only UI advice, not recovery authority. The recovery service independently
 * requires every current source, private-body, original-call and reservation join. */
export async function outputModel3dRecoveryAvailable(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow): Promise<boolean> {
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.contextId !== null
    || scope.organizationId !== null || scope.projectAccessId !== null || job.status !== "failed"
    || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null || !["failed", "uncertain"].includes(slot.status)) return false;
  try {
    const offer = await readOutputModel3dPayload(JSON.parse(job.request_json));
    if (!offer || offer.contract.reference !== null || offer.preview.sourceFilesTransferred !== 0
      || offer.preview.requestId !== job.job_id || offer.preview.actorUserId !== scope.actorUserId
      || offer.preview.documentId !== scope.documentId || offer.preview.projectId !== scope.projectId) return false;
    const metadata = JSON.parse(job.result_json ?? "{}");
    const prepared = await verifyModel3dPreparedReceipt(offer, metadata.model3dInputReceipt);
    return Boolean(await env.DB.prepare(`SELECT 1 AS available FROM document_jobs job
      JOIN output_operation_slots slot ON slot.job_id=job.job_id AND slot.scope_key=? AND slot.slot_id=?
      JOIN output_provider_calls call ON call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id
      JOIN json_each(job.result_json,'$.providerSubmissions') receipt ON receipt.key=call.client_request_id
      JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      WHERE job.job_id=? AND job.owner_id=? AND job.document_id=? AND job.status='failed' AND job.kind='render_document' AND job.source_surface='outputs'
        AND job.request_json=? AND job.result_json=? AND job.attempt_count=1 AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND json_type(job.result_json,'$.outputModel3dStop') IS NULL
        AND (json_type(job.result_json,'$.outputModel3dRecovery') IS NULL
          OR (json_extract(job.result_json,'$.outputModel3dRecovery.version')='output-model3d-recovery-v1'
            AND json_extract(job.result_json,'$.outputModel3dRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
        AND slot.status IN('failed','uncertain') AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
        AND slot.maximum_calls=1 AND slot.provider='fal' AND slot.model=?
        AND grant_row.actor_user_id=job.owner_id AND grant_row.payer_user_id=job.owner_id AND grant_row.context_id IS NULL
        AND grant_row.status IN('authorized','active','completed')
        AND call.call_key='model3d:initial' AND call.stage_key='model3d:initial' AND call.provider='fal' AND call.model=slot.model
        AND call.status IN('uncertain','settled') AND call.request_digest=?
        AND length(call.provider_response_id) BETWEEN 1 AND 200 AND lower(call.provider_response_id) NOT IN('pending','unknown','submitted')
        AND json_extract(receipt.value,'$.clientRequestId')=call.client_request_id
        AND json_extract(receipt.value,'$.providerRequestId')=call.provider_response_id
        AND json_extract(receipt.value,'$.provider')='fal' AND json_extract(receipt.value,'$.operation')='model3d'
        AND json_extract(receipt.value,'$.model')=call.model AND json_extract(receipt.value,'$.status') IN('accepted','completed')
        AND (SELECT COUNT(*) FROM output_provider_calls other WHERE other.scope_key=slot.scope_key AND other.slot_id=slot.slot_id)=1
        AND (SELECT COUNT(*) FROM json_each(job.result_json,'$.providerSubmissions'))=1`)
      .bind(scope.key, slot.slotId, job.job_id, scope.actorUserId, scope.documentId, job.request_json, job.result_json, prepared.model, prepared.requestDigest).first());
  } catch {
    // Missing or malformed original evidence never exposes a recovery control.
    return false;
  }
}
