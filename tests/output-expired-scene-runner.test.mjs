import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './scene-admission-original-proof.test.mjs';
const {runDocumentJob}=await import('../worker/document-jobs-api.ts');
const {requireUser}=await import('../worker/pilot-policy.ts');
const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/event-write-primitives.ts');
for(const type of ['DocumentRenderCompleted','DocumentRenderFailed'])test('expired Scene reconciles recorded '+type+' without new authority',async t=>{
 const f=await fixture(t);const admitted=await f.send('authorize',f.body);assert.equal(admitted.status,200);
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 t.mock.timers.setTime(Date.parse(f.ready.sceneCostPreview.expiresAt)+60000);
 const correlation=row.job_id+':attempt:1',lease=new Date(Date.now()-1000).toISOString();
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=? WHERE job_id=?").run(correlation,lease,row.job_id);
 f.sqlite.prepare("UPDATE output_operation_slots SET status='queued' WHERE job_id=?").run(row.job_id);
 f.sqlite.prepare("UPDATE output_execution_grants SET status='active'").run();
 const sequence=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(row.stream_id).n+1;
 const event=makeEvent(row.stream_id,sequence,'worker:test','fixture',correlation,type,{document_id:row.document_id,error_code:'provider_original_failure',error_message:'Original failure'});
 f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?').join(',')})`).run(...eventWriteBindings(event));
 const reservations=f.sqlite.prepare('SELECT * FROM budget_reservations').all(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all();
 for(let i=0;i<2;i++){
  const result=await runDocumentJob(f.env,auth.user,row.job_id);
  assert.equal(result.status,type==='DocumentRenderCompleted'?'completed':'failed');
  assert.equal(result.attempt_count,1);assert.equal(result.correlation_id,correlation);assert.equal(result.scene_source_version_json,row.scene_source_version_json);
  if(type==='DocumentRenderFailed')assert.equal(JSON.parse(result.result_json).errorDetail.code,'provider_original_failure');
  else assert.equal(JSON.parse(result.result_json).errorDetail,undefined);
 }
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM budget_reservations').all(),reservations);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all(),cost);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});
for(const mode of ['expired','live','expired-authority'])test('actual runner retains one Scene claim: '+mode,async t=>{
 const f=await fixture(t);
 const admitted=await f.send('authorize',f.body);assert.equal(admitted.status,200,await admitted.clone().text());
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 if(mode==='expired-authority')t.mock.timers.setTime(Date.parse(f.ready.sceneCostPreview.expiresAt)+60000);
 const lease=new Date(Date.now()+(mode==='live'?60000:-1000)).toISOString();
 // Synthetic already-claimed snapshot. The actual runner must never parse this
 // retained admission witness into a second claim or send provider traffic.
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=? WHERE job_id=?").run(row.job_id+':attempt:1',lease,row.job_id);
 f.sqlite.prepare("UPDATE output_operation_slots SET status='queued' WHERE job_id=?").run(row.job_id);
 f.sqlite.prepare("UPDATE output_execution_grants SET status='active'").run();
 const token=f.sqlite.prepare('SELECT * FROM budget_reservations').all(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all();
 for(let i=0;i<2;i++){
  const result=await runDocumentJob(f.env,auth.user,row.job_id);assert.equal(result.status,mode==='live'?'running':'failed');
  assert.equal(result.attempt_count,1);assert.equal(result.scene_source_version_json,row.scene_source_version_json);
  assert.equal(result.correlation_id,row.job_id+':attempt:1');
 }
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM budget_reservations').all(),token);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all(),cost);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});
