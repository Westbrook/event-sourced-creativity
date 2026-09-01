import assert from "node:assert/strict";
import test from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
async function page(t,unknown){
  const f=await createOutputReachabilityPage(t,{state:unknown?"unknown":"confirmed",surface:"deliver",unavailable:unknown,authoredSource:unknown});
  const native=installOutputNavigationFocusNative(t,f,ports),documentId=f.store.projection.get().documentId;
  const authored=unknown?f.store.projection.get().blocks.filter(block=>block.type==="output"&&!block.removed
    &&block.projectId===f.store.projection.get().projectId&&block.documentId===documentId):[];
  if(unknown){
    assert.equal(authored.length,1,"a complete current Source owns one exact authored Output before opening");
    const read=f.store.outputRequirements.resource(documentId);
    assert.equal(read.state,"unavailable");assert.equal(read.snapshot,null);assert.equal(read.errorCode,"output_client_load_failed");
    const source=f.store.events.get().filter(event=>event.type==="BlockCreated"&&event.payload.document_id===documentId
      &&event.payload.block_id===authored[0].id&&event.payload.type==="output");
    assert.equal(source.length,1,"the exact requirement came from the admitted backing Source, not a ready Output snapshot");
    assert.equal(source[0].payload.properties.authority,"authored");
  }
  const previousHistory=globalThis.history;
  globalThis.history={pushState(_state,_title,path){const u=new URL(path,"http://localhost");Object.assign(f.storeHost.location,{pathname:u.pathname,search:u.search,hash:u.hash});},
    replaceState(...args){this.pushState(...args);}};
  t.after(()=>{globalThis.history=previousHistory;});
  const {openCreativeNextActionDestination}=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  const chosen=creativeNextActions(nextActionFacts(f.store,documentId,null,{lifecycle:true}))
    .find(value=>value.target.kind===(unknown?"output-requirement":"canonical-output"));
  assert.ok(chosen,"the actual current facts offer this exact Output continuation");
  if(unknown)assert.equal(chosen.target.blockId,authored[0].id,"the actual resolver chooses the known authored identity, not a first-row fallback");
  const origin=f.components().find(value=>value.tag==="forma-deliver"),route=f.store.route.get(),source=JSON.stringify(f.store.events.get());
  let retained=true;
  const open=()=>openCreativeNextActionDestination(f.store,native.document,chosen,{
    origin,originCurrent:()=>retained&&origin.isConnected&&f.store.route.get()===route,navigationCurrent:()=>retained,
  });
  return{f,native,chosen,source,open,retire:()=>{retained=false;}};
}
async function finish(q,pending){
  let done=false,result,error;pending.then(value=>{done=true;result=value;},value=>{done=true;error=value;});
  for(let at=0;at<32&&!done;at++){await q.f.settle();await new Promise(setImmediate);}
  assert.ok(done,"exact Output opening completed under finite native frames");if(error)throw error;return result;
}
for(const unknown of[false,true])test("actual "+(unknown?"unknown authored":"canonical")+" Output continuation reaches the exact existing controller without execution",async t=>{
  const q=await page(t,unknown),{f,chosen}=q;
  assert.equal(await finish(q,q.open()),true);
  assert.equal(f.store.projection.get().documentId,chosen.target.documentId);
  const controllers=f.outputControllers().filter(value=>value.isConnected&&value.documentId===chosen.target.documentId
    &&value.blockId===(unknown?chosen.target.blockId:chosen.target.reference.kind==="requirement"?chosen.target.reference.blockId:""));
  assert.equal(controllers.length,1);
  assert.ok(q.native.document.activeElement&&controllers[0].contains(q.native.document.activeElement),"the actual exact controller owns the revealed native node");
  assert.equal(JSON.stringify(f.store.events.get()),q.source);
  assert.deepEqual(f.storeHost.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(row)),[]);
});
for(const unknown of[false,true])test("actual "+(unknown?"unknown authored":"canonical")+" Output opening refuses a newer gesture without alternative target",async t=>{
  const q=await page(t,unknown),pending=q.open();q.native.emit("pointerdown");q.retire();
  assert.equal(await finish(q,pending),false);
  assert.equal(JSON.stringify(q.f.store.events.get()),q.source);
  assert.deepEqual(q.f.storeHost.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!q.f.isReadOnlyResume(row)),[]);
});
