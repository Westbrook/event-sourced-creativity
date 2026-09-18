import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,submitContinuation,arrangementDialog,continuationControl,
 canonicalEvents,currentFrames,previewRows,counts,openArrangement,ordinaryInterruption,check} from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const kind of["normal","undo"])for(const shared of[false,true])
for(const timing of["before-response","held-response"])for(const boundary of["closed","reopened","posture"])
test("current refused preparation survives only ordinary interruption / "+[kind,shared,timing,boundary].join("/"),async t=>{
 const locale=boundary==="posture"?(shared?"ar":"ja"):(shared?"fr":"en");
 const x=await refusedPreparation(t,{kind,shared,locale,timing,boundary});
 const original=x.originalRequest,events=canonicalEvents(x),frames=currentFrames(x),posts=counts(x);
 if(boundary==="closed")assert.equal(arrangementDialog(x),undefined,"late refusal never reopens the native dialog");
 if(!arrangementDialog(x))await openArrangement(x,{select:false,name:null});
 assert.equal(continuationControl(x),undefined,"no old opening callback grants Review");
 await qualifyContinuation(x);
 assert.equal(x.h.store.sourceOwnershipActive(x.refusalSourceOwner),true);
 assert.equal(x.h.store.authorizationScopeActive(x.refusalAuthority),true);
 assert.equal(x.operation(),original.operationId);assert.deepEqual(x.ledger(),x.initialReceipts);
 assert.deepEqual(previewRows(x),x.initialRows);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(currentFrames(x),frames);
 const reviewed=await submitContinuation(x);assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
 assert.equal(reviewed.body.preview.undoOperationId,original.undoOperationId);
 assert.notEqual(reviewed.command.expectedSourceRevision,original.expectedSourceRevision);
 assert.equal(counts(x).apply,posts.apply,"free explicit Review is never Apply");
 assert.deepEqual(x.ledger(),x.initialReceipts);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(currentFrames(x),frames);
 assert.ok(Math.max(...x.worker.controls.bindings)<=100);
});

for(const kind of["normal","undo"])for(const shared of[false,true])
test("historical refusal permits a new exact Check in the optional Desk posture / "+kind+"/"+shared,async t=>{
 const x=await refusedPreparation(t,{kind,shared,timing:"held-response",boundary:"desk",locale:shared?"ar":"en"});
 assert.equal(new URL(x.h.store.route.get(),"http://localhost").searchParams.get("posture"),"outcomes");
 assert.equal(continuationControl(x),undefined);await qualifyContinuation(x);
 const read=await check(x,x.locale);assert.equal(read.status,409);
 const reviewed=await submitContinuation(x);assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
 const count=x.arrangementPosts().length;await ordinaryInterruption(x,"reopened");
 assert.equal(x.arrangementPosts().length,count);assert.equal(continuationControl(x),undefined);
});
