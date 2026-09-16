import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {videoEvidenceFixture} from './output-video-completion-fixture.mjs';
const {claimOutputVideoRecoveryLease}=await import('../worker/output-video-recovery-lease.ts');
const sha=x=>createHash('sha256').update(x).digest('hex');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('lease must not dispatch');};test.after(()=>{globalThis.fetch=originalFetch;});
async function fixture(){
 const f=await videoEvidenceFixture();
 f.sqlite.exec(`ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'plan';
 ALTER TABLE output_operation_slots ADD COLUMN target_id TEXT DEFAULT 'target';
 ALTER TABLE output_operation_slots ADD COLUMN target_contract_digest TEXT DEFAULT 'target-contract';
 ALTER TABLE output_operation_slots ADD COLUMN attempt_ordinal INTEGER DEFAULT 0;
 ALTER TABLE output_operation_slots ADD COLUMN previous_slot_id TEXT;
 ALTER TABLE output_execution_grants ADD COLUMN actor_user_id TEXT DEFAULT 'owner';
 ALTER TABLE output_execution_grants ADD COLUMN context_id TEXT;
 CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
 INSERT INTO output_plan_revisions VALUES('scope','plan','owner','doc',NULL,NULL,'personal');
 UPDATE output_provider_calls SET status='uncertain' WHERE provider='fal';`);
 const reference={scopeKey:'scope',grantId:'grant',slotId:'slot',planRevisionId:'plan',targetId:'target',targetContractDigest:'target-contract',sourceDigest:'source'};
 f.cp.outputExecution=reference;f.persist();f.job.request_json=JSON.stringify({...f.settings,artifactKind:'video',productionMode:'manual',itemCount:1});
 f.sqlite.prepare("UPDATE document_jobs SET request_json=?,source_surface='outputs'").run(f.job.request_json);
 await f.finish('failed');assert.equal(f.job.status,'failed');assert.equal(f.job.lease_expires_at,null);
 const assertions=[{sql:'1=1',bindings:[],deadlineMs:Date.now()+40000}],before=f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json;
 const claim=()=>claimOutputVideoRecoveryLease(f.env,f.scope,f.slot,f.job,{assertions});
 return {...f,before,claim,assertions};
}
const hook=()=>({signal:new AbortController().signal,deadlineMs:Date.now()+30000,assertCurrent(){if(Date.now()>=this.deadlineMs)throw Error('expired');}});
const envelope=f=>{const raw=Buffer.from([255,254,0]);return{schemaVersion:1,phase:'status',clientRequestId:f.mediaAttempt.clientRequestId,requestDigest:f.mediaAttempt.requestDigest,providerRequestId:'video_original',requestUrl:'https://queue.fal.run/bytedance/seedance-2.0/requests/video_original/status',httpStatus:200,headers:[['content-type','application/json']],decodedByteLength:raw.length,decodedBodySha256:sha(raw),decodedBodyBase64:raw.toString('base64')};};

test('failed-original recovery claims only a bounded read lease and privately retains raw response without rewriting original evidence',async()=>{
 const f=await fixture();try{
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),count=f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n;
  const lease=await f.claim();assert(lease.deadlineMs<=f.assertions[0].deadlineMs);assert(lease.deadlineMs<=Date.parse(f.job.expires_at));assert.equal(lease.providerRequestId,'video_original');await lease.assertCurrent();
  const saved=await lease.retainEnvelope(envelope(f),hook());assert.equal(saved.token,lease.token);
  const current=f.sqlite.prepare('SELECT * FROM document_jobs').get(),cp=JSON.parse(current.result_json),prior=JSON.parse(f.before);
  assert.equal(current.status,'failed');assert.equal(current.lease_expires_at,null);assert.equal(current.expires_at,f.job.expires_at);
  for(const [key,value] of Object.entries(prior))assert.deepEqual(cp[key],value,key);
  assert.equal(cp.outputVideoRecoveryEnvelopes.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,count+1);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),calls);
  const retained=JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(saved.responseRef).content);assert.equal(retained.decodedBodyBase64,envelope(f).decodedBodyBase64);
  await assert.rejects(f.claim());await lease.release();await assert.rejects(lease.assertCurrent());
 }finally{f.sqlite.close();}
});

test('checkpoint-only original execution is required; exact legacy duplicate is optional and never sufficient',async()=>{
 for(const variant of ['absent','matching','null','foreign','missing-checkpoint','null-checkpoint','scopeKey','grantId','slotId','planRevisionId','targetId','targetContractDigest','sourceDigest']){
  const f=await fixture();try{
   const request=JSON.parse(f.job.request_json),checkpoint=JSON.parse(f.job.result_json),reference=structuredClone(checkpoint.outputExecution);
   assert.equal(Object.hasOwn(request,'outputExecution'),false);
   if(variant==='matching'||variant==='missing-checkpoint'||variant==='null-checkpoint')request.outputExecution=reference;
   if(variant==='null')request.outputExecution=null;
   if(variant==='foreign')request.outputExecution={...reference,slotId:'foreign'};
   if(variant==='missing-checkpoint')delete checkpoint.outputExecution;
   if(variant==='null-checkpoint')checkpoint.outputExecution=null;
   if(Object.hasOwn(reference,variant))checkpoint.outputExecution[variant]='foreign';
   f.job.request_json=JSON.stringify(request);f.job.result_json=JSON.stringify(checkpoint);
   f.sqlite.prepare('UPDATE document_jobs SET request_json=?,result_json=?').run(f.job.request_json,f.job.result_json);
   const before=f.sqlite.prepare('SELECT * FROM document_jobs').get(),calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),slots=f.sqlite.prepare('SELECT * FROM output_operation_slots').all(),grants=f.sqlite.prepare('SELECT * FROM output_execution_grants').all();
   if(variant==='absent'||variant==='matching'){
    const lease=await f.claim();await lease.assertCurrent();await lease.release();
    const after=f.sqlite.prepare('SELECT * FROM document_jobs').get();
    assert.equal(after.request_json,before.request_json);assert.equal(after.status,'failed');assert.equal(after.expires_at,before.expires_at);assert.equal(after.lease_expires_at,before.lease_expires_at);
    assert.deepEqual(JSON.parse(after.result_json).outputExecution,reference);
   }else{await assert.rejects(f.claim());assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_jobs').get(),before);}
   assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),calls);
   assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_operation_slots').all(),slots);assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_execution_grants').all(),grants);
  }finally{f.sqlite.close();}
 }
});
test('claimed recovery still withdraws if either immutable reference body changes',async()=>{
 for(const field of ['request_json','result_json']){
  const f=await fixture();try{
   const lease=await f.claim(),calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all();
   const body=JSON.parse(f.sqlite.prepare('SELECT '+field+' AS body FROM document_jobs').get().body);
   body.outputExecution={...JSON.parse(f.job.result_json).outputExecution,slotId:'foreign'};
   f.sqlite.prepare('UPDATE document_jobs SET '+field+'=?').run(JSON.stringify(body));
   const before=f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n;
   await assert.rejects(lease.assertCurrent());await assert.rejects(lease.retainEnvelope(envelope(f),hook()));
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,before);
   assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),calls);
  }finally{f.sqlite.close();}
 }
});
test('canceled, foreign, concurrent, expired, changed-source and unknown-provider originals cannot claim recovery',async()=>{
 const changes=[
  f=>{f.job.status='canceled';f.sqlite.exec("UPDATE document_jobs SET status='canceled'");},
  f=>f.sqlite.exec("UPDATE output_plan_revisions SET owner_user_id='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET source_digest='changed'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id=NULL WHERE provider='fal'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET status='pending' WHERE provider='fal'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET request_digest='changed' WHERE provider='openai'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET lease_expires_at='2999-01-01T00:00:00.000Z'"),
  f=>{f.assertions[0].deadlineMs=Date.now()-1;},
  f=>{f.assertions[0].sql='0=1';},
  f=>f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE kind='prompt'"),
 ];
 for(const change of changes){const f=await fixture();try{change(f);const before=f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json;await assert.rejects(f.claim());assert.equal(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json,before);}finally{f.sqlite.close();}}
});

test('stale callback or release cannot overwrite new recovery, and a late source change leaves no private insert',async()=>{
 const f=await fixture();try{
  const first=await f.claim();const count=f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n;
  f.sqlite.exec("UPDATE output_operation_slots SET source_digest='changed'");await assert.rejects(first.retainEnvelope(envelope(f),hook()));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,count);
  f.sqlite.exec("UPDATE output_operation_slots SET source_digest='source'");await first.release();f.job.result_json=f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json;
  const second=await f.claim();await first.release();await second.assertCurrent();await assert.rejects(first.retainEnvelope(envelope(f),hook()));
  const invalid=envelope(f);invalid.providerRequestId='other';await assert.rejects(second.retainEnvelope(invalid,hook()));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,count);
  await second.release();
 }finally{f.sqlite.close();}
});

test('real GET-only recovery and private callbacks qualify measured completion while the original remains failed',async()=>{
 const {readOriginalOutputVideo}=await import('../worker/output-video-execution.ts');
 const {verifyOutputVideoRecoveryCompletion}=await import('../worker/output-video-completion.ts');
 const {outputAssertionStatements}=await import('../worker/output-requirements-ledger.ts');
 const f=await fixture(),old=globalThis.fetch,requests=[];
 try{
  const lease=await f.claim();
  globalThis.fetch=async(url,init)=>{
   requests.push({url:String(url),method:init?.method??'GET'});
   if(String(url).endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED'});
   if(String(url)==='https://fal.media/recovered.mp4')return new Response(f.bytes,{headers:{'content-type':'video/mp4'}});
   return Response.json({request_id:'video_original',video:{url:'https://fal.media/recovered.mp4',content_type:'video/mp4',file_size:f.bytes.length}});
  };
  const result=await readOriginalOutputVideo({...f.env,FAL_KEY:'offline-test-key'},{contract:lease.contract,requestBody:lease.requestBody,clientRequestId:lease.attempt.clientRequestId,requestDigest:lease.attempt.requestDigest,providerRequestId:lease.providerRequestId},{
   onBeforeRead:async(hook)=>{hook.assertCurrent();await lease.assertCurrent();hook.assertCurrent();},onEnvelope:lease.retainEnvelope,
  });
  assert.equal(result.status,'completed');assert.deepEqual(result.bytes,f.bytes);assert.equal(requests.length,3);assert(requests.every(r=>r.method==='GET'));
  // Financial settlement is an explicit fixture setup, not exercised or claimed
  // by this read/custody test. The real completion verifier requires it.
  await assert.rejects(verifyOutputVideoRecoveryCompletion(lease,f.env,f.scope,f.slot,f.job,f.settings,f.artifactId,f.artifact,{deadlineMs:lease.deadlineMs}));
  f.sqlite.exec("UPDATE output_provider_calls SET status='settled' WHERE provider='fal'");
  const proof=await verifyOutputVideoRecoveryCompletion(lease,f.env,f.scope,f.slot,f.job,f.settings,f.artifactId,f.artifact,{deadlineMs:lease.deadlineMs});
  assert.equal(proof.receipt.media.sha256,f.stored.contentHash);assert.equal(proof.receipt.providerCallCount,2);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
  await f.env.DB.batch(proof.assertions.flatMap(a=>outputAssertionStatements(f.env,a)));
  await lease.release();await assert.rejects(f.env.DB.batch(proof.assertions.flatMap(a=>outputAssertionStatements(f.env,a))));
 }finally{globalThis.fetch=old;f.sqlite.close();}
});
