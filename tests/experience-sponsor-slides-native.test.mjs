import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,assertRuntimeCalls,all,actor,payer,stream,context,headers,post,
  readSponsorFinancialBinding,sponsorFinancialIdentity,outputDocumentExecutionBridge,runDocumentJob,handleDocumentJobs,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,
  handleEventPrivacy,revokeSponsorCampaign} from './sponsor-slides-native-fixture.mjs';

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in dormant Slides qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
// Native terminal reconciliation refreshes only the slot's updated_at. Every
// identity, status, event, job and financial field remains an exact replay oracle.
const replayRows=f=>{const snapshot=rows(f);for(const slot of snapshot.output_operation_slots)delete slot.updated_at;return snapshot;};

test('V5 payer approval and actual initial-only native Slides admission/execution settle only the sponsor under strict local SQL limits',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true}),actorBefore=actorCounters(f),accepted=await f.execute();assert.equal(accepted.replayed,false);assert.equal(calls.length,0);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,2);assert.equal(slot.maximum_calls,2);
  assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(job.status,'queued');
  assert.deepEqual(f.sqlite.prepare('SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes').all().map(row=>({...row})),[{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1},{stage_key:'planning:0:repair',provider:'openai',model:'gpt-5.6-sol',maximum_calls:1}]);
  const stableAdmission=rows(f),replay=await f.execute();assert.equal(replay.replayed,true);assert.deepEqual(rows(f),stableAdmission);
  const run=await freshRun(f);await run.queue();const finished=await run.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
  assertPayerSettlement(f);assertRuntimeCalls(f,calls);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');
  const retained=await loadOutputJobBinding(f.env,run.trusted.principal,f.sqlite.prepare('SELECT * FROM document_jobs').get());assert.equal(retained.sponsored,true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,1);
  const before=replayRows(f);await run.drive();assert.deepEqual(replayRows(f),before);assert.equal(calls.length,1);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,providerCallsIntercepted:calls.length,actualNetworkRequests:0}));
});

test('unsealed Slides commands and public runner cannot borrow the payer or dispatch the native job',async t=>{
  const calls=transport(t),f=await fixture(t),before=rows(f);
  for(const seal of [{},structuredClone(f.authority),{...f.authority}])await assert.rejects(f.execute(seal),/sponsor_authority_unavailable/);
  const wire=await f.send({...f.command,sponsor_entitlement:{payer_user_id:payer}});assert.equal(wire.status,403);assert.deepEqual(rows(f),before);
  await f.execute();const run=await freshRun(f);await run.queue();const queued=rows(f);
  assert.equal((await f.send({action:'run',grantId:run.command.grantId})).status,403);
  const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/run`,{method:'POST'}),f.env,`${run.jobId}/run`,context);assert.equal(response.status,403);
  await assert.rejects(runDocumentJob(f.env,run.trusted.principal,run.jobId),/sponsor_execution_not_enabled/);
  assert.deepEqual(rows(f),queued);assert.equal(calls.length,0);const finished=await run.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
});

for(const reason of ['campaign','payer consent','issued expiry'])test(`Slides ${reason} revocation after seal prevents the first provider call`,async t=>{
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f);
  if(reason==='campaign')await revokeSponsorCampaign(new Request('http://localhost/__fixture/slides-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
  if(reason==='payer consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
  if(reason==='issued expiry')f.sqlite.exec('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1');
  const before=rows(f);await assert.rejects(run.queue(),/sponsor_execution_authority_revoked/);assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
});

for(const reason of ['campaign revocation','issued expiry','private-body erasure'])test(`incurred initial Slides usage settles original payer and stops repair after ${reason}`,async t=>{
  const f=await fixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  const calls=transport(t,{repairAtCall:1,afterDispatch:async()=>{
    if(reason==='campaign revocation')await revokeSponsorCampaign(new Request('http://localhost/__fixture/slides-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
    if(reason==='issued expiry')f.sqlite.exec('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1');
    if(reason==='private-body erasure'){
      const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',post({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);
      assert.equal(response.status,200,await response.clone().text());
      assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_json='' AND redacted_at IS NOT NULL").get().n>0);
    }
  }});
  const stopped=await run.drive();assert.equal(stopped.status,'failed',JSON.stringify(stopped));assert.equal(calls.length,1);assertPayerSettlement(f);assertRuntimeCalls(f,calls);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0,'Revoked creative authority cannot publish the returned Slides');
  const financial=await readSponsorFinancialBinding(f.env,actor,run.jobId);assert.equal(sponsorFinancialIdentity(financial,f.env,actor,run.jobId).payerUserId,payer);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);
});

test('expired unstarted Slides authorization settles at zero using only its original financial binding',async t=>{
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);
  f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z';UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}'");
  await reconcileExpiredOutputAuthorizations(f.env,run.trusted.principal);
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();assert.equal(tokens.owner_id,payer);assert.equal(tokens.operation,'document-render:slides');assert.equal(tokens.status,'released');assert.equal(tokens.used_tokens,0);
  for(const [scope,id] of [['user',payer],['workspace','forma']]){assert.equal(f.sqlite.prepare('SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_tokens,0);assert.equal(f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_microusd,0);}
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();assert.equal(cost.owner_id,payer);assert.equal(cost.operation,'document-render:slides');assert.equal(cost.status,'released');assert.equal(cost.used_microusd,0);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(calls.length,0);
  const stable=finances(f);await reconcileExpiredOutputAuthorizations(f.env,run.trusted.principal);assert.deepEqual(finances(f),stable);
});

test('original Image reviewed terms cannot approve the different V5 Slides campaign',async t=>{
  const {fixture:imageFixture}=await import('./sponsor-driver-fixture.mjs');
  const {compileSponsorApprovalProposal}=await import('./sponsor-slides-native-fixture.mjs');
  const image=await imageFixture(t,{approved:false}),oldReview=await compileSponsorApprovalProposal(image.proposal);
  assert.equal(oldReview.policy.version,2);
  const f=await fixture(t,{sponsor:false}),before=rows(f),changes=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  await assert.rejects(f.sponsor({reviewedTermsDigest:oldReview.termsDigest}),/sponsor_payer_approval_required/);
  assert.deepEqual(rows(f),before);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
  for(const table of ['experience_sponsor_approvals','experience_sponsor_campaigns','experience_sponsor_grants','experience_sponsor_issuances'])assert.equal(count(f,table),0);
});

test('genuine Slides financial profile refuses Image and 3D event actions, forged seals and DB/reference substitution',async t=>{
  const {handleEvents,createOutputEventExecution,sponsorFinancialEventProfile}=await import('./sponsor-slides-native-fixture.mjs');
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f);await run.queue();
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),binding=await loadOutputJobBinding(f.env,run.trusted.principal,job);
  const output=await createOutputEventExecution(f.env,run.trusted.principal,job,binding,undefined,run.authority);
  assert.equal(sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,output.reference),'slides');
  const before=rows(f),execution={output,signal:new AbortController().signal,beginCommit:async()=>{throw Error('Gate must refuse before commit');},progress:async()=>{throw Error('Gate must refuse before progress');}};
  const baseline={...structuredClone(output.settings),action:'render_document',documentId:f.documentId};
  assert.equal(baseline.itemCount,5);assert.equal(baseline.requestedSlideCount,5);assert.deepEqual(baseline.slideCountPolicy,{kind:'exact',unit:'slide',value:5});
  for(const patch of [{action:'generate'},{artifactKind:'short_story'},{artifactKind:'model3d'},{itemCount:4},{productionMode:'managed'},{requestedSlideCount:6},{slideCountPolicy:{kind:'exact',unit:'slide',value:6}},{outputTargetInstructions:baseline.outputTargetInstructions+' changed'}]){
    const body={...baseline,...patch};
    const response=await handleEvents(new Request('http://localhost/api/events',post(body)),f.env,false,run.trusted.principal,execution);
    assert.equal(response.status,403,await response.clone().text());assert.equal((await response.json()).error,'sponsor_recipe_unsupported');
  }
  for(const seal of [{},structuredClone(output.sponsorFinancialBinding)])assert.throws(()=>sponsorFinancialEventProfile(seal,f.env,actor,output.reference),/sponsor_financial_authority_unavailable/);
  for(const patch of [{scopeKey:'other'},{grantId:'other'},{slotId:'other'}])assert.throws(()=>sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,{...output.reference,...patch}),/sponsor_financial_authority_unavailable/);
  const db=f.env.DB;f.env.DB={...db};assert.throws(()=>sponsorFinancialEventProfile(output.sponsorFinancialBinding,f.env,actor,output.reference),/sponsor_financial_authority_unavailable/);f.env.DB=db;
  assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
});

test('Slides admission uses funded sponsor balances exclusively and cannot fall back to a funded actor',async t=>{
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


test('V5 mixed-route optional repair records its own wire tuple and settles both calls exactly once under strict SQL',async t=>{
  const calls=transport(t,{repairAtCall:1}),f=await fixture(t,{strict:true}),actorBefore=actorCounters(f);
  await f.execute();const run=await freshRun(f);await run.queue();const finished=await run.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));
  assert.equal(calls.length,2);assertPayerSettlement(f,400,2);assertRuntimeCalls(f,calls);assert.deepEqual(actorCounters(f),actorBefore);
  assert.deepEqual(calls.map(call=>[call.stage,call.body.model,call.body.reasoning.effort]),[['planning:0:initial','gpt-5.6-terra','low'],['planning:0:repair','gpt-5.6-sol','medium']]);
  assert.notEqual(calls[0].requestDigest,calls[1].requestDigest);assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'budget_reservations'),1);assert.equal(count(f,'cost_budget_reservations'),1);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,2);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),providerCallsIntercepted:2,actualNetworkRequests:0}));
});

test('Slides lost Start acknowledgement replays the same queued job without readmission or another purchase',async t=>{
  const calls=transport(t),f=await fixture(t);await f.execute();const run=await freshRun(f),dispatch=outputDocumentExecutionBridge.dispatch;let intercepted=0;
  outputDocumentExecutionBridge.dispatch=async input=>{if(!intercepted++){throw Error('Synthetic loss after durable Start commit');}return dispatch(input);};
  t.after(()=>{outputDocumentExecutionBridge.dispatch=dispatch;});
  await assert.rejects(run.queue(),/Synthetic loss after durable Start commit/);assert.equal(intercepted,1);assert.equal(calls.length,0);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'queued');const before=rows(f),resumed=await freshRun(f,{command:run.command});assert.equal(resumed.jobId,run.jobId);const replayed=await resumed.queue();
  assert.equal(replayed.replayed,true);assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
  const finished=await resumed.drive();assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);assertPayerSettlement(f);assertRuntimeCalls(f,calls);
  const settled=replayRows(f);await resumed.drive();assert.deepEqual(replayRows(f),settled);assert.equal(calls.length,1);
});

for(const failure of ['checkpoint','transport'])test(`Slides ${failure} uncertainty retains its original sponsor hold and cannot retry or auto-repair`,async t=>{
  const calls=transport(t,{...(failure==='transport'?{throwAtCall:1}:{})}),f=await fixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  let checkpointFailures=0;f.sqlite.function('fixture_checkpoint_failure',()=>{checkpointFailures++;return 1;});
  if(failure==='checkpoint')f.sqlite.exec("CREATE TRIGGER fail_slides_checkpoint BEFORE UPDATE OF result_json ON document_jobs WHEN NEW.status='running' AND json_extract(NEW.result_json,'$.presentationProviderSubmission')='pending' AND EXISTS(SELECT 1 FROM output_provider_calls) BEGIN SELECT fixture_checkpoint_failure();SELECT RAISE(ABORT,'synthetic_pending_checkpoint_failure'); END");
  const result=await run.drive();assert.notEqual(result.status,'completed');assert.equal(checkpointFailures,failure==='checkpoint'?1:0);assert.equal(calls.length,failure==='transport'?1:0);
  assert.equal(count(f,'output_provider_calls'),1);const call=f.sqlite.prepare('SELECT * FROM output_provider_calls').get();assert.equal(call.stage_key,'planning:0:initial');assert.equal(call.used_microusd,null);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
  const before=finances(f);
  const retry=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/retry`,{method:'POST'}),f.env,`${run.jobId}/retry`,context);assert.equal(retry.status,409);assert.equal((await retry.json()).error,'output_retry_requires_new_authorization');assert.deepEqual(finances(f),before);
  await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,failure==='transport'?1:0);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
});

for(const zero of [false,true])test(`Slides ${zero?'zero-row':'aborted'} admission job insertion rolls back native and sponsor state atomically`,async t=>{
  const calls=transport(t),f=await fixture(t);f.sqlite.exec(`CREATE TRIGGER fail_slides_admission BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(${zero?'IGNORE':"ABORT,'synthetic_job_insertion_failure'"}); END`);
  const before=all(f);await assert.rejects(f.execute());assert.deepEqual(all(f),before);assert.equal(calls.length,0);
  for(const table of ['experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);
});

test('Slides shared token ceiling stops optional repair while known initial usage settles below its monetary ceiling',async t=>{
  // Synthetic provider usage exceeds this tiny request estimate. Prior 120000
  // alone fits; even the minimum next cap (4096+6500) crosses shared 128000.
  const calls=transport(t,{repairAtCall:1,usageAtCall:()=>({input_tokens:119920,output_tokens:80,total_tokens:120000})}),f=await fixture(t),actorBefore=actorCounters(f);
  await f.execute();const run=await freshRun(f);await run.queue();const stopped=await run.drive();assert.equal(stopped.status,'failed',JSON.stringify(stopped));assert.equal(calls.length,1);
  const job=f.sqlite.prepare('SELECT error_message FROM document_jobs').get();assert.match(job.error_message,/token budget/); // The native pre-dispatch cumulative guard, not monetary exhaustion.
  const paid=f.sqlite.prepare('SELECT * FROM output_provider_calls').get();assert.ok(paid.used_microusd<paid.reserved_microusd,'This must isolate token exhaustion from the per-call money ceiling');
  assert.equal(f.sqlite.prepare('SELECT maximum_tokens FROM output_operation_slots').get().maximum_tokens,128000);
  assertPayerSettlement(f,120000,1);assertRuntimeCalls(f,calls);assert.deepEqual(actorCounters(f),actorBefore);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);
});

test('Slides completion acknowledgement loss recognizes its exact committed result and never republishes or repurchases',async t=>{
  const calls=transport(t),f=await fixture(t),actorBefore=actorCounters(f);await f.execute();const run=await freshRun(f);await run.queue();
  const originalBatch=f.env.DB.batch;let lostAcknowledgements=0;
  f.env.DB.batch=async statements=>{
    const before=f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n;
    const result=await originalBatch(statements);
    const after=f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n;
    if(!lostAcknowledgements&&before===0&&after===1){lostAcknowledgements++;throw Error('Synthetic loss after exact Slides completion commit');}
    return result;
  };
  t.after(()=>{f.env.DB.batch=originalBatch;});
  const completed=await run.drive();assert.equal(lostAcknowledgements,1);assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(calls.length,1);
  assertPayerSettlement(f);assertRuntimeCalls(f,calls);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,1);
  const before=replayRows(f);await run.drive();assert.deepEqual(replayRows(f),before);assert.equal(calls.length,1);
});
