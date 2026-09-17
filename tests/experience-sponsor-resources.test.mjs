import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {after,test} from 'node:test';
import {SPONSOR_ENTITLEMENT_SCHEMA} from '../worker/experience-sponsor-entitlement.ts';
import {SPONSOR_RESOURCE_SCHEMA,readSponsorResourceLimits,prepareSponsorResourcePlan,resolveSponsorResourceReplay,sponsorResourceAdmissionAssertion} from '../worker/experience-sponsor-resources.ts';
import {readFileSync} from 'node:fs';

const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('No network in dormant resource qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const hash=char=>`sha256:${char.repeat(64)}`;
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  for(const sql of [...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA])db.exec(sql);
  const now=db.prepare(`SELECT ${clock} AS now`).get().now;
  const allowance={maximumOperations:20,maximumTextBytes:1000,maximumOperationsPerWindow:10,maximumTextBytesPerWindow:500,maximumPendingGrants:5,maximumInflightJobs:1};
  const limits={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:100,
    campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  function input(n=1,changes={}){return {limits,campaignId:'campaign',policyDigest:hash('a'),actorUserId:'actor',sessionDigest:hash('b'),intentKey:`intent-${n}`,operation:'text-intake',payloadDigest:hash('c'),textBytes:10,resourceId:`resource-${n}`,...changes};}
  const run=statement=>db.prepare(statement.sql).run(...statement.bindings);
  function transaction(statements){db.exec('BEGIN IMMEDIATE');try{for(const statement of statements)run(statement);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function provision(plan,{enabled=1}={}){
    db.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,?)').run(plan.input.campaignId,plan.input.policyDigest,'{}',enabled);
    db.prepare('INSERT INTO experience_sponsor_resource_policies(campaign_id,limits_digest,limits_json,enabled) VALUES(?,?,?,?)').run(plan.input.campaignId,plan.limitsDigest,plan.limitsJson,enabled);
  }
  function grant(plan,changes={}){
    const p=plan.input,row={grant_id:p.issuedGrantId,campaign_id:p.campaignId,policy_digest:p.policyDigest,actor_user_id:p.actorUserId,session_digest:p.sessionDigest,intent_key:p.intentKey,envelope_digest:p.payloadDigest,issued_at_ms:now-1000,expires_at_ms:now+600_000,enabled:1,...changes};
    return {sql:`INSERT INTO experience_sponsor_grants(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`,bindings:Object.values(row)};
  }
  function replay(plan){const row=db.prepare(plan.replayLookup.sql).get(...plan.replayLookup.bindings)??null;return resolveSponsorResourceReplay(row,plan.input);}
  const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const snapshot=()=>Object.fromEntries(['experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_active_jobs'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return {db,now,limits,input,run,transaction,provision,grant,replay,count,snapshot};
}

test('closed explicit limits and operation input reject extras, unsafe numbers, clocks and unsupported operations',async t=>{
  const f=fixture(t);assert.ok(readSponsorResourceLimits(f.limits));
  for(const changed of [{maximumOperationTextBytes:0},{windowMs:Infinity},{actor:{...f.limits.actor,maximumInflightJobs:2}},{extra:true}])assert.throws(()=>readSponsorResourceLimits({...f.limits,...changed}),/sponsor_resource_limits_invalid/);
  for(const changed of [{operation:'upload'},{textBytes:-1},{textBytes:Number.MAX_SAFE_INTEGER},{nowMs:f.now+3_600_000},{issuedGrantId:'unexpected'},{operation:'issuance'}])await assert.rejects(prepareSponsorResourcePlan(f.input(1,changed)),/sponsor_resource_input_invalid/);
  for(const name of ['experience-intake-api.ts','output-requirements-schema.ts'])assert.doesNotMatch(readFileSync(new URL(`../worker/${name}`,import.meta.url),'utf8'),/SPONSOR_RESOURCE_SCHEMA|prepareSponsorResourcePlan/);
});

test('schema remains disabled by default; preparing a plan writes nothing',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input());assert.equal(f.count('experience_sponsor_resource_receipts'),0);
  f.db.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json) VALUES(?,?,?)').run('campaign',hash('a'),'{}');
  f.db.prepare('INSERT INTO experience_sponsor_resource_policies(campaign_id,limits_digest,limits_json) VALUES(?,?,?)').run('campaign',plan.limitsDigest,plan.limitsJson);
  assert.equal(f.db.prepare('SELECT enabled FROM experience_sponsor_resource_policies').get().enabled,0);
  assert.throws(()=>f.transaction(plan.statements),/CHECK/);assert.equal(f.count('experience_sponsor_resource_receipts'),0);
});

test('server measured UTF-8 bytes and each supported operation debit immutable receipts once',async t=>{
  const f=fixture(t),bytes=new TextEncoder().encode('é梨').length;assert.equal(bytes,5);
  const intake=await prepareSponsorResourcePlan(f.input(1,{textBytes:bytes}));f.provision(intake);f.transaction(intake.statements);
  const preflight=await prepareSponsorResourcePlan(f.input(1,{operation:'preflight',resourceId:'preflight-1',textBytes:bytes}));f.transaction(preflight.statements);
  const issuance=await prepareSponsorResourcePlan(f.input(1,{operation:'issuance',resourceId:'issue-1',issuedGrantId:'grant-1',textBytes:bytes}));f.transaction([f.grant(issuance),...issuance.statements]);
  assert.equal(f.count('experience_sponsor_resource_receipts'),3);assert.equal(f.db.prepare('SELECT SUM(text_bytes) AS n FROM experience_sponsor_resource_receipts').get().n,15);
  const before=f.snapshot();f.transaction(issuance.statements);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.replay(issuance),{resourceId:'issue-1',issuedGrantId:'grant-1'});
  for(const sql of ["UPDATE experience_sponsor_resource_receipts SET text_bytes=0","DELETE FROM experience_sponsor_resource_receipts","INSERT OR REPLACE INTO experience_sponsor_resource_receipts SELECT * FROM experience_sponsor_resource_receipts"])assert.throws(()=>f.db.exec(sql),/sponsor_resource_/);
  assert.deepEqual(f.snapshot(),before);
});

for(const scope of ['campaign','actor'])for(const dimension of ['maximumOperations','maximumTextBytes','maximumOperationsPerWindow','maximumTextBytesPerWindow'])test(`${scope} ${dimension} is checked atomically for stale contenders`,async t=>{
  const f=fixture(t),limits=structuredClone(f.limits);
  if(dimension.includes('Operations')){limits[scope][dimension]=1;if(dimension==='maximumOperations')limits[scope].maximumOperationsPerWindow=1;}
  else {limits[scope][dimension]=10;limits.maximumOperationTextBytes=10;if(dimension==='maximumTextBytes')limits[scope].maximumTextBytesPerWindow=10;}
  if(scope==='campaign')for(const key of Object.keys(limits.actor))limits.actor[key]=Math.min(limits.actor[key],limits.campaign[key]);
  const a=await prepareSponsorResourcePlan(f.input(1,{limits})),b=await prepareSponsorResourcePlan(f.input(2,{limits,...(scope==='campaign'?{actorUserId:'actor-two'}:{})}));f.provision(a);
  assert.equal(f.replay(a),null);assert.equal(f.replay(b),null);
  f.transaction(a.statements);assert.throws(()=>f.transaction(b.statements),/CHECK/);
  assert.equal(f.count('experience_sponsor_resource_receipts'),1);assert.equal(f.db.prepare('SELECT SUM(text_bytes) AS n FROM experience_sponsor_resource_receipts').get().n,10);
});

test('oversized text fails before SQL and mutation during digest cannot change captured identity or limits',async t=>{
  const f=fixture(t);await assert.rejects(prepareSponsorResourcePlan(f.input(1,{textBytes:101})),/sponsor_resource_text_too_large/);
  const raw=f.input(),pending=prepareSponsorResourcePlan(raw);raw.actorUserId='other';raw.textBytes=0;raw.limits.actor.maximumOperations=999;
  const plan=await pending;assert.equal(plan.input.actorUserId,'actor');assert.equal(plan.input.textBytes,10);assert.equal(plan.limits.actor.maximumOperations,20);
  const accessor=f.input();Object.defineProperty(accessor,'actorUserId',{enumerable:true,get(){throw Error('must not invoke accessor');}});await assert.rejects(prepareSponsorResourcePlan(accessor),/sponsor_resource_input_invalid/);
  const symbolic=f.input();symbolic[Symbol('clock')]=0;await assert.rejects(prepareSponsorResourcePlan(symbolic),/sponsor_resource_input_invalid/);
});

test('exact replay preserves original receipt; changed session, payload or issuance grant conflicts',async t=>{
  const f=fixture(t),first=await prepareSponsorResourcePlan(f.input());f.provision(first);f.transaction(first.statements);const before=f.snapshot();
  for(const changed of [{sessionDigest:hash('d')},{payloadDigest:hash('d')},{textBytes:11}]){const plan=await prepareSponsorResourcePlan(f.input(1,changed));assert.throws(()=>f.replay(plan),/sponsor_resource_/);assert.throws(()=>f.transaction(plan.statements),/CHECK/);}
  const issue=await prepareSponsorResourcePlan(f.input(2,{operation:'issuance',issuedGrantId:'grant-2'}));f.transaction([f.grant(issue),...issue.statements]);
  const fork=await prepareSponsorResourcePlan(f.input(2,{operation:'issuance',issuedGrantId:'grant-other'}));assert.throws(()=>f.transaction(fork.statements),/CHECK/);
  assert.equal(f.count('experience_sponsor_resource_receipts'),before.experience_sponsor_resource_receipts.length+1);assert.equal(f.count('experience_sponsor_grants'),1);
});

test('policy rotation preserves cumulative campaign history and actor usage stays separate',async t=>{
  const f=fixture(t),limits=structuredClone(f.limits);limits.campaign.maximumOperations=2;limits.campaign.maximumOperationsPerWindow=2;limits.actor.maximumOperations=1;limits.actor.maximumOperationsPerWindow=1;
  const first=await prepareSponsorResourcePlan(f.input(1,{limits}));f.provision(first);f.transaction(first.statements);
  f.db.prepare('UPDATE experience_sponsor_campaigns SET policy_digest=?').run(hash('d'));
  const sameActor=await prepareSponsorResourcePlan(f.input(2,{limits,policyDigest:hash('d')}));assert.throws(()=>f.transaction(sameActor.statements),/CHECK/);
  const secondActor=await prepareSponsorResourcePlan(f.input(2,{limits,policyDigest:hash('d'),actorUserId:'actor-two'}));f.transaction(secondActor.statements);
  const third=await prepareSponsorResourcePlan(f.input(3,{limits,policyDigest:hash('d'),actorUserId:'actor-three'}));assert.throws(()=>f.transaction(third.statements),/CHECK/);assert.equal(f.count('experience_sponsor_resource_receipts'),2);
});

for(const revoked of ['campaign','resource policy','changed limits'])test(`${revoked} after preparation prevents debit and grant writes`,async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input(1,{operation:'issuance',issuedGrantId:'grant-1'}));f.provision(plan);
  if(revoked==='campaign')f.db.exec('UPDATE experience_sponsor_campaigns SET enabled=0');
  else if(revoked==='resource policy')f.db.exec('UPDATE experience_sponsor_resource_policies SET enabled=0');
  else f.db.exec("UPDATE experience_sponsor_resource_policies SET limits_json='{}'");
  assert.throws(()=>f.transaction([f.grant(plan),...plan.statements]),/CHECK/);assert.equal(f.count('experience_sponsor_grants'),0);assert.equal(f.count('experience_sponsor_resource_receipts'),0);
});

test('missing or mismatched final grant and a later issuer failure roll back the whole transaction',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input(1,{operation:'issuance',issuedGrantId:'grant-1'}));f.provision(plan);
  assert.throws(()=>f.transaction(plan.statements),/CHECK/);
  for(const mismatch of [{actor_user_id:'other'},{session_digest:hash('d')},{envelope_digest:hash('d')},{issued_at_ms:f.now+60_000}])assert.throws(()=>f.transaction([f.grant(plan,mismatch),...plan.statements]),/CHECK/);
  const fail={sql:"INSERT INTO experience_sponsor_assertions(token,passed) VALUES('late-issuer',0)",bindings:[]};
  assert.throws(()=>f.transaction([f.grant(plan),...plan.statements,fail]),/CHECK/);assert.equal(f.count('experience_sponsor_grants'),0);assert.equal(f.count('experience_sponsor_resource_receipts'),0);
  const revoke={sql:'UPDATE experience_sponsor_grants SET enabled=0 WHERE grant_id=?',bindings:['grant-1']};
  assert.throws(()=>f.transaction([f.grant(plan),...plan.statements.slice(0,-2),revoke,...plan.statements.slice(-2)]),/CHECK/);
  assert.equal(f.count('experience_sponsor_resource_receipts'),0);
  f.transaction([f.grant(plan),...plan.statements]);assert.equal(f.count('experience_sponsor_grants'),1);
});

for(const scope of ['campaign','actor'])test(`${scope} pending grants consume the last allowance atomically; expiry preserves operation history`,async t=>{
  const f=fixture(t),limits=structuredClone(f.limits);limits.actor.maximumPendingGrants=1;if(scope==='campaign')limits.campaign.maximumPendingGrants=1;
  const a=await prepareSponsorResourcePlan(f.input(1,{limits,operation:'issuance',issuedGrantId:'grant-1'})),b=await prepareSponsorResourcePlan(f.input(2,{limits,operation:'issuance',issuedGrantId:'grant-2',...(scope==='campaign'?{actorUserId:'actor-two'}:{})}));f.provision(a);
  assert.equal(f.replay(a),null);assert.equal(f.replay(b),null);f.transaction([f.grant(a),...a.statements]);
  assert.throws(()=>f.transaction([f.grant(b),...b.statements]),/CHECK/);assert.equal(f.count('experience_sponsor_grants'),1);
  f.db.prepare('UPDATE experience_sponsor_grants SET expires_at_ms=? WHERE grant_id=?').run(f.now-500,'grant-1');
  f.transaction([f.grant(b),...b.statements]);assert.equal(f.count('experience_sponsor_resource_receipts'),2);
});

test('database clock owns expiry and rolling windows even if JavaScript Date.now jumps forward',async t=>{
  const f=fixture(t),limits=structuredClone(f.limits);limits.actor.maximumOperationsPerWindow=1;
  const a=await prepareSponsorResourcePlan(f.input(1,{limits})),b=await prepareSponsorResourcePlan(f.input(2,{limits}));f.provision(a);f.transaction(a.statements);
  t.mock.method(Date,'now',()=>f.now+86_400_000);assert.throws(()=>f.transaction(b.statements),/CHECK/);
  const recorded=f.db.prepare('SELECT recorded_at_ms FROM experience_sponsor_resource_receipts').get().recorded_at_ms;assert.ok(Math.abs(recorded-f.now)<30_000);
  const future=await prepareSponsorResourcePlan(f.input(3,{actorUserId:'future-actor',limits:{...limits,startsAtMs:f.now+60_000}}));
  f.db.prepare('UPDATE experience_sponsor_resource_policies SET limits_digest=?,limits_json=?').run(future.limitsDigest,future.limitsJson);assert.throws(()=>f.transaction(future.statements),/CHECK/);
});

test('lost committed resource acknowledgment resolves the original issuance without new grant or debit',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input(1,{operation:'issuance',issuedGrantId:'grant-1'}));f.provision(plan);
  assert.throws(()=>{f.transaction([f.grant(plan),...plan.statements]);throw Error('lost acknowledgment');},/lost acknowledgment/);
  const before=f.snapshot();assert.deepEqual(f.replay(plan),{resourceId:'resource-1',issuedGrantId:'grant-1'});f.transaction(plan.statements);assert.deepEqual(f.snapshot(),before);
});

test('post-admission capacity proof prevents concurrently admitting separately issued grants beyond campaign inflight cap',async t=>{
  const f=fixture(t),limits=structuredClone(f.limits);limits.campaign.maximumInflightJobs=1;
  const a=await prepareSponsorResourcePlan(f.input(1,{limits,operation:'issuance',issuedGrantId:'grant-1'})),b=await prepareSponsorResourcePlan(f.input(2,{limits,operation:'issuance',issuedGrantId:'grant-2',actorUserId:'actor-two'}));f.provision(a);
  f.transaction([f.grant(a),...a.statements]);f.transaction([f.grant(b),...b.statements]);
  const assertionA=await sponsorResourceAdmissionAssertion({limits,campaignId:'campaign',policyDigest:hash('a'),actorUserId:'actor'}),assertionB=await sponsorResourceAdmissionAssertion({limits,campaignId:'campaign',policyDigest:hash('a'),actorUserId:'actor-two'});
  function admission(plan,assertion){const p=plan.input;return [
    {sql:`INSERT INTO experience_sponsor_consumptions(consumption_id,grant_id,campaign_id,actor_user_id,session_digest,intent_key,envelope_digest,job_id,maximum_microusd,admitted_at_ms) VALUES(?,?,?,?,?,?,?,?,?,${clock})`,bindings:[`consume-${p.resourceId}`,p.issuedGrantId,p.campaignId,p.actorUserId,p.sessionDigest,p.intentKey,p.payloadDigest,`job-${p.resourceId}`,100]},
    {sql:'INSERT INTO experience_sponsor_active_jobs(actor_user_id,consumption_id,job_id) VALUES(?,?,?)',bindings:[p.actorUserId,`consume-${p.resourceId}`,`job-${p.resourceId}`]},
    {sql:`INSERT INTO experience_sponsor_assertions(token,passed) VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`,bindings:[`assert-${p.resourceId}`,...assertion.bindings]},
    {sql:'DELETE FROM experience_sponsor_assertions WHERE token=?',bindings:[`assert-${p.resourceId}`]},
  ];}
  // Both preparations see available capacity; only one final atomic admission wins.
  assert.equal(f.db.prepare(`SELECT (${assertionA.sql}) AS allowed`).get(...assertionA.bindings).allowed,1);
  assert.equal(f.db.prepare(`SELECT (${assertionB.sql}) AS allowed`).get(...assertionB.bindings).allowed,1);
  f.transaction(admission(a,assertionA));assert.throws(()=>f.transaction(admission(b,assertionB)),/CHECK/);
  assert.equal(f.count('experience_sponsor_consumptions'),1);assert.equal(f.count('experience_sponsor_active_jobs'),1);assert.equal(f.count('experience_sponsor_resource_receipts'),2);
  // Terminal removal may free active capacity; immutable issuance usage persists.
  f.db.exec('DELETE FROM experience_sponsor_active_jobs');f.transaction(admission(b,assertionB));assert.equal(f.count('experience_sponsor_consumptions'),2);assert.equal(f.count('experience_sponsor_resource_receipts'),2);
  f.db.exec('UPDATE experience_sponsor_resource_policies SET enabled=0');assert.equal(f.db.prepare(`SELECT (${assertionB.sql}) AS allowed`).get(...assertionB.bindings).allowed,0);
});
