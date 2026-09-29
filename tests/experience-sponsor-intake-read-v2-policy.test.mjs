import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{readSponsorIntakeReadPolicy,SPONSOR_IMAGE_INTAKE_READ_OPERATIONS,SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS,
  SPONSOR_INTAKE_READ_POLICY_SCHEMA},{SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA},
  {canonicalJson,digest}]=await Promise.all([
  import('../worker/experience-sponsor-intake-read-policy.ts'),import('../worker/experience-sponsor-intake-read-attempts.ts'),
  import('../src/experiences/compiler.ts'),
]);
const operation='image-output-confirmation';
const policy=(version=2)=>({version,windowMs:60_000,
  operations:Object.fromEntries((version===1?SPONSOR_IMAGE_INTAKE_READ_OPERATIONS:SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS)
    .map(key=>[key,{maximumBytes:8192,deadlineMs:1000}])),
  actor:{maximumRequestsPerWindow:5,maximumBytesPerWindow:40_960},
  campaign:{maximumRequestsPerWindow:10,maximumBytesPerWindow:81_920}});

test('V1 retains exactly its three operations while explicit V2 captures a frozen fourth scope',async()=>{
  const v1=policy(1),v2=policy(),captured=readSponsorIntakeReadPolicy(v2);
  assert.deepEqual(readSponsorIntakeReadPolicy(v1),v1);
  assert.equal(canonicalJson(readSponsorIntakeReadPolicy(v1)),canonicalJson(v1));
  // Captured from the unchanged 72f3999 V1 parser with this fixture policy.
  assert.equal(await digest(readSponsorIntakeReadPolicy(v1)),
    'sha256:860daa04a801a3336c14e4e6b65c72037a5467052655d784cb7d6edda2ca9319');
  assert.equal(SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.length,3);
  assert.deepEqual(SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS,[...SPONSOR_IMAGE_INTAKE_READ_OPERATIONS,operation]);
  assert.equal(captured.version,2);assert.deepEqual(captured,v2);assert.ok(Object.isFrozen(captured.operations[operation]));
  v2.operations[operation].maximumBytes=1;assert.equal(captured.operations[operation].maximumBytes,8192);
  assert.throws(()=>readSponsorIntakeReadPolicy({...policy(),version:1}),/sponsor_intake_read_policy_invalid/);
  assert.throws(()=>readSponsorIntakeReadPolicy({...policy(1),version:2}),/sponsor_intake_read_policy_invalid/);
});

test('V2 cannot imply defaults or unrelated generation, media, resource, history or guest operations',()=>{
  for(const key of [operation,...SPONSOR_IMAGE_INTAKE_READ_OPERATIONS]){
    const raw=policy();delete raw.operations[key];assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
  for(const key of ['image-status','image-result','image-media','output-history','preflight','issuance','image-text-draft-storage','upload','guest-claim']){
    const raw=policy();raw.operations[key]={maximumBytes:1,deadlineMs:1};
    assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);
  }
  for(const extra of [{version:3},{nowMs:1},{enabled:true}])assert.throws(()=>readSponsorIntakeReadPolicy({...policy(),...extra}),/sponsor_intake_read_policy_invalid/);
});

test('the added operation has the same explicit safe-integer and coherent allowance ceilings',()=>{
  for(const [key,values] of [['maximumBytes',[0,-1,1.5,'10',NaN,Infinity,192_000_001,Number.MAX_SAFE_INTEGER]],
    ['deadlineMs',[0,-1,1.5,'10',NaN,Infinity,30_001,Number.MAX_SAFE_INTEGER]]]){
    for(const value of values){const raw=policy();raw.operations[operation][key]=value;
      assert.throws(()=>readSponsorIntakeReadPolicy(raw),/sponsor_intake_read_policy_invalid/);}
  }
  const incoherent=policy();incoherent.operations[operation].maximumBytes=incoherent.actor.maximumBytesPerWindow+1;
  assert.throws(()=>readSponsorIntakeReadPolicy(incoherent),/sponsor_intake_read_policy_invalid/);
  const maximum=policy();maximum.operations[operation]={maximumBytes:192_000_000,deadlineMs:30_000};
  maximum.actor.maximumBytesPerWindow=192_000_000;maximum.campaign.maximumBytesPerWindow=192_000_000;
  assert.deepEqual(readSponsorIntakeReadPolicy(maximum),maximum);
});

test('V2 rejects accessors and hidden or cyclic data without invoking caller code',()=>{
  let invoked=0;const accessor=policy();Object.defineProperty(accessor.operations[operation],'maximumBytes',{
    enumerable:true,get(){invoked++;return 1;}});
  assert.throws(()=>readSponsorIntakeReadPolicy(accessor),/sponsor_intake_read_policy_invalid/);assert.equal(invoked,0);
  const symbolic=policy();symbolic.operations[operation][Symbol('extra')]=1;
  assert.throws(()=>readSponsorIntakeReadPolicy(symbolic),/sponsor_intake_read_policy_invalid/);
  const cyclic=policy();cyclic.operations[operation]=cyclic;
  assert.throws(()=>readSponsorIntakeReadPolicy(cyclic),/sponsor_intake_read_policy_invalid/);
});

function database(t,schema){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,0);
  db.exec('PRAGMA foreign_keys=ON');db.exec('CREATE TABLE experience_sponsor_campaigns(campaign_id TEXT PRIMARY KEY)');
  for(const sql of [...SPONSOR_INTAKE_READ_POLICY_SCHEMA,...schema])db.exec(sql);
  db.exec("INSERT INTO experience_sponsor_campaigns VALUES('campaign')");
  db.exec("INSERT INTO experience_sponsor_intake_read_policies VALUES('campaign','sponsor','read','{}','review')");
  return db;
}
const insert="INSERT INTO experience_sponsor_intake_read_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)";
const row=op=>['attempt','campaign','sponsor','read','actor','draft:original',op,8192,1000,2000,62000];

test('installed V1 schema remains closed and importing the fresh V2 export does not migrate it',t=>{
  const db=database(t,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA);
  const before=db.prepare("SELECT sql FROM sqlite_master WHERE name='experience_sponsor_intake_read_attempts'").get().sql;
  assert.throws(()=>db.prepare(insert).run(...row(operation)),/CHECK constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_attempts').get().n,0);
  db.prepare(insert).run(...row('image-intake-receipt'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_attempts').get().n,1);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='experience_sponsor_intake_read_attempts'").get().sql,before);
});

test('explicit fresh V2 schema admits only the additional operation and retains immutable accounting rows',t=>{
  const db=database(t,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA);
  for(const op of ['preflight','image-status','output-history'])assert.throws(()=>db.prepare(insert).run(...row(op)),/CHECK constraint failed/);
  db.prepare(insert).run(...row(operation));const saved=db.prepare('SELECT * FROM experience_sponsor_intake_read_attempts').all();
  assert.equal(saved.length,1);assert.equal(saved[0].operation,operation);
  assert.throws(()=>db.exec('UPDATE experience_sponsor_intake_read_attempts SET maximum_bytes=1'),/immutable/);
  assert.throws(()=>db.exec('DELETE FROM experience_sponsor_intake_read_attempts'),/immutable/);
  assert.throws(()=>db.prepare(insert.replace('INSERT','INSERT OR REPLACE')).run(...row(operation)),/exists/);
  assert.throws(()=>db.exec('SELECT rowid FROM experience_sponsor_intake_read_attempts'),/no such column/);
  assert.deepEqual(db.prepare('SELECT * FROM experience_sponsor_intake_read_attempts').all(),saved);
});
