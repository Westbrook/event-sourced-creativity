import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {fixture,trapEgress,actor,payer,canonicalJson,digest} from './sponsor-audio-server-native-fixture.mjs';
import {prepareSponsorAudioAuthorize,readSponsorAudioAuthorizationResponse} from '../src/experiences/sponsor-audio-review-transport.ts';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const evidencePath='/private/tmp/forma-audio-server-d1-evidence.json';
const queryLimits={functionArguments:32,parameters:100,sqlBytes:100_000};
const issuance=statements=>statements.some(({sql})=>sql.startsWith('INSERT INTO experience_sponsor_issuances('));
const admission=statements=>statements.some(({sql})=>sql.startsWith('INSERT INTO output_execution_grants('));
const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
const count=async(db,table)=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const actorCounters=async db=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async table=>
  [table,await all(db,`SELECT * FROM ${table} WHERE scope='user' AND scope_id=? ORDER BY rowid`,actor)])));

// Execute the application's original prepared statements and preserve real D1
// acknowledgements. Only the separately labelled refusal probe changes one
// assertion predicate, immediately before submitting that actual transaction.
function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=queryLimits.parameters);
    assert.ok(Buffer.byteLength(sql)<=queryLimits.sqlBytes);
    return {sql,bindings:[...bindings]};
  };
  const check=sql=>{
    if(wrapped.readOnly)assert.ok(/^\s*(?:SELECT|WITH)\b/iu.test(sql)&&! /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/iu.test(sql),
      'Passive review must execute read-only SQL');
    if(wrapped.retainedOnly)assert.ok(!/(?:FROM|JOIN)\s+output_preflights\b/iu.test(sql)
      &&! /INSERT\s+INTO\s+(?:experience_sponsor_(?:grants|issuances|resource_receipts|consumptions)|output_execution_grants)/iu.test(sql),
    'Exact original replay must precede fresh quote, issuance and admission capacity');
  };
  const wrap=(sql,bindings=[])=>{
    check(sql);
    const original=db.prepare(sql).bind(...bindings),statement={sql,bindings,bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      check(sql);const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
      try{return await original[method](...args);}catch(error){entry.failure=String(error);throw error;}
    };
    originals.set(statement,{original,sql,bindings});return statement;
  };
  const wrapped={readOnly:false,retainedOnly:false,rewriteBatch:null,prepare:sql=>wrap(sql),batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value,'Batch must retain original prepared statements');check(value.sql);return value;});
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

async function noRun(db,f){
  assert.equal(await count(db,'output_provider_calls'),0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='run'").first()).n,0);
  for(const job of await all(db,'SELECT * FROM document_jobs')){assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);}
  assert.deepEqual(f.effects,{media:0,assets:0,detached:0});
}

test('dormant Audio review and actual supplied authorization issue and admit once on local workerd D1, with atomic false/NULL refusal',{timeout:180_000},async t=>{
  const network=trapEgress(t);
  // Transfer only genuine registered ordinary intake, confirmed plan, retained
  // quote and disposable schema. Actual payer approval and every new operation
  // below use workerd D1; there is no fixture-seeded sponsor grant or issuance.
  const f=await fixture(t,{approve:false,strict:false}),denial=await fixture(t,{approve:false,strict:false});
  const exported=exportSynthetic(f.sqlite),denialExported=exportSynthetic(denial.sqlite);
  const trace=[],denialTrace=[];let limits,denialLimits,mf,externalNetworkRequests=0,phase='local-runtime-setup';
  try{
    mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
      log:new Log(LogLevel.NONE),d1Databases:['DB','DENIAL_DB'],
      script:'export default {fetch(){return new Response("synthetic dormant Audio server D1 qualification only")}}',
      outboundService(){externalNetworkRequests++;throw Error('Audio server external network forbidden');}});
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    limits=enforceD1ExpressionDepth(f,{queryLimits});phase='application-qualification';
    const beforeActor=await actorCounters(db);await f.approve();
    for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_consumptions','output_execution_grants','document_jobs'])
      assert.equal(await count(db,table),0,table);
    const beforeReview=await rowsSnapshot(db,exported.tables),reviewStart=trace.length;guarded.readOnly=true;
    let shown,again;
    try{shown=await f.readReview();again=await f.readReview();}finally{guarded.readOnly=false;}
    assert.equal(canonicalJson(shown),canonicalJson(again),'Passive reload must retain original review deadline and digest');
    assert.equal(shown.binding.documentId,f.documentId);assert.equal(shown.binding.draftId,f.draftId);assert.equal(shown.review.payerUserId,payer);
    assert.equal(shown.review.termsDigest,f.terms.termsDigest);assert.equal(canonicalJson(shown.review.preview),canonicalJson(f.terms.targets[0].settings.costPreview));
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeReview);
    const reviewStatements=trace.slice(reviewStart).flatMap(entry=>entry.statements??[entry]);
    assert.ok(reviewStatements.some(({sql})=>/output_preflights/u.test(sql)));
    assert.ok(reviewStatements.some(({sql})=>/experience_sponsor_approvals/u.test(sql)));
    await noRun(db,f);

    const body=f.actorBody(shown),request=f.actorRequest(body),message=await prepareSponsorAudioAuthorize(shown,body),authorizationStart=trace.length;
    const ack=await f.authorize(body,{request});assert.equal(ack.replayed,false);assert.equal(request.bodyUsed,false);
    assert.equal(canonicalJson(await readSponsorAudioAuthorizationResponse(ack,shown,message)),canonicalJson(ack));
    const native=await db.prepare('SELECT * FROM output_execution_grants').first(),issued=await db.prepare('SELECT * FROM experience_sponsor_issuances').first();
    assert.ok(native);assert.ok(issued);assert.equal(ack.grantId,native.grant_id);assert.notEqual(ack.grantId,issued.grant_id);
    assert.equal(native.actor_user_id,actor);assert.equal(native.payer_user_id,payer);assert.equal(ack.jobId,shown.review.preview.requestId);
    assert.equal(ack.actorRequestDigest,await digest(body));assert.equal(issued.driver_command_json,canonicalJson(body));
    const receipt=await db.prepare("SELECT command.*,body.private_json FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id WHERE command.action='authorize'").first();
    assert.ok(receipt);assert.equal(ack.receipt.key,receipt.command_key);assert.equal(ack.receipt.eventId,receipt.event_id);assert.equal(ack.receipt.requestDigest,receipt.request_digest);
    const marker=JSON.parse(receipt.private_json).output_command_envelope.sponsor_entitlement;
    assert.equal(canonicalJson(marker.audio_actor_intent.request),canonicalJson(body));assert.equal(marker.audio_actor_intent.reviewDigest,shown.reviewDigest);
    assert.notEqual(ack.receipt.requestDigest,ack.actorRequestDigest.slice(7));
    for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_consumptions','output_execution_grants',
      'output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations'])assert.equal(await count(db,table),1,table);
    for(const table of ['budget_reservations','cost_budget_reservations'])assert.equal((await db.prepare(`SELECT owner_id FROM ${table}`).first()).owner_id,payer);
    const stage=await db.prepare("SELECT command_json FROM experience_sponsor_driver_stages WHERE stage='authorize'").first();assert.ok(stage);
    const retained=JSON.parse(stage.command_json);assert.equal(retained.expectedRevision,f.command.expectedRevision);assert.equal(retained.preflightId,f.terms.id);
    assert.equal(canonicalJson(retained.audioCostConsent),canonicalJson(body.audioCostConsent));
    assert.ok(trace.slice(authorizationStart).some(entry=>entry.kind==='batch'&&issuance(entry.statements)));
    assert.ok(trace.slice(authorizationStart).some(entry=>entry.kind==='batch'&&admission(entry.statements)));
    assert.deepEqual(await actorCounters(db),beforeActor);await noRun(db,f);
    const beforeReplay=await rowsSnapshot(db,exported.tables);guarded.retainedOnly=true;
    let replay;try{replay=await f.authorize(structuredClone(body));}finally{guarded.retainedOnly=false;}
    assert.equal(replay.replayed,true);assert.equal(canonicalJson({...replay,replayed:false}),canonicalJson(ack));
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeReplay);assert.equal(await count(db,'experience_sponsor_consumptions'),f.policy.maximumAdmissions);
    await noRun(db,f);
    const boundScalarTypes=await guarded.prepare('SELECT typeof(?) AS number_type,typeof(?) AS string_type,typeof(?) AS null_type').bind(1,'1',null).first();
    assert.deepEqual(boundScalarTypes,{number_type:'real',string_type:'text',null_type:'null'});

    const deniedDb=await mf.getD1Database('DENIAL_DB');await install(deniedDb,denialExported);
    const deniedGuard=tracedDatabase(deniedDb,denialTrace);inheritRuntimeSchemaReadiness(denial.env.DB,deniedGuard);denial.env.DB=deniedGuard;
    denialLimits=enforceD1ExpressionDepth(denial,{queryLimits});await denial.approve();
    const deniedShown=await denial.readReview(),deniedBody=denial.actorBody(deniedShown),rollback=[];
    for(const value of [0,null]){
      let injected=false,beforeCommit;const traceStart=denialTrace.length;
      deniedGuard.rewriteBatch=async statements=>{
        if(!issuance(statements))return null;
        assert.equal(injected,false,'One actual issuance transaction is attempted');
        const issuanceIndex=statements.findIndex(({sql})=>sql.startsWith('INSERT INTO experience_sponsor_issuances('));
        const candidates=statements.map((entry,index)=>({entry,index})).filter(({entry,index})=>index>issuanceIndex
          &&entry.sql.startsWith('INSERT INTO output_atomic_assertions(')&&entry.sql.includes('CASE WHEN ('));
        assert.ok(candidates.length>0,'Closing native issuer assertions must follow actual immutable issuance writes');
        const {entry,index}=candidates.at(-1),start=entry.sql.indexOf('CASE WHEN ('),end=entry.sql.lastIndexOf(') THEN 1 ELSE 0 END');
        assert.ok(start>0&&end>start);assert.equal((entry.sql.slice(0,start).match(/\?/gu)??[]).length,1);
        assert.equal((entry.sql.slice(end+') THEN 1 ELSE 0 END'.length).match(/\?/gu)??[]).length,0);
        beforeCommit=await rowsSnapshot(deniedDb,denialExported.tables);injected=true;
        const replacement={sql:entry.sql.slice(0,start)+'CASE WHEN (?) THEN 1 ELSE 0 END'+entry.sql.slice(end+') THEN 1 ELSE 0 END'.length),bindings:[entry.bindings[0],value]};
        return statements.map((original,position)=>position===index?replacement:original);
      };
      await assert.rejects(denial.authorize(structuredClone(deniedBody)));assert.equal(injected,true);
      assert.ok(denialTrace.slice(traceStart).some(entry=>entry.kind==='batch'&&issuance(entry.statements)&&entry.failure?.includes('CHECK constraint failed')),
        'False or NULL must fail the actual workerd transaction, not a fabricated response');
      assert.deepEqual(await rowsSnapshot(deniedDb,denialExported.tables),beforeCommit,
        'The real failed issuer transaction must roll back every row while retaining earlier driver intent');
      rollback.push({value,atomic:true});await noRun(deniedDb,denial);
    }
    deniedGuard.rewriteBatch=null;
    for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts','experience_sponsor_consumptions',
      'output_execution_grants','document_jobs','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal(await count(deniedDb,table),0,table);
    limits.assertVerified();denialLimits.assertVerified();assert.equal(externalNetworkRequests,0);assert.deepEqual(network,[]);
    const statements=[...trace,...denialTrace].flatMap(entry=>entry.statements??[entry]);
    const evidence={success:true,engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against actual local workerd D1',
      builtWorkerHttp:false,localOnly:true,registeredOrdinaryAudioSource:true,nativePayerApproval:true,fixtureSeededIssuance:false,
      passiveReadOnlyReview:true,actualSuppliedRequest:true,nativeIssuer:true,nativeAdmission:true,nativeRun:false,
      exactReplayBeforeFreshQuoteAndCapacity:true,exactReplayUnchanged:true,payerOnlyReservations:true,issuerFalseAndNullAtomicRollback:rollback,
      schemaObjects:exported.schema.length,statementCount:statements.length,uniqueExecutedSqlShapes:new Set(statements.map(entry=>entry.sql)).size,
      strictCompilerStatements:limits.records.length+denialLimits.records.length,expressionDepthLimit:100,functionArgumentLimit:32,parameterLimit:100,sqlByteLimit:100000,
      maximumBindings:Math.max(...statements.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...statements.map(entry=>Buffer.byteLength(entry.sql))),
      boundScalarTypes,externalNetworkRequests,interceptedNetworkRequests:network.length,mediaCalls:0,detachedWork:0,publicActivation:false,
      appRecordedCostIsProviderInvoice:false,trace,denialTrace};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
    const {trace:omitted,denialTrace:omittedDenial,...summary}=evidence;void omitted;void omittedDenial;t.diagnostic(JSON.stringify(summary));
  }catch(error){
    const failed={success:false,phase,error:String(error),stack:error?.stack,externalNetworkRequests,interceptedNetworkRequests:network.length,
      compilerRecords:limits?.records,compilerFailures:limits?.failures,denialCompilerRecords:denialLimits?.records,denialCompilerFailures:denialLimits?.failures,trace,denialTrace};
    const failurePath=`/private/tmp/forma-audio-server-d1-${phase==='local-runtime-setup'?'setup':'qualification'}-failed-${Date.now()}.json`;
    await writeFile(failurePath,JSON.stringify(failed,null,2)+'\n',{flag:'wx'});
    await writeFile(evidencePath,JSON.stringify({...failed,preservedFailure:failurePath},null,2)+'\n');
    t.diagnostic(`Preserved ${phase} failure: ${failurePath}`);throw error;
  }finally{limits?.restore();denialLimits?.restore();await mf?.dispose();}
});
