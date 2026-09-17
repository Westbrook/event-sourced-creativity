import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture as nativeFixture,defaultIoPolicy,finances,attempts,statements,observe,approveIo} from './sponsor-story-read-fixture.mjs';
import {fixture as driverFixture,transport} from './sponsor-story-driver-fixture.mjs';
const [{identifySponsorStoryRead},{reserveSponsorStoryIoAttempt,SPONSOR_STORY_IO_ATTEMPT_SCHEMA},
  {resolveSponsorStoryStatus,sponsorStoryStatusResponse},{driveSponsoredStory},
  {SPONSOR_STORY_IO_POLICY_SCHEMA},{SPONSOR_STORY_IO_APPROVAL_SCHEMA}]=await Promise.all([
  import('../worker/experience-sponsor-story-read.ts'),import('../worker/experience-sponsor-story-io-attempts.ts'),
  import('../worker/experience-sponsor-story-status.ts'),import('../worker/experience-sponsor-story-driver.ts'),
  import('../worker/experience-sponsor-story-io-policy.ts'),import('../worker/experience-sponsor-story-io-approval.ts'),
]);
const finalBatch=entry=>entry.kind==='batch'&&entry.statements[0]?.sql.includes('expected_events AS')&&entry.statements[0]?.sql.includes('THEN 1 ELSE 0 END AS current');
const wireBytes=value=>Buffer.byteLength(JSON.stringify(value));
// Explicit disposable-DB corruption only. Preserve native append-only behavior
// everywhere else; these cases probe refusal of already-corrupt stored facts.
function corruptEvent(f,sql,...bindings){
  f.sqlite.exec('DROP TRIGGER events_block_update');
  f.sqlite.prepare(sql).run(...bindings);
}

function attach(t,f){
  const before=finances(f),calls=f.calls.length;let egress=0,media=0;
  t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('Passive status cannot contact providers');});
  for(const operation of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,operation,()=>{media++;throw Error('Passive status cannot read media');});
  f.statusRequest=({signal}={})=>new Request(`https://forma.test/__fixture/story-status/${f.jobId}`,{headers:f.actorHeaders,...(signal?{signal}:{})});
  f.reserve=async(operation='short-story-status',request=f.statusRequest())=>{const authority=await identifySponsorStoryRead(request,f.env,{jobId:f.jobId});
    return {request,authority,attempt:await reserveSponsorStoryIoAttempt(authority,request,f.env,operation)};};
  f.resolve=(reserved,extra=0)=>resolveSponsorStoryStatus(reserved.authority,reserved.attempt,reserved.request,f.env,extra);
  f.status=async()=>{const reserved=await f.reserve();return {...reserved,status:await f.resolve(reserved)};};
  f.passive=()=>{assert.deepEqual(finances(f),before);assert.equal(f.calls.length,calls);assert.equal(egress,0);assert.equal(media,0);};
  return f;
}
async function fixture(t,options){return attach(t,await nativeFixture(t,options));}

// Pause the actual C driver immediately after its real queued/claimed atomic
// transaction. No status, slot, grant, provider call or provenance row is forged.
async function pausedFixture(t,status){
  const calls=transport(t),f=await driverFixture(t),batch=f.DB.batch.bind(f.DB),controller=new AbortController();let paused=false;
  f.DB.batch=async statements=>{const result=await batch(statements);
    const match=status==='queued'?"UPDATE output_operation_slots SET status='queued'":"UPDATE document_jobs SET status='running',attempt_count=attempt_count+1";
    if(!paused&&statements.some(statement=>statement.sql.includes(match))){paused=true;controller.abort();throw Error('fixture paused native Story');}
    return result;
  };
  await assert.rejects(driveSponsoredStory(new Request(f.request(),{signal:controller.signal}),f.env,f.context));
  f.DB.batch=batch;assert.equal(paused,true);assert.equal(calls.length,0);
  const job=f.sqlite.prepare('SELECT job_id,status FROM document_jobs').get();assert.equal(job.status,status);
  Object.assign(f,{jobId:job.job_id,calls,ioPolicy:defaultIoPolicy()});
  for(const schema of [SPONSOR_STORY_IO_POLICY_SCHEMA,SPONSOR_STORY_IO_APPROVAL_SCHEMA,SPONSOR_STORY_IO_ATTEMPT_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  await approveIo(f);f.observer=observe(f);t.after(()=>f.observer.restore());return attach(t,f);
}

test('completed native Story status is passive, exact, finite and source-free with one final proof batch',async t=>{
  const f=await fixture(t,{strict:true}),reserved=await f.reserve(),status=await f.resolve(reserved,117);
  assert.equal(status.jobId,f.jobId);assert.equal(status.documentId,f.documentId);assert.equal(status.status,'completed');
  assert.equal(status.updatedAt,f.job.updated_at);assert.ok(Object.isFrozen(status));
  assert.ok(status.remainingBytes>0&&status.remainingBytes<f.ioPolicy.operations['short-story-status'].maximumBytes-117);
  const last=f.observer.trace.at(-1);assert.ok(finalBatch(last));assert.ok(last.statements.length>4);
  assert.ok(last.statements.some(statement=>statement.sql.includes('experience_sponsor_story_io_attempts')));
  assert.ok(last.statements.some(statement=>statement.sql.includes('status_candidate AS MATERIALIZED')));
  const returned=JSON.stringify(f.observer.trace.map(entry=>entry.result));
  assert.ok(!returned.includes(f.sourceText));assert.ok(!returned.includes('Mira carried the clock home'));
  const sql=statements(f.observer).map(statement=>statement.sql).join('\n');
  assert.doesNotMatch(sql,/\b(?:private_content|result_json|request_json)\b/u);
  const beforeReads=f.observer.trace.length;
  const response=JSON.parse(await new Response(sponsorStoryStatusResponse(status,reserved.request,f.env,'job')).text());
  assert.deepEqual(response,{job:{jobId:f.jobId,documentId:f.documentId,kind:'render_document',sourceSurface:'outputs',status:'completed',
    updatedAt:f.job.updated_at,result:null,sponsoredRead:{version:1,operation:'short-story-status',passive:true}}});
  assert.equal(f.observer.trace.length,beforeReads);assert.equal(attempts(f).length,1);f.passive();f.limits.assertVerified();
  t.diagnostic(JSON.stringify({strictStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),
    remainingBytes:status.remainingBytes,providerRequestsDuringReads:0,mediaOperations:0}));
});

for(const status of ['queued','running'])test(`actual C ${status} job is observed without activation, provider access or settlement`,async t=>{
  const f=await pausedFixture(t,status),value=await f.status();assert.equal(value.status.status,status);
  const json=JSON.parse(await new Response(sponsorStoryStatusResponse(value.status,value.request,f.env,'jobs')).text());
  assert.equal(json.jobs.length,1);assert.equal(json.jobs[0].status,status);assert.equal(json.jobs[0].result,null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,0);f.passive();
});

test('status after native edit and remove/restore uses current history without reading result bytes',async t=>{
  const f=await fixture(t);await f.edit('Locally edited retained Story.');
  await f.append('DocumentRemoved',{});await f.append('DocumentRestored',{});f.observer.clear();
  const value=await f.status();assert.equal(value.status.status,'completed');f.passive();
});

for(const [name,mutate] of [
  ['removed Document',async f=>f.append('DocumentRemoved',{})],
  ['replacement project',f=>corruptEvent(f,"UPDATE events SET payload=json_set(payload,'$.project_id','other-project') WHERE type='DocumentCreated' AND json_extract(payload,'$.document_id')=?",f.documentId)],
  ['completion wrong owner',f=>corruptEvent(f,"UPDATE events SET payload=json_set(payload,'$.requested_by_user_id','other-owner') WHERE event_id=?",f.slot.outcome_event_id)],
  ['completion correlation changed',f=>corruptEvent(f,"UPDATE events SET correlation_id='other-correlation' WHERE event_id=?",f.slot.outcome_event_id)],
  ['completion sidecar redacted',f=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(f.slot.outcome_event_id)],
  ['completed slot still running',f=>f.sqlite.exec("UPDATE output_operation_slots SET status='running'")],
  ['completed grant active',f=>f.sqlite.exec("UPDATE output_execution_grants SET status='active'")],
  ['unsettled native call',f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL")],
  ['expired status metadata',f=>f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'")],
])test(`${name} cannot return successful sponsored status`,async t=>{
  const f=await fixture(t),reserved=await f.reserve();await mutate(f);
  await assert.rejects(f.resolve(reserved));assert.equal(attempts(f).length,1);
  assert.equal(f.calls.length,1);
});

for(const [name,mutate] of [
  ['job status',f=>f.sqlite.exec("UPDATE document_jobs SET status='failed'")],
  ['history removal',f=>f.append('DocumentRemoved',{})],
  ['call settlement',f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL")],
  ['actor consent',f=>f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor)],
])test(`final same-transaction proof refuses late ${name} change`,async t=>{
  const f=await fixture(t),reserved=await f.reserve();let changed=false;
  f.observer.before=async entry=>{if(finalBatch(entry)){await mutate(f);changed=true;}};
  await assert.rejects(f.resolve(reserved),/sponsor_story_status_final_changed/);assert.equal(changed,true);assert.equal(attempts(f).length,1);assert.equal(f.calls.length,1);
});

test('result-operation ticket cannot be converted to status, and attempts cannot be reused',async t=>{
  const f=await fixture(t),wrong=await f.reserve('short-story-result');
  await assert.rejects(f.resolve(wrong),/operation_invalid/);await assert.rejects(f.resolve(wrong),/attempt_unavailable/);
  const right=await f.reserve();await f.resolve(right);await assert.rejects(f.resolve(right),/attempt_unavailable/);f.passive();
});

test('response context cannot be cloned, rebound, replayed or used after request cancellation',async t=>{
  const f=await fixture(t),first=await f.status();
  assert.throws(()=>sponsorStoryStatusResponse({...first.status},first.request,f.env,'job'),/response_invalid/);
  assert.throws(()=>sponsorStoryStatusResponse(first.status,first.request.clone(),f.env,'job'),/response_invalid/);
  assert.throws(()=>sponsorStoryStatusResponse(first.status,first.request,{...f.env},'job'),/response_invalid/);
  assert.throws(()=>sponsorStoryStatusResponse(first.status,first.request,f.env,'unbounded'),/response_invalid/);
  await new Response(sponsorStoryStatusResponse(first.status,first.request,f.env,'job')).text();
  assert.throws(()=>sponsorStoryStatusResponse(first.status,first.request,f.env,'job'),/response_invalid/);
  const controller=new AbortController(),reserved=await f.reserve('short-story-status',f.statusRequest({signal:controller.signal}));
  const status=await f.resolve(reserved),body=sponsorStoryStatusResponse(status,reserved.request,f.env,'job');controller.abort();
  await assert.rejects(new Response(body).text());f.passive();
});

test('actual core and IO bytes plus added dispatcher controls exhaust small attempts before native reads',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.operations['short-story-status'].maximumBytes=8192;
  const f=await fixture(t,{ioPolicy}),reserved=await f.reserve();f.observer.clear();
  await assert.rejects(f.resolve(reserved),/byte_capacity/);
  assert.ok(!statements(f.observer).some(statement=>statement.sql.includes('candidate AS MATERIALIZED')));f.passive();
  const larger=await fixture(t),fresh=await larger.reserve();
  await assert.rejects(larger.resolve(fresh,larger.ioPolicy.operations['short-story-status'].maximumBytes),/byte_capacity/);larger.passive();
});

for(const invalid of [-1,NaN,Infinity,0.5,'0'])test(`invalid additive control byte count ${String(invalid)} cannot reduce the budget`,async t=>{
  const f=await fixture(t),reserved=await f.reserve();await assert.rejects(f.resolve(reserved,invalid),/byte_capacity/);f.passive();
});

test('status metadata and escaped event transport consume positive measured bytes',async t=>{
  const f=await fixture(t),reserved=await f.reserve();f.observer.clear();
  const status=await f.resolve(reserved),received=f.observer.trace.reduce((sum,entry)=>sum+wireBytes(entry.result),0);
  assert.ok(received>0);assert.ok(f.ioPolicy.operations['short-story-status'].maximumBytes-status.remainingBytes>=received);
  const metadata=f.observer.trace.find(entry=>entry.kind==='all'&&entry.sql.includes('status_candidate AS MATERIALIZED'));
  assert.ok(metadata&&wireBytes(metadata.result)>0);f.passive();
});

for(const fault of ['missing result','missing success','false witness','sparse guard'])test(`incomplete final acknowledgment (${fault}) cannot mint a status response`,async t=>{
  const f=await fixture(t),reserved=await f.reserve();let changed=false;
  f.observer.after=(entry,result)=>{if(finalBatch(entry)){
    changed=true;
    if(fault==='missing result')result.pop();
    else if(fault==='missing success')delete result[0].success;
    // Preserve the real executed transaction and its reported array length.
    // Only acknowledgment transport loses one scalar guard result.
    else if(fault==='sparse guard'){const length=result.length;delete result[1];assert.equal(result.length,length);assert.equal(1 in result,false);}
    else result[0].results[0].current=0;
  }};
  await assert.rejects(f.resolve(reserved),/sponsor_story_status_final_changed/);assert.equal(changed,true);
  await assert.rejects(f.resolve(reserved),/attempt_unavailable/);f.passive();
});

for(const change of ['database','cancellation'])test(`late ${change} after final DB proof withholds the opaque response`,async t=>{
  const f=await fixture(t),controller=new AbortController(),reserved=await f.reserve('short-story-status',f.statusRequest({signal:controller.signal}));
  const original=f.env.DB;let changed=false,replacementReads=0;
  f.observer.after=entry=>{if(finalBatch(entry)){
    changed=true;
    if(change==='cancellation')controller.abort();
    else f.env.DB={prepare(){replacementReads++;throw Error('replacement DB cannot be used');}};
  }};
  await assert.rejects(f.resolve(reserved),change==='database'?/sponsor_story_read_authority_unavailable/:/sponsor_story_read_(?:authority_unavailable|deadline)/);
  f.env.DB=original;assert.equal(changed,true);assert.equal(replacementReads,0);f.passive();
});

test('a suspended status metadata read ends at its original approved deadline without dispatching final proof',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.operations['short-story-status'].deadlineMs=1000;
  const f=await fixture(t,{ioPolicy}),reserved=await f.reserve();let suspended=false;
  f.observer.before=entry=>{if(entry.kind==='all'&&entry.sql.includes('status_candidate AS MATERIALIZED')){
    suspended=true;return new Promise(()=>{});
  }};
  await assert.rejects(f.resolve(reserved),/sponsor_story_read_deadline/);
  assert.equal(suspended,true);assert.ok(!f.observer.trace.some(finalBatch));f.passive();
});
