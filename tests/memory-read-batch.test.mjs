import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryReadBatch} from '../worker/memory-read-batch.ts';
function fixture(){
 const calls=[];let live=true,hook=null;
 const statement=(sql,values=[])=>({sql,values,bind(...values){return statement(sql,values);}});
 const db={prepare:sql=>statement(sql),async batch(inputs){calls.push(inputs);let result=inputs.map(s=>({success:true,results:[{value:s.values[0]??s.sql}],meta:{changes:0}}));if(hook)result=await hook(result);return result;}};
 const env={DB:db,configured:'original'},batch=createMemoryReadBatch(env,()=>live);
 return{env,db,calls,batch,expire:()=>{live=false;},hook:fn=>{hook=fn;}};
}
test('native Memory staging coalesces independent reads without sharing or caching rows',async()=>{
 const f=fixture(),db=f.batch.env.DB;
 const [a,b]=await Promise.all([db.prepare('SELECT ? AS value').bind('a').all(),db.prepare('SELECT ? AS value').bind('b').first('value')]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].length,2);assert.deepEqual(a.results,[{value:'a'}]);assert.equal(b,'b');a.results[0].value='changed';
 assert.equal(await db.prepare('SELECT ? AS value').bind('a').first('value'),'a');assert.equal(f.calls.length,2);f.batch.close();
});
test('native Memory staging preserves caller atomic batches at chunk boundaries',async()=>{
 const f=fixture(),db=f.batch.env.DB;
 const groups=Array.from({length:3},(_,group)=>Array.from({length:130},(_,i)=>db.prepare('SELECT ? AS value').bind(group+':'+i)));
 const results=await Promise.all(groups.map(group=>db.batch(group)));assert.deepEqual(f.calls.map(c=>c.length),[130,130,130]);
 for(const [i,rows]of results.entries()){assert.equal(rows.length,130);assert.equal(rows[0].results[0].value,i+':0');assert.equal(rows.at(-1).results[0].value,i+':129');}f.batch.close();
});
for(const sql of ["INSERT INTO t VALUES(1)","UPDATE t SET x=1","DELETE FROM t","PRAGMA foreign_keys=OFF","SELECT 1; DELETE FROM t","WITH c AS(SELECT 1) UPDATE t SET x=1","/* readonly? */DROP TABLE t","SELECT 1; SELECT 2"])test('native Memory staging refuses mutation or multiple statements '+sql,()=>{
 const f=fixture();assert.throws(()=>f.batch.env.DB.prepare(sql),/memory_read_batch_unavailable/);assert.equal(f.calls.length,0);f.batch.close();
});
for(const sql of ["SELECT 'DELETE; UPDATE' AS value",'WITH c AS (SELECT 1) SELECT * FROM c','-- comment\n SELECT name FROM sqlite_schema;',"SELECT 'CREATE TABLE '||name AS value FROM sqlite_schema"])test('native Memory staging permits trusted read SQL '+sql,async()=>{
 const f=fixture();await f.batch.env.DB.prepare(sql).all();assert.equal(f.calls.length,1);f.batch.close();
});
for(const fault of ['short','extra','failure','error','invalid-row','expired','database','configuration','throw'])test('native Memory staging rejects the complete acknowledgement on '+fault,async()=>{
 const f=fixture();f.hook(rows=>{
  if(fault==='short')rows.pop();if(fault==='extra')rows.push(rows[0]);if(fault==='failure')rows[0].success=false;if(fault==='error')rows[0].error='unknown';if(fault==='invalid-row')rows[0].results=[null];
  if(fault==='expired'||fault==='configuration')f.expire();if(fault==='database')f.env.DB={...f.db};if(fault==='throw')throw Error('uncertain');return rows;
 });
 const db=f.batch.env.DB,results=await Promise.allSettled([db.prepare('SELECT 1').all(),db.prepare('SELECT 2').first()]);assert.deepEqual(results.map(r=>r.status),['rejected','rejected']);assert.equal(f.calls.length,1);f.batch.close();
});
test('native Memory staging close rejects queued and late reads without renewed access',async()=>{
 const f=fixture(),db=f.batch.env.DB,read=db.prepare('SELECT 1').all();f.batch.close();await assert.rejects(read);await assert.rejects(db.prepare('SELECT 2').all());assert.equal(f.calls.length,0);
});
test('native Memory staging close during an outstanding acknowledgement withholds all rows',async()=>{
 const f=fixture();let resume;f.hook(rows=>new Promise(resolve=>{resume=()=>resolve(rows);}));const read=f.batch.env.DB.prepare('SELECT 1').all();
 while(!resume)await new Promise(resolve=>setTimeout(resolve,1));f.batch.close();await assert.rejects(read);resume();assert.equal(f.calls.length,1);
});
test('native Memory staging deadline rejects in-flight and queued chunks without awaiting the database',async()=>{
 const f=fixture();let resume;
 f.hook(rows=>new Promise(resolve=>{resume=()=>resolve(rows);}));
 const batch=createMemoryReadBatch(f.env,()=>true,20),db=batch.env.DB;
 const groups=Array.from({length:3},()=>Array.from({length:130},()=>db.prepare('SELECT 1')));
 const results=await Promise.allSettled(groups.map(group=>db.batch(group)));
 assert.deepEqual(results.map(r=>r.status),['rejected','rejected','rejected']);assert.equal(f.calls.length,1);
 resume();await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.calls.length,1);
 await assert.rejects(db.prepare('SELECT 2').all());batch.close();f.batch.close();
});
for(const wait of [0,-1,30001,Infinity,NaN])test('native Memory staging refuses an invalid or renewed deadline '+wait,()=>{
 const f=fixture();assert.throws(()=>createMemoryReadBatch(f.env,()=>true,wait));f.batch.close();
});
test('native Memory staging retains exact environment and native statement identity for final replay',async()=>{
 const f=fixture(),db=f.batch.env.DB,s=db.prepare('SELECT ? AS value').bind('guard');assert.equal(f.batch.unwrap(s).values[0],'guard');
 f.env.configured='changed';assert.equal(f.batch.env.configured,'changed');assert.throws(()=>{f.batch.env.configured='forbidden';});
 await assert.rejects(db.batch([f.db.prepare('SELECT 1')]));await assert.rejects(db.prepare('SELECT 1').run());await assert.rejects(db.prepare('SELECT 1').raw());assert.equal(f.calls.length,0);f.batch.close();
});
test('native Memory staging enforces bounds and scalar-column presence',async()=>{
 const f=fixture(),db=f.batch.env.DB;assert.throws(()=>db.prepare('SELECT 1').bind(...Array(101).fill(1)));
 await assert.rejects(db.batch(Array.from({length:257},()=>db.prepare('SELECT 1'))));await assert.rejects(db.prepare('SELECT 1').first('missing'));await assert.rejects(db.batch([]));assert.equal(f.calls.length,1);f.batch.close();
});
test('native Memory staging rejects queued reads when the current authority check throws',async()=>{
 const f=fixture();let invalid=false;
 const batch=createMemoryReadBatch(f.env,()=>{if(invalid)throw Error('revoked');return true;});
 const reads=[batch.env.DB.prepare('SELECT 1').all(),batch.env.DB.prepare('SELECT 2').all()];
 invalid=true;assert.deepEqual((await Promise.allSettled(reads)).map(r=>r.status),['rejected','rejected']);
 assert.equal(f.calls.length,0);batch.close();f.batch.close();
});
test('native Memory staging coordinates independent branches without speculative reads or timer races',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});const environments=[];
 const one=f.batch.run(async env=>{environments.push(env);const a=await env.DB.prepare('SELECT ? AS value').bind('a').first('value');return [a,await env.DB.prepare('SELECT ? AS value').bind('a2').first('value')];});
 const two=f.batch.run(async env=>{environments.push(env);await gate;return env.DB.prepare('SELECT ? AS value').bind('b').first('value');});
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls.length,0);release();assert.deepEqual(await Promise.all([one,two]),[['a','a2'],'b']);assert.deepEqual(f.calls.map(c=>c.length),[2,1]);assert.notEqual(environments[0],environments[1]);assert.notEqual(environments[0].DB,environments[1].DB);f.batch.close();
});
test('native Memory staging coordinates repeated read waves while a branch does independent asynchronous work',async()=>{
 const f=fixture();const work=(label,delay)=>f.batch.run(async env=>{const output=[];for(let i=0;i<3;i++){if(delay)await new Promise(resolve=>setTimeout(resolve,4));output.push(await env.DB.prepare('SELECT ? AS value').bind(label+i).first('value'));}return output;});
 assert.deepEqual(await Promise.all([work('a',false),work('b',true),work('c',false)]),[['a0','a1','a2'],['b0','b1','b2'],['c0','c1','c2']]);assert.deepEqual(f.calls.map(c=>c.length),[3,3,3]);f.batch.close();
});
test('native Memory staging releases coordinated peers when a branch finishes without a database read',async()=>{
 const f=fixture();const [value,empty]=await Promise.all([f.batch.run(env=>env.DB.prepare('SELECT 1').first()),f.batch.run(async()=>null)]);assert.deepEqual(value,{value:'SELECT 1'});assert.equal(empty,null);assert.equal(f.calls.length,1);f.batch.close();
});
test('native Memory staging deadline rejects a stalled branch and all waiting peers without late work',async()=>{
 const f=fixture(),batch=createMemoryReadBatch(f.env,()=>true,20);let resume;const gate=new Promise(resolve=>{resume=resolve;});let late;
 const waiting=batch.run(env=>env.DB.prepare('SELECT 1').all()),stalled=batch.run(async env=>{await gate;try{await env.DB.prepare('SELECT 2').all();late='accepted';}catch{late='rejected';}});
 assert.deepEqual((await Promise.allSettled([waiting,stalled])).map(r=>r.status),['rejected','rejected']);assert.equal(f.calls.length,0);resume();await new Promise(resolve=>setTimeout(resolve,2));assert.equal(late,'rejected');assert.equal(f.calls.length,0);batch.close();f.batch.close();
});
test('native Memory staging branch failure retires pending peers without a new source read',async()=>{
 const f=fixture(),results=await Promise.allSettled([f.batch.run(env=>env.DB.prepare('SELECT 1').all()),f.batch.run(async()=>{throw Error('source denied');})]);assert.deepEqual(results.map(r=>r.status),['rejected','rejected']);assert.equal(f.calls.length,0);f.batch.close();
});
test('native Memory staging coordinated branches preserve oversized atomic caller groups',async()=>{
 const f=fixture();await Promise.all([0,1,2].map(i=>f.batch.run(env=>env.DB.batch(Array.from({length:130},()=>env.DB.prepare('SELECT ? AS value').bind(i))))));assert.deepEqual(f.calls.map(c=>c.length),[130,130,130]);f.batch.close();
});
test('native Memory staging permits at most three independently registered source branches',async()=>{
 const f=fixture();await Promise.all([1,2,3].map(n=>f.batch.run(async()=>n)));await assert.rejects(f.batch.run(async()=>4));assert.equal(f.calls.length,0);f.batch.close();
});
