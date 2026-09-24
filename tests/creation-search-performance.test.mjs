import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {ensureCreationSearchSchema,D1CreationSearchIndex,searchPartitionKey} from '../worker/creation-search-index.ts';
// Local D1-shaped SQLite lexical throughput; no live semantic or reranker qualification.
for(const size of [1000,10000])test(`local lexical query budget at ${size} canonical Ideas`,async t=>{
 const f=await createSceneCostFixture(1);t.after(()=>f.close());await ensureCreationSearchSchema(f.env.DB);const p={projectId:f.projectId,custody:'personal:'+f.owner,contentVersion:'fixture',indexVersion:'0',permissionEpoch:'1',providerPolicy:'local-only'},key=searchPartitionKey(p),index=new D1CreationSearchIndex(f.env.DB);f.sqlite.prepare('INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,content_version,expected,backfill_complete,invalidated,updated_at) VALUES(?,?,?,?,?,?,1,0,?)').run(key,p.custody,p.projectId,f.owner,'fixture',size,new Date().toISOString());
 const start=performance.now();for(let i=0;i<size;i++){const id='performance-'+i,contentId='snapshot-'+i;f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES(?,?,'creation-search-source','{}',?,'2099-01-01')").run(contentId,f.owner,new Date().toISOString());await f.env.DB.batch(await index.recordStatements(p,{id,projectId:p.projectId,custody:p.custody,kind:'idea',revision:'1',contentHash:id,title:'Observation '+i,text:i===size-1?'Mara unfolds the salt-stained chart beside the brass lantern.':'Harbor note '+i,locations:[]},contentId));}
 const seededMs=performance.now()-start,times=[];for(let run=0;run<20;run++){const at=performance.now(),hits=await index.lexical(p,'salt chart brass lantern',20,new AbortController().signal);assert.equal(hits[0].id,'performance-'+(size-1));times.push(performance.now()-at);}times.sort((a,b)=>a-b);console.log(JSON.stringify({evidence:'local-sqlite-lexical',size,seededMs,p50:times[9],p95:times[18],liveModel:false,network:false}));assert.ok(times[18]<1600);
});
