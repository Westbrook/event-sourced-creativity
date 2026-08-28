import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import * as lit from "lit";
const { nothing } = lit;
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { foldEvents } from "../src/model/events.ts";
import { artifactGenerationInputInspection } from "../src/model/generation-inputs.ts";
import { documentArtifactRevision } from "../src/model/document-artifacts.ts";
import enMessages from "../src/components/design-system/locales/system-en.ts";
import frMessages from "../src/components/design-system/locales/fr.ts";
import arMessages from "../src/components/design-system/locales/ar.ts";
import jaMessages from "../src/components/design-system/locales/ja.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";

// This runs actual component renderers and handlers with in-memory application,
// template, focus, and modal ports. It is not a browser/AT or viewport certificate.
// Counts include every emitted native element, including closed details.
// It exercises these two actual dialog hosts, not the full production study page.
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
  querySelector(selector) {
    const id=selector.match(/^#(.+)$/)?.[1]??selector.match(/^\[id="([^"]+)"\]$/)?.[1];
    if(id)return this.fixture.renderer.query(this,"*").find(node=>node.attributes.id===id)??null;
    if(/^\.[\w-]+$/.test(selector)){
      const component=this.fixture.renderer.query(this,"forma-ui-popover").find(item=>String(item.attributes?.class??"").split(/\s+/).includes(selector.slice(1)));
      if(component)return component;
    }
    return this.fixture.renderer.query(this, selector)[0] ?? null;
  }
  querySelectorAll(selector) { return this.fixture.renderer.query(this, selector); }
  matches(selector) { return selector===":dir(rtl)"?this.i18n?.direction==="rtl":selector===this.tag; }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
  closest(selector) { if (selector === "forma-workspace") return this.fixture.workspace; let owner = this.parentElement; while (owner) { if (owner.tag === selector) return owner; owner = owner.parentElement; } return null; }
  dispatchEvent(event) {
    if (this.eventBindings?.[event.type]) this.eventBindings[event.type].call(this.parentElement, event);
    this.fixture.trace.push("event:" + event.type);
    return true;
  }
  focus() { this.fixture.trace.push("focus:" + this.tag); }
}
const documentPort = { activeElement: null, documentElement: { lang: "en", dataset: {} }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null };
const windowPort = { requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
documentPort.defaultView=windowPort;
documentPort.addEventListener=(...args)=>windowPort.addEventListener(...args);
documentPort.removeEventListener=(...args)=>windowPort.removeEventListener(...args);
windowPort.innerWidth=1280;windowPort.innerHeight=720;
windowPort.getComputedStyle=()=>({width:"384px",getPropertyValue:()=>"0px",direction:activeFixture?.locale==="ar"?"rtl":"ltr"});
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
    else if (specifier.startsWith("lit/")) dependencies.set(specifier, await import(specifier));
    else if (/\/(?:forma-element|presentational-element)$/.test(specifier)) dependencies.set(specifier, { FormaElement: ElementPort, FormaPresentationalElement: ElementPort, icon: () => nothing, copyTextToClipboard: async value => { activeFixture.clipboard.push(value); return true; } });
    else if (specifier.endsWith("/modal-dialog")) dependencies.set(specifier, modalPort);
    else if (specifier.endsWith("/slotted-element")) dependencies.set(specifier, { FormaSlottedElement: ElementPort });
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
  constructor(fixture, registry) { this.fixture = fixture; this.registry = registry; this.instances = new Map(); this.nodes = []; this.bindings = []; this.activeCaches = new Set(); this.seen = new Set(); this.markup = ""; this.openPopovers = new Set(); }
  reference(value, owner) { const id = this.bindings.push({ value, owner }) - 1; return "__bound_" + id + "__"; }
  resolve(value) { const exact = value.match(/^__bound_(\d+)__$/); if (exact) return this.bindings[Number(exact[1])]?.value; return value.replace(/__bound_(\d+)__/g, (_, id) => String(this.bindings[Number(id)]?.value ?? "")); }
  attrs(raw) {
    const attributes = {}, properties = {}, handlers = {};
    for (const [, name, double, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = this.resolve(double ?? single ?? bare ?? "");
      if (name[0] === ".") properties[name.slice(1)] = value;
      else if (name[0] === "@") handlers[name.slice(1)] = value;
      else if (name[0] === "?") { if (value) attributes[name.slice(1)] = ""; }
      else if(value!==nothing) attributes[name] = value;
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
      node.removeEventListener = (type, handler) => { if (node.listeners?.[type] === handler) delete node.listeners[type]; };
      node.classList = { contains: name => String(node.attributes.class ?? "").split(/\s+/).includes(name) };
      node.setCustomValidity = value => { node.validationMessage = value; };
      node.reportValidity = () => !node.validationMessage;
      Object.setPrototypeOf(node,ElementPort.prototype);node.fixture=this.fixture;node.parentElement=owner;node.tagName=tag.toUpperCase();
      node.style={setProperty(){}};
      node.getBoundingClientRect=()=>({left:0,right:1280,top:0,bottom:44});
      node.matches=selector=>selector===":popover-open"?this.openPopovers.has(node.attributes.id):selector.split(",").some(part=>part.trim()===tag||part.trim().startsWith(".")&&node.classList.contains(part.trim().slice(1)));
      node.showPopover=()=>{this.openPopovers.add(node.attributes.id);node.handlers.toggle?.call(owner,{currentTarget:node,newState:"open"});};
      node.hidePopover=()=>{this.openPopovers.delete(node.attributes.id);node.handlers.toggle?.call(owner,{currentTarget:node,newState:"closed"});};
      node.click=()=>{
        if(Object.hasOwn(node.attributes,"disabled"))return;
        let prevented=false;
        const event={target:node,currentTarget:node,preventDefault(){prevented=true;},stopPropagation(){}};
        node.handlers.click?.call(owner,event);
        // Model only the declarative native button default; not browser proof.
        const target=this.nodes.find(candidate=>candidate.attributes.id===node.attributes.popovertarget);
        if(!prevented&&target){if(target.matches(":popover-open"))target.hidePopover();else target.showPopover();}
      };
      node.querySelector = selector => this.query(owner, selector)[0] ?? null;
      node.focus = () => this.fixture.trace.push("focus:" + (node.attributes.class ?? node.tag));
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


const { FormaUiPopover } = await loadActual("src/components/design-system/feedback.ts");
const { PresentationDeck } = await loadActual("src/components/presentation-deck.ts");
const { DocumentArtifacts } = await loadActual("src/components/document-artifacts.ts");
const { GenerationInputDialog } = await loadActual("src/components/generation-input-dialog.ts");
const { VideoReferencePreflight } = await loadActual("src/components/video-reference-preflight.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const registry = { "forma-generation-input-dialog": GenerationInputDialog, "forma-video-reference-preflight": VideoReferencePreflight };

export function fixture(kind = "create", options = {}) {
  const state = { authorization: "actor-scope-a", canRead: true, canRequest: true, documentId: "A", required: true, events: [], content: {}, requests: [], saveConflict: false };
  const f = { state, locale: options.locale ?? "en", trace: [], clipboard: [], listeners: new Map(), changed: new Map(), steps: 0, requested: false };
  const messages = { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[f.locale] };
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) { event.callback({ locale: f.locale, formatLocale: f.locale, direction: f.locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 0 }, () => {}); return true; } });
  f.i18n.hostConnected();
  const append = (type, payload) => {
    const event = { eventId: "event-" + (state.events.length + 1), streamId: "stream", sequence: state.events.length + 1, actor: "user:owner", correlationId: "fixture", occurredAt: "2026-08-27T00:00:00Z", type, payload };
    state.events.push(event); return event;
  };
  append("ProjectCreated", { project_id: "p", name: "Dialog lifecycle fixture" });
  for (const id of ["A", "B"]) {
    append("DocumentCreated", { project_id: "p", document_id: id, title: "Document " + id });
    append("BlockCreated", { project_id: "p", document_id: id, block_id: "direction-" + id, type: "direction", handle: "direction/" + id, position: "a", properties: { text: "Keep all original evidence for " + id, intent: "include", weight: 1 } });
  }
  if (options.artifact) {
    const markdown = "Original saved manuscript for artifact-A.";
    state.content["content-A"] = JSON.stringify({ content_markdown: markdown, title: "Saved artifact A", summary: markdown, items: [] });
    state.content["input-A"] = JSON.stringify({ artifact_id: "artifact-A", document_id: "A", project_id: "p", render: { submitted_prompt: "EXACT PRIVATE PROMPT A\n".repeat(160) }, source_block_versions: [{ block_id: "direction-A", version: 1 }] });
    append("DocumentRenderCompleted", { project_id: "p", document_id: "A", artifact_id: "artifact-A", artifact_kind: "short_story", title: "Saved artifact A", summary: markdown, content_ref: "content-A", input_ref: "input-A", item_count: 0, items: [], requested_by_user_id: "owner" });
  }
  const projection = () => foldEvents(state.events, Infinity, state.documentId, "p");
  const commit = (id, markdown, extra = {}) => {
    const artifact = projection().libraryArtifacts.find(item => item.id === id);
    const revision = documentArtifactRevision(state.events, id) + 1;
    state.content[artifact.contentRef] = JSON.stringify({ content_markdown: markdown, title: artifact.title, summary: artifact.summary, items: [] });
    append("DocumentArtifactEdited", { project_id: "p", document_id: artifact.documentId, artifact_id: id, content_ref: artifact.contentRef, revision, changed_fields: ["content_markdown"], ...extra });
  };
  f.store = {
    ui: { instrumentation: false },
    session: { get: () => ({ user: { userId: "owner", role: "user" }, provider: { configured: true, videoConfigured: true, audioConfigured: true, model: "fixture-model" }, capabilities: [...(state.canRead ? ["project.read", "project.author"] : []), ...(state.canRequest ? ["project.output.request"] : [])] }) },
    captureAuthorizationScope: () => state.canRead ? { key: state.authorization, shared: false } : null,
    authorizationScopeActive: scope => state.canRead && scope?.key === state.authorization,
    projection: { get: projection }, events: { get: () => state.events }, eventView: { get: () => state.events }, asOf: cell(Infinity), content: { get: () => state.content }, head: { get: () => state.events.length },
    canvasProjection: cell({ selectedCanvasId: "", canvases: [] }), projectNotifications: cell([]), reviewInbox: cell([]), documentJobs: cell([]), generationReadiness: cell({}),
    route: { get: () => "/document/" + state.documentId }, documentRenderJobs: () => [],
    toast: message => f.trace.push("toast:" + message),
    ensurePrivateContent: async () => assert.fail("Private content must use the supplied exact fixture"),
    renderDocumentArtifact: async (...args) => { state.requests.push(args); return true; },
    reviseDocumentArtifact: async (id, input) => { assert.equal(input.expectedRevision, documentArtifactRevision(state.events, id)); if (state.saveConflict) return false; commit(id, input.markdown); return true; },
    restoreDocumentArtifact: async (id, revision, current) => { assert.equal(current, documentArtifactRevision(state.events, id)); commit(id, "Restored original manuscript.", { restored_from_revision: revision, revision_action: "restore" }); return true; },
    artifactRevisions: async id => ({ revisions: [{ revision: 0, current: false, available: true, kind: "initial", contentSha256: "original-exact-hash", createdAt: "2026-08-27T00:00:00Z" }, { revision: documentArtifactRevision(state.events, id), current: true, available: true, kind: "edit", contentSha256: "current-exact-hash", createdAt: "2026-08-27T00:01:00Z" }], nextBefore: null }),
  };
  installSourceOwnershipPort(f.store);
  f.renderer = new RendererPort(f, { ...registry, "forma-ui-popover": FormaUiPopover, "forma-presentation-deck": PresentationDeck });
  f.tick = async () => { const step = ++f.steps; await Promise.resolve(); options.onUpdate?.(f, step); f.draw(); return true; };
  f.workspace = { get updateComplete() { return f.tick(); } };
  activeFixture = f;
  f.host = kind === "receipt" ? new GenerationInputDialog() : new DocumentArtifacts();
  if (kind !== "receipt") { f.host.launcherOnly = true; f.host.documentId = "A"; }
  f.host.isConnected = true; f.host.connectedCallback();
  f.draw = () => { activeFixture = f; return f.renderer.draw(f.host); };
  f.flush = async () => { await new Promise(setImmediate); f.draw(); await Promise.resolve(); };
  f.changeDocument = id => { const previous = f.host.documentId; state.documentId = id; f.host.documentId = id; f.changed = new Map([["documentId", previous]]); };
  f.emitAuthorization = () => { activeFixture = f; for (const listener of [...(f.listeners.get("forma-authorization-changed") ?? [])]) listener(); };
  f.open = medium => f.host.openRender(medium, state.documentId, { current: () => state.required });
  f.createClose = async () => { await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === f.i18n.system("Close"))(); f.draw(); };
  f.receipt = id => artifactGenerationInputInspection({ id, documentId: "A", kind: "short_story", modelId: "fixture", inputRef: "input-" + id, settings: {} }, { ["input-" + id]: JSON.stringify({ artifact_id: id, document_id: "A", project_id: "p", render: { submitted_prompt: "EXACT PRIVATE PROMPT " + id + "\n" + "Every immutable sentence stays complete.\n".repeat(130) }, approved_execution_id: "paid-" + id }) });
  f.draw();
  return f;
}

test("inactive create and receipt hosts emit zero native controls; each original executor reappears on opening", async context => {
  const create = fixture(), receipt = fixture("receipt");
  receipt.host.inspection = receipt.receipt("A"); receipt.draw();
  assert.equal(create.renderer.controls("button"), 0); assert.equal(create.renderer.controls("select"), 0);
  assert.equal(receipt.renderer.controls("button"), 0); assert.equal(receipt.renderer.controls("textarea"), 0);
  assert.equal(await create.open("short_story"), true);
  assert.equal(create.renderer.controls("button"), 3);
  receipt.host.open = true; receipt.draw();
  assert.equal(receipt.renderer.controls("button"), 4);
  context.diagnostic("Actual in-memory owned subtrees: inactive 0+0 buttons; open create 3, open receipt 4. Not a whole-page/native count.");
  assert.equal(create.state.requests.length + receipt.state.requests.length, 0);
});

test("the actual create form retains audience, tone, and child editor identity while detached", async () => {
  const f = fixture(); assert.equal(await f.open("video"), true);
  const preflight = f.renderer.component("forma-video-reference-preflight", undefined); assert.ok(preflight);
  for (const [placeholder, value] of [["Festival audience, client team…", "Unfinished audience"], ["Let the document decide", "Unfinished tone"]]) {
    const input = f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === placeholder); assert.ok(input);
    input.handlers.input.call(f.host, { target: { value } });
  }
  f.draw(); const dialog = f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-create");
  await f.createClose();
  assert.equal(dialog.open, false); assert.equal(f.renderer.controls("button"), 0); assert.equal(preflight.isConnected, false);
  assert.equal(await f.open("video"), true);
  assert.equal(f.renderer.component("forma-video-reference-preflight", undefined), preflight);
  assert.equal(f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Festival audience, client team…").value, "Unfinished audience");
  assert.equal(f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Let the document decide").value, "Unfinished tone");
  assert.equal(f.state.requests.length, 0, "opening, closing, and re-entry never submit generation");
});

for (const change of ["document", "authority", "permission", "caller"]) test("visible create controls close before detachment after " + change + " invalidation", async () => {
  const f = fixture(); assert.equal(await f.open("short_story"), true);
  const dialog = f.renderer.ownNodes(f.host, "dialog")[0];
  if (change === "document") f.changeDocument("B");
  else if (change === "authority") f.state.authorization = "actor-scope-b";
  else if (change === "permission") f.state.canRequest = false;
  else f.state.required = false;
  f.draw();
  assert.equal(dialog.open, false);
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(f.renderer.controls("select"), 0);
  assert.equal(f.state.requests.length, 0);
});

test("the create opening guard still rejects a source change before the final render", async () => {
  const f = fixture("create", { onUpdate: (current, step) => { if (step === 3) current.state.events.find(event => event.type === "BlockCreated" && event.payload.document_id === "A").payload.properties.text = "Source changed while opening."; } });
  assert.equal(await f.open("short_story"), false);
  assert.equal(f.renderer.controls("button"), 0);
  assert.ok(!f.trace.some(entry => entry.startsWith("open:")));
  assert.equal(f.state.requests.length, 0);
});

test("receipt close and reopen retain exact immutable inputs and both copy executors", async () => {
  const f = fixture("receipt"), inspection = f.receipt("artifact-exact-A");
  f.host.inspection = inspection; f.host.open = true; f.draw();
  const dialog = f.renderer.ownNodes(f.host, "dialog")[0];
  const copies = f.renderer.ownNodes(f.host, "button").filter(node => node.attributes.class === "button secondary compact");
  await copies[0].handlers.click.call(f.host, {}); await copies[1].handlers.click.call(f.host, {});
  assert.deepEqual(f.clipboard, [inspection.prompt, JSON.stringify(inspection.receipt, null, 2)]);
  await f.renderer.handler(f.host, "button", node => node.attributes.class === "button primary")(); f.draw();
  assert.equal(dialog.open, false); assert.equal(f.renderer.controls("button"), 0);
  assert.equal(f.host.inspection, inspection);
  f.host.open = true; f.draw();
  assert.equal(f.renderer.controls("button"), 4);
  assert.equal(f.renderer.ownNodes(f.host, "textarea")[0].value, inspection.prompt);
  assert.equal(f.renderer.ownNodes(f.host, "textarea").at(-1).value, JSON.stringify(inspection.receipt, null, 2));
  assert.equal(f.state.requests.length, 0);
});

test("changing the selected receipt while closed cannot expose or copy the previous identity", async () => {
  const f = fixture("receipt"), previous = f.receipt("A"), current = f.receipt("B");
  f.host.inspection = previous; f.host.open = true; f.draw();
  f.host.open = false; f.draw(); f.host.inspection = current; f.draw();
  assert.equal(f.renderer.controls("button"), 0);
  f.host.open = true; f.draw();
  const copies = f.renderer.ownNodes(f.host, "button").filter(node => node.attributes.class === "button secondary compact");
  await copies[1].handlers.click.call(f.host, {});
  assert.equal(f.clipboard.at(-1), JSON.stringify(current.receipt, null, 2));
  assert.ok(f.renderer.ownNodes(f.host, "textarea").every(node => !node.value.includes('"artifact_id": "A"')));
});

for (const boundary of ["event", "scope", "disconnect"]) test("receipt private cache is scrubbed at the " + boundary + " boundary", () => {
  const f = fixture("receipt"); f.host.inspection = f.receipt("private-A"); f.host.open = true; f.draw();
  const dialog = f.renderer.ownNodes(f.host, "dialog")[0];
  if (boundary === "event") { f.state.authorization = "actor-scope-b"; f.emitAuthorization(); f.draw(); }
  else if (boundary === "scope") { f.state.authorization = "actor-scope-b"; f.draw(); }
  else { f.host.disconnectedCallback(); assert.equal(f.host.inspection, null); f.host.connectedCallback(); f.draw(); }
  assert.equal(dialog.open, false); assert.equal(f.host.inspection, null);
  assert.equal(f.renderer.controls("button"), 0); assert.equal(f.renderer.controls("textarea"), 0);
  f.host.open = true; f.draw();
  assert.equal(f.renderer.controls("button"), 0, "a fresh authorized receipt must be explicitly provided");
});

test("an explicitly submitted creation keeps the existing exact command and then removes its inactive controls", async () => {
  const f = fixture(); assert.equal(await f.open("short_story"), true);
  const form = f.renderer.ownNodes(f.host, "form").find(node => node.attributes.class === "document-artifact-dialog");
  await form.handlers.submit.call(f.host, { preventDefault() {} }); await f.flush();
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0][0], "short_story");
  assert.equal(f.state.requests[0][1].documentId, "A");
  assert.equal(f.renderer.controls("button"), 0);
});


test("the actual output viewer keeps exact Save and Restore semantics beside the inactive caches", async () => {
  const f = fixture("create", { artifact: true }), artifact = f.store.projection.get().libraryArtifacts.find(item => item.id === "artifact-A");
  assert.equal(await f.host.openArtifactById(artifact.id, { expectedRevision: 0 }), true);
  const view = () => f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-view");
  assert.ok(view()?.open);
  assert.equal(f.renderer.query(f.host, ".document-artifact-create").length, 0);
  const clickMethod = async method => {
    await f.renderer.handler(f.host, "button", node => typeof node.handlers.click === "function" && node.handlers.click.toString().includes(method))();
    await f.flush();
  };
  await clickMethod("#startArtifactEdit");
  const draft = "Keep every source-authorized correction.\n".repeat(80);
  const editor = f.renderer.ownNodes(f.host, "textarea").find(node => node.attributes.rows === "12"); assert.ok(editor);
  editor.handlers.input.call(f.host, { currentTarget: { value: draft } }); f.draw();
  await clickMethod("#saveArtifactEdit");
  assert.ok(view()?.open, "own Save never closes the opened output");
  assert.equal(documentArtifactRevision(f.state.events, artifact.id), 1);
  assert.equal(JSON.parse(f.state.content[artifact.contentRef]).content_markdown, draft);
  await clickMethod("#loadHistory");
  await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === "Restore revision 0")(); await f.flush();
  assert.ok(view()?.open, "own Restore never closes the opened output");
  assert.equal(documentArtifactRevision(f.state.events, artifact.id), 2);
  assert.equal(f.state.events.at(-1).payload.restored_from_revision, 0);
  assert.equal(JSON.parse(f.state.content[artifact.contentRef]).content_markdown, "Restored original manuscript.");
  await f.renderer.handler(f.host, "button", node => node.attributes["aria-label"] === "Close")(); f.draw();
  assert.equal(await f.host.openArtifactById(artifact.id, { expectedRevision: 0 }), false, "re-entry cannot substitute a newer revision for an exact old target");
  assert.equal(await f.host.openArtifactById(artifact.id, { expectedRevision: 2 }), true);
  assert.ok(view()?.open);
  assert.equal(f.state.requests.length, 0);
});

test("a conflicting Save preserves the full unsaved output in the still-open actual viewer", async () => {
  const f = fixture("create", { artifact: true }), artifact = f.store.projection.get().libraryArtifacts[0];
  assert.equal(await f.host.openArtifactById(artifact.id), true);
  await f.renderer.handler(f.host, "button", node => node.handlers.click?.toString().includes("#startArtifactEdit"))(); f.draw();
  const draft = "Do not lose this uncommitted manuscript.\n".repeat(90);
  f.renderer.ownNodes(f.host, "textarea").find(node => node.attributes.rows === "12").handlers.input.call(f.host, { currentTarget: { value: draft } }); f.draw();
  f.state.saveConflict = true;
  await f.renderer.handler(f.host, "button", node => node.handlers.click?.toString().includes("#saveArtifactEdit"))(); await f.flush();
  assert.ok(f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-view")?.open);
  assert.equal(f.renderer.ownNodes(f.host, "textarea").find(node => node.attributes.rows === "12").value, draft);
  assert.equal(documentArtifactRevision(f.state.events, artifact.id), 0);
  assert.equal(f.state.requests.length, 0);
});


test("a queued receipt close event cannot close a reopened or newly selected receipt", () => {
  const f = fixture("receipt"); f.host.inspection = f.receipt("A"); f.host.open = true; f.draw();
  const old = f.renderer.ownNodes(f.host, "dialog")[0];
  f.host.open = false; f.draw(); f.host.inspection = f.receipt("B"); f.host.open = true; f.draw();
  old.handlers.close.call(f.host, { target: old, currentTarget: old }); f.draw();
  assert.equal(f.host.open, true);
  assert.equal(f.host.inspection.receipt.artifact_id, "B");
  const current = f.renderer.ownNodes(f.host, "dialog")[0]; current.open = false;
  current.handlers.close.call(f.host, { target: current, currentTarget: current }); f.draw();
  assert.equal(f.host.open, false); assert.equal(f.renderer.controls("button"), 0);
});

test("a queued create close event cannot dismiss a new opening, while native dismissal still closes it", async () => {
  const f = fixture(); assert.equal(await f.open("short_story"), true);
  const old = f.renderer.ownNodes(f.host, "dialog")[0];
  await f.createClose(); assert.equal(await f.open("short_story"), true);
  old.handlers.close.call(f.host, { target: old, currentTarget: old }); f.draw();
  assert.ok(f.renderer.ownNodes(f.host, "dialog")[0]?.open);
  const current = f.renderer.ownNodes(f.host, "dialog")[0]; current.open = false;
  current.handlers.close.call(f.host, { target: current, currentTarget: current }); f.draw();
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(f.state.requests.length, 0);
});

test("authorization change clears private creation text before another actor can reopen it", async () => {
  const f = fixture(); assert.equal(await f.open("short_story"), true);
  const field = f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Festival audience, client team…");
  field.handlers.input.call(f.host, { target: { value: "PRIVATE ACTOR A AUDIENCE" } }); f.draw();
  f.state.authorization = "actor-scope-b"; f.emitAuthorization(); f.draw();
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(await f.open("short_story"), true);
  assert.equal(f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Festival audience, client team…").value, "");
  assert.equal(f.state.requests.length, 0);
});


test("creation rechecks the current authority even when its invalidation event has not arrived", async () => {
  const f = fixture(); assert.equal(await f.open("short_story"), true);
  const field = f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Let the document decide");
  field.handlers.input.call(f.host, { target: { value: "PRIVATE ACTOR A TONE" } }); f.draw();
  f.state.authorization = "actor-scope-b"; f.draw();
  assert.equal(f.renderer.controls("button"), 0);
  assert.equal(await f.open("short_story"), true);
  assert.equal(f.renderer.ownNodes(f.host, "input").find(node => node.attributes.placeholder === "Let the document decide").value, "");
});


for (const locale of ["en", "fr", "ar", "ja"]) test("cached dialog templates localize their actual labels and preserve authored drafts and receipts in " + locale, async () => {
  const create = fixture("create", { locale });
  assert.equal(await create.open("short_story"), true);
  const expectedTitle = localeCatalogs[locale][formaSystemMessageId("Create another form of this work")];
  assert.ok(expectedTitle);
  assert.ok(create.renderer.markup.includes("<h2 id=\"document-artifact-create-title\">" + expectedTitle + "</h2>"));
  const closeLabel = locale === "en" ? "Close" : localeCatalogs[locale]["action.close"];
  assert.ok(create.renderer.ownNodes(create.host, "button").some(node => node.attributes["aria-label"] === closeLabel));
  const audience = () => create.renderer.ownNodes(create.host, "input").find(node => node.handlers.input?.toString().includes("#audience"));
  const authored = "Copy prompt — keep this exact unfinished wording.";
  audience().handlers.input.call(create.host, { target: { value: authored } }); create.draw();
  await create.createClose();
  assert.equal(create.renderer.controls("button"), 0);
  assert.equal(await create.open("short_story"), true);
  assert.equal(audience().value, authored);
  assert.ok(create.renderer.markup.includes(expectedTitle));

  const receipt = fixture("receipt", { locale }), inspection = receipt.receipt("immutable-" + locale);
  receipt.host.inspection = inspection; receipt.host.open = true; receipt.draw();
  const verify = () => {
    for (const source of ["Copy prompt", "Copy receipt", "Complete input receipt"]) {
      const label = localeCatalogs[locale][formaSystemMessageId(source)];
      assert.ok(label, "actual " + locale + " catalog supplies " + source);
      assert.ok(receipt.renderer.markup.includes(">" + label + "</"), "cached branch emits the translated static " + source);
    }
    assert.equal(receipt.renderer.ownNodes(receipt.host, "textarea")[0].value, inspection.prompt);
    assert.equal(receipt.renderer.ownNodes(receipt.host, "textarea").at(-1).value, JSON.stringify(inspection.receipt, null, 2));
    const closeReceiptLabel = localeCatalogs[locale][formaSystemMessageId("Close generation inputs")];
    assert.ok(closeReceiptLabel);
    assert.ok(receipt.renderer.ownNodes(receipt.host, "button").some(node => node.attributes["aria-label"] === closeReceiptLabel));
  };
  verify();
  await receipt.renderer.handler(receipt.host, "button", node => node.attributes.class === "button primary")(); receipt.draw();
  assert.equal(receipt.renderer.controls("button"), 0);
  receipt.host.open = true; receipt.draw(); verify();
  const copies = receipt.renderer.ownNodes(receipt.host, "button").filter(node => node.attributes.class === "button secondary compact");
  await copies[0].handlers.click.call(receipt.host, {}); await copies[1].handlers.click.call(receipt.host, {});
  assert.deepEqual(receipt.clipboard, [inspection.prompt, JSON.stringify(inspection.receipt, null, 2)]);
  assert.equal(create.state.requests.length + receipt.state.requests.length, 0);
});

test("the inactive-dialog fixture renders the actual Slides action popover and its property-only controls",async()=>{
  const f=fixture("create",{artifact:true});
  f.state.events.find(event=>event.type==="DocumentRenderCompleted").payload.artifact_kind="slides";
  assert.equal(await f.host.openArtifactById("artifact-A"),true);await f.flush();
  const popover=f.renderer.query(f.host,"forma-ui-popover").find(node=>node.attributes.class==="artifact-viewer-actions-popover");
  assert.ok(popover instanceof FormaUiPopover);
  const panel=f.renderer.ownNodes(popover,"section").find(node=>node.attributes.popover==="auto");
  const trigger=f.renderer.ownNodes(popover,"button").find(node=>node.attributes.popovertarget===panel?.attributes.id);
  assert.ok(panel&&trigger);assert.ok(popover.content?.strings);
  assert.ok(f.renderer.ownNodes(popover,"button").some(node=>!node.attributes.popovertarget));
  assert.equal(f.state.requests.length,0);
});

test("the inactive-dialog fixture loads the actual deck and native Export invoker without authorizing a download",async()=>{
  const f=fixture("create",{artifact:true});
  const completed=f.state.events.find(event=>event.type==="DocumentRenderCompleted");
  completed.payload.artifact_kind="slides";
  const items=[{id:"native-slide-a",title:"Exact retained slide",body:"Exact retained evidence",notes:"",image_prompt:"",context_group_ids:[]}];
  completed.payload.items=items;completed.payload.item_count=1;
  f.state.content["content-A"]=JSON.stringify({...JSON.parse(f.state.content["content-A"]),items});
  assert.equal(await f.host.openArtifactById("artifact-A"),true);await f.flush();
  const deck=f.renderer.query(f.host,"forma-presentation-deck")[0];assert.ok(deck instanceof PresentationDeck);
  const trigger=f.renderer.ownNodes(deck,"button").find(node=>node.classList.contains("presentation-deck-export"));
  const panel=f.renderer.ownNodes(deck,"div").find(node=>node.attributes.id===trigger?.attributes.popovertarget);
  assert.ok(trigger&&panel);assert.equal(panel.attributes.popover,"auto");
  if(Object.hasOwn(trigger.attributes,"disabled"))assert.fail("fixture requires at least one exact retained slide");
  trigger.click();
  assert.equal(panel.matches(":popover-open"),true);assert.equal(f.state.requests.length,0);
});
