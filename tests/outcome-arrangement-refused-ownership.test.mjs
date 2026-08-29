import assert from "node:assert/strict";
import test from "node:test";
import {refusedInitial,qualifyRefusal,submitRefusalForm,lateForm,noCorrectiveAction,previewRows,canonicalEvents,
 pendingForm,check,control,openArrangement,freshArrangementOwner,untilScene,confirmImpersonation,
 page,previewArrangement,explicitApply,editRefusalSource,expectSourceRefusal,outcomeDeskCopy} from "./helpers/arrangement-refused-preview-fixture.mjs";

for(const fault of["lost","extra-field","provider-type","wrong-code","wrong-status","nonzero-cost"])
test("only an exact initial actual source refusal can mint preparation provenance / "+fault,async t=>{
 const x=await refusedInitial(t,{fault:async response=>{
  assert.equal(response.status,409);const body=await response.clone().json();
  if(fault==="lost")throw Error("controlled_loss_of_actual_initial_source_refusal");
  if(fault==="extra-field")body.operationId="not-a-correlated-proof";
  if(fault==="provider-type")body.providerCalls="0";
  if(fault==="wrong-code")body.error="canvas_arrangement_operation_unavailable";
  if(fault==="nonzero-cost")body.maximumMicrousd=1;
  return Response.json(body,{status:fault==="wrong-status"?400:409});
 }});
 await qualifyRefusal(x,{available:false});await qualifyRefusal(x,{available:false,refresh:false});
 noCorrectiveAction(x);assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,1);
 assert.equal(x.ledger().length,0);assert.equal(previewRows(x).length,0);
});

async function sourceABA(x){
 const source=x.h.store.captureSourceOwnership();
 x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.worker.sharing.contextId);
 assert.equal((await x.worker.request("/api/events?after=0&limit=2000&content=0")).status,403);
 await assert.rejects(x.h.store.refreshEvents(),/403/);
 x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.worker.sharing.contextId);
 await x.h.store.refreshEvents();
 assert.equal(x.h.store.sourceOwnershipActive(source),false);
 assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),true);
}
for(const boundary of["route-aba","scope-aba","actor-aba","source-aba","fresh-owner","close-reopen"])
test("refusal history belongs only to its original source actor route and owner / "+boundary,async t=>{
 const x=await refusedInitial(t,{shared:boundary==="source-aba"});await qualifyRefusal(x);
 const old=pendingForm(x),before=x.arrangementPosts().length,route=x.h.store.route.get(),events=canonicalEvents(x);
 if(boundary==="route-aba"){x.h.store.setRoute(route+"&other-request=1");x.h.store.setRoute(route);}
 else if(boundary==="scope-aba"||boundary==="actor-aba"){
  const session=x.h.store.session.get();
  // Negative input to actual Store ownership/notifications, never a replacement
  // positive token or a claim of another authenticated actor's permission.
  x.h.setSession(boundary==="scope-aba"?{permissionEpoch:"negative-refusal-epoch"}:{user:{...session.user,userId:"negative-other-actor"}});
  x.h.store.notify();x.h.store.session.set(session);x.h.store.notify();
 }else if(boundary==="source-aba")await sourceABA(x);
 else if(boundary==="fresh-owner"){
  await freshArrangementOwner(x);await openArrangement(x,{select:false,name:null});
 }else{
  await x.f.act(control(x,x.copy.close));await x.drain();await openArrangement(x,{select:false,name:null});
 }
 await lateForm(old);await x.drain();assert.equal(x.arrangementPosts().length,before);
 assert.equal(pendingForm(x),undefined,"old action qualification cannot survive the boundary");
 if(!x.f.tree().visible("dialog").some(node=>String(node.attributes.class??"").includes("canvas-outcome-arrangement-dialog")))
  await openArrangement(x,{select:false,name:null});
 const read=await check(x,"en");assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_operation_unavailable");
 assert.equal(Boolean(pendingForm(x)),boundary==="close-reopen","only a normal same-owner Close retains historical provenance");
 assert.equal(x.operation(),x.originalRequest.operationId);assert.deepEqual(canonicalEvents(x),events);
 assert.equal(previewRows(x).length,0);assert.equal(x.ledger().length,0);
 if(boundary==="close-reopen"){const reviewed=await submitRefusalForm(x);assert.equal(reviewed.status,200);}
});

for(const shared of[false,true])test("lost Check retires only current qualification and a later owned Check renews historical refusal / "+shared,async t=>{
 const x=await refusedInitial(t,{shared});await qualifyRefusal(x);const old=pendingForm(x),transport=x.h.transport;let lost=false;
 x.h.transport=async request=>{const response=await transport(request);
  if(request.url==="/api/canvas/arrangements"&&request.body.action==="retrieve"&&!lost){lost=true;assert.equal(response.status,409);throw Error("controlled_loss_of_actual_missing_read");}
  return response;
 };
 await check(x,"en");x.h.transport=transport;assert.equal(lost,true);noCorrectiveAction(x);
 const count=x.arrangementPosts().length;await lateForm(old);await x.drain();assert.equal(x.arrangementPosts().length,count);
 await qualifyRefusal(x,{refresh:false});const reviewed=await submitRefusalForm(x);assert.equal(reviewed.status,200);
 assert.equal(x.ledger().length,0);
});

for(const shared of[false,true])test("a late initial refusal after ordinary Close retains only history for a new Check / "+shared,async t=>{
 const x=await refusedInitial(t,{shared,fault:async(response,_request,current)=>{
  await current.f.act(control(current,current.copy.close));await current.drain();
  await openArrangement(current,{select:false,name:null});await current.drain();return response;
 }});
 noCorrectiveAction(x);assert.equal(pendingForm(x),undefined,"the late response grants nothing in the new opening");
 await qualifyRefusal(x);assert.equal(previewRows(x).length,0);
 assert.equal(x.ledger().length,0);assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,1);
});

for(const boundary of["healthy","route-aba","opening","source-aba"])
test("corrective free Review owns the actual Store confirmation wait / "+boundary,async t=>{
 const x=await refusedInitial(t,{shared:boundary==="source-aba",impersonation:true});
 await qualifyRefusal(x);const before=x.arrangementPosts().length,route=x.h.store.route.get();
 await x.f.act(pendingForm(x),"submit");await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);
 assert.equal(x.arrangementPosts().length,before,"no dispatch before the current human confirmation");
 if(boundary==="route-aba"){x.h.store.setRoute(route+"&new-opening=1");x.h.store.setRoute(route);}
 else if(boundary==="opening"){
  await x.f.act(control(x,x.copy.close));await x.drain();
  await openArrangement(x,{select:false,name:null,confirmation:true});await x.drain();
 }else if(boundary==="source-aba")await sourceABA(x);
 await confirmImpersonation(x);await x.drain();
 assert.equal(x.arrangementPosts().length,before+(boundary==="healthy"?1:0));
 assert.equal(x.operation(),x.originalRequest.operationId);assert.equal(x.ledger().length,0);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 if(boundary==="healthy"){assert.equal(x.responses.at(-1).status,200);assert.equal(previewRows(x).length,1);}
 else{assert.equal(previewRows(x).length,0);assert.equal(pendingForm(x),undefined);}
});

for(const shared of[false,true])test("an actual Undo source refusal never qualifies normal free-preview correction / "+shared,async t=>{
 const x=await page(t,{shared}),preview=await previewArrangement(x);await explicitApply(x,preview);
 const transport=x.h.transport;let changed=false;
 x.h.transport=async request=>{
  if(request.url==="/api/canvas/arrangements"&&request.body.action==="undo-preview"&&!changed){
   changed=true;await editRefusalSource(x,"Actual source edit before Undo preparation");
  }return transport(request);
 };
 await x.f.act(control(x,x.copy.undo));await untilScene(()=>x.responses.at(-1)?.command.action==="undo-preview");await x.drain();
 x.h.transport=transport;const result=x.responses.at(-1);expectSourceRefusal(result);
 assert.notEqual(x.operation(),preview.operationId);await x.h.store.refreshEvents();await x.drain();
 const read=await check(x,"en");assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_operation_unavailable");
 assert.equal(pendingForm(x),undefined);assert.equal(x.ledger().length,1);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,1);
 assert.ok(control(x,outcomeDeskCopy("en").retrieve));
});


for(const boundary of["healthy","route-aba","opening","source-aba"])
test("held corrective response has only its exact original source and opening / "+boundary,async t=>{
 const x=await refusedInitial(t,{shared:boundary==="source-aba"});await qualifyRefusal(x);
 const held=x.hold("preview"),route=x.h.store.route.get(),before=x.arrangementPosts().length;
 await x.f.act(pendingForm(x),"submit");await held.entered.promise;
 assert.equal(held.wire.status,200);assert.equal(held.wire.body.status,"review");
 assert.equal(x.ledger().length,0);assert.equal(x.arrangementPosts().length,before+1);
 if(boundary==="route-aba"){x.h.store.setRoute(route+"&held-owner=1");x.h.store.setRoute(route);}
 else if(boundary==="opening"){
  await x.f.act(control(x,x.copy.close));await x.drain();await openArrangement(x,{select:false,name:null});
 }else if(boundary==="source-aba")await sourceABA(x);
 held.release();await x.drain();
 assert.equal(x.arrangementPosts().length,before+1);assert.equal(x.operation(),x.originalRequest.operationId);
 assert.equal(x.ledger().length,0);assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 assert.equal(Boolean(x.privateVisible()),boundary==="healthy","old returned private bytes cannot publish into a new owner");
 if(boundary!=="healthy"){
  if(!x.f.tree().visible("dialog").some(node=>String(node.attributes.class??"").includes("canvas-outcome-arrangement-dialog")))
   await openArrangement(x,{select:false,name:null});
  const actual=await check(x,"en");assert.equal(actual.status,200);assert.equal(actual.body.status,"review");
  assert.equal(actual.body.preview.previewId,held.wire.body.preview.previewId);
  assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,2,"only current explicit read recovers the real original");
 }
});
