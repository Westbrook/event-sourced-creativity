import test from "node:test";
import assert from "node:assert/strict";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// Conditional D2 full-class controls, using the existing finite HTTP/native port.
// No private setter, fabricated saved snapshot, or native-browser claim.
async function fixture(t){
 const f=await createOutputReachabilityPage(t,{unavailable:true});
 f.native=installOutputNavigationFocusNative(t,f,ports);
 f.controller=f.outputControllers().find(value=>!value.blockId&&value.documentId===FIXTURE_DOCUMENT_IDS[0]);assert.ok(f.controller);
 const {captureOutputNavigationFocus}=await ports.loadActual("src/components/output-navigation-focus.ts");
 f.focus=()=>captureOutputNavigationFocus(f.controller.ownerDocument);
 f.input={recipeId:"campaign",originalText:"Keep this unsaved original campaign direction",selectedChoices:["campaign-image"]};
 f.source={projectId:f.store.projection.get().projectId,documentId:f.controller.documentId,
  actorUserId:f.store.session.get().user.userId,authorizationScopeKey:f.store.captureAuthorizationScope().key,head:f.store.head.get()};
 return f;
}
test("Output local navigation blocker includes D2 collapsed raw input without a staged card or ready snapshot",async t=>{
 const f=await fixture(t),controller=f.controller,focus=f.focus();
 assert.equal(controller.navigationBlocked,false);
 assert.equal(controller.commandDepartureBlocked,false);
 assert.equal(await controller.receiveIntakeRecipe(f.input,f.source,{current:()=>true,opener:null,focus}),"retained");await f.settle();
 const details=f.tree().nodes.find(node=>node.owner===controller&&node.tag==="details"&&node.attributes.class==="output-recipe-entry");assert.ok(details);
 details.port.open=false;await f.act(details,"toggle");
 const before=f.storeHost.requests.length,field=controller.querySelector(".output-recipe-entry textarea");
 assert.equal(field?.value,f.input.originalText);assert.equal(f.store.outputRequirements.resource(controller.documentId).snapshot,null);
 assert.equal(controller.navigationBlocked,true);assert.equal(f.storeHost.requests.length,before);assert.equal(field.value,f.input.originalText);
 assert.equal(controller.commandDepartureBlocked,true,"The existing departure boundary retains this same collapsed raw recipe");
});
test("Output local navigation blocker includes incoming D2 ownership before the first render",async t=>{
 const f=await fixture(t),controller=f.controller,focus=f.focus(),gate=sceneDeferred();focus.dispose();let entered=false;
 const beforeMarkup=controller.markup;
 f.storeHost.intercept=request=>request.url.startsWith("/api/output-requirements?")?(entered=true,gate.promise):undefined;
 const receiving=controller.receiveIntakeRecipe(f.input,f.source,{current:()=>true,opener:null,focus});
 try{
  await untilScene(()=>entered,"actual public transfer reaches its held finite read");
  assert.equal(controller.markup,beforeMarkup,"explicit synthetic pre-render scheduling boundary");
  assert.equal(controller.querySelector(".output-recipe-entry textarea"),null);
  const before=f.storeHost.requests.length;assert.equal(controller.navigationBlocked,true);assert.equal(f.storeHost.requests.length,before);
  assert.equal(controller.commandDepartureBlocked,true,"Incoming recipe ownership blocks departure before its first render");
 }finally{gate.resolve(Response.json({error:"still_unavailable"},{status:503}));assert.equal(await receiving,"retained");}
 await f.settle();assert.equal(controller.navigationBlocked,true);
 assert.equal(controller.commandDepartureBlocked,true);
 assert.equal(controller.querySelector(".output-recipe-entry textarea")?.value,f.input.originalText);
});
