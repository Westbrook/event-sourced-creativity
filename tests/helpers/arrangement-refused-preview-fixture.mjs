import assert from "node:assert/strict";
import {page,openArrangement,pendingForm,check,applyControl,currentFrames,untilScene,
  control,outcomeDeskCopy,dispositionNativePort,enableImpersonation,confirmImpersonation} from "./arrangement-expired-review-fixture.mjs";
import {currentOutcomeArrangementContext} from "../../src/state/outcome-desk-controller.ts";
import {previewOutcomeArrangement} from "../../src/canvas/outcome-arrangements.ts";
import {sweepExpiredPrivateContent} from "../../worker/runtime.ts";
export * from "./arrangement-expired-review-fixture.mjs";

// Complete existing Shell/Canvas/Store/Worker fixture. Source edits below are
// authenticated RAM Worker requests, not fabricated source_changed responses.
export const previewRows=x=>x.worker.sqlite.prepare("SELECT * FROM private_content WHERE kind='authoring-preview' ORDER BY content_id").all();
export const canonicalEvents=x=>x.worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
export async function editRefusalSource(x,text){
 const old=x.refusalSourceText??"Current arrangement source 0";
 const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({action:"append",event:{type:"BlockPropertyEdited",payload:{
   project_id:x.worker.projectId,block_id:"source-arrangement-block-0",property_path:"text",old_value:old,new_value:text,
  }}})});
 assert.equal(response.status,200,await response.clone().text());x.refusalSourceText=text;
 return response.json();
}
export function expectSourceRefusal(row){
 assert.equal(row.status,409);assert.deepEqual(row.body,{error:"canvas_arrangement_source_changed",providerCalls:0,maximumMicrousd:0});
}
export async function submitRefusalForm(x){
 const form=pendingForm(x);assert.ok(form,"actual current free Review form");
 const before=x.responses.length,posts=x.arrangementPosts().length;
 await x.f.act(form,"submit");
 await untilScene(()=>x.arrangementPosts().length>posts,"actual explicit normal preview dispatch");
 await untilScene(()=>x.responses.length>before,"actual Worker normal preview result");
 await x.drain();const response=x.responses.at(-1);assert.equal(response.command.action,"preview");
 return response;
}
export async function refusedInitial(t,{shared=false,locale="en",fault,impersonation=false}={}){
 const x=await page(t,{shared,locale});dispositionNativePort(t,x);
 Object.assign(x,{refusalLocale:locale,refusalModal:impersonation});
 if(impersonation){enableImpersonation(x);await x.drain();}
 Object.assign(x,{refusalSourceOwner:x.h.store.captureSourceOwnership(),refusalAuthority:x.h.store.captureAuthorizationScope()});
 await openArrangement(x);
 const beforeFrames=currentFrames(x),transport=x.h.transport;let changed=false,released=false;
 x.h.transport=async request=>{
  if(request.url==="/api/canvas/arrangements"&&request.body.action==="preview"&&!changed){
   changed=true;await editRefusalSource(x,"Actual source revision before the initial free request");
   const response=await transport(request);
   try{return fault?await fault(response,request,x):response;}finally{released=true;}
  }return transport(request);
 };
 let initial;try{const pending=submitRefusalForm(x);if(impersonation)await confirmImpersonation(x);initial=await pending;await untilScene(()=>released,"held initial transport completed");await x.drain();}finally{x.h.transport=transport;}
 expectSourceRefusal(initial);assert.equal(changed,true);assert.equal(previewRows(x).length,0);
 assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),beforeFrames);
 assert.equal(pendingForm(x),undefined,"a refusal alone is not a current Review qualification");
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 Object.assign(x,{initialRefusal:initial,originalRequest:structuredClone(initial.command),refusalFrames:beforeFrames});
 return x;
}
export async function qualifyRefusal(x,{available=true,refresh=true}={}){
 if(refresh){await x.h.store.refreshEvents();await x.drain();}
 assert.equal(x.h.store.sourceOwnershipActive(x.refusalSourceOwner),true);
 assert.equal(x.h.store.authorizationScopeActive(x.refusalAuthority),true);
 const pending=check(x,x.refusalLocale);if(x.refusalModal)await confirmImpersonation(x);const read=await pending;
 assert.equal(read.status,409);assert.deepEqual(read.body,{error:"canvas_arrangement_operation_unavailable",providerCalls:0,maximumMicrousd:0});
 assert.equal(read.command.operationId,x.originalRequest.operationId);assert.equal(read.command.includeDisposition,true);
 assert.equal(Boolean(pendingForm(x)),available,"missing-operation read qualifies only existing refusal provenance");
 assert.equal(x.operation(),x.originalRequest.operationId);
 return read;
}
export function assertSameChoices(x,command){
 for(const key of["operationId","projectId","canvasId","name","recipeId"])
  assert.equal(command[key],x.originalRequest[key],"same original "+key);
 assert.deepEqual(command.selectedItemIds,x.originalRequest.selectedItemIds);
}
export async function explicitApply(x,preview){
 const before=x.arrangementPosts().length,button=applyControl(x);assert.ok(button,"human Apply exists after a validated review");
 assert.equal(Object.hasOwn(button.attributes,"disabled"),false,"current original review is explicitly applicable");
 await x.f.act(button);
 await untilScene(()=>x.arrangementPosts().length>before,"separate current human Apply");
 await untilScene(()=>x.responses.at(-1)?.command.action==="apply","actual Apply result");
 await x.drain();const row=x.responses.at(-1);
 assert.equal(row.status,200);assert.equal(row.body.status,"applied");
 assert.equal(row.command.operationId,preview.operationId);assert.equal(row.command.previewId,preview.previewId);
 assert.equal(row.command.approvalHash,preview.approvalHash);assert.equal(x.ledger().length,1);
 return row;
}
export const lateForm=form=>form.handlers.submit.call(form.owner,{target:form.port,currentTarget:form.port,preventDefault(){},stopPropagation(){}});
export async function directPreview(x,{name="Earlier canonical human choice",...overrides}={}){
 const context=await currentOutcomeArrangementContext(x.h.store,x.selected,"actual-other-request",true);assert.ok(context);
 const draft=previewOutcomeArrangement(context,{operationId:x.originalRequest.operationId,recipeId:x.originalRequest.recipeId,name});
 assert.equal(draft.ok,true);
 const command={...draft.value.request,...overrides,action:"preview"};
 const response=await x.worker.request("/api/canvas/arrangements",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,"review");
 return{command,preview:body.preview};
}
export async function directApply(x,preview){
 const request=Object.fromEntries(["operationId","projectId","canvasId","recipeId","name","selectedItemIds",
  "expectedLayoutRevision","expectedSourceRevision","undoOperationId"].filter(key=>preview[key]!==undefined).map(key=>[key,preview[key]]));
 const command={...request,action:"apply",previewId:preview.previewId,approvalHash:preview.approvalHash,confirmed:true};
 const response=await x.worker.request("/api/canvas/arrangements",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
 return{status:response.status,body:await response.json(),command};
}
export async function eraseRefusalWinner(x,preview){
 // Controlled eligibility followed by the actual retention sweep. This is not
 // a client permission, a fabricated response, or a claimed production race.
 x.worker.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(preview.previewId);
 assert.ok(await sweepExpiredPrivateContent(x.worker.env)>=1);
 const row=previewRows(x).find(value=>value.content_id===preview.previewId);assert.ok(row);
 assert.equal(row.content,"");assert.ok(row.redacted_at);return row;
}
export async function reopenRefusal(x){
 await x.f.act(control(x,x.copy.close));await x.drain();
 await openArrangement(x,{select:false,name:null});await x.drain();
 assert.equal(pendingForm(x),undefined,"normal reopening needs a new current Check");
 return check(x,x.refusalLocale);
}
export function noCorrectiveAction(x){
 assert.equal(pendingForm(x),undefined,"unknown original is Check-only");
 assert.equal(x.f.tree().visible("button").some(node=>node.attributes["data-arrangement-disposition"]===x.operation()),false);
 assert.ok(control(x,outcomeDeskCopy(x.refusalLocale).retrieve),"original Check remains");
}
