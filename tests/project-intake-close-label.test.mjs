// Actual complete Projects/Shell/Store and routed Worker/RAM SQLite.
// Additive footer-contract tests; finite current DOM/event ports, not a browser.
// The ACK fault happens only AFTER the original Worker commit. No success,
// private method, receipt, append, or authoring oracle is substituted.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {AUTHORED,createProjectIntakeFixture,assertComplete,intendedIds} from "./helpers/project-intake-fixture.mjs";

const options={concurrency:false,timeout:45000};
const locales=["en","fr","ar","ja"];
const eventIds=row=>row.reply.appended.map(event=>event.eventId);
const countEvents=x=>x.worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=?").get(x.worker.streamId).count;
const text=(x,key,fallback)=>x.f.i18n.t(key,fallback);
const footerButtons=x=>x.f.tree().visible("button").filter(node=>{
  if(node.owner!==x.owner)return false;
  let footer=false;
  for(let parent=node.parent;parent;parent=parent.parent){
    if(parent.tag==="footer")footer=true;
    if(parent.tag==="form"&&parent.attributes.class==="modal-card wide")return footer;
  }
  return false;
});
function footerDismiss(x){
  const buttons=footerButtons(x).filter(node=>node.attributes.type==="button"&&node.attributes.class==="button ghost");
  assert.equal(buttons.length,1,"One actual current footer dismissal, excluding the top-right Close icon and project cards");
  assert.equal(Object.hasOwn(buttons[0].attributes,"disabled"),false);
  return buttons[0];
}
function footerAction(x,key,fallback){
  const buttons=footerButtons(x).filter(node=>node.text===text(x,key,fallback));
  assert.equal(buttons.length,1,"One current footer action for "+key);
  return buttons[0];
}
const draft=x=>({
  name:x.field(text(x,"projects.projectName","Project name")).port.value,
  documentTitle:x.field(x.f.i18n.system("Document name")).port.value,
  objective:x.objective().port.value,
});
function assertDraft(x,expected,locked){
  assert.deepEqual(draft(x),expected,"The actual current fields preserve raw spaces, newline and authored Unicode");
  for(const node of [x.field(text(x,"projects.projectName","Project name")),x.field(x.f.i18n.system("Document name")),x.objective()])
    assert.equal(Object.hasOwn(node.attributes,"disabled"),locked,"Only retained attempted intake locks its original field");
}
async function typeRawDraft(x,locale){
  const value={
    name:"  "+AUTHORED.name+"  ",
    documentTitle:"  "+AUTHORED.documentTitle+" — "+locale+" 文書  ",
    objective:"  "+AUTHORED.objective+"\n"+locale+" — سؤال 文書  ",
  };
  for(const [label,raw] of [[text(x,"projects.projectName","Project name"),value.name],
    [x.f.i18n.system("Document name"),value.documentTitle]]){
    const node=x.field(label);node.port.value=raw;await x.f.act(node,"input");
  }
  const objective=x.objective();objective.port.value=value.objective;await x.f.act(objective,"input");
  assertDraft(x,value,false);
  assert.equal(x.dispatches.length,0,"Typing the raw draft has not attempted intake");
  return value;
}
function assertStatus(x,key){
  const node=x.f.find("p",candidate=>candidate.owner===x.owner&&candidate.attributes.role==="status"&&candidate.parent?.tag==="form"&&candidate.parent.parent?.tag==="dialog"&&String(candidate.parent.parent.attributes.class??"").split(/\s+/u).includes("project-create-dialog"));
  assert.equal(node.text,text(x,key));
}
async function dismissAndReopen(x,raw,locked){
  const before={requests:x.h.requests.length,intakes:x.dispatches.length,events:countEvents(x)};
  // Locate and activate the CURRENT visible footer action by structure, even
  // on the baseline where it incorrectly says Cancel. Assert the desired
  // labels after the complete causal continuation, not before it can run.
  const beforeLabel=footerDismiss(x).text;
  await x.f.act(footerDismiss(x));
  assert.equal(x.f.tree().visible("dialog").filter(node=>node.owner===x.owner&&String(node.attributes.class).includes("project-create-dialog")).length,0);
  assert.equal(x.f.components().includes(x.owner),true,"Ordinary Close retains the same Projects owner");
  assert.equal(x.h.store.route.get(),"/projects");
  const opener=x.f.find("button",node=>node.owner.tag==="forma-ui-button"&&node.owner.parentElement===x.owner&&node.owner.label===(locked?x.f.i18n.system("Resume {title}",{title:"\u2068"+raw.name.trim()+"\u2069"}):text(x,"projects.new","New project")));
  await x.f.act(opener);
  assert.equal(x.f.tree().visible("dialog").filter(node=>node.owner===x.owner&&String(node.attributes.class).includes("project-create-dialog")).length,1);
  assertDraft(x,raw,locked);
  assert.equal(x.h.requests.length,before.requests,"Footer dismissal and ordinary reopening make no automatic HTTP request");
  assert.equal(x.dispatches.length,before.intakes,"No automatic commit or Check is made on reopening");
  assert.equal(countEvents(x),before.events,"Closing is not a server cancellation or replacement creation");
  return{beforeLabel,afterLabel:footerDismiss(x).text,footerLabels:footerButtons(x).map(node=>node.text)};
}
function assertCloseLabels(x,labels){
  const close=text(x,"action.close","Close"),cancel=text(x,"action.cancel","Cancel");
  assert.equal(labels.beforeLabel,close,"A retained original uses Close before dismissal");
  assert.equal(labels.afterLabel,close,"The same retained original still uses Close on reopening");
  assert.equal(labels.footerLabels.includes(cancel),false,"The retained-original footer must not claim Cancel");
}
async function loseCommittedAck(x){
  let lost=null;
  x.setBehavior(async(stage,row)=>{
    if(stage==="after-worker"&&!lost){
      assert.equal(row.status,200);
      assertComplete(row);
      lost=row;row.dropped=true;
      throw Error("Synthetic lost ACK after the actual complete project intake committed");
    }
  });
  await x.submit();
  assert.ok(lost,"A real complete Worker receipt was lost, not a synthetic success");
  assert.equal(x.dispatches.length,1);
  assert.equal(lost.dropped,true);
  assert.equal(lost.body.intakeAction,"commit");
  assertComplete(lost);
  x.setBehavior(async()=>{});
  return lost;
}
function assertExactCheck(x,original,row){
  assert.equal(row.body.intakeAction,"check","The explicit action reads the original instead of retrying creation");
  assert.deepEqual(row.body.events,original.body.events,"Every retained original input and client-event ID stays identical");
  assert.deepEqual(assertComplete(row),intendedIds(original.body.events));
  assert.deepEqual(eventIds(row),eventIds(original),"The Worker returns the original canonical event IDs");
  assert.equal(x.dispatches.filter(item=>item.body.intakeAction==="commit").length,1,"There was only the original creation attempt");
}
async function removeOriginalAfterNewerProject(x,original){
  // Same genuine newer-B/removal setup as project-intake-original-document:
  // another live document cannot be mistaken for original A on recovery.
  const events=structuredClone(original.body.events),projectId=crypto.randomUUID(),documentId=crypto.randomUUID();
  for(const [index,event] of events.entries()){
    event.payload.project_id=projectId;
    if(index)event.payload.document_id=documentId;
    delete event.payload.client_event_id;
    if(event.payload.block_id)event.payload.block_id=crypto.randomUUID();
  }
  events[0].payload.name="Canonical newer B";events[1].payload.title="Newer B document";
  const newer=await x.raw(events);
  assert.equal(newer.response.status,200);assert.equal(newer.body.status,"complete");
  const a=intendedIds(original.body.events);
  const response=await x.worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"append",event:{type:"DocumentRemoved",payload:{project_id:a.projectId,document_id:a.documentId}}})});
  const body=await response.json();assert.equal(response.status,200,body.error);
  assert.equal(body.appended.some(event=>event.type==="DocumentRemoved"&&event.payload.document_id===a.documentId),true);
  return{projectId,documentId};
}

for(const locale of locales){
  test("intake pre-attempt footer remains Cancel and preserves its raw unsubmitted draft: "+locale,options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),raw=await typeRawDraft(x,locale);
    const labels=await dismissAndReopen(x,raw,false);
    assert.equal(labels.beforeLabel,text(x,"action.cancel","Cancel"));
    assert.equal(labels.afterLabel,text(x,"action.cancel","Cancel"));
    assert.equal(labels.footerLabels.includes(text(x,"action.close","Close")),false,"Top-right Close must not mask the footer contract");
    assert.equal(footerButtons(x).length,2,"Only Cancel and Create exist before any attempt");
    assert.equal(x.dispatches.length,0);
    assert.equal((await x.canonical()).projects.length,0);
    t.diagnostic(JSON.stringify({locale,phase:"before-attempt",...labels,requests:0,rawDraftRetained:true}));
  });

  test("intake lost committed ACK uses footer Close, retains exact original and explicitly checks it: "+locale,options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),raw=await typeRawDraft(x,locale),original=await loseCommittedAck(x);
    const ids=intendedIds(original.body.events),before=countEvents(x);
    assertStatus(x,"projects.originalUnconfirmed");assertDraft(x,raw,true);
    assert.equal(footerButtons(x).length,3);
    const labels=await dismissAndReopen(x,raw,true);
    assertStatus(x,"projects.originalUnconfirmed");
    assert.equal(labels.footerLabels.includes(text(x,"projects.retryOriginal","Retry same creation")),true);
    await x.f.act(footerAction(x,"projects.checkOriginal","Check original"));
    assert.equal(x.dispatches.length,2);assertExactCheck(x,original,x.dispatches[1]);
    assert.equal(documentIdFromRoute(x.h.store.route.get()),ids.documentId,"An explicit Check opens exact original A, not a new document");
    assert.equal(countEvents(x),before,"Recovery adds no creation, cancellation, or navigation event");
    const canonical=await x.canonical();
    assert.equal(canonical.projects.length,1);assert.equal(canonical.projects[0].projectId,ids.projectId);
    assert.equal(canonical.documents.length,1);assert.equal(canonical.documents[0].documentId,ids.documentId);
    t.diagnostic(JSON.stringify({locale,phase:"lost-committed-ack",...labels,original:ids,
      intakeActions:x.dispatches.map(row=>row.body.intakeAction),sameOriginalEventIds:true,rawDraftRetained:true,noAutomaticRequest:true}));
    assertCloseLabels(x,labels);
  });

  test("intake confirmed original unavailable uses footer Close and only checks the retained original: "+locale,options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),raw=await typeRawDraft(x,locale),original=await loseCommittedAck(x);
    const ids=intendedIds(original.body.events),newer=await removeOriginalAfterNewerProject(x,original),before=countEvents(x);
    await x.f.act(footerAction(x,"projects.checkOriginal","Check original"));
    assert.equal(x.dispatches.length,2);assertExactCheck(x,original,x.dispatches[1]);
    assert.equal(x.h.store.route.get(),"/projects");
    assertStatus(x,"projects.originalConfirmedUnavailable");assertDraft(x,raw,true);
    assert.equal(footerButtons(x).length,2,"Confirmed-unavailable exposes dismissal and availability Check, never creation Retry");
    const labels=await dismissAndReopen(x,raw,true);
    assertStatus(x,"projects.originalConfirmedUnavailable");
    assert.equal(labels.footerLabels.includes(text(x,"projects.retryOriginal","Retry same creation")),false);
    assert.equal(labels.footerLabels.includes(text(x,"projects.createAction","Create project")),false);
    await x.f.act(footerAction(x,"projects.checkOriginalAvailability","Check original availability"));
    assert.equal(x.dispatches.length,3);assertExactCheck(x,original,x.dispatches[2]);
    assert.equal(x.h.store.route.get(),"/projects","Unavailable original A must not open newer B");
    assert.notEqual(documentIdFromRoute(x.h.store.route.get()),newer.documentId);
    assertStatus(x,"projects.originalConfirmedUnavailable");assertDraft(x,raw,true);
    assert.equal(countEvents(x),before,"Both explicit Checks and Close/reopen leave actual canonical events unchanged");
    t.diagnostic(JSON.stringify({locale,phase:"confirmed-original-unavailable",...labels,original:ids,newer,
      intakeActions:x.dispatches.map(row=>row.body.intakeAction),sameOriginalEventIds:true,rawDraftRetained:true,noAutomaticRequest:true}));
    assertCloseLabels(x,labels);
  });
}
