import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,submitContinuation,applyContinuation,closePreparation,boardUndo,
 continuationControl,canonicalEvents,currentFrames,previewRows,counts} from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])for(const kind of["normal","undo"])
test("current same-original Review and separate Apply across ordinary recovery / "+[locale,shared,kind].join("/"),async t=>{
 const x=await refusedPreparation(t,{kind,shared,locale,boundary:kind==="undo"?"closed":"posture"});
 const events=canonicalEvents(x),frames=currentFrames(x),before=counts(x);
 if(kind==="undo"){
  await boardUndo(x);assert.deepEqual(counts(x),before,"ordinary board Undo only reopens its existing unresolved inverse");
  assert.equal(continuationControl(x),undefined);
 }
 await qualifyContinuation(x);assert.equal(x.h.store.sourceOwnershipActive(x.refusalSourceOwner),true);
 const reviewed=await submitContinuation(x),preview=reviewed.body.preview;
 assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
 assert.equal(preview.operationId,x.originalRequest.operationId);assert.equal(preview.undoOperationId,x.originalRequest.undoOperationId);
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(currentFrames(x),frames);
 assert.deepEqual(x.ledger(),x.initialReceipts);assert.equal(previewRows(x).length,x.initialRows.length+1);
 await applyContinuation(x,preview);assert.equal(counts(x).apply,before.apply+1);
 assert.equal(counts(x).preview,before.preview+(kind==="normal"?1:0));
 assert.equal(counts(x)["undo-preview"],before["undo-preview"]+(kind==="undo"?1:0));
 if(kind==="undo")assert.deepEqual(currentFrames(x),x.initialFrames);
 await closePreparation(x);assert.equal(x.arrangementPosts().filter(row=>row.body.action==="dismiss").length,0);
});
