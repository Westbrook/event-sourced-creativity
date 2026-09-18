import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture,trapEgress,actor,payer,canonicalJson} from './sponsor-audio-server-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const evidencePath='/private/tmp/forma-audio-server-ack-d1-evidence.json';
const queryLimits={functionArguments:32,parameters:100,sqlBytes:100_000};
const sources=['worker/output-requirements-api.ts','worker/output-audio-sponsored-handoff.ts',
  'worker/experience-sponsor-audio-review.ts','worker/experience-sponsor-audio-issuer.ts','worker/experience-sponsor-audio-authorize.ts'];
const sourcePins=async()=>Object.fromEntries(await Promise.all(sources.map(async path=>
  [path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')])));
const isAck=sql=>/FROM output_operation_slots slot JOIN output_execution_grants execution/u.test(sql);
const observedCurrent=result=>result?.results?.map(row=>row.current)??[];

// These are original D1 statements and acknowledgements. No SQL replacement,
// fabricated proof result, provider responder or application write is allowed.
function replayDatabase(db,trace){
  const originals=new WeakMap();
  const check=(sql,bindings=[])=>{
    assert.ok(/^\s*(?:SELECT|WITH)\b/iu.test(sql)&&! /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/iu.test(sql),'Replay is read-only');
    assert.ok(!/(?:FROM|JOIN)\s+output_preflights\b/iu.test(sql),'Original replay precedes fresh quote preparation');
    assert.ok(bindings.length<=queryLimits.parameters);assert.ok(Buffer.byteLength(sql)<=queryLimits.sqlBytes);
  };
  const wrap=(sql,bindings=[])=>{
    check(sql,bindings);
    const original=db.prepare(sql).bind(...bindings),statement={sql,bindings,bind:(...values)=>wrap(sql,values)};
    originals.set(statement,{original,sql,bindings});
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      const entry={kind:method,sql,bindings:[...bindings]};trace.push(entry);
      try{const result=await original[method](...args);if(isAck(sql))entry.ackCurrent=method==='first'?[result?.current]:observedCurrent(result);return result;}
      catch(error){entry.failure=String(error);throw error;}
    };
    return statement;
  };
  return {prepare:sql=>wrap(sql),batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value,'Original prepared statement required');return value;});
    const entry={kind:'batch',statements:values.map(({sql,bindings})=>({sql,bindings:[...bindings]}))};trace.push(entry);
    try{
      const results=await db.batch(values.map(value=>value.original));
      for(const [index,value] of values.entries())if(isAck(value.sql))entry.statements[index].ackCurrent=observedCurrent(results[index]);
      return results;
    }catch(error){entry.failure=String(error);throw error;}
  }};
}

test('Audio authorization ACK replay verifies actual native payer and authorization event on local workerd D1',{timeout:120_000},async t=>{
  const network=trapEgress(t),pins=await sourcePins(),trace=[],cases=[];
  // Actual registered ordinary source, review, supplied actor POST, issuer and
  // admission run once on disposable SQLite. D1 qualification below covers
  // only replay reads and the affected final ACK proof, not those transactions.
  const f=await fixture(t,{approve:true,strict:false}),shown=await f.readReview(),body=f.actorBody(shown);
  const admitted=await f.authorize(body);assert.equal(admitted.replayed,false);
  const exported=exportSynthetic(f.sqlite);let mf,limits,externalNetworkRequests=0,phase='local-runtime-setup';
  try{
    mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
      script:'export default {fetch(){return new Response("synthetic Audio ACK replay proof only")}}',
      outboundService(){externalNetworkRequests++;throw Error('Audio ACK external network forbidden');}});
    const db=await mf.getD1Database('DB');await install(db,exported);
    const wrapped=replayDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,wrapped);f.env.DB=wrapped;
    limits=enforceD1ExpressionDepth(f,{queryLimits});phase='replay-proof-qualification';
    const baseline=await rowsSnapshot(db,exported.tables),native=await db.prepare('SELECT * FROM output_execution_grants').first();
    assert.ok(native);assert.equal(native.grant_id,admitted.grantId);assert.equal(native.payer_user_id,payer);assert.equal(native.authorization_event_id,admitted.receipt.eventId);
    const foreignEvent=await db.prepare('SELECT event_id FROM events WHERE event_id<>? ORDER BY sequence LIMIT 1').bind(native.authorization_event_id).first();
    assert.ok(foreignEvent);assert.notEqual(actor,payer);
    const replay=async(name,accepted)=>{
      const before=await rowsSnapshot(db,exported.tables),start=trace.length,request=f.actorRequest(structuredClone(body));
      if(accepted){
        const ack=await f.authorize(body,{request});assert.equal(ack.replayed,true);
        assert.equal(canonicalJson({...ack,replayed:false}),canonicalJson(admitted));
      }else await assert.rejects(f.authorize(body,{request}));
      assert.equal(request.bodyUsed,false,'Each replay keeps the actual original Request unconsumed');
      assert.deepEqual(await rowsSnapshot(db,exported.tables),before,'Replay must leave every row unchanged after any intentional fixture mutation');
      const statements=trace.slice(start).flatMap(entry=>entry.statements??[entry]),affected=statements.filter(entry=>isAck(entry.sql));
      assert.ok(affected.length>0,'Actual D1 must execute the affected final ACK lineage proof');
      assert.ok(affected.every(({sql})=>sql.includes('execution.payer_user_id=?')&&sql.includes('execution.authorization_event_id=?')),
        'The affected proof must pin both native execution lineage fields');
      assert.ok(affected.some(entry=>entry.ackCurrent?.includes(accepted?1:0)),'Record the real D1 predicate result');
      cases.push({name,accepted,rowsUnchanged:true,affectedAckProofs:affected.length,ackCurrents:affected.flatMap(entry=>entry.ackCurrent??[])});
    };
    await replay('original admission',true);
    // Actor is already a genuine fixture principal, so this is a real alternate
    // payer row value rather than a missing-principal or foreign-key probe.
    await db.prepare('UPDATE output_execution_grants SET payer_user_id=? WHERE grant_id=?').bind(actor,native.grant_id).run();
    assert.equal((await db.prepare('SELECT payer_user_id FROM output_execution_grants WHERE grant_id=?').bind(native.grant_id).first()).payer_user_id,actor);
    await replay('different existing principal as native payer',false);
    await db.prepare('UPDATE output_execution_grants SET payer_user_id=? WHERE grant_id=?').bind(payer,native.grant_id).run();
    await db.prepare('UPDATE output_execution_grants SET authorization_event_id=? WHERE grant_id=?').bind(foreignEvent.event_id,native.grant_id).run();
    assert.equal((await db.prepare('SELECT authorization_event_id FROM output_execution_grants WHERE grant_id=?').bind(native.grant_id).first()).authorization_event_id,foreignEvent.event_id);
    await replay('different existing authorization event',false);
    await db.prepare('UPDATE output_execution_grants SET authorization_event_id=? WHERE grant_id=?').bind(native.authorization_event_id,native.grant_id).run();
    await replay('restored original lineage',true);assert.deepEqual(await rowsSnapshot(db,exported.tables),baseline);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').first()).n,0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='run'").first()).n,0);
    const job=await db.prepare('SELECT status,attempt_count FROM document_jobs').first();assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);
    assert.deepEqual(f.effects,{media:0,assets:0,detached:0});assert.equal(externalNetworkRequests,0);assert.deepEqual(network,[]);
    limits.assertVerified();assert.deepEqual(await sourcePins(),pins,'The five production sources must remain frozen during qualification');
    const statements=trace.flatMap(entry=>entry.statements??[entry]);
    const evidence={success:true,engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted production authorization replay against actual local workerd D1',
      builtWorkerHttp:false,localOnly:true,setup:'Genuine registered ordinary Audio source, payer approval, review, supplied POST, issuer and admission on disposable SQLite; admitted full snapshot imported exactly into D1',
      d1Qualification:'Read-only retained authorization replay and actual final ACK lineage predicate only',d1Issuance:false,d1Admission:false,nativeRun:false,
      sourcePins:pins,cases,allReplayRowsUnchanged:true,freshQuoteAccess:false,queryRewrite:false,syntheticProofResults:false,
      strictCompilerStatements:limits.records.length,expressionDepthLimit:100,functionArgumentLimit:32,parameterLimit:100,sqlByteLimit:100000,
      statementCount:statements.length,uniqueExecutedSqlShapes:new Set(statements.map(entry=>entry.sql)).size,
      maximumBindings:Math.max(...statements.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...statements.map(entry=>Buffer.byteLength(entry.sql))),
      externalNetworkRequests,interceptedNetworkRequests:network.length,mediaCalls:0,detachedWork:0,publicActivation:false,trace};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
    const {trace:omitted,...summary}=evidence;void omitted;t.diagnostic(JSON.stringify(summary));
  }catch(error){
    const failed={success:false,phase,error:String(error),stack:error?.stack,sourcePins:pins,cases,externalNetworkRequests,
      interceptedNetworkRequests:network.length,compilerRecords:limits?.records,compilerFailures:limits?.failures,trace};
    const path=`/private/tmp/forma-audio-server-ack-d1-${phase==='local-runtime-setup'?'setup':'qualification'}-failed-${Date.now()}.json`;
    await writeFile(path,JSON.stringify(failed,null,2)+'\n',{flag:'wx'});
    await writeFile(evidencePath,JSON.stringify({...failed,preservedFailure:path},null,2)+'\n');t.diagnostic(`Preserved ${phase} failure: ${path}`);throw error;
  }finally{limits?.restore();await mf?.dispose();}
});
