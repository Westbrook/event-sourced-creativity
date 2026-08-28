import assert from "node:assert/strict";
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
  addEventListener() {}
  removeEventListener() {}
  matches(selector) { return selector === ":dir(rtl)" ? this.i18n?.direction === "rtl" : selector.split(",").some(part=>part.trim()===this.tag||part.trim().startsWith(".")&&String(this.attributes?.class??"").split(/\s+/).includes(part.trim().slice(1))); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
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
const documentPort = { activeElement: null, body:{isConnected:true,tag:"body"}, documentElement: { lang: "en", dataset: {}, toggleAttribute() {}, removeAttribute() {} }, querySelector: selector => activeFixture?.renderer.query(null, selector)[0] ?? null };
const windowPort = { innerWidth: 1280, innerHeight: 720, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame: callback => callback(), scrollTo() {}, addEventListener(type, handler) { activeFixture.listeners.set(type, [...(activeFixture.listeners.get(type) ?? []), handler]); }, removeEventListener(type, handler) { activeFixture.listeners.set(type, (activeFixture.listeners.get(type) ?? []).filter(value => value !== handler)); }, matchMedia: () => ({ matches: false }) };
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
const presencePort = class { subscribe() {} connect() {} disconnect() {} update() {} };
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
  new Function("require", "exports", "customElements", "document", "window", "HTMLElement", "Element", "CSS", "location", "ResizeObserver", "getComputedStyle", "matchMedia", "InputEvent", "navigator", "requestAnimationFrame", code)(
    require, exports, registry, documentPort, windowPort, ElementPort, ElementPort, { escape: String }, { origin: "https://fixture.invalid" }, class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" }), () => ({ matches: true }), class InputEvent {}, navigatorPort, callback => callback(),
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
      node.parentElement = ancestors.at(-1)??owner; node.fixture = this.fixture; node.tagName = tag.toUpperCase();
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
const { FormaUiPopover } = await loadActual("src/components/design-system/feedback.ts");
const { PresentationDeck } = await loadActual("src/components/presentation-deck.ts");
const { CollectionTree } = await loadActual("src/components/collection-tree.ts");
const { positionNativePopover } = await loadActual("src/components/native-popover.ts");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const registry = { "forma-document-artifacts": DocumentArtifacts, "forma-context-intelligence": ContextIntelligence, "forma-ui-choice-card": FormaUiChoiceCard, "forma-ui-popover": FormaUiPopover, "forma-presentation-deck": PresentationDeck };

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

function fixture(options = {}) {
  const state = { authorization:"actor-a", viewer:Boolean(options.viewer), boardId:"board-a", chosen:options.chosen ?? "", selected:[], events:[], batches:[], requests:[], replies:[], assistant:Boolean(options.assistant), documentCount:options.documentCount ?? 1 };
  const f = {state,locale:options.locale ?? "en",trace:[],listeners:new Map(),clipboard:[],openPopovers:new Set(),openDetails:new Set(),changed:new Map(),steps:0};
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
  f.store = {
    ui:{instrumentation:false}, head:{get:()=>state.events.length}, events:{get:()=>state.events},eventView:{get:()=>state.events},projection:{get:projection},canvasProjection:{get:canvas},
    session:{get:()=>({user:{userId:"owner",role:"user",displayName:"Owner"},canvas:{access:true,blockedBy:[],requirements:[]},provider:{configured:true,plannerConfigured:true,videoConfigured:true,audioConfigured:true},assistant:{enabled:state.assistant},policy:{accepted:true},capabilities:["project.read","project.author","project.output.request"],...(state.viewer?{projectContext:{projectId:"p",projectAccessId:"access",organizationId:"org",ownerUserId:"owner",role:"viewer",permissions:["project.read","project.canvas.use"]}}:{})})},
    captureAuthorizationScope:()=>state.authorization?{key:state.authorization,shared:state.viewer}:null,authorizationScopeActive:scope=>Boolean(state.authorization&&scope?.key===state.authorization),
    route:{get:()=>f.route??"/canvas/"+state.boardId+"/"+state.boardId},setRoute:route=>{f.route=route;},asOf:cell(Infinity),content:cell({"story-content":JSON.stringify({content_markdown:"A complete saved outcome.",title:"Saved exact story",summary:"A complete saved outcome.",items:[]})}),busy:cell(""),
    canUndo:()=>Boolean(options.undo),canRedo:()=>Boolean(options.redo),undo:async()=>f.trace.push("undo"),redo:async()=>f.trace.push("redo"),
    canvasPlanningDocumentId:ids=>canvasDocumentTarget(projection(),canvas(),ids??state.selected,state.chosen),
    chooseCanvasPlanningDocument:id=>{if(!projection().documents.some(doc=>doc.id===id))return false;state.chosen=id;return true;},
    setCanvasPlanningSelection:ids=>{state.selected=[...ids];},
    documentJobs:cell([]),projectNotifications:cell([]),reviewInbox:cell([]),generationReadiness:cell({}),
    documentGenerationJobs:()=>[],documentRenderJobs:()=>[],adaptiveSuggestionSetsFor:()=>[],
    stageOptimisticCanvasEvents:inputs=>inputs.map(append),discardOptimisticCanvasEvents(){},syncCanvasBatch:async()=>assert.fail("The in-memory queue must never reach a network boundary"),
    append:async input=>[append(input)],appendBatch:async inputs=>inputs.map(append),toast:message=>f.trace.push("toast:"+message),
    guardedFetch:async(url,options)=>{const body=JSON.parse(options.body);state.requests.push({url,body});const reply=state.replies.shift();assert.ok(reply,"Mock response prepared for "+url);return{ok:reply.ok!==false,json:async()=>reply.body??reply};},
    structureAdaptive:async(...args)=>{state.requests.push({kind:"adaptive",args});return false;},ensurePrivateContent:async()=>assert.fail("Fixture content is already hydrated"),
  };
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
