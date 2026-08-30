// Root-authorized desired liveness contract. Run first against Check-only
// lifetime runtime; the two pre-Worker cases must fail at the visible Retry.
// No fixture/Store/private method replacement; actual intake and Source routes.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, captureUnsentIntake, assertComplete, intendedIds } from "./helpers/project-intake-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { documentIdFromRoute } from "../src/model/routes.ts";
const options={concurrency:false,timeout:45000};
const currentSource=x=>x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership());
const intakePosts=x=>x.h.requests.filter(row=>row.url==="/api/events"&&row.init.method==="POST"&&row.body?.action==="project_intake");
const ownerNow=x=>{const owners=x.f.components().filter(owner=>owner.tag==="forma-projects");assert.equal(owners.length,1);return owners[0];};
async function retireThenRestore(x){
  const key="FORMA_PILOT_COHORT_ID",env=x.worker.env,had=Object.hasOwn(env,key),previous=env[key],prior=x.h.intercept;
  const authorization=x.h.store.captureAuthorizationScope(),before=x.dispatches.length;let denial=null;
  const restore=()=>{if(had)env[key]=previous;else delete env[key];};
  env[key]="synthetic-missing-original-retry-cohort";
  x.h.intercept=async request=>{
    if(request.url.startsWith("/api/events?")&&(request.init.method??"GET")==="GET"){
      const response=await x.worker.request(request.url,request.init);
      denial={status:response.status,body:await response.clone().json()};return response;
    }
    return prior(request);
  };
  try{
    await assert.rejects(x.h.store.refreshEvents({fromStart:true}),/Event stream returned 403/u);await x.f.settle();
    assert.equal(denial?.status,403);assert.equal(denial?.body.error,"pilot_participant_required");
    assert.equal(currentSource(x),false);assert.equal(x.h.store.authorizationScopeActive(authorization),true);
    assert.equal(x.f.renderer.markup.includes(AUTHORED.name),false);
    assert.equal(x.f.renderer.markup.includes(AUTHORED.objective),false);
    assert.equal(x.f.tree().nodes.some(node=>String(node.attributes.class??"").split(/\s+/u).includes("project-create-dialog")),false);
  }finally{x.h.intercept=prior;restore();}
  await x.h.store.refreshSession();await x.h.store.refreshEvents();await x.f.settle();
  assert.equal(currentSource(x),true);assert.equal(x.h.store.authorizationScopeActive(authorization),true);
  assert.equal(x.h.store.route.get(),"/projects");assert.equal(x.dispatches.length,before,"Source restoration does not dispatch an intake");
  const owner=ownerNow(x);assert.equal(owner,x.owner,"Same original personal owner, not a new draft holder");
  assert.equal(x.f.tree().visible("dialog").some(node=>node.owner===owner),false);
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===owner
    &&node.owner.label===x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})));
  assert.equal(x.dispatches.length,before,"Deliberate Resume only reopens the exact original form");
  const name=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner
    &&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
  assert.equal(name.port.value,AUTHORED.name);assert.equal(Object.hasOwn(name.attributes,"disabled"),true);
  return owner;
}
const checkButton=(x,owner)=>x.f.find("button",node=>node.owner===owner&&node.attributes.type==="button"
  &&node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
for(const locale of ["en","ja"])test("B2 explicit same-original Retry after lost pre-Worker request and current unknown Check: "+locale,options,async t=>{
  const x=await createProjectIntakeFixture(t,{locale});installOutputNavigationFocusNative(t,x.f,ports);await x.f.settle();
  const source=x.h.store.captureSourceOwnership(),receiptOwner={authorizationKey:source.authorization.key,
    actorUserId:x.h.store.session.get().user.userId,projectId:x.h.store.projection.get().projectId,sourceGeneration:source.generation};
  const events=await captureUnsentIntake(x),original=intendedIds(events),canonical=await x.canonical();
  assert.equal(canonical.delta.length,0);assert.equal(canonical.eventClientReceipts,0);
  const initial=x.h.store.eventWriteAcknowledgments(receiptOwner);assert.equal(initial.length,1);
  assert.equal(initial[0].outcome,"unconfirmed");const observationId=initial[0].observationId;
  const owner=await retireThenRestore(x),beforeCheck=intakePosts(x).length;
  assert.deepEqual((await x.canonical()).delta,canonical.delta);
  await x.f.act(checkButton(x,owner));const checked=x.dispatches.at(-1);
  assert.equal(intakePosts(x).length,beforeCheck+1);assert.equal(checked.body.intakeAction,"check");
  assert.deepEqual(checked.body.events,events);assert.equal(checked.status,409);
  assert.equal(checked.reply.status,"unknown");assert.equal(checked.reply.error,"project_intake_unconfirmed");
  assert.equal(checked.reply.projectId,original.projectId);assert.equal(checked.reply.documentId,original.documentId);
  assert.equal(Object.hasOwn(checked.reply,"appended"),false);assert.deepEqual((await x.canonical()).delta,canonical.delta);
  const stillPaused=x.h.store.eventWriteAcknowledgments(receiptOwner).find(row=>row.observationId===observationId);
  assert.ok(stillPaused);assert.equal(stillPaused.privateUnavailable,true);assert.equal(stillPaused.outcome,"unconfirmed");
  assert.deepEqual(stillPaused.committed,[],"A current read did not manufacture a commit or unpause the original generic observation");
  assert.equal(x.h.store.route.get(),"/projects");const beforeRetry=intakePosts(x).length;
  const retries=x.f.tree().visible("button").filter(node=>node.owner===owner&&node.attributes.class==="button primary"
    &&node.attributes.type!=="button"&&node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation"));
  t.diagnostic(JSON.stringify({stage:"current-unknown-before-deliberate-retry",locale,original,checkStatus:checked.status,
    originalObservation:stillPaused.outcome,privateUnavailable:stillPaused.privateUnavailable,retryControls:retries.length,
    canonicalEvents:(await x.canonical()).delta.length,receipts:(await x.canonical()).eventClientReceipts}));
  assert.equal(retries.length,1,"Unknown is not unused, but it must not permanently block an explicit atomic retry of these SAME original IDs");
  assert.equal(Object.hasOwn(retries[0].attributes,"disabled"),false);
  const form=x.f.find("form",node=>node.owner===owner&&node.attributes.class==="modal-card wide");
  await x.f.act(form,"submit",{submitter:retries[0].port});
  assert.equal(intakePosts(x).length,beforeRetry+1);const completed=x.dispatches.at(-1);assertComplete(completed);
  assert.equal(completed.body.intakeAction,"commit");assert.deepEqual(completed.body.events,events);
  assert.deepEqual(intendedIds(completed.body.events),original);assert.equal(x.dispatches.length,3);
  const saved=await x.canonical();assert.equal(saved.delta.length,4);assert.equal(saved.projects.length,1);assert.equal(saved.documents.length,1);
  assert.equal(saved.eventClientReceipts,4);assert.deepEqual(saved.delta.map(row=>row.eventId),completed.reply.appended.map(row=>row.eventId));
  assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
  assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
});
for(const locale of ["en","ja"])test("B2 existing committed original still recovers by fresh Check without resubmission: "+locale,options,async t=>{
  const x=await createProjectIntakeFixture(t,{locale});installOutputNavigationFocusNative(t,x.f,ports);await x.f.settle();let first=null;
  x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&row.status===200&&!first){first=row;throw Error("Synthetic lost committed response");}});
  await x.submit();assert.ok(first);assertComplete(first);x.setBehavior(async()=>{});
  const canonical=await x.canonical(),owner=await retireThenRestore(x),before=intakePosts(x).length;
  assert.deepEqual((await x.canonical()).delta,canonical.delta);await x.f.act(checkButton(x,owner));
  const checked=x.dispatches.at(-1);assertComplete(checked);assert.equal(checked.body.intakeAction,"check");
  assert.equal(intakePosts(x).length,before+1);assert.equal(x.dispatches.length,2);
  assert.deepEqual(checked.body.events,first.body.events);assert.deepEqual(checked.reply.appended,first.reply.appended);
  assert.deepEqual((await x.canonical()).delta,canonical.delta);assert.equal((await x.canonical()).eventClientReceipts,4);
  assert.equal(documentIdFromRoute(x.h.store.route.get()),first.reply.documentId);
});
