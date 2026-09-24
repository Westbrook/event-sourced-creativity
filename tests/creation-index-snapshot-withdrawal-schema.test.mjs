import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';

const count=f=>f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshot_heads WHERE partition_key=?').get(f.key).n;
async function fixture(t){const f=await creationIndexFixture(t);await f.ready();f.key=f.sqlite.prepare('SELECT partition_key FROM creation_search_partitions WHERE project_id=?').get(f.projectId).partition_key;assert.equal(count(f),1);return f;}
// Deliberately stage public and private writes separately to model delayed/imported
// private evidence. This is an adversarial schema fixture, not ordinary app authoring.
function publicRemoval(f,payload={project_id:'foreign',block_id:'unrelated'}){
 const row={...f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence DESC LIMIT 1').get(f.streamId)};
 row.event_id=crypto.randomUUID();row.sequence++;row.type='BlockRemoved';row.payload=JSON.stringify(payload);
 const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO events(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));return row;
}
function privateRemoval(f,event,body={project_id:'foreign',block_id:'unrelated'},options={}){
 f.sqlite.prepare('INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,?,?,?,?,?)').run(event.event_id,options.owner??f.owner,options.project??'foreign',null,typeof body==='string'?body:JSON.stringify(body),new Date().toISOString(),options.redacted??null);
}

test('delayed private removal of an actual target poisons the anchor despite a public foreign claim',async t=>{
 const f=await fixture(t),event=publicRemoval(f);assert.equal(count(f),1);
 privateRemoval(f,event,{project_id:f.projectId,block_id:'scene-reuse-direction'},{project:f.projectId});assert.equal(count(f),0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key=?').get(f.key).n,0);
});
for(const mode of ['owner','project','unknown-id','empty-id','malformed'])test(`delayed removal with ${mode} mismatch cannot preserve the completed anchor`,async t=>{
 const f=await fixture(t),event=publicRemoval(f);assert.equal(count(f),1);
 const body=mode==='unknown-id'?{project_id:'foreign'}:mode==='empty-id'?{project_id:'foreign',block_id:''}:mode==='malformed'?'{broken':{project_id:'foreign',block_id:'unrelated'};
 privateRemoval(f,event,body,{...(mode==='owner'?{owner:'other-owner'}:{}),...(mode==='project'?{project:'other-project'}:{})});assert.equal(count(f),0);
});

test('exact delayed private evidence for an unrelated foreign removal preserves the anchor and authored bytes',async t=>{
 const f=await fixture(t),before=f.sqlite.prepare('SELECT entity_id,content_id FROM creation_index_snapshots WHERE partition_key=? ORDER BY entity_id').all(f.key),event=publicRemoval(f);privateRemoval(f,event);assert.equal(count(f),1);assert.deepEqual(f.sqlite.prepare('SELECT entity_id,content_id FROM creation_index_snapshots WHERE partition_key=? ORDER BY entity_id').all(f.key),before);
});
for(const mutation of ['update','delete'])test(`later ${mutation} of exact unrelated private evidence still poisons snapshots conservatively`,async t=>{
 const f=await fixture(t),event=publicRemoval(f);privateRemoval(f,event);assert.equal(count(f),1);
 if(mutation==='update')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=?').run(event.event_id);else f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(event.event_id);assert.equal(count(f),0);
});

test('private owner mismatch poisons both the stream owner and claimed owner anchors',async t=>{
 const f=await fixture(t);const other='other-owner';f.sqlite.prepare("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('other-anchor','personal:other-owner','other-project',?,datetime('now'))").run(other);f.sqlite.prepare("INSERT INTO creation_index_snapshot_heads VALUES('other-anchor',0,0,0)").run();
 const event=publicRemoval(f);privateRemoval(f,event,undefined,{owner:other});assert.equal(count(f),0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_snapshot_heads WHERE partition_key='other-anchor'").get().n,0);
});

for(const mutation of ['update','delete'])test(`public ${mutation} of an unrelated removal remains a broad owner-history poison`,async t=>{
 const f=await fixture(t),event=publicRemoval(f);privateRemoval(f,event);assert.equal(count(f),1);
 // Authoring blocks rewrites; remove only that fixture barrier to exercise the
 // defensive migration/import trigger beneath it.
 f.sqlite.exec('DROP TRIGGER events_block_'+mutation);
 if(mutation==='update')f.sqlite.prepare('UPDATE events SET payload=payload WHERE event_id=?').run(event.event_id);else f.sqlite.prepare('DELETE FROM events WHERE event_id=?').run(event.event_id);assert.equal(count(f),0);
});

test('private evidence inserted at an already snapshotted owner head cannot use the unrelated-removal exemption',async t=>{
 const f=await fixture(t),event=publicRemoval(f);assert.equal(count(f),1);
 // Model a completed replay head which already consumed this public event.
 f.sqlite.prepare('UPDATE creation_index_snapshot_heads SET owner_head=? WHERE partition_key=?').run(event.sequence,f.key);
 privateRemoval(f,event);assert.equal(count(f),0);
});
