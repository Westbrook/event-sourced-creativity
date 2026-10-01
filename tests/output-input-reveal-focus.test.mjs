import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { Signal } from "signal-polyfill";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";

// Actual full Store/Shell/Workspace/Context classes; synthetic session/events,
// API responses and native DOM/timers only. No live server, provider, browser,
// CSS layout or assistive-technology certification is implied.
const imports=registerOutputSourceImports();
const {createOutputReachabilityPage}=await import("./helpers/output-reachability-fixture.mjs");
const {calmFullPageNativePorts:ports}=await import("./helpers/calm-full-page-fixture.mjs");
const {installOutputNavigationFocusNative}=await import("./helpers/output-navigation-focus-native.mjs");
const {documentContextBlockRoute}=await import("../src/model/routes.ts");
imports.deregister();
const locales=["en","fr","ar","ja"];
const restore=(key,descriptor)=>{if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];};
const pause=()=>new Promise(setImmediate);
const deferred=()=>Promise.withResolvers();
async function fixture(t,locale="en",{warm=true,derived=false}={}){
  const f=await createOutputReachabilityPage(t,{locale});
  if(derived)f.patchProperties(1,{source_artifact_id:"retained-original-story",source_artifact_kind:"short_story",
    label:"Retained original story",artifact_summary:"A complete retained summary",artifact_markdown:"Complete retained prose",
    artifact_structure:{items:[{id:"retained-original-story:1",title:"One part",body:"Complete body",notes:"Original notes",image_prompt:""}]}});
  const select=id=>f.find("input",row=>row.owner?.tag==="forma-context-block"&&row.owner.block.id===id&&row.attributes.type==="radio");
  const controls=(id="synthetic-0")=>f.find("button",row=>row.owner?.tag==="forma-context-block"&&row.owner.block.id===id&&String(row.attributes.class).includes("context-controls-toggle"));
  if(warm){await f.act(select("synthetic-0"),"change");await f.act(controls());await f.act(controls());}
  const native=installOutputNavigationFocusNative(t,f,ports),host=f.storeHost;
  const css=Object.getOwnPropertyDescriptor(globalThis,"CSS"),history=Object.getOwnPropertyDescriptor(globalThis,"history");
  globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/gu,char=>"\\"+char.codePointAt(0).toString(16)+" ")};
  globalThis.history={pushState(_state,_title,route){const next=new URL(route,"http://localhost");Object.assign(host.location,{pathname:next.pathname,search:next.search,hash:next.hash});},replaceState(...args){this.pushState(...args);}};
  t.after(()=>{restore("CSS",css);restore("history",history);});
  assert.equal(host.document,native.document,"Store and emitted components use the same native document port");
  assert.equal(f.host.ownerDocument,host.document);
  assert.equal(host.modules.get("src/state/store.ts").FormaStore,f.store.constructor,"complete actual Store class");
  assert.equal(Object.hasOwn(f.store,"revealOutputInput"),false,"no replacement Store method");
  const language=()=>f.find("select",row=>row.owner?.tag==="forma-ui-language-picker").port;
  const pane=name=>f.find("button",row=>row.attributes["data-workbench-pane"]===name);
  const target=(id="synthetic-1")=>{
    const owner=f.components().find(component=>component.tag==="forma-context-block"&&component.block?.id===id&&component.surface==="document");
    const editor=owner?.querySelectorAll(".block-editor").find(element=>element.closest("forma-context-block")===owner);
    const fields=editor?.querySelectorAll("textarea").filter(element=>element.closest("forma-context-block")===owner&&element.closest(".block-editor")===editor)??[];
    const field=fields.find(element=>element.closest("forma-ui-rich-text"))??fields[0];
    const anchor=owner?.querySelectorAll("[data-block-id]").find(element=>element.tagName==="ARTICLE"&&element.getAttribute("data-block-id")===id);
    return{owner,editor,field,anchor};
  };
  const start=(id="synthetic-1",documentId=f.store.projection.get().documentId)=>{
    const existing=new Set(host.timers.keys()),pending=f.store.revealOutputInput(id,documentId);
    const frame=[...host.timers].find(([key,timer])=>!existing.has(key)&&timer.delay===16);
    return{pending,callback:frame?.[1].callback,run(){if(!frame)return false;for(const[key,timer]of host.timers)if(timer.callback===frame[1].callback){host.timers.delete(key);timer.callback();return true;}return false;},
      runCaptured(){if(frame){for(const[key,timer]of host.timers)if(timer.callback===frame[1].callback)host.timers.delete(key);frame[1].callback();}},remaining(){return frame?[...host.timers.values()].filter(timer=>timer.callback===frame[1].callback).length:0;}};
  };
  // An owned Canvas-to-Document arrival can mount Workspace and resume its
  // exact current-document read. Reuse only the fixture's recorded-init classifier.
  const noCommands=from=>assert.deepEqual(host.requests.slice(from).filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(row)),[],"no authored/paid API command");
  return{f,host,native,select,controls,language,pane,target,start,noCommands};
}
const gestureModes=["control","focus","pointerdown","keydown","focus-away-body","selection-aba","editing-aba","route-aba","same-route-navigation","new-request"];
for(const locale of locales)for(const mode of gestureModes)test("Store input reveal ownership: "+locale+" "+mode,async t=>{
  const x=await fixture(t,locale),{f,host,native,language,start,target}=x;
  const events=JSON.stringify(f.store.events.get()),from=host.requests.length,routeBefore=f.store.route.get();
  const baseline=Object.fromEntries(["pointerdown","keydown","focusin"].map(type=>[type,native.listeners(type)]));
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  const field=target().field;assert.equal(field?.tagName,"TEXTAREA");assert.equal(field.ownerDocument,host.document);
  assert.equal(field.closest("forma-context-block").store,f.store);
  if(mode==="focus"||mode==="focus-away-body"){native.focus(language());if(mode==="focus-away-body")native.document.activeElement=native.document.body;}
  else if(mode==="pointerdown"||mode==="keydown")native.emit(mode,language());
  else if(mode==="selection-aba"){f.store.ui.focusBlockId="synthetic-2";f.store.ui.focusBlockId="synthetic-1";}
  else if(mode==="editing-aba"){f.store.ui.editingBlockId="synthetic-2";f.store.ui.editingBlockId="synthetic-1";}
  else if(mode==="route-aba"){const route=f.store.route.get();f.store.route.set("/library");f.store.route.set(route);}
  else if(mode==="same-route-navigation")f.store.setRoute(f.store.route.get());
  else if(mode==="new-request")assert.equal(await f.store.revealOutputInput("missing-later-target"),false);
  const focus=native.nativeFocus.length,scroll=native.nativeScroll.length,active=native.document.activeElement;
  // Calling a retained, canceled callback is stronger than merely removing its
  // scheduled RAF: the exact actual closure must not regain ownership.
  reveal.runCaptured();
  assert.equal(native.nativeFocus.length-focus,mode==="control"?1:0);
  assert.equal(native.nativeScroll.length-scroll,mode==="control"?1:0);
  if(mode!=="control")assert.equal(native.document.activeElement,active);
  else assert.equal(native.document.activeElement,field);
  assert.equal(reveal.remaining(),0,"terminal callback releases its frame");
  assert.equal([...host.timers.values()].some(timer=>timer.delay===10000),false,"terminal callback releases its deadline");
  for(const type of ["pointerdown","keydown","focusin"])assert.equal(native.listeners(type),baseline[type],"no leaked "+type+" listener");
  assert.equal(JSON.stringify(f.store.events.get()),events);if(mode==="control")assert.equal(f.store.route.get(),routeBefore,"visible Write preserves original route bytes");x.noCommands(from);
});

for(const locale of locales)for(const repeated of[false,true])test("Store input reveal restores visible Write from Results: "+locale+" "+(repeated?"same exact linked target":"fresh target"),async t=>{
  const x=await fixture(t,locale),{f,native,pane,start,target}=x;
  if(repeated){await f.act(pane("result"));const first=start();assert.equal(await first.pending,true);await f.settle();first.run();await f.settle();}
  await f.act(pane("result"));
  assert.ok(f.tree().nodes.find(row=>row.attributes.id==="document-context-panel")?.hiddenBy,"real narrow Results hides Write");
  const route=f.store.route.get(),events=JSON.stringify(f.store.events.get()),from=x.host.requests.length;
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  if(repeated)assert.equal(f.store.route.get(),route,"fresh lease, not a route nonce");
  assert.equal(f.tree().nodes.find(row=>row.attributes.id==="document-context-panel")?.hiddenBy,null);
  const field=target().field;assert.ok(f.tree().visible("textarea").some(row=>row.port===field),"editor is actually emitted in visible Write");
  reveal.run();assert.equal(native.document.activeElement,field);assert.equal(reveal.remaining(),0);
  assert.equal(JSON.stringify(f.store.events.get()),events);x.noCommands(from);
});

for(const locale of locales)test("Store input reveal cannot reopen Write after a newer gesture before destination render: "+locale,async t=>{
  const x=await fixture(t,locale),{f,native,pane,language,start}=x;
  await f.act(pane("result"));
  const newer=language(),reveal=start();assert.equal(await reveal.pending,true);
  native.focus(newer);const focus=native.nativeFocus.length,scroll=native.nativeScroll.length;
  await f.settle();reveal.runCaptured();
  assert.ok(f.tree().nodes.find(row=>row.attributes.id==="document-context-panel")?.hiddenBy,"closed lease cannot change pane before its focus check");
  assert.equal(native.nativeFocus.length,focus);assert.equal(native.nativeScroll.length,scroll);assert.equal(reveal.remaining(),0);
});

for(const mode of["epoch","epoch-aba","read-removed","author-removed","permissions-aba","context-expired","target-removed","locked","evidence","as-of"])test("Store input reveal checks current source and authority: "+mode,async t=>{
  const x=await fixture(t),{f,native,start}=x;
  if(mode==="context-expired"){
    const session=f.store.session.get();
    f.store.session.set({...session,projectContext:{organizationId:"fixture-scope",projectAccessId:"fixture-scope-access",projectId:f.store.projection.get().projectId,ownerUserId:session.user.userId,role:"author",permissions:["project.read","project.author"],expiresAt:new Date(Date.now()+60000).toISOString()}});
    await f.settle();
  }
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  const session=f.store.session.get();
  if(mode==="epoch"||mode==="epoch-aba"){f.store.session.set({...session,permissionEpoch:"new-epoch"});if(mode.endsWith("aba"))f.store.session.set(session);}
  else if(mode==="read-removed"||mode==="author-removed"||mode==="permissions-aba"){f.store.session.set({...session,capabilities:session.capabilities.filter(value=>value!==(mode==="read-removed"?"project.read":"project.author"))});if(mode.endsWith("aba"))f.store.session.set(session);}
  else if(mode==="context-expired")f.store.session.set({...session,projectContext:{...session.projectContext,expiresAt:new Date(Date.now()-1).toISOString()}});
  else if(mode==="target-removed")f.store.events.set(f.store.events.get().filter(event=>event.payload.block_id!=="synthetic-1"));
  else if(mode==="locked")f.appendEvent("BlockLocked",{block_id:"synthetic-1"});
  else if(mode==="evidence")f.patchProperties(1,{source_evidence_hash:"current-verified-evidence"});
  else f.store.asOf.set(1);
  const focus=native.nativeFocus.length,scroll=native.nativeScroll.length;reveal.runCaptured();
  assert.equal(native.nativeFocus.length,focus);assert.equal(native.nativeScroll.length,scroll);assert.equal(reveal.remaining(),0);
});

for(const mode of["readonly-owner","foreign-store","wrong-document","duplicate-owner","missing-owner","hidden-editor","inert-editor","css-hidden","readonly-field","disabled-field","disabled-fieldset"])test("Store input reveal requires exact editable native custody: "+mode,async t=>{
  const x=await fixture(t,"en",{derived:mode==="disabled-fieldset"}),{f,native,start,target,host}=x;
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  const {owner,editor,field}=target();assert.ok(owner&&editor&&field,"real exact owner/editor/textarea");
  const previousOwnerQuery=host.document.querySelectorAll;
  if(mode==="readonly-owner")owner.readOnly=true;
  else if(mode==="foreign-store")owner.store={};
  else if(mode==="wrong-document")owner.block={...owner.block,documentId:"different-document"};
  else if(mode==="duplicate-owner")host.document.querySelectorAll=selector=>selector==="forma-context-block"?[...previousOwnerQuery(selector),owner]:previousOwnerQuery(selector);
  else if(mode==="missing-owner")owner.isConnected=false;
  else if(mode==="hidden-editor")editor.setAttribute("hidden","");
  else if(mode==="inert-editor")editor.setAttribute("inert","");
  else if(mode==="css-hidden")editor.setAttribute("style","visibility:hidden");
  else if(mode==="readonly-field")field.readOnly=true;
  else if(mode==="disabled-field")field.disabled=true;
  else{
    const fieldset=field.closest("fieldset");assert.ok(fieldset,"actual Output input editor fieldset");
    fieldset.setAttribute("disabled","");assert.notEqual(field.disabled,true,"disabled inherited from real fieldset, not fabricated textarea flag");
    assert.equal(field.matches(":disabled"),true,"native pseudo-class port includes its emitted disabled fieldset");
  }
  const focus=native.nativeFocus.length,scroll=native.nativeScroll.length;
  for(let attempt=0;attempt<26;attempt++)reveal.run();
  assert.equal(native.nativeFocus.length,focus);assert.equal(native.nativeScroll.length,scroll);assert.equal(reveal.remaining(),0);
  assert.equal([...host.timers.values()].some(timer=>timer.delay===10000),false);
  host.document.querySelectorAll=previousOwnerQuery;
});

test("Store input reveal preserves an ordinary current source edit without a whole-version consent fence",async t=>{
  const x=await fixture(t),{f,native,start,target}=x;
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  f.appendEvent("BlockPropertyEdited",{block_id:"synthetic-1",property_path:"text",old_value:"Synthetic editable audience evidence 1",new_value:"A legitimate newly acknowledged source"});
  await f.settle();const field=target().field;
  reveal.run();assert.equal(native.document.activeElement,field);assert.equal(reveal.remaining(),0);
});

for(const locale of["en","ar"])test("Store input reveal cold native positive: "+locale,async t=>{
  const x=await fixture(t,locale,{warm:false}),reveal=x.start();assert.equal(await reveal.pending,true);
  await x.f.settle();const field=x.target().field;assert.ok(field);
  reveal.run();assert.equal(x.native.document.activeElement,field);
});

test("Store input reveal native bridge preserves focus identity, subtree lookup, events and independent timer ownership",async t=>{
  const x=await fixture(t),{f,host,start,target}=x;
  const routeSinks=Signal.subtle.introspectSinks(f.store.route).length,sessionSinks=Signal.subtle.introspectSinks(f.store.session).length;
  const reveal=start();assert.equal(await reveal.pending,true);await f.settle();
  const {owner,editor,field}=target();
  assert.equal(owner.ownerDocument,host.document);assert.equal(field.ownerDocument,host.document);
  assert.ok(editor.querySelectorAll("textarea").includes(field));assert.equal(field.closest(".block-editor"),editor);
  let observed=0;const listener=event=>{assert.equal(event.target,field);assert.equal(event.currentTarget,host.document);observed++;};
  host.document.addEventListener("focusin",listener,true);
  reveal.run();assert.equal(observed,1);assert.equal(host.document.activeElement,field);
  host.document.removeEventListener("focusin",listener,true);
  assert.equal(Signal.subtle.introspectSinks(f.store.route).length,routeSinks,"lease state watcher is removed");
  assert.equal(Signal.subtle.introspectSinks(f.store.session).length,sessionSinks);
  const unrelated=host.window.requestAnimationFrame(()=>assert.fail("unrelated native frame is not executed"));
  const canceled=host.window.requestAnimationFrame(()=>assert.fail("canceled native frame is not executed"));
  host.window.cancelAnimationFrame(canceled);assert.ok(host.timers.has(unrelated));assert.equal(host.timers.has(canceled),false);host.timers.delete(unrelated);
});

// Source checks pin the actual existing helpers/member boundary; they do not
// replace the full runtime/native cases above.
test("Store input reveal owns no paid or authored mutation and keeps one shared focus observer",()=>{
  const source=fs.readFileSync(new URL("../src/state/store.ts",import.meta.url),"utf8");
  const parsed=ts.createSourceFile("store.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length,0,"Store source parses before method-scoped inspection");
  const stores=parsed.statements.filter(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");
  assert.equal(stores.length,1,"one actual FormaStore class");
  const methods=stores[0].members.filter(node=>ts.isMethodDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="revealOutputInput");
  assert.equal(methods.length,1,"one actual revealOutputInput method");
  assert.ok(methods[0].body,"revealOutputInput has an implementation");
  const body=methods[0].getText(parsed);
  assert.equal(body.match(/captureOutputNavigationFocus\(document/g)?.length,1,"one shared focus observer");
  assert.ok(body.includes('this.openDocument(destinationDocumentId,destination,"output-input",{current,focus})'));
  assert.ok(body.includes("candidate?.focus===focus"));
  for(const forbidden of["addEventListener(",".append(",".appendBatch(","guardedFetch(","fetch(",".sourceEvents.join("])assert.equal(body.includes(forbidden),false,forbidden);
});

async function canvasSource(x){
  const {f,host}=x,documentId=f.store.projection.get().documentId;
  // Existing synthetic history, established BEFORE the audited gesture. It
  // makes the retained Document current on Canvas without inventing an API
  // bypass or replacing openDocument/transitionWorkspace.
  f.appendEvent("DocumentOpened",{document_id:documentId,previous_document_id:documentId});
  const session=f.store.session.get();
  f.store.session.set({...session,audience:"canvas",canvas:{...session.canvas,access:true}});
  f.store.route.set("/canvas");await f.settle();
  assert.equal(f.store.projection.get().documentId,documentId);
  assert.equal(f.components().filter(component=>component.tag==="forma-canvas-application").length,1,"actual Canvas source application");
  const gate=deferred(),body=deferred(),prior=host.intercept,reads=[];
  host.intercept=async request=>{
    if(request.url==="/api/session?audience=creative"){reads.push(request);return gate.promise;}
    if(request.url==="/api/workspaces/reviews")return Response.json({tasks:[]});
    return prior?.(request);
  };
  return{documentId,gate,body,reads,candidate:{...f.store.session.get(),audience:"creative"}};
}
const sourceWaitModes=["owned","focus","pointerdown","keydown","selection-aba","route-aba","epoch","epoch-aba","request-replaced","deadline","denied","body-focus"];
for(const locale of["en","ar"])for(const mode of sourceWaitModes)test("Store input reveal keeps ownership through actual Canvas session read: "+locale+" "+mode,async t=>{
  const x=await fixture(t,locale),source=await canvasSource(x),{f,host,native,start,target,language}=x;
  const route=f.store.route.get(),events=JSON.stringify(f.store.events.get()),from=host.requests.length;
  const reveal=start("synthetic-1",source.documentId);
  assert.equal(await reveal.pending,true,"existing openDocument may return before cross-audience session arrival");
  assert.equal(source.reads.length,1);assert.equal(f.store.route.get(),route);
  assert.notEqual(f.store.ui.editingBlockId,"synthetic-1","source selection is not an arrived Document editor");
  reveal.run();assert.equal(f.store.route.get(),route,"pending frame does not fabricate an arrival");
  if(mode==="focus")native.focus(language());
  else if(mode==="pointerdown"||mode==="keydown")native.emit(mode,language());
  else if(mode==="selection-aba"){const selection=f.store.ui.focusBlockId;f.store.ui.focusBlockId="synthetic-2";f.store.ui.focusBlockId=selection;}
  else if(mode==="route-aba"){f.store.route.set("/canvas?later=1");f.store.route.set(route);}
  else if(mode==="epoch"||mode==="epoch-aba"){const session=f.store.session.get();f.store.session.set({...session,permissionEpoch:"different-pending-scope"});if(mode==="epoch-aba")f.store.session.set(session);}
  else if(mode==="request-replaced")assert.equal(await f.store.revealOutputInput("missing-newer-input"),false);
  else if(mode==="deadline"){
    const timer=[...host.timers].find(([,timer])=>timer.delay===10000);assert.ok(timer);
    host.timers.delete(timer[0]);timer[1].callback();
  }
  if(mode==="body-focus"){
    const response=Response.json(source.candidate);
    response.json=()=>source.body.promise;source.gate.resolve(response);await pause();
    native.focus(language());
  }
  const focus=native.nativeFocus.length,scroll=native.nativeScroll.length;
  if(mode==="body-focus")source.body.resolve(source.candidate);
  else source.gate.resolve(Response.json(mode==="denied"?{error:"fixture access denied"}:source.candidate,{status:mode==="denied"?403:200}));
  await pause();await f.settle();
  if(mode==="owned"){
    assert.equal(f.store.route.get(),documentContextBlockRoute(source.documentId,f.store.projection.get().documentTitle,"synthetic-1"));
    let focused=false;
    for(let attempt=0;attempt<4&&!focused;attempt++){
      const field=target().field,calls=native.nativeFocus.length;reveal.run();
      if(native.nativeFocus.length>calls){assert.equal(native.document.activeElement===field,true,"exact current destination textarea");focused=true;}
      else await f.settle();
    }
    assert.equal(focused,true,"authorized asynchronous source session can complete its original reveal");
  }else{
    reveal.runCaptured();
    assert.equal(f.store.route.get(),route,"superseded/denied source read cannot move the view");
    assert.equal(native.nativeFocus.length,focus);assert.equal(native.nativeScroll.length,scroll);
    if(mode==="denied"){
      const timer=[...host.timers].find(([,timer])=>timer.delay===10000);assert.ok(timer,"failed void navigation has a bounded presentation lifetime");
      host.timers.delete(timer[0]);timer[1].callback();
    }
    assert.equal(reveal.remaining(),0);
  }
  assert.equal(JSON.stringify(f.store.events.get()),events);x.noCommands(from);
});

test("Store input reveal deadline cleans a permanently absent native owner without starting work",async t=>{
  const x=await fixture(t),{host,start,native}=x;
  const reveal=start();assert.equal(await reveal.pending,true);
  const timer=[...host.timers].find(([,timer])=>timer.delay===10000);assert.ok(timer);
  const focus=native.nativeFocus.length,scroll=native.nativeScroll.length;
  host.timers.delete(timer[0]);timer[1].callback();reveal.runCaptured();
  assert.equal(reveal.remaining(),0);assert.equal(native.nativeFocus.length,focus);assert.equal(native.nativeScroll.length,scroll);
});
