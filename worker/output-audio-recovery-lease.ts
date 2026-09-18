import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { providerSubmissions, invalidProviderSubmissions } from "../src/model/provider-submission.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { captureOutputAudioAttempt, readOutputAudioPayload, outputAudioHash, verifyOutputAudioCalls, outputAudioPlannerCost } from "./output-audio-execution.ts";
import { outputPlannerResponseShape } from "./output-planner-response-shape.ts";
import { readOpenAITextUsage } from "./openai-text-cost.ts";
import { providerFacingCombinedContextPlan } from "./openai-adapter.ts";
import { parseDocumentArtifactContent, resolveDocumentArtifactContextGroups, documentArtifactValidationIssues } from "../src/model/document-artifacts.ts";
import { verifiedAudioRecoveryQueue, type CreativeAudioPreparedReceipt } from "./fal-audio-adapter.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parse=(value:string|null)=>object(JSON.parse(value??"{}"));
export type AudioRecoveryStage = "audio_binding" | "audio_authority" | "audio_identity" | "audio_request" | "audio_source" | "audio_ledger" | "audio_planner" | "audio_planner_usage" | "audio_planner_compile" | "audio_planner_plan" | "audio_lease" | "audio_provider" | "audio_settlement" | "audio_storage" | "audio_publish" | "audio_replay";
function refuse():never{throw new OutputConflictError("output_audio_recovery_unavailable",409);}
async function within<T>(operation:()=>Promise<T>,deadlineMs:number,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();if(!Number.isFinite(deadlineMs)||Date.now()>=deadlineMs)refuse();
 let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 const boundary=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("output_audio_recovery_deadline")),Math.max(0,deadlineMs-Date.now()));if(signal){abort=()=>reject(signal.reason??new Error("output_audio_recovery_aborted"));signal.addEventListener("abort",abort,{once:true});}});
 try{const value=await Promise.race([boundary,Promise.resolve().then(()=>{signal?.throwIfAborted();if(Date.now()>=deadlineMs)refuse();return operation();})]);signal?.throwIfAborted();if(Date.now()>=deadlineMs)refuse();return value;}
 finally{if(timer!==undefined)clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);}
}

/** Original read/publication custody only. A second worker attempt must retain
 * its real identity; this never resets attempts or creates a paid capability. */
export async function claimOutputAudioRecoveryLease(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,
 options:{assertions:OutputSqlAssertion[];signal?:AbortSignal;onStage?:(stage:AudioRecoveryStage)=>void}){
 const enteredAt=Date.now();scope=freeze(structuredClone(scope));slot=freeze(structuredClone(slot));job=freeze(structuredClone(job));options={signal:options.signal,onStage:options.onStage,assertions:structuredClone(options.assertions)};
 options.onStage?.("audio_identity");
 const deadlineMs=Math.min(enteredAt+120000,Date.parse(job.expires_at),...options.assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 if(!Number.isFinite(deadlineMs)||deadlineMs<=Date.now())refuse();
 const request=parse(job.request_json),cp=parse(job.result_json),contract=readOutputAudioPayload(request),execution=object(request.outputExecution),wire=object(cp.outputAudioRequest),audio=object(cp.audioInputReceipt),queue=object(audio.queue);
 const originalReceiptMap=JSON.stringify(cp.providerSubmissions);
 if(!contract||scope.kind!=="personal"||scope.actorUserId!==scope.ownerUserId||scope.contextId||scope.organizationId||scope.projectAccessId||!options.assertions.length
  ||job.kind!=="render_document"||job.source_surface!=="outputs"||job.status!=="failed"||job.owner_id!==scope.actorUserId||job.stream_id!==`creative:${scope.ownerUserId}`||job.document_id!==scope.documentId
  ||!Number.isSafeInteger(job.attempt_count)||job.attempt_count<1||job.attempt_count>2
  ||slot.jobId!==job.job_id||slot.scopeKey!==scope.key||slot.slotId!==job.output_slot_id||slot.attemptOrdinal!==0||slot.previousSlotId!==null
  ||execution.scopeKey!==scope.key||execution.slotId!==slot.slotId||execution.grantId!==slot.grantId
  ||typeof cp.artifactId!=="string"||!cp.artifactId||!cp.artifactPlan||typeof cp.plannerResponseId!=="string"||!cp.plannerResponseId
  ||Object.keys(wire).length!==4||canonicalJson(wire.contract)!==canonicalJson(contract)||typeof wire.requestBody!=="string"||typeof wire.clientRequestId!=="string"
  ||audio.provider!=="fal"||audio.model!=="fal-ai/stable-audio-3/medium/text-to-audio"||audio.provider_job_id!==cp.providerJobId||cp.providerModel!==audio.model
  ||audio.audio_waveform_submitted!==false||audio.image_reference!==null||Object.hasOwn(audio,"video_reference")
  ||cp.audioProviderSubmission!=="confirmed"||typeof cp.providerJobId!=="string"||invalidProviderSubmissions(cp)||cp.providerSubmissionLegacyUncertain===true||options.signal?.aborted)refuse();
 options.onStage?.("audio_request");
 const attempt=await within(()=>captureOutputAudioAttempt(contract,wire.requestBody as string,wire.clientRequestId as string,"audio:initial"),deadlineMs,options.signal);
 if(attempt.requestDigest!==wire.requestDigest||object(JSON.parse(wire.requestBody)).prompt!==audio.submitted_prompt)refuse();
 const urls=verifiedAudioRecoveryQueue(attempt.model,cp.providerJobId,{providerStatusUrl:String(cp.providerStatusUrl??""),providerResponseUrl:String(cp.providerResponseUrl??""),providerCancelUrl:String(cp.providerCancelUrl??"")});
 if(queue.status_url!==urls.statusUrl||queue.response_url!==urls.responseUrl||queue.cancel_url!==urls.cancelUrl)refuse();
 const parameters=object(audio.parameters),sourceIds=audio.source_audio_block_ids;
 if(!Array.isArray(sourceIds)||sourceIds.length>100||sourceIds.some(id=>typeof id!=="string"||!id||id.length>1024)
  ||audio.source_audio_treatment!==(sourceIds.length?"authored-description-only":"none")
  ||parameters.goal!==EXPERIENCE_AUDIO_INTENT.goal||parameters.destination!=="standalone"||parameters.duration_seconds!==20
  ||parameters.image_reference_count!==0||parameters.audio_waveform_submitted!==false||parameters.semantic_audio_reference_count!==sourceIds.length
  ||canonicalJson(parameters.provider_parameters)!==canonicalJson({duration:20,output_format:"mp3",enable_safety_checker:true,negative_prompt:"singing, vocals, spoken dialogue"})
  ||!Number.isSafeInteger(parameters.published_cost_microusd)||Number(parameters.published_cost_microusd)<=0)refuse();
 const token=crypto.randomUUID(),expiresAt=new Date(deadlineMs).toISOString();
 const immutable=["artifactId","artifactPlan","plannerResponseId","plannerInput","plannerUsage","audioInputReceipt","outputAudioRequest","outputExecution","providerJobId","providerModel","providerStatusUrl","providerResponseUrl","providerCancelUrl","audioProviderSubmission"];
 if(immutable.some(key=>cp[key]===undefined))refuse();
 const assertions:OutputSqlAssertion[]=[...options.assertions,...immutable.map(key=>({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,?) IS json_extract(?,'$') AND json_type(result_json,?)=json_type(?,'$'))",bindings:[job.job_id,"$."+key,JSON.stringify(cp[key]),"$."+key,JSON.stringify(cp[key])]})),{
  sql:`EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
   JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
   WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.request_json=? AND job.attempt_count=? AND job.expires_at=?
    AND job.status='failed' AND job.kind='render_document' AND job.source_surface='outputs' AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.target_contract_digest=? AND slot.source_digest=? AND slot.route_digest=?
    AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL AND slot.status IN('failed','uncertain')
    AND plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
    AND grant_row.actor_user_id=job.owner_id AND grant_row.context_id IS NULL AND grant_row.status IN('authorized','active','completed')
    AND (SELECT COUNT(*) FROM output_operation_slots siblings WHERE siblings.scope_key=slot.scope_key AND siblings.grant_id=slot.grant_id)=1
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots successor WHERE successor.scope_key=slot.scope_key AND successor.previous_slot_id=slot.slot_id)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind IN('job','document') AND resource.resource_id IN(job.job_id,job.document_id))
    AND NOT EXISTS(SELECT 1 FROM document_jobs other WHERE other.stream_id=job.stream_id AND other.document_id=job.document_id AND other.job_id<>job.job_id AND other.status IN('running','committing') AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  bindings:[job.job_id,scope.actorUserId,job.stream_id,job.document_id,job.correlation_id,job.request_json,job.attempt_count,job.expires_at,scope.key,slot.slotId,slot.grantId,slot.planRevisionId,slot.targetId,slot.targetContractDigest,slot.sourceDigest,slot.routeDigest]
 },{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[expiresAt],deadlineMs},
 {sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND COALESCE(json_extract(result_json,'$.providerSubmissionLegacyUncertain'),0)<>1)",bindings:[job.job_id]}];
 const originalMapAssertion:OutputSqlAssertion={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,'$.providerSubmissions')=json(?))",bindings:[job.job_id,originalReceiptMap]};
 const read=async<T>(statement:D1PreparedStatement)=>{const rows=await within(()=>env.DB.batch<T>([...[...assertions,originalMapAssertion].flatMap(a=>outputAssertionStatements(env,a)),statement]),deadlineMs,options.signal);return rows.at(-1)!.results;};
 options.onStage?.("audio_source");
 const generation=object(cp.generationReceipt),sourceRef=generation.input_ref;
 if(typeof sourceRef!=="string"||!sourceRef||typeof generation.source_snapshot_sha256!=="string")refuse();
 assertions.push({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,'$.generationReceipt.input_ref')=? AND json_extract(result_json,'$.generationReceipt.source_snapshot_sha256')=?)",bindings:[job.job_id,sourceRef,generation.source_snapshot_sha256]});
 const sourceRows=await read<{content:string;expires_at:string}>(env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL
  AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`).bind(sourceRef,scope.actorUserId));
 if(sourceRows.length!==1)refuse();
 const originalSource=sourceRows[0]!,source=parse(originalSource.content),snapshot=object(source.document_snapshot),sourceHash=await within(()=>outputAudioHash(JSON.stringify(snapshot)),deadlineMs,options.signal);
 if(source.job_id!==job.job_id||source.document_id!==job.document_id||source.artifact_kind!=="audio"
  ||sourceHash!==generation.source_snapshot_sha256||sourceHash!==object(source.source).snapshot_sha256
  ||canonicalJson(snapshot)!==canonicalJson(request.snapshot)||canonicalJson(source.source_block_versions)!==canonicalJson(request.sourceBlockVersions)
  ||source.production_workflow_snapshot||snapshot.canvas||snapshot.context_scope)refuse();
 assertions.push({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[sourceRef,scope.actorUserId,originalSource.content,originalSource.expires_at],deadlineMs:Date.parse(originalSource.expires_at)});
 options.onStage?.("audio_ledger");
 const calls=await read<Record<string,unknown>>(env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId));
 const media=calls.find(call=>call.call_key==="audio:initial"),planners=calls.filter(call=>String(call.call_key).startsWith("planning:"));
 const receipts=providerSubmissions(cp),mediaReceipt=receipts.find(call=>call.clientRequestId===attempt.clientRequestId);
 if(!media||calls.length!==planners.length+1||planners.length<1||planners.length>2||receipts.length!==calls.length
  ||media.stage_key!=="audio:initial"||media.provider!=="fal"||media.model!==attempt.model||media.client_request_id!==attempt.clientRequestId
  ||media.request_digest!==attempt.requestDigest||media.provider_response_id!==cp.providerJobId||!["uncertain","settled"].includes(String(media.status))
  ||!mediaReceipt||mediaReceipt.providerRequestId!==cp.providerJobId||mediaReceipt.operation!=="audio"||mediaReceipt.provider!=="fal"||mediaReceipt.model!==attempt.model
  ||mediaReceipt.unitId!=="audio:initial"||mediaReceipt.requestDigest!==attempt.requestDigest||!["accepted","completed"].includes(mediaReceipt.status)
  ||Number(parameters.published_cost_microusd)>Number(media.reserved_microusd))refuse();
 if(media.status==="settled"&&(mediaReceipt.status!=="completed"||media.used_microusd!==mediaReceipt.costMicrousd)
  ||media.status==="uncertain"&&media.used_microusd!==null
  ||mediaReceipt.status==="completed"&&(!Number.isSafeInteger(mediaReceipt.costMicrousd)||Number(mediaReceipt.costMicrousd)<=0||Number(mediaReceipt.costMicrousd)>Number(media.reserved_microusd)))refuse();
 const final=receipts.find(call=>call.unitId===(planners.length===2?"planning:0:repair":"planning:0:initial"));
 if(final?.providerRequestId!==cp.plannerResponseId)refuse();
 outputAudioPlannerCost(cp);
 const totals={inputTokens:0,outputTokens:0,totalTokens:0};
 for(const planned of planners){
  options.onStage?.("audio_planner");
  const receipt=receipts.find(call=>call.clientRequestId===planned.client_request_id);
  if(!receipt||planned.call_key!==planned.stage_key||!['planning:0:initial','planning:0:repair'].includes(String(planned.call_key))||planned.status!=="settled"
   ||planned.provider!=="openai"||planned.model!=="gpt-5.6-terra"||planned.provider_response_id!==receipt.providerRequestId||planned.used_microusd!==receipt.costMicrousd)refuse();
  const bodies=await read<{content:string;expires_at:string}>(env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND redacted_at IS NULL
   AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
   AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`).bind(receipt.responseRef!,scope.actorUserId));
  if(bodies.length!==1)refuse();const body=bodies[0]!,retained=parse(body.content),captured=object(retained.call);
  if(retained.job_id!==job.job_id||retained.document_id!==job.document_id||retained.stream_id!==job.stream_id||canonicalJson(retained.output_audio)!==canonicalJson(contract)
   ||captured.clientRequestId!==receipt.clientRequestId||captured.providerRequestId!==receipt.providerRequestId||typeof retained.raw_envelope!=="string"||typeof retained.output_text!=="string"
   ||await within(()=>outputAudioHash(retained.output_text as string),deadlineMs,options.signal)!==retained.content_sha256)refuse();
  const envelope=parse(retained.raw_envelope),usage=readOpenAITextUsage(envelope.usage,{cachePolicy:"disabled-explicit"});
  const message=(Array.isArray(envelope.output)?envelope.output:[]).map(object).find(row=>row.type==="message"),text=object(Array.isArray(message?.content)?message.content[0]:null).text;
  if(!outputPlannerResponseShape(envelope,"gpt-5.6-terra").valid||envelope.error||envelope.id!==receipt.providerRequestId
   ||retained.response_id!==receipt.providerRequestId||retained.model!==receipt.model||retained.artifact_kind!=="audio"||retained.candidate_truncated!==false
   ||text!==retained.output_text||Object.hasOwn(envelope,"output_text")&&envelope.output_text!==text
   ||retained.source_snapshot_sha256!==sourceHash||typeof retained.document_title!=="string")refuse();
  options.onStage?.("audio_planner_usage");
  for(const key of ["inputTokens","outputTokens","totalTokens"] as const){if(usage[key]!==receipt[key]||captured[key]!==receipt[key])refuse();totals[key]+=usage[key];if(!Number.isSafeInteger(totals[key]))refuse();}
  if(usage.cachedInputTokens!==receipt.cachedInputTokens||usage.cacheWriteTokens!==receipt.cacheWriteInputTokens
   ||usage.reasoningTokens!==(receipt.reasoningTokens??null)||captured.costMicrousd!==receipt.costMicrousd)refuse();
  // Reconstruct only the retained original compilation. A changed title or
  // standing constraint cannot be silently substituted from today's source.
  options.onStage?.("audio_planner_compile");
  const compiled={...snapshot,document:{id:job.document_id,title:retained.document_title}};
  if(await within(()=>outputAudioHash(JSON.stringify(compiled)),deadlineMs,options.signal)!==retained.compiled_snapshot_sha256)refuse();
  if(receipt.clientRequestId===final.clientRequestId){
   options.onStage?.("audio_planner_plan");
   const groups=providerFacingCombinedContextPlan(compiled,"audio").groups,groupContracts=groups.map((group,index)=>({id:group.id,alias:`context_group_${index+1}`}));
   const resolved=resolveDocumentArtifactContextGroups(parseDocumentArtifactContent(retained.output_text),groupContracts);
   if(documentArtifactValidationIssues("audio",resolved.output,{itemCount:1,contextGroupIds:groups.map(group=>group.id),unknownContextGroupAssignments:resolved.receipt.unknownAssignments,rawContextGroupAssignments:resolved.receipt.rawAssignments}).length
    ||canonicalJson(resolved.output)!==canonicalJson(cp.artifactPlan))refuse();
  }
  assertions.push({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[receipt.responseRef!,scope.actorUserId,body.content,body.expires_at]});
  assertions.push({sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND provider='openai' AND model='gpt-5.6-terra' AND client_request_id=? AND request_digest IS ? AND provider_response_id=? AND status='settled' AND used_microusd=?)",bindings:[scope.key,slot.slotId,String(planned.call_key),String(planned.stage_key),receipt.clientRequestId,String(planned.request_digest),receipt.providerRequestId!,receipt.costMicrousd!]});
 }
 // Older native progress retained the received "pending" validation label
 // over the later successful observation. Only repair that label after exact
 // original raw-response, usage, source, normalized-plan and final-validation
 // witnesses have all passed. No monetary or request identity is reconstructed.
 if(final.validationStatus==="pending"){
  const validation=object(object(cp.plannerInput).validation),history=Array.isArray(validation.validation_history)?validation.validation_history.map(object):[];
  const expectedIds=planners.map(planned=>receipts.find(call=>call.clientRequestId===planned.client_request_id)?.providerRequestId);
  const last=history.at(-1),repaired=planners.length===2;
  const finalIssues=repaired?validation.repair_issues:validation.initial_issues,reconciliation=object(validation.adapter_reconciliation);
  if(final.completionStatus!=="completed"||canonicalJson(validation.provider_response_ids)!==canonicalJson(expectedIds)
   ||new Set(expectedIds).size!==expectedIds.length||history.length!==planners.length
   ||history.some((entry,index)=>entry.stage!==(index===0?"initial":"repair")||entry.provider_attempt!==index+1)
   ||final.validationIssueCount!==undefined&&final.validationIssueCount!==0
   ||validation.provider_call_count!==planners.length||validation.repair_attempted!==repaired
   ||validation.repair_response_id!==(repaired?final.providerRequestId:null)
   ||!last||last.stage!==(repaired?"repair":"initial")||last.provider_attempt!==planners.length||last.issue_count!==0
   ||!Array.isArray(last.issues)||last.issues.length!==0
   ||!Array.isArray(finalIssues)||finalIssues.length!==0
   ||reconciliation.artifact_kind!=="audio"||reconciliation.adapter_id!=="openai-document"||reconciliation.final_issue_count!==0)refuse();
  final.validationStatus="valid";final.validationIssueCount=0;
 }
 verifyOutputAudioCalls(receipts.map(call=>call===mediaReceipt&&call.status!=="completed"?{...call,status:"completed",costMicrousd:Number(parameters.published_cost_microusd),totalTokens:0}:call),contract);
 if((["inputTokens","outputTokens","totalTokens"] as const).some(key=>object(cp.plannerUsage)[key]!==totals[key]))refuse();
 assertions.push({sql:`(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=? AND EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='audio:initial' AND stage_key='audio:initial' AND provider='fal' AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND reserved_microusd=? AND status IN('uncertain','settled'))`,bindings:[scope.key,slot.slotId,calls.length,scope.key,slot.slotId,attempt.model,attempt.clientRequestId,attempt.requestDigest,cp.providerJobId,Number(media.reserved_microusd)]});
 const lease={version:"output-audio-recovery-v1",token,expiresAt,storageKey:`${ownerMediaNamespace(scope.ownerUserId)}/generated/${cp.artifactId}.mp3`,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,providerRequestId:cp.providerJobId};
 options.onStage?.("audio_lease");
 const validatedReceiptMap=JSON.stringify(cp.providerSubmissions);
 let receiptMap=originalReceiptMap,settledCost=mediaReceipt.status==="completed"?Number(mediaReceipt.costMicrousd):null,allowUncertain=media.status==="uncertain";
 const finance=():OutputSqlAssertion[]=>[{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,'$.providerSubmissions')=json(?))",bindings:[job.job_id,receiptMap]},
  {sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='audio:initial' AND ((?=1 AND status='uncertain' AND used_microusd IS NULL) OR (status='settled' AND used_microusd=?)))",bindings:[scope.key,slot.slotId,Number(allowUncertain),settledCost]}];
 await within(()=>env.DB.batch([...assertions,...finance()].flatMap(a=>outputAssertionStatements(env,a)).concat(env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(result_json,'$.outputAudioRecovery',json(?),'$.providerSubmissions',json(?)) WHERE job_id=? AND owner_id=? AND result_json IS ?
  AND (json_type(result_json,'$.outputAudioRecovery') IS NULL OR json_extract(result_json,'$.outputAudioRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(JSON.stringify(lease),validatedReceiptMap,job.job_id,scope.actorUserId,job.result_json),...outputAssertionStatements(env,{sql:"changes()=1"}))),deadlineMs,options.signal);
 receiptMap=validatedReceiptMap;
 const live=()=>structuredClone([...assertions,...finance(),{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputAudioRecovery.token')=? AND json_extract(result_json,'$.outputAudioRecovery.expiresAt')=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[job.job_id,scope.actorUserId,token,expiresAt,expiresAt],deadlineMs}]);
 const prepared:CreativeAudioPreparedReceipt={provider:"fal",model:attempt.model,submittedPrompt:String(audio.submitted_prompt),parameters,imageReference:null,sourceAudioTreatment:sourceIds.length?"authored-description-only":"none",audioWaveformSubmitted:false};
 return Object.freeze({token,expiresAt,deadlineMs,lease:freeze(lease),contract,attempt,prepared:freeze(prepared),urls:freeze(urls),checkpoint:freeze(cp),receipts:freeze(receipts),providerRequestId:cp.providerJobId,assertions:live,
  async assertCurrent(){await within(()=>env.DB.batch(live().flatMap(a=>outputAssertionStatements(env,a))),deadlineMs,options.signal);},
  async assertSettled(){allowUncertain=false;await within(()=>env.DB.batch(live().flatMap(a=>outputAssertionStatements(env,a))),deadlineMs,options.signal);},
  async recordCompletedMedia(costMicrousd:number){
   if(!Number.isSafeInteger(costMicrousd)||costMicrousd<=0||costMicrousd>Number(media.reserved_microusd)||settledCost!==null&&settledCost!==costMicrousd)refuse();
   const map=JSON.parse(receiptMap);map[attempt.clientRequestId]={...map[attempt.clientRequestId],status:"completed",costMicrousd,inputTokens:0,outputTokens:0,totalTokens:0};const next=JSON.stringify(map);
   await within(()=>env.DB.batch([...live().flatMap(a=>outputAssertionStatements(env,a)),env.DB.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions',json(?)) WHERE job_id=? AND owner_id=?").bind(next,job.job_id,scope.actorUserId)]),deadlineMs,options.signal);
   receiptMap=next;settledCost=costMicrousd;return freeze(providerSubmissions({providerSubmissions:map}));
  },
  async release(){await within(()=>env.DB.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputAudioRecovery.expiresAt',?) WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputAudioRecovery.token')=?").bind(new Date().toISOString(),job.job_id,scope.actorUserId,token).run(),Date.now()+2000);}
 });
}
