import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './scene-admission-original-fixture.mjs';
const {requireUser}=await import('../worker/pilot-policy.ts');
const {loadOutputJobBinding,createOutputEventExecution}=await import('../worker/output-execution-control.ts');
const {prepareSceneJobSourceClaim}=await import('../worker/scene-job-source-witness.ts');
const {outputAssertionStatements}=await import('../worker/output-command-core.ts');
const {appendEvents,makeEvent}=await import('../worker/runtime.ts');
const {outputSourceTransition}=await import('../worker/output-source-transition.ts');
const {runDocumentJob}=await import('../worker/document-jobs-api.ts');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

const heartbeat=f=>f.control.withSourceTransition(()=>f.control.guardedEnvironment.DB.prepare(
 "UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?")
 .bind(f.job.lease_expires_at,new Date().toISOString(),f.job.job_id,f.job.owner_id,f.job.correlation_id).run());
const ownAppend=f=>f.control.withSourceTransition(async()=>{
 const head=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(f.job.stream_id).n;
 const event=makeEvent(f.job.stream_id,head+1,'worker:test','fixture',f.job.correlation_id,'DocumentRenderRequested',
  {document_id:f.job.document_id,artifact_kind:'scene'});
 await appendEvents(f.control.guardedEnvironment,[event],{initialHead:head,retries:1,
  prepareSidecars:f.control.eventWriteSidecars,onSidecarsCommitted:f.control.eventWriteCommitted});
 await f.control.refreshScene();
});

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

test('Scene heartbeat waits for complete own append and refreshed successor, twice',async t=>{
 const f=await execution(t);assert.ok(f.control.withSourceTransition);
 for(let i=0;i<2;i++){
  const entered=deferred(),release=deferred();let heartbeatWrites=0,completed=false;
  f.beforeBatch=async statements=>{
   if(statements[0]?.sql.includes('WITH source AS NOT MATERIALIZED')&&statements[0].sql.includes('COUNT(*) AS count')){
    entered.resolve();await release.promise;
   }
   if(statements.some(q=>q.sql.startsWith('UPDATE document_jobs SET lease_expires_at=')))heartbeatWrites++;
  };
  const append=ownAppend(f);await entered.promise;
  const renewal=heartbeat(f).then(value=>{completed=true;return value;});
  await new Promise(setImmediate);assert.equal(completed,false);assert.equal(heartbeatWrites,0);
  release.resolve();await append;assert.equal((await renewal).meta.changes,1);assert.equal(heartbeatWrites,1);
  assert.equal(f.sqlite.prepare('SELECT lease_expires_at FROM document_jobs').get().lease_expires_at,f.job.lease_expires_at);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});

test('Scene heartbeat acquired before own append finishes before successor change',async t=>{
 const f=await execution(t),entered=deferred(),release=deferred();let appendStarted=false;
 f.beforeBatch=async statements=>{
  if(statements.some(q=>q.sql.startsWith('UPDATE document_jobs SET lease_expires_at='))){entered.resolve();await release.promise;}
  if(statements.some(q=>q.sql.includes('INSERT INTO event_write_stage')))appendStarted=true;
 };
 const renewal=heartbeat(f);await entered.promise;const append=ownAppend(f);
 await new Promise(setImmediate);assert.equal(appendStarted,false);release.resolve();
 assert.equal((await renewal).meta.changes,1);await append;
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});

for(const fault of ['refresh-error','epoch','private-body','grant-expiry','lease-expiry'])
test('Scene source transition fails closed and releases queued heartbeat: '+fault,async t=>{
 const f=await execution(t),entered=deferred(),release=deferred();let heartbeatWrites=0;
 f.beforeBatch=async statements=>{
  if(statements[0]?.sql.includes('WITH source AS NOT MATERIALIZED')&&statements[0].sql.includes('COUNT(*) AS count')){
   entered.resolve();await release.promise;if(fault==='refresh-error')throw Error('injected refresh failure');
  }
  if(statements.some(q=>q.sql.startsWith('UPDATE document_jobs SET lease_expires_at=')))heartbeatWrites++;
 };
 const append=ownAppend(f);const appendOutcome=append.then(()=>null,error=>error);await entered.promise;
 const renewal=heartbeat(f);const renewalOutcome=renewal.then(()=>null,error=>error);
 if(fault==='epoch')f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
 if(fault==='private-body')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
 if(fault==='grant-expiry')f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'").run();
 if(fault==='lease-expiry')f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
 release.resolve();const appendError=await appendOutcome,renewalError=await renewalOutcome;
 assert.ok(renewalError,'queued heartbeat rejects rather than extending stale permission');
 if(appendError){assert.equal(renewalError,appendError);assert.equal(heartbeatWrites,0);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});

test('failed Scene transition rejects all queued work without executing it',async()=>{
 const gate=outputSourceTransition(),entered=deferred(),release=deferred(),failure=Error('proof unavailable');let later=0;
 const first=gate(async()=>{entered.resolve();await release.promise;throw failure;});
 const firstCheck=assert.rejects(first,error=>error===failure);await entered.promise;
 const queued=gate(async()=>{later++;});const queuedCheck=assert.rejects(queued,error=>error===failure);
 release.resolve();await Promise.all([firstCheck,queuedCheck]);
 await assert.rejects(gate(async()=>{later++;}),error=>error===failure);assert.equal(later,0);
});

for(const rejectRefresh of [false,true])test('actual Scene runner heartbeat waits through successor refresh: reject='+rejectRefresh,async t=>{
 const f=await fixture(t);const authorized=await f.send('authorize',f.body);assert.equal(authorized.status,200);
 const authorization=await authorized.json();await f.send('run',{draftHash:f.plan.draftHash,grantId:authorization.original.grantId,explicitRun:true});
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 const now=Date.now();t.mock.timers.reset();t.mock.timers.enable({apis:['Date','setTimeout'],now});
 const entered=deferred(),release=deferred();let paused=false,renewals=0;
 const isHeartbeat=statements=>statements.some(q=>q.sql.startsWith('UPDATE document_jobs SET lease_expires_at='));
 f.beforeBatch=async statements=>{
  if(!paused&&statements[0]?.sql.includes('WITH source AS NOT MATERIALIZED')&&statements[0].sql.includes('COUNT(*) AS count')
    &&f.sqlite.prepare("SELECT 1 FROM events WHERE correlation_id=? AND type='DocumentRenderRequested'").get(row.job_id+':attempt:1')){
   paused=true;entered.resolve();await release.promise;if(rejectRefresh)throw Error('successor refresh unavailable');
  }
 };
 f.afterBatch=(result,statements)=>{
  if(isHeartbeat(statements)){
   renewals++;
   // End the synthetic exercise before dispatch, without a provider fake or
   // changing the runner's actual heartbeat / consent policy.
   f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
  }
  return result;
 };
 const running=runDocumentJob(f.env,auth.user,row.job_id);
 await entered.promise;t.mock.timers.tick(60000);
 for(let i=0;i<20;i++)await new Promise(setImmediate);
 assert.equal(renewals,0,'actual timer cannot write while successor refresh is incomplete');
 release.resolve();const outcome=await running;
 assert.equal(outcome.status,'failed');assert.equal(outcome.attempt_count,1);
 assert.equal(renewals,rejectRefresh?0:1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
});
