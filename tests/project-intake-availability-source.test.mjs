// Actual complete Projects/Store/Worker after the public Projects-profile load.
// Prepared only. The from-start read is not a global receipt/non-use certificate.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {AUTHORED,createProjectIntakeFixture,assertComplete,intendedIds} from "./helpers/project-intake-fixture.mjs";
const options={concurrency:false,timeout:45000};
const count=x=>x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(x.worker.streamId).count;
async function unseenNewerProject(x,first){
  const events=structuredClone(first.body.events),projectId=crypto.randomUUID(),documentId=crypto.randomUUID();
  for(const [index,event] of events.entries()){
    event.payload.project_id=projectId;if(index)event.payload.document_id=documentId;
    delete event.payload.client_event_id;if(event.payload.block_id)event.payload.block_id=crypto.randomUUID();
  }
  events[0].payload.name="Unseen newer B";events[1].payload.title="Unseen newer B document";
  const result=await x.raw(events);assert.equal(result.response.status,200);assert.equal(result.body.status,"complete");
  return{projectId,documentId,eventIds:result.body.appended.map(event=>event.eventId)};
}
for(const removed of [false,true])test("intake Projects-profile receipt head preserves exact availability: "+(removed?"unseen pre-head original removal":"healthy original A with unseen newer B"),options,async t=>{
  const x=await createProjectIntakeFixture(t);
  // Public current-route loading establishes the real projects profile. No
  // private profile setter or replacement source/append method is installed.
  await x.h.store.load();await x.f.settle();
  assert.equal(x.h.store.error.get(),"");assert.equal(x.h.store.route.get(),"/projects");
  assert.equal(x.h.store.routeDataReady("/projects"),true);assert.equal(x.h.store.routeDataReady("/"),false);
  assert.equal(x.f.components().includes(x.owner),true,"Same complete Projects owner survives its current Source load");
  assert.deepEqual(x.visible().draft,AUTHORED);
  const source=x.h.store.captureSourceOwnership();
  let first=null;x.setBehavior(async(stage,row)=>{
    if(stage==="after-worker"&&!first){first=row;row.dropped=true;throw Error("Synthetic lost ACK after real intake commit");}
  });
  await x.submit();assert.ok(first);assertComplete(first);
  const original=intendedIds(first.body.events),b=await unseenNewerProject(x,first);
  let removedId=null;
  if(removed){
    const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"append",event:{type:"DocumentRemoved",payload:{project_id:original.projectId,document_id:original.documentId}}})});
    const body=await response.json();assert.equal(response.status,200,body.error);
    const event=body.appended.find(event=>event.type==="DocumentRemoved");assert.ok(event);removedId=event.eventId;
  }
  assert.equal(x.h.store.events.get().some(event=>b.eventIds.includes(event.eventId)||event.eventId===removedId),false,
    "The newer project/removal has not been locally published before original Check");
  const before=count(x),requests=x.dispatches.length,reads=[],prior=x.h.intercept;
  x.h.intercept=async request=>{
    if(request.url.startsWith("/api/events?")){
      const url=new URL(request.url,"http://localhost");
      reads.push({after:url.searchParams.get("after"),content:url.searchParams.get("content"),head:x.h.store.head.get(),
        hasNewer:x.h.store.events.get().some(event=>b.eventIds.includes(event.eventId)),
        hasRemoval:Boolean(removedId&&x.h.store.events.get().some(event=>event.eventId===removedId))});
    }
    return prior(request);
  };
  await x.check();await x.f.settle();
  const checked=x.dispatches.at(-1);assertComplete(checked);
  assert.equal(x.dispatches.length,requests+1);assert.equal(checked.body.intakeAction,"check");
  assert.deepEqual(checked.reply.appended.map(event=>event.eventId),first.reply.appended.map(event=>event.eventId));
  assert.ok(checked.reply.head>Math.max(...first.reply.appended.map(event=>event.sequence)));
  t.diagnostic(JSON.stringify({removed,original,b:{projectId:b.projectId,documentId:b.documentId},removedId,reads,
    receiptHead:checked.reply.head,route:x.h.store.route.get(),eventDelta:count(x)-before}));
  assert.ok(reads.length>0);assert.equal(reads[0].head,checked.reply.head);
  assert.equal(reads[0].after,"0");assert.equal(reads[0].content,"1");
  assert.equal(reads[0].hasNewer,false);assert.equal(reads[0].hasRemoval,false);
  assert.equal(x.h.store.sourceOwnershipActive(source),true);
  assert.equal(x.h.store.events.get().some(event=>b.eventIds.includes(event.eventId)),true);
  assert.equal(count(x),before,"Availability read/navigation creates no event or replacement");
  if(removed){
    assert.equal(x.h.store.events.get().some(event=>event.eventId===removedId),true);
    assert.equal(x.h.store.route.get(),"/projects","Never substitute the newer Document for removed A");
    const buttons=x.f.tree().visible("button").filter(node=>node.owner===x.owner);
    assert.equal(buttons.some(node=>node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation")),false);
    assert.equal(buttons.some(node=>node.text===x.f.i18n.t("projects.checkOriginalAvailability","Check original availability")),true);
    const status=x.f.find("p",node=>node.owner===x.owner&&node.attributes.role==="status");
    assert.equal(status.text,x.f.i18n.t("projects.originalConfirmedUnavailable"));
  }else{
    assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
    assert.equal(x.h.store.projection.get().documentId,original.documentId);
    assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
  }
});
