import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
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
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
async function fixture(){
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
test('actual private checkpoints, five settled SQL claims and four physically stored PNG fixtures join at completion, without admission',async()=>{
 const f=await fixture();try{const result=await f.verify();assert.equal(result.receipt.frameCount,4);assert.equal(result.receipt.providerCallCount,5);assert.equal(result.receipt.visualReview,'required');
  for(const a of result.assertions)assert(f.sqlite.prepare('SELECT 1 WHERE '+a.sql).get(...(a.bindings??[])));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,5);
 }finally{f.sqlite.close();}
});
test('missing, foreign, unsettled or edited planner/frame/claim/private evidence never qualifies the four-frame fixture',async()=>{
 const mutations=[
  f=>f.sqlite.exec("UPDATE output_operation_slots SET job_id='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET scope_key='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET slot_id='foreign'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET owner_id='foreign'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain' WHERE call_key='image:frame:4'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET used_microusd=NULL WHERE call_key='image:frame:1'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET client_request_id='foreign' WHERE call_key='image:frame:2'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET request_digest='foreign' WHERE call_key='image:frame:3'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET used_microusd=999 WHERE call_key='planning:0:initial'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET correlation_id='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET source_digest='foreign'"),
  f=>f.sqlite.exec("UPDATE private_content SET redacted_at='redacted' WHERE kind='provider-response'"),
  f=>{delete f.cp.outputStoryboardCheckpoints.f4.requestDigest;f.persist();},
  f=>{f.cp.outputStoryboardCheckpoints.f2.planRef=f.cp.outputStoryboardCheckpoints.f2.requestRef;f.persist();},
  f=>{f.cp.outputStoryboardRawEnvelope.complete=false;f.persist();},
  f=>{f.cp.renderedItems.reverse();f.persist();},
  f=>{f.cp.renderedItems[0].provider_request_id='foreign';f.persist();},
  f=>{f.cp.renderedItems[0].cost_microusd++;f.persist();},
  f=>{f.media.clear();},
  f=>{f.cp.providerSubmissions.extra=null;f.persist();},
  f=>{const [key,value]=Object.entries(f.cp.providerSubmissions)[0];delete f.cp.providerSubmissions[key];f.cp.providerSubmissions.foreign=value;f.persist();},
  f=>{delete f.cp.providerSubmissionProtocol;f.persist();},
  f=>{f.cp.providerSubmissionLegacyUncertain=true;f.persist();},
 ];
 for(const mutate of mutations){const f=await fixture();try{mutate(f);await assert.rejects(f.verify());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,5);}finally{f.sqlite.close();}}
});
test('actual execution hook carries completion evidence into publication SQL and refuses later private-body changes',async()=>{
 const f=await fixture();try{
  const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module');
  const {outputAssertionStatements}=await import(C+'/worker/output-requirements-ledger.ts');
  const source=readFileSync(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8'),start=source.indexOf('  async verifyStoryboardCompletion('),end=source.indexOf('\n  async beforeSourceTransmission',start);
  assert(start>0&&end>start);const method=source.slice(start,end).trim();
  const storyboardCompletionAssertions=[],liveAssertions=()=>storyboardCompletionAssertions;
  const deps={artifactKind:'storyboard',dispatchDeadline:Date.now()+60000,OutputConflictError:Error,verifyOutputStoryboardCompletion,env:f.env,scope:f.scope,slot:f.slot,job:f.job,settings:{payload:f.settings},storyboardCompletionAssertions,liveAssertions,outputAssertionStatements};
  const hook=new Function(...Object.keys(deps),stripTypeScriptTypes('let storyboardCompletionJson;const value={'+method+'};')+'return value.verifyStoryboardCompletion;')(...Object.values(deps));
  const result=await hook(f.artifactId,f.artifact,f.cp.renderedItems);assert.equal(result.frameCount,4);assert(storyboardCompletionAssertions.length>15);
  f.sqlite.exec("UPDATE private_content SET content='changed' WHERE kind='provider-response'");
  await assert.rejects(f.env.DB.batch(liveAssertions().flatMap(a=>outputAssertionStatements(f.env,a))),/CHECK constraint/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,5);
 }finally{f.sqlite.close();}
});
test('actual trusted execution deadline bounds stalled media by source, cost period or lease while heartbeat signal stays live', {timeout:3000},async()=>{
 const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module');
 const {readOutputStoryboardFrameMedia}=await import('../worker/output-storyboard-media.ts');
 const source=readFileSync(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8');
 const declaration=source.split('\n').find(line=>line.includes('const dispatchDeadline='));
 const start=source.indexOf('  storyboardMediaDeadlineMs(){'),end=source.indexOf('\n  async beforeSourceTransmission',start);assert(declaration&&start>0&&end>start);
 for(const mode of ['source','cost-period','lease']){
  const f=await fixture();try{
   const now=Date.now(),deadline=now+25,abort=new AbortController();let cancelled=0;
   f.job.lease_expires_at=new Date(mode==='lease'?deadline:now+60000).toISOString();
   const deps={nextPeriod:new Date(mode==='cost-period'?deadline:now+60000),authority:{assertions:[]},sceneAssertions:[],audioAssertions:[],model3dAssertions:[],videoSourceAssertions:[],storyboardSourceAssertions:[{deadlineMs:mode==='source'?deadline:now+60000}],job:f.job,artifactKind:'storyboard'};
   const getDeadline=new Function(...Object.keys(deps),stripTypeScriptTypes(declaration+'\nconst value={'+source.slice(start,end)+'};')+'return value.storyboardMediaDeadlineMs;')(...Object.values(deps));
   assert.equal(getDeadline(),deadline);
   const frame=f.cp.renderedItems[0],base=await f.env.MEDIA.get(decodeURIComponent(frame.media_url.slice('/api/media/'.length)));
   const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});}});f.env.MEDIA.get=async()=>({...base,body:stream});
   const read=readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,frame,f.cp.outputStoryboardCheckpoints.f1.storyboardBindingSha256,{signal:abort.signal,deadlineMs:getDeadline()});
   f.job.lease_expires_at=new Date(now+120000).toISOString();
   await assert.rejects(read,/private_frame/);assert.equal(abort.signal.aborted,false);assert.equal(cancelled,1);assert.equal(stream.locked,false);
  }finally{f.sqlite.close();}
 }
});

test('completion SQL pins original receipt map, protocol, planner identity and uncertainty marker after verification',async()=>{
 const {outputAssertionStatements}=await import(C+'/worker/output-requirements-ledger.ts');
 for(const mutate of [
  f=>{Object.values(f.cp.providerSubmissions)[0].responseRef='changed';},
  f=>{f.cp.providerSubmissions.extra=null;},
  f=>{f.cp.providerSubmissionProtocol=2;},
  f=>{f.cp.providerSubmissionProtocol=true;},
  f=>{f.cp.plannerResponseId='changed';},
  f=>{f.cp.providerSubmissionLegacyUncertain=true;},
 ]){
  const f=await fixture();try{const result=await f.verify();mutate(f);f.persist();
   await assert.rejects(f.env.DB.batch(result.assertions.flatMap(a=>outputAssertionStatements(f.env,a))),/CHECK constraint/);
  }finally{f.sqlite.close();}
 }
});

test('actual guarded four-frame publication binds verified receipt and each item; expiry cleanup retains only published objects',async()=>{
 const {guardOutputPrivateWrites,reconcileOutputNativeStorage}=await import('../worker/output-private-execution.ts');
 const cases=[
  ['original',()=>{}],
  ['unverified',()=>{},false],
  ['foreign-event',p=>{p.requested_by_user_id='foreign';}],
  ['changed-receipt',p=>{p.settings.output_storyboard.frames[0].sha256='a'.repeat(64);}],
  ['reordered-items',p=>{p.items.reverse();}],
  ['missing-frame',p=>{p.items.pop();}],
  ['foreign-item',p=>{p.items[2].media_url='/api/media/foreign';}],
  ['wrong-artifact',p=>{p.artifact_id='foreign';}],
 ];
 for(const [name,mutate,verified=true] of cases){
  const f=await fixture();try{
   f.sqlite.exec(`ALTER TABLE events ADD COLUMN correlation_id TEXT;ALTER TABLE events ADD COLUMN actor TEXT;ALTER TABLE events ADD COLUMN sequence INTEGER;
    ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'revision';
    ALTER TABLE output_operation_slots ADD COLUMN target_id TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN target_contract_digest TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN provider TEXT;ALTER TABLE output_operation_slots ADD COLUMN model TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN attempt_ordinal INTEGER;ALTER TABLE output_operation_slots ADD COLUMN previous_slot_id TEXT;
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,redacted_at TEXT,document_id TEXT);
    CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,actor_user_id TEXT,context_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
    INSERT INTO output_plan_revisions VALUES('scope','revision','owner','doc',NULL,NULL,'personal');
    INSERT INTO output_execution_grants VALUES('scope','grant','owner',NULL,'active','2000-01-01T00:00:00.000Z');`);
   // These are the same explicit offline PNG fixtures, written through the real
   // custody wrapper. No provider transport or execution admission is simulated.
   let receiptJson;
   const result=await f.verify(),guarded=guardOutputPrivateWrites(f.env,f.scope,f.slot,async()=>result.assertions,{storyboardCompletionJson:()=>receiptJson});
   for(const [key,object] of [...f.media])await guarded.MEDIA.put(key,object.bytes,{customMetadata:object.metadata,httpMetadata:{contentType:object.contentType}});
   if(verified)receiptJson=JSON.stringify(result.receipt);
   const payload={document_id:'doc',artifact_kind:'storyboard',artifact_id:f.artifactId,source_surface:'outputs',requested_by_user_id:'owner',
    settings:{output_storyboard:structuredClone(result.receipt)},item_count:4,items:f.cp.renderedItems.map(frame=>({id:frame.id,media_url:frame.media_url,media_type:frame.media_type,width:frame.width,height:frame.height}))};
   mutate(payload);
   await guarded.DB.batch([
    guarded.DB.prepare("INSERT INTO events(event_id,stream_id,type,payload,correlation_id,actor,sequence) VALUES('completion','creative:owner','DocumentRenderCompleted','{}','corr','worker:renderer',1)"),
    guarded.DB.prepare("INSERT INTO event_private_payloads VALUES('completion','owner',?,NULL,'doc')").bind(JSON.stringify(payload)),
   ]);
   const linked=f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes WHERE publication_event_id=\'completion\'').get().n;
   assert.equal(linked,name==='original'?4:0,name);
   await reconcileOutputNativeStorage(f.env,{ownerUserId:'owner',personalOnly:true});
   assert.equal(f.media.size,name==='original'?4:0,name);
   if(name==='original')assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_native_storage_writes WHERE status='written'").get().n,4);
  }finally{f.sqlite.close();}
 }
});
