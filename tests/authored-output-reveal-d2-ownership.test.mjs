import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { html } from "lit";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installDBoundNativeDetails } from "./helpers/d-native-disclosure.mjs";

// Conditional on D2 r1+r2 and the separate C/D2 guard. These are full actual
// controller/Store classes with the existing finite HTTP/domain/native fixture.
// No Worker/server-authority or ordinary seven-consumer wiring claim.
const sourceUrl=new URL("./authored-output-reveal.test.mjs",import.meta.url),source=fs.readFileSync(sourceUrl,"utf8");
const tree=ts.createSourceFile(sourceUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const firstCases=tree.statements.find(node=>ts.isForOfStatement(node));assert.ok(firstCases);
let prefix=source.slice(0,firstCases.getFullStart());
prefix=prefix.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,start,_quote,specifier)=>
  start+JSON.stringify(specifier.startsWith(".")?new URL(specifier,sourceUrl).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
const {page,capture,noCommands}=await import("data:text/javascript;base64,"+Buffer.from(prefix+"\nexport {page,capture,noCommands};\n").toString("base64"));
const RAW="  Retain this same original local recipe\nنص — 元の文章。  ";
const options={concurrency:false,timeout:30_000};
function whole(f,documentId=f.target.documentId){
  const controllers=f.components().filter(controller=>controller.tag==="forma-output-requirements"&&!controller.blockId
    &&controller.surface==="document"&&controller.documentId===documentId);
  assert.equal(controllers.length,1);return controllers[0];
}
function incoming(f,documentId=f.target.documentId){
  const projection=f.store.projection.get();assert.equal(projection.documentId,documentId);
  return {input:{recipeId:"campaign",originalText:RAW,selectedChoices:["campaign-image"]},
    source:{projectId:projection.projectId,documentId,actorUserId:f.store.session.get().user.userId,
      authorizationScopeKey:f.store.captureAuthorizationScope().key,head:f.store.head.get()}};
}
async function focusFor(controller){
  const actual=await ports.loadActual("src/components/output-navigation-focus.ts");
  return actual.captureOutputNavigationFocus(controller.ownerDocument);
}
function rawField(controller){return controller.querySelector(".output-recipe-entry textarea");}
function collapsed(f,controller){
  const details=f.tree().nodes.find(node=>node.owner===controller&&node.tag==="details"&&node.attributes.class==="output-recipe-entry");
  assert.ok(details?.port);return details;
}

test("C/D2 status reveal preserves an existing collapsed raw recipe in the same Document",options,async t=>{
  const f=await page(t),controller=whole(f),data=incoming(f);
  installDBoundNativeDetails(t,f,controller,{className:"output-recipe-entry"});
  const focus=await focusFor(controller);
  assert.equal(await controller.receiveIntakeRecipe(data.input,data.source,{current:()=>true,opener:null,focus}),"retained");
  await f.finish();assert.equal(rawField(controller)?.value,RAW);
  const details=collapsed(f,controller);assert.equal(details.port.open,true);
  details.port.open=false;await f.act(details,"toggle");assert.equal(collapsed(f,controller).port.open,false);
  const before=f.storeHost.requests.length,events=JSON.stringify(f.store.events.get()),focused=f.native.nativeFocus.length;
  assert.equal(await capture(f).run(),false);
  assert.equal(rawField(controller)?.value,RAW);assert.equal(collapsed(f,controller).port.open,false);
  assert.equal(f.storeHost.requests.length,before);assert.equal(f.native.nativeFocus.length,focused);
  assert.equal(JSON.stringify(f.store.events.get()),events);
  assert.equal(f.components().some(component=>component.tag==="forma-output-requirement-card"&&component.newDraft),false);noCommands(f);
});

test("C/D2 status reveal refuses the actual incoming raw owner before its first render",options,async t=>{
  const f=await page(t),controller=whole(f),data=incoming(f);
  installDBoundNativeDetails(t,f,controller,{className:"output-recipe-entry"});
  const focus=await focusFor(controller);
  focus.dispose(); // Existing public retention path, never a renewed staging/focus gesture.
  let release;const gate=new Promise(resolve=>{release=resolve;});let entered=false;
  f.storeHost.intercept=request=>request.url.startsWith("/api/output-requirements?")
    ? (entered=true,gate):undefined;
  const beforeMarkup=controller.markup;
  const receiving=controller.receiveIntakeRecipe(data.input,data.source,{current:()=>true,opener:null,focus});
  t.after(()=>release(Response.json({error:"fixture_output_read_unavailable"},{status:503})));
  for(let i=0;i<100&&!entered;i++)await new Promise(setImmediate);assert.equal(entered,true);
  assert.equal(controller.markup,beforeMarkup,"synthetic held-render boundary: input owner exists before publication");
  assert.equal(rawField(controller),null,"no DOM field can stand in for the incoming private owner");
  const before=f.storeHost.requests.length,focused=f.native.nativeFocus.length;
  const result=await capture(f).run();
  assert.equal(result,false);assert.equal(f.storeHost.requests.length,before);assert.equal(f.native.nativeFocus.length,focused);
  assert.equal(controller.markup,beforeMarkup,"refusal does not draw or displace the incoming view");
  release(Response.json({error:"fixture_output_read_unavailable"},{status:503}));
  assert.equal(await receiving,"retained");await f.finish();assert.equal(rawField(controller)?.value,RAW);
  assert.equal(collapsed(f,controller).port.open,false);noCommands(f);
});

test("C/D2 same-class guard ignores an unrelated Document's retained raw owner",options,async t=>{
  const f=await page(t),a={...f.target},documents=f.store.projection.get().documents;
  const b=documents.find(document=>document.projectId===a.projectId&&document.id!==a.documentId);assert.ok(b);
  // Synthetic multi-Document component host, not a claim that the current Shell
  // keeps background Document editors mounted. Both children are complete actual
  // controllers with the same real Store and ordinary public properties.
  f.host.disconnectedCallback();
  class TwoDocumentStatusHost extends ports.ElementPort{
    render(){return html`<forma-output-requirements .documentId=${a.documentId} .blockId=${a.blockId} .surface=${"document"}></forma-output-requirements>
      <forma-output-requirements .documentId=${b.id} .surface=${"document"}></forma-output-requirements>`;}
  }
  f.host=new TwoDocumentStatusHost();f.host.tag="test-two-document-status-host";f.host.attributes={};f.host.isConnected=true;
  await f.finish();
  const aControllers=f.components().filter(controller=>controller.tag==="forma-output-requirements"&&controller.blockId===a.blockId);
  assert.equal(aControllers.length,1);f.controller=aControllers[0];
  const other=whole(f,b.id);
  f.store.route.set("/document/"+encodeURIComponent(b.id)+"/other-source");await f.finish();
  installDBoundNativeDetails(t,f,other,{className:"output-recipe-entry"});
  const data=incoming(f,b.id),focus=await focusFor(other);focus.dispose();
  assert.equal(await other.receiveIntakeRecipe(data.input,data.source,{current:()=>true,opener:null,focus}),"retained");
  await f.finish();assert.equal(rawField(other)?.value,RAW);assert.equal(collapsed(f,other).port.open,false);
  f.store.route.set("/document/"+encodeURIComponent(a.documentId)+"/original-source");await f.finish();
  assert.equal(other.isConnected,true);assert.equal(f.controller.isConnected,true);
  assert.equal(rawField(other),null,"other Document's input is not current private presentation");
  const before=f.storeHost.requests.length,events=JSON.stringify(f.store.events.get());
  assert.equal(await capture(f).run(),true,"different Document's retained fields do not block this exact status");
  assert.equal(f.storeHost.requests.length,before);assert.equal(f.native.document.activeElement?.getAttribute?.("class"),"output-requirements");
  assert.equal(JSON.stringify(f.store.events.get()),events);
  f.store.route.set("/document/"+encodeURIComponent(b.id)+"/other-source");await f.finish();
  assert.equal(whole(f,b.id)===other,true);assert.equal(rawField(other)?.value,RAW,"C did not clear another owner's retained input");
  noCommands(f);
});
