import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {eraseCreationIndex,CREATION_MAINTENANCE_BUDGET} from '../worker/creation-index-maintenance.ts';

const sourceId=f=>f.sqlite.prepare("SELECT content_id FROM creation_search_records WHERE source_id='scene-reuse-direction'").get().content_id;
const body=f=>f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(sourceId(f));
const isPrivateCleanup=statements=>statements[0]?.sql.startsWith("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(");
const canonical=f=>JSON.stringify({events:f.sqlite.prepare('SELECT * FROM events ORDER BY event_id').all(),secrets:f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all()});

test('one DB cutoff preserves body and both sidecars when expiry crosses between cleanup statements',async t=>{
 const f=await creationIndexFixture(t,true);await f.ready();const id=sourceId(f),before=canonical(f),batch=f.env.DB.batch.bind(f.env.DB);let crossed=false;
 f.env.DB.batch=async statements=>{
  if(!isPrivateCleanup(statements))return batch(statements);
  crossed=true;assert.equal(statements.length,3);assert.equal(new Set(statements.map(s=>s.values[0])).size,1);assert.ok(statements.every(s=>typeof s.values[0]==='string'));
  let clock='2000-01-01T00:00:00.000Z';f.sqlite.function('strftime',{varargs:true},()=>clock);
  f.sqlite.exec('BEGIN');try{const result=statements.map((statement,i)=>{if(i===2)clock='2100-01-01T00:00:00.000Z';return statement.execute('run');});f.sqlite.exec('COMMIT');return result;}catch(error){f.sqlite.exec('ROLLBACK');throw error;}
 };
 await eraseCreationIndex(f.env);assert.ok(crossed);
 assert.ok(f.sqlite.prepare('SELECT 1 FROM private_content WHERE content_id=?').get(id));
 assert.ok(f.sqlite.prepare('SELECT 1 FROM private_content_retention_scopes WHERE content_id=?').get(id));
 assert.ok(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(id));
 assert.equal(canonical(f),before);
});

test('bounded bulk cleanup erases 8192 detached derived bodies and sidecars, preserving live source and canonical history',async t=>{
 const f=await creationIndexFixture(t,true);await f.ready();const current=body(f),id=current.content_id,before=canonical(f),limit=CREATION_MAINTENANCE_BUDGET.deletePrivateBodies;
 assert.equal(limit,8192);
 const templates=[['private_content',current,'content_id'],['project_resource_scopes',f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(id),'resource_id'],['private_content_retention_scopes',f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(id),'content_id']];
 const inserts=templates.map(([table,row,key])=>({row,key,statement:f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`)}));
 f.sqlite.exec('BEGIN');try{for(let i=0;i<=limit;i++)for(const {row,key,statement} of inserts)statement.run(...Object.entries(row).map(([field,value])=>field===key?'000-review-cleanup-'+String(i).padStart(5,'0'):value));f.sqlite.exec('COMMIT');}catch(error){f.sqlite.exec('ROLLBACK');throw error;}
 let batches=0;f.controls.beforeBatch=statements=>{if(isPrivateCleanup(statements)){batches++;assert.equal(statements.length,3);assert.ok(statements.every(s=>s.sql.includes('LIMIT 8192')));}};
 const remaining=()=>templates.map(([table,,key])=>f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${key} LIKE '000-review-cleanup-%'`).get().n);
 assert.deepEqual(remaining(),[8193,8193,8193]);await eraseCreationIndex(f.env);assert.deepEqual(remaining(),[1,1,1]);assert.equal(batches,1);
 assert.ok(f.sqlite.prepare('SELECT 1 FROM private_content WHERE content_id=?').get(id));assert.equal(canonical(f),before);
 await eraseCreationIndex(f.env);assert.deepEqual(remaining(),[0,0,0]);assert.equal(batches,2);assert.ok(f.sqlite.prepare('SELECT 1 FROM private_content WHERE content_id=?').get(id));assert.equal(canonical(f),before);
});

test('credential-free cleanup erases revoked and superseded routing/skeleton metadata',async t=>{
 const f=await creationIndexFixture(t);await f.ready();const p=f.sqlite.prepare('SELECT partition_key,index_version FROM creation_search_partitions LIMIT 1').get();
 const insert=(generation,suffix)=>{f.sqlite.prepare('INSERT INTO creation_index_block_routes(partition_key,generation,block_id,project_id,safe_foreign,created,removed) VALUES(?,?,?,?,?,?,?)').run(p.partition_key,generation,'metadata-'+suffix,f.projectId,0,1,1);f.sqlite.prepare('INSERT INTO creation_index_replay_skeletons VALUES(?,?,?,?)').run(p.partition_key,generation,'blocks:metadata-'+suffix,JSON.stringify({id:'metadata-'+suffix,properties:{}}));};
 insert(p.index_version-1,'old');insert(p.index_version,'current');
 await eraseCreationIndex(f.env);
 for(const table of ['creation_index_block_routes','creation_index_replay_skeletons'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);
 f.sqlite.exec('UPDATE creation_index_enrollments SET enabled=0');f.env.STILL_CREATION_INDEX_ENABLED='0';delete f.env.OPENAI_API_KEY;
 await eraseCreationIndex(f.env);
 for(const table of ['creation_index_block_routes','creation_index_replay_skeletons'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
});
