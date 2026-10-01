import assert from 'node:assert/strict';
import test from 'node:test';
import helpers from './scene-admission-original-fixture.mjs';
const { fixture } = helpers;


for(const large of [false,true])test(`Scene admission revalidates original proof without redundant history reductions${large?' with renewed large history':''}`,async t=>{
 const f=await fixture(t,large?{renewals:2,history:5000}:{});
 const response=await f.send('authorize',f.body);assert.equal(response.status,200,await response.clone().text());
 const admitted=await response.json();assert.equal(admitted.permitted.run,true);
 assert.equal(f.reductions,2,'One authorization and one admission reconstruction; refresh calls only prove the captured original');
 assert.equal(f.proofs,5,'Both full reads and all three original-proof refresh boundaries are checked');
 const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(JSON.parse(job.scene_source_version_json).phase,'admission');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,0);
 const replay=await f.send('authorize',f.body);assert.equal(replay.status,200,await replay.clone().text());
 assert.equal((await replay.json()).original.jobId,admitted.original.jobId);
 for(const table of ['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1,table);
});


for(const boundary of [3,4,5])for(const fault of ['missing','sparse','false','failed','expired'])
test(`Scene original-proof refresh ${boundary-2} rejects ${fault}`,async t=>{
 const f=await fixture(t);let injected=false;
 f.afterBatch=(result,statements,proof)=>{
  if(!proof||f.proofs!==boundary)return result;injected=true;
  if(fault==='missing')return result.slice(0,-1);
  if(fault==='sparse'){delete result[0];return result;}
  if(fault==='false')result[0].results=[{current:0}];
  if(fault==='failed')result[0].success=false;
  if(fault==='expired')t.mock.timers.setTime(Date.parse(f.ready.sceneCostPreview.expiresAt));
  return result;
 };
 const response=await f.send('authorize',f.body);assert.equal(injected,true);assert.notEqual(response.status,200);f.empty();
});


for(const boundary of [3,4,5])for(const fault of ['private-body-aba','epoch','retention','ancestor'])
test(`Scene original-proof refresh ${boundary-2} rejects ${fault} without recapturing`,async t=>{
 const f=await fixture(t,{renewals:1});let injected=false;
 f.beforeBatch=(_statements,proof)=>{
  if(!proof||f.proofs!==boundary)return;injected=true;
  if(fault==='private-body-aba')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
  if(fault==='epoch')f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
  if(fault==='retention')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()-1).toISOString(),f.plan.draftId);
  if(fault==='ancestor')f.sqlite.prepare("UPDATE output_commands SET request_digest='changed' WHERE action='confirm'").run();
 };
 const response=await f.send('authorize',f.body);assert.equal(injected,true);assert.notEqual(response.status,200);assert.equal(f.reductions,2);f.empty();
});


test('Scene original-proof reuse still rejects a source mutation at final atomic admission',async t=>{
 const f=await fixture(t,{renewals:1});let injected=false;
 f.beforeBatch=statements=>{
  if(!injected&&statements.some(q=>q.sql.startsWith('INSERT INTO output_commands')&&q.bindings[4]==='authorize')){
   injected=true;f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
  }
 };
 const response=await f.send('authorize',f.body);assert.equal(injected,true);assert.notEqual(response.status,200);f.empty();
});
