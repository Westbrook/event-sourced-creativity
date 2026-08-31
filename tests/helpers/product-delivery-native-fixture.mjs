import assert from "node:assert/strict";
import { createSceneStoreHost, untilScene } from "./scene-cost-store-host.mjs";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";

// Whole current ProductDelivery + RoleDashboard + platform session; the Worker,
// schema and SQLite are the existing fixture. Only HTTP delivery and native
// form/template events are ports. This is not a browser or layout certificate.
export async function productDeliveryFixture(t) {
  const fetchBefore = globalThis.fetch, formDataBefore = globalThis.FormData;
  const h = await createSceneStoreHost({ exposeSceneTestAccessors: false });
  const f = { store: h.store, storeHost: h, trace: [], clipboard: [], listeners: new Map(), changed: new Map(),
    requested: false, tick: async () => true, locale: "en", frames: new Map(), timers: new Map(), storage: new Map(),
    resizeTargets: new Map(), timerSequence: 0, calls: [], external: [], committed: [], loseNextCreate: "", formResets: 0 };
  f.renderer = new ports.RendererPort(f, {});
  h.store.route.set("/product/delivery"); ports.bindFixture(f);
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC",
      messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs.en }, revision: 1 }, () => {}); return true;
  } }); f.i18n.hostConnected();
  const fields = new WeakMap();
  const createSelectionPort = form => {
    // Existing finite FormData-only callers now expose the corresponding
    // rendered native selection reads. The OPTION-lifetime fixture replaces
    // these with its actual retained nodes; no command/authority is mocked.
    assert.ok(f.renderer.ownNodes(f.host, "select").some(node => node.attributes.name === "ownerUserId"));
    form.elements = { namedItem(name) {
      const entries = (fields.get(form) ?? []).filter(([key]) => key === name);
      if (name === "ownerUserId") return { value: String(entries[0]?.[1] ?? "") };
      if (name === "dependencies") return { selectedOptions: entries.map(([, value]) => ({ value: String(value) })) };
      return null;
    } };
  };
  // The actual render now reads the prior committed form before f.form() runs.
  // Install only this existing selection IDL as the native record is collected;
  // do not initialize/reset FormData or replace a later retained OPTION port.
  const collect = f.renderer.collect.bind(f.renderer), createParts = new WeakMap();
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length, result = collect(markup, owner);
    if (owner === f.host) {
      const forms = f.renderer.nodes.slice(start).filter(form => form.owner === owner && form.tag === "form"
        && Object.hasOwn(form.attributes, "data-delivery-create") && form.handlers.submit?.toString().includes("#create"));
      for (const form of forms) {
        createSelectionPort(form);
        const token = form.full.match(/\s@submit=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
        const binding = token ? f.renderer.bindings[Number(token[1])] : null;
        if (binding?.owner === owner && typeof binding.part === "string" && binding.value === form.handlers.submit)
          createParts.set(form, binding.part);
      }
      for (const fresh of forms) {
        const part = createParts.get(fresh);
        if (!part || forms.filter(form => createParts.get(form) === part).length !== 1) continue;
        const previous = (f.renderer.previousNodes ?? []).filter(form => form.owner === owner && form.tag === "form"
          && fields.has(form) && createParts.get(form) === part);
        if (previous.length !== 1 || !previous[0].isConnected || !owner.isConnected) continue;
        const retained = previous[0];
        // Preserve only an already initialized form at the same actual
        // TemplateResult/EventPart path, before removed-node retirement.
        // Its existing FormData/reset and any stronger OPTION IDL stay on it;
        // copying the fresh elements closure would read another form's values.
        for (const key of ["full", "handlers", "attributes", "properties", "propertyParts"]) retained[key] = fresh[key];
        retained.parentElement = owner;
        f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = retained;
      }
    }
    return result;
  };
  globalThis.FormData = class {
    constructor(form) { assert.ok(fields.has(form), "only an actual selected form uses this native FormData port"); this.entries = [...fields.get(form)]; }
    get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
    getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET";
    if (!url.startsWith("/api/")) { f.external.push(url); throw new Error("External/provider transport is forbidden"); }
    assert.ok(url === "/api/session?audience=product" || url === "/api/portfolio/product/delivery", "exact Product service paths only");
    assert.ok(["GET", "POST", "PATCH"].includes(method));
    const call = { url, method, body: init.body ? JSON.parse(init.body) : null }; f.calls.push(call);
    const response = await h.worker.request(url, init);
    if (url === "/api/portfolio/product/delivery" && method === "POST" && response.ok) {
      const receipt = await response.clone().json(); f.committed.push({ status: response.status, receipt });
      if (f.loseNextCreate) {
        const fault = f.loseNextCreate; f.loseNextCreate = "";
        if (fault === "transport") throw new TypeError("The successful response was lost after the real Worker committed");
        assert.equal(fault, "body"); return { ok: true, status: response.status, json: async () => { throw new TypeError("The successful response body was lost after commit"); } };
      }
    }
    return f.deliver ? await f.deliver(call, response) : response;
  };
  const { platformSession } = await ports.loadActual("src/platform/session-controller.ts");
  f.platformSession = platformSession;
  f.emitWindow = (type) => { ports.bindFixture(f); for (const handler of [...(f.listeners.get(type) ?? [])]) handler({ type }); };
  platformSession.reset(); const session = await platformSession.load("product");
  assert.equal(session.user.role, "admin"); assert.ok(session.capabilities.includes("product.delivery.manage"));
  const { FormaProductDelivery } = await ports.loadActual("src/apps/product/delivery.ts");
  f.host = new FormaProductDelivery(); f.host.tag = "forma-product-delivery"; f.host.attributes = {}; f.host.isConnected = true;
  f.draw = () => { ports.bindFixture(f); return f.renderer.draw(f.host); };
  f.host.connectedCallback();
  await untilScene(() => f.draw().includes("delivery-decision-form"), "actual delivery report and create form arrive");
  f.form = (method = "#create") => {
    f.draw(); const found = f.renderer.ownNodes(f.host, "form").filter((node) => node.handlers.submit?.toString().includes(method));
    assert.equal(found.length, 1, "one actual " + method + " form");
    const form = found[0]; fields.set(form, []); form.reset = () => { f.formResets += 1; fields.set(form, []); };
    if (method === "#create") createSelectionPort(form);
    return form;
  };
  f.fill = (form, value) => { fields.set(form, Object.entries(value).flatMap(([key, item]) => Array.isArray(item) ? item.map((entry) => [key, entry]) : [[key, item]])); };
  f.values = (form) => [...fields.get(form)];
  f.submit = (form) => form.handlers.submit.call(form.owner, { currentTarget: form, target: form, preventDefault() {} });
  f.refresh = () => { f.draw(); return f.renderer.handler(f.host, "button", (node) => node.handlers.click?.toString().includes("this.refresh"))(); };
  f.decisions = () => h.worker.sqlite.prepare("SELECT * FROM delivery_decisions ORDER BY created_at,decision_id").all();
  f.creationEvents = () => h.worker.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionCreated' ORDER BY sequence").all();
  f.financial = () => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations"].map((table) => [table, h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n]));
  t.after(async () => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback(); platformSession.reset(); f.i18n.hostDisconnected();
    globalThis.fetch = fetchBefore; globalThis.FormData = formDataBefore;
    await h.close(); assert.deepEqual(f.external, [], "no external/provider request");
  });
  return f;
}
