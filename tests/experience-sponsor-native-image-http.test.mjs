import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeImageReadFixture,readPolicy,responseJson} from './sponsor-native-image-read-fixture.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shortPolicy=()=>{const policy=readPolicy();for(const limit of Object.values(policy.operations))limit.deadlineMs=200;return policy;};
const monetaryState=f=>Object.fromEntries(['document_jobs','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

test('native sponsored current Image GET preserves the native snapshot and charges every request',async t=>{
  const f=await nativeImageReadFixture(t),before=f.snapshotNativeState(),attempts=f.attempts().length;
  const first=await responseJson(await f.readImage()),second=await responseJson(await f.readImage());
  assert.deepEqual(second,first);assert.equal(first.status,'current');assert.equal(first.revision,0);assert.equal(first.editEventId,null);
  assert.equal(first.outputId,f.outputId);assert.equal(first.ownerId,f.actor);assert.equal(first.documentId,f.documentId);
  assert.equal(first.sourceEventId,f.completionEvent.eventId);assert.equal(first.media.url,f.completedPayload.media_url);
  assert.equal(first.rawJson,f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.completedPayload.output_ref).content);
  const rows=f.attempts().slice(attempts);assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.attempt_id)).size,2);
  assert.ok(rows.every(row=>row.operation==='image-result'));assert.equal(f.io.get,2);f.assertReadOnly(before);
});

test('native sponsored original media returns exact owned PNG and private headers',async t=>{
  const f=await nativeImageReadFixture(t),before=f.snapshotNativeState(),response=await f.readMedia();
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal(response.headers.get('content-length'),String(f.originalBytes.length));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-security-policy'),/sandbox/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.originalBytes);
  assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].operation,'image-media');f.assertReadOnly(before);
});

test('actual PATCH revisions keep current GET, historical Check and all owned media within the same sponsored lineage',async t=>{
  const f=await nativeImageReadFixture(t,{edits:2}),before=f.snapshotNativeState(),count=f.attempts().length;
  const current=await responseJson(await f.readImage());assert.equal(current.revision,2);assert.deepEqual(current.media,f.edits[1].saved.imageRevision.media);
  const historical=await responseJson(await f.readImage(f.edits[0].saved.operationSha256));
  assert.equal(historical.status,'saved');assert.equal(historical.stillCurrent,false);assert.equal(historical.currentRevision,2);
  assert.deepEqual(historical.imageRevision,f.edits[0].saved.imageRevision);
  for(const [key,bytes] of [[f.originalKey,f.originalBytes],...f.edits.map(edit=>[edit.key,edit.bytes])]){
    const response=await f.readMedia(key);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(bytes));
  }
  const attempts=f.attempts().slice(count);assert.equal(attempts.length,5);
  assert.deepEqual(attempts.map(row=>row.operation).sort(),['image-media','image-media','image-media','image-result','image-result']);
  assert.equal(new Set(f.attempts().map(row=>row.attempt_id)).size,f.attempts().length);f.assertReadOnly(before);
});

test('mixed same-owner legacy ordinary image and upload remain ordinary after sponsor lookup indexes are installed',async t=>{
  const f=await nativeImageReadFixture(t,{ordinary:true}),before=f.snapshotNativeState(),count=f.attempts().length;
  const current=await responseJson(await f.readImage(undefined,{outputId:f.ordinary.outputId}));assert.equal(current.outputId,f.ordinary.outputId);
  for(const key of [f.ordinary.key,f.ordinary.uploadKey]){const response=await f.readMedia(key);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(f.ordinary.bytes));}
  assert.equal(f.attempts().length,count);f.assertReadOnly(before);
});

test('ordinary current image and uploaded media need no sponsor schema or lookup indexes',async t=>{
  const f=await nativeImageReadFixture(t,{ordinaryOnly:true}),before=f.snapshotNativeState();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE 'experience_sponsor_%' OR name LIKE 'idx_sponsor_image_%'").get().n,0);
  assert.equal((await responseJson(await f.readImage())).outputId,f.outputId);
  for(const key of [f.originalKey,f.ordinary.uploadKey]){const response=await f.readMedia(key);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(f.ordinary.bytes));}
  f.assertReadOnly(before);
});

test('ordinary legacy job with caller-supplied outputs surface and no native slot needs no sponsor state',async t=>{
  const f=await nativeImageReadFixture(t,{ordinaryOnly:true,legacyOutputJob:true}),before=f.snapshotNativeState();
  const job=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(f.ordinary.jobId);
  assert.equal(job.source_surface,'outputs');assert.equal(job.owner_id,f.actor);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_operation_slots WHERE job_id=?').get(job.job_id).n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE 'experience_sponsor_%' OR name LIKE 'idx_sponsor_image_%'").get().n,0);
  assert.equal((await responseJson(await f.readImage())).outputId,f.outputId);
  const response=await f.readMedia();assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(f.originalBytes));
  f.assertReadOnly(before);
});

for(const surface of [null,'outputs'])test(`mixed sponsor history preserves ordinary unslotted job with ${surface??'absent'} completion surface`,async t=>{
  const f=await nativeImageReadFixture(t,{ordinary:true,legacyOutputJob:true,legacyCompletionSurface:surface}),before=f.snapshotNativeState(),attempts=f.attempts().length;
  assert.ok(f.sqlite.prepare('SELECT 1 FROM experience_sponsor_consumptions WHERE actor_user_id=?').get(f.actor));
  const job=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(f.ordinary.jobId);
  assert.equal(job.source_surface,'outputs');assert.equal(job.owner_id,f.actor);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_operation_slots WHERE job_id=?').get(job.job_id).n,0);
  const completed=JSON.parse(f.sqlite.prepare("SELECT payload FROM events WHERE correlation_id=? AND type='GenerationCompleted'").get(job.correlation_id).payload);
  assert.equal(completed.source_surface,surface??undefined);
  const current=await responseJson(await f.readImage(undefined,{outputId:f.ordinary.outputId}));
  assert.equal(current.status,'current');assert.equal(current.revision,0);assert.equal(current.outputId,f.ordinary.outputId);
  assert.equal(current.media.url,f.ordinary.url);assert.equal(current.ownerId,f.actor);assert.equal(current.documentId,f.documentId);
  const response=await f.readMedia(f.ordinary.key);assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(f.ordinary.bytes));
  assert.equal(f.attempts().length,attempts);f.assertReadOnly(before);
});

test('ordinary cross-account project media preserves live membership and owner custody without sponsor attempts',async t=>{
  const f=await nativeImageReadFixture(t,{ordinaryProject:true}),project=f.projectMedia,before=f.snapshotNativeState(),count=f.attempts().length;
  assert.notEqual(project.editor,project.ownerUserId);
  assert.equal(f.sqlite.prepare('SELECT owner_id FROM document_jobs WHERE job_id=?').get(project.jobId).owner_id,project.editor);
  const response=await f.readMedia(project.key,{headers:project.headers});assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(project.bytes));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(f.attempts().length,count);f.assertReadOnly(before);
  f.transformMedia=object=>({...object,customMetadata:{...object.customMetadata,ownerId:project.editor}});
  assert.equal((await f.readMedia(project.key,{headers:project.headers})).status,403);f.assertReadOnly(before);
  f.transformMedia=undefined;
  f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE project_access_id=? AND user_id=?")
    .run(new Date().toISOString(),project.projectAccessId,project.editor);
  const revoked=f.snapshotNativeState(),gets=f.io.get;
  assert.equal((await f.readMedia(project.key,{headers:project.headers})).status,403);
  assert.equal(f.io.get,gets);assert.equal(f.attempts().length,count);f.assertReadOnly(revoked);
});

for(const route of ['image','media'])test(`native ${route} quota returns 429 before R2 or history and cannot reuse a prior attempt`,async t=>{
  const policy=readPolicy();policy.actor.maximumRequestsPerWindow=1;
  const f=await nativeImageReadFixture(t,{policy}),before=f.snapshotNativeState();
  const first=await f.readMedia();assert.equal(first.status,200);await first.arrayBuffer();
  const get=f.io.get,history=f.io.history,response=await(route==='image'?f.readImage():f.readMedia());
  assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>=1);await response.text();
  assert.equal(f.io.get,get);assert.equal(f.io.history,history);assert.equal(f.attempts().length,1);f.assertReadOnly(before);
});

for(const missing of ['policy','indexes'])test(`known sponsored reads fail closed before history/R2 with missing ${missing}`,async t=>{
  const f=await nativeImageReadFixture(t,missing==='policy'?{policy:null}:{indexes:false}),before=f.snapshotNativeState();
  for(const response of [await f.readImage(),await f.readMedia()]){assert.equal(response.status,409);await response.text();}
  assert.equal(f.io.get,0);assert.equal(f.io.history,0);assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});

for(const fault of ['owner','hash','mime','bytes','dimensions'])test(`native sponsored media refuses ${fault} mismatch with its attempt retained`,async t=>{
  const f=await nativeImageReadFixture(t);
  if(fault==='dimensions'){
    // Exercise a conflicting retained private payload without weakening the
    // database's append-only public-event guard or the admitted recipe.
    f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.image_width',513) WHERE private_event_id=?").run(f.completionEvent.eventId);
  }else f.transformMedia=object=>{
    assert.ok(object);
    if(fault==='owner')object.customMetadata.ownerId='different-owner';
    if(fault==='hash')object.customMetadata.sha256='a'.repeat(64);
    if(fault==='mime')object.writeHttpMetadata=headers=>headers.set('content-type','image/jpeg');
    if(fault==='bytes')object.body=new Blob([new Uint8Array(f.originalBytes.length)]).stream();
    return object;
  };
  const before=f.snapshotNativeState(),response=await f.readMedia();assert.ok([409,422].includes(response.status));await response.text();
  assert.equal(f.attempts().length,1);f.assertReadOnly(before);
});

test('private source retirement during R2 read withholds bytes without altering native financial state',async t=>{
  const f=await nativeImageReadFixture(t),money=monetaryState(f);let raced=false;
  f.beforeMediaGet=()=>{if(!raced){raced=true;f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-09-17T00:00:00.000Z' WHERE content_id=?").run(f.completedPayload.output_ref);}};
  const response=await f.readMedia();assert.equal(response.status,409);await response.text();assert.equal(raced,true);
  assert.equal(f.attempts().length,1);assert.deepEqual(monetaryState(f),money);f.assertNoIoWrites();
});

test('disabled generation, revoked approval and expired grant retain independently bounded owned media access',async t=>{
  const f=await nativeImageReadFixture(t);
  f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0; UPDATE experience_sponsor_resource_policies SET enabled=0; UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1; UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1;');
  f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'");
  const before=f.snapshotNativeState();assert.equal((await responseJson(await f.readImage())).outputId,f.outputId);
  const response=await f.readMedia();assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.originalBytes);
  assert.equal(f.attempts().length,2);f.assertReadOnly(before);
});

for(const stall of ['get','body'])test(`sponsored media deadline bounds stalled R2 ${stall} and keeps the attempt charged`,async t=>{
  const f=await nativeImageReadFixture(t,{policy:shortPolicy()}),before=f.snapshotNativeState();let cancellations=0;
  if(stall==='get')f.beforeMediaGet=()=>new Promise(()=>{});
  else f.transformMedia=object=>({...object,body:new ReadableStream({pull:()=>new Promise(()=>{}),cancel(){cancellations++;}})});
  const started=performance.now(),response=await f.readMedia();assert.ok(response.status>=400);await response.text();
  assert.ok(performance.now()-started<3000);assert.equal(f.attempts().length,1);
  if(stall==='body')assert.ok(cancellations>=1);f.assertReadOnly(before);
});

test('client abort during native R2 admission releases no bytes and does not refund read allowance',async t=>{
  const f=await nativeImageReadFixture(t),before=f.snapshotNativeState(),controller=new AbortController();
  f.beforeMediaGet=()=>{controller.abort();};
  const response=await f.readMedia(f.originalKey,{signal:controller.signal});assert.ok(response.status>=400);await response.text();
  assert.equal(f.attempts().length,1);f.assertReadOnly(before);
});

test('a delayed response consumer cannot emit sponsored PNG after the absolute deadline',async t=>{
  const f=await nativeImageReadFixture(t,{policy:shortPolicy()}),before=f.snapshotNativeState(),response=await f.readMedia();assert.equal(response.status,200);
  await sleep(250);await assert.rejects(response.arrayBuffer(),/deadline/);assert.equal(f.attempts().length,1);f.assertReadOnly(before);
});
