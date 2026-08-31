// Actual full PlatformShell/Product/Delivery/session/RAM Worker fixture.
// Finite native history/form and performance/module ports; not browser evidence.
import assert from "node:assert/strict";
import { productDeliveryFixture } from "./product-delivery-native-fixture.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./calm-full-page-fixture.mjs";
import { untilScene } from "./scene-cost-store-host.mjs";

const originalDraft = Object.freeze({ title: "Original milestone A", audience: "product", evidence: "Original evidence A", ownerUserId: "", dependencies: [] });
const rawDraft = Object.freeze({ ...originalDraft, title: "  Unsubmitted milestone B 文書  ", evidence: "  Raw evidence B\nنص 文書  " });
const posts = f => f.calls.filter(call => call.url === "/api/portfolio/product/delivery" && call.method === "POST");
const values = (f, form) => ({ title: new Map(f.values(form)).get("title") ?? "", evidence: new Map(f.values(form)).get("evidence") ?? "" });
const within = (node, ancestor) => { for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true; return false; };
const currentDelivery = f => [...f.renderer.instances.values()].map(row => row.instance)
  .find(owner => owner.isConnected && owner.tag === "forma-product-delivery") ?? null;
const canonical = f => ({ decisions: f.decisions(), events: f.creationEvents(), receipts: f.storeHost.worker.sqlite
  .prepare("SELECT * FROM event_client_receipts WHERE stream_id='platform:product-delivery' ORDER BY client_event_id").all() });

// Adapt the existing nativeCreateForms lifetime port only to a nested current
// Delivery owner. Capture the exact TemplateResult passed to RendererPort.value;
// never replace render(), #retire, #create, session, receipt, or Store behavior.
// Same owner + same template ancestry retains one native form. Actual absence,
// owner replacement or changed template disconnects it and starts native defaults.
function nativeCreateForms(f) {
  const initialized = new WeakSet(), emitted = new Map(); let retained = null, capturing = false;
  const value = f.renderer.value.bind(f.renderer);
  f.renderer.value = (part, owner, path, caches) => {
    if (capturing && owner?.tag === "forma-product-delivery" && !emitted.has(owner)) emitted.set(owner, part);
    return value(part, owner, path, caches);
  };
  const locate = (part, ancestry = []) => {
    if (Array.isArray(part)) return part.flatMap((child, index) => locate(child, [...ancestry, index]));
    if (!part?.strings) return [];
    const path = [...ancestry, part.strings];
    if (part.values.some(item => typeof item === "function" && item.toString().includes("#create"))) return [{ path, template: part }];
    return part.values.flatMap((child, index) => locate(child, [...path, index]));
  };
  const samePath = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
  const nativeFields = (template, owner) => {
    const markup = f.renderer.value(template, owner, "native-create-defaults"), initial = {}, controlled = {};
    const decode = text => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    for (const match of markup.matchAll(/<(input)\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\3>/gu)) {
      const tag = match[1] ?? match[3], parsed = f.renderer.attrs(match[2] ?? match[4]), name = parsed.attributes.name;
      if (!name) continue;
      const bound = Object.hasOwn(parsed.properties, "value"); let field;
      if (tag === "select") {
        const options = [...match[5].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gu)].map(option => {
          const attrs = f.renderer.attrs(option[1]); return { value: String(attrs.attributes.value ?? decode(option[2])), selected: Object.hasOwn(attrs.attributes, "selected") || attrs.properties.selected === true };
        });
        field = Object.hasOwn(parsed.attributes, "multiple") ? options.filter(option => option.selected).map(option => option.value)
          : bound ? String(parsed.properties.value) : (options.find(option => option.selected) ?? options[0])?.value ?? "";
      } else field = String(bound ? parsed.properties.value : parsed.attributes.value ?? (tag === "textarea" ? decode(match[5]) : ""));
      initial[name] = field; if (bound) controlled[name] = field;
    }
    return { initial, controlled };
  };
  const initializeForm = () => {
    const form = retained.node;
    if (!initialized.has(form)) {
      f.fill(form, nativeFields(retained.template, retained.owner).initial);
      const owner = retained.owner;
      // This nested initializer replaces the standalone f.form initializer.
      // Expose the same read-only native selection contract from its existing
      // FormData values, bound to this exact rendered Delivery (not the Shell).
      form.elements = { namedItem(name) {
        if (!f.renderer.ownNodes(owner, "select").some(node => node.attributes.name === name)) return null;
        const entries = f.values(form).filter(([key]) => key === name);
        if (name === "ownerUserId") return { value: String(entries[0]?.[1] ?? "") };
        if (name === "dependencies") return { selectedOptions: entries.map(([, value]) => ({ value: String(value) })) };
        return null;
      } };
      form.reset = () => { f.formResets += 1; f.fill(form, nativeFields(retained.template, retained.owner).initial); };
      initialized.add(form);
    }
    return form;
  };
  f.draw = () => {
    ports.bindFixture(f); f.requested = false; emitted.clear(); capturing = true;
    let markup;
    try { markup = f.renderer.draw(f.host); } finally { capturing = false; }
    const owner = currentDelivery(f), templates = owner ? locate(emitted.get(owner)) : [];
    const nodes = owner ? f.renderer.ownNodes(owner, "form").filter(node => node.handlers.submit?.toString().includes("#create")) : [];
    assert.equal(templates.length, nodes.length, "actual nested create template and native form agree"); assert.ok(nodes.length <= 1);
    if (retained && (!nodes.length || retained.owner !== owner || !samePath(retained.path, templates[0].path))) {
      retained.node.isConnected = false; retained.node.parentElement = null; retained = null;
    }
    if (nodes.length) {
      if (retained) {
        for (const key of ["handlers", "attributes", "properties", "full"]) retained.node[key] = nodes[0][key];
        retained.node.isConnected = true;
        retained.node.parentElement = owner;
        f.renderer.nodes[f.renderer.nodes.indexOf(nodes[0])] = retained.node;
      } else retained = { node: nodes[0], owner, path: templates[0].path, template: templates[0].template };
      retained.template = templates[0].template;
      initializeForm();
      if (initialized.has(retained.node)) {
        const { controlled } = nativeFields(retained.template, owner);
        if (Object.keys(controlled).length) {
          const fields = {};
          for (const [name, entry] of f.values(retained.node)) {
            if (name === "dependencies") (fields[name] ??= []).push(entry); else fields[name] = entry;
          }
          f.fill(retained.node, { ...fields, ...controlled });
        }
      }
    }
    f.renderHistory.push({ route: f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search + f.nativeHistoryLocation.hash,
      loading: /class="application-loading"/u.test(markup), delivery: Boolean(owner), form: Boolean(nodes.length) });
    return markup;
  };
  f.form = () => {
    f.draw(); assert.ok(retained, "the actual current nested create form is present");
    return initializeForm();
  };
  return f;
}

async function platformDeliveryFixture(t) {
  const cleanup = [], fixtureTest = { after(callback) { cleanup.push(callback); } };
  const f = await productDeliveryFixture(fixtureTest);
  let historyBefore, titleBefore, oldModules = [], globalsCaptured = false;
  t.after(async () => {
    ports.bindFixture(f);
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    try { for (const callback of cleanup) await callback(); }
    finally {
      if (globalsCaptured) {
        if (historyBefore) Object.defineProperty(globalThis, "history", historyBefore); else delete globalThis.history;
        if (titleBefore) Object.defineProperty(ports.documentPort, "title", titleBefore); else delete ports.documentPort.title;
      }
      for (const [key, had, value] of oldModules) { if (had) ports.moduleCache.set(key, value); else ports.moduleCache.delete(key); }
    }
  });
  const isolated = f.host; isolated.isConnected = false; isolated.disconnectedCallback();
  // Existing fixture performs its initial actual read before we mount the full
  // hierarchy. No draft or POST exists at this setup transition.
  assert.equal(posts(f).length, 0); assert.equal(f.decisions().length, 0);
  const session = f.platformSession.get();
  assert.equal(session.audience, "product"); assert.ok(session.capabilities.includes("product.analytics.read"));
  assert.equal(session.assistant?.enabled, true, "the actual RAM Product session enables its assistant");
  assert.equal(session.assistant.host, "platform", "retain the actual authorized assistant host without changing session data");
  historyBefore = Object.getOwnPropertyDescriptor(globalThis, "history");
  titleBefore = Object.getOwnPropertyDescriptor(ports.documentPort, "title"); globalsCaptured = true;
  const shellPath = "src/components/forma-platform-shell.ts", performancePath = "src/performance.ts";
  oldModules = [shellPath, performancePath].map(key => [key, ports.moduleCache.has(key), ports.moduleCache.get(key)]);
  f.renderHistory = []; f.populations = []; f.completions = []; f.nativeHistoryLocation = f.storeHost.location;
  const setNative = route => {
    const url = new URL(route, f.nativeHistoryLocation.href ?? "http://localhost/product/delivery");
    Object.assign(f.nativeHistoryLocation, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href });
  };
  setNative("/product/delivery");
  Object.defineProperty(globalThis, "history", { configurable: true, value: {
    pushState(_state, _title, path) { setNative(path); }, replaceState(_state, _title, path) { setNative(path); },
  } });
  Object.defineProperty(ports.documentPort, "title", { configurable: true, writable: true, value: "Product delivery — Forma" });
  // Same observation-only performance port as the existing B1 full Shell
  // fixture. The existing calm route module-delivery port remains unchanged;
  // every emitted application/child class below is the actual current class.
  ports.moduleCache.set(performancePath, { beginRoutePopulation: path => f.populations.push(path),
    completeRoutePopulation: path => f.completions.push(path), recordPopulationSource() {} });
  ports.moduleCache.delete(shellPath);
  const productFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) !== "/api/portfolio/product/insights") return productFetch(input, init);
    assert.equal(init.method ?? "GET", "GET", "the additional pathname control is an actual read only");
    const call = { url: String(input), method: "GET", body: null }; f.calls.push(call);
    const response = await f.storeHost.worker.request(call.url, init);
    assert.equal(response.status, 200, "actual current role-approved Insights report");
    return response;
  };
  const { FormaProductDelivery } = await ports.loadActual("src/apps/product/delivery.ts");
  const { FormaProductApplication } = await ports.loadActual("src/apps/product/entry.ts");
  const { FormaProductInsights } = await ports.loadActual("src/apps/product/insights.ts");
  const navigation = await ports.loadActual("src/components/design-system/navigation.ts");
  const language = await ports.loadActual("src/components/design-system/language-picker.ts");
  const { FormaPlatformShell } = await ports.loadActual(shellPath);
  const { FormaPlatformAssistant } = await ports.loadActual("src/components/forma-platform-assistant.ts");
  const { FormaAssistantPanel } = await ports.loadActual("src/components/design-system/assistant-panel.ts");
  f.renderer = new ports.RendererPort(f, { "forma-platform-assistant": FormaPlatformAssistant,
    "forma-assistant-panel": FormaAssistantPanel, "forma-product-delivery": FormaProductDelivery,
    "forma-product-application": FormaProductApplication, "forma-product-insights": FormaProductInsights,
    "forma-ui-workspace-switcher": navigation.FormaUiWorkspaceSwitcher,
    "forma-ui-audience-navigation": navigation.FormaUiAudienceNavigation, "forma-ui-language-picker": language.FormaUiLanguagePicker });
  f.host = new FormaPlatformShell(); f.host.tag = "forma-platform-shell"; f.host.attributes = {}; f.host.isConnected = true;
  nativeCreateForms(f);
  f.tree = () => fullPageTree(f);
  // Reuse B1's finite microtask/update scheduling. No deliberate module hold or
  // changed session is introduced to manufacture a loading interval.
  f.tick = async () => { await Promise.resolve(); f.draw(); return true; };
  f.flush = async () => { for (let step = 0; step < 8; step++) { await Promise.resolve(); if (f.requested) f.draw(); }
    await new Promise(setImmediate); if (f.requested) f.draw(); };
  f.settle = async () => {
    await f.flush(); await untilScene(() => { f.draw(); return f.tree().visible("main").some(node => node.owner === f.host && node.attributes["aria-busy"] === "false")
      && (f.nativeHistoryLocation.pathname === "/product/insights" ? Boolean(f.renderer.component("forma-product-insights")?.isConnected
        && f.renderer.ownNodes(f.renderer.component("forma-product-insights"), "section").some(node => node.attributes.class === "role-evidence"))
        : Boolean(currentDelivery(f) && f.renderer.ownNodes(currentDelivery(f), "form").some(node => String(node.handlers.submit).includes("#create")))); }, "actual full Platform route/report is ready");
    await f.flush();
  };
  f.host.connectedCallback(); f.draw(); await f.settle();
  const owner = currentDelivery(f);
  assert.equal(f.host instanceof FormaPlatformShell, true); assert.equal(owner instanceof FormaProductDelivery, true);
  assert.equal(owner.parentElement instanceof FormaProductApplication, true); assert.equal(owner.parentElement.parentElement === f.host, true);
  const assistant = f.renderer.component("forma-platform-assistant"), panel = f.renderer.component("forma-assistant-panel");
  assert.equal(assistant instanceof FormaPlatformAssistant, true); assert.equal(assistant.isConnected, true);
  assert.equal(assistant.parentElement === f.host, true); assert.equal(panel instanceof FormaAssistantPanel, true);
  assert.equal(panel.isConnected, true); assert.equal(panel.parentElement === assistant, true); assert.equal(panel.open, false);
  const launchers = f.tree().visible("button").filter(node => node.owner === panel && node.attributes.class === "forma-assistant-launcher");
  assert.equal(launchers.length, 1, "the actual enabled assistant has its current rendered native launcher");
  assert.equal(typeof launchers[0].handlers.click, "function");
  assert.equal(f.calls.some(call => call.url.includes("/api/platform/assistant")), false, "closed actual assistant has not made a read or command");
  assert.equal(f.platformSession.get() === session, true); assert.equal(f.calls.filter(call => call.url === "/api/session?audience=product").length, 1);
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0); assert.equal(f.formResets, 0);
  return f;
}

function emit(f, type, extra = {}) {
  ports.bindFixture(f); const target = extra.target ?? ports.documentPort.activeElement;
  const listeners = [...(f.listeners.get(type) ?? [])];
  for (const listener of listeners) listener({ type, target, preventDefault() {}, stopPropagation() {},
    composedPath: () => target ? [target, ports.documentPort] : [ports.documentPort], ...extra });
  return listeners.length;
}
function focus(f, node) {
  assert.ok(node?.isConnected); ports.documentPort.activeElement = node; node.focus(); emit(f, "focusin", { target: node });
}
async function historyDelivery(f, destination, { skip = false } = {}) {
  f.draw(); const old = new URL(f.nativeHistoryLocation.href), next = new URL(destination, old), storeRoute = f.store.route.get();
  const owner = currentDelivery(f), renderStart = f.renderHistory.length; let main = null;
  if (skip) {
    const tree = f.tree(), anchors = tree.visible("a").filter(node => node.owner === f.host && node.attributes.class === "skip-link");
    assert.equal(anchors.length, 1); const anchor = anchors[0];
    assert.equal(anchor.attributes.href, "#main-content"); assert.equal(destination, anchor.attributes.href);
    assert.equal(anchor.handlers.click, undefined, "the actual Skip anchor uses its native default");
    assert.ok(anchor.port.isConnected && f.renderer.nodes.includes(anchor.port));
    main = tree.visible("main").find(node => node.owner === f.host && node.attributes.id === "main-content");
    assert.ok(main); assert.equal(main.attributes.tabindex, "-1");
    assert.equal(next.pathname + next.search, old.pathname + old.search); assert.notEqual(next.hash, old.hash);
    focus(f, anchor.port); emit(f, "keydown", { target: anchor.port, key: "Enter" }); anchor.port.click();
    assert.equal(f.nativeHistoryLocation.href, old.href, "the reusable native port does not fabricate anchor navigation");
  }
  // As in B2: pushState is only a finite native Location setter. The test then
  // explicitly delivers browser history events; pushState does not emit them.
  history.pushState({}, "", next.pathname + next.search + next.hash);
  assert.equal(f.store.route.get(), storeRoute, "native location did not mutate the unrelated Creator Store route");
  if (main) focus(f, main.port);
  const popstate = emit(f, "popstate", { state: null });
  assert.equal(popstate, owner ? 2 : 1, "the full Shell and current Delivery own the actual registered history listeners");
  const hashchange = old.hash === next.hash ? 0 : emit(f, "hashchange", { oldURL: old.href, newURL: next.href });
  await f.settle();
  assert.equal(f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search + f.nativeHistoryLocation.hash, next.pathname + next.search + next.hash);
  return { from: old.pathname + old.search + old.hash, to: next.pathname + next.search + next.hash, popstate, hashchange,
    skipHref: skip ? "#main-content" : null, sameDelivery: currentDelivery(f) === owner,
    loadingRenders: f.renderHistory.slice(renderStart).filter(row => row.loading).length,
    childAbsentRenders: f.renderHistory.slice(renderStart).filter(row => !row.delivery).length,
    evidence: "finite native history/default and full current classes; not physical browser" };
}

function currentCreate(f) {
  const form = f.form(), tree = f.tree(), owner = currentDelivery(f);
  const forms = tree.visible("form").filter(node => node.owner === owner && String(node.handlers.submit).includes("#create"));
  assert.equal(forms.length, 1); assert.equal(forms[0].port === form, true); assert.equal(form.isConnected, true);
  assert.equal(owner.contains(form), true); assert.equal(Object.hasOwn(forms[0].attributes, "inert"), false);
  const buttons = tree.visible("button").filter(node => within(node, forms[0]) && node.attributes.type === "submit");
  assert.equal(buttons.length, 1); assert.equal(Object.hasOwn(buttons[0].attributes, "disabled"), false);
  return { form, node: forms[0], button: buttons[0], owner, fields: tree.nodes.filter(node => within(node, forms[0]) && ["input", "select", "textarea"].includes(node.tag)) };
}
async function submitCurrent(f) {
  const current = currentCreate(f), raw = new FormData(current.form);
  const required = current.fields.filter(node => Object.hasOwn(node.attributes, "required") && !Object.hasOwn(node.attributes, "disabled"));
  assert.deepEqual(required.map(node => node.attributes.name), ["title", "audience"]);
  assert.deepEqual(required.filter(node => !String(raw.get(node.attributes.name) ?? "").length).map(node => node.attributes.name), [], "this proof only submits valid current fields");
  await current.node.handlers.submit.call(current.owner, { type: "submit", currentTarget: current.form, target: current.form,
    submitter: current.button.port, preventDefault() {}, stopPropagation() {} });
  await f.settle(); return current;
}


export { originalDraft, rawDraft, posts, values, canonical, currentDelivery, currentCreate, submitCurrent, historyDelivery, platformDeliveryFixture };
