// Full current Shell/Canvas/Workspace/Store and RAM Worker. Canvas authorization
// comes from the real session endpoint for an explicitly seeded internal admin.
// Synthetic historical jobs/media are fixture input, not provider output or a
// real purchase. Native ports are functional DOM evidence, not browser/AT proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./scene-cost-store-host.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./actual-scene-resume-read.mjs";
import { observeBoardRailDocument } from "./board-rail-document-observer.mjs";
import { financial } from "./event-source-retirement-fixture.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../../worker/runtime.ts";
import { creativeNextActions } from "../../src/model/workspace-intelligence.ts";
import { nextActionFacts } from "../../src/state/next-action-context.ts";
import { withOutcomeDeskSelection, withOutcomeDeskPosture } from "../../src/model/outcome-desk.ts";
import { outcomeDeskHostActions } from "../../src/canvas/outcome-desk-host.ts";
import { artifactDeliveryFor } from "../../src/state/artifact-delivery-context.ts";

const options={concurrency:false,timeout:45_000};
const BOARD="lifecycle-current-board",OTHER_BOARD="lifecycle-other-board",OTHER_DOCUMENT="lifecycle-other-document";
const RAW="  Unsent board direction — 文書\nسؤال جديد  ";
const classed=(node,name)=>String(node?.attributes?.class??"").split(/\s/u).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parent)if(at===parent)return true;return false;};
const navigationTypes=new Set(["ProjectOpened","DocumentOpened"]);
async function drain(f,count=8){for(let at=0;at<count;at++){
  await f.settle();for(const[id,timer]of[...f.storeHost.timers])if(timer.delay===16){f.storeHost.timers.delete(id);timer.callback(0);}
  await new Promise(setImmediate);
}}
async function reached(f,predicate,label){for(let at=0;at<32;at++){await drain(f,1);if(predicate())return;}assert.ok(predicate(),label);}
const dialogs=f=>f.tree().visible("dialog").filter(value=>value.port?.open);
function activate(f,node){assert.ok(node.port?.isConnected&&!node.hiddenBy&&!Object.hasOwn(node.attributes,"disabled"));
  node.handlers.click.call(node.owner,{target:node.port,currentTarget:node.port,button:0,preventDefault(){},stopPropagation(){},composedPath:()=>[node.port]});}
function cards(f){const tree=f.tree(),group=tree.nodes.filter(node=>node.owner===f.canvas&&!node.hiddenBy
  &&classed(node,f.origin==="canvas"?"canvas-next-document":"outcome-desk-selected"));
  assert.equal(group.length,1,"one actual current Document guidance group, not a detached helper result");
  return tree.nodes.filter(node=>node.tag==="forma-ui-choice-card"&&inside(node,group[0])&&!node.hiddenBy).map(node=>{
    const button=tree.visible("button").find(value=>inside(value,node));assert.ok(button?.port);return{node,button,id:button.attributes["data-choice-value"],label:node.component.label};});}
function currentActions(f){return creativeNextActions(nextActionFacts(f.store,f.documentId,BOARD,{lifecycle:true}));}
function expectedRows(f){const facts=nextActionFacts(f.store,f.documentId,BOARD,{lifecycle:true});
  if(f.origin==="canvas")return creativeNextActions(facts).map(action=>({id:action.id,action}));
  const input={facts,document:f.store.projection.get().documents.find(value=>value.id===f.documentId)};
  return outcomeDeskHostActions(input,"document:"+f.documentId,{localize:(_key,fallback)=>fallback,
    delivery:artifact=>artifactDeliveryFor(f.store,artifact,undefined,BOARD)}).map(value=>({id:value.key,action:value.target.action}));}
function priority(f,t,kind){const expected=expectedRows(f),visible=cards(f);assert.ok(expected.length>0&&expected.length<=3);
  assert.equal(expected[0].action.target.kind,kind,"the independently derived current board policy has this priority");
  assert.equal(expected[0].action.target.canvasId,BOARD);assert.notEqual(expected[0].action.target.sourceGeneration,undefined);
  t.diagnostic("BOARD_LIFECYCLE_PRIORITY "+JSON.stringify({origin:f.origin,expected:expected.map(row=>({id:row.id,target:row.action.target})),visible:visible.map(({id,label})=>({id,label}))}));
  assert.deepEqual(visible.map(row=>row.id),expected.map(row=>row.id),"the actual group uses the common lifecycle scheme without dropping current-board work");
  assert.equal(visible.filter(row=>row.node.attributes["data-primary"]==="true").length,1);
  return{action:expected[0].action,button:visible[0].button};}

async function boardPage(t,{origin="canvas",mode="healthy",locale="en",railDocumentReceipt=null,referencePlacementSetup=null}={}){
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No live network/provider in the board lifecycle fixture"));
  const previousChannel=globalThis.BroadcastChannel;globalThis.BroadcastChannel=undefined;t.after(()=>{globalThis.BroadcastChannel=previousChannel;});
  const worker=await createSceneCostFixture(1,"visual");
  // Genuine existing internal-admin Canvas admission; no client access flag,
  // governance receipt, shared membership or production policy is fabricated.
  worker.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(worker.owner);
  const seed=async(type,payload)=>appendAuditEvent(worker.env,worker.streamId,"user",type,{project_id:worker.projectId,...payload});
  await seed("DocumentCreated",{document_id:OTHER_DOCUMENT,title:"Other exact planning Document"});
  for(const[id,name]of[[BOARD,"Current authorized board"],[OTHER_BOARD,"Other authorized board"]])await seed("CanvasCreated",{canvas_id:id,name});
  for(const[id,documentId,x]of[["lifecycle-card-a",worker.documentId,0],["lifecycle-card-b",OTHER_DOCUMENT,400]])
    await seed("CanvasItemPlaced",{canvas_id:BOARD,item_id:id,source_kind:"document",source_id:documentId,title:documentId,frame:{x,y:0,w:300,h:200,z:"a",rot:0}});
  await seed("CanvasItemPlaced",{canvas_id:OTHER_BOARD,item_id:"lifecycle-other-board-a",source_kind:"document",source_id:worker.documentId,title:worker.documentId,frame:{x:0,y:0,w:300,h:200,z:"a",rot:0}});
  if(mode==="source")await seed("BlockPropertyEdited",{document_id:worker.documentId,block_id:"scene-reuse-direction",property_path:"rights_expires_at",new_value:"2020-01-01T00:00:00Z"});
  const jobId="lifecycle-original-"+mode;
  if(mode==="document-job"||mode==="board-job"){
    const board=mode==="board-job",now=new Date().toISOString(),expires=new Date(Date.now()+3600_000).toISOString();
    const request=board?{canvasId:BOARD,projectId:worker.projectId}:{},result={generationReceipt:{provider_request_status:"submission_unknown",reservation_status:"unknown"}};
    worker.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at) VALUES(?,?,?,?,?,'failed',?,?,1,?,?,'source_fidelity_validation_failed',1,?,?,?,?,?)")
      .run(jobId,worker.owner,worker.streamId,worker.documentId,board?"structure_adaptive":"render_document",board?"canvas":"activity",jobId,JSON.stringify(request),JSON.stringify(result),now,now,now,expires,now);
  }
  const h=await createSceneStoreHost({workerFixture:worker,exposeSceneTestAccessors:false}),store=h.store;
  assert.equal(store.session.get().user.role,"admin");assert.equal(store.session.get().canvas.access,true);
  const history=[],priorHistory=globalThis.history;
  globalThis.history={pushState(_state,_title,value){history.push(String(value));const url=new URL(value,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(...args){this.pushState(...args);}};
  t.after(()=>{globalThis.history=priorHistory;});
  const original={events:store.events.get(),head:store.head.get(),content:store.content.get()},resume=observeActualSceneResumeReads(h);
  let verify=()=>{},railReceipt=null;
  t.after(async()=>{try{await resume.settleOriginalRequests();await verify();}finally{railReceipt?.restore();resume.restore();}});
  const f=await createCalmFullPage(t,{locale,storeHost:h});
  store.events.set(original.events);store.head.set(original.head);store.content.set(original.content);
  const definitions=JSON.parse(fs.readFileSync(new URL("../../custom-elements.json",import.meta.url),"utf8"));
  const byTag=new Map(definitions.modules.flatMap(module=>(module.declarations??[]).filter(value=>value.tagName).map(value=>[value.tagName,{file:module.path,name:value.name}]))),registered=new Set();
  async function register(tag){if(registered.has(tag))return;registered.add(tag);const entry=byTag.get(tag);assert.ok(entry,"actual registered component "+tag);
    if(!f.renderer.registry[tag])f.renderer.registry[tag]=(await ports.loadActual(entry.file))[entry.name];
    for(const child of new Set([...fs.readFileSync(new URL("../../"+entry.file,import.meta.url),"utf8").matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match=>match[1])))await register(child);}
  // renderOutcomeDesk emits this actual dependency from its helper template;
  // register it before a synchronous native View→Desk transition queries DOM.
  for(const tag of["forma-canvas-application","forma-workspace","forma-ui-disclosure"])await register(tag);
  // Keep the existing finite ResizeObserver rule for a same-sized Canvas viewport.
  const resizeSeen=new WeakMap();f.resizeTargets=new class extends Map{*[Symbol.iterator](){for(const[observer,node]of super[Symbol.iterator]()){
    if(classed(node,"canvas-viewport")){const owner=node.owner??node,box=node.getBoundingClientRect(),stamp=box.width+":"+box.height;
      if(resizeSeen.get(owner)===stamp)continue;resizeSeen.set(owner,stamp);}yield[observer,node];}}}(f.resizeTargets);
  // The real Canvas initial-camera RAF reads client dimensions, not only its
  // rectangle. Supply that missing native property from this fixture's existing
  // finite box; never change a Canvas method or force a virtualized card visible.
  const collectViewport=f.renderer.collect.bind(f.renderer);
  f.renderer.collect=(markup,owner)=>{
    const first=f.renderer.nodes.length;collectViewport(markup,owner);
    if(owner.tag!=="forma-canvas-surface")return;
    const collected=f.renderer.nodes.slice(first);
    const stages=collected.filter(node=>node.tag==="section"&&classed(node,"canvas-stage-shell"));
    for(const node of collected)if(classed(node,"canvas-viewport")){
      assert.equal(stages.length,1,"one actual Canvas stage owns the finite viewport");
      const stage=stages[0];
      const dimension=key=>{
        // Same local render batch only: full page/closest queries are invalid
        // while an ancestor's new hierarchy has not committed yet.
        if(!node.isConnected||!owner.isConnected||stage.hidden||Object.hasOwn(stage.attributes,"hidden"))return 0;
        const value=node.getBoundingClientRect()[key];assert.ok(Number.isFinite(value)&&value>=0,"finite native Canvas "+key);return value;
      };
      Object.defineProperties(node,{clientWidth:{configurable:true,get:()=>dimension("width")},
        clientHeight:{configurable:true,get:()=>dimension("height")}});
    }
  };
  const native=installOutputNavigationFocusNative(t,f,ports);
  store.route.set("/canvas/"+BOARD+"/current-authorized-board");assert.equal(store.chooseCanvasPlanningDocument(worker.documentId),true);
  // This exact fixture setup choice is not an application default/first-document fallback.
  if(origin==="desk")store.route.set(withOutcomeDeskSelection(withOutcomeDeskPosture(store.route.get(),"outcomes"),"document:"+worker.documentId));
  Object.assign(h.location,(()=>{const url=new URL(store.route.get(),"http://localhost");return{pathname:url.pathname,search:url.search,hash:url.hash};})());
  if(mode==="document-job"||mode==="board-job")await store.syncDocumentJobs();
  await drain(f);
  const wrappers=f.components().filter(value=>value.tag==="forma-canvas-application"),surfaces=f.components().filter(value=>value.tag==="forma-canvas-surface");
  assert.equal(wrappers.length,1);assert.equal(surfaces.length,1);
  const canvas=surfaces[0];assert.ok(canvas.isConnected&&wrappers[0].isConnected);
  assert.strictEqual(canvas.closest("forma-canvas-application"),wrappers[0]);
  assert.ok(canvas instanceof f.renderer.registry["forma-canvas-surface"],"the actual registered CanvasApplication, not its route wrapper, owns these controls");
  t.diagnostic("BOARD_GROUP_PREREQUISITE "+JSON.stringify({origin,mode,route:store.route.get(),canvasAccess:store.session.get()?.canvas.access,canvasId:store.canvasProjection.get().selectedCanvasId,planningDocument:store.canvasPlanningDocumentId(),sections:f.tree().nodes.filter(node=>node.tag==="section"||classed(node,"outcome-desk-selected")).map(node=>({class:node.attributes.class,owner:node.owner?.tag,exactCanvas:node.owner===canvas,hiddenBy:node.hiddenBy})),visibleText:f.tree().root.text.slice(0,1200)}));
  assert.equal(store.canvasProjection.get().selectedCanvasId,BOARD);assert.equal(store.canvasPlanningDocumentId(),worker.documentId);
  assert.ok(store.sourceOwnershipActive(store.captureSourceOwnership()));assert.ok(store.routeDataReady());
  // Default remains GET + independently certified free Resume only. The two
  // explicit cross-audience Rail cases additionally observe ONE original append.
  railReceipt=railDocumentReceipt===null?null:observeBoardRailDocument(h,resume,railDocumentReceipt);
  // Explicit test-only preparation for the one empty-References link witness.
  // Default callers retain their original declared seeds and audited POST rules.
  let referenceSetupRequest=null;
  if(referencePlacementSetup!==null){
    assert.equal(railDocumentReceipt,null,"Reference setup and Rail writes are distinct proof families");
    assert.equal(typeof referencePlacementSetup,"function");
    referenceSetupRequest=await referencePlacementSetup({f,h,canvas,native,history,resume,
      boardId:BOARD,projectId:worker.projectId,documentId:worker.documentId});
    assert.ok(h.requests.includes(referenceSetupRequest),"setup returns the actual original request, not a clone");
    assert.equal(referenceSetupRequest.url,"/api/events");assert.equal(referenceSetupRequest.init.method,"POST");
    assert.equal(referenceSetupRequest.body.action,"canvas_sync");
    assert.equal(referenceSetupRequest.body.events.length,1);
    const event=referenceSetupRequest.body.events[0];
    assert.equal(event.type,"CanvasItemPlaced");assert.equal(event.payload.source_kind,"reference");
    assert.equal(event.payload.project_id,worker.projectId);assert.equal(event.payload.canvas_id,BOARD);
  }
  const referenceSetupInit=referenceSetupRequest?.init,referenceSetupBytes=referenceSetupInit?.body;
  const isReferenceSetup=request=>Boolean(referenceSetupRequest&&request===referenceSetupRequest
    &&request.init===referenceSetupInit&&request.init.body===referenceSetupBytes&&JSON.stringify(request.body)===referenceSetupBytes);
  const fiscal=financial(worker),privateContent=worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
  let authored=(await readWorkspaceEvents(worker.env,worker.streamId)).filter(event=>!navigationTypes.has(event.type));
  verify=async()=>{if(railReceipt)await railReceipt.verify();t.diagnostic("BOARD_ORIGINAL_RESUME_PROOFS "+JSON.stringify({pending:resume.pendingOriginalCount(),observations:resume.observations()}));assert.deepEqual((await readWorkspaceEvents(worker.env,worker.streamId)).filter(event=>!navigationTypes.has(event.type)),authored,"no source/result/approval write beyond explicit fixture setup");assert.deepEqual(financial(worker),fiscal,"exact original jobs and every existing fiscal/provider row are unchanged");
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),privateContent,"no new/replaced private content");
    assert.deepEqual(h.requests.filter(request=>(request.init.method??"GET")!=="GET"&&!resume.isReadOnlyResume(request)&&!railReceipt?.isOriginal(request)&&!isReferenceSetup(request)),[],railReceipt?"only original certified free Resume and the one exact original Rail DocumentOpened may use POST":referenceSetupRequest?"only original certified free Resume and the one independently verified native Reference setup placement may use POST":"only positively observed exact original free Resume reads may use POST");};
  const sourceUnchanged=async()=>assert.deepEqual((await readWorkspaceEvents(worker.env,worker.streamId)).filter(event=>!navigationTypes.has(event.type)),authored);
  const external=async(type,payload)=>{
    const changes=()=>worker.sqlite.prepare("SELECT total_changes() AS changes").get().changes;
    t.diagnostic("BOARD_EXPLICIT_SOURCE_SEED "+JSON.stringify({phase:"before",type,pendingOriginals:resume.pendingOriginalCount(),sqliteChanges:changes(),observations:resume.observations().length}));
    // Finish only captured original transports before this explicit fixture
    // write. The caller still awaits external() inside its original held tick;
    // this performs no redraw, navigation completion, replay or new request.
    const settled=await resume.settleOriginalRequests();
    t.diagnostic("BOARD_ORIGINAL_RESUME_SETTLED_BEFORE_SEED "+JSON.stringify({type,pendingOriginals:resume.pendingOriginalCount(),sqliteChanges:changes(),
      originals:settled.map(({request,status,responseStatus})=>({url:request.url,method:request.init.method??"GET",status,responseStatus,classified:resume.isReadOnlyResume(request)})),
      observations:resume.observations()}));
    assert.equal(resume.pendingOriginalCount(),0,"No already-started original transport overlaps the explicit fixture write");
    assert.deepEqual(h.requests.filter(request=>(request.init.method??"GET")!=="GET"&&!resume.isReadOnlyResume(request)),[],
      "Before seeding, each original POST must already have its exact positive no-write Resume proof");
    const appended=await seed(type,payload);
    t.diagnostic("BOARD_EXPLICIT_SOURCE_SEED "+JSON.stringify({phase:"after",type,eventId:appended.eventId,pendingOriginals:resume.pendingOriginalCount(),sqliteChanges:changes(),observations:resume.observations().length}));
    authored=(await readWorkspaceEvents(worker.env,worker.streamId)).filter(event=>!navigationTypes.has(event.type));await store.refreshEvents();
  };
  return Object.assign(f,{origin,canvas,native,documentId:worker.documentId,projectId:worker.projectId,jobId,history,resume,railReceipt,sourceUnchanged,external});
}


export { options, BOARD, OTHER_BOARD, OTHER_DOCUMENT, RAW, classed, inside, drain, reached, dialogs, activate, cards, currentActions, priority, boardPage, ports, sceneDeferred };
