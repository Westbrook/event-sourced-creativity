import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {registerOutputSourceImports,outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});
const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
const {prepareStoryboardPlannerRequest}=await import('../worker/openai-adapter.ts');
const {captureStoryboardPlannerResponse}=await import('../worker/output-storyboard-request.ts');
const {captureStoryboardRawEnvelope}=await import('../worker/output-storyboard-envelope.ts');
const {retainStoryboardPlannerRequestCheckpoint,retainStoryboardRawEnvelopeCheckpoint}=await import('../worker/output-storyboard-planner-checkpoint.ts');
const {retainStoryboardFrameCheckpoint}=await import('../worker/output-storyboard-checkpoint.ts');
const {bindStoryboardFrameAttempt}=await import('../worker/output-storyboard-fal.ts');
const {createOutputFalImageContract,captureOutputFalImageRequest}=await import(C+'/worker/output-fal-image-contract.ts');
const {readOpenAITextUsage,priceCurrentOpenAITextUsage}=await import(C+'/worker/openai-text-cost.ts');
const {storeGeneratedImage}=await import(C+'/worker/media-api.ts');
const {png}=await import(C+'/tests/output-asset-fixtures.mjs');
const {verifyOutputStoryboardCompletion}=await import('../worker/output-storyboard-completion.ts');
export async function storyboardEvidenceFixture(){
 const f=outputTestDatabase();f.sqlite.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
 CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT);
 CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT);
 CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);`);createStoryboardJobTable(f.sqlite);
 const contract=createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
 const artifact={title:'Keeper',summary:'Return home',content_markdown:'A keeper returns home with the lantern.',presentation:null,items:Array.from({length:4},(_,i)=>({title:'Frame '+i,body:'Moment '+i,notes:'Lantern continuity',image_prompt:'Keeper near harbor '+i,slide:null,context_group_ids:[]}))};
 const planner=await prepareStoryboardPlannerRequest({},'owner',{documentTitle:'Keeper',snapshot:{facts:[{type:'subject',instruction:artifact.content_markdown}]},options:{itemCount:4,productionMode:'manual'}},contract);
 const response={id:'planner-original',model:planner.attempt.model,status:'completed',output_text:'\n '+JSON.stringify(artifact)+'\n',usage:{input_tokens:100,output_tokens:200,total_tokens:300},service_tier:'default'};
 const plan=await captureStoryboardPlannerResponse(response,response.output_text,contract),future=new Date(Date.now()+60000).toISOString(),artifactId='artifact-original';
 const scope={kind:'personal',key:'scope',actorUserId:'owner',ownerUserId:'owner',documentId:'doc'},slot={slotId:'slot',jobId:'job',routeDigest:'route',grantId:'grant',sourceDigest:'source'};
 const job={job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',attempt_count:1,kind:'render_document',status:'running',lease_expires_at:future,expires_at:future,result_json:'{}'};
 insertStoryboardJob(f.sqlite,job);
 f.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?)').run('scope','slot','job','route','grant','source','running');
 function insertCall(a,provider){f.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('scope','slot',a.logicalCallKey,a.logicalCallKey,provider,a.model,a.clientRequestId,a.requestDigest,'pending',null,null);}
 insertCall(planner.attempt,'openai');await retainStoryboardPlannerRequestCheckpoint(f.env,scope,slot,job,planner);
 await retainStoryboardRawEnvelopeCheckpoint(f.env,scope,slot,job,await captureStoryboardRawEnvelope(new Response(JSON.stringify(response)),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model}));
 let cp=JSON.parse(job.result_json);const plannerCost=priceCurrentOpenAITextUsage(response.model,readOpenAITextUsage(response.usage,{cachePolicy:"disabled-explicit"}),response.service_tier).totalMicrousd;
 const settle=(id,responseId,cost)=>f.sqlite.prepare("UPDATE output_provider_calls SET status='settled',provider_response_id=?,used_microusd=? WHERE client_request_id=?").run(responseId,cost,id);
 cp={...cp,artifactId,artifactPlan:artifact,plannerResponseId:response.id,renderedItems:[],providerSubmissionProtocol:1,providerSubmissions:{[planner.attempt.clientRequestId]:{clientRequestId:planner.attempt.clientRequestId,provider:'openai',operation:'planning',model:response.model,status:'completed',providerRequestId:response.id,costMicrousd:plannerCost,inputTokens:100,outputTokens:200,totalTokens:300}}};
 function persist(){job.result_json=JSON.stringify(cp);f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(job.result_json);}
 settle(planner.attempt.clientRequestId,response.id,plannerCost);persist();const fal=createOutputFalImageContract('ideogram/v4','1536x1024');
 for(let index=0;index<4;index++){
  const request=await captureOutputFalImageRequest(fal,fal.model,{prompt:artifact.items[index].image_prompt,expansion_model:fal.expansionModel,image_size:{width:fal.width,height:fal.height},rendering_speed:fal.renderingSpeed,acceleration:fal.acceleration,num_images:1,sync_mode:false,enable_safety_checker:true,output_format:fal.outputFormat},fal,'frame-'+index);
  const mapped=await bindStoryboardFrameAttempt(plan,index,request.attempt);insertCall(mapped,'fal');
  await retainStoryboardFrameCheckpoint(f.env,{userId:'owner'},job,scope,slot,request,plan,index);cp=JSON.parse(job.result_json);
  const providerId='provider-'+index,id=artifactId+'-frame-'+(index+1),stored=await storeGeneratedImage(f.env,'owner',id,png({width:1536,height:1024}),'ideogram/v4','image/png',{artifactRole:'storyboard-frame',artifactId,provider:'fal',providerRequestId:providerId,providerSubmissionId:request.attempt.clientRequestId,storyboardFrameIndex:String(index),storyboardBindingSha256:plan.bindingSha256});
  cp.renderedItems.push({id,media_url:stored.url,media_type:'image/png',width:1536,height:1024,provider:'fal',provider_model:'ideogram/v4',provider_request_id:providerId,provider_submission_id:request.attempt.clientRequestId,source_content_hash:stored.contentHash,cost_microusd:100});
  cp.providerSubmissions[request.attempt.clientRequestId]={clientRequestId:request.attempt.clientRequestId,provider:'fal',operation:'image',model:fal.model,status:'completed',providerRequestId:providerId,costMicrousd:100};settle(request.attempt.clientRequestId,providerId,100);persist();
 }
 const settings={outputStoryboard:contract,outputStoryboardPlanner:{contract,requestDigest:planner.requestDigest,maximumInputTokens:planner.maximumInputTokens},outputFalImage:fal};
 const verify=()=>verifyOutputStoryboardCompletion(f.env,scope,slot,job,settings,artifactId,artifact,cp.renderedItems);
 return {...f,job,scope,slot,settings,artifactId,artifact,cp,persist,verify};
}
