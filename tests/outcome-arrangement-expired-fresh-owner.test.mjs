import assert from "node:assert/strict";
import test from "node:test";
import {expiredArrangement,freshArrangementOwner,openReceipt,openArrangement,control,check,applyControl,retained,currentFrames,
  pendingForm,dispositionControl,assertDescriptor,watchSubscriptions,outcomeDeskCopy} from "./helpers/arrangement-expired-review-fixture.mjs";

// Settings/return proves a new actual Shell/Canvas owner, not a physical reload.
for(const locale of["en","fr","ar","ja"])for(const shared of[false,true])
test("fresh actual owner adjudicates original expired intent before a separate new review / "+locale+"/"+shared,async t=>{
  const{x,preview,frames,claim,row}=await expiredArrangement(t,{locale,shared}),identity=x.operation();
  await freshArrangementOwner(x);const subscribers=watchSubscriptions(t,x.h.store);
  const before=x.arrangementPosts().length,changes=Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n);
  await openReceipt(x);await x.drain();const read=x.responses.at(-1);assertDescriptor(x,preview,read);
  assert.equal(x.arrangementPosts().length,before+1);assert.equal(Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n),changes);
  assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);assert.equal(x.operation(),identity);
  assert.equal(x.f.tree().root.text.includes(preview.name),false,"no old private preview or typed name revives in the new owner");
  const action=dispositionControl(x);assert.ok(action);assert.equal(action.text,x.copy.requestDisposition);assert.equal(pendingForm(x),undefined);
  assert.equal(x.f.tree().root.text.includes(x.copy.dispositionHint),true);assert.equal(x.f.tree().root.text.includes(outcomeDeskCopy(locale).issues.expired),false,"fresh opaque recovery never claims a private preview was unapplied");
  assert.equal(subscribers.active(),1);await x.f.act(action);await x.drain();
  const settled=x.responses.at(-1);assert.equal(settled.command.action,"dismiss");assert.equal(settled.command.onlyIfUnapplied,true);
  assert.equal(settled.command.previewId,preview.previewId);assert.equal(settled.command.approvalHash,preview.approvalHash);
  assert.equal(settled.status,200);assert.equal(settled.body.status,"dismissed");assert.equal(settled.body.approvalHash,preview.approvalHash);
  assert.equal(x.operation(),identity);assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),frames);assert.equal(subscribers.active(),0);
  assert.deepEqual(JSON.parse(retained(x,preview).content).plan,claim.plan);assert.ok(pendingForm(x));
  assert.equal(x.arrangementPosts().length,before+2,"no automatic replacement review or Apply");
  await x.f.act(control(x,x.copy.close));await x.drain();await openArrangement(x,{name:"Separate current review"});
  const form=pendingForm(x);assert.ok(form);await x.f.act(form,"submit");await x.drain();
  const next=x.responses.at(-1);assert.equal(next.command.action,"preview");assert.equal(next.body.status,"review");
  assert.notEqual(next.body.preview.operationId,identity);assert.notEqual(next.body.preview.previewId,preview.previewId);assert.equal(x.ledger().length,0);
  await x.f.act(applyControl(x));await x.drain();assert.equal(x.responses.at(-1).body.status,"applied");assert.equal(x.ledger().length,1);
});

for(const locale of["en","ar"])test("fresh owner lost actual disposition ACK retains only original tuple until Check / "+locale,async t=>{
  const{x,preview,frames}=await expiredArrangement(t,{locale});await freshArrangementOwner(x);
  await openReceipt(x);await x.drain();assertDescriptor(x,preview,x.responses.at(-1));
  const transport=x.h.transport;let lost=false;
  x.h.transport=async request=>{const response=await transport(request);if(!lost&&request.url==="/api/canvas/arrangements"&&request.body.action==="dismiss"){
    assert.equal(response.status,200);assert.equal((await response.clone().json()).status,"dismissed");lost=true;throw new Error("test_lost_fresh_owner_disposition_ack");
  }return response;};
  await x.f.act(dispositionControl(x));await x.drain();assert.equal(lost,true);assert.equal(dispositionControl(x),undefined);assert.equal(pendingForm(x),undefined);
  assert.equal(x.operation(),preview.operationId);assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),frames);
  const read=await check(x,locale);assert.equal(read.command.includeDisposition,true);assert.equal(read.status,200);assert.equal(read.body.status,"dismissed");
  assert.equal(read.body.previewId,preview.previewId);assert.equal(read.body.approvalHash,preview.approvalHash);assert.ok(pendingForm(x));
});

for(const fault of["missing","version","actor","operation","board","project","hash","preview","extra","not-applied"])
for(const locale of fault==="missing"?["en","fr","ar","ja"]:["en"])
test("fresh descriptor rejects absent, substituted or ambiguous positive evidence / "+fault+(locale==="en"?"":" / "+locale),async t=>{
  const{x,preview,row}=await expiredArrangement(t,{locale});await freshArrangementOwner(x);const transport=x.h.transport;let altered=false;
  x.h.transport=async request=>{const response=await transport(request);
    if(!altered&&request.url==="/api/canvas/arrangements"&&request.body.action==="retrieve"){
      assert.equal(response.status,409);const body=await response.clone().json();assertDescriptor(x,preview,{command:request.body,status:409,body});altered=true;
      if(fault==="missing")delete body.disposition;
      if(fault==="version")body.disposition.version=2;
      if(fault==="actor")body.disposition.actorUserId="other-current-actor";
      if(fault==="operation")body.disposition.operationId="other-operation";
      if(fault==="board")body.disposition.canvasId="other-board";
      if(fault==="project")body.disposition.projectId="other-project";
      if(fault==="hash")body.disposition.approvalHash="malformed-hash";
      if(fault==="preview")body.disposition.previewId="";
      if(fault==="extra")body.disposition.preview={name:preview.name};
      if(fault==="not-applied")return Response.json({status:"not-applied",operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,providerCalls:0,maximumMicrousd:0});
      return Response.json(body,{status:409});
    }return response;};
  await openReceipt(x);await x.drain();assert.equal(altered,true);assert.equal(dispositionControl(x),undefined);assert.equal(pendingForm(x),undefined);
  assert.equal(x.f.tree().root.text.includes(outcomeDeskCopy(locale).issues.expired),false,"unqualified expired evidence never promises an unapplied original or a replacement");
  assert.equal(x.operation(),preview.operationId);assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);
  assert.equal(x.arrangementPosts().filter(value=>value.body.action==="dismiss").length,0);
  await check(x,locale);assert.ok(dispositionControl(x),"a separate genuine current read can qualify the unchanged original");
});
