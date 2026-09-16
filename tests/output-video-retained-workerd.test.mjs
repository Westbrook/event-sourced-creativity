import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {videoRetainedFixture} from './output-video-retained-fixture.mjs';
import {assertStoryboardJobSchema} from './output-storyboard-job-schema.mjs';
import {readRetainedWitnessInWorkerd} from './helpers/retained-witness-workerd.mjs';
import {exportSynthetic} from './helpers/model3d-workerd-snapshot.mjs';
import {outputDatabaseFailureKind} from '../worker/output-database-diagnostic.ts';
const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network_forbidden');};test.after(()=>{globalThis.fetch=oldFetch;});
test('actual native Video retained GET qualifies exact final proof in workerd and rejects late withdrawal',async()=>{
 const C=process.env.FORMA_SOURCE_ROOT;
 const {outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');
 const {ensureSchema,appendAuditEvent,appendEvents,makeEvent}=await import(C+'/worker/runtime.ts');
 const {handleNativeRetainedOutputRead}=await import('../worker/retained-story-api.ts');
 const {nativeRetainedOutputRequestPath}=await import(C+'/src/model/native-retained-output.ts');
 const f=await videoRetainedFixture(),g=outputTestDatabase();
 try{
  await ensureSchema(g.env);
  const now=new Date().toISOString();
  g.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('owner','owner@example.test','Owner','creator','pilot-2026-08-10',?,?,?)").run(now,now,now);
  await appendAuditEvent(g.env,'creative:owner','user','DocumentCreated',{document_id:'doc',project_id:'project',title:'Keeper'});
  const completed=makeEvent('creative:owner',0,'worker:renderer','server:document-job:render_document','corr','DocumentRenderCompleted',f.payload);
  await appendEvents(g.env,[completed]);
  f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.appendedEventIds',json(?))").run(JSON.stringify([completed.eventId]));
  f.sqlite.prepare('UPDATE output_operation_slots SET outcome_event_id=?').run(completed.eventId);
  f.sqlite.prepare('UPDATE output_native_storage_writes SET publication_event_id=?').run(completed.eventId);
  // Copy the explicit offline evidence fixture, not a completed-auth object.
  // The production endpoint executes its own hosted principal query below.
  const defaults={
   output_plan_revisions:{plan_id:'fixture-plan',revision:1,confirmed_event_id:completed.eventId,requirements_digest:'fixture-requirements',source_digest:'source',resolver_version:'fixture',source_head:1,target_count:1,created_at:now},
   output_execution_grants:{plan_revision_id:'plan',payer_user_id:'owner',preflight_id:'fixture-preflight',authorization_event_id:completed.eventId,maximum_microusd:2210000,maximum_calls:2,created_at:now},
   output_operation_slots:{provider:'fal',model:f.mediaAttempt.model,cost_reservation_id:'fixture-cost',token_reservation_id:'fixture-tokens',maximum_microusd:2210000,maximum_calls:2,maximum_tokens:100000,created_at:now,updated_at:now},
   output_provider_calls:{reserved_microusd:2210000,created_at:now,settled_at:now},output_native_storage_writes:{created_at:now,updated_at:now},
  };
  for(const table of ['output_plan_revisions','output_execution_grants','output_operation_slots','output_provider_calls','output_native_storage_writes','private_content']){
   if(!g.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))g.sqlite.exec(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql);
   for(const sourceRow of f.sqlite.prepare('SELECT * FROM '+table).all()){
    const row={...(defaults[table]??{}),...sourceRow};
    const keys=Object.keys(row);g.sqlite.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));
   }
   if(table==='output_plan_revisions'){
    g.sqlite.prepare("INSERT INTO output_plan_targets VALUES('scope','plan','target','target-contract','document',1,1,0)").run();
    g.sqlite.prepare("INSERT INTO output_preflights VALUES('scope','fixture-preflight','plan','owner','fixture-terms',?,?,?)").run(completed.eventId,f.job.expires_at,now);
   }
   if(table==='output_operation_slots')for(const call of f.sqlite.prepare('SELECT * FROM output_provider_calls').all())g.sqlite.prepare("INSERT INTO output_operation_routes VALUES('scope','slot',?,?,?,1)").run(call.stage_key,call.provider,call.model);
  }
  assertStoryboardJobSchema(g.sqlite);
  const job={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),requested_sequence:1,requested_at:now};
  const keys=Object.keys(job);g.sqlite.prepare('INSERT INTO document_jobs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>job[key]));
  g.sqlite.prepare("INSERT INTO private_content VALUES('content','owner','document-artifact',?,?,?,NULL)").run(f.input.rawContent,now,f.job.expires_at);
  let beforeFinal;
  const env={...g.env,MEDIA:f.env.MEDIA,DB:{prepare(sql){assert.match(sql,/^\s*(WITH|SELECT)\b/i);
   const p=g.DB.prepare(sql),wrap=values=>({bind(...v){return wrap(v);},async first(){
    if(sql.includes('expected_events AS')){
     await beforeFinal?.();
     const expected=await p.bind(...values).first();
     let actual;try{actual=await readRetainedWitnessInWorkerd(exportSynthetic(g.sqlite),{sql,bindings:values});}
     catch(error){console.log('synthetic Video final D1',outputDatabaseFailureKind(error),{sqlBytes:Buffer.byteLength(sql),bindings:values.length});throw error;}
     assert.deepEqual(actual,expected===null?null:{...expected},'real D1 preserves exact final witness result');
     return actual;
    }
    return p.bind(...values).first();
   },async all(){return p.bind(...values).all();}});
   return wrap([]);
  },batch(){throw Error('read attempted mutation');}}};
  const selection={documentId:'doc',artifactId:f.artifactId,revision:0,contentSha256:createHash('sha256').update(f.input.rawContent).digest('hex')};
  const request=()=>new Request('https://forma.test'+nativeRetainedOutputRequestPath({output:'video',selection}),{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}});
  const before=g.sqlite.prepare('SELECT total_changes() n').get().n;
  const response=await handleNativeRetainedOutputRead(request(),env);assert.equal(response.status,200,await response.clone().text());
  const dto=await response.json();assert.equal(dto.output,'video');assert.equal(dto.content.clips.length,1);
  assert.deepEqual(dto.content.clips.map(clip=>[clip.title,clip.body,clip.notes]),f.artifact.items.map(item=>[item.title,item.body,item.notes]));
  assert.equal(dto.content.primaryMedia.mediaType,'video/mp4');
  assert.equal(g.sqlite.prepare('SELECT total_changes() n').get().n,before);
  beforeFinal=()=>g.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='owner'").run();
  assert.equal((await handleNativeRetainedOutputRead(request(),env)).status,404);
  g.sqlite.prepare("UPDATE users SET consent_version='pilot-2026-08-10' WHERE user_id='owner'").run();
  beforeFinal=()=>g.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.document_snapshot','changed') WHERE content_id='input'").run();
  assert.equal((await handleNativeRetainedOutputRead(request(),env)).status,404);
 }finally{f.sqlite.close();g.sqlite.close();}
});
