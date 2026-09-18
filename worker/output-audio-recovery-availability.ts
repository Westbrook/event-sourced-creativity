import { readOutputAudioPayload } from "./output-audio-execution.ts";
import { invalidProviderSubmissions } from "../src/model/provider-submission.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputScope, OutputOperationSlot } from "./output-requirements-ledger.ts";

/** Advisory affordance only. Actual recovery revalidates source/rights, exact
 * retained envelopes, original call identities and publication custody. */
export async function outputAudioRecoveryAvailable(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow){
 try{
  const request=JSON.parse(job.request_json??"{}"),cp=JSON.parse(job.result_json??"{}");
  if(scope.kind!=="personal"||scope.actorUserId!==scope.ownerUserId||scope.contextId||scope.organizationId||scope.projectAccessId
   ||job.status!=="failed"||job.owner_id!==scope.actorUserId||job.stream_id!==`creative:${scope.ownerUserId}`||job.document_id!==scope.documentId
   ||job.kind!=="render_document"||job.source_surface!=="outputs"||slot.scopeKey!==scope.key||slot.jobId!==job.job_id
   ||slot.attemptOrdinal!==0||slot.previousSlotId!==null||!["failed","uncertain"].includes(slot.status)
   ||!readOutputAudioPayload(request)||invalidProviderSubmissions(cp)||cp.providerSubmissionLegacyUncertain===true
   ||!cp.outputAudioRequest||cp.audioProviderSubmission!=="confirmed"||!cp.providerJobId||!cp.artifactPlan)return false;
  return Boolean(await env.DB.prepare(`SELECT 1 AS available FROM document_jobs job
   JOIN output_operation_slots slot ON slot.job_id=job.job_id AND slot.scope_key=? AND slot.slot_id=?
   JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   JOIN output_provider_calls media ON media.scope_key=slot.scope_key AND media.slot_id=slot.slot_id AND media.call_key='audio:initial'
   JOIN private_content source ON source.content_id=json_extract(job.result_json,'$.generationReceipt.input_ref')
   WHERE job.job_id=? AND job.owner_id=? AND job.result_json IS ? AND job.request_json IS ? AND job.status='failed'
    AND job.attempt_count BETWEEN 1 AND 2 AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND (json_type(job.result_json,'$.outputAudioRecovery') IS NULL OR json_extract(job.result_json,'$.outputAudioRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND grant_row.actor_user_id=job.owner_id AND grant_row.context_id IS NULL AND grant_row.status IN('authorized','active','completed')
    AND media.stage_key='audio:initial' AND media.provider='fal' AND media.model='fal-ai/stable-audio-3/medium/text-to-audio' AND media.status IN('uncertain','settled')
    AND media.client_request_id=json_extract(job.result_json,'$.outputAudioRequest.clientRequestId')
    AND media.request_digest=json_extract(job.result_json,'$.outputAudioRequest.requestDigest') AND media.provider_response_id=json_extract(job.result_json,'$.providerJobId')
    AND source.owner_id=job.owner_id AND source.kind='document-artifact-input' AND source.redacted_at IS NULL AND source.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=source.content_id)
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots next WHERE next.scope_key=slot.scope_key AND next.previous_slot_id=slot.slot_id)
    AND (SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=slot.scope_key AND slot_id=slot.slot_id) BETWEEN 2 AND 3`)
   .bind(scope.key,slot.slotId,job.job_id,scope.actorUserId,job.result_json,job.request_json).first());
 }catch{return false;}
}
