import base from '../../docs/fixtures/generation-outcome-v1.json' with {type:'json'};
export const now='2026-09-22T12:00:00Z';
export const scenarios=[...base.cases.map(c=>c.name),'access-error','rate-limit','incomplete-planner','expired-evidence','mixed-routes','service-preparation'];
export function fixture(name='image-output-block',id='original'){
 if(name==='service-preparation')return {job:{jobId:id,documentId:'doc',kind:'generate',status:'failed',sourceSurface:'still',members:[],attemptCount:1,requestedAt:now,result:{generationReceipt:{provider_request_status:'not_submitted',source_transmission_status:'not_transmitted',settled_cost_microusd:0,reservation_microusd:1000000,reservation_status:'released'}},errorDetail:{code:'operation_failed',category:'unknown',scope:'unknown',action:'none',message:'memory_boundary_schema_unavailable',retryable:false}},content:{},unavailable:[]};
 const outcome={...(base.cases.find(c=>c.name===name)??base.cases[4])};delete outcome.name;
 if(name==='access-error')Object.assign(outcome,{failureKind:'access',contentOutcome:'unknown'});
 if(name==='rate-limit')Object.assign(outcome,{failureKind:'rate_limit',contentOutcome:'unknown'});
 if(name==='incomplete-planner')Object.assign(outcome,{pipelineStage:'planner',failureKind:'incomplete',contentOutcome:'invalid'});
 const comparison=id!=='original';
 const content={prompt:comparison?'An adult literary portrait. Blue palette.':'An adult literary portrait. Green palette.'};
 const receipt={input_ref:'source',input_expires_at:name==='expired-evidence'?'2020-01-01T00:00:00Z':'2099-01-01T00:00:00Z',provider:'openai',model:'gpt-image-2',provider_request_status:'rejected',reservation_microusd:100,settled_cost_microusd:null};
 if(name!=='expired-evidence')content.source=JSON.stringify({job_id:id,document_id:'doc',document_snapshot:{facts:[{text:'An adult literary portrait'}]},request:{quality:comparison?'low':'high',references:comparison?[{sha256:'synthetic-blue-reference',role:'palette'}]:[]}});
 const job={jobId:id,documentId:'doc',kind:'generate',status:'failed',sourceSurface:'still',members:[],attemptCount:1,requestedAt:now,moderationPromptRef:'prompt',result:{generationReceipt:receipt,generationOutcome:outcome,generationEvidenceRefs:{}},errorDetail:{code:name==='local-preflight-stop'?'safety_preflight_flagged':name==='incomplete-planner'?'provider_response_incomplete':'moderation_blocked',category:outcome.failureKind==='storage'?'server':outcome.failureKind,scope:'request',pipelineStage:outcome.pipelineStage,providerModerationStage:outcome.providerModerationStage,outcome,message:'Synthetic recorded message. No word-level cause disclosed.',requestId:'failure-only'},stage:'failed'};
 const add=(key,stage,provider,model,endpoint,phase='response')=>{
   const ev={schemaVersion:'forma-private-generation-evidence-v1',evidenceId:`${id}-${key}`,capturedAt:now,phase,
    operation:{...base.operationExample,provider,endpoint,effectiveModel:model,requestedAlias:model,requestedQuality:comparison?'low':'high',settings:{size:'1536x1024',quality:comparison?'low':'high'},requestId:`${id}-${key}-request`,responseId:phase==='response'?`${id}-${key}-response`:null},outcome:{...outcome,pipelineStage:stage},...(phase==='request'?{requestBody:JSON.stringify({prompt:content.prompt,reference:comparison?'synthetic-blue-reference':null})}:{responseBody:'{"synthetic":true}'})};
   if(stage==='planner'&&name!=='planner-refusal'&&name!=='incomplete-planner')Object.assign(ev.outcome,{failureKind:null,contentOutcome:'usable',accountingState:'usage_recorded',providerModerationStage:'unknown'});
   if(stage==='app_moderation')Object.assign(ev.outcome,{failureKind:name==='local-preflight-stop'?'safety':null,contentOutcome:name==='local-preflight-stop'?'refused':'usable',providerModerationStage:'unknown'});
   if(phase==='request')Object.assign(ev.outcome,{failureKind:null,contentOutcome:'unknown',dispatchState:'dispatch_unknown',accountingState:'unknown'});
   if(stage==='app_moderation')Object.assign(ev,{safety:{...base.safetyExample,verdict:name==='local-preflight-stop'?'flagged':'clear',validity:'valid',returnedResultCount:1,requestId:'moderation-request',responseId:'moderation-response'}});
   const ref=`${id}-${key}-${phase}`;job.result.generationEvidenceRefs[`${ev.evidenceId}:${phase}`]={ref,expiresAt:'2099-01-01T00:00:00Z',pipelineStage:stage};content[ref]=JSON.stringify(ev);
 };
 if(name!=='expired-evidence'){
  add('planner','planner','openai','planner-model-recorded','https://api.openai.com/v1/responses');
  if(name!=='incomplete-planner'&&name!=='planner-refusal'){
   add('moderation','app_moderation','openai','omni-moderation-latest','https://api.openai.com/v1/moderations');
   if(name!=='local-preflight-stop'){
   add('media','media_submission','openai',comparison?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst',comparison?'https://api.openai.com/v1/images/edits':'https://api.openai.com/v1/images/generations','request');
   add('media','media_result','openai',comparison?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst',comparison?'https://api.openai.com/v1/images/edits':'https://api.openai.com/v1/images/generations');
   }
  }
  if(name==='mixed-routes')add('original-fal-frame','retrieval','fal','fal-ai/ideogram/v3','https://queue.fal.run/fal-ai/ideogram/v3');
 }
 return {job,content,unavailable:[]};
}
