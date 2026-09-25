import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';import {migrate} from '../src/database.mjs';import {MemoryRepository} from '../src/memory.mjs';
test('pgvector two-partition upsert, hybrid query, replace, revocation, tombstone, stale write and restore',{skip:!process.env.PILOT_MEMORY_DATABASE_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.PILOT_MEMORY_DATABASE_URL});try{
 await migrate(pool,[new URL('../sql/002-memory.sql',import.meta.url)]);const {rows:[v]}=await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'");assert.equal(v.extversion,'0.8.2');
 const id=randomUUID(),a='partition-a-'+id,b='partition-b-'+id,memory=new MemoryRepository(pool);
 await pool.query('INSERT INTO memory_pilot.partitions(partition_id) VALUES($1),($2)',[a,b]);await pool.query('INSERT INTO memory_pilot.members VALUES($1,$3),($2,$4)',[a,b,'owner-a','owner-b']);
 const input={partitionId:a,sourceId:'shared-source',generation:1,partitionGeneration:1,contentHash:'a'.repeat(64),embedding:[1,0,0],terms:'synthetic harbor'};
 await memory.upsert('owner-a',input);await memory.upsert('owner-b',{...input,partitionId:b,contentHash:'b'.repeat(64)});
 const query={partitionId:a,embedding:[1,0,0],query:'harbor'};assert.equal((await memory.query('owner-a',query))[0].content_hash,input.contentHash);await assert.rejects(()=>memory.query('owner-b',query),/partition_denied/);
 await memory.upsert('owner-a',{...input,generation:2,contentHash:'c'.repeat(64)});assert.equal((await memory.query('owner-a',query))[0].generation,'2');
 const snapshot=(await pool.query('SELECT *,embedding::text,terms::text FROM memory_pilot.entries WHERE partition_id=$1',[a])).rows;
 const deleted=await memory.delete('owner-a',{partitionId:a,sourceId:input.sourceId,generation:3});assert.ok(deleted.absent);assert.equal((await memory.query('owner-a',query)).length,0);await assert.rejects(()=>memory.upsert('owner-a',{...input,generation:2}),/source_fenced/);
 assert.equal((await memory.restore('owner-a',{partitionId:a,rows:snapshot})).restored,0);assert.equal((await pool.query('SELECT * FROM memory_pilot.entries WHERE partition_id=$1',[a])).rowCount,0);
 assert.equal((await memory.query('owner-b',{...query,partitionId:b})).length,1);
 await pool.query('DELETE FROM memory_pilot.members WHERE partition_id=$1',[b]);await assert.rejects(()=>memory.query('owner-b',{...query,partitionId:b}),/partition_denied/);
 console.log(JSON.stringify({test:'memory-pg-v1',extension:v.extversion,partitions:2,deleteReceipt:deleted.receiptId,restoredWithdrawn:0,provider:'synthetic-three-dimensions',hosted:false}));
 }finally{await pool.end();}
});
