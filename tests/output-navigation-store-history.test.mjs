import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent, appendEvents, makeEvent, streamHead, readWorkspaceEvents } from "../worker/runtime.ts";
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


for(const shared of [false,true])test('Memory authored acceptance joins existing Store Undo/Redo without retaining a private preview '+shared,async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No external requests'));
 const h=await createSceneStoreHost({count:1,shared});t.after(()=>h.close());
 const {store,worker}=h,blockId='scene-reuse-direction';
 const previousHistory=globalThis.history;globalThis.history={pushState(_state,_title,route){const url=new URL(route,'http://localhost');Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(...args){this.pushState(...args);}};t.after(()=>{globalThis.history=previousHistory;});
 store.setRoute(documentContextBlockRoute(worker.documentId,'Current authored Document',blockId));
 const original=store.projection.get().blocks.find(block=>block.id===blockId);assert.ok(original);
 // Existing edit creates an in-memory Undo entry; server acceptance must be newer.
 await store.appendBatchWithReceipt([{type:'BlockPropertyEdited',payload:{project_id:worker.projectId,document_id:worker.documentId,
  block_id:blockId,property_path:'text',old_value:original.properties.text,new_value:'Human revision before acceptance'}}]);
 // Seed the same canonical server event as the approved specialist publisher,
 // not the untrusted browser append route (which strips private Chat pointers).
 const accepted=makeEvent(worker.streamId,(await streamHead(worker.env,worker.streamId))+1,
  shared?'user:'+worker.owner:'user','web:assistant-memory','memory-execution','BlockPropertyEdited',{
  project_id:worker.projectId,document_id:worker.documentId,block_id:blockId,property_path:'text',old_value:'Human revision before acceptance',new_value:'Accepted Memory suggestion',
  memory_authored_version:1,source_chat_turn_id:'memory-turn',request_id:'memory-execution'});
 await appendEvents(worker.env,[accepted]);await store.refreshEvents();
 const event=store.events.get().findLast(item=>item.payload.memory_authored_version===1);assert.ok(event);
 const receipt={eventId:event.eventId,executionId:'memory-execution',turnId:'memory-turn',blockId,projectId:worker.projectId,documentId:worker.documentId};
 assert.equal(store.rememberMemoryAuthoredEdit({...receipt,executionId:'other'}),false);
 assert.equal(store.rememberMemoryAuthoredEdit(receipt),true);assert.equal(store.rememberMemoryAuthoredEdit(receipt),false);
 const source=()=>store.projection.get().blocks.find(block=>block.id===blockId).properties.text;
 assert.equal(store.canUndo(),true);await store.undo();assert.equal(source(),'Human revision before acceptance');
 const inverse=store.events.get().find(item=>item.compensatesEventId===event.eventId);assert.ok(inverse);assert.equal(inverse.payload.memory_authored_version,1);
 assert.equal(store.canRedo(),true);await store.redo();assert.equal(source(),'Accepted Memory suggestion');
 assert.equal(store.events.get().at(-1).payload.memory_authored_version,1);assert.equal(store.events.get().at(-1).payload.request_id,'memory-execution');
});

for(const shared of [false,true])test('Memory authored creation joins Store Undo/Redo without private source retention '+shared,async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No external requests'));
 const h=await createSceneStoreHost({count:1,shared});t.after(()=>h.close());const {store,worker}=h,blockId='memory-created-block';
 const event=makeEvent(worker.streamId,(await streamHead(worker.env,worker.streamId))+1,shared?'user:'+worker.owner:'user','web:assistant-memory','memory-creation','BlockCreated',{
  project_id:worker.projectId,document_id:worker.documentId,block_id:blockId,type:'direction',handle:'direction/created',position:'zcreated',properties:{text:'Accepted creative block',intent:'include',weight:.7,authority:'authored'},
  memory_authored_version:1,source_chat_turn_id:'memory-turn',request_id:'memory-creation'});
 await appendEvents(worker.env,[event]);await store.refreshEvents();
 const receipt={eventId:event.eventId,executionId:'memory-creation',blockId,projectId:worker.projectId,documentId:worker.documentId};
 assert.equal(store.rememberMemoryAuthoredEdit(receipt),true);assert.equal(store.rememberMemoryAuthoredEdit(receipt),false);
 const active=()=>store.projection.get().blocks.find(block=>block.id===blockId&&!block.removed);
 assert.ok(active());await store.undo();assert.equal(active(),undefined);assert.equal(store.canRedo(),true);
 await store.redo();assert.equal(active().properties.text,'Accepted creative block');
 const history=store.events.get().filter(item=>item.payload.block_id===blockId);assert.equal(history[0].payload.memory_authored_version,1);
 const {memoryAuthoredBlockIds}=await import('../src/model/memory-authorship.ts');
 assert.equal(memoryAuthoredBlockIds(store.projection.get().blocks,store.events.get()).has(blockId),true);
});
