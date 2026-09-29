import assert from "node:assert/strict";
import test from "node:test";
import {refusedInitial,qualifyRefusal,submitRefusalForm,directPreview,directApply,explicitApply,check,
 pendingForm,noCorrectiveAction,canonicalEvents,previewRows,eraseRefusalWinner} from "./helpers/arrangement-refused-preview-fixture.mjs";
import {pauseClaim,pauseOperationLookup} from "./helpers/authoring-disclosure-boundary.mjs";

for(const shared of[false,true])for(const timing of["before","during"])for(const winner of["saved","live","applied"])
test("same-op corrective request respects actual "+winner+" winner "+timing+" / "+shared,{timeout:15000},async t=>{
 const x=await refusedInitial(t,{shared});await qualifyRefusal(x);
 const events=canonicalEvents(x);let lookup,claim,heldApply,correcting;
 try{
  if(timing==="during"){
   lookup=pauseOperationLookup(x.worker);correcting=submitRefusalForm(x);await lookup.entered;
  }
  const earlier=await directPreview(x);assert.notEqual(earlier.preview.name,x.originalRequest.name);
  if(winner==="live"){
   claim=pauseClaim(x.worker);heldApply=directApply(x,earlier.preview);await Promise.race([claim.entered,heldApply.then(result=>{throw Error("actual Apply never claimed: "+JSON.stringify(result));})]);
  }else if(winner==="applied"){
   const applied=await directApply(x,earlier.preview);assert.equal(applied.status,200);assert.equal(applied.body.status,"applied");
  }
  if(lookup)lookup.release();else correcting=submitRefusalForm(x);
  const corrected=await correcting;correcting=null;
  assert.equal(corrected.status,409);assert.equal(corrected.body.error,"canvas_arrangement_operation_mismatch");
  noCorrectiveAction(x);assert.equal(x.operation(),x.originalRequest.operationId);
  assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,2);
  assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
  const checked=await check(x,"en");
  assert.equal(checked.body.status,winner==="saved"?"review":winner==="live"?"applying":"applied");
  const original=checked.body.preview??checked.body;assert.equal(original.previewId,earlier.preview.previewId);
  assert.equal(Boolean(pendingForm(x)),winner==="applied","known applied keeps its ordinary terminal form, without creating another intent");
  if(winner==="saved"){
   assert.equal(original.name,earlier.preview.name);assert.ok(x.f.tree().root.text.includes(earlier.preview.name));
   assert.equal(x.ledger().length,0);assert.deepEqual(canonicalEvents(x),events);
   await explicitApply(x,original);
  }else if(winner==="live"){
   assert.equal(x.ledger().length,0);assert.deepEqual(canonicalEvents(x),events);
   claim.release();const outcome=await heldApply;heldApply=null;
   assert.equal(outcome.status,200);assert.equal(outcome.body.status,"applied");
   const final=await check(x,"en");assert.equal(final.body.status,"applied");assert.equal(final.body.previewId,earlier.preview.previewId);
  }
  assert.equal(x.ledger().length,1);assert.equal(previewRows(x).length,1);
  assert.equal(canonicalEvents(x).length-events.length,5);
 }finally{
  lookup?.release();claim?.release();
  if(correcting)await correcting;if(heldApply)await heldApply;lookup?.restore();claim?.restore();
 }
});

for(const shared of[false,true])for(const timing of["before","during"])
test("erased same-op winner stays unknown and cannot create a second private review "+timing+" / "+shared,{timeout:15000},async t=>{
 const x=await refusedInitial(t,{shared});await qualifyRefusal(x);
 const events=canonicalEvents(x);let lookup,claim,heldApply,correcting;
 try{
  if(timing==="during"){
   lookup=pauseOperationLookup(x.worker);correcting=submitRefusalForm(x);await lookup.entered;
  }
  const earlier=await directPreview(x);
  assert.match(earlier.preview.previewId,/^canvas-arrangement-preview-[a-f0-9]{64}$/u,"prospective supplied backend identity fence");
  claim=pauseClaim(x.worker);heldApply=directApply(x,earlier.preview);await Promise.race([claim.entered,heldApply.then(result=>{throw Error("actual Apply never claimed: "+JSON.stringify(result));})]);
  const erased=await eraseRefusalWinner(x,earlier.preview);
  if(lookup)lookup.release();else correcting=submitRefusalForm(x);
  const corrected=await correcting;correcting=null;assert.ok(corrected.status>=400);
  assert.equal(corrected.body.status,undefined);noCorrectiveAction(x);
  const checkResult=await check(x,"en");assert.equal(checkResult.status,409);
  assert.deepEqual(checkResult.body,{error:"canvas_arrangement_operation_unavailable",providerCalls:0,maximumMicrousd:0});
  noCorrectiveAction(x);assert.equal(x.operation(),x.originalRequest.operationId);
  claim.release();const old=await heldApply;heldApply=null;assert.ok(old.status>=400);
  const retry=await directApply(x,earlier.preview);assert.ok(retry.status>=400);
  assert.deepEqual(canonicalEvents(x),events);assert.equal(x.ledger().length,0);
  assert.deepEqual(previewRows(x),[erased],"the irreversible existing PK remains the only private identity");
  assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 }finally{
  lookup?.release();claim?.release();
  if(correcting)await correcting;if(heldApply)await heldApply;lookup?.restore();claim?.restore();
 }
});
