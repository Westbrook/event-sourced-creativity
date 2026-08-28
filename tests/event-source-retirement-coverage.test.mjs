import {test as nodeTest} from "node:test";
import assert from "node:assert/strict";
import { writeFixture,accountCachePort,snapshotIdentity,sceneDeferred,eventRequest,withDocumentInRoute,appendAuditEvent,untilScene } from "./helpers/event-source-retirement-fixture.mjs";
import {AccountCacheIndexedDbFixture} from "./helpers/account-cache-indexeddb-fixture.mjs";
const test=(name,body)=>nodeTest(name,{timeout:18000},body);
const key=identity=>[identity.principalUserId??identity.userId,identity.userId,identity.audience??"creative",identity.organizationId??"personal",identity.projectAccessId??"personal",identity.permissionEpoch??"legacy",identity.policyVersion].map(encodeURIComponent).join(":")+":v3";
function nativeCache(t,h){
 const previous=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");accountCachePort(t);
 const other=globalThis.indexedDB,native=new AccountCacheIndexedDbFixture(),api=h.modules.get("src/state/account-cache.ts"),writes=[];
 Object.defineProperty(globalThis,"indexedDB",{configurable:true,writable:true,value:{open:(name,version)=>name===native.name?native.open(name,version):other.open(name,version)}});
 const write=api.writeAccountSnapshot;api.writeAccountSnapshot=(...args)=>{const row={args,settled:false,value:null};writes.push(row);const pending=write(...args);pending.then(value=>{row.value=value;row.settled=true;},()=>{row.settled=true;});return pending;};
 t.after(async()=>{try{await native.quiet();native.assertConsistent();}finally{api.writeAccountSnapshot=write;if(previous)Object.defineProperty(globalThis,"indexedDB",previous);else delete globalThis.indexedDB;}});
 return{native,api,writes,settled:async count=>{await untilScene(()=>writes.length>=count&&writes.slice(0,count).every(row=>row.settled));}};
}
async function fresh(h){const {FormaStore}=h.modules.get("src/state/store.ts");h.store=new FormaStore();h.store.route.set(withDocumentInRoute("/projects",h.worker.documentId));await h.store.load();}
async function oldDenial(t,h){
 const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());let first=true;
 h.intercept=async request=>{if(!eventRequest(request)||!first)return;first=false;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,403);entered.resolve();await gate.promise;return response;};
 h.revoke();const pending=h.store.refreshEvents().then(()=>null,error=>error);await entered.promise;h.restore();return{gate,pending};
}
async function narrowBase(t){
 const h=await writeFixture(t),cache=nativeCache(t,h);
 const hidden=await appendAuditEvent(h.worker.env,h.worker.streamId,"user","BlockPropertyEdited",{project_id:h.worker.projectId,document_id:h.worker.documentId,block_id:"scene-reuse-direction",key:"text",value:"Synthetic complete history absent from projects-only cache"});
 const response=await h.worker.request("/api/events?after=0&limit=5000&content=0");assert.equal(response.status,200);const full=await response.json();assert.ok(full.events.some(row=>row.eventId===hidden.eventId));
 await fresh(h);await cache.settled(1);await fresh(h);await cache.settled(2);
 assert.equal(h.store.events.get().some(row=>row.eventId===hidden.eventId),false);assert.equal(h.store.routeDataReady("/memory"),false);
 assert.equal(cache.native.row(key(snapshotIdentity(h.store.session.get()))).profile,"projects");
 return{h,cache,hidden,full};
}
test("an actual full-base unchanged incremental source can supersede an older owned denial",async t=>{
 const h=await writeFixture(t),cache=nativeCache(t,h),identity=snapshotIdentity(h.store.session.get()),source=h.store.captureSourceOwnership();
 const fence=cache.api.captureAccountSnapshotFence(identity,"full");assert.equal(await cache.api.writeAccountSnapshot(identity,h.store.events.get(),h.store.head.get(),"full",{fence,current:()=>h.store.sourceOwnershipActive(source)}),true);
 const events=structuredClone(h.store.events.get()),head=h.store.head.get(),row=cache.native.row(key(identity)),old=await oldDenial(t,h);
 await h.store.refreshEvents();old.gate.resolve();assert.match(String(await old.pending),/403/);
 assert.equal(h.retired(),false);assert.deepEqual(h.store.events.get(),events);assert.equal(h.store.head.get(),head);assert.deepEqual(cache.native.row(key(identity)),row);
});
for(const pendingNewer of[false,true])test("a narrow cached base plus "+(pendingNewer?"pending":"completed")+" empty full delta does not certify omitted history",async t=>{
 const {h,cache,hidden,full}=await narrowBase(t),identity=snapshotIdentity(h.store.session.get()),old=await oldDenial(t,h),head=h.store.head.get(),before=h.requests.length;
 const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());
 if(pendingNewer)h.intercept=async request=>{if(!eventRequest(request))return;const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);entered.resolve();await gate.promise;return response;};
 const later=h.store.refreshEvents().then(()=>null,error=>error);if(pendingNewer)await entered.promise;else assert.equal(await later,null);
 assert.ok(h.requests.slice(before).some(request=>request.url==="/api/events?after="+head+"&limit=5000&content=0"));
 assert.equal(h.store.events.get().some(row=>row.eventId===hidden.eventId),false);assert.equal(h.store.routeDataReady("/memory"),false);
 old.gate.resolve();assert.match(String(await old.pending),/403/);assert.equal(h.retired(),true,"a non-covering completed delta must not immunize the original full-source denial");
 gate.resolve();if(pendingNewer)assert.ok(await later,"the delayed source cannot publish after retirement");
 assert.equal(h.retired(),true);await cache.native.quiet();
 const freshFence=cache.api.captureAccountSnapshotFence(identity,"full");assert.deepEqual(await cache.api.readAccountSnapshots(identity,{fence:freshFence,current:()=>true}),[]);
 h.intercept=null;await h.store.refreshEvents();assert.equal(h.retired(),false);assert.ok(h.store.events.get().some(row=>row.eventId===hidden.eventId));
 assert.equal(h.store.events.get().length,full.events.length);assert.deepEqual(await cache.api.readAccountSnapshots(identity,{fence:cache.api.captureAccountSnapshotFence(identity,"full"),current:()=>true}),[],"fresh server coverage alone does not assert optional persistent cache recovery");
 const count=cache.writes.length;await h.store.load();await cache.settled(count+1);assert.equal(cache.writes.at(-1).value,true);assert.ok(cache.native.row(key(identity)));
});
