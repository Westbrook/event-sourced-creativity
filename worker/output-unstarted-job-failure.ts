type JobSnapshot={job_id:string;owner_id:string;stream_id:string;correlation_id:string;status:string;attempt_count:number;request_json:string;result_json:string|null;updated_at:string;lease_expires_at:string|null};
/** A pre-admission read owns only its exact, never-started queued snapshot. */
export function unstartedOutputJobFailure(row:JobSnapshot,result:Record<string,unknown>,message:string,now:string){
  if(row.status!=="queued"||row.attempt_count!==0||row.lease_expires_at!==null)return null;
  return{sql:`UPDATE document_jobs SET status='failed',result_json=?,error_message=?,completed_at=?,updated_at=?
    WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='queued' AND attempt_count=0
      AND lease_expires_at IS NULL AND request_json=? AND result_json IS ? AND updated_at=?
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls call JOIN output_operation_slots slot ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id WHERE slot.job_id=document_jobs.job_id)`,
    bindings:[JSON.stringify(result),message,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.request_json,row.result_json,row.updated_at]};
}
