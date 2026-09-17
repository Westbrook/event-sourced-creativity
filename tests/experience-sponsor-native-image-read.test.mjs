import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
const {beginSponsorNativeImageRead,requireSponsorNativeImageRead,SPONSOR_NATIVE_IMAGE_READ_INDEXES}=await import('../worker/experience-sponsor-native-image-read.ts');

const policy=()=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes:32_000_000,deadlineMs:10_000}])),
  actor:{maximumRequestsPerWindow:3,maximumBytesPerWindow:96_000_000},campaign:{maximumRequestsPerWindow:6,maximumBytesPerWindow:192_000_000}});
const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts ORDER BY rowid').all();
async function fixture(t,{indexes=true,readPolicy=true,...options}={}){
  const f=await sponsorReadFixture(t,options);
  if(indexes)for(const definition of SPONSOR_NATIVE_IMAGE_READ_INDEXES)f.sqlite.exec(definition.sql);
  if(readPolicy)await f.installReadPolicy(policy());
  f.nativeActor={userId:f.actor,streamId:f.stream};f.outputId=f.completedPayload?.object_id;
  f.mediaKey=f.completedPayload?decodeURIComponent(f.completedPayload.media_url.slice('/api/media/'.length)):null;
  f.begin=async(lookup={outputId:f.outputId},request=f.readRequest(),actor=f.nativeActor)=>{
    const context=await beginSponsorNativeImageRead(request,f.env,actor,lookup);return {context,request,actor,lookup};
  };
  return f;
}

function editedLocator(f,{sourceEventId=f.completionEvent.eventId,outputId=f.outputId}={}){
  const mediaKey=`${f.actor}/fixture-image-edit.png`,url=`/api/media/${encodeURIComponent(mediaKey)}`;
  // This row is a synthetic lookup fixture only, not an accepted edit. The
  // helper grants no creative authority; native HTTP tests prove real edits.
  const content=JSON.stringify({kind:'generated-image',schemaVersion:1,origin:{sourceEventId,outputId},imageRevision:{media:{url}}});
  f.sqlite.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,
    revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at) VALUES(?,?,NULL,NULL,?,?,?,1,?,?,?,?,?,NULL)`)
    .run('lookup-revision',f.actor,'project-atmosphere',f.documentId,'lookup-artifact',content,'a'.repeat(64),f.actor,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z');
  return mediaKey;
}

test('exact output and original storage lookups each obtain a fresh immutable budget context without media or full-body reads',async t=>{
  const f=await fixture(t),one=await f.begin(),two=await f.begin({mediaKey:f.mediaKey});
  for(const item of [one,two]){
    const facts=requireSponsorNativeImageRead(item.context,item.request,f.env,item.actor,item.lookup);
    assert.equal(facts.jobId,f.jobId);assert.equal(facts.outputId,f.outputId);assert.equal(facts.sourceEventId,f.completionEvent.eventId);
    assert.equal(facts.provider,'openai');assert.equal(facts.model,f.slot.model);assert.equal(facts.sourceSurface,'outputs');
    assert.equal(facts.projectId,'project-atmosphere');assert.equal(facts.documentId,f.documentId);
    assert.equal(facts.generationId,f.completedPayload.generation_id);assert.equal(facts.contentRef,f.completedPayload.output_ref);
    assert.equal(facts.originalMediaKey,f.mediaKey);assert.equal(facts.originalContentSha256,f.completedPayload.source_content_hash);
    assert.equal(facts.width,f.completedPayload.image_width);assert.equal(facts.height,f.completedPayload.image_height);assert.ok(facts.usedBytes>0&&facts.usedBytes<facts.maximumBytes);
    assert.equal(facts.maximumBytes,32_000_000);assert.ok(facts.monotonicDeadline>performance.now());assert.ok(Object.isFrozen(facts));
    assert.equal(f.sqlite.prepare(`SELECT (${facts.assertion.sql}) AS passed`).get(...facts.assertion.bindings).passed,1);
  }
  assert.deepEqual(attempts(f).map(row=>row.operation),['image-result','image-media']);assert.notEqual(attempts(f)[0].attempt_id,attempts(f)[1].attempt_id);
  f.noReadSideEffects();
});

test('resource context cannot be forged or moved to a different request, actor, environment, database or lookup',async t=>{
  const f=await fixture(t),item=await f.begin();
  for(const [context,request,env,actor,lookup] of [[{...item.context},item.request,f.env,item.actor,item.lookup],
    [item.context,item.request.clone(),f.env,item.actor,item.lookup],[item.context,item.request,{...f.env},item.actor,item.lookup],
    [item.context,item.request,f.env,{...item.actor},item.lookup],[item.context,item.request,f.env,item.actor,{outputId:'other-output'}]]){
    assert.throws(()=>requireSponsorNativeImageRead(context,request,env,actor,lookup),/sponsor_native_read_context_unavailable/);
  }
  f.env.DB={...f.DB};assert.throws(()=>requireSponsorNativeImageRead(item.context,item.request,f.env,item.actor,item.lookup),/context_unavailable/);f.env.DB=f.DB;
  assert.equal(requireSponsorNativeImageRead(item.context,item.request,f.env,item.actor,item.lookup),item.context);
  assert.throws(()=>requireSponsorNativeImageRead(item.context,item.request,f.env,item.actor,item.lookup),/context_unavailable/);f.noReadSideEffects();
});

test('an actor without distinct-payer Image history remains ordinary without the new schemas or indexes',async t=>{
  const f=await fixture(t,{indexes:false,readPolicy:false}),ordinaryActor={userId:f.payer,streamId:`creative:${f.payer}`};
  f.sqlite.exec('DROP TABLE experience_sponsor_read_attempts');f.sqlite.exec('DROP TABLE experience_sponsor_read_policies');
  f.sqlite.exec('PRAGMA foreign_keys=OFF');f.sqlite.exec('DROP TABLE experience_sponsor_consumptions');
  const before=f.snapshotNativeState();
  assert.equal((await f.begin({mediaKey:`${f.payer}/ordinary.png`},f.readRequest(),ordinaryActor)).context,null);
  assert.equal((await f.begin({outputId:'ordinary-output'},f.readRequest(),ordinaryActor)).context,null);f.noReadSideEffects(before);
});

test('sponsored actor cannot bypass missing or counterfeit classification indexes',async t=>{
  const f=await fixture(t,{indexes:false});
  await assert.rejects(f.begin(),/sponsor_native_read_configuration/);
  for(const definition of SPONSOR_NATIVE_IMAGE_READ_INDEXES)f.sqlite.exec(definition.sql);
  f.sqlite.exec('DROP INDEX idx_sponsor_image_output_lookup');f.sqlite.exec('CREATE INDEX idx_sponsor_image_output_lookup ON events(stream_id)');
  await assert.rejects(f.begin({mediaKey:f.mediaKey}),/sponsor_native_read_configuration/);
  assert.equal(attempts(f).length,0);f.noReadSideEffects();
});

test('indexed unrelated ordinary reads survive sponsored actor history and absent read policy',async t=>{
  const f=await fixture(t,{readPolicy:false});
  assert.equal((await f.begin({mediaKey:`${f.actor}/ordinary-upload.png`})).context,null);
  await assert.rejects(f.begin({outputId:'ordinary-output'}),/sponsor_native_read_unavailable/);
  await assert.rejects(f.begin(),/sponsor_read_policy_unavailable/);assert.equal(attempts(f).length,0);f.noReadSideEffects();
});

test('an exact edited-media lookup reaches the original sponsor job using bounded origin identifiers',async t=>{
  const f=await fixture(t),mediaKey=editedLocator(f),before=f.snapshotNativeState(),item=await f.begin({mediaKey});
  assert.equal(item.context.jobId,f.jobId);assert.equal(item.context.outputId,f.outputId);assert.equal(item.context.sourceEventId,f.completionEvent.eventId);
  assert.equal(item.context.operation,'image-media');assert.equal(attempts(f).length,1);
  assert.equal(f.sqlite.prepare(`SELECT (${item.context.assertion.sql}) AS passed`).get(...item.context.assertion.bindings).passed,1);f.noReadSideEffects(before);
});

test('corrupt edited origin cannot become an ordinary read',async t=>{
  const f=await fixture(t),mediaKey=editedLocator(f,{sourceEventId:'missing-event'}),before=f.snapshotNativeState();
  await assert.rejects(f.begin({mediaKey}),/sponsor_native_read_unavailable/);assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});

for(const mutation of ['provider','slot-status','storage-ack','result-membership','oversized-result','unresolved-call'])test(`corrupt sponsored ${mutation} is refused instead of taking the ordinary path`,async t=>{
  const f=await fixture(t);let lookup={outputId:f.outputId};
  if(mutation==='provider')f.sqlite.prepare("UPDATE output_operation_slots SET provider='changed' WHERE job_id=?").run(f.jobId);
  if(mutation==='slot-status')f.sqlite.prepare("UPDATE output_operation_slots SET status='uncertain' WHERE job_id=?").run(f.jobId);
  if(mutation==='storage-ack'){f.sqlite.prepare('UPDATE output_native_storage_writes SET write_acknowledged=0 WHERE storage_key=?').run(f.mediaKey);lookup={mediaKey:f.mediaKey};}
  if(mutation==='result-membership')f.sqlite.prepare("UPDATE document_jobs SET result_json='{}' WHERE job_id=?").run(f.jobId);
  if(mutation==='oversized-result')f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=?').run(JSON.stringify({appendedEventIds:[f.completionEvent.eventId],padding:'a'.repeat(131073)}),f.jobId);
  if(mutation==='unresolved-call')f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain' WHERE scope_key=? AND slot_id=?").run(f.slot.scope_key,f.slot.slot_id);
  const before=f.snapshotNativeState();await assert.rejects(f.begin(lookup),/sponsor_(native_read|read_original)/);
  assert.equal(attempts(f).length,['provider','storage-ack'].includes(mutation)?0:1,'Admitted failed reads retain their debit');f.noReadSideEffects(before);
});

test('final assertion rejects native linkage or completed-job changes after admission',async t=>{
  const f=await fixture(t),item=await f.begin();
  f.sqlite.prepare("UPDATE document_jobs SET result_json='{}' WHERE job_id=?").run(f.jobId);
  const before=f.snapshotNativeState();
  assert.equal(f.sqlite.prepare(`SELECT (${item.context.assertion.sql}) AS passed`).get(...item.context.assertion.bindings).passed,0);
  assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});

test('project context cannot bypass a sponsored resource while ordinary project owners remain ordinary',async t=>{
  const f=await fixture(t),request=f.readRequest({cookie:'forma_project_context=selected'});
  await assert.rejects(f.begin({outputId:f.outputId},request),/sponsor_read_personal_principal_required/);
  const ordinaryActor={userId:f.payer,streamId:`creative:${f.payer}`,projectExecution:{ownerUserId:f.payer}};
  assert.equal((await f.begin({mediaKey:`${f.payer}/ordinary.png`,ownerUserId:f.payer},request,ordinaryActor)).context,null);
  assert.equal(attempts(f).length,0);f.noReadSideEffects();
});

test('server-derived foreign media owner cannot hide a sponsored key behind the caller absence of history',async t=>{
  const f=await fixture(t),actor={userId:f.payer,streamId:`creative:${f.payer}`},request=new Request('http://localhost/api/media/example',{headers:f.payerHeaders});
  await assert.rejects(f.begin({mediaKey:f.mediaKey,ownerUserId:f.actor},request,actor),/sponsor_read_original_unavailable/);
  assert.equal(attempts(f).length,0);f.noReadSideEffects();
});

test('explicit personal media owner normalizes to the same one-use context lookup',async t=>{
  const f=await fixture(t),item=await f.begin({mediaKey:f.mediaKey,ownerUserId:f.actor});
  assert.equal(requireSponsorNativeImageRead(item.context,item.request,f.env,item.actor,{mediaKey:f.mediaKey}),item.context);f.noReadSideEffects();
});

test('missing original storage receipt uses the independent public generation index and refuses after admission',async t=>{
  const f=await fixture(t);f.sqlite.prepare('DELETE FROM output_native_storage_writes WHERE storage_key=?').run(f.mediaKey);
  const before=f.snapshotNativeState();await assert.rejects(f.begin({mediaKey:f.mediaKey}),/sponsor_native_read_unavailable/);
  assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});

test('immutable consumption prevents a changed payer from downgrading a sponsored resource to ordinary',async t=>{
  const f=await fixture(t);f.sqlite.prepare('UPDATE output_execution_grants SET payer_user_id=? WHERE scope_key=? AND grant_id=?').run(f.actor,f.slot.scope_key,f.slot.grant_id);
  const before=f.snapshotNativeState();await assert.rejects(f.begin(),/sponsor_read_original_unavailable/);
  assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});

test('private scalar and native completion checks refuse before dispatch when the approved budget is too small',async t=>{
  const f=await fixture(t,{readPolicy:false}),terms=policy();for(const value of Object.values(terms.operations))value.maximumBytes=100;
  await f.installReadPolicy(terms);const prepare=f.DB.prepare;let privateReads=0;
  f.DB.prepare=sql=>{if(sql.includes("'$.output_ref'")&&sql.includes('FROM event_private_payloads'))privateReads++;return prepare.call(f.DB,sql);};
  try{await assert.rejects(f.begin(),/sponsor_native_read_bytes/);}finally{f.DB.prepare=prepare;}
  assert.equal(privateReads,0);assert.equal(attempts(f).length,1);f.noReadSideEffects();
});

test('owner metadata fallback materializes at most the existing Image history ceiling before joining',async t=>{
  const f=await fixture(t),actor={userId:f.payer,streamId:`creative:${f.payer}`};
  f.sqlite.prepare(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<50001)
    INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at)
    SELECT 'bounded-history-'||n,?,?,'fixture-document','generate','completed','legacy','bounded-correlation-'||n,n,'{}','2026-01-01','2099-01-01','2026-01-01' FROM sequence`)
    .run(actor.userId,actor.streamId);
  const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n;
  await assert.rejects(f.begin({mediaKey:`${f.payer}/ordinary.png`},f.readRequest(),actor),/sponsor_native_read_history_capacity/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,before);assert.equal(attempts(f).length,0);
  assert.deepEqual(f.readEffects,{fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0});
});

for(const scope of ['managed-personal','cross-account-project'])test(`exact ordinary ${scope} storage remains ordinary without dormant indexes`,async t=>{
  const f=await fixture(t,{indexes:false,readPolicy:false});
  // Synthetic ordinary classification fixture: remove the sponsor-only ledger
  // and marker, retaining the actual native storage/job/publication tuple.
  f.sqlite.exec('PRAGMA foreign_keys=OFF');f.sqlite.exec('DROP TABLE experience_sponsor_consumptions');
  f.sqlite.prepare(`UPDATE event_private_payloads SET private_json=json_remove(private_json,'$.output_command_envelope.sponsor_entitlement')
    WHERE private_event_id=(SELECT authorization_event_id FROM output_execution_grants WHERE scope_key=? AND grant_id=?)`).run(f.slot.scope_key,f.slot.grant_id);
  if(scope==='cross-account-project'){
    f.sqlite.prepare("UPDATE output_plan_revisions SET scope_kind='project',organization_id='ordinary-organization',project_access_id='ordinary-project-access' WHERE scope_key=? AND plan_revision_id=?").run(f.slot.scope_key,f.slot.plan_revision_id);
    f.sqlite.prepare("UPDATE output_execution_grants SET actor_user_id=?,context_id='ordinary-project-context' WHERE scope_key=? AND grant_id=?").run(f.payer,f.slot.scope_key,f.slot.grant_id);
    f.sqlite.prepare('UPDATE document_jobs SET owner_id=? WHERE job_id=?').run(f.payer,f.jobId);
  }
  const before=f.snapshotNativeState();assert.equal((await f.begin({mediaKey:f.mediaKey,ownerUserId:f.actor})).context,null);f.noReadSideEffects(before);
});


test('legacy Outputs job without a native slot stays ordinary without sponsor schemas or indexes',async t=>{
  const f=await fixture(t,{indexes:false,readPolicy:false}),actor={userId:f.payer,streamId:`creative:${f.payer}`};
  f.sqlite.exec('PRAGMA foreign_keys=OFF');
  for(const name of ['experience_sponsor_read_attempts','experience_sponsor_read_policies','experience_sponsor_consumptions'])f.sqlite.exec(`DROP TABLE ${name}`);
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at)
    VALUES('ordinary-unslotted-job',?,?,'ordinary-document','generate','completed','outputs','ordinary-unslotted-correlation',1,'{}','2026-01-01','2099-01-01','2026-01-01')`)
    .run(actor.userId,actor.streamId);
  const before=f.snapshotNativeState();
  assert.equal((await f.begin({outputId:'ordinary-unslotted-output'},f.readRequest(),actor)).context,null);
  assert.equal((await f.begin({mediaKey:`${f.payer}/generated/ordinary-unslotted.png`},f.readRequest(),actor)).context,null);
  f.noReadSideEffects(before);
});

test('immutable consumption preserves sponsored classification after the native slot disappears',async t=>{
  const f=await fixture(t);f.sqlite.exec('PRAGMA foreign_keys=OFF');
  f.sqlite.prepare('DELETE FROM output_operation_slots WHERE job_id=?').run(f.jobId);
  const before=f.snapshotNativeState();
  await assert.rejects(f.begin(),/sponsor_native_read_unavailable/);
  await assert.rejects(f.begin({mediaKey:f.mediaKey}),/sponsor_native_read_unavailable/);
  assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});


for(const surface of ['absent','null','studio','outputs'])test(`mixed sponsored history preserves a legacy unslotted Outputs job with ${surface} ordinary completion surface`,async t=>{
  const f=await fixture(t),{appendAuditEvent}=await import('../worker/runtime.ts');
  const outputId='ordinary-mixed-output',generationId='ordinary-mixed-generation',correlation='ordinary-mixed-correlation';
  await appendAuditEvent(f.env,f.stream,'worker:fixture','GenerationCompleted',{
    project_id:'project-atmosphere',document_id:f.documentId,object_id:outputId,generation_id:generationId,
    ...(surface==='absent'?{}:{source_surface:surface==='null'?null:surface}),simulation:false},correlation);
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at)
    VALUES('ordinary-mixed-job',?,?,?,'generate','completed','outputs',?,1,'{}','2026-01-01','2099-01-01','2026-01-01')`)
    .run(f.actor,f.stream,f.documentId,correlation);
  const {ownerMediaNamespace}=await import('../src/model/media-ownership.ts'),before=f.snapshotNativeState();
  assert.equal((await f.begin({outputId})).context,null);
  assert.equal((await f.begin({mediaKey:`${ownerMediaNamespace(f.actor)}/generated/${generationId}.png`})).context,null);
  assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});
