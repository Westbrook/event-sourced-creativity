import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {nativeImageReadFixture,responseJson} from './sponsor-native-image-read-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
const [{handleDocumentJobs},{inheritRuntimeSchemaReadiness}]=await Promise.all([
  import('../worker/document-jobs-api.ts'),import('../worker/runtime.ts'),
]);

const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');

// Compare outer AND leaves while keeping subqueries/functions/OR predicates
// whole. Only grouping may differ from the preserved historical failed SQL.
function conjunction(sql){
  sql=sql.trim();let depth=0,quoted=false,wrapped=sql[0]==='(',start=0;const parts=[];
  for(let index=0;index<sql.length;index++){
    const character=sql[index];
    if(character==="'"){if(quoted&&sql[index+1]==="'"){index++;continue;}quoted=!quoted;continue;}
    if(quoted)continue;
    if(character==='('){depth++;continue;}
    if(character===')'){depth--;if(depth===0&&index!==sql.length-1)wrapped=false;continue;}
    if(depth===0&&sql.slice(index,index+5)===' AND '){parts.push(sql.slice(start,index));start=index+5;index+=4;}
  }
  if(parts.length)return [...parts,sql.slice(start)].flatMap(conjunction);
  if(wrapped&&depth===0)return conjunction(sql.slice(1,-1));
  return [sql.replace(/\s+/gu,' ')];
}
function retainedProof(sql){
  const prefix='SELECT CASE WHEN (EXISTS(SELECT 1 ',suffix=')) THEN 1 ELSE 0 END AS current';
  assert.ok(sql.startsWith(prefix)&&sql.endsWith(suffix));
  const inner=sql.slice(prefix.length,-suffix.length),where=inner.indexOf('\n WHERE ');assert.ok(where>0);
  return {joins:inner.slice(0,where).replace(/\s+/gu,' '),terms:conjunction(inner.slice(where+'\n WHERE '.length))};
}

test('sponsored Image and Jobs reads retain the identical lineage proof within actual local D1 depth limits',{timeout:120_000},async t=>{
  const f=await nativeImageReadFixture(t),exported=exportSynthetic(f.sqlite),providers=f.transport.counts();
  t.mock.restoreAll();let outbound=0;
  const localFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){outbound++;throw Error('network_forbidden');}
    return localFetch(...args);
  });
  const mediaIo={get:0,head:0,put:0,delete:0,list:0};
  for(const operation of ['get','head']){const original=f.env.MEDIA[operation].bind(f.env.MEDIA);f.env.MEDIA[operation]=(...args)=>{mediaIo[operation]++;return original(...args);};}
  for(const operation of ['put','delete','list'])f.env.MEDIA[operation]=()=>{mediaIo[operation]++;throw Error('passive_media_write_forbidden');};
  const passiveMedia=()=>assert.deepEqual(mediaIo,{get:1,head:0,put:0,delete:0,list:0});
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("synthetic read proof only")}}',outboundService(){outbound++;throw Error('network_forbidden');}});
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const trace=[],statements=new WeakMap();
    const wrap=(sql,bindings=[])=>{
      const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
      for(const method of ['first','all','run'])statement[method]=async()=>{trace.push({sql,bindings});return original[method]();};
      statements.set(statement,{original,sql,bindings});return statement;
    };
    const guarded={prepare:sql=>wrap(sql),batch:async items=>{
      const captured=items.map(item=>statements.get(item));trace.push(...captured.map(({sql,bindings})=>({sql,bindings})));
      if(f.beforeBatch)await f.beforeBatch(captured);
      return db.batch(captured.map(value=>value.original));
    }};
    inheritRuntimeSchemaReadiness(f.DB,guarded);f.env.DB=guarded;
    const tables=exported.tables.filter(name=>name!=='experience_sponsor_read_attempts'),before=await rowsSnapshot(db,tables);
    const image=await responseJson(await f.readImage());assert.equal(image.outputId,f.outputId);assert.equal(image.status,'current');
    const request=()=>new Request(`http://localhost/api/document-jobs/${f.jobId}?inspection=1`,{headers:f.actorHeaders});
    const job=await responseJson(await handleDocumentJobs(request(),f.env,f.jobId,f.context));assert.equal(job.job.jobId,f.jobId);
    assert.deepEqual(await rowsSnapshot(db,tables),before);f.assertNoIoWrites();passiveMedia();assert.equal(outbound,0);assert.deepEqual(f.transport.counts(),providers);
    const proof=trace.find(entry=>entry.sql.startsWith('SELECT CASE WHEN (EXISTS(SELECT 1 FROM document_jobs job\n JOIN output_operation_slots')&&entry.bindings.length===22);assert.ok(proof);
    const historical=await readFile(new URL('./fixtures/sponsor-read-lineage-depth-legacy.sql',import.meta.url),'utf8');
    assert.deepEqual(retainedProof(proof.sql),retainedProof(historical.trim()));
    await assert.rejects(db.prepare(historical).bind(...proof.bindings).all(),/Expression tree is too large \(maximum depth 100\)/u);
    assert.equal((await db.prepare(proof.sql).bind(...proof.bindings).first()).current,1);
    const positiveCount=trace.length;
    // Mutation happens only inside the disposable fixture, immediately before
    // the same final native proof batch. It may not be replaced by the earlier
    // successful admission/attempt or expose a completed status afterwards.
    let withdrew=false;
    f.beforeBatch=async captured=>{
      if(!withdrew&&captured.some(entry=>entry.sql.includes('job.status=? AND job.updated_at=?'))){
        withdrew=true;await db.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").bind(f.completionEvent.eventId).run();
      }
    };
    const denied=await handleDocumentJobs(request(),f.env,f.jobId,f.context);assert.equal(denied.status,403,await denied.clone().text());assert.equal(withdrew,true);
    const attempts=(await db.prepare('SELECT job_id,operation FROM experience_sponsor_read_attempts').all()).results;
    assert.equal(attempts.length,3);assert.deepEqual(attempts.map(row=>row.operation).sort(),['image-result','image-status','image-status']);
    assert.ok(trace.every(entry=>entry.bindings.length<=100&&Buffer.byteLength(entry.sql)<=100_000));
    f.assertNoIoWrites();passiveMedia();assert.equal(outbound,0);assert.deepEqual(f.transport.counts(),providers);
    const evidence={engine:'pinned Miniflare/workerd D1',localOnly:true,success:true,predicateLeaves:retainedProof(proof.sql).terms.length,
      historicalDepthFailurePreserved:true,positiveStatementCount:positiveCount,proofBytes:Buffer.byteLength(proof.sql),proofBindings:proof.bindings.length,
      maximumBindings:Math.max(...trace.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...trace.map(entry=>Buffer.byteLength(entry.sql))),lateWithdrawalStatus:denied.status,attempts:attempts.length,outboundCalls:outbound,mediaIo};
    await writeFile('/private/tmp/forma-sponsor-read-core-d1-evidence.json',JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }finally{await mf.dispose();}
});
