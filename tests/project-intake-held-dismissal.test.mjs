// Actual complete Shell/Projects/Store and routed Worker/RAM SQLite.
// Finite native event/focus ports; no physical browser or AT certification.
// Preserve the standalone ten-case causal bodies without one-off freeze code.
import assert from "node:assert/strict";
import test from "node:test";
import {AUTHORED,createProjectIntakeFixture,assertComplete,sceneDeferred,untilScene} from "./helpers/project-intake-fixture.mjs";
import {calmFullPageNativePorts as ports} from "./helpers/calm-full-page-fixture.mjs";
import {installOutputNavigationFocusNative} from "./helpers/output-navigation-focus-native.mjs";
import {documentIdFromRoute} from "../src/model/routes.ts";
const options={concurrency:false,timeout:45000};
const disabled=node=>Object.hasOwn(node.attributes,"disabled");
const intakeCount=x=>x.h.requests.filter(row=>row.url==="/api/events"&&row.init.method==="POST"&&row.body?.action==="project_intake").length;
const active=x=>x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership());
function modal(x,owner=x.owner){return x.f.tree().visible("dialog").find(node=>node.owner===owner&&String(node.attributes.class).split(/\s+/u).includes("project-create-dialog"))??null;}
const closeButton=(x,owner=x.owner)=>x.f.find("button",node=>node.owner===owner&&String(node.attributes.class).split(/\s+/u).includes("modal-close"));
const checkButton=(x,owner=x.owner)=>x.f.find("button",node=>node.owner===owner&&node.attributes.type==="button"&&node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
const retryButton=(x,owner=x.owner)=>x.f.find("button",node=>node.owner===owner&&node.attributes.class==="button primary"&&node.attributes.type!=="button"&&node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation"));
async function resume(x){
  const before=intakeCount(x);
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===x.owner
    &&node.owner.label===x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})));
  assert.ok(modal(x));assert.equal(intakeCount(x),before,"A deliberate presentation opener does not Check or retry creation");
}
async function withdrawAndRestore(x,native){
  const env=x.worker.env,key="FORMA_PILOT_COHORT_ID",had=Object.hasOwn(env,key),previous=env[key],intercept=x.h.intercept;
  const restorePolicy=()=>{if(had)env[key]=previous;else delete env[key];};
  const authorization=x.h.store.captureAuthorizationScope(),before=intakeCount(x);let denied=0;
  env[key]="synthetic-held-intake-source-cohort";
  x.h.intercept=async request=>{
    if(request.url.startsWith("/api/events?")&&(request.init.method??"GET")==="GET"){
      const response=await x.worker.request(request.url,request.init);assert.equal(response.status,403);
      assert.equal((await response.clone().json()).error,"pilot_participant_required");denied++;return response;
    }
    return intercept(request);
  };
  try{
    await assert.rejects(x.h.store.refreshEvents({fromStart:true}),/Event stream returned 403/u);await x.f.settle();
    assert.equal(denied,1);assert.equal(active(x),false);assert.equal(x.h.store.authorizationScopeActive(authorization),true);
    assert.equal(x.owner.isConnected,true,"Same-route personal Projects owner is retained without its private render");
    for(const value of Object.values(AUTHORED))assert.equal(x.f.renderer.markup.includes(value),false);
    assert.equal(modal(x),null);assert.equal(intakeCount(x),before);
  }finally{x.h.intercept=intercept;restorePolicy();}
  const language=x.f.find("select",node=>node.owner?.tag==="forma-ui-language-picker");
  native.emit("pointerdown",language.port);native.focus(language.port);const focusCount=native.nativeFocus.length;
  await x.h.store.refreshSession();await x.h.store.refreshEvents();await x.f.settle();
  assert.equal(active(x),true);assert.equal(x.h.store.authorizationScopeActive(authorization),true);
  assert.equal(x.h.store.route.get(),"/projects");assert.equal(x.f.components().filter(owner=>owner.tag==="forma-projects").length,1);
  assert.equal(x.f.components().includes(x.owner),true);assert.equal(modal(x),null);
  assert.equal(native.nativeFocus.length,focusCount,"Source restoration never automatically reopens or steals focus");
  assert.equal(intakeCount(x),before,"Source restoration never retries an in-flight original");
}
async function checkExactAfterDismissal(x,first,originalCanonical){
  if(modal(x)){assert.equal(disabled(closeButton(x)),false);await x.f.act(closeButton(x));}
  assert.equal(modal(x),null);const before=intakeCount(x);await resume(x);
  assert.equal(disabled(checkButton(x)),false);await x.f.act(checkButton(x));
  assert.equal(intakeCount(x),before+1);const checked=x.dispatches.at(-1);assertComplete(checked);
  assert.equal(checked.body.intakeAction,"check");assert.deepEqual(checked.body.events,first.body.events);
  assert.deepEqual(checked.reply.appended,first.reply.appended);
  assert.equal(x.dispatches.filter(row=>row.body.intakeAction==="commit").length,1);
  assert.deepEqual((await x.canonical()).delta,originalCanonical.delta);assert.equal((await x.canonical()).eventClientReceipts,4);
  assert.equal(documentIdFromRoute(x.h.store.route.get()),first.reply.documentId);return true;
}

const scenarios=["restored-pending-close","restored-pending-escape","ordinary-pending-close","ordinary-completion","settled-lost-close"];
for(const locale of ["en","ja"])for(const scenario of scenarios)test("B2 held original nonmutating dismissal "+locale+" "+scenario,options,async t=>{
  const x=await createProjectIntakeFixture(t,{locale}),native=installOutputNavigationFocusNative(t,x.f,ports);
  await x.f.settle();const release=sceneDeferred();let first=null,finished=false;
  x.setBehavior(async(stage,row)=>{
    if(stage==="after-worker"&&!first){assertComplete(row);first=row;await release.promise;
      if(scenario==="settled-lost-close"){row.dropped=true;throw Error("Synthetic transport loss after the genuine complete Worker ACK was held");}}
  });
  const pending=x.submit();pending.then(()=>{finished=true;},()=>{finished=true;});
  let observation=null;
  try{
    await untilScene(()=>first!==null,"The real original committed before its unchanged ACK is held");await x.f.settle();
    const original=assertComplete(first),canonical=await x.canonical();assert.equal(canonical.delta.length,4);assert.equal(canonical.eventClientReceipts,4);
    assert.equal(x.dispatches.length,1);assert.equal(finished,false);assert.ok(modal(x));
    assert.equal(disabled(checkButton(x)),true);assert.equal(disabled(retryButton(x)),true);
    if(scenario==="ordinary-completion"){
      release.resolve();await pending;await x.f.settle();assert.equal(modal(x),null);
      assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
      assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
      assert.deepEqual((await x.canonical()).delta,canonical.delta);assert.equal(x.dispatches.length,1);
      t.diagnostic(JSON.stringify({locale,scenario,healthy:true,commitStatus:first.status,events:4,receipts:4,commitPosts:1}));return;
    }
    if(scenario==="settled-lost-close"){
      release.resolve();await pending;await x.f.settle();assert.equal(first.dropped,true);
      assert.equal(disabled(closeButton(x)),false);const before=intakeCount(x);await x.f.act(closeButton(x));
      assert.equal(modal(x),null);assert.equal(intakeCount(x),before);
      const checked=await checkExactAfterDismissal(x,first,canonical);
      t.diagnostic(JSON.stringify({locale,scenario,healthy:true,commitStatus:first.status,closeReached:true,checked,events:4,receipts:4,commitPosts:1}));return;
    }
    let focusedEnabledClose=null;
    if(scenario.startsWith("restored")){
      await withdrawAndRestore(x,native);assert.equal(finished,false);assert.deepEqual((await x.canonical()).delta,canonical.delta);
      const focusStart=native.nativeFocus.length;await resume(x);
      focusedEnabledClose=native.nativeFocus.slice(focusStart).some(entry=>String(entry.node.attributes?.class??"").split(/\s+/u).includes("modal-close")&&!Object.hasOwn(entry.node.attributes??{},"disabled"));
    }
    assert.equal(finished,false);assert.ok(modal(x));
    const close=closeButton(x),before=intakeCount(x),checkDisabled=disabled(checkButton(x)),retryDisabled=disabled(retryButton(x));
    assert.equal(checkDisabled,true);assert.equal(retryDisabled,true,"Never authorize another pending write or Check");
    let attempted=false,cancelPrevented=false;
    if(scenario.endsWith("escape")){
      attempted=true;await x.f.act(modal(x),"cancel",{preventDefault(){cancelPrevented=true;}});
    }else if(!disabled(close)){attempted=true;await x.f.act(close);}
    const dismissed=modal(x)===null;
    observation={locale,scenario,commitStatus:first.status,originalStillPending:!finished,closeEnabled:!disabled(close),
      checkDisabled,retryDisabled,focusedEnabledClose,activationAttempted:attempted,cancelPrevented,dismissed,
      requestsBefore:before,requestsAfter:intakeCount(x),lateAckDidNotReopen:null,sameOriginalCheckExercised:false};
    assert.equal(intakeCount(x),before);assert.deepEqual((await x.canonical()).delta,canonical.delta);
    release.resolve();await pending;await x.f.settle();
    if(dismissed){
      assert.equal(x.h.store.route.get(),"/projects");assert.equal(modal(x),null);
      observation.lateAckDidNotReopen=true;
    }
    // Baseline restored cases can finish recovery once A finally settles.
    // If an ordinary disabled Close was never activated, healthy normal A
    // completion may instead navigate; do not claim dismissal was tested.
    if(x.h.store.route.get()==="/projects")observation.sameOriginalCheckExercised=await checkExactAfterDismissal(x,first,canonical);
    else assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
    assert.deepEqual((await x.canonical()).delta,canonical.delta);assert.equal((await x.canonical()).eventClientReceipts,4);
    assert.equal(x.dispatches.filter(row=>row.body.intakeAction==="commit").length,1);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(observation.closeEnabled,true,"A nonmutating Close must remain available while the original is pending");
    if(scenario.startsWith("restored"))assert.equal(observation.focusedEnabledClose,true,"Explicit Resume focuses enabled Close, never a disabled original field");
    assert.equal(observation.dismissed,true,"Current Close/native cancel dismisses only the presentation");
    assert.equal(observation.lateAckDidNotReopen,true);assert.equal(observation.sameOriginalCheckExercised,true);
  }finally{release.resolve();await Promise.allSettled([pending]);}
});
