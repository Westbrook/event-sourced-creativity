import test from 'node:test';
import assert from 'node:assert/strict';
import {audioRecoveryFixture} from './output-audio-recovery-fixture.mjs';
test('Audio original custody retains attempt2 and accepted original call without spending or dispatch',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());t.mock.method(globalThis,'fetch',()=>{throw Error('No provider calls');});
 const before=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),lease=await f.claim();
 assert.equal(lease.providerRequestId,'audio_original');await lease.assertCurrent();
 assert.equal(f.job().attempt_count,2);assert.equal(f.job().correlation_id,f.jobId+':attempt:2');assert.equal(f.job().status,'failed');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),before);
 await assert.rejects(f.claim());await lease.release();await assert.rejects(lease.assertCurrent());
});
test('expired dispatch grant alone does not authorize a new call or prevent a currently authorized original read',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'");const lease=await f.claim();await lease.assertCurrent();await lease.release();
});
for(const [name,sql] of [
 ['attempt changed',"UPDATE document_jobs SET attempt_count=1"],['correlation changed',"UPDATE document_jobs SET correlation_id='different'"],
 ['request changed',"UPDATE document_jobs SET request_json=json_set(request_json,'$.extra',true)"],['source changed',"UPDATE output_operation_slots SET source_digest='changed'"],
 ['revoked',"UPDATE output_execution_grants SET status='revoked'"],['canceled',"UPDATE document_jobs SET status='canceled'"],
 ['planner redacted',"UPDATE private_content SET redacted_at='now' WHERE content_id='audio-response'"],['planner altered',"UPDATE private_content SET content='{}' WHERE content_id='audio-response'"],
 ['provider changed',"UPDATE output_provider_calls SET provider_response_id='changed' WHERE provider='fal'"],
 ['plan changed',"UPDATE document_jobs SET result_json=json_set(result_json,'$.artifactPlan.title','changed')"],
 ['lease expired',"UPDATE document_jobs SET result_json=json_set(result_json,'$.outputAudioRecovery.expiresAt','2000-01-01T00:00:00.000Z')"]
])test('claimed Audio custody refuses '+name,async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());const lease=await f.claim();f.sqlite.exec(sql);await assert.rejects(lease.assertCurrent());});
test('abort refuses before claiming original custody',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());const controller=new AbortController();controller.abort();await assert.rejects(f.claim(controller.signal));assert.equal(JSON.parse(f.job().result_json).outputAudioRecovery,undefined);});

const save=(f,cp)=>f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(cp));
function pendingValidation(f){
 f.cp.providerSubmissions[f.planner.clientRequestId].validationStatus='pending';
 f.cp.plannerInput.validation={provider_response_ids:[f.planner.providerRequestId],provider_call_count:1,repair_attempted:false,repair_response_id:null,initial_issues:[],repair_issues:[],validation_history:[{stage:'initial',provider_attempt:1,issue_count:0,issues:[]}],adapter_reconciliation:{artifact_kind:'audio',adapter_id:'openai-document',final_issue_count:0}};
 save(f,f.cp);
}
test('Audio repairs only witnessed pending validation in the atomic original lease',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());pendingValidation(f);
 const before=structuredClone(f.cp.providerSubmissions),lease=await f.claim();await lease.assertCurrent();
 const after=JSON.parse(f.job().result_json).providerSubmissions;
 assert.deepEqual(after,{...before,[f.planner.clientRequestId]:{...before[f.planner.clientRequestId],validationStatus:'valid',validationIssueCount:0}});
 assert.equal(f.job().attempt_count,2);await lease.release();
});
for(const [name,mutate] of [
 ['missing witness',f=>{delete f.cp.plannerInput.validation;}],
 ['different response',f=>{f.cp.plannerInput.validation.provider_response_ids=['wrong'];}],
 ['contradictory count',f=>{f.cp.providerSubmissions[f.planner.clientRequestId].validationIssueCount=1;}],
 ['invalid verdict',f=>{f.cp.providerSubmissions[f.planner.clientRequestId].validationStatus='invalid';}],
 ['missing verdict',f=>{delete f.cp.providerSubmissions[f.planner.clientRequestId].validationStatus;}],
 ['nonzero issues',f=>{f.cp.plannerInput.validation.validation_history[0].issues=[{code:'bad'}];}],
 ['different adapter',f=>{f.cp.plannerInput.validation.adapter_reconciliation.adapter_id='other';}],
 ['duplicate history',f=>{f.cp.plannerInput.validation.validation_history.push(f.cp.plannerInput.validation.validation_history[0]);}],
 ['changed plan',f=>{f.cp.artifactPlan.title='changed';}],
])test('Audio pending repair refuses '+name,async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());pendingValidation(f);mutate(f);save(f,f.cp);const before=f.job().result_json;await assert.rejects(f.claim());assert.equal(f.job().result_json,before);});
for(const [name,mutate] of [
 ['malformed extra receipt',cp=>{cp.providerSubmissions.extra={};}],
 ['miskeyed media receipt',cp=>{cp.providerSubmissions.wrong=cp.providerSubmissions['forma-audio-original'];delete cp.providerSubmissions['forma-audio-original'];}],
 ['legacy uncertainty',cp=>{cp.providerSubmissionLegacyUncertain=true;}],
 ['changed completed plan',cp=>{cp.artifactPlan.title='Changed';}],
 ['planner totals changed',cp=>{cp.plannerUsage.totalTokens=131;}],
 ['planner cost parts changed',cp=>{cp.providerSubmissions['forma-document-audio-plan'].textInputCostMicrousd=101;}],
])test('Audio rejects '+name+' before acquiring custody',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());mutate(f.cp);save(f,f.cp);await assert.rejects(f.claim());assert.equal(JSON.parse(f.job().result_json).outputAudioRecovery,undefined);});
for(const [name,mutate] of [
 ['wrong provider response',raw=>{const e=JSON.parse(raw.raw_envelope);e.id='different';raw.raw_envelope=JSON.stringify(e);}],
 ['refused content',raw=>{const e=JSON.parse(raw.raw_envelope);e.output[0].content=[{type:'refusal',refusal:'No'}];raw.raw_envelope=JSON.stringify(e);}],
 ['changed output text',raw=>{const e=JSON.parse(raw.raw_envelope);e.output[0].content[0].text='{}';raw.raw_envelope=JSON.stringify(e);}],
 ['wrong measured usage',raw=>{const e=JSON.parse(raw.raw_envelope);e.usage.input_tokens=101;e.usage.total_tokens=131;raw.raw_envelope=JSON.stringify(e);}],
 ['different compilation',raw=>{raw.compiled_snapshot_sha256='f'.repeat(64);}],
 ['truncated original',raw=>{raw.candidate_truncated=true;}],
])test('Audio rejects '+name+' retained envelope',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());const raw=JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='audio-response'").get().content);mutate(raw);f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='audio-response'").run(JSON.stringify(raw));await assert.rejects(f.claim());});
test('Audio original source redaction or legacy uncertainty withdraws claimed custody',async ()=>{
 for(const sql of ["UPDATE private_content SET redacted_at='now' WHERE content_id='audio-source'","UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissionLegacyUncertain',json('true'))"]){const f=await audioRecoveryFixture();try{const lease=await f.claim();f.sqlite.exec(sql);await assert.rejects(lease.assertCurrent());}finally{f.close();}}
});
test('Audio media receipt transition is exact and settled phase cannot roll back',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());const lease=await f.claim();await lease.recordCompletedMedia(37600);await lease.assertCurrent();f.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=37600 WHERE provider='fal'");await lease.assertSettled();f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE provider='fal'");await assert.rejects(lease.assertCurrent());});
test('Audio settled-origin custody cannot roll back to uncertain',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());f.cp.providerSubmissions['forma-audio-original']={...f.mediaReceipt,status:'completed',costMicrousd:37600,totalTokens:0};save(f,f.cp);f.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=37600 WHERE provider='fal'");const lease=await f.claim();f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE provider='fal'");await assert.rejects(lease.assertCurrent());});
test('Audio bounded lease exits stalled DB read',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());f.assertions[0].deadlineMs=Date.now()+50;t.mock.method(f.env.DB,'batch',()=>new Promise(()=>{}));await assert.rejects(f.claim(),/deadline/);});
test('Audio lease returned data and assertions cannot mutate custody',async t=>{const f=await audioRecoveryFixture();t.after(()=>f.close());const lease=await f.claim();assert.throws(()=>{lease.checkpoint.artifactPlan.title='Changed';},TypeError);const guards=lease.assertions();guards.length=0;await lease.assertCurrent();await lease.release();});
