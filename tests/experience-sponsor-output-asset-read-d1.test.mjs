import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {sponsorOutputAssetReadFixture,hash} from './sponsor-output-asset-read-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
import {SPONSOR_OUTPUT_ASSET_READ_INDEXES} from '../worker/experience-sponsor-output-asset-read.ts';

const requireWrangler=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,Log,LogLevel}=requireWrangler('miniflare');

function tracedDatabase(db,trace){
  const statements=new WeakMap();
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings);
    const statement={bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async()=>{
      trace.push({kind:method,sql,bindings});
      try{return await original[method]();}catch(error){trace.at(-1).failure=String(error);throw error;}
    };
    statements.set(statement,{original,sql,bindings});return statement;
  };
  return {prepare:sql=>wrap(sql),batch:async items=>{
    const values=items.map(item=>{const value=statements.get(item);assert.ok(value);return value;});
    trace.push({kind:'batch',statements:values.map(({sql,bindings})=>({sql,bindings}))});
    try{return await db.batch(values.map(value=>value.original));}catch(error){trace.at(-1).failure=String(error);throw error;}
  }};
}

test('actual native sponsored asset GET and final composed proof execute in local workerd D1 with passive late-withdrawal refusal',{timeout:120_000},async t=>{
  // This fixture's only generation uses intercepted synthetic transport. The
  // exported rows/objects are disposable and never touch a live binding.
  const f=await sponsorOutputAssetReadFixture(t,{indexDefinitions:SPONSOR_OUTPUT_ASSET_READ_INDEXES});
  const exported=exportSynthetic(f.sqlite),initialProviders=f.transport.counts();
  // Miniflare's local proxy needs its own fetch implementation. Removing the
  // fixture mock cannot grant outbound access: workerd forbids it below, and
  // the composed GET has no provider route or execution bridge dispatch.
  t.mock.restoreAll();
  let outbound=0;
  const localFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){outbound++;throw Error('network_forbidden');}
    return localFetch(...args);
  });
  const mediaIo={get:0,head:0,put:0,delete:0,list:0};
  for(const operation of ['get','head']){const original=f.env.MEDIA[operation].bind(f.env.MEDIA);f.env.MEDIA[operation]=(...args)=>{mediaIo[operation]++;return original(...args);};}
  for(const operation of ['put','delete','list'])f.env.MEDIA[operation]=()=>{mediaIo[operation]++;throw Error('passive_media_write_forbidden');};
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB'],script:'export default {fetch(){return new Response("disposable local D1 only")}}',
    outboundService(){outbound++;throw Error('network_forbidden');}});
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const nativeTables=exported.tables.filter(name=>name!=='experience_sponsor_read_attempts');
    const before=await rowsSnapshot(db,nativeTables),trace=[];
    f.env.DB=tracedDatabase(db,trace);
    const response=await f.readAsset();
    if(response.status!==200){
      await writeFile('/private/tmp/forma-sponsor-output-asset-d1-failed-trace.json',JSON.stringify(trace,null,2)+'\n');
      t.diagnostic(JSON.stringify(trace.filter(entry=>entry.failure).map(entry=>({failure:entry.failure,kind:entry.kind,sqlPrefix:entry.sql?.slice(0,160),queries:entry.statements?.map(value=>({bytes:Buffer.byteLength(value.sql),bindings:value.bindings.length,prefix:value.sql.slice(0,160)}))}))));
      for(const failed of trace.filter(entry=>entry.failure))for(const [index,value] of (failed.statements??[failed]).entries()){
        if(!/^\s*(?:SELECT|WITH)/u.test(value.sql))continue;
        try{await db.prepare(value.sql).bind(...value.bindings).all();t.diagnostic(`isolated query ${index}: parses`);}
        catch(error){t.diagnostic(`isolated query ${index}: ${String(error)}`);}
      }
    }
    assert.equal(response.status,200,response.status===200?'':await response.text());
    assert.equal(response.headers.get('x-output-sha256'),f.assetSha256);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())),f.assetSha256);
    const attempts=(await db.prepare('SELECT job_id,operation FROM experience_sponsor_read_attempts').all()).results;
    assert.deepEqual(attempts,[{job_id:f.jobId,operation:'image-media'}]);
    assert.deepEqual(await rowsSnapshot(db,nativeTables),before);
    assert.equal(f.io.get,1);f.assertNoIoWrites();assert.deepEqual(mediaIo,{get:1,head:0,put:0,delete:0,list:0});
    assert.deepEqual(f.transport.counts(),initialProviders);assert.equal(outbound,0);

    const flattened=trace.flatMap(entry=>entry.statements??[entry]);
    const wrapped=flattened.filter(entry=>entry.sql.startsWith('WITH candidate AS MATERIALIZED'));
    const finalProofBatch=trace.findLast(entry=>entry.kind==='batch'&&entry.statements.every(value=>value.sql.startsWith('SELECT CASE WHEN ('))
      &&entry.statements.some(value=>value.sql.includes('experience_sponsor_read_attempts'))
      &&entry.statements.some(value=>value.sql.includes('output_assets asset')));
    assert.ok(wrapped.length>0);assert.ok(finalProofBatch,'Actual sponsor/adoption sibling proofs must execute in one final batch');
    const composed=finalProofBatch.statements;
    assert.ok(flattened.every(entry=>entry.bindings.length<=100));
    assert.ok(flattened.every(entry=>Buffer.byteLength(entry.sql)<=100_000));
    assert.ok(composed.length>2);

    // Withdraw the actual adoption sidecar after successful R2 acquisition.
    // Native final proof, in the wrapper's single second D1 transaction, must
    // observe the withdrawal and withhold all outgoing file bytes.
    f.beforeMediaGet=()=>db.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").bind(f.assetEvent.eventId).run();
    const denied=await f.readAsset();
    assert.ok([403,409,410].includes(denied.status),denied.status===200?'Unexpected disclosed response':await denied.clone().text());
    assert.notEqual(denied.headers.get('content-type'),'image/png');
    const retained=(await db.prepare('SELECT job_id,operation FROM experience_sponsor_read_attempts').all()).results;
    assert.equal(retained.length,2);assert.ok(retained.every(row=>row.job_id===f.jobId&&row.operation==='image-media'));
    assert.equal(f.io.get,2);f.assertNoIoWrites();assert.equal(outbound,0);assert.deepEqual(mediaIo,{get:2,head:0,put:0,delete:0,list:0});
    assert.deepEqual(f.transport.counts(),initialProviders);
    const summary={localOnly:true,success:true,engine:'pinned Miniflare/workerd D1',schemaObjects:exported.schema.length,
      firstRequest:{statements:flattened.length,wrappedStatements:wrapped.length,composedProofStatements:composed.length,
        maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),
        composedMaximumBindings:Math.max(...composed.map(entry=>entry.bindings.length)),composedMaximumSqlBytes:Math.max(...composed.map(entry=>Buffer.byteLength(entry.sql)))},
      lateWithdrawalStatus:denied.status,attempts:retained.length,outboundCalls:outbound,mediaIo};
    await writeFile('/private/tmp/forma-sponsor-output-asset-d1-evidence.json',JSON.stringify(summary,null,2)+'\n');
    t.diagnostic(JSON.stringify(summary));
  }finally{await mf.dispose();}
});
