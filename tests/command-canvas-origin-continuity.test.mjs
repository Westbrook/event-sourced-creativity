// Actual complete Shell/Canvas/Desk/Store and RAM Worker. The existing finite
// native ports, source-seed helper and exact original free-Resume accounting are
// reused unchanged. No provider call, fabricated success or private app setter.
import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, OTHER_BOARD, OTHER_DOCUMENT, RAW, classed, drain, reached,
  dialogs, boardPage, sceneDeferred } from "./helpers/board-lifecycle-navigation-fixture.mjs";

function oneComponent(f,tag,predicate=()=>true){
  const matches=f.components().filter(value=>value.tag===tag&&value.isConnected&&predicate(value));
  assert.equal(matches.length,1,"one current actual "+tag);return matches[0];
}
function shell(f){
  const owner=oneComponent(f,"forma-shell");assert.equal(owner,f.host);
  assert.equal(owner.store,f.store,"the actual Shell and Canvas use the same existing Store");
  assert.equal(f.canvas.store,f.store);return owner;
}
async function togglePopover(f,popover,open){
  assert.ok(popover.isConnected);
  const trigger=f.find("button",row=>row.owner===popover&&classed(row,"ui-popover-trigger"));
  const panel=popover.querySelector(".ui-popover-panel"),id=trigger.attributes.popovertarget;
  assert.ok(id&&panel?.isConnected);assert.equal(panel.getAttribute("id"),id);
  assert.equal(trigger.attributes["aria-controls"],id);
  assert.equal(typeof trigger.port.click,"function");
  trigger.port.click();await f.settle();
  const current=popover.querySelector(".ui-popover-panel");
  assert.ok(current?.isConnected);assert.equal(current.getAttribute("id"),id);
  assert.equal(current.matches(":popover-open"),open,"the exact native target has the requested open state");
  const currentTrigger=f.find("button",row=>row.owner===popover&&classed(row,"ui-popover-trigger"));
  assert.equal(currentTrigger.attributes["aria-expanded"],String(open));
}
function dock(f){return oneComponent(f,"forma-ui-popover",value=>classed(value,"canvas-intent-dock"));}
function dockInput(f){return f.find("input",row=>row.attributes["aria-label"]==="Describe what you want to explore");}
async function rawDock(f){
  const owner=dock(f);await togglePopover(f,owner,true);
  const input=dockInput(f);input.port.value=RAW;await f.act(input,"input");
  assert.equal(dockInput(f).port.value,RAW);await togglePopover(f,owner,false);
  return owner;
}
async function toDesk(f){
  const view=oneComponent(f,"forma-ui-popover",value=>classed(value,"canvas-view-menu"));
  await togglePopover(f,view,true);
  await f.act(f.find("button",row=>row.attributes.id==="canvas-outcome-toggle"),"click",{button:0});
  await f.act(f.find("a",row=>Boolean(row.attributes.href)
    &&new URL(row.attributes.href,"http://localhost").searchParams.get("outcome")==="document:"+f.documentId),"click",{button:0});
  await drain(f,2);assert.ok(f.canvas.isConnected);
  assert.ok(f.tree().nodes.some(row=>row.owner===f.canvas&&!row.hiddenBy&&classed(row,"outcome-desk-selected")));
}
async function fromDesk(f){
  await f.act(f.find("a",row=>Boolean(row.attributes.href)
    &&row.parent?.attributes?.class==="outcome-desk-header"),"click",{button:0});
  await drain(f,2);assert.ok(f.canvas.isConnected);
}
async function command(f){
  const owner=shell(f);
  await f.act(f.find("button",row=>row.owner===owner&&classed(row,"command-trigger")));
  assert.equal(f.store.ui.commandOpen,true);
  const open=dialogs(f).filter(row=>row.owner===owner&&classed(row,"command-dialog"));
  assert.equal(open.length,1,"the current Shell owns the real native command dialog");
  const label=f.i18n.t("command.returnCreative","Return to Creator Workspace");
  const input=f.find("input",row=>row.owner===owner&&row.attributes.id==="command-search");
  input.port.value=label;await f.act(input,"input");
  const row=f.find("button",value=>value.owner===owner&&value.attributes.role==="option"
    &&value.children.some(child=>typeof child!=="string"&&child.tag==="span"&&child.text===label)
    &&value.children.some(child=>typeof child!=="string"&&child.tag==="small"&&child.text===f.i18n.t("shell.application","Application")));
  assert.ok(row.port.isConnected&&!row.hiddenBy&&!Object.hasOwn(row.attributes,"disabled"));
  return row;
}
function activateCommand(row){
  assert.equal(typeof row.port.click,"function");
  row.port.click(); // Existing native click port invokes the actual current handler.
}
async function arrived(f,actor){
  await reached(f,()=>f.store.route.get()==="/projects"&&!f.canvas.isConnected,"the actual Creator Projects destination replaces the board owner");
  assert.equal(f.store.ui.commandOpen,false);assert.equal(dialogs(f).length,0);
  assert.equal(f.store.session.get().user.userId,actor);
  assert.ok(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()));
  assert.ok(oneComponent(f,"forma-projects").isConnected);
  await f.sourceUnchanged();
}

test("actual Canvas empty listing permits a current Shell departure without a fabricated board scope",options,async t=>{
  const f=await boardPage(t),actor=f.store.session.get().user.userId;
  await f.act(f.find("a",row=>row.owner===f.canvas&&row.attributes.href==="/canvas"
    &&row.attributes["aria-label"]===f.i18n.t("canvas.backToProjectBoards","Back to project boards")),"click",{button:0});
  assert.equal(f.store.route.get(),"/canvas");
  // Explicit historical fixture changes through the existing exact source helper,
  // not a private projection mutation or a manufactured clean owner.
  await f.external("CanvasRemoved",{canvas_id:OTHER_BOARD});
  await f.external("CanvasRemoved",{canvas_id:BOARD});await drain(f,2);
  assert.equal(f.store.canvasProjection.get().canvases.length,0);
  assert.equal(f.store.canvasProjection.get().selectedCanvasId,"");
  assert.ok(f.canvas.isConnected);
  assert.ok(f.tree().nodes.some(row=>row.owner===f.canvas&&!row.hiddenBy&&classed(row,"canvas-home")));
  const row=await command(f);activateCommand(row);await arrived(f,actor);
});

test("actual clean Canvas board permits the same native Shell departure",options,async t=>{
  const f=await boardPage(t),actor=f.store.session.get().user.userId;
  assert.equal(f.store.canvasProjection.get().selectedCanvasId,BOARD);
  assert.equal(f.store.canvasPlanningDocumentId(),f.documentId);
  const row=await command(f);activateCommand(row);await arrived(f,actor);
});

for(const origin of ["canvas","desk"])test(
  "actual "+origin+" closed-dock raw Ask refuses command departure and native clear enables a fresh command",options,async t=>{
    const f=await boardPage(t),actor=f.store.session.get().user.userId,original=dock(f);
    assert.equal(await rawDock(f),original);
    if(origin==="desk")await toDesk(f);
    const route=f.store.route.get(),source=f.store.captureSourceOwnership();
    const row=await command(f),requests=f.storeHost.requests.length;
    activateCommand(row);await drain(f);
    await f.sourceUnchanged();
    assert.equal(f.store.route.get(),route,"a command does not discard the current raw board owner");
    assert.ok(f.canvas.isConnected);assert.ok(f.store.sourceOwnershipActive(source));
    assert.equal(f.store.ui.commandOpen,false);
    assert.equal(f.storeHost.requests.length,requests,"refusal starts no destination or proposal request");
    assert.equal(f.store.ui.toast,f.i18n.t("next.lifecycle.currentWorkOpen"));
    if(origin==="desk")await fromDesk(f);
    assert.equal(dock(f),original,"View/Desk and the refusal retained the original dock component");
    await togglePopover(f,original,true);
    assert.equal(dockInput(f).port.value,RAW,"the raw whitespace and multilingual text survive unchanged");
    const input=dockInput(f);input.port.value="";await f.act(input,"input");
    assert.equal(dockInput(f).port.value,"","only the deliberate current input clears this raw value");
    await togglePopover(f,original,false);
    const fresh=await command(f);activateCommand(fresh);await arrived(f,actor);
  });

for(const boundary of ["selection","same-source-item-incarnation"])test(
  "actual Canvas command refuses a later "+boundary+" during its original held session response",options,async t=>{
    const f=await boardPage(t),release=sceneDeferred(),prior=f.storeHost.intercept;
    const first=f.find("article",row=>row.owner===f.canvas&&row.attributes["data-canvas-item-id"]==="lifecycle-card-a");
    // Exact same current-node composed path used by the existing board host cases.
    await f.act(first,"click",{composedPath:()=>[first.port]});
    assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds,["lifecycle-card-a"]);
    assert.equal(f.store.canvasPlanningDocumentId(),f.documentId);
    const originalBindings=f.store.eventView.get().filter(event=>event.type==="CanvasItemPlaced"
      &&event.payload.canvas_id===BOARD&&event.payload.item_id==="lifecycle-card-a").map(event=>event.eventId);
    assert.ok(originalBindings.length);
    let entered=false,returned=false,reads=0;
    f.storeHost.intercept=async request=>{
      if(request.url!=="/api/session?audience=creative")return prior?.(request);
      assert.equal(request.init.method??"GET","GET");assert.equal(++reads,1,"one original session response is held");
      const response=await f.storeHost.worker.request(request.url,request.init);
      assert.equal(response.status,200,"the original authorized Worker response exists before the newer action");
      entered=true;await release.promise;returned=true;return response;
    };
    try{
      const route=f.store.route.get(),row=await command(f);
      activateCommand(row);
      await reached(f,()=>entered,"the real current command reached its session response");
      assert.equal(f.store.ui.commandOpen,false);assert.equal(f.store.route.get(),route);
      assert.ok(f.canvas.isConnected);assert.equal(dialogs(f).length,0,"the palette is closed, so the new board action is legal");
      if(boundary==="selection"){
        const next=f.find("article",value=>value.owner===f.canvas&&value.attributes["data-canvas-item-id"]==="lifecycle-card-b");
        await f.act(next,"click",{composedPath:()=>[next.port]});
        assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds,["lifecycle-card-b"]);
        assert.equal(f.store.canvasPlanningDocumentId(),OTHER_DOCUMENT);
      }else{
        await f.external("CanvasItemPlaced",{canvas_id:BOARD,item_id:"lifecycle-card-a",source_kind:"document",
          source_id:f.documentId,title:"Same Document, newly placed item incarnation",frame:{x:0,y:0,w:300,h:200,z:"a",rot:0}});
        await drain(f,2);
        assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds,["lifecycle-card-a"]);
        assert.equal(f.store.canvasPlanningDocumentId(),f.documentId);
        const current=f.store.eventView.get().filter(event=>event.type==="CanvasItemPlaced"
          &&event.payload.canvas_id===BOARD&&event.payload.item_id==="lifecycle-card-a").map(event=>event.eventId);
        assert.notEqual(current.at(-1),originalBindings.at(-1),"the exact selected item was replaced, not merely renamed or reordered");
      }
      const focus=f.native.nativeFocus.length,currentRoute=f.store.route.get();
      release.resolve();await drain(f);
      assert.equal(returned,true);assert.equal(reads,1);
      await f.sourceUnchanged();
      assert.equal(f.store.route.get(),currentRoute,"the original response cannot adopt over the newer exact board owner");
      assert.ok(f.canvas.isConnected);assert.equal(dialogs(f).length,0);
      assert.equal(f.native.nativeFocus.length,focus,"no late command focus follows the refused handoff");
    }finally{
      release.resolve();await drain(f);f.storeHost.intercept=prior;
    }
  });
