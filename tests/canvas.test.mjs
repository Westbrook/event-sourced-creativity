import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canvasIdFromRoute, canvasLensFromRoute, canvasViewFromRoute, withCanvasQuery, withCanvasView } from "../src/canvas/routes.ts";
import { foldCanvasEvents, foldCanvasText } from "../src/canvas/model.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { validateCanvasEvent } from "../worker/realtime/canvas-admission.ts";

const event=(sequence,type,payload,clientId="web:a")=>({eventId:`event-${sequence}-${type}`,streamId:"creative:test",sequence,occurredAt:new Date(1_760_000_000_000+sequence*1000).toISOString(),recordedAt:new Date(1_760_000_000_000+sequence*1000).toISOString(),actor:"user",clientId,correlationId:"canvas-test",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const created=event(1,"CanvasCreated",{canvas_id:"canvas-1",project_id:"project-1",name:"Shared room",slug:"shared-room"});
const placed=event(2,"CanvasItemPlaced",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-1",source_kind:"block",source_id:"block-1",title:"Direction",frame:{x:10,y:20,w:240,h:160,z:"a1"}});

test("Canvas views and URL-only lenses remain refresh-safe",()=>{
  const base="/canvas/canvas-1/shared-room?filter=reference#work";
  assert.equal(canvasIdFromRoute(base),"canvas-1");
  assert.equal(withCanvasView(base,"compare"),"/canvas/canvas-1/shared-room/view/compare?filter=reference#work");
  assert.equal(canvasViewFromRoute("/canvas/canvas-1/shared-room/view/folders"),"folders");
  assert.deepEqual(canvasLensFromRoute(withCanvasQuery(base,{sort:"title",seed:null})),{sort:"title",filter:"reference",seed:""});
  assert.deepEqual(resolveServerRoute("/canvas/canvas-1/shared-room/view/list"),{application:"canvas",entryPath:"/canvas/",canonicalFamily:"/canvas/:canvas/:view"});
});

test("HLC registers converge per property regardless of arrival order",()=>{
  const older=event(3,"CanvasRegisterSet",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop:"x",value:120,hlc:{pt:100,c:0,site:"web:a"}}},"web:a");
  const newer=event(4,"CanvasRegisterSet",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop:"x",value:480,hlc:{pt:101,c:0,site:"web:b"}}},"web:b");
  assert.equal(foldCanvasEvents([created,placed,older,newer],"project-1","canvas-1").items[0].x,480);
  assert.equal(foldCanvasEvents([created,placed,newer,older],"project-1","canvas-1").items[0].x,480);
});

test("mergeable text and observed-remove strokes tolerate delivery reordering",()=>{
  const first=event(3,"CanvasTextApplied",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},field:"value",ops:[{ins:{id:["web:a",1],left:null,right:null,chars:"Quiet field."}}]}});
  const second=event(4,"CanvasTextApplied",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},field:"value",ops:[{ins:{id:["web:b",1],left:["web:a",1],right:null,chars:" Keep motion candid."}}]}},"web:b");
  assert.equal(foldCanvasText([second,first],"item-1"),"Quiet field. Keep motion candid.");
  const erase=event(5,"StrokeErased",{canvas_id:"canvas-1",item_id:"item-1",operation:{sketch:{item_id:"item-1"},target:["web:a",2]}});
  const add=event(6,"StrokeAdded",{canvas_id:"canvas-1",item_id:"item-1",operation:{sketch:{item_id:"item-1"},stroke:{id:["web:a",2],points:[0,0,20,20],style:{color:"#000",width:2},bbox:{x:0,y:0,w:20,h:20}}}});
  assert.equal(foldCanvasEvents([created,placed,erase,add],"project-1","canvas-1").items[0].strokes.length,0);
});

test("Canvas-native blocks remain shared project content and need explicit formalization",()=>{
  const events=[event(1,"ProjectCreated",{project_id:"project-1",name:"Project"}),event(2,"DocumentCreated",{document_id:"doc-1",project_id:"project-1",title:"Document"}),event(3,"BlockCreated",{block_id:"block-1",project_id:"project-1",canvas_id:"canvas-1",scope:"canvas",type:"sketch",handle:"sketch/gesture",position:"c1",properties:{text:"Gesture"}}),event(4,"CanvasCreated",{canvas_id:"canvas-1",project_id:"project-1",name:"Room"})];
  const projection=foldEvents(events,undefined,"doc-1","project-1");
  assert.equal(projection.libraryBlocks.some((block)=>block.id==="block-1"&&block.scope==="canvas"),true);
  const complete=buildComprehensiveScenario();const coverage=evaluateReplayCoverage(complete,SCENARIO_EVENT_TYPES);
  assert.equal(coverage.passed,true);for(const key of ["canvas-shared-sources","canvas-convergence","canvas-context-formalization","canvas-report-space","canvas-governance"])assert.equal(coverage.checks.find((check)=>check.key===key)?.passed,true,key);
});

test("admission rejects raw presence and malformed collaborative operations",()=>{
  assert.equal(validateCanvasEvent({type:"CanvasCreated",payload:{canvas_id:"canvas-1",project_id:"project-1",name:"Room",raw_pointer:[1,2]}}),"ephemeral_presence_must_not_be_persisted");
  assert.equal(validateCanvasEvent({type:"CanvasRegisterSet",payload:{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{item_id:"item-1"},prop:"x",value:20,hlc:{pt:20,c:0,site:"web:a"}}}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasRegisterSet",payload:{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{item_id:"item-1"},prop:"opacity",value:.5,hlc:{pt:20,c:0,site:"web:a"}}}}),"invalid_canvas_register_operation");
});

test("Canvas UI preserves the source-of-truth and accessibility boundaries",async()=>{
  const [surface,styles,presence,operations,store]=await Promise.all([readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),readFile(new URL("../src/canvas/canvas.css",import.meta.url),"utf8"),readFile(new URL("../src/canvas/presence.ts",import.meta.url),"utf8"),readFile(new URL("../src/apps/operations/canvas-sync-inspector.ts",import.meta.url),"utf8"),readFile(new URL("../src/state/store.ts",import.meta.url),"utf8")]);
  assert.match(surface,/ContextSetFormalized/);assert.match(surface,/arrangement_is_context:false/);assert.match(surface,/CanvasTextApplied/);assert.match(surface,/StrokeAdded/);assert.match(surface,/CanvasLockAcquired/);assert.match(surface,/ComparisonOpened/);assert.match(surface,/refreshEvents/);assert.match(surface,/aria-roledescription="canvas"/);assert.match(surface,/Canvas reading order/);
  assert.match(store,/spatial_arrangement_is_semantic:false/);assert.match(store,/provenance_frames/);assert.doesNotMatch(store,/properties:\{\.\.\.block\.properties,canvas_frame/);
  assert.match(presence,/BroadcastChannel/);assert.doesNotMatch(presence,/append|fetch\(/);assert.match(operations,/Cursor presence is ephemeral|cursor trails|raw pointer paths/i);
  assert.match(styles,/minmax\(0,1fr\)/);assert.match(styles,/@media\(max-width:900px\)/);
});
