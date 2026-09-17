import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture} from './sponsor-driver-fixture.mjs';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
const [{SPONSOR_READ_APPROVAL_SCHEMA,prepareSponsorReadApproval,approveSponsorReadPolicy},{SPONSOR_READ_POLICY_SCHEMA},
  {revokeSponsorCampaign},{canonicalJson,digest},{handleSession,POLICY_VERSION},read,attempts]=await Promise.all([
  import('../worker/experience-sponsor-read-approval.ts'),import('../worker/experience-sponsor-read-policy.ts'),
  import('../worker/experience-sponsor-approval.ts'),import('../src/experiences/compiler.ts'),import('../worker/pilot-policy.ts'),
  import('../worker/experience-sponsor-read-image.ts'),import('../worker/experience-sponsor-read-attempts.ts'),
]);
const originalFetch=globalThis.fetch;let fetches=0;
globalThis.fetch=()=>{fetches++;throw Error('Read approval tests prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(fetches,0);});
const url='http://localhost/__fixture/read-policy-approval';
const policy=()=>({version:1,windowMs:60_000,operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes:32_000_000,deadlineMs:10_000}])),
  actor:{maximumRequestsPerWindow:5,maximumBytesPerWindow:160_000_000},campaign:{maximumRequestsPerWindow:10,maximumBytesPerWindow:320_000_000}});
const request=(body,headers,extra={})=>new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),...extra});
const rows=f=>({policies:f.sqlite.prepare('SELECT * FROM experience_sponsor_read_policies ORDER BY rowid').all(),approvals:f.sqlite.prepare('SELECT * FROM experience_sponsor_read_approvals ORDER BY rowid').all()});
const nativeRows=f=>Object.fromEntries(['experience_sponsor_approvals','experience_sponsor_campaigns','experience_sponsor_resource_policies',
  'experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_active_jobs',
  'budget_reservations','cost_budget_reservations'].map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
async function setup(t,{completed=false,...options}={}){
  const f=completed?await sponsorReadFixture(t):await fixture(t,options);
  if(!completed)for(const sql of SPONSOR_READ_POLICY_SCHEMA)f.sqlite.exec(sql);
  for(const sql of SPONSOR_READ_APPROVAL_SCHEMA)f.sqlite.exec(sql);
  f.readProposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:policy()};
  f.prepare=(proposal=f.readProposal,headers=f.payerHeaders)=>prepareSponsorReadApproval(request({action:'prepare-sponsor-read-policy',proposal},headers),f.env);
  f.command=async(proposal=f.readProposal,approvalId='read-approval-1')=>({action:'approve-sponsor-read-policy',approvalId,proposal,
    reviewedTermsDigest:(await f.prepare(proposal)).termsDigest,confirmation:'APPROVE_SPONSOR_READ_POLICY'});
  f.commit=(command,headers=f.payerHeaders)=>approveSponsorReadPolicy(request(command,headers),f.env);
  return f;
}

test('authenticated payer prepares exact explicit terms without writes; commits native provenance and read policy atomically once',async t=>{
  const f=await setup(t),before=nativeRows(f),prepared=await f.prepare();
  assert.deepEqual(rows(f),{policies:[],approvals:[]});assert.deepEqual(nativeRows(f),before);
  assert.equal(prepared.terms.payerUserId,f.payer);assert.equal(prepared.terms.originalApprovalId,f.approval.approvalId);
  assert.deepEqual(prepared.terms.proposal,f.readProposal);assert.equal(prepared.termsDigest,await digest(prepared.terms));
  assert.ok(Object.isFrozen(prepared.terms.proposal.readPolicy.operations));
  const command=await f.command(),first=await f.commit(command),stored=rows(f);
  assert.equal(first.replayed,false);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
  const p=stored.policies[0],a=stored.approvals[0];assert.equal(p.policy_json,canonicalJson(f.readProposal.readPolicy));
  assert.equal(p.sponsor_policy_digest,f.compiled.policyDigest);assert.equal(p.read_policy_digest,prepared.readPolicyDigest);
  assert.equal(p.review_receipt_digest,await digest(JSON.parse(a.review_receipt_json)));assert.equal(a.approved_by_user_id,f.payer);
  assert.deepEqual(JSON.parse(a.approval_command_json),command);assert.ok(Number.isSafeInteger(a.approved_at_ms)&&a.approved_at_ms>0);
  assert.deepEqual(await f.commit(structuredClone(command)),{...first,replayed:true});assert.deepEqual(rows(f),stored);assert.deepEqual(nativeRows(f),before);
});

test('eligible issuer and unrelated admin cannot provision the original payer policy',async t=>{
  const f=await setup(t),command=await f.command(),headers={'oai-authenticated-user-id':'read-other-admin','oai-authenticated-user-email':'read-other-admin@example.invalid'};
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET role='admin',consent_version=? WHERE user_id='read-other-admin'").run(POLICY_VERSION);
  for(const auth of [f.actorHeaders,headers]){
    await assert.rejects(f.prepare(f.readProposal,auth),/sponsor_read_payer_approval_required/);
    await assert.rejects(f.commit(command,auth),/sponsor_read_payer_approval_required/);
  }
  assert.deepEqual(rows(f),{policies:[],approvals:[]});
});

for(const [name,change] of [
  ['missing confirmation',c=>delete c.confirmation],['wrong action',c=>c.action='approve'],['unknown field',c=>c.enabled=true],
  ['changed reviewed limits',c=>c.proposal.readPolicy.actor.maximumRequestsPerWindow++],['wrong reviewed digest',c=>c.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`],
  ['wrong original sponsor digest',c=>c.proposal.sponsorPolicyDigest=`sha256:${'f'.repeat(64)}`],['wrong campaign',c=>c.proposal.campaignId='another-campaign'],
  ['caller payer override',c=>c.proposal.payerUserId='another-payer'],['missing operation',c=>delete c.proposal.readPolicy.operations['image-media']],
  ['unknown operation',c=>c.proposal.readPolicy.operations.upload={maximumBytes:1,deadlineMs:1}],['absent limits',c=>delete c.proposal.readPolicy],
])test(`${name} cannot be provisioned and does not alter native authority or costs`,async t=>{
  const f=await setup(t),command=await f.command(),before=nativeRows(f);change(command);
  await assert.rejects(f.commit(command));assert.deepEqual(rows(f),{policies:[],approvals:[]});assert.deepEqual(nativeRows(f),before);
});

test('borrowed GET, non-JSON and oversized command cannot prepare or commit',async t=>{
  const f=await setup(t),command=await f.command();
  for(const action of [prepareSponsorReadApproval,approveSponsorReadPolicy]){
    await assert.rejects(action(new Request(url,{headers:f.payerHeaders}),f.env),/sponsor_explicit_command_required/);
    await assert.rejects(action(request(command,f.payerHeaders,{headers:{...f.payerHeaders,'content-type':'text/plain'}}),f.env),/sponsor_explicit_command_required/);
    await assert.rejects(action(request(command,f.payerHeaders,{body:' '.repeat(131073)}),f.env),/sponsor_command_too_large/);
  }
  assert.deepEqual(rows(f),{policies:[],approvals:[]});
});

for(const [name,mutate] of [
  ['payer authority changed',f=>f.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?").run(f.payer)],
  ['payer consent removed',f=>f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.payer)],
  ['campaign disabled',f=>f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0').run()],
  ['generation approval revoked',f=>f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1').run()],
  ['canonical campaign replaced',f=>f.sqlite.prepare("UPDATE experience_sponsor_campaigns SET policy_json='{}'").run()],
])test(`${name} between review and commit refuses provisioning`,async t=>{
  const f=await setup(t),command=await f.command();mutate(f);const before=nativeRows(f);
  await assert.rejects(f.commit(command));assert.deepEqual(rows(f),{policies:[],approvals:[]});assert.deepEqual(nativeRows(f),before);
});

test('payer authority change after final pre-read fails in the same native transaction without a policy orphan',async t=>{
  const f=await setup(t),command=await f.command(),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{
    if(!changed&&statements.some(s=>s.sql.includes('INSERT INTO experience_sponsor_read_policies'))){changed=true;f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.payer);}
    return batch.call(f.DB,statements);
  };
  await assert.rejects(f.commit(command));assert.equal(changed,true);assert.deepEqual(rows(f),{policies:[],approvals:[]});
});

test('failure inserting provenance rolls back its policy row and leaves native money authority untouched',async t=>{
  const f=await setup(t),command=await f.command(),before=nativeRows(f);
  f.sqlite.exec("CREATE TRIGGER fixture_reject_read_approval BEFORE INSERT ON experience_sponsor_read_approvals BEGIN SELECT RAISE(ABORT,'fixture_commit_failure'); END");
  await assert.rejects(f.commit(command),/fixture_commit_failure/);assert.deepEqual(rows(f),{policies:[],approvals:[]});assert.deepEqual(nativeRows(f),before);
});

test('lost commit acknowledgment recovers exactly one immutable original without resetting usage',async t=>{
  const f=await setup(t),command=await f.command(),batch=f.DB.batch;let lost=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);
    if(!lost&&statements.some(s=>s.sql.includes('INSERT INTO experience_sponsor_read_approvals'))){lost=true;throw Error('fixture_lost_ack');}return result;};
  const result=await f.commit(command);assert.equal(lost,true);assert.equal(result.replayed,true);
  assert.equal(rows(f).policies.length,1);assert.equal(rows(f).approvals.length,1);
});

test('simultaneous exact commits preserve one original; different terms or approval IDs cannot replace it',async t=>{
  const f=await setup(t),command=await f.command(),results=await Promise.all([f.commit(command),f.commit(structuredClone(command))]);
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);const stored=rows(f);
  await assert.rejects(f.commit({...command,approvalId:'other-read-approval'}));
  const changed=structuredClone(f.readProposal);changed.readPolicy.actor.maximumRequestsPerWindow++;
  await assert.rejects(f.commit(await f.command(changed)));assert.deepEqual(rows(f),stored);
});

test('policy and provenance are immutable against update, delete and replace',async t=>{
  const f=await setup(t);await f.commit(await f.command());const stored=rows(f);
  for(const table of ['experience_sponsor_read_approvals','experience_sponsor_read_policies']){
    const column=table.endsWith('approvals')?'terms_json':'policy_json';
    assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET ${column}='{}'`),/immutable/);
    assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/);
    assert.throws(()=>f.sqlite.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/exists/);
  }
  assert.deepEqual(rows(f),stored);
});

test('real provisioned completed owner read survives generation revocation without new provisioning or cost changes',async t=>{
  const f=await setup(t,{completed:true});await f.commit(await f.command());
  await revokeSponsorCampaign(request({action:'revoke-sponsor-campaign',campaignId:f.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},f.payerHeaders),f.env);
  f.sqlite.prepare('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1').run();
  f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'").run();
  const before=nativeRows(f),approvedRows=rows(f),req=f.readRequest(),authority=await read.identifySponsorImageRead(req,f.env,{jobId:f.jobId});
  const attempt=await attempts.reserveSponsorImageReadAttempt(authority,req,f.env,'image-result');
  const result=await read.resolveSponsorImageRead(authority,attempt,req,f.env);
  assert.equal(result.status,'completed');assert.equal(result.original.sourceEventId,f.completionEvent.eventId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_read_attempts').get().n,1);
  assert.deepEqual(rows(f),approvedRows);assert.deepEqual(nativeRows(f),before);
  assert.deepEqual(f.readEffects,{fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0});
});

for(const column of ['terms_json','policy_json','payer_authority_json','approval_command_json'])for(const corruption of ['oversized','NUL','BLOB'])
  test(`stored ${column} ${corruption} is rejected before its cell crosses SQLite boundary`,async t=>{
    const f=await setup(t),command=await f.command(),prepare=f.DB.prepare;
    f.sqlite.exec('DROP TRIGGER experience_sponsor_approval_immutable');
    const value=corruption==='oversized'?'梨'.repeat(100_000):corruption==='NUL'?'[]\u0000tail':Buffer.from('[]');
    f.sqlite.prepare(`UPDATE experience_sponsor_approvals SET ${column}=?`).run(value);let sampled=false,returnedCell;
    f.DB.prepare=sql=>{
      const statement=prepare.call(f.DB,sql);
      if(!sql.includes('FROM experience_sponsor_approvals approval WHERE'))return statement;
      return {bind(...bindings){const bound=statement.bind(...bindings);return {async first(){const row=await bound.first();sampled=true;returnedCell=row[column];return row;}};}};
    };
    await assert.rejects(f.commit(command));assert.equal(sampled,true);assert.ok(returnedCell===null,'malformed stored JSON cell must not be returned');assert.deepEqual(rows(f),{policies:[],approvals:[]});
  });

for(const [name,change] of [
  ['payer email',f=>f.sqlite.prepare("UPDATE users SET email='changed@example.invalid' WHERE user_id=?").run(f.payer)],
  ['campaign policy',f=>f.sqlite.prepare("UPDATE experience_sponsor_campaigns SET policy_digest='changed'").run()],
  ...['linked','unlinked'].map(linkage=>[`active ${linkage} pilot membership`,f=>{
    f.sqlite.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES('race-cohort','race-org','active','2020','2099',?,'2020','2020')").run(f.payer);
    f.sqlite.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,status,invited_by_user_id,created_at) VALUES('race-participant','race-cohort','race-org',?,?,'active',?,'2020')")
      .run(`${f.payer}@example.invalid`,linkage==='linked'?f.payer:null,f.payer);
  }]),
])test(`changed ${name} between pre-read and atomic insert refuses both policy and provenance`,async t=>{
  const f=await setup(t),command=await f.command(),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.includes('INSERT INTO experience_sponsor_read_policies'))){changed=true;change(f);}return batch.call(f.DB,statements);};
  await assert.rejects(f.commit(command));assert.equal(changed,true);assert.deepEqual(rows(f),{policies:[],approvals:[]});
});

test('stale email identity and an expired original campaign cannot provision through preparation or commit',async t=>{
  const f=await setup(t),command=await f.command();
  await assert.rejects(f.prepare(f.readProposal,{...f.payerHeaders,'oai-authenticated-user-email':'different@example.invalid'}),/sponsor_canonical_principal_required/);
  await assert.rejects(f.commit(command,{...f.payerHeaders,'oai-authenticated-user-email':'different@example.invalid'}),/sponsor_canonical_principal_required/);
  // The compiled original is immutable; age a synthetic approved campaign by
  // moving SQLite's clock, not rewriting its original digest or approval.
  const prepare=f.DB.prepare;
  f.DB.prepare=sql=>prepare.call(f.DB,sql.replaceAll("julianday('now')","julianday('2099-01-01')"));
  await assert.rejects(f.prepare());await assert.rejects(f.commit(command));assert.deepEqual(rows(f),{policies:[],approvals:[]});
});
