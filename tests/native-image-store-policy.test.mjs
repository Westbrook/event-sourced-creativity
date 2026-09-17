import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { joinNativeImageCompletion } from "../src/model/native-image-generation.ts";

// Synthetic transport around the complete current Store; no Worker admission,
// provider request, browser interaction or authority restoration is exercised.
const OPTIONS = { concurrency: false, timeout: 20_000 };
const OWNER = "native-story-store-owner";
const PROJECT = "native-story-store-project";
const DOCUMENT = "native-story-store-document";
const AT = "2026-09-03T00:00:00.000Z";
function fixtureTransport() {
  const inputs = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Native story fixtures" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Native story fixture" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "story-direction", type: "direction",
      handle: "direction/story", position: "a", properties: { text: "A keeper returns a lost compass.", weight: 1 } } },
  ];
  const events = inputs.map((input, index) => ({ ...input, eventId: `native-story-event-${index + 1}`, sequence: index + 1,
    streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "user", clientId: "store-fixture",
    correlationId: `native-story-correlation-${index + 1}`, causationId: null, compensatesEventId: null, schemaVersion: 1 }));
  const session = { user: { userId: OWNER, email: "native-story@example.test", displayName: "Story author", role: "creator" },
    impersonation: null, policy: { version: "fixture-policy", accepted: true }, permissionEpoch: "fixture-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: {} };
  const request = async (url, init = {}) => {
    if (url === "/api/session") return Response.json(session);
    if (url.startsWith("/api/events?") && (!init.method || init.method === "GET")) return Response.json({ events, head: events.length, content: {} });
    assert.fail(`Unexpected fixture HTTP request ${init.method ?? "GET"} ${url}`);
  };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused-scene-request", payload: {}, events, request, close() {} };
}

async function host(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external transport is permitted in native Store tests"));
  const h = await createSceneStoreHost({ workerFixture: fixtureTransport(), exposeSceneTestAccessors: true });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Native story fixture"));
  h.store.loading.set(false);
  h.jobRequests = () => h.requests.filter(row => row.url === "/api/document-jobs" && row.init.method === "POST");
  return h;
}

const runnerRequests = h => h.requests.filter(row => /^\/api\/document-jobs\/[^/]+\/run$/u.test(row.url));
function imageSetup(h) {
  return { documentId: DOCUMENT, documentRevision: h.store.documentGenerationRevision(), sourceSurface: "native-image",
    promptTechnique: "prose", kind: "generate", productionMode: "manual", sourcePreviewId: null,
    requestKey: h.store.documentGenerationRequestKey("generate", null, "prose") };
}
function imageJob(setup, overrides = {}) {
  return { ...setup, jobId: "native-image-job", status: "queued", requestedSequence: 3,
    promptFanId: null, parentJobId: null, fanKind: null, members: [], canvasId: null,
    requestedAt: AT, startedAt: null, completedAt: null, updatedAt: AT, notifiedAt: null,
    leaseExpiresAt: null, dismissedAt: null, attemptCount: 0, stage: "queued", progressMessage: "",
    result: null, error: null, errorDetail: null, moderationPromptRef: null, ...overrides };
}

function observeJobs(h,rows){
  h.intercept=async request=>{
    if(request.url.startsWith("/api/document-jobs?")&&(!request.init.method||request.init.method==="GET"))return Response.json({jobs:rows()});
    if(/^\/api\/document-jobs\/[^/]+\/ack$/u.test(request.url))return Response.json({ok:true});
  };
}
const ackRequests=h=>h.requests.filter(row=>row.url.endsWith("/ack"));
test("native Image passive omission, reappearance and visibility never grant run or notification ACK",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),native=imageJob(setup);
  let rows=[native];observeJobs(h,()=>rows);
  await h.store.syncDocumentJobs();
  rows=[];await h.store.syncDocumentJobs();
  rows=[structuredClone(native)];await h.store.syncDocumentJobs();
  rows=[{...native,status:"completed",stage:"completed",completedAt:AT}];await h.store.syncDocumentJobs();
  h.document.visibilityState="visible";h.document.dispatchEvent({type:"visibilitychange"});
  await untilScene(()=>h.requests.filter(row=>row.url.startsWith("/api/document-jobs?")).length>=5,"native visibility performs the existing status read");
  await h.store.syncDocumentJobs();
  assert.deepEqual(runnerRequests(h),[]);assert.deepEqual(ackRequests(h),[]);
  assert.equal(h.requests.some(row=>/\/(?:retry|recover|reconcile-provider)$/u.test(row.url)),false);
});
test("an earlier native Image blocks the younger legacy driver without receiving legacy authority",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),native=imageJob(setup),legacy=imageJob(setup,{jobId:"legacy-later",sourceSurface:"document",requestedAt:"2026-09-03T00:00:01.000Z"});
  observeJobs(h,()=>[legacy,native]);await h.store.syncDocumentJobs();
  assert.deepEqual(runnerRequests(h),[]);assert.deepEqual(ackRequests(h),[]);
});
test("the independent older legacy job retains its existing initial driver",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),native=imageJob(setup),legacy=imageJob(setup,{jobId:"legacy-earlier",sourceSurface:"document",requestedAt:"2026-09-02T23:59:59.000Z"});
  observeJobs(h,()=>[native,legacy]);await h.store.syncDocumentJobs();
  await untilScene(()=>runnerRequests(h).length===1,"existing legacy driver called");
  assert.equal(runnerRequests(h)[0].url,"/api/document-jobs/legacy-earlier/run");assert.deepEqual(ackRequests(h),[]);
});
test("legacy terminal notices still acknowledge while native terminal notices do not",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),native=imageJob(setup,{status:"completed",completedAt:AT}),legacy=imageJob(setup,{jobId:"legacy-completed",sourceSurface:"document",status:"completed",completedAt:AT});
  h.document.visibilityState="visible";observeJobs(h,()=>[native,legacy]);await h.store.syncDocumentJobs();
  await untilScene(()=>ackRequests(h).length===1,"existing legacy completion notice acknowledged");
  assert.equal(ackRequests(h)[0].url,"/api/document-jobs/legacy-completed/ack");assert.deepEqual(runnerRequests(h),[]);
});
test("a cross-surface server reuse cannot become a native Image ACK or initial run",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),legacy=imageJob(setup,{sourceSurface:"document"});let acknowledgmentCalls=0;
  h.intercept=async request=>{if(request.url==="/api/document-jobs"&&request.init.method==="POST")return Response.json({job:legacy,reused:true},{status:202});};
  assert.deepEqual(await h.store.submitNativeImage(setup,{current:()=>true,onAcknowledgment:()=>{acknowledgmentCalls++;}}),{disposition:"dispatched-unconfirmed",handle:null});
  assert.equal(acknowledgmentCalls,0);assert.equal(h.jobRequests().length,1);assert.deepEqual(runnerRequests(h),[]);
});

test("an exact queued run response stays a held no-start outcome without another POST",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),original=imageJob(setup);let acknowledgment;
  h.intercept=request=>{
    if(request.url==="/api/document-jobs"&&request.init.method==="POST")return Response.json({job:original,accepted:true},{status:202});
    assert.equal(request.url,"/api/document-jobs/native-image-job/run");return Response.json({job:original});
  };
  await assert.rejects(h.store.submitNativeImage(setup,{current:()=>true,onAcknowledgment:value=>{acknowledgment=value;}}),/native_image_initial_run_not_started/u);
  assert.equal(acknowledgment.disposition,"acknowledged");assert.equal(acknowledgment.handle.jobId,original.jobId);
  h.store.documentJobs.set([structuredClone(original)]);h.store.notify();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.jobRequests().length,1);assert.equal(runnerRequests(h).length,1);assert.deepEqual(ackRequests(h),[]);
});
test("UI abort after native Image run dispatch does not settle or abort the physical response",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),original=imageJob(setup),abort=new AbortController();
  let release,entered=false,settled=false,current=true,acknowledgment;
  const response=new Promise(resolve=>{release=resolve;});
  h.intercept=request=>{
    if(request.url==="/api/document-jobs"&&request.init.method==="POST")return Response.json({job:original,accepted:true},{status:202});
    assert.equal(request.url,"/api/document-jobs/native-image-job/run");assert.equal(request.init.signal,undefined);
    entered=true;return response;
  };
  const pending=h.store.submitNativeImage(setup,{current:()=>current,signal:abort.signal,onAcknowledgment:value=>{acknowledgment=value;}});
  const observed=pending.then(value=>{settled=true;return{value};},error=>{settled=true;return{error};});
  t.after(async()=>{release(Response.json({job:{...original,status:"completed"}}));await observed;});
  await untilScene(()=>entered,"exact original run dispatch");current=false;abort.abort();h.store.notify();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  release(Response.json({job:{...original,status:"completed"}}));
  assert.deepEqual(await observed,{value:acknowledgment});assert.equal(runnerRequests(h).length,1);
  assert.equal(h.requests.some(request=>request.url.startsWith("/api/events?")),false,"Retired completion cannot hydrate a replaced view");
});

function imageEvidence(setup) {
  const generationId = "native-image-generation", eventId = "native-image-completed", objectId = "native-image-output";
  const ownerHex = Array.from(new TextEncoder().encode(OWNER), byte => byte.toString(16).padStart(2, "0")).join("");
  const envelope = { streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "worker:generator",
    clientId: "server:document-job:generate", correlationId: "native-image-correlation", causationId: null,
    compensatesEventId: null, schemaVersion: 1 };
  const compiled = { ...envelope, eventId: "native-image-compiled", sequence: 4, type: "ContextCompiled",
    payload: { document_id: DOCUMENT, generation_id: generationId, compiled_snapshot: { document: { id: DOCUMENT } } } };
  const completion = { ...envelope, eventId, sequence: 5, type: "GenerationCompleted",
    payload: { document_id: DOCUMENT, generation_id: generationId, object_id: objectId, object_ids: [objectId],
      model_id: "gpt-image-2", provider: "openai", source_surface: setup.sourceSurface, prompt_technique: setup.promptTechnique,
      media_url: `/api/media/u-${ownerHex}%2Fgenerated%2F${generationId}.png`, media_type: "image/png",
      source_content_hash: "a".repeat(64), image_width: 1536, image_height: 1024,
      quality: "high", purpose: "final", simulation: false, used_ideation_preview_pixels: false,
      canvas_id: null, context_set_id: null, prompt_fan_id: null, promotion_id: null,
      reference_preview_event_id: null, promoted_from_generation_id: null, promoted_from_object_id: null,
      promotion_outcome: null, content_expires_at: new Date(Date.now() + 3_600_000).toISOString() } };
  const job = imageJob(setup, { status: "completed", stage: "completed", startedAt: AT, completedAt: AT,
    result: { head: 5, appendedEventIds: [compiled.eventId, completion.eventId], promoted: false } });
  return { job, compiled, completion, events: [compiled, completion] };
}

test("native Image polls the original running job and joins its later completion before first Check",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),original=imageJob(setup),evidence=imageEvidence(setup);
  let completed=false,inspectCount=0;
  h.intercept=request=>{
    if(request.url==="/api/document-jobs"&&request.init.method==="POST")return Response.json({job:original,accepted:true},{status:202});
    if(request.url==="/api/document-jobs/native-image-job/run")return Response.json({job:{...original,status:"running",stage:"running"}});
    if(request.url.startsWith("/api/document-jobs?"))return Response.json({jobs:[completed?evidence.job:original]});
    if(request.url.startsWith("/api/events?")){assert.equal(completed,true);return Response.json({events:[...h.worker.events,...evidence.events],head:5,content:{}});}
    if(request.url==="/api/document-jobs/native-image-job?inspection=1"){inspectCount++;return Response.json({job:evidence.job});}
  };
  const acknowledgment=await h.store.submitNativeImage(setup,{current:()=>true});
  assert.equal(acknowledgment.disposition,"acknowledged");assert.equal(runnerRequests(h).length,1);
  const poll=[...h.timers.entries()].find(([,timer])=>timer.delay===350);
  assert.ok(poll,"The actual native run arms the existing follow-up job poll");
  completed=true;h.document.visibilityState="visible";h.timers.delete(poll[0]);poll[1].callback();
  await untilScene(()=>h.store.events.get().some(event=>event.eventId===evidence.completion.eventId),"The genuine job feed hydrates the confirmed pair");
  await new Promise(resolve=>setImmediate(resolve));
  const read=await h.store.inspectNativeImage(acknowledgment.handle,{current:()=>true,signal:new AbortController().signal});
  assert.equal(read.status,"data");assert.equal(joinNativeImageCompletion(acknowledgment.handle,read.data,()=>true).status,"matched");
  assert.equal(inspectCount,1);assert.equal(h.requests.filter(request=>request.url.startsWith("/api/events?")).length,1);
  assert.equal(runnerRequests(h).length,1);assert.deepEqual(ackRequests(h),[]);
});

test("durable ownership excludes the oldest job before selecting a legacy runner",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),durable=imageJob(setup,{sourceSurface:"outputs",executionOwner:"durable"}),legacy=imageJob(setup,{jobId:"legacy-after-durable",sourceSurface:"document",requestedAt:"2026-09-03T00:00:01.000Z"});
  observeJobs(h,()=>[durable,legacy]);await h.store.syncDocumentJobs();
  await untilScene(()=>runnerRequests(h).length===1,"legacy runner remains eligible");
  assert.equal(runnerRequests(h)[0].url,"/api/document-jobs/legacy-after-durable/run");
});
test("durable jobs refuse ordinary stop, recovery and retry even with a stale unmarked argument",OPTIONS,async t=>{
  const h=await host(t),setup=imageSetup(h),job=imageJob(setup,{sourceSurface:"outputs",executionOwner:"durable"});
  observeJobs(h,()=>[job]);await h.store.syncDocumentJobs();const before=h.requests.length;
  assert.equal(await h.store.stopDocumentJob(job.jobId),false);assert.equal(await h.store.recoverDocumentRender(job.jobId),false);
  assert.equal(await h.store.recoverDocumentPresentation(job.jobId),false);assert.equal(await h.store.reconcileDocumentProviderReceipt(job.jobId),false);
  await h.store.retryDocumentGeneration({...job,executionOwner:undefined});assert.equal(h.requests.length,before);assert.deepEqual(runnerRequests(h),[]);
});
