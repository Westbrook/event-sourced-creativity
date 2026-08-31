import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, OTHER_BOARD, OTHER_DOCUMENT, RAW, classed, drain, dialogs, activate, cards, currentActions, priority, boardPage, sceneDeferred } from "./helpers/board-lifecycle-navigation-fixture.mjs";
// These additional boundaries exercise the same newly rendered current card.
// Baseline missing-priority failures are not mistaken for reached ownership observations.
for(const boundary of["selection","planning-document","board","source","authority","keydown"])
test("actual current board source handoff refuses later "+boundary+" during its genuine session read",options,async t=>{
  const f=await boardPage(t,{mode:"source"}),{button}=priority(f,t,"source-block"),entered=sceneDeferred(),release=sceneDeferred();
  f.storeHost.intercept=async request=>{if(request.url!=="/api/session?audience=creative")return;
    const response=await f.storeHost.worker.request(request.url,request.init);assert.equal(response.status,200);entered.resolve();await release.promise;return response;};
  activate(f,button);await entered.promise;
  if(boundary==="selection"){
    const article=f.find("article",row=>row.attributes["data-canvas-item-id"]==="lifecycle-card-b");await f.act(article,"click",{composedPath:()=>[article.port]});
  }else if(boundary==="planning-document")assert.equal(f.store.chooseCanvasPlanningDocument(OTHER_DOCUMENT),true);
  else if(boundary==="board")f.store.setRoute("/canvas/"+OTHER_BOARD+"/other-authorized-board");
  else if(boundary==="source")await f.external("BlockPropertyEdited",{document_id:f.documentId,block_id:"scene-reuse-direction",property_path:"text",new_value:"A newer current source"});
  else if(boundary==="authority")f.store.session.set({...f.store.session.get(),permissionEpoch:"newer-current-authority"});
  else f.native.emit("keydown");
  const route=f.store.route.get(),focus=f.native.nativeFocus.length;release.resolve();await drain(f);
  assert.equal(f.store.route.get(),route);assert.equal(f.native.nativeFocus.length,focus,"no obsolete Document focus");
  assert.equal(dialogs(f).length,0);await f.sourceUnchanged();
});

async function openNativePopover(f,popover){
  assert.ok(popover.isConnected);
  const trigger=f.find("button",row=>row.owner===popover&&classed(row,"ui-popover-trigger"));
  assert.ok(trigger.port?.isConnected&&!Object.hasOwn(trigger.attributes,"disabled"));
  const panel=popover.querySelector(".ui-popover-panel"),id=trigger.attributes.popovertarget;
  assert.ok(id&&panel?.isConnected);assert.equal(panel.getAttribute("id"),id);
  assert.equal(trigger.attributes["aria-controls"],id);
  assert.equal(typeof trigger.port.click,"function");
  // Existing native port delivers the actual handler and declarative default.
  trigger.port.click();await f.settle();
  assert.ok(f.components().includes(popover),"the same current popover remains mounted");
  const currentPanel=popover.querySelector(".ui-popover-panel");
  assert.ok(currentPanel?.isConnected);assert.equal(currentPanel.getAttribute("id"),id);
  assert.equal(currentPanel.matches(":popover-open"),true,"exact native target really opened");
  const currentTrigger=f.find("button",row=>row.owner===popover&&classed(row,"ui-popover-trigger"));
  assert.equal(currentTrigger.attributes.popovertarget,id);assert.equal(currentTrigger.attributes["aria-expanded"],"true");
  assert.equal(f.tree().nodes.find(row=>row.port===currentPanel&&row.owner===popover)?.hiddenBy,null);
}

for(const origin of["canvas","desk"])test("actual "+origin+" raw board Ask survives a recommendation without a request",options,async t=>{
  const f=await boardPage(t,{origin:"canvas",mode:"source"});priority(f,t,"source-block");
  const popover=f.components().find(value=>value.tag==="forma-ui-popover"&&classed(value,"canvas-intent-dock"));assert.ok(popover);
  await openNativePopover(f,popover);
  const input=f.find("input",row=>row.attributes["aria-label"]==="Describe what you want to explore");input.port.value=RAW;await f.act(input,"input");
  popover.close();await f.settle();
  if(origin==="desk"){
    // Draft in the visible Canvas dock, then use the actual current View and
    // exact Document controls. The hidden Canvas stage is never interacted with.
    const view=f.components().find(value=>value.tag==="forma-ui-popover"&&classed(value,"canvas-view-menu"));assert.ok(view);
    await openNativePopover(f,view);
    await f.act(f.find("button",row=>row.attributes.id==="canvas-outcome-toggle"),"click",{button:0});
    await f.act(f.find("a",row=>Boolean(row.attributes.href)
      &&new URL(row.attributes.href,"http://localhost").searchParams.get("outcome")==="document:"+f.documentId),"click",{button:0});
    f.origin="desk";await drain(f,2);priority(f,t,"source-block");assert.ok(f.canvas.isConnected);
  }
  const route=f.store.route.get(),requests=f.storeHost.requests.length;
  // Re-read the connected card after the native field edit, not a stale port.
  activate(f,cards(f)[0].button);await drain(f);
  assert.ok(f.canvas.isConnected);assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,requests);
  if(origin==="desk")await f.act(f.find("a",row=>Boolean(row.attributes.href)
    &&row.parent?.attributes?.class==="outcome-desk-header"),"click",{button:0});
  const current=f.components().find(value=>value===popover);assert.ok(current);
  await openNativePopover(f,current);
  assert.equal(f.find("input",row=>row.attributes["aria-label"]==="Describe what you want to explore").port.value,RAW);
  assert.equal(f.store.ui.toast,f.i18n.t("next.lifecycle.currentWorkOpen"));await f.sourceUnchanged();
});

test("a closed Canvas source draft stays raw and blocks a Document recommendation",options,async t=>{
  const f=await boardPage(t,{mode:"source"});priority(f,t,"source-block");
  await f.act(f.find("button",row=>classed(row,"canvas-sources-toggle")));
  await f.act(f.find("button",row=>row.attributes["data-choice-value"]==="context"));
  const text=f.find("textarea",row=>row.owner===f.canvas);text.port.value=RAW;await f.act(text,"input");
  await f.act(f.find("button",row=>row.attributes["aria-label"]===f.i18n.t("canvas.controls.closeSources")));
  const route=f.store.route.get(),requests=f.storeHost.requests.length;activate(f,cards(f)[0].button);await drain(f);
  assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,requests);assert.ok(f.canvas.isConnected);
  await f.act(f.find("button",row=>classed(row,"canvas-sources-toggle")));
  assert.equal(f.find("textarea",row=>row.owner===f.canvas).port.value,RAW,"no unmount/replacement of the unsent native-source value");
  assert.equal(f.store.ui.toast,f.i18n.t("next.lifecycle.currentWorkOpen"));await f.sourceUnchanged();
});

for(const boundary of["healthy","before-render-key","before-updated-key","selection-aba"])
test("current local Canvas image "+boundary+" owns native promotion without a transient stale dialog",options,async t=>{
  const f=await boardPage(t),outputId="board-lifecycle-current-image";
  await f.external("GenerationCompleted",{document_id:f.documentId,canvas_id:BOARD,generation_id:outputId,object_ids:[outputId],
    title:"Current board saved image",provider:"in-memory-saved-metadata",model_id:"fixture-saved-image",media_url:"/api/media/"+outputId,media_type:"image/png",image_width:640,image_height:480});
  await f.external("ObjectSaved",{document_id:f.documentId,object_id:outputId});await drain(f,2);
  if(boundary==="selection-aba"){
    const article=f.find("article",row=>row.attributes["data-canvas-item-id"]==="lifecycle-card-a");await f.act(article,"click",{composedPath:()=>[article.port]});
  }
  const expected=currentActions(f).find(action=>action.target.kind==="output");assert.equal(expected?.target.outputId,outputId);
  const chosen=cards(f).filter(row=>row.id===expected.id);assert.equal(chosen.length,1);
  const tick=f.tick,collect=f.renderer.collect.bind(f.renderer),start=f.trace.length;let entered=false,sawClosed=false;
  f.tick=async component=>{
    if(boundary==="before-render-key"&&!entered&&component===f.canvas){entered=true;f.native.emit("keydown");}
    return tick(component);
  };
  f.renderer.collect=(markup,owner)=>{
    const count=f.renderer.nodes.length;collect(markup,owner);
    const dialog=f.renderer.nodes.slice(count).find(node=>node.owner===f.canvas&&classed(node,"canvas-output-viewer"));
    if(!dialog||entered||boundary==="before-render-key")return;
    entered=true;sawClosed=!dialog.open;
    assert.equal(dialog.open,false,"the owned new image is closed at DOM commit, before the actual updated promotion check");
    if(boundary==="before-updated-key")f.native.emit("keydown");
    if(boundary==="selection-aba"){
      const nodes=f.renderer.nodes.filter(node=>node.owner===f.canvas);
      const a=nodes.find(node=>node.getAttribute("data-canvas-item-id")==="lifecycle-card-a"),b=nodes.find(node=>node.getAttribute("data-canvas-item-id")==="lifecycle-card-b");
      assert.ok(a?.isConnected&&b?.isConnected,"both selection gestures address current committed Canvas nodes");
      f.native.emit("pointerdown",b);
      for(const node of[b,a])node.handlers.click.call(f.canvas,{target:node,currentTarget:node,composedPath:()=>[node],preventDefault(){},stopPropagation(){}});
    }
  };
  activate(f,chosen[0].button);await drain(f);
  assert.equal(entered,true,"the intended native render boundary was reached");
  if(boundary!=="before-render-key")assert.equal(sawClosed,true);
  const open=dialogs(f).filter(row=>classed(row,"canvas-output-viewer"));
  if(boundary==="healthy"){
    assert.equal(open.length,1);assert.ok(f.canvas.isConnected);
    f.native.emit("keydown",open[0].port);await drain(f,2);assert.equal(dialogs(f).filter(row=>classed(row,"canvas-output-viewer")).length,1);
  }else{
    assert.equal(open.length,0);
    assert.equal(f.trace.slice(start).some(value=>value.startsWith("open:")&&value.includes("canvas-output-viewer")),false,
      "an eventual false return or subsequent render cannot excuse obsolete native promotion");
  }
  await f.sourceUnchanged();
});
