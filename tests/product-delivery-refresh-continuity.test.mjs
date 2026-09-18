import test from "node:test";
import assert from "node:assert/strict";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

const draftA = { title: "Original milestone A", audience: "product", evidence: "Original evidence A", ownerUserId: "", dependencies: [] };
const draftB = { ...draftA, title: "Newer unsent milestone B", evidence: "Newer unsent evidence B" };
const posts = f => f.calls.filter(call => call.method === "POST");
const value = (f, form, name) => new Map(f.values(form)).get(name) ?? "";

// The existing renderer recreates plain native records on each draw. Model only
// this actual create form's native lifetime: same TemplateResult ancestry keeps
// the same form; an absent/changed template disconnects it. No component method,
// session, Store, Worker or receipt behavior is replaced. This is not a browser.
function nativeCreateForms(f) {
  const originalForm = f.form, initialized = new WeakSet(); let retained = null;
  const locate = (part, ancestry = []) => {
    if (Array.isArray(part)) return part.flatMap((child, index) => locate(child, [...ancestry, index]));
    if (!part?.strings) return [];
    const path = [...ancestry, part.strings];
    if (part.values.some(item => typeof item === "function" && item.toString().includes("#create"))) return [{ path, template: part }];
    return part.values.flatMap((child, index) => locate(child, [...path, index]));
  };
  const samePath = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
  const nativeFields = template => {
    const markup = f.renderer.value(template, f.host, "native-create-defaults"), initial = {}, controlled = {};
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
  f.draw = () => {
    ports.bindFixture(f); let emitted;
    const markup = f.renderer.draw(f.host, () => { emitted = f.host.render(); return emitted; });
    const templates = locate(emitted), nodes = f.renderer.ownNodes(f.host, "form").filter(node => node.handlers.submit?.toString().includes("#create"));
    assert.equal(templates.length, nodes.length, "actual create template and native form agree"); assert.ok(nodes.length <= 1);
    if (retained && (!nodes.length || !samePath(retained.path, templates[0].path))) {
      retained.node.isConnected = false; retained.node.parentElement = null; retained = null;
    }
    if (nodes.length) {
      if (retained) {
        retained.node.handlers = nodes[0].handlers; retained.node.attributes = nodes[0].attributes;
        retained.node.isConnected = true;
        retained.node.parentElement = f.host;
        f.renderer.nodes[f.renderer.nodes.indexOf(nodes[0])] = retained.node;
      } else retained = { node: nodes[0], path: templates[0].path, template: templates[0].template };
      retained.template = templates[0].template;
      if (initialized.has(retained.node)) {
        const { controlled } = nativeFields(retained.template);
        if (Object.keys(controlled).length) {
          const fields = {};
          for (const [name, entry] of f.values(retained.node)) {
            if (name === "dependencies") (fields[name] ??= []).push(entry); else fields[name] = entry;
          }
          f.fill(retained.node, { ...fields, ...controlled });
        }
      }
    }
    return markup;
  };
  f.form = () => {
    f.draw(); assert.ok(retained, "the actual current create form is present");
    const form = retained.node;
    if (!initialized.has(form)) {
      assert.equal(originalForm(), form, "the existing native FormData/reset port initializes this exact current form");
      f.fill(form, nativeFields(retained.template).initial); initialized.add(form);
    }
    return form;
  };
  return f;
}

function deliveryFaults(f, { holdCreate = false, failReport = false } = {}) {
  const entered = sceneDeferred(), gate = sceneDeferred(); let held = false, failed = false;
  f.deliver = async (call, response) => {
    if (holdCreate && !held && call.method === "POST" && response.ok) {
      held = true; assert.equal(response.status, 201); assert.ok(f.committed.at(-1)?.receipt.receipt);
      entered.resolve(); await gate.promise;
    }
    if (failReport && !failed && call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
      assert.equal(response.status, 200, "real authorized report precedes the finite HTTP-delivery failure"); failed = true;
      return Response.json({ error: "temporary_report_delivery" }, { status: 503 });
    }
    return response;
  };
  return { entered, gate, held: () => held, failed: () => failed };
}

test("ProductDelivery native form control retains edited B through healthy create and explicit report refreshes", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(); f.fill(form, draftA);
  const fault = deliveryFaults(f, { holdCreate: true }), pending = f.submit(form);
  try {
    await untilScene(fault.held, "real positive acknowledgment reaches the finite delivery hold");
    f.fill(form, draftB); f.draw(); assert.equal(f.form(), form); assert.equal(value(f, form, "title"), draftB.title);
  } finally { fault.gate.resolve(); await pending; }
  f.draw();
  assert.equal(f.form(), form); assert.equal(form.isConnected, true); assert.equal(value(f, form, "title"), draftB.title);
  assert.equal(value(f, form, "evidence"), draftB.evidence); assert.equal(f.formResets, 0);
  assert.equal(f.decisions().length, 1); assert.equal(f.decisions()[0].title, draftA.title);
  await f.refresh(); f.draw(); assert.equal(f.form(), form); assert.equal(value(f, form, "title"), draftB.title);
  assert.equal(posts(f).length, 1); assert.equal(f.creationEvents().length, 1);
});

test("ProductDelivery edited B survives verified A followed by failed report delivery and explicit successful Refresh", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(), before = f.financial(); f.fill(form, draftA);
  const fault = deliveryFaults(f, { holdCreate: true, failReport: true }), pending = f.submit(form);
  try {
    await untilScene(fault.held, "real positive acknowledgment reaches the finite delivery hold");
    f.fill(form, draftB); f.draw(); assert.equal(f.form(), form); assert.equal(value(f, form, "title"), draftB.title);
  } finally { fault.gate.resolve(); await pending; }
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201); assert.equal(f.decisions().length, 1);
  assert.equal(f.decisions()[0].title, draftA.title); assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 0);
  assert.equal(fault.failed(), true); const failureMarkup = f.draw(); assert.match(failureMarkup, /milestone is saved/);
  const removed = !form.isConnected;
  await f.refresh(); f.draw(); const current = f.form();
  assert.equal(posts(f).length, 1); assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
  console.log("PRODUCT_DELIVERY_REFRESH_CONTINUITY " + JSON.stringify({ case: "edited-draft", realCommit: true,
    reportFailed: fault.failed(), originalFormRemoved: removed, sameFormAfterRefresh: current === form,
    visibleDraftTitle: value(f, current, "title"), originalRows: f.decisions().length, posts: posts(f).length }));
  assert.equal(value(f, current, "title"), draftB.title, "the newer unsubmitted draft remains reachable after restoring the report");
  assert.equal(value(f, current, "evidence"), draftB.evidence); assert.equal(f.formResets, 0);
});

test("ProductDelivery uncertain original A remains explicitly retryable with its same key after failed and successful Refresh", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(), before = f.financial(); f.fill(form, draftA);
  f.loseNextCreate = "transport"; await f.submit(form); f.draw();
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201); assert.equal(f.decisions().length, 1);
  assert.equal(f.formResets, 0); assert.match(f.draw(), /Retry original save/); const originalRequest = posts(f)[0].body;
  const fault = deliveryFaults(f, { failReport: true }); await f.refresh(); f.draw(); assert.equal(fault.failed(), true);
  const removed = !form.isConnected;
  await f.refresh(); f.draw(); const current = f.form(); assert.match(f.draw(), /Retry original save/);
  const retryButton = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.type === "submit" && node.classList.contains("primary"));
  assert.ok(retryButton); assert.equal(Object.hasOwn(retryButton.attributes, "disabled"), false, "the current original-retry control is enabled");
  // Re-enter the original visible values if the native form was replaced. This
  // gives the exposed submit action valid native required fields, not a new key.
  f.fill(current, draftA); await f.submit(current);
  assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
  console.log("PRODUCT_DELIVERY_REFRESH_CONTINUITY " + JSON.stringify({ case: "uncertain-original", realCommit: true,
    reportFailed: fault.failed(), originalFormRemoved: removed, sameFormAfterRefresh: current === form,
    posts: posts(f).length, deliveredReceipts: f.committed.length, originalRows: f.decisions().length }));
  assert.equal(posts(f).length, 2, "the explicit retry must reach the real Worker, not return on a detached old form");
  assert.deepEqual(posts(f)[1].body, originalRequest, "no replacement intent or fresh request ID is submitted");
  assert.equal(f.committed.length, 2); assert.equal(f.formResets, 1);
});

/** Additional boundaries use the same complete host/Worker and scoped native-form port. */
function unavailableReport(f, kind) {
  let seen = false;
  f.deliver = async (call, response) => {
    if (!seen && call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
      seen = true; assert.equal(response.status, 200, "actual authorized report before the finite delivery failure");
      if (kind === "transport") throw new TypeError("The already-produced report response was not delivered");
      if (kind === "parse") return { status: 200, ok: true, json: async () => { throw new SyntaxError("Unreadable delivered report JSON"); } };
      assert.equal(kind, "503"); return Response.json({ error: "temporary_report_delivery" }, { status: 503 });
    }
    return response;
  };
  return () => seen;
}
function createForms(f) {
  return f.renderer.ownNodes(f.host, "form").filter(node => node.handlers.submit?.toString().includes("#create"));
}
function hiddenOriginal(f, form) {
  assert.equal(f.form() === form, true); assert.equal(form.isConnected, true);
  assert.equal(Object.hasOwn(form.attributes, "hidden"), true); assert.equal(Object.hasOwn(form.attributes, "inert"), true);
  const lists = f.renderer.ownNodes(f.host, "ol").filter(node => node.classList.contains("delivery-decision-list"));
  assert.ok(lists.length <= 1, "at most one existing keyed decision-list owner");
  assert.ok(lists.every(node => Object.hasOwn(node.attributes, "hidden") && Object.hasOwn(node.attributes, "inert")),
    "unavailable reporting keeps any mounted draft owners hidden and inert, never displayed or interactive");
}

for (const kind of ["transport", "503", "parse"]) test(`ProductDelivery same-owner ${kind} report failure keeps hidden original A and raw B without treating GET as ACK`, async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(), before = f.financial();
  f.fill(form, draftA); f.loseNextCreate = "transport"; await f.submit(form); f.draw();
  const original = posts(f)[0].body; f.fill(form, draftB);
  await f.refresh(); f.draw();
  assert.equal(f.form() === form, true); assert.match(f.draw(), /Retry original save/);
  assert.equal(f.formResets, 0); assert.equal(posts(f).length, 1, "a current report containing A does not settle its original create");
  const failed = unavailableReport(f, kind); await f.refresh(); f.draw();
  assert.equal(failed(), true); hiddenOriginal(f, form);
  assert.equal(value(f, form, "title"), draftB.title); assert.equal(value(f, form, "evidence"), draftB.evidence);
  assert.equal(f.formResets, 0); assert.equal(posts(f).length, 1); assert.equal(f.committed.length, 1);
  f.deliver = undefined; await f.refresh(); f.draw();
  assert.equal(f.form() === form, true); assert.equal(Object.hasOwn(form.attributes, "hidden"), false);
  assert.equal(Object.hasOwn(form.attributes, "inert"), false); assert.match(f.draw(), /Retry original save/);
  assert.equal(value(f, form, "title"), draftB.title); assert.equal(f.formResets, 0); assert.equal(posts(f).length, 1);
  await f.submit(form);
  assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, original);
  assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 0);
  assert.equal(value(f, form, "title"), draftB.title); assert.match(f.draw(), /edited draft remains unsubmitted/);
  await f.submit(form);
  assert.equal(posts(f).length, 3); assert.notEqual(posts(f)[2].body.requestId, original.requestId);
  assert.equal(posts(f)[2].body.title, draftB.title); assert.equal(f.decisions().length, 2);
  assert.equal(f.creationEvents().length, 2); assert.equal(f.formResets, 1);
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
});

for (const status of [401, 404]) test(`ProductDelivery finite denied ${status} report does not preserve a draft or revive it through a later unavailable read`, async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(), before = f.financial();
  f.fill(form, draftB); let denied = false;
  f.deliver = async (call, response) => {
    if (!denied && call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
      denied = true; assert.equal(response.status, 200);
      return Response.json({ error: "finite_denied_report" }, { status });
    }
    return response;
  };
  await f.refresh(); f.draw();
  assert.equal(denied, true); assert.equal(form.isConnected, false); assert.equal(createForms(f).length, 0);
  const failed = unavailableReport(f, "503"); await f.refresh(); f.draw();
  assert.equal(failed(), true); assert.equal(createForms(f).length, 0, "a failed read cannot undo prior denial");
  assert.equal(form.isConnected, false); assert.equal(posts(f).length, 0);
  f.deliver = undefined; await f.refresh(); f.draw(); const current = f.form();
  assert.equal(current === form, false); assert.equal(value(f, current, "title"), "");
  assert.equal(value(f, current, "evidence"), ""); assert.equal(f.formResets, 0);
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
});

// Same real principal/grant setup already used by the B3 Worker receipt suite:
// first actual Product session denial, then an existing platform capability grant.
// This is RAM fixture setup, not an invented session success or new policy.
async function actualManagerSession(f, id) {
  const worker = f.storeHost.worker;
  const headers = { "oai-authenticated-user-id": id, "oai-authenticated-user-email": id + "@example.test" };
  assert.equal((await worker.request("/api/session?audience=product", { headers })).status, 403);
  const now = new Date().toISOString(), grantId = crypto.randomUUID();
  worker.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,'product.delivery.manage','platform',NULL,NULL,NULL,'active',?,?,?,NULL,NULL)")
    .run(grantId, id, worker.owner, now, now);
  worker.setScopedHeaders(headers);
  f.platformSession.reset(); f.draw();
  const session = await f.platformSession.load("product"); assert.equal(session.user.userId, id);
  await untilScene(() => f.draw().includes("delivery-decision-form"), "the actual new principal's Product report arrives");
  return { worker, grantId };
}
test("ProductDelivery actual capability denial removes the original form even if the cached client session still has manage", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), { worker, grantId } = await actualManagerSession(f, "refresh-denied-manager");
  const form = f.form(), before = f.financial(); f.fill(form, draftB);
  assert.ok(f.platformSession.get().capabilities.includes("product.delivery.manage"));
  worker.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE grant_id=?").run(new Date().toISOString(), grantId);
  let status = 0;
  f.deliver = async (call, response) => { if (call.method === "GET" && call.url === "/api/portfolio/product/delivery") status = response.status; return response; };
  await f.refresh(); f.draw();
  assert.equal(status, 403, "actual requireCapability denial, not a substituted response");
  assert.equal(form.isConnected, false); assert.equal(createForms(f).length, 0);
  // Synthetic retained callback control, not an ordinary physical-user action.
  await f.submit(form); assert.equal(posts(f).length, 0);
  assert.equal(f.decisions().length, 0); assert.equal(f.creationEvents().length, 0);
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
});

test("ProductDelivery a held old-owner unavailable report cannot hide or publish into a genuine new principal's form", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), form = f.form(), before = f.financial();
  f.fill(form, draftA); f.loseNextCreate = "transport"; await f.submit(form); f.draw();
  const gate = sceneDeferred(); let held = false;
  f.deliver = async (call, response) => {
    if (!held && call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
      held = true; assert.equal(response.status, 200); await gate.promise;
      return Response.json({ error: "old_owner_report_unavailable" }, { status: 503 });
    }
    return response;
  };
  const pending = f.refresh(); let current;
  try {
    await untilScene(() => held, "old actual report reaches the finite delivery hold");
    await actualManagerSession(f, "refresh-new-manager"); current = f.form(); f.fill(current, draftB); f.draw();
    assert.equal(current === form, false); assert.equal(form.isConnected, false);
  } finally { gate.resolve(); await pending; }
  f.draw(); assert.equal(f.form() === current, true); assert.equal(current.isConnected, true);
  assert.equal(Object.hasOwn(current.attributes, "hidden"), false); assert.equal(Object.hasOwn(current.attributes, "inert"), false);
  assert.equal(value(f, current, "title"), draftB.title);
  assert.doesNotMatch(f.draw(), /old_owner_report_unavailable|Retry original save|original save is unconfirmed/);
  assert.equal(f.platformSession.get().user.userId, "refresh-new-manager");
  assert.equal(posts(f).length, 1); assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
  assert.equal(f.formResets, 0); assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
});


// B3 R2: the original command and the current raw form have separate custody.
// All mutations below are existing RAM fixture data; no provider is invoked.
const b3MoneyTables = ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations",
  "cost_budget_counters", "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_steps"];
const b3Money = worker => Object.fromEntries(b3MoneyTables.map(table => [table,
  worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ? worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all() : null]));
const b3Original = worker => Object.fromEntries([
  ["decisions", "SELECT * FROM delivery_decisions ORDER BY decision_id"],
  ["events", "SELECT * FROM events WHERE stream_id='platform:product-delivery' ORDER BY sequence"],
  ["receipts", "SELECT * FROM event_client_receipts WHERE stream_id='platform:product-delivery' ORDER BY client_event_id"],
  ["private", "SELECT * FROM event_private_payloads WHERE owner_id='platform:product-delivery' ORDER BY private_event_id"],
].map(([name, sql]) => [name, worker.sqlite.prepare(sql).all()]));
async function b3Manager(t, name) {
  const f = nativeCreateForms(await productDeliveryFixture(t));
  const { worker, grantId } = await actualManagerSession(f, "b3-recovery-" + name);
  return { f, worker, grantId, session: f.platformSession.get(), money: b3Money(worker) };
}
function b3Retry(f) {
  f.draw();
  const button = f.renderer.ownNodes(f.host, "button")
    .find(node => node.attributes.type === "submit" && node.classList.contains("primary"));
  assert.ok(button); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  assert.ok(Object.hasOwn(button.attributes, "formnovalidate"), "Only exact original Retry bypasses current raw required fields.");
  assert.ok(f.draw().includes(f.i18n.t("delivery.retryOriginal")));
  return button;
}
async function b3Denial(x, onDenied = async () => {}) {
  const { f, worker, grantId, session } = x;
  const grant = worker.sqlite.prepare("SELECT * FROM capability_grants WHERE grant_id=?").get(grantId);
  worker.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE grant_id=?")
    .run(new Date().toISOString(), grantId);
  const bodyGate = sceneDeferred(); let observedHeader = false, bodyCalls = 0;
  f.deliver = async (call, response) => {
    if (call.method !== "GET" || call.url !== "/api/portfolio/product/delivery") return response;
    assert.equal(response.status, 403, "Genuine same-principal Worker capability denial.");
    return { get status() { observedHeader = true; return response.status; }, ok: response.ok,
      json: async () => { bodyCalls++; await bodyGate.promise; return response.json(); } };
  };
  const pending = f.refresh();
  try {
    await untilScene(() => observedHeader, "current RoleDashboard observes the real negative status");
    f.draw();
    assert.equal(createForms(f).length, 0, "Known denial removes private controls before any error body.");
    assert.equal(bodyCalls, 0, "Negative JSON is neither required nor consumed to withdraw private reporting.");
  } finally { bodyGate.resolve(); await pending; }
  assert.equal(f.platformSession.get(), session);
  await onDenied();
  worker.sqlite.prepare("UPDATE capability_grants SET status='active',revoked_at=NULL WHERE grant_id=?").run(grantId);
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM capability_grants WHERE grant_id=?").get(grantId), grant);
  let status = 0;
  f.deliver = async (call, response) => { if (call.method === "GET") status = response.status; return response; };
  await f.refresh(); f.draw(); f.deliver = undefined;
  assert.equal(status, 200); assert.equal(f.platformSession.get(), session);
}

for (const loss of ["transport", "body"]) for (const fields of ["blank", "same", "different"])
  test("Product denied original preserves exact recovery and current " + fields + " fields: " + loss, async t => {
    const x = await b3Manager(t, loss + "-" + fields), { f, worker, money } = x;
    const old = f.form(); f.fill(old, draftA); f.loseNextCreate = loss; await f.submit(old);
    assert.equal(f.committed[0].status, 201);
    const request = structuredClone(posts(f)[0].body), receipt = structuredClone(f.committed[0].receipt), canonical = b3Original(worker);
    await f.refresh(); f.draw();
    assert.ok(f.draw().includes(draftA.title)); assert.equal(posts(f).length, 1);
    await b3Denial(x);
    const current = f.form(); assert.notEqual(current, old); assert.equal(old.isConnected, false);
    assert.equal(value(f, current, "title"), ""); assert.equal(value(f, current, "evidence"), "");
    assert.equal(posts(f).length, 1, "Fresh reporting never acknowledges or automatically repeats the save.");
    b3Retry(f);
    if (fields !== "blank") f.fill(current, fields === "same" ? draftA : draftB);
    const beforeFields = f.values(current);
    await f.submit(current); f.draw();
    assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, request);
    assert.deepEqual(f.committed[1].receipt, receipt); assert.deepEqual(b3Original(worker), canonical);
    assert.equal(f.form(), current); assert.deepEqual(f.values(current), beforeFields); assert.equal(f.formResets, 0);
    assert.ok(f.draw().includes(f.i18n.t("delivery.originalSavedCurrentForm")));
    assert.ok(!f.draw().includes(f.i18n.t("delivery.originalSavedDraftKept")), "Blank/equal fresh forms are not called edited original drafts.");
    assert.deepEqual(b3Money(worker), money); assert.deepEqual(f.external, []);
  });

for (const late of ["while-denied", "while-current-retry-pending"])
  test("Product in-flight denial retains only dispatched original and fences late ACK: " + late, async t => {
    const x = await b3Manager(t, late), { f, worker, money } = x;
    const old = f.form(); f.fill(old, draftA);
    const first = deliveryFaults(f, { holdCreate: true }), oldPending = f.submit(old);
    let second, retryPending;
    try {
      await untilScene(first.held, "actual original 201 is held after canonical commit");
      const request = structuredClone(posts(f)[0].body), receipt = structuredClone(f.committed[0].receipt), canonical = b3Original(worker);
      await b3Denial(x, async () => {
        if (late === "while-denied") {
          first.gate.resolve(); await oldPending; f.draw();
          assert.equal(createForms(f).length, 0); assert.equal(f.formResets, 0);
          assert.ok(!f.draw().includes(draftA.title), "Old positive response cannot restore withdrawn private reporting.");
        }
      });
      const current = f.form(); assert.notEqual(current, old); f.fill(current, draftB); b3Retry(f);
      assert.equal(posts(f).length, 1);
      if (late === "while-current-retry-pending") {
        second = deliveryFaults(f, { holdCreate: true }); retryPending = f.submit(current);
        await untilScene(second.held, "actual same-original retry reply reaches its independent HTTP hold");
        first.gate.resolve(); await oldPending; f.draw();
        assert.ok(f.draw().includes(f.i18n.t("delivery.saving")), "Old finally cannot release a newer current busy slot.");
        assert.equal(value(f, current, "title"), draftB.title); assert.equal(f.formResets, 0);
        second.gate.resolve(); await retryPending;
      } else await f.submit(current);
      f.draw(); assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, request);
      assert.deepEqual(f.committed[1].receipt, receipt); assert.deepEqual(b3Original(worker), canonical);
      assert.equal(value(f, current, "title"), draftB.title); assert.equal(f.formResets, 0);
      assert.deepEqual(b3Money(worker), money); assert.deepEqual(f.external, []);
    } finally {
      first.gate.resolve(); second?.gate.resolve();
      await Promise.allSettled([oldPending, retryPending].filter(Boolean));
    }
  });

test("Product denial during pre-dispatch digest retires unsent allocation without inventing original recovery", async t => {
  const x = await b3Manager(t, "before-digest"), { f, worker, money } = x;
  const old = f.form(); f.fill(old, draftA);
  const gate = sceneDeferred(); let entered = false;
  const actualDigest = crypto.subtle.digest.bind(crypto.subtle);
  const digest = t.mock.method(crypto.subtle, "digest", async (...args) => {
    if (!entered) { entered = true; await gate.promise; }
    return actualDigest(...args);
  });
  const pending = f.submit(old);
  try {
    await untilScene(() => entered, "actual client digest is pending before dispatch");
    await b3Denial(x, async () => { gate.resolve(); await pending; });
    const current = f.form(); assert.notEqual(current, old); assert.equal(posts(f).length, 0);
    assert.equal(f.decisions().length, 0); assert.equal(f.creationEvents().length, 0);
    assert.ok(!f.draw().includes(f.i18n.t("delivery.retryOriginal")));
    f.fill(current, draftB); await f.submit(current);
    assert.equal(posts(f).length, 1); assert.equal(f.decisions().length, 1);
    assert.equal(f.decisions()[0].title, draftB.title); assert.deepEqual(b3Money(worker), money);
  } finally { gate.resolve(); await pending; digest.mock.restore(); }
});

// The real current Insights class exercises the shared RoleDashboard counter,
// not Delivery's subclass lifetime. Only the negative HTTP status/body is a
// finite service fault here; this matrix is not Worker authorization evidence.
async function b3GenericRole(t, run) {
  const f = await productDeliveryFixture(t), worker = f.storeHost.worker, money = b3Money(worker);
  f.host.isConnected = false; f.host.disconnectedCallback();
  const deliveryFetch = globalThis.fetch, endpoint = "/api/portfolio/product/insights";
  let transport = async (_call, response) => response;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) !== endpoint) return deliveryFetch(input, init);
    const call = { url: endpoint, method: init.method ?? "GET", body: null };
    assert.equal(call.method, "GET"); f.calls.push(call);
    const response = await worker.request(endpoint, init); assert.equal(response.status, 200);
    return transport(call, response);
  };
  try {
    f.store.route.set("/product/insights"); ports.bindFixture(f);
    const { FormaProductInsights } = await ports.loadActual("src/apps/product/insights.ts");
    f.host = new FormaProductInsights(); f.host.tag = "forma-product-insights"; f.host.attributes = {}; f.host.isConnected = true;
    f.host.connectedCallback();
    const visible = () => { f.draw(); return f.renderer.ownNodes(f.host, "section").some(node => node.classList.contains("role-metric-grid")); };
    await untilScene(visible, "actual Insights report reaches the shared base");
    await run({ f, visible, setTransport: fn => { transport = fn; } });
    assert.equal(f.calls.some(call => call.method !== "GET"), false); assert.deepEqual(b3Money(worker), money);
    assert.deepEqual(f.external, []);
  } finally { globalThis.fetch = deliveryFetch; }
}

test("RoleDashboard healthy current read remains usable without Delivery-specific retirement", async t => {
  await b3GenericRole(t, async ({ f, visible }) => { await f.refresh(); assert.equal(visible(), true); });
});

test("RoleDashboard current negative headers withdraw without consuming a held error body, then a new read recovers", async t => {
  await b3GenericRole(t, async ({ f, visible, setTransport }) => {
    const gate = sceneDeferred(); let statusRead = false, jsonCalls = 0;
    setTransport(async () => ({ get status() { statusRead = true; return 403; }, ok: false,
      json: async () => { jsonCalls++; await gate.promise; return { error: "finite-current-denial" }; } }));
    const pending = f.refresh();
    try {
      await untilScene(() => statusRead, "actual base sees its finite current negative status");
      assert.equal(visible(), false); assert.equal(jsonCalls, 0);
    } finally { gate.resolve(); await pending; }
    setTransport(async (_call, response) => response);
    await f.refresh(); assert.equal(visible(), true);
  });
});

test("RoleDashboard a newer completed certified read fences an older negative without parsing it", async t => {
  await b3GenericRole(t, async ({ f, visible, setTransport }) => {
    const gate = sceneDeferred(); let entered = false, jsonCalls = 0, count = 0;
    setTransport(async (_call, response) => {
      if (count++ !== 0) return response;
      entered = true; await gate.promise;
      return { status: 403, ok: false, json: async () => { jsonCalls++; return { error: "older-negative" }; } };
    });
    const pending = f.refresh();
    try {
      await untilScene(() => entered, "older negative delivery is held before headers");
      await f.refresh(); assert.equal(visible(), true);
    } finally { gate.resolve(); await pending; }
    assert.equal(visible(), true); assert.equal(jsonCalls, 0);
  });
});

test("RoleDashboard an accepted negative invalidates already-issued newer pending success; only a later fresh read recovers", async t => {
  await b3GenericRole(t, async ({ f, visible, setTransport }) => {
    const oldGate = sceneDeferred(), newerGate = sceneDeferred();
    let oldEntered = false, newerEntered = false, count = 0, negativeJson = 0;
    setTransport(async (_call, response) => {
      if (count++ === 0) {
        oldEntered = true; await oldGate.promise;
        return { status: 403, ok: false, json: async () => { negativeJson++; return { error: "current-denial" }; } };
      }
      return { status: response.status, ok: response.ok, json: async () => {
        newerEntered = true; await newerGate.promise; return response.json();
      } };
    });
    const older = f.refresh(); let newer;
    try {
      await untilScene(() => oldEntered, "older denial waits before headers");
      newer = f.refresh(); await untilScene(() => newerEntered, "newer successful body is genuinely still pending");
      oldGate.resolve(); await older;
      assert.equal(visible(), false); assert.equal(negativeJson, 0);
      newerGate.resolve(); await newer;
      assert.equal(visible(), false, "The generic base invalidates pending success without a Delivery lifetime hook.");
      setTransport(async (_call, response) => response);
      await f.refresh(); assert.equal(visible(), true);
    } finally { oldGate.resolve(); newerGate.resolve(); await Promise.allSettled([older, newer].filter(Boolean)); }
  });
});

test("Product current saved and unknown notice identities relocalize FR to JA on the same host without another request", async t => {
  const f = nativeCreateForms(await productDeliveryFixture(t)), worker = f.storeHost.worker, money = b3Money(worker), host = f.host;
  f.i18n.hostDisconnected(); let publish, revision = 0;
  const snapshot = locale => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
    messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: ++revision });
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    publish = event.callback; publish(snapshot("fr"), () => {}); return true;
  } });
  f.i18n.hostConnected(); f.host.i18n = f.i18n; f.locale = "fr";
  const form = f.form(); f.fill(form, draftA); f.loseNextCreate = "transport"; await f.submit(form);
  const frenchUnknown = f.i18n.t("delivery.createUnknown"); assert.ok(f.draw().includes(frenchUnknown));
  let calls = f.calls.length; f.locale = "ja"; publish(snapshot("ja")); f.draw();
  assert.equal(f.host, host); assert.equal(f.calls.length, calls);
  assert.ok(f.draw().includes(f.i18n.t("delivery.createUnknown"))); assert.ok(!f.draw().includes(frenchUnknown));
  b3Retry(f); await f.submit(form); assert.equal(posts(f).length, 2); assert.equal(f.decisions().length, 1);
  const japaneseSaved = f.i18n.t("delivery.saved"); assert.ok(f.draw().includes(japaneseSaved));
  calls = f.calls.length; f.locale = "fr"; publish(snapshot("fr")); f.draw();
  assert.equal(f.host, host); assert.equal(f.calls.length, calls);
  assert.ok(f.draw().includes(f.i18n.t("delivery.saved"))); assert.ok(!f.draw().includes(japaneseSaved));
  assert.deepEqual(b3Money(worker), money); assert.deepEqual(f.external, []);
});
