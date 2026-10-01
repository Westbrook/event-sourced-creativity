// Actual complete Projects/Shell/Store -> routed Worker/RAM SQLite regression.
// Interleavings/corruption are explicitly labeled; no browser/provider claim.
import assert from "node:assert/strict";
import test from "node:test";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { AUTHORED,createProjectIntakeFixture,captureUnsentIntake,assertComplete,intendedIds,sceneDeferred,untilScene,readWorkspaceEvents,reviewProjectIntake } from "./helpers/project-intake-fixture.mjs";
import {projectIntakeMessage} from "../src/components/design-system/locales/project-intake-messages.ts";
const {projectIntake}=await import("../src/model/project-intake.ts");
const {commitAtomicIntake}=await import("../worker/project-intake.ts");
const {requireUser}=await import("../worker/pilot-policy.ts");

const options={concurrency:false,timeout:45000};
const exactRead=statement=>statement.sql.includes("expected.value AS requested_key");
const rootBatch=statements=>statements.some(statement=>statement.sql.includes("VALUES(?,?,CASE WHEN")&&statement.sql.includes("event_client_receipts"));
const ids=body=>body.appended.map(event=>event.eventId);
const rawRow=(events,result)=>({body:{events},status:result.response.status,reply:result.body});
const count=worker=>worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(worker.streamId).count;
const input=async(x,node,value)=>{node.port.value=value;await x.f.act(node,"input");};
function observe(t,x,detail={}){t.diagnostic(JSON.stringify({case:t.name,visible:x.visible(),requests:x.requests(),...detail}));}
function oneOriginal(canonical,original){
  assert.equal(canonical.projects.length,1);assert.equal(canonical.documents.length,1);
  assert.equal(canonical.projects[0].projectId,original.projectId);
  assert.equal(canonical.documents[0].documentId,original.documentId);
  assert.equal(canonical.eventClientReceipts,4);
}
async function lostCommitted(x){
  let lost=null;
  x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&row.status===200&&!lost){lost=row;row.dropped=true;throw Error("Synthetic loss after real complete commit");}});
  await x.submit();assert.ok(lost,"The original actually committed before its ACK was lost");assertComplete(lost);
  assert.equal(x.visible().modal,true);assert.equal(x.visible().editable,false);assert.deepEqual(x.visible().draft,AUTHORED);
  return lost;
}
async function reopen(x){
  await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.attributes["aria-label"]===x.f.i18n.t("action.close","Close")));
  assert.equal(x.visible().modal,false);
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===x.owner&&node.owner.label===x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})));
  assert.equal(x.visible().modal,true);
}

for(const locale of ["en","fr","ar","ja"])test("intake healthy complete original via visible Submit: "+locale,options,async t=>{
  const x=await createProjectIntakeFixture(t,{locale});
  await x.submit();assert.equal(x.dispatches.length,1);
  const original=assertComplete(x.dispatches[0]),canonical=await x.canonical();
  observe(t,x,{original,canonical});
  oneOriginal(canonical,original);assert.equal(canonical.objectiveBlocks.length,1);
  assert.equal(x.visible().modal,false);
  assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
  assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)),true);
  assert.equal(x.h.store.appendBatch,x.originalAppend);
});

test("intake lost real committed ACK then ordinary visible Retry retains all original IDs",options,async t=>{
  const x=await createProjectIntakeFixture(t),lost=await lostCommitted(x),original=intendedIds(lost.body.events);
  const first=await x.canonical();oneOriginal(first,original);
  await x.submit();assert.equal(x.dispatches.length,2);assertComplete(x.dispatches[1]);
  const canonical=await x.canonical();observe(t,x,{original,canonical});
  assert.deepEqual(x.dispatches[1].body,lost.body);
  assert.deepEqual(ids(x.dispatches[1].reply),ids(lost.reply));
  assert.deepEqual(canonical.delta,first.delta);oneOriginal(canonical,original);
  assert.equal(x.visible().modal,false);assert.equal(documentIdFromRoute(x.h.store.route.get()),original.documentId);
});

test("intake lost real committed ACK then explicit Check is read-only exact recovery",options,async t=>{
  const x=await createProjectIntakeFixture(t),lost=await lostCommitted(x);
  const before=await x.canonical(),writes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  await x.check();assert.equal(x.dispatches.length,2);assert.equal(x.dispatches[1].body.intakeAction,"check");
  assertComplete(x.dispatches[1]);observe(t,x);
  assert.deepEqual(ids(x.dispatches[1].reply),ids(lost.reply));
  assert.deepEqual((await x.canonical()).delta,before.delta);
  // An isolated already-warm routed request; no cold global housekeeping claim.
  assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,writes);
  assert.equal(x.visible().modal,false);
});

test("intake healthy in-flight original absence never enables another visible Submit",options,async t=>{
  const x=await createProjectIntakeFixture(t),release=sceneDeferred();let held=null;
  x.setBehavior(async(stage,row)=>{if(stage==="before-worker"&&!held){held=row;await release.promise;}});
  const pending=x.submit();
  try{
    await untilScene(()=>held!==null,"Actual form reached pre-Worker hold");await x.f.settle();
    const canonical=await x.canonical();observe(t,x,{canonical});
    assert.equal(canonical.projects.length,0);assert.equal(canonical.documents.length,0);
    assert.equal(x.visible().submitting,"true");assert.equal(x.visible().submitEnabled,false);
    // Synthetic duplicate native submit, not a forced physical-user click.
    await x.f.act(x.form(),"submit",{submitter:x.submitButton().port});
    assert.equal(x.dispatches.length,1);
  }finally{release.resolve();await pending;}
  const original=assertComplete(held);oneOriginal(await x.canonical(),original);
});

test("intake pre-Worker transport loss and missing Check do not imply unused or mint a replacement",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),original=intendedIds(events);
  await x.check();assert.equal(x.dispatches[1].status,409);
  assert.equal(x.dispatches[1].reply.status,"unknown");assert.equal(x.visible().editable,false);
  assert.equal(x.visible().modal,true);assert.deepEqual(x.visible().draft,AUTHORED);
  assert.equal((await x.canonical()).projects.length,0);
  await x.submit();assertComplete(x.dispatches[2]);
  observe(t,x,{original});assert.deepEqual(x.dispatches.map(row=>row.body.events),[events,events,events]);
  oneOriginal(await x.canonical(),original);
});

for(const changed of [false,true])test("intake concurrent root uniqueness is atomic: "+(changed?"different manifest cannot replace winner":"same original recovers winner"),options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);
  const entered=sceneDeferred(),release=sceneDeferred();let held=false;
  x.worker.controls.afterRead=async(statement,value)=>{
    if(exactRead(statement)&&!held){held=true;assert.equal(value.results[0].receipt_total,0);entered.resolve();await release.promise;}
  };
  const first=x.raw(events);
  let winner,recovered;
  try{
    await untilScene(()=>held,"First genuine absent-receipt snapshot completed");await entered.promise;
    const competing=structuredClone(events);if(changed)competing[0].payload.name="Different concurrent manifest";
    winner=await x.raw(competing);assertComplete(rawRow(competing,winner));
  }finally{release.resolve();recovered=await first;x.worker.controls.afterRead=null;}
  const canonical=await x.canonical();observe(t,x,{changed,firstStatus:recovered.response.status,winnerEventIds:ids(winner.body),canonical});
  oneOriginal(canonical,intendedIds(events));
  if(changed){assert.equal(recovered.response.status,409);assert.equal(recovered.body.status,"unknown");assert.equal(Object.hasOwn(recovered.body,"appended"),false);}
  else{assert.equal(recovered.response.status,200);assert.deepEqual(ids(recovered.body),ids(winner.body));}
  const project=(await readWorkspaceEvents(x.worker.env,x.worker.streamId)).find(event=>event.eventId===winner.body.appended[0].eventId);
  assert.equal(project.payload.name,changed?"Different concurrent manifest":AUTHORED.name);
});

test("intake non-user protocol fault: forbidden member is rejected all-or-none",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x);
  const invalid=structuredClone(events);invalid[3].type="ProviderBillableUsage";
  const before=count(x.worker),result=await x.raw(invalid);observe(t,x,{status:result.response.status,body:result.body});
  assert.equal(result.response.status,400);assert.equal(result.body.status,"invalid");
  assert.equal(count(x.worker),before);assert.equal((await x.canonical()).projects.length,0);
  assert.equal((await x.canonical()).eventClientReceipts,0);
});

test("intake partial original receipt fault stays unknown and cannot fill a missing subset",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),committed=await x.raw(events);
  assertComplete(rawRow(events,committed));
  // Explicit storage/protocol fault, not an ordinary UI or D1 atomicity claim.
  x.worker.sqlite.prepare("DELETE FROM event_client_receipts WHERE stream_id=? AND client_event_id=?").run(x.worker.streamId,events[2].payload.client_event_id);
  const before=count(x.worker);
  for(const mode of ["check","commit"]){const result=await x.raw(events,mode);assert.equal(result.response.status,409);assert.equal(result.body.error,"project_intake_original_unavailable");}
  observe(t,x,{before,after:count(x.worker)});
  assert.equal(count(x.worker),before);assert.equal((await x.canonical()).eventClientReceipts,3);
});

test("intake real personal authored erasure preserves original fence without reconstructing bodies",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),committed=await x.raw(events);
  assertComplete(rawRow(events,committed));const before=count(x.worker);
  const erased=await x.worker.request("/api/privacy/events",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"erase-personal-authored-context",confirmation:"ERASE_MY_PERSONAL_AUTHORED_CONTEXT"})});
  const erasure=await erased.json();assert.equal(erased.status,200,erasure.error);assert.ok(erasure.erasedAuthoredEventBodies>=4);
  for(const mode of ["check","commit"]){
    const result=await x.raw(events,mode);assert.equal(result.response.status,409);
    assert.equal(result.body.status,"unknown");assert.equal(Object.hasOwn(result.body,"appended"),false);
  }
  observe(t,x,{erasedBodies:erasure.erasedAuthoredEventBodies});
  assert.equal(count(x.worker),before);assert.equal((await x.canonical()).eventClientReceipts,4);
  assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE private_event_id IN(SELECT event_id FROM event_client_receipts WHERE stream_id=?) AND redacted_at IS NULL").get(x.worker.streamId).count,0);
});

for(const change of ["name","shorter"])test("intake exact original rejects "+change+" manifest without replacement",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),committed=await x.raw(events);
  assertComplete(rawRow(events,committed));const before=count(x.worker),different=structuredClone(events);
  if(change==="name")different[0].payload.name="Edited after ambiguous original";else different.pop();
  assert.ok(projectIntake(different),"This is a structurally valid different intake, not a malformed shortcut");
  for(const mode of ["check","commit"]){const result=await x.raw(different,mode);assert.equal(result.response.status,409);assert.equal(result.body.status,"unknown");}
  observe(t,x,{change});assert.equal(count(x.worker),before);oneOriginal(await x.canonical(),intendedIds(events));
});

test("intake transaction-time authority loss rolls back all event/private/receipt inserts",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),before=count(x.worker);let fired=false;
  const user=x.worker.sqlite.prepare("SELECT consent_version,consented_at FROM users WHERE user_id=?").get(x.worker.owner);
  x.worker.controls.beforeBatch=async statements=>{if(rootBatch(statements)&&!fired){fired=true;x.worker.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(x.worker.owner);}};
  const result=await x.raw(events);x.worker.controls.beforeBatch=null;
  observe(t,x,{fired,status:result.response.status,body:result.body});
  assert.equal(fired,true);assert.equal(result.response.status,403);
  assert.equal(count(x.worker),before);assert.equal((await x.canonical()).eventClientReceipts,0);
  x.worker.sqlite.prepare("UPDATE users SET consent_version=?,consented_at=? WHERE user_id=?").run(user.consent_version,user.consented_at,x.worker.owner);
});

for(const recovery of ["check","commit"])test("intake final receipt authority loss recovers only by deliberate same-original "+recovery,options,async t=>{
  const x=await createProjectIntakeFixture(t);let reads=0;
  const user=x.worker.sqlite.prepare("SELECT consent_version,consented_at FROM users WHERE user_id=?").get(x.worker.owner);
  x.worker.controls.beforeRead=async statement=>{if(exactRead(statement)&&++reads===2)x.worker.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(x.worker.owner);};
  await x.submit();x.worker.controls.beforeRead=null;
  const original=intendedIds(x.dispatches[0].body.events),canonical=await x.canonical();
  observe(t,x,{reads,canonical});assert.equal(reads,2);assert.equal(x.dispatches[0].status,403);
  assert.equal(Object.hasOwn(x.dispatches[0].reply,"appended"),false);oneOriginal(canonical,original);
  assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),false);
  const restoreRequestStart=x.h.requests.length,requests=x.dispatches.length;
  x.worker.sqlite.prepare("UPDATE users SET consent_version=?,consented_at=? WHERE user_id=?").run(user.consent_version,user.consented_at,x.worker.owner);
  await x.h.store.refreshSession();await x.h.store.refreshEvents();await x.f.settle();
  assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),true);
  const intakePosts=()=>x.h.requests.slice(restoreRequestStart).filter(row=>row.url==="/api/events"
    &&row.init.method==="POST"&&row.body?.action==="project_intake");
  assert.equal(intakePosts().length,0,"Restoring current Source never automatically repeats the retired original");
  assert.equal(x.dispatches.length,requests);
  assert.deepEqual((await x.canonical()).delta,canonical.delta);
  const currentOwners=x.f.components().filter(component=>component.tag==="forma-projects");
  assert.equal(currentOwners.length,1,"Inspect the actual current restored Projects owner, not the retired fixture owner");
  const currentOwner=currentOwners[0];
  const currentDialog=()=>x.f.tree().visible("dialog").filter(node=>node.owner===currentOwner
    &&String(node.attributes.class).split(/\s+/u).includes("project-create-dialog"));
  assert.equal(currentDialog().length,0,"Restoring Source must not automatically reopen the original private form");
  await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===currentOwner
    &&node.owner.label===x.f.i18n.system("Resume {title}",{title:"\u2068"+AUTHORED.name+"\u2069"})));
  assert.equal(intakePosts().length,0,"Deliberate form reopening is not a new or replayed creation");
  assert.equal(currentDialog().length,1);
  const checks=x.f.tree().visible("button").filter(node=>node.owner===currentOwner&&node.attributes.type==="button"
    &&node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
  t.diagnostic(JSON.stringify({stage:"restored-current-owner",originalOwnerConnected:x.owner.isConnected,
    sameRestoredOwner:currentOwner===x.owner,route:x.h.store.route.get(),original,
    originalCheckControls:checks.length,restoreOrReopenPosts:intakePosts().length,
    eventClientReceipts:(await x.canonical()).eventClientReceipts}));
  assert.equal(checks.length,1,"The current restored owner must offer a deliberate Check of this unresolved original, not a fresh unrelated intake");
  const field=x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===currentOwner
    &&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
  assert.equal(field.port.value,AUTHORED.name);assert.equal(Object.hasOwn(field.attributes,"disabled"),true);
  const forms=x.f.tree().visible("form").filter(node=>node.owner===currentOwner&&String(node.attributes.class).split(/\s+/u).includes("project-intake"));
  assert.equal(forms.length,1);
  // Explicit successor to the previous manual-Retry-must-send-zero policy:
  // restoration/opening still sent ZERO. A user-directed exact-original Retry
  // now asks the existing atomic server; it never unpauses a generic write.
  assert.equal(intakePosts().length,0);assert.equal(x.dispatches.length,requests);
  if(recovery==="commit"){
    const retry=x.f.find("button",node=>node.owner===currentOwner&&node.attributes.class==="button primary"
      &&node.attributes.type!=="button"&&node.text===x.f.i18n.t("projects.retryOriginal","Retry same creation"));
    assert.equal(Object.hasOwn(retry.attributes,"disabled"),false);
    await x.f.act(forms[0],"submit",{submitter:retry.port});
  }else{
    const currentCheck=x.f.find("button",node=>node.owner===currentOwner&&node.attributes.type==="button"
      &&node.text===x.f.i18n.t("projects.checkOriginal","Check original"));
    await x.f.act(currentCheck);
  }
  assert.equal(x.dispatches.length,requests+1);assert.equal(x.dispatches.at(-1).body.intakeAction,recovery);
  assert.equal(intakePosts().length,1);assert.equal(intakePosts()[0].body.intakeAction,recovery);
  assert.deepEqual(x.dispatches.at(-1).body.events,x.dispatches[0].body.events);
  assertComplete(x.dispatches.at(-1));oneOriginal(await x.canonical(),original);
  assert.deepEqual(ids(x.dispatches.at(-1).reply),canonical.delta.map(row=>row.eventId));
  assert.deepEqual((await x.canonical()).delta,canonical.delta);
});

for(const interruption of ["route","new-draft"])test("intake late committed ACK cannot steal "+interruption,options,async t=>{
  const x=await createProjectIntakeFixture(t),release=sceneDeferred();let held=null;
  x.setBehavior(async(stage,row)=>{if(stage==="after-worker"&&!held){held=row;await release.promise;}});
  const pending=x.submit();
  try{
    await untilScene(()=>held!==null,"Real committed response is held");assertComplete(held);
    x.h.store.setRoute("/settings");await x.f.settle();let newerName=null;
    if(interruption==="new-draft"){
      x.h.store.setRoute("/projects");await x.f.settle();
      const newer=x.f.components().find(component=>component.tag==="forma-projects");
      assert.equal(Boolean(newer&&newer!==x.owner),true,"A genuinely fresh Projects owner");
      await x.f.act(x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===newer&&node.owner.label===x.f.i18n.t("projects.new","New project")));
      await reviewProjectIntake(x.f,newer,{objective:"Newer unsent outcome"});
      newerName=()=>x.f.find("input",node=>node.owner.tag==="forma-ui-field"&&node.owner.parentElement===newer&&node.owner.label===x.f.i18n.t("projects.projectName","Project name"));
      await input(x,newerName(),"Newer unsent intake");
    }
    const ownedEvents=x.h.store.events.get().map(event=>event.eventId),route=x.h.store.route.get();
    release.resolve();await pending;await x.f.settle();
    observe(t,x,{interruption,route:x.h.store.route.get()});
    assert.equal(x.h.store.route.get(),route);
    if(newerName)assert.equal(newerName().port.value,"Newer unsent intake");
    assert.deepEqual(x.h.store.events.get().map(event=>event.eventId),ownedEvents);
    assert.equal(x.dispatches.length,1,"The old completion never submits the newer draft");
    assert.equal(x.notifications.some(row=>row.toast.includes(AUTHORED.name)&&row.toast.includes("created")),false);
    oneOriginal(await x.canonical(),intendedIds(held.body.events));
  }finally{release.resolve();await pending;}
});

test("intake unknown ordinary Close and same-owner reopen keep the original for explicit Check",options,async t=>{
  const x=await createProjectIntakeFixture(t),lost=await lostCommitted(x);
  await reopen(x);assert.deepEqual(x.visible().draft,AUTHORED);assert.equal(x.visible().editable,false);
  const before=x.dispatches.length;await x.f.settle();assert.equal(x.dispatches.length,before,"Close/reopen never retries automatically");
  await x.check();assertComplete(x.dispatches.at(-1));observe(t,x);
  assert.deepEqual(x.dispatches.at(-1).body.events,lost.body.events);
  oneOriginal(await x.canonical(),intendedIds(lost.body.events));
});

test("intake body parser rejects coerced actions and extra keys without inserting an event",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),before=count(x.worker);
  const withType=type=>{const result=structuredClone(events);result[3].payload.type=type;return result;};
  for(const body of [
    {action:"project_intake",intakeAction:["check"],events},
    {action:["project_intake"],intakeAction:"commit",events},
    {action:"project_intake",intakeAction:"commit",events,unchecked:true},
    {action:"project_intake",intakeAction:"commit",events:withType(["direction"])},
    {action:"project_intake",intakeAction:"commit",events:withType({kind:"direction"})},
  ]){
    const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,body.action==="project_intake"?"invalid_project_intake":"unsupported_action");
    assert.equal(count(x.worker),before);assert.equal((await x.canonical()).eventClientReceipts,0);
  }
  assert.equal(count(x.worker),before);assert.equal((await x.canonical()).eventClientReceipts,0);observe(t,x);
});

test("intake existing effective-persona authorization stays supported and rechecks expiry at commit",options,async t=>{
  const x=await createProjectIntakeFixture(t),events=await captureUnsentIntake(x),now=new Date().toISOString();
  const actor=x.worker.owner,fictional="intake-fictional",persona="intake-persona",acting="intake-impersonation";
  // Existing actual authorization-row fixture pattern; no response/accessor replacement.
  x.worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(fictional,"intake-fictional@example.test","Fictional intake","creator","pilot-2026-08-10",now,now,now);
  x.worker.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(persona,"intake-replay",actor,fictional,"creative:"+fictional,"Fictional intake","ready",now,now);
  x.worker.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(acting,actor,persona,fictional,"intake-replay","active",now,new Date(Date.now()+3600000).toISOString());
  const headers={cookie:"forma_impersonation="+acting,"content-type":"application/json"};
  const send=(body,confirmed=true)=>x.worker.request("/api/events",{method:"POST",headers:{...headers,...(confirmed?{"x-forma-impersonation-confirmation":"I understand, continue"}:{})},body:JSON.stringify(body)});
  const body={action:"project_intake",intakeAction:"commit",events};
  assert.equal((await send(body,false)).status,428,"Existing per-interaction confirmation remains required");
  const committed=await send(body),reply=await committed.json();assert.equal(committed.status,200,reply.error);
  assertComplete({status:committed.status,reply,body});
  assert.equal(reply.appended.every(event=>event.streamId==="creative:"+fictional),true);
  assert.equal((await x.canonical()).projects.length,0,"Effective persona creation never writes principal stream");
  const repeated=await send({...body,intakeAction:"check"});assert.equal(repeated.status,200);assert.deepEqual(ids(await repeated.json()),ids(reply));
  const second=structuredClone(events),newProject=crypto.randomUUID(),newDocument=crypto.randomUUID();
  for(const [index,event] of second.entries()){event.payload.project_id=newProject;if(index)event.payload.document_id=newDocument;delete event.payload.client_event_id;if(event.payload.block_id)event.payload.block_id=crypto.randomUUID();}
  let expired=false;x.worker.controls.beforeBatch=async statements=>{if(rootBatch(statements)&&!expired){expired=true;x.worker.sqlite.prepare("UPDATE impersonation_sessions SET expires_at=? WHERE impersonation_id=?").run("2000-01-01T00:00:00.000Z",acting);}};
  const refused=await send({...body,events:second});x.worker.controls.beforeBatch=null;
  assert.equal(expired,true);assert.equal(refused.status,403);assert.equal((await refused.json()).status,"unknown");
  assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts WHERE stream_id=?").get("creative:"+fictional).count,4);
  observe(t,x,{effectiveUser:fictional,originalEventIds:ids(reply),expired});
});

for(const shape of ["blank","full"])test("intake current builder "+shape+" shape stays complete and exact",options,async t=>{
  const x=await createProjectIntakeFixture(t);
  if(shape==="blank"){
    await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.text===projectIntakeMessage(x.f.locale,"back")));
    await x.f.act(x.f.find("button",node=>node.owner===x.owner&&node.text===projectIntakeMessage(x.f.locale,"blank")));
  }
  else{
    const field=(tag,attribute,value)=>x.f.find(tag,node=>node.owner===x.owner&&node.attributes[attribute]===value);
    await input(x,field("input","placeholder",x.f.i18n.system("Audience, stakeholders, or decision makers")),"Current authors and reviewers");
    await input(x,field("textarea","maxlength","12000"),"A complete current authored message.");
    await input(x,x.field(x.f.i18n.system("Message")+" · "+x.f.i18n.system("Exact value")),"Keep this exact phrase.");
    await input(x,field("input","placeholder",x.f.i18n.system("A campaign, presentation, written brief, or other finished output")),"An executive deck");
    await input(x,field("input","maxlength","400"),"No invented evidence.");
    await input(x,field("textarea","maxlength","5000"),"An explicitly licensed source passage.");
    assert.equal(x.visible().submitEnabled,false,"The existing source-rights gate remains");
    const rights=field("input","type","checkbox");rights.port.checked=true;await x.f.act(rights,"change");
  }
  await x.submit();assert.equal(x.dispatches.length,1);
  const row=x.dispatches[0],expected=shape==="blank"?3:11,canonical=await x.canonical();observe(t,x,{shape,canonical});
  assert.equal(row.status,200,row.reply.error);assert.equal(row.reply.status,"complete");
  assert.equal(row.body.events.length,expected);assert.equal(row.reply.appended.length,expected);
  assert.deepEqual(row.reply.appended.map(event=>event.payload),row.body.events.map(event=>event.payload));
  assert.equal(canonical.projects.length,1);assert.equal(canonical.documents.length,1);assert.equal(canonical.eventClientReceipts,expected);
  assert.equal(x.visible().modal,false);
});

test("atomic intake custom receipt namespace and metadata survive lost ACK, repeat and Check",options,async t=>{
  const x=await createProjectIntakeFixture(t),captured=await captureUnsentIntake(x),validated=projectIntake(captured);
  assert.ok(validated);
  const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
  assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
  const auth={user:result.user,principal:result.user,impersonation:null};
  const prefix="atomic-source:🧭:v1:"+validated.projectId+":";
  const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
  intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
  const config={receiptPrefix:prefix,clientId:"test:atomic-source",correlationPrefix:"test:atomic-correlation:",guard:{sql:"1=1",bindings:[]}};
  let committed;const lost=Error("Synthetic loss after the actual custom atomic core committed");
  await assert.rejects(async()=>{
    const response=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config),body=await response.json();
    committed={response,body};assertComplete(rawRow(intake.events,committed));throw lost;
  },error=>error===lost);
  const first=await x.canonical(),changes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  oneOriginal(first,intendedIds(intake.events));
  for(const [index,event] of committed.body.appended.entries()){
    const row=x.worker.sqlite.prepare("SELECT client_id,correlation_id FROM events WHERE stream_id=? AND event_id=?").get(x.worker.streamId,event.eventId);
    assert.equal(row.client_id,config.clientId);assert.equal(row.correlation_id,config.correlationPrefix+intake.projectId);
    const receipt=x.worker.sqlite.prepare("SELECT event_id FROM event_client_receipts WHERE stream_id=? AND client_event_id=?").get(x.worker.streamId,prefix+index);
    assert.equal(receipt.event_id,event.eventId);
  }
  for(const action of ["commit","check"]){
    const response=await commitAtomicIntake(x.worker.env,auth,intake,action,config),body=await response.json();
    assertComplete(rawRow(intake.events,{response,body}));assert.deepEqual(body.appended,committed.body.appended);
    assert.deepEqual((await x.canonical()).delta,first.delta);
  }
  assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,changes);
  assert.equal(x.dispatches.length,1,"Only the original captured pre-Worker transport attempt exists; core calls are explicit");
});

test("atomic intake snapshots borrowed events and options before its first await",options,async t=>{
  const x=await createProjectIntakeFixture(t),validated=projectIntake(await captureUnsentIntake(x));assert.ok(validated);
  const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
  assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
  const auth={user:result.user,principal:result.user,impersonation:null},prefix="atomic-capture:v1:"+validated.projectId+":";
  const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
  intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
  const config={receiptPrefix:prefix,clientId:"test:captured-client",correlationPrefix:"test:captured-correlation:",guard:{sql:"?=1",bindings:[1]}};
  const original=structuredClone({intake,config});let mutated=false;
  const originalDatabase=x.worker.env.DB;let redirectedDatabaseCalls=0;
  const redirectedDatabase={
    prepare(...args){redirectedDatabaseCalls++;return originalDatabase.prepare(...args);},
    batch(...args){redirectedDatabaseCalls++;return originalDatabase.batch(...args);},
    exec(...args){redirectedDatabaseCalls++;return originalDatabase.exec(...args);},
  };
  x.worker.controls.beforeRead=async()=>{
    if(mutated)return;mutated=true;
    intake.projectId=crypto.randomUUID();intake.documentId=crypto.randomUUID();
    intake.events[0].payload.name="Borrower changed private name";intake.events[0].payload.client_event_id="borrower:replacement:0";
    intake.events.pop();config.receiptPrefix="borrower:replacement:";config.clientId="borrower:client";
    config.correlationPrefix="borrower:correlation:";config.guard.sql="0=1";config.guard.bindings[0]=0;
    auth.user.userId="borrower-mutated-owner";auth.user.streamId="creative:borrower-mutated-stream";
    x.worker.env.DB=redirectedDatabase;
  };
  let response;try{response=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config);}finally{
    x.worker.controls.beforeRead=null;auth.user.userId=x.worker.owner;auth.user.streamId=x.worker.streamId;x.worker.env.DB=originalDatabase;
  }
  const body=await response.json();assert.equal(mutated,true);
  assert.equal(redirectedDatabaseCalls,0,"The replacement reference delegates to the same real DB but is never used");
  assertComplete(rawRow(original.intake.events,{response,body}));
  assert.deepEqual(body.appended.map(event=>event.payload),original.intake.events.map(event=>event.payload));
  for(const event of body.appended){
    const row=x.worker.sqlite.prepare("SELECT stream_id,client_id,correlation_id FROM events WHERE event_id=?").get(event.eventId);
    const secret=x.worker.sqlite.prepare("SELECT owner_id FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
    assert.equal(row.stream_id,x.worker.streamId);assert.equal(secret.owner_id,x.worker.owner);
    assert.equal(row.client_id,original.config.clientId);assert.equal(row.correlation_id,original.config.correlationPrefix+original.intake.projectId);
  }
  const check=await commitAtomicIntake(x.worker.env,auth,original.intake,"check",original.config),reply=await check.json();
  assert.equal(check.status,200);assert.deepEqual(reply.appended,body.appended);
  oneOriginal(await x.canonical(),intendedIds(original.intake.events));
});

test("atomic intake additional guard is enforced at initial, transaction and final disclosure boundaries",options,async t=>{
  for(const boundary of ["initial","transaction","final disclosure"])await t.test(boundary,async t=>{
    const x=await createProjectIntakeFixture(t),validated=projectIntake(await captureUnsentIntake(x));assert.ok(validated);
    const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
    assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
    const auth={user:result.user,principal:result.user,impersonation:null},prefix="atomic-guard:v1:"+validated.projectId+":";
    const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
    intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
    const originalName=x.worker.sqlite.prepare("SELECT display_name FROM users WHERE user_id=?").get(x.worker.owner).display_name;
    const config={receiptPrefix:prefix,clientId:"test:guard-client",correlationPrefix:"test:guard-correlation:",
      guard:{sql:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND display_name=?)",bindings:[x.worker.owner,originalName]}};
    const rowCounts=()=>Object.fromEntries(["events","event_private_payloads","event_client_receipts"].map(table=>[table,x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
    const before=rowCounts();let reads=0,withdrawals=0,retained=null;
    const withdraw=()=>{withdrawals++;x.worker.sqlite.prepare("UPDATE users SET display_name=? WHERE user_id=?").run("Additional condition withdrawn",x.worker.owner);};
    if(boundary==="initial")withdraw();
    if(boundary==="transaction")x.worker.controls.beforeBatch=async statements=>{if(rootBatch(statements)&&!withdrawals)withdraw();};
    if(boundary==="final disclosure")x.worker.controls.beforeRead=async statement=>{if(exactRead(statement)&&++reads===2)withdraw();};
    let response;try{response=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config);}finally{x.worker.controls.beforeRead=null;x.worker.controls.beforeBatch=null;}
    const body=await response.json();assert.equal(withdrawals,1);assert.equal(response.status,403);assert.equal(Object.hasOwn(body,"appended"),false);
    const permission=x.worker.sqlite.prepare("SELECT role,consent_version FROM users WHERE user_id=?").get(x.worker.owner);
    assert.equal(permission.role,result.user.role);assert.ok(["creator","admin"].includes(permission.role));assert.equal(permission.consent_version,"pilot-2026-08-10","Only the additional guard was withdrawn");
    if(boundary==="final disclosure"){
      assert.equal(reads,2);retained=await x.canonical();oneOriginal(retained,intendedIds(intake.events));
    }else assert.deepEqual(rowCounts(),before,"No event, private-payload orphan or receipt survives denied admission");
    x.worker.sqlite.prepare("UPDATE users SET display_name=? WHERE user_id=?").run(originalName,x.worker.owner);
    const recoveryChanges=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
    const recovered=await commitAtomicIntake(x.worker.env,auth,intake,boundary==="final disclosure"?"check":"commit",config),reply=await recovered.json();
    assertComplete(rawRow(intake.events,{response:recovered,body:reply}));oneOriginal(await x.canonical(),intendedIds(intake.events));
    if(retained){
      assert.deepEqual(ids(reply),retained.delta.map(event=>event.eventId));assert.deepEqual((await x.canonical()).delta,retained.delta);
      assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,recoveryChanges,"Successful same-original Check is read-only");
    }
    const stable=rowCounts(),changes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
    x.worker.sqlite.prepare("UPDATE users SET display_name=? WHERE user_id=?").run("Disclosure condition withdrawn",x.worker.owner);
    const denied=await commitAtomicIntake(x.worker.env,auth,intake,"check",config),deniedBody=await denied.json();
    assert.equal(denied.status,403);assert.equal(Object.hasOwn(deniedBody,"appended"),false);assert.deepEqual(rowCounts(),stable);
    assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,changes+1,"Only the explicit guard-row mutation wrote");
  });
});

test("atomic intake OR in an additional guard never overrides denied ordinary authority",options,async t=>{
  for(const boundary of ["initial","transaction","final disclosure"])await t.test(boundary,async t=>{
    const x=await createProjectIntakeFixture(t),validated=projectIntake(await captureUnsentIntake(x));assert.ok(validated);
    const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
    assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
    const auth={user:result.user,principal:result.user,impersonation:null},prefix="atomic-conjunction:v1:"+validated.projectId+":";
    const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
    intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
    const config={receiptPrefix:prefix,clientId:"test:conjunction-client",correlationPrefix:"test:conjunction-correlation:",guard:{sql:"0=1 OR 1=1",bindings:[]}};
    const rowCounts=()=>Object.fromEntries(["events","event_private_payloads","event_client_receipts"].map(table=>[table,x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
    const before=rowCounts();let reads=0,withdrawals=0;
    const withdraw=()=>{withdrawals++;x.worker.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(x.worker.owner);};
    if(boundary==="initial")withdraw();
    if(boundary==="transaction")x.worker.controls.beforeBatch=async statements=>{if(rootBatch(statements)&&!withdrawals)withdraw();};
    if(boundary==="final disclosure")x.worker.controls.beforeRead=async statement=>{if(exactRead(statement)&&++reads===2)withdraw();};
    let response;try{response=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config);}finally{x.worker.controls.beforeRead=null;x.worker.controls.beforeBatch=null;}
    const body=await response.json();assert.equal(withdrawals,1);assert.equal(response.status,403);assert.equal(Object.hasOwn(body,"appended"),false);
    if(boundary==="final disclosure"){assert.equal(reads,2);oneOriginal(await x.canonical(),intendedIds(intake.events));}
    else assert.deepEqual(rowCounts(),before,"An OR-bearing additional guard cannot admit or leave private orphans");
  });
});

test("atomic intake custom originals cannot be disclosed across namespaces, filled or replaced",options,async t=>{
  for(const fault of ["other namespace","partial receipt","changed manifest","concurrent root collision","foreign extra key in default namespace","foreign extra key in custom namespace"])await t.test(fault,async t=>{
    const x=await createProjectIntakeFixture(t),validated=projectIntake(await captureUnsentIntake(x));assert.ok(validated);
    const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
    assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
    const auth={user:result.user,principal:result.user,impersonation:null},defaults=fault==="foreign extra key in default namespace";
    const prefix=defaults?validated.events[0].payload.client_event_id.slice(0,-1):"atomic-fence:v1:"+validated.projectId+":";
    if(defaults)assert.deepEqual(validated.events.map(event=>event.payload.client_event_id),validated.events.map((_event,index)=>prefix+index));
    const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
    intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
    const config=defaults?undefined:{receiptPrefix:prefix,clientId:"test:fence-client",correlationPrefix:"test:fence-correlation:",guard:{sql:"1=1",bindings:[]}};
    const rowCounts=()=>Object.fromEntries(["events","event_private_payloads","event_client_receipts"].map(table=>[table,x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
    if(fault.startsWith("foreign extra key")){
      const before=rowCounts(),existing=x.worker.sqlite.prepare("SELECT event_id,sequence,recorded_at FROM events WHERE stream_id=? ORDER BY sequence LIMIT 1").get(x.worker.streamId);
      assert.ok(existing);let injected=0;
      x.worker.controls.afterRead=async(statement,value)=>{
        if(exactRead(statement)&&!injected){
          assert.equal(value.results[0].receipt_total,0);injected++;
          // Deliberate storage fault after the real absent snapshot, not an API exploit or ordinary receipt writer.
          x.worker.sqlite.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)")
            .run(x.worker.streamId,prefix+"999",existing.event_id,existing.sequence,existing.recorded_at);
        }
      };
      let response;try{response=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config);}finally{x.worker.controls.afterRead=null;}
      const body=await response.json();assert.equal(injected,1);assert.equal(response.status,409);assert.equal(body.status,"unknown");assert.equal(Object.hasOwn(body,"appended"),false);
      assert.deepEqual(rowCounts(),{...before,event_client_receipts:before.event_client_receipts+1},"Only the explicitly injected foreign receipt survives; all own inserts roll back");
      const foreign=x.worker.sqlite.prepare("SELECT event_id,sequence FROM event_client_receipts WHERE stream_id=? AND client_event_id=?").get(x.worker.streamId,prefix+"999");
      assert.equal(foreign.event_id,existing.event_id);assert.equal(foreign.sequence,existing.sequence);
      for(const event of intake.events)assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts WHERE stream_id=? AND client_event_id=?").get(x.worker.streamId,event.payload.client_event_id).count,0);
      const changes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
      const check=await commitAtomicIntake(x.worker.env,auth,intake,"check",config),reply=await check.json();
      assert.equal(check.status,409);assert.equal(Object.hasOwn(reply,"appended"),false);
      assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,changes);
      return;
    }
    if(fault==="concurrent root collision"){
      const entered=sceneDeferred(),release=sceneDeferred();let held=false;
      x.worker.controls.afterRead=async(statement,value)=>{
        if(exactRead(statement)&&!held){held=true;entered.resolve(value);await release.promise;}
      };
      const pending=commitAtomicIntake(x.worker.env,auth,intake,"commit",config).then(response=>({ok:true,response}),error=>({ok:false,error}));let winner,first,outcome,failed=false,failure;
      const competing=structuredClone(intake);competing.events[0].payload.name="Different custom concurrent original";
      try{
        const reached=await Promise.race([entered.promise.then(value=>({stage:"entered",value})),pending.then(outcome=>({stage:"finished",outcome}))]);
        assert.equal(reached.stage,"entered","The real initial receipt read is held before either core completes");
        assert.equal(reached.value.results[0].receipt_total,0);
        const response=await commitAtomicIntake(x.worker.env,auth,competing,"commit",config),body=await response.json();
        winner={response,body};assertComplete(rawRow(competing.events,winner));
      }catch(error){failed=true;failure=error;}
      finally{release.resolve();outcome=await pending;x.worker.controls.afterRead=null;}
      if(!outcome.ok)throw outcome.error;
      first=outcome.response;
      if(failed)throw failure;
      const firstBody=await first.json();assert.equal(first.status,409);assert.equal(Object.hasOwn(firstBody,"appended"),false);
      oneOriginal(await x.canonical(),intendedIds(intake.events));
      const stored=(await readWorkspaceEvents(x.worker.env,x.worker.streamId)).find(event=>event.eventId===winner.body.appended[0].eventId);
      assert.equal(stored.payload.name,competing.events[0].payload.name);
      const changes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
      const check=await commitAtomicIntake(x.worker.env,auth,competing,"check",config),reply=await check.json();
      assert.equal(check.status,200);assert.deepEqual(reply.appended,winner.body.appended);
      assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,changes);
      return;
    }
    const committed=await commitAtomicIntake(x.worker.env,auth,intake,"commit",config),original=await committed.json();
    assertComplete(rawRow(intake.events,{response:committed,body:original}));
    const candidate=structuredClone(intake),candidateConfig=structuredClone(config);
    if(fault==="other namespace"){
      candidateConfig.receiptPrefix="atomic-other:v1:"+intake.projectId+":";
      candidate.events.forEach((event,index)=>{event.payload.client_event_id=candidateConfig.receiptPrefix+index;});
    }else if(fault==="partial receipt"){
      // Explicit receipt-storage fault; not an assertion that D1 partially commits.
      x.worker.sqlite.prepare("DELETE FROM event_client_receipts WHERE stream_id=? AND client_event_id=?").run(x.worker.streamId,prefix+2);
    }else candidate.events[0].payload.name="Changed custom manifest after original commit";
    const stable=rowCounts(),changes=x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
    for(const action of fault==="other namespace"?["check"]:["check","commit"]){
      const response=await commitAtomicIntake(x.worker.env,auth,candidate,action,candidateConfig),body=await response.json();
      assert.equal(response.status,409);assert.equal(body.status,"unknown");assert.equal(Object.hasOwn(body,"appended"),false);
      assert.deepEqual(rowCounts(),stable);
    }
    assert.equal(x.worker.sqlite.prepare("SELECT total_changes() AS count").get().count,changes);
    const all=await readWorkspaceEvents(x.worker.env,x.worker.streamId);
    assert.equal(all.find(event=>event.eventId===original.appended[0].eventId).payload.name,intake.events[0].payload.name);
    assert.equal((await x.canonical()).eventClientReceipts,fault==="partial receipt"?3:4);
    if(fault!=="partial receipt"){
      const response=await commitAtomicIntake(x.worker.env,auth,intake,"check",config),body=await response.json();
      assert.equal(response.status,200);assert.deepEqual(body.appended,original.appended);
    }
    if(fault==="other namespace"){
      const standard=await x.raw(validated.events,"check");
      assert.equal(standard.response.status,409);assert.equal(Object.hasOwn(standard.body,"appended"),false);
      assert.deepEqual(rowCounts(),stable,"Default route cannot disclose or mutate a custom original");
    }
  });
});

test("atomic intake malformed internal envelopes and options invoke no read, run or batch operation",options,async t=>{
  const x=await createProjectIntakeFixture(t),validated=projectIntake(await captureUnsentIntake(x));assert.ok(validated);
  const result=await requireUser(new Request("http://localhost/api/events"),x.worker.env,"creator");
  assert.equal(Boolean(result.response),false);assert.equal(result.user.userId,x.worker.owner);assert.equal(result.user.streamId,x.worker.streamId);
  const auth={user:result.user,principal:result.user,impersonation:null},prefix="atomic-shape:v1:"+validated.projectId+":";
  const intake={projectId:validated.projectId,documentId:validated.documentId,events:structuredClone(validated.events)};
  intake.events.forEach((event,index)=>{event.payload.client_event_id=prefix+index;});
  const config={receiptPrefix:prefix,clientId:"test:shape-client",correlationPrefix:"test:shape-correlation:",guard:{sql:"1=1",bindings:[]}};
  let getters=0,databaseCalls=0;
  const accessor={...config,guard:{bindings:[]}};
  Object.defineProperty(accessor.guard,"sql",{enumerable:true,get(){getters++;return "1=1";}});
  const mismatched=structuredClone(intake);mismatched.events[0].payload.client_event_id=prefix+"99";
  const cases=[
    ["extra envelope field",{...intake,approval:true},config],
    ["extra options field",intake,{...config,approved:true}],
    ["extra guard field",intake,{...config,guard:{...config.guard,approved:true}}],
    ["missing guard",intake,{receiptPrefix:prefix,clientId:config.clientId,correlationPrefix:config.correlationPrefix}],
    ["accessor is not invoked",intake,accessor],
    ["receipt key mismatch",mismatched,config],
  ];
  const before=Object.fromEntries(["events","event_private_payloads","event_client_receipts"].map(table=>[table,x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
  x.worker.controls.beforeRead=async()=>{databaseCalls++;};x.worker.controls.beforeRun=async()=>{databaseCalls++;};x.worker.controls.beforeBatch=async()=>{databaseCalls++;};
  try{
    for(const [name,value,configuration] of cases){
      const response=await commitAtomicIntake(x.worker.env,auth,value,"commit",configuration),body=await response.json();
      assert.equal(response.status,400,name);assert.equal(Object.hasOwn(body,"appended"),false,name);
      assert.equal(databaseCalls,0,name);assert.equal(getters,0,name);
    }
  }finally{x.worker.controls.beforeRead=null;x.worker.controls.beforeRun=null;x.worker.controls.beforeBatch=null;}
  const after=Object.fromEntries(["events","event_private_payloads","event_client_receipts"].map(table=>[table,x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
  assert.deepEqual(after,before);assert.equal(getters,0);
});
