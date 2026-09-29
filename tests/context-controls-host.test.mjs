import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { html, noChange, nothing } from "lit";
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import { foldEvents } from "../src/model/events.ts";
import { libraryBlockEditorRoute, libraryFocusRoute } from "../src/model/routes.ts";
import { suggestedSubtype } from "../src/model/block-types.ts";
import { FORMA_CONTEXT_CONTROL_MESSAGES } from "../src/components/design-system/locales/context-controls-messages.ts";
import { localizeTemplateResult } from "../src/components/design-system/localized-template.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import enMessages from "../src/components/design-system/locales/system-en.ts";
import frMessages from "../src/components/design-system/locales/fr.ts";
import arMessages from "../src/components/design-system/locales/ar.ts";
import jaMessages from "../src/components/design-system/locales/ja.ts";
import { isDeepStrictEqual } from "node:util";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import { normalizeOutputRequirementCreation } from "../src/model/output-requirement-creation.ts";

// This runs actual component renderers and handlers with in-memory application,
// template, focus, and modal ports. It is not a browser/AT or viewport certificate.
// Counts include every emitted native element, including closed details.
// The synthetic fourteen-decision shape is not the production study fixture.
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
const interpolate = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const escapeText = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const cell = initial => { let value = initial; return { get: () => value, set: next => { value = next; } }; };
const localeCatalogs = { en: enMessages, fr: frMessages, ar: arMessages, ja: jaMessages };

class ElementPort {
  constructor() { this.store = activeFixture?.store; this.i18n = activeFixture?.i18n; this.fixture = activeFixture; this.isConnected = false; this.parentElement = null; this.tag = ""; }
  get renderRoot() { return this; }
  get ownerDocument() { return documentPort; }
  get updateComplete() { return Promise.resolve(true); }
  requestUpdate() {}
  connectedCallback() {}
  disconnectedCallback() {}
  querySelector(selector) { return this.fixture.renderer.query(this, selector)[0] ?? null; }
  querySelectorAll(selector) { return this.fixture.renderer.query(this, selector); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
  closest(selector) { let owner = this.parentElement; while (owner) { if (owner.tag === selector) return owner; owner = owner.parentElement; } return null; }
  dispatchEvent(event) {
    if (this.eventBindings?.[event.type]) this.eventBindings[event.type].call(this.parentElement, event);
    if (event.type === "library-use-copy") { const parent = this.fixture.renderer.nodes.find(node => node.tag === "div" && node.handlers["library-use-copy"]); parent?.handlers["library-use-copy"]?.call(parent.owner, event); }
    return true;
  }
  focus() { this.fixture.trace.push("focus:" + this.tag); }
}
const documentPort = { activeElement: null, documentElement: { lang: "en" }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null, querySelectorAll: selector => activeFixture?.renderer.query(null, selector) ?? [] };
const windowPort = { requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
documentPort.addEventListener = (...args) => windowPort.addEventListener(...args);
documentPort.removeEventListener = (...args) => windowPort.removeEventListener(...args);
const modalPort = { ensureModalDialog(dialog) { if (dialog) { dialog.open = true; return true; } return false; }, requestDialogText: async () => null };

async function loadActual(relative) {
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const tree = syntax(relative), dependencies = new Map();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === "lit") dependencies.set(specifier, { html, noChange, nothing });
    else if (specifier === "lit/directives/cache.js") dependencies.set(specifier, { cache });
    else if (specifier === "lit/directives/keyed.js") dependencies.set(specifier, { keyed });
    else if (specifier === "lit/directives/repeat.js") dependencies.set(specifier, { repeat });
    else if (specifier === "lit/directives/live.js") dependencies.set(specifier, { live });
    else if (/\/(?:forma-element|presentational-element)$/.test(specifier)) dependencies.set(specifier, { FormaElement: ElementPort, FormaPresentationalElement: ElementPort, icon: () => nothing });
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
  const code = ts.transpileModule(sourceText(relative), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, registry = { get() { return true; }, define() {} };
  const require = specifier => dependencies.get(specifier) ?? {};
  new Function("require", "exports", "customElements", "document", "window", "HTMLElement", "Element", "CSS", "location", "ResizeObserver", "getComputedStyle", "matchMedia", "InputEvent", code)(
    require, exports, registry, documentPort, windowPort, ElementPort, ElementPort, { escape: String }, { origin: "https://fixture.invalid" }, class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" }), () => ({ matches: true }), class InputEvent {},
  );
  moduleCache.set(relative, exports);
  return exports;
}

class RendererPort {
  constructor(fixture, registry) { this.fixture = fixture; this.registry = registry; this.instances = new Map(); this.nodes = []; this.bindings = []; this.activeCaches = new Set(); this.seen = new Set(); this.markup = ""; this.nativeScrollCalls = []; }
  reference(value, owner) { const id = this.bindings.push({ value, owner }) - 1; return "__bound_" + id + "__"; }
  resolve(value) { const exact = value.match(/^__bound_(\d+)__$/); if (exact) return this.bindings[Number(exact[1])]?.value; return value.replace(/__bound_(\d+)__/g, (_, id) => String(this.bindings[Number(id)]?.value ?? "")); }
  attrs(raw) {
    const attributes = {}, properties = {}, handlers = {};
    for (const [, name, double, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = this.resolve(double ?? single ?? bare ?? "");
      if (name[0] === ".") properties[name.slice(1)] = value;
      else if (name[0] === "@") handlers[name.slice(1)] = value;
      else if (name[0] === "?") { if (value) attributes[name.slice(1)] = ""; }
      else attributes[name] = value;
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
      instance.willUpdate?.();
      this.updatingOwner = null;
      // Mirror FormaPresentationalElement's normal wrapper. Directive results
      // intentionally remain opaque: cached source templates must localize first.
      const child = this.value(localizeTemplateResult(instance.render(), instance.i18n), instance, id, caches);
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
      node.focus = () => this.fixture.trace.push("focus:" + (node.attributes.class ?? node.tag));
      node.scrollIntoView = options => this.nativeScrollCalls.push({ node, options: { ...options } });
      node.closest = () => null;
      node.close = () => { if (node.open) { node.open = false; node.handlers.close?.call(owner, { target: node, currentTarget: node }); } };
      this.nodes.push(node);
    }
  }
  draw(host, render = () => host.render()) {
    activeFixture = this.fixture;
    this.previousNodes = this.nodes;
    this.nodes = []; this.bindings = []; this.activeCaches.clear(); this.seen.clear();
    host.isConnected = true; this.updatingOwner = host; host.willUpdate?.(); this.updatingOwner = null;
    this.markup = this.value(localizeTemplateResult(render(), host.i18n), host, "host");
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
    return (this.updatingOwner ? this.previousNodes : this.nodes).filter(node => within(node.owner) && (!selector.startsWith("dialog") || node.tag === "dialog") && (!selector.includes("[open]") || node.open) && (!selector.includes(".") || String(node.attributes.class ?? "").split(/\s+/).includes(selector.match(/\.([\w-]+)/)?.[1])) && (!/^[a-z]/.test(selector) || node.tag === selector.match(/^[\w-]+/)?.[0] || selector.includes(" ")));
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

const componentModules = {
  "forma-ui-rich-text": ["src/components/design-system/forms.ts", "FormaUiRichText"],
  "forma-context-block": ["src/components/context-block.ts", "ContextBlock"],
  "forma-context-intelligence": ["src/components/context-intelligence.ts", "ContextIntelligence"],
  "forma-spatial-scope-editor": ["src/components/spatial-scope-editor.ts", "SpatialScopeEditor"],
  "forma-reference-palette-picker": ["src/components/reference-palette-picker.ts", "ReferencePalettePicker"],
  "forma-reference-image": ["src/components/reference-image.ts", "ReferenceImage"],
  "forma-reference-findings": ["src/components/reference-findings.ts", "ReferenceFindings"],
  "forma-reference-pixel-policy": ["src/components/reference-pixel-policy.ts", "ReferencePixelPolicy"],
  "forma-image-format-editor": ["src/components/image-format-editor.ts", "ImageFormatEditor"],
  "forma-output-input-editor": ["src/components/output-input-editor.ts", "OutputInputEditor"],
  "forma-library-block-editor": ["src/components/library-block-editor.ts", "LibraryBlockEditor"],
};
const registry = Object.fromEntries(await Promise.all(Object.entries(componentModules).map(async ([tag, [file, name]]) => [tag, (await loadActual(file))[name]])));
const { FormaLibrary } = await loadActual("src/components/forma-library.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const workspaceSyntax = syntax("src/components/forma-workspace.ts");
const workspaceClass = workspaceSyntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaWorkspace");
const listMember = workspaceClass.members.find(node => node.name?.getText(workspaceSyntax) === "#contextBlocks").getText(workspaceSyntax);
const ListHost = new Function("ElementPort", "html", "keyed", "repeat", ts.transpileModule("return class extends ElementPort { render(){return this.#contextBlocks(this.store.projection.get().blocks);} " + listMember + "}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(ElementPort, html, keyed, repeat);

// Finite Context Store port: reuse the actual listener set, registration and
// synchronous delivery statement. Planning-consent/network behavior remains
// outside this fixture; full Store ownership tests supply that evidence.
const ContextStorePublication = (() => {
  const tree = syntax("src/state/store.ts"), owner = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
  assert.ok(owner, "actual Store owns the subscription contract");
  const member = name => {
    const matches = owner.members.filter(node => node.name?.getText(tree) === name);
    assert.equal(matches.length, 1, "one actual Store member " + name); return matches[0];
  };
  const notify = member("notify");
  // Current Store encloses this same synchronous delivery in its native-Image
  // transaction. This finite subscription port does not simulate that scope
  // reconciliation; bind its exact one-argument nonasync wrapper before taking
  // the immediate listener statement, never an arbitrary descendant callback.
  assert.equal(notify.body.statements.length, 1, "one current notify wrapper");
  const notificationReturn = notify.body.statements[0];
  assert.ok(ts.isReturnStatement(notificationReturn) && notificationReturn.expression
    && ts.isCallExpression(notificationReturn.expression), "notify returns its current wrapper");
  const notificationCall = notificationReturn.expression;
  assert.equal(notificationCall.expression.getText(tree), "this.#nativeImageMutation");
  assert.equal(notificationCall.arguments.length, 1, "one current mutation callback");
  const notificationWork = notificationCall.arguments[0];
  assert.ok(ts.isArrowFunction(notificationWork) && ts.isBlock(notificationWork.body)
    && notificationWork.parameters.length === 0
    && !notificationWork.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword),
    "current notification callback is a zero-argument synchronous block");
  const delivery = notificationWork.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === "this.#listeners.forEach");
  assert.equal(delivery.length, 1, "one actual synchronous Store listener delivery");
  const code = ts.transpileModule("return class { " + ["#listeners", "subscribe"].map(name => member(name).getText(tree)).join("\n")
    + "\nnotify() { " + delivery[0].getText(tree) + " } }", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(code)();
})();
const contextStorePublications = () => {
  const owner = new ContextStorePublication();
  return { subscribe: owner.subscribe.bind(owner), notify: owner.notify.bind(owner) };
};

function fixture(locale = "en", viewer = false) {
  const types = ["direction", "audience", "message", "format", "exclusion", "subject", "environment", "emotion", "style", "composition", "accessibility", "direction", "direction", "audio"];
  const publications = contextStorePublications();
  const state = new Proxy({ authorization: "author-a", route: "/document/document-a", events: [], requests: [], replies: [], viewer }, {
    set(target, key, value) {
      const changed = !Object.is(target[key], value); target[key] = value;
      if (changed && ["authorization", "route", "viewer", "events"].includes(key)) publications.notify();
      return true;
    },
  });
  const f = { state, locale, trace: [], listeners: new Map() };
  const messages = { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[locale] };
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) { event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 0 }, () => {}); return true; } });
  f.i18n.hostConnected();
  const event = (type, payload) => ({ eventId: "event-" + (state.events.length + 1), streamId: "stream", sequence: state.events.length + 1, actor: "user:owner", correlationId: "fixture", occurredAt: "2026-08-27T00:00:00Z", type, payload });
  const append = input => { const next = event(input.type, input.payload); state.events.push(next); return next; };
  append({ type: "ProjectCreated", payload: { project_id: "project-a", name: "Synthetic context controls" } });
  append({ type: "DocumentCreated", payload: { project_id: "project-a", document_id: "document-a", title: "Fourteen authored decisions" } });
  for (const [index, type] of types.entries()) append({ type: "BlockCreated", payload: { project_id: "project-a", document_id: "document-a", block_id: "decision-" + index, type, handle: type + "/decision-" + index, position: "p" + String(index).padStart(3, "0"), properties: { text: type === "format" ? "Create a four scene film that preserves every authored sentence." : "Authored " + type + " evidence. ".repeat(index === 12 ? 380 : 28), subtype: suggestedSubtype(type), authority: "authored", weight: .7, ...(type === "exclusion" ? { intent: "prohibit" } : {}), ...(type === "message" ? { exact_text: "Keep this exact promise.", protected_phrases: [{ text: "Never shorten this protected phrase." }], exact_placements: ["opening", "closing"] } : {}) } } });
  const projection = () => foldEvents(state.events, Infinity, "document-a", "project-a");
  f.store = {
    ...publications,
    ui: { focusBlockId: "", editingBlockId: "", libraryView: "blocks", libraryOutputScope: "recent", focusCollectionId: "" },
    session: { get: () => ({ user: { userId: "owner", role: "user" }, provider: { configured: true }, capabilities: ["project.read", "project.author", "project.output.request"], ...(state.viewer ? { projectContext: { organizationId: "org", projectAccessId: "access", projectId: "project-a", role: "viewer", permissions: ["project.read"] } } : {}) }) },
    projection: { get: projection }, events: { get: () => state.events }, eventView: { get: () => state.events }, asOf: cell(Infinity), content: cell({}), head: { get: () => state.events.length },
    route: { get: () => state.route }, loading: cell(false), busy: cell(""), organizationContextPackages: cell([]), organizationContextBindings: cell([]), organizationContextVersions: cell({}),
    // The original authored stream is present. No Output read is modeled here.
    routeDataReady: () => !f.store.loading.get() && f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),
    outputRequirements: { resource: () => ({ state: "loading", snapshot: null, error: null }) },
    projectNotifications: cell([]), reviewInbox: cell([]), documentJobs: cell([]), generationReadiness: cell({}), canvasProjection: cell({ selectedCanvasId: "", canvases: [] }),
    captureAuthorizationScope: () => ({ key: state.authorization, shared: state.viewer }), authorizationScopeActive: scope => scope?.key === state.authorization,
    patchUi: patch => { Object.assign(f.store.ui, patch); publications.notify(); }, setRoute: route => { state.route = route; },
    append: async input => { const events = [append(input)]; publications.notify(); return events; },
    appendBatch: async inputs => { const events = inputs.map(append); publications.notify(); return events; },
    removeOutputBlock: async input => { const events = [append(input)]; publications.notify(); return events; },
    outputBlockTextEvents: (id, text, source) => [{ type: "BlockPropertyEdited", payload: { block_id: id, property_path: "text", old_value: projection().libraryBlocks.find(block => block.id === id)?.properties.text, new_value: text, source_surface: source } }],
    documentJobActive: () => false, characterGenerationRequestKey: () => "character", generationRiskAcknowledged: () => false, outputOwnedBlockCount: () => 0,
    refreshEvents: async () => f.trace.push("refresh-events"),
    toast: text => f.trace.push("toast:" + text), copyLibraryBlockSet: async id => { f.trace.push("copy:" + id); return { rootBlockId: "copied", blockCount: 1 }; },
    guardedFetch: async (url, options) => { const body = JSON.parse(options.body); state.requests.push({ url, body }); const reply = state.replies.shift(); assert.ok(reply, "A deterministic response was prepared for " + url); return { ok: reply.ok !== false, json: async () => reply.body ?? reply }; },
  };
  installSourceOwnershipPort(f.store);
  f.renderer = new RendererPort(f, registry);
  activeFixture = f;
  f.host = new ListHost();
  f.draw = () => { publications.notify(); return f.renderer.draw(f.host); };
  f.block = id => f.renderer.component("forma-context-block", id);
  f.select = async id => { const host = f.block(id); await f.renderer.handler(host, "input", node => node.attributes.type === "radio", "change")(); f.draw(); };
  f.toggle = async id => { const host = f.block(id); await f.renderer.handler(host, "button", node => String(node.attributes.class).includes("context-controls-toggle"))(); f.draw(); };
  f.draw();
  return f;
}

test("actual keyed Document context list starts with all authored evidence and no editor buttons or selects", () => {
  const f = fixture();
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(f.renderer.controls("select"), 0);
  assert.equal(f.renderer.controls("input"), 14);
  assert.equal(f.store.ui.focusBlockId, "");
  for (const block of f.store.projection.get().blocks) assert.ok(f.renderer.markup.includes(escapeText(block.properties.text)));
  assert.match(f.renderer.markup, /Never shorten this protected phrase/);
  assert.match(f.renderer.markup, /Unlocked/);
  assert.ok(f.renderer.markup.includes(">Never</span>"));
});

test("selection reveals one Controls action and only the exact selected full renderer", async () => {
  const f = fixture();
  await f.select("decision-0");
  assert.equal(f.renderer.controls("button"), 1); assert.equal(f.renderer.controls("select"), 0);
  await f.toggle("decision-0");
  assert.ok(f.renderer.controls("button") <= 18); assert.equal(f.renderer.controls("select"), 2);
  assert.equal(f.renderer.ownNodes(f.block("decision-0"), "textarea").length, 1, "the selected text editor needs no third navigation choice");
  assert.equal(f.renderer.query(null, "forma-context-intelligence").length, 1);
  assert.equal(f.renderer.query(null, "forma-spatial-scope-editor").length, 1);
  assert.ok(f.renderer.ownNodes(f.block("decision-0"), "details").filter(node => node.attributes.class === "context-composition").every(node => Object.hasOwn(node.attributes, "open")), "existing context actions need no third disclosure");
  assert.equal(f.renderer.component("forma-context-intelligence", "decision-0").block.id, "decision-0");
  assert.ok(f.renderer.ownNodes(f.block("decision-0"), "button").some(node => node.attributes["aria-label"] === "Move block up"));
  await f.select("decision-1");
  assert.equal(f.renderer.controls("button"), 1); assert.equal(f.renderer.controls("select"), 0);
  await f.toggle("decision-1");
  assert.equal(f.renderer.query(null, "forma-context-intelligence").length, 1);
  assert.equal(f.renderer.component("forma-context-intelligence", "decision-1").block.id, "decision-1");
});

test("empty and long manual edits survive close, another decision, reorder, and exact re-entry", async () => {
  for (const draft of ["", "Unfinished authored paragraph.\n".repeat(420)]) {
    const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
    const original = f.block("decision-0"), originalCount = f.state.events.length;
    const textarea = f.renderer.ownNodes(original, "textarea")[0]; assert.ok(textarea);
    await textarea.handlers.input.call(original, { target: { value: draft } }); f.draw();
    await f.toggle("decision-0");
    assert.equal(f.renderer.controls("select"), 0); assert.match(f.renderer.markup, /Unsaved edits retained/);
    await f.select("decision-1"); await f.toggle("decision-1");
    assert.ok(!f.renderer.markup.includes(escapeText("Unfinished authored paragraph.")));
    await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: "decision-0", property_path: "position", old_value: "p000", new_value: "z999" } }); f.draw();
    await f.select("decision-0"); await f.toggle("decision-0");
    assert.equal(f.block("decision-0"), original);
    assert.equal(f.renderer.ownNodes(original, "textarea")[0].value, draft);
    assert.equal(f.state.events.length, originalCount + 1, "closing or switching never saves implicit changes");
  }
});

test("composition-safe Escape closes controls, preserves the draft, and restores the named trigger", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.nativeScrollCalls.length, 0, "opening Controls does not reveal its panel");
  const block = f.block("decision-0"), panel = f.renderer.ownNodes(block, "div").find(node => node.attributes.class === "context-controls-panel");
  const textarea = f.renderer.ownNodes(block, "textarea")[0];
  textarea.handlers.keydown.call(block, { key: "Escape", isComposing: true, preventDefault() { assert.fail("the text editor intercepted composition"); } });
  assert.match(f.renderer.markup, /Esc to close controls/);
  await panel.handlers.keydown.call(block, { key: "Escape", isComposing: true, target: { closest: () => null }, preventDefault() { assert.fail("composition was intercepted"); } }); f.draw();
  assert.equal(f.renderer.controls("select"), 2);
  assert.equal(f.renderer.nativeScrollCalls.length, 0, "composing Escape does not reveal a return target");
  await panel.handlers.keydown.call(block, { key: "Escape", isComposing: false, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} }); f.draw();
  await Promise.resolve();
  assert.equal(f.renderer.controls("select"), 0);
  assert.ok(f.trace.some(entry => entry.includes("context-controls-toggle")));
  assert.equal(f.renderer.nativeScrollCalls.length, 1);
  const reveal = f.renderer.nativeScrollCalls[0];
  assert.equal(reveal.node.tag, "button");
  assert.equal(reveal.node.owner, block);
  assert.ok(String(reveal.node.attributes.class).split(/\s+/).includes("context-controls-toggle"));
  assert.deepEqual(reveal.options, { block: "center", inline: "nearest", behavior: "instant" });
});

test("actual intelligence review retains long proposals and original approval identity across controls detachment", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  f.state.replies.push({ status: "none" }, { quote: { executionId: "original-analysis", bindingHash: "original-approval", status: "quoted", providerAvailable: true } });
  await f.renderer.handler(intelligence, "button", node => !String(node.attributes.class).includes("primary"))(); await new Promise(setImmediate); f.draw();
  f.state.replies.push({ executionId: "original-analysis", bindingHash: "original-approval", billingStatus: "settled", plan: { blockId: "decision-0", source: "Authored evidence", proposals: [{ id: "proposal-1", type: "subject", subtype: "Hero subject", label: "Original proposal", text: "Authored evidence", sourceExcerpt: "Authored evidence", participants: [] }], addenda: [] } });
  await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button primary")(); await new Promise(setImmediate); f.draw();
  const draft = "Keep every unfinished proposal sentence.\n".repeat(250);
  const field = f.renderer.ownNodes(intelligence, "textarea")[0]; assert.ok(field);
  field.handlers.input.call(intelligence, { currentTarget: { value: draft } }); f.draw();
  const requests = f.state.requests.length, approval = f.state.requests.find(request => request.body.action === "execute").body;
  assert.equal(approval.executionId, "original-analysis"); assert.equal(approval.approvedBindingHash, "original-approval");
  const dialog = f.renderer.ownNodes(intelligence, "dialog")[0];
  dialog.handlers.cancel.call(intelligence, { preventDefault() {} }); f.draw();
  assert.match(f.renderer.markup, /Resume decomposition review/);
  await f.select("decision-1");
  assert.equal(intelligence.isConnected, false);
  assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.component("forma-context-intelligence", "decision-0"), intelligence);
  await f.renderer.handler(intelligence, "button", node => !String(node.attributes.class).includes("primary"))(); await new Promise(setImmediate); f.draw();
  assert.equal(f.state.requests.length, requests, "resuming never requotes or repurchases");
  assert.equal(f.renderer.ownNodes(intelligence, "textarea")[0].value, draft);
});

test("authorization withdrawal removes retained authoring and cannot replay private drafts", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const author = f.block("decision-0");
  f.renderer.ownNodes(author, "textarea")[0].handlers.input.call(author, { target: { value: "PRIVATE UNSAVED ACTOR A" } }); f.draw();
  await f.select("decision-1");
  f.state.viewer = true; f.state.authorization = "viewer-b"; f.draw();
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.notEqual(f.block("decision-0"), author);
  assert.doesNotMatch(f.renderer.markup, /PRIVATE UNSAVED ACTOR A/);
  assert.equal(f.renderer.query(null, "forma-context-intelligence").length, 1);
  assertReadOnlyReview(f, f.renderer.query(null, "forma-context-intelligence")[0]);
  assert.equal(f.renderer.controls("select"), 0);
  assert.equal(f.renderer.ownNodes(f.block("decision-0"), "form").length, 0);
});

test("Library retains the existing exact editor and unfinished native fields across selection and close", async () => {
  const f = fixture();
  for (const id of ["decision-0", "decision-1"]) {
    const created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === id);
    created.payload.scope = "library"; delete created.payload.document_id;
  }
  f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  let first = f.renderer.component("forma-library-block-editor", "decision-0");
  assert.ok(first, "the exact route mounts its existing editor");
  const handle = f.renderer.ownNodes(first, "input").find(node => node.attributes.maxlength === "96");
  assert.ok(handle); handle.handlers.input.call(first, { target: { value: "Unfinished original Library handle" } }); f.draw();
  f.state.route = libraryBlockEditorRoute("decision-1"); f.draw();
  assert.equal(first.isConnected, false); assert.equal(first.blockId, "decision-0");
  assert.ok(f.renderer.component("forma-library-block-editor", "decision-1"));
  f.state.route = "/library"; f.draw();
  f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
  assert.equal(f.renderer.component("forma-library-block-editor", "decision-0"), first);
  assert.equal(f.renderer.ownNodes(first, "input").find(node => node.attributes.maxlength === "96").value, "Unfinished original Library handle");
});

for (const locale of ["en", "fr", "ar", "ja"]) test("named selection, controls, and read-only inspection use the " + locale + " catalog", async () => {
  const f = fixture(locale); await f.select("decision-0");
  assert.ok(f.renderer.markup.includes(escapeText(interpolate(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.named"], { name: "\u2068direction/decision-0\u2069" }))));
  f.state.viewer = true; f.state.authorization = "viewer-" + locale; f.draw(); await f.select("decision-0");
  assert.ok(f.renderer.markup.includes(escapeText(interpolate(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.inspect"], { name: "\u2068direction/decision-0\u2069" }))));
});

test("shared controls style retains logical sizing, visible keyboard focus, reduced motion and forced colors", () => {
  const css = sourceText("src/components/context-controls.css");
  assert.match(css, /min-inline-size:44px;min-block-size:44px/);
  assert.match(css, /padding-inline-start/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /forced-colors:active/);
});

test("every synthetic study-shaped decision stays selection-scoped without a count cap or truncated authored text", async t => {
  const rows = [];
  for (let index = 0; index < 14; index++) {
    const f = fixture(); await f.select("decision-" + index); await f.toggle("decision-" + index);
    rows.push({ type: f.block("decision-" + index).block.type, buttons: f.renderer.controls("button"), selects: f.renderer.controls("select") });
    assert.ok(rows.at(-1).buttons <= 18); assert.ok(rows.at(-1).selects <= 3);
  }
  t.diagnostic("In-memory context subtree only: " + JSON.stringify(rows));
  const f = fixture();
  await f.store.appendBatch(Array.from({ length: 86 }, (_, index) => ({ type: "BlockCreated", payload: { project_id: "project-a", document_id: "document-a", block_id: "additional-" + index, type: "direction", handle: "direction/additional-" + index, position: "z" + index, properties: { text: "All additional authored evidence " + index, authority: "authored" } } })));
  f.draw(); assert.equal(f.renderer.controls("input"), 100); assert.equal(f.renderer.controls("button"), 0); assert.equal(f.renderer.controls("select"), 0);
  await f.select("additional-85"); await f.toggle("additional-85");
  assert.ok(f.renderer.controls("button") <= 18); assert.equal(f.renderer.controls("select"), 2);
  assert.equal(f.renderer.ownNodes(f.block("additional-85"), "textarea")[0].value, "All additional authored evidence 85");
});

test("the existing output-input editor instance keeps an unfinished structured draft while detached", async () => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  Object.assign(created.payload.properties, { source_artifact_id: "saved-story", source_artifact_kind: "short_story", label: "Saved story direction", artifact_markdown: "Original complete story.", artifact_summary: "Original summary", artifact_structure: { items: [] } });
  f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  const workbench = f.renderer.component("forma-output-input-editor", "decision-0"); assert.ok(workbench);
  const summary = f.renderer.ownNodes(workbench, "textarea").find(node => node.value === "Original summary"); assert.ok(summary);
  const draft = "Keep the unfinished structured summary.\n".repeat(200);
  summary.handlers.input.call(workbench, { target: { value: draft } }); f.draw();
  await f.toggle("decision-0"); await f.select("decision-1"); await f.toggle("decision-1");
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.component("forma-output-input-editor", "decision-0"), workbench);
  assert.equal(workbench.draft.summary, draft);
  assert.equal(f.renderer.ownNodes(workbench, "textarea").find(node => node.value === draft)?.value, draft);
});

test("exact Library viewer routes contain calm inspection and no disabled authoring or purchase controls", async () => {
  const f = fixture("en", true); f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  const editor = f.renderer.component("forma-library-block-editor", "decision-0"); assert.ok(editor);
  assert.equal(f.renderer.ownNodes(editor, "form").length, 0);
  assert.equal(f.renderer.query(editor, "forma-context-intelligence").length, 0);
  assert.ok(!f.renderer.markup.includes("Save changes"));
  assert.ok(!f.renderer.markup.includes("New block"));
  assert.ok(!f.renderer.markup.includes("Create reusable block"));
  assert.ok(!f.renderer.markup.includes("Fork as reusable block"));
  const inspection = f.renderer.component("forma-context-block", "decision-0");
  assert.equal(inspection.surface, "library");
  const scrollBefore = f.renderer.nativeScrollCalls.length;
  await f.renderer.handler(inspection, "button", node => String(node.attributes.class).includes("context-controls-toggle"))(); f.draw();
  assert.equal(f.renderer.controls("select"), 0);
  assert.equal(f.renderer.ownNodes(inspection, "form").length, 0);
  assert.equal(f.renderer.query(editor, "forma-context-intelligence").length, 1);
  assertReadOnlyReview(f, f.renderer.query(editor, "forma-context-intelligence")[0]);
  await f.renderer.handler(inspection, "button", node => String(node.attributes.class).includes("context-controls-toggle"))(); f.draw();
  await Promise.resolve();
  assert.equal(f.renderer.nativeScrollCalls.length, scrollBefore, "Library open and close retain their focus-only behavior");
});

test("the Library named control retains the original authorized copy executor", async () => {
  const f = fixture(); f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  const editor = f.renderer.component("forma-library-block-editor", "decision-0");
  const use = f.renderer.ownNodes(editor, "button").find(node => node.attributes.class === "button secondary");
  assert.ok(use); use.handlers.click.call(editor, {}); await new Promise(setImmediate);
  assert.deepEqual(f.trace.filter(item => item.startsWith("copy:")), ["copy:decision-0"]);
  f.state.viewer = true;
  use.handlers.click.call(editor, {}); await new Promise(setImmediate);
  assert.deepEqual(f.trace.filter(item => item.startsWith("copy:")), ["copy:decision-0"], "the current Library host rechecks authoring");
});

test("returning to a retained decision does not steal radio focus or reopen its controls until requested", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0"); await f.select("decision-1");
  await f.select("decision-0");
  assert.equal(f.renderer.controls("button"), 1); assert.equal(f.renderer.controls("select"), 0);
  await f.toggle("decision-0");
  assert.equal(f.renderer.controls("select"), 2);
});

test("unchanged actor identity with withdrawn authoring still clears a retained draft", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const block = f.block("decision-0");
  f.renderer.ownNodes(block, "textarea")[0].handlers.input.call(block, { target: { value: "REVOKED DRAFT" } }); f.draw();
  f.state.viewer = true; f.draw();
  assert.ok(!f.renderer.markup.includes("REVOKED DRAFT"));
  assert.equal(f.renderer.controls("select"), 0);
  f.state.viewer = false; f.draw(); await f.toggle("decision-0");
  assert.notEqual(f.renderer.ownNodes(block, "textarea")[0].value, "REVOKED DRAFT");
});

test("the actual spatial editor keeps unsaved geometry through a controls suspension", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const spatial = f.renderer.component("forma-spatial-scope-editor", "decision-0");
  await f.renderer.handler(spatial, "button", node => node.attributes.class === "spatial-scope-trigger")(); f.draw();
  const area = f.renderer.ownNodes(spatial, "input").find(node => node.attributes.placeholder === "e.g. the quiet space behind the subject"); assert.ok(area);
  const draft = "Unfinished geometry: the quiet space behind the hero.";
  area.handlers.input.call(spatial, { target: { value: draft } }); f.draw();
  await f.select("decision-1");
  assert.equal(spatial.isConnected, false);
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.component("forma-spatial-scope-editor", "decision-0"), spatial);
  assert.equal(f.renderer.ownNodes(spatial, "dialog").length, 0);
  await f.renderer.handler(spatial, "button", node => node.attributes.class === "spatial-scope-trigger")(); f.draw();
  assert.ok(f.renderer.ownNodes(spatial, "input").some(node => node.value === draft));
});

test("owned intelligence dialogs are suspended before their component is detached", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"), calls = [], suspend = intelligence.suspendControls.bind(intelligence);
  intelligence.suspendControls = () => { calls.push(intelligence.isConnected ? "before-detach" : "after-detach"); suspend(); };
  await f.select("decision-1");
  assert.equal(calls[0], "before-detach");
  assert.ok(calls.includes("after-detach"));
});

test("the palette picker keeps chosen colors but emits no dormant dialog buttons after re-entry", async () => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  created.payload.type = "reference";
  Object.assign(created.payload.properties, { label: "Private palette reference", colors: ["#123456", "#abcdef"], media_url: "/api/media/palette-reference", media_type: "image/png", reference_id: "palette-reference" });
  f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  const block = f.block("decision-0"), explore = () => f.renderer.handler(block, "button", node => String(node.attributes.class) === "button secondary compact");
  await explore()(); f.draw(); await new Promise(setImmediate);
  const picker = f.renderer.component("forma-reference-palette-picker", undefined); assert.ok(picker);
  const choices = f.renderer.ownNodes(picker, "button").filter(node => Object.hasOwn(node.attributes, "aria-pressed"));
  assert.equal(choices.length, 5); choices[1].handlers.click.call(picker, {}); f.draw();
  const selectedColors = f.renderer.ownNodes(picker, "i").map(node => node.attributes.style);
  await f.select("decision-1"); await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.component("forma-reference-palette-picker", undefined), picker);
  assert.equal(f.renderer.ownNodes(picker, "button").length, 0);
  await explore()(); f.draw(); await new Promise(setImmediate);
  assert.deepEqual(f.renderer.ownNodes(picker, "i").map(node => node.attributes.style), selectedColors);
  assert.equal(f.renderer.ownNodes(picker, "button").filter(node => node.attributes["aria-pressed"] === true).length, 1);
});

test("generated public manifests publish the retained editor properties and modal suspension methods", () => {
  const first = JSON.parse(sourceText("custom-elements.json")), second = JSON.parse(sourceText("public/custom-elements.json"));
  for (const path of ["src/components/context-block.ts", "src/components/context-intelligence.ts", "src/components/library-block-editor.ts", "src/components/reference-palette-picker.ts", "src/components/spatial-scope-editor.ts"]) {
    const a = first.modules.find(module => module.path === path), b = second.modules.find(module => module.path === path);
    assert.deepEqual(a, b);
    const members = a.declarations[0].members.map(member => member.name);
    if (path.endsWith("/context-intelligence.ts")) assert.ok(members.includes("readOnly"));
    if (path.endsWith("/context-block.ts")) assert.ok(members.includes("readOnly"));
    else assert.ok(members.includes("suspendControls"));
    if (path.endsWith("/library-block-editor.ts")) {
      assert.ok(members.includes("blockId"));
      assert.ok(a.declarations[0].events.some(event => event.name === "library-use-copy"));
    }
  }
});

test("lazily mounted classifiers select the authored intent and subtype on their first render", async () => {
  for (const intent of ["include", "prefer", "avoid", "prohibit"]) {
    const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
    created.payload.properties.intent = intent;
    created.payload.properties.subtype = "Persisted authored subtype";
    f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
    const options = f.renderer.ownNodes(f.block("decision-0"), "option").filter(node => Object.hasOwn(node.attributes, "selected")).map(node => node.attributes.value);
    assert.deepEqual(options, ["Persisted authored subtype", intent]);
    assert.equal(f.state.events.length, 16, "initial selection does not rewrite the saved intent");
  }
});

test("untouched text controls refresh saved changes while an edited draft remains intact", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const block = f.block("decision-0");
  assert.ok(!f.renderer.markup.includes("Unsaved edits retained"));
  await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: "decision-0", property_path: "text", old_value: block.block.properties.text, new_value: "A collaborator saved this wording." } }); f.draw();
  assert.equal(f.renderer.ownNodes(block, "textarea")[0].value, "A collaborator saved this wording.");
  f.renderer.ownNodes(block, "textarea")[0].handlers.input.call(block, { target: { value: "My unfinished correction." } }); f.draw();
  await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: "decision-0", property_path: "text", old_value: "A collaborator saved this wording.", new_value: "Another saved revision." } }); f.draw();
  assert.equal(f.renderer.ownNodes(block, "textarea")[0].value, "My unfinished correction.");
});


test("Library closes its preview before detaching the gallery for the exact editor", () => {
  const f = fixture(); f.state.route = libraryFocusRoute("block", "decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  const preview = f.renderer.ownNodes(f.host, "dialog").find(node => String(node.attributes.class).includes("library-focus-dialog"));
  assert.ok(preview?.open, "the existing native-modal port opens the actual preview");
  const events = f.state.events.length;
  f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
  assert.equal(preview.open, false, "willUpdate explicitly closes the owned modal before caching its branch");
  assert.ok(f.renderer.component("forma-library-block-editor", "decision-0"));
  f.state.route = "/library"; f.draw();
  assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  assert.equal(f.state.events.length, events);
});

test("Library dismisses owned removal confirmation but retains manual fields when controls close", async t => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  created.payload.scope = "library"; delete created.payload.document_id;
  f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  await cContextLibraryNavigationParent(t, f);
  const editor = f.renderer.component("forma-library-block-editor", "decision-0");
  f.renderer.ownNodes(editor, "input").find(node => node.attributes.maxlength === "96").handlers.input.call(editor, { target: { value: "Retain the independent draft" } }); f.draw();
  await f.renderer.handler(editor, "button", node => node.attributes.class === "button danger")(); f.draw();
  const modal = f.renderer.ownNodes(editor, "dialog")[0]; assert.ok(modal?.open);
  const events = f.state.events.length, route = f.state.route, requests = [...f.state.requests];
  // This direct header-handler attempt is deliberately denied while its
  // destructive modal owns interaction; it is not a native click through it.
  assert.equal(await f.renderer.handler(editor, "button", node => node.attributes.class === "button ghost")(), false);
  assert.equal(f.state.route, route); assert.ok(editor.isConnected && modal.open);
  assert.equal(f.renderer.ownNodes(editor, "input").find(node => node.attributes.maxlength === "96").value, "Retain the independent draft");
  assert.equal(f.state.events.length, events); assert.deepEqual(f.state.requests, requests);
  const cancelName = f.i18n.t("projects.editorCancelRemoval", "Cancel removal");
  const cancel = f.renderer.ownNodes(editor, "button").filter(node => node.attributes["aria-label"] === cancelName);
  assert.equal(cancel.length, 1, "Use the current emitted removal dialog's own Cancel control");
  await cancel[0].handlers.click.call(editor, { target: cancel[0], currentTarget: cancel[0], preventDefault() {}, stopPropagation() {} }); f.draw();
  assert.equal(f.state.route, route); assert.ok(editor.isConnected);
  assert.equal(f.renderer.ownNodes(editor, "dialog").length, 0);
  assert.equal(modal.isConnected, false, "The actual committed tree removed the cancelled dialog; no open setter is fabricated");
  // The prior modal's detached open attribute is not a visible-dialog oracle.
  // A fresh header Back now uses the original local retention admission.
  await f.renderer.handler(editor, "button", node => node.attributes.class === "button ghost")(); f.draw();
  assert.equal(f.state.route, "/library");
  assert.equal(editor.isConnected, false);
  f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
  assert.equal(f.renderer.component("forma-library-block-editor", "decision-0"), editor);
  assert.equal(f.renderer.ownNodes(editor, "dialog").length, 0, "re-entry never reopens a stale destructive confirmation");
  assert.equal(f.renderer.ownNodes(editor, "input").find(node => node.attributes.maxlength === "96").value, "Retain the independent draft");
  assert.equal(f.state.events.length, events, "dismissal cannot remove or save a block");
  assert.deepEqual(f.state.requests, requests);
});

test("suspending while the initial review lookup is pending finishes guarded recovery without a second quote", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"), normalFetch = f.store.guardedFetch;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.store.guardedFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === "resume") { f.state.requests.push({ url, body }); await pending; return { ok: true, json: async () => ({ status: "none" }) }; }
    return normalFetch(url, options);
  };
  f.state.replies.push({ quote: { executionId: "original-pending-quote", bindingHash: "original-pending-binding", status: "quoted", providerAvailable: true } });
  await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button ghost compact")(); f.draw();
  const dialog = f.renderer.ownNodes(intelligence, "dialog")[0]; assert.ok(dialog?.open);
  dialog.handlers.cancel.call(intelligence, { preventDefault() {} }); f.draw();
  await f.select("decision-1");
  release(); await new Promise(setImmediate); f.draw();
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume", "quote"]);
  await f.select("decision-0"); await f.toggle("decision-0");
  await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button ghost compact")(); f.draw();
  assert.equal(f.state.requests.length, 2, "re-entry resumes the existing quote rather than beginning another request");
  assert.ok(f.renderer.ownNodes(intelligence, "button").some(node => node.attributes.class === "button primary" && !Object.hasOwn(node.attributes, "disabled")));
  assert.equal(f.renderer.ownNodes(intelligence, "dialog").length, 1);
});


test("retained Library editors refresh untouched fields but never replace a manual draft", async () => {
  for (const dirty of [false, true]) {
    const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
    created.payload.scope = "library"; delete created.payload.document_id;
    f.state.route = libraryBlockEditorRoute("decision-0");
    activeFixture = f; f.host = new FormaLibrary(); f.draw();
    const editor = f.renderer.component("forma-library-block-editor", "decision-0"), input = () => f.renderer.ownNodes(editor, "input").find(node => node.attributes.maxlength === "96");
    if (dirty) { input().handlers.input.call(editor, { target: { value: "Keep my unfinished handle" } }); f.draw(); }
    f.state.route = "/library"; f.draw();
    await f.store.append({ type: "BlockRenamed", payload: { block_id: "decision-0", old_handle: "direction/decision-0", new_handle: "Saved collaborator handle", reason: "fixture" } }); f.draw();
    f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
    assert.equal(f.renderer.component("forma-library-block-editor", "decision-0"), editor);
    assert.equal(input().value, dirty ? "Keep my unfinished handle" : "Saved collaborator handle");
  }
});

test("a removed Library target cannot become a new-block form or save a retained draft as another block", async () => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  created.payload.scope = "library"; delete created.payload.document_id;
  f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  const editor = f.renderer.component("forma-library-block-editor", "decision-0");
  const form = f.renderer.ownNodes(editor, "form").find(node => String(node.attributes.class).includes("library-block-form"));
  await f.store.append({ type: "BlockRemoved", payload: { block_id: "decision-0", scope: "library", reason: "fixture" } }); f.draw();
  assert.equal(f.state.route, libraryBlockEditorRoute("decision-0"), "the missing target stays exact rather than silently becoming a new form");
  assert.equal(f.renderer.ownNodes(editor, "form").length, 0);
  assert.match(f.renderer.markup, /That saved decision is no longer available/);
  const events = f.state.events.length;
  await form.handlers.submit.call(editor, { preventDefault() {} }); f.draw();
  assert.equal(f.state.events.length, events);
});


test("withdrawn authoring during a suspended recovery cannot begin a quote under the new role", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.store.guardedFetch = async (url, options) => {
    const body = JSON.parse(options.body); f.state.requests.push({ url, body });
    assert.equal(body.action, "resume", "no quote or execution is authorized after role withdrawal");
    await pending; return { ok: true, json: async () => ({ status: "none" }) };
  };
  await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button ghost compact")(); f.draw();
  f.renderer.ownNodes(intelligence, "dialog")[0].handlers.cancel.call(intelligence, { preventDefault() {} }); f.draw();
  await f.select("decision-1"); f.state.viewer = true; f.draw();
  release(); await new Promise(setImmediate); f.draw();
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.query(null, "forma-context-intelligence").length, 1);
  assertReadOnlyReview(f, f.renderer.query(null, "forma-context-intelligence")[0]);
});

test("all character fields remain directly available in the selected full editor", async () => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-5");
  Object.assign(created.payload.properties, { character_context: true, subtype: "Character sheet" });
  f.draw(); await f.select("decision-5"); await f.toggle("decision-5");
  const sections = f.renderer.ownNodes(f.block("decision-5"), "details").filter(node => node.attributes.class === "character-context-section");
  assert.ok(sections.length >= 4);
  assert.ok(sections.every(node => Object.hasOwn(node.attributes, "open")), "character settings cannot add a third navigation disclosure");
});


for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Document cache emits real " + locale + " classifier labels and retains manual and approved-analysis drafts", async () => {
    const f = fixture(locale), startEvents = f.state.events.length;
    for (const block of f.store.projection.get().blocks) assert.ok(f.renderer.markup.includes(escapeText(block.properties.text)));
    assert.ok(f.renderer.markup.includes("Never shorten this protected phrase."));
    await f.select("decision-0"); await f.toggle("decision-0");
    const block = f.block("decision-0"), intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
    const verifyLabels = () => {
      for (const source of ["Kind", "Use as", "Why?"]) {
        const translated = localeCatalogs[locale][formaSystemMessageId(source)];
        assert.ok(translated, "real catalog provides " + source);
        assert.ok(block.markup.includes(">" + translated + "</span>"), "cached full editor translates static " + source);
      }
    };
    verifyLabels();
    for (const draft of ["", "Save · Kind · Use as · exact authored copy.\n".repeat(180)]) {
      f.renderer.ownNodes(block, "textarea")[0].handlers.input.call(block, { target: { value: draft } }); f.draw();
      await f.toggle("decision-0"); await f.select("decision-1"); await f.toggle("decision-1");
      await f.select("decision-0"); await f.toggle("decision-0");
      assert.equal(f.block("decision-0"), block);
      assert.equal(f.renderer.component("forma-context-intelligence", "decision-0"), intelligence);
      assert.equal(f.renderer.ownNodes(block, "textarea")[0].value, draft);
      verifyLabels();
    }

    f.state.replies.push({ status: "none" }, { quote: { executionId: "exact-" + locale, bindingHash: "binding-" + locale, status: "quoted", providerAvailable: true } });
    await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button ghost compact")(); await new Promise(setImmediate); f.draw();
    f.state.replies.push({ executionId: "exact-" + locale, bindingHash: "binding-" + locale, billingStatus: "settled", plan: { blockId: "decision-0", source: "Authored evidence", proposals: [{ id: "proposal-1", type: "subject", subtype: "Hero subject", label: "Original proposal", text: "Original proposal evidence", sourceExcerpt: "Authored evidence", participants: [] }], addenda: [] } });
    await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button primary")(); await new Promise(setImmediate); f.draw();
    const proposal = "Keep this exact, unfinished proposal.\n".repeat(180);
    f.renderer.ownNodes(intelligence, "textarea")[0].handlers.input.call(intelligence, { currentTarget: { value: proposal } }); f.draw();
    const requests = f.state.requests.length;
    const approval = f.state.requests.find(request => request.body.action === "execute").body;
    assert.equal(approval.executionId, "exact-" + locale); assert.equal(approval.approvedBindingHash, "binding-" + locale);
    f.renderer.ownNodes(intelligence, "dialog")[0].handlers.cancel.call(intelligence, { preventDefault() {} }); f.draw();
    await f.select("decision-1"); await f.select("decision-0"); await f.toggle("decision-0");
    assert.equal(f.renderer.component("forma-context-intelligence", "decision-0"), intelligence);
    await f.renderer.handler(intelligence, "button", node => node.attributes.class === "button ghost compact")(); await new Promise(setImmediate); f.draw();
    assert.equal(f.renderer.ownNodes(intelligence, "textarea")[0].value, proposal);
    assert.equal(f.state.requests.length, requests, "localized re-entry never requotes or replaces the approved analysis");
    assert.equal(f.state.events.length, startEvents, "presentation never commits a draft");
    verifyLabels();
  });

  test("Library keyed cache localizes " + locale + " gallery copy and preserves exact editor drafts and read-only inspection", async t => {
    const f = fixture(locale);
    for (const id of ["decision-0", "decision-1"]) {
      const created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === id);
      created.payload.scope = "library"; delete created.payload.document_id;
    }
    const evidence = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0").payload.properties;
    evidence.exact_text = "Kind — this customer promise must stay exact.";
    const events = f.state.events.length;
    f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw();
    await cContextLibraryNavigationParent(t, f);
    const galleryLabel = localeCatalogs[locale][formaSystemMessageId("Portable context")];
    const verifyGallery = () => {
      assert.ok(galleryLabel);
      assert.ok(f.renderer.markup.includes('<span class="eyebrow">' + galleryLabel + "</span>"), "static gallery copy localizes inside keyed/cache");
      assert.ok(f.renderer.markup.includes(escapeText(evidence.text)));
    };
    verifyGallery();
    await f.renderer.handler(f.host, "button", node => node.attributes["data-context-controls-id"] === "decision-0")(); f.draw();
    const editor = f.renderer.component("forma-library-block-editor", "decision-0");
    assert.ok(editor?.isConnected);
    const handle = () => f.renderer.ownNodes(editor, "input").find(node => node.attributes.maxlength === "96");
    handle().handlers.input.call(editor, { target: { value: "Unfinished exact Library handle" } }); f.draw();
    const richText = f.renderer.query(editor, "forma-ui-rich-text").find(child => child.attributes.class === "block-editor-copy");
    assert.ok(richText);
    const draft = "Kind · Save · keep every unfinished Library sentence.\n".repeat(180);
    richText.dispatchEvent(new CustomEvent("forma-input", { detail: { value: draft } })); f.draw();
    f.state.route = libraryBlockEditorRoute("decision-1"); f.draw();
    assert.equal(editor.isConnected, false);
    f.state.route = "/library"; f.draw(); verifyGallery();
    f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
    assert.equal(f.renderer.component("forma-library-block-editor", "decision-0"), editor);
    assert.equal(handle().value, "Unfinished exact Library handle");
    assert.equal(f.renderer.query(editor, "forma-ui-rich-text").find(child => child.attributes.class === "block-editor-copy"), richText);
    assert.equal(richText.value, draft);
    assert.equal(f.renderer.ownNodes(richText, "textarea")[0].value, draft);

    f.state.viewer = true; f.state.authorization = "viewer-" + locale; f.draw();
    const inspectionEditor = f.renderer.component("forma-library-block-editor", "decision-0");
    assert.notEqual(inspectionEditor, editor);
    assert.equal(f.renderer.ownNodes(inspectionEditor, "form").length, 0);
    assert.equal(f.renderer.query(inspectionEditor, "forma-context-intelligence").length, 0);
    assert.ok(!f.renderer.markup.includes(escapeText(draft)));
    assert.ok(f.renderer.markup.includes(escapeText(evidence.text)));
    assert.ok(f.renderer.markup.includes(escapeText(evidence.exact_text)));
    const inspection = f.renderer.component("forma-context-block", "decision-0");
    assert.ok(inspection.markup.includes(escapeText(interpolate(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.inspect"], { name: "\u2068direction/decision-0\u2069" }))));
    await f.renderer.handler(inspection, "button", node => String(node.attributes.class).includes("context-controls-toggle"))(); f.draw();
    assert.equal(f.renderer.controls("select"), 0);
    assert.equal(f.renderer.query(inspectionEditor, "forma-context-intelligence").length, 1);
    assertReadOnlyReview(f, f.renderer.query(inspectionEditor, "forma-context-intelligence")[0]);
    const why = localeCatalogs[locale][formaSystemMessageId("Why?")];
    assert.ok(inspection.markup.includes(">" + why + "</button>"), "read-only full inspection has its localized evidence action");
    assert.ok(f.renderer.markup.includes(escapeText(evidence.exact_text)));
    assert.equal(f.state.events.length, events);
    assert.equal(f.state.requests.length, 0);
  });

  test("nested palette cache localizes " + locale + " static labels without resetting the chosen colors", async () => {
    const f = fixture(locale), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
    created.payload.type = "reference";
    Object.assign(created.payload.properties, { label: "Your samples — authored reference title", colors: ["#123456", "#abcdef"], media_url: "/api/media/palette-reference", media_type: "image/png", reference_id: "palette-reference" });
    f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
    const block = f.block("decision-0"), explore = () => f.renderer.handler(block, "button", node => node.attributes.class === "button secondary compact");
    await explore()(); f.draw(); await new Promise(setImmediate);
    const picker = f.renderer.component("forma-reference-palette-picker", undefined);
    const verify = () => {
      for (const source of ["Reference-derived palette", "Your samples"]) {
        const translated = localeCatalogs[locale][formaSystemMessageId(source)];
        assert.ok(translated); assert.ok(picker.markup.includes(">" + translated + "</"), "nested cached dialog translates " + source);
      }
      assert.ok(picker.markup.includes("Your samples — authored reference title"), "authored title is never translated");
      assert.ok(f.renderer.ownNodes(picker, "button").some(node => node.attributes["aria-label"] === localeCatalogs[locale][formaSystemMessageId("Close palette picker")]));
    };
    verify();
    f.renderer.ownNodes(picker, "button").filter(node => Object.hasOwn(node.attributes, "aria-pressed"))[1].handlers.click.call(picker, {}); f.draw();
    const colors = f.renderer.ownNodes(picker, "i").map(node => node.attributes.style);
    await f.select("decision-1"); await f.select("decision-0"); await f.toggle("decision-0");
    assert.equal(f.renderer.component("forma-reference-palette-picker", undefined), picker);
    assert.equal(f.renderer.ownNodes(picker, "button").length, 0);
    await explore()(); f.draw(); await new Promise(setImmediate); verify();
    assert.deepEqual(f.renderer.ownNodes(picker, "i").map(node => node.attributes.style), colors);
    assert.equal(f.renderer.ownNodes(picker, "button").filter(node => node.attributes["aria-pressed"] === true).length, 1);
    assert.equal(f.state.events.length, 16);
    assert.equal(f.state.requests.length, 0);
  });
}


function assertReadOnlyReview(f, intelligence) {
  assert.ok(intelligence, "the exact selected decision has a retained-review component");
  for (const tag of ["input", "select", "textarea", "form"]) assert.equal(f.renderer.ownNodes(intelligence, tag).length, 0, "read inspection emits no " + tag);
  assert.equal(f.renderer.ownNodes(intelligence, "button").filter(node => node.attributes["data-context-review-action"] === "inspect").length, 1, "one free retained-review entry");
  assert.ok(!f.renderer.ownNodes(intelligence, "button").some(node => ["preview", "apply"].includes(node.attributes["data-context-review-action"])));
  assert.equal(f.renderer.ownNodes(intelligence, "section").filter(node => node.attributes.class === "context-consent").length, 0);
  assert.ok(!intelligence.markup.includes(escapeText(f.i18n.t("context.changes.atomic"))), "reader inspection has no Apply guidance");
}
function savedContextReview(blockId = "decision-0", options = {}) {
  const executionId = "original-execution-" + blockId, proposalId = "original-proposal", key = executionId + ":" + proposalId;
  const decomposition = { id: proposalId, type: "action", subtype: "Movement", label: "Retained exact proposal", text: options.text ?? "Previously reviewed wording.\n".repeat(120), sourceExcerpt: "Original source excerpt.", participants: [{ handle: "@saved-person", role: "actor" }] };
  const research = { id: proposalId, type: "subject", subtype: "Hero subject", label: "Retained research", text: "Exact retained research recommendation", reason: "Existing scoped evidence", area: "inferred", blockId: "decision-1" };
  return { previewId: "original-preview-" + blockId, approvalHash: "a".repeat(64), sourceHash: "original-source-hash", projectId: "project-a", documentId: "document-a", canvasId: null, blockId, blockCount: 1, relationCount: 0, expiresAt: "2026-08-28T12:00:00Z", changes: [{ kind: "create", label: decomposition.label, type: decomposition.type, text: decomposition.text }], events: [{ type: "BlockCreated", payload: { block_id: "review-created-" + blockId, type: decomposition.type, properties: { text: decomposition.text } } }], review: { sourceText: "Previously approved private source evidence.", proposals: [{ key, executionId, proposalId, ...(options.research ? { research } : { decomposition }) }], selections: [{ executionId, bindingHash: "b".repeat(64), proposalId }] } };
}
async function inspectSavedReview(f, intelligence) {
  await f.renderer.handler(intelligence, "button", node => node.attributes["data-context-review-action"] === "inspect")();
  await new Promise(setImmediate); f.draw();
}
function personalPermissions(f, permissions) {
  const before = f.store.session.get();
  f.state.viewer = false;
  f.store.session.get = () => { const session = { ...before, capabilities: permissions }; delete session.projectContext; return session; };
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["document", "library"]) test("current reader uses one localized " + locale + " retained-review entry through the actual " + surface + " cache", async () => {
  const f = fixture(locale, true);
  if (surface === "library") { f.state.route = libraryBlockEditorRoute("decision-0"); activeFixture = f; f.host = new FormaLibrary(); f.draw(); }
  else await f.select("decision-0");
  await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  assertReadOnlyReview(f, intelligence); assert.equal(f.state.requests.length, 0);
  assert.ok(intelligence.markup.includes(escapeText(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.inspectReview"])));
  const preview = savedContextReview("decision-0", { research: surface === "library" });
  f.state.replies.push({ status: "not-applied", preview, stale: true });
  await inspectSavedReview(f, intelligence);
  assertReadOnlyReview(f, intelligence);
  assert.ok(intelligence.markup.includes(escapeText(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.savedReview"])));
  assert.ok(intelligence.markup.includes(escapeText(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.reviewReadOnly"])));
  assert.ok(intelligence.markup.includes(escapeText(preview.review.sourceText)));
  if (surface === "document") { assert.ok(intelligence.markup.includes(escapeText(preview.review.proposals[0].decomposition.text))); assert.ok(intelligence.markup.includes("@saved-person")); }
  else assert.ok(intelligence.markup.includes("Exact retained research recommendation"));
  assert.deepEqual(f.state.requests.map(request => [request.url, request.body.action, request.body.blockId]), [["/api/context/apply", "resume", "decision-0"]]);
  const dialog = f.renderer.ownNodes(intelligence, "dialog")[0]; assert.ok(dialog.open);
  dialog.handlers.cancel.call(intelligence, { preventDefault() {} }); f.draw();
  assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  if (surface === "library") { f.state.route = "/library"; f.draw(); f.state.route = libraryBlockEditorRoute("decision-0"); f.draw(); }
  else { await f.select("decision-1"); await f.select("decision-0"); }
  const trigger = f.renderer.ownNodes(f.block("decision-0"), "button").find(node => String(node.attributes.class).includes("context-controls-toggle"));
  if (!trigger.attributes["aria-expanded"] || trigger.attributes["aria-expanded"] === "false") await f.toggle("decision-0");
  assert.equal(f.renderer.component("forma-context-intelligence", "decision-0"), intelligence);
  await inspectSavedReview(f, intelligence);
  assert.equal(f.state.requests.length, 1, "unchanged-authority re-entry keeps the exact retained review without rediscovery");
  assertReadOnlyReview(f, intelligence);
});

test("a personal project.read-only session has inspection, never Document or Library authoring", async () => {
  const f = fixture(); personalPermissions(f, ["project.read"]); f.state.authorization = "personal-reader"; f.draw();
  await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.ownNodes(f.block("decision-0"), "textarea").length, 0); assert.equal(f.renderer.controls("select"), 0);
  assertReadOnlyReview(f, f.renderer.component("forma-context-intelligence", "decision-0"));
  f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw();
  assert.ok(!f.renderer.markup.includes("New reusable block")); assert.ok(!f.renderer.markup.includes("Import as document"));
  f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
  const editor = f.renderer.component("forma-library-block-editor", "decision-0");
  assert.equal(f.renderer.ownNodes(editor, "form").length, 0);
  await f.toggle("decision-0"); assertReadOnlyReview(f, f.renderer.component("forma-context-intelligence", "decision-0"));
  assert.ok(!f.renderer.markup.includes("Fork as reusable block")); assert.equal(f.state.requests.length, 0);
});

for (const capabilities of [[], ["project.author"], undefined]) test("personal permissions fail closed without project.read: " + JSON.stringify(capabilities), async () => {
  const f = fixture(); personalPermissions(f, capabilities); f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  assert.equal(f.renderer.controls("select"), 0); assert.equal(f.renderer.ownNodes(f.block("decision-0"), "textarea").length, 0);
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  assert.ok(intelligence); assert.equal(f.renderer.ownNodes(intelligence, "button").length, 0); assert.equal(f.state.requests.length, 0);
});

test("an author downgraded to reader scrubs cached private edits and resumes a fresh exact review plus its save receipt", async () => {
  const f = fixture(); await f.select("decision-0"); await f.toggle("decision-0");
  const original = f.renderer.component("forma-context-intelligence", "decision-0"), preview = savedContextReview();
  f.state.replies.push({ status: "not-applied", preview });
  await f.renderer.handler(original, "button", node => node.attributes.class === "button ghost compact")(); await new Promise(setImmediate); f.draw();
  f.renderer.ownNodes(original, "textarea")[0].handlers.input.call(original, { currentTarget: { value: "PRIVATE LOCAL EDIT BEFORE DOWNGRADE" } }); f.draw();
  assert.equal(f.renderer.ownNodes(original, "textarea")[0].value, "PRIVATE LOCAL EDIT BEFORE DOWNGRADE");
  const staleApply = f.renderer.ownNodes(original, "button").find(node => node.attributes["data-context-review-action"] === "preview").handlers.click;
  f.state.viewer = true; f.state.authorization = "same-actor-new-reader-epoch"; f.draw();
  assert.ok(!f.renderer.markup.includes("PRIVATE LOCAL EDIT BEFORE DOWNGRADE")); assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  await staleApply.call(original, {}); await new Promise(setImmediate); assert.equal(f.state.requests.length, 1);
  await f.toggle("decision-0");
  const reader = f.renderer.component("forma-context-intelligence", "decision-0"); assert.notEqual(reader, original);
  assertReadOnlyReview(f, reader);
  f.state.replies.push({ status: "applying", preview }); await inspectSavedReview(f, reader);
  assertReadOnlyReview(f, reader); assert.ok(!reader.markup.includes("PRIVATE LOCAL EDIT BEFORE DOWNGRADE"));
  f.state.replies.push({ status: "applied", preview });
  await f.renderer.handler(reader, "button", node => node.attributes["data-context-review-action"] === "retrieve")(); await new Promise(setImmediate); f.draw();
  const retrieve = f.state.requests.at(-1);
  assert.equal(retrieve.url, "/api/context/apply"); assert.equal(retrieve.body.action, "retrieve");
  assert.equal(retrieve.body.previewId, preview.previewId); assert.equal(retrieve.body.approvalHash, preview.approvalHash); assert.equal(retrieve.body.blockId, "decision-0");
  assertReadOnlyReview(f, reader); assert.ok(f.trace.includes("refresh-events"));
  assert.ok(reader.markup.includes(escapeText(f.i18n.t("context.changes.appliedHint"))), "reader recovery retains the completed receipt hint");
  f.state.replies.push({ status: "dismissed" });
  await f.renderer.handler(reader, "button", node => node.attributes["data-context-review-action"] === "dismiss")(); await new Promise(setImmediate); f.draw();
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume", "resume", "retrieve", "dismiss"]);
  assert.equal(f.state.requests.at(-1).body.previewId, preview.previewId);
  assert.equal(f.state.requests.at(-1).body.approvalHash, preview.approvalHash);
  assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
});

test("reader missing-review lookup never becomes a quote, including another decision and a reopened empty review", async () => {
  const f = fixture("en", true); await f.select("decision-0"); await f.toggle("decision-0");
  let intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  for (let index = 0; index < 2; index++) {
    f.state.replies.push({ status: "none" }); await inspectSavedReview(f, intelligence);
    assertReadOnlyReview(f, intelligence); assert.ok(intelligence.markup.includes(FORMA_CONTEXT_CONTROL_MESSAGES.en["context.controls.noReview"]));
    intelligence.suspendControls(); f.draw();
  }
  await f.select("decision-8"); await f.toggle("decision-8");
  intelligence = f.renderer.component("forma-context-intelligence", "decision-8"); f.state.replies.push({ status: "none" }); await inspectSavedReview(f, intelligence);
  assert.deepEqual(f.state.requests.map(request => [request.body.action, request.body.blockId]), [["resume", "decision-0"], ["resume", "decision-0"], ["resume", "decision-8"]]);
  assert.ok(f.state.requests.every(request => request.url === "/api/context/apply"));
});

test("read authority withdrawn during recovery rejects delayed private results and stale controls", async () => {
  const f = fixture("en", true); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  let release; const pending = new Promise(resolve => { release = resolve; });
  f.store.guardedFetch = async (url, options) => { f.state.requests.push({ url, body: JSON.parse(options.body) }); await pending; return { ok: true, json: async () => ({ status: "not-applied", preview: savedContextReview("decision-0", { text: "DO NOT DISPLAY WITHDRAWN PRIVATE REVIEW" }) }) }; };
  const oldInspect = f.renderer.ownNodes(intelligence, "button").find(node => node.attributes["data-context-review-action"] === "inspect").handlers.click;
  await oldInspect.call(intelligence, {}); f.draw(); assert.equal(f.renderer.query(null, "dialog[open]").length, 1);
  const previousSession = f.store.session.get();
  f.store.session.get = () => ({ ...previousSession, projectContext: { ...previousSession.projectContext, permissions: [] } });
  f.draw(); release(); await new Promise(setImmediate); f.draw();
  assert.ok(!f.renderer.markup.includes("DO NOT DISPLAY WITHDRAWN PRIVATE REVIEW")); assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  await oldInspect.call(intelligence, {}); await new Promise(setImmediate);
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
});

test("an unchanged-scope reader cache cannot expose a review after the actor authorization key changes", async () => {
  const f = fixture("en", true); await f.select("decision-0"); await f.toggle("decision-0");
  const prior = f.renderer.component("forma-context-intelligence", "decision-0");
  f.state.replies.push({ status: "not-applied", preview: savedContextReview("decision-0", { text: "ACTOR A PRIVATE RETAINED TEXT" }) });
  await inspectSavedReview(f, prior); prior.suspendControls(); f.draw(); await f.select("decision-1");
  f.state.authorization = "reader-actor-b"; f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  const current = f.renderer.component("forma-context-intelligence", "decision-0"); assert.notEqual(current, prior);
  assert.ok(!f.renderer.markup.includes("ACTOR A PRIVATE RETAINED TEXT"));
  f.state.replies.push({ ok: false, body: { error: "context_authorization_changed" } }); await inspectSavedReview(f, current);
  assert.ok(!current.markup.includes("ACTOR A PRIVATE RETAINED TEXT")); assertReadOnlyReview(f, current);
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume", "resume"]);
});

test("lost generation capability still allows free retained human-authoring review without new analysis", async () => {
  const f = fixture(); personalPermissions(f, ["project.read", "project.author"]); f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  assert.ok(f.renderer.ownNodes(f.block("decision-0"), "textarea").length);
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"), preview = savedContextReview();
  assert.equal(f.renderer.ownNodes(intelligence, "button").length, 1);
  f.state.replies.push({ status: "not-applied", preview }); await inspectSavedReview(f, intelligence);
  assert.ok(f.renderer.ownNodes(intelligence, "textarea").length); assert.equal(f.renderer.ownNodes(intelligence, "form").length, 0);
  assert.ok(intelligence.markup.includes(escapeText(f.i18n.t("context.changes.atomic"))), "current author keeps free Apply guidance without generation eligibility");
  f.state.replies.push({ status: "applied", preview });
  await f.renderer.handler(intelligence, "button", node => node.attributes["data-context-review-action"] === "apply")(); await new Promise(setImmediate); f.draw();
  assert.deepEqual(f.state.requests.map(request => [request.url, request.body.action]), [["/api/context/apply", "resume"], ["/api/context/apply", "apply"]]);
  assert.equal(f.state.requests.at(-1).body.previewId, preview.previewId); assert.equal(f.state.requests.at(-1).body.approvalHash, preview.approvalHash);
  assert.ok(intelligence.markup.includes(escapeText(f.i18n.t("context.changes.appliedHint"))));
});

test("a read-only containing surface cannot grant its author actor generation or human-authoring controls", async () => {
  const f = fixture(); f.state.route = libraryBlockEditorRoute("decision-0"); activeFixture = f; f.host = new FormaLibrary(); f.draw();
  await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"); assert.equal(intelligence.readOnly, true);
  const preview = savedContextReview(); f.state.replies.push({ status: "not-applied", preview }); await inspectSavedReview(f, intelligence);
  assertReadOnlyReview(f, intelligence); assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
});

test("stale Library save and remove executors decline after personal author capability is withdrawn", async () => {
  const f = fixture(), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  created.payload.scope = "library"; delete created.payload.document_id; f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  const editor = f.renderer.component("forma-library-block-editor", "decision-0"), save = f.renderer.ownNodes(editor, "form").find(node => String(node.attributes.class).includes("library-block-form"))?.handlers.submit;
  assert.equal(typeof save, "function");
  await f.renderer.handler(editor, "button", node => node.attributes.class === "button danger")(); f.draw();
  const remove = f.renderer.ownNodes(editor, "button").filter(node => node.attributes.class === "button danger").at(-1).handlers.click;
  assert.ok(f.renderer.ownNodes(editor, "dialog").length);
  const events = f.state.events.length;
  personalPermissions(f, ["project.read"]); f.draw();
  await save.call(editor, { preventDefault() {} }); await remove.call(editor, {}); await new Promise(setImmediate);
  assert.equal(f.state.events.length, events); assert.equal(f.state.requests.length, 0);
  const current = f.renderer.component("forma-library-block-editor", "decision-0");
  assert.equal(f.renderer.ownNodes(current, "form").length, 0); assert.notEqual(current, editor);
});

test("retained review stays readable when its source becomes protected, without new authoring controls", async () => {
  const f = fixture("en", true), created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  created.payload.properties.source_evidence_hash = "saved-proof-hash"; f.draw();
  await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0");
  f.state.replies.push({ status: "not-applied", preview: savedContextReview(), stale: true }); await inspectSavedReview(f, intelligence);
  assertReadOnlyReview(f, intelligence); assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
});


for (const [field, value] of [["projectId", "other-project"], ["documentId", "other-document"], ["blockId", "other-decision"], ["canvasId", "other-board"]]) test("a mismatched retained-review response cannot replace the selected " + field, async () => {
  const f = fixture("en", true); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"), preview = { ...savedContextReview("decision-0", { text: "MISBOUND PRIVATE RESPONSE" }), [field]: value };
  f.state.replies.push({ status: "not-applied", preview }); await inspectSavedReview(f, intelligence);
  assert.ok(!intelligence.markup.includes("MISBOUND PRIVATE RESPONSE"));
  assert.ok(!intelligence.markup.includes(preview.review.sourceText));
  assertReadOnlyReview(f, intelligence);
  assert.equal(f.renderer.ownNodes(intelligence, "button").filter(node => ["retrieve", "dismiss"].includes(node.attributes["data-context-review-action"])).length, 0);
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
});

test("authorization withdrawn at the review update handoff cannot focus or refresh an old receipt", async () => {
  const f = fixture("en", true); await f.select("decision-0"); await f.toggle("decision-0");
  const intelligence = f.renderer.component("forma-context-intelligence", "decision-0"), preview = savedContextReview();
  Object.defineProperty(intelligence, "updateComplete", { configurable: true, get() { f.state.authorization = "withdrawn-during-review-update"; return Promise.resolve(true); } });
  f.state.replies.push({ status: "applied", preview }); await inspectSavedReview(f, intelligence);
  assert.ok(!f.renderer.markup.includes(preview.review.sourceText));
  assert.ok(!f.trace.includes("refresh-events")); assert.equal(f.renderer.query(null, "dialog[open]").length, 0);
  assert.deepEqual(f.state.requests.map(request => request.body.action), ["resume"]);
});

test("shared authoring preview preserves explicit reader guidance and the exact completed receipt", async () => {
  const { renderAuthoringPreview } = await loadActual("src/components/authoring-preview.ts");
  for (const locale of ["en", "fr", "ar", "ja"]) for (const readOnly of [undefined, false, true]) for (const status of ["review", "applying", "applied"]) {
    const f = fixture(locale), preview = savedContextReview("decision-0", { text: "Exact café — العربية 日本語.\n".repeat(100) });
    const id = "shared-review-" + locale + "-" + status + "-" + readOnly;
    f.renderer.draw(f.host, () => renderAuthoringPreview(preview, f.i18n, { id, status, ...(readOnly === undefined ? {} : { readOnly }) }));
    const markup = f.renderer.markup, description = locale + " / " + status + " / " + readOnly;
    assert.equal(markup.includes(escapeText(f.i18n.t("context.changes.atomic"))), status !== "applied" && readOnly !== true, description);
    assert.equal(markup.includes(escapeText(f.i18n.t("context.changes.appliedHint"))), status === "applied", description);
    assert.ok(markup.includes(escapeText(preview.changes[0].text)), "exact Unicode proposal is never shortened: " + description);
    assert.ok(markup.includes(escapeText(JSON.stringify(preview.events, null, 2))), "exact event inspection is retained: " + description);
    assert.ok(markup.includes(preview.sourceHash) && markup.includes(preview.expiresAt));
    assert.equal(f.renderer.ownNodes(f.host, "h3")[0].attributes.id, id, "the existing focus target survives extraction");
    assert.equal(f.renderer.ownNodes(f.host, "section")[0].attributes["aria-labelledby"], id);
    for (const tag of ["input", "select", "textarea", "form", "button"]) assert.equal(f.renderer.ownNodes(f.host, tag).length, 0, "shared display never invents authority: " + tag);
    assert.equal(f.state.requests.length, 0, "rendering is free and never executes a request");
  }
});


// Names come from the complete production renderers and locale controller.
// These in-memory semantics are not a browser or assistive-technology certificate.
const selectionNameTypeDefinition = (await import("../src/model/block-types.ts")).blockTypeDefinition;
const selectionNameText = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const selectionNameId = id => "\u2068" + id + "\u2069";
function selectionNameLabels(f) {
  return [...f.renderer.markup.matchAll(/<label class="context-decision-select">([\s\S]*?)<\/label>/gu)].map(match => {
    const input = match[1].match(/<input([^>]*)>/u), span = match[1].match(/<span>([\s\S]*?)<\/span>/u);
    assert.ok(input && span);
    return { ...f.renderer.attrs(input[1]), visible: selectionNameText(span[1]) };
  });
}
function selectionNameButtons(f) {
  return [...f.renderer.markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)]
    .map(match => ({ ...f.renderer.attrs(match[1]), visible: selectionNameText(match[2].replace(/<[^>]*>/gu, "")) }));
}
async function selectionNameFixture(locale, variant = "unique-handles", viewer = false, surface = "document") {
  const f = fixture(locale, viewer);
  let ids = ["decision-0", "decision-1", "decision-11"];
  if (variant === "complete-ids") {
    ids = ["01234567-89ab-cdef-0123-456789ab0001", "01234567-89ab-cdef-0123-456789ab0002", "01234567-89ab-cdef-0123-456789ab0003"];
    for (const [index, id] of ids.entries()) await f.store.append({ type: "BlockCreated", payload: {
      project_id: "project-a", document_id: "document-a", block_id: id, type: index === 1 ? "audience" : "direction",
      handle: "shared/complete-identity", position: "z" + index, properties: { text: "Exact authored evidence.", weight: .7, authority: "authored" },
    } });
  }
  const longHandle = "方向/مراجعة/Créativité/👩🏽‍🎨/".repeat(70);
  const visibleName = surface === "library"
    ? f.i18n.t("context.controls.named", "Controls for {name}", { name: "__NAME__" })
    : f.i18n.t("context.controls.selectNamed", "{selection}: {name}", { selection: f.i18n.t("context.controls.select", "Select decision"), name: "__NAME__" });
  const contextName = f.i18n.t("context.controls.contextNamed", "{label} — {type}: {handle}", { label: "__LABEL__", type: f.i18n.system("Direction"), handle: "__HANDLE__" });
  const aliasSeparator = selectionNameText(visibleName).split("__NAME__")[1] + contextName.split("__LABEL__")[1].split("__HANDLE__")[0];
  for (const [index, id] of ids.entries()) {
    const label = variant === "composed-text" && index !== 1 ? index === 0 ? "Alpha" + aliasSeparator + "beta" : "Alpha"
      : variant === "distinct-labels" ? "Distinct decision " + index : "Shared decision title";
    await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: id, property_path: "label", old_value: undefined, new_value: label } });
    const current = f.store.projection.get().libraryBlocks.find(block => block.id === id);
    const handle = variant === "composed-text" ? index === 0 ? "gamma" : index === 2 ? "beta" + aliasSeparator + "gamma" : "audience/shared"
      : variant === "same-handle" || variant === "distinct-labels" ? "shared/readable-handle"
      : variant === "normalized-handles" ? (index === 1 ? "audience/" : "direction/") + (index === 2 ? "Caf\u00e9" : "Cafe\u0301")
      : variant === "long-unicode" ? longHandle + ["初稿", "الجمهور", "révision"][index]
      : variant === "missing-handle" ? "" : current.handle;
    if (handle !== current.handle) await f.store.append({ type: "BlockRenamed", payload: { block_id: id, old_handle: current.handle, new_handle: handle } });
  }
  f.draw();
  return { f, ids, variant, authored: JSON.stringify(f.state.events) };
}
function selectionNamesOnSurface(state, surface) {
  const { f, ids } = state;
  if (surface === "document") return ids.map(id => {
    const node = f.renderer.ownNodes(f.block(id), "input").find(item => item.attributes.type === "radio");
    assert.ok(node); return { id, name: node.attributes["aria-label"], node };
  });
  return selectionNameButtons(f).filter(row => ids.includes(row.attributes["data-context-controls-id"]))
    .map(row => ({ id: row.attributes["data-context-controls-id"], name: row.attributes["aria-label"] ?? row.visible, visible: row.visible }));
}
function assertSelectionNames(state, surface) {
  const { f, ids, variant } = state, names = selectionNamesOnSurface(state, surface);
  assert.equal(names.length, 3);
  assert.equal(new Set(names.map(row => selectionNameText(row.name))).size, 3, "All simultaneous decisions need distinct accessible names");
  for (const { id, name, visible } of names) {
    const block = f.store.projection.get().libraryBlocks.find(candidate => candidate.id === id);
    assert.ok(selectionNameText(name).includes(f.i18n.system(selectionNameTypeDefinition(block.type)?.label ?? block.type)), "The context includes the actual localized type");
    if (block.handle) assert.ok(String(name).includes(block.handle), "The complete authored Unicode handle is preserved");
    const requiresId = variant === "missing-handle" || ["same-handle", "normalized-handles", "complete-ids", "composed-text"].includes(variant) && id !== ids[1];
    assert.equal(String(name).includes(selectionNameId(id)), requiresId, "Only a collision or unreadable handle needs the complete stable ID");
    if (surface === "library") assert.ok(selectionNameText(name).includes(visible), "The complete visible Controls label stays in its accessible name");
  }
  if (surface === "document") for (const label of selectionNameLabels(f)) {
    assert.ok(selectionNameText(label.attributes["aria-label"]).includes(label.visible), "Both Select decision and Selected decision stay in the name");
  }
  assert.equal(JSON.stringify(f.state.events), state.authored, "Naming never rewrites authored labels, handles or IDs");
  return names;
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const viewer of [false, true]) test("selection names: " + locale + " Document " + (viewer ? "reader" : "author") + " keeps both visible states and exact two-choice controls", async () => {
  const state = await selectionNameFixture(locale, "unique-handles", viewer), { f, ids } = state;
  assertSelectionNames(state, "document");
  const originalGroups = selectionNamesOnSurface(state, "document").map(row => row.node.attributes.name);
  assert.equal(new Set(originalGroups).size, 1);
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(f.renderer.controls("input"), 14);
  for (const id of ids) {
    await f.select(id); assertSelectionNames(state, "document");
    assert.equal(f.store.ui.focusBlockId, id);
    const checked = f.renderer.query(null, "input").filter(node => node.attributes.type === "radio" && node.checked && node.owner.tag === "forma-context-block");
    assert.equal(checked.length, 1); assert.equal(checked[0].owner.block.id, id);
    assert.equal(f.renderer.controls("button"), 1);
    assert.equal(f.renderer.query(null, "forma-context-intelligence").length, 0, "Selection alone never opens Controls");
    await f.toggle(id);
    assert.equal(f.renderer.component("forma-context-intelligence", id).block.id, id);
    await f.toggle(id); assertSelectionNames(state, "document");
  }
  assert.deepEqual(selectionNamesOnSurface(state, "document").map(row => row.node.attributes.name), originalGroups);
  assert.equal(f.state.requests.length, 0);
  assert.equal(JSON.stringify(f.state.events), state.authored);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("selection names: " + locale + " simultaneous Library Controls keep visible labels and exact original routes", async t => {
  const state = await selectionNameFixture(locale), { f, ids } = state;
  f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw();
  await cContextLibraryNavigationParent(t, f);
  assertSelectionNames(state, "library");
  assert.equal(f.renderer.controls("input"), 1, "The existing Library input count is unchanged; no selection radios are added");
  assert.equal(selectionNameButtons(f).filter(row => row.attributes["data-context-controls-id"] && row.attributes["data-context-controls-id"] !== "__new__").length, 14);
  for (const id of ids) {
    const control = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["data-context-controls-id"] === id);
    assert.ok(control);
    await control.handlers.click.call(f.host, { target: control, currentTarget: control, preventDefault() {}, stopPropagation() {} });
    assert.equal(f.state.route, libraryBlockEditorRoute(id, "/library"));
    f.state.route = "/library"; f.draw(); assertSelectionNames(state, "library");
  }
  assert.equal(f.state.requests.length, 0); assert.equal(JSON.stringify(f.state.events), state.authored);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["document", "library"]) for (const variant of ["same-handle", "normalized-handles", "long-unicode", "distinct-labels", "missing-handle", "complete-ids", "composed-text"]) test("selection names: " + locale + " " + surface + " " + variant + " retains exact authored identity", async () => {
  const state = await selectionNameFixture(locale, variant, false, surface), { f } = state;
  if (surface === "library") { f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw(); }
  const names = assertSelectionNames(state, surface).map(row => [row.id, row.name]);
  f.draw(); assert.deepEqual(assertSelectionNames(state, surface).map(row => [row.id, row.name]), names, "Names remain deterministic across redraws");
  if (surface === "document" && variant === "composed-text") for (const id of [state.ids[0], state.ids[2]]) { await f.select(id); assertSelectionNames(state, surface); }
  assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("selection names: " + locale + " Library reader does not acquire authoring Controls", async () => {
  const state = await selectionNameFixture(locale, "same-handle", true), { f, ids } = state;
  f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw();
  assert.equal(selectionNameButtons(f).filter(row => ids.includes(row.attributes["data-context-controls-id"])).length, 0);
  assert.equal(f.renderer.controls("input"), 0, "Reader inspection adds neither radios nor authoring file inputs");
  assert.equal(f.state.requests.length, 0); assert.equal(JSON.stringify(f.state.events), state.authored);
});


// Final-name regressions use the same actual Document/Library renderers above.
// The pure-helper cases call that renderer's real imported helper and catalogs;
// no browser, assistive-technology, provider, or persisted-source claim is made.
const { contextControlName: finalContextName } = await loadActual("src/components/context-controls.ts");
const finalContextNameComparable = value => String(value).normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
const finalContextNameIsolate = value => "\u2068" + value + "\u2069";
function finalContextNameVisible(f, block, surface, selected = false) {
  const name = finalContextNameIsolate(block.properties.label);
  return surface === "library"
    ? f.i18n.t("context.controls.named", "Controls for {name}", { name })
    : f.i18n.t("context.controls.selectNamed", "{selection}: {name}", {
      selection: selected ? f.i18n.t("context.controls.selected", "Selected decision") : f.i18n.t("context.controls.select", "Select decision"), name,
    });
}
function finalContextNameExpected(f, block, label, identity = "contextNamed") {
  return f.i18n.t("context.controls." + identity, "", {
    label, type: f.i18n.system(selectionNameTypeDefinition(block.type)?.label ?? block.type),
    handle: finalContextNameIsolate(block.handle), id: finalContextNameIsolate(block.id),
  });
}
function finalContextNamePrefix(f, ordinal, name) {
  return f.i18n.t("context.controls.disambiguated", "{ordinal} · {name}", { ordinal: finalContextNameIsolate(ordinal), name });
}
async function finalContextNameFixture(locale, surface, variant, viewer = false) {
  const f = fixture(locale, viewer), type = f.i18n.system("Direction");
  const suffix = id => f.i18n.t("context.controls.identityNamed", "", { label: "__LABEL__", type, handle: "__HANDLE__", id }).split("__HANDLE__")[1];
  let ids = ["decision-0", "decision-11", "decision-12"];
  let labels = ["Shared decision title", "Shared decision title", "Shared decision title"];
  let handles = ["direction/shared", "direction/shared", "direction/shared" + suffix(ids[0])];
  let identities = ["identityNamed", "identityNamed", "contextNamed"];
  let affected = [0, 2];
  if (variant === "unicode-suffix") {
    const stem = "方向/Cafe\u0301/\u200bمرحلة/👩🏽‍🎨/".repeat(32);
    labels = ["Shared Cafe\u0301 👩🏽‍🎨", "Shared Café 👩🏽‍🎨", "Shared Cafe\u0301 👩🏽‍🎨"];
    handles = [stem, stem.normalize("NFC").toUpperCase(), stem.normalize("NFC") + suffix(ids[0])];
  } else if (variant === "empty-handle-alias") {
    const visible = surface === "library"
      ? f.i18n.t("context.controls.named", "", { name: "__LABEL__" })
      : f.i18n.t("context.controls.selectNamed", "", { selection: f.i18n.t("context.controls.select", "Select decision"), name: "__LABEL__" });
    const wrapperSuffix = visible.split("__LABEL__")[1];
    const context = f.i18n.t("context.controls.contextNamed", "", { label: "__LABEL__", type, handle: "__HANDLE__" });
    const identity = f.i18n.t("context.controls.identityOnly", "", { label: "__LABEL__", type, id: "__ID__" });
    const contextSeparator = wrapperSuffix + context.split("__LABEL__")[1].split("__HANDLE__")[0];
    const identitySeparator = wrapperSuffix + identity.split("__LABEL__")[1].split("__ID__")[0];
    labels = ["Root" + contextSeparator + "Branch", "Unaffected original", "Root"];
    handles = ["", "direction/ordinary", "Branch" + identitySeparator + ids[0]];
    identities = ["identityOnly", "contextNamed", "contextNamed"];
  } else if (variant === "normalized-full-ids") {
    ids = ["identity-K", "identity-\u212a", "identity-k\u200b"];
    handles = ids.map(() => "direction/shared");
    identities = ids.map(() => "identityNamed"); affected = [0, 1, 2];
    for (const [index, id] of ids.entries()) await f.store.append({ type: "BlockCreated", payload: {
      project_id: "project-a", document_id: "document-a", block_id: id, type: "direction", handle: handles[index], position: "z" + index,
      properties: { label: labels[index], text: "Exact Unicode identity " + id, authority: "authored", weight: .7 },
    } });
  }
  for (const [index, id] of ids.entries()) {
    const block = f.store.projection.get().libraryBlocks.find(candidate => candidate.id === id);
    await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: id, property_path: "label", old_value: block.properties.label, new_value: labels[index] } });
    await f.store.append({ type: "BlockRenamed", payload: { block_id: id, old_handle: block.handle, new_handle: handles[index] } });
  }
  f.draw();
  if (surface === "library") { f.state.route = "/library"; activeFixture = f; f.host = new FormaLibrary(); f.draw(); }
  return { f, ids, surface, identities, affected: new Set(affected.map(index => ids[index])), authored: JSON.stringify(f.state.events) };
}
function finalContextNameAssert(state) {
  const { f, ids, surface, affected, identities } = state, rows = selectionNamesOnSurface(state, surface);
  const peers = f.store.projection.get()[surface === "library" ? "libraryBlocks" : "blocks"];
  const ranks = new Map(peers.map(block => block.id).sort().map((id, index) => [id, index + 1]));
  assert.equal(rows.length, ids.length);
  assert.equal(new Set(rows.map(row => finalContextNameComparable(row.name))).size, ids.length, "FINAL simultaneous names, not just bases, must be distinct");
  for (const row of rows) {
    const block = peers.find(candidate => candidate.id === row.id);
    const visible = finalContextNameVisible(f, block, surface, f.store.ui.focusBlockId === row.id);
    const previous = finalContextNameExpected(f, block, visible, identities[ids.indexOf(row.id)]);
    assert.equal(row.name, affected.has(row.id) ? finalContextNamePrefix(f, ranks.get(row.id), previous) : previous,
      "Only final-collision-affected peers receive one system prefix; existing full-ID fallback remains complete");
    assert.ok(String(row.name).includes(block.properties.label), "The complete authored label is retained");
    if (block.handle) assert.ok(String(row.name).includes(block.handle), "No authored Unicode handle is normalized or truncated");
    assert.ok(selectionNameText(row.name).includes(selectionNameText(visible)), "The complete visible Select/Selected/Controls phrase is retained");
    if (identities[ids.indexOf(row.id)] !== "contextNamed") assert.ok(String(row.name).includes(finalContextNameIsolate(row.id)), "The entire exact ID survives fallback");
    assert.ok(selectionNameText(row.name).includes(f.i18n.system("Direction")));
  }
  assert.equal(JSON.stringify(f.state.events), state.authored, "Names, selection and inspection do not author changes");
  assert.equal(f.state.requests.length, 0);
  return rows;
}
for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["document", "library"]) for (const variant of ["id-suffix", "unicode-suffix", "empty-handle-alias", "normalized-full-ids"]) test("final context names: " + locale + " " + surface + " " + variant + " stays unique with exact actions", async t => {
  const state = await finalContextNameFixture(locale, surface, variant), { f, ids } = state;
  if (surface === "library") await cContextLibraryNavigationParent(t, f);
  const prior = ids.map((id, index) => {
    const block = f.store.projection.get().libraryBlocks.find(candidate => candidate.id === id);
    return finalContextNameExpected(f, block, finalContextNameVisible(f, block, surface), state.identities[index]);
  });
  assert.ok(new Set(prior.map(finalContextNameComparable)).size < ids.length, "This is a genuine secondary/final alias counterexample");
  const initial = finalContextNameAssert(state).map(row => [row.id, row.name]);
  f.draw(); assert.deepEqual(finalContextNameAssert(state).map(row => [row.id, row.name]), initial);
  if (surface === "document") {
    assert.equal(f.renderer.controls("button"), 0);
    assert.equal(f.renderer.controls("input"), f.store.projection.get().blocks.length);
    for (const id of ids) {
      await f.select(id); finalContextNameAssert(state);
      assert.equal(f.store.ui.focusBlockId, id);
      const checked = f.renderer.query(null, "input").filter(node => node.attributes.type === "radio" && node.checked && node.owner.tag === "forma-context-block");
      assert.equal(checked.length, 1); assert.equal(checked[0].owner.block.id, id);
      assert.equal(f.renderer.controls("button"), 1);
      await f.toggle(id);
      assert.equal(f.renderer.component("forma-context-intelligence", id).block.id, id);
      await f.toggle(id); finalContextNameAssert(state);
    }
  } else {
    for (const id of ids) {
      const control = f.renderer.ownNodes(f.host, "button").find(node => node.attributes["data-context-controls-id"] === id);
      assert.ok(control);
      await control.handlers.click.call(f.host, { target: control, currentTarget: control, preventDefault() {}, stopPropagation() {} });
      assert.equal(f.state.route, libraryBlockEditorRoute(id, "/library"));
      f.draw(); assert.equal(f.renderer.component("forma-library-block-editor", id).blockId, id);
      f.state.route = "/library"; f.draw(); finalContextNameAssert(state);
    }
  }
  assert.equal(f.state.requests.length, 0); assert.equal(JSON.stringify(f.state.events), state.authored);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["document", "library"]) test("final context names: " + locale + " " + surface + " reader keeps exact inspection and no authoring", async () => {
  const state = await finalContextNameFixture(locale, surface, "id-suffix", true), { f, ids } = state;
  if (surface === "document") {
    finalContextNameAssert(state);
    for (const id of ids) {
      await f.select(id); finalContextNameAssert(state); await f.toggle(id);
      const review = f.renderer.component("forma-context-intelligence", id);
      assert.equal(review.block.id, id); assertReadOnlyReview(f, review);
      assert.equal(f.renderer.ownNodes(f.block(id), "form").length, 0);
      await f.toggle(id); finalContextNameAssert(state);
    }
  } else {
    assert.equal(selectionNameButtons(f).filter(row => ids.includes(row.attributes["data-context-controls-id"])).length, 0);
    assert.equal(f.renderer.controls("input"), 0);
  }
  assert.equal(f.state.requests.length, 0); assert.equal(JSON.stringify(f.state.events), state.authored);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("final context names: " + locale + " actual ordinal template is prefix-free after comparison normalization", () => {
  const f = fixture(locale), ordinals = [1, 2, 9, 10, 11, 19, 99, 100, 101, 999, 1000, 1001, 9999, 10000];
  assert.equal(FORMA_CONTEXT_CONTROL_MESSAGES[locale]["context.controls.disambiguated"], "{ordinal} · {name}", "The system ordinal precedes every authored field in every actual locale");
  const prefixes = ordinals.map(ordinal => finalContextNameComparable(finalContextNamePrefix(f, ordinal, "")) + " ");
  assert.deepEqual(prefixes, ordinals.map(ordinal => ordinal + " · "));
  for (const [index, prefix] of prefixes.entries()) for (const other of prefixes.filter((_, candidate) => candidate !== index)) {
    assert.equal(other.startsWith(prefix), false, "A fixed delimiter terminates the complete ASCII integer before any authored text");
  }
  for (const name of ["", "1 · authored", "\u200b١٠ · عنوان", "１０ · ｆｕｌｌｗｉｄｔｈ", "\u0301👩🏽‍🎨", "\n\tAuthored"]) {
    const names = ordinals.map(ordinal => finalContextNameComparable(finalContextNamePrefix(f, ordinal, name)));
    assert.equal(new Set(names).size, ordinals.length);
  }
  assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("final context names: " + locale + " bounded candidate closure marks only an authored alias chain", () => {
  const f = fixture(locale), originalEvents = JSON.stringify(f.state.events), prototype = f.store.projection.get().blocks[0];
  const block = (id, label, handle) => ({ ...prototype, id, handle, properties: { ...prototype.properties, label } });
  const label = "Cafe\u0301 👩🏽‍🎨 العربية", stem = "direction/Shared", suffix = f.i18n.t("context.controls.identityNamed", "", {
    label: "__LABEL__", type: f.i18n.system("Direction"), handle: "__HANDLE__", id: "001",
  }).split("__HANDLE__")[1];
  const peers = [block("001", label, stem), block("002", label, stem), block("003", label, stem + suffix)];
  let previousLabel = label, previousRank = 1;
  for (let rank = 4; rank <= 28; rank += 1) {
    const nextLabel = finalContextNamePrefix(f, previousRank, previousLabel);
    peers.push(block(String(rank).padStart(3, "0"), nextLabel, stem + suffix));
    previousLabel = nextLabel; previousRank = rank;
  }
  peers.push(block("029", "Unrelated authored label", "direction/ordinary"));
  const originals = new Map(peers.map((candidate, index) => [candidate.id,
    finalContextNameExpected(f, candidate, candidate.properties.label, index < 2 ? "identityNamed" : "contextNamed")]));
  const marked = new Set(peers.filter(candidate => !["002", "029"].includes(candidate.id)).map(candidate => candidate.id));
  const expected = new Map(peers.map((candidate, index) => [candidate.id,
    marked.has(candidate.id) ? finalContextNamePrefix(f, index + 1, originals.get(candidate.id)) : originals.get(candidate.id)]));
  assert.equal(finalContextNameComparable(originals.get("001")), finalContextNameComparable(originals.get("003")));
  assert.equal(finalContextNameComparable(originals.get("004")), finalContextNameComparable(expected.get("001")));
  assert.equal(finalContextNameComparable(originals.get("028")), finalContextNameComparable(expected.get("027")));
  const names = [];
  for (const candidate of peers) {
    let labels = 0;
    const alternatives = new Map();
    const counted = { system: value => f.i18n.system(value), t: (id, fallback, values) => {
      if (id === "context.controls.disambiguated") {
        const ordinal = Number(finalContextNameComparable(values.ordinal));
        assert.equal(alternatives.has(ordinal), false, "Each peer gets exactly one immutable candidate, never a growing suffix");
        alternatives.set(ordinal, values.name);
      }
      return f.i18n.t(id, fallback, values);
    } };
    const name = finalContextName(item => { labels += 1; return item.properties.label; }, candidate, peers, counted);
    assert.equal(name, expected.get(candidate.id));
    assert.equal(labels, peers.length, "Label construction is bounded to one visit per exact peer per call");
    assert.equal(alternatives.size, peers.length, "Closure creates at most peerCount candidate names");
    for (const [ordinal, original] of alternatives) assert.equal(original, originals.get(peers[ordinal - 1].id), "Only original complete names, never previous candidates, are prefixed");
    assert.equal(finalContextName(item => item.properties.label, candidate, [...peers].reverse(), f.i18n), name, "Full exact-ID ranks do not depend on view order");
    names.push(name);
  }
  assert.equal(new Set(names.map(finalContextNameComparable)).size, peers.length);
  assert.equal(names[1], originals.get("002"), "An unaffected full-ID fallback remains byte-identical");
  assert.equal(names[28], originals.get("029"), "An unrelated ordinary name remains byte-identical and short");
  assert.equal(names.filter((name, index) => name !== originals.get(peers[index].id)).length, marked.size);
  assert.ok(marked.size <= peers.length, "The finite affected peer set is bounded by the original exact identities");
  assert.equal(JSON.stringify(f.state.events), originalEvents); assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("final context names: " + locale + " empty handles and comparison-equivalent exact IDs remain separate bindings", () => {
  const f = fixture(locale), prototype = f.store.projection.get().blocks[0];
  // These deliberately incomplete/Unicode values exercise the helper boundary,
  // not canonical-ID creation or a real-document navigation claim.
  const peers = ["", "\u200b", "\u2060", "Ｋ", "K", "k"].map(id => ({
    ...prototype, id, handle: "", properties: { ...prototype.properties, label: "Authored complete title" },
  }));
  const names = peers.map(candidate => finalContextName(item => item.properties.label, candidate, peers, f.i18n));
  assert.equal(new Set(names.map(finalContextNameComparable)).size, peers.length);
  for (const [index, candidate] of peers.entries()) {
    assert.ok(names[index].includes(finalContextNameIsolate(candidate.id)), "Exact full ID bytes survive even when normalization compares them equal");
    assert.ok(names[index].includes(candidate.properties.label));
    assert.equal(finalContextName(item => item.properties.label, candidate, peers.filter(item => item.id !== candidate.id), f.i18n), names[index],
      "A current block absent from its peer view is included once by exact identity");
  }
  assert.equal(f.state.requests.length, 0);
});

test("final context names: same peer array uses current labels, visible state, exact object and locale without stale caching", () => {
  const initial = fixture("en"), prototype = initial.store.projection.get().blocks[0];
  const peers = ["first", "second"].map(id => ({ ...prototype, id, handle: "direction/shared", properties: { ...prototype.properties, label: "Authored title" } }));
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const f = fixture(locale);
    for (const selected of [false, true, false]) {
      const current = peers[0], label = candidate => finalContextNameVisible(f, candidate, "document", selected);
      assert.equal(finalContextName(label, current, peers, f.i18n), finalContextNameExpected(f, current, label(current), "identityNamed"),
        "Ordinary first-level full-ID fallback is unchanged in the current locale and visible state");
    }
    const replacement = { ...peers[0], properties: { ...peers[0].properties, label: "New exact current authored title" } };
    const label = candidate => finalContextNameVisible(f, candidate, "document");
    assert.equal(finalContextName(label, replacement, peers, f.i18n), finalContextNameExpected(f, replacement, label(replacement)),
      "A retained current object replaces the same exact ID, not a second peer");
    peers[0].properties.label = "A fresh ordinary label";
    assert.equal(finalContextName(label, peers[0], peers, f.i18n), finalContextNameExpected(f, peers[0], label(peers[0])),
      "An unchanged array cannot cache an old collision or authored label");
    peers[0].properties.label = "Authored title";
    assert.equal(f.state.requests.length, 0);
  }
});


// Context continuity uses the actual Store authoring methods and model event
// builders. Only this fixture's existing appendBatch transport is deferred.
// This named adapter describes that SIMULATED transport, not a server receipt or
// authority proof. It retains the existing rows and invents no acknowledgment ID.
function SIMULATED_CONTEXT_APPEND_RESULT(inputs, appended) {
  const rows = Array.isArray(appended) ? appended : [];
  const complete = Array.isArray(inputs) && inputs.length > 0 && rows.length === inputs.length
    && new Set(rows.map(row => row?.eventId)).size === rows.length
    && rows.every((row, index) => {
      const input = inputs[index];
      return row && typeof row === "object" && !Array.isArray(row)
        && typeof row.eventId === "string" && row.eventId.length > 0
        && input && typeof input === "object" && !Array.isArray(input)
        && typeof input.type === "string" && input.type.length > 0 && row.type === input.type
        && input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        && isDeepStrictEqual(row.payload, input.payload)
        && (input.compensatesEventId == null || typeof input.compensatesEventId === "string" && input.compensatesEventId.length > 0)
        && (row.compensatesEventId ?? null) === (input.compensatesEventId ?? null);
    });
  return {
    appended: rows,
    acknowledgment: { outcome: complete ? "observed" : "unconfirmed", rejectedIndices: [] },
    publication: complete ? "published" : "none",
  };
}
const contextContinuityAuthoring = await import("../src/model/output-authoring.ts");
const contextContinuityStoreTree = syntax("src/state/store.ts");
const contextContinuityStoreClass = contextContinuityStoreTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
const contextContinuityStoreNames = ["#relatedOutputBlocks", "outputBlockTextEvents", "outputInputEvents", "saveOutputInput", "#eventWriteComplete", "#requestedEventObserved"];
const contextContinuityStoreMembers = contextContinuityStoreNames.map(name => {
  const member = contextContinuityStoreClass.members.find(node => node.name?.getText(contextContinuityStoreTree) === name);
  assert.ok(member, "reuse complete Store member " + name);
  return member.getText(contextContinuityStoreTree);
});
const ContextContinuityStore = new Function("outputInputDraft", "outputInputEditEvents", "outputBlockTextEditEvents", "normalizeOutputRequirementCreation", ts.transpileModule(
  "return class ContextContinuityStore {\n" + contextContinuityStoreMembers.join("\n") + "\n}",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText)(contextContinuityAuthoring.outputInputDraft, contextContinuityAuthoring.outputInputEditEvents, contextContinuityAuthoring.outputBlockTextEditEvents, normalizeOutputRequirementCreation);

async function contextContinuityFixture(locale, kind) {
  const f = fixture(locale);
  const created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === "decision-0");
  if (kind === "image") Object.assign(created.payload.properties, {
    source_output_id: "existing-image", label: "Original image title", text: "Original image direction", image_caption: "Original image title",
    output_palette: ["#123456", "#abcdef"], palette: ["#123456", "#abcdef"],
  });
  if (kind === "structured") Object.assign(created.payload.properties, {
    source_artifact_id: "saved-story", source_artifact_kind: "short_story", label: "Original story title",
    text: "Original manuscript", artifact_markdown: "Original manuscript", artifact_summary: "Original summary",
    artifact_structure: { items: [
      { id: "saved-story:1", title: "Original chapter one", body: "Original first body", notes: "Original first notes", image_prompt: "Original first visual" },
      { id: "saved-story:2", title: "Original chapter two", body: "Original second body", notes: "Original second notes", image_prompt: "Original second visual" },
    ] },
  });
  const actual = new ContextContinuityStore();
  actual.projection = f.store.projection; actual.toast = f.store.toast;
  actual.appendBatch = (...args) => f.store.appendBatch(...args);
  actual.appendBatchWithReceipt = async (inputs, ...args) =>
    SIMULATED_CONTEXT_APPEND_RESULT(inputs, await actual.appendBatch(inputs, ...args));
  for (const name of ["captureSourceOwnership", "sourceOwnershipScopeActive", "sourceOwnershipActive"])
    actual[name] = (...args) => f.store[name](...args);
  for (const name of contextContinuityStoreNames.filter(name => !name.startsWith("#"))) f.store[name] = actual[name].bind(actual);
  f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
  f.contextContinuityKind = kind;
  return f;
}

function contextContinuityInput(f, node, value) {
  assert.ok(node && typeof node.handlers.input === "function", "real editable input exists");
  assert.ok(!Object.hasOwn(node.attributes, "disabled"), "draft fields remain editable while a save is pending");
  node.handlers.input.call(node.owner, { target: { value }, currentTarget: { value } });
  f.draw();
}

function contextContinuityRead(f) {
  const block = f.block("decision-0"), kind = f.contextContinuityKind;
  if (kind === "structured") return f.renderer.component("forma-output-input-editor", "decision-0")?.draft ?? null;
  if (kind === "text") return f.renderer.ownNodes(block, "textarea")[0]?.value ?? null;
  const rich = f.renderer.query(block, "forma-ui-rich-text")[0];
  const inputs = f.renderer.ownNodes(block, "input").filter(node => node.handlers.input);
  return rich ? { text: rich.value, label: inputs[0]?.value, palette: inputs.slice(1).map(node => node.value) } : null;
}

function contextContinuityType(f, mark) {
  const block = f.block("decision-0"), kind = f.contextContinuityKind;
  if (kind === "text") {
    contextContinuityInput(f, f.renderer.ownNodes(block, "textarea")[0], mark + " — 日本語 العربية café 👩🏽‍💻\n".repeat(35));
  } else if (kind === "image") {
    const rich = f.renderer.query(block, "forma-ui-rich-text")[0];
    contextContinuityInput(f, f.renderer.ownNodes(rich, "textarea")[0], mark === "EMPTY" ? "" : mark + " — full image direction\nالعربية 日本語");
    const inputs = () => f.renderer.ownNodes(block, "input").filter(node => node.handlers.input);
    contextContinuityInput(f, inputs()[0], mark + " — image title العربية 日本語");
    contextContinuityInput(f, inputs()[1], mark === "B" ? "#000000" : "#f0e1d2");
    contextContinuityInput(f, inputs()[2], mark === "B" ? "#ffffff" : "#102030");
  } else {
    const workbench = f.renderer.component("forma-output-input-editor", "decision-0");
    const own = tag => f.renderer.ownNodes(workbench, tag).filter(node => node.attributes.class !== "ui-rich-text-input");
    contextContinuityInput(f, own("input")[0], mark + " — story title العربية 日本語");
    contextContinuityInput(f, own("textarea")[0], mark + " — complete summary\n".repeat(30));
    const rich = f.renderer.query(workbench, "forma-ui-rich-text")[0];
    contextContinuityInput(f, f.renderer.ownNodes(rich, "textarea")[0], mark + " — complete manuscript\n".repeat(35));
    for (let index = 1; index < own("input").length; index++) contextContinuityInput(f, own("input")[index], mark + " — chapter " + index);
    for (let index = 1; index < own("textarea").length; index++) contextContinuityInput(f, own("textarea")[index], mark + " — structured field " + index + "\nالعربية 日本語");
  }
  return structuredClone(contextContinuityRead(f));
}

function contextContinuityCommitted(f, draft) { return f.contextContinuityKind === "text" ? draft.trim() : draft; }

function contextContinuitySaved(f) {
  const block = f.store.projection.get().libraryBlocks.find(row => row.id === "decision-0"), properties = block.properties;
  return f.contextContinuityKind === "structured" ? contextContinuityAuthoring.outputInputDraft(block)
    : f.contextContinuityKind === "image" ? { text: properties.text, label: properties.label, palette: properties.output_palette } : properties.text;
}

function contextContinuityDefer(f) {
  const append = f.store.appendBatch, requests = [];
  f.store.appendBatch = inputs => {
    const gate = Promise.withResolvers(), request = { gate, submitted: structuredClone(inputs) };
    requests.push(request);
    request.promise = (async () => {
      const accepted = await gate.promise;
      return accepted === false ? [] : append(inputs);
    })();
    return request.promise;
  };
  return requests;
}

function contextContinuitySubmit(f, form = null) {
  const block = f.block("decision-0");
  form ??= f.renderer.ownNodes(block, "form").find(node => String(node.attributes.class).split(/\s/u).includes("block-editor"));
  assert.ok(form && typeof form.handlers.submit === "function", "actual parent Save handler");
  form.handlers.submit.call(block, { preventDefault() {} });
  return form;
}

async function contextContinuityAcknowledge(f, request, accepted = true) {
  request.gate.resolve(accepted); await request.promise; await new Promise(setImmediate); f.draw(); await new Promise(setImmediate); f.draw();
}

async function contextContinuityReenter(f) {
  const block = f.block("decision-0");
  if (f.renderer.ownNodes(block, "div").some(node => node.attributes.class === "context-controls-panel")) await f.toggle("decision-0");
  await f.select("decision-1"); await f.toggle("decision-1"); await f.select("decision-0"); await f.toggle("decision-0");
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image", "structured"]) for (const mode of ["stay-open", "close-reenter", "unchanged", "failed", "cancel-new-identical", "second-save-pending"]) test("context continuity: " + locale + " " + kind + " " + mode, async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const original = structuredClone(contextContinuitySaved(f));
  const a = contextContinuityType(f, "A"), requests = contextContinuityDefer(f), eventCount = f.state.events.length;
  contextContinuitySubmit(f); assert.equal(requests.length, 1);
  let expected = a;
  if (mode === "cancel-new-identical" || mode === "second-save-pending") {
    await f.renderer.handler(f.block("decision-0"), "button", node => node.attributes.type === "button" && node.attributes.class === "button ghost")();
    f.draw();
    await contextContinuityReenter(f);
    expected = contextContinuityType(f, mode === "cancel-new-identical" ? "A" : "B");
    if (mode === "second-save-pending") { contextContinuitySubmit(f); assert.equal(requests.length, 2); }
  } else if (mode !== "unchanged") expected = contextContinuityType(f, "B");
  if (mode === "close-reenter") await contextContinuityReenter(f);
  if (mode !== "unchanged") assert.deepEqual(contextContinuityRead(f), expected);
  const submitted = structuredClone(requests[0].submitted);
  await contextContinuityAcknowledge(f, requests[0], mode !== "failed");
  assert.deepEqual(requests[0].submitted, submitted, "the submitted A event bytes never change with later edits");
  assert.deepEqual(contextContinuitySaved(f), mode === "failed" ? original : contextContinuityCommitted(f, a), "only explicitly submitted A was committed");
  if (mode === "unchanged") {
    assert.equal(f.renderer.ownNodes(f.block("decision-0"), "form").some(node => String(node.attributes.class).includes("block-editor")), false);
    await contextContinuityReenter(f); assert.deepEqual(contextContinuityRead(f), contextContinuityCommitted(f, a));
  } else {
    assert.deepEqual(contextContinuityRead(f), expected, "ack A cannot clean or remove the newer draft");
    await contextContinuityReenter(f); assert.deepEqual(contextContinuityRead(f), expected, "the complete newer draft remains recoverable");
    if (mode === "second-save-pending") {
      contextContinuitySubmit(f); assert.equal(requests.length, 2, "ack A did not unlock a duplicate pending B");
      await contextContinuityAcknowledge(f, requests[1]); assert.deepEqual(contextContinuitySaved(f), contextContinuityCommitted(f, expected));
    } else {
      assert.equal(requests.length, 1, "newer draft is never automatically saved");
      contextContinuitySubmit(f);
      if (mode === "cancel-new-identical") assert.equal(requests.length, 1, "same bytes already persisted need no duplicate event");
      else { assert.equal(requests.length, 2); await contextContinuityAcknowledge(f, requests[1]); assert.deepEqual(contextContinuitySaved(f), contextContinuityCommitted(f, expected)); }
    }
  }
  assert.ok(f.state.events.length >= eventCount);
  assert.equal(f.state.requests.length, 0, "no provider/analysis requests");
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image", "structured"]) for (const retirement of ["authorization", "reader", "route"]) test("context continuity: " + locale + " " + kind + " retires " + retirement + " before old acknowledgement", async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  contextContinuityType(f, "A");
  const requests = contextContinuityDefer(f); contextContinuitySubmit(f);
  const before = f.block("decision-0");
  if (retirement === "authorization") f.state.authorization = "new-owner";
  else if (retirement === "reader") f.state.viewer = true;
  else f.state.route = "/library";
  f.draw();
  if (retirement === "route") {
    const b = contextContinuityType(f, "B");
    await contextContinuityAcknowledge(f, requests[0]);
    assert.deepEqual(contextContinuityRead(f), b, "departed route cannot receive old editor completion");
  } else if (retirement === "authorization") {
    const b = contextContinuityType(f, "B");
    assert.notEqual(f.block("decision-0"), before, "new authorized editor is distinct from the old owner");
    await contextContinuityAcknowledge(f, requests[0]);
    assert.deepEqual(contextContinuityRead(f), b, "old completion does not clear the new authorized editor");
  } else {
    await contextContinuityAcknowledge(f, requests[0]);
    assert.equal(f.renderer.ownNodes(f.block("decision-0"), "form").filter(node => String(node.attributes.class).includes("block-editor")).length, 0);
    f.state.viewer = false; f.state.authorization = "author-restored";
    f.draw(); await f.select("decision-0"); await f.toggle("decision-0");
    const b = contextContinuityType(f, "B");
    assert.notEqual(contextContinuityRead(f), null); assert.deepEqual(contextContinuityRead(f), b);
    assert.notEqual(f.block("decision-0"), before, "authorization-keyed editor cannot be the withdrawn owner");
  }
  assert.equal(requests.length, 1); assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("context continuity: " + locale + " empty derived image copy is not replaced by acknowledged prior text", async t => {
  const f = await contextContinuityFixture(locale, "image"); t.after(() => f.i18n.hostDisconnected());
  contextContinuityType(f, "A"); const requests = contextContinuityDefer(f); contextContinuitySubmit(f);
  const empty = contextContinuityType(f, "EMPTY"); assert.equal(empty.text, "");
  await contextContinuityAcknowledge(f, requests[0]); await contextContinuityReenter(f);
  assert.deepEqual(contextContinuityRead(f), empty);
  contextContinuitySubmit(f); await contextContinuityAcknowledge(f, requests[1]);
  assert.deepEqual(contextContinuitySaved(f), empty); assert.equal(f.state.requests.length, 0);
});


for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image", "structured"]) for (const mode of ["input-ABA", "reopened-identical", "failed-unchanged", "cancel-only"]) test("context continuity: " + locale + " " + kind + " " + mode + " retains exact editor ownership", async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const original = contextContinuitySaved(f), a = contextContinuityType(f, "A"), requests = contextContinuityDefer(f);
  contextContinuitySubmit(f); assert.equal(requests.length, 1);
  if (mode === "input-ABA") { contextContinuityType(f, "B"); assert.deepEqual(contextContinuityType(f, "A"), a); }
  else if (mode === "reopened-identical") await contextContinuityReenter(f);
  else if (mode === "cancel-only") {
    await f.renderer.handler(f.block("decision-0"), "button", node => node.attributes.type === "button" && node.attributes.class === "button ghost")(); f.draw();
  }
  await contextContinuityAcknowledge(f, requests[0], mode !== "failed-unchanged");
  assert.deepEqual(contextContinuitySaved(f), mode === "failed-unchanged" ? original : contextContinuityCommitted(f, a));
  const form = f.renderer.ownNodes(f.block("decision-0"), "form").find(node => String(node.attributes.class).split(/\s/u).includes("block-editor"));
  if (mode === "cancel-only") assert.equal(form, undefined, "an old completion never reopens an explicitly canceled editor");
  else { assert.ok(form, "later identical bytes do not make this the old editor"); assert.deepEqual(contextContinuityRead(f), a); }
  assert.equal(requests.length, 1); assert.equal(f.state.requests.length, 0);
});


for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image", "structured"]) test("context continuity: " + locale + " " + kind + " repeated pending Save is inert", async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const a = contextContinuityType(f, "A"), requests = contextContinuityDefer(f);
  const form = contextContinuitySubmit(f); contextContinuitySubmit(f, form);
  assert.equal(requests.length, 1, "the same pending save has only one authored append");
  const b = contextContinuityType(f, "B");
  contextContinuitySubmit(f, form); assert.equal(requests.length, 1, "B is not queued or implicitly appended while A is pending");
  await contextContinuityAcknowledge(f, requests[0]);
  assert.deepEqual(contextContinuitySaved(f), contextContinuityCommitted(f, a));
  assert.deepEqual(contextContinuityRead(f), b);
  contextContinuitySubmit(f); assert.equal(requests.length, 2, "B can be explicitly saved after A finishes");
  await contextContinuityAcknowledge(f, requests[1]);
  assert.deepEqual(contextContinuitySaved(f), contextContinuityCommitted(f, b)); assert.equal(f.state.requests.length, 0);
});


for (const locale of ["en", "fr", "ar", "ja"]) test("context continuity: " + locale + " a replacement structured child owns its whole draft", async t => {
  const f = await contextContinuityFixture(locale, "structured"); t.after(() => f.i18n.hostDisconnected());
  const a = contextContinuityType(f, "A"), requests = contextContinuityDefer(f);
  contextContinuitySubmit(f); assert.equal(requests.length, 1);
  const oldChild = f.renderer.component("forma-output-input-editor", "decision-0");
  assert.notEqual(oldChild.draft, oldChild.draft, "the real public getter returns a complete detached clone");
  assert.deepEqual(oldChild.draft, a);
  // Model native replacement of this child subtree only. Parent identity,
  // authority, draft revision, retained Controls and all handlers stay actual.
  for (const [key, record] of [...f.renderer.instances]) {
    let belongs = false;
    for (let node = record.instance; node; node = node.parentElement) if (node === oldChild) belongs = true;
    if (!belongs) continue;
    record.instance.isConnected = false; record.instance.disconnectedCallback();
    f.renderer.instances.delete(key);
  }
  f.draw();
  const newChild = f.renderer.component("forma-output-input-editor", "decision-0"), b = newChild.draft;
  assert.notEqual(newChild, oldChild); assert.equal(newChild.isConnected, true);
  assert.notDeepEqual(b, a, "new native child has its own canonical draft, not the submitted clone");
  await contextContinuityAcknowledge(f, requests[0]);
  assert.equal(f.renderer.query(f.block("decision-0"), "forma-output-input-editor")[0] === newChild, true, "old child acknowledgement cannot close a new child");
  assert.deepEqual(newChild.draft, b, "every structured field remains owned by the replacement editor");
  assert.deepEqual(contextContinuitySaved(f), a);
  assert.equal(requests.length, 1); assert.equal(f.state.requests.length, 0);
});


function contextContinuityRestoreCanonical(f, original) {
  const block = f.block("decision-0");
  if (f.contextContinuityKind === "text") contextContinuityInput(f, f.renderer.ownNodes(block, "textarea")[0], original);
  else {
    const rich = f.renderer.query(block, "forma-ui-rich-text")[0];
    contextContinuityInput(f, f.renderer.ownNodes(rich, "textarea")[0], original.text);
    const inputs = () => f.renderer.ownNodes(block, "input").filter(node => node.handlers.input);
    contextContinuityInput(f, inputs()[0], original.label);
    for (let index = 0; index < original.palette.length; index++) contextContinuityInput(f, inputs()[index + 1], original.palette[index]);
  }
}

function contextContinuityRetainedNote(f) {
  return f.renderer.ownNodes(f.block("decision-0"), "small").filter(node => node.attributes.class === "context-draft-note");
}

async function contextContinuityPeerText(f, value) {
  const block = f.store.projection.get().libraryBlocks.find(row => row.id === "decision-0");
  const scope = f.store.captureAuthorizationScope().key;
  await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: "text", old_value: block.properties.text, new_value: value } });
  f.draw();
  assert.equal(f.store.captureAuthorizationScope().key, scope, "the current authorized source is unchanged");
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image"]) for (const accepted of [true, false]) test("context continuity: " + locale + " " + kind + " explicit return to original source survives " + (accepted ? "saved A" : "failed A"), async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const original = structuredClone(contextContinuityRead(f)), a = contextContinuityType(f, "A"), requests = contextContinuityDefer(f);
  contextContinuitySubmit(f); assert.equal(requests.length, 1);
  const submitted = structuredClone(requests[0].submitted);
  contextContinuityRestoreCanonical(f, original);
  assert.deepEqual(contextContinuityRead(f), original, "the newer input is explicitly restored before acknowledgement");
  await contextContinuityAcknowledge(f, requests[0], accepted);
  assert.deepEqual(contextContinuitySaved(f), accepted ? contextContinuityCommitted(f, a) : original);
  assert.deepEqual(contextContinuityRead(f), original, "rendering cannot overwrite the new owner with the acknowledged A");
  assert.deepEqual(requests[0].submitted, submitted, "restoring values never mutates the submitted A");
  await f.toggle("decision-0");
  assert.equal(contextContinuityRetainedNote(f).length, accepted ? 1 : 0, "the retained note reports actual current value differences, not a sticky label");
  assert.equal(requests.length, 1, "closing a restored draft never saves it automatically");
  await f.toggle("decision-0"); assert.deepEqual(contextContinuityRead(f), original);
  const savedBefore = contextContinuitySaved(f), expected = contextContinuityCommitted(f, original);
  contextContinuitySubmit(f);
  if (JSON.stringify(savedBefore) !== JSON.stringify(expected)) {
    assert.equal(requests.length, 2, "the restored input has its own explicit Save");
    await contextContinuityAcknowledge(f, requests[1]);
  } else assert.equal(requests.length, 1, "already saved original values create no duplicate append");
  assert.deepEqual(contextContinuitySaved(f), expected);
  await f.toggle("decision-0"); assert.equal(contextContinuityRetainedNote(f).length, 0);
  assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image"]) test("context continuity: " + locale + " " + kind + " plain revert keeps a truthful note and Cancel resets ownership", async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const original = structuredClone(contextContinuityRead(f)), eventCount = f.state.events.length;
  contextContinuityType(f, "TEMPORARY");
  contextContinuityRestoreCanonical(f, original);
  await f.toggle("decision-0");
  assert.equal(contextContinuityRetainedNote(f).length, 0, "an unchanged retained input is not described as unsaved");
  assert.equal(f.state.events.length, eventCount, "close creates no save");
  await f.toggle("decision-0"); assert.deepEqual(contextContinuityRead(f), original);
  await f.renderer.handler(f.block("decision-0"), "button", node => node.attributes.type === "button" && node.attributes.class === "button ghost")(); f.draw();
  const peerText = "Current authorized peer update — العربية 日本語";
  await contextContinuityPeerText(f, peerText);
  await f.toggle("decision-0"); await f.toggle("decision-0");
  assert.deepEqual(contextContinuityRead(f), kind === "image" ? { ...original, text: peerText } : peerText, "Cancel lets a new editor initialize from the current source");
  assert.equal(f.state.events.length, eventCount + 1, "only the explicitly seeded peer update was added");
  assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image"]) test("context continuity: " + locale + " " + kind + " an untouched open draft still follows current source", async t => {
  const f = await contextContinuityFixture(locale, kind); t.after(() => f.i18n.hostDisconnected());
  const original = structuredClone(contextContinuityRead(f)), eventCount = f.state.events.length;
  const peerText = "Current authorized untouched update — العربية 日本語";
  await contextContinuityPeerText(f, peerText);
  assert.deepEqual(contextContinuityRead(f), kind === "image" ? { ...original, text: peerText } : peerText);
  await f.toggle("decision-0"); assert.equal(contextContinuityRetainedNote(f).length, 0);
  assert.equal(f.state.events.length, eventCount + 1); assert.equal(f.state.requests.length, 0);
});

// These two controls certify only the finite source-derived publication adapter,
// not real Store authorization, source retirement, DOM focus or Worker behavior.
test("finite Context Store subscriptions notify synchronously and really unsubscribe", () => {
  const publications = contextStorePublications(), calls = [];
  const stop = publications.subscribe(() => calls.push("first"));
  assert.deepEqual(calls, [], "subscribe does not invoke a partially initialized owner");
  publications.notify(); assert.deepEqual(calls, ["first"]);
  stop(); publications.notify(); assert.deepEqual(calls, ["first"], "removed listeners do not run");
  let stopSelf;
  stopSelf = publications.subscribe(() => { calls.push("self"); stopSelf(); });
  const stopOther = publications.subscribe(() => calls.push("other"));
  publications.notify(); assert.deepEqual(calls, ["first", "self", "other"]);
  publications.notify(); assert.deepEqual(calls, ["first", "self", "other", "other"]);
  stopOther(); publications.notify(); assert.equal(calls.length, 4);
});

test("finite Context Store publishes route and authority ABA before redraw", async t => {
  const f = fixture(), original = { route: f.state.route, authorization: f.state.authorization, viewer: f.state.viewer };
  t.after(() => f.i18n.hostDisconnected());
  const observed = [];
  const stop = f.store.subscribe(() => observed.push({
    route: f.state.route, authorization: f.state.authorization, viewer: f.state.viewer,
    focusBlockId: f.store.ui.focusBlockId, events: f.state.events.length,
  }));
  const originalEvents = f.state.events.length;
  assert.equal(observed.length, 0);
  f.state.route = "/library"; f.state.route = original.route;
  f.state.authorization = "other-authority"; f.state.authorization = original.authorization;
  f.state.viewer = true; f.state.viewer = original.viewer;
  assert.deepEqual(observed.map(({ route, authorization, viewer }) => ({ route, authorization, viewer })), [
    { ...original, route: "/library" }, original,
    { ...original, authorization: "other-authority" }, original,
    { ...original, viewer: true }, original,
  ], "each intervening owner is observable synchronously; returning to A does not erase B");
  f.store.patchUi({ focusBlockId: "decision-0" });
  assert.equal(observed.length, 7); assert.equal(observed.at(-1).focusBlockId, "decision-0");
  await f.store.append({ type: "BlockPropertyEdited", payload: { block_id: "decision-0", property_path: "text", new_value: "Finite adapter publication" } });
  assert.equal(observed.length, 8); assert.equal(observed.at(-1).events, originalEvents + 1);
  f.draw(); assert.equal(observed.length, 9, "direct nested fixture setup is published at the existing draw boundary");
  stop(); f.state.route = "/library"; f.store.patchUi({ focusBlockId: "" }); f.draw();
  assert.equal(observed.length, 9); assert.equal(f.state.requests.length, 0);
});

// Finite document-collection contract only. The existing native renderer owns
// every returned port; this is not a browser, Store or modal-authority proof.
test("finite Context document collections expose current emitted dialogs and live native open state", { concurrency: false }, t => {
  const previousFixture = activeFixture, f = fixture();
  t.after(() => { f.i18n.hostDisconnected(); activeFixture = previousFixture; });
  const events = structuredClone(f.state.events), requests = [...f.state.requests];
  const host = new ElementPort(); host.tag = "fixture-document-collection";
  const view = () => html`<section><dialog id="collection-first" open>First native dialog</dialog>
    <dialog id="collection-second">Second native dialog</dialog><button>Ordinary native action</button></section>`;
  f.renderer.draw(host, view);
  const emitted = f.renderer.ownNodes(host, "dialog");
  assert.equal(emitted.length, 2);
  const snapshot = documentPort.querySelectorAll("dialog");
  assert.deepEqual(snapshot, emitted, "The document exposes the existing renderer's exact committed ports");
  assert.strictEqual(documentPort.querySelector("dialog"), emitted[0]);
  assert.deepEqual(documentPort.querySelectorAll("dialog[open]"), [emitted[0]]);
  assert.equal(modalPort.ensureModalDialog(emitted[1]), true);
  assert.deepEqual(documentPort.querySelectorAll("dialog[open]"), emitted);
  emitted[0].close();
  assert.deepEqual(documentPort.querySelectorAll("dialog[open]"), [emitted[1]], "Current native close state is not replaced by an always-clean collection");
  assert.deepEqual(snapshot, emitted, "An earlier collection keeps its native element references");
  f.renderer.draw(host, () => html`<section><button>Only a current non-dialog action</button></section>`);
  assert.deepEqual(documentPort.querySelectorAll("dialog"), []);
  assert.deepEqual(documentPort.querySelectorAll("dialog[open]"), []);
  assert.equal(documentPort.querySelector("dialog"), null);
  f.renderer.draw(host, view);
  const current = documentPort.querySelectorAll("dialog");
  assert.equal(current.length, 2);
  assert.ok(current.every(node => f.renderer.nodes.includes(node)));
  assert.ok(current.every(node => !snapshot.includes(node)), "Removed ports are not returned from a later committed frame");
  assert.deepEqual(documentPort.querySelectorAll("dialog[open]"), [current[0]]);
  assert.deepEqual(f.state.events, events); assert.deepEqual(f.state.requests, requests);
});

// Opt-in prerequisite for the 25 existing isolated-Library journeys only.
// Keep their original synthetic fourteen-decision Store/data and registered
// child inventory. The complete actual Shell is an admission parent, not a
// second rendered application. This is not a real Store/Worker route receipt.
async function cContextLibraryNavigationParent(t, f) {
  const { calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  const { applicationIdFromRoute } = await import("../src/platform/applications.ts");
  const { isStandaloneExperienceRoute } = await import("../src/experiences/host-route.ts");
  const { FormaShell } = await ports.loadActual("src/components/forma-shell.ts");
  const { FormaLibrary: CurrentLibrary } = await ports.loadActual("src/components/forma-library.ts");
  const original = { store: f.store, state: f.state, events: JSON.stringify(f.state.events),
    requests: [...f.state.requests], route: f.state.route, i18n: f.i18n, renderer: f.renderer, host: f.host };
  assert.ok(original.host instanceof FormaLibrary, "Only an explicitly mounted original Library opts in");
  assert.equal(f.store.transitionWorkspace, undefined);
  assert.equal(f.store.captureWorkspaceNavigationFocus, undefined);

  // Bind the current same-app delegation and guarded commit before reusing
  // its actual currentness/handoff methods. The finite stable/advance ports
  // below cover route/source/authorization only, not browser/session cookies,
  // Image startup/retirement, Store history, hydration or HTTP work.
  const storeTree = syntax("src/state/store.ts");
  const storeOwner = storeTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
  assert.ok(storeOwner);
  const memberNode = name => {
    const found = storeOwner.members.filter(node => node.name?.getText(storeTree) === name);
    assert.equal(found.length, 1, "one actual Store member " + name); return found[0];
  };
  const member = name => memberNode(name).getText(storeTree);
  for (const name of ["#captureWorkspaceNavigation", "#takeWorkspaceNavigation", "#workspaceNavigationStable",
    "#workspaceNavigationCurrent", "#handoffWorkspaceNavigation", "#advanceWorkspaceNavigation", "#commitRoute"]) {
    const node = memberNode(name);
    assert.ok(ts.isMethodDeclaration(node) && !node.asteriskToken
      && !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword), "synchronous Store owner method " + name);
  }
  const printer = ts.createPrinter({ removeComments: true });
  const statements = name => {
    const body = memberNode(name).body; assert.ok(body, "actual Store body " + name); return body.statements;
  };
  const expectStatements = (name, expected, actual = statements(name)) => {
    const tree = ts.createSourceFile("navigation-contract.ts", expected, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const print = (nodes, source) => [...nodes].map(node => printer.printNode(ts.EmitHint.Unspecified, node, source));
    assert.deepEqual(print(actual, storeTree), print(tree.statements, tree), "current Store contract " + name);
  };
  expectStatements("#takeWorkspaceNavigation", `
    const owner=this.#workspaceNavigationOwners.get(options);
    if(owner){this.#workspaceNavigationOwners.delete(options);return owner;}
    return this.#captureWorkspaceNavigation(options);
  `);
  expectStatements("#captureWorkspaceNavigation", `
    const session=this.session.get();
    const owner:WorkspaceNavigationOwner={options:{},handedOff:false,revision:this.#workspaceTransition,
      route:this.route.get(),browserRoute:\`\${location.pathname}\${location.search}\${location.hash}\`,
      session,sessionRevision:this.#sessionRevision,sourceGeneration:this.#sourceGeneration,sourceRetired:this.#sourceRetired,
      authorization:session?this.#authorizationScope(session):"",shared:Boolean(session?.projectContext),
      cookieGeneration:this.#projectContextCookieGeneration,cookieSessionGeneration:this.#projectContextSessionGeneration,startup:null};
    owner.options={...options};
  `, statements("#captureWorkspaceNavigation").slice(0, 3));
  expectStatements("transitionWorkspace", `
    const owner=this.#takeWorkspaceNavigation(options),navigationScope=this.captureAuthorizationScope();options=owner.options;
    if(!this.#workspaceNavigationCurrent(owner))return false;
    path=this.#projectTaskRoute(path,options);
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(isStandaloneExperienceRoute(path))return this.#assignWorkspaceNavigation(path,owner);
    const source=applicationIdFromRoute(owner.route),destination=applicationIdFromRoute(path);
    if(source===destination)return this.#commitRoute(path,owner);
  `, statements("transitionWorkspace").slice(0, 8));
  expectStatements("#workspaceNavigationStable", `
    const session=this.session.get();
    return owner.revision===this.#workspaceTransition&&owner.route===this.route.get()
      &&owner.browserRoute===\`\${location.pathname}\${location.search}\${location.hash}\`
      &&owner.session===session&&owner.sessionRevision===this.#sessionRevision
      &&owner.sourceGeneration===this.#sourceGeneration&&owner.sourceRetired===this.#sourceRetired
      &&owner.authorization===(session?this.#authorizationScope(session):"")&&owner.shared===Boolean(session?.projectContext)
      &&owner.cookieGeneration===this.#projectContextCookieGeneration&&owner.cookieSessionGeneration===this.#projectContextSessionGeneration;
  `);
  expectStatements("#workspaceNavigationCurrent", `
    if(!this.#workspaceNavigationStable(owner))return false;
    if(!owner.handedOff&&owner.options.current&&(!owner.options.current()||!this.#workspaceNavigationStable(owner)))return false;
    if(owner.options.focus&&(!owner.options.focus.current()||!this.#workspaceNavigationStable(owner)))return false;
    return this.#workspaceNavigationStable(owner);
  `);
  expectStatements("#handoffWorkspaceNavigation", `
    if(!this.#workspaceNavigationCurrent(owner))return false;
    if(owner.handedOff||!owner.options.onOriginHandoff)return true;
    if(!owner.options.onOriginHandoff())return false;
    owner.handedOff=true;return this.#workspaceNavigationCurrent(owner);
  `);
  expectStatements("#advanceWorkspaceNavigation", `
    if(!this.#workspaceNavigationCurrent(owner))return false;
    owner.revision=++this.#workspaceTransition;
  `, statements("#advanceWorkspaceNavigation").slice(0, 2));
  const commit = statements("#commitRoute");
  expectStatements("#commitRoute", `
    const options=owner.options,startup=owner.startup?.owner===owner?owner.startup:null;
    if(!this.#workspaceNavigationCurrent(owner))return false;
  `, commit.slice(0, 2));
  const admissions = commit.filter(node => ts.isIfStatement(node)
    && node.expression.getText(storeTree) === "!this.#handoffWorkspaceNavigation(owner)||!this.#advanceWorkspaceNavigation(owner)");
  assert.equal(admissions.length, 1, "one direct guarded commit admission");
  const admission = commit.indexOf(admissions[0]);
  expectStatements("#commitRoute admission", `
    if(!this.#handoffWorkspaceNavigation(owner)||!this.#advanceWorkspaceNavigation(owner))return false;
    owner.handedOff=true;
    const changed=owner.route!==routedPath||before!==expectedBrowserRoute;
  `, commit.slice(admission, admission + 3));
  const committed = commit[admission + 3];
  assert.ok(ts.isVariableStatement(committed));
  assert.equal(committed.declarationList.declarations.length, 1);
  const declaration = committed.declarationList.declarations[0], mutation = declaration.initializer;
  assert.equal(declaration.name.getText(storeTree), "committed");
  assert.ok(mutation && ts.isCallExpression(mutation));
  assert.equal(mutation.expression.getText(storeTree), "this.#nativeImageMutation");
  assert.equal(mutation.arguments.length, 2);
  const publish = mutation.arguments[0];
  assert.ok(ts.isArrowFunction(publish) && ts.isBlock(publish.body));
  assert.ok(!publish.modifiers?.some(node => node.kind === ts.SyntaxKind.AsyncKeyword), "route publication is synchronous");
  assert.equal(publish.parameters.length, 0);
  expectStatements("#commitRoute mutation currentness", "if(!this.#workspaceNavigationCurrent(owner))return false;", publish.body.statements.slice(0, 1));
  const focused = publish.body.statements.filter(node => ts.isExpressionStatement(node)
    && ts.isBinaryExpression(node.expression) && node.expression.left.getText(storeTree) === "this.#workspaceNavigationFocus");
  assert.equal(focused.length, 1);
  const focusIndex = publish.body.statements.indexOf(focused[0]);
  expectStatements("#commitRoute focus record", `
    if(!this.#workspaceNavigationCurrent(owner))return false;
    this.#workspaceNavigationFocus=options.focus?{route:routedPath,focus:options.focus,revision:owner.revision}:null;
  `, publish.body.statements.slice(focusIndex - 1, focusIndex + 1));
  const routes = publish.body.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(storeTree) === "!startup");
  assert.equal(routes.length, 1);
  assert.ok(publish.body.statements.indexOf(routes[0]) > focusIndex);
  expectStatements("#commitRoute finite no-startup publication", `
    if(!startup){this.route.set(routedPath);owner.route=routedPath;return this.#workspaceNavigationCurrent(owner);}
  `, routes);
  const code = ts.transpileModule("return class ContextUnitNavigation {\n"
    + ["#workspaceTransition", "#workspaceNavigationFocus", "captureWorkspaceNavigationFocus",
      "#workspaceNavigationCurrent", "#handoffWorkspaceNavigation"].map(member).join("\n")
    + `
      constructor(store) { this.store=store; this.route=store.route; }
      retireChangedRoute() {
        if(this.#workspaceNavigationFocus&&this.route.get()!==this.#workspaceNavigationFocus.route) {
          this.#workspaceTransition++; this.#workspaceNavigationFocus=null;
        }
      }
      #workspaceNavigationStable(owner) {
        const store=this.store;
        return owner.revision===this.#workspaceTransition&&owner.route===store.route.get()
          &&store.sourceOwnershipActive(owner.source)&&store.authorizationScopeActive(owner.authorization);
      }
      #advanceWorkspaceNavigation(owner) {
        if(!this.#workspaceNavigationCurrent(owner))return false;
        owner.revision=++this.#workspaceTransition;return true;
      }
      async transitionWorkspace(path,options={}) {
        const store=this.store,owner={options:{},handedOff:false,revision:this.#workspaceTransition,
          route:store.route.get(),source:store.captureSourceOwnership(),authorization:store.captureAuthorizationScope()};
        owner.options={...options};
        assert.equal(owner.options.nativeImageStartup,undefined,"This finite port has no Image startup or retirement");
        if(!this.#workspaceNavigationCurrent(owner))return false;
        assert.equal(isStandaloneExperienceRoute(path),false,"Standalone experience assignment is outside this finite Library port");
        assert.equal(applicationIdFromRoute(path),applicationIdFromRoute(owner.route),"This unit port cannot stand in for an audience handoff");
        assert.ok(path==="/library"||libraryBlockEditorFromRoute(path),"Only these existing local Library routes are modeled");
        if(!this.#handoffWorkspaceNavigation(owner)||!this.#advanceWorkspaceNavigation(owner))return false;
        owner.handedOff=true;
        if(!this.#workspaceNavigationCurrent(owner))return false;
        this.#workspaceNavigationFocus=owner.options.focus?{route:path,focus:owner.options.focus,revision:owner.revision}:null;
        store.setRoute(path);owner.route=path;
        return this.#workspaceNavigationCurrent(owner);
      }
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const { libraryBlockEditorFromRoute } = await import("../src/model/routes.ts");
  const Boundary = new Function("assert", "applicationIdFromRoute", "libraryBlockEditorFromRoute", "isStandaloneExperienceRoute", code)(assert, applicationIdFromRoute, libraryBlockEditorFromRoute, isStandaloneExperienceRoute);
  const boundary = new Boundary(f.store);
  f.store.transitionWorkspace = boundary.transitionWorkspace.bind(boundary);
  f.store.captureWorkspaceNavigationFocus = boundary.captureWorkspaceNavigationFocus.bind(boundary);
  const stopRoute = f.store.subscribe(() => boundary.retireChangedRoute());

  const frame = { store: f.store, state: f.state, i18n: f.i18n, locale: f.locale, trace: f.trace,
    listeners: new Map(), changed: new Map(), frames: new Map(), timers: new Map(), resizeTargets: new Map(),
    storage: new Map(), clipboard: [], timerSequence: 0, requested: false, host: null };
  const nativeCleanups = [];
  let shell = null, library = null;
  const retire = (owner, renderer) => {
    if (!owner || !renderer) return;
    owner.isConnected = false;
    for (const { instance } of renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    owner.disconnectedCallback(); owner.parentElement = null;
    for (const node of renderer.nodes) node.isConnected = false;
  };
  // Register retirement before the first asynchronous native-class load so a
  // prerequisite assertion cannot leave shared native wrappers installed.
  t.after(async () => {
    ports.bindFixture(frame);
    try {
      retire(library, frame.renderer);
      if (shell) { shell.isConnected = false; shell.disconnectedCallback(); }
      await Promise.resolve();
      assert.equal(f.store, original.store);
    } finally {
      stopRoute();
      for (const cleanup of nativeCleanups.reverse()) await cleanup();
      delete f.store.transitionWorkspace; delete f.store.captureWorkspaceNavigationFocus;
      f.i18n.hostDisconnected();
    }
  });
  const nativeRegistry = Object.fromEntries(await Promise.all(Object.entries(componentModules).map(async ([tag, [path, name]]) => {
    const actual = await ports.loadActual(path); assert.equal(typeof actual[name], "function"); return [tag, actual[name]];
  })));
  assert.deepEqual(Object.keys(nativeRegistry), Object.keys(registry), "No new child panels inflate the original unit's control inventory");
  frame.renderer = new ports.RendererPort(frame, nativeRegistry);
  frame.tick = async () => { await Promise.resolve(); if (frame.host?.isConnected) frame.draw(); return true; };
  frame.draw = () => { ports.bindFixture(frame); f.store.notify(); return frame.renderer.draw(frame.host); };
  retire(original.host, original.renderer);
  ports.bindFixture(frame);
  shell = new FormaShell(); shell.tag = "forma-shell"; shell.attributes = {}; shell.isConnected = true;
  library = new CurrentLibrary(); library.tag = "forma-library"; library.attributes = {}; library.parentElement = shell; library.isConnected = true;
  frame.host = library;
  const query = frame.renderer.query.bind(frame.renderer);
  frame.renderer.query = (owner, selector) => {
    if (selector.includes(",")) return selector.split(",").flatMap(part => frame.renderer.query(owner, part.trim()));
    const descendants = query(owner, selector);
    return selector === "forma-library" && (owner === null || owner === shell) && shell.isConnected
      && library.isConnected && library.parentElement === shell ? [library, ...descendants] : descendants;
  };
  const native = installOutputNavigationFocusNative({ after: cleanup => nativeCleanups.push(cleanup) }, frame, ports);
  // The original fixture registers an explicit component subset; it is not a
  // fullPageTree. Existing native owner ancestry is sufficient here. Do not
  // fabricate unregistered children or override any component blocker/current.
  f.host = library; f.renderer = frame.renderer; f.draw = frame.draw;
  shell.connectedCallback(); library.connectedCallback(); f.draw();
  assert.ok(shell instanceof FormaShell && library instanceof CurrentLibrary);
  assert.equal(library.closest("forma-shell"), shell); assert.ok(shell.contains(library));
  assert.ok(ports.ElementPort.hasStoreIdentity(shell, original.store) && ports.ElementPort.hasStoreIdentity(library, original.store));
  assert.deepEqual(shell.querySelectorAll("forma-library"), [library]);
  assert.equal(library.ownerDocument, native.document);
  assert.equal(f.store, original.store); assert.equal(f.state, original.state); assert.equal(f.i18n, original.i18n);
  assert.equal(f.state.route, original.route); assert.equal(JSON.stringify(f.state.events), original.events);
  assert.deepEqual(f.state.requests, original.requests);
  f.contextLibraryNavigation = { shell, library, native, boundary: "actual Shell admission / explicitly finite original Store route port" };
  return f.contextLibraryNavigation;
}

// Actual full Library/editor rendering and input handlers, using the existing
// keyed-cache port. Native attribute bindings are observable here; the port
// does not implement browser label.control, accessible-name or focus semantics.
for (const [locale, expectedName] of Object.entries({
  en: "Default influence", fr: "Influence par défaut", ar: "التأثير الافتراضي", ja: "デフォルトの影響",
})) test("Library influence range has a stable localized label through " + locale + " input and cache", { concurrency: false }, t => {
  const f = fixture(locale);
  t.after(() => f.i18n.hostDisconnected());
  for (const id of ["decision-0", "decision-1"]) {
    const created = f.state.events.find(event => event.type === "BlockCreated" && event.payload.block_id === id);
    created.payload.scope = "library"; delete created.payload.document_id;
  }
  const originalEvents = structuredClone(f.state.events), originalRequests = structuredClone(f.state.requests);
  f.state.route = libraryBlockEditorRoute("decision-0");
  activeFixture = f; f.host = new FormaLibrary(); f.draw();
  assert.equal(f.i18n.system("Default influence"), expectedName, "use the exact current locale catalog");
  const readWeight = (editor, value, expectedId) => {
    assert.ok(editor instanceof registry["forma-library-block-editor"] && editor.isConnected);
    const ranges = f.renderer.ownNodes(editor, "input").filter(node => node.attributes.type === "range");
    assert.equal(ranges.length, 1);
    const range = ranges[0], id = range.attributes.id;
    assert.equal(typeof id, "string"); assert.ok(id.length > 0 && !/\s/u.test(id), "the real range has a usable ID");
    if (expectedId !== undefined) assert.equal(id, expectedId, "redraw/cache never allocates a replacement range ID");
    const labels = f.renderer.ownNodes(editor, "label").filter(node => node.attributes.class === "library-weight");
    const outputs = f.renderer.ownNodes(editor, "output").filter(node => node.attributes.for === id);
    assert.equal(labels.length, 1); assert.equal(outputs.length, 1);
    assert.equal(labels[0].attributes.for, id, "the visible label addresses the range, not its preceding OUTPUT");
    assert.equal(outputs[0].attributes.for, id, "the percentage records which range produced it");
    assert.equal(range.attributes["aria-label"], expectedName, "the explicit range name excludes the changing percentage");
    assert.equal(range.attributes.min, "0"); assert.equal(range.attributes.max, "1"); assert.equal(range.attributes.step, ".05");
    assert.equal(range.value, String(value)); assert.equal(typeof range.handlers.input, "function");
    const groups = [...editor.markup.matchAll(/<label\b[^>]*class="library-weight"[^>]*>([\s\S]*?)<\/label>/gu)];
    assert.equal(groups.length, 1);
    const parts = groups[0][1].match(/^([^<]*)<output\b[^>]*>([^<]*)<\/output>\s*<input\b/u);
    assert.ok(parts, "the real emitted label keeps its text, percentage and range in the existing order");
    assert.equal(parts[1].trim(), escapeText(expectedName));
    assert.equal(parts[2], `${Math.round(value * 100)}%`, "percentage text comes from the real editor render");
    assert.equal(f.renderer.ownNodes(editor, "input").filter(node => node.attributes.id === id).length, 1);
    return { range, id };
  };
  const first = f.renderer.component("forma-library-block-editor", "decision-0");
  const initial = readWeight(first, .7);
  f.draw(); readWeight(first, .7, initial.id);
  const handle = () => f.renderer.ownNodes(first, "input").find(node => node.attributes.maxlength === "96");
  const handleDraft = "Unfinished Library influence handle", copyDraft = "  Keep this exact draft العربية 日本語.\n";
  handle().handlers.input.call(first, { target: { value: handleDraft } }); f.draw();
  const richText = f.renderer.query(first, "forma-ui-rich-text").find(child => child.attributes.class === "block-editor-copy");
  assert.ok(richText);
  richText.dispatchEvent(new CustomEvent("forma-input", { detail: { value: copyDraft } })); f.draw();
  const firstRange = readWeight(first, .7, initial.id).range;
  firstRange.value = "0.35";
  firstRange.handlers.input.call(first, { target: firstRange, currentTarget: firstRange }); f.draw();
  readWeight(first, .35, initial.id);
  assert.deepEqual(f.state.events, originalEvents); assert.deepEqual(f.state.requests, originalRequests);

  f.state.route = libraryBlockEditorRoute("decision-1"); f.draw();
  assert.equal(first.isConnected, false);
  const second = f.renderer.component("forma-library-block-editor", "decision-1");
  assert.notEqual(second, first);
  const other = readWeight(second, .7);
  assert.notEqual(other.id, initial.id, "separate retained editor instances cannot share their range ID");
  other.range.value = "0.85";
  other.range.handlers.input.call(second, { target: other.range, currentTarget: other.range }); f.draw();
  readWeight(second, .85, other.id);
  f.state.route = "/library"; f.draw();
  assert.equal(second.isConnected, false);
  f.state.route = libraryBlockEditorRoute("decision-0"); f.draw();
  assert.equal(f.renderer.component("forma-library-block-editor", "decision-0"), first);
  readWeight(first, .35, initial.id);
  assert.equal(handle().value, handleDraft);
  assert.equal(f.renderer.query(first, "forma-ui-rich-text").find(child => child.attributes.class === "block-editor-copy"), richText);
  assert.equal(richText.value, copyDraft); assert.equal(f.renderer.ownNodes(richText, "textarea")[0].value, copyDraft);
  f.draw(); readWeight(first, .35, initial.id);
  f.state.route = libraryBlockEditorRoute("decision-1"); f.draw();
  assert.equal(f.renderer.component("forma-library-block-editor", "decision-1"), second);
  readWeight(second, .85, other.id);
  assert.deepEqual(f.state.events, originalEvents, "input and cache navigation neither save nor append an event");
  assert.deepEqual(f.state.requests, originalRequests, "the range has no provider or fetch interaction");
  for (const id of ["decision-0", "decision-1"]) {
    assert.equal(f.store.projection.get().libraryBlocks.find(block => block.id === id).properties.weight, .7,
      "the saved source weight stays unchanged while each instance keeps its local draft");
  }
});

for(const fault of ['none','hidden','route','authorization','closed','detached','source-replaced','instrumentation-disabled'])test('actual Document inspector records only a visible current native block opening: '+fault,async t=>{
  const f=fixture(),seen=[];f.store.ui.instrumentation=true;const oldVisibility=documentPort.visibilityState;documentPort.visibilityState='visible';t.after(()=>{documentPort.visibilityState=oldVisibility;});
  await f.select('decision-0');const host=f.block('decision-0');let resume;const update=new Promise(resolve=>{resume=resolve;});Object.defineProperty(host,'updateComplete',{configurable:true,get:()=>update});
  f.store.hot=async(event,options)=>{if(options.current())seen.push(event);};
  const open=f.renderer.handler(host,'button',node=>String(node.attributes.class).includes('context-controls-toggle'));await open();f.draw();
  const panel=host.querySelector('.context-controls-panel');assert.ok(panel);panel.getClientRects=()=>[{}];
  if(fault==='hidden')documentPort.visibilityState='hidden';if(fault==='route')f.state.route='/document/other';if(fault==='authorization')f.state.authorization='other';
  if(fault==='closed')await f.renderer.handler(host,'button',node=>String(node.attributes.class).includes('context-controls-toggle'))();
  if(fault==='detached')host.isConnected=false;if(fault==='source-replaced')host.block={...host.block,sourceEvents:['different-native-source']};if(fault==='instrumentation-disabled')f.store.ui.instrumentation=false;
  resume(true);for(let index=0;index<6;index++)await Promise.resolve();assert.equal(seen.length,Number(fault==='none'));
  if(seen.length){assert.equal(seen[0].type,'BlockInspected');assert.equal(seen[0].payload.source_surface,'document-context-controls');assert.deepEqual(seen[0].payload.source_event_ids,host.block.sourceEvents);assert.equal(JSON.stringify(seen).includes('Authored'),false);}
});


for(const kind of ['context_contains','action_participant'])for(const change of ['unchanged','removed-before-publish'])test('Document Memory inspection separates field history from structural edits: '+kind+'/'+change,async t=>{
 const f=fixture(),seen=[];f.store.ui.instrumentation=true;const oldVisibility=documentPort.visibilityState;documentPort.visibilityState='visible';t.after(()=>{documentPort.visibilityState=oldVisibility;});
 const last=f.state.events.at(-1),relation={...last,eventId:'native-structural-relation',sequence:last.sequence+1,type:'BlockRelationAdded',payload:{project_id:'project-a',document_id:'document-a',relation_id:'native-relation',from_block_id:'decision-0',to_block_id:'decision-1',kind,properties:{}}};
 f.state.events=[...f.state.events,relation];f.draw();await f.select('decision-1');const host=f.block('decision-1');
 assert.ok(host.block.sourceEvents.includes(relation.eventId));const fields=host.block.sourceEvents.filter(id=>id!==relation.eventId);
 let resume;const update=new Promise(resolve=>{resume=resolve;});Object.defineProperty(host,'updateComplete',{configurable:true,get:()=>update});
 f.store.hot=async(event,options)=>{if(options.current())seen.push(event);};
 await f.renderer.handler(host,'button',node=>String(node.attributes.class).includes('context-controls-toggle'))();f.draw();
 const panel=host.querySelector('.context-controls-panel');assert.ok(panel);panel.getClientRects=()=>[{}];
 if(change==='removed-before-publish'){
  f.state.events=[...f.state.events,{...relation,eventId:'native-structural-removal',sequence:relation.sequence+1,type:'BlockRelationRemoved',payload:{project_id:'project-a',document_id:'document-a',relation_id:'native-relation'}}];f.draw();
 }
 resume(true);for(let i=0;i<6;i++)await Promise.resolve();
 assert.equal(seen.length,Number(change==='unchanged'));
 if(seen.length){assert.deepEqual(seen[0].payload.source_event_ids,fields);assert.equal(JSON.stringify(seen).includes('Authored'),false);}
});

for(const change of ['unchanged','focal-changed-before-publish'])test('Document Memory inspection retains extraction and focal field versions: '+change,async t=>{
 const f=fixture(),seen=[];f.store.ui.instrumentation=true;const previous=documentPort.visibilityState;documentPort.visibilityState='visible';t.after(()=>{documentPort.visibilityState=previous;});
 const last=f.state.events.at(-1),scope={project_id:'project-a',document_id:'document-a',block_id:'decision-1'};
 const extracted=[['ExtractionRequested',{}],['ExtractionCompleted',{chips:[{property:'colors',value:['PRIVATE_EXTRACTED_COLOR'],confidence:1}]}],
  ['ImageFocalPointCalculated',{target_kind:'reference',target_id:'decision-1',focal_point:{x:.4,y:.6,confidence:.7,method:'attention-region-v2',sampleWidth:4,sampleHeight:4}}]]
  .map(([type,payload],index)=>({...last,type,eventId:'native-extracted-field-'+index,sequence:last.sequence+index+1,payload:{...scope,...payload}}));
 f.state.events=[...f.state.events,...extracted];f.draw();await f.select('decision-1');const host=f.block('decision-1'),ids=[...host.block.sourceEvents];
 assert.ok(extracted.every(event=>ids.includes(event.eventId)));
 let resume;const update=new Promise(resolve=>{resume=resolve;});Object.defineProperty(host,'updateComplete',{configurable:true,get:()=>update});
 f.store.hot=async(event,options)=>{if(options.current())seen.push(event);};
 await f.renderer.handler(host,'button',node=>String(node.attributes.class).includes('context-controls-toggle'))();f.draw();host.querySelector('.context-controls-panel').getClientRects=()=>[{}];
 if(change==='focal-changed-before-publish'){const focal=extracted.at(-1);f.state.events=[...f.state.events,{...focal,eventId:'changed-focal-field',sequence:focal.sequence+1,payload:{...focal.payload,focal_point:{...focal.payload.focal_point,x:.8}}}];f.draw();}
 resume(true);for(let i=0;i<6;i++)await Promise.resolve();assert.equal(seen.length,Number(change==='unchanged'));
 if(seen.length){assert.deepEqual(seen[0].payload.source_event_ids,ids);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE_EXTRACTED_COLOR|focal_point/);}
});
