import {parseVideoOutputContract} from "../src/model/output-video-contract.ts";
import {prepareOutputJobOutcomeStatements} from "./output-execution-control.ts";
import type {DocumentJobRow} from "./document-jobs-api.ts";
import type {WorkerEnv} from "./runtime.ts";
/** Stop local work, not the provider's invoice. Pending calls and reservations
 * remain unchanged. The tombstone withdraws every observed callback/write lease. */
export async function stopOutputVideoJob(env:WorkerEnv,actorUserId:string,job:DocumentJobRow){
 const request=JSON.parse(job.request_json) as Record<string,unknown>;
 if(job.kind!=="render_document"||request.artifactKind!=="video"||!Object.hasOwn(request,"outputVideo"))return null;
 if(!parseVideoOutputContract(request.outputVideo)||job.owner_id!==actorUserId||job.stream_id!==`creative:${actorUserId}`)throw Error("output_video_stop_unavailable");
 const identity=`job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=?
  AND job.kind='render_document' AND job.source_surface='outputs'
  AND slot.slot_id=? AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
  AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
  AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
  AND grant_row.actor_user_id=job.owner_id AND grant_row.context_id IS NULL
  AND json_extract(job.request_json,'$.outputExecution.scopeKey')=slot.scope_key
  AND json_extract(job.request_json,'$.outputExecution.slotId')=slot.slot_id
  AND json_extract(job.request_json,'$.outputVideo')=json_extract(?,'$.outputVideo')
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind IN('job','document') AND resource.resource_id IN(job.job_id,job.document_id))`;
 const from=`document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id`;
 const values=[job.job_id,actorUserId,job.stream_id,job.document_id,job.correlation_id,job.output_slot_id,job.request_json];
 const available=await env.DB.prepare(`SELECT job.status FROM ${from} WHERE ${identity}`).bind(...values).first<{status:string}>();
 if(!available)throw Error("output_video_stop_unavailable");
 if(available.status==="committing")return{error:"job_finalizing",status:409} as const;
 const now=new Date().toISOString(),patch=JSON.stringify({outputVideoStop:{version:"output-video-stop-v1",at:now,providerCancellation:"unconfirmed"},stage:"canceled",noAutomaticRetry:true,
  errorDetail:{code:"canceled_by_user",category:"canceled",scope:"request",action:"none",message:"Stopped · Charges retained",retryable:false},progressMessage:"Stopped · Charges retained"});
 const updated=env.DB.prepare(`UPDATE document_jobs SET status='canceled',result_json=json_patch(COALESCE(result_json,'{}'),?),error_message='canceled_by_user',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=?
  WHERE job_id=? AND owner_id=? AND status IN('queued','running') AND EXISTS(SELECT 1 FROM ${from} WHERE ${identity})`).bind(patch,now,now,now,job.job_id,actorUserId,...values);
 const result=await env.DB.batch([updated,...prepareOutputJobOutcomeStatements(env,job)]);
 const stopped=await env.DB.prepare(`SELECT document_jobs.*,(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?`).bind(job.job_id,actorUserId).first<DocumentJobRow>();
 return{job:stopped,stoppedCount:Number(result[0]?.meta.changes??0)};
}
