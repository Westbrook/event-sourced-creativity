import assert from "node:assert/strict";
import test from "node:test";
import {page,previewArrangement,expiredArrangement,enableImpersonation,confirmImpersonation,openReceipt,openArrangement,control,
  outcomeDeskCopy,sceneDeferred,untilScene,retained,pendingForm,dispositionControl,watchSubscriptions} from "./helpers/arrangement-expired-review-fixture.mjs";

async function modalReady(t,{locale="en",shared=false}={}){
  const value=await expiredArrangement(t,{locale,shared}),{x,preview}=value;
  enableImpersonation(x);await x.drain();
  await openReceipt(x);await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);
  await confirmImpersonation(x);assert.equal(x.responses.at(-1).status,409);assert.ok(dispositionControl(x));
  assert.equal(x.operation(),preview.operationId);
  return value;
}
async function retireAndRestoreBeforeRender(x){
  const original=x.h.store.captureSourceOwnership();
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.worker.sharing.contextId);
  assert.equal((await x.worker.request("/api/events?after=0&limit=2000&content=0")).status,403);
  await assert.rejects(x.h.store.refreshEvents(),/403/);
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.worker.sharing.contextId);
  await x.h.store.refreshEvents();
  const renewed=x.h.store.captureSourceOwnership();assert.ok(renewed.generation>original.generation);
  assert.equal(x.h.store.sourceOwnershipActive(original),false);assert.equal(x.h.store.sourceOwnershipActive(renewed),true);
}

for(const locale of["en","ar"])for(const change of["healthy","route","route-aba","opening","source-aba"])
test("current Canvas Ask owns its actual Store/Shell confirmation wait / "+locale+"/"+change,async t=>{
  const{x,preview,row}=await modalReady(t,{locale,shared:change==="source-aba"});
  const before=x.arrangementPosts().length,source=x.h.store.captureSourceOwnership(),route=x.h.store.route.get(),oldCanvas=x.canvas();
  await x.f.act(dispositionControl(x));await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);
  assert.equal(x.arrangementPosts().length,before,"Ask has not yet dispatched through the actual modal");
  if(change==="route"||change==="route-aba"){
    x.h.store.setRoute(route+"&new-intent=1");if(change==="route-aba")x.h.store.setRoute(route);
  }else if(change==="opening"){
    // Actual current Close and Arrange handlers isolate a new opening on the
    // same Canvas. Native event ports are not a physical top-layer click claim.
    await x.f.act(control(x,x.copy.close));await x.drain();assert.equal(oldCanvas.isConnected,true);
    assert.equal(x.f.tree().visible("dialog").filter(node=>String(node.attributes.class??"").includes("canvas-outcome-arrangement-dialog")).length,0);
    await openArrangement(x,{select:false,name:null,confirmation:true});await x.drain();assert.equal(x.canvas(),oldCanvas);
  }else if(change==="source-aba")await retireAndRestoreBeforeRender(x);
  if(change!=="source-aba")assert.equal(x.h.store.sourceOwnershipActive(source),true);
  await confirmImpersonation(x);
  assert.equal(x.ledger().length,0);assert.equal(x.operation(),preview.operationId);
  if(change==="healthy"){
    assert.equal(x.arrangementPosts().length,before+1);const reply=x.responses.at(-1);
    assert.equal(reply.command.onlyIfUnapplied,true);assert.equal(reply.status,200);assert.equal(reply.body.status,"dismissed");assert.ok(pendingForm(x));
  }else{
    assert.equal(x.arrangementPosts().length,before,"superseded visible Ask must not dispatch after confirmation");
    assert.deepEqual(retained(x,preview),row);assert.equal(pendingForm(x),undefined);assert.equal(dispositionControl(x),undefined);
  }
});

for(const change of["healthy","pre-false","wait-false","body-false"])
test("explicit optional Store current port / "+change,async t=>{
  const x=await page(t,{shared:false}),preview=await previewArrangement(x);enableImpersonation(x);await x.drain();
  let current=change!=="pre-false";const before=x.arrangementPosts().length,entered=sceneDeferred(),gate=sceneDeferred();
  t.after(()=>gate.resolve());
  if(change==="body-false"){
    const transport=x.h.transport;x.h.transport=async request=>{const response=await transport(request);
      if(request.url==="/api/canvas/arrangements"&&request.body.action==="dismiss"){
        const json=response.json.bind(response);response.json=async()=>{const body=await json();entered.resolve();await gate.promise;return body;};
      }return response;};
  }
  const command={action:"dismiss",operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,previewId:preview.previewId,approvalHash:preview.approvalHash};
  const pending=x.h.store.canvasArrangementRequest(command,{current:()=>current});
  // Attach rejection handling before releasing any native confirmation.
  const observed=pending.then(value=>({value}),error=>({error}));
  if(change==="pre-false"){
    const result=await observed;assert.ok(result.error);assert.equal(x.h.store.ui.impersonationConfirmOpen,false);
    assert.equal(x.arrangementPosts().length,before);return;
  }
  await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);
  if(change==="wait-false")current=false;
  if(change==="body-false"){
    const confirming=confirmImpersonation(x);await entered.promise;current=false;gate.resolve();await confirming;
  }else await confirmImpersonation(x);
  const result=await observed;
  if(change==="healthy"){assert.equal(result.value.status,200);assert.equal(result.value.body.status,"dismissed");assert.deepEqual(x.arrangementPosts().at(-1).body,command);}
  else assert.ok(result.error,"supplied current is checked through the actual awaited boundary");
  assert.equal(x.arrangementPosts().length,before+(change==="wait-false"?0:1));
  if(change==="body-false")assert.equal(JSON.parse(retained(x,preview).content).state,"dismissed","late read withholding does not undo an already committed server disposition");
  assert.equal(x.ledger().length,0);
});

for(const change of["healthy","route-aba","scope-aba","source-aba","close-reopen"])
test("one actual per-read owner prevents no-render ABA before descriptor publication / "+change,async t=>{
  const{x,preview,row}=await expiredArrangement(t,{shared:change==="source-aba"}),subscriptions=watchSubscriptions(t,x.h.store);
  const held=x.hold("retrieve"),before=x.arrangementPosts().length,route=x.h.store.route.get();
  await x.f.act(control(x,outcomeDeskCopy("en").retrieve));await held.entered.promise;
  assert.equal(subscriptions.active(),1);
  const [originalRead]=subscriptions.listeners();
  assert.equal(typeof originalRead,"function","The sole held read exposes its actual subscription identity");
  if(change==="route-aba"){x.h.store.setRoute(route+"&other=1");x.h.store.setRoute(route);}
  else if(change==="scope-aba"){
    const session=x.h.store.session.get();x.h.setSession({permissionEpoch:"negative-input-only"});x.h.store.notify();x.h.store.session.set(session);x.h.store.notify();
  }else if(change==="source-aba")await retireAndRestoreBeforeRender(x);
  else if(change==="close-reopen"){await x.f.act(control(x,x.copy.close));await openArrangement(x,{select:false,name:null});}
  t.diagnostic("ARRANGEMENT_READ_SUBSCRIPTION "+JSON.stringify({change,originalReadActive:subscriptions.has(originalRead),...subscriptions.counts()}));
  if(change!=="healthy")assert.equal(subscriptions.has(originalRead),false,"the actual notification/opening retires this original one-shot subscriber immediately");
  held.release();await x.drain();
  assert.equal(x.arrangementPosts().length,before+1);assert.equal(x.operation(),preview.operationId);assert.equal(x.ledger().length,0);
  assert.deepEqual(retained(x,preview),row);assert.equal(pendingForm(x),undefined);
  if(change==="healthy"){assert.ok(dispositionControl(x));assert.equal(subscriptions.active(),1);assert.equal(subscriptions.has(originalRead),true,"The qualified descriptor retains this same original read owner");}
  else{assert.equal(dispositionControl(x),undefined,"a returned-to-same scope cannot resurrect the captured read");assert.equal(subscriptions.active(),0);}
});

for(const change of["healthy","route-aba","scope-aba","source-aba"])
test("actual held-read publication safety without subscription-count assumptions / "+change,async t=>{
  const{x,preview,row}=await expiredArrangement(t,{shared:change==="source-aba"});
  const held=x.hold("retrieve"),before=x.arrangementPosts().length,route=x.h.store.route.get();
  await x.f.act(control(x,outcomeDeskCopy("en").retrieve));await held.entered.promise;
  if(change==="route-aba"){x.h.store.setRoute(route+"&other=1");x.h.store.setRoute(route);assert.equal(x.h.store.route.get(),route);}
  else if(change==="scope-aba"){
    const session=x.h.store.session.get();x.h.setSession({permissionEpoch:"negative-input-only"});x.h.store.notify();x.h.store.session.set(session);x.h.store.notify();
    assert.equal(x.h.store.session.get(),session);
  }else if(change==="source-aba")await retireAndRestoreBeforeRender(x);
  held.release();await x.drain();
  assert.equal(x.arrangementPosts().length,before+1);assert.equal(x.operation(),preview.operationId);
  assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);assert.equal(pendingForm(x),undefined);
  assert.equal(Boolean(dispositionControl(x)),change==="healthy","only this still-owned actual read may publish a current Ask");
});
