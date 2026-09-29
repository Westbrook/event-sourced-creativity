import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {fixture,nativeQuery,actor} from './sponsor-story-read-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [nativeRead,custody,{identifySponsorStoryRead},{reserveSponsorStoryIoAttempt},statusRead,{inheritRuntimeSchemaReadiness}]=await Promise.all([
  import('../worker/experience-sponsor-native-story-read.ts'),import('../worker/native-retained-text-custody.ts'),
  import('../worker/experience-sponsor-story-read.ts'),import('../worker/experience-sponsor-story-io-attempts.ts'),
  import('../worker/experience-sponsor-story-status.ts'),import('../worker/runtime.ts'),
]);
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const originalFetch=globalThis.fetch;
const evidencePath='/private/tmp/forma-sponsor-story-read-d1-evidence.json';
const sourcePaths=['worker/experience-sponsor-story-read.ts','worker/experience-sponsor-story-io-policy.ts',
  'worker/experience-sponsor-story-io-approval.ts','worker/experience-sponsor-story-io-attempts.ts',
  'worker/experience-sponsor-story-read-budget.ts','worker/experience-sponsor-native-story-read.ts','worker/experience-sponsor-story-status.ts',
  'worker/native-retained-text-custody.ts','worker/retained-story-api.ts','worker/document-jobs-api.ts',
  'worker/experience-sponsor-story-driver.ts','worker/experience-sponsor-story-issuer.ts',
  'tests/sponsor-story-read-fixture.mjs','tests/sponsor-story-driver-fixture.mjs','tests/sponsor-story-native-fixture.mjs',
  'tests/helpers/model3d-workerd-snapshot.mjs','tests/helpers/d1-expression-depth.mjs','tests/experience-sponsor-story-read-d1.test.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
const count=async(db,table)=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const ioName=name=>name.startsWith('experience_sponsor_story_io_');
async function ioSnapshot(db,tables){
  const rows={};
  for(const table of tables){
    const columns=await all(db,`PRAGMA table_info("${table}")`),primary=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk);
    assert.ok(primary.length>0);
    rows[table]=await all(db,`SELECT ${columns.map((column,index)=>`quote("${column.name}") AS c${index}`).join(',')} FROM "${table}" ORDER BY ${primary.map(column=>`"${column.name}"`).join(',')}`);
  }
  return rows;
}

/** Reuse the exact native rowid exporter. The new IO family is intentionally
 * WITHOUT ROWID and empty at this boundary, so install its exact schema on D1
 * separately. No IO approval or attempt is fabricated by this adapter. */
function exportBoundary(f){
  const schema=structuredClone(f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
  const io=schema.filter(row=>ioName(row.name)||ioName(row.tbl_name));
  for(const row of io.filter(row=>row.type==='table'))assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${row.name}"`).get().n,0);
  const donor={prepare(sql){
    if(sql==='SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')return {all:()=>schema.filter(row=>!io.includes(row))};
    return f.sqlite.prepare(sql);
  }};
  return {native:exportSynthetic(donor),io};
}

function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<=100_000);return {sql,bindings};
  };
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings),statement={sql,bindings,bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
      try{const result=await original[method](...args);entry.result=structuredClone(result);return result;}
      catch(error){entry.failure=String(error);throw error;}
    };
    originals.set(statement,{original,sql,bindings});return statement;
  };
  const guarded={prepare:sql=>wrap(sql),rewriteBatch:null,batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
    const entry={kind:'batch',statements:values.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
    let submitted=values.map(value=>value.original);
    if(guarded.rewriteBatch){
      const replacement=guarded.rewriteBatch(entry.statements);
      if(replacement){entry.originalStatements=entry.statements;entry.statements=replacement.map(({sql,bindings})=>capture(sql,bindings));
        submitted=entry.statements.map(({sql,bindings})=>db.prepare(sql).bind(...bindings));}
    }
    try{const result=await db.batch(submitted);entry.result=structuredClone(result);return result;}
    catch(error){entry.failure=String(error);throw error;}
  }};
  return guarded;
}

async function classified(f){
  const selected=structuredClone(f.selected),request=f.readRequest(selected),identity=custody.hostedIdentity(request);assert.ok(identity);
  const context=await nativeRead.beginSponsorNativeStoryRead(request,f.env,identity,{selection:selected});
  return {selected,request,identity,context,env:nativeRead.sponsorNativeStoryEnvironment(context,request,f.env)};
}
async function proofParts(f){
  const parts=await classified(f),{request,identity,context,selected,env}=parts;
  const principal=await custody.readNativeRetainedPrincipal(env,identity);assert.equal(principal.observed.user_id,actor);
  const chosen=await custody.readNativeRetainedSelection(env,identity,selected,'short_story');assert.equal(chosen.native.completionId,f.completion.event_id);
  nativeRead.assertSponsorNativeStorySelection(context,request,f.env,selected,chosen.native);
  const retained=await custody.readNativeRetainedContent(env,identity,selected,chosen.native);assert.deepEqual(retained.selection,selected);
  const sql=nativeRead.sponsorNativeStoryFinalQuery(context,request,f.env);assert.equal(typeof sql,'string');
  return {...parts,principal,chosen,retained,sql};
}
function finalStatement(parts,f){
  const {principal,chosen,retained}=parts;
  // Exact unchanged native helper order, using its actual preceding outputs.
  return parts.env.DB.prepare(parts.sql).bind(...principal.auth.bindings,f.stream,chosen.snapshot,
    ...retained.contentBindings,retained.source.content,retained.source.expires_at,principal.principal.auth_json);
}

test('direct selected Story and passive status use real payer IO approval and bounded native proofs on actual local D1',{timeout:120_000},async t=>{
  await rm(evidencePath,{force:true});
  const beforeHashes=await hashes(),f=await fixture(t,{approved:false});f.observer.restore();
  f.selected=f.selection();const expectedBody=JSON.parse(f.raw());
  assert.equal(f.calls.length,1);
  const exported=exportBoundary(f);let external=0,media=0;
  // Generation finished in a synthetic SQLite fixture. Every subsequent fetch
  // must be a nonredirecting loopback request used by Miniflare itself.
  t.mock.method(globalThis,'fetch',(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...options,redirect:'error'});
    external++;throw Error('network_forbidden');
  });
  for(const operation of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,operation,()=>{media++;throw Error('Story text qualification permits no media IO');});
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB'],script:'export default {fetch(){return new Response("direct local Story read qualification only")}}',
    outboundService(){external++;throw Error('network_forbidden');}});
  const trace=[];let limits;
  try{
    const db=await mf.getD1Database('DB');await install(db,exported.native);
    await db.batch(exported.io.filter(row=>row.type==='table').map(row=>db.prepare(row.sql)));
    await db.batch(exported.io.filter(row=>row.type!=='table'&&row.sql).map(row=>db.prepare(row.sql)));
    const ioTables=exported.io.filter(row=>row.type==='table').map(row=>row.name);
    for(const table of ioTables)assert.equal(await count(db,table),0);
    const names=new Set(exported.io.map(row=>row.name));
    assert.deepEqual((await all(db,'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')).filter(row=>names.has(row.name)),exported.io);
    assert.deepEqual(await all(db,'PRAGMA foreign_key_check'),[]);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    limits=enforceD1ExpressionDepth({sqlite:f.sqlite,env:{DB:guarded}},{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
    const beforeNative=await rowsSnapshot(db,exported.native.tables);

    await assert.rejects(classified(f),{message:'sponsor_story_io_policy_unavailable'});
    assert.equal(await count(db,'experience_sponsor_story_io_attempts'),0);
    assert.equal(trace.some(entry=>(entry.statements??[entry]).some(({sql})=>nativeQuery.history(sql)||nativeQuery.content(sql)||nativeQuery.final(sql))),false);
    await f.approveIo();
    assert.equal(await count(db,'experience_sponsor_story_io_policies'),1);
    assert.equal(await count(db,'experience_sponsor_story_io_approvals'),1);
    assert.equal(await count(db,'experience_sponsor_story_io_attempts'),0);
    assert.deepEqual(await rowsSnapshot(db,exported.native.tables),beforeNative);
    const stableIoTables=ioTables.filter(table=>table!=='experience_sponsor_story_io_attempts');
    const approvedIo=await ioSnapshot(db,stableIoTables);

    const parts=await proofParts(f);
    assert.equal(parts.retained.body.content_markdown,expectedBody.content_markdown);
    assert.equal(parts.retained.selection.revision,0);
    assert.deepEqual(await nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,finalStatement(parts,f)),{admitted:1});
    const body=nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body));
    assert.deepEqual(await new Response(body).json(),parts.retained.body);
    assert.throws(()=>nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body)),/sponsor_story_native_replay/u);

    const rejectedWitnesses=[];
    for(const witness of [0,null]){
      const negative=await proofParts(f),beforeFinalNative=await rowsSnapshot(db,exported.native.tables),beforeFinalIo=await ioSnapshot(db,ioTables);
      let injected=false,replacedIndex;
      guarded.rewriteBatch=statements=>{
        if(!statements.some(({sql})=>nativeQuery.final(sql)))return null;
        assert.equal(injected,false);injected=true;
        const index=statements.findIndex(({sql})=>sql.startsWith('SELECT CASE WHEN ('));assert.ok(index>0);replacedIndex=index;
        return statements.map((statement,position)=>position===index?{sql:'SELECT ? AS current',bindings:[witness]}:statement);
      };
      try{await assert.rejects(nativeRead.finishSponsorNativeStoryRead(negative.context,negative.request,f.env,finalStatement(negative,f)),/sponsor_story_read_final_changed/u);}
      finally{guarded.rewriteBatch=null;}
      assert.equal(injected,true);const last=trace.at(-1);assert.equal(last.result[0].results[0].admitted,1);
      assert.equal(last.result[replacedIndex].results[0].current,witness);
      for(const [index,result] of last.result.entries()){
        assert.equal(result.success,true);assert.equal(result.results.length,1);
        if(index>0&&index!==replacedIndex)assert.equal(result.results[0].current,1);
      }
      assert.throws(()=>nativeRead.sponsorNativeStoryResponse(negative.context,negative.request,f.env,JSON.stringify(negative.retained.body)),/sponsor_story_native_replay/u);
      assert.deepEqual(await rowsSnapshot(db,exported.native.tables),beforeFinalNative);
      assert.deepEqual(await ioSnapshot(db,ioTables),beforeFinalIo);
      rejectedWitnesses.push(witness);
    }

    const actualJob=await db.prepare('SELECT updated_at FROM document_jobs WHERE job_id=?').bind(f.jobId).first();
    const statusStart=trace.length,statusRequest=new Request(`https://forma.test/__fixture/passive-status/${f.jobId}`,{headers:f.actorHeaders});
    const authority=await identifySponsorStoryRead(statusRequest,f.env,{jobId:f.jobId});
    const attempt=await reserveSponsorStoryIoAttempt(authority,statusRequest,f.env,'short-story-status');
    const status=await statusRead.resolveSponsorStoryStatus(authority,attempt,statusRequest,f.env);
    const statusBody=statusRead.sponsorStoryStatusResponse(status,statusRequest,f.env,'job');
    const actualStatusControlBytes=trace.slice(statusStart).reduce((sum,entry)=>sum+Buffer.byteLength(JSON.stringify(entry.result)),0);
    assert.equal(f.ioPolicy.operations['short-story-status'].maximumBytes-status.remainingBytes,actualStatusControlBytes);
    const statusJson=await new Response(statusBody).json();
    assert.deepEqual(statusJson,{job:{jobId:f.jobId,documentId:f.documentId,kind:'render_document',sourceSurface:'outputs',status:'completed',
      updatedAt:actualJob.updated_at,result:null,sponsoredRead:{version:1,operation:'short-story-status',passive:true}}});
    assert.equal(trace.slice(statusStart).some(entry=>(entry.statements??[entry]).some(({sql})=>nativeQuery.content(sql))),false);
    assert.ok(!JSON.stringify(statusJson).includes('The Returned Clock'));
    const charged=await all(db,'SELECT * FROM experience_sponsor_story_io_attempts ORDER BY admitted_at_ms,attempt_id');
    assert.equal(charged.length,4);assert.deepEqual(charged.map(row=>row.operation).sort(),['short-story-result','short-story-result','short-story-result','short-story-status']);
    for(const row of charged){const allocation=f.ioPolicy.operations[row.operation];
      assert.equal(row.actor_user_id,actor);assert.equal(row.job_id,f.jobId);assert.equal(row.maximum_bytes,allocation.maximumBytes);
      assert.equal(row.deadline_at_ms,row.admitted_at_ms+allocation.deadlineMs);assert.equal(row.charged_through_ms,row.deadline_at_ms+f.ioPolicy.windowMs);}
    assert.equal(await count(db,'experience_sponsor_story_io_assertions'),0);
    assert.deepEqual(await ioSnapshot(db,stableIoTables),approvedIo);
    assert.deepEqual(await rowsSnapshot(db,exported.native.tables),beforeNative);
    assert.equal(f.calls.length,1);assert.equal(external,0);assert.equal(media,0);limits.assertVerified();
    const afterHashes=await hashes();assert.deepEqual(afterHashes,beforeHashes);
    const flattened=trace.flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted production functions against actual local D1; not bundled Worker or HTTP route',
      startingBoundary:'Actual synthetic native save/confirm, real V4 approval and C generation completed in SQLite; exact native rows exported; IO schema installed empty on D1',
      actualD1Stages:['real payer IO prepare and approval','native classifier and core provenance','IO reserve and take','actual retained principal, selection and content helpers','native final proof and bounded response','passive completed status'],
      success:true,strictSqlShapes:limits.records.length,statementCount:flattened.length,maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),
      maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,
      syntheticFixtureResponses:1,actualExternalRequests:external,readMediaCalls:media,seededIoApprovals:0,seededIoAttempts:0,ioAttempts:charged.length,
      actualStatusControlBytes,
      missingIoRefusesBeforeNativeBody:true,rejectedActualD1Witnesses:rejectedWitnesses,failedProofResponseLocked:true,singleUseResultResponse:true,
      completedStatusPassive:true,allNativeRowsIncludingCreativeAndFinanceUnchanged:true,sourceHashes:afterHashes};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }catch(error){await writeFile('/private/tmp/forma-sponsor-story-read-d1-failed-trace.json',JSON.stringify({error:String(error),trace},null,2)+'\n');throw error;}
  finally{limits?.restore();await mf.dispose();}
});
