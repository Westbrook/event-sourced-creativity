import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";
import * as lit from "lit";

// Execute the complete current host methods through the retained Video test's
// AST seam. Store, already-validated file selection, geometry preparation, native
// focus and bounded network/clock operations are explicit finite ports. These
// controls do not execute the writer again or claim Worker persistence or paint.
const hostUrl = new URL("../src/components/document-artifacts.ts", import.meta.url);
const hostText = readFileSync(hostUrl, "utf8");
const hostSyntax = ts.createSourceFile(hostUrl.pathname, hostText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hostOwner = hostSyntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DocumentArtifacts");
assert.ok(hostOwner, "actual DocumentArtifacts class");
const asynchronous = new Set(["#readModel3dScaleMedia", "#prepareModel3dScale", "#saveModel3dScale", "#startModel3dScale"]);
const methods = ["#retireModel3dScale", "#syncModel3dScale", "#readModel3dScaleMedia", "#prepareModel3dScale",
  "#changeModel3dScale", "#saveModel3dScale", "#model3dScaleView", "#startModel3dScale"].map(name => {
  const matches = hostOwner.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(hostSyntax) === name);
  assert.equal(matches.length, 1, "one complete actual method: " + name);
  assert.equal(Boolean(matches[0].asteriskToken), false);
  assert.equal(Boolean(matches[0].modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)), asynchronous.has(name));
  return matches[0].getText(hostSyntax);
});
const assetUrl = new URL("../src/model/model3d-assets.ts", import.meta.url);
const assetSyntax = ts.createSourceFile(assetUrl.pathname, readFileSync(assetUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const limitDeclaration = assetSyntax.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  .filter(declaration => declaration.name.getText(assetSyntax) === "MAX_MODEL3D_UPLOAD_BYTES");
assert.equal(limitDeclaration.length, 1);
const maximumBytes = new Function(`return (${limitDeclaration[0].initializer.getText(assetSyntax)});`)();
const hostCode = ts.transpileModule(`class Model3dHostControl {
  #model3dScale = null; #model3dScaleNotice = null; #editingId = "model-a"; #editRevision = 3;
  #savingEdit = false; #activeId = "model-a"; #viewerCurrent;
  #editMarkdown = ""; #editItems = []; #reviewPanelOpen = false;
  constructor(f) { this.f = f; this.store = f.store; this.ownerDocument = f.document;
    this.i18n = { locale: f.locale }; this.#viewerCurrent = () => f.viewer; }
  #viewDialog() { return this.f.dialog; }
  #privateSourceCurrent() { return () => this.f.source; }
  #model3dScaleMediaOwned(artifact) { return artifact?.file ?? null; }
  #cancelArtifactEdit() { this.f.cancelCalls++; this.#retireModel3dScale(); this.#editingId = ""; this.#editRevision = 0; }
  get updateComplete() { return this.f.tick(); }
  requestUpdate() { this.f.updates++; }
  querySelector(selector) { return this.f.nodes.get(selector) ?? null; }
  install(draft, saving = false) { this.#model3dScale = draft; this.#savingEdit = saving; this.#editingId = draft.artifactId; }
  state() { return { draft: this.#model3dScale, notice: this.#model3dScaleNotice, editingId: this.#editingId, saving: this.#savingEdit }; }
  retire() { return this.#retireModel3dScale(); }
  resetForOpen() { this.#retireModel3dScale(); this.#editingId = ""; this.#editRevision = 0; }
  start(artifact = this.f.artifact, event = { currentTarget: this.f.openButton }) { return this.#startModel3dScale(artifact, event); }
  sync() { return this.#syncModel3dScale(); }
  read(draft = this.#model3dScale) { return this.#readModel3dScaleMedia(draft); }
  prepare(draft = this.#model3dScale) { return this.#prepareModel3dScale(draft); }
  change(event, expected = this.#model3dScale) { return this.#changeModel3dScale(event, expected); }
  save(artifact, event, check = false, expected = this.#model3dScale) { return this.#saveModel3dScale(artifact, event, check, expected); }
  view(artifact = this.f.artifact, draft = this.#model3dScale) { return this.#model3dScaleView(artifact, draft); }
  ${methods.join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const hostFactory = new Function("prepareModel3dArtifactScale", "GeometryScaleError", "documentArtifactRevision", "model3dArtifactMediaFile",
  "captureOutputNavigationFocus", "HTMLButtonElement", "HTMLInputElement", "MAX_MODEL3D_UPLOAD_BYTES", "setTimeout", "clearTimeout", "Date",
  "parseDocumentArtifactContent", "crypto",
  hostCode + "\nreturn Model3dHostControl;");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const bounds = size => ({ min: [0, 0, 0], max: [size, size, size], size: [size, size, size] });
class GeometryErrorPort extends Error { constructor(code) { super(code); this.code = code; } }
function prepared(f, factor = 2, changed = true) {
  return { status: changed ? "prepared" : "unchanged", source: { ...f.draft.source },
    geometry: { bytes: new Uint8Array([44, 33, 22, 11]), changed, factor, beforeBounds: bounds(1), afterBounds: bounds(factor),
      vertexCount: 3, positionAccessorCount: 1 },
    request: changed ? { expectedRevision: 3, expectedContentSha256: "c".repeat(64), model3dScale: {
      sourceMediaSha256: "a".repeat(64), factor, resultMediaSha256: "b".repeat(64) } } : null };
}

function fixture() {
  const f = { current: true, basis: true, source: true, authorization: true, viewer: true, focusCurrent: true,
    raw: "exact source revision", revision: 3, locale: "en", now: 1000, updates: 0, cancelCalls: 0, focusCalls: 0, focusDisposals: 0,
    projectId: "project-a", route: "/?document=document-a", head: 12, ownerId: "owner-a", trace: [],
    prepareCalls: [], reviseCalls: [], checkCalls: [], fetchCalls: [], timers: new Map(), nodes: new Map(),
    tick: async () => true, document: { activeElement: null, location: { origin: "http://127.0.0.1:47000" } } };
  class ButtonPort { isConnected = true; disabled = false; focus() { f.focusCalls++; f.document.activeElement = this; f.trace.push("button focus"); } }
  class InputPort { value = "2"; isConnected = true; disabled = false;
    focus() { f.focusCalls++; f.document.activeElement = this; f.trace.push("factor focus"); } }
  f.input = new InputPort(); f.saveButton = new ButtonPort(); f.checkButton = new ButtonPort();
  f.cancelButton = new ButtonPort(); f.reviewButton = new ButtonPort();
  f.openButton = new ButtonPort(); f.nodes.set(".artifact-model3d-scale-open", f.openButton);
  f.nodes.set(".artifact-model3d-scale-factor", f.input);
  f.nodes.set(".artifact-model3d-scale-save", f.saveButton);
  f.nodes.set(".artifact-model3d-scale-check", f.checkButton);
  f.nodes.set(".artifact-model3d-scale-cancel", f.cancelButton);
  f.document.activeElement = f.saveButton;
  f.dialog = { open: true, contains: node => [f.saveButton, f.checkButton, f.cancelButton, f.reviewButton, f.openButton].includes(node),
    querySelector: selector => selector === ".artifact-viewer-review-toggle" ? f.reviewButton : f.nodes.get(selector) ?? null };
  f.artifact = { id: "model-a", kind: "model3d", documentId: "document-a", contentRef: "content-a", items: [],
    sourceEventId: "completion-a",
    mediaUrl: "/api/media/original.glb", file: { url: "/api/media/original.glb", sha256: "a".repeat(64), fileSize: 4 } };
  f.prepare = async input => prepared(f, input.factor);
  f.revise = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.check = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.fetch = async () => { throw Error("unexpected private read"); };
  f.digest = (algorithm, bytes) => webcrypto.subtle.digest(algorithm, bytes);
  f.store = {
    events: { get: () => ({ revision: f.revision }) }, content: { get: () => ({ "content-a": f.raw }) },
    projection: { get: () => ({ libraryArtifacts: [f.artifact], projectId: f.projectId }) }, route: { get: () => f.route },
    session: { get: () => ({ user: { userId: f.ownerId }, projectContext: null }) }, head: { get: () => f.head },
    captureAuthorizationScope: () => f.authorization ? { key: "owned-personal" } : null,
    authorizationScopeActive: scope => f.authorization && scope.key === "owned-personal",
    reviseDocumentArtifact: async (id, request) => { f.reviseCalls.push({ id, request }); return f.revise(id, request); },
    checkModel3dScaleOperation: async (id, request) => { f.checkCalls.push({ id, request }); return f.check(id, request); },
    guardedFetch: (url, options, reason, scope) => { f.fetchCalls.push({ url, options, reason, scope }); return f.fetch(url, options, scope); },
  };
  const Host = hostFactory(async input => { f.prepareCalls.push(input); return f.prepare(input); }, GeometryErrorPort,
    (events, id) => { assert.equal(id, "model-a"); return events.revision; }, artifact => artifact?.file ?? null,
    () => ({ current: () => f.focusCurrent, run: (_target, operation) => f.focusCurrent && operation(), dispose() { f.focusDisposals++; } }),
    ButtonPort, InputPort, maximumBytes,
    (callback, delay) => { const token = {}; f.timers.set(token, { callback, delay }); return token; },
    token => f.timers.delete(token), { now: () => f.now },
    raw => { try { return JSON.parse(raw); } catch { return null; } },
    { subtle: { digest: (algorithm, bytes) => f.digest(algorithm, bytes) } });
  f.host = new Host(f);
  f.newDraft = () => {
    const draft = { artifactId: "model-a", mediaUrl: "/api/media/original.glb", byteLength: 4, rawContent: f.raw,
      source: { artifactKind: "model3d", artifactId: "model-a", documentId: "document-a", projectId: "project-a",
        sourceEventId: "completion-a", revision: 3, contentSha256: "c".repeat(64), mediaUrl: "/api/media/original.glb",
        mediaSha256: "a".repeat(64), byteLength: 4 },
      abort: new AbortController(), bytes: new Uint8Array([11, 22, 33, 44]), factor: "2", preparation: 0,
      beforeBounds: bounds(1), prepared: null, loading: false, preparing: false, saving: false, checking: false, request: null, code: null,
      current: () => f.current && f.host.state().draft === draft, basisCurrent: () => draft.current() && f.basis };
    return draft;
  };
  f.draft = f.newDraft(); f.host.install(f.draft); f.draft.prepared = prepared(f);
  f.save = (check = false, expected = f.draft, origin = check ? f.checkButton : f.saveButton) =>
    f.host.save(f.artifact, { currentTarget: origin }, check, expected);
  f.enter = (value, expected = f.draft, input = f.input) => {
    input.value = value; f.host.change({ currentTarget: input }, expected);
  };
  return f;
}

function openingFixture() {
  const f = fixture(); f.host.resetForOpen();
  f.raw = '{\n  "items": [], "content_markdown": "Saved GLB plan"\n}\n';
  f.projectId = "project-open-owned"; f.document.activeElement = f.openButton;
  f.digest = (algorithm, bytes) => { f.trace.push("digest"); return webcrypto.subtle.digest(algorithm, bytes); };
  f.open = () => { const opening = f.host.start(); f.draft = f.host.state().draft; return opening; };
  // Content parsing and authorized GLB selection are already-validated ports;
  // the actual opening method captures identity, hashes the exact raw string,
  // reads bytes, prepares, and then decides whether it still owns focus.
  return f;
}

test("actual initial open captures the projection project and raw digest, then reads and prepares before focus", { timeout: 2000 }, async t => {
  const f = openingFixture(); t.after(() => f.host.retire());
  assert.equal(Object.hasOwn(f.artifact, "projectId"), false, "DocumentArtifact has no projectId field");
  const port = responsePort(f);
  f.fetch = async () => { assert.equal(f.focusCalls, 0); f.trace.push("read"); return port.response; };
  f.prepare = async input => {
    assert.equal(f.focusCalls, 0); f.trace.push("prepare"); return prepared(f, input.factor, false);
  };
  const opening = f.open(); assert.equal(f.draft.loading, true); assert.equal(f.draft.source, null);
  await opening;
  assert.equal(f.fetchCalls.length, 1); assert.equal(f.prepareCalls.length, 1);
  const input = f.prepareCalls[0];
  assert.deepEqual(input.captured, { artifactKind: "model3d", artifactId: "model-a", documentId: "document-a",
    projectId: "project-open-owned", sourceEventId: "completion-a", revision: 3,
    contentSha256: createHash("sha256").update(f.raw, "utf8").digest("hex"),
    mediaUrl: "/api/media/original.glb", mediaSha256: "a".repeat(64), byteLength: 4 });
  assert.equal(input.current, input.captured); assert.equal(input.rawContent, f.raw); assert.equal(input.factor, 1);
  assert.deepEqual([...input.bytes], [11, 22, 33, 44]); assert.equal(f.draft.prepared.status, "unchanged");
  assert.equal(f.draft.loading, false); assert.equal(f.host.view().ready, true);
  assert.deepEqual(f.trace, ["digest", "read", "prepare", "factor focus"]);
  assert.equal(f.document.activeElement, f.input); assert.equal(f.focusDisposals, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.reviseCalls.length + f.checkCalls.length, 0);
});

test("route or source retirement during initial open prevents late preparation and focus publication", { timeout: 2000 }, async t => {
  for (const stage of ["route during digest", "source during read"]) await t.test(stage, async () => {
    const f = openingFixture(), digestGate = deferred(), readEntered = deferred(), response = deferred();
    if (stage === "route during digest") f.digest = (algorithm, bytes) => digestGate.promise.then(() => webcrypto.subtle.digest(algorithm, bytes));
    f.fetch = () => { readEntered.resolve(); return response.promise; };
    const opening = f.open(), draft = f.draft;
    if (stage === "source during read") { await readEntered.promise; f.source = false; }
    else f.route = "/?document=other-document";
    f.host.sync(); digestGate.resolve(); await opening;
    assert.equal(f.host.state().draft, null); assert.equal(draft.abort.signal.aborted, true);
    assert.equal(draft.bytes, null); assert.equal(draft.source, null); assert.equal(draft.prepared, null);
    assert.equal(f.prepareCalls.length, 0); assert.equal(f.focusCalls, 0); assert.equal(f.focusDisposals, 1);
    assert.equal(f.reviseCalls.length + f.checkCalls.length, 0); assert.equal(f.timers.size, 0);
    if (stage === "source during read") {
      const late = responsePort(f); response.resolve(late.response); await flush();
      assert.equal(late.state.bodyCancels, 1); assert.equal(f.fetchCalls.length, 1);
    } else assert.equal(f.fetchCalls.length, 0);
  });
});

test("captured draft and actual input ownership gate changes; invalid factor remains editable and visible", async () => {
  const f = fixture(), initial = f.draft.prepared;
  f.enter("3", { ...f.draft }); f.enter("3", f.draft, { value: "3" });
  f.enter("3", f.draft, new f.input.constructor());
  assert.equal(f.draft.factor, "2"); assert.equal(f.draft.prepared, initial); assert.equal(f.prepareCalls.length, 0);
  for (const flag of ["saving", "checking"]) { f.draft[flag] = true; f.enter("3"); f.draft[flag] = false; }
  f.draft.code = "unconfirmed"; f.enter("3"); f.draft.code = null;
  f.basis = false; f.enter("3"); f.basis = true;
  assert.equal(f.prepareCalls.length, 0); assert.equal(f.draft.factor, "2");
  for (const factor of ["", "0", "-2", "Infinity", "not a factor"]) {
    f.enter(factor);
    assert.equal(f.draft.factor, factor); assert.equal(f.draft.code, "invalid_scale");
    assert.equal(f.draft.prepared, null); assert.deepEqual(f.host.view().beforeBounds, bounds(1));
    assert.equal(f.host.view().ready, false); assert.equal(f.host.view().factor, factor);
  }
  assert.deepEqual([...initial.geometry.bytes], [0, 0, 0, 0]);
  f.enter("2.5"); await flush();
  assert.equal(f.prepareCalls.length, 1); assert.equal(f.prepareCalls[0].factor, 2.5);
  assert.equal(f.prepareCalls[0].rawContent, f.raw); assert.equal(f.prepareCalls[0].captured, f.draft.source);
  assert.equal(f.draft.code, null); assert.equal(f.host.view().ready, true);
});

test("overlapping preparation keeps only the latest nonce and erases discarded derivative bytes", async () => {
  const f = fixture(), first = deferred(), second = deferred(), previous = f.draft.prepared;
  f.prepare = () => f.prepareCalls.length === 1 ? first.promise : second.promise;
  const a = f.host.prepare(); f.draft.factor = "3"; const b = f.host.prepare();
  assert.deepEqual([...previous.geometry.bytes], [0, 0, 0, 0]); assert.equal(f.draft.preparing, true);
  const late = prepared(f, 2), latest = prepared(f, 3);
  second.resolve(latest); await b; first.resolve(late); await a;
  assert.equal(f.draft.prepared, latest); assert.equal(f.draft.preparing, false);
  assert.deepEqual([...late.geometry.bytes], [0, 0, 0, 0]); assert.deepEqual([...latest.geometry.bytes], [44, 33, 22, 11]);
  const pending = deferred(); f.prepare = () => pending.promise; const c = f.host.prepare();
  const sourceBytes = f.draft.bytes; f.host.retire(); const retired = prepared(f, 4); pending.resolve(retired); await c;
  assert.equal(f.host.state().draft, null); assert.deepEqual([...sourceBytes], [0, 0, 0, 0]);
  assert.deepEqual([...retired.geometry.bytes], [0, 0, 0, 0]); assert.equal(f.draft.source, null); assert.equal(f.draft.rawContent, "");
});

test("preparation failures retain the factor and map bounded geometry failures without dispatching Save", async () => {
  for (const [error, code] of [[new GeometryErrorPort("unsupported"), "unsupported"], [new GeometryErrorPort("precision"), "invalid_scale"],
    [Error("private mismatch"), "unavailable"]]) {
    const f = fixture(); f.prepare = async () => { throw error; }; f.draft.factor = "0.0001";
    await f.host.prepare(); assert.equal(f.draft.code, code); assert.equal(f.draft.factor, "0.0001");
    assert.equal(f.draft.prepared, null); assert.equal(f.draft.preparing, false); await f.save();
    assert.equal(f.reviseCalls.length + f.checkCalls.length, 0);
  }
});

test("source retirement clears private bytes while retaining an uncertain operation for read-only Check", async () => {
  const f = fixture(), source = f.draft.bytes, derivative = f.draft.prepared.geometry.bytes;
  await f.save(); const request = f.draft.request; f.basis = false; f.host.sync();
  assert.equal(f.draft.abort.signal.aborted, true); assert.equal(f.draft.bytes, null); assert.equal(f.draft.prepared, null);
  assert.deepEqual([...source], [0, 0, 0, 0]); assert.deepEqual([...derivative], [0, 0, 0, 0]);
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.draft.request, request);
  await f.save(true); assert.equal(f.checkCalls.length, 1); assert.equal(f.checkCalls[0].request, request);
  f.current = false; f.host.sync(); assert.equal(f.host.state().draft, null); assert.equal(f.host.state().editingId, "");
  assert.equal(f.reviseCalls.length, 1);
});

test("unconfirmed Save keeps its exact prepared request and never resubmits it through Save or Check", async () => {
  const f = fixture(); f.revise = async () => { throw Error("lost response"); };
  const request = f.draft.prepared.request; await f.save();
  assert.equal(f.draft.request, request); assert.equal(f.reviseCalls[0].request, request);
  assert.deepEqual(request, { expectedRevision: 3, expectedContentSha256: "c".repeat(64), model3dScale: {
    sourceMediaSha256: "a".repeat(64), factor: 2, resultMediaSha256: "b".repeat(64) } });
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.cancelCalls, 0);
  await f.save(); await f.save(true, { ...f.draft }); await f.save(true, f.draft, f.saveButton);
  assert.equal(f.reviseCalls.length, 1); assert.equal(f.checkCalls.length, 0);
  f.check = async () => { throw Error("lost check response"); }; await f.save(true);
  assert.equal(f.checkCalls.length, 1); assert.equal(f.checkCalls[0].request, request);
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.prepareCalls.length, 0); assert.equal(f.cancelCalls, 0);
});

function committed(f, request) {
  f.revision = 4; f.raw = "exact committed revision";
  const media = { url: "/api/media/scaled.glb", sha256: request.model3dScale.resultMediaSha256, byteLength: 4 };
  f.artifact = { ...f.artifact, mediaUrl: media.url, file: { url: media.url, sha256: media.sha256, fileSize: media.byteLength } };
  return { status: "saved", code: "saved", revision: 4, contentSha256: "d".repeat(64), model3dRevision: { media } };
}

test("exact current Save retires bytes and only an unchanged native focus origin can hand off focus", async t => {
  for (const moved of [false, true]) await t.test(moved ? "new focus intent" : "same focus origin", async () => {
    const f = fixture(), source = f.draft.bytes, derivative = f.draft.prepared.geometry.bytes;
    f.revise = async (_id, request) => { if (moved) f.document.activeElement = {}; return committed(f, request); };
    await f.save(); assert.equal(f.cancelCalls, 1); assert.equal(f.host.state().draft, null);
    assert.equal(f.host.state().notice.code, "saved"); assert.equal(f.focusCalls, moved ? 0 : 1);
    assert.deepEqual([...source], [0, 0, 0, 0]); assert.deepEqual([...derivative], [0, 0, 0, 0]);
    assert.equal(f.focusDisposals, 1); f.authorization = false; f.host.sync(); assert.equal(f.host.state().notice, null);
  });
});

test("saved replies cannot certify a different current GLB URL, hash, length, revision or item shape", async t => {
  for (const [name, mutate] of [
    ["root URL", f => { f.artifact.mediaUrl = "/api/media/other.glb"; }],
    ["file URL", f => { f.artifact.file.url = "/api/media/other.glb"; }],
    ["hash", f => { f.artifact.file.sha256 = "e".repeat(64); }],
    ["length", f => { f.artifact.file.fileSize = 5; }],
    ["revision", f => { f.revision = 5; }],
    ["items", f => { f.artifact.items = [{ id: "invented-item" }]; }],
  ]) await t.test(name, async () => {
    const f = fixture(); f.revise = async (_id, request) => { const result = committed(f, request); mutate(f); return result; };
    await f.save(); assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.cancelCalls, 0);
    assert.equal(f.host.state().notice, null); assert.equal(f.focusCalls, 0); assert.equal(f.reviseCalls.length, 1);
  });
});

test("a prepared local no-op retains the current file without issuing a PATCH or Check", async () => {
  const f = fixture(), source = f.draft.bytes;
  f.draft.factor = "1"; f.draft.prepared = prepared(f, 1, false); const derivative = f.draft.prepared.geometry.bytes;
  await f.save(); assert.equal(f.reviseCalls.length + f.checkCalls.length, 0); assert.equal(f.revision, 3);
  assert.equal(f.artifact.mediaUrl, "/api/media/original.glb"); assert.equal(f.host.state().notice.code, "unchanged");
  assert.equal(f.cancelCalls, 1); assert.deepEqual([...source], [0, 0, 0, 0]); assert.deepEqual([...derivative], [0, 0, 0, 0]);
});

test("late Save and retained view handlers cannot mutate a newer editing session", async () => {
  const f = fixture(), reply = deferred(), view = f.host.view(); f.revise = () => reply.promise;
  const saving = f.save(); assert.equal(f.reviseCalls.length, 1); await f.save(); assert.equal(f.reviseCalls.length, 1);
  f.host.retire(); const next = f.newDraft(); next.saving = true; f.host.install(next, true);
  view.onFactorInput({ currentTarget: f.input }); view.onCancel({ currentTarget: f.cancelButton });
  view.onSave({ currentTarget: f.saveButton }); view.onCheck({ currentTarget: f.checkButton });
  reply.resolve({ status: "saved", code: "saved", revision: 4, model3dRevision: { media: { url: "/api/media/scaled.glb", byteLength: 4 } } });
  await saving; assert.equal(f.host.state().draft, next); assert.equal(next.code, null); assert.equal(next.saving, true);
  assert.equal(f.host.state().saving, true); assert.equal(f.cancelCalls, 0); assert.equal(f.host.state().notice, null);
  assert.equal(f.focusCalls, 0); assert.deepEqual([...next.bytes], [11, 22, 33, 44]);
});

// Stream ports expose exact native Response/reader fields used by the complete
// production read method. They never invoke a socket or wait for a real timer.
function responsePort(f, chunks = [new Uint8Array([11, 22]), new Uint8Array([33, 44])], options = {}) {
  const state = { reads: 0, cancels: 0, bodyCancels: 0, releases: 0 };
  const reader = { read: async () => { const index = state.reads++; return index < chunks.length ? { done: false, value: chunks[index] } : { done: true }; },
    cancel: () => { state.cancels++; return options.cancel ?? Promise.resolve(); }, releaseLock: () => { state.releases++; } };
  const headers = new Map([["content-type", "model/gltf-binary"], ["content-length", "4"]]);
  const response = { status: 200, redirected: false, url: new URL(f.draft.mediaUrl, f.document.location.origin).href,
    headers: { get: name => headers.has(name) ? headers.get(name) : null },
    body: { getReader: () => reader, cancel: () => { state.bodyCancels++; return options.cancel ?? Promise.resolve(); } } };
  return { response, reader, state, headers };
}

test("private GLB read uses one exact current same-origin GET and checks the complete byte length", async () => {
  const f = fixture(), port = responsePort(f); f.fetch = async () => port.response;
  const result = await f.host.read(); assert.deepEqual([...result], [11, 22, 33, 44]);
  assert.equal(f.fetchCalls.length, 1); const call = f.fetchCalls[0];
  assert.equal(call.url, f.draft.mediaUrl); assert.equal(call.options.method, "GET");
  assert.equal(call.options.credentials, "same-origin"); assert.equal(call.options.redirect, "error"); assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.signal.aborted, true); assert.equal(port.state.releases, 1);
  assert.equal(port.state.cancels + port.state.bodyCancels, 0); assert.equal(f.timers.size, 0);
  assert.notEqual(result, f.draft.bytes); assert.deepEqual([...f.draft.bytes], [11, 22, 33, 44]);
  const stale = fixture(); stale.basis = false; await assert.rejects(stale.host.read(), /model3d_scale_retired/);
  assert.equal(stale.fetchCalls.length, 0);
});

test("private read refuses malformed location, bounds, MIME and stream size, cancelling without awaiting cancellation", async t => {
  for (const [name, edit] of [
    ["remote", f => { f.draft.mediaUrl = "https://example.invalid/model.glb"; }],
    ["query", f => { f.draft.mediaUrl += "?version=other"; }],
    ["oversize allocation", f => { f.draft.byteLength = maximumBytes + 1; }],
    ["fractional allocation", f => { f.draft.byteLength = 4.5; }],
  ]) await t.test(name, async () => { const f = fixture(); edit(f); await assert.rejects(f.host.read()); assert.equal(f.fetchCalls.length, 0); });
  for (const [name, edit, bodyOnly] of [
    ["wrong MIME", p => p.headers.set("content-type", "application/octet-stream"), true],
    ["redirect", p => { p.response.redirected = true; }, true],
    ["wrong response URL", p => { p.response.url += "?wrong"; }, true],
    ["header size", p => p.headers.set("content-length", "5"), true],
    ["noncanonical size", p => p.headers.set("content-length", "04"), true],
    ["oversize chunk", p => { p.reader.read = async () => ({ done: false, value: new Uint8Array(5) }); }, false],
    ["short body", p => { p.reader.read = async () => ({ done: true }); }, false],
    ["empty chunk", p => { p.reader.read = async () => ({ done: false, value: new Uint8Array() }); }, false],
  ]) await t.test(name, { timeout: 1000 }, async () => {
    const f = fixture(), cancel = deferred(), port = responsePort(f, undefined, { cancel: cancel.promise }); edit(port);
    f.fetch = async () => port.response; await assert.rejects(f.host.read(), /model3d_scale_(unavailable|size)/);
    assert.equal(port.state[bodyOnly ? "bodyCancels" : "cancels"], 1); assert.equal(f.timers.size, 0);
    assert.equal(f.fetchCalls[0].options.signal.aborted, true); cancel.resolve();
  });
});

test("the finite deadline releases hanging fetch or reader, and a late response body is cancelled", { timeout: 2000 }, async t => {
  for (const stage of ["fetch", "reader"]) await t.test(stage, async () => {
    const f = fixture(), pending = deferred(), cancellation = deferred(), port = responsePort(f, undefined, { cancel: cancellation.promise });
    if (stage === "fetch") f.fetch = () => pending.promise;
    else { f.fetch = async () => port.response; port.reader.read = () => pending.promise; }
    const read = f.host.read(); const rejected = assert.rejects(read, /model3d_scale_retired/); await flush();
    assert.equal(f.timers.size, 1); const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 30_000);
    f.now += timer.delay; timer.callback(); await rejected;
    assert.equal(f.timers.size, 0); assert.equal(f.fetchCalls[0].options.signal.aborted, true);
    if (stage === "fetch") { pending.resolve(port.response); await flush(); assert.equal(port.state.bodyCancels, 1); }
    else { assert.equal(port.state.cancels, 1); assert.equal(port.state.releases, 1); pending.resolve({ done: true }); }
    cancellation.resolve(); await flush(); assert.equal(f.draft.bytes.length, 4);
  });
});

// The one newly allocated Store method is extracted separately. Its actual
// response parsing runs against native Response/ReadableStream instances. No
// Store constructor, write observation, persistence or ACK validator is replaced
// and presented as real here: only this transport boundary is under test.
const storeUrl = new URL("../src/state/store.ts", import.meta.url);
const storeSyntax = ts.createSourceFile(storeUrl.pathname, readFileSync(storeUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const storeOwner = storeSyntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
assert.ok(storeOwner, "actual Store class");
const responseMethods = storeOwner.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(storeSyntax) === "#model3dScaleResponse");
assert.equal(responseMethods.length, 1);
assert.ok(responseMethods[0].modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
const responseCode = ts.transpileModule(`class Model3dResponseControl {
  constructor(f) { this.f = f; }
  guardedFetch(input, init, action, controls) { return this.f.guardedFetch(input, init, action, controls); }
  call(input = "/api/artifacts/model-a", init = { method: "GET" }, controls = { current: () => this.f.current }) {
    return this.#model3dScaleResponse(input, init, "finite response control", controls);
  }
  ${responseMethods[0].getText(storeSyntax)}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const responseFactory = new Function("setTimeout", "clearTimeout", "Date", responseCode + "\nreturn Model3dResponseControl;");
function storeResponseFixture() {
  const f = { current: true, now: 1000, timers: new Map(), calls: [], dispatches: 0 };
  f.fetch = async () => { throw Error("unexpected transport"); };
  f.guardedFetch = (input, init, action, controls) => {
    f.calls.push({ input, init, action, controls }); controls.onDispatch?.(); return f.fetch(input, init);
  };
  const Host = responseFactory((callback, delay) => { const token = {}; f.timers.set(token, { callback, delay }); return token; },
    token => f.timers.delete(token), { now: () => f.now });
  f.host = new Host(f);
  f.expire = () => {
    assert.equal(f.timers.size, 1); const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 90_000);
    f.now += timer.delay; timer.callback();
  };
  return f;
}
function pendingNativeResponse({ headerLength, cancellation = Promise.resolve() } = {}) {
  const state = { cancels: 0, pulls: 0 };
  const stream = new ReadableStream({ pull() { state.pulls++; }, cancel() { state.cancels++; return cancellation; } }, { highWaterMark: 0 });
  const headers = { "content-type": "application/json" };
  if (headerLength !== undefined) headers["content-length"] = String(headerLength);
  return { response: new Response(stream, { headers }), state };
}

test("Store response parses finite native JSON and refuses wrong UTF-8, envelope, length or MIME", async t => {
  const f = storeResponseFixture(), payload = { appended: [], content: { "content-a": "exact nested \"revision\"" }, head: 12, revision: 4 };
  const raw = JSON.stringify(payload), response = new Response(raw, { headers: {
    "content-type": "application/json; charset=utf-8", "content-length": String(new TextEncoder().encode(raw).byteLength) } });
  f.fetch = async () => response;
  const result = await f.host.call("/api/artifacts/model-a", { method: "PATCH", body: "exact request" },
    { current: () => f.current, onDispatch: () => { f.dispatches++; } });
  assert.equal(result.response, response); assert.deepEqual(result.result, payload); assert.equal(f.dispatches, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, "PATCH"); assert.equal(f.calls[0].init.body, "exact request");
  assert.equal(f.calls[0].init.redirect, "error"); assert.equal(f.calls[0].init.cache, "no-store");
  assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.timers.size, 0);
  for (const [name, bytes, headers] of [
    ["array envelope", "[]", {}], ["null envelope", "null", {}], ["broken JSON", "{", {}],
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28]), {}], ["wrong length", "{}", { "content-length": "3" }],
    ["wrong MIME", "{}", { "content-type": "text/plain" }],
  ]) await t.test(name, async () => {
    const current = storeResponseFixture(); current.fetch = async () => new Response(bytes, { headers: { "content-type": "application/json", ...headers } });
    await assert.rejects(current.host.call()); assert.equal(current.calls.length, 1); assert.equal(current.timers.size, 0);
  });
  const stale = storeResponseFixture(); stale.current = false; await assert.rejects(stale.host.call(), /model3d_scale_unconfirmed/);
  assert.equal(stale.calls.length, 0); assert.equal(stale.timers.size, 0);
});

test("Store's 90-second deadline retires native hanging fetch/body without awaiting their cancellation", { timeout: 2000 }, async t => {
  for (const stage of ["fetch", "body"]) await t.test(stage, async () => {
    const f = storeResponseFixture(), pending = deferred(), cancellation = deferred();
    const native = pendingNativeResponse({ cancellation: cancellation.promise });
    f.fetch = stage === "fetch" ? () => pending.promise : async () => native.response;
    const operation = f.host.call(), rejected = assert.rejects(operation, /model3d_scale_unconfirmed/); await flush();
    if (stage === "body") assert.equal(native.response.body.locked, true);
    f.expire(); await rejected;
    assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.timers.size, 0);
    if (stage === "fetch") { pending.resolve(native.response); await flush(); }
    assert.equal(native.state.cancels, 1); assert.equal(native.response.body.locked, false);
    cancellation.resolve(); await flush(); assert.equal(f.calls.length, 1);
  });
  const f = storeResponseFixture(), cancellation = deferred();
  const native = pendingNativeResponse({ headerLength: 8 * 1024 * 1024 + 1, cancellation: cancellation.promise });
  f.fetch = async () => native.response;
  await assert.rejects(f.host.call(), /model3d_scale_unconfirmed/);
  assert.equal(native.state.cancels, 1); assert.equal(native.state.pulls, 0, "oversized declared response is refused before reading");
  assert.equal(f.timers.size, 0); cancellation.resolve(); await flush();
});

test("bounded transport timeout reaches the host's uncertain Save and its explicit Check port never repeats PATCH", { timeout: 2000 }, async () => {
  const f = fixture(), transport = storeResponseFixture(), pendingSave = deferred(), pendingCheck = deferred();
  // Only the actual bounded response method is shared here. These two adapters
  // stand for Store Save/Check; no durable commit or fingerprint is claimed.
  f.revise = () => transport.host.call("/api/artifacts/model-a", { method: "PATCH" });
  f.check = () => transport.host.call("/api/artifacts/model-a?finite-check-port", { method: "GET" });
  transport.fetch = () => pendingSave.promise;
  const saving = f.save(); await flush(); transport.expire(); await saving;
  const request = f.draft.request; assert.equal(f.draft.code, "unconfirmed"); await f.save();
  assert.equal(transport.calls.length, 1); assert.equal(f.reviseCalls.length, 1);
  transport.fetch = () => pendingCheck.promise;
  const checking = f.save(true); await flush(); transport.expire(); await checking;
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.checkCalls[0].request, request);
  assert.deepEqual(transport.calls.map(call => call.init.method), ["PATCH", "GET"]); assert.equal(f.cancelCalls, 0);
  pendingSave.resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
  pendingCheck.resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
  await flush(); assert.equal(f.host.state().notice, null);
});

// Execute only the two passive source modules with real Lit TemplateResults.
// CSS has no runtime work here; no DOM renderer, private host or browser is loaded.
function passiveModule(relative, imports = {}) {
  const url = new URL(relative, import.meta.url), source = readFileSync(url, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const result = {};
  new Function("exports", "require", code)(result, specifier => {
    assert.ok(Object.hasOwn(imports, specifier), "exact passive import: " + specifier); return imports[specifier];
  });
  return result;
}
const copyModule = passiveModule("../src/components/design-system/locales/model3d-artifact-scale-messages.ts");
const renderer = passiveModule("../src/components/model3d-artifact-scale-editor.ts", { lit,
  "./design-system/locales/model3d-artifact-scale-messages.ts": copyModule, "./model3d-artifact-scale-editor.css": {} });
function templateText(value) {
  if (value === lit.nothing || value == null || typeof value === "function") return "";
  if (Array.isArray(value)) return value.map(templateText).join("");
  if (value?.strings && value?.values) return value.strings.reduce((text, chunk, index) => text + chunk + templateText(value.values[index]), "");
  return String(value);
}
function templateBindings(value, attribute) {
  if (!value?.strings || !value?.values) return [];
  return value.values.flatMap((entry, index) => [
    ...(value.strings[index].trimEnd().endsWith(attribute + "=") ? [entry] : []),
    ...templateBindings(entry, attribute),
  ]);
}

test("passive template retains invalid input, prevents unavailable Save, and exposes the same-operation Check state", () => {
  const f = fixture(); f.draft.factor = "-2"; f.draft.code = "invalid_scale"; f.draft.prepared = null;
  const invalid = f.host.view(), editor = renderer.renderModel3dArtifactScaleEditor(invalid), actions = renderer.renderModel3dArtifactScaleActions(invalid);
  assert.deepEqual(templateBindings(editor, ".value"), ["-2"]); assert.deepEqual(templateBindings(editor, "aria-invalid"), ["true"]);
  assert.deepEqual(templateBindings(editor, "?disabled"), [false]); assert.deepEqual(templateBindings(actions, "aria-disabled"), ["true"]);
  assert.ok(templateText(editor).includes(copyModule.model3dScaleCopy("en").status.invalid_scale));
  assert.doesNotMatch(templateText(editor), /<(?:button|model-viewer|video|audio|img)\b/u);
  f.draft.bytes = null; f.draft.beforeBounds = null; f.draft.code = "unavailable";
  const absent = f.host.view();
  assert.doesNotMatch(templateText(renderer.renderModel3dArtifactScaleEditor(absent)), /<input\b/u);
  assert.deepEqual(templateBindings(renderer.renderModel3dArtifactScaleActions(absent), "aria-disabled"), ["true"]);
  const uncertain = { ...invalid, code: "unconfirmed" }, uncertainEditor = renderer.renderModel3dArtifactScaleEditor(uncertain);
  const uncertainActions = renderer.renderModel3dArtifactScaleActions(uncertain);
  assert.deepEqual(templateBindings(uncertainEditor, "?disabled"), [true]);
  assert.deepEqual(templateBindings(uncertainActions, "aria-disabled"), ["true", "false"]);
  assert.ok(templateText(uncertainActions).includes(copyModule.model3dScaleCopy("en").check));
  const checking = renderer.renderModel3dArtifactScaleActions({ ...uncertain, checking: true });
  assert.deepEqual(templateBindings(checking, "aria-disabled"), ["true", "true"]);
  assert.deepEqual(templateBindings(checking, "?disabled"), [true]);
  assert.deepEqual(templateBindings(actions, "@click"), [invalid.onSave, invalid.onCancel]);
});

test("the four locale templates expose original preservation, fresh review, raw dimensions and auto-fit guidance", () => {
  const f = fixture();
  for (const locale of ["en-US", "fr-FR", "ar", "ja-JP"]) {
    const copy = copyModule.model3dScaleCopy(locale), view = { ...f.host.view(), locale };
    const editor = renderer.renderModel3dArtifactScaleEditor(view), actions = renderer.renderModel3dArtifactScaleActions(view);
    const text = templateText(editor);
    for (const phrase of [copy.title, copy.help, copy.factor, copy.currentDimensions, copy.proposedDimensions,
      copy.units, copy.autoFit, copy.originalNotes]) assert.ok(text.includes(phrase), locale + ": " + phrase);
    assert.ok(text.includes(new Intl.NumberFormat(locale, { maximumSignificantDigits: 9 }).format(2)));
    assert.equal((text.match(/dir="ltr"/gu) ?? []).length, 2, "dimension axes keep their physical reading order");
    assert.deepEqual(templateBindings(actions, "aria-disabled"), ["false"]);
    assert.ok(templateText(actions).includes(copy.save)); assert.ok(templateText(actions).includes(copy.cancel));
    const notice = templateText(renderer.renderModel3dArtifactScaleEditor({ ...view, code: "unconfirmed" }));
    assert.ok(notice.includes(copy.status.unconfirmed));
    if (locale !== "en-US") {
      assert.notEqual(copy.originalNotes, copyModule.model3dScaleCopy("en").originalNotes);
      assert.notEqual(copy.status.unconfirmed, copyModule.model3dScaleCopy("en").status.unconfirmed);
    }
  }
  const en = copyModule.model3dScaleCopy("en");
  assert.match(en.originalNotes, /Original files are preserved.*Request a new review/u);
  assert.match(en.autoFit, /on-screen size may look unchanged/u);
  assert.match(en.status.unconfirmed, /will not be retried automatically.*without saving again/u);
});
