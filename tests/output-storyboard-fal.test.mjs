import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const C=process.env.FORMA_SOURCE_ROOT;
if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {registerOutputSourceImports,outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');
registerOutputSourceImports();
const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
const {captureOutputStoryboardPlan}=await import('../worker/output-storyboard-plan.ts');
const {bindStoryboardFrameAttempt,readStoryboardFrameAttempt,storyboardFrameHooks}=await import('../worker/output-storyboard-fal.ts');
const {createOutputFalImageContract,captureOutputFalImageRequest,submitOutputFalImageRequest}=await import(C+'/worker/output-fal-image-contract.ts');
const {storyboardFrameSequenceAssertion,retainStoryboardFrameCheckpoint}=await import('../worker/output-storyboard-checkpoint.ts');
const contract=()=>createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
const plan=()=>captureOutputStoryboardPlan({title:'Harbor',summary:'A return',content_markdown:'A keeper returns with a lantern.',presentation:null,items:Array.from({length:4},(_,i)=>({title:'Moment '+i,body:'Keeper '+i,notes:'Lantern continuity',image_prompt:'Keeper at harbor '+i,slide:null}))},contract(),'planner-original');
const request=async(id='frame-original',prompt='Exact adapted keeper direction')=>{
 const c=createOutputFalImageContract('ideogram/v4','1536x1024');
 return captureOutputFalImageRequest(c,c.model,{prompt,expansion_model:c.expansionModel,image_size:{width:c.width,height:c.height},rendering_speed:c.renderingSpeed,acceleration:c.acceleration,num_images:1,sync_mode:false,enable_safety_checker:true,output_format:c.outputFormat},c,id);
};
let network=0;const originalFetch=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('network forbidden');};
test.after(()=>{globalThis.fetch=originalFetch;assert.equal(network,0);});

test('all four claims reconstruct exact plan/source/ordinal/adapted body and reject altered metadata',async()=>{
 const p=await plan(),r=await request(),digests=[];
 for(let i=0;i<4;i++){const mapped=await bindStoryboardFrameAttempt(p,i,r.attempt);const checked=await readStoryboardFrameAttempt(mapped,contract());assert.equal(checked.stage,'image:frame:'+(i+1));assert.equal(checked.plan.raw,p.raw);digests.push(mapped.requestDigest);}
 assert.equal(new Set(digests).size,4);
 const mapped=await bindStoryboardFrameAttempt(p,0,r.attempt);
 for(const mutate of [a=>a.storyboard.frameIndex=1,a=>a.storyboard.adaptedRequestDigest='f'.repeat(64),a=>a.storyboard.plannerResponseId='foreign',a=>a.storyboard.planRaw=a.storyboard.planRaw.replace('Harbor','Changed'),a=>a.storyboard.contract.source.requestHash='sha256:'+'f'.repeat(64),a=>a.logicalCallKey='image:frame:2',a=>a.model='foreign',a=>a.maximumInputTokens=1]){
  const changed=structuredClone(mapped);mutate(changed);await assert.rejects(readStoryboardFrameAttempt(changed,contract()));
 }
 let reads=0;const changed=structuredClone(mapped);Object.defineProperty(changed.storyboard.contract,'frameCount',{enumerable:true,get(){reads++;return 4;}});
 await assert.rejects(readStoryboardFrameAttempt(changed,contract()));assert.equal(reads,0);
});

test('existing real Fal submit sequence uses mapped claim and exact body; checkpoints cannot switch requests',async()=>{
 const p=await plan(),r=await request();const order=[];let admitted;
 const h=storyboardFrameHooks(p,2,{beforeAttempt:async a=>{admitted=a;order.push('claim');},checkpoint:async(c,cp,i)=>{assert.equal(c.body,r.body);assert.equal(cp,p);assert.equal(i,2);order.push('checkpoint');}});
 const result=await submitOutputFalImageRequest(r,{beforeAttempt:h.onBeforeProviderAttempt,checkpoint:h.onOutputFalRequest,pending:()=>order.push('pending'),beforeDispatch:id=>{assert.equal(id,r.attempt.clientRequestId);order.push('dispatch');}},async body=>{assert.equal(body,r.body);order.push('submit-sentinel');return 'sentinel-only';});
 assert.equal(result,'sentinel-only');assert.equal(admitted.logicalCallKey,'image:frame:3');assert.deepEqual(order,['claim','checkpoint','pending','dispatch','submit-sentinel']);
 for(const changed of [await request('foreign'),await request('frame-original','Changed adapted direction')])await assert.rejects(h.onOutputFalRequest(changed));
 await assert.rejects(h.onBeforeProviderAttempt(r.attempt));
});

test('checkpoint failure and final dispatch denial cannot reach the existing submit callback',async()=>{
 for(const stop of ['claim','checkpoint','pending','dispatch']){
  const p=await plan(),r=await request();let submitted=0;
  const h=storyboardFrameHooks(p,0,{beforeAttempt:async()=>{if(stop==='claim')throw Error(stop);},checkpoint:async()=>{if(stop==='checkpoint')throw Error(stop);}});
  await assert.rejects(submitOutputFalImageRequest(r,{beforeAttempt:h.onBeforeProviderAttempt,checkpoint:h.onOutputFalRequest,pending:()=>{if(stop==='pending')throw Error(stop);},beforeDispatch:()=>{if(stop==='dispatch')throw Error(stop);}},async()=>{submitted++;}));
  assert.equal(submitted,0);
 }
 const source=readFileSync(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8');
 const start=source.indexOf('  beforeProviderDispatch(clientRequestId){'),end=source.indexOf('\n  async observeProvider',start);
 const method=source.slice(start,end).trim().replace(/,$/,'');
 const gate=new Function('claimedCalls','localStops','OutputConflictError','assertDispatchDeadline','outputJobIsDurable','job','assertOutputDurableLease','env','artifactKind','requireAudioDispatchCurrent','return ({'+method+'}).beforeProviderDispatch');
 for(const change of [{checkpointed:false},{pending:false},{dispatched:true}]){
  const call={pending:true,dispatched:false,storyboardBinding:'binding',checkpointed:true,...change},run=gate(new Map([['id',call]]),new Map(),Error,()=>{},()=>false,{},()=>{}, {},'storyboard',()=>{});
  assert.throws(()=>run('id'));assert.equal(call.dispatched,change.dispatched??false);
 }
 const call={pending:true,dispatched:false,storyboardBinding:'binding',checkpointed:true};gate(new Map([['id',call]]),new Map(),Error,()=>{},()=>false,{},()=>{}, {},'storyboard',()=>{})('id');assert.equal(call.dispatched,true);
});

function database(){
 const db=outputTestDatabase();db.sqlite.exec(`
 CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
 CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
 CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT);
 CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT);
 CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);
 `);createStoryboardJobTable(db.sqlite);return db;
}
async function fixture(){
 const d=database(),p=await plan(),r=await request(),a=await bindStoryboardFrameAttempt(p,0,r.attempt),future=new Date(Date.now()+60000).toISOString();
 const scope={kind:'personal',key:'personal:owner',ownerUserId:'owner',actorUserId:'owner',documentId:'doc'},slot={slotId:'slot',jobId:'job',routeDigest:'route',grantId:'grant',sourceDigest:'source'};
 const job={job_id:'job',owner_id:'owner',stream_id:'stream',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',attempt_count:1,status:'running',lease_expires_at:future,expires_at:future,kind:'render_document',result_json:JSON.stringify({artifactPlan:p.plan,plannerResponseId:p.plannerResponseId,renderedItems:[]})};
 insertStoryboardJob(d.sqlite,job);
 d.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?)').run(scope.key,'slot','job','route','grant','source','running');
 d.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(scope.key,'slot',a.logicalCallKey,a.logicalCallKey,'fal',a.model,a.clientRequestId,a.requestDigest,'pending',null,null);
 return {...d,p,r,a,scope,slot,job};
}

test('actual checkpoint transaction retains exact two private bodies and refuses replay',async()=>{
 const f=await fixture();try{
  await retainStoryboardFrameCheckpoint(f.env,{userId:'owner'},f.job,f.scope,f.slot,f.r,f.p,0);
  const result=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json),cp=result.outputStoryboardCheckpoints.f1;
  assert.equal(cp.requestDigest,f.a.requestDigest);assert.equal(cp.adaptedRequestDigest,f.r.attempt.requestDigest);assert.equal(cp.storyboardBindingSha256,f.p.bindingSha256);
  const bodies=f.sqlite.prepare('SELECT kind,content FROM private_content ORDER BY kind').all();assert.equal(bodies.length,2);assert(bodies.some(x=>x.content===f.r.body));assert(bodies.some(x=>x.content===f.p.raw));
  await assert.rejects(retainStoryboardFrameCheckpoint(f.env,{userId:'owner'},f.job,f.scope,f.slot,f.r,f.p,0));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,2);
 }finally{f.sqlite.close();}
});

test('actual checkpoint SQL rejects changed owner/lease/job/source/claim/plan atomically without private writes',async()=>{
 const changes=["UPDATE output_operation_slots SET scope_key='foreign'","UPDATE output_operation_slots SET slot_id='foreign'","UPDATE document_jobs SET owner_id='foreign'","UPDATE document_jobs SET attempt_count=2","UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z'","UPDATE output_operation_slots SET job_id='foreign'","UPDATE document_jobs SET correlation_id='foreign'","UPDATE document_jobs SET result_json=json_set(result_json,'$.artifactPlan.title','Changed')","UPDATE output_operation_slots SET source_digest='changed'","UPDATE output_operation_slots SET route_digest='changed'","UPDATE output_operation_slots SET grant_id='changed'","UPDATE output_provider_calls SET request_digest='changed'","UPDATE output_provider_calls SET client_request_id='changed'","UPDATE output_provider_calls SET status='uncertain'"];
 for(const sql of changes){const f=await fixture();try{f.sqlite.exec(sql);await assert.rejects(retainStoryboardFrameCheckpoint(f.env,{userId:'owner'},f.job,f.scope,f.slot,f.r,f.p,0));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,0);}finally{f.sqlite.close();}}
});

test('next frame requires preceding exact retained media and settled original receipt, never pending or unknown usage',async()=>{
 const f=await fixture();try{
  const row={renderedItems:[{media_url:'/api/media/original',provider_submission_id:f.a.clientRequestId,provider_request_id:'provider-original',provider_model:f.a.model}],outputStoryboardCheckpoints:{f1:{frameIndex:0,stage:f.a.logicalCallKey,clientRequestId:f.a.clientRequestId,requestDigest:f.a.requestDigest,provider:'fal',model:f.a.model,storyboardBindingSha256:f.p.bindingSha256}}};
  f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(row));
  f.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=100,provider_response_id='provider-original'");
  const q=storyboardFrameSequenceAssertion(f.scope,f.slot,f.job,1,f.p.bindingSha256),accepted=()=>f.sqlite.prepare('SELECT ('+q.sql+') passed').get(...q.bindings).passed;
  assert.equal(accepted(),1);
  for(const key of ['frameIndex','stage','clientRequestId','requestDigest','provider','model'])for(const operation of ['omit','tamper']){
   const changed=structuredClone(row);if(operation==='omit')delete changed.outputStoryboardCheckpoints.f1[key];else changed.outputStoryboardCheckpoints.f1[key]=key==='frameIndex'?1:'foreign';
   f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(changed));assert.equal(accepted(),0,key+' '+operation);
  }
  f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(row));
for(const sql of ["UPDATE output_operation_slots SET job_id='foreign'","UPDATE output_operation_slots SET scope_key='foreign'","UPDATE output_operation_slots SET slot_id='foreign'","UPDATE output_provider_calls SET status='pending'","UPDATE output_provider_calls SET used_microusd=NULL","UPDATE output_provider_calls SET provider_response_id='foreign'","UPDATE document_jobs SET result_json=json_set(result_json,'$.outputStoryboardCheckpoints.f1.storyboardBindingSha256','changed')","UPDATE document_jobs SET result_json=json_set(result_json,'$.renderedItems[0].media_url','https://foreign')"]){
   f.sqlite.exec('SAVEPOINT negative');f.sqlite.exec(sql);assert.equal(accepted(),0);f.sqlite.exec('ROLLBACK TO negative');f.sqlite.exec('RELEASE negative');
  }
 }finally{f.sqlite.close();}
});
