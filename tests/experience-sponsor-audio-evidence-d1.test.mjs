import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import * as fixtures from './sponsor-audio-evidence-fixture.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const [{inheritRuntimeSchemaReadiness},{describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence},contract]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/experience-sponsor-audio-evidence.ts'),
  import('../worker/experience-sponsor-audio-contract.ts'),
]);
const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const evidencePath='/private/tmp/forma-sponsor-audio-d1-evidence.json';
const originalFetch=globalThis.fetch;

// The application receives real workerd prepared statements and results. The
// wrapper observes SQL and enforces read-only access; it never fabricates a row,
// substitutes a predicate, or rewrites an application's submitted statement.
function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=100,`D1 parameter limit exceeded: ${bindings.length}`);
    assert.ok(Buffer.byteLength(sql)<=100_000,`D1 SQL byte limit exceeded: ${Buffer.byteLength(sql)}`);
    if(wrapped.readOnly)assert.ok(/^\s*(?:SELECT|WITH)\b/iu.test(sql)&&! /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/iu.test(sql),
      `Audio evidence attempted non-read SQL: ${sql.slice(0,100)}`);
    return {sql,bindings:[...bindings]};
  };
  const wrap=(sql,bindings=[])=>{
    capture(sql,bindings);
    const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
      try{return await original[method](...args);}catch(error){entry.failure=String(error);throw error;}
    };
    originals.set(statement,{original,sql,bindings});return statement;
  };
  const wrapped={readOnly:false,beforeBatch:null,prepare:sql=>wrap(sql),batch:async statements=>{
    const native=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
    const entry={kind:'batch',statements:native.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
    if(wrapped.beforeBatch)await wrapped.beforeBatch(entry.statements);
    try{return await db.batch(native.map(value=>value.original));}catch(error){entry.failure=String(error);throw error;}
  }};
  return wrapped;
}
const finalProof=statements=>statements.some(({sql})=>sql.includes('captured WHERE terms_digest=? AND expires_at=? AND private_json=?'));
const retainedSchema=async(db,names)=>(await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results
  .filter(row=>names.has(row.name));
const state=async(db,exported)=>({rows:await rowsSnapshot(db,exported.tables),schema:await retainedSchema(db,new Set(exported.schema.map(row=>row.name)))});

test('native Audio evidence remains read-only and detects current-row drift on local workerd D1',{timeout:120_000},async t=>{
  let externalNetworkRequests=0,localProxyRequests=0;
  t.mock.method(globalThis,'fetch',(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
      localProxyRequests++;return originalFetch(input,{...init,redirect:'error'});
    }
    externalNetworkRequests++;throw Error('Audio evidence external network forbidden');
  });
  const f=await fixtures.fixture(t),exported=exportSynthetic(f.sqlite),trace=[],mutations=[];
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("synthetic Audio evidence D1 qualification only")}}',
    outboundService(){externalNetworkRequests++;throw Error('Audio evidence external network forbidden');}});
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    const guarded=tracedDatabase(db,trace);inheritRuntimeSchemaReadiness(f.env.DB,guarded);f.env.DB=guarded;
    f.trusted=await f.reloadTrusted();
    guarded.readOnly=true;
    const baseline=await state(db,exported),positiveTraceStart=trace.length;
    const described=await describeSponsorAudioAdmission(f.trusted,f.command);
    const actual=await readSponsorAudioTemplateEvidence(f.trusted,f.command,described.recipe);
    const template=contract.readSponsorAudioCampaignTemplate(await fixtures.nativeTemplate(actual));
    assert.equal(await contract.matchSponsorAudioTemplate(template,actual),true);
    assert.deepEqual(actual.offered,f.terms.targets[0],'Evidence must preserve the exact genuine native quote');
    assert.deepEqual(actual.consent,f.command.audioCostConsent);
    assert.equal(described.actorUserId,fixtures.actor);assert.equal(described.ownerUserId,fixtures.actor);
    assert.deepEqual(described.orderedAssetDigests,[]);
    assert.deepEqual(described.recipe.calls,{parsing:0,planning:1,render:1,repair:1});
    assert.equal(actual.offered.maximumCalls,3);assert.equal(actual.offered.settings.duration.measuredSeconds,null);
    assert.ok(Object.isFrozen(actual.offered.settings.payload));
    assert.equal(trace.slice(positiveTraceStart).filter(entry=>entry.kind==='batch'&&finalProof(entry.statements)).length,2,
      'Both real evidence reads must execute their complete final proof on D1');
    assert.deepEqual(await state(db,exported),baseline);

    // Real D1 preserves text/null scalars and binds JavaScript numbers as REAL.
    // Production predicates above execute under workerd's SQL engine limits;
    // the observed SQL/bind ceiling also covers every application statement.
    const boundScalarTypes=await guarded.prepare('SELECT typeof(?) AS number_type,typeof(?) AS string_type,typeof(?) AS null_type').bind(1,'1',null).first();
    assert.deepEqual(boundScalarTypes,{number_type:'real',string_type:'text',null_type:'null'});
    const source=await db.prepare(`SELECT body.private_event_id,body.private_json FROM events event
      JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.type='BlockCreated' AND body.document_id=?
        AND json_extract(body.private_json,'$.type')<>'output' ORDER BY event.sequence LIMIT 1`)
      .bind(`creative:${fixtures.actor}`,f.documentId).first();assert.ok(source);
    const quote=await db.prepare(`SELECT body.private_event_id,body.private_json FROM output_preflights preflight
      JOIN event_private_payloads body ON body.private_event_id=preflight.event_id WHERE preflight.preflight_id=?`)
      .bind(f.command.preflightId).first();assert.ok(quote);
    const principal=await db.prepare('SELECT consent_version FROM users WHERE user_id=?').bind(fixtures.actor).first();assert.ok(principal);
    const changedSource=JSON.parse(source.private_json);
    assert.equal(typeof changedSource.properties?.text,'string');changedSource.properties.text+=' Later source mutation.';
    const changedQuote=JSON.parse(quote.private_json);changedQuote.preflight.targets[0].settings.calls[0].maximumInputTokens++;
    const cases=[
      {name:'source',sql:'UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?',
        changed:[JSON.stringify(changedSource),source.private_event_id],original:[source.private_json,source.private_event_id]},
      {name:'quote',sql:'UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?',
        changed:[JSON.stringify(changedQuote),quote.private_event_id],original:[quote.private_json,quote.private_event_id]},
      {name:'principal',sql:'UPDATE users SET consent_version=? WHERE user_id=?',changed:[null,fixtures.actor],original:[principal.consent_version,fixtures.actor]},
    ];
    for(const mutation of cases){
      f.trusted=await f.reloadTrusted();let reached=0,afterMutation;
      guarded.beforeBatch=async statements=>{
        if(!finalProof(statements))return;
        reached++;assert.equal(reached,1,'Mutation targets the actual final proof exactly once');
        const changed=await db.prepare(mutation.sql).bind(...mutation.changed).run();assert.equal(changed.meta.changes,1);
        afterMutation=await state(db,exported);assert.notDeepEqual(afterMutation,baseline);
      };
      await assert.rejects(readSponsorAudioTemplateEvidence(f.trusted,f.command,described.recipe),/output_source_changed_during_read/u);
      assert.equal(reached,1);guarded.beforeBatch=null;
      assert.deepEqual(await state(db,exported),afterMutation,'Refusal must preserve the actual late mutation and add no application write');
      mutations.push({name:mutation.name,reachedActualFinalProof:true,denied:true,originalMutationPreserved:true});
      await db.prepare(mutation.sql).bind(...mutation.original).run();
      assert.deepEqual(await state(db,exported),baseline);
    }
    for(const table of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0,table);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'experience_sponsor_%'").first()).n,0);
    assert.equal(externalNetworkRequests,0);assert.deepEqual(f.effects,{media:0,assets:0,detached:0});
    const statements=trace.flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native application functions against local workerd D1',
      builtWorkerHttp:false,localOnly:true,success:true,schemaObjects:exported.schema.length,
      statementCount:statements.length,maximumBindings:Math.max(...statements.map(entry=>entry.bindings.length)),
      maximumSqlBytes:Math.max(...statements.map(entry=>Buffer.byteLength(entry.sql))),boundScalarTypes,
      exactCurrentQuote:true,actualTemplateMatch:true,readOnlyRowsAndSchema:true,mutations,
      originalMutationPreserved:true,syntheticProviderResponses:0,externalNetworkRequests,localProxyRequests,
      mediaOperations:f.effects.media,assetFetches:f.effects.assets,detachedWork:f.effects.detached,
      paidJobs:0,sponsorSchemaObjects:0,trace};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
    const {trace:omitted,...summary}=evidence;void omitted;t.diagnostic(JSON.stringify(summary));
  }catch(error){
    await writeFile(evidencePath,JSON.stringify({success:false,error:String(error),externalNetworkRequests,localProxyRequests,mutations,trace},null,2)+'\n');
    throw error;
  }finally{await mf.dispose();}
});
