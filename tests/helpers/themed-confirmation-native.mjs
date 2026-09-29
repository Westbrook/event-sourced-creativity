import assert from "node:assert/strict";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";

// Reuse the existing complete-module loader and ElementPort. The additions here
// are native dialog/form/focus/mutation ports, not a CSS renderer or browser.
// Host tests observe the existing privacy-method/HTTP boundary; they do not
// claim to execute or certify deletion, archive, billing, or provider behavior.
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const turn = () => new Promise(setImmediate);
export async function until(check, message) {
  for (let step = 0; step < 80; step += 1) { if (check()) return; await turn(); }
  assert.ok(check(), message);
}

export async function confirmationFixture(t, { locale = "en", application = false } = {}) {
  const savedFetch = globalThis.fetch;
  const transport = { handler: null, requests: [], external: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), request = { url, init, method: init.method ?? "GET" };
    if (!url.startsWith("/api/")) { transport.external.push(url); throw new Error("External transport is forbidden"); }
    transport.requests.push(request);
    if (!transport.handler) throw new Error("Unexpected application transport: " + request.method + " " + url);
    return transport.handler(request);
  };
  t.after(() => {
    globalThis.fetch = savedFetch;
    assert.deepEqual(transport.external, [], "No provider or external network path is admitted");
  });
  const h = application ? await createSceneStoreHost({ exposeSceneTestAccessors: false }) : null;
  const mountedLoads = [];
  if (h) {
    const loadShares = h.store.loadShares;
    // Observe the actual mount-triggered method through JSON/publication, not
    // just its fetch. Preserve its receiver, arguments and original promise.
    t.mock.method(h.store, "loadShares", function (...args) {
      const pending = loadShares.apply(this, args);
      mountedLoads.push(pending);
      return pending;
    });
  }
  const f = { store: h?.store, storeHost: h, locale, trace: [], clipboard: [], listeners: new Map(),
    requested: false, changed: new Map(), tick: async () => true, mutations: new Map(), hosts: [],
    timers: new Map(), frames: new Map(), storage: new Map(), resizeTargets: new Map(), timerSequence: 0, transport };
  ports.bindFixture(f);
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected();
  const doc = ports.documentPort, view = ports.windowPort;
  const saved = { body: doc.body, active: doc.activeElement, create: doc.createElement,
    query: doc.querySelector, all: doc.querySelectorAll,
    observe: ports.FixtureObserver.prototype.observe, disconnect: ports.FixtureObserver.prototype.disconnect };
  const descendants = (node) => [node, ...(node.children ?? []).flatMap(descendants)];
  const emitDocument = (type, extra = {}) => {
    const event = { type, target: doc.activeElement, currentTarget: doc, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const listener of [...(f.listeners.get(type) ?? [])]) listener(event);
  };
  f.emitWindow = (type, extra = {}) => emitDocument(type, extra);
  f.focus = (node) => { doc.activeElement = node; f.trace.push(["focus", node]); emitDocument("focusin", { target: node }); };
  const mutation = (removed) => {
    const records = [{ type: "childList", addedNodes: [], removedNodes: removed }], observers = [...f.mutations.keys()];
    queueMicrotask(() => { for (const observer of observers) if (f.mutations.has(observer)) observer.callback(records); });
  };
  ports.FixtureObserver.prototype.observe = function (node) { f.mutations.set(this, node); };
  ports.FixtureObserver.prototype.disconnect = function () { f.mutations.delete(this); };
  function native(tag, root = false) {
    const node = new ports.ElementPort();
    node.tag = tag; node.tagName = tag.toUpperCase(); node.attributes = {}; node.children = [];
    node.textContent = ""; node.open = false; node.disabled = false; node.nativeListeners = new Map();
    Object.defineProperty(node, "isConnected", { configurable: true, get: () => root || Boolean(node.parentElement?.isConnected) });
    node.append = (...children) => { for (const child of children) { child.parentElement = node; node.children.push(child); } };
    node.remove = () => {
      if (!node.parentElement) return;
      node.parentElement.children = node.parentElement.children.filter((item) => item !== node);
      node.parentElement = null; mutation([node]);
    };
    node.replaceChildren = (...children) => { for (const child of [...node.children]) child.remove(); node.append(...children); };
    node.addEventListener = (type, listener) => {
      const list = node.nativeListeners.get(type) ?? new Set(); list.add(listener); node.nativeListeners.set(type, list);
    };
    node.removeEventListener = (type, listener) => node.nativeListeners.get(type)?.delete(listener);
    node.emit = (type, extra = {}) => {
      const event = { type, target: node, currentTarget: node, isTrusted: false, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
      for (const listener of [...(node.nativeListeners.get(type) ?? [])]) listener(event);
      return event;
    };
    node.focus = () => f.focus(node);
    node.matches = (selector) => selector === ":modal" ? node.open : selector === ":disabled" ? node.disabled : selector === tag;
    node.hasAttribute = (name) => Object.hasOwn(node.attributes, name);
    node.removeAttribute = (name) => { delete node.attributes[name]; if (name === "open") node.open = false; };
    node.querySelectorAll = (selector) => descendants(node).slice(1).filter((item) => selector.split(",").includes(item.tag));
    node.querySelector = (selector) => node.querySelectorAll(selector)[0] ?? null;
    node.showModal = () => {
      if (f.modalFailure) throw new Error("native modal unavailable");
      node.open = true; f.trace.push(["showModal", node]);
    };
    node.close = (value = "") => { node.open = false; node.returnValue = value; queueMicrotask(() => node.emit("close")); };
    return node;
  }
  doc.body = native("body", true); doc.activeElement = null; doc.createElement = native;
  doc.querySelectorAll = (selector) => descendants(doc.body).filter((node) =>
    selector === "dialog[open]" ? node.tag === "dialog" && node.open
      : selector === "dialog:modal" ? node.tag === "dialog" && node.open : node.tag === selector);
  doc.querySelector = (selector) => doc.querySelectorAll(selector)[0] ?? null;
  f.doc = doc; f.view = view; f.native = native;
  f.owner = native("section"); doc.body.append(f.owner);
  f.invoker = native("button"); f.owner.append(f.invoker); f.invoker.focus();
  f.dialog = () => doc.querySelector("dialog[open]");
  f.buttons = () => descendants(f.dialog() ?? { children: [] }).filter((node) => node.tag === "button");
  f.confirm = (trusted = true) => {
    const dialog = f.dialog(); assert.ok(dialog, "actual helper opened a native dialog");
    const form = descendants(dialog).find((node) => node.tag === "form");
    const button = f.buttons().find((node) => node.type === "submit"); assert.ok(form && button);
    button.focus(); button.emit("click", { isTrusted: trusted });
    return form.emit("submit", { submitter: button, isTrusted: trusted });
  };
  f.cancel = () => { const button = f.buttons().find((node) => node.type === "button"); assert.ok(button); button.focus(); button.emit("click"); };
  f.mount = async (file, name, tag) => {
    const module = await ports.loadActual(file); const host = new module[name]();
    host.tag = tag; host.attributes = {}; host.children = []; host.parentElement = doc.body; host.isConnected = true;
    doc.body.children.push(host);
    f.renderer = new ports.RendererPort(f, {});
    f.host = host;
    // Reuse RendererPort's actual EventPart path (TemplateStringsArray plus
    // numeric/keyed/repeat ancestry), as the existing native command trigger
    // adapter does. No label, resource ID or callback identity invents a key.
    // Commit retained literal invokers before RendererPort runs host.updated.
    const invokers = new Map(), seenInvokers = new Set();
    const collect = f.renderer.collect.bind(f.renderer);
    f.renderer.collect = (markup, owner) => {
      const start = f.renderer.nodes.length, result = collect(markup, owner);
      if (owner !== host) return result;
      const candidates = new Map();
      for (const fresh of f.renderer.nodes.slice(start)) {
        const event = fresh.tag === "button" ? "click" : fresh.tag === "form" ? "submit" : null;
        if (!event) continue;
        const token = [...fresh.full.matchAll(/\s@(click|submit)=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/gu)]
          .find(match => match[1] === event);
        const binding = token ? f.renderer.bindings[Number(token[2])] : null;
        if (binding?.owner !== owner || typeof binding.part !== "string"
          || typeof binding.value !== "function" || binding.value !== fresh.handlers[event]) continue;
        const key = fresh.tag + ":" + binding.part;
        const entries = candidates.get(key) ?? []; entries.push(fresh); candidates.set(key, entries);
      }
      for (const [key, entries] of candidates) {
        // An ambiguous occurrence keeps ordinary replacement semantics.
        if (entries.length !== 1) continue;
        const fresh = entries[0], previous = invokers.get(key);
        if (previous?.node.isConnected && previous.store === owner.store) {
          const node = previous.node;
          for (const property of ["full", "attributes", "properties", "propertyParts", "handlers", "open", "value", "checked"])
            node[property] = fresh[property];
          node.parentElement = owner; node.isConnected = true;
          node.disabled = Object.hasOwn(node.attributes, "disabled");
          f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = node; fresh.isConnected = false;
        } else {
          if (previous) previous.node.isConnected = false;
          invokers.set(key, { node: fresh, store: owner.store });
        }
        seenInvokers.add(key);
      }
      return result;
    };
    f.draw = () => {
      ports.bindFixture(f); seenInvokers.clear();
      if (!host.isConnected) {
        for (const { node } of invokers.values()) node.isConnected = false;
        invokers.clear();
      }
      try { f.renderer.draw(host); }
      finally {
        const present = new Set(f.renderer.nodes);
        for (const [key, record] of invokers) if (!seenInvokers.has(key) || !present.has(record.node)) {
          record.node.isConnected = false; invokers.delete(key);
        }
      }
      for (const node of f.renderer.nodes) {
        node.disabled = Object.hasOwn(node.attributes, "disabled"); node.focus = () => f.focus(node);
      }
      return f.renderer.markup;
    };
    f.hosts.push(host); host.connectedCallback(); await turn(); f.draw();
    return host;
  };
  f.control = (method) => {
    f.draw(); const nodes = f.renderer.ownNodes(f.host, "button").filter((node) => node.handlers.click?.toString().includes(method));
    assert.equal(nodes.length, 1, "one actual button for " + method); return nodes[0];
  };
  f.click = (node, trusted = true) => {
    node.focus(); return node.handlers.click.call(node.owner, { type: "click", currentTarget: node, target: node, isTrusted: trusted, preventDefault() {} });
  };
  f.modal = await ports.loadActual("src/components/modal-dialog.ts");
  f.platform = await ports.loadActual("src/platform/session-controller.ts");
  f.platform.platformSession.reset();
  f.begin = (extra = {}) => {
    const controller = new AbortController();
    const options = { title: f.i18n.t("dialog.heading"), message: "Exact source: أ ب 日本語 <not markup>",
      confirmLabel: f.i18n.t("dialog.confirm"), cancelLabel: f.i18n.t("action.cancel"),
      locale, direction: f.i18n.direction, owner: f.owner, invoker: f.invoker, controller,
      signal: controller.signal, current: () => true, ...extra };
    return { options, controller, result: f.modal.requestDialogConfirmation(options) };
  };
  t.after(async () => {
    ports.bindFixture(f);
    for (const host of f.hosts) if (host.isConnected) { host.isConnected = false; host.disconnectedCallback(); }
    for (const dialog of doc.querySelectorAll("dialog[open]")) dialog.emit("cancel");
    // Retire native owners first, then join their real reads before disposal.
    // Rejections remain test failures; no fake response or catch-to-success.
    while (mountedLoads.length) await Promise.all(mountedLoads.splice(0));
    if (h) await h.worker.drainBackground();
    f.platform.platformSession.reset();
    f.i18n.hostDisconnected();
    Object.assign(doc, { body: saved.body, activeElement: saved.active, createElement: saved.create,
      querySelector: saved.query, querySelectorAll: saved.all });
    ports.FixtureObserver.prototype.observe = saved.observe; ports.FixtureObserver.prototype.disconnect = saved.disconnect;
    if (h) await h.close();
  });
  return f;
}
