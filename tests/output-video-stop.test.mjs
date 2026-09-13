import assert from 'node:assert/strict';
import test from 'node:test';
import {videoRetainedFixture} from './output-video-retained-fixture.mjs';
const {stopOutputVideoJob}=await import('../worker/output-video-stop.ts');
async function fixture(){
 const f=await videoRetainedFixture();f.sqlite.prepare("UPDATE document_jobs SET status='running',lease_expires_at=?,completed_at=NULL,error_message=NULL").run(f.job.expires_at);f.sqlite.exec("UPDATE output_operation_slots SET status='running';UPDATE output_execution_grants SET status='active'");
 Object.assign(f.job,f.sqlite.prepare('SELECT * FROM document_jobs').get());return f;
}
test('native Video Stop tombstones local work and preserves every pending call and private original receipt',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('No provider cancellation or replacement request');};
 try{const f=await fixture();try{
  f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE provider='fal'");
  const before=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),privateBefore=f.sqlite.prepare('SELECT * FROM private_content ORDER BY content_id').all();
  const result=await stopOutputVideoJob(f.env,'owner',f.job);assert.equal(result.stoppedCount,1);assert.equal(result.job.status,'canceled');assert.equal(result.job.lease_expires_at,null);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM private_content ORDER BY content_id').all(),privateBefore);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'active');
  const cp=JSON.parse(result.job.result_json);assert.equal(cp.outputVideoStop.providerCancellation,'unconfirmed');assert.equal(cp.noAutomaticRetry,true);assert.deepEqual(cp.outputVideoMediaEnvelopes,JSON.parse(f.job.result_json).outputVideoMediaEnvelopes);
  assert.equal((await stopOutputVideoJob(f.env,'owner',f.job)).stoppedCount,0);await assert.rejects(f.verify());
 }finally{f.sqlite.close();}}finally{globalThis.fetch=old;}
});
test('foreign, shared and finalizing jobs cannot be stopped through the native Video path',async()=>{
 for(const mutate of [f=>f.job.owner_id='foreign',f=>f.sqlite.exec("UPDATE output_plan_revisions SET scope_kind='project'"),f=>f.sqlite.exec("INSERT INTO project_resource_scopes VALUES('document','doc')")]){const f=await fixture();try{mutate(f);await assert.rejects(stopOutputVideoJob(f.env,'owner',f.job));assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'running');}finally{f.sqlite.close();}}
 const f=await fixture();try{f.sqlite.exec("UPDATE document_jobs SET status='committing'");assert.deepEqual(await stopOutputVideoJob(f.env,'owner',f.job),{error:'job_finalizing',status:409});}finally{f.sqlite.close();}
});
test('Stop races cannot cancel a foreign original or restart a completed job',async()=>{
 const f=await fixture();try{const batch=f.env.DB.batch;f.env.DB.batch=async statements=>{f.sqlite.exec("UPDATE document_jobs SET correlation_id='other'");return batch(statements);};assert.equal((await stopOutputVideoJob(f.env,'owner',f.job)).stoppedCount,0);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'running');}finally{f.sqlite.close();}
});
