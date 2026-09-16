import test from 'node:test';
import assert from 'node:assert/strict';
import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();test.after(()=>imports.deregister());
const runtime=await import('../worker/runtime.ts');
const {POLICY_VERSION}=await import('../worker/policy-version.ts');
const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');
const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');
const {registeredExperience,initialValues}=await import('../src/experiences/intake.ts');
const {outputDocumentExecutionBridge}=await import('../worker/output-document-execution.ts');
const {handleDocumentJobs}=await import('../worker/document-jobs-api.ts');

for(const mode of ['expired','live','expired-authority','completed-event','failed-event','pending-call','lease-race','checkpoint-race','protocol-mismatch','attempt-mismatch'])test('native 3D original reconciliation through existing run endpoint: '+mode,async t=>{
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());await runtime.ensureSchema(f.env);
 t.mock.method(globalThis,'fetch',()=>{throw Error('No provider requests during original reconciliation');});
 t.mock.timers.enable({apis:['Date'],now:Date.now()});t.after(()=>t.mock.timers.reset());
 const clock=outputTestDatabase();t.after(()=>clock.sqlite.close());
 for(const name of ['strftime','julianday','datetime'])f.sqlite.function(name,{varargs:true},(...args)=>clock.sqlite.prepare(`SELECT ${name}(${args.map(()=>'?').join(',')}) AS value`).get(...args.map(v=>v==='now'?new Date().toISOString():v)).value);
 const owner='dev-local-creative',stream=`creative:${owner}`,now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(owner,'fixture@invalid','Fixture',POLICY_VERSION,now,now,now);
 f.env.FAL_KEY='fixture-no-network';
 const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const release=await registeredExperience('model3d');
 let response=await handleExperienceIntake(post('/api/experiences/drafts',{experienceId:'model3d',intentId:'00000000-0000-4000-8000-000000000087',releaseHash:release.releaseHash,values:{...initialValues(release),subject:{value:'One ceramic teapot',provenance:'authored'},direction:{value:'Matte teal, static object.',provenance:'authored'}}}),f.env);
 assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();
 response=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);assert.equal(response.status,200,await response.clone().text());
 const path=`/api/experiences/drafts/${plan.draftId}/output`,execution={waitUntil(){throw Error('No background execution');}};
 const send=(action,body)=>handleExperienceOutput(post(path+'/'+action,body),f.env,execution,outputDocumentExecutionBridge);
 response=await send('prepare',{draftHash:plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(response.status,200,await response.clone().text());const ready=await response.json();
 response=await send('authorize',{draftHash:plan.draftHash,termsDigest:ready.preflight.termsDigest,maximumMicrousd:ready.preflight.maximumMicrousd,explicitAuthorization:true,model3dCostConsent:{...ready.model3dCostPreview,confirmed:true,providerTransferConfirmed:true}});assert.equal(response.status,200,await response.clone().text());
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.ok(row);
 if(mode!=='live'&&mode!=='expired')t.mock.timers.setTime(Date.now()+3600000);
 const correlation=row.job_id+':attempt:1',lease=new Date(Date.now()+(mode==='live'?60000:-1000)).toISOString();
 // Genuine unpaid admission, synthetic interrupted claim. This regression
 // makes no remote calls and is not live generation evidence.
 const checkpoint=JSON.stringify({providerSubmissionProtocol:1,providerJobId:'original-accepted-fal',model3dInputReceipt:{preserve:true}});
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=?,result_json=? WHERE job_id=?").run(correlation,lease,checkpoint,row.job_id);
 f.sqlite.prepare("UPDATE output_operation_slots SET status='running' WHERE job_id=?").run(row.job_id);
 if(mode==='pending-call'){
  const route=f.sqlite.prepare("SELECT * FROM output_operation_routes WHERE stage_key='model3d:initial'").get();assert.ok(route);
  f.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)").run(route.scope_key,route.slot_id,'model3d:initial','fixture-original-rodin','a'.repeat(64),route.stage_key,route.provider,route.model,400000,now);
 }
 if(mode.endsWith('-event'))await runtime.appendEvents(f.env,[runtime.makeEvent(stream,0,`user:${owner}`,'test',correlation,mode==='completed-event'?'DocumentRenderCompleted':'DocumentRenderFailed',{document_id:plan.documentId,error_code:'retained_failure',error_message:'Original failure'})]);
 const financial=['output_provider_calls','budget_reservations','cost_budget_reservations'];
 const before=financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all());
 if(mode==='protocol-mismatch')f.sqlite.prepare('UPDATE document_jobs SET scene_source_protocol=1 WHERE job_id=?').run(row.job_id);
 if(mode==='attempt-mismatch')f.sqlite.prepare('UPDATE document_jobs SET attempt_count=2 WHERE job_id=?').run(row.job_id);
 let raced=false;
 if(mode.endsWith('-race')){const prepare=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{
  if(!raced&&sql.startsWith('UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?')){raced=true;
   if(mode==='lease-race')f.sqlite.prepare('UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?').run(new Date(Date.now()+60000).toISOString(),row.job_id);
   else f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.concurrent',1) WHERE job_id=?").run(row.job_id);
  }return prepare(sql);
 };}
 const checked=await handleDocumentJobs(post(`/api/document-jobs/${row.job_id}/run`,{}),f.env,`${row.job_id}/run`,execution);
 assert.ok([200,202].includes(checked.status),await checked.clone().text());
 const result=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(row.job_id);
 assert.equal(result.status,['live','lease-race','checkpoint-race','protocol-mismatch','attempt-mismatch'].includes(mode)?'running':mode==='completed-event'?'completed':'failed');
 assert.equal(result.attempt_count,mode==='attempt-mismatch'?2:1);assert.equal(result.correlation_id,correlation);
 assert.equal(JSON.parse(result.result_json).providerJobId,'original-accepted-fal');
 assert.deepEqual(JSON.parse(result.result_json).model3dInputReceipt,{preserve:true});
 if(mode==='failed-event')assert.equal(result.error_message,'retained_failure');
 assert.deepEqual(financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all()),before);
 if(mode.endsWith('-race'))assert.equal(raced,true);
 if(mode==='pending-call')assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE job_id=?').get(row.job_id).status,'uncertain');
});
