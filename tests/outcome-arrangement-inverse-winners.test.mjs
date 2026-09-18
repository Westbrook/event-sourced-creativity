import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,submitContinuation,applyContinuation,directOriginal,directApply,
 check,pendingForm,noContinuation,canonicalEvents,previewRows,eraseRefusalWinner,counts} from "./helpers/arrangement-refusal-interruption-fixture.mjs";
import {pauseClaim,pauseOperationLookup} from "./helpers/authoring-disclosure-boundary.mjs";

for(const shared of[false,true])for(const timing of["before","during"])for(const winner of["saved","live","applied"])
test("inverse corrective Review respects actual "+winner+" original "+timing+" / "+shared,{timeout:15000},async t=>{
 const x=await refusedPreparation(t,{kind:"undo",shared});await qualifyContinuation(x);
 const events=canonicalEvents(x),before=counts(x);let lookup,claim,heldApply,correcting;
 try{
  if(timing==="during"){lookup=pauseOperationLookup(x.worker);correcting=submitContinuation(x);await lookup.entered;}
  const earlier=await directOriginal(x);assert.notEqual(earlier.preview.name,x.originalRequest.name);
  assert.equal(earlier.preview.undoOperationId,x.appliedOriginal.operationId);
  if(winner==="live"){
   claim=pauseClaim(x.worker);heldApply=directApply(x,earlier.preview);
   await Promise.race([claim.entered,heldApply.then(result=>{throw Error("actual inverse Apply never claimed: "+JSON.stringify(result));})]);
  }else if(winner==="applied"){const applied=await directApply(x,earlier.preview);assert.equal(applied.status,200);assert.equal(applied.body.status,"applied");}
  if(lookup)lookup.release();else correcting=submitContinuation(x);
  const corrected=await correcting;correcting=null;assert.equal(corrected.status,409);assert.equal(corrected.body.error,"canvas_arrangement_operation_mismatch");
  noContinuation(x);assert.equal(x.operation(),x.originalRequest.operationId);
  assert.equal(counts(x).preview,before.preview);assert.equal(counts(x)["undo-preview"],before["undo-preview"]+1);
  assert.equal(counts(x).apply,before.apply);
  const checked=await check(x,x.locale);assert.equal(checked.body.status,winner==="saved"?"review":winner==="live"?"applying":"applied");
  const original=checked.body.preview??checked.body;assert.equal(original.previewId,earlier.preview.previewId);
  assert.equal(Boolean(pendingForm(x)),winner==="applied","genuine terminal keeps the ordinary new-intent form without sending it");
  if(winner==="saved"){
   assert.equal(original.undoOperationId,x.appliedOriginal.operationId);assert.equal(original.name,earlier.preview.name);
   assert.ok(x.f.tree().root.text.includes(earlier.preview.name));assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(canonicalEvents(x),events);
   await applyContinuation(x,original);
  }else if(winner==="live"){
   assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(canonicalEvents(x),events);
   claim.release();const outcome=await heldApply;heldApply=null;assert.equal(outcome.status,200);assert.equal(outcome.body.status,"applied");
   const final=await check(x,x.locale);assert.equal(final.body.status,"applied");assert.equal(final.body.previewId,earlier.preview.previewId);
  }
  assert.equal(x.ledger().length,2);assert.equal(previewRows(x).length,2);assert.equal(canonicalEvents(x).length-events.length,5);
  assert.deepEqual(x.ledger().find(row=>row.preview_id===x.appliedOriginal.previewId),x.originalReceipt);
 }finally{lookup?.release();claim?.release();if(correcting)await correcting;if(heldApply)await heldApply;lookup?.restore();claim?.restore();}
});

for(const shared of[false,true])for(const timing of["before","during"])
test("erased original inverse stays unknown and cannot be replaced "+timing+" / "+shared,{timeout:15000},async t=>{
 const x=await refusedPreparation(t,{kind:"undo",shared});await qualifyContinuation(x);
 const events=canonicalEvents(x),before=counts(x);let lookup,claim,heldApply,correcting;
 try{
  if(timing==="during"){lookup=pauseOperationLookup(x.worker);correcting=submitContinuation(x);await lookup.entered;}
  const earlier=await directOriginal(x);assert.match(earlier.preview.previewId,/^canvas-arrangement-preview-[a-f0-9]{64}$/u);
  claim=pauseClaim(x.worker);heldApply=directApply(x,earlier.preview);
  await Promise.race([claim.entered,heldApply.then(result=>{throw Error("actual inverse Apply never claimed: "+JSON.stringify(result));})]);
  const erased=await eraseRefusalWinner(x,earlier.preview);
  if(lookup)lookup.release();else correcting=submitContinuation(x);
  const corrected=await correcting;correcting=null;assert.ok(corrected.status>=400);assert.equal(corrected.body.status,undefined);noContinuation(x);
  const read=await check(x,x.locale);assert.equal(read.status,409);
  assert.deepEqual(read.body,{error:"canvas_arrangement_operation_unavailable",providerCalls:0,maximumMicrousd:0});
  noContinuation(x);assert.equal(x.operation(),x.originalRequest.operationId);
  claim.release();const old=await heldApply;heldApply=null;assert.ok(old.status>=400);
  assert.ok((await directApply(x,earlier.preview)).status>=400);
  assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
  const rows=previewRows(x);assert.equal(rows.length,2);assert.deepEqual(rows.find(row=>row.content_id===earlier.preview.previewId),erased);
  assert.deepEqual(rows.filter(row=>row.content_id!==earlier.preview.previewId),x.initialRows);
  assert.equal(counts(x).preview,before.preview);assert.equal(counts(x).apply,before.apply);
 }finally{lookup?.release();claim?.release();if(correcting)await correcting;if(heldApply)await heldApply;lookup?.restore();claim?.restore();}
});
