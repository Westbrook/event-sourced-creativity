/** Observer controls only; canonical lifecycle qualification lives in the companion test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRenewalObservation} from '../scripts/still-index-throughput-renewal.mjs';

function fixture({withSnapshot=false,snapshotHead=true,missingSnapshot=false}={}){
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),iso=seconds=>new Date(seconds*1000).toISOString();
 const content='{"text":"Only supplied text"}',bytes=new Uint8Array(2048),checksum=sha(bytes);
 const source={partition_key:'p',source_id:'idea',revision:'r',content_hash:sha(content),source_version:'head',semantic_revision:'r',semantic_model:'repr',tombstone:0,content_version:'head',index_version:7,invalidated:0,owner_id:'owner',project_access_id:null,content_id:'original-body',content,created_at:iso(0),expires_at:iso(400),redacted_at:null,body_owner:'owner',body_kind:'creation-search-source',generation:7,published_revision:'r',representation:'repr',expected:1,completed:1,published:1,source_expires:400};
 const object={partition_key:'p',source_id:'idea',member_source_id:'idea',member_revision:'r',generation:7,representation:'repr',object_key:'original-shard',expires:300,checksum,byte_count:2048,vector_offset:0,start_offset:0,end_offset:18};
 if(withSnapshot&&snapshotHead)Object.assign(source,{snapshot_id:'old-snapshot',snapshot_content:'{"id":"idea"}',snapshot_created_at:iso(0),snapshot_expires_at:iso(250),snapshot_redacted_at:null,snapshot_owner:'owner',snapshot_kind:'creation-search-source',snapshot_generation:7});
 if(missingSnapshot)Object.assign(source,{snapshot_id:null,snapshot_content:null,snapshot_created_at:null,snapshot_expires_at:null});
 const storage=new Map([[object.object_key,{bytes,customMetadata:{checksum}}]]);
 const sqlite={prepare(sql){return{all(){if(sql.includes('sqlite_schema'))return withSnapshot?[{name:'creation_index_snapshots'},{name:'creation_index_snapshot_heads'}]:[];return sql.includes('FROM creation_search_records')?[{...source}]:[{...object}];}};}};
 const observer=createRenewalObservation({sqlite,storage,nowSeconds:100,expectedSources:1});
 const body=()=>Object.assign(source,{content_id:'renewed-body',created_at:iso(200),expires_at:iso(600)}),manifest=()=>source.source_expires=600,vector=()=>object.expires=600;
 const snapshot=()=>Object.assign(source,{snapshot_id:'new-snapshot',snapshot_created_at:iso(200),snapshot_expires_at:iso(450)});
 return{source,object,storage,observer,body,manifest,vector,snapshot};
}

test('actual body, manifest and vector retention can qualify without changing generation',()=>{
 const f=fixture();f.body();f.manifest();f.vector();
 assert.equal(f.observer.observe(200,1).complete,true);
 assert.equal(f.source.generation,7);
 assert.equal(f.observer.report().renewedSources,1);
 assert.equal(f.observer.report().noCoverageGap,true);
});
for(const component of ['body','manifest','vector'])test(`${component}-only expiry extension cannot masquerade as complete renewal`,()=>{
 const f=fixture();f[component]();assert.equal(f.observer.observe(200,1).complete,false);
 assert.equal(f.observer.report().renewedSources,0);
});
test('a generation bump alone is not renewal evidence',()=>{
 const f=fixture();f.source.index_version++;f.source.generation++;f.object.generation++;
 assert.equal(f.observer.observe(200,1).coverage,1);
 assert.equal(f.observer.report().renewedSources,0);
});
test('unchanged-size corrupted R2 bytes invalidate otherwise extended retention',()=>{
 const f=fixture();f.body();f.manifest();f.vector();f.storage.get('original-shard').bytes[0]=1;
 const point=f.observer.observe(200,1);assert.equal(point.coverage,0);assert.equal(point.complete,false);
 assert.equal(f.observer.report().noCoverageGap,false);
});
test('each component has its own deadline; earlier shard renewal does not force a later body deadline',()=>{
 const f=fixture();f.vector();f.observer.observe(250,1);
 const early=f.observer.observe(300,2);assert.equal(early.deadlineMisses,0);assert.equal(early.complete,false);
 assert.equal(f.observer.report().firstShortWindow.coverage,1);
 f.body();f.manifest();assert.equal(f.observer.observe(350,3).complete,true);
 assert.equal(f.observer.report().deadlineMisses.length,0);
});
test('retention extended at the original deadline is too late',()=>{
 const f=fixture();f.body();f.manifest();f.vector();const point=f.observer.observe(300,1);
 assert.equal(point.complete,true);assert.equal(point.deadlineMisses,1);
 assert.equal(f.observer.report().deadlineMisses[0].component,'vector:[0,18]');
});

test('protected canonical snapshot retention participates in the earliest due time and completion proof',()=>{
 const f=fixture({withSnapshot:true});assert.equal(f.observer.firstDue,190);
 f.body();f.manifest();f.vector();assert.equal(f.observer.observe(200,1).complete,false);
 f.snapshot();assert.equal(f.observer.observe(210,2).complete,true);
 assert.equal(f.observer.report().snapshotSources,1);
});
test('expired canonical snapshot fails even while indexed body and vector remain live',()=>{
 const f=fixture({withSnapshot:true});f.body();f.manifest();f.vector();const point=f.observer.observe(250,1);
 assert.equal(point.coverage,0);assert.equal(point.deadlineMisses,1);
 assert.equal(f.observer.report().deadlineMisses[0].component,'snapshot');
});
test('a token expiry extension does not qualify as a fresh full policy lifetime',()=>{
 const f=fixture();f.body();f.manifest();f.vector();f.source.expires_at=new Date(401000).toISOString();
 assert.equal(f.observer.observe(200,1).complete,false);
});

test('head-absent legacy partition still requires source, manifest and vector renewal without inventing a snapshot obligation',()=>{
 const f=fixture({withSnapshot:true,snapshotHead:false});assert.equal(f.observer.report().initialDurableSources,1);
 f.body();f.manifest();f.vector();assert.equal(f.observer.observe(200,1).complete,true);
 assert.equal(f.observer.report().snapshotSources,0);
});
test('a present snapshot head with missing canonical body is an invalid initial renewal proof',()=>{
 const f=fixture({withSnapshot:true,missingSnapshot:true});assert.equal(f.observer.report().initialDurableSources,0);
 assert.equal(f.observer.report().sourceWitnesses[0].initialProof.snapshotHeadPresent,true);
 assert.equal(f.observer.report().sourceWitnesses[0].initialProof.snapshotPresent,false);
});
