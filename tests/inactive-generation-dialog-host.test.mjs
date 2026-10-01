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

// Inert AST boundaries only: the old fixture and all test bodies are omitted.
export function fixture() { throw new Error("Donor fixture omitted from finite editor control"); }
test("Donor suite omitted", () => { throw new Error("This boundary file must never be executed"); });
