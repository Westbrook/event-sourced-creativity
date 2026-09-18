import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { documentContextBlockRoute } from "../src/model/routes.ts";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const focusImports = registerOutputSourceImports();
const { captureOutputNavigationFocus } = await import("../src/components/output-navigation-focus.ts");
focusImports.deregister();
function documentPort(){
 const listeners=new Map(),body={isConnected:true,tagName:"BODY"};
 return{body,activeElement:body,documentElement:{isConnected:true,tagName:"HTML"},
  addEventListener(type,handler){listeners.set(type,[...(listeners.get(type)??[]),handler]);},
  removeEventListener(type,handler){listeners.set(type,(listeners.get(type)??[]).filter(value=>value!==handler));},
  interrupt(){for(const handler of [...(listeners.get("pointerdown")??[])])handler({target:body});},
  count:()=>[...listeners.values()].reduce((sum,rows)=>sum+rows.length,0)};
}
async function host(t){
 t.mock.method(globalThis,"fetch",async()=>assert.fail("No network/provider in navigation history tests"));
 const worker=await createSceneCostFixture(1,"visual",{depth:true});
 const otherId="focus-other-document";
 await appendAuditEvent(worker.env,worker.streamId,"user","DocumentCreated",{project_id:worker.projectId,document_id:otherId,title:"Other authored Document"});
 const h=await createSceneStoreHost({workerFixture:worker});t.after(()=>h.close());
 const previous=globalThis.history;globalThis.history={pushState(_state,_title,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(...args){this.pushState(...args);}};t.after(()=>{globalThis.history=previous;});
 h.store.setRoute(documentContextBlockRoute(worker.documentId,"Current authored Document",""));
 assert.equal(h.store.projection.get().documentId,worker.documentId);
 h.otherId=otherId;h.destination=documentContextBlockRoute(otherId,"Other authored Document","direction-original");
 h.history=async()=>(await readWorkspaceEvents(worker.env,worker.streamId)).filter(event=>event.type==="DocumentOpened");
 return h;
}
test("ordinary unguarded openDocument retains real routed DocumentOpened history and zero purchase",async t=>{
 const h=await host(t),before=await h.history(),counts=h.worker.counts(),original=h.store.projection.get().documentId;
 assert.equal(await h.store.openDocument(h.otherId,h.destination,"library"),true);
 assert.equal(h.store.projection.get().documentId,h.otherId);assert.equal(h.store.route.get(),h.destination);
 const events=await h.history();assert.equal(events.length,before.length+1);
 assert.equal(events.at(-1).payload.document_id,h.otherId);assert.equal(events.at(-1).payload.previous_document_id,original);
 assert.equal(events.at(-1).payload.source_surface,"library");assert.deepEqual(h.worker.counts(),counts);
 assert.equal(h.requests.filter(row=>row.init.method==="POST").length,1);
 assert.equal(h.store.captureWorkspaceNavigationFocus(h.destination),null);
});
test("guarded openDocument does no history or route work when opening ownership was already lost",async t=>{
 const h=await host(t),before=await h.history(),route=h.store.route.get(),count=h.requests.length,document=documentPort(),focus=captureOutputNavigationFocus(document);
 document.interrupt();
 assert.equal(await h.store.openDocument(h.otherId,h.destination,"library",{current:()=>true,focus}),false);
 assert.equal(h.store.route.get(),route);assert.equal(h.requests.length,count);assert.deepEqual(await h.history(),before);
 focus.dispose();assert.equal(document.count(),0);
});
test("newer navigation after DocumentOpened dispatch keeps the original committed history without late reroute",async t=>{
 const h=await host(t),entered=sceneDeferred(),reply=sceneDeferred(),document=documentPort(),focus=captureOutputNavigationFocus(document);
 const before=await h.history(),counts=h.worker.counts();
 h.intercept=async request=>{if(request.url==="/api/events"&&request.init.method==="POST"){entered.resolve();await reply.promise;}};
 const opening=h.store.openDocument(h.otherId,h.destination,"library",{current:()=>true,focus});
 await entered.promise;document.interrupt();
 h.store.setRoute(documentContextBlockRoute(h.worker.documentId,"Newer chosen Document","scene-reuse-direction"));const newer=h.store.route.get();
 reply.resolve();assert.equal(await opening,true,"already dispatched history is not falsely canceled");
 assert.equal(h.store.route.get(),newer,"completion does not retarget newer navigation");
 const events=await h.history();assert.equal(events.length,before.length+1);assert.equal(events.at(-1).payload.document_id,h.otherId);
 assert.deepEqual(h.worker.counts(),counts);assert.equal(h.requests.filter(row=>row.init.method==="POST").length,1);
 assert.equal(h.store.captureWorkspaceNavigationFocus(newer),null);focus.dispose();assert.equal(document.count(),0);
});
