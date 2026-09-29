import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,actor,payer,context,headers,post,
  readSponsorFinancialBinding,sponsorFinancialIdentity,outputDocumentExecutionBridge,handleDocumentJobs,
  handleEventPrivacy,revokeSponsorCampaign,runDocumentJob} from './sponsor-scene-native-fixture.mjs';

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in dormant Scene qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const strict=process.env.FORMA_SCENE_NATIVE_DIAGNOSTIC!=='1';
const qualifiedFixture=(t,options={})=>fixture(t,{strict,...options});

test('unsealed Scene commands and public runner cannot use the dormant sponsor capability',async t=>{
  const calls=transport(t),f=await qualifiedFixture(t),before=rows(f);
  for(const seal of [{},structuredClone(f.authority),{...f.authority}])await assert.rejects(f.execute(seal),/sponsor_authority_unavailable/);
  const wire=await f.send({...f.command,sponsor_entitlement:{payer_user_id:payer}});assert.equal(wire.status,403);assert.deepEqual(rows(f),before);
  await f.execute();const run=await freshRun(f);await run.queue();const queued=rows(f);
  assert.equal((await f.send({action:'run',grantId:run.command.grantId})).status,403);
  const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/run`,{method:'POST'}),f.env,`${run.jobId}/run`,context);assert.equal(response.status,403);
  await assert.rejects(runDocumentJob(f.env,run.trusted.principal,run.jobId),/sponsor_execution_not_enabled/);
  assert.deepEqual(rows(f),queued);assert.equal(calls.length,0);f.limits?.assertVerified();
});

test('Scene original admission and lost Run acknowledgement reuse the same native job and purchase',async t=>{
  const calls=transport(t),f=await qualifiedFixture(t);const accepted=await f.execute();assert.equal(accepted.replayed,false);
  const admitted=rows(f),replayed=await f.execute();assert.equal(replayed.replayed,true);assert.deepEqual(rows(f),admitted);
  const run=await freshRun(f),dispatch=outputDocumentExecutionBridge.dispatch;let intercepted=0;
  outputDocumentExecutionBridge.dispatch=async input=>{if(!intercepted++){throw Error('Synthetic loss after durable Scene Run commit');}return dispatch(input);};
  t.after(()=>{outputDocumentExecutionBridge.dispatch=dispatch;});
  await assert.rejects(run.queue(),/Synthetic loss after durable Scene Run commit/);assert.equal(intercepted,1);assert.equal(calls.length,0);
  const before=rows(f),resumed=await freshRun(f,{command:run.command});assert.equal(resumed.jobId,run.jobId);
  const replay=await resumed.queue();assert.equal(replay.replayed,true);assert.deepEqual(rows(f),before);assert.equal(calls.length,0);
  const result=await resumed.drive();assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(calls.length,1);assertPayerSettlement(f);
  const money=finances(f);await resumed.drive();assert.deepEqual(finances(f),money);assert.equal(calls.length,1);f.limits?.assertVerified();
});

for(const phase of ['admission','run'])test(`Scene cancellation after the final ${phase} replay read prevents the atomic write`,async t=>{
  const calls=transport(t),f=await qualifiedFixture(t);let operation=f.execute,controller=f.controller;
  if(phase==='run'){await f.execute();const run=await freshRun(f);operation=run.queue;controller=run.controller;}
  const original=f.env.DB.prepare;let intercepted=0;
  f.env.DB.prepare=function(sql){
    const statement=original.call(this,sql),stack=new Error().stack;
    if(sql.startsWith('SELECT command.action,command.event_id')&&stack.includes('commitOutputCommand')){
      const wrap=selected=>{
        const first=selected.first,bind=selected.bind;
        selected.first=async function(...args){const result=await first.apply(this,args);intercepted++;controller.abort();return result;};
        selected.bind=function(...args){return wrap(bind.apply(this,args));};return selected;
      };wrap(statement);
    }
    return statement;
  };
  t.after(()=>{f.env.DB.prepare=original;});
  const before=rows(f),sourceBefore=f.sqlite.prepare('SELECT * FROM scene_source_generations ORDER BY rowid').all(),changes=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  await assert.rejects(operation(),/sponsor_(?:scene|execution|authority)/);assert.equal(intercepted,1);
  assert.deepEqual(rows(f),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM scene_source_generations ORDER BY rowid').all(),sourceBefore);
  // The unchanged Run readiness helper performs two INSERT/DELETE assertion
  // pairs before commit's final replay read. They leave no row or authority.
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n-changes,phase==='run'?4:0);
  assert.equal(count(f,'output_atomic_assertions'),0);assert.equal(calls.length,0);f.limits?.assertVerified();
});

for(const reason of ['campaign revocation','private-body erasure'])test(`Scene known usage settles its original payer after ${reason} without publishing returned content`,async t=>{
  const f=await qualifiedFixture(t);await f.execute();const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();
  const calls=transport(t,{afterDispatch:async()=>{
    if(reason==='campaign revocation')await revokeSponsorCampaign(new Request('http://localhost/__fixture/scene-revoke',post({action:'revoke-sponsor-campaign',campaignId:f.policy.campaignId,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},headers(payer))),f.env);
    if(reason==='private-body erasure'){
      const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',post({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);
      assert.equal(response.status,200,await response.clone().text());assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_json='' AND redacted_at IS NOT NULL").get().n>0);
    }
  }});
  const result=await run.drive();assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(calls.length,1);assertPayerSettlement(f);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  const original=await readSponsorFinancialBinding(f.env,actor,run.jobId);assert.equal(sponsorFinancialIdentity(original,f.env,actor,run.jobId).payerUserId,payer);
  const before=finances(f);await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);f.limits?.assertVerified();
});

for(const failure of ['transport','missing usage'])test(`Scene ${failure} uncertainty keeps its original hold without another purchase or provider attempt`,async t=>{
  const calls=transport(t,{throwOnDispatch:failure==='transport',missingUsage:failure==='missing usage'}),f=await qualifiedFixture(t);await f.execute();
  const run=await freshRun(f),actorBefore=actorCounters(f);await run.queue();const result=await run.drive();assert.notEqual(result.status,'completed');assert.equal(calls.length,1);
  assert.equal(count(f,'output_provider_calls'),1);const call=f.sqlite.prepare('SELECT * FROM output_provider_calls').get();assert.equal(call.stage_key,'planning:0:initial');assert.equal(call.used_microusd,null);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
  const before=finances(f),retry=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/retry`,{method:'POST'}),f.env,`${run.jobId}/retry`,context);
  assert.equal(retry.status,409);assert.equal((await retry.json()).error,'output_retry_requires_new_authorization');assert.deepEqual(finances(f),before);
  await run.drive();assert.deepEqual(finances(f),before);assert.equal(calls.length,1);assert.deepEqual(actorCounters(f),actorBefore);f.limits?.assertVerified();
});

for(const malformed of ['sparse batch','accessor truth'])test(`Scene actual final paid proof rejects ${malformed} before the provider boundary`,async t=>{
  const calls=transport(t),f=await qualifiedFixture(t);await f.execute();const run=await freshRun(f);await run.queue();
  const original=f.env.DB.batch;let intercepted=0,getterReads=0;
  f.env.DB.batch=async statements=>{
    const results=await original.call(f.env.DB,statements);
    if(statements.some(statement=>statement.sql.includes("JOIN document_jobs job ON job.job_id=json_extract(pin.value,'$.jobId')"))){
      intercepted++;
      if(malformed==='sparse batch')delete results[results.length-1];
      else Object.defineProperty(results.at(-1).results[0],'current',{get(){getterReads++;return 1;},configurable:true});
    }
    return results;
  };
  t.after(()=>{f.env.DB.batch=original;});
  const result=await run.drive();assert.notEqual(result.status,'completed');assert.equal(intercepted,1);assert.equal(getterReads,0);
  assert.equal(calls.length,0);assert.equal(count(f,'output_provider_calls'),0);assert.equal(count(f,'experience_sponsor_consumptions'),1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);f.limits?.assertVerified();
});
