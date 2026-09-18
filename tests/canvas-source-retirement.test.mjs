import assert from "node:assert/strict";
import test from "node:test";
import { CanvasOfflineQueue } from "../src/sync/canvas-offline-queue.ts";
import { canvasSourceStoreFixture } from "./helpers/canvas-source-store-host.mjs";

const syncCount=h=>h.requests.filter(request=>request.body?.action==="canvas_sync").length;
const retainedIds=batch=>batch.sourceRetired.requested.map(item=>item.clientEventId);
const bodyFree=rows=>assert.doesNotMatch(JSON.stringify(rows),/PRIVATE RETIRED QUEUE BODY|"payload"|"title"/);

for(const shared of[false,true])for(const outcome of["committed","partial","lost"])test("actual Canvas→Store→Worker "+(shared?"shared":"personal")+" "+outcome+" reply after source retirement stays paused",async t=>{
  const x=await canvasSourceStoreFixture(t,{shared}),{h,f,queue,scope}=x;
  const inputs=[x.originalInput(0),x.originalInput(1)];if(outcome==="partial"&&!shared)inputs[1].payload.item_id="";
  const batch=await queue.enqueueBatch(inputs,scope),entered=x.deferred(),release=x.deferred();let wire;
  h.intercept=async request=>{
    if(!x.syncWrite(request))return;entered.resolve(request);await release.promise;
    const response=await h.worker.request(request.url,request.init);wire=await response.clone().json();
    assert.equal(response.status,200,JSON.stringify(wire));
    if(outcome==="lost")throw new Error("Synthetic response loss after actual Worker commit");
    // Shared admission is atomic: model a truncated actual reply, not a fictional partial server commit.
    if(outcome==="partial"&&shared)return Response.json({...wire,appended:wire.appended.slice(0,1),rejected:[]});
    return response;
  };
  x.online();const invocation=await entered.promise;assert.deepEqual(invocation.body.events.map(event=>event.payload.client_event_id),batch.events.map(event=>event.payload.client_event_id));
  await x.retire();await x.until(()=>x.db.transactions.some(record=>record.completed&&record.operations.some(item=>item.value?.sourceRetired)),"pause committed");
  const retired=await new CanvasOfflineQueue().listBatches(scope);assert.equal(retired.length,1);bodyFree(retired);assert.deepEqual(retainedIds(retired[0]),["original-client-0","original-client-1"]);assert.deepEqual(retired[0].sourceRetired.acknowledgments,[]);
  await x.restore();assert.equal(syncCount(h),1,"an unrelated current Worker GET never submits the paused batch");
  release.resolve();await x.until(()=>Boolean(wire),"actual original reply observed");
  await x.until(()=>x.db.transactions.some(record=>record.completed&&record.operations.some(item=>item.value?.sourceRetired?.acknowledgments?.length)),"actual original receipt persisted");
  await f.host.canvasSourcePendingForTest();
  const[saved]=await queue.listBatches(scope);assert.equal(saved.id,batch.id);assert.deepEqual(retainedIds(saved),["original-client-0","original-client-1"]);
  assert.equal(saved.sourceRetired.acknowledgments.length,1);const receipt=saved.sourceRetired.acknowledgments[0];
  assert.equal(receipt.outcome,outcome==="lost"||outcome==="partial"&&shared?"unconfirmed":"observed");assert.equal(receipt.committed.length,outcome==="committed"?2:outcome==="partial"?1:0);
  bodyFree(saved);assert.equal(syncCount(h),1);assert.equal(h.store.optimisticEvents.get().length,0);assert.equal(h.store.events.get().some(event=>event.payload.client_event_id==="original-client-0"),false,"late private event bodies are not republished");
  x.online();for(let turn=0;turn<8;turn++)await x.turn();f.draw();assert.equal(syncCount(h),1);
  assert.ok(![...x.timers.values()].some(timer=>timer.callback.toString().includes("#flushQueue")),"no automatic retry timer for paused references");
  const canonical=(await x.canonical()).filter(event=>String(event.payload.client_event_id??"").startsWith("original-client-"));
  assert.equal(canonical.length,outcome==="partial"&&!shared?1:2,"only the real original Worker commit exists");
  await x.restore();await f.host.canvasSourcePendingForTest();
  if(outcome!=="partial"||shared)await x.until(()=>x.db.transactions.some(record=>record.completed&&record.operations.some(item=>item.method==="delete"&&item.key===batch.id)),"exact canonical reconciliation committed");
  const afterCurrentRead=await queue.listBatches(scope);
  assert.equal(afterCurrentRead.length,outcome==="partial"&&!shared?1:0,"only a complete exact authorized canonical read reconciles the retained original IDs");
  if(afterCurrentRead.length){assert.equal(afterCurrentRead[0].id,batch.id);assert.deepEqual(retainedIds(afterCurrentRead[0]),["original-client-0","original-client-1"]);bodyFree(afterCurrentRead);}
  assert.equal(syncCount(h),1,"canonical reconciliation never resubmits remaining original events");
});

test("actual current non-retired transport retry preserves the original client IDs and completes once",async t=>{
  const x=await canvasSourceStoreFixture(t),{h,queue,scope}=x;let first=true;
  await queue.enqueueBatch([x.originalInput(0)],scope);
  h.intercept=async request=>{if(x.syncWrite(request)&&first){first=false;return Response.json({error:"synthetic temporary transport failure"},{status:500});}};
  let clock=Date.now();t.mock.method(Date,"now",()=>clock);x.online();
  await x.until(()=>[...x.timers.values()].some(timer=>timer.callback.toString().includes("#flushQueue")),"ordinary retry timer");
  clock+=2100;const timer=[...x.timers.values()].find(timer=>timer.callback.toString().includes("#flushQueue"));timer.callback();
  await x.until(()=>syncCount(h)===2,"same-ID retry");await x.f.host.canvasSourcePendingForTest();
  const calls=h.requests.filter(request=>x.syncWrite(request));assert.deepEqual(calls[0].body.events.map(event=>event.payload.client_event_id),calls[1].body.events.map(event=>event.payload.client_event_id));
  assert.equal((await x.canonical()).filter(event=>event.payload.client_event_id==="original-client-0").length,1);
  assert.equal((await queue.summary(scope)).count,0);
});

const retiredDraftMessage="Private Canvas draft bodies were withdrawn from this device queue. Original batch references are retained; unconfirmed changes are not retried.";
const failedStorageMessage="Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes.";
for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])for(const failure of[false,true])test("actual Canvas source "+locale+"/"+(shared?"shared":"personal")+" withdraws drafts with "+(failure?"unconfirmed storage":"committed reference retention"),async t=>{
 const x=await canvasSourceStoreFixture(t,{locale,shared}),{h,f,queue,scope}=x;
 await queue.enqueueBatch([x.originalInput(0)],scope);
 await f.sources();await f.chooseSourceKind("context");
 const title=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.placeholder===f.i18n.system("Give this idea a short name")),body=f.renderer.ownNodes(f.host,"textarea")[0];
 assert.ok(title&&body);title.handlers.input.call(f.host,{target:{value:"EXACT authored private title"}});body.handlers.input.call(f.host,{target:{value:"原文 private draft / نص خاص"}});f.draw();
 assert.ok(f.renderer.ownNodes(f.host,"textarea").some(node=>node.value==="原文 private draft / نص خاص"));
 const abort=failure?x.db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired)):null;
 const retiring=x.retire();if(abort){await abort.entered;abort.reject(new DOMException("Synthetic retirement transaction abort","AbortError"));}await retiring;
 const expected=f.i18n.system(failure?failedStorageMessage:retiredDraftMessage);
 await x.until(()=>h.store.ui.toast===expected,"exact localized storage outcome");
 f.draw();
 assert.equal(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class?.includes("canvas-add-dialog")),false);
 assert.doesNotMatch(f.renderer.markup,/EXACT authored private title|原文 private draft|نص خاص/);
 const rows=await queue.listBatches(scope);bodyFree(rows);assert.deepEqual(retainedIds(rows[0]),["original-client-0"]);
 assert.equal((await queue.summary(scope)).sourcePauseFailed,failure);assert.equal(syncCount(h),0);
 assert.equal(h.store.ui.toast,expected);if(locale!=="en")assert.notEqual(expected,failure?failedStorageMessage:retiredDraftMessage);
 if(failure)assert.equal(x.db.values.values().next().value.events.length,1,"failed persistence has no reload-erasure claim");
 else assert.equal(x.db.values.values().next().value.events.length,0);
 await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();
 assert.equal(syncCount(h),0);assert.match(f.renderer.markup,new RegExp(f.i18n.system("Canvas sync paused · original references retained").replace(/[.*+?^$()|[\]\\]/g,"\\$&")));
 await f.sources();await f.chooseSourceKind("context");assert.ok(f.renderer.ownNodes(f.host,"textarea").every(node=>node.value!== "原文 private draft / نص خاص"),"new current opening never restores withdrawn bytes");
});

for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])test("old artifact private-read continuation must not open over a new current source drawer "+locale+"/"+(shared?"shared":"personal"),async t=>{
 const x=await canvasSourceStoreFixture(t,{artifact:true,locale,shared}),{h,f}=x;
 const entered=x.deferred(),release=x.deferred();let once=false;
 h.store.content.set({});h.intercept=async request=>{if(!x.sourceRead(request)||once)return;once=true;const response=await h.worker.request(request.url,request.init),json=response.json.bind(response);response.json=async()=>{entered.resolve();await release.promise;return json();};return response;};
 await f.click("button",node=>node.attributes.class==="canvas-artifact-open");
 await entered.promise;await x.retire();await x.restore();await f.sources();
 const priorFocus=x.ports.documentPort.activeElement;release.resolve();for(let turn=0;turn<15;turn++)await x.turn();f.draw();
 assert.equal(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class?.includes("canvas-artifact-viewer")),false,"old source read cannot reopen private viewer");
 assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class?.includes("canvas-add-dialog")));
 assert.equal(x.ports.documentPort.activeElement,priorFocus);
});

for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])test("current authorized artifact viewer still opens "+locale+"/"+(shared?"shared":"personal"),async t=>{
 const x=await canvasSourceStoreFixture(t,{artifact:true,locale,shared}),{h,f}=x;
 h.store.content.set({});
 await f.click("button",node=>node.attributes.class==="canvas-artifact-open");
 await x.until(()=>{f.draw();return f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class?.includes("canvas-artifact-viewer"));},"current exact private viewer");
 assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
 const artifact=h.store.projection.get().libraryArtifacts.find(item=>item.id==="saved-scene-story");assert.ok(artifact);
 assert.equal(typeof h.store.content.get()[artifact.contentRef],"string");
 assert.equal(h.requests.filter(request=>x.syncWrite(request)).length,0);
});

for(const shared of[false,true])test("source retirement preserves body-free original queue references while Canvas is disconnected "+(shared?"shared":"personal"),async t=>{
 const x=await canvasSourceStoreFixture(t,{shared}),{h,f,queue,scope}=x;const batch=await queue.enqueueBatch([x.originalInput(0)],scope);
 f.host.isConnected=false;f.host.disconnectedCallback();
 await x.retire();await x.until(()=>x.db.transactions.some(record=>record.completed&&record.operations.some(item=>item.value?.sourceRetired)),"Store-owned disconnected queue retirement");
 const rows=await new CanvasOfflineQueue().listBatches(scope);assert.equal(rows.length,1);assert.equal(rows[0].id,batch.id);assert.deepEqual(retainedIds(rows[0]),["original-client-0"]);assert.deepEqual(rows[0].sourceRetired.acknowledgments,[]);bodyFree(rows);
 await x.restore();assert.equal(syncCount(h),0);
 f.host.isConnected=true;f.host.connectedCallback();f.draw();await x.until(()=>{f.draw();return f.renderer.markup.includes(f.i18n.system("Canvas sync paused · original references retained"));},"remounted paused references");
 assert.equal(syncCount(h),0);assert.equal(h.store.optimisticEvents.get().length,0);bodyFree(await queue.listBatches(scope));
});

for(const shared of[false,true])for(const boundary of["queued-read","queued-write"])test("actual Canvas "+(shared?"shared":"personal")+" "+boundary+" cannot restage a retired source after recovery",async t=>{
 const x=await canvasSourceStoreFixture(t,{shared}),{h,f,queue,scope}=x;
 let held,originalIds;
 if(boundary==="queued-read"){
   const batch=await queue.enqueueBatch([x.originalInput(0)],scope);originalIds=batch.events.map(event=>event.payload.client_event_id);
   held=x.db.holdRequest(item=>item.method==="getAll");x.online();await held.entered;
 }else{
   await f.sources();await f.chooseSourceKind("context");
   const title=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.placeholder===f.i18n.system("Give this idea a short name")),body=f.renderer.ownNodes(f.host,"textarea")[0];
   title.handlers.input.call(f.host,{target:{value:"PRIVATE RETIRED FORM TITLE"}});body.handlers.input.call(f.host,{target:{value:"PRIVATE RETIRED FORM BODY"}});f.draw();
   const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog")),form=f.renderer.ownNodes(f.host,"form").find(node=>node.closest("dialog")===dialog);
   assert.ok(form?.handlers.submit);held=x.db.holdRequest(item=>item.method==="put");form.handlers.submit.call(f.host,{preventDefault(){},currentTarget:form});
   const request=await held.entered;originalIds=request.value.events.map(event=>event.payload.client_event_id);assert.equal(originalIds.length,2);
 }
 await x.retire();await x.restore();await f.sources();const nextFocus=x.ports.documentPort.activeElement;
 held.release();await x.until(()=>x.db.transactions.some(record=>record.completed&&record.operations.some(item=>item.value?.sourceRetired)),"late original batch persisted as body-free references");
 for(let turn=0;turn<12;turn++)await x.turn();f.draw();
 const rows=await new CanvasOfflineQueue().listBatches(scope);assert.equal(rows.length,1);assert.deepEqual(retainedIds(rows[0]),originalIds);bodyFree(rows);
 assert.equal(h.store.optimisticEvents.get().length,0);assert.equal(syncCount(h),0);
 assert.doesNotMatch(f.renderer.markup,/PRIVATE RETIRED FORM TITLE|PRIVATE RETIRED FORM BODY|PRIVATE RETIRED QUEUE BODY/);
 assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class?.includes("canvas-add-dialog")),"old continuation cannot close the new source drawer");
 assert.equal(x.ports.documentPort.activeElement,nextFocus);
});
