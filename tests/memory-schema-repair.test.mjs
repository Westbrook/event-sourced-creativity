import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {inspectMemorySchemaRepair,applyMemorySchemaRepair,MEMORY_SCHEMA_REPAIR_CATALOG_SQL} from '../worker/memory-schema-repair.ts';
const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../worker/memory-schema-repair-manifest.json',import.meta.url)));
const authority={sql:'1',bindings:[]};
function fixture(t,{partial=true}={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());migrateLocalDatabase(sqlite,{migrations:migrations.slice(0,41)});
 if(partial){sqlite.exec(migrations[41].sql);for(const s of migrations[42].sql.split('--> statement-breakpoint').slice(0,9))sqlite.exec(s);}
 const control={beforeBatch:null,failAt:null,batches:0};
 class Statement{constructor(sql,values=[]){this.sql=sql;this.values=values;}bind(...values){return new Statement(this.sql,values);}async all(){return{success:true,results:sqlite.prepare(this.sql).all(...this.values)}}}
 const db={prepare(sql){return new Statement(sql)},async batch(statements){control.batches++;control.beforeBatch?.();sqlite.exec('BEGIN IMMEDIATE');try{const out=[];for(const [i,s] of statements.entries()){if(i===control.failAt)throw Error('injected');sqlite.prepare(s.sql).run(...s.values);out.push({success:true,results:[]});}sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return{sqlite,db,control};
}
const catalog=f=>f.sqlite.prepare(MEMORY_SCHEMA_REPAIR_CATALOG_SQL).all();
for(const partial of [false,true])test('Memory repair installs exact final schema from '+(partial?'partial installation':'baseline')+' without replaying history',async t=>{
 const f=fixture(t,{partial}),history=f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all();
 const before=await inspectMemorySchemaRepair(f.db);assert.equal(before.summary.status,'ready');
 const result=await applyMemorySchemaRepair(f.db,before.proof,authority);assert.equal(result.status,'complete');assert.equal(result.applied,true);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all(),history);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM __forma_memory_schema_repair_receipts').get().n,1);
 const next=await inspectMemorySchemaRepair(f.db);await applyMemorySchemaRepair(f.db,next.proof,authority);assert.equal(f.control.batches,1);
 for(const row of manifest.objects)assert.deepEqual({...catalog(f).find(r=>r.name===row.name)},row);
});
for(const damage of ['unknown-trigger','wrong-table','populated','missing-parent','reserved','receipt-trigger'])test('Memory repair blocks '+damage,async t=>{
 const f=fixture(t);
 if(damage==='unknown-trigger')f.sqlite.exec('CREATE TRIGGER extra_guard BEFORE INSERT ON memory_derivation_jobs BEGIN SELECT 1; END');
 if(damage==='wrong-table')f.sqlite.exec('ALTER TABLE memory_derivation_jobs ADD COLUMN unexpected TEXT');
 if(damage==='populated')f.sqlite.exec("INSERT INTO memory_derivation_qualifications VALUES('test','"+'a'.repeat(64)+"','test','test','{}','"+'b'.repeat(64)+"','qualified','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')");
 if(damage==='missing-parent')f.sqlite.exec('ALTER TABLE users ADD COLUMN unexpected TEXT');
 if(damage==='receipt-trigger')f.sqlite.exec('CREATE TABLE __forma_memory_schema_repair_receipts(manifest_sha256 TEXT PRIMARY KEY NOT NULL,applied_at TEXT NOT NULL); CREATE TRIGGER receipt_attack AFTER INSERT ON __forma_memory_schema_repair_receipts BEGIN DELETE FROM users; END');
 if(damage==='reserved')f.sqlite.exec('CREATE TABLE __forma_memory_schema_repair_guard(proof INTEGER)');
 const before=catalog(f);
 if(damage==='reserved')await assert.rejects(inspectMemorySchemaRepair(f.db),/settings_or_inventory/);
 else{const plan=await inspectMemorySchemaRepair(f.db);assert.equal(plan.summary.status,'blocked');await assert.rejects(applyMemorySchemaRepair(f.db,plan.proof,authority),/precondition/);}
 assert.deepEqual(catalog(f),before);assert.equal(f.control.batches,0);
});
for(const failure of ['stale-proof','schema-race','authority-revoked','mid-batch'])test('Memory repair fails atomically for '+failure,async t=>{
 const f=fixture(t),before=catalog(f),plan=await inspectMemorySchemaRepair(f.db);
 if(failure==='schema-race')f.control.beforeBatch=()=>f.sqlite.exec('CREATE TABLE concurrent_change(id TEXT)');
 if(failure==='mid-batch')f.control.failAt=100;
 await assert.rejects(applyMemorySchemaRepair(f.db,failure==='stale-proof'?'0'.repeat(64):plan.proof,failure==='authority-revoked'?{sql:'0',bindings:[]}:authority));
 assert.deepEqual(catalog(f).filter(r=>r.name!=='concurrent_change'),before);
 assert.equal(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='__forma_memory_schema_repair_guard'").get(),undefined);
});

test('Memory repair atomic batch qualifies in isolated actual local D1', {timeout:120000},async t=>{
 const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,d1Databases:['DB'],log:new Log(LogLevel.NONE),script:'export default{fetch(){return new Response("isolated");}}',outboundService(){throw Error('No egress permitted');}});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB'),f=fixture(t);
 const source=catalog(f).filter(r=>r.name!=='__forma_local_migrations');
 for(const kind of ['table','index','trigger']){const selected=source.filter(r=>r.type===kind&&r.sql);for(let i=0;i<selected.length;i+=50)await db.batch(selected.slice(i,i+50).map(r=>db.prepare(r.sql)));}
 const plan=await inspectMemorySchemaRepair(db);assert.equal(plan.summary.status,'ready');
 // A forced late failure proves the whole repair rolls back on this actual binding.
 const broken={prepare:q=>db.prepare(q),batch:ss=>db.batch([...ss,db.prepare('SELECT * FROM definitely_missing_repair_test')])};
 await assert.rejects(applyMemorySchemaRepair(broken,plan.proof,authority));assert.equal((await inspectMemorySchemaRepair(db)).proof,plan.proof);
 const result=await applyMemorySchemaRepair(db,plan.proof,authority);assert.equal(result.status,'complete');
 assert.equal((await inspectMemorySchemaRepair(db)).summary.status,'complete');
});

for(const tag of ['0044_memory_derivation_reference_jobs','0051_memory_derivation_split'])test('Memory repair reconciles known trigger epoch '+tag,async t=>{
 const f=fixture(t,{partial:false});
 for(const m of migrations.slice(41,migrations.findIndex(m=>m.tag===tag)+1))f.sqlite.exec(m.sql);
 const p=await inspectMemorySchemaRepair(f.db);assert.equal(p.summary.status,'ready');assert.ok(p.summary.replacements>0);
 assert.equal((await applyMemorySchemaRepair(f.db,p.proof,authority)).status,'complete');
});
