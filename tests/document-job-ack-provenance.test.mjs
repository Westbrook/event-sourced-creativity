import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {registerHooks} from "node:module";
import {money,privateJob,privateView,presentationSetup,audioSetup,operations,deny,sceneDeferred} from "./helpers/document-job-source-recovery-fixture.mjs";

const originalUrl=new URL("./document-job-source-recovery.test.mjs",import.meta.url);
const original=fs.readFileSync(originalUrl,"utf8");
const boundary=original.indexOf("\nfor(const[name,operation]of Object.entries(operations)){");
assert.ok(boundary>0,"unchanged original transport fixture declarations");
originalUrl.search="?ack-provenance-r3";
const fixtureSource=original.slice(0,boundary)+"\nexport {holdOperation,referenceOnly};\n";
const hook=registerHooks({load(url,context,next){return url===originalUrl.href?{format:"module",source:fixtureSource,shortCircuit:true}:next(url,context);}});
let holdOperation,referenceOnly;
try{({holdOperation,referenceOnly}=await import(originalUrl.href));}finally{hook.deregister();}

const exactReads=(h,id,start=0)=>h.requests.slice(start).filter(request=>(request.init.method??"GET")==="GET"&&new URL(request.url,"http://localhost").pathname==="/api/document-jobs/"+id);
async function acknowledge(x,operation=operations.dismiss,options){
  const held=await holdOperation(x,operation,options);held.release();assert.equal(await held.pending,true);return held;
}
function evictInput(h,job){
  const reference=job.result?.generationReceipt?.input_ref;assert.equal(typeof reference,"string");assert.ok(reference);
  const content={...h.store.content.get()};delete content[reference];h.store.content.set(content);return reference;
}
const inputRequest=request=>{const url=new URL(request.url,"http://localhost");return url.pathname==="/api/events"&&url.searchParams.get("limit")==="1"&&url.searchParams.get("content")==="1";};
async function holdWarmInput(x){
  const held=await acknowledge(x),reference=evictInput(x.h,privateJob(x.h,x.job.jobId)),entered=sceneDeferred(),release=sceneDeferred();
  let wire=null;
  x.h.intercept=async request=>{
    if(inputRequest(request)){
      const response=await x.fixture.request(request.url,request.init);assert.equal(response.status,200);
      wire=await response.clone().json();assert.equal(JSON.parse(wire.content[reference]).job_id,x.job.jobId);
      entered.resolve();await release.promise;return response;
    }
    return held.baseIntercept(request);
  };
  const start=x.h.requests.length,pending=x.h.store.loadDocumentJobDetail(x.job.jobId);
  await Promise.race([entered.promise,pending.then(()=>{throw new Error("Warm detail bypassed the actual private-input read");})]);
  return{held,reference,wire,start,pending,release:()=>release.resolve()};
}

for(const scenario of["newer-first-no-detail","newer-first-with-deliberate-detail","older-first-no-detail"]){
  test("ack provenance preserves real recovery without an added job read: "+scenario,async t=>{
    const x=await audioSetup(t),{h,fixture,job}=x,held=await holdOperation(x,operations.dismiss);
    assert.equal(held.wire.job.status,"failed");
    if(scenario==="older-first-no-detail"){held.release();assert.equal(await held.pending,true);}
    const start=h.requests.length,accounting=money(fixture),providerBefore=x.calls.length;
    assert.equal(await h.store.recoverDocumentRender(job.jobId),true);
    const recovered=privateJob(h,job.jobId);assert.equal(recovered.status,"completed");
    assert.ok(Date.parse(recovered.updatedAt)>Date.parse(held.wire.job.updatedAt),"actual canonical order");
    assert.ok(h.store.sourceOwnershipActive(x.originalSource));
    let current=recovered;
    if(scenario==="newer-first-with-deliberate-detail")current=await h.store.loadDocumentJobDetail(job.jobId);
    assert.equal(exactReads(h,job.jobId,start).length,0,"the genuine acknowledged body needs no added exact job GET");
    const notice=h.store.ui.toast,calls=x.calls.length;
    if(scenario!=="older-first-no-detail"){held.release();assert.equal(await held.pending,true);}
    const canonical=fixture.sqlite.prepare("SELECT status,updated_at FROM document_jobs WHERE job_id=?").get(job.jobId);
    assert.equal(canonical.status,"completed");assert.equal(canonical.updated_at,current.updatedAt);
    assert.equal(privateJob(h,job.jobId),current);assert.equal(h.store.ui.toast,notice);
    assert.deepEqual(money(fixture),accounting);assert.equal(x.calls.length,calls);
    assert.equal(x.calls.slice(providerBefore).filter(call=>call.method==="POST").length,0);
    assert.deepEqual(h.requests.filter(request=>(request.init.method??"GET")!=="GET").map(request=>request.url),[held.target,"/api/document-jobs/"+job.jobId+"/retry"]);
  });
}

for(const[name,operation]of Object.entries(operations)){
  test("ack provenance records the current complete original "+name+" body for an ordinary warm read",async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await acknowledge(x,operation),start=x.h.requests.length;
    const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
    assert.equal(detail.jobId,x.job.jobId);assert.equal(detail.documentId,x.job.documentId);
    assert.ok(privateView(detail).plannerInput);
    assert.equal(exactReads(x.h,x.job.jobId,start).length,0);
    assert.ok(x.h.store.sourceOwnershipActive(x.originalSource));held.verify();
  });
  test("ack provenance never caches the retired original "+name+" body",async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
    await deny(x);held.release();assert.equal(await held.pending,true);referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
    x.restore();await x.h.store.refreshEvents();const start=x.h.requests.length;
    const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
    assert.equal(detail.jobId,x.job.jobId);assert.ok(privateView(detail).plannerInput);
    assert.equal(exactReads(x.h,x.job.jobId,start).length,1,"restoration needs a genuinely fresh detail after retirement");held.verify();
  });
}

for(const variant of["missing-result","missing-stage","missing-requestedAt","invalid-updatedAt","array-result","missing-sourceSurface"]){
  test("ack provenance leaves "+variant+" partial envelope uncached",async t=>{
    const x=await audioSetup(t),held=await acknowledge(x,operations.dismiss,{invalid:body=>{
      // Explicit corrupt/truncated-wire negative; the original Worker commit is real.
      if(variant==="invalid-updatedAt")body.job.updatedAt="not-a-canonical-timestamp";
      else if(variant==="array-result")body.job.result=[];
      else delete body.job[variant.slice("missing-".length)];
      return body;
    }});
    const start=x.h.requests.length,detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
    assert.equal(exactReads(x.h,x.job.jobId,start).length,1,"a partial acknowledgement cannot masquerade as complete detail");
    assert.equal(detail.jobId,x.job.jobId);assert.ok(privateView(detail).plannerInput);held.verify();
  });
}
for(const key of["jobId","documentId","kind","status"]){
  test("ack provenance rejects an acknowledgement with missing identity "+key,async t=>{
    const x=await audioSetup(t),before=privateJob(x.h,x.job.jobId);
    const held=await holdOperation(x,operations.dismiss,{invalid:body=>{delete body.job[key];return body;}});
    held.release();assert.equal(await held.pending,false);assert.equal(privateJob(x.h,x.job.jobId),before);
    const start=x.h.requests.length;await x.h.store.loadDocumentJobDetail(x.job.jobId);
    assert.equal(exactReads(x.h,x.job.jobId,start).length,1);held.verify();
  });
}

test("ack provenance warm detail still performs actual private-input hydration",async t=>{
  const x=await audioSetup(t),held=await acknowledge(x),job=privateJob(x.h,x.job.jobId),reference=evictInput(x.h,job),start=x.h.requests.length;
  const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
  assert.equal(detail,job);assert.equal(exactReads(x.h,x.job.jobId,start).length,0);
  assert.ok(x.h.requests.slice(start).some(inputRequest));
  const retained=JSON.parse(x.h.store.content.get()[reference]);
  assert.equal(retained.job_id,x.job.jobId);assert.equal(retained.document_id,x.job.documentId);
  assert.ok(x.h.store.sourceOwnershipActive(x.originalSource));held.verify();
});
test("ack provenance warm detail rejects a corrupted private-input identity",async t=>{
  const x=await audioSetup(t),held=await acknowledge(x),reference=evictInput(x.h,privateJob(x.h,x.job.jobId)),start=x.h.requests.length;
  x.h.intercept=async request=>{
    if(inputRequest(request)){
      const response=await x.fixture.request(request.url,request.init);assert.equal(response.status,200);
      const body=await response.json(),input=JSON.parse(body.content[reference]);input.job_id="foreign-negative-control";
      body.content[reference]=JSON.stringify(input);return Response.json(body,{status:200});
    }
    return held.baseIntercept(request);
  };
  await assert.rejects(x.h.store.loadDocumentJobDetail(x.job.jobId),/private generation receipt does not belong/);
  assert.equal(exactReads(x.h,x.job.jobId,start).length,0);
  assert.equal(x.h.store.content.get()[reference],undefined,"the corrupted input is not merged");
  x.h.intercept=held.baseIntercept;assert.equal((await x.h.store.loadDocumentJobDetail(x.job.jobId)).jobId,x.job.jobId);
  assert.equal(JSON.parse(x.h.store.content.get()[reference]).job_id,x.job.jobId);held.verify();
});
test("ack provenance warm private-input read cannot cross genuine Source withdrawal and restoration",async t=>{
  const x=await audioSetup(t),warm=await holdWarmInput(x);
  await deny(x);warm.release();await assert.rejects(warm.pending,/current source is unavailable/);
  referenceOnly(privateJob(x.h,x.job.jobId),warm.held.wire.job);
  x.restore();x.h.intercept=warm.held.baseIntercept;await x.h.store.refreshEvents();const start=x.h.requests.length;
  const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);assert.ok(privateView(detail).plannerInput);
  assert.equal(exactReads(x.h,x.job.jobId,start).length,1,"Source retirement cleared the acknowledgement cache");
  warm.held.verify();
});
test("ack provenance warm private-input read cannot cross a genuine new signed scope",async t=>{
  const x=await audioSetup(t),warm=await holdWarmInput(x),{h,fixture}=x;
  const json=body=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const created=await fixture.request("/api/workspaces",json({name:"RAM acknowledgement scope control"}));assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  const projected=await fixture.request("/api/workspaces/"+organizationId+"/projects",json({projectId:"project-atmosphere"}));assert.equal(projected.status,201);const projectAccessId=(await projected.json()).projectAccessId;
  const selected=await fixture.request("/api/workspaces/"+organizationId+"/projects/"+projectAccessId+"/context",{method:"POST"});assert.equal(selected.status,200);
  const cookie=selected.headers.get("set-cookie").split(";")[0];
  h.transport=request=>fixture.request(request.url,{...request.init,headers:{...Object.fromEntries(new Headers(request.init.headers)),cookie}});
  await h.store.refreshSession();assert.equal(h.store.authorizationScopeActive(x.originalAuth),false);
  const before=JSON.stringify(h.store.documentJobs.get()),accounting=money(fixture),calls=x.calls.length;
  warm.release();await assert.rejects(warm.pending,/active workspace changed/);
  assert.equal(JSON.stringify(h.store.documentJobs.get()),before);assert.equal(h.store.content.get()[warm.reference],undefined);
  assert.deepEqual(money(fixture),accounting);assert.equal(x.calls.length,calls);
});
