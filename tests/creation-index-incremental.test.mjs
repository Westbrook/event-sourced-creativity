import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {claimIndexJob} from '../worker/creation-index-schema.ts';
import {resumeCreationIndexPartition} from '../worker/creation-index-reconcile.ts';
import {projectionPage,materializePage} from '../worker/creation-index-projection.ts';
const getPartition=f=>f.sqlite.prepare('SELECT * FROM creation_search_partitions WHERE project_id=?').get(f.projectId);
async function drain(f,kind,handler){for(let n=0;n<100;n++){const lease=await claimIndexJob(f.env.DB,25,[kind]);if(!lease)return n;await handler(f.env,lease);}assert.fail('continuation stalled');}
const records=f=>f.sqlite.prepare('SELECT r.source_id,r.revision,r.content_hash,r.tombstone,c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=? ORDER BY r.source_id').all(getPartition(f).partition_key);
async function author(f,type,payload){return appendAuditEvent(f.env,f.streamId,'user',type,{project_id:f.projectId,...payload});}

test('one canonical text delta replays one event, rematerializes both reused Documents and preserves exact full-replay results',async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});await author(f,'DocumentCreated',{document_id:'second-document',title:'Second'});await author(f,'BlockDocumentAttached',{document_id:'second-document',block_id:'scene-reuse-direction'});
 for(let i=0;i<65;i++)await author(f,'BlockCreated',{block_id:'unchanged-'+i,scope:'library',type:'text',properties:{text:'Unchanged observation '+i}});
 await f.ready();const before=records(f),unaffected=f.sqlite.prepare("SELECT content_id FROM creation_search_records WHERE source_id='unchanged-0'").get().content_id;
 assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots').get().n>65);
 await author(f,'BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'Changed faithful supplied prose.'});let replayed=0,materialized=0;
 f.controls.afterRead=(s,v)=>{if(s.sql.startsWith('WITH page AS MATERIALIZED(SELECT e.*,'))replayed+=v.results.length;if(s.sql.startsWith('SELECT e.entity_id,e.kind,c.content'))materialized+=v.results.length;};
 await drain(f,'projection',projectionPage);const p=getPartition(f),job=f.sqlite.prepare("SELECT cursor FROM creation_index_work WHERE job_key=?").get('projection:'+p.partition_key);assert.equal(JSON.parse(job.cursor).incremental.ideaIds[0],'scene-reuse-direction');assert.equal(replayed,1);
 await drain(f,'materialize',materializePage);assert.equal(materialized,4,'Idea, Project and both live Documents only');assert.equal(f.sqlite.prepare("SELECT content_id FROM creation_search_records WHERE source_id='unchanged-0'").get().content_id,unaffected);
 const incremental=records(f);assert.notEqual(incremental.find(r=>r.source_id==='scene-reuse-direction').revision,before.find(r=>r.source_id==='scene-reuse-direction').revision);assert.ok(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_work WHERE job_key LIKE 'embedding-target:%' AND cursor='scene-reuse-direction'").get().n);
 f.controls.afterRead=undefined;f.sqlite.prepare('DELETE FROM creation_index_snapshot_heads WHERE partition_key=?').run(p.partition_key);await resumeCreationIndexPartition(f.env,p.partition_key);await drain(f,'projection',projectionPage);await drain(f,'materialize',materializePage);assert.deepEqual(records(f),incremental,'incremental and canonical complete replay render identical sources/revisions');
});

for(const mutation of ['structural','expired','private-redaction','missing-snapshot'])test(`incremental preparation falls back after ${mutation}`,async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});await f.ready();
 if(mutation==='structural')await author(f,'DocumentCreated',{document_id:'new-structural',title:'New'});
 if(mutation==='missing-snapshot')f.sqlite.exec("DELETE FROM creation_index_snapshots WHERE kind='documents'");
 if(mutation==='expired')f.sqlite.exec("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id IN(SELECT content_id FROM creation_index_snapshots)");
 if(mutation==='private-redaction'){const row=f.sqlite.prepare("SELECT p.private_event_id FROM event_private_payloads p JOIN events e ON e.event_id=p.private_event_id WHERE e.type='BlockCreated' LIMIT 1").get();f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='withdrawn',private_json='{}' WHERE private_event_id=?").run(row.private_event_id);}
 await author(f,'BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'Current canonical change.'});await drain(f,'projection',projectionPage);
 const p=getPartition(f),job=f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key);assert.equal(JSON.parse(job.cursor).incremental,undefined);await drain(f,'materialize',materializePage);
});

test('canonical withdrawal during incremental snapshot read denies the old lease and detaches retained prose',async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});await f.ready();await author(f,'BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'New pending change.'});
 let removed=false;f.controls.afterRead=async(s)=>{if(!removed&&s.sql.startsWith('WITH snapshot_metadata AS MATERIALIZED')){removed=true;await author(f,'BlockRemoved',{block_id:'scene-reuse-direction'});}};
 const lease=await claimIndexJob(f.env.DB,25,['projection']);await assert.rejects(projectionPage(f.env,lease));assert.ok(removed);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key=?').get(lease.partition_key).n,0);
});

test('an unrelated owner text delta does not force whole-Project replay, while a conflicting exact identity does',async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});await author(f,'ProjectCreated',{project_id:'foreign-project',name:'Foreign'});await author(f,'BlockCreated',{project_id:'foreign-project',block_id:'foreign-observation',scope:'library',type:'text',properties:{text:'Other project prose.'}});await f.ready();
 await author(f,'BlockPropertyEdited',{project_id:'foreign-project',block_id:'foreign-observation',property_path:'text',new_value:'Unrelated edit after the target snapshot head.'});
 await author(f,'BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'Target Project current text.'});await drain(f,'projection',projectionPage);
 const p=getPartition(f);let cursor=JSON.parse(f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key).cursor);assert.deepEqual(cursor.incremental?.ideaIds,['scene-reuse-direction']);await drain(f,'materialize',materializePage);
 await author(f,'BlockPropertyEdited',{project_id:'foreign-project',block_id:'scene-reuse-direction',property_path:'text',new_value:'Exact identity follows canonical semantics.'});await drain(f,'projection',projectionPage);
 cursor=JSON.parse(f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key).cursor);assert.equal(cursor.incremental,undefined);await drain(f,'materialize',materializePage);assert.equal(JSON.parse(records(f).find(row=>row.source_id==='scene-reuse-direction').content).text,'Exact identity follows canonical semantics.');
});

test('a 500-Idea Project stays incremental after unrelated withdrawal and publishes its next edit within five maintenance wakes',async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});
 for(let i=0;i<500;i++)await author(f,'BlockCreated',{block_id:'large-'+i,scope:'library',type:'text',properties:{text:'Complete original source '+i}});
 await author(f,'ProjectCreated',{project_id:'foreign',name:'Other'});await author(f,'BlockCreated',{project_id:'foreign',block_id:'foreign-withdrawn',scope:'library',type:'text',properties:{text:'Unique removed foreign prose: heliotrope estuary.'}});await f.ready();
 const p=getPartition(f),before=f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key=?').get(p.partition_key).n;
 await author(f,'BlockRemoved',{project_id:'foreign',block_id:'foreign-withdrawn'});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key=?').get(p.partition_key).n,before,'unrelated completed anchor survives withdrawal');await f.ready();
 await author(f,'BlockPropertyEdited',{block_id:'large-0',property_path:'text',new_value:'Supplied edit after another Project withdrew an Idea.'});
 let wakes=0;for(;wakes<5;){await f.tick();wakes++;if(f.sqlite.prepare("SELECT 1 FROM creation_search_records r JOIN creation_index_sources s USING(partition_key,source_id) JOIN creation_search_partitions p USING(partition_key) JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='large-0' AND s.published=1 AND s.revision=r.revision AND s.generation=p.index_version AND p.invalidated=0 AND c.content LIKE '%Supplied edit after another Project%'").get())break;}
 assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_search_records r JOIN creation_index_sources s USING(partition_key,source_id) JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='large-0' AND s.published=1 AND s.revision=r.revision AND c.content LIKE '%Supplied edit after another Project%'").get(),'current edited Idea publishes within five bounded runner wakes');
 const cursor=JSON.parse(f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key).cursor);assert.deepEqual(cursor.incremental.ideaIds,['large-0']);t.diagnostic(JSON.stringify({ideas:500,wakes,retainedUnrelatedSnapshots:before}));
 await f.ready();for(let i=0;i<5;i++)await f.tick();assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM private_content WHERE kind='creation-search-source' AND content LIKE '%Unique removed foreign prose%'").get().n,0,'preserved unrelated snapshots never retain the withdrawn foreign prose');
 const incremental=records(f);f.sqlite.prepare('DELETE FROM creation_index_snapshot_heads WHERE partition_key=?').run(p.partition_key);await resumeCreationIndexPartition(f.env,p.partition_key);await drain(f,'projection',projectionPage);await drain(f,'materialize',materializePage);assert.deepEqual(records(f),incremental,'complete canonical replay agrees after unrelated withdrawal');
});

for(const claim of ['unknown','conflicting'])test(`a ${claim} withdrawal claim never preserves an unsafe incremental anchor`,async t=>{
 const f=await creationIndexFixture(t);await author(f,'ProjectCreated',{name:'Harbor'});await f.ready();
 await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{...(claim==='conflicting'?{project_id:'foreign'}:{}),block_id:'scene-reuse-direction'});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshot_heads WHERE partition_key=?').get(getPartition(f).partition_key).n,0);await author(f,'BlockPropertyEdited',{block_id:'scene-reuse-direction',property_path:'text',new_value:'A correction cannot restore removed content.'});await drain(f,'projection',projectionPage);
 const p=getPartition(f),cursor=JSON.parse(f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key).cursor);assert.equal(cursor.incremental,undefined);await drain(f,'materialize',materializePage);assert.equal(f.sqlite.prepare("SELECT tombstone FROM creation_search_records WHERE source_id='scene-reuse-direction'").get().tombstone,1);
});
