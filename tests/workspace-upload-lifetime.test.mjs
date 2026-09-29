import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { writeFixture, sceneDeferred, eventPost, readWorkspaceEvents, input } from './helpers/event-source-retirement-fixture.mjs';
import { calmFullPageNativePorts as ports } from './helpers/calm-full-page-fixture.mjs';

const url = new URL('../src/components/forma-workspace.ts', import.meta.url);
const source = fs.readFileSync(url, 'utf8'), tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true);
const owner = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FormaWorkspace');
assert.ok(owner);
const bridge = `
  fixtureQueueUpload(files:File[]){this.#queueUpload({target:{files}} as unknown as Event);}
  fixtureRights(value:boolean){this.#rightsConfirmed=value;}
  fixtureCancelUpload(){this.#cancelUpload();}
  fixtureDraft(value:unknown){this.#blockDraft=value as BlockDraft;}
  fixtureConfirmUpload(){return this.#confirmUpload();}
  fixtureUploadState(){return{pending:this.#pendingUpload?.name??null,document:this.#uploadDocumentId,rights:this.#rightsConfirmed,uploading:this.#uploading,current:this.#uploadCurrent(),draft:this.#blockDraft?.documentTitle??null};}
`;
const bridged = source.slice(0, owner.end - 1) + bridge + source.slice(owner.end - 1);
const nextTree = ts.createSourceFile(url.pathname, bridged, ts.ScriptTarget.Latest, true);
const nextOwner = nextTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FormaWorkspace');
for (const [index, member] of owner.members.entries()) assert.equal(nextOwner.members[index]?.getText(nextTree), member.getText(tree), 'Every original class member, including overloads, is exact');
const originalRead = fs.readFileSync.bind(fs);
let Workspace;
fs.readFileSync = (file, ...args) => {
  const target = file instanceof URL ? fileURLToPath(file) : String(file);
  return target === fileURLToPath(url) ? typeof args[0] === 'string' ? bridged : Buffer.from(bridged) : originalRead(file, ...args);
};
try { ports.moduleCache.delete('src/components/forma-workspace.ts'); ({ FormaWorkspace: Workspace } = await ports.loadActual('src/components/forma-workspace.ts')); }
finally { fs.readFileSync = originalRead; }

async function fixture(t) {
  const h = await writeFixture(t, { shared: false });
  const f = { store: h.store, storeHost: h, locale: 'en', trace: [], clipboard: [], listeners: new Map(), changed: new Map(), resizeTargets: new Map(), frames: new Map(), timers: new Map(), timerSequence: 0, storage: new Map(), requested: false, steps: 0 };
  ports.bindFixture(f);
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) { event.callback({ locale: 'en', formatLocale: 'en', direction: 'ltr', timeZone: 'UTC', messages: ports.FORMA_DEFAULT_MESSAGES, revision: 1 }, () => {}); return true; } });
  f.i18n.hostConnected(); f.renderer = { query: () => [] }; f.tick = async () => undefined;
  h.document.querySelectorAll = () => []; h.document.activeElement = null; h.document.hasFocus = () => true;
  h.window.cancelAnimationFrame = id => h.window.clearTimeout(id);
  const component = new Workspace(); component.isConnected = true; component.attributes = {}; component.connectedCallback();
  const objects = new Map();
  const mediaRow = (key, body = false) => { const row = objects.get(key); return row ? { key, size: row.bytes.length, customMetadata: structuredClone(row.options.customMetadata ?? {}), httpMetadata: structuredClone(row.options.httpMetadata ?? {}), writeHttpMetadata(headers) { if (row.options.httpMetadata?.contentType) headers.set('content-type', row.options.httpMetadata.contentType); }, ...(body ? { body: new Response(row.bytes).body, arrayBuffer: async () => row.bytes.slice().buffer } : {}) } : null; };
  h.worker.env.MEDIA = { async put(key, value, options = {}) { const bytes = new Uint8Array(await new Response(value).arrayBuffer()); objects.set(key, { bytes, options }); return { key }; }, async head(key) { return mediaRow(key); }, async get(key) { return mediaRow(key, true); }, async delete(key) { objects.delete(key); } };
  t.after(() => { ports.bindFixture(f); component.isConnected = false; component.disconnectedCallback(); f.i18n.hostDisconnected(); });
  return { h, component, objects, bind: () => ports.bindFixture(f) };
}

for (const withdrawn of [false, true]) test('Workspace initial text upload ' + (withdrawn ? 'refuses late source-retired completion' : 'preserves healthy exact completion'), { timeout: 30_000 }, async t => {
  const { h, component, objects, bind } = await fixture(t);
  const entered = sceneDeferred(), released = sceneDeferred(); t.after(() => released.resolve());
  h.intercept = async request => {
    if (request.url !== '/api/media' || request.init.method !== 'POST') return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200, await response.clone().text());
    entered.resolve(); await released.promise; return response;
  };
  component.fixtureQueueUpload([new File(['Synthetic initial reference only.'], 'synthetic-source.txt', { type: 'text/plain' })]); component.fixtureRights(true);
  assert.equal(component.fixtureUploadState().current, true);
  const pending = component.fixtureConfirmUpload(); await entered.promise;
  assert.equal(objects.size, 1, 'One RAM-only object was stored by the real upload handler');
  if (withdrawn) { await h.deny(); h.restore(); await h.store.refreshEvents(); bind(); assert.equal(component.fixtureUploadState().current, false); }
  const posts = h.requests.filter(eventPost).length, history = (await readWorkspaceEvents(h.worker.env, h.worker.streamId)).length;
  released.resolve(); await pending;
  const newPosts = h.requests.filter(eventPost).length - posts, newEvents = (await readWorkspaceEvents(h.worker.env, h.worker.streamId)).length - history;
  t.diagnostic(JSON.stringify({ withdrawn, newPosts, newEvents, retainedObjects: objects.size, state: component.fixtureUploadState(), toast: h.store.ui.toast }));
  assert.equal(newPosts, withdrawn ? 0 : 1, 'A retired original upload must not append under restored source authority');
  assert.equal(newEvents, withdrawn ? 0 : 3);
  assert.equal(component.fixtureUploadState().uploading, false);
});

const textFile = (name='original.txt') => new File(['Synthetic reference text only.'], name, {type:'text/plain'});
function modelFile(name='original.glb') {
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]}));
 const size=Math.ceil(json.length/4)*4,bytes=Buffer.alloc(12+8+size+8+36);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(size,12);bytes.writeUInt32LE(0x4e4f534a,16);bytes.fill(0x20,20,20+size);json.copy(bytes,20);bytes.writeUInt32LE(36,20+size);bytes.writeUInt32LE(0x004e4942,24+size);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bytes.writeFloatLE(v,28+size+i*4));
 return new File([bytes],name,{type:'model/gltf-binary'});
}
const choose = (component,file=textFile()) => { component.fixtureQueueUpload([file]); component.fixtureRights(true); return file; };
async function heldMedia(t, phase='headers') {
 const x=await fixture(t),entered=sceneDeferred(),release=sceneDeferred();t.after(()=>release.resolve());
 x.h.intercept=async request=>{
  if(request.url!=='/api/media'||request.init.method!=='POST')return;
  const response=await x.h.worker.request(request.url,request.init);assert.equal(response.status,200,await response.clone().text());
  if(phase==='body'){
   const json=response.json.bind(response);response.json=async()=>{entered.resolve();await release.promise;return json();};return response;
  }
  entered.resolve();await release.promise;return response;
 };
 return {...x,entered,release};
}

for(const phase of ['headers','body'])for(const retirement of ['route round trip','disconnect/reconnect','adopt','cancel'])test(`Workspace upload rejects ${retirement} while awaiting media ${phase}`,{timeout:30000},async t=>{
 const x=await heldMedia(t,phase);choose(x.component);const pending=x.component.fixtureConfirmUpload();await x.entered.promise;
 const route=x.h.store.route.get();
 if(retirement==='route round trip'){x.h.store.route.set('/library');x.h.store.notify();x.h.store.route.set(route);x.h.store.notify();}
 else if(retirement==='disconnect/reconnect'){x.component.isConnected=false;x.component.disconnectedCallback();x.component.isConnected=true;x.component.connectedCallback();}
 else if(retirement==='adopt')x.component.adoptedCallback();
 else x.component.fixtureCancelUpload();
 x.h.store.toast('newer notice');const posts=x.h.requests.filter(eventPost).length;
 x.release.resolve();await pending;
 assert.equal(x.h.requests.filter(eventPost).length,posts);assert.equal(x.h.store.ui.toast,'newer notice');
 assert.equal(x.component.fixtureUploadState().pending,null);assert.equal(x.component.fixtureUploadState().uploading,false);
});

for(const kind of ['text','GLB'])for(const sameFile of [false,true])test(`Workspace old ${kind} response preserves a newer ${sameFile?'same-file':'different-file'} upload and its busy state`,{timeout:30000},async t=>{
 const x=await fixture(t),gates=[sceneDeferred(),sceneDeferred()],entered=[sceneDeferred(),sceneDeferred()];let sends=0;
 t.after(()=>gates.forEach(gate=>gate.resolve()));
 x.h.intercept=async request=>{if(request.url!=='/api/media'||request.init.method!=='POST')return;const index=sends++;const response=await x.h.worker.request(request.url,request.init);assert.equal(response.status,200);entered[index].resolve();await gates[index].promise;return response;};
 const first=choose(x.component,kind==='GLB'?modelFile():textFile());const old=x.component.fixtureConfirmUpload();await entered[0].promise;
 const next=choose(x.component,sameFile?first:kind==='GLB'?modelFile('newer.glb'):textFile('newer.txt'));x.component.fixtureDraft({documentId:x.h.worker.documentId,documentTitle:'Newer composer'});
 const fresh=x.component.fixtureConfirmUpload();await entered[1].promise;x.h.store.toast('newer notice');
 const before=x.h.requests.filter(eventPost).length;gates[0].resolve();await old;
 assert.equal(x.h.requests.filter(eventPost).length,before);assert.equal(x.h.store.ui.toast,'newer notice');
 assert.equal(x.component.fixtureUploadState().pending,next.name);assert.equal(x.component.fixtureUploadState().uploading,true);assert.equal(x.component.fixtureUploadState().draft,'Newer composer');
 gates[1].resolve();await fresh;assert.equal(x.h.requests.filter(eventPost).length,before+1);assert.equal(sends,2);
 const events=await readWorkspaceEvents(x.h.worker.env,x.h.worker.streamId);const blocks=events.filter(event=>event.type==='BlockCreated'&&event.payload.properties?.label===next.name);
 assert.equal(blocks.length,1);assert.equal(blocks[0].payload.document_id,x.h.worker.documentId);
 assert.equal(x.component.fixtureUploadState().pending,null);assert.equal(x.component.fixtureUploadState().uploading,false);
});

test('Workspace rejects duplicate confirmation while an original upload is pending',{timeout:30000},async t=>{
 const x=await heldMedia(t);choose(x.component);const pending=x.component.fixtureConfirmUpload();await x.entered.promise;
 await x.component.fixtureConfirmUpload();assert.equal(x.h.requests.filter(r=>r.url==='/api/media'&&r.init.method==='POST').length,1);
 x.release.resolve();await pending;assert.equal(x.h.requests.filter(eventPost).length,1);
});

for(const retire of [false,true])test(`Workspace ${retire?'withholds stale':'keeps current retryable'} media failure`,{timeout:30000},async t=>{
 const x=await fixture(t),entered=sceneDeferred(),release=sceneDeferred();t.after(()=>release.resolve());
 x.h.intercept=async request=>{if(request.url!=='/api/media')return;entered.resolve();await release.promise;return Response.json({error:'synthetic upload failure'},{status:503});};
 const file=choose(x.component),pending=x.component.fixtureConfirmUpload();await entered.promise;
 if(retire)x.component.fixtureCancelUpload();x.h.store.toast('existing notice');release.resolve();await pending;
 assert.equal(x.h.requests.filter(eventPost).length,0);assert.equal(x.h.store.ui.toast,retire?'existing notice':'synthetic upload failure');
 assert.equal(x.component.fixtureUploadState().pending,retire?null:file.name);assert.equal(x.component.fixtureUploadState().uploading,false);
});

test('Workspace current guard reaches the real serialized event-write queue',{timeout:30000},async t=>{
 const x=await fixture(t),entered=sceneDeferred(),release=sceneDeferred(),media=sceneDeferred();t.after(()=>release.resolve());let held=false;
 x.h.intercept=async request=>{
  if(eventPost(request)&&!held){held=true;const response=await x.h.worker.request(request.url,request.init);entered.resolve();await release.promise;return response;}
  if(request.url==='/api/media'){const response=await x.h.worker.request(request.url,request.init);media.resolve();return response;}
 };
 const beforeReferences=(await readWorkspaceEvents(x.h.worker.env,x.h.worker.streamId)).filter(e=>e.type==='ReferenceIngested').length;
 const blocking=x.h.store.append(input(x.h,'unrelated-original'));await entered.promise;
 choose(x.component);const upload=x.component.fixtureConfirmUpload();await media.promise;
 await new Promise(resolve=>setImmediate(resolve));x.component.fixtureCancelUpload();release.resolve();await blocking;await upload;
 assert.equal(x.h.requests.filter(eventPost).length,1,'only the earlier unrelated write was dispatched');
 const events=await readWorkspaceEvents(x.h.worker.env,x.h.worker.streamId);assert.equal(events.filter(e=>e.type==='ReferenceIngested').length,beforeReferences);
});

test('Workspace refuses dispatch after retirement during local image sampling',{timeout:30000},async t=>{
 const x=await fixture(t),entered=sceneDeferred(),release=sceneDeferred();t.after(()=>release.resolve());
 const previous=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
 Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>{entered.resolve();await release.promise;throw Error('finite decoder unavailable');}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'createImageBitmap',previous);else delete globalThis.createImageBitmap;});
 choose(x.component,new File(['synthetic decoder input'],'image.png',{type:'image/png'}));const pending=x.component.fixtureConfirmUpload();await entered.promise;
 x.component.fixtureCancelUpload();release.resolve();await pending;
 assert.equal(x.h.requests.filter(r=>r.url==='/api/media').length,0);assert.equal(x.h.requests.filter(eventPost).length,0);
});

test('Workspace refuses dispatch after retirement during local audio metadata',{timeout:30000},async t=>{
 const x=await fixture(t),entered=sceneDeferred(),listeners=new Map();
 // Model helpers are imported as original ES modules and use browser globals.
 for(const [key,value] of [['document',ports.documentPort],['window',x.h.window]]){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
 }
 const create=ports.documentPort.createElement.bind(ports.documentPort);
 t.mock.method(ports.documentPort,'createElement',tag=>tag==='audio'?{
  addEventListener(name,handler){listeners.set(name,handler);},removeAttribute(){},
  set src(_value){entered.resolve();},
 }:create(tag));
 choose(x.component,new File(['finite metadata input'],'audio.wav',{type:'audio/wav'}));const pending=x.component.fixtureConfirmUpload();await entered.promise;
 x.component.fixtureCancelUpload();listeners.get('error')();await pending;
 assert.equal(x.h.requests.filter(r=>r.url==='/api/media').length,0);assert.equal(x.h.requests.filter(eventPost).length,0);
});

test('Workspace committed original acknowledgement cannot clear a newer upload',{timeout:30000},async t=>{
 const x=await fixture(t),entered=sceneDeferred(),release=sceneDeferred();t.after(()=>release.resolve());
 x.h.intercept=async request=>{if(!eventPost(request))return;const response=await x.h.worker.request(request.url,request.init);assert.equal(response.status,200);entered.resolve();await release.promise;return response;};
 choose(x.component);const pending=x.component.fixtureConfirmUpload();await entered.promise;
 const committed=(await readWorkspaceEvents(x.h.worker.env,x.h.worker.streamId)).length;
 const newer=choose(x.component,textFile('newer-after-commit.txt'));x.h.store.toast('newer notice');release.resolve();await pending;
 assert.equal((await readWorkspaceEvents(x.h.worker.env,x.h.worker.streamId)).length,committed,'an accepted original write stays committed once');
 assert.equal(x.h.requests.filter(eventPost).length,1);assert.equal(x.component.fixtureUploadState().pending,newer.name);
 assert.equal(x.component.fixtureUploadState().rights,true);
 // The existing Store may report its truthful committed receipt. Workspace must not announce reference success for the retired interaction.
 assert.equal(x.h.store.ui.toast,'The server acknowledged the original change. Its private view is unavailable.');
});
