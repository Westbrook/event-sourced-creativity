import type { WorkerEnv } from './runtime.ts';
import type { DocumentJobRow } from './document-jobs-api.ts';
import { ORDINARY_IMAGE_QUEUE_PATH, verifyImageQueueRequest } from './ordinary-image-queue-protocol.ts';
const claims=new WeakMap<object,{env:WorkerEnv;jobId:string}>();
export type OrdinaryImageClaim=object;
export function ordinaryImageClaimValid(claim:OrdinaryImageClaim|undefined,env:WorkerEnv,jobId:string){const value=claim&&claims.get(claim);return Boolean(value&&value.env===env&&value.jobId===jobId);}
export function ordinaryImageQueueOwned(row:Pick<DocumentJobRow,'request_json'>){
  try{return Object.hasOwn(JSON.parse(row.request_json),'ordinaryImageExecution');}catch{return false;}
}
export function ordinaryImageQueueConfigured(env:WorkerEnv){return env.FORMA_ORDINARY_IMAGE_QUEUE_QUALIFIED==='v1'&&Boolean(env.FORMA_ORDINARY_IMAGE_QUEUE_SECRET&&env.FORMA_ORDINARY_IMAGE_QUEUE_SECRET.length>=32);}
export function ordinaryImageQueueEnrolls(env:WorkerEnv,actorId:string){return ordinaryImageQueueConfigured(env)&&(env.FORMA_ORDINARY_IMAGE_QUEUE_USERS??'').split(',').map(id=>id.trim()).includes(actorId);}
export function ordinaryImageOutboxInsert(env:WorkerEnv,jobId:string){
  return env.DB.prepare(`INSERT INTO ordinary_image_outbox(job_id,owner_id,stream_id,correlation_id,created_at,next_check_at)
    SELECT job_id,owner_id,stream_id,job_id||':attempt:1',requested_at,requested_at FROM document_jobs
    WHERE job_id=? AND kind='generate' AND source_surface='still' AND status='queued' AND attempt_count=0
      AND json_extract(request_json,'$.ordinaryImageExecution')='queue-v1'`).bind(jobId);
}
export async function handleOrdinaryImageQueue(request:Request,env:WorkerEnv){
  const headers={'cache-control':'private, no-store'};
  if(!ordinaryImageQueueConfigured(env))return new Response(null,{status:404,headers});
  const body=await verifyImageQueueRequest(request,env.FORMA_ORDINARY_IMAGE_QUEUE_SECRET!);
  if(!body)return new Response(null,{status:403,headers});
  const path=new URL(request.url).pathname;
  if(path===`${ORDINARY_IMAGE_QUEUE_PATH}/sweep`){
    const due=await env.DB.prepare(`SELECT outbox.job_id AS jobId FROM ordinary_image_outbox outbox JOIN document_jobs job ON job.job_id=outbox.job_id
      WHERE outbox.closed_at IS NULL AND outbox.next_check_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND job.owner_id=outbox.owner_id AND job.stream_id=outbox.stream_id AND (job.attempt_count=0 AND job.correlation_id=job.job_id OR job.attempt_count=1 AND job.correlation_id=outbox.correlation_id)
        AND json_extract(job.request_json,'$.ordinaryImageExecution')='queue-v1'
        AND (job.status NOT IN('running','committing') OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY outbox.next_check_at,outbox.job_id LIMIT 25`).all<{jobId:string}>();
    // No destructive dequeue. A lost queue send/response is picked up next sweep.
    return Response.json({jobs:due.results},{headers});
  }
  if(path!==`${ORDINARY_IMAGE_QUEUE_PATH}/run`||typeof body.jobId!=='string'||body.jobId.length>100||Object.keys(body).length!==1)return new Response(null,{status:400,headers});
  const row=await env.DB.prepare(`SELECT job.*,outbox.closed_at AS delivery_closed_at,outbox.resolution AS delivery_resolution FROM document_jobs job JOIN ordinary_image_outbox outbox ON outbox.job_id=job.job_id
    WHERE job.job_id=? AND job.owner_id=outbox.owner_id AND job.stream_id=outbox.stream_id AND (job.attempt_count=0 AND job.correlation_id=job.job_id OR job.attempt_count=1 AND job.correlation_id=outbox.correlation_id)
      AND job.kind='generate' AND job.source_surface='still' AND json_extract(job.request_json,'$.ordinaryImageExecution')='queue-v1'`).bind(body.jobId).first<DocumentJobRow&{delivery_closed_at:string|null;delivery_resolution:string|null}>();
  if(!row)return new Response(null,{status:404,headers});
  if(row.delivery_closed_at)return Response.json({status:row.status,resolution:row.delivery_resolution,providerRequestsResubmitted:0},{headers});
  const claim={};claims.set(claim,{env,jobId:row.job_id});
  try{
    const {deliverOrdinaryImage}=await import('./document-jobs-api.ts');
    const result=await deliverOrdinaryImage(env,row,claim);
    return Response.json(result,{headers});
  }finally{claims.delete(claim);}
}
