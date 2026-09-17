import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
const [{identifySponsorImageRead,requireSponsorImageReadAuthority,resolveSponsorImageRead},{reserveSponsorImageReadAttempt},{appendAuditEvent}]=await Promise.all([
  import('../worker/experience-sponsor-read-image.ts'),import('../worker/experience-sponsor-read-attempts.ts'),import('../worker/runtime.ts'),
]);
const policy=(maximumBytes=32_000_000,deadlineMs=10_000)=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes,deadlineMs}])),
  actor:{maximumRequestsPerWindow:20,maximumBytesPerWindow:640_000_000},campaign:{maximumRequestsPerWindow:40,maximumBytesPerWindow:1_280_000_000}});
async function fixture(t,{terms=policy(),...options}={}){
  const f=await sponsorReadFixture(t,options);await f.installReadPolicy(terms);
  f.identify=async()=>{const request=f.readRequest();return {request,authority:await identifySponsorImageRead(request,f.env,{jobId:f.jobId})};};
  f.reserve=async(operation='image-result')=>{const identified=await f.identify();return {...identified,attempt:await reserveSponsorImageReadAttempt(identified.authority,identified.request,f.env,operation)};};
  f.resolve=async(operation='image-result')=>{const input=await f.reserve(operation);return resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env);};
  return f;
}
const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts ORDER BY rowid').all();
const patchCompletion=(f,patch)=>{const payload={...f.completedPayload,...patch};f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(payload),f.completionEvent.eventId);};

test('opaque resource hint discloses no creative tuple and only exact request/env/DB can reserve it',async t=>{
  const f=await fixture(t),{request,authority}=await f.identify();assert.deepEqual(authority,{});assert.ok(Object.isFrozen(authority));
  const admitted=requireSponsorImageReadAuthority(authority,request,f.env);assert.equal(admitted.jobId,f.jobId);assert.equal(admitted.campaignId,f.campaignId);
  assert.ok(!Object.hasOwn(admitted,'original'));assert.equal(attempts(f).length,0);
  assert.throws(()=>requireSponsorImageReadAuthority({},request,f.env),/authority_unavailable/);
  assert.throws(()=>requireSponsorImageReadAuthority(authority,request.clone(),f.env),/authority_unavailable/);
  assert.throws(()=>requireSponsorImageReadAuthority(authority,request,{...f.env}),/authority_unavailable/);
  f.noReadSideEffects();
});

test('actual native completed Image resolves exact original tuple after one charged current-custody read',async t=>{
  const f=await fixture(t),input=await f.reserve(),result=await resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env);
  assert.equal(result.status,'completed');assert.equal(result.jobId,f.jobId);assert.equal(result.documentId,f.documentId);
  assert.deepEqual(result.original,{representation:'original-generation',outputId:f.completedPayload.object_id,generationId:f.completedPayload.generation_id,
    sourceEventId:f.completionEvent.eventId,contentRef:f.completedPayload.output_ref,mediaUrl:f.completedPayload.media_url,
    mediaKey:decodeURIComponent(f.completedPayload.media_url.slice('/api/media/'.length)),mediaType:'image/png',sha256:f.completedPayload.source_content_hash,
    width:f.completedPayload.image_width,height:f.completedPayload.image_height});
  assert.ok(result.remainingBytes>0&&result.remainingBytes<result.maximumBytes);assert.ok(Object.isFrozen(result.original));
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/attempt_unavailable/);
  assert.equal(attempts(f).length,1);assert.equal(attempts(f)[0].maximum_bytes,32_000_000);f.noReadSideEffects();
});

test('authentic pending status is passive and result/media attempts fail without becoming free retries',async t=>{
  const f=await fixture(t,{completed:false});const status=await f.resolve('image-status');assert.equal(status.status,'queued');assert.equal(status.original,null);
  for(const operation of ['image-result','image-media'])await assert.rejects(f.resolve(operation),/result_not_complete/);
  assert.equal(attempts(f).length,3);assert.deepEqual(f.transport.counts(),{plannerCalls:0,imageCalls:0,safetyCalls:0});f.noReadSideEffects();
});

test('closed lookup rejects forged campaign/payer/media hints and another canonical principal',async t=>{
  const f=await fixture(t);
  for(const extra of [{campaignId:f.campaignId},{payerUserId:f.payer},{mediaUrl:f.completedPayload.media_url},{nowMs:0}])
    await assert.rejects(identifySponsorImageRead(f.readRequest(),f.env,{jobId:f.jobId,...extra}),/request_invalid/);
  await assert.rejects(identifySponsorImageRead(f.readRequest({'oai-authenticated-user-id':f.payer,'oai-authenticated-user-email':`${f.payer}@example.invalid`}),f.env,{jobId:f.jobId}),/original_unavailable/);
  await assert.rejects(identifySponsorImageRead(f.readRequest({cookie:'forma_project_context=selected'}),f.env,{jobId:f.jobId}),/personal_principal_required/);
  assert.equal(attempts(f).length,0);f.noReadSideEffects();
});

for(const [name,change] of [
  ['slot source mismatch',f=>f.sqlite.prepare('UPDATE output_operation_slots SET source_digest=? WHERE job_id=?').run('0'.repeat(64),f.jobId)],
  ['historical source revision mismatch',f=>f.sqlite.prepare('UPDATE output_plan_revisions SET source_head=source_head+1 WHERE document_id=?').run(f.documentId)],
  ['native route mismatch',f=>f.sqlite.prepare('UPDATE output_operation_slots SET route_digest=? WHERE job_id=?').run('0'.repeat(64),f.jobId)],
])test(`bounded original lineage refuses ${name} before any creative history or byte work`,async t=>{
  const f=await fixture(t);change(f);const before=f.snapshotNativeState();
  await assert.rejects(f.identify(),/original_(?:unavailable|changed)/);assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});

test('generation policy switches, approval revocation and expired execution grant do not revoke retained owner reads',async t=>{
  const f=await fixture(t);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0,policy_json=? WHERE campaign_id=?').run('{"version":1,"mode":"disabled"}',f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0').run();
  f.sqlite.prepare('UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1').run();
  f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'").run();
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1').run();
  const before=f.snapshotNativeState();assert.equal((await f.resolve()).original.sourceEventId,f.completionEvent.eventId);f.noReadSideEffects(before);
});

for(const [name,change,pattern] of [
  ['removed Document',f=>appendAuditEvent(f.env,f.stream,'user','DocumentRemoved',{document_id:f.documentId}),/document_unavailable/],
  ['discarded output',f=>appendAuditEvent(f.env,f.stream,'user','ObjectDiscarded',{object_id:f.completedPayload.object_id,document_id:f.documentId}),/output_unavailable/],
  ['redacted completion',f=>f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(new Date().toISOString(),f.completionEvent.eventId),/completion_unavailable/],
  ['foreign completion custody',f=>f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(f.payer,f.completionEvent.eventId),/completion_unavailable/],
  ['wrong private media tuple',f=>patchCompletion(f,{media_url:f.completedPayload.media_url.replace('.png','-other.png')}),/completion_changed/],
  ['contradictory completion Project',f=>patchCompletion(f,{project_id:'other-project'}),/completion_changed/],
  ['retired provider output',f=>f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.completedPayload.output_ref),/current_custody_changed/],
  ['missing native completion receipt',f=>f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.appendedEventIds',json('[]')) WHERE job_id=?").run(f.jobId),/completion_unconfirmed/],
  ['unsettled native slot',f=>f.sqlite.prepare("UPDATE output_operation_slots SET status='running' WHERE job_id=?").run(f.jobId),/completion_unconfirmed/],
  ['unresolved native provider receipt',f=>f.sqlite.prepare('UPDATE output_provider_calls SET used_microusd=NULL WHERE rowid=(SELECT MIN(rowid) FROM output_provider_calls)').run(),/completion_unconfirmed/],
])test(`charged creative read refuses ${name} and cannot reuse its attempt`,async t=>{
  const f=await fixture(t),input=await f.reserve();await change(f);const before=f.snapshotNativeState();
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),pattern);
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/attempt_unavailable/);
  assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});

test('current principal revocation after history traversal is refused by final proof',async t=>{
  const f=await fixture(t),input=await f.reserve(),batch=f.DB.batch.bind(f.DB);let changed=false;
  f.DB.batch=async statements=>{
    if(!changed&&statements.some(statement=>statement.sql.includes("AND EXISTS(SELECT 1 FROM private_content WHERE content_id=?"))){
      changed=true;f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.actor);
    }
    return batch(statements);
  };
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/current_custody_changed/);assert.equal(changed,true);
  assert.equal(attempts(f).length,1);assert.deepEqual(f.readEffects,{fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0});
});

for(const column of ['project_id','document_id'])test(`completion ${column} custody cannot change between original read and witness snapshot`,async t=>{
  const f=await fixture(t),input=await f.reserve(),batch=f.DB.batch.bind(f.DB);let changed=false;
  f.DB.batch=async statements=>{
    if(!changed&&statements.some(statement=>statement.sql.includes('sqlite_schema'))){
      changed=true;f.sqlite.prepare(`UPDATE event_private_payloads SET ${column}=? WHERE private_event_id=?`).run('different-custody',f.completionEvent.eventId);
    }
    return batch(statements);
  };
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/current_custody_changed/);
  assert.equal(changed,true);assert.equal(attempts(f).length,1);assert.deepEqual(f.readEffects,{fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0});
});

test('undersized per-attempt allowance refuses before native expensive history page dispatch',async t=>{
  const f=await fixture(t,{terms:policy(3_000_000)}),input=await f.reserve(),batch=f.DB.batch.bind(f.DB);let pages=0;
  f.DB.batch=async statements=>{pages+=statements.filter(statement=>statement.sql.includes('page AS MATERIALIZED')).length;return batch(statements);};
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/byte_capacity/);
  assert.equal(pages,0);assert.equal(attempts(f)[0].maximum_bytes,3_000_000);f.noReadSideEffects();
});

for(const field of ['status','updated_at','outcome_event_id','sequence','revision'])test(`malformed oversized SQLite ${field} is refused before its unbounded cell is returned`,async t=>{
  const f=await fixture(t),input=await f.reserve();
  if(field==='status')f.sqlite.prepare('UPDATE document_jobs SET status=? WHERE job_id=?').run('s'.repeat(100_000),f.jobId);
  if(field==='updated_at')f.sqlite.prepare('UPDATE document_jobs SET updated_at=? WHERE job_id=?').run('\0'+'u'.repeat(100_000),f.jobId);
  if(field==='outcome_event_id')f.sqlite.prepare('UPDATE output_operation_slots SET outcome_event_id=? WHERE job_id=?').run('\0'+'o'.repeat(100_000),f.jobId);
  if(field==='sequence'){
    const event=f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(f.completionEvent.eventId);
    event.event_id='malformed-sequence';event.sequence='s'.repeat(100_000);event.type='FixtureMalformedSequence';event.payload='{}';
    const columns=Object.keys(event);f.sqlite.prepare(`INSERT INTO events(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>event[key]));
  }
  if(field==='revision'){
    const key='generated-image/'+Buffer.from(f.completedPayload.object_id).toString('hex');
    f.sqlite.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('malformed-revision',f.actor,'project-atmosphere',f.documentId,key,'r'.repeat(5_000_000),'{}','0'.repeat(64),f.actor,new Date().toISOString(),'2099-01-01T00:00:00.000Z');
  }
  const batch=f.DB.batch.bind(f.DB),prepare=f.DB.prepare.bind(f.DB);let maximumReturned=0;
  f.DB.batch=async statements=>{const result=await batch(statements);maximumReturned=Math.max(maximumReturned,Buffer.byteLength(JSON.stringify(result)));return result;};
  f.DB.prepare=sql=>{const statement=prepare(sql);if(!sql.includes('SELECT job.status,job.updated_at'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);
      bound.first=async()=>{const result=await first();maximumReturned=Math.max(maximumReturned,Buffer.byteLength(JSON.stringify(result)));return result;};return bound;};return statement;};
  const before=f.snapshotNativeState();
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),['status','updated_at','outcome_event_id'].includes(field)?/original_unavailable/:/image_witness_(?:unavailable|changed)/);
  assert.ok(maximumReturned<100_000,`Malformed ${field} was returned before validation (${maximumReturned} bytes)`);
  assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});

test('monotonic resolver deadline bounds stalled work even when wall clock moves backward',async t=>{
  const f=await fixture(t,{terms:policy(32_000_000,75)}),input=await f.reserve(),prepare=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{const statement=prepare(sql);if(!sql.includes('SELECT job.status,job.updated_at'))return statement;
    statement.bind=()=>({first:()=>new Promise(()=>{})});return statement;};
  const started=performance.now();t.mock.method(Date,'now',()=>-1_000_000_000_000);
  await assert.rejects(resolveSponsorImageRead(input.authority,input.attempt,input.request,f.env),/sponsor_read_(?:deadline|attempt_unavailable)/);
  assert.ok(performance.now()-started<500);assert.equal(attempts(f).length,1);f.noReadSideEffects();
});
