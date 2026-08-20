import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canvasFocusFromRoute, canvasIdFromRoute, canvasLensFromRoute, canvasViewFromRoute, withCanvasFocus, withCanvasQuery, withCanvasView } from "../src/canvas/routes.ts";
import { canvasImagePresentationSignals, canvasItemsInVirtualViewport, canvasMatchSizeTarget, foldCanvasEvents, foldCanvasText, matchCanvasItemSizes, organizeCanvasItems } from "../src/canvas/model.ts";
import { canvasFacetsForBlocks } from "../src/canvas/facets.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildComprehensiveScenario, buildScenario, REPLAY_SCENARIOS, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { CANVAS_INTERACTIONS, canvasInteractionAnalytics, canvasInteractionIdsForEvent } from "../src/model/canvas-interactions.ts";
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

test("Canvas focus is a refresh-safe path that survives view changes",()=>{
  const focused=withCanvasFocus("/canvas/canvas-1/shared-room?filter=palette#work",true);
  assert.equal(focused,"/canvas/canvas-1/shared-room/focus?filter=palette#work");
  assert.equal(canvasFocusFromRoute(focused),true);
  assert.equal(canvasIdFromRoute(focused),"canvas-1");
  assert.equal(withCanvasView(focused,"list"),"/canvas/canvas-1/shared-room/view/list/focus?filter=palette#work");
  assert.equal(canvasViewFromRoute(withCanvasView(focused,"list")),"list");
  assert.equal(withCanvasFocus(withCanvasView(focused,"list"),false),"/canvas/canvas-1/shared-room/view/list?filter=palette#work");
  assert.equal(withCanvasFocus("/canvas/canvas-1",true),"/canvas/canvas-1/view/spatial/focus");
  assert.equal(canvasFocusFromRoute("/canvas/canvas-1/focus"),false,"a board whose slug is focus is not mistaken for focus mode");
  assert.deepEqual(resolveServerRoute(focused),{application:"canvas",entryPath:"/canvas/",canonicalFamily:"/canvas/:canvas/:view"});
});

test("selected Canvas ideas organize without overlap while preserving their origin",()=>{
  const items=[{id:"a",sourceKind:"reference",blockType:"reference",x:80,y:120,w:240,h:180},{id:"b",sourceKind:"block",blockType:"direction",x:410,y:130,w:300,h:210},{id:"c",sourceKind:"output",blockType:"output",x:95,y:390,w:360,h:280},{id:"d",sourceKind:"block",blockType:"direction",x:500,y:420,w:280,h:190}];
  const grid=organizeCanvasItems(items,"grid",40);assert.deepEqual(grid.get("a"),{x:80,y:120});assert.deepEqual(grid.get("b"),{x:360,y:120});assert.deepEqual(grid.get("c"),{x:80,y:370});assert.deepEqual(grid.get("d"),{x:480,y:370});
  const column=organizeCanvasItems(items,"column",40);assert.deepEqual(column.get("d"),{x:80,y:910});
  const grouped=organizeCanvasItems(items,"type",40);assert.equal(grouped.get("b")?.y,grouped.get("d")?.y);assert.notEqual(grouped.get("a")?.y,grouped.get("b")?.y);
  const targets={minimum:{width:240,height:180},average:{width:295,height:215},maximum:{width:360,height:280}};for(const modifier of ["minimum","average","maximum"]){const target=canvasMatchSizeTarget(items,modifier);assert.deepEqual(target,targets[modifier]);const matched=matchCanvasItemSizes(items,modifier);for(const item of items){const frame=matched.get(item.id);assert.ok(frame);assert.deepEqual({w:frame.w,h:frame.h},{w:target.width,h:target.height},`${modifier} exact shared frame`);assert.ok(Math.abs(frame.x+frame.w/2-(item.x+item.w/2))<.01,`${modifier} x center`);assert.ok(Math.abs(frame.y+frame.h/2-(item.y+item.h/2))<.01,`${modifier} y center`);}}
});

test("Canvas arrangements durably bind a selection to its resolved frames",()=>{
  const second=event(3,"CanvasItemPlaced",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-2",source_kind:"output",source_id:"output-1",title:"Generation",frame:{x:400,y:100,w:360,h:240,z:"a2"}});
  const arrangement=event(4,"CanvasArrangementCreated",{arrangement_id:"arrangement-1",canvas_id:"canvas-1",project_id:"project-1",name:"Average size · 2 cards",kind:"match-size",size_modifier:"average",target_width:300,target_height:200,item_ids:["item-1","item-2"],previous_frames:[{item_id:"item-1",x:0,y:0,w:260,h:180},{item_id:"item-2",x:400,y:100,w:360,h:240}],frames:[{item_id:"item-1",x:-20,y:0,w:300,h:200},{item_id:"item-2",x:430,y:120,w:300,h:200}],source_surface:"canvas-organize-menu",organization_action_id:"arrangement-1"});
  const projection=foldCanvasEvents([created,placed,second,arrangement],"project-1","canvas-1");
  assert.equal(projection.arrangements.length,1);assert.deepEqual(projection.arrangements[0].itemIds,["item-1","item-2"]);assert.deepEqual(projection.arrangements[0].frames.map(({w,h})=>({w,h})),[{w:300,h:200},{w:300,h:200}]);assert.deepEqual(projection.arrangements[0].previousFrames.map(({w,h})=>({w,h})),[{w:260,h:180},{w:360,h:240}]);
  const removed=event(5,"CanvasArrangementRemoved",{arrangement_id:"arrangement-1",canvas_id:"canvas-1",project_id:"project-1"});const restored=event(6,"CanvasArrangementRestored",{arrangement_id:"arrangement-1",canvas_id:"canvas-1",project_id:"project-1"});
  assert.equal(foldCanvasEvents([created,placed,second,arrangement,removed],"project-1","canvas-1").arrangements.length,0);assert.equal(foldCanvasEvents([created,placed,second,arrangement,removed,restored],"project-1","canvas-1").arrangements.length,1);
});

test("the virtual Canvas renders only the viewport and a bounded overscan region",()=>{
  const items=[{id:"visible",x:100,y:100,w:200,h:150},{id:"buffered",x:950,y:100,w:200,h:150},{id:"left-edge",x:-150,y:200,w:200,h:150},{id:"distant",x:4_000,y:4_000,w:200,h:150}];
  assert.deepEqual(canvasItemsInVirtualViewport(items,{x:0,y:0,width:800,height:600},200).map((item)=>item.id),["visible","buffered","left-edge"]);
  assert.deepEqual(canvasItemsInVirtualViewport(items,{x:4_000,y:4_000,width:800,height:600},200).map((item)=>item.id),["distant"]);
});

test("drag-to-select uses the visible world rectangle for batch selection",()=>{
  const items=[{id:"inside",x:100,y:100,w:200,h:150},{id:"crossing",x:380,y:240,w:200,h:150},{id:"outside",x:900,y:600,w:200,h:150}];
  assert.deepEqual(canvasItemsInVirtualViewport(items,{x:80,y:80,width:360,height:240}).map((item)=>item.id),["inside","crossing"]);
});

test("HLC registers converge per property regardless of arrival order",()=>{
  const older=event(3,"CanvasRegisterSet",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop:"x",value:120,hlc:{pt:100,c:0,site:"web:a"}}},"web:a");
  const newer=event(4,"CanvasRegisterSet",{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop:"x",value:480,hlc:{pt:101,c:0,site:"web:b"}}},"web:b");
  assert.equal(foldCanvasEvents([created,placed,older,newer],"project-1","canvas-1").items[0].x,480);
  assert.equal(foldCanvasEvents([created,placed,newer,older],"project-1","canvas-1").items[0].x,480);
});

test("Canvas resizing preserves image ratios, lets other cards reflow, and stays organizational",()=>{
  const image=event(2,"CanvasItemPlaced",{canvas_id:"canvas-1",project_id:"project-1",item_id:"image-1",source_kind:"reference",source_id:"reference-1",title:"Field reference",frame:{x:100,y:120,w:360,h:240,z:"a2"}});
  const before={x:100,y:120,w:360,h:240,area:86_400},after={x:55,y:90,w:450,h:300,area:135_000};
  const changes=(["x","y","w","h"]).map((prop,index)=>event(3+index,"CanvasRegisterSet",{canvas_id:"canvas-1",project_id:"project-1",item_id:"image-1",previous_value:before[prop],presentation_receipt_id:"presentation-1",presentation_action_id:"action-1",presentation_signal_version:1,presentation_intent:"organization",semantic_status:"candidate-signal",does_not_change_generation_context:true,future_interpretations:["influence","attention","comparison-priority"],explicit_user_action:true,source_surface:"canvas-resize-handles",resize_action:"direct-manipulation",resize_mode:"aspect-locked",resize_corner:"nw",input_method:"pointer",source_kind:"reference",source_id:"reference-1",selected_item_ids:["image-1"],previous_frame:before,next_frame:after,relative_area_change:after.area/before.area,operation:{object:{kind:"canvas_item",item_id:"image-1"},prop,value:after[prop],hlc:{pt:200+index,c:index,site:"web:a"}}}));
  const projection=foldCanvasEvents([created,image,...changes],"project-1","canvas-1");assert.deepEqual({x:projection.items[0].x,y:projection.items[0].y,w:projection.items[0].w,h:projection.items[0].h},{x:55,y:90,w:450,h:300});
  const signals=canvasImagePresentationSignals([created,image,...changes]);assert.equal(signals.length,1);assert.equal(signals[0].intent,"organization");assert.equal(signals[0].sourceKind,"reference");assert.deepEqual(signals[0].eventIds,changes.map((item)=>item.eventId));assert.equal(signals[0].relativeAreaChange,1.5625);
  assert.deepEqual(canvasInteractionIdsForEvent(changes[0]),["image_resized"]);
  const cardResize=event(8,"CanvasRegisterSet",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-1",source_surface:"canvas-resize-handles",resize_mode:"freeform",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop:"w",value:420,hlc:{pt:300,c:0,site:"web:a"}}});assert.deepEqual(canvasInteractionIdsForEvent(cardResize),["item_resized"]);assert.equal(canvasImagePresentationSignals([cardResize]).length,0);
  const matched=(["x","y","w","h"]).map((prop,index)=>event(9+index,"CanvasRegisterSet",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-1",source_surface:"canvas-organize-menu",organization:"match-size",organization_action_id:"match-action-1",size_modifier:"average",operation:{object:{kind:"canvas_item",item_id:"item-1"},prop,value:200+index,hlc:{pt:400+index,c:0,site:"web:a"}}}));assert.equal(canvasInteractionAnalytics(matched).byInteraction.find((row)=>row.id==="organization_applied")?.count,1);
});

test("Canvas collaboration locks expire even when pointer release never arrives",()=>{
  const acquired=event(3,"CanvasLockAcquired",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-1",holder_id:"web:a",lease_ms:15_000});
  const acquiredAt=Date.parse(acquired.recordedAt);
  assert.equal(foldCanvasEvents([created,placed,acquired],"project-1","canvas-1",acquiredAt+14_999).items[0].lockedBy,"web:a");
  const expired=foldCanvasEvents([created,placed,acquired],"project-1","canvas-1",acquiredAt+15_001).items[0];
  assert.equal(expired.lockedBy,null);
  assert.equal(expired.lockedUntil,null);
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
  assert.equal(coverage.passed,true);for(const key of ["canvas-shared-sources","canvas-convergence","canvas-context-formalization","canvas-document-rendering","canvas-report-space","canvas-governance","canvas-interaction-coverage"])assert.equal(coverage.checks.find((check)=>check.key===key)?.passed,true,key);
  const prepared=complete.find((item)=>item.type==="DocumentCreated"&&item.payload.created_from==="canvas-selection"&&complete.filter((candidate)=>candidate.type==="GenerationRequested"&&candidate.payload.source_surface==="canvas"&&candidate.payload.document_id===item.payload.document_id).length===4);
  const placement=complete.find((item)=>item.type==="CanvasItemPlaced"&&item.payload.source_id===prepared?.payload.document_id);
  const renders=complete.filter((item)=>item.type==="GenerationRequested"&&item.payload.source_surface==="canvas"&&item.payload.document_id===prepared?.payload.document_id);
  assert.ok(prepared&&placement);assert.ok(placement.sequence>prepared.sequence);assert.equal(renders.length,4);assert.ok(renders.every((item)=>item.sequence>placement.sequence));
});

test("one Canvas usage scenario rehearses every meaningful interaction and the all-things tour inherits it",()=>{
  assert.equal(REPLAY_SCENARIOS.find((scenario)=>scenario.key==="canvas-usage")?.label,"Canvas usage");
  assert.equal(REPLAY_SCENARIOS[0].label,"Do all the things");
  const canvasUsage=buildScenario("canvas-usage",1_000);const allThings=buildComprehensiveScenario("theory:all-things",2_000);
  const expected=new Set(CANVAS_INTERACTIONS.map(([id])=>id));const canvasCovered=new Set(canvasUsage.flatMap(canvasInteractionIdsForEvent));const allCovered=new Set(allThings.flatMap(canvasInteractionIdsForEvent));
  assert.deepEqual(canvasCovered,expected);assert.deepEqual(allCovered,expected);
  const coverage=evaluateReplayCoverage(allThings,SCENARIO_EVENT_TYPES);assert.equal(coverage.checks.find((check)=>check.key==="canvas-interaction-coverage")?.passed,true);
  assert.equal(canvasUsage.some((item)=>item.type==="CanvasInteractionRecorded"&&item.payload.mock_interaction===true),true);
  const arrangement=canvasUsage.find((item)=>item.type==="CanvasArrangementCreated");assert.ok(arrangement);assert.equal(validateCanvasEvent(arrangement),null);const frames=arrangement.payload.frames;assert.equal(frames.length,3);assert.equal(new Set(frames.map((frame)=>`${frame.w}x${frame.h}`)).size,1);assert.equal(canvasUsage.some((item)=>item.type==="CanvasArrangementRemoved"),true);assert.equal(canvasUsage.some((item)=>item.type==="CanvasArrangementRestored"),true);
});

test("Canvas composite context cards remain project-level references",()=>{
  const formalized=event(3,"ContextSetFormalized",{context_set_id:"context-1",canvas_id:"canvas-1",project_id:"project-1",name:"Launch reality",item_ids:["item-1"],as_of_sequence:2});
  const composite=event(4,"CanvasItemPlaced",{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-context",source_kind:"context",source_id:"context-1",title:"Launch reality",body:"1 connected idea",frame:{x:400,y:80,w:320,h:180,z:"a2"}});
  const projection=foldCanvasEvents([created,placed,formalized,composite],"project-1","canvas-1");
  assert.equal(projection.items.find((item)=>item.id==="item-context")?.sourceKind,"context");
  assert.deepEqual(projection.contextSets[0].blockIds,["block-1"]);
  assert.equal(validateCanvasEvent({type:"CanvasItemPlaced",payload:composite.payload}),null);
});

test("Canvas probes expose authored and extracted organization facets without authoring them",()=>{
  const facets=canvasFacetsForBlocks([{id:"reference-1",documentId:"",canvasId:"canvas-1",projectId:"project-1",scope:"canvas",type:"reference",handle:"reference/studio",position:"c1",removed:false,locked:false,properties:{label:"Studio reference",reference_findings:[{kind:"palette",blockType:"palette",subtype:"Extracted",label:"Warm mineral palette",value:"Ochre and graphite",basis:"sample",confidence:.84,colors:["#b98243","#222222"]},{kind:"composition",blockType:"composition",subtype:"Grid",label:"Strong central axis",value:"Central axis",basis:"sample",confidence:.8}]},sourceEvents:[]}]);
  assert.deepEqual(facets.map((facet)=>facet.kind),["palette","composition"]);
  assert.equal(facets[0].source,"extracted");
  assert.deepEqual(facets[0].colors,["#b98243","#222222"]);
});

test("admission rejects raw presence and malformed collaborative operations",()=>{
  assert.equal(validateCanvasEvent({type:"CanvasCreated",payload:{canvas_id:"canvas-1",project_id:"project-1",name:"Room",raw_pointer:[1,2]}}),"ephemeral_presence_must_not_be_persisted");
  assert.equal(validateCanvasEvent({type:"CanvasRegisterSet",payload:{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{item_id:"item-1"},prop:"x",value:20,hlc:{pt:20,c:0,site:"web:a"}}}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasRegisterSet",payload:{canvas_id:"canvas-1",item_id:"item-1",operation:{object:{item_id:"item-1"},prop:"opacity",value:.5,hlc:{pt:20,c:0,site:"web:a"}}}}),"invalid_canvas_register_operation");
  assert.equal(validateCanvasEvent({type:"CanvasLockAcquired",payload:{canvas_id:"canvas-1",item_id:"item-1",holder_id:"web:a",lease_ms:15_000}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasLockAcquired",payload:{canvas_id:"canvas-1",item_id:"item-1",holder_id:"web:a",lease_ms:0}}),"invalid_canvas_lock_lease");
  assert.equal(validateCanvasEvent({type:"CanvasInteractionRecorded",payload:{canvas_id:"canvas-1",project_id:"project-1",interaction_id:"item_selected",category:"selection"}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasInteractionRecorded",payload:{canvas_id:"canvas-1",project_id:"project-1",interaction_id:"item_selected",category:"content"}}),"invalid_canvas_interaction_category");
  assert.equal(validateCanvasEvent({type:"CanvasInteractionRecorded",payload:{project_id:"project-1",interaction_id:"item_selected",category:"selection",raw_input:"private"}}),"ephemeral_presence_must_not_be_persisted");
  assert.equal(validateCanvasEvent({type:"CanvasItemPlaced",payload:{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-artifact",source_id:"story-1",source_kind:"artifact"}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasArrangementCreated",payload:{arrangement_id:"arrangement-1",canvas_id:"canvas-1",project_id:"project-1",kind:"match-size",size_modifier:"average",target_width:300,target_height:200,item_ids:["item-1","item-2"],previous_frames:[{item_id:"item-1",x:0,y:0,w:260,h:180},{item_id:"item-2",x:320,y:0,w:340,h:220}],frames:[{item_id:"item-1",x:0,y:0,w:300,h:200},{item_id:"item-2",x:320,y:0,w:300,h:200}]}}),null);
  assert.equal(validateCanvasEvent({type:"CanvasArrangementCreated",payload:{arrangement_id:"arrangement-1",canvas_id:"canvas-1",project_id:"project-1",kind:"match-size",size_modifier:"average",target_width:300,target_height:200,item_ids:["item-1","item-2"],frames:[{item_id:"item-1",x:0,y:0,w:300,h:200}]}}),"invalid_canvas_arrangement");
});

test("Canvas UI preserves the source-of-truth and accessibility boundaries",async()=>{
  const [surface,styles,presence,operations,store,outputVisual,referenceImage]=await Promise.all([readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),readFile(new URL("../src/canvas/canvas.css",import.meta.url),"utf8"),readFile(new URL("../src/canvas/presence.ts",import.meta.url),"utf8"),readFile(new URL("../src/apps/operations/canvas-sync-inspector.ts",import.meta.url),"utf8"),readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/output-visual.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/reference-image.ts",import.meta.url),"utf8")]);
  assert.match(surface,/ContextSetFormalized/);assert.match(surface,/arrangement_is_context:false/);assert.match(surface,/source_kind:"context"/);assert.match(surface,/structureAdaptive\(intent,\{documentId,sourceSurface:"canvas",projectScope:true\}\)/);assert.match(surface,/CanvasTextApplied/);assert.match(surface,/StrokeAdded/);assert.match(surface,/DRAG_THRESHOLD_PX/);assert.match(surface,/pointercancel/);assert.match(surface,/CanvasLockAcquired/);assert.match(surface,/Connection interrupted/);assert.doesNotMatch(surface,/Board changes could not be synchronized/);assert.match(surface,/ComparisonOpened/);assert.match(surface,/refreshEvents/);assert.match(surface,/aria-roledescription="virtual infinite project board"/);assert.match(surface,/Board reading order/);assert.match(surface,/canvas-selection-hud/);assert.match(surface,/canvas-intent-dock/);assert.match(surface,/data-canvas-focus/);assert.match(surface,/withCanvasFocus/);
  assert.match(surface,/aria-label="Clear selection"/);assert.match(surface,/#clearSelection\(\)/);assert.match(surface,/>Remove<\/button>/);assert.match(surface,/Create document/);assert.match(surface,/Step 1 of 2 · prepare/);assert.match(surface,/Step 2 of 2 · render when ready/);assert.match(surface,/Draft fan ×4/);assert.match(surface,/Full fan ×4/);assert.doesNotMatch(surface,/#generateSelection/);
  assert.match(surface,/Batch select ideas \(B\)/);assert.match(surface,/aria-pressed=\$\{active\}/);assert.match(surface,/Drag from empty canvas to select an area/);assert.match(surface,/Cards remain clickable and draggable/);assert.match(surface,/#marqueeSelect\(event:PointerEvent\)/);assert.match(surface,/if\(event\.target===event\.currentTarget\)this\.#marqueeSelect\(event\)/);assert.match(surface,/\["select","marquee"\]\.includes\(this\.#tool\)/);assert.match(surface,/const visibleItems=this\.#orderedItems/);assert.match(surface,/class="canvas-selection-marquee"/);assert.match(styles,/\.canvas-plane\.is-batch-selecting/);assert.match(styles,/\.canvas-selection-marquee\{/);assert.match(styles,/\.canvas-batch-select\{/);
  assert.match(surface,/Search existing context/);assert.match(surface,/Search name, type, or instructions/);assert.match(surface,/blockTypeDefinition\(source\.blockType as BlockKind\)/);assert.match(surface,/No existing context matches/);assert.match(styles,/\.canvas-source-search-field:focus-within/);
  assert.match(surface,/Organize these ideas/);assert.match(surface,/Compact grid/);assert.match(surface,/Group by content type/);assert.match(surface,/Match size/);assert.match(surface,/Minimum/);assert.match(surface,/Average/);assert.match(surface,/Maximum/);assert.match(surface,/#matchSelectionSize\(choice\.kind\)/);assert.match(surface,/source_surface:"canvas-organize-menu"/);assert.match(surface,/organization:"match-size"/);assert.match(surface,/does_not_change_generation_context:true/);assert.match(surface,/organizeCanvasItems/);assert.match(surface,/matchCanvasItemSizes/);assert.match(styles,/\.canvas-size-options/);
  assert.match(surface,/canvasMatchSizeTarget/);assert.match(surface,/target_width:target\.width/);assert.match(surface,/target_height:target\.height/);assert.match(surface,/resize_mode:"uniform-card-size-match"/);assert.match(surface,/intrinsic_media_aspect_ratio_preserved:image/);assert.match(surface,/media_fit:image\?"cover":null/);assert.match(surface,/including images/);assert.match(surface,/same width and height/);assert.match(surface,/crop inside that shared frame without stretching/);
  assert.match(surface,/CanvasArrangementCreated/);assert.match(surface,/arrangement_id:arrangementId/);assert.match(surface,/Saved for this selection/);assert.match(surface,/#reapplyArrangement\(arrangement\)/);assert.match(surface,/Each action saves a replayable arrangement against this selection/);
  assert.match(surface,/previous_frames:previousFrames/);assert.match(surface,/#changeHistory\(direction:"undo"\|"redo"\)/);assert.match(surface,/if\(control\.closest\("\.canvas-history-actions"\)\)return/);assert.match(store,/action\.some\(\(event\)=>event\.type==="CanvasArrangementCreated"\)\?action/);
  assert.match(surface,/canvas-resize-handle--/);assert.match(surface,/M0 4 4 0M0 8 8 0M0 12 12 0/);assert.match(surface,/#resizeItem\(event,item,corner\)/);assert.match(surface,/#resizeItemWithKeyboard\(event,item,corner\)/);assert.match(surface,/source_surface:"canvas-resize-handles"/);assert.match(surface,/resize_mode:mediaKind\(item\)\?"aspect-locked":"freeform"/);assert.match(surface,/#resizeHandles\(item,\["nw","ne"\]\).*#resizeHandles\(item,\["sw","se"\]\)/);assert.match(surface,/target\.scrollHeight>target\.clientHeight\+1&&!fromStickyHeader/);assert.doesNotMatch(surface,/canvas-image-size-controls|Make image smaller|Make image larger/);assert.match(surface,/presentation_intent:"organization"/);assert.match(surface,/does_not_change_generation_context:true/);assert.match(surface,/future_interpretations:\["influence","attention","comparison-priority"\]/);assert.match(styles,/\.canvas-resize-handle--nw\{top:4px;left:4px/);assert.match(styles,/\.canvas-resize-handle--se\{right:4px;bottom:4px/);assert.match(styles,/stroke-width:var\(--canvas-zoom\)/);assert.match(styles,/container:canvas-item \/ size/);assert.match(styles,/@container canvas-item/);assert.match(styles,/\.canvas-item\{[^}]*overflow:auto[^}]*touch-action:pan-y/);assert.match(styles,/\.canvas-item>header\{[^}]*position:sticky;top:0[^}]*background:var\(--panel\)[^}]*touch-action:none/);assert.match(styles,/\.canvas-item>footer\{[^}]*position:sticky;bottom:0[^}]*background:var\(--panel\)/);assert.match(styles,/\.canvas-item-content\{[^}]*overflow:visible/);assert.doesNotMatch(styles,/\.canvas-item-content\{[^}]*overflow:auto/);assert.doesNotMatch(styles,/\.canvas-item>footer\{[^}]*overflow:auto/);assert.match(styles,/overflow-wrap:anywhere/);assert.match(styles,/\.canvas-image-interaction,.canvas-reference-stage/);
  assert.match(surface,/selected&&!facets\.length\?" handles-only":""/);assert.match(styles,/\.canvas-image-open,\.canvas-item \.reference-image-open\{[^}]*right:1\.8rem;bottom:1\.8rem/);assert.doesNotMatch(styles,/\.canvas-item\.selected \.canvas-image-open/);assert.match(styles,/\.canvas-item--output>footer\.handles-only/);assert.match(styles,/footer\.handles-only \.canvas-resize-handle\{pointer-events:auto/);
  assert.match(surface,/this\.#intent="";this\.#intentSubmitting=true;this\.requestUpdate\(\);const queued=await this\.store\.structureAdaptive/);assert.match(surface,/canvas-intent-stack/);assert.match(surface,/adaptiveSuggestionSetsFor/);assert.match(surface,/dismissAdaptiveSuggestion\(anchor,suggestion\.id\)/);assert.match(surface,/Suggestions will join this stack when they are ready/);assert.doesNotMatch(surface,/intentAsked|intentDocumentId/);
  assert.match(surface,/#cardWheel\(event:WheelEvent\)/);assert.match(surface,/@wheel=\$\{\(event:WheelEvent\)=>this\.#cardWheel\(event\)\}/);assert.match(surface,/@wheel=\$\{\(event:WheelEvent\)=>this\.#canvasWheel\(event\)\}/);assert.match(surface,/RENDER_OVERSCAN_PX=800/);assert.match(surface,/canvasItemsInVirtualViewport/);assert.match(surface,/nearbyItems\.map\(\(item\)=>this\.#card\(item\)\)/);assert.match(surface,/Math\.exp\(-delta\*\.01\)/);assert.doesNotMatch(surface,/WORLD_(?:ORIGIN|WIDTH|HEIGHT)|scrollLeft|scrollTop/);
  assert.match(surface,/this\.#dragPreview=\{itemId:item\.id,x:item\.x\+dx,y:item\.y\+dy\}/);assert.match(surface,/preview\.x-item\.x/);assert.match(surface,/await this\.updateComplete;this\.#dragPreview=undefined/);
  assert.match(surface,/#fromCardControl\(event:Event\)/);assert.match(surface,/this\.#fromCardControl\(event\)\|\|!\["select","marquee"\]\.includes\(this\.#tool\)/);assert.match(surface,/if\(\["select","marquee"\]\.includes\(this\.#tool\)&&!this\.#fromCardControl\(event\)\)this\.#select/);assert.match(surface,/forma-reference-image/);
  assert.match(surface,/class="canvas-image-interaction"/);assert.match(surface,/class="canvas-image-open"/);assert.match(surface,/\.separateOpenControl=\$\{true\}/);assert.match(surface,/class="modal canvas-output-viewer"/);assert.match(surface,/#viewingOutputSource="canvas-image-dialog"/);assert.match(surface,/source_surface:this\.#viewingOutputSource/);assert.match(surface,/this\.#navigateCanvasOutput\(event\.key==="ArrowLeft"\?-1:1,"keyboard"\)/);
  assert.match(surface,/document_outputs_opened/);assert.match(surface,/document_output_placed/);assert.match(surface,/class="modal canvas-document-outputs-dialog"/);assert.match(surface,/Review every result without crowding the board/);assert.match(surface,/Stories, presentations & motion/);assert.match(surface,/libraryArtifacts/);assert.match(surface,/#placeDocumentArtifact/);assert.match(surface,/DocumentArtifactViewed/);assert.match(surface,/source_kind:"artifact"|kind:"artifact"/);assert.match(surface,/Place on canvas/);assert.match(surface,/source_surface:"canvas-document-outputs-dialog"/);assert.match(surface,/this\.#documentOutputCount\(selectedDocument\)/);assert.match(surface,/#documentOutputJobs\(item:CanvasItem\)/);assert.match(surface,/if\(started\)\{this\.#renderOpen=false;this\.#openDocumentOutputs\(item\);\}/);assert.match(surface,/documentJobProgress\(job\)/);assert.match(surface,/rendering_count/);assert.match(surface,/aria-live="polite" aria-relevant="additions text"/);assert.match(surface,/role="progressbar"/);assert.match(surface,/Will appear here automatically when ready/);assert.match(styles,/\.canvas-document-output-grid\{/);assert.match(styles,/\.canvas-document-output-sections\{/);assert.match(styles,/\.canvas-document-output-progress\{/);assert.match(styles,/\.canvas-document-output-progress-steps\{/);assert.match(styles,/\.canvas-artifact-viewer-card\{/);assert.match(styles,/\.canvas-document-outputs-card\{/);
  assert.match(surface,/if\(event\.shiftKey\)\{event\.preventDefault\(\);this\.#select\(item\.id,\{shiftKey:true\}\);return;\}/);assert.match(surface,/@forma-reference-image-select-requested=\$\{\(event:CustomEvent\)=>\{event\.preventDefault\(\);this\.#select\(item\.id,\{shiftKey:true\}\);\}\}/);assert.match(surface,/Shift-click to add this idea to the selection/);
  assert.match(outputVisual,/@pointerdown=\$\{\(event:PointerEvent\)=>event\.stopPropagation\(\)\}/);assert.match(outputVisual,/@click=\$\{\(event:MouseEvent\)=>\{event\.stopPropagation\(\);this\.#openViewer\(output\);\}\}/);assert.match(referenceImage,/separateOpenControl/);assert.match(referenceImage,/class="reference-image-selectable"/);assert.match(referenceImage,/class="reference-image-open"/);assert.match(referenceImage,/@pointerdown=\$\{\(event:PointerEvent\)=>event\.stopPropagation\(\)\}/);
  assert.match(referenceImage,/forma-reference-image-select-requested/);assert.match(referenceImage,/cancelable:true/);assert.match(referenceImage,/if\(!requested\)\{event\.preventDefault\(\);event\.stopPropagation\(\);return;\}/);
  assert.match(store,/spatial_arrangement_is_semantic:false/);assert.match(store,/provenance_frames/);assert.match(store,/HistoryGroup/);assert.match(store,/CanvasItemRestored/);assert.match(store,/StrokeErased/);assert.match(store,/withoutClientEventId/);assert.match(store,/adaptiveSuggestionSets/);assert.match(store,/#syncAdaptiveSuggestionSets\(jobs\)/);assert.doesNotMatch(store,/properties:\{\.\.\.block\.properties,canvas_frame/);
  assert.match(presence,/BroadcastChannel/);assert.doesNotMatch(presence,/append|fetch\(/);assert.match(operations,/Cursor presence is ephemeral|cursor trails|raw pointer paths/i);assert.match(operations,/Image presentation signals/);assert.match(operations,/organizational evidence, not creative truth/);
  assert.match(styles,/content-visibility:auto/);assert.match(styles,/will-change:transform/);assert.doesNotMatch(styles,/--canvas-world-(?:width|height)/);assert.match(styles,/\.canvas-viewport\{[^}]*overflow:hidden/);assert.match(styles,/\.canvas-plane\{[^}]*position:absolute;inset:0/);assert.match(styles,/minmax\(0,1fr\)/);assert.match(styles,/\.canvas-intent-cards\{[^}]*overflow:auto/);assert.match(styles,/@media\(max-width:900px\)/);assert.match(styles,/html\[data-canvas-focus\]/);
});
