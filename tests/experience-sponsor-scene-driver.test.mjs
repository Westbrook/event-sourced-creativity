import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after,test} from 'node:test';
import {fixture,transport,assertPayerSettlement,assertResourceAccounting,captureNativeTerms,actorCounters,actor,payer,stream} from './sponsor-scene-driver-fixture.mjs';
const [{prepareSponsoredSceneDriver,driveSponsoredScene},{appendAuditEvent}]=await Promise.all([
  import('../worker/experience-sponsor-scene-driver.ts'),import('../worker/runtime.ts'),
]);

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Scene driver qualification prohibits external network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
// All installed tables, including retained source/witness and private custody.
const state=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name})=>[name,f.sqlite.prepare(`SELECT rowid AS original_rowid,* FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]));
const beforePurchase=f=>{
  for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','output_execution_grants','document_jobs',
    'experience_sponsor_consumptions','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),0,table);
};
const prepare=f=>prepareSponsoredSceneDriver(f.request(),f.env,f.context);
const drive=(f,prepared,overrides)=>driveSponsoredScene(f.runRequest(prepared,overrides),f.env,f.context);
const commandBatch=(statements,action)=>statements.some(statement=>statement.sql.startsWith('INSERT INTO output_commands(')&&statement.bindings[4]===action);
const finalDisclosure=statements=>statements.some(statement=>statement.sql.startsWith('SELECT job.status FROM document_jobs job JOIN output_operation_slots slot'));
const afterSettlement=(pending,mutate,hops=1)=>new Promise((resolve,reject)=>{
  pending.then(value=>{resolve(value);let queued=()=>mutate(value);for(let i=1;i<hops;i++){const next=queued;queued=()=>queueMicrotask(next);}queueMicrotask(queued);},reject);
});

function assertPrepared(f,prepared){
  assert.deepEqual(Object.keys(prepared).sort(),['campaignId','documentId','intentKey','payerUserId','planRevisionId','policyDigest','preflight','sceneCostPreview','targetId']);
  assert.equal(prepared.campaignId,f.campaignId);assert.equal(prepared.documentId,f.documentId);assert.equal(prepared.payerUserId,payer);
  assert.equal(prepared.planRevisionId,f.planRevisionId);assert.equal(prepared.targetId,f.targetId);assert.equal(prepared.intentKey,f.command.intentKey);
  assert.ok(Buffer.byteLength(JSON.stringify(prepared))<=65536);assert.equal(Object.hasOwn(prepared.sceneCostPreview,'confirmed'),false);
  assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'output_preflights'),1);
  assert.deepEqual(f.sqlite.prepare('SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid').all().map(row=>row.stage),['preflight']);
  const resources=f.sqlite.prepare('SELECT operation,text_bytes,intent_key FROM experience_sponsor_resource_receipts ORDER BY rowid').all();
  assert.deepEqual(resources.map(row=>row.operation),['text-intake','preflight']);
  for(const row of resources){assert.equal(row.text_bytes,f.N);assert.equal(row.intent_key,f.command.intentKey);}
  const terms=captureNativeTerms(f);assert.equal(prepared.preflight.id,terms.id);assert.equal(prepared.preflight.termsDigest,terms.termsDigest);
  assert.equal(prepared.preflight.maximumMicrousd,terms.maximumMicrousd);assert.equal(prepared.preflight.expiresAt,terms.expiresAt);
  assert.deepEqual(prepared.sceneCostPreview,terms.targets[0].settings.payload.outputScene.costPreview);beforePurchase(f);
}

function assertSettled(f,calls){
  captureNativeTerms(f);assert.equal(calls.length,1);assertPayerSettlement(f,150);assertResourceAccounting(f);
  assert.deepEqual(actorCounters(f),f.initialActorCounters);
  for(const table of ['experience_sponsor_driver_intents','output_preflights','experience_sponsor_grants','experience_sponsor_issuances',
    'output_execution_grants','output_operation_slots','document_jobs','experience_sponsor_consumptions'])assert.equal(count(f,table),1,table);
  assert.deepEqual(f.sqlite.prepare('SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid').all().map(row=>row.stage),['preflight','authorize','run']);
  const stages=f.sqlite.prepare('SELECT stage,command_json FROM experience_sponsor_driver_stages ORDER BY rowid').all();
  const authorize=JSON.parse(stages.find(row=>row.stage==='authorize').command_json);
  assert.equal(f.sqlite.prepare("SELECT intent_key FROM experience_sponsor_resource_receipts WHERE operation='issuance'").get().intent_key,authorize.clientMutationId);
  const issuance=f.sqlite.prepare('SELECT envelope_json FROM experience_sponsor_issuances').get(),envelope=JSON.parse(issuance.envelope_json);
  assert.equal(envelope.version,6);assert.equal(envelope.family,'canonical-scene-screenplay@1');
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,1);
  assert.equal(slot.maximum_calls,1);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);assert.equal(slot.status,'succeeded');
  assert.deepEqual(f.sqlite.prepare('SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes').all().map(row=>({...row})),
    [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.document_id,f.documentId);assert.equal(job.stream_id,stream);
  assert.equal(job.status,'completed');assert.equal(job.scene_source_protocol,1);assert.ok(job.scene_source_version_json);
  const witness=JSON.parse(job.scene_source_version_json);assert.equal(witness.jobId,job.job_id);assert.equal(witness.ownerId,actor);
  const callsStored=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(callsStored.length,1);
  assert.equal(callsStored[0].client_request_id,calls[0].clientRequestId);assert.equal(callsStored[0].used_microusd,800);
  const completions=f.sqlite.prepare("SELECT stream_id FROM events WHERE type='DocumentRenderCompleted'").all();
  assert.equal(completions.length,1);assert.equal(completions[0].stream_id,stream);
  const retained=f.sqlite.prepare("SELECT owner_id,content FROM private_content WHERE kind='document-artifact'").all();
  assert.equal(retained.length,1);assert.equal(retained[0].owner_id,actor);assert.match(retained[0].content,/forma-screenplay@1/);
  const inputs=f.sqlite.prepare("SELECT owner_id FROM private_content WHERE kind='document-artifact-input' AND redacted_at IS NULL").all();
  assert.ok(inputs.length>0);assert.ok(inputs.every(row=>row.owner_id===actor));
  assert.equal(count(f,'experience_sponsor_active_jobs'),0);
}

test('connected Scene driver positive and replay',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true}),batch=f.DB.batch.bind(f.DB),witnesses=[],wire=[];
  const prepareSql=f.DB.prepare,replaySqlCounts=[];let replaySql=null;
  f.DB.prepare=function(sql){if(replaySql)replaySql.push(sql);return prepareSql.call(this,sql);};
  t.after(()=>{f.DB.prepare=prepareSql;});
  const withoutBootstrap=async work=>{
    replaySql=[];
    try{return await work();}finally{
      const statements=replaySql;replaySql=null;assert.ok(statements.length>0);replaySqlCounts.push(statements.length);
      for(const sql of statements){
        assert.doesNotMatch(sql,/^\s*(?:CREATE\s+(?:(?:TEMP(?:ORARY)?|UNIQUE)\s+)*(?:TABLE|INDEX|TRIGGER)|ALTER)\b/iu,
          'A guarded DB view must inherit runtime schema readiness on replay');
        // ensureSchema contains this legacy analytics bootstrap cleanup. It
        // must never run again merely because the driver wraps the same DB.
        assert.notEqual(sql,"DELETE FROM external_content WHERE content_id LIKE 'analytics-source:v1:%' AND CASE WHEN json_valid(content) THEN COALESCE(json_extract(content,'$.schema'),0)<>2 ELSE 1 END");
        if(/^\s*DELETE\b/iu.test(sql))assert.equal(sql,'DELETE FROM output_atomic_assertions WHERE token=?',
          'Replay may clear its transient proof assertion, not run bootstrap or retention cleanup');
      }
    }
  };
  const provider=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(typeof options?.body,'string');wire.push(options.body);return provider(url,options);
  });
  f.DB.batch=async statements=>{const result=await batch(statements);
    if(statements.some(statement=>statement.sql.startsWith('UPDATE document_jobs SET scene_source_protocol=1,'))){
      const row=f.sqlite.prepare('SELECT scene_source_version_json FROM document_jobs').get();assert.ok(row);
      witnesses.push(JSON.parse(row.scene_source_version_json));
    }return result;
  };
  const prepared=await prepare(f);assertPrepared(f,prepared);assert.equal(calls.length,0);
  const preparedRows=state(f);assert.deepEqual(await withoutBootstrap(()=>prepare(f)),prepared);assert.deepEqual(state(f),preparedRows);
  const result=await drive(f,prepared);assert.equal(result.status,'completed',JSON.stringify(f.trace));assert.equal(result.replayed,false);
  assert.deepEqual(Object.keys(result).sort(),['jobId','replayed','status']);assert.ok(Buffer.byteLength(JSON.stringify(result))<1024);
  assertSettled(f,calls);
  assert.equal(wire.length,1);assert.equal(f.sqlite.prepare('SELECT request_digest FROM output_provider_calls').get().request_digest,
    createHash('sha256').update(wire[0]).digest('hex'));
  const admission=witnesses.find(value=>value.phase==='admission'),run=witnesses.find(value=>value.phase==='run');
  assert.ok(admission);assert.ok(run);assert.deepEqual(run.predecessor,admission.successor);assert.equal(run.jobId,admission.jobId);
  const before=state(f);assert.deepEqual(await withoutBootstrap(()=>drive(f,prepared)),{...result,replayed:true});assert.deepEqual(state(f),before);assertSettled(f,calls);
  f.limits.assertVerified();assert.deepEqual(f.trace.databaseErrors,[]);assert.deepEqual(f.trace.failedPredicates,[]);
  t.diagnostic(JSON.stringify({nodeHostedNativeComposition:true,strictShapes:f.limits.records.length,exactNativeMetadataExceptions:f.limits.exceptions,
    maximumBindings:Math.max(...f.limits.boundCounts),syntheticProviderCalls:calls.length,externalRequests:0,resourceOperations:3,resourceTextBytes:3*f.N,
    prepareReplaySqlStatements:replaySqlCounts[0],terminalReplaySqlStatements:replaySqlCounts[1]}));
});

test('Scene prepare rejects closed-wire and oversized input before sponsored operations',async t=>{
  const calls=transport(t),f=await fixture(t),before=state(f);
  for(const patch of [{payerUserId:payer},{maximumMicrousd:1},{prompt:'replacement'},{nowMs:1},{outputKind:'image'},{action:'run-sponsored-image'}])
    await assert.rejects(prepareSponsoredSceneDriver(f.request(patch),f.env,f.context),/sponsor_driver_command_invalid/);
  await assert.rejects(prepareSponsoredSceneDriver(new Request(f.request().url,{headers:f.actorHeaders}),f.env,f.context),/sponsor_explicit_command_required/);
  let pulls=0;const body=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new Uint8Array(8193).fill(32));else return new Promise(()=>{});}});
  const request=new Request(f.request().url,{method:'POST',headers:{'content-type':'application/json',...f.actorHeaders},body,duplex:'half'});let timer;
  const ceiling=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Driver waited for unfinished oversized body')),500);});
  try{await assert.rejects(Promise.race([prepareSponsoredSceneDriver(request,f.env,f.context),ceiling]),/sponsor_(?:driver_)?command_too_large/);}
  finally{clearTimeout(timer);void request.body.cancel().catch(()=>{});}
  assert.ok(pulls<=2);assert.deepEqual(state(f),before);assert.equal(calls.length,0);
});

for(const fault of ['absent','false','changed','expired'])test(`Scene actor ${fault} consent cannot purchase`,async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),before=state(f);
  const originalPreflight=f.sqlite.prepare('SELECT * FROM output_preflights').all();
  const original={...prepared.sceneCostPreview,confirmed:true};
  const consent=fault==='absent'?undefined:fault==='false'?{...original,confirmed:false}:fault==='changed'?{...original,requestHash:'f'.repeat(64)}:
    {...original,expiresAt:'2020-01-01T00:00:00.000Z'};
  await assert.rejects(drive(f,prepared,{sceneCostConsent:consent}));beforePurchase(f);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),2);assert.equal(calls.length,0);
  assert.deepEqual(f.sqlite.prepare('SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid').all().map(row=>row.stage),['preflight']);
  assert.deepEqual(state(f),before,'Invalid consent cannot become the immutable authorize stage');
  if(fault==='changed'||fault==='expired'){
    const result=await drive(f,prepared);assert.equal(result.status,'completed');assert.equal(result.replayed,false);
    assertSettled(f,calls);assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_preflights').all(),originalPreflight);
    assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'document_jobs'),1);
    assert.equal(f.sqlite.prepare('SELECT intent_key FROM experience_sponsor_driver_intents').get().intent_key,f.command.intentKey);
    assert.deepEqual(JSON.parse(f.sqlite.prepare("SELECT command_json FROM experience_sponsor_driver_stages WHERE stage='authorize'").get().command_json).sceneCostConsent,original);
  }
});

test('Scene reviewed policy, quote and same-intent selection cannot be replaced',async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),before=state(f);
  for(const patch of [{reviewedPolicyDigest:'sha256:'+'f'.repeat(64)},{preflightId:'different-quote'},{termsDigest:'f'.repeat(64)},
    {maximumMicrousd:prepared.preflight.maximumMicrousd+1},{targetId:'different-target'},{planRevisionId:'different-plan'},{intentKey:'unprepared-intent'}])
    await assert.rejects(drive(f,prepared,patch));
  assert.deepEqual(state(f),before);beforePurchase(f);assert.equal(calls.length,0);
});

test('lost Scene intake acknowledgment resumes its unstarted original preflight exactly once',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_intents'))){
    reached=true;throw Error('lost Scene intake acknowledgment');}return result;};
  await assert.rejects(prepare(f),/lost Scene intake acknowledgment/);assert.equal(reached,true);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'output_preflights'),0);
  const prepared=await prepare(f);assertPrepared(f,prepared);const before=state(f);assert.deepEqual(await prepare(f),prepared);assert.deepEqual(state(f),before);
  assert.equal((await drive(f,prepared)).status,'completed');assertSettled(f,calls);
});

test('charged Scene preflight with a missing native receipt stays unknown on concurrent return',async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='preflight')){
    reached=true;throw Error('lost Scene preflight stage acknowledgment');}return result;};
  await assert.rejects(prepare(f),/sponsor_driver_stage_unknown/);assert.equal(reached,true);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),2);assert.equal(count(f,'output_preflights'),0);
  const before=state(f),results=await Promise.allSettled([prepare(f),prepare(f)]);
  for(const result of results){assert.equal(result.status,'rejected');assert.match(String(result.reason),/sponsor_driver_stage_unknown/);}
  assert.deepEqual(state(f),before);beforePurchase(f);assert.equal(calls.length,0);
});

for(const phase of ['preflight','issuance','authorize','run'])test(`lost Scene ${phase} acknowledgment recovers original native identity`,async t=>{
  const calls=transport(t),f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false,atCommit;
  const matches=statements=>phase==='issuance'?statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_issuances')):commandBatch(statements,phase);
  const prepared=phase==='preflight'?null:await prepare(f);
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&matches(statements)){
    reached=true;atCommit={preflight:f.sqlite.prepare('SELECT * FROM output_preflights').all(),
      issuance:f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').all(),grant:f.sqlite.prepare('SELECT grant_id FROM output_execution_grants').all(),
      jobs:f.sqlite.prepare('SELECT job_id FROM document_jobs').all()};throw Error(`lost Scene ${phase} acknowledgment`);}return result;};
  let first;try{first=phase==='preflight'?await prepare(f):await drive(f,prepared);}catch(error){assert.match(String(error),new RegExp(`lost Scene ${phase} acknowledgment`));}
  assert.equal(reached,true,'The exact committed stage must be reached');
  const reviewed=phase==='preflight'?await prepare(f):prepared;const result=phase==='preflight'?await drive(f,reviewed):first??await drive(f,reviewed);
  assert.equal(result.status,'completed');assertSettled(f,calls);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_preflights').all(),atCommit.preflight);
  if(atCommit.issuance.length)assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').all(),atCommit.issuance);
  if(atCommit.grant.length)assert.deepEqual(f.sqlite.prepare('SELECT grant_id FROM output_execution_grants').all(),atCommit.grant);
  if(atCommit.jobs.length)assert.deepEqual(f.sqlite.prepare('SELECT job_id FROM document_jobs').all(),atCommit.jobs);
  const before=state(f);assert.deepEqual(await drive(f,reviewed),{...result,replayed:true});assert.deepEqual(state(f),before);assert.equal(calls.length,1);
});

for(const withdrawal of ['source','approval'])test(`Scene ${withdrawal} change after prepare refuses purchase without refund`,async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f);
  if(withdrawal==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',
    block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A different choice after review.'});
  else f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  const before=state(f);await assert.rejects(drive(f,prepared));assert.deepEqual(state(f),before);
  beforePurchase(f);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);assert.equal(calls.length,0);
});

test('Scene approval withdrawn after native admission blocks first dispatch',async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&commandBatch(statements,'authorize')){
    reached=true;f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);}return result;};
  await assert.rejects(drive(f,prepared));assert.equal(reached,true);assert.equal(count(f,'output_execution_grants'),1);
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'document_jobs'),1);assert.equal(calls.length,0);
  assert.equal(count(f,'output_provider_calls'),0);assert.deepEqual(actorCounters(f),f.initialActorCounters);
});

test('Scene terminal replay checks current Resource V1 authority in the final metadata transaction',async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),result=await drive(f,prepared);assert.equal(result.status,'completed');assertSettled(f,calls);
  const receipts=f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts ORDER BY rowid').all(),batch=f.DB.batch.bind(f.DB);
  let reached=false,afterWithdrawal;
  f.DB.batch=async statements=>{
    if(!reached&&finalDisclosure(statements)){
      reached=true;assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(result.jobId).status,'completed');
      assert.equal(statements.at(-1).sql.startsWith('SELECT job.status FROM document_jobs job JOIN output_operation_slots slot'),true);
      f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
      afterWithdrawal=state(f);
    }return batch(statements);
  };
  await assert.rejects(drive(f,prepared),/CHECK constraint failed|sponsor_/);
  assert.equal(reached,true,'Withdrawal must occur after original issuer proof, immediately before the real final metadata batch');
  assert.deepEqual(state(f),afterWithdrawal);assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts ORDER BY rowid').all(),receipts);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_resource_policies WHERE campaign_id=?').get(f.campaignId).enabled,0);
  assertSettled(f,calls);
});

for(const boundary of ['confirmed plan row','native preflight proof'])for(const mutation of ['Request','abort','DB'])
test(`Scene ${mutation} change inside ${boundary} await prevents further protected database work`,async t=>{
  const calls=transport(t),f=await fixture(t),database=f.env.DB,prepareSql=database.prepare,batch=database.batch.bind(database),request=f.request();
  let reached=false,foreign=0,preparesAfter=0,queriesAfter=0,batchesAfter=0,atBoundary,atChanges;
  const mutate=()=>{
    assert.equal(reached,false);atBoundary=state(f);atChanges=changes(f);reached=true;
    if(mutation==='Request')request.headers.set('oai-authenticated-user-id',payer);
    if(mutation==='abort')f.controller.abort();
    if(mutation==='DB')f.env.DB={...database,prepare(){foreign++;throw Error('Foreign nested native DB prepare');},batch(){foreign++;throw Error('Foreign nested native DB batch');}};
  };
  database.prepare=function(sql){
    if(reached)preparesAfter++;
    const wrap=statement=>{
      const bind=statement.bind;statement.bind=function(...values){return wrap(bind.apply(this,values));};
      for(const method of ['first','all','run']){
        const execute=statement[method];statement[method]=async function(...args){
          if(reached)queriesAfter++;
          const result=await execute.apply(this,args);
          if(!reached&&boundary==='confirmed plan row'&&method==='first'&&sql.startsWith('SELECT * FROM output_plan_revisions WHERE scope_key=? AND document_id=? ')){
            assert.equal(result.plan_revision_id,f.planRevisionId);mutate();
          }return result;
        };
      }return statement;
    };return wrap(prepareSql.call(this,sql));
  };
  database.batch=async statements=>{
    if(reached)batchesAfter++;
    const fromNativePreflight=boundary==='native preflight proof'
      &&statements.at(-1)?.sql==="SELECT CASE WHEN (? > strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END AS current"
      &&new Error().stack.includes('preflightOutputSceneTarget');
    const results=await batch(statements);
    if(!reached&&fromNativePreflight){
      assert.ok(statements.length>0);assert.ok(statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN')));
      assert.equal(results.length,statements.length);assert.ok(results.every(result=>result.success===true&&result.results.length===1&&result.results[0].current===1));
      assert.equal(count(f,'experience_sponsor_resource_receipts'),2);assert.equal(count(f,'output_preflights'),0);mutate();
    }return results;
  };
  t.after(()=>{database.prepare=prepareSql;database.batch=batch;f.env.DB=database;});
  await assert.rejects(prepareSponsoredSceneDriver(request,f.env,f.context),/sponsor_driver_authority_changed/);
  assert.equal(reached,true,'Mutation must follow a completed actual nested native database await');
  assert.equal(foreign,0);assert.equal(preparesAfter,0);assert.equal(queriesAfter,0);assert.equal(batchesAfter,0);
  assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assert.equal(count(f,'output_preflights'),0);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),boundary==='confirmed plan row'?0:2);beforePurchase(f);assert.equal(calls.length,0);
});

for(const mutation of ['DB','Request','abort'])test(`Scene ${mutation} mutation after actual preflight-stage read stops protected writes`,async t=>{
  const calls=transport(t),f=await fixture(t),database=f.env.DB,prepareSql=database.prepare,request=f.request();let reached=false,foreign=0,atBoundary,atChanges;
  database.prepare=function(sql){const wrap=statement=>{const bind=statement.bind,first=statement.first;
    statement.bind=function(...values){return wrap(bind.apply(this,values));};
    statement.first=function(...args){const pending=first.apply(this,args);
      if(!reached&&sql==='SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage=?'&&this.bindings[1]==='preflight')
        return afterSettlement(pending,()=>{reached=true;atBoundary=state(f);atChanges=changes(f);
          if(mutation==='DB')f.env.DB={...database,prepare(){foreign++;throw Error('Foreign DB prepare');},batch(){foreign++;throw Error('Foreign DB batch');}};
          if(mutation==='Request')request.headers.set('oai-authenticated-user-id',payer);
          if(mutation==='abort')f.controller.abort();});
      return pending;};return statement;};return wrap(prepareSql.call(this,sql));};
  t.after(()=>{database.prepare=prepareSql;f.env.DB=database;});
  await assert.rejects(prepareSponsoredSceneDriver(request,f.env,f.context),/sponsor_driver_authority_changed/);
  assert.equal(reached,true);assert.equal(foreign,0);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assert.equal(calls.length,0);
});

for(const nativeRequestOrdinal of [1,2])test(`Scene derived Run Request ${nativeRequestOrdinal} header mutation after actual loader read stops protected effects`,async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),database=f.env.DB,prepareSql=database.prepare,NativeRequest=globalThis.Request;
  let nativeRequests=0,captured,reached=false,atBoundary,atChanges;
  // Forward the real platform constructor and prototype. Capture only the
  // driver's native run wire, not the actor's run-sponsored-scene Request.
  t.mock.method(globalThis,'Request',new Proxy(NativeRequest,{construct(target,args,newTarget){
    const request=Reflect.construct(target,args,newTarget);let body;
    if(typeof args[1]?.body==='string'){try{body=JSON.parse(args[1].body);}catch{/* Other native request bodies are unrelated. */}}
    if(body?.action==='run'&&body.clientMutationId?.startsWith('sponsor-scene-run-')){
      nativeRequests++;if(nativeRequests===nativeRequestOrdinal)captured=request;
    }return request;
  }}));
  database.prepare=function(sql){const wrap=statement=>{const bind=statement.bind,first=statement.first;
    statement.bind=function(...values){return wrap(bind.apply(this,values));};
    statement.first=function(...args){const pending=first.apply(this,args);
      if(captured&&!reached)return afterSettlement(pending,()=>{reached=true;atBoundary=state(f);atChanges=changes(f);
        captured.headers.set('oai-authenticated-user-id',payer);
      });return pending;};return statement;};return wrap(prepareSql.call(this,sql));};
  t.after(()=>{database.prepare=prepareSql;});
  await assert.rejects(drive(f,prepared),/sponsor_driver_authority_changed/);
  assert.equal(reached,true);assert.equal(nativeRequests,nativeRequestOrdinal);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);
  assert.equal(count(f,'output_execution_grants'),1);assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);assert.equal(calls.length,0);
});

for(const fault of ['sparse','success-accessor','contradictory-error','status-accessor'])test(`Scene final metadata refuses ${fault} acknowledgment`,async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),batch=f.DB.batch.bind(f.DB);let reached=false,getters=0,atBoundary,atChanges;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&finalDisclosure(statements)){
    reached=true;assert.equal(result.at(-1).results[0].status,'completed');atBoundary=state(f);atChanges=changes(f);
    if(fault==='sparse')delete result[0];
    if(fault==='success-accessor')Object.defineProperty(result[0],'success',{get(){getters++;return true;}});
    if(fault==='contradictory-error')result[0].error='unconfirmed despite success';
    if(fault==='status-accessor')Object.defineProperty(result.at(-1).results[0],'status',{get(){getters++;return 'completed';}});
  }return result;};
  await assert.rejects(drive(f,prepared),/sponsor_driver_(?:batch_unconfirmed|original_job_unavailable)/);
  assert.equal(reached,true);assert.equal(getters,0);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assertSettled(f,calls);
});

for(const mutation of ['DB','Request','abort'])test(`Scene ${mutation} change after final metadata Promise settlement withholds result`,async t=>{
  const calls=transport(t),f=await fixture(t),prepared=await prepare(f),database=f.env.DB,batch=database.batch.bind(database),request=f.runRequest(prepared);
  let reached=false,foreign=0,atBoundary,atChanges;
  database.batch=statements=>{const pending=batch(statements);
    return !reached&&finalDisclosure(statements)?afterSettlement(pending,results=>{reached=true;assert.equal(results.at(-1).results[0].status,'completed');
      atBoundary=state(f);atChanges=changes(f);
      if(mutation==='DB')f.env.DB={...database,prepare(){foreign++;throw Error('Foreign DB prepare');},batch(){foreign++;throw Error('Foreign DB batch');}};
      if(mutation==='Request')request.headers.set('oai-authenticated-user-id',payer);
      if(mutation==='abort')f.controller.abort();
    },3):pending;};
  t.after(()=>{f.env.DB=database;});
  await assert.rejects(driveSponsoredScene(request,f.env,f.context),/sponsor_driver_authority_changed/);
  assert.equal(reached,true);assert.equal(foreign,0);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assertSettled(f,calls);
});
