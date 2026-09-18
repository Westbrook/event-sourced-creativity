import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,rows,actor,payer,init,freshRun,installImageTransport,handleDocumentJobs,runDocumentJob,createSponsorExecutionAuthority} from './sponsor-native-fixture.mjs';
const [{readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorTerminalReleaseStatement},{reconcileKnownOutputProviderReceipts,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,cleanupExpiredOrRevokedOutputWork},
  {settleDocumentGenerationBudgets},{handleEventPrivacy}]=await Promise.all([
  import('../worker/experience-sponsor-execution.ts'),import('../worker/output-execution-control.ts'),import('../worker/pilot-policy.ts'),import('../worker/privacy-api.ts'),
]);
async function admitted(t){const f=await fixture(t),s=await f.sponsor();await f.execute(s.authority);return {...f,s};}
function money(f){return {tokens:f.sqlite.prepare('SELECT * FROM budget_reservations').all(),cost:f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all(),
  tokenCounters:f.sqlite.prepare('SELECT * FROM budget_counters').all(),costCounters:f.sqlite.prepare('SELECT * FROM cost_budget_counters').all()};}
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

for(const reason of ['campaign','actor consent','payer consent','issued expiry'])test(`${reason} revoked after seal blocks internal queue and paid calls`,async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);
  if(reason==='campaign')f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');
  if(reason.endsWith('consent'))f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(reason.startsWith('actor')?actor:payer);
  if(reason==='issued expiry')f.sqlite.exec('UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1');
  const before=rows(f);await assert.rejects(run.queue(),/sponsor_execution_authority_revoked/);assert.deepEqual(rows(f),before);assert.equal(transport.calls.length,0);
});

test('forged execution capability and switched persisted financial payer cannot move a native job',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f),before=rows(f);
  const {outputExperienceCommands,outputDocumentExecutionBridge,context}=await import('./sponsor-native-fixture.mjs');
  for(const seal of [{},structuredClone(run.authority),{...run.authority}])await assert.rejects(outputExperienceCommands.executeSponsoredRun(run.trusted,run.command,seal,outputDocumentExecutionBridge,context),/sponsor_execution_not_enabled/);
  assert.deepEqual(rows(f),before);
  f.sqlite.prepare('UPDATE output_execution_grants SET payer_user_id=?').run(actor);
  await assert.rejects(run.queue(),/sponsor_execution_authority_revoked/);await assert.rejects(createSponsorExecutionAuthority(run.trusted,run.command),/sponsor_financial_binding_unavailable/);
  assert.equal(count(f,'output_provider_calls'),0);assert.equal(transport.calls.length,0);
});

for(const change of ['campaign','actor consent'])test(`known planning cost survives ${change} revocation and no image stage is purchased`,async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);await run.queue();const fetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,request)=>{const response=await fetch(url,request);if(String(url).endsWith('/responses')){
    if(change==='campaign')f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');else f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  }return response;});
  const job=await run.drive();assert.equal(job.status,'failed');assert.equal(transport.counts().plannerCalls,1);assert.equal(transport.counts().imageCalls,0);
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();assert.equal(cost.owner_id,payer);assert.equal(cost.status,'settled');assert.ok(cost.used_microusd>0);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(actor).used_microusd,0);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
});

test('unknown image submission retains sponsor exposure and active occupancy without duplicate dispatch',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);await run.queue();const fetch=globalThis.fetch;let attempts=0;
  t.mock.method(globalThis,'fetch',async(url,request)=>{if(String(url).endsWith('/images/generations')){attempts++;throw Error('lost acknowledgment after possible provider acceptance');}return fetch(url,request);});
  const job=await run.drive();assert.equal(job.status,'failed');assert.equal(attempts,1);assert.equal(transport.counts().plannerCalls,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
  assert.equal(count(f,'experience_sponsor_active_jobs'),1);const before=money(f);await run.drive();assert.deepEqual(money(f),before);assert.equal(attempts,1);
  f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  const original=await readSponsorFinancialBinding(f.env,actor,run.jobId);await sponsorTerminalReleaseStatement(original,f.env,actor,run.jobId).run();assert.equal(count(f,'experience_sponsor_active_jobs'),1);
  const result=await reconcileKnownOutputProviderReceipts(f.env,run.trusted.principal,{jobId:run.jobId});assert.equal(result.status,'uncertain');assert.deepEqual(money(f),before);
});

test('unstarted cancellation settles original sponsor at zero and removes only active occupancy',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);
  const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/cancel`,{method:'POST'}),f.env,`${run.jobId}/cancel`);
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'canceled');
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();assert.equal(cost.owner_id,payer);assert.equal(cost.used_microusd,0);assert.equal(cost.status,'released');
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.equal(transport.calls.length,0);
});

test('expired never-started sponsor grant uses source-free exact financial proof and zero settlement',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);
  f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z';UPDATE experience_sponsor_campaigns SET enabled=0");
  await reconcileExpiredOutputAuthorizations(f.env,run.trusted.principal);
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();assert.equal(cost.owner_id,payer);assert.equal(cost.status,'released');assert.equal(cost.used_microusd,0);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.equal(transport.calls.length,0);
});

test('actual privacy erasure keeps actor-owned native binding readable for original monetary accounting',async t=>{
  installImageTransport(t);const f=await admitted(t),run=await freshRun(f);await run.queue();await run.drive();
  const response=await handleEventPrivacy(new Request('http://localhost/api/event-privacy',init({action:'erase-personal-authored-context',confirmation:'ERASE_MY_PERSONAL_AUTHORED_CONTEXT'})),f.env);
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_json='' AND redacted_at IS NOT NULL").get().n>0);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),binding=await loadOutputJobBinding(f.env,run.trusted.principal,job);assert.equal(binding.sponsored,true);
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}'");f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  const original=await readSponsorFinancialBinding(f.env,actor,job.job_id),financial=sponsorFinancialIdentity(original,f.env,actor,job.job_id);
  const before=money(f);const settled=await settleDocumentGenerationBudgets(f.env,financial.payerUserId,{reservationId:binding.slot.tokenReservationId,costReservationId:binding.slot.costReservationId,assertions:[financial.assertion]});assert.equal(settled.status,'uncertain','fully settled erasure intentionally removes the redundant receipt vector');assert.deepEqual(money(f),before);
});


test('issued deadline crossing after durable pending checkpoint prevents synchronous dispatch and retains uncertainty',async t=>{
  const transport=installImageTransport(t),f=await admitted(t);
  const issuedDeadline=Date.now()+60_000;f.sqlite.prepare('UPDATE experience_sponsor_grants SET expires_at_ms=?').run(issuedDeadline);
  const run=await freshRun(f);await run.queue();const batch=f.DB.batch.bind(f.DB);let crossed=false;
  f.DB.batch=async statements=>{const result=await batch(statements);
    if(!crossed&&statements.some(statement=>/UPDATE document_jobs/u.test(statement.sql)&&statement.bindings.some(value=>typeof value==='string'&&value.includes('"status":"pending"')))){
      crossed=true;t.mock.method(Date,'now',()=>issuedDeadline+1);
    }return result;};
  const job=await run.drive();assert.equal(crossed,true,'clock moves only after the retained pending checkpoint');assert.equal(job.status,'failed');assert.equal(transport.calls.length,0);
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,1);assert.ok(['pending','uncertain'].includes(calls[0].status));
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(count(f,'experience_sponsor_active_jobs'),1);
});

test('lost terminal occupancy cleanup retries public stop without refunding cumulative consumption',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f),prepare=f.DB.prepare.bind(f.DB);let failed=false;
  f.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('DELETE FROM experience_sponsor_active_jobs')){const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),perform=bound.run.bind(bound);bound.run=async()=>{if(!failed){failed=true;throw Error('lost process before occupancy cleanup');}return perform();};return bound;};}return statement;};
  const request=()=>new Request(`http://localhost/api/document-jobs/${run.jobId}/cancel`,{method:'POST'});
  try{await handleDocumentJobs(request(),f.env,`${run.jobId}/cancel`);}catch(error){assert.match(error.message,/lost process before occupancy cleanup/);}
  assert.equal(failed,true);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'canceled');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'released');assert.equal(count(f,'experience_sponsor_active_jobs'),1);
  const before=money(f),response=await handleDocumentJobs(request(),f.env,`${run.jobId}/cancel`);assert.equal(response.status,200);assert.deepEqual(money(f),before);assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(transport.calls.length,0);
});

test('bridge cleanup independently reconstructs sponsor financial authority and repeats exact terminal release',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f),job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  const binding=await loadOutputJobBinding(f.env,run.trusted.principal,job);f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z';UPDATE experience_sponsor_campaigns SET enabled=0");
  await cleanupExpiredOrRevokedOutputWork(f.env,binding.scope,[binding.slot]);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'released');assert.equal(count(f,'experience_sponsor_active_jobs'),0);
  const before=money(f);await cleanupExpiredOrRevokedOutputWork(f.env,binding.scope,[binding.slot]);assert.deepEqual(money(f),before);assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(transport.calls.length,0);
});


test('a valid execution seal cannot turn a forged billing principal into sponsor or creative authority',async t=>{
  const transport=installImageTransport(t),f=await admitted(t),run=await freshRun(f);await run.queue();const before=rows(f);
  for(const patch of [{billingUserId:payer},{fictional:true}])await assert.rejects(runDocumentJob(f.env,{...run.trusted.principal,...patch},run.jobId,undefined,run.authority),/sponsor_personal_principal_required/);
  assert.deepEqual(rows(f),before);assert.equal(transport.calls.length,0);
});
