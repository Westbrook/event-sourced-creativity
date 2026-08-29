import assert from "node:assert/strict";
import test from "node:test";
import {page,previewArrangement,applyControl,outcomeDeskCopy,control,closeAndReenter,check,currentFrames,retained,
  crashAfterRealClaim,moveNativeClocks,dispositionNativePort,pendingForm,dispositionControl} from "./helpers/arrangement-expired-review-fixture.mjs";

const locales=["en","fr","ar","ja"];
for(const locale of locales)for(const scenario of["healthy","committed-loss","unsubmitted-expired","lease-expired","plan-expired"])
test("current full arrangement recovery "+scenario+" / "+locale,async t=>{
  const x=await page(t,{locale,shared:false}),copy=outcomeDeskCopy(locale);dispositionNativePort(t,x);
  const beforeFrames=currentFrames(x),preview=await previewArrangement(x),originalOperation=preview.operationId;
  assert.equal(x.operation(),originalOperation);assert.equal(x.ledger().length,0);
  if(scenario==="unsubmitted-expired"){
    moveNativeClocks(t,x,Date.parse(preview.expiresAt)+1);
    const before=x.arrangementPosts().length;await x.f.act(applyControl(x));await x.drain();
    assert.equal(x.arrangementPosts().length,before,"an expired unsubmitted Apply is locally refused");
    assert.equal(x.f.tree().root.text.includes(copy.issues.expired),true,"the existing unsubmitted-expiry explanation remains");
    await x.f.act(control(x,copy.cancel));await x.drain();
    const response=x.responses.at(-1);assert.equal(response.command.action,"dismiss");assert.equal(response.status,200);assert.equal(response.body.status,"dismissed");
    assert.equal(response.command.previewId,preview.previewId);assert.equal(response.command.approvalHash,preview.approvalHash);
    assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),beforeFrames);return;
  }
  let crash;if(scenario.endsWith("expired")){crash=crashAfterRealClaim(x);t.after(crash.restore);}
  if(scenario==="committed-loss"){
    const transport=x.h.transport;let lost=false;
    x.h.transport=async request=>{
      const response=await transport(request);
      if(request.url==="/api/canvas/arrangements"&&request.body.action==="apply"&&!lost){
        assert.equal(response.status,200);assert.equal((await response.clone().json()).status,"applied");lost=true;
        throw new Error("test_response_lost_after_real_commit");
      }return response;
    };
  }
  await x.f.act(applyControl(x));await x.drain();
  if(scenario==="healthy"||scenario==="committed-loss"){
    const ledger=x.ledger();assert.equal(ledger.length,1);
    assert.equal(x.responses.at(-1).status,200);assert.equal(x.responses.at(-1).body.status,"applied");
    await closeAndReenter(x);const read=await check(x,locale);assert.equal(read.status,200);assert.equal(read.body.status,"applied");
    assert.deepEqual(x.ledger(),ledger);assert.equal(x.operation(),originalOperation);assert.equal(dispositionControl(x),undefined);
    await x.f.act(control(x,x.copy.undo));await x.drain();
    assert.equal(x.responses.at(-1).command.action,"undo-preview");assert.equal(x.responses.at(-1).command.undoOperationId,originalOperation);
    assert.equal(x.responses.at(-1).status,200);assert.equal(x.responses.at(-1).body.status,"review");
    await x.f.act(applyControl(x));await x.drain();
    assert.equal(x.responses.at(-1).body.status,"applied");assert.equal(x.ledger().length,2);assert.deepEqual(currentFrames(x),beforeFrames);
    return;
  }
  assert.equal(crash.count(),1);crash.restore();assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),beforeFrames);
  const claim=JSON.parse(retained(x,preview).content);assert.equal(claim.state,"applying");assert.ok(claim.leaseId);
  assert.equal(x.responses.at(-1).status,202);assert.equal(x.responses.at(-1).body.status,"applying");
  moveNativeClocks(t,x,Date.parse(scenario==="lease-expired"?claim.leaseExpiresAt:preview.expiresAt)+1);
  const before=retained(x,preview),changes=Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n);
  const reentry=await closeAndReenter(x),read=scenario==="lease-expired"?reentry:await check(x,locale);
  assert.deepEqual(retained(x,preview),before);assert.equal(Number(x.worker.sqlite.prepare("SELECT total_changes() AS n").get().n),changes,"all current reads perform zero SQL writes");
  assert.equal(x.operation(),originalOperation);assert.equal(x.ledger().length,0);
  if(scenario==="lease-expired"){
    assert.equal(read.status,200);assert.equal(read.body.status,"review");assert.equal(dispositionControl(x),undefined);
    await x.f.act(control(x,copy.cancel));await x.drain();const response=x.responses.at(-1);
    assert.equal(response.command.action,"dismiss");assert.equal(response.command.previewId,preview.previewId);assert.equal(response.command.approvalHash,preview.approvalHash);
    assert.equal(response.status,200);assert.equal(response.body.status,"dismissed");assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),beforeFrames);
    return;
  }
  assert.equal(read.status,409);assert.equal(read.body.error,"canvas_arrangement_preview_expired");assert.equal(read.body.preview,undefined);
  const request=dispositionControl(x);assert.ok(request,"current visible request to adjudicate the exact expired intent");
  assert.equal(request.text,x.copy.requestDisposition);assert.ok(x.f.tree().root.text.includes(x.copy.dispositionHint));
  assert.equal(x.f.tree().root.text.includes(copy.issues.expired),false,"the unresolved original never promises nothing applied or a replacement review");
  assert.equal(pendingForm(x),undefined,"still submitted; no replacement Review before server adjudication");
  const count=x.arrangementPosts().length;await x.f.act(request);await x.drain();
  const disposed=x.responses.at(-1);assert.equal(x.arrangementPosts().length,count+1);assert.equal(disposed.command.action,"dismiss");
  assert.equal(disposed.command.previewId,preview.previewId);assert.equal(disposed.command.approvalHash,preview.approvalHash);
  assert.equal(disposed.status,200);assert.equal(disposed.body.status,"dismissed");assert.equal(disposed.body.operationId,originalOperation);
  assert.equal(x.operation(),originalOperation);assert.equal(x.ledger().length,0);assert.deepEqual(currentFrames(x),beforeFrames);
  const after=JSON.parse(retained(x,preview).content);assert.deepEqual(after.plan,claim.plan);assert.equal(after.approvalHash,claim.approvalHash);
  assert.ok(x.f.tree().root.text.includes(x.copy.dismissed));const form=pendingForm(x);assert.ok(form);
  assert.equal(x.arrangementPosts().length,count+1,"no automatic new operation or Apply");
  await x.f.act(form,"submit");await x.drain();const next=x.responses.at(-1);
  assert.equal(next.command.action,"preview");assert.equal(next.body.status,"review");assert.notEqual(next.body.preview.operationId,originalOperation);assert.notEqual(next.body.preview.previewId,preview.previewId);
  assert.equal(x.ledger().length,0,"new Review still requires a separate human Apply");
  await x.f.act(applyControl(x));await x.drain();assert.equal(x.responses.at(-1).body.status,"applied");assert.equal(x.ledger().length,1);
  assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),true);assert.equal(x.h.store.authorizationScopeActive(x.originalAuth),true);
});
