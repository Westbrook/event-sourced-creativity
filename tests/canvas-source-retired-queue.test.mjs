import assert from "node:assert/strict";
import test from "node:test";
import { CanvasOfflineQueue, CANVAS_OFFLINE_MAX_AGE_MS, CANVAS_OFFLINE_MAX_OPERATIONS, CANVAS_OFFLINE_MAX_BYTES, canvasBatchBelongsToScope } from "../src/sync/canvas-offline-queue.ts";
import { canvasQueueDatabase, canvasQueueTurn } from "./helpers/canvas-source-queue-host.mjs";

const scope={ownerId:"canvas-owner",projectId:"canvas-project"};
const owner={authorizationKey:"canvas-auth",actorUserId:scope.ownerId,projectId:scope.projectId,sourceGeneration:0};
const event=(index=0,target=scope)=>({type:"CanvasItemPlaced",payload:{project_id:target.projectId,history_owner_id:target.ownerId,history_action_id:"original-batch",client_event_id:"original-client-"+index,title:"PRIVATE RETIRED SOURCE",body:"Private server-derived body",item_id:"item-"+index}});
const canonical=(input,index=0)=>({eventId:"canonical-"+index,type:input.type,sequence:index+1,actor:"user:"+scope.ownerId,payload:{...input.payload}});
function receipt(batch,outcome="unconfirmed",committed=0){
  return{observationId:"actual-observation",owner:{...owner},action:"canvas_sync",requestedClientEventIds:batch.events.map(input=>input.payload.client_event_id),
    committed:batch.events.slice(0,committed).map((input,index)=>({eventId:"canonical-"+index,type:input.type,sequence:index+1,clientEventId:input.payload.client_event_id})),
    rejectedIndices:[],outcome,observedHead:outcome==="observed"?committed:null,privateUnavailable:true};
}
async function fixture(t,count=2){
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No external network/provider in queue tests"));
  const db=canvasQueueDatabase();db.install(t);const queue=new CanvasOfflineQueue(),batch=await queue.enqueueBatch(Array.from({length:count},(_,index)=>event(index)),scope);
  return{db,queue,batch};
}
const bodyFree=value=>{const text=JSON.stringify(value);assert.doesNotMatch(text,/PRIVATE RETIRED SOURCE|Private server-derived body|"payload"|"title"|"body"/);};

for(const outcome of ["observed","partial","unconfirmed","unconfirmed-partial","not-attempted"])test("retired Canvas queue preserves exact original "+outcome+" references without private bodies",async t=>{
  const {db,queue,batch}=await fixture(t),ack=receipt(batch,outcome==="partial"?"observed":outcome==="unconfirmed-partial"?"unconfirmed":outcome,outcome==="observed"?2:outcome==="partial"||outcome==="unconfirmed-partial"?1:0);
  await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:ack}});
  const [saved]=await new CanvasOfflineQueue().listBatches(scope);
  assert.equal(saved.id,batch.id);assert.equal(saved.createdAt,batch.createdAt);assert.equal(saved.actionSequence,batch.actionSequence);assert.deepEqual(saved.events,[]);
  assert.deepEqual(saved.sourceRetired.requested,batch.events.map(input=>({clientEventId:input.payload.client_event_id,type:input.type})));
  assert.deepEqual(saved.sourceRetired.acknowledgments,[ack]);bodyFree(saved);bodyFree(db.values.get(batch.id));
  assert.equal((await queue.summary(scope)).count,2);assert.equal((await queue.summary(scope)).paused,2);
  assert.equal(db.transactions.at(-1).completed,true);
});

test("source retirement alone does not invent an acknowledgment or an unused outcome",async t=>{
  const {queue,batch}=await fixture(t);await queue.retireSource(scope);const[saved]=await queue.list(scope);
  assert.deepEqual(saved.sourceRetired.acknowledgments,[]);assert.equal(saved.sourceRetired.batchId,batch.id);bodyFree(saved);
});

test("request success is not a durable queue pause until the native-order transaction commits",async t=>{
  const {db,queue,batch}=await fixture(t),held=db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired));
  let done=false;const pause=queue.retireSource(scope).then(()=>{done=true;});
  await held.entered;assert.equal(done,false);assert.ok(db.values.get(batch.id).events.length,"uncommitted replacement is not yet durable");
  held.release();await pause;assert.equal(done,true);assert.deepEqual(db.values.get(batch.id).events,[]);
});

for(const failure of ["abort-after-put","quota","blocked-open"])test("failed "+failure+" pause keeps only a same-page fence and no false durability",async t=>{
  const {db,queue,batch}=await fixture(t);
  if(failure==="abort-after-put")db.abortNextCommit();else if(failure==="quota")db.failNextWrite();else db.blockNextOpen();
  await assert.rejects(queue.retireSource(scope));assert.equal(db.values.get(batch.id).events.length,2,"failed persistence is not hidden by the port");
  const publicRows=await queue.listBatches(scope);bodyFree(publicRows);assert.equal(publicRows[0].sourceRetired.requested.length,2);
  const summary=await queue.summary(scope);assert.equal(summary.sourcePauseFailed,true);assert.equal(summary.count,2);assert.equal(summary.paused,2);
  await assert.rejects(queue.enqueueBatch([{...event(3),payload:{...event(3).payload,history_action_id:"new"}}],scope),/canvas_source_retired/);
  assert.equal((await new CanvasOfflineQueue().listBatches(scope))[0].events.length,2,"a failed transaction cannot claim reload-safe withdrawal");
  await queue.retireSource(scope);assert.equal((await queue.summary(scope)).sourcePauseFailed,false);bodyFree(await new CanvasOfflineQueue().listBatches(scope));
});

test("same-page queued read cannot publish a private snapshot after retirement begins",async t=>{
  const {db,queue}=await fixture(t),held=db.holdRequest(item=>item.method==="getAll");
  const reading=queue.listBatches(scope);await held.entered;const pausing=queue.retireSource(scope);held.release();
  bodyFree(await reading);await pausing;bodyFree(await queue.listBatches(scope));
});

for(const boundary of ["before-put","after-put-success"])test("late original enqueue at "+boundary+" retains its IDs but cannot retain withdrawn bodies",async t=>{
  const db=canvasQueueDatabase();db.install(t);const queue=new CanvasOfflineQueue();let source=true;
  const held=boundary==="before-put"?db.holdRequest(item=>item.method==="getAll"):db.holdCommit(record=>record.operations.some(item=>item.method==="put"));
  const pending=queue.enqueueBatch([event()],scope,{current:()=>source});await held.entered;source=false;held.release();
  const saved=await pending;assert.deepEqual(saved.events,[]);assert.equal(saved.sourceRetired.requested[0].clientEventId,"original-client-0");
  bodyFree(await new CanvasOfflineQueue().listBatches(scope));assert.equal(db.values.size,1);
});

test("late original receipt neither replaces its original handle nor withdraws a newer current draft",async t=>{
  const {queue,batch}=await fixture(t);await queue.retireSource(scope);
  const newer=await queue.enqueueBatch([{...event(3),payload:{...event(3).payload,history_action_id:"new-current",title:"NEW CURRENT DRAFT"}}],scope);
  const ack=receipt(batch,"observed",1);await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:ack}});
  const rows=await queue.listBatches(scope);assert.equal(rows.length,2);
  assert.deepEqual(rows.find(row=>row.id===newer.id).events,newer.events);assert.deepEqual(rows.find(row=>row.id===batch.id).sourceRetired.acknowledgments,[ack]);
  await assert.rejects(queue.enqueueBatch([event()],scope),/canvas_source_retired/);assert.equal((await queue.listBatches(scope)).length,2);
});

for(const change of ["foreign-owner","foreign-project","foreign-auth","foreign-client","wrong-type","duplicate-event","malformed","unknown-outcome"])test("retired receipt rejects "+change+" without deleting original IDs",async t=>{
  const {queue,batch}=await fixture(t),ack=receipt(batch,"observed",1);
  if(change==="foreign-owner")ack.owner.actorUserId="other";
  if(change==="foreign-project")ack.owner.projectId="other";
  if(change==="foreign-auth")ack.owner.authorizationKey="other";
  if(change==="foreign-client")ack.committed[0].clientEventId="unrelated";
  if(change==="wrong-type")ack.committed[0].type="ProjectOpened";
  if(change==="duplicate-event")ack.committed.push({...ack.committed[0]});
  if(change==="malformed")ack.privateBody="PRIVATE RETIRED SOURCE";
  if(change==="unknown-outcome")ack.outcome="failed";
  await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:ack}});
  const[saved]=await queue.listBatches(scope);assert.equal(saved.sourceRetired.requested.length,2);assert.deepEqual(saved.sourceRetired.acknowledgments,[]);bodyFree(saved);
});

test("actual observations deduplicate and repeated unknown observations cannot grow metadata without bound",async t=>{
  const {queue,batch}=await fixture(t),ack=receipt(batch);
  for(let index=0;index<20;index++)await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:{...ack,observationId:index<10?ack.observationId:"duplicate-unknown-"+index}}});
  let[saved]=await queue.listBatches(scope);assert.deepEqual(saved.sourceRetired.acknowledgments,[ack]);
  const partial=receipt(batch,"observed",1);partial.observationId="later-exact-observation";
  await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:partial}});
  [saved]=await queue.listBatches(scope);assert.equal(saved.sourceRetired.acknowledgments.length,2);assert.equal(saved.sourceRetired.requested.length,2);
});

for(const control of ["unrelated","partial","actor","project","type","duplicate","inactive"])test("current read "+control+" is not whole-batch reconciliation authority",async t=>{
  const {queue,batch}=await fixture(t);await queue.retireSource(scope);let events=batch.events.map(canonical);
  if(control==="unrelated")events=[canonical(event(99),99)];
  if(control==="partial")events=events.slice(0,1);
  if(control==="actor")events[0].actor="user:other";
  if(control==="project")events[0].payload.project_id="other";
  if(control==="type")events[0].type="ProjectOpened";
  if(control==="duplicate")events.push({...events[0]});
  await queue.reconcileRetired(scope,events,{current:()=>control!=="inactive"});
  const rows=await queue.listBatches(scope);assert.equal(rows.length,1);assert.equal(rows[0].sourceRetired.requested.length,2);bodyFree(rows);
});

test("only a healthy current exact canonical history can reconcile a fully confirmed paused batch",async t=>{
  const {queue,batch}=await fixture(t);await queue.retireSource(scope);
  const newBatch=await queue.enqueueBatch([{...event(3),payload:{...event(3).payload,history_action_id:"new-current"}}],scope);
  await queue.reconcileRetired(scope,batch.events.map(canonical),{current:()=>true});
  assert.deepEqual((await queue.listBatches(scope)).map(row=>row.id),[newBatch.id]);
});

test("source withdrawal while canonical reconciliation waits cannot delete unresolved references",async t=>{
  const {db,queue,batch}=await fixture(t);await queue.retireSource(scope);let source=true;
  const held=db.holdRequest(item=>item.method==="getAll"),reconcile=queue.reconcileRetired(scope,batch.events.map(canonical),{current:()=>source});
  await held.entered;source=false;held.release();await reconcile;assert.equal((await queue.listBatches(scope)).length,1);
});

test("paused original IDs are exempt from TTL and count toward the existing operation capacity",async t=>{
  const {queue,db}=await fixture(t,1);await queue.retireSource(scope);
  let now=Date.now();t.mock.method(Date,"now",()=>now);now+=CANVAS_OFFLINE_MAX_AGE_MS*2;
  assert.equal((await queue.summary(scope)).count,1);
  const saved=db.values.values().next().value;
  saved.sourceRetired.requested=Array.from({length:CANVAS_OFFLINE_MAX_OPERATIONS},(_,index)=>({clientEventId:"retained-"+index,type:"CanvasItemPlaced"}));saved.bytes=0;
  assert.equal((await queue.summary(scope)).count,CANVAS_OFFLINE_MAX_OPERATIONS);assert.equal((await queue.summary(scope)).full,true);
  await assert.rejects(queue.enqueueBatch([{...event(3),payload:{...event(3).payload,history_action_id:"new-current"}}],scope),/10,000/);assert.equal(db.values.size,1);
});

test("paused metadata uses actual bytes rather than a forged zero byte counter",async t=>{
  const {queue,db}=await fixture(t,1);await queue.retireSource(scope);
  const saved=db.values.values().next().value;saved.sourceRetired.requested[0].clientEventId="x".repeat(CANVAS_OFFLINE_MAX_BYTES);saved.bytes=0;
  const summary=await queue.summary(scope);assert.ok(summary.bytes>CANVAS_OFFLINE_MAX_BYTES);assert.equal(summary.full,true);
  await assert.rejects(queue.enqueueBatch([{...event(3),payload:{...event(3).payload,history_action_id:"new-current"}}],scope),/50 MB/);assert.equal(db.values.size,1);
});

test("legacy nullable original IDs and exact legacy storage identity survive retirement without invention",async t=>{
  const db=canvasQueueDatabase();db.install(t);const queue=new CanvasOfflineQueue(),legacyEvent=event();delete legacyEvent.payload.client_event_id;
  db.values.set("legacy-row",{id:"legacy-row",event:legacyEvent,createdAt:"2026-08-20T00:00:00.000Z",bytes:123});
  await queue.retireSource(scope);const[saved]=await queue.listBatches(scope);
  assert.equal(saved.id,"legacy:legacy-row");assert.equal(db.values.has("legacy-row"),true);assert.equal(saved.sourceRetired.requested[0].clientEventId,null);
  await queue.reconcileRetired(scope,[canonical(event())],{current:()=>true});assert.equal((await queue.listBatches(scope)).length,1);bodyFree(saved);
});

test("exact scope and explicit personal erasure remain separate from source retirement",async t=>{
  const {queue,db,batch}=await fixture(t),shared={...scope,organizationId:"org",projectAccessId:"access",historyOwnerId:"history",permissionEpoch:"epoch"};
  const sharedBatch=await queue.enqueueBatch([event(8,shared)],shared);await queue.retireSource(scope);
  const saved=(await queue.listBatches(scope))[0];
  assert.equal(canvasBatchBelongsToScope(saved,{...scope,ownerId:"other"}),false);
  assert.equal(canvasBatchBelongsToScope(saved,shared),false);
  await queue.removeBatch(batch.id,scope);assert.equal((await queue.listBatches(scope)).length,1,"ordinary removal cannot discard a paused unresolved handle");
  assert.equal(await queue.clearPersonalOwner(scope.ownerId),1);assert.equal(db.values.has(sharedBatch.id),true);assert.equal(db.values.has(batch.id),false);
});

test("paused normalization never accepts private extra keys or a made-up empty event branch",async t=>{
  const {queue,db,batch}=await fixture(t);await queue.retireSource(scope);const original=structuredClone(db.values.get(batch.id));
  for(const value of [{...original,privateBody:"PRIVATE RETIRED SOURCE"},{...original,sourceRetired:{...original.sourceRetired,privateBody:"PRIVATE RETIRED SOURCE"}},{...original,sourceRetired:undefined}]){
    db.values.set(batch.id,value);assert.equal(canvasBatchBelongsToScope(value,scope),false);assert.deepEqual(await queue.listBatches(scope),[]);
  }
});

test("a healthy non-retired offline batch keeps its original replayable payload and IDs",async t=>{
  const {queue,batch}=await fixture(t),before=structuredClone(batch);
  assert.deepEqual(await new CanvasOfflineQueue().listBatches(scope),[before]);
  assert.equal((await queue.summary(scope)).paused,0);
  await queue.removeBatch(batch.id,scope);assert.equal((await queue.summary(scope)).count,0);
});

test("private erasure wins over a paused late write without recreating its original record",async t=>{
  const {queue,db}=await fixture(t),held=db.holdRequest(item=>item.method==="getAll");
  const pause=queue.retireSource(scope);await held.entered;const erase=queue.clearPersonalOwner(scope.ownerId);held.release();
  await pause;assert.equal(await erase,1);assert.equal(db.values.size,0);await canvasQueueTurn();assert.deepEqual(await queue.listBatches(scope),[]);
});

const advancePastTtl=t=>{let now=Date.now();t.mock.method(Date,"now",()=>now);now+=CANVAS_OFFLINE_MAX_AGE_MS*2;};
for(const phase of["abortable-pending","committing"])test("retirement preserves original references when TTL deletion is "+phase,async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const predicate=record=>record.operations.some(item=>item.method==="delete"&&item.key===batch.id);
 const held=phase==="committing"?db.holdCommitting(predicate):db.holdCommit(predicate),listing=queue.listBatches(scope);
 const original=await held.entered;assert.equal(original.phase,phase);
 let settled=false;const pause=queue.retireSource(scope).then(()=>{settled=true;});await canvasQueueTurn();
 assert.equal(settled,false);assert.equal(original.abortAttempts,1);assert.equal(original.abortUnavailable,phase==="committing"?1:0);
 if(phase==="committing")assert.equal(original.aborted,false,"commit already begun was not rolled back");else assert.equal(original.aborted,true);
 held.release();bodyFree(await listing);await pause;
 const [saved]=await new CanvasOfflineQueue().listBatches(scope);assert.equal(saved.id,batch.id);assert.equal(saved.createdAt,batch.createdAt);assert.equal(saved.actionSequence,batch.actionSequence);
 assert.deepEqual(saved.sourceRetired.requested.map(item=>item.clientEventId),["original-client-0","original-client-1"]);bodyFree(saved);assert.equal((await queue.summary(scope)).sourcePauseFailed,false);
 assert.equal(original.completed,phase==="committing");
});

test("a TTL delete committed before retirement remains expired and has no stale transaction owner",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);assert.deepEqual(await queue.listBatches(scope),[]);
 const original=db.transactions.find(record=>record.operations.some(item=>item.method==="delete"));assert.equal(original.phase,"committed");
 await queue.retireSource(scope);assert.deepEqual(await queue.listBatches(scope),[]);assert.equal(db.values.has(batch.id),false);assert.equal(original.abortAttempts,0);
});

test("commit-already-begun recovery is not durable until the replacement transaction commits",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const original=db.holdCommitting(record=>record.operations.some(item=>item.method==="delete")),listing=queue.listBatches(scope);await original.entered;
 const replacement=db.holdCommit(record=>record.operations.some(item=>item.value?.sourceRetired));let settled=false;
 const pause=queue.retireSource(scope).then(()=>{settled=true;});original.release();const restoring=await replacement.entered;
 assert.equal(settled,false);assert.equal(db.values.has(batch.id),false,"the original TTL commit really removed the row");
 assert.equal(restoring.phase,"abortable-pending");replacement.release();await listing;await pause;
 assert.equal(db.values.get(batch.id).sourceRetired.batchId,batch.id);bodyFree(db.values.get(batch.id));
});

test("failed replacement after an irreversible delete retains bounded original metadata only in-page",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const held=db.holdCommitting(record=>record.operations.some(item=>item.method==="delete")),listing=queue.listBatches(scope);const original=await held.entered;
 db.failNextWrite();const pause=queue.retireSource(scope);const failed=assert.rejects(pause);held.release();await listing;await failed;
 assert.equal(original.completed,true);assert.equal(original.aborted,false);assert.equal(db.values.has(batch.id),false);
 const [saved]=await queue.listBatches(scope);assert.equal(saved.id,batch.id);assert.equal(saved.sourceRetired.requested.length,2);bodyFree(saved);
 const summary=await queue.summary(scope);assert.equal(summary.count,2);assert.equal(summary.paused,2);assert.equal(summary.sourcePauseFailed,true);
 assert.deepEqual(await new CanvasOfflineQueue().listBatches(scope),[],"no reload-safe retained-reference claim after failed storage");
 await assert.rejects(queue.enqueueBatch([{...event(8),payload:{...event(8).payload,history_action_id:"new"}}],scope),/canvas_source_retired/);
 await queue.retireSource(scope);bodyFree(await new CanvasOfflineQueue().listBatches(scope));assert.equal((await queue.summary(scope)).sourcePauseFailed,false);
});

for(const boundary of["original-commit","replacement-commit"])test("explicit personal erasure wins during "+boundary+" without resurrecting paused IDs",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const held=db.holdCommitting(record=>record.operations.some(item=>item.method==="delete")),listing=queue.listBatches(scope);await held.entered;
 const replacing=boundary==="replacement-commit"?db.holdCommit(record=>record.operations.some(item=>item.value?.sourceRetired)):null;
 const pause=queue.retireSource(scope);
 let erasing;if(boundary==="original-commit")erasing=queue.clearPersonalOwner(scope.ownerId);
 held.release();if(replacing){await replacing.entered;erasing=queue.clearPersonalOwner(scope.ownerId);replacing.release();}
 await listing;await pause;await erasing;assert.equal(db.values.has(batch.id),false);assert.deepEqual(await queue.listBatches(scope),[]);
 const ack=receipt(batch,"unconfirmed");await queue.retireSource(scope,{batchIds:[batch.id],receipt:{batches:[batch],owner,acknowledgment:ack}});
 assert.deepEqual(await queue.listBatches(scope),[]);assert.equal(db.values.size,0,"late exact receipt never recreates erased IDs");
});

test("source retirement does not abort a different scope's expiry transaction",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const held=db.holdCommit(record=>record.operations.some(item=>item.method==="delete")),listing=queue.listBatches(scope);const original=await held.entered;
 const pause=queue.retireSource({...scope,projectId:"other-project"});await canvasQueueTurn();assert.equal(original.abortAttempts,0);held.release();await listing;await pause;
 assert.equal(original.completed,true);assert.equal(db.values.has(batch.id),false);
});

test("personal erasure cannot invalidate shared-scope retirement metadata",async t=>{
 const {db,queue}=await fixture(t),shared={...scope,organizationId:"org",projectAccessId:"access",historyOwnerId:"history",permissionEpoch:"epoch"};
 const batch=await queue.enqueueBatch([event(8,shared)],shared);advancePastTtl(t);
 const held=db.holdCommitting(record=>record.operations.some(item=>item.method==="delete"&&item.key===batch.id)),listing=queue.listBatches(shared);await held.entered;
 const pause=queue.retireSource(shared),erasing=queue.clearPersonalOwner(scope.ownerId);held.release();await listing;await pause;await erasing;
 const [saved]=await queue.listBatches(shared);assert.equal(saved.id,batch.id);bodyFree(saved);assert.equal((await queue.summary(shared)).sourcePauseFailed,false);
});

for(const replacement of["new-original-scope-record","new-authorized-scope"])test("retired metadata cannot overwrite "+replacement+" at the original storage key",async t=>{
 const {db,queue,batch}=await fixture(t);advancePastTtl(t);
 const held=db.holdCommitting(record=>record.operations.some(item=>item.method==="delete")),listing=queue.listBatches(scope);await held.entered;
 const pause=queue.retireSource(scope),failure=assert.rejects(pause,/canvas_queue_storage_unavailable/);
 const nextScope=replacement==="new-authorized-scope"?{...scope,ownerId:"new-owner"}:scope;
 const newer=new CanvasOfflineQueue(),input=event(55,nextScope);input.payload.title="NEW CURRENT BODY";const writing=newer.enqueueBatch([input],nextScope);
 // The separate actual transaction was admitted before the retirement replacement starts.
 await canvasQueueTurn();held.release();await listing;const written=await writing;await failure;
 assert.equal(written.id,batch.id);assert.equal(db.values.get(batch.id).events[0].payload.client_event_id,"original-client-55");
 assert.equal(db.values.get(batch.id).events[0].payload.title,"NEW CURRENT BODY");assert.equal(db.values.get(batch.id).ownerId,nextScope.ownerId);
 const [retained]=await queue.listBatches(scope);assert.deepEqual(retained.sourceRetired.requested.map(item=>item.clientEventId),["original-client-0","original-client-1"]);bodyFree(retained);
});

test("coalesced source callers observe the same failing commit rather than a request-success promise",async t=>{
 const {db,queue}=await fixture(t),held=db.holdCommit(record=>record.operations.some(item=>item.value?.sourceRetired));
 const first=queue.retireSource(scope),firstFailure=assert.rejects(first);await held.entered;
 const second=queue.retireSource(scope),secondFailure=assert.rejects(second);held.reject(new DOMException("Synthetic final commit failure","AbortError"));
 await firstFailure;await secondFailure;assert.equal((await queue.summary(scope)).sourcePauseFailed,true);
 assert.equal(db.transactions.filter(record=>record.operations.some(item=>item.value?.sourceRetired)).length,1);
});
