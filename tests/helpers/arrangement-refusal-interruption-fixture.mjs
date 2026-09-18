import assert from "node:assert/strict";
import {page,openArrangement,previewArrangement,explicitApply,check,pendingForm,applyControl,currentFrames,
 previewRows,untilScene,sceneDeferred,editRefusalSource,expectSourceRefusal,outcomeDeskCopy,dispositionNativePort,enableImpersonation,confirmImpersonation} from "./arrangement-refused-preview-fixture.mjs";
import {currentOutcomeArrangementContext} from "../../src/state/outcome-desk-controller.ts";
import {previewOutcomeArrangement,previewOutcomeArrangementUndo} from "../../src/canvas/outcome-arrangements.ts";
export * from "./arrangement-refused-preview-fixture.mjs";

// Complete Shell/Canvas/Store/Worker ports and authenticated source edits.
// No generated positive source token, inverse target, receipt or acknowledgment.
export const arrangementDialog=x=>x.f.tree().visible("dialog").find(node=>String(node.attributes.class??"").includes("canvas-outcome-arrangement-dialog"));
export const inverseControl=x=>x.f.tree().visible("button").find(node=>node.attributes["data-arrangement-refused-undo"]===x.operation());
export const continuationControl=x=>x.kind==="undo"?inverseControl(x):pendingForm(x);
export const counts=x=>Object.fromEntries(["preview","undo-preview","apply","retrieve","dismiss"].map(action=>[action,x.arrangementPosts().filter(row=>row.body.action===action).length]));
export async function closePreparation(x){
 const before=x.arrangementPosts().length,op=x.operation();assert.ok(arrangementDialog(x));
 const close=x.f.tree().visible("button").find(node=>node.text===x.copy.close);
 if(close)await x.f.act(close);else await x.f.act(arrangementDialog(x),"cancel");
 await x.drain();
 assert.equal(arrangementDialog(x),undefined);assert.equal(x.arrangementPosts().length,before);assert.equal(x.operation(),op);
}
export async function boardUndo(x,{mayClose=false}={}){
 assert.equal(arrangementDialog(x),undefined);assert.equal(x.h.store.canUndo(),true,"actual eligible grouped board Undo");
 const button=x.f.find("button",node=>node.attributes["aria-label"]==="Undo board action");
 assert.equal(Object.hasOwn(button.attributes,"disabled"),false);await x.f.act(button);await x.drain();if(!mayClose)assert.ok(arrangementDialog(x));
}
export async function switchPosture(x,{back=true}={}){
 const owner=x.canvas(),route=x.h.store.route.get(),before=x.arrangementPosts().length,f=x.f;
 assert.equal(arrangementDialog(x),undefined);
 const menu=f.components().find(value=>value.tag==="forma-ui-popover"&&String(value.attributes.class??"").includes("canvas-view-menu"));
 const trigger=f.find("button",node=>node.owner===menu&&String(node.attributes.class??"").includes("ui-popover-trigger"));
 await f.act(trigger);const panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.id===trigger.attributes.popovertarget);
 assert.ok(panel);panel.showPopover();await f.settle();
 await f.act(f.find("button",node=>node.attributes.id==="canvas-outcome-toggle"));await x.drain();
 assert.equal(x.canvas(),owner);assert.equal(owner.isConnected,true);
 if(back){
  assert.equal(new URL(x.h.store.route.get(),"http://localhost").searchParams.get("posture"),"outcomes");
  await f.act(f.find("a",node=>node.text===outcomeDeskCopy(x.locale).back),"click",{button:0});await x.drain();
  assert.equal(x.h.store.route.get(),route);
 }
 assert.equal(x.canvas(),owner);assert.equal(x.arrangementPosts().length,before);
}
export async function ordinaryInterruption(x,boundary){
 if(boundary==="none")return;
 await closePreparation(x);
 if(boundary==="posture"||boundary==="desk")await switchPosture(x,{back:boundary==="posture"});
 if(boundary!=="closed")await openArrangement(x,{select:false,name:null});
 await x.drain();assert.equal(continuationControl(x),undefined,"presentation changes retain no active Review grant");
}
export async function seedDocumentCards(x,{requirement=false}={}){
 const blockId="refusal-desk-source",ids=["refusal-document-card-a","refusal-document-card-b"];
 const events=[{type:"BlockCreated",payload:{project_id:x.worker.projectId,document_id:x.worker.documentId,scope:"document",
  block_id:blockId,type:"direction",handle:"direction/refusal-desk-source",position:"z-refusal",properties:{text:"Document-specific refused source",intent:"include",weight:1}}},
 ...ids.map((id,index)=>({type:"CanvasItemPlaced",payload:{project_id:x.worker.projectId,canvas_id:x.board,item_id:id,
  source_kind:"document",source_id:x.worker.documentId,title:"Current document refusal card "+index,block_type:"document",
  frame:{x:30+index*350,y:60+index*30,w:300,h:200,rot:0,z:"doc"+index}}}))];
 if(requirement){
  x.requirementId="refusal-desk-output";
  events.unshift({type:"BlockCreated",payload:{project_id:x.worker.projectId,document_id:x.worker.documentId,scope:"document",
   block_id:x.requirementId,type:"output",handle:"output/refusal-desk",position:"z-refusal-output",properties:{label:"No-generation fixture requirement"}}});
 }
 // Ordinary document authoring and Canvas placement are separate native scopes;
 // a mixed selected-project canvasAction batch requires every row's canvas_id.
 for(const scoped of[events.filter(event=>event.type==="BlockCreated"),events.filter(event=>event.type==="CanvasItemPlaced")]){
  const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"batch",events:scoped})});
  assert.equal(response.status,200,await response.clone().text());
 }
 await x.h.store.refreshEvents();await x.drain();
 for(const[index]of ids.entries())await x.f.act(x.f.find("button",node=>node.text.includes("Current document refusal card "+index)),"click",{shiftKey:index>0});
 x.selected=ids;x.selectionReady=true;x.refusalSourceText="Document-specific refused source";
 x.editRefusal=async(_x,text)=>{
  const result=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"append",event:{
   type:"BlockPropertyEdited",payload:{project_id:x.worker.projectId,document_id:x.worker.documentId,block_id:blockId,property_path:"text",
    old_value:x.refusalSourceText,new_value:text}}})});
  assert.equal(result.status,200,await result.clone().text());x.refusalSourceText=text;return result.json();
 };
 assert.equal(x.h.store.canvasPlanningDocumentId(ids),x.worker.documentId,"real current document-associated selection enables the Desk row");
}
async function originalPreview(x){
 if(!x.selectionReady&&!x.refusalModal)return previewArrangement(x);
 await openArrangement(x,{select:!x.selectionReady});
 const count=x.responses.length,pending=x.f.act(pendingForm(x),"submit");if(x.refusalModal)await confirmImpersonation(x);await pending;
 await untilScene(()=>x.responses.length>count,"actual initial document-card preview");await x.drain();
 const row=x.responses.at(-1);assert.equal(row.status,200);assert.equal(row.body.status,"review");
 assert.deepEqual(row.command.selectedItemIds,x.selected);return row.body.preview;
}

export async function readyPreparation(t,{kind="normal",shared=false,locale="en",documentCards=false,impersonation=false}={}){
 const x=await page(t,{shared,locale});dispositionNativePort(t,x);
 Object.assign(x,{kind,locale,refusalLocale:locale});
 if(impersonation){enableImpersonation(x);x.refusalModal=true;await x.drain();}
 if(documentCards)await seedDocumentCards(x,{requirement:documentCards==="requirement"});
 x.initialFrames=currentFrames(x);
 if(kind==="undo"){
  const original=await originalPreview(x),applying=explicitApply(x,original);if(x.refusalModal)await confirmImpersonation(x);await applying;
  Object.assign(x,{appliedOriginal:original,originalReceipt:x.ledger()[0],
   originalEvent:structuredClone(x.h.store.events.get().find(event=>event.type==="CanvasArrangementCreated"&&event.payload.history_action_id===original.operationId))});
  await closePreparation(x);
 }else await openArrangement(x,{select:!x.selectionReady});
 Object.assign(x,{refusalSourceOwner:x.h.store.captureSourceOwnership(),refusalAuthority:x.h.store.captureAuthorizationScope(),
  initialRows:previewRows(x),initialReceipts:x.ledger(),preparedFrames:currentFrames(x)});
 return x;
}
export async function dispatchInitial(x,{mayClose=false}={}){
 if(x.kind==="undo")await boardUndo(x,{mayClose});
 else{const form=pendingForm(x);assert.ok(form);await x.f.act(form,"submit");}
}
export async function refusedPreparation(t,{kind="normal",shared=false,locale="en",timing="settled",boundary="none",fault,documentCards=false,allowLostResponse=false,impersonation=false}={}){
 const x=await readyPreparation(t,{kind,shared,locale,documentCards,impersonation}),transport=x.h.transport,action=kind==="undo"?"undo-preview":"preview";
 const completed=sceneDeferred();let changed=false,transportError=null;
 x.h.transport=async request=>{
  if(request.url==="/api/canvas/arrangements"&&request.body.action===action&&!changed){
   changed=true;
   try{
   await (x.editRefusal??editRefusalSource)(x,"Authenticated source edit before refused "+kind);
   if(timing==="before-response")await ordinaryInterruption(x,boundary);
   const response=await transport(request);
   assert.equal(response.status,409);assert.deepEqual(await response.clone().json(),{error:"canvas_arrangement_source_changed",providerCalls:0,maximumMicrousd:0});
   if(timing==="held-response")await ordinaryInterruption(x,boundary);
   return fault?await fault(response,request,x):response;
   }catch(error){transportError=error;throw error;}finally{completed.resolve();}
  }return transport(request);
 };
 try{const dispatch=dispatchInitial(x,{mayClose:timing!=="settled"&&boundary!=="none"});if(impersonation)await confirmImpersonation(x);await dispatch;await untilScene(()=>changed,"actual preparation transport began");await completed.promise;await x.drain();if(transportError&&!(allowLostResponse&&transportError.message==="controlled_refusal_transport_loss"))throw transportError;}
 finally{x.h.transport=transport;}
 const row=x.responses.at(-1);expectSourceRefusal(row);
 Object.assign(x,{initialRefusal:row,originalRequest:structuredClone(row.command)});
 assert.equal(x.operation(),row.command.operationId);assert.equal(continuationControl(x),undefined);
 assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(previewRows(x),x.initialRows);
 assert.deepEqual(currentFrames(x),x.preparedFrames);
 if(kind==="undo"){assert.equal(row.command.undoOperationId,x.appliedOriginal.operationId);assert.notEqual(row.command.operationId,x.appliedOriginal.operationId);}
 if(timing==="settled")await ordinaryInterruption(x,boundary);
 return x;
}
export async function qualifyContinuation(x,{available=true,refresh=true}={}){
 if(!arrangementDialog(x))await openArrangement(x,{select:false,name:null});
 assert.equal(continuationControl(x),undefined,"current Check never happens automatically");
 if(refresh){await x.h.store.refreshEvents();await x.drain();}
 const pending=check(x,x.locale);if(x.refusalModal)await confirmImpersonation(x);const row=await pending;
 assert.equal(row.status,409);assert.deepEqual(row.body,{error:"canvas_arrangement_operation_unavailable",providerCalls:0,maximumMicrousd:0});
 assert.equal(row.command.operationId,x.originalRequest.operationId);assert.equal(row.command.includeDisposition,true);
 assert.equal(Boolean(continuationControl(x)),available);
 if(x.kind==="undo")assert.equal(pendingForm(x),undefined,"inverse continuation never becomes a normal form");
 return row;
}
export async function submitContinuation(x){
 const node=continuationControl(x),before=x.responses.length;assert.ok(node,"current exact normal/inverse Review control");
 if(node.tag==="button")assert.equal(Object.hasOwn(node.attributes,"disabled"),false);
 await x.f.act(node,node.tag==="form"?"submit":"click");
 await untilScene(()=>x.responses.length>before,"actual current corrective preparation response");await x.drain();
 const row=x.responses.at(-1);assert.equal(row.command.action,x.kind==="undo"?"undo-preview":"preview");
 for(const key of["operationId","projectId","canvasId","recipeId","name","undoOperationId"])
  assert.equal(row.command[key],x.originalRequest[key],"same original "+key);
 assert.deepEqual(row.command.selectedItemIds,x.originalRequest.selectedItemIds);
 return row;
}
export async function applyContinuation(x,preview){
 const before=x.ledger().length,button=applyControl(x);assert.ok(button);assert.equal(Object.hasOwn(button.attributes,"disabled"),false);
 const count=x.responses.length;await x.f.act(button);await untilScene(()=>x.responses.length>count,"separate actual human Apply");await x.drain();
 const row=x.responses.at(-1);assert.equal(row.command.action,"apply");assert.equal(row.command.operationId,preview.operationId);
 assert.equal(row.command.previewId,preview.previewId);assert.equal(row.command.approvalHash,preview.approvalHash);
 assert.equal(row.status,200);assert.equal(row.body.status,"applied");assert.equal(x.ledger().length,before+1);
 if(x.kind==="undo"){
  assert.equal(row.command.undoOperationId,x.appliedOriginal.operationId);assert.deepEqual(currentFrames(x),x.initialFrames);
  assert.deepEqual(x.ledger().find(value=>value.preview_id===x.appliedOriginal.previewId),x.originalReceipt);
  assert.deepEqual(x.h.store.events.get().find(event=>event.eventId===x.originalEvent.eventId),x.originalEvent);
 }
 return row;
}
export async function directOriginal(x,{name="Earlier exact original",...overrides}={}){
 const context=await currentOutcomeArrangementContext(x.h.store,x.selected,"other-current-human",true);assert.ok(context);
 const choice={...x.originalRequest,name},draft=x.kind==="undo"?previewOutcomeArrangementUndo(context,choice):previewOutcomeArrangement(context,choice);
 assert.equal(draft.ok,true);
 const command={...draft.value.request,...overrides,action:x.kind==="undo"?"undo-preview":"preview"};
 const response=await x.worker.request("/api/canvas/arrangements",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,"review");
 return{command,preview:body.preview};
}
export function noContinuation(x){
 assert.equal(pendingForm(x),undefined);assert.equal(inverseControl(x),undefined);
 assert.equal(x.f.tree().visible("button").some(node=>node.attributes["data-arrangement-disposition"]===x.operation()),false);
}
export const lateContinuation=node=>node.handlers[node.tag==="form"?"submit":"click"].call(node.owner,{
 target:node.port,currentTarget:node.port,preventDefault(){},stopPropagation(){}});
export async function sourceRetirement(x){
 // Capture this read's actual authority, including a test-enabled modal posture;
 // the older page helper captured its auth before that optional fixture setup.
 const source=x.h.store.captureSourceOwnership(),auth=x.h.store.captureAuthorizationScope(),owner=x.canvas();
 x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.worker.sharing.contextId);
 assert.equal((await x.worker.request("/api/events?after=0&limit=2000&content=0")).status,403);
 await assert.rejects(x.h.store.refreshEvents(),/403/);await x.drain();
 assert.equal(x.h.store.sourceOwnershipActive(source),false);assert.equal(x.h.store.authorizationScopeActive(auth),true);
 assert.equal(x.canvas(),undefined);assert.equal(owner.isConnected,false);
 x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.worker.sharing.contextId);
 await x.h.store.refreshEvents();await x.drain();
 assert.equal(x.h.store.sourceOwnershipActive(source),false);assert.equal(x.h.store.authorizationScopeActive(auth),true);
 assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),true);
 assert.ok(x.canvas());assert.notEqual(x.canvas(),owner);
}
