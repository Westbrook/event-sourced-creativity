import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { captureOutputNavigation } from "../src/model/output-navigation.ts";
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const noCommands=f=>assert.deepEqual(f.storeHost.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(row)),[],"the handoff does not create, preflight, authorize, match, review, or purchase");
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
for(const locale of["en","fr","ar","ja"])test("actual "+locale+" Canvas→Store→existing Output handoff preserves source and original URL handle",async t=>{
 const f=await canvasPage(t,{locale}),target=f.outputSnapshot().confirmedPlan.plan.targets[0];
 await f.selectOutput("target",target.id);const originalRoute=f.store.route.get(),events=JSON.stringify(f.store.events.get()),snapshot=JSON.stringify(f.outputSnapshot());
 assert.match(originalRoute,/arrangement=original-pending-arrangement/u);
 const action=f.primary();assert.match(action.attributes["data-choice-value"],/:output:native:/u);
 const native=installOutputNavigationFocusNative(t,f,calmFullPageNativePorts);
 await f.act(action);await f.finish();
 assert.equal(f.canvas.isConnected,false,"the intentional Canvas disconnect does not cancel destination-owned focus");
 assert.ok(f.store.route.get().endsWith("#context="+target.requirement_id));assert.ok(focusRows(f).includes("focus:output-run-target"));
 assert.equal(native.document.activeElement?.getAttribute?.("data-output-run-target"),target.id);
 assert.equal(JSON.stringify(f.outputSnapshot()),snapshot);assert.equal(JSON.stringify(f.store.events.get()),events);
 assert.ok(f.navigationHistory.includes(originalRoute),"original exact Canvas selection and pending arrangement handle stay in navigation history");
 assert.equal(f.outputControllers().filter(value=>!value.blockId).length,1);noCommands(f);
});
for(const kind of["requirement","result","operation"])test("actual Canvas "+kind+" click reaches its exact existing read-only node",async t=>{
 const f=await canvasPage(t,{state:kind==="operation"?"uncertain-receipt":"reviewer"}),snapshot=f.outputSnapshot();
 const id=kind==="requirement"?snapshot.requirements[0].blockId:kind==="result"?snapshot.results[0].id:snapshot.grants[0].operations[0].id;
 const reference=await f.selectOutput(kind,id),sourceEvents=JSON.stringify(f.store.events.get());
 await f.act(f.primary());await f.finish();
 assert.equal(f.canvas.isConnected,false);
 const marker={requirement:"output-card-host",result:"output-result",operation:"output-operation"}[kind];assert.ok(focusRows(f).includes("focus:"+marker));
 assert.equal(JSON.stringify(f.store.events.get()),sourceEvents);
 if(kind==="operation"){const current=f.outputSnapshot().grants.find(grant=>grant.id===reference.grantId).operations.find(operation=>operation.id===id);assert.equal(current.jobId,reference.jobId);assert.ok(f.store.documentJobs.get().some(job=>job.jobId===reference.jobId));}
 else assert.equal(f.outputSnapshot().permissions.canRequest,false,"free inspection does not borrow paid permission");
 noCommands(f);
});
for(const boundary of["headers","body"])for(const change of["route","authority","source","plan","planning-document","modal"])
test("actual captured Canvas handoff cannot redirect newer "+change+" during "+boundary,async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const gate=deferred(),entered=deferred(),originalRoute=f.store.route.get(),historyBefore=f.navigationHistory.length;
 f.storeHost.intercept=async request=>{
  if(!request.url.startsWith("/api/session?"))return;
  if(boundary==="headers"){entered.resolve();await gate.promise;return Response.json(f.navigationSession);}
  const response=Response.json(f.navigationSession),json=response.json.bind(response);response.json=async()=>{entered.resolve();await gate.promise;return json();};return response;
 };
 const active=f.act(f.primary());await entered.promise;
 if(change==="route")f.store.route.set(originalRoute+"&newer=selection");
 else if(change==="authority")f.store.session.set({...f.navigationSession,permissionEpoch:"newer-authority"});
 else if(change==="source"){f.adapter.publishSourceRevision(f.documentId);await f.store.outputRequirements.ensure(f.documentId,{force:true});}
 else if(change==="plan"){f.adapter.seed(f.documentId,"draft");await f.store.outputRequirements.ensure(f.documentId,{force:true});}
 else if(change==="planning-document")assert.equal(f.store.chooseCanvasPlanningDocument("fixture-document-b"),true);
 else await f.act(f.find("button",node=>String(node.attributes.class??"").includes("canvas-sources-toggle")));
 const route=f.store.route.get(),focusBefore=focusRows(f).length;gate.resolve();await active;await f.finish();
 assert.equal(f.store.route.get(),route);assert.equal(f.navigationHistory.length,historyBefore);assert.equal(focusRows(f).length,focusBefore);
 if(change==="modal")assert.ok(f.tree().visible("dialog").some(node=>String(node.attributes.class??"").includes("canvas-add-dialog")),"newer manual dialog remains open");
 noCommands(f);
});
for(const change of["route","authority","source","modal"])test("destination-owned Canvas handoff rejects late "+change+" before Output focus",async t=>{
 const f=await canvasPage(t),target=f.outputSnapshot().confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const tick=f.tick;let injected=false;
 f.tick=async component=>{
  const result=await tick(component);
  if(!injected&&component.tag==="forma-output-requirements"&&!component.blockId&&!f.store.route.get().startsWith("/canvas/")){
   injected=true;
   if(change==="route")f.store.route.set("/document/fixture-document-b/synthetic-document-b");
   else if(change==="authority")f.store.session.set({...f.store.session.get(),permissionEpoch:"destination-authority"});
   else if(change==="source"){f.adapter.publishSourceRevision(f.documentId);await f.store.outputRequirements.ensure(f.documentId,{force:true});}
   else f.components().find(value=>value.tag==="forma-workspace").openContextComposer();
  }return result;
 };
 const before=focusRows(f).length;await f.act(f.primary());await f.finish();
 assert.equal(injected,true);assert.equal(f.canvas.isConnected,false);assert.equal(focusRows(f).length,before);
 if(change==="modal")assert.ok(f.tree().visible("dialog").length);
 noCommands(f);
});
test("current target disappears without substituting a matching requirement or another object",async t=>{
 const f=await canvasPage(t),snapshot=f.outputSnapshot(),target=snapshot.confirmedPlan.plan.targets[0];await f.selectOutput("target",target.id);
 const action=f.primary(),route=f.store.route.get();f.adapter.seed(f.documentId,"draft");await f.store.outputRequirements.ensure(f.documentId,{force:true});
 // Activate the original native control before any DOM refresh. The exact
 // host availability check must reject it even though its requirement survives.
 const handler=action.handlers.click;handler.call(action.owner,{target:action.port,currentTarget:action.port,preventDefault(){},stopPropagation(){}});
 await f.finish();assert.equal(f.store.route.get(),route);assert.equal(focusRows(f).length,0);noCommands(f);
});
