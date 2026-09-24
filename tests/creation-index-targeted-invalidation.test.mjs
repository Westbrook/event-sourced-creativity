import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {readFile} from 'node:fs/promises';
import {CREATION_SEARCH_SCHEMA} from '../worker/creation-search-index.ts';
const versions=f=>new Map(f.sqlite.prepare('SELECT project_id,index_version FROM creation_search_partitions').all().map(r=>[r.project_id,r.index_version]));
function changed(f,before){return [...versions(f)].filter(([id,v])=>v!==before.get(id)).map(([id])=>id).sort();}
async function fixture(t){const f=await creationIndexFixture(t);for(const id of [f.projectId,'second','unaffected'])await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:id,name:id});await f.ready();return f;}

test('canonical private-sidecar append invalidates only the known Project',async t=>{
 const f=await fixture(t),before=versions(f);const event=await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'Only this Project changes.'});
 assert.ok(f.sqlite.prepare('SELECT 1 FROM event_private_payloads WHERE private_event_id=?').get(event.eventId));assert.deepEqual(changed(f,before),[f.projectId]);await f.ready();
 const source=f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='scene-reuse-direction'").get();assert.equal(JSON.parse(source.content).text,'Only this Project changes.');
});

test('sidecar scope moves invalidate both OLD and NEW Projects; redaction and deletion keep known scope',async t=>{
 const f=await fixture(t);const event=await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'Body before withdrawal.'});
 let before=versions(f);const body=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(event.eventId).private_json);body.project_id='second';f.sqlite.prepare('UPDATE event_private_payloads SET project_id=?,private_json=? WHERE private_event_id=?').run('second',JSON.stringify(body),event.eventId);assert.deepEqual(changed(f,before),[f.projectId,'second'].sort());
 before=versions(f);f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='withdrawn',private_json='{}' WHERE private_event_id=?").run(event.eventId);assert.deepEqual(changed(f,before),[f.projectId,'second'].sort());
 before=versions(f);f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(event.eventId);assert.deepEqual(changed(f,before),[f.projectId,'second'].sort());
});

test('public Project fallback is targeted, while truly unknown private scope remains broad',async t=>{
 const f=await fixture(t);const known=await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'Known public scope.'});
 let before=versions(f);const payload=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(known.eventId).private_json);delete payload.project_id;f.sqlite.prepare('UPDATE event_private_payloads SET project_id=NULL,private_json=? WHERE private_event_id=?').run(JSON.stringify(payload),known.eventId);assert.deepEqual(changed(f,before),[f.projectId]);
 const unknown=await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'Legacy implicit scope.'});before=versions(f);f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='withdrawn' WHERE private_event_id=?").run(unknown.eventId);assert.deepEqual(changed(f,before),[f.projectId,'second','unaffected'].sort());
});

test('candidate SQL exactly matches executable search schema',async()=>{assert.equal(await readFile(new URL('../drizzle/candidates/0075_still_creation_search.sql',import.meta.url),'utf8'),CREATION_SEARCH_SCHEMA.join(';\n--> statement-breakpoint\n')+';\n');});

test('shared source withdrawal invalidates its exact access partition without invalidating another personal Project',async t=>{
 const f=await creationIndexFixture(t,true);await f.ready();
 const custodies=JSON.parse(f.env.STILL_CREATION_PROVIDER_CUSTODIES);custodies.push('personal:'+f.owner);f.env.STILL_CREATION_PROVIDER_CUSTODIES=JSON.stringify(custodies);f.sqlite.prepare("INSERT INTO creation_index_enrollments VALUES(?,1,'test-policy',unixepoch()+86400,10000000)").run('personal:'+f.owner);
 await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'separate-personal',name:'Separate Project'});await f.ready();
 const event=f.sqlite.prepare("SELECT secret.private_event_id FROM event_private_payloads secret JOIN events e ON e.event_id=secret.private_event_id JOIN project_event_scopes scope ON scope.event_id=e.event_id WHERE scope.project_access_id=? AND e.type='BlockCreated' AND json_extract(e.payload,'$.block_id')='scene-reuse-direction'").get(f.sharing.projectAccessId);assert.ok(event);
 const before=versions(f);f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='withdrawn' WHERE private_event_id=?").run(event.private_event_id);assert.deepEqual(changed(f,before),[f.projectId]);
 assert.equal(f.sqlite.prepare('SELECT invalidated FROM creation_search_partitions WHERE project_access_id=?').get(f.sharing.projectAccessId).invalidated,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_objects o JOIN creation_search_partitions p ON p.partition_key=o.partition_key WHERE p.project_access_id=? AND o.state='active'").get(f.sharing.projectAccessId).n,0);
});

test('canonical removal immediately tombstones withdrawn Idea and container prose while preserving unrelated Idea reuse',async t=>{
 const f=await fixture(t);await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'unaffected-idea',scope:'library',type:'text',properties:{text:'Unrelated supplied text.'}});await f.ready();
 const before=f.sqlite.prepare("SELECT content_id FROM creation_search_records WHERE source_id='unaffected-idea'").get().content_id;
 await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{project_id:f.projectId,block_id:'scene-reuse-direction'});
 assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records WHERE source_id='scene-reuse-direction'").get().tombstone,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE p.project_id=? AND r.kind IN('project','document') AND r.tombstone=0").get(f.projectId).n,0);
 assert.deepEqual(f.sqlite.prepare("SELECT content_id,tombstone FROM creation_search_records WHERE source_id='unaffected-idea'").get(),Object.assign(Object.create(null),{content_id:before,tombstone:0}));
 await f.ready();await appendAuditEvent(f.env,f.streamId,'user','BlockRestored',{project_id:f.projectId,block_id:'scene-reuse-direction'});await f.ready();
 assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records WHERE source_id='scene-reuse-direction'").get().tombstone,0);
});

test('rehome invalidates both former and destination Projects before any background work',async t=>{
 const f=await fixture(t),before=versions(f);
 await appendAuditEvent(f.env,f.streamId,'user','BlockRehomed',{project_id:'second',block_id:'scene-reuse-direction',scope:'library'});
 const affected=changed(f,before);assert.ok(affected.includes(f.projectId));assert.ok(affected.includes('second'));
 assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records WHERE source_id='scene-reuse-direction'").get().tombstone,1);
 await f.ready();
 const sources=f.sqlite.prepare("SELECT p.project_id,r.tombstone,c.content FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key LEFT JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='scene-reuse-direction'").all();
 assert.equal(sources.find(s=>s.project_id===f.projectId).tombstone,1);assert.equal(sources.find(s=>s.project_id==='second').tombstone,0);
 assert.equal(JSON.parse(sources.find(s=>s.project_id==='second').content).projectId,'second');
});

test('canonical duplicate identity in another Project releases the previous indexed identity immediately',async t=>{
 const f=await fixture(t),before=versions(f);
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'second',block_id:'scene-reuse-direction',scope:'library',type:'text',properties:{text:'Replacement canonical identity in the second Project.'}});
 assert.ok(changed(f,before).includes(f.projectId),'previous indexed Project must invalidate when its identity is recreated elsewhere');
 assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE p.project_id=? AND r.source_id='scene-reuse-direction'").get(f.projectId).tombstone,1);
 await f.ready();
 assert.equal(f.sqlite.prepare("SELECT r.tombstone FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE p.project_id=? AND r.source_id='scene-reuse-direction'").get(f.projectId).tombstone,1);
 const now=f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key JOIN private_content c ON c.content_id=r.content_id WHERE p.project_id='second' AND r.source_id='scene-reuse-direction'").get();assert.equal(JSON.parse(now.content).text,'Replacement canonical identity in the second Project.');
});

test('nontext legacy recreation cannot leave a completed former Project identity eligible',async t=>{
 const f=await fixture(t);await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:true,scope:'library',type:'text',properties:{text:'Legacy boolean identity body.'}});await f.ready();
 const before=versions(f);await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'second',block_id:true,scope:'library',type:'text',properties:{text:'Recreated elsewhere.'}});
 assert.ok(changed(f,before).includes(f.projectId));assert.equal(f.sqlite.prepare("SELECT r.tombstone FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE p.project_id=? AND r.source_id='true'").get(f.projectId).tombstone,1);
 await f.ready();assert.equal(f.sqlite.prepare("SELECT r.tombstone FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE p.project_id=? AND r.source_id='true'").get(f.projectId).tombstone,1);
});
