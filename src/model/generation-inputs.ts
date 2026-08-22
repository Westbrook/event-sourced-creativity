import type { DocumentArtifact } from "./document-artifacts";
import type { CreativeEvent, CreativeOutput } from "./events";
import type { DocumentJob } from "./document-jobs";

export type GenerationInputInspection = {
  title: string;
  subtitle: string;
  prompt: string;
  receipt: Record<string, unknown>;
  retained: boolean;
  outcome?: "completed" | "failed";
};

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parsedRecord=(value:string|undefined)=>{if(!value)return null;try{return record(JSON.parse(value));}catch{return null;}};
const promptTechniqueLabel=(value:unknown)=>({prose:"Narrative prose",bullets:"Prose as bullets",json:"Structured JSON",xml:"XML node set"}[String(value??"")]??"Narrative prose");

export function outputGenerationInputInspection(output:CreativeOutput,events:CreativeEvent[],content:Record<string,string>):GenerationInputInspection{
  const compiled=[...events].reverse().find((event)=>event.type==="ContextCompiled"&&String(event.payload.generation_id??"")===output.generationId);const prompt=output.promptRef?content[output.promptRef]??"":"";const compiledPayload=compiled?.payload??{};
  const receipt={schema_version:1,output:{object_id:output.id,generation_id:output.generationId,document_id:output.documentId,quality:output.quality,purpose:output.purpose,prompt_technique:output.promptTechnique,provider:output.provider,model:output.modelId,planner_model:output.plannerModelId,source_surface:output.sourceSurface,...(output.productionMode==="managed"?{production_mode:"managed",production_team:output.productionTeam??null,production_required_claim_count:compiledPayload.production_required_claim_count??null,production_quality:compiledPayload.production_quality??null}:{})},submitted_prompt:prompt||null,document_snapshot:compiledPayload.compiled_snapshot??null,context_hash:compiledPayload.context_hash??null,source_block_versions:compiledPayload.source_block_versions??[],reference_inputs:compiledPayload.reference_inputs??[],used_reference_pixels:compiledPayload.used_uploaded_reference_pixels===true||compiledPayload.used_ideation_preview_pixels===true||compiledPayload.used_locked_study_pixels===true,compile_event_id:compiled?.eventId??null};
  return{title:"Generation inputs",subtitle:`${output.quality==="low"?"Draft":"Full-quality"} image · ${output.promptTechnique}`,prompt,receipt,retained:Boolean(prompt||compiled)};
}

export function artifactGenerationInputInspection(artifact:DocumentArtifact,content:Record<string,string>):GenerationInputInspection{
  const retained=parsedRecord(artifact.inputRef?content[artifact.inputRef]:undefined);const planner=record(retained?.planner),render=record(retained?.render);const submittedPrompt=String(render.submitted_prompt??"").trim();const plannerInstructions=String(planner.instructions??"").trim();const plannerInput=planner.providerInput??planner.provider_input;const prompt=submittedPrompt||[plannerInstructions,plannerInput?JSON.stringify(plannerInput,null,2):""].filter(Boolean).join("\n\n");
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

/** Builds an immutable, copyable receipt for a failed document generation attempt. */
export function failedGenerationInputInspection(job:DocumentJob,events:CreativeEvent[],content:Record<string,string>):GenerationInputInspection{
  const ids=eventIdsForJob(job);const failures=jobFailureEvents(job,events);const generationIds=new Set(failures.map((event)=>String(event.payload.generation_id??"")).filter(Boolean));
  const artifactIds=new Set(failures.map((event)=>String(event.payload.artifact_id??"")).filter(Boolean));
  const requests=events.filter((event)=>String(event.payload.document_id??"")===job.documentId&&(event.type==="GenerationRequested"||event.type==="DocumentRenderRequested")&&(ids.has(event.eventId)||generationIds.has(String(event.payload.generation_id??""))||artifactIds.has(String(event.payload.artifact_id??""))||Boolean(job.promptFanId)&&String(event.payload.prompt_fan_id??"")===job.promptFanId));
  const compiled=events.filter((event)=>event.type==="ContextCompiled"&&String(event.payload.document_id??"")===job.documentId&&(
    ids.has(event.eventId)||generationIds.has(String(event.payload.generation_id??""))||Boolean(job.promptFanId)&&String(event.payload.prompt_fan_id??"")===job.promptFanId
  ));
  const promptRefs=new Map<string,string>();
  const addPrompt=(technique:unknown,ref:unknown)=>{const key=String(ref??"");if(!key||!content[key])return;promptRefs.set(`${promptTechniqueLabel(technique??job.promptTechnique)} prompt`,content[key]);};
  addPrompt(job.promptTechnique,job.moderationPromptRef);
  for(const member of job.members)addPrompt(member.promptTechnique,member.moderationPromptRef);
  for(const failure of failures)addPrompt(failure.payload.prompt_technique,failure.payload.prompt_ref);
  const checkpoint=record(job.result);const videoInputReceipt=record(checkpoint.videoInputReceipt);const preparedVideoPrompt=String(videoInputReceipt.submitted_prompt??"").trim();if(preparedVideoPrompt&&!promptRefs.size)promptRefs.set("Prepared video prompt",preparedVideoPrompt);
  const prompts=[...promptRefs].map(([label,value])=>({label,value}));const prompt=prompts.length===1?prompts[0].value:prompts.map((entry)=>`${entry.label}\n${entry.value}`).join("\n\n---\n\n");
  const artifactKind=String(job.result?.artifactKind??failures.find((event)=>event.type==="DocumentRenderFailed")?.payload.artifact_kind??"");
  const artifactPlan=checkpoint.artifactPlan??null;const plannerInput=checkpoint.plannerInput??null;
  const frozenInputs=compiled.map((event)=>({compile_event_id:event.eventId,generation_id:event.payload.generation_id??null,prompt_technique:event.payload.prompt_technique??job.promptTechnique,context_hash:event.payload.context_hash??null,document_snapshot:event.payload.compiled_snapshot??null,source_block_versions:event.payload.source_block_versions??[],reference_inputs:event.payload.reference_inputs??[],used_reference_pixels:event.payload.used_uploaded_reference_pixels===true||event.payload.used_ideation_preview_pixels===true||event.payload.used_locked_study_pixels===true}));
  const receipt={
    schema_version:1,outcome:"failed",job:{job_id:job.jobId,document_id:job.documentId,kind:job.kind,artifact_kind:artifactKind||null,status:job.status,source_surface:job.sourceSurface,document_revision:job.documentRevision,prompt_technique:job.promptTechnique,prompt_fan_id:job.promptFanId,attempt_count:job.attemptCount,requested_at:job.requestedAt,started_at:job.startedAt,completed_at:job.completedAt,dismissed_at:job.dismissedAt},
    submitted_prompts:prompts.map((entry)=>({label:entry.label,prompt:entry.value})),
    request_receipts:requests.map((event)=>({event_id:event.eventId,type:event.type,sequence:event.sequence,payload:event.payload})),frozen_inputs:frozenInputs,
    artifact_checkpoint:artifactPlan||plannerInput||Object.keys(videoInputReceipt).length?{plan:artifactPlan,planner_input:plannerInput,planner_model:checkpoint.plannerModel??null,planner_response_id:checkpoint.plannerResponseId??null,render_input:Object.keys(videoInputReceipt).length?videoInputReceipt:null,rendered_items:checkpoint.renderedItems??[]}:null,
    failures:failures.map((event)=>({event_id:event.eventId,type:event.type,sequence:event.sequence,payload:event.payload})),
    technical_error:job.errorDetail??job.error??null,
    retention_note:prompt||frozenInputs.length||artifactPlan||plannerInput||Object.keys(videoInputReceipt).length?"This receipt contains the immutable inputs retained at failure time.":requests.length?"The durable request settings survived, but this failure predates complete private-input retention or its private input expired.":"This failure predates retained private inputs or its retention period expired. Job and event diagnostics remain available.",
  };
  const family=job.kind==="render_document"?(artifactKind?artifactKind.replaceAll("_"," "):"document output"):job.kind==="prompt_fan"?`${job.fanKind==="preview"?"Draft":"Full-quality"} fan`:job.kind==="preview"?"Draft image":"Full-quality image";
  return{title:"Failed generation inputs",subtitle:`${family} · attempt ${job.attemptCount}`,prompt,receipt,retained:Boolean(prompt||requests.length||frozenInputs.length||artifactPlan||plannerInput||Object.keys(videoInputReceipt).length),outcome:"failed"};
}
