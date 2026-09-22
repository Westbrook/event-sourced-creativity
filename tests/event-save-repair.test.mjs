import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {registerOutputSourceImports} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();
const {ensureSchema}=await import('../worker/runtime.ts');
const {inspectEventSaveRepair,applyEventSaveRepair,inspectEventSaveCompilation,EVENT_SAVE_REPAIR_TABLES,EVENT_SAVE_REPAIR_BARRIERS,EVENT_SAVE_REPAIR_REMOVED,EVENT_SAVE_COMPILE_PROBE}=await import('../worker/event-save-repair.ts');
const {inspectMemorySchemaRepair,applyMemorySchemaRepair}=await import('../worker/memory-schema-repair.ts');
const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/event-write-primitives.ts');
test.after(()=>imports.deregister());
const authority={sql:'1',bindings:[]};
const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
function adapter(sqlite){
 const control={beforeBatch:null,batches:0,failIndex:null};
 class Statement{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  async all(){return{success:true,results:sqlite.prepare(this.sql).all(...this.values)}}
  async first(){return sqlite.prepare(this.sql).get(...this.values)??null;}
  async run(){const r=sqlite.prepare(this.sql).run(...this.values);return{success:true,meta:{changes:Number(r.changes)}};}
 }
 return{control,db:{prepare:q=>new Statement(q),async batch(ss){control.batches++;control.beforeBatch?.(ss);sqlite.exec('BEGIN IMMEDIATE');try{const r=ss.map((s,i)=>{if(i===control.failIndex)throw Error('injected');const statement=sqlite.prepare(s.sql),results=statement.all(...s.values);return{success:true,results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};});sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
const schema=sqlite=>sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());migrateLocalDatabase(sqlite,{migrations:migrations.slice(0,41)});
 const f={sqlite,...adapter(sqlite)};await ensureSchema({DB:f.db});
 await applyMemorySchemaRepair(f.db,(await inspectMemorySchemaRepair(f.db)).proof,authority);
 f.control.batches=0;
 return f;
}
async function save(db,type,index=1){
 const event=makeEvent('creative:save-test',index,'user:save-test','fixture','fixture',type,{project_id:'project',document_id:'document',block_id:'block',name:'Retained name',text:'Retained private text'});
 const values=eventWriteBindings(event);await db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
 return event;
}

test('repair preserves existing creative rows, baseline triggers, containment and receipts; new Memory writes fail closed',async t=>{
 const f=await fixture(t),event=await save(f.db,'ProjectCreated');
 const before=f.sqlite.prepare('SELECT * FROM events').all(),privateBefore=f.sqlite.prepare('SELECT * FROM event_private_payloads').all();
 const history=f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all(),catalog=schema(f.sqlite);
 const plan=await inspectEventSaveRepair(f.db);assert.equal(plan.summary.status,'ready');
 const result=await applyEventSaveRepair(f.db,plan.proof,authority);assert.equal(result.applied,true);assert.equal(result.saveProbe,'four-synthetic-events-persisted-and-rolled-back');
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM events').all(),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM event_private_payloads').all(),privateBefore);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all(),history);
 const removed=new Set(EVENT_SAVE_REPAIR_REMOVED.map(r=>r.name));for(const row of catalog)if(!removed.has(row.name))assert.deepEqual(schema(f.sqlite).find(r=>r.name===row.name),row);
 for(const table of EVENT_SAVE_REPAIR_TABLES){assert.throws(()=>f.sqlite.exec(`INSERT INTO ${table} DEFAULT VALUES`),/memory_inactive_save_repair/);assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);}
 assert.throws(()=>f.sqlite.prepare('UPDATE events SET payload=? WHERE event_id=?').run('{}',event.eventId),/append-only/);
 assert.throws(()=>f.sqlite.prepare('DELETE FROM events WHERE event_id=?').run(event.eventId),/append-only/);
 assert.equal((await inspectMemorySchemaRepair(f.db)).summary.status,'blocked','historical installer cannot silently reconnect the graph');
 for(const [index,type] of ['DocumentCreated','BlockCreated','BudgetReservationReconciled'].entries())await save(f.db,type,index+2);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM events').get().n,4);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM event_write_stage').get().n,0);
 assert.deepEqual(await inspectEventSaveCompilation(f.db),{status:'pass'});
 const after=schema(f.sqlite),again=await inspectEventSaveRepair(f.db);
 assert.equal((await applyEventSaveRepair(f.db,again.proof,authority)).applied,false);assert.deepEqual(schema(f.sqlite),after);
});

for(const fault of ['unknown-trigger','populated','changed-trigger','reserved','stale-proof','schema-race','authority','mid-ddl','last-ddl'])test('repair refuses or rolls back '+fault,async t=>{
 const f=await fixture(t);
 if(fault==='unknown-trigger')f.sqlite.exec('CREATE TRIGGER unrecognized_memory_dependency AFTER INSERT ON memory_derivation_results BEGIN SELECT 1; END');
 if(fault==='populated')f.sqlite.exec("INSERT INTO memory_derivation_qualifications VALUES('test','"+'a'.repeat(64)+"','test','test','{}','"+'b'.repeat(64)+"','qualified','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')");
 if(fault==='changed-trigger'){f.sqlite.exec('DROP TRIGGER memory_derivation_result_events_insert');f.sqlite.exec('CREATE TRIGGER memory_derivation_result_events_insert BEFORE INSERT ON events BEGIN SELECT 1; END');}
 if(fault==='reserved')f.sqlite.exec('CREATE TABLE __forma_event_save_repair_guard(proof INTEGER)');
 const plan=await inspectEventSaveRepair(f.db),before=schema(f.sqlite);
 if(fault==='schema-race')f.control.beforeBatch=ss=>{if(ss.some(s=>s.sql.startsWith('DROP TRIGGER')))f.sqlite.exec('CREATE TABLE unrelated_concurrent_change(id TEXT)');};
 if(fault==='mid-ddl'||fault==='last-ddl')f.control.beforeBatch=ss=>{f.control.failIndex=ss.some(s=>s.sql.startsWith('DROP TRIGGER'))?(fault==='mid-ddl'?80:ss.length-1):null;};
 await assert.rejects(applyEventSaveRepair(f.db,fault==='stale-proof'?'0'.repeat(64):plan.proof,fault==='authority'?{sql:'0',bindings:[]}:authority));
 assert.deepEqual(schema(f.sqlite).filter(r=>r.name!=='unrelated_concurrent_change'),before);
});

test('tampered isolation barrier or new Memory data cannot be certified',async t=>{
 const f=await fixture(t);await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 f.sqlite.exec(`DROP TRIGGER ${EVENT_SAVE_REPAIR_BARRIERS[0].name}`);
 assert.equal((await inspectEventSaveRepair(f.db)).summary.status,'blocked');
 await assert.rejects(applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority),/precondition/);
});

test('full hosted-like schema compiles and saves at trigger depth3 after repair (reference SQLite)',async t=>{
 const f=await fixture(t),before=schema(f.sqlite);
 await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const input={before,after:schema(f.sqlite),probe:EVENT_SAVE_COMPILE_PROBE.replace(' WHERE 0','')};
 const python=spawnSync('python3',[new URL('../scripts/qualify-event-save-depth.py',import.meta.url).pathname],{input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(python.status,0,python.stderr||python.stdout);t.diagnostic(python.stdout.trim());
});

test('actual local D1 repairs atomically and rolls back all four real event saves', {timeout:120000},async t=>{
 const f=await fixture(t),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,d1Databases:['DB'],log:new Log(LogLevel.NONE),script:'export default{fetch(){return new Response("isolated");}}',outboundService(){throw Error('No egress');}});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const original=schema(f.sqlite).filter(r=>r.name!=='__forma_local_migrations');
 for(const kind of ['table','index','trigger']){const selected=original.filter(r=>r.type===kind);for(let i=0;i<selected.length;i+=40)await db.batch(selected.slice(i,i+40).map(r=>db.prepare(r.sql)));}
 // Install the original receipt because the schema copy intentionally has no rows.
 await db.prepare("INSERT INTO __forma_memory_schema_repair_receipts SELECT ?,?").bind((await inspectMemorySchemaRepair(f.db)).summary.manifest,new Date().toISOString()).run();
 const plan=await inspectEventSaveRepair(db);
 const broken={prepare:q=>db.prepare(q),batch:ss=>ss.length>100?db.batch([...ss,db.prepare('SELECT * FROM missing_final_repair_test')]):db.batch(ss)};
 await assert.rejects(applyEventSaveRepair(broken,plan.proof,authority));assert.equal((await inspectEventSaveRepair(db)).proof,plan.proof);
 const result=await applyEventSaveRepair(db,plan.proof,authority);assert.equal(result.applied,true);assert.equal(result.rollbackQualified,true);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first()).n,0);
 await save(db,'ProjectCreated');assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first()).n,1);
 assert.deepEqual(await inspectEventSaveCompilation(db),{status:'pass'});
});
