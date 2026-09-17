import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { registerHooks } from "node:module";
import ts from "typescript";
import * as lit from "lit";

// Complete actual frontend modules with fresh localization state per fixture.
// Native elements, Lit commits, device preferences and HTTP are finite ports;
// these checks do not certify browsers, physical devices or assistive technology.
const ROOT = new URL("../", import.meta.url);
const ENTRY = "src/apps/public-share/entry.ts";
const LOCALIZATION = "src/components/design-system/localization.ts";
const TOKEN = "Aa0_-".repeat(6) + "xy";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compiled = new Map();
const resolveModule = (name, parent) => new URL(/\.[a-z]+$/iu.test(name) ? name : name + ".ts", new URL(parent, ROOT));
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(ROOT.href) && specifier.startsWith(".") && !/\.[a-z]+$/iu.test(specifier)) {
    const candidate = new URL(specifier + ".ts", context.parentURL);
    if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return next(specifier, context);
} });

function compile(relative) {
  if (compiled.has(relative)) return compiled.get(relative);
  const source = fs.readFileSync(new URL(relative, ROOT), "utf8");
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [], dynamic = new Set();
  for (const node of tree.statements) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) imports.push(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) imports.push(node.moduleSpecifier.text);
  }
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(node.arguments.length, 1); assert.ok(ts.isStringLiteral(node.arguments[0])); dynamic.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const result = { imports: [...new Set(imports)], dynamic, code }; compiled.set(relative, result); return result;
}

async function fixture(t, { pathname = "/share/output/" + TOKEN, saved = "en", browser = "ja" } = {}) {
  const registry = new Map(), modules = new Map(), loaded = new Set(), dynamicLoads = [], dirty = new Set(), events = [], requests = [], writes = [];
  const storage = new Map(saved === null ? [] : [["forma:locale", saved]]), instances = new Map(), pending = new Set();
  let sequence = 0, document;
  class NativeElement {
    constructor(tag = "") { this.tag = tag; this.uid = ++sequence; this.attributes = {}; this.children = []; this.listeners = new Map(); this.isConnected = false; this.textContent = ""; this.parentElement = null; }
    get ownerDocument() { return document; }
    get renderRoot() { return this; }
    get updateComplete() { return Promise.resolve(true); }
    setAttribute(name, value) { const old = this.getAttribute(name); this.attributes[name] = String(value); if (old !== String(value) && this.constructor.observedAttributes?.includes(name)) this.attributeChangedCallback?.(name, old, String(value)); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { const old = this.getAttribute(name); delete this.attributes[name]; if (old !== null && this.constructor.observedAttributes?.includes(name)) this.attributeChangedCallback?.(name, old, null); }
    toggleAttribute(name, force) { const next = force ?? !this.hasAttribute(name); if (next) this.setAttribute(name, ""); else this.removeAttribute(name); return next; }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); if (this.isConnected) connect(node); } }
    replaceChildren(...nodes) { const keep = new Set(nodes.flatMap(walk)); for (const child of this.children) disconnect(child, keep); this.children = []; this.append(...nodes); }
    addEventListener(type, callback) { const values = this.listeners.get(type) ?? new Set(); values.add(callback); this.listeners.set(type, values); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatchEvent(event) {
      if (!event.target) Object.defineProperty(event, "target", { configurable: true, value: this });
      Object.defineProperty(event, "currentTarget", { configurable: true, value: this });
      events.push({ tag: this.tag, type: event.type, detail: event.detail });
      for (const callback of this.listeners.get(event.type) ?? []) {
        const task = callback.call(this, event);
        if (task?.then) { pending.add(task); void task.finally(() => pending.delete(task)); }
      }
      if (event.bubbles && !event.cancelBubble && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    querySelectorAll(selector) { return walk(this).slice(1).filter(node => selector.startsWith("[") ? node.hasAttribute(selector.slice(1, -1)) : selector.startsWith("#") ? node.getAttribute("id") === selector.slice(1) : node.tag === selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  class NativeLitElement extends NativeElement {
    constructor() { super(); this.controllers = new Set(); }
    addController(controller) { this.controllers.add(controller); if (this.isConnected) controller.hostConnected?.(); }
    requestUpdate() { dirty.add(this); }
    connectedCallback() { for (const controller of this.controllers) controller.hostConnected?.(); this.requestUpdate(); }
    disconnectedCallback() { for (const controller of this.controllers) controller.hostDisconnected?.(); }
    update() { commit(this.render(), this); }
    perform() { dirty.delete(this); this.willUpdate?.(new Map()); this.update(new Map()); this.updated?.(new Map()); }
  }
  function walk(node) { return [node, ...node.children.flatMap(walk)]; }
  function connect(node) { if (!node.isConnected) { node.isConnected = true; node.connectedCallback?.(); } for (const child of node.children) connect(child); }
  function disconnect(node, keep = new Set()) { if (keep.has(node)) return; for (const child of node.children) disconnect(child, keep); if (node.isConnected) { node.isConnected = false; node.disconnectedCallback?.(); } dirty.delete(node); }
  const node = tag => { const Constructor = registry.get(tag); const result = Constructor ? new Constructor() : new NativeElement(tag); result.tag = tag; return result; };
  document = new NativeElement("#document"); document.isConnected = true;
  document.documentElement = node("html"); document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; document.documentElement.dataset = {};
  document.body = node("body"); document.append(document.documentElement); document.documentElement.append(document.body);
  document.location = { origin: "https://fixture.invalid", pathname }; document.visibilityState = "visible";
  document.createElement = node;
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { writes.push({ key, value: String(value) }); storage.set(key, String(value)); } };
  const nativeWindow = { setTimeout() { throw new Error("No recipient output is issued by the entry fixture"); }, clearTimeout() {}, addEventListener() {}, removeEventListener() {} };
  document.defaultView = nativeWindow;

  // Parse only developer-authored Lit template strings. Values become literal
  // text nodes, property values or event listeners; they are never parsed as HTML.
  function materialize(value, owner, scope) {
    if (value == null || value === lit.nothing || typeof value === "boolean") return [];
    if (Array.isArray(value)) return value.flatMap((part, index) => materialize(part, owner, scope + "/" + index));
    if (!value?.strings) { const text = node("#text"); text.textContent = String(value); return [text]; }
    let markup = ""; for (let index = 0; index < value.strings.length; index++) markup += value.strings[index] + (index < value.values.length ? "__value_" + index + "__" : "");
    const root = node("#fragment"), stack = [root]; let ordinal = 0;
    const bound = raw => { const exact = /^__value_(\d+)__$/u.exec(raw); return exact ? value.values[Number(exact[1])] : raw.replace(/__value_(\d+)__/gu, (_, index) => String(value.values[Number(index)])); };
    for (const token of markup.match(/<\/?[\w-]+\b[^>]*>|[^<]+/gu) ?? []) {
      if (token.startsWith("</")) { stack.pop(); continue; }
      if (!token.startsWith("<")) {
        let start = 0; for (const match of token.matchAll(/__value_(\d+)__/gu)) {
          stack.at(-1).append(...materialize(token.slice(start, match.index), owner, scope + "/text"));
          stack.at(-1).append(...materialize(value.values[Number(match[1])], owner, scope + "/value:" + match[1])); start = match.index + match[0].length;
        }
        stack.at(-1).append(...materialize(token.slice(start), owner, scope + "/tail")); continue;
      }
      const [, tag, raw] = token.match(/^<([\w-]+)([^>]*)>/u), key = owner.uid + "/" + scope + "/" + ordinal++ + "/" + tag;
      const current = registry.has(tag) ? instances.get(key) ?? node(tag) : node(tag);
      if (registry.has(tag)) instances.set(key, current);
      for (const [type, callback] of current.templateEvents ?? []) current.removeEventListener(type, callback);
      current.templateEvents = [];
      for (const [, name, quoted, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
        const item = bound(quoted ?? single ?? bare ?? "");
        if (name.startsWith(".")) current[name.slice(1)] = item;
        else if (name.startsWith("@")) { current.addEventListener(name.slice(1), item); current.templateEvents.push([name.slice(1), item]); }
        else if (name.startsWith("?")) current.toggleAttribute(name.slice(1), Boolean(item));
        else current.setAttribute(name, item);
      }
      stack.at(-1).append(current);
      if (!["input", "img", "br", "hr", "meta", "link"].includes(tag)) stack.push(current);
    }
    assert.equal(stack.length, 1, "balanced actual frontend template"); return root.children;
  }
  function commit(value, container) { container.replaceChildren(...materialize(value, container, "render")); }
  const fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/fixture\.invalid\/api\/selected-output-shared\/[A-Za-z0-9_-]{32}$/u, "no Store, session, private or provider request is available");
    requests.push({ url, init }); return new Response(null, { status: 404 });
  };

  async function load(relative) {
    assert.ok(relative.startsWith("src/") && !relative.startsWith("src/state/") && !relative.includes("forma-element.ts"), "frontend-only module: " + relative);
    if (modules.has(relative)) return modules.get(relative);
    if (relative.endsWith(".css")) return {};
    loaded.add(relative);
    // The unchanged legacy route is checked as an emitted tag/token only. Its
    // private Store/whole-Document dependency graph is explicitly out of scope.
    if (relative === "src/components/forma-shared-view.ts") return {};
    if (relative.startsWith("src/model/") || relative.includes("/design-system/locales/")) {
      const actual = await import(new URL(relative, ROOT).href); modules.set(relative, actual); return actual;
    }
    const definition = compile(relative), dependencies = new Map(), exports = {};
    for (const name of definition.imports) {
      if (name === "lit") dependencies.set(name, { ...lit, LitElement: NativeLitElement, render: commit });
      else if (name.startsWith(".")) dependencies.set(name, await load(resolveModule(name, relative).pathname.slice(ROOT.pathname.length)));
      else throw new Error("Unsupported frontend module dependency " + name);
    }
    const require = name => {
      if (dependencies.has(name)) return dependencies.get(name);
      assert.ok(definition.dynamic.has(name), "only an actual literal dynamic import may load a catalog");
      const path = resolveModule(name, relative).pathname.slice(ROOT.pathname.length); dynamicLoads.push(path); return load(path);
    };
    await new AsyncFunction("require", "exports", "document", "window", "location", "navigator", "localStorage", "HTMLElement", "customElements", "fetch", definition.code)(
      require, exports, document, nativeWindow, document.location, { languages: [browser], language: browser }, localStorage, NativeElement,
      { get: name => registry.get(name), define(name, constructor) { assert.equal(registry.has(name), false); registry.set(name, constructor); } }, fetch,
    );
    modules.set(relative, exports); return exports;
  }
  await load("src/components/design-system/locale-bootstrap.ts");
  const { FormaPublicShare } = await load(ENTRY);
  const localization = await load(LOCALIZATION);
  const recipient = await load("src/components/forma-selected-output-shared-view.ts");
  assert.equal(registry.get("forma-selected-output-shared-view"), recipient.FormaSelectedOutputSharedView, "the actual recipient module was executed");
  const host = new FormaPublicShare(); host.tag = "forma-public-share"; document.body.append(host);
  const draw = () => { host.requestUpdate(); for (let iteration = 0; iteration < 20 && dirty.size; iteration++) for (const component of [...dirty]) { if (component.isConnected) component.perform(); else dirty.delete(component); } assert.equal(dirty.size, 0, "finite frontend render settles"); };
  const settle = async predicate => { for (let index = 0; index < 40; index++) { await new Promise(setImmediate); draw(); if (predicate()) return; } assert.ok(predicate(), "finite entry observation settles"); };
  const all = tag => walk(host).filter(item => item.tag === tag);
  const picker = () => all("forma-ui-language-picker")[0];
  const control = () => picker().querySelector("select");
  const text = element => element.textContent + element.children.map(text).join("");
  draw(); await settle(() => pending.size === 0 && !all("forma-selected-output-shared-view")[0]?.querySelector('[aria-busy]')?.getAttribute("aria-busy")?.includes("true"));
  t.after(() => { disconnect(host); assert.equal(pending.size, 0); });
  return { document, host, registry, localization, loaded, dynamicLoads, requests, writes, storage, events, all, picker, control, text, draw, settle,
    change(value) { control().value = value; control().dispatchEvent(new Event("change", { bubbles: true })); },
  };
}

test("actual public entry admits only canonical and single-trailing-slash selected tokens", async t => {
  for (const suffix of ["", "/"]) {
    const f = await fixture(t, { pathname: "/share/output/" + TOKEN + suffix });
    assert.equal(f.all("forma-selected-output-shared-view")[0].token, TOKEN);
    assert.equal(f.all("forma-shared-view").length, 0);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, "https://fixture.invalid/api/selected-output-shared/" + TOKEN);
  }
});

test("invalid selected namespace routes render the actual unavailable recipient with an empty token", async t => {
  for (const path of ["/share/output", "/share/output/", "/share/output/short", "/share/output/%41" + TOKEN.slice(1),
    "/share/output/" + TOKEN + "/extra", "/share/output/" + TOKEN + "//", "/share/output//" + TOKEN]) {
    const f = await fixture(t, { pathname: path });
    const view = f.all("forma-selected-output-shared-view")[0];
    assert.ok(view); assert.equal(view.token, "", path); assert.equal(f.all("forma-shared-view").length, 0);
    assert.equal(f.requests.length, 0, path); assert.ok(f.text(view).includes("Unavailable"));
  }
});

test("legacy whole-Document route keeps its original tag and decoded token boundary", async t => {
  for (const [path, token] of [["/share/legacy-token", "legacy-token"], ["/share/legacy%2Dtoken/", "legacy-token"], ["/share", ""]]) {
    const f = await fixture(t, { pathname: path });
    assert.equal(f.all("forma-shared-view")[0].token, token); assert.equal(f.all("forma-selected-output-shared-view").length, 0);
    assert.equal(f.requests.length, 0); assert.ok(f.loaded.has("src/components/forma-shared-view.ts"));
    assert.equal(f.registry.has("forma-shared-view"), false, "legacy implementation is an explicit unchanged boundary");
  }
});

const translations = {
  en: { skip: "Skip to main content", label: "Language", dir: "ltr" },
  fr: { skip: "Aller au contenu principal", label: "Langue", dir: "ltr" },
  ja: { skip: "メインコンテンツに移動", label: "言語", dir: "ltr" },
  ar: { skip: "الانتقال إلى المحتوى الرئيسي", label: "اللغة", dir: "rtl" },
};
for (const locale of ["en", "fr", "ja", "ar"]) test("fresh actual saved " + locale + " bootstrap overrides a different navigator locale", async t => {
  const f = await fixture(t, { saved: locale, browser: locale === "ja" ? "fr" : "ja" });
  const copy = translations[locale], current = f.localization.currentFormaLocale();
  assert.equal(current.locale, locale); assert.equal(f.document.documentElement.lang, locale); assert.equal(f.document.documentElement.dir, copy.dir);
  assert.equal(f.text(f.all("a")[0]), copy.skip); assert.equal(f.picker().label, copy.label); assert.equal(f.control().value, locale);
  assert.equal(f.text(f.picker().querySelector("span")), copy.label);
  assert.deepEqual(f.control().children.map(option => [option.value, option.textContent, option.dir]), [
    ["en", "English", "ltr"], ["fr", "Français", "ltr"], ["ar", "العربية", "rtl"], ["ja", "日本語", "ltr"],
  ]);
  assert.equal(f.storage.get("forma:locale"), locale); assert.equal(f.requests.length, 1);
  assert.deepEqual(f.dynamicLoads.filter(path => /\/locales\/(fr|ja|ar)\.ts$/u.test(path)), locale === "en" ? [] : ["src/components/design-system/locales/" + locale + ".ts"]);
});

test("real native picker events reach the actual entry handler and persist/update locale without refetch", async t => {
  const f = await fixture(t, { saved: "en", browser: "ja" }), original = f.all("forma-selected-output-shared-view")[0];
  for (const locale of ["fr", "ar", "ja", "en"]) {
    f.change(locale); await f.settle(() => f.localization.currentFormaLocale().locale === locale);
    assert.equal(f.storage.get("forma:locale"), locale); assert.equal(f.writes.at(-1).value, locale);
    assert.equal(f.document.documentElement.dir, translations[locale].dir);
    assert.equal(f.picker().label, translations[locale].label); assert.equal(f.control().value, locale);
    assert.equal(f.text(f.all("a")[0]), translations[locale].skip);
    assert.equal(f.all("forma-selected-output-shared-view")[0], original); assert.equal(original.token, TOKEN); assert.equal(f.requests.length, 1);
  }
  assert.ok(f.events.some(event => event.tag === "forma-ui-language-picker" && event.type === "forma-change"));
  assert.ok(f.events.some(event => event.tag === "#document" && event.type === "forma-locale-change"));
});

test("actual native picker ignores disabled, busy and unsupported changes before the entry handler", async t => {
  const f = await fixture(t), writes = f.writes.length;
  const emitted = () => f.events.filter(event => event.tag === "forma-ui-language-picker" && event.type === "forma-change").length;
  for (const property of ["disabled", "busy"]) {
    f.picker()[property] = true; assert.equal(f.control().disabled, true);
    f.change("ar"); await f.settle(() => true);
    assert.equal(f.localization.currentFormaLocale().locale, "en"); assert.equal(f.control().value, "en"); assert.equal(emitted(), 0);
    f.picker()[property] = false;
  }
  f.change("zz"); await f.settle(() => true);
  assert.equal(f.localization.currentFormaLocale().locale, "en"); assert.equal(f.control().value, "en");
  assert.equal(emitted(), 0); assert.equal(f.writes.length, writes); assert.equal(f.requests.length, 1);
});
