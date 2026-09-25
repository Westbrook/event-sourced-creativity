import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {poolFromEnvironment,migrate} from '../src/database.mjs';import {PlatformRepository,CONSENT} from '../src/repository.mjs';import {putPrivate,readPrivate} from '../src/objects.mjs';import {claim,eraseSource} from '../src/jobs.mjs';
// Storage fault injection only: this test does not qualify GCS permission/retention behavior.
class ControlledObjects{
 data=new Map();beforePut=null;generation=0;
 async put(key,bytes,sha){await this.beforePut?.();assert.equal(sha,createHash('sha256').update(bytes).digest('hex'));const g=String(++this.generation);this.data.set(key,{bytes,generation:g});return g;}
 async get(key,g,range){const v=this.data.get(key);assert.equal(v.generation,g);return range?v.bytes.subarray(range.start,range.end+1):v.bytes;}
 async versions(key){const v=this.data.get(key);return v?[{key,generation:v.generation}]:[];}
 async remove(key,g){if(this.data.get(key)?.generation===g)this.data.delete(key);}
}
test('pending late object write after withdrawal is denied and independently erased with inference disabled',{skip:!process.env.PILOT_DATABASE_URL},async()=>{
 const pool=poolFromEnvironment();try{await migrate(pool);const repo=new PlatformRepository(pool),s=randomUUID(),actor='object-owner-'+s,w='objects-'+s,source='source-'+s,objects=new ControlledObjects();
 await pool.query('INSERT INTO pilot.principals(principal_id,account_id,consent_version) VALUES($1,$1,$2)',[actor,CONSENT]);await pool.query('INSERT INTO pilot.workspaces(workspace_id,owner_id) VALUES($1,$2)',[w,actor]);await pool.query('INSERT INTO pilot.sources(source_id,workspace_id) VALUES($1,$2)',[source,w]);
 const normal=await putPrivate(pool,objects,actor,w,source,Buffer.from('synthetic bytes'));assert.equal((await readPrivate(pool,objects,actor,w,normal.id,{start:0,end:8})).toString(),'synthetic');
 let release;const paused=new Promise(r=>{release=r;});let arrived;const waiting=new Promise(r=>{arrived=r;});objects.beforePut=async()=>{arrived();await paused;};
 const late=putPrivate(pool,objects,actor,w,source,Buffer.from('late synthetic bytes'));await waiting;await repo.withdraw(actor,w,source);
 const job=(await claim(pool,'eraser-'+s,{limit:100})).find(j=>j.source_id===source);assert.ok(job);await eraseSource(pool,objects,job);assert.equal(objects.data.size,0);
 release();const lateReceipt=await late;await assert.rejects(()=>readPrivate(pool,objects,actor,w,lateReceipt.id),/object_unavailable/);
 await pool.query('UPDATE pilot.jobs SET due_at=clock_timestamp() WHERE job_id=$1',[job.job_id]);const retry=(await claim(pool,'eraser-next-'+s,{limit:100})).find(j=>j.job_id===job.job_id);await eraseSource(pool,objects,retry);assert.equal(objects.data.size,0);
 console.log(JSON.stringify({test:'late-object-erasure',source,adapter:'controlled-test-double',gcsQualified:false,inference:false}));
 }finally{await pool.end();}
});
