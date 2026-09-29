import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
import { png } from './output-asset-fixtures.mjs';
registerOutputSourceImports();
const { createNativeStudyHost }=await import('../evals/generation-reliability/native-host/host.mjs');
const { readStudyBody,HOST_LIMITS }=await import('../evals/generation-reliability/native-host/transport.mjs');
const { mockPlan,resealPlan,MOCK_RUNTIME }=await import('../evals/generation-reliability/bridge-fixtures/mock-host.mjs');
const { hash }=await import('../evals/generation-reliability/core.mjs');
const { reserveCostBudget,releaseCostBudget }=await import('../worker/pilot-policy.ts');
const { firstCompilerStudy }=await import('../evals/generation-reliability/first-compiler-study.mjs').then(m=>({firstCompilerStudy:m.firstCompilerStudy??Object.values(m)[0]}));

import { fixture } from './generation-study-fixture.mjs';

test('native disabled path has no authority, DB, key or transport work',async()=>{
 const env={DB:{prepare(){throw Error('DB read');}}};const host=createNativeStudyHost(env,{plan:mockPlan(),runtimeIdentity:MOCK_RUNTIME});
 assert.deepEqual(await host.execute(null,{}),{action:'disabled',newPurchases:0});
});
test('real D1 adapters atomically reserve and checkpoint paid identity before private custody; recover original only',async t=>{
 const f=await fixture(t);const r=await f.run();assert.equal(r.reason,'original_charge_unreconciled');assert.equal(f.calls.length,2);assert.equal(f.op().provider_request_id,'image-original');assert.equal(f.op().private_writes,7);
 assert.equal(f.op().measured_microusd,null);assert.equal((await f.host.recover(f.request(),f.args)).action,'retained_unsettled');
 await f.run();assert.equal(f.calls.length,2);f.charge();assert.equal((await f.host.reconcile(f.request(),f.args)).action,'completed');
 const used=f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user'").get().used_microusd;
 await f.host.reconcile(f.request(),f.args);assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user'").get().used_microusd,used);
 assert.equal((await f.run()).action,'reuse_completed');assert.equal(f.calls.length,2);
});
test('two independently constructed workers racing admission buy once',async t=>{
 const f=await fixture(t),other=createNativeStudyHost(f.env,{plan:f.plan,runtimeIdentity:MOCK_RUNTIME});
 const results=await Promise.allSettled([f.run(),other.execute(f.request(),f.args)]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.contentOutcome==='usable').length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/images/generations')).length,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,1);
});
test('failure inside native reservation batch rolls back H state and both native counters',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{if(stmts.some(s=>s.sql.includes('INSERT INTO generation_study_operations')))stmts.splice(stmts.length-1,0,f.DB.prepare("SELECT json('injected invalid')"));return batch(stmts);};
 await assert.rejects(f.run());assert.equal(f.op(),undefined);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,0);assert.equal(f.calls.length,0);
});
test('lost reservation acknowledgement retains canonical hold across fresh host; no fetch',async t=>{
 const f=await fixture(t),batch=f.DB.batch;let lose=true;f.DB.batch=async stmts=>{const r=await batch(stmts);if(lose&&stmts.some(s=>s.sql.includes('INSERT INTO generation_study_operations'))){lose=false;throw Error('lost ack');}return r;};
 await assert.rejects(f.run());assert.equal(f.op().status,'reserved');assert.equal((await f.run()).reason,'original_purchase_only');assert.equal(f.calls.length,0);
});
for(const mutation of ['expired-source','redacted-source','owner','permission','project-scope','schema'])test(`current native I/O rejects ${mutation}`,async t=>{
 const f=await fixture(t);
 if(mutation==='expired-source')f.sqlite.exec("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id='source'");
 if(mutation==='redacted-source')f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='source'");
 if(mutation==='owner')f.sqlite.exec("UPDATE private_content SET owner_id='other' WHERE content_id='source'");
 if(mutation==='permission')f.sqlite.exec("UPDATE users SET role='viewer'");
 if(mutation==='schema')f.sqlite.exec('DROP TRIGGER generation_study_external_cost');
 if(mutation==='project-scope')f.sqlite.exec("INSERT INTO project_resource_scopes VALUES('p','content','source','org','project','mock-owner','actor_private',NULL,'mock-owner','now');");
 await assert.rejects(f.run());assert.equal(f.calls.length,0);
});
test('authority change at the reservation commit is rechecked atomically',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{if(stmts.some(s=>s.sql.includes('INSERT INTO generation_study_operations')))f.sqlite.exec("UPDATE users SET role='viewer'");return batch(stmts);};
 await assert.rejects(f.run());assert.equal(f.op(),undefined);assert.equal(f.calls.length,0);
});
test('outside native reservation blocks H3; H3 unknown exposure blocks outside reservation and zero release',async t=>{
 const f=await fixture(t);
 const params={maximumMicrousd:1000,allowUserOverage:false,reservationId:'outside',operation:'ordinary-image'};
 await reserveCostBudget(f.env,'mock-owner',1000,params);await assert.rejects(f.run());assert.equal(f.calls.length,0);
 await releaseCostBudget(f.env,'mock-owner','outside');await f.run();
 await assert.rejects(reserveCostBudget(f.env,'mock-owner',1000,{...params,reservationId:'new-tab-manifest'}),/outstanding_exposure/);
 await assert.rejects(releaseCostBudget(f.env,'mock-owner',f.op().cost_reservation_id),/original_charge_required/);
});
test('direct lost response has one POST, durable intent, no polling or replacement',async t=>{
 const f=await fixture(t,{fetch:async url=>{if(url.endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});throw Error('private prompt must not be logged');}});
 await f.run();const calls=f.calls.length;await f.run();assert.equal((await f.host.recover(f.request(),f.args)).reason,'direct_images_retrieval_unavailable');assert.equal(f.calls.length,calls);assert.equal(f.op().reason,'stage_unconfirmed');
});
for(const invalid of ['duplicate','wrong-size','corrupt-png','missing-usage','status-503'])test(`bounded image receipt handles ${invalid} without retry`,async t=>{
 const f=await fixture(t,{fetch:async url=>{
  if(url.endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
  if(invalid==='duplicate')return new Response('{"data":[],"data":[]}',{headers:{'x-request-id':'image-original'}});
  if(invalid==='status-503')return Response.json({error:'unavailable'},{status:503,headers:{'x-request-id':'image-original'}});
  const bytes=png({width:invalid==='wrong-size'?1:1536,height:1024});if(invalid==='corrupt-png')bytes[30]^=1;
  return Response.json({data:[{b64_json:Buffer.from(bytes).toString('base64')}]},{headers:{'x-request-id':'image-original'}});
 }});await f.run();await f.run();assert.equal(f.calls.length,2);assert.equal(f.op().status,'hold');assert.equal(f.op().measured_microusd,null);
 if(invalid==='missing-usage'){assert.ok(f.op().artifact_ref);assert.equal(f.op().reason,'usage_missing');}
});
test('accounting receipt survives private storage failure',async t=>{
 const f=await fixture(t);f.env.MEDIA.put=async()=>{throw Error('storage unavailable');};await f.run();assert.ok(f.op().receipt_hash);assert.ok(f.op().usage_json);assert.equal(f.op().provider_request_id,'image-original');assert.equal(f.op().status,'hold');await f.run();assert.equal(f.calls.length,2);
});
test('conflicting original charge and unclamped overrun keep hold',async t=>{
 const f=await fixture(t);await f.run();f.charge({cost:1200000});const r=await f.host.reconcile(f.request(),f.args);assert.equal(r.action,'hold');assert.equal(r.measuredMicrousd,1200000);assert.equal(f.op().measured_microusd,1200000);
});
test('different original provider identity cannot settle',async t=>{const f=await fixture(t);await f.run();f.charge({requestId:'replacement'});assert.equal((await f.host.reconcile(f.request(),f.args)).reason,'receipt_conflict');assert.equal(f.op().measured_microusd,null);});
test('bounded reader rejects body size, invalid UTF8 and cancellation',async()=>{
 await assert.rejects(readStudyBody(new Response('12345'),new AbortController().signal,4),/bound/);
 await assert.rejects(readStudyBody(new Response(Uint8Array.of(255)),new AbortController().signal,4));
 await assert.rejects(readStudyBody(new Response('x'),AbortSignal.abort(),4));
});
test('public C/F2 current evidence stays unavailable and never gets promoted by host switch',async()=>{const plan=await firstCompilerStudy();assert.equal(plan.financial.available,false);assert.equal(plan.maximumCostMicrousd,null);assert.equal(plan.preparation.required,true);assert.equal(plan.candidate.evidenceClass,'new-current-synthetic-control');assert.equal(HOST_LIMITS.artifactBytes,16*1024*1024);});

test('stop after moderation resumes once without repeating the completed check',async t=>{
 const f=await fixture(t),batch=f.DB.batch;let stopped=false;
 f.DB.batch=async stmts=>{const r=await batch(stmts);if(!stopped&&stmts.some(s=>s.sql.includes('INSERT INTO generation_study_evidence')&&s.bindings[1]==='moderation-response')){stopped=true;f.sqlite.exec('UPDATE generation_study_grants SET stopped=1');}return r;};
 assert.equal((await f.run()).action,'paused');assert.equal(f.calls.length,1);
 await f.host.control(f.request(),{grantId:f.args.grantId,stopped:false});await f.run();assert.equal(f.calls.length,2);assert.equal(f.calls.filter(c=>c.url.endsWith('/moderations')).length,1);
});
test('dispatch-intent lost acknowledgement prevents even the first fetch and all resubmission',async t=>{
 const f=await fixture(t),batch=f.DB.batch;let fault=true;
 f.DB.batch=async stmts=>{const r=await batch(stmts);if(fault&&stmts.some(s=>s.sql.includes('INSERT INTO generation_study_stages'))){fault=false;throw Error('crash after intent before fetch');}return r;};
 await f.run();assert.equal(f.sqlite.prepare('SELECT status FROM generation_study_stages').get().status,'intent');
 const fresh=createNativeStudyHost({...f.env},{plan:f.plan,runtimeIdentity:MOCK_RUNTIME});await fresh.execute(f.request(),f.args);assert.equal(f.calls.length,0);
});
test('source redaction at request-custody commit prevents subsequent provider transmission',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{const r=await batch(stmts);if(stmts.some(s=>s.sql.includes('INSERT INTO generation_study_evidence')&&s.bindings[1]==='moderation-request'))f.sqlite.exec("UPDATE private_content SET redacted_at='revoked' WHERE content_id='source'");return r;};
 assert.equal((await f.run()).action,'hold');assert.equal(f.calls.length,0);
});
test('missing retained evidence blocks completed reuse without buying a replacement',async t=>{
 const f=await fixture(t);await f.run();f.charge();await f.host.reconcile(f.request(),f.args);
 f.sqlite.exec("UPDATE private_content SET content='tampered' WHERE content_id IN(SELECT content_ref FROM generation_study_evidence WHERE slot='moderation-response')");
 assert.equal((await f.run()).reason,'original_evidence_unavailable');assert.equal(f.calls.length,2);
});
test('unknown external failed job blocks dispatch even without a new bridge reservation',async t=>{
 const f=await fixture(t);f.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,expires_at,updated_at) VALUES('outside-job','mock-owner','creative:mock-owner','d','image','failed','still','outside',1,'{}',?,'now',?,'now')").run(JSON.stringify({providerSubmissions:{one:{status:'pending'}}}),f.expiry);
 await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
test('changing DB binding, request owner, runtime or C request identity cannot escape authority',async t=>{
 const f=await fixture(t);const altered=structuredClone(f.plan);altered.requests[altered.manifest.cells[0].id].image.body+=' ';
 const bad=createNativeStudyHost(f.env,{plan:altered,runtimeIdentity:MOCK_RUNTIME});await assert.rejects(bad.execute(f.request(),f.args),/identity_mismatch/);
 const runtime=createNativeStudyHost(f.env,{plan:f.plan,runtimeIdentity:{...MOCK_RUNTIME,adapterSha256:'0'.repeat(64)}});await assert.rejects(runtime.execute(f.request(),f.args),/runtime_changed/);
 const spoof=f.request();spoof.headers.set('oai-authenticated-user-id','new-owner');await assert.rejects(f.host.execute(spoof,f.args),/owner_denied/);
 f.env.DB={...f.DB};await assert.rejects(f.run(),/database_changed/);assert.equal(f.calls.length,0);
});
for(const text of ['{"results":[{"flagged":false,"categories":{}}],"results":[]}','{"results":[]}','{"results":[{"flagged":false,"categories":{"violence":true}}]}'])test('strict bounded unique moderation stops image dispatch: '+text.slice(-25),async t=>{
 const f=await fixture(t,{fetch:async()=>new Response(text)});await f.run();assert.equal(f.calls.length,1);assert.equal(f.op().status,'hold');
});
test('actual public F2 false/null is rejected even with retained mock grant bindings',async t=>{
 const f=await fixture(t),publicPlan=await firstCompilerStudy();
 const unqualified=resealPlan(f.plan,{financial:publicPlan.financial});
 f.sqlite.exec('DELETE FROM generation_study_grants');
 f.sqlite.prepare('INSERT INTO generation_study_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run(f.args.grantId,'mock-owner',unqualified.id,hash(MOCK_RUNTIME),'source','direction',unqualified.candidate.retainedInputs.sourceSha256,unqualified.candidate.retainedInputs.directionSha256,'OFFLINE-ONLY',2000000,20000,f.expiry,'authorized');
 await assert.rejects(createNativeStudyHost(f.env,{plan:unqualified,runtimeIdentity:MOCK_RUNTIME}).execute(f.request(),f.args),/financial_unavailable/);assert.equal(f.calls.length,0);
});
test('untrusted provider usage extensions stay out of accounting rows',async t=>{
 const f=await fixture(t,{fetch:async url=>url.endsWith('/moderations')?Response.json({results:[{flagged:false,categories:{}}]}):Response.json({data:[],usage:{input_tokens:1,output_tokens:2,total_tokens:3,private_prompt:'do not journal me'}},{headers:{'x-request-id':'image-original'}})});
 await f.run();assert.deepEqual(JSON.parse(f.op().usage_json),{input_tokens:1,output_tokens:2,total_tokens:3});assert.equal(f.op().usage_json.includes('journal'),false);
});
test('artifact read quota persists across host instances and consumes failed original reads',async t=>{
 const f=await fixture(t);await f.run();await f.host.recover(f.request(),f.args);await f.host.recover(f.request(),f.args);
 const fresh=createNativeStudyHost(f.env,{plan:f.plan,runtimeIdentity:MOCK_RUNTIME});await assert.rejects(fresh.recover(f.request(),f.args));assert.equal(f.op().artifact_reads,2);assert.equal(f.calls.length,2);
});
test('cleanup only after original expiry removes private copies and retains purchase/charge identity',async t=>{
 const f=await fixture(t);await f.run();await assert.rejects(f.host.cleanup(f.request(),{operationId:f.op().operation_id}),/not_due/);
 const future=Date.parse(f.op().expires_at)+1000,real=Date.now;Date.now=()=>future;
 f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?new Date(future).toISOString().slice(0,7):new Date(future).toISOString());
 try{const result=await f.host.cleanup(f.request(),{operationId:f.op().operation_id});assert.equal(result.accountingPreserved,true);}
 finally{Date.now=real;}
 assert.equal(f.op().cleanup_attempts,1);assert.ok(f.op().provider_request_id);assert.equal(f.media.size,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM private_content WHERE content_id IN(SELECT content_ref FROM generation_study_evidence)").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,1);assert.equal(f.calls.length,2);
});

test('verified incurred charges do not resolve unknown future infrastructure exposure',async t=>{
 const f=await fixture(t);await f.run();f.charge({residual:null});const result=await f.host.reconcile(f.request(),f.args);
 assert.equal(result.action,'hold');assert.equal(f.op().measured_microusd,650);
 assert.equal(f.op().reason,'original_custody_overrun_or_residual_exposure');
 await assert.rejects(reserveCostBudget(f.env,'mock-owner',1000,{maximumMicrousd:1000,allowUserOverage:false,reservationId:'another-route',operation:'ordinary-image'}),/outstanding_exposure/);
 assert.equal(f.calls.length,2);
});

test('older consequential unknown step blocks admission without native reservation rows',async t=>{
 const f=await fixture(t);
 f.sqlite.prepare("INSERT INTO consequential_executions(execution_id,actor_user_id,stream_id,project_id,document_id,operation,intent_hash,binding_hash,consent_ref,status,created_at,expires_at,updated_at) VALUES('older','mock-owner','creative:mock-owner','p','d','planner','ih','bh','private-ref','running','old',?,'old')").run(f.expiry);
 f.sqlite.exec("INSERT INTO consequential_execution_steps VALUES('older',0,'old-token','old-cost',100,100,'usage-unknown','old-original',NULL,NULL,'old')");
 await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
test('unacknowledged financial receipt never progresses to private image custody',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{
 const result=await batch(stmts);return stmts.some(s=>s.sql.includes('provider_request_id=COALESCE'))?result.map(r=>({...r,success:false})):result;
 };
 await f.run();assert.equal(f.calls.length,2);assert.equal(f.op().provider_request_id,'image-original');assert.equal(f.op().artifact_ref,null);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM generation_study_evidence WHERE slot='image-response'").get().n,0);
 assert.equal(f.op().status,'hold');
});
