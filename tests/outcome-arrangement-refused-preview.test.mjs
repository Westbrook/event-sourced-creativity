import assert from "node:assert/strict";
import test from "node:test";
import {refusedInitial,qualifyRefusal,submitRefusalForm,assertSameChoices,explicitApply,canonicalEvents,previewRows,
 editRefusalSource,expectSourceRefusal,pendingForm,check,lateForm,noCorrectiveAction} from "./helpers/arrangement-refused-preview-fixture.mjs";

for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])
test("refused free preview keeps current same choices through separate Review and Apply / "+locale+"/"+shared,async t=>{
 const x=await refusedInitial(t,{locale,shared}),events=canonicalEvents(x);await qualifyRefusal(x);
 assert.ok(x.f.tree().root.text.includes(x.copy.refusedPreparation));
 const input=x.f.tree().visible("input").find(node=>node.port?.value===x.originalRequest.name);
 assert.ok(input);assert.equal(Object.hasOwn(input.attributes,"readonly"),true);
 const form=pendingForm(x),tree=x.f.tree();
 const select=tree.visible("select").find(node=>{for(let p=node.parent;p;p=p.parent)if(String(p.attributes.class??"").includes("canvas-arrangement-form"))return true;return false;});
 assert.ok(select);assert.equal(Object.hasOwn(select.attributes,"disabled"),true);assert.ok(form);
 const prepared=await submitRefusalForm(x);assert.equal(prepared.status,200);assert.equal(prepared.body.status,"review");
 assertSameChoices(x,prepared.command);assert.notEqual(prepared.command.expectedSourceRevision,x.originalRequest.expectedSourceRevision);
 assert.equal(prepared.command.expectedLayoutRevision,x.originalRequest.expectedLayoutRevision);
 const preview=prepared.body.preview;assertSameChoices(x,preview);
 assert.equal(preview.providerCalls,0);assert.equal(preview.maximumMicrousd,0);assert.equal(preview.changesSemantics,false);
 assert.equal(x.operation(),x.originalRequest.operationId);assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,2);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);assert.equal(x.ledger().length,0);
 assert.deepEqual(canonicalEvents(x),events);assert.equal(previewRows(x).length,1);
 await explicitApply(x,preview);assert.equal(canonicalEvents(x).length-events.length,5);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,1);
});

for(const shared of[false,true])test("a second owned source refusal creates only its own explicit same-op correction / "+shared,async t=>{
 const x=await refusedInitial(t,{shared});await qualifyRefusal(x);const transport=x.h.transport;let changed=false;
 x.h.transport=async request=>{
  if(!changed&&request.url==="/api/canvas/arrangements"&&request.body.action==="preview"){
   changed=true;await editRefusalSource(x,"Actual source revision during the corrective free request");
  }return transport(request);
 };
 const second=await submitRefusalForm(x);x.h.transport=transport;expectSourceRefusal(second);assertSameChoices(x,second.command);
 assert.equal(pendingForm(x),undefined);assert.equal(previewRows(x).length,0);assert.equal(x.ledger().length,0);
 await qualifyRefusal(x);const third=await submitRefusalForm(x);assert.equal(third.status,200);assertSameChoices(x,third.command);
 assert.notEqual(third.command.expectedSourceRevision,second.command.expectedSourceRevision);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,3);
 assert.equal(x.arrangementPosts().filter(row=>row.body.action==="apply").length,0);
 await explicitApply(x,third.body.preview);assert.equal(x.operation(),x.originalRequest.operationId);
});

for(const shared of[false,true])for(const outcome of["refused","saved"])
test("a lost corrective "+outcome+" response cannot borrow the earlier refusal / "+shared,async t=>{
 const x=await refusedInitial(t,{shared});await qualifyRefusal(x);
 const oldForm=pendingForm(x),transport=x.h.transport;let lost=false;
 x.h.transport=async request=>{
  if(!lost&&request.url==="/api/canvas/arrangements"&&request.body.action==="preview"){
   if(outcome==="refused")await editRefusalSource(x,"Actual second refusal whose response is lost");
   const response=await transport(request);assert.equal(response.status,outcome==="refused"?409:200);
   lost=true;throw Error("controlled_loss_of_actual_corrective_"+outcome+"_response");
  }return transport(request);
 };
 const result=await submitRefusalForm(x);x.h.transport=transport;assert.equal(lost,true);assertSameChoices(x,result.command);
 noCorrectiveAction(x);const before=x.arrangementPosts().length;await lateForm(oldForm);await x.drain();
 assert.equal(x.arrangementPosts().length,before,"the consumed old form cannot redispatch");
 if(outcome==="refused"){
  await qualifyRefusal(x,{available:false});await qualifyRefusal(x,{available:false,refresh:false});
  assert.equal(previewRows(x).length,0);assert.equal(x.ledger().length,0);noCorrectiveAction(x);
 }else{
  const read=await check(x,"en");assert.equal(read.status,200);assert.equal(read.body.status,"review");
  assert.equal(read.body.preview.previewId,result.body.preview.previewId);assert.equal(pendingForm(x),undefined);
  assert.equal(x.arrangementPosts().filter(row=>row.body.action==="preview").length,2);
  await explicitApply(x,read.body.preview);
 }
 assert.equal(x.operation(),x.originalRequest.operationId);
});
