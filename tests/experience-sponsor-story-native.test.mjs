import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,actor,payer,stream,context,headers,post,
  readSponsorFinancialBinding,sponsorFinancialIdentity,runDocumentJob,handleDocumentJobs,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,
  handleEventPrivacy,revokeSponsorCampaign} from './sponsor-story-native-fixture.mjs';

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in dormant Story qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});

test('V4 payer approval and actual one-call native Story admission/execution settle only the sponsor under strict local SQL limits',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true}),actorBefore=actorCounters(f),accepted=await f.execute();assert.equal(accepted.replayed,false);assert.equal(calls.length,0);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,1);assert.equal(slot.maximum_calls,1);
  assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(job.status,'queued');
  assert.deepEqual(f.sqlite.prepare('SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes').all().map(row=>({...row})),[{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
  const stableAdmission=rows(f),replay=await f.execute();assert.equal(replay.replayed,true);assert.deepEqual(rows(f),stableAdmission);
  const run=await freshRun(f);await run.queue();const finished=await run.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
  assertPayerSettlement(f);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');
  const retained=await loadOutputJobBinding(f.env,run.trusted.principal,f.sqlite.prepare('SELECT * FROM document_jobs').get());assert.equal(retained.sponsored,true);
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n>0);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,providerCallsIntercepted:calls.length,actualNetworkRequests:0}));
});

test('unsealed Story commands and public runner cannot borrow the payer or dispatch the native job',async t=>{
  const calls=transport(t),f=await fixture(t),before=rows(f);
  for(const seal of [{},structuredClone(f.authority),{...f.authority}])await assert.rejects(f.execute(seal),/sponsor_authority_unavailable/);
  const wire=await f.send({...f.command,sponsor_entitlement:{payer_user_id:payer}});assert.equal(wire.status,403);assert.deepEqual(rows(f),before);
  await f.execute();const run=await freshRun(f);await run.queue();const queued=rows(f);
  assert.equal((await f.send({action:'run',grantId:run.command.grantId})).status,403);
  const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/run`,{method:'POST'}),f.env,`${run.jobId}/run`,context);assert.equal(response.status,403);
  await assert.rejects(runDocumentJob(f.env,run.trusted.principal,run.jobId),/sponsor_execution_not_enabled/);
  assert.deepEqual(rows(f),queued);assert.equal(calls.length,0);const finished=await run.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
});

for(const reason of ['campaign','payer consent','issued expiry'])test(`Story ${reason} revocation after seal prevents the first provider call`,async t=>{
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f);
  if(reason==='campaign')await revokeSponsorCampaign(new Request('http://localhost/__fixture/story-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
  if(reason==='payer consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
  if(reason==='issued expiry')f.sqlite.exec('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1');
  const before=rows(f);await assert.rejects(run.queue(),/sponsor_execution_authority_revoked/);assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
});

for(const reason of ['campaign revocation','issued expiry','private-body erasure'])test(`incurred Story usage settles original payer once after ${reason}`,async t=>{
  const f=await fixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  const calls=transport(t,{afterDispatch:async()=>{
    if(reason==='campaign revocation')await revokeSponsorCampaign(new Request('http://localhost/__fixture/story-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
    if(reason==='issued expiry')f.sqlite.exec('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1');
    if(reason==='private-body erasure'){
      const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',post({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);
      assert.equal(response.status,200,await response.clone().text());
      assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_json='' AND redacted_at IS NOT NULL").get().n>0);
    }
  }});
  const stopped=await run.drive();assert.equal(stopped.status,'failed',JSON.stringify(stopped));assert.equal(calls.length,1);assertPayerSettlement(f);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0,'Revoked creative authority cannot publish the returned Story');
  const financial=await readSponsorFinancialBinding(f.env,actor,run.jobId);assert.equal(sponsorFinancialIdentity(financial,f.env,actor,run.jobId).payerUserId,payer);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);
});

test('expired unstarted Story authorization settles at zero using only its original financial binding',async t=>{
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);
  f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z';UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}'");
  await reconcileExpiredOutputAuthorizations(f.env,run.trusted.principal);
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();assert.equal(tokens.owner_id,payer);assert.equal(tokens.operation,'document-render:short_story');assert.equal(tokens.status,'released');assert.equal(tokens.used_tokens,0);
  for(const [scope,id] of [['user',payer],['workspace','forma']]){assert.equal(f.sqlite.prepare('SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_tokens,0);assert.equal(f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_microusd,0);}
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();assert.equal(cost.owner_id,payer);assert.equal(cost.operation,'document-render:short_story');assert.equal(cost.status,'released');assert.equal(cost.used_microusd,0);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(calls.length,0);
  const stable=finances(f);await reconcileExpiredOutputAuthorizations(f.env,run.trusted.principal);assert.deepEqual(finances(f),stable);
});

test('original Image reviewed terms cannot approve the different V4 Story campaign',async t=>{
  const {fixture:imageFixture}=await import('./sponsor-driver-fixture.mjs');
  const {compileSponsorApprovalProposal}=await import('./sponsor-story-native-fixture.mjs');
  const image=await imageFixture(t,{approved:false}),oldReview=await compileSponsorApprovalProposal(image.proposal);
  assert.equal(oldReview.policy.version,2);
  const f=await fixture(t,{sponsor:false}),before=rows(f),changes=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  await assert.rejects(f.sponsor({reviewedTermsDigest:oldReview.termsDigest}),/sponsor_payer_approval_required/);
  assert.deepEqual(rows(f),before);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
  for(const table of ['experience_sponsor_approvals','experience_sponsor_campaigns','experience_sponsor_grants','experience_sponsor_issuances'])assert.equal(count(f,table),0);
});

test('genuine Story financial profile refuses Image and 3D event actions, forged seals and DB/reference substitution',async t=>{
  const {handleEvents,createOutputEventExecution,sponsorFinancialEventProfile}=await import('./sponsor-story-native-fixture.mjs');
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f);await run.queue();
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),binding=await loadOutputJobBinding(f.env,run.trusted.principal,job);
  const output=await createOutputEventExecution(f.env,run.trusted.principal,job,binding,undefined,run.authority);
  assert.equal(sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,output.reference),'short_story');
  const before=rows(f),execution={output,signal:new AbortController().signal,beginCommit:async()=>{throw Error('Gate must refuse before commit');},progress:async()=>{throw Error('Gate must refuse before progress');}};
  for(const body of [{action:'generate',documentId:f.documentId},{action:'render_document',documentId:f.documentId,artifactKind:'model3d',productionMode:'manual',itemCount:3},{action:'render_document',documentId:f.documentId,artifactKind:'short_story',productionMode:'managed',itemCount:3}]){
    const response=await handleEvents(new Request('http://localhost/api/events',post(body)),f.env,false,run.trusted.principal,execution);
    assert.equal(response.status,403,await response.clone().text());assert.equal((await response.json()).error,'sponsor_recipe_unsupported');
  }
  for(const seal of [{},structuredClone(output.sponsorFinancialBinding)])assert.throws(()=>sponsorFinancialEventProfile(seal,f.env,actor,output.reference),/sponsor_financial_authority_unavailable/);
  for(const patch of [{scopeKey:'other'},{grantId:'other'},{slotId:'other'}])assert.throws(()=>sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,{...output.reference,...patch}),/sponsor_financial_authority_unavailable/);
  const db=f.env.DB;f.env.DB={...db};assert.throws(()=>sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,output.reference),/sponsor_financial_authority_unavailable/);f.env.DB=db;
  assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
});

test('Story admission uses funded sponsor balances exclusively and cannot fall back to a funded actor',async t=>{
  const calls=transport(t);
  for(const depleted of [actor,payer]){
    const f=await fixture(t);
    assert.ok(f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='user' AND scope_id=?").run(depleted).changes>0);
    assert.ok(f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user' AND scope_id=?").run(depleted).changes>0);
    const other=depleted===actor?payer:actor;
    for(const [table,used,held,maximum] of [['budget_counters','used_tokens','reserved_tokens','hard_limit_tokens'],['cost_budget_counters','used_microusd','reserved_microusd','hard_limit_microusd']]){
      const exhausted=f.sqlite.prepare(`SELECT * FROM ${table} WHERE scope='user' AND scope_id=?`).get(depleted),funded=f.sqlite.prepare(`SELECT * FROM ${table} WHERE scope='user' AND scope_id=?`).get(other);
      assert.equal(exhausted[used],exhausted[maximum]);assert.ok(funded[maximum]-funded[used]-funded[held]>f.terms.targets[0][table==='budget_counters'?'maximumTokens':'maximumMicrousd']);
    }
    const before=rows(f),actorBefore=actorCounters(f);
    if(depleted===actor){await f.execute();assert.equal(f.sqlite.prepare('SELECT owner_id FROM cost_budget_reservations').get().owner_id,payer);}
    else{await assert.rejects(f.execute(),error=>{assert.equal(error.code,'sponsor_budget_unavailable');return true;});assert.deepEqual(rows(f),before);}
    assert.deepEqual(actorCounters(f),actorBefore);
  }
  assert.equal(calls.length,0);
});
