// Actual complete Document host/Store/routed Worker with existing deterministic
// native element ports. This proves emitted options/value and real handlers,
// not browser select painting, CSS geometry, physical input or AT behavior.
import assert from "node:assert/strict";
import test from "node:test";
import {page,openSuggestion,currentHost,snapshot,copy,control,settle,inProposal,explicitApply,previews,applies} from "./helpers/adaptive-recovery-native-fixture.mjs";
import {canonical,verifyOriginalCommit} from "./helpers/adaptive-proposal-receipt-truth-fixture.mjs";
import {financial} from "./helpers/event-source-retirement-fixture.mjs";

async function authoredEvent(x,type,payload){
  const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"append",event:{type,payload:{project_id:x.state.scope.projectId,document_id:x.state.scope.documentId,...payload}}})});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  const event=body.appended?.find(row=>row.type===type&&row.payload.block_id===payload.block_id);assert.ok(event);return event.eventId;
}
function targetControl(x){
  return x.f.find("select",node=>inProposal(node)&&node.parent?.tag==="label"&&node.parent.text.startsWith(copy(x,"adaptive.changes.target")));
}
const options=node=>node.children.filter(child=>typeof child==="object"&&child.tag==="option");
// Observe properties emitted by the unchanged finite renderer; do not emulate
// browser selectedness or infer native selectedOptions from the select's value.
function assertEmittedTargetSelection(x,id){
  const node=targetControl(x),entries=options(node);
  assert.equal(entries.every(option=>typeof option.properties.selected==="boolean"),true,"every emitted target option owns an explicit selected property");
  assert.deepEqual(entries.filter(option=>option.properties.selected).map(option=>option.attributes.value),[id],"exactly the retained or deliberately chosen target is emitted selected");
  assert.equal(node.port.value,id,"the emitted option selection agrees with the unchanged select value");
}
const currentText=x=>x.f.find("textarea",node=>inProposal(node));
async function chooseTarget(x,id){const node=targetControl(x);node.port.value=id;await x.f.act(node,"change");}

for(const locale of["en","fr","ar","ja"])for(const kind of["removed","locked"])
test("actual native target correction "+locale+"/"+kind+": retained unavailable identity stays explicit until the human chooses",async t=>{
  const x=await page(t,false,locale),source=x.h.store.adaptiveProposalSource(x.state.scope.documentId,null,x.state.paidQuote.executionId);
  assert.equal(source?.readable,true);assert.equal(source.structure.suggested_blocks[0].type,"subject");
  const target="native-unavailable-"+locale+"-"+kind,other="native-editable-"+locale+"-"+kind;
  for(const [id,label]of[[target,"Authored target label must not become the unavailable option"],[other,"Other editable subject"]]){
    await authoredEvent(x,"BlockCreated",{scope:"document",block_id:id,type:"subject",handle:"subject/"+id,position:"zz-"+id,
      properties:{label,text:"Existing independently authored subject.",subtype:"Hero subject",weight:.75,authority:"authored"}});
  }
  await x.h.store.refreshEvents();await x.h.store.loadAdaptiveProposalOriginal(x.state.paidQuote.executionId);await x.f.settle();
  await openSuggestion(x);const owner=currentHost(x),original=snapshot(owner),beforeSelections=previews(x).length;
  assert.equal(original.canEdit,true);assert.equal(original.canPreview,true);
  let selected=targetControl(x);assert.equal(selected.port.value,"");
  assertEmittedTargetSelection(x,"");
  assert.ok(options(selected).some(option=>option.attributes.value===target&&!Object.hasOwn(option.attributes,"disabled")));
  assert.ok(options(selected).some(option=>option.attributes.value===other&&!Object.hasOwn(option.attributes,"disabled")));
  await chooseTarget(x,target);const humanText="  "+locale+" — retained human correction\nExact ending.  ";
  const textarea=currentText(x);textarea.port.value=humanText;await x.f.act(textarea,"input");
  assert.equal(targetControl(x).port.value,target);assert.equal(currentText(x).port.value,humanText);
  assertEmittedTargetSelection(x,target);
  assert.equal(previews(x).length,beforeSelections);assert.equal(applies(x).length,0);
  await authoredEvent(x,kind==="removed"?"BlockRemoved":"BlockLocked",{block_id:target,source_surface:"manual"});
  await x.h.store.refreshEvents();await x.h.store.loadAdaptiveProposalOriginal(x.state.paidQuote.executionId);await x.f.settle();
  assert.equal(currentHost(x)===owner,true);assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),true);
  const afterWithdrawal=canonical(x.state),money=financial(x.worker);
  selected=targetControl(x);const retained=options(selected).filter(option=>option.attributes.value===target);
  assert.equal(selected.port.value,target,"retained selection is not silently rendered or stored as Create");
  assertEmittedTargetSelection(x,target);
  assert.equal(retained.length,1);assert.equal(Object.hasOwn(retained[0].attributes,"disabled"),true);
  assert.equal(retained[0].text,copy(x,"adaptive.changes.unavailableTarget")+" · "+target);
  assert.equal(retained[0].text.includes("Authored target label"),false,"only retained ID and current generic guidance, not unavailable private title");
  assert.equal(Object.hasOwn(selected.attributes,"disabled"),false);assert.equal(currentText(x).port.value,humanText);
  await x.f.act(control(x,"adaptive.changes.preview"));await settle(x);
  const refused=x.responses.at(-1),after=snapshot(currentHost(x));
  assert.equal(refused.request.action,"preview");assert.equal(refused.status,409);
  assert.equal(refused.body.error,kind==="removed"?"adaptive_changes_target_unavailable":"adaptive_changes_target_protected");
  assert.equal(refused.body.status,"preview-not-created");
  assert.deepEqual(Object.keys(refused.body).sort(),["error","noAutomaticRetry","noPayment","selectionKey","status"]);
  assert.equal(refused.request.selections[0].targetBlockId,target);assert.equal(refused.request.selections[0].edit.text,humanText);
  assert.equal(after.phase,"draft");assert.equal(after.canEdit,true);assert.equal(after.canPreview,true);assert.equal(after.canApply,false);
  assert.equal(after.handle,null);assert.equal(after.preview,null);assert.equal(after.notice,"adaptive.changes.targetRefused");
  assert.equal(after.executionId,original.executionId);assert.equal(after.bindingHash,original.bindingHash);
  assert.ok(x.f.tree().nodes.some(node=>inProposal(node)&&!node.hiddenBy&&node.attributes.role==="status"&&node.text===copy(x,"adaptive.changes.targetRefused")));
  assert.equal(targetControl(x).port.value,target);assert.equal(currentText(x).port.value,humanText);
  assertEmittedTargetSelection(x,target);
  assert.equal(previews(x).length,beforeSelections+1);assert.equal(applies(x).length,0);assert.deepEqual(canonical(x.state),afterWithdrawal);
  const correction=kind==="removed"?"":other;await chooseTarget(x,correction);
  assert.equal(targetControl(x).port.value,correction);assert.equal(currentText(x).port.value,humanText);
  assertEmittedTargetSelection(x,correction);
  assert.equal(options(targetControl(x)).some(option=>option.attributes.value===target),false);
  assert.equal(previews(x).length,beforeSelections+1,"changing the target does not prepare automatically");
  await x.f.act(control(x,"adaptive.changes.preview"));await settle(x);const review=snapshot(currentHost(x)),preview=structuredClone(review.preview);
  assert.equal(review.phase,"review",review.notice);assert.equal(review.canApply,true);assert.equal(applies(x).length,0);
  assert.equal(preview.adaptiveReview.executionId,original.executionId);assert.equal(preview.adaptiveReview.bindingHash,original.bindingHash);
  assert.equal(preview.adaptiveReview.selections[0].targetBlockId,correction||undefined);assert.equal(preview.adaptiveReview.selections[0].edit.text,humanText);
  assert.deepEqual(canonical(x.state),afterWithdrawal);assert.deepEqual(financial(x.worker),money);
  const receipt=await explicitApply(x),committed=verifyOriginalCommit(x.state,preview);
  assert.equal(receipt.previewId,committed.previewId);assert.equal(receipt.approvalHash,committed.approvalHash);assert.equal(applies(x).length,1);
  const old=x.h.store.projection.get().libraryBlocks.find(block=>block.id===target);
  if(kind==="removed"){
    assert.equal(old,undefined,"the active projection omits the still-removed target");
    const lifecycle=rows=>rows.filter(row=>["BlockRemoved","BlockRestored"].includes(row.type)&&JSON.parse(row.payload).block_id===target);
    const originalRemoval=lifecycle(afterWithdrawal.events);assert.equal(originalRemoval.at(-1)?.type,"BlockRemoved");
    assert.deepEqual(lifecycle(canonical(x.state).events),originalRemoval,"the original canonical removal remains exact after the separate native Apply");
  }else assert.equal(old?.locked,true);
  assert.deepEqual(financial(x.worker),money);
  console.log("P8_TARGET_NATIVE_CONTROL "+JSON.stringify({locale,kind,surface:"Document",scope:"actual shared RAM Worker",
    retainedTarget:target,deliberateTarget:correction||"Create",executionId:original.executionId,previewId:committed.previewId,
    previewRequests:2,explicitApplyRequests:1,receiptCount:1,newProviderResponses:x.state.calls.length-1,
    qualification:"actual full host and production template/handlers with finite native ports; no browser/CSS/AT claim"}));
});
