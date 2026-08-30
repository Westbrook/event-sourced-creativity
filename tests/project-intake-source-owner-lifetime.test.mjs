// Full current Shell/Projects/Store + actual Worker source denial/restoration.
// Identity-ABA cases explicitly supply finite client session inputs; they test
// UI custody retirement, not backend authentication, membership or real users.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, assertComplete } from "./helpers/project-intake-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { documentIdFromRoute } from "../src/model/routes.ts";
const options={concurrency:false,timeout:45000};
const eventPosts=x=>x.h.requests.filter(row=>row.url==="/api/events"&&(row.init.method??"GET")==="POST");
const sourceActive=x=>x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership());
const currentOwner=x=>{
  const owners=x.f.components().filter(component=>component.tag==="forma-projects");
  assert.equal(owners.length,1);return owners[0];
};
const currentModal=(x,owner)=>x.f.tree().nodes.filter(node=>node.owner===owner&&node.tag==="dialog"
  &&String(node.attributes.class).split(/\s+/u).includes("project-create-dialog"));
const originalChecks=(x,owner)=>x.f.tree().visible("button").filter(node=>node.owner===owner
  &&node.attributes.type==="button"&&node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
function noPrivateProjects(x){
  const markup=x.f.renderer.markup;
  for(const value of [AUTHORED.name,AUTHORED.documentTitle,AUTHORED.objective])assert.equal(markup.includes(value),false,
    "Retired Source removes private rendered text, not merely CSS visibility: "+value);
  assert.equal(x.f.tree().nodes.some(node=>String(node.attributes.class??"").split(/\s+/u).includes("project-create-dialog")),false);
}
async function submitCurrent(x,owner=x.owner){
  const form=x.f.find("form",node=>node.owner===owner&&node.attributes.class==="modal-card wide");
  const submit=x.f.find("button",node=>node.owner===owner&&node.attributes.class==="button primary"&&node.attributes.type!=="button"
    &&node.text===x.f.i18n.t("projects.createAction","Create project"));
  assert.equal(Object.hasOwn(submit.attributes,"disabled"),false);
  await x.f.act(form,"submit",{submitter:submit.port});
}
async function lostOriginal(x,owner=x.owner){
  let lost=null;
  x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&row.status===200&&!lost){lost=row;throw Error("Synthetic original response loss");}});
  await submitCurrent(x,owner);assert.ok(lost);assertComplete(lost);x.setBehavior(async()=>{});return lost;
}
async function withdrawSource(x){
  // GET requires current configured-cohort admission, not POST-only consent.
  // This is the existing actual missing-cohort denial pattern, not fake HTTP.
  const env=x.worker.env,key="FORMA_PILOT_COHORT_ID",had=Object.hasOwn(env,key),previous=env[key];
  const restorePolicy=()=>{if(had)env[key]=previous;else delete env[key];};
  const authorization=x.h.store.captureAuthorizationScope(),intercept=x.h.intercept;let denied=0;
  env[key]="synthetic-missing-intake-owner-cohort";
  x.h.intercept=async request=>{
    if(request.url.startsWith("/api/events?")&&(request.init.method??"GET")==="GET"){
      const response=await x.worker.request(request.url,request.init);
      assert.equal(response.status,403);assert.equal((await response.clone().json()).error,"pilot_participant_required");
      denied++;return response;
    }
    return intercept(request);
  };
  try{
    await assert.rejects(x.h.store.refreshEvents({fromStart:true}),/Event stream returned 403/u);await x.f.settle();
    assert.equal(denied,1);assert.equal(x.h.store.authorizationScopeActive(authorization),true);
    assert.equal(sourceActive(x),false,"The actual current events route denied the Source");
    noPrivateProjects(x);
    return restorePolicy;
  }catch(error){restorePolicy();throw error;}finally{x.h.intercept=intercept;}
}
async function restoredSource(x,restorePolicy,route="/projects"){
  restorePolicy();await x.h.store.refreshSession();await x.h.store.refreshEvents();await x.f.settle();
  assert.equal(sourceActive(x),true);assert.equal(x.h.store.route.get(),route);
}
async function openCurrent(x,owner,retained){
  const label=retained?x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})
    :x.f.i18n.t("projects.new","New project");
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===owner&&node.owner.label===label));
  assert.equal(currentModal(x,owner).length,1);
}
async function enterProjectsAlias(x,route){
  if(route==="/projects")return x.owner;
  await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.attributes["aria-label"]===x.f.i18n.t("action.close","Close")));
  assert.equal(await x.h.store.transitionWorkspace(route),true);await x.f.settle();
  assert.equal(x.h.store.route.get(),route);const owner=currentOwner(x);await openCurrent(x,owner,false);
  for(const [label,value] of [[x.f.i18n.t("projects.projectName","Project name"),AUTHORED.name],[x.f.i18n.system("Document name"),AUTHORED.documentTitle]]){
    const field=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner&&node.owner.label===label);
    field.port.value=value;await x.f.act(field,"input");
  }
  const objective=x.f.find("textarea",node=>node.owner===owner&&node.attributes.maxlength==="1200");
  objective.port.value=AUTHORED.objective;await x.f.act(objective,"input");return owner;
}
const restorations=[{route:"/projects",attempted:false},{route:"/projects",attempted:true},
  {route:"/creative",attempted:true},{route:"/canvas/projects/",attempted:true}];
for(const locale of ["en","ja"])for(const {route,attempted} of restorations){
  test("B2 same-owner Source restoration requires deliberate opening "+JSON.stringify({locale,route,attempted}),options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),native=installOutputNavigationFocusNative(t,x.f,ports);
    await x.f.settle();const owner=await enterProjectsAlias(x,route),original=attempted?await lostOriginal(x,owner):null;
    const canonical=await x.canonical(),posts=eventPosts(x).length;
    const restorePolicy=await withdrawSource(x);
    try{
      assert.equal(owner.isConnected,true,"Only the same-route personal Projects owner is retained, without its private render");
      const wrapper=x.f.tree().nodes.find(node=>String(node.attributes.class??"").split(/\s+/u).includes("projects-source-owner"));
      assert.ok(wrapper);assert.ok(Object.hasOwn(wrapper.attributes,"hidden"));assert.ok(Object.hasOwn(wrapper.attributes,"inert"));
      const language=x.f.find("select",node=>node.owner?.tag==="forma-ui-language-picker");
      native.emit("pointerdown",language.port);native.focus(language.port);const focusCount=native.nativeFocus.length;
      await restoredSource(x,restorePolicy,route);
      assert.equal(currentOwner(x),owner);assert.equal(currentModal(x,owner).length,0);
      assert.equal(native.nativeFocus.length,focusCount,"Source restoration alone never focuses or reopens the old form");
      assert.equal(eventPosts(x).length,posts);assert.deepEqual((await x.canonical()).delta,canonical.delta);
      const beforeOpenFocus=native.nativeFocus.length;
      await openCurrent(x,owner,attempted);assert.equal(eventPosts(x).length,posts);
      const focused=native.nativeFocus.slice(beforeOpenFocus).map(entry=>entry.node);
      assert.ok(focused.some(node=>attempted?String(node.attributes.class??"").split(/\s+/u).includes("modal-close")
        :node.tag==="input"),"The deliberate opener focuses enabled Close for a retained intake, or the new draft input");
      assert.equal(focused.some(node=>Object.hasOwn(node.attributes??{},"disabled")),false);
      const name=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner
        &&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
      assert.equal(name.port.value,AUTHORED.name);
      assert.equal(Object.hasOwn(name.attributes,"disabled"),attempted);
      const checks=originalChecks(x,owner);assert.equal(checks.length,attempted?1:0);
      if(attempted){
        assert.equal(x.f.tree().visible("button").some(node=>node.owner===owner&&node.attributes.class==="button primary"
          &&node.attributes.type!=="button"&&node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation")),
          true,"Explicit same-original Retry is available; restoration, opening and Check never invoke it");
        await x.f.act(checks[0]);assertComplete(x.dispatches.at(-1));
        assert.equal(x.dispatches.at(-1).body.intakeAction,"check");
        assert.deepEqual(x.dispatches.at(-1).body.events,original.body.events);
        assert.deepEqual(x.dispatches.at(-1).reply.appended.map(event=>event.eventId),original.reply.appended.map(event=>event.eventId));
        assert.equal(eventPosts(x).length,posts+1);assert.deepEqual((await x.canonical()).delta,canonical.delta);
      }
    }finally{restorePolicy();}
  });
}
for(const locale of ["en","ja"])test("B2 successful intake cleanup survives a still-connected route notification: "+locale,options,async t=>{
  const x=await createProjectIntakeFixture(t,{locale}),arrivals=[];let original=null;
  x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&row.status===200&&!original){assertComplete(row);original=row;}});
  // Read-only subscription observes the real synchronous route commit before
  // the complete renderer settles. No transition/current/private method stub.
  const unsubscribe=x.h.store.subscribe(()=>{
    if(original&&documentIdFromRoute(x.h.store.route.get())===original.reply.documentId)
      arrivals.push({connected:x.owner.isConnected,route:x.h.store.route.get(),toast:x.h.store.ui.toast});
  });
  try{
    await submitCurrent(x);assert.ok(original);assertComplete(original);
    assert.ok(arrivals.some(row=>row.connected),"Exact successful navigation is observed while the old component is still connected");
    assert.equal(documentIdFromRoute(x.h.store.route.get()),original.reply.documentId);
    assert.equal(x.h.store.projection.get().projectId,original.reply.projectId);
    assert.equal(x.h.store.projection.get().documentId,original.reply.documentId);
    assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true,
      "Retiring the owned draft before Lit teardown does not suppress its truthful success acknowledgment");
    assert.equal((await x.canonical()).delta.length,4);assert.equal(x.dispatches.length,1);
    assert.deepEqual((await x.canonical()).delta.map(row=>row.eventId),original.reply.appended.map(row=>row.eventId));
  }finally{unsubscribe();}
});
function temporaryClientIdentity(session,kind){
  if(kind==="shared-context")return{...session,projectContext:{organizationId:"finite-org",projectAccessId:"finite-access",
    contextId:"finite-context",projectId:"finite-project",ownerUserId:session.user.userId,role:"viewer",permissions:["project.read"],
    expiresAt:new Date(Date.now()+600000).toISOString()}};
  const effective=kind==="effective-principal"?{...session.user,userId:"finite-other-effective"}:session.user;
  const principal=kind==="real-principal"?{...session.user,userId:"finite-other-principal"}:session.user;
  return{...session,user:effective,impersonation:{actor:principal,fictionalUser:effective,personaId:"finite-persona",
    replaySessionId:"finite-replay",expiresAt:new Date(Date.now()+600000).toISOString()}};
}
for(const locale of ["en","ja"])for(const boundary of ["real-principal","effective-principal","shared-context","route"]){
  test("B2 retained intake cannot resurface after "+JSON.stringify({locale,boundary}),options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),original=await lostOriginal(x),canonical=await x.canonical();
    const posts=eventPosts(x).length,session=x.h.store.session.get(),restorePolicy=await withdrawSource(x);
    try{
      noPrivateProjects(x);
      if(boundary==="route"){
        x.h.store.setRoute("/settings");x.h.store.setRoute("/projects");
      }else{
        // Finite client-session ABA, deliberately no await between identities.
        // No server access/permission or backend-authentication proof is inferred.
        x.h.store.session.set(temporaryClientIdentity(session,boundary));x.h.store.notify();
        x.h.store.session.set(session);x.h.store.notify();
      }
      await x.f.settle();noPrivateProjects(x);
      await restoredSource(x,restorePolicy);
      const owner=currentOwner(x);assert.equal(currentModal(x,owner).length,0);
      assert.equal(eventPosts(x).length,posts,"No identity/route interruption resubmits the original");
      assert.equal(x.f.tree().visible("button").some(node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===owner
        &&node.owner.label===x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})),false);
      await openCurrent(x,owner,false);
      assert.equal(originalChecks(x,owner).length,0,"A later owner cannot inherit an older private intake command");
      const name=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner
        &&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
      assert.equal(name.port.value,"");assert.equal(Object.hasOwn(name.attributes,"disabled"),false);
      const objective=x.f.find("textarea",node=>node.owner===owner&&node.attributes.maxlength==="1200");
      assert.equal(objective.port.value,"");assert.equal(eventPosts(x).length,posts);
      assert.deepEqual((await x.canonical()).delta,canonical.delta);
      assert.equal((await x.canonical()).eventClientReceipts,original.reply.appended.length);
    }finally{x.h.store.session.set(session);x.h.store.notify();restorePolicy();}
  });
}
