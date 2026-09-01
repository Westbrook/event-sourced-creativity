import test from "node:test";
import assert from "node:assert/strict";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// Complete actual controller/card/client with finite HTTP/domain/native ports.
// These tests certify no server authority, provider behavior, or browser layout.
const whole=f=>f.outputControllers().find(value=>!value.blockId&&value.documentId===FIXTURE_DOCUMENT_IDS[0]);
const ownButton=(f,owner,key)=>f.find("button",node=>node.owner===owner&&node.text===f.i18n.t(key));
const outputRead=request=>request.url.startsWith("/api/output-requirements?")&&(request.init.method??"GET")==="GET";

for(const unavailable of[false,true])test("Output local navigation blocker is false for a quiet "+(unavailable?"unknown":"ready")+" snapshot",async t=>{
 const f=await createOutputReachabilityPage(t,{unavailable}),controller=whole(f);assert.ok(controller);
 const before=f.storeHost.requests.length,snapshot=f.outputSnapshot();
 assert.equal(controller.navigationBlocked,false);assert.equal(controller.navigationBlocked,false);
 assert.equal(f.storeHost.requests.length,before);assert.equal(f.outputSnapshot(),snapshot);
});

test("Output local navigation blocker reads the actual open and dirty native card, not a DOM form guess",async t=>{
 const f=await createOutputReachabilityPage(t),card=f.outputCards()[0],controller=card.closest("forma-output-requirements");
 assert.ok(controller);assert.equal(card.hasOpenDraft,false);assert.equal(controller.navigationBlocked,false);
 const before=f.storeHost.requests.length;
 await f.act(ownButton(f,card,"output.requirement.edit"));
 assert.equal(card.hasOpenDraft,true);assert.equal(controller.navigationBlocked,true,"an untouched but open editor is protected");
 const field=f.tree().visible("textarea").find(node=>node.owner===card&&node.attributes.name==="originalText");assert.ok(field);
 field.port.value="Keep this original local Output wording";await f.act(field,"input");
 assert.equal(controller.navigationBlocked,true);assert.equal(field.port.value,"Keep this original local Output wording");
 await f.act(ownButton(f,card,"output.requirement.cancel"));assert.equal(controller.navigationBlocked,true);
 await f.act(ownButton(f,card,"output.requirement.discard"));
 assert.equal(card.hasOpenDraft,false);assert.equal(controller.navigationBlocked,false);
 assert.equal(f.storeHost.requests.length,before,"reading the predicate and local draft controls send no command");
});

test("Output local navigation blocker protects an explicit plan review until its ordinary Cancel",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"unconfirmed"}),controller=whole(f),before=f.storeHost.requests.length;
 assert.equal(controller.navigationBlocked,false);await f.act(ownButton(f,controller,"output.delivery.reviewPlan"));
 assert.equal(controller.navigationBlocked,true);
 await f.act(ownButton(f,controller,"output.delivery.cancel"));assert.equal(controller.navigationBlocked,false);
 assert.equal(f.storeHost.requests.length,before);
});

test("Output automatic snapshot loading does not become an unsaved-work blocker",async t=>{
 const f=await createOutputReachabilityPage(t,{unavailable:true}),controller=whole(f),gate=sceneDeferred();let entered=false;
 f.storeHost.intercept=request=>{if(outputRead(request)){entered=true;return gate.promise;}};
 const reading=f.act(ownButton(f,controller,"output.delivery.refresh"));
 try{
  await untilScene(()=>entered,"actual controller Refresh enters the finite read hold");
  const before=f.storeHost.requests.length;
  assert.equal(f.store.outputRequirements.resource(controller.documentId).state,"loading");
  assert.equal(controller.navigationBlocked,false);assert.equal(f.storeHost.requests.length,before);
 }finally{gate.resolve(Response.json({error:"still_unavailable"},{status:503}));await reading;}
 assert.equal(controller.navigationBlocked,false);
});

test("Output exact source-index refresh loading does not become an unsaved-work blocker",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"reviewer"}),controller=whole(f),gate=sceneDeferred();
 f.storeHost.intercept=request=>outputRead(request)?Response.json({error:"output_target_source_projection_stale"},{status:409}):undefined;
 await f.store.outputRequirements.ensure(controller.documentId,{force:true});await f.settle();
 const button=f.find("button",node=>node.owner===controller&&Object.hasOwn(node.attributes,"data-output-source-refresh"));assert.ok(button);
 let entered=false;f.storeHost.intercept=request=>{
  if(/^\/api\/workspaces\/[^/]+\/projects\/[^/]+\/events\?/u.test(request.url)){entered=true;return gate.promise;}
 };
 const reading=f.act(button);
 try{
  await untilScene(()=>entered,"existing exact source refresh enters its finite read hold");
  const before=f.storeHost.requests.length;assert.equal(controller.navigationBlocked,false);
  assert.equal(f.storeHost.requests.length,before);
 }finally{gate.resolve(Response.json({events:[],head:f.store.head.get()}));await reading;}
 assert.equal(controller.navigationBlocked,false);
});

test("Output local navigation blocker preserves pending and uncertain original free confirmation",async t=>{
 const f=await createOutputReachabilityPage(t),controller=whole(f),gate=sceneDeferred(),fetchFixture=f.adapter.fetch;let entered=false;
 await f.act(ownButton(f,controller,"output.delivery.reviewPlan"));
 f.adapter.fetch=async(path,init={})=>{
  const response=await fetchFixture(path,init);
  if(init.method==="POST"&&JSON.parse(init.body).action==="confirm"){
   assert.equal(response.ok,true,"actual finite domain confirmation before lost acknowledgment");entered=true;
   await gate.promise;throw new Error("Finite original confirmation acknowledgment lost");
  }
  return response;
 };
 const form=f.tree().visible("form").find(node=>{
  if(node.owner!==controller)return false;
  for(let parent=node;parent;parent=parent.parent)if(String(parent.attributes?.class??"").split(/\s+/u).includes("output-plan-review"))return true;
  return false;
 });
 assert.ok(form);const sending=f.act(form,"submit");
 try{
  await untilScene(()=>entered,"actual original free confirmation reaches the delivery hold");
  assert.ok(f.store.outputRequirements.retainedWrite(controller.documentId));assert.equal(controller.navigationBlocked,true);
 }finally{gate.resolve();await sending;}
 const before=f.storeHost.requests.length,write=JSON.stringify(f.store.outputRequirements.retainedWrite(controller.documentId));
 assert.ok(write&&write!=="null");assert.equal(controller.navigationBlocked,true);
 assert.equal(JSON.stringify(f.store.outputRequirements.retainedWrite(controller.documentId)),write);
 assert.equal(f.storeHost.requests.length,before);assert.equal(f.outputRequests.filter(row=>row.method==="POST"&&!f.isReadOnlyResume(row)).length,1);
});
