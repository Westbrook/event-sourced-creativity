import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,requestFor} from './sponsor-initial-intake-fixture.mjs';

const [{SPONSOR_INTAKE_READ_POLICY_SCHEMA,SPONSOR_IMAGE_INTAKE_READ_OPERATIONS,SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS},
  {SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
  {SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA,reserveSponsorIntakeReadAttempt,takeSponsorIntakeReadAttempt,SponsorIntakeReadLimitError},
  {identifySponsorIntakeRead},{canonicalJson,digest}]=await Promise.all([
  import('../worker/experience-sponsor-intake-read-policy.ts'),import('../worker/experience-sponsor-intake-read-approval.ts'),
  import('../worker/experience-sponsor-intake-read-attempts.ts'),import('../worker/experience-sponsor-intake-reads.ts'),
  import('../src/experiences/compiler.ts'),
]);
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('V2 intake read approval qualification prohibits network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const policy=(version=2)=>({version,windowMs:60_000,
  operations:Object.fromEntries((version===2?SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS:SPONSOR_IMAGE_INTAKE_READ_OPERATIONS)
    .map(operation=>[operation,{maximumBytes:1000,deadlineMs:10_000}])),
  actor:{maximumRequestsPerWindow:20,maximumBytesPerWindow:20_000},
  campaign:{maximumRequestsPerWindow:40,maximumBytesPerWindow:40_000}});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
const approvalRows=f=>({policies:rows(f,'experience_sponsor_intake_read_policies'),approvals:rows(f,'experience_sponsor_intake_read_approvals')});
const attempts=f=>rows(f,'experience_sponsor_intake_read_attempts');
const nativeState=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN('experience_sponsor_intake_read_policies','experience_sponsor_intake_read_approvals','experience_sponsor_intake_read_attempts') ORDER BY name")
  .all().map(({name})=>[name,rows(f,name)]));
const unpaid=f=>{
  for(const table of ['events','private_content','document_jobs','output_preflights','output_execution_grants','output_provider_calls',
    'experience_sponsor_grants','experience_sponsor_consumptions','budget_reservations','cost_budget_reservations'])assert.deepEqual(rows(f,table),[],table);
  assert.equal(f.media.size,0);
};

async function setup(t,{terms=policy(),attemptVersion=2,extraActorUserIds=[]}={}){
  const f=await fixture(t,{extraActorUserIds});
  for(const sql of [...SPONSOR_INTAKE_READ_POLICY_SCHEMA,...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,
    ...(attemptVersion===2?SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA:SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA)])f.sqlite.exec(sql);
  f.readTerms=terms;
  f.proposalFor=readPolicy=>({version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy});
  f.review=(readPolicy=terms,actor=f.payer)=>prepareSponsorIntakeReadApproval(requestFor(f,
    {action:'prepare-sponsor-intake-read-policy',proposal:f.proposalFor(readPolicy)},{actorUserId:actor}),f.env);
  f.command=async(readPolicy=terms,approvalId='fixture-v2-read-approval')=>({action:'approve-sponsor-intake-read-policy',approvalId,
    proposal:f.proposalFor(readPolicy),reviewedTermsDigest:(await f.review(readPolicy)).termsDigest,confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'});
  f.commit=(command,actor=f.payer)=>approveSponsorIntakeReadPolicy(requestFor(f,command,{actorUserId:actor}),f.env);
  f.reserve=async(actor=f.actor)=>{
    const request=new Request('http://localhost/__fixture/v2-intake-read-bootstrap',{headers:f.headersFor(actor)});
    const authority=await identifySponsorIntakeRead(request,f.env,{operation:'image-intake-bootstrap',campaignId:f.campaignId});
    const attempt=await reserveSponsorIntakeReadAttempt(authority,request,f.env,'image-intake-bootstrap');
    return {request,authority,attempt};
  };
  f.take=input=>takeSponsorIntakeReadAttempt(input.attempt,input.authority,input.request,f.env);
  return f;
}

test('the actual payer explicitly approves fresh V2 terms and exact replay preserves all four reviewed operations',async t=>{
  const f=await setup(t),before=nativeState(f),reviewed=await f.review(),command=await f.command();
  assert.deepEqual(approvalRows(f),{policies:[],approvals:[]});assert.deepEqual(attempts(f),[]);
  assert.equal(reviewed.terms.payerUserId,f.payer);assert.equal(reviewed.terms.originalApprovalId,f.approval.approvalId);
  assert.deepEqual(reviewed.terms.proposal,f.proposalFor(f.readTerms));assert.equal(reviewed.termsDigest,await digest(reviewed.terms));
  assert.equal(reviewed.readPolicyDigest,await digest(f.readTerms));
  assert.deepEqual(Object.keys(reviewed.terms.proposal.readPolicy.operations).sort(),[...SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS].sort());
  await assert.rejects(f.review(f.readTerms,f.actor),/sponsor_intake_read_payer_approval_required/u);
  await assert.rejects(f.commit(command,f.actor),/sponsor_intake_read_payer_approval_required/u);
  const first=await f.commit(command),saved=approvalRows(f);assert.equal(first.replayed,false);
  assert.equal(saved.policies.length,1);assert.equal(saved.approvals.length,1);
  assert.equal(saved.policies[0].policy_json,canonicalJson(f.readTerms));assert.equal(saved.policies[0].read_policy_digest,reviewed.readPolicyDigest);
  assert.equal(saved.approvals[0].terms_json,canonicalJson(reviewed.terms));assert.equal(saved.approvals[0].approved_by_user_id,f.payer);
  assert.equal(saved.approvals[0].approval_command_json,canonicalJson(command));
  const receipt=JSON.parse(saved.approvals[0].review_receipt_json);
  assert.equal(receipt.approvalCommandDigest,await digest(command));assert.equal(receipt.readPolicyDigest,reviewed.readPolicyDigest);
  assert.equal(saved.policies[0].review_receipt_digest,await digest(receipt));
  assert.deepEqual(await f.commit(structuredClone(command)),{...first,replayed:true});
  assert.deepEqual(approvalRows(f),saved);assert.deepEqual(attempts(f),[]);assert.deepEqual(nativeState(f),before);unpaid(f);
});

test('a V1 review digest cannot approve a changed V2 proposal; a new explicit V2 review is required',async t=>{
  const f=await setup(t),oldReview=await f.review(policy(1)),before=nativeState(f),command=await f.command();
  assert.notEqual(command.reviewedTermsDigest,oldReview.termsDigest);
  await assert.rejects(f.commit({...command,reviewedTermsDigest:oldReview.termsDigest}),/sponsor_intake_read_terms_not_reviewed/u);
  assert.deepEqual(approvalRows(f),{policies:[],approvals:[]});assert.deepEqual(attempts(f),[]);
  assert.equal((await f.commit(command)).replayed,false);assert.deepEqual(nativeState(f),before);unpaid(f);
});

test('an existing V1 approval cannot upgrade to V2 or reset its already consumed bootstrap allowance',async t=>{
  const terms=policy(1);terms.actor.maximumRequestsPerWindow=1;
  const f=await setup(t,{terms,attemptVersion:1}),original=await f.command();await f.commit(original);
  const input=await f.reserve(),taken=await f.take(input);assert.equal(taken.operation,'image-intake-bootstrap');
  const approved=approvalRows(f),charged=attempts(f),before=nativeState(f);
  const schema=f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='experience_sponsor_intake_read_attempts'").get().sql;
  assert.equal(charged.length,1);assert.equal(schema.includes('image-output-confirmation'),false);
  const replacement=policy(2),changed=await f.command(replacement);
  for(const command of [changed,{...changed,approvalId:'fixture-new-v2-read-approval'}])await assert.rejects(f.commit(command));
  assert.equal((await f.commit(structuredClone(original))).replayed,true);
  await assert.rejects(f.reserve(),error=>error instanceof SponsorIntakeReadLimitError&&error.retryAfterMs>0);
  assert.deepEqual(approvalRows(f),approved);assert.deepEqual(attempts(f),charged);assert.deepEqual(nativeState(f),before);
  assert.equal(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='experience_sponsor_intake_read_attempts'").get().sql,schema);unpaid(f);
});

test('V2 approval lost acknowledgment recovers the one immutable receipt, and an existing operation reserves and takes once',async t=>{
  const f=await setup(t),before=nativeState(f),command=await f.command(),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intake_read_approvals'))){lost=true;throw Error('fixture_v2_read_approval_lost_ack');}
    return result;
  };
  const recovered=await f.commit(command);assert.equal(lost,true);assert.equal(recovered.replayed,true);
  const approved=approvalRows(f);assert.equal(approved.policies.length,1);assert.equal(approved.approvals.length,1);
  assert.deepEqual(await f.commit(structuredClone(command)),recovered);assert.deepEqual(approvalRows(f),approved);
  const input=await f.reserve(),charged=attempts(f),taken=await f.take(input);
  assert.equal(charged.length,1);assert.equal(charged[0].read_policy_digest,recovered.readPolicyDigest);
  assert.equal(charged[0].maximum_bytes,f.readTerms.operations['image-intake-bootstrap'].maximumBytes);
  assert.equal(taken.operation,'image-intake-bootstrap');assert.equal(taken.maximumBytes,1000);assert.ok(taken.remainingMs>0);
  await assert.rejects(f.take(input),/sponsor_intake_read_attempt_unavailable/u);
  assert.deepEqual(attempts(f),charged);assert.deepEqual(nativeState(f),before);unpaid(f);
});

/** These are historical accounting fixtures, not approved authority or executed
 * confirmation reads. The extra policy row supplies only the historical FK;
 * it deliberately has no approval provenance and cannot authorize a request.
 * Current bootstrap admission always consumes the real payer-approved V2 row. */
async function seedHistoricalUsage(f,{fourthActor=f.actor}={}){
  const historicalPolicy=policy(1),historicalSponsorDigest=await digest({fixture:'historical-original-sponsor-policy'}),historicalReadDigest=await digest(historicalPolicy);
  f.sqlite.prepare('INSERT INTO experience_sponsor_intake_read_policies(campaign_id,sponsor_policy_digest,read_policy_digest,policy_json,review_receipt_digest) VALUES(?,?,?,?,?)')
    .run(f.campaignId,historicalSponsorDigest,historicalReadDigest,canonicalJson(historicalPolicy),await digest({fixture:'historical-index-only'}));
  const now=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now,currentReadDigest=await digest(f.readTerms);
  const insert=f.sqlite.prepare(`INSERT INTO experience_sponsor_intake_read_attempts(attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,
    actor_user_id,resource_key,operation,maximum_bytes,admitted_at_ms,deadline_at_ms,charged_through_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('fixture-historical-v1-read',f.campaignId,historicalSponsorDigest,historicalReadDigest,f.actor,'fixture:historical-v1-draft',
    'image-intake-draft',1000,now-40_000,now-10_000,now+50_000);
  insert.run('fixture-historical-v1-receipt',f.campaignId,historicalSponsorDigest,historicalReadDigest,f.actor,'fixture:historical-v1-receipt',
    'image-intake-receipt',1000,now-40_000,now-10_000,now+50_000);
  insert.run('fixture-historical-v2-confirmation',f.campaignId,f.compiled.policyDigest,currentReadDigest,fourthActor,'fixture:historical-v2-confirmation',
    'image-output-confirmation',1000,now-40_000,now-10_000,now+50_000);
  assert.notEqual(historicalSponsorDigest,f.compiled.policyDigest);assert.notEqual(historicalReadDigest,currentReadDigest);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_approvals WHERE sponsor_policy_digest=?').get(historicalSponsorDigest).n,0);
  const historical=attempts(f);
  assert.ok(historical.every(row=>row.deadline_at_ms<now&&row.charged_through_ms>now&&row.charged_through_ms-row.deadline_at_ms===60_000));
  return historical;
}

for(const scope of ['actor','campaign'])for(const limit of ['requests','bytes'])test(`V2 ${scope} ${limit} quota conserves seeded fourth-operation and older sponsor/read-policy usage`,async t=>{
  const other='fixture-v2-read-other-actor',terms=policy();
  if(limit==='requests'){
    terms[scope].maximumRequestsPerWindow=4;
    if(scope==='campaign')terms.actor.maximumRequestsPerWindow=4;
  }else{
    terms[scope].maximumBytesPerWindow=4000;
    if(scope==='campaign')terms.actor.maximumBytesPerWindow=4000;
  }
  const f=await setup(t,{terms,extraActorUserIds:[other]});await f.commit(await f.command());
  const historical=await seedHistoricalUsage(f,{fourthActor:scope==='campaign'?other:f.actor}),before=nativeState(f),approved=approvalRows(f);
  const input=await f.reserve(),beforeTake=attempts(f),taken=await f.take(input),charged=attempts(f);
  assert.deepEqual(charged,beforeTake,'taking an admitted capability does not refund or reset its accounting');
  assert.equal(taken.operation,'image-intake-bootstrap');assert.equal(charged.length,4);
  assert.deepEqual([...new Set(charged.map(row=>row.operation))].sort(),[...SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS].sort());
  for(const row of historical)assert.deepEqual(charged.find(candidate=>candidate.attempt_id===row.attempt_id),row);
  const usage=charged.reduce((value,row)=>({campaignRequests:value.campaignRequests+1,campaignBytes:value.campaignBytes+row.maximum_bytes,
    actorRequests:value.actorRequests+Number(row.actor_user_id===f.actor),actorBytes:value.actorBytes+(row.actor_user_id===f.actor?row.maximum_bytes:0)}),
  {campaignRequests:0,campaignBytes:0,actorRequests:0,actorBytes:0});
  assert.equal(usage[`${scope}${limit==='requests'?'Requests':'Bytes'}`],limit==='requests'?4:4000);
  // The alternate dimension and scope cannot explain the next rejection.
  if(limit==='requests'){
    assert.ok(usage.actorBytes+1000<=terms.actor.maximumBytesPerWindow);assert.ok(usage.campaignBytes+1000<=terms.campaign.maximumBytesPerWindow);
  }else{
    assert.ok(usage.actorRequests+1<=terms.actor.maximumRequestsPerWindow);assert.ok(usage.campaignRequests+1<=terms.campaign.maximumRequestsPerWindow);
  }
  if(scope==='campaign'){
    assert.ok(usage.actorRequests+1<=terms.actor.maximumRequestsPerWindow);assert.ok(usage.actorBytes+1000<=terms.actor.maximumBytesPerWindow);
    assert.ok(charged.some(row=>row.actor_user_id===other));
  }else{
    assert.ok(usage.campaignRequests+1<=terms.campaign.maximumRequestsPerWindow);assert.ok(usage.campaignBytes+1000<=terms.campaign.maximumBytesPerWindow);
  }
  await assert.rejects(f.reserve(),error=>error instanceof SponsorIntakeReadLimitError&&error.code==='sponsor_intake_read_limit_reached'&&error.retryAfterMs>0);
  assert.deepEqual(attempts(f),charged);assert.deepEqual(approvalRows(f),approved);assert.deepEqual(nativeState(f),before);unpaid(f);
});
