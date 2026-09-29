import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { isSceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";
import { reserveCostBudget } from "../worker/pilot-policy.ts";

const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("Only the real in-memory Worker is used; no provider or external network"));
const paidRequests=h=>h.requests.filter(request=>request.url==="/api/document-jobs"&&request.body.payload.sceneCostPreview!==true);
async function retainedScene(t,{shared=false,failed=false,cookieFree=false}={}){
  noProviders(t);
  const h=await createSceneStoreHost({shared,count:9,medium:"audio"});t.after(()=>h.close());
  if(cookieFree){
    h.worker.setScopedHeaders({});
    const session=await h.worker.request("/api/session");assert.equal(session.status,200);
    h.store.session.set(await session.json());
    assert.equal(h.store.session.get().projectContext,undefined);
  }
  const fresh=await h.quote();assert.equal(fresh.job,null);assert.equal(fresh.safeUnused,null);
  assert.equal(await h.approve(fresh.preview),true);
  let terminal;
  if(failed){
    h.worker.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(h.worker.contentRef);
    terminal=(await h.worker.run()).body;
    assert.equal(terminal.job.status,"failed");
    assert.equal(terminal.job.attemptCount,1);
  }else{
    // Existing tenant mutations still require the selected context; the original read below remains cookie-free.
    if(cookieFree)h.worker.setScopedHeaders(h.worker.sharing.headers);
    try{
      const stopped=await h.worker.request("/api/document-jobs/"+encodeURIComponent(h.request.requestId)+"/cancel",{method:"POST"});
      assert.equal(stopped.status,200,await stopped.clone().text());terminal=await stopped.json();
    }finally{if(cookieFree)h.worker.setScopedHeaders({});}
    assert.equal(terminal.job.status,"canceled");assert.equal(terminal.job.attemptCount,0);
  }
  h.store.documentJobs.set([]);
  return{h,preview:fresh.preview,terminal};
}
async function captureInspection(h){
  let raw=null;
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs"||request.body.payload.sceneCostPreview!==true)return;
    const response=await h.worker.request(request.url,request.init);raw=await response.clone().json();return response;
  };
  try{return{inspection:await h.quote(),raw};}finally{h.intercept=null;}
}

for(const shared of [false,true])for(const failed of [false,true]){
  test("R3 real Store carries exact server safe-unused "+(failed?"source failure":"unstarted cancellation")+" in "+(shared?"shared":"personal")+" scope",async t=>{
    const {h,preview}=await retainedScene(t,{shared,failed}),before=h.worker.counts(),writes=h.worker.controls.writes.length,feed=h.store.documentJobs.get(),timers=h.timers.size;
    const {inspection,raw}=await captureInspection(h),proof=inspection.safeUnused;
    assert.ok(isSceneSafeUnusedProof(proof),JSON.stringify(raw));
    assert.deepEqual(proof,raw.sceneCostExisting.safeUnused,"Store forwards the exact response proof without inventing eligibility");
    assert.equal(proof.requestId,h.request.requestId);assert.equal(proof.actorUserId,h.store.session.get().user.userId);
    assert.equal(proof.projectId,h.store.projection.get().projectId);assert.equal(proof.documentId,h.request.documentId);
    assert.equal(proof.permissionEpoch,h.store.session.get().permissionEpoch);
    assert.equal(Boolean(proof.contextSessionId),shared);assert.equal(proof.bindingHash,preview.bindingHash);
    assert.equal(proof.jobStatus,inspection.job.status);assert.equal(proof.jobUpdatedAt,inspection.job.updatedAt);
    assert.equal(proof.attemptCount,inspection.job.attemptCount);assert.equal(inspection.job.leaseExpiresAt,null);
    assert.equal(proof.reason,failed?"source-unavailable-before-dispatch":"canceled-before-start");
    assert.equal(h.store.documentJobs.get(),feed);assert.equal(h.timers.size,timers);
    assert.deepEqual(h.worker.counts(),before);assert.equal(h.worker.controls.writes.length,writes);
    assert.equal(paidRequests(h).length,1);assert.equal(h.request.requestId,h.worker.requestId);
    assert.doesNotMatch(JSON.stringify(h.store.documentJobs.get()),/safeUnused|scene-safe-unused/u);
    assert.equal(h.store.planningConsent.get(),null);
  });
}

test("R3 cookie-free tenant owner reads its exact certificate after cancellation in the existing selected context",async t=>{
  const {h,preview}=await retainedScene(t,{shared:true,cookieFree:true});
  const {inspection,raw}=await captureInspection(h);
  assert.ok(inspection.safeUnused,JSON.stringify(raw));assert.equal(inspection.safeUnused.contextSessionId,null);
  assert.equal(inspection.safeUnused.bindingHash,preview.bindingHash);assert.equal(inspection.job.jobId,h.request.requestId);
  const resource=h.worker.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(h.request.requestId);
  assert.equal(resource.actor_user_id,h.worker.owner);assert.equal(resource.visibility,"actor_private");
  assert.ok(resource.source_event_id,"the original job has its tenant custody anchor");
  assert.equal(h.worker.counts().document_jobs,1);
});

test("R3 malformed, expired, cross-authority or row-mismatched certificate becomes null without hiding the legitimate original job",async t=>{
  const {h}=await retainedScene(t),{raw}=await captureInspection(h);assert.ok(raw.sceneCostExisting.safeUnused);
  const verified=Date.parse(raw.sceneCostExisting.safeUnused.verifiedAt),now=verified+1;t.mock.method(Date,"now",()=>now);
  const mutateProof=change=>body=>{body.sceneCostExisting.safeUnused=change(body.sceneCostExisting.safeUnused);return body;};
  const mutations=[
    ["missing",body=>{delete body.sceneCostExisting.safeUnused;return body;}],
    ["null",mutateProof(()=>null)],
    ["boolean",mutateProof(()=>true)],
    ["array",mutateProof(proof=>[proof])],
    ["extra permission",mutateProof(proof=>({...proof,canStart:true}))],
    ["wrong version",mutateProof(proof=>({...proof,version:"scene-safe-unused-v0"}))],
    ["wrong request",mutateProof(proof=>({...proof,requestId:"another-original-request"}))],
    ["wrong actor",mutateProof(proof=>({...proof,actorUserId:"another-actor"}))],
    ["wrong project",mutateProof(proof=>({...proof,projectId:"another-project"}))],
    ["wrong document",mutateProof(proof=>({...proof,documentId:"another-document"}))],
    ["withdrawn epoch",mutateProof(proof=>({...proof,permissionEpoch:"different-current-epoch"}))],
    ["wrong selected-context posture",mutateProof(proof=>({...proof,contextSessionId:"not-a-personal-context"}))],
    ["wrong original binding",mutateProof(proof=>({...proof,bindingHash:"f".repeat(64)}))],
    ["malformed evidence",mutateProof(proof=>({...proof,evidenceHash:"not-a-hash"}))],
    ["wrong status",mutateProof(proof=>({...proof,jobStatus:"failed"}))],
    ["wrong reason",mutateProof(proof=>({...proof,reason:"no-calls-looking"}))],
    ["wrong attempt count",mutateProof(proof=>({...proof,attemptCount:1}))],
    ["wrong row timestamp",mutateProof(proof=>({...proof,jobUpdatedAt:"2000-01-01T00:00:00.000Z"}))],
    ["future proof",mutateProof(proof=>({...proof,verifiedAt:new Date(now+1_000).toISOString(),expiresAt:new Date(now+2_000).toISOString()}))],
    ["expired proof",mutateProof(proof=>({...proof,verifiedAt:new Date(now-60_000).toISOString(),expiresAt:new Date(now-30_000).toISOString()}))],
    ["overlong validity",mutateProof(proof=>({...proof,expiresAt:new Date(verified+30_001).toISOString()}))],
    ["unbounded expiry",mutateProof(proof=>({...proof,expiresAt:"never"}))],
    ["missing original descriptor",body=>{body.sceneCostExisting.preview=null;return body;}],
    ["changed actual row",body=>{body.job.updatedAt="2000-01-01T00:00:00.000Z";return body;}],
    ["missing actual row timestamp",body=>{delete body.job.updatedAt;return body;}],
    ["changed actual status",body=>{body.job.status="queued";return body;}],
    ["changed actual attempts",body=>{body.job.attemptCount=1;return body;}],
    ["string actual attempts",body=>{body.job.attemptCount="0";return body;}],
    ["held actual lease",body=>{body.job.leaseExpiresAt=new Date(now+10_000).toISOString();return body;}],
    ["expired lease not cleared",body=>{body.job.leaseExpiresAt="2000-01-01T00:00:00.000Z";return body;}],
    ["missing completion",body=>{body.job.completedAt=null;return body;}],
    ["malformed completion",body=>{body.job.completedAt="not-a-date";return body;}],
    ["later completion",body=>{body.job.completedAt=new Date(verified+1).toISOString();return body;}],
  ];
  for(const [label,mutate] of mutations){
    const body=mutate(structuredClone(raw));h.intercept=async()=>Response.json(body);
    const inspection=await h.quote();
    assert.equal(inspection.safeUnused,null,label);assert.equal(inspection.requestId,h.request.requestId,label);
    assert.equal(inspection.job.jobId,h.request.requestId,label+" still readable");
  }
  h.intercept=async()=>Response.json(structuredClone(raw));
  assert.ok((await h.quote()).safeUnused,"the unchanged fresh exact certificate is the positive control");
  assert.equal(paidRequests(h).length,1);
});

test("R3 certificate crossing UTC month boundary is unavailable even inside its thirty-second interval",async t=>{
  const {h}=await retainedScene(t),{raw}=await captureInspection(h),proof=raw.sceneCostExisting.safeUnused;
  assert.ok(proof);const at=new Date(proof.verifiedAt),boundary=Date.UTC(at.getUTCFullYear(),at.getUTCMonth()+1,1);
  const replay=structuredClone(raw);replay.sceneCostExisting.safeUnused={...proof,verifiedAt:new Date(boundary-1_000).toISOString(),expiresAt:new Date(boundary+10_000).toISOString()};
  t.mock.method(Date,"now",()=>boundary+1_000);h.intercept=async()=>Response.json(replay);
  const inspected=await h.quote();assert.equal(inspected.safeUnused,null);assert.equal(inspected.job.jobId,h.request.requestId);
});

test("R3 expiration during the awaited body removes only the fresh certificate, not original read access",async t=>{
  const {h}=await retainedScene(t),{raw}=await captureInspection(h),body=sceneDeferred(),entered=sceneDeferred();
  h.intercept=async()=>({ok:true,status:200,json(){entered.resolve();return body.promise;}});
  const pending=h.quote();await entered.promise;
  const expired=Date.parse(raw.sceneCostExisting.safeUnused.expiresAt)+1;t.mock.method(Date,"now",()=>expired);
  body.resolve(raw);const inspection=await pending;
  assert.equal(inspection.safeUnused,null);assert.equal(inspection.job.jobId,h.request.requestId);
});

for(const change of ["epoch","permissions","route","source","closed"]){
  test("R3 pending original certificate cannot escape after current "+change+" ownership changes",async t=>{
    const {h}=await retainedScene(t),{raw}=await captureInspection(h),body=sceneDeferred(),entered=sceneDeferred();let open=true;
    h.intercept=async()=>({ok:true,status:200,json(){entered.resolve();return body.promise;}});
    const pending=h.store.previewSceneCost(h.request,{current:()=>open});await entered.promise;
    if(change==="epoch")h.setSession({permissionEpoch:"withdrawn-current"});
    if(change==="permissions"){const session=h.store.session.get();h.setSession({capabilities:session.capabilities.filter(capability=>capability!=="project.author")});}
    if(change==="route")h.store.route.set("/library");
    if(change==="source")h.changeText();
    if(change==="closed")open=false;
    body.resolve(raw);await assert.rejects(pending,/scene_cost_changed/u);
    assert.equal(h.store.documentJobs.get().length,0);assert.equal(paidRequests(h).length,1);
    assert.equal(h.request.requestId,h.worker.requestId);
  });
}

for(const status of [401,403,404,410]){
  test("R3 original certificate denial"+status+" never awaits private body or recycles the original ID",async t=>{
    const {h}=await retainedScene(t),{inspection}=await captureInspection(h);assert.ok(inspection.safeUnused);let bodyReads=0;
    h.intercept=async()=>({ok:false,status,json(){bodyReads++;return new Promise(()=>{});}});
    await assert.rejects(h.quote(),/scene_cost_unavailable/u);assert.equal(bodyReads,0);
    assert.equal(h.request.requestId,inspection.requestId);assert.equal(h.worker.counts().document_jobs,1);assert.equal(paidRequests(h).length,1);
  });
}

test("R3 exact current shared-context revocation cannot expose a formerly certified original",async t=>{
  const {h}=await retainedScene(t,{shared:true});assert.ok((await h.quote()).safeUnused);
  h.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),h.worker.sharing.contextId);
  await assert.rejects(h.quote(),/scene_cost_unavailable/u);
  assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().document_jobs,1);
});

test("R3 real held reservation prevents certificate despite terminal canceled status and old zero-looking receipt",async t=>{
  const {h}=await retainedScene(t);assert.ok((await h.quote()).safeUnused);
  const held=await reserveCostBudget(h.worker.env,h.worker.owner,1,{maximumMicrousd:1,allowUserOverage:false,streamId:h.worker.streamId,correlationId:h.request.requestId,operation:"document-render:scene"});
  assert.equal(held.ok,true);
  const before=h.worker.counts(),writes=h.worker.controls.writes.length,inspection=await h.quote();
  assert.equal(inspection.job.status,"canceled");assert.equal(inspection.safeUnused,null);
  assert.deepEqual(h.worker.counts(),before);assert.equal(h.worker.controls.writes.length,writes);assert.equal(paidRequests(h).length,1);
});

test("R3 erased original consent preserves exact recovery but cannot supply a safe-unused certificate",async t=>{
  const {h}=await retainedScene(t);assert.ok((await h.quote()).safeUnused);
  h.worker.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL WHERE job_id=?").run(h.request.requestId);
  const inspection=await h.quote();
  assert.equal(inspection.requestId,h.request.requestId);assert.equal(inspection.job.status,"canceled");
  assert.equal(inspection.preview,null);assert.equal(inspection.safeUnused,null);assert.equal(paidRequests(h).length,1);
});

test("R3 absent server proof is never reconstructed from canceled/failed status, not_submitted text or zero totals",async t=>{
  const {h}=await retainedScene(t),{raw}=await captureInspection(h);
  for(const status of ["canceled","failed"]){
    const body=structuredClone(raw);delete body.sceneCostExisting.safeUnused;body.job.status=status;
    body.job.result={generationReceipt:{provider_request_status:"not_submitted",actual_provider_call_count:0,reservation_microusd:0,settled_cost_microusd:0},errorDetail:{message:"not_submitted"}};
    h.intercept=async()=>Response.json(body);const inspection=await h.quote();
    assert.equal(inspection.job.status,status);assert.equal(inspection.safeUnused,null);
  }
  assert.equal(paidRequests(h).length,1);
});

test("R3 proof is free-response-only and never goes into a reused paid callback or a new request payload",async t=>{
  const {h,preview}=await retainedScene(t),{inspection}=await captureInspection(h);assert.ok(inspection.safeUnused);
  const results=[];assert.equal(await h.approve(preview,{onResult:result=>results.push(result)}),true);
  assert.equal(results.length,1);assert.equal(results[0].requestId,h.request.requestId);assert.equal(results[0].safeUnused,undefined);
  assert.equal(results[0].reused,true);assert.equal(h.worker.counts().document_jobs,1);
  for(const request of h.requests.filter(request=>request.url==="/api/document-jobs")){
    assert.equal(request.body.safeUnused,undefined);assert.equal(request.body.payload.safeUnused,undefined);
    assert.doesNotMatch(JSON.stringify(request.body),/scene-safe-unused-v1/u);
  }
});

for(const shared of [false,true]){
  test("R3 fresh "+(shared?"shared-context":"personal")+" authority may certify the original binding without treating old terms as new approval",async t=>{
    const {h,preview}=await retainedScene(t,{shared});
    h.worker.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(new Date(Date.now()+1_000).toISOString(),h.worker.owner);
    if(shared){
      const selected=await h.worker.request("/api/workspaces/"+h.worker.sharing.organizationId+"/projects/"+h.worker.sharing.projectAccessId+"/context",{method:"POST"});
      assert.equal(selected.status,200,await selected.clone().text());
      h.worker.setScopedHeaders({cookie:selected.headers.get("set-cookie").split(";")[0]});
    }
    const sessionResponse=await h.worker.request("/api/session");assert.equal(sessionResponse.status,200);
    h.store.session.set(await sessionResponse.json());
    assert.notEqual(h.store.session.get().permissionEpoch,preview.permissionEpoch);
    const inspection=await h.quote();assert.ok(inspection.safeUnused);
    assert.equal(inspection.safeUnused.permissionEpoch,h.store.session.get().permissionEpoch);
    assert.equal(inspection.preview.permissionEpoch,preview.permissionEpoch);
    assert.equal(inspection.safeUnused.bindingHash,preview.bindingHash);
    if(shared)assert.notEqual(inspection.safeUnused.contextSessionId,preview.contextSessionId,"renewed current context is not the original purchase context");
    assert.equal(inspection.job.jobId,h.request.requestId);assert.equal(paidRequests(h).length,1);
  });
}

test("R3 real unknown provider checkpoint prevents certificate despite terminal status and zero-looking accounting",async t=>{
  const {h}=await retainedScene(t);assert.ok((await h.quote()).safeUnused);
  const saved=h.worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(h.request.requestId);
  const result=JSON.parse(saved.result_json);result.providerSubmissions={unconfirmed:{status:"pending"}};
  h.worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(result),h.request.requestId);
  const inspection=await h.quote();
  assert.equal(inspection.job.status,"canceled");assert.equal(inspection.safeUnused,null);
  assert.equal(h.worker.counts().document_jobs,1);assert.equal(paidRequests(h).length,1);
});
