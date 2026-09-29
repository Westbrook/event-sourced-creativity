import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { documentContextBlockRoute } from "../src/model/routes.ts";
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function navigationFixture(t){
 const f=await createOutputReachabilityPage(t),h=f.storeHost,doc=f.outputSnapshot().documentId,block=f.outputSnapshot().requirements[0].blockId;
 h.transport=request=>request.url==="/api/workspaces/reviews"?Response.json({tasks:[]}):h.worker.request(request.url,request.init);
 const session=structuredClone(f.store.session.get()),source="/canvas/board-original/board-original?posture=outcomes&outcome=target%3Aoriginal",destination=documentContextBlockRoute(doc,"Synthetic Document A",block);
 f.store.route.set(source);h.location.pathname="/canvas/board-original/board-original";h.location.search="?posture=outcomes&outcome=target%3Aoriginal";
 const previousHistory=globalThis.history,historyWrites=[];globalThis.history={pushState(_state,_unused,url){historyWrites.push(url);const next=new URL(url,"http://localhost");Object.assign(h.location,{pathname:next.pathname,search:next.search,hash:next.hash});},replaceState(_state,_unused,url){this.pushState(_state,_unused,url);}};
 t.after(()=>{globalThis.history=previousHistory;assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(row)),[],"navigation never writes events, purchases, or settles costs");});
 return{...f,h,doc,session,source,destination,historyWrites};
}
test("actual Store optional Desk guard allows one deliberate Canvas→Creator transition without writes",async t=>{
 const f=await navigationFixture(t),events=JSON.stringify(f.store.events.get());
 let checks=0;const result=await f.store.transitionWorkspace(f.destination,{documentFocus:false,current:()=>{checks++;return f.store.route.get()===f.source;}});
 assert.equal(result,true);assert.equal(f.store.route.get(),f.destination);assert.equal(f.historyWrites.length,1);assert.ok(checks>=4);
 assert.equal(JSON.stringify(f.store.events.get()),events);
});
for(const boundary of ["headers","body"])for(const change of ["same-canvas-route","selection","authorization"])
test("actual Store Desk "+change+" during "+boundary+" never redirects newer work",async t=>{
 const f=await navigationFixture(t),gate=deferred(),entered=deferred();let selection="original";
 f.h.intercept=async request=>{
  if(!request.url.startsWith("/api/session?"))return;
  if(boundary==="headers"){entered.resolve();await gate.promise;return Response.json(f.session);}
  const response=Response.json(f.session),json=response.json.bind(response);response.json=async()=>{entered.resolve();await gate.promise;return json();};return response;
 };
 const scope=f.store.captureAuthorizationScope();
 const current=()=>f.store.route.get()===f.source&&selection==="original"&&f.store.authorizationScopeActive(scope);
 const pending=f.store.transitionWorkspace(f.destination,{documentFocus:false,current});await entered.promise;
 if(change==="same-canvas-route")f.store.route.set("/canvas/board-original/board-original?posture=outcomes&outcome=target%3Anewer");
 else if(change==="selection")selection="newer";
 else f.store.session.set({...f.session,permissionEpoch:"newer-authority"});
 const route=f.store.route.get(),sessionKey=f.store.captureAuthorizationScope().key;gate.resolve();
 assert.equal(await pending,false);assert.equal(f.store.route.get(),route);assert.equal(f.store.captureAuthorizationScope().key,sessionKey);assert.deepEqual(f.historyWrites,[]);
});
test("actual unguarded Store navigation preserves existing callers",async t=>{
 const f=await navigationFixture(t);assert.equal(await f.store.transitionWorkspace(f.destination,{documentFocus:false}),true);assert.equal(f.store.route.get(),f.destination);
});
test("stale Desk navigation still processes same-actor project-denial retirement",async t=>{
 const f=await navigationFixture(t),gate=deferred(),entered=deferred();let owns=true;
 const candidate={...f.session,projectContext:{organizationId:"different-org",projectAccessId:"different-access",projectId:"different-project",ownerUserId:"other-owner",role:"viewer",permissions:["project.read"],expiresAt:"2099-01-01T00:00:00Z"},permissionEpoch:"withdrawn-original"};
 f.h.intercept=async request=>{if(!request.url.startsWith("/api/session?"))return;entered.resolve();await gate.promise;return Response.json(candidate);};
 const pending=f.store.transitionWorkspace(f.destination,{current:()=>owns});await entered.promise;owns=false;gate.resolve();
 assert.equal(await pending,false);assert.equal(f.store.route.get(),f.source);assert.deepEqual(f.historyWrites,[]);
 assert.equal(f.store.session.get().projectContext.projectAccessId,"different-access");
 assert.equal(f.store.outputRequirements.resource(f.doc).snapshot,null,"original private cache is retired, not held alive by a stale navigation");
});
