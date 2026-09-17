import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SPONSOR_READ_POLICY_SCHEMA,readSponsorReadPolicy,SPONSOR_IMAGE_READ_OPERATIONS} from '../worker/experience-sponsor-read-policy.ts';

const policy=()=>({version:1,windowMs:60_000,
  operations:{'image-status':{maximumBytes:100,deadlineMs:10_000},'image-result':{maximumBytes:200,deadlineMs:10_000},'image-media':{maximumBytes:1000,deadlineMs:30_000}},
  actor:{maximumRequestsPerWindow:3,maximumBytesPerWindow:3000},campaign:{maximumRequestsPerWindow:6,maximumBytesPerWindow:6000}});

test('read policy is an explicit frozen closed original Image contract with no default allowance',()=>{
  const raw=policy(),captured=readSponsorReadPolicy(raw);raw.operations['image-media'].maximumBytes=1;
  assert.equal(captured.operations['image-media'].maximumBytes,1000);assert.ok(Object.isFrozen(captured.operations['image-media']));
  assert.deepEqual(Object.keys(captured.operations).sort(),[...SPONSOR_IMAGE_READ_OPERATIONS].sort());
  for(const raw of [undefined,{},null,{version:1}, {...policy(),version:2},{...policy(),enabled:true},{...policy(),expiresAtMs:1},{...policy(),nowMs:1}]){
    assert.throws(()=>readSponsorReadPolicy(raw),/sponsor_read_policy_invalid/);
  }
});

test('operation categories cannot widen or inherit generation permissions',()=>{
  for(const changes of [operations=>delete operations['image-result'],operations=>operations.upload={maximumBytes:1,deadlineMs:1},
    operations=>operations['image-result']={...operations['image-result'],maximumRequests:1},operations=>operations['image-media']='unlimited']){
    const raw=policy();changes(raw.operations);assert.throws(()=>readSponsorReadPolicy(raw),/sponsor_read_policy_invalid/);
  }
  const inherited=policy();Object.setPrototypeOf(inherited.operations,{'image-edit':{maximumBytes:1,deadlineMs:1}});
  assert.throws(()=>readSponsorReadPolicy(inherited),/sponsor_read_policy_invalid/);
});

test('all resource values are safe bounded positive integers with coherent actor and campaign ceilings',()=>{
  for(const value of [0,-1,NaN,Infinity,1.5,'2',Number.MAX_SAFE_INTEGER])for(const field of ['windowMs','maximumBytes','deadlineMs','maximumRequestsPerWindow','maximumBytesPerWindow']){
    const raw=policy();if(field==='windowMs')raw.windowMs=value;
    else if(['maximumBytes','deadlineMs'].includes(field))raw.operations['image-status'][field]=value;
    else raw.actor[field]=value;
    assert.throws(()=>readSponsorReadPolicy(raw),/sponsor_read_policy_invalid/,`${field}=${value}`);
  }
  for(const mutate of [raw=>raw.actor.maximumRequestsPerWindow=7,raw=>raw.actor.maximumBytesPerWindow=6001,
    raw=>raw.operations['image-media'].maximumBytes=3001,raw=>raw.operations['image-media'].maximumBytes=192_000_001,
    raw=>raw.operations['image-media'].deadlineMs=30_001,raw=>raw.campaign.extra=1]){
    const raw=policy();mutate(raw);assert.throws(()=>readSponsorReadPolicy(raw),/sponsor_read_policy_invalid/);
  }
});

test('policy validation never invokes getters, accepts cycles or keeps mutable caller references',()=>{
  const getter=policy();Object.defineProperty(getter.operations['image-media'],'maximumBytes',{enumerable:true,get(){throw Error('Getter must not run');}});
  assert.throws(()=>readSponsorReadPolicy(getter),/sponsor_read_policy_invalid/);
  const cyclic=policy();cyclic.operations['image-media']=cyclic;assert.throws(()=>readSponsorReadPolicy(cyclic),/sponsor_read_policy_invalid/);
  const symbolic=policy();symbolic[Symbol('policy')]=1;assert.throws(()=>readSponsorReadPolicy(symbolic),/sponsor_read_policy_invalid/);
});

test('dormant policy schema preserves immutable review terms against update, delete and replace',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,0);
  db.exec('CREATE TABLE experience_sponsor_campaigns(campaign_id TEXT PRIMARY KEY)');
  for(const sql of SPONSOR_READ_POLICY_SCHEMA)db.exec(sql);
  db.exec("INSERT INTO experience_sponsor_campaigns VALUES('campaign')");
  const insert="INSERT INTO experience_sponsor_read_policies VALUES('campaign','sponsor-digest','read-digest','{}','review-digest')";db.exec(insert);
  assert.throws(()=>db.exec("UPDATE experience_sponsor_read_policies SET policy_json='null'"),/immutable/);
  assert.throws(()=>db.exec('DELETE FROM experience_sponsor_read_policies'),/immutable/);
  assert.throws(()=>db.exec(insert.replace('INSERT','INSERT OR REPLACE')),/exists/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_read_policies').get().n,1);
});
