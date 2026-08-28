import assert from "node:assert/strict";
import test from "node:test";
import {file,money,privateView,sourceView,privateJob,presentationSetup,audioSetup,deny,operations,sceneDeferred} from "./helpers/document-job-source-recovery-fixture.mjs";

const acknowledged="The server acknowledged the original change. Its private view is unavailable.";
const http=rows=>rows.map(row=>({url:row.url,method:row.init.method??"GET"}));

async function holdOperation(x,operation,{bodyPending=false,invalid=null}={}){
  const {h,fixture,job}=x,target="/api/document-jobs/"+job.jobId+"/"+operation.suffix;
  const entered=sceneDeferred(),release=sceneDeferred(),before=JSON.stringify(h.store.documentJobs.get());
  const requestStart=h.requests.length,providerStart=x.calls.length,afterDelivery=[];
  let wire=null,accounting=null,providerAfterOriginal=0,released=false;
  h.intercept=async request=>{
    if(request.url!==target||request.init.method!=="POST"){
      if(released)afterDelivery.push({request:{url:request.url,method:request.init.method??"GET"},job:privateView(privateJob(h,job.jobId))});
      return undefined;
    }
    const original=await fixture.request(request.url,request.init);
    assert.equal(original.status,200,await original.clone().text());
    wire=await original.clone().json();assert.equal(wire.job.jobId,job.jobId);
    accounting=money(fixture);providerAfterOriginal=x.calls.length;
    // Invalid variants are explicit negative wire controls, never fabricated positive receipts.
    const response=invalid?Response.json(invalid(structuredClone(wire)),{status:original.status,headers:original.headers}):original;
    if(bodyPending){
      const bytes=new Uint8Array(await response.arrayBuffer());
      const stream=new ReadableStream({start(controller){release.promise.then(()=>{controller.enqueue(bytes);controller.close();});}});
      entered.resolve();return new Response(stream,{status:response.status,headers:response.headers});
    }
    entered.resolve();await release.promise;return response;
  };
  const pending=h.store[operation.method](job.jobId);
  await Promise.race([entered.promise,pending.then(value=>{throw new Error("Original operation ended before actual Worker response: "+String(value));})]);
  return {pending,wire,before,afterDelivery,target,baseIntercept:h.intercept,
    release(){released=true;release.resolve();},
    verify(){assert.deepEqual(money(fixture),accounting,"canonical reservations, settled usage and unknown holds remain exact after original acknowledgement");
      assert.equal(x.calls.length,providerAfterOriginal,"no provider request after the original response");
      assert.equal(x.calls.slice(providerStart).filter(call=>call.method==="POST").length,0,"recovery never purchases another provider request");
      assert.deepEqual(h.requests.slice(requestStart).filter(row=>(row.init.method??"GET")!=="GET").map(row=>row.url),[target],"only the one deliberate original operation");}};
}

function referenceOnly(job,wire){
  assert.ok(job);assert.equal(job.jobId,wire.jobId);assert.equal(job.documentId,wire.documentId);
  assert.equal(job.kind,wire.kind);assert.equal(job.status,wire.status);assert.equal(job.updatedAt,wire.updatedAt);
  assert.equal(job.attemptCount,wire.attemptCount);assert.equal(job.dismissedAt,wire.dismissedAt);
  const view=privateView(job);assert.equal(view.plannerInput,false);assert.equal(view.artifactPlan,false);assert.equal(view.generationReceipt,false);assert.equal(view.sourceText,false);
  assert.equal(job.error,null);assert.equal(job.errorDetail,null);assert.equal(job.moderationPromptRef,null);
  assert.equal(job.stage,"");assert.equal(job.progressMessage,"");
  assert.deepEqual(job.result,wire.result?.artifactKind?{artifactKind:wire.result.artifactKind}:null,"the existing content-free result whitelist stays exact");
}

for(const[name,operation]of Object.entries(operations)){
  test("late job recovery healthy exact original "+name,async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
    held.release();assert.equal(await held.pending,true);
    assert.ok(privateView(privateJob(x.h,x.job.jobId)).plannerInput||held.afterDelivery.some(row=>row.job.plannerInput),"healthy body is authorized; Stop may subsequently use the ordinary scoped job-list projection");
    held.verify();
  });
  for(const bodyPending of[false,true])test("late job recovery "+name+" source403 before "+(bodyPending?"body":"headers")+" keeps only original acknowledgement",async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation,{bodyPending});
    await deny(x);held.release();assert.equal(await held.pending,true,"a genuine original acknowledgement survives private-view withdrawal");
    referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
    assert.ok(held.afterDelivery.every(row=>!row.job.plannerInput&&!row.job.artifactPlan&&!row.job.sourceText),"no transient raw private publication before a follow-up request");
    assert.ok(x.h.store.ui.toast.includes(acknowledged));
    assert.equal(x.h.store.routeDataReady(),false);held.verify();
  });
  test("late job recovery "+name+" fresh source after retirement cannot authorize the old private body",async t=>{
    const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
    await deny(x);x.restore();await x.h.store.refreshEvents();
    assert.ok(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()));assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),false);
    held.release();assert.equal(await held.pending,true);referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
    assert.ok(held.afterDelivery.every(row=>!row.job.plannerInput));held.verify();
  });
}

for(const[name,operation]of Object.entries(operations))for(const variant of["wrong-id","wrong-document","invalid-status"]){
  test("late job recovery "+name+" rejects "+variant+" response without publication",async t=>{
    const x=await(operation.setup??presentationSetup)(t);
    const held=await holdOperation(x,operation,{invalid:body=>{if(variant==="wrong-id")body.job.jobId="different-original-job";if(variant==="wrong-document")body.job.documentId="different-authorized-document";if(variant==="invalid-status")body.job.status="invented-status";return body;}});
    held.release();assert.equal(await held.pending,false);assert.equal(JSON.stringify(x.h.store.documentJobs.get()),held.before,"a malformed/foreign reply cannot replace original state");
    held.verify();
  });
}

for(const name of["presentation","stop"])for(const failure of["source403","transport500"]){
  test("late job recovery "+name+" original acknowledgement survives follow-up "+failure,async t=>{
    const operation=operations[name],x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
    let failed=false;
    x.h.intercept=async request=>{
      if(request.url===held.target)return held.baseIntercept(request);
      const followup=name==="presentation"?request.url.startsWith("/api/events?"):request.url==="/api/session";
      if(!failed&&followup){
        failed=true;
        if(failure==="source403"){await deny(x);return x.fixture.request(request.url,request.init);}
        return Response.json({error:"PRIVATE_UNTRUSTED_FOLLOWUP_DIAGNOSTIC"},{status:500});
      }
      return held.baseIntercept(request);
    };
    held.release();assert.equal(await held.pending,true);assert.ok(failed,"the original view refresh actually reached its negative boundary");
    const current=privateJob(x.h,x.job.jobId);assert.equal(current.jobId,held.wire.job.jobId);assert.equal(current.status,held.wire.job.status);
    if(failure==="source403")referenceOnly(current,held.wire.job);
    assert.ok(x.h.store.ui.toast.includes(acknowledged));assert.ok(!x.h.store.ui.toast.includes("PRIVATE_UNTRUSTED_FOLLOWUP_DIAGNOSTIC"));
    held.verify();
  });
}

test("late job recovery newer completed covering read still defeats an older denied source read",async t=>{
  const x=await presentationSetup(t),held=await holdOperation(x,operations.dismiss);
  const entered=sceneDeferred(),release=sceneDeferred();let once=false;
  x.h.intercept=async request=>{
    if(!once&&request.url.startsWith("/api/events?")){once=true;const response=await x.fixture.request(request.url,request.init);assert.equal(response.status,403);entered.resolve();await release.promise;return response;}
    return held.baseIntercept(request);
  };
  x.revoke();const denied=x.h.store.refreshEvents();await entered.promise;x.restore();await x.h.store.refreshEvents();
  const fresh=x.h.store.captureSourceOwnership();release.resolve();await assert.rejects(denied,/403/);assert.ok(x.h.store.sourceOwnershipActive(fresh));
  held.release();assert.equal(await held.pending,true);assert.ok(privateView(privateJob(x.h,x.job.jobId)).plannerInput);held.verify();
});

test("late job recovery true new signed scope ignores the old personal acknowledgement",async t=>{
  const x=await presentationSetup(t),{h,fixture,job}=x,held=await holdOperation(x,operations.dismiss);
  const json=body=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const created=await fixture.request("/api/workspaces",json({name:"In-memory late-response scope control"}));assert.equal(created.status,201);const organizationId=(await created.json()).organizationId;
  const projected=await fixture.request("/api/workspaces/"+organizationId+"/projects",json({projectId:"project-atmosphere"}));assert.equal(projected.status,201);const projectAccessId=(await projected.json()).projectAccessId;
  const selected=await fixture.request("/api/workspaces/"+organizationId+"/projects/"+projectAccessId+"/context",{method:"POST"});assert.equal(selected.status,200);
  const cookie=selected.headers.get("set-cookie").split(";")[0];h.transport=request=>fixture.request(request.url,{...request.init,headers:{...Object.fromEntries(new Headers(request.init.headers)),cookie}});
  await h.store.refreshSession();await h.store.refreshEvents();assert.equal(h.store.authorizationScopeActive(x.originalAuth),false);
  const before=JSON.stringify(h.store.documentJobs.get()),accounting=money(fixture),calls=x.calls.length;
  held.release();assert.equal(await held.pending,false);assert.equal(JSON.stringify(h.store.documentJobs.get()),before);
  assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));assert.deepEqual(money(fixture),accounting);assert.equal(x.calls.length,calls);assert.ok(job.jobId);
});

test("late job recovery shared Dismiss keeps actual server redaction",async t=>{
  const x=await audioSetup(t,{shared:true}),held=await holdOperation(x,operations.dismiss);
  assert.ok(x.h.store.session.get().projectContext);assert.equal(privateView(held.wire.job).plannerInput,false);
  held.release();assert.equal(await held.pending,true);
  assert.equal(privateView(privateJob(x.h,x.job.jobId)).plannerInput,false);assert.equal(privateView(privateJob(x.h,x.job.jobId)).artifactPlan,false);held.verify();
});

test("late job recovery deliberate exact private read after fresh source can restore original details",async t=>{
  const x=await audioSetup(t),held=await holdOperation(x,operations.dismiss);
  await deny(x);held.release();assert.equal(await held.pending,true);referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
  x.restore();await x.h.store.refreshEvents();referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
  const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);assert.equal(detail.jobId,x.job.jobId);assert.ok(privateView(detail).plannerInput);
  assert.ok(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()));held.verify();
});

test("late job recovery full Shell retains no old private body across withdrawal and restoration",async t=>{
  const x=await audioSetup(t),{h,fixture,job}=x,bootstrapDocument="late-recovery-layout-only";
  const {appendAuditEvent}=await import(file("worker/runtime.ts"));await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","DocumentCreated",{project_id:"project-atmosphere",document_id:bootstrapDocument,title:"In-memory layout bootstrap"});
  await h.store.refreshEvents();const original={events:h.store.events.get(),content:h.store.content.get(),head:h.store.head.get(),session:h.store.session.get()};
  const {createCalmFullPage}=await import(file("tests/helpers/calm-full-page-fixture.mjs"));
  globalThis.fetch=async(input,init={})=>{assert.ok(String(input).startsWith("/api/"),"no external request after original provider setup");return h.fetch(input,init);};
  const full=await createCalmFullPage(t,{storeHost:{...h,request:{...h.request,documentId:bootstrapDocument}}});
  h.store.events.set(original.events);h.store.content.set(original.content);h.store.head.set(original.head);h.store.session.set(original.session);h.store.route.set("/document/"+job.documentId+"/late-recovery-proof");
  const dispatch=h.window.dispatchEvent;h.window.dispatchEvent=function(event){const result=dispatch.call(this,event);for(const callback of[...(full.listeners.get(event.type)??[])])callback(event);return result;};t.after(()=>{h.window.dispatchEvent=dispatch;});
  await full.settle();assert.equal(h.store.session.get(),original.session);assert.ok(h.store.routeDataReady());x.originalAuth=h.store.captureAuthorizationScope();x.originalSource=h.store.captureSourceOwnership();
  const held=await holdOperation(x,operations.dismiss);await deny(x);await full.settle();
  assert.equal(full.components().filter(component=>component.tag==="forma-workspace").length,0);
  held.release();assert.equal(await held.pending,true);await full.settle();referenceOnly(privateJob(h,job.jobId),held.wire.job);
  assert.equal(h.store.routeDataReady(),false);assert.equal(full.components().filter(component=>component.tag==="forma-workspace").length,0);assert.ok(!full.renderer.markup.includes("Original felt piano"));
  x.restore();const before=h.requests.length;await h.store.refreshEvents();await full.settle();
  assert.equal(h.store.routeDataReady(),true);assert.equal(full.components().filter(component=>component.tag==="forma-workspace").length,1);
  referenceOnly(privateJob(h,job.jobId),held.wire.job);assert.ok(!full.renderer.markup.includes("Original felt piano"));held.verify();
  t.diagnostic(JSON.stringify({source:sourceView(h),restoration:http(h.requests.slice(before)),privateBodyRetained:false,nativePixelClaim:false}));
});

for(const[name,operation]of Object.entries(operations))test("late job recovery "+name+" preserves newer exact post-retirement detail and notice",async t=>{
  const x=await(operation.setup??presentationSetup)(t),held=await holdOperation(x,operation);
  await deny(x);x.restore();await x.h.store.refreshEvents();
  const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);
  assert.ok(privateView(detail).plannerInput);assert.equal(privateJob(x.h,x.job.jobId),detail);
  x.h.store.ui.toast="Current exact detail";
  held.release();assert.equal(await held.pending,true);
  assert.equal(privateJob(x.h,x.job.jobId),detail,"already published newer detail remains the same object");
  assert.equal(x.h.store.ui.toast,"Current exact detail","old acknowledgement does not overwrite the newer view's meaning");
  const before=x.h.requests.length;assert.equal(await x.h.store.loadDocumentJobDetail(x.job.jobId),detail);
  assert.equal(x.h.requests.length,before,"the existing verified detail cache was not deleted");held.verify();
});

for(const restoreAgain of[false,true])test("late job recovery another retirement invalidates newer exact detail "+restoreAgain,async t=>{
  const x=await audioSetup(t),held=await holdOperation(x,operations.dismiss);
  await deny(x);x.restore();await x.h.store.refreshEvents();const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);assert.ok(privateView(detail).plannerInput);
  await deny(x);if(restoreAgain){x.restore();await x.h.store.refreshEvents();}
  held.release();assert.equal(await held.pending,true);referenceOnly(privateJob(x.h,x.job.jobId),held.wire.job);
  assert.notEqual(privateJob(x.h,x.job.jobId),detail);held.verify();
});

for(const field of["jobId","documentId"])test("late job recovery newer exact detail cannot authorize a foreign "+field+" acknowledgement",async t=>{
  const x=await audioSetup(t),held=await holdOperation(x,operations.dismiss,{invalid:body=>{body.job[field]="foreign-identity";return body;}});
  await deny(x);x.restore();await x.h.store.refreshEvents();const detail=await x.h.store.loadDocumentJobDetail(x.job.jobId);assert.ok(privateView(detail).plannerInput);
  x.h.store.ui.toast="Current exact detail";held.release();assert.equal(await held.pending,false);
  assert.equal(privateJob(x.h,x.job.jobId),detail);assert.equal(x.h.store.ui.toast,"Current exact detail");held.verify();
});

test("late job recovery newer completed exact receipt is not regressed by an older failed acknowledgement",async t=>{
  const x=await audioSetup(t),held=await holdOperation(x,operations.dismiss),{h,fixture,job}=x;
  await deny(x);x.restore();await h.store.refreshEvents();
  const accounting=money(fixture);assert.equal(await h.store.recoverDocumentRender(job.jobId),true);
  const detail=await h.store.loadDocumentJobDetail(job.jobId),calls=x.calls.length;assert.equal(detail.status,"completed");
  assert.ok(Date.parse(detail.updatedAt)>Date.parse(held.wire.job.updatedAt),"actual canonical completion is newer than the held failed receipt");
  h.store.ui.toast="Current completed receipt";held.release();assert.equal(await held.pending,true);
  assert.equal(privateJob(h,job.jobId),detail);assert.equal(h.store.ui.toast,"Current completed receipt");
  assert.deepEqual(money(fixture),accounting);assert.equal(x.calls.length,calls);
  assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET").map(row=>row.url),[held.target,"/api/document-jobs/"+job.jobId+"/retry"],"only the two deliberately invoked original operations");
});

test("late job recovery genuinely later terminal Stop still replaces an earlier exact queued detail",async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("no provider request for this queued original control"));
  const {createSceneCostFixture}=await import(file("tests/helpers/scene-cost-fixture.mjs"));
  const worker=await createSceneCostFixture(1,"visual"),inspected=await worker.preview();assert.equal(inspected.response.status,200);
  const admitted=await worker.approve(inspected.body.sceneCostPreview);assert.equal(admitted.response.status,202);const job=admitted.body.job;
  const {hostFor}=await import("./helpers/document-job-source-recovery-fixture.mjs");
  const x=await hostFor(t,{...worker,environment:worker.env},worker.documentId,job,[]),{h}=x,entered=sceneDeferred(),release=sceneDeferred();
  let wire=null,accounting=null;const target="/api/document-jobs/"+job.jobId+"/cancel";
  h.intercept=async request=>{if(request.url!==target)return undefined;entered.resolve();await release.promise;const response=await worker.request(request.url,request.init);assert.equal(response.status,200);wire=await response.clone().json();accounting=money(worker);return response;};
  const pending=h.store.stopDocumentJob(job.jobId);await entered.promise;await deny(x);x.restore();await h.store.refreshEvents();
  const detail=await h.store.loadDocumentJobDetail(job.jobId);assert.equal(detail.status,"queued");
  release.resolve();assert.equal(await pending,true);assert.equal(wire.job.status,"canceled");
  referenceOnly(privateJob(h,job.jobId),wire.job);assert.notEqual(privateJob(h,job.jobId),detail);
  assert.deepEqual(money(worker),accounting);
  assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET").map(row=>row.url),[target]);
});

test("late job recovery failed Stop view refresh does not wait for a different pending view read",async t=>{
  const x=await audioSetup(t),held=await holdOperation(x,operations.stop),release=sceneDeferred();
  const {untilScene}=await import(file("tests/helpers/scene-cost-store-host.mjs"));
  let resolved,readPending=false;
  x.h.intercept=async request=>{
    if(request.url===held.target)return held.baseIntercept(request);
    if(request.url==="/api/document-jobs"||request.url.startsWith("/api/document-jobs?")){
      const response=await x.fixture.request(request.url,request.init);assert.equal(response.status,200);
      readPending=true;await release.promise;return response;
    }
    if(request.url==="/api/session")return Response.json({error:"PRIVATE_UNTRUSTED_FOLLOWUP_DIAGNOSTIC"},{status:500});
    return held.baseIntercept(request);
  };
  held.pending.then(value=>{resolved=value;});held.release();
  try{
    await untilScene(()=>readPending,"the genuine original job-list response is held");
    await untilScene(()=>resolved!==undefined,"the original acknowledged Stop settles after the failed view read");
    assert.equal(resolved,true);assert.ok(x.h.store.ui.toast.includes(acknowledged));
    assert.ok(!x.h.store.ui.toast.includes("PRIVATE_UNTRUSTED_FOLLOWUP_DIAGNOSTIC"));held.verify();
  }finally{release.resolve();await held.pending;await new Promise(setImmediate);}
});
