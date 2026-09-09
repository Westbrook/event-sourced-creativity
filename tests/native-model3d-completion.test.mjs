import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import {
  captureNativeModel3dHandle, nativeModel3dCompletionPath, parseNativeModel3dCompletionUrl,
  validateNativeModel3dCompletion, nativeModel3dRetainedRoute, NATIVE_MODEL3D_COMPLETION_MAX_BYTES,
} from "../src/model/native-model3d-completion.ts";
import { validateNativeVideoCompletion, nativeVideoRetainedRoute } from "../src/model/native-video-completion.ts";
import { validateNativeAudioCompletion, nativeAudioRetainedRoute } from "../src/model/native-audio-completion.ts";
import { validateNativeSceneCompletion, nativeSceneRetainedRoute } from "../src/model/native-scene-completion.ts";
import { validateNativeSlidesCompletion, nativeSlidesRetainedRoute } from "../src/model/native-slides-completion.ts";
import { validateNativeStoryCompletion } from "../src/model/native-short-story-generation.ts";
import { parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";
import { nativeOutputCompletionPath, parseNativeOutputCompletionUrl, validateNativeOutputCompletion } from "../src/model/native-output-completion.ts";
import { readNativeModel3dCompletion } from "../src/model/retained-short-story-client.ts";

// Pure selection and constructed-response transport controls; no job admission,
// Worker, live database, network, browser, authorization or provider proof.
const origin = "https://forma.test", now = Date.parse("2030-01-01T00:00:00.000Z");
const handle = () => ({ documentId: "document:model3d.1", jobId: "job:model3d_2-1" });
const completion = () => ({ schemaVersion: 1, kind: "native-model3d-completion", handle: handle(),
  selection: { documentId: handle().documentId, artifactId: "artifact:model3d.1", revision: 0, contentSha256: "a1".repeat(32) },
  expiresAt: "2099-01-01T00:00:00.000Z" });
const controls = (request, overrides = {}) => ({ origin, request, signal: new AbortController().signal, current: () => true, ...overrides });
const response = (body = JSON.stringify(completion()), options = {}) => {
  const result = new Response(body, { status: options.status ?? 200, headers: options.headers ?? { "content-type": "application/json" } });
  Object.defineProperty(result, "url", { value: options.url ?? origin + nativeModel3dCompletionPath(handle()) });
  return result;
};

test("Model3d original job resolves only its exact immutable revision-zero selection and native reader route", () => {
  const receipt = validateNativeModel3dCompletion(completion(), handle(), now);
  assert.deepEqual(receipt, completion());
  for (const row of [receipt, receipt.handle, receipt.selection]) assert.ok(Object.isFrozen(row));
  assert.equal(NATIVE_MODEL3D_COMPLETION_MAX_BYTES, 8192);
  assert.equal(nativeModel3dCompletionPath(handle()), "/api/retained-output/model3d/jobs/document%3Amodel3d.1/job%3Amodel3d_2-1");
  assert.deepEqual(parseNativeModel3dCompletionUrl(origin + nativeModel3dCompletionPath(handle())), handle());
  assert.deepEqual(parseNativeRetainedOutputRoute(nativeModel3dRetainedRoute(receipt, handle())), { output: "model3d", selection: receipt.selection });
});

test("Model3d completion cannot cross into Video, Audio, Scene, Slides, Story, arbitrary output, or a later job", () => {
  const value = completion();
  assert.equal(validateNativeVideoCompletion(value, handle(), now), null);
  assert.equal(nativeVideoRetainedRoute(value, handle()), null);
  assert.equal(validateNativeAudioCompletion(value, handle(), now), null);
  assert.equal(nativeAudioRetainedRoute(value, handle()), null);
  assert.equal(validateNativeSceneCompletion(value, handle(), now), null);
  assert.equal(validateNativeStoryCompletion(value, handle(), now), null);
  assert.equal(validateNativeSlidesCompletion(value, handle(), now), null);
  assert.equal(nativeSlidesRetainedRoute(value, handle()), null);
  assert.equal(nativeSceneRetainedRoute(value, handle()), null);
  for (const kind of ["native-video-completion", "native-audio-completion", "native-scene-completion", "native-slides-completion", "native-short-story-completion", "native-model3d-result"]) {
    assert.equal(validateNativeModel3dCompletion({ ...value, kind }, handle(), now), null);
  }
  assert.equal(validateNativeModel3dCompletion(value, { ...handle(), jobId: "newer-job" }, now), null);
  for (const output of ["short_story", "../model3d", "model3d/jobs", "Model3d", null]) {
    assert.throws(() => nativeOutputCompletionPath(output, handle()), TypeError);
    assert.equal(parseNativeOutputCompletionUrl(output, origin + nativeModel3dCompletionPath(handle())), null);
    assert.equal(validateNativeOutputCompletion(output, value, handle(), now), null);
  }
});

test("Model3d handles and canonical paths reject borrowed identity and URL aliases", () => {
  for (const value of [null, {}, [], Object.create(handle()), { ...handle(), artifactId: "borrowed" },
    { ...handle(), jobId: "../model3d" }, { ...handle(), documentId: "x".repeat(161) }]) {
    assert.equal(captureNativeModel3dHandle(value), null);
  }
  const url = origin + nativeModel3dCompletionPath(handle());
  for (const candidate of [url + "?", url + "#", url + "/", url + "?job=x", " " + url,
    url.replace("model3d/jobs", "scene/jobs"), url.replace("%3A", "%3a"), url.replace("document", "%64ocument"),
    url.replace(origin, "https://user@forma.test"), url.replace("/jobs/", "/jobs/discard/../")]) {
    assert.equal(parseNativeModel3dCompletionUrl(candidate), null, candidate);
  }
});

test("Model3d rejects changed Document, artifact, revision, SHA, expiry and unrequested fields", () => {
  const mutations = [
    x => { x.handle.documentId = "foreign"; }, x => { x.handle.jobId = "foreign"; },
    x => { x.selection.documentId = "foreign"; }, x => { x.selection.artifactId = "../foreign"; },
    x => { x.selection.revision = 1; }, x => { x.selection.revision = "0"; },
    x => { x.selection.contentSha256 = "A".repeat(64); }, x => { x.selection.contentSha256 = "a".repeat(63); },
    x => { x.expiresAt = "2000-01-01T00:00:00.000Z"; }, x => { x.expiresAt = "2099-01-01T00:00:00Z"; },
    x => { x.content = "x".repeat(8193); }, x => { x.selection.kind = "model3d"; }, x => { x.handle.status = "completed"; },
  ];
  for (const change of mutations) {
    const value = completion(); change(value);
    assert.equal(validateNativeModel3dCompletion(value, handle(), now), null);
    assert.equal(nativeModel3dRetainedRoute(value, handle()), null);
  }
  for (const instant of [NaN, Infinity, Date.parse(completion().expiresAt)]) assert.equal(validateNativeModel3dCompletion(completion(), handle(), instant), null);
});

test("Model3d receipt validation does not execute getters or accept inherited, hidden or symbol data", () => {
  let calls = 0;
  for (const layer of ["root", "handle", "selection"]) {
    for (const fault of ["getter", "symbol", "hidden", "prototype"]) {
      const value = completion(), row = layer === "root" ? value : value[layer];
      const key = layer === "root" ? "expiresAt" : layer === "handle" ? "jobId" : "artifactId";
      if (fault === "getter") Object.defineProperty(row, key, { enumerable: true, get() { calls++; return "borrowed"; } });
      if (fault === "symbol") row[Symbol("foreign")] = true;
      if (fault === "hidden") Object.defineProperty(row, key, { value: row[key], enumerable: false });
      if (fault === "prototype") Object.setPrototypeOf(row, { foreign: true });
      assert.equal(validateNativeModel3dCompletion(value, handle(), now), null, layer + fault);
    }
  }
  assert.equal(calls, 0);
});

test("Model3d client captures original identity before its single bounded same-origin GET", async () => {
  const requested = handle(), calls = [], settings = controls(async (...args) => {
    calls.push(args); requested.jobId = "a-newer-job"; return response();
  });
  const value = await readNativeModel3dCompletion(requested, settings);
  assert.deepEqual(value, completion());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [nativeModel3dCompletionPath(handle()), { method: "GET", credentials: "same-origin", cache: "no-store",
    redirect: "error", headers: { accept: "application/json" }, signal: settings.signal }]);
});

test("Model3d client refuses malformed handles before any request and stale owners after headers", async () => {
  let calls = 0;
  await assert.rejects(readNativeModel3dCompletion({ ...handle(), extra: true }, controls(async () => { calls++; return response(); })), /invalid_native_model3d_handle/);
  assert.equal(calls, 0);
  let current = true, cancellations = 0;
  const body = new ReadableStream({ cancel() { cancellations++; } });
  await assert.rejects(readNativeModel3dCompletion(handle(), controls(async () => { calls++; current = false; return response(body); }, { current: () => current })), /retained_story_withdrawn/);
  assert.equal(calls, 1); assert.equal(cancellations, 1);
});

for (const status of [401, 403, 404, 409, 500]) test(`Model3d completion ${status} remains unavailable without retry`, async () => {
  let calls = 0;
  await assert.rejects(readNativeModel3dCompletion(handle(), controls(async () => { calls++; return response("unavailable", { status }); })), /retained_story_unavailable/);
  assert.equal(calls, 1);
});

test("Model3d client enforces decoded byte cap, cancels overflow, and releases the reader", async () => {
  let cancellations = 0, pulls = 0;
  const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(8193)); }, cancel() { cancellations++; } }, { highWaterMark: 0 });
  const reply = response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" } });
  await assert.rejects(readNativeModel3dCompletion(handle(), controls(async () => reply)), /retained_story_unavailable/);
  assert.equal(pulls, 1); assert.equal(cancellations, 1); assert.equal(body.locked, false);
});

test("Model3d client rejects another output or exact response URL even when Document/job match", async () => {
  for (const reply of [response(JSON.stringify({ ...completion(), kind: "native-scene-completion" })),
    response(undefined, { url: origin + nativeModel3dCompletionPath(handle()) + "?extra=1" }),
    response(undefined, { url: "https://foreign.test" + nativeModel3dCompletionPath(handle()) })]) {
    await assert.rejects(readNativeModel3dCompletion(handle(), controls(async () => reply)), /retained_story_unavailable/);
  }
});

// Actual UI method extraction reuses the existing Audio supplier. It exercises
// ownership, omission and navigation ports; it is not browser-focus evidence.
const source = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const start = source.indexOf("  #nativeModel3dJob(job:DocumentJob){");
const end = source.indexOf("  #nativeStoryEligible(documentId:string){", start);
assert.ok(start > 0 && end > start, "exact new-method boundaries exist");
const methods = source.slice(start, end);
assert.equal((methods.match(/async #openOriginalModel3d\(/g) ?? []).length, 1);
const minimalClass = stripTypeScriptTypes(`class Subject {
  #model3dResultRead=null; #model3dResultError=null; #activeId=""; #convertingId="";
  #model3dCompletedJobs=new Map(); #model3dOverflow=null;
  constructor(state){this.state=state;this.store=state.store;this.ownerDocument=state.document;
    this.i18n={system:value=>value,date:()=>"Recorded completion"};}
  #nativeStoryEligible(documentId){return this.state.eligible&&documentId===this.state.documentId;}
  #privateSourceCurrent(){const identity=this.state.sourceIdentity;return()=>this.state.sourceCurrent&&this.state.sourceIdentity===identity;}
  #readonlyReuseView(){return this.state.readonly;}
  contains(node){return this.state.contains&&node===this.state.trigger;}
  closest(){return this.state.hidden?{}:null;}
  requestUpdate(){this.state.updates++;}
  open(job=this.state.job,trigger=this.state.trigger){return this.#openOriginalModel3d(job,{currentTarget:trigger},()=>this.state.renderedCurrent);}
  eligible(job){return this.#nativeModel3dJob(job);}
  identity(job){return this.#nativeModel3dJobIdentity(job);}
  active(value){this.#activeId=value;}
  converting(value){this.#convertingId=value;}
  pending(){return this.#model3dResultRead;}
  replacePending(value){this.#model3dResultRead=value;}
  error(){return this.#model3dResultError;}
  render(){return this.#nativeModel3dCompletions();}
  completed(){return this.#model3dCompletedJobs;}
${methods}
}`);
// Only external ports and already-existing surrounding private methods are
// stubbed. The extracted guard/read/navigation/finally logic remains unchanged.
const construct = new Function("ports", `const {HTMLButtonElement,captureNativeModel3dHandle,
  captureOutputNavigationFocus,readNativeModel3dCompletion,nativeModel3dRetainedRoute,
  documentArtifactRevision,navigateInApp,location,fetch,html,nothing}=ports;
  return ${minimalClass};`);

class Button {
  isConnected=true;
  dataset={nativeModel3dJob:"job-a"};
}
const copy = value => structuredClone(value);
function fixture(hooks={}) {
  const job={jobId:"job-a",documentId:"document-a",kind:"render_document",status:"completed",
    sourceSurface:"document",productionMode:"manual",documentRevision:4,requestKey:"request-a",requestedAt:"2026-09-01T00:00:00.000Z",
    completedAt:"2026-09-01T00:00:01.000Z",attemptCount:1,result:{artifactKind:"model3d",artifactId:"artifact-a"}};
  const artifact={id:"artifact-a",kind:"model3d",documentId:"document-a",sourceEventId:"event-a",contentRef:"content-a",sequence:7,
    inputRef:"input-a",mediaUrl:"/api/media/owned-a.glb",mediaType:"model/gltf-binary",itemCount:0,items:[],
    settings:{model3d_files:[{url:"/api/media/owned-a.glb",mimeType:"model/gltf-binary",fileName:"model.glb",
      fileSize:1024,format:"glb",role:"mesh",sha256:"b".repeat(64),previewSupported:true},
      {url:"/api/media/owned-preview.png",mimeType:"image/png",fileName:"preview.png",fileSize:64,
        format:null,role:"preview",sha256:"d".repeat(64)}]}};
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
    captureNativeModel3dHandle:value=>s.handleValid?Object.freeze({...value}):null,
    captureOutputNavigationFocus:()=>({current:()=>s.focusCurrent,dispose:()=>{s.focusDisposals++;}}),
    async readNativeModel3dCompletion(handle,options){s.reads.push({handle,options});await s.hooks.afterRead?.(s);return s.completion;},
    nativeModel3dRetainedRoute:()=>s.routeValid?"/make/model3d?document=document-a&artifact=artifact-a&revision=0&sha256="+"a".repeat(64):null,
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
    const idIndex=node.strings.findIndex(text=>/data-native-model3d-job=$/.test(text));
    if(idIndex<0)return[];
    const clickIndex=node.strings.findIndex(text=>/@click=$/.test(text));
    assert.ok(clickIndex>=0);assert.equal(typeof node.values[clickIndex],"function");
    return[{id:node.values[idIndex],click:node.values[clickIndex]}];
  });
}

test("exact completed manual Model3d refreshes read-only then routes the selected four fields and disposes",async()=>{
  const s=fixture();assert.equal(await s.subject.open(),true);
  assert.deepEqual(s.reads[0].handle,{documentId:"document-a",jobId:"job-a"});
  assert.equal(s.refreshes.length,1);assert.equal(s.refreshes[0].readOnly,true);
  assert.equal(typeof s.refreshes[0].current,"function");
  assert.equal(s.routes.length,1);
  const route=new URL(s.routes[0].path,"http://127.0.0.1:4186");
  assert.equal(route.pathname,"/make/model3d");
  assert.deepEqual([...route.searchParams],[['document','document-a'],['artifact','artifact-a'],['revision','0'],['sha256','a'.repeat(64)]]);
  assert.deepEqual(s.routes[0].options,{documentFocus:false});cleaned(s);
});

test("actual rendered Model3d action retains exact immutable completion across feed ACK omission",async()=>{
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
  ["afterRead","actor scope replacement",s=>{s.authorization={};}],
  ["afterRefresh","new focus",s=>{s.focusCurrent=false;}],
  ["afterRefresh","different selected Document",s=>{s.completion.selection.documentId="document-b";}],
  ["afterRefresh","different selected artifact",s=>{s.completion.selection.artifactId="artifact-b";}],
  ["beforeNavigate","completion source event mutation",s=>{s.artifact.sourceEventId="event-b";}],
  ["beforeNavigate","completion sequence mutation",s=>{s.artifact.sequence++;}],
  ["beforeNavigate","artifact content reference mutation",s=>{s.artifact.contentRef="content-b";}],
  ["beforeNavigate","original input reference mutation",s=>{s.artifact.inputRef="input-b";}],
  ["beforeNavigate","root media URL mutation",s=>{s.artifact.mediaUrl="/api/media/other.glb";}],
  ["beforeNavigate","root media MIME mutation",s=>{s.artifact.mediaType="image/png";}],
  ["beforeNavigate","file URL mutation",s=>{s.artifact.settings.model3d_files[0].url="/api/media/other.glb";}],
  ["beforeNavigate","file SHA mutation",s=>{s.artifact.settings.model3d_files[0].sha256="c".repeat(64);}],
  ["beforeNavigate","file size mutation",s=>{s.artifact.settings.model3d_files[0].fileSize++;}],
  ["beforeNavigate","file MIME mutation",s=>{s.artifact.settings.model3d_files[0].mimeType="image/png";}],
  ["beforeNavigate","file role mutation",s=>{s.artifact.settings.model3d_files[0].role="texture";}],
  ["beforeNavigate","file format mutation",s=>{s.artifact.settings.model3d_files[0].format="obj";}],
  ["beforeNavigate","file preview eligibility mutation",s=>{s.artifact.settings.model3d_files[0].previewSupported=false;}],
  ["beforeNavigate","file removal",s=>{s.artifact.settings.model3d_files=[];}],
  ["beforeNavigate","completed count mutation",s=>{s.artifact.itemCount=1;}],
  ["beforeNavigate","file order mutation",s=>{s.artifact.settings.model3d_files.reverse();}],
  ["beforeNavigate","expiry",s=>{s.completion.expiresAt="2000-01-01T00:00:00.000Z";}],
  ["beforeNavigate","newer revision",s=>{s.events["artifact-a"]=1;}],
  ["beforeNavigate","route replacement",s=>{s.route="/activity";}],
])test(`Model3d ${name} at ${stage} prevents navigation and cleans pending read`,async()=>{await refused(fixture({[stage]:mutate}));});

test("contradictory live Model3d row retires its held completion and cannot revive after omission",async()=>{
  const s=fixture(),button=buttons(s.subject.render())[0];
  s.jobs=[{...copy(s.job),status:"running"}];assert.deepEqual(buttons(s.subject.render()),[]);
  s.jobs=[];assert.deepEqual(buttons(s.subject.render()),[]);
  button.click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.deepEqual(s.routes,[]);assert.equal(s.subject.completed().get("job-a").retired,true);
  if(s.reads.length)cleaned(s);
});

for(const [name,change] of [
  ["request identity",job=>{job.requestKey="later-request";}],
  ["saved source revision",job=>{job.documentRevision="later-revision";}],
  ["job attempt",job=>{job.attemptCount=2;}],
  ["result artifact",job=>{job.result.artifactId="artifact-b";}],
])test(`Model3d reappearing same-ID row with changed ${name} never inherits an observed completion`,async()=>{
  const s=fixture(),original=buttons(s.subject.render())[0];s.jobs=[];
  assert.equal(buttons(s.subject.render()).length,1);
  const changed=copy(s.job);change(changed);s.jobs=[changed];
  assert.deepEqual(buttons(s.subject.render()),[]);
  s.jobs=[];assert.deepEqual(buttons(s.subject.render()),[]);
  original.click({currentTarget:s.trigger});await new Promise(setImmediate);
  assert.deepEqual(s.routes,[]);assert.equal(s.subject.completed().get("job-a").retired,true);
  if(s.reads.length)cleaned(s);
});

test("source retirement after ACK omission removes the Model3d reference",()=>{
  const s=fixture();s.subject.render();s.jobs=[];s.sourceIdentity={};
  assert.deepEqual(buttons(s.subject.render()),[]);assert.equal(s.subject.completed().size,0);
});

for(const [name,mutate] of [
  ["managed request",s=>{s.job.productionMode="managed";}],
  ["workflow source",s=>{s.job.sourceSurface="workflow:x:y";}],
  ["wrong kind",s=>{s.job.result.artifactKind="slides";}],
  ["not completed",s=>{s.job.status="running";}],
])test(`Model3d ${name} offers no completion and performs no read`,async()=>{
  const s=fixture();mutate(s);assert.deepEqual(buttons(s.subject.render()),[]);
  assert.equal(await s.subject.open(),false);assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);
});

test("Model3d completion read error retains exact-job feedback and disposes; stale error stays silent",async()=>{
  const s=fixture({afterRead:()=>{throw Error("read failed");}});await refused(s);assert.equal(s.subject.error(),"job-a");
  const stale=fixture({afterRead:s=>{s.sourceCurrent=false;throw Error("stale failure");}});
  await refused(stale);assert.equal(stale.subject.error(),null);
});

test("Model3d duplicate gesture cannot cancel the original pending completion",async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const s=fixture({afterRead:async()=>{entered();await held;}}),first=s.subject.open();await started;
  assert.equal(await s.subject.open(),false);assert.equal(s.reads.length,1);assert.equal(s.reads[0].options.signal.aborted,false);
  release();assert.equal(await first,true);assert.equal(s.routes.length,1);cleaned(s);
});


test("Model3d capacity notice survives ACK omission and all held-job retirement without exceeding 120 slots",()=>{
  const s=fixture(),notice="More completed 3D models are available. Open them from this Document’s results.";
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

const capacityNotice="More completed 3D models are available. Open them from this Document’s results.";
const hasCapacityNotice=rendered=>templates(rendered).some(node=>node.strings.join("").includes('<p role="status">')&&node.values.includes(capacityNotice));
const capacityJob=(s,index)=>({...copy(s.job),jobId:`job-${index}`,result:{...copy(s.job.result),artifactId:`artifact-${index}`}});

test("exactly 120 observed Model3d jobs never invent a more-completions notice across omission and retirement",()=>{
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
])test(`observed Model3d overflow clears after ${name} changes with the feed omitted`,()=>{
  const s=fixture();s.jobs=Array.from({length:121},(_,index)=>capacityJob(s,index));
  assert.equal(hasCapacityNotice(s.subject.render()),true);
  s.jobs=[];mutate(s);assert.equal(s.subject.render(),null);assert.equal(s.subject.completed().size,0);
  assert.equal(s.reads.length,0);assert.deepEqual(s.routes,[]);
});
