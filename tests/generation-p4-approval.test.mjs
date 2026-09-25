import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fixture,createAuthoringStudyApproval,consentHash} from './generation-p4-fixture.mjs';
import {EVIDENCE_SLOTS} from '../evals/generation-reliability/p2/contract.mjs';
const noAuthority=f=>{assert.deepEqual(f.counts(),{authoring_study_commits:0,generation_study_grants:0,generation_study_supplied_reviews:0,generation_study_financial_grants:0,generation_study_operations:0,copies:0});assert.equal(f.calls.length,0);};
const denied=r=>assert.equal(r.status,'denied',JSON.stringify(r));
function memory(f,id){
 const columns=f.sqlite.prepare('PRAGMA table_info(memory_native_answer_origins)').all(),v=Object.fromEntries(columns.map(c=>[c.name,c.notnull?(c.type.toLowerCase()==='integer'?1:'synthetic'):null]));
 Object.assign(v,{origin_id:'p4-synthetic-origin',schema_version:1,recipe_version:'native-answer-origin-v1',status:'active',owner_user_id:'mock-owner',actor_user_id:'mock-owner',answer_content_id:id,selection_cursor:1,user_source_sequence:2,answer_source_sequence:3,created_at:'2020',answer_expires_at:'2098',source_retention_ceiling:'2099'});
 f.sqlite.prepare(`INSERT INTO memory_native_answer_origins(${columns.map(c=>c.name)}) VALUES(${columns.map(()=>'?')})`).run(...columns.map(c=>v[c.name]));
}
for(const mode of ['accepted-estimate','bounded-proof'])test(mode+' authenticated preview -> atomic receipt -> P2 original-only six-slot pair',async t=>{
 const f=await fixture(t,{mode}),r=await f.preview();assert.equal(r.committable,true);assert.equal(r.display.classification,'synthetic');
 assert.equal(r.display.sourceBytes,JSON.stringify(f.plan.packet.suppliedSnapshot));assert.equal(r.display.directionBytes,JSON.stringify(f.plan.packet.direction.value));assert.deepEqual(r.display.protocol,f.plan.packet.protocol);
 assert.equal(r.display.approvalInventory.privateEvidenceRecords,mode==='bounded-proof'?14:12);assert.equal(r.display.approvalInventory.materialCommitInserts,7);assert.equal(r.display.financialPolicies.length,2);assert.equal(r.display.evidence.length,2);assert.match(r.display.financialMeaning,/unknown maximum/);noAuthority(f);
 const c=await f.call(f.command(r));assert.equal(c.status,'committed',JSON.stringify(c));assert.equal(c.reused,false);assert.equal(c.receipt.newPurchases,0);assert.equal(f.calls.length,0);
 assert.deepEqual(f.counts(),{authoring_study_commits:1,generation_study_grants:1,generation_study_supplied_reviews:1,generation_study_financial_grants:2,generation_study_operations:0,copies:2});
 const rows=f.sqlite.prepare('SELECT kind,content FROM private_content WHERE content_id IN(?,?) ORDER BY kind').all(f.plan.candidate.suppliedInputs.sourceRef,f.plan.candidate.suppliedInputs.directionRef);assert.deepEqual(rows.map(x=>x.kind),['agent-authored-study-direction','supplied-study-source']);
 assert.equal((await f.fresh().execute(f.request(),f.args())).action,'disabled');assert.equal(f.calls.length,0);
 f.env.FORMA_GENERATION_STUDY_ENABLED='1';assert.equal((await f.fresh().execute(f.request(),f.args())).reason,'original_charge_unreconciled');assert.equal(f.calls.length,3);assert.equal(f.op().private_writes,9);
 assert.deepEqual(f.sqlite.prepare('SELECT slot FROM generation_study_evidence ORDER BY slot').all().map(x=>x.slot),[...EVIDENCE_SLOTS].sort());
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')),/pair_paused/);await f.observe();await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
 assert.equal((await f.settle()).action,'completed');await f.fresh().execute(f.request(),f.args('treatment'));assert.equal(f.calls.length,6);await f.settle('treatment');await f.fresh().recover(f.request(),f.args('treatment'));assert.equal(f.calls.length,6);
 for(const [i,arm] of ['baseline','treatment'].entries())for(const [j,stage] of ['advisory','moderation','image'].entries())assert.equal(f.calls[i*3+j].body,f.plan.requests[arm][stage].body);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM generation_study_evidence').get().n,18);
 assert.throws(()=>f.sqlite.exec('DELETE FROM generation_study_stages'),/immutable_intent/);
 assert.deepEqual((await f.call({action:'status',proposalId:f.proposal.proposalId})).receipt,c.receipt);
});
test('approval disabled and execution disabled each perform zero DB/provider operations',async t=>{
 const f=await fixture(t);delete f.env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED;f.env.DB=new Proxy({},{get(){throw Error('DB sentinel');}});
 for(const action of ['preview','commit','status'])assert.equal((await f.call({action,proposalId:f.proposal.proposalId})).status,'disabled');
 assert.equal((await f.fresh().execute(f.request(),f.args())).action,'disabled');assert.equal(f.calls.length,0);
});
for(const arm of ['baseline','treatment'])for(const kind of ['account','rate','liability','settlement','lifecycle','deletion'])test('actual-classified missing '+arm+' '+kind+' cannot commit',async t=>{
 const f=await fixture(t,{missing:arm+':'+kind,classification:'actual'}),r=await f.preview();assert.equal(r.committable,false);assert.equal(r.previewId,null);denied(await f.call(f.command(r)));noAuthority(f);
});
test('bounded proof requires the separate bound evidence',async t=>{const f=await fixture(t,{mode:'bounded-proof',missing:'treatment:bound'}),r=await f.preview();assert.equal(r.committable,false);denied(await f.call(f.command(r)));noAuthority(f);});
for(const change of ['extra-flag','raw-policy','digest','intent','preview','decision','no-preview','origin','identity','principal','expired','config-revoked','evidence-revoked','changed-evidence','evidence-project','evidence-memory','preview-project','preview-kind','preview-bytes','schema'])test('reject '+change+' with zero approvals',async t=>{
 const f=await fixture(t),r=await f.preview(),cmd=f.command(r);let headers={};
 if(change==='extra-flag')cmd.approved=true;if(change==='raw-policy')cmd.policy=r.display.financialPolicies[0];
 for(const [which,key] of [['digest','displayHash'],['intent','intentId'],['preview','previewId']])if(change===which)cmd[key]='0'.repeat(64);
 if(change==='decision')cmd.decision='APPROVE_STUDY_BOUNDED_PROOF';
 if(change==='no-preview')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(r.previewId);
 if(change==='origin')headers.origin='https://wrong.example.test';if(change==='identity')headers['oai-authenticated-user-id']='another';
 if(change==='principal')f.sqlite.exec("UPDATE users SET updated_at='changed'");
 if(change==='expired')f.sqlite.function('strftime',{varargs:true},()=> '2026-10-02T00:00:00.000Z');
 if(change==='config-revoked')f.sqlite.exec("UPDATE authoring_study_configurations SET status='revoked'");
 if(change==='evidence-revoked')f.sqlite.exec("UPDATE authoring_study_evidence SET status='revoked'");
 if(change==='changed-evidence')f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(f.records[0].ref.contentRef);
 if(change.endsWith('-project'))f.sqlite.prepare("INSERT INTO project_resource_scopes VALUES('p','content',?,'org','project','mock-owner','actor_private',NULL,'mock-owner','now')").run(change==='preview-project'?r.previewId:f.records[0].ref.contentRef);
 if(change==='evidence-memory')memory(f,f.records[0].ref.contentRef);
 if(change==='preview-kind')f.sqlite.prepare("UPDATE private_content SET kind='provider-response' WHERE content_id=?").run(r.previewId);
 if(change==='preview-bytes')f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(r.previewId);
 if(change==='schema')f.sqlite.exec('DROP TRIGGER authoring_study_commit_no_update');
 denied(await f.call(cmd,headers));noAuthority(f);
});
for(const change of ['source','direction','protocol','runtime','mode','bound'])test('server configuration drift '+change+' cannot reuse prior display',async t=>{
 const f=await fixture(t),r=await f.preview(),p=structuredClone(f.proposal);
 if(change==='source')p.plan.packet.suppliedSnapshot={changed:true};if(change==='direction')p.plan.packet.direction.value={changed:true};if(change==='protocol')p.plan.packet.protocol='changed';if(change==='runtime')p.runtimeIdentity.adapterSha256='0'.repeat(64);if(change==='mode')p.arms[0].mode='free';if(change==='bound')p.arms[0].mode='bounded-proof';
 const handle=createAuthoringStudyApproval({proposals:[p]});denied(await(await handle(f.approvalRequest(f.command(r)),f.env)).json());noAuthority(f);
});
for(const change of ['mode','scope','liability','rate','lifecycle','deletion','bound'])test('malformed trusted evidence '+change+' is not enough',async t=>{
 const f=await fixture(t,{mode:change==='bound'?'bounded-proof':'accepted-estimate',configure:async(p,records)=>{
  if(change==='mode')p.arms[0].mode='free';
  const kind={scope:'account',liability:'liability',rate:'rate',lifecycle:'lifecycle',deletion:'deletion',bound:'bound'}[change];
  const rec=records.find(x=>x.arm==='treatment'&&x.ref.kind===kind);if(!rec)return;
  if(change==='scope')rec.body.scopeHash='0'.repeat(64);if(change==='liability')rec.body.liabilityOwner='another';if(change==='rate')rec.body.estimateMicrousd=-1;if(change==='lifecycle')rec.body.maximumMicrousd=0;if(change==='deletion')rec.body.operatorId='';if(change==='bound')rec.body.maximumCostMicrousd=0;rec.ref.contentHash=await consentHash(rec.body);
 }});const r=await f.preview();assert.equal(r.committable,false);denied(await f.call(f.command(r)));noAuthority(f);
});
test('identical concurrent commit and lost acknowledgement return byte-equivalent original receipt',async t=>{
 const f=await fixture(t),r=await f.preview(),batch=f.DB.batch;let lost=false;
 f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO authoring_study_commits'))){lost=true;throw Error('SYNTHETIC lost commit acknowledgement');}return result;};
 const results=await Promise.all([f.call(f.command(r)),f.call(f.command(r))]);assert.ok(lost);for(const result of results)assert.equal(result.status,'committed',JSON.stringify(result));assert.deepEqual(results[0].receipt,results[1].receipt);assert.equal(f.counts().authoring_study_commits,1);assert.equal(f.counts().copies,2);
 assert.throws(()=>f.sqlite.exec("UPDATE authoring_study_commits SET intent_id='changed'"),/immutable/);assert.throws(()=>f.sqlite.exec('DELETE FROM authoring_study_commits'),/immutable/);
 f.sqlite.exec("UPDATE authoring_study_evidence SET status='revoked'");denied(await f.call(f.command(r)));assert.equal((await f.call({action:'status',proposalId:f.proposal.proposalId})).status,'unavailable');assert.equal(f.calls.length,0);
});
for(let boundary=0;boundary<7;boundary++)test('rollback after authority/copy write '+(boundary+1),async t=>{
 const f=await fixture(t),r=await f.preview(),batch=f.DB.batch;let injected=false;
 f.DB.batch=statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO authoring_study_commits'))){const writes=statements.map((s,i)=>({s,i})).filter(({s})=>/^INSERT INTO (?:generation_study_grants|generation_study_supplied_reviews|generation_study_financial_grants|private_content|authoring_study_commits)/.test(s.sql));assert.equal(writes.length,7);const mutated=[...statements];mutated.splice(writes[boundary].i+1,0,f.DB.prepare('INSERT INTO generation_study_assertions VALUES(0)'));injected=true;return batch(mutated);}return batch(statements);};
 denied(await f.call(f.command(r)));assert.equal(injected,true);noAuthority(f);
});
for(const change of ['principal','evidence','expiry','configuration'])test('final transaction rechecks '+change+' after preparation',async t=>{
 const f=await fixture(t),r=await f.preview(),batch=f.DB.batch;
 f.DB.batch=statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO authoring_study_commits'))){
  if(change==='principal')f.sqlite.exec("UPDATE users SET updated_at='changed'");if(change==='evidence')f.sqlite.exec("UPDATE authoring_study_evidence SET status='revoked'");if(change==='configuration')f.sqlite.exec("UPDATE authoring_study_configurations SET status='revoked'");if(change==='expiry')f.sqlite.function('strftime',{varargs:true},()=> '2026-10-02T00:00:00.000Z');
 }return batch(statements);};denied(await f.call(f.command(r)));noAuthority(f);
});
for(const change of ['configuration','evidence','source','direction-kind','financial','project','memory'])test('reconstructed host denies changed '+change+' before any POST',async t=>{
 const f=await fixture(t);assert.equal((await f.approve()).status,'committed');f.env.FORMA_GENERATION_STUDY_ENABLED='1';
 if(change==='configuration')f.sqlite.exec("UPDATE authoring_study_configurations SET status='revoked'");if(change==='evidence')f.sqlite.exec("UPDATE authoring_study_evidence SET status='revoked'");
 if(change==='source')f.sqlite.prepare("UPDATE private_content SET content='changed' WHERE content_id=?").run(f.plan.candidate.suppliedInputs.sourceRef);
 if(change==='direction-kind')f.sqlite.prepare("UPDATE private_content SET kind='provider-response' WHERE content_id=?").run(f.plan.candidate.suppliedInputs.directionRef);
 if(change==='financial')f.sqlite.exec("UPDATE generation_study_financial_grants SET status='revoked'");
 if(change==='project')f.sqlite.prepare("INSERT INTO project_resource_scopes VALUES('p','content',?,'org','project','mock-owner','actor_private',NULL,'mock-owner','now')").run(f.plan.candidate.suppliedInputs.sourceRef);
 if(change==='memory')memory(f,f.plan.candidate.suppliedInputs.sourceRef);
 await assert.rejects(f.fresh().execute(f.request(),f.args()));assert.equal(f.calls.length,0);
});
test('producer evidence revocation between provider stages prevents next POST',async t=>{
 const f=await fixture(t,{fetch:async x=>{if(x.stage==='advisory')x.f.sqlite.exec("UPDATE authoring_study_evidence SET status='revoked'");}});await f.approve();f.env.FORMA_GENERATION_STUDY_ENABLED='1';await f.fresh().execute(f.request(),f.args());assert.equal(f.calls.length,1);
});
test('private erasure preserves original immutable accounting and holds; finance contains only fixed text and opaque evidence refs',async t=>{
 const f=await fixture(t);await f.approve();f.env.FORMA_GENERATION_STUDY_ENABLED='1';await f.fresh().execute(f.request(),f.args());
 const finance=f.sqlite.prepare('SELECT * FROM generation_study_financial_grants ORDER BY operation_id').all(),receipt=f.sqlite.prepare('SELECT * FROM authoring_study_commits').get(),op=f.op();
 assert.ok(!JSON.stringify(finance).includes('SOURCE-CANARY'));assert.ok(!JSON.stringify(receipt).includes('SOURCE-CANARY'));
 assert.ok(!JSON.stringify(finance).includes(JSON.stringify(f.plan.packet.suppliedSnapshot)));assert.ok(f.sqlite.prepare("SELECT count(*) n FROM cost_budget_reservations WHERE status='active'").get().n>0);
 f.sqlite.exec('DELETE FROM private_content');assert.deepEqual(f.sqlite.prepare('SELECT * FROM generation_study_financial_grants ORDER BY operation_id').all(),finance);assert.deepEqual(f.sqlite.prepare('SELECT * FROM authoring_study_commits').get(),receipt);assert.equal(f.op().operation_id,op.operation_id);assert.equal(f.op().status,'hold');
 await assert.rejects(f.fresh().execute(f.request(),f.args('treatment')));assert.equal(f.calls.length,3);
});
test('ordinary document operation domain and event proof cannot write study grants',()=>{
 for(const path of ['worker/authoring-event-proof.ts','worker/authoring-event-batches.ts'])assert.ok(!readFileSync(new URL('../'+path,import.meta.url),'utf8').includes('generation_study'));
 const source=readFileSync(new URL('../worker/authoring-commits.ts',import.meta.url),'utf8').split('// A separate typed side-effect receipt:')[0];assert.ok(!source.includes('generation_study'));assert.ok(!source.includes('generation-supplied-study-approval'));
});
test('preview write fault retains no partial display',async t=>{
 const f=await fixture(t),batch=f.DB.batch;f.DB.batch=statements=>batch([...statements,f.DB.prepare('INSERT INTO generation_study_assertions VALUES(0)')]);denied(await f.preview());
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM private_content WHERE kind='authoring-study-preview'").get().n,0);noAuthority(f);
});
for(const change of ['principal','evidence','configuration'])test('change inside commit after all seven writes is rolled back by final assertions: '+change,async t=>{
 const f=await fixture(t),r=await f.preview(),batch=f.DB.batch;
 f.DB.batch=statements=>{const i=statements.findIndex(s=>s.sql.startsWith('INSERT INTO authoring_study_commits'));if(i<0)return batch(statements);
 const sql=change==='principal'?"UPDATE users SET updated_at='changed'":change==='evidence'?"UPDATE authoring_study_evidence SET status='revoked'":"UPDATE authoring_study_configurations SET status='revoked'";
 const mutated=[...statements];mutated.splice(i+1,0,f.DB.prepare(sql));return batch(mutated);};denied(await f.call(f.command(r)));noAuthority(f);
 assert.equal(f.sqlite.prepare("SELECT status FROM authoring_study_configurations").get().status,'active');assert.equal(f.sqlite.prepare("SELECT status FROM authoring_study_evidence").get().status,'verified');
});
