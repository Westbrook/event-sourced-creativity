import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { documentContextBlockRoute } from "../src/model/routes.ts";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const focusImports = registerOutputSourceImports();
const { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } = await import("../src/components/output-navigation-focus.ts");
focusImports.deregister();
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
async function workspacePage(t,{locale="en"}={}){
 const f=await createOutputReachabilityPage(t,{locale}),native=installOutputNavigationFocusNative(t,f,ports),h=f.storeHost;
 const previousHistory=globalThis.history;globalThis.history={pushState(_state,_title,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(...args){this.pushState(...args);}};
 t.after(()=>{globalThis.history=previousHistory;assert.equal(h.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume?.(row)).length,0,"focus/navigation introduces no command or provider request");});
 const documentId=f.store.projection.get().documentId,title=f.store.projection.get().documentTitle;
 f.native=native;f.focusListeners=native.listeners("focusin");f.destination=(id="synthetic-0")=>documentContextBlockRoute(documentId,title,id);
 f.field=()=>f.tree().visible("select").find(node=>node.owner?.tag==="forma-ui-language-picker").port;
 f.lease=(id="synthetic-0")=>captureOutputNavigationFocus(ports.documentPort,{ownedRouteFocus:outputNavigationOwnedRouteFocus(ports.documentPort,f.store,{documentId,blockId:id},
  ()=>f.store.route.get()===f.destination(id)&&f.store.projection.get().documentId===documentId)});
 f.holdFrames=()=>{
  const original=ports.windowPort.requestAnimationFrame,held=[];let released=false;
  ports.windowPort.requestAnimationFrame=callback=>{held.push(callback);return -(held.length+1000);};
  const release=async()=>{if(released)return;released=true;ports.windowPort.requestAnimationFrame=original;for(const callback of held.splice(0))callback(0);await f.settle();};
  t.after(()=>{ports.windowPort.requestAnimationFrame=original;});return{held,release};
 };
 return f;
}
for(const locale of["en","fr","ar","ja"])test("actual "+locale+" Workspace normal linked route focuses only its exact native anchor",async t=>{
 const f=await workspacePage(t,{locale}),frames=f.holdFrames(),before=JSON.stringify(f.store.events.get());
 f.store.setRoute(f.destination());await f.settle();assert.ok(frames.held.length);
 await frames.release();
 const active=f.native.document.activeElement;assert.equal(active?.tagName,"ARTICLE");assert.equal(active?.getAttribute("data-block-id"),"synthetic-0");
 assert.equal(active?.closest("forma-context-block")?.block.id,"synthetic-0");
 assert.equal(JSON.stringify(f.store.events.get()),before);assert.equal(f.native.nativeScroll.at(-1)?.node===active,true);
 assert.equal(f.native.listeners("focusin"),f.focusListeners,"local callback lease closes after its own focus");
});
for(const change of["focus","pointerdown","keydown","authority","source","route","modal"])
test("actual Workspace pending linked RAF yields to newer "+change,async t=>{
 const f=await workspacePage(t),frames=f.holdFrames(),focus=f.lease(),source=f.store.route.get();
 try{
  f.store.setRoute(f.destination(),{focus,current:()=>f.store.route.get()===source});await f.settle();assert.ok(frames.held.length);
  const count=f.native.nativeScroll.filter(row=>row.node.getAttribute("data-block-id")==="synthetic-0").length,field=f.field();
  if(change==="focus")f.native.focus(field);
  else if(change==="pointerdown"||change==="keydown")f.native.emit(change,field);
  else if(change==="authority")f.store.session.set({...f.store.session.get(),permissionEpoch:"new-authority"});
  else if(change==="source")f.appendEvent("BlockPropertyEdited",{block_id:"synthetic-0",property_path:"text",new_value:"New authored text."});
  else if(change==="route")f.store.route.set(f.destination("synthetic-1"));
  else f.components().find(component=>component.tag==="forma-workspace").openContextComposer();
  await frames.release();
  assert.equal(f.native.nativeScroll.filter(row=>row.node.getAttribute("data-block-id")==="synthetic-0").length,count,"no late old linked-block scroll");
  if(change==="focus")assert.equal(f.native.document.activeElement===field,true);
 }finally{focus.dispose();}
 assert.equal(f.native.listeners("focusin"),f.focusListeners);
});
for(const change of["focus","pointerdown","keydown"])test("late Workspace mount retains original lease after newer "+change,async t=>{
 const f=await workspacePage(t);f.store.setRoute("/library");await f.settle();assert.equal(f.components().some(component=>component.tag==="forma-workspace"),false);
 const frames=f.holdFrames(),source=f.store.route.get(),focus=f.lease(),field=f.field(),count=f.native.nativeScroll.length;
 try{
  f.store.setRoute(f.destination(),{focus,current:()=>f.store.route.get()===source});
  if(change==="focus")f.native.focus(field);else f.native.emit(change,field);
  await f.settle();assert.ok(f.components().some(component=>component.tag==="forma-workspace"));
  await frames.release();assert.equal(f.native.nativeScroll.length,count,"late mount cannot adopt a fresh user-focus baseline");
  if(change==="focus")assert.equal(f.native.document.activeElement===field,true);
 }finally{focus.dispose();}
 assert.equal(f.native.listeners("focusin"),f.focusListeners);
});
test("closed owned lease cannot suppress a later ordinary linked route",async t=>{
 const f=await workspacePage(t),focus=f.lease(),source=f.store.route.get(),frames=f.holdFrames();
 f.store.setRoute(f.destination(),{focus,current:()=>f.store.route.get()===source});focus.dispose();await f.settle();await frames.release();
 assert.equal(f.native.nativeFocus.length,0);
 f.store.setRoute(f.destination("synthetic-1"));await f.settle();
 assert.equal(f.native.document.activeElement?.getAttribute("data-block-id"),"synthetic-1");
 assert.equal(f.store.captureWorkspaceNavigationFocus(f.store.route.get()),null);
 assert.equal(f.native.listeners("focusin"),f.focusListeners);
});
test("an earlier owned same-route lease cannot act after the second owned navigation",async t=>{
 const f=await workspacePage(t),frames=f.holdFrames(),first=f.lease(),source=f.store.route.get();
 f.store.setRoute(f.destination(),{focus:first,current:()=>f.store.route.get()===source});await f.settle();
 const firstOwner=f.store.captureWorkspaceNavigationFocus(f.store.route.get(),first);assert.equal(firstOwner.current(),true);
 const oldCallbacks=frames.held.splice(0);assert.ok(oldCallbacks.length,"capture only the original navigation callbacks");
 const second=f.lease();f.store.setRoute(f.destination(),{focus:second,current:()=>true});
 assert.equal(firstOwner.current(),false);assert.equal(f.store.captureWorkspaceNavigationFocus(f.store.route.get(),second).current(),true);
 for(const callback of oldCallbacks)callback(0);
 assert.equal(f.native.nativeFocus.length,0,"old scheduled callback cannot borrow the newer navigation lease");
 await frames.release();assert.equal(f.native.nativeFocus.length,1,"the deliberate second navigation owns its separate focus");
 assert.equal(f.native.document.activeElement?.getAttribute("data-block-id"),"synthetic-0");
 assert.equal(f.store.captureWorkspaceNavigationFocus(f.store.route.get(),second).current(),true);
 first.dispose();second.dispose();assert.equal(f.native.listeners("focusin"),f.focusListeners);
});
test("body focus and a disconnected original control are not a newer user gesture",async t=>{
 const f=await workspacePage(t),old=f.field();f.native.focus(old);const focus=f.lease(),frames=f.holdFrames(),source=f.store.route.get();
 try{
  f.store.setRoute(f.destination(),{focus,current:()=>f.store.route.get()===source});old.isConnected=false;f.native.document.activeElement=f.native.document.body;
  await f.settle();await frames.release();assert.equal(f.native.document.activeElement?.getAttribute("data-block-id"),"synthetic-0");
 }finally{focus.dispose();}
});

// Additive native-port contracts, not physical DOM/AT or Worker authority proof.
// Reuse the complete actual Workspace/ContextBlock/Store and the existing finite
// read-only Output HTTP fixture. No production method or activeElement is replaced.
async function articlePage(t,options){
 const f=await workspacePage(t,options);
 // Controls expands these actual children before updated() can query the full
 // tree; the ordinary lazy registry sweep otherwise runs after that query.
 const {readFileSync}=await import("node:fs");
 const definitions=JSON.parse(readFileSync(new URL("../custom-elements.json",import.meta.url),"utf8"));
 const byTag=new Map(definitions.modules.flatMap(module=>(module.declarations??[])
  .filter(value=>value.tagName).map(value=>[value.tagName,{file:module.path,name:value.name}])));
 for(const tag of["forma-context-intelligence","forma-spatial-scope-editor"]){
  if(f.renderer.registry[tag])continue;
  const entry=byTag.get(tag);assert.ok(entry,"existing actual Controls child "+tag);
  const module=await ports.loadActual(entry.file);assert.equal(typeof module[entry.name],"function",tag);
  f.renderer.registry[tag]=module[entry.name];
 }
 // The focus extension is installed after the existing page's initial draw.
 // Observe an ordinary frame before these new contracts capture/focus a node;
 // never infer a pre-install node's template identity from a lookalike.
 await f.settle();return f;
}
function exactNativeArticle(f,id="synthetic-0"){
 const rows=f.tree().visible("article").filter(row=>row.attributes["data-block-id"]===id
   &&row.owner.tag==="forma-context-block"&&row.owner.block.id===id
   &&row.owner.block.documentId===f.store.projection.get().documentId);
 assert.equal(rows.length,1,"one current native article has the exact current owning block and Document");
 assert.ok(rows[0].port?.isConnected&&f.renderer.nodes.includes(rows[0].port));return rows[0];
}
for(const locale of["en","ja"])test("native article identity survives only its continuous same-template redraw / "+locale,async t=>{
 const f=await articlePage(t,{locale}),article=exactNativeArticle(f),node=article.port,events=JSON.stringify(f.store.events.get());
 f.native.focus(node);const focused=f.native.nativeFocus.length;
 for(let draw=0;draw<3;draw++)await f.settle();
 const current=exactNativeArticle(f);
 assert.equal(current.owner,article.owner);assert.equal(current.port,node,"retain the native object, not a lookalike with reassigned focus");
 assert.equal(node.isConnected,true);assert.equal(f.native.document.activeElement,node);
 assert.equal(f.native.nativeFocus.length,focused,"redraw adds no focus action");
 assert.deepEqual(node.attributes,current.attributes);assert.equal(JSON.stringify(f.store.events.get()),events);
});
test("native article follows its actual keyed block across sibling reorder",async t=>{
 const f=await articlePage(t),article=exactNativeArticle(f),node=article.port;
 const index=()=>f.tree().visible("article").filter(row=>row.owner.tag==="forma-context-block").findIndex(row=>row.port===node);
 const before=index();assert.ok(before>=0);f.native.focus(node);const focused=f.native.nativeFocus.length;
 f.appendEvent("BlockPropertyEdited",{block_id:"synthetic-0",property_path:"position",old_value:article.owner.block.position,new_value:"zzzz-native-identity"});
 await f.settle();const current=exactNativeArticle(f);
 assert.equal(current.owner,article.owner);assert.equal(current.port,node);assert.notEqual(index(),before,"the original repeat key moved, rather than a numeric row being borrowed");
 assert.equal(f.native.document.activeElement,node);assert.equal(f.native.nativeFocus.length,focused);
});
test("native article replacement retires the old template inside the same ContextBlock",async t=>{
 const f=await articlePage(t),article=exactNativeArticle(f),node=article.port;
 assert.match(String(node.attributes.class),/context-block--summary/u);
 const radio=f.tree().visible("input").find(row=>row.owner===article.owner&&row.attributes.type==="radio");assert.ok(radio);
 await f.act(radio,"change");f.native.focus(node);
 const toggle=f.find("button",row=>row.owner===article.owner&&String(row.attributes.class).split(/\s/u).includes("context-controls-toggle"));
 await f.act(toggle);const current=exactNativeArticle(f);
 assert.equal(current.owner,article.owner,"the actual component is not replaced merely to manufacture this boundary");
 assert.notEqual(current.port,node);assert.equal(node.isConnected,false);assert.equal(f.renderer.nodes.includes(node),false);
 assert.doesNotMatch(String(current.attributes.class),/context-block--summary/u);
 const replacement=current.port,oldHandlers=replacement.handlers,listener=()=>{};
 replacement.addEventListener("native-fixture-contract",listener);
 f.appendEvent("BlockRenamed",{block_id:"synthetic-0",new_handle:"direction/current-native-bindings"});await f.settle();
 const refreshed=exactNativeArticle(f);assert.equal(refreshed.port,replacement);
 assert.deepEqual(replacement.attributes,refreshed.attributes);assert.ok(replacement.attributes["aria-label"].includes("direction/current-native-bindings"));
 assert.notEqual(replacement.handlers,oldHandlers);assert.equal(replacement.handlers.dragleave,refreshed.handlers.dragleave);
 assert.equal(replacement.listeners["native-fixture-contract"],listener,"an explicit native listener remains attached to the same element");
});
test("a removed article cannot resurrect its old native object after the same ID is restored",async t=>{
 const f=await articlePage(t),node=exactNativeArticle(f).port;f.native.focus(node);
 f.appendEvent("BlockRemoved",{block_id:"synthetic-0"});await f.settle();
 assert.equal(node.isConnected,false);assert.equal(f.renderer.nodes.includes(node),false);
 assert.equal(f.tree().visible("article").some(row=>row.attributes["data-block-id"]==="synthetic-0"),false);
 f.appendEvent("BlockRestored",{block_id:"synthetic-0"});await f.settle();
 assert.notEqual(exactNativeArticle(f).port,node);assert.equal(node.isConnected,false);
});
test("current authority replacement retires an old same-block article",async t=>{
 const f=await articlePage(t),article=exactNativeArticle(f),node=article.port,scope=f.store.captureAuthorizationScope();assert.ok(scope);
 f.native.focus(node);f.store.session.set({...f.store.session.get(),permissionEpoch:"native-article-new-authority"});await f.settle();
 assert.notEqual(f.store.captureAuthorizationScope()?.key,scope.key);
 const current=exactNativeArticle(f);assert.notEqual(current.owner,article.owner);
 assert.notEqual(current.port,node);assert.equal(node.isConnected,false);assert.equal(f.renderer.nodes.includes(node),false);
});
test("another current Document cannot adopt the old article even when its authored label is equal",async t=>{
 const f=await articlePage(t),article=exactNativeArticle(f),node=article.port;
 const originalDocument=article.owner.block.documentId,other=f.store.projection.get().documents.find(row=>row.id!==originalDocument);assert.ok(other);
 f.appendEvent("BlockCreated",{document_id:other.id,block_id:"native-other-document-block",type:"direction",handle:article.owner.block.handle,
   position:"a00",properties:{...article.owner.block.properties}});f.native.focus(node);
 f.store.setRoute("/document/"+other.id);await f.settle();
 assert.equal(f.store.projection.get().documentId,other.id);const current=exactNativeArticle(f,"native-other-document-block");
 assert.notEqual(current.owner,article.owner);assert.notEqual(current.port,node);
 assert.equal(node.isConnected,false);assert.equal(f.renderer.nodes.includes(node),false);
});
test("a retained native article never substitutes for the original source-revision predicate",async t=>{
 const f=await articlePage(t);f.store.setRoute(f.destination());await f.settle();
 const article=exactNativeArticle(f),node=article.port,documentId=article.owner.block.documentId;
 const {creativeActionSourceRevision}=await ports.loadActual("src/model/workspace-intelligence.ts");
 const {nextActionFacts}=await ports.loadActual("src/state/next-action-context.ts");
 const revision=()=>creativeActionSourceRevision(nextActionFacts(f.store,documentId,null));
 const originalRevision=revision(),owned=outputNavigationOwnedRouteFocus(f.native.document,f.store,{documentId,blockId:"synthetic-0"},()=>revision()===originalRevision);
 f.native.focus(node);assert.equal(owned(node),true);const focused=f.native.nativeFocus.length;
 f.appendEvent("BlockPropertyEdited",{block_id:"synthetic-0",property_path:"text",old_value:article.owner.block.properties.text,new_value:"A genuinely newer authored source revision."});
 await f.settle();assert.equal(exactNativeArticle(f).port,node,"same template can legitimately retain its native node while source facts change");
 assert.notEqual(revision(),originalRevision);assert.equal(owned(node),false,"the unchanged actual focus predicate still rejects the older source owner");
 assert.equal(f.native.nativeFocus.length,focused,"source edits do not refocus through this fixture");
});
