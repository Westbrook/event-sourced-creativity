import assert from "node:assert/strict";
import test from "node:test";
import {cancelledPreparation,qualifyContinuation,noCurrentLocalGrant,snapshot,unchanged,currentCheck,
 counts,canonicalEvents,previewRows,continuationControl,submitContinuation,confirmImpersonation,
 settledPreparation,sourceRetirement,freshArrangementOwner,openArrangement,arrangementDialog,applyControl}
 from "./helpers/arrangement-preparation-confirmation-fixture.mjs";

for(const kind of["normal","undo"])for(const stage of["initial","corrective"])
test("the identical local 409 without its positive notice never grants continuation / "+kind+"/"+stage,async t=>{
 // Withhold only the delivery of the real local Store signal from this controller.
 // The actual Cancel response and every real current-scope check remain unchanged.
 const x=await cancelledPreparation(t,{kind,stage,forwardNotice:false}),before=snapshot(x);
 assert.equal(x.preparationCalls[0].notices,1);assert.equal(x.preparationCalls[0].dispatches,0);
 noCurrentLocalGrant(x);await qualifyContinuation(x,{available:false});noCurrentLocalGrant(x);
 unchanged(x,before,{reads:1});assert.equal(x.operation(),x.originalRequest.operationId);
});

for(const kind of["normal","undo"])for(const boundary of["route-aba","actor","source","fresh-owner"])
test("positive local history still retires under exact ownership loss / "+kind+"/"+boundary,async t=>{
 const x=await cancelledPreparation(t,{kind,shared:boundary==="source"});await qualifyContinuation(x);
 const old=continuationControl(x),notice=x.preparationCalls[0].controls.onNotDispatchedAtConfirmation,before=snapshot(x),route=x.h.store.route.get();
 if(boundary==="source")await sourceRetirement(x);
 else if(boundary==="fresh-owner"){
  // Settings loads the actual session, removing the fixture-only modal posture.
  // Refill the real source through its current read, not a synthetic snapshot.
  await freshArrangementOwner(x);await x.h.store.refreshEvents();await x.drain();
 }
 else if(boundary==="actor"){
  // Synthetic invalid actor notification is a negative control, never a grant.
  const session=x.h.store.session.get();x.h.setSession({user:{...session.user,userId:"local-notice-invalid-actor"}});
  x.h.store.notify();x.h.store.session.set(session);x.h.store.notify();
 }else{x.h.store.setRoute(route+"&unrelated-request=1");x.h.store.setRoute(route);}
 await x.drain();
 // These retained callbacks are explicit synthetic negative ownership controls.
 notice();await old.handlers[old.tag==="form"?"submit":"click"].call(old.owner,{target:old.port,currentTarget:old.port,preventDefault(){},stopPropagation(){}});
 await x.drain();assert.deepEqual(counts(x),before.counts);assert.equal(x.h.store.ui.impersonationConfirmOpen,false);
 if(!arrangementDialog(x))await openArrangement(x,{select:false,name:null});
 noCurrentLocalGrant(x);const read=await currentCheck(x);
 assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_operation_unavailable");noCurrentLocalGrant(x);
 assert.equal(x.operation(),x.originalRequest.operationId);unchanged(x,before,{reads:1});
});

for(const kind of["normal","undo"])for(const fault of["lost","cancel-error-text"])
test("an actually dispatched correction cannot borrow prior local notice / "+kind+"/"+fault,async t=>{
 const x=await cancelledPreparation(t,{kind});await qualifyContinuation(x);const before=snapshot(x),transport=x.h.transport;
 let affected=false,saved=null;
 x.h.transport=async request=>{
  const response=await transport(request);
  if(request.url==="/api/canvas/arrangements"&&["preview","undo-preview"].includes(request.body.action)&&!affected){
   affected=true;assert.equal(response.status,200);saved=(await response.clone().json()).preview;
   // Delivery-only negative fault after the actual Worker saved the original.
   if(fault==="lost")throw Error("controlled_actual_preparation_response_loss");
   return Response.json({error:"Action canceled. No changes were made to the fictional account."},{status:409});
  }return response;
 };
 try{
  const pending=submitContinuation(x);await confirmImpersonation(x);await pending;
  const call=x.preparationCalls.at(-1);await settledPreparation(x,call);
  assert.equal(affected,true);assert.equal(call.dispatches,1);assert.equal(call.notices,0);
  assert.equal(saved.operationId,x.originalRequest.operationId);
  noCurrentLocalGrant(x);assert.equal(Boolean(x.f.tree().visible("button").find(node=>node.attributes["data-choice-value"]===x.operation())),false);
  // Late delivery of the earlier attempt's notice is not a new attempt result.
  x.preparationCalls[0].controls.onNotDispatchedAtConfirmation();await x.drain();noCurrentLocalGrant(x);
 }finally{x.h.transport=transport;}
 assert.equal(previewRows(x).length,before.rows.length+1);assert.deepEqual(canonicalEvents(x),before.events);assert.deepEqual(x.ledger(),before.receipts);
 const read=await currentCheck(x);assert.equal(read.status,200);assert.equal(read.body.status,"review");
 assert.equal(read.body.preview.previewId,saved.previewId);assert.equal(read.body.preview.approvalHash,saved.approvalHash);
 assert.equal(read.body.preview.operationId,x.originalRequest.operationId);assert.ok(applyControl(x));
 assert.equal(arrangementDialog(x).text.includes(x.copy.preparationNotDispatched),false);
 assert.equal(counts(x).apply,before.counts.apply);assert.equal(counts(x).dismiss,before.counts.dismiss);
});
