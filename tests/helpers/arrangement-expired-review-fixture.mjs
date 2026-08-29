import assert from "node:assert/strict";
import {fileURLToPath,pathToFileURL} from "node:url";

// Complete actual Shell/Canvas/Store/Worker fixture. Only native DOM, HTTP,
// clock and in-memory persistence ports are deterministic; no browser claim.
const ROOT=fileURLToPath(new URL("../../",import.meta.url)).replace(/\/$/u,"");
const{createSceneCostFixture}=await import(pathToFileURL(ROOT+"/tests/helpers/scene-cost-fixture.mjs").href);
const{createSceneStoreHost,sceneDeferred,untilScene}=await import(pathToFileURL(ROOT+"/tests/helpers/scene-cost-store-host.mjs").href);
const{createCalmFullPage}=await import(pathToFileURL(ROOT+"/tests/helpers/calm-full-page-fixture.mjs").href);
const{appendAuditEvent}=await import(pathToFileURL(ROOT+"/worker/runtime.ts").href);
const{canvasQueueDatabase}=await import(pathToFileURL(ROOT+"/tests/helpers/canvas-source-queue-host.mjs").href);
const{accountCachePort,financial}=await import(pathToFileURL(ROOT+"/tests/helpers/event-source-retirement-fixture.mjs").href);
const{outcomeDeskIntegrationCopy}=await import(pathToFileURL(ROOT+"/src/components/design-system/locales/outcome-desk-integration-messages.ts").href);

const { outcomeDeskCopy } = await import(pathToFileURL(ROOT + "/src/components/design-system/locales/outcome-recipe-messages.ts").href);
const { disclosureDbClock } = await import(pathToFileURL(ROOT + "/tests/helpers/authoring-disclosure-boundary.mjs").href);
const ROOT_PRIVATE_NAME="PRIVATE arrangement typed before source withdrawal";
async function page(t,{shared=true,locale="en"}={}){
 const denied=t.mock.method(globalThis,"fetch",async()=>assert.fail("No external/provider request"));
 accountCachePort(t);const accountIndexedDB=globalThis.indexedDB,queueDatabase=canvasQueueDatabase();
 globalThis.indexedDB={open(name,version){return name==="canvas-offline-queue-v1"?queueDatabase.indexedDB.open(name,version):accountIndexedDB.open(name,version);}};
 const worker=await createSceneCostFixture(1,"visual",{shared});
 worker.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(worker.owner);
 const board="source-arrangement-board",selected=["source-arrangement-card-a","source-arrangement-card-b"];
 await appendAuditEvent(worker.env,worker.streamId,"user","CanvasCreated",{project_id:worker.projectId,canvas_id:board,name:"Current source arrangement board"});
 for(const [index,itemId]of selected.entries()){
  await appendAuditEvent(worker.env,worker.streamId,"user","BlockCreated",{block_id:"source-arrangement-block-"+index,project_id:worker.projectId,canvas_id:board,scope:"canvas",type:"direction",handle:"direction/source-arrangement-"+index,position:"z"+index,properties:{text:"Current arrangement source "+index,intent:"include",weight:1}});
  await appendAuditEvent(worker.env,worker.streamId,"user","CanvasItemPlaced",{project_id:worker.projectId,canvas_id:board,item_id:itemId,source_kind:"block",source_id:"source-arrangement-block-"+index,title:"Current arrangement card "+index,block_type:"direction",frame:{x:index*350+10,y:index*25+10,w:300,h:200,rot:0,z:"z"+index}});
 }
 const h=await createSceneStoreHost({workerFixture:worker});
 const original={events:h.store.events.get(),content:h.store.content.get(),head:h.store.head.get(),session:h.store.session.get()};
 assert.equal(original.session.canvas.access,true,"genuine Worker administrator Canvas access");
 assert.ok((original.session.projectContext?.permissions??original.session.capabilities).includes("project.canvas.use"),"genuine Worker project Canvas permission");
 const previousHistory=globalThis.history,previousChannel=globalThis.BroadcastChannel,online=Object.getOwnPropertyDescriptor(globalThis.navigator,"onLine");
 globalThis.BroadcastChannel=undefined;Object.defineProperty(globalThis.navigator,"onLine",{configurable:true,value:true});
 globalThis.history={pushState(_s,_t,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash,href:url.href});},replaceState(...args){this.pushState(...args);}};
 t.after(()=>{globalThis.history=previousHistory;globalThis.BroadcastChannel=previousChannel;if(online)Object.defineProperty(globalThis.navigator,"onLine",online);else delete globalThis.navigator.onLine;assert.equal(denied.mock.callCount(),0);});
 let verifyPage=()=>{};t.after(()=>verifyPage());
 const f=await createCalmFullPage(t,{locale,storeHost:h});
 h.store.events.set(original.events);h.store.content.set(original.content);h.store.head.set(original.head);h.store.session.set(original.session);
 h.store.route.set("/canvas/"+board+"/source-arrangement?view=list&recipe=executive-deck");
 const dispatch=h.window.dispatchEvent.bind(h.window);h.window.dispatchEvent=event=>{const value=dispatch(event);for(const listener of[...(f.listeners.get(event.type)??[])]){if(typeof listener==="function")listener(event);else listener.handleEvent(event);}return value;};
 await f.settle();
 const canvas=()=>f.components().find(component=>component.tag==="forma-canvas-application");
 assert.ok(canvas(),"actual Shell-mounted Canvas");assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
 assert.equal(h.store.canvasProjection.get().selectedCanvasId,board);assert.equal(h.store.canvasProjection.get().items.length,2);
 const arrangementPosts=()=>h.requests.filter(row=>row.url==="/api/canvas/arrangements");
 const responses=[],holds=[],gates=[],originalSource=h.store.captureSourceOwnership(),originalAuth=h.store.captureAuthorizationScope(),beforeFinancial=financial(worker),start=h.requests.length;
 h.transport=async request=>{
  const response=await worker.request(request.url,request.init);
  if(request.url==="/api/canvas/arrangements"){
   const body=await response.clone().json();responses.push({command:request.body,status:response.status,body});
   const index=holds.findIndex(row=>row.action===request.body.action);
   if(index>=0){const hold=holds.splice(index,1)[0];hold.wire={command:request.body,status:response.status,body};hold.entered.resolve();await hold.gate.promise;}
  }
  return response;
 };
 const hold=action=>{const entered=sceneDeferred(),gate=sceneDeferred(),value={action,entered,gate,wire:null,release:()=>gate.resolve()};holds.push(value);gates.push(value);return value;};
 const privateVisible=()=>f.tree().nodes.some(node=>!node.hiddenBy&&(node.text.includes(ROOT_PRIVATE_NAME)||String(node.port?.value??"").includes(ROOT_PRIVATE_NAME)));
 const operation=()=>new URL(h.store.route.get(),"http://localhost").searchParams.get("arrangement");
 const ledger=()=>worker.sqlite.prepare("SELECT * FROM authoring_commits ORDER BY preview_id").all();
 const retire=async()=>{
  assert.ok(shared);worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),worker.sharing.contextId);
  const genuine=await worker.request("/api/events?after=0&limit=2000&content=0");assert.equal(genuine.status,403);
  await assert.rejects(h.store.refreshEvents(),/403/);
  assert.equal(h.store.sourceOwnershipActive(originalSource),false);assert.equal(h.store.authorizationScopeActive(originalAuth),true);
  await f.settle();assert.equal(h.store.routeDataReady(),false);assert.equal(canvas(),undefined,"the real Shell unmounts Canvas while source is unavailable");
  assert.equal(privateVisible(),false);return{status:genuine.status,canvasOwners:0,privateVisible:false};
 };
 const restore=async()=>{
  worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(worker.sharing.contextId);
  await h.store.refreshEvents();await f.settle();
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);assert.equal(h.store.sourceOwnershipActive(originalSource),false);
  assert.equal(h.store.authorizationScopeActive(originalAuth),true);assert.equal(h.store.routeDataReady(),true);assert.ok(canvas());
 };
 const drain=async()=>{for(let step=0;step<5;step++)await f.settle();};
 verifyPage=()=>{
  for(const gate of gates)gate.release();
  assert.deepEqual(financial(worker),beforeFinancial,"no jobs, used/held money, provider calls, or purchase slots change");
  assert.ok(h.requests.slice(start).filter(row=>(row.init.method??"GET")!=="GET").every(row=>row.url==="/api/canvas/arrangements"),"only the explicit arrangement commands are submitted");
  assert.equal(queueDatabase.values.size,0,"atomic arrangements never enter the generic offline queue");
 };
 return{f,h,worker,board,selected,canvas,arrangementPosts,responses,hold,privateVisible,operation,ledger,retire,restore,drain,originalSource,originalAuth,copy:outcomeDeskIntegrationCopy(locale)};
}

async function openArrangement(x,{select=true,name=ROOT_PRIVATE_NAME,confirmation=false}={}){
 const{f}=x;
 if(select)for(let index=0;index<2;index++)await f.act(f.find("button",node=>node.text.includes("Current arrangement card "+index)),"click",{shiftKey:index>0});
 const menu=f.components().find(component=>component.tag==="forma-ui-popover"&&String(component.attributes?.class??"").includes("canvas-view-menu"));assert.ok(menu);
 const trigger=f.find("button",node=>node.owner===menu&&String(node.attributes.class??"").includes("ui-popover-trigger"));
 await f.act(trigger);
 // Native declarative popovertarget default action, using the exact rendered
 // target after the actual trigger handler; no component/executor is replaced.
 const panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.id===trigger.attributes.popovertarget);
 assert.ok(panel);panel.showPopover();await f.settle();
 await f.act(f.find("button",node=>node.text===x.copy.arrange));
 const dialogs=f.tree().visible("dialog");assert.equal(dialogs.length,confirmation?2:1);
 assert.equal(dialogs.filter(node=>String(node.attributes.class??"").includes("canvas-outcome-arrangement-dialog")).length,1);
 if(confirmation){assert.equal(x.h.store.ui.impersonationConfirmOpen,true);assert.equal(dialogs.filter(node=>String(node.attributes.class??"").includes("impersonation-confirm-dialog")).length,1);}
 if(name!==null){const input=f.find("input",node=>node.parent?.tag==="label"&&node.parent.text.includes(x.copy.name));input.port.value=name;await f.act(input,"input");}
}
async function previewArrangement(x){
 const{f}=x;await openArrangement(x);
 await f.act(f.find("form",node=>String(node.attributes.class??"").includes("canvas-arrangement-form")),"submit");
 await untilScene(()=>x.arrangementPosts().some(row=>row.body?.action==="preview"),"actual arrangement preview request");
 await x.drain();
 assert.ok(f.tree().root.text.includes(ROOT_PRIVATE_NAME),"genuine current preview is rendered");
 const wire=x.responses.find(row=>row.command.action==="preview");assert.equal(wire.status,200);assert.equal(wire.body.status,"review");assert.equal(wire.body.preview.name,ROOT_PRIVATE_NAME);
 return wire.body.preview;
}
const applyControl=x=>x.f.find("button",node=>node.attributes["data-choice-value"]===x.operation());
async function openReceipt(x){
 const{f}=x,menu=f.components().find(component=>component.tag==="forma-ui-popover"&&String(component.attributes?.class??"").includes("canvas-view-menu"));assert.ok(menu);
 const trigger=f.find("button",node=>node.owner===menu&&String(node.attributes.class??"").includes("ui-popover-trigger"));
 await f.act(trigger);const panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.id===trigger.attributes.popovertarget);assert.ok(panel);panel.showPopover();await f.settle();
 await f.act(f.find("button",node=>node.text===x.copy.openReceipt));
}

const visibleButtons = x => x.f.tree().visible("button");
const control = (x, label) => x.f.find("button", node => node.text === label);
async function closeAndReenter(x) {
  const labels = [x.copy.close, outcomeDeskCopy(x.f.locale ?? "en").close];
  const close = visibleButtons(x).find(node => labels.includes(node.text));
  assert.ok(close, "current close control");
  const before = x.arrangementPosts().length, identity = x.operation();
  await x.f.act(close); await x.drain();
  assert.equal(x.f.tree().visible("dialog").length, 0);
  assert.equal(x.arrangementPosts().length, before, "Close alone does not dispatch anything");
  await openReceipt(x); await x.drain();
  assert.equal(x.f.tree().visible("dialog").length, 1);
  assert.equal(x.operation(), identity);
  assert.equal(x.arrangementPosts().length, before + 1, "explicit View receipt performs exactly one existing receipt read");
  assert.equal(x.arrangementPosts().at(-1).body.action, "retrieve");
  assert.equal(x.arrangementPosts().at(-1).body.operationId, identity);
  return x.responses.at(-1);
}
async function check(x, locale) {
  const before = x.arrangementPosts().length;
  await x.f.act(control(x, outcomeDeskCopy(locale).retrieve));
  await untilScene(() => x.arrangementPosts().length > before, "actual current Check request");
  await x.drain();
  const response = x.responses.at(-1);
  assert.equal(response.command.action, "retrieve"); assert.equal(response.command.operationId, x.operation());
  return response;
}
const currentFrames = x => x.h.store.canvasProjection.get().items.map(item => [item.id, item.x, item.y, item.w, item.h]);
const retained = (x, preview) => x.worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(preview.previewId);
// Fault only the native SQL adapter immediately AFTER its real lease UPDATE.
// No forged lease, receipt, plan, preview, status or approval is introduced.
function crashAfterRealClaim(x) {
  const prepare = x.worker.env.DB.prepare.bind(x.worker.env.DB); let crashed = 0;
  x.worker.env.DB.prepare = sql => {
    const statement = prepare(sql), bind = statement.bind.bind(statement);
    if (!sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','applying'")) return statement;
    statement.bind = (...values) => {
      const bound = bind(...values), run = bound.run.bind(bound);
      bound.run = async () => {
        const result = await run();
        if (!crashed && Number(result.meta.changes) === 1) { crashed++; throw new Error("test_worker_interrupted_after_actual_claim"); }
        return result;
      };
      return bound;
    };
    return statement;
  };
  return { count: () => crashed, restore: () => { x.worker.env.DB.prepare = prepare; } };
}
function moveNativeClocks(t, x, time) {
  const clock = disclosureDbClock(x.worker); clock.set(new Date(time).toISOString());
  t.mock.timers.enable({ apis: ["Date"], now: time });
  t.after(() => { t.mock.timers.reset(); clock.close(); });
  assert.equal(Date.now(), time);
  assert.equal(x.worker.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").get().now, new Date(time).toISOString());
  return {set(next){clock.set(new Date(next).toISOString());t.mock.timers.setTime(next);}};
}

// The old full-class renderer supports classes/tags but ignores this native
// attribute-only selector. Add only its exact standards meaning, preserving
// the original owner/descendant filter and every real component/Store method.
function dispositionNativePort(t,x){
  const query=x.f.renderer.query;
  x.f.renderer.query=function(owner,selector){
    const result=query.call(this,owner,selector);
    return selector==="[data-arrangement-disposition]"?result.filter(node=>Object.hasOwn(node.attributes??{},"data-arrangement-disposition")):result;
  };
  t.after(()=>{x.f.renderer.query=query;});
  assert.equal(x.canvas().querySelector("[data-arrangement-disposition]"),null,"an unrelated first Canvas node is not the requested native button");
}
function pendingForm(x){return x.f.tree().visible("form").find(node=>String(node.attributes.class??"").includes("canvas-arrangement-form"));}
function dispositionControl(x){return x.f.tree().visible("button").find(node=>node.attributes["data-arrangement-disposition"]===x.operation());}
function lateClick(node){return node.handlers.click.call(node.owner,{target:node.port,currentTarget:node.port,preventDefault(){},stopPropagation(){}});}
function watchSubscriptions(t,store){
  const subscribe=store.subscribe.bind(store),active=new Set();let adds=0,removes=0;
  t.mock.method(store,"subscribe",listener=>{
    adds++;active.add(listener);const stop=subscribe(listener);let live=true;
    return()=>{if(!live)return;live=false;removes++;active.delete(listener);stop();};
  });
  return{active:()=>active.size,counts:()=>({adds,removes,active:active.size})};
}
export{page,openArrangement,previewArrangement,applyControl,openReceipt,sceneDeferred,untilScene,
  outcomeDeskCopy,visibleButtons,control,closeAndReenter,check,currentFrames,retained,crashAfterRealClaim,moveNativeClocks,
  dispositionNativePort,pendingForm,dispositionControl,lateClick,watchSubscriptions};

/** Fixture setup only: enables the actual Store/Shell modal, not backend impersonation authority. */
function enableImpersonation(x){
  const base=x.h.store.session.get();
  x.h.setSession({impersonation:{active:true,impersonationId:"native-modal-test",personaId:"native-modal-persona",
    replaySessionId:"native-modal-replay",actor:base.user,fictionalUser:base.user,
    startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600_000).toISOString()}});
  x.h.store.notify();
}
async function confirmImpersonation(x){
  await untilScene(()=>x.h.store.ui.impersonationConfirmOpen,"actual Store confirmation gate");await x.drain();
  const tree=x.f.tree(),modal=tree.visible("dialog").find(node=>String(node.attributes.class??"").includes("impersonation-confirm-dialog"));
  assert.ok(modal,"actual Shell impersonation modal");
  const contains=node=>{for(let parent=node.parent;parent;parent=parent.parent)if(parent===modal)return true;return false;};
  const button=tree.visible("button").find(node=>contains(node)&&String(node.attributes.class??"").split(/\s+/u).includes("primary"));
  assert.ok(button,"actual Shell confirm-this-interaction button");await x.f.act(button);await x.drain();
}
async function expiredArrangement(t,{locale="en",shared=false,qualify=true}={}){
  const x=await page(t,{locale,shared});dispositionNativePort(t,x);
  const preview=await previewArrangement(x),frames=currentFrames(x),crash=crashAfterRealClaim(x);t.after(crash.restore);
  await x.f.act(applyControl(x));await x.drain();assert.equal(crash.count(),1);crash.restore();
  assert.equal(x.responses.at(-1).status,202);assert.equal(x.responses.at(-1).body.status,"applying");
  const claim=JSON.parse(retained(x,preview).content);moveNativeClocks(t,x,Date.parse(preview.expiresAt)+1);
  const row=retained(x,preview);
  if(qualify){const read=await closeAndReenter(x);assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_preview_expired");}
  assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);
  return{x,preview,frames,claim,row};
}
async function freshArrangementOwner(x){
  const route=x.h.store.route.get(),oldCanvas=x.canvas(),count=x.arrangementPosts().length;
  x.h.store.setRoute("/settings");await x.drain();assert.equal(x.canvas(),undefined);assert.equal(oldCanvas.isConnected,false);
  x.h.store.setRoute(route);await x.drain();assert.ok(x.canvas());assert.notEqual(x.canvas(),oldCanvas);
  assert.equal(x.h.store.route.get(),route);assert.equal(x.arrangementPosts().length,count,"new owner performs no automatic receipt read or Apply");
  return oldCanvas;
}
function assertDescriptor(x,preview,read){
  assert.equal(read.command.includeDisposition,true);assert.equal(read.status,409);
  assert.deepEqual(Object.keys(read.body).sort(),["disposition","error","maximumMicrousd","providerCalls"]);
  assert.equal(read.body.error,"canvas_arrangement_preview_expired");assert.equal(read.body.providerCalls,0);assert.equal(read.body.maximumMicrousd,0);
  assert.deepEqual(read.body.disposition,{version:1,actorUserId:x.h.store.session.get().user.userId,
    operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,previewId:preview.previewId,approvalHash:preview.approvalHash});
  assert.equal(JSON.stringify(read.body).includes(preview.name),false);assert.equal(read.body.preview,undefined);
}
export{enableImpersonation,confirmImpersonation,expiredArrangement,freshArrangementOwner,assertDescriptor,disclosureDbClock};
