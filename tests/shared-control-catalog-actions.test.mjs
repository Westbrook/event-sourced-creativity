import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { html, nothing } from "lit";
import englishMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

// Reuse the actual catalog case, complete primitive classes, actual event helper
// and LocaleController. Native event/template ports below observe composition;
// they do not implement CSS sizing, real shadow distribution, focus or layout.
// No class method or click implementation is substituted.
const root = new URL("../", import.meta.url);
const source = relative => readFileSync(new URL(relative, root), "utf8");
const tree = relative => ts.createSourceFile(relative, source(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const syntax = {
  catalog: tree("src/components/design-system/component-catalog.ts"),
  primitives: tree("src/components/design-primitives.ts"),
  navigation: tree("src/components/design-system/navigation.ts"),
  layout: tree("src/components/design-system/layout.ts"),
  feedback: tree("src/components/design-system/feedback.ts"),
  contracts: tree("src/components/design-system/contracts.ts"),
};
const declaration = (file, name) => {
  const found = syntax[file].statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(found, "current full production declaration: " + name);
  return found;
};
let currentI18n;
class ElementPort extends EventTarget {
  constructor() { super(); this.i18n = currentI18n; this.updates = 0; this.attributes = {}; }
  requestUpdate() { this.updates++; }
  getAttribute(name) { return this.attributes[name] ?? null; }
}
class NativeFormPort {}
const emitSource = syntax.contracts.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "emitFormaEvent");
assert.ok(emitSource);
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const events = {};
new Function("exports", "CustomEvent", transpile(emitSource.getText(syntax.contracts)))(events, CustomEvent);
const compileClass = (file, name) => {
  const exports = {};
  new Function("exports", "FormaPresentationalElement", "FormaSlottedElement", "html", "nothing", "icon", "emitFormaEvent", "CustomEvent",
    transpile(declaration(file, name).getText(syntax[file])))(
    exports, ElementPort, ElementPort, html, nothing, () => nothing, events.emitFormaEvent, CustomEvent);
  return exports[name];
};
const Button = compileClass("primitives", "FormaUiButton");
const Badge = compileClass("primitives", "FormaUiBadge");
const Link = compileClass("navigation", "FormaUiLink");
const Cluster = compileClass("layout", "FormaUiCluster");
const compositions = [
  { Constructor: compileClass("layout", "FormaUiCard"), name: "card", slot: "actions", event: "forma-action" },
  { Constructor: compileClass("layout", "FormaUiPageHeader"), name: "page header", slot: "actions", event: "forma-action" },
  { Constructor: compileClass("layout", "FormaUiListItem"), name: "list item", slot: "trailing", event: "forma-action" },
  { Constructor: compileClass("feedback", "FormaUiNotice"), name: "notice", slot: "actions", event: "forma-dismiss" },
];
const catalog = declaration("catalog", "FormaComponentCatalog");
const demo = catalog.members.find(member => member.name?.getText(syntax.catalog) === "#demo");
const preview = catalog.members.find(member => member.name?.getText(syntax.catalog) === "#preview");
assert.ok(demo && preview);
let clusterCase;
const walk = node => {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "forma-ui-cluster") clusterCase = node;
  ts.forEachChild(node, walk);
};
walk(preview);
assert.ok(clusterCase && clusterCase.statements.length === 1 && ts.isReturnStatement(clusterCase.statements[0]));
const catalogCode = "class ClusterCatalogCase extends ElementPort {\n#message = '';\n" + demo.getText(syntax.catalog)
  + "\nrender() { " + clusterCase.statements[0].getText(syntax.catalog) + " }\nget message() { return this.#message; }\n}";
const CatalogCase = new Function("ElementPort", "html", "nothing", "CustomEvent", "HTMLFormElement",
  transpile(catalogCode) + "\nreturn ClusterCatalogCase;")(ElementPort, html, nothing, CustomEvent, NativeFormPort);

const catalogs = { en: englishMessages, fr: frenchMessages, ar: arabicMessages, ja: japaneseMessages };
async function localeController(t, locale) {
  // Same native registration/context ports as the existing component API
  // documentation localization tests; the whole localization module is actual.
  const previousElement = globalThis.HTMLElement, previousRegistry = globalThis.customElements;
  globalThis.HTMLElement = class extends EventTarget {};
  globalThis.customElements = { get() { return undefined; }, define() {} };
  let module;
  try { module = await import("../src/components/design-system/localization.ts"); }
  finally {
    if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement;
    if (previousRegistry === undefined) delete globalThis.customElements; else globalThis.customElements = previousRegistry;
  }
  const controller = new module.FormaLocaleController({
    addController() {}, requestUpdate() {}, dispatchEvent(event) {
      event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
        messages: { ...module.FORMA_DEFAULT_MESSAGES, ...catalogs[locale] }, revision: 1 }, () => {});
      return true;
    },
  });
  controller.hostConnected(); t.after(() => controller.hostDisconnected()); currentI18n = controller;
  return controller;
}
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const decode = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
function observe(template, owner) {
  const bindings = [];
  const value = item => {
    if (item == null || item === nothing || typeof item === "boolean") return "";
    if (Array.isArray(item)) return item.map(value).join("");
    if (!item?.strings) return escape(item);
    let result = "";
    for (let i = 0; i < item.strings.length; i++) {
      result += item.strings[i];
      if (i < item.values.length) {
        if (result.lastIndexOf("<") > result.lastIndexOf(">")) result += "__bound_" + (bindings.push(item.values[i]) - 1) + "__";
        else result += value(item.values[i]);
      }
    }
    return result;
  };
  const markup = value(template);
  const resolve = raw => {
    const exact = raw.match(/^__bound_(\d+)__$/u);
    return exact ? bindings[Number(exact[1])] : raw.replace(/__bound_(\d+)__/gu, (_, index) => String(bindings[Number(index)] ?? ""));
  };
  const nodes = [];
  for (const match of markup.matchAll(/<([\w-]+)([^>]*)>/gu)) {
    const [, tag, raw] = match, attributes = {}, properties = {}, handlers = {};
    for (const [, name, quoted, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
      const entry = resolve(quoted ?? single ?? bare ?? "");
      if (name[0] === ".") properties[name.slice(1)] = entry;
      else if (name[0] === "@") handlers[name.slice(1)] = entry;
      else if (name[0] === "?") { if (entry) attributes[name.slice(1)] = ""; }
      else if (entry !== nothing) attributes[name] = entry;
    }
    const contentStart = match.index + match[0].length, contentEnd = markup.indexOf("</" + tag + ">", contentStart);
    const textContent = decode((contentEnd < 0 ? "" : markup.slice(contentStart, contentEnd)).replace(/<[^>]*>/gu, ""));
    const node = { tag, attributes, properties, handlers, owner, textContent, getAttribute(name) { return attributes[name] ?? null; } };
    node.click = () => {
      const event = { type: "click", target: node, currentTarget: node, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      if (!Object.hasOwn(attributes, "disabled")) handlers.click?.call(owner, event);
      return event;
    };
    nodes.push(node);
  }
  return { nodes, markup };
}
function instantiate(Constructor, node) {
  const instance = new Constructor();
  for (const [name, value] of Object.entries(node.attributes)) {
    instance.attributes[name] = String(value);
    const entry = Object.entries(Constructor.properties ?? {}).find(([key, options]) => (options.attribute ?? key.toLowerCase()) === name);
    if (entry) instance[entry[0]] = entry[1].type === Boolean ? true : value;
  }
  Object.assign(instance, node.properties);
  return instance;
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("real Cluster catalog native and wrapped actions remain distinct, operable and local-only in " + locale, async t => {
    const i18n = await localeController(t, locale), host = new CatalogCase(), view = observe(host.render(), host);
    const clusters = view.nodes.filter(node => node.tag === "forma-ui-cluster");
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].attributes.alignment, undefined, "centered badge example stays separate");
    assert.equal(clusters[1].attributes.alignment, "stretch");
    const badgeNodes = view.nodes.filter(node => node.tag === "forma-ui-badge");
    assert.equal(badgeNodes.length, 2);
    for (const node of badgeNodes) assert.equal(observe(instantiate(Badge, node).render(), host).nodes.filter(value => value.tag === "button").length, 0);
    const native = view.nodes.find(node => node.tag === "button"), wrappedNode = view.nodes.find(node => node.tag === "forma-ui-button"),
      linkNode = view.nodes.find(node => node.tag === "forma-ui-link");
    assert.ok(native && wrappedNode && linkNode, "exercise emitted peers rather than only asserting selector text");
    assert.equal(native.attributes.type, "button");
    assert.equal(native.textContent, i18n.t("action.cancel"));
    const before = host.updates; native.click();
    assert.equal(host.updates, before + 1);
    assert.equal(host.message, i18n.t("catalog.previewAction", "", { label: native.textContent }));
    const button = instantiate(Button, wrappedNode), link = instantiate(Link, linkNode), dispatches = [];
    // The actual catalog's demo listener is reused as the finite bubbling port.
    const forward = event => { dispatches.push({ type: event.type, detail: event.detail }); demoCallback(event); };
    const demoCallback = event => {
      // Reuse the current case's native callback, whose body invokes actual #demo.
      native.handlers.click.call(host, event);
    };
    button.addEventListener("forma-press", forward); link.addEventListener("forma-navigate", forward);
    const innerButton = observe(button.render(), button).nodes.find(node => node.tag === "button");
    assert.equal(innerButton.textContent, i18n.t("sample.saveDirection", "Save direction"));
    assert.equal(innerButton.attributes.type, "button");
    assert.equal(innerButton.click().defaultPrevented, true, "catalog consumes the semantic demo event");
    assert.deepEqual(dispatches[0], { type: "forma-press", detail: { value: "save-direction" } });
    const innerLink = observe(link.render(), link).nodes.find(node => node.tag === "a");
    assert.equal(innerLink.attributes.href, "#forma-ui-cluster", "real native destination remains exact");
    assert.equal(innerLink.textContent, i18n.t("sample.viewHistory", "View history"));
    assert.equal(innerLink.click().defaultPrevented, true, "demo navigation remains local and canceled by its actual handler");
    assert.deepEqual(dispatches[1], { type: "forma-navigate", detail: { value: "#forma-ui-cluster" } });
    button.disabled = true; observe(button.render(), button).nodes.find(node => node.tag === "button").click();
    assert.equal(dispatches.length, 2, "a disabled wrapped action emits no request");
    const cluster = new Cluster(), authored = [native, button, link, ...badgeNodes.map(node => instantiate(Badge, node))];
    cluster.children = authored; cluster.alignment = "stretch";
    assert.equal(cluster.render(), nothing);
    assert.equal(cluster.children, authored, "layout does not replace native handlers, labels, badges or links");
    assert.equal(host.message, i18n.t("catalog.previewAction", "", { label: link.label }));
  });

  for (const composition of compositions) test("actual " + composition.name + " accepts long native/wrapped peers and metadata without changing actions in " + locale, async t => {
    const i18n = await localeController(t, locale), host = new composition.Constructor();
    const long = [i18n.t("sample.saveDirection", "Save direction"), i18n.t("sample.viewHistory", "View history"),
      i18n.t("sample.saveDirection", "Save direction")].join(" · ");
    host.heading = long; host.label = long; host.detail = long; host.action = i18n.t("action.continue");
    host.value = "exact-existing-item"; host.dismissible = true;
    const view = observe(host.render(), host), slot = view.nodes.find(node => node.tag === "slot" && node.attributes.name === composition.slot);
    assert.ok(slot, "the production component exposes the intended authored slot");
    const fallback = view.nodes.find(node => node.tag === "button");
    assert.ok(fallback && fallback.attributes.type === "button", "production action fallback remains native");
    if (composition.name !== "notice") assert.match(view.markup, /<slot name="(?:actions|trailing)"><button/u, "CSS must reach fallback descendants of slot, not only direct action-container children");
    const emitted = []; host.addEventListener(composition.event, event => emitted.push(event.detail));
    fallback.click(); assert.deepEqual(emitted, [{ value: "exact-existing-item" }]);
    const wrapped = new Button(), badge = new Badge();
    wrapped.label = long; wrapped.value = "exact-existing-item"; badge.label = i18n.t("sample.ready", "Ready"); badge.tone = "positive";
    const actualWrapped = observe(wrapped.render(), wrapped), actualBadge = observe(badge.render(), badge);
    let nativeClicks = 0;
    // An ordinary authored native child, built with Lit and observed by the same
    // current-template event port as the production fallback, not a fake click.
    const strings = ['<button type="button" class="button secondary" slot=', ' @click=', '>', '</button>'];
    strings.raw = [...strings];
    const authored = observe(html(strings, composition.slot, () => { nativeClicks++; }, long), host);
    const native = authored.nodes.find(node => node.tag === "button");
    wrapped.attributes.slot = composition.slot; badge.attributes.slot = composition.slot;
    const peers = [native, wrapped, badge];
    const slots = new Set(view.nodes.filter(node => node.tag === "slot").map(node => node.attributes.name ?? ""));
    const assigned = peers.filter(peer => slots.has(peer.attributes.slot ?? ""));
    assert.deepEqual(assigned, peers, "the actual named-slot contract admits every authored peer");
    assert.equal(native.attributes.type, "button"); assert.equal(native.textContent, long);
    assert.equal(actualWrapped.nodes.find(node => node.tag === "button").textContent, long, "complete authored label is retained");
    assert.equal(actualBadge.nodes.some(node => node.tag === "button" || node.tag === "a"), false, "status is not converted to an action");
    let presses = 0; wrapped.addEventListener("forma-press", event => { presses++; assert.equal(event.detail.value, "exact-existing-item"); });
    native.click(); actualWrapped.nodes.find(node => node.tag === "button").click();
    assert.equal(nativeClicks, 1); assert.equal(presses, 1);
    assert.equal(host.detail, long); assert.equal(wrapped.label, long); assert.equal(badge.label, i18n.t("sample.ready", "Ready"));
    assert.equal(emitted.length, 1, "peer activation does not invoke an unrelated fallback action");
  });
}

// Observe the genuine ListItem template hierarchy; never manufacture a grouped
// application tree or pretend a layout engine ran.
function templateElementTree(view) {
  const root = { children: [] }, stack = [root]; let index = 0;
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const token of view.markup.matchAll(/<(\/?)([\w-]+)([^>]*)>/gu)) {
    const [, closing, tag] = token;
    if (closing) { const current = stack.pop(); assert.equal(current.source.tag, tag); continue; }
    const source = view.nodes[index++]; assert.equal(source.tag, tag);
    const node = { source, parent: stack.at(-1), children: [] };
    stack.at(-1).children.push(node);
    if (!voids.has(tag)) stack.push(node);
  }
  assert.equal(index, view.nodes.length); assert.equal(stack.length, 1);
  return root;
}
const findClass = (nodes, className) => nodes.find(node => String(node.source.attributes.class ?? "").split(/\s+/u).includes(className));
let listCase;
const findListCase = node => {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "forma-ui-list-item") listCase = node;
  ts.forEachChild(node, findListCase);
};
findListCase(preview);
assert.ok(listCase && listCase.statements.length === 1);
const renderListExample = new Function("html", "nothing", "return function() { " + listCase.statements[0].getText(syntax.catalog) + " };")(html, nothing);
for (const locale of ["en", "fr", "ar", "ja"]) for (const leading of ["authored-avatar", "fallback-icon"]) {
  test("current ListItem keeps " + leading + " with exact copy while only trailing actions may wrap in " + locale, async t => {
    const i18n = await localeController(t, locale), Constructor = compositions.find(item => item.name === "list item").Constructor;
    const long = "Exact-" + "DocumentIdentity".repeat(12); let host = new Constructor();
    let example;
    if (leading === "authored-avatar") {
      example = observe(renderListExample.call({ i18n }), null);
      const node = example.nodes.find(value => value.tag === "forma-ui-list-item");
      host = instantiate(Constructor, node);
    } else {
      host.iconName = "info"; host.label = long; host.detail = long;
      host.action = i18n.t("action.continue"); host.value = "exact-list-item";
    }
    const view = observe(host.render(), host), tree = templateElementTree(view), item = findClass(tree.children, "ui-list-item");
    assert.ok(item);
    const main = findClass(item.children, "ui-list-item-main"), trailing = findClass(item.children, "ui-list-item-trailing");
    assert.ok(main && trailing);
    assert.deepEqual(item.children, [main, trailing], "the leading slot is not an independent outer flex item");
    assert.equal(main.source.attributes.role, undefined, "grouping adds no extra semantic landmark");
    const leadingSlot = main.children.find(node => node.source.tag === "slot" && node.source.attributes.name === "leading");
    const copy = findClass(main.children, "ui-list-item-copy");
    assert.ok(leadingSlot && copy);
    assert.deepEqual(main.children, [leadingSlot, copy]);
    assert.ok(copy.children.some(node => node.source.tag === "slot" && node.source.attributes.name === "heading"));
    assert.ok(copy.children.some(node => node.source.tag === "slot" && node.source.attributes.name === undefined));
    assert.ok(trailing.children.some(node => node.source.tag === "slot" && node.source.attributes.name === "trailing"));
    if (leading === "authored-avatar") {
      const avatar = example.nodes.find(node => node.tag === "forma-ui-avatar"), heading = example.nodes.find(node => node.tag === "strong");
      assert.equal(avatar.attributes.slot, "leading"); assert.equal(avatar.attributes.name, "Avery Park"); assert.equal(avatar.attributes.initials, "AP");
      assert.equal(heading.attributes.slot, "heading"); assert.equal(heading.textContent, i18n.t("sample.campaign", "Summer campaign"));
      const action = instantiate(Button, example.nodes.find(node => node.tag === "forma-ui-button"));
      const badge = instantiate(Badge, example.nodes.find(node => node.tag === "forma-ui-badge"));
      assert.equal(action.attributes.slot, "trailing"); assert.equal(badge.attributes.slot, "trailing");
      const events = []; action.addEventListener("forma-press", event => events.push(event.detail));
      observe(action.render(), action).nodes.find(node => node.tag === "button").click();
      assert.deepEqual(events, [{ value: "open-campaign" }]);
      assert.equal(badge.label, i18n.t("sample.ready", "Ready"));
      assert.equal(host.value, "summer-campaign");
    } else {
      assert.ok(leadingSlot.children.some(node => node.source.tag === "span" && node.source.attributes["aria-hidden"] === "true"));
      assert.equal(view.nodes.find(node => node.tag === "strong").textContent, long);
      assert.equal(view.nodes.find(node => node.attributes.class === "ui-list-item-detail").textContent, long);
      const events = []; host.addEventListener("forma-action", event => events.push(event.detail));
      view.nodes.find(node => node.tag === "button").click(); assert.deepEqual(events, [{ value: "exact-list-item" }]);
      assert.equal(host.label, long); assert.equal(host.detail, long);
    }
  });
}
