import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {renewCreationIndex} from '../worker/creation-index-renewal.ts';
import {claimIndexJob} from '../worker/creation-index-schema.ts';
import {D1CreationSearchIndex} from '../worker/creation-search-index.ts';
import {CREATION_REPRESENTATION as R} from '../worker/creation-vectors.ts';
import {boundedIndexEnvironment} from '../worker/creation-index-budget.ts';
async function fixture(t,shared=false){
 const f=await creationIndexFixture(t,shared);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Current canonical harbor'});await f.ready();
 const p=f.sqlite.prepare('SELECT * FROM creation_search_partitions WHERE project_id=?').get(f.projectId);
 // Model a still-live body near its original assigned deadline; synchronize the
 // shared sidecars as this is fixture clock setup, never a production renewal.
 f.sqlite.exec("UPDATE private_content SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'),expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours') WHERE kind='creation-search-source'; UPDATE private_content_retention_scopes SET created_at=(SELECT created_at FROM private_content WHERE private_content.content_id=private_content_retention_scopes.content_id),assigned_expires_at=(SELECT expires_at FROM private_content WHERE private_content.content_id=private_content_retention_scopes.content_id) WHERE content_id IN(SELECT content_id FROM private_content WHERE kind='creation-search-source'); UPDATE creation_index_sources SET expires=unixepoch()+43200; UPDATE creation_index_objects SET expires=unixepoch()+43200 WHERE state='active'; UPDATE creation_index_work SET due=0 WHERE kind='renewal'");
 const run=async()=>{const bounded=boundedIndexEnvironment(f.env,AbortSignal.timeout(5000));const l=await claimIndexJob(bounded.env.DB,25,['renewal']);assert.ok(l);return {result:await renewCreationIndex(bounded.env,l,AbortSignal.timeout(5000)),operations:bounded.operations()};};
 const coverage=()=>new D1CreationSearchIndex(f.env.DB,R.id).coverage({projectId:p.project_id,custody:p.custody});
 return{...f,p,run,coverage};
}
for(const shared of [false,true])test(`renewal preserves live coverage and vector bytes without provider calls (${shared?'shared':'personal'})`,async t=>{
 const f=await fixture(t,shared),before=await f.coverage(),calls=f.calls.length,old=f.sqlite.prepare('SELECT r.content_id,r.revision,r.semantic_revision,c.expires_at FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.tombstone=0').all(),objects=f.sqlite.prepare("SELECT object_key,checksum,expires FROM creation_index_objects WHERE state='active'").all();
 const result=await f.run();assert.ok(result.result.bodies>0);assert.ok(result.result.objects>0);assert.ok(result.operations<512);
 assert.equal(f.calls.length,calls);assert.deepEqual(await f.coverage(),before);assert.equal(f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').get(f.p.partition_key).index_version,f.p.index_version);
 const fresh=f.sqlite.prepare('SELECT content_id,revision,semantic_revision FROM creation_search_records WHERE tombstone=0').all();assert.ok(fresh.every((row,i)=>row.content_id!==old[i].content_id&&row.revision===old[i].revision&&row.semantic_revision===old[i].semantic_revision));
 for(const object of objects){const current=f.sqlite.prepare('SELECT * FROM creation_index_objects WHERE object_key=?').get(object.object_key);assert.equal(current.state,'active');assert.equal(current.checksum,object.checksum);assert.ok(current.expires>object.expires);assert.ok(f.objects.has(object.object_key));}
 for(const row of old)assert.equal(f.sqlite.prepare('SELECT expires_at FROM private_content WHERE content_id=?').get(row.content_id).expires_at,row.expires_at,'old body lifetime is never extended');
 t.diagnostic(JSON.stringify({bodies:result.result.bodies,objects:result.result.objects,D1Operations:result.operations}));
});

test('canonical mutation after renewal read cannot replace a source pointer or extend vector retention',async t=>{
 const f=await fixture(t),old=f.sqlite.prepare('SELECT content_id FROM creation_search_records WHERE source_id=?').get('scene-reuse-direction');let mutated=false;
 f.controls.afterRead=async(statement,value)=>{if(!mutated&&statement.sql.startsWith('WITH candidates AS MATERIALIZED')&&value.results?.length){mutated=true;await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'Changed canonical text'});}};
 await assert.rejects(f.run());assert.ok(mutated);assert.equal(f.sqlite.prepare('SELECT content_id FROM creation_search_records WHERE source_id=?').get('scene-reuse-direction').content_id,old.content_id);
});

test('expired or withdrawn private sources are never copied into a fresh lifetime',async t=>{
 for(const mode of ['expired','withdrawn']){const f=await fixture(t);const before=f.sqlite.prepare('SELECT content_id FROM creation_search_records WHERE source_id=?').get('scene-reuse-direction');f.sqlite.prepare(mode==='expired'?"UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE content_id=?":"UPDATE private_content SET redacted_at='withdrawn',content='' WHERE content_id=?").run(before.content_id);assert.equal((await f.run()).result.rebuild,true);assert.equal(f.sqlite.prepare('SELECT content_id FROM creation_search_records WHERE source_id=?').get('scene-reuse-direction').content_id,before.content_id);}
});

test('corrupt vector bytes never receive a renewed manifest lifetime',async t=>{
 const f=await fixture(t),object=f.sqlite.prepare("SELECT object_key,expires FROM creation_index_objects WHERE state='active' LIMIT 1").get();f.objects.get(object.object_key).bytes[0]^=1;
 assert.equal((await f.run()).result.rebuild,true);assert.equal(f.sqlite.prepare('SELECT expires FROM creation_index_objects WHERE object_key=?').get(object.object_key).expires,object.expires);
});


test('shared shard keeps its old valid lifetime until every member body has renewed',async t=>{
 const f=await fixture(t);for(let i=0;i<42;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'renewal-many-'+i,scope:'library',type:'text',properties:{text:'Complete unique retained source '+i}});await f.ready();
 f.sqlite.exec("UPDATE private_content SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days'),expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours') WHERE kind='creation-search-source'; UPDATE creation_index_sources SET expires=unixepoch()+43200; UPDATE creation_index_objects SET expires=unixepoch()+43200 WHERE state='active'; UPDATE creation_index_work SET due=0 WHERE kind='renewal'");
 const before=await f.coverage(),objects=f.sqlite.prepare("SELECT object_key,expires FROM creation_index_objects WHERE state='active'").all();assert.equal(objects.length,1);
 const first=await f.run();assert.equal(first.result.bodies,32);assert.equal(first.result.objects,0);assert.deepEqual(await f.coverage(),before);assert.equal(f.sqlite.prepare('SELECT expires FROM creation_index_objects WHERE object_key=?').get(objects[0].object_key).expires,objects[0].expires);
 const second=await f.run();assert.ok(second.result.bodies>0);assert.equal(second.result.objects,1);assert.deepEqual(await f.coverage(),before);
});

test('retired or expired shard is never resurrected by body renewal',async t=>{
 for(const mode of ['retired','expired']){const f=await fixture(t);const object=f.sqlite.prepare("SELECT object_key,expires FROM creation_index_objects WHERE state='active' LIMIT 1").get();f.sqlite.prepare(mode==='retired'?"UPDATE creation_index_objects SET state='retired' WHERE object_key=?":"UPDATE creation_index_objects SET expires=unixepoch()-1 WHERE object_key=?").run(object.object_key);const before=f.sqlite.prepare('SELECT expires,state FROM creation_index_objects WHERE object_key=?').get(object.object_key);assert.equal((await f.run()).result.rebuild,true);const after=f.sqlite.prepare('SELECT expires,state FROM creation_index_objects WHERE object_key=?').get(object.object_key);assert.equal(after.expires,before.expires);assert.equal(after.state,'retired');}
});


test('a missed renewal deadline queues and completes fresh canonical reconstruction without resurrecting expired bodies',async t=>{
 const f=await fixture(t);const oldIds=f.sqlite.prepare('SELECT content_id FROM creation_search_records').all().map(r=>r.content_id),generation=f.p.index_version;
 f.sqlite.exec("UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE kind='creation-search-source'; UPDATE creation_index_sources SET expires=unixepoch()-60; UPDATE creation_index_objects SET expires=unixepoch()-60 WHERE state='active'");
 const recovery=await f.run();assert.equal(recovery.result.rebuild,true);assert.equal(f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').get(f.p.partition_key).index_version,generation+1);
 await f.ready();const coverage=await f.coverage();assert.equal(coverage.semantic,coverage.expected);assert.ok(coverage.semantic>0);assert.ok(f.sqlite.prepare('SELECT content_id FROM creation_search_records WHERE tombstone=0').all().every(row=>!oldIds.includes(row.content_id)));
});


test('late-wake recovery cannot use an expired lease to advance generation',async t=>{
 const f=await fixture(t),generation=f.p.index_version;
 f.sqlite.exec("UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE kind='creation-search-source'");
 const lease=await claimIndexJob(f.env.DB,-1,['renewal']);assert.ok(lease);
 await assert.rejects(renewCreationIndex(f.env,lease));assert.equal(f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').get(f.p.partition_key).index_version,generation);
});
