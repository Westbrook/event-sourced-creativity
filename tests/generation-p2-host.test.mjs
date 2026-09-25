import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,packet} from './generation-p2-fixture.mjs';
import {validateExecutionPlan} from '../evals/generation-reliability/execution-plan.mjs';
import {validateSuppliedPlan,EVIDENCE_SLOTS} from '../evals/generation-reliability/p2/contract.mjs';
import {retainedStudyInputs} from '../evals/generation-reliability/native-host/authority.mjs';
import {hash} from '../evals/generation-reliability/core.mjs';

test('P2 default off dispatches nothing and v1 does not accept v2 envelope or custody',async t=>{
 const f=await fixture(t);f.env.FORMA_GENERATION_STUDY_ENABLED='0';
 assert.equal((await f.host.execute(f.request(),f.args())).action,'disabled');assert.equal(f.calls.length,0);
 assert.throws(()=>validateExecutionPlan(f.plan));assert.equal(validateSuppliedPlan(f.plan),true);
 await assert.rejects(retainedStudyInputs(f.request(),f.env,f.grantId,f.plan.id,{recovery:true}),/schema_unavailable/);
});
test('actual host pair: durable human pause, settled first purchase and funded lifecycle, exact six slots',async t=>{
 const f=await fixture(t);const first=await f.host.execute(f.request(),f.args());assert.equal(first.reason,'original_charge_unreconciled');assert.equal(f.calls.length,3);
 assert.equal(f.op().private_writes,9);assert.deepEqual(f.sqlite.prepare('SELECT slot FROM generation_study_evidence ORDER BY slot').all().map(x=>x.slot),[...EVIDENCE_SLOTS].sort());
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/pair_paused/);
 await f.observe();await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
 assert.equal((await f.settle()).action,'completed');
 assert.equal((await f.fresh().execute(f.request(),f.args('treatment'))).reason,'original_charge_unreconciled');assert.equal(f.calls.length,6);
 await f.settle('treatment');await f.fresh().execute(f.request(),f.args('treatment'));assert.equal(f.calls.length,6);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations WHERE operation='study-lifecycle-provision' AND status='active'").get().n,2);
 for(const [i,arm] of ['baseline','treatment'].entries())for(const [j,stage] of ['advisory','moderation','image'].entries())assert.equal(f.calls[i*3+j].body,f.plan.requests[arm][stage].body);
 assert.equal(hash(JSON.stringify(packet.suppliedSnapshot)),packet.input.bytesSha256);
});
for(const mutation of ['absent-review','revoked-review','wrong-kind','changed-source','redacted','principal','financial','wrong-review-binding','expired'])test('zero dispatch for '+mutation,async t=>{
 const f=await fixture(t,{noReview:mutation==='absent-review',noIntake:mutation==='absent-review'});

 if(mutation==='revoked-review')f.sqlite.exec("UPDATE generation_study_supplied_reviews SET status='revoked'");
 if(mutation==='wrong-kind')f.sqlite.exec("UPDATE private_content SET kind='provider-response' WHERE content_id='p2-direction'");
 if(mutation==='changed-source')f.sqlite.exec("UPDATE private_content SET content='changed' WHERE content_id='p2-source'");
 if(mutation==='redacted')f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='p2-source'");
 if(mutation==='principal')f.sqlite.exec("UPDATE users SET updated_at='changed' WHERE user_id='mock-owner'");
 if(mutation==='financial')f.sqlite.exec("UPDATE generation_study_financial_grants SET status='revoked'");
 if(mutation==='wrong-review-binding'){const req=f.request();req.headers.set('reviewed','true');req.headers.set('oai-authenticated-user-id','unauthorized');await assert.rejects(f.host.execute(req,{...f.args(),reviewed:true}));return;}
 if(mutation==='expired')f.sqlite.function('strftime',{varargs:true},()=> '2026-10-02T00:00:00.000Z');
 await assert.rejects(f.host.execute(f.request(),f.args()));assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);
});
for(const stage of ['advisory','moderation','image'])for(const failure of ['error','invalid','timeout',...(stage!=='image'?['flag']:[])])test(stage+' '+failure+' durably prevents second arm',async t=>{
 const f=await fixture(t,{fetch:async x=>{if(x.stage!==stage)return;if(failure==='timeout')throw Error('OFFLINE-timeout');if(failure==='error')return Response.json({error:{}},{status:503});if(failure==='invalid')return Response.json({});return Response.json({results:x.body.input.map(()=>({flagged:true,categories:{}}))});}});
 assert.equal((await f.host.execute(f.request(),f.args())).action,'hold');const count=f.calls.length;
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));await assert.rejects(f.fresh().execute(f.request(),f.args()));assert.equal(f.calls.length,count);
 assert.ok(f.sqlite.prepare('SELECT hard_stop FROM generation_study_supplied_reviews').get().hard_stop);
});
test('settlement alone never scripts a safety/fidelity judgment',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.settle();await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/pair_paused/);
 await assert.rejects(f.observe({safety:'unknown'}),/observation_invalid/);await assert.rejects(f.observe({fidelity:'unexpected-failure'}),/observation_invalid/);assert.equal(f.calls.length,3);
});
for(const stop of ['unsafe','explicit'])test(stop+' is terminal after original settlement',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.observe(stop==='unsafe'?{safety:'unsafe'}:{resume:false});await f.settle();
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/pair_paused/);await assert.rejects(f.host.control(f.request(),{grantId:f.grantId,stopped:false}),/explicit_observation/);assert.equal(f.calls.length,3);
});
test('trusted intake never creates financial authority',async t=>{
 const f=await fixture(t,{noIntake:true});f.sqlite.exec("UPDATE generation_study_financial_grants SET status='revoked'");await assert.rejects(f.intake(),/financial/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,0);
});
test('evidence redaction blocks recovery and next arm while source-free finance survives',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.observe();await f.settle();
 f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id IN(SELECT content_ref FROM generation_study_evidence WHERE slot='advisory-response')");
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/evidence_unavailable/);assert.equal((await f.fresh().recover(f.request(),f.args())).reason,'original_evidence_unavailable');assert.equal(f.calls.length,3);
 assert.ok(f.sqlite.prepare('SELECT * FROM generation_study_charges').get());
});

test('OS process death after committed image intent never repeats a purchase',async t=>{
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'p2-crash-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const child=new URL('./generation-p2-process.mjs',import.meta.url);
 const first=spawnSync(process.execPath,['--import','tsx',child.pathname,'crash',root],{encoding:'utf8'});assert.equal(first.status,73,first.stderr);
 assert.equal(JSON.parse(readFileSync(root+'/calls.json')).length,2);
 const second=spawnSync(process.execPath,['--import','tsx',child.pathname,'restart',root],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);
 const r=JSON.parse(readFileSync(root+'/restart.json'));assert.equal(r.calls,0);assert.equal(r.operations,1);assert.equal(r.first.reason,'original_purchase_only');assert.match(r.second.error,/pair_paused/);assert.deepEqual(r.stages.find(s=>s.stage==='image'),{stage:'image',status:'intent'});
});
test('revocation at atomic reservation rolls back native reserves and operation',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO generation_study_operations')))f.sqlite.exec("UPDATE generation_study_supplied_reviews SET status='revoked'");return batch(statements);};
 await assert.rejects(f.host.execute(f.request(),f.args()));assert.equal(f.op(),undefined);assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,0);
});
test('object custody failure cannot become an eligible treatment even with settled original charges',async t=>{
 const f=await fixture(t);f.env.MEDIA.put=async()=>{throw Error('OFFLINE custody loss');};await f.host.execute(f.request(),f.args());assert.equal(f.op().reason,'stage_unconfirmed');assert.equal(f.op().receipt_hash.length,64);await f.settle();await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
});
test('expired copies are deleted once while financial holds survive without private source',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());const id=f.op().operation_id;
 Date.now=()=>Date.parse('2026-10-02T00:00:00.000Z');f.sqlite.function('strftime',{varargs:true},()=> '2026-10-02T00:00:00.000Z');
 assert.equal((await f.fresh().cleanup(f.request(),{operationId:id})).accountingPreserved,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,0);assert.equal(f.media.size,0);assert.equal(f.op().status,'hold');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations WHERE status='active'").get().n,2);
 await assert.rejects(f.fresh().cleanup(f.request(),{operationId:id}));assert.equal(f.calls.length,3);
});
test('concurrent reconstructed hosts cannot reserve or dispatch duplicate slots',async t=>{
 const f=await fixture(t);await Promise.allSettled([f.host.execute(f.request(),f.args()),f.fresh().execute(f.request(),f.args())]);
 assert.ok(f.calls.length<=3);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n,1);assert.ok(f.calls.filter(c=>c.stage==='image').length<=1);
});
test('advisory parser requires two positional results; exact parser remains one item',async t=>{
 const f=await fixture(t,{fetch:async x=>x.stage==='advisory'?Response.json({results:[{flagged:false,categories:{}}]}):undefined});
 await f.host.execute(f.request(),f.args());assert.equal(f.calls.length,1);assert.equal(f.op().reason,'stage_unconfirmed');
});
test('input revocation between moderation stages prevents image dispatch',async t=>{
 const f=await fixture(t,{fetch:async x=>{if(x.stage==='advisory')x.f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='p2-source'");}});
 await f.host.execute(f.request(),f.args());assert.equal(f.calls.length,1);assert.ok(f.sqlite.prepare('SELECT hard_stop FROM generation_study_supplied_reviews').get().hard_stop);
});

test('unreviewed fidelity finding cannot be promoted by an authenticated resume',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.settle();await assert.rejects(f.observe({finding:'invented protocol exception'}),/observation_invalid/);await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/pair_paused/);assert.equal(f.calls.length,3);
});
test('trusted intake is idempotent only for the exact private copies',async t=>{
 const f=await fixture(t);await f.intake();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,2);
 f.sqlite.exec("UPDATE private_content SET content='changed' WHERE content_id='p2-direction'");await assert.rejects(f.intake(),/existing_copy/);
});
test('server review must bind exact plan; client review flag cannot replace it',async t=>{
 const f=await fixture(t,{reviewBinding:'{}',noIntake:true});await assert.rejects(f.intake(),/review_unavailable/);await assert.rejects(f.host.execute(f.request(),{...f.args(),reviewed:true}),/review_unavailable/);assert.equal(f.calls.length,0);
});
test('actual ordinary compiler and I opening replacement match the immutable proposal',async()=>{
 const {buildCreativeImagePrompt}=await import('../worker/openai-adapter.ts');
 const {applyProfile}=await import('../docs/evidence/generation-p1/i-profile.mjs');
 const prompt=buildCreativeImagePrompt(packet.suppliedSnapshot,packet.direction.value,[],'prose',{quality:'high',size:'1536x1024',outputFormat:'png',partialImages:0,references:[],promptTechnique:'prose'});
 assert.equal(prompt,JSON.parse(packet.arms.find(r=>r.arm==='baseline'&&r.stage==='image').body).prompt);
 assert.equal(applyProfile(prompt,{enabled:true}),JSON.parse(packet.arms.find(r=>r.arm==='treatment'&&r.stage==='image').body).prompt);
});
test('financial uncertainty and lifecycle underfunding still block treatment after human resume',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.observe();f.charge();f.event('baseline',{provider_settled:0,remaining_uncertainty_microusd:null});
 assert.equal((await f.fresh().reconcile(f.request(),f.args())).action,'hold');await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
});
test('revocation and explicit stop are terminal across control and host reconstruction',async t=>{
 const f=await fixture(t);await f.host.control(f.request(),{grantId:f.grantId,stopped:true});await assert.rejects(f.fresh().execute(f.request(),f.args()));
 f.sqlite.exec("UPDATE generation_study_supplied_reviews SET status='revoked'");assert.throws(()=>f.sqlite.exec("UPDATE generation_study_supplied_reviews SET status='authorized'"),/immutable_review/);assert.equal(f.calls.length,0);
});
test('schema drift cannot weaken durable intent or create a seventh POST',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());assert.throws(()=>f.sqlite.exec("DELETE FROM generation_study_stages WHERE stage='advisory'"),/immutable_intent/);
 f.sqlite.exec('DROP TRIGGER generation_study_supplied_stage_no_delete');await assert.rejects(f.fresh().execute(f.request(),f.args()),/schema_unavailable/);assert.equal(f.calls.length,3);
});

for(const scope of ['project','Memory','non-admin'])test('supplied authority preserves '+scope+' exclusion',async t=>{
 const f=await fixture(t);
 if(scope==='project')f.sqlite.exec("INSERT INTO project_resource_scopes VALUES('p','content','p2-source','org','project','mock-owner','actor_private',NULL,'mock-owner','now')");
 if(scope==='non-admin')f.sqlite.exec("UPDATE users SET role='viewer'");
 if(scope==='Memory'){
  const columns=f.sqlite.prepare('PRAGMA table_info(memory_native_answer_origins)').all(),values=Object.fromEntries(columns.map(c=>[c.name,c.notnull?(c.type.toLowerCase()==='integer'?1:'synthetic'):null]));
  Object.assign(values,{origin_id:'p2-synthetic-origin',schema_version:1,recipe_version:'native-answer-origin-v1',status:'active',owner_user_id:'mock-owner',actor_user_id:'mock-owner',answer_content_id:'p2-source',selection_cursor:1,user_source_sequence:2,answer_source_sequence:3,created_at:'2020',answer_expires_at:'2098',source_retention_ceiling:'2099'});
  f.sqlite.prepare(`INSERT INTO memory_native_answer_origins(${columns.map(c=>c.name)}) VALUES(${columns.map(()=>'?')})`).run(...columns.map(c=>values[c.name]));
 }
 await assert.rejects(f.fresh().execute(f.request(),f.args()));assert.equal(f.calls.length,0);
});
test('same-database substitution cannot authorize intake or execution',async t=>{
 const f=await fixture(t);f.env.DB={...f.DB};await assert.rejects(f.host.execute(f.request(),f.args()),/database_changed/);assert.equal(f.calls.length,0);
});
test('new lifecycle uncertainty after completion prevents second arm',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.observe();await f.settle();f.event('baseline',{remaining_uncertainty_microusd:null});
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
});

test('optional v2 SQL refuses an existing v1 journal before any DDL',async t=>{
 const {fixture:v1}=await import('./generation-study-fixture.mjs');const {readFileSync}=await import('node:fs');
 const f=await v1(t),before=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='generation_study_stages'").get().sql;
 assert.throws(()=>f.sqlite.exec(readFileSync(new URL('../db/generation-study-supplied-v2.pending.sql',import.meta.url),'utf8')),/CHECK/);
 assert.equal(f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='generation_study_stages'").get().sql,before);assert.equal(f.calls.length,0);
});
test('immutable observation records the expected tether without asserting image quality',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.observe();
 const o=f.sqlite.prepare('SELECT * FROM generation_study_supplied_observations').get();assert.equal(o.finding,'baseline tether');assert.equal(o.fidelity,'expected-failure');assert.equal(o.resume,1);assert.equal(o.artifact_hash,f.op().artifact_hash);
 assert.throws(()=>f.sqlite.exec("UPDATE generation_study_supplied_observations SET safety='unsafe'"),/immutable_observation/);
});
