import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
const [{identifySponsorImageRead},{reserveSponsorImageReadAttempt,takeSponsorImageReadAttempt,SponsorReadLimitError},{canonicalJson,digest}]=await Promise.all([
  import('../worker/experience-sponsor-read-image.ts'),import('../worker/experience-sponsor-read-attempts.ts'),import('../src/experiences/compiler.ts'),
]);

const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const policy=()=>({version:1,windowMs:60_000,
  operations:{'image-status':{maximumBytes:100,deadlineMs:10_000},'image-result':{maximumBytes:200,deadlineMs:10_000},'image-media':{maximumBytes:1000,deadlineMs:30_000}},
  actor:{maximumRequestsPerWindow:10,maximumBytesPerWindow:3000},campaign:{maximumRequestsPerWindow:20,maximumBytesPerWindow:6000}});
const rows=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts ORDER BY rowid').all();
const now=f=>f.sqlite.prepare(`SELECT ${clock} AS now`).get().now;
async function fixture(t,{terms=policy(),install=true,...options}={}){
  const f=await sponsorReadFixture(t,{completed:false,...options});
  if(install)f.readPolicy=await f.installReadPolicy(terms);
  f.identify=async(request=f.readRequest())=>({request,authority:await identifySponsorImageRead(request,f.env,{jobId:f.jobId})});
  f.reserve=async(operation='image-status',identity)=>{
    const identified=identity??await f.identify();return {...identified,attempt:await reserveSponsorImageReadAttempt(identified.authority,identified.request,f.env,operation)};
  };
  return f;
}

// Synthetic historical debits are deliberately installed as fixture rows;
// runtime reservation accepts no row, attempt identity, actor or caller clock.
function seed(f,{attemptId=crypto.randomUUID(),actor=f.actor,jobId=f.jobId,sponsorPolicyDigest=f.sponsorPolicyDigest,
  operation='image-status',bytes=100,admittedAt=now(f)-1000,deadlineMs=10_000,windowMs=60_000}={}){
  f.sqlite.prepare(`INSERT INTO experience_sponsor_read_attempts(attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,
    actor_user_id,job_id,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(attemptId,f.campaignId,sponsorPolicyDigest,f.readPolicy.readPolicyDigest,actor,jobId,operation,bytes,admittedAt,admittedAt+deadlineMs,admittedAt+deadlineMs+windowMs);
}

test('each request reserves the full reviewed operation ceiling with a fresh database-timed immutable receipt',async t=>{
  const f=await fixture(t),before=now(f),first=await f.reserve('image-status');
  const ticket=await takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env);
  assert.equal(ticket.operation,'image-status');assert.equal(ticket.maximumBytes,100);assert.ok(Object.isFrozen(ticket));
  assert.ok(Number.isSafeInteger(ticket.remainingMs)&&ticket.remainingMs>0&&ticket.remainingMs<=10_000);
  await f.reserve('image-result');const retained=rows(f);assert.equal(retained.length,2);assert.notEqual(retained[0].attempt_id,retained[1].attempt_id);
  assert.deepEqual(retained.map(row=>row.maximum_bytes),[100,200]);
  for(const row of retained){assert.ok(row.admitted_at_ms>=before&&row.admitted_at_ms<=now(f));assert.equal(row.deadline_at_ms-row.admitted_at_ms,10_000);assert.equal(row.charged_through_ms-row.deadline_at_ms,60_000);}
  assert.equal(f.sqlite.prepare(`SELECT (${ticket.assertion.sql}) AS passed`).get(...ticket.assertion.bindings).passed,1);
  assert.throws(()=>f.sqlite.exec('UPDATE experience_sponsor_read_attempts SET maximum_bytes=1'),/immutable/);
  assert.throws(()=>f.sqlite.exec('DELETE FROM experience_sponsor_read_attempts'),/immutable/);
  assert.throws(()=>f.sqlite.exec('INSERT OR REPLACE INTO experience_sponsor_read_attempts SELECT * FROM experience_sponsor_read_attempts LIMIT 1'),/exists/);
  assert.throws(()=>seed(f,{attemptId:retained[0].attempt_id}),/exists/);f.noReadSideEffects();
});

test('missing or corrupt reviewed stored policy fails closed without accepting caller limits',async t=>{
  const f=await fixture(t,{install:false}),identified=await f.identify();
  await assert.rejects(reserveSponsorImageReadAttempt(identified.authority,identified.request,f.env,'image-status'),/sponsor_read_policy_unavailable/);
  const raw=policy(),sponsorDigest=f.sponsorPolicyDigest;
  f.sqlite.prepare('INSERT INTO experience_sponsor_read_policies VALUES(?,?,?,?,?)')
    .run(f.campaignId,sponsorDigest,`sha256:${'0'.repeat(64)}`,canonicalJson(raw),await digest({synthetic:'review'}));
  await assert.rejects(reserveSponsorImageReadAttempt(identified.authority,identified.request,f.env,'image-status'),/sponsor_read_policy_unavailable/);
  for(const invalid of ['upload','image-edit',{},null,undefined])await assert.rejects(reserveSponsorImageReadAttempt(identified.authority,identified.request,f.env,invalid),/sponsor_read_operation_invalid/);
  assert.equal(rows(f).length,0);f.noReadSideEffects();
});

test('oversized stored policy JSON is bounded by UTF-8 bytes before SQLite returns the cell',async t=>{
  const f=await fixture(t,{install:false}),identity=await f.identify(),oversized='梨'.repeat(3000);
  assert.ok(oversized.length<8192&&new TextEncoder().encode(oversized).length>8192);
  f.sqlite.prepare('INSERT INTO experience_sponsor_read_policies VALUES(?,?,?,?,?)')
    .run(f.campaignId,f.sponsorPolicyDigest,`sha256:${'0'.repeat(64)}`,oversized,await digest({synthetic:'review'}));
  const prepare=f.DB.prepare;let returned=false;
  f.DB.prepare=sql=>{
    const statement=prepare.call(f.DB,sql);
    if(!sql.includes('FROM experience_sponsor_read_policies WHERE'))return statement;
    return {bind(...bindings){const bound=statement.bind(...bindings);return {async first(){
      const row=await bound.first();assert.equal(row.policy_json,null);returned=true;return row;
    }};}};
  };
  try {await assert.rejects(f.reserve('image-status',identity),/sponsor_read_policy_unavailable/);}
  finally {f.DB.prepare=prepare;}
  assert.equal(returned,true);assert.equal(rows(f).length,0);f.noReadSideEffects();
});

test('simultaneous stale contenders share one atomic actor request allowance across operation aliases',async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=2;const f=await fixture(t,{terms}),identity=await f.identify();
  const outcomes=await Promise.allSettled(['image-status','image-result','image-status','image-result','image-status','image-result'].map(operation=>f.reserve(operation,identity)));
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,2);assert.equal(rows(f).length,2);
  for(const item of outcomes.filter(item=>item.status==='rejected')){assert.ok(item.reason instanceof SponsorReadLimitError);assert.ok(item.reason.retryAfterMs>0&&item.reason.retryAfterMs<=90_000);}
  f.noReadSideEffects();
});

for(const scope of ['actor','campaign'])for(const dimension of ['requests','bytes'])test(`${scope} ${dimension} allowance counts other jobs, operations and historical policy versions`,async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=2;terms.campaign.maximumRequestsPerWindow=scope==='actor'?6:2;
  terms.actor.maximumBytesPerWindow=1000;terms.campaign.maximumBytesPerWindow=scope==='actor'?3000:1000;
  const f=await fixture(t,{terms}),oldDigest=`sha256:${'a'.repeat(64)}`;
  f.sqlite.prepare('INSERT INTO experience_sponsor_read_policies VALUES(?,?,?,?,?)')
    .run(f.campaignId,oldDigest,f.readPolicy.readPolicyDigest,f.readPolicy.policyJson,f.readPolicy.reviewReceiptDigest);
  const actor=scope==='actor'?f.actor:'another-canonical-actor';
  if(dimension==='requests')for(let i=0;i<2;i++)seed(f,{actor,jobId:`historical-${i}`,sponsorPolicyDigest:oldDigest,operation:'image-result',bytes:200});
  else seed(f,{actor,jobId:'historical-media',sponsorPolicyDigest:oldDigest,operation:'image-media',bytes:1000});
  await assert.rejects(f.reserve(),error=>error instanceof SponsorReadLimitError);assert.equal(rows(f).length,dimension==='requests'?2:1);f.noReadSideEffects();
});

test('abandoned and failed reads keep their full debit beyond admission plus window until deadline plus window',async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=1;const f=await fixture(t,{terms});
  seed(f,{operation:'image-media',bytes:1000,admittedAt:now(f)-70_000,deadlineMs:30_000});
  const before=rows(f);assert.ok(before[0].admitted_at_ms+terms.windowMs<now(f));assert.ok(before[0].charged_through_ms>now(f));
  await assert.rejects(f.reserve(),error=>error instanceof SponsorReadLimitError);assert.deepEqual(rows(f),before);f.noReadSideEffects();
});

test('expired full reservations age out using database time while historical receipt remains unchanged',async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=1;const f=await fixture(t,{terms});
  seed(f,{operation:'image-media',bytes:1000,admittedAt:now(f)-100_000,deadlineMs:30_000});const old=rows(f)[0];
  t.mock.method(Date,'now',()=>1);await f.reserve();assert.equal(rows(f).length,2);assert.deepEqual(rows(f)[0],old);
  assert.ok(rows(f)[1].admitted_at_ms>old.charged_through_ms);f.noReadSideEffects();
});

test('lost database acknowledgement remains charged and retry cannot reuse an old attempt',async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=1;const f=await fixture(t,{terms}),identity=await f.identify();
  const batch=f.DB.batch;let lost=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(statements.some(item=>item.sql.includes('INSERT INTO experience_sponsor_read_attempts'))){lost=true;throw Error('lost read acknowledgement');}return result;};
  await assert.rejects(f.reserve('image-status',identity),/lost read acknowledgement/);f.DB.batch=batch;
  assert.equal(lost,true);assert.equal(rows(f).length,1);await assert.rejects(f.reserve(),error=>error instanceof SponsorReadLimitError);assert.equal(rows(f).length,1);f.noReadSideEffects();
});

test('duplicate server UUID after quota exhaustion cannot turn a previous receipt into a new ticket',async t=>{
  const terms=policy();terms.actor.maximumRequestsPerWindow=1;const f=await fixture(t,{terms}),identity=await f.identify();
  t.mock.method(crypto,'randomUUID',()=> '00000000-0000-4000-8000-000000000001');
  const first=await f.reserve('image-status',identity);assert.ok(first.attempt);
  await assert.rejects(f.reserve('image-status',identity),error=>error instanceof SponsorReadLimitError);
  assert.equal(rows(f).length,1);f.noReadSideEffects();
});

test('a committed insert with missing write acknowledgement fails closed while retaining the charge',async t=>{
  const f=await fixture(t),identity=await f.identify(),batch=f.DB.batch;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(statements.some(item=>item.sql.includes('INSERT INTO experience_sponsor_read_attempts')))result[0]={...result[0],meta:{...result[0].meta,changes:0}};return result;};
  await assert.rejects(f.reserve('image-status',identity),/sponsor_read_authority_changed/);f.DB.batch=batch;
  assert.equal(rows(f).length,1);f.noReadSideEffects();
});

test('a ticket is bound to the exact native authority, HTTP request, environment and database and consumed once',async t=>{
  const f=await fixture(t),first=await f.reserve(),other=await f.identify();
  for(const [attempt,authority,request,env] of [[{},first.authority,first.request,f.env],[first.attempt,other.authority,first.request,f.env],
    [first.attempt,first.authority,first.request.clone(),f.env],[first.attempt,first.authority,first.request,{...f.env}]]){
    await assert.rejects(takeSponsorImageReadAttempt(attempt,authority,request,env),/sponsor_read_attempt_unavailable/);
  }
  f.env.DB={...f.DB};
  await assert.rejects(takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env),/sponsor_read_attempt_unavailable/);
  f.env.DB=f.DB;
  const outcomes=await Promise.allSettled([1,2].map(()=>takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env)));
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);assert.equal(outcomes.filter(item=>item.status==='rejected').length,1);
  await assert.rejects(takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env),/sponsor_read_attempt_unavailable/);
  assert.equal(rows(f).length,1);f.noReadSideEffects();
});

test('deadline failure consumes no second permission and never refunds the admitted attempt',async t=>{
  const terms=policy();terms.operations['image-status'].deadlineMs=1;const f=await fixture(t,{terms}),first=await f.reserve();
  await new Promise(resolve=>setTimeout(resolve,10));
  t.mock.method(Date,'now',()=>1);
  await assert.rejects(takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env),/sponsor_read_attempt_unavailable/);
  assert.equal(rows(f).length,1);assert.equal(rows(f)[0].maximum_bytes,100);f.noReadSideEffects();
});

test('database deadline handoff stays bounded under wall-clock skew and a stalled database sample',async t=>{
  const terms=policy();terms.operations['image-status'].deadlineMs=100;
  const f=await fixture(t,{terms}),first=await f.reserve();t.mock.method(Date,'now',()=>-1_000_000_000);
  const reservedAt=performance.now(),ticket=await takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env);
  assert.ok(ticket.remainingMs>0&&ticket.remainingMs<=100);
  assert.ok(Number.isFinite(ticket.monotonicDeadline)&&ticket.monotonicDeadline<=reservedAt+100);
  const cutoff=ticket.monotonicDeadline;
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ticket.monotonicDeadline,cutoff);
  assert.ok(ticket.monotonicDeadline-performance.now()<ticket.remainingMs);
  const second=await f.reserve(),prepare=f.DB.prepare;
  f.DB.prepare=sql=>{
    const statement=prepare.call(f.DB,sql);
    if(!sql.startsWith('SELECT 1 AS available,'))return statement;
    return {bind(){return {first:()=>new Promise(()=>{})};}};
  };
  const started=performance.now();
  try {await assert.rejects(takeSponsorImageReadAttempt(second.attempt,second.authority,second.request,f.env),/sponsor_read_attempt_unavailable/);}
  finally {f.DB.prepare=prepare;}
  assert.ok(performance.now()-started<1000);assert.equal(rows(f).length,2);f.noReadSideEffects();
});

test('current native authority is checked atomically at reservation and again when taking a ticket',async t=>{
  const f=await fixture(t),first=await f.reserve(),identity=await f.identify();
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('changed-after-admission',f.actor);
  const native=f.snapshotNativeState();
  await assert.rejects(f.reserve('image-status',identity),/sponsor_read_authority_changed/);
  await assert.rejects(takeSponsorImageReadAttempt(first.attempt,first.authority,first.request,f.env),/sponsor_read_attempt_unavailable/);
  assert.equal(rows(f).length,1);f.noReadSideEffects(native);
});

test('generation switches, rotated current campaign terms and expired grant do not remove owned read resources',async t=>{
  const f=await fixture(t),identity=await f.identify();
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0,policy_digest=?,policy_json=? WHERE campaign_id=?').run(`sha256:${'f'.repeat(64)}`,'{}',f.campaignId);
  f.sqlite.exec('UPDATE experience_sponsor_resource_policies SET enabled=0');
  f.sqlite.prepare('UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1 WHERE grant_id=?').run(f.consumption.grant_id);
  const native=f.snapshotNativeState(),read=await f.reserve('image-status',identity);
  const ticket=await takeSponsorImageReadAttempt(read.attempt,read.authority,read.request,f.env);assert.equal(ticket.operation,'image-status');
  assert.equal(rows(f).length,1);assert.equal(rows(f)[0].sponsor_policy_digest,f.sponsorPolicyDigest);f.noReadSideEffects(native);
});
