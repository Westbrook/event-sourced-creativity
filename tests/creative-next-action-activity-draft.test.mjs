import assert from "node:assert/strict";
import test,{after} from "node:test";
import { assignmentPage, flushStoreFrames,
  originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
after(()=>{assert.equal(externalCount(),0);globalThis.fetch=originalFetch;});
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

test("Activity's actual inline review draft refuses a lifecycle departure without losing its owner",async t=>{
  const q=await begin(t),panel=q.f.components().find(value=>value.tag==="forma-activity-issue-panel"&&value.review?.id===q.task.id);
  assert.ok(panel);assert.equal(panel.navigationBlocked,false);
  const input=q.f.tree().visible("textarea").find(value=>value.owner===panel);assert.ok(input);
  input.port.value="Original unsent review correction";await q.f.act(input,"input");
  assert.equal(panel.navigationBlocked,true);
  const card=q.f.tree().visible("button").find(value=>value.attributes["data-choice-value"]==="assigned-review"&&value.text.includes(q.task.artifactTitle));assert.ok(card);
  card.handlers.click.call(card.owner,{target:card.port,currentTarget:card.port,preventDefault(){},stopPropagation(){}});
  await q.f.settle();
  assert.equal(q.h.store.route.get(),q.route);assert.equal(q.viewerCalls.length,0);assert.ok(panel.isConnected);
  assert.equal(q.f.renderer.ownNodes(panel,"textarea")[0]?.value,"Original unsent review correction");
});
