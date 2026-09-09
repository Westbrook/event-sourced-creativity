// Pure asynchronous controls for the actual new UI methods. This imports
// no application, provider, database, browser, or registered historical tests.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const start = source.indexOf("  #nativeStoryboardJob(job:DocumentJob){");
const end = source.indexOf("  #nativeSlidesJob(job:DocumentJob){", start);
assert.ok(start > 0 && end > start, "exact new-method boundaries exist");
const methods = source.slice(start, end);
assert.equal((methods.match(/async #openOriginalStoryboard\(/g) ?? []).length, 1);
const minimalClass = stripTypeScriptTypes(`class Subject {
  #storyboardResultRead=null; #storyboardResultError=null; #activeId=""; #convertingId="";
  #storyboardCompletedJobs=new Map(); #storyboardOverflow=null;
  constructor(state){this.state=state;this.store=state.store;this.ownerDocument=state.document;
    this.i18n={system:value=>value,date:()=>"Recorded completion"};}
  #nativeStoryEligible(documentId){return this.state.eligible&&documentId===this.state.documentId;}
  #privateSourceCurrent(){const identity=this.state.sourceIdentity;return()=>this.state.sourceCurrent&&this.state.sourceIdentity===identity;}
  #readonlyReuseView(){return this.state.readonly;}
  contains(node){return this.state.contains&&node===this.state.trigger;}
  closest(){return this.state.hidden?{}:null;}
  requestUpdate(){this.state.updates++;}
  open(job=this.state.job,trigger=this.state.trigger){return this.#openOriginalStoryboard(job,{currentTarget:trigger},()=>this.state.renderedCurrent);}
  eligible(job){return this.#nativeStoryboardJob(job);}
  identity(job){return this.#nativeStoryboardJobIdentity(job);}
  active(value){this.#activeId=value;}
  converting(value){this.#convertingId=value;}
  pending(){return this.#storyboardResultRead;}
  replacePending(value){this.#storyboardResultRead=value;}
  error(){return this.#storyboardResultError;}
  render(){return this.#nativeStoryboardCompletions();}
  completed(){return this.#storyboardCompletedJobs;}
${methods}
}`);
// Only external ports and already-existing surrounding private methods are
// stubbed. The extracted guard/read/navigation/finally logic remains unchanged.
const construct = new Function("ports", `const {HTMLButtonElement,captureNativeStoryboardHandle,
  captureOutputNavigationFocus,readNativeStoryboardCompletion,nativeStoryboardRetainedRoute,
  documentArtifactRevision,navigateInApp,location,fetch,html,nothing}=ports;
  return ${minimalClass};`);

class Button {
  isConnected=true;
  dataset={nativeStoryboardJob:"job-a"};
}
const copy = value => structuredClone(value);
function fixture(hooks={}) {
  const job={jobId:"job-a",documentId:"document-a",kind:"render_document",status:"completed",
    sourceSurface:"document",productionMode:"manual",documentRevision:4,requestKey:"request-a",requestedAt:"2026-09-01T00:00:00.000Z",
    completedAt:"2026-09-01T00:00:01.000Z",attemptCount:1,result:{artifactKind:"storyboard",artifactId:"artifact-a"}};
  const artifact={id:"artifact-a",kind:"storyboard",documentId:"document-a",sourceEventId:"event-a",contentRef:"content-a",sequence:7};
  const s={job,jobs:[job],artifact,artifacts:[artifact],documentId:"document-a",sourceIdentity:{},
    authorization:{},authActive:true,sourceCurrent:true,eligible:true,readonly:true,contains:true,hidden:false,
    renderedCurrent:true,focusCurrent:true,route:"/document/document-a",document:{visibilityState:"visible"},
    trigger:new Button(),events:{"artifact-a":0},updates:0,focusDisposals:0,reads:[],refreshes:[],
    navigationCalls:0,routes:[],navigationCurrent:true,routeResult:true,routeValid:true,handleValid:true,hooks,
    completion:{selection:{documentId:"document-a",artifactId:"artifact-a",revision:0,contentSha256:"a".repeat(64)},
      expiresAt:"2099-01-01T00:00:00.000Z",job:{documentId:"document-a",jobId:"job-a"}}};
  s.store={captureAuthorizationScope:()=>s.authorization,
    authorizationScopeActive:scope=>scope===s.authorization&&s.authActive,
    route:{get:()=>s.route},documentJobs:{get:()=>s.jobs},projection:{get:()=>({libraryArtifacts:s.artifacts})},
    events:{get:()=>s.events},async refreshEvents(options){s.refreshes.push(options);await s.hooks.afterRefresh?.(s);}};
  const ports={HTMLButtonElement:Button,location:{origin:"http://127.0.0.1:4186"},
    html:(strings,...values)=>({strings:[...strings],values}),nothing:null,
    fetch(){throw new Error("unexpected network port invocation");},
    captureNativeStoryboardHandle:value=>s.handleValid?Object.freeze({...value}):null,
    captureOutputNavigationFocus:()=>({current:()=>s.focusCurrent,dispose:()=>{s.focusDisposals++;}}),
    async readNativeStoryboardCompletion(handle,options){s.reads.push({handle,options});await s.hooks.afterRead?.(s);return s.completion;},
    nativeStoryboardRetainedRoute:()=>s.routeValid?"/make/storyboard?document=document-a&artifact=artifact-a&revision=0&sha256="+"a".repeat(64):null,
    documentArtifactRevision:(events,id)=>events[id]??0,
    async navigateInApp(owner,action){s.navigationCalls++;await s.hooks.beforeNavigate?.(s);return action({
      current:()=>s.navigationCurrent,route:(path,options)=>{s.routes.push({path,options});return s.routeResult;}});},
  };
  s.subject=new (construct(ports))(s);
  return s;
}
function cleaned(s,{pending=null,reads=1}={}) {
  assert.equal(s.subject.pending(),pending);
  assert.equal(s.reads.length,reads);
  if(reads){assert.equal(s.reads[0].options.signal.aborted,true);assert.equal(s.focusDisposals,1);}
}
async function refused(s){assert.equal(await s.subject.open(),false);assert.deepEqual(s.routes,[]);cleaned(s);}

function templates(value) {
  if(Array.isArray(value))return value.flatMap(templates);
  if(value&&Array.isArray(value.strings)&&Array.isArray(value.values))return[value,...value.values.flatMap(templates)];
  return[];
}
function buttons(rendered) {
  return templates(rendered).flatMap(node=>{
    const idIndex=node.strings.findIndex(text=>/data-native-storyboard-job=$/.test(text));
    if(idIndex<0)return[];
    const clickIndex=node.strings.findIndex(text=>/@click=$/.test(text));
    assert.ok(clickIndex>=0);assert.equal(typeof node.values[clickIndex],"function");
    return[{id:node.values[idIndex],click:node.values[clickIndex]}];
  });
}

test("exact completed manual Storyboard refreshes read-only then routes the selected four fields and disposes",async()=>{
  const s=fixture();assert.equal(await s.subject.open(),true);
  assert.deepEqual(s.reads[0].handle,{documentId:"document-a",jobId:"job-a"});
  assert.equal(s.refreshes.length,1);assert.equal(s.refreshes[0].readOnly,true);
  assert.equal(typeof s.refreshes[0].current,"function");
  assert.equal(s.routes.length,1);
  const route=new URL(s.routes[0].path,"http://127.0.0.1:4186");
  assert.equal(route.pathname,"/make/storyboard");
  assert.deepEqual([...route.searchParams],[['document','document-a'],['artifact','artifact-a'],['revision','0'],['sha256','a'.repeat(64)]]);
  assert.deepEqual(s.routes[0].options,{documentFocus:false});cleaned(s);
});

test("actual rendered Storyboard action retains exact immutable completion across feed ACK omission",async()=>{
  const s=fixture(),rows=buttons(s.subject.render()),kept=s.subject.completed().get("job-a");
  assert.equal(Object.isFrozen(kept.job),true);assert.equal(Object.isFrozen(kept.job.result),true);
  assert.deepEqual(rows.map(row=>row.id),["job-a"]);s.jobs=[];
  const held=buttons(s.subject.render());assert.deepEqual(held.map(row=>row.id),["job-a"]);
  held[0].click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.equal(s.routes.length,1);assert.deepEqual(s.reads[0].handle,{documentId:"document-a",jobId:"job-a"});cleaned(s);
});

for(const [stage,name,mutate] of [
  ["afterRead","source replacement",s=>{s.sourceIdentity={};}],
  ["afterRead","authorization withdrawal",s=>{s.authActive=false;}],
  ["afterRefresh","new focus",s=>{s.focusCurrent=false;}],
  ["afterRefresh","different selected artifact",s=>{s.completion.selection.artifactId="artifact-b";}],
  ["beforeNavigate","artifact content reference mutation",s=>{s.artifact.contentRef="content-b";}],
  ["beforeNavigate","newer revision",s=>{s.events["artifact-a"]=1;}],
  ["beforeNavigate","route replacement",s=>{s.route="/activity";}],
])test(`Storyboard ${name} at ${stage} prevents navigation and cleans pending read`,async()=>{await refused(fixture({[stage]:mutate}));});

test("contradictory live Storyboard row retires its held completion and cannot revive after omission",async()=>{
  const s=fixture(),button=buttons(s.subject.render())[0];
  s.jobs=[{...copy(s.job),status:"running"}];assert.deepEqual(buttons(s.subject.render()),[]);
  s.jobs=[];assert.deepEqual(buttons(s.subject.render()),[]);
  button.click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.deepEqual(s.routes,[]);assert.equal(s.subject.completed().get("job-a").retired,true);
  if(s.reads.length)cleaned(s);
});

test("source retirement after ACK omission removes the Storyboard reference",()=>{
  const s=fixture();s.subject.render();s.jobs=[];s.sourceIdentity={};
  assert.deepEqual(buttons(s.subject.render()),[]);assert.equal(s.subject.completed().size,0);
});

for(const [name,mutate] of [
  ["managed request",s=>{s.job.productionMode="managed";}],
  ["workflow source",s=>{s.job.sourceSurface="workflow:x:y";}],
  ["wrong kind",s=>{s.job.result.artifactKind="slides";}],
  ["not completed",s=>{s.job.status="running";}],
])test(`Storyboard ${name} offers no completion and performs no read`,async()=>{
  const s=fixture();mutate(s);assert.deepEqual(buttons(s.subject.render()),[]);
  assert.equal(await s.subject.open(),false);assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);
});

test("Storyboard completion read error retains exact-job feedback and disposes; stale error stays silent",async()=>{
  const s=fixture({afterRead:()=>{throw Error("read failed");}});await refused(s);assert.equal(s.subject.error(),"job-a");
  const stale=fixture({afterRead:s=>{s.sourceCurrent=false;throw Error("stale failure");}});
  await refused(stale);assert.equal(stale.subject.error(),null);
});

test("Storyboard duplicate gesture cannot cancel the original pending completion",async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const s=fixture({afterRead:async()=>{entered();await held;}}),first=s.subject.open();await started;
  assert.equal(await s.subject.open(),false);assert.equal(s.reads.length,1);assert.equal(s.reads[0].options.signal.aborted,false);
  release();assert.equal(await first,true);assert.equal(s.routes.length,1);cleaned(s);
});


test("Storyboard capacity notice survives ACK omission and all held-job retirement without exceeding 120 slots",()=>{
  const s=fixture(),notice="More completed storyboards are available. Open them from this Document’s results.";
  const hasNotice=rendered=>templates(rendered).some(node=>node.strings.join("").includes('<p role="status">')&&node.values.includes(notice));
  const completed=Array.from({length:121},(_,index)=>({...copy(s.job),jobId:`job-${index}`,
    result:{...copy(s.job.result),artifactId:`artifact-${index}`}}));
  s.jobs=completed;
  const full=s.subject.render(),held=[...s.subject.completed().entries()];
  assert.equal(buttons(full).length,120);assert.equal(hasNotice(full),true);
  assert.equal(held.length,120);assert.equal(s.subject.completed().has("job-120"),false);
  assert.ok(held.every(([,entry])=>Object.isFrozen(entry.job)&&Object.isFrozen(entry.job.result)));

  s.jobs=[]; // Ordinary ACK feed omission must not erase the capacity explanation.
  const acknowledged=s.subject.render();
  assert.equal(buttons(acknowledged).length,120);assert.equal(hasNotice(acknowledged),true);
  for(const [id,entry] of held)assert.equal(s.subject.completed().get(id),entry);

  s.jobs=completed.slice(0,120).map(job=>({...copy(job),status:"running"}));
  const retired=s.subject.render();
  assert.deepEqual(buttons(retired),[]);assert.equal(hasNotice(retired),true);
  assert.equal(s.subject.completed().size,120);assert.ok(held.every(([,entry])=>entry.retired===true));
  s.jobs=[];assert.equal(hasNotice(s.subject.render()),true);
  s.jobs=[completed[120]]; // Retired immutable slots cannot be replaced by a new result.
  assert.equal(hasNotice(s.subject.render()),true);assert.equal(s.subject.completed().size,120);
  assert.equal(s.subject.completed().has("job-120"),false);
  for(const [id,entry] of held)assert.equal(s.subject.completed().get(id),entry);
  assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);

  s.jobs=[];s.sourceIdentity={}; // A genuinely new source releases the old capacity.
  assert.equal(s.subject.render(),null);assert.equal(s.subject.completed().size,0);
});

const capacityNotice="More completed storyboards are available. Open them from this Document’s results.";
const hasCapacityNotice=rendered=>templates(rendered).some(node=>node.strings.join("").includes('<p role="status">')&&node.values.includes(capacityNotice));
const capacityJob=(s,index)=>({...copy(s.job),jobId:`job-${index}`,result:{...copy(s.job.result),artifactId:`artifact-${index}`}});

test("exactly 120 observed Storyboard jobs never invent a more-completions notice across omission and retirement",()=>{
  const s=fixture();s.jobs=Array.from({length:120},(_,index)=>capacityJob(s,index));
  const first=s.subject.render();assert.equal(buttons(first).length,120);assert.equal(hasCapacityNotice(first),false);
  s.jobs=[];const acknowledged=s.subject.render();
  assert.equal(buttons(acknowledged).length,120);assert.equal(hasCapacityNotice(acknowledged),false);
  s.jobs=Array.from({length:120},(_,index)=>({...capacityJob(s,index),status:"running"}));
  assert.equal(hasCapacityNotice(s.subject.render()),false);
  s.jobs=[];assert.equal(s.subject.render(),null);assert.equal(s.subject.completed().size,120);
  assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);
});
for(const [name,mutate] of [
  ["Document",s=>{s.documentId="document-b";}],
  ["private eligibility",s=>{s.eligible=false;}],
])test(`observed Storyboard overflow clears after ${name} changes with the feed omitted`,()=>{
  const s=fixture();s.jobs=Array.from({length:121},(_,index)=>capacityJob(s,index));
  assert.equal(hasCapacityNotice(s.subject.render()),true);
  s.jobs=[];mutate(s);assert.equal(s.subject.render(),null);assert.equal(s.subject.completed().size,0);
  assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);
});
