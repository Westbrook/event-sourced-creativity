import assert from "node:assert/strict";
import test from "node:test";
import {confirmationFixture,requestPreparation,cancelConfirmation,settledPreparation,cancelledPreparation,
 snapshot,unchanged,noCurrentLocalGrant,qualifyContinuation,reviewAndApply,counts,canonicalEvents,currentFrames,
 previewRows,closePreparation,openArrangement,switchPosture,confirmImpersonation,arrangementDialog,
 continuationControl,currentCheck,submitContinuation,applyContinuation}
 from "./helpers/arrangement-preparation-confirmation-fixture.mjs";
import {financial} from "./helpers/event-source-retirement-fixture.mjs";

for(const kind of["normal","undo"])for(const shared of[false,true])for(const stage of["initial","corrective"])
test("current local preparation notice needs Check then same-original Review then separate Apply / "+[kind,shared,stage].join("/"),async t=>{
 const locale=["en","fr","ar","ja"][Number(shared)*2+Number(stage==="corrective")];
 const x=await confirmationFixture(t,{kind,shared,stage,locale}),before=snapshot(x),owner=x.canvas();
 const call=await requestPreparation(x),source=x.h.store.captureSourceOwnership(),authority=x.h.store.captureAuthorizationScope();
 assert.equal(call.dispatches,0);assert.equal(call.notices,0);unchanged(x,before);
 await cancelConfirmation(x);await settledPreparation(x,call);
 assert.equal(call.result.status,409);assert.equal(call.notices,1);assert.equal(call.dispatches,0);assert.equal(call.noticeCurrent,true);
 unchanged(x,before);noCurrentLocalGrant(x,{falseChanged:true});
 await closePreparation(x);if(shared)await switchPosture(x);await openArrangement(x,{select:false,name:null});
 noCurrentLocalGrant(x);assert.equal(x.canvas()===owner,true);unchanged(x,before);
 const checked=await qualifyContinuation(x);assert.equal(checked.command.operationId,call.command.operationId);
 assert.equal(x.h.store.sourceOwnershipActive(source),true);assert.equal(x.h.store.authorizationScopeActive(authority),true);
 assert.ok(arrangementDialog(x).text.includes(x.copy.preparationNotDispatched));assert.ok(continuationControl(x));
 unchanged(x,before,{reads:1});
 const reviewing=submitContinuation(x);await confirmImpersonation(x);const reviewed=await reviewing;
 assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");const original=reviewed.body.preview;
 assert.equal(original.operationId,call.command.operationId);assert.equal(original.undoOperationId,call.command.undoOperationId);
 assert.equal(previewRows(x).length,before.rows.length+1);assert.deepEqual(canonicalEvents(x),before.events);
 assert.deepEqual(currentFrames(x),before.frames);assert.deepEqual(x.ledger(),before.receipts);assert.deepEqual(financial(x.worker),before.financial);
 assert.equal(counts(x).apply,before.counts.apply);assert.equal(counts(x).dismiss,before.counts.dismiss);
 assert.equal(arrangementDialog(x).text.includes(x.copy.preparationNotDispatched),false);
 const applying=applyContinuation(x,original);await confirmImpersonation(x);await applying;
 assert.equal(x.operation(),call.command.operationId);assert.equal(x.ledger().length,before.receipts.length+1);
 assert.equal(counts(x).apply,before.counts.apply+1);assert.deepEqual(financial(x.worker),before.financial);
});

for(const kind of["normal","undo"])test("already-pending confirmation gives only this attempt's positive non-dispatch / "+kind,async t=>{
 const x=await confirmationFixture(t,{kind,shared:false}),before=snapshot(x);
 const pending=x.h.store.confirmImpersonatedInteraction("the already pending fixture confirmation");
 await x.drain();assert.equal(x.h.store.ui.impersonationConfirmOpen,true);
 // Explicit native scheduling control: invoke the actual preparation handler
 // while another real Store confirmation is pending, not physical click-through.
 const call=await requestPreparation(x);await settledPreparation(x,call);
 assert.equal(call.result.status,409);assert.equal(call.notices,1);assert.equal(call.dispatches,0);
 assert.equal(x.h.store.ui.impersonationConfirmOpen,true,"this attempt did not resolve the other confirmation");
 unchanged(x,before);noCurrentLocalGrant(x,{falseChanged:true});
 await confirmImpersonation(x);assert.equal(await pending,true,"no human Cancel is inferred");
 await qualifyContinuation(x);assert.ok(arrangementDialog(x).text.includes(x.copy.preparationNotDispatched));
 await reviewAndApply(x);assert.equal(x.ledger().length,before.receipts.length+1);
});

test("a presentation callback failure cannot dispatch the unapproved attempt",async t=>{
 const x=await cancelledPreparation(t,{throwAfterNotice:true}),before=snapshot(x);
 assert.equal(x.preparationCalls[0].error,null);noCurrentLocalGrant(x,{falseChanged:true});
 await qualifyContinuation(x);unchanged(x,before,{reads:1});
 assert.ok(arrangementDialog(x).text.includes(x.copy.preparationNotDispatched));
});

for(const kind of["normal","undo"])test("a second current Check retires the prior rendered local continuation / "+kind,async t=>{
 const x=await cancelledPreparation(t,{kind});await qualifyContinuation(x);
 const old=continuationControl(x),before=counts(x);await currentCheck(x);
 const current=continuationControl(x);assert.ok(current);
 // Retained handler invocation is a synthetic negative ownership control.
 await old.handlers[old.tag==="form"?"submit":"click"].call(old.owner,{target:old.port,currentTarget:old.port,preventDefault(){},stopPropagation(){}});
 await x.drain();assert.deepEqual(counts(x),{...before,retrieve:before.retrieve+1});
 assert.equal(x.h.store.ui.impersonationConfirmOpen,false);assert.ok(continuationControl(x));
 await reviewAndApply(x);
});

for(const kind of["normal","undo"])test("a newly confirmed local non-dispatch is specific to the second attempt / "+kind,async t=>{
 const x=await cancelledPreparation(t,{kind});await qualifyContinuation(x);const before=snapshot(x),old=x.preparationCalls[0];
 x.preparationStage="corrective";const next=await requestPreparation(x);
 assert.notEqual(next.controls,old.controls);assert.equal(next.command.operationId,old.command.operationId);
 assert.equal(next.command.undoOperationId,old.command.undoOperationId);
 await cancelConfirmation(x);await settledPreparation(x,next);
 assert.equal(next.notices,1);assert.equal(next.dispatches,0);unchanged(x,before);noCurrentLocalGrant(x,{falseChanged:true});
 await qualifyContinuation(x);await reviewAndApply(x);assert.equal(x.operation(),old.command.operationId);
});
