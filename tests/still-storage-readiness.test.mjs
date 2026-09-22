import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {StillClient} from '../src/still/client.ts';
for(const shared of [false,true])test(`readiness is authorized, read-only, fresh and gates admission (${shared})`,async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Provider forbidden');};
 try{
  const before=f.counts();
  const url=`/api/document-jobs/still-readiness?documentId=${f.documentId}`;
  let response=await f.request(url);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).ready,true);
  assert.deepEqual(f.counts(),before);assert.equal(calls,0);
  assert.equal((await f.request('/api/document-jobs/still-readiness?documentId=foreign')).status,404);
  const invalid=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{previousAttemptId:'another-owner-attempt',paidMediaConfirmed:true}}));assert.equal(invalid.status,409);assert.equal((await invalid.json()).error,'generation_previous_attempt_unavailable');assert.deepEqual(f.counts(),before);
  f.sqlite.exec('CREATE TABLE memory_derivation_consumers(unqualified TEXT)');
  response=await f.request(url);assert.equal((await response.json()).ready,false);
  response=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{paidMediaConfirmed:true}}));
  assert.equal(response.status,503,await response.clone().text());assert.equal((await response.json()).submission,'not-submitted');assert.deepEqual(f.counts(),before);assert.equal(calls,0);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});
test('late readiness response cannot enable another document',async()=>{
 const c=new StillClient();c.position.documentId='first';c.verifyScope=async()=>()=>{};
 let finish;c.request=()=>new Promise(resolve=>finish=resolve);
 const pending=c.checkGenerationReadiness();await Promise.resolve();c.position.documentId='second';finish({ready:true,documentId:'first'});
 await assert.rejects(pending,/Document changed/);
});

test('explicit original-result recovery is revalidated before maintenance or provider calls',async()=>{
 const f=await createSceneCostFixture(1),saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Provider forbidden');};
 try{
  const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
  const checkpoint={artifactKind:'video',providerJobId:'original-provider-id',errorDetail:{code:'provider_network_failed',category:'network',retryable:true}};
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at) VALUES('recover',?,?,?,'render_document','failed','still','recover',1,?,?,1,?,?,?)`).run(f.owner,f.streamId,f.documentId,JSON.stringify({artifactKind:'video',paidMediaConfirmed:true}),JSON.stringify(checkpoint),now,expires,now);
  const before=f.counts();
  for(const attemptCount of [0,2]){const response=await f.request('/api/document-jobs/recover/retry',f.json({recoveryOnly:true,attemptCount}));assert.equal(response.status,409);assert.equal((await response.json()).error,'original_result_recovery_unavailable');}
  f.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id='recover'").run(JSON.stringify({artifactKind:'video',productionMode:'managed',paidMediaConfirmed:true}));
  const managed=await f.request('/api/document-jobs/recover/retry',f.json({recoveryOnly:true,attemptCount:1}));assert.equal(managed.status,409);assert.equal((await managed.json()).error,'original_result_recovery_unavailable');
  assert.deepEqual(f.counts(),before);assert.equal(calls,0);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});
