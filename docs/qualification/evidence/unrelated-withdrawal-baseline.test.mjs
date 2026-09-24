import test from 'node:test';import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {creationIndexFixture} from '/private/tmp/still-hosted-qualification/tests/helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '/private/tmp/still-hosted-qualification/worker/runtime.ts';
import {claimIndexJob} from '/private/tmp/still-hosted-qualification/worker/creation-index-schema.ts';
import {projectionPage,materializePage} from '/private/tmp/still-hosted-qualification/worker/creation-index-projection.ts';
const results=[];
for(const ideas of [65,500])test('post unrelated withdrawal profile '+ideas,async t=>{
 const f=await creationIndexFixture(t);const event=(type,p)=>appendAuditEvent(f.env,f.streamId,'user',type,p);
 await event('ProjectCreated',{project_id:f.projectId,name:'Target'});
 for(let i=0;i<ideas;i++)await event('BlockCreated',{project_id:f.projectId,block_id:'profile-'+i,scope:'library',type:'text',properties:{text:'Target canonical text '+i}});
 await event('ProjectCreated',{project_id:'foreign',name:'Foreign'});await event('BlockCreated',{project_id:'foreign',block_id:'withdrawn-foreign',scope:'library',type:'text',properties:{text:'Unrelated source private prose.'}});await f.ready();
 const p=f.sqlite.prepare('SELECT * FROM creation_search_partitions WHERE project_id=?').get(f.projectId);const snapshots=()=>f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key=?').get(p.partition_key).n;
 const before=snapshots();await event('BlockRemoved',{project_id:'foreign',block_id:'withdrawn-foreign'});const immediatelyAfter=snapshots(),targetInvalidated=f.sqlite.prepare('SELECT invalidated FROM creation_search_partitions WHERE partition_key=?').get(p.partition_key).invalidated;
 await f.ready();assert.equal(snapshots(),0);await event('BlockPropertyEdited',{project_id:f.projectId,block_id:'profile-0',property_path:'text',new_value:'Changed after unrelated withdrawal.'});
 const quanta={projection:0,materialize:0},rows={events:0,materialized:0};f.controls.afterRead=(s,v)=>{if(s.values.includes(p.partition_key)){if(s.sql.startsWith('WITH page AS MATERIALIZED(SELECT e.*,'))rows.events+=v.results.length;if(s.sql.startsWith('SELECT e.entity_id,e.kind,c.content'))rows.materialized+=v.results.length;}};
 for(const [kind,handler] of [['projection',projectionPage],['materialize',materializePage]])for(let i=0;i<200;i++){const lease=await claimIndexJob(f.env.DB,25,[kind]);if(!lease)break;if(lease.partition_key===p.partition_key)quanta[kind]++;await handler(f.env,lease);}
 const cursor=JSON.parse(f.sqlite.prepare('SELECT cursor FROM creation_index_work WHERE job_key=?').get('projection:'+p.partition_key).cursor);const result={ideas,beforeSnapshots:before,afterForeignRemovalSnapshots:immediatelyAfter,targetInvalidated,incremental:!!cursor.incremental,quanta,rows};results.push(result);t.diagnostic(JSON.stringify(result));
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT c.content FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE source_id='profile-0'").get().content).text,'Changed after unrelated withdrawal.');writeFileSync('/private/tmp/still-unrelated-withdrawal-profile.json',JSON.stringify(results,null,2));
});
