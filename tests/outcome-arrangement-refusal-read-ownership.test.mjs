import assert from "node:assert/strict";
import test from "node:test";
import {refusedPreparation,qualifyContinuation,continuationControl,canonicalEvents,lateContinuation,check,submitContinuation}
 from "./helpers/arrangement-refusal-interruption-fixture.mjs";

for(const kind of["normal","undo"])
test("a current rendered Check grant remains useful for its explicit Review / "+kind,async t=>{
 const x=await refusedPreparation(t,{kind});await qualifyContinuation(x);
 const count=x.arrangementPosts().length,events=canonicalEvents(x);const reviewed=await submitContinuation(x);
 assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"review");
 assert.equal(x.arrangementPosts().length,count+1);assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
});
// Synthetic negative ownership control: invoke the retained actual handler.
// This is not an ordinary physical-user incident or an unauthorized-write claim.

for(const kind of["normal","undo"])
test("each current Check retires the prior rendered corrective grant / "+kind,async t=>{
 const x=await refusedPreparation(t,{kind});await qualifyContinuation(x);
 const old=continuationControl(x),read=await check(x,x.locale);assert.equal(read.status,409);
 assert.ok(continuationControl(x));const count=x.arrangementPosts().length,events=canonicalEvents(x);
 await lateContinuation(old);await x.drain();
 assert.equal(x.arrangementPosts().length,count,"an old rendered callback cannot borrow a later Check's permission");
 assert.deepEqual(canonicalEvents(x),events);assert.deepEqual(x.ledger(),x.initialReceipts);
 const reviewed=await submitContinuation(x);assert.equal(reviewed.status,200);
});
