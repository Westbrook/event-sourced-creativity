import test from 'node:test';
import assert from 'node:assert/strict';
import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();test.after(()=>imports.deregister());
const {ensureSchema}=await import('../worker/runtime.ts');
const {POLICY_VERSION}=await import('../worker/policy-version.ts');
const {requireUser}=await import('../worker/pilot-policy.ts');
const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');
const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');
const {registeredExperience}=await import('../src/experiences/intake.ts');
const {outputDocumentExecutionBridge}=await import('../worker/output-document-execution.ts');
const {runDocumentJob}=await import('../worker/document-jobs-api.ts');

for(const mode of ['expired','live','expired-authority'])test('actual native Audio runner never creates a second execution claim: '+mode,async t=>{
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
 t.mock.method(globalThis,'fetch',()=>{throw Error('No provider calls in original-claim test');});
 t.mock.timers.enable({apis:['Date'],now:Date.now()});t.after(()=>t.mock.timers.reset());
 const clock=outputTestDatabase();t.after(()=>clock.sqlite.close());
 for(const name of ['strftime','julianday','datetime'])f.sqlite.function(name,{varargs:true},(...args)=>clock.sqlite.prepare(`SELECT ${name}(${args.map(()=>'?').join(',')}) AS value`).get(...args.map(v=>v==='now'?new Date().toISOString():v)).value);
 const owner='dev-local-creative',now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(owner,'fixture@invalid','Fixture',POLICY_VERSION,now,now,now);
 f.env.OPENAI_API_KEY='fixture-no-network';f.env.FAL_KEY='fixture-no-network';
 const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const release=await registeredExperience('audio');
 let response=await handleExperienceIntake(post('/api/experiences/drafts',{experienceId:'audio',intentId:'00000000-0000-4000-8000-000000000099',releaseHash:release.releaseHash,values:{direction:{value:'Original felt piano motif with a clean ending. No vocals.',provenance:'authored'},detail:{value:'20 seconds, instrumental.',provenance:'authored'}}}),f.env);
 assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();
 response=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);assert.equal(response.status,200,await response.clone().text());
 const path=`/api/experiences/drafts/${plan.draftId}/output`,execution={waitUntil(){throw Error('No background execution');}};
 const send=(action,body)=>handleExperienceOutput(post(path+'/'+action,body),f.env,execution,outputDocumentExecutionBridge);
 response=await send('prepare',{draftHash:plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(response.status,200,await response.clone().text());const ready=await response.json();
 response=await send('authorize',{draftHash:plan.draftHash,termsDigest:ready.preflight.termsDigest,maximumMicrousd:ready.preflight.maximumMicrousd,explicitAuthorization:true,audioCostConsent:{...ready.audioCostPreview,confirmed:true,providerTransferConfirmed:true}});
 assert.equal(response.status,200,await response.clone().text());
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.ok(row);
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 if(mode==='expired-authority')t.mock.timers.setTime(Date.parse(ready.audioCostPreview.expiresAt)+60000);
 const correlation=row.job_id+':attempt:1',lease=new Date(Date.now()+(mode==='live'?60000:-1000)).toISOString();
 // Synthetic interrupted original claim on genuinely admitted Audio. No paid
 // request is made or assumed successful by this fixture.
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=? WHERE job_id=?").run(correlation,lease,row.job_id);
 f.sqlite.prepare("UPDATE output_operation_slots SET status='running' WHERE job_id=?").run(row.job_id);
 const financial=['output_provider_calls','budget_reservations','cost_budget_reservations'];
 const before=financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all());
 for(let i=0;i<2;i++){
  const result=await runDocumentJob(f.env,auth.user,row.job_id);
  assert.equal(result.status,mode==='live'?'running':'failed');assert.equal(result.attempt_count,1);assert.equal(result.correlation_id,correlation);
 }
 assert.deepEqual(financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all()),before);
});
