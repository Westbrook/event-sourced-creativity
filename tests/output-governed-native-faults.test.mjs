import assert from 'node:assert/strict';
import test from 'node:test';
import {sameOwnerPublishedFixture} from './output-published-package-fixture.mjs';
import {saveDeck,meter,deckWithActiveReference,handleDocumentJobs,outputFor,flushExecution,appendAuditEvent,handleEvents} from './output-native-journey-test-helpers.mjs';

async function preflight(f,plan,extra={}){const response=await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId],...extra}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.ok(body.command.preflight.targets[0].available,JSON.stringify(body.command.preflight.targets[0]));return body.command.preflight;}
async function authorize(f,terms){const response=await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.command.grantId;}
async function start(f,grantId){await f.ok(await f.send({action:'run',grantId}));return f.sqlite.prepare('SELECT job_id FROM output_operation_slots WHERE grant_id=?').get(grantId).job_id;}
const run=(f,jobId)=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/run`,{method:'POST',headers:f.headers}),f.env,`${jobId}/run`);
function note(f,m,label,other={}){console.log(JSON.stringify({label,...other,d1:m.metrics.d1,r2:m.metrics.r2,network:m.metrics.provider,total:m.metrics.d1+m.metrics.r2+m.metrics.provider,sourceCursor:f.sourceCursor()}));assert.ok(m.metrics.d1+m.metrics.r2+m.metrics.provider<=50);}

for(const change of['origin rights change','unknown owner operation'])test(`same-owner continuation cannot authorize after ${change}`,async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw new Error('source refusal must not contact providers');});
 const f=await sameOwnerPublishedFixture();t.after(()=>f.close());const plan=await saveDeck(f),terms=await preflight(f,plan);
 if(change==='origin rights change')await appendAuditEvent(f.env,'creative:dev-local-creative','user:dev-local-creative','BlockPropertyEdited',{project_id:f.sourceProject,document_id:f.sourceDocument,block_id:f.sourceBlock,property_path:'rights_revoked',old_value:false,new_value:true});
 else await appendAuditEvent(f.env,'creative:dev-local-creative','user:dev-local-creative','UnknownGovernedSourceOperation',{project_id:f.targetProject,document_id:f.documentId});
 // Only a normal current-target history load; never refresh the licensed origin.
 const history=await handleEvents(new Request('http://localhost/api/events',{headers:f.headers}),f.env);assert.ok([200,409,403].includes(history.status));
 const m=meter(f),response=await m.profile(`deny ${change}`,()=>f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true})),body=await response.json();note(f,m,'unrelated-tail negative',{change,status:response.status,error:body.error});
 assert.ok([403,409].includes(response.status),JSON.stringify(body));assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);assert.deepEqual(f.sourceCursor(),f.initialSourceCursor);
});

test('same-owner source private erasure after a known provider response blocks publication and retains its charge',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('no provider before authorization');});const f=await sameOwnerPublishedFixture();t.after(()=>f.close());const plan=await saveDeck(f),terms=await preflight(f,plan),grant=await authorize(f,terms),jobId=await start(f,grant),m=meter(f);
 const privateId=f.sqlite.prepare("SELECT event.event_id FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='RightsAsserted' AND body.document_id=?").get(f.sourceDocument).event_id;
 let calls=0;t.mock.method(globalThis,'fetch',async(url,request)=>{m.metrics.provider++;calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');const output=deckWithActiveReference(request);f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(privateId);return Response.json({id:'known-receipt-with-erased-source',model:'gpt-5.6-terra',output_text:JSON.stringify(output),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const response=await m.profile('known response / original private evidence erased',()=>run(f,jobId)),body=await response.json();const job=f.sqlite.prepare('SELECT status,error_message FROM document_jobs').get(),cost=f.sqlite.prepare('SELECT used_microusd,status FROM cost_budget_reservations').get();note(f,m,'paid source erasure',{status:response.status,job,cost});
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(job.status,'failed');assert.equal(calls,1);assert.equal(cost.status,'settled');assert.ok(cost.used_microusd>0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_assets').get().n,0);assert.deepEqual(f.sourceCursor(),f.initialSourceCursor);
 const replay=await run(f,jobId);assert.equal(replay.status,200);assert.equal(calls,1,'terminal replay cannot repurchase an erased source');
});

for(const sameProject of[false,true])test(`same-owner failed publication permits an explicitly authorized retry without origin refresh, sameProject=${sameProject}`,async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('no provider before authorization');});const f=await sameOwnerPublishedFixture({sameProject});t.after(()=>f.close());const plan=await saveDeck(f),terms=await preflight(f,plan),grant=await authorize(f,terms),jobId=await start(f,grant),m=meter(f);
 let calls=0,inject=true;const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{if(inject&&statements.some(statement=>statement.sql.includes('INSERT INTO event_write_stage')&&statement.bindings.includes('DocumentRenderCompleted'))){inject=false;throw new Error('known_paid_publication_failure');}return batch(statements);};
 t.mock.method(globalThis,'fetch',async(url,request)=>{m.metrics.provider++;calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');return Response.json({id:`retry-response-${calls}`,model:'gpt-5.6-terra',output_text:JSON.stringify(deckWithActiveReference(request)),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const failed=await m.profile('failed before artifact publication',()=>run(f,jobId));assert.equal(failed.status,200);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(jobId).status,'failed');assert.equal(calls,1);assert.equal(inject,false);note(f,m,'failed publication before explicit retry');f.checkSource();
 const currentResponse=await m.profile('read after failed publication',()=>f.request()),current=await currentResponse.json();note(f,m,'failed publication source recapture',{sameProject,sourceVerification:current.sourceVerification});assert.equal(currentResponse.status,200);assert.equal(current.sourceVerification.status,'verified',JSON.stringify(current.sourceVerification));f.checkSource();
 const previousSlot=f.sqlite.prepare('SELECT slot_id FROM output_operation_slots WHERE job_id=?').get(jobId).slot_id;
 const retryTerms=await preflight(f,plan,{alternativeOfSlotId:previousSlot});assert.equal(calls,1);const retryGrant=await authorize(f,retryTerms);assert.notEqual(retryGrant,grant);const retryJob=await start(f,retryGrant);assert.notEqual(retryJob,jobId);assert.equal(calls,1,'explicit authorization still never invokes a provider');
 const completed=await m.profile('separately authorized retry after publication failure',()=>run(f,retryJob));assert.equal(completed.status,200);note(f,m,'same-owner explicit retry');assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(retryJob).status,'completed');assert.equal(calls,2);f.checkSource();
 const slots=f.sqlite.prepare('SELECT attempt_ordinal,previous_slot_id,status FROM output_operation_slots ORDER BY attempt_ordinal').all();assert.deepEqual(slots.map(slot=>slot.attempt_ordinal),[0,1]);assert.ok(slots[1].previous_slot_id);assert.deepEqual(slots.map(slot=>slot.status),['failed','succeeded']);
 const costs=f.sqlite.prepare('SELECT used_microusd,status FROM cost_budget_reservations').all();assert.ok(costs.every(cost=>cost.status==='settled'&&cost.used_microusd>0));
});

for(const sameProject of[false,true])for(const publicationFailure of[false,true])test(`published/adopted same-owner slow repair has bounded renewals and source continuity: sameProject=${sameProject}, publicationFailure=${publicationFailure}`,async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('no provider before authorization');});const f=await sameOwnerPublishedFixture({sameProject});t.after(()=>f.close());const plan=await saveDeck(f),terms=await preflight(f,plan),grant=await authorize(f,terms),jobId=await start(f,grant),m=meter(f);
 let injected=false;const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{if(publicationFailure&&!injected&&statements.some(statement=>statement.sql.includes('INSERT INTO event_write_stage')&&statement.bindings.includes('DocumentRenderCompleted'))){injected=true;throw new Error('same_owner_slow_repair_publication_failure');}return batch(statements);};
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let calls=0,monotonic=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});t.mock.method(performance,'now',()=>monotonic);
 t.mock.method(globalThis,'fetch',async(url,request)=>{m.metrics.provider++;calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');if(calls===2){entered.resolve();await release.promise;}const output=calls===1?{...outputFor(),items:[]}:deckWithActiveReference(request);return Response.json({id:`slow-same-owner-${calls}`,model:'gpt-5.6-terra',output_text:JSON.stringify(output),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 let execution;try{
  execution=m.profile('uninterrupted same-owner slow repair',()=>run(f,jobId));const first=await Promise.race([entered.promise.then(()=>null),execution]);assert.equal(first,null,first?await first.clone().text():'repair reached');
  for(let i=0;i<3;i++){monotonic+=60000;t.mock.timers.tick(60000);await flushExecution();}release.resolve();const response=await execution;assert.equal(response.status,200,await response.clone().text());note(f,m,'same-owner slow repair three renewals',{sameProject,publicationFailure});
  assert.equal(calls,2);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(jobId).status,publicationFailure?'failed':'completed');assert.equal(injected,publicationFailure);f.checkSource();
  const cost=f.sqlite.prepare('SELECT used_microusd,status FROM cost_budget_reservations').get();assert.equal(cost.status,'settled');assert.ok(cost.used_microusd>0);
 }finally{release.resolve();t.mock.timers.reset();if(execution)await execution.catch(()=>{});await flushExecution();}
 const current=await f.ok(await f.request());assert.equal(current.sourceVerification.status,'verified',JSON.stringify(current.sourceVerification));f.checkSource();
});

test('same-owner unknown provider exposure remains held and blocks an alternative without hiding the valid source',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('no provider before authorization');});const f=await sameOwnerPublishedFixture();t.after(()=>f.close());const plan=await saveDeck(f),terms=await preflight(f,plan),grant=await authorize(f,terms),jobId=await start(f,grant),m=meter(f);
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{m.metrics.provider++;calls++;throw new Error('provider response lost after submission');});
 const response=await m.profile('same-owner unknown provider outcome',()=>run(f,jobId));assert.equal(response.status,200,await response.clone().text());const call=f.sqlite.prepare('SELECT status,used_microusd FROM output_provider_calls').get(),cost=f.sqlite.prepare('SELECT status,reserved_microusd FROM cost_budget_reservations').get();note(f,m,'same-owner exposure held',{call,cost});
 assert.equal(calls,1);assert.ok(['pending','uncertain'].includes(call.status));assert.equal(call.used_microusd,null);assert.notEqual(cost.status,'settled');assert.ok(cost.reserved_microusd>0);f.checkSource();
 const current=await f.ok(await f.request());assert.equal(current.sourceVerification.status,'verified',JSON.stringify(current.sourceVerification));
 const slotId=f.sqlite.prepare('SELECT slot_id FROM output_operation_slots WHERE job_id=?').get(jobId).slot_id;
 const denied=await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId],alternativeOfSlotId:slotId});assert.equal(denied.status,409);assert.equal(calls,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
 const cancel=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/cancel`,{method:'POST',headers:f.headers}),f.env,`${jobId}/cancel`);assert.equal(cancel.status,409);
 assert.equal((await run(f,jobId)).status,200);assert.equal(calls,1);assert.notEqual(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled');f.checkSource();
});
