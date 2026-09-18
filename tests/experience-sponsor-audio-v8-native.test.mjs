import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,actor,payer,stream,context,headers,post,
  readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorFinancialEventProfile,outputDocumentExecutionBridge,handleDocumentJobs,
  handleEventPrivacy,revokeSponsorCampaign,runDocumentJob,reconcileKnownOutputProviderReceipts,requestHash} from './sponsor-audio-v8-native-fixture.mjs';

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in dormant Audio V8 qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const strict=process.env.FORMA_AUDIO_V8_NATIVE_DIAGNOSTIC!=='1';
const qualified=(t,options={})=>fixture(t,{strict,...options});
const paid=calls=>calls.filter(call=>call.method==='POST');
const completeCount=f=>f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n;
const noAdmission=f=>{for(const table of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations','experience_sponsor_consumptions'])assert.equal(count(f,table),0,table);};
const describeFailure=(f,result,calls)=>JSON.stringify({status:result.status,error:result.error_message,calls:paid(calls).map(call=>call.stage),trace:f.trace});
function verifyLedgerWire(f,calls){
  for(const call of paid(calls)){
    const row=f.sqlite.prepare('SELECT * FROM output_provider_calls WHERE stage_key=?').get(call.stage);assert.ok(row,call.stage);
    assert.equal(row.request_digest,requestHash(call.requestBody));if(call.clientRequestId)assert.equal(row.client_request_id,call.clientRequestId);
    assert.equal(row.provider,call.provider);assert.equal(row.model,call.body.model??'fal-ai/stable-audio-3/medium/text-to-audio');
  }
}
function reportLimits(t,f){if(f.limits){f.limits.assertVerified();t.diagnostic(JSON.stringify({sqlShapes:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),maxSqlBytes:Math.max(...f.limits.records.map(record=>Buffer.byteLength(record.sql))),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,exceptions:0}));}}

for(const repair of [false,true])test(`genuine Audio V8 ${repair?'initial→repair→media':'initial→media'} preserves creative actor and settles distinct payer exactly once`,async t=>{
  const calls=transport(t,{repair}),f=await qualified(t),before=actorCounters(f);assert.notEqual(actor,payer);
  const admitted=await f.execute();assert.equal(admitted.replayed,false);assert.equal(calls.length,0);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(job.job_id,f.review.preview.requestId);assert.equal(Date.parse(f.sqlite.prepare('SELECT expires_at FROM output_execution_grants').get().expires_at),f.envelope.originalExpiresAtMs);assert.ok(Date.parse(job.expires_at)>f.envelope.originalExpiresAtMs,'Job storage retention is distinct from original quote authority');
  assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(count(f,'experience_sponsor_consumptions'),1);
  const run=await freshRun(f);await run.queue();assert.equal(calls.length,0);const result=await run.drive();
  assert.equal(result.status,'completed',describeFailure(f,result,calls));assert.equal(paid(calls).length,repair?3:2);
  assert.deepEqual(paid(calls).map(call=>call.stage),repair?['planning:0:initial','planning:0:repair','audio:initial']:['planning:0:initial','audio:initial']);
  assert.equal(result.owner_id,actor);assert.equal(result.document_id,f.documentId);assert.equal(result.stream_id,stream);assert.deepEqual(actorCounters(f),before);
  verifyLedgerWire(f,calls);assertPayerSettlement(f,repair?2:1);assert.equal(completeCount(f),1);assert.equal(f.media.size,1);
  assert.deepEqual(f.trace.databaseErrors,[]);assert.deepEqual(f.trace.failedPredicates,[]);
  const money=finances(f),network=calls.length;await run.drive();assert.deepEqual(finances(f),money);assert.equal(calls.length,network);assert.equal(completeCount(f),1);
  const financial=await readSponsorFinancialBinding(f.env,actor,run.jobId);assert.equal(sponsorFinancialIdentity(financial,f.env,actor,run.jobId).payerUserId,payer);
  const slot=f.sqlite.prepare('SELECT scope_key,grant_id,slot_id FROM output_operation_slots').get();
  assert.equal(sponsorFinancialEventProfile(financial,f.env,actor,{scopeKey:slot.scope_key,grantId:slot.grant_id,slotId:slot.slot_id}),'audio');reportLimits(t,f);
  t.diagnostic('Synthetic native composition only; immutable issuance/resources explicitly seeded. App usage/rate accounting is not a provider invoice. Public activation and finite sponsored reads excluded.');
});

test('Audio V8 authority cannot be copied or supplied to the ordinary public job runner',async t=>{
  const calls=transport(t),f=await qualified(t),before=rows(f);
  for(const seal of [{},structuredClone(f.authority),{...f.authority}])await assert.rejects(f.execute(seal),/sponsor_authority_unavailable/);
  assert.deepEqual(rows(f),before);noAdmission(f);await f.execute();const run=await freshRun(f);await run.queue();const queued=rows(f);
  const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/run`,{method:'POST'}),f.env,`${run.jobId}/run`,context);assert.equal(response.status,403);
  await assert.rejects(runDocumentJob(f.env,run.trusted.principal,run.jobId),/sponsor_execution_not_enabled/);assert.deepEqual(rows(f),queued);assert.equal(calls.length,0);reportLimits(t,f);
});

test('actual supplied Audio actor consent and separately verified sponsor review reject missing or changed intent before admission',async t=>{
  for(const fault of ['authorization','cost','transfer','review','payer','request']){
    const calls=transport(t),f=await qualified(t,{sponsor:false});
    const options={bodyMutation:body=>{if(fault==='authorization')delete body.explicitAuthorization;if(fault==='cost')body.audioCostConsent.confirmed=false;if(fault==='transfer')body.audioCostConsent.providerTransferConfirmed=false;if(fault==='review')body.sponsorReview.reviewDigest='sha256:'+'a'.repeat(64);if(fault==='request')body.audioCostConsent.requestId='audio-'+'0'.repeat(64);},
      reviewMutation:review=>{if(fault==='payer')review.payerUserId=actor;}};
    await assert.rejects(f.sponsor(options),undefined,fault);noAdmission(f);assert.equal(calls.length,0);reportLimits(t,f);
  }
});

test('Audio V8 admission and lost Run acknowledgement replay the same original job and purchase',async t=>{
  const calls=transport(t),f=await qualified(t);const accepted=await f.execute();assert.equal(accepted.replayed,false);
  const admitted=rows(f),replay=await f.replayAdmission();assert.equal(replay.kind,'retained');assert.deepEqual(rows(f),admitted);
  const run=await freshRun(f),dispatch=outputDocumentExecutionBridge.dispatch;let intercepted=0;
  outputDocumentExecutionBridge.dispatch=async input=>{if(!intercepted++)throw Error('Synthetic loss after durable Audio Run commit');return dispatch(input);};
  t.after(()=>{outputDocumentExecutionBridge.dispatch=dispatch;});
  await assert.rejects(run.queue(),/Synthetic loss after durable Audio Run commit/);assert.equal(calls.length,0);
  const before=rows(f),resumed=await freshRun(f,{command:run.command});assert.equal(resumed.jobId,run.jobId);
  assert.equal((await resumed.queue()).replayed,true);assert.deepEqual(rows(f),before);
  const result=await resumed.drive();assert.equal(result.status,'completed',describeFailure(f,result,calls));assertPayerSettlement(f);assert.equal(paid(calls).length,2);
  const money=finances(f),total=calls.length;await resumed.drive();assert.deepEqual(finances(f),money);assert.equal(calls.length,total);reportLimits(t,f);
});

for(const phase of ['admission','run'])test(`Audio cancellation at final ${phase} replay read prevents atomic publication`,async t=>{
  const calls=transport(t),f=await qualified(t);let operation=f.execute,controller=f.controller;
  if(phase==='run'){await f.execute();const run=await freshRun(f);operation=run.queue;controller=run.controller;}
  const original=f.env.DB.prepare;let intercepted=0;
  f.env.DB.prepare=function(sql){const statement=original.call(this,sql),stack=new Error().stack;
    if(sql.startsWith('SELECT command.action,command.event_id')&&stack.includes('commitOutputCommand')){
      const wrap=selected=>{const first=selected.first,bind=selected.bind;selected.first=async function(...args){const result=await first.apply(this,args);intercepted++;controller.abort();return result;};selected.bind=function(...args){return wrap(bind.apply(this,args));};return selected;};wrap(statement);
    }return statement;
  };
  t.after(()=>{f.env.DB.prepare=original;});const before=rows(f);
  await assert.rejects(operation());assert.equal(intercepted,1);assert.deepEqual(rows(f),before);assert.equal(count(f,'output_atomic_assertions'),0);assert.equal(calls.length,0);reportLimits(t,f);
});

for(const reason of ['campaign revocation','private-body erasure'])test(`known original Audio planner usage settles its payer after ${reason} without media dispatch`,async t=>{
  const f=await qualified(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  const calls=transport(t,{afterDispatch:async call=>{
    if(call.stage!=='planning:0:initial')return;
    if(reason==='campaign revocation')await revokeSponsorCampaign(new Request('http://localhost/__fixture/audio-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
    else{const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',post({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);assert.equal(response.status,200,await response.clone().text());}
  }});
  const result=await run.drive();assert.equal(result.status,'failed',describeFailure(f,result,calls));assert.equal(paid(calls).length,1);assert.equal(completeCount(f),0);assert.equal(f.media.size,0);assert.deepEqual(actorCounters(f),actorBefore);
  const call=f.sqlite.prepare('SELECT * FROM output_provider_calls').get();assert.equal(call.stage_key,'planning:0:initial');assert.equal(call.status,'settled');assert.ok(call.used_microusd>0);
  assert.equal(f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations').get().used_microusd,call.used_microusd);
  const prepare=f.env.DB.prepare;const financialSql=[];f.env.DB.prepare=function(sql){financialSql.push(sql);return prepare.call(this,sql);};
  const money=finances(f);try{const seal=await readSponsorFinancialBinding(f.env,actor,run.jobId);assert.equal(sponsorFinancialIdentity(seal,f.env,actor,run.jobId).payerUserId,payer);await reconcileKnownOutputProviderReceipts(f.env,run.trusted.principal,{jobId:run.jobId});}finally{f.env.DB.prepare=prepare;}
  assert.deepEqual(finances(f),money);assert.ok(financialSql.length>0);assert.ok(financialSql.every(sql=>!/(?:event_private_payloads|private_content|SELECT\s+\*\s+FROM\s+document_jobs|request_json)/iu.test(sql)),financialSql.join('\n'));
  reportLimits(t,f);
});

for(const failure of ['planner transport','planner missing usage','media transport'])test(`Audio ${failure} uncertainty preserves the original hold without replacement purchase`,async t=>{
  const calls=transport(t,{throwOnDispatch:failure==='planner transport'?'planner':failure==='media transport'?'media':false,missingUsage:failure==='planner missing usage'}),f=await qualified(t);await f.execute();
  const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();const result=await run.drive();assert.notEqual(result.status,'completed');assert.equal(paid(calls).length,failure==='media transport'?2:1);
  const uncertain=f.sqlite.prepare('SELECT * FROM output_provider_calls WHERE used_microusd IS NULL').all();assert.equal(uncertain.length,1);assert.equal(uncertain[0].stage_key,failure==='media transport'?'audio:initial':'planning:0:initial');
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
  const before=finances(f),network=calls.length,retry=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/retry`,{method:'POST'}),f.env,`${run.jobId}/retry`,context);
  assert.equal(retry.status,409);assert.equal((await retry.json()).error,'output_retry_requires_new_authorization');assert.deepEqual(finances(f),before);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,network);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(completeCount(f),0);reportLimits(t,f);
});

for(const failure of ['timeout','redirect','mime','overflow','storage'])test(`verified original fal completion retains payer cost before ${failure} materialization failure`,async t=>{
  const calls=transport(t,{mediaFailure:failure}),f=await qualified(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  if(failure==='storage')f.env.MEDIA.put=async()=>{throw Error('Synthetic private generated-media write failure');};
  const result=await run.drive();assert.equal(result.status,'failed',describeFailure(f,result,calls));assert.equal(paid(calls).length,2);
  assertPayerSettlement(f);assert.deepEqual(actorCounters(f),actorBefore);assert.equal(completeCount(f),0);assert.equal(f.media.size,0);
  const call=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").get();assert.equal(call.used_microusd,37600);assert.equal(call.provider_response_id,'synthetic-sponsored-audio-original');
  const money=finances(f),network=calls.length;await run.drive();assert.deepEqual(finances(f),money);assert.equal(calls.length,network);reportLimits(t,f);
});

test('captured Audio admission refuses changed Request, DB, provider configuration, principal, source and command',async t=>{
  for(const fault of ['request','database','openai','fal','principal','source','command']){
    const calls=transport(t),f=await qualified(t),before=rows(f);
    if(fault==='request')f.trusted.request=new Request(f.request.url,post(f.body));
    if(fault==='database')f.env.DB={...f.env.DB};if(fault==='openai')f.env.OPENAI_API_KEY='changed-synthetic-presence';if(fault==='fal')f.env.FAL_KEY='changed-synthetic-presence';
    if(fault==='principal')f.trusted.principal={...f.trusted.principal,consentVersion:null};if(fault==='source')f.trusted.context.snapshot.facts[0].properties.text+=' changed';
    if(fault==='command')f.command.maximumMicrousd++;
    await assert.rejects(f.execute(),undefined,fault);assert.deepEqual(rows(f),before);noAdmission(f);assert.equal(calls.length,0);reportLimits(t,f);
  }
});

test('native Audio handles reject cross-Document and copied preparation objects before financial admission',async t=>{
  const calls=transport(t),a=await qualified(t),b=await qualified(t,{direction:'A separate original low instrumental pulse.'});
  const {createSponsorAdmissionAuthority,createSponsorExecutionAuthority,outputExperienceCommands}=await import('./sponsor-audio-v8-native-fixture.mjs');
  const beforeA=rows(a),beforeB=rows(b);
  for(const audioPreparation of [{...a.audioPreparation},structuredClone(a.audioPreparation),b.audioPreparation])await assert.rejects(createSponsorAdmissionAuthority({trusted:a.trusted,command:a.command,policy:a.policy,envelope:a.envelope,grantId:a.grantId,audioPreparation}));
  assert.deepEqual(rows(a),beforeA);assert.deepEqual(rows(b),beforeB);await a.execute();await b.execute();
  const runA=await freshRun(a),runB=await freshRun(b);
  for(const audioPreparation of [{...runA.audioPreparation},structuredClone(runA.audioPreparation),runB.audioPreparation])await assert.rejects(createSponsorExecutionAuthority(runA.trusted,runA.command,{audioPreparation}));
  const changed={...runA.command,grantId:runB.command.grantId};await assert.rejects(outputExperienceCommands.prepareSponsoredAudioRun(runA.trusted,changed));
  assert.equal(calls.length,0);reportLimits(t,a);reportLimits(t,b);
});

test('actual original Audio native recovery polls only its accepted fal request and replays without another charge',async t=>{
  const first=transport(t,{mediaFailure:'timeout'}),f=await qualified(t);await f.execute();const run=await freshRun(f);await run.queue();
  const failed=await run.drive();assert.equal(failed.status,'failed',describeFailure(f,failed,first));assertPayerSettlement(f);assert.equal(paid(first).length,2);
  const {recoverOutputAudio}=await import('../worker/output-audio-recovery.ts');
  const originalMoney=finances(f),calls=transport(t),job=f.sqlite.prepare('SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs').get();
  const recovered=await recoverOutputAudio(f.env,run.trusted.principal,job,{assertions:run.trusted.sourceAssertions});
  assert.equal(recovered.status,'completed');assert.deepEqual(calls.map(call=>call.method),['GET','GET','GET']);assert.equal(completeCount(f),1);assert.equal(f.media.size,1);
  assert.deepEqual(finances(f),originalMoney);const completed=f.sqlite.prepare('SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs').get();
  const replay=await recoverOutputAudio(f.env,run.trusted.principal,completed,{assertions:run.trusted.sourceAssertions});assert.equal(replay.replayed,true);assert.equal(calls.length,3);assert.deepEqual(finances(f),originalMoney);assert.equal(completeCount(f),1);reportLimits(t,f);
});

test('known Audio receipts settle once through the actual source-free reconciler after a lost settlement transaction and source erasure',async t=>{
  const calls=transport(t,{mediaFailure:'timeout'}),f=await qualified(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  const originalBatch=f.env.DB.batch;let refused=0;
  f.env.DB.batch=async statements=>{if(statements.some(statement=>statement.sql.includes('UPDATE cost_budget_reservations SET used_microusd='))){refused++;throw Error('Synthetic original settlement transaction not acknowledged');}return originalBatch.call(f.env.DB,statements);};
  let result;try{result=await run.drive();}finally{f.env.DB.batch=originalBatch;}
  assert.equal(result.status,'failed',describeFailure(f,result,calls));assert.ok(refused>0);assert.equal(paid(calls).length,2);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');
  const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',post({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);assert.equal(response.status,200,await response.clone().text());
  const before=count(f,'experience_sponsor_consumptions'),originalPrepare=f.env.DB.prepare,seen=[];
  f.env.DB.prepare=function(sql){seen.push(sql);assert.ok(!/(?:event_private_payloads|private_content|SELECT\s+\*\s+FROM\s+document_jobs|request_json)/iu.test(sql),'Financial reconciliation attempted a private-body read');return originalPrepare.call(this,sql);};
  let reconciliation;try{reconciliation=await reconcileKnownOutputProviderReceipts(f.env,run.trusted.principal,{jobId:run.jobId});}finally{f.env.DB.prepare=originalPrepare;}
  assert.equal(reconciliation.status,'known');assert.equal(reconciliation.reconciled,1);assert.ok(seen.some(sql=>sql.includes('UPDATE cost_budget_reservations SET used_microusd=')));assertPayerSettlement(f);
  assert.deepEqual(actorCounters(f),actorBefore);assert.equal(count(f,'experience_sponsor_consumptions'),before);assert.equal(completeCount(f),0);assert.equal(f.media.size,0);
  const money=finances(f),network=calls.length;await reconcileKnownOutputProviderReceipts(f.env,run.trusted.principal,{jobId:run.jobId});assert.deepEqual(finances(f),money);assert.equal(calls.length,network);reportLimits(t,f);
});

test('fresh authenticated Audio admission replay reads the immutable original receipt without renewing consent or purchasing',async t=>{
  const calls=transport(t),f=await qualified(t);await f.execute();const before=rows(f);
  const {loadOutputTrustedContext,outputExperienceCommands}=await import('../worker/output-requirements-api.ts');
  const request=new Request(f.request.url,post(f.body)),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const receipt=await outputExperienceCommands.readSponsoredAudioAdmissionReplay(trusted,f.command);assert.ok(receipt);assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
  await assert.rejects(outputExperienceCommands.prepareSponsoredAudioAdmission(trusted,f.command,f.review),/sponsor_audio_original_admission_replay_required/);
  const changed=new Request(f.request.url,post({...f.body,maximumMicrousd:f.body.maximumMicrousd+1})),other=await loadOutputTrustedContext(changed,f.env,f.documentId,'request');assert.ok(!(other instanceof Response));
  await assert.rejects(outputExperienceCommands.readSponsoredAudioAdmissionReplay(other,f.command));assert.deepEqual(rows(f),before);assert.equal(calls.length,0);reportLimits(t,f);
});
