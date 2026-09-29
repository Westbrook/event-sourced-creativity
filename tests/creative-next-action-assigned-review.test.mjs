import assert from "node:assert/strict";
import test,{after} from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, libraryFocusFromRoute, artifactFocusOptionsFromRoute,
  originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
after(()=>{assert.equal(externalCount(),0);globalThis.fetch=originalFetch;});
async function finish(q,pending){
  let done=false,value,error;pending.then(result=>{value=result;done=true;},caught=>{error=caught;done=true;});
  for(let attempt=0;attempt<32&&!done;attempt++){await flushStoreFrames(q.h);await q.f.settle();await new Promise(setImmediate);}
  assert.ok(done,"actual bounded assigned opening completed");if(error)throw error;return value;
}
async function begin(t){
  const q=await assignmentPage(t,"same-document"),{h,f}=q;
  await flushStoreFrames(h);await f.settle();
  const native=installOutputNavigationFocusNative(t,f,ports),route=h.store.route.get(),origin=f.components().find(value=>value.tag==="forma-activity");
  const actions=creativeNextActions(nextActionFacts(h.store,q.targetDocument,null,{lifecycle:true}));
  const action=actions.find(value=>value.target.kind==="assigned-review"&&value.target.reviewId===q.task.id);
  assert.ok(action,"actual current Worker task is offered by the same lifecycle resolver");
  const {openCreativeNextActionDestination}=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  const open=()=>openCreativeNextActionDestination(h.store,native.document,action,{
    origin,originCurrent:()=>origin.isConnected&&h.store.route.get()===route,navigationCurrent:()=>true,
  });
  return{...q,native,route,open};
}
test("actual Worker assigned-review opening joins exactly one real Library viewer and verifies exact revision/hash arrival",async t=>{
  const q=await begin(t);assert.equal(await finish(q,q.open()),true);
  assert.deepEqual(libraryFocusFromRoute(q.h.store.route.get()),{kind:"artifact",id:q.artifactId});
  assert.deepEqual(artifactFocusOptionsFromRoute(q.h.store.route.get()),{expectedRevision:q.task.revision,expectedContentSha256:q.hash,intent:"review"});
  assert.equal(q.viewerCalls.length,1,"public arrival joins the route opening; it never repeats the private read");
  assert.equal(q.viewerCalls[0].result,true);
  assert.ok(q.viewerCalls[0].owner.isConnected);
  assert.equal(q.viewerCalls[0].owner.querySelector(".document-artifact-view")?.open,true);
  assert.match(q.f.tree().root.text,/EXACT_ASSIGNED_B_BODY/);
  const ordinary=q.f.tree().visible("button").find(value=>String(value.attributes.class??"").includes("artifact-viewer-focus-toggle"));
  assert.ok(ordinary);await q.f.act(ordinary);await q.f.settle();
  assert.equal(q.viewerCalls[0].owner.querySelector(".document-artifact-view")?.open,true,"disposing only opening focus must preserve healthy viewer interaction");
});
for(const gesture of["pointerdown","keydown"])test("actual Worker assigned review refuses "+gesture+" while its same existing child opening is pending",async t=>{
  const q=await begin(t),gate=sceneDeferred(),entered=sceneDeferred(),tick=q.f.tick;let held=false;
  t.after(()=>gate.resolve());
  q.f.tick=async owner=>{
    if(!held&&owner?.tag==="forma-document-artifacts"&&q.viewerCalls.length){held=true;entered.resolve();await gate.promise;}
    return tick(owner);
  };
  const pending=q.open();await finish(q,entered.promise);
  q.native.emit(gesture);gate.resolve();
  assert.equal(await finish(q,pending),false);
  assert.equal(q.viewerCalls.length,1);assert.notEqual(q.viewerCalls[0].result,true);
  assert.equal(q.f.tree().visible("dialog").filter(value=>value.port?.open&&String(value.attributes.class??"").includes("document-artifact-view")).length,0);
});
test("a superseded actual Worker task cannot be substituted by another assignment to the same Document",async t=>{
  const q=await begin(t);await q.supersede();await q.h.store.syncReviewInbox();await q.f.settle();
  assert.equal(await finish(q,q.open()),false);
  assert.equal(q.h.store.route.get(),q.route);assert.equal(q.viewerCalls.length,0);
});
