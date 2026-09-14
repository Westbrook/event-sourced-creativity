import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { readFalRecoveryCheckpoint, falRecoveryEventProvenance, falRecoveryJobStateAllowed, type FalRecoveryStage } from "./output-fal-recovery-policy.ts";
import { loadOutputJobBinding, reconcileKnownOutputProviderReceipts, prepareOutputJobOutcomeStatements } from "./output-execution-control.ts";
import { resolveOutputFalRecoveryAuthority } from "./output-requirements-api.ts";
import { guardOutputPrivateWrites } from "./output-private-execution.ts";
import { outputAssertionStatements, OutputConflictError, settleOutputProviderCall, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { readOutputFalImageContract, restoreOutputFalImageRequest } from "./output-fal-image-contract.ts";
import { readOutputFalImageResult, falImageProviderReceipt } from "./fal-image-adapter.ts";
import { storeGeneratedImage } from "./media-api.ts";
import { storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { makeEvent, appendEvents, type WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const parse=(v:string|null)=>object(JSON.parse(v??"{}"));
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
function reject(code:string):never{throw new OutputConflictError(code,409);}
const tokenCount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;

/** A resolved batch is not proof that every original guard was acknowledged.
 * A malformed/lost acknowledgement stays unknown; never retry or recapture. */
async function acknowledgedRecoveryBatch<T extends Record<string,unknown>>(db:D1Database,statements:D1PreparedStatement[]):Promise<D1Result<T>[]> {
  const expected=statements.length;
  const results=await db.batch<T>(statements);
  if(!Number.isSafeInteger(expected)||expected<1||!Array.isArray(results)||results.length!==expected)reject("output_fal_recovery_ack_unavailable");
  for(let i=0;i<expected;i++){
    const entry=Object.getOwnPropertyDescriptor(results,String(i))?.value;
    if(!entry||typeof entry!=="object"||Array.isArray(entry)
      ||Object.getOwnPropertyDescriptor(entry,"success")?.value!==true)reject("output_fal_recovery_ack_unavailable");
    const error=Object.getOwnPropertyDescriptor(entry,"error"),rows=Object.getOwnPropertyDescriptor(entry,"results")?.value;
    if(error&&(!Object.hasOwn(error,"value")||error.value!==undefined)||!Array.isArray(rows))reject("output_fal_recovery_ack_unavailable");
    for(let j=0;j<rows.length;j++){
      const row=Object.getOwnPropertyDescriptor(rows,String(j))?.value;
      if(!row||typeof row!=="object"||Array.isArray(row))reject("output_fal_recovery_ack_unavailable");
    }
  }
  return results;
}

/** Explicit recovery of one original personal Fal Image. No paid dispatcher is
 * reachable here. The failed job is not requeued; only an exact GET/publication
 * lease is claimed. Immutable failure events and the prior failure fields remain. */
export async function recoverOutputFalImage(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,options:{assertions:OutputSqlAssertion[];signal?:AbortSignal;onStage?:(stage:FalRecoveryStage)=>void}){
  options.onStage?.("binding");
  const binding=await loadOutputJobBinding(env,user,job);if(!binding)reject("output_native_operation_required");
  const {scope,slot}=binding;
  if(job.output_slot_id!==slot.slotId||job.kind!=="generate"||!falRecoveryJobStateAllowed(job.status,slot.status))reject("output_fal_recovery_job_unavailable");
  options.onStage?.("authority");
  const proof=await resolveOutputFalRecoveryAuthority(env,scope,slot);
  options.onStage?.("checkpoint");
  const settings=object(proof.targetPreflight.settings),payload=object(settings.payload),contract=readOutputFalImageContract(payload.outputFalImage);
  if(!contract)reject("output_fal_recovery_contract_unavailable");
  const metadata=parse(job.result_json),checkpoint=readFalRecoveryCheckpoint(metadata.outputFalCheckpoint);
  if(!checkpoint)reject("output_fal_recovery_checkpoint_unavailable");
  const identity:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs current JOIN output_operation_slots slot ON slot.job_id=current.job_id
    WHERE current.job_id=? AND current.owner_id=? AND current.stream_id=? AND current.document_id=? AND current.correlation_id=? AND current.kind='generate'
      AND current.status IN('failed','completed') AND current.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_contract_digest=? AND slot.source_digest=? AND slot.route_digest=?
      AND (slot.status IN('uncertain','failed','succeeded') OR current.status='failed' AND slot.status='running') AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
      AND (SELECT COUNT(*) FROM output_operation_slots siblings WHERE siblings.scope_key=slot.scope_key AND siblings.grant_id=slot.grant_id)=1
      AND json_extract(current.result_json,'$.outputFalCheckpoint')=?)`,bindings:[job.job_id,user.userId,job.stream_id,scope.documentId,job.correlation_id,scope.key,slot.slotId,slot.grantId,slot.planRevisionId,slot.targetContractDigest,slot.sourceDigest,slot.routeDigest,JSON.stringify(checkpoint)]};
  const assertions:OutputSqlAssertion[]=[...proof.assertions,...options.assertions,identity,
    ...proof.assertions.flatMap(a=>a.deadlineMs===undefined?[]:[{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(a.deadlineMs).toISOString()]}])];
  const guardedRead=async<T extends Record<string,unknown>>(statement:D1PreparedStatement,extra:OutputSqlAssertion[]=[])=>{
    const results=await acknowledgedRecoveryBatch<T>(env.DB,[...[...assertions,...extra].flatMap(a=>outputAssertionStatements(env,a)),statement]);return results.at(-1)!.results;
  };
  const completedRead=async()=>{
    options.onStage?.("completion_read");
    const rows=await guardedRead(env.DB.prepare(`SELECT job.result_json FROM document_jobs job JOIN events done ON done.event_id=json_extract(job.result_json,'$.outputFalRecovery.completionEventId')
      JOIN event_private_payloads body ON body.private_event_id=done.event_id AND body.redacted_at IS NULL
      WHERE job.job_id=? AND job.owner_id=? AND job.status='completed' AND done.stream_id=job.stream_id AND done.correlation_id=job.correlation_id AND done.type='GenerationCompleted'
        AND json_extract(body.private_json,'$.provider_request_id')=json_extract(job.result_json,'$.outputFalRecovery.providerRequestId')
        AND json_extract(body.private_json,'$.provider_submission_id')=? AND json_extract(body.private_json,'$.document_id')=?`)
      .bind(job.job_id,user.userId,checkpoint.clientRequestId,scope.documentId));
    return rows.length===1?{status:"completed" as const,jobId:job.job_id,slotId:slot.slotId,replayed:true}:null;
  };
  if(job.status==="completed")return await completedRead()??reject("output_fal_recovery_completion_unavailable");
  options.onStage?.("private_read");
  const contents=await guardedRead<{content_id:string;kind:string;content:string;expires_at:string}>(env.DB.prepare(`SELECT content_id,kind,content,expires_at FROM private_content
    WHERE content_id IN(?,?) AND owner_id=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE scope.resource_kind='content' AND scope.resource_id=private_content.content_id)`)
    .bind(checkpoint.requestRef,checkpoint.planningRef,user.userId));
  const request=contents.find(x=>x.content_id===checkpoint.requestRef&&x.kind==='prompt'),planning=contents.find(x=>x.content_id===checkpoint.planningRef&&x.kind==='provider-output');
  if(!request||!planning||await hash(request.content)!==checkpoint.requestSha256||await hash(planning.content)!==checkpoint.planningSha256)reject("output_fal_recovery_content_unavailable");
  options.onStage?.("request_restore");
  const captured=await restoreOutputFalImageRequest(contract,request.content,checkpoint.clientRequestId,checkpoint.requestDigest);
  options.onStage?.("planning");
  const plan=parse(planning.content),planned=object(plan.planned),usage=object(planned.usage),direction=object(planned.output),generationId=plan.generationId;
  if(typeof generationId!=="string"||!/^[a-zA-Z0-9-]{1,80}$/u.test(generationId)||typeof planned.raw!=="string"||JSON.stringify(JSON.parse(planned.raw))!==JSON.stringify(direction)
    ||planned.model!==contract.plannerModel||typeof planned.responseId!=="string"||!planned.responseId||!['inputTokens','outputTokens','totalTokens'].every(k=>tokenCount(usage[k]))
    ||Number(usage.totalTokens)!==Number(usage.inputTokens)+Number(usage.outputTokens))reject("output_fal_recovery_plan_unavailable");
  options.onStage?.("calls_read");
  const calls=await guardedRead(env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId));
  const call=calls.find(c=>c.call_key==='image:initial'),planner=calls.find(c=>c.call_key==='planning:initial');
  if(calls.length!==2||!call||!planner||call.client_request_id!==checkpoint.clientRequestId||call.request_digest!==checkpoint.requestDigest||call.stage_key!=='image:initial'||call.provider!=='fal'||call.model!==contract.model
    ||!['uncertain','settled'].includes(String(call.status))||typeof call.provider_response_id!=='string'||!call.provider_response_id
    ||planner.provider!=='openai'||planner.model!==contract.plannerModel||planner.stage_key!=='planning:initial'||planner.status!=='settled'||planner.provider_response_id!==planned.responseId
    ||!tokenCount(planner.used_microusd))reject("output_fal_recovery_call_unavailable");
  const receipt=falImageProviderReceipt(contract.model,call.provider_response_id);
  options.onStage?.("origin");
  const compiled=proof.events.filter(e=>e.type==='ContextCompiled'&&e.correlationId===job.correlation_id&&e.payload.generation_id===generationId&&e.payload.document_id===scope.documentId);
  if(compiled.length!==1)reject("output_fal_recovery_origin_unavailable");
  const provenance=falRecoveryEventProvenance(contract,settings.imageRender,compiled[0]!.payload,plan.planningSource);
  for(const content of [request,planning])assertions.push({sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE scope.resource_kind='content' AND scope.resource_id=private_content.content_id))`,bindings:[content.content_id,user.userId,content.kind,content.content,content.expires_at]});
  assertions.push({sql:`EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='image:initial' AND stage_key='image:initial' AND provider='fal' AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND status IN('uncertain','settled'))
    AND (SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=2`,bindings:[scope.key,slot.slotId,contract.model,checkpoint.clientRequestId,checkpoint.requestDigest,receipt.providerRequestId,scope.key,slot.slotId]});
  const token=crypto.randomUUID(),storageArtifactId=`${generationId}-recovery-${token}`,storageKey=`${ownerMediaNamespace(scope.ownerUserId)}/generated/${storageArtifactId}.png`,expiresAt=new Date(Date.now()+120_000).toISOString(),lease={version:"output-fal-recovery-v1",token,expiresAt,storageKey,clientRequestId:checkpoint.clientRequestId,
    providerRequestId:receipt.providerRequestId,priorStatus:job.status,priorErrorCode:job.error_message,priorCompletedAt:job.completed_at};
  const leaseAssertion:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='failed'
    AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND json_extract(result_json,'$.outputFalRecovery.token')=? AND json_extract(result_json,'$.outputFalRecovery.expiresAt')=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM document_jobs competitor WHERE competitor.stream_id=document_jobs.stream_id AND competitor.document_id=document_jobs.document_id AND competitor.job_id<>document_jobs.job_id AND competitor.status IN('running','committing') AND competitor.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,bindings:[job.job_id,user.userId,token,expiresAt,expiresAt]};
  options.onStage?.("lease");
  await acknowledgedRecoveryBatch(env.DB,[...assertions.flatMap(a=>outputAssertionStatements(env,a)),env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.outputFalRecovery',json(?)) WHERE job_id=? AND owner_id=? AND status='failed' AND result_json IS ?
    AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND (json_type(result_json,'$.outputFalRecovery') IS NULL OR json_extract(result_json,'$.outputFalRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS(SELECT 1 FROM document_jobs competitor WHERE competitor.stream_id=document_jobs.stream_id AND competitor.document_id=document_jobs.document_id AND competitor.job_id<>document_jobs.job_id AND competitor.status IN('running','committing') AND competitor.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .bind(JSON.stringify(lease),job.job_id,user.userId,job.result_json),...outputAssertionStatements(env,{sql:"changes()=1"})]);
  const live=()=>[...assertions,leaseAssertion];
  const timeout=AbortSignal.timeout(120_000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
  const assertCurrent=async()=>{if(signal.aborted)throw new Error("output_fal_recovery_canceled");await acknowledgedRecoveryBatch(env.DB,live().flatMap(a=>outputAssertionStatements(env,a)));};
  const privateEnv=guardOutputPrivateWrites(env,scope,slot,async()=>live(),{retentionPolicy:binding.retentionPolicy,onStorageStage:options.onStage});
  try{
    options.onStage?.("provider_read");
    const result=await readOutputFalImageResult(env,captured,receipt,{assertCurrent,signal,onStage:options.onStage});
    if(result.status==='pending')return{status:"pending" as const,jobId:job.job_id,slotId:slot.slotId,replayed:false};
    options.onStage?.("call_settle");
    await settleOutputProviderCall(env,{scopeKey:scope.key,slotId:slot.slotId,callKey:'image:initial',clientRequestId:checkpoint.clientRequestId,status:'settled',usedMicrousd:result.costBreakdown.totalMicrousd,providerResponseId:receipt.providerRequestId,assertions:live()});
    const paid={clientRequestId:checkpoint.clientRequestId,provider:'fal',operation:'image',model:contract.model,status:'completed',providerRequestId:receipt.providerRequestId,costMicrousd:result.costBreakdown.totalMicrousd,inputTokens:0,outputTokens:0,totalTokens:0};
    options.onStage?.("receipt_write");
    await acknowledgedRecoveryBatch(env.DB,[...live().flatMap(a=>outputAssertionStatements(env,a)),env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),?) WHERE job_id=? AND owner_id=?")
      .bind(JSON.stringify({providerSubmissions:{[checkpoint.clientRequestId]:paid}}),job.job_id,user.userId)]);
    options.onStage?.("account_settle");
    const settlement=await reconcileKnownOutputProviderReceipts(env,user,{jobId:job.job_id,assertions:live()});
    if(settlement.status==='uncertain')reject("output_fal_recovery_settlement_unavailable");
    await assertCurrent();
    options.onStage?.("storage_write");
    const media=await storeGeneratedImage(privateEnv,scope.ownerUserId,storageArtifactId,result.bytes,contract.model,'image/png',{generationId,provider:'fal',providerRequestId:receipt.providerRequestId,adapter:`${contract.adapterId}-${contract.adapterVersion}`});
    options.onStage?.("private_write");
    const output=await storePrivateContent(privateEnv,user.userId,'provider-output',planned.raw),prompt=await storePrivateContent(privateEnv,user.userId,'prompt',String(JSON.parse(captured.body).prompt));
    const objectId=`object-${generationId.slice(-8)}`,complete=makeEvent(job.stream_id,1,'worker:generator','output-fal-recovery',job.correlation_id,'GenerationCompleted',{
      ...provenance,
      generation_id:generationId,document_id:scope.documentId,model_id:contract.model,planner_model_id:contract.plannerModel,provider:'fal',provider_request_id:receipt.providerRequestId,provider_submission_id:checkpoint.clientRequestId,
      planner_response_id:planned.responseId,object_id:objectId,object_ids:[objectId],title:String(direction.title??'').trim(),output_ref:output.contentId,prompt_ref:prompt.contentId,prompt_technique:plan.promptTechnique,
      content_expires_at:output.expiresAt,media_url:media.url,media_type:media.mimeType,source_content_hash:media.contentHash,image_width:contract.width,image_height:contract.height,
      quality:'high',purpose:'final',source_surface:'outputs',reference_input_count:0,reference_inputs:[],adapter_version:`${contract.adapterId}-${contract.adapterVersion}`,simulation:false,recovered:true,
    },{causationId:compiled[0]!.eventId});
    const usageEvent=makeEvent(job.stream_id,2,'worker:policy','output-fal-recovery',job.correlation_id,'GenerationUsageRecorded',{
      generation_id:generationId,document_id:scope.documentId,reservation_id:slot.tokenReservationId,cost_reservation_id:slot.costReservationId,
      input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,total_tokens:usage.totalTokens,model_ids:[contract.plannerModel,contract.model],operation:'image-generation',quality:'high',
      cost_microusd:Number(planner.used_microusd)+result.costBreakdown.totalMicrousd,image_cost_precision:'provider-pixel-rate-estimate',image_pricing_version:contract.pricingVersion,recovered:true,
    },{causationId:complete.eventId});
    const ids=JSON.stringify([complete.eventId,usageEvent.eventId]);
    options.onStage?.("publish");
    try{
      await appendEvents(privateEnv,[complete,usageEvent],{retries:1,prepareSidecars:()=>[
        ...outputAssertionStatements(env,{sql:"(SELECT COUNT(*) FROM events WHERE event_id IN(SELECT value FROM json_each(?)))=2",bindings:[ids]}),
        env.DB.prepare(`UPDATE document_jobs SET status='completed',error_message=NULL,completed_at=?,lease_expires_at=NULL,
          result_json=json_set(json_patch(result_json,?),'$.appendedEventIds',json_insert(
            CASE WHEN json_type(result_json,'$.appendedEventIds')='array' THEN json_extract(result_json,'$.appendedEventIds') ELSE json('[]') END,
            '$[#]',?,'$[#]',?)),updated_at=? WHERE job_id=? AND owner_id=?`)
          .bind(new Date().toISOString(),JSON.stringify({stage:'completed',errorDetail:null,outputFalRecovery:{...lease,status:'completed',completionEventId:complete.eventId},generationReceipt:{provider_request_status:'completed'}}),complete.eventId,usageEvent.eventId,new Date().toISOString(),job.job_id,user.userId),
        ...prepareOutputJobOutcomeStatements(env,job),
      ]});
    }catch(error){
      if(await completedRead())return{status:'completed' as const,jobId:job.job_id,slotId:slot.slotId,replayed:true};
      options.onStage?.("publish");
      throw error;
    }
    return{status:'completed' as const,jobId:job.job_id,slotId:slot.slotId,replayed:false};
  }finally{
    // Token-fenced release never clears a newer lease or a completed receipt.
    await env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(result_json,'$.outputFalRecovery.expiresAt',?) WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputFalRecovery.token')=?`)
      .bind(new Date().toISOString(),job.job_id,user.userId,token).run().catch(()=>{});
  }
}
