import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {creationIndexFixture} from '../helpers/creation-index-fixture.mjs';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
// Run after npm run build. This is the compiled Worker in local workerd/D1/R2;
// invoking scheduled directly does not establish a persistent hosted schedule.
test('compiled Worker erases scheduled orphans in native local D1/R2 despite unrelated cleanup failure',async t=>{
 const f=await creationIndexFixture(t);const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']},{type:'CompiledWasm',include:['**/*.wasm']}],scriptPath:resolve('dist/server/__qualification-entry.mjs'),script:`import worker from './index.js'; export default {...worker,async scheduled(...args){try{return await worker.scheduled(...args);}catch(error){console.error('compiled-schedule-error',String(error));throw error;}}};`,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],serviceBindings:{ASSETS:()=>new Response('fixture',{status:404})},bindings:{STILL_CREATION_INDEX_ENABLED:'false',STILL_UNIFIED_CREATION_ENABLED:'false',STILL_CREATION_DEPLOYMENT_ID:'local-workerd-qualification'}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');const schema=f.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all();
 for(const row of schema.filter(s=>s.type==='table'))await db.prepare(row.sql).run();
 for(const row of schema.filter(s=>s.type==='table')){const data=f.sqlite.prepare('SELECT * FROM "'+row.name+'"').all();for(const value of data){const keys=Object.keys(value);await db.prepare('INSERT INTO "'+row.name+'"('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(value)).run();}}
 for(const row of schema.filter(s=>s.type!=='table'))await db.prepare(row.sql).run();
 // Deliberately absent unrelated panel tables make the aggregate handler fail.
 assert.equal(await db.prepare("SELECT 1 FROM sqlite_master WHERE name='still_panel_commands'").first(),null);
 const bucket=await mf.getR2Bucket('MEDIA');const key='__still_creation_index/local-workerd-orphan';await bucket.put(key,new Uint8Array(2048));const worker=await mf.getWorker();const result=await worker.scheduled({cron:'* * * * *'});assert.equal(result.outcome,'exception');assert.equal(await bucket.head(key),null);
 const receipt=await db.prepare("SELECT * FROM creation_index_runs WHERE trigger_kind='native-scheduled'").first();assert.ok(receipt.ended);assert.equal(receipt.provider_attempts,0);assert.equal(receipt.deployment,'local-workerd-qualification');
 await db.prepare("UPDATE creation_index_work SET due=0").run();await bucket.put(key,new Uint8Array(2048));assert.equal((await worker.scheduled({cron:'* * * * *'})).outcome,'exception');assert.equal(await bucket.head(key),null);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM creation_index_runs').first()).n,2);
});
