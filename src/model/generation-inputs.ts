import { safePresentationProviderLabels } from "./generation-execution-evidence.ts";
import type { DocumentArtifact } from "./document-artifacts";
import type { CreativeEvent, CreativeOutput } from "./events";
import type { DocumentJob } from "./document-jobs";
import { isSceneMedium } from "./scene-configuration.ts";
import { generationExecutionSummary, managedProductionInputEvidence } from "./generation-execution-evidence.ts";

export type GenerationInputInspection = {
  title: string;
  subtitle: string;
  prompt: string;
  receipt: Record<string, unknown>;
  retained: boolean;
  outcome?: "completed" | "failed" | "in_progress";
  /** System-owned presentation metadata; retained title, subtitle and receipt stay unchanged. */
  systemHeader?: { format: "scene"; attemptCount: number };
};

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parsedRecord=(value:string|undefined)=>{if(!value)return null;try{return record(JSON.parse(value));}catch{return null;}};
const promptTechniqueLabel=(value:unknown)=>({prose:"Narrative prose",bullets:"Prose as bullets",json:"Structured JSON",xml:"XML node set"}[String(value??"")]??"Narrative prose");
const textOrNull=(value:unknown)=>typeof value==="string"&&value.trim()?value:null;
const numberOrNull=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:null;

const GENERATION_RECEIPT_SETTING_KEYS=["item_count","requested_slide_count","authored_slide_count","predicted_slide_count","batch_count","minimum_provider_call_count","planned_provider_call_count","max_repair_call_count","maximum_provider_call_count","reservation_microusd","audience","tone","production_mode","presentation_style","presentation_fidelity","presentation_brand","brand","brand_name","brand_style","typography","font_family"] as const;
const SCENE_CONFIGURATION_FORMATS=new Set(["image","short_story","scene","slides","storyboard","video","audio"]);

/** Keep alternate-version intent inspectable without trusting references hidden in request metadata. */
function safeSceneConfiguration(value:unknown){
  const configuration=record(value);
  if(!isSceneMedium(configuration.medium))return null;
  const source=configuration.source;
  if(source!=="manual"&&source!=="production-path")return null;
  const requestedTarget=configuration.targetFormat??configuration.target_format??null;
  if(requestedTarget!==null&&(typeof requestedTarget!=="string"||!SCENE_CONFIGURATION_FORMATS.has(requestedTarget)))return null;
  const requestedDownstream=configuration.downstreamFormats??configuration.downstream_formats??[];
  if(!Array.isArray(requestedDownstream))return null;
  const downstreamFormats=[...new Set(requestedDownstream.filter((format):format is string=>typeof format==="string"&&SCENE_CONFIGURATION_FORMATS.has(format)))];
  const alternateMedium=configuration.medium==="audio"?"visual":"audio";
  const requestedAlternate=configuration.alternateMedium??configuration.alternate_medium;
  if(requestedAlternate!==undefined&&requestedAlternate!==alternateMedium)return null;
  return{medium:configuration.medium,source,targetFormat:requestedTarget,downstreamFormats,alternateMedium};
}

/** Preserve intentional production settings without copying future private references into durable metadata. */
function generationReceiptSettings(value:unknown,fallback:Record<string,unknown>){
  const settings=record(value);const safe:Record<string,unknown>={};
  for(const key of GENERATION_RECEIPT_SETTING_KEYS){
    const entry=settings[key]??fallback[key];
    if(entry===null||typeof entry==="string"||typeof entry==="number"&&Number.isFinite(entry)||typeof entry==="boolean")safe[key]=entry;
  }
  const palette=record(settings.brand_palette??settings.palette);
  const safePalette=Object.fromEntries(Object.entries(palette).filter(([key,value])=>/^[a-z][a-z\d_-]*$/i.test(key)&&typeof value==="string"&&/^#[\da-f]{3,8}$/i.test(value)));
  if(Object.keys(safePalette).length)safe.brand_palette=safePalette;
  const sceneConfiguration=safeSceneConfiguration(settings.scene_configuration??fallback.scene_configuration);
  const sceneMedium=settings.scene_medium??fallback.scene_medium??sceneConfiguration?.medium;
  if(isSceneMedium(sceneMedium)){
    safe.scene_medium=sceneMedium;
    if(sceneConfiguration?.medium===sceneMedium)safe.scene_configuration=sceneConfiguration;
  }
  return safe;
}

/** Content hydration is already actor-scoped; also reject references belonging to another job or document. */
function privateGenerationInput(job:DocumentJob,receipt:Record<string,unknown>,content:Record<string,string>){
  const ref=textOrNull(receipt.input_ref);const retained=ref?parsedRecord(content[ref]):null;
  if(!retained||retained.job_id!==job.jobId||retained.document_id!==job.documentId)return null;
  return retained;
}

/** This allowlist intentionally excludes input_ref, source block IDs, snapshots, prompts, and unknown fields. */
function safeGenerationReceipt(value:Record<string,unknown>,privateInput:Record<string,unknown>|null){
  if(!Object.keys(value).length)return null;
  const planner=record(privateInput?.planner),source=record(privateInput?.source),request=record(privateInput?.request),accounting=record(privateInput?.accounting);
  const presentationLabels=(value.artifact_kind??privateInput?.artifact_kind)==="slides"?safePresentationProviderLabels(value):null;
  const providerStatus=textOrNull(value.provider_request_status)??textOrNull(planner.request_status)??"unknown";
  const sourceStatus=textOrNull(value.source_transmission_status)??textOrNull(source.status)??"unknown";
  const authoredCount=numberOrNull(value.authored_slide_count)??numberOrNull(request.authored_slide_count);
  const predictedCount=numberOrNull(value.predicted_slide_count)??numberOrNull(request.predicted_slide_count);
  const providerContacted=providerStatus==="not_submitted"?false:providerStatus==="submitted"||providerStatus==="completed"||providerStatus==="rejected"?true:null;
  const sourceTransmitted=sourceStatus==="not_transmitted"?false:sourceStatus==="transmitted"?true:null;
  const settledCost=numberOrNull(value.settled_cost_microusd)??(providerContacted===false&&sourceTransmitted===false?numberOrNull(accounting.settled_cost_microusd):null);
  return{
    schema_version:numberOrNull(value.schema_version)??1,
    execution_evidence_version:numberOrNull(value.execution_evidence_version),
    captured_at:textOrNull(value.captured_at)??textOrNull(privateInput?.captured_at),
    artifact_kind:textOrNull(value.artifact_kind)??textOrNull(privateInput?.artifact_kind),
    production_mode:textOrNull(value.production_mode)??textOrNull(request.production_mode),
    provider:textOrNull(value.provider)??textOrNull(planner.provider),
    model:presentationLabels?presentationLabels.model:textOrNull(value.model)??textOrNull(planner.model),
    ...(presentationLabels??{}),
    requested_slide_count:numberOrNull(value.requested_slide_count)??numberOrNull(request.requested_slide_count),
    authored_slide_count:authoredCount,
    predicted_slide_count:predictedCount,
    actual_slide_count:numberOrNull(value.actual_slide_count),
    completed_slide_count:numberOrNull(value.completed_slide_count),
    slide_count_mismatch:typeof value.slide_count_mismatch==="boolean"?value.slide_count_mismatch:authoredCount!==null&&predictedCount!==null?authoredCount!==predictedCount:null,
    batch_count:numberOrNull(value.batch_count)??numberOrNull(request.batch_count),
    minimum_provider_call_count:numberOrNull(value.minimum_provider_call_count)??numberOrNull(request.minimum_provider_call_count),
    planned_provider_call_count:numberOrNull(value.planned_provider_call_count)??numberOrNull(request.planned_provider_call_count),
    max_repair_call_count:numberOrNull(value.max_repair_call_count)??numberOrNull(request.max_repair_call_count),
    maximum_provider_call_count:numberOrNull(value.maximum_provider_call_count)??numberOrNull(request.maximum_provider_call_count),
    actual_provider_call_count:numberOrNull(value.actual_provider_call_count),
    actual_planner_call_count:numberOrNull(value.actual_planner_call_count),
    actual_media_call_count:numberOrNull(value.actual_media_call_count),
    unresolved_provider_call_count:numberOrNull(value.unresolved_provider_call_count),
    provider_submission_uncertain:typeof value.provider_submission_uncertain==="boolean"?value.provider_submission_uncertain:null,
    provider_call_forecast_scope:textOrNull(value.provider_call_forecast_scope),
    provider_call_breakdown_complete:typeof value.provider_call_breakdown_complete==="boolean"?value.provider_call_breakdown_complete:null,
    retained_clip_count:numberOrNull(value.retained_clip_count),
    recorded_provider_request_status:textOrNull(value.recorded_provider_request_status),
    request_outcome_basis:textOrNull(value.request_outcome_basis),
    provider_call_count:numberOrNull(value.provider_call_count),
    repair_calls_may_incur_additional_usage:typeof value.repair_calls_may_incur_additional_usage==="boolean"?value.repair_calls_may_incur_additional_usage:null,
    reservation_microusd:numberOrNull(value.reservation_microusd)??numberOrNull(request.reservation_microusd)??numberOrNull(accounting.reservation_microusd),
    settled_cost_microusd:settledCost,
    reservation_status:textOrNull(value.reservation_status)??"unknown",
    reservation_is_provider_hard_cap:typeof value.reservation_is_provider_hard_cap==="boolean"?value.reservation_is_provider_hard_cap:typeof accounting.reservation_is_provider_hard_cap==="boolean"?accounting.reservation_is_provider_hard_cap:null,
    reservation_is_application_hard_cap:typeof value.reservation_is_application_hard_cap==="boolean"?value.reservation_is_application_hard_cap:typeof accounting.reservation_is_application_hard_cap==="boolean"?accounting.reservation_is_application_hard_cap:null,
    maximum_authorized_cost_microusd:numberOrNull(value.maximum_authorized_cost_microusd)??numberOrNull(accounting.maximum_authorized_cost_microusd),
    source_transmission_scope:textOrNull(value.source_transmission_scope)??textOrNull(source.scope),
    source_transmission_status:sourceStatus,
    provider_request_status:providerStatus,
    provider_contacted:providerContacted,
    source_transmitted:sourceTransmitted,
    source_fact_count:numberOrNull(value.source_fact_count),
    source_snapshot_sha256:textOrNull(value.source_snapshot_sha256)??textOrNull(source.snapshot_sha256),
    failure_stage:textOrNull(value.failure_stage),
    failure_category:textOrNull(value.failure_category),
    failure_code:textOrNull(value.failure_code),
    settings:generationReceiptSettings(value.settings,request),
    private_input_available:Boolean(privateInput),
    private_input_expires_at:textOrNull(value.input_expires_at),
  };
}

export function outputGenerationInputInspection(output:CreativeOutput,events:CreativeEvent[],content:Record<string,string>):GenerationInputInspection{
  const compiled=[...events].reverse().find((event)=>event.type==="ContextCompiled"&&String(event.payload.generation_id??"")===output.generationId);const prompt=output.promptRef?content[output.promptRef]??"":"";const compiledPayload=compiled?.payload??{};
  const receipt={schema_version:1,output:{object_id:output.id,generation_id:output.generationId,document_id:output.documentId,quality:output.quality,purpose:output.purpose,prompt_technique:output.promptTechnique,provider:output.provider,model:output.modelId,planner_model:output.plannerModelId,source_surface:output.sourceSurface,...(output.productionMode==="managed"?{production_mode:"managed",production_team:output.productionTeam??null,production_required_claim_count:compiledPayload.production_required_claim_count??null,production_quality:compiledPayload.production_quality??null}:{})},submitted_prompt:prompt||null,document_snapshot:compiledPayload.compiled_snapshot??null,context_hash:compiledPayload.context_hash??null,source_block_versions:compiledPayload.source_block_versions??[],reference_inputs:compiledPayload.reference_inputs??[],used_reference_pixels:compiledPayload.used_uploaded_reference_pixels===true||compiledPayload.used_ideation_preview_pixels===true||compiledPayload.used_locked_study_pixels===true,compile_event_id:compiled?.eventId??null};
  return{title:"Generation inputs",subtitle:`${output.quality==="low"?"Draft":"Full-quality"} image · ${output.promptTechnique}`,prompt,receipt,retained:Boolean(prompt||compiled)};
}

export function artifactGenerationInputInspection(artifact:DocumentArtifact,content:Record<string,string>):GenerationInputInspection{
  const retained=parsedRecord(artifact.inputRef?content[artifact.inputRef]:undefined);const planner=record(retained?.planner),render=record(retained?.render);const submittedPrompt=artifact.kind==="model3d"?String(render.submitted_prompt??""):String(render.submitted_prompt??"").trim();const plannerInstructions=String(planner.instructions??"").trim();const plannerInput=planner.providerInput??planner.provider_input;const prompt=submittedPrompt||[plannerInstructions,plannerInput?JSON.stringify(plannerInput,null,2):""].filter(Boolean).join("\n\n");
  const fallback={schema_version:1,artifact:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,provider:artifact.provider,model:artifact.modelId,settings:artifact.settings},retained_input_unavailable:true,note:"This artifact predates retained generation-input receipts. Its public provider and request settings remain available, but its exact frozen document snapshot cannot be reconstructed."};
  return{title:"Artifact inputs",subtitle:`${artifact.kind.replaceAll("_"," ")} · ${artifact.modelId}`,prompt,receipt:retained??fallback,retained:Boolean(retained)};
}

const eventIdsForJob=(job:DocumentJob)=>new Set(Array.isArray(job.result?.appendedEventIds)?job.result.appendedEventIds.map(String):[]);
const jobFailureEvents=(job:DocumentJob,events:CreativeEvent[])=>{
  const ids=eventIdsForJob(job);
  const relevant=(event:CreativeEvent)=>String(event.payload.document_id??"")===job.documentId&&(
    ids.has(event.eventId)||Boolean(job.promptFanId)&&String(event.payload.prompt_fan_id??"")===job.promptFanId
  );
  return events.filter((event)=>relevant(event)&&(event.type==="GenerationFailed"||event.type==="DocumentRenderFailed"));
};

function inspectDocumentGenerationInputs(job:DocumentJob,events:CreativeEvent[],content:Record<string,string>,outcome:"completed"|"failed"|"in_progress"):GenerationInputInspection{
  const checkpoint=record(job.result);const persistedGenerationReceipt=record(checkpoint.generationReceipt);const privateInput=privateGenerationInput(job,persistedGenerationReceipt,content);const generationReceipt=safeGenerationReceipt(Object.keys(persistedGenerationReceipt).length?generationExecutionSummary(checkpoint,job.errorDetail):persistedGenerationReceipt,privateInput);
  const managedInputs=managedProductionInputEvidence(checkpoint,job.errorDetail);
  const ids=eventIdsForJob(job);const failures=jobFailureEvents(job,events);const generationIds=new Set(failures.map((event)=>String(event.payload.generation_id??"")).filter(Boolean));
  const artifactIds=new Set(failures.map((event)=>String(event.payload.artifact_id??"")).filter(Boolean));
  if(textOrNull(checkpoint.generationId))generationIds.add(String(checkpoint.generationId));
  if(textOrNull(checkpoint.artifactId))artifactIds.add(String(checkpoint.artifactId));
  const requests=events.filter((event)=>String(event.payload.document_id??"")===job.documentId&&(event.type==="GenerationRequested"||event.type==="DocumentRenderRequested")&&(ids.has(event.eventId)||generationIds.has(String(event.payload.generation_id??""))||artifactIds.has(String(event.payload.artifact_id??""))||Boolean(job.promptFanId)&&String(event.payload.prompt_fan_id??"")===job.promptFanId));
  const compiled=events.filter((event)=>event.type==="ContextCompiled"&&String(event.payload.document_id??"")===job.documentId&&(
    ids.has(event.eventId)||generationIds.has(String(event.payload.generation_id??""))||Boolean(job.promptFanId)&&String(event.payload.prompt_fan_id??"")===job.promptFanId
  ));
  const promptRefs=new Map<string,string>();
  const addPrompt=(technique:unknown,ref:unknown)=>{const key=String(ref??"");if(!key||!content[key])return;promptRefs.set(`${promptTechniqueLabel(technique??job.promptTechnique)} prompt`,content[key]);};
  addPrompt(job.promptTechnique,job.moderationPromptRef);
  for(const member of job.members)addPrompt(member.promptTechnique,member.moderationPromptRef);
  for(const failure of failures)addPrompt(failure.payload.prompt_technique,failure.payload.prompt_ref);
  const videoInputReceipt=record(checkpoint.videoInputReceipt);const audioInputReceipt=record(checkpoint.audioInputReceipt);const preparedVideoPrompt=String(videoInputReceipt.submitted_prompt??"").trim();if(preparedVideoPrompt&&!promptRefs.size)promptRefs.set("Prepared video prompt",preparedVideoPrompt);const preparedAudioPrompt=String(audioInputReceipt.submitted_prompt??"").trim();if(preparedAudioPrompt&&!promptRefs.size)promptRefs.set("Prepared music prompt",preparedAudioPrompt);
  const retainedRender=record(privateInput?.render);const retainedPrompt=textOrNull(retainedRender.submitted_prompt)??textOrNull(privateInput?.submitted_prompt);if(retainedPrompt&&!promptRefs.size)promptRefs.set(generationReceipt?.provider_contacted===false?"Prepared generation prompt":generationReceipt?.provider_contacted===true?"Submitted generation prompt":"Retained generation prompt",retainedPrompt);
  const prompts=[...promptRefs].map(([label,value])=>({label,value}));const prompt=prompts.length===1?prompts[0].value:prompts.map((entry)=>`${entry.label}\n${entry.value}`).join("\n\n---\n\n");
  const artifactKind=String(job.result?.artifactKind??generationReceipt?.artifact_kind??failures.find((event)=>event.type==="DocumentRenderFailed")?.payload.artifact_kind??"");
  const artifactPlan=checkpoint.artifactPlan??null;const plannerInput=checkpoint.plannerInput??null;
  const frozenInputs:Array<Record<string,unknown>>=compiled.map((event)=>({compile_event_id:event.eventId,generation_id:event.payload.generation_id??null,prompt_technique:event.payload.prompt_technique??job.promptTechnique,context_hash:event.payload.context_hash??null,document_snapshot:event.payload.compiled_snapshot??null,source_block_versions:event.payload.source_block_versions??[],reference_inputs:event.payload.reference_inputs??[],used_reference_pixels:event.payload.used_uploaded_reference_pixels===true||event.payload.used_ideation_preview_pixels===true||event.payload.used_locked_study_pixels===true}));
  if(privateInput&&privateInput.document_snapshot&&!frozenInputs.length)frozenInputs.push({compile_event_id:null,generation_id:null,prompt_technique:job.promptTechnique,context_hash:null,source_snapshot_sha256:generationReceipt?.source_snapshot_sha256??null,document_snapshot:privateInput.document_snapshot,source_block_versions:Array.isArray(privateInput.source_block_versions)?privateInput.source_block_versions:[],reference_inputs:[],used_reference_pixels:false,captured_at:generationReceipt?.captured_at??null});
  const retainedPrivateInput=Boolean(privateInput||prompt||frozenInputs.length||artifactPlan||plannerInput||managedInputs||Object.keys(videoInputReceipt).length||Object.keys(audioInputReceipt).length);
  const retentionNote=retainedPrivateInput
    ?outcome==="in_progress"?"This receipt contains the immutable actor-private inputs captured when the request was accepted.":"This receipt contains the immutable actor-private inputs retained for this generation attempt."
    :generationReceipt?"The accepted request metadata and source snapshot hash remain available, but the actor-private frozen input is unavailable, unauthorized, or expired."
      :requests.length?"The durable request settings survived, but this failure predates complete private-input retention or its private input expired."
        :"This failure predates retained private inputs or its retention period expired. Job and event diagnostics remain available.";
  const receipt={
    schema_version:1,outcome,job:{job_id:job.jobId,document_id:job.documentId,kind:job.kind,artifact_kind:artifactKind||null,production_mode:job.productionMode??null,status:job.status,stage:job.stage||null,source_surface:job.sourceSurface,document_revision:job.documentRevision,prompt_technique:job.promptTechnique,prompt_fan_id:job.promptFanId,attempt_count:job.attemptCount,requested_at:job.requestedAt,started_at:job.startedAt,completed_at:job.completedAt,dismissed_at:job.dismissedAt},
    generation_receipt:generationReceipt,
    private_input:privateInput,
    submitted_prompts:prompts.map((entry)=>({label:entry.label,prompt:entry.value})),
    request_receipts:requests.map((event)=>({event_id:event.eventId,type:event.type,sequence:event.sequence,payload:event.payload})),frozen_inputs:frozenInputs,
    artifact_checkpoint:artifactPlan||plannerInput||managedInputs||Object.keys(videoInputReceipt).length||Object.keys(audioInputReceipt).length?{plan:artifactPlan,planner_input:plannerInput,planner_model:checkpoint.plannerModel??null,planner_response_id:checkpoint.plannerResponseId??null,render_input:Object.keys(audioInputReceipt).length?audioInputReceipt:Object.keys(videoInputReceipt).length?videoInputReceipt:null,managed_inputs:managedInputs,rendered_items:checkpoint.renderedItems??[]}:null,
    failures:failures.map((event)=>({event_id:event.eventId,type:event.type,sequence:event.sequence,payload:event.payload})),
    technical_error:job.errorDetail??job.error??null,
    retention_note:retentionNote,
  };
  const family=job.kind==="render_document"?(artifactKind?artifactKind.replaceAll("_"," "):"document output"):job.kind==="prompt_fan"?`${job.fanKind==="preview"?"Draft":"Full-quality"} fan`:job.kind==="preview"?"Draft image":"Full-quality image";
  const title=outcome==="failed"?"Failed generation inputs":outcome==="in_progress"?"Generation in progress":"Completed generation inputs";
  const systemHeader:GenerationInputInspection["systemHeader"]=job.kind==="render_document"&&artifactKind==="scene"?{format:"scene",attemptCount:job.attemptCount}:undefined;
  return{title,subtitle:`${family} · attempt ${job.attemptCount}`,prompt,receipt,retained:generationReceipt?retainedPrivateInput:Boolean(retainedPrivateInput||requests.length),outcome,...(systemHeader?{systemHeader}:{})};
}

/** Inspect the same actor-private frozen request while queued, running, failed, or completed. */
export function documentGenerationInputInspection(job:DocumentJob,events:CreativeEvent[],content:Record<string,string>):GenerationInputInspection{
  const outcome=job.status==="completed"?"completed":job.status==="failed"||job.status==="partial"||job.status==="canceled"?"failed":"in_progress";
  return inspectDocumentGenerationInputs(job,events,content,outcome);
}

/** Builds an immutable, copyable receipt for a failed document generation attempt. */
export function failedGenerationInputInspection(job:DocumentJob,events:CreativeEvent[],content:Record<string,string>):GenerationInputInspection{
  return inspectDocumentGenerationInputs(job,events,content,"failed");
}
