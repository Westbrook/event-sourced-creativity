import assert from 'node:assert/strict';
import test from 'node:test';
import {videoEvidenceFixture} from './output-video-completion-fixture.mjs';
const {outputAssertionStatements}=await import('../worker/output-requirements-ledger.ts');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});

test('actual private envelopes, two settled calls and measured MP4 survive real terminal SQL and original readback',async()=>{
 const f=await videoEvidenceFixture();try{
  const result=await f.verify();assert.equal(result.receipt.providerCallCount,2);assert.equal(result.receipt.media.width,854);assert.equal(result.receipt.media.height,480);assert.equal(result.receipt.media.durationSeconds,4);assert.equal(result.receipt.media.audioTracks,0);assert.equal(result.receipt.visualReview,'required');
  await f.env.DB.batch(result.assertions.flatMap(a=>outputAssertionStatements(f.env,a)));
  await f.finish();assert.equal(f.job.status,'completed');assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'completed');
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n,retained=await f.read();assert.deepEqual(retained.receipt,result.receipt);assert.deepEqual(retained.bytes,f.bytes);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
  await assert.rejects(f.verify(),/output_video_completion_invalid/,'Completed readback never restores dispatch authority');
 }finally{f.sqlite.close();}
});
test('changed original claims, source, plan, receipts or MP4 withdraw completion',async()=>{
 const changes=[
 f=>f.sqlite.exec("UPDATE output_operation_slots SET source_digest='other'"),
 f=>f.sqlite.exec("UPDATE document_jobs SET status='canceled'"),
 f=>f.sqlite.exec("UPDATE document_jobs SET attempt_count=2"),
 f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain' WHERE provider='fal'"),
 f=>f.sqlite.exec("UPDATE output_provider_calls SET request_digest='other' WHERE provider='openai'"),
 f=>f.sqlite.exec("UPDATE output_provider_calls SET used_microusd=0 WHERE provider='fal'"),
 f=>f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE kind='provider-response'"),
 f=>{f.cp.artifactPlan.title='changed';f.persist();},
 f=>{delete f.cp.outputVideoPlannerEnvelope;f.persist();},
 f=>{f.cp.outputVideoMediaEnvelopes.reverse();f.persist();},
 f=>{f.cp.outputVideoMediaResult.providerRequestId='other';f.persist();},
 f=>{f.cp.providerSubmissions[f.planner.attempt.clientRequestId].inputTokens++;f.persist();},
 f=>{f.cp.providerSubmissions.extra={...f.cp.providerSubmissions[f.mediaAttempt.clientRequestId],clientRequestId:'extra'};f.persist();},
 f=>{f.media.get(f.stored.key).metadata.ownerId='other';},
 f=>{f.media.get(f.stored.key).bytes[100]^=1;},
 f=>{f.controller.abort(Error('cancelled'));},
 ];
 for(const change of changes){const f=await videoEvidenceFixture();try{change(f);await assert.rejects(f.verify(),undefined,String(change));}finally{f.sqlite.close();}}
});
test('post-verification cancellation, receipt changes and private erasure fail the final SQL witness',async()=>{
 for(const change of [f=>f.sqlite.exec("UPDATE document_jobs SET status='canceled'"),f=>{f.cp.providerSubmissionLegacyUncertain=true;f.persist();},f=>f.sqlite.exec("UPDATE private_content SET redacted_at='now'"),f=>{f.cp.providerSubmissions[f.mediaAttempt.clientRequestId].costMicrousd++;f.persist();}]){
  const f=await videoEvidenceFixture();try{const result=await f.verify();change(f);await assert.rejects(f.env.DB.batch(result.assertions.flatMap(a=>outputAssertionStatements(f.env,a))),/CHECK constraint/);}finally{f.sqlite.close();}
 }
});
test('failed terminal retains original private evidence but never qualifies as completed output',async()=>{
 const f=await videoEvidenceFixture();try{await f.finish('failed');const cp=JSON.parse(f.job.result_json);assert.deepEqual(cp.outputVideoMediaEnvelopes,f.cp.outputVideoMediaEnvelopes);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'failed');await assert.rejects(f.read());}finally{f.sqlite.close();}
});

test('actual Video publication binds the verified clip and preserves only published native storage',async()=>{
 const {guardOutputPrivateWrites,reconcileOutputNativeStorage}=await import('../worker/output-private-execution.ts');
 const cases=[
  ['original',()=>{}],['unverified',()=>{},false],
  ['foreign-owner',p=>{p.requested_by_user_id='foreign';}],
  ['changed-receipt',p=>{p.settings.output_video.media.sha256='a'.repeat(64);}],
  ['missing-item',p=>{p.items=[];}],['extra-item',p=>{p.items.push({...p.items[0]});}],
  ['foreign-item',p=>{p.items[0].media_url='/api/media/foreign';}],
  ['foreign-item-id',p=>{p.items[0].id='foreign';}],
  ['wrong-item-type',p=>{p.items[0].media_type='video/webm';}],
  ['wrong-source-hash',p=>{p.settings.source_media_sha256='a'.repeat(64);}],
  ['wrong-artifact',p=>{p.artifact_id='foreign';}],
 ];
 for(const [name,mutate,verified=true] of cases){
  const f=await videoEvidenceFixture();try{
   f.sqlite.exec(`ALTER TABLE events ADD COLUMN actor TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'plan';
    ALTER TABLE output_operation_slots ADD COLUMN target_id TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN target_contract_digest TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN provider TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN model TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN attempt_ordinal INTEGER;
    ALTER TABLE output_operation_slots ADD COLUMN previous_slot_id TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN token_reservation_id TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN cost_reservation_id TEXT;
    ALTER TABLE output_operation_slots ADD COLUMN maximum_calls INTEGER;
    ALTER TABLE output_operation_slots ADD COLUMN maximum_tokens INTEGER;
    ALTER TABLE output_provider_calls ADD COLUMN reserved_microusd INTEGER;
    ALTER TABLE output_execution_grants ADD COLUMN actor_user_id TEXT DEFAULT 'owner';
    ALTER TABLE output_execution_grants ADD COLUMN payer_user_id TEXT DEFAULT 'owner';
    ALTER TABLE output_execution_grants ADD COLUMN context_id TEXT;
    ALTER TABLE output_execution_grants ADD COLUMN expires_at TEXT DEFAULT '2000-01-01T00:00:00.000Z';
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,redacted_at TEXT,document_id TEXT);
    CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
    INSERT INTO output_plan_revisions VALUES('scope','plan','owner','doc',NULL,NULL,'personal');
    ALTER TABLE output_plan_revisions ADD COLUMN confirmed_event_id TEXT;
    ALTER TABLE output_plan_revisions ADD COLUMN project_id TEXT;
    ALTER TABLE output_plan_revisions ADD COLUMN source_digest TEXT;`);
   let receiptJson;
   const result=await f.verify(),guarded=guardOutputPrivateWrites(f.env,f.scope,f.slot,async()=>result.assertions,{videoCompletionJson:()=>receiptJson});
   for(const [key,object] of [...f.media])await guarded.MEDIA.put(key,object.bytes,{customMetadata:object.metadata,httpMetadata:{contentType:object.contentType}});
   if(verified)receiptJson=JSON.stringify(result.receipt);
   const m=result.receipt.media;
   const payload={document_id:'doc',artifact_kind:'video',artifact_id:f.artifactId,source_surface:'outputs',requested_by_user_id:'owner',
    settings:{output_video:structuredClone(result.receipt),source_media_sha256:m.sha256},item_count:1,media_url:m.mediaUrl,media_type:m.mediaType,provider_job_id:m.providerRequestId,
    items:[{id:f.artifactId+'-item-1',media_url:m.mediaUrl,media_type:m.mediaType}]};
   mutate(payload);
   await guarded.DB.batch([
    guarded.DB.prepare("INSERT INTO events(event_id,stream_id,type,payload,correlation_id,actor,sequence) VALUES('completion','creative:owner','DocumentRenderCompleted','{}','corr','worker:renderer',1)"),
    guarded.DB.prepare("INSERT INTO event_private_payloads VALUES('completion','owner',?,NULL,'doc')").bind(JSON.stringify(payload)),
   ]);
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_native_storage_writes WHERE publication_event_id='completion'").get().n,name==='original'?1:0,name);
   await reconcileOutputNativeStorage(f.env,{ownerUserId:'owner',personalOnly:true});
   assert.equal(f.media.size,name==='original'?1:0,name);
  }finally{f.sqlite.close();}
 }
});
