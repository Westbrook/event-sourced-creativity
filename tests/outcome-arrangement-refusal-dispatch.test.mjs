import assert from "node:assert/strict";
import test from "node:test";
import {readyPreparation,refusedPreparation,qualifyContinuation,dispatchInitial,continuationControl,counts,
 closePreparation,openArrangement,sourceRetirement,canonicalEvents,previewRows,noContinuation,
 untilScene,confirmImpersonation,editRefusalSource,check,arrangementDialog}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";
import {withOutcomeDeskPosture} from "../src/model/outcome-desk.ts";

async function cancelConfirmation(x){
 await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);await x.drain();
 const tree=x.f.tree(),modal=tree.visible("dialog").find(node=>String(node.attributes.class??"").includes("impersonation-confirm-dialog"));
 assert.ok(modal);
 const contains=node=>{for(let parent=node.parent;parent;parent=parent.parent)if(parent===modal)return true;return false;};
 const cancel=tree.visible("button").find(node=>contains(node)&&String(node.attributes.class??"").split(/\s+/u).includes("ghost"));
 assert.ok(cancel);await x.f.act(cancel);await x.drain();
}
for(const kind of["normal","undo"])for(const stage of["initial","corrective"])
for(const boundary of["healthy","cancel","opening","posture","route-aba","source"])
test("preparation actual dispatch signal respects the current confirmation / "+[kind,stage,boundary].join("/"),async t=>{
 const options={kind,shared:boundary==="source",impersonation:true};
 const x=stage==="initial"?await readyPreparation(t,options):await refusedPreparation(t,options);
 if(stage==="corrective")await qualifyContinuation(x);
 const events=canonicalEvents(x),rows=previewRows(x),before=counts(x),transport=x.h.transport,base=x.h.store.canvasArrangementRequest.bind(x.h.store);
 const action=kind==="undo"?"undo-preview":"preview";let signals=0,changed=false;
 t.mock.method(x.h.store,"canvasArrangementRequest",(command,controls)=>{
  if(command.action!==action)return base(command,controls);
  assert.equal(typeof controls?.current,"function");assert.equal(typeof controls?.onDispatch,"function");
  return base(command,{...controls,onDispatch:()=>{
   assert.equal(x.arrangementPosts().at(-1).body.action,action,"the real transport records dispatch before its signal");
   signals++;controls.onDispatch();
  }});
 });
 x.h.transport=async request=>{
  if(request.url==="/api/canvas/arrangements"&&request.body.action===action&&!changed){
   changed=true;await editRefusalSource(x,"Current source changes only after this actual preparation dispatch");
  }return transport(request);
 };
 try{
  if(stage==="initial")await dispatchInitial(x);
  else{const node=continuationControl(x);assert.ok(node);await x.f.act(node,node.tag==="form"?"submit":"click");}
  await untilScene(()=>x.h.store.ui.impersonationConfirmOpen);await x.drain();
  const operationId=x.operation(),route=x.h.store.route.get();
  assert.deepEqual(counts(x),before);assert.equal(signals,0,"no synthetic dispatch during a pending confirmation");
  if(boundary==="opening"||boundary==="posture"){
   // Deterministic current-opening input while the real modal is pending, not
   // a claim that a physical user can click through a browser modal.
   await closePreparation(x);
   if(boundary==="posture"){
    const owner=x.canvas(),f=x.f,postureRoute=withOutcomeDeskPosture(route,"outcomes");
    const source=x.h.store.captureSourceOwnership(),authority=x.h.store.captureAuthorizationScope();
    const pendingAction=x.h.store.ui.impersonationAction;
    assert.ok(owner?.isConnected);assert.equal(f.host.tag,"forma-shell");
    assert.equal(owner.closest("forma-shell"),f.host);assert.notEqual(postureRoute,route);
    const unchanged=()=>{
     assert.equal(x.canvas(),owner);assert.equal(owner.isConnected,true);assert.equal(arrangementDialog(x),undefined);
     assert.equal(x.h.store.ui.impersonationConfirmOpen,true);assert.equal(x.h.store.ui.impersonationAction,pendingAction);
     const confirmations=f.tree().visible("dialog").filter(node=>String(node.attributes.class??"").includes("impersonation-confirm-dialog"));
     assert.equal(confirmations.length,1);assert.ok(confirmations[0].port.open&&confirmations[0].port.isConnected);
     assert.ok(x.h.store.sourceOwnershipActive(source)&&x.h.store.authorizationScopeActive(authority));
     assert.equal(x.operation(),operationId);assert.deepEqual(counts(x),before);assert.equal(signals,0);assert.equal(changed,false);
     assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(previewRows(x),rows);assert.deepEqual(x.ledger(),x.initialReceipts);
    };
    unchanged();
    // Preserve the original deterministic emitted-control attempt. Current
    // modal admission must refuse it; this is not physical click-through.
    const menu=f.components().find(value=>value.tag==="forma-ui-popover"&&String(value.attributes.class??"").includes("canvas-view-menu"));
    const trigger=f.find("button",node=>node.owner===menu&&String(node.attributes.class??"").includes("ui-popover-trigger"));
    await f.act(trigger);const panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.id===trigger.attributes.popovertarget);
    assert.ok(panel);panel.showPopover();await f.settle();
    await f.act(f.find("button",node=>node.attributes.id==="canvas-outcome-toggle"));await x.drain();
    assert.equal(x.h.store.route.get(),route,"the real pending confirmation prevents UI posture navigation");unchanged();
    // This dispatch-lifetime unit declares an EXTERNAL posture interruption,
    // using the original Store and pure route transform, not admitted UI.
    x.h.store.setRoute(postureRoute);await x.drain();
    assert.equal(x.h.store.route.get(),postureRoute);
    assert.equal(new URL(x.h.store.route.get(),"http://localhost").searchParams.get("posture"),"outcomes");unchanged();
    const returnRoute=withOutcomeDeskPosture(postureRoute,"canvas");assert.equal(returnRoute,route);
    x.h.store.setRoute(returnRoute);await x.drain();assert.equal(x.h.store.route.get(),route);unchanged();
    t.diagnostic("ARRANGEMENT_CONFIRMATION_EXTERNAL_POSTURE "+JSON.stringify({kind,stage,operationId,
     refusedRoute:route,externalPostureRoute:postureRoute,returnedRoute:x.h.store.route.get(),
     confirmationPending:x.h.store.ui.impersonationConfirmOpen,dispatchSignals:signals,uiAdmission:false}));
   }
   await openArrangement(x,{select:false,name:null,confirmation:true});
  }else if(boundary==="route-aba"){
   x.h.store.setRoute(route+"&pending-other-request=1");x.h.store.setRoute(route);await x.drain();
  }else if(boundary==="source")await sourceRetirement(x);
  if(boundary==="cancel")await cancelConfirmation(x);else await confirmImpersonation(x);
  await x.drain();assert.equal(signals,boundary==="healthy"?1:0);assert.equal(changed,boundary==="healthy");
  assert.equal(x.operation(),operationId);assert.equal(counts(x)[action],before[action]+(boundary==="healthy"?1:0));
  assert.equal(counts(x).apply,before.apply);assert.deepEqual(previewRows(x),rows);assert.deepEqual(x.ledger(),x.initialReceipts);
  if(boundary==="healthy"){
   assert.equal(x.responses.at(-1).status,409);
   assert.deepEqual(x.responses.at(-1).body,{error:"canvas_arrangement_source_changed",providerCalls:0,maximumMicrousd:0});
   x.originalRequest=structuredClone(x.responses.at(-1).command);await qualifyContinuation(x);
  }else{
   assert.deepEqual(canonicalEvents(x),events);
   if(!arrangementDialog(x))await openArrangement(x,{select:false,name:null});
   noContinuation(x);const pending=check(x,x.locale);await confirmImpersonation(x);const read=await pending;
   assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_operation_unavailable");
   assert.equal(read.command.operationId,operationId);
   if(boundary==="cancel")assert.ok(continuationControl(x),"only positive local non-dispatch plus a new current Check qualifies Review");
   else noContinuation(x);
  }
 }finally{x.h.transport=transport;if(x.h.store.ui.impersonationConfirmOpen)await cancelConfirmation(x);}
});
