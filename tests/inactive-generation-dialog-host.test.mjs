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
// Lit's keyed directive compares reference keys by identity, never by their
// string representation. Keep existing primitive paths and owner/template scope.
const keyedObjectIds = new WeakMap();
let keyedObjectSequence = 0;
const keyedPath = key => {
  if (key === null || typeof key !== "object" && typeof key !== "function") return "/key:" + String(key);
  if (!keyedObjectIds.has(key)) keyedObjectIds.set(key, ++keyedObjectSequence);
  return "/key-object:" + keyedObjectIds.get(key);
};
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
// Forward the actual public identity-only predicate onto this existing native
// base port. Do not construct another Store or replace any component behavior.
const identityTree = syntax("src/components/forma-element.ts");
const identityOwner = identityTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaElement");
const identityMember = identityOwner?.members.find(node => ts.isMethodDeclaration(node) && node.name?.getText(identityTree) === "hasStoreIdentity"
  && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword));
assert.ok(identityMember, "the native base forwards the actual public FormaElement store-identity predicate");
const identityCode = ts.transpileModule("class FormaElementIdentityPort {" + identityMember.getText(identityTree) + "}", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const identityPort = new Function(identityCode + "; return FormaElementIdentityPort;")();
Object.defineProperty(ElementPort, "hasStoreIdentity", Object.getOwnPropertyDescriptor(identityPort, "hasStoreIdentity"));
const documentPort = { activeElement: null, documentElement: { lang: "en", dataset: {} }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null };
const windowPort = { requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
documentPort.defaultView=windowPort;
documentPort.addEventListener=(...args)=>windowPort.addEventListener(...args);
documentPort.removeEventListener=(...args)=>windowPort.removeEventListener(...args);
windowPort.innerWidth=1280;windowPort.innerHeight=720;
windowPort.getComputedStyle=()=>({width:"384px",getPropertyValue:()=>"0px",direction:activeFixture?.locale==="ar"?"rtl":"ltr"});
const modalPort = { ensureModalDialog(dialog) { if (!dialog) return false; if (!dialog.open) { dialog.open = true; activeFixture.trace.push("open:" + dialog.attributes.class); } return true; }, requestDialogText: async () => null };

async function loadActual(relative, literalImportDependencies = new Map()) {
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
  for (const [specifier, namespace] of literalImportDependencies) {
    let declared = false;
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === specifier) declared = true;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(declared && !dependencies.has(specifier), "only an actual literal dynamic import gains its module dependency");
    assert.equal(typeof namespace, "object");
    dependencies.set(specifier, namespace);
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
  reference(value, owner, part) { const id = this.bindings.push({ value, owner, part }) - 1; return "__bound_" + id + "__"; }
  resolve(value) { const exact = value.match(/^__bound_(\d+)__$/); if (exact) return this.bindings[Number(exact[1])]?.value; return value.replace(/__bound_(\d+)__/g, (_, id) => String(this.bindings[Number(id)]?.value ?? "")); }
  attrs(raw) {
    const attributes = {}, properties = {}, propertyParts = {}, handlers = {};
    for (const [, name, double, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = this.resolve(double ?? single ?? bare ?? "");
      if (name[0] === ".") {
        properties[name.slice(1)] = value;
        const reference = (double ?? single ?? bare ?? "").match(/^__bound_(\d+)__$/);
        if (reference) propertyParts[name.slice(1)] = this.bindings[Number(reference[1])]?.part;
      }
      else if (name[0] === "@") handlers[name.slice(1)] = value;
      else if (name[0] === "?") { if (value) attributes[name.slice(1)] = ""; }
      else if(value!==nothing) attributes[name] = value;
    }
    return { attributes, properties, propertyParts, handlers };
  }
  value(value, owner, path, caches = []) {
    if (value == null || value === nothing || typeof value === "boolean") return "";
    if (Array.isArray(value)) return value.map((item, index) => this.value(item, owner, path + "/" + index, caches)).join("");
    if (value?._$litDirective$ === keyedType) return this.value(value.values[1], owner, path + keyedPath(value.values[0]), caches);
    if (value?._$litDirective$ === cacheType) { this.activeCaches.add(path); return this.value(value.values[0], owner, path + "/cached", [...caches, path]); }
    if (value?._$litDirective$ === repeatType) { const [items, identify, render] = value.values; return [...items].map((item, index) => this.value(render(item, index), owner, path + "/repeat:" + identify(item, index), caches)).join(""); }
    if (!value?.strings) return escapeText(value);
    path += "/template:" + templateId(value.strings);
    let result = "";
    for (let index = 0; index < value.strings.length; index++) {
      result += value.strings[index];
      if (index < value.values.length) {
        const inTag = result.lastIndexOf("<") > result.lastIndexOf(">");
        result += inTag ? this.reference(value.values[index], owner, path + "/part:" + index) : this.value(value.values[index], owner, path + "/part:" + index, caches);
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
      // Mirror Lit's single-value PropertyPart committed value, not the child's
      // possibly changed property. Objects/functions still recommit by design.
      record.propertyValues ??= new Map();
      for (const [name, value] of Object.entries(props.properties)) {
        const previous = record.propertyValues.has(name) ? record.propertyValues.get(name) : nothing;
        const primitive = value === null || (typeof value !== "object" && typeof value !== "function");
        if (!primitive || (value !== previous && value !== lit.noChange)) {
          record.propertyValues.set(name, value);
          instance[name] = value === nothing ? undefined : value;
        }
      }
      if (!instance.isConnected) { instance.isConnected = true; instance.connectedCallback(); }
      // Lit evaluates willUpdate/render before committing this update's DOM.
      // Queries during those methods see only the prior committed tree.
      const previousOwner = this.updatingOwner;
      let rendered;
      this.updatingOwner = instance;
      try { instance.willUpdate?.(new Map()); rendered = instance.render(); }
      finally { this.updatingOwner = previousOwner; }
      const child = this.value(rendered, instance, id, caches);
      instance.markup = child;
      this.collect(child, instance);
      this.pendingUpdates.push({ instance, record });
      return "<" + tag + " data-rendered-port=\"true\"" + raw + ">" + child + content + "</" + tag + ">";
    });
    return result;
  }
  collect(markup, owner) {
    for (const [full, tag, raw] of markup.matchAll(/<([\w-]+)([^>]*)>/g)) {
      const parsed = this.attrs(raw), node = { tag, owner, ...parsed, full, open: Object.hasOwn(parsed.attributes, "open"), isConnected: true, value: parsed.attributes.value ?? "", checked: parsed.properties.checked ?? false };
      if (Object.hasOwn(parsed.properties, "value")) {
        // Reuse only the same existing owner/template/keyed-or-repeat part in
        // the previous committed tree. This preserves a property, not DOM/focus
        // identity, and cannot revive a field absent from the intervening tree.
        const part = parsed.propertyParts.value;
        const matches = part === undefined ? [] : (this.previousNodes ?? []).filter(previous =>
          previous.owner === owner && previous.tag === tag && previous.propertyParts?.value === part);
        const previous = matches.length === 1 ? matches[0] : null;
        node.committedValue = previous ? previous.committedValue : nothing;
        if (previous) node.value = previous.value;
        const value = parsed.properties.value;
        const primitive = value === null || (typeof value !== "object" && typeof value !== "function");
        // Same single-value PropertyPart predicate as component properties above.
        if (!primitive || (value !== node.committedValue && value !== lit.noChange)) {
          node.committedValue = value;
          node.value = value === nothing ? undefined : value;
        }
      }
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
        const event={type:"click",target:node,currentTarget:node,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,
          defaultPrevented:false,preventDefault(){prevented=true;this.defaultPrevented=true;},stopPropagation(){}};
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
    this.previousInstances = [...this.instances.values()].map(record => record.instance).filter(instance => instance.isConnected);
    this.pendingUpdates = [];
    this.nodes = []; this.bindings = []; this.activeCaches.clear(); this.seen.clear();
    host.isConnected = true;
    const changedProperties = this.fixture.changed ?? new Map();
    let rendered;
    this.updatingOwner = host;
    try { host.willUpdate?.(changedProperties); this.fixture.changed = new Map(); rendered = render(); }
    finally { this.updatingOwner = null; }
    this.markup = this.value(rendered, host, "host");
    host.markup = this.markup; this.collect(this.markup, host);
    for (const [id, record] of this.instances) if (!this.seen.has(id)) {
      if (record.instance.isConnected) { record.instance.isConnected = false; record.instance.disconnectedCallback(); }
      if (!record.caches.some(key => this.activeCaches.has(key))) this.instances.delete(id);
    }
    // Post-update hooks must not inspect a half-collected ancestor. Retire
    // removed ports before hooks; never transfer activeElement to a replacement.
    const present = new Set(this.nodes);
    for (const node of this.previousNodes) if (!present.has(node)) node.isConnected = false;
    const updates = this.pendingUpdates; this.pendingUpdates = [];
    for (const { instance, record } of updates) if (instance.isConnected) {
      if (!record.firstRendered) { record.firstRendered = true; instance.firstUpdated?.(); }
      instance.updated?.();
    }
    host.updated?.(changedProperties);
    return this.markup;
  }
  query(owner, selector) {
    if (selector.includes(",")) return selector.split(",").flatMap(part => this.query(owner, part.trim()));
    const within = candidate => { let current = candidate; while (current) { if (!owner || current === owner) return true; current = current.parentElement; } return false; };
    if (/^forma-/.test(selector)) return (this.updatingOwner ? this.previousInstances : [...this.instances.values()].map(record => record.instance)).filter(instance => instance.isConnected && within(instance.parentElement) && instance.tag === selector);
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
  const audience = () => create.renderer.ownNodes(create.host, "input").find(node => node.attributes.name === "audience");
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

test("finite native value PropertyPart preserves raw noChange values only for its existing committed part", () => {
  const f = { trace: [] }, renderer = new RendererPort(f, {}), owner = {};
  const field = value => lit.html`<input .value=${value}>`;
  const alternate = value => lit.html`<input class="alternate-template" .value=${value}>`;
  const draw = (template, host = owner) => {
    renderer.draw(host, () => template);
    return renderer.ownNodes(host, "input");
  };
  let node = draw(field("A"))[0]; assert.equal(node.value, "A");
  node.value = "  raw B 文書\nنور  ";
  node = draw(field(lit.noChange))[0];
  assert.equal(node.value, "  raw B 文書\nنور  ", "noChange must not be assigned as a native input value");
  assert.equal(draw(field(lit.noChange))[0].value, node.value, "repeated noChange retains the raw value");
  assert.equal(draw(field("A"))[0].value, node.value, "an unchanged committed primitive must not overwrite raw B");
  assert.equal(draw(field("C"))[0].value, "C", "a changed committed primitive still updates the native port");
  assert.equal(draw(field(nothing))[0].value, undefined, "PropertyPart commits undefined for nothing; no sentinel leaks");
  assert.equal(draw(field(lit.noChange))[0].value, undefined);
  assert.equal(draw(field("D"))[0].value, "D");
  assert.equal(draw(alternate(lit.noChange))[0].value, "", "another template cannot borrow D");
  node = draw(field("E"))[0]; node.value = "private raw E";
  draw(nothing);
  assert.equal(draw(field(lit.noChange))[0].value, "", "a removed field does not regain an old raw value");
  draw(field("F"))[0].value = "private raw F";
  assert.equal(draw(field(lit.noChange), {})[0].value, "", "a replacement owner cannot borrow F");
  const list = rows => repeat(rows, row => row.id, row => field(row.value));
  const originals = draw(list([{ id: "a", value: "A" }, { id: "b", value: "B" }]));
  originals[0].value = "raw A"; originals[1].value = "raw B";
  assert.deepEqual(draw(list([{ id: "b", value: lit.noChange }, { id: "a", value: lit.noChange }])).map(value => value.value),
    ["raw B", "raw A"], "existing repeat keys, not ordinal rows, own property continuity");
  draw(list([{ id: "b", value: lit.noChange }]));
  assert.deepEqual(draw(list([{ id: "a", value: lit.noChange }, { id: "b", value: lit.noChange }])).map(value => value.value),
    ["", "raw B"], "a reintroduced key is not a retained native field");
});

test("finite Shell command-trigger identity belongs to its exact current EventPart, not its class", { concurrency: false }, async t => {
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  // This is a renderer-port unit control, not a substitute Shell or browser
  // acceptance test. The four actual Assistant controls remain unchanged.
  const f = { trace: [], listeners: new Map(), store: {} }, owner = { tag: "forma-shell", store: f.store };
  f.renderer = new RendererPort(f, {});
  const native = installOutputNavigationFocusNative(t, f, { documentPort, ElementPort });
  const control = (name, click) => lit.html`<button type="button" class="command-trigger forma-global-search" aria-label=${name} @click=${click}>Command</button>`;
  const otherTemplate = (name, click) => lit.html`<span><button type="button" class="command-trigger forma-global-search" aria-label=${name} @click=${click}>Command</button></span>`;
  const draw = (template, host = owner) => {
    f.renderer.draw(host, () => template);
    return f.renderer.ownNodes(host, "button");
  };
  const calls = [], listener = () => {};
  const first = draw(control("Original", () => calls.push("old")))[0];
  first.addEventListener("fixture-listener", listener); native.focus(first);
  const same = draw(control("Updated", () => calls.push("current")))[0];
  assert.strictEqual(same, first); assert.equal(same.isConnected, true);
  assert.strictEqual(native.document.activeElement, same, "No activeElement reassignment is needed when the real part retains its node");
  assert.equal(same.attributes["aria-label"], "Updated"); assert.strictEqual(same.listeners["fixture-listener"], listener);
  same.handlers.click.call(owner, { target: same, currentTarget: same }); assert.deepEqual(calls, ["current"]);
  assert.equal(native.nativeFocus.length, 1, "A redraw emits no invented focus operation");
  const alternate = draw(otherTemplate("Updated", () => {}))[0];
  assert.notStrictEqual(alternate, first); assert.equal(first.isConnected, false);
  assert.strictEqual(native.document.activeElement, first, "Retirement does not remap activeElement to a lookalike");
  const returned = draw(control("Returned", () => {}))[0];
  assert.notStrictEqual(returned, first); assert.notStrictEqual(returned, alternate); assert.equal(alternate.isConnected, false);
  draw(nothing); assert.equal(returned.isConnected, false);
  const afterAbsence = draw(control("After absence", () => {}))[0]; assert.notStrictEqual(afterAbsence, returned);
  const otherOwner = { tag: "forma-shell", store: f.store }, replaced = draw(control("Owner B", () => {}), otherOwner)[0];
  assert.notStrictEqual(replaced, afterAbsence); assert.equal(afterAbsence.isConnected, false);
  const keyedA = draw(keyed("A", control("Key A", () => {})), otherOwner)[0];
  const keyedB = draw(keyed("B", control("Key B", () => {})), otherOwner)[0];
  assert.notStrictEqual(keyedA, keyedB); assert.equal(keyedA.isConnected, false);
  assert.notStrictEqual(draw(keyed("A", control("Key A again", () => {})), otherOwner)[0], keyedA);
  const unique = draw(control("Unique", () => {}), otherOwner)[0];
  assert.equal(draw([control("One", () => {}), control("Two", () => {})], otherOwner).length, 2);
  assert.equal(unique.isConnected, false, "An ambiguous same-class emission cannot retain the former anchor");
  const afterAmbiguity = draw(control("Unique again", () => {}), otherOwner)[0]; assert.notStrictEqual(afterAmbiguity, unique);
  otherOwner.store = {};
  assert.notStrictEqual(draw(control("Another Store", () => {}), otherOwner)[0], afterAmbiguity);
  assert.equal(afterAmbiguity.isConnected, false);
});

test("finite native ancestry reuses only the current structural snapshot and reads mutable state live", { concurrency: false }, async t => {
  const { fullPageTree, calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  // Direct renderer/native-port unit: no Store/Worker construction or app
  // callback, and no browser geometry/focus/AT or timing claim.
  const f = { trace: [], listeners: new Map(), timers: new Map(), store: {},
    storeHost: { document: {}, window: { ...ports.windowPort } } };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.host = new ports.ElementPort(); f.host.tag = "fixture-owner-a";
  f.renderer = new ports.RendererPort(f, {});
  let builds = 0;
  const originalTree = () => { builds++; return fullPageTree(f); };
  f.tree = originalTree;
  const native = installOutputNavigationFocusNative(t, f, ports);
  const view = () => lit.html`<section id="structure-root" class="structure-root"><dialog id="structure-dialog"><fieldset id="structure-fields"><legend><button id="structure-legend">Legend</button></legend><input id="structure-field"><button id="structure-action">Action</button></fieldset></dialog><div id="structure-panel" popover="auto"><button id="structure-panel-action">Panel action</button></div></section>`;
  const draw = () => f.renderer.draw(f.host, view);
  const current = () => Object.fromEntries(f.renderer.nodes.filter(node => node.owner === f.host && node.attributes.id)
    .map(node => [node.attributes.id.replace("structure-", ""), node]));
  draw(); let nodes = current();
  const answers = () => {
    assert.strictEqual(nodes.field.closest("fieldset"), nodes.fields);
    assert.strictEqual(nodes.field.closest("#structure-root"), nodes.root);
    assert.deepEqual(nodes.fields.querySelectorAll("button"), [nodes.legend, nodes.action]);
    assert.equal(nodes.field.matches(":disabled"), false);
    assert.equal(f.storeHost.window.getComputedStyle(nodes.field).visibility, "visible");
  };
  for (let index = 0; index < 8; index++) answers();
  assert.equal(builds, 1, "unchanged ancestry lookups share one fullPageTree reconstruction");
  assert.strictEqual(f.tree, originalTree, "the caller's complete tree/visibility reader is not replaced");
  nodes.field.value = "  retained raw B 文書  "; native.focus(nodes.field);
  nodes.dialog.open = true;
  assert.strictEqual(nodes.field.closest("[open]"), nodes.dialog);
  assert.deepEqual(f.renderer.query(null, "dialog[open]"), [nodes.dialog]);
  nodes.dialog.open = false;
  assert.equal(nodes.field.closest("[open]"), null);
  assert.deepEqual(f.renderer.query(null, "dialog[open]"), []);
  nodes.fields.hidden = true; assert.strictEqual(nodes.field.closest("[hidden]"), nodes.fields);
  nodes.fields.hidden = false; assert.equal(nodes.field.closest("[hidden]"), null);
  nodes.fields.setAttribute("disabled", "");
  assert.equal(nodes.field.matches(":disabled"), true);
  assert.equal(nodes.legend.matches(":disabled"), false, "the first legend exception uses current ancestry");
  nodes.fields.removeAttribute("disabled"); assert.equal(nodes.field.matches(":disabled"), false);
  nodes.fields.disabled = true; assert.equal(nodes.field.matches(":disabled"), true);
  nodes.fields.disabled = false;
  nodes.field.setAttribute("disabled", ""); assert.equal(nodes.field.matches(":disabled"), true);
  nodes.field.removeAttribute("disabled"); assert.equal(nodes.field.matches(":disabled"), false);
  nodes.root.setAttribute("class", "changed-live-class");
  assert.strictEqual(nodes.field.closest(".changed-live-class"), nodes.root);
  assert.equal(nodes.field.closest(".structure-root"), null);
  nodes.root.setAttribute("id", "changed-live-id");
  assert.strictEqual(nodes.field.closest("#changed-live-id"), nodes.root);
  assert.equal(nodes.field.closest("#structure-root"), null);
  nodes.dialog.setAttribute("style", "visibility: hidden; display: none;");
  assert.equal(f.storeHost.window.getComputedStyle(nodes.field).visibility, "hidden");
  assert.equal(f.storeHost.window.getComputedStyle(nodes.dialog).display, "none");
  nodes.dialog.removeAttribute("style");
  assert.equal(f.storeHost.window.getComputedStyle(nodes.field).visibility, "visible");
  assert.equal(f.storeHost.window.getComputedStyle(nodes.dialog).display, "block");
  nodes.panel.showPopover(); assert.equal(nodes.panel.matches(":popover-open"), true);
  nodes.panel.hidePopover(); assert.equal(nodes.panel.matches(":popover-open"), false);
  assert.equal(builds, 1, "no mutable visibility, disabled or style decision is cached");
  assert.equal(nodes.field.value, "  retained raw B 文書  ");
  assert.strictEqual(native.document.activeElement, nodes.field); assert.equal(native.nativeFocus.length, 1);
  assert.equal(f.tree().visible("input").length, 0);
  nodes.dialog.open = true; assert.equal(f.tree().visible("input").length, 1);
  assert.equal(builds, 3, "explicit full-tree callers still obtain fresh visibility on every read");
  const old = nodes, sameMarkup = f.renderer.markup;
  draw(); nodes = current(); answers();
  assert.equal(f.renderer.markup, sameMarkup); assert.equal(builds, 4, "even byte-identical redraws invalidate ancestry");
  assert.notStrictEqual(nodes.field, old.field); assert.equal(old.field.isConnected, false);
  assert.strictEqual(native.document.activeElement, old.field, "a retired active port is never remapped or resurrected");
  // Exercise the existing collect seam without draw: same array/length and
  // markup, but an actual replacement port. No semantic-ID identity reuse.
  const memberArray = f.renderer.nodes, replaced = nodes.field, position = memberArray.indexOf(replaced);
  f.renderer.collect(replaced.full, f.host);
  const replacement = memberArray.pop(); memberArray[position] = replacement; replaced.isConnected = false;
  nodes = current(); answers(); assert.equal(builds, 5);
  assert.strictEqual(f.renderer.nodes, memberArray); assert.equal(f.renderer.markup, sameMarkup);
  assert.notStrictEqual(replacement, replaced); assert.equal(replaced.closest("fieldset"), null);
  const removed = nodes.action;
  memberArray.splice(memberArray.indexOf(removed), 1); removed.isConnected = false;
  assert.equal(removed.closest("fieldset"), null); assert.equal(builds, 6);
  assert.deepEqual(nodes.fields.querySelectorAll("button"), [nodes.legend]);
  // Markup-only reparenting must invalidate the ancestry index independently
  // of the unchanged native membership array and port identities.
  f.renderer.markup = sameMarkup.replace(nodes.field.full, "").replace("</fieldset>", "</fieldset>" + nodes.field.full);
  assert.equal(nodes.field.closest("fieldset"), null);
  assert.strictEqual(nodes.field.closest("dialog"), nodes.dialog); assert.equal(builds, 7);
  const previousOwner = f.host;
  f.host = new ports.ElementPort(); f.host.tag = "fixture-owner-b";
  draw(); nodes = current(); answers(); assert.equal(builds, 8);
  assert.notStrictEqual(nodes.field.owner, previousOwner); assert.equal(replacement.isConnected, false);
  draw(); nodes = current(); answers(); assert.equal(builds, 9);
  assert.strictEqual(native.document.activeElement, old.field); assert.equal(native.nativeFocus.length, 1);
  assert.strictEqual(f.tree, originalTree);
});

test("finite literal presentation ancestry forwards compound closest, contains and its actual joined view", { concurrency: false }, async t => {
  const { fullPageTree, calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  const { navigationPresentationCurrent } = await import("../src/components/command-departure.ts");
  // Native-port unit only: the actual stateless structural helper consumes
  // the existing renderer's literal ancestry, not an application substitute.
  const f = { trace: [], listeners: new Map(), timers: new Map(), store: {},
    storeHost: { document: {}, window: { ...ports.windowPort } } };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.host = new ports.ElementPort(); f.host.tag = "fixture-presentation-owner";
  f.renderer = new ports.RendererPort(f, {}); f.tree = () => fullPageTree(f);
  const native = installOutputNavigationFocusNative(t, f, ports);
  const view = () => lit.html`<section id="presentation-root"><dialog id="presentation-owned" open aria-labelledby="presentation-title"><div id="presentation-body"><h2 id="presentation-title">Current inspection</h2><a id="presentation-trigger" href="/settings/workspaces">Open settings</a></div></dialog><dialog id="presentation-other" open aria-labelledby="other-title"><a id="presentation-sibling" href="/projects">Other destination</a></dialog><button id="presentation-outside">Outside</button></section>`;
  const draw = () => {
    f.renderer.draw(f.host, view);
    return Object.fromEntries(f.renderer.nodes.filter(node => node.attributes.id)
      .map(node => [node.attributes.id.replace("presentation-", ""), node]));
  };
  let nodes = draw();
  const witness = () => ({ owner: f.host, element: nodes.owned, trigger: nodes.trigger, current: () => true });
  assert.strictEqual(nodes.trigger.closest('dialog[aria-labelledby="presentation-title"]'), nodes.owned);
  assert.strictEqual(nodes.trigger.closest("dialog[open][aria-labelledby='presentation-title']"), nodes.owned);
  assert.equal(nodes.trigger.closest('dialog[aria-labelledby="other-title"]'), null);
  assert.equal(nodes.trigger.closest('section[aria-labelledby="presentation-title"]'), null);
  assert.strictEqual(nodes.owned.closest('dialog[aria-labelledby="presentation-title"]'), nodes.owned);
  assert.equal(nodes.owned.matches('[aria-labelledby="presentation-title"]'), true, "native matches must agree with the exact current sharing-label attribute");
  assert.equal(nodes.owned.matches("[aria-labelledby='presentation-title']"), true);
  assert.equal(nodes.owned.matches('dialog[aria-labelledby="presentation-title"]'), true);
  assert.equal(nodes.owned.matches('section[aria-labelledby="presentation-title"]'), false);
  assert.equal(nodes.owned.matches('[aria-labelledby="other-title"]'), false);
  assert.equal(nodes.owned.matches('[missing-attribute]'), false);
  assert.equal(nodes.owned.matches('dialog[open][aria-labelledby="presentation-title"]'), true);
  nodes.owned.open = false;
  assert.equal(nodes.owned.matches('dialog[open][aria-labelledby="presentation-title"]'), false, "current native open state, not a stale authored attribute");
  nodes.owned.open = true;
  nodes.owned.setAttribute("aria-labelledby", "changed-live-title");
  assert.equal(nodes.owned.matches('[aria-labelledby="presentation-title"]'), false);
  assert.equal(nodes.owned.matches('[aria-labelledby="changed-live-title"]'), true);
  nodes.owned.setAttribute("aria-labelledby", "presentation-title");
  assert.equal(nodes.owned.contains(nodes.trigger), true);
  assert.equal(nodes.body.contains(nodes.trigger), true);
  assert.equal(nodes.owned.contains(nodes.owned), true);
  assert.equal(nodes.owned.contains(nodes.sibling), false);
  assert.equal(nodes.owned.contains(nodes.outside), false);
  assert.equal(nodes.owned.contains(null), false);
  assert.strictEqual(nodes.trigger.ownerDocument, native.document);
  assert.strictEqual(native.document.defaultView, f.storeHost.window);
  assert.equal(nodes.owned.tagName, "DIALOG");
  assert.ok(nodes.owned.getClientRects().length > 0);
  assert.equal(native.document.defaultView.getComputedStyle(nodes.trigger).visibility, "visible");
  assert.equal(navigationPresentationCurrent(witness()), true, "the actual helper accepts this current finite native structure");
  nodes.body.setAttribute("inert", ""); assert.equal(navigationPresentationCurrent(witness()), false);
  nodes.body.removeAttribute("inert");
  nodes.body.hidden = true; assert.equal(navigationPresentationCurrent(witness()), false); nodes.body.hidden = false;
  nodes.trigger.setAttribute("aria-disabled", "true"); assert.equal(navigationPresentationCurrent(witness()), false); nodes.trigger.removeAttribute("aria-disabled");
  nodes.owned.setAttribute("style", "visibility: hidden;"); assert.equal(navigationPresentationCurrent(witness()), false); nodes.owned.removeAttribute("style");
  nodes.owned.close(); assert.equal(navigationPresentationCurrent(witness()), false); nodes.owned.open = true;
  assert.equal(navigationPresentationCurrent(witness()), true);
  assert.equal(navigationPresentationCurrent({ ...witness(), trigger: nodes.sibling }), false);
  const old = nodes, oldWitness = witness(); nodes = draw();
  assert.equal(old.trigger.isConnected, false); assert.notStrictEqual(nodes.trigger, old.trigger);
  assert.equal(nodes.owned.contains(old.trigger), false);
  assert.equal(navigationPresentationCurrent(oldWitness), false);
  assert.equal(navigationPresentationCurrent(witness()), true);
  const markup = f.renderer.markup;
  const opening = markup.indexOf(nodes.trigger.full), closing = markup.indexOf("</a>", opening);
  assert.ok(opening >= 0 && closing > opening, "the current actual anchor has a complete emitted closing tag");
  const triggerMarkup = markup.slice(opening, closing + "</a>".length);
  assert.equal(markup.split(triggerMarkup).length, 2, "the complete current anchor is unique before reparenting");
  f.renderer.markup = markup.replace(triggerMarkup, "").replace("</section>", triggerMarkup + "</section>");
  assert.equal(nodes.owned.contains(nodes.trigger), false, "current markup ancestry, not the flattened owner, controls literal containment");
  assert.equal(nodes.trigger.closest('dialog[aria-labelledby="presentation-title"]'), null);
  assert.equal(navigationPresentationCurrent(witness()), false);
  assert.equal(native.nativeFocus.length, 0, "no native field or focus is moved to satisfy a presentation contract");
});

test("finite native text selection resolves current descendants without changing raw value or native focus", { concurrency: false }, async t => {
  const { fullPageTree, calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  // Direct existing-renderer unit only. It supplies the native selection span,
  // not browser selection events, physical focus, an application or a Store.
  const f = { trace: [], listeners: new Map(), timers: new Map(), store: {},
    storeHost: { document: {}, window: { ...ports.windowPort } } };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.host = new ports.ElementPort(); f.host.tag = "fixture-selection-owner-a";
  f.renderer = new ports.RendererPort(f, {}); f.tree = () => fullPageTree(f);
  const native = installOutputNavigationFocusNative(t, f, ports);
  const state = { mounted: true };
  const view = () => lit.html`<section><button id="selection-outside">Outside</button>
    ${state.mounted ? lit.html`<form id="selection-form" class="selection-editor"><label>Name<input id="selection-field" .value=${"A"}></label><textarea id="selection-area" .value=${"Initial note"}></textarea></form>` : nothing}
    <form id="selection-other-form" class="other-editor"><input id="selection-other" .value=${"Other owner field"}></form></section>`;
  const draw = () => { f.renderer.draw(f.host, view); return Object.fromEntries(f.renderer.nodes.filter(node => node.attributes.id)
    .map(node => [node.attributes.id.replace("selection-", ""), node])); };
  let nodes = draw();
  assert.strictEqual(f.host.querySelector(".selection-editor input"), nodes.field, "The class ancestor is not returned as its descendant input");
  assert.deepEqual(f.host.querySelectorAll(".selection-editor input"), [nodes.field]);
  assert.strictEqual(f.host.querySelector(".selection-editor textarea"), nodes.area);
  assert.equal(nodes["other-form"].querySelector(".selection-editor input"), null, "Literal-owner scoping excludes another form's current field");
  assert.equal(typeof nodes.form.select, "undefined", "An ancestor form must never impersonate text-selection IDL");
  assert.equal(typeof nodes.field.select, "function"); assert.equal(typeof nodes.area.select, "function");
  const raw = "  B 🧭 文書 العربية  "; nodes.field.value = raw;
  native.focus(nodes.outside); const active = native.document.activeElement, focusCount = native.nativeFocus.length;
  nodes.field.select();
  assert.equal(nodes.field.value, raw); assert.equal(nodes.field.selectionStart, 0); assert.equal(nodes.field.selectionEnd, raw.length);
  assert.equal(nodes.field.selectionDirection, "none");
  nodes.area.value = "  Note B\n第二行  "; nodes.area.select();
  assert.equal(nodes.area.selectionStart, 0); assert.equal(nodes.area.selectionEnd, nodes.area.value.length);
  assert.equal(nodes.area.value, "  Note B\n第二行  ");
  assert.strictEqual(native.document.activeElement, active); assert.equal(native.nativeFocus.length, focusCount,
    "Selection-span support does not fabricate a browser focus transfer");
  nodes.form.setAttribute("class", "renamed-editor");
  assert.equal(f.host.querySelector(".selection-editor input"), null);
  assert.strictEqual(f.host.querySelector(".renamed-editor input"), nodes.field, "Live class changes are not cached as selector answers");
  const old = nodes; state.mounted = false; nodes = draw();
  assert.equal(old.field.isConnected, false); assert.equal(f.host.querySelector(".selection-editor input"), null);
  old.field.select(); assert.equal(old.field.isConnected, false, "A retired field is not resurrected or rebound to a semantic ID");
  state.mounted = true; nodes = draw();
  assert.notStrictEqual(nodes.field, old.field); assert.strictEqual(f.host.querySelector(".selection-editor input"), nodes.field);
  assert.equal(nodes.field.value, "A", "Actual remount uses its declared current PropertyPart, not the retired raw field");
  const previousOwner = f.host;
  f.host = new ports.ElementPort(); f.host.tag = "fixture-selection-owner-b";
  const previousField = nodes.field; nodes = draw();
  assert.notStrictEqual(nodes.field.owner, previousOwner); assert.equal(previousField.isConnected, false);
  assert.strictEqual(f.host.querySelector(".selection-editor input"), nodes.field);
  assert.equal(previousOwner.querySelector(".selection-editor input"), null);
  assert.strictEqual(native.document.activeElement, active); assert.equal(native.nativeFocus.length, focusCount);
});

test("finite keyed object identity retains only the same owner's current keyed PropertyPart", () => {
  const f = { trace: [] }, renderer = new RendererPort(f, {}), owner = {};
  const firstKey = Object.freeze({ id: "same-inspector" }), otherKey = Object.freeze({ id: "same-inspector" });
  assert.notStrictEqual(firstKey, otherKey); assert.equal(String(firstKey), String(otherKey));
  const field = value => lit.html`<input .value=${value}>`;
  const draw = (key, value, host = owner) => {
    renderer.draw(host, () => keyed(key, field(value)));
    const fields = renderer.ownNodes(host, "input"); assert.equal(fields.length, 1);
    assert.strictEqual(fields[0].owner, host); assert.equal(fields[0].isConnected, true);
    return fields[0];
  };
  const active = documentPort.activeElement;
  let node = draw(firstKey, "Canonical A"); const firstPart = node.propertyParts.value;
  assert.equal(typeof firstPart, "string"); assert.equal(node.value, "Canonical A");
  node.value = "  unsent A 文書\nنور  ";
  const same = draw(firstKey, lit.noChange);
  assert.equal(same.propertyParts.value, firstPart);
  assert.equal(same.value, "  unsent A 文書\nنور  ", "The same object key retains this actual native PropertyPart's raw value");
  // Raw PropertyPart continuity is not a claim about native form/DOM lifetime.
  node = draw(otherKey, lit.noChange);
  assert.notEqual(node.propertyParts.value, firstPart, "Equal-shaped distinct object keys cannot alias through String(key)");
  assert.equal(node.value, "", "A replacement keyed subtree cannot borrow the prior inspector's unsent value");
  assert.equal(same.isConnected, false);
  node = draw(otherKey, "Canonical B"); node.value = "unsent B";
  node = draw(firstKey, lit.noChange);
  assert.equal(node.value, "", "Returning to an old object key does not resurrect its earlier raw subtree");
  node.value = "removed raw"; renderer.draw(owner, () => nothing);
  assert.equal(node.isConnected, false);
  node = draw(firstKey, lit.noChange);
  assert.equal(node.value, "", "An absent keyed field cannot regain its old raw value");
  node.value = "prior owner raw";
  const replacement = draw(firstKey, lit.noChange, {});
  assert.equal(replacement.value, "", "Key identity never overrides the existing exact owner boundary");
  assert.equal(node.isConnected, false);
  assert.strictEqual(documentPort.activeElement, active); assert.deepEqual(f.trace, [], "Key projection never invokes or remaps focus");
});


test("finite submit form retention follows the current owner template and object key", async t => {
  const { retainNativeSubmitForms } = await import("./helpers/deferred-focus-invokers.mjs");
  const f = { trace: [] }, previousFixture = activeFixture;
  activeFixture = f; t.after(() => { activeFixture = previousFixture; });
  const owner = new ElementPort(); owner.isConnected = true; owner.tag = "fixture-form-owner-a";
  const owners = new Set([owner]);
  f.renderer = new RendererPort(f, {});
  retainNativeSubmitForms(f, owners, form => form.classList.contains("layer-inspector"));
  const firstKey = {}, otherKey = {}, calls = [];
  const view = (key, value, submit) => lit.html`<section>${keyed(key, lit.html`<form class="layer-inspector" id="same-form" @submit=${submit}><input .value=${value}></form>`)}</section>`;
  const otherView = (key, value, submit) => lit.html`<aside>${keyed(key, lit.html`<form class="layer-inspector" id="same-form" @submit=${submit}><input .value=${value}></form>`)}</aside>`;
  const draw = (template, host = owner) => {
    f.renderer.draw(host, () => template);
    const forms = f.renderer.ownNodes(host, "form"), fields = f.renderer.ownNodes(host, "input");
    assert.equal(forms.length, 1); assert.equal(fields.length, 1);
    assert.strictEqual(forms[0].owner, host); assert.equal(forms[0].isConnected, true);
    return { form: forms[0], field: fields[0] };
  };
  const firstSubmit = function(event) { assert.strictEqual(this, owner); calls.push(["first", event.currentTarget]); };
  const currentSubmit = function(event) { assert.strictEqual(this, owner); calls.push(["current", event.currentTarget]); };
  const active = documentPort.activeElement;
  let current = draw(view(firstKey, "Canonical", firstSubmit));
  const original = current.form, query = original.querySelector, focus = original.focus;
  const listener = () => {}; original.addEventListener("fixture-original", listener);
  current.field.value = "  unsent native field  ";
  current = draw(view(firstKey, lit.noChange, currentSubmit));
  assert.strictEqual(current.form, original, "The same actual submit EventPart retains its native form");
  assert.strictEqual(current.form.querySelector, query); assert.strictEqual(current.form.focus, focus);
  assert.strictEqual(current.form.listeners["fixture-original"], listener, "Original native closures/listeners are not replaced with fresh-node closures");
  assert.strictEqual(current.form.handlers.submit, currentSubmit, "Current application event binding still updates");
  current.form.handlers.submit.call(owner, { type: "submit", target: current.form, currentTarget: current.form });
  assert.deepEqual(calls, [["current", original]]);
  assert.equal(current.field.value, "  unsent native field  ", "The existing PropertyPart, not a form raw cache, retains field value");
  current = draw(view(otherKey, lit.noChange, currentSubmit));
  assert.notStrictEqual(current.form, original); assert.equal(original.isConnected, false);
  assert.equal(current.field.value, "", "A changed actual object key cannot borrow old fields despite the same form ID");
  const keyedForm = current.form;
  current = draw(otherView(otherKey, lit.noChange, currentSubmit));
  assert.notStrictEqual(current.form, keyedForm); assert.equal(keyedForm.isConnected, false);
  const differentTemplate = current.form; f.renderer.draw(owner, () => nothing);
  assert.equal(differentTemplate.isConnected, false);
  current = draw(otherView(otherKey, lit.noChange, currentSubmit));
  assert.notStrictEqual(current.form, differentTemplate, "An absent form never revives from an old record");
  const priorOwnerForm = current.form, replacementOwner = new ElementPort();
  replacementOwner.isConnected = true; replacementOwner.tag = "fixture-form-owner-b"; owners.add(replacementOwner);
  current = draw(otherView(otherKey, lit.noChange, currentSubmit), replacementOwner);
  assert.notStrictEqual(current.form, priorOwnerForm); assert.equal(priorOwnerForm.isConnected, false);
  assert.strictEqual(current.form.owner, replacementOwner);
  assert.strictEqual(documentPort.activeElement, active); assert.deepEqual(f.trace, [], "Retention does not invoke or remap focus");
});

test("finite Library import dialog identity belongs only to its current keyed close EventPart", { concurrency: false }, async t => {
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  // Reuse the existing EventPart unit's renderer/native ports. These literal
  // owner/Store/template inputs qualify only the finite adapter, never actual
  // Library, Source, import, modal focus, permission, or receipt behavior.
  const f = { trace: [], listeners: new Map(), store: {} }, owner = { tag: "forma-library", store: f.store };
  const previousFixture = activeFixture; t.after(() => { activeFixture = previousFixture; });
  f.renderer = new RendererPort(f, {});
  const native = installOutputNavigationFocusNative(t, f, { documentPort, ElementPort });
  const dialog = (label, close) => lit.html`<dialog class="modal library-import-dialog" aria-label=${label} @close=${close}></dialog>`;
  const view = (key, label, close, extra = nothing) => lit.html`${keyed(key, dialog(label, close))}${extra}`;
  const alternate = (key, label, close) => lit.html`<section>${view(key, label, close)}</section>`;
  const draw = (template, host = owner) => {
    f.renderer.draw(host, () => template); return f.renderer.ownNodes(host, "dialog");
  };
  const one = (template, host = owner) => {
    const nodes = draw(template, host); assert.equal(nodes.length, 1);
    assert.strictEqual(nodes[0].owner, host); assert.equal(nodes[0].isConnected, true); return nodes[0];
  };
  const replacement = (prior, template, host = owner) => {
    const next = one(template, host); assert.notStrictEqual(next, prior); assert.equal(prior.isConnected, false); return next;
  };
  const calls = [], noop = () => {}; let notifications = 0;
  const original = one(view(1, "Original", event => calls.push(["old", event.target, event.currentTarget])));
  assert.equal(original.open, false); assert.equal(Object.hasOwn(original.attributes, "open"), false);
  const close = original.close, setAttribute = original.setAttribute, focus = original.focus;
  const listener = () => { notifications++; }; original.addEventListener("close", listener);
  original.open = true; native.focus(original); // Explicit native-port inputs, not a browser showModal claim.
  const onClose = function(event) { assert.strictEqual(this, owner); calls.push(["current", event.target, event.currentTarget]); };
  const same = one(view(1, "Same appearance", onClose));
  assert.strictEqual(same, original); assert.equal(same.open, true);
  assert.equal(same.attributes["aria-label"], "Same appearance"); assert.strictEqual(same.handlers.close, onClose);
  assert.strictEqual(same.close, close); assert.strictEqual(same.setAttribute, setAttribute); assert.strictEqual(same.focus, focus);
  assert.strictEqual(same.listeners.close, listener); assert.strictEqual(native.document.activeElement, original);
  same.setAttribute("data-native-probe", "original"); assert.equal(original.attributes["data-native-probe"], "original");
  same.close(); assert.equal(original.open, false); assert.equal(notifications, 1);
  assert.deepEqual(calls, [["current", original, original]], "The retained original close method invokes the current binding with its own node");
  assert.strictEqual(one(view(1, "Same appearance", onClose)), original); assert.equal(original.open, false);

  const differentTemplate = replacement(original, alternate(1, "Same appearance", noop));
  const returned = replacement(differentTemplate, view(1, "Same appearance", noop));
  assert.notStrictEqual(returned, original, "Returning template identity cannot revive the earlier removed node");
  assert.deepEqual(draw(nothing), []); assert.equal(returned.isConnected, false);
  const afterAbsence = replacement(returned, view(1, "Same appearance", noop));
  const keyTwo = replacement(afterAbsence, view(2, "Same appearance", noop));
  const keyOneAgain = replacement(keyTwo, view(1, "Same appearance", noop));
  assert.notStrictEqual(keyOneAgain, afterAbsence, "A-B-A keys cannot revive the first keyed node");
  const otherOwner = { tag: "forma-library", store: f.store };
  const ownerChanged = replacement(keyOneAgain, view(1, "Same appearance", noop), otherOwner);
  otherOwner.store = {};
  const storeChanged = replacement(ownerChanged, view(1, "Same appearance", noop), otherOwner);

  // The first dialog stays at the exact same EventPart; only a same-owner
  // second dialog is added, so this reaches the ambiguity guard itself.
  const ambiguous = draw(view(1, "Same appearance", noop, keyed(2, dialog("Same appearance", noop))), otherOwner);
  assert.equal(ambiguous.length, 2); assert.equal(storeChanged.isConnected, false);
  assert.ok(ambiguous.every(node => node.isConnected && node !== storeChanged));
  const afterAmbiguity = one(view(1, "Same appearance", noop), otherOwner);
  assert.notStrictEqual(afterAmbiguity, storeChanged);
  for (const prior of ambiguous) { assert.notStrictEqual(afterAmbiguity, prior); assert.equal(prior.isConnected, false); }

  // Same-template repeated draws must remain ordinary replacement outside
  // the keyed, unbound-open contract, including false-valued authored parts.
  const excluded = [
    () => dialog("Same appearance", noop),
    () => keyed(1, lit.html`<dialog class="modal library-import-dialog" open @close=${noop}></dialog>`),
    () => keyed(1, lit.html`<dialog class="modal library-import-dialog" ?open=${false} @close=${noop}></dialog>`),
    () => keyed(1, lit.html`<dialog class="modal library-import-dialog" .open=${false} @close=${noop}></dialog>`),
  ];
  for (const template of excluded) {
    const prior = one(template(), otherOwner); prior.open = true;
    replacement(prior, template(), otherOwner);
  }
  assert.strictEqual(native.document.activeElement, original, "Retirement never transfers focus to a same-looking replacement");
  assert.equal(original.isConnected, false); assert.equal(native.nativeFocus.length, 1); assert.equal(native.nativeScroll.length, 0);
});


const requestField=(f,name)=>f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.name===name);
const setRequestField=(f,name,value)=>{requestField(f,name).handlers.input.call(f.host,{target:{value}});f.draw();};
const requestPrimary=f=>f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.type!=="button"&&String(node.attributes.class).includes("primary"));
function retainedRequestFixture(f,id,tone){
  const job={jobId:id,documentId:"A",kind:"render_document",status:"failed",sourceSurface:"document",stage:"planning",requestKey:id,requestedAt:"2026-09-02T12:00:00Z",dismissedAt:null,
    result:{artifactKind:"slides",generationReceipt:{input_ref:id+"-input",provider_request_status:"not_submitted",source_transmission_status:"not_transmitted",settled_cost_microusd:0}},
    error:"document_render_guidance_too_long",errorDetail:{code:"document_render_guidance_too_long",category:"provider",scope:"request",action:"edit_request",message:"Invalid guidance",retryable:false,httpStatus:400,retryAfterMs:null,requestId:null}};
  f.state.content[id+"-input"]=JSON.stringify({job_id:id,document_id:"A",artifact_kind:"slides",request:{audience:"Saved slideshow audience",tone,production_mode:"manual",requested_slide_count:6,presentation_style:"field-notes",presentation_fidelity:"faithful"}});
  return job;
}
const reviewControls=f=>f.renderer.ownNodes(f.host,"button").filter(node=>node.handlers.click?.toString().includes("#prepareRetry("));

test("request drafts isolate guidance and production settings across formats without forgetting same-format work",async()=>{
  const f=fixture();await f.open("audio");const mode=value=>f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.name==="artifact-production-mode"&&node.attributes.value===value);mode("managed").handlers.change.call(f.host,{});f.draw();setRequestField(f,"audience","Podcast audience");setRequestField(f,"tone","Podcast tone");await f.createClose();
  await f.open("slides");assert.equal(mode("manual").checked,true);const slideCount=()=>f.renderer.ownNodes(f.host,"select").find(node=>node.handlers.change?.toString().includes("#itemCount"));slideCount().handlers.change.call(f.host,{target:{value:"5"}});f.draw();assert.equal(requestField(f,"audience").value,"");assert.equal(requestField(f,"tone").value,"");setRequestField(f,"tone","Slideshow tone");await f.createClose();
  await f.open("audio");assert.equal(mode("managed").checked,true);assert.equal(requestField(f,"tone").value,"Podcast tone");await f.createClose();
  await f.open("slides");assert.equal(slideCount().value,"5");assert.equal(mode("manual").checked,true);assert.equal(requestField(f,"tone").value,"Slideshow tone");assert.equal(f.state.requests.length,0);
});

test("programmatic overlong input is blocked by actual submit handlers with field counters and errors",async()=>{
  const f=fixture();await f.open("slides");
  for(const [value,length] of [["x".repeat(121),121],["🎵".repeat(61),122]]){
    setRequestField(f,"tone",value);assert.equal(requestField(f,"tone").attributes["aria-invalid"],"true");assert.ok(f.renderer.markup.includes(length+"/120"));assert.ok(Object.hasOwn(requestPrimary(f).attributes,"disabled"));
    await f.renderer.handler(f.host,"form",node=>node.attributes.class==="document-artifact-dialog","submit")();assert.equal(f.state.requests.length,0);
  }
  setRequestField(f,"tone","  "+"🎵".repeat(60)+"  ");assert.equal(requestField(f,"tone").attributes["aria-invalid"],"false");assert.equal(Object.hasOwn(requestPrimary(f).attributes,"disabled"),false);
  await f.renderer.handler(f.host,"form",node=>node.attributes.class==="document-artifact-dialog","submit")();assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0][1].tone,"🎵".repeat(60));
});

test("failed slideshow review loads that attempt's frozen settings and discloses new paid/current-source submission",async()=>{
  const f=fixture();await f.open("audio");setRequestField(f,"tone","Podcast tone");await f.createClose();
  const job=retainedRequestFixture(f,"selected-slides","Frozen slideshow tone"),reads=[];f.store.documentJobs.set([job]);f.store.loadDocumentJobDetail=async id=>{reads.push(id);return job;};f.host.launcherOnly=false;f.draw();
  assert.equal(reviewControls(f).length,1);await reviewControls(f)[0].handlers.click.call(f.host,{});f.draw();
  assert.deepEqual(reads,[job.jobId]);assert.equal(requestField(f,"tone").value,"Frozen slideshow tone");assert.equal(requestField(f,"audience").value,"Saved slideshow audience");assert.ok(f.renderer.markup.includes("This is a new paid request using the current authorized document source."));assert.ok(f.renderer.markup.includes(job.jobId));assert.equal(f.state.requests.length,0);
});

test("late failed-attempt receipt cannot replace a newer attempt or a close-and-reopen ABA",async()=>{
  const f=fixture(),a=retainedRequestFixture(f,"attempt-a","A tone"),b=retainedRequestFixture(f,"attempt-b","B tone"),pending=new Map();
  f.store.documentJobs.set([a,b]);f.store.loadDocumentJobDetail=id=>new Promise(resolve=>pending.set(id,resolve));f.host.launcherOnly=false;f.draw();
  const first=reviewControls(f)[0].handlers.click.call(f.host,{});f.draw();const second=reviewControls(f)[1].handlers.click.call(f.host,{});
  pending.get(b.jobId)(b);await second;f.draw();assert.equal(requestField(f,"tone").value,"B tone");pending.get(a.jobId)(a);await first;f.draw();assert.equal(requestField(f,"tone").value,"B tone");
  const late=reviewControls(f)[0].handlers.click.call(f.host,{});await f.createClose();await f.open("slides");setRequestField(f,"tone","New local edit");pending.get(a.jobId)(a);await late;f.draw();assert.equal(requestField(f,"tone").value,"New local edit");assert.equal(f.state.requests.length,0);
});

test("missing or mismatched private request receipts never substitute another output's settings",async()=>{
  const f=fixture(),job=retainedRequestFixture(f,"not-retained","Saved tone");delete f.state.content[job.jobId+"-input"];
  f.store.documentJobs.set([job]);f.store.loadDocumentJobDetail=async()=>job;f.host.launcherOnly=false;f.draw();await reviewControls(f)[0].handlers.click.call(f.host,{});f.draw();
  assert.equal(f.renderer.ownNodes(f.host,"dialog").some(node=>node.open),false);assert.ok(f.trace.some(value=>value.includes("original request settings are unavailable")));assert.equal(f.state.requests.length,0);
});


const savedReceiptControl=f=>f.renderer.ownNodes(f.host,"button").find(node=>node.handlers.click?.toString().includes("#checkSavedPresentationReceipt("));
for(const locale of["en","fr","ar","ja"])test("legacy failed Slides shows a separate localized no-generation receipt check "+locale,async()=>{
  const f=fixture("create",{locale}),job=retainedRequestFixture(f,"receipt-check-slides","Retained tone");f.store.documentJobs.set([job]);f.host.launcherOnly=false;
  let resolve,checks=0;const pending=new Promise(done=>{resolve=done;});
  f.store.checkSavedPresentationReceipt=async(id,options)=>{assert.equal(id,job.jobId);assert.equal(options.current(),true);checks++;return pending;};
  f.draw();const button=savedReceiptControl(f);assert.ok(button);assert.match(f.renderer.markup,new RegExp(f.i18n.system("Check saved receipt · no generation")));
  assert.ok(reviewControls(f).length,"changing the request remains a separate action");
  button.handlers.click.call(f.host);f.draw();assert.equal(checks,1);assert.equal(Object.hasOwn(savedReceiptControl(f).attributes,"disabled"),true);
  assert.ok(f.renderer.markup.includes(f.i18n.system("Checking saved receipt…")));
  resolve("operator_required");await f.flush();
  assert.ok(f.renderer.markup.includes(f.i18n.system("Manual review is required. No new generation was started. The original request is unchanged and any original budget hold remains retained.")));
  assert.equal(f.state.requests.length,0);assert.equal(f.store.documentJobs.get()[0],job);assert.equal(f.renderer.ownNodes(f.host,"dialog").filter(node=>node.open).length,0);
});

test("receipt check UI hides Output-bound and impersonated actions and retires late results across document ABA",async()=>{
  const f=fixture(),job=retainedRequestFixture(f,"receipt-aba","Tone");f.store.documentJobs.set([job]);f.host.launcherOnly=false;
  const session=f.store.session.get();let impersonating=false;f.store.session.get=()=>({...session,...(impersonating?{impersonation:{active:true}}:{})});
  f.store.documentJobs.set([{...job,sourceSurface:"outputs"}]);f.draw();assert.equal(savedReceiptControl(f),undefined);
  f.store.documentJobs.set([job]);impersonating=true;f.draw();assert.equal(savedReceiptControl(f),undefined);
  impersonating=false;let resolve,current;f.store.checkSavedPresentationReceipt=async(id,options)=>{current=options.current;return new Promise(done=>{resolve=done;});};
  f.draw();savedReceiptControl(f).handlers.click.call(f.host);f.draw();assert.equal(current(),true);
  f.changeDocument("B");f.draw();f.changeDocument("A");f.draw();assert.equal(current(),false);
  resolve("operator_required");await f.flush();
  assert.ok(!f.renderer.markup.includes(f.i18n.system("Manual review is required. No new generation was started. The original request is unchanged and any original budget hold remains retained.")));
  assert.equal(Object.hasOwn(savedReceiptControl(f).attributes,"disabled"),false);assert.equal(f.state.requests.length,0);
});

// Actual creation-form EventParts, opening guards and authored native controls;
// rectangles, native ancestry, activeElement and trusted-event flags below are
// explicit finite test inputs. They are not browser layout or input provenance.
// In particular, the existing renderer does not register the 3D editor: its
// saved failure rectangle is exercised on the real generic creation input.
async function createFocusCase(t, { medium = "short_story", locale = "en", targetTag = "input", roundMetrics = false } = {}) {
  const { retainNativeSubmitForms } = await import("./helpers/deferred-focus-invokers.mjs");
  const previous = { active: documentPort.activeElement, fixture: activeFixture,
    style: windowPort.getComputedStyle, height: windowPort.innerHeight, viewport: windowPort.visualViewport };
  t.after(() => { documentPort.activeElement = previous.active; activeFixture = previous.fixture;
    windowPort.getComputedStyle = previous.style; windowPort.innerHeight = previous.height;
    if (previous.viewport === undefined) delete windowPort.visualViewport; else windowPort.visualViewport = previous.viewport; });
  const f = fixture("create", { locale });
  retainNativeSubmitForms(f, new Set([f.host]), form => form.classList.contains("document-artifact-dialog"));
  assert.equal(await f.open(medium), true);
  const p = { f, scale: 1, targetScale: 1, top: 775.84375, height: 121.96875,
    footerTop: 820, footerBottom: 883, modal: true, visibleFocus: true,
    hidden: false, disabled: false, display: "block", visibility: "visible", outlineWidth: "3px", outlineOffset: "3px",
    scrolls: [], outerScrolls: [], forms: null, footers: null, path: null };
  const rect = (left, top, width, height) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height });
  const originals = new WeakMap();
  p.wire = () => {
    const nodes = f.renderer.ownNodes(f.host, "form");
    p.form = nodes.find(node => node.attributes.class === "document-artifact-dialog");
    p.dialog = f.renderer.ownNodes(f.host, "dialog").find(node => node.attributes.class === "document-artifact-create");
    assert.ok(p.form && p.dialog); assert.equal(p.dialog.open, true);
    const start = f.renderer.markup.indexOf(p.form.full), end = f.renderer.markup.indexOf("</form>", start);
    assert.ok(start >= 0 && end > start, "the actual current creation form is completely emitted");
    const formMarkup = f.renderer.markup.slice(start, end);
    p.footer = f.renderer.ownNodes(f.host, "footer").find(node => formMarkup.includes(node.full));
    assert.ok(p.footer); const footerStart = formMarkup.lastIndexOf(p.footer.full);
    const footerMarkup = formMarkup.slice(footerStart);
    p.target = targetTag === "input" ? requestField(f, "audience")
      : f.renderer.ownNodes(f.host, targetTag).find(node => formMarkup.includes(node.full));
    assert.ok(p.target && formMarkup.includes(p.target.full), "the target is emitted by the actual creation renderer");
    p.footerButton = f.renderer.ownNodes(f.host, "button").find(node => footerMarkup.includes(node.full));
    assert.ok(p.footerButton);
    const formNodes = new Set(f.renderer.nodes.filter(node => node.owner === f.host && formMarkup.includes(node.full)));
    const footerNodes = new Set(f.renderer.nodes.filter(node => node.owner === f.host && footerMarkup.includes(node.full)));
    for (const node of formNodes) {
      if (!originals.has(node)) originals.set(node, node.matches.bind(node));
      node.matches = selector => selector === ":focus-visible" ? p.visibleFocus && documentPort.activeElement === node
        : selector === ":disabled" ? p.disabled || node.disabled || Object.hasOwn(node.attributes, "disabled")
        : originals.get(node)(selector);
      node.closest = selector => {
        for (const part of selector.split(",").map(value => value.trim())) {
          if (part === "form" || part === "form.document-artifact-dialog" || part === ".document-artifact-dialog") return p.form;
          if (part === "dialog" || part === "dialog.document-artifact-create" || part === ".document-artifact-create") return p.dialog;
          if (part === "footer" && footerNodes.has(node)) return p.footer;
          if ((part === "[hidden]" || part === "[inert]" || /^\[aria-hidden=/.test(part)) && p.hidden) return p.form;
        }
        return null;
      };
      node.getClientRects = () => p.hidden || p.display === "none" ? [] : [node.getBoundingClientRect()];
      node.scrollIntoView = (...args) => p.outerScrolls.push({ node, args });
    }
    p.form.parentElement = p.dialog; p.footer.parentElement = p.form;
    p.dialog.matches = selector => selector === ":modal" ? p.modal && p.dialog.open : selector === "dialog";
    p.dialog.getClientRects = () => [p.dialog.getBoundingClientRect()];
    p.dialog.getBoundingClientRect = () => rect(64, 16, 1152, 868);
    p.dialog.offsetHeight = 868; p.dialog.clientTop = 1; p.dialog.clientHeight = 866;
    p.dialog.querySelectorAll = selector => {
      assert.ok(selector.includes("form"), "only the current dialog's form identity is requested");
      return p.forms ?? [p.form];
    };
    p.dialog.querySelector = selector => p.dialog.querySelectorAll(selector)[0] ?? null;
    p.dialog.contains = node => node === p.dialog || formNodes.has(node);
    p.form.getBoundingClientRect = () => rect(65, 17, 1150, 868);
    const metric = value => roundMetrics ? Math.round(value) : value;
    Object.defineProperty(p.form, "offsetHeight", { configurable: true, get: () => metric(868 / p.scale) });
    p.form.clientTop = 0;
    Object.defineProperty(p.form, "clientHeight", { configurable: true, get: () => metric(868 / p.scale) });
    Object.defineProperty(p.form, "scrollHeight", { configurable: true, get: () => metric(1979 / p.scale) });
    p.form.scrollTop = 0; p.form.scrollLeft = -13;
    p.form.querySelectorAll = selector => {
      assert.ok(selector.includes("footer"), "only this form's current footer is requested");
      return p.footers ?? [p.footer];
    };
    p.form.querySelector = selector => p.form.querySelectorAll(selector)[0] ?? null;
    p.form.contains = node => formNodes.has(node);
    p.form.scrollTo = options => { p.scrolls.push({ ...options }); p.form.scrollTop = options.top; };
    p.footer.contains = node => footerNodes.has(node);
    p.footer.getBoundingClientRect = () => rect(65, p.footerTop, 1150, p.footerBottom - p.footerTop);
    p.target.getBoundingClientRect = () => rect(130.78125, p.top - p.form.scrollTop * p.scale, 1018.421875, p.height);
    Object.defineProperty(p.target, "offsetHeight", { configurable: true, get: () => metric(p.height / p.targetScale) });
    windowPort.innerHeight = 900;
    windowPort.getComputedStyle = node => ({ display: p.display, visibility: p.visibility,
      overflowY: node === p.form ? "auto" : "visible", position: node === p.footer ? "sticky" : "static",
      outlineStyle: "solid", outlineWidth: p.outlineWidth, outlineOffset: p.outlineOffset,
      direction: locale === "ar" ? "rtl" : "ltr" });
    documentPort.activeElement = p.target;
    return p;
  };
  p.wire();
  p.invoke = (overrides = {}, handler = p.form.handlers.focusin) => {
    assert.equal(typeof handler, "function", "the actual current creation form binds focusin");
    const event = { type: "focusin", isTrusted: true, target: p.target, currentTarget: p.form,
      composedPath: () => p.path ?? [p.target, p.form, p.dialog, f.host, documentPort],
      preventDefault() { assert.fail("focus reveal must preserve native event defaults"); },
      stopPropagation() { assert.fail("focus reveal must preserve event propagation"); }, ...overrides };
    handler.call(f.host, event);
  };
  p.unchanged = operation => {
    const before = { active: documentPort.activeElement, value: p.target.value, requests: structuredClone(f.state.requests),
      events: structuredClone(f.state.events), trace: [...f.trace], markup: f.renderer.markup,
      requested: f.requested, left: p.form.scrollLeft, listeners: [...f.listeners].map(([key, values]) => [key, [...values]]) };
    operation();
    assert.strictEqual(documentPort.activeElement, before.active); assert.equal(p.target.value, before.value);
    assert.deepEqual(f.state.requests, before.requests); assert.deepEqual(f.state.events, before.events);
    assert.deepEqual(f.trace, before.trace); assert.equal(f.renderer.markup, before.markup);
    assert.equal(f.requested, before.requested); assert.equal(p.form.scrollLeft, before.left);
    assert.deepEqual([...f.listeners], before.listeners); assert.deepEqual(p.outerScrolls, []);
  };
  return p;
}

for (const medium of ["short_story", "slides", "audio", "video"]) test("creation focus reveals the saved footer obstruction through the actual " + medium + " form", async t => {
  const p = await createFocusCase(t, { medium }); p.target.value = "  Keep this raw 文書 draft  ";
  p.unchanged(() => p.invoke());
  assert.equal(p.scrolls.length, 1); assert.equal(p.scrolls[0].behavior, "instant");
  assert.ok(p.form.scrollTop >= 83.8125 && p.form.scrollTop < 85, "reveal is bounded near the obstruction, allowing conservative metric rounding");
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= p.footerTop, "the true complete outline clears the footer without a tolerance waiver");
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 17, "the opposite edge stays inside the true client box");
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 1, "already clear focus causes no extra scroll");
});

test("creation focus remeasures a wrapped footer and scaled readonly native target in RTL", async t => {
  const p = await createFocusCase(t, { locale: "ar" }); p.scale = 2; p.targetScale = 1.5;
  p.footerTop = 690; p.target.readOnly = true; p.target.value = "Exact read-only evidence العربية";
  p.unchanged(() => p.invoke());
  assert.ok(p.form.scrollTop >= 108.40625 && p.form.scrollTop < 110, "target outline uses its scale; scroll delta uses the form's scale");
  assert.ok(p.target.getBoundingClientRect().bottom + 9 <= p.footerTop);
  assert.ok(p.target.getBoundingClientRect().top - 9 >= 17);
  p.footerTop = 630; p.unchanged(() => p.invoke());
  assert.ok(p.form.scrollTop >= 138.40625 && p.form.scrollTop < 140, "current footer reflow is measured on the next focus transition");
  assert.ok(p.target.getBoundingClientRect().bottom + 9 <= p.footerTop);
  assert.ok(p.target.getBoundingClientRect().top - 9 >= 17);
  assert.equal(p.target.readOnly, true);
});

test("creation focus reveals an actual summary above the current client box and preserves clear focus", async t => {
  const p = await createFocusCase(t, { medium: "audio", targetTag: "summary" }); p.top = 150; p.height = 44; p.form.scrollTop = 180;
  p.unchanged(() => p.invoke()); assert.ok(p.form.scrollTop >= 126 && p.form.scrollTop <= 127);
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 17);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= p.footerTop);
  p.top = 300; p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 1);
  assert.equal(p.target.tagName, "SUMMARY");
});

test("creation focus intersects modal and visual viewport bounds and clamps finite scroll limits", async t => {
  const p = await createFocusCase(t); p.footerTop = 950; p.footerBottom = 1013;
  windowPort.visualViewport = { offsetTop: 40, height: 660 };
  p.unchanged(() => p.invoke()); assert.ok(p.form.scrollTop >= 203.8125 && p.form.scrollTop < 205);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= 700);
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 40);
  delete windowPort.visualViewport; p.form.scrollTop = 0; p.top = 2500;
  p.unchanged(() => p.invoke()); assert.equal(p.form.scrollTop, 1111, "best effort never exceeds this form's finite native range");
  assert.ok(p.target.getBoundingClientRect().bottom > 883, "clamping is not a false full-fit certificate");
});

test("creation focus keeps an oversized target stable instead of alternating edges", async t => {
  const p = await createFocusCase(t); p.top = 100; p.height = 1000;
  p.unchanged(() => p.invoke()); assert.equal(p.form.scrollTop, 77);
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 1);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 > p.footerTop, "an oversized envelope cannot fit the available lane");
});

test("creation focus excludes footer controls, untrusted events, invisible focus and invalid native geometry", async t => {
  const p = await createFocusCase(t);
  for (const [mutate, restore] of [
    [() => { p.visibleFocus = false; }, () => { p.visibleFocus = true; }],
    [() => { p.hidden = true; }, () => { p.hidden = false; }],
    [() => { p.disabled = true; }, () => { p.disabled = false; }],
    [() => { p.visibility = "hidden"; }, () => { p.visibility = "visible"; }],
    [() => { p.display = "none"; }, () => { p.display = "block"; }],
    [() => { p.scale = 0; }, () => { p.scale = 1; }],
    [() => { p.top = NaN; }, () => { p.top = 775.84375; }],
    [() => { p.modal = false; }, () => { p.modal = true; }],
    [() => { p.footers = []; }, () => { p.footers = null; }],
    [() => { p.footers = [p.footer, p.footer]; }, () => { p.footers = null; }],
    [() => { p.forms = [p.form, p.form]; }, () => { p.forms = null; }],
  ]) { mutate(); p.unchanged(() => p.invoke()); restore(); }
  p.unchanged(() => p.invoke({ isTrusted: false }));
  const target = p.target; p.target = p.footerButton; documentPort.activeElement = p.target;
  p.unchanged(() => p.invoke()); p.target = target; documentPort.activeElement = target;
  p.unchanged(() => p.invoke({ type: "input" }));
  assert.deepEqual(p.scrolls, []);
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 1, "each rejection leaves current ordinary focus usable");
});

test("creation focus refuses foreign focus, form, dialog and event-path owners", async t => {
  const p = await createFocusCase(t), target = p.target, form = p.form, dialog = p.dialog;
  const foreignForm = Object.assign(Object.create(ElementPort.prototype), { tagName: "FORM" });
  const foreignDialog = Object.assign(Object.create(ElementPort.prototype), { tagName: "DIALOG" });
  documentPort.activeElement = p.footerButton; p.unchanged(() => p.invoke()); documentPort.activeElement = target;
  p.unchanged(() => p.invoke({ currentTarget: p.footerButton }));
  p.path = [target, foreignForm, form, dialog, p.f.host, documentPort]; p.unchanged(() => p.invoke());
  p.path = [target, form, foreignDialog, dialog, p.f.host, documentPort]; p.unchanged(() => p.invoke()); p.path = null;
  form.parentElement = p.f.host; p.unchanged(() => p.invoke()); form.parentElement = dialog;
  Object.defineProperty(target, "ownerDocument", { configurable: true, value: {} }); p.unchanged(() => p.invoke()); delete target.ownerDocument;
  target.isConnected = false; p.unchanged(() => p.invoke()); target.isConnected = true;
  dialog.open = false; p.unchanged(() => p.invoke()); dialog.open = true;
  assert.deepEqual(p.scrolls, []);
});

test("creation focus rechecks the current opening and authorization before its only mutation", async t => {
  const p = await createFocusCase(t);
  const original = p.target.getBoundingClientRect;
  p.target.getBoundingClientRect = () => { const value = original(); p.f.state.required = false; return value; };
  p.unchanged(() => p.invoke()); assert.deepEqual(p.scrolls, []);
  p.target.getBoundingClientRect = original; p.f.state.required = true;
  p.f.state.authorization = "other-actor"; p.unchanged(() => p.invoke()); assert.deepEqual(p.scrolls, []);
});

test("creation focus uses the current retained form EventPart across format changes and retires closed openings", async t => {
  const p = await createFocusCase(t); const form = p.form, first = form.handlers.focusin;
  assert.equal(typeof first, "function");
  const change = kind => {
    const radio = p.f.renderer.ownNodes(p.f.host, "input").find(node => node.attributes.name === "artifact-kind" && node.attributes.value === kind);
    assert.ok(radio); radio.handlers.change.call(p.f.host, {}); p.f.draw(); p.wire();
    assert.strictEqual(p.form, form, "the actual submit EventPart retains this native form");
  };
  change("slides"); assert.notStrictEqual(p.form.handlers.focusin, first);
  p.unchanged(() => p.invoke({}, first)); assert.deepEqual(p.scrolls, [], "a prior format binding cannot reveal another format");
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 1);
  change("short_story"); assert.notStrictEqual(p.form.handlers.focusin, first);
  // There is no deferred focus callback or new epoch. Native EventPart delivery
  // uses the current binding; an artificially invoked old A closure after ABA
  // is deliberately not claimed to have monotonic lifetime protection.
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 2);
  const closed = p.form.handlers.focusin; await p.f.createClose(); await p.f.open("short_story"); p.wire();
  assert.notStrictEqual(p.form, form); assert.equal(form.isConnected, false);
  p.unchanged(() => p.invoke({}, closed)); assert.equal(p.scrolls.length, 2);
  p.unchanged(() => p.invoke()); assert.equal(p.scrolls.length, 3);
});

test("creation focus clears the full saved outline when native offsetHeight rounds to 122", async t => {
  const p = await createFocusCase(t, { roundMetrics: true });
  assert.equal(p.target.getBoundingClientRect().height, 121.96875); assert.equal(p.target.offsetHeight, 122);
  p.unchanged(() => p.invoke());
  const rect = p.target.getBoundingClientRect();
  assert.ok(rect.bottom + 6 <= p.footerTop, "the true six-pixel outline must be fully above the footer, including its last fraction");
  assert.ok(rect.top - 6 >= 17); assert.ok(Number.isFinite(p.form.scrollTop));
});

test("creation focus respects independent true target and form scales with integer native metrics", async t => {
  const p = await createFocusCase(t, { roundMetrics: true }); p.scale = 1.999; p.targetScale = 1.2;
  assert.equal(p.form.offsetHeight, 434); assert.equal(p.target.offsetHeight, 102);
  p.unchanged(() => p.invoke());
  const rect = p.target.getBoundingClientRect();
  assert.ok(rect.bottom + 7.2 <= p.footerTop, "clearance uses the true scaled outline, not the rounded-metric estimate");
  assert.ok(rect.top - 7.2 >= 17); assert.ok(Number.isFinite(p.form.scrollTop));
  assert.ok(p.form.scrollTop >= 0 && p.form.scrollTop <= p.form.scrollHeight - p.form.clientHeight);
});

test("creation focus preserves both true edges of a nearly fitting target with integer metrics", async t => {
  const p = await createFocusCase(t, { roundMetrics: true }); p.scale = 1.999; p.height = 789.75;
  p.top = p.footerTop - p.height - 6 + .25;
  assert.equal(p.target.offsetHeight, 790); assert.equal(p.form.offsetHeight, 434);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 > p.footerTop, "the true bottom edge starts obstructed");
  p.unchanged(() => p.invoke());
  const rect = p.target.getBoundingClientRect();
  assert.ok(rect.bottom + 6 <= p.footerTop, "the true bottom edge is revealed");
  assert.ok(rect.top - 6 >= 17, "conservative rounding must not push the opposite edge behind the client boundary");
  assert.ok(p.form.scrollTop > 0 && p.form.scrollTop < 1, "the nearly fitting envelope needs a bounded fractional scroll");
});

// Extend the same actual-form harness with authored audio DETAILS/SUMMARY.
// The finite envelope encloses P6's saved Arabic/touch summary and list boxes.
// Footer tops 625/630 are screenshot-informed finite inputs: no footer DOM
// rectangle was serialized. The observed dialog clip remains separately 783.
// This is not a rendered 3D editor, native toggle, or disclosure-layout certificate.
async function createDisclosureCase(t, { touch = false } = {}) {
  const p = await createFocusCase(t, { medium: "audio", locale: touch ? "en" : "ar", targetTag: "summary", roundMetrics: true });
  const focusWire = p.wire;
  p.top = touch ? 855.34375 : 732.96875; p.height = touch ? 51.1875 : 44;
  p.expandedHeight = touch ? 350.984375 : 304.421875;
  p.disclosureStyle = {}; p.summaries = null;
  const rect = (left, top, width, height) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height });
  p.wire = () => {
    focusWire();
    const markup = p.f.renderer.markup, formStart = markup.indexOf(p.form.full), summaryStart = markup.indexOf(p.target.full, formStart);
    const detailsStart = markup.lastIndexOf("<details", summaryStart), detailsEnd = markup.indexOf(">", detailsStart) + 1;
    assert.ok(formStart >= 0 && detailsStart > formStart && detailsEnd <= summaryStart);
    assert.equal(markup.slice(detailsEnd, summaryStart).trim(), "", "the authored summary is the direct first child of this actual details");
    const tag = markup.slice(detailsStart, detailsEnd);
    p.disclosure = p.f.renderer.ownNodes(p.f.host, "details").find(node => node.full === tag && p.form.contains(node));
    assert.ok(p.disclosure && p.form.contains(p.disclosure));
    p.disclosure.parentElement = p.form; p.target.parentElement = p.disclosure; p.disclosure.open = true;
    p.disclosure.querySelectorAll = selector => {
      assert.equal(selector, ":scope > summary", "only this disclosure's direct summaries are inspected");
      return p.summaries ?? [p.target];
    };
    p.disclosure.querySelector = selector => p.disclosure.querySelectorAll(selector)[0] ?? null;
    const closest = p.target.closest;
    p.target.closest = selector => {
      if (selector === '[hidden], [inert], [aria-hidden="true"]'
        && (Object.hasOwn(p.disclosure.attributes, "hidden") || Object.hasOwn(p.disclosure.attributes, "inert")
          || p.disclosure.attributes["aria-hidden"] === "true")) return p.disclosure;
      return closest(selector);
    };
    p.form.getBoundingClientRect = () => rect(17, touch ? 17 : 15, 286, 768);
    p.dialog.getBoundingClientRect = () => rect(16, 16, 288, 768);
    p.dialog.offsetHeight = 768; p.dialog.clientTop = 1; p.dialog.clientHeight = 766;
    Object.defineProperty(p.form, "offsetHeight", { configurable: true, get: () => Math.round(768 / p.scale) });
    Object.defineProperty(p.form, "clientHeight", { configurable: true, get: () => Math.round(768 / p.scale) });
    Object.defineProperty(p.form, "scrollHeight", { configurable: true, get: () => Math.round((touch ? 3539 : 3229) / p.scale) });
    p.form.scrollTop = touch ? 480 : 159;
    p.target.getBoundingClientRect = () => rect(47.59375, p.top - p.form.scrollTop * p.scale, 224.8125, p.height);
    p.disclosure.getBoundingClientRect = () => rect(47.59375, p.top - p.form.scrollTop * p.scale, 224.8125, p.expandedHeight);
    p.footerTop = touch ? 630 : 625; p.footerBottom = 783;
    windowPort.innerHeight = 800; windowPort.visualViewport = { offsetTop: 0, height: 800 };
    const getStyle = windowPort.getComputedStyle;
    windowPort.getComputedStyle = node => node === p.disclosure ? { ...getStyle(node), ...p.disclosureStyle } : getStyle(node);
    return p;
  };
  p.wire();
  p.invokeToggle = (overrides = {}, handler = p.form.handlers.toggle) => {
    assert.equal(handler.capture, true, "the actual form must capture native non-bubbling toggle");
    assert.equal(typeof handler.handleEvent, "function");
    handler.handleEvent({ type: "toggle", isTrusted: true, newState: "open", target: p.disclosure, currentTarget: p.form,
      composedPath: () => p.path ?? [p.disclosure, p.form, p.dialog, p.f.host, documentPort],
      preventDefault() { assert.fail("disclosure reveal must preserve native defaults"); },
      stopPropagation() { assert.fail("disclosure reveal must preserve event propagation"); }, ...overrides });
  };
  const unchanged = p.unchanged;
  p.unchanged = operation => {
    const open = p.disclosure.open, parent = p.target.parentElement;
    unchanged(operation); assert.equal(p.disclosure.open, open); assert.strictEqual(p.target.parentElement, parent);
  };
  return p;
}

test("creation disclosure reveals the saved Arabic list overflow while retaining the complete summary outline", async t => {
  const p = await createDisclosureCase(t), initialScroll = p.form.scrollTop;
  assert.equal(p.target.getBoundingClientRect().top, 573.96875); assert.equal(p.target.getBoundingClientRect().height, 44);
  assert.equal(p.disclosure.getBoundingClientRect().bottom, 878.390625);
  p.unchanged(() => p.invoke()); assert.deepEqual(p.scrolls, [], "the focused summary is already clear before expansion");
  p.unchanged(() => p.invokeToggle());
  assert.equal(p.scrolls.length, 1); assert.equal(p.scrolls[0].behavior, "instant");
  assert.ok(p.form.scrollTop >= initialScroll + 253.390625 && p.form.scrollTop < initialScroll + 257,
    "movement clears the tighter finite sticky footer, not merely the observed dialog clip");
  assert.ok(p.disclosure.getBoundingClientRect().bottom <= p.footerTop, "the complete expanded box clears the finite 625 footer boundary");
  const movement = p.form.scrollTop - initialScroll;
  for (const bottom of [704.421875, 750.984375, 797.546875, 863.796875]) {
    assert.ok(bottom - movement <= p.footerTop, "every saved suggestion text box clears the tighter footer boundary after movement");
  }
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 17);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= p.footerTop);
  p.unchanged(() => p.invokeToggle()); assert.equal(p.scrolls.length, 1, "the revealed disclosure stays stable");
});

test("creation disclosure reveals saved touch list geometry above a finite sticky footer despite fitting the dialog clip", async t => {
  const p = await createDisclosureCase(t, { touch: true }), initialScroll = p.form.scrollTop;
  assert.equal(p.target.getBoundingClientRect().top, 375.34375);
  assert.equal(p.disclosure.getBoundingClientRect().bottom, 726.328125);
  assert.ok(p.disclosure.getBoundingClientRect().bottom < 783 && p.disclosure.getBoundingClientRect().bottom > p.footerTop,
    "dialog-boundary clearance alone does not establish footer clearance");
  p.unchanged(() => p.invokeToggle());
  assert.equal(p.scrolls.length, 1); assert.ok(p.form.scrollTop >= initialScroll + 96.328125 && p.form.scrollTop < initialScroll + 100);
  assert.ok(p.disclosure.getBoundingClientRect().bottom <= p.footerTop);
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 17);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= p.footerTop);
  p.unchanged(() => p.invokeToggle()); assert.equal(p.scrolls.length, 1);
});

test("creation disclosure leaves saved touch geometry stationary in a separately declared clear finite lane", async t => {
  const p = await createDisclosureCase(t, { touch: true });
  // This finite unobstructed footer position is not the historical touch footer
  // and its stationarity is not established by the prior native test pass.
  p.footerTop = 783; p.footerBottom = 846;
  assert.equal(p.target.getBoundingClientRect().top, 375.34375);
  assert.equal(p.disclosure.getBoundingClientRect().bottom, 726.328125);
  p.unchanged(() => p.invokeToggle()); p.unchanged(() => p.invokeToggle());
  assert.deepEqual(p.scrolls, []); assert.equal(p.form.scrollTop, 480);
});

test("creation disclosure preserves visible summary focus when expanded content is taller than the available lane", async t => {
  const p = await createDisclosureCase(t); p.expandedHeight = 1000;
  p.unchanged(() => p.invokeToggle()); p.unchanged(() => p.invokeToggle());
  assert.deepEqual(p.scrolls, []); assert.equal(p.form.scrollTop, 159, "do not chase the bottom of an oversized disclosure");
  assert.ok(p.disclosure.getBoundingClientRect().bottom > p.footerTop, "native scrolling remains necessary; this is not a full-fit claim");
  p.top = 149; p.unchanged(() => p.invokeToggle());
  assert.equal(p.scrolls.length, 1); assert.ok(p.form.scrollTop < 159 && p.form.scrollTop > 120, "only the obstructed summary envelope is revealed");
  assert.ok(p.target.getBoundingClientRect().top - 6 >= 17);
  assert.ok(p.target.getBoundingClientRect().bottom + 6 <= p.footerTop);
  p.unchanged(() => p.invokeToggle()); assert.equal(p.scrolls.length, 1);
});

test("creation disclosure refuses closed, pointer-style, untrusted, hidden, inert and ambiguous expansions", async t => {
  const p = await createDisclosureCase(t);
  for (const [mutate, restore] of [
    [() => { p.disclosure.open = false; }, () => { p.disclosure.open = true; }],
    [() => { p.visibleFocus = false; }, () => { p.visibleFocus = true; }],
    [() => { p.target.attributes["aria-disabled"] = "true"; }, () => { delete p.target.attributes["aria-disabled"]; }],
    [() => { p.disclosure.attributes.hidden = ""; }, () => { delete p.disclosure.attributes.hidden; }],
    [() => { p.disclosure.attributes.inert = ""; }, () => { delete p.disclosure.attributes.inert; }],
    [() => { p.disclosure.attributes["aria-hidden"] = "true"; }, () => { delete p.disclosure.attributes["aria-hidden"]; }],
    [() => { p.disclosureStyle.display = "none"; }, () => { delete p.disclosureStyle.display; }],
    [() => { p.disclosureStyle.visibility = "hidden"; }, () => { delete p.disclosureStyle.visibility; }],
    [() => { p.disclosureStyle.opacity = "0"; }, () => { delete p.disclosureStyle.opacity; }],
    [() => { p.summaries = []; }, () => { p.summaries = null; }],
    [() => { p.summaries = [p.target, p.target]; }, () => { p.summaries = null; }],
    [() => { p.expandedHeight = NaN; }, () => { p.expandedHeight = 304.421875; }],
    [() => { p.disclosure.isConnected = false; }, () => { p.disclosure.isConnected = true; }],
    [() => { p.dialog.open = false; }, () => { p.dialog.open = true; }],
    [() => { p.modal = false; }, () => { p.modal = true; }],
  ]) { mutate(); p.unchanged(() => p.invokeToggle()); restore(); }
  p.unchanged(() => p.invokeToggle({ isTrusted: false }));
  p.unchanged(() => p.invokeToggle({ type: "beforetoggle" }));
  p.unchanged(() => p.invokeToggle({ target: p.target }));
  assert.deepEqual(p.scrolls, []);
  p.unchanged(() => p.invokeToggle()); assert.equal(p.scrolls.length, 1, "refused events do not retire the usable current disclosure");
});

test("creation disclosure cannot scroll for another focused control, unrelated details or a foreign event owner", async t => {
  const p = await createDisclosureCase(t), target = p.target, disclosure = p.disclosure;
  documentPort.activeElement = p.footerButton; p.unchanged(() => p.invokeToggle()); documentPort.activeElement = target;
  const foreignForm = Object.assign(Object.create(ElementPort.prototype), { tagName: "FORM" });
  const foreignDialog = Object.assign(Object.create(ElementPort.prototype), { tagName: "DIALOG" });
  p.path = [disclosure, foreignForm, p.form, p.dialog]; p.unchanged(() => p.invokeToggle());
  p.path = [disclosure, p.form, foreignDialog, p.dialog]; p.unchanged(() => p.invokeToggle()); p.path = null;
  p.unchanged(() => p.invokeToggle({ currentTarget: p.footerButton }));
  const unrelatedSummary = Object.assign(Object.create(ElementPort.prototype), { tagName: "SUMMARY", isConnected: true });
  const unrelatedDetails = Object.assign(Object.create(ElementPort.prototype), { tagName: "DETAILS", isConnected: true, open: true,
    querySelectorAll: () => [unrelatedSummary] });
  unrelatedSummary.parentElement = unrelatedDetails;
  p.path = [unrelatedDetails, p.form, p.dialog];
  p.unchanged(() => p.invokeToggle({ target: unrelatedDetails })); p.path = null;
  target.parentElement = p.form; p.unchanged(() => p.invokeToggle()); target.parentElement = disclosure;
  Object.defineProperty(disclosure, "ownerDocument", { configurable: true, value: {} });
  p.unchanged(() => p.invokeToggle()); delete disclosure.ownerDocument;
  const contains = p.form.contains; p.form.contains = node => node !== disclosure && contains(node);
  p.unchanged(() => p.invokeToggle()); p.form.contains = contains;
  assert.deepEqual(p.scrolls, []);
});

test("creation disclosure rechecks opening and focus ownership after expanded geometry reads", async t => {
  const p = await createDisclosureCase(t), original = p.disclosure.getBoundingClientRect;
  p.disclosure.getBoundingClientRect = () => { const value = original(); p.f.state.required = false; return value; };
  p.unchanged(() => p.invokeToggle()); assert.deepEqual(p.scrolls, []);
  p.disclosure.getBoundingClientRect = original; p.f.state.required = true;
  p.disclosure.getBoundingClientRect = () => { const value = original(); documentPort.activeElement = p.footerButton; return value; };
  p.invokeToggle(); assert.deepEqual(p.scrolls, []); assert.strictEqual(documentPort.activeElement, p.footerButton, "the helper does not restore retired summary focus");
  p.disclosure.getBoundingClientRect = original; documentPort.activeElement = p.target;
  p.f.state.authorization = "other-actor"; p.unchanged(() => p.invokeToggle()); assert.deepEqual(p.scrolls, []);
});

test("creation disclosure retires an old captured form listener after the dialog closes and reopens", async t => {
  const p = await createDisclosureCase(t), oldForm = p.form, oldHandler = p.form.handlers.toggle;
  await p.f.createClose(); await p.f.open("audio"); p.wire();
  assert.notStrictEqual(p.form, oldForm); assert.equal(oldForm.isConnected, false);
  p.unchanged(() => p.invokeToggle({}, oldHandler)); assert.deepEqual(p.scrolls, []);
  p.unchanged(() => p.invokeToggle()); assert.equal(p.scrolls.length, 1);
});
