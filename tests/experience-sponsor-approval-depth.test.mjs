import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,headersFor} from './sponsor-initial-intake-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{loadApprovedSponsorCampaign,sponsorApprovalAssertion},{outputAssertionStatements},{PRINCIPAL_WITH_ACCESS_SQL},{POLICY_VERSION}]=await Promise.all([
  import('../worker/experience-sponsor-approval.ts'),import('../worker/output-command-core.ts'),
  import('../worker/access-policy.ts'),import('../worker/pilot-policy.ts'),
]);
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Sponsor approval depth tests prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});

// These are the persisted authority contract's ten fields, not a reproduction of
// its SQL. Real access tables below let each computed field change independently.
const snapshotFields=['user_id','role','consent_version','updated_at','permission_epoch','grants_json',
  'organizations_json','projects_json','identity_policies_json','approved_canvas_requirements'];
const time='2020-01-01T00:00:00.000Z',epoch='2030-01-01T00:00:00.000Z';
const request=(f,actor=f.actor)=>new Request('http://localhost/__fixture/sponsor-approval-depth',{headers:headersFor(actor)});
const currentSnapshot=(f,userId=f.payer)=>{
  const row=f.sqlite.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(userId);
  return row?snapshotFields.map(field=>row[field]??null):null;
};
const storedSnapshot=f=>JSON.parse(f.sqlite.prepare('SELECT payer_authority_json FROM experience_sponsor_approvals WHERE campaign_id=?').get(f.campaignId).payer_authority_json);
const nativeTables=['experience_sponsor_approvals','experience_sponsor_campaigns','experience_sponsor_resource_policies',
  'experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_intakes',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','events','private_content','output_commands','output_preflights',
  'output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations',
  'budget_counters','cost_budget_counters','output_atomic_assertions','fixture_sponsor_guard_effects'];
const nativeRows=f=>Object.fromEntries(nativeTables.map(table=>[table,
  f.sqlite.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));

function seedAuthority(f){
  f.sqlite.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(time,f.payer);
  f.sqlite.prepare(`INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at)
    VALUES('depth-org','Original organization',?,'active',?,?)`).run(f.payer,time,time);
  f.sqlite.prepare(`INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at)
    VALUES('depth-member','depth-org',?,'owner','active',?,?,?,?)`).run(f.payer,f.payer,time,time,time);
  f.sqlite.prepare(`INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at)
    VALUES('depth-project-access','depth-project','depth-org',?,'active',?,?)`).run(f.payer,time,time);
  f.sqlite.prepare(`INSERT INTO organization_security_policies(organization_id,authentication_source,allowed_domains_json,require_mfa,version,updated_by_user_id,updated_at)
    VALUES('depth-org','any','[]',0,1,?,?)`).run(f.payer,time);
  f.sqlite.prepare(`INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,status,granted_by_user_id,created_at,updated_at)
    VALUES('depth-active-grant',?,'self.usage.read','self','active',?,?,?),
      ('depth-epoch-grant',?,'self.profile.read','self','revoked',?,?,?)`).run(f.payer,f.payer,time,time,f.payer,f.payer,time,epoch);
  f.sqlite.prepare(`INSERT INTO canvas_governance_requirements(requirement_id,status,details_json,updated_at)
    VALUES('trust_safety','approved','{}',?) ON CONFLICT(requirement_id) DO UPDATE SET status='approved',details_json='{}',updated_at=excluded.updated_at`).run(time);
}

async function setup(t,{eligibleOnly=false}={}){
  const f=await fixture(t,{approved:false,extraActorUserIds:eligibleOnly?['depth-eligible','depth-outsider']:[]});
  seedAuthority(f);
  f.sqlite.exec('CREATE TABLE fixture_sponsor_guard_effects(effect_id TEXT PRIMARY KEY NOT NULL) WITHOUT ROWID');
  const proposal=structuredClone(f.proposal);
  if(eligibleOnly){proposal.eligibleActorUserIds=[f.actor,'depth-eligible'];proposal.issuerUserIds=[f.actor];}
  await f.approve({proposal});
  f.depth=enforceD1ExpressionDepth(f);
  t.after(()=>{f.depth.assertVerified();f.depth.restore();});
  f.load=(actor=f.actor)=>loadApprovedSponsorCampaign(request(f,actor),f.env,f.campaignId);
  f.guard=(actor=f.actor,requireIssuer=false,policy=f.policy)=>f.env.DB.batch(
    outputAssertionStatements(f.env,sponsorApprovalAssertion(policy,actor,requireIssuer)));
  return f;
}

test('actual campaign loader and both atomic issuer modes compile at depth 100 and retain all ten payer fields',async t=>{
  const f=await setup(t),before=nativeRows(f),captured=storedSnapshot(f);
  assert.equal(captured.length,10);assert.deepEqual(currentSnapshot(f),captured);
  for(const field of ['grants_json','organizations_json','projects_json','identity_policies_json']){
    assert.ok(JSON.parse(captured[snapshotFields.indexOf(field)]).length>0,`${field} must exercise actual retained authority`);
  }
  assert.equal(captured[9],1);
  const loaded=await f.load();assert.equal(loaded.actor.userId,f.actor);assert.deepEqual(loaded.policy,f.policy);
  assert.equal(loaded.policyDigest,f.compiled.policyDigest);
  await f.guard();await f.guard(f.actor,true);
  assert.deepEqual(nativeRows(f),before);
});

test('each of the ten persisted payer fields rejects independent current authority drift at depth 100',async t=>{
  const f=await setup(t),captured=storedSnapshot(f),before=nativeRows(f);
  const mutations=[
    ['user_id',"UPDATE users SET user_id='depth-renamed-payer' WHERE user_id=?",[f.payer]],
    ['role',"UPDATE users SET role='admin' WHERE user_id=?",[f.payer]],
    ['consent_version',"UPDATE users SET consent_version='not-current' WHERE user_id=?",[f.payer]],
    ['updated_at',"UPDATE users SET updated_at='2021-01-01T00:00:00.000Z' WHERE user_id=?",[f.payer]],
    ['permission_epoch',"UPDATE capability_grants SET updated_at='2031-01-01T00:00:00.000Z' WHERE grant_id='depth-epoch-grant'",[]],
    ['grants_json',"UPDATE capability_grants SET capability='self.privacy.manage' WHERE grant_id='depth-active-grant'",[]],
    ['organizations_json',"UPDATE organizations SET name='Changed organization' WHERE organization_id='depth-org'",[]],
    ['projects_json',"UPDATE organization_projects SET project_id='depth-changed-project' WHERE project_access_id='depth-project-access'",[]],
    ['identity_policies_json',"UPDATE organization_security_policies SET version=2 WHERE organization_id='depth-org'",[]],
    ['approved_canvas_requirements',"UPDATE canvas_governance_requirements SET status='pending' WHERE requirement_id='trust_safety'",[]],
  ];
  assert.deepEqual(mutations.map(([field])=>field),snapshotFields);
  for(const [field,sql,bindings] of mutations){
    try{
      f.sqlite.prepare(sql).run(...bindings);
      const current=currentSnapshot(f);
      if(field==='user_id')assert.equal(current,null);
      else assert.deepEqual(snapshotFields.filter((_,index)=>current[index]!==captured[index]),[field],`${field} must not rely on another changed snapshot field`);
      // Execute real D1-shaped assertions, not merely a raw SELECT predicate.
      await assert.rejects(f.guard(),/CHECK constraint failed/,field);
      await assert.rejects(f.load(),undefined,field);
    }finally{
      // Restore only the synthetic authority state; approval/custody/money records
      // must remain unchanged through every denial.
      if(field==='user_id')f.sqlite.prepare('UPDATE users SET user_id=? WHERE user_id=?').run(f.payer,'depth-renamed-payer');
      else if(field==='role')f.sqlite.prepare('UPDATE users SET role=? WHERE user_id=?').run(captured[1],f.payer);
      else if(field==='consent_version')f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(captured[2],f.payer);
      else if(field==='updated_at')f.sqlite.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(captured[3],f.payer);
      else if(field==='permission_epoch')f.sqlite.prepare("UPDATE capability_grants SET updated_at=? WHERE grant_id='depth-epoch-grant'").run(epoch);
      else if(field==='grants_json')f.sqlite.exec("UPDATE capability_grants SET capability='self.usage.read' WHERE grant_id='depth-active-grant'");
      else if(field==='organizations_json')f.sqlite.exec("UPDATE organizations SET name='Original organization' WHERE organization_id='depth-org'");
      else if(field==='projects_json')f.sqlite.exec("UPDATE organization_projects SET project_id='depth-project' WHERE project_access_id='depth-project-access'");
      else if(field==='identity_policies_json')f.sqlite.exec("UPDATE organization_security_policies SET version=1 WHERE organization_id='depth-org'");
      else f.sqlite.exec("UPDATE canvas_governance_requirements SET status='approved' WHERE requirement_id='trust_safety'");
    }
    assert.deepEqual(currentSnapshot(f),captured,field);assert.deepEqual(nativeRows(f),before,field);
    await f.guard();
  }
});

test('eligibility remains mandatory while issuer authority is required only for issuance',async t=>{
  const f=await setup(t,{eligibleOnly:true}),before=nativeRows(f);
  await f.guard('depth-eligible',false);
  await assert.rejects(f.guard('depth-eligible',true),/CHECK constraint failed/);
  await assert.rejects(f.load('depth-eligible'));
  await f.guard(f.actor,true);assert.equal((await f.load()).actor.userId,f.actor);
  for(const actor of ['depth-outsider',f.payer])for(const requireIssuer of [false,true]){
    await assert.rejects(f.guard(actor,requireIssuer),/CHECK constraint failed/);
  }
  assert.deepEqual(nativeRows(f),before);
});

test('revoking the original payer approval rejects both loader and transaction guard while campaign stays enabled',async t=>{
  const f=await setup(t);await f.load();
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1 WHERE campaign_id=?').run(f.campaignId);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns WHERE campaign_id=?').get(f.campaignId).enabled,1);
  const before=nativeRows(f);
  await assert.rejects(f.load());await assert.rejects(f.guard(),/CHECK constraint failed/);
  assert.deepEqual(nativeRows(f),before);
});

test('loader still requires the current canonical actor consent independently of the unchanged payer',async t=>{
  const f=await setup(t),captured=storedSnapshot(f);await f.load();
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
  const before=nativeRows(f);assert.deepEqual(currentSnapshot(f),captured);
  await assert.rejects(f.load());assert.deepEqual(nativeRows(f),before);
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,f.actor);
  assert.equal((await f.load()).actor.userId,f.actor);
});

test('atomic proof retains exact campaign, payer, terms digest and policy bindings after SQL factoring',async t=>{
  const f=await setup(t),before=nativeRows(f);
  const changes=[policy=>policy.campaignId='different-campaign',policy=>policy.payerUserId=f.actor,
    policy=>policy.approvalReceiptDigest=`sha256:${'f'.repeat(64)}`,policy=>policy.maximumMicrousd++];
  for(const change of changes){const policy=structuredClone(f.policy);change(policy);await assert.rejects(f.guard(f.actor,true,policy),/CHECK constraint failed/);}
  await f.guard(f.actor,true);assert.deepEqual(nativeRows(f),before);
});

test('loader rechecks payer authority at its batch commit edge after successful pre-reads',async t=>{
  const f=await setup(t),batch=f.env.DB.batch.bind(f.env.DB);await f.load();
  let changed=false,afterChange;
  f.env.DB.batch=async statements=>{
    if(!changed){changed=true;f.sqlite.exec("UPDATE capability_grants SET capability='self.privacy.manage' WHERE grant_id='depth-active-grant'");afterChange=nativeRows(f);}
    return batch(statements);
  };
  await assert.rejects(f.load(),/CHECK constraint failed/);assert.equal(changed,true);
  assert.deepEqual(nativeRows(f),afterChange);
  assert.equal(f.sqlite.prepare("SELECT capability FROM capability_grants WHERE grant_id='depth-active-grant'").get().capability,'self.privacy.manage');
});

test('preconstructed approval proofs see in-transaction drift and roll back every earlier batch write',async t=>{
  const f=await setup(t),before=nativeRows(f),captured=currentSnapshot(f);
  const mutations=[
    "UPDATE capability_grants SET capability='self.privacy.manage' WHERE grant_id='depth-active-grant'",
    'UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1',
  ];
  for(const [index,sql] of mutations.entries()){
    const proof=outputAssertionStatements(f.env,sponsorApprovalAssertion(f.policy,f.actor,true));
    await assert.rejects(f.env.DB.batch([
      f.env.DB.prepare('INSERT INTO fixture_sponsor_guard_effects(effect_id) VALUES(?)').bind(`effect-${index}`),
      f.env.DB.prepare(sql),...proof,
    ]),/CHECK constraint failed/);
    assert.deepEqual(nativeRows(f),before);assert.deepEqual(currentSnapshot(f),captured);
    await f.guard(f.actor,true);
  }
});
