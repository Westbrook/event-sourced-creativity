import { captureOriginalOutputVideoFinancialAuthority, recordOriginalOutputVideoCompletedObservation, originalOutputVideoFinancialState } from "./output-video-original-financial.ts";
import { providerSubmissions } from "../src/model/provider-submission.ts";
import { claimOutputVideoRecoveryLease } from "./output-video-recovery-lease.ts";
import { readOriginalOutputVideo } from "./output-video-execution.ts";
import { verifyOutputVideoRecoveryCompletion } from "./output-video-completion.ts";
import { readRetainedOutputVideo } from "./output-video-retained.ts";
import { loadOutputJobBinding, reconcileKnownOutputProviderReceipts, prepareOutputJobOutcomeStatements } from "./output-execution-control.ts";
import { resolveOutputVideoRecoveryAuthority } from "./output-requirements-api.ts";
import { guardOutputPrivateWrites } from "./output-private-execution.ts";
import { outputAssertionStatements, OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { storeGeneratedMedia } from "./media-api.ts";
import { storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { makeEvent, appendEvents, type WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const parse=(v:string|null)=>object(JSON.parse(v??"{}"));
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
function fail(code="output_video_recovery_unavailable"):never{throw new OutputConflictError(code,409);}
export type VideoRecoveryStage="video_binding"|"video_authority"|"video_lease"|"video_replay"|"video_provider"|"video_settlement"|"video_storage"|"video_publish";
type Options={assertions:OutputSqlAssertion[];signal?:AbortSignal;onStage?:(stage:VideoRecoveryStage)=>void};
function stage(options:Options,value:VideoRecoveryStage){try{options.onStage?.(value);}catch{/* Diagnosis cannot change execution. */}}

/** Explicit original-only recovery. No queue writer, planner, upload, POST,
 * new grant/reservation, or provider call claim is reachable from this entry. */
export async function recoverOutputVideo(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,options:Options){
 stage(options,"video_binding");
 const binding=await loadOutputJobBinding(env,user,job);if(!binding)fail();
 stage(options,"video_authority");
 const {scope,slot}=binding,proof=await resolveOutputVideoRecoveryAuthority(env,scope,slot);
 const assertions=[...proof.assertions,...options.assertions];
 return executeOutputVideoRecovery(env,user,job,binding,{assertions,signal:options.signal,onStage:options.onStage});
}

/** Internal execution seam shared by the API and offline original-custody
 * controls. Authorization/source assertions must come from the caller's current
 * resolver; the lease additionally rechecks all original job/slot/private IDs. */
export async function executeOutputVideoRecovery(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,
 binding:NonNullable<Awaited<ReturnType<typeof loadOutputJobBinding>>>,options:Options){
 const {scope,slot}=binding;if(scope.actorUserId!==user.userId||!options.assertions.length)fail();
 const settings=parse(job.request_json),original=parse(job.result_json),artifactId=original.artifactId;
 if(typeof artifactId!=="string"||!artifactId||!original.artifactPlan)fail();
 const currentJob=()=>env.DB.prepare("SELECT document_jobs.*,(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?").bind(job.job_id,scope.actorUserId).first<DocumentJobRow>();
 const completions=async()=>{
  const rows=await env.DB.prepare(`SELECT event.event_id,body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id
   WHERE event.stream_id=? AND event.correlation_id=? AND event.type='DocumentRenderCompleted' AND event.actor='worker:renderer'
    AND body.owner_id=? AND body.document_id=? AND body.redacted_at IS NULL AND json_extract(body.private_json,'$.artifact_id')=?
    AND length(CAST(body.private_json AS BLOB))<=1048576 ORDER BY event.sequence`).bind(job.stream_id,job.correlation_id,scope.actorUserId,scope.documentId,artifactId).all<{event_id:string;private_json:string}>();
  if(rows.results.length>1)fail("output_video_recovery_duplicate_completion");return rows.results[0]??null;
 };
 const retainedInput=async(done:{event_id:string;private_json:string})=>{
  const payload=parse(done.private_json);if(typeof payload.content_ref!=="string"||typeof payload.input_ref!=="string")fail();
  const body=await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND length(CAST(content AS BLOB))<=1048576 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`).bind(payload.content_ref,scope.actorUserId).first<{content:string;expires_at:string}>();
  if(!body)fail();
  const artifactAssertion:OutputSqlAssertion={sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[payload.content_ref,scope.actorUserId,body.content,body.expires_at],deadlineMs:Date.parse(body.expires_at)};
  return{ownerId:scope.actorUserId,completionId:done.event_id,documentId:scope.documentId,projectId:scope.projectId,artifactId,contentId:payload.content_ref,inputId:payload.input_ref,rawContent:body.content,contentExpiresAt:body.expires_at,completionRaw:done.private_json,signal:options.signal,currentAssertions:[artifactAssertion]};
 };
 const completedRead=async()=>{
  options.signal?.throwIfAborted();const current=await currentJob();if(current?.status!=="completed")return null;
  const done=await completions();if(!done)return null;const input=await retainedInput(done);const read=await readRetainedOutputVideo(env,{...input,currentAssertions:[...input.currentAssertions,...options.assertions,{sql:"EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND private_json=? AND redacted_at IS NULL)",bindings:[done.event_id,scope.actorUserId,done.private_json]}]});
  if(!await env.DB.prepare("WITH video_witness AS (SELECT ? AS bindings) SELECT 1 AS current WHERE "+read.witness.sql).bind(read.witness.json).first())fail();
  if(options.signal?.aborted||Date.parse(read.expiresAt)<=Date.now())fail();return{status:"completed" as const,jobId:job.job_id,slotId:slot.slotId,replayed:true};
 };
 if(job.status==="completed")return await completedRead()??fail();
 stage(options,"video_lease");
 const lease=await claimOutputVideoRecoveryLease(env,scope,slot,job,options);
 let completionJson:string|undefined,completionAssertions:OutputSqlAssertion[]=[];
 const live=()=>[...lease.assertions(),...completionAssertions];
 const privateEnv=guardOutputPrivateWrites(env,scope,slot,async()=>live(),{retentionPolicy:binding.retentionPolicy,videoCompletionJson:()=>completionJson,
  videoRecoveryStorage:{token:lease.token,storageKey:lease.lease.storageKey,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,lease.deadlineMs-Date.now()))])}});
 const update=async(patch:Record<string,unknown>)=>{
  await lease.assertCurrent();await env.DB.batch([...live().flatMap(a=>outputAssertionStatements(env,a)),env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=?").bind(JSON.stringify(patch),job.job_id,scope.actorUserId)]);
 };
 const finish=(completionId:string,eventIds:string[])=>{
  const now=new Date().toISOString();return[
   env.DB.prepare("UPDATE document_jobs SET status='completed',error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=?,result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=? AND status='failed'")
    .bind(now,now,JSON.stringify({artifactId,artifactKind:"video",stage:"completed",errorDetail:null,appendedEventIds:eventIds,outputVideoRecovery:{status:"completed",completionEventId:completionId},generationReceipt:{provider_request_status:"completed"}}),job.job_id,scope.actorUserId),
   ...outputAssertionStatements(env,{sql:"changes()=1"}),...prepareOutputJobOutcomeStatements(env,job),
   // A later immutable failure event must not replace the proven successful
   // completion selected during lost-finalization recovery.
   env.DB.prepare("UPDATE output_operation_slots SET outcome_event_id=? WHERE scope_key=? AND slot_id=? AND job_id=? AND status='succeeded'").bind(completionId,scope.key,slot.slotId,job.job_id),
  ];
 };
 try{
  stage(options,"video_replay");
  const existing=await completions();
  if(existing){
   // The original completed media receipt is already durable. Reconcile only
   // those known calls and validate the exact published bytes before finalizing.
   await reconcileKnownOutputProviderReceipts(env,user,{jobId:job.job_id,assertions:live()});
   await update({artifactKind:"video",appendedEventIds:[existing.event_id]});
   const read=await readRetainedOutputVideo(env,{...await retainedInput(existing),recoveryLease:lease});
   const final=[...live(),...read.assertions,{sql:"EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND private_json=? AND redacted_at IS NULL)",bindings:[existing.event_id,scope.actorUserId,existing.private_json]}];
   await env.DB.batch([...final.flatMap(a=>outputAssertionStatements(env,a)),...finish(existing.event_id,[existing.event_id])]);
   return await completedRead()??fail();
  }
  const financial=await captureOriginalOutputVideoFinancialAuthority(env,user,scope,slot,job);
  stage(options,"video_provider");
  const result=await readOriginalOutputVideo(env,{contract:lease.contract,requestBody:lease.requestBody,clientRequestId:lease.attempt.clientRequestId,requestDigest:lease.attempt.requestDigest!,providerRequestId:lease.providerRequestId},{signal:options.signal,
   onBeforeRead:async hook=>{hook.assertCurrent();await lease.assertCurrent();hook.assertCurrent();},onEnvelope:async(value,hook)=>{await lease.retainEnvelope(value,hook);},
   onCompleted:async(observation,hook)=>{hook.assertCurrent();await recordOriginalOutputVideoCompletedObservation(financial,env,observation);}});
  if(result.status==="pending")return{status:"pending" as const,jobId:job.job_id,slotId:slot.slotId,replayed:false};
  stage(options,"video_settlement");
  const observed=originalOutputVideoFinancialState(financial,env).receipt;
  if(!observed||observed.clientRequestId!==result.clientRequestId||observed.providerRequestId!==result.providerRequestId||observed.model!==result.model||observed.requestDigest!==result.requestDigest||observed.costMicrousd!==result.costMicrousd)fail("output_video_recovery_settlement_unavailable");
  await lease.assertCurrent();
  stage(options,"video_storage");
  const existingMedia=await env.MEDIA.head(lease.lease.storageKey),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(result.bytes).buffer)),b=>b.toString(16).padStart(2,"0")).join("");
  await lease.assertCurrent();if(existingMedia&&(existingMedia.customMetadata?.ownerId!==scope.actorUserId||existingMedia.customMetadata?.artifactId!==artifactId||existingMedia.customMetadata?.sha256!==hash))fail("output_video_recovery_media_changed");
  const stored=await storeGeneratedMedia(privateEnv,scope.actorUserId,artifactId,result.bytes,result.model,"video/mp4",{artifactRole:"document-video",artifactId,provider:"fal",providerJobId:result.providerRequestId,providerRequestId:result.providerRequestId,providerSubmissionId:result.clientRequestId,outputVideoRequestDigest:result.requestDigest});
  await update({outputVideoMediaResult:{artifactId,mediaUrl:stored.url,mediaType:"video/mp4",sha256:stored.contentHash,byteLength:result.bytes.length,clientRequestId:result.clientRequestId,providerRequestId:result.providerRequestId,model:result.model,requestDigest:result.requestDigest}});
  stage(options,"video_publish");
  const verified=await verifyOutputVideoRecoveryCompletion(lease,env,scope,slot,job,settings,artifactId,original.artifactPlan,{signal:options.signal,deadlineMs:lease.deadlineMs});
  completionJson=JSON.stringify(verified.receipt);completionAssertions=verified.assertions;
  const plan=object(original.artifactPlan),input={schema_version:1,artifact_id:artifactId,artifact_kind:"video",document_id:scope.documentId,project_id:scope.projectId,output_video:verified.receipt,
   request:{item_count:1,production_mode:"manual",source_surface:"outputs"},planner:{provider:"openai",response_id:verified.receipt.plannerResponseId}};
  const raw=JSON.stringify(plan),rawInput=JSON.stringify(input),content=await storePrivateContent(privateEnv,scope.actorUserId,"document-artifact",raw),inputStored=await storePrivateContent(privateEnv,scope.actorUserId,"document-artifact-input",rawInput);
  const complete=makeEvent(job.stream_id,1,"worker:renderer","output-video-recovery",job.correlation_id,"DocumentRenderCompleted",{artifact_id:artifactId,artifact_kind:"video",document_id:scope.documentId,project_id:scope.projectId,requested_by_user_id:scope.actorUserId,title:String(plan.title??""),summary:String(plan.summary??""),
   content_ref:content.contentId,content_expires_at:content.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:1,items:[{id:`${artifactId}-item-1`,media_url:stored.url,media_type:"video/mp4"}],media_url:stored.url,media_type:"video/mp4",provider:"fal",provider_job_id:result.providerRequestId,model_id:result.model,planner_model_id:String(object(original.outputVideoPlannerCheckpoint).model),planner_response_id:verified.receipt.plannerResponseId,source_surface:"outputs",recovered:true,
   settings:{item_count:1,production_mode:"manual",output_video:verified.receipt,source_media_sha256:stored.contentHash,video_content_sha256:await sha(raw),video_input_sha256:await sha(rawInput)}});
  const current=await currentJob();if(!current)fail();const receipts=providerSubmissions(parse(current.result_json)),planning=receipts.find(r=>r.operation==="planning");if(!planning)fail();
  const priorRows=(await env.DB.prepare("SELECT event.event_id,body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded' AND body.owner_id=? AND body.redacted_at IS NULL AND length(CAST(body.private_json AS BLOB))<=1048576 ORDER BY event.sequence LIMIT 65").bind(job.stream_id,job.correlation_id,scope.actorUserId).all<{event_id:string;private_json:string}>()).results;
  const priorSnapshot=JSON.stringify(priorRows);if(priorRows.length>64||new TextEncoder().encode(priorSnapshot).length>1048576)fail("output_video_recovery_usage_conflict");
  completionAssertions.push({sql:`(SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND type='GenerationUsageRecorded')=?
   AND (SELECT COUNT(*) FROM json_each(?) saved JOIN events event ON event.event_id=json_extract(saved.value,'$.event_id') AND event.stream_id=? AND event.correlation_id=? AND event.type='GenerationUsageRecorded'
    JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.private_json=json_extract(saved.value,'$.private_json') AND body.redacted_at IS NULL)=?`,bindings:[job.stream_id,job.correlation_id,priorRows.length,priorSnapshot,job.stream_id,job.correlation_id,scope.actorUserId,priorRows.length]});
  const prior=priorRows.map(r=>parse(r.private_json));
  const expected={input_tokens:planning.inputTokens!,output_tokens:planning.outputTokens!,total_tokens:planning.totalTokens!,cost_microusd:planning.costMicrousd!+result.costMicrousd},remaining:Record<string,number>={};
  for(const [key,total] of Object.entries(expected)){if(!Number.isSafeInteger(total)||total<0)fail();const amounts=prior.map(p=>p[key]??0);if(amounts.some(v=>!Number.isSafeInteger(v)||Number(v)<0))fail();const used=amounts.reduce<number>((a,b)=>a+Number(b),0);if(used>total)fail("output_video_recovery_usage_conflict");remaining[key]=total-used;}
  const usage=makeEvent(job.stream_id,2,"worker:policy","output-video-recovery",job.correlation_id,"GenerationUsageRecorded",{operation:"document-render:video",artifact_id:artifactId,artifact_kind:"video",document_id:scope.documentId,reservation_id:slot.tokenReservationId,cost_reservation_id:slot.costReservationId,...remaining,planner_response_id:verified.receipt.plannerResponseId,provider_job_id:result.providerRequestId,model_ids:[planning.model,result.model],source_surface:"outputs",recovered:true},{causationId:complete.eventId});
  await lease.assertCurrent();if(await completions())fail("output_video_recovery_completion_changed");
  try{
   await appendEvents(privateEnv,[complete,usage],{retries:1,prepareSidecars:()=>[
    ...outputAssertionStatements(env,{sql:"(SELECT COUNT(*) FROM events WHERE event_id IN(?,?))=2",bindings:[complete.eventId,usage.eventId]}),...finish(complete.eventId,[complete.eventId,usage.eventId]),
   ]});
  }catch(error){const completed=await completedRead();if(completed)return completed;throw error;}
  return await completedRead()??fail();
 }finally{await lease.release().catch(()=>{});}
}
