import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,headers as headersFor} from './sponsor-story-driver-fixture.mjs';

const [{SPONSOR_STORY_IO_POLICY_SCHEMA,readSponsorStoryIoPolicy},{SPONSOR_STORY_IO_APPROVAL_SCHEMA,prepareSponsorStoryIoApproval,approveSponsorStoryIoPolicy,readApprovedSponsorStoryIoPolicy},
  {canonicalJson,digest},{handleSession,POLICY_VERSION},{revokeSponsorCampaign}]=await Promise.all([
  import('../worker/experience-sponsor-story-io-policy.ts'),import('../worker/experience-sponsor-story-io-approval.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/pilot-policy.ts'),import('../worker/experience-sponsor-approval.ts'),
]);

// Every identity and approval is synthetic, in a fresh in-memory SQLite DB.
// These tests provision IO terms only: no job, provider or read attempt. Native fixture ordinary saved source/plan predates approval.
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Story IO approval tests prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const url='http://localhost/__fixture/sponsor-story-io-approval';
const operations=['short-story-status','short-story-result'];
const policy=()=>({version:1,family:'canonical-short-story-io@1',purpose:'selected-result',windowMs:60_000,
  operations:Object.fromEntries(operations.map(operation=>[operation,{maximumBytes:8192,deadlineMs:1000}])),
  actor:{maximumRequestsPerWindow:5,maximumBytesPerWindow:40_960},
  campaign:{maximumRequestsPerWindow:10,maximumBytesPerWindow:81_920}});
const request=(body,headers={},options={})=>new Request(options.url??url,{method:'POST',
  headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const approvalRows=f=>({
  policies:f.sqlite.prepare('SELECT * FROM experience_sponsor_story_io_policies ORDER BY campaign_id, sponsor_policy_digest').all(),
  approvals:f.sqlite.prepare('SELECT * FROM experience_sponsor_story_io_approvals ORDER BY approval_id').all(),
});
const protectedTables=['users','events','private_content','experience_sponsor_campaigns','experience_sponsor_approvals',
  'experience_sponsor_resource_policies','experience_sponsor_resource_receipts','experience_sponsor_grants','experience_sponsor_issuances',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','experience_sponsor_driver_intents','experience_sponsor_driver_stages','output_commands','output_preflights','output_execution_grants',
  'output_operation_slots','document_jobs','output_provider_calls','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations'];
function protectedRows(f){
  return Object.fromEntries(protectedTables.map(table=>[table,
    f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ?f.sqlite.prepare(`SELECT * FROM ${table}`).all().sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):null]));
}
const empty={policies:[],approvals:[]};
async function setup(t){
  const f=await fixture(t,{strict:true});
  for(const sql of [...SPONSOR_STORY_IO_POLICY_SCHEMA,...SPONSOR_STORY_IO_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  f.ioProposal={version:1,family:'canonical-short-story-io@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,ioPolicy:policy()};
  f.prepare=(proposal=f.ioProposal,headers=f.payerHeaders)=>prepareSponsorStoryIoApproval(
    request({action:'prepare-sponsor-story-io-policy',proposal},headers),f.env);
  f.command=async(proposal=f.ioProposal,approvalId='story-io-approval-1')=>({action:'approve-sponsor-story-io-policy',approvalId,proposal,
    reviewedTermsDigest:(await f.prepare(proposal)).termsDigest,confirmation:'APPROVE_SPONSOR_STORY_IO_POLICY'});
  f.commit=(command,headers=f.payerHeaders)=>approveSponsorStoryIoPolicy(request(command,headers),f.env);
  return f;
}

test('actual payer reviews and approves exact selected-result read terms without creating creative state or changing native state and money',async t=>{
  const f=await setup(t),before=protectedRows(f),prepared=await f.prepare();
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
  assert.equal(prepared.terms.purpose,'sponsor-short-story-selected-result-policy');
  assert.equal(prepared.terms.payerUserId,f.payer);assert.equal(prepared.terms.originalApprovalId,f.approval.approvalId);
  assert.equal(prepared.terms.originalTermsDigest,f.compiled.termsDigest);assert.deepEqual(prepared.terms.proposal,f.ioProposal);
  assert.equal(prepared.termsDigest,await digest(prepared.terms));assert.equal(prepared.ioPolicyDigest,await digest(f.ioProposal.ioPolicy));
  assert.ok(Object.isFrozen(prepared.terms.proposal.ioPolicy.operations));
  const command=await f.command(),first=await f.commit(command),stored=approvalRows(f);
  assert.equal(first.replayed,false);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
  const p=stored.policies[0],a=stored.approvals[0],receipt=JSON.parse(a.review_receipt_json);
  assert.equal(p.policy_json,canonicalJson(f.ioProposal.ioPolicy));assert.equal(p.sponsor_policy_digest,f.compiled.policyDigest);
  assert.equal(p.io_policy_digest,prepared.ioPolicyDigest);assert.equal(a.terms_json,canonicalJson(prepared.terms));
  assert.equal(a.terms_digest,prepared.termsDigest);assert.equal(a.original_approval_id,f.approval.approvalId);
  assert.equal(a.payer_user_id,f.payer);assert.equal(a.approved_by_user_id,f.payer);
  assert.equal(receipt.purpose,'sponsor-short-story-selected-result-policy-approval');assert.equal(receipt.approvedByUserId,f.payer);
  assert.equal(receipt.approvalCommandDigest,await digest(command));assert.equal(p.review_receipt_digest,await digest(receipt));
  assert.equal(a.review_receipt_digest,p.review_receipt_digest);assert.equal(a.approval_command_json,canonicalJson(command));
  assert.ok(Number.isSafeInteger(a.approved_at_ms)&&a.approved_at_ms>0);
  assert.deepEqual(await f.commit(structuredClone(command)),{...first,replayed:true});
  assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('eligible actor or issuer, unrelated admin and unauthenticated callers cannot approve the payer IO allowance',async t=>{
  const f=await setup(t),command=await f.command(),admin='intake-read-other-admin',adminHeaders=headersFor(admin);
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:adminHeaders}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET role='admin',consent_version=? WHERE user_id=?").run(POLICY_VERSION,admin);
  const before=protectedRows(f);
  for(const headers of [f.actorHeaders,adminHeaders]){
    await assert.rejects(f.prepare(f.ioProposal,headers));await assert.rejects(f.commit(command,headers));
  }
  for(const [handler,body] of [[prepareSponsorStoryIoApproval,{action:'prepare-sponsor-story-io-policy',proposal:f.ioProposal}],
    [approveSponsorStoryIoPolicy,command]]){
    await assert.rejects(handler(request(body,{}, {url:'https://forma.example/__fixture/sponsor-story-io-approval'}),f.env));
  }
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('closed approval commands reject missing review, changed terms, old job operations and caller-selected payer',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  const changes=[
    c=>delete c.confirmation,c=>c.confirmation='APPROVE_SPONSOR_READ_POLICY',c=>c.action='approve-sponsor-read-policy',
    c=>c.enabled=true,c=>delete c.reviewedTermsDigest,c=>c.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`,
    c=>c.proposal.ioPolicy.actor.maximumRequestsPerWindow++,c=>c.proposal.payerUserId=f.actor,
    c=>c.proposal.campaignId='other-campaign',c=>c.proposal.sponsorPolicyDigest=`sha256:${'f'.repeat(64)}`,
    c=>delete c.proposal.ioPolicy.operations['short-story-result'],
    c=>c.proposal.ioPolicy.operations['image-status']={maximumBytes:1,deadlineMs:1},
    c=>c.proposal.jobId='invented-job',c=>c.proposal.ioPolicy.storageOperations=['image-text-draft-storage'],
  ];
  for(const change of changes){const changed=structuredClone(command);change(changed);await assert.rejects(f.commit(changed));}
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('GET, non-JSON and oversized wire bodies cannot invoke either explicit approval action',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  for(const handler of [prepareSponsorStoryIoApproval,approveSponsorStoryIoPolicy]){
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
  const changed=structuredClone(f.ioProposal);changed.ioPolicy.actor.maximumRequestsPerWindow++;
  await assert.rejects(f.commit(await f.command(changed)));assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('both policy and approval reject UPDATE, DELETE and REPLACE without rewriting original provenance',async t=>{
  const f=await setup(t);await f.commit(await f.command());const stored=approvalRows(f),before=protectedRows(f);
  for(const table of ['experience_sponsor_story_io_policies','experience_sponsor_story_io_approvals']){
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
    if(!raced&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_story_io_policies'))){
      raced=true;mutate(f);afterRace=protectedRows(f);
    }
    return batch(statements);
  };
  await assert.rejects(f.commit(command));assert.equal(raced,true);assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),afterRace);
});

test('a provenance insertion failure rolls back its policy row and leaves all native state unchanged',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f);
  f.sqlite.exec("CREATE TRIGGER fixture_reject_intake_read_approval BEFORE INSERT ON experience_sponsor_story_io_approvals BEGIN SELECT RAISE(ABORT,'fixture_intake_read_commit_failure'); END");
  await assert.rejects(f.commit(command),/fixture_intake_read_commit_failure/);
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('lost acknowledgment recovers one exact committed approval and a fresh request returns the same immutable receipt',async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_story_io_approvals'))){lost=true;throw Error('fixture_lost_intake_read_ack');}
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

test('closed selected-result policy requires explicit finite terms, clones deeply and never grants other operations',()=>{
  const input=policy(),captured=readSponsorStoryIoPolicy(input);input.operations['short-story-result'].maximumBytes=1;
  assert.equal(captured.operations['short-story-result'].maximumBytes,8192);assert.ok(Object.isFrozen(captured.operations['short-story-result']));
  const changes=[p=>p.version=4,p=>p.family='canonical-image@1',p=>p.purpose='intake',p=>delete p.actor,p=>p.defaults=true,
    p=>p.windowMs=0,p=>p.windowMs=31_536_000_001,p=>p.actor.maximumRequestsPerWindow=Infinity,
    p=>p.actor.maximumBytesPerWindow=NaN,p=>p.campaign.maximumRequestsPerWindow=1,
    p=>p.campaign.maximumBytesPerWindow=1,p=>p.actor.maximumBytesPerWindow=8191,
    p=>p.operations['short-story-status'].maximumBytes=0,p=>p.operations['short-story-status'].maximumBytes=192_000_001,
    p=>p.operations['short-story-status'].deadlineMs=30001,p=>p.operations['short-story-status'].deadlineMs=0.5,
    p=>delete p.operations['short-story-result'],p=>p.operations['image-status']={maximumBytes:1,deadlineMs:1},
    p=>p.operations['short-story-upload']={maximumBytes:1,deadlineMs:1},p=>p.storageBytes=100];
  for(const change of changes){const changed=policy();change(changed);assert.throws(()=>readSponsorStoryIoPolicy(changed));}
  let getters=0;const getter=policy();Object.defineProperty(getter,'windowMs',{get(){getters++;return 1;}});
  assert.throws(()=>readSponsorStoryIoPolicy(getter));assert.equal(getters,0);
});

const read=f=>readApprovedSponsorStoryIoPolicy(f.env,f.campaignId,f.compiled.policyDigest);
const assertProof=(f,approved)=>{
  for(const assertion of approved.assertions)assert.equal(f.sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS valid`).get(...assertion.bindings).valid,1);
};

test('bounded retained provenance reconstructs both genuine approvals and charges actual escaped SQL rows',async t=>{
  const f=await setup(t);await f.commit(await f.command());const before=protectedRows(f),stored=approvalRows(f);
  const prepare=f.DB.prepare.bind(f.DB),returned=[];
  f.DB.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);bound.first=async(...args)=>{const result=await first(...args);returned.push(result);return result;};return bound;};return statement;};
  const approved=await read(f);f.DB.prepare=prepare;
  assert.deepEqual(approved.policy,f.ioProposal.ioPolicy);assert.equal(approved.ioPolicyDigest,stored.policies[0].io_policy_digest);
  assert.equal(approved.reviewReceiptDigest,stored.approvals[0].review_receipt_digest);
  assert.equal(returned.length,2);assert.equal(approved.controlBytes,returned.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)),0));
  assert.ok(approved.controlBytes>Buffer.byteLength(canonicalJson(approved.policy)));assertProof(f,approved);
  assert.ok(Object.isFrozen(approved.assertions[0].bindings));
  const {outputAssertionStatements}=await import('../worker/output-command-core.ts');
  await f.DB.batch(approved.assertions.flatMap(assertion=>outputAssertionStatements(f.env,assertion)));
  assert.deepEqual(protectedRows(f),before);assert.deepEqual(approvalRows(f),stored);
});

for(const transition of ['payer revocation','generation expiry','payer consent change'])test(`provisioned IO provenance survives ${transition}; current provisioning and replay remain denied`,async t=>{
  const f=await setup(t),command=await f.command();await f.commit(command);const stored=approvalRows(f);
  if(transition==='payer revocation')await revokeSponsorCampaign(request({action:'revoke-sponsor-campaign',campaignId:f.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},f.payerHeaders),f.env);
  else if(transition==='generation expiry')f.sqlite.function('julianday',value=>{assert.equal(value,'now');return 2440587.5+(Date.now()+7_200_000)/86_400_000;});
  else f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('expired-consent',f.payer);
  const before=protectedRows(f);assertProof(f,await read(f));await assert.rejects(f.prepare());await assert.rejects(f.commit(command));
  assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

test('a standalone allocation or policy digest is never accepted without the original and IO approval joins',async t=>{
  const f=await setup(t);assert.equal(approvalRows(f).policies.length,0);await assert.rejects(read(f));
  f.sqlite.prepare('INSERT INTO experience_sponsor_story_io_policies VALUES(?,?,?,?,?)').run(f.campaignId,f.compiled.policyDigest,
    await digest(f.ioProposal.ioPolicy),canonicalJson(f.ioProposal.ioPolicy),`sha256:${'f'.repeat(64)}`);
  await assert.rejects(read(f));assert.equal(approvalRows(f).policies.length,1);assert.equal(approvalRows(f).approvals.length,0);
});

test('retained proof rejects every damaged material field and its transaction assertion sees late corruption',async t=>{
  const f=await setup(t);await f.commit(await f.command());const approved=await read(f);
  // Fixture-only corruption bypasses immutable triggers. No supported mutation
  // path can change these columns; this exercises bounded damaged-state denial.
  for(const trigger of ['experience_sponsor_approval_immutable','experience_sponsor_story_io_policies_no_update','experience_sponsor_story_io_approvals_no_update'])f.sqlite.exec(`DROP TRIGGER ${trigger}`);
  const targets={experience_sponsor_approvals:['terms_json','terms_digest','policy_json','payer_authority_json','approval_command_json'],
    experience_sponsor_story_io_policies:['io_policy_digest','policy_json','review_receipt_digest'],
    experience_sponsor_story_io_approvals:['original_approval_id','payer_user_id','io_policy_digest','terms_json','terms_digest','review_receipt_json','review_receipt_digest','approval_command_json']};
  for(const [table,columns]of Object.entries(targets))for(const column of columns){
    if(column==='original_approval_id'||column==='payer_user_id')continue; // FK/CHECK prevents these direct corruptions.
    const old=f.sqlite.prepare(`SELECT ${column} AS value FROM ${table}`).get().value;
    const bad=column.endsWith('digest')?`sha256:${'0'.repeat(64)}`:column==='payer_authority_json'?'["wrong-payer"]':'{}';
    f.sqlite.prepare(`UPDATE ${table} SET ${column}=?`).run(bad);
    await assert.rejects(read(f),undefined,`${table}.${column}`);
    for(const assertion of approved.assertions)assert.equal(f.sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS valid`).get(...assertion.bindings).valid,0,`${table}.${column}`);
    f.sqlite.prepare(`UPDATE ${table} SET ${column}=?`).run(old);
  }
  assertProof(f,await read(f));
  const old=f.sqlite.prepare('SELECT review_receipt_json FROM experience_sponsor_story_io_approvals').get().review_receipt_json;
  for(const bad of [' '.repeat(262145),'\0','{']){
    f.sqlite.prepare('UPDATE experience_sponsor_story_io_approvals SET review_receipt_json=?').run(bad);await assert.rejects(read(f));
  }
  f.sqlite.prepare('UPDATE experience_sponsor_story_io_approvals SET review_receipt_json=?').run(old);assertProof(f,await read(f));
});

for(const race of ['revoke','payer-change','database-swap','abort'])test(`committed approval with lost acknowledgement then ${race} refuses success and preserves original committed rows`,async t=>{
  const f=await setup(t),command=await f.command(),batch=f.DB.batch.bind(f.DB),controller=new AbortController();let raced=false;
  f.DB.batch=async statements=>{const result=await batch(statements);
    if(!raced&&statements.some(s=>s.sql.includes('INSERT INTO experience_sponsor_story_io_approvals'))){raced=true;
      if(race==='revoke')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1').run();
      else if(race==='payer-change')f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.payer);
      else if(race==='database-swap')f.env.DB={prepare(){throw Error('substituted DB must not be used');},batch(){throw Error('substituted DB must not be used');}};
      else controller.abort();throw Error('fixture_lost_ack_then_change');}
    return result;};
  const req=new Request(url,{method:'POST',headers:{...f.payerHeaders,'content-type':'application/json'},body:JSON.stringify(command),signal:controller.signal});
  await assert.rejects(approveSponsorStoryIoPolicy(req,f.env));assert.equal(raced,true);
  assert.equal(approvalRows(f).policies.length,1);assert.equal(approvalRows(f).approvals.length,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM output_atomic_assertions').get().n,0);
});

for(const race of ['database-swap','abort','cohort-change'])test(`final successful approval proof then ${race} cannot disclose stale success`,async t=>{
  const f=await setup(t),command=await f.command(),controller=new AbortController();await f.commit(command);
  const stored=approvalRows(f),batch=f.DB.batch.bind(f.DB);let raced=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!raced){raced=true;
    if(race==='database-swap')f.env.DB={prepare(){throw Error('substituted DB must not be used');},batch(){throw Error('substituted DB must not be used');}};
    else if(race==='abort')controller.abort();else f.env.FORMA_PILOT_COHORT_ID='changed-cohort';}return result;};
  await assert.rejects(approveSponsorStoryIoPolicy(new Request(url,{method:'POST',headers:{...f.payerHeaders,'content-type':'application/json'},body:JSON.stringify(command),signal:controller.signal}),f.env),/authority_changed/);
  assert.equal(raced,true);assert.deepEqual(approvalRows(f),stored);
});

for(const point of ['command','metadata'])test(`database replacement during ${point} pre-read refuses all IO writes and provenance disclosure`,async t=>{
  const f=await setup(t),command=await f.command();
  const replacement={prepare(){throw Error('substituted DB must not be used');},batch(){throw Error('substituted DB must not be used');}};
  if(point==='command'){
    const req=request(command,f.payerHeaders),clone=req.clone.bind(req);req.clone=()=>{f.env.DB=replacement;return clone();};
    await assert.rejects(approveSponsorStoryIoPolicy(req,f.env),/authority_changed/);assert.deepEqual(approvalRows(f),empty);
  }else{
    await f.commit(command);const stored=approvalRows(f),prepare=f.DB.prepare.bind(f.DB);
    f.DB.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);bound.first=async(...args)=>{const result=await first(...args);f.env.DB=replacement;return result;};return bound;};return statement;};
    await assert.rejects(read(f),/authority_changed/);assert.deepEqual(approvalRows(f),stored);
  }
});

test('genuine existing Image V2 payer approval cannot provision the distinct Short story IO namespace',async t=>{
  const {fixture:imageFixture}=await import('./sponsor-initial-intake-fixture.mjs');
  const f=await imageFixture(t);assert.equal(f.policy.version,2);
  for(const sql of [...SPONSOR_STORY_IO_POLICY_SCHEMA,...SPONSOR_STORY_IO_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  const proposal={version:1,family:'canonical-short-story-io@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,ioPolicy:policy()};
  const before=protectedRows(f);
  await assert.rejects(prepareSponsorStoryIoApproval(request({action:'prepare-sponsor-story-io-policy',proposal},f.payerHeaders),f.env),/original_approval_unavailable/);
  await assert.rejects(approveSponsorStoryIoPolicy(request({action:'approve-sponsor-story-io-policy',approvalId:'image-is-not-story',proposal,
    reviewedTermsDigest:f.compiled.termsDigest,confirmation:'APPROVE_SPONSOR_STORY_IO_POLICY'},f.payerHeaders),f.env),/original_approval_unavailable/);
  assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

const damagedAcknowledgement=(receipts,kind)=>{
  const result=receipts.slice();
  if(kind==='sparse')delete result[0];
  else if(kind==='truncated')result.pop();
  else if(kind==='false')result[0]={...result[0],success:false};
  else if(kind==='missing-success'){result[0]={...result[0]};delete result[0].success;}
  else if(kind==='null')result[0]=null;
  else if(kind==='extra')result.push({...result[0]});
  else if(kind==='non-array')return {length:result.length};
  return result;
};

for(const phase of ['prepare','new approval finish','replay finish'])for(const kind of ['sparse','truncated','false','missing-success','null','extra','non-array'])
  test(`actual ${phase} rejects ${kind} final batch acknowledgement without replacing committed rows`,async t=>{
    const f=await setup(t),command=await f.command();
    if(phase==='replay finish')await f.commit(command);
    const before=protectedRows(f),stored=approvalRows(f),batch=f.DB.batch.bind(f.DB);let damaged=false,commits=0;
    f.DB.batch=async statements=>{
      const receipt=await batch(statements);
      if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_story_io_policies'))){commits++;return receipt;}
      damaged=true;return damagedAcknowledgement(receipt,kind);
    };
    await assert.rejects(phase==='prepare'?f.prepare():f.commit(command),/acknowledgement/);
    assert.equal(damaged,true);assert.deepEqual(protectedRows(f),before);
    if(phase==='new approval finish'){
      assert.equal(commits,1);assert.equal(approvalRows(f).policies.length,1);assert.equal(approvalRows(f).approvals.length,1);
    }else{assert.equal(commits,0);assert.deepEqual(approvalRows(f),stored);}
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_atomic_assertions').get().n,0);
  });

for(const kind of ['sparse','truncated','false','missing-success','null','extra','non-array'])
  test(`ambiguous ${kind} initial commit acknowledgement recovers only through exact retained rows and a fresh acknowledged finish`,async t=>{
    const f=await setup(t),command=await f.command(),before=protectedRows(f),batch=f.DB.batch.bind(f.DB);let commits=0,finishes=0;
    f.DB.batch=async statements=>{const receipts=await batch(statements);
      if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_story_io_policies'))){commits++;return damagedAcknowledgement(receipts,kind);}
      finishes++;return receipts;};
    const result=await f.commit(command);assert.equal(result.replayed,true);assert.equal(commits,1);assert.equal(finishes,1);
    const stored=approvalRows(f);assert.equal(stored.policies.length,1);assert.equal(stored.approvals.length,1);
    assert.deepEqual(await f.commit(command),result);assert.equal(commits,1);assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
  });

test('dense successful batch receipts preserve prepare, new approval and exact replay behavior',async t=>{
  const f=await setup(t),before=protectedRows(f),prepared=await f.prepare();assert.deepEqual(approvalRows(f),empty);
  const command=await f.command(),first=await f.commit(command),stored=approvalRows(f);
  assert.equal(first.replayed,false);assert.equal(first.termsDigest,prepared.termsDigest);
  assert.deepEqual(await f.commit(command),{...first,replayed:true});assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});

for(const initial of ['sparse','throw'])test(`ambiguous ${initial} initial commit followed by missing final proof acknowledgement refuses recovery`,async t=>{
  const f=await setup(t),command=await f.command(),before=protectedRows(f),batch=f.DB.batch.bind(f.DB);let commits=0,finishes=0;
  f.DB.batch=async statements=>{const receipts=await batch(statements);
    if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_story_io_policies'))){
      commits++;if(initial==='throw')throw Error('fixture_lost_initial_ack');return damagedAcknowledgement(receipts,'sparse');}
    finishes++;return damagedAcknowledgement(receipts,'sparse');};
  await assert.rejects(f.commit(command),/acknowledgement/);assert.equal(commits,1);assert.equal(finishes,1);
  assert.equal(approvalRows(f).policies.length,1);assert.equal(approvalRows(f).approvals.length,1);assert.deepEqual(protectedRows(f),before);
});

function syntheticPayerImpersonation(f){
  const now=new Date().toISOString();
  f.sqlite.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('io-cookie-fiction','io-cookie-fiction@example.invalid','IO cookie fictional','creator',null,null,now,now);
  f.sqlite.prepare('INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('io-cookie-persona','io-cookie-replay',f.payer,'io-cookie-fiction','creative:io-cookie-fiction','IO cookie fictional','ready',now,now);
  f.sqlite.prepare('INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('io-cookie-acting',f.payer,'io-cookie-persona','io-cookie-fiction','io-cookie-replay','active',now,'2099-01-01T00:00:00.000Z');
}
function afterPayerRead(f,mutate){
  const prepare=f.DB.prepare.bind(f.DB);let changed=false;
  f.DB.prepare=sql=>{
    const statement=prepare(sql),bind=statement.bind.bind(statement);
    statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);
      bound.first=async(...args)=>{const row=await first(...args);if(!changed&&row?.user_id===f.payer){changed=true;mutate();}return row;};return bound;};
    return statement;
  };
  return {restore:()=>{f.DB.prepare=prepare;},changed:()=>changed};
}

for(const phase of ['prepare','approve'])for(const cookie of ['retained','removed'])
  test(`internal mutable Request ${phase} refuses originally active impersonation cookie ${cookie} across native authentication`,async t=>{
    const f=await setup(t),command=await f.command();syntheticPayerImpersonation(f);
    const before=protectedRows(f),sessions=f.sqlite.prepare('SELECT * FROM impersonation_sessions').all();
    const req=request(phase==='prepare'?{action:'prepare-sponsor-story-io-policy',proposal:f.ioProposal}:command,
      {...f.payerHeaders,cookie:'forma_impersonation=io-cookie-acting'});
    const hook=afterPayerRead(f,()=>{if(cookie==='removed')req.headers.delete('cookie');});
    try{await assert.rejects(phase==='prepare'?prepareSponsorStoryIoApproval(req,f.env):approveSponsorStoryIoPolicy(req,f.env),
      cookie==='removed'?/authority_changed/:/canonical_principal_required/);}finally{hook.restore();}
    assert.equal(hook.changed(),true);assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM impersonation_sessions').all(),sessions);
  });

for(const [name,mutate]of [
  ['method',req=>Object.defineProperty(req,'method',{value:'GET'})],
  ['url',req=>Object.defineProperty(req,'url',{value:'http://localhost/changed-internal-command'})],
  ['OAI id',(req,f)=>req.headers.set('oai-authenticated-user-id',f.actor)],
  ['OAI email',req=>req.headers.set('oai-authenticated-user-email','changed@example.invalid')],
  ['OAI full name',req=>req.headers.set('oai-authenticated-user-full-name','Changed')],
  ['OAI name encoding',req=>req.headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8')],
  ['cookie',req=>req.headers.set('cookie','changed-internal-cookie=1')],
  ['admin environment',(req,f)=>{f.env.FORMA_ADMIN_EMAILS='changed-admin@example.invalid';}],
  ['cohort environment',(req,f)=>{f.env.FORMA_PILOT_COHORT_ID='changed-cohort';}],
])test(`internal mutable Request boundary rejects ${name} substitution after native principal read`,async t=>{
  const f=await setup(t),before=protectedRows(f),req=request({action:'prepare-sponsor-story-io-policy',proposal:f.ioProposal},f.payerHeaders);
  const hook=afterPayerRead(f,()=>mutate(req,f));
  try{await assert.rejects(prepareSponsorStoryIoApproval(req,f.env),/authority_changed/);}finally{hook.restore();}
  assert.equal(hook.changed(),true);assert.deepEqual(approvalRows(f),empty);assert.deepEqual(protectedRows(f),before);
});

test('stable internal original payer Request remains valid for prepare, approval and replay',async t=>{
  const f=await setup(t),before=protectedRows(f);f.env.FORMA_ADMIN_EMAILS='stable@example.invalid';
  const req=request({action:'prepare-sponsor-story-io-policy',proposal:f.ioProposal},{...f.payerHeaders,cookie:'stable-internal-cookie=1'});
  const hook=afterPayerRead(f,()=>{});let prepared;
  try{prepared=await prepareSponsorStoryIoApproval(req,f.env);}finally{hook.restore();}
  assert.equal(hook.changed(),true);assert.equal(prepared.terms.payerUserId,f.payer);
  const command={action:'approve-sponsor-story-io-policy',approvalId:'stable-internal-approval',proposal:f.ioProposal,
    reviewedTermsDigest:prepared.termsDigest,confirmation:'APPROVE_SPONSOR_STORY_IO_POLICY'};
  const make=()=>request(command,{...f.payerHeaders,cookie:'stable-internal-cookie=1'});
  const first=await approveSponsorStoryIoPolicy(make(),f.env);assert.equal(first.replayed,false);
  assert.deepEqual(await approveSponsorStoryIoPolicy(make(),f.env),{...first,replayed:true});assert.deepEqual(protectedRows(f),before);
});

test('retained immutable provenance gains no current cohort or admin gate from request pinning',async t=>{
  const f=await setup(t);await f.commit(await f.command());const before=protectedRows(f),stored=approvalRows(f);
  f.env.FORMA_ADMIN_EMAILS='changed-admin@example.invalid';f.env.FORMA_PILOT_COHORT_ID='changed-cohort';
  assertProof(f,await read(f));assert.deepEqual(approvalRows(f),stored);assert.deepEqual(protectedRows(f),before);
});
