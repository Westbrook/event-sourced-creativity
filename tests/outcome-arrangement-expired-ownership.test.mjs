import assert from "node:assert/strict";
import test from "node:test";
import {page,previewArrangement,applyControl,openArrangement,outcomeDeskCopy,control,closeAndReenter,check,currentFrames,retained,
  crashAfterRealClaim,moveNativeClocks,dispositionNativePort,pendingForm,dispositionControl,lateClick,watchSubscriptions,disclosureDbClock} from "./helpers/arrangement-expired-review-fixture.mjs";

async function expired(t,{locale="en",shared=false,live=false}={}){
  const x=await page(t,{locale,shared});dispositionNativePort(t,x);
  const preview=await previewArrangement(x),frames=currentFrames(x);let clock;
  if(live)clock=moveNativeClocks(t,x,Date.parse(preview.expiresAt)-60_000);
  const crash=crashAfterRealClaim(x);t.after(crash.restore);
  await x.f.act(applyControl(x));await x.drain();assert.equal(crash.count(),1);crash.restore();
  assert.equal(x.responses.at(-1).status,202);assert.equal(x.responses.at(-1).body.status,"applying");
  const claim=JSON.parse(retained(x,preview).content);
  if(clock)clock.set(Date.parse(preview.expiresAt)+1);else clock=moveNativeClocks(t,x,Date.parse(preview.expiresAt)+1);
  const subscriptions=watchSubscriptions(t,x.h.store),row=retained(x,preview);
  const read=await closeAndReenter(x);assert.equal(read.status,live?202:409);
  if(live){assert.equal(read.body.status,"applying");assert.equal(read.body.approvalHash,preview.approvalHash);}
  else assert.equal(read.body.error,"canvas_arrangement_preview_expired");
  assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);
  const request=dispositionControl(x);if(live)assert.equal(request,undefined);else assert.ok(request);
  assert.equal(subscriptions.active(),live?0:1,"only a qualified read retains one current ownership subscriber");
  return{x,preview,claim,frames,clock,subscriptions,request,row};
}
function immutableEvents(x){return x.worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();}
function assertUnknown(x){assert.equal(pendingForm(x),undefined,"no replacement Review while the actual disposition is unknown");assert.equal(dispositionControl(x),undefined,"a consumed/invalidated capability never reappears without a new qualifying read");}
async function currentDismiss(x){const node=dispositionControl(x);assert.ok(node);await x.f.act(node);await x.drain();return x.responses.at(-1);}

for(const locale of["en","ar"])for(const kind of["route-aba","scope-aba","close-reopen","request-replaced"])
test("expired arrangement exact control ownership "+kind+" / "+locale,async t=>{
  const{x,preview,frames,subscriptions,request,row}=await expired(t,{locale}),events=immutableEvents(x),before=x.arrangementPosts().length;
  const oldRoute=x.h.store.route.get();
  if(kind==="route-aba"){
    x.h.store.setRoute(oldRoute+"&native-probe=other");x.h.store.setRoute(oldRoute);
    assert.equal(x.h.store.route.get(),oldRoute);
  }else if(kind==="scope-aba"){
    const session=x.h.store.session.get();
    // Negative session input only: both changes pass through the actual Store
    // ownership checks/notifications. No replacement positive authority token.
    x.h.setSession({permissionEpoch:"temporary-negative-epoch"});x.h.store.notify();
    x.h.store.session.set(session);x.h.store.notify();
  }else if(kind==="close-reopen"){
    await x.f.act(control(x,x.copy.close));await x.drain();await openArrangement(x,{select:false,name:null});await x.drain();
  }else{
    const held=x.hold("retrieve");await x.f.act(control(x,outcomeDeskCopy(locale).retrieve));await held.entered.promise;
    await lateClick(request);assert.equal(x.arrangementPosts().filter(value=>value.body.action==="dismiss").length,0);
    held.release();await x.drain();
  }
  await lateClick(request);await x.drain();
  assert.equal(x.arrangementPosts().filter(value=>value.body.action==="dismiss").length,0);
  assert.equal(x.arrangementPosts().length,before+(kind==="request-replaced"?1:0));
  assert.equal(x.operation(),preview.operationId);assert.deepEqual(retained(x,preview),row);
  assert.deepEqual(immutableEvents(x),events);assert.deepEqual(currentFrames(x),frames);assert.equal(x.ledger().length,0);
  if(kind!=="request-replaced"){assertUnknown(x);assert.equal(subscriptions.active(),0);await check(x,locale);}
  assert.ok(dispositionControl(x));assert.equal(subscriptions.active(),1);
  const response=await currentDismiss(x);assert.equal(response.status,200);assert.equal(response.body.status,"dismissed");
  assert.equal(subscriptions.active(),0,"terminal adjudication disposes the one-shot read owner");
  const counts=subscriptions.counts();assert.equal(counts.adds,counts.removes);
});

for(const locale of["en","ar"])test("actual Source403 then200 before render never resurrects old disposition / "+locale,async t=>{
  const{x,preview,request,row,subscriptions}=await expired(t,{locale,shared:true}),before=x.arrangementPosts().length,events=immutableEvents(x);
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.worker.sharing.contextId);
  const denied=await x.worker.request("/api/events?after=0&limit=2000&content=0");assert.equal(denied.status,403);
  await assert.rejects(x.h.store.refreshEvents(),/403/);
  const retired=x.h.store.captureSourceOwnership();assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),false);
  x.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.worker.sharing.contextId);
  await x.h.store.refreshEvents();
  const current=x.h.store.captureSourceOwnership();assert.ok(current.generation>x.originalSource.generation);
  assert.ok(current.generation>=retired.generation);assert.equal(x.h.store.sourceOwnershipActive(current),true);
  assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),false,"original source ticket never revives even before a component render");
  await lateClick(request);assert.equal(x.arrangementPosts().length,before);assert.equal(subscriptions.active(),0);
  await x.drain();assert.deepEqual(retained(x,preview),row);assert.deepEqual(immutableEvents(x),events);assert.equal(x.ledger().length,0);
});

for(const locale of["en","fr","ar","ja"])test("lost exact dismissal acknowledgement requires a fresh matching Check / "+locale,async t=>{
  const{x,preview,frames,subscriptions}=await expired(t,{locale}),transport=x.h.transport,before=x.arrangementPosts().length;let lost=false;
  x.h.transport=async request=>{
    const response=await transport(request);
    if(request.url==="/api/canvas/arrangements"&&request.body.action==="dismiss"&&!lost){assert.equal(response.status,200);assert.equal((await response.clone().json()).status,"dismissed");lost=true;throw new Error("test_lost_real_dismissal_ack");}
    return response;
  };
  await currentDismiss(x);assert.equal(lost,true);assert.equal(x.arrangementPosts().length,before+1);
  assertUnknown(x);assert.equal(subscriptions.active(),0);assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),frames);
  assert.equal(JSON.parse(retained(x,preview).content).state,"dismissed","the genuine server disposition exists despite the lost acknowledgement");
  const read=await check(x,locale);assert.equal(read.status,200);assert.equal(read.body.status,"dismissed");assert.equal(read.body.previewId,preview.previewId);
  assert.ok(pendingForm(x));assert.equal(x.operation(),preview.operationId);assert.equal(x.arrangementPosts().length,before+2);
  assert.equal(subscriptions.active(),0);assert.equal(subscriptions.counts().adds,subscriptions.counts().removes);
});

for(const fault of["preview-id","operation-id","extra-claim","not-applied","bad-status"])
test("malformed dismissal reply preserves the original submitted guard: "+fault,async t=>{
  const{x,preview,frames,subscriptions}=await expired(t),transport=x.h.transport;let altered=false;
  x.h.transport=async request=>{
    const response=await transport(request);
    if(request.url==="/api/canvas/arrangements"&&request.body.action==="dismiss"&&!altered){
      assert.equal(response.status,200);const body=await response.clone().json();assert.equal(body.status,"dismissed");altered=true;
      if(fault==="preview-id")body.previewId="unrelated-preview";
      if(fault==="operation-id")body.operationId="unrelated-operation";
      if(fault==="extra-claim")body.approvalHash="f".repeat(64);
      if(fault==="not-applied")body.status="not-applied";
      return Response.json(body,{status:fault==="bad-status"?202:200});
    }return response;
  };
  await currentDismiss(x);assert.equal(altered,true);assertUnknown(x);assert.equal(subscriptions.active(),0);
  assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),frames);assert.equal(x.operation(),preview.operationId);
  const read=await check(x,"en");assert.equal(read.status,200);assert.equal(read.body.status,"dismissed");
  assert.ok(pendingForm(x));assert.equal(subscriptions.active(),0);
});

for(const fault of["missing-zero","false-expiry","extra-preview","denied","lost-response"])
test("a missed or ambiguous read cannot qualify a new disposition: "+fault,async t=>{
  const{x,preview,request,row,subscriptions}=await expired(t),transport=x.h.transport;
  await x.f.act(control(x,x.copy.close));await x.drain();await openArrangement(x,{select:false,name:null});await x.drain();
  assertUnknown(x);assert.equal(subscriptions.active(),0);let altered=false;
  x.h.transport=async command=>{
    const response=await transport(command);
    if(command.url==="/api/canvas/arrangements"&&command.body.action==="retrieve"&&!altered){
      assert.equal(response.status,409);const body=await response.clone().json();altered=true;
      if(fault==="missing-zero")delete body.providerCalls;
      if(fault==="false-expiry")body.error="canvas_arrangement_operation_unavailable";
      if(fault==="extra-preview")body.previewId=preview.previewId;
      if(fault==="lost-response")throw new Error("test_missing_qualified_read");
      return Response.json(body,{status:fault==="denied"?403:409});
    }return response;
  };
  await check(x,"en");assert.equal(altered,true);assertUnknown(x);await lateClick(request);await x.drain();
  assert.equal(x.arrangementPosts().filter(value=>value.body.action==="dismiss").length,0);
  assert.deepEqual(retained(x,preview),row);assert.equal(x.ledger().length,0);assert.equal(subscriptions.active(),0);
});

for(const locale of["en","ar"])test("an opted-in current read keeps the actual live lease applying until its expiry / "+locale,async t=>{
  const{x,preview,claim,clock,frames,subscriptions,row}=await expired(t,{locale,live:true});
  assert.ok(Date.parse(claim.leaseExpiresAt)>Date.now());const before=x.arrangementPosts().length,changes=Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n);
  const live=await check(x,locale);assert.equal(live.status,202);assert.equal(live.body.status,"applying");assert.equal(live.body.previewId,preview.previewId);
  assert.equal(live.body.approvalHash,preview.approvalHash);assert.equal(live.command.includeDisposition,true);
  assertUnknown(x);assert.equal(x.arrangementPosts().length,before+1);assert.equal(subscriptions.active(),0);
  assert.equal(Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n),changes);
  assert.deepEqual(retained(x,preview),row);assert.deepEqual(currentFrames(x),frames);assert.equal(x.ledger().length,0);
  clock.set(Date.parse(claim.leaseExpiresAt)+1);await check(x,locale);assert.ok(dispositionControl(x));
  const settled=await currentDismiss(x);assert.equal(settled.status,200);assert.equal(settled.body.status,"dismissed");
  assert.ok(pendingForm(x));assert.equal(x.ledger().length,0);assert.equal(subscriptions.active(),0);
});

for(const locale of["en","fr","ar","ja"])for(const timing of["live","server-expired"])
test("known live original preserves default retrieval and explicit recovery opt-in / "+locale+"/"+timing,async t=>{
  const x=await page(t,{locale,shared:false});dispositionNativePort(t,x);
  const preview=await previewArrangement(x),crash=crashAfterRealClaim(x);t.after(crash.restore);
  await x.f.act(applyControl(x));await x.drain();assert.equal(crash.count(),1);crash.restore();
  assert.equal(x.responses.at(-1).status,202);assert.ok(Date.now()<Date.parse(preview.expiresAt));
  if(timing==="server-expired"){
    // A two-millisecond native DB/client boundary keeps the actual admission
    // current while the client still sees its exact original preview as live.
    const clock=disclosureDbClock(x.worker);t.mock.timers.enable({apis:["Date"],now:Date.parse(preview.expiresAt)-1});
    clock.set(new Date(Date.parse(preview.expiresAt)+1).toISOString());t.after(()=>{t.mock.timers.reset();clock.close();});
    assert.ok(Date.now()<Date.parse(preview.expiresAt));
  }
  const row=retained(x,preview),before=x.arrangementPosts().length,changes=Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n);
  const first=await closeAndReenter(x);
  assert.deepEqual(first.command,{operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,action:"retrieve"});
  assert.equal(first.status,timing==="live"?202:403);assert.equal(dispositionControl(x),undefined);assert.equal(pendingForm(x),undefined);
  if(timing==="live"){assert.equal(first.body.status,"applying");assert.deepEqual(Object.keys(first.body).sort(),["canvasId","operationId","previewId","projectId","status"]);}
  else{
    // Unflagged JS-live/DB-expired reads retain the existing private-disclosure
    // refusal. No response is relabeled as a terminal or qualified expiry.
    assert.equal(first.body.error,"canvas_arrangement_preview_unavailable");assert.equal(first.body.disposition,undefined);
    assert.equal(x.f.tree().root.text.includes(outcomeDeskCopy(locale).issues.expired),false,"an unqualified refusal must not claim nothing applied or promise a replacement review");
  }
  assert.deepEqual(retained(x,preview),row);assert.equal(x.arrangementPosts().length,before+1);
  assert.equal(x.ledger().length,0);assert.equal(Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n),changes);
  const second=await check(x,locale);assert.equal(second.command.includeDisposition,true);
  assert.equal(second.command.operationId,preview.operationId);assert.equal(second.status,timing==="live"?202:409);
  assert.equal(Boolean(dispositionControl(x)),timing==="server-expired");assert.equal(pendingForm(x),undefined);
  assert.equal(x.arrangementPosts().length,before+2);assert.equal(x.ledger().length,0);assert.deepEqual(retained(x,preview),row);
  assert.equal(Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n),changes,"both exact reads remain write-free");
});
