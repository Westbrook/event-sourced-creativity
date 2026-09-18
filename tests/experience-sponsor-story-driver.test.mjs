import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,transport,assertPayerSettlement,actorCounters,actor,payer,stream} from './sponsor-story-driver-fixture.mjs';
const {driveSponsoredStory}=await import('../worker/experience-sponsor-story-driver.ts');
const {appendAuditEvent}=await import('../worker/runtime.ts');
const tables=['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_resource_receipts',
  'experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_preflights',
  'output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const state=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in dormant Story driver qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});

function assertSettled(f,calls){
  assert.equal(calls.length,1);assertPayerSettlement(f);
  for(const table of ['experience_sponsor_driver_intents','output_preflights','experience_sponsor_grants','experience_sponsor_issuances',
    'output_execution_grants','document_jobs'])assert.equal(count(f,table),1,table);
  assert.deepEqual(f.sqlite.prepare('SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid').all().map(row=>row.stage),['preflight','authorize','run']);
  const operations=f.sqlite.prepare('SELECT operation,text_bytes FROM experience_sponsor_resource_receipts ORDER BY rowid').all();
  assert.deepEqual(operations.map(row=>row.operation),['text-intake','preflight','issuance']);
  assert.ok(operations.every(row=>row.text_bytes>0));assert.equal(operations[0].text_bytes,operations[1].text_bytes);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,1);
  assert.equal(slot.maximum_calls,1);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);assert.equal(slot.status,'succeeded');
  assert.deepEqual(f.sqlite.prepare('SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes').all().map(row=>({...row})),
    [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.document_id,f.documentId);assert.equal(job.stream_id,stream);assert.equal(job.status,'completed');
  const completions=f.sqlite.prepare("SELECT event_id,stream_id FROM events WHERE type='DocumentRenderCompleted'").all();
  assert.equal(completions.length,1);assert.equal(completions[0].stream_id,stream);
  const retained=f.sqlite.prepare("SELECT owner_id,content FROM private_content WHERE kind='document-artifact'").all();
  assert.equal(retained.length,1);assert.equal(retained[0].owner_id,actor);
  const body=JSON.parse(retained[0].content);assert.equal(body.title,'The Returned Clock');assert.equal(body.content_markdown.split(/\s+/u).length,650);
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(actor).used_tokens,0);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(actor).used_microusd,0);
}

test('continuous V4 Story driver obtains real preflight and issuance, settles one native call to payer and retains actor-owned Story under strict SQL limits',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true}),actorBefore=actorCounters(f);
  const result=await driveSponsoredStory(f.request(),f.env,f.context);assert.equal(result.status,'completed');assert.equal(result.replayed,false);
  assertSettled(f,calls);assert.deepEqual(actorCounters(f),actorBefore);
  const before=state(f),again=await driveSponsoredStory(f.request(),f.env,f.context);
  assert.deepEqual(again,{...result,replayed:true});assert.deepEqual(state(f),before);assertSettled(f,calls);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),
    expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,syntheticResponses:calls.length,actualExternalRequests:0}));
});

test('a committed Story preflight ticket without native receipt cannot repeat protected preparation',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='preflight')){lost=true;throw Error('lost Story preflight ticket acknowledgment');}return result;};
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/sponsor_driver_stage_unknown/);
  assert.equal(lost,true);assert.equal(count(f,'output_preflights'),0);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);
  const before=state(f);await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/sponsor_driver_stage_unknown/);
  assert.deepEqual(state(f),before);assert.equal(calls.length,0);assert.equal(count(f,'experience_sponsor_grants'),0);
});

for(const stage of ['preflight','authorization','run'])test(`lost native Story ${stage} acknowledgment reuses the committed original and purchases one Story`,async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  const matches=sql=>stage==='preflight'?sql.includes('INSERT INTO output_preflights'):stage==='authorization'?sql.includes('INSERT INTO output_execution_grants'):sql.includes("UPDATE output_operation_slots SET status='queued'");
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>matches(statement.sql))){lost=true;throw Error(`lost native Story ${stage} acknowledgment`);}return result;};
  try{await driveSponsoredStory(f.request(),f.env,f.context);}catch(error){assert.match(error.message,new RegExp(`lost native Story ${stage} acknowledgment`));}
  assert.equal(lost,true);
  const result=await driveSponsoredStory(f.request(),f.env,f.context);assert.equal(result.status,'completed');assertSettled(f,calls);
  const before=state(f);await driveSponsoredStory(f.request(),f.env,f.context);assert.deepEqual(state(f),before);assertSettled(f,calls);
});

test('one Story intent cannot change target or authored source to buy a replacement',async t=>{
  const calls=transport(t),f=await fixture(t);await driveSponsoredStory(f.request(),f.env,f.context);const before=state(f);
  await assert.rejects(driveSponsoredStory(f.request({targetId:'different-target'}),f.env,f.context),/sponsor_driver_(?:intent_changed|target_unsupported)/);
  assert.deepEqual(state(f),before);
  await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,
    property_path:'text',old_value:f.sourceText,new_value:'Mira keeps the clock and boards the train.'});
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/sponsor_driver_(?:source_changed|intent_changed)/);
  assert.deepEqual(state(f),before);assert.equal(calls.length,1);
});

test('closed Story actor POST rejects payer, price, prompt, clock, output and method overrides before writes',async t=>{
  const calls=transport(t),f=await fixture(t),before=state(f);
  for(const extra of [{payerUserId:payer},{maximumMicrousd:1},{prompt:'bypass context blocks'},{nowMs:Date.now()+86_400_000},{action:'run-sponsored-image'},{outputKind:'model3d'}])
    await assert.rejects(driveSponsoredStory(f.request(extra),f.env,f.context),/sponsor_driver_command_invalid/);
  await assert.rejects(driveSponsoredStory(new Request(f.request().url,{headers:f.actorHeaders}),f.env,f.context),/sponsor_driver_post_required/);
  assert.deepEqual(state(f),before);assert.equal(calls.length,0);
});

test('oversized Story stream refuses at the byte ceiling without reading an unfinished tail',async t=>{
  const calls=transport(t),f=await fixture(t),before=state(f);let pulls=0;
  const body=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new Uint8Array(4097).fill(32));else return new Promise(()=>{});}});
  const request=new Request(f.request().url,{method:'POST',headers:{'content-type':'application/json',...f.actorHeaders},body,duplex:'half'});
  t.after(()=>{void request.body.cancel().catch(()=>{});});
  let timer;const ceiling=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Story driver waited for unfinished oversized body')),250);});
  try{await assert.rejects(Promise.race([driveSponsoredStory(request,f.env,f.context),ceiling]),/sponsor_(?:driver_)?command_too_large/);}finally{clearTimeout(timer);}
  assert.ok(pulls<=2);assert.deepEqual(state(f),before);assert.equal(calls.length,0);
});

test('two returning Story requests after a durable preflight converge on one original grant and purchase',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='authorize'))throw Error('pause after durable Story preflight');return batch(statements);};
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/pause after durable Story preflight/);
  assert.equal(count(f,'output_preflights'),1);assert.equal(count(f,'experience_sponsor_grants'),0);assert.equal(calls.length,0);f.DB.batch=batch;
  const results=await Promise.allSettled([driveSponsoredStory(f.request(),f.env,f.context),driveSponsoredStory(f.request(),f.env,f.context)]);
  assert.ok(results.some(result=>result.status==='fulfilled'),JSON.stringify(results.map(result=>result.status==='rejected'?String(result.reason):result.value)));
  assertSettled(f,calls);const before=state(f);assert.equal((await driveSponsoredStory(f.request(),f.env,f.context)).status,'completed');assert.deepEqual(state(f),before);
});

for(const concurrent of [false,true])test(`lost Story intake acknowledgment lets ${concurrent?'two returning requests':'one returning request'} claim the unstarted preflight only once`,async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_intents'))){lost=true;throw Error('lost Story intake acknowledgment');}return result;};
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/lost Story intake acknowledgment/);assert.equal(lost,true);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),0);assert.equal(count(f,'output_preflights'),0);f.DB.batch=batch;
  const results=await Promise.allSettled(Array.from({length:concurrent?2:1},()=>driveSponsoredStory(f.request(),f.env,f.context)));
  assert.ok(results.some(result=>result.status==='fulfilled'&&result.value.status==='completed'),JSON.stringify(results.map(result=>result.status==='rejected'?String(result.reason):result.value)));
  assertSettled(f,calls);const before=state(f);await driveSponsoredStory(f.request(),f.env,f.context);assert.deepEqual(state(f),before);
});

test('V4 approval-only revocation after native Story admission blocks the first paid dispatch',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let revoked=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!revoked&&statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){revoked=true;f.sqlite.prepare("UPDATE experience_sponsor_approvals SET revoked_at_ms=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE campaign_id=?").run(f.campaignId);}return result;};
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context));assert.equal(revoked,true);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns').get().enabled,1);assert.ok(f.sqlite.prepare('SELECT revoked_at_ms FROM experience_sponsor_approvals').get().revoked_at_ms);
  assert.equal(count(f,'output_execution_grants'),1);assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),1);
  assert.equal(count(f,'output_provider_calls'),0);assert.equal(calls.length,0);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'active');
});

test('incurred Story usage after approval-only revocation settles original payer once without publishing returned prose',async t=>{
  const f=await fixture(t),actorBefore=actorCounters(f);
  const {loadOutputTrustedContext}=await import('../worker/output-requirements-api.ts');
  const trusted=await loadOutputTrustedContext(f.request(),f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const calls=transport(t,{afterDispatch:()=>{f.sqlite.prepare("UPDATE experience_sponsor_approvals SET revoked_at_ms=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE campaign_id=?").run(f.campaignId);}});
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/CHECK constraint failed|sponsor_.*(?:revoked|unavailable)/);
  assert.equal(calls.length,1);assertPayerSettlement(f);assert.deepEqual(actorCounters(f),actorBefore);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);
  const before=state(f),{reconcileKnownOutputProviderReceipts}=await import('../worker/output-execution-control.ts');
  assert.deepEqual(await reconcileKnownOutputProviderReceipts(f.env,trusted.principal,{jobId:f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id}),{reconciled:0,status:'not_needed'});
  assert.deepEqual(state(f),before);assert.equal(calls.length,1);
});

test('revocation after terminal Story settlement withholds driver metadata and preserves known costs',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let revoked=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!revoked&&f.sqlite.prepare("SELECT 1 FROM document_jobs WHERE status='completed'").get()){
    revoked=true;f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  }return result;};
  await assert.rejects(driveSponsoredStory(f.request(),f.env,f.context),/sponsor_(?:approved_campaign_unavailable|authority|driver)/);
  assert.equal(revoked,true);assertSettled(f,calls);
});

for(const stage of ['preflight','run'])for(const change of ['database replacement','request abort'])test(`Story ${change} after the ${stage} stage read refuses before its next protected write`,async t=>{
  const calls=transport(t),f=await fixture(t),database=f.env.DB,prepare=database.prepare,controller=new AbortController();
  const request=new Request(f.request(),{signal:controller.signal});let changed=false,atBoundary;
  database.prepare=function(sql){
    const wrap=statement=>{
      const bind=statement.bind,first=statement.first;
      statement.bind=function(...bindings){return wrap(bind.apply(this,bindings));};
      statement.first=async function(...args){
        const row=await first.apply(this,args);
        if(!changed&&sql==='SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=?'&&this.bindings[1]===stage){
          changed=true;atBoundary=state(f);
          if(change==='database replacement')f.env.DB={...database};else controller.abort();
        }
        return row;
      };
      return statement;
    };
    return wrap(prepare.call(this,sql));
  };
  t.after(()=>{database.prepare=prepare;f.env.DB=database;});
  await assert.rejects(driveSponsoredStory(request,f.env,f.context),/sponsor_driver_authority_changed/);
  assert.equal(changed,true,'Mutation must happen after the actual awaited stage result');assert.deepEqual(state(f),atBoundary);assert.equal(calls.length,0);
  assert.equal(count(f,'experience_sponsor_driver_intents'),1);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),stage==='preflight'?1:2);
  assert.equal(count(f,'experience_sponsor_driver_stages'),stage==='preflight'?0:2);
  assert.equal(count(f,'output_preflights'),stage==='preflight'?0:1);
  for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),0,table);
});

for(const replay of [false,true])for(const change of ['database replacement','request abort','campaign deadline'])test(`Story ${change} after final disclosure batch withholds ${replay?'terminal replay':'newly settled'} metadata without changing settlement`,async t=>{
  const calls=transport(t),f=await fixture(t),database=f.env.DB,controller=new AbortController();
  if(replay){assert.equal((await driveSponsoredStory(f.request(),f.env,f.context)).status,'completed');assertSettled(f,calls);}
  const batch=database.batch.bind(database),request=new Request(f.request(),{signal:controller.signal});
  let changed=false,atBoundary,clock;
  database.batch=async statements=>{
    const rows=await batch(statements);
    if(!changed&&statements.some(statement=>statement.sql.startsWith('SELECT job.status FROM document_jobs job JOIN output_operation_slots slot'))){
      changed=true;atBoundary=state(f);
      assert.equal(rows.at(-1)?.results?.[0]?.status,'completed','The real guarded read must already have returned the terminal job');
      if(change==='database replacement')f.env.DB={...database};
      else if(change==='request abort')controller.abort();
      else clock=t.mock.method(Date,'now',()=>f.policy.expiresAtMs+1);
    }
    return rows;
  };
  t.after(()=>{database.batch=batch;f.env.DB=database;if(clock)clock.mock.restore();});
  await assert.rejects(driveSponsoredStory(request,f.env,f.context),/sponsor_driver_authority_changed|sponsor_.*expired/);
  assert.equal(changed,true,'Mutation must occur after the actual final guarded read');assert.deepEqual(state(f),atBoundary);assertSettled(f,calls);
});
