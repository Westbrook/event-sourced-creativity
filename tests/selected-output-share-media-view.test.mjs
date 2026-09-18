import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as mediaClient from "../src/selected-output-share-media-client.ts";
import * as messages from "../src/components/selected-output-share-messages.ts";
import * as shareModel from "../src/model/selected-output-share.ts";
import { wav, mp4 } from "./output-asset-fixtures.mjs";

// Complete production module and real opaque byte handles, with finite native
// DOM/event ports and one explicit lazy GLB module seam. No private Store,
// session, network, provider, browser playback, WebGL, layout or AT evidence.
const ROOT = new URL("../", import.meta.url);
const COMPONENT = "src/components/selected-output-share-media-view.ts";
const ORIGIN = "https://selected-media-fixture.invalid";
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async (condition = () => true) => {
  for (let index = 0; index < 50; index++) { await new Promise(setImmediate); if (condition()) return; }
  assert.ok(condition(), "bounded synthetic event/byte work settled");
};
const locale = value => ({ locale: value, t: key => key, system: value => value,
  number: (valueToFormat, options) => new Intl.NumberFormat(value, options).format(valueToFormat) });

function glbBytes() {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }));
  const length = Math.ceil(json.length / 4) * 4, bytes = new Uint8Array(20 + length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20); bytes.set(json, 20);
  return bytes;
}
function selected(kind = "audio", title = "Selected output") {
  const bytes = kind === "audio" ? wav() : kind === "video" ? mp4() : glbBytes();
  const media = { kind, mimeType: kind === "audio" ? "audio/wav" : kind === "video" ? "video/mp4" : "model/gltf-binary",
    byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(kind === "audio" ? { sampleRate: 8000, channels: 1, sampleCount: 4000, durationSeconds: .5, durationBasis: "pcm-samples" }
      : kind === "video" ? { width: 16, height: 16, durationSeconds: 1 } : {}) };
  const output = shareModel.validateSelectedOutputShareMediaPublicOutput({ schemaVersion: 1, kind: "selected-output-read",
    output: kind, title, expiresAt: new Date(NOW + 3_600_000).toISOString(), attribution: "Forma",
    content: { media, disclosure: kind === "audio" ? { watermark: "not-declared" } : kind === "video" ? { encoderDeclaration: null } : {} } }, NOW);
  assert.ok(output, "actual closed descriptor decoder accepts the synthetic recipient data");
  return { output, bytes };
}

function nativeDocument(trace) {
  class NodePort extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.localName = tag; this.ownerDocument = document;
      this.parentNode = null; this.childNodes = []; this.attributes = new Map(); this.style = {};
      this.disabled = false; this.hidden = false; this.controls = false; this.autoplay = false;
      this.preload = "auto"; this.currentTime = 0;
      this.dataset = new Proxy({}, { get: (_target, key) => this.getAttribute("data-" + String(key).replace(/[A-Z]/gu, value => "-" + value.toLowerCase())),
        set: (_target, key, value) => { this.setAttribute("data-" + String(key).replace(/[A-Z]/gu, part => "-" + part.toLowerCase()), value); return true; } });
      this.classList = { add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/u), ...values])].filter(Boolean).join(" "); },
        remove: (...values) => { this.className = this.className.split(/\s+/u).filter(value => !values.includes(value)).join(" "); } };
    }
    get isConnected() { return this.connectedRoot === true || Boolean(this.parentNode?.isConnected); }
    get parentElement() { return this.parentNode; }
    get children() { return this.childNodes.filter(child => child instanceof NodePort); }
    get firstChild() { return this.childNodes[0] ?? null; }
    get textContent() { return this.childNodes.map(child => typeof child === "string" ? child : child.textContent).join(""); }
    set textContent(value) { this.replaceChildren(String(value)); }
    get className() { return this.getAttribute("class") ?? ""; }
    set className(value) { this.setAttribute("class", value); }
    get src() { return this.getAttribute("src") ?? ""; }
    set src(value) { this.setAttribute("src", value); }
    get href() { return this.getAttribute("href") ?? ""; }
    set href(value) { this.setAttribute("href", value); }
    get download() { return this.getAttribute("download") ?? ""; }
    set download(value) { this.setAttribute("download", value); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); trace.push({ action: "set", node: this, name, value: String(value) }); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); trace.push({ action: "remove-attribute", node: this, name }); }
    toggleAttribute(name, force = !this.hasAttribute(name)) { if (force) this.setAttribute(name, ""); else this.removeAttribute(name); return force; }
    append(...nodes) { for (const node of nodes) { if (node instanceof NodePort) { node.remove(); node.parentNode = this; } this.childNodes.push(node); } }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.childNodes = []; this.append(...nodes); }
    remove() { if (this.parentNode) { this.parentNode.childNodes = this.parentNode.childNodes.filter(child => child !== this); this.parentNode = null; } trace.push({ action: "remove", node: this }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      const match = selector.match(/^(?:([a-z][a-z0-9-]*))?(?:\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\])?$/u);
      assert.ok(match, "finite DOM supports this observed selector: " + selector);
      return (!match[1] || this.localName === match[1]) && (!match[2] || this.hasAttribute(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3]));
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(/\s*,\s*/u).some(part => child.matches(part)) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    click() { if (!this.disabled) { trace.push({ action: "click", node: this }); return this.dispatchEvent(new Event("click", { cancelable: true })); } return true; }
    pause() { trace.push({ action: "pause", node: this }); }
    load() { trace.push({ action: "load", node: this, src: this.getAttribute("src") }); }
    play() { trace.push({ action: "play", node: this }); return Promise.resolve(); }
    focus() {
      if (!this.isConnected || this.disabled || this.hidden) return;
      for (let node = this.parentNode; node; node = node.parentNode) if (node.hidden) return;
      document.activeElement = this;
    }
  }
  const document = Object.assign(new EventTarget(), { location: { origin: ORIGIN }, createElement: tag => new NodePort(tag), activeElement: null, visibilityState: "visible" });
  document.body = document.createElement("body"); document.body.connectedRoot = true;
  return { document, NodePort };
}

function loadLeaf(document, NodePort, urls, loadModel, clock) {
  const source = fs.readFileSync(new URL(COMPONENT, ROOT), "utf8");
  const tree = ts.createSourceFile(COMPONENT, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const modules = new Map([
    ["../selected-output-share-media-client.ts", mediaClient], ["./selected-output-share-messages.ts", messages],
    ["../model/selected-output-share.ts", shareModel],
  ]);
  let lazyName;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(node.arguments.length, 1); assert.ok(ts.isStringLiteral(node.arguments[0]));
      assert.match(node.arguments[0].text, /^\.\/selected-output-share-model3d-view(?:\.ts)?$/u);
      assert.equal(lazyName, undefined, "one explicit lazy GLB-module seam"); lazyName = node.arguments[0].text;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    const name = node.moduleSpecifier.text;
    if (name === "./selected-output-share-media-view.css") {
      assert.equal(node.importClause, undefined, "stylesheet is the only side-effect import port"); modules.set(name, {});
    } else assert.ok(modules.has(name), "only the explicit real frontend dependencies: " + name);
  }
  assert.ok(lazyName, "GLB module stays behind an actual dynamic import");
  class UrlPort extends URL {
    static createObjectURL(blob) { assert.ok(blob instanceof Blob); const url = `blob:${ORIGIN}/${urls.created.length + 1}`; urls.created.push({ url, blob }); return url; }
    static revokeObjectURL(url) { urls.revoked.push(url); }
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  class DatePort extends Date { static now() { return clock.wall; } }
  new Function("require", "exports", "document", "URL", "HTMLElement", "HTMLMediaElement", "HTMLAudioElement", "HTMLVideoElement", "Date", "performance", "setTimeout", "clearTimeout", code)(
    name => { if (name === lazyName) return loadModel(); assert.ok(modules.has(name), "closed require " + name); return modules.get(name); },
    exports, document, UrlPort, NodePort, NodePort, NodePort, NodePort, DatePort, { now: () => clock.monotonic },
    (callback, delay) => { const id = ++clock.sequence; clock.timers.set(id, { callback, delay }); return id; },
    id => clock.timers.delete(id));
  assert.equal(typeof exports.mountSelectedOutputShareMedia, "function");
  return exports.mountSelectedOutputShareMedia;
}

async function fixture(t, { kind = "audio", language = "en", read, mountModel, mutable = false } = {}) {
  t.mock.method(Date, "now", () => NOW);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network is forbidden in the synthetic media leaf test"); });
  const trace = [], urls = { created: [], revoked: [] }, reads = [], readiness = [], handles = [], modelCalls = [], modelImports = [];
  const { document, NodePort } = nativeDocument(trace), host = document.createElement("main"); document.body.append(host);
  const selection = selected(kind), sourceAbort = new AbortController(); let current = true;
  const suppliedOutput = mutable ? structuredClone(selection.output) : selection.output;
  const clock = { wall: NOW, monotonic: 0, sequence: 0, timers: new Map() };
  const mint = async (value = selection, controls = { signal: new AbortController().signal, isCurrent: () => true }) => {
    const handle = await mediaClient.readSelectedOutputShareSourceMedia(value.output,
      { url: "/api/media/synthetic-fixture", mimeType: value.output.content.media.mimeType, byteLength: value.bytes.length,
        sha256: value.output.content.media.sha256 }, { ...controls, origin: ORIGIN, request: async (url, init) => {
        assert.equal(url, ORIGIN + "/api/media/synthetic-fixture"); assert.equal(init.method, "GET");
        const response = new Response(value.bytes.slice(), { headers: { "content-type": value.output.content.media.mimeType,
          "content-length": String(value.bytes.length) } }); Object.defineProperty(response, "url", { value: url }); return response;
      } });
    handles.push(handle); return handle;
  };
  const mount = loadLeaf(document, NodePort, urls, () => {
    modelImports.push(true);
    return { mountSelectedOutputShareModel3d: async (...args) => {
      modelCalls.push(args); if (mountModel) return mountModel(...args);
      const root = document.createElement("canvas"); args[0].append(root);
      const model = { disposed: false, locales: [], refresh(value) { this.locales.push(value.locale); }, dispose() { this.disposed = true; root.remove(); } };
      modelCalls.at(-1).view = model; return model;
    } };
  }, clock);
  const api = mount(host, suppliedOutput, { locale: locale(language), signal: sourceAbort.signal, isCurrent: () => current,
    readMedia: async (output, controls) => { reads.push({ output, controls }); return read ? read({ output, controls, mint, selection }) : mint(selection, controls); },
    onReady: value => readiness.push(value) });
  t.after(() => {
    api.dispose(); handles.forEach(mediaClient.disposeVerifiedSelectedOutputShareMedia);
    assert.deepEqual([...urls.revoked].sort(), urls.created.map(value => value.url).sort(), "every leaf-owned object URL is revoked exactly once");
    assert.equal(clock.timers.size, 0, "retired leaf retains no expiry timer");
  });
  return { api, host, document, trace, urls, reads, readiness, handles, modelCalls, modelImports, selection, suppliedOutput, sourceAbort, mint, clock,
    stale: () => { current = false; }, get: name => host.querySelector(`[data-selected-media-${name}]`),
    fireExpiry() { const next = clock.timers.entries().next().value; assert.ok(next); clock.timers.delete(next[0]); next[1].callback(); },
    async load() { const button = host.querySelector("[data-selected-media-load]"); assert.ok(button); button.click(); await settle(() => readiness.includes(true)); } };
}

test("mount stays inert and an explicit gesture starts only one in-flight exact descriptor read", async t => {
  const pending = deferred(), f = await fixture(t, { read: () => pending.promise });
  assert.equal(f.reads.length, 0); assert.equal(f.urls.created.length, 0); assert.equal(f.modelImports.length, 0);
  assert.equal(f.readiness.includes(true), false); assert.ok(f.get("load"));
  f.get("load").click(); f.get("load").click();
  assert.equal(f.reads.length, 1); assert.deepEqual(f.reads[0].output, f.selection.output);
  const handle = await f.mint(); pending.resolve(handle); await settle(() => f.readiness.includes(true));
  assert.equal(f.urls.created.length, 1); assert.equal(f.modelImports.length, 0);
});

for (const [kind, filename] of [["audio", "forma-audio.wav"], ["video", "forma-video.mp4"]]) {
  test(`${kind} exposes only the verified Blob, native user controls and fixed download name`, async t => {
    const f = await fixture(t, { kind }); await f.load();
    const player = f.host.querySelector(kind), download = f.get("download"); assert.ok(player); assert.ok(download);
    assert.equal(player.controls, true); assert.equal(player.preload, "none"); assert.equal(player.autoplay, false);
    assert.equal(f.trace.some(event => event.action === "play"), false);
    assert.equal(player.src, f.urls.created[0].url);
    assert.deepEqual(new Uint8Array(await f.urls.created[0].blob.arrayBuffer()), f.selection.bytes);
    download.click();
    const anchor = f.trace.filter(event => event.action === "click" && event.node.localName === "a").at(-1)?.node;
    assert.ok(anchor); assert.equal(anchor.href, player.src); assert.equal(anchor.download, filename);
    assert.equal(anchor.isConnected, false, "transient download anchor is removed immediately");
    assert.equal(f.urls.created[0].blob.type, f.selection.output.content.media.mimeType);
    assert.equal(f.reads.length, 1);
  });
}

test("forged and other-output handles never make the selected file ready", async t => {
  for (const wrong of ["forged", "different-output"]) {
    let offered;
    const f = await fixture(t, { read: async ({ mint }) => (offered = wrong === "forged" ? Object.freeze({}) : await mint(selected("audio", "Another output"))) });
    f.get("load").click(); await settle(() => Boolean(offered)); await settle();
    assert.equal(f.readiness.includes(true), false); assert.equal(f.urls.created.length, 0);
    assert.equal(f.host.querySelector("audio"), null); assert.equal(f.host.textContent.includes(messages.selectedOutputShareCopy("en").fileUnavailable), true);
    if (wrong !== "forged") assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(offered, selected("audio", "Another output").output), null);
  }
});

test("retirement aborts an outstanding read and disposes a late valid handle without presentation", async t => {
  const pending = deferred(), f = await fixture(t, { read: () => pending.promise });
  f.get("load").click(); const handle = await f.mint(); assert.ok(mediaClient.accessVerifiedSelectedOutputShareMedia(handle, f.selection.output));
  f.api.dispose(); assert.equal(f.reads[0].controls.signal.aborted, true); assert.equal(f.host.querySelector("audio"), null);
  pending.resolve(handle); await settle(() => mediaClient.accessVerifiedSelectedOutputShareMedia(handle, f.selection.output) === null);
  assert.equal(f.urls.created.length, 0); assert.equal(f.readiness.includes(true), false);
});

test("native playback retirement synchronously pauses, removes source, resets and revokes once", async t => {
  const f = await fixture(t, { kind: "video", read: ({ mint, selection }) => mint(selection) }); await f.load();
  const player = f.host.querySelector("video"), url = player.src, start = f.trace.length;
  f.api.dispose();
  const release = f.trace.slice(start).filter(event => event.node === player && ["pause", "remove-attribute", "load"].includes(event.action));
  assert.deepEqual(release.map(event => event.action), ["pause", "remove-attribute", "load"]);
  assert.equal(release[1].name, "src"); assert.equal(release[2].src, null, "native load runs only after source removal");
  assert.equal(player.getAttribute("src"), null); assert.equal(player.isConnected, false);
  assert.deepEqual(f.urls.revoked, [url]); assert.equal(f.readiness.at(-1), false);
  assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(f.handles[0], f.selection.output), null);
  f.api.dispose(); assert.deepEqual(f.urls.revoked, [url], "second retirement is inert");
});

test("four locale refreshes preserve player/control identity, the exact Blob and the single read", async t => {
  const f = await fixture(t); await f.load();
  const player = f.host.querySelector("audio"), download = f.get("download"), blob = f.urls.created[0].blob;
  player.currentTime = .25;
  for (const language of ["fr", "ja", "ar", "en"]) {
    f.api.refresh(locale(language));
    assert.strictEqual(f.host.querySelector("audio"), player); assert.strictEqual(f.get("download"), download);
    assert.equal(download.textContent, messages.selectedOutputShareCopy(language).downloadFile);
    assert.equal(player.currentTime, .25); assert.equal(f.reads.length, 1); assert.equal(f.urls.created.length, 1);
    assert.strictEqual(f.urls.created[0].blob, blob); assert.equal(f.urls.revoked.length, 0);
  }
});

test("playback failure removes the playable bytes and withdraws ready state", async t => {
  const f = await fixture(t, { read: ({ mint, selection }) => mint(selection) }); await f.load(); const player = f.host.querySelector("audio"), url = player.src;
  player.dispatchEvent(new Event("error"));
  assert.equal(f.readiness.at(-1), false); assert.equal(player.getAttribute("src"), null); assert.equal(player.isConnected, false);
  assert.deepEqual(f.urls.revoked, [url]); assert.equal(f.host.textContent.includes(messages.selectedOutputShareCopy("en").fileUnavailable), true);
  assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(f.handles[0], f.selection.output), null);
});

test("parent abort synchronously retires ready media and prevents retained controls from reading again", async t => {
  const f = await fixture(t); await f.load(); const player = f.host.querySelector("audio"), load = f.get("load");
  f.sourceAbort.abort();
  assert.equal(player.getAttribute("src"), null); assert.equal(player.isConnected, false); assert.equal(f.urls.revoked.length, 1);
  assert.equal(f.readiness.at(-1), false); load?.click(); await settle(); assert.equal(f.reads.length, 1);
});

test("a no-longer-current parent lease blocks a late read and download activation", async t => {
  const pending = deferred(), f = await fixture(t, { read: () => pending.promise });
  f.get("load").click(); const handle = await f.mint(); f.stale(); pending.resolve(handle);
  await settle(() => mediaClient.accessVerifiedSelectedOutputShareMedia(handle, f.selection.output) === null);
  assert.equal(f.readiness.includes(true), false); assert.equal(f.urls.created.length, 0);
  const g = await fixture(t); await g.load(); const download = g.get("download"); g.stale();
  download.click(); assert.equal(g.trace.some(event => event.action === "click" && event.node.localName === "a"), false, "stale control cannot activate a download");
  assert.equal(g.urls.revoked.length, 1); assert.equal(g.readiness.at(-1), false);
});

test("3D imports and mounts only after explicit View and close retires the preview", async t => {
  const f = await fixture(t, { kind: "model3d" }); assert.equal(f.modelImports.length, 0); await f.load();
  assert.equal(f.modelImports.length, 0); f.get("download").click();
  assert.equal(f.trace.filter(event => event.action === "click" && event.node.localName === "a").at(-1)?.node.download, "forma-3d.glb");
  f.get("view").click(); await settle(() => f.modelCalls.length === 1); await settle();
  assert.equal(f.modelImports.length, 1); assert.equal(f.modelCalls.length, 1);
  const [host, handle, output, options] = f.modelCalls[0];
  assert.deepEqual(output, f.selection.output); assert.ok(mediaClient.accessVerifiedSelectedOutputShareMedia(handle, output));
  assert.ok(f.host.contains(host)); assert.equal(options.signal.aborted, false);
  f.api.refresh(locale("ja")); assert.deepEqual(f.modelCalls[0].view.locales, ["en", "ja"]);
  f.get("close").click(); assert.equal(options.signal.aborted, true); assert.equal(f.modelCalls[0].view.disposed, true);
  assert.equal(f.host.querySelector("canvas"), null); assert.equal(f.reads.length, 1);
});

test("keyboard View activation preserves visible focus immediately while 3D is still pending", async t => {
  const pending = deferred(), f = await fixture(t, { kind: "model3d", mountModel: () => pending.promise }); await f.load();
  const view = f.get("view"), close = f.get("close"); view.focus(); assert.equal(view.hidden, false);
  view.click();
  const active = f.document.activeElement;
  assert.ok(active === view || active === close, "View activation retains focus within its visible preview controls");
  assert.equal(active.isConnected, true);
  assert.equal(active.hidden, false, "focused View must stay visible or focus must transfer synchronously to visible Close");
  await settle(() => f.modelCalls.length === 1);
  assert.strictEqual(f.document.activeElement, active, "pending lazy preview does not lose control focus");
  pending.resolve({ refresh() {}, dispose() {} }); await settle();
});

test("3D completion leaves focus alone when the user moved to another control", async t => {
  const pending = deferred(), f = await fixture(t, { kind: "model3d", mountModel: () => pending.promise }); await f.load();
  const elsewhere = f.document.createElement("button"); elsewhere.textContent = "Another control"; f.document.body.append(elsewhere);
  f.get("view").focus(); f.get("view").click(); await settle(() => f.modelCalls.length === 1);
  elsewhere.focus(); pending.resolve({ refresh() {}, dispose() {} }); await settle();
  assert.strictEqual(f.document.activeElement, elsewhere); assert.equal(elsewhere.hidden, false); assert.equal(elsewhere.isConnected, true);
});

test("closing pending 3D and reopening disposes the stale completion without removing the newer preview", async t => {
  const pending = deferred(), previews = [];
  const f = await fixture(t, { kind: "model3d", mountModel: host => {
    const canvas = host.ownerDocument.createElement("canvas"); host.append(canvas);
    const state = { canvas, disposed: false, refresh() {}, dispose() { this.disposed = true; canvas.remove(); } };
    previews.push(state); return previews.length === 1 ? pending.promise : Promise.resolve(state);
  } }); await f.load();
  f.get("view").click(); await settle(() => previews.length === 1); assert.equal(previews[0].canvas.isConnected, true);
  f.get("close").click(); assert.equal(f.modelCalls[0][3].signal.aborted, true); assert.equal(previews[0].canvas.isConnected, false);
  f.get("view").click(); await settle(() => previews.length === 2); await settle(); assert.equal(previews[1].canvas.isConnected, true);
  pending.resolve(previews[0]); await settle(() => previews[0].disposed);
  assert.equal(previews[1].disposed, false); assert.strictEqual(f.host.querySelector("canvas"), previews[1].canvas);
  assert.equal(f.modelCalls[1][3].signal.aborted, false); assert.equal(f.readiness.at(-1), true); assert.equal(f.reads.length, 1);
  f.api.dispose(); assert.equal(previews[1].disposed, true); assert.equal(f.host.querySelector("canvas"), null);
  assert.equal(f.readiness.at(-1), false); assert.equal(f.urls.revoked.length, f.urls.created.length);
});

test("captured recipient data cannot be retargeted by caller mutation while reading", async t => {
  const pending = deferred(), f = await fixture(t, { mutable: true, read: () => pending.promise });
  f.get("load").click(); f.suppliedOutput.title = "Changed title"; f.suppliedOutput.content.media.sha256 = "0".repeat(64);
  const handle = await f.mint(); pending.resolve(handle); await settle(() => f.readiness.includes(true));
  assert.deepEqual(f.reads[0].output, f.selection.output); assert.equal(f.host.querySelector("audio").getAttribute("aria-label"), f.selection.output.title);
  assert.equal(f.urls.created[0].blob.size, f.selection.bytes.length);
});

test("original monotonic expiry survives locale refresh and wall-clock rollback", async t => {
  const f = await fixture(t, { read: ({ mint, selection }) => mint(selection) }); await f.load();
  const player = f.host.querySelector("audio"), handle = f.handles[0];
  f.clock.monotonic = 3_500_000; f.api.refresh(locale("fr"));
  f.clock.wall = NOW - 3_600_000; f.clock.monotonic = 3_600_001; f.fireExpiry();
  assert.equal(player.isConnected, false); assert.equal(player.getAttribute("src"), null);
  assert.equal(f.readiness.at(-1), false); assert.equal(f.urls.revoked.length, 1);
  assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(handle, f.selection.output), null, "independently live handle was actually disposed");
  assert.equal(f.get("status").textContent, messages.selectedOutputShareCopy("fr").fileExpired);
  f.get("load").click(); await settle(); assert.equal(f.reads.length, 1);
});
