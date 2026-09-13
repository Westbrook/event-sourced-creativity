import { preparePrivateContent } from "./private-content-storage.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot } from "./output-requirements-ledger.ts";
import { restoreOutputFalImageRequest, type OutputFalCapturedRequest } from "./output-fal-image-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

const digest = async (body:string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body))), byte=>byte.toString(16).padStart(2,"0")).join("");

/** Called only with the existing custody-guarded environment, after the original call claim.
 * Body inserts and the reference-only checkpoint commit in one guarded transaction. */
export async function retainOutputFalImageCheckpoint(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,scope:OutputScope,slot:OutputOperationSlot,request:OutputFalCapturedRequest,planning:Record<string,unknown>):Promise<void> {
  const captured=await restoreOutputFalImageRequest(request.contract,request.body,request.attempt.clientRequestId,request.attempt.requestDigest);
  if(job.owner_id!==user.userId||scope.actorUserId!==user.userId||slot.jobId!==job.job_id||job.kind!=="generate"
    ||job.document_id!==scope.documentId||job.output_slot_id!==slot.slotId)throw new OutputConflictError("output_fal_checkpoint_scope_mismatch",403);
  const planningBody=JSON.stringify(planning);
  if(!planningBody||new TextEncoder().encode(planningBody).byteLength>262_144)throw new OutputConflictError("output_fal_checkpoint_too_large",422);
  const requestHash=await digest(captured.body),planningHash=await digest(planningBody);
  const requestContent=await preparePrivateContent(env,user.userId,"prompt",captured.body,user.projectExecution);
  const planningContent=await preparePrivateContent(env,user.userId,"provider-output",planningBody,user.projectExecution);
  const checkpoint={version:"output-fal-checkpoint-v1",clientRequestId:captured.attempt.clientRequestId,requestDigest:captured.attempt.requestDigest,
    stage:"image:initial",provider:"fal",model:captured.contract.model,requestRef:requestContent.contentId,requestSha256:requestHash,
    planningRef:planningContent.contentId,planningSha256:planningHash,
    expiresAt:requestContent.expiresAt<planningContent.expiresAt?requestContent.expiresAt:planningContent.expiresAt};
  const serialized=JSON.stringify(checkpoint),now=new Date().toISOString();
  const call={sql:`EXISTS(SELECT 1 FROM output_provider_calls call JOIN output_operation_slots slot ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id
    WHERE call.scope_key=? AND call.slot_id=? AND call.call_key='image:initial' AND call.stage_key='image:initial'
      AND call.provider='fal' AND call.model=? AND call.client_request_id=? AND call.request_digest=?
      AND call.status='pending' AND call.provider_response_id IS NULL AND slot.job_id=? AND slot.route_digest=?
      AND slot.grant_id=? AND slot.source_digest=? AND slot.status IN('queued','running'))`,
    bindings:[scope.key,slot.slotId,captured.contract.model,captured.attempt.clientRequestId,captured.attempt.requestDigest,job.job_id,slot.routeDigest,slot.grantId,slot.sourceDigest]};
  const currentJob={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=?
    AND attempt_count=? AND status='running' AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND json_type(COALESCE(result_json,'{}'),'$.outputFalCheckpoint') IS NULL)`,
    bindings:[job.job_id,user.userId,job.stream_id,scope.documentId,job.correlation_id,job.attempt_count,now]};
  const retained=(content:{contentId:string;expiresAt:string},kind:string,body:string)=>({sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND redacted_at IS NULL AND expires_at=? AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,bindings:[content.contentId,user.userId,kind,body,content.expiresAt,now]});
  await env.DB.batch([
    ...outputAssertionStatements(env,call),...outputAssertionStatements(env,currentJob),
    ...requestContent.statements,...planningContent.statements,
    ...outputAssertionStatements(env,retained(requestContent,"prompt",captured.body)),
    ...outputAssertionStatements(env,retained(planningContent,"provider-output",planningBody)),
    env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.outputFalCheckpoint',json(?)),updated_at=? WHERE job_id=? AND owner_id=?`)
      .bind(serialized,now,job.job_id,user.userId),
    ...outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,'$.outputFalCheckpoint')=?)`,bindings:[job.job_id,user.userId,serialized]}),
  ]);
  // Keep the existing heartbeat's shared row in sync with this atomic write.
  job.result_json=JSON.stringify({...JSON.parse(job.result_json??"{}"),outputFalCheckpoint:checkpoint});
}
