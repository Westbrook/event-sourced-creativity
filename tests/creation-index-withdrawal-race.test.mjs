import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {resumeCreationIndexPartition} from '../worker/creation-index-reconcile.ts';
import {claimIndexJob} from '../worker/creation-index-schema.ts';
import {projectionPage,materializePage} from '../worker/creation-index-projection.ts';
const partition=f=>f.sqlite.prepare('SELECT * FROM creation_search_partitions WHERE project_id=?').get(f.projectId);
async function drain(f,kind,handler){for(let i=0;i<30;i++){const lease=await claimIndexJob(f.env.DB,25,[kind]);if(!lease)return;await handler(f.env,lease);}assert.fail('continuation did not finish');}
async function freezeForeignReplay(f){
 await f.ready();await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'foreign-a',name:'A'});
 const authored=await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'foreign-a',block_id:'foreign-private',scope:'library',type:'text',properties:{text:'Unique foreign withdrawal body: saffron lighthouse.'}});
 await appendAuditEvent(f.env,f.streamId,'user','BlockRelationAdded',{project_id:f.projectId,relation_id:'foreign-dependency',from_block_id:'scene-reuse-direction',to_block_id:'foreign-private',kind:'context_contains'});
 await resumeCreationIndexPartition(f.env,partition(f).partition_key);const routing=await claimIndexJob(f.env.DB,25,['projection']);await projectionPage(f.env,routing);
 const stale=await claimIndexJob(f.env.DB,25,['projection']);assert.ok(stale);
 return {authored,stale,before:partition(f)};
}
for(const mutation of ['remove','redact','delete','recreate'])test(`an unfinished foreign-Project replay loses its lease on canonical ${mutation}`,async t=>{
 const f=await creationIndexFixture(t);const {authored,stale,before}=await freezeForeignReplay(f);
 // Completed same-owner and unfinished different-owner partitions are not swept.
 f.sqlite.prepare("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('completed-control','personal:'||?,'completed',?,datetime('now'))").run(f.owner,f.owner);
 f.sqlite.exec("UPDATE creation_index_work SET state='done' WHERE partition_key='completed-control'; INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('different-owner','personal:another','other','another',datetime('now'))");
 if(mutation==='remove')await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{project_id:'foreign-a',block_id:'foreign-private'});
 else if(mutation==='recreate')await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'foreign-a',block_id:'foreign-private',scope:'library',type:'text',properties:{text:'New foreign incarnation.'}});
 else if(mutation==='redact')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at='withdrawn' WHERE private_event_id=?").run(authored.eventId);
 else f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(authored.eventId);
 assert.ok(partition(f).index_version>before.index_version);assert.equal(f.sqlite.prepare("SELECT index_version FROM creation_search_partitions WHERE partition_key='completed-control'").get().index_version,0);
 assert.equal(f.sqlite.prepare("SELECT index_version FROM creation_search_partitions WHERE partition_key='different-owner'").get().index_version,0);f.sqlite.exec("DELETE FROM creation_index_work WHERE partition_key='different-owner'");
 await assert.rejects(projectionPage(f.env,stale),/creation_lease_lost/);await drain(f,'projection',projectionPage);
 const bodies=f.sqlite.prepare("SELECT c.content FROM creation_index_projection p JOIN private_content c ON c.content_id=p.content_id WHERE p.partition_key=? AND p.generation=?").all(before.partition_key,partition(f).index_version);
 assert.equal(bodies.some(row=>row.content.includes('Unique foreign withdrawal body')),false);
});
for(const removed of [false,true])test(`shared replay denies an owner-moved source omitted from the shared event scope${removed?' and subsequently removed':''}`,async t=>{
 const f=await creationIndexFixture(t,true);await f.ready();
 await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'other-a',name:'A'});
 const moved=await appendAuditEvent(f.env,f.streamId,'user','BlockRehomed',{project_id:'other-a',block_id:'scene-reuse-direction',scope:'library'});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM project_event_scopes WHERE event_id=?').get(moved.eventId).n,0);
 if(removed){const event=await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{project_id:'other-a',block_id:'scene-reuse-direction'});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM project_event_scopes WHERE event_id=?').get(event.eventId).n,0);}
 await resumeCreationIndexPartition(f.env,partition(f).partition_key);await drain(f,'projection',projectionPage);
 const p=partition(f);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_projection WHERE partition_key=? AND generation=? AND entity_id='blocks:scene-reuse-direction'").get(p.partition_key,p.index_version).n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id='blocks:scene-reuse-direction'").get(p.partition_key,p.index_version).n,1);
 await drain(f,'materialize',materializePage);assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records WHERE partition_key=? AND source_id='scene-reuse-direction'").get(p.partition_key).tombstone,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE event_id=?").get(moved.eventId).n,1,'authored history is retained');
});
test('legacy nontext recreation conservatively invalidates unfinished replay after routing',async t=>{
 const f=await creationIndexFixture(t);const {stale,before}=await freezeForeignReplay(f);
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'foreign-a',block_id:null,scope:'library',type:'text',properties:{text:'Legacy identity'}});
 assert.ok(partition(f).index_version>before.index_version);await assert.rejects(projectionPage(f.env,stale),/creation_lease_lost/);
});
