import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {claimIndexJob} from '../worker/creation-index-schema.ts';
import {projectionPage,materializePage} from '../worker/creation-index-projection.ts';

async function drain(f,kind,handler){let n=0;for(;;){const lease=await claimIndexJob(f.env.DB,25,[kind]);if(!lease)return n;assert.ok(++n<100,'bounded fixture continuation');await handler(f.env,lease);}}
const source=(f,id)=>f.sqlite.prepare('SELECT r.*,c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id=?').get(id);

test('unrelated events and other Project Ideas do not consume target materialization pages; ordinary projection loads addressed Blocks only',async t=>{
 const f=await creationIndexFixture(t);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'other-project',name:'Unrelated'});
 for(let i=0;i<128;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:'other-project',block_id:'foreign-'+i,scope:'library',type:'text',properties:{text:'Foreign body '+i}});
 for(let i=0;i<320;i++)await appendAuditEvent(f.env,f.streamId,'user','AttentionObserved',{project_id:f.projectId,position:i});
 await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'The keeper repairs the lamp.'});
 let eventRows=0,loadedBlocks=0,targetPages=0;
 f.controls.afterRead=(statement,value)=>{if(statement.sql.startsWith('WITH page AS MATERIALIZED'))eventRows+=value.results.length;if(statement.sql.startsWith('WITH checkpoint AS')&&Array.isArray(value.results)&&value.results.some(row=>'content' in row))loadedBlocks+=value.results.filter(r=>r.kind==='blocks').length;if(statement.sql.includes("e.kind IN('projects','documents','blocks')")&&statement.values.includes(f.projectId))targetPages++;};
 const pages=await drain(f,'projection',projectionPage);assert.ok(pages<=6);assert.ok(eventRows<160,'non-authoring records are filtered before the SQL page limit');assert.ok(loadedBlocks<8,'new unrelated Blocks do not cause quadratic checkpoint reloads');
 await drain(f,'materialize',materializePage);assert.equal(targetPages,1,'128 other Project Ideas consume no target materialization slots');t.diagnostic(JSON.stringify({projectionPages:pages,authoringEventRows:eventRows,checkpointBlockRows:loadedBlocks,targetMaterializationPages:targetPages}));
 assert.equal(JSON.parse(source(f,'scene-reuse-direction').content).text,'The keeper repairs the lamp.');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_search_records WHERE source_id LIKE 'foreign-%'").get().n,0);
});

test('a canonical edit preserves an unchanged source body and changes only the edited source body',async t=>{
 const f=await creationIndexFixture(t);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'unaffected',scope:'library',type:'text',properties:{text:'A separate authored observation.'}});await f.ready();
 const unchanged=source(f,'unaffected'),edited=source(f,'scene-reuse-direction');
 await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{project_id:f.projectId,block_id:'scene-reuse-direction',property_path:'text',new_value:'The keeper repairs the lamp.'});await f.ready();
 assert.equal(source(f,'unaffected').content_id,unchanged.content_id);assert.equal(source(f,'unaffected').revision,unchanged.revision);assert.notEqual(source(f,'scene-reuse-direction').content_id,edited.content_id);assert.equal(JSON.parse(source(f,'scene-reuse-direction').content).text,'The keeper repairs the lamp.');
});

test('source-body reuse cannot resurrect a body withdrawn between read and publication',async t=>{
 const f=await creationIndexFixture(t);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 const before=source(f,'scene-reuse-direction');await appendAuditEvent(f.env,f.streamId,'user','ProjectRenamed',{project_id:f.projectId,new_name:'Harbor revised'});await drain(f,'projection',projectionPage);
 let withdrawn=false;f.controls.afterRead=(statement,value)=>{if(!withdrawn&&statement.sql.startsWith('SELECT r.content_id')&&value?.content_id===before.content_id){withdrawn=true;f.sqlite.prepare("UPDATE private_content SET redacted_at='withdrawn',content='' WHERE content_id=?").run(before.content_id);}};
 const lease=await claimIndexJob(f.env.DB,25,['materialize']);assert.ok(lease);await assert.rejects(materializePage(f.env,lease));assert.ok(withdrawn);assert.equal(f.sqlite.prepare('SELECT invalidated FROM creation_search_partitions WHERE partition_key=?').get(before.partition_key).invalidated,1);assert.equal(source(f,'scene-reuse-direction').source_version,before.source_version);
});

test('dependency attachment and Document removal preserve complete canonical ownership across projection pages',async t=>{
 const f=await creationIndexFixture(t);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'dependent',type:'text',properties:{text:'Required dependency prose.'}});
 await appendAuditEvent(f.env,f.streamId,'user','BlockRelationAdded',{project_id:f.projectId,relation_id:'contains',from_block_id:'scene-reuse-direction',to_block_id:'dependent',kind:'context_contains'});
 for(let i=0;i<65;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'padding-'+i,scope:'library',type:'text',properties:{text:'Padding '+i}});
 await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:f.projectId,document_id:'new-document',title:'New document'});
 await appendAuditEvent(f.env,f.streamId,'user','BlockDocumentAttached',{project_id:f.projectId,document_id:'new-document',block_id:'scene-reuse-direction'});
 await appendAuditEvent(f.env,f.streamId,'user','DocumentRemoved',{project_id:f.projectId,document_id:f.documentId});
 // Run discovery, then the real durable projection/materialization continuations.
 await drain(f,'projection',projectionPage);
 const projected=f.sqlite.prepare("SELECT c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id WHERE e.entity_id='blocks:dependent' ORDER BY e.generation DESC LIMIT 1").get();assert.equal(JSON.parse(projected.content).projectOwned,true);
 await drain(f,'materialize',materializePage);
 assert.equal(source(f,'dependent').tombstone,0);assert.equal(JSON.parse(source(f,'dependent').content).text,'Required dependency prose.');assert.deepEqual(JSON.parse(source(f,'dependent').content).locations,[]);
 assert.deepEqual(JSON.parse(source(f,'scene-reuse-direction').content).locations,[{documentId:'new-document',title:'New document'}]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_projection').get().n,0);
});

test('large canonical backfill advances bounded maintenance rather than exhausting preparation budget forever',async()=>{
 const {runThroughput}=await import('../scripts/still-index-throughput.mjs');
 const r=await runThroughput({ideas:160,projects:2,maxTicks:80,mutate:false,renewal:false});
 assert.equal(r.initialIndexRows,0);assert.equal(r.fullTick!==null,true,JSON.stringify(r.pendingWork));assert.equal(r.backfillCoverage.published,r.expectedSources);assert.equal(r.failedWork.length,0);
});

test('an oversized atomic preservation fanout stages durably and publishes complete retained Ideas',async t=>{
 const f=await creationIndexFixture(t);await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 for(let i=0;i<140;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'preserved-'+i,type:'text',properties:{text:'Preserve complete authored Idea '+i}});
 await appendAuditEvent(f.env,f.streamId,'user','DocumentRemoved',{project_id:f.projectId,document_id:f.documentId,preserve_project_ideas:true});
 await f.ready();
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_work WHERE state='held'").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_search_records WHERE source_id LIKE 'preserved-%' AND tombstone=0").get().n,140);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_sources WHERE source_id LIKE 'preserved-%' AND published=1").get().n,140);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id') LIKE 'preserved-%'").get().n,140);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_projection').get().n,0);
});

test('completed projection scratch is erased after withdrawal, while restore replays intact canonical prose',async t=>{
 const f=await creationIndexFixture(t),text='Unique withdrawn evidence: violet lantern beside the basalt quay.';
 await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});
 const authored=await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'withdraw-and-restore',scope:'library',type:'text',properties:{text}});await f.ready();
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_projection').get().n,0,'completed generation retains no scratch checkpoint');assert.equal(JSON.parse(source(f,'withdraw-and-restore').content).text,text);
 const before=f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE project_id=?').get(f.projectId).index_version;
 await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{project_id:f.projectId,block_id:'withdraw-and-restore'});await f.ready();for(let i=0;i<15;i++)await f.tick();
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM private_content WHERE kind='creation-search-source' AND content LIKE ?").get('%'+text+'%').n,0,'withdrawn prose has no derived private body');
 const canonical=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(authored.eventId);assert.equal(JSON.parse(canonical.private_json).properties.text,text,'canonical authored history remains intact');
 await appendAuditEvent(f.env,f.streamId,'user','BlockRestored',{project_id:f.projectId,block_id:'withdraw-and-restore'});await f.ready();
 assert.ok(f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE project_id=?').get(f.projectId).index_version>before);assert.equal(source(f,'withdraw-and-restore').tombstone,0);assert.equal(JSON.parse(source(f,'withdraw-and-restore').content).text,text);assert.equal(f.sqlite.prepare("SELECT published FROM creation_index_sources WHERE source_id='withdraw-and-restore'").get().published,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_projection').get().n,0);
});

test('fresh one-day retention stays stable and renews only near its actual deadline',async t=>{
 const f=await creationIndexFixture(t);f.env.FORMA_RETENTION_DAYS='1';await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 const generation=()=>f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE project_id=?').get(f.projectId).index_version;
 const initial=generation(),calls=f.calls.length;
 for(let i=0;i<12;i++){f.sqlite.exec("UPDATE creation_index_work SET due=0,touched=0 WHERE kind='renewal'");await f.tick();}assert.equal(generation(),initial);assert.equal(f.calls.length,calls);
 // Model a one-day body with one hour remaining, rather than shortening a fresh
 // body's assigned lifetime and accidentally changing the qualification premise.
 f.sqlite.exec("UPDATE private_content SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-23 hours'),expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour') WHERE content_id IN(SELECT content_id FROM creation_search_records); UPDATE creation_index_work SET due=0,touched=0 WHERE kind='renewal'");await f.tick();assert.ok(generation()>initial);await f.ready();
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.tombstone=0 AND unixepoch(c.expires_at)-unixepoch()<80000").get().n,0);
 const renewed=generation();for(let i=0;i<3;i++){f.sqlite.exec("UPDATE creation_index_work SET due=0,touched=0 WHERE kind='renewal'");await f.tick();}assert.equal(generation(),renewed);
});

test('withdrawn prose never enters replay scratch, while structural reference attachment effects survive',async t=>{
 const {richDocumentFromRuns}=await import('../src/still/vendor/elements/rich-document.js');
 const f=await creationIndexFixture(t),privateText='Withdrawn parent prose: cobalt orchard beneath the glass moon.';await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Harbor'});await f.ready();
 const rich={schemaVersion:1,document:richDocumentFromRuns([{kind:'text',text:privateText},{kind:'token',id:'dependency-ref',type:'still-idea-reference',text:'private display prose',label:'private display label',data:{schemaVersion:1,kind:'idea-reference',projectId:f.projectId,blockId:'surviving-dependency'}}])};
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'withdrawn-parent',type:'direction',handle:'private-parent-handle',properties:{text:privateText,rich_text_body:rich}});
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'surviving-dependency',type:'text',properties:{text:'Surviving complete dependency.'}});
 for(let i=0;i<90;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'replay-padding-'+i,scope:'library',type:'text',properties:{text:'Padding '+i}});
 await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:f.projectId,document_id:'attachment-target',title:'Target'});
 await appendAuditEvent(f.env,f.streamId,'user','BlockDocumentAttached',{project_id:f.projectId,document_id:'attachment-target',block_id:'withdrawn-parent'});
 await appendAuditEvent(f.env,f.streamId,'user','DocumentRemoved',{project_id:f.projectId,document_id:f.documentId});
 await appendAuditEvent(f.env,f.streamId,'user','BlockRemoved',{project_id:f.projectId,block_id:'withdrawn-parent'});
 let sawSkeleton=false;for(let i=0;i<20;i++){const lease=await claimIndexJob(f.env.DB,25,['projection']);if(!lease)break;await projectionPage(f.env,lease);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM private_content WHERE kind='creation-search-source' AND (instr(content,?)>0 OR instr(content,'private-parent-handle')>0 OR instr(content,'private display prose')>0)").get(privateText).n,0,'no intermediate private-body copy of currently withdrawn prose');
  const skeleton=f.sqlite.prepare("SELECT metadata FROM creation_index_replay_skeletons WHERE entity_id='blocks:withdrawn-parent'").get();if(skeleton){sawSkeleton=true;for(const prose of [privateText,'private-parent-handle','private display prose','private display label'])assert.ok(!skeleton.metadata.includes(prose));}
 }
 assert.ok(sawSkeleton);await drain(f,'materialize',materializePage);assert.equal(source(f,'surviving-dependency').tombstone,0);assert.equal(JSON.parse(source(f,'surviving-dependency').content).text,'Surviving complete dependency.');assert.deepEqual(JSON.parse(source(f,'surviving-dependency').content).locations,[]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_replay_skeletons').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_block_routes').get().n,0);
 await appendAuditEvent(f.env,f.streamId,'user','BlockRestored',{project_id:f.projectId,block_id:'withdrawn-parent'});await f.ready();assert.equal(JSON.parse(source(f,'withdrawn-parent').content).text,privateText);
});
