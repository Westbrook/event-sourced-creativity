import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { captureExperienceAudioEvidence, verifyExperienceAudioInput } from "../src/experiences/audio-native-result.ts";
import { providerSubmissions, invalidProviderSubmissions, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { audioDurationMetadata, MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";
import { claimOutputAudioRecoveryLease, type AudioRecoveryStage } from "./output-audio-recovery-lease.ts";
import { recoverAcceptedAudio } from "./fal-audio-adapter.ts";
import { outputAudioHash, verifyOutputAudioCalls } from "./output-audio-execution.ts";
import { loadOutputJobBinding, reconcileKnownOutputProviderReceipts, prepareOutputJobOutcomeStatements } from "./output-execution-control.ts";
import { resolveOutputAudioRecoveryAuthority } from "./output-requirements-api.ts";
import { guardOutputPrivateWrites } from "./output-private-execution.ts";
import { outputAssertionStatements, OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { storeGeneratedMedia } from "./media-api.ts";
import { storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { makeEvent, appendEvents, type WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parse=(value:string|null)=>object(JSON.parse(value??"{}"));
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function fail(code="output_audio_recovery_unavailable"):never{throw new OutputConflictError(code,409);}
type Binding=NonNullable<Awaited<ReturnType<typeof loadOutputJobBinding>>>;
type Options={assertions:OutputSqlAssertion[];signal?:AbortSignal;onStage?:(stage:AudioRecoveryStage)=>void};
type UsageRow={event_id:string;sequence:number;actor:string;correlation_id:string;private_json:string;owner_id:string;document_id:string;redacted_at:string|null};

/** A stalled fetch/body cannot keep an original-recovery request alive. The
 * same signal also fences late adapter work; no paid operation is present. */
export async function withinAudioRecovery<T>(operation:(signal:AbortSignal)=>Promise<T>,deadlineMs:number,parent?:AbortSignal):Promise<T>{
 parent?.throwIfAborted();if(!Number.isFinite(deadlineMs)||Date.now()>=deadlineMs)fail("output_audio_recovery_deadline");
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const abort=()=>controller.abort(parent?.reason??new Error("output_audio_recovery_aborted"));
 parent?.addEventListener("abort",abort,{once:true});
 const boundary=new Promise<never>((_resolve,reject)=>{
  controller.signal.addEventListener("abort",()=>reject(controller.signal.reason),{once:true});
  timer=setTimeout(()=>controller.abort(new Error("output_audio_recovery_deadline")),Math.max(0,deadlineMs-Date.now()));
 });
 try{const value=await Promise.race([boundary,Promise.resolve().then(()=>{controller.signal.throwIfAborted();return operation(controller.signal);})]);controller.signal.throwIfAborted();if(Date.now()>=deadlineMs)fail("output_audio_recovery_deadline");return value;}
 finally{if(timer!==undefined)clearTimeout(timer);parent?.removeEventListener("abort",abort);controller.abort(new Error("output_audio_recovery_finished"));}
}

/** Validate every original-job usage row before subtracting anything. Exact
 * typed attempt correlations include the historical attempt, never a prefix. */
export function remainingAudioRecoveryUsage(rows:UsageRow[],identity:{jobId:string;attempt:number;ownerId:string;documentId:string;artifactId:string;tokenId:string;costId:string;providerId:string},calls:readonly PaidProviderSubmission[]){
 if(!Number.isSafeInteger(identity.attempt)||identity.attempt<1||identity.attempt>2)fail("output_audio_recovery_usage_conflict");
 const correlations=new Set([identity.jobId,...Array.from({length:identity.attempt},(_,i)=>`${identity.jobId}:attempt:${i+1}`)]);
 const plannerIds=new Set(calls.filter(call=>call.operation==="planning").map(call=>call.providerRequestId));
 const expected={input_tokens:0,output_tokens:0,total_tokens:0,cost_microusd:0};
 for(const call of calls){for(const [key,field] of [["input_tokens","inputTokens"],["output_tokens","outputTokens"],["total_tokens","totalTokens"],["cost_microusd","costMicrousd"]] as const){if(!integer(call[field]))fail("output_audio_recovery_usage_conflict");expected[key]+=call[field];if(!integer(expected[key]))fail("output_audio_recovery_usage_conflict");}}
 const remaining={...expected};
 if(rows.length>64||!Number.isSafeInteger(identity.attempt)||identity.attempt<1||identity.attempt>2)fail("output_audio_recovery_usage_conflict");
 const ids=new Set<string>();
 for(const row of rows){
  const payload=parse(row.private_json);
  if(ids.has(row.event_id)||row.actor!=="worker:policy"||!correlations.has(row.correlation_id)||row.owner_id!==identity.ownerId||row.document_id!==identity.documentId||row.redacted_at!==null
   ||payload.document_id!==identity.documentId||payload.artifact_id!==identity.artifactId||payload.artifact_kind!=="audio"
   ||!["document-render:audio","document-render:audio:failed-plan"].includes(String(payload.operation))
   ||payload.reservation_id!==identity.tokenId||payload.cost_reservation_id!==identity.costId||!plannerIds.has(String(payload.planner_response_id))
   ||payload.provider_job_id!==null&&payload.provider_job_id!==undefined&&payload.provider_job_id!==identity.providerId)fail("output_audio_recovery_usage_conflict");
  ids.add(row.event_id);
  for(const key of Object.keys(expected) as (keyof typeof expected)[]){const amount=payload[key];if(!integer(amount)||amount>remaining[key])fail("output_audio_recovery_usage_conflict");remaining[key]-=amount;}
 }
 return remaining;
}

/** Explicit original accepted request only: no planner, POST, cancellation,
 * dispatch capability, reservation or automatic replacement is reachable. */
export async function recoverOutputAudio(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,options:Options){
 const deadlineMs=Math.min(Date.now()+120000,Date.parse(job.expires_at),...options.assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 const captured={user:structuredClone(user),job:structuredClone(job),assertions:structuredClone(options.assertions)};
 return withinAudioRecovery(async signal=>{
  options.onStage?.("audio_binding");
  const binding=await loadOutputJobBinding(env,captured.user,captured.job);signal.throwIfAborted();if(!binding)fail();
  options.onStage?.("audio_authority");
  const proof=await resolveOutputAudioRecoveryAuthority(env,binding.scope,binding.slot);signal.throwIfAborted();
  return executeOutputAudioRecovery(env,captured.user,captured.job,binding,{signal,onStage:options.onStage,assertions:[...proof.assertions,...captured.assertions,{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(deadlineMs).toISOString()],deadlineMs}]});
 },deadlineMs,options.signal);
}

export async function executeOutputAudioRecovery(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,binding:Binding,options:Options){
 const entered=Date.now(),deadlineMs=Math.min(entered+120000,Date.parse(job.expires_at),...options.assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 const captured={job:structuredClone(job),binding:structuredClone(binding),user:structuredClone(user),assertions:structuredClone(options.assertions)};
 return withinAudioRecovery(signal=>execute(env,captured.user,captured.job,captured.binding,{assertions:captured.assertions,signal,onStage:options.onStage}),deadlineMs,options.signal);
}

async function execute(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,binding:Binding,options:Options&{signal:AbortSignal}){
 const {scope,slot}=binding;if(scope.actorUserId!==user.userId||scope.kind!=="personal"||!options.assertions.length)fail();
 const settings=parse(job.request_json),original=parse(job.result_json),artifactId=original.artifactId;
 if(typeof artifactId!=="string"||!artifactId||!original.artifactPlan)fail();
 const key=`${ownerMediaNamespace(scope.ownerUserId)}/generated/${artifactId}.mp3`,mediaUrl=`/api/media/${encodeURIComponent(key)}`;
 const currentJob=()=>env.DB.prepare("SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?").bind(job.job_id,scope.actorUserId).first<DocumentJobRow>();
 const completions=async()=>{
  const result=await env.DB.prepare(`SELECT event.event_id,event.sequence,event.actor,event.correlation_id,body.private_json,body.owner_id,body.document_id,body.redacted_at
   FROM events event LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
   WHERE event.stream_id=? AND event.correlation_id IN(?,?,?) AND event.type='DocumentRenderCompleted' ORDER BY event.sequence LIMIT 2`)
   .bind(job.stream_id,job.job_id,`${job.job_id}:attempt:1`,job.attempt_count===2?`${job.job_id}:attempt:2`:job.job_id).all<UsageRow>();
  if(result.results.length>1)fail("output_audio_recovery_duplicate_completion");
  const row=result.results[0];if(row&&(row.actor!=="worker:renderer"||row.owner_id!==scope.actorUserId||row.document_id!==scope.documentId||row.redacted_at!==null||typeof row.private_json!=="string"||new TextEncoder().encode(row.private_json).length>1048576))fail();
  return row??null;
 };
 const {confirmed:_confirmed,providerTransferConfirmed:_transfer,...costPreview}=object(settings.audioCostConsent);
 const expected=(calls:readonly PaidProviderSubmission[],cp:Record<string,unknown>)=>({documentId:scope.documentId,projectId:scope.projectId,artifactId,jobId:job.job_id,plannerResponseId:String(cp.plannerResponseId),source:object(settings.outputAudio).source as never,costPreview,
  usedMicrousd:calls.reduce((sum,call)=>sum+Number(call.costMicrousd),0),usedCalls:calls.length,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest});
 const reservations=(calls:readonly PaidProviderSubmission[]):OutputSqlAssertion=>{
  const cost=calls.reduce((n,c)=>n+Number(c.costMicrousd),0),tokens=calls.reduce((n,c)=>n+Number(c.totalTokens),0);if(!integer(cost)||!integer(tokens))fail();
  return{sql:`EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   JOIN budget_reservations token ON token.reservation_id=slot.token_reservation_id
   JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
   WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=? AND token.reservation_id=? AND cost.reservation_id=?
    AND grant_row.payer_user_id=? AND token.owner_id=grant_row.payer_user_id AND cost.owner_id=token.owner_id
    AND token.stream_id=? AND cost.stream_id=token.stream_id AND token.correlation_id=? AND cost.correlation_id=token.correlation_id
    AND token.period=cost.period AND token.operation='document-render:audio' AND cost.operation=token.operation AND cost.workspace_id='forma'
    AND token.status=? AND cost.status='settled' AND token.used_tokens=? AND cost.used_microusd=?
    AND token.reserved_tokens>=token.used_tokens AND cost.reserved_microusd>=cost.used_microusd
    AND NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_id IN(token.reservation_id,cost.reservation_id)))`,
   bindings:[scope.key,slot.slotId,job.job_id,slot.tokenReservationId,slot.costReservationId,user.billingUserId??user.userId,job.stream_id,job.correlation_id,tokens?"settled":"released",tokens,cost]};
 };
 const readCompletion=async(row:UsageRow,assertions:OutputSqlAssertion[])=>{
  const payload=parse(row.private_json),evidence=captureExperienceAudioEvidence(payload.settings);
  if(!evidence||payload.artifact_kind!=="audio"||payload.artifact_id!==artifactId||payload.document_id!==scope.documentId||payload.project_id!==scope.projectId||payload.requested_by_user_id!==scope.actorUserId
   ||payload.source_surface!=="outputs"||payload.media_url!==mediaUrl||payload.media_type!=="audio/mpeg"||typeof payload.content_ref!=="string"||typeof payload.input_ref!=="string")fail();
  const rows=await env.DB.prepare(`SELECT content_id,kind,content,expires_at FROM private_content WHERE content_id IN(?,?) AND owner_id=? AND redacted_at IS NULL
   AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
   AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`).bind(payload.content_ref,payload.input_ref,scope.actorUserId).all<{content_id:string;kind:string;content:string;expires_at:string}>();
  const content=rows.results.find(r=>r.content_id===payload.content_ref&&r.kind==="document-artifact"),input=rows.results.find(r=>r.content_id===payload.input_ref&&r.kind==="document-artifact-input");
  const live=await currentJob();if(!content||!input||!live||content.content!==JSON.stringify(original.artifactPlan))fail();
  const cp=parse(live.result_json),calls=providerSubmissions(cp);
  if(invalidProviderSubmissions(cp)||cp.providerSubmissionLegacyUncertain===true)fail();
  verifyOutputAudioCalls(calls,evidence.contract);
  const ledger=(await env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId).all<Record<string,unknown>>()).results;
  if(ledger.length!==calls.length||ledger.some(row=>{const call=calls.find(call=>call.clientRequestId===row.client_request_id);return !call||row.call_key!==call.unitId||row.stage_key!==call.unitId||row.provider!==call.provider||row.model!==call.model||row.status!=="settled"||row.provider_response_id!==call.providerRequestId||row.used_microusd!==call.costMicrousd||call.requestDigest!==undefined&&row.request_digest!==call.requestDigest;}))fail();
  const settled:OutputSqlAssertion[]=[{sql:"(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=?",bindings:[scope.key,slot.slotId,calls.length]},...ledger.map(row=>({sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND provider=? AND model=? AND client_request_id=? AND request_digest IS ? AND provider_response_id=? AND status='settled' AND used_microusd=?)",bindings:[scope.key,slot.slotId,String(row.call_key),String(row.stage_key),String(row.provider),String(row.model),String(row.client_request_id),row.request_digest===null?null:String(row.request_digest),String(row.provider_response_id),Number(row.used_microusd)]}))];
  settled.push({sql:"EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id=?)",bindings:[scope.key,slot.slotId,key,evidence.mediaSha256,row.event_id]});
  if(!await verifyExperienceAudioInput(input.content,evidence,expected(calls,cp)))fail("output_audio_recovery_input_invalid");
  const media=await env.MEDIA.get(key);options.signal.throwIfAborted();
  if(!media||!Number.isSafeInteger(media.size)||Number(media.size)<=0||Number(media.size)>MAX_AUDIO_UPLOAD_BYTES||media.customMetadata?.ownerId!==scope.actorUserId||media.customMetadata?.artifactId!==artifactId||media.customMetadata?.sha256!==evidence.mediaSha256)fail("output_audio_recovery_media_changed");
  const reader=media.body.getReader(),chunks:Uint8Array[]=[];let length=0,done=false;
  try{for(;;){options.signal.throwIfAborted();const next=await reader.read();options.signal.throwIfAborted();if(next.done){done=true;break;}length+=next.value.byteLength;if(length>Number(media.size)||length>MAX_AUDIO_UPLOAD_BYTES)fail("output_audio_recovery_media_changed");chunks.push(next.value);}}
  finally{if(!done)void reader.cancel().catch(()=>{});reader.releaseLock();}
  if(length!==media.size)fail("output_audio_recovery_media_changed");const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(!bytes.length||bytes.length>MAX_AUDIO_UPLOAD_BYTES||Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("")!==evidence.mediaSha256)fail("output_audio_recovery_media_changed");
  const guards=[...assertions,...settled,reservations(calls),...rows.results.map(r=>({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[r.content_id,scope.actorUserId,r.kind,r.content,r.expires_at]})),
   {sql:"EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.event_id=? AND event.stream_id=? AND event.correlation_id=? AND event.type='DocumentRenderCompleted' AND event.actor='worker:renderer' AND body.owner_id=? AND body.document_id=? AND body.private_json=? AND body.redacted_at IS NULL)",bindings:[row.event_id,job.stream_id,row.correlation_id,scope.actorUserId,scope.documentId,row.private_json]},
   {sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND request_json=? AND result_json IS ? AND attempt_count=? AND correlation_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[job.job_id,scope.actorUserId,job.request_json,live.result_json,job.attempt_count,job.correlation_id]}];
  await env.DB.batch(guards.flatMap(a=>outputAssertionStatements(env,a)));options.signal.throwIfAborted();return guards;
 };
 const completedRead=async()=>{
  options.onStage?.("audio_replay");
  const live=await currentJob();if(live?.status!=="completed")return null;
  const row=await completions();if(!row)fail();
  await readCompletion(row,[...options.assertions,{sql:"EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE job.job_id=? AND job.status='completed' AND slot.slot_id=? AND slot.scope_key=? AND slot.status='succeeded' AND grant_row.status='completed')",bindings:[job.job_id,slot.slotId,scope.key]}]);
  return{status:"completed" as const,jobId:job.job_id,slotId:slot.slotId,replayed:true};
 };
 if(job.status==="completed")return await completedRead()??fail();
 const lease=await claimOutputAudioRecoveryLease(env,scope,slot,job,options);
 let additional:OutputSqlAssertion[]=[];const live=()=>[...lease.assertions(),...additional];
 const privateEnv=guardOutputPrivateWrites(env,scope,slot,async()=>{options.signal.throwIfAborted();await lease.assertCurrent();return live();},{retentionPolicy:binding.retentionPolicy,audioRecoveryStorage:{token:lease.token,storageKey:key,signal:options.signal}});
 const finish=(completionId:string,eventIds:string[])=>{const now=new Date().toISOString();return[
  env.DB.prepare("UPDATE document_jobs SET status='completed',error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=?,result_json=json_patch(result_json,?) WHERE job_id=? AND owner_id=? AND status='failed' AND attempt_count=? AND correlation_id=?")
   .bind(now,now,JSON.stringify({artifactId,artifactKind:"audio",stage:"completed",errorDetail:null,appendedEventIds:eventIds,outputAudioRecovery:{status:"completed",completionEventId:completionId},generationReceipt:{provider_request_status:"completed"}}),job.job_id,scope.actorUserId,job.attempt_count,job.correlation_id),
  ...outputAssertionStatements(env,{sql:"changes()=1"}),...prepareOutputJobOutcomeStatements(env,job),
  env.DB.prepare("UPDATE output_operation_slots SET outcome_event_id=? WHERE scope_key=? AND slot_id=? AND job_id=? AND status='succeeded'").bind(completionId,scope.key,slot.slotId,job.job_id),
 ];};
 try{
  const previous=await completions();
  if(previous){await reconcileKnownOutputProviderReceipts(env,user,{jobId:job.job_id,assertions:live()});await lease.assertSettled();const proof=await readCompletion(previous,live());await env.DB.batch([...proof.flatMap(a=>outputAssertionStatements(env,a)),...finish(previous.event_id,[previous.event_id])]);return await completedRead()??fail();}
  options.onStage?.("audio_provider");
  const audio=await recoverAcceptedAudio(env,{providerJobId:lease.providerRequestId,providerModel:lease.attempt.model,providerStatusUrl:lease.urls.statusUrl,providerResponseUrl:lease.urls.responseUrl,providerCancelUrl:lease.urls.cancelUrl,
   retainedReceipt:lease.prepared,profile:EXPERIENCE_AUDIO_INTENT,signal:options.signal,onBeforeSourceTransmission:()=>lease.assertCurrent()});
  options.signal.throwIfAborted();await lease.assertCurrent();
  if(audio.mimeType!=="audio/mpeg"||audio.providerJobId!==lease.providerRequestId||audio.model!==lease.attempt.model)fail("output_audio_recovery_result_invalid");
  options.onStage?.("audio_settlement");
  const calls=await lease.recordCompletedMedia(audio.costMicrousd),receipt=verifyOutputAudioCalls([...calls],lease.contract);
  const settlement=await reconcileKnownOutputProviderReceipts(env,user,{jobId:job.job_id,assertions:live()});if(settlement.status==="uncertain")fail("output_audio_recovery_settlement_unavailable");
  await lease.assertSettled();
  const settledReservations=reservations(calls);additional.push(settledReservations);
  await env.DB.batch(live().flatMap(a=>outputAssertionStatements(env,a)));options.signal.throwIfAborted();
  if(audio.lyrics.trim())fail("output_audio_recovery_result_invalid");
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(audio.bytes).buffer)),b=>b.toString(16).padStart(2,"0")).join("");
  const existing=await env.MEDIA.head(key);await lease.assertCurrent();
  if(existing&&(existing.customMetadata?.ownerId!==scope.actorUserId||existing.customMetadata?.artifactId!==artifactId||existing.customMetadata?.sha256!==hash))fail("output_audio_recovery_media_changed");
  const cp=lease.checkpoint,plan=object(cp.artifactPlan),input={schema_version:1,artifact_id:artifactId,artifact_kind:"audio",document_id:scope.documentId,project_id:scope.projectId,
   request:{item_count:1,source_surface:"outputs",production_mode:"manual",audio_profile:EXPERIENCE_AUDIO_INTENT,audio_image_block_id:null,audio_video_artifact_id:null,audio_video_provider_transfer:false,soundtrack_provider_transfer:false,soundtrack_block_ids:[]},
   output_audio:lease.contract,output_audio_execution:settings.outputExecution,output_audio_calls:calls,output_audio_request:cp.outputAudioRequest,
   planner:{...object(cp.plannerInput),provider:"openai",model:"gpt-5.6-terra",response_id:cp.plannerResponseId},render:cp.audioInputReceipt};
  const completionSettings={output_audio:lease.contract,output_audio_execution:settings.outputExecution,output_audio_receipt:receipt,source_media_sha256:hash};
  const raw=JSON.stringify(plan),rawInput=JSON.stringify(input),evidence=captureExperienceAudioEvidence(completionSettings);
  if(!evidence||!await verifyExperienceAudioInput(rawInput,evidence,expected(calls,cp)))fail("output_audio_recovery_input_invalid");
  const priorRows=(await env.DB.prepare(`SELECT event.event_id,event.sequence,event.actor,event.correlation_id,body.private_json,body.owner_id,body.document_id,body.redacted_at
   FROM events event LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
   WHERE event.stream_id=? AND event.type='GenerationUsageRecorded' AND event.correlation_id IN(?,?,?) ORDER BY event.sequence LIMIT 65`)
   .bind(job.stream_id,job.job_id,`${job.job_id}:attempt:1`,job.attempt_count===2?`${job.job_id}:attempt:2`:job.job_id).all<UsageRow>()).results;
  const priorSnapshot=JSON.stringify(priorRows);if(new TextEncoder().encode(priorSnapshot).length>1048576)fail("output_audio_recovery_usage_conflict");
  const remaining=remainingAudioRecoveryUsage(priorRows,{jobId:job.job_id,attempt:job.attempt_count,ownerId:scope.actorUserId,documentId:scope.documentId,artifactId,tokenId:slot.tokenReservationId,costId:slot.costReservationId,providerId:lease.providerRequestId},calls);
  additional=[settledReservations,{sql:`(SELECT COUNT(*) FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND correlation_id IN(?,?,?))=?
   AND (SELECT COUNT(*) FROM json_each(?) saved JOIN events event ON event.event_id=json_extract(saved.value,'$.event_id') AND event.sequence=json_extract(saved.value,'$.sequence') AND event.actor=json_extract(saved.value,'$.actor') AND event.correlation_id=json_extract(saved.value,'$.correlation_id') AND event.stream_id=? AND event.type='GenerationUsageRecorded'
    JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.document_id=? AND body.private_json=json_extract(saved.value,'$.private_json') AND body.redacted_at IS NULL)=?
   AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='DocumentRenderCompleted' AND correlation_id IN(?,?,?))`,bindings:[job.stream_id,job.job_id,`${job.job_id}:attempt:1`,job.attempt_count===2?`${job.job_id}:attempt:2`:job.job_id,priorRows.length,priorSnapshot,job.stream_id,scope.actorUserId,scope.documentId,priorRows.length,job.stream_id,job.job_id,`${job.job_id}:attempt:1`,job.attempt_count===2?`${job.job_id}:attempt:2`:job.job_id]}];
  options.onStage?.("audio_storage");
  const stored=await storeGeneratedMedia(privateEnv,scope.actorUserId,artifactId,audio.bytes,audio.model,"audio/mpeg",{artifactRole:"document-audio",artifactId,provider:"fal",providerJobId:lease.providerRequestId});
  const content=await storePrivateContent(privateEnv,scope.actorUserId,"document-artifact",raw),inputStored=await storePrivateContent(privateEnv,scope.actorUserId,"document-artifact-input",rawInput);
  const complete=makeEvent(job.stream_id,1,"worker:renderer","output-audio-recovery",job.correlation_id,"DocumentRenderCompleted",{artifact_id:artifactId,artifact_kind:"audio",document_id:scope.documentId,project_id:scope.projectId,requested_by_user_id:scope.actorUserId,title:String(plan.title??""),summary:String(plan.summary??""),
   content_ref:content.contentId,content_expires_at:content.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:1,items:[{id:`${artifactId}-item-1`,media_url:stored.url,media_type:"audio/mpeg"}],media_url:stored.url,media_type:"audio/mpeg",provider:"fal",provider_job_id:lease.providerRequestId,model_id:audio.model,planner_model_id:"gpt-5.6-terra",planner_response_id:cp.plannerResponseId,source_surface:"outputs",recovered:true,
   settings:{...completionSettings,item_count:1,production_mode:"manual",audio_provider_model:audio.model,audio_profile:EXPERIENCE_AUDIO_INTENT,lyrics:"",...audioDurationMetadata(stored,20),audio_content_sha256:await outputAudioHash(raw),audio_input_sha256:await outputAudioHash(rawInput)}});
  const usage=makeEvent(job.stream_id,2,"worker:policy","output-audio-recovery",job.correlation_id,"GenerationUsageRecorded",{operation:"document-render:audio",artifact_id:artifactId,artifact_kind:"audio",document_id:scope.documentId,reservation_id:slot.tokenReservationId,cost_reservation_id:slot.costReservationId,...remaining,planner_response_id:cp.plannerResponseId,provider_job_id:lease.providerRequestId,model_ids:["gpt-5.6-terra",audio.model],source_surface:"outputs",recovered:true},{causationId:complete.eventId});
  await lease.assertCurrent();options.signal.throwIfAborted();
  options.onStage?.("audio_publish");
  await appendEvents(privateEnv,[complete,usage],{retries:1,prepareSidecars:()=>[...outputAssertionStatements(env,{sql:"(SELECT COUNT(*) FROM events WHERE event_id IN(?,?))=2",bindings:[complete.eventId,usage.eventId]}),...finish(complete.eventId,[complete.eventId,usage.eventId])]});
  return await completedRead()??fail();
 }finally{void lease.release().catch(()=>{});}
}
