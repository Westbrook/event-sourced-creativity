import { preparePrivateContent } from "./private-content-storage.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { captureStoryboardPlannerRequest } from "./output-storyboard-request.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import { MAX_STORYBOARD_ENVELOPE_BYTES, type StoryboardRawEnvelope } from "./output-storyboard-envelope.ts";

/** Called only through the existing guarded private environment after its exact
 * pending claim. A failed write leaves that claim unresolved, never free. */
export async function retainStoryboardPlannerRequestCheckpoint(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,captured:Awaited<ReturnType<typeof captureStoryboardPlannerRequest>>){
 if(scope.kind!=="personal"||scope.ownerUserId!==scope.actorUserId||job.owner_id!==scope.actorUserId||job.kind!=="render_document"
  ||job.document_id!==scope.documentId||slot.jobId!==job.job_id||job.output_slot_id!==slot.slotId)throw new OutputConflictError("output_storyboard_planner_checkpoint_scope",403);
 const body=await preparePrivateContent(env,scope.actorUserId,"prompt",captured.requestBody),now=new Date().toISOString();
 const checkpoint={version:"output-storyboard-planner-checkpoint-v1",clientRequestId:captured.attempt.clientRequestId,stage:"planning:0:initial",
  provider:"openai",model:captured.attempt.model,requestDigest:captured.requestDigest,requestRef:body.contentId,
  contract:captured.contract,expiresAt:[body.expiresAt,job.expires_at].sort()[0]};
 const raw=JSON.stringify(checkpoint);
 const claim:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM output_provider_calls paid JOIN output_operation_slots slot ON slot.scope_key=paid.scope_key AND slot.slot_id=paid.slot_id
  WHERE paid.scope_key=? AND paid.slot_id=? AND paid.call_key='planning:0:initial' AND paid.stage_key='planning:0:initial'
  AND paid.provider='openai' AND paid.model=? AND paid.client_request_id=? AND paid.request_digest=? AND paid.status='pending' AND paid.provider_response_id IS NULL
  AND slot.job_id=? AND slot.route_digest=? AND slot.grant_id=? AND slot.source_digest=? AND slot.status IN('queued','running'))`,
  bindings:[scope.key,slot.slotId,captured.attempt.model,captured.attempt.clientRequestId,captured.requestDigest,job.job_id,slot.routeDigest,slot.grantId,slot.sourceDigest]};
 const jobCurrent:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=?
  AND EXISTS(SELECT 1 FROM output_operation_slots relation WHERE relation.job_id=document_jobs.job_id AND relation.scope_key=? AND relation.slot_id=?)
  AND status='running' AND attempt_count=? AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND json_type(COALESCE(result_json,'{}'),'$.outputStoryboardPlannerCheckpoint') IS NULL)`,
  bindings:[job.job_id,scope.actorUserId,job.stream_id,scope.documentId,job.correlation_id,scope.key,slot.slotId,job.attempt_count,now,now]};
 await env.DB.batch([...outputAssertionStatements(env,claim),...outputAssertionStatements(env,jobCurrent),...body.statements,
  ...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='prompt' AND content=? AND redacted_at IS NULL AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",bindings:[body.contentId,scope.actorUserId,captured.requestBody,now]}),
  env.DB.prepare("UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.outputStoryboardPlannerCheckpoint',json(?)),updated_at=? WHERE job_id=? AND owner_id=?").bind(raw,now,job.job_id,scope.actorUserId),
  ...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,'$.outputStoryboardPlannerCheckpoint')=?)",bindings:[job.job_id,scope.actorUserId,raw]})]);
 job.result_json=JSON.stringify({...JSON.parse(job.result_json??"{}"),outputStoryboardPlannerCheckpoint:checkpoint});
}

/** Retain bounded original response bytes even when JSON/usage is malformed.
 * The checkpoint has no cost value or successful candidate assertion. A parsed
 * response may already have a settled financial checkpoint; that state grants
 * no private authority and all owner/job/lease/expiry predicates still apply. */
export async function retainStoryboardRawEnvelopeCheckpoint(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,envelope:StoryboardRawEnvelope){
 if(scope.kind!=="personal"||scope.ownerUserId!==scope.actorUserId||job.owner_id!==scope.actorUserId||job.kind!=="render_document"
  ||job.document_id!==scope.documentId||slot.jobId!==job.job_id||job.output_slot_id!==slot.slotId||envelope.version!=="output-storyboard-raw-envelope-v1"
  ||envelope.provider!=="openai"||envelope.model!=="gpt-5.6-terra"||!Number.isSafeInteger(envelope.retainedBytes)||envelope.retainedBytes<0||envelope.retainedBytes>MAX_STORYBOARD_ENVELOPE_BYTES
  ||typeof envelope.bodyBase64!=="string"||envelope.bodyBase64.length>Math.ceil(MAX_STORYBOARD_ENVELOPE_BYTES/3)*4||typeof envelope.complete!=="boolean"||typeof envelope.readFailed!=="boolean")throw new OutputConflictError("output_storyboard_raw_envelope_invalid",403);
 const raw=JSON.stringify(envelope),body=await preparePrivateContent(env,scope.actorUserId,"provider-response",raw),now=new Date().toISOString();
 const checkpoint=JSON.stringify({version:envelope.version,clientRequestId:envelope.clientRequestId,requestDigest:envelope.requestDigest,provider:envelope.provider,model:envelope.model,
  responseRef:body.contentId,retainedBytes:envelope.retainedBytes,complete:envelope.complete,readFailed:envelope.readFailed,httpStatus:envelope.httpStatus,expiresAt:[body.expiresAt,job.expires_at].sort()[0]});
 const claim:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM output_provider_calls paid JOIN output_operation_slots slot ON slot.scope_key=paid.scope_key AND slot.slot_id=paid.slot_id
  WHERE paid.scope_key=? AND paid.slot_id=? AND paid.call_key='planning:0:initial' AND paid.stage_key='planning:0:initial'
  AND paid.provider='openai' AND paid.model=? AND paid.client_request_id=? AND paid.request_digest=? AND paid.status IN('pending','uncertain','rejected','settled')
  AND slot.job_id=? AND slot.route_digest=? AND slot.grant_id=? AND slot.source_digest=? AND slot.status IN('queued','running'))`,
  bindings:[scope.key,slot.slotId,envelope.model,envelope.clientRequestId,envelope.requestDigest,job.job_id,slot.routeDigest,slot.grantId,slot.sourceDigest]};
 const jobCurrent:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=?
  AND EXISTS(SELECT 1 FROM output_operation_slots relation WHERE relation.job_id=document_jobs.job_id AND relation.scope_key=? AND relation.slot_id=?)
  AND status='running' AND attempt_count=? AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND json_type(COALESCE(result_json,'{}'),'$.outputStoryboardRawEnvelope') IS NULL
  AND json_extract(result_json,'$.outputStoryboardPlannerCheckpoint.clientRequestId')=? AND json_extract(result_json,'$.outputStoryboardPlannerCheckpoint.requestDigest')=?)`,
  bindings:[job.job_id,scope.actorUserId,job.stream_id,scope.documentId,job.correlation_id,scope.key,slot.slotId,job.attempt_count,now,now,envelope.clientRequestId,envelope.requestDigest]};
 await env.DB.batch([...outputAssertionStatements(env,claim),...outputAssertionStatements(env,jobCurrent),...body.statements,
  ...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND redacted_at IS NULL AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",bindings:[body.contentId,scope.actorUserId,raw,now]}),
  env.DB.prepare("UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.outputStoryboardRawEnvelope',json(?)),updated_at=? WHERE job_id=? AND owner_id=?").bind(checkpoint,now,job.job_id,scope.actorUserId),
  ...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,'$.outputStoryboardRawEnvelope')=?)",bindings:[job.job_id,scope.actorUserId,checkpoint]})]);
 job.result_json=JSON.stringify({...JSON.parse(job.result_json??"{}"),outputStoryboardRawEnvelope:JSON.parse(checkpoint)});
}
