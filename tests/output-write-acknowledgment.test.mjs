import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {commitOutputCommand,retainedOutputBodyAssertions} from '../worker/output-command-core.ts';
import {guardOutputPrivateWrites} from '../worker/output-private-execution.ts';
import {POLICY_VERSION} from '../worker/policy-version.ts';
import {EVENT_WRITE_STAGE_TRIGGER_SQL} from '../worker/event-write-primitives.ts';
import {captureSceneSourceVersion,sceneSourceVersionAssertions,prepareSceneSourceTransition} from '../worker/scene-source-generation.ts';

const scope=()=>({kind:'personal',key:'personal:ack:project',ownerUserId:'ack',actorUserId:'ack',projectId:'project',documentId:'document',organizationId:null,projectAccessId:null,contextId:null});
const corruptions={empty:()=>[],truncated:r=>r.slice(0,-1),extra:r=>[...r,r[0]],sparse:r=>{delete r[0];return r;},failed:r=>{r.at(-1).success=false;return r;},missingSuccess:r=>{delete r[0].success;return r;}};
function database(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());migrateLocalDatabase(db,{migrations:readLocalMigrations(new URL('../drizzle/',import.meta.url))});
  db.exec('DROP TRIGGER IF EXISTS event_write_stage_after_insert');db.exec(EVENT_WRITE_STAGE_TRIGGER_SQL);
  db.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,created_at,updated_at) VALUES('ack','ack@invalid','Fixture','creator',?,'now','now')").run(POLICY_VERSION);
  let writes=0,rewrite=r=>r;
  const prepare=(sql,bindings=[])=>({sql,bindings,bind(...values){return prepare(sql,values);},async first(){return db.prepare(sql).get(...bindings)??null;}});
  const env={DB:{prepare,async batch(statements){writes++;db.exec('BEGIN');let results;try{
    results=statements.map(s=>{const q=db.prepare(s.sql);if(q.columns().length)return{success:true,results:q.all(...s.bindings),meta:{changes:0}};
      const r=q.run(...s.bindings);return{success:true,results:[],meta:{changes:Number(r.changes)}};});db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return rewrite(results);}}};
  return{db,env,counts:()=>writes,rewrite:fn=>rewrite=fn};
}
const command=s=>({scope:s,permission:'author',expectedHead:0,expectedProjectHead:0,key:'same-command',digest:'same-digest',action:'qualification',events:[{type:'DocumentOpened',payload:{}}]});
for(const [name,rewrite] of Object.entries(corruptions))test(`actual command ${name} ACK preserves uncertainty without fabricated body proof`,async t=>{
  const f=database(t),s=scope();f.rewrite(rewrite);
  await assert.rejects(commitOutputCommand(f.env,command(s)),e=>e.code==='output_write_acknowledgment_invalid');
  assert.equal(f.counts(),1);assert.equal(f.db.prepare('SELECT count(*) n FROM events').get().n,1);
  assert.deepEqual(retainedOutputBodyAssertions(s),[]);
  f.rewrite(r=>r);const recovered=await commitOutputCommand(f.env,command(s));
  assert.equal(recovered.replayed,true);assert.deepEqual(recovered.events,[]);assert.equal(f.counts(),1);
});
test('complete command ACK retains the exact new private body',async t=>{
  const f=database(t),s=scope(),result=await commitOutputCommand(f.env,command(s));
  assert.equal(result.replayed,false);assert.equal(result.events.length,1);assert.ok(retainedOutputBodyAssertions(s).length);
});
for(const [name,rewrite] of Object.entries(corruptions))test(`actual private wrapper rejects ${name} complete-batch ACK before slicing`,async()=>{
  let calls=0;const prepare=(sql,bindings=[])=>({sql,bindings,bind(...values){return prepare(sql,values);}});
  const env={MEDIA:{},DB:{prepare,async batch(statements){calls++;return rewrite(statements.map(()=>({success:true,results:[],meta:{changes:1}})));}}};
  const wrapped=guardOutputPrivateWrites(env,scope(),{slotId:'slot'},async()=>[{sql:'1'}]);
  await assert.rejects(wrapped.DB.batch([wrapped.DB.prepare('UPDATE private_content SET redacted_at=?').bind('fixture')]),e=>e.code==='output_write_acknowledgment_invalid');
  assert.equal(calls,1);
});
test('actual private wrapper preserves caller result indices after its guard prefix',async()=>{
  let expected;const prepare=(sql,bindings=[])=>({sql,bindings,bind(...values){return prepare(sql,values);}});
  const env={MEDIA:{},DB:{prepare,async batch(statements){const r=statements.map((_,index)=>({success:true,results:[],meta:{changes:index}}));expected=r.slice(2);return r;}}};
  const wrapped=guardOutputPrivateWrites(env,scope(),{slotId:'slot'},async()=>[{sql:'1'}]);
  const actual=await wrapped.DB.batch([wrapped.DB.prepare('UPDATE private_content SET redacted_at=?').bind('fixture'),wrapped.DB.prepare('SELECT 1')]);
  assert.equal(actual.length,2);assert.equal(actual[0],expected[0]);assert.equal(actual[1],expected[1]);
});
const current=(f,version)=>sceneSourceVersionAssertions(version).every(a=>f.db.prepare(`SELECT (${a.sql}) AS current`).get(...a.bindings??[]).current===1);
test('actual command captures its source successor in the same acknowledged transaction',async t=>{
  const f=database(t),s=scope(),original=await captureSceneSourceVersion(f.env,{streamId:'creative:ack'});
  const result=await commitOutputCommand(f.env,{...command(s),sceneSourceVersion:original});
  assert.equal(result.replayed,false);assert.ok(result.sceneSourceVersion);assert.ok(Object.isFrozen(result.sceneSourceVersion));
  assert.equal(result.sceneSourceVersion.instanceNonce,original.instanceNonce);assert.equal(result.sceneSourceVersion.epoch,original.epoch);
  assert.ok(result.sceneSourceVersion.streamGeneration>original.streamGeneration);
  assert.equal(current(f,original),false);assert.equal(current(f,result.sceneSourceVersion),true);
  const replay=await commitOutputCommand(f.env,{...command(s),sceneSourceVersion:original});
  assert.equal(replay.replayed,true);assert.equal(replay.sceneSourceVersion,undefined);
});
test('changed original source cannot commit or capture a successor',async t=>{
  const f=database(t),s=scope(),original=await captureSceneSourceVersion(f.env,{streamId:'creative:ack'});
  await commitOutputCommand(f.env,{...command(s),key:'other'});
  await assert.rejects(commitOutputCommand(f.env,{...command(s),expectedHead:1,sceneSourceVersion:original}),e=>e.code==='output_revision_or_authority_changed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM events').get().n,1);
});
test('lost command ACK recovers its command identity but never invents a successor',async t=>{
  const f=database(t),s=scope(),original=await captureSceneSourceVersion(f.env,{streamId:'creative:ack'});
  f.rewrite(()=>{throw new Error('lost acknowledgment');});
  const result=await commitOutputCommand(f.env,{...command(s),sceneSourceVersion:original});
  assert.equal(result.replayed,true);assert.equal(result.sceneSourceVersion,undefined);assert.deepEqual(result.events,[]);
});
test('source transition cannot change scope or accept an epoch switch',async t=>{
  const f=database(t),s=scope(),original=await captureSceneSourceVersion(f.env,{streamId:'creative:other'});
  await assert.rejects(commitOutputCommand(f.env,{...command(s),sceneSourceVersion:original}),e=>e.code==='output_scene_source_changed');
  const transition=prepareSceneSourceTransition(f.env,original);
  const results=Array.from({length:3},()=>({success:true,results:[]}));
  results[2].results=[{instance_nonce:original.instanceNonce,epoch:original.epoch+1,stream_generation:1,project_generation:0}];
  assert.throws(()=>transition.acknowledge(results,3,2),/scene_source_version_unavailable/);
  results[2].results[0].epoch=original.epoch;
  assert.throws(()=>transition.acknowledge(results,3,2),/scene_source_version_unavailable/,'failed acknowledgement is terminal');
});
