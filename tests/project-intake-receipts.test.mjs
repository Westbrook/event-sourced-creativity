// Actual complete Projects/Shell/Store -> routed Worker/RAM SQLite regression.
// Interleavings/corruption are explicitly labeled; no browser/provider claim.
import assert from "node:assert/strict";
import test from "node:test";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { AUTHORED,createProjectIntakeFixture,captureUnsentIntake,assertComplete,intendedIds,sceneDeferred,untilScene,readWorkspaceEvents,reviewProjectIntake } from "./helpers/project-intake-fixture.mjs";
import {projectIntakeMessage} from "../src/components/design-system/locales/project-intake-messages.ts";
const {projectIntake}=await import("../src/model/project-intake.ts");

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
