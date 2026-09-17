import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {videoRecoveryFixture} from './output-video-recovery-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
const {readOriginalOutputVideo}=await import('../worker/output-video-execution.ts');
const {captureOriginalOutputVideoFinancialAuthority,recordOriginalOutputVideoCompletedObservation,originalOutputVideoFinancialState}=await import('../worker/output-video-original-financial.ts');
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const originalFetch=globalThis.fetch;
const queryLimits={functionArguments:32,parameters:100,sqlBytes:100_000};
const evidencePath=process.env.FORMA_VIDEO_RECOVERY_D1_EVIDENCE??'/private/tmp/forma-video-recovery-financial-d1-evidence.json';
const financialTables=['document_jobs','output_execution_grants','output_operation_slots','output_operation_routes','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
const privateTables=['events','event_private_payloads','private_content','output_native_storage_writes'];
const combinedFinancialBatch=statements=>statements.some(({sql})=>sql.startsWith('UPDATE output_provider_calls SET used_microusd='))&&statements.some(({sql})=>sql.startsWith('UPDATE document_jobs SET result_json=json_patch('));

// Production functions run in Node. Every application SQL statement below runs
// against actual local workerd D1; the SQL and result objects are not replaced.
function tracedDatabase(db,trace){
 const originals=new WeakMap();
 const capture=(sql,bindings)=>{
  assert.ok(bindings.length<=queryLimits.parameters);assert.ok(Buffer.byteLength(sql)<=queryLimits.sqlBytes);
  return{sql,bindings:[...bindings]};
 };
 const wrap=(sql,bindings=[])=>{
  const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
  for(const method of ['first','all','run'])statement[method]=async(...args)=>{
   const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
   try{return await original[method](...args);}catch(error){entry.failure=String(error);throw error;}
  };
  originals.set(statement,{original,sql,bindings});return statement;
 };
 const wrapped={prepare:sql=>wrap(sql),beforeBatch:null,afterBatch:null,batch:async statements=>{
  const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
  const entry={kind:'batch',statements:values.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
  await wrapped.beforeBatch?.(entry.statements);
  let result;
  try{result=await db.batch(values.map(value=>value.original));entry.committed=true;}
  catch(error){entry.failure=String(error);throw error;}
  await wrapped.afterBatch?.(entry.statements,result);return result;
 }};
 return wrapped;
}

// The unchanged transport alone mints the opaque completed observation. Queue
// replies are synthetic, and the callback ends this read before any media GET.
async function observe(t,f,counts){
 const attempt=f.original.mediaAttempt,providerRequestId='video_original',base='https://queue.fal.run/bytedance/seedance-2.0/requests/'+providerRequestId;
 const requests=[],stop=Symbol('observed-before-media');let observation;
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(['localhost','127.0.0.1','[::1]'].includes(url.hostname)){counts.localProxyRequests++;return originalFetch(input,{...init,redirect:'error'});}
  requests.push({url:String(url),method:init.method});
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'manual');
  assert.equal(new Headers(init.headers).get('authorization'),'Key offline-video-financial-d1');
  if(String(url)===base+'/status')return Response.json({request_id:providerRequestId,status:'COMPLETED'});
  if(String(url)===base)return Response.json({request_id:providerRequestId,video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length}});
  counts.externalNetworkRequests++;throw Error('Only the two synthetic original queue GETs are allowed');
 });
 await assert.rejects(readOriginalOutputVideo(f.env,{contract:f.original.contract,requestBody:attempt.video.requestBody,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,providerRequestId},{
  onBeforeRead:async hook=>{hook.assertCurrent();},onEnvelope:async(_value,hook)=>{hook.assertCurrent();},
  onCompleted:(value,hook)=>{hook.assertCurrent();observation=value;throw stop;},
 }),error=>error===stop);
 assert.ok(observation);assert.deepEqual(requests,[{url:base+'/status',method:'GET'},{url:base,method:'GET'}]);
 counts.syntheticQueueReads+=requests.length;return observation;
}

const cases=[
 {name:'positive completed original settlement and exact replay',kind:'positive'},
 {name:'lost combined-commit acknowledgement recovers exact canonical receipt',kind:'lost-ack'},
 {name:'changed original payer rolls back financial checkpoint and call',kind:'mutation',sql:"UPDATE output_execution_grants SET payer_user_id='other-original-payer'"},
 {name:'changed original reservation amount rolls back financial checkpoint and call',kind:'mutation',sql:'UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1'},
 {name:'changed original provider receipt rolls back financial checkpoint and call',kind:'mutation',sql:`UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions."forma-video-media-original".providerRequestId','other-original-result')`},
];

test('Video original recovery financial guards, checkpoint and settlement execute on actual local D1',{timeout:180_000},async t=>{
 const counts={externalNetworkRequests:0,localProxyRequests:0,syntheticQueueReads:0},caseEvidence=[];
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),
  d1Databases:cases.map((_,i)=>'DB_'+i),script:'export default {fetch(){return new Response("synthetic Video original financial D1 qualification only")}}',
  outboundService(){counts.externalNetworkRequests++;throw Error('External network is forbidden');}});
 try{
  for(const [index,scenario] of cases.entries())await t.test(scenario.name,async sub=>{
   const f=await videoRecoveryFixture(),trace=[];let limits;
   const entry={name:scenario.name,success:false,trace};caseEvidence.push(entry);
   try{
    const exported=exportSynthetic(f.sqlite),db=await mf.getD1Database('DB_'+index);await install(db,exported);
    const wrapped=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,wrapped);f.env.DB=wrapped;f.env.FAL_KEY='offline-video-financial-d1';
    limits=enforceD1ExpressionDepth(f,{queryLimits});
    const mediaCalls=[];
    for(const method of ['get','head','put','delete','list'])sub.mock.method(f.env.MEDIA,method,()=>{mediaCalls.push(method);throw Error('Financial qualification cannot access media storage');});
    const beforePrivate=await rowsSnapshot(db,privateTables);
    const job=await db.prepare('SELECT document_jobs.*,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs').first();
    const authority=await captureOriginalOutputVideoFinancialAuthority(f.env,f.user,f.scope,f.slot,job);
    assert.deepEqual(originalOutputVideoFinancialState(authority,f.env),{payerUserId:'owner',jobId:'job',receipt:null});
    const observation=await observe(sub,f,counts),start=trace.length;let injected=false,beforeMutation;
    if(scenario.kind==='mutation')wrapped.beforeBatch=async statements=>{
     if(injected||!combinedFinancialBatch(statements))return;
     injected=true;await db.prepare(scenario.sql).run();beforeMutation=await rowsSnapshot(db,exported.tables);
    };
    if(scenario.kind==='lost-ack')wrapped.afterBatch=async statements=>{
     if(injected||!combinedFinancialBatch(statements))return;injected=true;throw Error('Synthetic lost D1 acknowledgement after committed original financial batch');
    };
    if(scenario.kind==='mutation'){
     await assert.rejects(recordOriginalOutputVideoCompletedObservation(authority,f.env,observation));
     assert.equal(injected,true,'Tampering must occur after capture, at the actual financial transaction');
     assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeMutation,'Failed actual D1 transaction and fallback must leave every synthetic row unchanged');
     assert.ok(trace.slice(start).some(value=>value.kind==='batch'&&combinedFinancialBatch(value.statements)&&value.failure?.includes('CHECK constraint failed')),'The real workerd transaction must reject an unchanged application assertion');
     assert.equal((await db.prepare("SELECT status FROM output_provider_calls WHERE provider='fal'").first()).status,'uncertain');
     assert.equal((await db.prepare('SELECT status FROM cost_budget_reservations').first()).status,'active');
     assert.equal(originalOutputVideoFinancialState(authority,f.env).receipt,null);
    }else{
     const result=await recordOriginalOutputVideoCompletedObservation(authority,f.env,observation);
     if(scenario.kind==='lost-ack')assert.equal(injected,true,'Lost acknowledgement must follow the actual committed financial transaction');
     const media=await db.prepare("SELECT * FROM output_provider_calls WHERE provider='fal'").first(),planner=await db.prepare("SELECT * FROM output_provider_calls WHERE provider='openai'").first();
     assert.equal(media.status,'settled');assert.equal(media.used_microusd,538020);assert.equal(media.provider_response_id,'video_original');
     assert.equal(result.payerUserId,'owner');assert.equal(result.receipt.status,'completed');assert.equal(result.receipt.costMicrousd,538020);
     assert.equal(result.receipt.clientRequestId,media.client_request_id);assert.equal(result.receipt.requestDigest,media.request_digest);
     const saved=JSON.parse((await db.prepare('SELECT result_json FROM document_jobs').first()).result_json).providerSubmissions[media.client_request_id];
     assert.equal(saved.status,'completed');assert.equal(saved.providerRequestId,media.provider_response_id);assert.equal(saved.costMicrousd,media.used_microusd);
     const token=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
     assert.equal(token.owner_id,'owner');assert.equal(cost.owner_id,'owner');assert.equal(token.status,'settled');assert.equal(cost.status,'settled');
     assert.equal(token.used_tokens,130);assert.equal(cost.used_microusd,538020+planner.used_microusd);
     for(const [scope,scopeId] of [['user','owner'],['workspace','forma']]){
      const tokens=await db.prepare('SELECT reserved_tokens,used_tokens FROM budget_counters WHERE scope=? AND scope_id=?').bind(scope,scopeId).first();
      const costs=await db.prepare('SELECT reserved_microusd,used_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').bind(scope,scopeId).first();
      assert.deepEqual(tokens,{reserved_tokens:0,used_tokens:130});assert.deepEqual(costs,{reserved_microusd:0,used_microusd:cost.used_microusd});
     }
     const once=await rowsSnapshot(db,financialTables);await recordOriginalOutputVideoCompletedObservation(authority,f.env,observation);
     assert.deepEqual(await rowsSnapshot(db,financialTables),once,'Exact observation replay must not charge or update original financial rows again');
     assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').first()).n,2);
     assert.equal((await db.prepare('SELECT status FROM document_jobs').first()).status,'failed','Accounting does not turn the failed original into a completed output');
    }
    assert.deepEqual(await rowsSnapshot(db,privateTables),beforePrivate);assert.deepEqual(mediaCalls,[]);limits.assertVerified();
    const statements=trace.flatMap(value=>value.statements??[value]);
    Object.assign(entry,{success:true,schemaObjects:exported.schema.length,statementCount:statements.length,strictCompilerStatements:limits.records.length,
     maximumBindings:Math.max(...statements.map(value=>value.bindings.length)),maximumSqlBytes:Math.max(...statements.map(value=>Buffer.byteLength(value.sql))),
     injected,financialBatchExecuted:trace.slice(start).some(value=>value.kind==='batch'&&combinedFinancialBatch(value.statements)),noPrivateWrites:true,noStorageAccess:true,
     compilerRecords:limits.records});
   }catch(error){entry.error=String(error);entry.stack=error?.stack;entry.compilerRecords=limits?.records;entry.compilerFailures=limits?.failures;throw error;}
   finally{limits?.restore();f.close();}
  });
  assert.ok(caseEvidence.every(entry=>entry.success));assert.equal(counts.externalNetworkRequests,0);assert.equal(counts.syntheticQueueReads,cases.length*2);
  const evidence={success:true,engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted production monetary leaf and shared financial modules against local workerd D1',
   workerHostedRequests:false,nativeAdmission:false,realProvider:false,localOnly:true,appRecordedCostIsProviderInvoice:false,
   expressionDepthLimit:100,...queryLimits,...counts,cases:caseEvidence};
  await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  t.diagnostic(JSON.stringify({...evidence,cases:caseEvidence.map(({trace,compilerRecords,...entry})=>{void trace;void compilerRecords;return entry;})}));
 }catch(error){
  const failurePath=evidencePath.replace(/\.json$/u,'')+'-failure-'+Date.now()+'.json';
  await writeFile(failurePath,JSON.stringify({success:false,error:String(error),stack:error?.stack,...counts,cases:caseEvidence},null,2)+'\n',{flag:'wx'});
  t.diagnostic('Preserved failure: '+failurePath);throw error;
 }finally{await mf.dispose();}
});
