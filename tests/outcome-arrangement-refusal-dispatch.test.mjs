import assert from "node:assert/strict";
import test from "node:test";
import {readyPreparation,refusedPreparation,qualifyContinuation,dispatchInitial,continuationControl,counts,
 closePreparation,switchPosture,openArrangement,sourceRetirement,canonicalEvents,previewRows,noContinuation,
 untilScene,confirmImpersonation,editRefusalSource,check,arrangementDialog}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";

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
   if(boundary==="posture")await switchPosture(x);
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
