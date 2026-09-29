import test from 'node:test';
import assert from 'node:assert/strict';
import {audioRecoveryFixture} from './output-audio-recovery-fixture.mjs';
import * as audioAdapter from '../worker/fal-audio-adapter.ts';
import {guardOutputPrivateWrites} from '../worker/output-private-execution.ts';
const {executeOutputAudioRecovery}=await import('../worker/output-audio-recovery.ts');

// Actual runtime/output DDL and writers; the fixture explicitly sets up the
// original ordinary purchase. This does not claim sponsored HTTP admission.
const completedResultOnly=Symbol('completed-result-only');
const financialTables=['output_execution_grants','output_operation_slots','output_operation_routes','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
const rows=(f,tables)=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const snapshot=f=>rows(f,['document_jobs',...financialTables,'private_content','events','event_private_payloads']);
const receiptMap=f=>JSON.parse(f.job().result_json).providerSubmissions;
const completedReceipt=f=>({...f.mediaReceipt,status:'completed',costMicrousd:37600,inputTokens:0,outputTokens:0,totalTokens:0});

async function fixture(t){
 const f=await audioRecoveryFixture();t.after(()=>f.close());
 f.env.FAL_KEY='offline-audio-observation-test';
 const mediaCalls=[];
 for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{mediaCalls.push(method);throw Error('No media I/O in financial observation tests');});
 t.after(()=>assert.deepEqual(mediaCalls,[]));
 return f;
}

function originalOptions(f,lease,overrides={}){
 return{providerJobId:lease.providerRequestId,providerModel:lease.attempt.model,
  providerStatusUrl:lease.urls.statusUrl,providerResponseUrl:lease.urls.responseUrl,providerCancelUrl:lease.urls.cancelUrl,
  profile:f.request.audioProfile,retainedReceipt:lease.prepared,...overrides};
}

/** The real adapter mints the observation. Every fetch is intercepted and only
 * the two exact original queue GETs are accepted; even a media GET is a failure. */
function exactQueue(t,f,{options,beforeResult}={}){
 const identity=options??{providerJobId:f.cp.providerJobId,providerStatusUrl:f.cp.providerStatusUrl,providerResponseUrl:f.cp.providerResponseUrl};
 const calls=[];
 t.mock.method(globalThis,'fetch',async(value,init={})=>{
  const url=String(value);calls.push(url);
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'manual');
  assert.equal(new Headers(init.headers).get('authorization'),'Key offline-audio-observation-test');
  if(url===identity.providerStatusUrl+'?logs=1')return Response.json({status:'COMPLETED',request_id:identity.providerJobId});
  if(url===identity.providerResponseUrl){
   await beforeResult?.();
   return Response.json({request_id:identity.providerJobId,audio:{url:'https://v3b.fal.media/files/never-read-original.mp3',content_type:'audio/mpeg',duration:20},lyrics:''});
  }
  throw Error('Unexpected fetch: only exact original status/result GETs are allowed');
 });
 return calls;
}

async function observe(t,f,lease,{env=f.env,options:overrides={},beforeResult,onCompleted}={}){
 const options=originalOptions(f,lease,overrides),calls=exactQueue(t,f,{options,beforeResult});let observation;
 await assert.rejects(audioAdapter.recoverAcceptedAudio(env,{...options,onCompletedResult:async value=>{
  observation=value;await onCompleted?.(value);throw completedResultOnly;
 }}),error=>error===completedResultOnly);
 assert.ok(observation,'Only the actual completed provider response may issue an observation');
 assert.deepEqual(calls,[options.providerStatusUrl+'?logs=1',options.providerResponseUrl]);
 return{observation,calls,options};
}

test('Audio completed-result observation is opaque, environment-bound and original-request-bound',async t=>{
 const f=await fixture(t),lease=await f.claim();
 assert.equal(typeof lease.recordObservedProviderResult,'function');
 const {observation}=await observe(t,f,lease),identity={model:lease.attempt.model,providerRequestId:lease.providerRequestId};
 const read=audioAdapter.readAudioCompletedResultObservation;
 assert.equal(typeof read,'function');
 assert.deepEqual(read(observation,f.env,identity),{provider:'fal',...identity,costMicrousd:37600,costBasis:'published-audio-rate',inputTokens:0,outputTokens:0,totalTokens:0});
 for(const forged of [{},structuredClone(observation),{...observation},JSON.parse(JSON.stringify(observation))]){
  assert.throws(()=>read(forged,f.env,identity));
  const before=snapshot(f);await assert.rejects(async()=>lease.recordObservedProviderResult(forged));assert.deepEqual(snapshot(f),before);
 }
 assert.throws(()=>read(observation,{...f.env},identity));
 assert.throws(()=>read(observation,f.env,{...identity,providerRequestId:'another-original'}));
 assert.throws(()=>read(observation,f.env,{...identity,model:'fal-ai/lyria3'}));
});

const withdrawals=[
 ['source revoked',f=>f.sqlite.exec("UPDATE private_content SET redacted_at='withdrawn' WHERE content_id='audio-source'")],
 ['private source and planner erased',f=>f.sqlite.exec("DELETE FROM private_content WHERE content_id IN('audio-source','audio-response')")],
 ['grant revoked',f=>f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'")],
 ['original recovery lease expired',f=>f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputAudioRecovery.expiresAt','2000-01-01T00:00:00.000Z')")],
 ['all creative custody withdrawn',f=>f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'; DELETE FROM private_content; UPDATE document_jobs SET result_json=json_set(result_json,'$.outputAudioRecovery.expiresAt','2000-01-01T00:00:00.000Z')")],
];
for(const [name,withdraw] of withdrawals)test('Audio records original known cost after '+name+' without restoring creative custody',async t=>{
 const f=await fixture(t),lease=await f.claim();let financialBefore;
 assert.equal(typeof lease.recordObservedProviderResult,'function');
 const prepare=f.env.DB.prepare.bind(f.env.DB);let onlyFinance=false;const financialSql=[];
 t.mock.method(f.env.DB,'prepare',sql=>{
  if(onlyFinance){
   financialSql.push(sql);
   assert.doesNotMatch(sql,/\b(?:private_content|event_private_payloads|event_write_stage|request_json)\b|\bSELECT\s+(?:\w+\.)?\*|\$\.(?:artifactPlan|plannerInput|audioInputReceipt|generationReceipt|outputAudioRequest)\b/iu,'Financial recording must not read creative payloads');
  }
  return prepare(sql);
 });
 const {observation,calls,options}=await observe(t,f,lease,{
  options:{onBeforeSourceTransmission:()=>lease.assertCurrent()},
  beforeResult:()=>{withdraw(f);financialBefore=rows(f,financialTables);onlyFinance=true;},
  onCompleted:async value=>{await lease.recordObservedProviderResult(value);},
 });
 assert.ok(financialSql.length>0);onlyFinance=false;
 assert.deepEqual(receiptMap(f),{[f.planner.clientRequestId]:f.planner,[f.attempt.clientRequestId]:completedReceipt(f)});
 const financialAfter=rows(f,financialTables);
 // Revocation itself is preserved; observing cost neither settles nor refunds.
 assert.deepEqual(financialAfter,financialBefore);
 const once=snapshot(f);onlyFinance=true;await lease.recordObservedProviderResult(observation);onlyFinance=false;assert.deepEqual(snapshot(f),once);
 await assert.rejects(lease.assertCurrent());
 await assert.rejects(audioAdapter.recoverAcceptedAudio(f.env,{...options,onBeforeSourceTransmission:()=>lease.assertCurrent()}));
 assert.equal(calls.length,2,'Withdrawn custody must refuse the next GET before fetch');
 const guarded=guardOutputPrivateWrites(f.env,f.scope,f.slot,async()=>lease.assertions(),{retentionPolicy:null});
 await assert.rejects(guarded.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES('late-audio-private-write','owner','document-artifact','{}',?,?)").bind(new Date().toISOString(),f.job().expires_at).run());
 assert.deepEqual(snapshot(f),once,'Expired creative custody must not authorize a private write');
 assert.equal(f.job().attempt_count,2);assert.equal(f.job().status,'failed');assert.equal(f.media.size,0);
});

const financialMutations=[
 ['original payer',"UPDATE output_execution_grants SET payer_user_id='other-payer'"],
 ['coherently retargeted payer and reservations',"UPDATE output_execution_grants SET payer_user_id='other-payer'; UPDATE budget_reservations SET owner_id='other-payer'; UPDATE cost_budget_reservations SET owner_id='other-payer'"],
 ['token reservation identity',"UPDATE output_operation_slots SET token_reservation_id='different-token'"],
 ['cost reservation identity',"UPDATE output_operation_slots SET cost_reservation_id='different-cost'"],
 ['token reservation owner',"UPDATE budget_reservations SET owner_id='other-payer'"],
 ['cost reservation owner',"UPDATE cost_budget_reservations SET owner_id='other-payer'"],
 ['reservation period',"UPDATE budget_reservations SET period='2000-01'; UPDATE cost_budget_reservations SET period='2000-01'"],
 ['reservation correlation',"UPDATE cost_budget_reservations SET correlation_id='different-original'"],
 ['reservation amount',"UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1"],
 ['original call request digest',"UPDATE output_provider_calls SET request_digest='different-digest' WHERE provider='fal'"],
 ['original call client id',"UPDATE output_provider_calls SET client_request_id='different-client' WHERE provider='fal'"],
 ['original provider result id',"UPDATE output_provider_calls SET provider_response_id='different-result' WHERE provider='fal'"],
 ['original call model',"UPDATE output_provider_calls SET model='different-model' WHERE provider='fal'"],
 ['original media reserved amount',"UPDATE output_provider_calls SET reserved_microusd=reserved_microusd+1 WHERE provider='fal'"],
 ['original planner request digest',"UPDATE output_provider_calls SET request_digest='different-planner-digest' WHERE provider='openai'"],
 ['original planner call key',"UPDATE output_provider_calls SET call_key='planning:0:repair' WHERE provider='openai'"],
 ['original planner stage key',"INSERT INTO output_operation_routes SELECT scope_key,slot_id,'planning:0:repair',provider,model,maximum_calls FROM output_operation_routes WHERE stage_key='planning:0:initial'; UPDATE output_provider_calls SET stage_key='planning:0:repair' WHERE provider='openai'"],
 ['original planner provider response id',"UPDATE output_provider_calls SET provider_response_id='different-planner-response' WHERE provider='openai'"],
 ['original planner status',"UPDATE output_provider_calls SET status='uncertain' WHERE provider='openai'"],
 ['original planner used cost',"UPDATE output_provider_calls SET used_microusd=used_microusd+1 WHERE provider='openai'"],
 ['original planner reserved amount',"UPDATE output_provider_calls SET reserved_microusd=reserved_microusd+1 WHERE provider='openai'"],
 ['original call count',"DELETE FROM output_provider_calls WHERE provider='openai'"],
 ['conflicting settled call',"UPDATE output_provider_calls SET status='settled',used_microusd=37599 WHERE provider='fal'"],
 ['original receipt map',"UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.\"forma-audio-original\".providerRequestId','different-result')"],
 ['planner receipt map',"UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.\"forma-document-audio-plan\".costMicrousd',301)"],
 ['legacy uncertainty marker',"UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissionLegacyUncertain',json('true'))"],
];
for(const [name,sql] of financialMutations)test('Audio financial observation refuses changed '+name+' atomically',async t=>{
 const f=await fixture(t),lease=await f.claim();assert.equal(typeof lease.recordObservedProviderResult,'function');
 const {observation}=await observe(t,f,lease),batch=f.env.DB.batch.bind(f.env.DB);let before;
 t.mock.method(f.env.DB,'batch',statements=>{
  if(!before){f.sqlite.exec(sql);before=snapshot(f);}
  return batch(statements);
 });
 await assert.rejects(lease.recordObservedProviderResult(observation));assert.ok(before,'Mutation must occur at the actual guarded transaction');assert.deepEqual(snapshot(f),before);
});

test('Audio known-cost recording survives the actual recovery deadline crossing during the original result GET',async t=>{
 const f=await fixture(t);f.assertions[0].deadlineMs=Date.now()+150;const lease=await f.claim();
 const {observation,calls,options}=await observe(t,f,lease,{
  options:{onBeforeSourceTransmission:()=>lease.assertCurrent()},
  beforeResult:()=>new Promise(resolve=>setTimeout(resolve,Math.max(0,lease.deadlineMs-Date.now())+15)),
  onCompleted:async value=>{assert.ok(Date.now()>lease.deadlineMs);await lease.recordObservedProviderResult(value);},
 });
 assert.deepEqual(receiptMap(f)[f.attempt.clientRequestId],completedReceipt(f));
 const once=snapshot(f);await lease.recordObservedProviderResult(observation);assert.deepEqual(snapshot(f),once);
 await assert.rejects(lease.assertCurrent());
 await assert.rejects(audioAdapter.recoverAcceptedAudio(f.env,{...options,onBeforeSourceTransmission:()=>lease.assertCurrent()}));
 assert.equal(calls.length,2);
 const guarded=guardOutputPrivateWrites(f.env,f.scope,f.slot,async()=>lease.assertions(),{retentionPolicy:null});
 await assert.rejects(guarded.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES('after-deadline','owner','document-artifact','{}',?,?)").bind(new Date().toISOString(),f.job().expires_at).run());
 assert.deepEqual(snapshot(f),once);
});

test('Audio observation retry after a committed write loses its acknowledgement preserves one exact receipt',async t=>{
 const f=await fixture(t),lease=await f.claim(),{observation}=await observe(t,f,lease),batch=f.env.DB.batch.bind(f.env.DB);let loseAcknowledgement=true;
 t.mock.method(f.env.DB,'batch',async statements=>{
  const result=await batch(statements);
  if(loseAcknowledgement){loseAcknowledgement=false;throw Error('lost committed financial receipt acknowledgement');}
  return result;
 });
 await assert.rejects(lease.recordObservedProviderResult(observation),/lost committed financial receipt acknowledgement/);
 assert.deepEqual(receiptMap(f)[f.attempt.clientRequestId],completedReceipt(f));const committed=snapshot(f);
 await lease.recordObservedProviderResult(observation);assert.deepEqual(snapshot(f),committed);
 await lease.assertCurrent();
});

test('Audio recording rejects a genuine observation minted in another environment',async t=>{
 const f=await fixture(t),lease=await f.claim();
 const {observation}=await observe(t,f,lease,{env:{...f.env}}),before=snapshot(f);
 await assert.rejects(lease.recordObservedProviderResult(observation));assert.deepEqual(snapshot(f),before);
});

test('Audio recording rejects a genuine completed observation for another original request',async t=>{
 const f=await fixture(t),lease=await f.claim(),providerJobId='audio_other_original',base='https://queue.fal.run/fal-ai/stable-audio-3/requests/'+providerJobId;
 const {observation}=await observe(t,f,lease,{options:{providerJobId,providerStatusUrl:base+'/status',providerResponseUrl:base,providerCancelUrl:base+'/cancel'}}),before=snapshot(f);
 await assert.rejects(lease.recordObservedProviderResult(observation));assert.deepEqual(snapshot(f),before);
});

test('Audio duplicate completed observation is idempotent and conflicting retained known cost is refused',async t=>{
 const f=await fixture(t),lease=await f.claim(),{observation}=await observe(t,f,lease);
 await lease.recordObservedProviderResult(observation);const once=snapshot(f);
 await lease.recordObservedProviderResult(observation);assert.deepEqual(snapshot(f),once);
 const other=await fixture(t);other.cp.providerSubmissions[other.attempt.clientRequestId]={...completedReceipt(other),costMicrousd:37599};
 other.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(other.cp));
 other.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=37599 WHERE provider='fal'");
 const original=await other.claim(),different=await observe(t,other,original),before=snapshot(other);
 await assert.rejects(original.recordObservedProviderResult(different.observation));assert.deepEqual(snapshot(other),before);
});

const failedDownloadUrl='https://v3b.fal.media/files/original-download-unavailable.mp3';
const financialIdentity=f=>Object.fromEntries(['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'].map(table=>[table,f.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
const executeRecovery=f=>executeOutputAudioRecovery(f.env,f.user,f.job(),f.binding,{assertions:f.assertions});
function observePrivateSqlWrites(t,f){
 const prepare=f.env.DB.prepare.bind(f.env.DB),attempts=[];
 // Installed after original fixture setup. Intentional withdrawal mutations
 // below use SQLite directly; every product D1 preparation remains observed.
 t.mock.method(f.env.DB,'prepare',sql=>{
  if(/\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`[]?(?:private_content|event_private_payloads)\b/iu.test(sql))attempts.push(sql);
  return prepare(sql);
 });
 return attempts;
}
function assertOriginalCostSettled(f){
 const media=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").get();
 assert.equal(media.call_key,'audio:initial');assert.equal(media.client_request_id,f.attempt.clientRequestId);assert.equal(media.request_digest,f.attempt.requestDigest);
 assert.equal(media.provider_response_id,f.cp.providerJobId);assert.equal(media.status,'settled');assert.equal(media.used_microusd,37600);
 const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(f.slot.costReservationId);
 assert.equal(cost.owner_id,f.user.userId);assert.equal(cost.stream_id,'creative:owner');assert.equal(cost.correlation_id,f.jobId+':attempt:2');assert.equal(cost.status,'settled');assert.equal(cost.used_microusd,37900);
 const token=f.sqlite.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').get(f.slot.tokenReservationId);
 assert.equal(token.owner_id,f.user.userId);assert.equal(token.status,'settled');assert.equal(token.used_tokens,130);
 for(const row of f.sqlite.prepare('SELECT * FROM cost_budget_counters').all()){assert.equal(row.used_microusd,37900);assert.equal(row.reserved_microusd,0);}
 for(const row of f.sqlite.prepare('SELECT * FROM budget_counters').all()){assert.equal(row.used_tokens,130);assert.equal(row.reserved_tokens,0);}
 assert.deepEqual(receiptMap(f)[f.attempt.clientRequestId],completedReceipt(f));
 const job=f.job();assert.equal(job.owner_id,f.user.userId);assert.equal(job.stream_id,'creative:owner');assert.equal(job.attempt_count,2);assert.equal(job.correlation_id,f.jobId+':attempt:2');assert.equal(job.status,'failed');
 assert.equal(JSON.parse(job.result_json).providerJobId,f.cp.providerJobId);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
 assert.equal(f.media.size,0);
}
function recoveryFailureTransport(t,f,{beforeResult,expectDownload}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(value,init={})=>{
  const url=String(value),method=init.method??'GET';calls.push({url,method});
  assert.equal(method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'manual');
  if(url===failedDownloadUrl){
   assert.equal(expectDownload,true,'Withdrawn custody must stop before the media GET');
   assert.equal(new Headers(init.headers).has('authorization'),false);
   assertOriginalCostSettled(f);return new Response('original media unavailable',{status:503});
  }
  assert.equal(new Headers(init.headers).get('authorization'),'Key offline-audio-observation-test');
  if(url===f.cp.providerStatusUrl+'?logs=1')return Response.json({status:'COMPLETED',request_id:f.cp.providerJobId});
  if(url===f.cp.providerResponseUrl){
   await beforeResult?.();
   return Response.json({request_id:f.cp.providerJobId,audio:{url:failedDownloadUrl,content_type:'audio/mpeg',duration:20},lyrics:''});
  }
  throw Error('Unexpected fetch outside exact original recovery reads');
 });
 return calls;
}

test('Audio full original recovery settles known cost before failed download and repeated materialization does not charge twice',async t=>{
 const f=await fixture(t),privateWrites=observePrivateSqlWrites(t,f),counts=financialIdentity(f),calls=recoveryFailureTransport(t,f,{expectDownload:true});
 await assert.rejects(executeRecovery(f),error=>error.detail?.code==='fal_audio_download_failed');
 assertOriginalCostSettled(f);assert.deepEqual(financialIdentity(f),counts);
 const accounted=rows(f,['output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters']);
 await assert.rejects(executeRecovery(f),error=>error.detail?.code==='fal_audio_download_failed');
 assertOriginalCostSettled(f);assert.deepEqual(financialIdentity(f),counts);assert.deepEqual(rows(f,Object.keys(accounted)),accounted);
 assert.deepEqual(calls,Array.from({length:2},()=>[f.cp.providerStatusUrl+'?logs=1',f.cp.providerResponseUrl,failedDownloadUrl]).flat().map(url=>({url,method:'GET'})));
 assert.deepEqual(privateWrites,[],'Failed materialization must not attempt SQL private writes or leave orphan payloads');
});

for(const [name,withdraw] of [
 ['source and retained planner erased',f=>f.sqlite.exec("DELETE FROM private_content WHERE content_id IN('audio-source','audio-response')")],
 ['grant revoked and private content erased',f=>f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'; DELETE FROM private_content")],
])test('Audio full recovery settles original cost when '+name+' during result GET, then refuses materialization',async t=>{
 const f=await fixture(t),privateWrites=observePrivateSqlWrites(t,f),counts=financialIdentity(f),calls=recoveryFailureTransport(t,f,{beforeResult:()=>withdraw(f),expectDownload:false});
 // The ordinary reconciler retains its inherited full-job read. These cases
 // exercise the real callback and accounting, not sponsored projection rules.
 await assert.rejects(executeRecovery(f));assertOriginalCostSettled(f);assert.deepEqual(financialIdentity(f),counts);
 assert.deepEqual(calls,[f.cp.providerStatusUrl+'?logs=1',f.cp.providerResponseUrl].map(url=>({url,method:'GET'})));
 const accounted=rows(f,['output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters']);
 await assert.rejects(executeRecovery(f));assert.equal(calls.length,2);assertOriginalCostSettled(f);assert.deepEqual(rows(f,Object.keys(accounted)),accounted);assert.deepEqual(financialIdentity(f),counts);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM private_content WHERE content_id IN('audio-source','audio-response')").get().count,0);
 if(name.startsWith('grant'))assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'revoked');
 assert.deepEqual(privateWrites,[],'Withdrawn creative custody must not attempt SQL private writes or leave orphan payloads');
});

test('Audio full recovery refuses a changed known receipt between observation and reconciliation without settling the changed cost',async t=>{
 const f=await fixture(t),privateWrites=observePrivateSqlWrites(t,f),calls=recoveryFailureTransport(t,f,{expectDownload:false});
 const prepare=f.env.DB.prepare.bind(f.env.DB);let injected=false,financialBefore;
 t.mock.method(f.env.DB,'prepare',sql=>{
  if(!injected&&/^\s*SELECT slot\.scope_key,slot\.slot_id/iu.test(sql)&&sql.includes('AS receipts_json')){
   assert.deepEqual(receiptMap(f)[f.attempt.clientRequestId],completedReceipt(f),'The genuine completed result must already have been recorded');
   f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.\"forma-audio-original\".costMicrousd',37599)");
   financialBefore=rows(f,financialTables);injected=true;
  }
  return prepare(sql);
 });
 await assert.rejects(executeRecovery(f));assert.equal(injected,true,'Inject at the actual reconciliation candidate read');
 assert.equal(receiptMap(f)[f.attempt.clientRequestId].costMicrousd,37599,'Refusal must preserve the interfering mutation');
 assert.deepEqual(rows(f,financialTables),financialBefore,'A changed retained receipt must not settle or release the original reservation');
 assert.equal(f.sqlite.prepare("SELECT used_microusd FROM output_provider_calls WHERE provider='fal'").get().used_microusd,null);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
 assert.deepEqual(calls,[f.cp.providerStatusUrl+'?logs=1',f.cp.providerResponseUrl].map(url=>({url,method:'GET'})));
 assert.deepEqual(privateWrites,[]);
});
