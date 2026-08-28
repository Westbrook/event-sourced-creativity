import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { isSceneCostPreview, sceneCostRequestHash } from "../src/model/scene-cost-consent.ts";

function noNetwork(t) {
  t.mock.method(globalThis,"fetch",async()=>{assert.fail("Free inspection and admission cannot call a provider or model-health endpoint");});
}
function sceneProvider(t,{bad=false,beforeReply}={}) {
  const requests=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const request=JSON.parse(init.body),input=JSON.parse(request.input);
    requests.push({request,input});await beforeReply?.(requests.length);
    const items=input.production.assigned_scenes.map(scene=>({
      title:scene.title,body:scene.action,notes:"The keeper checks the harbor.",image_prompt:"",
      context_group_ids:bad?[]:input.combined_context_plan.map(group=>group.context_key),slide:null,
    }));
    return Response.json({id:"scene-response-"+requests.length,model:"gpt-5.6-terra",
      output_text:JSON.stringify({title:"Complete saved-source scene",summary:"The complete harbor narrative.",
        content_markdown:items.map(item=>item.body).join("\n\n"),presentation:null,items}),
      usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  });
  return requests;
}

for(const medium of ["visual","audio"])for(const count of [1,9,17]){
  test(medium+" Scene "+count+" retained parts: free exact-source ceiling equals admitted original receipt",async t=>{
    noNetwork(t);
    const fixture=await createSceneCostFixture(count,medium,{depth:count===9});
    try{
      const originalKey=fixture.env.OPENAI_API_KEY;delete fixture.env.OPENAI_API_KEY;
      const before=fixture.counts(),writes=fixture.controls.writes.length;
      const inspected=await fixture.preview();
      assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
      assert.deepEqual(fixture.counts(),before);assert.equal(fixture.controls.writes.length,writes);
      assert.equal(inspected.body.providerCalls,0);assert.equal(inspected.body.reservations,0);
      const preview=inspected.body.sceneCostPreview;
      assert.ok(isSceneCostPreview(preview));assert.equal(preview.itemCount,count);
      assert.equal(preview.providerCallCount,Math.ceil(count/8));assert.equal(preview.maximumProviderCallCount,4*Math.ceil(count/8));
      assert.equal(preview.maximumMicrousd,1_000_000*Math.ceil(count/8));assert.equal(preview.reusedSourceCount,1);
      assert.equal(preview.requestHash,await sceneCostRequestHash({...fixture.payload,documentId:fixture.documentId,requestId:fixture.requestId}));
      assert.doesNotMatch(JSON.stringify(preview),/keeper|harbor|Saved complete story|facts|private_content/u);
      fixture.env.OPENAI_API_KEY=originalKey;
      const admitted=await fixture.approve(preview);
      assert.equal(admitted.response.status,202,JSON.stringify(admitted.body));
      assert.equal(admitted.body.job.jobId,fixture.requestId);
      const receipt=admitted.body.job.result.generationReceipt;
      assert.equal(receipt.planned_provider_call_count,preview.providerCallCount);
      assert.equal(receipt.maximum_provider_call_count,preview.maximumProviderCallCount);
      assert.equal(receipt.maximum_authorized_cost_microusd,preview.maximumMicrousd);
      assert.equal(receipt.scene_medium,medium);
      assert.equal(fixture.counts().budget_reservations,0);assert.equal(fixture.counts().cost_budget_reservations,0);
    }finally{fixture.close();}
  });
}

test("missing, modified, malformed or different-request Scene approval cannot create a job",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    for(const consent of [undefined,{...preview,confirmed:false},{...preview,confirmed:true,maximumMicrousd:1_000_000},{...preview,confirmed:true,bindingHash:"0".repeat(64)},{...preview,confirmed:true,requestId:"another-original-request"},{...preview,confirmed:true,extra:true}]){
      const result=await f.submit({...f.payload,sceneCostConsent:consent});
      assert.ok(result.status>=400);assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().budget_reservations,0);
    }
  }finally{f.close();}
});

test("source content changed after free inspection cannot buy a larger Scene",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.content.replace("position 1.","another position."),f.contentRef);
    const result=await f.approve(preview);
    assert.ok(result.response.status>=400);assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().cost_budget_reservations,0);
    assert.notEqual(result.body.submission,"not-submitted","the error does not certify any original lost request unused");
  }finally{f.close();}
});

test("current actor permission withdrawal after inspection prevents Scene admission",async t=>{
  noNetwork(t);const f=await createSceneCostFixture();
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    f.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id=?").run("2026-08-27T18:00:00.000Z",f.owner);
    const result=await f.approve(preview);assert.ok(result.response.status>=400);
    assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

test("the exact-source SQL guard rejects replacement after final preparation and private receipt creation",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(17,"visual",{depth:true});
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    let intercepted=false;
    f.controls.beforeRun=async statement=>{
      if(intercepted||!/INSERT(?: OR IGNORE)? INTO document_jobs/u.test(statement.sql))return;
      intercepted=true;f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.contentRef);
    };
    const result=await f.approve(preview);
    assert.equal(intercepted,true);assert.ok(result.response.status>=400);assert.equal(f.counts().document_jobs,0);
    assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

test("simultaneous same-human-request submissions atomically adopt one original job",async t=>{
  noNetwork(t);const f=await createSceneCostFixture();
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    const results=await Promise.all([f.approve(preview),f.approve(preview)]);
    assert.ok(results.every(result=>result.response.status===202),JSON.stringify(results.map(x=>x.body)));
    assert.ok(results.every(result=>result.body.job.jobId===f.requestId));
    assert.equal(f.counts().document_jobs,1);
    const saved=JSON.parse(f.sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(f.requestId).request_json);
    assert.equal(saved.sceneCostConsent.bindingHash,preview.bindingHash);
  }finally{f.close();}
});

test("every original job status survives lost admission, source/model changes and erased request_json without repurchase",async t=>{
  noNetwork(t);const f=await createSceneCostFixture();
  try{
    const preview=(await f.preview()).body.sceneCostPreview;assert.equal((await f.approve(preview)).response.status,202);
    f.env.OPENAI_MODEL="changed-model";delete f.env.OPENAI_API_KEY;
    f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.contentRef);
    for(const status of ["queued","running","committing","completed","partial","failed","canceled"]){
      f.sqlite.prepare("UPDATE document_jobs SET status=? WHERE job_id=?").run(status,f.requestId);
      const result=await f.preview({sceneMedium:"audio",tone:"Newer settings"});
      assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.job.jobId,f.requestId);
      assert.equal(result.body.job.status,status);assert.equal(result.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);
      assert.equal(result.body.sceneCostPreview,undefined);assert.equal(f.counts().document_jobs,1);
    }
    f.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,expires_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(f.requestId);
    const expired=await f.preview();assert.equal(expired.response.status,200,JSON.stringify(expired.body));
    assert.equal(expired.body.sceneCostExisting.preview,null);assert.equal(expired.body.job.jobId,f.requestId);assert.equal(f.counts().document_jobs,1);
    const paidRetry=await f.approve(preview);assert.equal(paidRetry.response.status,202);
    assert.equal(paidRetry.body.job.jobId,f.requestId);assert.equal(paidRetry.body.sceneCostExisting.preview,null);
  }finally{f.close();}
});

test("wrong actor, document and absent read authority never expose a retained Scene receipt",async t=>{
  noNetwork(t);const f=await createSceneCostFixture();
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    for(const [field,value] of [["owner_id","different-actor"],["stream_id","creative:different-owner"],["document_id","different-document"]]){
      const old=f.sqlite.prepare("SELECT "+field+" AS value FROM document_jobs WHERE job_id=?").get(f.requestId).value;
      f.sqlite.prepare("UPDATE document_jobs SET "+field+"=? WHERE job_id=?").run(value,f.requestId);
      const denied=await f.preview();assert.ok(denied.response.status>=400);assert.equal(denied.body.job,undefined);
      assert.equal(denied.body.submission,undefined);
      f.sqlite.prepare("UPDATE document_jobs SET "+field+"=? WHERE job_id=?").run(old,f.requestId);
    }
    f.sqlite.prepare("UPDATE users SET consent_version='' WHERE user_id=?").run(f.owner);
    const denied=await f.preview();assert.ok(denied.response.status>=400);assert.equal(denied.body.job,undefined);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])for(const count of [1,9,17]){
  test(medium+" Scene "+count+" parts actual admitted worker dispatch stays within original call and spend limits",async t=>{
    const f=await createSceneCostFixture(count,medium,{depth:count===9}),calls=sceneProvider(t);
    try{
      const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
      const result=await f.run();assert.equal(result.response.status,200,JSON.stringify(result.body));
      assert.equal(result.body.job.status,"completed",result.body.job.error);
      assert.equal(calls.length,preview.providerCallCount);assert.ok(calls.length<=preview.maximumProviderCallCount);
      assert.ok(calls.every(call=>call.input.scene_configuration.medium===medium));
      const receipt=result.body.job.result.generationReceipt;
      assert.equal(receipt.maximum_authorized_cost_microusd,preview.maximumMicrousd);assert.ok(receipt.settled_cost_microusd<=preview.maximumMicrousd);
      assert.equal(receipt.actual_provider_call_count,calls.length);
      const recovered=await f.preview();
      assert.equal(recovered.body.job.status,"completed");assert.equal(recovered.body.job.jobId,f.requestId);
      assert.equal(recovered.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);assert.equal(calls.length,preview.providerCallCount);
    }finally{f.close();}
  });
}

test("source changes during the awaited pending checkpoint prevent the first provider call and retain an exact job",async t=>{
  const f=await createSceneCostFixture(9),calls=sceneProvider(t);let intercepted=false;
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    f.controls.beforeRun=async statement=>{
      if(intercepted||!statement.sql.startsWith("UPDATE document_jobs SET result_json=")||!statement.values.some(value=>typeof value==="string"&&value.includes('"status":"pending"')))return;
      intercepted=true;f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.contentRef);
    };
    const result=await f.run();assert.equal(intercepted,true);assert.equal(calls.length,0);assert.equal(result.body.job.status,"failed");
    const saved=JSON.parse(f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.requestId).result_json);
    assert.ok(Object.values(saved.providerSubmissions??{}).every(receipt=>receipt.status==="rejected"&&receipt.costMicrousd===0));
    assert.equal(f.counts().document_jobs,1);
    const recovered=await f.preview();assert.equal(recovered.body.job.jobId,f.requestId);assert.equal(recovered.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);
  }finally{f.close();}
});

test("known pricing caps remain enforced even when a provider returns repeatedly invalid Scene output",async t=>{
  const f=await createSceneCostFixture(9),calls=sceneProvider(t,{bad:true});
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    const result=await f.run();assert.equal(result.body.job.status,"failed");
    assert.ok(calls.length>0);assert.ok(calls.length<=preview.maximumProviderCallCount);
    assert.ok(result.body.job.result.generationReceipt.settled_cost_microusd<=preview.maximumMicrousd);
    const retained=await f.preview();assert.equal(retained.body.job.jobId,f.requestId);assert.equal(f.counts().document_jobs,1);
  }finally{f.close();}
});

test("shared author can refresh a stale derived index through native read and re-inspect without writes or an endless loop",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9,"audio",{shared:true,depth:true});
  try{
    const stale=await f.preview();assert.equal(stale.body.error,"project_source_index_stale");
    assert.equal((await f.request("/api/events?after=0&limit=2000&content=0")).status,200);
    let writeCount=f.controls.writes.length,prepared=await f.preview();assert.equal(prepared.response.status,200,JSON.stringify(prepared.body));assert.equal(f.controls.writes.length,writeCount);
    await appendAuditEvent(f.env,f.streamId,"user","ProjectCreated",{project_id:"unrelated-owner-project",name:"Unrelated"});
    assert.equal((await f.preview()).body.error,"project_source_index_stale");
    await f.request("/api/events?after=0&limit=2000&content=0");
    writeCount=f.controls.writes.length;prepared=await f.preview();assert.equal(prepared.response.status,200,JSON.stringify(prepared.body));assert.equal(f.controls.writes.length,writeCount);
    const admitted=await f.approve(prepared.body.sceneCostPreview);assert.equal(admitted.response.status,202,JSON.stringify(admitted.body));
    const recovered=await f.preview();assert.equal(recovered.response.status,200,JSON.stringify(recovered.body));assert.equal(recovered.body.job.jobId,f.requestId);
    assert.ok(Math.max(...f.controls.bindings)<=100);
  }finally{f.close();}
});

test("shared Scene dispatch uses the original selected source and guarded reservation under native depth100",async t=>{
  const f=await createSceneCostFixture(17,"audio",{shared:true,depth:true}),calls=sceneProvider(t);
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    const inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
    const approved=await f.approve(inspected.body.sceneCostPreview);assert.equal(approved.response.status,202,JSON.stringify(approved.body));
    const result=await f.run();assert.equal(result.body.job.status,"completed",result.body.job.error);
    assert.equal(calls.length,3);const reservation=f.sqlite.prepare("SELECT reserved_microusd,used_microusd FROM cost_budget_reservations WHERE owner_id=? AND operation='document-render:scene'").get(f.owner);assert.equal(reservation.reserved_microusd,3_000_000);assert.ok(reservation.used_microusd<=3_000_000);
    assert.ok(Math.max(...f.controls.bindings)<=100);
  }finally{f.close();}
});

test("renewed current read authority recovers the original Scene without using it as new authoring consent",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9,"visual",{shared:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    const preview=(await f.preview()).body.sceneCostPreview;assert.equal((await f.approve(preview)).response.status,202);
    f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run("2026-08-27T19:50:00.000Z",f.owner);
    const read=await f.preview();assert.equal(read.response.status,200,JSON.stringify(read.body));
    assert.equal(read.body.job.jobId,f.requestId);assert.equal(read.body.sceneCostExisting.preview.permissionEpoch,preview.permissionEpoch);
    f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.sharing.contextId);
    const denied=await f.preview();assert.ok(denied.response.status>=400);assert.equal(denied.body.job,undefined);assert.equal(denied.body.submission,undefined);
    assert.equal(f.counts().document_jobs,1);
  }finally{f.close();}
});

test("shared source/session changes after source rows are read fail closed without synchronizing or buying",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9,"audio",{shared:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    let changed=false;const writes=f.controls.writes.length;
    f.controls.afterRead=async statement=>{
      if(changed||!statement.sql.includes("FROM project_event_scopes scope"))return;
      changed=true;f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.sharing.contextId);
    };
    const inspected=await f.preview();assert.equal(changed,true);assert.ok(inspected.response.status>=400);
    assert.equal(inspected.body.sceneCostPreview,undefined);assert.equal(f.controls.writes.length,writes);
    assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

test("shared source loss between final inspection and atomic insertion cannot queue a job",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9,"visual",{shared:true,depth:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    const preview=(await f.preview()).body.sceneCostPreview;let changed=false;
    f.controls.beforeBatch=async statements=>{
      if(changed||!statements.some(statement=>statement.sql.includes("INSERT OR IGNORE INTO document_jobs")))return;
      changed=true;f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.sharing.contextId);
    };
    const admitted=await f.approve(preview);assert.equal(changed,true);assert.ok(admitted.response.status>=400);
    assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

test("source expiry after admission refuses actual dispatch before any provider or budget reservation",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(f.contentRef);
    const result=await f.run();assert.equal(result.body.job.status,"failed");
    assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
    const retained=await f.preview();assert.equal(retained.body.job.jobId,f.requestId);
  }finally{f.close();}
});

test("permission withdrawn during the pending provider checkpoint is a zero-call refusal, not an automatic replacement",async t=>{
  const f=await createSceneCostFixture(9),calls=sceneProvider(t);let changed=false;
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    f.controls.beforeRun=async statement=>{
      if(changed||!statement.sql.startsWith("UPDATE document_jobs SET result_json=")||!statement.values.some(value=>typeof value==="string"&&value.includes('"status":"pending"')))return;
      changed=true;f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run("2026-08-27T20:00:00.000Z",f.owner);
    };
    const result=await f.run();assert.equal(changed,true);assert.equal(calls.length,0);assert.equal(result.body.job.status,"failed");
    assert.equal(f.counts().document_jobs,1);
  }finally{f.close();}
});

test("after exact completed recovery a deliberate fresh request has its own newly confirmed ceiling",async t=>{
  const f=await createSceneCostFixture(1),calls=sceneProvider(t);
  try{
    const first=(await f.preview()).body.sceneCostPreview;await f.approve(first);assert.equal((await f.run()).body.job.status,"completed");
    const retained=await f.preview();assert.equal(retained.body.job.status,"completed");assert.equal(retained.body.job.jobId,f.requestId);
    // Deliberate second authored request, with no completed production stage selected.
    const nextRequestId="scene-explicit-next-"+crypto.randomUUID();
    const next={...f.payload,sceneRequestId:nextRequestId,workflowId:undefined,workflowStageId:undefined,workflowSources:undefined};
    const quote=await f.preview(next);assert.equal(quote.response.status,200,JSON.stringify(quote.body));assert.notEqual(quote.body.sceneCostPreview.bindingHash,first.bindingHash);
    const nextJob=await f.approve(quote.body.sceneCostPreview,next);assert.equal(nextJob.response.status,202,JSON.stringify(nextJob.body));
    assert.equal(nextJob.body.job.jobId,nextRequestId);assert.equal(f.counts().document_jobs,2);assert.equal(calls.length,1,"free next inspection never starts its provider");
  }finally{f.close();}
});

test("selecting another current project cannot retrieve an original Scene job from the previous scope",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(1,"visual",{shared:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    f.setScopedHeaders({});
    await appendAuditEvent(f.env,f.streamId,"user","ProjectCreated",{project_id:"another-scene-project",name:"Another"});
    const created=await f.request("/api/workspaces/"+f.sharing.organizationId+"/projects",f.json({projectId:"another-scene-project"}));
    assert.equal(created.status,201,await created.clone().text());const other=(await created.json()).projectAccessId;
    const selected=await f.request("/api/workspaces/"+f.sharing.organizationId+"/projects/"+other+"/context",{method:"POST"});
    assert.equal(selected.status,200);f.setScopedHeaders({cookie:selected.headers.get("set-cookie").split(";")[0]});
    const denied=await f.preview();assert.ok(denied.response.status>=400);assert.equal(denied.body.job,undefined);
    assert.equal(denied.body.sceneCostExisting,undefined);assert.equal(denied.body.submission,undefined);assert.equal(f.counts().document_jobs,1);
  }finally{f.close();}
});

test("changing configured model after inspection cannot use the old displayed ceiling for a new purchase",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;f.env.OPENAI_MODEL="gpt-5.6-sol";
    const refused=await f.approve(preview);assert.ok(refused.response.status>=400);assert.equal(f.counts().document_jobs,0);
    const refreshed=await f.preview();assert.equal(refreshed.response.status,200);assert.equal(refreshed.body.sceneCostPreview.model,"gpt-5.6-sol");
    assert.equal(refreshed.body.sceneCostPreview.requestId,f.requestId);assert.notEqual(refreshed.body.sceneCostPreview.bindingHash,preview.bindingHash);
  }finally{f.close();}
});

test("manual Scene control uses its same one-request/two-attempt bound with a current authorized reused source",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(17,"audio");
  try{
    const inspected=await f.preview({productionMode:"manual"});assert.equal(inspected.response.status,200);
    const preview=inspected.body.sceneCostPreview;assert.equal(preview.providerCallCount,1);assert.equal(preview.maximumProviderCallCount,2);assert.equal(preview.maximumMicrousd,1_000_000);
    const admitted=await f.approve(preview,{productionMode:"manual"});assert.equal(admitted.response.status,202,JSON.stringify(admitted.body));
    assert.equal(admitted.body.job.result.generationReceipt.maximum_provider_call_count,2);assert.equal(admitted.body.job.result.generationReceipt.maximum_authorized_cost_microusd,1_000_000);
  }finally{f.close();}
});

test("parallel shared Scene approvals use existing idempotent custody insertion and recover one original anchor",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9,"audio",{shared:true,depth:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    const preview=(await f.preview()).body.sceneCostPreview;
    const results=await Promise.all([f.approve(preview),f.approve(preview)]);
    assert.ok(results.some(result=>result.response.status===202));
    assert.ok(results.every(result=>result.response.status===202||result.response.status===403||result.response.status===409));
    assert.equal(f.counts().document_jobs,1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(f.requestId).count,1);
    const retained=await f.preview();assert.equal(retained.response.status,200,JSON.stringify(retained.body));
    assert.equal(retained.body.job.jobId,f.requestId);assert.equal(retained.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);
    assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

for(const boundary of ["private-source","selected-context","source-license"]){
  test(boundary+" expiry while the final SQL result is in transit blocks the first provider call",async t=>{
    const now=Date.now(),expiresAt=new Date(now+60_000).toISOString();
    const f=await createSceneCostFixture(9,"audio",{shared:boundary!=="private-source",rightsDeadline:boundary==="source-license"?expiresAt:null}),calls=sceneProvider(t);
    try{
      if(f.sharing)await f.request("/api/events?after=0&limit=2000&content=0");
      if(boundary==="private-source")f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expiresAt,f.contentRef);
      if(boundary==="selected-context")f.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(expiresAt,f.sharing.contextId);
      const inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
      assert.equal((await f.approve(inspected.body.sceneCostPreview)).response.status,202);
      let finalReads=0,expired=false;
      f.controls.afterRead=async statement=>{
        if(expired||!statement.sql.startsWith("SELECT 1 AS current,"))return;
        const job=f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.requestId);
        if(!job?.result_json.includes('"status":"pending"'))return;
        finalReads++;
        if(finalReads===1){expired=true;t.mock.method(Date,"now",()=>now+60_001);}
      };
      const result=await f.run();assert.equal(expired,true);assert.equal(calls.length,0);
      assert.equal(result.body.job.status,"failed");assert.equal(f.counts().document_jobs,1);
    }finally{f.close();}
  });
}

test("a long-enough authorized source deadline allows normal Scene dispatch",async t=>{
  const f=await createSceneCostFixture(9),calls=sceneProvider(t);
  try{
    f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now()+3_600_000).toISOString(),f.contentRef);
    const quote=(await f.preview()).body.sceneCostPreview;await f.approve(quote);
    const completed=await f.run();assert.equal(completed.body.job.status,"completed",completed.body.job.error);assert.equal(calls.length,2);
  }finally{f.close();}
});

test("existing legal hold permits expired retained source bytes, but never extends source-license expiry",async t=>{
  const now=Date.now(),expiresAt=new Date(now+60_000).toISOString();
  const f=await createSceneCostFixture(1,"audio",{shared:true,rightsDeadline:expiresAt}),calls=sceneProvider(t);
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");
    f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(f.contentRef);
    f.sqlite.prepare("INSERT INTO organization_legal_holds(hold_id,organization_id,scope_kind,resource_id,reason,status,created_by_user_id,created_at) VALUES(?,?,'content',?,?,'active',?,?)")
      .run("scene-held-retention",f.sharing.organizationId,f.contentRef,"Retain original authorized evidence",f.owner,new Date().toISOString());
    const preview=await f.preview();assert.equal(preview.response.status,200,JSON.stringify(preview.body));
    const quote=preview.body.sceneCostPreview;assert.equal((await f.approve(quote)).response.status,202);
    assert.equal((await f.run()).body.job.status,"completed");assert.equal(calls.length,1);
    const next={...f.payload,sceneRequestId:"held-retention-new-request",workflowId:undefined,workflowStageId:undefined,workflowSources:undefined};
    t.mock.method(Date,"now",()=>now+60_001);
    const refused=await f.preview(next);assert.ok(refused.response.status>=400);assert.equal(refused.body.sceneCostPreview,undefined);assert.equal(calls.length,1);
  }finally{f.close();}
});

test("expired request details are content-free even before normal cleanup clears private columns",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(1);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00Z',result_json=?,error_message=? WHERE job_id=?")
      .run(JSON.stringify({privateSentinel:"NEVER_EXPOSE_EXPIRED_SCENE_PRIVATE_BODY"}),"NEVER_EXPOSE_EXPIRED_SCENE_PRIVATE_ERROR",f.requestId);
    const retained=await f.preview();assert.equal(retained.response.status,200);
    assert.equal(retained.body.job.jobId,f.requestId);assert.equal(retained.body.sceneCostExisting.preview,null);
    assert.doesNotMatch(JSON.stringify(retained.body),/NEVER_EXPOSE_EXPIRED_SCENE_PRIVATE/u);
    assert.equal(f.counts().document_jobs,1);
  }finally{f.close();}
});

test("a Scene approval cannot bypass its durable original job through direct event execution",async t=>{
  noNetwork(t);const f=await createSceneCostFixture(9);
  try{
    const preview=(await f.preview()).body.sceneCostPreview;
    const response=await f.request("/api/events",f.json({...f.payload,action:"render_document",documentId:f.documentId,sceneCostConsent:{...preview,confirmed:true}}));
    assert.equal(response.status,428);assert.equal((await response.json()).error,"scene_job_required");
    assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
    assert.equal((await f.approve(preview)).response.status,202,"the same exact approved request still works through the durable executor");
    const replay=await f.request("/api/events",f.json({...f.payload,action:"render_document",documentId:f.documentId,sceneCostConsent:{...preview,confirmed:true}}));
    assert.equal(replay.status,428);assert.equal(f.counts().document_jobs,1);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{f.close();}
});

test("a source lost after one paid page retains that original verified spend and never starts the next page",async t=>{
  const f=await createSceneCostFixture(9),calls=sceneProvider(t,{beforeReply(count){
    if(count===1)f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(f.contentRef);
  }});
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);
    const result=await f.run();assert.equal(result.body.job.status,"failed");assert.equal(calls.length,1);
    const receipt=result.body.job.result.generationReceipt;
    assert.equal(receipt.actual_provider_call_count,1);assert.equal(receipt.unresolved_provider_call_count,0);
    assert.equal(receipt.provider_submission_uncertain,false);assert.equal(receipt.reservation_status,"settled");
    assert.ok(receipt.settled_cost_microusd>0);assert.ok(receipt.settled_cost_microusd<=preview.maximumMicrousd);
    const retained=await f.preview();assert.equal(retained.body.job.jobId,f.requestId);
    assert.equal(retained.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);assert.equal(f.counts().document_jobs,1);assert.equal(calls.length,1);
  }finally{f.close();}
});
