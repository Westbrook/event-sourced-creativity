import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { captureOutputNavigation } from "../src/model/output-navigation.ts";
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const noCommands=f=>assert.deepEqual(f.storeHost.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume?.(row)),[],"the handoff does not create, preflight, authorize, match, review, or purchase");
const focusRows=f=>f.trace.filter(value=>/^focus:output-/u.test(value));
async function canvasPage(t,{locale="en",state="confirmed"}={}){
 const f=await createOutputReachabilityPage(t,{locale,state}),h=f.storeHost,session=f.store.session.get(),documentId=f.outputSnapshot().documentId;
 // Browser capability/transport ports only; all Shell, Canvas, Store and Output
 // controller methods execute unchanged. No presence peer or provider exists.
 const previousChannel=globalThis.BroadcastChannel;globalThis.BroadcastChannel=undefined;t.after(()=>{globalThis.BroadcastChannel=previousChannel;});
 const authorized={...session,canvas:{...session.canvas,access:true,pilotAvailable:true,blockedBy:[],requirements:[]}};
 f.store.session.set(authorized);
 h.transport=request=>request.url.startsWith("/api/session?")?Response.json(authorized):request.url==="/api/workspaces/reviews"?Response.json({tasks:[]}):h.worker.request(request.url,request.init);
 const previousHistory=globalThis.history,history=[];
 globalThis.history={pushState(_state,_unused,url){history.push(url);const next=new URL(url,"http://localhost");Object.assign(h.location,{pathname:next.pathname,search:next.search,hash:next.hash});},replaceState(_state,_unused,url){this.pushState(_state,_unused,url);}};
 t.after(()=>{globalThis.history=previousHistory;noCommands(f);});
 f.appendEvent("CanvasCreated",{canvas_id:"synthetic-board",name:"Synthetic board"});
 f.appendEvent("CanvasItemPlaced",{canvas_id:"synthetic-board",item_id:"synthetic-document-card",source_kind:"document",source_id:documentId,x:0,y:0,w:300,h:200,z:"a",rot:0});
 // The generic native renderer reconstructs element ports each draw. Real
 // ResizeObserver only re-notifies a stable element when its size changes.
 // Keep that browser behavior at the fixture boundary, never in production.
 const resizeSeen=new WeakMap(),targets=f.resizeTargets;
 f.resizeTargets=new class extends Map{
  *[Symbol.iterator](){for(const [observer,node]of super[Symbol.iterator]()){
   if(String(node.attributes?.class??"").split(/\s+/u).includes("canvas-viewport")){
    const key=node.owner??node,parent=resizeSeen.get(key)??new Map(),box=node.getBoundingClientRect(),stamp=box.width+":"+box.height;
    if(parent.get("canvas-viewport")===stamp)continue;parent.set("canvas-viewport",stamp);resizeSeen.set(key,parent);
   }yield [observer,node];
  }}
 }(targets);

 f.store.route.set("/canvas/synthetic-board/synthetic-board?posture=outcomes&arrangement=original-pending-arrangement");
 await f.settle();
 f.documentId=documentId;f.navigationHistory=history;f.navigationSession=authorized;
 f.canvas=f.components().find(value=>value.tag==="forma-canvas-application");assert.ok(f.canvas);
 f.selectOutput=async(kind,id)=>{
  const reference=captureOutputNavigation(f.outputSnapshot(),f.store.captureAuthorizationScope().key,kind,id);assert.ok(reference);
  const prefix={target:"target:",result:"result:",operation:"operation:",requirement:"requirement:"}[kind];
  const links=f.tree().visible("a").filter(node=>{const href=node.attributes.href;if(!href)return false;const key=new URL(href,"http://localhost").searchParams.get("outcome");return key?.startsWith(prefix)&&String(node.attributes["aria-label"]??"").includes(id);});
  assert.equal(links.length,1,"an explicit exact canonical object, not first label matching");
  await f.act(links[0],"click",{button:0});return reference;
 };
 f.primary=()=>{
  const rows=f.tree().visible("button").filter(node=>String(node.attributes["data-choice-value"]??"").includes(":output:"));
  assert.ok(rows.length>=1&&rows.length<=3,"one primary and at most two alternatives");return rows[0];
 };
 f.finish=async()=>{for(let attempt=0;attempt<5;attempt++)await f.settle();};
 return f;
}

import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
for(const moveFocus of[false,true])test("actual Canvas handoff "+(moveFocus?"must preserve newer native field focus":"still focuses Output without a newer user focus"),async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];
 await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports),nativeFocus=native.nativeFocus;
 const tick=f.tick;
 let observed=false,userField=null,identityBefore=null,identityAfter=null;
 f.tick=async component=>{
  const finalAwait=component.tag==="forma-output-requirements"&&!component.blockId
    &&new Error().stack.includes("focusOutputReference");
  const value=await tick(component);
  if(finalAwait&&!observed){
   observed=true;
   identityBefore={route:f.store.route.get(),authority:f.store.captureAuthorizationScope().key,snapshot:JSON.stringify(f.outputSnapshot())};
   const fields=f.tree().visible("input").concat(f.tree().visible("select")).filter(node=>node.owner?.tag!=="forma-output-requirements"
     &&node.owner?.tag!=="forma-output-requirement-card"&&node.port?.isConnected);
   const language=fields.find(node=>node.owner?.tag==="forma-ui-language-picker");assert.ok(language,"existing non-Output Language select is visible");
   assert.equal(f.tree().visible("dialog").length,0,"no dialog, draft or modal change");
   if(moveFocus){userField=language.port;userField.focus();assert.equal(ports.documentPort.activeElement,userField);assert.equal(userField.isConnected,true);}
   identityAfter={route:f.store.route.get(),authority:f.store.captureAuthorizationScope().key,snapshot:JSON.stringify(f.outputSnapshot())};
  }
  return value;
 };
 await f.act(f.primary());await f.finish();
 assert.equal(observed,true);assert.deepEqual(identityAfter,identityBefore);
 assert.equal(f.canvas.isConnected,false);noCommands(f);
 t.diagnostic(JSON.stringify({moveFocus,routeUnchanged:identityAfter.route===identityBefore.route,authorityUnchanged:identityAfter.authority===identityBefore.authority,
   snapshotUnchanged:identityAfter.snapshot===identityBefore.snapshot,focus:nativeFocus.map(value=>({tag:value.node.tag,owner:value.node.owner?.tag,classes:value.node.attributes?.class,previousConnected:value.previousConnected})),
   finalFocus:{tag:ports.documentPort.activeElement?.tag,owner:ports.documentPort.activeElement?.owner?.tag,classes:ports.documentPort.activeElement?.attributes?.class??""}}));
 if(moveFocus)assert.equal(ports.documentPort.activeElement===userField,true,"a newer ordinary native field focus must win over the pending Desk handoff");
 else assert.equal(ports.documentPort.activeElement?.getAttribute?.("data-output-run-target"),target.id);
});

function newerField(f){const fields=f.tree().visible("select").filter(node=>node.owner?.tag==="forma-ui-language-picker");assert.equal(fields.length,1,"one actual current non-Output field");return fields[0].port;}
function outputScroll(native){return native.nativeScroll.filter(row=>String(row.node.attributes?.class??"").startsWith("output-")).length;}
function noNavigationListeners(f){for(const name of["focusin","pointerdown","keydown"])assert.equal((f.listeners.get(name)??[]).filter(listener=>["focusChanged","interrupt"].includes(listener.name)).length,0,"opening listeners cleaned: "+name);}
for(const locale of["fr","ar","ja"])for(const newer of[false,true])test("actual "+locale+" final Output update "+(newer?"yields to new focus":"keeps owned focus"),async t=>{
 const f=await canvasPage(t,{locale}),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports),tick=f.tick;let entered=false,field=null;
 f.tick=async component=>{const final=component.tag==="forma-output-requirements"&&!component.blockId&&new Error().stack.includes("focusOutputReference"),result=await tick(component);
  if(final&&!entered){entered=true;if(newer){field=newerField(f);native.focus(field);}}return result;};
 await f.act(f.primary());await f.finish();assert.equal(entered,true);
 if(newer){assert.equal(native.document.activeElement===field,true);assert.equal(outputScroll(native),0);}
 else assert.equal(native.document.activeElement?.getAttribute?.("data-output-run-target"),target.id);
 noNavigationListeners(f);noCommands(f);
});
for(const boundary of["headers","body"])for(const event of["focus","pointerdown","keydown"])
test("actual Canvas "+boundary+" session wait yields to newer "+event,async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports),entered=deferred(),reply=deferred(),route=f.store.route.get(),history=f.navigationHistory.length,events=JSON.stringify(f.store.events.get());
 f.storeHost.intercept=async request=>{if(!request.url.startsWith("/api/session?"))return;
  if(boundary==="headers"){entered.resolve();await reply.promise;return Response.json(f.navigationSession);}
  const response=Response.json(f.navigationSession),json=response.json.bind(response);response.json=async()=>{entered.resolve();await reply.promise;return json();};return response;};
 const opening=f.act(f.primary());await entered.promise;const field=newerField(f);
 if(event==="focus")native.focus(field);else native.emit(event,field);
 reply.resolve();await opening;await f.finish();
 assert.equal(f.store.route.get(),route);assert.equal(f.navigationHistory.length,history);assert.equal(outputScroll(native),0);
 assert.equal(JSON.stringify(f.store.events.get()),events);if(event==="focus")assert.equal(native.document.activeElement===field,true);
 noNavigationListeners(f);noCommands(f);
});
for(const event of["none","focus","pointerdown","keydown"])test("actual destination RAF "+event+" keeps only owned Output focus",async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports),original=ports.windowPort.requestAnimationFrame,entered=deferred();let frame=null;
 ports.windowPort.requestAnimationFrame=callback=>{
  if(!frame&&!f.store.route.get().startsWith("/canvas/")&&new Error().stack.includes("deskOpenOutput")){frame=callback;entered.resolve();return -17;}
  return original(callback);
 };t.after(()=>{ports.windowPort.requestAnimationFrame=original;});
 const opening=f.act(f.primary());await entered.promise;await f.settle();const field=newerField(f),route=f.store.route.get();
 if(event==="focus")native.focus(field);else if(event!=="none")native.emit(event,field);
 ports.windowPort.requestAnimationFrame=original;frame(0);await opening;await f.finish();assert.equal(f.store.route.get(),route);
 if(event==="none")assert.equal(native.document.activeElement?.getAttribute?.("data-output-run-target"),target.id);
 else {assert.equal(outputScroll(native),0);if(event==="focus")assert.equal(native.document.activeElement===field,true);}
 noNavigationListeners(f);noCommands(f);
});
for(const event of["pointerdown","keydown"])test("actual final controller update yields to newer "+event,async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports),tick=f.tick;let entered=false;
 f.tick=async component=>{const final=component.tag==="forma-output-requirements"&&!component.blockId&&new Error().stack.includes("focusOutputReference"),result=await tick(component);
  if(final&&!entered){entered=true;native.emit(event,newerField(f));}return result;};
 await f.act(f.primary());await f.finish();assert.equal(entered,true);assert.equal(outputScroll(native),0);assert.equal(focusRows(f).length,0);
 noNavigationListeners(f);noCommands(f);
});
for(const event of["none","focus","pointerdown","keydown"])test("actual Output hidden-panel reveal "+event+" preserves newer focus",async t=>{
 const f=await createOutputReachabilityPage(t),native=installOutputNavigationFocusNative(t,f,ports),target=f.outputSnapshot().confirmedPlan.plan.targets[0];
 const resultPane=f.tree().visible("button").find(node=>node.attributes["data-workbench-pane"]==="result");assert.ok(resultPane);
 await f.act(resultPane);const controller=f.outputControllers().find(value=>!value.blockId);assert.ok(controller);
 assert.equal(controller.closest("#document-context-panel")?.hidden??controller.closest("#document-context-panel")?.hasAttribute("hidden"),true);
 const reference=captureOutputNavigation(f.outputSnapshot(),f.store.captureAuthorizationScope().key,"target",target.id);assert.ok(reference);
 const route=f.store.route.get(),authorization=f.store.captureAuthorizationScope(),tick=f.tick;let entered=false,field=null;
 f.tick=async component=>{const reveal=component.tag==="forma-workspace"&&new Error().stack.includes("focusOutputReference"),result=await tick(component);
  if(reveal&&!entered){entered=true;field=newerField(f);if(event==="focus")native.focus(field);else if(event!=="none")native.emit(event,field);}return result;};
 const opening=controller.focusOutputReference(reference,{section:"native",current:()=>f.store.route.get()===route&&f.store.authorizationScopeActive(authorization)});
 await f.settle();const focused=await opening;await f.settle();assert.equal(entered,true);
 if(event==="none"){assert.equal(focused,true);assert.equal(native.document.activeElement?.getAttribute?.("data-output-run-target"),target.id);}
 else {assert.equal(focused,false);assert.equal(outputScroll(native),0);if(event==="focus")assert.equal(native.document.activeElement===field,true);}
 noNavigationListeners(f);noCommands(f);
});

test("a newer field focused during owned final focus prevents the later Output scroll",async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const native=installOutputNavigationFocusNative(t,f,ports);let field=null;
 const newerSelection=event=>{if(!field&&event.target?.getAttribute?.("data-output-run-target")===target.id){field=newerField(f);native.focus(field);}};
 native.document.addEventListener("focusin",newerSelection,true);t.after(()=>native.document.removeEventListener("focusin",newerSelection,true));
 await f.act(f.primary());await f.finish();assert.ok(field);
 assert.equal(native.document.activeElement===field,true);assert.equal(outputScroll(native),0,"no scroll after newer focus wins");
 noNavigationListeners(f);noCommands(f);
});
