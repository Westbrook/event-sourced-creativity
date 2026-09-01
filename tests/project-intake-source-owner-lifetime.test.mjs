// Full current Shell/Projects/Store + actual Worker source denial/restoration.
// Identity-ABA cases explicitly supply finite client session inputs; they test
// UI custody retirement, not backend authentication, membership or real users.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, assertComplete, reviewProjectIntake } from "./helpers/project-intake-fixture.mjs";
import { installDBoundNativeDetails } from "./helpers/d-native-disclosure.mjs";
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
  const form=x.f.find("form",node=>node.owner===owner&&String(node.attributes.class).split(/\s+/u).includes("project-intake"));
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
async function enterProjectsAlias(t,x,route){
  if(route==="/projects")return x.owner;
  await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.attributes["aria-label"]===x.f.i18n.t("action.close","Close")));
  assert.equal(await x.h.store.transitionWorkspace(route),true);await x.f.settle();
  assert.equal(x.h.store.route.get(),route);const owner=currentOwner(x);
  installDBoundNativeDetails(t,x.f,owner);
  await openCurrent(x,owner,false);await reviewProjectIntake(x.f,owner);
  for(const [label,value] of [[x.f.i18n.t("projects.projectName","Project name"),AUTHORED.name],[x.f.i18n.system("Document name"),AUTHORED.documentTitle]]){
    const field=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner&&node.owner.label===label);
    field.port.value=value;await x.f.act(field,"input");
  }
  return owner;
}
const restorations=[{route:"/projects",attempted:false},{route:"/projects",attempted:true},
  {route:"/creative",attempted:true},{route:"/canvas/projects/",attempted:true}];
for(const locale of ["en","ja"])for(const {route,attempted} of restorations){
  test("B2 same-owner Source restoration requires deliberate opening "+JSON.stringify({locale,route,attempted}),options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),native=x.native;
    await x.f.settle();const owner=await enterProjectsAlias(t,x,route),original=attempted?await lostOriginal(x,owner):null;
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
      const outcome=x.f.find("textarea",node=>node.owner===owner&&Object.hasOwn(node.attributes,"data-intake-outcome"));
      assert.equal(outcome.port.value,"","The later owner starts with no older private outcome");
      await reviewProjectIntake(x.f,owner,{blank:true});
      const name=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===owner
        &&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
      assert.equal(name.port.value,"");assert.equal(Object.hasOwn(name.attributes,"disabled"),false);
      assert.equal(eventPosts(x).length,posts,"Explicit blank review only changes local presentation");
      assert.deepEqual((await x.canonical()).delta,canonical.delta);
      assert.equal((await x.canonical()).eventClientReceipts,original.reply.appended.length);
    }finally{x.h.store.session.set(session);x.h.store.notify();restorePolicy();}
  });
}

// Reuse the complete actual intake host and the existing finite native
// updateComplete/focus ports. modalPort opens the real rendered dialog but
// does not simulate UA showModal focus. Supply that declared input only after
// the current tree is committed and before this opening's held continuation.
// This is not a browser scheduling, scrolling or assistive-technology proof.
import { sceneDeferred as dOpeningDeferred, readWorkspaceEvents as dOpeningReadEvents } from "./helpers/project-intake-fixture.mjs";
import { financial as dOpeningFinancial } from "./helpers/event-source-retirement-fixture.mjs";
import { projectIntakeMessage as dOpeningIntakeMessage } from "../src/components/design-system/locales/project-intake-messages.ts";

for (const [locale, posture, newer] of [
  ["en", "intent", "none"], ["ja", "review", "none"],
  ["en", "intent", "pointer"], ["en", "intent", "key"], ["en", "intent", "source"],
]) test("D native modal opening focus / " + locale + " / " + posture + " / " + newer, options, async t => {
  const prepared = posture === "review" || newer === "source";
  const x = await createProjectIntakeFixture(t, { locale, prepare: prepared }), native = x.native;
  if (prepared) {
    if (newer === "source") await x.f.act(x.f.find("button", node => node.owner === x.owner
      && node.text === dOpeningIntakeMessage(locale, "back")));
    await x.f.act(x.f.find("button", node => node.owner === x.owner && node.attributes["aria-label"] === x.f.i18n.t("action.close", "Close")));
    assert.equal(currentModal(x, x.owner).length, 0);
  }
  const receipts = x.worker.sqlite.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY rowid");
  const before = { source: x.h.store.captureSourceOwnership(), authorization: x.h.store.captureAuthorizationScope(),
    route: x.h.store.route.get(), session: x.h.store.session.get(), events: x.h.store.events.get(),
    head: x.h.store.head.get(), content: x.h.store.content.get(), requests: x.h.requests.length,
    append: x.h.store.appendBatchWithReceipt, canonical: await x.canonical(),
    history: await dOpeningReadEvents(x.worker.env, x.worker.streamId), receipts: receipts.all(x.worker.streamId),
    money: dOpeningFinancial(x.worker) };
  const gate = dOpeningDeferred(), descriptor = Object.getOwnPropertyDescriptor(x.owner, "updateComplete");
  assert.equal(descriptor, undefined, "No previous owner-specific completion override is replaced");
  let awaited = 0, restorePolicy = null;
  // The same existing per-owner native-completion seam as the context-focus
  // family. Actual form handlers, f.act/settle, render and Store stay unchanged.
  Object.defineProperty(x.owner, "updateComplete", { configurable: true, get() { awaited++; return gate.promise; } });
  try {
    const opener = x.f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === x.owner
      && node.owner.label === x.f.i18n.t("projects.new", "New project"));
    native.emit("pointerdown", opener.port); native.focus(opener.port);
    await openCurrent(x, x.owner, false);
    assert.equal(awaited, 1, "Exactly this actual opening awaited its native completion");
    const dialogs = currentModal(x, x.owner); assert.equal(dialogs.length, 1);
    const dialog = dialogs[0].port;
    assert.equal(dialog.open, true); assert.equal(dialog.isConnected, true);
    assert.equal(x.owner.querySelector(".project-create-dialog"), dialog);
    const close = x.f.find("button", node => node.owner === x.owner
      && node.attributes["aria-label"] === x.f.i18n.t("action.close", "Close"));
    const target = posture === "review" ? x.field(x.f.i18n.t("projects.projectName", "Project name")) : x.objective();
    assert.equal(close.port.closest("dialog"), dialog); assert.equal(target.port.closest("dialog"), dialog);
    assert.equal(dialog.contains(close.port), true); assert.equal(dialog.contains(target.port), true);
    assert.equal(close.port.ownerDocument, native.document); assert.equal(target.port.ownerDocument, native.document);
    assert.equal(Object.hasOwn(close.attributes, "disabled"), false); assert.equal(Object.hasOwn(target.attributes, "disabled"), false);
    const raw = posture === "review" ? AUTHORED.name : newer === "source" ? AUTHORED.objective : "";
    assert.equal(target.port.value, raw);
    // Declared UA input: no pointer/key event accompanies showModal's initial
    // focus. The shared lease must distinguish it from a newer user gesture.
    native.focus(close.port); assert.equal(native.document.activeElement, close.port);
    let userTarget = null;
    if (newer === "pointer") {
      userTarget = x.f.find("button", node => node.owner === x.owner && node.text === x.f.i18n.t("action.cancel", "Cancel")).port;
      assert.equal(dialog.contains(userTarget), true); native.emit("pointerdown", userTarget); native.focus(userTarget);
    }
    if (newer === "key") {
      native.emit("keydown", close.port); userTarget = target.port; native.focus(userTarget);
    }
    if (newer === "source") {
      restorePolicy = await withdrawSource(x);
      assert.equal(x.h.store.sourceOwnershipActive(before.source), false);
      assert.equal(x.h.store.authorizationScopeActive(before.authorization), true);
      assert.equal(currentModal(x, x.owner).length, 0); noPrivateProjects(x);
    }
    const mark = native.nativeFocus.length;
    gate.resolve(true); await x.f.settle();
    const late = native.nativeFocus.slice(mark);
    // Canonical history, receipts, fiscal state and real append identity are
    // checked before either intentionally failing initial-focus assertion.
    assert.deepEqual(await x.canonical(), before.canonical);
    assert.deepEqual(await dOpeningReadEvents(x.worker.env, x.worker.streamId), before.history);
    assert.deepEqual(receipts.all(x.worker.streamId), before.receipts);
    assert.deepEqual(dOpeningFinancial(x.worker), before.money);
    assert.equal(eventPosts(x).length, 0); assert.equal(x.h.store.appendBatchWithReceipt, before.append);
    assert.equal(x.h.store.route.get(), before.route); assert.equal(before.route, "/projects");
    assert.equal(x.owner.isConnected, true); assert.equal(currentOwner(x), x.owner);
    if (newer !== "source") {
      assert.equal(x.h.requests.length, before.requests);
      assert.equal(x.h.store.sourceOwnershipActive(before.source), true); assert.equal(x.h.store.authorizationScopeActive(before.authorization), true);
      assert.equal(x.h.store.session.get(), before.session); assert.equal(x.h.store.events.get(), before.events);
      assert.equal(x.h.store.head.get(), before.head); assert.equal(x.h.store.content.get(), before.content);
      const currentTarget = posture === "review" ? x.field(x.f.i18n.t("projects.projectName", "Project name")) : x.objective();
      assert.equal(currentTarget.port.value, raw);
      assert.equal(currentModal(x, x.owner).length, 1);
    } else {
      assert.equal(x.h.store.sourceOwnershipActive(before.source), false); noPrivateProjects(x);
      assert.equal(x.h.requests.slice(before.requests).every(request => (request.init.method ?? "GET") === "GET"), true);
    }
    t.diagnostic(JSON.stringify({ locale, posture, newer, awaited, lateFocus: late.map(row => ({
      intended: row.node === target.port, close: row.node === close.port, previousWasNativeClose: row.previous === close.port,
      previousConnected: row.previousConnected })), posts: eventPosts(x).length,
      evidence: "declared UA focus before native completion; not actual showModal/AT timing" }));
    if (newer === "none") {
      assert.equal(late.length, 1, "The current opening reaches its first useful field after native modal Close focus");
      assert.equal(late[0].node, target.port); assert.equal(late[0].previous, close.port); assert.equal(late[0].previousConnected, true);
    } else {
      assert.equal(late.length, 0, "Newer user interaction or retired Source prevents an old opening focus");
      if (userTarget) assert.equal(native.document.activeElement, userTarget, "No activeElement is reassigned to a replacement fixture node");
    }
    if (newer === "source") {
      const restoredFocus = native.nativeFocus.length;
      await restoredSource(x, restorePolicy); restorePolicy = null;
      assert.equal(currentModal(x, x.owner).length, 0); assert.equal(native.nativeFocus.length, restoredFocus);
      assert.equal(eventPosts(x).length, 0); assert.deepEqual(await x.canonical(), before.canonical);
      assert.deepEqual(await dOpeningReadEvents(x.worker.env, x.worker.streamId), before.history);
      assert.deepEqual(receipts.all(x.worker.streamId), before.receipts); assert.deepEqual(dOpeningFinancial(x.worker), before.money);
    }
  } finally {
    gate.resolve(true); restorePolicy?.();
    if (descriptor) Object.defineProperty(x.owner, "updateComplete", descriptor); else delete x.owner.updateComplete;
    await x.f.settle();
  }
});
