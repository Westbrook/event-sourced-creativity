// Actual complete host and routed Worker. Prepared, not executed by author.
// Native event/DOM ports remain finite; these are not browser certification.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {AUTHORED,createProjectIntakeFixture,assertComplete,intendedIds} from "./helpers/project-intake-fixture.mjs";
const options={concurrency:false,timeout:45000};
async function loseOriginal(x){
  let lost=null;x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&!lost){lost=row;row.dropped=true;throw Error("Synthetic lost ACK after actual intake commit");}});
  await x.submit();assert.ok(lost);assertComplete(lost);return lost;
}
const eventsCount=x=>x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(x.worker.streamId).count;
const button=(x,owner,label)=>x.f.find("button",node=>node.owner===owner&&node.text===label);
const availability=(x,owner)=>button(x,owner,x.f.i18n.t("projects.checkOriginalAvailability","Check original availability"));
function confirmedUnavailable(x,owner){
  const nodes=x.f.tree().visible("button").filter(node=>node.owner===owner);
  assert.equal(nodes.some(node=>node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation")),false);
  assert.equal(nodes.some(node=>node.text===x.f.i18n.t("projects.checkOriginalAvailability","Check original availability")),true);
  const status=x.f.find("p",node=>node.owner===owner&&node.attributes.role==="status"&&node.parent?.tag==="form"&&node.parent.parent?.tag==="dialog"&&String(node.parent.parent.attributes.class??"").split(/\s+/u).includes("project-create-dialog"));
  assert.equal(status.text,x.f.i18n.t("projects.originalConfirmedUnavailable"));
}
async function laterOriginal(x,first){
  const events=structuredClone(first.body.events),projectId=crypto.randomUUID(),documentId=crypto.randomUUID();
  for(const [index,event] of events.entries()){
    event.payload.project_id=projectId;if(index)event.payload.document_id=documentId;
    delete event.payload.client_event_id;if(event.payload.block_id)event.payload.block_id=crypto.randomUUID();
  }
  events[0].payload.name="Canonical newer B";events[1].payload.title="Newer B document";
  const result=await x.raw(events);assert.equal(result.response.status,200);assert.equal(result.body.status,"complete");
  return{projectId,documentId,eventIds:result.body.appended.map(event=>event.eventId)};
}
async function canvasOwner(x){
  await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.attributes["aria-label"]===x.f.i18n.t("action.close","Close")));
  const reply=await x.worker.request("/api/session?audience=canvas");assert.equal(reply.status,200);
  const current=await reply.json();assert.equal(current.canvas.access,true,"Existing actual admin Canvas access, no fabricated grant");
  assert.equal(await x.h.store.transitionWorkspace("/canvas/projects"),true);await x.f.settle();
  const owner=x.f.components().find(component=>component.tag==="forma-projects");
  assert.ok(owner);assert.equal(x.h.store.route.get(),"/canvas/projects");
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===owner&&node.owner.label===x.f.i18n.t("projects.new","New project")));
  for(const [label,value] of [[x.f.i18n.t("projects.projectName","Project name"),AUTHORED.name],[x.f.i18n.system("Document name"),AUTHORED.documentTitle]]){
    const field=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner&&node.owner.label===label);
    field.port.value=value;await x.f.act(field,"input");
  }
  const objective=x.f.find("textarea",node=>node.owner===owner&&node.attributes.maxlength==="1200");objective.port.value=AUTHORED.objective;await x.f.act(objective,"input");
  const form=()=>x.f.find("form",node=>node.owner===owner&&node.attributes.class==="modal-card wide");
  return{owner,form,submit:()=>x.f.act(form(),"submit")};
}

test("intake lost ACK A, actual newer B and same-route refresh still opens exact original A",options,async t=>{
  const x=await createProjectIntakeFixture(t),first=await loseOriginal(x),a=intendedIds(first.body.events);
  const source=x.h.store.captureSourceOwnership(),b=await laterOriginal(x,first);
  await x.h.store.refreshEvents();await x.f.settle();
  assert.equal(x.h.store.route.get(),"/projects");assert.equal(x.h.store.sourceOwnershipActive(source),true);
  assert.equal(x.h.store.projection.get().documentId,b.documentId);
  const before=eventsCount(x);await x.check();await x.f.settle();
  const last=x.dispatches.at(-1);assert.equal(last.body.intakeAction,"check");assertComplete(last);
  assert.equal(last.reply.documentId,a.documentId);assert.deepEqual(last.reply.appended.map(event=>event.eventId),first.reply.appended.map(event=>event.eventId));
  assert.equal(documentIdFromRoute(x.h.store.route.get()),a.documentId);
  assert.equal(eventsCount(x),before,"Exact completion navigation adds no new project, document or navigation event");
  assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
});

test("intake confirmed but removed original stays confirmed without retry or latest fallback",options,async t=>{
  const x=await createProjectIntakeFixture(t),first=await loseOriginal(x),a=intendedIds(first.body.events);
  await laterOriginal(x,first);
  const removed=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"append",event:{type:"DocumentRemoved",payload:{project_id:a.projectId,document_id:a.documentId}}})});
  const removedBody=await removed.json();assert.equal(removed.status,200,removedBody.error);
  assert.equal(removedBody.appended.some(event=>event.type==="DocumentRemoved"),true);
  const before=eventsCount(x);await x.check();await x.f.settle();
  assert.equal(x.h.store.route.get(),"/projects");confirmedUnavailable(x,x.owner);
  const requests=x.dispatches.length;
  // Labeled synthetic old form event; no visible creation retry exists.
  await x.f.act(x.form(),"submit");assert.equal(x.dispatches.length,requests);
  await x.f.act(availability(x,x.owner));assert.equal(x.dispatches.at(-1).body.intakeAction,"check");
  confirmedUnavailable(x,x.owner);assert.equal(x.h.store.route.get(),"/projects");assert.equal(eventsCount(x),before);
});

test("intake actual Canvas-origin creation opens its authored Document, not an inferred board",options,async t=>{
  const x=await createProjectIntakeFixture(t),canvas=await canvasOwner(x),before=eventsCount(x);
  await canvas.submit();await x.f.settle();
  const original=assertComplete(x.dispatches.at(-1));
  assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
  assert.equal(eventsCount(x)-before,4);
  assert.equal(x.h.requests.some(row=>row.url==="/api/session?audience=creative"),true,"Existing guarded cross-app authority is actually checked");
  assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
});

test("intake Canvas completion retains its receipt across a genuine denied transition and explicit availability Check",options,async t=>{
  const x=await createProjectIntakeFixture(t),canvas=await canvasOwner(x),originalIntercept=x.h.intercept;let denied=0;
  x.h.intercept=async request=>{
    if(request.url==="/api/session?audience=creative"&&denied===0){
      denied++;x.worker.env.FORMA_PILOT_COHORT_ID="unavailable-transition-cohort";
      try{const response=await x.worker.request(request.url,request.init);assert.equal(response.status,403);return response;}
      finally{delete x.worker.env.FORMA_PILOT_COHORT_ID;}
    }
    return originalIntercept(request);
  };
  await canvas.submit();await x.f.settle();assert.equal(denied,1);
  const original=assertComplete(x.dispatches.at(-1)),before=eventsCount(x);
  assert.equal(x.h.store.route.get(),"/canvas/projects");confirmedUnavailable(x,canvas.owner);
  const requests=x.dispatches.length;await x.f.act(canvas.form(),"submit");assert.equal(x.dispatches.length,requests);
  await x.f.act(availability(x,canvas.owner));await x.f.settle();
  assert.equal(x.dispatches.at(-1).body.intakeAction,"check");
  assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
  assert.equal(eventsCount(x),before,"Availability continuation is not another creation");
});
