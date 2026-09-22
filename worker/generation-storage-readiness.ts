import type { WorkerEnv } from './runtime.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
export type StorageReadinessDiagnostic={phase:'boundary'|'consuming-query';code:string;sqlBytes:number;maximumBindingBytes:number;exceptionType:string;stackLocations:string[]};
export function storageReadinessFailureCode(error:unknown):string {
  const messages:string[]=[];let current=error;
  for(let i=0;i<3&&current instanceof Error;i++,current=current.cause)messages.push(current.message);
  const known=new Set(['memory_boundary_schema_unavailable','memory_boundary_database_changed','native_structured_origin_schema_unavailable','native_document_job_origin_schema_unavailable','native_structured_origin_schema_database_changed','native_document_job_origin_schema_database_changed','generation_preparation_unavailable','event_save_repair_inventory']);
  for(const message of messages){if(known.has(message))return message;
    for(const [pattern,code] of [[/expression tree is too large|expression depth/iu,'database_expression_limit'],[/too many sql variables/iu,'database_binding_limit'],[/string or blob too big|statement too long|SQLITE_TOOBIG/iu,'database_size_limit'],[/too many subrequests/iu,'database_subrequest_limit'],[/no such (?:table|column)/iu,'database_missing_dependency'],[/not authorized|authorization denied/iu,'database_operation_denied'],[/SQLITE_ERROR/iu,'database_query_failed']] as const)if(pattern.test(message))return code;
  }
  const identifier=messages.find(message=>/^[a-z][a-z0-9_]{0,99}$/u.test(message));
  return identifier??'unclassified_storage_check';
}
/** Read-only service check. It neither reserves allowance nor authorizes generation. */
export async function generationReadiness(env: WorkerEnv, observeFailure?:(diagnostic:StorageReadinessDiagnostic)=>void) {
  const db=env.DB;let phase:StorageReadinessDiagnostic['phase']='boundary',sqlBytes=0,maximumBindingBytes=0;
  try {
    const guard=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    if(env.DB!==db)throw new Error('memory_boundary_database_changed');
    phase='consuming-query';const sql=`SELECT 1 AS ready FROM (SELECT '' AS content_id, '' AS kind) private_content WHERE ${guard.sql}`;
    sqlBytes=new TextEncoder().encode(sql).byteLength;maximumBindingBytes=Math.max(0,...guard.bindings.map(value=>typeof value==='string'?new TextEncoder().encode(value).byteLength:0));
    const ready=await db.prepare(sql).bind(...guard.bindings).first();
    if(env.DB!==db||!ready)throw new Error('generation_preparation_unavailable');
    return {ready:true,code:'ready' as const,message:'Storage preparation is ready. Review your current document before starting a new paid request. Other admission checks still apply.'};
  } catch(error) {
    const diagnostic={phase,code:storageReadinessFailureCode(error),sqlBytes,maximumBindingBytes,exceptionType:error instanceof Error&&/^[A-Za-z]{1,40}$/u.test(error.name)?error.name:'Unknown',stackLocations:error instanceof Error?(error.stack??'').split('\n').slice(1,6).map(line=>{const match=line.match(/:(\d+):(\d+)\)?$/u);return match?`${match[1]}:${match[2]}`:'';}).filter(Boolean):[]};
    console.warn(JSON.stringify({event:'generation_storage_readiness_failed',...diagnostic}));observeFailure?.(diagnostic);
    return {ready:false,code:'generation_preparation_unavailable' as const,message:'Forma’s storage preparation is unavailable. No generation was started. Contact support or check again later; changing your prompt will not fix this service problem.'};
  }
}
