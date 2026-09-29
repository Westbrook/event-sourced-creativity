import assert from "node:assert/strict";
import {readyPreparation,refusedPreparation,qualifyContinuation,dispatchInitial,continuationControl,
 counts,noContinuation,arrangementDialog,untilScene,confirmImpersonation,submitContinuation,applyContinuation,
 canonicalEvents,currentFrames,previewRows,outcomeDeskCopy,check} from "./arrangement-refusal-interruption-fixture.mjs";
import {financial} from "./event-source-retirement-fixture.mjs";
export * from "./arrangement-refusal-interruption-fixture.mjs";

// Reuse complete Shell/Canvas/Store/routed RAM Worker. This pass-through observes
// the real transport signals; no response, operation, receipt or positive source
// ownership is fabricated. The fixture's confirmation posture is not a claim of
// actual backend impersonation, browser click-through, keyboard or AT behavior.
export function observePreparation(t,x,{forwardNotice=true,throwAfterNotice=false}={}){
 const actual=x.h.store.canvasArrangementRequest.bind(x.h.store),calls=[];
 t.mock.method(x.h.store,"canvasArrangementRequest",async(command,controls)=>{
  if(command.action!=="preview"&&command.action!=="undo-preview")return actual(command,controls);
  const row={command:structuredClone(command),controls,notices:0,dispatches:0,settled:false,result:null,error:null};calls.push(row);
  try{
   const result=await actual(command,{...controls,onDispatch:()=>{
    row.dispatches++;assert.equal(x.arrangementPosts().at(-1)?.body.action,command.action);
    controls?.onDispatch?.();
   },onNotDispatchedAtConfirmation:()=>{
    row.notices++;row.noticeCurrent=Boolean(controls?.current?.());
    assert.equal(row.dispatches,0);assert.equal(row.noticeCurrent,true);
    if(forwardNotice)controls?.onNotDispatchedAtConfirmation?.();
    if(throwAfterNotice)throw Error("synthetic_presentation_callback_failure_after_actual_local_notice");
   }});
   row.result=result;return result;
  }catch(error){row.error=error;throw error;}finally{row.settled=true;}
 });
 x.preparationCalls=calls;return calls;
}
export async function confirmationFixture(t,{stage="initial",forwardNotice=true,throwAfterNotice=false,...options}={}){
 const x=stage==="initial"?await readyPreparation(t,{...options,impersonation:true}):await refusedPreparation(t,{...options,impersonation:true});
 if(stage==="corrective")await qualifyContinuation(x);
 x.preparationStage=stage;observePreparation(t,x,{forwardNotice,throwAfterNotice});
 return x;
}
export async function requestPreparation(x){
 const before=x.preparationCalls.length;
 if(x.preparationStage==="initial")await dispatchInitial(x);
 else{const control=continuationControl(x);assert.ok(control);await x.f.act(control,control.tag==="form"?"submit":"click");}
 await untilScene(()=>x.preparationCalls.length===before+1,"exact actual preparation method started");
 const call=x.preparationCalls.at(-1);
 x.originalRequest??=structuredClone(call.command);
 assert.equal(call.command.operationId,x.originalRequest.operationId);
 assert.equal(call.command.undoOperationId,x.originalRequest.undoOperationId);
 return call;
}
export async function cancelConfirmation(x){
 await untilScene(()=>x.h.store.ui.impersonationConfirmOpen,"actual current Store confirmation");
 await x.drain();const tree=x.f.tree();
 const modal=tree.visible("dialog").find(node=>String(node.attributes.class??"").includes("impersonation-confirm-dialog"));assert.ok(modal);
 const contains=node=>{for(let parent=node.parent;parent;parent=parent.parent)if(parent===modal)return true;return false;};
 const cancel=tree.visible("button").find(node=>contains(node)&&String(node.attributes.class??"").split(/\s+/u).includes("ghost"));
 assert.ok(cancel);await x.f.act(cancel);await x.drain();assert.equal(x.h.store.ui.impersonationConfirmOpen,false);
}
export async function settledPreparation(x,call){
 await untilScene(()=>call.settled,"actual Store preparation settled");await x.drain();return call;
}
export async function cancelledPreparation(t,options={}){
 const x=await confirmationFixture(t,options),call=await requestPreparation(x);
 await cancelConfirmation(x);await settledPreparation(x,call);
 assert.equal(call.error,null);assert.equal(call.result.status,409);assert.equal(call.result.ok,false);
 assert.deepEqual(call.result.body,{error:"Action canceled. No changes were made to the fictional account."});
 assert.equal(call.notices,1);assert.equal(call.dispatches,0);assert.equal(call.noticeCurrent,true);
 return x;
}
export const snapshot=x=>({counts:counts(x),events:canonicalEvents(x),frames:currentFrames(x),rows:previewRows(x),receipts:x.ledger(),financial:financial(x.worker)});
export function unchanged(x,before,{reads=0}={}){
 assert.deepEqual(counts(x),{...before.counts,retrieve:before.counts.retrieve+reads});
 for(const[key,value]of Object.entries(snapshot(x)))if(key!=="counts")assert.deepEqual(value,before[key],key+" unchanged");
}
export function noCurrentLocalGrant(x,{falseChanged=false}={}){
 noContinuation(x);const text=arrangementDialog(x)?.text??"";
 assert.equal(text.includes(x.copy.preparationNotDispatched),false,"historical notice alone shows no fresh continuation hint");
 if(falseChanged)assert.equal(text.includes(outcomeDeskCopy(x.locale).issues.changed),false,"local non-dispatch does not claim the board/source/access changed");
}
export async function currentCheck(x){
 const pending=check(x,x.locale);if(x.h.store.session.get()?.impersonation)await confirmImpersonation(x);return pending;
}
export async function reviewAndApply(x){
 const reviewing=submitContinuation(x);await confirmImpersonation(x);const review=await reviewing;
 assert.equal(review.status,200);assert.equal(review.body.status,"review");
 assert.equal(review.body.preview.operationId,x.originalRequest.operationId);
 const applying=applyContinuation(x,review.body.preview);await confirmImpersonation(x);const applied=await applying;
 return{review,applied};
}
