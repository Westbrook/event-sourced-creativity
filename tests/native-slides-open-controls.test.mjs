// Pure asynchronous controls for the actual new UI methods. This imports
// no application, provider, database, browser, or registered historical tests.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const start = source.indexOf("  #nativeSlidesJob(job:DocumentJob){");
const end = source.indexOf("  #sceneCostControls(){", start);
assert.ok(start > 0 && end > start, "exact new-method boundaries exist");
const methods = source.slice(start, end);
assert.equal((methods.match(/async #openOriginalSlides\(/g) ?? []).length, 1);
const minimalClass = stripTypeScriptTypes(`class Subject {
  #slidesResultRead=null; #slidesResultError=null; #activeId=""; #convertingId="";
  #slidesCompletedJobs=new Map(); #slidesOverflow=null;
  constructor(state){this.state=state;this.store=state.store;this.ownerDocument=state.document;
    this.i18n={system:value=>value,date:()=>"Recorded completion"};}
  #nativeStoryEligible(documentId){return this.state.eligible&&documentId===this.state.documentId;}
  #privateSourceCurrent(){const identity=this.state.sourceIdentity;return()=>this.state.sourceCurrent&&this.state.sourceIdentity===identity;}
  #readonlyReuseView(){return this.state.readonly;}
  contains(node){return this.state.contains&&node===this.state.trigger;}
  closest(){return this.state.hidden?{}:null;}
  requestUpdate(){this.state.updates++;}
  open(job=this.state.job,trigger=this.state.trigger){return this.#openOriginalSlides(job,{currentTarget:trigger},()=>this.state.renderedCurrent);}
  eligible(job){return this.#nativeSlidesJob(job);}
  identity(job){return this.#nativeSlidesJobIdentity(job);}
  active(value){this.#activeId=value;}
  converting(value){this.#convertingId=value;}
  pending(){return this.#slidesResultRead;}
  replacePending(value){this.#slidesResultRead=value;}
  error(){return this.#slidesResultError;}
  render(){return this.#nativeSlidesCompletions();}
  completed(){return this.#slidesCompletedJobs;}
${methods}
}`);
// Only external ports and already-existing surrounding private methods are
// stubbed. The extracted guard/read/navigation/finally logic remains unchanged.
const construct = new Function("ports", `const {HTMLButtonElement,captureNativeSlidesHandle,
  captureOutputNavigationFocus,readNativeSlidesCompletion,nativeSlidesRetainedRoute,
  documentArtifactRevision,navigateInApp,location,fetch,html,nothing}=ports;
  return ${minimalClass};`);

class Button {
  isConnected=true;
  dataset={nativeSlidesJob:"job-a"};
}
const copy = value => structuredClone(value);
function fixture(hooks={}) {
  const job={jobId:"job-a",documentId:"document-a",kind:"render_document",status:"completed",
    sourceSurface:"document",productionMode:"manual",documentRevision:4,requestKey:"request-a",requestedAt:"2026-09-01T00:00:00.000Z",
    completedAt:"2026-09-01T00:00:01.000Z",attemptCount:1,result:{artifactKind:"slides",artifactId:"artifact-a"}};
  const artifact={id:"artifact-a",kind:"slides",documentId:"document-a",sourceEventId:"event-a",contentRef:"content-a",sequence:7};
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
    captureNativeSlidesHandle:value=>s.handleValid?Object.freeze({...value}):null,
    captureOutputNavigationFocus:()=>({current:()=>s.focusCurrent,dispose:()=>{s.focusDisposals++;}}),
    async readNativeSlidesCompletion(handle,options){s.reads.push({handle,options});await s.hooks.afterRead?.(s);return s.completion;},
    nativeSlidesRetainedRoute:()=>s.routeValid?"/make/slides?exact=artifact-a":null,
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

test("exact completed Slides job reads, refreshes read-only, and routes once with disposal",async()=>{
  const s=fixture();assert.equal(await s.subject.open(),true);
  assert.deepEqual(s.reads[0].handle,{documentId:"document-a",jobId:"job-a"});
  assert.equal(s.reads[0].options.origin,"http://127.0.0.1:4186");
  assert.equal(s.refreshes.length,1);assert.equal(s.refreshes[0].readOnly,true);
  assert.equal(typeof s.refreshes[0].current,"function");
  assert.deepEqual(s.routes,[{path:"/make/slides?exact=artifact-a",options:{documentFocus:false}}]);
  assert.equal(s.subject.error(),null);cleaned(s);
});

const stale=[
  ["authorization withdrawn",s=>{s.authActive=false;}],
  ["authorization replaced",s=>{s.authorization={};}],
  ["source withdrawn",s=>{s.sourceCurrent=false;}],
  ["source replaced",s=>{s.sourceIdentity={};}],
  ["rendered source withdrawn",s=>{s.renderedCurrent=false;}],
  ["focus withdrawn",s=>{s.focusCurrent=false;}],
  ["route changed",s=>{s.route="/document/document-b";}],
  ["Document changed",s=>{s.documentId="document-b";}],
  ["Store replaced",s=>{s.subject.store={};}],
  ["page hidden",s=>{s.document.visibilityState="hidden";}],
  ["owner hidden",s=>{s.hidden=true;}],
  ["trigger detached",s=>{s.trigger.isConnected=false;}],
  ["trigger owner lost",s=>{s.contains=false;}],
  ["trigger job rebound",s=>{s.trigger.dataset.nativeSlidesJob="job-b";}],
  ["job removed",s=>{s.jobs=[];}],
  ["job result changed",s=>{s.job.result.artifactId="artifact-b";}],
  ["job request changed",s=>{s.job.requestedAt="2026-09-02T00:00:00.000Z";}],
  ["job request key changed",s=>{s.job.requestKey="request-b";}],
  ["job attempt changed",s=>{s.job.attemptCount++;}],
  ["job no longer completed",s=>{s.job.status="running";}],
  ["eligibility withdrawn",s=>{s.eligible=false;}],
  ["current work opened",s=>{s.readonly=false;}],
  ["viewer opened",s=>{s.subject.active("artifact-a");}],
  ["conversion opened",s=>{s.subject.converting("artifact-a");}],
  ["read aborted",s=>{s.subject.pending().abort.abort();}],
];
for(const stage of ["afterRead","afterRefresh","beforeNavigate"]){
  for(const [name,mutate] of stale){
    test(`${name} at ${stage} refuses stale navigation`,async()=>{
      await refused(fixture({[stage]:mutate}));
    });
  }
}

test("an equivalent current job replacement retains the exact gesture",async()=>{
  const s=fixture({afterRead:s=>{s.jobs=[copy(s.job)];}});
  assert.equal(await s.subject.open(),true);assert.equal(s.routes.length,1);cleaned(s);
});
test("an equivalent artifact replacement preserves the exact source tuple",async()=>{
  const s=fixture({beforeNavigate:s=>{s.artifacts=[copy(s.artifact)];}});
  assert.equal(await s.subject.open(),true);assert.equal(s.routes.length,1);cleaned(s);
});

for(const [name,mutate] of [
  ["wrong selected Document",s=>{s.completion.selection.documentId="document-b";}],
  ["wrong selected artifact despite another valid Slides projection",s=>{
    s.completion.selection.artifactId="artifact-b";s.artifacts.push({...s.artifact,id:"artifact-b"});}],
  ["missing selected artifact",s=>{s.artifacts=[];}],
  ["wrong artifact kind",s=>{s.artifact.kind="scene";}],
  ["wrong artifact Document",s=>{s.artifact.documentId="document-b";}],
  ["wrong revision",s=>{s.events["artifact-a"]=1;}],
  ["expired completion",s=>{s.completion.expiresAt="2000-01-01T00:00:00.000Z";}],
  ["invalid completion expiry",s=>{s.completion.expiresAt="not-a-date";}],
  ["invalid retained route",s=>{s.routeValid=false;}],
])test(`${name} rejects after completion read`,async()=>{await refused(fixture({afterRead:mutate}));});

for(const field of ["id","sourceEventId","contentRef","sequence"]){
  test(`in-place artifact ${field} mutation during navigation cannot renew its snapshot`,async()=>{
    const s=fixture({beforeNavigate:s=>{s.artifact[field]=field==="sequence"?8:"changed";}});
    await refused(s);
  });
}
test("stale original job object cannot substitute a different completion after live-row replacement",async()=>{
  const s=fixture({afterRead:s=>{
    s.jobs=[copy(s.job)];s.job.result.artifactId="artifact-b";
    s.completion.selection.artifactId="artifact-b";s.artifacts.push({...s.artifact,id:"artifact-b"});
  }});await refused(s);
});
test("revision changing during navigation is refused",async()=>{await refused(fixture({beforeNavigate:s=>{s.events["artifact-a"]=1;}}));});
test("completion expiry changing during navigation is refused",async()=>{await refused(fixture({beforeNavigate:s=>{s.completion.expiresAt="2000-01-01T00:00:00.000Z";}}));});
test("Shell current-work/navigation admission refusal does not route",async()=>{await refused(fixture({beforeNavigate:s=>{s.navigationCurrent=false;}}));});
test("route refusal is returned without a retry",async()=>{
  const s=fixture();s.routeResult=false;assert.equal(await s.subject.open(),false);
  assert.equal(s.navigationCalls,1);assert.equal(s.routes.length,1);cleaned(s);
});

for(const stage of ["afterRead","afterRefresh","beforeNavigate"]){
  test(`${stage} exception preserves cleanup and exact-job feedback`,async()=>{
    const s=fixture({[stage]:()=>{throw new Error("port failure");}});
    await refused(s);assert.equal(s.subject.error(),"job-a");
  });
  test(`${stage} stale exception does not publish feedback into a changed owner`,async()=>{
    const s=fixture({[stage]:s=>{s.sourceCurrent=false;throw new Error("stale port failure");}});
    await refused(s);assert.equal(s.subject.error(),null);
  });
}
test("an already pending read refuses a duplicate gesture without cancelling its owner",async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  const s=fixture({afterRead:async()=>{entered();await held;}}),first=s.subject.open();
  await started;assert.equal(await s.subject.open(),false);assert.equal(s.reads.length,1);
  assert.equal(s.reads[0].options.signal.aborted,false);release();
  assert.equal(await first,true);assert.equal(s.routes.length,1);cleaned(s);
});
test("old finally cannot clear a newer pending owner",async()=>{
  const newer={jobId:"job-b",abort:new AbortController()};
  const s=fixture({afterRead:s=>{s.subject.replacePending(newer);}});
  assert.equal(await s.subject.open(),false);assert.deepEqual(s.routes,[]);
  cleaned(s,{pending:newer});assert.equal(newer.abort.signal.aborted,false);
});

for(const [name,mutate] of [
  ["not a native button",s=>{s.trigger={isConnected:true,dataset:{nativeSlidesJob:"job-a"}};}],
  ["wrong owner",s=>{s.contains=false;}],
  ["stale rendered row",s=>{s.renderedCurrent=false;}],
  ["ineligible private owner",s=>{s.eligible=false;}],
  ["different Document",s=>{s.job.documentId="document-b";}],
  ["wrong job kind",s=>{s.job.kind="other";}],
  ["not completed",s=>{s.job.status="queued";}],
  ["workflow source",s=>{s.job.sourceSurface="workflow:x:y";}],
  ["managed mode",s=>{s.job.productionMode="managed";}],
  ["different output kind",s=>{s.job.result.artifactKind="scene";}],
  ["current work",s=>{s.readonly=false;}],
  ["active viewer",s=>{s.subject.active("artifact-a");}],
  ["conversion",s=>{s.subject.converting("artifact-a");}],
  ["invalid capture handle",s=>{s.handleValid=false;}],
])test(`entry refuses ${name} before any read`,async()=>{
  const s=fixture();mutate(s);assert.equal(await s.subject.open(),false);
  assert.equal(s.reads.length,0);assert.equal(s.refreshes.length,0);assert.equal(s.navigationCalls,0);
  assert.equal(s.focusDisposals,0);assert.equal(s.subject.pending(),null);
});

// Actual completion-render logic with a data-only Lit template port. Inspect its
// real bound job/action values; do not recreate the row or its admission logic.
function templates(value) {
  if(Array.isArray(value))return value.flatMap(templates);
  if(value&&Array.isArray(value.strings)&&Array.isArray(value.values))return[value,...value.values.flatMap(templates)];
  return[];
}
function buttons(rendered) {
  return templates(rendered).flatMap(node=>{
    const idIndex=node.strings.findIndex(text=>/data-native-slides-job=$/.test(text));
    if(idIndex<0)return[];
    const clickIndex=node.strings.findIndex(text=>/@click=$/.test(text));
    assert.ok(clickIndex>=0);assert.equal(typeof node.values[clickIndex],"function");
    return[{id:node.values[idIndex],click:node.values[clickIndex]}];
  });
}
function hasCapacityNotice(rendered) {
  return templates(rendered).some(node=>node.values.includes("More completed slides are available. Open them from this Document’s results."));
}
function jobAt(s,index) {
  return {...copy(s.job),jobId:`job-${index}`,result:{artifactKind:"slides",artifactId:`artifact-${index}`}};
}
test("actual rendering captures immutable job and result without changing the feed",()=>{
  const s=fixture(),before=copy(s.jobs),rows=buttons(s.subject.render()),kept=s.subject.completed().get("job-a");
  assert.deepEqual(rows.map(row=>row.id),["job-a"]);assert.deepEqual(s.jobs,before);
  assert.notEqual(kept.job,s.job);assert.notEqual(kept.job.result,s.job.result);
  assert.equal(Object.isFrozen(kept.job),true);assert.equal(Object.isFrozen(kept.job.result),true);
  assert.equal(kept.current(),true);
});
test("actual rendered action opens the same reference after the ACK omission shape",async()=>{
  const s=fixture();s.subject.render();const kept=s.subject.completed().get("job-a");
  s.jobs=[];const rows=buttons(s.subject.render());
  assert.deepEqual(rows.map(row=>row.id),["job-a"]);assert.equal(s.subject.completed().get("job-a"),kept);
  rows[0].click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.deepEqual(s.reads[0].handle,{documentId:"document-a",jobId:"job-a"});
  assert.equal(s.routes.length,1);cleaned(s);
});
for(const stage of ["afterRead","afterRefresh","beforeNavigate"]){
  test(`ACK omission at ${stage} retains the original gesture`,async()=>{
    const s=fixture({[stage]:s=>{s.jobs=[];s.subject.render();}});s.subject.render();
    assert.equal(await s.subject.open(),true);assert.equal(s.routes.length,1);cleaned(s);
  });
  test(`contradictory same-id live row at ${stage} cannot borrow a retained reference`,async()=>{
    const s=fixture({[stage]:s=>{s.jobs=[{...copy(s.job),status:"running"}];}});s.subject.render();
    await refused(s);
  });
  test(`source retirement after ACK omission at ${stage} removes reference and refuses`,async()=>{
    const s=fixture({[stage]:s=>{s.jobs=[];s.sourceIdentity={};s.subject.render();}});s.subject.render();
    await refused(s);assert.equal(s.subject.completed().size,0);
  });
}
for(const [name,mutate] of [
  ["source lifetime",s=>{s.sourceIdentity={};}],
  ["Document",s=>{s.documentId="document-b";}],
  ["private eligibility",s=>{s.eligible=false;}],
])test(`ACK-omitted reference disappears after ${name} changes`,()=>{
  const s=fixture();s.subject.render();s.jobs=[];mutate(s);
  assert.deepEqual(buttons(s.subject.render()),[]);assert.equal(s.subject.completed().size,0);
});
test("equivalent live-row replacement preserves the original immutable reference",()=>{
  const s=fixture();s.subject.render();const kept=s.subject.completed().get("job-a");
  s.jobs=[copy(s.job)];s.subject.render();assert.equal(s.subject.completed().get("job-a"),kept);
});
test("contradictory completed result cannot quietly replace the held reference across renders",()=>{
  const s=fixture();s.subject.render();const original=s.subject.completed().get("job-a").job;
  s.jobs=[{...copy(s.job),result:{artifactKind:"slides",artifactId:"artifact-b"}}];
  assert.deepEqual(buttons(s.subject.render()),[]);assert.deepEqual(buttons(s.subject.render()),[]);
  assert.equal(s.subject.completed().get("job-a").retired,true);
  assert.equal(s.subject.completed().get("job-a").job,original);
  s.jobs=[];assert.deepEqual(buttons(s.subject.render()),[]);
});
test("a retained reference retired by contradiction cannot revive after live-row omission",async()=>{
  const s=fixture();const oldButton=buttons(s.subject.render())[0];
  s.jobs=[{...copy(s.job),status:"running"}];s.subject.render();s.jobs=[];s.subject.render();
  oldButton.click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.deepEqual(s.routes,[]);assert.equal(s.subject.completed().get("job-a").retired,true);
  if(s.reads.length)cleaned(s);
});
test("120-reference cap preserves ACK-omitted references and advertises overflow without eviction",()=>{
  const s=fixture();s.jobs=Array.from({length:121},(_,i)=>jobAt(s,i));
  const first=s.subject.render(),original=[...s.subject.completed().entries()];
  assert.equal(original.length,120);assert.equal(buttons(first).length,120);assert.equal(hasCapacityNotice(first),true);
  assert.equal(s.subject.completed().has("job-120"),false);
  s.jobs=[jobAt(s,121)];const next=s.subject.render();
  assert.deepEqual([...s.subject.completed().entries()],original);assert.equal(buttons(next).length,120);
  assert.equal(hasCapacityNotice(next),true);assert.equal(s.subject.completed().has("job-121"),false);
});
test("observed overflow survives ACK omission, all-slot retirement and another empty feed until source changes",()=>{
  const s=fixture();s.jobs=Array.from({length:121},(_,i)=>jobAt(s,i));
  const first=s.subject.render(),original=[...s.subject.completed().entries()];
  assert.equal(original.length,120);assert.equal(buttons(first).length,120);assert.equal(hasCapacityNotice(first),true);
  assert.equal(s.subject.completed().has("job-120"),false);
  s.jobs=[];const acknowledged=s.subject.render();
  assert.equal(buttons(acknowledged).length,120);assert.equal(hasCapacityNotice(acknowledged),true);
  assert.deepEqual([...s.subject.completed().entries()],original);
  s.jobs=Array.from({length:120},(_,i)=>({...jobAt(s,i),status:"running"}));
  const retired=s.subject.render();
  assert.equal(s.subject.completed().size,120);
  assert.equal([...s.subject.completed().values()].every(value=>value.retired),true);
  assert.deepEqual(buttons(retired),[]);assert.equal(hasCapacityNotice(retired),true);
  s.jobs=[];const omitted=s.subject.render();
  assert.deepEqual(buttons(omitted),[]);assert.equal(hasCapacityNotice(omitted),true);
  assert.equal(s.subject.completed().size,120);assert.equal(s.subject.completed().has("job-120"),false);
  s.sourceIdentity={};const changed=s.subject.render();
  assert.equal(changed,null);assert.equal(hasCapacityNotice(changed),false);assert.equal(s.subject.completed().size,0);
});
test("exactly 120 observed jobs never invent a more-completions notice across omission and retirement",()=>{
  const s=fixture();s.jobs=Array.from({length:120},(_,i)=>jobAt(s,i));
  const first=s.subject.render();assert.equal(buttons(first).length,120);assert.equal(hasCapacityNotice(first),false);
  s.jobs=[];const acknowledged=s.subject.render();
  assert.equal(buttons(acknowledged).length,120);assert.equal(hasCapacityNotice(acknowledged),false);
  s.jobs=Array.from({length:120},(_,i)=>({...jobAt(s,i),status:"running"}));
  assert.equal(hasCapacityNotice(s.subject.render()),false);
  s.jobs=[];assert.equal(s.subject.render(),null);assert.equal(s.subject.completed().size,120);
});
for(const [name,mutate] of [
  ["Document",s=>{s.documentId="document-b";}],
  ["private eligibility",s=>{s.eligible=false;}],
])test(`observed overflow clears after ${name} changes with the feed omitted`,()=>{
  const s=fixture();s.jobs=Array.from({length:121},(_,i)=>jobAt(s,i));assert.equal(hasCapacityNotice(s.subject.render()),true);
  s.jobs=[];mutate(s);const next=s.subject.render();
  assert.equal(next,null);assert.equal(s.subject.completed().size,0);
});
test("source retirement releases bounded retention for a new source",()=>{
  const s=fixture();s.jobs=Array.from({length:120},(_,i)=>jobAt(s,i));s.subject.render();
  s.sourceIdentity={};s.jobs=[jobAt(s,121)];const next=s.subject.render();
  assert.deepEqual(buttons(next).map(row=>row.id),["job-121"]);assert.equal(s.subject.completed().size,1);
  assert.equal(hasCapacityNotice(next),false);
});
