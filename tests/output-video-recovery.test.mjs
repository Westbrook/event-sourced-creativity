import test from 'node:test';
import assert from 'node:assert/strict';
import {videoRecoveryFixture} from './output-video-recovery-fixture.mjs';
const originalFetch=globalThis.fetch;test.after(()=>{globalThis.fetch=originalFetch;});
const transport=f=>async(url,init)=>{
 f.requests.push({url:String(url),method:init?.method??'GET'});
 if(String(url).endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED'});
 if(String(url)==='https://fal.media/original.mp4')return new Response(f.original.bytes,{headers:{'content-type':'video/mp4'}});
 return Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length}});
};
test('failed original Video retrieves once, settles its real reservations and publishes/finalizes atomically',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  const stages=[];
  const result=await f.run(undefined,value=>{stages.push(value);throw Error('diagnostic observer must not change execution');});
  assert.deepEqual(stages,['video_lease','video_replay','video_provider','video_settlement','video_storage','video_publish']);
  assert.equal(result.status,'completed');assert.equal(f.requests.length,3);assert(f.requests.every(r=>r.method==='GET'));
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();assert.equal(job.status,'completed');assert.equal(slot.status,'succeeded');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_jobs').get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,1);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled');
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'completed');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_native_storage_writes WHERE publication_event_id=? AND status='written'").get(slot.outcome_event_id).n,1);
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n;globalThis.fetch=()=>{throw Error('completed replay must not contact provider');};assert.equal((await f.run()).status,'completed');assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 }finally{f.close();}
});

test('pending original retains one status read without settlement, publication, or another provider claim',async()=>{
 const f=await videoRecoveryFixture();let calls=0;globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init.method,'GET');return Response.json({request_id:'video_original',status:'IN_PROGRESS'});};
 try{
  const before=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),result=await f.run();assert.equal(result.status,'pending');assert.equal(calls,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
 }finally{f.close();}
});

test('lost final write acknowledgement reuses the durable original completion and never republishes',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);const batch=f.DB.batch;let lost=false;
 f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted'))){lost=true;throw Error('lost final acknowledgement');}return result;};
 try{
  assert.equal((await f.run()).status,'completed');assert(lost);assert.equal(f.requests.length,3);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed');
 }finally{f.close();}
});

test('an already published original with failed finalization is repaired without GET, new usage, or replacement output',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  await f.run();const completion=f.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentRenderCompleted'").get().event_id;
  // Fault injection models a pre-atomic producer whose output was durable but
  // terminal update failed. It does not stand in for initial admission.
  f.sqlite.exec("UPDATE document_jobs SET status='failed',error_message='post_publication_failure';UPDATE output_operation_slots SET status='failed'");
  const events=f.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,budget=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all();
  globalThis.fetch=()=>{throw Error('published recovery must not contact provider');};
  assert.equal((await f.run()).status,'completed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,events);
  assert.equal(f.sqlite.prepare('SELECT outcome_event_id FROM output_operation_slots').get().outcome_event_id,completion);assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),budget);
 }finally{f.close();}
});

test('publication rollback leaves paid evidence intact and cannot fabricate a completed job',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);const batch=f.DB.batch;
 f.DB.batch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted')))throw Error('publication rolled back');return batch(statements);};
 try{
  await assert.rejects(f.run(),/publication rolled back/);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_provider_calls WHERE status='settled'").get().n,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes WHERE publication_event_id IS NOT NULL').get().n,0);
 }finally{f.close();}
});

async function retainedUnpublishedVideo(f){
 const batch=f.DB.batch;
 f.DB.batch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted')))throw Error('retained before publication');return batch(statements);};
 try{await assert.rejects(f.run(),/retained before publication/);}finally{f.DB.batch=batch;}
 return f.sqlite.prepare('SELECT * FROM output_native_storage_writes').get();
}

test('Video recovery reuses exact acknowledged unpublished original bytes without another storage PUT or paid call',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  const receipt=await retainedUnpublishedVideo(f);assert.equal(receipt.status,'written');assert.equal(receipt.write_acknowledged,1);
  const budgets=f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all();
  f.env.MEDIA.put=()=>{throw Error('must reuse original bytes without PUT');};
  assert.equal((await f.run()).status,'completed');assert(f.requests.every(r=>r.method==='GET'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes').get().n,1);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_counters ORDER BY scope').all(),budgets);
 }finally{f.close();}
});

for(const mutation of ['deleted','cleanup_pending','writing','ack','published','hash','owner','artifact','native_slot','bytes','cleanup_during_read','cancel_during_read'])test(`Video storage adoption refuses ${mutation} without overwrite or completion`,async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  const receipt=await retainedUnpublishedVideo(f),item=f.media.get(receipt.storage_key);
  if(['deleted','cleanup_pending','writing'].includes(mutation))f.sqlite.prepare('UPDATE output_native_storage_writes SET status=?').run(mutation);
  if(mutation==='ack')f.sqlite.exec('UPDATE output_native_storage_writes SET write_acknowledged=0');
  if(mutation==='published')f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id=(SELECT event_id FROM events LIMIT 1)");
  if(mutation==='hash')f.sqlite.exec("UPDATE output_native_storage_writes SET content_sha256='changed'");
  if(mutation==='owner')item.metadata.ownerId='foreign';
  if(mutation==='artifact')item.metadata.artifactId='foreign';
  if(mutation==='native_slot')item.metadata.outputSlotId='foreign';
  if(mutation==='bytes')item.bytes[0]^=1;
  if(mutation.endsWith('during_read')){
   const get=f.env.MEDIA.get.bind(f.env.MEDIA);let reads=0;
   f.env.MEDIA.get=async key=>{const value=await get(key);if(++reads===2){
    if(mutation==='cleanup_during_read')f.sqlite.exec("UPDATE output_native_storage_writes SET status='cleanup_pending'");
    else f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
   }return value;};
  }
  f.env.MEDIA.put=()=>{throw Error('unsafe overwrite');};
  await assert.rejects(f.run());
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
 }finally{f.close();}
});

for(const stalled of ['get','stream'])test(`Video adoption aborts stalled ${stalled} without overwriting or publishing`,async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  const receipt=await retainedUnpublishedVideo(f),controller=new AbortController(),get=f.env.MEDIA.get.bind(f.env.MEDIA);let reads=0,canceled=false,release;
  f.env.MEDIA.put=()=>{throw Error('must not PUT');};
  f.env.MEDIA.get=async key=>{
   const value=await get(key);if(++reads!==2)return value;
   value.body=new ReadableStream({cancel(){canceled=true;}});
   queueMicrotask(()=>controller.abort(Error('test storage abort')));
   return stalled==='get'?new Promise(resolve=>{release=()=>resolve(value);}):value;
  };
  await assert.rejects(f.run(controller.signal),/test storage abort/);
  release?.();await new Promise(resolve=>setImmediate(resolve));assert(canceled);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_native_storage_writes WHERE storage_key=?').get(receipt.storage_key).status,'written');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
 }finally{f.close();}
});

for(const mutation of ['cancel','source','abort'])test(`recovery refuses ${mutation} during the media read without publication or another paid call`,async()=>{
 const f=await videoRecoveryFixture(),controller=new AbortController();f.requests=[];
 f.sqlite.exec('CREATE TABLE recovery_source(current INTEGER);INSERT INTO recovery_source VALUES(1)');
 f.assertions.push({sql:'(SELECT current FROM recovery_source)=1'});
 const read=transport(f);globalThis.fetch=async(url,init)=>{
  const response=await read(url,init);
  if(String(url)==='https://fal.media/original.mp4'){
   if(mutation==='cancel')f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
   if(mutation==='source')f.sqlite.exec('UPDATE recovery_source SET current=0');
   if(mutation==='abort')controller.abort();
  }return response;
 };
 try{
  await assert.rejects(f.run(controller.signal));assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
 }finally{f.close();}
});

test('concurrent usage invalidates final publication instead of counting original costs twice',async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);const batch=f.DB.batch;let changed=false;
 const {appendAuditEvent}=await import('../worker/runtime.ts');
 f.DB.batch=async statements=>{
  if(!changed&&statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted'))){
   changed=true;await appendAuditEvent(f.env,f.job.stream_id,'worker:policy','GenerationUsageRecorded',{document_id:f.job.document_id,operation:'document-render:video',input_tokens:100,output_tokens:30,total_tokens:130,cost_microusd:300},f.job.correlation_id);
  }return batch(statements);
 };
 try{
  await assert.rejects(f.run());assert(changed);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='GenerationUsageRecorded'").get().n,1);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
 }finally{f.close();}
});

for(const condition of ['live','revoked','lease_expired','stopped','foreign_key'])test(`unpublished recovery storage cleanup: ${condition}`,async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);const batch=f.DB.batch;let checked=false;
 const {reconcileOutputNativeStorage}=await import('../worker/output-private-execution.ts');
 f.DB.batch=async statements=>{
  if(!checked&&statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted'))){
   checked=true;f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'");
   if(condition==='revoked')f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'");
   if(condition==='lease_expired')f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoRecovery.expiresAt','2000-01-01T00:00:00.000Z')");
   if(condition==='stopped')f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoStop',json('{}'))");
   if(condition==='foreign_key')f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoRecovery.storageKey','foreign.mp4')");
   await reconcileOutputNativeStorage(f.env,{ownerUserId:'owner',personalOnly:true});
   assert.equal(f.sqlite.prepare('SELECT status FROM output_native_storage_writes').get().status,condition==='live'?'written':'deleted');
   throw Error('cleanup control checkpoint');
  }return batch(statements);
 };
 try{await assert.rejects(f.run());assert(checked);}finally{f.close();}
});

for(const terminal of ['completed','failed'])for(const mutation of ['redact','delete','replace','expiry','owner','kind','project'])test(`retained ${terminal} recovery refuses artifact ${mutation} during media verification`,async()=>{
 const f=await videoRecoveryFixture();f.requests=[];globalThis.fetch=transport(f);
 try{
  await f.run();if(terminal==='failed')f.sqlite.exec("UPDATE document_jobs SET status='failed',error_message='post_publication_failure';UPDATE output_operation_slots SET status='failed'");
  const completion=f.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").get();
  const contentId=JSON.parse(completion.private_json).content_ref,get=f.env.MEDIA.get.bind(f.env.MEDIA);let changed=false;
  f.env.MEDIA.get=async(...args)=>{const value=await get(...args);if(!changed){changed=true;
   if(mutation==='redact')f.sqlite.prepare("UPDATE private_content SET redacted_at='2020-01-01' WHERE content_id=?").run(contentId);
   if(mutation==='delete')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(contentId);
   if(mutation==='replace')f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(contentId);
   if(mutation==='expiry')f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(contentId);
   if(mutation==='owner')f.sqlite.prepare("UPDATE private_content SET owner_id='foreign' WHERE content_id=?").run(contentId);
   if(mutation==='kind')f.sqlite.prepare("UPDATE private_content SET kind='prompt' WHERE content_id=?").run(contentId);
   if(mutation==='project')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('access','content',?,'organization','project','owner','owner',?)").run(contentId,new Date().toISOString());
  }return value;};
  globalThis.fetch=()=>{throw Error('retained recovery must not contact provider');};await assert.rejects(f.run());assert(changed);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,terminal);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,1);
 }finally{f.close();}
});
