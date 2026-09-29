import assert from "node:assert/strict";
import nativeTest from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

// Full current controller/Store/Shell and finite HTTP/domain/native ports for
// presentation tests. The separately labeled final Source denial uses the
// existing actual RAM Worker fixture, not a substituted successful response.
const test=(name,run)=>nativeTest(name,{timeout:30_000},async t=>{
  try{return await run(t);}catch(error){
    if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");
    throw error;
  }
});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const outputRead=request=>request.url.startsWith("/api/output-requirements?")&&(request.init.method??"GET")==="GET";
const sourceRead=request=>/^\/api\/workspaces\/[^/]+\/projects\/[^/]+\/events\?/u.test(request.url);
const noCommands=f=>assert.deepEqual(f.storeHost.requests.filter(request=>
  (request.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(request)),[]);
const focusCount=f=>f.native.nativeFocus.length;
const noOpeningListeners=f=>{
  for(const name of["focusin","pointerdown","keydown"])assert.equal(
    (f.listeners.get(name)??[]).filter(listener=>["focusChanged","interrupt"].includes(listener.name)).length,0);
};
async function page(t,options={}){
  const f=await createOutputReachabilityPage(t,{unavailable:true,...options});
  f.native=installOutputNavigationFocusNative(t,f,ports);
  const projection=f.store.projection.get(),blocks=projection.blocks.filter(block=>block.type==="output"&&!block.removed);
  assert.equal(blocks.length,1,"one exact authored Output in the current Document");
  f.target={projectId:projection.projectId,documentId:projection.documentId,blockId:blocks[0].id};
  const controllers=f.outputControllers().filter(controller=>controller.documentId===f.target.documentId&&controller.blockId===f.target.blockId);
  assert.equal(controllers.length,1);f.controller=controllers[0];
  f.resource=()=>f.store.outputRequirements.resource(f.target.documentId);
  f.own=(tag)=>f.tree().visible(tag).filter(node=>node.owner===f.controller);
  f.refresh=()=>f.own("button").find(node=>node.text===f.i18n.t("output.delivery.refresh"));
  f.finish=async()=>{for(let i=0;i<3;i++)await f.settle();};
  t.after(()=>noCommands(f));return f;
}
function capture(f){
  const source=f.store.captureSourceOwnership(),authorization=f.store.captureAuthorizationScope(),route=f.store.route.get();
  assert.ok(source&&authorization&&f.store.sourceOwnershipActive(source));let owned=true;
  const current=()=>owned&&f.store.route.get()===route&&f.store.sourceOwnershipActive(source)&&f.store.authorizationScopeActive(authorization);
  return {source,route,current,retire(){owned=false;},run:()=>f.controller.revealAuthoredRequirement(f.target,{current})};
}
async function failOutput(f,code,status){
  f.storeHost.intercept=request=>outputRead(request)?Response.json({error:code},{status}):undefined;
  await f.store.outputRequirements.ensure(f.target.documentId,{force:true});await f.finish();
  assert.equal(f.resource().state,"unavailable");assert.equal(f.resource().errorCode,code);
}
function sameAuthoredState(f,events,route,target){
  assert.equal(JSON.stringify(f.store.events.get()),events);assert.equal(f.store.route.get(),route);
  assert.equal(f.controller.documentId,target.documentId);assert.equal(f.controller.blockId,target.blockId);
}

for(const locale of["en","fr","ar","ja"])test("authored Output status / "+locale+" / absent snapshot reveals only status; deliberate exact Refresh recovers",async t=>{
  const f=await page(t,{locale}),request=capture(f),events=JSON.stringify(f.store.events.get()),before=f.storeHost.requests.length;
  assert.equal(f.resource().snapshot,null);assert.equal(f.resource().state,"unavailable");
  assert.equal(await request.run(),true);assert.equal(f.storeHost.requests.length,before,"reveal sends no read or command");
  assert.equal(f.native.document.activeElement?.getAttribute?.("class"),"output-requirements");
  assert.equal(f.native.document.activeElement?.tabIndex,-1);assert.equal(f.controller.querySelector("forma-output-requirement-card"),null);
  assert.ok(f.own("p").some(node=>node.text===f.i18n.t("output.delivery.scopeUnknown")));
  const refresh=f.refresh();assert.ok(refresh);
  f.storeHost.intercept=request=>outputRead(request)?f.adapter.fetch(request.url,request.init):undefined;
  await f.act(refresh);assert.equal(f.resource().state,"ready");
  assert.deepEqual(f.storeHost.requests.slice(before).filter(outputRead).map(row=>row.url),
    ["/api/output-requirements?documentId="+encodeURIComponent(f.target.documentId)]);
  assert.ok(f.controller.querySelector("forma-output-requirement-card"));sameAuthoredState(f,events,request.route,f.target);
  noOpeningListeners(f);noCommands(f);
});

test("authored Output status / in-flight snapshot read is not joined, duplicated or called ready by reveal",async t=>{
  const f=await page(t),gate=deferred();let entered=false;
  f.storeHost.intercept=request=>{if(outputRead(request)){entered=true;return gate.promise;}};
  const reading=f.store.outputRequirements.ensure(f.target.documentId,{force:true});
  for(let i=0;i<100&&!entered;i++)await new Promise(setImmediate);assert.equal(entered,true);
  await f.flush();assert.equal(f.resource().state,"loading");assert.equal(f.resource().snapshot,null);
  const before=f.storeHost.requests.length,request=capture(f);
  try {
    assert.equal(await request.run(),true);assert.equal(f.storeHost.requests.length,before);
    assert.equal(f.resource().state,"loading");assert.equal(f.controller.querySelector("forma-output-requirement-card"),null);
    assert.ok(f.own("p").some(node=>node.text===f.i18n.t("output.delivery.loading")));
  } finally {gate.resolve(Response.json({error:"fixture_snapshot_unavailable"},{status:503}));await reading;await f.finish();}
  noOpeningListeners(f);noCommands(f);
});
test("authored Output status / retained unavailable card stays the same exact requirement",async t=>{
  const f=await page(t,{unavailable:false}),snapshot=f.resource().snapshot,card=f.controller.querySelector("forma-output-requirement-card");
  assert.ok(snapshot&&card);await failOutput(f,"fixture_snapshot_unavailable",503);
  assert.equal(f.resource().snapshot,snapshot);const request=capture(f),before=f.storeHost.requests.length;
  assert.equal(await request.run(),true);assert.equal(f.storeHost.requests.length,before);
  assert.equal(f.native.document.activeElement?.getAttribute?.("data-output-requirement"),f.target.blockId);
  assert.equal(f.controller.querySelector("forma-output-requirement-card")===card,true);
  assert.equal(f.resource().state,"unavailable");assert.ok(f.refresh());noOpeningListeners(f);noCommands(f);
});
test("authored Output status / project_context_required may show only the existing project-selector guidance",async t=>{
  const f=await page(t,{unavailable:false}),oldPrivate=f.resource().snapshot.requirements[0].content;
  await failOutput(f,"project_context_required",403);
  assert.equal(f.resource().snapshot,null);assert.equal(f.resource().accessLost,true);assert.equal(f.resource().privateUnavailable,true);
  const request=capture(f),before=f.storeHost.requests.length;
  assert.equal(await request.run(),true);assert.equal(f.storeHost.requests.length,before);
  assert.equal(f.controller.querySelector("forma-output-requirement-card"),null);
  assert.equal(f.controller.markup.includes(oldPrivate),false,"withheld Output card content is not revived for status focus");
  const selector=f.own("a").find(node=>Object.hasOwn(node.attributes,"data-output-source-open-projects"));
  assert.ok(selector);assert.equal(selector.attributes.href,"/settings/workspaces");assert.equal(f.refresh(),undefined);
  assert.equal(f.native.document.activeElement?.getAttribute?.("class"),"output-requirements");
  noOpeningListeners(f);noCommands(f);
});
test("authored Output status / source-projection-stale keeps the exact existing source refresh path",async t=>{
  const f=await page(t,{state:"reviewer"});await failOutput(f,"output_target_source_projection_stale",409);
  const request=capture(f),events=JSON.stringify(f.store.events.get()),before=f.storeHost.requests.length;
  assert.equal(await request.run(),true);assert.equal(f.storeHost.requests.length,before);
  const refresh=f.own("button").find(node=>Object.hasOwn(node.attributes,"data-output-source-refresh"));assert.ok(refresh);
  assert.equal(f.refresh(),undefined,"do not replace source-index recovery with generic ensure");
  const context=f.store.session.get().projectContext,head=f.store.head.get();
  f.storeHost.intercept=row=>sourceRead(row)?Response.json({events:[],head}):outputRead(row)?f.adapter.fetch(row.url,row.init):undefined;
  await f.act(refresh);assert.equal(f.resource().state,"ready");
  assert.deepEqual(f.storeHost.requests.slice(before).filter(row=>sourceRead(row)||outputRead(row)).map(row=>row.url),[
    "/api/workspaces/"+encodeURIComponent(context.organizationId)+"/projects/"+encodeURIComponent(context.projectAccessId)+"/events?after="+head+"&limit=1&content=0",
    "/api/output-requirements?documentId="+encodeURIComponent(f.target.documentId),
  ]);
  sameAuthoredState(f,events,request.route,f.target);noOpeningListeners(f);noCommands(f);
});

for(const boundary of["update","panel"])for(const change of["caller","route","focus"])
test("authored Output status / "+change+" wins across "+boundary+" await",async t=>{
  const f=await page(t);
  if(boundary==="panel"){
    const result=f.tree().visible("button").find(node=>node.attributes["data-workbench-pane"]==="result");assert.ok(result);await f.act(result);
    assert.equal(f.controller.closest("#document-context-panel")?.hidden,true);
  }
  const request=capture(f),tick=f.tick,before=f.storeHost.requests.length;let entered=false,field=null;
  f.tick=async component=>{
    const hit=!entered&&new Error().stack.includes("revealAuthoredRequirement")
      &&(boundary==="update"?component===f.controller:component.tag==="forma-workspace");
    const value=await tick(component);
    if(hit){
      entered=true;
      if(change==="caller")request.retire();
      else if(change==="route")f.store.route.set("/settings");
      else {const fields=f.tree().visible("select").filter(node=>node.owner?.tag==="forma-ui-language-picker");
        assert.equal(fields.length,1);field=fields[0].port;f.native.focus(field);}
    }
    return value;
  };
  const result=await request.run();assert.equal(entered,true);assert.equal(result,false);
  assert.equal(f.storeHost.requests.length,before,"retired reveal performs no transport");
  assert.equal(f.native.nativeScroll.filter(row=>row.node.owner===f.controller).length,0);
  if(field)assert.equal(f.native.document.activeElement===field,true);
  noOpeningListeners(f);noCommands(f);
});
test("authored Output status / same mounted controller cannot publish into a changed actor",async t=>{
  const f=await page(t),request=capture(f),tick=f.tick;let entered=false;
  f.tick=async component=>{const hit=!entered&&component===f.controller&&new Error().stack.includes("revealAuthoredRequirement"),value=await tick(component);
    if(hit){entered=true;const session=f.store.session.get();f.store.session.set({...session,user:{...session.user,userId:"newer-output-reader"}});}return value;};
  assert.equal(await request.run(),false);assert.equal(entered,true);assert.equal(focusCount(f),0);
  assert.equal(f.native.nativeScroll.length,0);noOpeningListeners(f);noCommands(f);
});
test("authored Output status / open dirty native requirement refuses a status handoff without changing the draft",async t=>{
  const f=await page(t,{unavailable:false}),card=f.controller.querySelector("forma-output-requirement-card");
  await f.act(f.find("button",node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit")));
  const field=f.tree().visible("textarea").find(node=>node.owner===card&&node.attributes.name==="originalText");assert.ok(field);
  field.port.value="Keep my unfinished requirement";await f.act(field,"input");
  const request=capture(f),before=f.storeHost.requests.length,focusBefore=focusCount(f);
  assert.equal(await request.run(),false);assert.equal(f.storeHost.requests.length,before);assert.equal(focusCount(f),focusBefore);
  assert.equal(f.tree().visible("textarea").find(node=>node.owner===card&&node.attributes.name==="originalText")?.port.value,"Keep my unfinished requirement");
  noCommands(f);
});
test("authored Output status / wrong project, Document and block cannot borrow this status owner",async t=>{
  const f=await page(t),request=capture(f),before=f.storeHost.requests.length;
  for(const field of["projectId","documentId","blockId"])assert.equal(
    await f.controller.revealAuthoredRequirement({...f.target,[field]:"different-original"},{current:request.current}),false);
  assert.equal(f.storeHost.requests.length,before);assert.equal(focusCount(f),0);noOpeningListeners(f);noCommands(f);
});

// Reuse declarations from the existing actual Worker/Store/complete-controller
// source-recovery fixture. Original test registrations and case bodies are not run
// or changed here; no production method or response is replaced.
async function sourceFixtureModule(){
  const url=new URL("./output-source-refresh.test.mjs",import.meta.url),source=fs.readFileSync(url,"utf8");
  const tree=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const firstCases=tree.statements.find(node=>ts.isForOfStatement(node));
  assert.ok(firstCases,"existing first locale registration is the fixture boundary");
  let code=source.slice(0,firstCases.getFullStart());
  code=code.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,prefix,_quote,specifier)=>
    prefix+JSON.stringify(specifier.startsWith(".")?new URL(specifier,url).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
  const port=(before,after)=>{assert.equal(code.split(before).length,2,"exact nested fixture import port");code=code.replace(before,after);};
  port("new URL(relative, import.meta.url)","new URL(relative,"+JSON.stringify(url.href)+")");
  port("import.meta.resolve(specifier)","resolveFixture(specifier)");
  for(const name of["vite","lit/directives/live.js"])port('JSON.stringify(import.meta.resolve("'+name+'"))',
    "JSON.stringify("+JSON.stringify(import.meta.resolve(name))+")");
  code='import {createRequire as fixtureRequire} from "node:module"; import {pathToFileURL as fixtureFileURL} from "node:url";\n'
    +'const resolveFixturePath=fixtureRequire('+JSON.stringify(url.href)+').resolve;\n'
    +'const resolveFixture=specifier=>{const resolved=resolveFixturePath(specifier);return resolved.startsWith("node:")?resolved:fixtureFileURL(resolved).href;};\n'+code;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\nexport {sourceFixture,authoredState,workers};\n").toString("base64"));
}
test("authored Output status / actual RAM Worker Source403 retires even the status owner",async t=>{
  const actual=await sourceFixtureModule(),f=await actual.sourceFixture(t,{blockId:"image-assignment",surface:"document"});
  const target={projectId:actual.workers.project,documentId:actual.workers.doc,blockId:"image-assignment"};
  const source=f.store.captureSourceOwnership(),before=actual.authoredState(f.db);
  assert.ok(f.store.sourceOwnershipActive(source));assert.ok(f.store.projection.get().blocks.some(block=>block.id===target.blockId));
  // Actual requireUser denial, not an injected private-state flag or fake HTTP success.
  f.db.env.FORMA_PILOT_COHORT_ID="synthetic-missing-output-status-cohort";
  await assert.rejects(f.store.refreshEvents(),/403/u);
  assert.equal(f.store.sourceOwnershipActive(source),false);assert.equal(f.store.events.get().length,0);
  assert.equal(f.store.outputRequirements.resource(target.documentId).snapshot,null);
  const requests=f.storeHost.requests.length;
  assert.equal(await f.controller.revealAuthoredRequirement(target,{current:()=>true}),false);
  assert.equal(f.storeHost.requests.length,requests);assert.deepEqual(actual.authoredState(f.db),before);
  assert.ok(f.storeHost.requests.every(request=>(request.init.method??"GET")==="GET"));
});
