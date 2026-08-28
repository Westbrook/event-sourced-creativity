import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {registerHooks} from "node:module";
import {file,money,privateView,privateJob,audioSetup,presentationSetup,operations,hostFor} from "./helpers/document-job-source-recovery-fixture.mjs";

// Reuse the unchanged original HTTP-hold fixture without registering its 56
// tests twice. No production member or positive response is replaced.
const originalUrl=new URL("./document-job-source-recovery.test.mjs",import.meta.url);
const original=fs.readFileSync(originalUrl,"utf8");
const boundary=original.indexOf("\nfor(const[name,operation]of Object.entries(operations)){");
assert.ok(boundary>0,"the complete original fixture declarations");
originalUrl.search="?same-source-job-order-r3";
const fixtureSource=original.slice(0,boundary)+"\nexport {holdOperation};\n";
const fixtureHook=registerHooks({load(url,context,next){
  return url===originalUrl.href?{format:"module",source:fixtureSource,shortCircuit:true}:next(url,context);
}});
let holdOperation;
try{({holdOperation}=await import(originalUrl.href));}finally{fixtureHook.deregister();}

for(const[name,operation]of Object.entries(operations)){
  test("same-source original "+name+" preserves a later exact detail with equal operation reference",async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
    assert.ok(x.h.store.sourceOwnershipActive(x.originalSource),"the original Source remains active");
    const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
    assert.ok(privateView(detail).plannerInput);assert.equal(privateJob(x.h,x.job.jobId),detail);
    assert.equal(detail.status,held.wire.job.status);assert.equal(detail.updatedAt,held.wire.job.updatedAt);
    x.h.store.ui.toast="Current exact detail";
    held.release();assert.equal(await held.pending,true);
    assert.equal(privateJob(x.h,x.job.jobId),detail,"the exact current detail object survives");
    assert.equal(x.h.store.ui.toast,"Current exact detail","older feedback does not replace the newer view");
    const before=x.h.requests.length;assert.equal(await x.h.store.loadDocumentJobDetail(x.job.jobId),detail);
    assert.equal(x.h.requests.length,before,"the existing verified detail cache was not deleted");
    assert.ok(x.h.store.sourceOwnershipActive(x.originalSource));held.verify();
  });
}

test("same-source original Dismiss cannot replace a newer canonical completed recovery",async t=>{
  const x=await audioSetup(t),{h,fixture,job}=x,held=await holdOperation(x,operations.dismiss);
  assert.equal(held.wire.job.status,"failed");assert.ok(h.store.sourceOwnershipActive(x.originalSource));
  const accounting=money(fixture),providerBeforeRecovery=x.calls.length;
  assert.equal(await h.store.recoverDocumentRender(job.jobId),true);
  const detail=await h.store.loadDocumentJobDetail(job.jobId);
  assert.equal(detail.status,"completed");
  assert.ok(Date.parse(detail.updatedAt)>Date.parse(held.wire.job.updatedAt),"the actual canonical completed receipt is newer");
  const calls=x.calls.length;h.store.ui.toast="Current completed receipt";
  held.release();assert.equal(await held.pending,true);
  const canonical=fixture.sqlite.prepare("SELECT status,updated_at FROM document_jobs WHERE job_id=?").get(job.jobId);
  assert.equal(canonical.status,"completed");assert.equal(canonical.updated_at,detail.updatedAt);
  assert.equal(privateJob(h,job.jobId),detail);assert.equal(h.store.ui.toast,"Current completed receipt");
  assert.ok(h.store.sourceOwnershipActive(x.originalSource));
  assert.deepEqual(money(fixture),accounting);assert.equal(x.calls.length,calls);
  assert.equal(x.calls.slice(providerBeforeRecovery).filter(call=>call.method==="POST").length,0);
  assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET").map(row=>row.url),[
    held.target,"/api/document-jobs/"+job.jobId+"/retry",
  ],"only the two deliberately invoked original operations");
});

test("same-source genuinely later terminal Stop is not suppressed by an earlier exact queued detail",async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("no provider request for this queued original control"));
  const {createSceneCostFixture}=await import(file("tests/helpers/scene-cost-fixture.mjs"));
  const worker=await createSceneCostFixture(1,"visual"),inspected=await worker.preview();assert.equal(inspected.response.status,200);
  const admitted=await worker.approve(inspected.body.sceneCostPreview);assert.equal(admitted.response.status,202);const job=admitted.body.job;
  const x=await hostFor(t,{...worker,environment:worker.env},worker.documentId,job,[]),{h}=x;
  const detail=await h.store.loadDocumentJobDetail(job.jobId);assert.equal(detail.status,"queued");
  const target="/api/document-jobs/"+job.jobId+"/cancel",observed=[];let wire,accounting,listed;
  h.intercept=async request=>{
    if(request.url===target){
      const response=await worker.request(request.url,request.init);assert.equal(response.status,200);
      wire=await response.clone().json();accounting=money(worker);return response;
    }
    if(request.url==="/api/document-jobs"||request.url.startsWith("/api/document-jobs?")){
      observed.push(privateJob(h,job.jobId));
      const response=await worker.request(request.url,request.init);assert.equal(response.status,200);
      listed=(await response.clone().json()).jobs??[];return response;
    }
    return undefined;
  };
  assert.equal(await h.store.stopDocumentJob(job.jobId),true);assert.equal(wire.job.status,"canceled");
  assert.ok(observed.some(entry=>entry?.jobId===job.jobId&&entry.status==="canceled"),"the authentic later terminal acknowledgement publishes before the optional view refresh");
  assert.notEqual(observed[0],detail);
  assert.equal(Boolean(privateJob(h,job.jobId)),listed.some(entry=>entry.jobId===job.jobId),"the existing bounded follow-up list remains authoritative for feed membership");
  assert.ok(h.store.sourceOwnershipActive(x.originalSource));
  assert.equal(worker.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status,"canceled");
  assert.deepEqual(money(worker),accounting);
  assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET").map(row=>row.url),[target]);
});
