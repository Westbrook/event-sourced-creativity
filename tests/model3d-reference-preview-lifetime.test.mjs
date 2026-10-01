import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
const { Model3dReferencePicker, VideoReferencePicker, VideoReferencePreview, readModel3dPreviewBytes } = await import("../src/experiences/model3d-reference-picker.ts");

// Explicit fake DOM, clock, transport and decode ports: no browser/image-quality proof.
class Element {
  children = []; parentElement = null; attributes = new Map(); listeners = new Map();
  hidden = false; checked = false; value = ""; textContent = "";
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; }
  get isConnected() { return this === this.doc.body || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); if (k === "src") this.src = ""; }
  addEventListener(type, fn) { const values = this.listeners.get(type) ?? []; values.push(fn); this.listeners.set(type, values); }
  fire(type) { for (const fn of this.listeners.get(type) ?? []) fn({ type, currentTarget: this, target: this }); }
  focus() { if (this.isConnected) this.doc.activeElement = this; }
  decode() { return this.doc.decode(); }
}
const all = root => [root, ...root.children.flatMap(all)];
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const never = () => new Promise(() => {});
function clock() {
  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout, oldNow = Date.now;
  let now = 10_000, sequence = 0; const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  return {
    timers,
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
    restore() { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; Date.now = oldNow; },
  };
}

async function checkPreviewLifetime(output) {
  const Picker = output === "video" ? VideoReferencePicker : Model3dReferencePicker;
  const bytes = new Uint8Array([1, 2, 3]), sha = createHash("sha256").update(bytes).digest("hex");
  const source = { version: 1, ...(output === "model3d" ? { kind: "image" } : {}), sourceProjectId: "project", sourceDocumentId: "document", sourceBlockId: "block", referenceId: "reference", sha256: sha };
  const candidate = { source, label: "Exact literal 日本語", preview: "/api/media/u-6f776e6572/a.png" };
  const oldDocument = globalThis.document, oldDigest = Object.getOwnPropertyDescriptor(crypto.subtle, "digest");
  const digest = crypto.subtle.digest.bind(crypto.subtle), controlled = clock(), revoked = [];
  const oldRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); oldRevoke.call(URL, url); };
  let activePicker;
  try {
    for (const phase of ["fetch", "body", "hash", "decode"]) {
      let failed = true, lateFetch, lastSignal, mediaCalls = 0, cancels = 0, lateDecode;
      const doc = { createElement(tag) { return new Element(tag, this); }, activeElement: null,
        decode() { return phase === "decode" && failed ? new Promise(resolve => { lateDecode = resolve; }) : Promise.resolve(); } };
      doc.body = new Element("body", doc); doc.activeElement = doc.body; globalThis.document = doc;
      // The hash port tests lifecycle ownership, not native crypto scheduling.
      // A real thread-pool digest can outlive an arbitrary microtask flush under
      // load. Preserve exact SHA-256 bytes with deterministic port completion.
      crypto.subtle.digest = async (...args) => phase === "hash" && failed ? never() : Uint8Array.from(createHash("sha256").update(args[1]).digest()).buffer;
      const changes = [], requests = [];
      const fetcher = async (path, init) => {
        requests.push({ path, method: init?.method ?? "GET" });
        if (path === `/api/experiences/${output}/references`) return Response.json({
          version: 1, scope: "personal-document-references", qualification: "discovery-only", head: 1, candidates: [candidate], next: null,
        });
        assert.equal(path, candidate.preview); mediaCalls++; lastSignal = init.signal;
        if (phase === "fetch" && failed) return new Promise(resolve => { lateFetch = resolve; });
        if (phase === "body" && failed) return new Response(new ReadableStream({
          pull() { return never(); }, cancel() { cancels++; return never(); },
        }), { headers: { "content-type": "image/png" } });
        return new Response(bytes, { headers: { "content-type": "image/png" } });
      };
      const picker = new Picker((selection, ready) => changes.push({ selection, ready }), undefined, fetcher);
      activePicker = picker; doc.body.append(picker.element);
      const find = text => all(picker.element).find(n => n.textContent === text);
      find(output === "video" ? "Browse images" : "Browse Document references").fire("click"); await flush();
      const radio = all(picker.element).find(n => n.value === "block"), retry = find(output === "video" ? "Check image" : "Check selected reference");
      radio.checked = true; radio.fire("change"); retry.focus(); await flush();
      assert.equal(retry.getAttribute("aria-disabled"), "true", phase);
      assert.equal(controlled.timers.size, 1, "one captured deadline covers all preview stages");
      controlled.advance(30_000); await flush();
      assert.equal(lastSignal.aborted, true, phase); assert.equal(retry.getAttribute("aria-disabled"), "false", phase);
      assert.equal(doc.activeElement, retry, "timeout never moves focus"); assert.equal(retry.isConnected, true);
      assert.equal(all(picker.element).find(n => n.tagName === "IMG").hidden, true);
      assert.equal(changes.at(-1).ready, false); assert.equal(controlled.timers.size, 0);
      assert.match(all(picker.element).find(n => n.getAttribute("role") === "status").textContent, /unavailable/);
      if (phase === "body") assert.equal(cancels, 1, "never-settling cancel does not hold busy");
      if (lateFetch) {
        lateFetch(new Response(new ReadableStream({ cancel() { cancels++; return never(); } }), { headers: { "content-type": "image/png" } }));
        await flush(); assert.equal(cancels, 1, "late acquired response is released without awaiting cancellation");
      }
      if (lateDecode) { lateDecode(); await flush(); assert.equal(changes.at(-1).ready, false, "late decode cannot revive expired preview"); }
      failed = false; retry.fire("click"); await flush();
      assert.equal(mediaCalls, 2, "retry is explicit and starts one new bounded acquisition");
      assert.equal(retry.getAttribute("aria-disabled"), "false"); assert.equal(doc.activeElement, retry);
      assert.equal(all(picker.element).find(n => n.tagName === "IMG").hidden, false);
      assert.equal(changes.at(-1).ready, false, "display is not permission/inspection authority");
      assert(requests.every(r => r.method === "GET"), "no inspection/save/provider action is introduced");
      picker.dispose(); activePicker = undefined; assert.equal(controlled.timers.size, 0);
    }
    crypto.subtle.digest = digest;
    const good = await readModel3dPreviewBytes(new Response(bytes, { headers: { "content-type": "image/png" } }), sha, new AbortController().signal);
    assert.deepEqual(good.bytes, bytes); assert.equal(good.mime, "image/png");
    let reads = 0, cancels = 0, releases = 0;
    const chunkResponse = { ok: true, headers: new Headers({ "content-type": "image/png" }), body: { getReader() { return {
      async read() { reads++; return { done: false, value: new Uint8Array([1]) }; },
      cancel() { cancels++; return never(); }, releaseLock() { releases++; },
    }; } } };
    await assert.rejects(readModel3dPreviewBytes(chunkResponse, sha, new AbortController().signal), /preview_unavailable/);
    assert.equal(reads, 65_537); assert.equal(cancels, 1); assert.equal(releases, 1);
    reads = 0;
    const empty = { ...chunkResponse, body: { getReader() { return {
      async read() { reads++; return { done: false, value: new Uint8Array() }; }, cancel: never, releaseLock() {},
    }; } } };
    await assert.rejects(readModel3dPreviewBytes(empty, sha, new AbortController().signal), /preview_unavailable/);
    assert.equal(reads, 1, "empty chunks cannot make an endless microtask loop");
    const owner = new AbortController();
    const stalled = readModel3dPreviewBytes(new Response(new ReadableStream({ pull: never, cancel: never }), { headers: { "content-type": "image/png" } }), sha, owner.signal);
    const rejected = assert.rejects(stalled, /preview_unavailable/); owner.abort(); await rejected;
    assert.equal(controlled.timers.size, 0); assert(revoked.length >= 5, "owned URLs are retired on timeout/disposal");
  } finally {
    activePicker?.dispose(); controlled.restore(); globalThis.document = oldDocument; URL.revokeObjectURL = oldRevoke;
    if (oldDigest) Object.defineProperty(crypto.subtle, "digest", oldDigest); else delete crypto.subtle.digest;
  }
}
for (const output of ["model3d", "video"]) test(`${output} preview acquisition/body/hash/decode retain one lifetime and retry focus`, () => checkPreviewLifetime(output));

const { ExperienceIntakeRuntime } = await import('../src/experiences/intake-runtime.ts');
const { registeredExperience } = await import('../src/experiences/intake.ts');
function videoPickerFixture({ invalidCandidate = false, changedIntent = false, retained = false } = {}) {
  const bytes = new Uint8Array([1,2,3]), hash = createHash('sha256').update(bytes).digest('hex');
  const source = { version:1, sourceProjectId:'project', sourceDocumentId:'document', sourceBlockId:'block', referenceId:'reference', sha256:hash };
  const candidate = { source, label:'Image 日本語', preview:'/api/media/u-6f776e6572/image.png' };
  const selection = { ...source, permissionAttestation:'i-own-or-have-permission' };
  const doc = { createElement(tag) { return new Element(tag,this); }, activeElement:null, decode:()=>Promise.resolve() };
  doc.body=new Element('body',doc);doc.activeElement=doc.body;
  const requests=[];
  const fetcher=async(path,init)=>{
    requests.push({path,init});assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
    if(path==='/api/experiences/video/references')return Response.json({version:1,scope:'personal-document-references',qualification:'discovery-only',head:1,candidates:[invalidCandidate?{...candidate,source:{...source,kind:'saved-model-view'}}:candidate],next:null});
    if(path===candidate.preview)return new Response(bytes,{headers:{'content-type':'image/png'}});
    assert.equal(path,'/api/experiences/video/reference/inspect');assert.deepEqual(JSON.parse(init.body),selection);
    assert.equal(Object.hasOwn(JSON.parse(init.body),'kind'),false,'Video never posts a3D intent');
    return Response.json({version:1,status:'inspected',generation:'unavailable',persisted:false,transferAuthorized:false,
      inspection:{version:1,qualification:'read-only-reference-inspection',selection,sourceDigest:'b'.repeat(64),
        content:{sha256:hash,byteLength:bytes.length,mimeType:'image/png'},intent:{version:1,seconds:changedIntent?5:4,resolution:'480p',audioMode:'silent',referenceCount:1}}});
  };
  return {doc,requests,selection,fetcher,retained:retained?selection:undefined};
}
test('Video picker requires a chosen image, explicit permission and exact Video inspection before runtime readiness',async()=>{
  const oldDocument=globalThis.document;let picker,runtime;
  try{
    const f=videoPickerFixture();globalThis.document=f.doc;runtime=new ExperienceIntakeRuntime(await registeredExperience('video'),async()=>{assert.fail('No save is activated by selection');});
    picker=new VideoReferencePicker((value,ready)=>runtime.changeReference(value,ready),undefined,f.fetcher);f.doc.body.append(picker.element);
    assert.equal(runtime.referenceReady,false);assert.equal(all(picker.element).some(n=>n.textContent==='Text only'),false);
    all(picker.element).find(n=>n.textContent==='Browse images').fire('click');await flush();
    const radio=all(picker.element).find(n=>n.type==='radio');assert.ok(radio);assert.equal(all(picker.element).filter(n=>n.type==='radio').length,1);
    radio.checked=true;radio.fire('change');await flush();assert.equal(runtime.referenceReady,false);assert.equal(f.requests.some(x=>x.init.method==='POST'),false);
    const permission=all(picker.element).find(n=>n.type==='checkbox');permission.focus();permission.checked=true;permission.fire('change');await flush();
    assert.equal(runtime.referenceReady,true);assert.deepEqual(runtime.state.draft.reference,f.selection);assert.equal(f.doc.activeElement,permission);
    assert.equal(all(picker.element).find(n=>n.textContent==='Image checked').getAttribute('role'),'status');
    permission.checked=false;permission.fire('change');await flush();assert.equal(runtime.referenceReady,false);
    assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1);assert(f.requests.every(x=>!x.path.includes('/model3d/')));
  }finally{picker?.dispose();runtime?.dispose();globalThis.document=oldDocument;}
});
test('Video picker refuses mesh metadata and changed inspection intent; retained image recovery never infers a new permission statement',async()=>{
  const oldDocument=globalThis.document;let picker;
  try{
    for(const options of [{invalidCandidate:true},{changedIntent:true},{retained:true}]){
      const f=videoPickerFixture(options);globalThis.document=f.doc;const changes=[];
      picker=new VideoReferencePicker((selection,ready)=>changes.push({selection,ready}),f.retained,f.fetcher);f.doc.body.append(picker.element);
      if(!f.retained)all(picker.element).find(n=>n.textContent==='Browse images').fire('click');await flush();
      const radio=all(picker.element).find(n=>n.type==='radio');
      if(options.invalidCandidate){assert.equal(radio,undefined);assert.equal(f.requests.length,1);assert(!changes.some(x=>x.ready));}
      else if(options.changedIntent){radio.checked=true;radio.fire('change');await flush();const permission=all(picker.element).find(n=>n.type==='checkbox');permission.checked=true;permission.fire('change');await flush();assert(!changes.some(x=>x.ready));}
      else{assert.equal(changes[0].ready,false);assert.equal(changes.at(-1).ready,true);assert.deepEqual(changes.at(-1).selection,f.selection);assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1);}
      picker.dispose();picker=undefined;
    }
  }finally{picker?.dispose();globalThis.document=oldDocument;}
});

test('default3D and Video transports do not receive the picker as native fetch receiver',async()=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch;let picker;
  try{
    for(const [Picker,output,browse] of [[Model3dReferencePicker,'model3d','Browse Document references'],[VideoReferencePicker,'video','Browse images']]){
      const doc={createElement(tag){return new Element(tag,this);},activeElement:null,decode:()=>Promise.resolve()};doc.body=new Element('body',doc);globalThis.document=doc;
      const receivers=[];globalThis.fetch=async function(path,init){
        receivers.push(this===undefined);if(this!==undefined)throw TypeError('Illegal invocation');
        assert.equal(path,`/api/experiences/${output}/references`);assert.equal(init.credentials,'same-origin');
        return Response.json({version:1,scope:'personal-document-references',qualification:'discovery-only',head:1,candidates:[],next:null});
      };
      picker=new Picker(()=>{});doc.body.append(picker.element);
      all(picker.element).find(n=>n.textContent===browse).fire('click');await flush();
      assert.deepEqual(receivers,[true],output+' uses detached fetch');
      assert(all(picker.element).some(n=>n.textContent===(output==='video'?'Images loaded':'References loaded')));
      picker.dispose();picker=undefined;
    }
  }finally{picker?.dispose();globalThis.document=oldDocument;globalThis.fetch=oldFetch;}
});

const retainedVideoPlan=f=>({version:1,selection:f.selection,sourceDigest:'b'.repeat(64),properties:{label:'Image 日本語',reference_id:f.selection.referenceId,source_content_hash:f.selection.sha256,media_url:'/api/media/u-6f776e6572/image.png',media_type:'image/png'}});
test('retained Video preview reads exact private bytes without inspection or new permission and releases its blob',async()=>{
 const oldDocument=globalThis.document;let view;
 try{
  const f=videoPickerFixture();globalThis.document=f.doc;view=new VideoReferencePreview(retainedVideoPlan(f),f.fetcher);f.doc.body.append(view.element);await flush();
  const image=all(view.element).find(n=>n.tagName==='IMG');assert.equal(image.hidden,false);assert.match(image.src,/^blob:/);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].init.method,undefined);assert.equal(f.requests[0].path,'/api/media/u-6f776e6572/image.png');
  assert.equal(all(view.element).filter(n=>n.tagName==='INPUT').length,0);assert(all(view.element).some(n=>n.tagName==='FIGCAPTION'&&n.textContent==='Image 日本語'));
  assert(all(view.element).some(n=>n.tagName==='SUMMARY'&&n.textContent==='Image details'));view.dispose();assert.equal(image.hidden,true);assert.equal(image.src,'');
 }finally{view?.dispose();globalThis.document=oldDocument;}
});
test('retained preview refuses changed bytes and external URLs without replacing the saved source',async()=>{
 const oldDocument=globalThis.document;let view;
 try{
  for(const external of [false,true]){
   const f=videoPickerFixture();globalThis.document=f.doc;const value=retainedVideoPlan(f),before=structuredClone(value);if(external)value.properties.media_url='https://outside.invalid/image.png';let calls=0;
   view=new VideoReferencePreview(value,async()=>{calls++;return new Response(new Uint8Array([4,5,6]),{headers:{'content-type':'image/png'}});});f.doc.body.append(view.element);await flush();
   assert.equal(calls,external?0:1);assert.equal(all(view.element).find(n=>n.tagName==='IMG').hidden,true);assert(all(view.element).some(n=>n.textContent==='Image unavailable'));
   assert.deepEqual(value.selection,before.selection);view.dispose();view=undefined;
  }
 }finally{view?.dispose();globalThis.document=oldDocument;}
});
test('retained Video fetch/body/decode share one deadline, keep retry focus and cannot attach late bytes',async()=>{
 const oldDocument=globalThis.document;let view;
 try{
  for(const phase of ['fetch','body','decode']){
   const f=videoPickerFixture(),timer=clock();globalThis.document=f.doc;let late,signal,cancelled=0;
   if(phase==='decode')f.doc.decode=never;
   try{
    view=new VideoReferencePreview(retainedVideoPlan(f),async(path,init)=>{signal=init.signal;
     if(phase==='fetch')return new Promise(resolve=>{late=resolve;});
     if(phase==='body')return new Response(new ReadableStream({pull:never,cancel(){cancelled++;return never();}}),{headers:{'content-type':'image/png'}});
     return f.fetcher(path,init);
    });f.doc.body.append(view.element);await flush();const reload=all(view.element).find(n=>n.textContent==='Reload image');reload.focus();
    assert.equal(timer.timers.size,1);timer.advance(30000);await flush();assert.equal(signal.aborted,true);assert.equal(reload.getAttribute('aria-disabled'),'false');assert.equal(f.doc.activeElement,reload);assert.equal(timer.timers.size,0);
    assert.equal(all(view.element).find(n=>n.tagName==='IMG').hidden,true);
    if(late){late(new Response(new ReadableStream({cancel(){cancelled++;return never();}}),{headers:{'content-type':'image/png'}}));await flush();}
    if(phase!=='decode')assert.equal(cancelled,1);view.dispose();view=undefined;
   }finally{view?.dispose();timer.restore();}
  }
 }finally{view?.dispose();globalThis.document=oldDocument;}
});
