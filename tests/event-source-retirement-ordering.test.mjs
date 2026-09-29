
import {test as nodeTest} from "node:test";const test=(name,body)=>nodeTest(name,{timeout:10000},body);import assert from "node:assert/strict";
import { sourceFixture,writeFixture,sceneDeferred,eventRequest,pause,withDocumentInRoute,untilScene,accountCachePort,snapshotIdentity,input,eventPost } from "./helpers/event-source-retirement-fixture.mjs";
for(const order of["hydration-first","stream-first"])test("healthy Chat load keeps complete event coverage with "+order,async t=>{
 const h=await sourceFixture(t),gate=sceneDeferred(),entered=sceneDeferred(),other=sceneDeferred();t.after(()=>gate.resolve());
 const {FormaStore}=h.modules.get("src/state/store.ts");h.store=new FormaStore();h.store.route.set(withDocumentInRoute("/studio/chat",h.worker.documentId));
 let streams=0,hydrations=0;
 h.intercept=async request=>{
  if(!eventRequest(request))return;
  const hydration=request.url.includes("contentScope=chat"),response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  if(hydration)hydrations++;else streams++;
  if(hydration===(order==="stream-first")){entered.resolve();await gate.promise;}else other.resolve();
  return response;
 };
 const pending=h.store.load();await entered.promise;await other.promise;await pause();await pause();gate.resolve();await pending;await pause();
 assert.ok(streams>=1);assert.equal(hydrations,1);assert.equal(h.store.error.get(),"");
 assert.ok(h.store.events.get().length>0);assert.equal(h.store.projection.get().projectId,h.worker.projectId);
 assert.equal(h.store.projection.get().documentId,h.worker.documentId);assert.equal(h.store.routeDataReady(),true);
});

async function freeChat(h,id){
 const response=await h.worker.request("/api/assistant?route="+encodeURIComponent("/document/"+h.worker.documentId)+"&projectId="+encodeURIComponent(h.worker.projectId),
  {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({turnId:id,message:"Keep this exact private Chat statement "+id,locale:"en"})});
 assert.equal(response.status,201,await response.clone().text());
 const row=h.worker.sqlite.prepare("SELECT user_content_ref,assistant_content_ref FROM assistant_turns WHERE turn_id=?").get(id);
 assert.ok(row?.user_content_ref);return row;
}
for(const order of["hydration-first","stream-first"])test("healthy cached Chat revalidation keeps complete source and exact private body with "+order,async t=>{
 const h=await writeFixture(t,{shared:false});accountCachePort(t);
 const row=await freeChat(h,"ordering-chat-"+order),accountCache=h.modules.get("src/state/account-cache.ts");
 await h.store.refreshEvents();const identity=snapshotIdentity(h.store.session.get()),expected=h.store.content.get()[row.user_content_ref];
 assert.equal(typeof expected,"string");await accountCache.writeAccountSnapshot(identity,h.store.events.get(),h.store.head.get(),"full");
 const {FormaStore}=h.modules.get("src/state/store.ts");h.store=new FormaStore();h.store.route.set(withDocumentInRoute("/studio/chat",h.worker.documentId));
 const gate=sceneDeferred(),entered=sceneDeferred(),other=sceneDeferred();t.after(()=>gate.resolve());let streams=0,hydrations=0,completedStream=false;
 h.intercept=async request=>{
  if(!eventRequest(request))return;const hydration=request.url.includes("contentScope=chat"),response=await h.worker.request(request.url,request.init);
  assert.equal(response.status,200);if(hydration)hydrations++;else streams++;
  if(hydration===(order==="stream-first")){entered.resolve();await gate.promise;}else other.resolve();
  if(!hydration)completedStream=true;return response;
 };
 const pending=h.store.load();await entered.promise;await other.promise;await pause();await pause();gate.resolve();await pending;
 await untilScene(()=>completedStream&&h.store.content.get()[row.user_content_ref]===expected);
 assert.ok(streams>=1);assert.equal(hydrations,1);assert.equal(h.store.error.get(),"");assert.equal(h.store.routeDataReady(),true);
 assert.equal(h.store.projection.get().projectId,h.worker.projectId);assert.equal(h.store.content.get()[row.user_content_ref],expected);
});
test("newer targeted hydration keeps its exact ref body when an older complete stream returns an earlier body",async t=>{
 const h=await writeFixture(t,{shared:false}),row=await freeChat(h,"ordering-body-newer-hydration");
 const oldBody=h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(row.user_content_ref).content;
 const fullGate=sceneDeferred(),fullEntered=sceneDeferred();t.after(()=>fullGate.resolve());let held=false;
 h.intercept=async request=>{
  if(!eventRequest(request))return;
  const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  if(!held&&request.url.includes("content=1")){held=true;const body=await response.clone().json();assert.equal(body.content[row.user_content_ref],oldBody);fullEntered.resolve();await fullGate.promise;}
  return response;
 };
 const pending=h.store.refreshEvents();await fullEntered.promise;
 const newBody="Exact current Chat body after the earlier full response";
 h.worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(newBody,row.user_content_ref);
 assert.equal(await h.store.ensurePrivateContent(row.user_content_ref,{force:true}),newBody);
 fullGate.resolve();await pending;
 assert.equal(h.store.content.get()[row.user_content_ref],newBody);assert.notEqual(h.store.content.get()[row.user_content_ref],oldBody);
 assert.equal(h.store.error.get(),"");assert.equal(h.store.routeDataReady(),true);
});
test("a newer completed source prevents an older targeted hydration from rolling private content back",async t=>{
 const h=await writeFixture(t,{shared:false}),row=await freeChat(h,"ordering-body-original");await h.store.refreshEvents();
 const oldBody=h.store.content.get()[row.user_content_ref],gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());let held=false;
 h.intercept=async request=>{
  if(!eventRequest(request))return;
  const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  if(!held&&request.url.includes("content=1")){held=true;entered.resolve();await gate.promise;}return response;
 };
 const pending=h.store.ensurePrivateContent(row.user_content_ref,{force:true});await entered.promise;
 const newBody="Exact later full-source private Chat body";
 h.worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(newBody,row.user_content_ref);
 await freeChat(h,"ordering-new-complete-source");await h.store.refreshEvents();
 assert.equal(h.store.content.get()[row.user_content_ref],newBody);gate.resolve();assert.equal(await pending,null);
 assert.equal(h.store.content.get()[row.user_content_ref],newBody);assert.notEqual(newBody,oldBody);
});
test("an older complete replacement does not preserve a newer hydration ref absent from that event source",async t=>{
 const h=await writeFixture(t,{shared:false}),{FormaStore}=h.modules.get("src/state/store.ts");
 h.store=new FormaStore();h.store.route.set(withDocumentInRoute("/studio/chat",h.worker.documentId));
 const chatGate=sceneDeferred(),fullGate=sceneDeferred(),fullEntered=sceneDeferred();t.after(()=>{chatGate.resolve();fullGate.resolve();});let first=true;
 h.intercept=async request=>{
  if(!eventRequest(request))return;
  if(request.url.includes("contentScope=chat")){await chatGate.promise;return h.worker.request(request.url,request.init);}
  const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  if(first){first=false;fullEntered.resolve();await fullGate.promise;}return response;
 };
 const pending=h.store.load();await fullEntered.promise;const row=await freeChat(h,"ordering-not-in-earlier-source");
 chatGate.resolve();await untilScene(()=>typeof h.store.content.get()[row.user_content_ref]==="string");
 fullGate.resolve();await pending;assert.equal(h.store.content.get()[row.user_content_ref],undefined);
 assert.equal(h.store.events.get().some(event=>event.payload.content_ref===row.user_content_ref),false);
 await h.store.refreshEvents();assert.equal(typeof h.store.content.get()[row.user_content_ref],"string");
});

for(const renewed of[false,true])test("a delayed actual source 200 cannot use an expired captured deadline"+(renewed?" after same-key renewal":""),async t=>{
 const h=await writeFixture(t),session=h.store.session.get(),deadline=Date.parse(session.projectContext.expiresAt),gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());
 let now=deadline-1000;t.mock.method(Date,"now",()=>now);
 const original=h.store.captureSourceOwnership(),head=h.store.head.get();
 const appended=await h.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"append",event:input(h,"deadline-source-"+renewed,true)})});
 assert.equal(appended.status,200,await appended.clone().text());const event=(await appended.json()).appended.find(row=>row.type==="BlockCreated");assert.ok(event);
 let held=false;
 h.intercept=async request=>{if(!eventRequest(request)||held)return;held=true;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);entered.resolve();await gate.promise;return response;};
 const pending=h.store.refreshEvents();await entered.promise;now=deadline+1;
 if(renewed){
  h.worker.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new Date(deadline+60000).toISOString(),h.worker.sharing.contextId);
  await h.store.refreshSession();assert.equal(h.store.captureAuthorizationScope().key,original.authorization.key);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),true);
 }
 assert.equal(h.store.sourceOwnershipScopeActive(original),true);assert.equal(h.store.sourceOwnershipActive(original),false);
 gate.resolve();await assert.rejects(pending,/superseded|source|workspace/i);
 assert.equal(h.store.head.get(),head);assert.equal(h.store.events.get().some(row=>row.eventId===event.eventId),false);
 if(renewed){await h.store.refreshEvents();assert.ok(h.store.events.get().some(row=>row.eventId===event.eventId));assert.equal(h.store.sourceOwnershipActive(original),false);}
});
test("an expired captured deadline withholds an actual committed append but retains its exact content-free receipt after renewal",async t=>{
 const h=await writeFixture(t),deadline=Date.parse(h.store.session.get().projectContext.expiresAt),gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());
 let now=deadline-1000;t.mock.method(Date,"now",()=>now);const original=h.store.captureSourceOwnership(),event=input(h,"deadline-original-write",true);let committed;
 h.intercept=async request=>{if(!eventPost(request))return;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);committed=await response.clone().json();entered.resolve();await gate.promise;return response;};
 const pending=h.store.appendWithReceipt(event);await entered.promise;now=deadline+1;
 h.worker.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new Date(deadline+60000).toISOString(),h.worker.sharing.contextId);
 await h.store.refreshSession();assert.equal(h.store.captureAuthorizationScope().key,original.authorization.key);assert.equal(h.store.sourceOwnershipActive(original),false);
 gate.resolve();const result=await pending;assert.equal(result.publication,"withheld");assert.equal(result.acknowledgment.outcome,"observed");
 assert.deepEqual(result.appended,[]);assert.deepEqual(result.acknowledgment.committed.map(row=>row.eventId),committed.appended.filter(row=>row.actor!=="worker:validator").map(row=>row.eventId));
 assert.equal(h.store.eventWriteAcknowledgments(result.acknowledgment.owner).length,1);assert.equal(JSON.stringify(result.acknowledgment).includes(event.payload.properties.text),false);
 assert.equal(h.requests.filter(eventPost).length,1);
});
test("current selected-source expiry invalidates a newer capture while original scope bookkeeping remains exact",async t=>{
 const h=await writeFixture(t),original=h.store.captureSourceOwnership(),oldDeadline=Date.parse(h.store.session.get().projectContext.expiresAt);
 const shortened=new Date(Date.now()+1000).toISOString();
 h.worker.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(shortened,h.worker.sharing.contextId);
 await h.store.refreshSession();assert.equal(h.store.captureAuthorizationScope().key,original.authorization.key);
 let now=Date.parse(shortened)+1;assert.ok(now<oldDeadline);t.mock.method(Date,"now",()=>now);
 assert.equal(h.store.sourceOwnershipScopeActive(original),true);assert.equal(h.store.sourceOwnershipActive(original),false);
 assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()),false);
});
for(const shared of[true,false])test("healthy "+(shared?"selected":"unbounded personal")+" source ownership remains active without a new session authority",async t=>{
  const h=await writeFixture(t,{shared}),source=h.store.captureSourceOwnership(),session=structuredClone(h.store.session.get());
  assert.equal(h.store.sourceOwnershipActive(source),true);assert.equal(h.store.sourceOwnershipScopeActive(source),true);
  await h.store.refreshEvents();assert.equal(h.store.sourceOwnershipActive(source),true);assert.deepEqual(h.store.session.get(),session);
});
