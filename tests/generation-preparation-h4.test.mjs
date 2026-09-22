import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {createPreparationHost}=await import('../evals/generation-reliability/preparation/native-host.mjs');
const {capturePreparation,validatePreparation,financialScope,operationId,LIMITS,conditionalEstimate,validateDirection}=await import('../evals/generation-reliability/preparation/contract.mjs');
const {sealFinancialPolicy}=await import('../evals/generation-reliability/native-host/financial-policy.mjs');
const {reserveCostBudget,releaseCostBudget}=await import('../worker/pilot-policy.ts');
const {canonical,hash}=await import('../evals/generation-reliability/core.mjs');
const {generateCreativeDirection}=await import('../worker/openai-adapter.ts');
import {fixture,responseBody} from './generation-preparation-fixture.mjs';
const direction={title:'Botanist',rationale:'Preserve the brief.',scene:'An adult botanist. No logos.',palette:['green','white','brown'],next_moves:['Review identity','Review constraints']};
test('disabled preparation has zero authority, DB, key or transport work',async()=>{
 const env={DB:{prepare(){throw Error('read');}},get OPENAI_API_KEY(){throw Error('key');}};
 assert.deepEqual(await createPreparationHost(env,{plan:null}).execute(null),{action:'disabled',newPurchases:0});
});
test('one immutable request, finance before custody, three bounded private copies and original-only recovery',async t=>{
 const f=await fixture(t);const r=await f.run();assert.equal(r.contentOutcome,'usable');assert.equal(r.initiatedProviderCalls,1);assert.equal(r.newPurchases,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.body,f.plan.request.body);assert.equal(f.calls[0].init.redirect,'error');
 assert.equal(f.op().provider_request_id,'req_original');assert.equal(f.op().response_id,'resp_original');assert.deepEqual(JSON.parse(f.op().usage_json),{input_tokens:100,output_tokens:200,total_tokens:300});assert.equal(f.op().private_writes,3);
 assert.equal((await f.run()).reason,'original_purchase_only');assert.equal((await f.host.recover(f.request(),f.args)).contentOutcome,'usable');assert.equal(f.calls.length,1);
 assert.equal(f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_reservations').get().reserved_microusd,100000);
});
test('ordinary planner and disabled capture use byte-identical existing request contract',async t=>{
 const f=await fixture(t);await generateCreativeDirection(f.env,'mock-owner',JSON.parse(f.source.bytes),undefined,'en');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.body,f.plan.request.body);assert.deepEqual(Object.keys(JSON.parse(f.plan.request.body)),['model','instructions','input','text','reasoning','max_output_tokens','store','safety_identifier']);
});
test('concurrent fresh hosts reserve and dispatch at most once',async t=>{
 const f=await fixture(t),other=createPreparationHost(f.env,{plan:f.plan});
 await Promise.allSettled([f.run(),other.execute(f.request(),f.args)]);assert.equal(f.calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_preparation_operations').get().n,1);
});
for(const phase of ['reservation','source','request','intent','headers','receipt','response'])test(`lost acknowledgement after ${phase} never purchases a replacement`,async t=>{
 const f=await fixture(t);let injected=false;const batch=f.DB.batch,prepare=f.DB.prepare;
 const matches=s=>phase==='reservation'?s.sql.includes('INSERT INTO generation_preparation_operations'):phase==='intent'?s.sql.includes("SET status='intent'"):s.sql.includes('INSERT INTO generation_preparation_evidence')&&s.bindings[1]===phase;
 f.DB.batch=async statements=>{const result=await batch(statements);if(!injected&&statements.some(matches)){injected=true;throw Error('lost ack');}return result;};
 f.DB.prepare=function(sql){const s=prepare.call(this,sql);if(['headers','receipt'].includes(phase)&&(phase==='headers'?sql.includes('provider_request_id=COALESCE'):sql.includes("SET status='received'"))){const bind=s.bind;s.bind=(...args)=>{const bound=bind.call(s,...args),run=bound.run;bound.run=async()=>{const r=await run.call(bound);if(!injected){injected=true;throw Error('lost ack');}return r;};return bound;};}return s;};
 await f.run().catch(()=>{});assert.equal(injected,true);const before=f.calls.length;
 await createPreparationHost(f.env,{plan:f.plan}).execute(f.request(),f.args).catch(()=>{});assert.equal(f.calls.length,before);assert.ok(f.op());
 assert.equal(before,['headers','receipt','response'].includes(phase)?1:0);
 if(phase==='response')assert.ok(f.op().usage_json);
});
test('failed private response custody retains original identity and usage',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async s=>{if(s.some(x=>x.sql.includes('INSERT INTO generation_preparation_evidence')&&x.bindings[1]==='response'))throw Error('private bytes must not leak');return batch(s);};
 const r=await f.run();assert.equal(r.reason,'original_submission_or_custody_unconfirmed');assert.ok(f.op().receipt_hash);assert.ok(f.op().usage_json);assert.equal(f.op().private_writes,2);assert.equal((await f.host.recover(f.request(),f.args)).reason,'original_evidence_unavailable');assert.equal(f.calls.length,1);
});
for(const mutation of ['source-bytes','source-expired','source-redacted','source-owner','project-source','principal','schema','config','runtime','account-header','credential-binding','stop','grant-revoked'])test(`current ${mutation} denies dispatch`,async t=>{
 const f=await fixture(t);
 const sql={ 'source-bytes':"UPDATE private_content SET content='{}'",'source-expired':"UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z'",'source-redacted':"UPDATE private_content SET redacted_at='now'",'source-owner':"UPDATE private_content SET owner_id='other'",'project-source':"INSERT INTO project_resource_scopes VALUES('p','content','source','org','project','mock-owner','actor_private',NULL,'mock-owner','now')",principal:"UPDATE users SET role='viewer'",schema:'DROP TRIGGER generation_preparation_cost_hold',stop:'UPDATE generation_preparation_grants SET stopped=1','grant-revoked':"UPDATE generation_preparation_grants SET status='revoked'"};
 if(sql[mutation])f.sqlite.exec(sql[mutation]);
 if(mutation==='config')f.env.FORMA_PREPARATION_CONFIG={...f.config,model:'different'};
 if(mutation==='runtime')f.env.FORMA_PREPARATION_RUNTIME_HASH=hash('different');
 if(mutation==='account-header')f.env.OPENAI_PROJECT='other';
 if(mutation==='credential-binding')f.env.FORMA_PREPARATION_CREDENTIAL_BINDING='other';
 await f.run().catch(()=>{});assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
test('source access loss at custody boundary stops transmission while original reservation persists',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{const r=await batch(stmts);if(stmts.some(s=>s.sql.includes('INSERT INTO generation_preparation_evidence')&&s.bindings[1]==='request'))f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='source'");return r;};
 await f.run();assert.equal(f.calls.length,0);assert.equal(f.op().status,'hold');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
});
test('source mutation inside intent transaction is rejected atomically',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{if(stmts.some(s=>s.sql.includes("SET status='intent'")))f.sqlite.exec("UPDATE private_content SET content='{}' WHERE content_id='source'");return batch(stmts);};
 await f.run();assert.equal(f.calls.length,0);assert.equal(f.op().status,'hold');
});
for(const problem of ['refusal','incomplete','bad-schema','duplicate','missing-usage','extra-output','unknown-model','bad-utf8','oversize','http-error','timeout'])test(`bounded ${problem} result stops and holds without retry`,async t=>{
 const f=await fixture(t,{fetch:async()=>{const b=responseBody('gpt-5.6-terra');
 if(problem==='timeout')throw Error('private provider message');
 if(problem==='refusal')b.output[0].content=[{type:'refusal',refusal:'declined'}];
 if(problem==='incomplete')b.status='incomplete';
 if(problem==='bad-schema')b.output[0].content[0].text='{"scene":"missing fields"}';
 if(problem==='missing-usage')delete b.usage;
 if(problem==='extra-output')b.output.push({type:'function_call',name:'checker'});
 if(problem==='unknown-model')b.model='unreviewed-snapshot';
 if(problem==='duplicate')return new Response('{"output":[],"output":[]}',{headers:{'x-request-id':'req_original'}});
 if(problem==='bad-utf8')return new Response(Uint8Array.of(255),{headers:{'x-request-id':'req_original'}});
 if(problem==='oversize')return new Response('x'.repeat(LIMITS.responseBytes+1),{headers:{'x-request-id':'req_original'}});
 return Response.json(b,{status:problem==='http-error'?503:200,headers:{'x-request-id':'req_original'}});
 }});const result=await f.run();assert.equal(result.action,'hold');assert.notEqual(result.contentOutcome,'usable');await f.run();assert.equal(f.calls.length,1);assert.equal(f.op().status,'hold');
 if(!['timeout'].includes(problem))assert.equal(f.op().provider_request_id,'req_original');
});
test('new grant, plan, operation id and expired lease cannot bypass payer hold or erase original reservation',async t=>{
 const f=await fixture(t);await f.run();
 await assert.rejects(reserveCostBudget(f.env,'mock-owner',1,{maximumMicrousd:1,allowUserOverage:false,reservationId:'replacement',period:'2030-01',operation:'different'}),/outstanding_exposure/);
 await assert.rejects(releaseCostBudget(f.env,'mock-owner',f.op().cost_reservation_id),/original_charge_required/);
 assert.throws(()=>f.sqlite.prepare('DELETE FROM generation_preparation_operations').run(),/original_only/);
 assert.throws(()=>f.sqlite.prepare("UPDATE generation_preparation_operations SET status='reserved'").run(),/immutable_purchase/);
 assert.throws(()=>f.sqlite.prepare("UPDATE generation_preparation_grants SET expires_at='2030-01-01'").run(),/immutable_grant/);
 assert.equal(f.calls.length,1);
});
test('ordinary existing native hold prevents first planner purchase',async t=>{
 const f=await fixture(t);await reserveCostBudget(f.env,'mock-owner',1,{maximumMicrousd:1,allowUserOverage:false,reservationId:'outside',operation:'ordinary'});await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
test('recovery rejects changed private bytes and consumes durable bounded read slots',async t=>{
 const f=await fixture(t);await f.run();f.sqlite.exec("UPDATE private_content SET content='corrupt' WHERE content_id IN(SELECT content_ref FROM generation_preparation_evidence WHERE slot='response')");
 assert.equal((await f.host.recover(f.request(),f.args)).reason,'original_evidence_unavailable');await f.host.recover(f.request(),f.args);await assert.rejects(f.host.recover(f.request(),f.args));assert.equal(f.calls.length,1);assert.equal(f.op().original_reads,2);
});
test('request and source freeze reject incomplete provenance or silent config defaults',async t=>{
 const f=await fixture(t);for(const update of [{complete:false},{scope:'project'},{producer:''},{version:''}])assert.throws(()=>capturePreparation({source:{...f.source,...update},config:f.config,payerId:'mock-owner',runtimeHash:f.plan.runtimeHash}));
 for(const key of ['accountId','region','model','credentialBinding']){const config={...f.config};delete config[key];assert.throws(()=>capturePreparation({source:f.source,config,payerId:'mock-owner',runtimeHash:f.plan.runtimeHash}));}
 assert.throws(()=>validatePreparation(f.plan,f.source.bytes+' '),/mismatch/);assert.throws(()=>validateDirection(JSON.stringify({...direction,extra:'not allowed'})));
});
test('conditional estimate unavailable until exact input/config; cache-write, region and expiry explicit',async t=>{
 const f=await fixture(t);assert.equal(conditionalEstimate(null).actualRequestEstimateMicrousd,null);
 const rates={model:f.config.model,accountId:f.config.accountId,region:f.config.region,serviceTier:'standard',expiresAt:f.expiry,input:2,cacheWrite:2.5,output:12,regionalMultiplier:1,evidenceRef:'OFFLINE-ONLY'};
 const e=conditionalEstimate(f.plan,rates);assert.equal(e.actualRequestEstimateMicrousd,Math.ceil(2.5*(f.plan.request.byteLength+4096)+12*1200));assert.equal(e.maximumExposureMicrousd,null);assert.throws(()=>conditionalEstimate(f.plan,{...rates,accountId:'other'}));assert.throws(()=>conditionalEstimate(f.plan,{...rates,expiresAt:'2000-01-01'}));
});
test('disabled preparation is absent from runtime imports and reuses H3 external purchase inventory',()=>{
 const native=readFileSync(new URL('../evals/generation-reliability/native-host/host.mjs',import.meta.url),'utf8');const guard=readFileSync(new URL('../evals/generation-reliability/preparation/external-guard.mjs',import.meta.url),'utf8');assert.ok(native.includes("import {externalGuard, preparationGuards} from '../preparation/external-guard.mjs'"));assert.ok(guard.includes('output_provider_calls'));assert.ok(guard.includes('consequential_execution_steps'));
 for(const file of readdirSync(new URL('../worker/',import.meta.url)).filter(f=>f.endsWith('.ts')))assert.doesNotMatch(readFileSync(new URL('../worker/'+file,import.meta.url),'utf8'),/from\s+['"][^'"]*(?:generation-reliability\/preparation|preparation\/native-host)/);
 assert.ok(operationId({payerId:'p',source:{},request:{sha256:'x'},config:{},runtimeHash:'r'}).startsWith('h4-'));
});

test('actual active pilot participation rejects personal preparation without changing the principal role',async t=>{
 const f=await fixture(t),now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES('pilot','org','active','2020-01-01','2099-01-01','mock-owner',?,?)").run(now,now);
 f.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,status,invited_by_user_id,created_at) VALUES('participant','pilot','org','owner@example.test','mock-owner','active','mock-owner',?)").run(now);
 await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
test('Memory-derived marker excludes a retained source despite its ordinary private-content kind',async t=>{
 const f=await fixture(t);
 f.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES('memory-marker','creative:mock-owner',1,'now','now','user:mock-owner','offline','offline',1,'AssistantReasoned',?)").run(JSON.stringify({memory_origin_version:1,content_ref:'source'}));
 await assert.rejects(f.run());assert.equal(f.calls.length,0);
});
test('access loss after provider preserves finance before failing custody',async t=>{
 const f=await fixture(t,{fetch:async(_url,_init,db)=>{db.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='source'");return Response.json(responseBody('gpt-5.6-terra'),{headers:{'x-request-id':'req_original'}});}});
 await f.run();assert.equal(f.op().provider_request_id,'req_original');assert.ok(f.op().usage_json);assert.equal(f.op().private_writes,2);assert.equal(f.calls.length,1);await assert.rejects(f.host.recover(f.request(),f.args));
});
test('reservation failure rolls back all counters and state',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async stmts=>{if(stmts.some(s=>s.sql.includes('INSERT INTO generation_preparation_operations')))stmts.push(f.DB.prepare("SELECT json('invalid')"));return batch(stmts);};
 await assert.rejects(f.run());assert.equal(f.op(),undefined);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,0);assert.equal(f.calls.length,0);
});
test('fresh grant and materially changed request cannot escape original payer hold',async t=>{
 const f=await fixture(t);await f.run();
 const changed=capturePreparation({source:f.source,config:f.config,payerId:'mock-owner',runtimeHash:f.plan.runtimeHash,locale:'fr'}),policy=sealFinancialPolicy({...Object.fromEntries(Object.entries(f.policy).filter(([k])=>k!=='id')),scope:financialScope(changed)});
 f.sqlite.prepare('INSERT INTO generation_preparation_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run('new-grant','mock-owner',changed.id,'source',changed.source.sha256,canonical(changed.source),canonical(changed.config),changed.runtimeHash,canonical(policy),40000,'OFFLINE-ONLY',f.expiry,'authorized');
 assert.notEqual(operationId(changed),operationId(f.plan));await assert.rejects(createPreparationHost(f.env,{plan:changed}).execute(f.request(),{grantId:'new-grant'}));assert.equal(f.calls.length,1);
});

test('stop arriving after durable intent prevents provider dispatch and cannot reset the intent',async t=>{
 const f=await fixture(t),batch=f.DB.batch;let stopped=false;
 f.DB.batch=async stmts=>{const r=await batch(stmts);if(!stopped&&stmts.some(s=>s.sql.includes("SET status='intent'"))){stopped=true;f.sqlite.exec('UPDATE generation_preparation_grants SET stopped=1');}return r;};
 assert.equal((await f.run()).reason,'stopped_after_intent');assert.equal(f.calls.length,0);f.sqlite.exec('UPDATE generation_preparation_grants SET stopped=0');assert.equal((await f.run()).reason,'original_purchase_only');assert.equal(f.calls.length,0);
});
test('cleanup is original-copy-only, once, and preserves financial rows after expiry',async t=>{
 const f=await fixture(t);await f.run();const op=f.op(),originalNow=Date.now;
 // Move only the clock and expiry of our copies; immutable operation expiry stays untouched.
 f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id IN(SELECT content_ref FROM generation_preparation_evidence)").run();
 Date.now=()=>Date.parse(op.expires_at)+1;t.after(()=>{Date.now=originalNow;});
 const r=await f.host.cleanup(f.request(),{operationId:op.operation_id});assert.equal(r.financialIdentityPreserved,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,2);assert.equal(f.op().cleanup_attempts,1);
 await assert.rejects(f.host.cleanup(f.request(),{operationId:op.operation_id}));assert.equal(f.calls.length,1);
});
test('database rebinding or same-model override provenance mismatch stops before purchase',async t=>{
 const f=await fixture(t);f.env.OPENAI_MODEL=f.config.model;await assert.rejects(f.run(),/effective_config_changed/);delete f.env.OPENAI_MODEL;f.env.DB={...f.DB};await assert.rejects(f.run(),/database_changed/);assert.equal(f.calls.length,0);
});
