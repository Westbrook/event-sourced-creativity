// Missing input/failure branches only. Real class/Store/Worker; no browser, provider or live storage.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { writeFixture, sceneDeferred, eventPost, readWorkspaceEvents } from './helpers/event-source-retirement-fixture.mjs';
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
  fixtureUploadState(){return{pending:this.#pendingUpload,document:this.#uploadDocumentId,rights:this.#rightsConfirmed,uploading:this.#uploading,current:this.#uploadCurrent(),draft:this.#blockDraft};}
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

const mediaPosts = h => h.requests.filter(request => request.url === '/api/media' && request.init.method === 'POST');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sourceFile = () => new File(['Finite original source.'], 'unchanged-source.txt', { type: 'text/plain' });
const composer = h => ({ documentId: h.worker.documentId, documentTitle: 'Unchanged composer', type: 'reference', text: 'Café 日本語 — retained input' });

async function unchangedHistory(x, before, message) {
  assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before, message);
  assert.equal(x.h.requests.filter(eventPost).length, 0, 'No canonical reference/event write was dispatched');
  assert.equal(x.objects.size, 0, 'No uploaded object was retained');
  assert.equal(x.h.requests.filter(request => request.url.startsWith('/api/document-jobs') && request.init.method === 'POST').length, 0, 'No generation or automatic retry');
}

for (const selected of [false, true]) test(`Workspace empty file selection preserves ${selected ? 'an existing queue and consent' : 'the original empty queue'} and composer`, { timeout: 30_000 }, async t => {
  const x = await fixture(t), draft = composer(x.h), file = sourceFile();
  const draftSnapshot = structuredClone(draft);
  x.component.fixtureDraft(draft);
  if (selected) { x.component.fixtureQueueUpload([file]); x.component.fixtureRights(true); }
  const before = x.component.fixtureUploadState(), requests = x.h.requests.length;
  const history = await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId);
  x.component.fixtureQueueUpload([]);
  await tick(); await tick();
  assert.deepEqual(x.component.fixtureUploadState(), before, 'Empty input must not replace the queue, rights, target or composer');
  assert.strictEqual(x.component.fixtureUploadState().draft, draft, 'The same typed composer survives');
  assert.deepEqual(x.component.fixtureUploadState().draft, draftSnapshot, 'Empty selection preserves the original composer values');
  assert.strictEqual(x.component.fixtureUploadState().pending, selected ? file : null, 'Selected File identity is unchanged');
  assert.equal(x.h.requests.length, requests, 'The empty selection schedules no request');
  assert.equal(mediaPosts(x.h).length, 0);
  await unchangedHistory(x, history, 'Empty selection leaves all canonical history unchanged');
});

for (const kind of ['network rejection', 'AbortError']) test(`Workspace current ${kind} releases busy state and retains one retryable original selection`, { timeout: 30_000 }, async t => {
  const x = await fixture(t), draft = composer(x.h), file = sourceFile();
  const draftSnapshot = structuredClone(draft);
  const entered = sceneDeferred(), release = sceneDeferred(); t.after(() => release.resolve());
  const failure = kind === 'AbortError' ? new DOMException('Finite upload interrupted', 'AbortError') : new TypeError('Finite upload network unavailable');
  x.h.intercept = async request => {
    if (request.url !== '/api/media' || request.init.method !== 'POST') return;
    entered.resolve(); await release.promise; throw failure;
  };
  x.component.fixtureDraft(draft); x.component.fixtureQueueUpload([file]); x.component.fixtureRights(true);
  const history = await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId);
  const pending = x.component.fixtureConfirmUpload(); await entered.promise;
  assert.equal(x.component.fixtureUploadState().uploading, true, 'The deliberate confirmation actually entered upload');
  assert.equal(mediaPosts(x.h).length, 1);
  release.resolve(); await pending;
  await tick(); await tick();
  const state = x.component.fixtureUploadState();
  assert.strictEqual(state.pending, file); assert.strictEqual(state.draft, draft);
  assert.deepEqual(state.draft, draftSnapshot, 'Transport failure preserves the original composer values');
  assert.equal(state.document, x.h.worker.documentId); assert.equal(state.rights, true);
  assert.equal(state.current, true); assert.equal(state.uploading, false);
  assert.equal(x.h.store.ui.toast, failure.message, 'The current failure is reported without a saved/success notice');
  assert.equal(mediaPosts(x.h).length, 1, 'No automatic resubmission through settled callbacks');
  await unchangedHistory(x, history, 'Transport failure cannot publish a reference or alter original inputs');
});

for (const format of ['heic', 'heif']) test(`Workspace unsupported ${format.toUpperCase()} receives real Worker refusal and preserves its composer`, { timeout: 30_000 }, async t => {
  const x = await fixture(t), draft = composer(x.h);
  const draftSnapshot = structuredClone(draft);
  // Synthetic ISO-BMFF brand envelope only: this tests the real MIME rejection,
  // not HEIF decoding, EXIF orientation, a phone picker or image normalization.
  const bytes = Buffer.alloc(24); bytes.writeUInt32BE(24, 0); bytes.write('ftyp', 4); bytes.write(format === 'heic' ? 'heic' : 'mif1', 8);
  const file = new File([bytes], `unsupported.${format}`, { type: `image/${format}` });
  let decodeAttempts = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { decodeAttempts++; throw new DOMException('Finite unsupported image decoder', 'NotSupportedError'); } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous); else delete globalThis.createImageBitmap; });
  const responses = [];
  x.h.intercept = async request => {
    if (request.url !== '/api/media' || request.init.method !== 'POST') return;
    const response = await x.h.worker.request(request.url, request.init);
    responses.push({ status: response.status, body: await response.clone().json() });
    return response;
  };
  x.component.fixtureDraft(draft); x.component.fixtureQueueUpload([file]); x.component.fixtureRights(true);
  const history = await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId);
  await x.component.fixtureConfirmUpload(); await tick(); await tick();
  assert.equal(decodeAttempts, 1, 'The actual local image-preparation branch was reached');
  assert.equal(mediaPosts(x.h).length, 1); assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 400, 'The real Worker rejects this unsupported upload');
  assert.match(responses[0].body.error, /^Choose a supported image, audio recording, PDF, text, Markdown, CSV, JSON, Word, presentation, or spreadsheet smaller than 12 MB\.$/);
  const state = x.component.fixtureUploadState();
  assert.strictEqual(state.pending, file); assert.strictEqual(state.draft, draft);
  assert.deepEqual(state.draft, draftSnapshot, 'Unsupported input preserves the original composer values');
  assert.equal(state.document, x.h.worker.documentId); assert.equal(state.rights, true);
  assert.equal(state.current, true); assert.equal(state.uploading, false);
  assert.equal(x.h.store.ui.toast, responses[0].body.error, 'The UI exposes the actual unsupported-file refusal');
  await unchangedHistory(x, history, 'Unsupported input never publishes canonical reference events');
});
