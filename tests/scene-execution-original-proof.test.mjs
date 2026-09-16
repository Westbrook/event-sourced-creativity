import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './scene-admission-original-proof.test.mjs';
const {requireUser}=await import('../worker/pilot-policy.ts');
const {loadOutputJobBinding,createOutputEventExecution}=await import('../worker/output-execution-control.ts');
const {prepareSceneJobSourceClaim}=await import('../worker/scene-job-source-witness.ts');
const {outputAssertionStatements}=await import('../worker/output-command-core.ts');
const {appendEvents,makeEvent}=await import('../worker/runtime.ts');

async function execution(t,options){
 const f=await fixture(t,options);
 const admitted=await f.send('authorize',f.body);assert.equal(admitted.status,200,await admitted.clone().text());
 const admittedBody=await admitted.json();
 const run=await f.send('run',{draftHash:f.plan.draftHash,grantId:admittedBody.original.grantId,explicitRun:true});
 assert.equal(run.status,200,await run.clone().text());
 const queued=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 const binding=await loadOutputJobBinding(f.env,auth.user,queued);assert.ok(binding);
 const correlation=queued.job_id+':attempt:1';
 const claim=prepareSceneJobSourceClaim(f.env,{scope:binding.scope,slot:binding.slot,previousCorrelationId:queued.correlation_id,
  correlationId:correlation,previousRaw:queued.scene_source_version_json});
 const claimed=await f.DB.batch([...claim.before.flatMap(value=>outputAssertionStatements(f.env,value)),
  f.DB.prepare("UPDATE document_jobs SET status='running',attempt_count=1,lease_expires_at=?,correlation_id=? WHERE job_id=?")
   .bind(new Date(Date.now()+240000).toISOString(),correlation,queued.job_id),...claim.after]);
 claim.acknowledge(claimed.slice(-claim.after.length));
 const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 f.reductions=0;f.proofs=0;
 const control=await createOutputEventExecution(f.env,auth.user,job,binding);
 assert.ok(control.refreshScene);
 return Object.assign(f,{control,job,counts:()=>({reductions:f.reductions,proofs:f.proofs})});
}

for(const large of [false,true])test('Scene execution reuses exact current proof'+(large?' with renewed large history':''),async t=>{
 const f=await execution(t,large?{renewals:2,history:5000}:{});
 assert.equal(f.counts().reductions,1,'initial runtime reduction only');
 const proofCount=f.counts().proofs;
 const first=await f.control.refreshScene();
 for(let i=0;i<3;i++)assert.equal(await f.control.refreshScene(),first);
 assert.equal(f.counts().reductions,1,'unchanged successor never rebuilds history');
 assert.equal(f.counts().proofs,proofCount+4,'every refresh revalidates its original predicates');
});

test('Scene committed successor rebuilds exactly once, then reuses its new proof',async t=>{
 const f=await execution(t);
 const before=await f.control.refreshScene();
 const head=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(f.job.stream_id).n;
 const event=makeEvent(f.job.stream_id,head+1,'worker:test','fixture',f.job.correlation_id,'DocumentRenderRequested',
  {document_id:f.job.document_id,artifact_kind:'scene'});
 await appendEvents(f.control.guardedEnvironment,[event],{initialHead:head,retries:1,
  prepareSidecars:f.control.eventWriteSidecars,onSidecarsCommitted:f.control.eventWriteCommitted});
 const after=await f.control.refreshScene();
 assert.notEqual(after,before);assert.equal(f.counts().reductions,2);
 assert.equal(await f.control.refreshScene(),after);assert.equal(f.counts().reductions,2);
 f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
 await assert.rejects(()=>f.control.refreshScene(),/output_scene_source_changed/);
 assert.equal(f.counts().reductions,2,'competing mutation cannot recapture after a committed successor');
});

for(const fault of ['missing','sparse','false','failed','expired','private-body-aba','epoch','retention','grant-deadline'])
test('Scene execution proof refresh fails closed: '+fault,async t=>{
 const f=await execution(t,{renewals:1});
 f.afterBatch=(result,_statements,proof)=>{
  if(!proof)return result;
  if(fault==='missing')return result.slice(0,-1);
  if(fault==='sparse'){delete result[0];return result;}
  if(fault==='false')result[0].results=[{current:0}];
  if(fault==='failed')result[0].success=false;
  if(fault==='expired')t.mock.timers.setTime(Date.parse(f.ready.sceneCostPreview.expiresAt));
  return result;
 };
 if(fault==='private-body-aba')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
 if(fault==='epoch')f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
 if(fault==='retention')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()-1).toISOString(),f.plan.draftId);
 if(fault==='grant-deadline')f.sqlite.prepare("UPDATE output_execution_grants SET expires_at=?").run(new Date(Date.now()+600000).toISOString());
 await assert.rejects(()=>f.control.refreshScene(),/output_scene_source_changed/);
 assert.equal(f.counts().reductions,1,'failed proof never recaptures source');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});
