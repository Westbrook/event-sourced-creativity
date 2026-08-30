import assert from "node:assert/strict";import test from "node:test";
import{receiptFixture,unchanged,close,documentPort,turn,event,ITEM}from"./helpers/canvas-receipt-result-navigation-host.mjs";
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
for(const change of ["none","route-ABA-no-render","selection-ABA-no-render"])test(change+" before pending handoff render",async()=>{
 const h=await receiptFixture("en"),{f}=h,gate=deferred(),tick=f.tick;
 f.tick=owner=>{const rendered=tick(owner);return owner===f.host?rendered.then(()=>gate.promise):rendered};
 try{
  h.button.focus();h.button.handlers.click.call(f.host,event(h.button));await turn();
  assert.equal(f.proposalReview.receipt===h.receipt,true);
  const route=f.store.route.get(),count=()=>f.trace.filter(s=>s.startsWith("focus:")).length;
  if(change==="route-ABA-no-render"){f.store.setRoute("/canvas/board-a/board-a?view=list");documentPort.emit("forma-route-changed",null,{detail:{path:f.store.route.get()}});f.store.setRoute(route);documentPort.emit("forma-route-changed",null,{detail:{path:route}});}
  if(change==="selection-ABA-no-render"){const doc=f.native("article",n=>n.attributes["data-canvas-item-id"]==="item-document-0"),result=f.host.querySelector('[data-canvas-item-id="'+ITEM+'"]');doc.handlers.click.call(f.host,event(doc));result.handlers.click.call(f.host,event(result));}
  const before=count();gate.resolve(true);await turn();assert.equal(count()-before,change==="none"?1:0);
  unchanged(h);
 }finally{f.tick=tick;gate.resolve(true);await turn();close(h)}
});
