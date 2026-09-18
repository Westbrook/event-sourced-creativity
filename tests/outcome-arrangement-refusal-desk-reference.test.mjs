import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,submitContinuation,continuationControl,canonicalEvents,currentFrames,
 counts,closePreparation,switchPosture,openArrangement,lateContinuation,outcomeDeskCopy,check,noContinuation,sceneDeferred}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])for(const kind of["normal","undo"])
test("known refusal survives a validated same-board native Desk reference / "+[locale,shared,kind].join("/"),async t=>{
 const x=await refusedPreparation(t,{kind,shared,locale,documentCards:true});await qualifyContinuation(x);
 const old=continuationControl(x),owner=x.canvas(),original=x.originalRequest,events=canonicalEvents(x),frames=currentFrames(x),before=counts(x);
 await closePreparation(x);await switchPosture(x,{back:false});
 const key="document:"+x.worker.documentId;
 const link=x.f.find("a",node=>{const href=node.attributes.href;return href&&new URL(href,"http://localhost").searchParams.get("outcome")===key;});
 await x.f.act(link,"click",{button:0});await x.drain();
 assert.equal(new URL(x.h.store.route.get(),"http://localhost").searchParams.get("outcome"),key);
 await x.f.act(x.f.find("a",node=>node.text===outcomeDeskCopy(locale).back),"click",{button:0});await x.drain();
 assert.equal(x.canvas(),owner);assert.equal(owner.isConnected,true);assert.deepEqual(counts(x),before);
 assert.equal(x.h.store.sourceOwnershipActive(x.refusalSourceOwner),true);assert.equal(x.h.store.authorizationScopeActive(x.refusalAuthority),true);
 assert.equal(x.h.store.canvasPlanningDocumentId(x.selected),x.worker.documentId);
 await x.h.store.refreshEvents();await x.drain();assert.equal(x.h.store.sourceOwnershipActive(x.refusalSourceOwner),true);
 await openArrangement(x,{select:false,name:null});assert.equal(continuationControl(x),undefined);
 await lateContinuation(old);await x.drain();assert.deepEqual(counts(x),before,"old captured control cannot cross the presentation boundary");
 await qualifyContinuation(x,{refresh:false});
 const reviewed=await submitContinuation(x);assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
 assert.equal(reviewed.body.preview.operationId,original.operationId);assert.equal(reviewed.body.preview.undoOperationId,original.undoOperationId);
 assert.deepEqual(reviewed.body.preview.selectedItemIds,original.selectedItemIds);
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(currentFrames(x),frames);assert.deepEqual(x.ledger(),x.initialReceipts);
});

for(const boundary of["unknown-reference","malformed-key","duplicate-key","wrong-posture","arbitrary-param","hash","recipe","operation","board"])
test("historical route evidence does not admit arbitrary or unavailable Desk context / "+boundary,async t=>{
 const x=await refusedPreparation(t,{documentCards:true});await qualifyContinuation(x);
 const route=x.h.store.route.get(),count=x.arrangementPosts().length,old=continuationControl(x),events=canonicalEvents(x);
 const changed=new URL(route,"http://localhost");
 if(boundary==="unknown-reference")changed.searchParams.set("outcome","document:missing-authorized-reference");
 else if(boundary==="malformed-key")changed.searchParams.set("outcome","untyped-reference");
 else if(boundary==="duplicate-key"){changed.searchParams.append("outcome","document:"+x.worker.documentId);changed.searchParams.append("outcome","document:"+x.worker.documentId);}
 else if(boundary==="wrong-posture")changed.searchParams.set("posture","unsupported");
 else if(boundary==="arbitrary-param")changed.searchParams.set("other-request","1");
 else if(boundary==="hash")changed.hash="#other-current-target";
 else if(boundary==="recipe")changed.searchParams.set("recipe","campaign");
 else if(boundary==="operation")changed.searchParams.set("arrangement","different-operation");
 else changed.pathname="/canvas/foreign-board/foreign-board";
 // Synthetic negative current-route input to the actual Store observer, including
 // same-turn return. It does not assert navigation authority for the invalid route.
 x.h.store.setRoute(changed.pathname+changed.search+changed.hash);x.h.store.setRoute(route);await x.drain();
 await lateContinuation(old);await x.drain();assert.equal(x.arrangementPosts().length,count);
 noContinuation(x);const read=await check(x,x.locale);assert.equal(read.status,409);noContinuation(x);
 assert.equal(x.operation(),x.originalRequest.operationId);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
});

for(const shared of[false,true])for(const kind of["normal","undo"])
test("a validated exact requirement route stays historical during unrelated current Output loading / "+shared+"/"+kind,async t=>{
 const x=await refusedPreparation(t,{kind,shared,documentCards:"requirement"});await qualifyContinuation(x);
 await closePreparation(x);await switchPosture(x,{back:false});
 const client=x.h.store.outputRequirements;
 await client.ensure(x.worker.documentId);await x.drain();
 const key="requirement:"+x.requirementId,link=x.f.find("a",node=>{
  const href=node.attributes.href;return href&&new URL(href,"http://localhost").searchParams.get("outcome")===key;
 });
 assert.ok(link,"the actual native Output requirement has a current Desk reference");
 await x.f.act(link,"click",{button:0});await x.drain();
 const route=x.h.store.route.get(),events=canonicalEvents(x),before=counts(x),source=x.h.store.captureSourceOwnership();
 const transport=x.h.transport,entered=sceneDeferred(),release=sceneDeferred();let held=false;
 x.h.transport=async request=>{
  const response=await transport(request);
  if(!held&&request.url.startsWith("/api/output-requirements?")){held=true;assert.equal(response.status,200);entered.resolve();await release.promise;}
  return response;
 };
 t.after(()=>release.resolve());
 const refreshing=client.ensure(x.worker.documentId,{force:true});
 try{
  await entered.promise;
  assert.equal(client.resource(x.worker.documentId).state,"refreshing");
  assert.equal(x.h.store.route.get(),route);assert.equal(x.h.store.sourceOwnershipActive(source),true);
  // Current native cache publication already notified the actual witness;
  // repeat a normal notification without inventing a loaded snapshot/token.
  x.h.store.notify();release.resolve();await refreshing;await x.drain();
 }finally{release.resolve();await refreshing;x.h.transport=transport;}
 await x.f.act(x.f.find("a",node=>node.text===outcomeDeskCopy(x.locale).back),"click",{button:0});await x.drain();
 await x.h.store.refreshEvents();await x.drain();await qualifyContinuation(x,{refresh:false});
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
 const review=await submitContinuation(x);assert.equal(review.status,200);assert.equal(review.body.status,"review");
 assert.equal(counts(x).apply,before.apply);assert.equal(review.command.operationId,x.originalRequest.operationId);
});
