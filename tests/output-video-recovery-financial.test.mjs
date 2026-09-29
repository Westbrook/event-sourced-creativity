import test from 'node:test';
import assert from 'node:assert/strict';
import {videoRecoveryFixture} from './output-video-recovery-fixture.mjs';

test('delivered original Video completion settles original cost even when media GET fails',async()=>{
 const f=await videoRecoveryFixture(),oldFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,init)=>{
  requests.push({url:String(url),method:init?.method??'GET'});
  if(String(url).endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED'});
  if(String(url)==='https://fal.media/original.mp4')throw Error('synthetic media download failure');
  return Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length}});
 };
 try{
  await assert.rejects(f.run(),/synthetic media download failure/);
  assert.equal(requests.length,3);assert(requests.every(r=>r.method==='GET'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes').get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  const media=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").get();
  const receipt=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).providerSubmissions[media.client_request_id];
  assert.equal(receipt.status,'completed','delivered exact completion must persist before media GET');
  assert.equal(media.status,'settled');assert.equal(media.used_microusd,538020);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled');
 }finally{globalThis.fetch=oldFetch;f.close();}
});

const {captureOriginalOutputVideoFinancialAuthority:capture,recordOriginalOutputVideoCompletedObservation:record,originalOutputVideoFinancialState:financialState}=await import('../worker/output-video-original-financial.ts');
const {readOriginalOutputVideo,captureOutputVideoAttempt}=await import('../worker/output-video-execution.ts');
const {reconcileKnownOutputProviderReceipts}=await import('../worker/output-execution-control.ts');
const originalFetch=globalThis.fetch;test.after(()=>{globalThis.fetch=originalFetch;});
const row=f=>f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").get();
const receipt=f=>JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).providerSubmissions[row(f).client_request_id];
const noOutput=f=>{
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes').get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
};
const paid=f=>{
 assert.equal(row(f).status,'settled');assert.equal(row(f).used_microusd,538020);
 assert.equal(receipt(f).status,'completed');assert.equal(receipt(f).costMicrousd,538020);
 const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get(),tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();
 assert.equal(cost.status,'settled');assert.equal(cost.owner_id,'owner');
 assert.equal(cost.used_microusd,538020+f.original.cp.providerSubmissions[f.original.planner.attempt.clientRequestId].costMicrousd);
 assert.equal(tokens.status,'settled');assert.equal(tokens.owner_id,'owner');assert.equal(tokens.used_tokens,130);
};
const unobserved=f=>{assert.equal(row(f).status,'uncertain');assert.equal(row(f).used_microusd,null);assert.equal(receipt(f).status,'accepted');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');};
const job=f=>({...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'});
const authority=f=>capture(f.env,f.user,f.scope,f.slot,job(f));
const completedTransport=(f,requests,media=()=>new Response(f.original.bytes,{headers:{'content-type':'video/mp4'}}),result={})=>async(url,init)=>{
 requests.push({url:String(url),method:init?.method??'GET'});
 if(String(url).endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED'});
 if(String(url)==='https://fal.media/original.mp4')return media();
 return Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length},...result});
};
/** Mint genuine accepted evidence through the unchanged adapter. The sentinel
 * ends that invocation after callback delivery; this helper makes no media GET. */
async function observation(f,overrides={}){
 const input={contract:f.original.contract,requestBody:f.original.mediaAttempt.video.requestBody,clientRequestId:f.original.mediaAttempt.clientRequestId,providerRequestId:'video_original',...overrides};
 const attempt=await captureOutputVideoAttempt(input.contract,input.requestBody,input.clientRequestId);input.requestDigest=attempt.requestDigest;
 let token;const requests=[],sentinel=Error('synthetic completed-observation sentinel');
 globalThis.fetch=async(url,init)=>{requests.push({url:String(url),method:init?.method??'GET'});return Response.json(String(url).endsWith('/status')?{request_id:input.providerRequestId,status:'COMPLETED'}:{request_id:input.providerRequestId,video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length}});};
 await assert.rejects(readOriginalOutputVideo({...f.env,FAL_KEY:'offline-test-key'},input,{onBeforeRead:async hook=>hook.assertCurrent(),onEnvelope:async(_value,hook)=>hook.assertCurrent(),onCompleted(value,hook){hook.assertCurrent();token=value;throw sentinel;}}),error=>error===sentinel);
 assert(token);assert.equal(requests.length,2);assert(requests.every(r=>r.method==='GET'));return token;
}

for(const mode of ['wrong_mime','empty','wrong_length','abort'])test(`delivered Video completion remains paid after ${mode} media without output`,async()=>{
 const f=await videoRecoveryFixture(),requests=[],controller=new AbortController();
 globalThis.fetch=completedTransport(f,requests,()=>{
  if(mode==='abort'){controller.abort(Error('synthetic media abort'));throw controller.signal.reason;}
  return new Response(mode==='empty'?new Uint8Array():mode==='wrong_length'?new Uint8Array([1]):f.original.bytes,{headers:{'content-type':mode==='wrong_mime'?'text/plain':'video/mp4'}});
 });
 try{await assert.rejects(f.run(controller.signal));assert.equal(requests.length,3);assert(requests.every(r=>r.method==='GET'));paid(f);noOutput(f);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');}finally{f.close();}
});

for(const mutation of ['source','cancel','job_expiry','recovery_expiry','abort'])test(`financial commit after delivered callback survives ${mutation} while next private read is refused`,async()=>{
 const f=await videoRecoveryFixture(),requests=[],controller=new AbortController();let delivered=false;
 f.sqlite.exec('CREATE TABLE recovery_source(current INTEGER);INSERT INTO recovery_source VALUES(1)');f.assertions.push({sql:'(SELECT current FROM recovery_source)=1'});
 globalThis.fetch=completedTransport(f,requests);const batch=f.DB.batch;
 f.DB.batch=async statements=>{
  // This first financial UPDATE exists only after the completed callback has
  // entered. Envelope retention and both original GETs have already finished.
  if(!delivered&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){
   delivered=true;assert.equal(requests.length,2);
   if(mutation==='source')f.sqlite.exec('UPDATE recovery_source SET current=0');
   if(mutation==='cancel')f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
   if(mutation==='job_expiry')f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'");
   if(mutation==='recovery_expiry')f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoRecovery.expiresAt','2000-01-01T00:00:00.000Z')");
   if(mutation==='abort')controller.abort(Error('synthetic delivered-callback abort'));
  }
  return batch(statements);
 };
 try{
  await assert.rejects(f.run(controller.signal));assert(delivered);
  // Abort can retire the transport before its already entered financial
  // callback returns. Drain only that local callback, with no provider reads.
  for(let n=0;n<100&&f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status!=='settled';n++)await new Promise(resolve=>setImmediate(resolve));
  paid(f);noOutput(f);assert.equal(requests.length,2);assert(requests.every(r=>r.method==='GET'));
 }finally{await new Promise(resolve=>setImmediate(resolve));f.close();}
});

for(const mode of ['pending','wrong_id','wrong_model','error','ambiguous'])test(`actual recovery leaves ${mode} original unobserved and uncharged`,async()=>{
 const f=await videoRecoveryFixture(),requests=[];
 globalThis.fetch=mode==='pending'?async(url,init)=>{requests.push({url:String(url),method:init?.method??'GET'});return Response.json({request_id:'video_original',status:'IN_PROGRESS'});}:completedTransport(f,requests,()=>{throw Error('unexpected media read');},mode==='wrong_id'?{request_id:'other'}:mode==='wrong_model'?{model:'other'}:mode==='error'?{error:'rejected'}:{data:{video:{url:'https://fal.media/other.mp4'}}});
 try{if(mode==='pending')assert.equal((await f.run()).status,'pending');else await assert.rejects(f.run());assert.equal(requests.length,mode==='pending'?1:2);unobserved(f);noOutput(f);}finally{f.close();}
});

test('financial authority and observation are opaque and bound to exact environment/database identity',async()=>{
 const f=await videoRecoveryFixture(),other=await videoRecoveryFixture();
 try{
  const a=await authority(f),token=await observation(f);assert(Object.isFrozen(a));assert(Object.isFrozen(financialState(a,f.env)));
  for(const forged of [{},{...a},structuredClone(a)]){assert.throws(()=>financialState(forged,f.env));await assert.rejects(record(forged,f.env,token));}
  for(const forged of [{},{...token},structuredClone(token)])await assert.rejects(record(a,f.env,forged));
  await assert.rejects(record(a,{...f.env},token));await assert.rejects(record(a,other.env,token));
  const saved=f.env.DB;f.env.DB=other.DB;assert.throws(()=>financialState(a,f.env));await assert.rejects(record(a,f.env,token));f.env.DB=saved;
  unobserved(f);unobserved(other);assert.equal(financialState(a,f.env).receipt,null);noOutput(f);
 }finally{f.close();other.close();}
});

for(const mode of ['client','provider_request','request_digest'])test(`genuine observation with mismatched original ${mode} cannot settle`,async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),body=JSON.parse(f.original.mediaAttempt.video.requestBody);body.prompt+=' Changed';
  const token=await observation(f,mode==='client'?{clientRequestId:'forma-video-media-other'}:mode==='provider_request'?{providerRequestId:'video_other'}:{requestBody:JSON.stringify(body)});
  await assert.rejects(record(a,f.env,token));unobserved(f);noOutput(f);
 }finally{f.close();}
});

test('original payer is captured and later user billing preference changes cannot redirect settlement',async()=>{
 const f=await videoRecoveryFixture();try{
  f.user.billingUserId='new-before-capture';const a=await authority(f),token=await observation(f);f.user.billingUserId='new-after-capture';
  assert.equal(financialState(a,f.env).payerUserId,'owner');await record(a,f.env,token);paid(f);noOutput(f);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations WHERE owner_id<>'owner'").get().n,0);
 }finally{f.close();}
});

const nativeMutations={
 payer:"UPDATE output_execution_grants SET payer_user_id='foreign'",
 correlation:"UPDATE document_jobs SET correlation_id='changed'",
 attempt:"UPDATE document_jobs SET attempt_count=2",
 stream:"UPDATE document_jobs SET stream_id='creative:foreign'",
 document:"UPDATE document_jobs SET document_id='changed'",
 contract:"UPDATE output_operation_slots SET target_contract_digest='changed'",
 source:"UPDATE output_operation_slots SET source_digest='changed'",
 route:"UPDATE output_operation_slots SET route_digest='changed'",
 call_cap:'UPDATE output_operation_slots SET maximum_calls=3',
 token_cap:'UPDATE output_operation_slots SET maximum_tokens=152001',
 grant_cap:'UPDATE output_execution_grants SET maximum_microusd=600001',
 cost_amount:'UPDATE cost_budget_reservations SET reserved_microusd=600001',
 token_amount:'UPDATE budget_reservations SET reserved_tokens=152001',
 cost_period:"UPDATE cost_budget_reservations SET period='1999-01'",
 cost_operation:"UPDATE cost_budget_reservations SET operation='other'",
 media_model:"UPDATE output_provider_calls SET model='other' WHERE provider='fal'",
 media_digest:"UPDATE output_provider_calls SET request_digest='other' WHERE provider='fal'",
 media_provider_id:"UPDATE output_provider_calls SET provider_response_id='other' WHERE provider='fal'",
 media_reserve:"UPDATE output_provider_calls SET reserved_microusd=538021 WHERE provider='fal'",
 planner_cost:"UPDATE output_provider_calls SET used_microusd=301 WHERE provider='openai'",
 planner_digest:"UPDATE output_provider_calls SET request_digest='other' WHERE provider='openai'",
 planner_provider_id:"UPDATE output_provider_calls SET provider_response_id='other' WHERE provider='openai'",
 planner_reserve:"UPDATE output_provider_calls SET reserved_microusd=1001 WHERE provider='openai'",
 planner_model:"UPDATE output_provider_calls SET model='other' WHERE provider='openai'",
 route_cap:'UPDATE output_operation_routes SET maximum_calls=2',
 target_selected:'UPDATE output_plan_targets SET selected=0',
};
for(const [name,sql] of Object.entries(nativeMutations))test(`captured original native ${name} mutation refuses completion atomically`,async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f);f.sqlite.exec(sql);
  const before=JSON.stringify({calls:f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),job:f.sqlite.prepare('SELECT result_json FROM document_jobs').get(),cost:f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get()});
  await assert.rejects(record(a,f.env,token));
  assert.equal(JSON.stringify({calls:f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY call_key').all(),job:f.sqlite.prepare('SELECT result_json FROM document_jobs').get(),cost:f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get()}),before);noOutput(f);
 }finally{f.close();}
});

for(const phase of ['before_record','before_reconcile'])test(`exact full financial receipt map mutation ${phase} cannot redirect original reservation`,async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),id=f.original.planner.attempt.clientRequestId;
  const change=()=>{const cp=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);cp.providerSubmissions[id].costMicrousd+=1;f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(cp));};
  let changed=false;const batch=f.DB.batch;
  if(phase==='before_record')change();else f.DB.batch=async statements=>{const result=await batch(statements);if(!changed&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){changed=true;change();}return result;};
  await assert.rejects(record(a,f.env,token));if(phase==='before_reconcile')assert(changed);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
  assert.equal(row(f).status,phase==='before_record'?'uncertain':'settled');assert.equal(receipt(f).status,phase==='before_record'?'accepted':'completed');noOutput(f);
 }finally{f.close();}
});

test('identical observation replay and lost settlement acknowledgement preserve exact cost and two original calls',async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),batch=f.DB.batch;let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){lost=true;throw Error('synthetic lost financial acknowledgement');}return result;};
  await record(a,f.env,token);assert(lost);paid(f);const costs=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all();
  await record(a,f.env,token);await record(await authority(f),f.env,token);paid(f);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),costs);noOutput(f);
 }finally{f.close();}
});

test('a conflicting terminal original call cannot be replaced or converted into fallback evidence',async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f);f.sqlite.exec("UPDATE output_provider_calls SET status='settled',used_microusd=1 WHERE provider='fal'");
  const before=f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json;await assert.rejects(record(a,f.env,token));
  assert.equal(row(f).used_microusd,1);assert.equal(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json,before);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');noOutput(f);
 }finally{f.close();}
});

test('transient combined commit retains original evidence for provider-free later maintenance',async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),batch=f.DB.batch;let failed=false;
  f.DB.batch=async statements=>{if(!failed&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){failed=true;throw Error('synthetic financial transaction unavailable');}return batch(statements);};
  await assert.rejects(record(a,f.env,token),/synthetic financial transaction unavailable/);assert(failed);
  assert.equal(row(f).status,'uncertain');assert.equal(row(f).used_microusd,null);assert.equal(receipt(f).status,'completed');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
  globalThis.fetch=()=>{throw Error('maintenance must not fetch');};
  assert.equal((await reconcileKnownOutputProviderReceipts(f.env,f.user,{jobId:'job'})).status,'known');paid(f);noOutput(f);
  const costs=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all();await reconcileKnownOutputProviderReceipts(f.env,f.user,{jobId:'job'});assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),costs);
 }finally{f.close();}
});

for(const mode of ['non_actor_payer','copied_sponsor_marker','initial_plan_source_mismatch','initial_planner_token_mismatch'])test(`ordinary financial capture refuses ${mode} before any payment write`,async()=>{
 const f=await videoRecoveryFixture();try{
  if(mode==='non_actor_payer')f.sqlite.exec("UPDATE output_execution_grants SET payer_user_id='sponsor'");
  if(mode==='copied_sponsor_marker'){
   const eventId=f.sqlite.prepare('SELECT authorization_event_id FROM output_execution_grants').get().authorization_event_id;
   const body=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(eventId);
   const content={...JSON.parse(body?.private_json??'{}'),output_command_envelope:{sponsor_entitlement:{sponsor_user_id:'owner',copied:true}}};
   f.sqlite.prepare('INSERT INTO event_private_payloads(private_event_id,owner_id,private_json,created_at) VALUES(?,?,?,?) ON CONFLICT(private_event_id) DO UPDATE SET private_json=excluded.private_json').run(eventId,'owner',JSON.stringify(content),new Date().toISOString());
  }
  if(mode==='initial_plan_source_mismatch')f.sqlite.exec("UPDATE output_plan_revisions SET source_digest='other'");
  if(mode==='initial_planner_token_mismatch'){
   const cp=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);cp.providerSubmissions[f.original.planner.attempt.clientRequestId].totalTokens++;
   f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(cp));
  }
  await assert.rejects(authority(f));unobserved(f);noOutput(f);
 }finally{f.close();}
});

test('caller-supplied scope, slot, job, and actor substitutions cannot supply monetary authority',async()=>{
 const f=await videoRecoveryFixture();try{
  for(const args of [
   [f.env,{...f.user,userId:'foreign'},f.scope,f.slot,job(f)],
   [f.env,f.user,{...f.scope,contextId:'copied-context'},f.slot,job(f)],
   [f.env,f.user,{...f.scope,projectId:'other'},f.slot,job(f)],
   [f.env,f.user,f.scope,{...f.slot,costReservationId:'other'},job(f)],
   [f.env,f.user,f.scope,{...f.slot,maximumMicrousd:600001},job(f)],
   [f.env,f.user,f.scope,f.slot,{...job(f),correlation_id:'other'}],
  ])await assert.rejects(capture(...args));
  unobserved(f);noOutput(f);
 }finally{f.close();}
});

for(const kind of ['token','cost'])test(`captured ${kind} reservation cannot be redirected to an otherwise identical replacement row`,async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),table=kind==='token'?'budget_reservations':'cost_budget_reservations';
  const replacement={...f.sqlite.prepare(`SELECT * FROM ${table}`).get(),reservation_id:`replacement:${kind}`},entries=Object.entries(replacement);
  f.sqlite.prepare(`INSERT INTO ${table}(${entries.map(([key])=>key).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,value])=>value));
  f.sqlite.prepare(`UPDATE output_operation_slots SET ${kind==='token'?'token':'cost'}_reservation_id=?`).run(replacement.reservation_id);
  await assert.rejects(record(a,f.env,token));unobserved(f);noOutput(f);
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status<>'active'`).get().n,0);
 }finally{f.close();}
});

test('asynchronous database replacement cannot redirect an already captured financial commit',async()=>{
 const f=await videoRecoveryFixture(),other=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),batch=f.DB.batch;let switched=false,foreignPrepares=0,foreignBatches=0;
  const foreignPrepare=other.DB.prepare,foreignBatch=other.DB.batch;other.DB.prepare=(...args)=>{foreignPrepares++;return foreignPrepare(...args);};other.DB.batch=(...args)=>{foreignBatches++;return foreignBatch(...args);};
  f.DB.batch=async statements=>{const result=await batch(statements);if(!switched&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){switched=true;f.env.DB=other.DB;}return result;};
  await assert.rejects(record(a,f.env,token));assert(switched);assert.equal(foreignPrepares,0);assert.equal(foreignBatches,0);assert.equal(row(f).status,'settled');assert.equal(receipt(f).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');unobserved(other);noOutput(f);noOutput(other);
 }finally{f.env.DB=f.DB;f.close();other.close();}
});

test('fallback rechecks captured original association after transaction failure',async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f),batch=f.DB.batch;let failed=false;
  f.DB.batch=async statements=>{if(!failed&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd='))){failed=true;f.sqlite.exec("UPDATE output_execution_grants SET payer_user_id='foreign'");throw Error('synthetic failure with changed payer');}return batch(statements);};
  await assert.rejects(record(a,f.env,token));assert(failed);unobserved(f);noOutput(f);
 }finally{f.close();}
});

test('nonfinancial checkpoint changes do not substitute for or revoke original monetary identity',async()=>{
 const f=await videoRecoveryFixture();try{
  const a=await authority(f),token=await observation(f);
  f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.diagnostic','preserve-me','$.artifactPlan',json('{}')),request_json='{}',expires_at='2000-01-01T00:00:00.000Z';UPDATE output_execution_grants SET status='revoked',expires_at='2000-01-01T00:00:00.000Z'");
  await record(a,f.env,token);paid(f);noOutput(f);const cp=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
  assert.equal(cp.diagnostic,'preserve-me');assert.deepEqual(cp.artifactPlan,{});assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'revoked');
 }finally{f.close();}
});
