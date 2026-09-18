import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,installImageTransport} from './sponsor-driver-fixture.mjs';
const {driveSponsoredImage}=await import('../worker/experience-sponsor-driver.ts');
const {appendAuditEvent}=await import('../worker/runtime.ts');
const tables=['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_resource_receipts',
  'experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_preflights',
  'output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const state=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

function assertSettled(f,transport){
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),3);
  assert.equal(count(f,'output_preflights'),1);assert.equal(count(f,'experience_sponsor_grants'),1);
  assert.equal(count(f,'output_execution_grants'),1);assert.equal(count(f,'document_jobs'),1);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
  const operations=f.sqlite.prepare('SELECT operation,text_bytes FROM experience_sponsor_resource_receipts ORDER BY rowid').all();
  assert.deepEqual(operations.map(row=>row.operation),['text-intake','preflight','issuance']);
  assert.ok(operations.every(row=>row.text_bytes>0));assert.equal(operations[0].text_bytes,operations[1].text_bytes);
  for(const table of ['budget_reservations','cost_budget_reservations']){const rows=f.sqlite.prepare(`SELECT * FROM ${table}`).all();assert.equal(rows.length,1);assert.equal(rows[0].owner_id,f.payer);assert.equal(rows[0].status,'settled');}
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get(),money=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  assert.equal(tokens.used_tokens,400);assert.equal(money.used_microusd,f.sqlite.prepare('SELECT SUM(used_microusd) AS n FROM output_provider_calls').get().n);
  for(const [scope,user] of [['user',f.payer],['workspace','forma']]){
    const token=f.sqlite.prepare('SELECT * FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,user),cost=f.sqlite.prepare('SELECT * FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,user);
    assert.equal(token.used_tokens,400);assert.equal(token.reserved_tokens,0);assert.equal(cost.used_microusd,money.used_microusd);assert.equal(cost.reserved_microusd,0);
  }
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(f.actor).used_tokens,0);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(f.actor).used_microusd,0);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(job.owner_id,f.actor);assert.equal(job.document_id,f.documentId);assert.equal(job.status,'completed');
  assert.ok(f.media.size>0);assert.ok([...f.media.values()].every(item=>item.metadata.ownerId===f.actor));
}

test('continuous confirmed Document driver gates resources, issues approved grant and settles actual native Image to sponsor',async t=>{
  const transport=installImageTransport(t),f=await fixture(t);
  const result=await driveSponsoredImage(f.request(),f.env,f.context);assert.equal(result.status,'completed');assert.equal(result.replayed,false);
  assertSettled(f,transport);
  const before=state(f),again=await driveSponsoredImage(f.request(),f.env,f.context);
  assert.deepEqual(again,{...result,replayed:true});assert.deepEqual(state(f),before);assertSettled(f,transport);
});

test('committed preflight ticket without native receipt cannot repeat protected work on a fresh request',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='preflight')){lost=true;throw Error('lost preflight ticket acknowledgment');}return result;};
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/sponsor_driver_stage_unknown/);
  assert.equal(lost,true);assert.equal(count(f,'output_preflights'),0);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);
  const before=state(f);await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/sponsor_driver_stage_unknown/);
  assert.deepEqual(state(f),before);assert.equal(transport.calls.length,0);assert.equal(count(f,'experience_sponsor_grants'),0);
});

for(const stage of ['preflight','authorization','run'])test(`lost committed native ${stage} acknowledgment reuses the original and purchases one output`,async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  const matches=sql=>stage==='preflight'?sql.includes('INSERT INTO output_preflights'):stage==='authorization'?sql.includes('INSERT INTO output_execution_grants'):sql.includes("UPDATE output_operation_slots SET status='queued'");
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>matches(statement.sql))){lost=true;throw Error(`lost native ${stage} acknowledgment`);}return result;};
  try{await driveSponsoredImage(f.request(),f.env,f.context);}catch(error){assert.match(error.message,new RegExp(`lost native ${stage} acknowledgment`));}
  assert.equal(lost,true);
  const result=await driveSponsoredImage(f.request(),f.env,f.context);assert.equal(result.status,'completed');assertSettled(f,transport);
  const before=state(f);await driveSponsoredImage(f.request(),f.env,f.context);assert.deepEqual(state(f),before);assertSettled(f,transport);
});

test('same user intent cannot change its Document source or target to make another purchase',async t=>{
  const transport=installImageTransport(t),f=await fixture(t);await driveSponsoredImage(f.request(),f.env,f.context);const before=state(f);
  await assert.rejects(driveSponsoredImage(f.request({targetId:'different-target'}),f.env,f.context),/sponsor_driver_(?:intent_changed|target_unsupported)/);
  assert.deepEqual(state(f),before);
  await appendAuditEvent(f.env,`creative:${f.actor}`,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A different orchard in winter'});
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/sponsor_driver_(?:source_changed|intent_changed)/);
  assert.deepEqual(state(f),before);assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
});

test('closed actor POST rejects payer, price, prompt and non-POST overrides before resource or native writes',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),before=state(f);
  for(const extra of [{payerUserId:f.payer},{maximumMicrousd:1},{prompt:'bypass context blocks'},{nowMs:Date.now()+86_400_000}])await assert.rejects(driveSponsoredImage(f.request(extra),f.env,f.context),/sponsor_driver_command_invalid/);
  await assert.rejects(driveSponsoredImage(new Request(f.request().url,{headers:f.actorHeaders}),f.env,f.context),/sponsor_driver_post_required/);
  assert.deepEqual(state(f),before);assert.equal(transport.calls.length,0);
});

test('revocation after terminal settlement withholds final driver metadata without undoing known costs',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let revoked=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!revoked&&f.sqlite.prepare("SELECT 1 FROM document_jobs WHERE status='completed'").get()){
      revoked=true;f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
    }
    return result;
  };
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/sponsor_(?:approved_campaign_unavailable|authority|driver)/);
  assert.equal(revoked,true);assertSettled(f,transport);
});

test('two returning requests after a durable preflight converge on one original grant, job and provider purchase',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{
    if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='authorize'))throw Error('pause after durable preflight');
    return batch(statements);
  };
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/pause after durable preflight/);
  assert.equal(count(f,'output_preflights'),1);assert.equal(count(f,'experience_sponsor_grants'),0);assert.equal(transport.calls.length,0);
  f.DB.batch=batch;
  const results=await Promise.allSettled([driveSponsoredImage(f.request(),f.env,f.context),driveSponsoredImage(f.request(),f.env,f.context)]);
  assert.ok(results.some(result=>result.status==='fulfilled'),JSON.stringify(results.map(result=>result.status==='rejected'?String(result.reason):result.value)));
  assertSettled(f,transport);
  const before=state(f);assert.equal((await driveSponsoredImage(f.request(),f.env,f.context)).status,'completed');assert.deepEqual(state(f),before);
});

test('oversized streaming command rejects at the byte ceiling without waiting for an unfinished tail',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),before=state(f);let pulls=0;
  const body=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new Uint8Array(4097).fill(32));else return new Promise(()=>{});}});
  const request=new Request(f.request().url,{method:'POST',headers:{'content-type':'application/json',...f.actorHeaders},body,duplex:'half'});
  t.after(()=>{void request.body.cancel().catch(()=>{});});
  let timer;const ceiling=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('driver waited for unfinished oversized body')),250);});
  try{await assert.rejects(Promise.race([driveSponsoredImage(request,f.env,f.context),ceiling]),/sponsor_(?:driver_)?command_too_large/);}finally{clearTimeout(timer);}
  assert.ok(pulls<=2);assert.deepEqual(state(f),before);assert.equal(transport.calls.length,0);
});

for(const concurrent of [false,true])test(`lost intake acknowledgment leaves an unstarted preflight claim that ${concurrent?'two returning requests':'one returning request'} can acquire only once`,async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_intents'))){lost=true;throw Error('lost intake acknowledgment');}return result;};
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/lost intake acknowledgment/);assert.equal(lost,true);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),0);assert.equal(count(f,'output_preflights'),0);
  f.DB.batch=batch;
  const responses=await Promise.allSettled(Array.from({length:concurrent?2:1},()=>driveSponsoredImage(f.request(),f.env,f.context)));
  assert.ok(responses.some(result=>result.status==='fulfilled'&&result.value.status==='completed'),JSON.stringify(responses.map(result=>result.status==='rejected'?String(result.reason):result.value)));
  assertSettled(f,transport);const before=state(f);await driveSponsoredImage(f.request(),f.env,f.context);assert.deepEqual(state(f),before);
});

test('V2 approval-only revocation after native admission prevents the first paid dispatch',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let revoked=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!revoked&&statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){revoked=true;f.sqlite.prepare("UPDATE experience_sponsor_approvals SET revoked_at_ms=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE campaign_id=?").run(f.campaignId);}return result;};
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context));assert.equal(revoked,true);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns').get().enabled,1);assert.ok(f.sqlite.prepare('SELECT revoked_at_ms FROM experience_sponsor_approvals').get().revoked_at_ms);
  assert.equal(count(f,'output_execution_grants'),1);assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),1);
  assert.equal(count(f,'output_provider_calls'),0);assert.equal(transport.calls.length,0);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
});

test('V2 planning cost already incurred survives approval-only revocation and settles sponsor exactly once without buying Image',async t=>{
  const transport=installImageTransport(t),f=await fixture(t),fetch=globalThis.fetch;
  const {loadOutputTrustedContext}=await import('../worker/output-requirements-api.ts');
  const trusted=await loadOutputTrustedContext(f.request(),f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  t.mock.method(globalThis,'fetch',async(url,request)=>{const response=await fetch(url,request);if(String(url).endsWith('/responses'))f.sqlite.prepare("UPDATE experience_sponsor_approvals SET revoked_at_ms=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE campaign_id=?").run(f.campaignId);return response;});
  await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),/CHECK constraint failed|sponsor_.*(?:revoked|unavailable)/);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns').get().enabled,1);assert.ok(f.sqlite.prepare('SELECT revoked_at_ms FROM experience_sponsor_approvals').get().revoked_at_ms);
  assert.equal(transport.counts().plannerCalls,1);assert.equal(transport.counts().imageCalls,0);
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,1);assert.equal(calls[0].status,'settled');
  const money=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get(),tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get();
  assert.equal(money.owner_id,f.payer);assert.equal(tokens.owner_id,f.payer);assert.equal(money.status,'settled');assert.equal(tokens.used_tokens,200);assert.equal(money.used_microusd,calls[0].used_microusd);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(f.actor).used_microusd,0);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(f.payer).used_microusd,money.used_microusd);
  assert.equal(count(f,'experience_sponsor_active_jobs'),0);assert.equal(count(f,'experience_sponsor_consumptions'),1);
  const before=state(f),{reconcileKnownOutputProviderReceipts}=await import('../worker/output-execution-control.ts');
  assert.deepEqual(await reconcileKnownOutputProviderReceipts(f.env,trusted.principal,{jobId:f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id}),{reconciled:0,status:'not_needed'});
  assert.deepEqual(state(f),before);assert.equal(transport.counts().imageCalls,0);
});

test('V2 shorter resource deadline crossing at the durable pending checkpoint prevents synchronous paid dispatch',async t=>{
  const transport=installImageTransport(t),f=await fixture(t,{approved:false});
  const resourceDeadline=Date.now()+60_000;f.proposal.policy.resources.expiresAtMs=resourceDeadline;assert.ok(resourceDeadline<f.proposal.policy.expiresAtMs);await f.approve();
  const batch=f.DB.batch.bind(f.DB);let crossed=false;
  f.DB.batch=async statements=>{const result=await batch(statements);
    if(!crossed&&statements.some(statement=>/UPDATE document_jobs/u.test(statement.sql)&&statement.bindings.some(value=>typeof value==='string'&&value.includes('"status":"pending"')))){
      crossed=true;t.mock.method(Date,'now',()=>resourceDeadline+1);
    }return result;};
  const result=await driveSponsoredImage(f.request(),f.env,f.context);assert.equal(crossed,true);assert.equal(result.status,'failed');
  assert.equal(f.sqlite.prepare('SELECT expires_at_ms FROM experience_sponsor_grants').get().expires_at_ms,resourceDeadline);
  assert.equal(transport.calls.length,0);const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,1);assert.ok(['pending','uncertain'].includes(calls[0].status));
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
  assert.equal(count(f,'experience_sponsor_active_jobs'),1);assert.equal(count(f,'experience_sponsor_consumptions'),1);
});
