import assert from "node:assert/strict";
import test from "node:test";
import {cancelledPreparation,qualifyContinuation,submitContinuation,settledPreparation,confirmImpersonation,currentCheck,
 directOriginal,directApply,applyContinuation,noCurrentLocalGrant,canonicalEvents,previewRows,eraseRefusalWinner,counts,pendingForm}
 from "./helpers/arrangement-preparation-confirmation-fixture.mjs";
import {pauseClaim} from "./helpers/authoring-disclosure-boundary.mjs";

for(const kind of["normal","undo"])for(const shared of[false,true])for(const winner of["saved","live","applied","erased"])
test("local non-dispatch does not outrank the server's exact "+winner+" original / "+kind+"/"+shared,{timeout:15000},async t=>{
 const x=await cancelledPreparation(t,{kind,shared});await qualifyContinuation(x);
 const events=canonicalEvents(x),before=counts(x),rows=previewRows(x),receipts=x.ledger();
 let claim,heldApply,correcting;
 try{
  const earlier=await directOriginal(x);assert.notEqual(earlier.preview.name,x.originalRequest.name);
  if(kind==="undo")assert.equal(earlier.preview.undoOperationId,x.appliedOriginal.operationId);
  if(winner==="live"||winner==="erased"){
   claim=pauseClaim(x.worker);heldApply=directApply(x,earlier.preview);
   await Promise.race([claim.entered,heldApply.then(result=>{throw Error("actual original Apply never claimed: "+JSON.stringify(result));})]);
  }else if(winner==="applied"){
   const applied=await directApply(x,earlier.preview);assert.equal(applied.status,200);assert.equal(applied.body.status,"applied");
  }
  const erased=winner==="erased"?await eraseRefusalWinner(x,earlier.preview):null;
  correcting=submitContinuation(x);await confirmImpersonation(x);const corrected=await correcting;correcting=null;
  await settledPreparation(x,x.preparationCalls.at(-1));
  assert.ok(corrected.status>=400);assert.equal(x.preparationCalls.at(-1).dispatches,1);assert.equal(x.preparationCalls.at(-1).notices,0);
  assert.equal(x.operation(),x.originalRequest.operationId);noCurrentLocalGrant(x);
  assert.equal(counts(x).apply,before.apply);assert.equal(counts(x).dismiss,before.dismiss);
  const checked=await currentCheck(x);
  if(winner==="erased"){
   assert.equal(checked.status,409);assert.equal(checked.body.error,"canvas_arrangement_operation_unavailable");noCurrentLocalGrant(x);
   claim.release();const fenced=await heldApply;heldApply=null;assert.ok(fenced.status>=400);
   assert.ok((await directApply(x,earlier.preview)).status>=400);
   assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),receipts);
   assert.deepEqual(previewRows(x).find(row=>row.content_id===earlier.preview.previewId),erased);
  }else{
   assert.equal(corrected.body.error,"canvas_arrangement_operation_mismatch");
   assert.equal(checked.body.status,winner==="saved"?"review":winner==="live"?"applying":"applied");
   assert.equal((checked.body.preview??checked.body).previewId,earlier.preview.previewId);
   assert.equal(Boolean(pendingForm(x)),winner==="applied","only a genuine terminal restores ordinary new-intent UI, without sending it");
   if(winner==="saved"){
    assert.equal(checked.body.preview.name,earlier.preview.name);assert.equal(checked.body.preview.approvalHash,earlier.preview.approvalHash);
    assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),receipts);
    const applying=applyContinuation(x,checked.body.preview);await confirmImpersonation(x);await applying;
   }else if(winner==="live"){
    assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),receipts);
    claim.release();const committed=await heldApply;heldApply=null;assert.equal(committed.status,200);assert.equal(committed.body.status,"applied");
    const final=await currentCheck(x);assert.equal(final.body.status,"applied");assert.equal(final.body.previewId,earlier.preview.previewId);
   }
   assert.equal(x.ledger().length,receipts.length+1);assert.equal(canonicalEvents(x).length,events.length+5);
  }
  assert.equal(previewRows(x).length,rows.length+1);assert.equal(x.operation(),x.originalRequest.operationId);
 }finally{claim?.release();if(correcting)await correcting;if(heldApply)await heldApply;claim?.restore();}
});
