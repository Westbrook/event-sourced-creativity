import {documentJobFailure, type DocumentJob} from '../model/document-jobs.ts';
import {generationOutcomeSummary} from '../model/generation-execution-evidence.ts';
import type {GenerationInputInspection} from '../model/generation-inputs.ts';
import type {PrivateGenerationEvidence} from '../model/generation-outcome-evidence.ts';

export const evidenceRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'&&v?v:null;
export type EvidenceSource={id:string;label:string;status:'retained'|'expired'|'unavailable'|'not_recorded';expiresAt:string|null;value?:unknown};
export type InspectionRead={job:DocumentJob;content:Record<string,string>;unavailable:string[]};
export function stageEvidenceRefs(job:DocumentJob){
  return Object.entries(evidenceRecord(job.result?.generationEvidenceRefs)).map(([id,value])=>{
    const row=evidenceRecord(value);return {id,ref:text(row.ref),expiresAt:text(row.expiresAt),stage:text(row.pipelineStage)};
  });
}
const expired=(expiry:string|null,now:number)=>expiry!==null&&Number.isFinite(Date.parse(expiry))&&Date.parse(expiry)<=now;
/** Presentation of already owner-authorized reads. Neither metadata nor this function grants access. */
export function rejectionEvidence(read:InspectionRead,inspection:GenerationInputInspection,now=Date.now()){
  const receipt=inspection.receipt,raw=evidenceRecord(read.job.result?.generationReceipt);
  const input=evidenceRecord(receipt.private_input),expiresAt=text(raw.input_expires_at);
  const source=(id:string,label:string,value:unknown,expiry:string|null,recorded:boolean):EvidenceSource=>({id,label,expiresAt:expiry,
    status:expired(expiry,now)?'expired':value!==undefined&&value!==null?'retained':recorded?'unavailable':'not_recorded',
    ...(!expired(expiry,now)&&value!==undefined&&value!==null?{value}:{})});
  const sources:EvidenceSource[]=[
    // Prompt custody can outlive a separate frozen source receipt; never borrow its deadline.
    source('prompt','Retained prompt',inspection.prompt||undefined,null,Boolean(read.job.moderationPromptRef)),
    source('source','Frozen source snapshot',input.document_snapshot??(Array.isArray(receipt.frozen_inputs)&&receipt.frozen_inputs.length?receipt.frozen_inputs:undefined),expiresAt,Boolean(raw.input_ref)),
    source('request','Private request receipt',Object.keys(input).length?input:undefined,expiresAt,Boolean(raw.input_ref)),
  ];
  const stages:PrivateGenerationEvidence[]=[];
  for(const ref of stageEvidenceRefs(read.job)){
    let value:PrivateGenerationEvidence|undefined;
    if(ref.ref&&!expired(ref.expiresAt,now))try{
      const parsed=JSON.parse(read.content[ref.ref]??'null');
      if(parsed?.schemaVersion==='forma-private-generation-evidence-v1'&&`${parsed.evidenceId}:${parsed.phase}`===ref.id
        &&parsed.operation?.schemaVersion==='forma-operation-evidence-v1'&&parsed.outcome?.schemaVersion==='forma-generation-outcome-v1')value=parsed;
    }catch{/* Missing or malformed evidence is unavailable, never synthesized. */}
    sources.push(source(ref.id,`${ref.stage??'Unknown stage'} · ${ref.id}`,value,ref.expiresAt,true));
    if(value)stages.push(value);
  }
  // A response from the planner cannot stand in for an absent media response.
  const knownIds=new Set(stageEvidenceRefs(read.job).map(ref=>ref.id));
  for(const ref of stageEvidenceRefs(read.job)){
    const counterpart=ref.id.endsWith(':request')?ref.id.slice(0,-8)+':response':ref.id.endsWith(':response')?ref.id.slice(0,-9)+':request':null;
    if(counterpart&&!knownIds.has(counterpart))sources.push(source(counterpart,`${ref.stage??'Unknown operation'} · ${counterpart}`,undefined,null,false));
  }
  if(!stageEvidenceRefs(read.job).some(ref=>ref.id.endsWith(':response')))sources.push(source('response','Provider response envelope',undefined,null,false));
  const failure=documentJobFailure(read.job);
  const recordedStage=failure?.pipelineStage??evidenceRecord(failure?.outcome??read.job.result?.generationOutcome).pipelineStage;
  const outcome=generationOutcomeSummary(read.job.result??{},failure,raw.failure_stage==='storage'||recordedStage==='storage'?'storage':'');
  return {sources,stages,outcome,pipelineStage:outcome?.pipelineStage??failure?.pipelineStage??'unknown',
    moderationStage:outcome?.providerModerationStage??failure?.providerModerationStage??'unknown',
    correctiveScope:outcome?.correctiveActionScope??failure?.scope??'unknown',failureKind:outcome?.failureKind??failure?.category??'unknown'};
}
export type RejectionEvidence=ReturnType<typeof rejectionEvidence>;
export function evidenceAnchor(jobId:string,sourceId:string){return `evidence-${encodeURIComponent(jobId)}-${encodeURIComponent(sourceId)}`;}
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v,2);
export type EvidenceDifference={field:string;status:'same'|'changed'|'unknown';before:unknown;after:unknown};
/** Compare captured values only. No document compilation, normalization, generation or reconciliation. */
export function compareRejectionEvidence(left:RejectionEvidence,right:RejectionEvidence):EvidenceDifference[]{
  const rows:EvidenceDifference[]=[];
  const add=(field:string,before:unknown,after:unknown)=>rows.push({field,before:before??null,after:after??null,status:before==null||after==null?'unknown':stable(before)===stable(after)?'same':'changed'});
  const value=(model:RejectionEvidence,id:string)=>model.sources.find(s=>s.id===id)?.value;
  add('Exact retained prompt',value(left,'prompt'),value(right,'prompt'));
  add('Frozen source and reference evidence',value(left,'source'),value(right,'source'));
  const configuration=(model:RejectionEvidence)=>{const raw=value(model,'request');if(!raw)return null;const r=evidenceRecord(raw);return {request:r.request??null,render:r.render??null,reference_inputs:r.reference_inputs??null};};
  add('Private request configuration and references',configuration(left),configuration(right));
  // Deliberately compare ordered observations, not unrelated request IDs as configuration.
  const config=(model:RejectionEvidence)=>model.stages.length?model.stages.map(e=>({phase:e.phase,pipelineStage:e.outcome.pipelineStage,
    provider:e.operation.provider,endpoint:e.operation.endpoint,requestedAlias:e.operation.requestedAlias,effectiveModel:e.operation.effectiveModel,
    returnedModel:e.operation.returnedModel,requestedQuality:e.operation.requestedQuality,settings:e.operation.settings,
    routingPolicyVersion:e.operation.routingPolicyVersion,overrideProvenance:e.operation.overrideProvenance})):null;
  add('Per-operation model, quality, route and recorded settings',config(left),config(right));
  const bodies=(model:RejectionEvidence)=>{const requests=model.stages.filter(e=>e.phase==='request');return requests.length?requests.map(e=>({stage:e.outcome.pipelineStage,requestBody:e.requestBody??null})):null;};
  add('Exact per-operation request envelopes (including retained references)',bodies(left),bodies(right));
  return rows;
}

/** Copy for A's classified result; never inspect a message/title to classify it. */
export function failureSummary(evidence:RejectionEvidence){
  if(evidence.pipelineStage==='storage')return 'Storage failed. The recorded content and accounting outcomes below remain separate from whether an artifact was saved.';
  if(evidence.failureKind==='access'||evidence.failureKind==='authentication')return 'Access failed. This is not evidence that the creative content was refused.';
  if(evidence.failureKind==='rate_limit'||evidence.failureKind==='quota')return 'A usage or rate limit stopped this attempt. This is not a content-safety decision.';
  if(evidence.failureKind==='incomplete')return 'The planner response was incomplete. Partial text is not a completed plan or permission to continue generation.';
  if(evidence.failureKind==='safety'){
    if(evidence.pipelineStage==='app_moderation')return 'The application preflight stopped the request. This does not establish a refusal by the media provider.';
    if(evidence.pipelineStage==='planner')return 'The planner returned a refusal. Check each later operation separately; this does not establish that a media request was submitted.';
    return evidence.moderationStage==='unknown'?'A safety refusal was recorded. The provider’s input/output moderation stage is unknown.' : `The provider reported an ${evidence.moderationStage} moderation refusal. This does not identify a causal word, subject or reference.`;
  }
  return 'The retained records describe this failure. Missing evidence remains unknown; a generic message does not establish a cause.';
}

export function evidenceSourceLink(base:string,viewedJobId:string,sourceJobId:string,sourceId:string){
  const url=new URL(base);if(sourceJobId===viewedJobId){if(url.searchParams.has('compareAttempt'))url.searchParams.delete('compareAttempt');}else url.searchParams.set('compareAttempt',sourceJobId);
  url.hash=evidenceAnchor(sourceJobId,sourceId);return url.href;
}
