import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {rm,writeFile} from 'node:fs/promises';
import {fixture,transport,actor,payer,stream} from './sponsor-story-driver-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const [{driveSponsoredStory},{inheritRuntimeSchemaReadiness}]=await Promise.all([
  import('../worker/experience-sponsor-story-driver.ts'),import('../worker/runtime.ts'),
]);
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const originalFetch=globalThis.fetch;
const evidencePath='/private/tmp/forma-sponsor-story-driver-d1-evidence.json';

function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=100,`D1 parameter limit exceeded: ${bindings.length}`);
    assert.ok(Buffer.byteLength(sql)<=100_000,`D1 SQL byte limit exceeded: ${Buffer.byteLength(sql)}`);
    return {sql,bindings};
  };
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
      try{return await original[method](...args);}catch(error){entry.failure=String(error);throw error;}
    };
    originals.set(statement,{original,sql,bindings});return statement;
  };
  const wrapped={prepare:sql=>wrap(sql),rewriteBatch:null,batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
    const entry={kind:'batch',statements:values.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
    let submitted=values.map(value=>value.original);
    if(wrapped.rewriteBatch){
      const rewritten=await wrapped.rewriteBatch(entry.statements);
      if(rewritten){
        entry.originalStatements=entry.statements;entry.statements=rewritten.map(({sql,bindings})=>capture(sql,bindings));
        submitted=entry.statements.map(({sql,bindings})=>db.prepare(sql).bind(...bindings));
      }
    }
    try{return await db.batch(submitted);}catch(error){entry.failure=String(error);throw error;}
  }};
  return wrapped;
}
const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
const count=async(db,table)=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const actorCounters=async db=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async name=>
  [name,await all(db,`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`,actor)])));
const initiallyEmpty=['output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
  'output_provider_calls','experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_driver_intents',
  'experience_sponsor_driver_stages','experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs'];

test('continuous Story issuer and driver create and settle one original on actual local D1, with replay and atomic issuance refusal',{timeout:120_000},async t=>{
  await rm(evidencePath,{force:true});
  const calls=transport(t),syntheticFetch=globalThis.fetch;let outbound=0;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...args[1],redirect:'error'});
    if(url.href==='https://api.openai.com/v1/responses')return syntheticFetch(...args);
    outbound++;throw Error('network_forbidden');
  });
  // Actual D1 begins after native save/confirm and genuine synthetic-payer
  // approval. There is no preflight, issued grant, issuer receipt or native job
  // in the exported fixture. The production driver creates all of them below.
  const f=await fixture(t),denial=await fixture(t,{documentId:'sponsor-driver-story-denial',campaignId:'fixture-story-driver-denial'});
  const exported=exportSynthetic(f.sqlite),denialExported=exportSynthetic(denial.sqlite);assert.equal(calls.length,0);
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB','DENIAL_DB'],
    script:'export default {fetch(){return new Response("synthetic Story issuer/driver D1 qualification only")}}',
    outboundService(){outbound++;throw Error('network_forbidden');}});
  const trace=[],denialTrace=[];
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    assert.equal(await count(db,'experience_sponsor_approvals'),1);
    for(const table of initiallyEmpty)assert.equal(await count(db,table),0,`Actual D1 must start without ${table}`);
    const beforeActor=await actorCounters(db),result=await driveSponsoredStory(f.request(),f.env,f.context);
    assert.equal(result.status,'completed');assert.equal(result.replayed,false);assert.equal(calls.length,1);
    for(const table of ['experience_sponsor_driver_intents','output_preflights','experience_sponsor_grants','experience_sponsor_issuances',
      'output_execution_grants','output_operation_slots','document_jobs','experience_sponsor_consumptions',
      'budget_reservations','cost_budget_reservations'])assert.equal(await count(db,table),1,table);
    assert.deepEqual((await all(db,'SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid')).map(row=>row.stage),['preflight','authorize','run']);
    const resources=await all(db,'SELECT operation,text_bytes FROM experience_sponsor_resource_receipts ORDER BY rowid');
    assert.deepEqual(resources.map(row=>row.operation),['text-intake','preflight','issuance']);assert.ok(resources.every(row=>row.text_bytes>0));
    const issued=await db.prepare('SELECT * FROM experience_sponsor_issuances').first();
    assert.deepEqual(JSON.parse(issued.driver_command_json),f.command);assert.equal(JSON.parse(issued.envelope_json).version,4);
    assert.equal(JSON.parse(issued.envelope_json).family,'canonical-short-story@1');
    const grant=await db.prepare('SELECT * FROM output_execution_grants').first(),slot=await db.prepare('SELECT * FROM output_operation_slots').first();
    assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,1);
    assert.equal(slot.maximum_calls,1);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);assert.equal(slot.status,'succeeded');
    assert.deepEqual(await all(db,'SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes'),
      [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
    const job=await db.prepare('SELECT * FROM document_jobs').first();
    assert.equal(job.job_id,result.jobId);assert.equal(job.kind,'render_document');assert.equal(job.source_surface,'outputs');
    assert.equal(job.owner_id,actor);assert.equal(job.document_id,f.documentId);assert.equal(job.stream_id,stream);assert.equal(job.status,'completed');
    const providerCalls=await all(db,'SELECT * FROM output_provider_calls');assert.equal(providerCalls.length,1);
    assert.equal(providerCalls[0].stage_key,'planning:0:initial');assert.equal(providerCalls[0].status,'settled');
    const tokens=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [tokens,cost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');
      assert.equal(reservation.operation,'document-render:short_story');
    }
    assert.equal(tokens.used_tokens,200);assert.ok(cost.used_microusd>0);assert.equal(cost.used_microusd,providerCalls[0].used_microusd);assert.equal(cost.allow_user_overage,0);
    assert.equal((await db.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_tokens,200);
    assert.equal((await db.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_microusd,cost.used_microusd);
    for(const [scope,id] of [['user',payer],['workspace','forma']]){
      assert.deepEqual(await all(db,'SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?',scope,id),[{reserved_tokens:0}]);
      assert.deepEqual(await all(db,'SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?',scope,id),[{reserved_microusd:0}]);
    }
    assert.deepEqual(await actorCounters(db),beforeActor);assert.equal(await count(db,'experience_sponsor_active_jobs'),0);
    const completion=await all(db,"SELECT stream_id FROM events WHERE type='DocumentRenderCompleted'");assert.deepEqual(completion,[{stream_id:stream}]);
    const retained=await all(db,"SELECT owner_id,content FROM private_content WHERE kind='document-artifact'");
    assert.equal(retained.length,1);assert.equal(retained[0].owner_id,actor);
    assert.equal(JSON.parse(retained[0].content).content_markdown.split(/\s+/u).length,650);
    const beforeReplay=await rowsSnapshot(db,exported.tables),replay=await driveSponsoredStory(f.request(),f.env,f.context);
    assert.deepEqual(replay,{...result,replayed:true});assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeReplay);assert.equal(calls.length,1);

    const deniedDb=await mf.getD1Database('DENIAL_DB');await install(deniedDb,denialExported);
    const deniedGuard=tracedDatabase(deniedDb,denialTrace);inheritRuntimeSchemaReadiness(denial.env.DB,deniedGuard);denial.env.DB=deniedGuard;
    for(const table of initiallyEmpty)assert.equal(await count(deniedDb,table),0);
    let injected=false,beforeIssuance;
    deniedGuard.rewriteBatch=async statements=>{
      if(!statements.some(entry=>entry.sql.startsWith('INSERT INTO experience_sponsor_issuances(')))return null;
      assert.equal(injected,false,'Only the single original issuance may be attempted');
      const grants=statements.map((entry,index)=>({entry,index})).filter(({entry})=>entry.sql.startsWith('INSERT INTO experience_sponsor_grants('));
      assert.equal(grants.length,1);const index=grants[0].index;
      beforeIssuance=await rowsSnapshot(deniedDb,denialExported.tables);injected=true;
      // The real grant insert executes first. The following existing resource
      // guard must observe this in-transaction withdrawal and roll back both
      // the grant and the withdrawal, plus every later issuance write.
      return [...statements.slice(0,index+1),{sql:'UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?',bindings:[denial.campaignId]},...statements.slice(index+1)];
    };
    await assert.rejects(driveSponsoredStory(denial.request(),denial.env,denial.context),/CHECK constraint failed/u);
    assert.equal(injected,true);assert.ok(denialTrace.some(entry=>entry.failure?.includes('CHECK constraint failed')));
    assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),beforeIssuance);
    assert.equal((await deniedDb.prepare('SELECT enabled FROM experience_sponsor_resource_policies WHERE campaign_id=?').bind(denial.campaignId).first()).enabled,1);
    for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','output_execution_grants','document_jobs',
      'budget_reservations','cost_budget_reservations','output_provider_calls','experience_sponsor_consumptions','experience_sponsor_active_jobs'])assert.equal(await count(deniedDb,table),0,table);
    assert.equal(await count(deniedDb,'output_preflights'),1);
    assert.deepEqual((await all(deniedDb,'SELECT operation FROM experience_sponsor_resource_receipts ORDER BY rowid')).map(row=>row.operation),['text-intake','preflight']);
    assert.deepEqual((await all(deniedDb,'SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid')).map(row=>row.stage),['preflight','authorize']);
    assert.equal(calls.length,1);assert.equal(outbound,0);
    const flattened=[...trace,...denialTrace].flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against local workerd D1',localOnly:true,success:true,
      startingBoundary:'Synthetic native save/confirm and real V4 payer approval exported; zero preflight, grant, issuance or job',
      actualD1Stages:['driver intent','preflight','issuer resource debit and immutable issuance','native admission','run','settlement','driver replay'],
      schemaObjects:exported.schema.length,statementCount:flattened.length,maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),
      maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),seededIssuances:0,syntheticResponses:1,actualExternalNetworkRequests:outbound,
      actorOwnedRetainedStory:true,payerOnlySettlement:true,exactReplayUnchanged:true,lateIssuanceResourceWithdrawalAtomicRollback:true,
      priorDriverPreparationPreserved:true,resourcePolicyDisableRolledBack:true};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }catch(error){
    await writeFile('/private/tmp/forma-sponsor-story-driver-d1-failed-trace.json',JSON.stringify({error:String(error),trace,denialTrace},null,2)+'\n');
    throw error;
  }finally{await mf.dispose();}
});
