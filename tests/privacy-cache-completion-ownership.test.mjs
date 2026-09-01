// Actual public Store privacy methods + unchanged routed Worker/RAM SQLite.
// Holds only the existing IndexedDB port's completion; no private method replacement.
import assert from "node:assert/strict";
import test from "node:test";
import {createSceneCostFixture,createSceneStoreHost,accountCachePort,financial,untilScene} from "./helpers/event-source-retirement-fixture.mjs";
const options={concurrency:false,timeout:45000};
const view=h=>({actor:h.store.session.get()?.user.userId,events:h.store.events.get().map(event=>event.eventId),
  content:Object.keys(h.store.content.get()),head:h.store.head.get(),toast:h.store.ui.toast});
for(const method of ["migrateHistoricalEventPrivacy","erasePersonalAuthoredContext"])
for(const change of [false,true])test("privacy cache completion "+method+": "+(change?"new actual actor cannot receive old completion":"healthy same actor"),options,async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No external/provider request"));
  const worker=await createSceneCostFixture(1,"visual",{depth:false}),h=await createSceneStoreHost({workerFixture:worker,exposeSceneTestAccessors:false});
  if(change){
    // Initialize the genuine new account's lazy zero-use budget rows before
    // the financial baseline; do not switch the held operation's Store owner.
    const originalSession=h.store.session.get();
    const initialized=await worker.request("/api/session",{headers:{"oai-authenticated-user-id":"new-privacy-actor","oai-authenticated-user-email":"new-privacy-actor@example.test"}});
    assert.equal(initialized.status,200);
    assert.equal((await initialized.json()).user.userId,"new-privacy-actor");
    assert.equal(h.store.session.get(),originalSession,"Session fixture setup must not change the current Store owner");
  }
  const beforeMoney=financial(worker),oldActor=h.store.session.get().user.userId;
  assert.equal(h.store.session.get().user.role,"admin","Existing actual fixture administrator");
  assert.equal(h.transport,null);let actual=null;
  h.intercept=async request=>{
    if(request.url!=="/api/privacy/events"||request.init.method!=="POST")return;
    const response=await worker.request(request.url,request.init);actual={status:response.status,body:await response.clone().json(),request:request.body};
    return response; // Same actual response, not an emulated success.
  };
  const cache=accountCachePort(t,[1,2]);
  t.after(async()=>{try{assert.deepEqual(financial(worker),beforeMoney);assert.equal(h.requests.filter(row=>row.url.startsWith("/api/document-jobs")&&row.init.method==="POST").length,0);}finally{await h.close();}});
  const pending=h.store[method]();let current,returned;
  try{
    await untilScene(()=>cache.pending.size===2,"Both actual cache clears reached their native open boundary after Worker success");
    assert.equal(actual.status,200,actual.body.error);
    if(method==="migrateHistoricalEventPrivacy")assert.equal(actual.body.migratedEvents,0,"Healthy no-op migration still traverses the real completion path");
    else assert.ok(actual.body.erasedAuthoredEventBodies>0,"Real server-owned erasure happened before the cache hold");
    assert.equal(h.store.session.get().user.userId,oldActor);
    if(change){
      worker.setScopedHeaders({"oai-authenticated-user-id":"new-privacy-actor","oai-authenticated-user-email":"new-privacy-actor@example.test"});
      await h.store.refreshSession();assert.equal(h.store.session.get().user.userId,"new-privacy-actor");
    }
    current=view(h);
  }finally{
    for(const sequence of [...cache.pending.keys()])cache.release(sequence);
    returned=await pending;
  }
  t.diagnostic(JSON.stringify({method,change,status:actual.status,originalActor:oldActor,current,after:view(h),returned}));
  assert.equal(h.requests.filter(row=>row.url==="/api/privacy/events"&&row.init.method==="POST").length,1);
  if(change){assert.equal(returned,false);assert.deepEqual(view(h),current,"Old completion cannot clear or announce inside the new actor");}
  else{assert.equal(returned,true);assert.equal(h.store.session.get().user.userId,oldActor);assert.ok(h.store.ui.toast.length>0);}
});
