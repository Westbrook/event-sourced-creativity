import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {POLICY_VERSION} from '../worker/policy-version.ts';
import {EVENT_WRITE_STAGE_TRIGGER_SQL,EVENT_WRITE_COLUMNS,eventWriteBindings,makeEvent} from '../worker/event-write-primitives.ts';
import {outputAssertionStatements,commitOutputCommand} from '../worker/output-command-core.ts';
import {captureSceneSourceVersion} from '../worker/scene-source-generation.ts';
import {prepareSceneJobSourceTransition,readSceneJobSourceWitness,prepareSceneJobSourceClaim} from '../worker/scene-job-source-witness.ts';

function fixture(t,correlationId='correlation'){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  migrateLocalDatabase(db,{migrations:readLocalMigrations(new URL('../drizzle/',import.meta.url))});
  db.exec('DROP TRIGGER IF EXISTS event_write_stage_after_insert');db.exec(EVENT_WRITE_STAGE_TRIGGER_SQL);
  const prepare=(sql,bindings=[])=>({sql,bindings,bind(...values){return prepare(sql,values);},async first(){return db.prepare(sql).get(...bindings)??null;}});
  let rewrite=r=>r;
  const env={DB:{prepare,async batch(statements){db.exec('BEGIN');let results;try{
    results=statements.map(s=>{const q=db.prepare(s.sql);if(q.columns().length)return{success:true,results:q.all(...s.bindings),meta:{changes:0}};
      const r=q.run(...s.bindings);return{success:true,results:[],meta:{changes:Number(r.changes)}};});db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return rewrite(results);}}};
  const scope={kind:'personal',key:'personal:witness:project',ownerUserId:'witness',actorUserId:'witness',projectId:'project',documentId:'document',organizationId:null,projectAccessId:null,contextId:null};
  const slot={scopeKey:scope.key,slotId:'slot',grantId:'grant',planRevisionId:'plan',targetId:'target',routeDigest:'route',sourceDigest:'source',jobId:'job',attemptOrdinal:0,previousSlotId:null};
  const event=sequence=>makeEvent('creative:witness',sequence,'witness','fixture',correlationId,'DocumentRenderRequested',{project_id:'project',document_id:'document'});
  const stage=e=>env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${eventWriteBindings(e).map(()=>'?').join(',')})`).bind(...eventWriteBindings(e));
  db.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,created_at,updated_at) VALUES('witness','witness@invalid','Fixture','creator',?,'now','now')").run(POLICY_VERSION);
  const anchor=event(1),statement=stage(anchor);db.prepare(statement.sql).run(...statement.bindings);
  db.prepare("INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at) VALUES(?,'personal','witness','project','document','plan','plan',1,?,'requirements','source','v1',1,1,'now')").run(scope.key,anchor.eventId);
  db.prepare("INSERT INTO output_plan_targets(scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) VALUES(?,'plan','target','contract','video',1,1,0)").run(scope.key);
  db.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,'preflight','plan','witness','terms',?,'2999-01-01','now')").run(scope.key,anchor.eventId);
  db.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,'grant','plan','witness','witness','preflight',?,1000,1,'authorized','2999-01-01','now')").run(scope.key,anchor.eventId);
  db.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,status,created_at,updated_at) VALUES(?,'slot','grant','plan','target','contract','source','fixture','fixture','route','job','cost','tokens',1000,1,100,'queued','now','now')").run(scope.key);
  const job=env.DB.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at) VALUES('job','witness','creative:witness','document','render_document','queued','outputs',?,2,'{\"artifactKind\":\"scene\"}','now','2999-01-01','now')").bind(correlationId);
  const guards=assertions=>assertions.flatMap(a=>outputAssertionStatements(env,a));
  const transition=(version,previousRaw,phase,events)=>prepareSceneJobSourceTransition(env,{scope,slot,correlationId,predecessor:version,previousRaw,phase,events});
  async function admit(){const original=await captureSceneSourceVersion(env,{streamId:'creative:witness'}),own=event(2),prepared=transition(original,null,'admission',[own]);
    const results=await env.DB.batch([...guards(prepared.before),stage(own),job,...prepared.after]);return{original,...prepared.acknowledge(results.slice(-prepared.after.length))};}
  async function run(){const admitted=await admit();await commitOutputCommand(env,{scope,permission:'request',expectedHead:2,expectedProjectHead:0,key:'run',digest:'run-digest',action:'run',
    sceneJobRuns:[{slot,version:admitted.successor,previousRaw:admitted.raw}],events:[{type:'OutputExecutionRunRequested',payload:{grant_id:'grant',job_ids:['job']}}],
    buildSidecars:()=>({statements:[env.DB.prepare("UPDATE output_execution_grants SET status='active'"),env.DB.prepare("UPDATE output_operation_slots SET status='queued'")],assertions:[]})});
    const read=await readSceneJobSourceWitness(env,scope,slot,correlationId);return{...read,successor:read.witness.successor};}
  return{db,env,scope,slot,event,stage,job,guards,transition,admit,run,rewrite:fn=>rewrite=fn};
}
test('durable admission and execution retain exact source successors across result updates',async t=>{
  const f=fixture(t),first=await f.admit();
  f.db.prepare("UPDATE document_jobs SET result_json='{}'").run();
  const read=await readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation');assert.equal(read.raw,first.raw);
  const own=f.event(3),prepared=f.transition(first.successor,first.raw,'execution',[own]);
  const results=await f.env.DB.batch([...f.guards(prepared.before),f.stage(own),...prepared.after]);
  const next=prepared.acknowledge(results.slice(-prepared.after.length));assert.ok(next.successor.streamGeneration>first.successor.streamGeneration);
  assert.deepEqual(next.witness.eventIds,[own.eventId]);assert.deepEqual(next.witness.predecessor,first.successor);
  assert.equal((await readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation')).raw,next.raw);
});
test('unrelated source change rolls back exact attempted execution and preserves receipt',async t=>{
  const f=fixture(t),first=await f.admit(),other=f.event(3);await f.env.DB.batch([f.stage(other)]);
  const own=f.event(4),prepared=f.transition(first.successor,first.raw,'execution',[own]);
  await assert.rejects(f.env.DB.batch([...f.guards(prepared.before),f.stage(own),...prepared.after]),/CHECK/);
  assert.equal(f.db.prepare('SELECT scene_source_version_json value FROM document_jobs').get().value,first.raw);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,3);
});
for(const mutation of ["UPDATE output_execution_grants SET status='revoked'","UPDATE document_jobs SET expires_at='2000-01-01'","UPDATE output_operation_slots SET route_digest='different'","UPDATE document_jobs SET correlation_id='different'","UPDATE document_jobs SET status='running',lease_expires_at='2000-01-01'"])
  test(`durable receipt refuses changed custody: ${mutation}`,async t=>{const f=fixture(t);await f.admit();f.db.exec(mutation);await assert.rejects(readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation'));});
test('lost ACK retains durable transition without repeating writes',async t=>{
  const f=fixture(t),first=await f.admit(),own=f.event(3),prepared=f.transition(first.successor,first.raw,'execution',[own]);
  f.rewrite(()=>{throw new Error('lost ACK');});await assert.rejects(f.env.DB.batch([...f.guards(prepared.before),f.stage(own),...prepared.after]),/lost ACK/);
  f.rewrite(r=>r);const receipt=await readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation');
  assert.deepEqual(receipt.witness.eventIds,[own.eventId]);assert.deepEqual(receipt.witness.predecessor,first.successor);
  await f.env.DB.batch(f.guards(receipt.assertions));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,3);
});
for(const corrupt of [r=>r.slice(1),r=>[...r,r[0]],r=>{delete r[1];return r;},r=>{r[0].success=false;return r;}])
  test('partial acknowledgement cannot establish an in-memory successor',async t=>{const f=fixture(t),first=await f.admit(),own=f.event(3),prepared=f.transition(first.successor,first.raw,'execution',[own]);
    const results=await f.env.DB.batch([...f.guards(prepared.before),f.stage(own),...prepared.after]);
    assert.throws(()=>prepared.acknowledge(corrupt(results.slice(-prepared.after.length))),/output_scene_source_witness_unavailable/);
    assert.throws(()=>prepared.acknowledge(results.slice(-prepared.after.length)),/output_scene_source_witness_unavailable/);
  });
test('first claim rebinds correlation atomically without changing approved source lineage',async t=>{
  const f=fixture(t,'job'),first=await f.run(),claim=prepareSceneJobSourceClaim(f.env,{scope:f.scope,slot:f.slot,previousRaw:first.raw,previousCorrelationId:'job',correlationId:'job:attempt:1'});
  const results=await f.env.DB.batch([...f.guards(claim.before),f.env.DB.prepare("UPDATE document_jobs SET correlation_id='job:attempt:1',status='running',attempt_count=1,lease_expires_at='2999-01-01' WHERE job_id='job'"),...claim.after]);
  const acknowledged=claim.acknowledge(results.slice(-claim.after.length));assert.deepEqual(acknowledged.witness.successor,first.successor);
  assert.deepEqual(acknowledged.witness.predecessor,first.witness.predecessor);assert.deepEqual(acknowledged.witness.eventIds,first.witness.eventIds);
  assert.equal((await readSceneJobSourceWitness(f.env,f.scope,f.slot,'job:attempt:1')).raw,acknowledged.raw);
  await assert.rejects(readSceneJobSourceWitness(f.env,f.scope,f.slot,'job'));
});
test('changed source makes first claim roll back rather than rebase',async t=>{
  const f=fixture(t,'job'),first=await f.run(),claim=prepareSceneJobSourceClaim(f.env,{scope:f.scope,slot:f.slot,previousRaw:first.raw,previousCorrelationId:'job',correlationId:'job:attempt:1'});
  await f.env.DB.batch([f.stage(f.event(4))]);
  await assert.rejects(f.env.DB.batch([...f.guards(claim.before),f.env.DB.prepare("UPDATE document_jobs SET correlation_id='job:attempt:1',status='running',attempt_count=1,lease_expires_at='2999-01-01' WHERE job_id='job'"),...claim.after]),/CHECK/);
  const row=f.db.prepare('SELECT * FROM document_jobs').get();assert.equal(row.status,'queued');assert.equal(row.attempt_count,0);assert.equal(row.scene_source_version_json,first.raw);
});
test('claim cannot skip the Run transition',async t=>{const f=fixture(t,'job'),first=await f.admit();
  assert.throws(()=>prepareSceneJobSourceClaim(f.env,{scope:f.scope,slot:f.slot,previousRaw:first.raw,previousCorrelationId:'job',correlationId:'job:attempt:1'}),/output_scene_source_witness_unavailable/);
});
test('array-like malformed result cannot supply a durable receipt',async t=>{
  const f=fixture(t);await f.admit();f.rewrite(r=>{const row=r.at(-1);row.results={0:row.results[0],length:1};return r;});
  await assert.rejects(readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation'),/output_scene_source_witness_unavailable/);
});
test('receipt parser rejects unrecognized fields and oversized execution range',async t=>{
  const f=fixture(t),first=await f.admit();
  for(const value of [{...first.witness,extra:'unrecognized'},{...first.witness,phase:'execution',eventIds:Array.from({length:9},(_,i)=>`event${i}`),eventSequences:Array.from({length:9},(_,i)=>i+1)}]){
    f.db.prepare('UPDATE document_jobs SET scene_source_version_json=?').run(JSON.stringify(value));
    await assert.rejects(readSceneJobSourceWitness(f.env,f.scope,f.slot,'correlation'),/output_scene_source_witness_unavailable/);
  }
});
test('actual command admission commits private witness after command and job writes',async t=>{
  const f=fixture(t,'job'),version=await captureSceneSourceVersion(f.env,{streamId:'creative:witness'});
  const input={scope:f.scope,permission:'request',expectedHead:1,expectedProjectHead:0,key:'admission',digest:'digest',action:'authorize',
    sceneJobAdmissions:[{slot:f.slot,version}],events:[{type:'OutputExecutionAuthorized',payload:{grant_id:'grant'}}],
    buildSidecars:()=>({statements:[f.job],assertions:[]})};
  const result=await commitOutputCommand(f.env,input);assert.equal(result.replayed,false);
  const stored=await readSceneJobSourceWitness(f.env,f.scope,f.slot,'job');assert.deepEqual(stored.witness.eventIds,result.events.map(e=>e.eventId));
  assert.deepEqual(stored.witness.predecessor,version);assert.equal(JSON.stringify(result).includes('scene_source_version_json'),false);
  assert.equal(JSON.stringify(result).includes('instanceNonce'),false);
  const replay=await commitOutputCommand(f.env,input);assert.equal(replay.replayed,true);
  assert.equal((await readSceneJobSourceWitness(f.env,f.scope,f.slot,'job')).raw,stored.raw);
});
test('actual admission lost ACK leaves its exact private receipt recoverable',async t=>{
  const f=fixture(t,'job'),version=await captureSceneSourceVersion(f.env,{streamId:'creative:witness'});
  f.rewrite(()=>{throw new Error('lost ACK');});
  const result=await commitOutputCommand(f.env,{scope:f.scope,permission:'request',expectedHead:1,expectedProjectHead:0,key:'admission',digest:'digest',action:'authorize',
    sceneJobAdmissions:[{slot:f.slot,version}],events:[{type:'OutputExecutionAuthorized',payload:{grant_id:'grant'}}],buildSidecars:()=>({statements:[f.job],assertions:[]})});
  assert.equal(result.replayed,true);f.rewrite(r=>r);
  const stored=await readSceneJobSourceWitness(f.env,f.scope,f.slot,'job');assert.deepEqual(stored.witness.predecessor,version);
  assert.deepEqual(stored.witness.eventIds,[result.receipt.eventId]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,2);
});
test('suffix refuses a stored event ID with a different sequence',async t=>{
  const f=fixture(t),first=await f.admit(),own=f.event(3),wrong={...own,sequence:4},prepared=f.transition(first.successor,first.raw,'execution',[wrong]);
  await assert.rejects(f.env.DB.batch([...f.guards(prepared.before),f.stage(own),...prepared.after]),/CHECK/);
  assert.equal(f.db.prepare('SELECT scene_source_version_json value FROM document_jobs').get().value,first.raw);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,2);
});
test('expiry removes the private witness even when request content was already redacted',async t=>{
  const {EXPIRED_DOCUMENT_JOB_REDACTION_SQL}=await import('../worker/document-jobs-api.ts');
  const f=fixture(t);await f.admit();f.db.exec("UPDATE document_jobs SET request_json='{}',result_json=NULL");
  f.db.exec(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL}`);
  const row=f.db.prepare('SELECT * FROM document_jobs').get();assert.equal(row.scene_source_version_json,null);assert.equal(row.request_json,'{}');
});
