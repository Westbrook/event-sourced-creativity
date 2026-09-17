import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,rows,actor,payer,stream,freshRun,installImageTransport,runDocumentJob,readWorkspaceEvents,handleDocumentJobs,
  outputExperienceCommands,outputDocumentExecutionBridge,context} from './sponsor-native-fixture.mjs';

function finances(f) {
  return Object.fromEntries(['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
    'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'].map(table=>
    [table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function actorCounters(f) {
  return Object.fromEntries(['budget_counters','cost_budget_counters'].map(table=>
    [table,f.sqlite.prepare(`SELECT * FROM ${table} WHERE scope='user' AND scope_id=? ORDER BY rowid`).all(actor)]));
}
async function admitted(t) {
  const transport=installImageTransport(t),f=await fixture(t),s=await f.sponsor();
  await f.execute(s.authority);assert.equal(transport.calls.length,0);
  return {f,s,transport};
}

test('actual synchronous sponsored Image retains actor custody, settles only payer and releases terminal occupancy',async t=>{
  const {f,transport}=await admitted(t),run=await freshRun(f),actorBefore=actorCounters(f);
  const queued=await run.queue();assert.equal(queued.replayed,false);assert.equal(transport.calls.length,0);
  const finished=await run.drive();
  assert.equal(finished.status,'completed',JSON.stringify(finished));
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  assert.deepEqual(transport.calls.map(call=>call.path),['/v1/responses','/v1/moderations','/v1/images/generations']);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.status,'completed');assert.equal(slot.status,'succeeded');
  assert.equal(finished.owner_id,actor);assert.equal(finished.stream_id,stream);assert.equal(finished.document_id,f.documentId);
  assert.deepEqual(actorCounters(f),actorBefore,'actor balances are not used as payer balances');
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY rowid').all();assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.status==='settled'),JSON.stringify(calls));
  for(const table of ['budget_reservations','cost_budget_reservations']){
    const reservations=f.sqlite.prepare(`SELECT * FROM ${table}`).all();assert.equal(reservations.length,1);const reservation=reservations[0];
    assert.equal(reservation.reservation_id,table==='budget_reservations'?slot.token_reservation_id:slot.cost_reservation_id);
    assert.equal(reservation.owner_id,payer);assert.equal(reservation.status,'settled');assert.equal(reservation.stream_id,stream);assert.equal(reservation.correlation_id,finished.correlation_id);
  }
  const token=f.sqlite.prepare("SELECT * FROM budget_counters WHERE scope='user' AND scope_id=?").get(payer);
  const cost=f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer);
  const tokenUsage=f.sqlite.prepare('SELECT used_tokens FROM budget_reservations').get().used_tokens;
  const costUsage=f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations').get().used_microusd;
  assert.equal(tokenUsage,400,'both 200-token synthetic generation responses settle exactly once');
  assert.equal(costUsage,calls.reduce((sum,call)=>sum+call.used_microusd,0));assert.ok(costUsage>0);
  assert.equal(token.reserved_tokens,0);assert.equal(token.used_tokens,tokenUsage);assert.equal(cost.reserved_microusd,0);assert.equal(cost.used_microusd,costUsage);
  const workspaceTokens=f.sqlite.prepare("SELECT * FROM budget_counters WHERE scope='workspace' AND scope_id='forma'").get();
  const workspaceCost=f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='workspace' AND scope_id='forma'").get();
  assert.equal(workspaceTokens.reserved_tokens,0);assert.equal(workspaceTokens.used_tokens,tokenUsage);assert.equal(workspaceCost.reserved_microusd,0);assert.equal(workspaceCost.used_microusd,costUsage);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').get().n,0);
  const writes=f.sqlite.prepare('SELECT * FROM output_native_storage_writes').all();assert.ok(writes.length>0);
  for(const write of writes){assert.ok(write.publication_event_id);assert.ok(f.media.has(write.storage_key));assert.equal(f.media.get(write.storage_key).metadata.ownerId,actor);}
  const events=await readWorkspaceEvents(f.env,stream);assert.ok(events.some(event=>event.type==='GenerationCompleted'));
  const stable=finances(f),networkBefore=transport.calls.length;
  assert.equal((await run.drive()).status,'completed');
  assert.deepEqual(finances(f),stable);assert.equal(transport.calls.length,networkBefore,'duplicate terminal runner cannot purchase another output');
});

test('public command and runner cannot execute a sponsored job after internal queue without the seal',async t=>{
  const {f,transport}=await admitted(t),run=await freshRun(f);await run.queue();const before=rows(f);
  const publicRun=await f.send({action:'run',grantId:run.grantId});assert.equal(publicRun.status,403,await publicRun.clone().text());
  const publicJobRun=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${run.jobId}/run`,{method:'POST'}),f.env,`${run.jobId}/run`,context);
  assert.equal(publicJobRun.status,403,await publicJobRun.clone().text());
  assert.equal(transport.calls.length,0);assert.deepEqual(rows(f),before,'public job run cannot claim, schedule or mutate sponsored work');
  await assert.rejects(runDocumentJob(f.env,run.trusted.principal,run.jobId),/sponsor_execution_not_enabled/);
  assert.equal(transport.calls.length,0);assert.deepEqual(rows(f),before);
  assert.equal((await run.drive()).status,'completed');
});

test('lost queued acknowledgment reconstructs a fresh request seal and reuses one job, one purchase and one provider execution',async t=>{
  const {f,transport}=await admitted(t),first=await freshRun(f),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>/UPDATE output_operation_slots SET status='queued'/u.test(statement.sql))){lost=true;throw Error('lost sponsored run acknowledgment');}
    return result;
  };
  try{await first.queue();}catch(error){assert.match(error.message,/lost sponsored run acknowledgment/);}
  assert.equal(lost,true);assert.equal(transport.calls.length,0);
  const before=rows(f),reconstructed=await freshRun(f,{command:first.command});
  await assert.rejects(outputExperienceCommands.executeSponsoredRun(reconstructed.trusted,reconstructed.command,first.authority,outputDocumentExecutionBridge,context),/sponsor_execution_not_enabled/);assert.deepEqual(rows(f),before);
  const replay=await reconstructed.queue();assert.equal(replay.replayed,true);assert.deepEqual(rows(f),before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,1);
  assert.equal((await reconstructed.drive()).status,'completed');
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  const stable=finances(f);await reconstructed.drive();assert.deepEqual(finances(f),stable);
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
});

test('two actors share one sponsor and campaign while each completion releases only its own occupancy and holds',async t=>{
  const {f,s,transport}=await admitted(t),secondActor='fixture-creative-two';
  const second=await fixture(t,{database:f,actorUserId:secondActor,documentId:'sponsor-native-image-two'});
  const secondSponsor=await second.sponsor({campaignId:s.policy.campaignId,existingPolicy:s.policy});await second.execute(secondSponsor.authority);
  const firstRun=await freshRun(f),secondRun=await freshRun(second);await firstRun.queue();await secondRun.queue();
  const isolated=finances(f);
  for(const [viewer,target] of [[firstRun,secondRun],[secondRun,firstRun]]){
    const headers=viewer===firstRun?f.actorHeaders:second.actorHeaders;
    const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${target.jobId}`,{headers}),f.env,target.jobId);
    assert.equal(response.status,404,'sharing a payer does not disclose another actor job');
    assert.equal(await runDocumentJob(f.env,viewer.trusted.principal,target.jobId,undefined,viewer.authority),null);
    const {readSponsorFinancialBinding}=await import('../worker/experience-sponsor-execution.ts');
    await assert.rejects(readSponsorFinancialBinding(f.env,viewer.trusted.principal.userId,target.jobId),/sponsor_financial_binding_unavailable/);
  }
  assert.deepEqual(finances(f),isolated,'cross-actor access cannot settle either hold');
  const holds=f.sqlite.prepare('SELECT * FROM cost_budget_reservations ORDER BY rowid').all();assert.equal(holds.length,2);assert.ok(holds.every(hold=>hold.owner_id===payer));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').get().n,2);
  const secondSlot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(secondRun.jobId);
  const untouched=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(secondSlot.cost_reservation_id);
  assert.equal((await firstRun.drive()).status,'completed');
  assert.deepEqual(f.sqlite.prepare('SELECT actor_user_id,job_id FROM experience_sponsor_active_jobs').all().map(row=>({...row})),[{actor_user_id:secondActor,job_id:secondRun.jobId}]);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(secondSlot.cost_reservation_id),untouched);
  assert.equal((await secondRun.drive()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,2);
  const usage=f.sqlite.prepare('SELECT SUM(used_microusd) AS n FROM cost_budget_reservations').get().n;
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,usage);
  for(const id of [actor,secondActor]){
    assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(id).used_microusd,0);
    assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(id).used_tokens,0);
  }
  const mediaOwners=new Set([...f.media.values()].map(item=>item.metadata.ownerId));assert.deepEqual(mediaOwners,new Set([actor,secondActor]));
  assert.deepEqual(transport.counts(),{plannerCalls:2,imageCalls:2,safetyCalls:2});
});

test('known provider usage above the held estimate is recorded to the sponsor once without charging the actor or buying another output',async t=>{
  const {f,transport}=await admitted(t),run=await freshRun(f),actorBefore=actorCounters(f),fetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    const response=await fetch(url,request);if(!String(url).endsWith('/images/generations'))return response;
    const body=await response.json();body.usage={input_tokens:1_000_000,output_tokens:1_000_000,total_tokens:2_000_000,input_tokens_details:{text_tokens:1_000_000,image_tokens:0}};
    return Response.json(body,{headers:response.headers});
  });
  await run.queue();await run.drive();
  const money=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get(),tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();
  assert.equal(money.owner_id,payer);assert.equal(money.status,'settled');assert.equal(money.allow_user_overage,0);assert.ok(money.used_microusd>money.reserved_microusd);
  assert.equal(tokens.owner_id,payer);assert.equal(tokens.used_tokens,2_000_200);
  assert.equal(money.used_microusd,f.sqlite.prepare('SELECT SUM(used_microusd) AS n FROM output_provider_calls').get().n);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,money.used_microusd);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id='forma'").get().used_microusd,money.used_microusd);
  assert.deepEqual(actorCounters(f),actorBefore);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').get().n,0);
  const stable=finances(f);await run.drive();assert.deepEqual(finances(f),stable);assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
});

test('a lost acknowledgment after actual settlement commit does not debit the sponsor twice or dispatch another provider call',async t=>{
  const {f,transport}=await admitted(t),run=await freshRun(f),actorBefore=actorCounters(f),batch=f.DB.batch.bind(f.DB);let lost=false;
  await run.queue();
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>statement.sql.includes('UPDATE cost_budget_reservations SET used_microusd='))){lost=true;throw Error('lost committed sponsor settlement acknowledgment');}
    return result;
  };
  await run.drive();assert.equal(lost,true);
  const money=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get(),tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();
  assert.equal(money.status,'settled');assert.equal(money.owner_id,payer);assert.equal(tokens.used_tokens,400);
  assert.equal(money.used_microusd,f.sqlite.prepare('SELECT SUM(used_microusd) AS n FROM output_provider_calls').get().n);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,money.used_microusd);
  assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').get().n,0);
  const stable=finances(f);await run.drive();assert.deepEqual(finances(f),stable);assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
});
