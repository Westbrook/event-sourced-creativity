import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { html, nothing } from "lit";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { png } from "./output-asset-fixtures.mjs";

// Retained Video UI source-extraction and native-template ports. Execute every
// actual new host method, with public test wrappers for its private state only.
// Compositor completion is an authored PNG port, not native raster evidence.
// No full-page/Store/Worker fixture, browser, provider or old suite is invoked.
const edit = await import("../src/model/generated-image-edit.ts");
const revision = await import("../src/model/generated-image-revision.ts");
const composition = await import("../src/model/reference-composition.ts");
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const { outputAssetSha256 } = await import("../src/model/output-asset-inspection.ts");
const { generatedImageEditCopy } = await import("../src/components/design-system/locales/generated-image-edit-messages.ts");
const sourceUrl = new URL("../src/components/generated-image-editor.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8"), tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owners = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "GeneratedImageEditor");
assert.equal(owners.length, 1);
const owner = owners[0], helpers = tree.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node));
assert.deepEqual(helpers.filter(ts.isFunctionDeclaration).map(node => node.name.text), ["privateBytes", "cancelRead", "sourcePng", "capturedPng"]);
assert.deepEqual(helpers.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations.map(value => value.name.getText(tree))),
  ["arrayPrototype", "arrayLength", "arrayBuffer", "blobSize", "blobType"]);
const wrappers = `
  editorStateForTest() { return { phase:this.#phase, snapshot:this.#snapshot, captured:this.#captured, recipe:this.#recipe,
    prepared:this.#prepared, original:this.#original, upload:this.#upload, previewUrl:this.#previewUrl,
    previewReady:this.#previewReady, pending:this.#pending, busy:this.#busy, lease:this.#lease }; }
  captureForTest(detail) { return this.#capture({target:this.querySelector('forma-reference-compositor'),detail,stopPropagation(){}}); }
  saveForTest() { return this.#save(); } checkForTest() { return this.#check(); }
  closeForTest(reason='cancel') { return this.#close(reason); } backForTest() { return this.#back(); }
  previewLoadedForTest(event) { return this.#previewLoaded(event); }
  closeIntentForTest(event) { return this.#compositorCloseIntent(event); }
`;
const actualClass = owner.getText(tree).replace(/^export\s+/u, "");
const code = ts.transpileModule(helpers.map(node => node.getText(tree)).join("\n") + "\n"
  + actualClass.slice(0, -1) + wrappers + "\n}", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const dependencies = ["html", "nothing", "FormaElement", "icon", "ensureModalDialog", "ReferenceCompositor", "generatedImageEditCopy",
  "GENERATED_IMAGE_EDIT_LIMITS", "prepareGeneratedImageEdit", "generatedImageOwnedMediaUrl", "generatedImageEditOperationSha256",
  "parseGeneratedImageEditRequest", "parseGeneratedImageRevision", "outputAssetSha256", "addReferenceCompositionLayer",
  "createReferenceComposition", "normalizeReferenceComposition", "Blob", "URL", "fetch", "Element", "HTMLButtonElement", "setTimeout", "clearTimeout"];
const factory = new Function(...dependencies, code + "\nreturn {GeneratedImageEditor,sourcePng};");
const digest = value => createHash("sha256").update(value).digest("hex");
const originalPng = png({ width: 24, height: 24 }), editedPng = png({ width: 1536, height: 864 });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(check, message) { for (let index = 0; index < 100 && !check(); index++) await new Promise(setImmediate); assert.ok(check(), message); }

function fixture(t, { adopted = true, locale = "en", extraSources = 0 } = {}) {
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false, frames: new Map(), timers: new Map(),
    resizeTargets: new Map(), storage: new Map(), locale, tick: async () => true, timerSequence: 0,
    readCalls: 0, captureCalls: [], adoptCalls: 0, saveCalls: [], checkCalls: [], fetchCalls: [], closeEvents: [],
    preparedInputs: [], preparedResults: [], blobs: new Map(), revoked: [], mutations: [], adopted,
    openingCurrent: true, basisCurrent: true, fetchOverride: null, onPrepare: null };
  f.i18n = { locale, direction: locale === "ar" ? "rtl" : "ltr",
    number(value) { return new Intl.NumberFormat(locale, { useGrouping: false }).format(value); } };
  f.store = { subscribe() { throw new Error("A source-only base port cannot subscribe a real Store"); } };
  ports.bindFixture(f);
  f.document = ports.documentPort; f.document.activeElement = null;
  const context = { ownerId: "image-owner", projectId: "image-project", documentId: "image-document", outputId: "image-output" };
  const mediaUrl = "/api/media/" + encodeURIComponent(ownerMediaNamespace(context.ownerId) + "/generated/image-generation.png");
  const raw = '{ "title": "Original Café 雨", "extension": {"kept": true} }\n';
  const media = { url: mediaUrl, mediaType: "image/png", sha256: digest(originalPng), width: 24, height: 24 };
  const basis = Object.freeze({ kind: "generated-image", ownerId: context.ownerId, documentId: context.documentId, outputId: context.outputId,
    generationId: "image-generation", sourceEventId: "original-generation-event", contentRef: "private-image", revision: 0,
    rawJson: raw, contentSha256: digest(raw), media: Object.freeze(media) });
  const sources = Object.freeze([Object.freeze({ id: "image-reference:image", blockId: "image-reference", label: "Original image",
    mediaUrl, contentHash: media.sha256, kind: "image" }), ...Array.from({ length: extraSources }, (_, index) => Object.freeze({
      id: "other-reference-" + index + ":image", blockId: "other-reference-" + index, label: "Another available reference " + index,
      mediaUrl, contentHash: media.sha256, kind: "image" }))]);
  f.basis = basis; f.sources = sources;
  f.captured = Object.freeze({ status: "captured", sourceId: sources[0].id, editEventId: null, basis, sources,
    current: () => f.basisCurrent ? { basis, sources } : null });
  f.snapshot = () => ({ status: "current", ...context, generationId: basis.generationId, sourceEventId: basis.sourceEventId,
    contentRef: basis.contentRef, contentSha256: basis.contentSha256, rawJson: raw, revision: 0, editEventId: null,
    media: { ...media, byteLength: originalPng.length }, sources: f.adopted ? structuredClone(sources) : [], sourceIds: f.adopted ? [sources[0].id] : [], head: 5 });
  f.read = async () => f.snapshot();
  f.capture = async () => f.captured;
  f.save = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.check = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.opening = Object.freeze({ token: Object.freeze({}), ...context, current: () => f.openingCurrent,
    read: () => { f.readCalls++; return f.read(); },
    capture: sourceId => { f.captureCalls.push(sourceId); return f.capture(sourceId); },
    adopt: async () => { f.adoptCalls++; f.mutations.push("explicit-context-adoption"); f.adopted = true; return true; },
    save: (request, bytes) => { f.saveCalls.push({ request: structuredClone(request), privateBytes: bytes, snapshot: new Uint8Array(bytes) }); return f.save(request, bytes); },
    check: operation => { f.checkCalls.push(operation); return f.check(operation); } });
  class ButtonPort {
    static [Symbol.hasInstance](value) { return value instanceof ports.ElementPort && value.tag === "button"; }
  }
  // The existing compositor is a declared leaf completion port here. The host's
  // exact event-target, disabled, owner-dialog and native close guards remain actual.
  class CompositorPort extends ports.ElementPort {
    disabled = false;
    constructor() {
      super();
      const node = tag => { const value = new ports.ElementPort(); value.tag = tag; value.isConnected = true; value.attributes = {};
        value.parentElement = this; value.disabled = false; value.closest = selector => selector === "button" && tag === "button" ? value : null; return value; };
      this.dialog = node("dialog"); this.dialog.open = true;
      this.closeButton = node("button"); this.cancelButton = node("button"); this.otherButton = node("button");
      this.closeButton.parentElement = this.dialog; this.cancelButton.parentElement = this.dialog; this.otherButton.parentElement = this.dialog;
    }
    render() { return nothing; }
    querySelector(selector) {
      if (selector === ":scope > dialog.reference-compositor") return this.dialog;
      if (selector === ":scope > dialog > .reference-compositor-card > button.modal-close") return this.closeButton;
      if (selector === ":scope > dialog > .reference-compositor-card > footer > div > button.button.ghost:first-child") return this.cancelButton;
      return null;
    }
  }
  const setTimer = (callback, delay) => { const id = ++f.timerSequence; f.timers.set(id, { callback, delay }); return id; };
  const clearTimer = id => f.timers.delete(id);
  const urlPort = { createObjectURL(blob) { assert.ok(blob instanceof Blob); const url = "blob:generated-image-fixture-" + (f.blobs.size + 1); f.blobs.set(url, blob); return url; },
    revokeObjectURL(url) { f.revoked.push(url); f.blobs.delete(url); } };
  const fetchPort = (url, init) => { f.fetchCalls.push({ url, init }); assert.equal(url, mediaUrl);
    assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    return f.fetchOverride ? f.fetchOverride(url, init) : Promise.resolve(new Response(new Uint8Array(originalPng), {
      headers: { "content-type": "image/png", "content-length": String(originalPng.length) } })); };
  const prepare = (...args) => {
    f.preparedInputs.push(args[0]); const pending = edit.prepareGeneratedImageEdit(...args); f.onPrepare?.(args[0]);
    return pending.then(value => { f.preparedResults.push(value); return value; });
  };
  const runtime = factory(html, nothing, ports.ElementPort, () => nothing, ports.modalPort.ensureModalDialog, CompositorPort, generatedImageEditCopy,
    edit.GENERATED_IMAGE_EDIT_LIMITS, prepare, revision.generatedImageOwnedMediaUrl, revision.generatedImageEditOperationSha256,
    revision.parseGeneratedImageEditRequest, revision.parseGeneratedImageRevision, outputAssetSha256,
    composition.addReferenceCompositionLayer, composition.createReferenceComposition, composition.normalizeReferenceComposition,
    Blob, urlPort, fetchPort, ports.ElementPort, ButtonPort, setTimer, clearTimer);
  f.host = new runtime.GeneratedImageEditor(); f.host.tag = "forma-generated-image-editor"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, { "forma-reference-compositor": CompositorPort });
  f.host.eventBindings = { "generated-image-editor-close"(event) {
    f.closeEvents.push({ ...event.detail, active: f.document.activeElement, connected: f.document.activeElement?.isConnected,
      owned: f.host.contains(f.document.activeElement), phase: f.host.editorStateForTest().phase });
  } };
  f.state = () => f.host.editorStateForTest();
  f.draw = () => { ports.bindFixture(f); f.renderer.draw(f.host); return fullPageTree(f); };
  f.open = async () => { f.host.opening = f.opening; f.changed = new Map([["opening", null]]); f.draw();
    await until(() => f.state().phase !== "loading", "initial read/capture finished"); return f.draw(); };
  f.button = label => f.renderer.nodes.find(node => node.owner === f.host && node.tag === "button"
    && (node.attributes["aria-label"] === label || fullPageTree(f).nodes.find(value => value.port === node)?.text === label));
  f.click = node => { assert.ok(node); assert.equal(Object.hasOwn(node.attributes, "disabled"), false); f.document.activeElement = node;
    node.handlers.click({ type: "click", target: node, currentTarget: node }); };
  f.preparePreview = async () => {
    if (f.state().phase === "closed") await f.open();
    assert.equal(f.state().phase, "editing");
    await f.host.captureForTest({ blob: new Blob([new Uint8Array(editedPng)], { type: "image/png" }), recipe: structuredClone(f.state().recipe), label: "Explicit synthetic completion" });
    assert.equal(f.state().phase, "preview"); f.draw(); return f.renderer.nodes.find(node => node.tag === "img" && node.owner === f.host);
  };
  f.readyPreview = async () => { const image = await f.preparePreview();
    Object.assign(image, { complete: true, currentSrc: f.state().previewUrl, naturalWidth: 1536, naturalHeight: 864 });
    image.handlers.load({ type: "load", currentTarget: image, target: image }); assert.equal(f.state().previewReady, true); return image; };
  f.savedAck = async () => {
    const pending = f.state().pending; assert.ok(pending); const request = pending.request;
    return { status: "saved", code: "saved", operationSha256: pending.operationSha256, stillCurrent: true, currentRevision: 1, currentEditEventId: "image-edit-event-1",
      imageRevision: { schemaVersion: 1, operation: "composition", revision: 1, editEventId: "image-edit-event-1", outputId: context.outputId,
        documentId: context.documentId, generationId: request.generationId, sourceEventId: request.sourceEventId, contentRef: request.contentRef,
        contentSha256: request.expectedContentSha256, source: { revision: request.expectedRevision, eventId: request.expectedEditEventId ?? request.sourceEventId,
          mediaUrl: request.sourceMediaUrl, sha256: request.sourceMediaSha256, width: 24, height: 24 },
        media: { url: "/api/media/" + encodeURIComponent(ownerMediaNamespace(context.ownerId) + "/generated/image-edit-019928d0-0b30-7000-8000-000000000001.png"),
          mediaType: "image/png", sha256: request.resultMediaSha256, byteLength: request.resultByteLength, width: 1536, height: 864 },
        sourceId: request.sourceId, recipe: structuredClone(request.recipe), recipeSha256: await outputAssetSha256(new TextEncoder().encode(JSON.stringify(request.recipe))), operationSha256: pending.operationSha256 } };
  };
  f.sourcePng = runtime.sourcePng;
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); f.timers.clear(); ports.bindFixture(null); });
  return f;
}

test("opening an adopted image and cancelling only reads current facts", async t => {
  const f = fixture(t); await f.open();
  assert.equal(f.state().phase, "editing"); assert.equal(f.readCalls, 1); assert.deepEqual(f.captureCalls, [f.sources[0].id]);
  assert.deepEqual(f.mutations, []); assert.equal(f.adoptCalls, 0); assert.equal(f.saveCalls.length, 0); assert.equal(f.fetchCalls.length, 0);
  f.host.closeForTest(); assert.equal(f.state().phase, "closed"); assert.deepEqual(f.mutations, []);
  assert.equal(f.closeEvents[0].opening, f.opening); assert.equal(f.closeEvents[0].reason, "cancel");
  assert.equal(f.trace.some(value => value.startsWith("focus:")), false);
});

test("missing association requires the actual explicit adoption control; the adopted input survives Cancel", async t => {
  const f = fixture(t, { adopted: false }), tree = await f.open(), copy = generatedImageEditCopy("en");
  assert.equal(f.state().phase, "adoption"); assert.ok(tree.root.text.includes(copy.adoption)); assert.ok(tree.root.text.includes(copy.adoptionRemains));
  assert.equal(f.adoptCalls, 0); assert.equal(f.captureCalls.length, 0); assert.equal(f.saveCalls.length, 0);
  const control = tree.visible("button").find(node => node.text === copy.adopt); assert.ok(control?.port); f.click(control.port);
  await until(() => f.state().phase === "editing", "explicit adoption rejoins the current image"); f.draw();
  assert.equal(f.adoptCalls, 1); assert.deepEqual(f.mutations, ["explicit-context-adoption"]);
  f.host.closeForTest(); assert.equal(f.adopted, true); assert.deepEqual(f.mutations, ["explicit-context-adoption"]); assert.equal(f.saveCalls.length, 0);
});

test("late opening reads cannot replace or retire a newer opening", async t => {
  const f = fixture(t), old = deferred(); f.read = () => old.promise;
  f.host.opening = f.opening; f.changed = new Map([["opening", null]]); f.draw();
  const previous = f.opening; f.host.closeForTest(); f.read = async () => f.snapshot();
  f.opening = Object.freeze({ ...previous, token: Object.freeze({}) }); await f.open(); const captured = f.state().captured;
  old.resolve(null); await new Promise(setImmediate); f.draw();
  assert.equal(f.state().phase, "editing"); assert.equal(f.state().captured, captured); assert.equal(f.state().lease.opening, f.opening);
  assert.equal(f.closeEvents.some(value => value.opening === f.opening), false);
});

test("GET snapshot and captured edit identity must agree before the compositor opens", async t => {
  const f = fixture(t), original = f.snapshot;
  f.snapshot = () => ({ ...original(), editEventId: "unrelated-current-edit" }); await f.open();
  assert.equal(f.state().phase, "closed"); assert.equal(f.closeEvents[0].reason, "retired"); assert.equal(f.fetchCalls.length, 0);
});

test("actual preparation retains only recipe-used sources, verifies the source PNG and owns a separate preview", async t => {
  const f = fixture(t, { extraSources: 13 }); await f.preparePreview();
  assert.equal(f.preparedResults[0].status, "prepared"); assert.equal(f.fetchCalls.length, 1);
  assert.equal(f.sources.length, 14); assert.equal(f.preparedInputs[0].sourceId, f.sources[0].id);
  assert.deepEqual(f.preparedInputs[0].sources, [f.sources[0]], "the core receives only recipe-used sources, even with more than twelve available");
  assert.ok(f.preparedInputs[0].originalPng.every(value => value === 0)); assert.ok(f.preparedInputs[0].editedPng.every(value => value === 0));
  assert.equal(f.state().original, null); assert.equal(f.state().previewReady, false);
  const blob = f.blobs.get(f.state().previewUrl); assert.ok(blob instanceof Blob); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), editedPng);
  const tree = fullPageTree(f); assert.equal(tree.visible("img").length, 1); assert.ok(tree.root.text.includes(generatedImageEditCopy("en").previewHelp));
  assert.equal(f.saveCalls.length, 0); assert.equal(f.adoptCalls, 0);
});

test("the native preview gate requires the exact connected, complete current image and both URL witnesses", async t => {
  const f = fixture(t), image = await f.preparePreview();
  Object.assign(image, { complete: true, currentSrc: f.state().previewUrl, naturalWidth: 1536, naturalHeight: 864 });
  const foreign = Object.assign(Object.create(Object.getPrototypeOf(image)), image);
  f.host.previewLoadedForTest({ currentTarget: foreign }); assert.equal(f.state().previewReady, false);
  for (const [key, value] of [["isConnected", false], ["complete", false], ["currentSrc", "blob:foreign"]]) {
    const before = image[key]; image[key] = value; f.host.previewLoadedForTest({ currentTarget: image });
    assert.equal(f.state().previewReady, false, key); image[key] = before;
  }
  const url = image.attributes.src; image.attributes.src = "blob:foreign";
  f.host.previewLoadedForTest({ currentTarget: image }); assert.equal(f.state().previewReady, false); image.attributes.src = url;
  await f.host.saveForTest(); assert.equal(f.saveCalls.length, 0, "unready image cannot initiate Save");
  f.host.previewLoadedForTest({ currentTarget: image }); assert.equal(f.state().previewReady, true);
  image.naturalHeight = 863; f.host.previewLoadedForTest({ currentTarget: image });
  assert.equal(f.state().previewReady, false); assert.equal(f.state().phase, "error"); await f.host.saveForTest(); assert.equal(f.saveCalls.length, 0);
});

test("Back to edit retires preview bytes and URL while preserving the authored composition", async t => {
  const f = fixture(t); await f.readyPreview(); const before = f.state(), recipe = structuredClone(before.recipe), url = before.previewUrl;
  f.host.backForTest(); assert.equal(f.state().phase, "editing"); assert.deepEqual(f.state().recipe, recipe);
  assert.equal(before.prepared.copyPng(), null); assert.equal(f.state().prepared, null); assert.equal(f.state().previewUrl, "");
  assert.deepEqual(f.revoked, [url]); assert.equal(f.saveCalls.length, 0);
});

for (const boundary of ["current source", "opening authorization", "disconnect"]) test("private preview retirement is focus-inert on " + boundary, async t => {
  const f = fixture(t); await f.readyPreview(); const before = f.state();
  if (boundary === "current source") { f.basisCurrent = false; f.draw(); }
  else if (boundary === "opening authorization") { f.openingCurrent = false; f.draw(); }
  else { f.host.isConnected = false; f.host.disconnectedCallback(); }
  assert.equal(f.state().phase, "closed"); assert.equal(before.prepared.copyPng(), null); assert.ok(f.revoked.includes(before.previewUrl));
  assert.equal(f.state().snapshot, null); assert.equal(f.state().captured, null); assert.equal(f.state().pending, null);
  assert.equal(f.trace.some(value => value.startsWith("focus:")), false); assert.equal(f.saveCalls.length, 0);
  if (boundary !== "disconnect") assert.equal(f.closeEvents.at(-1).reason, "retired");
});

test("source loss during the actual preparation await clears its original and edited inputs", async t => {
  const f = fixture(t); await f.open(); f.onPrepare = () => { f.basisCurrent = false; };
  await f.host.captureForTest({ blob: new Blob([new Uint8Array(editedPng)], { type: "image/png" }), recipe: structuredClone(f.state().recipe), label: "Synthetic completion" });
  assert.equal(f.state().phase, "closed"); assert.equal(f.preparedResults[0].status, "refused");
  for (const input of f.preparedInputs) { assert.ok(input.originalPng.every(value => value === 0)); assert.ok(input.editedPng.every(value => value === 0)); }
  assert.equal(f.blobs.size, 0); assert.equal(f.saveCalls.length, 0);
});

test("Save uncertainty retains only the exact operation, and Check never uploads a second PNG", async t => {
  const f = fixture(t); await f.readyPreview(); const before = f.state(); await f.host.saveForTest();
  assert.equal(f.state().phase, "unconfirmed"); assert.equal(f.saveCalls.length, 1);
  const pending = f.state().pending; assert.deepEqual(Object.keys(pending).sort(), ["operationSha256", "request"]);
  assert.equal(pending.operationSha256, await revision.generatedImageEditOperationSha256({ ownerId: f.opening.ownerId, projectId: f.opening.projectId,
    documentId: f.opening.documentId, outputId: f.opening.outputId }, pending.request));
  assert.deepEqual(f.saveCalls[0].snapshot, editedPng); assert.ok(f.saveCalls[0].privateBytes.every(value => value === 0));
  assert.equal(before.prepared.copyPng(), null); assert.equal(f.state().snapshot, null); assert.equal(f.state().captured, null);
  assert.equal(f.state().prepared, null); assert.equal(f.state().recipe, null); assert.equal(f.state().original, null); assert.equal(f.state().previewUrl, "");
  const tree = f.draw(); assert.ok(tree.root.text.includes(generatedImageEditCopy("en").unconfirmed));
  assert.equal(tree.visible("button").some(node => node.text === generatedImageEditCopy("en").save), false);
  await f.host.saveForTest(); assert.equal(f.saveCalls.length, 1);
  await f.host.checkForTest(); assert.equal(f.state().pending, pending); assert.deepEqual(f.checkCalls, [pending.operationSha256]);
  f.check = () => f.savedAck(); f.basisCurrent = false; await f.host.checkForTest();
  assert.equal(f.state().phase, "saved"); assert.equal(f.state().pending, null); assert.equal(f.saveCalls.length, 1);
  assert.deepEqual(f.checkCalls, [pending.operationSha256, pending.operationSha256]); assert.equal(f.fetchCalls.length, 1);
});

test("a verified own Save may publish new media before its promise settles without retiring this opening", async t => {
  const f = fixture(t); await f.readyPreview(); const reply = deferred(); f.save = () => reply.promise;
  const saving = f.host.saveForTest(); await until(() => f.saveCalls.length === 1, "one Save entered the owning port");
  f.basisCurrent = false; f.draw(); assert.equal(f.state().phase, "saving"); assert.equal(f.state().captured, null);
  reply.resolve(await f.savedAck()); await saving;
  assert.equal(f.state().phase, "saved"); assert.equal(f.closeEvents.length, 0); assert.equal(f.saveCalls.length, 1);
});

test("wrong operation/source/result ACKs remain uncertain and an older valid receipt is never displayed as saved", async t => {
  const f = fixture(t); await f.readyPreview(); await f.host.saveForTest(); const pending = f.state().pending;
  for (const change of [
    value => { value.operationSha256 = "a".repeat(64); }, value => { value.imageRevision.outputId = "foreign-output"; },
    value => { value.imageRevision.sourceEventId = "foreign-origin"; }, value => { value.imageRevision.media.sha256 = "d".repeat(64); },
    value => { value.imageRevision.recipeSha256 = "d".repeat(64); },
  ]) {
    f.check = async () => { const ack = await f.savedAck(); change(ack); return ack; }; await f.host.checkForTest();
    assert.equal(f.state().phase, "unconfirmed"); assert.equal(f.state().pending, pending);
  }
  f.check = async () => ({ ...await f.savedAck(), stillCurrent: false, currentRevision: 2, currentEditEventId: "later-edit" });
  await f.host.checkForTest(); assert.equal(f.state().phase, "error"); assert.equal(f.state().pending, null);
  assert.ok(f.draw().root.text.includes(generatedImageEditCopy("en").source_changed)); assert.equal(f.saveCalls.length, 1);
});

test("an old Save reply cannot clear or complete a new opening", async t => {
  const f = fixture(t); await f.readyPreview(); const reply = deferred(); f.save = () => reply.promise;
  const saving = f.host.saveForTest(); await until(() => f.saveCalls.length === 1, "old Save started"); const ack = await f.savedAck();
  const previous = f.opening; f.host.opening = null; f.changed = new Map([["opening", previous]]); f.draw();
  assert.ok(f.saveCalls[0].privateBytes.every(value => value === 0));
  f.opening = Object.freeze({ ...previous, token: Object.freeze({}) }); await f.open(); const captured = f.state().captured;
  reply.resolve(ack); await saving; assert.equal(f.state().phase, "editing"); assert.equal(f.state().captured, captured);
  assert.equal(f.state().pending, null); assert.equal(f.closeEvents.some(value => value.opening === f.opening), false);
});

for (const intent of ["close", "cancel button", "backdrop", "native cancel"]) test("explicit compositor " + intent + " reaches its owner before focused content is removed", async t => {
  const f = fixture(t); await f.open(); const compositor = f.host.querySelector("forma-reference-compositor");
  const target = intent === "close" ? compositor.closeButton : intent === "cancel button" ? compositor.cancelButton : compositor.dialog;
  f.document.activeElement = compositor.cancelButton; let stopped = false, prevented = false;
  f.host.closeIntentForTest({ type: intent === "native cancel" ? "cancel" : "click", target,
    preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(prevented, true); assert.equal(f.state().phase, "closed"); assert.equal(f.closeEvents.length, 1);
  assert.equal(f.closeEvents[0].active, compositor.cancelButton); assert.equal(f.closeEvents[0].owned, true); assert.equal(f.closeEvents[0].connected, true);
  assert.equal(f.closeEvents[0].phase, "editing"); assert.equal(f.closeEvents[0].opening, f.opening);
  assert.equal(f.trace.some(value => value.startsWith("focus:")), false);
});

test("foreign, disabled and unrelated compositor events cannot claim an explicit close", async t => {
  const f = fixture(t); await f.open(); const compositor = f.host.querySelector("forma-reference-compositor");
  const event = target => ({ type: "click", target, preventDefault() { throw new Error("unowned event prevented"); }, stopImmediatePropagation() { throw new Error("unowned event stopped"); } });
  f.document.activeElement = compositor.cancelButton; f.host.closeIntentForTest(event(compositor.otherButton));
  compositor.disabled = true; f.host.closeIntentForTest(event(compositor.closeButton)); compositor.disabled = false;
  compositor.closeButton.disabled = true; f.host.closeIntentForTest(event(compositor.closeButton)); compositor.closeButton.disabled = false;
  f.document.activeElement = f.document.body; f.host.closeIntentForTest(event(compositor.closeButton));
  f.document.activeElement = compositor.cancelButton; compositor.dialog.open = false; f.host.closeIntentForTest(event(compositor.cancelButton));
  assert.equal(f.closeEvents.length, 0); assert.equal(f.state().phase, "editing");
});

test("the source-read deadline settles without waiting for an uncooperative cancellation", async t => {
  const f = fixture(t), cancellation = deferred(); let cancelled = 0;
  f.fetchOverride = async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled++; return cancellation.promise; } }), { headers: { "content-type": "image/png" } });
  const controller = new AbortController(); let settled = false;
  const reading = f.sourcePng(f.basis.media.url, controller, () => true).then(() => { throw new Error("stalled source read unexpectedly completed"); }, error => { settled = true; return error; });
  await until(() => f.fetchCalls.length === 1, "finite source read started"); await new Promise(setImmediate);
  const deadline = [...f.timers].find(([, value]) => value.delay === 15_000); assert.ok(deadline); deadline[1].callback();
  await until(() => settled, "deadline settles independently of stream cancellation"); assert.equal((await reading).name, "AbortError");
  assert.equal(cancelled, 1); assert.equal(controller.signal.aborted, true);
  const observation = [...f.timers].find(([, value]) => value.delay === 1000); assert.ok(observation); observation[1].callback();
  cancellation.resolve(); await new Promise(setImmediate); assert.equal(f.saveCalls.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("owned dialogs use complete " + locale + " disclosures and native non-submit actions", async t => {
  const f = fixture(t, { adopted: false, locale }), tree = await f.open(), copy = generatedImageEditCopy(locale);
  const dialog = tree.visible("dialog")[0]; assert.equal(dialog.attributes.lang, locale); assert.equal(dialog.attributes.dir, locale === "ar" ? "rtl" : "ltr");
  for (const text of [copy.title, copy.help, copy.adoption, copy.adoptionRemains, copy.adopt, copy.cancel]) assert.ok(tree.root.text.includes(text), text);
  assert.equal(tree.visible("form").length, 0); for (const button of tree.visible("button")) assert.equal(button.attributes.type, "button");
  assert.ok(tree.visible("p").some(node => node.attributes.role === "status" && node.attributes["aria-live"] === "polite"));
  assert.equal(f.mutations.length, 0); assert.equal(f.saveCalls.length, 0);
});

// Actual Store caller slice, using the same retained Video AST extraction pattern.
// Capture, admission and HTTP are finite ports; receipt matching, source ownership,
// byte inspection, operation identity, revision validation and control flow are real.
// This adds no Worker, D1, native compositor or network-transport acceptance.
const { inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts");
const imageStoreUrl = new URL("../src/state/store.ts", import.meta.url);
const imageStoreTree = ts.createSourceFile(imageStoreUrl.pathname, readFileSync(imageStoreUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const imageStoreOwners = imageStoreTree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
assert.equal(imageStoreOwners.length, 1);
const imageStoreNames = ["#requestedEventObserved", "#matchedRequestedWrites", "#validateEventWriteBody", "#generatedImageOwner",
  "#generatedImageSourceCurrent", "#validatedGeneratedImageSave", "reviseGeneratedImage", "checkGeneratedImageEdit"];
const imageStoreMethods = imageStoreNames.map(name => {
  const matches = imageStoreOwners[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(imageStoreTree) === name);
  assert.equal(matches.length, 1, `one actual Store ${name}`); return matches[0].getText(imageStoreTree);
});
const imageStoreFlight = imageStoreOwners[0].members.filter(node => ts.isPropertyDeclaration(node) && node.name.getText(imageStoreTree) === "#generatedImageWrites");
assert.equal(imageStoreFlight.length, 1);
const imageStoreCode = ts.transpileModule(`class ImageStoreControl {
  #eventWriteObservations; #cachedHistoryRevalidation=false;
  ${imageStoreFlight[0].getText(imageStoreTree)}
  constructor(f) {
    this.f=f;this.#eventWriteObservations=new Map(f.retained?[["image-observation",f.observation]]:[]);
    this.projection={get:()=>f.projection};this.route={get:()=>f.route};this.session={get:()=>f.session};
    this.events={get:()=>f.events};this.content={get:()=>f.content};this.head={get:()=>5};this.asOf={get:()=>f.asOf};
  }
  captureSourceOwnership(){return this.f.source;}
  captureAuthorizationScope(){return this.f.authorization;}
  sourceOwnershipActive(source){return this.f.sourceActive&&source===this.f.source;}
  authorizationScopeActive(scope){return this.f.authorizationActive&&scope===this.f.authorization;}
  documentRouteState(){return this.f.routeState;}
  captureGeneratedImageEdit(outputId,sourceId,options){this.f.captures.push({outputId,sourceId,options});return this.f.capture();}
  async #admitEventWrite(events,action){
    this.f.admissions.push({events,action});const observation=this.f.observation;observation.pending=true;
    this.#eventWriteObservations.set("image-observation",observation);return{admitted:true,reused:false,observation};
  }
  async #generatedImageHttp(url,init,current,onDispatch){
    if(!current())throw Error("finite transport refused retired source");
    this.f.requests.push({url,init,current});onDispatch?.();return this.f.http(url,init,current);
  }
  #mergeConfirmed(events,head){
    this.f.merges.push({events,head});this.f.events=[...this.f.events,...events];
    for(const event of events){const index=this.f.projection.libraryOutputs.findIndex(output=>output.id===event.payload.output_id);
      const next=projectGeneratedImageEdit(this.f.projection.libraryOutputs[index],event,{ownerId:this.f.context.ownerId,projectId:this.f.context.projectId});
      if(next)this.f.projection.libraryOutputs[index]=next;}
  }
  #finishEventWrite(observation,patch,events,publication){
    observation.pending=false;this.f.finishes.push({patch,events,publication});
  }
  releaseEventWriteAcknowledgment(id,owner){this.f.releases.push({id,owner});this.#eventWriteObservations.delete(id);}
  notify(){this.f.notifications++;}
  receiptForTest(body){return this.#validateEventWriteBody(body,[{type:"GeneratedImageEdited",payload:{output_id:this.f.context.outputId,object_id:this.f.context.outputId}}],this.f.observation);}
  validateForTest(body){return this.#validatedGeneratedImageSave(this.f.snapshot,body,body.appended);}
  currentForTest(){return this.#generatedImageSourceCurrent(this.f.snapshot);}
  ${imageStoreMethods.join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const imageStoreFactory = new Function("parseGeneratedImageEditRequest", "parseGeneratedImageRevision", "generatedImageEditOperationSha256",
  "projectGeneratedImageEdit", "outputAssetSha256", "validateReferenceComposition", "inspectOutputAsset", "GENERATED_IMAGE_EDIT_LIMITS",
  "normalizeOutputRequirementCreation", imageStoreCode + "\nreturn ImageStoreControl;");
const imageOwnedUrl = (ownerId, name) => "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/" + name);
const imageUnconfirmed = { status: "unconfirmed", code: "unconfirmed" };

async function imageStoreFixture({ retained = true, sameBytes = false } = {}) {
  const context = { ownerId: "owner:image", projectId: "project-image", documentId: "document-image", outputId: "output:image" };
  const inputPng = sameBytes ? editedPng : originalPng, width = sameBytes ? 1536 : 24, height = sameBytes ? 864 : 24;
  const mediaUrl = imageOwnedUrl(context.ownerId, "image-generation.png");
  const rawJson = '{ "title": "Exact original 雨", "extension": {"order": [3,1], "keep": true} }\n';
  const available = [{ id: "reference-image:image", blockId: "reference-image", kind: "image", label: "Explicit adopted image",
    mediaUrl, contentHash: digest(inputPng) }];
  const recipe = composition.addReferenceCompositionLayer(composition.createReferenceComposition("16:9"), available[0], "layer-one");
  const request = revision.parseGeneratedImageEditRequest({ expectedRevision: 0, expectedEditEventId: null, expectedContentSha256: digest(rawJson),
    generationId: "image-generation", sourceEventId: "generation-event", contentRef: "private-image", sourceMediaUrl: mediaUrl,
    sourceMediaSha256: digest(inputPng), sourceId: available[0].id, recipe, resultMediaSha256: digest(editedPng), resultByteLength: editedPng.length });
  assert.ok(request);
  const operationSha256 = await revision.generatedImageEditOperationSha256(context, request); assert.ok(operationSha256);
  const output = { id: context.outputId, documentId: context.documentId, generationId: request.generationId, sourceEventId: request.sourceEventId,
    contentRef: request.contentRef, mediaUrl, mediaType: "image/png", width, height, quality: "high", purpose: "final", sequence: 3, discarded: false };
  const basis = { kind: "generated-image", ownerId: context.ownerId, documentId: context.documentId, outputId: context.outputId,
    generationId: request.generationId, sourceEventId: request.sourceEventId, contentRef: request.contentRef, revision: 0,
    rawJson, contentSha256: request.expectedContentSha256, media: { url: mediaUrl, mediaType: "image/png", sha256: request.sourceMediaSha256, width, height } };
  const snapshot = { ...context, route: "/studio?document=document-image", rawJson, request, operationSha256, width, height, output: structuredClone(output) };
  const imageRevision = revision.parseGeneratedImageRevision({ schemaVersion: 1, operation: "composition", revision: 1, editEventId: "image-edit-event",
    outputId: context.outputId, documentId: context.documentId, generationId: request.generationId, sourceEventId: request.sourceEventId,
    contentRef: request.contentRef, contentSha256: request.expectedContentSha256,
    source: { revision: 0, eventId: request.sourceEventId, mediaUrl, sha256: request.sourceMediaSha256, width, height },
    media: { url: imageOwnedUrl(context.ownerId, "image-edit-019928d0-0b30-7000-8000-000000000001.png"), mediaType: "image/png",
      sha256: request.resultMediaSha256, byteLength: request.resultByteLength, width: 1536, height: 864 },
    sourceId: request.sourceId, recipe: structuredClone(request.recipe), recipeSha256: digest(JSON.stringify(request.recipe)), operationSha256 }, context.ownerId);
  assert.ok(imageRevision);
  const event = { eventId: imageRevision.editEventId, streamId: "creative:" + context.ownerId, sequence: 6, type: "GeneratedImageEdited", actor: "user",
    clientId: "web:generated-image-editor", correlationId: "image-correlation", schemaVersion: 1, compensatesEventId: null,
    occurredAt: "2026-09-10T00:00:00.000Z", recordedAt: "2026-09-10T00:00:00.000Z",
    payload: { output_id: context.outputId, object_id: context.outputId, document_id: context.documentId, project_id: context.projectId,
      generation_id: request.generationId, source_event_id: request.sourceEventId, content_ref: request.contentRef, edited_by_user_id: context.ownerId,
      source_surface: "generated-image-editor", revision: 1, previous_revision: 0, previous_edit_event_id: null,
      // This is a declared private-envelope hash, not a hash of the returned
      // revision DTO. Complete envelope/row verification belongs to API controls.
      image_revision_id: "image-private-revision", image_revision_sha256: digest("Declared finite private-envelope bytes"), image_edit_operation_sha256: operationSha256,
      content_sha256: request.expectedContentSha256, media_url: imageRevision.media.url, media_type: "image/png", source_content_hash: imageRevision.media.sha256,
      image_width: 1536, image_height: 864, image_byte_length: imageRevision.media.byteLength } };
  const f = { context, request, snapshot, imageRevision, event, output, basis, available, operationSha256, retained,
    source: {}, authorization: {}, sourceActive: true, authorizationActive: true, basisActive: true, routeState: "ready", asOf: Infinity,
    route: snapshot.route, session: { user: { userId: context.ownerId, role: "creator" }, policy: { accepted: true } },
    projection: { projectId: context.projectId, documentId: context.documentId, documents: [{ id: context.documentId, projectId: context.projectId }], libraryOutputs: [structuredClone(output)] },
    events: [], content: { [request.contentRef]: rawJson }, captures: [], admissions: [], requests: [], merges: [], finishes: [], releases: [], notifications: 0, inspected: [] };
  f.captured = { status: "captured", basis, sources: available, sourceId: request.sourceId, editEventId: null,
    current: () => f.basisActive ? { basis, sources: available } : null };
  f.capture = async () => f.captured;
  f.body = { status: "saved", code: "saved", operationSha256, imageRevision, stillCurrent: true,
    currentRevision: 1, currentEditEventId: event.eventId, appended: [event], head: event.sequence };
  f.http = async () => ({ ok: true, status: 200, body: f.body });
  f.observation = { ...(retained ? { imageEdit: snapshot } : {}), source: f.source, pending: false, paused: false, actor: "user",
    streamId: event.streamId, receipt: { action: "append", observationId: "image-observation", owner: { actorUserId: context.ownerId } } };
  const StoreControl = imageStoreFactory(revision.parseGeneratedImageEditRequest, revision.parseGeneratedImageRevision,
    revision.generatedImageEditOperationSha256, revision.projectGeneratedImageEdit, outputAssetSha256, composition.validateReferenceComposition,
    (bytes, ...args) => { f.inspected.push(bytes); return inspectOutputAsset(bytes, ...args); }, edit.GENERATED_IMAGE_EDIT_LIMITS,
    () => { throw Error("GeneratedImageEdited cannot request BlockCreated normalization"); });
  f.store = new StoreControl(f);
  return f;
}

function assertImageNotPublished(f, events, content) {
  assert.equal(f.merges.length, 0); assert.equal(f.notifications, 0); assert.equal(f.events, events); assert.equal(f.content, content);
  assert.ok(f.finishes.every(value => value.publication !== "published" && value.events.length === 0));
}

test("actual Store validator and same-operation Check accept one complete owned image receipt", async () => {
  const f = await imageStoreFixture(), raw = f.content, request = JSON.stringify(f.request);
  assert.equal(f.store.receiptForTest(f.body).complete, true); assert.equal((await f.store.validateForTest(f.body))?.status, "saved");
  const result = await f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256);
  assert.equal(result.status, "saved"); assert.equal(result.stillCurrent, true); assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].init, { method: "GET" });
  assert.equal(f.requests[0].url, `/api/generated-images/${encodeURIComponent(f.context.outputId)}?operationSha256=${f.operationSha256}`);
  assert.equal(f.admissions.length, 0); assert.equal(f.captures.length, 0); assert.equal(f.merges.length, 1);
  assert.equal(f.finishes[0].publication, "published"); assert.equal(f.content, raw); assert.equal(JSON.stringify(f.request), request);
  assert.equal(f.projection.libraryOutputs[0].mediaUrl, f.imageRevision.media.url);
});

const imageReceiptFaults = [
  ["foreign derivative owner", f => { const url = imageOwnedUrl("foreign:image", "image-edit-019928d0-0b30-7000-8000-000000000001.png"); f.body.imageRevision.media.url = url; f.body.appended[0].payload.media_url = url; }],
  ["different typed event project", f => { f.body.appended[0].payload.project_id = "foreign-project"; }],
  ["different event producer", f => { f.body.appended[0].clientId = "web:other-editor"; }],
  ["different original producer", f => { f.body.appended[0].payload.source_event_id = "other-generation-event"; }],
  ["different event and DTO result bytes", f => { f.body.imageRevision.media.sha256 = "a".repeat(64); f.body.appended[0].payload.source_content_hash = "a".repeat(64); }],
  ["different exact raw hash", f => { f.body.imageRevision.contentSha256 = "a".repeat(64); f.body.appended[0].payload.content_sha256 = "a".repeat(64); }],
  ["changed otherwise valid recipe", f => { f.body.imageRevision.recipe.layers[0].x = 60; f.body.imageRevision.recipeSha256 = digest(JSON.stringify(f.body.imageRevision.recipe)); }],
  ["wrong recipe digest", f => { f.body.imageRevision.recipeSha256 = "a".repeat(64); }],
  ["different operation", f => { f.body.operationSha256 = f.body.imageRevision.operationSha256 = f.body.appended[0].payload.image_edit_operation_sha256 = "a".repeat(64); }],
  ["DTO and event identity differ", f => { f.body.imageRevision.editEventId = "different-edit-event"; }],
  ["contradictory current head", f => { f.body.currentRevision = 2; }],
  ["duplicate appended receipt", f => { f.body.appended.push(structuredClone(f.body.appended[0])); }],
];
test("actual Store refuses contradictory image receipts without a second write or publication", async t => {
  for (const [name, mutate] of imageReceiptFaults) await t.test(name, async () => {
    const f = await imageStoreFixture(), events = f.events, content = f.content;
    f.body = structuredClone(f.body); mutate(f);
    if (name !== "duplicate appended receipt") assert.equal(f.store.receiptForTest(f.body).complete, true, "typed receipt remains complete before exact image validation");
    assert.equal(await f.store.validateForTest(f.body), null);
    assert.deepEqual(await f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256), imageUnconfirmed);
    assertImageNotPublished(f, events, content); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.method, "GET");
    assert.equal(f.admissions.length, 0); assert.equal(f.inspected.length, 0);
  });
});

test("actual Check refuses unknown operations and overlapping reads, retaining only the original operation GET", async () => {
  const f = await imageStoreFixture(), gate = deferred(); f.http = () => gate.promise;
  assert.deepEqual(await f.store.checkGeneratedImageEdit(f.context.outputId, "a".repeat(64)), imageUnconfirmed); assert.equal(f.requests.length, 0);
  const pending = f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(await f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256), imageUnconfirmed); assert.equal(f.requests.length, 1);
  gate.resolve({ ok: true, status: 200, body: f.body }); assert.equal((await pending).status, "saved");
});

test("actual Check preserves an observed historical receipt but never publishes over changed raw JSON", async () => {
  const f = await imageStoreFixture(); f.content = { ...f.content, [f.request.contentRef]: JSON.stringify(JSON.parse(f.snapshot.rawJson)) };
  const events = f.events, content = f.content;
  assert.notEqual(content[f.request.contentRef], f.snapshot.rawJson); assert.equal(f.store.currentForTest(), false);
  const result = await f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256);
  assert.equal(result.status, "saved"); assert.equal(result.stillCurrent, false); assertImageNotPublished(f, events, content);
});

test("actual Check retires a late response after the original authorization scope is lost", async () => {
  const f = await imageStoreFixture(), gate = deferred(), events = f.events, content = f.content; f.http = () => gate.promise;
  const pending = f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256); assert.equal(f.requests.length, 1);
  f.authorizationActive = false; gate.resolve({ ok: true, status: 200, body: f.body });
  assert.deepEqual(await pending, imageUnconfirmed); assertImageNotPublished(f, events, content);
  assert.equal(f.finishes.at(-1).publication, "withheld");
});

test("actual Save copies PNG bytes before capture awaits and prevents an overlapping upload", async () => {
  const f = await imageStoreFixture({ retained: false }), gate = deferred(), input = new Uint8Array(editedPng);
  f.capture = () => gate.promise;
  const pending = f.store.reviseGeneratedImage(f.context.outputId, f.request, input);
  assert.equal(f.captures.length, 1); input.fill(0);
  assert.deepEqual(await f.store.reviseGeneratedImage(f.context.outputId, f.request, new Uint8Array(editedPng)), imageUnconfirmed);
  assert.equal(f.captures.length, 1); assert.equal(f.requests.length, 0); gate.resolve(f.captured);
  const result = await pending; assert.equal(result.status, "saved"); assert.equal(result.stillCurrent, true);
  assert.equal(f.admissions.length, 1); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.method, "PATCH");
  const form = f.requests[0].init.body; assert.ok(form instanceof FormData);
  assert.deepEqual(JSON.parse(form.get("request")), f.request);
  assert.deepEqual(new Uint8Array(await form.get("png").arrayBuffer()), new Uint8Array(editedPng));
  assert.equal(f.inspected.length, 1); assert.notEqual(f.inspected[0], input); assert.ok(f.inspected[0].every(byte => byte === 0), "owned snapshot retired in finally");
  assert.equal(f.merges.length, 1); assert.equal(f.finishes[0].publication, "published");
});

test("actual Save uncertainty permits only read-only Check for the retained operation, not another upload", async () => {
  const f = await imageStoreFixture({ retained: false }); f.http = async () => ({ ok: true, status: 200, body: {} });
  assert.deepEqual(await f.store.reviseGeneratedImage(f.context.outputId, f.request, new Uint8Array(editedPng)), imageUnconfirmed);
  assert.equal(f.finishes.at(-1).patch.outcome, "unconfirmed"); assert.equal(f.requests.length, 1);
  assert.deepEqual(await f.store.reviseGeneratedImage(f.context.outputId, f.request, new Uint8Array(editedPng)), imageUnconfirmed);
  assert.equal(f.requests.length, 1); assert.equal(f.admissions.length, 1);
  f.http = async () => ({ ok: true, status: 200, body: f.body });
  assert.equal((await f.store.checkGeneratedImageEdit(f.context.outputId, f.operationSha256)).status, "saved");
  assert.deepEqual(f.requests.map(value => value.init.method), ["PATCH", "GET"]); assert.equal(f.merges.length, 1);
});

test("actual Save accepts unchanged only for identical bytes and exact no-op response keys", async t => {
  for (const [name, sameBytes, extra, expected] of [["true byte no-op", true, false, "unchanged"], ["changed bytes false ACK", false, false, "unconfirmed"], ["extra no-op receipt fields", true, true, "unconfirmed"]]) {
    await t.test(name, async () => {
      const f = await imageStoreFixture({ retained: false, sameBytes }), events = f.events, content = f.content;
      f.http = async () => ({ ok: true, status: 200, body: { status: "unchanged", code: "unchanged", ...(extra ? { appended: [] } : {}) } });
      assert.equal((await f.store.reviseGeneratedImage(f.context.outputId, f.request, new Uint8Array(editedPng))).status, expected);
      assert.equal(f.requests.length, 1); assertImageNotPublished(f, events, content);
      assert.equal(f.releases.length, expected === "unchanged" ? 1 : 0);
    });
  }
});

test("actual Save guards source loss before dispatch and owner loss after dispatch", async t => {
  for (const afterDispatch of [false, true]) await t.test(afterDispatch ? "late owner" : "captured source", async () => {
    const f = await imageStoreFixture({ retained: false }), gate = deferred(), reachedHttp = deferred(), events = f.events, content = f.content;
    if (afterDispatch) f.http = () => { reachedHttp.resolve(); return gate.promise; }; else f.capture = () => gate.promise;
    const pending = f.store.reviseGeneratedImage(f.context.outputId, f.request, new Uint8Array(editedPng));
    if (afterDispatch) { await Promise.race([reachedHttp.promise, pending.then(result => { assert.fail("Save ended before its finite PATCH: " + JSON.stringify(result)); })]); assert.equal(f.requests.length, 1); f.session = { ...f.session, user: { ...f.session.user, userId: "other-owner" } }; gate.resolve({ ok: true, status: 200, body: f.body }); }
    else { f.basisActive = false; gate.resolve(f.captured); }
    assert.deepEqual(await pending, { status: "refused", code: "source_changed" }); assertImageNotPublished(f, events, content);
    assert.equal(f.requests.length, afterDispatch ? 1 : 0);
    if (f.inspected.length) assert.ok(f.inspected[0].every(byte => byte === 0));
  });
});

// Exact parent close implementation and the existing production focus lease.
// Finite document events model a gesture while rendering awaits; no focus helper
// or source-return predicate is mirrored or replaced in these controls.
const { captureOutputNavigationFocus } = await import("../src/components/output-navigation-focus.ts");
const imageCardUrl = new URL("../src/components/output-card.ts", import.meta.url);
const imageCardTree = ts.createSourceFile(imageCardUrl.pathname, readFileSync(imageCardUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const imageCardOwners = imageCardTree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "OutputCard");
assert.equal(imageCardOwners.length, 1);
const imageCardNames = ["#imageEdit", "#imageEditOpener", "#imageEditEpoch", "#imageEditReturnCurrent", "#imageEditEligible", "#openImageEdit", "#closeImageEdit"];
const imageCardMembers = imageCardNames.map(name => {
  const matches = imageCardOwners[0].members.filter(node => node.name?.getText(imageCardTree) === name);
  assert.equal(matches.length, 1, `one actual OutputCard ${name}`); return matches[0].getText(imageCardTree);
});
const imageCardCode = ts.transpileModule(`class ImageCardControl {
  constructor(f){this.f=f;this.store=f.store;this.output=f.output;this.ownerDocument=f.document;this.isConnected=true;}
  querySelector(selector){return selector==='[data-generated-image-edit]'?this.f.opener:selector==='forma-generated-image-editor'?this.f.editor:null;}
  requestUpdate(){this.f.updates++;}
  get updateComplete(){return this.f.rendered.promise;}
  openForTest(){return this.#openImageEdit({currentTarget:this.f.opener});}
  closeForTest(event){return this.#closeImageEdit(event);}
  openingForTest(){return this.#imageEdit;}
  ${imageCardMembers.join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const imageCardFactory = new Function("captureOutputNavigationFocus", "HTMLButtonElement", "getComputedStyle", imageCardCode + "\nreturn ImageCardControl;");
function imageCardFixture() {
  const f = { rendered: deferred(), updates: 0, focuses: [], listeners: new Map(), added: [], removed: [], source: {}, authorization: { shared: false }, sourceActive: true };
  const document = { body: { isConnected: true }, documentElement: { isConnected: true }, activeElement: null, hasFocus: () => true,
    addEventListener(type, callback, capture) { assert.equal(capture, true); f.added.push(type); if (!f.listeners.has(type)) f.listeners.set(type, new Set()); f.listeners.get(type).add(callback); },
    removeEventListener(type, callback, capture) { assert.equal(capture, true); f.removed.push(type); f.listeners.get(type)?.delete(callback); } };
  f.document = document;
  f.fire = (type, target) => { for (const callback of [...f.listeners.get(type) ?? []]) callback({ type, target }); };
  class ButtonPort {
    isConnected = true; disabled = false; hidden = false; inert = false; parentElement = null;
    getClientRects() { return [{}]; }
    focus(options) { f.focuses.push({ target: this, options }); document.activeElement = this; f.fire("focusin", this); }
  }
  f.opener = new ButtonPort(); f.active = new ButtonPort(); document.activeElement = f.active;
  f.editor = { contains: target => target === f.active, isConnected: true };
  f.output = { id: "image-output", documentId: "image-document", generationId: "image-generation", sourceEventId: "generation-event",
    contentRef: "image-content", mediaType: "image/png", quality: "high", purpose: "final", discarded: false };
  f.store = { session: { get: () => ({ user: { userId: "owner:image", role: "creator" }, policy: { accepted: true } }) },
    projection: { get: () => ({ projectId: "image-project", documentId: "image-document" }) }, route: { get: () => "/document/image-document" },
    captureSourceOwnership: () => f.source, captureAuthorizationScope: () => f.authorization,
    sourceOwnershipActive: value => f.sourceActive && value === f.source, authorizationScopeActive: value => value === f.authorization };
  const Card = imageCardFactory(captureOutputNavigationFocus, ButtonPort, () => ({ display: "block", visibility: "visible", opacity: "1" }));
  f.card = new Card(f); f.opener.parentElement = f.card; f.card.openForTest();
  f.opening = f.card.openingForTest(); assert.ok(f.opening?.current()); assert.equal(f.updates, 1);
  f.close = reason => f.card.closeForTest({ currentTarget: f.editor, detail: { opening: f.opening, reason } });
  f.finishRender = () => { f.active.isConnected = false; document.activeElement = document.body; f.rendered.resolve(); };
  f.listenerCount = () => [...f.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  return f;
}

for (const reason of ["cancel", "done"]) test(`actual OutputCard explicit ${reason} returns focus only to its exact retained opener`, async () => {
  const f = imageCardFixture(), pending = f.close(reason);
  assert.equal(f.card.openingForTest(), null); assert.equal(f.listenerCount(), 3); assert.equal(f.focuses.length, 0);
  f.finishRender(); await pending;
  assert.deepEqual(f.focuses, [{ target: f.opener, options: { preventScroll: true } }]);
  assert.equal(f.document.activeElement, f.opener); assert.equal(f.listenerCount(), 0);
  assert.deepEqual(f.added, ["pointerdown", "keydown", "focusin"]);
});

for (const gesture of ["pointerdown", "keydown"]) test(`actual OutputCard ${gesture} during pending render cancels BODY-based focus return`, async () => {
  const f = imageCardFixture(), pending = f.close("cancel");
  f.active.isConnected = false; f.document.activeElement = f.document.body; f.fire(gesture, f.document.body);
  assert.equal(f.listenerCount(), 0, "the actual focus lease observes and retires on the new gesture");
  f.rendered.resolve(); await pending;
  assert.equal(f.focuses.length, 0); assert.equal(f.document.activeElement, f.document.body);
});

test("actual OutputCard passive retirement is focus-inert and acquires no gesture lease", async () => {
  const f = imageCardFixture(), pending = f.close("retired");
  assert.equal(f.card.openingForTest(), null); assert.equal(f.listenerCount(), 0); f.finishRender(); await pending;
  assert.deepEqual(f.focuses, []); assert.deepEqual(f.added, []);
});

test("actual OutputCard source replacement during render refuses its old explicit return", async () => {
  const f = imageCardFixture(), pending = f.close("done");
  f.card.output = { ...f.output, sourceEventId: "replacement-generation-event" };
  f.finishRender(); await pending;
  assert.equal(f.focuses.length, 0); assert.equal(f.listenerCount(), 0);
});

test("actual OutputCard rejects a foreign close target without clearing the current opening", async () => {
  const f = imageCardFixture();
  await f.card.closeForTest({ currentTarget: {}, detail: { opening: f.opening, reason: "cancel" } });
  assert.equal(f.card.openingForTest(), f.opening); assert.equal(f.updates, 1); assert.deepEqual(f.added, []); assert.deepEqual(f.focuses, []);
});

// Usage-hint successor only. The accepted 58-control prefix is unchanged; select
// these named checks without replaying its bodies. Actual compositor rendering
// and host property binding run on the same declared finite native ports.
const { noChange } = await import("lit");
const hintCompositorUrl = new URL("../src/components/reference-compositor.ts", import.meta.url);
const hintCompositorTree = ts.createSourceFile(hintCompositorUrl.pathname, readFileSync(hintCompositorUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hintCompositorOwners = hintCompositorTree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "ReferenceCompositor");
assert.equal(hintCompositorOwners.length, 1);
const hintActualClass = hintCompositorOwners[0].getText(hintCompositorTree).replace(/^export\s+/u, "");
const hintCompositorCode = ts.transpileModule(hintActualClass.slice(0, -1) + `
  hintStateForTest(busy, failure) { this.#busy = busy; this.#failure = failure; }
  hintSnapshotForTest() { return { revision:this.#revision, draft:this.#draft, sources:this.sources, disabled:this.disabled }; }
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const hintModelNames = Object.keys(composition);
const hintCompositorFactory = new Function(...hintModelNames, "html", "noChange", "nothing", "FormaPresentationalElement", "icon",
  "ensureModalDialog", "CompositionImageError", "compositionPng", hintCompositorCode + "\nreturn ReferenceCompositor;");
function hintCompositorFixture(t) {
  const f = fixture(t);
  f.i18n.t = key => `localized:${key}`;
  const Compositor = hintCompositorFactory(...hintModelNames.map(name => composition[name]), html, noChange, nothing,
    ports.ElementPort, () => nothing, ports.modalPort.ensureModalDialog,
    class extends Error {}, () => { assert.fail("Usage-hint controls cannot rasterize or capture an image"); });
  f.host = new Compositor(); f.host.tag = "forma-reference-compositor"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, {});
  f.changed = new Map(); f.draw();
  f.notice = () => {
    const node = f.draw().nodes.find(value => value.attributes.class === "reference-compositor-notice");
    assert.ok(node); assert.equal(node.attributes.role, "status"); assert.equal(node.attributes["aria-live"], "polite"); return node.text;
  };
  f.setHint = value => { const previous = f.host.usageHint; f.host.usageHint = value; f.changed = new Map([["usageHint", previous]]); };
  return f;
}

test("usage-hint-r2: actual compositor defaults to its localized reference-context hint", t => {
  const f = hintCompositorFixture(t);
  assert.equal(f.host.usageHint, "");
  assert.equal(f.host.constructor.properties.usageHint.attribute, false, "actual property-only declaration");
  assert.equal(f.notice(), "localized:composition.usageHint");
});

test("usage-hint-r2: actual compositor uses a live override and restores its default when cleared", t => {
  const f = hintCompositorFixture(t), before = f.host.hintSnapshotForTest();
  f.setHint("Prepare a preview, then choose Save edited image.");
  assert.equal(f.notice(), "Prepare a preview, then choose Save edited image.");
  f.setHint("A second opening supplies its own usage guidance.");
  assert.equal(f.notice(), "A second opening supplies its own usage guidance.");
  f.setHint(""); assert.equal(f.notice(), "localized:composition.usageHint");
  assert.deepEqual(f.host.hintSnapshotForTest(), before, "hint updates do not retire or change the composition");
});

test("usage-hint-r2: actual compositor preserves error then busy precedence over usage guidance", t => {
  const f = hintCompositorFixture(t); f.setHint("Generated-image editing guidance.");
  f.host.hintStateForTest(true, ""); assert.equal(f.notice(), "localized:composition.preparing");
  f.host.hintStateForTest(true, "hashMismatch"); assert.equal(f.notice(), "localized:composition.hashMismatch");
  f.host.hintStateForTest(false, "sourceChanged"); assert.equal(f.notice(), "localized:composition.sourceChanged");
  f.host.hintStateForTest(false, ""); assert.equal(f.notice(), "Generated-image editing guidance.");
});

for (const locale of ["en", "fr", "ar", "ja"]) test(`usage-hint-r2: actual generated-image host passes its ${locale} edit guidance`, async t => {
  const f = fixture(t, { locale }); await f.open();
  assert.equal(f.state().phase, "editing");
  const compositor = f.host.querySelector("forma-reference-compositor"); assert.ok(compositor);
  const expected = generatedImageEditCopy(locale).help; assert.ok(expected.length > 0);
  assert.equal(compositor.usageHint, expected);
  assert.deepEqual(f.mutations, []); assert.equal(f.adoptCalls, 0); assert.equal(f.saveCalls.length, 0);
  assert.equal(f.checkCalls.length, 0); assert.equal(f.fetchCalls.length, 0); assert.equal(f.preparedInputs.length, 0);
});
