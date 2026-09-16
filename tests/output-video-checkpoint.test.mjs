import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {registerOutputSourceImports,outputTestDatabase} from './output-execution-test-helpers.mjs';
import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
registerOutputSourceImports();
const {createVideoOutputContract}=await import('../src/model/output-video-contract.ts');
const {prepareVideoPlannerRequest}=await import('../worker/openai-adapter.ts');
const {captureOutputVideoAttempt}=await import('../worker/output-video-execution.ts');
const {retainOutputVideoRequestCheckpoint,retainOutputVideoMediaEnvelope,retainOutputVideoPlannerEnvelope}=await import('../worker/output-video-checkpoint.ts');
const {captureVideoPlannerEnvelope}=await import('../worker/output-video-planner-envelope.ts');
const {MAX_STORYBOARD_ENVELOPE_BYTES}=await import('../worker/output-storyboard-envelope.ts');
const {OUTPUT_VIDEO_TRANSPORT}=await import('../worker/output-video-execution.ts');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const contract=createVideoOutputContract({source:{draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},reference:{version:1,sourceProjectId:'p',sourceDocumentId:'d',sourceBlockId:'b',referenceId:'r',sha256:'f'.repeat(64),permissionAttestation:'i-own-or-have-permission'},frameSize:'1280x720'});
const planner=await prepareVideoPlannerRequest({},'owner',{documentTitle:'Pan',snapshot:{facts:[]},options:{productionMode:'manual',itemCount:1,videoSeconds:4,videoSize:'1280x720',videoAudioMode:'silent'}},contract);
const media=await captureOutputVideoAttempt(contract,JSON.stringify({prompt:'A slow pan.',aspect_ratio:'16:9',duration:4,resolution:'480p',generate_audio:false,end_user_id:'a'.repeat(64),image_urls:['https://fal.media/original-still.png']}),'forma-video-media-original');
function fixture(){
 const f=outputTestDatabase();f.sqlite.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
 CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT);
 CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT);
 CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);`);
 createStoryboardJobTable(f.sqlite);
 const future=new Date(Date.now()+60000).toISOString(),scope={kind:'personal',key:'scope',actorUserId:'owner',ownerUserId:'owner',documentId:'doc'},slot={scopeKey:'scope',slotId:'slot',jobId:'job',routeDigest:'route',grantId:'grant',sourceDigest:'source',attemptOrdinal:0,previousSlotId:null};
 const job={job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',attempt_count:1,kind:'render_document',status:'running',lease_expires_at:future,expires_at:future,result_json:'{}'};
 insertStoryboardJob(f.sqlite,job);f.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?)').run('scope','slot','job','route','grant','source','running');
 for(const a of [planner.attempt,media])f.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('scope','slot',a.logicalCallKey,a.logicalCallKey,a===media?'fal':'openai',a.model,a.clientRequestId,a.requestDigest,'pending',null,null);
 const controller=new AbortController(),lease={signal:controller.signal,deadlineMs:Date.now()+30000,assertCurrent(){controller.signal.throwIfAborted();assert.ok(Date.now()<this.deadlineMs,'lease expired');}};
 const request=a=>retainOutputVideoRequestCheckpoint(f.env,scope,slot,job,a,lease),envelope=e=>retainOutputVideoMediaEnvelope(f.env,scope,slot,job,e,lease);
 return{...f,scope,slot,job,lease,controller,request,envelope,count:()=>Number(f.sqlite.prepare('SELECT COUNT(*) AS count FROM private_content').get().count),close:()=>f.sqlite.close()};
}
function response(phase='submission',raw=Buffer.from('{"request_id":"original"}')){return{schemaVersion:1,phase,clientRequestId:media.clientRequestId,requestDigest:media.requestDigest,providerRequestId:phase==='submission'?null:'original',requestUrl:phase==='submission'?'https://queue.fal.run/'+media.model:'https://queue.fal.run/'+media.model+'/requests/original/'+phase,httpStatus:200,headers:[['content-type','application/json']],decodedByteLength:raw.length,decodedBodySha256:hash(raw),decodedBodyBase64:raw.toString('base64')};}

test('actual captured planner and media envelopes above the generic JSON string limit retain exact bytes',async()=>{
 const f=fixture();try{
  await f.request(planner.attempt);
  const body=JSON.stringify({id:'resp_original',model:planner.attempt.model,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({title:'Pan',summary:'A still subject.',content_markdown:'One four-second silent pan.',items:[{title:'Pan',body:'Motion '.repeat(1100),notes:'Silent',image_prompt:'Original subject.',context_group_ids:[]}]})}]}],usage:{input_tokens:100,output_tokens:1800,total_tokens:1900}});
  const captured=await captureVideoPlannerEnvelope(new Response(body),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model});
  assert.ok(captured.retainedBytes>6144&&captured.retainedBytes<MAX_STORYBOARD_ENVELOPE_BYTES);
  await retainOutputVideoPlannerEnvelope(f.env,f.scope,f.slot,f.job,captured,f.lease);
  const cp=JSON.parse(f.job.result_json),raw=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(cp.outputVideoPlannerEnvelope.responseRef).content;
  assert.deepEqual(JSON.parse(raw),captured);assert.equal(Buffer.from(JSON.parse(raw).bodyBase64,'base64').toString(),body);
  await f.request(media);const envelope=response('submission',Buffer.from(JSON.stringify({request_id:'original',logs:'x'.repeat(7000)})));
  await f.envelope(envelope);const mediaCp=JSON.parse(f.job.result_json).outputVideoMediaEnvelopes[0];
  assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(mediaCp.responseRef).content),envelope);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM output_provider_calls WHERE used_microusd IS NOT NULL').get().count,0);
 }finally{f.close();}
});
test('dedicated envelope byte bounds preserve hostile JSON, base64, identity and byte-count rejection',async()=>{
 let getterCalls=0;
 for(const kind of ['planner','media'])for(const mutate of [
  (e,key,cap)=>{e[key]=Buffer.alloc(cap+1,120).toString('base64');if(key==='bodyBase64')e.retainedBytes=cap+1;else e.decodedByteLength=cap+1;},
  (e,key)=>{e[key]='!not-base64!';},
  (e,key)=>{e[key]='YQ';if(key==='bodyBase64')e.retainedBytes=1;else e.decodedByteLength=1;},
  e=>{e.clientRequestId='foreign';},e=>{e.requestDigest='0'.repeat(64);},
  (e,key)=>{if(key==='bodyBase64')e.retainedBytes++;else e.decodedByteLength++;},
  (e,key)=>{Object.defineProperty(e,key,{enumerable:true,get(){getterCalls++;throw Error('body getter invoked');}});},
  e=>{Object.defineProperty(e,'extra',{enumerable:true,get(){getterCalls++;throw Error('extra getter invoked');}});},
  e=>{Object.defineProperty(e,'hidden',{value:1});},e=>{e[Symbol('extra')]=1;},
  e=>{e.extra=e;},e=>{Object.setPrototypeOf(e,{foreign:true});},e=>{e.extra='x'.repeat(8193);},
  e=>{Object.defineProperty(e,'__proto__',{value:'bad',enumerable:true});},
 ]){
  const f=fixture();try{
   await f.request(kind==='planner'?planner.attempt:media);
   const captured=kind==='planner'?await captureVideoPlannerEnvelope(Response.json({id:'resp_original'}),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model}):response();
   const e=structuredClone(captured),key=kind==='planner'?'bodyBase64':'decodedBodyBase64',cap=kind==='planner'?MAX_STORYBOARD_ENVELOPE_BYTES:OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes;
   mutate(e,key,cap);const count=f.count(),before=f.job.result_json;
   await assert.rejects(kind==='planner'?retainOutputVideoPlannerEnvelope(f.env,f.scope,f.slot,f.job,e,f.lease):f.envelope(e));
   assert.equal(f.count(),count);assert.equal(f.job.result_json,before);
   assert.equal(getterCalls,0,'descriptor validation never invokes getters');
  }finally{f.close();}
 }
});
test('planner and media exact transport caps retain bounded original bytes',async()=>{
 for(const kind of ['planner','media']){const f=fixture();try{
  await f.request(kind==='planner'?planner.attempt:media);
  const cap=kind==='planner'?MAX_STORYBOARD_ENVELOPE_BYTES:OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes;
  const bytes=Buffer.alloc(cap,120),envelope=kind==='planner'?await captureVideoPlannerEnvelope(new Response(bytes),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model}):response('submission',bytes);
  if(kind==='planner'){assert.equal(envelope.retainedBytes,cap);assert.equal(envelope.complete,true);await retainOutputVideoPlannerEnvelope(f.env,f.scope,f.slot,f.job,envelope,f.lease);}else await f.envelope(envelope);
  assert.equal(f.count(),2);
 }finally{f.close();}}
});
test('real private inserts bind exact planner/media wire and original decoded envelopes atomically without cleanup',async()=>{
 const f=fixture();try{
  f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run('expired-other','owner','prompt','keep','2020-01-01','2020-01-02');
  await f.request(planner.attempt);await f.request(media);
  for(const phase of ['submission','status','result'])await f.envelope(response(phase,phase==='status'?Buffer.from([0xff,0xfe]):undefined));
  const cp=JSON.parse(f.job.result_json);assert.equal(cp.outputVideoMediaEnvelopes.length,3);assert.equal(cp.outputVideoPlannerCheckpoint.requestDigest,planner.requestDigest);
  assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(cp.outputVideoMediaCheckpoint.requestRef).content,media.video.requestBody);
  const raw=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(cp.outputVideoMediaEnvelopes[1].responseRef).content;assert.equal(JSON.parse(raw).decodedBodyBase64,Buffer.from([0xff,0xfe]).toString('base64'));
  assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get('expired-other').content,'keep');
  assert.equal(f.sqlite.prepare('SELECT result_json FROM document_jobs WHERE job_id=?').get('job').result_json,f.job.result_json);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM output_provider_calls WHERE used_microusd IS NOT NULL').get().count,0,'Storage never invents provider settlement');
 }finally{f.close();}
});
test('changed paid identity, lease, cancelled job and replay roll back all private inserts',async()=>{
 for(const mutate of [f=>f.sqlite.exec("UPDATE output_provider_calls SET request_digest='changed'"),f=>f.sqlite.exec("UPDATE document_jobs SET status='cancelled'"),f=>f.sqlite.exec("UPDATE document_jobs SET attempt_count=2"),f=>f.sqlite.exec("UPDATE output_operation_slots SET source_digest='other'"),f=>f.controller.abort(Error('cancelled'))]){
  const f=fixture();try{mutate(f);await assert.rejects(f.request(media));assert.equal(f.count(),0);assert.equal(f.job.result_json,'{}');}finally{f.close();}
 }
 const f=fixture();try{await f.request(media);const count=f.count();await assert.rejects(f.request(media));assert.equal(f.count(),count);await f.envelope(response());const raw=f.job.result_json;await assert.rejects(f.envelope(response()));assert.equal(f.job.result_json,raw);}finally{f.close();}
});
test('changed envelope bytes, order, current checkpoint or post-await cancellation cannot publish private receipt',async()=>{
 for(const alter of [e=>e.decodedBodySha256='0'.repeat(64),e=>e.decodedByteLength++,e=>e.phase='status',e=>e.clientRequestId='foreign',e=>e.headers=[['authorization','not-storable']]]){
  const f=fixture();try{await f.request(media);const count=f.count(),e=response();alter(e);await assert.rejects(f.envelope(e));assert.equal(f.count(),count);}finally{f.close();}
 }
 const f=fixture();try{const prior=f.env.DB.batch;f.env.DB.batch=async statements=>{f.sqlite.exec("UPDATE document_jobs SET status='cancelled'");return prior(statements);};await assert.rejects(f.request(media));assert.equal(f.count(),0);}finally{f.close();}
});
