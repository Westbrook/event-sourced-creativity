import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as lit from "lit";
import ts from "typescript";
import * as composition from "../src/model/reference-composition.ts";
import * as nativeDialog from "../src/components/design-system/native-dialog.ts";

// Complete component modules and their actual Lit event/property bindings.
// Store persistence, bitmap decode, canvas and native dialog operations are
// finite ports. This file proves lifecycle decisions, not real Lit DOM reuse,
// image pixels, CSS geometry, browser focus restoration or server persistence.
// It never imports the paid scene/document-job recovery control planes.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(setImmediate);
async function until(check, label) {
  for (let count = 0; count < 80; count++) { if (check()) return; await turn(); }
  assert.ok(check(), label);
}

const compiled = new Map();
function actualModule(file, dependencies, globals = {}) {
  let javascript = compiled.get(file);
  if (!javascript) {
    javascript = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, useDefineForClassFields: false },
    }).outputText;
    compiled.set(file, javascript);
  }
  const exports = {};
  const require = (specifier) => {
    assert.ok(Object.hasOwn(dependencies, specifier), "Explicit dependency port: " + file + " → " + specifier);
    return dependencies[specifier];
  };
  new Function("require", "exports", ...Object.keys(globals), javascript)(require, exports, ...Object.values(globals));
  return exports;
}

// Resolve each emitted tag's real Lit attributes without executing handwritten
// callback substitutes. Retention keys come only from template identity and
// numeric value/array paths, never a domain ID, label or callback source text.
const templateIds = new WeakMap();
let nextTemplate = 0;
function emittedTags(value, path = "root", result = []) {
  if (Array.isArray(value)) { value.forEach((item, index) => emittedTags(item, path + "/" + index, result)); return result; }
  if (!value || typeof value !== "object" || !Array.isArray(value.strings) || !Array.isArray(value.values)) return result;
  if (!templateIds.has(value.strings)) templateIds.set(value.strings, ++nextTemplate);
  const key = path + "/t" + templateIds.get(value.strings);
  const markup = value.strings.map((text, index) => text + (index < value.values.length ? "__value_" + index + "__" : "")).join("");
  let index = 0;
  for (const match of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gu)) {
    const attributes = {}, properties = {}, handlers = {};
    for (const item of match[2].matchAll(/([@.?]?[\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
      const name = item[1], raw = item[2] ?? item[3] ?? item[4] ?? true;
      const marker = typeof raw === "string" ? /^__value_(\d+)__$/u.exec(raw) : null;
      const field = marker ? value.values[Number(marker[1])] : raw;
      if (name.startsWith("@")) handlers[name.slice(1)] = field;
      else if (name.startsWith(".")) properties[name.slice(1)] = field;
      else if (name.startsWith("?")) { if (field) attributes[name.slice(1)] = ""; }
      else attributes[name] = field;
    }
    result.push({ key: key + "/tag" + index++, tag: match[1], attributes, properties, handlers });
  }
  value.values.forEach((item, index) => emittedTags(item, key + "/v" + index, result));
  return result;
}
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);

function fixture(t, { editor = true, scope = "document" } = {}) {
  const state = { trace: [], emitted: [], requests: [], bitmapCalls: [], canvases: [], calls: [], pending: [], toasts: [],
    source: {}, authorization: {}, route: "/document/current", permissions: ["project.read", "project.author"] };
  const bytes = new TextEncoder().encode("finite source bytes; decoding is an explicit bitmap port");
  const source = { id: "source:image", blockId: "source", label: "Owned image", kind: "image", mediaUrl: "/api/media/source.png",
    contentHash: createHash("sha256").update(bytes).digest("hex") };
  const recipe = composition.addReferenceCompositionLayer(composition.createReferenceComposition(), source, "first-layer");
  const block = { id: "composition", projectId: "project", documentId: "current", canvasId: "canvas", scope,
    type: "reference", handle: "reference/composition", position: "a", removed: false, locked: false, sourceEvents: [],
    properties: { label: "Original scene", reference_id: "composition-original", media_url: "/api/media/original.png",
      source_content_hash: "a".repeat(64), reference_composition: recipe } };
  const sourceBlock = { ...block, id: source.blockId, handle: "reference/source", properties: {
    label: source.label, reference_id: "source-reference", media_url: source.mediaUrl, media_type: "image/png",
    source_content_hash: source.contentHash, weight: 1 } };
  state.blocks = [block, sourceBlock];
  state.events = [{ type: "ReferenceIngested", payload: { reference_id: "source-reference", source_ref: source.mediaUrl,
    content_hash: source.contentHash, rights_class: "owned_or_licensed" } }];
  let activeRoot = null;
  const doc = { activeElement: null, body: null, documentElement: null, createElement(tag) {
    assert.equal(tag, "canvas", "Only the compositor's declared local raster canvas is admitted");
    const canvas = { width: 0, height: 0, context: { fillRect() {}, drawImage() { canvas.paints++; } }, paints: 0,
      getContext(kind) { assert.equal(kind, "2d"); return this.context; },
      toBlob(callback, mime) { assert.equal(mime, "image/png"); callback(new Blob(["finite output"], { type: mime })); } };
    state.canvases.push(canvas); return canvas;
  } };
  class ElementPort {
    constructor(tag = "element") {
      this.tag = tag; this.attributes = {}; this.properties = {}; this.handlers = {}; this.children = [];
      this.parentElement = null; this.ownerDocument = doc; this.isConnected = true; this.open = false; this.disabled = false;
    }
    contains(other) { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; }
    focus() { if (!this.isConnected || this.disabled) return; doc.activeElement = this; state.trace.push(["focus", this]); }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === "open") this.open = true; }
    removeAttribute(name) { delete this.attributes[name]; if (name === "open") this.open = false; }
    matches(selector) {
      assert.ok([":modal", ":disabled"].includes(selector), "Finite native selector: " + selector);
      return selector === ":modal" ? this.open : this.disabled;
    }
    querySelector(selector) {
      if (selector === ".reference-compositor") return this.dialog ?? null;
      if (selector === "forma-reference-compositor") return this.compositor ?? null;
      assert.fail("Unexpected finite selector: " + selector);
    }
    querySelectorAll(selector) {
      assert.equal(selector, ".reference-compositor-numbers input");
      return (this.controls ?? []).filter(node => node.tag === "input" && node.attributes["data-layer-id"]);
    }
    invoke(type, extra = {}) {
      const event = { type, target: this, currentTarget: this, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
      const result = this.handlers[type]?.call(this.listenerOwner, event);
      return { event, result };
    }
    dispatchEvent(event) {
      state.emitted.push({ owner: this, event });
      const result = this.invoke(event.type, { detail: event.detail }).result;
      if (result?.then) state.pending.push(result);
      return true;
    }
    showModal() {
      this.invoker = doc.activeElement; this.open = true; state.trace.push(["showModal", this]);
      this.children.find(node => node.tag === "button" && !node.disabled)?.focus();
    }
    close() {
      this.open = false; state.trace.push(["close", this]);
      // Deliberate native port contract, not a claim of Chromium evidence.
      if (this.invoker?.isConnected && !this.invoker.disabled) this.invoker.focus();
      else if (this.contains(doc.activeElement)) doc.activeElement = doc.body;
      queueMicrotask(() => this.invoke("close"));
    }
  }
  class InputPort extends ElementPort {
    get valueAsNumber() { return String(this.value ?? "").trim() ? Number(this.value) : Number.NaN; }
    get validity() {
      const number = this.valueAsNumber;
      return { valid: Number.isFinite(number) && number >= Number(this.attributes.min ?? -Infinity)
        && number <= Number(this.attributes.max ?? Infinity) && Number.isInteger(number) };
    }
  }
  class HostPort extends ElementPort {
    i18n = { t: (key, fallback = "") => fallback || key, number: value => String(value) };
    requestUpdate() {}
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
  }
  doc.documentElement = new ElementPort("html"); doc.body = new ElementPort("body"); doc.body.parentElement = doc.documentElement;
  doc.activeElement = doc.body;
  const store = {
    projection: { get: () => ({ libraryBlocks: state.blocks }) }, events: { get: () => state.events },
    route: { get: () => state.route }, session: { get: () => ({ capabilities: state.permissions }) },
    captureAuthorizationScope: () => state.authorization, captureSourceOwnership: () => state.source,
    sourceOwnershipActive: source => source === state.source && Boolean(state.authorization),
    toast: text => state.toasts.push(text),
    saveReferenceComposition(input, current) {
      const completion = deferred(); state.calls.push({ input, current, completion });
      assert.equal(current(), true, "The real owner supplied a live original guard at dispatch");
      return completion.promise;
    },
  };
  const registry = new Map();
  const globals = { customElements: { get: tag => registry.get(tag), define: (tag, value) => registry.set(tag, value) },
    HTMLInputElement: InputPort,
    fetch: async (url, init) => {
      state.requests.push({ url, init }); assert.equal(url, source.mediaUrl);
      assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
      if (state.fetchGate) await state.fetchGate.promise;
      return new Response(bytes, { headers: { "content-type": "image/png", "content-length": String(bytes.length) } });
    },
    createImageBitmap: async (_blob, options) => {
      assert.deepEqual(options, { imageOrientation: "from-image" });
      const bitmap = { width: 64, height: 64, closed: 0, close() { this.closed++; } };
      state.bitmapCalls.push(bitmap); if (state.bitmapGate) await state.bitmapGate.promise; return bitmap;
    },
  };
  const modal = actualModule("src/components/modal-dialog.ts", {
    "./design-system/native-dialog": nativeDialog,
    "./design-system/localization": { currentFormaLocale: () => ({ messages: { "dialog.heading": "Dialog" } }) },
    "./output-navigation-focus.ts": { captureOutputNavigationFocus() { assert.fail("No unrelated confirmation/focus controller is admitted"); } },
  });
  const compositorModule = actualModule("src/components/reference-compositor.ts", {
    lit, "../model/reference-composition.ts": composition, "./presentational-element.ts": { FormaPresentationalElement: HostPort },
    "./icons.ts": { icon: () => lit.nothing }, "./modal-dialog.ts": modal, "./reference-compositor.css": {},
  }, globals);
  const editorModule = actualModule("src/components/reference-composition-editor.ts", {
    lit, "../model/reference-composition": composition, "./forma-element": { FormaElement: HostPort },
    "./reference-compositor": compositorModule,
  }, globals);
  const assign = (owner, values) => {
    const changed = new Map();
    for (const [key, value] of Object.entries(values)) if (owner[key] !== value) { changed.set(key, owner[key]); owner[key] = value; }
    return changed;
  };
  const retire = node => {
    if (!node?.isConnected) return;
    for (const child of node.children ?? []) retire(child);
    if (node.contains(doc.activeElement)) doc.activeElement = doc.body;
    node.isConnected = false; node.parentElement = null; node.disconnectedCallback?.();
  };
  function bind(node, emitted, owner, parent) {
    Object.assign(node, { attributes: emitted.attributes, properties: emitted.properties, handlers: emitted.handlers,
      listenerOwner: owner, parentElement: parent, isConnected: true });
    node.disabled = Object.hasOwn(node.attributes, "disabled");
    if (node.disabled && doc.activeElement === node) doc.activeElement = doc.body;
    node.dataset = { layerId: node.attributes["data-layer-id"], layerKey: node.attributes["data-layer-key"] };
    for (const [key, value] of Object.entries(emitted.properties)) if (value !== lit.noChange) node[key] = value;
    return node;
  }
  function paintCompositor(owner, changed = new Map()) {
    owner.willUpdate(changed);
    const tags = emittedTags(owner.render()), dialogs = tags.filter(item => item.tag === "dialog");
    assert.equal(dialogs.length, 1);
    const dialog = owner.dialog ?? new ElementPort("dialog"); owner.dialog = dialog;
    bind(dialog, dialogs[0], owner, owner);
    const prior = owner.controlMap ?? new Map(), next = new Map();
    owner.controls = tags.filter(item => ["button", "input", "select"].includes(item.tag)).map(item => {
      const node = prior.get(item.key) ?? new (item.tag === "input" ? InputPort : ElementPort)(item.tag);
      bind(node, item, owner, dialog); next.set(item.key, node); return node;
    });
    for (const [key, node] of prior) if (!next.has(key)) retire(node);
    owner.controlMap = next; dialog.children = owner.controls; owner.children = [dialog];
    owner.updated(); return owner;
  }
  const external = new ElementPort("button"); external.parentElement = doc.body;
  const opener = new ElementPort("button"); opener.parentElement = doc.body; opener.focus();
  let root;
  if (editor) {
    root = new editorModule.ReferenceCompositionEditor(); root.store = store; root.block = block; root.surface = scope;
  } else {
    root = new compositorModule.ReferenceCompositor(); root.sources = [source]; root.recipe = recipe; root.label = "Original scene";
  }
  root.parentElement = doc.body; activeRoot = root;
  function paint() {
    if (!root.isConnected) return;
    if (!editor) return paintCompositor(root, state.changed ?? new Map());
    const tags = emittedTags(root.render()), invokers = tags.filter(item => item.tag === "button"), children = tags.filter(item => item.tag === "forma-reference-compositor");
    assert.ok(invokers.length <= 1); assert.ok(children.length <= 1);
    if (invokers.length) {
      root.invoker ??= new ElementPort("button"); bind(root.invoker, invokers[0], root, root);
    } else { retire(root.invoker); root.invoker = null; }
    const description = children[0];
    if (!description) { retire(root.compositor); root.compositor = null; }
    else {
      const fresh = !root.compositor;
      const child = root.compositor ?? new compositorModule.ReferenceCompositor(); root.compositor = child;
      child.handlers = description.handlers; child.listenerOwner = root; child.parentElement = root; child.isConnected = true;
      const changed = assign(child, description.properties);
      if (fresh) for (const key of ["recipe", "sources", "label", "disabled"]) changed.set(key, undefined);
      paintCompositor(child, changed);
    }
    root.children = [root.invoker, root.compositor].filter(Boolean);
  }
  if (!editor) state.changed = new Map([["recipe", null], ["sources", []], ["label", ""]]);
  paint(); state.changed = null;
  const control = (owner, name) => {
    const matches = owner.controls.filter(node => name === "close" ? classed(node, "modal-close")
      : name === "cancel" ? node.attributes.class === "button ghost"
        : name === "capture" ? node.attributes.class === "button primary" : false);
    assert.equal(matches.length, 1, "One actual emitted " + name + " control"); return matches[0];
  };
  const open = () => { assert.ok(editor && root.invoker && !root.invoker.disabled); root.invoker.focus(); root.invoker.invoke("click"); paint(); assert.ok(root.compositor); return root.compositor; };
  const captureEvent = child => {
    const result = child.invoke("composition-capture", { detail: { blob: new Blob(["saved pixels"], { type: "image/png" }), recipe, label: "Changed scene" } }).result;
    assert.ok(result?.then); state.pending.push(result); paint(); return result;
  };
  const closes = owner => state.trace.filter(([kind, node]) => kind === "close" && node === owner.dialog).length;
  t.after(async () => {
    state.fetchGate?.resolve(); state.bitmapGate?.resolve();
    retire(activeRoot);
    for (const call of state.calls) call.completion.resolve(false);
    await Promise.all(state.pending);
    await turn();
    assert.ok(state.requests.every(request => request.url === source.mediaUrl), "No non-fixture transport admitted");
  });
  return { state, source, recipe, block, root, store, doc, external, opener, paint, open, control, captureEvent, closes,
    set(values) { state.changed = assign(root, values); paint(); state.changed = null; },
    replaceBlock(properties) { state.blocks = state.blocks.map(item => item.id === block.id ? { ...item, properties: { ...item.properties, ...properties } } : item); },
    retire: () => retire(root) };
}

for (const action of ["close", "cancel", "escape", "backdrop"]) {
  test("reference editor " + action + " closes the current native owner exactly once", async t => {
    const f = fixture(t), child = f.open(), invoker = f.root.invoker;
    assert.equal(child.dialog.open, true);
    if (action === "escape") assert.equal(child.dialog.invoke("cancel").event.defaultPrevented, true);
    else if (action === "backdrop") child.dialog.invoke("click");
    else { f.control(child, action).focus(); f.control(child, action).invoke("click"); }
    f.paint(); await turn();
    assert.equal(f.root.compositor, null); assert.equal(f.closes(child), 1); assert.equal(child.dialog.open, false);
    assert.equal(f.doc.activeElement, invoker);
    assert.equal(f.state.emitted.filter(item => item.owner === child && item.event.type === "composition-close").length, 1);
    assert.equal(f.state.calls.length, 0);
  });
}

for (const scope of ["document", "library"]) {
test(scope + " save retains the disabled owner through its own canonical update, then closes before removal", async t => {
  const f = fixture(t, { scope }), child = f.open(), invoker = f.root.invoker;
  f.control(child, "capture").focus(); f.control(child, "capture").invoke("click");
  await until(() => f.state.calls.length === 1, "Actual local capture reached the owning editor's save boundary");
  const save = f.state.pending[0], call = f.state.calls[0]; assert.ok(save?.then); f.paint();
  assert.equal(call.input.targetBlockId, f.block.id); assert.deepEqual(call.input.recipe, f.recipe);
  assert.equal(call.input.blob.type, "image/png"); assert.ok(call.input.blob.size > 0);
  assert.equal(f.state.bitmapCalls[0].closed, 1); assert.equal(f.state.canvases[0].width, 0);
  assert.equal(child.disabled, true); assert.equal(child.dialog.open, true);
  assert.equal(invoker.disabled, false, "The modal makes its background inert without disabling its focus-return target");
  invoker.invoke("click"); f.paint();
  assert.equal(f.root.compositor, child, "The pending guard rejects duplicate opening even through a direct handler call");
  assert.equal(child.dialog.invoke("cancel").event.defaultPrevented, true); f.paint();
  assert.equal(f.root.compositor, child); assert.equal(f.closes(child), 0); assert.equal(f.state.calls.length, 1);
  f.captureEvent(child); assert.equal(f.state.calls.length, 1, "A duplicate capture while saving cannot dispatch again");
  f.replaceBlock({ label: call.input.label, reference_id: "composition-saved", media_url: "/api/media/saved.png", source_content_hash: "b".repeat(64) });
  f.paint();
  assert.equal(call.current(), false, "The original canonical identity changed on the owner's successful save");
  assert.equal(f.root.compositor, child, "The pending native owner stays mounted until its own result settles");
  assert.equal(child.dialog.open, true); assert.equal(child.disabled, true);
  call.completion.resolve(true); await save; f.paint(); await turn();
  assert.equal(f.root.compositor, null); assert.equal(f.closes(child), 1); assert.equal(f.doc.activeElement, invoker);
  assert.equal(f.state.toasts.length, 0);
});
}

test("owner completion does not ask native close to overwrite a newer focus owner", async t => {
  const f = fixture(t), child = f.open(), save = f.captureEvent(child);
  f.external.focus(); f.replaceBlock({ label: "Saved scene" }); f.paint();
  f.state.calls[0].completion.resolve(true); await save; f.paint();
  assert.equal(f.root.compositor, null); assert.equal(f.closes(child), 0); assert.equal(f.doc.activeElement, f.external);
});

test("rejected save keeps the original editable scene open without a false close", async t => {
  const f = fixture(t), child = f.open(), save = f.captureEvent(child);
  f.state.calls[0].completion.resolve(false); await save; f.paint();
  assert.equal(f.root.compositor, child); assert.equal(child.disabled, false); assert.equal(child.dialog.open, true);
  assert.equal(f.closes(child), 0); assert.equal(f.root.invoker.disabled, false);
});

test("external canonical replacement invalidates a pending write and retires its old draft after refusal", async t => {
  const f = fixture(t), child = f.open(), save = f.captureEvent(child), call = f.state.calls[0];
  f.external.focus(); f.replaceBlock({ label: "Other author's scene", media_url: "/api/media/other.png" }); f.paint();
  assert.equal(call.current(), false); assert.equal(f.root.compositor, child); assert.equal(child.disabled, true);
  call.completion.resolve(false); await save; f.paint();
  assert.equal(f.root.compositor, null); assert.equal(f.closes(child), 0); assert.equal(f.doc.activeElement, f.external);
  const reopened = f.open(); assert.equal(reopened.label, "Other author's scene"); assert.notEqual(reopened, child);
});

const retirements = {
  source: f => { f.state.source = {}; },
  route: f => { f.state.route = "/document/other"; },
  authorization: f => { f.state.authorization = null; },
  permission: f => { f.state.permissions = ["project.read"]; },
  readOnly: f => { f.root.readOnly = true; },
  locked: f => { f.state.blocks = f.state.blocks.map(block => ({ ...block, locked: true })); },
  binding: f => f.replaceBlock({ organization_context_package_binding_id: "managed-package" }),
  removed: f => { f.state.blocks = []; },
  surface: f => { f.root.surface = "library"; },
  store: f => { f.root.store = { ...f.store }; },
};
for (const [reason, retire] of Object.entries(retirements)) {
  test("pending reference editor retires on " + reason + " without restoring stale focus", async t => {
    const f = fixture(t), child = f.open(), save = f.captureEvent(child), call = f.state.calls[0];
    f.external.focus(); retire(f); f.paint();
    assert.equal(call.current(), false); assert.equal(f.root.compositor, null); assert.equal(child.isConnected, false);
    call.completion.resolve(true); await save; f.paint();
    assert.equal(f.root.compositor, null); assert.equal(f.closes(child), 0); assert.equal(f.doc.activeElement, f.external);
    assert.equal(f.state.calls.length, 1); assert.deepEqual(f.state.toasts, []);
  });
}

test("late old completion and old-child close/capture events cannot affect a new editor", async t => {
  const f = fixture(t), previous = f.open(), pending = f.captureEvent(previous), first = f.state.calls[0];
  f.state.source = {}; f.paint();
  const current = f.open(); assert.notEqual(current, previous);
  previous.invoke("composition-close"); previous.invoke("composition-capture", { detail: first.input }); f.paint();
  assert.equal(f.root.compositor, current); assert.equal(f.state.calls.length, 1);
  first.completion.resolve(true); await pending; f.paint();
  assert.equal(f.root.compositor, current); assert.equal(current.dialog.open, true); assert.equal(current.disabled, false);
  assert.equal(f.closes(previous), 0); assert.equal(f.closes(current), 0);
});

test("disconnect invalidates pending ownership and late failure cannot toast into the new surface", async t => {
  const f = fixture(t), child = f.open(), save = f.captureEvent(child), call = f.state.calls[0];
  f.external.focus(); f.retire(); assert.equal(call.current(), false);
  call.completion.reject(new Error("Late original save failure")); await save;
  assert.equal(f.closes(child), 0); assert.equal(f.doc.activeElement, f.external); assert.deepEqual(f.state.toasts, []);
});

for (const reason of ["source", "disabled", "close"]) {
  test("local raster capture retires on " + reason + " while source bytes are pending", async t => {
    const f = fixture(t, { editor: false }), child = f.root;
    f.state.fetchGate = deferred(); f.control(child, "capture").invoke("click");
    await until(() => f.state.requests.length === 1, "The actual compositor requested its first owned image");
    const request = f.state.requests[0];
    if (reason === "source") f.set({ sources: [{ ...f.source, contentHash: "d".repeat(64) }] });
    else if (reason === "disabled") f.set({ disabled: true });
    else { f.control(child, "close").focus(); f.control(child, "close").invoke("click"); }
    assert.equal(request.init.signal.aborted, true);
    f.state.fetchGate.resolve();
    await until(() => f.state.canvases[0]?.width === 0, "Retired capture released its canvas");
    assert.equal(f.state.bitmapCalls.length, 0); assert.equal(f.state.emitted.some(item => item.event.type === "composition-capture"), false);
  });
}

test("closing during bitmap decode closes the late bitmap and emits no stale image", async t => {
  const f = fixture(t, { editor: false }), child = f.root;
  f.state.bitmapGate = deferred(); f.control(child, "capture").invoke("click");
  await until(() => f.state.bitmapCalls.length === 1, "Actual image verification reached the bitmap port");
  const bitmap = f.state.bitmapCalls[0]; f.external.focus(); child.closeForOwner();
  f.state.bitmapGate.resolve(); await until(() => bitmap.closed === 1, "The late decoded bitmap was disposed");
  assert.equal(f.state.canvases[0].width, 0); assert.equal(f.state.canvases[0].paints, 0);
  assert.equal(f.state.emitted.some(item => item.event.type === "composition-capture"), false);
  assert.equal(f.closes(child), 0); assert.equal(f.doc.activeElement, f.external);
});
