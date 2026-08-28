import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { sceneCostRequestHash } from "../src/model/scene-cost-consent.ts";

const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("This Store test cannot contact a provider, model-health API or external host"));
const postRequests=host=>host.requests.filter(request=>request.url==="/api/document-jobs");
const paidRequests=host=>postRequests(host).filter(request=>request.body.payload.sceneCostPreview!==true);
const freeRequests=host=>postRequests(host).filter(request=>request.body.payload.sceneCostPreview===true);
const resultPort=()=>{const results=[];return{results,onResult:result=>results.push(result)};};
async function hostFor(t,options){noProviders(t);const host=await createSceneStoreHost(options);t.after(()=>host.close());return host;}
const noJob=host=>{assert.equal(host.worker.counts().document_jobs,0);assert.equal(paidRequests(host).length,0);};

for(const medium of ["visual","audio"])for(const count of [1,9,17]){
  test("actual Store "+medium+" "+count+"-part free quote and exact paid admission use authoritative source/call ceiling",async t=>{
    const h=await hostFor(t,{medium,count}),feed=h.store.documentJobs.get(),timers=h.timers.size,writes=h.worker.controls.writes.length,before=h.worker.counts();
    const key=h.worker.env.OPENAI_API_KEY;delete h.worker.env.OPENAI_API_KEY;
    const inspected=await h.quote(),preview=inspected.preview;
    assert.equal(inspected.job,null);assert.equal(inspected.requestId,h.request.requestId);
    assert.equal(preview.itemCount,count);assert.equal(preview.providerCallCount,Math.ceil(count/8));
    assert.equal(preview.maximumProviderCallCount,4*Math.ceil(count/8));assert.equal(preview.maximumMicrousd,1_000_000*Math.ceil(count/8));
    assert.equal(preview.requestHash,await sceneCostRequestHash(h.request));assert.equal(preview.reusedSourceCount,1);
    assert.equal(h.store.documentJobs.get(),feed);assert.equal(h.timers.size,timers);assert.equal(h.worker.controls.writes.length,writes);assert.deepEqual(h.worker.counts(),before);
    assert.equal(h.dialog(),null);assert.equal(h.store.ui.impersonationConfirmOpen,false);
    h.worker.env.OPENAI_API_KEY=key;const port=resultPort();let dispatched=0;
    assert.equal(await h.approve(preview,{onResult:port.onResult,onDispatch(){dispatched++;}}),true);
    assert.equal(dispatched,1);assert.equal(port.results.length,1);assert.equal(port.results[0].attemptSubmission,"submitted");
    assert.equal(port.results[0].job.jobId,h.request.requestId);assert.equal(port.results[0].preview.bindingHash,preview.bindingHash);
    const sent=paidRequests(h)[0].body;assert.equal(sent.payload.sceneRequestId,h.request.requestId);assert.deepEqual(sent.payload.sceneCostConsent,{...preview,confirmed:true});
    assert.equal(sent.payload.itemCount,undefined,"planned effective count never rewrites the requested count");
    assert.equal(sent.payload.current,undefined);assert.equal(sent.payload.onDispatch,undefined);assert.equal(sent.payload.onResult,undefined);
    assert.equal(sent.payload.sourceBlockVersions[0].block_id,"scene-reuse-direction");
    const receipt=port.results[0].job.result.generationReceipt;
    assert.equal(receipt.maximum_authorized_cost_microusd,preview.maximumMicrousd);assert.equal(receipt.maximum_provider_call_count,preview.maximumProviderCallCount);
    assert.equal(h.worker.counts().document_jobs,1);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
  });
}

test("actual Store keeps requested count1 distinct from server effective count17",async t=>{
  const h=await hostFor(t,{count:17});h.request.itemCount=1;
  const {preview}=await h.quote();assert.equal(preview.itemCount,17);assert.equal(freeRequests(h)[0].body.payload.itemCount,1);
  assert.equal(await h.approve(preview),true);assert.equal(paidRequests(h)[0].body.payload.itemCount,1);
});

test("manual Scene uses exact current one-call/two-attempt ceiling without authored-block fallback",async t=>{
  const h=await hostFor(t,{count:17,medium:"audio"});h.request.productionMode="manual";
  const {preview}=await h.quote();assert.equal(preview.providerCallCount,1);assert.equal(preview.maximumProviderCallCount,2);assert.equal(preview.maximumMicrousd,1_000_000);
  assert.equal(h.store.sceneEstimateForTest({artifactKind:"scene",sceneCostConsent:{...preview,confirmed:true},snapshot:{facts:[]}}),1_000_000);
  assert.throws(()=>h.store.sceneEstimateForTest({artifactKind:"scene",snapshot:{facts:[]}}),/scene_cost_confirmation_required/u);
  assert.equal(await h.approve(preview),true);
});

test("read-only source closure detects current route, text, rights, selected bytes, workflow, model and exact authority",async t=>{
  const h=await hostFor(t),savedSession=h.store.session.get(),savedEvents=h.store.events.get(),savedContent=h.store.content.get(),savedRoute=h.store.route.get();
  const mutations=[
    ["route",()=>h.store.route.set("/library")],
    ["auth",()=>h.setSession({permissionEpoch:"different-current-epoch"})],
    ["permissions",()=>h.setSession({capabilities:savedSession.capabilities.filter(value=>value!=="project.read")})],
    ["model",()=>h.setSession({provider:{...savedSession.provider,plannerModel:"gpt-5.6-sol"}})],
    ["source",()=>h.changeText()],
    ["selected retained bytes",()=>h.store.content.set({...savedContent,[h.worker.contentRef]:"changed retained source"})],
    ["workflow",()=>h.store.events.set([...savedEvents,{...savedEvents.at(-1),eventId:"workflow-new-revision",sequence:999,type:"DocumentProductionWorkflowConfigured",payload:{...savedEvents.find(event=>event.type==="DocumentProductionWorkflowConfigured").payload}}])],
    ["title",()=>h.store.events.set(savedEvents.map(event=>event.type==="DocumentCreated"&&event.payload.document_id===h.worker.documentId?{...event,payload:{...event.payload,title:"Changed title"}}:event))],
    ["source rights",()=>h.store.events.set(savedEvents.map(event=>event.type==="BlockCreated"&&event.payload.block_id==="scene-reuse-direction"?{...event,payload:{...event.payload,properties:{...event.payload.properties,license_expires_at:"2000-01-01T00:00:00Z"}}}:event))],
  ];
  for(const [label,mutate]of mutations){
    const current=h.store.captureSceneCostSource(h.request);assert.equal(current(),true,label+" healthy");mutate();assert.equal(current(),false,label);
    h.store.session.set(savedSession);h.store.events.set(savedEvents);h.store.content.set(savedContent);h.store.route.set(savedRoute);
  }
  assert.equal(h.requests.length,0,"capturing and checking source evidence never performs HTTP");
});

for(const gate of ["append","navigation"]){
  test("free quote closes at actual "+gate+" await before HTTP",async t=>{
    const h=await hostFor(t),wait=sceneDeferred();h.store.sceneGateForTest(gate,wait.promise);let current=true,checks=0;
    const task=h.store.previewSceneCost(h.request,{current:()=>{checks++;return current;}});
    await untilScene(()=>checks>0);current=false;wait.resolve(true);
    await assert.rejects(task,/scene_cost_changed/u);assert.equal(h.requests.length,0);noJob(h);
  });
  test("healthy free quote resumes through actual "+gate+" await with same identity",async t=>{
    const h=await hostFor(t),wait=sceneDeferred();h.store.sceneGateForTest(gate,wait.promise);
    const task=h.quote();assert.equal(h.requests.length,0);wait.resolve(true);
    assert.equal((await task).preview.requestId,h.request.requestId);assert.equal(freeRequests(h).length,1);
  });
}

for(const change of ["authority","route","source","closed"]){
  test("free quote late body cannot expose old private terms after "+change,async t=>{
    const h=await hostFor(t),body=sceneDeferred(),entered=sceneDeferred();let current=true;
    let saved;
    h.intercept=async request=>{const response=await h.worker.request(request.url,request.init);saved=await response.json();return{ok:true,status:200,json(){entered.resolve();return body.promise;}};};
    const task=h.store.previewSceneCost(h.request,{current:()=>current});await entered.promise;
    if(change==="authority")h.setSession({permissionEpoch:"withdrawn"});
    if(change==="route")h.store.route.set("/library");
    if(change==="source")h.changeText();
    if(change==="closed")current=false;
    body.resolve(saved);await assert.rejects(task,/scene_cost_changed/u);
    assert.equal(h.store.documentJobs.get().length,0);assert.equal(paidRequests(h).length,0);
  });
}

for(const status of [401,403,404,410]){
  test("free denial"+status+" is recognized at headers without waiting for a body",async t=>{
    const h=await hostFor(t);let bodyReads=0;
    h.intercept=async()=>({ok:false,status,json(){bodyReads++;return new Promise(()=>{});}});
    await assert.rejects(h.quote(),/scene_cost_unavailable/u);assert.equal(bodyReads,0);assert.equal(h.request.requestId,h.worker.requestId);noJob(h);
  });
}

test("shared project_source_index_stale remains repairable through actual normal read then explicit free inspection",async t=>{
  const h=await hostFor(t,{shared:true,medium:"audio"});
  await appendAuditEvent(h.worker.env,h.worker.streamId,"user","ProjectCreated",{project_id:"unrelated-new-project",name:"Unrelated"});
  await assert.rejects(h.quote(),/project_source_index_stale/u);assert.equal(freeRequests(h).length,1);noJob(h);
  await h.store.refreshEvents();assert.ok(h.requests.some(request=>request.url.startsWith("/api/events?")));
  assert.equal(freeRequests(h).length,1,"normal refresh does not automatically inspect or purchase");
  const writes=h.worker.controls.writes.length,quote=await h.quote();
  assert.equal(quote.preview.requestId,h.request.requestId);assert.equal(h.worker.controls.writes.length,writes);assert.equal(freeRequests(h).length,2);noJob(h);
});

test("fresh malformed descriptor, changed destination and request-hash mismatch never become approval",async t=>{
  const h=await hostFor(t),actual=await h.quote();
  for(const mutate of [preview=>({...preview,extra:true}),preview=>({...preview,documentId:"other-document"}),preview=>({...preview,requestId:"other-request"}),preview=>({...preview,requestHash:"0".repeat(64)}),preview=>({...preview,actorUserId:"other-actor"}),preview=>({...preview,maximumMicrousd:1})]){
    h.intercept=async()=>Response.json({sceneCostPreview:mutate(actual.preview),providerCalls:0,reservations:0});
    await assert.rejects(h.quote(),/scene_cost_changed/u);
  }
  assert.equal(paidRequests(h).length,0);
});

test("paid Scene missing approval and old quoted settings cannot reach HTTP",async t=>{
  const h=await hostFor(t),{preview}=await h.quote(),before=h.requests.length;
  const variants=[{sceneCostConsent:undefined},{sceneCostConsent:{...preview,confirmed:false}},{sceneCostConsent:{...preview,confirmed:true,extra:true}},{sceneRequestId:"other-request"},{itemCount:9},{sceneMedium:"audio"},{locale:"fr"},{sceneCostConsent:{...preview,confirmed:true,model:"different-model"}}];
  for(const options of variants){const port=resultPort();assert.equal(await h.approve(preview,{...options,onResult:port.onResult}),false);assert.equal(port.results[0].requestId,options.sceneRequestId??h.request.requestId);assert.equal(port.results[0].attemptSubmission,"not-submitted");}
  assert.equal(h.requests.length,before);noJob(h);
});

for(const gate of ["append","navigation"]){
  test("paid Scene owns actual "+gate+" await and cannot dispatch after Close",async t=>{
    const h=await hostFor(t),{preview}=await h.quote(),wait=sceneDeferred();h.store.sceneGateForTest(gate,wait.promise);
    const port=resultPort();let open=true,checks=0,dispatched=0;
    const task=h.approve(preview,{current:()=>{checks++;return open;},onDispatch(){dispatched++;},onResult:port.onResult});
    await untilScene(()=>checks>=3);open=false;wait.resolve(true);
    assert.equal(await task,false);assert.equal(dispatched,0);assert.equal(port.results[0].attemptSubmission,"not-submitted");noJob(h);
  });
}

test("exact seventeen-part ceiling blocks budget that would permit authored-only one-dollar guess",async t=>{
  const h=await hostFor(t,{count:17}),{preview}=await h.quote();const budget={usedMicrousd:0,reservedMicrousd:0,limitMicrousd:2_000_000,remainingMicrousd:2_000_000};
  h.setSession({costBudgets:{period:preview.period,currency:"USD",user:budget,workspace:budget}});const port=resultPort();
  assert.equal(await h.approve(preview,{onResult:port.onResult}),false);noJob(h);assert.equal(port.results[0].attemptSubmission,"not-submitted");assert.equal(h.dialog(),null);
});

for(const outcome of ["cancel","close","source","authority","continue"]){
  test("actual native budget "+outcome+" retains original Scene identity and dispatch boundary",async t=>{
    const h=await hostFor(t),{preview}=await h.quote();const budget={usedMicrousd:61_000_000,reservedMicrousd:0,limitMicrousd:100_000_000,remainingMicrousd:39_000_000};
    h.setSession({costBudgets:{period:preview.period,currency:"USD",user:budget,workspace:budget}});
    const port=resultPort();let current=true,dispatches=0;const task=h.approve(preview,{current:()=>current,onDispatch(){dispatches++;},onResult:port.onResult});
    await untilScene(()=>h.dialog()?.open,"actual budget dialog");assert.equal(dispatches,0);
    const message=h.dialog().children[0].children.find(element=>element.tag==="p").textContent;assert.match(message,/\$2\.00/u);
    if(outcome==="close")current=false;
    if(outcome==="source")h.changeText();
    if(outcome==="authority")h.setSession({permissionEpoch:"withdrawn"});
    h.clickBudget(outcome!=="cancel");
    assert.equal(await task,outcome==="continue");assert.equal(dispatches,outcome==="continue"?1:0);
    assert.equal(port.results[0].requestId,h.request.requestId);
    if(outcome!=="continue"){noJob(h);assert.equal(port.results[0].attemptSubmission,"not-submitted");}
    assert.equal(h.dialog(),null);
  });
}

for(const outcome of ["close","source","continue"]){
  test("actual impersonation await "+outcome+" cannot retarget Scene purchase",async t=>{
    const h=await hostFor(t);const base=h.store.session.get();
    h.setSession({impersonation:{active:true,impersonationId:"test-impersonation",personaId:"test-persona",replaySessionId:"test-replay",actor:base.user,fictionalUser:base.user,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()}});
    const {preview}=await h.quote();assert.equal(h.store.ui.impersonationConfirmOpen,false,"free preview is never a mutation modal");
    const port=resultPort();let current=true,dispatches=0;const task=h.approve(preview,{current:()=>current,onDispatch(){dispatches++;},onResult:port.onResult});
    await untilScene(()=>h.store.ui.impersonationConfirmOpen);assert.equal(dispatches,0);
    if(outcome==="close")current=false;if(outcome==="source")h.changeText();
    h.store.resolveImpersonatedInteraction(true);assert.equal(await task,outcome==="continue");assert.equal(dispatches,outcome==="continue"?1:0);
    if(outcome!=="continue")noJob(h);
  });
}

test("throwing onDispatch cannot abandon its invoked HTTP promise or falsely lose verified receipt",async t=>{
  const h=await hostFor(t),{preview}=await h.quote(),wait=sceneDeferred(),entered=sceneDeferred();const port=resultPort();let callbacks=0,settled=false;
  h.intercept=async request=>{if(request.body?.payload.sceneCostPreview===true||request.url!=="/api/document-jobs")return;const response=await h.worker.request(request.url,request.init);entered.resolve();await wait.promise;return response;};
  const task=h.approve(preview,{onDispatch(){callbacks++;throw new Error("presentation callback failed");},onResult:port.onResult}).then(result=>{settled=true;return result;});
  await entered.promise;assert.equal(callbacks,1);assert.equal(settled,false);assert.equal(port.results.length,0,"original fetch remains awaited");
  wait.resolve();assert.equal(await task,true);assert.equal(port.results[0].job.jobId,h.request.requestId);assert.equal(port.results[0].attemptSubmission,"submitted");assert.equal(h.worker.counts().document_jobs,1);
});

for(const change of ["close","authority","route","source"]){
  test("post-dispatch "+change+" retains unknown exact ID and permits explicit same-ID free recovery only",async t=>{
    const h=await hostFor(t),{preview}=await h.quote(),wait=sceneDeferred(),entered=sceneDeferred(),originalSession=h.store.session.get(),originalEvents=h.store.events.get(),originalRoute=h.store.route.get();const port=resultPort();let current=true;
    h.intercept=async request=>{if(request.url!=="/api/document-jobs"||request.body.payload.sceneCostPreview===true)return;const response=await h.worker.request(request.url,request.init);entered.resolve();await wait.promise;return response;};
    const task=h.approve(preview,{current:()=>current,onDispatch(){if(change==="close")current=false;},onResult:port.onResult});
    await entered.promise;
    if(change==="authority")h.setSession({permissionEpoch:"withdrawn"});
    if(change==="route")h.store.route.set("/library");
    if(change==="source")h.changeText();
    wait.resolve();assert.equal(await task,false);assert.equal(port.results[0].requestId,h.request.requestId);assert.equal(port.results[0].attemptSubmission,"unknown");
    assert.equal(port.results[0].job,null);assert.equal(h.store.documentJobs.get().length,0);
    current=true;h.store.session.set(originalSession);h.store.events.set(originalEvents);h.store.route.set(originalRoute);h.intercept=null;
    const before=paidRequests(h).length,writes=h.worker.controls.writes.length,result=await h.quote();
    assert.equal(result.job.jobId,h.request.requestId);assert.equal(result.preview.bindingHash,preview.bindingHash);
    assert.equal(paidRequests(h).length,before);assert.equal(h.worker.controls.writes.length,writes);assert.equal(h.worker.counts().document_jobs,1);assert.equal(h.store.documentJobs.get().length,0,"free recovery never reconciles the job feed");
  });
}

test("lost exact admission response and throwing presentation callback recover original durable job without a retry",async t=>{
  const h=await hostFor(t),{preview}=await h.quote(),port=resultPort();
  h.intercept=async request=>{if(request.url!=="/api/document-jobs"||request.body.payload.sceneCostPreview===true)return;await h.worker.request(request.url,request.init);throw new Error("lost response");};
  assert.equal(await h.approve(preview,{onDispatch(){throw new Error("closed presenter");},onResult:port.onResult}),false);
  assert.equal(port.results[0].attemptSubmission,"unknown");assert.equal(port.results[0].requestId,h.request.requestId);assert.equal(h.worker.counts().document_jobs,1);
  h.intercept=null;const recovered=await h.quote();assert.equal(recovered.job.jobId,h.request.requestId);assert.equal(recovered.preview.bindingHash,preview.bindingHash);
  assert.equal(paidRequests(h).length,1);
});

test("onResult failure does not reclassify known admission or call the callback twice",async t=>{
  const h=await hostFor(t),{preview}=await h.quote();let callbacks=0;
  assert.equal(await h.approve(preview,{onResult(result){callbacks++;assert.equal(result.attemptSubmission,"submitted");throw new Error("presenter gone");}}),true);
  assert.equal(callbacks,1);assert.equal(h.worker.counts().document_jobs,1);
});

test("attempt-not-submitted error reports this HTTP attempt without replacing original request ID",async t=>{
  const h=await hostFor(t),{preview}=await h.quote(),port=resultPort();
  h.intercept=async()=>Response.json({error:"scene_cost_changed",attemptSubmission:"not-submitted"},{status:409});
  assert.equal(await h.approve(preview,{onResult:port.onResult}),false);assert.equal(port.results[0].attemptSubmission,"not-submitted");assert.equal(port.results[0].requestId,h.request.requestId);
  assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().document_jobs,0);
});

test("same-ID free recovery keeps every actual status and original epoch/model terms, including erased/expired originals",async t=>{
  const h=await hostFor(t),{preview}=await h.quote();assert.equal(await h.approve(preview),true);h.store.documentJobs.set([]);
  const currentSession=h.store.session.get();h.setSession({permissionEpoch:"new-current-epoch",provider:{...currentSession.provider,plannerModel:"new-current-model"}});
  h.worker.env.OPENAI_MODEL="new-current-model";delete h.worker.env.OPENAI_API_KEY;
  h.request.locale="fr";h.request.sceneMedium="audio";h.request.tone="New source settings";h.changeText();
  const paidBefore=paidRequests(h).length;
  for(const status of ["queued","running","committing","completed","failed","partial","canceled"]){
    h.worker.sqlite.prepare("UPDATE document_jobs SET status=? WHERE job_id=?").run(status,h.request.requestId);
    const writes=h.worker.controls.writes.length,result=await h.quote();
    assert.equal(result.job.jobId,h.request.requestId);assert.equal(result.job.status,status);assert.equal(result.preview.bindingHash,preview.bindingHash);
    assert.equal(result.preview.permissionEpoch,preview.permissionEpoch);assert.equal(h.worker.controls.writes.length,writes);assert.equal(h.store.documentJobs.get().length,0);
  }
  h.worker.sqlite.prepare("UPDATE document_jobs SET status='completed',request_json='{}',result_json=NULL,expires_at='2000-01-01T00:00:00Z' WHERE job_id=?").run(h.request.requestId);
  const expired=await h.quote();assert.equal(expired.job.jobId,h.request.requestId);assert.equal(expired.job.status,"completed");assert.equal(expired.preview,null);
  assert.equal(paidRequests(h).length,paidBefore);assert.equal(h.worker.counts().document_jobs,1);
});

test("reused paid receipt retains explicit null original terms rather than overlaying a newer preview",async t=>{
  const h=await hostFor(t),{preview}=await h.quote();assert.equal(await h.approve(preview),true);
  h.worker.sqlite.prepare("UPDATE document_jobs SET status='failed',request_json='{}',result_json=NULL WHERE job_id=?").run(h.request.requestId);
  const port=resultPort();assert.equal(await h.approve(preview,{onResult:port.onResult}),true);
  assert.equal(port.results[0].preview,null);assert.equal(port.results[0].job.status,"failed");assert.equal(port.results[0].reused,true);assert.equal(h.worker.counts().document_jobs,1);
});

test("free existing receipt rejects wrong exact job or actor instead of guessing an active same-kind output",async t=>{
  const h=await hostFor(t),{preview}=await h.quote();assert.equal(await h.approve(preview),true);
  const retained=await h.quote();
  for(const mutate of [body=>({...body,job:{...body.job,jobId:"wrong-job"}}),body=>({...body,job:{...body.job,documentId:"wrong-document"}}),body=>({...body,sceneCostExisting:{...body.sceneCostExisting,preview:{...preview,actorUserId:"wrong-actor"}}}),body=>({...body,reused:false})]){
    const body={job:retained.job,reused:true,sceneCostExisting:{requestId:h.request.requestId,preview}};
    h.intercept=async()=>Response.json(mutate(body));await assert.rejects(h.quote(),/scene_cost_unavailable/u);
  }
  assert.equal(h.worker.counts().document_jobs,1);
});

test("selected workflow revision changed during native budget wait stops before HTTP",async t=>{
  const h=await hostFor(t),{preview}=await h.quote(),budget={usedMicrousd:61_000_000,reservedMicrousd:0,limitMicrousd:100_000_000,remainingMicrousd:39_000_000};
  h.setSession({costBudgets:{period:preview.period,currency:"USD",user:budget,workspace:budget}});
  const port=resultPort(),task=h.approve(preview,{onResult:port.onResult});await untilScene(()=>h.dialog()?.open);
  const original=h.store.events.get().find(event=>event.type==="DocumentProductionWorkflowConfigured");
  h.store.events.set([...h.store.events.get(),{...original,eventId:"new-selected-workflow-revision",sequence:999,payload:{...original.payload}}]);
  h.clickBudget(true);assert.equal(await task,false);noJob(h);assert.equal(port.results[0].attemptSubmission,"not-submitted");
});

test("shared source closure refuses expired or malformed observable context deadline",async t=>{
  const h=await hostFor(t,{shared:true}),base=h.store.session.get(),current=h.store.captureSceneCostSource(h.request);
  assert.equal(current(),true);
  for(const expiresAt of ["2000-01-01T00:00:00Z","not-a-date",""]){
    h.setSession({projectContext:{...base.projectContext,expiresAt}});
    assert.equal(current(),false);assert.equal(h.store.captureSceneCostSource(h.request)(),false);
  }
  assert.equal(h.requests.length,0);
});
