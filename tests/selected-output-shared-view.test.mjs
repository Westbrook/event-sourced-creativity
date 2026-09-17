import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as lit from "lit";
import { selectedOutputShareCopy } from "../src/components/selected-output-share-messages.ts";

// Actual complete component and content/slide renderers, synthetic HTTP streams,
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
    + "function createSceneStoreHost(){throw new Error('Backend fixtures are forbidden in the selected-output public reader test');}\n";
  const scopedSource = prefix + ts.createPrinter().printFile(transformed.transformed[0]); transformed.dispose();
  return import("data:text/javascript;base64," + Buffer.from(scopedSource).toString("base64"));
}
const { calmFullPageNativePorts: ports, fullPageTree } = await frontendPorts();
const COMPONENT = "src/components/forma-selected-output-shared-view.ts";
const TOKEN_A = "A".repeat(32), TOKEN_B = "b".repeat(32);
const NOW = Date.parse("2030-01-01T00:00:00.000Z"), LIMIT = 1_000_000;
const PRIVATE = "PRIVATE_NATIVE_SENTINEL_NEVER_PUBLIC";
const LITERAL = "  مرحبا 日本語\r\n![private](/api/media/private.png)\n"
  + "<img src='https://untrusted.invalid/pixel'><script>leak()</script>\n"
  + "[open](javascript:alert(1)) https://untrusted.invalid/no-fetch  ";
const pathFor = token => "/api/selected-output-shared/" + token;
const iso = value => new Date(value).toISOString();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rawText = node => node.children.map(child => typeof child === "string" ? child : rawText(child)).join("");

function output(kind = "scene", title = "Reviewed public title") {
  const base = { schemaVersion: 1, kind: "selected-output-read", output: kind, title,
    expiresAt: iso(NOW + 60_000), attribution: "Forma" };
  if (kind === "short_story") return { ...base, content: { text: LITERAL } };
  if (kind === "scene") return { ...base, content: { text: LITERAL, medium: "visual" } };
  return { ...base, content: { items: [{ title: "A finding", body: LITERAL, slide: {
    layout: "scorecard", kicker: "Evidence", bullets: ["First point", "Second point"],
    quote: { text: "An exact quote", speaker: "Researcher", role: "Author", citation: "WHO report" },
    citations: [{ label: "WHO report", anchor: "p. 12" }],
    visual: { kind: "scorecard", label: "Score", value: "75%", data: [{ label: "Accuracy", value: "75%", weight: 0.75 }] },
  } }], presentation: { aspectRatio: "16:9", theme: "Report", footerLabel: "Audience footer", stylePreset: "editorial",
    mode: "light", palette: { background: "#f2efe8", foreground: "#171714", accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" } } } };
}

function response(value = output(), { token = TOKEN_A, status = 200, headers = {}, body, url, redirected = false } = {}) {
  const bytes = body ?? new TextEncoder().encode(JSON.stringify(value));
  const result = new Response(bytes, { status, headers: {
    "content-type": "application/json; charset=utf-8", ...(bytes instanceof Uint8Array ? { "content-length": String(bytes.byteLength) } : {}), ...headers,
  } });
  Object.defineProperty(result, "url", { value: url ?? "https://fixture.invalid" + pathFor(token) });
  Object.defineProperty(result, "redirected", { value: redirected });
  return result;
}

let mountCommit;
// Reuse the full-module loader's actual dependencies. Only Lit's mount commit
// receives a finite DOM port: its real DOM renderer cannot operate on ElementPort.
// No component method or source fragment is extracted or replaced.
async function loadComponent() {
  const source = fs.readFileSync(new URL(COMPONENT, ROOT), "utf8");
  const tree = ts.createSourceFile(COMPONENT, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dependencies = new Map();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const name = statement.moduleSpecifier.text;
    if (name === "lit") dependencies.set(name, { ...lit, render: (...args) => mountCommit(...args) });
    else if (/\/presentational-element(?:\.ts)?$/u.test(name)) dependencies.set(name, { FormaPresentationalElement: ports.ElementPort });
    else if (name.startsWith(".")) {
      const target = new URL(name.endsWith(".ts") ? name : name + ".ts", new URL(COMPONENT, ROOT));
      const relative = target.pathname.slice(ROOT.pathname.length);
      dependencies.set(name, name.includes("/model/") ? await import(target.href) : await ports.loadActual(relative));
    } else if (name.startsWith("lit/")) dependencies.set(name, await import(name));
    else throw new Error("Unprovided component dependency " + name);
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", "customElements", "document", "window", "HTMLElement", "Element", "location", code)(
    name => { assert.ok(dependencies.has(name), "actual module dependency " + name); return dependencies.get(name); },
    exports, { get: () => true, define() {} }, ports.documentPort, ports.windowPort, ports.ElementPort, ports.ElementPort,
    { origin: "https://fixture.invalid" },
  );
  assert.equal(typeof exports.FormaSelectedOutputSharedView, "function");
  return exports.FormaSelectedOutputSharedView;
}
const SharedView = await loadComponent();
const { PresentationSlide } = await ports.loadActual("src/components/presentation-slide.ts");

function fixture(t, { token = TOKEN_A, reply = () => response(), locale = "en", upgradeConnected = false } = {}) {
  let now = NOW, monotonicNow = 0, localeCallback, committed = lit.nothing, clock = 0;
  const requests = [], commits = [], timers = new Map(), frames = new Map();
  const base = () => ({ locale, trace: [], listeners: new Map(), changed: new Map(), requested: false,
    timers, frames, resizeTargets: new Map(), storage: new Map(), tick: async () => true });
  const f = base(), content = base();
  const priorLocation = Object.getOwnPropertyDescriptor(ports.documentPort, "location");
  const priorBase = Object.getOwnPropertyDescriptor(ports.documentPort, "baseURI");
  Object.defineProperty(ports.documentPort, "location", { configurable: true, value: { origin: "https://fixture.invalid" } });
  Object.defineProperty(ports.documentPort, "baseURI", { configurable: true, value: "https://foreign.invalid/hostile-base/" });
  for (const owner of [f, content]) Object.defineProperty(owner, "timerSequence", { get: () => clock, set: value => { clock = value; } });
  const snapshot = language => ({ locale: language, formatLocale: language, direction: language === "ar" ? "rtl" : "ltr", timeZone: "UTC",
    messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[language] }, revision: clock++ });
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; },
    dispatchEvent(event) { localeCallback = event.callback; event.callback(snapshot(locale), () => {}); return true; } });
  f.i18n.hostConnected(); content.i18n = f.i18n;
  t.mock.method(Date, "now", () => now);
  t.mock.method(performance, "now", () => monotonicNow);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.match(String(path), /^https:\/\/fixture\.invalid\/api\/selected-output-shared\/[A-Za-z0-9_-]{32}$/u, "only the actual document origin's public reader endpoint may be called");
    requests.push({ path, init }); return reply(path, init);
  });
  ports.bindFixture(content);
  class ContentHost extends ports.ElementPort { render() { return committed; } }
  content.host = new ContentHost(); content.host.tag = "fixture-public-content"; content.host.attributes = {};
  content.renderer = new ports.RendererPort(content, { "forma-presentation-slide": PresentationSlide });
  const drawContent = () => { ports.bindFixture(content); content.renderer.draw(content.host); ports.bindFixture(f); };
  mountCommit = (value, mount) => {
    assert.ok(mount?.attributes && Object.hasOwn(mount.attributes, "data-selected-output-share-mount"), "actual dedicated content mount");
    commits.push({ value, mount }); committed = value; drawContent();
  };
  ports.bindFixture(f);
  f.host = new SharedView(); f.host.tag = "forma-selected-output-shared-view"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, {});
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => selector === "[data-selected-output-share-mount]"
    ? f.renderer.nodes.filter(node => node.owner === owner && Object.hasOwn(node.attributes, "data-selected-output-share-mount"))
    : query(owner, selector);
  // Lit preserves this one static mount between updates. Preserve precisely that
  // existing native part so the finite port can observe synchronous retirement.
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (let index = start; index < f.renderer.nodes.length; index++) {
      const node = f.renderer.nodes[index];
      if (!Object.hasOwn(node.attributes, "data-selected-output-share-mount")) continue;
      const previous = (f.renderer.previousNodes ?? []).find(item => item.owner === owner && item.isConnected
        && Object.hasOwn(item.attributes, "data-selected-output-share-mount"));
      if (previous) { Object.assign(previous, node); f.renderer.nodes[index] = previous; }
    }
  };
  const draw = () => { ports.bindFixture(f); f.renderer.draw(f.host); drawContent(); };
  const trees = () => [fullPageTree(f), fullPageTree(content)];
  const nodes = tag => trees().flatMap(tree => tree.visible(tag));
  const text = () => trees().map(tree => rawText(tree.root)).join("\n");
  const settle = async predicate => {
    for (let index = 0; index < 40; index++) { await new Promise(setImmediate); draw(); if (predicate()) return; }
    assert.ok(predicate(), "finite component observation settled");
  };
  f.host.isConnected = upgradeConnected; f.host.token = token;
  assert.equal(requests.length, 0, "token assignment before connectedCallback cannot start a duplicate read");
  f.host.isConnected = true; f.host.connectedCallback(); draw();
  t.after(() => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback();
    committed = lit.nothing; drawContent(); f.i18n.hostDisconnected(); ports.bindFixture(null); mountCommit = undefined;
    if (priorLocation) Object.defineProperty(ports.documentPort, "location", priorLocation); else delete ports.documentPort.location;
    if (priorBase) Object.defineProperty(ports.documentPort, "baseURI", priorBase); else delete ports.documentPort.baseURI;
  });
  return { f, content, requests, commits, timers, frames, draw, nodes, text, settle, get committed() { return committed; },
    setReply(value) { reply = value; },
    setToken(value) { ports.bindFixture(f); f.host.token = value; },
    disconnect() { ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback(); },
    reconnect() { ports.bindFixture(f); f.host.isConnected = true; f.host.connectedCallback(); draw(); },
    locale(value) { f.locale = content.locale = value; localeCallback(snapshot(value)); draw(); },
    setClock(value, elapsed = value - now) { monotonicNow += elapsed; now = value; },
    advance(value, elapsed = value - now) { monotonicNow += elapsed; now = value; ports.bindFixture(f); for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } draw(); },
  };
}

test("shared view fetches one exact token with private-cache and redirect protections", async t => {
  const held = deferred(), f = fixture(t, { reply: () => held.promise });
  assert.match(f.text(), /Loading/u);
  assert.equal(f.requests.length, 1); const { path, init } = f.requests[0];
  assert.equal(path, "https://fixture.invalid" + pathFor(TOKEN_A));
  assert.equal(ports.documentPort.baseURI, "https://foreign.invalid/hostile-base/");
  assert.equal(init.method, "GET"); assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(new Headers(init.headers).get("accept"), "application/json");
  assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
  held.resolve(response()); await f.settle(() => f.text().includes("Reviewed public title"));
  f.draw(); f.setToken(TOKEN_A); f.draw(); assert.equal(f.requests.length, 1);
});

test("an already connected element upgrade starts exactly one read at connectedCallback", async t => {
  const f = fixture(t, { upgradeConnected: true });
  await f.settle(() => f.text().includes("Reviewed public title")); assert.equal(f.requests.length, 1);
  f.setReply(() => response(output("scene", "New B"), { token: TOKEN_B })); f.setToken(TOKEN_B); f.draw();
  await f.settle(() => f.text().includes("New B")); assert.equal(f.requests.length, 2);
});

test("invalid tokens refuse without a request and synchronously retire any displayed output", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  for (const token of ["", "a".repeat(31), "a".repeat(33), "a/".repeat(16), "a".repeat(31) + "=", " " + TOKEN_A, null, {}, 123]) {
    const count = f.requests.length; f.setToken(token);
    assert.equal(f.committed, lit.nothing, "private predecessor leaves its owned mount synchronously");
    f.draw(); assert.equal(f.requests.length, count); assert.equal(f.text().includes("Reviewed public title"), false);
  }
});

for (const kind of ["short_story", "scene", "slides"]) test("shared " + kind + " renders only literal reviewed output with no active links or native authority", async t => {
  const f = fixture(t, { reply: () => response(output(kind)) });
  await f.settle(() => f.text().includes("Reviewed public title"));
  assert.ok(f.text().includes(LITERAL), "complete exact literal text survives");
  for (const tag of ["script", "img", "iframe", "a", "audio", "video", "textarea", "input", "form"]) assert.equal(f.nodes(tag).length, 0, tag);
  assert.ok(f.text().includes("Forma")); assert.equal(f.requests.length, 1);
  assert.equal(f.text().includes(PRIVATE), false);
  for (const { instance } of f.content.renderer.instances.values()) {
    assert.ok(instance instanceof PresentationSlide, "only the actual audience slide leaf can be mounted");
    for (const key of ["documentId", "artifactId", "selection", "contentSha256", "inputRef", "candidateSha256"]) assert.equal(instance[key], undefined, key);
    assert.equal(instance.item.notes, ""); assert.equal(instance.item.image_prompt, "");
  }
});

test("private native DTOs, wrappers, identities and nested producer fields refuse before content mounting", async t => {
  const f = fixture(t, { token: "" });
  const native = { schemaVersion: 1, kind: "native-retained-output", output: "scene", selection: {
    documentId: "private-document", artifactId: "private-artifact", revision: 0, contentSha256: "a".repeat(64),
  }, title: PRIVATE, expiresAt: iso(NOW + 60_000), content: { content_markdown: PRIVATE, medium: "visual" } };
  const privateSlide = output("slides"); privateSlide.content.items[0].notes = PRIVATE;
  const cases = [native, { publicOutput: output(), sourceExpiresAt: iso(NOW + 60_000) },
    { ...output(), selection: native.selection }, { ...output(), inputRef: PRIVATE }, privateSlide];
  for (const [index, value] of cases.entries()) {
    const token = String(index).repeat(32);
    f.setReply(() => response(value, { token })); f.setToken(token); f.draw();
    await f.settle(() => f.text().includes(selectedOutputShareCopy("en").unavailable));
    assert.equal(f.committed, lit.nothing); assert.equal(f.text().includes(PRIVATE), false);
  }
});

test("A to B to A retires both stale network completions despite a repeated token", async t => {
  const pending = [], f = fixture(t, { reply: () => { const request = deferred(); pending.push(request); return request.promise; } });
  f.setToken(TOKEN_B); f.draw(); f.setToken(TOKEN_A); f.draw();
  assert.equal(pending.length, 3);
  assert.equal(f.requests[0].init.signal.aborted, true); assert.equal(f.requests[1].init.signal.aborted, true);
  pending[2].resolve(response(output("scene", "Current A"))); await f.settle(() => f.text().includes("Current A"));
  pending[1].resolve(response(output("scene", "STALE B"), { token: TOKEN_B }));
  pending[0].resolve(response(output("scene", "STALE A")));
  await new Promise(setImmediate); f.draw();
  assert.ok(f.text().includes("Current A")); assert.doesNotMatch(f.text(), /STALE [AB]/u); assert.equal(f.requests.length, 3);
});

test("token replacement clears already displayed copy synchronously before replacement fetch settles", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  const held = deferred(); f.setReply(() => held.promise); f.setToken(TOKEN_B);
  assert.equal(f.committed, lit.nothing); assert.equal(f.content.renderer.markup.includes("Reviewed public title"), false);
  f.draw(); assert.equal(f.text().includes("Reviewed public title"), false);
  held.resolve(response(output("short_story", "Replacement B"), { token: TOKEN_B }));
  await f.settle(() => f.text().includes("Replacement B"));
});

test("locale updates replace functional labels without refetching or rewriting reviewed copy", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  for (const locale of ["fr", "ja", "ar", "en"]) {
    f.locale(locale); const copy = selectedOutputShareCopy(locale);
    assert.equal(f.nodes("main")[0].attributes["aria-label"], copy.sharedOutput);
    assert.equal(f.nodes("article")[0].attributes["aria-label"], copy.outputKinds.scene);
    assert.ok(f.text().includes("Reviewed public title")); assert.ok(f.text().includes(LITERAL));
    assert.equal(f.requests.length, 1);
  }
});

test("client expiry clears mounted output and owned timers without another request", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  assert.ok(f.timers.size > 0, "the original result owns a bounded expiry timer");
  f.advance(NOW + 60_000);
  assert.equal(f.committed, lit.nothing); assert.equal(f.text().includes("Reviewed public title"), false);
  assert.ok(f.text().includes(selectedOutputShareCopy("en").expired)); assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});

test("wall-clock rollback cannot extend the accepted output deadline across early timers and locale changes", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  f.advance(NOW - 30_000, 30_000);
  assert.ok(f.text().includes("Reviewed public title"), "an early timer preserves the unexpired result");
  f.locale("fr");
  f.advance(NOW - 60_000, 30_000);
  assert.equal(f.committed, lit.nothing, "the original elapsed-time deadline still retires the result");
  assert.ok(f.text().includes(selectedOutputShareCopy("fr").expired));
  assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 1);
});

test("a render observes elapsed expiry even when a timer is delayed and the wall clock moved backwards", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  f.setClock(NOW - 120_000, 60_000);
  f.draw();
  assert.equal(f.committed, lit.nothing);
  assert.ok(f.text().includes(selectedOutputShareCopy("en").expired));
  assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 1);
});

test("a queued old expiry callback cannot erase the replacement timer or prevent disconnect cleanup", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  const [oldId, oldTimer] = [...f.timers][0];
  f.setReply(() => response(output("scene", "Replacement timer"), { token: TOKEN_B })); f.setToken(TOKEN_B); f.draw();
  await f.settle(() => f.text().includes("Replacement timer"));
  assert.equal(f.timers.has(oldId), false);
  const [newId, newTimer] = [...f.timers][0]; assert.notEqual(newId, oldId);
  ports.bindFixture(f.f); oldTimer.callback();
  assert.equal(f.timers.get(newId), newTimer); assert.ok(f.text().includes("Replacement timer"));
  f.disconnect(); assert.equal(f.timers.size, 0); assert.equal(f.committed, lit.nothing);
});

test("disconnect synchronously clears content, aborts pending ownership and allows a fresh reconnect", async t => {
  const f = fixture(t); await f.settle(() => f.text().includes("Reviewed public title"));
  f.disconnect(); assert.equal(f.committed, lit.nothing); assert.equal(f.timers.size, 0);
  assert.equal(f.requests[0].init.signal.aborted, true);
  f.reconnect(); await f.settle(() => f.text().includes("Reviewed public title")); assert.equal(f.requests.length, 2);
  const held = deferred(); f.setReply(() => held.promise); f.setToken(TOKEN_B); f.draw(); f.disconnect();
  assert.equal(f.requests.at(-1).init.signal.aborted, true);
  held.resolve(response(output("scene", "Disconnected stale"), { token: TOKEN_B }));
  await new Promise(setImmediate); assert.equal(f.committed, lit.nothing);
});

test("non-200 responses refuse without consuming or exposing their private error bodies", async t => {
  const f = fixture(t, { token: "" });
  for (const status of [201, 204, 301, 401, 403, 404, 410, 500]) {
    let reads = 0;
    const failed = { status, ok: status >= 200 && status < 300, headers: new Headers({ "content-type": "application/json" }),
      url: "https://fixture.invalid" + pathFor(TOKEN_A), redirected: false,
      body: { getReader() { reads++; throw new Error(PRIVATE); }, cancel: async () => undefined },
      json() { reads++; throw new Error(PRIVATE); }, text() { reads++; throw new Error(PRIVATE); } };
    f.setReply(() => failed); f.setToken(String(status).padStart(32, "0")); f.draw();
    await f.settle(() => f.text().includes(selectedOutputShareCopy("en").unavailable));
    assert.equal(reads, 0, String(status)); assert.equal(f.committed, lit.nothing); assert.equal(f.text().includes(PRIVATE), false);
  }
});

test("invalid MIME, declared sizes, redirects and foreign response targets refuse", async t => {
  const f = fixture(t, { token: "" });
  const options = [
    { headers: { "content-type": "text/html" } }, { headers: { "content-type": "" } },
    ...[String(LIMIT + 1), "-1", "wat", "1.5"].map(length => ({ headers: { "content-length": length } })),
    { redirected: true }, { url: "https://untrusted.invalid" + pathFor(TOKEN_A) },
  ];
  for (const [index, value] of options.entries()) {
    const token = "H" + String(index).padStart(31, "0");
    f.setReply(() => response(output(), { token, ...value })); f.setToken(token); f.draw();
    await f.settle(() => f.text().includes(selectedOutputShareCopy("en").unavailable)); assert.equal(f.committed, lit.nothing);
  }
});

test("stream byte overflow is cancelled at the bound without consuming an unbounded tail", async t => {
  let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; if (pulls === 1) controller.enqueue(new Uint8Array(LIMIT + 1));
    else throw new Error("The oversized tail must not be read");
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const f = fixture(t, { reply: () => response(null, { body: stream }) });
  await f.settle(() => f.text().includes(selectedOutputShareCopy("en").unavailable));
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(f.committed, lit.nothing);
});

test("malformed UTF-8 refuses instead of repairing bytes into a displayable public body", async t => {
  const value = output(); value.content.text = "BAD_BYTE";
  const bytes = Buffer.from(JSON.stringify(value)); bytes[bytes.indexOf("BAD_BYTE")] = 0xff;
  const f = fixture(t, { reply: () => response(null, { body: bytes }) });
  await f.settle(() => f.text().includes(selectedOutputShareCopy("en").unavailable));
  assert.equal(f.committed, lit.nothing); assert.equal(f.text().includes("AD_BYTE"), false);
});

test("late streamed bytes from a retired request cannot replace current content", async t => {
  const bytes = new TextEncoder().encode(JSON.stringify(output("scene", "STALE streamed A")));
  let controller, waiting = false, cancels = 0;
  const stream = new ReadableStream({
    start(value) { controller = value; controller.enqueue(bytes.slice(0, 13)); },
    pull() { waiting = true; }, cancel() { cancels++; },
  }, { highWaterMark: 0 });
  const f = fixture(t, { reply: () => response(null, { body: stream }) });
  await f.settle(() => waiting);
  f.setReply(() => response(output("short_story", "Current streamed B"), { token: TOKEN_B }));
  f.setToken(TOKEN_B); f.draw();
  assert.equal(f.requests[0].init.signal.aborted, true);
  await f.settle(() => f.text().includes("Current streamed B"));
  controller.enqueue(bytes.slice(13));
  await new Promise(setImmediate); f.draw();
  assert.equal(cancels, 1); assert.ok(f.text().includes("Current streamed B"));
  assert.equal(f.text().includes("STALE streamed A"), false); assert.equal(f.requests.length, 2);
});

test("a bounded chunked JSON response is decoded once without a Content-Length requirement", async t => {
  const bytes = new TextEncoder().encode(JSON.stringify(output("short_story"))); let offset = 0, pulls = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; if (offset === bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, offset + 23); controller.enqueue(bytes.slice(offset, end)); offset = end;
  } }, { highWaterMark: 0 });
  const f = fixture(t, { reply: () => response(null, { body: stream }) });
  await f.settle(() => f.text().includes("Reviewed public title"));
  assert.ok(pulls > 1); assert.ok(f.text().includes(LITERAL)); assert.equal(f.requests.length, 1);
});
