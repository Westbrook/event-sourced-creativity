import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {fixture,freshRun,transport,originalFetch,actor,payer,stream,approveSponsorCampaign,post,headers} from './sponsor-audio-v8-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
const {recoverOutputAudio}=await import('../worker/output-audio-recovery.ts');
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const evidencePath='/private/tmp/forma-audio-v8-d1-evidence.json';
const queryLimits={functionArguments:32,parameters:100,sqlBytes:100_000};
const audioModel='fal-ai/stable-audio-3/medium/text-to-audio';
const financialTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'];
const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
const actorCounters=async db=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async name=>
  [name,await all(db,`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`,actor)])));

// Observe genuine workerd statements/results. Fault injection below only changes
// one existing native assertion's truth value, retaining every other admission
// statement and binding so the actual application transaction must roll back.
function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=queryLimits.parameters,`D1 parameter limit exceeded: ${bindings.length}`);
    assert.ok(Buffer.byteLength(sql)<=queryLimits.sqlBytes,`D1 SQL byte limit exceeded: ${Buffer.byteLength(sql)}`);
    return {sql,bindings:[...bindings]};
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

test('native V8 Audio approval, initial planning and media, payer settlement and atomic refusal run on local workerd D1',{timeout:180_000},async t=>{
  let externalNetworkRequests=0,localProxyRequests=0;
  const localFetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
    localProxyRequests++;return originalFetch(input,{...init,redirect:'error'});
  };
  const calls=transport(t,{localFetch});
  // All native quotes and disposable schemas exist before the exact transfer.
  // Payer approval, explicit fixture issuance, admission, Run and Events use D1.
  const f=await fixture(t,{sponsor:false}),denial=await fixture(t,{sponsor:false}),recovery=await fixture(t,{sponsor:false});
  const exported=exportSynthetic(f.sqlite),denialExported=exportSynthetic(denial.sqlite),recoveryExported=exportSynthetic(recovery.sqlite);
  assert.equal(calls.length,0,'Native quote preparation must not dispatch a provider');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB','DENIAL_DB','RECOVERY_DB'],
    script:'export default {fetch(){return new Response("synthetic Audio V8 D1 qualification only")}}',
    outboundService(){externalNetworkRequests++;throw Error('Audio V8 external network forbidden');}});
  const trace=[],denialTrace=[],recoveryTrace=[];let limits,denialLimits,recoveryLimits;
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    limits=enforceD1ExpressionDepth(f,{queryLimits});
    const beforeActor=await actorCounters(db);await f.sponsor();
    const beforeApprovalReplay=await rowsSnapshot(db,exported.tables);
    await approveSponsorCampaign(new Request('http://localhost/__fixture/audio-approval',post(f.approvalCommand,headers(payer))),f.env);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeApprovalReplay,'Exact authenticated payer approval replay must not write or re-approve');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_approvals').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').first()).n,0);
    const admitted=await f.execute();assert.equal(admitted.replayed,false);assert.equal(calls.length,0);
    const grant=await db.prepare('SELECT * FROM output_execution_grants').first();
    const slot=await db.prepare('SELECT * FROM output_operation_slots').first();
    const job=await db.prepare('SELECT * FROM document_jobs').first();
    assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.maximum_calls,3);
    assert.equal(slot.maximum_calls,3);assert.equal(slot.maximum_tokens,128000);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);
    assert.equal(job.kind,'render_document');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);assert.equal(job.status,'queued');
    assert.deepEqual(await all(db,'SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes ORDER BY stage_key'),[
      {stage_key:'audio:initial',provider:'fal',model:audioModel,maximum_calls:1},
      {stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1},
      {stage_key:'planning:0:repair',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1},
    ]);
    const admittedRows=await rowsSnapshot(db,exported.tables);assert.equal((await f.replayAdmission()).kind,'retained');
    assert.deepEqual(await rowsSnapshot(db,exported.tables),admittedRows);
    const admittedConsumption=await rowsSnapshot(db,['experience_sponsor_consumptions']);
    const run=await freshRun(f);await run.queue();const finished=await run.drive();
    assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(calls.length,5);
    const paidCalls=calls.filter(call=>call.method==='POST');assert.equal(paidCalls.length,2);
    assert.deepEqual(calls.map(call=>call.method),['POST','POST','GET','GET','GET']);
    const providerCalls=await all(db,'SELECT * FROM output_provider_calls ORDER BY rowid');assert.equal(providerCalls.length,2);
    assert.deepEqual(providerCalls.map(call=>({stage:call.stage_key,provider:call.provider,model:call.model,status:call.status})),[
      {stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',status:'settled'},
      {stage:'audio:initial',provider:'fal',model:audioModel,status:'settled'},
    ]);
    const retainedInput=await db.prepare("SELECT content.content FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id JOIN private_content content ON content.content_id=json_extract(body.private_json,'$.input_ref') WHERE event.type='DocumentRenderCompleted' AND body.document_id=? AND body.owner_id=? AND content.kind='document-artifact-input'").bind(f.documentId,actor).first();assert.ok(retainedInput);
    const completedInput=JSON.parse(retainedInput.content);
    for(const [index,call] of providerCalls.entries()){
      if(call.provider==='openai')assert.equal(call.client_request_id,paidCalls[index].clientRequestId);
      else{
        assert.equal(paidCalls[index].clientRequestId,null,'Fal does not send the native client identity as an HTTP header');
        assert.equal(completedInput.output_audio_request.clientRequestId,call.client_request_id);
        assert.equal(completedInput.output_audio_request.requestDigest,call.request_digest);
        assert.equal(completedInput.output_audio_request.requestBody,paidCalls[index].requestBody);
      }
      const retainedCall=completedInput.output_audio_calls.find(receipt=>receipt.clientRequestId===call.client_request_id);assert.ok(retainedCall);
      assert.equal(retainedCall.clientRequestId,call.client_request_id);assert.equal(retainedCall.providerRequestId,call.provider_response_id);
      assert.equal(call.request_digest,createHash('sha256').update(paidCalls[index].requestBody).digest('hex'));
      assert.ok(Number.isSafeInteger(call.used_microusd)&&call.used_microusd>0);
    }
    const tokens=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [tokens,cost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);
      assert.equal(reservation.operation,'document-render:audio');assert.equal(reservation.status,'settled');
    }
    assert.equal(tokens.reserved_tokens,128000);assert.equal(tokens.used_tokens,150);
    assert.equal(cost.used_microusd,providerCalls.reduce((sum,call)=>sum+call.used_microusd,0));assert.equal(cost.allow_user_overage,0);
    assert.deepEqual(await actorCounters(db),beforeActor);
    for(const [scope,id] of [['user',payer],['workspace','forma']])for(const [table,currency,used] of [
      ['budget_counters','tokens',150],['cost_budget_counters','microusd',cost.used_microusd],
    ]){
      const counter=await db.prepare(`SELECT reserved_${currency} AS reserved,used_${currency} AS used FROM ${table} WHERE scope=? AND scope_id=?`).bind(scope,id).first();
      assert.equal(counter.reserved,0);assert.equal(counter.used,used);
    }
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_active_jobs').first()).n,0);
    assert.equal((await db.prepare('SELECT status FROM output_operation_slots').first()).status,'succeeded');
    assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").first()).n>0);
    assert.deepEqual(await rowsSnapshot(db,['experience_sponsor_consumptions']),admittedConsumption,
      'Skipping optional repair must retain the original immutable authorization ceiling');
    const settled=await rowsSnapshot(db,financialTables);await run.drive();
    assert.deepEqual(await rowsSnapshot(db,financialTables),settled);assert.equal(calls.length,5);
    const boundScalarTypes=await guarded.prepare('SELECT typeof(?) AS number_type,typeof(?) AS string_type,typeof(?) AS null_type').bind(1,'1',null).first();
    assert.deepEqual(boundScalarTypes,{number_type:'real',string_type:'text',null_type:'null'});

    const deniedDb=await mf.getD1Database('DENIAL_DB');await install(deniedDb,denialExported);
    const deniedGuard=tracedDatabase(deniedDb,denialTrace);inheritRuntimeSchemaReadiness(denial.env.DB,deniedGuard);denial.env.DB=deniedGuard;
    denialLimits=enforceD1ExpressionDepth(denial,{queryLimits});await denial.sponsor();
    const nativeAdmission=statements=>statements.some(({sql})=>sql.startsWith('INSERT INTO output_execution_grants('));
    for(const value of [0,null]){
      const before=await rowsSnapshot(deniedDb,denialExported.tables),traceStart=denialTrace.length;let injected=false;
      deniedGuard.rewriteBatch=statements=>{
        if(!nativeAdmission(statements))return null;
        const candidates=statements.map((entry,index)=>({entry,index})).filter(({entry})=>
          entry.sql.startsWith('INSERT INTO output_atomic_assertions(')&&entry.sql.includes('$.output_command_envelope.sponsor_entitlement.consumption_id'));
        assert.equal(candidates.length,1,'Exactly one actual native admission receipt assertion must be tested');
        const {entry,index}=candidates[0],start=entry.sql.indexOf('CASE WHEN ('),end=entry.sql.lastIndexOf(') THEN 1 ELSE 0 END');
        assert.ok(start>0&&end>start);injected=true;
        const replacement={sql:entry.sql.slice(0,start)+'CASE WHEN (?) THEN 1 ELSE 0 END'+entry.sql.slice(end+') THEN 1 ELSE 0 END'.length),bindings:[entry.bindings[0],value]};
        return statements.map((original,position)=>position===index?replacement:original);
      };
      await assert.rejects(denial.execute(),/output_revision_or_authority_changed/u);assert.equal(injected,true);
      assert.ok(denialTrace.slice(traceStart).some(entry=>entry.kind==='batch'&&nativeAdmission(entry.statements)&&entry.failure?.includes('CHECK constraint failed')),
        'A refused assertion must fail the real workerd D1 transaction');
      assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),before);assert.equal(calls.length,5);
    }
    deniedGuard.rewriteBatch=null;
    for(const table of ['output_execution_grants','document_jobs','output_operation_slots','experience_sponsor_consumptions','budget_reservations','cost_budget_reservations'])
      assert.equal((await deniedDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0,table);
    const recoveryDb=await mf.getD1Database('RECOVERY_DB');await install(recoveryDb,recoveryExported);
    const recoveryGuard=tracedDatabase(recoveryDb,recoveryTrace);inheritRuntimeSchemaReadiness(recovery.env.DB,recoveryGuard);recovery.env.DB=recoveryGuard;
    recoveryLimits=enforceD1ExpressionDepth(recovery,{queryLimits});const recoveryActor=await actorCounters(recoveryDb);
    const originalCalls=transport(t,{localFetch,resultFailure:true});await recovery.sponsor();await recovery.execute();const recoveryRun=await freshRun(recovery);await recoveryRun.queue();
    const failed=await recoveryRun.drive();assert.equal(failed.status,'failed',JSON.stringify(failed));assert.equal(originalCalls.filter(call=>call.method==='POST').length,2);
    assert.equal((await recoveryDb.prepare("SELECT used_microusd FROM output_provider_calls WHERE provider='fal'").first()).used_microusd,null);
    assert.equal((await recoveryDb.prepare('SELECT status FROM cost_budget_reservations').first()).status,'executing');
    const beforeOriginal=(await recoveryDb.prepare('SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs').first()),recoveredCalls=transport(t,{localFetch}),financialTraceStart=recoveryTrace.length;
    const recovered=await recoverOutputAudio(recovery.env,recoveryRun.trusted.principal,beforeOriginal,{assertions:recoveryRun.trusted.sourceAssertions});
    assert.equal(recovered.status,'completed');assert.deepEqual(recoveredCalls.map(call=>call.method),['GET','GET','GET']);
    const recoveredMedia=await recoveryDb.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").first();assert.equal(recoveredMedia.used_microusd,37600);assert.equal(recoveredMedia.status,'settled');
    assert.equal((await recoveryDb.prepare('SELECT status FROM cost_budget_reservations').first()).status,'settled');
    assert.deepEqual(await actorCounters(recoveryDb),recoveryActor);assert.equal((await recoveryDb.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').first()).n,1);
    const recoveryStatements=recoveryTrace.slice(financialTraceStart).flatMap(entry=>entry.statements??[entry]);
    assert.ok(recoveryStatements.some(entry=>entry.sql.includes('output_provider_calls')&&entry.sql.includes('request_digest')),'Actual original-call recovery financial predicate must execute on D1');
    const observedFinancial=recoveryTrace.slice(financialTraceStart).filter(entry=>entry.kind==='batch'&&entry.statements.some(statement=>statement.sql.includes("'$.providerSubmissions') IN(json(?),json(?))")));
    assert.equal(observedFinancial.length,1,'The actual newly observed original-result financial checkpoint must run on D1');
    assert.ok(observedFinancial[0].statements.every(statement=>!/(?:event_private_payloads|private_content|request_json|SELECT\s+\*\s+FROM\s+document_jobs)/iu.test(statement.sql)),'Known original cost checkpoint must be free of creative/source body reads');
    const settledRecovery=await rowsSnapshot(recoveryDb,financialTables),completedOriginal=await recoveryDb.prepare('SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs').first();
    assert.equal((await recoverOutputAudio(recovery.env,recoveryRun.trusted.principal,completedOriginal,{assertions:recoveryRun.trusted.sourceAssertions})).replayed,true);
    assert.deepEqual(await rowsSnapshot(recoveryDb,financialTables),settledRecovery);assert.equal(recoveredCalls.length,3);
    limits.assertVerified();denialLimits.assertVerified();recoveryLimits.assertVerified();assert.equal(externalNetworkRequests,0);assert.ok(Number.isSafeInteger(localProxyRequests)&&localProxyRequests>=0);
    const statements=[...trace,...denialTrace,...recoveryTrace].flatMap(entry=>entry.statements??[entry]);
    const evidence={success:true,engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against local workerd D1',
      builtWorkerHttp:false,localOnly:true,localProxyObservation:'Global fetch counts only intercepted calls; Miniflare internal proxy may use its own transport',schemaObjects:exported.schema.length,statementCount:statements.length,
      strictCompilerStatements:limits.records.length+denialLimits.records.length+recoveryLimits.records.length,expressionDepthLimit:100,functionArgumentLimit:32,
      maximumBindings:Math.max(...statements.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...statements.map(entry=>Buffer.byteLength(entry.sql))),boundScalarTypes,
      nativePayerApproval:true,explicitSyntheticIssuance:true,nativeAdmission:true,nativeRun:true,nativeEvents:true,
      logicalStages:['planning:0:initial','audio:initial'],nativeMaximumCalls:3,sharedMaximumTokens:128000,optionalRepairSkipped:true,
      syntheticPaidCalls:paidCalls.length,syntheticNetworkResponses:calls.length,externalNetworkRequests,localProxyRequests,payerOnlySettlement:true,
      immutableConsumptionCeiling:true,unusedCeilingsReleased:true,exactCapturedWireMatchesDurableLedger:true,
      admissionReplayUnchanged:true,settlementReplayUnchanged:true,nativeFalseAndNullAssertionAtomicRollback:true,exactPayerApprovalReplay:true,originalUnknownFalResultRecovered:true,recoveryFinancialPredicateD1:true,recoveryGetOnly:true,recoveryReplayUnchanged:true,
      appRecordedCostIsProviderInvoice:false,publicActivation:false,trace,denialTrace,recoveryTrace};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
    const {trace:omitted,denialTrace:omittedDenial,recoveryTrace:omittedRecovery,...summary}=evidence;void omitted;void omittedDenial;void omittedRecovery;t.diagnostic(JSON.stringify(summary));
  }catch(error){
    const failed={success:false,error:String(error),stack:error?.stack,externalNetworkRequests,localProxyRequests,
      compilerRecords:limits?.records,compilerFailures:limits?.failures,denialCompilerRecords:denialLimits?.records,
      denialCompilerFailures:denialLimits?.failures,recoveryCompilerRecords:recoveryLimits?.records,recoveryCompilerFailures:recoveryLimits?.failures,trace,denialTrace,recoveryTrace};
    const failurePath=`/private/tmp/forma-audio-v8-d1-failed-${Date.now()}.json`;
    await writeFile(failurePath,JSON.stringify(failed,null,2)+'\n',{flag:'wx'});
    await writeFile(evidencePath,JSON.stringify({...failed,preservedFailure:failurePath},null,2)+'\n');
    t.diagnostic(`Preserved failure: ${failurePath}`);throw error;
  }finally{limits?.restore();denialLimits?.restore();recoveryLimits?.restore();await mf.dispose();}
});
