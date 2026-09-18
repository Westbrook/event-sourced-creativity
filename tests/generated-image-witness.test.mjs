import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {captureSceneSourceVersion} from '../worker/scene-source-generation.ts';
import {readImageWitness,imageWitnessStatement,imageWitnessAcknowledged,imageWitnessPublished,IMAGE_WITNESS_LIMITS} from '../worker/generated-image-witness.ts';
const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
const life={check(){},sql(){},async wait(p){return await p;}};
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());migrateLocalDatabase(db,{migrations});
  const env={DB:{prepare(sql){return{sql,bindings:[],bind(...bindings){return{...this,bindings};}};},async batch(statements){
    db.exec('BEGIN');try{const rows=statements.map(value=>({success:true,results:db.prepare(value.sql).all(...value.bindings)}));db.exec('COMMIT');return rows;}catch(error){db.exec('ROLLBACK');throw error;}
  }}};
  const insert=db.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
    VALUES(?,'creative:a',?,'now','now','user','fixture','fixture','Fixture',?)`);
  const event=(n,body='{}')=>insert.run('e'+n,n,body);
  const secret=(n,body='{}')=>db.prepare("INSERT INTO event_private_payloads VALUES(?,'a','p','d',?,'now',NULL)").run('e'+n,body);
  const revision=(id='r1',artifact='generated-image/key',n=0)=>db.prepare(`INSERT INTO artifact_revisions
    (revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at)
    VALUES(?,'a',NULL,NULL,'p','d',?,?,'{}',?,'a','now','2099-01-01T00:00:00.000Z',NULL)`).run(id,artifact,n,'a'.repeat(64));
  return{db,env,event,secret,revision,capture:()=>captureSceneSourceVersion(env,{streamId:'creative:a'}),
    read:(clock=life)=>readImageWitness(env,'creative:a','a','generated-image/key','output',clock),
    verify:async guards=>imageWitnessAcknowledged(await env.DB.batch(guards.map(g=>imageWitnessStatement(env,g))),guards.length)};
}
test('read refuses missing epoch without activating or modifying anything',async t=>{
  const f=fixture(t);f.event(1);await assert.rejects(f.read(),/image_witness_epoch_absent/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM scene_source_epoch').get().n,0);
});
test('complete multi-megabyte history uses bounded pages with exact original proofs',async t=>{
  const f=fixture(t);for(let n=1;n<=300;n++)f.event(n,JSON.stringify({text:'x'.repeat(10_000),n}));f.secret(1);
  await f.capture();const result=await f.read();assert.equal(result.eventRows.length,300);assert.ok(result.eventBytes>3_000_000);
  assert.equal(result.eventRows.at(-1).event_id,'e300');assert.equal(result.eventRows[0].private_owner,'a');
  assert.ok(result.reads>3&&result.reads<30);assert.equal(await f.verify(result.guards),true);
  f.db.exec("UPDATE event_private_payloads SET private_json='{\"changed\":true}'");assert.equal(await f.verify(result.guards),false);
});
test('mutation and restoration between pages invalidates the original capture',async t=>{
  const f=fixture(t);for(let n=1;n<=300;n++)f.event(n);f.secret(1);await f.capture();
  const batch=f.env.DB.batch;let calls=0;
  f.env.DB.batch=async statements=>{if(++calls===4)f.db.exec("UPDATE event_private_payloads SET private_json='changed'; UPDATE event_private_payloads SET private_json='{}'");return batch(statements);};
  await assert.rejects(f.read(),/image_witness_changed/);
});
test('oversized or malformed rows refuse, never skip into an apparently complete result',async t=>{
  const f=fixture(t);f.event(1,'x'.repeat(IMAGE_WITNESS_LIMITS.rowBodyBytes+1));await f.capture();await assert.rejects(f.read(),/image_witness_capacity/);
  const other=fixture(t);other.db.exec(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
    VALUES('blob','creative:a',1,'now','now',zeroblob(600),'fixture','fixture','Fixture','{}')`);await other.capture();await assert.rejects(other.read(),/image_witness_capacity/);
});
test('full stream row cap and redacted raw bytes stay enforced',async t=>{
  const f=fixture(t);f.event(1);f.secret(1,'x'.repeat(16_000_001));f.db.exec("UPDATE event_private_payloads SET redacted_at='now'");await f.capture();
  await assert.rejects(f.read(),/image_witness_capacity/);
});
test('revision content, metadata, deletion and extra alias membership invalidate exact proofs',async t=>{
  const f=fixture(t);f.event(1);f.revision();await f.capture();
  for(const change of ["UPDATE artifact_revisions SET content_json='{\"x\":1}'","UPDATE artifact_revisions SET redacted_at='now'",
    "UPDATE artifact_revisions SET expires_at='2098-01-01T00:00:00.000Z'","UPDATE artifact_revisions SET project_id='other'"]){
    const current=await f.read();f.db.exec(change);assert.equal(await f.verify(current.guards),false);
  }
  const current=await f.read();f.revision('r2','output',0);assert.equal(await f.verify(current.guards),false);
  const next=await f.read();f.db.exec("DELETE FROM artifact_revisions WHERE revision_id='r1'");assert.equal(await f.verify(next.guards),false);
});
test('original proof failure aborts all batch writes; unchanged proof permits append without rechecking predecessor',async t=>{
  const f=fixture(t);f.event(1);await f.capture();const original=await f.read();f.event(2);
  f.db.exec('CREATE TABLE witness_test_marker(value TEXT)');
  await assert.rejects(f.env.DB.batch([...original.guards.map(g=>imageWitnessStatement(f.env,g,true)),f.env.DB.prepare("INSERT INTO witness_test_marker VALUES('should-not-exist')")]));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM witness_test_marker').get().n,0);
  const current=await f.read();const results=await f.env.DB.batch([...current.guards.map(g=>imageWitnessStatement(f.env,g,true)),
    f.env.DB.prepare(`INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload)
      VALUES('authored','creative:a',3,'now','now','user','fixture','fixture','Fixture','{}')`)]);
  assert.equal(imageWitnessAcknowledged(results.slice(0,current.guards.length),current.guards.length),true);
  assert.equal(await f.verify(current.guards),false);
});
test('schema mismatch, absent acknowledgment and cancellation fail closed',async t=>{
  const f=fixture(t);f.event(1);await f.capture();const batch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{const r=await batch(statements);delete r[0].success;return r;};await assert.rejects(f.read());f.env.DB.batch=batch;
  await assert.rejects(f.read({check(){throw Error('cancelled');},async wait(p){return p;}}),/cancelled/);
  f.db.exec('DROP TRIGGER scene_source_events_insert');await assert.rejects(f.read(),/image_witness_schema/);
  assert.equal(imageWitnessAcknowledged([,],1),false);
  assert.equal(imageWitnessAcknowledged([{success:true,error:'explicit failure',results:[{current:1}]}],1),false);
  assert.equal(imageWitnessAcknowledged([{success:true,results:[Object.create({current:1})]}],1),false);
  assert.equal(imageWitnessAcknowledged([Object.create({success:true,results:[{current:1}]})],1),false);
  assert.equal(imageWitnessAcknowledged([{success:true,results:[,]}],1),false);
});
test('actual PATCH publication validator rejects original accessor/inherited batch slots without invoking them',()=>{
  const api=readFileSync(new URL('../worker/generated-image-api.ts',import.meta.url),'utf8');
  assert.ok(api.includes('requireFact(imageWitnessPublished(results,prefix.length,statements.length))'));
  const guard={success:true,results:[{current:1}]},write={success:true,meta:{changes:1}};
  assert.equal(imageWitnessPublished([guard,write],1,1),true);
  let touched=0;const accessor=[guard,write];Object.defineProperty(accessor,0,{get(){touched++;return guard;}});
  assert.equal(imageWitnessPublished(accessor,1,1),false);assert.equal(touched,0);
  const inherited=[,write];Object.setPrototypeOf(inherited,{0:guard});assert.equal(imageWitnessPublished(inherited,1,1),false);
  assert.equal(imageWitnessPublished([guard,{...write,error:'failure'}],1,1),false);
  assert.equal(imageWitnessPublished([guard,{success:true,meta:Object.create({changes:1})}],1,1),false);
  assert.equal(imageWitnessPublished([guard,{success:true,meta:{changes:0}}],1,1),false);
});

test('incremental consumers exceed array capacity without retaining raw rows and still require terminal original-version proof',async t=>{
  const f=fixture(t);for(let n=1;n<=170;n++)f.event(n,JSON.stringify({text:'x'.repeat(100_000)}));await f.capture();
  await assert.rejects(f.read(),/capacity_event_bytes/);
  let count=0;const consumer={accept(){count++;},checkpoint(){}};
  const result=await readImageWitness(f.env,'creative:a','a','generated-image/key','output',life,consumer);
  assert.equal(count,170);assert.equal(result.eventCount,170);assert.equal(result.eventRows.length,0);
  assert.equal(result.head,170);assert.ok(result.eventBytes>16_000_000);assert.equal(await f.verify(result.guards),true);
  let changed=false;
  await assert.rejects(readImageWitness(f.env,'creative:a','a','generated-image/key','output',life,{accept(){},checkpoint(){
    if(!changed){changed=true;f.event(171);}
  }}),/image_witness_changed/);
});

test('prefetch reduces round trips but keeps per-page proofs and exact complete order',async t=>{
  const f=fixture(t);for(let n=1;n<=2048;n++)f.event(n);await f.capture();
  const original=f.env.DB.batch;let batches=0,statements=0;
  f.env.DB.batch=async values=>{batches++;statements+=values.length;return original(values);};
  const sequential=await f.read();const baseline=batches;batches=0;statements=0;const seen=[];
  const result=await readImageWitness(f.env,'creative:a','a','generated-image/key','output',life,{accept(row){seen.push(row.sequence);},checkpoint(){}});
  assert.deepEqual(seen,Array.from({length:2048},(_,i)=>i+1));
  assert.ok(batches<baseline);assert.equal(result.queryCount,statements);assert.equal(result.queryCount,sequential.queryCount);
  assert.equal(result.reads,sequential.reads);assert.equal(result.head,2048);assert.equal(await f.verify(result.guards),true);
});
for(const start of [1,257])test('byte-limited prefetched page at '+start+' never skips its unfinished range',async t=>{
  const f=fixture(t);for(let n=1;n<=1200;n++)f.event(n,JSON.stringify({text:'x'.repeat(n>=start&&n<start+256?6000:10)}));await f.capture();
  const sequential=await f.read();const seen=[];let statements=0;
  const result=await readImageWitness(f.env,'creative:a','a','generated-image/key','output',{...life,sql(n){statements+=n;}},{accept(row){seen.push(row.sequence);},checkpoint(){}});
  assert.deepEqual(seen,Array.from({length:1200},(_,i)=>i+1));assert.equal(result.queryCount,statements);
  assert.equal(result.reads,sequential.reads+(start===1?3:2));assert.equal(result.head,1200);
});
test('bad later prefetched acknowledgment prevents consuming even the first page',async t=>{
  const f=fixture(t);for(let n=1;n<=1024;n++)f.event(n);await f.capture();
  const original=f.env.DB.batch;let consumed=0;
  f.env.DB.batch=async values=>{const rows=await original(values);if(values.length===8)rows[7]={success:true,results:[{current:0}]};return rows;};
  await assert.rejects(readImageWitness(f.env,'creative:a','a','generated-image/key','output',life,{accept(){consumed++;},checkpoint(){}}),/image_witness_changed/);
  assert.equal(consumed,0);
});
test('prefetch charges SQL before dispatch and still rejects mutation between groups',async t=>{
  const f=fixture(t);for(let n=1;n<=2048;n++)f.event(n);await f.capture();let queries=0,consumed=0;
  await assert.rejects(readImageWitness(f.env,'creative:a','a','generated-image/key','output',{...life,sql(n){if(queries+n>5)throw Error('SQL budget');queries+=n;}},{accept(){consumed++;},checkpoint(){}}),/SQL budget/);
  assert.equal(queries,4);assert.equal(consumed,0);
  let changed=false;
  await assert.rejects(readImageWitness(f.env,'creative:a','a','generated-image/key','output',life,{accept(){},checkpoint(){if(!changed){changed=true;f.event(2049);}}}),/image_witness_changed/);
});
