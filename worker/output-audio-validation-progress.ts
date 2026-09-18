import { providerSubmissions, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { outputAssertionStatements } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Private validation is not part of the independent financial receipt. Keep
 * this monotonic delta behind the caller's guarded private environment without
 * replacing newer monetary evidence or any other provider call. */
export async function persistOutputAudioValidation(env:WorkerEnv,job:DocumentJobRow,patch:Record<string,unknown>){
 const candidates=providerSubmissions(patch).filter(call=>call.operation==="planning"&&call.status==="completed"&&["valid","invalid"].includes(call.validationStatus??""));
 if(!candidates.length)return;
 const row=await env.DB.prepare("SELECT result_json FROM document_jobs WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(job.job_id,job.owner_id,job.correlation_id).first<{result_json:string}>();
 if(!row)throw new Error("document_job_canceled");
 const checkpoint=JSON.parse(row.result_json),current=providerSubmissions(checkpoint),delta:Record<string,Pick<PaidProviderSubmission,"validationStatus"|"validationIssueCount">>={};
 for(const next of candidates){
  const previous=current.find(call=>call.clientRequestId===next.clientRequestId);
  if(!previous||previous.status!=="completed"||!next.providerRequestId
   ||["provider","operation","model","unitId","providerRequestId"].some(key=>previous[key as keyof PaidProviderSubmission]!==next[key as keyof PaidProviderSubmission])
   ||!Number.isSafeInteger(next.validationIssueCount)||Number(next.validationIssueCount)<0
   ||(next.validationStatus==="valid")!==(next.validationIssueCount===0)
   ||previous.validationStatus!=="pending"&&previous.validationStatus!==next.validationStatus
   ||previous.validationStatus===next.validationStatus&&previous.validationIssueCount!==next.validationIssueCount)throw new Error("provider_submission_validation_changed");
  if(previous.validationStatus!==next.validationStatus)delta[next.clientRequestId]={validationStatus:next.validationStatus,validationIssueCount:next.validationIssueCount};
 }
 if(!Object.keys(delta).length)return;
 await env.DB.batch([
  env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=? AND result_json IS ?")
   .bind(JSON.stringify({providerSubmissions:delta}),job.job_id,job.owner_id,job.correlation_id,row.result_json),
  ...outputAssertionStatements(env,{sql:"changes()=1"}),
 ]);
}
