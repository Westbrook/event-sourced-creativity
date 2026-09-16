type SceneJobSnapshot={job_id:string;owner_id:string;stream_id:string;correlation_id:string;kind:string;source_surface:string;status:string;attempt_count:number;request_json:string;result_json:string|null;updated_at:string;lease_expires_at:string|null;scene_source_protocol?:number;scene_source_version_json?:string|null;output_slot_id?:string|null};
/** Original Scene grants permit one execution claim. An expired claim is
 * terminal, never permission to invent attempt 2. No accounting is released. */
export type SceneTerminalWitness={event_id:string;sequence:number;type:string;payload:string};
export function expiredOriginalSceneJobFailure(row:SceneJobSnapshot,now:string,terminals:SceneTerminalWitness[]=[]){
  return expiredOriginalNativeJobFailure(row,now,terminals,'scene');
}
/** Accepted native Audio is retrieved separately by original request ID. The
 * generic runner must never hand its retained checkpoint to a second claim. */
export function expiredOriginalAudioJobFailure(row:SceneJobSnapshot,now:string,terminals:SceneTerminalWitness[]=[]){
  return expiredOriginalNativeJobFailure(row,now,terminals,'audio');
}
export function expiredOriginalVideoJobFailure(row:SceneJobSnapshot,now:string,terminals:SceneTerminalWitness[]=[]){
  return expiredOriginalNativeJobFailure(row,now,terminals,'video');
}
function expiredOriginalNativeJobFailure(row:SceneJobSnapshot,now:string,terminals:SceneTerminalWitness[],kind:'scene'|'audio'|'video'){
  const deadline=Date.parse(row.lease_expires_at??'');
  if(!row.output_slot_id||(kind==='scene'&&row.scene_source_protocol!==1)||(kind!=='scene'&&row.scene_source_protocol===1)||row.kind!=='render_document'||row.source_surface!=='outputs'
    ||!['running','committing'].includes(row.status)||!Number.isSafeInteger(row.attempt_count)||row.attempt_count<1
    ||!Number.isFinite(deadline)||!Number.isFinite(Date.parse(now))||deadline>Date.parse(now))return null;
  let request:Record<string,unknown>,previous:Record<string,unknown>;
  try{request=JSON.parse(row.request_json);previous=JSON.parse(row.result_json??'{}');}catch{return null;}
  if(!request||typeof request!=='object'||Array.isArray(request)||request.artifactKind!==kind
    ||!previous||typeof previous!=='object'||Array.isArray(previous))return null;
  const label=kind==='scene'?'Scene':kind==='audio'?'Audio':'Video';
  const message=`The original ${label} execution was interrupted. Its recorded calls and allowances are preserved; no automatic second attempt was started.`;
  let result:Record<string,unknown>={...previous,noAutomaticRetry:true,stage:'failed',progressMessage:message,
    errorDetail:{code:'execution_interrupted',category:'server',scope:'unknown',action:'contact_support',message,retryable:false,retryAfterMs:null,requestId:null,httpStatus:null}};
  let status='failed',error:string|null='execution_interrupted';
  let eventGuard="NOT EXISTS(SELECT 1 FROM events event WHERE event.stream_id=document_jobs.stream_id AND event.correlation_id=document_jobs.correlation_id AND event.type IN('DocumentRenderCompleted','DocumentRenderFailed'))";
  const eventBindings:(string|number)[]=[];
  if(terminals.length){
    // Conflicting receipts are not permission to choose a favorable outcome.
    if(terminals.length!==1)return null;
    const terminal=terminals[0]!;
    if(!['DocumentRenderCompleted','DocumentRenderFailed'].includes(terminal.type))return null;
    status=terminal.type==='DocumentRenderCompleted'?'completed':'failed';
    let payload:Record<string,unknown>;try{payload=JSON.parse(terminal.payload);}catch{return null;}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
    result={...previous,noAutomaticRetry:true,stage:status,appendedEventIds:[terminal.event_id],progressMessage:status==='completed'?'The operation finished.':`The recorded ${label} operation failed.`};
    delete result.errorDetail;
    error=null;
    if(status==='failed'){
      const code=typeof payload.error_code==='string'?payload.error_code:'operation_failed';
      const failureMessage=typeof payload.error_message==='string'?payload.error_message:`The recorded ${label} operation failed.`;
      error=code;result.errorDetail={code,category:typeof payload.error_category==='string'?payload.error_category:'unknown',scope:typeof payload.error_scope==='string'?payload.error_scope:'unknown',action:'contact_support',message:failureMessage,retryable:false,retryAfterMs:null,requestId:typeof payload.provider_request_id==='string'?payload.provider_request_id:null,httpStatus:typeof payload.http_status==='number'?payload.http_status:null};
    }
    eventGuard="EXISTS(SELECT 1 FROM events event WHERE event.stream_id=document_jobs.stream_id AND event.correlation_id=document_jobs.correlation_id AND event.event_id=? AND event.sequence=? AND event.type=? AND event.payload=?) AND (SELECT COUNT(*) FROM events event WHERE event.stream_id=document_jobs.stream_id AND event.correlation_id=document_jobs.correlation_id AND event.type IN('DocumentRenderCompleted','DocumentRenderFailed'))=1";
    eventBindings.push(terminal.event_id,terminal.sequence,terminal.type,terminal.payload);
  }
  const resultJson=JSON.stringify(result);
  return{resultJson,sql:`UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,updated_at=?,lease_expires_at=NULL
    WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND kind='render_document' AND source_surface='outputs'
      AND status=? AND attempt_count=? AND request_json=? AND result_json IS ? AND updated_at=?
      AND scene_source_protocol IS ? AND scene_source_version_json IS ? AND lease_expires_at=?
      AND lease_expires_at<=? AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND ${eventGuard}
      AND EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id AND slot.slot_id=? AND slot.status IN('queued','running'))`,
    bindings:[status,resultJson,error,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.status,row.attempt_count,row.request_json,row.result_json,row.updated_at,row.scene_source_protocol??null,row.scene_source_version_json??null,row.lease_expires_at,now,...eventBindings,row.output_slot_id]};
}
