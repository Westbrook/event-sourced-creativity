import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture as nativeFixture,defaultIoPolicy,finances,attempts} from './sponsor-story-read-fixture.mjs';
const [{identifySponsorStoryRead,requireSponsorStoryReadAuthority},{reserveSponsorStoryIoAttempt,takeSponsorStoryIoAttempt,SponsorStoryIoLimitError}]=await Promise.all([
  import('../worker/experience-sponsor-story-read.ts'),import('../worker/experience-sponsor-story-io-attempts.ts'),
]);
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const now=f=>f.sqlite.prepare(`SELECT ${clock} AS n`).get().n;
const guardCount=f=>f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_story_io_assertions').get().n;
async function fixture(t,options={}){
  const f=await nativeFixture(t,options),before=finances(f),providerCalls=f.calls.length;
  f.identify=async(request=f.readRequest())=>({request,authority:await identifySponsorStoryRead(request,f.env,{jobId:f.jobId})});
  f.reserve=async(operation='short-story-status',identity)=>{const identified=identity??await f.identify();return {...identified,attempt:await reserveSponsorStoryIoAttempt(identified.authority,identified.request,f.env,operation)};};
  f.take=value=>takeSponsorStoryIoAttempt(value.attempt,value.authority,value.request,f.env);
  f.noSideEffects=()=>{assert.deepEqual(finances(f),before);assert.equal(f.calls.length,providerCalls);assert.equal(guardCount(f),0);};
  return f;
}
// Explicit synthetic historical IO receipts exercise quota dimensions only.
// No caller-supplied row, clock or policy is accepted by the production boundary.
function seed(f,{id=crypto.randomUUID(),actor=f.actor,jobId=f.jobId,policyDigest=f.sponsorPolicyDigest,operation='short-story-status',bytes=100,
  admittedAt=now(f)-1000,deadlineMs=10000,windowMs=f.ioPolicy.windowMs}={}){
  const policy=f.sqlite.prepare('SELECT io_policy_digest FROM experience_sponsor_story_io_policies WHERE campaign_id=? AND sponsor_policy_digest=?').get(f.campaignId,f.sponsorPolicyDigest);
  f.sqlite.prepare(`INSERT INTO experience_sponsor_story_io_attempts(attempt_id,campaign_id,sponsor_policy_digest,io_policy_digest,
    actor_user_id,job_id,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,f.campaignId,policyDigest,policy.io_policy_digest,actor,jobId,operation,bytes,admittedAt,admittedAt+deadlineMs,admittedAt+deadlineMs+windowMs);
}
const debit=entry=>entry.kind==='batch'&&entry.statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_story_io_attempts('));
const taking=entry=>entry.kind==='batch'&&entry.statements.at(-1)?.sql===`SELECT ${clock} AS now_ms`;

test('genuine Story lineage and IO payer approval reserve immutable full-ceiling receipts and one-use tickets under strict SQL limits',async t=>{
  const f=await fixture(t,{strict:true}),identity=await f.identify(),native=requireSponsorStoryReadAuthority(identity.authority,identity.request,f.env);
  f.observer.clear();
  const first=await f.reserve('short-story-status',identity),before=attempts(f),ticket=await f.take(first);
  const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  assert.deepEqual(f.observer.trace.map(entry=>entry.kind),['first','first','batch','batch']);
  assert.equal(ticket.controlBytes,native.controlBytes+f.observer.trace.reduce((sum,entry)=>sum+byteLength(entry.result),0),
    'account exact approval rows and full debit/take D1 result envelopes, including success and metadata');
  assert.ok(f.observer.trace.filter(entry=>entry.kind==='batch').every(entry=>byteLength(entry.result)>byteLength(entry.result.map(row=>row.results))));
  assert.equal(ticket.operation,'short-story-status');assert.equal(ticket.maximumBytes,f.ioPolicy.operations['short-story-status'].maximumBytes);
  assert.ok(Object.isFrozen(ticket)&&Object.isFrozen(ticket.assertions));assert.ok(ticket.controlBytes>native.controlBytes&&Number.isSafeInteger(ticket.controlBytes));
  assert.ok(ticket.remainingMs>0&&ticket.remainingMs<=30000);assert.ok(ticket.monotonicDeadline<=performance.now()+30000);
  for(const proof of ticket.assertions)assert.equal(f.sqlite.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).get(...proof.bindings).current,1);
  await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);assert.deepEqual(attempts(f),before);
  await f.reserve('short-story-result');const retained=attempts(f);assert.equal(retained.length,2);assert.notEqual(retained[0].attempt_id,retained[1].attempt_id);
  for(const row of retained){assert.equal(row.maximum_bytes,2097152);assert.equal(row.deadline_at_ms-row.admitted_at_ms,30000);assert.equal(row.charged_through_ms-row.deadline_at_ms,60000);}
  assert.throws(()=>f.sqlite.exec('UPDATE experience_sponsor_story_io_attempts SET maximum_bytes=1'),/immutable/);
  assert.throws(()=>f.sqlite.exec('DELETE FROM experience_sponsor_story_io_attempts'),/immutable/);
  assert.throws(()=>f.sqlite.exec('INSERT OR REPLACE INTO experience_sponsor_story_io_attempts SELECT * FROM experience_sponsor_story_io_attempts LIMIT 1'),/exists/);
  f.limits.assertVerified();f.noSideEffects();t.diagnostic(JSON.stringify({strictStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),controlBytes:ticket.controlBytes,actualProviderRequests:0}));
});

test('missing IO approval, unknown operation and forged native authority create no IO debit',async t=>{
  const f=await fixture(t,{approved:false}),identity=await f.identify();
  await assert.rejects(f.reserve('short-story-status',identity),/sponsor_story_io_policy_unavailable/);
  for(const operation of ['image-status','short-story-intake','short-story-export',null,{},undefined])await assert.rejects(reserveSponsorStoryIoAttempt(identity.authority,identity.request,f.env,operation),/sponsor_story_io_operation_invalid/);
  for(const authority of [{},structuredClone(identity.authority)])await assert.rejects(reserveSponsorStoryIoAttempt(authority,identity.request,f.env,'short-story-status'),/sponsor_story_read_authority_unavailable/);
  assert.equal(attempts(f).length,0);f.noSideEffects();
});

test('one-use ticket binds exact Request, authority, environment and database',async t=>{
  const f=await fixture(t),first=await f.reserve(),second=await f.identify(),before=attempts(f);
  for(const [attempt,authority,request,env] of [[{},first.authority,first.request,f.env],[structuredClone(first.attempt),first.authority,first.request,f.env],
    [first.attempt,second.authority,first.request,f.env],[first.attempt,first.authority,first.request.clone(),f.env],[first.attempt,first.authority,first.request,{...f.env}]])
    await assert.rejects(takeSponsorStoryIoAttempt(attempt,authority,request,env),/sponsor_story_io_attempt_unavailable/);
  f.env.DB={...f.DB};await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);f.env.DB=f.DB;
  const results=await Promise.allSettled([f.take(first),f.take(first)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);assert.deepEqual(attempts(f),before);f.noSideEffects();
});

test('simultaneous stale Story requests share one atomic allowance across both operations',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=2;
  const f=await fixture(t,{ioPolicy}),identities=await Promise.all(Array.from({length:6},()=>f.identify()));
  const results=await Promise.allSettled(identities.map((identity,index)=>f.reserve(index%2?'short-story-result':'short-story-status',identity)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,2);assert.equal(attempts(f).length,2);
  for(const result of results.filter(result=>result.status==='rejected')){assert.ok(result.reason instanceof SponsorStoryIoLimitError);assert.ok(result.reason.retryAfterMs>0&&result.reason.retryAfterMs<=90000);}
  f.noSideEffects();
});

for(const scope of ['actor','campaign'])for(const dimension of ['requests','bytes'])test(`Story ${scope} ${dimension} cap includes other jobs, operations and historical policy versions`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.operations={'short-story-status':{maximumBytes:1000,deadlineMs:10000},'short-story-result':{maximumBytes:2000,deadlineMs:10000}};
  ioPolicy.actor={maximumRequestsPerWindow:2,maximumBytesPerWindow:3000};ioPolicy.campaign={maximumRequestsPerWindow:scope==='actor'?6:2,maximumBytesPerWindow:scope==='actor'?9000:3000};
  const f=await fixture(t,{ioPolicy}),old=`sha256:${'a'.repeat(64)}`,policy=f.sqlite.prepare('SELECT * FROM experience_sponsor_story_io_policies').get();
  f.sqlite.prepare('INSERT INTO experience_sponsor_story_io_policies VALUES(?,?,?,?,?)').run(f.campaignId,old,policy.io_policy_digest,policy.policy_json,policy.review_receipt_digest);
  const actor=scope==='actor'?f.actor:'another-canonical-actor';
  if(dimension==='requests')for(let index=0;index<2;index++)seed(f,{actor,jobId:`historical-${index}`,policyDigest:old,operation:'short-story-result',bytes:1000});
  else seed(f,{actor,jobId:'historical-story',policyDigest:old,operation:'short-story-result',bytes:3000});
  const before=attempts(f);await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);assert.deepEqual(attempts(f),before);f.noSideEffects();
});

test('historical IO stays charged through deadline plus window and ages by DB time without receipt mutation',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const f=await fixture(t,{ioPolicy}),time=now(f);seed(f,{admittedAt:time-70000,deadlineMs:30000});const before=attempts(f);
  assert.ok(before[0].admitted_at_ms+ioPolicy.windowMs<time&&before[0].charged_through_ms>time);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);assert.deepEqual(attempts(f),before);f.noSideEffects();
  const aged=await fixture(t,{ioPolicy});seed(aged,{admittedAt:now(aged)-100000,deadlineMs:30000});const old=attempts(aged)[0];
  t.mock.method(Date,'now',()=>1);await aged.reserve();assert.equal(attempts(aged).length,2);assert.deepEqual(attempts(aged).find(row=>row.attempt_id===old.attempt_id),old);aged.noSideEffects();
});

for(const fault of ['lost acknowledgment','zero changes'])test(`${fault} cannot grant a reusable ticket or refund committed Story IO`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const f=await fixture(t,{ioPolicy});let reached=false;
  f.observer.after=(entry,result)=>{if(debit(entry)){reached=true;if(fault==='lost acknowledgment')throw Error('lost IO acknowledgement');const index=entry.statements.findIndex(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_story_io_attempts('));result[index]={...result[index],meta:{...result[index].meta,changes:0}};}};
  await assert.rejects(f.reserve(),fault==='lost acknowledgment'?/lost IO acknowledgement/:/sponsor_story_io_(?:limit_reached|attempt_unavailable)/);
  f.observer.after=null;assert.equal(reached,true);assert.equal(attempts(f).length,1);const before=attempts(f);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);assert.deepEqual(attempts(f),before);f.noSideEffects();
});

for(const phase of ['reserve','take'])test(`missing ${phase} batch acknowledgment cannot grant a Story IO ticket or refund its charge`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const f=await fixture(t,{ioPolicy}),first=phase==='take'?await f.reserve():null;let reached=false;
  f.observer.after=(entry,result)=>{if(phase==='reserve'?debit(entry):taking(entry)){
    reached=true;assert.equal(result.length,entry.statements.length);assert.equal(result[0].success,true);
    delete result[0];assert.equal(result.length,entry.statements.length);assert.equal(Object.hasOwn(result,0),false);
  }};
  await assert.rejects(phase==='take'?f.take(first):f.reserve(),/sponsor_story_io_(?:limit_reached|attempt_unavailable)/);
  f.observer.after=null;assert.equal(reached,true);assert.equal(attempts(f).length,1);const before=attempts(f);
  if(first)await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);
  assert.deepEqual(attempts(f),before);f.noSideEffects();
});

for(const phase of ['reserve','take'])for(const shape of ['missing row','array row'])test(`malformed ${phase} proof receipt (${shape}) refuses disclosure without refund`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const f=await fixture(t,{ioPolicy}),first=phase==='take'?await f.reserve():null;let reached=false;
  f.observer.after=(entry,result)=>{if(phase==='reserve'?debit(entry):taking(entry)){
    reached=true;const rows=result[phase==='reserve'?result.length-1:0].results;assert.equal(rows.length,1);
    if(shape==='missing row')delete rows[0];else rows[0]=Object.assign([],rows[0]);
    assert.equal(rows.length,1);
  }};
  await assert.rejects(phase==='take'?f.take(first):f.reserve(),/sponsor_story_io_(?:limit_reached|attempt_unavailable)/);
  f.observer.after=null;assert.equal(reached,true);assert.equal(attempts(f).length,1);const before=attempts(f);
  if(first)await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);
  assert.deepEqual(attempts(f),before);f.noSideEffects();
});

const inheritedAckCases=[
  ...['reserve','take'].flatMap(phase=>['success','results'].map(field=>({phase,label:`envelope ${field}`,
    row:(_entry,result)=>result[0],field}))),
  {phase:'take',label:'proof current',row:(_entry,result)=>result[0].results[0],field:'current'},
  {phase:'take',label:'clock now_ms',row:(_entry,result)=>result.at(-1).results[0],field:'now_ms'},
  ...['attempt_id','campaign_id','sponsor_policy_digest','io_policy_digest','actor_user_id','job_id','operation','maximum_bytes',
    'admitted_at_ms','deadline_at_ms','charged_through_ms'].map(field=>({phase:'reserve',label:`receipt ${field}`,
    row:(_entry,result)=>result.at(-1).results[0],field})),
  ...['meta','changes'].map(field=>({phase:'reserve',label:`debit ${field}`,field,row:(entry,result)=>{
    const envelope=result[entry.statements.findIndex(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_story_io_attempts('))];
    return field==='meta'?envelope:envelope.meta;
  }})),
];
for(const {phase,label,row,field} of inheritedAckCases)test(`inherited Story IO ${phase} ${label} refuses acceptance without refund`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const f=await fixture(t,{ioPolicy}),first=phase==='take'?await f.reserve():null;let reached=false;
  f.observer.after=(entry,result)=>{if(phase==='reserve'?debit(entry):taking(entry)){
    reached=true;const target=row(entry,result);assert.equal(Object.hasOwn(target,field),true);const value=target[field];
    delete target[field];Object.setPrototypeOf(target,{[field]:value});
    assert.equal(Object.hasOwn(target,field),false);assert.equal(target[field],value);
  }};
  await assert.rejects(phase==='take'?f.take(first):f.reserve(),/sponsor_story_io_(?:limit_reached|attempt_unavailable)/);
  f.observer.after=null;assert.equal(reached,true);assert.equal(attempts(f).length,1);const before=attempts(f);
  if(first)await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);
  assert.deepEqual(attempts(f),before);f.noSideEffects();
});

for(const {phase,shape,field} of [{phase:'reserve',shape:'non-enumerable',field:'attempt_id'},{phase:'take',shape:'accessor',field:'current'}])
  test(`non-data Story IO ${phase} ${shape} field refuses acceptance without refund`,async t=>{
    const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
    const f=await fixture(t,{ioPolicy}),first=phase==='take'?await f.reserve():null;let reached=false;
    f.observer.after=(entry,result)=>{if(phase==='reserve'?debit(entry):taking(entry)){
      reached=true;const target=result[phase==='reserve'?result.length-1:0].results[0],value=target[field];
      Object.defineProperty(target,field,shape==='non-enumerable'?{value,enumerable:false}:{get:()=>value,enumerable:true});
      assert.equal(Object.hasOwn(target,field),true);assert.equal(target[field],value);
    }};
    await assert.rejects(phase==='take'?f.take(first):f.reserve(),/sponsor_story_io_(?:limit_reached|attempt_unavailable)/);
    f.observer.after=null;assert.equal(reached,true);assert.equal(attempts(f).length,1);const before=attempts(f);
    if(first)await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);
    await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);
    assert.deepEqual(attempts(f),before);f.noSideEffects();
  });

test('duplicate server UUID never reuses an old Story IO receipt as a new ticket',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;const f=await fixture(t,{ioPolicy});
  t.mock.method(crypto,'randomUUID',()=> '00000000-0000-4000-8000-000000000001');await f.reserve();const before=attempts(f);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorStoryIoLimitError);assert.deepEqual(attempts(f),before);f.noSideEffects();
});

for(const predicate of ['0','NULL'])test(`actual atomic Story guard ${predicate} rolls back temporary witnesses and leaves no attempt`,async t=>{
  const f=await fixture(t),identity=await f.identify(),prepare=f.DB.prepare;let changed=false;
  f.DB.prepare=function(sql){if(!changed&&sql.startsWith('INSERT INTO experience_sponsor_story_io_assertions(')){changed=true;sql=sql.replace('CASE WHEN (',`CASE WHEN ((${predicate}) AND (`).replace(') THEN 1 ELSE 0 END)', ')) THEN 1 ELSE 0 END)');}return prepare.call(this,sql);};
  try{await assert.rejects(f.reserve('short-story-status',identity),/CHECK constraint failed/);}finally{f.DB.prepare=prepare;}
  assert.equal(changed,true);assert.equal(attempts(f).length,0);f.noSideEffects();
});

test('late native owner change refuses reservation atomically; a later take refusal keeps its existing debit',async t=>{
  const f=await fixture(t),first=await f.reserve(),identity=await f.identify();let changed=false;
  f.observer.before=entry=>{if(debit(entry)){changed=true;f.sqlite.prepare("UPDATE users SET email='changed-owner@example.invalid' WHERE user_id=?").run(f.actor);}};
  await assert.rejects(f.reserve('short-story-result',identity),/CHECK constraint failed/);f.observer.before=null;
  assert.equal(changed,true);await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);assert.equal(attempts(f).length,1);f.noSideEffects();
});

for(const phase of ['approval','debit','take'])test(`DB replacement during Story IO ${phase} refuses without rebinding authority`,async t=>{
  const f=await fixture(t),identity=await f.identify(),first=phase==='take'?await f.reserve('short-story-status',identity):null,foreign={...f.DB};let reached=false;
  f.observer.after=entry=>{if(phase==='approval'&&entry.sql?.includes('FROM experience_sponsor_story_io_policies policy')||phase==='debit'&&debit(entry)||phase==='take'&&taking(entry)){reached=true;f.env.DB=foreign;}};
  try{await assert.rejects(phase==='take'?f.take(first):f.reserve('short-story-status',identity),/sponsor_story_(?:io|read).*?(?:changed|unavailable)/);}finally{f.env.DB=f.DB;f.observer.after=null;}
  assert.equal(reached,true);assert.equal(attempts(f).length,phase==='approval'?0:1);f.noSideEffects();
});

test('aborted take remains charged and expired tickets cannot be revived by wall-clock rollback',async t=>{
  const f=await fixture(t),controller=new AbortController(),identity=await f.identify(f.readRequest(f.selection(),{signal:controller.signal})),first=await f.reserve('short-story-status',identity),before=attempts(f);
  controller.abort();await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);assert.deepEqual(attempts(f),before);f.noSideEffects();
  const ioPolicy=defaultIoPolicy();ioPolicy.operations['short-story-status'].deadlineMs=30;const expiring=await fixture(t,{ioPolicy}),attempt=await expiring.reserve();
  await new Promise(resolve=>setTimeout(resolve,40));t.mock.method(Date,'now',()=>1);
  await assert.rejects(expiring.take(attempt),/sponsor_story_io_attempt_unavailable/);assert.equal(attempts(expiring).length,1);expiring.noSideEffects();
});

for(const phase of ['debit','take'])test(`stalled Story IO ${phase} is bounded and a late commit never creates a ticket or refund`,async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.operations['short-story-status'].deadlineMs=100;
  const f=await fixture(t,{ioPolicy}),identity=await f.identify(),first=phase==='take'?await f.reserve('short-story-status',identity):null;
  const batch=f.DB.batch;let resume,reached=false;
  f.DB.batch=async function(statements){const match=phase==='debit'?statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_story_io_attempts(')):statements.at(-1)?.sql===`SELECT ${clock} AS now_ms`;
    if(match){reached=true;await new Promise(resolve=>{resume=resolve;});}return batch.call(this,statements);};
  const started=performance.now();await assert.rejects(phase==='take'?f.take(first):f.reserve('short-story-status',identity),/sponsor_story_io_attempt_unavailable/);
  assert.equal(reached,true);assert.ok(performance.now()-started<1000);resume();await new Promise(resolve=>setTimeout(resolve,10));f.DB.batch=batch;
  assert.equal(attempts(f).length,1);if(first)await assert.rejects(f.take(first),/sponsor_story_io_attempt_unavailable/);f.noSideEffects();
});

test('request abort interrupts an unresolved IO approval lookup before any debit',async t=>{
  const f=await fixture(t),controller=new AbortController(),identity=await f.identify(f.readRequest(f.selection(),{signal:controller.signal}));let reached=false,release;
  f.observer.before=async entry=>{if(!reached&&entry.sql?.includes('FROM experience_sponsor_story_io_policies policy')){reached=true;await new Promise(resolve=>{release=resolve;});}};
  const pending=f.reserve('short-story-status',identity);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(reached,true);controller.abort();
  await assert.rejects(pending,/sponsor_story_io_(?:attempt_unavailable|authority_changed)/);release();await new Promise(resolve=>setTimeout(resolve,10));f.observer.before=null;
  assert.equal(attempts(f).length,0);f.noSideEffects();
});

test('generation revocation and expiry do not remove an owned Story original IO allocation',async t=>{
  const f=await fixture(t),identity=await f.identify();
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0,policy_digest=?,policy_json=? WHERE campaign_id=?').run(`sha256:${'f'.repeat(64)}`,'{}',f.campaignId);
  f.sqlite.exec('UPDATE experience_sponsor_resource_policies SET enabled=0');
  f.sqlite.exec('UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1');
  f.sqlite.prepare("UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?").run(f.campaignId);
  const reserved=await f.reserve('short-story-status',identity),ticket=await f.take(reserved);
  assert.equal(ticket.operation,'short-story-status');assert.equal(attempts(f).length,1);f.noSideEffects();
});
