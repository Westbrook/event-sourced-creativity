import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outputTestDatabase} from './output-server-test-helpers.mjs';
import {SponsorNativeImageReadBudget} from '../worker/experience-sponsor-native-image-budget.ts';
import {sponsorOutputAssetReadEnvironment} from '../worker/experience-sponsor-output-read-budget.ts';
import {readEventPageWithHead} from '../worker/runtime.ts';

const PAGE='SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?';
const PRIVATE='SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL';
const SOURCES='SELECT private_event_id,private_json,project_id,document_id FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL';
const ASSET='SELECT * FROM output_assets WHERE scope_key=? AND asset_id=? AND document_id=? AND owner_user_id=? AND redacted_at IS NULL';
const eventColumns=['event_id','stream_id','sequence','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id','compensates_event_id','schema_version','type','payload'];
const assetColumns=['scope_key','asset_id','document_id','owner_user_id','created_by_user_id','source_digest','storage_key','content_sha256','mime_type','media_kind','created_event_id','created_at','redacted_at','byte_length'];

function fixture(t,{maximumBytes=1_000_000,deadlineMs=1_000}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  // Native integer affinity gives valid fixture numbers their real SQLite
  // type; BLOB/text/non-integral corruption still survives for refusal tests.
  f.sqlite.exec(`CREATE TABLE events(${eventColumns.map(column=>['sequence','schema_version'].includes(column)?column+' INTEGER':column).join(',')});
    CREATE TABLE event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at);
    CREATE TABLE organization_projects(owner_user_id,project_id);
    CREATE TABLE output_assets(${assetColumns.map(column=>column==='byte_length'?column+' INTEGER':column).join(',')});`);
  f.event=(id='event-1',sequence=1)=>f.sqlite.prepare(`INSERT INTO events VALUES(${eventColumns.map(()=>'?').join(',')})`).run(
    id,'creative:owner',sequence,'2026-09-17T00:00:00.000Z','2026-09-17T00:00:00.000Z','owner','client','correlation',null,null,1,'BlockCreated','{"public":true}');
  f.private=(id='event-1',body='{"private":true}')=>f.sqlite.prepare('INSERT INTO event_private_payloads VALUES(?,?,?,?,?,?,NULL)').run(id,'owner','project','document',body,'2026-09-17T00:00:00.000Z');
  f.event();f.private();
  f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?)').run('owner','project');
  f.sqlite.prepare(`INSERT INTO output_assets VALUES(${assetColumns.map(()=>'?').join(',')})`).run('personal:owner','asset','document','owner','owner','source-digest','owner/asset.png','a'.repeat(64),'image/png','image','event-1','2026-09-17T00:00:00.000Z',null,4);
  f.controller=new AbortController();
  f.budget=new SponsorNativeImageReadBudget(maximumBytes,performance.now()+deadlineMs,f.controller.signal);
  f.batches=[];
  const originalBatch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{
    const result=await originalBatch(statements);f.batches.push({sql:statements.map(item=>item.sql),result});
    if(f.afterBatch)await f.afterBatch(f.batches.length,result);
    return result;
  };
  f.guard=()=>sponsorOutputAssetReadEnvironment(f.env,f.budget,{storageKey:'owner/asset.png',byteLength:4});
  f.bodyRows=()=>f.batches.flatMap(batch=>batch.result.flatMap(part=>part.results)).filter(row=>Object.hasOwn(row,'payload')||Object.hasOwn(row,'private_json'));
  return f;
}

test('the actual native page-and-head reader retains full public/private event order under one shared budget',async t=>{
  const f=fixture(t);f.event('event-2',2);
  const result=await readEventPageWithHead(f.guard(),'creative:owner',0,5_000);
  assert.equal(result.head,2);assert.equal(result.nextAfter,2);assert.equal(result.hasMore,false);
  assert.deepEqual(result.events.map(event=>[event.eventId,event.payload]),[['event-1',{private:true}],['event-2',{public:true}]]);
  assert.equal(f.batches.length,2);assert.ok(f.bodyRows().length===2);
});

test('private sources, exact asset, governance and scalar final proof preserve native row meanings',async t=>{
  const f=fixture(t),env=f.guard();
  assert.deepEqual({...await env.DB.prepare(PRIVATE).bind('event-1','owner','project','document').first()},{private_json:'{"private":true}'});
  const sources=await env.DB.prepare(SOURCES).bind('owner',JSON.stringify(['event-1'])).all();
  assert.deepEqual(sources.results.map(row=>({...row})),[{private_event_id:'event-1',private_json:'{"private":true}',project_id:'project',document_id:'document'}]);
  const asset=await env.DB.prepare(ASSET).bind('personal:owner','asset','document','owner').first();
  assert.equal(asset.storage_key,'owner/asset.png');assert.equal(asset.byte_length,4);
  assert.equal((await env.DB.prepare('SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1').bind('owner','project').first()).present,1);
  assert.equal((await env.DB.prepare('SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END AS current').first()).current,1);
});

test('native final proof and body batch observes the current transaction without changing authority',async t=>{
  const f=fixture(t),env=f.guard();f.sqlite.exec('CREATE TABLE authority(active INTEGER);INSERT INTO authority VALUES(1)');
  f.afterBatch=number=>{if(number===1)f.sqlite.prepare('UPDATE authority SET active=0').run();};
  const proof='SELECT CASE WHEN ((SELECT active FROM authority)=1) THEN 1 ELSE 0 END AS current';
  const result=await env.DB.batch([env.DB.prepare(proof),env.DB.prepare(PRIVATE).bind('event-1','owner','project','document')]);
  // The caller must inspect its native proof. Preflight approval cannot replace
  // the second transaction's revoked proof when that caller decides to disclose.
  assert.equal(result[0].results[0].current,0);assert.equal(result[1].results[0].private_json,'{"private":true}');
  assert.equal(f.sqlite.prepare('SELECT active FROM authority').get().active,0);assert.equal(f.batches.length,2);
});

test('native scalar proof batch stays unnested and retains false authority as zero',async t=>{
  const f=fixture(t),env=f.guard(),yes='SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END AS current',no='SELECT CASE WHEN (1=0) THEN 1 ELSE 0 END AS current';
  const quoted="SELECT CASE WHEN ((SELECT ')''(')=')''(') THEN 1 ELSE 0 END AS current";
  const result=await env.DB.batch([env.DB.prepare(yes),env.DB.prepare(no),env.DB.prepare(quoted)]);
  assert.deepEqual(result.map(item=>({...item.results[0]})),[{current:1},{current:0},{current:1}]);
  assert.equal(f.batches.length,1);assert.deepEqual(f.batches[0].sql,[yes,no,quoted]);
});

test('native scalar proof reserves its fixed allowance before any underlying DB preparation',async t=>{
  const f=fixture(t,{maximumBytes:16_384});let prepares=0;const prepare=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{prepares++;return prepare(sql);};
  await assert.rejects(f.guard().DB.prepare('SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END AS current').first(),/sponsor_read_byte_capacity/);
  assert.equal(prepares,0);assert.equal(f.batches.length,0);
});

test('CASE expressions returning creative content cannot enter the fixed scalar-proof path',async t=>{
  const f=fixture(t),env=f.guard();let prepares=0;const prepare=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{prepares++;return prepare(sql);};
  for(const sql of [
    'SELECT CASE WHEN (1=1) THEN (SELECT private_json FROM event_private_payloads LIMIT 1) ELSE 0 END AS current',
    'SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END AS approved,(SELECT private_json FROM event_private_payloads LIMIT 1) AS leaked,CASE WHEN (1=1) THEN 1 ELSE 0 END AS current',
  ])assert.throws(()=>env.DB.prepare(sql),/sponsor_output_read_query_unbounded/);
  assert.equal(prepares,0);assert.equal(f.batches.length,0);
});

for(const [label,value] of [['large body','x'.repeat(30_000)],['NUL-bearing body','safe\0'+'x'.repeat(30_000)],['escaped body','\u0001'.repeat(10_000)]])test(`${label} is measured in bytes before any private body leaves SQLite`,async t=>{
  const f=fixture(t,{maximumBytes:80_000});f.sqlite.prepare('UPDATE event_private_payloads SET private_json=?').run(value);
  await assert.rejects(f.guard().DB.prepare(PAGE).bind('creative:owner',0,5_000).all(),/sponsor_read_byte_capacity/);
  assert.equal(f.batches.length,1);assert.equal(f.bodyRows().length,0);
  assert.ok(Buffer.byteLength(JSON.stringify(f.batches[0].result))<1_024);
});

test('NUL-bearing event metadata is included in the pre-body capacity check',async t=>{
  const f=fixture(t,{maximumBytes:80_000});f.sqlite.prepare('UPDATE events SET client_id=?').run('safe\0'+'x'.repeat(30_000));
  await assert.rejects(f.guard().DB.prepare(PAGE).bind('creative:owner',0,5_000).all(),/sponsor_read_byte_capacity/);
  assert.equal(f.batches.length,1);assert.equal(f.bodyRows().length,0);
});

test('duplicate exact private rows cannot make first() hide inconsistent retained custody',async t=>{
  const f=fixture(t);f.private('event-1','{"different":true}');
  await assert.rejects(f.guard().DB.prepare(PRIVATE).bind('event-1','owner','project','document').first(),/sponsor_output_read_row_invalid/);
  assert.equal(f.batches.length,1);assert.equal(f.bodyRows().length,0);
});

for(const [table,column,value] of [['events','actor',new Uint8Array([1,2])],['events','sequence','2-invalid'],['events','schema_version',1.5],['event_private_payloads','private_json',new Uint8Array([123,125])],['event_private_payloads','private_json',null]])test(`malformed ${table}.${column} (${value===null?'NULL':typeof value}) refuses the whole page without filtering away evidence`,async t=>{
  const f=fixture(t);f.event('event-2',2);f.private('event-2');
  f.sqlite.prepare(`UPDATE ${table} SET ${column}=? WHERE ${table==='events'?'event_id':'private_event_id'}=?`).run(value,'event-2');
  await assert.rejects(f.guard().DB.prepare(PAGE).bind('creative:owner',0,5_000).all(),/sponsor_output_read_row_invalid/);
  assert.equal(f.batches.length,1);assert.equal(f.bodyRows().length,0);
});

test('growth between metadata preflight and actual page cannot return the enlarged private body',async t=>{
  const f=fixture(t);let changed=false;
  f.afterBatch=number=>{if(number===1){changed=true;f.sqlite.prepare('UPDATE event_private_payloads SET private_json=?').run('safe\0'+'x'.repeat(100_000));}};
  await assert.rejects(f.guard().DB.prepare(PAGE).bind('creative:owner',0,5_000).all(),/sponsor_output_read_row_changed/);
  assert.equal(changed,true);assert.equal(f.batches.length,2);assert.equal(f.bodyRows().length,0);
});

test('a cell becoming malformed between phases rejects rather than returning a smaller filtered page',async t=>{
  const f=fixture(t);f.afterBatch=number=>{if(number===1)f.sqlite.prepare('UPDATE events SET actor=?').run(new Uint8Array([1,2]));};
  await assert.rejects(f.guard().DB.prepare(PAGE).bind('creative:owner',0,5_000).all(),/sponsor_output_read_row_invalid/);
  assert.equal(f.bodyRows().length,0);
});

test('unknown SQL, writes, external statements and alternate result methods cannot reach the binding',async t=>{
  const f=fixture(t),env=f.guard();
  for(const sql of ['SELECT private_json FROM event_private_payloads','DELETE FROM events','SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END AS current; SELECT 1'])assert.throws(()=>env.DB.prepare(sql),/sponsor_output_read_query_unbounded/);
  assert.throws(()=>env.DB.exec('DELETE FROM events'),/sponsor_output_read_query_unbounded/);
  assert.throws(()=>env.DB.dump(),/sponsor_output_read_query_unbounded/);
  assert.throws(()=>env.DB.batch([f.DB.prepare('SELECT 1')]),/sponsor_output_read_query_unbounded/);
  const statement=env.DB.prepare(PAGE).bind('creative:owner',0,5_000);
  assert.throws(()=>statement.run(),/sponsor_output_read_query_unbounded/);
  assert.throws(()=>statement.raw(),/sponsor_output_read_query_unbounded/);
  await assert.rejects(statement.first('payload'),/sponsor_output_read_query_unbounded/);
  assert.equal(f.batches.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count,1);
});

function mediaObject({size=4,chunks=[new Uint8Array([1,2,3,4])],stall=false,onCancel=()=>{},onPull=()=>{}}={}){
  let offset=0;
  return {size,customMetadata:{owner:'owner'},httpEtag:'test-etag',writeHttpMetadata(headers){headers.set('content-type','image/png');},
    body:new ReadableStream({pull(controller){onPull();if(stall)return new Promise(()=>{});if(offset===chunks.length)controller.close();else controller.enqueue(chunks[offset++]);},cancel:onCancel},{highWaterMark:0})};
}

test('only the exact adopted asset can be read, once, and ordinary R2 mutations and listing are closed',async t=>{
  const f=fixture(t);let gets=0;f.env.MEDIA.get=async key=>{gets++;assert.equal(key,'owner/asset.png');return mediaObject();};
  const env=f.guard();
  await assert.rejects(env.MEDIA.get('owner/other.png'),/sponsor_output_read_media_scope/);
  await assert.rejects(env.MEDIA.get('owner/asset.png',{range:{offset:0,length:1}}),/sponsor_output_read_media_scope/);
  for(const method of ['put','delete','list','createMultipartUpload','resumeMultipartUpload'])assert.throws(()=>env.MEDIA[method]('owner/asset.png'),/sponsor_output_read_media_scope/);
  const object=await env.MEDIA.get('owner/asset.png');assert.equal(object.size,4);
  assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()),new Uint8Array([1,2,3,4]));
  await assert.rejects(env.MEDIA.get('owner/asset.png'),/sponsor_output_read_media_scope/);assert.equal(gets,1);
});

test('insufficient reserved bytes stop R2 before its get call',async t=>{
  const f=fixture(t,{maximumBytes:65_536});let gets=0;f.env.MEDIA.get=async()=>{gets++;return mediaObject();};
  await assert.rejects(f.guard().MEDIA.get('owner/asset.png'),/sponsor_read_byte_capacity/);assert.equal(gets,0);
});

test('a mismatched R2 size is rejected and its body cancelled before exposure',async t=>{
  const f=fixture(t);let cancelled=0;f.env.MEDIA.get=async()=>mediaObject({size:5,onCancel:()=>{cancelled++;}});
  await assert.rejects(f.guard().MEDIA.get('owner/asset.png'),/sponsor_output_read_media_descriptor/);assert.equal(cancelled,1);
});

test('oversized R2 metadata is refused and its unread body is cancelled',async t=>{
  const f=fixture(t);let cancelled=0;
  f.env.MEDIA.get=async()=>({...mediaObject({onCancel:()=>{cancelled++;}}),customMetadata:{unexpected:'\0'.repeat(20_000)}});
  await assert.rejects(f.guard().MEDIA.get('owner/asset.png'),/sponsor_output_read_/);assert.equal(cancelled,1);
});

for(const [label,chunks] of [['overrun',[new Uint8Array(5)]],['short body',[new Uint8Array(3)]]])test(`an exact R2 descriptor cannot hide ${label}`,async t=>{
  const f=fixture(t);f.env.MEDIA.get=async()=>mediaObject({chunks});
  const object=await f.guard().MEDIA.get('owner/asset.png');
  await assert.rejects(new Response(object.body).arrayBuffer(),/sponsor_output_read_media_length/);
});

test('abort after the first R2 chunk stops the unsent suffix and cancels the original reader',async t=>{
  const f=fixture(t);let cancelled=0;f.env.MEDIA.get=async()=>mediaObject({chunks:[new Uint8Array([1,2]),new Uint8Array([3,4])],onCancel:()=>{cancelled++;}});
  const reader=(await f.guard().MEDIA.get('owner/asset.png')).body.getReader();
  assert.deepEqual((await reader.read()).value,new Uint8Array([1,2]));f.controller.abort();
  await assert.rejects(reader.read(),/sponsor_read_deadline/);assert.equal(cancelled,1);
});

test('a stalled R2 pull cannot renew the original absolute deadline',async t=>{
  const f=fixture(t,{deadlineMs:30});let cancelled=0;f.env.MEDIA.get=async()=>mediaObject({stall:true,onCancel:()=>{cancelled++;}});
  const object=await f.guard().MEDIA.get('owner/asset.png');t.mock.method(Date,'now',()=>0);
  await assert.rejects(new Response(object.body).arrayBuffer(),/sponsor_read_deadline/);assert.equal(cancelled,1);
});

for(const reason of ['abort','deadline'])test(`an R2 GET resolving after ${reason} cancels its late body without a pull or second GET`,async t=>{
  const f=fixture(t,{deadlineMs:reason==='deadline'?30:1_000});let resolveGet,gets=0,cancelled=0,pulls=0;
  const pending=new Promise(resolve=>{resolveGet=resolve;});
  f.env.MEDIA.get=()=>{gets++;return pending;};
  const refused=assert.rejects(f.guard().MEDIA.get('owner/asset.png'),/sponsor_read_deadline/);
  if(reason==='abort')f.controller.abort();
  await refused;assert.equal(cancelled,0);assert.equal(gets,1);
  resolveGet(mediaObject({onCancel:()=>{cancelled++;},onPull:()=>{pulls++;}}));
  await pending;await Promise.resolve();
  assert.equal(cancelled,1);assert.equal(pulls,0);assert.equal(gets,1);
});

test('source evidence permits at most eight bounded HEAD calls, without permitting reference body GETs',async t=>{
  const f=fixture(t);let heads=0,gets=0;
  f.env.MEDIA.head=async()=>{heads++;return {size:12,customMetadata:{hash:'source-hash'},httpEtag:'head-etag',writeHttpMetadata(headers){headers.set('content-type','application/pdf');}};};
  f.env.MEDIA.get=async()=>{gets++;throw Error('Reference body must stay unread');};
  const env=f.guard();
  for(let index=0;index<8;index++){const value=await env.MEDIA.head('owner/source-'+index+'.pdf');assert.equal(value.size,12);assert.equal(Object.hasOwn(value,'body'),false);}
  await assert.rejects(env.MEDIA.head('owner/source-8.pdf'),/sponsor_output_read_media_scope/);
  await assert.rejects(env.MEDIA.get('owner/source-0.pdf'),/sponsor_output_read_media_scope/);assert.equal(heads,8);assert.equal(gets,0);
});
