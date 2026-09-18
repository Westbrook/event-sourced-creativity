import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Full production Canvas/Popover/LocaleController classes and the existing
// deterministic native ports. No Worker, trusted physical input, viewport or AT claim.
const fixtureUrl=new URL("./canvas-calm-controls-host.test.mjs",import.meta.url);
const fixtureSource=await readFile(fixtureUrl,"utf8");
const tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const first=tree.statements.findIndex(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="test");
assert.ok(first>0);
const helperNames=["ownedPopover","openOwnedPopover","organizeEvent","runPortHandler"];
const helpers=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&helperNames.includes(node.name?.text));
assert.equal(helpers.length,helperNames.length);
const fixtureModule=[...tree.statements.slice(0,first),...helpers].map(node=>node.getFullText(tree)).join("\n")
  +"\nexport { fixture, ownedPopover, openOwnedPopover, organizeEvent, documentPort };\n";
const fixtureModuleUrl=new URL(fixtureUrl);fixtureModuleUrl.search="?canvas-owned-action-focus";
const hook=registerHooks({load(url,context,next){return url===fixtureModuleUrl.href?{format:"module",source:fixtureModule,shortCircuit:true}:next(url,context);}});
let fixture,ownedPopover,openOwnedPopover,organizeEvent,documentPort;
try{({fixture,ownedPopover,openOwnedPopover,organizeEvent,documentPort}=await import(fixtureModuleUrl.href));}finally{hook.deregister();}

function setup(t,locale,options={}){
  const deniedFetch=t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or application network is allowed in these component tests."));
  const f=fixture({populated:true,documentCount:2,artifact:true,locale,...options});
  documentPort.activeElement=documentPort.body;
  t.after(()=>{
    f.host.isConnected=false;f.host.disconnectedCallback();
    for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
    f.i18n.hostDisconnected();
    assert.equal(deniedFetch.mock.callCount(),0);
  });
  return f;
}
function moreAction(f,value="remove"){
  const owned=ownedPopover(f,"canvas-selection-more"),index=owned.menu.actions.findIndex(action=>action.value===value);
  const button=f.renderer.ownNodes(owned.menu,"button").filter(node=>!node.attributes.popovertarget)[index];
  assert.ok(index>=0&&button);
  return {...owned,button,action:owned.menu.actions[index],callback:button.handlers.click};
}
function invoke(owned,target=owned.button){return owned.callback.call(owned.menu,organizeEvent("click",target));}
function selectWithoutRender(f,index){
  const item=f.native("article",node=>node.attributes["data-canvas-item-id"]==="item-block-"+index);
  assert.ok(item);item.handlers.click.call(f.host,{...organizeEvent("click",item),shiftKey:false,composedPath:()=>[item]});
}
function expectNoAction(f,before,trace){
  assert.deepEqual(f.state.events,before);assert.equal(f.state.batches.length,0);assert.equal(f.state.requests.length,0);
  assert.deepEqual(f.trace,trace,"expired action must not close, focus, announce, or dispatch");
}
const menuBoundaries=["dismissed","dismissed-updated","same-opening-replaced-row","reopened","reopened-before-update","selection-before-update","selection-after-update","route-before-update","route-after-update","authorization","reader","removed-item","disconnected"];
for(const locale of ["en","fr","ar","ja"]){
  for(const boundary of menuBoundaries)test("Other ways "+locale+": expired "+boundary+" action is inert before all effects",async t=>{
    const f=setup(t,locale);await f.select(0);openOwnedPopover(f,"canvas-selection-more");const old=moreAction(f);
    if(boundary.startsWith("dismissed")){old.panel.hidePopover();if(boundary.endsWith("updated"))f.draw();}
    else if(boundary==="same-opening-replaced-row")old.menu.actions=old.menu.actions.map(action=>({...action}));
    else if(boundary==="reopened"){old.panel.hidePopover();f.draw();openOwnedPopover(f,"canvas-selection-more");}
    else if(boundary==="reopened-before-update"){old.panel.hidePopover();old.panel.showPopover();}
    else if(boundary==="selection-before-update")selectWithoutRender(f,1);
    else if(boundary==="selection-after-update"){await f.select(1);openOwnedPopover(f,"canvas-selection-more");}
    else if(boundary.startsWith("route-")){f.route=f.store.route.get()+"?focus=1";if(boundary.endsWith("after-update"))f.draw();}
    else if(boundary==="authorization")f.state.authorization="actor-b";
    else if(boundary==="reader")f.state.viewer=true;
    else if(boundary==="removed-item")await f.store.append({type:"CanvasItemRemoved",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-block-0"}});
    else if(boundary==="disconnected"){f.host.isConnected=false;f.host.disconnectedCallback();}
    const before=structuredClone(f.state.events),trace=[...f.trace],open=new Set(f.openPopovers),focus=documentPort.activeElement;
    invoke(old);
    expectNoAction(f,before,trace);assert.deepEqual(f.openPopovers,open);assert.equal(documentPort.activeElement,focus);
    if(boundary.startsWith("reopened")||boundary==="selection-after-update"){
      if(boundary==="reopened-before-update")f.draw();
      const current=moreAction(f);assert.equal(current.panel.matches(":popover-open"),true,"a newer panel stays open");
      invoke(current);await f.flush();
      assert.deepEqual(f.state.events.slice(before.length).filter(event=>event.type==="CanvasItemRemoved").map(event=>event.payload.item_id),[boundary.startsWith("reopened")?"item-block-0":"item-block-1"]);
      assert.equal(f.state.batches.length,1);assert.equal(f.state.requests.length,0);
    }
  });
  for(const value of ["combine","document","remove"])test("Other ways "+locale+": current "+value+" hands off exactly once to its existing executor",async t=>{
    const f=setup(t,locale);await f.select(0);openOwnedPopover(f,"canvas-selection-more");const owned=moreAction(f,value);
    assert.equal(owned.menu.label,f.i18n.t("canvas.controls.otherWays","Other ways"));
    assert.equal(owned.action.label,f.i18n.system({combine:"Combine",document:"Create document",remove:"Remove"}[value]));
    const before=f.state.events.length;f.trace.length=0;
    invoke(owned);
    assert.equal(owned.panel.matches(":popover-open"),false);
    assert.equal(f.trace.filter(value=>value==="event:forma-action").length,1);
    assert.ok(f.trace.findIndex(value=>value.includes("ui-popover-trigger"))<f.trace.indexOf("event:forma-action"));
    const trace=[...f.trace];invoke(owned);assert.deepEqual(f.trace,trace,"a second invocation of the same closed opening is inert");
    await f.flush();
    if(value==="remove"){
      assert.deepEqual(f.state.events.slice(before).map(event=>[event.type,event.payload.item_id]),[["CanvasItemRemoved","item-block-0"]]);
      assert.equal(f.state.batches.length,1);
    }else{
      assert.equal(f.state.events.length,before);assert.equal(f.state.batches.length,0);
      assert.ok(f.renderer.query(f.host,value==="combine"?".canvas-combine-dialog":".canvas-document-dialog").length);
    }
    assert.equal(f.state.requests.length,0);
  });
  test("shared popover "+locale+": exact row, native target, disabled state and throwing predicate are checked before handoff",async t=>{
    for(const boundary of ["value","row-disabled","button-disabled","wrong-button","predicate-false","predicate-throws"]){
      const f=setup(t,locale);await f.select(0);openOwnedPopover(f,"canvas-selection-more");const old=moreAction(f),before=structuredClone(f.state.events);
      if(boundary==="value")old.action.value="document";
      if(boundary==="row-disabled")old.action.disabled=true;
      if(boundary==="button-disabled")old.button.setAttribute("disabled","");
      if(boundary==="predicate-false")old.menu.actionCurrent=()=>false;
      if(boundary==="predicate-throws")old.menu.actionCurrent=()=>{throw Error("withdrawn opening");};
      const target=boundary==="wrong-button"?moreAction(f,"combine").button:old.button,trace=[...f.trace],focus=documentPort.activeElement;
      invoke(old,target);expectNoAction(f,before,trace);assert.equal(documentPort.activeElement,focus);assert.equal(old.panel.matches(":popover-open"),true);
      old.menu.close();f.host.isConnected=false;f.host.disconnectedCallback();
    }
  });
}

async function openDrawer(f,drawer){
  if(drawer==="sources")return f.sources();
  await f.select(0,"document");
  return f.click("button",node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
}
function beginClose(f,drawer){
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;}),tick=f.tick;
  f.tick=()=>pending;
  const label=drawer==="sources"?f.i18n.t("canvas.controls.closeSources","Close sources"):f.i18n.system("Close document outputs");
  const closer=f.native("button",node=>node.attributes["aria-label"]===label);assert.ok(closer);
  closer.focus();closer.handlers.click.call(f.host,organizeEvent("click",closer));f.draw();
  assert.equal(f.renderer.query(f.host,"dialog[open]").length,0);
  return {tick,async settle(failed=false){if(failed)reject(Error("superseded render"));else resolve(true);await Promise.resolve();await Promise.resolve();await Promise.resolve();f.tick=tick;}};
}
const focusBoundaries=["current","newer-focus","pointer","key","focus-return","route","authorization","selection","reopened","disconnected","rejected-update"];
for(const locale of ["en","fr","ar","ja"])for(const drawer of ["sources","outputs"])for(const boundary of focusBoundaries)
  test("Canvas "+drawer+" "+locale+": delayed return focus owns only "+boundary,async t=>{
    const f=setup(t,locale),opener=await openDrawer(f,drawer),before=structuredClone(f.state.events);
    const baseline=Object.fromEntries(["pointerdown","keydown","focusin"].map(type=>[type,(f.listeners.get(type)??[]).length]));
    const pending=beginClose(f,drawer);
    assert.equal((f.listeners.get("pointerdown")??[]).length,baseline.pointerdown+1);
    let desired=opener;
    const newer=()=>{const control=f.native("button",node=>String(node.attributes.class).includes("canvas-focus-toggle"));assert.ok(control?.isConnected);return control;};
    if(boundary==="newer-focus"){desired=newer();desired.focus();}
    else if(boundary==="pointer"){documentPort.emit("pointerdown",newer());desired=documentPort.activeElement;}
    else if(boundary==="key"){documentPort.emit("keydown",newer());desired=documentPort.activeElement;}
    else if(boundary==="focus-return"){newer().focus();opener.focus();desired=opener;}
    else if(boundary==="route"){f.route=f.store.route.get()+"?focus=1";desired=documentPort.activeElement;}
    else if(boundary==="authorization"){f.state.authorization="actor-b";desired=documentPort.activeElement;}
    else if(boundary==="selection"){selectWithoutRender(f,1);desired=documentPort.activeElement;}
    else if(boundary==="reopened"){
      await openDrawer(f,drawer);
      const label=drawer==="sources"?f.i18n.t("canvas.controls.closeSources","Close sources"):f.i18n.system("Close document outputs");
      desired=f.native("button",node=>node.attributes["aria-label"]===label);assert.ok(desired?.isConnected);desired.focus();
    }else if(boundary==="disconnected"){f.host.isConnected=false;f.host.disconnectedCallback();desired=documentPort.activeElement;}
    else if(boundary==="rejected-update")desired=documentPort.activeElement;
    f.trace.length=0;
    await pending.settle(boundary==="rejected-update");
    assert.equal(documentPort.activeElement,desired);
    if(boundary==="current")assert.deepEqual(f.trace.filter(value=>value.startsWith("focus:")),["focus:"+opener.attributes.class]);
    else assert.deepEqual(f.trace.filter(value=>value.startsWith("focus:")),[],"a later intent or withdrawn opening permanently cancels the old focus effect");
    assert.deepEqual(f.state.events,before);assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
    for(const type of ["pointerdown","keydown","focusin"])assert.equal((f.listeners.get(type)??[]).length,boundary==="disconnected"&&type==="keydown"?baseline[type]-1:baseline[type],type+" observer is disposed on this terminal path");
    if(boundary==="reopened")assert.equal(f.renderer.query(f.host,"dialog[open]").length,1,"the current drawer remains open");
  });

test("Canvas native ports preserve connected invoker identity and report real focus and close transitions",async t=>{
  const f=setup(t,"en");await f.select(0);const first=ownedPopover(f,"canvas-selection-more");
  f.draw();const same=ownedPopover(f,"canvas-selection-more");assert.equal(same.trigger,first.trigger);assert.equal(same.panel,first.panel);
  const events=[],listener=event=>events.push([event.type,event.target]);
  documentPort.addEventListener("focusin",listener,true);same.trigger.focus();assert.deepEqual(events,[["focusin",same.trigger]]);
  documentPort.removeEventListener("focusin",listener,true);
  const opened=openOwnedPopover(f,"canvas-selection-more"),action=moreAction(f);
  assert.equal(action.button.parentElement,opened.panel);
  assert.equal(opened.panel.querySelectorAll(":scope > button[data-forma-action]")[2],action.button);
  opened.panel.hidePopover();assert.equal(opened.panel.matches(":popover-open"),false);
  await f.select(1);assert.equal(opened.menu.isConnected,false);assert.equal(action.button.isConnected,false);
  assert.equal(f.state.requests.length,0);
});
