import nodeTest from "node:test";
import assert from "node:assert/strict";
const test=(name,fn)=>nodeTest(name,{timeout:20000},fn);
import { createSceneCostFixture,createSceneStoreHost,sceneDeferred,pause,financial,eventPost,input,canvasInput,writeFixture } from "./helpers/event-source-retirement-fixture.mjs";
for(const shared of [false,true])test("actual ordinary "+(shared?"shared":"personal")+" append retains the existing event array and releases its slot",async t=>{
 const h=await writeFixture(t,{shared}),event=input(h,"normal-"+shared),before=h.store.events.get().length;
 const result=await h.store.appendWithReceipt(event);assert.equal(result.publication,"published");assert.equal(result.acknowledgment.outcome,"observed");
 assert.equal(result.appended.length,1);assert.equal(result.acknowledgment.committed[0].eventId,result.appended[0].eventId);
 assert.equal(h.store.events.get().length,before+1);assert.deepEqual(h.store.eventWriteAcknowledgments(result.acknowledgment.owner),[]);
 assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='BlockCreated' AND payload LIKE ?").get('%normal-'+shared+'%').n,1);
});
for(const mode of ["complete","partial"])test("actual delayed "+mode+" append retains exact commit subset but no retired private bodies",async t=>{
 const h=await writeFixture(t,{shared:mode!=="partial"}),entered=sceneDeferred(),gate=sceneDeferred();t.after(()=>gate.resolve());let canonical,posts=0;
 h.intercept=async r=>{if(!eventPost(r))return;posts++;const response=await h.worker.request(r.url,r.init);canonical=await response.clone().json();assert.equal(response.status,200,JSON.stringify(canonical));entered.resolve();await gate.promise;return response;};
 const events=[input(h,"late-"+mode)];if(mode==="partial")events.push({type:"ProviderBillableUsage",payload:{private:"rejected draft"}});
 const pending=h.store.appendBatchWithReceipt(events);await entered.promise;await h.deny();const retired=JSON.stringify(h.store.session.get());gate.resolve();
 const result=await pending;assert.equal(result.publication,"withheld");assert.deepEqual(result.appended,[]);assert.equal(result.acknowledgment.outcome,"observed");
 const user=canonical.appended.filter(e=>e.actor!=="worker:validator");assert.deepEqual(result.acknowledgment.committed.map(e=>e.eventId),user.map(e=>e.eventId));
 assert.ok(user.length);assert.ok(h.retired());assert.equal(JSON.stringify(h.store.session.get()),retired);assert.equal(posts,1);
 assert.equal(JSON.stringify(result).includes("Private exact authored"),false);assert.equal(JSON.stringify(result).includes("rejected draft"),false);
 assert.equal(result.acknowledgment.rejectedIndices.length,mode==="partial"?1:0);assert.equal(h.store.appendFailure.get(),"");
 const retained=h.store.eventWriteAcknowledgments(result.acknowledgment.owner);assert.equal(retained.length,1);assert.deepEqual(retained[0],result.acknowledgment);
 assert.equal(h.store.releaseEventWriteAcknowledgment(result.acknowledgment.observationId,result.acknowledgment.owner),true);
});
test("source loss while queued stops invocation before any POST and cannot relabel another unknown",async t=>{
 const h=await writeFixture(t),gate=sceneDeferred();h.store.sceneGateForTest("append",gate.promise);
 const pending=h.store.appendWithReceipt(input(h,"queued-not-sent",true));await pause();await h.deny();gate.resolve();
 const result=await pending;assert.equal(result.acknowledgment.outcome,"not-attempted");assert.equal(result.publication,"withheld");
 assert.equal(h.requests.filter(eventPost).length,0);assert.ok(h.retired());
});
test("actual lost committed response remains unconfirmed and same original IDs do not trigger a generic retry",async t=>{
 const h=await writeFixture(t);let posts=0,committed;
 h.intercept=async r=>{if(!eventPost(r))return;posts++;const response=await h.worker.request(r.url,r.init);assert.equal(response.status,200);committed=await response.json();throw new Error("synthetic lost exact commit response");};
 const event=input(h,"lost-original",true),first=await h.store.appendWithReceipt(event);
 assert.equal(first.acknowledgment.outcome,"unconfirmed");assert.equal(first.publication,"none");
 const original=JSON.stringify(h.store.eventWriteAcknowledgments(first.acknowledgment.owner));const second=await h.store.appendWithReceipt(event);
 assert.equal(posts,1);assert.equal(second.acknowledgment.observationId,first.acknowledgment.observationId);assert.equal(second.acknowledgment.outcome,"unconfirmed");
 assert.equal(JSON.stringify(h.store.eventWriteAcknowledgments(first.acknowledgment.owner)),original);assert.equal(h.store.releaseEventWriteAcknowledgment(first.acknowledgment.observationId,first.acknowledgment.owner),false);
 assert.equal(committed.appended.filter(e=>e.type==="BlockCreated").length,1);
});
test("actual late Canvas response delivers only exact original client-ID acknowledgment and stays paused after source recovery",async t=>{
 const h=await writeFixture(t),gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());let canonical,posts=0;
 h.intercept=async r=>{if(!eventPost(r))return;posts++;const response=await h.worker.request(r.url,r.init);canonical=await response.clone().json();assert.equal(response.status,200,JSON.stringify(canonical));entered.resolve();await gate.promise;return response;};
 const event=canvasInput(h,"canvas-late"),pending=h.store.syncCanvasBatch([event]);await entered.promise;await h.deny();gate.resolve();const result=await pending;
 assert.equal(result.pause,"source-retired");assert.equal(result.retryable,false);assert.equal(result.error,"");assert.deepEqual(result.appended,[]);
 assert.equal(result.acknowledgment.outcome,"observed");assert.equal(result.acknowledgment.committed[0].clientEventId,event.payload.client_event_id);
 assert.equal(result.acknowledgment.committed[0].eventId,canonical.appended.find(e=>e.actor!=="worker:validator").eventId);assert.ok(h.retired());
 h.restore();await h.store.refreshEvents();const repeated=await h.store.syncCanvasBatch([event]);assert.equal(repeated.pause,"source-retired");assert.equal(posts,1);
});
test("normal Canvas unknown transport still retries the same existing IDs through its established protocol",async t=>{
 const h=await writeFixture(t);let posts=0;
 h.intercept=async r=>{if(!eventPost(r))return;if(++posts===1)throw new Error("ordinary offline transport");return h.worker.request(r.url,r.init);};
 const event=canvasInput(h,"canvas-retry"),first=await h.store.syncCanvasBatch([event]);assert.equal(first.retryable,true);assert.equal(first.pause,undefined);
 const second=await h.store.syncCanvasBatch([event]);assert.equal(posts,2);assert.equal(second.appended.filter(e=>e.type==="CanvasCreated").length,1);assert.equal(second.pause,undefined);assert.equal(second.retryable,false);
});
test("32 scoped observations reserve before simultaneous admission and retain every unknown at capacity",async t=>{
 const h=await writeFixture(t),gate=sceneDeferred();h.store.sceneGateForTest("append",gate.promise);let posts=0;
 h.intercept=async r=>{if(eventPost(r)){posts++;throw new Error("synthetic transport outcome unknown");}};
 const pending=Array.from({length:32},(_,i)=>h.store.appendWithReceipt(input(h,"capacity-"+i,true)));
 const over=h.store.appendWithReceipt(input(h,"capacity-over",true));await pause();assert.equal(posts,0);
 gate.resolve();const rows=await Promise.all(pending),blocked=await over;assert.equal(posts,32);assert.ok(rows.every(row=>row.acknowledgment.outcome==="unconfirmed"));assert.equal(blocked.acknowledgment.outcome,"not-attempted");
 const saved=h.store.eventWriteAcknowledgments(rows[0].acknowledgment.owner);assert.equal(saved.length,32);
 const before=JSON.stringify(saved),reuse=await h.store.appendWithReceipt(input(h,"capacity-0",true));assert.equal(reuse.acknowledgment.observationId,rows[0].acknowledgment.observationId);
 assert.equal(JSON.stringify(h.store.eventWriteAcknowledgments(rows[0].acknowledgment.owner)),before);assert.equal(posts,32);
});
test("source ownership tokens are exact Store-instance objects and old tokens never revive",async t=>{
 const h=await writeFixture(t),token=h.store.captureSourceOwnership();assert.ok(h.store.sourceOwnershipActive(token));
 assert.equal(h.store.sourceOwnershipActive({...token}),false);assert.equal(h.store.sourceOwnershipScopeActive({...token}),false);
 const Other=h.modules.get("src/state/store.ts").FormaStore,other=new Other();other.session.set(h.store.session.get());
 assert.equal(other.sourceOwnershipActive(token),false);assert.equal(h.store.sourceOwnershipActive(other.captureSourceOwnership()),false);
 await h.deny();assert.equal(h.store.sourceOwnershipActive(token),false);assert.equal(h.store.sourceOwnershipScopeActive(token),true);
 const retired=h.store.captureSourceOwnership();assert.ok(retired);assert.equal(h.store.sourceOwnershipActive(retired),false);
 h.restore();await h.store.refreshEvents();assert.equal(h.store.sourceOwnershipActive(token),false);assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));
});

test("128 whole-Store capacity preserves four exact real scopes and refuses a fifth before dispatch",async t=>{
 const h=await writeFixture(t),workers=[h.worker],originalOwners=[],originalReceipts=[];let active=h.worker,posts=0;
 t.after(()=>{for(const worker of workers.slice(1))worker.close();});
 h.transport=r=>active.request(r.url,r.init);
 h.intercept=async r=>{if(eventPost(r)){posts++;throw new Error("synthetic transport acknowledgment lost");}};
 for(let scope=0;scope<4;scope++){
  if(scope){active=await createSceneCostFixture(1,"visual",{shared:true,depth:true});workers.push(active);await h.store.refreshSession();await h.store.refreshEvents();}
  const results=await Promise.all(Array.from({length:32},(_,index)=>h.store.appendWithReceipt(input(h,"whole-"+scope+"-"+index,true))));
  assert.ok(results.every(result=>result.acknowledgment.outcome==="unconfirmed"));originalOwners.push(results[0].acknowledgment.owner);
  originalReceipts.push(JSON.stringify(h.store.eventWriteAcknowledgments(results[0].acknowledgment.owner)));
  assert.equal(h.store.eventWriteAcknowledgments(results[0].acknowledgment.owner).length,32);
  if(scope)assert.deepEqual(h.store.eventWriteAcknowledgments(originalOwners[0]),[],"No other exact scope exposes prior observations");
 }
 assert.equal(posts,128);
 active=await createSceneCostFixture(1,"visual",{shared:true,depth:true});workers.push(active);await h.store.refreshSession();await h.store.refreshEvents();
 const blocked=await h.store.appendWithReceipt(input(h,"whole-fifth",true));assert.equal(blocked.acknowledgment.outcome,"not-attempted");assert.equal(posts,128);
 for(let scope=0;scope<4;scope++){active=workers[scope];await h.store.refreshSession();await h.store.refreshEvents();
  assert.equal(JSON.stringify(h.store.eventWriteAcknowledgments(originalOwners[scope])),originalReceipts[scope],"No original unknown bytes/identity evicted at capacity");}
 assert.equal(posts,128);
});
test("new generic invocations without client IDs are not coalesced by equal body text",async t=>{
 const h=await writeFixture(t,{shared:false});let posts=0;
 h.intercept=async r=>{if(eventPost(r)){posts++;return h.worker.request(r.url,r.init);}};
 const event={type:"ProjectOpened",payload:{project_id:h.worker.projectId,source_surface:"source-write-control"}};
 const one=await h.store.appendWithReceipt(event),two=await h.store.appendWithReceipt(event);
 assert.equal(posts,2);assert.equal(one.acknowledgment.outcome,"observed");assert.equal(two.acknowledgment.outcome,"observed");
 assert.notEqual(one.acknowledgment.observationId,two.acknowledgment.observationId);assert.notEqual(one.acknowledgment.committed[0].eventId,two.acknowledgment.committed[0].eventId);
});
for(const damage of ["foreign-client","duplicate-event","missing-head","unreadable"])test("actual committed response "+damage+" cannot fabricate a complete acknowledgment or publish private source",async t=>{
 const h=await writeFixture(t),event=input(h,"malformed-"+damage,true),before=h.store.events.get().length;let posts=0;
 h.intercept=async r=>{if(!eventPost(r))return;posts++;const response=await h.worker.request(r.url,r.init);assert.equal(response.status,200);const body=await response.json();
  if(damage==="foreign-client")body.appended[0].payload.client_event_id="not-the-original-client";
  if(damage==="duplicate-event")body.appended.push(body.appended[0]);
  if(damage==="missing-head")delete body.head;
  if(damage==="unreadable")return new Response("{",{status:200,headers:{"content-type":"application/json"}});
  return Response.json(body);
 };
 const result=await h.store.appendWithReceipt(event);assert.equal(result.acknowledgment.outcome,"unconfirmed");assert.deepEqual(result.appended,[]);
 assert.equal(result.acknowledgment.committed.length,0);assert.equal(h.store.events.get().length,before);assert.equal(posts,1);
 assert.equal(h.store.eventWriteAcknowledgments(result.acknowledgment.owner).length,1);assert.equal(h.store.releaseEventWriteAcknowledgment(result.acknowledgment.observationId,result.acknowledgment.owner),false);
});
test("an old admitted input object cannot change its original request during the append queue",async t=>{
 const h=await writeFixture(t),gate=sceneDeferred();h.store.sceneGateForTest("append",gate.promise);
 const event=input(h,"frozen-admission",true),original=structuredClone(event),pending=h.store.appendWithReceipt(event);
 event.payload.properties.text="Later caller mutation must not be sent";gate.resolve();const result=await pending;
 assert.equal(result.acknowledgment.outcome,"observed");assert.equal(result.appended[0].payload.properties.text,original.payload.properties.text);
 assert.equal(h.requests.find(eventPost).body.event.payload.properties.text,original.payload.properties.text);
});


test("genuine original Scene unknown submission retains held ledgers, exact job and request after source denial",async t=>{
 const {createPilotSceneFixture,scenePilotProvider}=await import("./helpers/scene-pilot-fixture.mjs");
 const worker=await createPilotSceneFixture({member:true,count:1,mode:"manual",depth:true});
 const calls=scenePilotProvider(t,{uncertainAt:1});await worker.admit();const run=await worker.run();
 assert.equal(run.response.status,200);assert.equal(run.body.job.status,"failed");assert.equal(calls.length,1);
 const cost=worker.cost(),tokens=worker.tokens();assert.equal(cost.length,1);assert.equal(cost[0].status,"executing");
 assert.ok(cost[0].reserved_microusd>0);assert.equal(cost[0].used_microusd,0);assert.equal(tokens.length,1);assert.equal(tokens[0].status,"active");
 const h=await createSceneStoreHost({workerFixture:worker});t.after(()=>h.close());
 const feed=await worker.request("/api/document-jobs"),body=await feed.json();assert.equal(feed.status,200);h.store.documentJobs.set(body.jobs);
 const before=financial(worker),session=structuredClone(h.store.session.get()),requestId=worker.requestId;
 worker.sqlite.prepare("UPDATE project_memberships SET status='revoked',updated_at=? WHERE project_access_id=? AND user_id=?").run(new Date().toISOString(),worker.sharing.projectAccessId,worker.actorUserId);
 await assert.rejects(h.store.refreshEvents(),/403/);assert.equal(h.store.events.get().length,0);assert.deepEqual(h.store.session.get(),session);
 const original=h.store.documentJobs.get().find(job=>job.jobId===requestId);assert.ok(original);assert.deepEqual(original.result,{artifactKind:"scene"});assert.equal(original.status,run.body.job.status);
 await h.store.syncDocumentJobs();assert.equal(calls.length,1);assert.deepEqual(financial(worker),before);
 worker.sqlite.prepare("UPDATE project_memberships SET status='active',updated_at=? WHERE project_access_id=? AND user_id=?").run(new Date().toISOString(),worker.sharing.projectAccessId,worker.actorUserId);
 await h.store.refreshEvents();await h.store.syncDocumentJobs();assert.equal(calls.length,1);assert.deepEqual(financial(worker),before);
 assert.equal(h.requests.filter(request=>request.init.method==="POST").length,0,"No purchase, runner, cancellation, acknowledgment or refund mutation follows recovery");
});

for(const operation of["edit","restore"])for(const denied of[false,true])test("actual finished-output "+operation+(denied?" acknowledged after source denial":" healthy")+
 " preserves original revision without private resurrection",async t=>{
 const h=await writeFixture(t),artifactId="saved-scene-story";
 if(operation==="restore")assert.equal(await h.store.reviseDocumentArtifact(artifactId,{markdown:"First authored revision before restore",expectedRevision:0}),true);
 const expectedRevision=operation==="restore"?1:0,gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());let responseBody,requests=0;
 h.intercept=async request=>{
  if(!request.url.startsWith("/api/artifacts/"+artifactId)||!["POST","PATCH"].includes(request.init.method))return;
  requests++;const response=await h.worker.request(request.url,request.init);responseBody=await response.clone().json();
  assert.equal(response.status,200,JSON.stringify(responseBody));entered.resolve();if(denied)await gate.promise;return response;
 };
 const pending=operation==="edit"?h.store.reviseDocumentArtifact(artifactId,{markdown:"Exact new authored private revision",expectedRevision})
   :h.store.restoreDocumentArtifact(artifactId,0,expectedRevision);
 await entered.promise;if(denied){await h.deny();gate.resolve();}
 const saved=await pending;assert.equal(saved,!denied);assert.equal(requests,1);
 assert.ok(responseBody.appended.some(event=>event.type==="DocumentArtifactEdited"));
 if(denied){
  assert.ok(h.retired());assert.equal(h.store.appendFailure.get(),"");
  const owner={authorizationKey:h.store.captureAuthorizationScope().key,actorUserId:h.worker.owner,projectId:h.worker.projectId,sourceGeneration:0};
  const receipts=h.store.eventWriteAcknowledgments(owner);assert.equal(receipts.length,1);assert.equal(receipts[0].outcome,"observed");
  assert.deepEqual(receipts[0].committed.map(row=>row.eventId),responseBody.appended.filter(row=>row.actor!=="worker:validator").map(row=>row.eventId));
  assert.equal(JSON.stringify(receipts).includes("authored private revision"),false);
 }else assert.ok(h.store.events.get().some(event=>responseBody.appended.some(row=>row.eventId===event.eventId)));
});

for(const artifactKind of["short_story","scene","slides","storyboard","video","audio","invalid-kind",null])
test("source retirement retains only validated original artifact category "+String(artifactKind),async t=>{
 const h=await writeFixture(t),row={jobId:"opaque-original-"+artifactKind,documentId:h.worker.documentId,kind:"render_document",status:"failed",
  sourceSurface:"document",requestKey:"opaque-request",result:artifactKind===null?null:{artifactKind,title:"private title",summary:"private narrative",generationReceipt:{settled_cost_microusd:9,private:"must disappear"}},
  members:[],error:"private error",errorDetail:{message:"private diagnostic"},moderationPromptRef:"private-ref",progressMessage:"private progress"};
 h.store.documentJobs.set([row]);await h.deny();const kept=h.store.documentJobs.get()[0];
 assert.equal(kept.jobId,row.jobId);assert.equal(kept.documentId,row.documentId);assert.equal(kept.kind,row.kind);assert.equal(kept.status,row.status);
 assert.deepEqual(kept.result,artifactKind===null||artifactKind==="invalid-kind"?null:{artifactKind});
 assert.equal(JSON.stringify(kept).includes("private"),false);assert.deepEqual(Object.keys(kept.result??{}),kept.result?["artifactKind"]:[]);
});

for(const clientIds of[false,true])for(const missing of["all","one"])test("generic "+(clientIds?"original-ID":"no-ID")+" response missing "+missing+" required commits retains only known receipt subset",async t=>{
 const h=await writeFixture(t),events=[input(h,"required-a-"+clientIds+"-"+missing,clientIds),input(h,"required-b-"+clientIds+"-"+missing,clientIds)];
 const before=h.store.events.get().length;let original,posts=0;
 h.intercept=async request=>{if(!eventPost(request))return;posts++;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);original=await response.json();
  const body=structuredClone(original);body.appended=missing==="all"?[]:body.appended.slice(0,1);return Response.json(body);};
 const result=await h.store.appendBatchWithReceipt(events);
 assert.equal(result.acknowledgment.outcome,"unconfirmed");assert.equal(result.publication,"none");assert.deepEqual(result.appended,[]);
 assert.equal(result.acknowledgment.committed.length,missing==="all"?0:1);assert.equal(h.store.events.get().length,before);
 assert.ok(original.appended.length>=2);assert.equal(posts,1);assert.equal(h.store.eventWriteAcknowledgments(result.acknowledgment.owner).length,1);
 assert.equal(h.store.releaseEventWriteAcknowledgment(result.acknowledgment.observationId,result.acknowledgment.owner),false);
});
test("one generic committed event cannot certify two identical input events without original IDs",async t=>{
 const h=await writeFixture(t,{shared:false}),event={type:"ProjectOpened",payload:{project_id:h.worker.projectId,source_surface:"exact-double-intent"}};
 let original;
 h.intercept=async request=>{if(!eventPost(request))return;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  original=await response.json();assert.equal(original.appended.length,2);return Response.json({...original,appended:original.appended.slice(0,1)});};
 const result=await h.store.appendBatchWithReceipt([event,structuredClone(event)]);
 assert.equal(result.acknowledgment.outcome,"unconfirmed");assert.equal(result.acknowledgment.committed.length,1);
 assert.equal(result.publication,"none");assert.deepEqual(result.appended,[]);assert.notEqual(original.appended[0].eventId,original.appended[1].eventId);
});
test("actual generic validation sidecars identify rejected inputs without pretending their audit event is a user commit",async t=>{
 const h=await writeFixture(t,{shared:false}),valid=input(h,"valid-with-rejected",true),invalid={type:"ProviderBillableUsage",payload:{private:"Rejected client-only invented provider assertion"}};
 const result=await h.store.appendBatchWithReceipt([valid,invalid]);
 assert.equal(result.acknowledgment.outcome,"observed");assert.equal(result.publication,"published");assert.deepEqual(result.acknowledgment.rejectedIndices,[1]);
 assert.equal(result.acknowledgment.committed.length,1);assert.equal(result.acknowledgment.committed[0].type,"BlockCreated");
 assert.ok(result.appended.some(event=>event.type==="ValidationFailed"));assert.ok(result.appended.some(event=>event.payload.block_id===valid.payload.block_id));
});
