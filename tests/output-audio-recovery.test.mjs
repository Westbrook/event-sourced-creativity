import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const {audioRecoveryFixture}=await import(pathToFileURL(root+'/tests/output-audio-recovery-fixture.mjs'));
const {executeOutputAudioRecovery,withinAudioRecovery,remainingAudioRecoveryUsage}=await import(pathToFileURL(root+'/worker/output-audio-recovery.ts'));
const {appendEvents,makeEvent}=await import(pathToFileURL(root+'/worker/runtime.ts'));
const bytes=new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,0xff,0xfb,0x90,0x64]);
const mediaUrl='https://v3b.fal.media/files/original-audio.mp3';
const key='owner/generated/artifact-audio.mp3';
function mockProvider(t,f,{lyrics='',before}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async (value,init={})=>{
  const url=String(value);assert.equal(init.method??'GET','GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'manual');calls.push(url);await before?.(url);
  init.signal?.throwIfAborted();
  if(url===f.cp.providerStatusUrl+'?logs=1')return Response.json({status:'COMPLETED',request_id:f.cp.providerJobId});
  if(url===f.cp.providerResponseUrl)return Response.json({request_id:f.cp.providerJobId,audio:{url:mediaUrl,content_type:'audio/mpeg',file_size:bytes.length,duration:20},lyrics});
  if(url===mediaUrl){assert.equal(new Headers(init.headers).has('authorization'),false);return new Response(bytes,{headers:{'content-type':'audio/mpeg'}});}
  throw Error('Unexpected provider URL');
 });return calls;
}
const counts=f=>['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'].map(name=>f.sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n);
const run=(f,signal)=>executeOutputAudioRecovery({...f.env,FAL_KEY:'offline-audio-test'},f.user,f.job(),f.binding,{assertions:f.assertions,signal});
test('historical pending validation recovers and replays without a second provider read',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());
 f.cp.providerSubmissions[f.planner.clientRequestId].validationStatus='pending';
 f.cp.plannerInput.validation={provider_response_ids:[f.planner.providerRequestId],provider_call_count:1,repair_attempted:false,repair_response_id:null,initial_issues:[],repair_issues:[],validation_history:[{stage:'initial',provider_attempt:1,issue_count:0,issues:[]}],adapter_reconciliation:{artifact_kind:'audio',adapter_id:'openai-document',final_issue_count:0}};
 f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(f.cp));
 const requests=mockProvider(t,f);assert.equal((await run(f)).status,'completed');assert.equal(requests.length,3);
 const before=f.job().result_json;assert.equal((await run(f)).status,'completed');assert.equal(requests.length,3);assert.equal(f.job().result_json,before);
});

test('Audio advisory offer uses retained source, original call and no successor',async t=>{
 const {outputAudioRecoveryAvailable}=await import('../worker/output-audio-recovery-availability.ts');
 const f=await audioRecoveryFixture();t.after(()=>f.close());
 assert.equal(await outputAudioRecoveryAvailable(f.env,f.scope,f.slot,f.job()),true);
 f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='audio-source'");
 assert.equal(await outputAudioRecoveryAvailable(f.env,f.scope,f.slot,f.job()),false);
 f.sqlite.exec("UPDATE private_content SET redacted_at=NULL WHERE content_id='audio-source';UPDATE output_execution_grants SET status='revoked'");
 assert.equal(await outputAudioRecoveryAvailable(f.env,f.scope,f.slot,f.job()),false);
});

test('deleted Audio storage identity is never revived or overwritten',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());mockProvider(t,f);
 const {ownerMediaNamespace}=await import('../src/model/media-ownership.ts'),storageKey=ownerMediaNamespace('owner')+'/generated/artifact-audio.mp3';
 f.sqlite.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES('scope','slot',?,?,'deleted',1,?,?)").run(storageKey,createHash('sha256').update(bytes).digest('hex'),new Date().toISOString(),new Date().toISOString());
 let puts=0;t.mock.method(f.env.MEDIA,'put',async()=>{puts++;throw Error('unexpected overwrite');});
 await assert.rejects(run(f));assert.equal(puts,0);assert.equal(f.sqlite.prepare('SELECT status FROM output_native_storage_writes').get().status,'deleted');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
});

test('accepted native Audio recovers attempt2 using only original GETs and replays without network or charges',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());const calls=mockProvider(t,f),before=counts(f);
 f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'");
 const result=await run(f);assert.equal(result.status,'completed');assert.equal(f.job().attempt_count,2);assert.equal(f.job().correlation_id,f.jobId+':attempt:2');
 assert.equal(calls.length,3);assert.deepEqual(counts(f),before);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');
 assert.equal(f.sqlite.prepare("SELECT used_microusd FROM output_provider_calls WHERE provider='fal'").get().used_microusd,37600);
 const usage=f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationUsageRecorded'").all(),counters=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all();
 const replay=await run(f);assert.equal(replay.replayed,true);assert.equal(calls.length,3);assert.deepEqual(counts(f),before);assert.deepEqual(f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationUsageRecorded'").all(),usage);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),counters);
});
test('usage recorded under attempt1 is deducted before attempt2 original completion',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());mockProvider(t,f);
 const usage=makeEvent('creative:owner',1,'worker:policy','fixture',f.jobId+':attempt:1','GenerationUsageRecorded',{operation:'document-render:audio:failed-plan',artifact_id:f.cp.artifactId,artifact_kind:'audio',document_id:'doc',reservation_id:f.slot.tokenReservationId,cost_reservation_id:f.slot.costReservationId,input_tokens:100,output_tokens:30,total_tokens:130,cost_microusd:300,planner_response_id:f.planner.providerRequestId,provider_job_id:f.cp.providerJobId});
 await appendEvents(f.env,[usage]);await run(f);
 const rows=f.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='GenerationUsageRecorded' ORDER BY event.sequence").all().map(r=>JSON.parse(r.private_json));
 assert.equal(rows.length,2);assert.equal(rows[1].cost_microusd,37600);assert.equal(rows[1].total_tokens,0);assert.equal(rows.reduce((n,row)=>n+row.cost_microusd,0),37900);
});
test('unexpected lyrics refuse publication but retain known original provider cost',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());const calls=mockProvider(t,f,{lyrics:'Unexpected singing'}),before=counts(f);
 await assert.rejects(run(f),e=>e.code==='output_audio_recovery_result_invalid');assert.equal(calls.length,3);assert.deepEqual(counts(f),before);
 assert.equal(f.job().status,'failed');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.sqlite.prepare("SELECT status FROM output_provider_calls WHERE provider='fal'").get().status,'settled');
});
test('revocation between status and result refuses the next original GET',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());const calls=mockProvider(t,f,{before:url=>{if(url===f.cp.providerStatusUrl+'?logs=1')f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'");}});
 await assert.rejects(run(f));assert.equal(calls.length,1);assert.equal(f.job().status,'failed');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
});
test('existing media owned by another actor is never overwritten',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());mockProvider(t,f);
 const actualKey=(await import(pathToFileURL(root+'/src/model/media-ownership.ts'))).ownerMediaNamespace('owner')+'/generated/artifact-audio.mp3';
 await f.env.MEDIA.put(actualKey,bytes,{httpMetadata:{contentType:'audio/mpeg'},customMetadata:{ownerId:'other',artifactId:'artifact-audio',sha256:createHash('sha256').update(bytes).digest('hex')}});
 await assert.rejects(run(f),e=>e.code==='output_audio_recovery_media_changed');assert.equal((await f.env.MEDIA.head(actualKey)).customMetadata.ownerId,'other');assert.equal(f.job().status,'failed');
});
test('bounded recovery rejects stalled work and aborts the shared adapter signal',async()=>{
 let signal;const started=Date.now();await assert.rejects(withinAudioRecovery(s=>{signal=s;return new Promise(()=>{});},Date.now()+20),/output_audio_recovery_deadline/);assert(signal.aborted);assert(Date.now()-started<1000);
});
test('lost finalization reuses the published exact result without provider GET or duplicate usage',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());const calls=mockProvider(t,f);await run(f);
 const before=f.sqlite.prepare("SELECT event_id FROM events WHERE type IN('GenerationUsageRecorded','DocumentRenderCompleted') ORDER BY sequence").all();
 f.sqlite.exec("UPDATE document_jobs SET status='failed',completed_at=NULL,result_json=json_set(result_json,'$.outputAudioRecovery.expiresAt','2000-01-01T00:00:00.000Z');UPDATE output_operation_slots SET status='failed'");
 assert.equal((await run(f)).status,'completed');assert.equal(calls.length,3);assert.deepEqual(f.sqlite.prepare("SELECT event_id FROM events WHERE type IN('GenerationUsageRecorded','DocumentRenderCompleted') ORDER BY sequence").all(),before);
});
test('interruption after exact settlement can recover without another reservation or charge',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());mockProvider(t,f);const original=f.env.MEDIA.head.bind(f.env.MEDIA);let interrupted=false;
 t.mock.method(f.env.MEDIA,'head',async(...args)=>{if(!interrupted){interrupted=true;throw Error('fixture_after_settlement');}return original(...args);});
 await assert.rejects(run(f),/fixture_after_settlement/);const financial=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),before=counts(f);
 assert.equal((await run(f)).status,'completed');assert.deepEqual(counts(f),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),financial);
});
test('interruption after acknowledged media write reuses the owned bytes without a second put',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());mockProvider(t,f);let puts=0,interrupted=false;const put=f.env.MEDIA.put.bind(f.env.MEDIA),batch=f.env.DB.batch.bind(f.env.DB);
 t.mock.method(f.env.MEDIA,'put',async(...args)=>{puts++;return put(...args);});
 t.mock.method(f.env.DB,'batch',async statements=>{if(puts&&!interrupted&&statements.some(s=>/INSERT INTO private_content\s*\(/u.test(s.sql))){interrupted=true;throw Error('fixture_after_media_ack');}return batch(statements);});
 await assert.rejects(run(f),/fixture_after_media_ack/);assert.equal(f.sqlite.prepare('SELECT write_acknowledged FROM output_native_storage_writes').get().write_acknowledged,1);
 assert.equal((await run(f)).status,'completed');assert.equal(puts,1);
});
for(const [name,change] of [
 ['private input erased',f=>f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE kind='document-artifact-input'")],
 ['original call unsettled',f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE provider='fal'")],
 ['cost reservation amount changed',f=>f.sqlite.exec("UPDATE cost_budget_reservations SET used_microusd=0")],
 ['token reservation amount changed',f=>f.sqlite.exec("UPDATE budget_reservations SET used_tokens=0")],
 ['cost reservation cancelled',f=>f.sqlite.exec("UPDATE cost_budget_reservations SET status='cancelled'")],
 ['token reservation ownership changed',f=>f.sqlite.exec("UPDATE budget_reservations SET owner_id='other'")],
 ['publication acknowledgement erased',f=>f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id=NULL")],
 ['retained bytes changed',async f=>{const {ownerMediaNamespace}=await import(pathToFileURL(root+'/src/model/media-ownership.ts')),key=ownerMediaNamespace('owner')+'/generated/artifact-audio.mp3',old=await f.env.MEDIA.head(key);await f.env.MEDIA.put(key,new Uint8Array(bytes.map(b=>b^1)),{httpMetadata:{contentType:'audio/mpeg'},customMetadata:old.customMetadata});}]
])test('completed replay refuses '+name+' without provider reads',async t=>{
 const f=await audioRecoveryFixture();t.after(()=>f.close());const calls=mockProvider(t,f);await run(f);await change(f);await assert.rejects(run(f));assert.equal(calls.length,3);
});
test('already-aborted recovery never invokes the operation',async()=>{
 const c=new AbortController();c.abort(new Error('cancelled'));let invoked=false;await assert.rejects(withinAudioRecovery(async()=>{invoked=true;},Date.now()+1000,c.signal),/cancelled/);assert.equal(invoked,false);
});
const identity={jobId:'job',attempt:2,ownerId:'owner',documentId:'doc',artifactId:'artifact',tokenId:'token',costId:'cost',providerId:'original'};
const calls=[{operation:'planning',providerRequestId:'response',inputTokens:100,outputTokens:30,totalTokens:130,costMicrousd:300},{operation:'audio',providerRequestId:'original',inputTokens:0,outputTokens:0,totalTokens:0,costMicrousd:37600}];
const prior=()=>({event_id:'event',sequence:1,actor:'worker:policy',correlation_id:'job:attempt:1',owner_id:'owner',document_id:'doc',redacted_at:null,private_json:JSON.stringify({operation:'document-render:audio:failed-plan',artifact_id:'artifact',artifact_kind:'audio',document_id:'doc',reservation_id:'token',cost_reservation_id:'cost',planner_response_id:'response',provider_job_id:'original',input_tokens:100,output_tokens:30,total_tokens:130,cost_microusd:300})});
for(const [name,mutate] of [
 ['wrong actor',r=>r.actor='user:owner'],['wrong owner',r=>r.owner_id='other'],['wrong Document',r=>r.document_id='other'],['redacted',r=>r.redacted_at='now'],['prefix-spoofed correlation',r=>r.correlation_id='job:attempt:1evil'],['later attempt',r=>r.correlation_id='job:attempt:3'],
 ...['reservation_id','cost_reservation_id','planner_response_id','provider_job_id','artifact_id'].map(k=>[k,r=>{const p=JSON.parse(r.private_json);p[k]='other';r.private_json=JSON.stringify(p);}]),
 ['negative cost',r=>{const p=JSON.parse(r.private_json);p.cost_microusd=-1;r.private_json=JSON.stringify(p);}],['over-counted tokens',r=>{const p=JSON.parse(r.private_json);p.total_tokens=131;r.private_json=JSON.stringify(p);}]
])test('original usage rejects '+name,()=>{const row=prior();mutate(row);assert.throws(()=>remainingAudioRecoveryUsage([row],identity,calls));});
test('original usage rejects duplicate event identity and deducts valid prior attempt exactly',()=>{
 assert.deepEqual(remainingAudioRecoveryUsage([prior()],identity,calls),{input_tokens:0,output_tokens:0,total_tokens:0,cost_microusd:37600});assert.throws(()=>remainingAudioRecoveryUsage([prior(),prior()],identity,calls));
});
