import assert from "node:assert/strict";
import test from "node:test";
import {readyPreparation,dispatchInitial,ordinaryInterruption,sourceRetirement,openArrangement,
 counts,canonicalEvents,check,continuationControl} from "./helpers/arrangement-refusal-interruption-fixture.mjs";

const labels=x=>x.f.tree().visible("bdi").filter(node=>Object.hasOwn(node.parent?.attributes??{},"data-arrangement-local-name"));
const hasReview=x=>x.f.tree().visible("button").some(node=>node.attributes["data-choice-value"]===x.operation());
for(const shared of[false,true])
test("ordinary Close retains only the current local normal name before a new Check / "+shared,async t=>{
 const x=await readyPreparation(t,{shared}),held=x.hold("preview"),before=counts(x),events=canonicalEvents(x);
 const pending=dispatchInitial(x,{mayClose:true});await held.entered.promise;
 const original=held.wire.body.preview;assert.equal(held.wire.status,200);assert.equal(hasReview(x),false);
 await ordinaryInterruption(x,"reopened");held.release();await pending;await x.drain();
 assert.deepEqual(labels(x).map(node=>node.text),[original.name],"existing local authored name, no returned private preview");
 assert.equal(hasReview(x),false);assert.equal(continuationControl(x),undefined);
 assert.equal(counts(x).preview,before.preview+1);assert.equal(counts(x).apply,before.apply);
 assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(canonicalEvents(x),events);
 const read=await check(x,x.locale);assert.equal(read.status,200);assert.equal(read.body.preview.previewId,original.previewId);
 assert.equal(hasReview(x),true);assert.equal(labels(x).length,0,"no duplicate name beside an actual review");
});

for(const timing of["held-response","already-reopened"])
test("source retirement and restoration cannot revive a local name / "+timing,{timeout:10000},async t=>{
 const x=await readyPreparation(t,{shared:true}),held=x.hold("preview"),events=canonicalEvents(x);
 const pending=dispatchInitial(x,{mayClose:true});await held.entered.promise;
 const original=held.wire.body.preview;
 await ordinaryInterruption(x,"reopened");
 if(timing==="already-reopened"){held.release();await pending;await x.drain();assert.deepEqual(labels(x).map(node=>node.text),[original.name]);}
 const old=x.canvas();
 if(timing==="already-reopened"){
  // Controlled native render schedule around actual source403 -> fresh200.
  // Store/source ownership stays real; this is a scheduler negative control,
  // not a claim that the ordinary full-Shell fixture leaves its owner mounted.
  const draw=x.f.draw;x.f.draw=()=>x.f.renderer.markup;
  try{
  const source=x.h.store.captureSourceOwnership(),auth=x.h.store.captureAuthorizationScope();
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.worker.sharing.contextId);
  assert.equal((await x.worker.request("/api/events?after=0&limit=2000&content=0")).status,403);
  await assert.rejects(x.h.store.refreshEvents(),/403/);
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.worker.sharing.contextId);
  await x.h.store.refreshEvents();
  assert.equal(x.h.store.sourceOwnershipActive(source),false);assert.equal(x.h.store.authorizationScopeActive(auth),true);
   assert.equal(x.canvas()===old,true,"the controlled native render has not replaced this controller");
  }finally{x.f.draw=draw;}
  await x.drain();assert.equal(x.canvas()===old,true,"fresh source is rendered only after recovery");
 }else{await sourceRetirement(x);assert.notEqual(x.canvas(),old);}
 held.release();await pending;await x.drain();await openArrangement(x,{select:false,name:null});
 assert.equal(x.operation(),original.operationId);assert.equal(labels(x).length,0);
 assert.equal(x.privateVisible(),false);assert.equal(hasReview(x),false);assert.equal(continuationControl(x),undefined);
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
 const read=await check(x,x.locale);assert.equal(read.status,200);assert.equal(read.body.preview.previewId,original.previewId);
 assert.equal(labels(x).length,0,"a newly authorized server read is not relabeled as the retired local draft");
 assert.equal(counts(x).preview,1);assert.equal(counts(x).apply,0);
});

for(const shared of[false,true])
test("an inverse pending request never borrows the earlier normal name / "+shared,async t=>{
 const x=await readyPreparation(t,{kind:"undo",shared}),held=x.hold("undo-preview"),before=counts(x),events=canonicalEvents(x);
 const pending=dispatchInitial(x,{mayClose:true});await held.entered.promise;
 assert.equal(held.wire.body.preview.undoOperationId,x.appliedOriginal.operationId);
 await ordinaryInterruption(x,"reopened");held.release();await pending;await x.drain();
 assert.equal(labels(x).length,0);assert.equal(hasReview(x),false);assert.equal(continuationControl(x),undefined);
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
 assert.equal(counts(x).preview,before.preview);assert.equal(counts(x).apply,before.apply);
 const read=await check(x,x.locale);assert.equal(read.status,200);assert.equal(read.body.preview.undoOperationId,x.appliedOriginal.operationId);
 assert.equal(labels(x).length,0);
});
