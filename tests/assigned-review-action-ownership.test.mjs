import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import nativeTest,{after} from "node:test";
const selection=process.argv.find(value=>value.startsWith("--case="))?.slice(7);
const selectedPattern=selection?new RegExp(selection):null;let registered=0;
const test=(name,options,body)=>{if(selectedPattern&&!selectedPattern.test(name))return;registered++;return nativeTest(name,options,body);};
const ROOT=fileURLToPath(new URL("../",import.meta.url));
const {assignmentPage,sceneDeferred,flushStoreFrames,frames,responseBody,artifactFocusOptionsFromRoute,
 libraryFocusFromRoute,sceneCostFixtureProof,originalFetch,externalCount}=await import("./helpers/assigned-review-action-fixture.mjs");
const {foldEvents}=await import("file://"+ROOT+"src/model/events.ts");
const {readWorkspaceEvents}=await import("file://"+ROOT+"worker/runtime.ts");

const waitTurn=()=>new Promise(setImmediate);
async function waitFor(check,label){for(let i=0;i<120;i++){if(check())return;await waitTurn();}assert.ok(check(),label);}
for(const surface of ["picker","leave"])for(const order of ["only-latest","older-first","latest-first"])
test("shared cookie producer / "+surface+"/"+order,{timeout:30_000},async t=>{
 const q=await assignmentPage(t,surface==="picker"?"cross-project":"same-document",{differentTargets:surface==="picker",personalSource:surface==="leave"}),{h,f}=q;
 // Native fetch port for components which intentionally use the platform fetch rather than a Store wrapper.
 const previousFetch=globalThis.fetch;
 globalThis.fetch=(url,init)=>{assert.ok(String(url).startsWith("/api/"),"Only this actual memory Worker is reachable");return h.fetch(url,init);};
 t.after(()=>{globalThis.fetch=previousFetch;});
 await flushStoreFrames(h);await f.settle();
 const personal=foldEvents(await readWorkspaceEvents(q.w.env,"creative:assigned-reviewer"));
 assert.ok(personal.documentId,"Actual existing personal Document before the action");
 const gates=[],made=[sceneDeferred(),sceneDeferred()],calls=[],loads=[],requestBaseline=h.requests.length;
 const originalLoad=h.store.load;t.mock.method(h.store,"load",function(...args){const pending=originalLoad.apply(this,args);loads.push(pending);return pending;});
 let closing=false;
 const original=h.store.openAssignedReview;
 t.mock.method(h.store,"openAssignedReview",function(task){const call={task};calls.push(call);call.pending=original.call(this,task);void call.pending.then(value=>call.value=value);return call.pending;});
 h.intercept=async request=>{
  if(!(request.init.method==="POST"&&request.url.endsWith("/context")||request.init.method==="DELETE"&&request.url==="/api/workspaces/context"))return;
  const gate={request,entered:sceneDeferred(),release:sceneDeferred()};gates.push(gate);made[gates.length-1]?.resolve(gate);
  const response=await q.serverRequest(request);assert.equal(response.status,200,await response.clone().text());
  gate.entered.resolve();if(closing)gate.release.resolve();await gate.release.promise;return q.receive(response);
 };
 t.after(async()=>{closing=true;for(const gate of gates)gate.release.resolve();await Promise.allSettled(calls.map(call=>call.pending));});
 if(order!=="only-latest"){
  const activation=f.act(q.button(q.task.artifactId)),old=await made[0].promise;await old.entered.promise;await activation;
 }
 let latestActivation;
 const index=order==="only-latest"?0:1;
 if(surface==="picker"){
  h.store.setRoute("/settings/workspaces");await f.settle();
  const picker=f.find("button",node=>node.owner.tag==="forma-workspace-settings"&&node.attributes["aria-label"]==="Open Assigned Project C");
  assert.ok(picker.owner.isConnected&&picker.port.isConnected,"Actual shared-project picker is connected");
  latestActivation=f.act(picker);
 }else{
  const leave=f.find("button",node=>node.owner.tag==="forma-activity"&&node.text.includes("View all my assigned reviews"));
  assert.ok(leave.owner.isConnected&&leave.port.isConnected,"Actual leave/View All control is connected");
  latestActivation=f.act(leave);
 }
 if(order!=="only-latest"){
  await f.settle();assert.equal(gates.length,1,"A newer mutation is not dispatched while old Set-Cookie can still arrive");
  gates[0].release.resolve();await calls[0].pending;
 }
 const latest=await made[index].promise;await latest.entered.promise;
 const settleLatest=async()=>{
  latest.release.resolve();await latestActivation;
  if(surface==="picker"){await waitFor(()=>loads.length>0,"Actual settings action starts its native load");await Promise.all(loads);}
  await flushStoreFrames(h);await f.settle();
 };
 await settleLatest();
 await flushStoreFrames(h);await f.settle();
 const liveResponse=await q.nativeRequest({url:"/api/session",init:{}}),live=await liveResponse.json();
 const outcome={surface,order,route:h.store.route.get(),publishedProject:h.store.session.get().projectContext?.projectId??null,
  liveStatus:liveResponse.status,liveProject:live.projectContext?.projectId??null,liveError:live.error??null,
  requested:h.requests.slice(requestBaseline).filter(row=>row.init.method==="POST"&&row.url.endsWith("/context")||row.init.method==="DELETE"&&row.url==="/api/workspaces/context").map(row=>({url:row.url,method:row.init.method})),
  oldResults:calls.map(call=>call.value),toast:h.store.ui.toast};
 console.log("COOKIE_CALLER_OBSERVATION",JSON.stringify(outcome));
 const expectedProject=surface==="picker"?q.secondTask.projectId:null;
 assert.equal(outcome.publishedProject,expectedProject,"The actual newest picker/leave operation owns the published scope");
 assert.equal(outcome.route,surface==="picker"?"/projects":"/activity?document="+encodeURIComponent(personal.documentId));
 assert.equal(outcome.requested.length,order==="only-latest"?1:2,"No automatically repeated cookie mutation");
 assert.equal(liveResponse.status,200,"The actual latest cookie mutation remains usable after the older response arrives");
 assert.equal(outcome.liveProject,expectedProject);assert.equal(h.store.ui.toast,"","No stale project-denial toast");
});


async function actionFixture(t,entry="cross-project",options={}){
 const q=await assignmentPage(t,entry,options),{h,f}=q,previousFetch=globalThis.fetch;
 globalThis.fetch=(url,init)=>{assert.ok(String(url).startsWith("/api/"),"Only the same memory Worker is reachable");return h.fetch(url,init);};
 t.after(()=>{globalThis.fetch=previousFetch;});
 await flushStoreFrames(h);await f.settle();
 const calls=[],original=h.store.openAssignedReview;
 t.mock.method(h.store,"openAssignedReview",function(task){const call={task};calls.push(call);call.pending=original.call(this,task);void call.pending.then(value=>call.value=value,error=>call.error=String(error));return call.pending;});
 q.calls=calls;return q;
}
function holdContextHeaders(t,q){
 const gates=[],made=[sceneDeferred(),sceneDeferred(),sceneDeferred()];let closing=false;
 q.h.intercept=async request=>{
  if(!(request.init.method==="POST"&&request.url.endsWith("/context")||request.init.method==="DELETE"&&request.url==="/api/workspaces/context"))return;
  const gate={request,entered:sceneDeferred(),release:sceneDeferred()};gates.push(gate);made[gates.length-1]?.resolve(gate);
  const response=await q.serverRequest(request);gate.response=response;gate.entered.resolve();
  if(closing)gate.release.resolve();await gate.release.promise;return q.receive(response);
 };
 t.after(async()=>{closing=true;for(const gate of gates)gate.release.resolve();await Promise.allSettled(q.calls.map(call=>call.pending));});
 return {gates,made};
}
async function assertExactTask(q,task){
 await flushStoreFrames(q.h);await q.f.settle();await flushStoreFrames(q.h);await q.f.settle();
 const route=q.h.store.route.get(),options=artifactFocusOptionsFromRoute(route);
 assert.equal(libraryFocusFromRoute(route)?.id,task.artifactId);
 assert.deepEqual(options,{expectedRevision:task.revision,intent:"review",expectedContentSha256:task.contentSha256});
 const response=await q.nativeRequest({url:"/api/session",init:{}}),session=await responseBody(response);
 assert.equal(session.projectContext.projectId,task.projectId);assert.equal(session.projectContext.projectAccessId,task.projectAccessId);
 assert.equal(q.h.store.ui.toast,"");assert.equal(q.h.store.error.get(),"");
}

for(const {entry,differentTargets} of [{entry:"same-document",differentTargets:false},{entry:"cross-project",differentTargets:false},{entry:"cross-project",differentTargets:true}])for(const count of [2,3])
test("rapid context headers / "+entry+"/"+differentTargets+"/"+count,{timeout:30_000},async t=>{
 const q=await actionFixture(t,entry,{differentTargets}),{f}=q,{gates,made}=holdContextHeaders(t,q);
 const tasks=[q.task,q.secondTask,q.thirdTask].slice(0,count);
 await f.act(q.button(tasks[0].artifactId));await(await made[0].promise).entered.promise;
 for(const task of tasks.slice(1))await f.act(q.button(task.artifactId));
 await f.settle();assert.equal(gates.length,1,"Old cookie response is the only in-flight handshake");
 gates[0].release.resolve();
 const latest=await made[1].promise;await latest.entered.promise;
 const expected=tasks.at(-1);
 assert.ok(latest.request.url.includes("/projects/"+expected.projectAccessId+"/context"));
 assert.equal(latest.response.status,200);latest.release.resolve();
 await Promise.all(q.calls.map(call=>call.pending));
 assert.equal(gates.length,2,"Skipped middle activation is never posted; no automatic retry");
 assert.deepEqual(q.calls.map(call=>call.value),tasks.map((_,index)=>index===tasks.length-1));
 await assertExactTask(q,expected);
});
for(const order of ["oldest-first","newest-first"])
test("three final inbox replies / same-project/"+order,{timeout:30_000},async t=>{
 const q=await actionFixture(t,"same-document"),{h,f}=q,gates=[];let gateIndex=0;
 h.intercept=async request=>{
  const gate=gates[gateIndex];
  if(!gate||request.url!=="/api/workspaces/reviews"||h.store.loading.get()||!frames(h).some(([,timer])=>String(timer.callback).includes("ownsLoad")))return;
  gateIndex++;const response=await q.nativeRequest(request);assert.equal(response.status,200);
  const body=await response.clone().json();
  for(const task of [q.task,q.secondTask,q.thirdTask])assert.ok(body.tasks.some(row=>row.id===task.id&&row.revision===task.revision&&row.contentSha256===task.contentSha256),"Actual current inbox certifies each exact task");
  gate.entered.resolve();await gate.release.promise;return response;
 };
 t.after(async()=>{for(const gate of gates)gate.release.resolve();await Promise.allSettled(q.calls.map(call=>call.pending));});
 for(const task of [q.task,q.secondTask,q.thirdTask]){
  const gate={entered:sceneDeferred(),release:sceneDeferred()};gates.push(gate);
  await f.act(q.button(task.artifactId));await gate.entered.promise;await flushStoreFrames(h);await f.settle();
 }
 const indices=order==="oldest-first"?[0,1,2]:[2,1,0];
 for(const index of indices){gates[index].release.resolve();await q.calls[index].pending;await flushStoreFrames(h);await f.settle();}
 assert.deepEqual(q.calls.map(call=>call.value),[false,false,true]);
 await assertExactTask(q,q.thirdTask);
});

for(const change of ["invalid-latest","route","route-aba","source-denied","source-denied-restored"])
test("queued selection retires conservatively / "+change,{timeout:30_000},async t=>{
 const q=await actionFixture(t,change.startsWith("source-")?"same-document":"cross-project"),{h,f}=q,{gates,made}=holdContextHeaders(t,q);
 const origin=h.store.route.get(),source=h.store.captureSourceOwnership(),context=h.store.session.get().projectContext;
 await f.act(q.button(q.task.artifactId));await(await made[0].promise).entered.promise;
 await f.act(q.button(q.secondTask.artifactId));await f.settle();assert.equal(gates.length,1);
 if(change==="invalid-latest"){
  // Explicit malformed public action boundary; no fabricated task is put into the inbox.
  assert.equal(await h.store.openAssignedReview({...q.thirdTask,contentSha256:"invalid"}),false);
 }else if(change==="route"||change==="route-aba"){
  h.store.setRoute("/projects");if(change==="route-aba")h.store.setRoute(origin);await f.settle();
 }else{
  // The earlier real selection revoked the not-yet-replaced browser cookie.
  await assert.rejects(h.store.refreshEvents(),/403/);
  assert.equal(h.store.sourceOwnershipActive(source),false);
  assert.equal(h.store.events.get().length,0);
 }
 gates[0].release.resolve();await Promise.all(q.calls.map(call=>call.pending));
 assert.equal(gates.length,1,"No queued context mutation survives retirement");
 assert.ok(q.calls.every(call=>call.value===false));
 assert.equal(h.store.route.get(),change==="route"?"/projects":origin);
 if(change.startsWith("source-")){
  assert.equal(h.store.events.get().length,0);assert.equal(h.store.sourceOwnershipActive(source),false);
  if(change==="source-denied-restored"){
   await h.store.refreshEvents();await f.settle();assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
   assert.equal(h.store.sourceOwnershipActive(source),false,"A genuinely renewed source cannot revive the old action");
  }
 }else assert.deepEqual(h.store.session.get().projectContext,context,"Disowned context responses do not publish a different selection");
 if(change==="invalid-latest"){
  // A later explicit valid selection is a new intent, not an automatic retry.
  h.intercept=undefined;
  assert.equal(await h.store.openAssignedReview(q.thirdTask),true);await assertExactTask(q,q.thirdTask);
 }
});
test("rejected context handshake settles before a later explicit valid selection",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"cross-project",{differentTargets:true}),{h}=q;
 const before=h.requests.length,origin=h.store.route.get();
 // This is a public input validation/authorization control. Its rejected endpoint is the real Worker.
 assert.equal(await h.store.openAssignedReview({...q.task,projectAccessId:"unavailable-project"}),false);
 assert.equal(h.store.route.get(),origin);
 const rejected=h.requests.slice(before).filter(row=>row.init.method==="POST"&&row.url.endsWith("/context"));
 assert.equal(rejected.length,1);
 h.store.ui.toast="";
 assert.equal(await h.store.openAssignedReview(q.secondTask),true);await assertExactTask(q,q.secondTask);
});
test("lost context response settles without dispatch retry and allows later explicit selection",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"cross-project",{differentTargets:true}),{h}=q;let attempts=0;
 h.intercept=async request=>{
  if(request.init.method!=="POST"||!request.url.endsWith("/context"))return;
  attempts++;const response=await q.nativeRequest(request);assert.equal(response.status,200);
  throw new TypeError("Synthetic loss after actual context headers");
 };
 assert.equal(await h.store.openAssignedReview(q.task),false);assert.equal(attempts,1);
 h.intercept=undefined;h.store.ui.toast="";
 assert.equal(await h.store.openAssignedReview(q.secondTask),true);await assertExactTask(q,q.secondTask);
});

for(const olderSurface of ["picker","leave"])for(const cancel of [false,true])
test("shared handshake / old "+olderSurface+" then "+(cancel?"cancel latest":"assigned review"),{timeout:30_000},async t=>{
 const q=await actionFixture(t,olderSurface==="picker"?"cross-project":"same-document",{differentTargets:olderSurface==="picker",personalSource:true}),{h,f}=q,{gates,made}=holdContextHeaders(t,q);
 const origin=h.store.route.get();
 let older;
 if(olderSurface==="picker"){
  h.store.setRoute("/settings/workspaces");await f.settle();
  older=f.act(f.find("button",node=>node.owner.tag==="forma-workspace-settings"&&node.attributes["aria-label"]==="Open Assigned Project C"));
 }else older=f.act(f.find("button",node=>node.owner.tag==="forma-activity"&&node.text.includes("View all my assigned reviews")));
 await(await made[0].promise).entered.promise;
 if(olderSurface==="picker"){h.store.setRoute(origin);await f.settle();}
 const latest=q.thirdTask;
 await f.act(q.button(latest.artifactId));await f.settle();assert.equal(gates.length,1);
 if(cancel){h.store.setRoute("/projects");await f.settle();}
 gates[0].release.resolve();await older;
 if(cancel){
  await Promise.all(q.calls.map(call=>call.pending));assert.equal(gates.length,1);assert.equal(h.store.route.get(),"/projects");assert.ok(q.calls.every(call=>call.value===false));
 }else{
  const gate=await made[1].promise;await gate.entered.promise;assert.equal(gate.response.status,200);gate.release.resolve();
  await Promise.all(q.calls.map(call=>call.pending));assert.equal(gates.length,2);assert.equal(q.calls.at(-1).value,true);await assertExactTask(q,latest);
 }
});
test("changed authenticated principal retires queued selection without consuming its response",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"cross-project",{differentTargets:true}),{h,f}=q,{gates,made}=holdContextHeaders(t,q);
 await f.act(q.button(q.task.artifactId));await(await made[0].promise).entered.promise;
 await f.act(q.button(q.secondTask.artifactId));await f.settle();assert.equal(gates.length,1);
 // Native authentication port changes principal; the Store receives the actual Worker session.
 q.activatePrincipal({});await h.store.refreshSession();await f.settle();
 assert.equal(h.store.session.get().user.userId,q.w.owner);
 const actualCurrent=h.store.session.get(),origin=h.store.route.get();
 gates[0].release.resolve();await Promise.all(q.calls.map(call=>call.pending));
 assert.equal(gates.length,1);assert.ok(q.calls.every(call=>call.value===false));
 assert.equal(h.store.session.get(),actualCurrent);assert.equal(h.store.route.get(),origin);
 const live=await q.nativeRequest({url:"/api/session",init:{}});
 // An already in-flight cookie can still arrive after external authentication changes.
 // This is a conservative server denial, not proof of a cross-principal cookie protocol.
 assert.equal(live.status,403);assert.equal((await live.json()).error,"project_access_revoked");
});

test("a source denial while the Settings choice waits cannot report success or reload the retired source",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"same-document",{differentTargets:true}),{h,f}=q,{gates,made}=holdContextHeaders(t,q);
 await f.act(q.button(q.task.artifactId));await(await made[0].promise).entered.promise;
 h.store.setRoute("/settings/workspaces");await f.settle();
 const open=()=>f.find("button",node=>node.owner.tag==="forma-workspace-settings"&&node.attributes["aria-label"]==="Open Assigned Project C");
 await f.act(open());await f.settle();assert.equal(gates.length,1);
 await assert.rejects(h.store.refreshEvents(),/403/);
 const reads=h.requests.filter(row=>row.url==="/api/session").length;
 gates[0].release.resolve();await Promise.all(q.calls.map(call=>call.pending));await f.settle();
 assert.equal(gates.length,1);assert.equal(h.store.events.get().length,0);
 assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),false);
 assert.equal(h.requests.filter(row=>row.url==="/api/session").length,reads,"A canceled Settings intent cannot implicitly refresh authorization");
 assert.equal(f.components().some(component=>component.tag==="forma-workspace-settings"),false,"The retired-source page is not kept mounted for this old action");
});
test("an actual rejected older handshake releases a waiting valid task without an error from the old intent",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"cross-project",{differentTargets:true}),{h,f}=q,{gates,made}=holdContextHeaders(t,q);
 const older=h.store.openAssignedReview({...q.task,projectAccessId:"unavailable-project"});
 await(await made[0].promise).entered.promise;assert.equal(gates[0].response.status,403);
 await f.act(q.button(q.secondTask.artifactId));await f.settle();assert.equal(gates.length,1);
 gates[0].release.resolve();assert.equal(await older,false);
 const latest=await made[1].promise;await latest.entered.promise;assert.equal(latest.response.status,200);latest.release.resolve();
 await Promise.all(q.calls.map(call=>call.pending));await assertExactTask(q,q.secondTask);
});

for(const navigate of [false,true])test("post-DELETE load continuation / "+navigate,{timeout:30_000},async t=>{
 const q=await actionFixture(t,"same-document",{personalSource:true}),{h,f}=q;
 let returned;const originalLeave=h.store.leaveProjectContext;t.mock.method(h.store,"leaveProjectContext",async function(){const value=await originalLeave.call(this);returned=value;return value;});
 const gate={entered:sceneDeferred(),release:sceneDeferred()};let held=false;
 h.intercept=async request=>{
  if(held||!request.url.startsWith("/api/events?")||!h.store.loading.get()||h.store.session.get()?.projectContext)return;
  held=true;const response=await q.nativeRequest(request);assert.equal(response.status,200);
  gate.entered.resolve();await gate.release.promise;return response;
 };
 let activation; t.after(async()=>{gate.release.resolve();await activation;});
 activation=f.act(f.find("button",node=>node.owner.tag==="forma-activity"&&node.text.includes("View all my assigned reviews")));
 await gate.entered.promise;await f.settle();
 let expected="/activity?document=assigned-personal-document-a";
 if(navigate){
  const links=f.tree().visible("a");
  console.log("POST_LEAVE_LINKS",JSON.stringify(links.map(node=>({text:node.text,href:node.attributes.href,owner:node.owner.tag}))));
  const target=f.find("a",node=>String(node.attributes.href).startsWith("/library"));
  assert.ok(target.owner.isConnected&&target.port.isConnected);await f.act(target,"click",{button:0});expected=h.store.route.get();
  assert.ok(expected.startsWith("/library"));
 }
 gate.release.resolve();await activation;await flushStoreFrames(h);await f.settle();
 console.log("POST_LEAVE_OBSERVATION",JSON.stringify({navigate,expected,route:h.store.route.get()}));
 assert.equal(h.store.route.get(),expected,"A later explicit connected navigation owns the route after the earlier leave load finishes");
 assert.equal(returned,!navigate,"Only the still-current leave completes the Activity continuation");
});

test("actual Settings can select a current authorized project after its old browser cookie expires",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"same-document",{differentTargets:true}),{h,f}=q;
 const expiresAt=Date.parse(h.store.session.get().projectContext.expiresAt);assert.ok(Number.isFinite(expiresAt));
 t.mock.method(Date,"now",()=>expiresAt+1);q.expireCookie();
 h.store.setRoute("/settings/workspaces");await f.settle();
 const button=f.find("button",node=>node.owner.tag==="forma-workspace-settings"&&node.attributes["aria-label"]==="Open Assigned Project C");
 const baseline=h.requests.length,loads=[],nativeLoad=h.store.load;
 t.mock.method(h.store,"load",function(...args){const pending=nativeLoad.apply(this,args);loads.push(pending);return pending;});
 await f.act(button);
 for(let i=0;i<40&&!loads.length;i++)await new Promise(setImmediate);
 if(loads.length)await Promise.all(loads);await f.settle();
 const mutations=h.requests.slice(baseline).filter(row=>row.init.method==="POST"&&row.url.endsWith("/context"));
 console.log("SETTINGS_EXPIRY",JSON.stringify({mutations:mutations.length,route:h.store.route.get(),project:h.store.session.get().projectContext?.projectId}));
 assert.equal(mutations.length,1,"An explicitly chosen authorized project remains reachable after browser expiration");
 assert.equal(h.store.session.get().projectContext.projectId,q.secondTask.projectId);assert.equal(h.store.route.get(),"/projects");
});

test("an old assigned task cannot dispatch after its captured current context expires",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"same-document"),{h}=q,expiresAt=Date.parse(h.store.session.get().projectContext.expiresAt);
 t.mock.method(Date,"now",()=>expiresAt+1);q.expireCookie();
 const before=h.requests.length;
 assert.equal(await h.store.openAssignedReview(q.task),false);
 assert.equal(h.requests.slice(before).filter(row=>row.init.method==="POST"&&row.url.endsWith("/context")).length,0);
});

test("Settings retains its existing localized rejection and releases its busy control",{timeout:30_000},async t=>{
 const q=await actionFixture(t,"cross-project",{differentTargets:true}),{h,f}=q;
 h.store.setRoute("/settings/workspaces");await f.settle();
 const overview=await responseBody(await q.nativeRequest({url:"/api/workspaces",init:{}}));
 const project=overview.projects.find(row=>row.projectAccessId===q.task.projectAccessId);assert.ok(project);
 const open=()=>f.find("button",node=>node.owner.tag==="forma-workspace-settings"&&node.attributes["aria-label"]==="Open "+project.projectName);
 assert.ok(open().owner.isConnected);await q.revoke();
 const gate={entered:sceneDeferred(),release:sceneDeferred()};let expected="";
 h.intercept=async request=>{
  if(request.init.method!=="POST"||!request.url.endsWith("/context"))return;
  const response=await q.nativeRequest(request);assert.equal(response.status,403);
  const body=await response.clone().json(),owner=open().owner;
  expected=owner.i18n.t("workspace.admin.error."+body.error,owner.i18n.t("workspace.admin.unavailable","This workspace is unavailable."));
  gate.entered.resolve();await gate.release.promise;return response;
 };
 t.after(()=>gate.release.resolve());
 await f.act(open());await gate.entered.promise;await f.settle();
 assert.equal(Object.hasOwn(open().attributes,"disabled"),true,"The original busy control remains disabled until the actual response");
 gate.release.resolve();await f.settle();
 await waitFor(()=>!Object.hasOwn(open().attributes,"disabled")&&f.tree().root.text.includes(expected),"Existing localized rejection and finally cleanup");
 assert.equal(h.store.route.get(),"/settings/workspaces");assert.equal(h.store.session.get().projectContext,undefined);
});

after(()=>{assert.ok(registered>0,"At least one named case is selected");if(!selection)assert.equal(registered,33);assert.equal(externalCount(),0);assert.ok(sceneCostFixtureProof.maximumBindings<=100);globalThis.fetch=originalFetch;console.log("ASSIGNED_NATIVE_PROOF",JSON.stringify({fixtures:sceneCostFixtureProof.fixtures,queryShapes:sceneCostFixtureProof.nativeQueries.size,maximumBindings:sceneCostFixtureProof.maximumBindings,external:externalCount()}));});
