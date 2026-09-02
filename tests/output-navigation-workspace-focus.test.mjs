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

// R12 observed native Tab leaving Compare clipped through the read-only 1 s
// sample. Reuse the whole Workspace/Store and existing native recorder. Output
// rows below are declared fixture input, not new generation or provider evidence.
// Only :focus-visible is supplied as native state; the actual EventPart receives
// its current emitted light-DOM path. This is not browser scrolling/AT proof.
test("current Workspace toolbar reveals native Compare without acquiring focus or changing work", async t => {
 const f=await workspacePage(t),native=f.native;
 f.appendEvent("GenerationCompleted",{generation_id:"native-toolbar-fixture",object_ids:["toolbar-output-a","toolbar-output-b"],
  provider:"simulation",simulation:true,model_id:"fixture-only",quality:"high"});
 await f.settle();
 const owners=f.components().filter(owner=>owner.tag==="forma-workspace");
 assert.equal(owners.length,1);const owner=owners[0];
 const raw="  Keep this unsent Document question — 文書\nسؤال  ";
 const ask=f.find("textarea",node=>node.owner===owner&&node.attributes.id==="creative-command");
 ask.port.value=raw;await f.act(ask,"input");await f.settle();
 const tree=f.tree(),toolbars=tree.visible("div").filter(node=>node.owner===owner
  &&String(node.attributes.class??"").split(/\s+/u).includes("document-actions"));
 assert.equal(toolbars.length,1);const toolbar=toolbars[0],header=toolbar.parent;
 const buttons=tree.visible("button").filter(node=>node.parent===toolbar);
 const compare=buttons.find(node=>node.text.trim()==="Compare");
 assert.ok(compare?.port?.isConnected&&!compare.hiddenBy);
 assert.equal(compare.port.tagName,"BUTTON");assert.equal(compare.port.matches(":disabled"),false);
 assert.equal(compare.port.ownerDocument,native.document);
 assert.equal(compare.port.closest("forma-workspace"),owner);
 assert.equal(compare.port.closest(".document-actions"),toolbar.port);
 assert.equal(toolbar.port.closest(".page-header--document"),header.port);
 assert.equal(owner.querySelectorAll(".document-actions").length,1);
 assert.equal(owner.querySelector(".document-actions"),toolbar.port);
 assert.equal(f.store.projection.get().outputs.filter(row=>["toolbar-output-a","toolbar-output-b"].includes(row.id)).length,2);
 const source=f.store.captureSourceOwnership(),route=f.store.route.get();
 assert.ok(source&&f.store.sourceOwnershipActive(source));
 const currentAsk=()=>f.find("textarea",node=>node.owner===owner&&node.attributes.id==="creative-command").port;
 const retainedAsk=currentAsk();assert.equal(retainedAsk.value,raw);
 const effects=()=>JSON.stringify({events:f.store.events.get(),head:f.store.head.get(),content:f.store.content.get(),
  requests:f.storeHost.requests,outputRecords:f.outputRecords,session:f.store.session.get()});
 const original=effects(),handler=toolbar.handlers.focusin;
 assert.equal(typeof handler,"function","the actual current toolbar owns its native focusin EventPart");
 const path=[];
 for(let row=compare;row;row=row.parent){const port=row.port??row.component;if(port&&path.at(-1)!==port)path.push(port);}
 if(!path.includes(native.document))path.push(native.document);
 assert.equal(path[0],compare.port);assert.equal(path[1],toolbar.port);assert.equal(path[2],header.port);
 const originalMatches=compare.port.matches;let focusVisible=true;
 compare.port.matches=function(selector){return selector===":focus-visible"?focusVisible:originalMatches.call(this,selector);};
 t.after(()=>{compare.port.matches=originalMatches;});
 const observed=[];
 const deliver=(label,nativePath=path)=>{
  const active=native.document.activeElement,focusAt=native.nativeFocus.length,scrollAt=native.nativeScroll.length;
  const before=effects(),currentRoute=f.store.route.get();
  const result=handler.call(owner,{type:"focusin",target:compare.port,currentTarget:toolbar.port,composedPath:()=>nativePath,
   preventDefault(){assert.fail("native focus is not canceled");},stopPropagation(){assert.fail("native focus is not intercepted");}});
  assert.equal(result,undefined,"there is no deferred presentation owner");
  assert.equal(native.document.activeElement,active);assert.equal(native.nativeFocus.length,focusAt);
  assert.equal(f.store.route.get(),currentRoute);assert.equal(effects(),before);
  assert.equal(retainedAsk.value,raw);
  if(currentRoute===route&&f.store.sourceOwnershipActive(source))assert.equal(currentAsk(),retainedAsk);
  observed.push({label,calls:native.nativeScroll.slice(scrollAt).map(call=>({sameCompare:call.node===compare.port,args:call.args}))});
 };
 native.focus(compare.port);deliver("current");
 focusVisible=false;deliver("not-focus-visible");focusVisible=true;
 compare.port.disabled=true;deliver("disabled");compare.port.disabled=false;
 deliver("foreign-direct-path",[compare.port,header.port,toolbar.port,native.document]);
 native.focus(currentAsk());deliver("focus-left");native.focus(compare.port);
 assert.equal(effects(),original,"all ordinary reveals and rejected native events preserve every recorded effect");
 f.store.route.set("/library");deliver("stale-route");
 assert.equal(f.store.route.get(),"/library","a stale callback cannot navigate back");
 f.store.route.set(route);
 const session=f.store.session.get();f.store.session.set({...session,permissionEpoch:"native-toolbar-new-authority"});
 assert.equal(f.store.sourceOwnershipActive(source),false);deliver("stale-source-authority");
 assert.equal(f.store.session.get().permissionEpoch,"native-toolbar-new-authority");
 t.diagnostic(JSON.stringify({evidence:"actual EventPart/native scroll arguments only; no geometry or automatic bubbling claim",observed}));
 assert.deepEqual(observed,[
  {label:"current",calls:[{sameCompare:true,args:[{block:"nearest",inline:"nearest",behavior:"instant"}]}]},
  ...["not-focus-visible","disabled","foreign-direct-path","focus-left","stale-route","stale-source-authority"].map(label=>({label,calls:[]})),
 ],"only the current enabled native toolbar target requests complete-box reveal");
});

// Conditional task-strip successor: no native failure or CSS geometry is
// inferred here. Reuse the existing whole Workspace and scroll recorder; the
// root browser journey must reach and preserve any failure before adoption.
test("current Workspace pane focus reveals its native target without selecting a different pane", async t => {
 const f=await workspacePage(t),native=f.native;
 const owners=f.components().filter(owner=>owner.tag==="forma-workspace");
 assert.equal(owners.length,1);const owner=owners[0];
 const raw="  Preserve the current Write work — 原文  ";
 const initialAsk=f.find("textarea",node=>node.owner===owner&&node.attributes.id==="creative-command");
 initialAsk.port.value=raw;await f.act(initialAsk,"input");
 const tree=f.tree(),groups=tree.visible("div").filter(node=>node.owner===owner
  &&String(node.attributes.class??"").split(/\s+/u).includes("document-workbench-tasks"));
 assert.equal(groups.length,1);const group=groups[0],container=group.parent;
 const panes=tree.visible("button").filter(node=>node.parent===group);
 assert.deepEqual(panes.map(node=>node.attributes["data-workbench-pane"]),["write","result","review"]);
 assert.deepEqual(panes.map(node=>node.port.getAttribute("aria-pressed")),["true","false","false"]);
 assert.equal(group.attributes.role,"group");assert.equal(typeof group.handlers.keydown,"function");
 assert.equal(group.port.closest(".studio-main"),container.port);
 assert.equal(group.port.closest("forma-workspace"),owner);
 assert.equal(owner.querySelectorAll(".document-workbench-tasks").length,1);
 const ask=f.find("textarea",node=>node.owner===owner&&node.attributes.id==="creative-command").port;
 assert.equal(ask.value,raw);
 const originalMode=owner.querySelector(".studio-grid").getAttribute("data-workbench-mode");
 assert.equal(originalMode,"write");
 const route=f.store.route.get(),source=f.store.captureSourceOwnership();assert.ok(source&&f.store.sourceOwnershipActive(source));
 const effects=()=>JSON.stringify({events:f.store.events.get(),head:f.store.head.get(),content:f.store.content.get(),
  requests:f.storeHost.requests,outputRecords:f.outputRecords,session:f.store.session.get()});
 const original=effects(),handler=group.handlers.focusin;
 assert.equal(typeof handler,"function","the current pane strip owns its native focusin EventPart");
 const observed=[];let focusVisible=true;
 const originalMatches=panes.map(node=>node.port.matches);
 for(const [index,node]of panes.entries()){
  assert.ok(node.port.isConnected);assert.equal(node.port.tagName,"BUTTON");
  assert.equal(node.port.matches(":disabled"),false);assert.equal(node.port.ownerDocument,native.document);
  node.port.matches=function(selector){return selector===":focus-visible"?focusVisible:originalMatches[index].call(this,selector);};
 }
 t.after(()=>{for(const [index,node]of panes.entries())node.port.matches=originalMatches[index];});
 const deliver=(label,node)=>{
  const path=[];for(let row=node;row;row=row.parent){const port=row.port??row.component;if(port&&path.at(-1)!==port)path.push(port);}
  if(!path.includes(native.document))path.push(native.document);
  assert.equal(path[0],node.port);assert.equal(path[1],group.port);assert.equal(path[2],container.port);
  const active=native.document.activeElement,focusAt=native.nativeFocus.length,scrollAt=native.nativeScroll.length;
  const before=effects(),currentRoute=f.store.route.get();
  const result=handler.call(owner,{type:"focusin",target:node.port,currentTarget:group.port,composedPath:()=>path,
   preventDefault(){assert.fail("native focus is not canceled");},stopPropagation(){assert.fail("native focus is not intercepted");}});
  assert.equal(result,undefined);assert.equal(native.document.activeElement,active);
  assert.equal(native.nativeFocus.length,focusAt);assert.equal(f.store.route.get(),currentRoute);
  assert.equal(effects(),before);assert.equal(ask.value,raw);
  assert.deepEqual(panes.map(value=>value.port.getAttribute("aria-pressed")),["true","false","false"],"focus does not select a pane");
  if(currentRoute===route&&f.store.sourceOwnershipActive(source)){
   assert.equal(owner.querySelector(".document-workbench-tasks"),group.port);
   assert.equal(owner.querySelector(".studio-grid").getAttribute("data-workbench-mode"),originalMode);
   assert.equal(f.find("textarea",value=>value.owner===owner&&value.attributes.id==="creative-command").port,ask);
  }
  observed.push({label,calls:native.nativeScroll.slice(scrollAt).map(call=>({sameTarget:call.node===node.port,args:call.args}))});
 };
 const result=panes[1],review=panes[2];
 native.focus(result.port);deliver("result",result);
 native.focus(review.port);deliver("review",review);
 focusVisible=false;deliver("not-focus-visible",review);focusVisible=true;
 review.port.disabled=true;deliver("disabled",review);review.port.disabled=false;
 native.focus(ask);deliver("focus-left",review);native.focus(review.port);
 assert.equal(effects(),original,"focus and rejected events preserve current authored and financial state");
 f.store.route.set("/library");deliver("stale-route",review);
 assert.equal(f.store.route.get(),"/library");
 const reveal=[{sameTarget:true,args:[{block:"nearest",inline:"nearest",behavior:"instant"}]}];
 t.diagnostic(JSON.stringify({evidence:"native target/argument contract; declared focus-visible, no keyboard/geometry simulation",observed}));
 assert.deepEqual(observed,[
  {label:"result",calls:reveal},{label:"review",calls:reveal},
  ...["not-focus-visible","disabled","focus-left","stale-route"].map(label=>({label,calls:[]})),
 ],"only current enabled pane controls are revealed, never activated or refocused");
});
