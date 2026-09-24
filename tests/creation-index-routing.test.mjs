import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {serializeEvent} from '../worker/event-read-primitives.ts';
import {createCreativeEventFold} from '../src/model/events.ts';
import {CREATION_INDEX_ROUTING_SCHEMA,CREATION_ROUTING_PAGE_SIZE,prepareCreationProjectionRouting,creationProjectionRoutingPredicate} from '../worker/creation-index-routing.ts';

async function routes(f,{head,after=0,generation=1}={}){
 await f.env.DB.batch(CREATION_INDEX_ROUTING_SCHEMA.map(sql=>f.env.DB.prepare(sql)));
 const l={partition_key:'test-routing',generation};head??=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(f.streamId).n;
 let pages=0;for(;;){const page=await prepareCreationProjectionRouting(f.env,l,{head,after,projectId:f.projectId,streamId:f.streamId,ownerId:f.owner});assert.ok(page.rows<=CREATION_ROUTING_PAGE_SIZE);if(page.statements.length)await f.env.DB.batch(page.statements);pages++;after=page.after;if(page.done)return {l,head,pages};assert.ok(pages<100);}
}
const append=(f,type,payload)=>appendAuditEvent(f.env,f.streamId,'user',type,payload);
function checkpoint(f,route){
 const fold=createCreativeEventFold(Infinity,'',f.projectId);
 const rows=f.sqlite.prepare(`SELECT e.*,COALESCE(secret.private_json,e.payload) AS private_json FROM events e LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE e.stream_id=? AND (substr(e.type,1,5)='Block' OR substr(e.type,1,7)='Project' OR substr(e.type,1,8)='Document') ${route?'AND '+creationProjectionRoutingPredicate:''} ORDER BY e.sequence`).all(f.streamId,...(route?[route.l.partition_key,route.l.generation]:[]));
 for(const row of rows)fold.accept(serializeEvent(row));
 const c=fold.authoringCheckpoint();return {rows:rows.length,value:{...c,blocks:c.blocks.filter(b=>b.projectId===f.projectId)}};
}

test('bounded foreign-identity routing preserves canonical target projection across moves, relations, legacy selection and duplicate creations',async t=>{
 const f=await creationIndexFixture(t);await append(f,'ProjectCreated',{project_id:f.projectId,name:'Target'});await append(f,'ProjectCreated',{project_id:'foreign',name:'Foreign'});await append(f,'DocumentCreated',{project_id:'foreign',document_id:'foreign-document',title:'Foreign'});
 for(let i=0;i<320;i++)await append(f,'BlockCreated',{project_id:'foreign',block_id:'foreign-'+i,scope:'library',type:'text',properties:{text:'Unrelated private body '+i}});
 await append(f,'BlockCreated',{project_id:'foreign',block_id:'moved',scope:'library',type:'text',properties:{text:'Body before later rehome'}});await append(f,'BlockRehomed',{project_id:f.projectId,block_id:'moved',scope:'library'});
 await append(f,'ProjectOpened',{project_id:f.projectId});await append(f,'DocumentOpened',{project_id:f.projectId,document_id:f.documentId});await append(f,'BlockCreated',{block_id:'legacy',type:'text',properties:{text:'Implicit selected Project body'}});
 await append(f,'BlockCreated',{project_id:'foreign',block_id:'duplicate',scope:'library',type:'text',properties:{text:'Old foreign duplicate'}});await append(f,'BlockCreated',{project_id:f.projectId,block_id:'duplicate',scope:'library',type:'text',properties:{text:'Current target duplicate'}});
 await append(f,'BlockRelationAdded',{project_id:f.projectId,relation_id:'cross-relation',from_block_id:'moved',to_block_id:'foreign-0',kind:'context_contains'});
 await append(f,'BlockPropertyEdited',{block_id:'foreign-1',property_path:'text',new_value:'Legacy unscoped edit'});
 await append(f,'BlockCreated',{project_id:'foreign',block_id:'42',scope:'library',type:'text',properties:{text:'Foreign string ID'}});await append(f,'BlockCreated',{project_id:f.projectId,block_id:42,scope:'library',type:'text',properties:{text:'Legacy numeric ID'}});await append(f,'BlockPropertyEdited',{project_id:'foreign',block_id:'42',property_path:'text',new_value:'Canonical coercion remains conservative'});
 const r=await routes(f),full=checkpoint(f),filtered=checkpoint(f,r);assert.ok(r.pages>=2);assert.ok(full.rows-filtered.rows>=318);assert.deepEqual(filtered.value,full.value);
 for(const id of ['moved','legacy','duplicate','foreign-0','foreign-1'])assert.equal(f.sqlite.prepare('SELECT safe_foreign FROM creation_index_block_routes WHERE block_id=?').get(id).safe_foreign,0,id);
 assert.equal(f.sqlite.prepare("SELECT safe_foreign FROM creation_index_block_routes WHERE block_id='foreign-319'").get().safe_foreign,1);
});

test('frozen head routing keeps latest removal state across pages and never omits ambiguous public/private scope',async t=>{
 const f=await creationIndexFixture(t);await append(f,'ProjectCreated',{project_id:f.projectId,name:'Target'});
 await append(f,'BlockCreated',{project_id:'foreign',block_id:'stateful',scope:'library',type:'text',properties:{text:'Stateful'}});await append(f,'BlockRemoved',{project_id:'foreign',block_id:'stateful'});
 for(let i=0;i<260;i++)await append(f,'BlockCreated',{project_id:'foreign',block_id:'padding-'+i,scope:'library',type:'text',properties:{text:'Padding'}});
 const beforeRestore=f.sqlite.prepare('SELECT MAX(sequence) n FROM events WHERE stream_id=?').get(f.streamId).n;
 await append(f,'BlockRestored',{project_id:'foreign',block_id:'stateful'});await append(f,'BlockRemoved',{project_id:'foreign',block_id:'padding-0'});await append(f,'BlockCreated',{project_id:'foreign',block_id:'padding-0',scope:'library',type:'text',properties:{text:'Recreated'}});
 const conflicted=await append(f,'BlockCreated',{project_id:'foreign',block_id:'conflicting-claims',scope:'library',type:'text',properties:{text:'Uncertain scope'}});
 f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.project_id',?) WHERE private_event_id=?").run('different-foreign',conflicted.eventId);
 await routes(f,{head:beforeRestore,generation:1});assert.equal(f.sqlite.prepare("SELECT removed FROM creation_index_block_routes WHERE generation=1 AND block_id='stateful'").get().removed,1);
 await routes(f,{generation:2});assert.equal(f.sqlite.prepare("SELECT removed FROM creation_index_block_routes WHERE generation=2 AND block_id='stateful'").get().removed,0);assert.equal(f.sqlite.prepare("SELECT removed FROM creation_index_block_routes WHERE generation=2 AND block_id='padding-0'").get().removed,0);assert.equal(f.sqlite.prepare("SELECT safe_foreign FROM creation_index_block_routes WHERE generation=2 AND block_id='conflicting-claims'").get().safe_foreign,0);
 const proof=f.sqlite.prepare("EXPLAIN QUERY PLAN SELECT e.event_id FROM events e LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id WHERE e.stream_id=? AND "+creationProjectionRoutingPredicate).all(f.streamId,'test-routing',2).map(v=>v.detail).join('\n');assert.match(proof,/SEARCH route USING INDEX/);assert.doesNotMatch(proof,/SCAN route/);
});

test('partial routing never starts replay and a canonical move restarts proof before publication',async t=>{
 const f=await creationIndexFixture(t);await append(f,'ProjectCreated',{project_id:f.projectId,name:'Target'});
 for(let i=0;i<320;i++)await append(f,'BlockCreated',{project_id:'foreign',block_id:'route-page-'+i,scope:'library',type:'text',properties:{text:'Canonical foreign source '+i}});
 const key=JSON.stringify(['personal:'+f.owner,f.projectId]);
 f.sqlite.prepare("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(key,'personal:'+f.owner,f.projectId,f.owner);
 const {claimIndexJob}=await import('../worker/creation-index-schema.ts'),{projectionPage}=await import('../worker/creation-index-projection.ts');
 const lease=await claimIndexJob(f.env.DB,25,['projection']);assert.ok(lease);await projectionPage(f.env,lease);
 const first=f.sqlite.prepare('SELECT * FROM creation_index_work WHERE job_key=?').get(lease.job_key);assert.equal(JSON.parse(first.cursor).routeComplete,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_projection').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_search_records').get().n,0);assert.equal(f.calls.length,0);
 await append(f,'BlockRehomed',{project_id:f.projectId,block_id:'route-page-0',scope:'library'});
 const restarted=f.sqlite.prepare('SELECT * FROM creation_index_work WHERE job_key=?').get(lease.job_key);assert.ok(restarted.generation>first.generation);assert.equal(restarted.cursor,'');
 await f.ready();const source=f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='route-page-0' AND r.tombstone=0").get();assert.equal(JSON.parse(source.content).text,'Canonical foreign source 0');assert.equal(f.sqlite.prepare("SELECT published FROM creation_index_sources WHERE source_id='route-page-0'").get().published,1);
});

test('removed numeric legacy identity is routed as removed before replay and never persists withdrawn prose',async t=>{
 const f=await creationIndexFixture(t),secret='Unique withdrawn numeric legacy prose: copper anchor beneath lilac fog.';
 await append(f,'ProjectCreated',{project_id:f.projectId,name:'Target'});await append(f,'BlockCreated',{project_id:f.projectId,block_id:42,scope:'library',type:'text',properties:{text:secret}});
 for(let i=0;i<65;i++)await append(f,'BlockCreated',{project_id:f.projectId,block_id:'numeric-padding-'+i,scope:'library',type:'text',properties:{text:'Target padding '+i}});
 await append(f,'BlockRemoved',{project_id:f.projectId,block_id:42});
 const key=JSON.stringify(['personal:'+f.owner,f.projectId]);f.sqlite.prepare("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(key,'personal:'+f.owner,f.projectId,f.owner);
 const {claimIndexJob}=await import('../worker/creation-index-schema.ts'),{projectionPage}=await import('../worker/creation-index-projection.ts');let pages=0;
 for(;;){const lease=await claimIndexJob(f.env.DB,25,['projection']);if(!lease)break;assert.ok(++pages<30);await projectionPage(f.env,lease);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND c.content LIKE ?").get(key,lease.generation,'%'+secret+'%').n,0,'no current-generation checkpoint or stage persists withdrawn body');}
 const route=f.sqlite.prepare("SELECT * FROM creation_index_block_routes WHERE partition_key=? AND block_id='42'").get(key);assert.equal(route.removed,1);assert.equal(route.safe_foreign,0);assert.ok(pages>2);
 const skeleton=f.sqlite.prepare("SELECT metadata FROM creation_index_replay_skeletons WHERE partition_key=? AND entity_id='blocks:42'").get(key);assert.ok(skeleton);assert.ok(!skeleton.metadata.includes(secret));await f.ready();
 await append(f,'BlockRestored',{project_id:f.projectId,block_id:42});await f.ready();const current=f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.source_id='42' AND r.tombstone=0").get();assert.equal(JSON.parse(current.content).text,secret);
});
