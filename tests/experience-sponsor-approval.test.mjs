import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture} from './sponsor-driver-fixture.mjs';
const [{approveSponsorCampaign,compileSponsorApprovalProposal,loadApprovedSponsorCampaign,readSponsorInternalCommand,revokeSponsorCampaign},
  {prepareSponsorResourcePlan},{digest},{handleSession,POLICY_VERSION}]=await Promise.all([
  import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/pilot-policy.ts'),
]);

// Every identity and row is synthetic, on disposable real SQLite. This suite
// tests the dormant server function, never a registered route or live account.
const originalFetch=globalThis.fetch;let fetchAttempts=0;
globalThis.fetch=()=>{fetchAttempts++;throw Error('Approval qualification prohibits network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(fetchAttempts,0);});
const URL='http://localhost/__fixture/sponsor-approval',LIMIT=131072;
const headers=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const request=(body,auth,overrides={})=>new Request(URL,{method:'POST',headers:{'content-type':'application/json',...auth},body:JSON.stringify(body),...overrides});
const tables=['experience_sponsor_approvals','experience_sponsor_campaigns','experience_sponsor_resource_policies','experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_active_jobs','budget_reservations','cost_budget_reservations'];
function rows(f){return Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
async function approvalCommand(f,proposal=f.proposal,approvalId=`approval-${f.campaignId}`){
  const terms=await compileSponsorApprovalProposal(proposal);
  return {action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:terms.termsDigest};
}
const revokedCommand=f=>({action:'revoke-sponsor-campaign',campaignId:f.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'});
const expectCode=code=>error=>{assert.equal(error.code,code);return true;};

async function namedUser(f,userId,role='creator'){
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(userId)}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET role=?,consent_version=? WHERE user_id=?').run(role,POLICY_VERSION,userId);
  return headers(userId);
}

test('canonical payer POST approves exact terms once; fresh-request replay preserves every row',async t=>{
  const f=await fixture(t,{approved:false}),command=await approvalCommand(f);
  const approved=await approveSponsorCampaign(request(command,f.payerHeaders),f.env);
  assert.equal(approved.replayed,false);assert.equal(approved.approvalId,command.approvalId);
  assert.equal(approved.policy.approvalReceiptDigest,command.reviewedTermsDigest);
  const row=f.sqlite.prepare('SELECT * FROM experience_sponsor_approvals').get();
  assert.equal(row.payer_user_id,f.payer);assert.equal(row.approved_by_user_id,f.payer);assert.equal(row.terms_digest,command.reviewedTermsDigest);
  assert.deepEqual(JSON.parse(row.approval_command_json),command);assert.equal(row.revoked_at_ms,null);
  assert.ok(row.approved_at_ms>0);assert.equal(row.policy_digest,await digest(approved.policy));
  const before=rows(f),replayed=await approveSponsorCampaign(request(structuredClone(command),f.payerHeaders),f.env);
  assert.equal(replayed.replayed,true);assert.deepEqual(rows(f),before);
  for(const table of ['experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_active_jobs','budget_reservations','cost_budget_reservations'])assert.equal(before[table].length,0,table);
  const loaded=await loadApprovedSponsorCampaign(new Request(URL,{headers:f.actorHeaders}),f.env,f.campaignId);
  assert.equal(loaded.actor.userId,f.actor);assert.equal(loaded.policyDigest,approved.policyDigest);
});

test('borrowed authenticated GET and non-JSON requests cannot approve',async t=>{
  const f=await fixture(t,{approved:false}),command=await approvalCommand(f),before=rows(f);
  await assert.rejects(()=>approveSponsorCampaign(new Request(URL,{headers:f.payerHeaders}),f.env),expectCode('sponsor_explicit_command_required'));
  await assert.rejects(()=>approveSponsorCampaign(request(command,f.payerHeaders,{headers:{...f.payerHeaders,'content-type':'text/plain'}}),f.env),expectCode('sponsor_explicit_command_required'));
  assert.deepEqual(rows(f),before);
});

for(const role of ['creator','admin'])test(`another authenticated ${role} cannot approve the payer's campaign`,async t=>{
  const f=await fixture(t,{approved:false}),otherHeaders=await namedUser(f,`other-${role}`,role),command=await approvalCommand(f),before=rows(f);
  await assert.rejects(()=>approveSponsorCampaign(request(command,otherHeaders),f.env),expectCode('sponsor_payer_approval_required'));
  assert.deepEqual(rows(f),before);
});

test('an admin who is the actual canonical payer can explicitly approve',async t=>{
  const f=await fixture(t,{approved:false});f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(f.payer);
  const approved=await approveSponsorCampaign(request(await approvalCommand(f),f.payerHeaders),f.env);
  assert.equal(approved.replayed,false);assert.equal(approved.policy.payerUserId,f.payer);
});

const commandChanges={
  'raw digest replacing approval':command=>{delete command.proposal;command.approvalReceiptDigest=command.reviewedTermsDigest;},
  'unreviewed digest':command=>{command.reviewedTermsDigest=`sha256:${'f'.repeat(64)}`;},
  'changed total cap after review':command=>{command.proposal.policy.maximumMicrousd++;},
  'changed eligible actors after review':command=>{command.proposal.eligibleActorUserIds.push('not-reviewed');},
  'changed issuer after review':command=>{command.proposal.eligibleActorUserIds.push('new-issuer');command.proposal.issuerUserIds=['new-issuer'];},
  'missing explicit confirmation':command=>{delete command.confirmation;},
  'wrong explicit action':command=>{command.action='approve';},
};
for(const [name,change] of Object.entries(commandChanges))test(`${name} is refused without campaign or money writes`,async t=>{
  const f=await fixture(t,{approved:false}),command=await approvalCommand(f),before=rows(f);change(command);
  await assert.rejects(()=>approveSponsorCampaign(request(command,f.payerHeaders),f.env));
  assert.deepEqual(rows(f),before);
});

const proposalChanges={
  'raw policy approval digest':p=>{p.policy.approvalReceiptDigest=`sha256:${'a'.repeat(64)}`;},
  'payer also an eligible actor':p=>{p.eligibleActorUserIds.push(p.policy.payerUserId);},
  'duplicate eligible actor':p=>{p.eligibleActorUserIds.push(p.eligibleActorUserIds[0]);},
  'duplicate issuer':p=>{p.issuerUserIds.push(p.issuerUserIds[0]);},
  'issuer outside eligibility':p=>{p.issuerUserIds=['other-issuer'];},
  'empty eligibility':p=>{p.eligibleActorUserIds=[];},
  'empty issuer list':p=>{p.issuerUserIds=[];},
  'unknown proposal field':p=>{p.autoEnroll=true;},
  'fractional monetary cap':p=>{p.policy.maximumMicrousd+=.5;},
  'monetary cap above allowed maximum':p=>{p.policy.maximumMicrousd=1_000_000_000_001;},
  'actor admissions exceeding campaign cap':p=>{p.policy.maximumAdmissionsPerActor=p.policy.maximumAdmissions+1;},
};
for(const [name,change] of Object.entries(proposalChanges))test(`approval proposal rejects ${name}`,async t=>{
  const f=await fixture(t,{approved:false}),proposal=structuredClone(f.proposal),before=rows(f);change(proposal);
  await assert.rejects(()=>compileSponsorApprovalProposal(proposal));assert.deepEqual(rows(f),before);
});

test('reviewed integer campaign cap is retained exactly, without rounding or silently widening it',async t=>{
  const f=await fixture(t,{approved:false}),proposal=structuredClone(f.proposal);
  proposal.policy.maximumMicrousd=1_000_000_000_000;
  const approved=await approveSponsorCampaign(request(await approvalCommand(f,proposal),f.payerHeaders),f.env);
  assert.equal(approved.policy.maximumMicrousd,1_000_000_000_000);
  const stored=JSON.parse(f.sqlite.prepare('SELECT policy_json FROM experience_sponsor_approvals').get().policy_json);
  assert.equal(stored.maximumMicrousd,1_000_000_000_000);
});

test('same approval or campaign cannot be reused for changed terms or another approval ID',async t=>{
  const f=await fixture(t),before=rows(f),changed=structuredClone(f.proposal);changed.policy.maximumMicrousd++;
  await assert.rejects(async()=>approveSponsorCampaign(request(await approvalCommand(f,changed),f.payerHeaders),f.env),expectCode('sponsor_approval_conflict'));
  await assert.rejects(async()=>approveSponsorCampaign(request(await approvalCommand(f,f.proposal,'different-approval'),f.payerHeaders),f.env),expectCode('sponsor_approval_conflict'));
  const second=structuredClone(f.proposal);second.policy.campaignId='different-campaign';
  await assert.rejects(async()=>approveSponsorCampaign(request(await approvalCommand(f,second),f.payerHeaders),f.env),expectCode('sponsor_approval_conflict'));
  assert.deepEqual(rows(f),before);
});

test('eligible nonissuer and unrelated admin cannot load issuance authority',async t=>{
  const f=await fixture(t,{approved:false}),eligible=await namedUser(f,'eligible-nonissuer'),admin=await namedUser(f,'unrelated-admin','admin');
  const proposal=structuredClone(f.proposal);proposal.eligibleActorUserIds.push('eligible-nonissuer');
  await f.approve({proposal});const before=rows(f);
  await assert.rejects(()=>loadApprovedSponsorCampaign(new Request(URL,{headers:eligible}),f.env,f.campaignId));
  await assert.rejects(()=>loadApprovedSponsorCampaign(new Request(URL,{headers:admin}),f.env,f.campaignId));
  assert.deepEqual(rows(f),before);
});

test('active approval terms, payer, policy and captured authority cannot be overwritten',async t=>{
  const f=await fixture(t),before=rows(f);
  for(const [column,value] of [
    ['terms_json','{}'],['terms_digest',`sha256:${'f'.repeat(64)}`],['policy_json','{}'],['policy_digest',`sha256:${'e'.repeat(64)}`],
    ['payer_user_id',f.actor],['approved_by_user_id',f.actor],['payer_authority_json','[]'],['approval_command_json','{}'],
    ['approval_id','new-approval-id'],['campaign_id','new-campaign-id'],['approved_at_ms',0],
  ])assert.throws(()=>f.sqlite.prepare(`UPDATE experience_sponsor_approvals SET ${column}=?`).run(value),/sponsor_approval_is_immutable/,column);
  assert.deepEqual(rows(f),before);
});

test('payer revocation is monotonic and preserves cumulative resource receipts and the pending grant record',async t=>{
  const f=await fixture(t),sessionDigest=await digest({fixture:'session'}),payloadDigest=await digest({fixture:'text'});
  const plan=await prepareSponsorResourcePlan({limits:f.policy.resources,campaignId:f.campaignId,policyDigest:f.compiled.policyDigest,actorUserId:f.actor,
    sessionDigest,intentKey:'consumed-intake',operation:'text-intake',payloadDigest,textBytes:17,resourceId:'consumed-text-resource'});
  await f.env.DB.batch(plan.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)));
  const now=f.sqlite.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").get().now;
  f.sqlite.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
    .run('synthetic-pending-grant',f.campaignId,f.compiled.policyDigest,f.actor,sessionDigest,'pending-intent',payloadDigest,now,now+60_000);
  const before=rows(f);
  assert.deepEqual(await revokeSponsorCampaign(request(revokedCommand(f),f.payerHeaders),f.env),{revoked:true});
  const first=rows(f);assert.equal(first.experience_sponsor_campaigns[0].enabled,0);assert.equal(first.experience_sponsor_resource_policies[0].enabled,0);
  assert.equal(first.experience_sponsor_grants[0].enabled,0);assert.ok(first.experience_sponsor_approvals[0].revoked_at_ms>=first.experience_sponsor_approvals[0].approved_at_ms);
  assert.deepEqual(first.experience_sponsor_resource_receipts,before.experience_sponsor_resource_receipts);
  assert.deepEqual({...first.experience_sponsor_grants[0]},{...before.experience_sponsor_grants[0],enabled:0});
  assert.deepEqual(first.budget_reservations,before.budget_reservations);assert.deepEqual(first.cost_budget_reservations,before.cost_budget_reservations);
  await revokeSponsorCampaign(request(revokedCommand(f),f.payerHeaders),f.env);assert.deepEqual(rows(f),first);
  await assert.rejects(()=>approveSponsorCampaign(request(f.approvalCommand,f.payerHeaders),f.env),expectCode('sponsor_approval_conflict'));
  await assert.rejects(()=>loadApprovedSponsorCampaign(new Request(URL,{headers:f.actorHeaders}),f.env,f.campaignId),expectCode('sponsor_approved_campaign_unavailable'));
  assert.throws(()=>f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=NULL'),/sponsor_approval_is_immutable/);
  assert.throws(()=>f.sqlite.exec('DELETE FROM experience_sponsor_approvals'),/sponsor_approval_is_immutable/);
  assert.throws(()=>f.sqlite.exec('INSERT OR REPLACE INTO experience_sponsor_approvals SELECT * FROM experience_sponsor_approvals'),/sponsor_approval_already_exists/);
  assert.deepEqual(rows(f),first);
});

test('another admin and a borrowed GET cannot revoke payer approval',async t=>{
  const f=await fixture(t),admin=await namedUser(f,'revoke-admin','admin'),before=rows(f);
  await assert.rejects(()=>revokeSponsorCampaign(request(revokedCommand(f),admin),f.env));
  await assert.rejects(()=>revokeSponsorCampaign(new Request(URL,{headers:f.payerHeaders}),f.env),expectCode('sponsor_explicit_command_required'));
  assert.deepEqual(rows(f),before);
});

for(const change of ['consent','authority'])test(`changed payer ${change} cannot replay or load original approval`,async t=>{
  const f=await fixture(t);
  if(change==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.payer);
  else f.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?").run(f.payer);
  const before=rows(f);
  await assert.rejects(()=>approveSponsorCampaign(request(f.approvalCommand,f.payerHeaders),f.env));
  await assert.rejects(()=>loadApprovedSponsorCampaign(new Request(URL,{headers:f.actorHeaders}),f.env,f.campaignId));
  assert.deepEqual(rows(f),before);
});

test('an exact 128 KiB approval JSON body is accepted; one additional UTF-8 byte is rejected',async t=>{
  const f=await fixture(t,{approved:false}),command=await approvalCommand(f),json=JSON.stringify(command),bytes=new TextEncoder().encode(json).byteLength;
  assert.ok(bytes<LIMIT);
  const body=json+' '.repeat(LIMIT-bytes);
  assert.equal(new TextEncoder().encode(body).byteLength,LIMIT);
  const approved=await approveSponsorCampaign(request(command,f.payerHeaders,{body}),f.env);assert.equal(approved.replayed,false);
  const before=rows(f);
  await assert.rejects(()=>approveSponsorCampaign(request(command,f.payerHeaders,{body:body+' '}),f.env),expectCode('sponsor_command_too_large'));
  assert.deepEqual(rows(f),before);
});

test('body cap measures UTF-8 bytes and preserves a multibyte boundary exactly',async()=>{
  const body=JSON.stringify('é'.repeat((LIMIT-2)/2));assert.equal(body.length,65537);assert.equal(new TextEncoder().encode(body).byteLength,LIMIT);
  assert.equal((await readSponsorInternalCommand(request(null,{}, {body}))).length,65535);
  await assert.rejects(()=>readSponsorInternalCommand(request(null,{}, {body:body+' '})),expectCode('sponsor_command_too_large'));
});

test('unknown-length over-limit stream rejects promptly without waiting for an unread cloned branch',async t=>{
  let controller;const stream=new ReadableStream({start(value){controller=value;value.enqueue(new Uint8Array(LIMIT));value.enqueue(new Uint8Array([32]));}});
  const req=new Request(URL,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
  assert.equal(req.headers.get('content-length'),null);
  let timer;t.after(()=>{clearTimeout(timer);try{controller.close();}catch{/* The fixture stream may already be canceled. */}void req.body?.cancel().catch(()=>{});});
  await Promise.race([
    assert.rejects(()=>readSponsorInternalCommand(req),expectCode('sponsor_command_too_large')),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Body rejection waited on cloned stream cancellation')),1000);}),
  ]);
  clearTimeout(timer);
});

for(const [name,body] of [['invalid JSON','{'],['invalid UTF-8',new Uint8Array([0x22,0xc3,0x28,0x22])]])test(`${name} is not repaired into an approval command`,async()=>{
  await assert.rejects(()=>readSponsorInternalCommand(request(null,{}, {body})),expectCode('sponsor_command_invalid'));
});
