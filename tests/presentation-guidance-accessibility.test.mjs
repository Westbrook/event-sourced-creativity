import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";
import * as lit from "lit";
const { nothing } = lit;
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { foldEvents } from "../src/model/events.ts";
import enMessages from "../src/components/design-system/locales/system-en.ts";
import frMessages from "../src/components/design-system/locales/fr.ts";
import arMessages from "../src/components/design-system/locales/ar.ts";
import jaMessages from "../src/components/design-system/locales/ja.ts";
import { outputFixtureFocusDocument } from "./output-ui-source-harness.mjs";

// This runs actual component renderers and handlers with in-memory application,
// template, focus, and modal ports. It is not a browser/AT or viewport certificate.
// Both complete production classes and the real LocaleController execute here.
// Only application storage, native-modal/focus, and template-to-node inspection are ports.
const root = new URL("../", import.meta.url);
registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith(root.href)) { const candidate = new URL(specifier + ".ts", context.parentURL); if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true }; } return next(specifier, context); } });
const sourceText = relative => fs.readFileSync(new URL(relative, root), "utf8");
const syntax = relative => ts.createSourceFile(relative, sourceText(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const moduleCache = new Map();
let activeFixture;
const cacheType = cache(nothing)._$litDirective$;
const keyedType = keyed("", nothing)._$litDirective$;
const repeatType = repeat([], item => item, () => nothing)._$litDirective$;
const templateIds = new WeakMap();
let templateSequence = 0;
const templateId = strings => { if (!templateIds.has(strings)) templateIds.set(strings, ++templateSequence); return templateIds.get(strings); };
const escapeText = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const decodeText = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const cell = initial => { let value = initial; return { get: () => value, set: next => { value = next; } }; };
const localeCatalogs = { en: enMessages, fr: frMessages, ar: arMessages, ja: jaMessages };

class ElementPort {
  constructor() { this.store = activeFixture?.store; this.i18n = activeFixture?.i18n; this.fixture = activeFixture; this.isConnected = false; this.parentElement = null; this.tag = ""; }
  get renderRoot() { return this; }
  get ownerDocument() { return documentPort; }
  get updateComplete() { return this.fixture.tick(this); }
  requestUpdate() { this.fixture.requested = true; }
  connectedCallback() {}
  disconnectedCallback() {}
  querySelector(selector) { return this.fixture.renderer.query(this, selector)[0] ?? null; }
  querySelectorAll(selector) { return this.fixture.renderer.query(this, selector); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes ?? {}, name); }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
  closest(selector) { if (selector === "forma-workspace") return this.fixture.workspace; let owner = this.parentElement; while (owner) { if (owner.tag === selector) return owner; owner = owner.parentElement; } return null; }
  dispatchEvent(event) {
    if (this.eventBindings?.[event.type]) this.eventBindings[event.type].call(this.parentElement, event);
    this.fixture.trace.push("event:" + event.type);
    return true;
  }
  focus() { documentPort.focus(this); this.fixture.trace.push("focus:" + this.tag); }
}
// Reuse the existing finite document event port: only actual focus calls update
// activeElement and notify the real lease; redraw never remaps focus to a new node.
const documentPort = Object.assign(outputFixtureFocusDocument(), { documentElement: { lang: "en", dataset: {} }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null });
const windowPort = { requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
const modalPort = { ensureModalDialog(dialog) { if (!dialog) return false; if (!dialog.open) { dialog.open = true; activeFixture.trace.push("open:" + dialog.attributes.class); } return true; }, requestDialogText: async () => null };

async function loadActual(relative) {
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const tree = syntax(relative), dependencies = new Map();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === "lit") dependencies.set(specifier, lit);
    else if (specifier === "lit/directives/cache.js") dependencies.set(specifier, { cache });
    else if (specifier === "lit/directives/keyed.js") dependencies.set(specifier, { keyed });
    else if (specifier === "lit/directives/repeat.js") dependencies.set(specifier, { repeat });
    // Extracted data-URL fixtures have no package base; resolve from the real fixture root.
    else if (specifier.startsWith("lit/")) dependencies.set(specifier, await import(pathToFileURL(createRequire(new URL("package.json", root)).resolve(specifier)).href));
    else if (/\/(?:forma-element|presentational-element)(?:\.ts)?$/.test(specifier)) dependencies.set(specifier, { FormaElement: ElementPort, FormaPresentationalElement: ElementPort, icon: () => nothing, copyTextToClipboard: async value => { activeFixture.clipboard.push(value); return true; } });
    else if (specifier === "./modal-dialog") dependencies.set(specifier, modalPort);
    else if (/\/icons$/.test(specifier)) dependencies.set(specifier, { icon: () => nothing, registerIcons() {} });
    else if (specifier.includes("?raw")) dependencies.set(specifier, { default: "" });
    else if (specifier === "./consequential-preview") dependencies.set(specifier, { consequentialPreview: () => nothing });
    else if (specifier.includes("/model/") || specifier === "../state/next-action-context") {
      const url = new URL(specifier.endsWith(".ts") ? specifier : specifier + ".ts", new URL(relative, root));
      dependencies.set(specifier, await import(url.href));
    } else if (specifier.startsWith(".")) {
      const target = fileURLToPath(new URL(specifier.endsWith(".ts") ? specifier : specifier + ".ts", new URL(relative, root)));
      const targetRelative = target.slice(fileURLToPath(root).length);
      dependencies.set(specifier, await loadActual(targetRelative));
    } else throw new Error("Unmocked module port " + specifier);
  }
  let source = sourceText(relative);
  if (relative === "src/components/document-artifacts.ts") {
    const component = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DocumentArtifacts");
    // State-only test probe; the production constructor, full renderer and form submit handler stay intact.
    source = source.slice(0, component.end - 1) + "\nconfigurePresentationForTest(mode: ProductionMode, count: number) { this.#productionMode = mode; this.#itemCount = count; }\n" + source.slice(component.end - 1);
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, registry = { get() { return true; }, define() {} };
  const require = specifier => dependencies.get(specifier) ?? {};
  new Function("require", "exports", "customElements", "document", "window", "HTMLElement", "Element", "CSS", "location", "ResizeObserver", "getComputedStyle", "matchMedia", "InputEvent", code)(
    require, exports, registry, documentPort, windowPort, ElementPort, ElementPort, { escape: String }, { origin: "https://fixture.invalid" }, class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" }), () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), class InputEvent {},
  );
  moduleCache.set(relative, exports);
  return exports;
}

class RendererPort {
  constructor(fixture, registry) { this.fixture = fixture; this.registry = registry; this.instances = new Map(); this.nodes = []; this.bindings = []; this.activeCaches = new Set(); this.seen = new Set(); this.markup = ""; }
  reference(value, owner) { const id = this.bindings.push({ value, owner }) - 1; return "__bound_" + id + "__"; }
  resolve(value) { const exact = value.match(/^__bound_(\d+)__$/); if (exact) return this.bindings[Number(exact[1])]?.value; return value.replace(/__bound_(\d+)__/g, (_, id) => String(this.bindings[Number(id)]?.value ?? "")); }
  attrs(raw) {
    const attributes = {}, properties = {}, handlers = {};
    for (const [, name, double, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = this.resolve(double ?? single ?? bare ?? "");
      if (name[0] === ".") properties[name.slice(1)] = value;
      else if (name[0] === "@") handlers[name.slice(1)] = value;
      else if (name[0] === "?") { if (value) attributes[name.slice(1)] = ""; }
      else if (value !== nothing) attributes[name] = value;
    }
    return { attributes, properties, handlers };
  }
  value(value, owner, path, caches = []) {
    if (value == null || value === nothing || typeof value === "boolean") return "";
    if (Array.isArray(value)) return value.map((item, index) => this.value(item, owner, path + "/" + index, caches)).join("");
    if (value?._$litDirective$ === keyedType) return this.value(value.values[1], owner, path + "/key:" + String(value.values[0]), caches);
    if (value?._$litDirective$ === cacheType) { this.activeCaches.add(path); return this.value(value.values[0], owner, path + "/cached", [...caches, path]); }
    if (value?._$litDirective$ === repeatType) { const [items, identify, render] = value.values; return [...items].map((item, index) => this.value(render(item, index), owner, path + "/repeat:" + identify(item, index), caches)).join(""); }
    if (!value?.strings) return escapeText(value);
    path += "/template:" + templateId(value.strings);
    let result = "";
    for (let index = 0; index < value.strings.length; index++) {
      result += value.strings[index];
      if (index < value.values.length) {
        const inTag = result.lastIndexOf("<") > result.lastIndexOf(">");
        result += inTag ? this.reference(value.values[index], owner) : this.value(value.values[index], owner, path + "/part:" + index, caches);
      }
    }
    let ordinal = 0;
    result = result.replace(/<(forma-[\w-]+)([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag, raw, content) => {
      if (raw.includes("data-rendered-port") || !this.registry[tag]) return whole;
      const props = this.attrs(raw), id = path + "/element:" + ordinal++ + ":" + tag;
      let record = this.instances.get(id);
      if (!record) {
        activeFixture = this.fixture;
        const instance = new this.registry[tag]();
        instance.parentElement = owner; instance.tag = tag; instance.attributes = props.attributes;
        record = { instance, caches }; this.instances.set(id, record);
      }
      const instance = record.instance;
      instance.eventBindings = props.handlers;
      record.caches = caches; this.seen.add(id);
      for (const [name, value] of Object.entries(props.attributes)) {
        const definition = Object.entries(instance.constructor.properties ?? {}).find(([key, options]) => (options.attribute ?? key.toLowerCase()) === name);
        if (definition) instance[definition[0]] = definition[1].type === Boolean ? true : value;
      }
      Object.assign(instance, props.properties);
      if (!instance.isConnected) { instance.isConnected = true; instance.connectedCallback(); }
      this.updatingOwner = instance;
      instance.willUpdate?.(new Map());
      this.updatingOwner = null;
      const child = this.value(instance.render(), instance, id, caches);
      instance.markup = child;
      this.collect(child, instance);
      if (!record.firstRendered) { record.firstRendered = true; instance.firstUpdated?.(); }
      instance.updated?.();
      return "<" + tag + " data-rendered-port=\"true\"" + raw + ">" + child + content + "</" + tag + ">";
    });
    return result;
  }
  collect(markup, owner) {
    for (const [full, tag, raw] of markup.matchAll(/<([\w-]+)([^>]*)>/g)) {
      const parsed = this.attrs(raw), node = { tag, owner, ...parsed, full, open: Object.hasOwn(parsed.attributes, "open"), isConnected: true, value: parsed.properties.value ?? parsed.attributes.value ?? "", checked: parsed.properties.checked ?? false };
      node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
      node.addEventListener = (type, handler) => { (node.listeners ??= {})[type] = handler; };
      node.classList = { contains: name => String(node.attributes.class ?? "").split(/\s+/).includes(name) };
      node.setCustomValidity = value => { node.validationMessage = value; };
      node.reportValidity = () => !node.validationMessage;
      node.querySelector = selector => this.query(owner, selector)[0] ?? null;
      node.focus = () => { documentPort.focus(node); this.fixture.trace.push("focus:" + (node.attributes.class ?? node.tag)); };
      node.closest = () => null;
      node.close = () => { if (node.open) { this.fixture.trace.push("close:" + node.attributes.class); node.open = false; node.handlers.close?.call(owner, { target: node, currentTarget: node }); node.listeners?.close?.(); } };
      this.nodes.push(node);
    }
  }
  draw(host, render = () => host.render()) {
    activeFixture = this.fixture;
    this.previousNodes = this.nodes;
    this.nodes = []; this.bindings = []; this.activeCaches.clear(); this.seen.clear();
    host.isConnected = true; this.updatingOwner = host; host.willUpdate?.(this.fixture.changed ?? new Map()); this.fixture.changed = new Map(); this.updatingOwner = null;
    this.markup = this.value(render(), host, "host");
    host.markup = this.markup; this.collect(this.markup, host);
    for (const [id, record] of this.instances) if (!this.seen.has(id)) {
      if (record.instance.isConnected) { record.instance.isConnected = false; record.instance.disconnectedCallback(); }
      if (!record.caches.some(key => this.activeCaches.has(key))) this.instances.delete(id);
    }
    host.updated?.();
    return this.markup;
  }
  query(owner, selector) {
    if (selector.includes(",")) return selector.split(",").flatMap(part => this.query(owner, part.trim()));
    const within = candidate => { let current = candidate; while (current) { if (!owner || current === owner) return true; current = current.parentElement; } return false; };
    if (/^forma-/.test(selector)) return [...this.instances.values()].map(record => record.instance).filter(instance => instance.isConnected && within(instance.parentElement) && instance.tag === selector);
    return (this.updatingOwner ? this.previousNodes : this.nodes).filter(node => within(node.owner) && (!selector.startsWith("dialog") || node.tag === "dialog") && (!selector.includes("[open]") || node.open) && (!selector.includes("[popover]") || Object.hasOwn(node.attributes, "popover")) && (!selector.includes(".") || String(node.attributes.class ?? "").split(/\s+/).includes(selector.match(/\.([\w-]+)/)?.[1])) && (!/^[a-z]/.test(selector) || node.tag === selector.match(/^[\w-]+/)?.[0] || selector.includes(" ")));
  }
  component(tag, blockId) { return [...this.instances.values()].map(record => record.instance).find(instance => instance.tag === tag && (instance.block?.id ?? instance.blockId) === blockId); }
  ownNodes(owner, tag) { return this.nodes.filter(node => node.owner === owner && node.tag === tag); }
  controls(tag) { return [...this.markup.matchAll(new RegExp("<" + tag + "(?=[\\s>])", "g"))].length; }
  handler(owner, tag, predicate, eventName = "click") {
    const found = this.ownNodes(owner, tag).find(predicate);
    assert.ok(found, tag + " handler exists"); assert.equal(typeof found.handlers[eventName], "function");
    return async (event = {}) => found.handlers[eventName].call(owner, { target: found, currentTarget: found, preventDefault() {}, stopPropagation() {}, ...event });
  }
}



const { DocumentArtifacts } = await loadActual("src/components/document-artifacts.ts");
const { PresentationRejectedDrafts } = await loadActual("src/components/presentation-rejected-drafts.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const { buildPresentationSourceContract } = await import("../src/model/presentation-source.ts");
const { formatPresentationSourceIssue, formatPresentationSourceIssues } = await loadActual("src/components/presentation-source-guidance.ts");

function sourceFixture({ research = true, manuscript = false } = {}) {
  return [
    ...(research ? [
      { id: "orchard-research", type: "message", text: "Orchard yield reached 12.50% with drip irrigation." },
      { id: "archive-research", type: "message", text: "Archive retrieval covers 28 catalog records." },
    ] : []),
    { id: "output-outline", type: manuscript ? "direction" : "format", text: manuscript
      ? "Presentation manuscript\nSlide 1: Orchard harvest\nOrchard yield reached 12.50% with drip irrigation.\nSlide 2: Archive retrieval\nArchive retrieval covers 28 catalog records."
      : "Presentation outline\nSlide 1: Orchard harvest. Explain orchard yield and drip irrigation.\nSlide 2: Archive retrieval. Describe archive retrieval and catalog records." },
  ];
}

function fixture(t, { locale = "en", viewer = false, facts = sourceFixture(), details = [], sourceText = "", jobs, preservedJobs = [] } = {}) {
  const state = { authorization: "scope-A", canRead: true, canRequest: true, documentId: "A", events: [], requests: [], loads: [] };
  const f = { state, locale, trace: [], clipboard: [], listeners: new Map(), changed: new Map(), steps: 0, requested: false };
  const messages = { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[locale] };
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 1 }, () => {});
    return true;
  } });
  f.i18n.hostConnected();
  const append = (type, payload) => {
    const event = { eventId: "event-" + (state.events.length + 1), streamId: "stream", sequence: state.events.length + 1,
      actor: "user:owner", correlationId: "fixture", occurredAt: "2026-08-27T00:00:00Z", type, payload };
    state.events.push(event); return event;
  };
  append("ProjectCreated", { project_id: "p", name: "Synthetic source and private-draft test" });
  append("DocumentCreated", { project_id: "p", document_id: "A", title: "Author-owned document" });
  for (const [index, fact] of facts.entries()) append("BlockCreated", { project_id: "p", document_id: "A", block_id: fact.id,
    type: fact.type, handle: fact.type + "/" + fact.id, position: "a" + index, properties: { text: fact.text, weight: 1, intent: "include" } });
  const projection = () => foldEvents(state.events, Infinity, state.documentId, "p");
  const sourceOwners=new WeakSet();
  const sourceScopeActive=source=>Boolean(source&&sourceOwners.has(source)&&state.canRead&&source.authorization.key===state.authorization);
  f.store = {
    ui: { instrumentation: false },
    session: { get: () => ({ user: { userId: "owner", role: "user" },
      provider: { configured: true, videoConfigured: true, audioConfigured: true, model: "fixture-model" },
      capabilities: [...(state.canRead ? ["project.read", "project.author"] : []), ...(state.canRequest ? ["project.output.request"] : [])] }) },
    captureAuthorizationScope: () => state.canRead ? { key: state.authorization, shared: false } : null,
    authorizationScopeActive: scope => state.canRead && scope?.key === state.authorization,
    captureSourceOwnership:()=>{if(!state.canRead)return null;const source=Object.freeze({authorization:Object.freeze({key:state.authorization,shared:false}),generation:0});sourceOwners.add(source);return source;},
    sourceOwnershipScopeActive:sourceScopeActive,
    sourceOwnershipActive:sourceScopeActive,
    // Existing authored records are fully present; Output itself has not been read.
    routeDataReady: () => {
      const current = f.store.projection.get();
      return state.canRead && current.documents.some(document => document.id === current.documentId
        && document.projectId === current.projectId && !document.removed);
    },
    outputRequirements: { resource: () => ({ state: "loading", snapshot: null, error: null }) },
    projection: { get: projection }, events: { get: () => state.events }, eventView: { get: () => state.events },
    asOf: cell(Infinity), content: cell({}), head: { get: () => state.events.length },
    canvasProjection: cell({ selectedCanvasId: "", canvases: [] }), projectNotifications: cell([]), reviewInbox: cell([]),
    documentJobs: cell([]), generationReadiness: cell({}), route: { get: () => "/document/" + state.documentId },
    documentRenderJobs: () => [], toast: message => f.trace.push("toast:" + message),
    ensurePrivateContent: async () => assert.fail("No extra private-content request is allowed"),
    renderDocumentArtifact: async (...args) => { state.requests.push(args); return true; },
    loadPreservedPresentationCandidateJobs: async () => ({ documentId: "A", jobs: preservedJobs }),
    loadPresentationCandidates: async (jobId, documentId) => {
      state.loads.push(["list", jobId, documentId]);
      return { jobId, documentId, candidates: details.map(detail => ({ ...detail })) };
    },
    loadPresentationCandidate: async (jobId, responseId, documentId) => {
      state.loads.push(["detail", jobId, responseId, documentId]);
      return structuredClone(details.find(detail => detail.responseId === responseId));
    },
    preservePresentationCandidate: async () => assert.fail("Inspecting evidence must not preserve or mutate it"),
  };
  if (sourceText) f.store.content.set({ private: sourceText });
  f.renderer = new RendererPort(f, {});
  f.tick = async () => { f.steps++; await Promise.resolve(); f.draw(); return true; };
  f.workspace = { get updateComplete() { return f.tick(); } };
  activeFixture = f;
  f.host = viewer ? new PresentationRejectedDrafts() : new DocumentArtifacts();
  f.host.documentId = "A";
  if (viewer) f.host.jobs = jobs ?? [{ jobId: "job-private", documentId: "A", dismissedAt: null }];
  else f.host.launcherOnly = true;
  f.host.isConnected = true; f.host.connectedCallback();
  f.draw = () => { activeFixture = f; return f.renderer.draw(f.host); };
  f.flush = async () => { await new Promise(setImmediate); f.draw(); await Promise.resolve(); };
  f.open = async (mode = "manual", count = 2) => {
    assert.equal(await f.host.openRender("slides", "A", { current: () => state.canRead }), true);
    f.host.configurePresentationForTest(mode, count); f.draw();
  };
  f.submit = async () => {
    await f.renderer.handler(f.host, "form", node => node.attributes.class === "document-artifact-dialog", "submit")();
    await f.flush();
  };
  f.buttons = () => [...f.renderer.markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, raw, content]) => ({
    ...f.renderer.attrs(raw), text: decodeText(content.replace(/<[^>]+>/gu, "")).trim(),
  }));
  f.reviewButtons = () => f.buttons().filter(button => button.text.startsWith(f.i18n.t("presentation.draft.review") + " · "));
  f.click = async text => {
    const button = f.buttons().find(item => item.text === text); assert.ok(button, "actual rendered button " + text);
    await button.handlers.click.call(f.host, { preventDefault() {}, stopPropagation() {}, currentTarget: {} }); await f.flush();
  };
  f.summaries = () => [...f.renderer.markup.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gu)]
    .map(([, content]) => decodeText(content.replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim());
  f.visible = () => decodeText(f.renderer.markup.replace(/<[^>]+>/gu, ""));
  f.withdraw = () => { state.canRead = false; state.authorization = "scope-withdrawn"; activeFixture = f;
    for (const listener of f.listeners.get("forma-authorization-changed") ?? []) listener(); f.draw();
  };
  f.draw();
  t.after(() => { activeFixture = f; f.host.disconnectedCallback(); f.i18n.hostDisconnected(); });
  return f;
}

function candidate(attempt = 1, overrides = {}) {
  return {
    responseId: "PRIVATE_RESPONSE_" + attempt, jobId: "job-private", documentId: "A", model: "fixture-model",
    capturedAt: "2026-08-27T00:00:0" + attempt + ".000Z", expiresAt: "2026-09-01T00:00:00.000Z", retentionClass: "transient-private",
    stage: attempt === 1 ? "initial" : "repair", providerAttempt: attempt, pageIndex: 1, pageCount: 2, globalStartIndex: 8,
    generatedSlideCount: 2, requestedSlideCount: 12, plannedSlideCount: 12, providerBatchCount: 2, providerCalls: 2,
    settledCostMicrousd: 1560, complete: false, reviewOnlyReason: "historical-validation-rejection",
    accounting: { settled_cost_microusd: 1560, settled_cost_complete: true, reservation_microusd: 0, reservation_status: "settled",
      actual_provider_call_count: 2, attempted_provider_call_count: 2, unresolved_provider_call_count: 0, provider_submission_uncertain: false },
    title: "Customer {title} – دليل العميل 顧客の文言", summary: "Customer summary unchanged.",
    presentation: null, slides: [], normalizationChanges: [], missingContextGroupLabels: [], issues: [],
    citationChecks: [0, 1].map(index => ({ slideIndex: index, citationIndex: 0, sourceLabel: "Customer research label",
      excerpt: "Exact customer wording " + index + " {private} — 客户原文", excerptTruncated: false,
      sourceStatus: "authorized", excerptStatus: "grounded", anchorStatus: "valid",
      passages: [{ content: "Original frozen customer research " + index + " with no alteration.", truncated: false }],
    })),
    ...overrides,
  };
}

async function inspect(t, locale, details) {
  const f = fixture(t, { locale, viewer: true, details });
  await f.click(f.reviewButtons()[0].text);
  for (const detail of details) await f.click(f.i18n.t("presentation.draft.attemptButton", "", {
    stage: f.i18n.t(detail.stage === "repair" ? "presentation.draft.repair" : "presentation.draft.initial"),
    attempt: f.i18n.number(detail.providerAttempt), page: f.i18n.number(detail.pageIndex + 1),
  }));
  return f;
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("presentation guidance " + locale + ": generation review names identify the run without exposing private identifiers", async t => {
    const requestedAt = "2026-09-02T18:14:20.508Z";
    const jobs = [
      { jobId: "PRIVATE_MANAGED_JOB", documentId: "A", productionMode: "managed", requestedAt, attemptCount: 2, dismissedAt: null },
      { jobId: "PRIVATE_MANUAL_JOB", documentId: "A", productionMode: "manual", requestedAt, attemptCount: 1, dismissedAt: null },
      { jobId: "PRIVATE_LEGACY_JOB", documentId: "A", productionMode: "PRIVATE_UNKNOWN_MODE", requestedAt: "PRIVATE_INVALID_DATE", attemptCount: Number.NaN, dismissedAt: null },
    ], before = structuredClone(jobs);
    const f = fixture(t, { locale, viewer: true, jobs, preservedJobs: [{ jobId: "PRIVATE_PRESERVED_JOB", documentId: "A" }] });
    await f.flush();
    const buttons = f.reviewButtons(), names = buttons.map(button => button.attributes["aria-label"] ?? button.text);
    assert.equal(names.length, 4); assert.equal(new Set(names).size, 4, "same-time and retained-only runs remain distinguishable");
    assert.ok(names[0].includes(f.i18n.t("presentation.draft.managedMode")));
    assert.ok(names[1].includes(f.i18n.t("presentation.draft.manualMode")));
    assert.ok(names[1].includes(f.i18n.t("presentation.draft.requestedAt", "", { date: f.i18n.date(new Date(requestedAt), { dateStyle: "medium", timeStyle: "short" }) })));
    assert.ok(names[0].includes(f.i18n.t("presentation.draft.jobAttempt", "", { attempt: f.i18n.number(2) })));
    assert.ok(names[3].includes(f.i18n.t("presentation.draft.generation", "", { number: f.i18n.number(4) })));
    assert.doesNotMatch(names.join(" "), /PRIVATE|undefined|NaN|Invalid Date/u);
    assert.equal(f.state.loads.length, 0, "labels use existing metadata without private detail requests");
    await f.click(buttons[1].text);
    assert.deepEqual(f.state.loads, [["list", "PRIVATE_MANUAL_JOB", "A"]]);
    const selectedLabel = buttons[1].text.slice(f.i18n.t("presentation.draft.review").length + 3);
    assert.equal(f.visible().split(selectedLabel).length - 1, 2, "the dialog repeats the exact selected run label");
    assert.deepEqual(jobs, before, "labels do not rewrite job records");
    assert.equal(f.state.requests.length, 0); assert.equal(f.clipboard.length, 0);
  });

  test("presentation guidance " + locale + ": only a server-offered revision explains the separate unapproved copy", async t => {
    for (const eligible of [false, true]) {
      const detail = candidate(1, eligible ? { revision: { token: "PRIVATE_REVISION_TOKEN", fields: [] } } : {});
      const before = structuredClone(detail), f = await inspect(t, locale, [detail]);
      assert.equal(f.visible().includes(f.i18n.t("presentation.draft.historicalRejectionEditable")), eligible);
      assert.equal(f.visible().includes(f.i18n.t("presentation.draft.historicalRejection")), !eligible);
      assert.equal(f.buttons().some(button => button.text === f.i18n.t("presentation.draft.revisionEditor")), eligible);
      assert.doesNotMatch(f.visible(), /PRIVATE_REVISION_TOKEN/u);
      assert.deepEqual(detail, before); assert.equal(f.state.requests.length, 0); assert.equal(f.clipboard.length, 0);
    }
  });

  test("presentation guidance " + locale + ": full private viewer gives all six citation disclosures unique nonprivate names", async t => {
    const details = [candidate(1), candidate(2)], before = structuredClone(details), f = await inspect(t, locale, details);
    const names = f.summaries();
    assert.equal(names.length, 6); assert.equal(new Set(names).size, 6);
    for (const detail of details) {
      const attempt = f.i18n.t("presentation.draft.attemptButton", "", { stage: f.i18n.t(detail.stage === "repair" ? "presentation.draft.repair" : "presentation.draft.initial"),
        attempt: f.i18n.number(detail.providerAttempt), page: f.i18n.number(detail.pageIndex + 1) });
      assert.ok(names.some(name => name.startsWith(f.i18n.t("presentation.draft.citationChecks", "", { count: f.i18n.number(2) })) && name.includes(attempt)));
      for (const check of detail.citationChecks) {
        const position = f.i18n.t("presentation.draft.citationPosition", "", { slide: f.i18n.number(detail.globalStartIndex + check.slideIndex + 1), citation: f.i18n.number(check.citationIndex + 1) });
        assert.ok(names.some(name => name.startsWith(f.i18n.t("presentation.draft.citationPassage")) && name.includes(attempt) && name.includes(position)));
        assert.ok(f.visible().includes(check.excerpt)); assert.ok(f.visible().includes(check.passages[0].content));
      }
    }
    assert.doesNotMatch(names.join(" "), /PRIVATE_RESPONSE|job-private|Customer|fixture-model/u);
    assert.deepEqual(details, before, "display labels never rewrite private evidence");
    assert.equal(f.state.requests.length, 0); assert.equal(f.clipboard.length, 0);
    assert.equal(f.buttons().some(button => /(?:approve|export|share|retry|release)/iu.test(button.text)), false);
  });

  test("presentation guidance " + locale + ": unknown repair billing stays unknown and shows its hold and unresolved call separately", async t => {
    const detail = candidate(1, { providerCalls: 1, settledCostMicrousd: null, accounting: {
      settled_cost_microusd: null, settled_cost_complete: false, reservation_microusd: 1_000_000, reservation_status: "executing",
      actual_provider_call_count: 1, attempted_provider_call_count: 2, unresolved_provider_call_count: 1, provider_submission_uncertain: true,
    } }), before = structuredClone(detail), f = await inspect(t, locale, [detail]), text = f.visible();
    assert.ok(text.includes(f.i18n.t("presentation.draft.settlementPending")));
    assert.ok(!text.includes(f.i18n.t("presentation.draft.settledCost")));
    assert.ok(text.includes(f.i18n.t("presentation.draft.retainedReservation")));
    assert.ok(text.includes(f.i18n.number(1, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 })));
    assert.ok(text.includes(f.i18n.t("presentation.draft.unresolvedCalls")));
    assert.ok(text.includes(f.i18n.t("presentation.draft.confirmedCalls")));
    assert.ok(text.includes(f.i18n.t("presentation.draft.attemptCount", "", { attempt: f.i18n.number(1), total: f.i18n.number(2) })));
    assert.ok(!text.includes(f.i18n.t("presentation.draft.attemptCount", "", { attempt: f.i18n.number(1), total: f.i18n.number(1) })));
    assert.ok(!text.includes(f.i18n.number(0, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 })));
    assert.deepEqual(detail, before); assert.equal(f.state.requests.length, 0);
  });

  test("presentation guidance " + locale + ": inline source alert and blocked form use the same localized typed guidance", async t => {
    for (const mode of ["manual", "managed"]) {
      const facts = sourceFixture({ research: false }), f = fixture(t, { locale, facts }); await f.open(mode, 2);
      const snapshot = { facts: facts.map(fact => ({ block_id: fact.id, type: fact.type, properties: { text: fact.text, weight: 1 } })), relationships: [] };
      const issues = buildPresentationSourceContract(snapshot, { requestedSlideCount: 2 }).sourceIssues;
      const expected = formatPresentationSourceIssues(issues, f.i18n);
      assert.ok(issues.length >= 2);
      assert.ok(f.visible().includes(expected));
      assert.ok(f.visible().includes(f.i18n.t("presentation.planning.noProvider")));
      if (locale !== "en") assert.ok(!f.visible().includes(issues[0].message), "no unlocalized repair sentence appears in the alert");
      const create = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.class === "button primary");
      assert.ok(create && Object.hasOwn(create.attributes, "disabled"));
      await f.submit();
      assert.deepEqual(f.trace.filter(value => value.startsWith("toast:")), ["toast:" + expected]);
      assert.equal(f.state.requests.length, 0, "calling the disabled form handler still cannot create paid work");
    }
  });
}

const receiptRows = f => new Map([...f.renderer.markup.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/gu)]
  .map(([, label, value]) => [decodeText(label.replace(/<[^>]+>/gu, "")), decodeText(value.replace(/<[^>]+>/gu, ""))]));

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("presentation guidance " + locale + ": complete accounting alone permits the all-calls amount, including a verified zero", async t => {
    for (const amount of [1560, 0]) {
      const detail = candidate(1, { settledCostMicrousd: amount, accounting: { ...candidate().accounting, settled_cost_microusd: amount } });
      const f = await inspect(t, locale, [detail]), rows = receiptRows(f);
      assert.equal(rows.get(f.i18n.t("presentation.draft.settledCost")), f.i18n.number(amount / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 }));
      assert.equal(rows.get(f.i18n.t("presentation.draft.confirmedCalls")), f.i18n.number(2));
      assert.equal(rows.get(f.i18n.t("presentation.draft.unresolvedCalls")), f.i18n.number(0));
      assert.equal(rows.get(f.i18n.t("presentation.draft.providerAttempt")), f.i18n.t("presentation.draft.attemptCount", "", { attempt: f.i18n.number(1), total: f.i18n.number(2) }));
      assert.ok(!f.visible().includes(f.i18n.t("presentation.draft.settlementPending")));
      assert.equal(detail.complete, false, "settlement never approves a rejected output");
      assert.equal(f.state.requests.length, 0);
    }
  });

  test("presentation guidance " + locale + ": missing or contradictory accounting cannot become a settled-total certificate", async t => {
    for (const change of [
      detail => { delete detail.accounting; },
      detail => { detail.accounting.settled_cost_complete = undefined; },
      detail => { detail.accounting.settled_cost_complete = "true"; },
      detail => { detail.accounting.settled_cost_microusd = null; },
      detail => { detail.accounting.settled_cost_microusd = Number.NaN; },
      detail => { detail.accounting.settled_cost_microusd = -1; },
      detail => { detail.accounting.unresolved_provider_call_count = 1; },
      detail => { detail.accounting.actual_provider_call_count = null; },
      detail => { detail.accounting.attempted_provider_call_count = 1; },
      detail => { detail.accounting.provider_submission_uncertain = true; },
      detail => { detail.accounting.reservation_microusd = null; },
      detail => { detail.accounting.reservation_status = "unknown"; },
      detail => { detail.accounting.reservation_microusd = 1_000_000; },
    ]) {
      const detail = candidate(2); change(detail);
      const f = await inspect(t, locale, [detail]), rows = receiptRows(f);
      assert.equal(rows.has(f.i18n.t("presentation.draft.settledCost")), false);
      assert.equal(rows.get(f.i18n.t("presentation.draft.settlement")), f.i18n.t("presentation.draft.settlementPending"));
      assert.equal(f.state.requests.length, 0);
    }
  });

  test("presentation guidance " + locale + ": verified partial charges, pending hold and unresolved calls remain distinct", async t => {
    const detail = candidate(1, { providerCalls: 1, settledCostMicrousd: null, accounting: {
      settled_cost_microusd: 780, settled_cost_complete: false, reservation_microusd: 1_000_000, reservation_status: "executing",
      actual_provider_call_count: 1, attempted_provider_call_count: 2, unresolved_provider_call_count: 1, provider_submission_uncertain: true,
    } }), f = await inspect(t, locale, [detail]), rows = receiptRows(f);
    assert.equal(rows.get(f.i18n.t("presentation.draft.settledSoFar")), f.i18n.number(.000780, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 }));
    assert.equal(rows.get(f.i18n.t("presentation.draft.confirmedCalls")), f.i18n.number(1));
    assert.equal(rows.get(f.i18n.t("presentation.draft.unresolvedCalls")), f.i18n.number(1));
    assert.ok(rows.get(f.i18n.t("presentation.draft.retainedReservation")).includes(f.i18n.number(1, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 })));
    assert.equal(rows.has(f.i18n.t("presentation.draft.settledCost")), false);
    assert.equal(f.state.requests.length, 0);
  });

  test("presentation guidance " + locale + ": all typed source issues use safe localized parameters and never raw wording", t => {
    const f = fixture(t, { locale });
    const mapping = [
      ["ambiguous_presentation_output", "output", {}],
      ["ambiguous_presentation_source_mode", "mode", {}],
      ["ambiguous_presentation_slide_number", "duplicateNumber", { slideNumber: 12 }],
      ["unresolved_outline_evidence", "unresolvedEvidence", { slideNumber: 12 }],
      ["unassigned_required_presentation_source", "requiredEvidence", {}],
      ["outline_slide_count_conflict", "countConflict", { requestedSlideCount: 12, authoredSlideCount: 9 }],
      ["ambiguous_presentation_requirement", "requirement", { slideNumber: 12 }],
    ];
    for (const [code, key, parameters] of mapping) {
      const issue = { code, parameters, path: "PRIVATE_SOURCE_PATH", message: "RAW_PRIVATE_ENGLISH_REPAIR {customer}" };
      const text = formatPresentationSourceIssue(issue, f.i18n);
      assert.equal(text, f.i18n.t("presentation.source." + key, "", {
        slide: f.i18n.t("presentation.source.slide", "", { number: f.i18n.number(12) }),
        group: f.i18n.system("Combined Context"), authored: f.i18n.number(9), requested: f.i18n.number(12),
      }));
      assert.doesNotMatch(text, /PRIVATE|RAW_|undefined|NaN|\{customer\}/u);
      assert.equal(issue.message, "RAW_PRIVATE_ENGLISH_REPAIR {customer}");
    }
    for (const value of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "PRIVATE_SLIDE_ID"]) {
      const text = formatPresentationSourceIssue({ code: "unresolved_outline_evidence", parameters: { slideNumber: value } }, f.i18n);
      assert.ok(text.includes(f.i18n.t("presentation.source.slideUnspecified")));
      assert.doesNotMatch(text, /PRIVATE|undefined|NaN|Infinity|-1/u);
    }
    const unknown = Object.defineProperty({ code: "new_unrecognized_source_code" }, "message", { get() { throw new Error("unknown guidance must not read a diagnostic string"); } });
    assert.equal(formatPresentationSourceIssue(unknown, f.i18n), f.i18n.t("presentation.source.unavailable"));
  });

  test("presentation guidance " + locale + ": valid research stays creatable and manuscript minimum guidance is localized", async t => {
    for (const mode of ["manual", "managed"]) {
      const f = fixture(t, { locale, facts: sourceFixture() }); await f.open(mode, 2);
      const create = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.class === "button primary");
      assert.ok(create && !Object.hasOwn(create.attributes, "disabled"));
      assert.ok(!f.visible().includes(f.i18n.t("presentation.source.unavailable")));
      await f.submit(); assert.equal(f.state.requests.length, 1, "the same actual submit handler retains legitimate generation reachability");
      const manuscript = fixture(t, { locale, facts: sourceFixture({ manuscript: true }) }); await manuscript.open(mode, 1);
      assert.ok(manuscript.visible().includes(manuscript.i18n.t("presentation.source.minimumSlides", "", { minimum: manuscript.i18n.number(2) })));
      assert.equal(manuscript.state.requests.length, 0);
    }
  });

  test("presentation guidance " + locale + ": unknown historical validation cannot imply approval in any comparison", async t => {
    const detail = candidate(1, { reviewOnlyReason: "validation-provenance-unavailable", complete: true });
    const f = await inspect(t, locale, [detail]);
    assert.ok(f.visible().includes(f.i18n.t("presentation.draft.provenanceUnavailable")));
    await f.click(f.i18n.t("presentation.draft.compareRequested"));
    assert.ok(f.visible().includes(f.i18n.t("presentation.draft.provenanceUnavailable")));
    assert.ok(!f.visible().includes(f.i18n.t("presentation.draft.requestComplete")));
    assert.equal(f.state.requests.length, 0);
  });

  test("presentation guidance " + locale + ": authorization withdrawal clears visible private evidence and blocks late read restoration", async t => {
    const f = await inspect(t, locale, [candidate(1)]);
    f.withdraw();
    assert.equal(f.summaries().length, 0);
    assert.doesNotMatch(f.visible(), /Customer \{title\}|Original frozen customer research|Exact customer wording/u);
    const pending = fixture(t, { locale, viewer: true, details: [candidate(1)] }), gate = Promise.withResolvers();
    pending.store.loadPresentationCandidate = async () => gate.promise;
    await pending.click(pending.reviewButtons()[0].text);
    pending.withdraw(); gate.resolve(candidate(1)); await pending.flush();
    assert.doesNotMatch(pending.visible(), /Customer \{title\}|Original frozen customer research|Exact customer wording/u);
    assert.equal(pending.state.requests.length, 0);
  });
}

test("presentation guidance: emitted native summaries share logical 44px target and forced-colors focus rules", async t => {
  const f = await inspect(t, "ar", [candidate(1), candidate(2)]), sheet = postcss.parse(sourceText("src/styles.css"));
  const rules = []; sheet.walkRules(rule => { if (rule.selector === ".presentation-rejected-drafts-reader summary") rules.push(rule); });
  assert.equal(rules.length, 1);
  const declarations = new Map(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  assert.equal(f.summaries().length, 6);
  assert.equal(declarations.get("min-block-size"), "var(--forma-control-min-size,44px)");
  assert.equal(declarations.get("min-inline-size"), "var(--forma-control-min-size,44px)");
  assert.ok(declarations.has("padding-block")); assert.ok(declarations.has("padding-inline"));
  assert.equal(declarations.has("white-space"), false); assert.equal(declarations.has("text-overflow"), false);
  assert.equal(declarations.has("animation"), false); assert.equal(declarations.has("transition"), false);
  const forced = []; sheet.walkAtRules("media", media => { if (media.params === "(forced-colors: active)") media.walkRules(rule => {
    if (rule.selector === ".presentation-rejected-drafts-reader summary:focus-visible") forced.push(rule);
  }); });
  assert.equal(forced.length, 1);
  assert.ok(forced[0].nodes.some(node => node.prop === "outline" && node.value === "2px solid Highlight"));
  assert.ok(f.renderer.ownNodes(f.host, "summary").every(node => Object.keys(node.handlers).length === 0), "native details keep their browser keyboard behavior");
  t.diagnostic("Full component output plus parsed production CSS contract; not a browser-computed target-size or accessibility certificate.");
});

test("Video request editor preserves original 480p through the actual review and submit handlers",async t=>{
  const {captureDocumentRenderSettings}=await import("../src/model/document-render-request.ts");
  const f=fixture(t,{facts:[]});f.host.launcherOnly=false;
  const submissions=[],storePort=await videoRequestStorePort(submissions);
  f.store.renderDocumentArtifact=async(...args)=>{f.state.requests.push(args);return storePort._renderDocumentArtifact(...args);};
  const job={jobId:"video-original",documentId:"A",kind:"render_document",status:"failed",sourceSurface:"document",requestedAt:"2026-09-13T00:00:00Z",updatedAt:"2026-09-13T00:00:00Z",requestKey:"original-480p",members:[],attemptCount:1,dismissedAt:null,error:"Invalid input",errorDetail:null,result:{artifactKind:"video",generationReceipt:{input_ref:"video-original-input",reservation_status:"settled",settled_cost_microusd:0}}};
  const captured=captureDocumentRenderSettings({artifactKind:"video",productionMode:"manual",videoSeconds:4,videoSize:"1280x720",videoAudioMode:"silent",videoResolution:"480p",audience:"Original audience"});
  f.store.content.set({"video-original-input":JSON.stringify({job_id:job.jobId,document_id:"A",artifact_kind:"video",request:{editable_settings:captured}})});
  f.store.documentJobs.set([job]);f.store.loadDocumentJobDetail=async id=>{assert.equal(id,job.jobId);return job;};
  f.draw();await f.click("Review & change request");
  assert.equal(f.state.requests.length,0,"review cannot submit or reuse prior paid consent");
  assert.match(f.visible(),/Settings restored/);
  const sessionGet=f.store.session.get;
  let remaining=2_000_000;
  f.store.session.get=()=>{const session=sessionGet();return{...session,provider:{...session.provider,videoModel:"bytedance/seedance-2.0/reference-to-video"},costBudgets:{period:"fixture",currency:"USD",user:{usedMicrousd:0,reservedMicrousd:0,limitMicrousd:remaining,remainingMicrousd:remaining},workspace:{usedMicrousd:0,reservedMicrousd:0,limitMicrousd:10_000_000,remainingMicrousd:10_000_000}}};};
  f.draw();
  assert.match(f.visible(),/Estimated provider render: \$0\.54 at 480p/);
  assert.match(f.visible(),/Total reserved: up to \$2\.21/,"displayed maximum keeps the unchanged conservative server reservation");
  const createButton=()=>f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="button primary");
  assert.ok(createButton()&&Object.hasOwn(createButton().attributes,"disabled"),"$2 cannot fund the server's $2.2096 reservation");
  assert.equal(f.state.requests.length,0);assert.equal(submissions.length,0);
  // Disabled native submit control is verified here. The fixture admission port
  // does not execute the Store/server budget gate; do not bypass it and claim one.
  remaining=2_209_600;await f.flush();
  assert.ok(createButton()&&!Object.hasOwn(createButton().attributes,"disabled"),"the exact existing reservation remains reachable");
  await f.renderer.handler(f.host,"input",node=>node.attributes.name==="audience","input")({target:{value:"Edited audience"}});await f.flush();
  await f.submit();assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0][0],"video");
  assert.equal(f.state.requests[0][1].videoResolution,"480p");assert.equal(f.state.requests[0][1].videoSeconds,4);assert.equal(f.state.requests[0][1].videoAudioMode,"silent");
  assert.equal(submissions.length,1);assert.equal(submissions[0].payload.videoResolution,"480p");assert.equal(submissions[0].payload.audience,"Edited audience");assert.match(submissions[0].payload.requestKey,/:resolution:480p$/);
  assert.equal(await f.host.openRender("video","A",{current:()=>true}),true);await f.flush();await f.submit();
  assert.equal(f.state.requests.length,2);assert.equal(f.state.requests[1][1].videoResolution,undefined,"new opening cannot inherit an older retained-only resolution");
  assert.equal(submissions.length,2);assert.equal(submissions[1].payload.videoResolution,undefined);assert.doesNotMatch(submissions[1].payload.requestKey,/:resolution:/);
});

async function videoRequestStorePort(submissions){
  const {documentRenderGuidance,documentRenderGuidanceProblem}=await import("../src/model/document-render-guidance.ts");
  const {documentGenerationRevision:generationRevisionFor}=await import("../src/model/document-jobs.ts");
  const tree=syntax("src/state/store.ts");const host=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.members.some(member=>member.name?.getText(tree)==="#renderDocumentArtifact"));
  const method=host?.members.find(member=>member.name?.getText(tree)==="#renderDocumentArtifact");assert.ok(method);
  // Keep the complete production Store method; expose private names only to attach
  // the existing storage/context boundary ports. No render branch is substituted.
  const transformed=ts.transform(method,[context=>node=>{const visit=child=>ts.isPrivateIdentifier(child)?ts.factory.createIdentifier("_"+child.text.slice(1)):ts.visitEachChild(child,visit,context);return ts.visitNode(node,visit);}]);
  const memberCode=ts.createPrinter().printNode(ts.EmitHint.Unspecified,transformed.transformed[0],tree);transformed.dispose();
  const code=ts.transpileModule("class VideoRequestStorePort {"+memberCode+"}",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const Port=new Function("generationRevisionFor","documentRenderGuidance","documentRenderGuidanceProblem",code+";return VideoRequestStorePort;")(generationRevisionFor,documentRenderGuidance,documentRenderGuidanceProblem);
  return Object.assign(new Port(),{projection:{get:()=>({documentId:"A"})},_generationContext:()=>({documentRevision:"original-source-revision",documentId:"A",snapshot:{facts:[]}}),_systemNotice:text=>text,toast(){},async _startDocumentJob(kind,payload,surface,documentId){submissions.push({kind,payload,surface,documentId});return{job:{jobId:"local-admission-boundary"},reused:false};}});
}
