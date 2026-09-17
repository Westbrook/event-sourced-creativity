import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {after,test} from 'node:test';
import {SPONSOR_ENTITLEMENT_SCHEMA} from '../worker/experience-sponsor-entitlement.ts';
import {SPONSOR_RESOURCE_SCHEMA,readSponsorResourceLimits,prepareSponsorResourcePlan,resolveSponsorResourceReplay} from '../worker/experience-sponsor-resources.ts';

const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('No network in dormant initial-intake resource qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const hash=char=>`sha256:${char.repeat(64)}`;
const operations=['text-intake','preflight','issuance','image-text-draft-storage'];
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  for(const sql of [...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA])db.exec(sql);
  const now=db.prepare(`SELECT ${clock} AS now`).get().now;
  const allowance={maximumOperations:20,maximumTextBytes:1000,maximumOperationsPerWindow:10,maximumTextBytesPerWindow:500,maximumPendingGrants:5,maximumInflightJobs:1};
  const v1={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:100,
    campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const v2={...structuredClone(v1),version:2,allowedOperations:[...operations]};
  const input=(n=1,changes={})=>({limits:v2,campaignId:'campaign',policyDigest:hash('a'),actorUserId:'actor',sessionDigest:hash('b'),intentKey:`intent-${n}`,
    operation:'image-text-draft-storage',payloadDigest:hash('c'),textBytes:6,resourceId:`resource-${n}`,...changes});
  const run=statement=>db.prepare(statement.sql).run(...statement.bindings);
  function transaction(statements){db.exec('BEGIN IMMEDIATE');try{for(const item of statements)run(item);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function provision(plan,{enabled=1}={}){
    db.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,?)').run(plan.input.campaignId,plan.input.policyDigest,'{}',enabled);
    db.prepare('INSERT INTO experience_sponsor_resource_policies(campaign_id,limits_digest,limits_json,enabled) VALUES(?,?,?,?)').run(plan.input.campaignId,plan.limitsDigest,plan.limitsJson,enabled);
  }
  function rotate(plan){
    db.prepare('UPDATE experience_sponsor_campaigns SET policy_digest=?').run(plan.input.policyDigest);
    db.prepare('UPDATE experience_sponsor_resource_policies SET limits_digest=?,limits_json=?').run(plan.limitsDigest,plan.limitsJson);
  }
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_resource_receipts').get().n;
  const snapshot=()=>db.prepare('SELECT * FROM experience_sponsor_resource_receipts ORDER BY rowid').all();
  const replay=plan=>resolveSponsorResourceReplay(db.prepare(plan.replayLookup.sql).get(...plan.replayLookup.bindings)??null,plan.input);
  return {db,now,v1,v2,input,transaction,provision,rotate,count,snapshot,replay};
}

test('version 1 retains its exact shape and cannot authorize initial draft storage',async t=>{
  const f=fixture(t);assert.equal(readSponsorResourceLimits(f.v1).version,1);
  assert.throws(()=>readSponsorResourceLimits({...f.v1,allowedOperations:operations}),/sponsor_resource_limits_invalid/);
  await assert.rejects(prepareSponsorResourcePlan(f.input(1,{limits:f.v1})),/sponsor_resource_input_invalid/);
  for(const operation of ['text-intake','preflight'])assert.equal((await prepareSponsorResourcePlan(f.input(1,{limits:f.v1,operation}))).input.operation,operation);
  assert.equal((await prepareSponsorResourcePlan(f.input(1,{limits:f.v1,operation:'issuance',issuedGrantId:'grant-1'}))).input.issuedGrantId,'grant-1');
  assert.equal(f.count(),0);
});

test('version 2 requires the exact reviewed operation tuple without widening operation meanings',async t=>{
  const f=fixture(t),limits=readSponsorResourceLimits(f.v2);assert.deepEqual(limits.allowedOperations,operations);assert.ok(Object.isFrozen(limits.allowedOperations));
  for(const allowedOperations of [undefined,operations.slice(0,3),[...operations,'upload'],[...operations].reverse(),[...operations.slice(0,3),'issuance'],'*']){
    const raw={...f.v2,allowedOperations};if(allowedOperations===undefined)delete raw.allowedOperations;
    assert.throws(()=>readSponsorResourceLimits(raw),/sponsor_resource_limits_invalid/);
  }
  for(const changed of [{version:3},{nowMs:f.now},{maximumOperationTextBytes:Number.MAX_SAFE_INTEGER}])assert.throws(()=>readSponsorResourceLimits({...f.v2,...changed}),/sponsor_resource_limits_invalid/);
  for(const changed of [{operation:'upload'},{operation:'storage'},{operation:'anonymous-intake'},{issuedGrantId:'grant-1'},{operation:'issuance'},{nowMs:f.now}])await assert.rejects(prepareSponsorResourcePlan(f.input(1,changed)),/sponsor_resource_input_invalid/);
  assert.equal(f.count(),0);
});

test('version 2 storage is a separate immutable debit from preparation, preflight and issuance',async t=>{
  const f=fixture(t),bytes=new TextEncoder().encode('é梨').length;assert.equal(bytes,5);
  const storage=await prepareSponsorResourcePlan(f.input(1,{textBytes:bytes}));assert.equal(f.count(),0);f.provision(storage);f.transaction(storage.statements);
  for(const operation of ['text-intake','preflight']){
    const plan=await prepareSponsorResourcePlan(f.input(1,{operation,textBytes:bytes,resourceId:`${operation}-1`}));f.transaction(plan.statements);
  }
  const issue=await prepareSponsorResourcePlan(f.input(1,{operation:'issuance',textBytes:bytes,resourceId:'issuance-1',issuedGrantId:'grant-1'}));
  assert.throws(()=>f.transaction(issue.statements),/CHECK/);assert.equal(f.count(),3);
  const p=issue.input;
  f.transaction([{sql:'INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)',
    bindings:[p.issuedGrantId,p.campaignId,p.policyDigest,p.actorUserId,p.sessionDigest,p.intentKey,p.payloadDigest,f.now-1000,f.now+600_000]},...issue.statements]);
  assert.deepEqual(f.snapshot().map(row=>row.operation),['image-text-draft-storage','text-intake','preflight','issuance']);
  assert.equal(f.snapshot().reduce((sum,row)=>sum+row.text_bytes,0),20);
  assert.throws(()=>f.db.exec("UPDATE experience_sponsor_resource_receipts SET operation='text-intake' WHERE operation='image-text-draft-storage'"),/immutable/);
  assert.throws(()=>f.db.exec('DELETE FROM experience_sponsor_resource_receipts'),/immutable/);
});

for(const scope of ['campaign','actor'])for(const dimension of ['operations','bytes'])test(`v1 to v2 rotation preserves ${scope} aggregate ${dimension} across storage and old operations`,async t=>{
  const f=fixture(t),v1=structuredClone(f.v1);
  if(dimension==='operations'){v1[scope].maximumOperations=2;v1[scope].maximumOperationsPerWindow=2;}
  else {v1[scope].maximumTextBytes=12;v1[scope].maximumTextBytesPerWindow=12;v1.maximumOperationTextBytes=6;}
  if(scope==='campaign')for(const key of Object.keys(v1.actor))v1.actor[key]=Math.min(v1.actor[key],v1.campaign[key]);
  const old=await prepareSponsorResourcePlan(f.input(1,{limits:v1,operation:'text-intake'}));f.provision(old);f.transaction(old.statements);
  const v2={...structuredClone(v1),version:2,allowedOperations:[...operations]};
  const next=await prepareSponsorResourcePlan(f.input(2,{limits:v2,policyDigest:hash('d'),...(scope==='campaign'?{actorUserId:'actor-two'}:{})}));
  f.rotate(next);f.transaction(next.statements);
  const contender=await prepareSponsorResourcePlan(f.input(3,{limits:v2,policyDigest:hash('d'),operation:'preflight',textBytes:1,...(scope==='campaign'?{actorUserId:'actor-three'}:{})}));
  assert.throws(()=>f.transaction(contender.statements),/CHECK/);assert.equal(f.count(),2);
  assert.equal(f.snapshot().reduce((sum,row)=>sum+row.text_bytes,0),12);
});

test('v2 rolling byte allowance atomically rejects a stale storage contender and ignores caller clock advances',async t=>{
  const f=fixture(t),limits=structuredClone(f.v2);limits.maximumOperationTextBytes=6;limits.actor.maximumTextBytesPerWindow=6;
  const first=await prepareSponsorResourcePlan(f.input(1,{limits})),second=await prepareSponsorResourcePlan(f.input(2,{limits}));f.provision(first);
  assert.equal(f.replay(first),null);assert.equal(f.replay(second),null);f.transaction(first.statements);
  t.mock.method(Date,'now',()=>f.now+86_400_000);assert.throws(()=>f.transaction(second.statements),/CHECK/);assert.equal(f.count(),1);
  assert.ok(Math.abs(f.snapshot()[0].recorded_at_ms-f.now)<30_000);
});

test('v2 storage exact replay survives lost ACK without new debit; altered identity, payload and body conflict',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input());f.provision(plan);
  assert.throws(()=>{f.transaction(plan.statements);throw Error('lost ACK');},/lost ACK/);
  const before=f.snapshot();assert.deepEqual(f.replay(plan),{resourceId:'resource-1',issuedGrantId:null});f.transaction(plan.statements);assert.deepEqual(f.snapshot(),before);
  for(const changed of [{payloadDigest:hash('d')},{textBytes:7},{sessionDigest:hash('d')}]){
    const altered=await prepareSponsorResourcePlan(f.input(1,changed));assert.throws(()=>f.replay(altered),/sponsor_resource_/);assert.throws(()=>f.transaction(altered.statements),/CHECK/);
  }
  const fork=await prepareSponsorResourcePlan(f.input(1,{resourceId:'replacement'}));assert.throws(()=>f.transaction(fork.statements),/CHECK/);
  assert.deepEqual(f.snapshot(),before);
});

test('v2 reviewed DB terms, revocation and database expiry are checked at the storage transaction',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input());f.provision(plan);
  f.db.exec('UPDATE experience_sponsor_resource_policies SET enabled=0');assert.throws(()=>f.transaction(plan.statements),/CHECK/);
  f.db.exec('UPDATE experience_sponsor_resource_policies SET enabled=1');
  const v1=await prepareSponsorResourcePlan(f.input(2,{limits:f.v1,operation:'text-intake'}));f.rotate(v1);
  assert.throws(()=>f.transaction(plan.statements),/CHECK/);assert.equal(f.count(),0);
  for(const times of [{startsAtMs:f.now-60_000,expiresAtMs:f.now-1},{startsAtMs:f.now+60_000,expiresAtMs:f.now+120_000}]){
    const changed=await prepareSponsorResourcePlan(f.input(3,{limits:{...f.v2,...times}}));f.rotate(changed);assert.throws(()=>f.transaction(changed.statements),/CHECK/);
  }
  assert.equal(f.count(),0);f.rotate(plan);f.transaction(plan.statements);assert.equal(f.count(),1);
});

test('v2 maximum stored UTF-8 bytes is explicit and limits are captured before asynchronous hashing',async t=>{
  const f=fixture(t);await assert.rejects(prepareSponsorResourcePlan(f.input(1,{textBytes:101})),/sponsor_resource_text_too_large/);
  const raw=f.input(),pending=prepareSponsorResourcePlan(raw);raw.limits.allowedOperations[3]='upload';raw.operation='upload';raw.textBytes=0;
  const captured=await pending;assert.equal(captured.input.operation,'image-text-draft-storage');assert.equal(captured.input.textBytes,6);assert.deepEqual(captured.limits.allowedOperations,operations);
  const getter=f.input(2,{limits:{...f.v2,allowedOperations:[...operations]}});Object.defineProperty(getter.limits.allowedOperations,'3',{enumerable:true,get(){throw Error('must not invoke');}});
  await assert.rejects(prepareSponsorResourcePlan(getter),/sponsor_resource_input_invalid/);assert.equal(f.count(),0);
});

test('storage receipt and caller durable-state witness compose into one rollback boundary',async t=>{
  const f=fixture(t),plan=await prepareSponsorResourcePlan(f.input());f.provision(plan);
  f.db.exec('CREATE TABLE synthetic_draft_receipts(draft_id TEXT PRIMARY KEY,body_digest TEXT NOT NULL)');
  const draft={sql:'INSERT INTO synthetic_draft_receipts(draft_id,body_digest) VALUES(?,?)',bindings:['draft-1',hash('c')]};
  const finalWitness={sql:"INSERT INTO experience_sponsor_assertions(token,passed) VALUES('draft-final',0)",bindings:[]};
  assert.throws(()=>f.transaction([draft,...plan.statements,finalWitness]),/CHECK/);assert.equal(f.count(),0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM synthetic_draft_receipts').get().n,0);
  f.transaction([draft,...plan.statements]);assert.equal(f.count(),1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM synthetic_draft_receipts').get().n,1);
});
