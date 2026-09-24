import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {indexAuthority} from '../worker/creation-index-authority.ts';
import {claimIndexJob,checkpointIndexJob} from '../worker/creation-index-schema.ts';
import {prepareProjectionDeltaStage} from '../worker/creation-index-projection-stage.ts';
import {boundedIndexEnvironment} from '../worker/creation-index-budget.ts';

async function fixture(t,shared=false){
 const f=await creationIndexFixture(t,shared);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Synthetic stage'});await f.ready();
 const p=f.sqlite.prepare('SELECT * FROM creation_search_partitions WHERE project_id=?').get(f.projectId);
 f.sqlite.prepare("INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,cursor,priority) VALUES('projection:stage-test','projection',?,?,?,0)").run(p.partition_key,p.index_version,JSON.stringify({after:7,head:99,routeComplete:true,routingAfter:99}));
 const changed=Array.from({length:140},(_,i)=>({id:'blocks:stage-'+i,kind:'blocks',content:JSON.stringify({id:'stage-'+i,projectId:f.projectId,projectOwned:true,properties:{text:'Complete synthetic body '+i}})}));
 const next=async(items=changed)=>{const bounded=boundedIndexEnvironment(f.env,AbortSignal.timeout(5000));const env=bounded.env,l=await claimIndexJob(env.DB,25,['projection']);assert.ok(l);const authority=await indexAuthority(env,l.partition_key);const prepared=await prepareProjectionDeltaStage(env,l,{partition:authority.partition,authorityGuard:authority.guard,changed:items,checkpointReads:0,last:99,head:99,cursor:JSON.parse(l.cursor)});assert.ok(prepared);return{env,l,prepared,bounded};};
 const commit=async({env,l,prepared})=>env.DB.batch([...prepared.statements,checkpointIndexJob(env.DB,l,prepared.cursor,prepared.complete),env.DB.prepare('DELETE FROM creation_index_fences')]);
 return{...f,p,changed,next,commit};
}

test('oversized sanitized fanout resumes after restart and atomically promotes complete private checkpoints',async t=>{
 const f=await fixture(t);const first=await f.next();assert.equal(first.prepared.complete,false);await f.commit(first);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='stage:blocks'").get().n,128);
 const cursor=JSON.parse(f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE job_key='projection:stage-test'").get().cursor);assert.equal(cursor.after,7);assert.equal(cursor.stage.offset,128);assert.equal(cursor.routeComplete,true);assert.equal(cursor.routingAfter,99);
 // Fresh claim and helper call reload all durable state, as after a Worker restart.
 const second=await f.next();assert.equal(second.prepared.complete,true);await f.commit(second);
 const rows=f.sqlite.prepare("SELECT c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id WHERE e.kind='blocks' ORDER BY e.entity_id").all();assert.equal(rows.length,140);assert.ok(rows.every(row=>JSON.parse(row.content).properties.text.startsWith('Complete synthetic body')));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind LIKE 'stage:%'").get().n,0);
 const final=JSON.parse(f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE job_key='projection:stage-test'").get().cursor);assert.equal(final.after,99);assert.equal(final.stage,undefined);
});

test('stage promotion cannot continue with an expired lease or a changed frozen delta',async t=>{
 const f=await fixture(t);const first=await f.next();await f.commit(first);const second=await f.next();
 f.sqlite.prepare('UPDATE creation_index_work SET lease_until=unixepoch()-1 WHERE job_key=?').run(second.l.job_key);
 await assert.rejects(f.commit(second));assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,0);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='stage:blocks'").get().n,128);
 const changed=structuredClone(f.changed);changed[139].content=JSON.stringify({id:'stage-139',properties:{text:'Unexpected changed snapshot'}});
 await assert.rejects(f.next(changed),/index_projection_stage_changed/);
});

test('mixed structural skeletons and private bodies stage safely and leave no stale opposite-store pointers',async t=>{
 const f=await fixture(t);const changed=f.changed.map((item,i)=>i%2?{...item,storage:'skeleton',content:JSON.stringify({id:'stage-'+i,projectId:f.projectId,projectOwned:true,removed:true})}:item);
 let last=await f.next(changed);await f.commit(last);
 f.sqlite.prepare('INSERT INTO creation_index_replay_skeletons VALUES(?,?,?,?)').run(f.p.partition_key,f.p.index_version,'blocks:stage-0',JSON.stringify({id:'stage-0',removed:true}));
 const staged=f.sqlite.prepare("SELECT content_id FROM creation_index_projection WHERE entity_id='$stage:blocks:stage-0'").get();
 f.sqlite.prepare('INSERT INTO creation_index_projection VALUES(?,?,?,?,?)').run(f.p.partition_key,f.p.index_version,'blocks:stage-1','blocks',staged.content_id);
 while(!last.prepared.complete){last=await f.next(changed);await f.commit(last);}
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,70);
 const skeletons=f.sqlite.prepare('SELECT metadata FROM creation_index_replay_skeletons').all();assert.equal(skeletons.length,70);assert.ok(skeletons.every(row=>!row.metadata.includes('Complete synthetic body')));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_replay_skeletons WHERE entity_id LIKE '$stage:%'").get().n,0);
});


test('shared custody fanout retains private sidecars and stays within the unchanged 512-operation budget',async t=>{
 const f=await fixture(t,true);let last,pages=0,peak=0;
 do{last=await f.next();await f.commit(last);pages++;peak=Math.max(peak,last.bounded.operations());}while(!last.prepared.complete);
 assert.equal(pages,3);assert.ok(peak<=512);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection e JOIN private_content_retention_scopes r ON r.content_id=e.content_id WHERE e.kind='blocks'").get().n,140);
 t.diagnostic(JSON.stringify({sharedStagePages:pages,peakD1Operations:peak}));
});

test('withdrawn staged private body prevents promotion rather than restoring withdrawn prose',async t=>{
 const f=await fixture(t),first=await f.next();await f.commit(first);const second=await f.next();
 f.sqlite.exec("UPDATE private_content SET redacted_at='withdrawn',content='' WHERE content_id=(SELECT content_id FROM creation_index_projection WHERE kind='stage:blocks' LIMIT 1)");
 await assert.rejects(f.commit(second));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,0);
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE job_key='projection:stage-test'").get().cursor).after,7);
});

test('expired staged content cannot promote even while the projection lease remains current',async t=>{
 const f=await fixture(t),first=await f.next();await f.commit(first);const second=await f.next();
 f.sqlite.exec("UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE content_id=(SELECT content_id FROM creation_index_projection WHERE kind='stage:blocks' LIMIT 1)");
 await assert.rejects(f.commit(second));assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,0);
});

test('a new canonical generation or enrollment revocation cannot promote an old staged snapshot',async t=>{
 for(const mutation of ['generation','revocation']){
  const f=await fixture(t),first=await f.next();await f.commit(first);const second=await f.next();
  if(mutation==='generation')f.sqlite.prepare('UPDATE creation_search_partitions SET index_version=index_version+1 WHERE partition_key=?').run(f.p.partition_key);
  else f.sqlite.exec('UPDATE creation_index_enrollments SET enabled=0');
  await assert.rejects(f.commit(second));assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_index_projection WHERE kind='blocks'").get().n,0,mutation);
 }
});
