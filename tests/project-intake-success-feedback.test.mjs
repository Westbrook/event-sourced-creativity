// Additive regression: actual Projects/Shell/Store/Worker fixture.
// Finite native ports; no browser, production or provider certification.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute,documentViewFromRoute,withDocumentInRoute} from "../src/model/routes.ts";
import {AUTHORED,createProjectIntakeFixture,assertComplete,intendedIds} from "./helpers/project-intake-fixture.mjs";

const options={concurrency:false,timeout:45000};
const count=x=>x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(x.worker.streamId).count;

async function loseOriginal(x){
  let first=null;
  x.setBehavior(async(stage,row)=>{
    if(stage==="after-worker"&&!first){
      first=row;row.dropped=true;
      throw Error("Synthetic lost ACK after the actual original intake commit");
    }
  });
  await x.submit();assert.ok(first);assertComplete(first);return first;
}

async function createLaterProject(x,first){
  const events=structuredClone(first.body.events),projectId=crypto.randomUUID(),documentId=crypto.randomUUID();
  for(const[index,event]of events.entries()){
    event.payload.project_id=projectId;
    if(index)event.payload.document_id=documentId;
    delete event.payload.client_event_id;
    if(event.payload.block_id)event.payload.block_id=crypto.randomUUID();
  }
  events[0].payload.name="Later project B";events[1].payload.title="Later document B";
  const result=await x.raw(events);
  assert.equal(result.response.status,200);assert.equal(result.body.status,"complete");
  return{projectId,documentId};
}

for(const locale of["en","ja"])for(const scenario of["fresh","recovered-feed","recovered-projects-profile","removed-original"]){
  test("intake success feedback stays bound to the exact original arrival "+JSON.stringify({locale,scenario}),options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale});
    if(scenario==="recovered-projects-profile"){
      await x.h.store.load();await x.f.settle();
      assert.equal(x.h.store.error.get(),"");
      assert.equal(x.h.store.routeDataReady("/projects"),true);
      assert.equal(x.h.store.routeDataReady("/"),false);
      assert.equal(x.f.components().includes(x.owner),true);
      assert.deepEqual(x.visible().draft,AUTHORED);
    }
    const source=x.h.store.captureSourceOwnership(),success=[];
    const unsubscribe=x.h.store.subscribe(()=>{
      if(!x.h.store.ui.toast.includes(AUTHORED.name))return;
      // Observe actual publication; never throw through Store.notify or alter
      // its route, methods, callback, result, authority or current projection.
      const p=x.h.store.projection.get();
      success.push({route:x.h.store.route.get(),projectId:p.projectId,documentId:p.documentId,
        sourceCurrent:x.h.store.sourceOwnershipActive(source),toast:x.h.store.ui.toast});
    });
    t.after(unsubscribe);
    let first,original,later=null,before;
    if(scenario==="fresh"){
      before=count(x);await x.submit();await x.f.settle();
      first=x.dispatches[0];original=assertComplete(first);
      assert.equal(count(x)-before,first.body.events.length);
      assert.equal(x.dispatches.length,1);
    }else{
      first=await loseOriginal(x);original=intendedIds(first.body.events);
      later=await createLaterProject(x,first);
      if(scenario==="removed-original"){
        const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({action:"append",event:{type:"DocumentRemoved",payload:{project_id:original.projectId,document_id:original.documentId}}})});
        const body=await response.json();assert.equal(response.status,200,body.error);
        assert.equal(body.appended.some(event=>event.type==="DocumentRemoved"),true);
      }
      if(scenario==="recovered-feed"){
        await x.h.store.refreshEvents();await x.f.settle();
        assert.equal(x.h.store.projection.get().projectId,later.projectId);
        assert.equal(x.h.store.projection.get().documentId,later.documentId);
      }
      assert.equal(x.h.store.route.get(),"/projects");
      assert.equal(x.h.store.sourceOwnershipActive(source),true);
      assert.deepEqual(success,[],"the lost reply did not publish a completion notice");
      before=count(x);await x.check();await x.f.settle();
      const checked=x.dispatches.at(-1);assertComplete(checked);
      assert.equal(x.dispatches.length,2);assert.equal(checked.body.intakeAction,"check");
      assert.deepEqual(checked.reply.appended.map(event=>event.eventId),first.reply.appended.map(event=>event.eventId));
      assert.equal(count(x),before,"the exact completion check/arrival appends no creation or navigation event");
    }
    const route=x.h.store.route.get(),p=x.h.store.projection.get();
    t.diagnostic(JSON.stringify({locale,scenario,original,later,route,
      titledOriginal:withDocumentInRoute("/",original.documentId,AUTHORED.documentTitle),
      actualProjection:{projectId:p.projectId,documentId:p.documentId},success}));
    if(scenario==="removed-original"){
      assert.equal(route,"/projects");assert.deepEqual(success,[],"confirmed but unavailable creation must not announce an opened destination");
      const buttons=x.f.tree().visible("button").filter(node=>node.owner===x.owner);
      assert.equal(buttons.some(node=>node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation")),false);
      assert.equal(buttons.some(node=>node.text===x.f.i18n.t("projects.checkOriginalAvailability","Check original availability")),true);
      return;
    }
    assert.equal(documentIdFromRoute(route),original.documentId);
    assert.equal(documentViewFromRoute(route),"document");
    assert.equal(p.projectId,original.projectId);assert.equal(p.documentId,original.documentId);
    assert.equal(x.h.store.sourceOwnershipActive(source),true);
    assert.ok(success.length>0,"the exact successful arrival publishes its original creation notice");
    for(const observed of success){
      assert.equal(documentIdFromRoute(observed.route),original.documentId);
      assert.equal(documentViewFromRoute(observed.route),"document");
      assert.equal(observed.projectId,original.projectId);assert.equal(observed.documentId,original.documentId);
      assert.equal(observed.sourceCurrent,true);
    }
  });
}
