import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./scene-cost-store-host.mjs";
import { readWorkspaceEvents } from "../../worker/runtime.ts";
import { canvasQueueDatabase, canvasQueueTurn } from "./canvas-source-queue-host.mjs";

const fixtureUrl=new URL("../canvas-calm-controls-host.test.mjs",import.meta.url),source=fs.readFileSync(fixtureUrl,"utf8");
const tree=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const first=tree.statements.findIndex(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="test");assert.ok(first>0);
const helperNames=["ownedPopover","openOwnedPopover","organizeEvent","runPortHandler"];
const extra=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&helperNames.includes(node.name?.text));
let text=[...tree.statements.slice(0,first),...extra].map(node=>node.getFullText(tree)).join("\n")
  +"\nexport {fixture,offlinePort,windowPort,navigatorPort,documentPort,ownedPopover,openOwnedPopover,organizeEvent};";
const loaderSeam='const code = ts.transpileModule(sourceText(relative),';
assert.ok(text.includes(loaderSeam));
text=text.replace(loaderSeam,'const production=sourceText(relative),parsed=ts.createSourceFile(relative,production,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const canvasOwner=relative==="src/canvas/canvas-application.ts"?parsed.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="CanvasApplication"):null;const candidate=canvasOwner?production.slice(0,canvasOwner.end-1)+"\\ncanvasSourcePendingForTest(){return this.#flushPromise;}\\n"+production.slice(canvasOwner.end-1):production;\nconst code = ts.transpileModule(candidate,');
const moduleUrl=new URL(fixtureUrl);moduleUrl.search="?canvas-source-retirement";
const hook=registerHooks({load(url,context,next){return url===moduleUrl.href?{format:"module",source:text,shortCircuit:true}:next(url,context);}});
let ports;try{ports=await import(moduleUrl.href);}finally{hook.deregister();}

const queueMethods=["enqueueBatch","listBatches","summary","removeBatch","retireSource","reconcileRetired"];
const originalScope=h=>{
  const session=h.store.session.get(),context=session.projectContext;
  return{ownerId:session.user.userId,projectId:h.worker.projectId,...(context?{historyOwnerId:context.ownerUserId,organizationId:context.organizationId,projectAccessId:context.projectAccessId,permissionEpoch:session.permissionEpoch}:{})};
};
export async function canvasSourceStoreFixture(t,{locale="en",shared=false,artifact=false}={}){
  const denied=t.mock.method(globalThis,"fetch",async()=>assert.fail("No live provider or application network is permitted"));
  const worker=await createSceneCostFixture(1,"visual",{shared}),streamId=shared?"project:"+worker.sharing.projectAccessId:worker.streamId;
  const seed=[{type:"CanvasCreated",payload:{canvas_id:"board-a",project_id:worker.projectId,name:"Private source board",slug:"board-a"}}];
  for(let index=0;index<2;index++)seed.push({type:"CanvasItemPlaced",payload:{
    canvas_id:"board-a",project_id:worker.projectId,item_id:"item-block-"+index,source_kind:"block",source_id:"scene-reuse-direction",
    title:"PRIVATE ORIGINAL BOARD ITEM "+index,block_type:"direction",frame:{x:index*350,y:0,w:300,h:210,z:"a"+index},
  }});
  if(artifact)seed.push({type:"CanvasItemPlaced",payload:{canvas_id:"board-a",project_id:worker.projectId,item_id:"item-artifact",source_kind:"artifact",source_id:"saved-scene-story",title:"Saved exact artifact",block_type:"short_story",frame:{x:1000,y:0,w:300,h:210,z:"z"}}});
  for(const [index,event]of seed.entries()){event.payload.history_owner_id=worker.owner;event.payload.client_event_id="seed-client-"+index;}
  const seeded=await worker.request("/api/events",worker.json({action:"canvas_sync",events:seed,clientId:"canvas-fixture"}));
  assert.equal(seeded.status,200,await seeded.clone().text());const seedBody=await seeded.json();assert.equal(seedBody.appended.length,artifact?4:3,JSON.stringify(seedBody));
  const h=await createSceneStoreHost({workerFixture:worker}),db=canvasQueueDatabase(),queue=h.modules.get("src/sync/canvas-offline-queue.ts").canvasOfflineQueue;
  let uninstall;db.install({after(callback){uninstall=callback;}});
  const previousQueue={...ports.offlinePort},previousTimers={setTimeout:ports.windowPort.setTimeout,clearTimeout:ports.windowPort.clearTimeout},previousOnline=ports.navigatorPort.onLine;
  for(const method of queueMethods)ports.offlinePort[method]=queue[method].bind(queue);
  ports.navigatorPort.onLine=false;
  const timers=new Map();let timer=0;
  ports.windowPort.setTimeout=(callback,delay)=>{timers.set(++timer,{callback,delay});return timer;};
  ports.windowPort.clearTimeout=id=>timers.delete(id);
  h.store.route.set("/canvas/board-a/board-a");Object.assign(h.location,{pathname:"/canvas/board-a/board-a",search:"",hash:""});
  h.store.loading.set(false);h.store.patchUi({instrumentation:false});
  h.document.documentElement.lang=locale;h.document.documentElement.dir=locale==="ar"?"rtl":"ltr";
  const f=ports.fixture({storeHost:h,locale,populated:true,documentCount:1});
  const originalDispatch=h.window.dispatchEvent.bind(h.window);
  h.window.dispatchEvent=event=>{
    originalDispatch(event);
    for(const callback of [...(f.listeners.get(event.type)??[])]){if(typeof callback==="function")callback(event);else callback.handleEvent(event);}
    return true;
  };
  const scope=originalScope(h),beforeMoney=worker.counts(),gates=[];
  t.after(async()=>{
    const pending=f.host.canvasSourcePendingForTest();
    if(f.host.isConnected){f.host.isConnected=false;f.host.disconnectedCallback();}
    for(const gate of gates)gate.resolve();
    await pending;
    for(let turn=0;turn<8;turn++)await canvasQueueTurn();
    for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
    f.i18n.hostDisconnected();
    for(const key of Object.keys(ports.offlinePort))delete ports.offlinePort[key];Object.assign(ports.offlinePort,previousQueue);
    Object.assign(ports.windowPort,previousTimers);ports.navigatorPort.onLine=previousOnline;
    assert.deepEqual(worker.counts(),beforeMoney,"Canvas retirement never purchases/releases provider work");
    assert.equal(denied.mock.callCount(),0);
    assert.equal(h.requests.filter(request=>request.url.startsWith("/api/document-jobs")&&request.init.method==="POST").length,0);
    await h.close();uninstall();
  });
  const originalInput=index=>({type:"CanvasItemPlaced",payload:{
    project_id:scope.projectId,canvas_id:"board-a",history_owner_id:scope.ownerId,history_action_id:"original-batch",
    client_event_id:"original-client-"+index,item_id:"new-item-"+index,source_kind:"block",source_id:"scene-reuse-direction",
    title:"PRIVATE RETIRED QUEUE BODY "+index,block_type:"direction",frame:{x:800+index*350,y:0,w:300,h:210,z:"z"+index},
  }});
  const online=()=>{ports.navigatorPort.onLine=true;for(const callback of f.listeners.get("online")??[])callback({type:"online"});};
  const offline=()=>{ports.navigatorPort.onLine=false;};
  const sourceRead=request=>request.url.startsWith("/api/events?")&&(request.init.method??"GET")==="GET";
  const syncWrite=request=>request.url==="/api/events"&&request.body?.action==="canvas_sync";
  const retire=async(status=403)=>{
    const previous=h.intercept;h.intercept=async request=>sourceRead(request)?new Response(null,{status}):previous?.(request);
    await assert.rejects(h.store.refreshEvents(),new RegExp(String(status)));h.intercept=previous;
    assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),false);
    if(f.host.isConnected)f.draw();await canvasQueueTurn();return h.store.captureSourceOwnership();
  };
  const restore=async()=>{
    await h.store.refreshEvents();assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
    f.draw();online();await canvasQueueTurn();f.draw();
  };
  return{h,f,db,queue,scope,timers,ports,streamId,originalInput,online,offline,retire,restore,sourceRead,syncWrite,
    canonical:()=>readWorkspaceEvents(worker.env,worker.streamId),deferred:()=>{const gate=sceneDeferred();gates.push(gate);return gate;},until:untilScene,turn:canvasQueueTurn};
}
