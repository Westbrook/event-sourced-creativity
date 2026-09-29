import assert from "node:assert/strict";
import test from "node:test";
import {readyPreparation,refusedPreparation,qualifyContinuation,submitContinuation,dispatchInitial,
 ordinaryInterruption,canonicalEvents,previewRows,counts,check,sceneDeferred,continuationControl,arrangementDialog}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";

const hasReview=x=>x.f.tree().visible("button").some(node=>node.attributes["data-choice-value"]===x.operation());
for(const kind of["normal","undo"])for(const stage of["initial","corrective"])for(const edge of["headers","body","digest"])
test("a held private preparation response needs a new current Check after interruption / "+[kind,stage,edge].join("/"),async t=>{
 const x=stage==="initial"?await readyPreparation(t,{kind}):await refusedPreparation(t,{kind});
 if(stage==="corrective")await qualifyContinuation(x);
 const before=counts(x),events=canonicalEvents(x),transport=x.h.transport,entered=sceneDeferred(),release=sceneDeferred();
 const action=kind==="undo"?"undo-preview":"preview";let wire=null,held=false;
 t.after(()=>release.resolve());
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 if(edge==="digest")t.mock.method(crypto.subtle,"digest",async(...args)=>{
  const result=await digest(...args),text=new TextDecoder().decode(args[1]);
  if(!held&&wire&&text.includes(wire.preview.previewId)&&text.includes(wire.preview.approvalHash)){
   held=true;entered.resolve();await release.promise;
  }return result;
 });
 x.h.transport=async request=>{
  const response=await transport(request);
  if(request.url==="/api/canvas/arrangements"&&request.body.action===action&&!wire){
   assert.equal(response.status,200);wire=await response.clone().json();assert.equal(wire.status,"review");
   if(edge==="headers"){held=true;entered.resolve();await release.promise;}
   else if(edge==="body"){
    const json=response.json.bind(response);response.json=async()=>{const body=await json();held=true;entered.resolve();await release.promise;return body;};
   }
  }return response;
 };
 let pending;
 try{
  pending=stage==="initial"?dispatchInitial(x,{mayClose:true}):submitContinuation(x);
  await entered.promise;assert.equal(held,true);assert.ok(wire);assert.ok(arrangementDialog(x),"the actual original preparation opened before interruption");assert.equal(hasReview(x),false);
  const op=x.operation();await ordinaryInterruption(x,edge==="body"?"posture":"reopened");
  assert.ok(arrangementDialog(x));assert.equal(continuationControl(x),undefined);assert.equal(hasReview(x),false);
  release.resolve();await pending;pending=null;await x.drain();
  assert.equal(x.operation(),op);assert.equal(hasReview(x),false,"late private200 cannot publish into another opening");
  assert.equal(continuationControl(x),undefined);assert.equal(counts(x)[action],before[action]+1);
  assert.equal(counts(x).apply,before.apply);assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(canonicalEvents(x),events);
  const read=await check(x,x.locale);assert.equal(read.status,200);assert.equal(read.body.status,"review");
  assert.equal(read.body.preview.previewId,wire.preview.previewId);assert.equal(read.body.preview.approvalHash,wire.preview.approvalHash);
  assert.equal(read.body.preview.undoOperationId,wire.preview.undoOperationId);assert.equal(hasReview(x),true);
  assert.equal(counts(x)[action],before[action]+1);assert.equal(counts(x).apply,before.apply);
  assert.equal(previewRows(x).length,x.initialRows.length+1);assert.deepEqual(x.ledger(),x.initialReceipts);
 }finally{release.resolve();if(pending)await pending;x.h.transport=transport;}
});

for(const kind of["normal","undo"])test("a current held private response still shows the exact current Review / "+kind,async t=>{
 const x=await refusedPreparation(t,{kind});await qualifyContinuation(x);const before=counts(x),held=x.hold(kind==="undo"?"undo-preview":"preview");
 const pending=submitContinuation(x);await held.entered.promise;
 assert.equal(held.wire.status,200);assert.equal(hasReview(x),false);held.release();const row=await pending;await x.drain();
 assert.equal(row.body.preview.previewId,held.wire.body.preview.previewId);assert.equal(hasReview(x),true);
 assert.equal(counts(x).apply,before.apply);assert.deepEqual(x.ledger(),x.initialReceipts);
});
