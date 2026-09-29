import assert from "node:assert/strict";
import test from "node:test";
import { canvasSourceStoreFixture } from "./helpers/canvas-source-store-host.mjs";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/system-fr.ts";
import ar from "../src/components/design-system/locales/system-ar.ts";
import ja from "../src/components/design-system/locales/system-ja.ts";

const queueChecking="Device queue not yet checked";
const queuePaused="Canvas sync paused · original references retained";
const queueFailure="Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes.";
const queueCatalogs={en,fr,ar,ja};
const queueCalls=x=>x.h.requests.filter(request=>x.syncWrite(request));
const queueAllSaved=f=>f.i18n.t("canvas.allChangesSaved","All changes saved");
function queueStatus(f){
  const node=f.renderer.ownNodes(f.host,"span").find(node=>String(node.attributes.class??"").split(/\s+/u).includes("canvas-sync-status"));
  assert.ok(node?.isConnected,"the current inline queue status is rendered");
  assert.equal(node.attributes.role,"status");assert.equal(node.attributes["aria-live"],"polite");
  assert.deepEqual(Object.keys(node.handlers),[]);
  return f.renderer.markup.slice(f.renderer.markup.indexOf(node.full)+node.full.length).split("</span>")[0];
}
function queueUnverified(x){
  const status=queueStatus(x.f);assert.equal(status,x.f.i18n.system(queueChecking));
  assert.notEqual(status,queueAllSaved(x.f));
  if(x.f.locale!=="en")assert.notEqual(status,queueChecking);
}
async function queueVerificationFixture(t,locale){
  let held;t.after(()=>held?.release());
  const x=await canvasSourceStoreFixture(t,{locale,shared:true});
  x.holdRead=()=>held=x.db.holdRequest(request=>request.method==="getAll");
  return x;
}
const queueTurns=async(x,count=8)=>{for(let turn=0;turn<count;turn++)await x.turn();x.f.draw();};

// Full actual Canvas/Store/Worker methods; only native session, DOM/timer and
// RAM IndexedDB event-order boundaries are ports. No browser/AT/storage claim.
for(const locale of ["en","fr","ar","ja"])test("initial current Canvas queue is unverified until its actual empty summary arrives "+locale,async t=>{
  const x=await queueVerificationFixture(t,locale),{h,f,queue,scope}=x;
  const held=x.holdRead();x.online();await held.entered;f.draw();
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);queueUnverified(x);
  assert.equal(x.db.values.size,0);assert.equal(queueCalls(x).length,0);
  held.release();await x.until(()=>{f.draw();return queueStatus(f)===queueAllSaved(f);},"verified current empty queue");
  assert.equal((await queue.summary(scope)).count,0);assert.equal(queueCalls(x).length,0);
});

for(const locale of ["en","fr","ar","ja"])test("different current Canvas queue is checked before saved and genuine Worker commit clears it "+locale,async t=>{
  const x=await queueVerificationFixture(t,locale),{h,f,queue,scope}=x;
  const old=await queue.enqueueBatch([x.originalInput(0)],scope);
  for(const callback of f.listeners.get("offline")??[])callback({type:"offline"});
  await x.until(()=>{f.draw();return queueStatus(f)===f.i18n.system("Offline · 1 change safe on this device");},"original queue summary observed");
  const oldAuthorization=h.store.captureAuthorizationScope(),epoch=String(h.store.session.get().permissionEpoch)+":new-current-queue",nextScope={...scope,permissionEpoch:epoch};
  const input=x.originalInput(1);input.payload.history_action_id="known-new-owner-queued";
  const queued=await queue.enqueueBatch([input],nextScope);
  const dispatched=x.deferred(),release=x.deferred();let workerStatus=null,wire=null;
  h.intercept=async request=>{
    if(!x.syncWrite(request))return;dispatched.resolve(request);await release.promise;
    const response=await h.worker.request(request.url,request.init);workerStatus=response.status;wire=await response.clone().json();return response;
  };
  // Current session delivery, not an old action or a replacement Store method.
  h.setSession({permissionEpoch:epoch});
  assert.notEqual(h.store.captureAuthorizationScope().key,oldAuthorization.key);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
  const held=x.holdRead();x.online();await held.entered;f.draw();queueUnverified(x);
  assert.equal(x.db.values.get(queued.id).events.length,1);assert.equal(queueCalls(x).length,0);
  held.release();const invocation=await dispatched.promise;f.draw();
  assert.deepEqual(invocation.body.events.map(event=>event.payload.client_event_id),["original-client-1"]);
  assert.notEqual(queueStatus(f),queueAllSaved(f));assert.notEqual(queueStatus(f),f.i18n.system(queueChecking));
  release.resolve();await f.host.canvasSourcePendingForTest();await queueTurns(x);
  assert.equal(workerStatus,200);assert.equal(wire.appended.length,1);assert.equal((await queue.summary(nextScope)).count,0);
  assert.equal(queueStatus(f),queueAllSaved(f));assert.equal(queueCalls(x).length,1);
  assert.equal(x.db.values.has(old.id),true,"the separate original scope is unchanged");
  assert.equal((await x.canonical()).filter(event=>event.payload.client_event_id==="original-client-1").length,1);
});

for(const [locale,next]of [["en","fr"],["fr","ar"],["ar","ja"],["ja","en"]])test("unverified Canvas queue uses the current locale without implying a read or retry "+locale+"→"+next,async t=>{
  const x=await queueVerificationFixture(t,locale),{f,h}=x,held=x.holdRead();
  x.online();await held.entered;f.draw();queueUnverified(x);const previous=queueStatus(f);
  Object.assign(f.i18n.messages,queueCatalogs[next]);f.locale=next;
  h.document.documentElement.lang=next;h.document.documentElement.dir=next==="ar"?"rtl":"ltr";
  f.i18n.hostDisconnected();f.i18n.hostConnected();f.draw();
  assert.equal(f.i18n.locale,next);queueUnverified(x);assert.notEqual(queueStatus(f),previous);
  assert.equal(queueCalls(x).length,0);held.release();
  await x.until(()=>{f.draw();return queueStatus(f)===queueAllSaved(f);},"actual empty queue, not a locale change, certifies summary");
});

for(const locale of ["en","fr","ar","ja"])test("source pause precedes an unverified queue after controlled denial and current Worker200 "+locale,async t=>{
  const x=await queueVerificationFixture(t,locale),{h,f,queue,scope}=x,held=x.holdRead();
  x.online();await held.entered;f.draw();queueUnverified(x);
  await x.retire();f.draw();
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),false);
  assert.equal(f.renderer.markup.includes(f.i18n.system(queueChecking)),false,"a withdrawn source is not a checking board");
  await x.restore();f.draw();
  assert.equal(queueStatus(f),f.i18n.system(queuePaused),"an actual source pause wins over the initial unverified marker");
  const detail=f.renderer.ownNodes(f.host,"p").find(node=>node.attributes.class==="canvas-storage-status");
  assert.equal(detail?.attributes["data-storage-state"],"pending");
  assert.equal(queueCalls(x).length,0);held.release();
  await x.until(()=>{f.draw();return queueStatus(f)===queueAllSaved(f);},"completed retirement and actual empty current summary");
  const summary=await queue.summary(scope);assert.equal(summary.count,0);assert.equal(summary.sourcePausePending,false);
  assert.equal(summary.sourcePauseFailed,false);assert.equal(queueCalls(x).length,0);
});

for(const locale of ["en","fr","ar","ja"])test("prior Canvas storage failure is not replaced by the unverified status after Worker200 "+locale,async t=>{
  let abort;t.after(()=>abort?.release());
  const x=await queueVerificationFixture(t,locale),{h,f,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope);
  abort=x.db.holdCommit(transaction=>transaction.operations.some(item=>item.method==="put"&&item.value?.sourceRetired));
  const retiring=x.retire();await abort.entered;abort.reject(new DOMException("Test-only storage abort","AbortError"));await retiring;
  await x.until(()=>h.store.ui.toast===f.i18n.system(queueFailure),"actual failed storage outcome");
  for(const [id,timer]of [...h.timers])if(timer.delay===2800){h.timers.delete(id);timer.callback();}
  assert.equal(h.store.ui.toast,"");
  const held=x.holdRead();await x.restore();await held.entered;f.draw();
  assert.equal(queueStatus(f),f.i18n.system(queuePaused));assert.equal(f.renderer.markup.includes(f.i18n.system(queueFailure)),true);
  assert.equal(f.renderer.markup.includes(f.i18n.system(queueChecking)),false);
  assert.equal(x.db.values.get(batch.id).events.length,1);assert.equal(queueCalls(x).length,0);
  held.release();await queueTurns(x);
  assert.equal((await queue.summary(scope)).sourcePauseFailed,true);assert.equal(queueCalls(x).length,0);
});

for(const locale of ["en","fr","ar","ja"])test("read-only Canvas never implies it is checking an authoring queue "+locale,async t=>{
  const x=await queueVerificationFixture(t,locale),{h,f}=x;
  const session=h.store.session.get();h.setSession({
    permissionEpoch:String(session.permissionEpoch)+":reader",
    projectContext:{...session.projectContext,role:"viewer",permissions:["project.read","project.canvas.use"]},
  });
  x.online();f.draw();
  assert.equal(queueStatus(f),f.i18n.t("canvas.readOnlyStatus","Viewing · updates arrive automatically"));
  assert.equal(f.renderer.markup.includes(f.i18n.system(queueChecking)),false);assert.equal(queueCalls(x).length,0);
});
