import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,submitContinuation,ordinaryInterruption,canonicalEvents,previewRows,counts,
 noContinuation,check,editRefusalSource,sceneDeferred,expectSourceRefusal,continuationControl} from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const kind of["normal","undo"])for(const fault of["lost","extra-field","provider-type","wrong-code","wrong-status","nonzero-cost"])
test("interrupted exact preparation still rejects lost or malformed refusal provenance / "+kind+"/"+fault,async t=>{
 const x=await refusedPreparation(t,{kind,timing:"held-response",boundary:"reopened",allowLostResponse:fault==="lost",fault:async response=>{
  if(fault==="lost")throw Error("controlled_refusal_transport_loss");
  const body=await response.clone().json();
  if(fault==="extra-field")body.operationId="unexpected";
  if(fault==="provider-type")body.providerCalls="0";
  if(fault==="wrong-code")body.error="canvas_arrangement_operation_unavailable";
  if(fault==="nonzero-cost")body.maximumMicrousd=1;
  return Response.json(body,{status:fault==="wrong-status"?400:409});
 }});
 const events=canonicalEvents(x),before=counts(x);await qualifyContinuation(x,{available:false});
 noContinuation(x);assert.equal(counts(x).preview,before.preview);assert.equal(counts(x)["undo-preview"],before["undo-preview"]);
 assert.equal(counts(x).apply,before.apply);assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(previewRows(x),x.initialRows);
 assert.deepEqual(canonicalEvents(x),events);
});

for(const kind of["normal","undo"])for(const boundary of["closed","reopened","posture"])for(const lost of[false,true])
test("each interrupted corrective attempt needs its own exact refusal / "+[kind,boundary,lost].join("/"),async t=>{
 const x=await refusedPreparation(t,{kind});await qualifyContinuation(x);
 const transport=x.h.transport,completed=sceneDeferred(),action=kind==="undo"?"undo-preview":"preview";let changed=false,error=null;
 x.h.transport=async request=>{
  if(request.url==="/api/canvas/arrangements"&&request.body.action===action&&!changed){
   changed=true;
   try{
    await editRefusalSource(x,"Second actual source change before the corrective request");
    const response=await transport(request);assert.equal(response.status,409);
    await ordinaryInterruption(x,boundary);
    if(lost)throw Error("controlled_second_refusal_lost");
    return response;
   }catch(caught){if(!lost||caught.message!=="controlled_second_refusal_lost")error=caught;throw caught;}
   finally{completed.resolve();}
  }return transport(request);
 };
 try{const pending=submitContinuation(x);await completed.promise;await pending;await x.drain();if(error)throw error;}finally{x.h.transport=transport;}
 expectSourceRefusal(x.responses.at(-1));const events=canonicalEvents(x),before=counts(x);
 await qualifyContinuation(x,{available:!lost});
 assert.equal(x.operation(),x.originalRequest.operationId);assert.deepEqual(previewRows(x),x.initialRows);assert.deepEqual(x.ledger(),x.initialReceipts);
 if(lost){noContinuation(x);const read=await check(x,x.locale);assert.equal(read.status,409);noContinuation(x);}
 else{
  assert.ok(continuationControl(x));const reviewed=await submitContinuation(x);assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
  assert.notEqual(reviewed.command.expectedSourceRevision,x.originalRequest.expectedSourceRevision);
 }
 assert.equal(counts(x).apply,before.apply);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
});
