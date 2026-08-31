import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, OTHER_DOCUMENT, classed, drain, reached, dialogs, activate, cards, currentActions, boardPage } from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";

// This is an actual opening pipeline with one finite source publication at its
// public Workspace updateComplete boundary. No app method is extracted/replaced,
// permission is fabricated, or private draft/response is supplied by the test.
for(const boundary of["healthy","board-removed","selected-item-repointed"])
test("original board "+boundary+" remains bound after its intentional Document handoff",options,async t=>{
  const timingStart=performance.now();
  const timing=stage=>t.diagnostic("BOARD_HANDOFF_TIMING "+JSON.stringify({boundary,stage,elapsedMs:performance.now()-timingStart}));
  timing("setup.before");
  const f=await boardPage(t);
  timing("setup.after");
  const article=f.find("article",row=>row.owner===f.canvas&&row.attributes["data-canvas-item-id"]==="lifecycle-card-a");
  await f.act(article,"click",{composedPath:()=>[article.port]});
  assert.equal(f.store.canvasPlanningSelection.get().canvasId,BOARD);
  assert.equal(f.store.canvasPlanningSelection.get().scope,f.store.captureAuthorizationScope().key);
  assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds,["lifecycle-card-a"]);
  const action=currentActions(f).find(value=>value.target.kind==="configure");
  assert.ok(action);assert.equal(action.target.medium,null);assert.equal(action.target.canvasId,BOARD);
  const rows=cards(f).filter(value=>value.id===action.id);assert.equal(rows.length,1);
  const tick=f.tick;let entered=false,traceStart=-1,sourceGeneration;const observations=[];
  f.tick=async component=>{
    const result=await tick(component);
    if(!entered&&component.tag==="forma-workspace"&&!f.canvas.isConnected
      &&documentIdFromRoute(f.store.route.get())===f.documentId){
      entered=true;sourceGeneration=f.store.captureSourceOwnership()?.generation;
      timing("handoff.entered");
      assert.equal(dialogs(f).length,0,"the actual destination is mounted before any configuration dialog");
      assert.equal(f.store.session.get().canvas.access,true);traceStart=f.trace.length;
      const original=foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD);
      assert.ok(original.canvases.some(value=>value.id===BOARD));
      assert.equal(original.items.find(value=>value.id==="lifecycle-card-a")?.sourceId,f.documentId);
      if(boundary==="board-removed")await f.external("CanvasRemoved",{canvas_id:BOARD});
      else if(boundary==="selected-item-repointed")await f.external("CanvasItemPlaced",{
        canvas_id:BOARD,item_id:"lifecycle-card-a",source_kind:"document",source_id:OTHER_DOCUMENT,
        title:"Current replacement planning Document",frame:{x:0,y:0,w:300,h:200,z:"a",rot:0},
      });
      const current=foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD);
      observations.push({boundary,canvasConnected:f.canvas.isConnected,documentId:documentIdFromRoute(f.store.route.get()),
        originalBoardPresent:current.canvases.some(value=>value.id===BOARD),
        selectedSource:current.items.find(value=>value.id==="lifecycle-card-a")?.sourceId??null,
        currentSource:f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),canvasAccess:f.store.session.get().canvas.access});
      timing("handoff.before-return");
    }
    return result;
  };
  timing("activation.before");
  activate(f,rows[0].button);
  timing("activation.returned");
  timing("reached.before");
  await reached(f,()=>entered,"the exact original caller has unmounted and the existing destination update boundary is reached");
  timing("reached.after");
  timing("drain.before");
  await drain(f,12);
  timing("drain.after");
  timing("body-verification.before");
  assert.equal(observations.length,1);assert.equal(f.canvas.isConnected,false);
  assert.equal(f.store.captureSourceOwnership()?.generation,sourceGeneration,"same authorized source, not a synthetic principal retirement");
  assert.equal(f.store.session.get().canvas.access,true);assert.equal(f.store.projection.get().documentId,f.documentId);
  const current=foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD);
  const open=dialogs(f).filter(value=>classed(value,"next-format-dialog"));
  t.diagnostic("BOARD_AFTER_HANDOFF "+JSON.stringify({observations,open:open.length,
    nativePromotions:f.trace.slice(traceStart).filter(value=>value.startsWith("open:")&&value.includes("next-format-dialog"))}));
  if(boundary==="healthy"){
    assert.equal(open.length,1,"the same valid original board is not rejected merely because its host intentionally unmounted");
    assert.equal(current.items.find(value=>value.id==="lifecycle-card-a")?.sourceId,f.documentId);
  }else{
    if(boundary==="board-removed")assert.equal(current.canvases.some(value=>value.id===BOARD),false);
    else assert.equal(current.items.find(value=>value.id==="lifecycle-card-a")?.sourceId,OTHER_DOCUMENT);
    assert.equal(open.length,0,"an obsolete original board/selected source cannot promote a Document preparation");
    assert.equal(f.trace.slice(traceStart).some(value=>value.startsWith("open:")&&value.includes("next-format-dialog")),false,
      "a later close is not evidence against transient stale promotion");
  }
  await f.sourceUnchanged();
  timing("body-verification.after");
});


// Same public Workspace updateComplete boundary as the original three cases.
// Explicit RAM domain events are fixture-controlled source changes, never user
// writes, provider results, or a replacement of the application opening path.
for(const boundary of["board-aba","selected-source-aba","selected-geometry","board-rename","unselected-source"])
test("after-unmount board custody "+boundary+" preserves only the original binding lifetime",options,async t=>{
  const timingStart=performance.now();
  const timing=stage=>t.diagnostic("BOARD_HANDOFF_TIMING "+JSON.stringify({boundary,stage,elapsedMs:performance.now()-timingStart}));
  timing("setup.before");
  const f=await boardPage(t);
  timing("setup.after");
  const article=f.find("article",row=>row.owner===f.canvas&&row.attributes["data-canvas-item-id"]==="lifecycle-card-a");
  await f.act(article,"click",{composedPath:()=>[article.port]});
  assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds,["lifecycle-card-a"]);
  const source=f.store.captureSourceOwnership(),authority=f.store.captureAuthorizationScope();
  assert.ok(source&&authority);assert.ok(f.store.sourceOwnershipActive(source));
  const action=currentActions(f).find(value=>value.target.kind==="configure");
  assert.ok(action);assert.equal(action.target.medium,null);assert.equal(action.target.canvasId,BOARD);
  assert.equal(action.target.documentId,f.documentId);
  const rows=cards(f).filter(value=>value.id===action.id);assert.equal(rows.length,1);
  const tick=f.tick;let entered=false,completed=false,traceStart=-1;const observations=[];
  const place=(item,documentId)=>({canvas_id:BOARD,item_id:item.id,source_kind:"document",source_id:documentId,
    title:item.title,body:item.body,block_type:item.blockType,frame:{x:item.x,y:item.y,w:item.w,h:item.h,z:item.z,rot:item.rot}});
  f.tick=async component=>{
    const result=await tick(component);
    if(!entered&&component.tag==="forma-workspace"&&!f.canvas.isConnected
      &&documentIdFromRoute(f.store.route.get())===f.documentId){
      entered=true;traceStart=f.trace.length;
      timing("handoff.entered");
      assert.equal(dialogs(f).length,0,"the current destination exists before native preparation promotion");
      assert.ok(f.store.sourceOwnershipActive(source));assert.ok(f.store.authorizationScopeActive(authority));
      const before=foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD);
      const selected=before.items.find(value=>value.id==="lifecycle-card-a");
      const unselected=before.items.find(value=>value.id==="lifecycle-card-b");
      const originalBoard=before.canvases.find(value=>value.id===BOARD);
      assert.ok(selected&&unselected&&originalBoard);assert.equal(selected.sourceId,f.documentId);
      assert.equal(unselected.sourceId,OTHER_DOCUMENT);
      const originalEvents=new Set(f.store.eventView.get().map(event=>event.eventId));
      if(boundary==="board-aba"){
        await f.external("CanvasRemoved",{canvas_id:BOARD});
        assert.equal(foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD).canvases.some(value=>value.id===BOARD),false);
        await f.external("CanvasRestored",{canvas_id:BOARD});
      }else if(boundary==="selected-source-aba"){
        await f.external("CanvasItemPlaced",place(selected,OTHER_DOCUMENT));
        assert.equal(foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD).items.find(value=>value.id===selected.id)?.sourceId,OTHER_DOCUMENT);
        await f.external("CanvasItemPlaced",place(selected,f.documentId));
      }else if(boundary==="selected-geometry"){
        await f.external("CanvasRegisterSet",{canvas_id:BOARD,item_id:selected.id,operation:{
          object:{kind:"canvas_item",item_id:selected.id},prop:"x",value:selected.x+27,
          hlc:{pt:Date.now(),c:0,site:"experience-custody-fixture"},
        }});
      }else if(boundary==="board-rename"){
        await f.external("CanvasRenamed",{canvas_id:BOARD,new_name:originalBoard.name+" — clearer name"});
      }else await f.external("CanvasItemPlaced",place(unselected,f.documentId));
      const after=foldCanvasEvents(f.store.eventView.get(),f.projectId,BOARD);
      assert.ok(after.canvases.some(value=>value.id===BOARD));assert.equal(after.items.find(value=>value.id===selected.id)?.sourceId,f.documentId);
      assert.equal(f.store.captureSourceOwnership()?.generation,source.generation);assert.ok(f.store.sourceOwnershipActive(source));
      assert.ok(f.store.authorizationScopeActive(authority));assert.equal(f.store.captureAuthorizationScope().key,authority.key);
      assert.equal(f.store.session.get().canvas.access,true);
      const newEvents=f.store.eventView.get().filter(event=>!originalEvents.has(event.eventId))
        .filter(event=>["CanvasRemoved","CanvasRestored","CanvasItemPlaced","CanvasRegisterSet","CanvasRenamed"].includes(event.type));
      const expected=boundary==="board-aba"?["CanvasRemoved","CanvasRestored"]:boundary==="selected-source-aba"
        ?["CanvasItemPlaced","CanvasItemPlaced"]:[boundary==="selected-geometry"?"CanvasRegisterSet":boundary==="board-rename"?"CanvasRenamed":"CanvasItemPlaced"];
      assert.deepEqual(newEvents.map(event=>event.type),expected,"both ABA events are genuinely present, not just a fabricated final projection");
      if(boundary==="selected-geometry")assert.equal(after.items.find(value=>value.id===selected.id).x,selected.x+27);
      if(boundary==="board-rename")assert.equal(after.canvases.find(value=>value.id===BOARD).name,originalBoard.name+" — clearer name");
      if(boundary==="unselected-source")assert.equal(after.items.find(value=>value.id===unselected.id).sourceId,f.documentId);
      observations.push({boundary,canvasConnected:f.canvas.isConnected,documentId:documentIdFromRoute(f.store.route.get()),
        originalBoardPresent:true,selectedSource:after.items.find(value=>value.id===selected.id).sourceId,
        sameSourceGeneration:true,sameAuthority:true,eventTypes:newEvents.map(event=>event.type),eventIds:newEvents.map(event=>event.eventId)});
      completed=true;
      timing("handoff.before-return");
    }
    return result;
  };
  timing("activation.before");
  activate(f,rows[0].button);
  timing("activation.returned");
  timing("reached.before");
  await reached(f,()=>completed,"both real domain publications settle inside the actual after-unmount boundary");
  timing("reached.after");
  timing("drain.before");
  await drain(f,12);
  timing("drain.after");
  timing("body-verification.before");
  assert.equal(entered,true);assert.equal(observations.length,1);assert.equal(f.canvas.isConnected,false);
  assert.equal(f.store.projection.get().documentId,f.documentId);assert.equal(documentIdFromRoute(f.store.route.get()),f.documentId);
  assert.ok(f.store.sourceOwnershipActive(source));assert.ok(f.store.authorizationScopeActive(authority));
  const open=dialogs(f).filter(value=>classed(value,"next-format-dialog"));
  const promotions=f.trace.slice(traceStart).filter(value=>value.startsWith("open:")&&value.includes("next-format-dialog"));
  t.diagnostic("BOARD_BINDING_LIFETIME "+JSON.stringify({observations,open:open.length,nativePromotions:promotions}));
  if(boundary==="board-aba"||boundary==="selected-source-aba"){
    assert.equal(open.length,0,"a restored final tuple cannot renew an older board or selected-source opening");
    assert.equal(promotions.length,0,"no transient stale promotion is excused by an eventual close");
  }else{
    assert.equal(open.length,1,"rename, layout and an unselected source do not retire the still-current selected binding");
    assert.ok(promotions.length>0,"the healthy current native preparation actually opens");
  }
  await f.sourceUnchanged();
  timing("body-verification.after");
});
