import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {rm,writeFile} from 'node:fs/promises';
import {fixture,freshRun,transport,originalFetch,actor,payer,stream} from './sponsor-story-native-fixture.mjs';
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

test('native V4 Story approval, original admission, one-call execution and atomic refusal run on local workerd D1',{timeout:120_000},async t=>{
  await rm('/private/tmp/forma-sponsor-story-d1-evidence.json',{force:true});
  // Bootstrap contains a native retained quote and disposable schemas only.
  // Campaign approval, authority seals, admission and execution happen after
  // the exact schema/scalar/rowid-preserving transfer to actual local D1.
  const calls=transport(t),syntheticFetch=globalThis.fetch;let outbound=0;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...args[1],redirect:'error'});
    if(url.href==='https://api.openai.com/v1/responses')return syntheticFetch(...args);
    outbound++;throw Error('network_forbidden');
  });
  const f=await fixture(t,{sponsor:false}),denial=await fixture(t,{sponsor:false});
  const exported=exportSynthetic(f.sqlite),denialExported=exportSynthetic(denial.sqlite);
  assert.equal(calls.length,0,'Native quote setup must not dispatch a provider');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB','DENIAL_DB'],
    script:'export default {fetch(){return new Response("synthetic Story D1 qualification only")}}',
    outboundService(){outbound++;throw Error('network_forbidden');}});
  const trace=[],denialTrace=[];
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    const beforeActor=await actorCounters(db);await f.sponsor();
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_approvals').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').first()).n,0);
    const admitted=await f.execute();assert.equal(admitted.replayed,false);assert.equal(calls.length,0);
    const grant=await db.prepare('SELECT * FROM output_execution_grants').first();
    const slot=await db.prepare('SELECT * FROM output_operation_slots').first();
    const job=await db.prepare('SELECT * FROM document_jobs').first();
    assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,1);
    assert.equal(slot.maximum_calls,1);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);
    assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(job.status,'queued');
    assert.deepEqual(await all(db,'SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes'),
      [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
    const admissionRows=await rowsSnapshot(db,exported.tables);assert.equal((await f.execute()).replayed,true);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),admissionRows);
    const run=await freshRun(f);await run.queue();const finished=await run.drive();
    assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,1);
    const providerCalls=await all(db,'SELECT * FROM output_provider_calls');assert.equal(providerCalls.length,1);
    assert.equal(providerCalls[0].stage_key,'planning:0:initial');assert.equal(providerCalls[0].status,'settled');
    const tokens=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [tokens,cost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);
      assert.equal(reservation.operation,'document-render:short_story');assert.equal(reservation.status,'settled');
    }
    assert.equal(tokens.used_tokens,200);assert.ok(cost.used_microusd>0);assert.equal(cost.used_microusd,providerCalls[0].used_microusd);assert.equal(cost.allow_user_overage,0);
    assert.equal((await db.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_tokens,200);
    assert.equal((await db.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_microusd,cost.used_microusd);
    assert.deepEqual(await actorCounters(db),beforeActor);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').first()).n,0);
    assert.equal((await db.prepare('SELECT status FROM output_operation_slots').first()).status,'succeeded');
    assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").first()).n>0);
    const settled=await rowsSnapshot(db,financialTables);await run.drive();
    assert.deepEqual(await rowsSnapshot(db,financialTables),settled);assert.equal(calls.length,1);

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
        guarded.prepare('INSERT INTO output_atomic_assertions(token,passed) VALUES(?,1)').bind(`story-d1-rollback-${String(value)}`),
        ...outputAssertionStatements(f.env,{sql:'?',bindings:[value]}),
      ]),/CHECK constraint failed/u);
      assert.deepEqual(await rowsSnapshot(db,['output_atomic_assertions']),guardBefore);
    }
    const deniedDb=await mf.getD1Database('DENIAL_DB');await install(deniedDb,denialExported);
    const deniedGuard=tracedDatabase(deniedDb,denialTrace);inheritRuntimeSchemaReadiness(denial.env.DB,deniedGuard);denial.env.DB=deniedGuard;
    await denial.sponsor();
    const nativeAdmission=statements=>statements.some(entry=>entry.sql.startsWith('INSERT INTO output_execution_grants('));
    // Fault injection changes only the truth value of one real transaction
    // witness at the D1 boundary. Every native admission write, other proof,
    // binding and statement order remains the production-generated value.
    // Both independent guards must roll back the entire actual native batch.
    for(const witness of ['native','resource'])for(const value of [0,null]){
      const before=await rowsSnapshot(deniedDb,denialExported.tables);let injected=false;
      deniedGuard.rewriteBatch=statements=>{
        if(!nativeAdmission(statements))return null;
        const candidates=statements.map((entry,index)=>({entry,index})).filter(({entry})=>witness==='native'
          ?entry.sql.startsWith('INSERT INTO output_atomic_assertions(')&&entry.sql.includes('$.output_command_envelope.sponsor_entitlement.consumption_id')
          :entry.sql.startsWith('INSERT INTO experience_sponsor_assertions(')&&entry.sql.includes('JOIN experience_sponsor_resource_policies resources')&&String(entry.bindings[0]).startsWith('sponsor-story:'));
        assert.equal(candidates.length,1,`Exactly one actual ${witness} transaction witness is required`);
        const {entry,index}=candidates[0],start=entry.sql.indexOf('CASE WHEN ('),end=entry.sql.lastIndexOf(') THEN 1 ELSE 0 END');
        assert.ok(start>0&&end>start);injected=true;
        const replacement={sql:entry.sql.slice(0,start)+'CASE WHEN (?) THEN 1 ELSE 0 END'+entry.sql.slice(end+') THEN 1 ELSE 0 END'.length),bindings:[entry.bindings[0],value]};
        return statements.map((original,position)=>position===index?replacement:original);
      };
      await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);assert.equal(injected,true);
      assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),before);assert.equal(calls.length,1);
    }
    // Only the selected unchanged approval predicate sees the payer drift:
    // the next injected statement would restore it before any later guards.
    // Thus another repeated payer guard cannot make this check pass falsely.
    const beforePayerDrift=await rowsSnapshot(deniedDb,denialExported.tables);let payerChanged=false;
    const originalPayer=await deniedDb.prepare('SELECT updated_at FROM users WHERE user_id=?').bind(payer).first();assert.ok(originalPayer);
    deniedGuard.rewriteBatch=statements=>{
      if(!nativeAdmission(statements))return null;
      const matches=statements.map((entry,index)=>({entry,index})).filter(({entry})=>
        entry.sql.startsWith('INSERT INTO experience_sponsor_assertions(')&&entry.sql.includes('sponsor_approval_terms AS MATERIALIZED')
        &&String(entry.bindings[0]).startsWith('sponsor-story:'));
      assert.equal(matches.length,1,'Exactly one Story approval transaction witness is required');
      const index=matches[0].index;payerChanged=true;
      return [...statements.slice(0,index),{sql:"UPDATE users SET updated_at='fixture-story-payer-changed' WHERE user_id=?",bindings:[payer]},statements[index],
        {sql:'UPDATE users SET updated_at=? WHERE user_id=?',bindings:[originalPayer.updated_at,payer]},...statements.slice(index+1)];
    };
    await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);assert.equal(payerChanged,true);
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
    assert.equal(calls.length,1);assert.equal(outbound,0);
    const flattened=[...trace,...denialTrace].flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against local workerd D1',localOnly:true,success:true,schemaObjects:exported.schema.length,
      statementCount:flattened.length,maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),
      maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),
      nativePayerApproval:true,nativeAdmission:true,nativeRun:true,logicalStage:'planning:0:initial',nativeMaximumCalls:1,boundScalarTypes,
      syntheticResponses:1,actualExternalNetworkRequests:outbound,payerOnlySettlement:true,
      admissionReplayUnchanged:true,settlementReplayUnchanged:true,falseAndNullWitnessRollback:true,
      composedNativeAndResourceFalseNullRollback:true,composedPayerDriftAtomicRollback:true,lateCampaignWithdrawalAtomicRollback:true};
    await writeFile('/private/tmp/forma-sponsor-story-d1-evidence.json',JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }catch(error){
    await writeFile('/private/tmp/forma-sponsor-story-d1-failed-trace.json',JSON.stringify({error:String(error),trace,denialTrace},null,2)+'\n');
    throw error;
  }finally{await mf.dispose();}
});
