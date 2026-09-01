import assert from "node:assert/strict";
import { canvasLegacySourceOwnership } from "./helpers/canvas-source-queue-host.mjs";
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
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { CanvasPresenceHub as ProductionHub } from "../src/canvas/presence.ts";
import { createPresenceBrowser } from "./helpers/canvas-presence-runtime.mjs";
import { canvasDocumentTarget } from "../src/model/canvas-document-target.ts";
import { localizeTemplateResult } from "../src/components/design-system/localized-template.ts";
import enMessages from "../src/components/design-system/locales/system-en.ts";
import frMessages from "../src/components/design-system/locales/fr.ts";
import arMessages from "../src/components/design-system/locales/ar.ts";
import jaMessages from "../src/components/design-system/locales/ja.ts";

// This runs actual component renderers and handlers with in-memory application,
// template, focus, and modal ports. It is not a browser/AT or viewport certificate.
// Resting counts model the emitted native controls outside closed details,
// popovers and dialogs; they do not measure CSS visibility or viewport intersection.
// The synthetic board is not the production study or a native control-count certificate.
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
  get updateComplete() { return this.fixture.tick(this); }
  requestUpdate() { this.fixture.requested = true; }
  connectedCallback() {}
  disconnectedCallback() {}
  querySelector(selector) {
    const attribute=selector.match(/^\[(id|popovertarget)="([^"]+)"\]$/);
    if(attribute)return this.fixture.renderer.query(this,"*").find(node=>node.attributes[attribute[1]]===attribute[2])??null;
    if(/^\.[\w-]+$/.test(selector)){
      const component=this.fixture.renderer.query(this,"forma-ui-popover").find(item=>String(item.attributes?.class??"").split(/\s+/).includes(selector.slice(1)));
      if(component)return component;
    }
    return this.fixture.renderer.query(this, selector)[0] ?? null;
  }
  querySelectorAll(selector) { return this.fixture.renderer.query(this, selector); }
  contains(node) {
    // Native containment follows ancestry (including self and detached
    // subtrees). An ancestor and descendant share connection lifetime; the
    // renderer already retires absent native ports and cached owners.
    if (!node || Boolean(node.isConnected) !== Boolean(this.isConnected)) return false;
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  addEventListener() {}
  removeEventListener() {}
  matches(selector) { return selector === ":dir(rtl)" ? this.i18n?.direction === "rtl" : selector.split(",").some(part=>part.trim()===this.tag||part.trim().startsWith(".")&&String(this.attributes?.class??"").split(/\s+/).includes(part.trim().slice(1))); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
  removeAttribute(name) { if (this.attributes) delete this.attributes[name]; }
  closest(selector) { if (selector === "forma-workspace") return this.fixture.workspace; let owner = this.parentElement; while (owner) { if (owner.tag === selector) return owner; owner = owner.parentElement; } return null; }
  dispatchEvent(event) {
    // Native CustomEvent dispatch identifies its actual emitting component.
    const target=Object.getOwnPropertyDescriptor(event,"target"),current=Object.getOwnPropertyDescriptor(event,"currentTarget");
    Object.defineProperties(event,{target:{configurable:true,value:this},currentTarget:{configurable:true,value:this}});
    try {
      const handler=this.eventBindings?.[event.type];
      if(typeof handler==="function")handler.call(this.parentElement,event);else handler?.handleEvent(event);
    } finally {
      if(target)Object.defineProperty(event,"target",target);else delete event.target;
      if(current)Object.defineProperty(event,"currentTarget",current);else delete event.currentTarget;
    }
    this.fixture.trace.push("event:" + event.type);
    return true;
  }
  focus() { this.fixture.trace.push("focus:" + this.tag); }
}
const documentPort = { activeElement: null, body:{isConnected:true,tag:"body"}, visibilityState: "visible", documentElement: { lang: "en", dataset: {}, toggleAttribute() {}, removeAttribute() {} }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null };
const windowPort = { innerWidth: 1280, innerHeight: 720, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() { return 1; }, clearTimeout() {}, setInterval(callback, milliseconds) { const id = ++activeFixture.timerId; activeFixture.canvasIntervals.set(id, { callback, milliseconds }); return id; }, clearInterval(id) { activeFixture.canvasIntervals.delete(id); }, requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
documentPort.defaultView=windowPort;
documentPort.addEventListener=(...args)=>windowPort.addEventListener(...args);
documentPort.removeEventListener=(...args)=>windowPort.removeEventListener(...args);
documentPort.emit=(type,target=documentPort.activeElement,extra={})=>{
  const event={type,target,currentTarget:documentPort,key:type==="keydown"?"Tab":undefined,composedPath:()=>target?[target,documentPort]:[documentPort],preventDefault(){},stopPropagation(){},...extra};
  for(const listener of [...(activeFixture.listeners.get(type)??[])]){if(typeof listener==="function")listener(event);else listener.handleEvent(event);}
};
windowPort.getComputedStyle=()=>({width:"384px",getPropertyValue:()=>"0px",direction:activeFixture?.locale==="ar"?"rtl":"ltr",fontSize:"16px"});
const navigatorPort = { onLine: true };
const offlinePort = { async enqueueBatch(events) { const batch = { id: "batch-" + activeFixture.state.batches.length, events, createdAt: new Date().toISOString() }; activeFixture.state.batches.push(batch); return batch; }, async summary() { return { count: 0, bytes: 0, warning: false, full: false }; }, async listBatches() { return []; }, async removeBatch() {} };
const DatePort = class extends globalThis.Date { static now() { return activeFixture?.presence?.now() ?? globalThis.Date.now(); } };
const presencePort = class extends ProductionHub {
  constructor() { super(activeFixture.presence?.runtime("host-tab") ?? { channel: () => null }); }
};
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
    else if (specifier === "./presence") dependencies.set(specifier, { CanvasPresenceHub: presencePort });
    else if (specifier.endsWith("/adaptive-proposal-review")) {
      const actual = await loadActual("src/components/adaptive-proposal-review.ts");
      dependencies.set(specifier, { ...actual, createAdaptiveProposalReview(...args) {
        const controller = actual.createAdaptiveProposalReview(...args);
        activeFixture.proposalReview = controller; // Observe the real instance; do not replace its lifecycle.
        return controller;
      } });
    }
    else if (specifier.endsWith("/canvas-offline-queue")) dependencies.set(specifier, { canvasOfflineQueue: offlinePort });
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
    } else dependencies.set(specifier, await import(specifier));
  }
  const code = ts.transpileModule(sourceText(relative), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, registry = { get() { return true; }, define() {} };
  const require = specifier => dependencies.get(specifier) ?? {};
  new Function("require", "exports", "customElements", "document", "window", "HTMLElement", "Element", "CSS", "location", "ResizeObserver", "getComputedStyle", "matchMedia", "InputEvent", "navigator", "requestAnimationFrame", "Date", code)(
    require, exports, registry, documentPort, windowPort, ElementPort, ElementPort, { escape: String }, { origin: "https://fixture.invalid" }, class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" }), () => ({ matches: true }), class InputEvent {}, navigatorPort, callback => callback(), DatePort,
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
    const ancestors=[],ordinals=new Map(),voids=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
    for (const [full, closing, tag, raw] of markup.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
      if(closing){const index=ancestors.findLastIndex(node=>node.tag===tag);if(index>=0)ancestors.splice(index);continue;}
      const parsed=this.attrs(raw),ordinal=ordinals.get(tag)??0;ordinals.set(tag,ordinal+1);
      const nativeKey=tag+":"+(parsed.attributes.id??parsed.attributes["data-canvas-item-id"]??ordinal);
      const node=this.previousNodes?.find(candidate=>candidate.owner===owner&&candidate.nativeKey===nativeKey)??{};
      Object.assign(node,{tag,owner,...parsed,full,nativeKey,open:Object.hasOwn(parsed.attributes,"open"),isConnected:true,value:parsed.properties.value??parsed.attributes.value??"",checked:parsed.properties.checked??false});
      Object.setPrototypeOf(node, ElementPort.prototype);
      node.parentElement = ancestors.at(-1)??owner; node.fixture = this.fixture; node.tagName = tag.toUpperCase(); node.id = String(node.attributes.id ?? "");
      Object.defineProperty(node,"disabled",{configurable:true,get:()=>Object.hasOwn(node.attributes,"disabled")});
      node.dataset = Object.fromEntries(Object.entries(node.attributes).filter(([key]) => key.startsWith("data-")).map(([key,value]) => [key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),String(value)]));
      node.style = { setProperty() {} }; node.clientWidth = 1280; node.clientHeight = 540;
      node.getBoundingClientRect = () => ({ x:0,y:0,left:0,top:0,right:1280,bottom:540,width:1280,height:540 });
      node.getAttribute = name => node.attributes[name] ?? null;
      node.matches = selector => selector === ":popover-open" ? Boolean(this.fixture.openPopovers.has(node.attributes.id)) : selector.split(",").some(part => part.trim() === tag || part.trim().startsWith(".") && node.classList.contains(part.trim().slice(1)));
      node.querySelectorAll = selector => {
        if(selector.startsWith(":scope > ")){const child=selector.slice(9),tag=child.match(/^[\w-]+/)?.[0],attributes=[...child.matchAll(/\[([\w-]+)\]/g)].map(match=>match[1]);return this.nodes.filter(candidate=>candidate.parentElement===node&&(!tag||candidate.tag===tag)&&attributes.every(name=>Object.hasOwn(candidate.attributes,name)));}
        return this.query(owner,selector);
      };
      node.showPopover = () => {
        let prevented=false;node.handlers.beforetoggle?.call(owner,{newState:"open",currentTarget:node,target:node,preventDefault(){prevented=true;}});if(prevented)return;
        if(node.attributes.popover==="auto")for(const other of this.nodes)if(other.attributes.id!==node.attributes.id&&other.attributes.popover==="auto"&&this.fixture.openPopovers.has(other.attributes.id))other.hidePopover();
        this.fixture.openPopovers.add(node.attributes.id);node.handlers.toggle?.call(owner,{newState:"open",currentTarget:node,target:node});
      };
      node.hidePopover = () => { if(!node.matches(":popover-open"))return;node.handlers.beforetoggle?.call(owner,{newState:"closed",currentTarget:node,target:node,preventDefault(){}});this.fixture.openPopovers.delete(node.attributes.id); node.handlers.toggle?.call(owner, {newState:"closed",currentTarget:node,target:node}); };
      node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
      node.addEventListener = (type, handler) => { (node.listeners ??= {})[type] = handler; };
      node.classList = { contains: name => String(node.attributes.class ?? "").split(/\s+/).includes(name) };
      node.select = () => { node.focus();node.selectionStart=0;node.selectionEnd=String(node.value).length; };
      node.setCustomValidity = value => { node.validationMessage = value; };
      node.reportValidity = () => !node.validationMessage;
      node.querySelector = selector => this.query(owner, selector)[0] ?? null;
      node.focus = () => { if(!node.isConnected)return;const previous=documentPort.activeElement;documentPort.activeElement = node; this.fixture.trace.push("focus:" + (node.attributes.class ?? node.tag));if(previous!==node)documentPort.emit("focusin",node); };
      node.closest = selector => { let current=node;while(current){if(current.matches?.(selector))return current;current=current.parentElement;}return null; };
      node.close = () => { if (node.open) { this.fixture.trace.push("close:" + node.attributes.class); node.open = false; node.handlers.close?.call(owner, { target: node, currentTarget: node }); node.listeners?.close?.(); } };
      this.nodes.push(node);if(!voids.has(tag))ancestors.push(node);
    }
  }
  draw(host, render = () => host.render()) {
    activeFixture = this.fixture;
    this.previousNodes = this.nodes;
    this.nodes = []; this.bindings = []; this.activeCaches.clear(); this.seen.clear();
    host.isConnected = true; this.updatingOwner = host; host.willUpdate?.(this.fixture.changed ?? new Map()); this.fixture.changed = new Map(); this.updatingOwner = null;
    this.markup = this.value(localizeTemplateResult(render(), host.i18n), host, "host");
    host.markup = this.markup; this.collect(this.markup, host);
    for (const [id, record] of this.instances) if (!this.seen.has(id)) {
      if (record.instance.isConnected) { record.instance.isConnected = false; record.instance.disconnectedCallback(); }
      if (!record.caches.some(key => this.activeCaches.has(key))) this.instances.delete(id);
    }
    for(const node of this.previousNodes)if(!this.nodes.includes(node)){node.isConnected=false;if(documentPort.activeElement===node)documentPort.activeElement=documentPort.body;}
    host.updated?.();
    return this.markup;
  }
  query(owner, selector) {
    if (selector.includes(",")) return selector.split(",").flatMap(part => this.query(owner, part.trim()));
    const within = candidate => { let current = candidate; while (current) { if (!owner || current === owner) return true; current = current.parentElement; } return false; };
    if (/^forma-/.test(selector)) return [...this.instances.values()].map(record => record.instance).filter(instance => instance.isConnected && within(instance.parentElement) && instance.tag === selector);
    return (this.updatingOwner ? this.previousNodes : this.nodes).filter(node => within(node.owner) && (!selector.startsWith("dialog") || node.tag === "dialog") && (!selector.includes("[popover]") || Object.hasOwn(node.attributes, "popover")) && (!selector.includes(":popover-open") || this.fixture.openPopovers.has(node.attributes.id)) && (!selector.includes("[open]") || node.open) && (!selector.includes(".") || selector.includes("[popover]") || String(node.attributes.class ?? "").split(/\s+/).includes(selector.match(/\.([\w-]+)/)?.[1])) && (!/^[a-z]/.test(selector) || node.tag === selector.match(/^[\w-]+/)?.[0] || selector.includes(" ")));
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



const { CanvasApplication } = await loadActual("src/canvas/canvas-application.ts");
const { DocumentArtifacts } = await loadActual("src/components/document-artifacts.ts");
const { ContextIntelligence } = await loadActual("src/components/context-intelligence.ts");
const { FormaUiChoiceCard } = await loadActual("src/components/design-system/choice-card.ts");
const { FormaUiPopover, FormaUiDisclosure } = await loadActual("src/components/design-system/feedback.ts");
const { PresentationDeck } = await loadActual("src/components/presentation-deck.ts");
const { CollectionTree } = await loadActual("src/components/collection-tree.ts");
const { positionNativePopover } = await loadActual("src/components/native-popover.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const registry = { "forma-document-artifacts": DocumentArtifacts, "forma-context-intelligence": ContextIntelligence, "forma-ui-choice-card": FormaUiChoiceCard, "forma-ui-popover": FormaUiPopover, "forma-ui-disclosure": FormaUiDisclosure, "forma-presentation-deck": PresentationDeck };

function restingControls(f, markup = f.renderer.markup) {
  const stack = [], controls = [], voids = new Set(["input","img","br","hr","meta","link","source","area","wbr"]);
  for (const [,closing,tag,raw] of markup.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
    if (closing) { const index = stack.findLastIndex(item => item.tag === tag); if(index >= 0) stack.splice(index); continue; }
    const {attributes} = f.renderer.attrs(raw), parent = stack.at(-1);
    const closedDetail = parent?.tag === "details" && !parent.open && tag !== "summary";
    const open = Object.hasOwn(attributes,"open") || f.openDetails.has(attributes.class) || f.openPopovers.has(attributes.id);
    const hidden = Boolean(parent?.hidden || closedDetail || Object.hasOwn(attributes,"hidden") || Object.hasOwn(attributes,"popover") && !open || tag === "dialog" && !open);
    if(!hidden && ["button","summary","select","input","textarea","a"].includes(tag)) controls.push({tag,attributes});
    if(!voids.has(tag)) stack.push({tag,hidden,open});
  }
  return controls;
}

// Legacy synthetic application port only. It does not provide a notification
// stream or authority evidence; no-render retirement is tested with full Store.
function canvasLegacySubscriptions() {
  const tree=syntax("src/state/store.ts"),owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");
  assert.ok(owner);
  const members=["#listeners","subscribe"].map(name=>{
    const member=owner.members.find(node=>node.name?.getText(tree)===name);assert.ok(member,"actual Store subscription member "+name);
    return member.getText(tree);
  });
  const code=ts.transpileModule("class SubscriptionOwner { "+members.join("\n")+" }\nexports.SubscriptionOwner=SubscriptionOwner;",
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function("exports",code)(exports);const subscription=new exports.SubscriptionOwner();
  return subscription.subscribe.bind(subscription);
}

function fixture(options = {}) {
  const state = { authorization:"actor-a", viewer:Boolean(options.viewer), boardId:"board-a", chosen:options.chosen ?? "", selected:[], events:[], batches:[], requests:[], replies:[], assistant:Boolean(options.assistant), documentCount:options.documentCount ?? 1 };
  const f = {state,locale:options.locale ?? "en",trace:[],listeners:new Map(),clipboard:[],openPopovers:new Set(),openDetails:new Set(),changed:new Map(),steps:0,
    presence:options.presence?createPresenceBrowser():undefined,canvasIntervals:new Map(),timerId:0,proposalSourceReads:[]};
  const messages = {...FORMA_DEFAULT_MESSAGES,...localeCatalogs[f.locale]};
  f.i18n = new FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){event.callback({locale:f.locale,formatLocale:f.locale,direction:f.locale==="ar"?"rtl":"ltr",timeZone:"UTC",messages,revision:0},()=>{});return true;}});
  f.i18n.hostConnected();
  const append = input => { const event={...input,eventId:"event-"+(state.events.length+1),streamId:"creative:fixture",sequence:state.events.length+1,actor:"user:owner",correlationId:"fixture",occurredAt:"2026-08-27T00:00:00Z"};state.events.push(event);return event; };
  append({type:"ProjectCreated",payload:{project_id:"p",name:"Actual Canvas host fixture"}});
  for(let index=0;index<state.documentCount;index++){
    const id="document-"+index;
    append({type:"DocumentCreated",payload:{project_id:"p",document_id:id,title:"Document "+index}});
    append({type:"BlockCreated",payload:{project_id:"p",document_id:id,block_id:"block-"+index,type:"direction",handle:"direction/"+index,position:"a",properties:{text:"Exact authored evidence for document "+index+". ".repeat(80),intent:"include",weight:.75,authority:"authored"}}});
  }
  append({type:"CanvasCreated",payload:{project_id:"p",canvas_id:"board-a",name:"Board A",slug:"board-a"}});
  append({type:"CanvasCreated",payload:{project_id:"p",canvas_id:"board-b",name:"Board B",slug:"board-b"}});
  if(options.populated) for(let index=0;index<state.documentCount;index++){
    append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-document-"+index,source_kind:"document",source_id:"document-"+index,title:"Document "+index,block_type:"document",frame:{x:index*400,y:0,w:330,h:220,z:"a"+index}}});
    append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-block-"+index,source_kind:"block",source_id:"block-"+index,title:"Direction "+index,block_type:"direction",frame:{x:index*350,y:270,w:300,h:210,z:"b"+index}}});
  }
  if(options.artifact && state.documentCount)append({type:"DocumentRenderCompleted",payload:{project_id:"p",document_id:"document-0",artifact_id:"artifact-a",artifact_kind:"short_story",title:"Saved exact story",summary:"A complete saved outcome.",content_ref:"story-content",item_count:1,items:[],requested_by_user_id:"owner"}});
  const projection = () => foldEvents(state.events,Infinity,state.documentCount?"document-0":"","p");
  const canvas = () => foldCanvasEvents(state.events,"p",state.boardId);
  f.append=append;
  f.store = {
    ...(options.storeHost?{}:{subscribe:canvasLegacySubscriptions()}),
    canvasArrangementUndoRequest:cell(null),optimisticEvents:cell([]),refreshEvents:async()=>{},
    canvasArrangementRequest:async(command)=>{state.requests.push({url:"/api/canvas/arrangements",body:command});return f.arrangementTransport?f.arrangementTransport(command):{ok:false,status:503,body:{error:"fixture_transport_unavailable"}};},
    ui:{instrumentation:false}, head:{get:()=>state.events.length}, events:{get:()=>state.events},eventView:{get:()=>state.events},projection:{get:projection},canvasProjection:{get:canvas},
    session:{get:()=>({user:{userId:"owner",role:"user",displayName:"Owner"},canvas:{access:true,blockedBy:[],requirements:[]},provider:{configured:true,plannerConfigured:true,videoConfigured:true,audioConfigured:true},assistant:{enabled:state.assistant},policy:{accepted:true},capabilities:["project.read","project.canvas.use","project.author","project.output.request"],...(state.viewer?{projectContext:{projectId:"p",projectAccessId:"access",organizationId:"org",ownerUserId:"owner",role:"viewer",permissions:["project.read","project.canvas.use"]}}:{})})},
    captureAuthorizationScope:()=>state.authorization?{key:state.authorization,shared:state.viewer}:null,authorizationScopeActive:scope=>Boolean(state.authorization&&scope?.key===state.authorization),
    route:{get:()=>f.route??"/canvas/"+state.boardId+"/"+state.boardId},setRoute:route=>{f.route=route;},asOf:cell(Infinity),content:cell({"story-content":JSON.stringify({content_markdown:"A complete saved outcome.",title:"Saved exact story",summary:"A complete saved outcome.",items:[]})}),busy:cell(""),
    canUndo:()=>Boolean(options.undo),canRedo:()=>Boolean(options.redo),undo:async()=>f.trace.push("undo"),redo:async()=>f.trace.push("redo"),
    canvasPlanningDocumentId:ids=>canvasDocumentTarget(projection(),canvas(),ids??state.selected,state.chosen),
    chooseCanvasPlanningDocument:id=>{if(!projection().documents.some(doc=>doc.id===id))return false;state.chosen=id;return true;},
    setCanvasPlanningSelection:ids=>{state.selected=[...ids];},
    // No Output read is modeled here. Preserve unknown scope without a fetch,
    // matching the real client default and related not-yet-read host ports.
    outputRequirements: {
      resource: () => ({ state: "loading", snapshot: null, error: null }),
      // This finite client cannot certify Output scope or start a transport.
      ensure: async documentId => f.store.outputRequirements.resource(documentId),
    },
    documentJobs:cell([]),projectNotifications:cell([]),reviewInbox:cell([]),generationReadiness:cell({}),
    documentGenerationJobs:()=>[],documentRenderJobs:()=>[],adaptiveSuggestionSetsFor:()=>[],
    // Presence integration has no paid source or private planning payload. These
    // real-controller ports permit inspection only; paid logic has its own suite.
    adaptiveProposalSource:(documentId,canvasId,executionId)=>{f.proposalSourceReads.push({documentId,canvasId,executionId});return null;},
    loadDocumentJobDetail:async()=>assert.fail("No private planning source is available in the presence fixture"),
    stageOptimisticCanvasEvents:inputs=>inputs.map(append),discardOptimisticCanvasEvents(){},syncCanvasBatch:async()=>assert.fail("The in-memory queue must never reach a network boundary"),
    append:async input=>[append(input)],appendBatch:async inputs=>inputs.map(append),toast:message=>f.trace.push("toast:"+message),
    guardedFetch:async(url,options)=>{const body=JSON.parse(options.body);if(url==="/api/context/adaptive/apply")assert.ok(["resume","retrieve","receipts"].includes(body.action),"Presence integration permits only free adaptive reads");state.requests.push({url,body});const reply=state.replies.shift();assert.ok(reply,"Mock response prepared for "+url);return{ok:reply.ok!==false,json:async()=>reply.body??reply};},
    structureAdaptive:async(...args)=>{state.requests.push({kind:"adaptive",args});return false;},ensurePrivateContent:async()=>assert.fail("Fixture content is already hydrated"),
  };
  if (f.presence) {
    const getSession = f.store.session.get;
    f.store.session.get = () => {
      const session = Object.hasOwn(state, "presenceSession") ? state.presenceSession : getSession();
      return session ? { permissionEpoch: "permission-1", ...session } : session;
    };
    // The ordinary host fixture abbreviates this key; the real store includes
    // actor and permission epoch, which this presence port must preserve.
    f.store.captureAuthorizationScope = () => {
      const session = f.store.session.get();
      return state.authorization && session ? { key: JSON.stringify([state.authorization,
        session.user.userId, session.permissionEpoch]), shared: Boolean(session.projectContext) } : null;
    };
    f.store.authorizationScopeActive = captured => {
      const current = f.store.captureAuthorizationScope();
      return Boolean(current && captured?.key === current.key && captured.shared === current.shared);
    };
  }
  if(options.storeHost)f.store=options.storeHost.store;else canvasLegacySourceOwnership(f.store);
  f.renderer = new RendererPort(f,registry);
  f.tick = async()=>{await Promise.resolve();f.draw();return true;};
  activeFixture=f;f.host=new CanvasApplication();f.host.isConnected=true;f.host.connectedCallback();
  f.draw=()=>{activeFixture=f;return f.renderer.draw(f.host);};
  f.flush=async()=>{await new Promise(setImmediate);f.draw();};
  f.native=(tag,predicate)=>f.renderer.ownNodes(f.host,tag).find(predicate);
  f.click=async(tag,predicate,event={})=>{const node=f.native(tag,predicate);assert.ok(node,"native "+tag+" exists");node.focus();await node.handlers.click.call(f.host,{target:node,currentTarget:node,shiftKey:false,composedPath:()=>[node],preventDefault(){},stopPropagation(){},...event});f.draw();await Promise.resolve();return node;};
  f.select=async(index,kind="block",shiftKey=false)=>f.click("article",node=>node.attributes["data-canvas-item-id"]==="item-"+kind+"-"+index,{shiftKey});
  f.sources=()=>f.click("button",node=>node.attributes.class?.includes("canvas-sources-toggle"));
  f.chooseSourceKind=async kind=>{const choice=f.renderer.query(f.host,"forma-ui-choice-card").find(child=>child.value===kind);assert.ok(choice);await f.renderer.handler(choice,"button",()=>true)();f.draw();};
  f.draw();return f;
}

test("actual empty Canvas resting controls stay within the owned eight-control budget without removing executors", async context => {
  const counts=[];
  for(const documentCount of [0,1,2])for(const assistant of [false,true]){
    const f=fixture({documentCount,assistant,chosen:documentCount===2?"document-0":"",undo:true,redo:true});
    const controls=restingControls(f);
    counts.push({documentCount,assistant,controls:controls.length});
    assert.ok(controls.length<=8,JSON.stringify(counts.at(-1)));
    assert.equal(f.renderer.query(f.host,"dialog").length,0);
    assert.ok(f.renderer.ownNodes(f.host,"button").some(node=>node.attributes["aria-label"]===f.i18n.t("canvas.zoomIn","Zoom in")),"zoom remains in View");
    assert.ok(f.renderer.ownNodes(f.host,"button").some(node=>node.attributes["aria-label"]==="Undo board action"),"history remains in View");
    assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
  }
  context.diagnostic("Actual in-memory Canvas host, native closed-disclosure model only: "+JSON.stringify(counts)+". No shell/native/viewport certification.");
});

test("the exact planning choice remains reachable in View and next actions use that chosen document", () => {
  const f=fixture({documentCount:2});
  const selector=f.renderer.ownNodes(f.host,"select").find(node=>typeof node.handlers.change==="function");
  assert.ok(selector);selector.handlers.change.call(f.host,{currentTarget:{value:"document-1"}});f.draw();
  assert.equal(f.store.canvasPlanningDocumentId(),"document-1");
  assert.ok(f.renderer.markup.includes('<b dir="auto">Document 1</b>'));
  const choices=f.renderer.query(f.host,"forma-ui-choice-card").filter(child=>child.value?.startsWith("configure")||child.value==="add-context");
  assert.ok(choices.length>0&&choices.length<=3);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("the existing source drawer retains manual fields and restores the named opener on close and reopen", async () => {
  const f=fixture();const opener=await f.sources();await f.chooseSourceKind("context");
  const name=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.placeholder==="Give this idea a short name"),field=f.renderer.ownNodes(f.host,"textarea")[0];
  assert.ok(name&&field);
  const draft="Every unfinished source sentence stays unchanged.\n".repeat(160);
  name.handlers.input.call(f.host,{target:{value:"Exact new decision name"}});field.handlers.input.call(f.host,{target:{value:draft}});f.draw();
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"));
  f.trace.length=0;
  await f.click("button",node=>node.attributes["aria-label"]===f.i18n.t("canvas.controls.closeSources","Close sources"));
  await f.flush();assert.equal(dialog.open,false);assert.equal(f.renderer.query(f.host,"dialog").length,0);
  assert.ok(f.trace.includes("focus:"+opener.attributes.class));
  await f.sources();
  assert.equal(f.renderer.ownNodes(f.host,"textarea")[0].value,draft);
  assert.equal(f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.placeholder==="Give this idea a short name").value,"Exact new decision name");
  assert.equal(f.state.batches.length,0);assert.equal(f.state.requests.length,0);
});

test("native source Escape closes the owned dialog without erasing the current board selection", async () => {
  const f=fixture({populated:true});await f.select(0);const before=[...f.state.selected];await f.sources();
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"));
  let prevented=0,stopped=0;
  dialog.handlers.keydown.call(f.host,{key:"Escape",isComposing:true,preventDefault(){assert.fail("composition intercepted");},stopPropagation(){}});f.draw();
  assert.ok(f.renderer.query(f.host,"dialog").length);
  dialog.handlers.keydown.call(f.host,{key:"Escape",isComposing:false,preventDefault(){prevented++;},stopPropagation(){stopped++;}});await f.flush();
  assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(f.renderer.query(f.host,"dialog").length,0);assert.deepEqual(f.state.selected,before);
});


test("pinning an existing source uses only the original placement executor and no copy or semantic event", async () => {
  const f=fixture();const initial=f.state.events.length;await f.sources();await f.chooseSourceKind("document");
  const source=f.renderer.ownNodes(f.host,"button").find(node=>node.handlers.click?.toString().includes("#placeSource(source)"));
  assert.ok(source);await source.handlers.click.call(f.host,{});await f.flush();
  assert.deepEqual(f.state.events.slice(initial).map(event=>event.type),["CanvasItemPlaced"]);
  assert.equal(f.state.events.at(-1).payload.source_id,"document-0");
  assert.equal(f.state.events.at(-1).payload.canvas_id,"board-a");
  assert.equal(f.state.requests.length,0);
  assert.equal(f.renderer.query(f.host,".canvas-add-dialog").length,0);
});

for(const boundary of ["board","authorization","role"])test("the source drawer closes and clears private drafts at the "+boundary+" boundary", async () => {
  const f=fixture();await f.sources();await f.chooseSourceKind("context");
  f.renderer.ownNodes(f.host,"textarea")[0].handlers.input.call(f.host,{target:{value:"PRIVATE SOURCE DRAFT A"}});f.draw();
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"));
  if(boundary==="board")f.state.boardId="board-b";
  if(boundary==="authorization")f.state.authorization="actor-b";
  if(boundary==="role")f.state.viewer=true;
  f.draw();assert.equal(dialog.open,false);assert.equal(f.renderer.query(f.host,".canvas-add-dialog").length,0);
  assert.ok(!f.renderer.markup.includes("PRIVATE SOURCE DRAFT A"));
  if(boundary!=="role"){await f.sources();await f.chooseSourceKind("context");assert.equal(f.renderer.ownNodes(f.host,"textarea")[0].value,"");}
  else assert.ok(!f.renderer.ownNodes(f.host,"button").some(node=>node.attributes.class?.includes("canvas-sources-toggle")));
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("a queued source close cannot dismiss a later opening", async () => {
  const f=fixture();await f.sources();
  const old=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"));
  old.handlers.cancel.call(f.host,{preventDefault(){},stopPropagation(){}});await f.flush();await f.sources();
  old.handlers.close.call(f.host,{target:old,currentTarget:old});f.draw();
  assert.ok(f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"))?.open);
});

test("the exact output drawer opens only for its present document and returns focus after closing", async () => {
  const f=fixture({populated:true,documentCount:2,artifact:true});await f.select(0,"document");
  const initial=f.state.events.length;
  const opener=await f.click("button",node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-document-outputs-dialog"));
  assert.ok(dialog?.open);assert.ok(f.renderer.markup.includes("Saved exact story"));
  f.trace.length=0;dialog.handlers.cancel.call(f.host,{preventDefault(){},stopPropagation(){}});await f.flush();
  assert.equal(dialog.open,false);assert.equal(f.renderer.query(f.host,".canvas-document-outputs-dialog").length,0);
  assert.ok(f.trace.includes("focus:"+opener.attributes.class));
  await f.select(1,"document");await f.click("button",node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
  assert.ok(!f.renderer.markup.includes("Saved exact story"),"document B cannot inherit A's drawer results");
  assert.equal(f.state.events.length,initial);assert.equal(f.state.requests.length,0);
});

test("a removed or rebound output-drawer target closes without switching to another document", async () => {
  const f=fixture({populated:true,documentCount:2});await f.select(0,"document");
  await f.click("button",node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-document-outputs-dialog"));
  await f.store.append({type:"CanvasItemRemoved",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-document-0",reason:"fixture"}});f.draw();
  assert.equal(dialog.open,false);assert.equal(f.renderer.query(f.host,".canvas-document-outputs-dialog").length,0);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("a stale selected-document handler cannot open its results on another board", async () => {
  const f=fixture({populated:true});await f.select(0,"document");
  const old=f.renderer.ownNodes(f.host,"button").find(node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
  f.state.boardId="board-b";f.draw();
  old.handlers.click.call(f.host,{});f.draw();
  assert.equal(f.renderer.query(f.host,".canvas-document-outputs-dialog").length,0);
  assert.equal(f.state.requests.length,0);
});

test("selected decisions keep one primary, two analysis alternatives, and all remaining executors in the shared popover", async () => {
  const f=fixture({populated:true});await f.select(0);
  const hud=f.renderer.ownNodes(f.host,"aside").find(node=>node.attributes.class==="canvas-selection-hud");
  assert.ok(hud);
  const menu=f.renderer.query(f.host,"forma-ui-popover").find(child=>child.attributes.class==="canvas-selection-more");
  assert.ok(menu);assert.deepEqual(menu.actions.map(action=>action.value),["combine","document","remove"]);
  const intelligence=f.renderer.query(f.host,"forma-context-intelligence")[0];assert.ok(intelligence);
  assert.equal(f.renderer.ownNodes(intelligence,"button").length,2);
  const primary=f.renderer.ownNodes(f.host,"button").filter(node=>node.attributes.class==="canvas-selected-primary");
  assert.equal(primary.length,1);
  const panel=f.renderer.ownNodes(menu,"section").find(node=>Object.hasOwn(node.attributes,"popover"));assert.ok(panel);
  panel.showPopover();f.draw();assert.ok(f.openPopovers.size);
  const combine=f.renderer.ownNodes(menu,"button").find(node=>node.handlers.click?.toString().includes("#action(")&&node.attributes.class===undefined);
  assert.ok(combine);await combine.handlers.click.call(menu,{currentTarget:combine,target:combine});f.draw();
  assert.equal(f.openPopovers.size,0);
  assert.ok(f.renderer.query(f.host,"dialog").length,"the original combine configuration opens from the shared menu");
  assert.equal(f.state.batches.length,0);assert.equal(f.state.requests.length,0);
});

test("a cached selected decision retains its proposal draft and exact approval identity after switching away", async () => {
  const f=fixture({populated:true,documentCount:2});await f.select(0);
  const intelligence=f.renderer.query(f.host,"forma-context-intelligence")[0];
  f.state.replies.push({status:"none"},{quote:{executionId:"canvas-exact-analysis",bindingHash:"canvas-exact-binding",status:"quoted",providerAvailable:true}});
  await f.renderer.handler(intelligence,"button",node=>node.attributes.class==="button ghost compact")();await f.flush();
  f.state.replies.push({executionId:"canvas-exact-analysis",bindingHash:"canvas-exact-binding",billingStatus:"settled",plan:{blockId:"block-0",source:"Authored evidence",proposals:[{id:"proposal-a",type:"subject",subtype:"Hero subject",label:"Exact proposal",text:"Original proposal",sourceExcerpt:"Authored evidence",participants:[]}],addenda:[]}});
  await f.renderer.handler(intelligence,"button",node=>node.attributes.class==="button primary")();await f.flush();
  const draft="Every exact proposal sentence remains pending.\n".repeat(180);
  f.renderer.ownNodes(intelligence,"textarea")[0].handlers.input.call(intelligence,{currentTarget:{value:draft}});f.draw();
  const dialog=f.renderer.ownNodes(intelligence,"dialog")[0],count=f.state.requests.length;
  await f.select(1);assert.equal(dialog.open,false);assert.equal(intelligence.isConnected,false);
  await f.select(0);
  assert.equal(f.renderer.query(f.host,"forma-context-intelligence")[0],intelligence);
  await f.renderer.handler(intelligence,"button",node=>node.attributes.class==="button ghost compact")();await f.flush();
  assert.equal(f.renderer.ownNodes(intelligence,"textarea")[0].value,draft);
  assert.equal(f.state.requests.length,count);
  const approval=f.state.requests.find(request=>request.body.action==="execute").body;
  assert.equal(approval.executionId,"canvas-exact-analysis");assert.equal(approval.approvedBindingHash,"canvas-exact-binding");
  assert.equal(f.state.batches.length,0);
});

test("the optional intent form retains exact text through native Escape and never submits on opening", async () => {
  const f=fixture({populated:true}),menu=f.renderer.query(f.host,"forma-ui-popover").find(child=>child.attributes.class==="canvas-intent-dock");
  assert.ok(menu);
  const trigger=f.renderer.ownNodes(menu,"button").find(node=>node.attributes.popovertarget),panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.popover==="auto");
  assert.equal(trigger.attributes.popovertarget,panel.attributes.id);
  trigger.handlers.click.call(menu,{currentTarget:trigger});
  panel.showPopover();f.draw();
  const field=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.maxlength==="2000");
  const draft="An unfinished board intent, not permission to buy anything.";
  field.handlers.input.call(f.host,{target:{value:draft}});f.draw();
  const wrapper=f.renderer.ownNodes(menu,"div").find(node=>node.attributes.class==="ui-popover");
  let stopped=false,prevented=false;
  wrapper.handlers.keydown.call(menu,{key:"Escape",stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});
  assert.equal(stopped,true);assert.equal(prevented,false,"the browser, not Canvas, owns Escape dismissal");
  // Browser-owned native dismissal is a port here, not an in-browser assertion.
  f.renderer.ownNodes(menu,"section").find(node=>node.attributes.popover==="auto").hidePopover();f.draw();
  assert.equal(f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.maxlength==="2000").value,draft);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const locale of ["en","fr","ar","ja"])test("the actual source drawer and cached selection use the "+locale+" catalog without translating authored values", async () => {
  const f=fixture({populated:true,locale});await f.select(0);
  const menu=f.renderer.query(f.host,"forma-ui-popover").find(child=>child.attributes.class==="canvas-selection-more");
  assert.equal(menu.label,f.i18n.messages["canvas.controls.otherWays"]);
  assert.ok(menu.markup.includes(escapeText(f.i18n.messages["canvas.controls.otherWays"])));
  assert.ok(f.renderer.markup.includes("Exact authored evidence for document 0."));
  await f.sources();
  assert.ok(f.renderer.ownNodes(f.host,"button").some(node=>node.attributes["aria-label"]===f.i18n.messages["canvas.controls.closeSources"]));
  const title=interpolate(f.i18n.messages["canvas.controls.sourcesFor"],{name:"\u2068Board A\u2069"});
  assert.ok(f.renderer.markup.includes(escapeText(title)));
  await f.chooseSourceKind("context");
  const authored="Edit — this exact customer wording stays untranslated.";
  f.renderer.ownNodes(f.host,"textarea")[0].handlers.input.call(f.host,{target:{value:authored}});f.draw();
  const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class?.includes("canvas-add-dialog"));
  dialog.handlers.cancel.call(f.host,{preventDefault(){},stopPropagation(){}});await f.flush();await f.sources();
  assert.equal(f.renderer.ownNodes(f.host,"textarea")[0].value,authored);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("viewer Canvas keeps exact read-only outputs and never offers source creation, semantic authoring or planning", async () => {
  const f=fixture({populated:true,viewer:true,artifact:true});await f.select(0,"document");
  assert.ok(!f.renderer.ownNodes(f.host,"button").some(node=>node.attributes.class?.includes("canvas-sources-toggle")));
  assert.equal(f.renderer.query(f.host,"forma-ui-popover").filter(child=>child.attributes.class==="canvas-selection-more").length,0);assert.equal(f.renderer.query(f.host,"forma-context-intelligence").length,0);
  assert.ok(!f.renderer.ownNodes(f.host,"input").some(node=>node.attributes.maxlength==="2000"));
  await f.click("button",node=>String(node.attributes.class).includes("canvas-document-outputs-action"));
  assert.ok(f.renderer.markup.includes("Saved exact story"));
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});


test("populated Canvas retains its bounded resting chrome as more authored blocks are placed", async context => {
  const f=fixture({populated:true,documentCount:5,chosen:"document-0",artifact:true});
  await f.store.append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-artifact-a",source_kind:"artifact",source_id:"artifact-a",title:"Saved exact story",block_type:"short_story",frame:{x:100,y:550,w:330,h:220,z:"c1"}}});f.draw();
  const initial=restingControls(f).length;
  assert.ok(initial<=22,"bounded owned resting controls: "+initial);
  for(let index=0;index<100;index++){
    await f.store.append({type:"BlockCreated",payload:{project_id:"p",scope:"canvas",canvas_id:"board-a",block_id:"extra-"+index,type:"direction",handle:"direction/extra-"+index,position:"z"+index,properties:{text:"Additional exact authored evidence "+index,authority:"authored"}}});
    await f.store.append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-extra-"+index,source_kind:"block",source_id:"extra-"+index,title:"Extra "+index,block_type:"direction",frame:{x:(index%8)*150,y:800+Math.floor(index/8)*100,w:180,h:160,z:"z"+index}}});
  }
  f.draw();assert.equal(restingControls(f).length,initial);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
  context.diagnostic("Synthetic populated host (5 documents + saved story + authored blocks): "+initial+" resting native-semantic controls before and after 100 extra placements. Not the production/native viewport fixture.");
});


for (const locale of ["en", "fr", "ar", "ja"]) test("reader Canvas selects one exact decision and uses only its localized free review recovery in " + locale, async () => {
  const f=fixture({populated:true,viewer:true,documentCount:2,locale});await f.select(1);
  const intelligence=f.renderer.query(f.host,"forma-context-intelligence")[0];assert.ok(intelligence);assert.equal(intelligence.block.id,"block-1");assert.equal(intelligence.readOnly,true);
  assert.equal(f.renderer.ownNodes(intelligence,"button").length,1);
  assert.ok(intelligence.markup.includes(escapeText(f.i18n.t("context.controls.inspectReview"))));
  f.state.replies.push({status:"none"});
  await f.renderer.handler(intelligence,"button",node=>node.attributes["data-context-review-action"]==="inspect")();await f.flush();
  for(const tag of ["input","select","textarea","form"])assert.equal(f.renderer.ownNodes(intelligence,tag).length,0);
  assert.ok(intelligence.markup.includes(escapeText(f.i18n.t("context.controls.noReview"))));
  assert.deepEqual(f.state.requests.map(request=>[request.url,request.body.action,request.body.projectId,request.body.documentId,request.body.blockId]),[["/api/context/apply","resume","p","document-1","block-1"]]);
  assert.equal(f.state.batches.length,0);assert.equal(f.renderer.query(f.host,"forma-ui-popover").filter(child=>child.attributes.class==="canvas-selection-more").length,0);
});

test("personal Canvas authoring requires actual session capabilities rather than a missing project context", async () => {
  const f=fixture({populated:true});const session=f.store.session.get();f.store.session.get=()=>({...session,capabilities:["project.read"]});f.draw();await f.select(0);
  assert.ok(!f.renderer.ownNodes(f.host,"button").some(node=>node.attributes.class?.includes("canvas-sources-toggle")));
  assert.equal(f.renderer.query(f.host,"forma-ui-popover").filter(child=>child.attributes.class==="canvas-selection-more").length,0);
  const intelligence=f.renderer.query(f.host,"forma-context-intelligence")[0];assert.ok(intelligence);assert.equal(intelligence.readOnly,true);
  assert.equal(f.renderer.ownNodes(intelligence,"button").length,1);assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

function ownedPopover(f,className,host=f.host){
  const menu=f.renderer.query(host,"forma-ui-popover").find(child=>child.attributes.class===className);
  assert.ok(menu,className+" uses the actual shared popover");
  const panel=f.renderer.ownNodes(menu,"section").find(node=>node.attributes.popover==="auto");
  const trigger=f.renderer.ownNodes(menu,"button").find(node=>node.attributes.popovertarget===panel?.attributes.id);
  assert.ok(panel&&trigger,"a real native button targets the actual auto panel");
  return {menu,panel,trigger};
}
function openOwnedPopover(f,className,host=f.host){
  let owned=ownedPopover(f,className,host);
  owned.trigger.focus();owned.trigger.handlers.click.call(owned.menu,{currentTarget:owned.trigger});
  // This fixture supplies the declarative button default action, not browser proof.
  owned.panel.showPopover();f.draw();owned=ownedPopover(f,className,host);return owned;
}
function runPortHandler(handler,owner,event){
  if(typeof handler==="function")return handler.call(owner,event);
  return handler.handleEvent(event);
}
function adoptPopoverHost(f,Constructor,properties={}){
  f.host.disconnectedCallback();
  for(const record of f.renderer.instances.values())if(record.instance.isConnected){record.instance.isConnected=false;record.instance.disconnectedCallback();}
  f.renderer.instances.clear();f.renderer.nodes=[];
  activeFixture=f;f.host=new Constructor();Object.assign(f.host,properties);
  f.host.isConnected=true;f.host.connectedCallback();f.draw();return f.host;
}
function addFixtureDeck(f){
  const event=f.state.events.find(item=>item.type==="DocumentRenderCompleted");
  assert.ok(event);event.payload.artifact_kind="slides";event.payload.item_count=1;
  event.payload.items=[{id:"slide-a",title:"Exact slide",body:"Exact body",notes:"Private notes",image_prompt:"",context_group_ids:[]}];
  event.payload.settings={soundtrack_assets:[{media_url:"/api/media/fixture-soundtrack",media_type:"audio/mpeg",label:"Owned soundtrack",transcript:"Exact authored listening notes",cues:[{target_kind:"slide",target_id:"slide-a",start_seconds:0,label:"Exact cue"}]}]};
  const retained=JSON.parse(f.store.content.get()["story-content"]);retained.items=[{title:"Exact slide",body:"Exact body",notes:"Private notes",image_prompt:"",context_group_ids:[]}];
  f.store.content.set({...f.store.content.get(),"story-content":JSON.stringify(retained)});f.draw();
  return f.store.projection.get().libraryArtifacts.find(item=>item.id==="artifact-a");
}

test("shared native popovers keep instance-unique stable targets and rich controls without menu roles",()=>{
  const first=fixture({populated:true}),firstView=ownedPopover(first,"canvas-view-menu"),firstIntent=ownedPopover(first,"canvas-intent-dock");
  const ids=[firstView.panel.attributes.id,firstIntent.panel.attributes.id],triggerId=firstView.trigger.attributes.id;
  first.draw();assert.equal(ownedPopover(first,"canvas-view-menu").panel.attributes.id,ids[0]);
  assert.equal(ownedPopover(first,"canvas-view-menu").trigger.attributes.id,triggerId);
  const second=fixture({populated:true});ids.push(ownedPopover(second,"canvas-view-menu").panel.attributes.id,ownedPopover(second,"canvas-intent-dock").panel.attributes.id);
  assert.equal(new Set(ids).size,4);assert.notEqual(ownedPopover(second,"canvas-view-menu").trigger.attributes.id,triggerId);
  assert.ok(firstView.menu.content?.strings,"the actual authored controls are a property-only Lit template");
  assert.ok(firstView.menu.markup.includes("Planning document"));
  assert.doesNotMatch(firstView.menu.markup,/<details|role="menu(?:item)?"/);
  assert.equal(first.state.requests.length+second.state.requests.length,0);
});

test("shared popover closes and restores its invoker before the existing semantic handoff",async()=>{
  const f=fixture({populated:true});await f.select(0);
  const {menu,panel}=openOwnedPopover(f,"canvas-selection-more");
  const action=f.renderer.ownNodes(menu,"button").find(node=>!node.attributes.popovertarget&&!Object.hasOwn(node.attributes,"disabled"));
  assert.ok(action);f.trace.length=0;action.focus();action.handlers.click.call(menu,{target:action,currentTarget:action});
  assert.equal(f.openPopovers.has(panel.attributes.id),false);
  assert.ok(f.trace.findIndex(value=>value.includes("ui-popover-trigger"))<f.trace.indexOf("event:forma-action"),JSON.stringify(f.trace));
  f.draw();assert.ok(f.renderer.query(f.host,"dialog").length,"the existing action still opens its real destination");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("actual toggle follows present native state and disposes listeners after outside dismissal",()=>{
  const f=fixture({populated:true}),owned=openOwnedPopover(f,"canvas-view-menu");
  assert.equal(owned.trigger.attributes["aria-expanded"],"true");assert.equal(f.listeners.get("resize")?.length,1);
  owned.panel.handlers.toggle.call(owned.menu,{newState:"closed",currentTarget:owned.panel,target:owned.panel});
  f.draw();assert.equal(ownedPopover(f,"canvas-view-menu").trigger.attributes["aria-expanded"],"true","a queued old close cannot lie about the reopened native state");
  ownedPopover(f,"canvas-view-menu").panel.hidePopover();f.draw();
  assert.equal(ownedPopover(f,"canvas-view-menu").trigger.attributes["aria-expanded"],"false");
  assert.equal(f.listeners.get("resize")?.length,0);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("opening a different actual auto popover closes the first without action or paid request",()=>{
  const f=fixture({populated:true}),view=openOwnedPopover(f,"canvas-view-menu"),intent=openOwnedPopover(f,"canvas-intent-dock");
  assert.equal(f.openPopovers.has(view.panel.attributes.id),false);
  assert.equal(f.openPopovers.has(intent.panel.attributes.id),true);
  assert.equal(ownedPopover(f,"canvas-view-menu").trigger.attributes["aria-expanded"],"false");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const boundary of ["authorization","board","route","role","removed-board"])test("actual floating Canvas controls close at "+boundary+" without authoring",async()=>{
  const f=fixture({populated:true}),owned=openOwnedPopover(f,"canvas-view-menu"),count=f.state.events.length;
  if(boundary==="authorization")f.state.authorization="actor-b";
  else if(boundary==="board")f.state.boardId="board-b";
  else if(boundary==="route")f.route="/canvas/board-a/board-a?view=list";
  else if(boundary==="role")f.state.viewer=true;
  else await f.store.append({type:"CanvasRemoved",payload:{project_id:"p",canvas_id:"board-a"}});
  f.draw();assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  assert.equal(f.listeners.get("resize")?.length??0,0);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
  assert.equal(f.state.events.length,count+(boundary==="removed-board"?1:0));
});

test("a stale View action is cancelled before its target handler after current authority changes",()=>{
  const f=fixture({populated:true}),{menu}=openOwnedPopover(f,"canvas-view-menu");
  const group=f.renderer.ownNodes(menu,"div").find(node=>node.attributes.class==="canvas-view-actions"),button=f.renderer.ownNodes(menu,"button").find(node=>!node.attributes.popovertarget);
  let prevented=false,stopped=false;f.state.authorization="actor-b";
  runPortHandler(group.handlers.click,menu,{type:"click",target:button,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(f.openPopovers.size,0);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("Canvas Escape leaves the first open native popover to the browser and preserves selection",async()=>{
  const f=fixture({populated:true});await f.select(0);const owned=openOwnedPopover(f,"canvas-view-menu"),selected=[...f.state.selected];
  const key=f.listeners.get("keydown")[0];let prevented=false;
  key({key:"Escape",defaultPrevented:false,composedPath:()=>[owned.trigger],preventDefault(){prevented=true;},stopPropagation(){}});
  assert.equal(prevented,false);assert.deepEqual(f.state.selected,selected);
  owned.panel.hidePopover();f.draw();assert.deepEqual(f.state.selected,selected);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("actual Canvas disconnect hides open popovers and removes their positioning listeners",()=>{
  const f=fixture({populated:true}),owned=openOwnedPopover(f,"canvas-intent-dock");
  f.host.disconnectedCallback();
  assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  assert.equal(f.listeners.get("resize")?.length??0,0);
  owned.menu.isConnected=false;owned.panel.handlers.toggle.call(owned.menu,{newState:"open",currentTarget:owned.panel});
  assert.equal(f.listeners.get("resize")?.length??0,0,"late channel-style toggle cannot restart a detached observer");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const locale of ["en","fr","ar","ja"])test("actual View and intent invokers retain "+locale+" names without translating entered intent",()=>{
  const f=fixture({populated:true,locale});
  assert.equal(ownedPopover(f,"canvas-view-menu").menu.label,f.i18n.system("View"));
  assert.equal(ownedPopover(f,"canvas-intent-dock").menu.label,f.i18n.t("assistant.mode.planBoard"));
  const field=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.maxlength==="2000"),value="Café — 原文 العربية";
  field.handlers.input.call(f.host,{target:{value}});f.draw();openOwnedPopover(f,"canvas-intent-dock");f.draw();
  assert.equal(f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.maxlength==="2000").value,value);
  assert.equal(f.state.requests.length,0);
});

test("shared positioning uses finite RTL-aware viewport bounds and a scrollable upward fallback",()=>{
  const values=new Map(),listeners=new Map();
  const view={innerWidth:320,innerHeight:260,visualViewport:{width:320,height:260,offsetLeft:0,offsetTop:0},getComputedStyle:element=>element.trigger?{direction:"rtl"}:{width:"304px",getPropertyValue:()=>"0px"}};
  const trigger={trigger:true,isConnected:true,ownerDocument:{defaultView:view},getBoundingClientRect:()=>({left:266,right:312,top:214,bottom:258})};
  const panel={isConnected:true,setAttribute:(name,value)=>values.set(name,value),style:{setProperty:(name,value)=>values.set(name,value)}};
  positionNativePopover(trigger,panel);
  assert.equal(values.get("--forma-popover-left"),"8px");
  assert.equal(values.get("--forma-popover-max-width"),"304px");
  assert.equal(values.get("--forma-popover-top"),"auto");
  assert.equal(values.get("--forma-popover-bottom"),"52px");
  assert.equal(values.get("--forma-popover-max-height"),"200px");
  values.clear();trigger.getBoundingClientRect=()=>({left:NaN,right:12,top:20,bottom:40});
  positionNativePopover(trigger,panel);assert.equal(values.size,0);
  trigger.isConnected=false;positionNativePopover(trigger,panel);assert.equal(values.size,0);
  assert.equal(listeners.size,0);
});

test("collection action targets are declarative and collision-free across equal and punctuation-differing IDs",async()=>{
  const f=fixture();await f.store.append({type:"CollectionCreated",payload:{collection_id:"a:b",handle:"One",parent_collection_id:null,position:"a"}});
  await f.store.append({type:"CollectionCreated",payload:{collection_id:"a-b",handle:"Two",parent_collection_id:null,position:"b"}});
  const host=adoptPopoverHost(f,CollectionTree),buttons=f.renderer.ownNodes(host,"button").filter(node=>node.attributes.popovertarget);
  assert.equal(buttons.length,2);assert.equal(new Set(buttons.map(node=>node.attributes.popovertarget)).size,2);
  for(const button of buttons){const panel=host.querySelector('[id="'+button.attributes.popovertarget+'"]');assert.ok(panel);assert.equal(panel.attributes.popover,"auto");assert.equal(panel.attributes.role,"group");button.handlers.click.call(host,{currentTarget:button,preventDefault(){assert.fail("current collection button stays native");}});assert.equal(f.openPopovers.size,0,"positioning never opens the panel imperatively");}
  const firstId=buttons[0].attributes.popovertarget;f.draw();assert.equal(f.renderer.ownNodes(host,"button").find(node=>node.attributes.popovertarget).attributes.popovertarget,firstId);
  const g=fixture();g.state.events.push(...f.state.events.filter(event=>event.type==="CollectionCreated"));const other=adoptPopoverHost(g,CollectionTree);
  assert.notEqual(g.renderer.ownNodes(other,"button").find(node=>node.attributes.popovertarget).attributes.popovertarget,firstId);
  assert.equal(f.state.requests.length+g.state.requests.length,0);
});

test("collection Rename keeps its original single-event executor and closes before dialog handoff",async()=>{
  const f=fixture();await f.store.append({type:"CollectionCreated",payload:{collection_id:"collection-a",handle:"Original",parent_collection_id:null,position:"a"}});
  const host=adoptPopoverHost(f,CollectionTree),trigger=f.renderer.ownNodes(host,"button").find(node=>node.attributes.popovertarget),panel=host.querySelector('[id="'+trigger.attributes.popovertarget+'"]');
  panel.showPopover();f.draw();
  const rename=f.renderer.ownNodes(host,"button").find(node=>node.full.includes('type="button"')&&!node.attributes.popovertarget&&node.handlers.click&&node.attributes.class===undefined);
  assert.ok(rename);f.trace.length=0;rename.handlers.click.call(host,{target:rename,currentTarget:rename});f.draw();
  assert.equal(f.openPopovers.size,0);assert.ok(f.renderer.ownNodes(host,"dialog").length);
  const input=f.renderer.ownNodes(host,"input")[0];assert.equal(input.value,"Original");input.handlers.input.call(host,{target:{value:"Exact renamed folder"}});
  const before=f.state.events.length;await f.renderer.ownNodes(host,"form")[0].handlers.submit.call(host,{preventDefault(){}});
  assert.equal(f.state.events.length,before+1);assert.equal(f.state.events.at(-1).type,"CollectionRenamed");
  assert.equal(f.state.events.at(-1).payload.new_handle,"Exact renamed folder");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const boundary of ["authorization","route","role"])test("collection actions fail closed after "+boundary+" changes",async()=>{
  const f=fixture();await f.store.append({type:"CollectionCreated",payload:{collection_id:"collection-a",handle:"Original",parent_collection_id:null,position:"a"}});
  const host=adoptPopoverHost(f,CollectionTree),trigger=f.renderer.ownNodes(host,"button").find(node=>node.attributes.popovertarget),panel=host.querySelector('[id="'+trigger.attributes.popovertarget+'"]');
  panel.showPopover();f.draw();const before=f.state.events.length;
  const action=f.renderer.ownNodes(host,"button").find(node=>node.handlers.click&&node.attributes.class===undefined&&!node.attributes.popovertarget);
  if(boundary==="authorization")f.state.authorization="actor-b";else if(boundary==="route")f.route="/canvas/projects";else f.state.viewer=true;
  action.handlers.click.call(host,{target:action,currentTarget:action});f.draw();
  assert.equal(f.openPopovers.size,0);assert.equal(f.renderer.ownNodes(host,"dialog").length,0);
  assert.equal(f.state.events.length,before);assert.equal(f.state.requests.length,0);
});

test("actual slides viewer actions reuse the shared popover while non-slide actions remain inline",async()=>{
  const f=fixture({artifact:true}),artifact=addFixtureDeck(f);
  const host=adoptPopoverHost(f,DocumentArtifacts,{documentId:"document-0"});
  const open=f.renderer.ownNodes(host,"button").find(node=>node.attributes["data-forma-content"]==="primary");
  assert.ok(open);await open.handlers.click.call(host,{target:open,currentTarget:open});f.draw();
  const {menu}=ownedPopover(f,"artifact-viewer-actions-popover",host);
  assert.equal(menu.label,f.i18n.t("action.more","More actions"));
  assert.ok(menu.markup.includes("Output history"));assert.ok(menu.markup.includes("Edit finished output"));assert.equal(f.state.requests.length,0);
  assert.equal(artifact.kind,"slides");
  const g=fixture({artifact:true});const inlineHost=adoptPopoverHost(g,DocumentArtifacts,{documentId:"document-0"});
  const inlineOpen=g.renderer.ownNodes(inlineHost,"button").find(node=>node.attributes["data-forma-content"]==="primary");
  await inlineOpen.handlers.click.call(inlineHost,{target:inlineOpen,currentTarget:inlineOpen});g.draw();
  assert.equal(g.renderer.query(inlineHost,"forma-ui-popover").filter(child=>child.attributes.class==="artifact-viewer-actions-popover").length,0);
  assert.ok(g.renderer.markup.includes("Download Markdown"));
  assert.equal(g.state.requests.length,0);
});

test("actual Canvas slides viewer and soundtrack retain native popovers with no automatic provider request",async()=>{
  const f=fixture({artifact:true,populated:true});addFixtureDeck(f);
  await f.store.append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"deck-item",source_kind:"artifact",source_id:"artifact-a",title:"Exact deck",block_type:"slides",frame:{x:20,y:20,w:320,h:240,z:"z"}}});f.draw();
  const button=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="canvas-artifact-open");
  assert.ok(button,"the actual existing artifact opener is available");await button.handlers.click.call(f.host,{target:button,currentTarget:button,stopPropagation(){}});f.draw();
  ownedPopover(f,"artifact-viewer-actions-popover");
  const decks=f.renderer.query(f.host,"forma-presentation-deck");assert.equal(decks.length,1);
  const soundtrack=ownedPopover(f,"presentation-deck-soundtrack",decks[0]);assert.ok(soundtrack.menu.markup.includes("audio"));
  assert.ok(decks[0].markup.includes('popover="auto"'));
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("shared positioning stays inside a keyboard-reduced visual viewport even when its trigger is outside it",()=>{
  const values=new Map();
  const view={innerWidth:980,innerHeight:720,visualViewport:{width:320,height:240,offsetLeft:90,offsetTop:100},getComputedStyle:element=>element.trigger?{direction:"ltr"}:{width:"384px",getPropertyValue:()=>"0px"}};
  const trigger={trigger:true,isConnected:true,ownerDocument:{defaultView:view},getBoundingClientRect:()=>({left:880,right:960,top:650,bottom:694})};
  const panel={isConnected:true,setAttribute(){},style:{setProperty:(name,value)=>values.set(name,value)}};
  positionNativePopover(trigger,panel);
  assert.equal(values.get("--forma-popover-left"),"98px");
  assert.equal(values.get("--forma-popover-max-width"),"304px");
  assert.equal(values.get("--forma-popover-bottom"),"394px");
  assert.equal(values.get("--forma-popover-max-height"),"218px");
  const bottom=view.innerHeight-Number.parseFloat(values.get("--forma-popover-bottom"));
  assert.ok(bottom<=view.visualViewport.offsetTop+view.visualViewport.height-8);
  assert.ok(bottom-Number.parseFloat(values.get("--forma-popover-max-height"))>=view.visualViewport.offsetTop+8);
});

async function openFixtureSlides(f,surface){
  addFixtureDeck(f);
  if(surface==="document"){
    const host=adoptPopoverHost(f,DocumentArtifacts,{documentId:"document-0"});
    const opener=f.renderer.ownNodes(host,"button").find(node=>node.attributes["data-forma-content"]==="primary");
    await opener.handlers.click.call(host,{target:opener,currentTarget:opener});
  }else{
    await f.store.append({type:"CanvasItemPlaced",payload:{project_id:"p",canvas_id:"board-a",item_id:"deck-item",source_kind:"artifact",source_id:"artifact-a",title:"Exact deck",block_type:"slides",frame:{x:20,y:20,w:320,h:240,z:"z"}}});f.draw();
    const opener=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="canvas-artifact-open");
    await opener.handlers.click.call(f.host,{target:opener,currentTarget:opener,stopPropagation(){}});
  }
  f.draw();return openOwnedPopover(f,"artifact-viewer-actions-popover");
}

for(const surface of ["document","canvas"])for(const boundary of ["authorization","route","dialog-close"])test(surface+" slides action popover closes at "+boundary+" with its original private guards intact",async()=>{
  const f=fixture({artifact:true,populated:true}),owned=await openFixtureSlides(f,surface),before=f.state.events.length;
  if(boundary==="authorization")f.state.authorization="actor-b";
  else if(boundary==="route")f.route="/canvas/projects";
  else if(surface==="document")f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class==="document-artifact-view").close();
  else{
    const close=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes["aria-label"]==="Close document output");
    close.handlers.click.call(f.host,{target:close,currentTarget:close});
  }
  f.draw();assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  assert.equal(f.state.events.length,before);assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const surface of ["document","canvas"])test(surface+" slides action capture blocks a stale principal before any original action executes",async()=>{
  const f=fixture({artifact:true,populated:true}),owned=await openFixtureSlides(f,surface),before=f.state.events.length;
  const body=f.renderer.ownNodes(owned.menu,"div").find(node=>node.attributes.class==="artifact-viewer-actions-body");
  const action=f.renderer.ownNodes(owned.menu,"button").find(node=>!node.attributes.popovertarget);
  let prevented=false,stopped=false;f.state.authorization="actor-b";
  runPortHandler(body.handlers.click,owned.menu,{target:action,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  assert.equal(f.state.events.length,before);assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("actual soundtrack popover closes on authority change and keeps cue/transcript disclosures inline",async()=>{
  const f=fixture({artifact:true,populated:true});await openFixtureSlides(f,"canvas");
  const deck=f.renderer.query(f.host,"forma-presentation-deck")[0],soundtrack=openOwnedPopover(f,"presentation-deck-soundtrack",deck);
  const audio=f.renderer.ownNodes(soundtrack.menu,"audio")[0];
  const disclosures=f.renderer.ownNodes(soundtrack.menu,"details");
  assert.equal(disclosures.length,2);assert.deepEqual(disclosures.map(node=>node.attributes.class).sort(),["forma-audio-cues","forma-audio-transcript"]);
  assert.ok(disclosures.every(node=>!Object.hasOwn(node.attributes,"popover")&&!Object.hasOwn(node.attributes,"open")));
  assert.ok(soundtrack.menu.markup.includes("Exact authored listening notes"));assert.ok(soundtrack.menu.markup.includes("Exact cue"));
  assert.equal(audio.attributes.preload,"none");assert.ok(Object.hasOwn(audio.attributes,"controls"));assert.equal(Object.hasOwn(audio.attributes,"autoplay"),false);
  f.state.authorization="actor-b";f.draw();
  assert.equal(f.openPopovers.has(soundtrack.panel.attributes.id),false);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const boundary of ["authorization","board","route"])test("the exact old intent form cannot submit after "+boundary+" changes before rendering",async()=>{
  const f=fixture({populated:true});openOwnedPopover(f,"canvas-intent-dock");
  const input=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.maxlength==="2000");
  input.handlers.input.call(f.host,{target:{value:"Exact intent belongs to this scope"}});f.draw();
  // Select the actual emitted intent form, not a replacement executor.
  const intent=ownedPopover(f,"canvas-intent-dock");
  const actualForm=f.renderer.ownNodes(intent.menu,"form")[0];assert.ok(actualForm);
  if(boundary==="authorization")f.state.authorization="actor-b";
  else if(boundary==="board")f.state.boardId="board-b";
  else f.route="/canvas/projects";
  actualForm.handlers.submit.call(f.host,{preventDefault(){}});
  await f.flush();
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

// Phase7 integration: actual Canvas renderer/handlers and native-control ports.
// No browser, AT, live provider, second-user or production acceptance is claimed.
const { outcomeDeskCopy } = await loadActual("src/components/design-system/locales/outcome-recipe-messages.ts");
const { outcomeDeskIntegrationCopy } = await loadActual("src/components/design-system/locales/outcome-desk-integration-messages.ts");
const { outcomeArrangementRevisions, previewOutcomeArrangement } = await import("../src/canvas/outcome-arrangements.ts");
const flushUntil = async (f, ready) => { for(let n=0;n<30&&!ready();n++)await f.flush(); assert.ok(ready(),"bounded host settlement "+JSON.stringify({requests:f.state.requests,trace:f.trace.slice(-8),markup:f.renderer.markup.slice(-5000)})); };

for(const locale of ["en","fr","ar","ja"])test("actual "+locale+" Canvas Desk switch and recipe preserve mounted authoring and original draft", {concurrency:false,timeout:60_000}, async t => {
  await withCanvasCalmNavigation(t,{selected:true,locale},async p=>{
    await p.select();
    const {f,canvas}=p,editor=p.editor(),draft="User-authored intent — do not submit or translate";
    await p.setIntent(draft);
    const before=JSON.stringify(f.store.events.get()),selection=p.selected();
    await p.desk();
    assert.ok(f.store.route.get().includes("posture=outcomes"));
    const stage=p.row("section",node=>node.owner===canvas&&node.attributes.class==="canvas-stage-shell",false);
    assert.ok(Object.hasOwn(stage.attributes,"hidden"));assert.ok(Object.hasOwn(stage.attributes,"inert"));
    assert.equal(p.editor(),editor);
    assert.equal(p.intent().port.value,draft);
    assert.ok(f.renderer.markup.includes(escapeText(outcomeDeskCopy(locale).heading)));
    assert.equal(f.components().filter(choice=>choice.tag==="forma-ui-choice-card"&&String(choice.value??"").includes(":delivery:")).length,0,"no first object chosen");
    const section=p.row("section",node=>node.owner===canvas&&node.attributes.class==="outcome-desk");
    assert.equal(section.attributes.dir,locale==="ar"?"rtl":"ltr");
    await p.openArrangement();
    const recipe=p.row("select",node=>node.owner===canvas&&String(node.handlers.change).includes("outcomeRecipe"));
    assert.ok(recipe);recipe.port.value="film-continuity";await f.act(recipe,"change");await p.settle();
    assert.ok(f.store.route.get().includes("recipe=film-continuity"));
    assert.equal(JSON.stringify(f.store.events.get()),before);assert.deepEqual(p.selected(),selection);
    await p.cancelArrangement();
    await p.desk();
    assert.ok(!f.store.route.get().includes("posture=outcomes"));
    assert.equal(p.intent().port.value,draft);
    assert.equal(p.editor(),editor);
    await p.quiet();
  });
});

test("actual Canvas receipt review enables an exact Apply and only retrieval after HTTP uncertainty", async () => {
  const f=fixture({populated:true,chosen:"document-0"});
  await f.select(0,"document");await f.select(0,"block",true);
  f.route="/canvas/board-a/board-a?recipe=campaign";
  let preview;
  f.arrangementTransport=async command=>{
    if(command.action==="preview"){
      const canvas=f.store.canvasProjection.get(),projection=f.store.projection.get(),revisions=await outcomeArrangementRevisions(projection,canvas,f.state.selected);
      assert.equal(revisions.ok,true);
      const draft=previewOutcomeArrangement({canvas,selectedItemIds:f.state.selected,authorityKey:f.state.authorization,actorId:"owner",siteId:"owner:host",
        canRead:true,canArrange:true,atomicTransportAvailable:true,...revisions.value},command);
      assert.equal(draft.ok,true);
      preview={...draft.value.request,before:draft.value.before,after:draft.value.after,previewId:"retained-preview",approvalHash:"a".repeat(64),
        arrangementId:"outcome-arrangement:"+ "b".repeat(64),expiresAt:new Date(Date.now()+60_000).toISOString(),
        providerCalls:0,maximumMicrousd:0,maximumEvents:201,changesSemantics:false};
      return{ok:true,status:200,body:{status:"review",preview}};
    }
    if(command.action==="apply"){
      assert.equal(command.confirmed,true);assert.equal(command.previewId,preview.previewId);assert.equal(command.approvalHash,preview.approvalHash);
      assert.deepEqual(command.selectedItemIds,preview.selectedItemIds);
      throw new Error("Mock HTTP lost after submission; the host cannot infer applied");
    }
    assert.equal(command.action,"retrieve");
    return{ok:true,status:202,body:{status:"applying",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId,previewId:preview.previewId}};
  };
  await f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
  const name=f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName"));
  name.handlers.input.call(f.host,{target:{value:"Human named arrangement"}});f.draw();
  const form=f.native("form",node=>node.attributes.class==="canvas-arrangement-form");
  form.handlers.submit.call(f.host,{preventDefault(){}});
  await flushUntil(f,()=>Boolean(f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>preview&&choice.value===preview.operationId&&!choice.disabled)));
  let apply=f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>choice.value===preview.operationId);
  assert.equal(apply.disabled,false);
  const before=JSON.stringify(f.state.events);
  await f.renderer.handler(apply,"button",()=>true)();await flushUntil(f,()=>f.renderer.markup.includes(escapeText(outcomeDeskIntegrationCopy("en").uncertain)));
  assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);
  assert.equal(JSON.stringify(f.state.events),before);assert.equal(f.state.batches.length,0);
  const retained=new URL(f.route,"https://fixture.invalid").searchParams.get("arrangement");
  assert.equal(retained,preview.operationId);
  await f.click("button",node=>node.handlers.click?.toString().includes("#retrieveArrangement()")&&!node.handlers.click?.toString().includes("#openArrangement()"));
  await flushUntil(f,()=>f.state.requests.at(-1)?.body.action==="retrieve");
  assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);
  assert.equal(f.state.requests.at(-1).body.operationId,retained);
  assert.equal(f.state.batches.length,0);
});

test("actual read-only Canvas Desk retains exact inspection and hides preparation/Apply authority", async () => {
  const f=fixture({populated:true,chosen:"document-0",viewer:true,artifact:true});
  f.route="/canvas/board-a/board-a?posture=outcomes&outcome=artifact%3Aartifact-a";f.draw();
  assert.ok(f.renderer.markup.includes("Saved exact story"));
  assert.equal(f.renderer.ownNodes(f.host,"section").some(node=>node.attributes.class==="outcome-desk-formats"),false);
  const arrange=f.native("button",node=>node.handlers.click?.toString().includes("#openArrangement()"));
  assert.ok(Object.hasOwn(arrange.attributes,"disabled"));
  const candidates=f.renderer.query(f.host,"forma-ui-choice-card").filter(choice=>String(choice.value).includes(":delivery:"));
  assert.equal(candidates.length,1);assert.equal(candidates[0].disabled,false);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});


test("actual Canvas receives the store's protected Undo request and opens only an exact free undo-preview", async () => {
  const f=fixture({populated:true,chosen:"document-0"}),items=[...f.store.canvasProjection.get().items].sort((a,b)=>a.id.localeCompare(b.id));
  const row=item=>({item_id:item.id,x:item.x,y:item.y,w:item.w,h:item.h});
  const original=f.append({type:"CanvasArrangementCreated",payload:{project_id:"p",canvas_id:"board-a",arrangement_id:"protected-layout",
    history_action_id:"protected-original",organization_action_id:"protected-original",history_owner_id:"owner",
    source_surface:"canvas-outcome-arrangement",recipe_id:"campaign",name:"Existing original",item_ids:items.map(item=>item.id),
    frames:items.map(row),previous_frames:items.map(item=>({...row(item),x:item.x-20,y:item.y-30})),
    source_items:items.map(item=>({item_id:item.id,source_id:item.sourceId,source_kind:item.sourceKind,rot:item.rot,z:item.z})),
  }});
  f.arrangementTransport=async()=>({ok:false,status:409,body:{error:"fixture_has_no_retained_server_preview"}});
  f.store.canvasArrangementUndoRequest.set({eventId:original.eventId,operationId:"protected-original",projectId:"p",canvasId:"board-a",authorityKey:f.state.authorization});
  f.draw();await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="undo-preview"));
  const request=f.state.requests.find(request=>request.body.action==="undo-preview");
  assert.equal(request.body.undoOperationId,"protected-original");assert.notEqual(request.body.operationId,"protected-original");
  assert.deepEqual(request.body.selectedItemIds,items.map(item=>item.id));
  assert.equal(request.body.recipeId,"campaign");assert.equal(request.body.confirmed,undefined);
  assert.equal(f.store.canvasArrangementUndoRequest.get(),null,"consume the transient request so remount cannot create another preview");
  assert.equal(f.state.requests.some(value=>value.body.action==="apply"),false);
  assert.equal(f.state.batches.length,0);
});


test("arrangement name drafts remain same-board state and are concealed on authority replacement", async () => {
  const f=fixture({populated:true,chosen:"document-0"});
  await f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
  const field=f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName"));
  field.handlers.input.call(f.host,{target:{value:"PRIVATE ARRANGEMENT NAME"}});f.draw();
  let dialog=f.native("dialog",node=>node.attributes.class?.includes("canvas-outcome-arrangement-dialog"));
  dialog.handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();
  await f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
  assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"PRIVATE ARRANGEMENT NAME");
  f.state.authorization="another-actor";f.draw();
  assert.equal(f.native("dialog",node=>node.attributes.class?.includes("canvas-outcome-arrangement-dialog")),undefined);
  await f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
  assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});


test("Desk and arrangement-dialog keyboard events never mutate the hidden board selection", {concurrency:false,timeout:60_000}, async t => {
  await withCanvasCalmNavigation(t,{selected:true},async p=>{
    await p.select();
    const {f,canvas}=p,before=JSON.stringify(f.store.events.get()),selection=p.selected();
    await p.desk();
    const heading=p.row("h2",node=>node.owner===canvas&&node.attributes.id==="canvas-outcome-desk-heading");
    // This is the original Canvas callback observed at actual native registration,
    // not listeners[0] (which now correctly belongs to the full Shell).
    const keydown=p.keyboard;
    assert.ok(heading);assert.equal(typeof keydown,"function");
    for(const key of ["ArrowLeft","ArrowDown","Delete","Backspace","f","e","n","d","b","Escape"]){
      keydown({key,composedPath:()=>[heading.port],metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,
        preventDefault(){assert.fail("Desk must not intercept board shortcuts");},stopPropagation(){}});
    }
    await p.settle();assert.deepEqual(p.selected(),selection);assert.equal(JSON.stringify(f.store.events.get()),before);
    await p.desk();
    await p.openArrangement();
    const dialogHeading=p.row("h2",node=>node.owner===canvas&&node.attributes.id==="canvas-arrangement-heading");
    keydown({key:"Escape",composedPath:()=>[dialogHeading.port],metaKey:false,ctrlKey:false,altKey:false,
      preventDefault(){assert.fail("The native dialog owns Escape");},stopPropagation(){}});
    await p.cancelArrangement();
    assert.deepEqual(p.selected(),selection);await p.quiet();
  });
});


// Phase7 R3: delayed continuations execute actual handlers; no browser/native/AT certificate.
const continuityDeferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const continuityTurn=()=>new Promise(setImmediate);
const arrangementNode=f=>f.native("dialog",node=>node.attributes.class?.includes("canvas-outcome-arrangement-dialog"));
const openArrangement=f=>f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
const setArrangementName=(f,value)=>{const field=f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName"));assert.ok(field);field.handlers.input.call(f.host,{target:{value}});f.draw();};
async function mockArrangementReview(f,command){
  const canvas=f.store.canvasProjection.get(),projection=f.store.projection.get(),revisions=await outcomeArrangementRevisions(projection,canvas,command.selectedItemIds);
  assert.equal(revisions.ok,true);
  const draft=previewOutcomeArrangement({canvas,selectedItemIds:command.selectedItemIds,authorityKey:f.state.authorization,actorId:"owner",siteId:"owner:host",
    canRead:true,canArrange:true,atomicTransportAvailable:true,...revisions.value},command);assert.equal(draft.ok,true);
  return{ok:true,status:200,body:{status:"review",preview:{...draft.value.request,before:draft.value.before,after:draft.value.after,previewId:"retained-"+command.operationId,
    approvalHash:"a".repeat(64),arrangementId:"outcome-arrangement:"+"b".repeat(64),expiresAt:new Date(Date.now()+60_000).toISOString(),providerCalls:0,maximumMicrousd:0,maximumEvents:201,changesSemantics:false}}};
}
async function namedArrangement(f){
  await f.select(0,"document");await f.select(0,"block",true);f.route="/canvas/board-a/board-a?recipe=campaign";
  f.arrangementTransport=command=>mockArrangementReview(f,command);await openArrangement(f);setArrangementName(f,"Retained exact human name");
  f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit.call(f.host,{preventDefault(){}});
  await flushUntil(f,()=>f.renderer.query(f.host,"forma-ui-choice-card").some(choice=>choice.value===f.state.requests[0]?.body.operationId&&!choice.disabled));
}
function protectedArrangement(f){
  const items=[...f.store.canvasProjection.get().items].sort((a,b)=>a.id.localeCompare(b.id)),row=item=>({item_id:item.id,x:item.x,y:item.y,w:item.w,h:item.h});
  const original=f.append({type:"CanvasArrangementCreated",payload:{project_id:"p",canvas_id:"board-a",arrangement_id:"protected-layout",
    history_action_id:"protected-original",organization_action_id:"protected-original",history_owner_id:"owner",source_surface:"canvas-outcome-arrangement",
    recipe_id:"campaign",name:"Original authored layout",item_ids:items.map(item=>item.id),frames:items.map(row),previous_frames:items.map(item=>({...row(item),x:item.x-20,y:item.y-30})),
    source_items:items.map(item=>({item_id:item.id,source_id:item.sourceId,source_kind:item.sourceKind,rot:item.rot,z:item.z}))}});
  return original;
}

test("R3 queued native Close from A cannot close a reopened arrangement B",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await openArrangement(f);setArrangementName(f,"Original human draft");
  const first=arrangementNode(f),close=first.handlers.close;first.handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();
  await openArrangement(f);setArrangementName(f,"Newer opening draft");assert.ok(arrangementNode(f));
  close.call(f.host,{currentTarget:first,target:first});await f.flush();
  assert.ok(arrangementNode(f),"old native close owns A only");
  assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"Newer opening draft");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("R3 current native Close, Escape and backdrop keep normal draft-preserving behavior",async()=>{
  for(const kind of ["close","cancel","backdrop"]){
    const f=fixture({populated:true,chosen:"document-0"});await openArrangement(f);setArrangementName(f,"Normal retained draft");
    const dialog=arrangementNode(f);
    if(kind==="close"){dialog.open=false;dialog.handlers.close.call(f.host,{currentTarget:dialog,target:dialog});}
    else if(kind==="cancel")dialog.handlers.cancel.call(f.host,{currentTarget:dialog,target:dialog,preventDefault(){}});
    else dialog.handlers.click.call(f.host,{currentTarget:dialog,target:dialog});
    await f.flush();assert.equal(arrangementNode(f),undefined);assert.equal(f.state.requests.length,0);
    await openArrangement(f);assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"Normal retained draft");
  }
});

test("R3 late explicit Cancel acknowledgement cannot close a newer opening of the retained arrangement",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await namedArrangement(f);const gate=continuityDeferred();
  f.arrangementTransport=command=>{assert.equal(command.action,"dismiss");return gate.promise;};
  const cancel=f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement"));
  assert.ok(cancel);cancel.handlers.click.call(f.host);await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="dismiss"));
  const original=f.state.requests[0].body,handle=f.route;
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);
  gate.resolve({ok:true,status:200,body:{status:"dismissed",operationId:original.operationId,projectId:original.projectId,canvasId:original.canvasId}});
  await continuityTurn();await f.flush();assert.ok(arrangementNode(f),"late acknowledgement must not own the replacement opening");
  assert.equal(f.route,handle);assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"Retained exact human name");
  assert.equal(f.state.requests.filter(request=>request.body.action==="dismiss").length,1);assert.equal(f.state.batches.length,0);
});

test("R3 normal explicit Cancel closes only after the exact acknowledgement and preserves the name",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await namedArrangement(f);const gate=continuityDeferred(),original=f.state.requests[0].body;
  f.arrangementTransport=command=>{assert.equal(command.action,"dismiss");return gate.promise;};
  f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement")).handlers.click.call(f.host);
  await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="dismiss"));assert.ok(arrangementNode(f));
  gate.resolve({ok:true,status:200,body:{status:"dismissed",operationId:original.operationId,projectId:original.projectId,canvasId:original.canvasId}});
  await continuityTurn();await f.flush();assert.equal(arrangementNode(f),undefined);
  await openArrangement(f);assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"Retained exact human name");
  assert.equal(f.state.requests.filter(request=>request.body.action==="dismiss").length,1);
});

test("R3 late preview after normal Close retains its exact URL receipt without reopening or applying",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await f.select(0,"document");await f.select(0,"block",true);
  f.route="/canvas/board-a/human-slug?recipe=campaign&posture=outcomes#kept";const gate=continuityDeferred();
  f.arrangementTransport=()=>gate.promise;await openArrangement(f);setArrangementName(f,"Name typed before Close");
  f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit.call(f.host,{preventDefault(){}});
  await flushUntil(f,()=>f.state.requests.length===1);const command=f.state.requests[0].body,receipt=await mockArrangementReview(f,command),handle=f.route;
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();gate.resolve(receipt);await continuityTurn();await f.flush();
  assert.equal(arrangementNode(f),undefined);assert.equal(f.route,handle);assert.ok(f.route.endsWith("#kept"));assert.ok(f.route.includes("human-slug"));
  await openArrangement(f);assert.ok(f.renderer.markup.includes("Name typed before Close"));assert.ok(f.renderer.markup.includes(command.operationId));
  assert.equal(f.state.requests.length,1);assert.equal(f.state.batches.length,0);
});

test("R3 late private preview after authority replacement does not reopen or reveal the old name",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await f.select(0,"document");await f.select(0,"block",true);f.route="/canvas/board-a/board-a?recipe=campaign";
  const gate=continuityDeferred();f.arrangementTransport=()=>gate.promise;await openArrangement(f);setArrangementName(f,"PRIVATE PENDING NAME");
  f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit.call(f.host,{preventDefault(){}});
  await flushUntil(f,()=>f.state.requests.length===1);const receipt=await mockArrangementReview(f,f.state.requests[0].body),handle=f.route;
  f.state.authorization="different-current-authority";f.draw();gate.resolve(receipt);await continuityTurn();await f.flush();
  assert.equal(arrangementNode(f),undefined);await openArrangement(f);assert.ok(!f.renderer.markup.includes("PRIVATE PENDING NAME"));
  assert.equal(f.route,handle);assert.equal(f.state.requests.length,1);assert.equal(f.state.batches.length,0);
});

test("R3 Close during pre-preview queue settlement does not allocate a hidden arrangement",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await f.select(0,"document");await f.select(0,"block",true);f.route="/canvas/board-a/board-a?recipe=campaign";
  await openArrangement(f);setArrangementName(f,"Human cancelled opening");const originalList=offlinePort.listBatches,gate=continuityDeferred();let entered=false;
  offlinePort.listBatches=()=>{entered=true;return gate.promise;};
  try{
    f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit.call(f.host,{preventDefault(){}});
    await flushUntil(f,()=>entered);const route=f.route;arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();
    gate.resolve([]);await continuityTurn();await f.flush();assert.equal(f.state.requests.length,0);assert.equal(f.route,route);assert.equal(arrangementNode(f),undefined);
  }finally{offlinePort.listBatches=originalList;gate.resolve([]);}
});

for(const kind of ["authority","selection","source","close-reopen","posture"])test("R3 pending atomic Undo never retargets after "+kind+" changes",async()=>{
  const f=fixture({populated:true,chosen:"document-0"}),original=protectedArrangement(f),gate=continuityDeferred(),originalList=offlinePort.listBatches;let entered=false;
  f.arrangementTransport=async()=>({ok:false,status:409,body:{error:"No retained preview in this fixture"}});
  offlinePort.listBatches=()=>{entered=true;return gate.promise;};
  try{
    f.store.canvasArrangementUndoRequest.set({eventId:original.eventId,operationId:"protected-original",projectId:"p",canvasId:"board-a",authorityKey:f.state.authorization});f.draw();
    await flushUntil(f,()=>entered);f.draw();assert.ok(arrangementNode(f));
    if(kind==="authority"){f.state.authorization="another-current-authority";f.draw();}
    if(kind==="selection")await f.select(0,"block");
    if(kind==="source"){f.append({type:"BlockPropertyEdited",payload:{project_id:"p",document_id:"document-0",block_id:"block-0",property_path:"text",new_value:"New authored source arrived during Undo settlement"}});f.draw();assert.equal(f.store.projection.get().libraryBlocks.find(block=>block.id==="block-0").properties.text,"New authored source arrived during Undo settlement");}
    if(kind==="close-reopen"){arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);setArrangementName(f,"Replacement human draft");}
    if(kind==="posture"){f.route="/canvas/board-a/board-a?posture=outcomes";f.draw();}
    const before=JSON.stringify(f.state.events),route=f.route,selection=[...f.state.selected];
    gate.resolve([]);await continuityTurn();await f.flush();
    assert.equal(f.state.requests.length,0,"old Undo must not create a fresh receipt against changed ownership/source");
    assert.equal(JSON.stringify(f.state.events),before);assert.equal(f.route,route);assert.deepEqual(f.state.selected,selection);assert.equal(f.state.batches.length,0);
  }finally{offlinePort.listBatches=originalList;gate.resolve([]);}
});

for(const action of ["navigate","dismiss","restore"])test("R3 delayed Desk "+action+" focus belongs to its current route, authority, posture and modal owner",async t=>{
  if(action==="navigate"){
    for(const change of ["authority","route","modal","disconnect"])
      await withCanvasCalmNavigation(t,{selected:false},p=>canvasCalmDeskRowJourney(p,change));
    return;
  }
  for(const change of ["authority","route","modal","disconnect"]){
    const f=fixture({populated:true,chosen:"document-0",artifact:true});
    f.route="/canvas/board-a/board-a?posture=outcomes&outcome=artifact%3Aartifact-a";f.draw();
    if(action==="restore"){const dismiss=f.native("button",node=>node.handlers.click?.toString().includes("ports.dismiss"));assert.ok(dismiss);dismiss.handlers.click.call(f.host);await f.flush();}
    const gate=continuityDeferred();f.tick=()=>gate.promise;
    let trigger;
    if(action==="navigate")trigger=f.native("a",node=>String(node.attributes.href??"").includes("document%3A"));
    else trigger=f.native("button",node=>node.handlers.click?.toString().includes(action==="dismiss"?"ports.dismiss":"ports.restoreSuggestions"));
    assert.ok(trigger,action+" is a real rendered control");trigger.handlers.click.call(f.host,{button:0,preventDefault(){},currentTarget:trigger,target:trigger});f.draw();
    if(change==="authority"){f.state.authorization="replacement-authority";f.draw();}
    if(change==="route"){f.route="/canvas/board-a/board-a";f.draw();}
    if(change==="modal")await openArrangement(f);
    if(change==="disconnect")f.host.isConnected=false;
    f.trace.length=0;gate.resolve(true);await continuityTurn();
    assert.equal(f.trace.filter(value=>value.startsWith("focus:")).length,0,action+" "+change+" cannot steal focus after ownership changed");
  }
});

test("R3 current Desk focus still lands on the exact requested element",async t=>{
  await withCanvasCalmNavigation(t,{selected:false},p=>canvasCalmDeskRowJourney(p));
});


test("R3 a queued close delivered to the current still-open native node cannot dismiss its reopening",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await openArrangement(f);
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);
  const current=arrangementNode(f);assert.equal(current.open,true);
  current.handlers.close.call(f.host,{currentTarget:current,target:current});await f.flush();
  assert.ok(arrangementNode(f),"queued native events are not evidence that the current open node closed");
  const closed=arrangementNode(f);closed.open=false;closed.handlers.close.call(f.host,{currentTarget:closed,target:closed});await f.flush();
  assert.equal(arrangementNode(f),undefined,"a genuine current native Close still works");
});

for(const kind of ["name","recipe","submit"])test("R3 a detached arrangement "+kind+" handler cannot mutate a new opening",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await f.select(0,"document");await f.select(0,"block",true);
  f.route="/canvas/board-a/board-a?recipe=campaign";await openArrangement(f);setArrangementName(f,"Old private draft");
  const oldName=f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).handlers.input;
  const oldRecipe=f.native("select",node=>node.handlers.change?.toString().includes("outcomeRecipe")).handlers.change;
  const oldSubmit=f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit;
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);setArrangementName(f,"Current human draft");
  const route=f.route;
  if(kind==="name")oldName.call(f.host,{target:{value:"STALE PRIVATE INPUT"}});
  if(kind==="recipe")oldRecipe.call(f.host,{target:{value:"film-continuity"}});
  if(kind==="submit")oldSubmit.call(f.host,{preventDefault(){}});
  await continuityTurn();await f.flush();assert.equal(f.route,route);
  assert.equal(f.native("input",node=>node.handlers.input?.toString().includes("#arrangementName")).value,"Current human draft");
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

for(const action of ["apply","cancel"])test("R3 a detached exact review "+action+" callback cannot act on a newer opening",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await namedArrangement(f);
  const choice=f.renderer.query(f.host,"forma-ui-choice-card").find(value=>value.value===f.state.requests[0].body.operationId);
  const callback=action==="apply"?choice.eventBindings["forma-action"]:f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement")).handlers.click;
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);
  await flushUntil(f,()=>f.renderer.query(f.host,"forma-ui-choice-card").some(value=>value.value===f.state.requests[0].body.operationId&&!value.disabled));
  const before=f.state.requests.length,route=f.route;f.arrangementTransport=()=>({ok:false,status:409,body:{error:"A stale button must not have reached transport"}});
  callback.call(f.host);await continuityTurn();await f.flush();
  assert.equal(f.state.requests.length,before);assert.equal(f.route,route);assert.ok(arrangementNode(f));assert.equal(f.state.batches.length,0);
});

test("R3 only the newest Close owns deferred opener focus",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await openArrangement(f);const first=continuityDeferred(),second=continuityDeferred();
  f.tick=()=>first.promise;arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});f.draw();
  await openArrangement(f);f.tick=()=>second.promise;arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});f.draw();
  f.trace.length=0;second.resolve(true);await continuityTurn();const currentFocus=documentPort.activeElement,focusCount=f.trace.filter(value=>value.startsWith("focus:")).length;
  assert.equal(focusCount,1);first.resolve(true);await continuityTurn();
  assert.equal(documentPort.activeElement,currentFocus);assert.equal(f.trace.filter(value=>value.startsWith("focus:")).length,focusCount);
});

test("R3 current reopened exact review still requires and accepts a fresh human Apply",async()=>{
  const f=fixture({populated:true,chosen:"document-0"});await namedArrangement(f);const original=f.state.requests[0].body;
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);
  await flushUntil(f,()=>f.renderer.query(f.host,"forma-ui-choice-card").some(choice=>choice.value===original.operationId&&!choice.disabled));
  f.arrangementTransport=command=>{
    assert.equal(command.action,"apply");assert.equal(command.operationId,original.operationId);assert.equal(command.confirmed,true);
    return{ok:true,status:202,body:{status:"applying",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}};
  };
  const apply=f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>choice.value===original.operationId);
  await f.renderer.handler(apply,"button",()=>true)();await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="apply"));
  assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);assert.equal(f.state.requests.filter(request=>request.body.action==="preview").length,1);assert.equal(f.state.batches.length,0);
});


// Phase7 R4: current-authority receipt retrieval, still using the actual native Canvas host.
async function renewedAuthorityHost(){
  const f=fixture({populated:true,chosen:"document-0"});await f.select(0,"document");await f.select(0,"block",true);
  f.route="/canvas/board-a/human-route?recipe=campaign&posture=outcomes#retained";
  let receipt;f.arrangementTransport=async command=>{
    if(command.action==="preview"){const response=await mockArrangementReview(f,command);receipt=response.body.preview;return response;}
    if(command.action==="apply")throw new Error("Injected lost Apply response; no canonical saved outcome is inferred");
    if(command.action==="retrieve")return{ok:true,status:200,body:{status:"review",preview:receipt}};
    assert.equal(command.action,"dismiss");assert.equal(command.previewId,receipt.previewId);assert.equal(command.approvalHash,receipt.approvalHash);
    return{ok:true,status:200,body:{status:"dismissed",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}};
  };
  await openArrangement(f);setArrangementName(f,"Exact private arrangement before renewal");
  f.native("form",node=>node.attributes.class==="canvas-arrangement-form").handlers.submit.call(f.host,{preventDefault(){}});
  await flushUntil(f,()=>f.renderer.query(f.host,"forma-ui-choice-card").some(choice=>choice.value===receipt?.operationId&&!choice.disabled));
  const apply=f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>choice.value===receipt.operationId);
  await f.renderer.handler(apply,"button",()=>true)();await flushUntil(f,()=>f.renderer.markup.includes(escapeText(outcomeDeskIntegrationCopy("en").uncertain)));
  assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);
  return{f,preview:receipt};
}
const reopenOriginalReceipt=f=>f.click("button",node=>node.handlers.click?.toString().includes("#openArrangement()")&&node.handlers.click?.toString().includes("#retrieveArrangement()"));
const currentReceiptSettled=f=>{const select=f.native("button",node=>node.handlers.click?.toString().includes("#selectArrangementReceipt"));return Boolean(select&&!Object.hasOwn(select.attributes,"disabled"));};

for(const reader of [false,true])test("R4 actual Canvas renewed "+(reader?"reader":"author")+" retrieves the original after Close and permits current human Cancel",async()=>{
  const{f,preview}=await renewedAuthorityHost(),route=f.route,events=JSON.stringify(f.state.events),oldDialog=arrangementNode(f),oldClose=oldDialog.handlers.close,read=continuityDeferred(),transport=f.arrangementTransport;
  f.state.authorization="same-actor-new-permission-epoch";f.state.viewer=reader;f.draw();assert.equal(arrangementNode(f),undefined);
  const session=f.store.session.get(),permissions=session.projectContext?.permissions??session.capabilities;
  assert.equal(session.user.userId,"owner");assert.ok(permissions.includes("project.read"));assert.ok(permissions.includes("project.canvas.use"));
  f.arrangementTransport=command=>command.action==="retrieve"?read.promise:transport(command);
  await reopenOriginalReceipt(f);await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="retrieve"));
  assert.ok(!f.renderer.markup.includes(preview.name),"old private content is hidden until a current authenticated read succeeds");
  oldClose.call(f.host,{currentTarget:oldDialog,target:oldDialog});f.draw();assert.ok(arrangementNode(f),"old native Close cannot dismiss the renewed opening");
  const readCommand=f.state.requests.find(request=>request.body.action==="retrieve").body;
  assert.deepEqual(readCommand,{operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,action:"retrieve"});
  read.resolve({ok:true,status:200,body:{status:"review",preview}});
  await flushUntil(f,()=>f.renderer.markup.includes(preview.name)&&currentReceiptSettled(f));
  // Close and reopen stay native presentation actions; neither creates another preview.
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();await openArrangement(f);
  await flushUntil(f,()=>currentReceiptSettled(f)&&f.renderer.query(f.host,"forma-ui-choice-card").some(choice=>choice.value===preview.operationId&&choice.disabled===reader));
  const apply=f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>choice.value===preview.operationId);assert.equal(apply.disabled,reader);
  if(reader){await f.renderer.handler(apply,"button",()=>true)();await f.flush();assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);}
  f.arrangementTransport=transport;
  f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement")).handlers.click.call(f.host);
  await flushUntil(f,()=>!arrangementNode(f));
  assert.equal(f.state.requests.filter(request=>request.body.action==="retrieve").length,1);assert.equal(f.state.requests.filter(request=>request.body.action==="dismiss").length,1);
  assert.equal(f.state.requests.filter(request=>request.body.action==="preview").length,1);assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);
  assert.equal(f.route,route);assert.equal(JSON.stringify(f.state.events),events);assert.equal(f.state.batches.length,0);
});

for(const failure of ["HTTP","substituted-preview"])test("R4 actual Canvas preserves uncertainty/private concealment after renewed "+failure+" read",async()=>{
  const{f,preview}=await renewedAuthorityHost(),route=f.route,transport=f.arrangementTransport;
  f.state.authorization="renewed-current-reader";f.state.viewer=true;f.draw();
  f.arrangementTransport=async command=>{
    assert.equal(command.action,"retrieve");
    if(failure==="HTTP")return{ok:false,status:403,body:{error:"Current server read denied"}};
    return{ok:true,status:200,body:{status:"review",preview:{...preview,name:"UNTRUSTED SUBSTITUTED NAME"}}};
  };
  await reopenOriginalReceipt(f);await flushUntil(f,()=>f.state.requests.some(request=>request.body.action==="retrieve"));await f.flush();
  assert.ok(arrangementNode(f));assert.ok(!f.renderer.markup.includes(preview.name));assert.ok(!f.renderer.markup.includes("UNTRUSTED SUBSTITUTED NAME"));
  assert.equal(f.native("form",node=>node.attributes.class==="canvas-arrangement-form"),undefined,"unresolved intent cannot allocate another preview");
  assert.equal(f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement")),undefined,"no unverified Cancel command");
  assert.equal(f.route,route);
  arrangementNode(f).handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();f.arrangementTransport=transport;
  await reopenOriginalReceipt(f);await flushUntil(f,()=>f.renderer.markup.includes(preview.name)&&currentReceiptSettled(f));
  const apply=f.renderer.query(f.host,"forma-ui-choice-card").find(choice=>choice.value===preview.operationId);assert.ok(apply);assert.equal(apply.disabled,true);
  f.native("button",node=>node.handlers.click?.toString().includes("#dismissArrangement")).handlers.click.call(f.host);await flushUntil(f,()=>!arrangementNode(f));
  assert.equal(f.state.requests.filter(request=>request.body.action==="retrieve").length,2);assert.equal(f.state.requests.filter(request=>request.body.action==="apply").length,1);
  assert.equal(f.state.requests.filter(request=>request.body.action==="preview").length,1);assert.equal(f.route,route);assert.equal(f.state.batches.length,0);
});





const arrangementNameBoundsByLocale = { en: /1–80/u, fr: /1 à 80/u, ar: /١ إلى ٨٠/u, ja: /1〜80/u };
for (const locale of ["en", "fr", "ar", "ja"]) test("actual " + locale + " arrangement renderer matches the 80-code-point name contract", async () => {
  const message = outcomeDeskCopy(locale).issues.name;
  assert.match(message, arrangementNameBoundsByLocale[locale], "the real localized error states the accepted bound");
  const names = [
    ["ASCII", "a".repeat(80)],
    ["astral", "\u{1f680}".repeat(80)],
    ["NFC", "\u00e9".repeat(80)],
    ["combining", "e\u0301".repeat(40)],
    ["ZWJ", "\u{1f469}\u200d\u{1f4bb}".repeat(26) + "ab"],
  ];
  for (const [label, boundary] of names) for (const valid of [true, false]) {
    const f = fixture({ populated: true, chosen: "document-0", locale });
    await f.select(0, "document"); await f.select(0, "block", true);
    f.route = "/canvas/board-a/board-a?recipe=campaign";
    f.arrangementTransport = command => mockArrangementReview(f, command);
    await openArrangement(f);
    const name = boundary + (valid ? "" : "x"), before = JSON.stringify(f.state.events);
    setArrangementName(f, name);
    const input = f.native("input", node => node.handlers.input?.toString().includes("#arrangementName"));
    const submit = f.native("button", node => node.attributes.type === "submit" && node.attributes.class === "button primary");
    assert.ok(input && submit); assert.equal(input.value, name);
    assert.equal(Object.hasOwn(submit.attributes, "disabled"), !valid, label + ": actual preview control counts Unicode code points");
    assert.equal(input.attributes.maxlength, undefined, "native UTF-16 maxlength must not truncate 80 astral characters");
    f.native("form", node => node.attributes.class === "canvas-arrangement-form").handlers.submit.call(f.host, { preventDefault() {} });
    if (valid) {
      await flushUntil(f, () => f.renderer.query(f.host, "forma-ui-choice-card").some(choice => choice.value === f.state.requests[0]?.body.operationId && !choice.disabled));
      assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].body.action, "preview");
      assert.equal(f.state.requests[0].body.name, name, "the real model/controller preserves the submitted authored form");
      assert.ok(f.renderer.markup.includes("<bdi>" + escapeText(name) + "</bdi>"), "the actual review renderer preserves the exact name");
    } else {
      await flushUntil(f, () => f.renderer.markup.includes(escapeText(message)));
      assert.equal(f.state.requests.length, 0, "even a direct form submission cannot bypass the model's name rejection");
      assert.ok(f.native("form", node => node.attributes.class === "canvas-arrangement-form"));
      assert.equal(f.native("input", node => node.handlers.input?.toString().includes("#arrangementName")).value, name, "invalid drafts remain editable");
    }
    assert.equal(f.state.batches.length, 0); assert.equal(JSON.stringify(f.state.events), before);
    f.host.disconnectedCallback();
  }
  const f = fixture({ populated: true, chosen: "document-0", locale });
  await f.select(0, "document"); await f.select(0, "block", true);
  f.route = "/canvas/board-a/board-a?recipe=campaign"; await openArrangement(f);
  const before = JSON.stringify(f.state.events); setArrangementName(f, "Before\u0085After");
  f.native("form", node => node.attributes.class === "canvas-arrangement-form").handlers.submit.call(f.host, { preventDefault() {} });
  await flushUntil(f, () => f.renderer.markup.includes(escapeText(message)));
  assert.equal(f.state.requests.length, 0, "Unicode C1 control characters are rejected by the real model before transport");
  assert.equal(f.state.batches.length, 0); assert.equal(JSON.stringify(f.state.events), before);
  f.host.disconnectedCallback();
});

for(const locale of ["en","ar"])test("native View returns Desk focus to its exact instance invoker in "+locale,{concurrency:false,timeout:60_000},async t=>{
  let id;
  await withCanvasCalmNavigation(t,{locale},async p=>{
    const {f}=p;id=p.viewTrigger().attributes.id;const before=JSON.stringify(f.store.events.get());
    assert.ok(id&&id!=="canvas-view-toggle");
    for(const expectedDesk of [true,false]){
      const owned=await p.desk();
      assert.equal(f.renderer.openPopovers.has(owned.panelId),false);
      assert.equal(new URL(f.store.route.get(),"https://fixture.invalid").searchParams.get("posture")==="outcomes",expectedDesk);
      const active = f.native.document.activeElement, write = f.native.nativeFocus.at(-1);
      const witness = p.focusEvidence.findLast(value => value.node === active && value.write === write);
      const expectedId = expectedDesk ? "canvas-outcome-desk-heading" : id;
      t.diagnostic("CANVAS_CALM_NATIVE_VIEW_FOCUS " + JSON.stringify({ expectedId, reflectedId: active?.id,
        attributeId: active?.getAttribute?.("id"), exactOriginalWrite: write?.node === active,
        connectedAtCall: witness?.connectedAtCall, exactCurrentRowsAtCall: witness?.exactCurrentRows,
        sameCanvasAtCall: witness?.sameCanvas, matchingIdsAtCall: witness?.matchingIds,
        currentRowsAfterSettlement: f.tree().nodes.filter(value => value.port === active).length,
        evidence: "original native focus write, not a remapped activeElement or browser lifetime certificate" }));
      assert.strictEqual(write?.node, active); assert.ok(witness);
      assert.equal(witness.connectedAtCall, true); assert.equal(witness.exactCurrentRows, 1);
      assert.equal(witness.sameCanvas, true); assert.equal(witness.matchingIds, 1);
      assert.strictEqual(witness.owner, expectedDesk ? p.canvas : p.popover("canvas-view-menu"));
      assert.equal(witness.id, expectedId); assert.equal(witness.attributeId, expectedId);
      assert.equal(active?.getAttribute?.("id"), expectedId);
      assert.equal(f.native.document.activeElement?.id,expectedDesk?"canvas-outcome-desk-heading":id);
    }
    assert.equal(JSON.stringify(f.store.events.get()),before);await p.quiet();
  });
  // A separately mounted actual full host still has its own original invoker ID.
  // Retire the first fixture before installing another native document boundary.
  await withCanvasCalmNavigation(t,{locale},async another=>{
    assert.notEqual(another.viewTrigger().attributes.id,id);await another.quiet();
  });
});


test("native arrangement opening and Close use the current View trigger without a stale summary target",async()=>{
  const f=fixture({populated:true}),owned=openOwnedPopover(f,"canvas-view-menu"),group=f.renderer.ownNodes(owned.menu,"div").find(node=>node.attributes.class==="canvas-view-actions");
  const action=f.renderer.ownNodes(owned.menu,"button").find(node=>node.handlers.click?.toString().includes("#openArrangement()")&&!node.handlers.click?.toString().includes("#retrieveArrangement()"));
  runPortHandler(group.handlers.click,owned.menu,{type:"click",target:action,preventDefault(){assert.fail("current arrangement action");},stopImmediatePropagation(){assert.fail("current scope");}});
  action.handlers.click.call(f.host,{target:action,currentTarget:action});await f.flush();
  assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  const dialog=arrangementNode(f);assert.ok(dialog);dialog.handlers.cancel.call(f.host,{preventDefault(){}});await f.flush();
  assert.equal(documentPort.activeElement?.id,owned.trigger.attributes.id);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

// Phase8 integration: the entire staged Canvas class (willUpdate/render/updated/
// disconnect), its real arrangement controller, and the actual presence hub.
// The channel, clock, focus and DOM ports remain in-memory; this is not a native,
// cross-person, remote-device, server-authorization or live-provider certificate.
function localPresenceCursors(f) {
  return f.renderer.ownNodes(f.host, "span").filter(node => node.attributes.class === "canvas-presence");
}
function meetLocalPresence(f, tabId = "other-tab") {
  const channel = f.presence.channels.filter(value => !value.closed &&
    value.posts.some(frame => frame.tabId === "host-tab")).at(-1);
  assert.ok(channel, "actual updated opened the scoped local channel");
  const { userId, projectId, canvasId, authorizationKey } = channel.posts.at(-1);
  const peer = f.presence.hub(tabId, { userId, projectId, canvasId, authorizationKey });
  peer.hub.update({ x: 24, y: 60, selectedItemId: "item-document-1" });
  f.presence.flush(); f.draw();
  assert.equal(localPresenceCursors(f).length, 1);
  return { ...peer, hostChannel: channel };
}
function disconnectPresenceFixture(f, peer) {
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.presence.channels.filter(channel => !channel.closed &&
    channel.posts.some(frame => frame.tabId === "host-tab")).length, 0, "disconnect closes owned channels before a peer leaves");
  peer.hub.disconnect(); f.presence.flush();
  assert.equal(f.canvasIntervals.size, 0);
  assert.equal(f.presence.timers.size, 0);
}

for (const locale of ["en", "fr", "ar", "ja"]) test("actual " + locale + " Canvas renders only local-tab presence without changing authored selection", async () => {
  const f = fixture({ presence: true, populated: true, documentCount: 2, chosen: "document-0", locale, undo: true });
  await f.select(0);
  const events = JSON.stringify(f.state.events), selected = [...f.state.selected];
  const peer = meetLocalPresence(f), frame = peer.channel.posts.at(-1);
  f.presence.inject(peer.hostChannel, { ...frame, sequence: frame.sequence + 1,
    name: "Untrusted <script>sender</script>", color: "url(https://untrusted.invalid/)" });
  f.draw();
  const cursor = localPresenceCursors(f)[0];
  assert.equal(cursor.attributes.role, "img");
  assert.equal(cursor.attributes["aria-label"], f.i18n.t("canvas.presence.otherTab") + ". " + f.i18n.t("canvas.presence.localOnly"));
  assert.equal(cursor.attributes["aria-live"], undefined);
  assert.ok(!f.renderer.markup.includes("Untrusted <script>sender</script>"));
  assert.ok(!f.renderer.markup.includes("untrusted.invalid"));
  assert.deepEqual(f.state.selected, selected);
  assert.equal(JSON.stringify(f.state.events), events);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
  assert.equal(f.store.canvasArrangementUndoRequest.get(), null);
  disconnectPresenceFixture(f, peer);
});

test("actual composed Canvas clears local peers on the same-board actor, project and permission boundaries", async () => {
  const transitions = [
    ["actor", f => { f.state.presenceSession = { ...f.store.session.get(), user: { userId: "other-account", role: "user" } }; }, true],
    ["project", f => {
      const canvas = f.store.canvasProjection.get(), projection = f.store.projection.get();
      f.store.canvasProjection.get = () => ({ ...canvas, projectId: "other-project",
        canvases: canvas.canvases.map(board => ({ ...board, projectId: "other-project" })) });
      f.store.projection.get = () => ({ ...projection, projectId: "other-project" });
    }, true],
    ["authorization", f => { f.state.authorization = "replacement-session"; }, true],
    ["permission epoch", f => { f.state.presenceSession = { ...f.store.session.get(), permissionEpoch: "permission-2" }; }, true],
    ["read-only grant", f => { f.state.presenceSession = { ...f.store.session.get(), capabilities: ["project.read", "project.canvas.use"] }; }, true],
    ["read revoked", f => { f.state.presenceSession = { ...f.store.session.get(), capabilities: [] }; }, false],
    ["Canvas revoked", f => { f.state.presenceSession = { ...f.store.session.get(), canvas: { ...f.store.session.get().canvas, access: false } }; }, false],
    ["anonymous", f => { f.state.presenceSession = { ...f.store.session.get(), user: { userId: "anonymous", role: "user" } }; }, false],
    ["sign-out", f => { f.state.presenceSession = null; f.state.authorization = ""; }, false],
  ];
  for (const [label, change, reconnect] of transitions) {
    const f = fixture({ presence: true, populated: true, chosen: "document-0" });
    const peer = meetLocalPresence(f), callback = peer.hostChannel.onmessage;
    const oldFrame = peer.channel.posts.at(-1), events = JSON.stringify(f.state.events);
    change(f); f.draw();
    assert.equal(peer.hostChannel.closed, true, label);
    assert.equal(localPresenceCursors(f).length, 0, label);
    callback?.({ data: { ...oldFrame, sequence: oldFrame.sequence + 100 } }); f.draw();
    assert.equal(localPresenceCursors(f).length, 0, label + " rejects late old-channel callbacks");
    assert.equal(f.presence.channels.filter(channel => !channel.closed && channel !== peer.channel).length, reconnect ? 1 : 0, label);
    assert.equal(JSON.stringify(f.state.events), events, label);
    assert.equal(f.state.requests.length, 0, label); assert.equal(f.state.batches.length, 0, label);
    disconnectPresenceFixture(f, peer);
  }
});

test("actual Canvas board changes and removed boards reset presence without creating a replacement selection", () => {
  for (const remove of [false, true]) {
    const f = fixture({ presence: true, populated: true, chosen: "document-0" }), peer = meetLocalPresence(f);
    if (remove) f.append({ type: "CanvasRemoved", payload: { project_id: "p", canvas_id: "board-a", reason: "fixture" } });
    else f.state.boardId = "board-b";
    const before = JSON.stringify(f.state.events);
    f.draw();
    assert.equal(peer.hostChannel.closed, true);
    assert.equal(localPresenceCursors(f).length, 0);
    assert.deepEqual(f.state.selected, []);
    assert.equal(JSON.stringify(f.state.events), before);
    assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
    disconnectPresenceFixture(f, peer);
  }
});

test("actual Canvas rendering checks TTL and shared expiry even before a local heartbeat", () => {
  const personal = fixture({ presence: true, populated: true, chosen: "document-0" });
  const peer = meetLocalPresence(personal);
  personal.presence.advance(6_001, false); personal.draw();
  assert.equal(localPresenceCursors(personal).length, 0);
  assert.equal(personal.state.requests.length, 0); assert.equal(personal.state.batches.length, 0);
  disconnectPresenceFixture(personal, peer);

  const shared = fixture({ presence: true, populated: true, viewer: true, chosen: "document-0" });
  const session = shared.store.session.get();
  shared.state.presenceSession = { ...session, projectContext: { ...session.projectContext,
    expiresAt: new Date(shared.presence.now() + 5_000).toISOString() } };
  shared.draw();
  const viewerPeer = meetLocalPresence(shared);
  shared.presence.advance(5_001, false); shared.draw();
  assert.equal(viewerPeer.hostChannel.closed, true);
  assert.equal(localPresenceCursors(shared).length, 0);
  assert.equal(shared.state.requests.length, 0); assert.equal(shared.state.batches.length, 0);
  disconnectPresenceFixture(shared, viewerPeer);
});

test("actual Canvas keeps canonical polling independent and reconnects local presence after disconnect", async () => {
  const f = fixture({ presence: true, populated: true, chosen: "document-0" }), peer = meetLocalPresence(f);
  const oldCallback = peer.hostChannel.onmessage, oldFrame = peer.channel.posts.at(-1);
  const timer = [...f.canvasIntervals.values()].find(value => value.milliseconds === 1_500);
  assert.ok(timer, "actual connectedCallback scheduled the existing canonical read");
  let refreshes = 0; f.store.refreshEvents = async () => { refreshes++; };
  f.state.presenceSession = { ...f.store.session.get(), permissionEpoch: "new-current-grants" }; f.draw();
  assert.equal(peer.hostChannel.closed, true);
  assert.ok([...f.canvasIntervals.values()].includes(timer));
  await timer.callback(); await Promise.resolve();
  assert.equal(refreshes, 1);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.canvasIntervals.size, 0);
  oldCallback?.({ data: { ...oldFrame, sequence: oldFrame.sequence + 100 } });
  f.host.isConnected = true; f.host.connectedCallback(); f.draw();
  assert.equal(localPresenceCursors(f).length, 0);
  assert.equal(f.canvasIntervals.size, 1);
  assert.ok(f.presence.channels.some(channel => !channel.closed && channel !== peer.channel));
  const current = meetLocalPresence(f, "current-other-tab");
  peer.hub.disconnect(); disconnectPresenceFixture(f, current);
});


// Phase8 composition: use the real adaptive controller, dialog and complete Canvas
// class with an explicitly empty, read-only source port. No preview/apply/provider
// request is allowed here. The paid-flow suite owns its authoring behavior.
const { AdaptiveProposalReviewController: ActualAdaptiveProposalReview } = await loadActual("src/components/adaptive-proposal-review.ts");
const adaptiveDialog = f => f.native("dialog", node => node.classList.contains("adaptive-proposal-dialog"));
const resumeAdaptiveButton = node => node.handlers.click?.name === "#resumeProposalReview";
const proposalReceiptReads = f => f.state.requests.filter(request => request.url === "/api/context/adaptive/apply");
function assertFreeProposalReads(f, count) {
  assert.equal(f.state.requests.length, count, "no authored or cost request accompanies free inspection");
  assert.equal(proposalReceiptReads(f).length, count);
  for (const { body } of proposalReceiptReads(f)) {
    assert.equal(body.action, "resume");
    assert.deepEqual(Object.keys(body).sort(), ["action", "canvasId", "documentId", "projectId"]);
    assert.equal(body.projectId, "p"); assert.equal(body.documentId, "document-0"); assert.equal(body.canvasId, "board-a");
  }
  assert.equal(f.state.batches.length, 0);
}
async function openEmptyAdaptiveReview(f) {
  assert.ok(f.proposalReview instanceof ActualAdaptiveProposalReview);
  assert.equal(f.proposalReview.synchronize, ActualAdaptiveProposalReview.prototype.synchronize);
  assert.equal(f.proposalReview.suspend, ActualAdaptiveProposalReview.prototype.suspend);
  f.state.replies.push({ status: "none" });
  const opener = await f.click("button", resumeAdaptiveButton);
  await flushUntil(f, () => f.proposalReview.visible && !f.proposalReview.busy);
  assert.ok(adaptiveDialog(f)?.open, "the real dialog was rendered and reached actual updated");
  assert.equal(f.proposalReview.notice, "adaptive.changes.none");
  assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
  assert.equal(f.proposalReview.handle, null); assert.equal(f.proposalReview.executionId, "");
  assert.deepEqual(f.proposalReview.originals, []);
  assert.ok(f.proposalSourceReads.length > 0);
  assert.ok(f.proposalSourceReads.every(read => read.documentId === "document-0" && read.canvasId === "board-a"));
  return opener;
}

for (const locale of ["en", "fr", "ar", "ja"]) test("composed " + locale + " Canvas keeps local presence truthful beside an actual free read-only proposal dialog", async () => {
  const f = fixture({ presence: true, populated: true, chosen: "document-0", locale });
  await f.select(0);
  f.state.presenceSession = { ...f.store.session.get(), capabilities: ["project.read", "project.canvas.use"] }; f.draw();
  const events = JSON.stringify(f.state.events), selected = [...f.state.selected], peer = meetLocalPresence(f);
  assert.equal(f.state.requests.length, 0);
  const opener = await openEmptyAdaptiveReview(f), review = f.proposalReview;
  assert.equal(review.ports.scope().canAuthor, false);
  assertFreeProposalReads(f, 1);
  assert.ok(f.renderer.markup.includes(escapeText(f.i18n.t("adaptive.changes.free"))));
  assert.ok(f.renderer.markup.includes(escapeText(f.i18n.t("adaptive.changes.readOnly"))));
  const frame = peer.channel.posts.at(-1);
  f.presence.inject(peer.hostChannel, { ...frame, sequence: frame.sequence + 1,
    name: "FAKE_REMOTE_PERSON", color: "url(https://forged.invalid)",
    executionId: "forged-paid-source", action: "apply", selectedItemId: "item-document-1",
    events: [{ type: "BlockCreated", payload: { text: "FORGED_AUTHORED_TEXT" } }] });
  f.draw();
  const cursor = localPresenceCursors(f)[0];
  assert.equal(cursor.attributes["aria-label"], f.i18n.t("canvas.presence.otherTab") + ". " + f.i18n.t("canvas.presence.localOnly"));
  assert.equal(cursor.attributes["aria-live"], undefined);
  assert.ok(!f.renderer.markup.includes("FAKE_REMOTE_PERSON") && !f.renderer.markup.includes("forged.invalid") && !f.renderer.markup.includes("FORGED_AUTHORED_TEXT"));
  assert.equal(review.executionId, ""); assert.equal(review.visible, true);
  assertFreeProposalReads(f, 1); assert.deepEqual(f.state.selected, selected);
  assert.equal(JSON.stringify(f.state.events), events);
  const previousFocus = f.trace.filter(value => value === "focus:button").length;
  const dialog = adaptiveDialog(f);
  dialog.handlers.cancel.call(f.host, { type: "cancel", target: dialog, currentTarget: dialog, preventDefault() {} });
  await f.flush();
  assert.equal(review.visible, false); assert.equal(adaptiveDialog(f), undefined);
  assert.equal(f.trace.filter(value => value === "focus:button").length, previousFocus + 1, "the owned Resume opener receives focus");
  assert.equal(opener.attributes.tabindex, undefined, "the temporary focus attribute is removed by the real close helper");
  assertFreeProposalReads(f, 1); disconnectPresenceFixture(f, peer);
});

test("composed Canvas does not request a proposal when the exact destination or current authority is absent", async () => {
  for (const missing of ["destination", "authority"]) {
    const f = fixture({ presence: true, populated: true, documentCount: 2, chosen: missing === "destination" ? "" : "document-0" });
    if (missing === "authority") { f.state.authorization = ""; f.draw(); }
    await f.click("button", resumeAdaptiveButton); await f.flush();
    assert.equal(f.proposalReview.visible, false, missing);
    assert.equal(f.proposalSourceReads.length, 0, missing);
    assert.equal(f.state.requests.length, 0, missing); assert.equal(f.state.batches.length, 0, missing);
    f.host.isConnected = false; f.host.disconnectedCallback();
    assert.equal(f.canvasIntervals.size, 0); assert.equal(f.presence.timers.size, 0);
  }
});

test("actual updated conceals an owned adaptive review and old-tab presence on actor and permission renewal before render", async () => {
  for (const boundary of ["actor", "permission"]) {
    const f = fixture({ presence: true, populated: true, chosen: "document-0" });
    const peer = meetLocalPresence(f), events = JSON.stringify(f.state.events);
    await openEmptyAdaptiveReview(f);
    const review = f.proposalReview, callback = peer.hostChannel.onmessage, frame = peer.channel.posts.at(-1);
    f.state.presenceSession = boundary === "actor"
      ? { ...f.store.session.get(), user: { userId: "next-actor", role: "user" } }
      : { ...f.store.session.get(), permissionEpoch: "next-permission" };
    // Do not render first: both production updated hooks must act themselves.
    f.host.updated();
    assert.equal(review.visible, false, boundary); assert.equal(review.phase, "unavailable", boundary);
    assert.equal(review.preview, null); assert.deepEqual(review.originals, []);
    assert.equal(peer.hostChannel.closed, true, boundary);
    callback?.({ data: { ...frame, sequence: frame.sequence + 100 } }); f.draw();
    assert.equal(adaptiveDialog(f), undefined); assert.equal(localPresenceCursors(f).length, 0);
    assertFreeProposalReads(f, 1); assert.equal(JSON.stringify(f.state.events), events);
    disconnectPresenceFixture(f, peer);
  }
});

test("actual disconnect suspends an in-flight free review before local presence and prevents a late response reopening it", async () => {
  const f = fixture({ presence: true, populated: true, chosen: "document-0" });
  const peer = meetLocalPresence(f), events = JSON.stringify(f.state.events), response = Promise.withResolvers();
  const oldCallback = peer.hostChannel.onmessage, oldFrame = peer.channel.posts.at(-1);
  f.store.guardedFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "/api/context/adaptive/apply"); assert.equal(body.action, "resume");
    f.state.requests.push({ url, body }); return response.promise;
  };
  await f.click("button", resumeAdaptiveButton);
  assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, true);
  f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.proposalReview.visible, false); assert.equal(f.proposalReview.busy, false);
  assert.equal(peer.hostChannel.closed, true); assert.equal(f.canvasIntervals.size, 0);
  f.host.isConnected = true; f.host.connectedCallback(); f.draw();
  const before = JSON.stringify({ phase: f.proposalReview.phase, visible: f.proposalReview.visible,
    busy: f.proposalReview.busy, handle: f.proposalReview.handle, executionId: f.proposalReview.executionId });
  response.resolve(Response.json({ status: "none" })); await f.flush();
  oldCallback?.({ data: { ...oldFrame, sequence: oldFrame.sequence + 100 } }); f.draw();
  assert.equal(JSON.stringify({ phase: f.proposalReview.phase, visible: f.proposalReview.visible,
    busy: f.proposalReview.busy, handle: f.proposalReview.handle, executionId: f.proposalReview.executionId }), before);
  assert.equal(adaptiveDialog(f), undefined); assert.equal(localPresenceCursors(f).length, 0);
  assertFreeProposalReads(f, 1); assert.equal(JSON.stringify(f.state.events), events);
  const current = meetLocalPresence(f, "current-tab");
  peer.hub.disconnect(); disconnectPresenceFixture(f, current);
});

test("canonical Canvas polling still runs while a real empty review is open and a local cursor expires", async () => {
  const f = fixture({ presence: true, populated: true, chosen: "document-0" }), peer = meetLocalPresence(f);
  await openEmptyAdaptiveReview(f);
  const timer = [...f.canvasIntervals.values()].find(value => value.milliseconds === 1_500), events = JSON.stringify(f.state.events);
  assert.ok(timer); let refreshes = 0;
  f.store.refreshEvents = async () => { refreshes++; };
  f.presence.advance(6_001, false); f.draw();
  assert.equal(localPresenceCursors(f).length, 0);
  assert.equal(f.proposalReview.visible, true); assert.ok(adaptiveDialog(f)?.open);
  await timer.callback(); await Promise.resolve();
  assert.equal(refreshes, 1); assertFreeProposalReads(f, 1);
  assert.equal(JSON.stringify(f.state.events), events);
  disconnectPresenceFixture(f, peer);
});



for(const boundary of ["permission","route"])test("fully composed native View cleanup and local presence preserve the canonical poll at "+boundary,async()=>{
  const f=fixture({presence:true,populated:true,documentCount:2,chosen:"document-0"});
  const peer=meetLocalPresence(f),owned=openOwnedPopover(f,"canvas-view-menu"),oldCallback=peer.hostChannel.onmessage;
  const before=JSON.stringify(f.state.events),selection=[...f.state.selected],polls=[...f.canvasIntervals];
  assert.equal(polls.length,1);assert.equal(polls[0][1].milliseconds,1500);
  if(boundary==="permission")f.state.presenceSession={...f.store.session.get(),permissionEpoch:"permission-new"};
  else f.route="/canvas/projects";
  f.draw();
  assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  if(boundary==="permission")assert.equal(ownedPopover(f,"canvas-view-menu").trigger.attributes["aria-expanded"],"false");
  else {assert.equal(f.renderer.query(f.host,"forma-ui-popover").filter(child=>child.attributes.class==="canvas-view-menu").length,0);assert.equal(owned.menu.isConnected,false);}
  oldCallback?.({data:peer.channel.posts.at(-1)});f.draw();assert.equal(localPresenceCursors(f).length,0);
  assert.deepEqual([...f.canvasIntervals],polls,"native popup/presence changes do not replace canonical synchronization");
  assert.equal(JSON.stringify(f.state.events),before);assert.deepEqual(f.state.selected,selection);
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
  disconnectPresenceFixture(f,peer);
});


// Organize uses the actual native component. These ports model declarative
// activation and event ordering; they are not browser/top-layer/AT certification.
function organizeEvent(type,target,extra={}){
  return {type,target,currentTarget:target,defaultPrevented:false,immediateStopped:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){},
    stopImmediatePropagation(){this.immediateStopped=true;},...extra};
}
function organizePanel(f,menu){
  return f.renderer.ownNodes(menu,"section").find(node=>node.attributes.popover==="auto");
}
async function organizeActivate(f,button,{draw=true}={}){
  const menu=button.closest("forma-ui-popover");assert.ok(menu instanceof FormaUiPopover);
  const event=organizeEvent("click",button);
  event.currentTarget=menu;
  if(menu.eventBindings.click)runPortHandler(menu.eventBindings.click,menu,event);
  event.currentTarget=button;
  if(!event.immediateStopped&&button.handlers.click)await runPortHandler(button.handlers.click,button.owner,event);
  const id=button.attributes.popovertarget;
  if(!event.defaultPrevented&&id){
    const panel=organizePanel(f,menu);assert.equal(panel.attributes.id,id);
    if(panel.matches(":popover-open"))panel.hidePopover();
    else {
      const before=organizeEvent("beforetoggle",panel,{currentTarget:menu,newState:"open"});
      if(menu.eventBindings.beforetoggle)runPortHandler(menu.eventBindings.beforetoggle,menu,before);
      if(!before.defaultPrevented)panel.showPopover();
    }
  }
  if(draw)f.draw();
  return event;
}
async function organizeFixture(options={}){
  const f=fixture({populated:true,documentCount:3,...options});
  await f.select(0);await f.select(1,"block",true);
  return f;
}
function organizeActionButton(f,kind,index=0){
  const menu=ownedPopover(f,"canvas-organize-control").menu;
  const name={arrange:"#organizeSelection",size:"#matchSelectionSize",reapply:"#reapplyArrangement"}[kind];
  const buttons=f.renderer.ownNodes(menu,"button").filter(node=>String(node.handlers.click).includes(name));
  assert.ok(buttons[index],"the actual "+kind+" handler is rendered");
  return buttons[index];
}
async function changeOrganizeBoundary(f,boundary){
  if(boundary==="authorization")f.state.authorization="actor-b";
  else if(boundary==="board")f.state.boardId="board-b";
  else if(boundary==="route")f.route="/canvas/board-a/board-a?view=list";
  else if(boundary==="reader")f.state.viewer=true;
  else if(boundary==="selection"){
    // Replace one ID while keeping the same cardinality; count-only guards fail.
    for(const id of ["item-block-1","item-block-2"]){
      const node=f.native("article",item=>item.attributes["data-canvas-item-id"]===id);assert.ok(node);
      node.handlers.click.call(f.host,{target:node,currentTarget:node,shiftKey:true,composedPath:()=>[node],preventDefault(){},stopPropagation(){}});
    }
  }else if(boundary==="removed-item")await f.store.append({type:"CanvasItemRemoved",payload:{project_id:"p",canvas_id:"board-a",item_id:"item-block-0"}});
  else if(boundary==="removed-board")await f.store.append({type:"CanvasRemoved",payload:{project_id:"p",canvas_id:"board-a"}});
  else throw Error("Unknown Organize boundary "+boundary);
}
function noOrganizeWork(f,events){
  assert.equal(JSON.stringify(f.state.events),events);
  assert.equal(f.state.batches.length,0);
  assert.equal(f.state.requests.length,0);
}

for(const locale of ["en","fr","ar","ja"])test("Organize native activation toggles the actual owned panel and localized invoker in "+locale,async()=>{
  const f=await organizeFixture({locale}),original=JSON.stringify(f.state.events),owned=ownedPopover(f,"canvas-organize-control");
  assert.equal(owned.menu.label,f.i18n.system("Organize"));
  assert.equal(owned.trigger.attributes["aria-controls"],owned.panel.attributes.id);
  assert.equal(owned.trigger.attributes.popovertarget,owned.panel.attributes.id);
  assert.equal(owned.trigger.attributes["aria-expanded"],"false");
  assert.equal(f.renderer.ownNodes(f.host,"aside").filter(node=>node.attributes.class==="canvas-organize-menu").length,1,"one real content body, not a second overlaid copy");
  assert.ok(!restingControls(f).some(node=>node.attributes["aria-label"]===f.i18n.system("Close organize menu")));
  await organizeActivate(f,owned.trigger);
  let current=ownedPopover(f,"canvas-organize-control");
  assert.equal(current.trigger.attributes["aria-expanded"],"true");assert.equal(current.panel.matches(":popover-open"),true);
  assert.equal(current.panel.attributes.id,owned.panel.attributes.id);
  assert.ok(f.renderer.ownNodes(current.menu,"aside").some(node=>node.attributes.class==="canvas-organize-menu"));
  assert.doesNotMatch(current.menu.markup,/role="menu(?:item)?"/u);
  await organizeActivate(f,current.trigger);
  current=ownedPopover(f,"canvas-organize-control");assert.equal(current.trigger.attributes["aria-expanded"],"false");
  assert.equal(current.panel.matches(":popover-open"),false);
  noOrganizeWork(f,original);
});

test("Organize uses instance-unique panel, trigger and group labels without changing the HUD",async()=>{
  const first=await organizeFixture(),one=ownedPopover(first,"canvas-organize-control");
  const ids=()=>first.renderer.ownNodes(one.menu,"aside").concat(first.renderer.ownNodes(one.menu,"span")).map(node=>node.attributes.id).filter(Boolean);
  const original=ids();assert.equal(new Set(original).size,original.length);
  first.draw();assert.deepEqual(ids(),original);
  const second=await organizeFixture(),two=ownedPopover(second,"canvas-organize-control");
  assert.notEqual(one.panel.attributes.id,two.panel.attributes.id);assert.notEqual(one.trigger.attributes.id,two.trigger.attributes.id);
  const secondIds=second.renderer.ownNodes(two.menu,"aside").concat(second.renderer.ownNodes(two.menu,"span")).map(node=>node.attributes.id).filter(Boolean);
  assert.equal(new Set([...original,...secondIds]).size,original.length+secondIds.length);
  assert.ok(first.renderer.ownNodes(first.host,"aside").some(node=>node.attributes.class==="canvas-selection-hud"&&!Object.hasOwn(node.attributes,"popover")));
  assert.equal(first.state.requests.length+second.state.requests.length,0);
});

for(const method of ["close","outside","Escape"])test("Organize "+method+" dismissal preserves selection and does no authored work",async()=>{
  const f=await organizeFixture();await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const owned=ownedPopover(f,"canvas-organize-control"),selection=[...f.state.selected],events=JSON.stringify(f.state.events);
  if(method==="close"){
    const close=f.renderer.ownNodes(owned.menu,"button").find(node=>node.attributes["aria-label"]===f.i18n.system("Close organize menu"));
    assert.ok(close);await organizeActivate(f,close);
    assert.equal(documentPort.activeElement?.attributes.popovertarget,owned.panel.attributes.id);
  }else{
    if(method==="Escape"){
      const event=organizeEvent("keydown",owned.trigger,{key:"Escape",composedPath:()=>[owned.trigger]});
      f.listeners.get("keydown")[0](event);assert.equal(event.defaultPrevented,false,"browser Escape remains authoritative");
      assert.deepEqual(f.state.selected,selection);
    }
    owned.panel.hidePopover();f.draw();
  }
  assert.equal(ownedPopover(f,"canvas-organize-control").panel.matches(":popover-open"),false);
  assert.equal(ownedPopover(f,"canvas-organize-control").trigger.attributes["aria-expanded"],"false");
  assert.equal(f.listeners.get("resize")?.length??0,0);
  assert.deepEqual(f.state.selected,selection);noOrganizeWork(f,events);
});

for(const boundary of ["authorization","board","route","reader","selection","removed-item","removed-board"])test("Organize closes its native panel at the "+boundary+" boundary",async()=>{
  const f=await organizeFixture();
  if(boundary==="removed-item")await f.select(2,"block",true);
  await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const owned=ownedPopover(f,"canvas-organize-control");
  await changeOrganizeBoundary(f,boundary);const events=JSON.stringify(f.state.events);
  f.draw();assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);
  assert.equal(f.listeners.get("resize")?.length??0,0);noOrganizeWork(f,events);
});

for(const boundary of ["authorization","board","route","reader","selection","removed-item","removed-board"])test("Organize refuses an old native invoker before rendering at "+boundary,async()=>{
  const f=await organizeFixture(),owned=ownedPopover(f,"canvas-organize-control");
  await changeOrganizeBoundary(f,boundary);const events=JSON.stringify(f.state.events);
  const event=await organizeActivate(f,owned.trigger,{draw:false});
  assert.equal(event.defaultPrevented,true);assert.equal(event.immediateStopped,true);
  assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);noOrganizeWork(f,events);
});

for(const boundary of ["authorization","route","selection"])test("Organize rejects native beforetoggle after "+boundary+" without opening",async()=>{
  const f=await organizeFixture(),owned=ownedPopover(f,"canvas-organize-control");
  await changeOrganizeBoundary(f,boundary);const events=JSON.stringify(f.state.events);
  const event=organizeEvent("beforetoggle",owned.panel,{currentTarget:owned.menu,newState:"open"});
  runPortHandler(owned.menu.eventBindings.beforetoggle,owned.menu,event);
  assert.equal(event.defaultPrevented,true);assert.equal(f.openPopovers.has(owned.panel.attributes.id),false);noOrganizeWork(f,events);
});

for(const [kind,index,expected] of [
  ["arrange",0,"grid"],["arrange",1,"row"],["arrange",2,"column"],["arrange",3,"type"],
  ["size",0,"minimum"],["size",1,"average"],["size",2,"maximum"],
])test("Organize closes and hands off exactly once to the original "+expected+" executor",async()=>{
  const f=await organizeFixture(),before=f.state.events.length,selected=[...f.state.selected];
  const semantics=()=>{const p=f.store.projection.get();return JSON.stringify([p.documents,p.libraryBlocks,p.libraryBlockRelations,p.libraryArtifacts,p.libraryOutputs]);},originalSemantics=semantics();
  await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const owned=ownedPopover(f,"canvas-organize-control"),button=organizeActionButton(f,kind,index),stage=f.store.stageOptimisticCanvasEvents,checkpoints=[];
  f.store.stageOptimisticCanvasEvents=events=>{checkpoints.push({open:owned.panel.matches(":popover-open"),focus:documentPort.activeElement?.attributes.popovertarget});return stage(events);};
  await organizeActivate(f,button);await f.flush();
  const created=f.state.events.slice(before),arrangements=created.filter(event=>event.type==="CanvasArrangementCreated");
  assert.equal(arrangements.length,1);assert.equal(f.state.batches.length,1);
  assert.ok(created.every(event=>["CanvasArrangementCreated","CanvasRegisterSet"].includes(event.type)));
  const payload=arrangements[0].payload;assert.equal(payload.canvas_id,"board-a");assert.deepEqual([...payload.item_ids].sort(),[...selected].sort());
  assert.equal(payload.kind,kind==="size"?"match-size":expected);
  if(kind==="size")assert.equal(payload.size_modifier,expected);
  assert.equal(payload.explicit_user_action,true);assert.equal(payload.does_not_change_generation_context,true);
  assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].open,false);assert.equal(checkpoints[0].focus,owned.panel.attributes.id);
  assert.equal(f.state.requests.length,0);assert.deepEqual(f.state.selected,selected);assert.equal(semantics(),originalSemantics);
  assert.equal(ownedPopover(f,"canvas-organize-control").panel.matches(":popover-open"),false);
});

test("Organize saved-layout reapply uses its original exact frames after native close",async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  try{
    const f=await organizeFixture();
    await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
    await organizeActivate(f,organizeActionButton(f,"arrange",1));await f.flush();
    const arrangement=f.store.canvasProjection.get().arrangements.at(-1);assert.ok(arrangement);
    const frame=arrangement.frames[0];clock+=1000;
    await f.store.append({type:"CanvasRegisterSet",payload:{project_id:"p",canvas_id:"board-a",item_id:frame.itemId,previous_value:frame.x,operation:{object:{kind:"canvas_item",item_id:frame.itemId},prop:"x",value:frame.x+123,hlc:{pt:clock,c:0,site:"fixture"}}}});
    f.draw();assert.equal(f.store.canvasProjection.get().items.find(item=>item.id===frame.itemId).x,frame.x+123);
    clock+=1000;const before=f.state.events.length,batches=f.state.batches.length;
    await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
    const owned=ownedPopover(f,"canvas-organize-control");await organizeActivate(f,organizeActionButton(f,"reapply"));await f.flush();
    const applied=f.state.events.slice(before);assert.ok(applied.length);
    assert.ok(applied.every(event=>event.type==="CanvasRegisterSet"&&event.payload.arrangement_id===arrangement.id));
    assert.equal(f.state.batches.length,batches+1);assert.equal(owned.panel.matches(":popover-open"),false);
    const current=new Map(f.store.canvasProjection.get().items.map(item=>[item.id,item]));
    for(const expected of arrangement.frames)assert.deepEqual(Object.fromEntries(["x","y","w","h"].map(key=>[key,current.get(expected.itemId)[key]])),Object.fromEntries(["x","y","w","h"].map(key=>[key,expected[key]])));
    assert.equal(f.state.requests.length,0);
  }finally{Date.now=originalNow;}
});

test("Organize rejects a hidden or old selection handler without dismissing a newer opening",async()=>{
  const f=await organizeFixture();await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const old=ownedPopover(f,"canvas-organize-control"),action=organizeActionButton(f,"arrange"),callback=action.handlers.click;
  old.panel.hidePopover();f.draw();let before=JSON.stringify(f.state.events);
  await callback.call(f.host,organizeEvent("click",action));noOrganizeWork(f,before);
  await changeOrganizeBoundary(f,"selection");f.draw();
  await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const current=ownedPopover(f,"canvas-organize-control");before=JSON.stringify(f.state.events);
  await callback.call(f.host,organizeEvent("click",action));
  assert.equal(current.panel.matches(":popover-open"),true);noOrganizeWork(f,before);
});

test("Organize late detached toggle cannot close a replacement selection menu",async()=>{
  const f=await organizeFixture();await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const old=ownedPopover(f,"canvas-organize-control");
  await f.select(0);assert.equal(old.menu.isConnected,false);
  await f.select(1,"block",true);await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const current=ownedPopover(f,"canvas-organize-control"),events=JSON.stringify(f.state.events);
  old.menu.dispatchEvent(new CustomEvent("forma-toggle",{detail:{open:false}}));
  assert.equal(current.panel.matches(":popover-open"),true);
  noOrganizeWork(f,events);
});

test("Organize is unavailable to a reader while the selection HUD stays usable",async()=>{
  const f=await organizeFixture({viewer:true}),events=JSON.stringify(f.state.events);
  assert.equal(f.renderer.query(f.host,"forma-ui-popover").filter(menu=>menu.attributes.class==="canvas-organize-control").length,0);
  assert.ok(f.renderer.ownNodes(f.host,"aside").some(node=>node.attributes.class==="canvas-selection-hud"));
  assert.ok(f.renderer.ownNodes(f.host,"button").some(node=>node.attributes["aria-label"]==="Clear selection"));
  noOrganizeWork(f,events);
});

test("Organize disconnect closes and disposes actual positioning observers",async()=>{
  const f=await organizeFixture();await organizeActivate(f,ownedPopover(f,"canvas-organize-control").trigger);
  const owned=ownedPopover(f,"canvas-organize-control"),events=JSON.stringify(f.state.events);
  f.host.isConnected=false;f.host.disconnectedCallback();
  assert.equal(owned.panel.matches(":popover-open"),false);assert.equal(f.listeners.get("resize")?.length??0,0);
  noOrganizeWork(f,events);
});

for(const locale of ["en","ar"])test("Organize actual native invoker uses the existing bounded narrow "+locale+" positioner",async()=>{
  const f=await organizeFixture({locale}),owned=ownedPopover(f,"canvas-organize-control"),values=new Map();
  const previous={width:windowPort.innerWidth,height:windowPort.innerHeight,viewport:windowPort.visualViewport};
  windowPort.innerWidth=320;windowPort.innerHeight=240;
  windowPort.visualViewport={offsetLeft:0,offsetTop:0,width:320,height:180,addEventListener(){},removeEventListener(){}};
  owned.panel.style={setProperty:(key,value)=>values.set(key,value)};
  owned.trigger.getBoundingClientRect=()=>({left:270,right:314,top:132,bottom:176,width:44,height:44});
  try{
    await organizeActivate(f,owned.trigger,{draw:false});
    assert.equal(owned.panel.matches(":popover-open"),true);
    assert.equal(values.get("--forma-popover-max-width"),"304px");
    assert.equal(values.get("--forma-popover-left"),"8px");
    assert.equal(values.get("--forma-popover-top"),"auto");
    assert.ok(Number.parseFloat(values.get("--forma-popover-max-height"))<=124);
    assert.equal(owned.panel.attributes["data-forma-popover-positioned"],"true");
    owned.panel.hidePopover();
  }finally{
    windowPort.innerWidth=previous.width;windowPort.innerHeight=previous.height;windowPort.visualViewport=previous.viewport;
  }
  assert.equal(f.state.requests.length,0);assert.equal(f.state.batches.length,0);
});

test("Organize CSS keeps only its native panel floating and its controls bounded",()=>{
  const css=sourceText("src/canvas/canvas.css"),system=sourceText("src/design-system.css");
  const body=css.match(/\.canvas-organize-menu\{([^}]+)\}/u)?.[1];assert.ok(body);
  assert.doesNotMatch(body,/position\s*:\s*(?:absolute|fixed)|(?:right|left|bottom|top)\s*:/u);
  assert.match(css,/\.canvas-organize-control \.ui-popover-panel\{[^}]*--forma-popover-max-width[^}]*--forma-popover-max-height/u);
  assert.match(css,/\.canvas-organize-control \.canvas-organize-menu button\{[^}]*min-inline-size:[^;]*2\.75rem[^}]*min-block-size:[^;]*2\.75rem/u);
  assert.match(system,/\.ui-popover-panel\[popover\]:not\(:popover-open\)[^{]+\{\s*display:none/u);
});

// C218 prerequisite only: seven existing journeys now use the same complete
// Shell/Store/Canvas fixture as the actual ordinary-exit witnesses. Keep this
// declaration after the legacy test/fixture prefix so its reduced consumers do
// not acquire a new host, native port, import, or setup operation.
// Test driver only: the five existing row journeys reuse the current full
// Shell/Store board fixture and its already-declared read floor. No new seed,
// route executor, focus lease, private accessor or native lifetime is supplied.
async function canvasCalmDeskRowJourney(p, change = null) {
  const { f, canvas } = p, originalBoardRoute = f.store.route.get();
  assert.ok(change === null || ["authority", "route", "modal", "disconnect"].includes(change));
  assert.equal(canvas.closest("forma-shell"), f.host); assert.equal(f.host.tag, "forma-shell");
  const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
  assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
  const artifacts = f.store.projection.get().libraryArtifacts.filter(value => value.id === "saved-scene-story"
    && value.documentId === f.documentId);
  assert.equal(artifacts.length, 1, "reuse the exact existing artifact certified by this fixture's readiness read");
  const rowFor = key => p.row("a", value => value.owner === canvas
    && value.parent?.tag === "li" && value.parent.parent?.tag === "ul"
    && value.parent.parent.owner === canvas
    && String(value.parent.parent.attributes.class ?? "").split(/\s+/u).includes("outcome-desk-objects")
    && new URL(String(value.attributes.href), "https://fixture.invalid").searchParams.get("outcome") === key);
  const activate = async row => {
    assert.equal(typeof row.handlers.click, "function"); assert.ok(row.port.isConnected && !row.hiddenBy);
    f.native.emit("pointerdown", row.port); f.native.focus(row.port);
    let prevented = false;
    await f.act(row, "click", { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false, preventDefault() { prevented = true; }, composedPath: () => [row.port] });
    assert.equal(prevented, true, "the actual row handler owns its local navigation, not a simulated anchor default");
  };
  await p.desk();
  const artifactRow = rowFor("artifact:" + artifacts[0].id), artifactRoute = artifactRow.attributes.href;
  assert.notEqual(artifactRoute, f.store.route.get()); await activate(artifactRow);
  assert.equal(f.store.route.get(), artifactRoute); assert.equal(rowFor("artifact:" + artifacts[0].id).attributes["aria-current"], "true");
  await p.quiet();
  const trigger = rowFor("document:" + f.documentId), expectedRoute = trigger.attributes.href;
  assert.equal(typeof expectedRoute, "string"); assert.notEqual(expectedRoute, f.store.route.get());
  assert.equal(new URL(expectedRoute, "https://fixture.invalid").searchParams.get("outcome"), "document:" + f.documentId);
  const gate = continuityDeferred(), originalTick = f.tick;
  let heldResult = null, heldEntered = false;
  f.tick = function(owner, ...args) {
    const rendered = Reflect.apply(originalTick, this, [owner, ...args]);
    if (heldResult || owner !== canvas || f.store.route.get() !== expectedRoute) return rendered;
    // Retain the original rendered result. Only its first actual Canvas
    // completion at this exact destination waits; every other tick is unchanged.
    heldResult = Promise.resolve(rendered).then(value => {
      heldEntered = true; return gate.promise.then(() => value);
    });
    return heldResult;
  };
  try {
    const beforeDispatch = f.native.nativeFocus.length;
    await activate(trigger);
    for (let turn = 0; turn < 8 && !heldEntered; turn++) await continuityTurn();
    assert.ok(heldEntered && heldResult, "the genuine admitted Document row reached its original held Canvas render");
    assert.equal(f.store.route.get(), expectedRoute, "the exact emitted document-row href was actually committed before interruption");
    const arrival = f.store.captureWorkspaceNavigationFocus(expectedRoute);
    assert.ok(arrival && arrival.routeCurrent(), "the actual Store still owns this same pending route/focus receipt");
    assert.strictEqual(f.store.captureWorkspaceNavigationFocus(expectedRoute, arrival.focus)?.focus, arrival.focus);
    assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
    assert.equal(rowFor("document:" + f.documentId).attributes["aria-current"], "true");
    assert.deepEqual(f.native.nativeFocus.slice(beforeDispatch).filter(value => value.node.id === "canvas-outcome-desk-selected"), [],
      "no selected-heading arrival is credited while the actual Canvas completion is held");
    await p.effectsUnchanged();
    let currentRoute = expectedRoute, modal = null;
    if (change === "authority") {
      // Existing full-host external-authority premise, not a forged current()
      // result or a claim of an original server/session response.
      f.store.session.set({ ...f.store.session.get(), permissionEpoch: "newer-current-authority" });
      assert.equal(f.store.authorizationScopeActive(authority), false);
      assert.equal(f.store.sourceOwnershipActive(source), false);
    } else if (change === "route") {
      f.store.setRoute(originalBoardRoute); await p.settle(); currentRoute = originalBoardRoute;
      assert.equal(f.store.route.get(), currentRoute); assert.equal(arrival.routeCurrent(), false);
    } else if (change === "modal") {
      await p.openArrangement(); modal = p.arrangement();
      assert.ok(modal.port.open && modal.port.isConnected && modal.owner === canvas);
      assert.equal(f.store.route.get(), expectedRoute);
    } else if (change === "disconnect") {
      canvas.isConnected = false; canvas.disconnectedCallback();
      assert.equal(canvas.isConnected, false);
    }
    const history = [...f.history], selection = p.selected(), beforeRelease = f.native.nativeFocus.length;
    gate.resolve(); await heldResult; await continuityTurn();
    assert.equal(f.store.route.get(), currentRoute); assert.deepEqual(f.history, history); assert.deepEqual(p.selected(), selection);
    if (change === null) {
      // No settlement/redraw between the original completion and this exact
      // current-node assertion. A historical write alone cannot satisfy it.
      const targets = canvas.querySelectorAll("[id]").filter(node => node.id === "canvas-outcome-desk-selected");
      assert.equal(targets.length, 1); const target = targets[0];
      assert.ok(target.isConnected && target.fixture === f && target.owner === canvas && f.renderer.nodes.includes(target));
      assert.equal(target.closest("forma-canvas-surface"), canvas);
      assert.equal(f.native.document.activeElement, target, "a heading retained by a prior fixture is not this arrival");
      const writes = f.native.nativeFocus.slice(beforeRelease); assert.equal(writes.length, 1, "one fresh focus arrival follows the held render");
      assert.equal(writes[0].node, target);
      const witness = p.focusEvidence.findLast(value => value.node === target && value.write === writes[0]);
      assert.ok(witness?.connectedAtCall && witness.sameCanvas); assert.equal(witness.exactCurrentRows, 1);
      assert.equal(witness.matchingIds, 1); assert.equal(witness.owner, canvas);
      assert.equal(witness.id, "canvas-outcome-desk-selected"); assert.equal(witness.attributeId, witness.id);
      assert.equal(f.native.document.activeElement.id, "canvas-outcome-desk-selected");
      assert.ok(arrival.routeCurrent() && f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
    } else {
      assert.equal(f.native.nativeFocus.length, beforeRelease, "navigate " + change + " cannot steal focus after ownership changed");
      if (change === "authority") assert.equal(f.store.authorizationScopeActive(authority), false);
      if (change === "route") assert.equal(arrival.routeCurrent(), false);
      if (change === "modal") { assert.equal(p.arrangement().port, modal.port); assert.equal(modal.port.open, true); }
      if (change === "disconnect") assert.equal(canvas.isConnected, false);
    }
    // Deliberately no settle here: retired Canvas must not be reconnected by
    // the finite renderer. Every existing zero-request/queue/private/fiscal
    // assertion still runs; quiet's stronger healthy-owner contract is intact.
    await f.sourceUnchanged(); await p.effectsUnchanged();
  } finally {
    f.tick = originalTick; gate.resolve();
    if (heldResult) await heldResult;
    await continuityTurn();
  }
}

async function withCanvasCalmNavigation(t, { locale = "en", selected = false } = {}, run) {
  const { boardPage, BOARD, drain, classed, inside, ports } = await import("./helpers/board-lifecycle-navigation-fixture.mjs");
  const { accountCachePort, financial, readWorkspaceEvents } = await import("./helpers/event-source-retirement-fixture.mjs");
  const { canvasQueueDatabase } = await import("./helpers/canvas-source-queue-host.mjs");
  // Reuse the existing scoped-after pattern from the Workspace/Product fragment
  // fixtures. Native View's second real host starts only after the first retires;
  // it is not a nested test and does not add a case to the original 165.
  const cleanups = [], network = [], mockRestores = [], cleanupErrors = [];
  const setup = { diagnostic: value => t.diagnostic(value), after: callback => cleanups.push(callback),
    mock: { method(...args) {
      const observed = t.mock.method(...args);
      if (args[0] === globalThis && args[1] === "fetch") network.push(observed);
      mockRestores.push(() => observed.mock.restore());
      return observed;
    } } };
  let result, failure;
  try {
    accountCachePort(setup);
    const accountIndexedDB = globalThis.indexedDB, queue = canvasQueueDatabase();
    globalThis.indexedDB = { open(name, version) {
      return name === "canvas-offline-queue-v1" ? queue.indexedDB.open(name, version) : accountIndexedDB.open(name, version);
    } };
    // Observe the exact registered callback; do not change listener order or
    // replace Canvas's receiver. Shell legitimately registers keydown first.
    const registrations = [], originalAdd = ports.windowPort.addEventListener;
    ports.windowPort.addEventListener = function(type, listener, ...rest) {
      const value = Reflect.apply(originalAdd, this, [type, listener, ...rest]);
      if (type === "keydown") registrations.push(listener);
      return value;
    };
    let f;
    try { f = await boardPage(setup, { locale }); }
    finally { ports.windowPort.addEventListener = originalAdd; }
    const h = f.storeHost, canvas = f.canvas, wrapper = canvas.closest("forma-canvas-application");
    // C223 finite-native prerequisite. The reduced Canvas renderer reflected id
    // from attributes; the full native base did not. Production itself reads
    // element.id before focus.run, so an oracle-only getAttribute change cannot
    // repair this missing platform property. No ID, focus target or currentness
    // value is supplied by the test: both directions use the actual attribute.
    const reflectId = node => Object.defineProperty(node, "id", { configurable: true, enumerable: true,
      get() { return String(this.getAttribute("id") ?? ""); },
      set(value) { this.setAttribute("id", String(value)); } });
    const collectWithNativeId = f.renderer.collect;
    f.renderer.collect = function(...args) {
      const first = this.nodes.length; const value = Reflect.apply(collectWithNativeId, this, args);
      for (const node of this.nodes.slice(first)) reflectId(node);
      return value;
    };
    for (const node of f.renderer.nodes) reflectId(node);
    setup.after(() => { f.renderer.collect = collectWithNativeId; });
    // Observe the exact native write while its original node is connected and
    // in the committed tree. Later finite redraws may recreate literal ports;
    // this does not remap activeElement or manufacture a native lifetime.
    const focusEvidence = [], removeFocusObserver = ports.documentPort.removeEventListener.bind(ports.documentPort);
    const observeFocus = event => {
      const node = event.target, tree = f.tree(), rows = tree.nodes.filter(value => value.port === node);
      focusEvidence.push({ node, write: f.native.nativeFocus.at(-1), id: node?.id,
        attributeId: node?.getAttribute?.("id"), owner: rows[0]?.owner, connectedAtCall: node?.isConnected === true,
        exactCurrentRows: rows.length, sameCanvas: node?.closest?.("forma-canvas-surface") === canvas,
        matchingIds: tree.nodes.filter(value => value.port && value.attributes.id === node?.id).length });
    };
    f.native.document.addEventListener("focusin", observeFocus);
    setup.after(() => { ports.bindFixture(f); removeFocusObserver("focusin", observeFocus); });
    assert.equal(f.host.tag, "forma-shell"); assert.equal(canvas.closest("forma-shell"), f.host);
    assert.ok(ports.ElementPort.hasStoreIdentity(f.host, f.store) && ports.ElementPort.hasStoreIdentity(canvas, f.store));
    assert.ok(wrapper?.isConnected && canvas.isConnected && f.store.routeDataReady());
    assert.equal(f.store.ui.instrumentation, false);
    assert.equal(f.i18n.locale, locale); assert.equal(canvas.i18n.locale, locale);
    const sourceText = fs.readFileSync(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8");
    assert.ok(sourceText.includes("#keyboard=(event:KeyboardEvent)=>this.#onKey(event);"));
    assert.ok(sourceText.includes('window.addEventListener("keydown",this.#keyboard);'));
    const keyboards = registrations.filter(listener => typeof listener === "function"
      && /^\(?event\)?=>this\.#onKey\(event\)$/u.test(Function.prototype.toString.call(listener).replace(/\s/gu, "")));
    assert.equal(keyboards.length, 1, "one actual Canvas keyboard closure was registered by the current mounted class");
    const keyboard = keyboards[0];
    assert.equal((f.listeners.get("keydown") ?? []).filter(value => value === keyboard).length, 1);
    const settle = async () => {
      await drain(f, 2); await f.resume.settleOriginalRequests(); await h.worker.drainBackground(); await drain(f, 2);
      assert.equal(f.resume.pendingOriginalCount(), 0);
      for (const request of network) assert.equal(request.mock.callCount(), 0, "no swallowed global/provider fetch");
    };
    const popover = name => {
      const owners = f.components().filter(owner => owner.tag === "forma-ui-popover" && classed(owner, name));
      assert.equal(owners.length, 1, "one current actual " + name); return owners[0];
    };
    const row = (tag, predicate, visible = true) => {
      const tree = f.tree(), rows = (visible ? tree.visible(tag) : tree.nodes.filter(value => value.tag === tag)).filter(predicate);
      assert.equal(rows.length, 1, "one actual " + tag); assert.ok(rows[0].port?.isConnected); return rows[0];
    };
    const toggle = async (menu, open) => {
      const panel = menu.querySelector(".ui-popover-panel"); assert.ok(panel?.isConnected);
      if (panel.matches(":popover-open") !== open) {
        const trigger = row("button", value => value.owner === menu && classed(value, "ui-popover-trigger"));
        assert.equal(trigger.attributes.popovertarget, panel.getAttribute("id"));
        f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); trigger.port.click(); await settle();
      }
      assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), open);
      assert.equal(row("button", value => value.owner === menu && classed(value, "ui-popover-trigger")).attributes["aria-expanded"], String(open));
    };
    const viewTrigger = () => row("button", value => value.owner === popover("canvas-view-menu") && classed(value, "ui-popover-trigger"));
    const intent = () => row("input", value => value.owner === popover("canvas-intent-dock") && value.attributes.maxlength === "2000", false);
    const viewAction = async predicate => {
      const menu = popover("canvas-view-menu"); await toggle(menu, true);
      const tree = f.tree(), actions = tree.visible("button").filter(value => value.owner === menu && predicate(value));
      assert.equal(actions.length, 1); const action = actions[0];
      const groups = tree.visible("div").filter(value => value.owner === menu && classed(value, "canvas-view-actions") && inside(action, value));
      assert.equal(groups.length, 1); const capture = groups[0];
      assert.equal(capture.handlers.click.capture, true); assert.equal(typeof capture.handlers.click.handleEvent, "function");
      assert.equal(typeof action.handlers.click, "function"); assert.ok(action.port.isConnected && !action.port.matches(":disabled"));
      const path = []; for (let at = action; at; at = at.parent) {
        const node = at.port ?? at.component; if (node && !path.includes(node)) path.push(node);
      } path.push(f.native.document);
      f.native.emit("pointerdown", action.port); f.native.focus(action.port);
      const event = { type: "click", target: action.port, currentTarget: capture.port, button: 0,
        metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
        preventDefault() { assert.fail("current native View action remains available"); }, stopPropagation() {},
        stopImmediatePropagation() { assert.fail("current View scope"); }, composedPath: () => path };
      // Same original capture -> target delivery as the reached Reading-order
      // witness. No draw, replacement target or synthetic opener between them.
      capture.handlers.click.handleEvent(event); event.currentTarget = action.port;
      await action.handlers.click.call(action.owner, event); event.currentTarget = null; await settle();
      assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), false);
      if (action.attributes.id === "canvas-outcome-toggle") {
        const committed = f.store.captureWorkspaceNavigationFocus(f.store.route.get());
        assert.ok(committed && committed.routeCurrent(), "the actual Store owns this exact committed route/focus receipt");
        // Completion disposes that original focus lease. Do not replace it or
        // ask current() to claim a new gesture after its lifetime has ended.
      }
      return { menu, panelId: menu.querySelector(".ui-popover-panel").getAttribute("id") };
    };
    const arrangement = () => row("dialog", value => value.owner === canvas && classed(value, "canvas-outcome-arrangement-dialog") && value.port.open);
    let selectedItem;
    if (selected) {
      const direction = f.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction" && !block.removed);
      assert.ok(direction && direction.type === "direction" && direction.documentId === f.documentId);
      await f.resume.settleOriginalRequests(); assert.equal(f.resume.pendingOriginalCount(), 0);
      // Root-authorized declared historical fixture premise only. external()
      // appends one audit row and refreshes the real Store; this is neither a
      // user placement nor an HTTP200/receipt witness and creates no new block.
      await f.external("CanvasItemPlaced", { canvas_id: BOARD, item_id: "calm-existing-direction", source_kind: "block",
        source_id: direction.id, title: "Existing authored direction", block_type: "direction",
        frame: { x: 0, y: 0, w: 300, h: 210, z: "c", rot: 0 } });
      await settle();
      const item = f.store.canvasProjection.get().items.find(value => value.id === "calm-existing-direction");
      assert.equal(item.sourceId, direction.id); assert.equal(item.sourceKind, "block");
      selectedItem = item;
      t.diagnostic("CANVAS_CALM_DECLARED_PREMISE " + JSON.stringify({ locale, type: "CanvasItemPlaced", sourceId: direction.id,
        itemId: item.id, existingBlock: true, userPlacementOrHttpReceipt: false }));
    }
    await settle();
    assert.deepEqual(f.store.optimisticEvents.get(), []); assert.equal(queue.values.size, 0);
    // C223 disclosed setup prerequisite: signal-populated Scene fixtures have
    // not run the production private-content initialization. Certify readiness
    // through ONE original public owned read, never by setting a private flag,
    // replacing content, or ignoring a later post-floor request.
    const retainedDocument = f.store.projection.get().documents.find(value => value.id === f.documentId && value.projectId === f.projectId);
    assert.ok(retainedDocument);
    const retainedArtifact = f.store.projection.get().libraryArtifacts.find(value => value.id === "saved-scene-story" && value.documentId === retainedDocument.id);
    assert.ok(retainedArtifact?.contentRef); assert.equal(retainedArtifact.contentRef, h.worker.contentRef);
    const retainedEvent = f.store.events.get().find(value => value.eventId === retainedArtifact.sourceEventId);
    assert.equal(retainedEvent?.type, "DocumentRenderCompleted"); assert.equal(retainedEvent.payload.project_id, f.projectId);
    assert.equal(retainedEvent.payload.document_id, f.documentId); assert.equal(retainedEvent.payload.artifact_id, retainedArtifact.id);
    assert.equal(retainedEvent.payload.content_ref, retainedArtifact.contentRef);
    const retainedContent = f.store.content.get()[retainedArtifact.contentRef];
    assert.equal(typeof retainedContent, "string"); assert.equal(retainedContent, h.worker.content);
    const readSource = f.store.captureSourceOwnership(), readAuthority = f.store.captureAuthorizationScope();
    const readBefore = { route: f.store.route.get(), history: [...f.history], requests: h.requests.length,
      projectionDocumentId: f.store.projection.get().documentId, planningDocumentId: f.store.canvasPlanningDocumentId(),
      events: structuredClone(f.store.events.get()), head: f.store.head.get(), content: structuredClone(f.store.content.get()),
      canonical: await readWorkspaceEvents(h.worker.env, h.worker.streamId), fiscal: financial(h.worker),
      private: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
      receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all() };
    // Canvas planning is independent of the route/history-selected Document.
    // Retain both actual identities; never choose or rewrite the global one.
    assert.equal(readBefore.planningDocumentId, retainedDocument.id);
    const readUrl = "/api/events?after=" + readBefore.head + "&limit=1&content=1";
    const readCurrent = () => f.store.sourceOwnershipActive(readSource) && f.store.authorizationScopeActive(readAuthority)
      && f.store.route.get() === readBefore.route && f.store.projection.get().projectId === f.projectId
      && f.store.projection.get().documentId === readBefore.projectionDocumentId
      && f.store.canvasPlanningDocumentId() === readBefore.planningDocumentId && canvas.isConnected && canvas.store === f.store;
    t.diagnostic("CANVAS_CALM_READ_OWNER_PREREQUISITE " + JSON.stringify({
      projectionDocumentId: f.store.projection.get().documentId, capturedProjectionDocumentId: readBefore.projectionDocumentId,
      planningDocumentId: f.store.canvasPlanningDocumentId(), capturedPlanningDocumentId: readBefore.planningDocumentId,
      retainedDocumentId: retainedDocument.id, fixturePlanningDocumentId: f.documentId,
      sourceCurrent: f.store.sourceOwnershipActive(readSource), authorityCurrent: f.store.authorizationScopeActive(readAuthority),
      sameRoute: f.store.route.get() === readBefore.route, sameProject: f.store.projection.get().projectId === f.projectId,
      connectedCanvas: canvas.isConnected, sameStore: canvas.store === f.store,
      evidence: "independent current global and explicit Canvas planning identities, before the one original GET" }));
    assert.ok(readCurrent());
    const priorTransport = h.transport, originalReads = []; let readFailure;
    assert.equal(typeof priorTransport, "function", "the existing original-Resume transport remains authoritative");
    const observeRead = async request => {
      try {
        assert.ok(readCurrent()); assert.equal(request.url, readUrl);
        assert.equal(request.init.method ?? "GET", "GET"); assert.equal(request.init.body, undefined); assert.equal(request.body, null);
        assert.equal(originalReads.length, 0, "only one declared original readiness read");
        const observed = { request, init: request.init, response: null }; originalReads.push(observed);
        const response = await priorTransport(request); observed.response = response;
        assert.ok(readCurrent()); assert.equal(response.status, 200);
        const body = await response.clone().json(); assert.ok(readCurrent());
        assert.equal(body.head, readBefore.head); assert.deepEqual(body.events, []);
        assert.equal(body.content?.[retainedArtifact.contentRef], retainedContent);
        assert.equal(response.bodyUsed, false, "the observer reads only a clone and returns the untouched original response");
        return response;
      } catch (error) { readFailure = error; throw error; }
    };
    h.transport = observeRead;
    let readyContent;
    try { readyContent = await f.store.ensurePrivateContent(retainedArtifact.contentRef, { force: true }); }
    finally { if (h.transport === observeRead) h.transport = priorTransport; }
    if (readFailure) throw readFailure;
    assert.equal(readyContent, retainedContent); assert.equal(originalReads.length, 1);
    const originalRead = originalReads[0]; assert.equal(originalRead.response?.bodyUsed, true, "the actual Store consumed that same original response");
    assert.equal(h.requests.length, readBefore.requests + 1); assert.strictEqual(h.requests[readBefore.requests], originalRead.request);
    assert.strictEqual(originalRead.request.init, originalRead.init); assert.equal(originalRead.request.url, readUrl);
    await settle(); assert.ok(readCurrent()); assert.equal(h.requests.length, readBefore.requests + 1);
    assert.equal(f.store.route.get(), readBefore.route); assert.deepEqual(f.history, readBefore.history);
    assert.deepEqual({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get() },
      { events: readBefore.events, head: readBefore.head, content: readBefore.content });
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), readBefore.canonical);
    assert.deepEqual(financial(h.worker), readBefore.fiscal);
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), readBefore.private);
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), readBefore.receipts);
    t.diagnostic("CANVAS_CALM_ORIGINAL_READINESS " + JSON.stringify({ method: "GET", url: readUrl, status: originalRead.response.status,
      originalRequest: h.requests[readBefore.requests] === originalRead.request, originalResponseConsumed: originalRead.response.bodyUsed,
      sameOwnedContent: readyContent === retainedContent, sourceCurrent: readCurrent(), canonicalPrivateFiscalRouteUnchanged: true,
      evidence: "one declared ordinary owned-content read before native selection, typing and the unchanged strict request floor" }));
    const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
    const floor = { requests: h.requests.length, queue: queue.requests.length, events: structuredClone(f.store.events.get()),
      head: f.store.head.get(), content: structuredClone(f.store.content.get()), items: structuredClone(f.store.canvasProjection.get().items),
      canonical: await readWorkspaceEvents(h.worker.env, h.worker.streamId), fiscal: financial(h.worker),
      private: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
      receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all() };
    const effectsUnchanged = async () => {
      assert.deepEqual(h.requests.slice(floor.requests), [], "the local journey starts zero application requests, including reads");
      assert.deepEqual(queue.requests.slice(floor.queue).filter(value => value.method === "put" || value.method === "delete"), [], "no local batch was enqueued or removed");
      assert.equal(queue.values.size, 0); assert.deepEqual(f.store.optimisticEvents.get(), []);
      assert.deepEqual({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get() },
        { events: floor.events, head: floor.head, content: floor.content });
      assert.deepEqual(f.store.canvasProjection.get().items, floor.items);
      assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), floor.canonical);
      assert.deepEqual(financial(h.worker), floor.fiscal);
      assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), floor.private);
      assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.receipts);
    };
    const quiet = async () => {
      await settle(); await f.sourceUnchanged(); await effectsUnchanged();
      assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authority));
      assert.ok(canvas.isConnected && wrapper.isConnected && canvas.closest("forma-shell") === f.host);
      assert.equal(f.store.canvasProjection.get().selectedCanvasId, BOARD);
    };
    const page = { f, canvas, row, popover, toggle, viewTrigger, viewAction, intent, arrangement, keyboard, settle, quiet, effectsUnchanged, focusEvidence,
      selected: () => [...f.store.canvasPlanningSelection.get().itemIds],
      select: async () => {
        assert.ok(selectedItem);
        const card = row("article", value => value.owner === canvas && value.attributes["data-canvas-item-id"] === selectedItem.id);
        f.native.emit("pointerdown", card.port); f.native.focus(card.port);
        await f.act(card, "click", { button: 0, shiftKey: false, composedPath: () => [card.port] }); await settle();
        assert.deepEqual(f.store.canvasPlanningSelection.get().itemIds, [selectedItem.id]);
      },
      editor: () => { const editors = f.components().filter(owner => owner.tag === "forma-context-intelligence" && owner.block?.id === "scene-reuse-direction"); assert.equal(editors.length, 1); return editors[0]; },
      desk: () => viewAction(value => value.attributes.id === "canvas-outcome-toggle"),
      openArrangement: () => viewAction(value => String(value.handlers.click).includes("#openArrangement()") && !String(value.handlers.click).includes("#retrieveArrangement()")),
      cancelArrangement: async () => { const dialog = arrangement(); await f.act(dialog, "cancel"); await settle(); },
      setIntent: async value => { const dock = popover("canvas-intent-dock"); await toggle(dock, true); const field = intent();
        assert.equal(field.hiddenBy, null); assert.equal(field.port.matches(":disabled"), false);
        f.native.emit("keydown", field.port); f.native.focus(field.port); field.port.value = value;
        await f.act(field, "input"); await settle(); assert.equal(intent().port.value, value); await toggle(dock, false); } };
    result = await run(page);
  } catch (error) { failure = error; }
  // Run every existing fixture hook in its registration order, even after an
  // assertion fails. No late original transport or native wrapper is abandoned.
  for (const cleanup of cleanups) { try { await cleanup(); } catch (error) { cleanupErrors.push(error); } }
  // The no-provider boundary remains installed through every original teardown,
  // including a failing journey. Check swallowed calls before restoring mocks.
  for (const request of network) {
    try { assert.equal(request.mock.callCount(), 0, "no swallowed global/provider fetch during setup, journey or teardown"); }
    catch (error) { cleanupErrors.push(error); }
  }
  for (const restore of mockRestores.reverse()) { try { restore(); } catch (error) { cleanupErrors.push(error); } }
  if (failure || cleanupErrors.length) {
    if (failure && !cleanupErrors.length) throw failure;
    throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "Canvas full-host journey/cleanup failed");
  }
  return result;
}
