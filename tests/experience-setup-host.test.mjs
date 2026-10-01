import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as lit from "lit";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { buildExperiencePlan, experienceDocumentRoute, initialValues, registeredExperience } from "../src/experiences/intake.ts";
import { definitions, fixtureCatalog } from "../src/experiences/catalog.ts";
import { classifyExperienceRoute } from "../src/experiences/routes.ts";

// Source execution is deferred until the owner admits tests. These are finite
// protocol/template/native-port cases, not Worker authority or browser paint,
// CSS/zoom, BFCache engine, IME, provider, or assistive-technology certification.
const options = { concurrency: false, timeout: 45000 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function turns() { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(setImmediate); }
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Observed readiness: " + label);
    await new Promise(setImmediate);
  }
}
async function planPort(id = "image") {
  const release = await registeredExperience(id), values = initialValues(release);
  for (const decision of release.definition.decisions) {
    const interaction = release.interactions[decision.id], entry = values[decision.id];
    if (interaction.kind === "source") entry.value = "Authored <reference> / نور / 文書";
    else if (interaction.kind === "relationship") entry.value = Object.fromEntries(interaction.fields.map(field => [field.id, "Authored " + field.id]));
    else if (interaction.kind === "order") entry.value = entry.value.map(item => ({ ...item, text: "Authored " + item.id }));
    else continue;
    entry.provenance = "authored";
  }
  const request = { intentId: crypto.randomUUID(), experienceId: id, releaseHash: release.releaseHash, values };
  let plan = await buildExperiencePlan("setup-host-test-owner", request, release);
  const calls = [];
  let committed = false;
  const receipts = new Map();
  const receiptFor = value => {
    if (!receipts.has(value.draftId)) receipts.set(value.draftId, {
      status: "complete", draftId: value.draftId, draftHash: value.draftHash,
      projectId: value.projectId, documentId: value.documentId, documentRoute: experienceDocumentRoute(value),
      head: value.events.length, rejected: [],
      appended: value.events.map((event, index) => ({ ...event, eventId: crypto.randomUUID(), actor: "user",
        streamId: value.streamId, clientId: "web:experience-intake", correlationId: "experience-intake:" + value.projectId,
        schemaVersion: 1, compensatesEventId: null, sequence: index + 1 })),
    });
    return receipts.get(value.draftId);
  };
  receiptFor(plan);
  const fetcher = async (path, init) => {
    const method = init?.method ?? "GET"; calls.push({ path, method, body: init?.body });
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    if (method === "POST" && path === "/api/experiences/drafts") {
      plan = await buildExperiencePlan("setup-host-test-owner", JSON.parse(init.body), release); receiptFor(plan);
      return Response.json({ plan });
    }
    if (path === "/api/experiences/drafts/" + plan.draftId + "/commit" && method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { draftHash: plan.draftHash }); committed = true;
      return Response.json(receiptFor(plan));
    }
    if (path === "/api/experiences/drafts/" + plan.draftId + "/receipt" && method === "GET") {
      return committed ? Response.json(receiptFor(plan)) : Response.json({ error: "project_intake_unconfirmed" }, { status: 409 });
    }
    assert.equal(method, "GET");
    assert.ok([ "/api/experiences/drafts/" + plan.draftId, "/api/experiences/drafts?intentId=" + plan.request.intentId ].includes(path));
    return Response.json({ plan });
  };
  return { release, request, get plan() { return plan; }, calls, fetcher, commitReceipt() { committed = true; } };
}

test("original recovery needs no current registration or UUID; explicit retry fails closed before POST", options, async t => {
  const p = await planPort(), index = definitions.findIndex(item => item.id === "image"), definition = definitions[index];
  definitions.splice(index, 1);
  t.after(() => definitions.splice(index, 0, definition));
  const mint = t.mock.method(crypto, "randomUUID", () => assert.fail("Recovery cannot mint another intent"));
  const runtime = new ExperienceIntakeRuntime({ experienceId: "image", id: p.plan.draftId, byIntent: false }, p.fetcher);
  t.after(() => runtime.dispose());
  assert.equal(runtime.release, undefined); assert.deepEqual(runtime.state.draft.values, {});
  await runtime.recover();
  assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.release.releaseHash, p.release.releaseHash);
  assert.equal(runtime.canRetry, true);
  assert.deepEqual(p.calls.map(call => call.method), ["GET", "GET"]);
  await runtime.submit();
  assert.equal(runtime.state.issues[0].code, "experience_release_changed");
  assert.deepEqual(p.calls.map(call => call.method), ["GET", "GET"]);
  p.commitReceipt(); await runtime.recover();
  assert.equal(runtime.state.phase, "complete"); assert.equal(runtime.documentRoute, experienceDocumentRoute(p.plan));
  assert.equal(mint.mock.callCount(), 0);
});

test("intent recovery retains the original plan, receipt and same-created-Document route", options, async t => {
  const p = await planPort("short-story"); p.commitReceipt();
  const runtime = new ExperienceIntakeRuntime({ experienceId: "short-story", id: p.plan.request.intentId, byIntent: true }, p.fetcher);
  t.after(() => runtime.dispose());
  await runtime.recover();
  assert.equal(runtime.state.phase, "complete"); assert.equal(runtime.draftId, p.plan.draftId);
  assert.equal(runtime.documentRoute, experienceDocumentRoute(p.plan));
  assert.deepEqual(p.calls.map(call => call.method), ["GET", "GET"]);
});

test("late original-plan resolution after dispose cannot bind release or expose a handoff", options, async () => {
  const p = await planPort(), gate = deferred();
  const runtime = new ExperienceIntakeRuntime({ experienceId: "image", id: p.plan.draftId, byIntent: false }, async () => gate.promise);
  const pending = runtime.recover(); runtime.dispose(); gate.resolve(Response.json({ plan: p.plan })); await pending;
  assert.equal(runtime.release, undefined); assert.equal(runtime.documentRoute, undefined);
  assert.equal(runtime.canRetry, false);
});

// This executes the complete entry source unchanged (including its literal
// dynamic imports) through the established ElementPort/RendererPort boundary.
// Only document/module/timing observations are controlled; the route classifier,
// intake runtime, source catalog and emitted Lit templates remain actual.
async function entryPort(t, address, controls = {}) {
  const { calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await ports.loadActual("src/components/design-system/localization.ts");
  const view = await ports.loadActual("src/experiences/view.ts");
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false, storage: new Map(), clipboard: [] };
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC", messages: FORMA_DEFAULT_MESSAGES, revision: 0 }, () => {}); return true;
  } });
  f.i18n.hostConnected(); ports.bindFixture(f);
  f.tick = async () => { await Promise.resolve(); return true; };
  f.renderer = new ports.RendererPort(f, {});
  const containers = new Map([["#experience-navigation", { value: lit.nothing }], ["#experience-host", { value: lit.nothing }]]);
  const registry = new Map([["forma-experience", view.FormaExperienceSurface]]);
  const handlers = new Map(), instances = [], notices = [], replacements = [], reads = [], callbacks = [], disposed = [], recoveries = [];
  const location = { href: address, replace(value) { replacements.push(value); } };
  const history = { replaceState(_state, _title, value) { notices.push(value); location.href = new URL(value, location.href).href; } };
  const disconnect = node => { if (node?.isConnected) { node.isConnected = false; node.disconnectedCallback?.(); } };
  const document = {
    querySelector: selector => containers.get(selector) ?? null,
    createElement(tag) {
      ports.bindFixture(f);
      const Constructor = registry.get(tag), node = Constructor ? new Constructor() : new ports.ElementPort();
      node.tag = tag; node.attributes = {}; node.style = { setProperty() {} };
      controls.node?.(node, tag);
      node.remove = () => { for (const container of containers.values()) if (container.value === node) container.value = lit.nothing; disconnect(node); };
      return node;
    },
  };
  const render = (value, container) => {
    controls.render?.(value, container);
    if (container.value !== value) disconnect(container.value);
    container.value = value;
    if (value instanceof ports.ElementPort && !value.isConnected) { value.isConnected = true; value.connectedCallback(); }
  };
  class ObservedRuntime extends ExperienceIntakeRuntime {
    constructor(admission) { super(admission, controls.fetcher ?? (async () => assert.fail("Entry must not make an unallocated request"))); instances.push(this); }
    subscribe(callback) { callbacks.push(callback); const release = super.subscribe(callback); return () => { controls.unsubscribe?.(this); release(); }; }
    dispose() { disposed.push(this); super.dispose(); controls.dispose?.(this); }
    recover() { const pending = super.recover(); recoveries.push(pending); return pending; }
  }
  const dependencies = new Map([
    ["lit", { ...lit, render }], ["forma:public-controls.css", {}], ["./style.css", {}],
    ["../components/presentational-element", { FormaPresentationalElement: ports.ElementPort }],
    ["./catalog.ts", { definitions, fixtureCatalog }],
    ["./intake.ts", { registeredExperience: id => { reads.push(id); return controls.registration ? controls.registration(id) : registeredExperience(id); } }],
    ["./intake-runtime.ts", { ExperienceIntakeRuntime: ObservedRuntime }],
    ["./routes.ts", { classifyExperienceRoute }],
    ["../components/design-system/locale-bootstrap.ts", controls.locale ?? {}],
    ["./view.ts", controls.view ?? view],
  ]);
  const require = name => { assert.ok(dependencies.has(name), "Every actual entry import has a declared finite port: " + name); return dependencies.get(name); };
  const window = { addEventListener(name, callback) { const list = handlers.get(name) ?? []; list.push(callback); handlers.set(name, list); } };
  const code = ts.transpileModule(fs.readFileSync(new URL("../src/experiences/entry.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "exports", "document", "window", "customElements", "location", "history", code)(
    require, {}, document, window, { get: name => registry.get(name), define: (name, Constructor) => registry.set(name, Constructor) }, location, history);
  const emit = (name, detail = {}) => { ports.bindFixture(f); for (const callback of handlers.get(name) ?? []) callback({ type: name, ...detail }); };
  t.after(() => { emit("pagehide", { persisted: false }); f.i18n.hostDisconnected(); });
  await turns();
  if (!controls.pending && !controls.locale && !controls.view && !controls.registration) {
    const route = classifyExperienceRoute(address);
    await waitFor(() => route?.kind === "retained" ? replacements.length > 0
      : route?.kind === "fresh" || route?.kind === "recover" ? containers.get("#experience-host").value !== lit.nothing && instances.length > 0 && instances.at(-1).state.phase !== "preparing"
      : containers.get("#experience-navigation").value !== lit.nothing, "actual entry mount or terminal route");
  }
  return { f, ports, containers, instances, callbacks, notices, replacements, reads, disposed, recoveries, location, emit, waitFor, async flush() { await turns(); },
    markup(selector) { const node = containers.get(selector).value; return node === lit.nothing ? "" : typeof node.render === "function" ? f.renderer.value(node.render(), node, "entry-port") : node.textContent ?? ""; } };
}

test("actual chooser has eight native output links and no runtime, registration or UUID", options, async t => {
  const mint = t.mock.method(crypto, "randomUUID", () => assert.fail("Chooser cannot mint an intent"));
  const f = await entryPort(t, "https://fixture.invalid/make");
  assert.equal(f.instances.length, 0); assert.deepEqual(f.reads, []);
  const markup = f.markup("#experience-navigation");
  assert.equal((markup.match(/<a /gu) ?? []).length, 8); assert.match(markup, /Choose an output/u);
  assert.equal(f.markup("#experience-host"), ""); assert.equal(mint.mock.callCount(), 0);
});

for (const suffix of ["?", "#", "?draft=", "?intent=bad", "?draft=bad&intent=bad", "?document=one", "?unknown=one", "?intent=00000000-0000-4000-8000-000000000001&intent=00000000-0000-4000-8000-000000000001"]) {
  test("actual invalid entry is closed before runtime/registration/UUID: " + suffix, options, async t => {
    const mint = t.mock.method(crypto, "randomUUID", () => assert.fail("Invalid route cannot mint an intent"));
    const f = await entryPort(t, "https://fixture.invalid/make/image" + suffix);
    assert.equal(f.instances.length, 0); assert.deepEqual(f.reads, []);
    assert.match(f.markup("#experience-navigation"), /Invalid experience address/u);
    assert.equal(f.markup("#experience-host"), ""); assert.equal(mint.mock.callCount(), 0);
  });
}

test("actual retained native identity performs document navigation without setup construction", options, async t => {
  const address = "https://fixture.invalid/make/short-story?document=retained-document&artifact=retained-artifact&revision=1&sha256=" + "a".repeat(64);
  const f = await entryPort(t, address);
  assert.equal(f.instances.length, 0); assert.deepEqual(f.reads, []);
  assert.deepEqual(f.replacements, [address]); assert.equal(f.markup("#experience-host"), "");
});

test("actual entry waits for locale and rejects both late registration and retired BFCache bindings", options, async t => {
  const locale = deferred(), registration = deferred();
  const f = await entryPort(t, "https://fixture.invalid/make/image", { locale: locale.promise, registration: () => registration.promise });
  assert.deepEqual(f.reads, []); assert.equal(f.instances.length, 0);
  locale.resolve({}); await f.waitFor(() => f.reads.length === 1, "registration reached after locale"); assert.deepEqual(f.reads, ["image"]);
  f.emit("pagehide", { persisted: true });
  registration.resolve(await registeredExperience("image")); await f.flush();
  assert.equal(f.instances.length, 0); assert.equal(f.markup("#experience-host"), "");
  f.emit("pageshow", { persisted: true }); await f.waitFor(() => f.containers.get("#experience-host").value !== lit.nothing, "fresh mount after pageshow");
  assert.equal(f.instances.length, 1); const prior = f.instances[0];
  f.emit("pagehide", { persisted: true }); assert.equal(f.markup("#experience-host"), "");
  f.emit("pageshow", { persisted: true }); await f.waitFor(() => f.instances.length === 2 && f.containers.get("#experience-host").value.runtime === f.instances[1], "replacement mount after second pageshow");
  assert.equal(f.instances.length, 2); assert.notEqual(f.instances[1], prior);
  assert.equal(prior.change("subject", "retired"), false);
  const before = f.notices.length; for (const callback of f.callbacks) callback();
  assert.equal(f.notices.length, before, "stale callbacks and benign notifications cannot rewrite the address");
});

test("actual recovery entry never registers today and deduplicates original recovery identity", options, async t => {
  const p = await planPort(), f = await entryPort(t, "https://fixture.invalid/make/image?intent=" + p.request.intentId, { fetcher: p.fetcher });
  assert.deepEqual(f.reads, []); assert.equal(f.instances.length, 1);
  assert.deepEqual(p.calls.map(call => call.method), ["GET", "GET"]);
  assert.equal(f.notices.length, 1); assert.match(f.location.href, /\?draft=experience-draft-/u);
  for (const callback of f.callbacks) callback(); assert.equal(f.notices.length, 1);
  f.location.href += "#"; f.emit("hashchange"); await f.flush();
  assert.equal(f.markup("#experience-host"), ""); assert.match(f.markup("#experience-navigation"), /Invalid experience address/u);
  assert.equal(f.instances[0].canRetry, false);
});

test("actual fresh entry writes recovery history only when identity changes, not per keystroke", options, async t => {
  const p = await planPort(), f = await entryPort(t, "https://fixture.invalid/make/image", { fetcher: p.fetcher });
  const runtime = f.instances[0];
  runtime.change("subject", "first"); runtime.change("subject", "second"); assert.equal(f.notices.length, 0);
  await runtime.prepare(); assert.equal(runtime.state.phase, "review");
  assert.equal(f.notices.length, 2, "one intent and one retained draft identity");
  runtime.back(); runtime.change("subject", "third"); const count = f.notices.length;
  runtime.change("subject", "fourth"); assert.equal(f.notices.length, count);
  assert.equal(f.location.href, "https://fixture.invalid/make/image");
});

test("late view import and late original GET cannot repopulate a retired actual entry", options, async t => {
  const p = await planPort(), view = deferred();
  const f = await entryPort(t, "https://fixture.invalid/make/image", { view: view.promise });
  await f.waitFor(() => f.instances.length === 1, "admission reaches held view import");
  assert.equal(f.instances.length, 1); f.emit("pagehide", { persisted: true });
  view.resolve({}); await f.flush(); assert.equal(f.markup("#experience-host"), "");
  const gate = deferred(), g = await entryPort(t, "https://fixture.invalid/make/image?draft=" + p.plan.draftId, { fetcher: () => gate.promise, pending: true });
  await g.waitFor(() => g.instances[0]?.state.phase === "preparing", "original GET reaches held response");
  g.emit("pagehide", { persisted: true }); const count = g.notices.length;
  gate.resolve(Response.json({ plan: p.plan })); await Promise.all(g.recoveries); await g.flush();
  assert.equal(g.markup("#experience-host"), ""); assert.equal(g.notices.length, count);
});

for (const fault of ["unsubscribe", "setter", "clear", "dispose"]) test("actual retirement attempts all independent cleanup after " + fault + " throws", options, async t => {
  let enabled = false, clears = 0, setter;
  const controls = {
    unsubscribe() { if (enabled && fault === "unsubscribe") throw new Error("declared cleanup failure"); },
    dispose() { if (enabled && fault === "dispose") throw new Error("declared cleanup failure"); },
    render(value) { if (enabled && value === lit.nothing) { clears++; if (fault === "clear") throw new Error("declared clear failure"); } },
    node(node, tag) {
      if (fault !== "setter" || tag !== "forma-experience") return;
      setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "runtime");
      Object.defineProperty(node, "runtime", { configurable: true, get() { return setter.get.call(this); }, set(value) {
        if (enabled && value === undefined) throw new Error("declared unbind failure");
        setter.set.call(this, value);
      } });
    },
  };
  const f = await entryPort(t, "https://fixture.invalid/make/image", controls), runtime = f.instances[0];
  enabled = true; f.emit("popstate"); await f.flush(); enabled = false;
  assert.ok(f.disposed.includes(runtime)); assert.ok(clears >= 2, "both independent shared containers were attempted");
  assert.equal(f.markup("#experience-host"), "", "the exact retired surface was removed even when a different cleanup failed");
  assert.equal(f.instances.length, 1, "failed cleanup blocks this bootstrap");
  assert.match(f.markup("#experience-navigation"), /Experience unavailable/u);
});

test("new bootstrap installed by old cleanup owns all later DOM and URL writes", options, async t => {
  let f, reenter = false;
  f = await entryPort(t, "https://fixture.invalid/make/image", { unsubscribe() {
    if (!reenter) return;
    reenter = false; f.location.href = "https://fixture.invalid/make/slides"; f.emit("popstate");
  } });
  const old = f.instances[0]; reenter = true; f.emit("popstate");
  await f.waitFor(() => f.instances.length === 2 && f.containers.get("#experience-host").value.runtime === f.instances[1], "newer reentrant bootstrap owns mount");
  assert.equal(f.instances.length, 2);
  assert.equal(f.instances[1].release.definition.id, "slides");
  assert.ok(f.disposed.includes(old));
  assert.equal(f.containers.get("#experience-host").value.runtime, f.instances[1]);
  const before = f.notices.length; for (const callback of f.callbacks) callback(); assert.equal(f.notices.length, before);
});

// Declared presentation phases exercise only the actual view and existing
// native-focus/template ports; these are not fabricated successful API receipts.
function phaseSurface(release, phase = "setup") {
  const listeners = new Set(), calls = { prepare: 0, back: 0, submit: 0, recover: 0, change: 0 };
  let state = { phase, issues: [], draft: { values: structuredClone(initialValues(release)) } }, available = true;
  const set = patch => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener(); };
  const runtime = {
    mode: "intake", canRetry: true, recovery: false,
    documentRoute: "/document/00000000-0000-4000-8000-000000000001",
    get release() { return available ? release : undefined; },
    get presentation() { return available ? release : undefined; },
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    change(id, value) {
      if (state.phase !== "setup") return false;
      calls.change++; set({ draft: { values: { ...state.draft.values, [id]: { value, provenance: "authored" } } } }); return true;
    },
    async prepare() { calls.prepare++; set({ phase: "review", issues: [] }); },
    back() { calls.back++; set({ phase: "setup", issues: [] }); },
    async submit() { calls.submit++; set({ phase: "complete", issues: [] }); },
    async recover() { calls.recover++; set({ phase: "complete", issues: [] }); },
    dispose() { listeners.clear(); },
  };
  return { runtime, calls, set, available(value) { available = value; set({}); } };
}
async function surfaceHost(t, { model, translations = {} }) {
  const { calmFullPageNativePorts: ports, fullPageTree } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  const { FormaExperienceSurface } = await ports.loadActual("src/experiences/view.ts");
  const { FormaUiField, FormaUiButton } = await ports.loadActual("src/components/design-primitives.ts");
  const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await ports.loadActual("src/components/design-system/localization.ts");
  const { formaSystemMessageId } = await ports.loadActual("src/components/design-system/system-message-id.ts");
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false, waits: [], hold: false, runtime: model.runtime, model };
  const messages = { ...FORMA_DEFAULT_MESSAGES, ...Object.fromEntries(Object.entries(translations).map(([source, translated]) =>
    [formaSystemMessageId(source.replace(/\s+/gu, " ").trim()), translated])) };
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale: "fr", formatLocale: "fr", direction: "ltr", timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected();
  const inputDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: class {
    static [Symbol.hasInstance](node) { return node instanceof ports.ElementPort && node.tag === "input"; }
  } });
  ports.bindFixture(f);
  f.host = new FormaExperienceSurface(); f.host.tag = "forma-experience"; f.host.runtime = f.runtime; f.host.attributes = {}; f.host.isConnected = true;
  f.renderer = new ports.RendererPort(f, { "forma-ui-field": FormaUiField, "forma-ui-button": FormaUiButton });
  f.tree = () => fullPageTree(f);
  f.native = installOutputNavigationFocusNative(t, f, ports);
  // These are controlled document/window ports, not native browser lifecycle proof.
  // Document events still use the established native map. The exact defaultView
  // read by the view owns a separate window map so blur never masquerades as focusin.
  const focusDocument = f.native.document, priorWindow = focusDocument.defaultView;
  const focusDescriptors = [], windowListeners = new Map();
  const replaceFocusPort = (owner, key, descriptor) => {
    const previous = Object.getOwnPropertyDescriptor(owner, key);
    Object.defineProperty(owner, key, { configurable: true, ...descriptor });
    focusDescriptors.push(() => { if (previous) Object.defineProperty(owner, key, previous); else delete owner[key]; });
  };
  f.pageVisible = true; f.windowFocused = true; f.focusCleanupAttempts = [];
  const ownerWindow = Object.create(priorWindow);
  ownerWindow.addEventListener = (type, callback) => {
    const callbacks = windowListeners.get(type) ?? new Set(); callbacks.add(callback); windowListeners.set(type, callbacks);
    f.focusPortAdd?.("window", type, callback);
  };
  ownerWindow.removeEventListener = (type, callback) => {
    f.focusCleanupAttempts.push(["window", type]); windowListeners.get(type)?.delete(callback);
    f.focusPortRemove?.("window", type, callback);
  };
  replaceFocusPort(focusDocument, "defaultView", { value: ownerWindow, writable: true });
  replaceFocusPort(focusDocument, "visibilityState", { get: () => f.pageVisible ? "visible" : "hidden" });
  replaceFocusPort(focusDocument, "hasFocus", { value: () => f.windowFocused, writable: true });
  const documentAdd = focusDocument.addEventListener, documentRemove = focusDocument.removeEventListener;
  replaceFocusPort(focusDocument, "addEventListener", { value(type, callback, ...args) {
    documentAdd.call(this, type, callback, ...args); f.focusPortAdd?.("document", type, callback);
  }, writable: true });
  replaceFocusPort(focusDocument, "removeEventListener", { value(type, callback, ...args) {
    f.focusCleanupAttempts.push(["document", type]); documentRemove.call(this, type, callback, ...args);
    f.focusPortRemove?.("document", type, callback);
  }, writable: true });
  f.emitVisibility = visible => {
    ports.bindFixture(f); f.pageVisible = visible;
    const event = { type: "visibilitychange", target: focusDocument, currentTarget: focusDocument };
    for (const callback of [...(f.listeners.get(event.type) ?? [])]) callback(event);
  };
  f.emitWindowFocus = focused => {
    ports.bindFixture(f); f.windowFocused = focused;
    const event = { type: focused ? "focus" : "blur", target: ownerWindow, currentTarget: ownerWindow };
    for (const callback of [...(windowListeners.get(event.type) ?? [])]) callback(event);
  };
  f.windowListeners = type => windowListeners.get(type)?.size ?? 0;
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    const found = query(owner, selector);
    if (f.renderer.updatingOwner || !selector.includes("[")) return found;
    const selected = new Set(found);
    return f.tree().nodes.filter(row => selected.has(row.port) || selected.has(row.component)).map(row => row.component ?? row.port);
  };
  f.draw = () => {
    ports.bindFixture(f); if (!f.host.isConnected) return;
    f.requested = false; f.renderer.draw(f.host);
    for (const row of f.tree().nodes) if (row.component) row.component.attributes = { ...row.attributes };
  };
  f.tick = async () => { await Promise.resolve(); f.draw(); if (f.hold) await new Promise(resolve => f.waits.push(resolve)); return true; };
  f.flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); if (f.requested) f.draw(); } await new Promise(setImmediate); if (f.requested) f.draw(); };
  f.inputs = () => f.tree().visible("input").map(row => row.port);
  f.act = async button => { f.native.emit("pointerdown", button); f.native.focus(button); button.click(); await f.flush(); };
  f.press = label => { const button = f.tree().visible("button").find(row => row.text === label); assert.ok(button, label); return f.act(button.port); };
  f.release = async () => { f.hold = false; for (const resolve of f.waits.splice(0)) resolve(); await f.flush(); };
  f.host.connectedCallback(); f.draw();
  t.after(async () => {
    try {
      f.host.isConnected = false; f.host.disconnectedCallback(); await f.release();
      f.runtime.dispose(); f.i18n.hostDisconnected();
      assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
      assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
    } finally {
      for (const restore of focusDescriptors.reverse()) restore();
      if (inputDescriptor) Object.defineProperty(globalThis, "HTMLInputElement", inputDescriptor); else delete globalThis.HTMLInputElement;
    }
  });
  return f;
}

test("actual setup view owns Review, Back and completion successor focus", options, async t => {
  const model = phaseSurface(await registeredExperience("image")), f = await surfaceHost(t, { model });
  await f.press("Review");
  assert.equal(model.calls.prepare, 1);
  assert.equal(f.native.document.activeElement, f.tree().visible("h2").find(row => row.text === "Review").port);
  await f.press("Back");
  assert.equal(model.calls.back, 1);
  assert.equal(f.native.document.activeElement, f.tree().visible("section").find(row => row.attributes.class === "experience-controls").port);
  await f.press("Review"); await f.press("Save to Forma");
  assert.equal(model.calls.submit, 1);
  assert.equal(f.native.document.activeElement, f.tree().visible("h2").find(row => row.text === "Document saved").port);
});

for (const [phase, label] of [["setup", "Review"], ["review", "Back"], ["review", "Save to Forma"], ["uncertain", "Check result"]]) {
  test("actual " + label + " successor focus retires on newer keyboard work", options, async t => {
    const model = phaseSurface(await registeredExperience("image"), phase), f = await surfaceHost(t, { model });
    f.hold = true; await f.press(label); assert.ok(f.waits.length > 0);
    f.native.emit("keydown"); const after = f.native.nativeFocus.length;
    await f.release(); assert.equal(f.native.nativeFocus.length, after);
  });
}

test("retained decision and Review handlers cannot revive after A to B to A binding", options, async t => {
  const release = await registeredExperience("image"), a = phaseSurface(release), b = phaseSurface(release), f = await surfaceHost(t, { model: a });
  t.after(() => b.runtime.dispose());
  const staleInput = f.renderer.component("forma-ui-field").eventBindings["forma-input"];
  const staleReview = f.tree().visible("button").find(row => row.text === "Review").port.owner.eventBindings["forma-press"];
  f.host.runtime = b.runtime; f.host.runtime = a.runtime; f.draw();
  staleInput.call(f.host, { detail: { value: "Retired input" } }); staleReview.call(f.host, {});
  await f.flush(); assert.equal(a.calls.change + a.calls.prepare + b.calls.change + b.calls.prepare, 0);
  f.renderer.component("forma-ui-field").eventBindings["forma-input"].call(f.host, { detail: { value: "Current input" } });
  assert.equal(a.calls.change, 1);
});

test("runtime replacement preserves a newer binding installed by old cleanup", options, async t => {
  const release = await registeredExperience("image"), a = phaseSurface(release), b = phaseSurface(release), c = phaseSurface(release);
  let f, rebound = false, cleanups = 0;
  const subscribe = a.runtime.subscribe.bind(a.runtime);
  a.runtime.subscribe = listener => { const releaseListener = subscribe(listener); return () => {
    cleanups++; releaseListener(); if (!rebound && f) { rebound = true; f.host.runtime = b.runtime; }
  }; };
  f = await surfaceHost(t, { model: a }); t.after(() => { b.runtime.dispose(); c.runtime.dispose(); });
  f.host.runtime = c.runtime;
  assert.equal(cleanups, 1); assert.equal(f.host.runtime, b.runtime);
  f.draw(); await f.press("Review"); assert.equal(b.calls.prepare, 1); assert.equal(c.calls.prepare, 0);
});

test("blocked, unbound and unvalidated views return no authored setup subtree", options, async t => {
  const model = phaseSurface(await registeredExperience("image"));
  model.runtime.change("subject", "PRIVATE_VIEW_SENTINEL");
  const f = await surfaceHost(t, { model });
  assert.ok(f.inputs().some(input => input.value === "PRIVATE_VIEW_SENTINEL"));
  model.set({ phase: "blocked" }); f.draw(); assert.equal(f.inputs().length, 0); assert.equal(f.tree().visible("button").length, 0);
  assert.doesNotMatch(f.renderer.markup, /PRIVATE_VIEW_SENTINEL/u);
  model.set({ phase: "setup" }); f.draw(); assert.ok(f.inputs().some(input => input.value === "PRIVATE_VIEW_SENTINEL"));
  f.host.runtime = undefined; f.draw(); assert.equal(f.inputs().length, 0); assert.doesNotMatch(f.renderer.markup, /PRIVATE_VIEW_SENTINEL/u);
  f.host.runtime = model.runtime; model.available(false); model.set({ phase: "uncertain" }); f.draw();
  assert.equal(f.inputs().length, 0); assert.deepEqual(f.tree().visible("button").map(row => row.text), ["Check result"]);
  assert.doesNotMatch(f.renderer.markup, /PRIVATE_VIEW_SENTINEL/u);
  t.diagnostic("Returned-template/component withdrawal only; native Lit synchronous paint removal remains browser qualification.");
});

test("trusted labels, repeat actions and issues translate without translating authored values", options, async t => {
  const release = await registeredExperience("slides"), model = phaseSurface(release);
  const source = release.definition.decisions.find(decision => release.interactions[decision.id].kind === "source"), label = release.copy[source.labelKey];
  const authored = "  Review / opaque-document-id / sha256-identity\n<reference> & \"quoted\"  ";
  model.runtime.change(source.id, authored);
  const f = await surfaceHost(t, { model, translations: {
    [label]: "LABEL_TRANSLATED", [authored]: "NEVER_TRANSLATE_AUTHORED",
    Review: "REVIEW_TRANSLATED", Required: "REQUIRED_TRANSLATED", "Move up": "UP_TRANSLATED", "Move down": "DOWN_TRANSLATED",
    "Document setup · No generation": "MODE_TRANSLATED",
  } });
  assert.equal(f.inputs().find(input => input.attributes.name === source.id).value, authored);
  assert.ok(f.tree().visible("label").some(row => row.text.startsWith("LABEL_TRANSLATED")));
  for (const text of ["REVIEW_TRANSLATED", "UP_TRANSLATED", "DOWN_TRANSLATED"]) assert.ok(f.tree().visible("button").some(row => row.text === text));
  model.set({ phase: "review" }); f.draw();
  const summary = f.renderer.markup.match(/<dl class="experience-summary">([\s\S]*?)<\/dl>/u)?.[1];
  assert.ok(summary); assert.ok(summary.includes(authored.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
  assert.doesNotMatch(summary, /NEVER_TRANSLATE_AUTHORED/u);
  model.set({ phase: "setup", issues: [{ code: "required", path: source.id }] }); f.draw();
  assert.ok(f.tree().visible("small").some(row => row.text === "REQUIRED_TRANSLATED"));
  assert.equal(f.inputs().find(input => input.attributes.name === source.id).value, authored);
});

for (const fault of ["action", "action-sync", "back-promise", "update", "focus", "cleanup"]) test("rejected " + fault + " is owned status, never an unhandled completion", options, async t => {
  const model = phaseSurface(await registeredExperience("image"), fault === "back-promise" ? "review" : "setup"), f = await surfaceHost(t, { model });
  if (fault === "action") model.runtime.prepare = async () => { throw new Error("declared action rejection"); };
  if (fault === "action-sync") model.runtime.prepare = () => { throw new Error("declared synchronous action failure"); };
  if (fault === "back-promise") model.runtime.back = async () => { throw new Error("declared returned Back rejection"); };
  if (fault === "update") f.tick = async () => { throw new Error("declared update rejection"); };
  if (fault === "cleanup") {
    const remove = f.native.document.removeEventListener;
    f.native.document.removeEventListener = function(...args) {
      remove.apply(this, args);
      if (args[0] === "focusin") { this.removeEventListener = remove; throw new Error("declared finalizer failure"); }
    };
  }
  if (fault === "focus") {
    const query = f.host.querySelector.bind(f.host);
    f.host.querySelector = selector => {
      const target = query(selector);
      if (selector === ".experience-review-heading" && target) target.focus = () => { throw new Error("declared focus rejection"); };
      return target;
    };
  }
  await f.press(fault === "back-promise" ? "Back" : "Review"); await f.flush();
  assert.match(f.renderer.markup, /Experience unavailable/u);
  assert.equal(f.tree().visible("a").filter(row => row.text === "Edit in Forma").length, 0);
  assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
});

for (const retirement of ["replacement", "disconnect", "newer-action", "input", "composition"]) test("late rejected action cannot mark " + retirement + " unavailable", options, async t => {
  const release = await registeredExperience("image"), model = phaseSurface(release), f = await surfaceHost(t, { model }), gate = deferred();
  const prepare = model.runtime.prepare.bind(model.runtime); model.runtime.prepare = () => gate.promise;
  await f.press("Review");
  if (retirement === "replacement") {
    const replacement = phaseSurface(release); t.after(() => replacement.runtime.dispose());
    f.host.runtime = replacement.runtime; f.draw();
  } else if (retirement === "disconnect") {
    f.host.isConnected = false; f.host.disconnectedCallback();
  } else if (retirement === "input") {
    f.renderer.component("forma-ui-field").eventBindings["forma-input"].call(f.host, { detail: { value: "Newer authored input" } }); f.draw();
  } else if (retirement === "composition") {
    f.host.listeners.compositionstart();
  } else {
    model.runtime.prepare = prepare; await f.press("Review");
  }
  const focused = f.native.nativeFocus.length;
  gate.reject(new Error("retired action rejected")); await f.flush();
  assert.equal(f.native.nativeFocus.length, focused);
  if (retirement !== "disconnect") assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u);
});


// Focus-successor qualification only. These local document/window ports do not
// model browser throttling, native tab switching, paint, or assistive technology.
for (const [phase, label, call] of [["setup", "Review", "prepare"], ["review", "Back", "back"], ["review", "Save to Forma", "submit"], ["uncertain", "Check result", "recover"]]) {
  for (const transition of ["hidden", "hide-show", "unfocused", "blur-focus"]) {
    test("held " + label + " focus retires irreversibly on " + transition, options, async t => {
      const model = phaseSurface(await registeredExperience("image"), phase), f = await surfaceHost(t, { model });
      f.hold = true; await f.press(label);
      assert.ok(f.waits.length > 0, "the actual view successor awaits its held update");
      assert.equal(model.calls[call], 1, "the explicit action runs before focus is withdrawn");
      assert.equal(f.native.listeners("visibilitychange"), 1);
      assert.equal(f.windowListeners("blur"), 1);
      const before = f.native.nativeFocus.length;
      if (transition === "hidden" || transition === "hide-show") {
        assert.doesNotThrow(() => f.emitVisibility(false));
        if (transition === "hide-show") assert.doesNotThrow(() => f.emitVisibility(true));
      } else {
        assert.doesNotThrow(() => f.emitWindowFocus(false));
        if (transition === "blur-focus") assert.doesNotThrow(() => f.emitWindowFocus(true));
      }
      // No pointer, keyboard, or in-page focus event is delivered after withdrawal.
      assert.equal(f.native.nativeFocus.length, before);
      await f.release();
      assert.equal(f.native.nativeFocus.length, before, "showing/refocusing cannot revive the retired successor");
      assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u);
      assert.equal(model.calls[call], 1);
      assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
      assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
    });
  }
}

for (const [phase, label, call, snapshot] of [["setup", "Review", "prepare", "hidden"], ["review", "Back", "back", "unfocused"], ["review", "Save to Forma", "submit", "hidden"], ["uncertain", "Check result", "recover", "unfocused"]]) {
  test("held " + label + " rechecks " + snapshot + " without a delivered lifecycle event", options, async t => {
    const model = phaseSurface(await registeredExperience("image"), phase), f = await surfaceHost(t, { model });
    f.hold = true; await f.press(label); assert.ok(f.waits.length > 0);
    assert.equal(model.calls[call], 1);
    const before = f.native.nativeFocus.length;
    if (snapshot === "hidden") f.pageVisible = false; else f.windowFocused = false;
    // No event retires the lease: the actual final visibility/focus guard must do so.
    assert.equal(f.native.listeners("visibilitychange"), 1); assert.equal(f.windowListeners("blur"), 1);
    await f.release();
    assert.equal(f.native.nativeFocus.length, before);
    assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u);
    assert.equal(model.calls[call], 1);
    assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
    assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
  });
}

for (const [fault, scope, type, event] of [["visibility-remove", "document", "visibilitychange", "hidden"], ["window-blur-remove", "window", "blur", "blur"], ["base-focus-remove", "document", "focusin", "hidden"]]) {
  test("focus retirement independently attempts every cleanup after " + fault, options, async t => {
    const model = phaseSurface(await registeredExperience("image")), f = await surfaceHost(t, { model });
    f.hold = true; await f.press("Review"); assert.ok(f.waits.length > 0);
    const before = f.native.nativeFocus.length;
    let failed = false;
    f.focusPortRemove = (actualScope, actualType) => {
      if (!failed && actualScope === scope && actualType === type) { failed = true; throw new Error("declared focus cleanup failure"); }
    };
    assert.doesNotThrow(() => event === "hidden" ? f.emitVisibility(false) : f.emitWindowFocus(false));
    assert.equal(failed, true, "the selected actual cleanup port was reached");
    f.focusPortRemove = undefined;
    for (const [expectedScope, expectedType] of [["document", "visibilitychange"], ["window", "blur"], ["document", "pointerdown"], ["document", "keydown"], ["document", "focusin"]]) {
      assert.ok(f.focusCleanupAttempts.some(([actualScope, actualType]) => actualScope === expectedScope && actualType === expectedType), expectedScope + " " + expectedType + " cleanup attempted");
    }
    await f.release();
    assert.equal(model.calls.prepare, 1); assert.equal(f.native.nativeFocus.length, before);
    assert.match(f.renderer.markup, /Experience unavailable/u, "current owned cleanup failure has a functional status");
    assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
    assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
  });
}

test("focus capture and failing retirement cannot overwrite a reentrant newer binding", options, async t => {
  const release = await registeredExperience("image"), a = phaseSurface(release), b = phaseSurface(release), c = phaseSurface(release);
  const f = await surfaceHost(t, { model: a }); t.after(() => { b.runtime.dispose(); c.runtime.dispose(); });
  let captured = false;
  f.focusPortAdd = (scope, type) => {
    if (captured || scope !== "document" || type !== "visibilitychange") return;
    captured = true; f.focusPortAdd = undefined; f.host.runtime = b.runtime;
  };
  await f.press("Review");
  assert.equal(captured, true, "replacement occurs inside the old lease's actual listener registration");
  assert.equal(f.host.runtime, b.runtime);
  assert.equal(a.calls.prepare, 0, "retired capture cannot invoke the old explicit action");
  assert.equal(b.calls.prepare, 0, "replacement does not inherit the old gesture");
  assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
  assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
  f.draw(); f.hold = true; await f.press("Review"); assert.ok(f.waits.length > 0);
  const before = f.native.nativeFocus.length;
  let rebound = false;
  f.focusPortRemove = (scope, type) => {
    if (rebound || scope !== "document" || type !== "visibilitychange") return;
    rebound = true; f.focusPortRemove = undefined; f.host.runtime = c.runtime;
    throw new Error("retired binding cleanup failure");
  };
  assert.doesNotThrow(() => f.emitVisibility(false)); assert.equal(rebound, true);
  f.emitVisibility(true); await f.release(); f.draw();
  assert.equal(f.host.runtime, c.runtime); assert.equal(b.calls.prepare, 1); assert.equal(c.calls.prepare, 0);
  assert.equal(f.native.nativeFocus.length, before);
  assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u, "old event failure cannot mark the new binding failed");
  assert.equal(f.native.listeners("visibilitychange"), 0); assert.equal(f.windowListeners("blur"), 0);
  assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
});

// Direct lifecycle restoration, distinct from the asynchronous successor lease.
// Keep the actual rendered button connected between actual lifecycle hooks; the
// finite renderer redraw would replace ordinary literal nodes. These ports do
// not certify native browser fallthrough, input selection, paint, or AT behavior.
for (const fallthrough of ["body", "host"]) test("direct updated restores a surviving descendant after " + fallthrough + " fallthrough", options, async t => {
  const model = phaseSurface(await registeredExperience("image")), f = await surfaceHost(t, { model });
  const target = f.tree().visible("button").find(row => row.text === "Review").port;
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  assert.equal(target.ownerDocument, f.native.document);
  f.native.focus(target); f.host.willUpdate(new Map());
  const fallback = fallthrough === "body" ? f.native.document.body : f.host;
  f.native.document.activeElement = fallback;
  const before = f.native.nativeFocus.length;
  f.host.updated();
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  const restored = f.native.nativeFocus.slice(before);
  assert.equal(restored.length, 1); assert.equal(restored[0].node, target); assert.equal(restored[0].previous, fallback);
  assert.deepEqual(restored[0].args, [{ preventScroll: true }]); assert.equal(f.native.document.activeElement, target);
  assert.deepEqual(model.calls, { prepare: 0, back: 0, submit: 0, recover: 0, change: 0 });
});

for (const snapshot of ["hidden", "unfocused"]) test("direct willUpdate clears an earlier eligible capture while " + snapshot, options, async t => {
  const model = phaseSurface(await registeredExperience("image")), f = await surfaceHost(t, { model });
  const target = f.tree().visible("button").find(row => row.text === "Review").port;
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  f.native.focus(target); f.host.willUpdate(new Map());
  if (snapshot === "hidden") f.pageVisible = false; else f.windowFocused = false;
  f.host.willUpdate(new Map());
  f.pageVisible = true; f.windowFocused = true;
  // Visibility/focus is eligible again: only clearing the denied capture blocks restoration.
  const fallback = f.native.document.body; f.native.document.activeElement = fallback;
  const before = f.native.nativeFocus.length;
  f.host.updated();
  assert.equal(f.native.nativeFocus.length, before); assert.equal(f.native.document.activeElement, fallback);
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  assert.deepEqual(model.calls, { prepare: 0, back: 0, submit: 0, recover: 0, change: 0 });
  assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u);
});

for (const snapshot of ["hidden", "unfocused"]) test("direct updated refuses and clears restoration when immediately " + snapshot, options, async t => {
  const model = phaseSurface(await registeredExperience("image")), f = await surfaceHost(t, { model });
  const target = f.tree().visible("button").find(row => row.text === "Review").port;
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  f.native.focus(target); f.host.willUpdate(new Map());
  const fallback = f.native.document.body; f.native.document.activeElement = fallback;
  const before = f.native.nativeFocus.length;
  if (snapshot === "hidden") f.pageVisible = false; else f.windowFocused = false;
  // No lifecycle event or redraw intervenes: updated must check the final snapshot.
  f.host.updated();
  assert.equal(f.native.nativeFocus.length, before); assert.equal(f.native.document.activeElement, fallback);
  f.pageVisible = true; f.windowFocused = true; f.host.updated();
  assert.equal(f.native.nativeFocus.length, before, "eligible state cannot revive the denied direct restoration");
  assert.equal(f.native.document.activeElement, fallback);
  assert.equal(target.isConnected, true); assert.equal(f.host.contains(target), true);
  assert.deepEqual(model.calls, { prepare: 0, back: 0, submit: 0, recover: 0, change: 0 });
  assert.doesNotMatch(f.renderer.markup, /Experience unavailable/u);
});
