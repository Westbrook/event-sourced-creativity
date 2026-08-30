import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { captureOutputNavigation, outputNavigationMatches } from "../src/model/output-navigation.ts";
import { projectOutcomeDesk, outcomeDeskActions } from "../src/model/outcome-desk.ts";
import { outcomeDeskHostActions, outcomeDeskHostActionAvailable, outcomeDeskPreparationActions } from "../src/canvas/outcome-desk-host.ts";
import { nextActionFacts } from "../src/state/next-action-context.ts";
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
function currentInput(f){
 const documentId=f.outputSnapshot().documentId,scope=f.store.captureAuthorizationScope(),session=f.store.session.get();
 return{facts:nextActionFacts(f.store,documentId),document:f.store.projection.get().documents.find(row=>row.id===documentId),
  output:{authorizationScopeKey:scope.key,actorUserId:session.user.userId,projectAccessId:session.projectContext?.projectAccessId??null,
    resource:f.store.outputRequirements.resource(documentId),jobs:f.store.documentJobs.get()}};
}
const ports=f=>({localize:(id,fallback)=>f.i18n.t(id,fallback),delivery:()=>{throw new Error("Canonical Output cannot use legacy artifact delivery");}});
for(const locale of ["en","fr","ar","ja"])test("Desk exact current target opens its existing Output owner in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{locale}),input=currentInput(f),snapshot=f.outputSnapshot(),target=snapshot.confirmedPlan.plan.targets[0];
 const rows=projectOutcomeDesk(input).rows,row=rows.find(row=>row.object.kind==="target"&&row.reference.id===target.id);
 assert.equal(row.object.value,target);
 const actions=outcomeDeskHostActions(input,row.key,ports(f));assert.ok(actions.length);assert.ok(actions.every(action=>action.target.kind==="canonical-output"));
 const controller=f.outputControllers().find(value=>value.documentId===snapshot.documentId&&!value.blockId);
 const before=JSON.stringify(f.adapter.snapshot(snapshot.documentId)),events=JSON.stringify(f.store.events.get()),requests=f.outputRequests.filter(row=>row.method!=="GET"&&!f.isReadOnlyResume(row)).length;
 const ref=captureOutputNavigation(snapshot,f.store.captureAuthorizationScope().key,"target",target.id);

 assert.equal(await controller.focusOutputReference(ref,{current:()=>true}),true);
 assert.equal(JSON.stringify(f.adapter.snapshot(snapshot.documentId)),before);assert.equal(JSON.stringify(f.store.events.get()),events);
 assert.equal(f.outputRequests.filter(row=>row.method!=="GET"&&!f.isReadOnlyResume(row)).length,requests);
});

const noCommands=f=>assert.deepEqual(f.outputRequests.filter(row=>row.method!=="GET"&&!f.isReadOnlyResume(row)),[]);
const controllerFor=f=>f.outputControllers().find(value=>value.documentId===f.outputSnapshot().documentId&&!value.blockId);
const currentReference=(f,kind,id)=>captureOutputNavigation(f.outputSnapshot(),f.store.captureAuthorizationScope().key,kind,id);
const targetRow=f=>projectOutcomeDesk(currentInput(f)).rows.find(row=>row.object.kind==="target");
const pause=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function scenario(f,name){const doc=f.outputSnapshot().documentId;f.adapter.seed(doc,name);await f.store.outputRequirements.ensure(doc,{force:true});await f.settle();}
for(const field of ["authorizationScopeKey","documentId","projectId","actorUserId","projectAccessId","revision","sourceRevision","requirementRevision","blockId","planRevisionId","targetId","targetContractDigest","resultId","resultRevision","assetId","assetSha256","grantId","operationId","jobId"])
test("exact Output navigation rejects changed "+field,async t=>{
 const f=await createOutputReachabilityPage(t),row=targetRow(f),controller=controllerFor(f),reference={...row.navigation,[field]:"not-original"};
 const before=f.trace.length;
 assert.equal(await controller.focusOutputReference(reference,{current:()=>true}),false);
 assert.deepEqual(f.trace.slice(before).filter(value=>value.startsWith("focus:")),[]);noCommands(f);
});
test("Output Desk keeps filtered required and unresolved obligations; no first-object selection",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"multi-target"}),input=currentInput(f),snapshot=f.outputSnapshot(),desk=projectOutcomeDesk(input);
 assert.equal(desk.selected,null);
 assert.equal(desk.rows.filter(row=>row.object.kind==="target").length,snapshot.confirmedPlan.plan.targets.length);
 assert.ok(desk.rows.some(row=>row.object.kind==="target"&&row.object.value.required&&!row.object.value.selected));
 assert.equal(projectOutcomeDesk(input,"target:not-present").selected,null);
 const requiredBefore=snapshot.summary.required_obligations;
 for(const row of desk.rows.filter(row=>row.object.kind==="target")){
  const actions=outcomeDeskHostActions(input,row.key,ports(f)),visible=outcomeDeskActions(row,actions,input,action=>outcomeDeskHostActionAvailable(action,input,ports(f)));
  assert.ok(visible.alternatives.length<=2);
  assert.deepEqual(outcomeDeskPreparationActions(input,row.key,ports(f)),[],"canonical targets never enter legacy format configuration");
 }
 assert.equal(f.outputSnapshot().summary.required_obligations,requiredBefore);noCommands(f);
});
test("owned-file source limit four remains usable when native limit one blocks a second source",async t=>{
 const f=await createOutputReachabilityPage(t);await scenario(f,"source-native-capacity");
 const input=currentInput(f),row=targetRow(f),actions=outcomeDeskHostActions(input,row.key,ports(f)),snapshot=f.outputSnapshot();
 assert.equal(snapshot.sourceVerification.capacity.nativeLimit,1);assert.equal(snapshot.sourceVerification.capacity.ownedReadLimit,4);
 assert.ok(snapshot.sourceVerification.capacity.distinctObjectCount>1);
 assert.equal(actions.some(action=>action.target.section==="native"),false);
 const owned=actions.find(action=>action.target.section==="owned");assert.ok(owned);
 assert.equal(await controllerFor(f).focusOutputReference(owned.target.reference,{section:"owned",current:()=>true}),true);
 noCommands(f);
});
test("independent contributor has inspection but never receives an exact-review next action",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"reviewer"});await scenario(f,"review-only-contributor");
 const input=currentInput(f),results=projectOutcomeDesk(input).rows.filter(row=>row.object.kind==="result");
 assert.ok(results.length);
 for(const row of results){const actions=outcomeDeskHostActions(input,row.key,ports(f));assert.ok(actions.length);assert.ok(actions.every(action=>!action.key.includes("actionReview")));}
 noCommands(f);
});
test("eligible independent reviewer opens exact result without author or generation permission",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"reviewer"}),input=currentInput(f),snapshot=f.outputSnapshot();
 assert.equal(snapshot.permissions.canAuthor,false);assert.equal(snapshot.permissions.canRequest,false);
 const row=projectOutcomeDesk(input).rows.find(row=>row.object.kind==="result"),actions=outcomeDeskHostActions(input,row.key,ports(f));
 assert.ok(actions[0].key.includes("actionReview"));
 assert.equal(await controllerFor(f).focusOutputReference(actions[0].target.reference,{current:()=>true}),true);noCommands(f);
});
test("refreshing retains only opaque original operation navigation, never stale private names or new work",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"uncertain-receipt"}),input=currentInput(f),row=projectOutcomeDesk(input).rows.find(row=>row.object.kind==="operation");
 assert.ok(row);
 f.adapter.armHold("read");const pending=f.store.outputRequirements.ensure(input.facts.documentId,{force:true});
 for(let n=0;n<20&&!f.adapter.heldAction;n++)await pause();assert.ok(f.adapter.heldAction);
 const refreshing=currentInput(f),rows=projectOutcomeDesk(refreshing).rows.filter(row=>row.navigation);
 assert.ok(rows.length);assert.ok(rows.every(row=>row.object.kind==="operation"&&row.retained));
 const retained=rows.find(value=>value.reference.id===row.reference.id);
 assert.ok(outcomeDeskHostActions(refreshing,retained.key,ports(f)).every(action=>action.target.refresh));
 assert.equal(await controllerFor(f).focusOutputReference(row.navigation,{current:()=>true}),false);
 f.adapter.release();await pending;await f.settle();
 assert.ok(projectOutcomeDesk(currentInput(f),row.key).selected);noCommands(f);
});
for(const change of ["route-owner","authority","source","plan","newer-focus"])
test("awaited exact Output focus cannot survive "+change,async t=>{
 const f=await createOutputReachabilityPage(t),controller=controllerFor(f),row=targetRow(f),gate=deferred(),tick=f.tick;
 let waiting=false,owns=true;f.tick=async owner=>{if(owner===controller&&!waiting){waiting=true;await gate.promise;}return tick(owner);};
 const before=f.trace.length,pending=controller.focusOutputReference(row.navigation,{current:()=>owns});assert.equal(waiting,true);
 if(change==="route-owner")owns=false;
 else if(change==="authority"){const session=f.store.session.get();f.store.session.set({...session,permissionEpoch:"changed-epoch"});}
 else if(change==="source"){f.adapter.publishSourceRevision(row.reference.documentId);await f.store.outputRequirements.ensure(row.reference.documentId,{force:true});}
 else if(change==="plan"){f.adapter.seed(row.reference.documentId,"draft");await f.store.outputRequirements.ensure(row.reference.documentId,{force:true});}
 else assert.equal(await controller.focusOutputReference(row.navigation,{current:()=>true}),true);
 const newerFocus=f.trace.slice(before).filter(value=>value.startsWith("focus:")).length;
 gate.resolve();assert.equal(await pending,false);
 assert.equal(f.trace.slice(before).filter(value=>value.startsWith("focus:")).length,newerFocus);noCommands(f);
});
test("ready unknown source only offers exact inspection, not native or owned preparation",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"unknown"}),input=currentInput(f),row=targetRow(f);
 const actions=outcomeDeskHostActions(input,row.key,ports(f));
 assert.ok(actions.length);assert.ok(actions.every(action=>action.target.section==="inspect"));noCommands(f);
});
test("duplicate exact target IDs and changed result bytes never choose whichever appears first",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"reviewer"}),snapshot=f.outputSnapshot(),scope=f.store.captureAuthorizationScope().key;
 const target=snapshot.confirmedPlan.plan.targets[0],ref=captureOutputNavigation(snapshot,scope,"target",target.id);
 const ambiguous=structuredClone(snapshot);ambiguous.confirmedPlan.plan.targets.push(structuredClone(target));
 assert.equal(captureOutputNavigation(ambiguous,scope,"target",target.id),null);assert.equal(outputNavigationMatches(ref,ambiguous,scope),false);
 const result=snapshot.results[0],resultRef=captureOutputNavigation(snapshot,scope,"result",result.id),changed=structuredClone(snapshot);
 changed.assets.find(asset=>asset.id===result.assetId).sha256="f".repeat(64);
 assert.equal(outputNavigationMatches(resultRef,changed,scope),false);noCommands(f);
});

test("existing Workspace panel-only opening preserves its pending manual draft",async t=>{
 const f=await createOutputReachabilityPage(t),workspace=f.components().find(value=>value.tag==="forma-workspace"),snapshot=f.outputSnapshot();
 assert.ok(workspace);const before=JSON.stringify(f.store.events.get());
 assert.equal(workspace.revealOutputNavigation(snapshot.documentId,()=>false),false);
 assert.equal(workspace.revealOutputNavigation("other-document",()=>true),false);
 assert.equal(workspace.revealOutputNavigation(snapshot.documentId,()=>true),true);
 workspace.openContextComposer();await f.settle();
 const markup=f.renderer.markup;
 assert.equal(workspace.revealOutputNavigation(snapshot.documentId,()=>true),false);
 assert.equal(f.renderer.markup,markup,"the same draft/dialog is retained");assert.equal(JSON.stringify(f.store.events.get()),before);noCommands(f);
});
test("existing open plan review cannot be replaced by a Desk focus handoff",async t=>{
 const f=await createOutputReachabilityPage(t),controller=controllerFor(f),row=targetRow(f);
 const review=f.tree().visible("button").find(node=>node.owner===controller&&node.text===f.i18n.t("output.delivery.reviewPlan"));
 assert.ok(review);await f.act(review);
 const before=f.trace.length,markup=f.renderer.markup;
 assert.equal(await controller.focusOutputReference(row.navigation,{current:()=>true}),false);
 assert.equal(f.renderer.markup,markup);
 assert.deepEqual(f.trace.slice(before).filter(value=>value.startsWith("focus:")),[]);noCommands(f);
});

for(const kind of ["requirement","operation","result"])test("original "+kind+" reference focuses the exact existing node without activation",async t=>{
 const f=await createOutputReachabilityPage(t,{state:kind==="operation"?"uncertain-receipt":"reviewer"}),snapshot=f.outputSnapshot();
 const value=kind==="requirement"?snapshot.requirements[0].blockId:kind==="operation"?snapshot.grants[0].operations[0].id:snapshot.results[0].id;
 const ref=currentReference(f,kind,value),controller=kind==="requirement"?f.outputControllers().find(candidate=>candidate.blockId===value):controllerFor(f);
 assert.ok(ref);const before=f.trace.length;assert.equal(await controller.focusOutputReference(ref,{current:()=>true}),true);
 const expected=kind==="requirement"?"output-card-host":kind==="operation"?"output-operation":"output-result";
 assert.ok(f.trace.slice(before).includes("focus:"+expected));noCommands(f);
});
test("historical operation reveals only the hidden Write panel and never substitutes a current block",async t=>{
 const f=await createOutputReachabilityPage(t,{state:"uncertain-receipt"}),controller=controllerFor(f),snapshot=f.outputSnapshot(),operation=snapshot.grants[0].operations[0];
 // Explicitly confirm a new free plan through the actual existing controller.
 // The historical operation still belongs to its original retained grant.
 const originalPlan=snapshot.grants[0].planRevisionId;
 await f.act(f.find("button",node=>node.owner===controller&&node.text===f.i18n.t("output.delivery.reviewPlan")));
 await f.act(f.find("form",node=>{if(node.owner!==controller)return false;for(let parent=node.parent;parent;parent=parent.parent)if(String(parent.attributes.class??"").split(/\\s+/u).includes("output-plan-review"))return true;return false;}),"submit");
 assert.notEqual(f.outputSnapshot().confirmedPlan.revisionId,originalPlan);
 const commandCount=f.outputRequests.filter(row=>row.method!=="GET"&&!f.isReadOnlyResume(row)).length;assert.equal(commandCount,1);
 const ref=currentReference(f,"operation",operation.id),originalControllers=[...f.outputControllers()];
 assert.equal(ref.planRevisionId,originalPlan);assert.equal(ref.blockId,null,"old operation cannot target the new current requirement");
 const resultTab=f.tree().visible("button").find(node=>node.attributes["data-workbench-pane"]==="result");assert.ok(resultTab);await f.act(resultTab);
 // Native closest/hidden are fixture DOM ports. Derive them from the emitted
 // actual ancestor tree; no production handoff method or authority is replaced.
 const originalClosest=controller.closest.bind(controller);
 controller.closest=selector=>{
  if(selector==="forma-workspace")return f.components().find(component=>component.tag==="forma-workspace");
  if(selector!=="#document-context-panel")return originalClosest(selector);
  let node=f.tree().nodes.find(node=>node.component===controller);
  while(node&&node.attributes.id!=="document-context-panel")node=node.parent;
  if(!node?.port)return null;
  Object.defineProperty(node.port,"hidden",{configurable:true,get:()=>Object.hasOwn(node.port.attributes,"hidden")});
  return node.port;
 };
 assert.equal(controller.closest("#document-context-panel").hidden,true);
 const before=f.trace.length,events=JSON.stringify(f.store.events.get());
 assert.equal(await controller.focusOutputReference(ref,{current:()=>true}),true);
 assert.equal(controller.closest("#document-context-panel").hidden,false);
 assert.ok(f.trace.slice(before).includes("focus:output-operation"));assert.equal(f.store.ui.focusBlockId??"","");
 assert.deepEqual(f.outputControllers(),originalControllers);assert.equal(JSON.stringify(f.store.events.get()),events);
 assert.equal(f.outputRequests.filter(row=>row.method!=="GET"&&!f.isReadOnlyResume(row)).length,commandCount,"navigation adds no command to the earlier explicit free confirmation");
});
test("retained canonical Output read cannot become actionable with malformed identity data",async t=>{
 const f=await createOutputReachabilityPage(t),input=currentInput(f);
 for(const mutate of [
  snapshot=>snapshot.grants.push(null),
  snapshot=>snapshot.confirmedPlan.plan.targets.push(null),
  snapshot=>snapshot.assets.push({id:"broken"}),
  snapshot=>snapshot.sourceRevision=null,
  snapshot=>snapshot.permissions=null,
  snapshot=>snapshot.capabilities=null,
  snapshot=>snapshot.targetStates.push(structuredClone(snapshot.targetStates[0])),
  snapshot=>snapshot.capabilities.limitationCodes=["valid",null],
 ]){
  const snapshot=structuredClone(f.outputSnapshot());mutate(snapshot);
  const current={...input,output:{...input.output,resource:{state:"ready",snapshot,error:null}}};
  assert.deepEqual(projectOutcomeDesk(current).rows.filter(row=>row.navigation),[]);
 }
 noCommands(f);
});
test("current canonical acceptance is inspected before any new preparation",async t=>{
 const f=await createOutputReachabilityPage(t);await scenario(f,"accepted-file");
 const input=currentInput(f),row=targetRow(f),actions=outcomeDeskHostActions(input,row.key,ports(f));
 assert.equal(actions[0].target.reference.kind,"result");assert.ok(actions[0].key.includes("actionDownload"));
 assert.equal(await controllerFor(f).focusOutputReference(actions[0].target.reference,{current:()=>true}),true);noCommands(f);
});


test("an already staged owned file remains in its original Output controller without focus theft",async t=>{
 const f=await createOutputReachabilityPage(t),controller=controllerFor(f),row=targetRow(f),file=f.adapter.sampleFile();
 const input=f.find("input",node=>node.owner===controller&&node.attributes.type==="file");input.port.files=[file];
 await f.act(input,"change");
 const before=f.trace.length,markup=f.renderer.markup;
 assert.equal(await controller.focusOutputReference(row.navigation,{section:"owned",current:()=>true}),false);
 assert.equal(f.renderer.markup,markup);assert.deepEqual(f.trace.slice(before).filter(value=>value.startsWith("focus:")),[]);
 assert.ok(f.tree().nodes.some(node=>node.text===file.name));noCommands(f);
});
test("native unavailable media never uses a new-generation fallback instead of owned-file navigation",async t=>{
 const f=await createOutputReachabilityPage(t),base=currentInput(f),original=f.outputSnapshot();
 // Read-projection variants exercise the host's supported-format boundary only;
 // they are not a server/source/price or media-usability certificate.
 for(const medium of["audio","video","document"]){
  const snapshot=structuredClone(original),target=snapshot.confirmedPlan.plan.targets[0];target.media_kind=medium;
  snapshot.targetStates[0].capability="unsupported";
  const input={...base,output:{...base.output,resource:{state:"ready",snapshot,error:null}}},row=projectOutcomeDesk(input).rows.find(value=>value.object.kind==="target");
  const actions=outcomeDeskHostActions(input,row.key,ports(f));
  assert.equal(actions[0].target.section,"owned");assert.equal(actions.some(action=>action.target.section==="native"),false);
 }
 noCommands(f);
});
