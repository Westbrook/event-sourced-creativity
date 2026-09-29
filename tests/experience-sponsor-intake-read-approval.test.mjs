import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,headersFor} from './sponsor-initial-intake-fixture.mjs';

const [{SPONSOR_INTAKE_READ_POLICY_SCHEMA},{SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
  {canonicalJson,digest},{handleSession,POLICY_VERSION},{revokeSponsorCampaign}]=await Promise.all([
  import('../worker/experience-sponsor-intake-read-policy.ts'),import('../worker/experience-sponsor-intake-read-approval.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/pilot-policy.ts'),import('../worker/experience-sponsor-approval.ts'),
]);

// Every identity and approval is synthetic, in a fresh in-memory SQLite DB.
// These tests provision read terms only: no draft, job, provider or read attempt.
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Intake read approval tests prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const url='http://localhost/__fixture/sponsor-intake-read-approval';
const operations=['image-intake-bootstrap','image-intake-draft','image-intake-receipt'];
const policy=()=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(operations.map(operation=>[operation,{maximumBytes:8192,deadlineMs:1000}])),
  actor:{maximumRequestsPerWindow:5,maximumBytesPerWindow:40_960},
  campaign:{maximumRequestsPerWindow:10,maximumBytesPerWindow:81_920}});
const request=(body,headers={},options={})=>new Request(options.url??url,{method:'POST',
  headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const approvalRows=f=>({
  policies:f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_policies ORDER BY campaign_id, sponsor_policy_digest').all(),
  approvals:f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_approvals ORDER BY approval_id').all(),
});
const protectedTables=['users','events','private_content','experience_sponsor_campaigns','experience_sponsor_approvals',
  'experience_sponsor_resource_policies','experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_issuances',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','experience_sponsor_intakes','output_commands','output_preflights','output_execution_grants',
  'output_operation_slots','document_jobs','output_provider_calls','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations'];
function protectedRows(f){
  return Object.fromEntries(protectedTables.map(table=>[table,
    f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ?f.sqlite.prepare(`SELECT * FROM ${table}`).all().sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):null]));
}
const empty={policies:[],approvals:[]};
async function setup(t){
  const f=await fixture(t);
  for(const sql of [...SPONSOR_INTAKE_READ_POLICY_SCHEMA,...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  f.readProposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:policy()};
  f.prepare=(proposal=f.readProposal,headers=f.payerHeaders)=>prepareSponsorIntakeReadApproval(
    request({action:'prepare-sponsor-intake-read-policy',proposal},headers),f.env);
  f.command=async(proposal=f.readProposal,approvalId='intake-read-approval-1')=>({action:'approve-sponsor-intake-read-policy',approvalId,proposal,
    reviewedTermsDigest:(await f.prepare(proposal)).termsDigest,confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'});
  f.commit=(command,headers=f.payerHeaders)=>approveSponsorIntakeReadPolicy(request(command,headers),f.env);
  return f;
}

test('actual payer reviews and approves exact pre-job read terms without creating creative state or changing native storage and money',async t=>{
  const f=await setup(t),before=protectedRows(f),prepared=await f.prepare();
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
  assert.equal(prepared.terms.purpose,'sponsor-image-intake-read-policy');
  assert.equal(prepared.terms.payerUserId,f.payer);assert.equal(prepared.terms.originalApprovalId,f.approval.approvalId);
  assert.equal(prepared.terms.originalTermsDigest,f.compiled.termsDigest);assert.deepEqual(prepared.terms.proposal,f.readProposal);
  assert.equal(prepared.termsDigest,await digest(prepared.terms));assert.equal(prepared.readPolicyDigest,await digest(f.readProposal.readPolicy));
  assert.ok(Object.isFrozen(prepared.terms.proposal.readPolicy.operations));
  const command=await f.command(),first=await f.commit(command),stored=approvalRows(f);
  assert.equal(first.replayed,false);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
  const p=stored.policies[0],a=stored.approvals[0],receipt=JSON.parse(a.review_receipt_json);
  assert.equal(p.policy_json,canonicalJson(f.readProposal.readPolicy));assert.equal(p.sponsor_policy_digest,f.compiled.policyDigest);
  assert.equal(p.read_policy_digest,prepared.readPolicyDigest);assert.equal(a.terms_json,canonicalJson(prepared.terms));
  assert.equal(a.terms_digest,prepared.termsDigest);assert.equal(a.original_approval_id,f.approval.approvalId);
  assert.equal(a.payer_user_id,f.payer);assert.equal(a.approved_by_user_id,f.payer);
  assert.equal(receipt.purpose,'sponsor-image-intake-read-policy-approval');assert.equal(receipt.approvedByUserId,f.payer);
  assert.equal(receipt.approvalCommandDigest,await digest(command));assert.equal(p.review_receipt_digest,await digest(receipt));
  assert.equal(a.review_receipt_digest,p.review_receipt_digest);assert.equal(a.approval_command_json,canonicalJson(command));
  assert.ok(Number.isSafeInteger(a.approved_at_ms)&&a.approved_at_ms>0);
  assert.deepEqual(await f.commit(structuredClone(command)),{...first,replayed:true});
  assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('eligible actor or issuer, unrelated admin and unauthenticated callers cannot approve the payer read allowance',async t=>{
  const f=await setup(t),command=await f.command(),admin='intake-read-other-admin',adminHeaders=headersFor(admin);
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:adminHeaders}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET role='admin',consent_version=? WHERE user_id=?").run(POLICY_VERSION,admin);
  const before=protectedRows(f);
  for(const headers of [f.actorHeaders,adminHeaders]){
    await assert.rejects(f.prepare(f.readProposal,headers));await assert.rejects(f.commit(command,headers));
  }
  for(const [handler,body] of [[prepareSponsorIntakeReadApproval,{action:'prepare-sponsor-intake-read-policy',proposal:f.readProposal}],
    [approveSponsorIntakeReadPolicy,command]]){
    await assert.rejects(handler(request(body,{}, {url:'https://forma.example/__fixture/sponsor-intake-read-approval'}),f.env));
  }
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('closed approval commands reject missing review, changed terms, old job operations and caller-selected payer',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  const changes=[
    c=>delete c.confirmation,c=>c.confirmation='APPROVE_SPONSOR_READ_POLICY',c=>c.action='approve-sponsor-read-policy',
    c=>c.enabled=true,c=>delete c.reviewedTermsDigest,c=>c.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`,
    c=>c.proposal.readPolicy.actor.maximumRequestsPerWindow++,c=>c.proposal.payerUserId=f.actor,
    c=>c.proposal.campaignId='other-campaign',c=>c.proposal.sponsorPolicyDigest=`sha256:${'f'.repeat(64)}`,
    c=>delete c.proposal.readPolicy.operations['image-intake-draft'],
    c=>c.proposal.readPolicy.operations['image-status']={maximumBytes:1,deadlineMs:1},
    c=>c.proposal.jobId='invented-job',c=>c.proposal.readPolicy.storageOperations=['image-text-draft-storage'],
  ];
  for(const change of changes){const changed=structuredClone(command);change(changed);await assert.rejects(f.commit(changed));}
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('GET, non-JSON and oversized wire bodies cannot invoke either explicit approval action',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  for(const handler of [prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy]){
    await assert.rejects(handler(new Request(url,{headers:f.payerHeaders}),f.env));
    await assert.rejects(handler(new Request(url,{method:'POST',headers:{...f.payerHeaders,'content-type':'text/plain'},body:JSON.stringify(command)}),f.env));
    await assert.rejects(handler(new Request(url,{method:'POST',headers:{...f.payerHeaders,'content-type':'application/json'},body:' '.repeat(131073)}),f.env));
  }
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('simultaneous exact approvals converge once; changed approval ID or freshly reviewed replacement terms cannot reset the policy',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  const results=await Promise.all([f.commit(command),f.commit(structuredClone(command))]);
  assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
  const stored=approvalRows(f);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
  await assert.rejects(f.commit({...command,approvalId:'replacement-read-approval'}));
  const changed=structuredClone(f.readProposal);changed.readPolicy.actor.maximumRequestsPerWindow++;
  await assert.rejects(f.commit(await f.command(changed)));assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('both policy and approval reject UPDATE, DELETE and REPLACE without rewriting original provenance',async t=>{
  const f=await setup(t);await f.commit(await f.command());const stored=approvalRows(f),before=protectedRows(f);
  for(const table of ['experience_sponsor_intake_read_policies','experience_sponsor_intake_read_approvals']){
    const column=table.endsWith('policies')?'policy_json':'terms_json';
    assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET ${column}='{}'`),/immutable/);
    assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/);
    assert.throws(()=>f.sqlite.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/exists/);
  }
  assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('real payer revocation after review rejects approval without undoing the original revocation',async t=>{
  const f=await setup(t),command=await f.command();
  await revokeSponsorCampaign(request({action:'revoke-sponsor-campaign',campaignId:f.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},f.payerHeaders),f.env);
  const before=protectedRows(f);await assert.rejects(f.commit(command));await assert.rejects(f.prepare());
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

for(const [name,mutate] of [
  ['payer approval revoked',f=>{
    f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1 WHERE campaign_id=?').run(f.campaignId);
    assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns WHERE campaign_id=?').get(f.campaignId).enabled,1);
  }],
  ['payer authority changed',f=>f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.payer)],
])test(`${name} after the final pre-read aborts the atomic policy and approval insert`,async t=>{
  const f=await setup(t),command=await f.command(),batch=f.DB.batch.bind(f.DB);let raced=false,afterRace;
  f.DB.batch=async statements=>{
    if(!raced&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intake_read_policies'))){
      raced=true;mutate(f);afterRace=protectedRows(f);
    }
    return batch(statements);
  };
  await assert.rejects(f.commit(command));assert.equal(raced,true);assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),afterRace);
});

test('a provenance insertion failure rolls back its policy row and leaves all native state unchanged',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  f.sqlite.exec("CREATE TRIGGER fixture_reject_intake_read_approval BEFORE INSERT ON experience_sponsor_intake_read_approvals BEGIN SELECT RAISE(ABORT,'fixture_intake_read_commit_failure'); END");
  await assert.rejects(f.commit(command),/fixture_intake_read_commit_failure/);
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('lost acknowledgment recovers one exact committed approval and a fresh request returns the same immutable receipt',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intake_read_approvals'))){lost=true;throw Error('fixture_lost_intake_read_ack');}
    return result;
  };
  const recovered=await f.commit(command);assert.equal(lost,true);assert.equal(recovered.replayed,true);
  const stored=approvalRows(f);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
  assert.deepEqual(await f.commit(structuredClone(command)),recovered);assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

for(const column of ['terms_json','policy_json','payer_authority_json','approval_command_json'])
  test(`corrupted original ${column} cannot be treated as payer approval merely because a digest remains`,async t=>{
    const f=await setup(t),command=await f.command();
    // Fixture-only fault injection bypasses the historical immutability trigger
    // to test verification of damaged retained provenance, not a supported edit.
    f.sqlite.exec('DROP TRIGGER experience_sponsor_approval_immutable');
    const old=f.sqlite.prepare(`SELECT ${column} AS value FROM experience_sponsor_approvals`).get().value;
    const changed=JSON.parse(old);
    if(column==='terms_json')changed.policy.policyVersion='tampered-original-terms';
    else if(column==='policy_json')changed.policyVersion='tampered-original-policy';
    else if(column==='approval_command_json')changed.confirmation='NOT_REVIEWED';
    else changed[0]='another-payer';
    f.sqlite.prepare(`UPDATE experience_sponsor_approvals SET ${column}=?`).run(canonicalJson(changed));
    const before=protectedRows(f);await assert.rejects(f.prepare());await assert.rejects(f.commit(command));
    assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
  });
