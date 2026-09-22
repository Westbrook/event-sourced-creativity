import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {captureSceneSourceVersion} from '../worker/scene-source-generation.ts';
import {reduceSceneVersionedHistory,SCENE_VERSIONED_READ_LIMITS} from '../worker/scene-versioned-history-read.ts';
import {createCreativeEventFold} from '../src/model/events.ts';
import {createSceneContextConsumer} from '../worker/scene-context-consumer.ts';
import {sceneReadFailureDiagnostic,recordSceneReadFailure} from '../worker/scene-read-diagnostic.ts';
import {assertSceneHistoryRead} from '../worker/scene-history-proof-read.ts';
import {sceneHistoryMetadataFields} from '../worker/scene-history-proof.ts';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
test('Scene diagnostics are fixed server-only labels and never disclose arbitrary input',()=>{
  const error=new Error('original');recordSceneReadFailure(error,'deadline');
  assert.equal(sceneReadFailureDiagnostic(error),'deadline');assert.equal(JSON.stringify(error),'{}');
  assert.equal(sceneReadFailureDiagnostic({reason:'deadline'}),undefined);
  const untrusted=new Error('source');recordSceneReadFailure(untrusted,'private arbitrary value');
  assert.equal(sceneReadFailureDiagnostic(untrusted),undefined);
  for(const [results,reason] of [[[],'proof_shape'],[[{success:true,results:[{current:0}]}],'proof_false'],[[{success:true,results:[{current:'1'}]}],'proof_shape']])
    assert.throws(()=>assertSceneHistoryRead(results,1),error=>error.code==='output_source_changed_during_read'&&sceneReadFailureDiagnostic(error)===reason);
});
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');migrateLocalDatabase(db,{migrations});
  const env={DB:{prepare(sql){return{sql,bindings:[],bind(...bindings){return{...this,bindings};}};},async batch(statements){
    db.exec('BEGIN');try{const rows=statements.map(value=>({success:true,results:db.prepare(value.sql).all(...value.bindings)}));db.exec('COMMIT');return rows;}catch(error){db.exec('ROLLBACK');throw error;}
  }}};
  const insert=db.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
    VALUES(?,'creative:a',?,'2026-09-14','2026-09-14','user:a','fixture','fixture',?,?)`);
  const event=(sequence,type,payload)=>insert.run('e'+sequence,sequence,type,JSON.stringify(payload));
  const secret=(sequence,body)=>db.prepare("INSERT INTO event_private_payloads VALUES(?,'a','p','d',?,'now',NULL)").run('e'+sequence,JSON.stringify(body));
  const scope=()=>({streamId:'creative:a',expectedOwnerHead:db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get().n,deadlineMs:Date.now()+120_000});
  const capture=()=>captureSceneSourceVersion(env,{streamId:'creative:a'});
  const reduce=(version,createConsumer,overrides={})=>reduceSceneVersionedHistory(env,{scope:scope(),version,readAssertions:[{sql:'1',bindings:[]}],createConsumer,...overrides});
  return{db,env,event,secret,scope,capture,reduce};
}
test('metadata paging obeys strict D1 limits and preserves exact JSON bytes including nulls and escapes',async t=>{
  const f=fixture(t),fields=[...sceneHistoryMetadataFields,'metadata_valid'];
  const insert=f.db.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,type,payload)
    VALUES(?,'creative:a',?,'2026-09-14','2026-09-14',?,?,?,?,?,'Fixture','{}')`);
  const long='m'.repeat(500);
  for(let sequence=1;sequence<=300;sequence++)insert.run('e'+sequence,sequence,long,
    sequence===1?'雪 "quoted" \\ slash\nline':long,long,sequence===1?'':long,sequence===1?null:long);
  f.secret(1,{text:'private'});
  const version=await f.capture(),batch=f.env.DB.batch;
  const limits=enforceD1ExpressionDepth({env:f.env,sqlite:f.db},{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  t.after(()=>limits.restore());let metadataPages=0;
  f.env.DB.batch=async statements=>{
    const result=await batch(statements),query=statements[0];
    if(query.sql.includes('AS running_bytes FROM page')){
      metadataPages++;
      if(metadataPages===1)assert.ok(result[0].results.length<256,'exercise the byte cutoff before the row limit');
      const expression=query.sql.match(/SUM\(length\(CAST\((.*?) AS BLOB\)\)\+1\)/s)?.[1];assert.ok(expression);
      // Independent legacy serializer on the identical page. Unrestricted local
      // SQLite is an equality oracle only; the actual read uses the strict compiler.
      const legacy=`json_object(${fields.map(field=>`'${field}',${field}`).join(',')})`;
      const from=query.sql.slice(0,query.sql.indexOf(',\n      budgeted AS'));
      const pairs=f.db.prepare(`${from} SELECT ${expression} AS actual,${legacy} AS expected FROM page`).all(...query.bindings);
      for(const pair of pairs){assert.equal(pair.actual,pair.expected);assert.deepEqual(Object.keys(JSON.parse(pair.actual)),fields);}
      const expected=f.db.prepare(query.sql.replace(expression,legacy)).all(...query.bindings);
      assert.deepEqual(result[0].results,expected,'same ordered page and byte-budget cutoff');
    }
    return result;
  };
  const result=await f.reduce(version,()=>({accept(){return true;},finish(){return 'complete';}}));
  assert.equal(result.rows,300);assert.equal(result.value,'complete');assert.ok(metadataPages>=3);limits.assertVerified();
});
test('versioned reader consumes over16MiB fully in bounded pages without retaining full history',async t=>{
  const f=fixture(t);f.event(1,'ProjectCreated',{project_id:'p',name:'Paged'});f.event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Paged document'});
  f.event(3,'BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'direction',properties:{text:'First'}});
  const text='Complete original source '.repeat(140);f.db.exec('BEGIN');
  for(let sequence=4;sequence<=7003;sequence++)f.event(sequence,'BlockPropertyEdited',{block_id:'b',property_path:'text',new_value:text+sequence});
  f.db.exec('COMMIT');const version=await f.capture();
  const result=await f.reduce(version,()=>createCreativeEventFold(Infinity,'d','p'));
  assert.equal(result.rows,7003);assert.ok(result.rawBytes>16*1024*1024);assert.equal(result.value.blocks[0].properties.text,text+'7003');
  assert.equal(result.value.blocks[0].sourceEvents.length,7001);assert.ok(result.maximumHydratedPageBytes<=SCENE_VERSIONED_READ_LIMITS.pageBytes);
  assert.ok(result.maximumMetadataPageBytes<=SCENE_VERSIONED_READ_LIMITS.pageBytes);
  assert.ok(result.batches<=SCENE_VERSIONED_READ_LIMITS.batches);assert.ok(Object.isFrozen(result.assertions));
  t.diagnostic(JSON.stringify({rows:result.rows,rawBytes:result.rawBytes,batches:result.batches,maximumHydratedPageBytes:result.maximumHydratedPageBytes,maximumMetadataPageBytes:result.maximumMetadataPageBytes,runtime:'Node SQLite; not Worker memory evidence'}));
});
test('same-batch refusal identifies only a fixed failing predicate category',async t=>{
 for(const category of ['schema','generation','caller_proof','owner_head','deadline'])await t.test(category,async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),scope=f.scope(),options={scope};
  const now=Date.now;let finished=false,reads=0;const batch=f.env.DB.batch;
  if(category==='schema'){const trigger=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'scene_source_%' LIMIT 1").get();assert(trigger);f.db.exec('DROP TRIGGER '+trigger.name);}
  if(category==='generation')f.event(2,'Fixture',{});
  if(category==='caller_proof')options.readAssertions=[{sql:'0',bindings:[]}];
  if(category==='owner_head')scope.expectedOwnerHead=0;
  if(category==='deadline'){const actual=now();scope.deadlineMs=actual-10000;Date.now=()=>actual-20000;}
  f.env.DB.batch=async statements=>{reads++;return batch(statements);};
  try{await assert.rejects(f.reduce(version,()=>({accept(){assert.fail('must refuse before hydration');},finish(){finished=true;}}),options),
   error=>error.code==='output_source_changed_during_read'&&sceneReadFailureDiagnostic(error)==='guard_'+category);
   assert.equal(reads,1,'no diagnostic reread or source recapture');assert.equal(finished,false);
  }finally{Date.now=now;}
 });
});
test('edit and restore before a later page rejects original token without finalizing partial state',async t=>{
  const f=fixture(t);for(let i=1;i<=300;i++)f.event(i,'Fixture',{});f.secret(1,{text:'original'});
  const version=await f.capture(),batch=f.env.DB.batch;let reads=0,accepted=0,finished=false;
  f.env.DB.batch=async statements=>{if(++reads===4){f.db.exec("UPDATE event_private_payloads SET private_json='{}'; UPDATE event_private_payloads SET private_json='{\"text\":\"original\"}'");}return batch(statements);};
  await assert.rejects(f.reduce(version,()=>({accept(){accepted++;return true;},finish(){finished=true;return accepted;}})),/output_source_changed/);
  assert.ok(accepted>0);assert.equal(finished,false);
});
test('the final empty page is guarded and never finalizes after a late source mutation',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),batch=f.env.DB.batch;let reads=0,finished=false;
  f.env.DB.batch=async statements=>{if(++reads===4)f.event(2,'Fixture',{});return batch(statements);};
  await assert.rejects(f.reduce(version,()=>({accept(){return true;},finish(){finished=true;}})),/output_source_changed/);assert.equal(finished,false);
});
test('oversized individual event refuses before hydration or finalization',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{text:'x'.repeat(140*1024)});const version=await f.capture();let accepted=false,finished=false;
  await assert.rejects(f.reduce(version,()=>({accept(){accepted=true;return true;},finish(){finished=true;}})),/output_source_proof_too_large/);
  assert.equal(accepted,false);assert.equal(finished,false);
});
test('deadline and malformed result guards refuse without a complete projection',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture();let finished=false;
  const consumer=()=>({accept(){return true;},finish(){finished=true;}});
  await assert.rejects(f.reduce(version,consumer,{scope:{...f.scope(),deadlineMs:Date.now()-1}}),error=>sceneReadFailureDiagnostic(error)==='deadline');
  const batch=f.env.DB.batch;f.env.DB.batch=async statements=>{const rows=await batch(statements);delete rows[1].success;return rows;};
  await assert.rejects(f.reduce(version,consumer),error=>sceneReadFailureDiagnostic(error)==='batch_shape');assert.equal(finished,false);
});
test('project source includes exact membership order and refuses orphan membership',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{text:'first'});f.event(2,'Fixture',{text:'second'});
  const insert=f.db.prepare("INSERT INTO project_event_scopes VALUES(?,'access','org','p','a','creative:a',?,?,'a','now')");
  insert.run('e2',2,1);insert.run('e1',1,2);
  const version=await captureSceneSourceVersion(f.env,{streamId:'creative:a',projectAccessId:'access'});
  const options={scope:{...f.scope(),project:{projectAccessId:'access',organizationId:'org',projectId:'p',ownerUserId:'a'}}};
  const result=await f.reduce(version,()=>{const ids=[];return{accept(event){ids.push(event.eventId);return true;},finish(){return ids;}};},options);
  assert.deepEqual(result.value,['e2','e1']);insert.run('missing',3,3);
  const next=await captureSceneSourceVersion(f.env,{streamId:'creative:a',projectAccessId:'access'});
  await assert.rejects(f.reduce(next,()=>({accept(){return true;},finish(){assert.fail('orphan must refuse');}}),options),/output_source_changed/);
});
test('an earlier caller deadline expiring in transit rejects despite a valid scope deadline',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),now=Date.now,batch=f.env.DB.batch;
  const earlier=now()+60_000,scope=f.scope();let finished=false;
  f.env.DB.batch=async statements=>{const result=await batch(statements);Date.now=()=>earlier+1;return result;};
  try{await assert.rejects(f.reduce(version,()=>({accept(){return true;},finish(){finished=true;}}),
    {scope,readAssertions:[{sql:'1',bindings:[],deadlineMs:earlier}]}),/output_source_changed/);}finally{Date.now=now;}
  assert.equal(finished,false);
});
test('wide escaped metadata is byte-paged in SQL before returning rows',async t=>{
  const f=fixture(t);
  const wide='\u0001'.repeat(512);
  const insert=f.db.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
    VALUES(?,'creative:a',?,'2026-09-14','2026-09-14',?,?,?,'Fixture','{}')`);
  for(let i=1;i<=300;i++)insert.run('e'+i,i,wide,wide,wide);
  const version=await f.capture();
  const result=await f.reduce(version,()=>{let count=0;return{accept(){count++;return true;},finish(){return count;}};});
  assert.equal(result.value,300);assert.ok(result.maximumMetadataPageBytes<=SCENE_VERSIONED_READ_LIMITS.pageBytes);
  assert.ok(result.batches>6,'wide metadata must require several separately bounded pages');
});
test('malformed hydration cannot bypass original metadata or declared byte bounds',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),batch=f.env.DB.batch;
  for(const corrupt of [row=>{row.sequence=2;},row=>{row.actor='other';},row=>{row.payload=JSON.stringify({text:'x'.repeat(200*1024)});}]){
    let accepted=false,finished=false;
    f.env.DB.batch=async statements=>{const result=await batch(statements);if(statements[0].sql.includes('source.public_body AS payload'))corrupt(result[0].results[0]);return result;};
    await assert.rejects(f.reduce(version,()=>({accept(){accepted=true;return true;},finish(){finished=true;}})),/output_source_changed/);
    assert.equal(accepted,false);assert.equal(finished,false);
  }
});
test('complete Scene consumer folds a large edit history with bounded retained state',async t=>{
  const f=fixture(t);f.event(1,'ProjectCreated',{project_id:'p',name:'Paged'});f.event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Document'});
  f.event(3,'BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'direction',properties:{text:'Start'}});
  const text='Complete original source '.repeat(140);f.db.exec('BEGIN');
  for(let sequence=4;sequence<=7003;sequence++)f.event(sequence,'BlockPropertyEdited',{block_id:'b',property_path:'text',new_value:text+sequence});
  f.db.exec('COMMIT');const result=await f.reduce(await f.capture(),()=>createSceneContextConsumer({documentId:'d',projectId:'p'}));
  assert.ok(result.rawBytes>16*1024*1024);assert.equal(result.value.trusted.snapshot.facts[0].properties.text,text+'7003');
  assert.equal(result.value.trusted.sourceBlockVersions[0].version,7001);
  assert.deepEqual(result.value.workflowEvents,[]);assert.ok(result.value.maximumRetainedBytes<8*1024*1024);
  t.diagnostic(JSON.stringify({rows:result.rows,rawBytes:result.rawBytes,maximumLogicalRetainedBytes:result.value.maximumRetainedBytes,runtime:'Node SQLite, not Worker heap evidence'}));
});
test('growing current context refuses at retained-state capacity without a finished result',async t=>{
  const f=fixture(t);f.event(1,'ProjectCreated',{project_id:'p'});f.event(2,'DocumentCreated',{project_id:'p',document_id:'d'});
  for(let i=3;i<=130;i++)f.event(i,'BlockCreated',{project_id:'p',document_id:'d',block_id:'b'+i,type:'direction',properties:{text:'x'.repeat(50_000)}});
  let finished=false;
  await assert.rejects(f.reduce(await f.capture(),()=>{const consumer=createSceneContextConsumer({documentId:'d',projectId:'p'});return {...consumer,finish(){finished=true;return consumer.finish();}};}),/output_source_proof_too_large/);
  assert.equal(finished,false);
});

test('renewal lineage exceeding 99 total bindings keeps every guard in each atomic page batch',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),batch=f.env.DB.batch;
  const assertions=Array.from({length:60},(_,i)=>({sql:'?=?',bindings:[i,i]}));let observed=0;
  f.env.DB.batch=async statements=>{observed++;assert.ok(statements.length>2);
    assert.ok(statements.every(s=>s.bindings.length<=99));
    const all=statements.slice(1).flatMap(s=>s.bindings);
    for(let i=0;i<60;i++)assert.ok(all.includes(i),`guard ${i} retained`);
    return batch(statements);};
  const result=await f.reduce(version,()=>({accept(){return true;},finish(){return 'complete';}}),{readAssertions:assertions});
  assert.equal(result.value,'complete');assert.ok(observed>=4);assert.ok(result.assertions.length>=assertions.length);
  for(const position of [0,30,59]){
    let finished=false;const invalid=assertions.map((a,i)=>i===position?{...a,bindings:[i,-1]}:a);
    await assert.rejects(f.reduce(version,()=>({accept(){return true;},finish(){finished=true;}}),{readAssertions:invalid}),/output_source_changed/);
    assert.equal(finished,false);
  }
});

test('lineage batching still refuses a missing guard result and oversized individual predicate',async t=>{
  const f=fixture(t);f.event(1,'Fixture',{});const version=await f.capture(),batch=f.env.DB.batch;let finished=false;
  const consumer=()=>({accept(){return true;},finish(){finished=true;}});
  const readAssertions=Array.from({length:60},()=>({sql:'?=?',bindings:[1,1]}));
  f.env.DB.batch=async statements=>{const result=await batch(statements);result.pop();return result;};
  await assert.rejects(f.reduce(version,consumer,{readAssertions}),/output_source_changed/);
  for(const position of ['first','middle','last']){
    f.env.DB.batch=async statements=>{const result=await batch(statements);
      delete result[position==='first'?1:position==='last'?result.length-1:Math.floor(result.length/2)];return result;};
    await assert.rejects(f.reduce(version,consumer,{readAssertions}),/output_source_changed/);
  }
  f.env.DB.batch=batch;
  await assert.rejects(f.reduce(version,consumer,{readAssertions:[{sql:Array(100).fill('?').join(' AND '),bindings:Array(100).fill(1)}]}),/output_source_proof_too_large/);
  await assert.rejects(f.reduce(version,consumer,{readAssertions:Array.from({length:520},()=>({sql:'1',bindings:[]}))}),/output_source_proof_too_large/);
  assert.equal(finished,false);
});
