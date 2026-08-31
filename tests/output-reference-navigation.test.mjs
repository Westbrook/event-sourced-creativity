import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { captureOutputNavigation, outputNavigationMatches } from "../src/model/output-navigation.ts";
import { documentIdFromRoute } from "../src/model/routes.ts";

// Actual extracted bridge, full Store/Shell/Deliver/Document/Output classes.
// The non-Canvas caller below is test-only: no seven-consumer wiring is claimed.
// Existing fixture HTTP/domain/native ports are synthetic, not Worker/SQLite,
// browser geometry, provider, paid-authority or accessibility certification.
const test=(name,run)=>nativeTest(name,{timeout:30_000},async t=>{
  try{return await run(t);}catch(error){
    if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");
    throw error;
  }
});
const noCommands=f=>assert.deepEqual(f.storeHost.requests.filter(row=>
  (row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(row)),[],
  "only existing fixture-certified current resume reads, no authoring or Output commands");
const outputFocus=f=>f.trace.filter(value=>/^focus:output-/u.test(value));
const noOpeningListeners=f=>{
  for(const name of["focusin","pointerdown","keydown"])assert.equal(
    (f.listeners.get(name)??[]).filter(listener=>["focusChanged","interrupt"].includes(listener.name)).length,0,
    "opening focus listeners disposed: "+name);
};
async function page(t,options={}){
  const f=await createOutputReachabilityPage(t,{surface:"deliver",...options});
  const previousHistory=globalThis.history,history=[];
  globalThis.history={
    pushState(_state,_unused,url){
      history.push(url);const next=new URL(url,"http://localhost");
      Object.assign(f.storeHost.location,{pathname:next.pathname,search:next.search,hash:next.hash});
    },
    replaceState(_state,_unused,url){this.pushState(_state,_unused,url);},
  };
  t.after(()=>{globalThis.history=previousHistory;noCommands(f);});
  f.native=installOutputNavigationFocusNative(t,f,ports);
  f.bridge=(await ports.loadActual("src/components/output-reference-navigation.ts")).openOutputReferenceDestination;
  assert.equal(typeof f.bridge,"function","the complete actual extracted function is loaded unchanged");
  f.navigationHistory=history;
  f.finish=async()=>{for(let i=0;i<5;i++)await f.settle();};
  return f;
}
function opening(f,{kind="target",section="native"}={}){
  const snapshot=f.outputSnapshot(),authorization=f.store.captureAuthorizationScope(),source=f.store.captureSourceOwnership();
  assert.ok(authorization&&source&&f.store.sourceOwnershipActive(source),"real current Store source owner");
  const id=kind==="target"?snapshot.confirmedPlan.plan.targets[0].id:kind==="requirement"?snapshot.requirements[0].blockId
    :kind==="result"?snapshot.results[0].id:snapshot.grants[0].operations[0].id;
  const reference=captureOutputNavigation(snapshot,authorization.key,kind,id);assert.ok(reference);
  const route=f.store.route.get(),host=f.components().find(value=>value.tag===(route==="/deliver"?"forma-deliver":"forma-workspace"));
  assert.ok(host?.isConnected,"actual original non-Canvas host");
  let retired=false;
  const owner={authorization,
    originCurrent:()=>!retired&&host.isConnected&&f.store.route.get()===route&&f.store.sourceOwnershipActive(source)
      &&f.store.authorizationScopeActive(authorization)
      &&outputNavigationMatches(reference,f.outputSnapshot(reference.documentId),f.store.captureAuthorizationScope()?.key??"")
      &&!f.native.document.querySelector("dialog[open]"),
    navigationCurrent:()=>!retired,
  };
  return {reference,route,host,owner,retire(){retired=true;},
    run:()=>f.bridge(f.store,host.ownerDocument,{reference,section},owner)};
}
async function complete(f,pending){await f.finish();const result=await pending;await f.finish();return result;}

for(const locale of["en","fr","ar","ja"])test("extracted Output destination: non-Canvas "+locale+" exact native target remains inspection only",async t=>{
  const f=await page(t,{locale}),request=opening(f),events=JSON.stringify(f.store.events.get()),snapshot=JSON.stringify(f.outputSnapshot());
  assert.equal(request.route,"/deliver");assert.equal(await complete(f,request.run()),true);
  assert.equal(request.host.isConnected,false,"deliberate origin unmount does not cancel destination ownership");
  assert.equal(documentIdFromRoute(f.store.route.get()),request.reference.documentId);
  assert.ok(f.store.route.get().endsWith("#context="+request.reference.blockId));
  assert.equal(f.native.document.activeElement?.getAttribute?.("data-output-run-target"),request.reference.targetId);
  assert.equal(f.outputControllers().filter(value=>value.surface==="document"&&!value.blockId).length,1);
  assert.equal(JSON.stringify(f.store.events.get()),events);assert.equal(JSON.stringify(f.outputSnapshot()),snapshot);
  assert.ok(outputFocus(f).includes("focus:output-run-target"));noOpeningListeners(f);noCommands(f);
});
for(const kind of["requirement","result","operation"])test("extracted Output destination: non-Canvas exact "+kind+" uses its existing read-only controller",async t=>{
  const f=await page(t,{state:kind==="operation"?"uncertain-receipt":"reviewer",authoredSource:kind==="requirement"}),request=opening(f,{kind,section:"inspect"});
  const events=JSON.stringify(f.store.events.get()),snapshot=JSON.stringify(f.outputSnapshot());
  assert.equal(await complete(f,request.run()),true);
  const marker={requirement:"output-card-host",result:"output-result",operation:"output-operation"}[kind];
  assert.ok(outputFocus(f).includes("focus:"+marker));
  assert.equal(documentIdFromRoute(f.store.route.get()),request.reference.documentId);
  assert.equal(JSON.stringify(f.store.events.get()),events);assert.equal(JSON.stringify(f.outputSnapshot()),snapshot);
  if(kind!=="operation")assert.equal(f.outputSnapshot().permissions.canRequest,false);
  else assert.ok(f.store.documentJobs.get().some(job=>job.jobId===request.reference.jobId));
  noOpeningListeners(f);noCommands(f);
});

for(const change of["caller","route","authority","output-source","focus"])test("extracted Output destination: non-Canvas "+change+" interruption wins at destination frame",async t=>{
  const f=await page(t),request=opening(f),events=JSON.stringify(f.store.events.get()),originalFrame=ports.windowPort.requestAnimationFrame;
  let frame=null,settled=false;
  ports.windowPort.requestAnimationFrame=callback=>{
    if(!frame&&new Error().stack.includes("openOutputReferenceDestination")){frame=callback;return -41;}
    return originalFrame(callback);
  };
  t.after(()=>{ports.windowPort.requestAnimationFrame=originalFrame;if(frame)frame(0);});
  const pending=request.run();void pending.then(()=>{settled=true;},()=>{settled=true;});
  for(let i=0;i<100&&!frame&&!settled;i++)await new Promise(setImmediate);
  assert.equal(typeof frame,"function","actual helper reached its first destination RAF");
  await f.settle();assert.equal(request.host.isConnected,false);
  let field=null;
  if(change==="caller")request.retire(); // Synthetic request-owner control, not a new routed incident.
  else if(change==="route")f.store.route.set("/document/fixture-document-b/synthetic-document-b");
  else if(change==="authority")f.store.session.set({...f.store.session.get(),permissionEpoch:"newer-output-destination"});
  else if(change==="output-source"){f.adapter.publishSourceRevision(request.reference.documentId);await f.store.outputRequirements.ensure(request.reference.documentId,{force:true});}
  else {
    const fields=f.tree().visible("select").filter(node=>node.owner?.tag==="forma-ui-language-picker");
    assert.equal(fields.length,1);field=fields[0].port;f.native.focus(field);
  }
  const route=f.store.route.get(),focusBefore=outputFocus(f).length;
  ports.windowPort.requestAnimationFrame=originalFrame;const resume=frame;frame=null;resume(0);
  assert.equal(await complete(f,pending),false);
  assert.equal(f.store.route.get(),route);assert.equal(outputFocus(f).length,focusBefore);
  assert.equal(JSON.stringify(f.store.events.get()),events);
  if(field)assert.equal(f.native.document.activeElement===field,true);
  noOpeningListeners(f);noCommands(f);
});

test("extracted Output destination: retired original caller cannot initiate a transition",async t=>{
  const f=await page(t),request=opening(f),before=f.navigationHistory.length;
  request.retire();assert.equal(await request.run(),false);await f.finish();
  assert.equal(f.store.route.get(),request.route);assert.equal(f.navigationHistory.length,before);
  assert.equal(outputFocus(f).length,0);noOpeningListeners(f);noCommands(f);
});
test("extracted Output destination: same-Document native editor remains dirty and unfocused by the handoff",async t=>{
  const f=await page(t,{surface:"document"}),card=f.outputCards()[0];
  await f.act(f.find("button",node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit")));
  const field=f.tree().visible("textarea").find(node=>node.owner===card&&node.attributes.name==="originalText");
  assert.ok(field);field.port.value="Keep my original unfinished Output wording";
  await f.act(field,"input");
  const request=opening(f),events=JSON.stringify(f.store.events.get()),focusBefore=outputFocus(f).length;
  assert.equal(await complete(f,request.run()),false,"existing focusOutputReference dirty-form refusal");
  assert.equal(f.outputCards().includes(card),true,"the original keyed editor is not replaced");
  const retained=f.tree().visible("textarea").find(node=>node.owner===card&&node.attributes.name==="originalText");
  assert.equal(retained?.port.value,"Keep my original unfinished Output wording");
  assert.equal(outputFocus(f).length,focusBefore);assert.equal(JSON.stringify(f.store.events.get()),events);
  noOpeningListeners(f);noCommands(f);
});
