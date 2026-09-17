import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SPONSOR_INTAKE_READ_POLICY_SCHEMA,readSponsorIntakeReadPolicy,SPONSOR_IMAGE_INTAKE_READ_OPERATIONS} from '../worker/experience-sponsor-intake-read-policy.ts';

const policy=()=>({version:1,windowMs:60_000,
  operations:{'image-intake-bootstrap':{maximumBytes:100,deadlineMs:10_000},'image-intake-draft':{maximumBytes:200,deadlineMs:10_000},'image-intake-receipt':{maximumBytes:1000,deadlineMs:30_000}},
  actor:{maximumRequestsPerWindow:3,maximumBytesPerWindow:3000},campaign:{maximumRequestsPerWindow:6,maximumBytesPerWindow:6000}});

test('read policy is an explicit frozen closed pre-job Image contract with no default allowance',()=>{
  const raw=policy(),captured=readSponsorIntakeReadPolicy(raw);raw.operations['image-intake-receipt'].maximumBytes=1;
  assert.equal(captured.operations['image-intake-receipt'].maximumBytes,1000);assert.ok(Object.isFrozen(captured.operations['image-intake-receipt']));
  assert.deepEqual(Object.keys(captured.operations).sort(),[...SPONSOR_IMAGE_INTAKE_READ_OPERATIONS].sort());
  for(const raw of [undefined,{},null,{version:1}, {...policy(),version:2},{...policy(),enabled:true},{...policy(),expiresAtMs:1},{...policy(),nowMs:1}]){
    assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
});

test('operation categories cannot widen or inherit generation permissions',()=>{
  for(const changes of [operations=>delete operations['image-intake-draft'],operations=>operations.upload={maximumBytes:1,deadlineMs:1},
    operations=>operations['image-intake-draft']={...operations['image-intake-draft'],maximumRequests:1},operations=>operations['image-intake-receipt']='unlimited']){
    const raw=policy();changes(raw.operations);assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
  const inherited=policy();Object.setPrototypeOf(inherited.operations,{'image-edit':{maximumBytes:1,deadlineMs:1}});
  assert.throws(()=>readSponsorIntakeReadPolicy(inherited),/sponsor_intake_read_policy_invalid/);
});

test('all resource values are safe bounded positive integers with coherent actor and campaign ceilings',()=>{
  for(const value of [0,-1,NaN,Infinity,1.5,'2',Number.MAX_SAFE_INTEGER])for(const field of ['windowMs','maximumBytes','deadlineMs','maximumRequestsPerWindow','maximumBytesPerWindow']){
    const raw=policy();if(field==='windowMs')raw.windowMs=value;
    else if(['maximumBytes','deadlineMs'].includes(field))raw.operations['image-intake-bootstrap'][field]=value;
    else raw.actor[field]=value;
    assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/,`${field}=${value}`);
  }
  for(const mutate of [raw=>raw.actor.maximumRequestsPerWindow=7,raw=>raw.actor.maximumBytesPerWindow=6001,
    raw=>raw.operations['image-intake-receipt'].maximumBytes=3001,raw=>raw.operations['image-intake-receipt'].maximumBytes=192_000_001,
    raw=>raw.operations['image-intake-receipt'].deadlineMs=30_001,raw=>raw.campaign.extra=1]){
    const raw=policy();mutate(raw);assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
});

test('policy validation never invokes getters, accepts cycles or keeps mutable caller references',()=>{
  const getter=policy();Object.defineProperty(getter.operations['image-intake-receipt'],'maximumBytes',{enumerable:true,get(){throw Error('Getter must not run');}});
  assert.throws(()=>readSponsorIntakeReadPolicy(getter),/sponsor_intake_read_policy_invalid/);
  const cyclic=policy();cyclic.operations['image-intake-receipt']=cyclic;assert.throws(()=>readSponsorIntakeReadPolicy(cyclic),/sponsor_intake_read_policy_invalid/);
  const symbolic=policy();symbolic[Symbol('policy')]=1;assert.throws(()=>readSponsorIntakeReadPolicy(symbolic),/sponsor_intake_read_policy_invalid/);
});

test('dormant policy schema preserves immutable review terms against update, delete and replace',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,0);
  db.exec('CREATE TABLE experience_sponsor_campaigns(campaign_id TEXT PRIMARY KEY)');
  for(const sql of SPONSOR_INTAKE_READ_POLICY_SCHEMA)db.exec(sql);
  db.exec("INSERT INTO experience_sponsor_campaigns VALUES('campaign')");
  const insert="INSERT INTO experience_sponsor_intake_read_policies VALUES('campaign','sponsor-digest','read-digest','{}','review-digest')";db.exec(insert);
  assert.throws(()=>db.exec("UPDATE experience_sponsor_intake_read_policies SET policy_json='null'"),/immutable/);
  assert.throws(()=>db.exec('DELETE FROM experience_sponsor_intake_read_policies'),/immutable/);
  assert.throws(()=>db.exec(insert.replace('INSERT','INSERT OR REPLACE')),/exists/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_policies').get().n,1);
});

test('pre-job and generated-result policies cannot authorize each other or expand intake storage terms',async()=>{
  const {readSponsorReadPolicy,SPONSOR_READ_POLICY_SCHEMA}=await import('../worker/experience-sponsor-read-policy.ts');
  const generated={...policy(),operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes:100,deadlineMs:1000}]))};
  assert.ok(readSponsorReadPolicy(generated));
  assert.throws(()=>readSponsorReadPolicy(policy()),/sponsor_read_policy_invalid/);
  assert.throws(()=>readSponsorIntakeReadPolicy(generated),/sponsor_intake_read_policy_invalid/);
  for(const operation of ['text-intake','preflight','issuance','image-text-draft-storage','upload','guest-claim']){
    const raw=policy();raw.operations[operation]={maximumBytes:1,deadlineMs:1};
    assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE experience_sponsor_campaigns(campaign_id TEXT PRIMARY KEY)');
    for(const sql of [...SPONSOR_READ_POLICY_SCHEMA,...SPONSOR_INTAKE_READ_POLICY_SCHEMA])db.exec(sql);
    db.exec("INSERT INTO experience_sponsor_campaigns VALUES('campaign')");
    db.exec("INSERT INTO experience_sponsor_read_policies VALUES('campaign','same-original-digest','generated-digest','{}','generated-review')");
    db.exec("INSERT INTO experience_sponsor_intake_read_policies VALUES('campaign','same-original-digest','prejob-digest','{}','prejob-review')");
    assert.equal(db.prepare('SELECT read_policy_digest FROM experience_sponsor_read_policies').get().read_policy_digest,'generated-digest');
    assert.equal(db.prepare('SELECT read_policy_digest FROM experience_sponsor_intake_read_policies').get().read_policy_digest,'prejob-digest');
  }finally{db.close();}
});

test('hard validation ceilings are accepted only as explicitly supplied reviewed terms',()=>{
  const raw={version:1,windowMs:31_536_000_000,
    operations:Object.fromEntries(SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.map(operation=>[operation,{maximumBytes:192_000_000,deadlineMs:30_000}])),
    actor:{maximumRequestsPerWindow:1_000_000,maximumBytesPerWindow:1_000_000_000_000},
    campaign:{maximumRequestsPerWindow:1_000_000,maximumBytesPerWindow:1_000_000_000_000}};
  assert.deepEqual(readSponsorIntakeReadPolicy(raw),raw);
  for(const mutate of [p=>p.windowMs++,p=>p.actor.maximumRequestsPerWindow++,p=>p.campaign.maximumBytesPerWindow++,
    p=>p.operations['image-intake-bootstrap'].maximumBytes++,p=>p.operations['image-intake-draft'].deadlineMs++]){
    const changed=structuredClone(raw);mutate(changed);assert.throws(()=>readSponsorIntakeReadPolicy(changed),/sponsor_intake_read_policy_invalid/);
  }
});
