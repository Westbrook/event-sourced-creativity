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
