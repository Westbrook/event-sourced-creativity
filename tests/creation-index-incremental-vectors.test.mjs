import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {claimIndexJob} from '../worker/creation-index-schema.ts';
import {projectionPage,materializePage} from '../worker/creation-index-projection.ts';
import {eraseCreationIndex} from '../worker/creation-index-maintenance.ts';
const append=(f,type,payload)=>appendAuditEvent(f.env,f.streamId,'user',type,payload);
async function fixture(t,shared=false){const f=await creationIndexFixture(t,shared);/* Observe canonical published shards before optional compaction. */f.controls.afterBatch=()=>f.sqlite.exec("UPDATE creation_index_work SET state='held' WHERE kind='compaction' AND state='ready'");for(let i=0;i<70;i++)await append(f,'BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'carry-'+String(i).padStart(3,'0'),type:'text',properties:{text:'Canonical source '+i+' has a distinct harbor passage.'}});await f.ready();f.controls.afterBatch=null;return f;}
async function drain(f,kind,run){for(let i=0;i<30;i++){const l=await claimIndexJob(f.env.DB,25,[kind]);if(!l)return;await run(f.env,l);}assert.fail('workflow did not finish');}
const objects=f=>f.sqlite.prepare("SELECT * FROM creation_index_objects WHERE state='active' ORDER BY object_key").all();
const members=(f,key)=>f.sqlite.prepare('SELECT source_id FROM creation_index_members WHERE object_key=?').all(key).map(r=>r.source_id);
async function edit(f,id='carry-000'){await append(f,'BlockPropertyEdited',{project_id:f.projectId,block_id:id,property_path:'text',new_value:'Corrected canonical harbor passage.'});await drain(f,'projection',projectionPage);}
test('canonical text edit carries only complete unchanged shards and rebuilds mixed shards',async t=>{
 const f=await fixture(t),before=objects(f),changed=before.filter(o=>members(f,o.object_key).some(id=>['carry-000',f.projectId,f.documentId].includes(id))),unaffected=before.filter(o=>!members(f,o.object_key).some(id=>['carry-000',f.projectId,f.documentId].includes(id)));
 assert.ok(changed.length&&unaffected.length,JSON.stringify({before:before.map(o=>({key:o.object_key,members:members(f,o.object_key)})),states:f.sqlite.prepare("SELECT state,COUNT(*) n FROM creation_index_objects GROUP BY state").all()}));const oldBodies=new Map(before.map(o=>[o.object_key,Buffer.from(f.objects.get(o.object_key).bytes)]));
 await edit(f);const cursor=JSON.parse(f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE kind='projection' AND state='done' ORDER BY generation DESC LIMIT 1").get().cursor);assert.ok(cursor.incremental,'actual workflow took the delta path');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_objects WHERE state='active'").get().n,0,'suspended shards cannot serve while invalidated');
 await drain(f,'materialize',materializePage);
 for(const o of changed)assert.equal(f.sqlite.prepare('SELECT state FROM creation_index_objects WHERE object_key=?').get(o.object_key).state,'retired');
 for(const o of unaffected){const now=f.sqlite.prepare('SELECT * FROM creation_index_objects WHERE object_key=?').get(o.object_key);assert.equal(now.state,'active');assert.ok(now.generation>o.generation);assert.equal(now.erase_due,null);assert.deepEqual(Buffer.from(f.objects.get(o.object_key).bytes),oldBodies.get(o.object_key));}
 await f.ready();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_sources WHERE published=1').get().n,f.sqlite.prepare('SELECT COUNT(*) n FROM creation_search_records WHERE tombstone=0').get().n);
 const row=f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='carry-000'").get();assert.ok(row.content.includes('Corrected canonical harbor passage.'));
});

for(const mode of ['expired','retired','inconsistent','deadline'])test(`canonical delta never reactivates a ${mode} unchanged shard`,async t=>{
 const f=await fixture(t),before=objects(f),candidate=before.find(o=>!members(f,o.object_key).some(id=>['carry-000',f.projectId,f.documentId].includes(id)));assert.ok(candidate);
 await edit(f);
 const mutation={expired:'expires=unixepoch()-1',retired:"state='retired'",inconsistent:'byte_count=byte_count+2048',deadline:'erase_due=unixepoch()-1'}[mode];f.sqlite.prepare(`UPDATE creation_index_objects SET ${mutation} WHERE object_key=?`).run(candidate.object_key);
 await drain(f,'materialize',materializePage);assert.equal(f.sqlite.prepare('SELECT state FROM creation_index_objects WHERE object_key=?').get(candidate.object_key).state,'retired');
});

test('withdrawal before delta publication revokes lease and keeps a fixed five-minute physical erasure deadline',async t=>{
 const f=await fixture(t),before=objects(f);await edit(f);const stale=await claimIndexJob(f.env.DB,25,['materialize']);assert.ok(stale);
 await append(f,'BlockRemoved',{project_id:f.projectId,block_id:'carry-000'});await assert.rejects(materializePage(f.env,stale),/creation_lease_lost/);
 const now=Number(f.sqlite.prepare('SELECT unixepoch() n').get().n);const deadlines=f.sqlite.prepare("SELECT object_key,erase_due FROM creation_index_objects WHERE state<>'erased'").all();assert.ok(deadlines.every(r=>r.erase_due<=now+300));
 await append(f,'BlockPropertyEdited',{project_id:f.projectId,block_id:'carry-001',property_path:'text',new_value:'Later unrelated correction.'});for(const r of deadlines)assert.ok(f.sqlite.prepare('SELECT erase_due FROM creation_index_objects WHERE object_key=?').get(r.object_key).erase_due<=r.erase_due);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots').get().n,0,'withdrawal drops retained snapshot pointers');
 // Controlled deadline observation: this proves cleanup behavior, not hosted scheduling.
 f.sqlite.exec("UPDATE creation_index_objects SET erase_due=unixepoch()-1,write_until=unixepoch()-1 WHERE state<>'erased'");await eraseCreationIndex(f.env);
 for(const o of before)assert.equal(f.objects.has(o.object_key),false);
});

test('shared canonical delta preserves current private sidecars and completely rebuilds the mixed shard',async t=>{
 const f=await creationIndexFixture(t,true);await f.ready();const before=objects(f);assert.ok(before.length);
 const head=(await(await f.request('/api/events?after=0&limit=2000&content=0')).json()).head;const response=await f.request('/api/events',f.json({action:'append',expectedSequence:head,event:{type:'BlockPropertyEdited',payload:{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'Corrected canonical harbor passage.'}}}));assert.equal(response.status,200,await response.text());await drain(f,'projection',projectionPage);const cursor=JSON.parse(f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE kind='projection' AND state='done' ORDER BY generation DESC LIMIT 1").get().cursor);assert.ok(cursor.incremental);
 await drain(f,'materialize',materializePage);for(const o of before)assert.equal(f.sqlite.prepare('SELECT state FROM creation_index_objects WHERE object_key=?').get(o.object_key).state,'retired');
 await f.ready();const row=f.sqlite.prepare("SELECT c.content,c.content_id FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='scene-reuse-direction'").get();assert.ok(row.content.includes('Corrected canonical harbor passage.'));
 assert.ok(f.sqlite.prepare('SELECT 1 FROM private_content_retention_scopes WHERE content_id=? AND project_access_id=?').get(row.content_id,f.sharing.projectAccessId));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_sources WHERE published=1').get().n,7);
});

test('shared migration progress preserves snapshots only for active monotone identity-stable advances',async t=>{
 for(const mode of ['progress','regression','status','owner']){
  const f=await creationIndexFixture(t,true);await f.ready();const before=f.sqlite.prepare('SELECT * FROM creation_index_snapshot_heads').get();assert.ok(before);
  const mutation={progress:"last_owner_sequence=last_owner_sequence+1,updated_at='later'",regression:'last_owner_sequence=last_owner_sequence-1',status:"status='paused'",owner:"owner_user_id='another-owner'"}[mode];
  f.sqlite.prepare(`UPDATE project_migration_states SET ${mutation} WHERE project_access_id=?`).run(f.sharing.projectAccessId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshot_heads').get().n,mode==='progress'?1:0,mode);
 }
});

test('private source expiration between delta replay and materialization cannot carry its old vectors',async t=>{
 const f=await fixture(t);await edit(f);const id=f.sqlite.prepare("SELECT content_id FROM creation_search_records WHERE source_id='carry-030'").get().content_id;
 f.sqlite.prepare("UPDATE private_content SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE content_id=?").run(id);
 await assert.rejects(drain(f,'materialize',materializePage));assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_objects WHERE state='active'").get().n,0);
});
