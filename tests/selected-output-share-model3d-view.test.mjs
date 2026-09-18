import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as assetModule from "../src/model/model3d-assets.ts";
import * as viewModule from "../src/model/model3d-view.ts";
import { FORMA_MODEL3D_VIEWER_MESSAGES } from "../src/components/design-system/locales/model3d-viewer-messages.ts";

// Execute the entire production module. Only imports and environmental ports
// are substituted. The GLB validator and camera policy are the actual modules.
// This is finite synthetic lifecycle evidence, not WebGL/browser/AT evidence.
const SOURCE = new URL("../src/components/selected-output-share-model3d-view.ts", import.meta.url);
const ORIGIN = "https://fixture.invalid";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(setImmediate);
const locale = language => ({ locale: language, t: (key, fallback) => FORMA_MODEL3D_VIEWER_MESSAGES[language]?.[key] ?? fallback,
  number: value => String(value), system: value => language === "en" ? value : language + ":" + value });
const keyEvent = (key, extra = {}) => { const event = new Event("keydown", { cancelable: true }); Object.assign(event, { key, ...extra }); return event; };

function triangle(mutate = () => {}) {
  const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }] };
  mutate(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json)), padded = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(28 + padded + 36), data = new DataView(bytes.buffer);
  data.setUint32(0, 0x46546c67, true); data.setUint32(4, 2, true); data.setUint32(8, bytes.length, true);
  data.setUint32(12, padded, true); data.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + padded); bytes.set(encoded, 20);
  data.setUint32(20 + padded, 36, true); data.setUint32(24 + padded, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => data.setFloat32(28 + padded + index * 4, value, true));
  return bytes;
}

class ElementPort extends EventTarget {
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.parentElement = null;
    this.children = []; this.attributes = new Map(); this.style = {}; this.dataset = {}; this.clientWidth = 420; this._text = ""; this._connected = false; }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._connected; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get className() { return this.attributes.get("class") ?? ""; }
  set className(value) { this.attributes.set("class", String(value)); }
  get id() { return this.attributes.get("id") ?? ""; }
  set id(value) { this.attributes.set("id", String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...items) { for (const item of items) { item.remove(); item.parentElement = this; this.children.push(item); } }
  appendChild(item) { this.append(item); return item; }
  prepend(...items) { for (const item of [...items].reverse()) { item.remove(); item.parentElement = this; this.children.unshift(item); } }
  replaceChildren(...items) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ""; this.append(...items); }
  remove() { if (this.parentElement) { const owner = this.parentElement; owner.children.splice(owner.children.indexOf(this), 1); this.parentElement = null; } }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientWidth, top: 0, left: 0 }; }
  querySelectorAll(selector) { const result = []; const match = element => selector.startsWith(".") ? element.className.split(/\s+/u).includes(selector.slice(1))
    : selector.startsWith("#") ? element.id === selector.slice(1) : selector.startsWith("[") ? element.hasAttribute(selector.slice(1, -1)) : element.tagName.toLowerCase() === selector;
    const visit = element => { for (const child of element.children) { if (match(child)) result.push(child); visit(child); } }; visit(this); return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
}

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(value) { return this.set(value, value, value); }
  fromArray(value) { return this.set(...value); }
  toArray() { return [this.x, this.y, this.z]; }
  copy(value) { return this.set(value.x, value.y, value.z); }
  clone() { return new Vector(this.x, this.y, this.z); }
  add(value) { this.x += value.x; this.y += value.y; this.z += value.z; return this; }
  sub(value) { this.x -= value.x; this.y -= value.y; this.z -= value.z; return this; }
  multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  setLength(value) { return this.multiplyScalar(value / (this.length() || 1)); }
  setFromSpherical(value) { return this.set(value.radius * Math.sin(value.phi) * Math.sin(value.theta), value.radius * Math.cos(value.phi), value.radius * Math.sin(value.phi) * Math.cos(value.theta)); }
}
class Spherical {
  setFromVector3(value) { this.radius = value.length(); this.theta = Math.atan2(value.x, value.z); this.phi = Math.acos(value.y / this.radius); return this; }
  makeSafe() { this.phi = Math.max(1e-6, Math.min(Math.PI - 1e-6, this.phi)); return this; }
}
class ObjectPort {
  constructor() { this.isObject3D = true; this.children = []; this.position = new Vector(); this.scale = new Vector(1, 1, 1); }
  add(...objects) { this.children.push(...objects); }
  traverse(callback) { callback(this); this.children.forEach(child => child.traverse(callback)); }
  clear() { this.children.length = 0; }
}

async function fixture(t, options = {}) {
  const state = { imports: [], parses: [], reservations: 0, maxReservations: 0, allocations: [], managers: [], renderers: [], controls: [], resizes: [],
    createdUrls: [], revokedUrls: [], accesses: 0, current: options.current ?? true, fetches: 0 };
  const document = { location: { origin: ORIGIN }, defaultView: { devicePixelRatio: 3 }, createElement(tag) { return new ElementPort(tag, document); } };
  const host = document.createElement("main"); host._connected = true;
  const resource = (name, fields = {}) => { const value = { name, ...fields, disposeCount: 0, dispose() { this.disposeCount++; } }; state.allocations.push(value); return value; };
  const bitmap = { closeCount: 0, close() { this.closeCount++; } };
  const texture = resource("texture", { isTexture: true, source: { data: bitmap } });
  const geometry = resource("geometry", { isBufferGeometry: true });
  const material = resource("material", { isMaterial: true, map: texture, normalMap: texture });
  const model = new ObjectPort(), mesh = new ObjectPort(); Object.assign(mesh, { isMesh: true, geometry, material: [material, material] }); model.add(mesh);
  const orphan = resource("orphan texture", { isTexture: true, source: { data: [bitmap] } });
  const associations = new Map([[texture, {}], [material, {}], [geometry, {}], [orphan, {}], [mesh, {}]]);
  const result = { scene: model, scenes: [model, model], animations: [] };
  const URLPort = class extends URL {};
  URLPort.createObjectURL = blob => { const url = ORIGIN.replace(/^https:/u, "blob:https:") + "/owned-" + (state.createdUrls.length + 1); state.createdUrls.push({ url, blob }); return url; };
  URLPort.revokeObjectURL = url => state.revokedUrls.push(url);
  class Manager {
    constructor() { this.abortCount = 0; this.pending = 0; this.started = []; this.ended = []; this.handlers = []; state.managers.push(this); }
    setURLModifier(callback) { this.modifier = callback; return this; }
    resolveURL(url) { return this.modifier ? this.modifier(url) : url; }
    itemStart(url) { this.started.push(url); this.pending++; this.onStart?.(url, 0, this.pending); }
    itemEnd(url) { this.ended.push(url); this.pending--; if (this.pending === 0) this.onLoad?.(); }
    itemError(url) { this.onError?.(url); }
    abort() { this.abortCount++; return this; }
    addHandler(regex, loader) { this.handlers.push({ regex, loader }); return this; }
    getHandler(url) { return this.handlers.find(item => item.regex.test(url))?.loader ?? null; }
  }
  class Renderer {
    constructor(parameters) { if (options.rendererError) throw options.rendererError; this.parameters = parameters; this.domElement = document.createElement("canvas");
      this.renderCount = 0; this.disposeCount = 0; this.lossCount = 0; state.renderers.push(this); }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(...values) { this.size = values; }
    setClearColor(...values) { this.clearColor = values; }
    render(scene, camera) { this.renderCount++; this.scene = scene; this.camera = camera; }
    dispose() { this.disposeCount++; }
    forceContextLoss() { this.lossCount++; }
  }
  class Controls extends EventTarget {
    constructor(camera, canvas) { super(); if (options.controlsError) throw options.controlsError; this.camera = camera; this.canvas = canvas; this.target = new Vector(); this.disposeCount = 0; this.updateCount = 0; state.controls.push(this); }
    update() { this.updateCount++; this.dispatchEvent(new Event("change")); }
    dispose() { this.disposeCount++; }
  }
  class Resize {
    constructor(callback) { if (options.resizeError) throw options.resizeError; this.callback = callback; this.disconnectCount = 0; this.targets = []; state.resizes.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnectCount++; this.targets = []; }
  }
  class Camera extends ObjectPort { constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); } updateProjectionMatrix() {} }
  class Box { setFromObject() { return this; } getSize(target) { return target.set(1, 1, 0); } getCenter(target) { return target.set(0.5, 0.5, 0); } isEmpty() { return false; } }
  class Room extends ObjectPort { constructor() { super(); this.disposeCount = 0; state.room = this; } dispose() { this.disposeCount++; } }
  class PMREM { constructor() { if (options.pmremError) throw options.pmremError; this.disposeCount = 0; state.pmrem = this; }
    fromScene() { if (options.environmentError) throw options.environmentError; return state.environment = resource("environment", { texture: {} }); } dispose() { this.disposeCount++; } }
  const three = { Vector3: Vector, Spherical, Scene: ObjectPort, Group: ObjectPort, Box3: Box, PerspectiveCamera: Camera,
    WebGLRenderer: Renderer, LoadingManager: Manager, PMREMGenerator: PMREM, HemisphereLight: ObjectPort, DirectionalLight: ObjectPort,
    SRGBColorSpace: "srgb", ACESFilmicToneMapping: "aces" };
  class Loader {
    constructor(manager) { this.manager = manager; this.plugins = []; state.loader = this; }
    register(callback) { this.plugins.push(callback); return this; }
    async parseAsync(buffer, path) {
      state.parses.push({ buffer, path, snapshot: new Uint8Array(buffer).slice() });
      const parser = { associations, options: { manager: this.manager, path: "" }, json: options.parserJson ?? { images: [] },
        textureLoader: { load() { throw Error("unexpected unowned image load"); } },
        getDependency: async (kind, index) => {
          if (options.getDependency) return await options.getDependency({ kind, index, parser, manager: this.manager, URL: URLPort, state });
          assert.equal(kind, "bufferView"); return new Uint8Array([137, 80, 78, 71]).buffer;
        } };
      state.parser = parser; for (const callback of this.plugins) callback(parser);
      if (options.parse) return await options.parse({ parser, manager: this.manager, result, URL: URLPort, state });
      return result;
    }
  }
  const dynamics = new Map([["three", three], ["three/addons/loaders/GLTFLoader.js", { GLTFLoader: Loader }],
    ["three/addons/controls/OrbitControls.js", { OrbitControls: Controls }], ["three/addons/environments/RoomEnvironment.js", { RoomEnvironment: Room }]]);
  const bytes = options.bytes ?? triangle(), file = Object.freeze({ synthetic: "verified file identity" }), output = Object.freeze({ synthetic: "public output identity", output: "model3d" });
  const media = {
    accessVerifiedSelectedOutputShareMedia(actualFile, actualOutput) { assert.equal(actualFile, file); assert.equal(actualOutput, output); state.accesses++;
      return options.verified === false ? null : { blob: new Blob([bytes], { type: "model/gltf-binary" }), fileName: "model.glb" }; },
    async withVerifiedSelectedOutputShareMediaBytes(actualFile, actualOutput, operation) { assert.equal(actualFile, file); assert.equal(actualOutput, output);
      state.reservations++; state.maxReservations = Math.max(state.maxReservations, state.reservations); const copy = bytes.slice();
      try { return await operation(copy); } finally { copy.fill(0); state.reservations--; } },
  };
  const source = fs.readFileSync(SOURCE, "utf8"), statics = new Map();
  const syntax = ts.createSourceFile(SOURCE.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of syntax.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    const name = node.moduleSpecifier.text;
    if (name.endsWith(".css")) statics.set(name, {});
    else if (name.endsWith("selected-output-share-media-client.ts")) statics.set(name, media);
    else if (name.endsWith("model3d-assets.ts")) statics.set(name, assetModule);
    else if (name.endsWith("model3d-view.ts")) statics.set(name, viewModule);
    else if (name.startsWith(".")) statics.set(name, await import(new URL(name.endsWith(".ts") ? name : name + ".ts", SOURCE)));
    else throw Error("Unexpected static dependency " + name);
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [context => {
      const visit = node => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? ts.factory.updateCallExpression(node, ts.factory.createIdentifier("importPort"), node.typeArguments, node.arguments)
        : ts.visitEachChild(node, visit, context);
      return root => ts.visitNode(root, visit);
    }] } }).outputText;
  const exports = {}, controller = new AbortController();
  const importPort = async name => { assert.ok(dynamics.has(name), "closed dynamic module " + name); state.imports.push(name); await options.importGate?.promise; return dynamics.get(name); };
  const forbiddenFetch = () => { state.fetches++; throw Error("Network forbidden in bytes-only public viewer"); };
  const globals = { require: name => { assert.ok(statics.has(name), "closed static dependency " + name); return statics.get(name); }, exports, importPort,
    URL: URLPort, ResizeObserver: Resize, document, window: document.defaultView, location: document.location, devicePixelRatio: 3,
    fetch: forbiddenFetch, self: { URL: URLPort }, HTMLElement: ElementPort };
  new Function(...Object.keys(globals), code)(...Object.values(globals));
  assert.equal(typeof exports.mountSelectedOutputShareModel3d, "function");
  const mount = () => exports.mountSelectedOutputShareModel3d(host, file, output, { locale: locale("en"), signal: controller.signal, isCurrent: () => state.current });
  const settle = async predicate => { for (let attempt = 0; attempt < 30 && !predicate(); attempt++) await turn(); assert.ok(predicate(), "finite viewer state settles"); };
  t.after(() => { controller.abort(); assert.equal(state.fetches, 0); });
  return { state, host, document, controller, mount, settle, model, mesh, bitmap, texture, geometry, material, orphan, result, bytes, URL: URLPort };
}

test("real GLB framing and resource validation precedes any Three import", async t => {
  const invalidHeader = triangle(); invalidHeader[0] = 0;
  for (const bytes of [new Uint8Array(), invalidHeader, triangle().slice(0, -1),
    triangle(json => { json.buffers[0].uri = "https://foreign.invalid/geometry.bin"; }),
    triangle(json => { json.images = [{ uri: "blob:" + ORIGIN + "/foreign" }]; })]) {
    const f = await fixture(t, { bytes }); await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u);
    assert.deepEqual(f.state.imports, []); assert.deepEqual(f.state.parses, []); assert.equal(f.state.reservations, 0); assert.equal(f.host.children.length, 0);
  }
});

test("noncurrent, disconnected, aborted and unverified handles cannot start imports or byte reservations", async t => {
  for (const choice of ["current", "disconnected", "aborted", "unverified"]) {
    const f = await fixture(t, { current: choice !== "current", verified: choice !== "unverified" });
    if (choice === "disconnected") f.host._connected = false;
    if (choice === "aborted") f.controller.abort();
    await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u);
    assert.equal(f.state.maxReservations, 0); assert.deepEqual(f.state.imports, []); assert.equal(f.host.children.length, 0);
  }
});

test("valid bytes parse once with an empty base path and expose only local accessible orbit, zoom and reset", async t => {
  const f = await fixture(t), view = await f.mount();
  assert.equal(f.state.imports.length, 4); assert.equal(new Set(f.state.imports).size, 4); assert.equal(f.state.parses.length, 1);
  assert.equal(f.state.parses[0].path, ""); assert.deepEqual(new Uint8Array(f.state.parses[0].buffer), f.bytes);
  assert.equal(f.state.reservations, 1, "copied bytes stay reserved through active presentation"); assert.equal(f.state.maxReservations, 1);
  const canvas = f.host.querySelector("canvas"), buttons = f.host.querySelectorAll("button"), renderer = f.state.renderers[0], controls = f.state.controls[0];
  assert.ok(canvas?.isConnected); assert.equal(canvas.tabIndex, 0); assert.equal(canvas.getAttribute("role"), "img");
  assert.equal(canvas.getAttribute("aria-label"), "3D model view");
  assert.ok(f.host.querySelector("#" + canvas.getAttribute("aria-describedby"))?.textContent.includes("arrow keys"));
  assert.deepEqual(buttons.map(button => button.textContent), ["Orbit left", "Orbit right", "Orbit up", "Orbit down", "Zoom in", "Zoom out", "Reset view"]);
  assert.ok(buttons.every(button => button.type === "button" && button.disabled === false));
  assert.equal(f.host.querySelector(".model3d-viewer-controls").getAttribute("role"), "group");
  assert.equal(f.host.querySelector(".model3d-viewer-frame").getAttribute("aria-busy"), "false");
  assert.equal(renderer.pixelRatio, 2); assert.deepEqual(renderer.size, [420, 420, false]); assert.equal(renderer.parameters.preserveDrawingBuffer, false);
  assert.equal(controls.enablePan, false); assert.equal(controls.enableDamping, false);
  const initial = renderer.camera.position.toArray(); buttons[0].dispatchEvent(new Event("click")); assert.notDeepEqual(renderer.camera.position.toArray(), initial);
  buttons[6].dispatchEvent(new Event("click")); assert.deepEqual(renderer.camera.position.toArray(), initial);
  for (let index = 0; index < 100; index++) buttons[4].dispatchEvent(new Event("click"));
  assert.ok(Math.abs(renderer.camera.position.length() - viewModule.MODEL3D_MIN_DISTANCE) < 1e-9);
  for (let index = 0; index < 100; index++) buttons[5].dispatchEvent(new Event("click"));
  assert.ok(Math.abs(renderer.camera.position.length() - viewModule.MODEL3D_MAX_DISTANCE) < 1e-9);
  canvas.dispatchEvent(keyEvent("Home")); assert.deepEqual(renderer.camera.position.toArray(), initial);
  for (const selector of ["a", "img", "input", "select", "form", "textarea"]) assert.equal(f.host.querySelectorAll(selector).length, 0, selector);
  assert.doesNotMatch(f.host.textContent, /capture|save|reference|context/iu);
  assert.deepEqual(Object.keys(view).sort(), ["dispose", "refresh"]); view.dispose(); await f.settle(() => f.state.reservations === 0);
  assert.deepEqual(f.state.parses[0].snapshot, f.bytes); assert.ok(new Uint8Array(f.state.parses[0].buffer).every(byte => byte === 0), "owner zeroes released copy after renderer retires");
});

test("locale refresh only updates display labels and never reloads, imports or resets the camera", async t => {
  const f = await fixture(t), view = await f.mount(), renderer = f.state.renderers[0];
  f.host.querySelectorAll("button")[0].dispatchEvent(new Event("click")); const camera = renderer.camera.position.toArray(), canvas = renderer.domElement;
  for (const language of ["fr", "ja", "ar", "en"]) {
    view.refresh(locale(language));
    assert.equal(f.host.querySelectorAll("button")[0].textContent, FORMA_MODEL3D_VIEWER_MESSAGES[language]["model3d.viewer.orbitLeft"]);
    assert.equal(canvas.getAttribute("aria-label"), FORMA_MODEL3D_VIEWER_MESSAGES[language]["model3d.viewer.label"]);
    assert.deepEqual(renderer.camera.position.toArray(), camera); assert.equal(f.state.imports.length, 4); assert.equal(f.state.parses.length, 1); assert.equal(f.state.accesses, 1);
  }
  view.dispose();
});

test("keyboard handling preserves IME, modifier shortcuts and unrelated keys", async t => {
  const f = await fixture(t), view = await f.mount(), renderer = f.state.renderers[0], canvas = renderer.domElement;
  for (const extra of [{ isComposing: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
    const before = renderer.renderCount, event = keyEvent("ArrowLeft", extra); canvas.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false); assert.equal(renderer.renderCount, before);
  }
  const unknown = keyEvent("Enter"), before = renderer.renderCount; canvas.dispatchEvent(unknown); assert.equal(unknown.defaultPrevented, false); assert.equal(renderer.renderCount, before);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "_", "Home"]) {
    const event = keyEvent(key), previous = renderer.renderCount; canvas.dispatchEvent(event); assert.equal(event.defaultPrevented, true); assert.ok(renderer.renderCount > previous);
  }
  view.dispose();
});

test("abort during lazy imports synchronously removes its mount but retains copied-byte reservation until imports settle", async t => {
  const gate = deferred(), f = await fixture(t, { importGate: gate }), pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u);
  await f.settle(() => f.state.imports.length === 4); assert.equal(f.state.reservations, 1); assert.equal(f.host.children.length, 1);
  f.controller.abort(); assert.equal(f.host.children.length, 0); assert.equal(f.state.reservations, 1);
  await rejected; assert.equal(f.state.reservations, 1, "aborted mount rejects before its unabortable imports settle");
  gate.resolve(); await f.settle(() => f.state.reservations === 0); assert.equal(f.state.parses.length, 0); assert.equal(f.state.managers.length, 0);
});

test("ownership is rechecked after lazy imports even without an abort notification", async t => {
  const gate = deferred(), f = await fixture(t, { importGate: gate }), pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u);
  await f.settle(() => f.state.imports.length === 4); f.state.current = false; gate.resolve(); await rejected;
  assert.equal(f.state.parses.length, 0); assert.equal(f.host.children.length, 0); assert.equal(f.state.reservations, 0);
});

test("abort during parsing retires associations synchronously and cleans late returned roots without double disposal", async t => {
  const gate = deferred(), f = await fixture(t, { parse: async ({ result }) => { await gate.promise; return result; } });
  const pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u);
  await f.settle(() => f.state.parses.length === 1); f.controller.abort();
  assert.equal(f.host.children.length, 0); assert.equal(f.state.managers[0].abortCount, 1); assert.equal(f.state.reservations, 1);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
  assert.equal(f.bitmap.closeCount, 1); await rejected; assert.equal(f.state.reservations, 1);
  gate.resolve(); await f.settle(() => f.state.reservations === 0); assert.equal(f.state.renderers.length, 0);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
  assert.equal(f.bitmap.closeCount, 1);
});

for (const change of ["root detached", "root reparented", "document changed", "host disconnected"]) test(change + " during parse cannot mount a stale canvas", async t => {
  const gate = deferred(), f = await fixture(t, { parse: async ({ result }) => { await gate.promise; return result; } });
  const pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u); await f.settle(() => f.state.parses.length === 1);
  const root = f.host.children[0], other = f.document.createElement("aside"); other._connected = true;
  if (change === "root detached") root.remove();
  else if (change === "root reparented") other.append(root);
  else if (change === "document changed") f.host.ownerDocument = { ...f.document };
  else f.host._connected = false;
  gate.resolve(); await rejected; assert.equal(f.state.renderers.length, 0); assert.equal(f.host.querySelectorAll("canvas").length, 0);
  assert.equal(other.children.length, 0); assert.equal(f.state.reservations, 0);
});

for (const url of ["https://foreign.invalid/image.png", ORIGIN + "/api/media/private", "//foreign.invalid/image.png", "../image.png", "data:image/png;base64,AAAA", "blob:https://foreign.invalid/asset", "blob:" + ORIGIN + "/asset?secret=1", "blob:" + ORIGIN + "/asset#fragment"]) {
  test("a swallowed loader URL refusal still rejects the completed parse: " + url, async t => {
    let refusal = false;
    const f = await fixture(t, { parse: ({ manager, result }) => { try { manager.resolveURL(url); } catch { refusal = true; } return result; } });
    await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u); assert.equal(refusal, true);
    assert.equal(f.state.renderers.length, 0); assert.equal(f.host.children.length, 0); assert.deepEqual(f.state.revokedUrls, []);
  });
}

test("validated parser's same-origin embedded blob is allowed and revoked at settlement", async t => {
  let owned;
  const f = await fixture(t, { parse: ({ manager, result, URL }) => { owned = URL.createObjectURL(new Blob(["synthetic embedded image"])); assert.equal(manager.resolveURL(owned), owned); return result; } });
  const view = await f.mount(); assert.equal(f.state.reservations, 1);
  view.dispose(); await f.settle(() => f.state.reservations === 0); assert.deepEqual(f.state.revokedUrls, [owned]);
});

test("manager image errors reject even when GLTFLoader fulfills its texture-swallowing parse", async t => {
  const f = await fixture(t, { parse: ({ manager, result }) => { manager.itemError("synthetic embedded image"); return result; } });
  await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u); assert.equal(f.state.renderers.length, 0); assert.equal(f.host.children.length, 0);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
});

test("first parse rejection retains reservation through sibling image drain and cleans resources attached after retirement", async t => {
  let manager, parser, owned;
  const f = await fixture(t, { parse: value => { ({ manager, parser } = value); owned = value.URL.createObjectURL(new Blob(["synthetic image"]));
    manager.resolveURL(owned); manager.itemStart(owned); throw Error("synthetic first texture rejected"); } });
  const pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u);
  await f.settle(() => f.state.managers[0]?.abortCount === 1);
  assert.equal(f.state.reservations, 1); assert.deepEqual(f.state.revokedUrls, [owned]); f.controller.abort(); assert.equal(f.host.children.length, 0);
  let disposed = 0, closed = 0; const lateBitmap = { close() { closed++; } }, lateTexture = { isTexture: true, source: { data: lateBitmap }, dispose() { disposed++; } };
  parser.associations.set(lateTexture, {}); f.texture.source.data = [f.bitmap, lateBitmap];
  const lateUrl = f.URL.createObjectURL(new Blob(["late embedded image"]));
  assert.throws(() => manager.resolveURL(lateUrl), /selected_output_model3d_unavailable/u);
  assert.ok(f.state.revokedUrls.includes(lateUrl)); assert.equal(f.state.reservations, 1);
  await rejected; manager.itemEnd(owned); await f.settle(() => f.state.reservations === 0);
  assert.equal(disposed, 1); assert.equal(closed, 1); assert.equal(f.texture.disposeCount, 1);
});

test("context loss removes canvas and frees shared resources once; late callbacks and repeated disposal cannot draw", async t => {
  const f = await fixture(t), view = await f.mount(), renderer = f.state.renderers[0], controls = f.state.controls[0], resize = f.state.resizes[0], canvas = renderer.domElement;
  const event = new Event("webglcontextlost", { cancelable: true }); canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(canvas.isConnected, false); assert.equal(f.host.querySelector("canvas"), null);
  assert.equal(renderer.disposeCount, 1); assert.equal(renderer.lossCount, 1); assert.equal(controls.disposeCount, 1); assert.equal(resize.disconnectCount, 1);
  assert.equal(f.state.environment.disposeCount, 1); assert.equal(f.state.room.disposeCount, 1); assert.equal(f.state.pmrem.disposeCount, 1);
  assert.equal(f.host.querySelector(".model3d-viewer-status").getAttribute("role"), "alert"); assert.ok(f.host.textContent.includes("Unavailable"));
  assert.ok(f.host.querySelectorAll("button").every(button => button.disabled));
  const draws = renderer.renderCount; controls.dispatchEvent(new Event("change")); resize.callback(); canvas.dispatchEvent(keyEvent("Home"));
  view.dispose(); view.dispose(); f.controller.abort(); assert.equal(renderer.renderCount, draws); assert.equal(f.host.children.length, 0);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
  assert.equal(f.bitmap.closeCount, 1); assert.equal(renderer.disposeCount, 1); assert.equal(renderer.lossCount, 1);
});

test("renderer initialization failure cleans parsed CPU resources and releases its byte reservation", async t => {
  const f = await fixture(t, { rendererError: Error("synthetic unavailable GPU") });
  await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u); assert.equal(f.state.reservations, 0); assert.equal(f.host.children.length, 0);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
  assert.equal(f.bitmap.closeCount, 1); assert.equal(f.state.renderers.length, 0);
});

for (const stage of ["pmremError", "environmentError", "controlsError", "resizeError"]) test(stage + " retires every resource already initialized", async t => {
  const f = await fixture(t, { [stage]: Error("synthetic " + stage) });
  await assert.rejects(f.mount(), /selected_output_model3d_unavailable/u);
  assert.equal(f.state.reservations, 0); assert.equal(f.host.children.length, 0);
  assert.equal(f.state.renderers[0].disposeCount, 1); assert.equal(f.state.renderers[0].lossCount, 1);
  assert.equal(f.state.room.disposeCount, 1);
  if (f.state.pmrem) assert.equal(f.state.pmrem.disposeCount, 1);
  if (f.state.environment) assert.equal(f.state.environment.disposeCount, 1);
  if (f.state.controls.length) assert.equal(f.state.controls[0].disposeCount, 1);
  for (const item of [f.geometry, f.material, f.texture, f.orphan]) assert.equal(item.disposeCount, 1, item.name);
  assert.equal(f.bitmap.closeCount, 1);
});

test("successful disposal and abort remove canvas synchronously without touching a newer sibling", async t => {
  const f = await fixture(t), view = await f.mount(), renderer = f.state.renderers[0];
  const nextOwner = f.document.createElement("section"); nextOwner.textContent = "new owner"; f.host.append(nextOwner);
  f.controller.abort(); assert.equal(renderer.domElement.isConnected, false); assert.deepEqual(f.host.children, [nextOwner]);
  const draws = renderer.renderCount; f.state.resizes[0].callback(); f.state.controls[0].dispatchEvent(new Event("change"));
  view.refresh(locale("ar")); view.dispose(); view.dispose();
  assert.equal(renderer.renderCount, draws); assert.equal(renderer.disposeCount, 1); assert.equal(renderer.lossCount, 1);
  assert.equal(f.state.managers[0].abortCount, 1); assert.equal(f.bitmap.closeCount, 1); assert.deepEqual(f.host.children, [nextOwner]);
});

test("current-owner retirement from resize prevents further rendering or stale button actions", async t => {
  const f = await fixture(t), view = await f.mount(), renderer = f.state.renderers[0], buttons = f.host.querySelectorAll("button");
  const previous = renderer.renderCount; f.state.current = false; f.state.resizes[0].callback();
  assert.equal(f.host.children.length, 0); assert.equal(renderer.disposeCount, 1);
  for (const button of buttons) button.dispatchEvent(new Event("click"));
  assert.equal(renderer.renderCount, previous); view.dispose(); assert.equal(renderer.disposeCount, 1);
});

test("pending sibling image work keeps the successful parse's byte reservation until it drains", async t => {
  let manager, owned;
  const f = await fixture(t, { parse: value => { manager = value.manager; owned = value.URL.createObjectURL(new Blob(["synthetic image"]));
    manager.resolveURL(owned); manager.itemStart(owned); return value.result; } });
  const pending = f.mount(); await f.settle(() => f.host.querySelector("canvas"));
  assert.equal(f.state.reservations, 1); assert.deepEqual(f.state.revokedUrls, []);
  const view = await pending; manager.itemEnd(owned); await turn(); assert.equal(f.state.reservations, 1, "ready model owns its copied byte reservation");
  view.dispose(); await f.settle(() => f.state.reservations === 0); assert.deepEqual(f.state.revokedUrls, [owned]);
});

test("late resolution of an aborted parser cannot remove its newer sibling", async t => {
  const gate = deferred(), f = await fixture(t, { parse: async ({ result }) => { await gate.promise; return result; } });
  const pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u); await f.settle(() => f.state.parses.length === 1);
  f.controller.abort(); const nextOwner = f.document.createElement("section"); nextOwner.textContent = "new owner"; f.host.append(nextOwner);
  gate.resolve(); await rejected; assert.deepEqual(f.host.children, [nextOwner]); assert.equal(f.state.renderers.length, 0);
  await f.settle(() => f.state.reservations === 0);
});

test("parse rejection before any itemStart holds bytes through a late dependency and its resource continuation", async t => {
  const start = deferred(), decode = deferred(), continuation = deferred(); let manager, dependency, lateUrl, disposed = 0, closed = 0;
  const lateBitmap = { close() { closed++; } }, lateTexture = { isTexture: true, source: { data: lateBitmap }, dispose() { disposed++; } };
  const f = await fixture(t, {
    getDependency: async context => {
      assert.equal(context.kind, "texture"); manager = context.manager; await start.promise;
      lateUrl = context.URL.createObjectURL(new Blob(["synthetic late dependency"]));
      // Even when a loader catches URL refusal, its already-started decoder can
      // finish later. Neither abort nor itemEnd magically settles this promise.
      try { manager.resolveURL(lateUrl); } catch { /* loader's nested rejection boundary */ }
      manager.itemStart(lateUrl); await decode.promise; manager.itemEnd(lateUrl);
      await continuation.promise; return lateTexture;
    },
    parse: ({ parser }) => { dependency = parser.getDependency("texture", 0); dependency.catch(() => {}); throw Error("synthetic unrelated first dependency failure"); },
  });
  const pending = f.mount(), rejected = assert.rejects(pending, /selected_output_model3d_unavailable/u);
  await f.settle(() => f.state.managers[0]?.abortCount >= 1); await rejected;
  assert.equal(manager.started.length, 0); assert.equal(f.state.reservations, 1, "unstarted tracked dependency retains copied bytes");
  start.resolve(); await f.settle(() => manager.started.length === 1); assert.ok(f.state.revokedUrls.includes(lateUrl));
  decode.resolve(); await f.settle(() => manager.ended.length === 1);
  assert.equal(f.state.reservations, 1, "itemEnd precedes actual dependency continuation settlement"); assert.equal(disposed, 0);
  continuation.resolve(); await dependency; await f.settle(() => f.state.reservations === 0);
  assert.equal(disposed, 1, "resolved dependency resource is cleaned even without parser association"); assert.equal(closed, 1); assert.equal(f.host.children.length, 0);
});
