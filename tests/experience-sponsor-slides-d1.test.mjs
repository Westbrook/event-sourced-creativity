import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {rm,writeFile} from 'node:fs/promises';
import {fixture,freshRun,transport,originalFetch,actor,payer,stream} from './sponsor-slides-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const [{inheritRuntimeSchemaReadiness},{outputAssertionStatements}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/output-command-core.ts'),
]);
const requireWrangler=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,Log,LogLevel}=requireWrangler('miniflare');

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
  const wrapped={prepare:sql=>wrap(sql),beforeBatch:null,rewriteBatch:null,batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
    const entry={kind:'batch',statements:values.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
    if(wrapped.beforeBatch)await wrapped.beforeBatch(entry.statements);
    let submitted=values.map(value=>value.original);
    if(wrapped.rewriteBatch){
      const rewritten=wrapped.rewriteBatch(entry.statements);
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
const actorCounters=async db=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async name=>
  [name,await all(db,`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`,actor)])));
const financialTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'];

test('native V5 Slides approval, original admission, optional repair and atomic refusal run on local workerd D1',{timeout:180_000},async t=>{
  await rm('/private/tmp/forma-sponsor-slides-d1-evidence.json',{force:true});
  // Bootstrap contains a native retained quote and disposable schemas only.
  // Campaign approval, authority seals, admission and execution happen after
  // the exact schema/scalar/rowid-preserving transfer to actual local D1.
  const calls=transport(t,{repairAtCall:2}),syntheticFetch=globalThis.fetch;let outbound=0;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...args[1],redirect:'error'});
    if(url.href==='https://api.openai.com/v1/responses')return syntheticFetch(...args);
    outbound++;throw Error('network_forbidden');
  });
  const f=await fixture(t,{sponsor:false}),repair=await fixture(t,{sponsor:false}),denial=await fixture(t,{sponsor:false});
  const media=[];
  for(const state of [f,repair,denial])state.env.MEDIA=Object.fromEntries(['get','head','put','delete','list'].map(method=>[method,()=>{media.push(method);throw Error('media_forbidden');}]));
  const exported=exportSynthetic(f.sqlite),repairExported=exportSynthetic(repair.sqlite),denialExported=exportSynthetic(denial.sqlite);
  assert.equal(calls.length,0,'Native quote setup must not dispatch a provider');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB','REPAIR_DB','DENIAL_DB'],
    script:'export default {fetch(){return new Response("synthetic Slides D1 qualification only")}}',
    outboundService(){outbound++;throw Error('network_forbidden');}});
  const trace=[],repairTrace=[],denialTrace=[];let limits,repairLimits,denialLimits;
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
    const beforeActor=await actorCounters(db);await f.sponsor();
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_approvals').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').first()).n,0);
    const admitted=await f.execute();assert.equal(admitted.replayed,false);assert.equal(calls.length,0);
    const grant=await db.prepare('SELECT * FROM output_execution_grants').first();
    const slot=await db.prepare('SELECT * FROM output_operation_slots').first();
    const job=await db.prepare('SELECT * FROM document_jobs').first();
    assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,2);
    assert.equal(slot.maximum_calls,2);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);
    assert.equal(slot.maximum_tokens,128000);
    assert.equal((await db.prepare('SELECT reserved_tokens FROM budget_reservations').first()).reserved_tokens,128000);
    assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(job.status,'queued');
    assert.deepEqual(await all(db,'SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes'),
      [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1},
        {stage_key:'planning:0:repair',provider:'openai',model:'gpt-5.6-sol',maximum_calls:1}]);
    const admissionRows=await rowsSnapshot(db,exported.tables);assert.equal((await f.execute()).replayed,true);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),admissionRows);
    const admittedConsumption=await rowsSnapshot(db,['experience_sponsor_consumptions']);
    const run=await freshRun(f);await run.queue();const finished=await run.drive();
    assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
    const providerCalls=await all(db,'SELECT * FROM output_provider_calls');assert.equal(providerCalls.length,1);
    assert.equal(providerCalls[0].stage_key,'planning:0:initial');assert.equal(providerCalls[0].status,'settled');
    assert.equal(providerCalls[0].client_request_id,calls[0].clientRequestId);
    assert.equal(providerCalls[0].request_digest,createHash('sha256').update(calls[0].requestBody).digest('hex'));
    const tokens=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [tokens,cost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);
      assert.equal(reservation.operation,'document-render:slides');assert.equal(reservation.status,'settled');
    }
    assert.equal(tokens.used_tokens,200);assert.ok(cost.used_microusd>0);assert.equal(cost.used_microusd,providerCalls[0].used_microusd);assert.equal(cost.allow_user_overage,0);
    assert.equal((await db.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_tokens,200);
    assert.equal((await db.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_microusd,cost.used_microusd);
    assert.deepEqual(await actorCounters(db),beforeActor);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').first()).n,0);
    assert.equal((await db.prepare('SELECT status FROM output_operation_slots').first()).status,'succeeded');
    assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").first()).n>0);
    assert.deepEqual(await rowsSnapshot(db,['experience_sponsor_consumptions']),admittedConsumption,'Unused repair keeps the original immutable authorization ceiling');
    for(const [scope,id] of [['user',payer],['workspace','forma']])for(const [table,currency] of [['budget_counters','tokens'],['cost_budget_counters','microusd']]){
      assert.equal((await db.prepare(`SELECT reserved_${currency} AS amount FROM ${table} WHERE scope=? AND scope_id=?`).bind(scope,id).first()).amount,0);
    }
    const settled=await rowsSnapshot(db,financialTables);await run.drive();
    assert.deepEqual(await rowsSnapshot(db,financialTables),settled);assert.equal(calls.length,1);

    // The second disposable deck emits an invalid initial composition. Native
    // validation alone requests its one optional repair using the separately
    // authorized model/effort; the fixture does not insert a repair job or row.
    const repairDb=await mf.getD1Database('REPAIR_DB');await install(repairDb,repairExported);
    const repairGuard=tracedDatabase(repairDb,repairTrace);inheritRuntimeSchemaReadiness(repair.env.DB,repairGuard);repair.env.DB=repairGuard;
    repairLimits=enforceD1ExpressionDepth(repair,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
    const repairActorBefore=await actorCounters(repairDb);await repair.sponsor();await repair.execute();
    const repairConsumption=await rowsSnapshot(repairDb,['experience_sponsor_consumptions']);
    const repairRun=await freshRun(repair);await repairRun.queue();const repaired=await repairRun.drive();
    assert.equal(repaired.status,'completed',JSON.stringify(repaired));assert.equal(calls.length,3);
    const repairedCalls=await all(repairDb,'SELECT * FROM output_provider_calls ORDER BY stage_key');
    assert.deepEqual(repairedCalls.map(({stage_key,model,status})=>({stage_key,model,status})),[
      {stage_key:'planning:0:initial',model:'gpt-5.6-terra',status:'settled'},
      {stage_key:'planning:0:repair',model:'gpt-5.6-sol',status:'settled'},
    ]);
    assert.deepEqual(calls.map(call=>({model:call.body.model,effort:call.body.reasoning.effort})),[
      {model:'gpt-5.6-terra',effort:'low'},{model:'gpt-5.6-terra',effort:'low'},{model:'gpt-5.6-sol',effort:'medium'},
    ]);
    assert.notEqual(calls[1].clientRequestId,calls[2].clientRequestId);
    for(const [index,call] of repairedCalls.entries()){
      assert.equal(call.client_request_id,calls[index+1].clientRequestId);
      assert.equal(call.request_digest,createHash('sha256').update(calls[index+1].requestBody).digest('hex'));
    }
    assert.equal((await repairDb.prepare('SELECT COUNT(*) AS n FROM document_jobs').first()).n,1);
    assert.equal((await repairDb.prepare('SELECT COUNT(*) AS n FROM output_operation_slots').first()).n,1);
    const repairTokens=await repairDb.prepare('SELECT * FROM budget_reservations').first(),repairCost=await repairDb.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [repairTokens,repairCost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);
      assert.equal(reservation.operation,'document-render:slides');assert.equal(reservation.status,'settled');
    }
    assert.equal(repairTokens.reserved_tokens,128000);assert.equal(repairTokens.used_tokens,400);
    assert.equal(repairCost.used_microusd,repairedCalls.reduce((sum,call)=>sum+call.used_microusd,0));assert.ok(repairCost.used_microusd>0);assert.equal(repairCost.allow_user_overage,0);
    assert.deepEqual(await actorCounters(repairDb),repairActorBefore);
    assert.deepEqual(await rowsSnapshot(repairDb,['experience_sponsor_consumptions']),repairConsumption);
    assert.equal((await repairDb.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').first()).n,0);
    assert.equal((await repairDb.prepare('SELECT status FROM output_operation_slots').first()).status,'succeeded');
    for(const [scope,id] of [['user',payer],['workspace','forma']])for(const [table,currency,used] of [['budget_counters','tokens',400],['cost_budget_counters','microusd',repairCost.used_microusd]]){
      const counter=await repairDb.prepare(`SELECT reserved_${currency} AS reserved,used_${currency} AS used FROM ${table} WHERE scope=? AND scope_id=?`).bind(scope,id).first();
      assert.equal(counter.reserved,0);assert.equal(counter.used,used);
    }
    const repairedSettled=await rowsSnapshot(repairDb,financialTables);await repairRun.drive();
    assert.deepEqual(await rowsSnapshot(repairDb,financialTables),repairedSettled);assert.equal(calls.length,3);

    // Actual D1 binds JavaScript numbers as REAL while retaining text/null
    // distinctions; do not silently coerce this boundary to SQLite integers.
    // The production
    // assertion primitive rejects both false and NULL by rolling back earlier
    // writes in the same batch. These probe rows are solely disposable fixtures.
    const boundScalarTypes=await guarded.prepare('SELECT typeof(?) AS number_type,typeof(?) AS string_type,typeof(?) AS null_type').bind(1,'1',null).first();
    assert.deepEqual(boundScalarTypes,{number_type:'real',string_type:'text',null_type:'null'});
    const guardBefore=await rowsSnapshot(db,['output_atomic_assertions']);
    for(const value of [0,null]){
      await assert.rejects(guarded.batch([
        guarded.prepare('INSERT INTO output_atomic_assertions(token,passed) VALUES(?,1)').bind(`slides-d1-rollback-${String(value)}`),
        ...outputAssertionStatements(f.env,{sql:'?',bindings:[value]}),
      ]),/CHECK constraint failed/u);
      assert.deepEqual(await rowsSnapshot(db,['output_atomic_assertions']),guardBefore);
    }
    const deniedDb=await mf.getD1Database('DENIAL_DB');await install(deniedDb,denialExported);
    const deniedGuard=tracedDatabase(deniedDb,denialTrace);inheritRuntimeSchemaReadiness(denial.env.DB,deniedGuard);denial.env.DB=deniedGuard;
    denialLimits=enforceD1ExpressionDepth(denial,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
    await denial.sponsor();
    const nativeAdmission=statements=>statements.some(entry=>entry.sql.startsWith('INSERT INTO output_execution_grants('));
    // Fault injection changes only the truth value of one real transaction
    // witness at the D1 boundary. Every native admission write, other proof,
    // binding and statement order remains the production-generated value.
    // Both independent guards must roll back the entire actual native batch.
    for(const witness of ['native','resource'])for(const value of [0,null]){
      const before=await rowsSnapshot(deniedDb,denialExported.tables),probeTraceStart=denialTrace.length;let injected=false;
      deniedGuard.rewriteBatch=statements=>{
        if(!nativeAdmission(statements))return null;
        const candidates=statements.map((entry,index)=>({entry,index})).filter(({entry})=>witness==='native'
          ?entry.sql.startsWith('INSERT INTO output_atomic_assertions(')&&entry.sql.includes('$.output_command_envelope.sponsor_entitlement.consumption_id')
          :entry.sql.startsWith('INSERT INTO experience_sponsor_assertions(')&&entry.sql.includes('JOIN experience_sponsor_resource_policies resources')&&String(entry.bindings[0]).startsWith('sponsor-slides:'));
        assert.equal(candidates.length,1,`Exactly one actual ${witness} transaction witness is required`);
        const {entry,index}=candidates[0],start=entry.sql.indexOf('CASE WHEN ('),end=entry.sql.lastIndexOf(') THEN 1 ELSE 0 END');
        assert.ok(start>0&&end>start);injected=true;
        const replacement={sql:entry.sql.slice(0,start)+'CASE WHEN (?) THEN 1 ELSE 0 END'+entry.sql.slice(end+') THEN 1 ELSE 0 END'.length),bindings:[entry.bindings[0],value]};
        return statements.map((original,position)=>position===index?replacement:original);
      };
      await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);assert.equal(injected,true);
      assert.ok(denialTrace.slice(probeTraceStart).some(entry=>entry.kind==='batch'&&nativeAdmission(entry.statements)&&entry.failure?.includes('CHECK constraint failed')),'The injected proof must fail its real native D1 CHECK transaction');
      assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),before);assert.equal(calls.length,3);
    }
    // Only the selected unchanged approval predicate sees the payer drift:
    // the next injected statement would restore it before any later guards.
    // Thus another repeated payer guard cannot make this check pass falsely.
    const beforePayerDrift=await rowsSnapshot(deniedDb,denialExported.tables),payerDriftTraceStart=denialTrace.length;let payerChanged=false;
    const originalPayer=await deniedDb.prepare('SELECT updated_at FROM users WHERE user_id=?').bind(payer).first();assert.ok(originalPayer);
    deniedGuard.rewriteBatch=statements=>{
      if(!nativeAdmission(statements))return null;
      const matches=statements.map((entry,index)=>({entry,index})).filter(({entry})=>
        entry.sql.startsWith('INSERT INTO experience_sponsor_assertions(')&&entry.sql.includes('sponsor_approval_terms AS MATERIALIZED')
        &&String(entry.bindings[0]).startsWith('sponsor-slides:'));
      assert.equal(matches.length,1,'Exactly one Slides approval transaction witness is required');
      const index=matches[0].index;payerChanged=true;
      return [...statements.slice(0,index),{sql:"UPDATE users SET updated_at='fixture-slides-payer-changed' WHERE user_id=?",bindings:[payer]},statements[index],
        {sql:'UPDATE users SET updated_at=? WHERE user_id=?',bindings:[originalPayer.updated_at,payer]},...statements.slice(index+1)];
    };
    await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);assert.equal(payerChanged,true);
    assert.ok(denialTrace.slice(payerDriftTraceStart).some(entry=>entry.kind==='batch'&&nativeAdmission(entry.statements)&&entry.failure?.includes('CHECK constraint failed')),'The unchanged payer witness must fail its real native D1 CHECK transaction');
    assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),beforePayerDrift);
    deniedGuard.rewriteBatch=null;let changed=false,afterWithdrawal;
    deniedGuard.beforeBatch=async statements=>{
      if(!changed&&statements.some(entry=>entry.sql.startsWith('INSERT INTO output_execution_grants('))){
        changed=true;await deniedDb.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').bind(denial.policy.campaignId).run();
        afterWithdrawal=await rowsSnapshot(deniedDb,denialExported.tables);
      }
    };
    const withdrawalTraceStart=denialTrace.length;
    await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);
    assert.equal(changed,true,'The mutation must occur at the real native admission batch');
    assert.ok(denialTrace.slice(withdrawalTraceStart).some(entry=>entry.failure?.includes('CHECK constraint failed')));
    assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),afterWithdrawal);
    assert.equal((await deniedDb.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').first()).n,0);
    assert.equal((await deniedDb.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').first()).n,0);
    assert.equal(calls.length,3);assert.equal(outbound,0);assert.deepEqual(media,[]);
    limits.assertVerified();repairLimits.assertVerified();denialLimits.assertVerified();
    const flattened=[...trace,...repairTrace,...denialTrace].flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against local workerd D1',localOnly:true,success:true,schemaObjects:exported.schema.length,
      statementCount:flattened.length,strictCompilerStatements:limits.records.length+repairLimits.records.length+denialLimits.records.length,expressionDepthLimit:100,functionArgumentLimit:32,maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),
      maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),
      nativePayerApproval:true,nativeAdmission:true,nativeRun:true,logicalStages:['planning:0:initial','planning:0:repair'],nativeMaximumCalls:2,sharedMaximumTokens:128000,boundScalarTypes,
      syntheticResponses:3,actualExternalNetworkRequests:outbound,mediaRequests:media.length,payerOnlySettlement:true,
      optionalRepairSkippedAndUsed:true,separateInitialAndRepairModels:true,immutableConsumptionCeiling:true,unusedCeilingsReleased:true,
      exactCapturedWireMatchesDurableLedger:true,
      admissionReplayUnchanged:true,settlementReplayUnchanged:true,falseAndNullWitnessRollback:true,
      composedNativeAndResourceFalseNullRollback:true,composedPayerDriftAtomicRollback:true,lateCampaignWithdrawalAtomicRollback:true};
    await writeFile('/private/tmp/forma-sponsor-slides-d1-evidence.json',JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }catch(error){
    const failurePath=`/private/tmp/forma-sponsor-slides-d1-failed-trace-${Date.now()}.json`;
    await writeFile(failurePath,JSON.stringify({error:String(error),stack:error?.stack,trace,repairTrace,denialTrace},null,2)+'\n',{flag:'wx'});t.diagnostic(`Preserved failure: ${failurePath}`);
    throw error;
  }finally{limits?.restore();repairLimits?.restore();denialLimits?.restore();await mf.dispose();}
});
