import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CanvasOfflineQueue } from "../src/sync/canvas-offline-queue.ts";
import { canvasSourceStoreFixture } from "./helpers/canvas-source-store-host.mjs";
import en from "../src/components/design-system/locales/system-en.ts";
import fr from "../src/components/design-system/locales/system-fr.ts";
import ar from "../src/components/design-system/locales/system-ar.ts";
import ja from "../src/components/design-system/locales/system-ja.ts";

const storageFailure="Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes.";
const storageCommitted="Private Canvas draft bodies were withdrawn from this device queue. Original batch references are retained; unconfirmed changes are not retried.";
const storagePending="Canvas sync is paused in this page while device storage removes private draft bodies and saves original references. The pause after reload is not yet confirmed. Do not retry the original changes.";
const storagePaused="Canvas sync paused · original references retained";
const storageCatalogs={en,fr,ar,ja};
const storageNode=(f)=>f.renderer.ownNodes(f.host,"p").find(node=>node.attributes.class==="canvas-storage-status");
const storageText=(f,node)=>node?f.renderer.markup.slice(f.renderer.markup.indexOf(node.full)+node.full.length).split("</"+node.tag+">")[0]:"";
const storageSyncs=(x)=>x.h.requests.filter(request=>x.syncWrite(request));
function storageToastExpires(x){
  for(const [id,timer]of [...x.h.timers])if(timer.delay===2800){x.h.timers.delete(id);timer.callback();}
  assert.equal(x.h.store.ui.toast,"","the real Store toast timeout ran");
}
function storageInline(x,state){
  const {f}=x,node=storageNode(f);assert.ok(node,"an inline storage explanation is rendered");
  assert.equal(node.attributes["data-storage-state"],state);assert.equal(node.attributes.role,"status");
  assert.equal(node.attributes["aria-live"],"polite");assert.equal(node.isConnected,true);
  assert.equal(node.parentElement.attributes.class,"canvas-commandbar","the existing status area owns the explanation");
  assert.equal(node.closest("dialog"),null);assert.equal(node.closest("details"),null);
  assert.equal(Object.hasOwn(node.attributes,"popover"),false);assert.deepEqual(Object.keys(node.handlers),[]);
  assert.equal(storageText(f,node),f.i18n.system(state==="failed"?storageFailure:storagePending));
  if(f.locale!=="en")assert.notEqual(storageText(f,node),state==="failed"?storageFailure:storagePending);
  assert.equal(f.renderer.ownNodes(f.host,"p").filter(node=>node.attributes.class==="canvas-storage-status").length,1);
  return node;
}
async function storageRetire(x,failure){
  const gate=failure?x.db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired)):null;
  const retiring=x.retire();
  if(gate){await gate.entered;gate.reject(new DOMException("Test-only Canvas retirement transaction abort","AbortError"));}
  await retiring;
  await x.until(()=>x.h.store.ui.toast===x.f.i18n.system(failure?storageFailure:storageCommitted),"actual storage outcome");
  x.f.draw();
}
async function storageUnchanged(x,batch,canonical){
  const rows=await x.queue.listBatches(x.scope);assert.equal(rows.length,1);assert.equal(rows[0].id,batch.id);
  assert.deepEqual(rows[0].sourceRetired.requested.map(item=>item.clientEventId),["original-client-0"]);
  assert.equal(rows[0].events.length,0);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE RETIRED QUEUE BODY|"payload"|"title"/u);
  assert.equal(storageSyncs(x).length,0);assert.equal(x.h.store.optimisticEvents.get().length,0);
  assert.deepEqual(await x.canonical(),canonical,"no authored Canvas or financial history changed");
}

// Actual full Canvas/Store/Worker; source403 is a controlled owned HTTP response,
// source restoration is a genuine authorized Worker200. RAM IndexedDB and timer
// ports demonstrate ordering, not a native storage/reload or screen-reader certificate.
for(const locale of ["en","fr","ar","ja"])for(const failure of [false,true])test("Canvas storage disclosure survives toast expiry and current Worker200 "+locale+"/"+(failure?"aborted":"committed"),async t=>{
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,h,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,failure);storageToastExpires(x);
  await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();
  assert.equal(h.store.routeDataReady(),true);assert.equal(h.store.error.get(),"");
  assert.equal(h.store.ui.toast,"");assert.ok(f.renderer.markup.includes(f.i18n.system(storagePaused)));
  assert.equal((await queue.summary(scope)).sourcePauseFailed,failure);
  assert.equal(x.db.values.get(batch.id).events.length,failure?1:0);
  if(failure)storageInline(x,"failed");else assert.equal(Boolean(storageNode(f)),false,"a durable paused reference does not advertise a storage failure");
  await storageUnchanged(x,batch,canonical);
});

for(const locale of ["en","fr","ar","ja"])for(const failure of [false,true])test("Canvas pending durability is distinct before and after current Worker200 "+locale+"/"+(failure?"abort":"commit"),async t=>{
  let gate;t.after(()=>gate?.release());
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,h,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  gate=x.db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired));
  const retiring=x.retire(),transaction=await gate.entered;await retiring;f.draw();
  assert.equal(Boolean(storageNode(f)),false,"the withdrawn source has no retained board workspace to display");
  assert.equal(transaction.completed,false);assert.equal(x.db.values.get(batch.id).events.length,1);
  assert.equal(f.renderer.markup.includes(f.i18n.system(storageCommitted)),false,"request success is not storage commit");
  await x.restore();f.draw();storageInline(x,"pending");
  assert.equal(h.store.routeDataReady(),true);assert.equal(storageSyncs(x).length,0);
  if(failure)gate.reject(new DOMException("Test-only late storage abort","AbortError"));else gate.release();
  await x.until(()=>{f.draw();return(transaction.completed||transaction.aborted)&&(failure?storageNode(f)?.attributes["data-storage-state"]==="failed":!storageNode(f));},"current pending outcome displayed");
  const summary=await queue.summary(scope);assert.equal(summary.sourcePausePending,false);assert.equal(summary.sourcePauseFailed,failure);
  assert.equal(x.db.values.get(batch.id).events.length,failure?1:0);
  storageToastExpires(x);f.draw();
  if(failure)storageInline(x,"failed");else assert.equal(Boolean(storageNode(f)),false);
  await storageUnchanged(x,batch,canonical);
});

for(const [locale,next]of [["en","fr"],["fr","ar"],["ar","ja"],["ja","en"]])test("Canvas storage failure reads the current locale after toast expiry "+locale+"→"+next,async t=>{
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,true);storageToastExpires(x);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();
  const previous=storageText(f,storageInline(x,"failed"));
  // Update the existing fixture's provider snapshot through the real LocaleController
  // subscription path; the controller/system() implementation is not replaced.
  Object.assign(f.i18n.messages,storageCatalogs[next]);f.locale=next;
  x.h.document.documentElement.lang=next;x.h.document.documentElement.dir=next==="ar"?"rtl":"ltr";
  f.i18n.hostDisconnected();f.i18n.hostConnected();f.draw();
  assert.equal(f.i18n.locale,next);assert.notEqual(storageText(f,storageInline(x,"failed")),previous);
  assert.equal(x.h.store.ui.toast,"");await storageUnchanged(x,batch,canonical);
});

for(const locale of ["en","fr","ar","ja"])test("Canvas failure is cleared only after later actual retirement commit "+locale,async t=>{
  let gate;t.after(()=>gate?.release());
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,true);storageToastExpires(x);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();storageInline(x,"failed");
  gate=x.db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired));
  // A separate owned source denial reaches the existing retirement path.
  // No new UI retry action, reset, or storage mechanism is introduced.
  const retiring=x.retire(),transaction=await gate.entered;await retiring;f.draw();
  assert.equal(transaction.completed,false);assert.equal(x.db.values.get(batch.id).events.length,1);
  assert.equal(Boolean(storageNode(f)),false,"the retired source is no longer a displayed board");
  await x.restore();f.draw();storageInline(x,"failed");assert.equal(storageSyncs(x).length,0);
  gate.release();await x.until(()=>{f.draw();return transaction.completed&&!storageNode(f);},"completed retirement has an actual durability outcome");
  storageToastExpires(x);for(let turn=0;turn<8;turn++)await x.turn();f.draw();
  const summary=await queue.summary(scope);assert.equal(summary.sourcePauseFailed,false);assert.equal(summary.sourcePausePending,false);
  assert.equal(Boolean(storageNode(f)),false);assert.equal(x.db.values.get(batch.id).events.length,0);
  const reloaded=await new CanvasOfflineQueue().listBatches(scope);
  assert.equal(reloaded.length,1);assert.equal(reloaded[0].id,batch.id);assert.equal(reloaded[0].events.length,0);
  await storageUnchanged(x,batch,canonical);
});

for(const locale of ["en","fr","ar","ja"])test("Canvas failed original queue survives owner withdrawal without leaking its status "+locale,async t=>{
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,h,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,true);storageToastExpires(x);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();storageInline(x,"failed");
  const session=h.store.session.get();h.store.session.set(null);f.draw();
  assert.equal(Boolean(storageNode(f)),false);assert.equal(f.renderer.markup.includes(f.i18n.system(storageFailure)),false);
  assert.equal((await queue.summary(scope)).sourcePauseFailed,true);assert.equal(x.db.values.get(batch.id).events.length,1);
  h.store.session.set(session);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();storageInline(x,"failed");
  await storageUnchanged(x,batch,canonical);
});

for(const outcome of ["abort","commit"])test("Canvas old "+outcome+" cannot overwrite a newer known queue owner's summary",async t=>{
  let gate;t.after(()=>gate?.release());
  const x=await canvasSourceStoreFixture(t,{shared:true}),{f,h,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  gate=x.db.holdCommit(record=>record.operations.some(item=>item.method==="put"&&item.value?.sourceRetired));
  const retiring=x.retire(),transaction=await gate.entered;await retiring;
  await x.restore();f.draw();storageInline(x,"pending");x.offline();
  const originalSession=h.store.session.get(),newEpoch=String(originalSession.permissionEpoch)+":new-current-queue";
  // Only this native session-delivery boundary is a fixture port. The full Store
  // computes the new authorization/source ownership and the real Canvas consumes it.
  h.setSession({permissionEpoch:newEpoch});f.draw();
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
  assert.equal(Boolean(storageNode(f)),false,"old pending disclosure is not attributed to the newer owner");
  const newerScope={...scope,permissionEpoch:newEpoch};
  const input=x.originalInput(1);input.payload.history_action_id="newer-current-batch";
  const enqueue=queue.enqueueBatch([input],newerScope);
  if(outcome==="abort")gate.reject(new DOMException("Test-only old owner storage abort","AbortError"));else gate.release();
  const newer=await enqueue;
  for(const callback of f.listeners.get("offline")??[])callback({type:"offline"});
  await x.until(()=>{f.draw();return f.renderer.markup.includes("Offline · 1 change safe on this device");},"new current queue summary");
  assert.equal(Boolean(storageNode(f)),false);assert.equal(f.renderer.markup.includes(f.i18n.system(storagePaused)),false);
  assert.equal(transaction.completed,outcome==="commit");assert.equal(transaction.aborted,outcome==="abort");
  assert.equal((await queue.summary(scope)).sourcePauseFailed,outcome==="abort");
  const current=await queue.summary(newerScope);assert.equal(current.count,1);assert.equal(current.paused,0);
  assert.equal(current.sourcePausePending,false);assert.equal(current.sourcePauseFailed,false);
  assert.equal((await queue.listBatches(newerScope))[0].id,newer.id);
  const old=(await queue.listBatches(scope))[0];assert.equal(old.id,batch.id);assert.equal(old.events.length,0);
  assert.deepEqual(old.sourceRetired.requested.map(item=>item.clientEventId),["original-client-0"]);
  assert.equal(storageSyncs(x).length,0);assert.deepEqual(await x.canonical(),canonical);
  h.store.session.set(originalSession);f.draw();
  for(const callback of f.listeners.get("offline")??[])callback({type:"offline"});
  await x.until(()=>{f.draw();return f.renderer.markup.includes(f.i18n.system(storagePaused));},"return to exact original queue");
  if(outcome==="abort")storageInline(x,"failed");else assert.equal(Boolean(storageNode(f)),false);
  assert.equal(storageSyncs(x).length,0);assert.equal((await queue.listBatches(newerScope))[0].id,newer.id);
});

test("Canvas durability detail declares an inline wrap contract without viewport-only clipping",()=>{
  const css=fs.readFileSync(new URL("../src/canvas/canvas.css",import.meta.url),"utf8");
  const rules=[...css.replace(/\/\*[\s\S]*?\*\//gu,"").matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(match=>match[1].includes("canvas-storage-status"));
  assert.equal(rules.length,2);
  assert.equal(rules[0][1].trim(),".canvas-commandbar:has(>.canvas-storage-status)");
  assert.equal(rules[0][2],"flex-wrap:wrap");
  assert.equal(rules[1][1].trim(),".canvas-commandbar>.canvas-storage-status");
  const values=Object.fromEntries(rules[1][2].split(";").map(declaration=>declaration.split(":")));
  assert.equal(values.display,"block");assert.equal(values["white-space"],"normal");assert.equal(values["overflow-wrap"],"anywhere");
  assert.equal(values["grid-column"],"1 / -1");assert.equal(values.flex,"1 0 100%");
  assert.equal(values["min-inline-size"],"0");assert.equal(values["max-inline-size"],"100%");
  for(const property of ["position","text-overflow","overflow","max-height","line-clamp","left","right"])assert.equal(values[property],undefined);
  const suffix=css.slice(css.indexOf("/* Queue durability uncertainty"));
  assert.doesNotMatch(suffix,/@media|@container/u,"the detail is not hidden by a viewport-only rule");
  const other=fs.readFileSync(new URL("../src/responsive-foundation.css",import.meta.url),"utf8");
  assert.doesNotMatch(other,/canvas-storage-status/u,"no later responsive rule replaces the explicit wrap contract");
});

for(const locale of ["en","fr","ar","ja"])test("Canvas failure persists through same-scope Worker200 before a newer summary arrives "+locale,async t=>{
  let held;t.after(()=>held?.release());
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,true);storageToastExpires(x);
  held=x.db.holdRequest(request=>request.method==="getAll");
  await x.restore();await held.entered;f.draw();storageInline(x,"failed");
  assert.equal(x.db.values.get(batch.id).events.length,1,"a successful source GET is not a storage durability receipt");
  assert.equal(storageSyncs(x).length,0);
  held.release();for(let turn=0;turn<12;turn++)await x.turn();f.draw();storageInline(x,"failed");
  await storageUnchanged(x,batch,canonical);
});

for(const locale of ["en","fr","ar","ja"])test("Canvas changed expired owner cannot inherit the original storage notice "+locale,async t=>{
  const x=await canvasSourceStoreFixture(t,{locale,shared:true}),{f,h,queue,scope}=x;
  const batch=await queue.enqueueBatch([x.originalInput(0)],scope),canonical=await x.canonical();
  await storageRetire(x,true);storageToastExpires(x);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();storageInline(x,"failed");
  const originalSession=h.store.session.get();
  h.setSession({permissionEpoch:String(originalSession.permissionEpoch)+":withdrawn",projectContext:{...originalSession.projectContext,expiresAt:"2000-01-01T00:00:00.000Z"}});
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),false);
  f.draw();assert.equal(Boolean(storageNode(f)),false);assert.equal(f.renderer.markup.includes(f.i18n.system(storagePaused)),false);
  assert.equal((await queue.summary(scope)).sourcePauseFailed,true);
  assert.equal(x.db.values.get(batch.id).events.length,1,"an unrelated/expired view does not certify erasure");
  h.store.session.set(originalSession);await x.restore();for(let turn=0;turn<8;turn++)await x.turn();f.draw();storageInline(x,"failed");
  await storageUnchanged(x,batch,canonical);
});
