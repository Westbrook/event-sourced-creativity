import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {SCENE_SOURCE_GENERATION_TRIGGERS,SCENE_SOURCE_GENERATION_MAX} from '../db/scene-source-generations.ts';
import {SCENE_SOURCE_GENERATION_TABLES} from '../db/scene-source-generation-tables.ts';
import {captureSceneSourceVersion,sceneSourceVersionAssertions,sceneSourceRebuildStatements} from '../worker/scene-source-generation.ts';
import {migrateLegacyEventPayloads} from '../worker/event-privacy-migration.ts';
import {ensureSchema} from '../worker/runtime.ts';

const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
const migration=migrations.find(value=>value.tag==='0038_scene_source_generations');
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  migrateLocalDatabase(db,{migrations});
  const prepare=sql=>({sql,bindings:[],bind(...bindings){return{...this,bindings};},
    async all(){return{success:true,results:db.prepare(sql).all(...this.bindings)};},
    async first(){return db.prepare(sql).get(...this.bindings)??null;},
    async run(){return{success:true,meta:db.prepare(sql).run(...this.bindings)};}});
  const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{
    const results=statements.map(s=>({success:true,results:db.prepare(s.sql).all(...s.bindings)}));
    db.exec('COMMIT');return results;
  }catch(error){db.exec('ROLLBACK');throw error;}}}};
  const check=token=>{for(const a of sceneSourceVersionAssertions(token)) assert.equal(db.prepare(`SELECT (${a.sql}) AS current`).get(...a.bindings).current,1);};
  const event=(id,stream='creative:a',sequence=1)=>db.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload)
    VALUES(?,?,?,'2026-09-14','2026-09-14','user:a','fixture','fixture',1,'Test','{}')`).run(id,stream,sequence);
  const secret=(id,value='private')=>db.prepare(`INSERT INTO event_private_payloads VALUES(?,'a','project','document',?,'2026-09-14',NULL)`).run(id,value);
  const membership=(id,access='access-a',sequence=1)=>db.prepare(`INSERT INTO project_event_scopes VALUES(?,?,'org','project','a','creative:a',?,?, 'a','2026-09-14')`).run(id,access,sequence,sequence);
  return {db,env,event,secret,membership,check,capture:(scope={streamId:'creative:a'})=>captureSceneSourceVersion(env,scope)};
}
test('generated additive migration exactly matches runtime schema/triggers and can reconcile twice',t=>{
  assert.ok(migration);const statements=migration.sql.split('--> statement-breakpoint').map(s=>s.trim().replace(/;$/,'')).filter(Boolean);
  assert.deepEqual(statements,[...SCENE_SOURCE_GENERATION_TABLES.map(x=>x.sql),...SCENE_SOURCE_GENERATION_TRIGGERS.map(x=>x.sql)]);
  const f=fixture(t);assert.equal(migrateLocalDatabase(f.db,{migrations}).migrations.at(-1).status,'already-applied');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM scene_source_epoch').get().n,0);
});
test('activation is one bounded nonce and immutable original token, without a history backfill',async t=>{
  const f=fixture(t),first=await f.capture(),again=await f.capture();assert.deepEqual(first,again);f.check(first);
  assert.ok(Object.isFrozen(first));assert.equal(first.streamGeneration,0);assert.equal(first.projectGeneration,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM scene_source_generations').get().n,0);
  f.event('new');assert.throws(()=>f.check(first));
});
test('explicit preparation authority is atomic with nonce activation and idempotent',async t=>{
  const f=fixture(t);f.event('a');
  await assert.rejects(captureSceneSourceVersion(f.env,{streamId:'creative:a'},[{sql:'0',bindings:[]}]))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM scene_source_epoch').get().n,0);
  const first=await captureSceneSourceVersion(f.env,{streamId:'creative:a'},[{sql:'1',bindings:[]}]);
  const again=await captureSceneSourceVersion(f.env,{streamId:'creative:a'},[{sql:'1',bindings:[]}]);assert.deepEqual(first,again);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM scene_source_epoch').get().n,1);
  await assert.rejects(captureSceneSourceVersion(f.env,{streamId:'creative:a'},[{sql:'0',bindings:[]}]))
  f.check(first);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,1);
});
test('preparation prefix rejects malformed own acknowledgments without reading getters',async t=>{
  const f=fixture(t),batch=f.env.DB.batch;let touched=0;
  f.env.DB.batch=async statements=>{const result=await batch(statements);Object.defineProperty(result,0,{get(){touched++;return {success:true,results:[{current:1}]};}});return result;};
  await assert.rejects(captureSceneSourceVersion(f.env,{streamId:'creative:a'},[{sql:'1',bindings:[]}]),/scene_source_version_unavailable/);
  assert.equal(touched,0);
});
test('private edit and restore, redaction, deletion and metadata changes invalidate original without owner head change',async t=>{
  const f=fixture(t);f.event('a');f.secret('a');
  for(const sql of ["UPDATE event_private_payloads SET private_json='changed'","UPDATE event_private_payloads SET private_json='private'",
    "UPDATE event_private_payloads SET owner_id='other'","UPDATE event_private_payloads SET redacted_at='now'","DELETE FROM event_private_payloads"]){
    const original=await f.capture();f.db.exec(sql);assert.throws(()=>f.check(original));
    assert.equal(f.db.prepare('SELECT MAX(sequence) AS n FROM events').get().n,1);
  }
});
test('public insert-or-replace invalidates old and new stream despite recursive triggers disabled',async t=>{
  const f=fixture(t);f.db.exec('PRAGMA recursive_triggers=OFF');f.event('a');
  const a=await f.capture(),b=await f.capture({streamId:'creative:b'});
  f.db.exec("INSERT OR REPLACE INTO events SELECT event_id,'creative:b',sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload FROM events WHERE event_id='a'");
  assert.throws(()=>f.check(a));assert.throws(()=>f.check(b));
});
test('public unique sequence and explicit rowid replacement invalidate displaced scope',async t=>{
  const f=fixture(t);f.event('a');f.event('b','creative:b');
  const original=await f.capture(),other=await f.capture({streamId:'creative:b'});
  const rowid=f.db.prepare("SELECT rowid AS n FROM events WHERE event_id='a'").get().n;
  f.db.prepare(`INSERT OR REPLACE INTO events(rowid,event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload)
    VALUES(?,'replacement','creative:b',1,'now','now','user:b','fixture','fixture',1,'Test','{}')`).run(rowid);
  assert.throws(()=>f.check(original));assert.throws(()=>f.check(other));assert.equal(f.db.prepare('SELECT count(*) AS n FROM events').get().n,1);
});
test('private update-or-replace invalidates moved and displaced event streams',async t=>{
  const f=fixture(t);f.event('a');f.event('b','creative:b');f.secret('a');f.secret('b');
  const a=await f.capture(),b=await f.capture({streamId:'creative:b'});
  f.db.exec("UPDATE OR REPLACE event_private_payloads SET private_event_id='b' WHERE private_event_id='a'");
  assert.throws(()=>f.check(a));assert.throws(()=>f.check(b));
});
test('orphan membership, reassignment and replacement invalidate all original project scopes',async t=>{
  const f=fixture(t);f.membership('orphan-a');f.membership('orphan-b','access-b');
  const a=await f.capture({streamId:'creative:a',projectAccessId:'access-a'}),b=await f.capture({streamId:'creative:a',projectAccessId:'access-b'});
  f.db.exec("UPDATE OR REPLACE project_event_scopes SET project_access_id='access-b' WHERE event_id='orphan-a'");
  assert.throws(()=>f.check(a));assert.throws(()=>f.check(b));
  const c=await f.capture({streamId:'creative:a',projectAccessId:'access-b'});f.db.exec("DELETE FROM project_event_scopes");assert.throws(()=>f.check(c));
});
test('ignored membership sync keeps row/changes receipt semantics, permitting conservative invalidation',async t=>{
  const f=fixture(t);f.membership('a');const before=await f.capture({streamId:'creative:a',projectAccessId:'access-a'});
  const change=f.db.prepare('INSERT OR IGNORE INTO project_event_scopes SELECT * FROM project_event_scopes').run();
  assert.equal(change.changes,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM project_event_scopes').get().n,1);
  assert.throws(()=>f.check(before));
});
test('source failure rolls back counter changes and earlier mutations in the same batch',async t=>{
  const f=fixture(t);f.event('a');f.secret('a');const original=await f.capture();
  await assert.rejects(f.env.DB.batch([f.env.DB.prepare("UPDATE event_private_payloads SET private_json='changed'"),f.env.DB.prepare("SELECT json('abort')")]));
  f.check(original);assert.equal(f.db.prepare('SELECT private_json FROM event_private_payloads').get().private_json,'private');
});
test('counter and epoch resets, replacements, rowid replacement and deletion fail closed',async t=>{
  const f=fixture(t);f.event('a');const original=await f.capture();
  for(const sql of ["UPDATE scene_source_generations SET generation=1","DELETE FROM scene_source_generations",
    "INSERT OR REPLACE INTO scene_source_generations VALUES('stream','creative:a',1)",
    "INSERT OR REPLACE INTO scene_source_generations(rowid,scope_kind,scope_key,generation) SELECT rowid,'stream','other',1 FROM scene_source_generations",
    "UPDATE scene_source_epoch SET instance_nonce='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'","UPDATE scene_source_epoch SET generation=0",
    "DELETE FROM scene_source_epoch","INSERT OR REPLACE INTO scene_source_epoch VALUES(1,1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',1)"]){
    assert.throws(()=>f.db.exec(sql),sql);f.check(original);
  }
});
test('saturation refuses certificates but still permits private erasure',async t=>{
  const f=fixture(t);f.event('a');f.secret('a');await f.capture();
  f.db.exec('DROP TRIGGER scene_source_generations_update_guard');
  f.db.prepare('UPDATE scene_source_generations SET generation=?').run(SCENE_SOURCE_GENERATION_MAX);
  f.db.exec(SCENE_SOURCE_GENERATION_TRIGGERS.find(x=>x.name==='scene_source_generations_update_guard').sql);
  f.db.exec('DELETE FROM event_private_payloads');await assert.rejects(f.capture());
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM event_private_payloads').get().n,0);
});
test('partial or changed trigger installation cannot activate or validate source certificates',async t=>{
  const f=fixture(t),original=await f.capture();f.db.exec('DROP TRIGGER scene_source_events_insert');
  assert.throws(()=>f.check(original));await assert.rejects(f.capture());
  f.db.exec('CREATE TRIGGER scene_source_events_insert BEFORE INSERT ON events BEGIN SELECT 1; END');
  assert.throws(()=>f.check(original));await assert.rejects(f.capture());
});
test('epoch guard wraps table replacement and restores cross-table triggers transactionally',async t=>{
  const f=fixture(t);f.event('a');f.secret('a');const original=await f.capture();
  const guards=await sceneSourceRebuildStatements(f.env);
  const eventSql=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='events'").get().sql.replace('events','events_rebuilt');
  const objects=f.db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='events' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const statements=[...guards.before,f.env.DB.prepare(eventSql),f.env.DB.prepare('INSERT INTO events_rebuilt SELECT * FROM events'),
    f.env.DB.prepare('DROP TRIGGER IF EXISTS event_write_stage_after_insert'),f.env.DB.prepare('DROP TRIGGER IF EXISTS project_notification_after_event'),
    f.env.DB.prepare('DROP TABLE events'),f.env.DB.prepare('ALTER TABLE events_rebuilt RENAME TO events'),
    ...objects.map(row=>f.env.DB.prepare(row.sql)),...guards.after];
  await f.env.DB.batch(statements);assert.throws(()=>f.check(original));
  const next=await f.capture();assert.equal(next.epoch,original.epoch+1);assert.equal(next.instanceNonce,original.instanceNonce);f.check(next);
  f.db.exec("UPDATE event_private_payloads SET private_json='changed'");assert.throws(()=>f.check(next));
  const source=readFileSync(new URL('../worker/event-privacy-migration.ts',import.meta.url),'utf8');
  assert.match(source,/\.\.\.sourceVersionGuards.before/u);assert.match(source,/\.\.\.sourceVersionGuards.after/u);
});
test('actual legacy privacy migration preserves original events and invalidates old source versions',async t=>{
  const f=fixture(t);await ensureSchema(f.env);f.event('legacy');
  const original=await f.capture(),row=f.db.prepare('SELECT rowid,event_id,sequence FROM events').get();
  const result=await migrateLegacyEventPayloads(f.env);
  assert.deepEqual(result,{migratedEvents:1,eventCount:1});assert.throws(()=>f.check(original));
  assert.deepEqual(f.db.prepare('SELECT rowid,event_id,sequence FROM events').get(),row);
  assert.equal(f.db.prepare('SELECT private_json FROM event_private_payloads').get().private_json,'{}');
  const next=await f.capture();assert.equal(next.epoch,original.epoch+1);f.check(next);
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM events').get().payload)._private_ref,'legacy');
  assert.deepEqual(await migrateLegacyEventPayloads(f.env),{migratedEvents:0,eventCount:1});f.check(next);
  f.db.exec("DELETE FROM event_private_payloads");assert.throws(()=>f.check(next));
});
test('malformed or incomplete D1 receipts cannot issue a source certificate',async t=>{
  const f=fixture(t),originalBatch=f.env.DB.batch;
  for(const corrupt of [results=>{delete results[0];},results=>{delete results[1].success;},results=>{results[2].success=false;},
    results=>{results[0].results=[{current:0}];},results=>{results[0].results=[];}]){
    f.env.DB.batch=async statements=>{const result=await originalBatch(statements);corrupt(result);return result;};
    await assert.rejects(f.capture(),/scene_source_version_unavailable/u);
  }
});
test('project certificate covers non-owner member private content and edit-restore ABA',async t=>{
  const f=fixture(t);f.event('contributor','creative:contributor');f.secret('contributor');f.membership('contributor');
  for(const sql of ["UPDATE event_private_payloads SET private_json='changed'","UPDATE event_private_payloads SET private_json='private'",
    "UPDATE event_private_payloads SET redacted_at='now'","DELETE FROM event_private_payloads"]){
    const original=await f.capture({streamId:'creative:a',projectAccessId:'access-a'});f.db.exec(sql);
    assert.throws(()=>f.check(original));assert.equal((await f.capture()).streamGeneration,0);
  }
});
test('project certificate covers displaced member identity on public rowid replacement',async t=>{
  const f=fixture(t);f.event('contributor','creative:contributor');f.membership('contributor');
  const original=await f.capture({streamId:'creative:a',projectAccessId:'access-a'});
  f.db.exec(`INSERT OR REPLACE INTO events(rowid,event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload)
    SELECT rowid,'new-id','creative:other',1,'now','now','user:a','test','test',1,'Test','{}' FROM events WHERE event_id='contributor'`);
  assert.throws(()=>f.check(original));assert.equal((await f.capture()).streamGeneration,0);
});
test('final rebuild readiness check rolls back epoch and stale trigger restoration',async t=>{
  const f=fixture(t);f.event('a');const original=await f.capture(),guards=await sceneSourceRebuildStatements(f.env);
  await assert.rejects(f.env.DB.batch([...guards.before,
    f.env.DB.prepare('DROP TRIGGER scene_source_events_insert'),
    f.env.DB.prepare('CREATE TRIGGER scene_source_events_insert BEFORE INSERT ON events BEGIN SELECT 1; END'),...guards.after]));
  f.check(original);
});
test('legacy discovery cannot race a newly installed generation schema',async t=>{
  const f=fixture(t);for(const trigger of SCENE_SOURCE_GENERATION_TRIGGERS)f.db.exec(`DROP TRIGGER ${trigger.name}`);
  f.db.exec('DROP TABLE scene_source_epoch; DROP TABLE scene_source_generations');
  const guards=await sceneSourceRebuildStatements(f.env);assert.equal(guards.before.length,1);
  await f.env.DB.batch(guards.before);
  for(const definition of [...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS])f.db.exec(definition.sql);
  await assert.rejects(f.env.DB.batch(guards.before));
});
test('pre-upgrade event rebuild cannot silently retain new private triggers without epoch protocol',async t=>{
  const f=fixture(t);f.event('a');f.secret('a');const original=await f.capture();
  // The old rebuild omitted private trigger detachment and epoch advancement.
  await assert.rejects(f.env.DB.batch([
    f.env.DB.prepare('CREATE TABLE events_old_rebuild AS SELECT * FROM events'),
    f.env.DB.prepare('DROP TABLE events'),f.env.DB.prepare('ALTER TABLE events_old_rebuild RENAME TO events'),
  ]));
  f.check(original);assert.equal(f.db.prepare('SELECT count(*) AS n FROM events').get().n,1);
});
