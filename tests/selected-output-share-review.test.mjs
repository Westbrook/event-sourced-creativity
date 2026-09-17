import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as lit from "lit";
import { selectedOutputShareCopy } from "../src/components/selected-output-share-messages.ts";
import { projectSelectedOutputShareCandidate, projectSelectedOutputShareMediaCandidate } from "../src/model/selected-output-share.ts";

// Actual complete review component, client and content/slide renderers, synthetic HTTP streams,
// and the existing finite native DOM ports. This is not browser, physical-device,
// assistive-technology, deployment, or public-share authorization evidence.
const ROOT = new URL("../", import.meta.url);
// The general full-page harness statically imports Scene Store -> Scene cost
// fixture -> worker/index.ts, even for consumers of its frontend-only ports.
// Scope that harness to this frontend test: deny its one backend factory import
// and preserve every frontend port/loader/tree implementation. Rebase module
// URLs using AST nodes, never string-rewrite production methods or fixture text.
async function frontendPorts() {
  const url = new URL("./helpers/calm-full-page-fixture.mjs", import.meta.url);
  const source = fs.readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const backend = tree.statements.filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "./scene-cost-store-host.mjs");
  assert.equal(backend.length, 1, "exact unused backend import seam");
  assert.equal(backend[0].importClause.namedBindings.elements.length, 1);
  assert.equal(backend[0].importClause.namedBindings.elements[0].name.text, "createSceneStoreHost");
  const originalFixture = new URL("./inactive-generation-dialog-host.test.mjs", import.meta.url);
  const fixtureTree = ts.createSourceFile(originalFixture.pathname, fs.readFileSync(originalFixture, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const dependencies = Object.fromEntries([...new Set([tree, fixtureTree].flatMap(value => value.statements
    .filter(node => ts.isImportDeclaration(node) && !node.moduleSpecifier.text.startsWith("."))
    .map(node => node.moduleSpecifier.text)))].map(name => [name, import.meta.resolve(name)]));
  const transformed = ts.transform(tree, [context => {
    const visit = node => {
      if (node === backend[0]) return undefined;
      if (ts.isImportDeclaration(node)) {
        const name = node.moduleSpecifier.text;
        const resolved = name.startsWith(".") ? new URL(name, url).href : import.meta.resolve(name);
        return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, ts.factory.createStringLiteral(resolved), node.attributes);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url")
        return ts.factory.createStringLiteral(url.href);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isMetaProperty(node.expression.expression) && node.expression.name.text === "resolve")
        return ts.factory.updateCallExpression(node, ts.factory.createIdentifier("resolveFrontendFixtureDependency"), node.typeArguments, node.arguments);
      return ts.visitEachChild(node, visit, context);
    };
    return value => ts.visitNode(value, visit);
  }]);
  const prefix = "const frontendFixtureDependencies=" + JSON.stringify(dependencies) + ";\n"
    + "function resolveFrontendFixtureDependency(name){if(!Object.hasOwn(frontendFixtureDependencies,name))throw new Error('Unknown frontend fixture dependency '+name);return frontendFixtureDependencies[name];}\n"
    + "function createSceneStoreHost(){throw new Error('Backend fixtures are forbidden in the selected-output publisher review test');}\n";
  const scopedSource = prefix + ts.createPrinter().printFile(transformed.transformed[0]); transformed.dispose();
  return import("data:text/javascript;base64," + Buffer.from(scopedSource).toString("base64"));
}
const { calmFullPageNativePorts: ports, fullPageTree } = await frontendPorts();
const COMPONENT = "src/components/forma-selected-output-share-review.ts";
const NOW = Date.parse("2030-01-01T00:00:00.000Z"), TOKEN = "A".repeat(32);
const SELECTION = Object.freeze({ output: "scene", documentId: "document-a", artifactId: "artifact-a", revision: 3, contentSha256: "a".repeat(64) });
const BODY = "Exact authored العربية 日本語\n<img src='https://private.invalid/no-fetch'> [link](javascript:void(0))";
const iso = value => new Date(value).toISOString();
const localDate = value => { const d = new Date(value), pad = part => String(part).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rawText = node => node.children.map(child => typeof child === "string" ? child : rawText(child)).join("");
const visibleText = node => node.hiddenBy ? "" : node.children.map(child => typeof child === "string" ? child : visibleText(child)).join("");
const metadata = (id = "candidate-a") => ({ shareId: id, title: "An existing link", output: "scene", revision: 2, expiresAt: iso(NOW - 60_000), issuedAt: iso(NOW - 120_000) });
async function candidate(selection, review) {
  if (selection.projectionPolicy) {
    const output = selection.output;
    const descriptor = { kind: output, mimeType: output === "audio" ? "audio/wav" : output === "video" ? "video/mp4" : "model/gltf-binary",
      sha256: selection.mediaSha256, byteLength: output === "audio" ? 8044 : 408,
      ...(output === "audio" ? { sampleRate: 8000, channels: 1, sampleCount: 4000, durationSeconds: 0.5, durationBasis: "pcm-samples" }
        : output === "video" ? { width: 16, height: 16, durationSeconds: 1 } : {}) };
    return projectSelectedOutputShareMediaCandidate(selection, { descriptor, sourceExpiresAt: iso(NOW + 7 * 86_400_000),
      disclosure: output === "audio" ? { watermark: "not-declared" } : output === "video" ? { encoderDeclaration: "x264-163-r3060" } : {} }, review, NOW);
  }
  const { output, ...nativeSelection } = selection;
  const projected = await projectSelectedOutputShareCandidate(selection, { schemaVersion: 1, kind: "native-retained-output", output,
    selection: nativeSelection, title: "PRIVATE title never used", expiresAt: iso(NOW + 7 * 86_400_000),
    content: { content_markdown: BODY, medium: "visual" } }, review, NOW);
  assert.ok(projected, "actual projection creates synthetic candidate");
  return projected;
}
function response(url, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = new Response(bytes, { headers: { "content-type": "application/json", "content-length": String(bytes.byteLength) } });
  Object.defineProperty(result, "url", { value: String(url) });
  return result;
}
let mountCommit, mediaMount;
async function loadComponent() {
  const source = fs.readFileSync(new URL(COMPONENT, ROOT), "utf8"), dependencies = new Map();
  const tree = ts.createSourceFile(COMPONENT, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const name = node.moduleSpecifier.text;
    if (name === "./forma-selected-output-share-review.css") {
      assert.equal(node.importClause, undefined, "one explicit side-effect stylesheet port; geometry is checked in the browser");
      dependencies.set(name, {});
      continue;
    }
    if (!node.importClause || node.importClause.isTypeOnly) continue;
    if (name === "lit") dependencies.set(name, { ...lit, render: (...args) => mountCommit(...args) });
    // The imperative file leaf has its own actual-DOM/reader tests. This finite
    // port verifies the publisher's owner, original expiry and readiness wiring;
    // it does not claim file verification, playback or GLB/browser evidence.
    else if (name === "./selected-output-share-media-view.ts") dependencies.set(name, { mountSelectedOutputShareMedia: (...args) => mediaMount(...args) });
    else if (/\/presentational-element(?:\.ts)?$/u.test(name)) dependencies.set(name, { FormaPresentationalElement: ports.ElementPort });
    else if (name.startsWith(".")) {
      const target = new URL(name.endsWith(".ts") ? name : name + ".ts", new URL(COMPONENT, ROOT));
      dependencies.set(name, name.includes("/model/") || name.includes("/selected-output-share-client.")
        ? await import(target.href) : await ports.loadActual(target.pathname.slice(ROOT.pathname.length)));
    } else throw new Error("Unknown component dependency " + name);
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", "customElements", "window", code)(
    name => { assert.ok(dependencies.has(name), name); return dependencies.get(name); }, exports, { get: () => true, define() {} }, ports.windowPort);
  return exports.FormaSelectedOutputShareReview;
}
const ShareReview = await loadComponent();
const { PresentationSlide } = await ports.loadActual("src/components/presentation-slide.ts");

function fixture(t, { enabled = true, available = true, reply, shares = [], cursor = null, locale = "en", selection = SELECTION, readMedia } = {}) {
  let now = NOW, monotonic = 0, localeCallback, clock = 0, current = true, candidateSequence = 0, mediaMountNode = null;
  const requests = [], commits = [], clipboard = [], focusCalls = [], mediaViews = [], timers = new Map(), frames = new Map(), outputs = new Map();
  const base = () => ({ locale, trace: [], listeners: new Map(), changed: new Map(), requested: false,
    timers, frames, resizeTargets: new Map(), storage: new Map(), tick: async () => true });
  const f = base(), preview = base(), link = base();
  const oldLocation = Object.getOwnPropertyDescriptor(ports.documentPort, "location");
  const oldNavigator = Object.getOwnPropertyDescriptor(ports.windowPort, "navigator");
  Object.defineProperty(ports.documentPort, "location", { configurable: true, value: { origin: "https://fixture.invalid" } });
  Object.defineProperty(ports.windowPort, "navigator", { configurable: true, value: { clipboard: { writeText: async value => clipboard.push(value) } } });
  for (const target of [f, preview, link]) Object.defineProperty(target, "timerSequence", { get: () => clock, set: value => { clock = value; } });
  const snapshot = language => ({ locale: language, formatLocale: language, direction: language === "ar" ? "rtl" : "ltr", timeZone: "UTC",
    messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[language] }, revision: clock++ });
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; },
    dispatchEvent(event) { localeCallback = event.callback; event.callback(snapshot(locale), () => {}); return true; } });
  f.i18n.hostConnected(); preview.i18n = link.i18n = f.i18n;
  t.mock.method(Date, "now", () => now);
  t.mock.method(performance, "now", () => monotonic);
  const respond = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/availability")) return response(url, { creationAvailable: available });
    if (path.endsWith("/prepare")) {
      const { selection, review } = JSON.parse(init.body);
      return response(url, { candidateId: selection.projectionPolicy ? `candidate-${String.fromCharCode(97 + candidateSequence++)}` : "candidate-a",
        candidate: await candidate(selection, review), replayed: false });
    }
    if (path.endsWith("/commit")) return response(url, { share: { shareId: "candidate-a", expiresAt: iso(NOW + 3_600_000), active: true, token: TOKEN }, replayed: false });
    if (init.method === "DELETE") { shares = shares.filter(share => share.shareId !== decodeURIComponent(path.split("/").at(-1))); cursor = null; return response(url, { ok: true }); }
    return response(url, { shares, nextCursor: cursor });
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(String(url), /^https:\/\/fixture\.invalid\/api\/selected-output-shares(?:[/?]|$)/u, "only closed synthetic selected-share endpoints");
    requests.push({ url, init }); return reply ? reply(url, init, respond) : respond(url, init);
  });
  const drawMount = mount => { ports.bindFixture(mount); mount.renderer.draw(mount.host); ports.bindFixture(f); };
  for (const [name, mount] of [["data-selected-output-review-mount", preview], ["data-selected-output-link-mount", link]]) {
    ports.bindFixture(mount); outputs.set(name, lit.nothing);
    class ContentHost extends ports.ElementPort { render() { return outputs.get(name); } }
    mount.host = new ContentHost(); mount.host.tag = "fixture-content"; mount.host.attributes = {};
    mount.renderer = new ports.RendererPort(mount, { "forma-presentation-slide": PresentationSlide });
  }
  mountCommit = (value, mount) => {
    const name = Object.hasOwn(mount.attributes, "data-selected-output-review-mount") ? "data-selected-output-review-mount" : "data-selected-output-link-mount";
    assert.ok(Object.hasOwn(mount.attributes, name));
    outputs.set(name, value); commits.push({ value, mount }); drawMount(name.includes("review") ? preview : link);
    if (name.includes("review")) {
      const emitted = preview.renderer.nodes.find(node => Object.hasOwn(node.attributes, "data-selected-output-media-mount"));
      // General tree ports reconstruct native nodes on every observation. This
      // one explicit Lit child-part port models the stable emitted empty media
      // mount, and drops identity when that part is withdrawn. Actual DOM/locale
      // persistence is independently exercised in the browser fixture.
      mediaMountNode = emitted ? mediaMountNode ?? emitted : null;
      mount.querySelector = selector => selector === "[data-selected-output-media-mount]" ? mediaMountNode : null;
    }
  };
  mediaMount = (host, output, controls) => {
    const view = { host, output, controls, refreshes: [], disposed: false,
      refresh(locale) { this.refreshes.push(locale.locale); }, dispose() { this.disposed = true; } };
    mediaViews.push(view); return view;
  };
  ports.bindFixture(f); f.host = new ShareReview(); f.host.tag = "forma-selected-output-share-review"; f.host.attributes = {};
  assert.equal(f.host.enabled, false, "host creation clamp defaults closed");
  f.renderer = new ports.RendererPort(f, {});
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => /^\[data-selected-output-(?:(?:review|link)-mount|share-open|share-close|revoke)\]$/u.test(selector)
    ? f.renderer.nodes.filter(node => node.owner === owner && Object.hasOwn(node.attributes, selector.slice(1, -1))) : query(owner, selector);
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) {
      const focus = node.focus.bind(node);
      // Record the native focus port selected by the actual component. This
      // does not model geometry or assert browser/assistive-technology focus.
      node.focus = () => { focusCalls.push({ tag: node.tag, attributes: { ...node.attributes } }); focus(); };
    }
  };
  const draw = () => { ports.bindFixture(f); f.renderer.draw(f.host); drawMount(preview); drawMount(link); };
  const trees = () => [f, preview, link].map(value => fullPageTree(value));
  const nodes = tag => trees().flatMap(tree => tree.visible(tag));
  const text = () => trees().map(tree => visibleText(tree.root)).join("\n");
  const settle = async (predicate = () => true) => {
    for (let index = 0; index < 40; index++) { await new Promise(setImmediate); draw(); if (predicate()) return; }
    assert.ok(predicate(), "bounded synthetic component observation settled");
  };
  const sourceAbort = new AbortController();
  const source = { selection, signal: sourceAbort.signal, isCurrent: () => current, ...(readMedia ? { readMedia } : {}) };
  f.host.source = source; f.host.enabled = enabled;
  assert.equal(requests.length, 0, "property assignment cannot start transport before connection");
  f.host.isConnected = true; f.host.connectedCallback(); draw();
  const find = (tag, label) => { const found = nodes(tag).filter(node => rawText(node).trim() === label); assert.equal(found.length, 1, label); return found[0]; };
  const act = async (node, event = "click", extra = {}) => {
    assert.ok(!Object.hasOwn(node.attributes, "disabled"), "gesture target enabled");
    assert.equal(typeof node.handlers[event], "function");
    await node.handlers[event].call(node.owner, { currentTarget: node.port, target: node.port, preventDefault() {}, ...extra });
    await settle();
  };
  t.after(() => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback(); f.i18n.hostDisconnected(); ports.bindFixture(null); mountCommit = mediaMount = undefined;
    if (oldLocation) Object.defineProperty(ports.documentPort, "location", oldLocation); else delete ports.documentPort.location;
    if (oldNavigator) Object.defineProperty(ports.windowPort, "navigator", oldNavigator); else delete ports.windowPort.navigator;
  });
  return { f, source, sourceAbort, requests, commits, clipboard, focusCalls, mediaViews, outputs, draw, settle, nodes, text, find, act,
    async open() { await settle(); const entry = nodes("button").find(node => Object.hasOwn(node.attributes, "data-selected-output-share-open")); assert.ok(entry, "a current creation or management entry is visible"); await act(entry); },
    async edit(name, value) { const node = nodes("input").find(item => item.attributes.name === name); assert.ok(node); node.port.name = name; node.port.value = value; await act(node, "input"); },
    async fill(title = "An explicit title") { await this.edit("share-title", title); await this.edit("share-expiry", localDate(NOW + 3_600_000)); },
    setReply(value) { reply = value; },
    setSource(value) { ports.bindFixture(f); f.host.source = value; },
    invalidate() { current = false; draw(); },
    disconnect() { ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback(); },
    reconnect() { ports.bindFixture(f); f.host.isConnected = true; f.host.connectedCallback(); draw(); },
    locale(language) { f.locale = preview.locale = link.locale = language; localeCallback(snapshot(language)); draw(); },
    advance(value) { monotonic += Math.max(0, value - now); now = value; ports.bindFixture(f); for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } draw(); },
    clocks(wall, elapsed) { now = wall; monotonic = elapsed; ports.bindFixture(f); for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } draw(); },
  };
}

for (const [available, enabled] of [[false, false], [false, true], [true, false]]) test(`creation gates (${available}/${enabled}) allow list/revoke with zero preparations or commits`, async t => {
  const f = fixture(t, { available, enabled, shares: [metadata()] });
  await f.settle();
  assert.ok(f.find("button", "Manage links"));
  const reads = f.requests.filter(item => new URL(item.url).searchParams.has("documentId")).length;
  assert.equal(reads, 1, "one bounded initial owned metadata read");
  await f.open();
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  assert.equal(f.requests.filter(item => new URL(item.url).searchParams.has("documentId")).length, reads, "opening reuses successful discovery");
  assert.equal(f.nodes("input").length, 0, "creation inputs stay hidden in management mode");
  assert.equal(f.nodes("button").filter(node => ["Review", "Publish link"].includes(rawText(node).trim())).length, 0);
  assert.doesNotMatch(f.text(), /Unavailable/u); assert.match(f.text(), /An existing link/u);
  await f.act(f.find("button", "Revoke link"));
  assert.equal(f.requests.filter(item => item.init.method === "DELETE").length, 1);
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  assert.match(f.text(), /Revoked/u);
});

test("empty title and expiry require deliberate review then separate exact publish approval", async t => {
  const f = fixture(t); await f.open();
  assert.deepEqual(f.nodes("input").map(node => node.port.value), ["", ""]);
  await f.fill(); assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  await f.act(f.find("button", "Review"));
  assert.match(f.text(), /Exact authored العربية 日本語/u);
  assert.equal(f.nodes("img").length, 0); assert.equal(f.nodes("a").length, 0);
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 1);
  const prepare = JSON.parse(f.requests.find(item => String(item.url).endsWith("/prepare")).init.body);
  assert.deepEqual(prepare.selection, SELECTION); assert.equal(prepare.review.title, "An explicit title");
  await f.act(f.find("button", "Publish link"));
  const commit = JSON.parse(f.requests.find(item => String(item.url).endsWith("/commit")).init.body);
  assert.deepEqual(Object.keys(commit).sort(), ["approval", "candidateId"]);
  assert.equal(commit.approval.purpose, "selected-output-read-v1"); assert.equal(commit.approval.allowPublicRead, true);
  assert.match(commit.approval.candidateSha256, /^[a-f0-9]{64}$/u);
  assert.match(f.text(), new RegExp("https://fixture.invalid/share/output/" + TOKEN, "u"));
  await f.act(f.find("button", "Copy link"));
  assert.deepEqual(f.clipboard, ["https://fixture.invalid/share/output/" + TOKEN]);
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 2);
});

const mediaSelection = output => ({ ...SELECTION, output, mediaSha256: "b".repeat(64),
  policy: output === "audio" ? "selected-output-share-audio-v1" : output === "video" ? "selected-output-share-avc-mp4-x264-163-r3060-v1" : "selected-output-share-glb-png-textures-v1",
  projectionPolicy: "selected-output-media-exact-bytes-v1" });
for (const output of ["audio", "video", "model3d"]) test(`${output}: file review is explicit, locale-stable and required before separate publication`, async t => {
  let reads = 0;
  const readMedia = () => { ++reads; throw new Error("This component ownership port must never initiate a media read"); };
  const f = fixture(t, { selection: mediaSelection(output), readMedia });
  await f.open(); await f.fill("Reviewed <script>literal</script> 日本語 العربية");
  await f.act(f.find("button", "Review"));
  assert.equal(f.mediaViews.length, 1); assert.equal(reads, 0, "mounting cannot read media");
  const view = f.mediaViews[0];
  assert.equal(view.controls.readMedia, readMedia); assert.equal(view.controls.isCurrent(), true);
  assert.equal(view.output.output, output); assert.equal(view.output.content.media.sha256, "b".repeat(64));
  assert.equal(view.output.title, "Reviewed <script>literal</script> 日本語 العربية");
  assert.match(f.text(), /Reviewed <script>literal<\/script>/u);
  assert.doesNotMatch(f.text(), /bbbbbbbb|document-a|artifact-a|candidateSha256/u);
  assert.equal(f.nodes("audio").length + f.nodes("video").length + f.nodes("a").length, 0);
  assert.equal(Object.hasOwn(f.find("button", "Publish link").attributes, "disabled"), true);
  await f.find("button", "Publish link").handlers.click(); await f.settle();
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 0, "programmatic click also preserves readiness guard");
  for (const locale of ["fr", "ja", "ar", "en"]) f.locale(locale);
  assert.equal(f.mediaViews.length, 1, "locale-only render preserves mounted file preview");
  assert.ok(view.refreshes.includes("ar")); assert.equal(reads, 0);
  view.controls.onReady(true); await f.settle();
  view.controls.onReady(false); await f.settle();
  assert.equal(Object.hasOwn(f.find("button", "Publish link").attributes, "disabled"), true, "losing the held file clears readiness");
  await f.find("button", "Publish link").handlers.click(); await f.settle();
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 0);
  view.controls.onReady(true); await f.settle();
  await f.act(f.find("button", "Publish link"));
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 1);
  assert.equal(view.disposed, true); assert.equal(view.controls.signal.aborted, true); assert.equal(view.controls.isCurrent(), false);
});

test("media preview retires on input edits and late readiness cannot approve a replacement", async t => {
  const f = fixture(t, { selection: mediaSelection("audio"), readMedia: async () => { throw new Error("No automatic read"); } });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  const original = f.mediaViews[0];
  await f.edit("share-title", "Replacement");
  assert.equal(original.disposed, true); assert.equal(original.controls.signal.aborted, true);
  await f.act(f.find("button", "Review"));
  original.controls.onReady(true); await f.settle();
  assert.equal(f.mediaViews.length, 2); assert.equal(Object.hasOwn(f.find("button", "Publish link").attributes, "disabled"), true);
  f.sourceAbort.abort();
  assert.equal(f.mediaViews[1].disposed, true); assert.equal(f.mediaViews[1].controls.isCurrent(), false);
});

test("media review uses original monotonic expiry across locale changes and wall-clock rollback", async t => {
  const f = fixture(t, { selection: mediaSelection("model3d"), readMedia: async () => { throw new Error("No automatic read"); } });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  const view = f.mediaViews[0]; view.controls.onReady(true); await f.settle(); f.locale("ar");
  f.clocks(NOW - 86_400_000, 3_600_001); await f.settle();
  assert.equal(view.disposed, true); assert.equal(view.controls.isCurrent(), false); assert.equal(view.controls.signal.aborted, true);
  assert.equal(f.nodes("button").some(node => rawText(node) === selectedOutputShareCopy("ar").publishLink), false);
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 0);
});

test("changing the trusted media reader within a lease retires the old source", async t => {
  const f = fixture(t, { selection: mediaSelection("video"), readMedia: async () => { throw new Error("No automatic read"); } });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  const view = f.mediaViews[0];
  f.source.readMedia = async () => { throw new Error("Changed port"); }; f.draw();
  assert.equal(view.disposed, true); assert.equal(view.controls.isCurrent(), false);
  assert.equal(f.nodes("button").length, 0, "changed authority port cannot leave a sharing entry behind");
});

test("four saved locales preserve authored inputs and active composition without requests or publication", async t => {
  const f = fixture(t); await f.open(); await f.fill("作成中 مرحبا");
  const title = f.nodes("input").find(node => node.attributes.name === "share-title");
  const part = title.port.propertyParts.value;
  await f.act(title, "compositionstart");
  f.nodes("input").find(node => node.attributes.name === "share-title").port.value = "未確定 مرحبا";
  const requests = f.requests.length;
  for (const locale of ["fr", "ja", "ar", "en"]) {
    f.setSource(f.source);
    f.locale(locale);
    const current = f.nodes("input").find(node => node.attributes.name === "share-title");
    assert.equal(current.port.value, "未確定 مرحبا"); assert.equal(current.port.propertyParts.value, part, "same stable Lit input part preserves uncommitted composition");
    assert.ok(Object.hasOwn(f.find("button", selectedOutputShareCopy(locale).review).attributes, "disabled"));
  }
  assert.equal(f.requests.length, requests);
  const current = f.nodes("input").find(node => node.attributes.name === "share-title"); current.port.name = "share-title";
  await f.act(current, "compositionend");
  assert.ok(!Object.hasOwn(f.find("button", "Review").attributes, "disabled"));
});

test("input A-to-B-to-A cannot revive an in-flight prepared candidate", async t => {
  const held = deferred(); const f = fixture(t, { reply: (url, init, fallback) => String(url).endsWith("/prepare") ? held.promise : fallback(url, init) });
  await f.open(); await f.fill();
  const button = f.find("button", "Review"), pending = button.handlers.click(); await f.settle();
  const inputs = f.nodes("input");
  for (const value of ["Changed title", "An explicit title"]) {
    const input = inputs.find(node => node.attributes.name === "share-title"); input.port.name = "share-title"; input.port.value = value;
    input.handlers.input({ currentTarget: input.port });
  }
  const request = f.requests.find(item => String(item.url).endsWith("/prepare")), payload = JSON.parse(request.init.body);
  held.resolve(response(request.url, { candidateId: "candidate-a", candidate: await candidate(payload.selection, payload.review), replayed: false }));
  await pending; await f.settle();
  assert.equal(f.nodes("button").filter(node => rawText(node).trim() === "Publish link").length, 0);
  assert.doesNotMatch(f.text(), /Exact authored/u);
});

test("source A-to-B-to-A, abort, disconnect and authority invalidation retire transient output synchronously", async t => {
  const f = fixture(t); await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  assert.notEqual(f.outputs.get("data-selected-output-review-mount"), lit.nothing);
  const other = { ...f.source, selection: { ...SELECTION, documentId: "document-b" } };
  f.setSource(other); assert.equal(f.outputs.get("data-selected-output-review-mount"), lit.nothing);
  f.setSource(f.source); await f.settle();
  assert.doesNotMatch(f.text(), /Exact authored/u);
  await f.open(); await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  assert.notEqual(f.outputs.get("data-selected-output-link-mount"), lit.nothing);
  f.sourceAbort.abort(); assert.equal(f.outputs.get("data-selected-output-link-mount"), lit.nothing);
  const controller = new AbortController(); f.setSource({ ...f.source, signal: controller.signal }); await f.settle();
  await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  f.disconnect(); assert.equal(f.outputs.get("data-selected-output-review-mount"), lit.nothing);
  f.reconnect(); await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  f.invalidate(); assert.equal(f.outputs.get("data-selected-output-review-mount"), lit.nothing);
});

test("lost publication acknowledgement consumes the candidate and permits only explicit revoke before another review", async t => {
  const f = fixture(t, { reply: (url, init, fallback) => String(url).endsWith("/commit") ? Promise.reject(new Error("lost acknowledgement")) : fallback(url, init) });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  assert.equal(f.nodes("a").length, 0); assert.equal(f.nodes("button").filter(node => rawText(node).trim() === "Publish link").length, 0);
  assert.ok(Object.hasOwn(f.find("button", "Review").attributes, "disabled"));
  await f.act(f.find("button", "Try again"));
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/prepare")).length, 1);
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 1);
  await f.act(f.find("button", "Close")); await f.open(); await f.fill();
  assert.ok(Object.hasOwn(f.find("button", "Review").attributes, "disabled"), "close/reopen cannot bypass a consumed uncertain publication");
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/prepare")).length, 1);
  await f.act(f.find("button", "Revoke link"));
  assert.ok(!Object.hasOwn(f.find("button", "Review").attributes, "disabled"));
});

test("expiry clears a reviewed candidate without another request", async t => {
  const f = fixture(t); await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  const count = f.requests.length; f.advance(NOW + 3_600_000);
  assert.equal(f.outputs.get("data-selected-output-review-mount"), lit.nothing); assert.equal(f.requests.length, count);
  assert.match(f.text(), /Expired/u);
});

test("late commit from source A cannot reveal a token after A-to-B-to-A", async t => {
  const held = deferred(); const f = fixture(t, { reply: (url, init, fallback) => String(url).endsWith("/commit") ? held.promise : fallback(url, init) });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  const pending = f.find("button", "Publish link").handlers.click(); await f.settle(() => f.requests.some(item => String(item.url).endsWith("/commit")));
  const commit = f.requests.find(item => String(item.url).endsWith("/commit")); assert.ok(commit);
  f.setSource({ ...f.source, selection: { ...SELECTION, artifactId: "artifact-b" } }); f.setSource(f.source);
  assert.equal(commit.init.signal.aborted, true);
  held.resolve(response(commit.url, { share: { shareId: "candidate-a", expiresAt: iso(NOW + 3_600_000), active: true, token: TOKEN }, replayed: false }));
  await pending; await f.settle();
  assert.equal(f.outputs.get("data-selected-output-link-mount"), lit.nothing); assert.doesNotMatch(f.text(), new RegExp(TOKEN, "u"));
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 1);
});

test("successful one-time link retires on input edit, close, and expiry without recovering its token", async t => {
  const f = fixture(t); await f.open(); await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  assert.notEqual(f.outputs.get("data-selected-output-link-mount"), lit.nothing);
  await f.edit("share-title", "Changed title");
  assert.equal(f.outputs.get("data-selected-output-link-mount"), lit.nothing);
  await f.act(f.find("button", "Close")); await f.open();
  assert.deepEqual(f.nodes("input").map(node => node.port.value), ["", ""]);
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 1);
  await f.act(f.find("button", "Revoke link"));
  await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  const count = f.requests.length; f.advance(NOW + 3_600_000);
  assert.equal(f.outputs.get("data-selected-output-link-mount"), lit.nothing); assert.equal(f.requests.length, count);
  assert.match(f.text(), /Expired/u);
});

test("management pagination is explicit and does not create or recover a public link", async t => {
  const page = Array.from({ length: 50 }, (_, index) => metadata("old-" + index));
  const cursor = Buffer.from(JSON.stringify([page.at(-1).issuedAt, page.at(-1).shareId])).toString("base64url");
  const f = fixture(t, { available: false, shares: page, cursor, reply: (url, init, fallback) => new URL(url).searchParams.has("cursor")
    ? response(url, { shares: [metadata("older-link")], nextCursor: null }) : fallback(url, init) });
  await f.open(); assert.equal(f.nodes("li").length, 50);
  await f.act(f.find("button", "More links")); assert.equal(f.nodes("li").length, 51);
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0); assert.equal(f.nodes("a").length, 0);
  assert.equal(new URL(f.requests.at(-1).url).searchParams.get("cursor"), cursor);
});

test("revoking a cursor anchor refreshes management from the first page", async t => {
  const page = Array.from({ length: 50 }, (_, index) => metadata("old-" + index));
  const cursor = Buffer.from(JSON.stringify([page.at(-1).issuedAt, page.at(-1).shareId])).toString("base64url");
  const f = fixture(t, { available: false, shares: page, cursor }); await f.open();
  await f.act(f.nodes("button").filter(node => rawText(node).trim() === "Revoke link").at(-1));
  await f.settle(() => f.nodes("li").length === 49);
  assert.equal(new URL(f.requests.at(-1).url).searchParams.has("cursor"), false);
  assert.equal(f.nodes("button").filter(node => rawText(node).trim() === "More links").length, 0);
});

for (const published of [false, true]) test(`clock rollback cannot extend ${published ? "published link" : "reviewed candidate"} lifetime`, async t => {
  const f = fixture(t); await f.open(); await f.fill(); await f.act(f.find("button", "Review"));
  if (published) await f.act(f.find("button", "Publish link"));
  const mount = published ? "data-selected-output-link-mount" : "data-selected-output-review-mount";
  assert.notEqual(f.outputs.get(mount), lit.nothing);
  f.clocks(NOW - 86_400_000, 3_600_001);
  assert.equal(f.outputs.get(mount), lit.nothing, "elapsed monotonic lifetime expires despite a backwards wall clock");
  assert.match(f.text(), /Expired/u);
});

test("failed metadata read cannot claim there are no links", async t => {
  const f = fixture(t, { available: true, reply: (url, init, fallback) => new URL(url).searchParams.has("documentId")
    ? Promise.reject(new Error("unavailable list")) : fallback(url, init) });
  await f.open();
  assert.match(f.text(), /Unavailable/u); assert.doesNotMatch(f.text(), /No links yet/u);
});

test("successful metadata retry clears only its read failure", async t => {
  let fail = true;
  const f = fixture(t, { reply: (url, init, fallback) => fail && new URL(url).searchParams.has("documentId")
    ? Promise.reject(new Error("unavailable list")) : fallback(url, init) });
  await f.open(); assert.match(f.text(), /Unavailable/u);
  fail = false; await f.act(f.find("button", "Try again"));
  assert.doesNotMatch(f.text(), /Unavailable/u); assert.match(f.text(), /No links yet/u);
  assert.equal(f.nodes("button").filter(node => rawText(node).trim() === "Try again").length, 0);
  f.setReply((url, init, fallback) => String(url).endsWith("/commit") ? Promise.reject(new Error("lost acknowledgement")) : fallback(url, init));
  await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  await f.act(f.find("button", "Try again"));
  assert.match(f.text(), /Unavailable/u, "a successful metadata read cannot clear an unrelated publication failure");
  assert.ok(Object.hasOwn(f.find("button", "Review").attributes, "disabled"));
});

test("unavailable creation with verified empty metadata has no dead-end sharing action", async t => {
  const f = fixture(t, { available: false }); await f.settle();
  const actions = f.nodes("button");
  if (actions.length) {
    await f.act(actions[0]);
    t.diagnostic("Prior behavior after opening the offered action: " + f.text().replace(/\s+/gu, " ").trim());
  }
  assert.equal(actions.length, 0, "creation-disabled empty state must not offer an action that leads to Unavailable");
  assert.equal(f.requests.filter(item => new URL(item.url).searchParams.has("documentId")).length, 1, "one bounded metadata discovery");
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
});

test("failed initial discovery cannot reveal a sharing or management action", async t => {
  const f = fixture(t, { available: false, reply: (url, init, fallback) => new URL(url).searchParams.has("documentId")
    ? Promise.reject(new Error("unavailable metadata")) : fallback(url, init) });
  await f.settle();
  assert.equal(f.nodes("button").length, 0, "unknown metadata must not be treated as a known management target");
  assert.doesNotMatch(f.text(), /Unavailable|No links yet/u, "initial discovery remains an absent entry, not a new error surface");
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
});

test("late initial metadata cannot resurrect an entry after source A-to-B-to-A", async t => {
  const held = deferred(); let discovery = 0;
  const f = fixture(t, { available: false, reply: (url, init, fallback) => new URL(url).searchParams.has("documentId") && ++discovery === 1
    ? held.promise : fallback(url, init) });
  await f.settle(); assert.equal(f.nodes("button").length, 0);
  const first = f.requests.find(item => new URL(item.url).searchParams.has("documentId")); assert.ok(first);
  f.setSource({ ...f.source, selection: { ...SELECTION, documentId: "document-b" } }); f.setSource(f.source);
  await f.settle(); assert.equal(first.init.signal.aborted, true);
  held.resolve(response(first.url, { shares: [metadata()], nextCursor: null })); await f.settle();
  assert.equal(f.nodes("button").length, 0); assert.doesNotMatch(f.text(), /An existing link/u);
  assert.equal(discovery, 3, "one read for each distinct source lifetime");
});

test("true fresh capability offers Share output and opening reuses an in-flight discovery", async t => {
  const held = deferred();
  const f = fixture(t, { reply: (url, init, fallback) => new URL(url).searchParams.has("documentId") ? held.promise : fallback(url, init) });
  await f.settle(); assert.ok(f.find("button", "Share output")); await f.open();
  assert.equal(f.nodes("input").length, 2);
  assert.equal(f.requests.filter(item => new URL(item.url).searchParams.has("documentId")).length, 1);
  const read = f.requests.find(item => new URL(item.url).searchParams.has("documentId"));
  held.resolve(response(read.url, { shares: [], nextCursor: null })); await f.settle();
  assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  assert.match(f.text(), /No links yet/u);
});

test("same-lease known management stays reachable after the last revoke and clears on a new source", async t => {
  const f = fixture(t, { available: false, shares: [metadata()] }); await f.open();
  assert.ok(Object.hasOwn(f.focusCalls.at(-1).attributes, "data-selected-output-revoke"));
  await f.act(f.find("button", "Revoke link")); await f.settle(() => f.text().includes("No links yet"));
  await f.act(f.find("button", "Close"));
  assert.ok(f.find("button", "Manage links"));
  assert.ok(Object.hasOwn(f.focusCalls.at(-1).attributes, "data-selected-output-share-open"), "closing known management returns to its visible action");
  await f.open(); assert.match(f.text(), /No links yet/u); assert.equal(f.nodes("input").length, 0);
  assert.ok(Object.hasOwn(f.focusCalls.at(-1).attributes, "data-selected-output-share-close"), "empty known management opens at its visible Close control");
  f.setSource({ ...f.source, selection: { ...SELECTION, artifactId: "new-artifact" } }); await f.settle();
  assert.equal(f.nodes("button").length, 0, "historical management knowledge cannot cross source lifetimes");
});

test("same-lease known management remains reachable when its refreshed metadata fails", async t => {
  const f = fixture(t, { available: false, shares: [metadata()] }); await f.open();
  f.setReply((url, init, fallback) => new URL(url).searchParams.has("documentId") ? Promise.reject(new Error("later failure")) : fallback(url, init));
  await f.act(f.find("button", "Close")); assert.ok(f.find("button", "Manage links"));
  await f.open(); assert.match(f.text(), /Unavailable/u); assert.ok(f.find("button", "Try again"));
  assert.equal(f.nodes("input").length, 0); assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
});

for (const capability of [true, false]) test(`post-close focus waits for the visible refreshed creation capability (${capability})`, async t => {
  const held = deferred(); const f = fixture(t); await f.open();
  f.setReply((url, init, fallback) => String(url).endsWith("/availability") ? held.promise : fallback(url, init));
  const count = f.focusCalls.length;
  await f.act(f.find("button", "Close"));
  assert.equal(f.nodes("button").length, 0, "fresh empty entry is hidden while capability is unresolved");
  assert.equal(f.focusCalls.length, count, "no focus call targets the hidden opener");
  const request = f.requests.filter(item => String(item.url).endsWith("/availability")).at(-1);
  held.resolve(response(request.url, { creationAvailable: capability })); await f.settle();
  if (capability) {
    assert.ok(f.find("button", "Share output"));
    assert.equal(f.focusCalls.length, count + 1); assert.ok(Object.hasOwn(f.focusCalls.at(-1).attributes, "data-selected-output-share-open"));
  } else { assert.equal(f.nodes("button").length, 0); assert.equal(f.focusCalls.length, count); }
});

test("all four locales show Manage links for existing metadata without revealing creation controls", async t => {
  const f = fixture(t, { available: false, shares: [metadata()] }); await f.settle();
  const reads = f.requests.length;
  for (const locale of ["en", "fr", "ja", "ar"]) {
    f.locale(locale); assert.ok(f.find("button", selectedOutputShareCopy(locale).manageLinks));
  }
  assert.equal(f.requests.length, reads, "saved locale updates do not repeat discovery");
  await f.open(); assert.equal(f.nodes("input").length, 0); assert.doesNotMatch(f.text(), /Unavailable/u);
});

test("uncertain own publication remains manageable after close when refreshed creation becomes unavailable", async t => {
  const f = fixture(t, { reply: (url, init, fallback) => String(url).endsWith("/commit") ? Promise.reject(new Error("lost acknowledgement")) : fallback(url, init) });
  await f.open(); await f.fill(); await f.act(f.find("button", "Review")); await f.act(f.find("button", "Publish link"));
  f.setReply((url, init, fallback) => String(url).endsWith("/availability") ? response(url, { creationAvailable: false }) : fallback(url, init));
  await f.act(f.find("button", "Close")); assert.ok(f.find("button", "Manage links")); await f.open();
  assert.equal(f.nodes("input").length, 0); assert.equal(f.nodes("a").length, 0);
  assert.doesNotMatch(f.text(), /Unavailable|No links yet/u, "own unresolved publication retains management without a false empty-state claim");
  await f.act(f.find("button", "Revoke link"));
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/prepare")).length, 1);
  assert.equal(f.requests.filter(item => String(item.url).endsWith("/commit")).length, 1);
  assert.equal(f.requests.filter(item => item.init.method === "DELETE").length, 1);
  assert.match(f.text(), /No links yet/u);
});
