import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,noContinuation,canonicalEvents,counts,openArrangement,freshArrangementOwner,
 sourceRetirement,continuationControl,lateContinuation,check,closePreparation}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const kind of["normal","undo"])for(const boundary of["route-aba","unknown-posture","recipe","board","scope","actor","source","fresh-owner"])
test("normal and inverse refusal history is retired by actual ownership boundary / "+kind+"/"+boundary,async t=>{
 const x=await refusedPreparation(t,{kind,shared:boundary==="source"});await qualifyContinuation(x);
 const old=continuationControl(x),route=x.h.store.route.get(),before=counts(x),events=canonicalEvents(x);
 if(boundary==="source")await sourceRetirement(x);
 else if(boundary==="fresh-owner")await freshArrangementOwner(x);
 else if(boundary==="actor"||boundary==="scope"){
  const session=x.h.store.session.get();
  // Synthetic invalid input to actual Store notifications, never another
  // actor's positive token or real authorization.
  x.h.setSession(boundary==="actor"?{user:{...session.user,userId:"negative-other-actor"}}:{permissionEpoch:"negative-epoch"});
  x.h.store.notify();x.h.store.session.set(session);x.h.store.notify();
 }else{
  const next=new URL(route,"http://localhost");
  if(boundary==="route-aba")next.searchParams.set("other-request","1");
  else if(boundary==="unknown-posture")next.searchParams.set("posture","not-a-posture");
  else if(boundary==="recipe")next.searchParams.set("recipe","campaign");
  else next.pathname="/canvas/another-board/another-board";
  x.h.store.setRoute(next.pathname+next.search+next.hash);x.h.store.setRoute(route);
 }
 await x.drain();await lateContinuation(old);await x.drain();assert.deepEqual(counts(x),before);
 if(!x.f.tree().visible("dialog").length)await openArrangement(x,{select:false,name:null});
 noContinuation(x);const read=await check(x,x.locale);assert.equal(read.status,409);
 noContinuation(x);assert.equal(x.operation(),x.originalRequest.operationId);
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
});

for(const shared of[false,true])test("inverse correction will not overwrite current intervening geometry / "+shared,async t=>{
 const x=await refusedPreparation(t,{kind:"undo",shared});await qualifyContinuation(x);
 const before=counts(x),item=x.h.store.canvasProjection.get().items.find(row=>row.id===x.selected[0]);
 const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"append",event:{
  type:"CanvasRegisterSet",payload:{project_id:x.worker.projectId,canvas_id:x.board,item_id:item.id,
   operation:{object:{kind:"canvas_item",item_id:item.id},prop:"x",value:item.x+777,hlc:{pt:Date.now()+60000,c:1,site:x.worker.owner+":current-author"}}}}})});
 assert.equal(response.status,200,await response.clone().text());await x.h.store.refreshEvents();await x.drain();
 const read=await check(x,x.locale);assert.equal(read.status,409);const node=continuationControl(x);assert.ok(node);
 const events=canonicalEvents(x);await x.f.act(node);await x.drain();
 assert.equal(counts(x)["undo-preview"],before["undo-preview"],"existing inverse model rejects changed geometry before dispatch");
 assert.equal(counts(x).preview,before.preview);assert.equal(counts(x).apply,before.apply);
 assert.equal(x.f.tree().visible("button").some(node=>node.attributes["data-choice-value"]===x.operation()),false);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
});

for(const kind of["normal","undo"])test("selection changes never retarget the witnessed corrective request / "+kind,async t=>{
 const x=await refusedPreparation(t,{kind});await qualifyContinuation(x);const old=continuationControl(x),before=counts(x);
 await closePreparation(x);
 // An actual same-board card click changes selection; historical original IDs
 // remain the only candidate, and no current control may silently substitute.
 await x.f.act(x.f.find("button",node=>node.text.includes("Current arrangement card 0")),"click",{shiftKey:false});await x.drain();
 await lateContinuation(old);await x.drain();assert.deepEqual(counts(x),before);
 await openArrangement(x,{select:false,name:null});const read=await check(x,x.locale);assert.equal(read.status,409);
 const control=continuationControl(x);assert.ok(control);
 const submit=control.tag==="form"?x.f.find("button",node=>node.attributes.type==="submit"&&node.text===x.copy.preview):control;
 assert.ok(submit);assert.equal(Object.hasOwn(submit.attributes,"disabled"),true);
 assert.equal(counts(x).preview,before.preview);assert.equal(counts(x)["undo-preview"],before["undo-preview"]);
 assert.deepEqual(x.ledger(),x.initialReceipts);
});
