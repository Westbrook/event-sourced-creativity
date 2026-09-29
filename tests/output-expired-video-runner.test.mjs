import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();test.after(()=>imports.deregister());
const runtime=await import('../worker/runtime.ts');
const {POLICY_VERSION}=await import('../worker/policy-version.ts');
const {requireUser}=await import('../worker/pilot-policy.ts');
const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');
const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');
const {registeredExperience}=await import('../src/experiences/intake.ts');
const {outputDocumentExecutionBridge}=await import('../worker/output-document-execution.ts');
const {runDocumentJob}=await import('../worker/document-jobs-api.ts');

for(const mode of ['expired','live','expired-authority','completed-event','failed-event','pending-planner','lease-race','protocol-mismatch'])test('actual native Video original claim reconciliation: '+mode,async t=>{
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());await runtime.ensureSchema(f.env);
 t.mock.method(globalThis,'fetch',()=>{throw Error('No provider calls in original-claim test');});
 t.mock.timers.enable({apis:['Date'],now:Date.now()});t.after(()=>t.mock.timers.reset());
 const clock=outputTestDatabase();t.after(()=>clock.sqlite.close());
 for(const name of ['strftime','julianday','datetime'])f.sqlite.function(name,{varargs:true},(...args)=>clock.sqlite.prepare(`SELECT ${name}(${args.map(()=>'?').join(',')}) AS value`).get(...args.map(v=>v==='now'?new Date().toISOString():v)).value);
 const owner='dev-local-creative',stream=`creative:${owner}`,now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(owner,'fixture@invalid','Fixture',POLICY_VERSION,now,now,now);
 f.env.OPENAI_API_KEY='fixture-no-network';f.env.FAL_KEY='fixture-no-network';
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
 const sha=createHash('sha256').update(bytes).digest('hex'),key=`u-${Buffer.from(owner).toString('hex')}/still.png`,url='/api/media/'+key;
 await f.env.MEDIA.put(key,bytes,{customMetadata:{ownerId:owner,sha256:sha},httpMetadata:{contentType:'image/png'}});
 const properties={reference_id:'reference',source_content_hash:sha,media_url:url,media_type:'image/png',pixel_reference_mode:'preserve_style',weight:1,rights_class:'owned'};
 const sourceEvents=[['ProjectCreated',{project_id:'source-project',name:'Source'}],['DocumentCreated',{project_id:'source-project',document_id:'source-document',title:'Source'}],['BlockCreated',{project_id:'source-project',document_id:'source-document',block_id:'source-block',scope:'document',type:'reference',handle:'reference/still',position:'a0',properties}],['ReferenceIngested',{reference_id:'reference',source_ref:url,content_hash:sha,rights_class:'owned'}],['RightsAsserted',{reference_id:'reference',rights_class:'owned'}]];
 await runtime.appendEvents(f.env,sourceEvents.map(([type,payload])=>runtime.makeEvent(stream,0,`user:${owner}`,'test','source',type,payload)));
 const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const release=await registeredExperience('video');
 let response=await handleExperienceIntake(post('/api/experiences/drafts',{experienceId:'video',intentId:'00000000-0000-4000-8000-000000000093',releaseHash:release.releaseHash,values:{motion:{value:'Slow camera push. Keep the teapot stationary.',provenance:'authored'},frame:{value:'landscape',provenance:'authored'}},reference:{version:1,sourceProjectId:'source-project',sourceDocumentId:'source-document',sourceBlockId:'source-block',referenceId:'reference',sha256:sha,permissionAttestation:'i-own-or-have-permission'}}),f.env);
 assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();
 response=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);assert.equal(response.status,200,await response.clone().text());
 const path=`/api/experiences/drafts/${plan.draftId}/output`,execution={waitUntil(){throw Error('No background execution');}};
 const send=(action,body)=>handleExperienceOutput(post(path+'/'+action,body),f.env,execution,outputDocumentExecutionBridge);
 response=await send('prepare',{draftHash:plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(response.status,200,await response.clone().text());const ready=await response.json();
 response=await send('authorize',{draftHash:plan.draftHash,termsDigest:ready.preflight.termsDigest,maximumMicrousd:ready.preflight.maximumMicrousd,explicitAuthorization:true});assert.equal(response.status,200,await response.clone().text());
 const row=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.ok(row);
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
 if(mode!=='live'&&mode!=='expired')t.mock.timers.setTime(Date.now()+3600000);
 const correlation=row.job_id+':attempt:1',lease=new Date(Date.now()+(mode==='live'?60000:-1000)).toISOString();
 const checkpoint=JSON.stringify({providerSubmissionProtocol:1,providerJobId:'original-accepted-fal',checkpoint:'preserve'});
 // Genuine unpaid admission, synthetic interrupted claim; no provider result
 // or successful live generation is claimed by this regression test.
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=?,result_json=? WHERE job_id=?").run(correlation,lease,checkpoint,row.job_id);
 f.sqlite.prepare("UPDATE output_operation_slots SET status='running' WHERE job_id=?").run(row.job_id);
 if(mode==='pending-planner'){
  // Synthetic accepted accounting claim on the genuine admitted route. No
  // provider request is sent, and pending is not treated as success or free.
  const route=f.sqlite.prepare("SELECT * FROM output_operation_routes WHERE stage_key='planning:0:initial'").get();assert.ok(route);
  f.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)")
   .run(route.scope_key,route.slot_id,'planning:0:initial','fixture-original-planner','a'.repeat(64),route.stage_key,route.provider,route.model,1000,now);
 }
 if(mode.endsWith('-event'))await runtime.appendEvents(f.env,[runtime.makeEvent(stream,0,`user:${owner}`,'test',correlation,mode==='completed-event'?'DocumentRenderCompleted':'DocumentRenderFailed',{document_id:plan.documentId,error_code:'retained_failure',error_message:'Original failure'})]);
 const financial=['output_provider_calls','budget_reservations','cost_budget_reservations'];
 const before=financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all());
 if(mode==='protocol-mismatch')f.sqlite.prepare('UPDATE document_jobs SET scene_source_protocol=1 WHERE job_id=?').run(row.job_id);
 let raced=false;
 if(mode==='lease-race'){
  const prepare=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{
   if(!raced&&sql.startsWith('UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?')){
    raced=true;f.sqlite.prepare('UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?').run(new Date(Date.now()+60000).toISOString(),row.job_id);
   }
   return prepare(sql);
  };
 }
 for(let i=0;i<2;i++){
  const result=await runDocumentJob(f.env,auth.user,row.job_id);
  assert.equal(result.status,['live','lease-race','protocol-mismatch'].includes(mode)?'running':mode==='completed-event'?'completed':'failed');assert.equal(result.attempt_count,1);assert.equal(result.correlation_id,correlation);
  assert.equal(JSON.parse(result.result_json).providerJobId,'original-accepted-fal');
  if(mode==='failed-event')assert.equal(result.error_message,'retained_failure');
 }
 assert.deepEqual(financial.map(table=>f.sqlite.prepare(`SELECT * FROM ${table}`).all()),before);
 if(mode==='lease-race')assert.equal(raced,true);
 if(mode==='pending-planner'){
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE job_id=?').get(row.job_id).status,'uncertain');
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'authorized');
 }
});
