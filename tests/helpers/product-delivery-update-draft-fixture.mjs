import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange } from "lit";
import { productDeliveryFixture } from "./product-delivery-native-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { sceneDeferred, untilScene } from "./scene-cost-store-host.mjs";

// Complete current ProductDelivery/RoleDashboard/session/Store/RAM Worker.
// Only native form lifetime, event delivery and HTTP timing are finite ports.
// Actual installed Lit controls value/attribute commits; this is not browser,
// CSS, full select selectedness, accessibility or native-history certification.
const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")).href);
const observations = [];

function nativeUpdateForms(f) {
  const fill = f.fill, query = f.renderer.query.bind(f.renderer), renderValue = f.renderer.value.bind(f.renderer);
  let records = [], sequence = 0, capturing = false, capturedRows = [], capturedForms = [];
  f.renderer.value = (value, owner, at, caches) => {
    if (capturing && owner === f.host && value?.strings) {
      if (value.strings[0].includes("<li")) capturedRows.push({ path: at, template: value });
      if (value.values.some(item => typeof item === "function" && item.toString().includes("#update"))) {
        const row = capturedRows.filter(item => at.startsWith(item.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
        assert.ok(row, "The actual rendered form belongs to one actual row TemplateResult.");
        capturedForms.push({ path: at, template: value, row: row.template });
      }
    }
    return renderValue(value, owner, at, caches);
  };
  // Native DOM is still the previous committed tree while Lit computes the next
  // render. The old flat renderer clears its node list too early for this query.
  // Forward only the existing exact native-form selector; no host method changes.
  f.renderer.query = (owner, selector) => owner === f.host && selector === "form[data-delivery-decision-id]"
    ? records.filter(record => record.form.isConnected).map(record => record.form).filter(form => form.getAttribute("data-delivery-decision-id") !== null)
    : query(owner, selector);
  // The path is emitted by the existing RendererPort: numeric for plain arrays,
  // /repeat:<key> only when the actual application emitted repeat. Never call its
  // render callback twice or synthesize decision-ID keys for a plain array.
  const decode = text => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const fields = template => {
    const markup = f.renderer.value(template, f.host, "native-update-fields"), found = [];
    for (const match of markup.matchAll(/<(input)\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\3>/gu)) {
      const tag = match[1] ?? match[3], parsed = f.renderer.attrs(match[2] ?? match[4]), name = parsed.attributes.name;
      if (!name) continue;
      const options = tag === "select" ? [...match[5].matchAll(/<option\b([^>]*)>/gu)].map(option => {
        const item = f.renderer.attrs(option[1]); return { value: String(item.attributes.value ?? ""),
          disabled: Object.hasOwn(item.attributes, "disabled"), selected: item.properties.selected ?? Object.hasOwn(item.attributes, "selected") };
      }) : [];
      assert.ok(Object.hasOwn(parsed.properties, "value"), "Each update field remains an actual Lit property binding, including explicit noChange.");
      found.push({ name, tag, ...parsed, bound: parsed.properties.value, options });
    }
    assert.deepEqual(found.map(item => item.name), ["title", "ownerUserId", "evidence", "status"]);
    return found;
  };
  const sync = record => fill(record.form, Object.fromEntries([...record.fields].map(([name, item]) => [name, item.node.value])));
  f.draw = () => {
    ports.bindFixture(f); capturedRows = []; capturedForms = []; capturing = true;
    let markup;
    try { markup = f.renderer.draw(f.host); } finally { capturing = false; }
    const templates = capturedForms, nodes = f.renderer.ownNodes(f.host, "form").filter(node => node.handlers.submit?.toString().includes("#update"));
    assert.equal(templates.length, nodes.length, "Actual update templates and native forms agree, including actual repeat directives.");
    const next = [], list = f.renderer.ownNodes(f.host, "ol").find(node => node.classList.contains("delivery-decision-list"));
    for (const [index, entry] of templates.entries()) {
      const fresh = nodes[index]; let record = records.find(item => item.path === entry.path);
      if (!record) record = { id: ++sequence, path: entry.path, form: fresh, fields: new Map(), attributes: new Map(), commits: [] };
      else { record.form.handlers = fresh.handlers; f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = record.form; }
      // Actual bound attributes update individually. Unbound native dirty metadata
      // must not disappear merely because RendererPort allocated a fresh record.
      for (const [name, value] of Object.entries(fresh.attributes)) {
        let part = record.attributes.get(name);
        if (!part) {
          part = new litParts.AttributePart(record.form, name, ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
          record.attributes.set(name, part);
        }
        const committed = litParts.getAttributePartCommittedValue(part, value);
        if (committed !== noChange) record.form.setAttribute(name, String(committed ?? ""));
      }
      record.index = index; record.form.isConnected = true; record.form.parentElement = f.host;
      record.hidden = Boolean(list && Object.hasOwn(list.attributes, "hidden")); record.inert = Boolean(list && Object.hasOwn(list.attributes, "inert"));
      const descriptions = fields(entry.template);
      for (const description of descriptions) {
        let item = record.fields.get(description.name);
        if (!item) {
          const node = { tagName: description.tag.toUpperCase(), value: "" };
          item = { node, part: new litParts.PropertyPart(node, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host }) };
          record.fields.set(description.name, item);
        }
        item.description = description;
        const value = litParts.getAttributePartCommittedValue(item.part, description.bound);
        if (value !== noChange) { item.node.value = String(value ?? ""); record.commits.push({ field: description.name, value: item.node.value }); }
      }
      record.form.elements = { namedItem: name => record.fields.get(name)?.node ?? null };
      const rowMarkup = f.renderer.value(entry.row, f.host, "native-row-heading");
      record.boundTitle = decode(rowMarkup.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/u)?.[1] ?? "");
      assert.ok(record.boundTitle, "Identity comes from the current actual rendered heading, not the dirty title field or a Worker substitute.");
      const buttons = [...f.renderer.value(entry.template, f.host, "native-update-buttons").matchAll(/<button\b([^>]*)>/gu)]
        .map(match => f.renderer.attrs(match[1]));
      record.saveButton = buttons.find(button => button.attributes.type === "submit");
      record.saveNode = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.type === "submit" && node.attributes["aria-label"] === record.saveButton?.attributes["aria-label"]);
      record.reloadButton = buttons.find(button => button.handlers.click?.toString().includes("#reloadDecision")) ?? null;
      assert.ok(record.saveButton); sync(record); next.push(record);
    }
    for (const record of records) if (!next.includes(record)) { record.form.isConnected = false; record.form.parentElement = null; }
    records = next; return markup;
  };
  f.updateRows = () => { f.draw(); return [...records]; };
  f.updateRow = title => { const found = f.updateRows().filter(record => record.boundTitle === title); assert.equal(found.length, 1, "One current rendered row for " + title); return found[0]; };
  f.editUpdate = (record, values) => {
    assert.ok(records.includes(record) && record.form.isConnected && f.host.contains(record.form));
    assert.equal(record.hidden || record.inert, false, "Only the exposed native form receives input.");
    for (const [name, value] of Object.entries(values)) {
      const item = record.fields.get(name); assert.ok(item);
      assert.equal(Object.hasOwn(item.description.attributes, "disabled"), false);
      if (item.description.tag === "select") assert.ok(item.description.options.some(option => option.value === String(value) && !option.disabled), "Choose an actual enabled option.");
      item.node.value = String(value);
    }
    sync(record);
    // Forward normal bubbling input/change only if emitted by the current actual
    // form. Baseline has neither handler, so its semantics stay unchanged.
    const target = record.fields.get(Object.keys(values)[0])?.node;
    record.form.handlers.input?.call(f.host, { type: "input", currentTarget: record.form, target });
    record.form.handlers.change?.call(f.host, { type: "change", currentTarget: record.form, target });
  };
  f.updateValues = record => Object.fromEntries([...record.fields].map(([name, item]) => [name, item.node.value]));
  f.submitUpdate = record => {
    f.draw(); assert.ok(records.includes(record) && record.form.isConnected && f.host.contains(record.form));
    assert.equal(record.hidden || record.inert, false);
    assert.equal(Object.hasOwn(record.saveButton.attributes, "disabled"), false, "Actual current Save is enabled.");
    const values = f.updateValues(record); assert.ok(values.title && values.title.length <= 160 && values.evidence.length <= 800);
    return f.submit(record.form);
  };
  f.reloadUpdate = async record => {
    f.draw(); assert.ok(records.includes(record) && record.form.isConnected && !record.hidden && !record.inert);
    assert.ok(record.reloadButton); assert.equal(Object.hasOwn(record.reloadButton.attributes, "disabled"), false);
    const button = f.renderer.ownNodes(f.host, "button").find(node => node.handlers.click === record.reloadButton.handlers.click);
    assert.ok(button && button.isConnected && f.host.contains(button));
    await button.handlers.click.call(f.host, { currentTarget: button, target: button, preventDefault() {} }); f.draw();
  };
  return f;
}
const endpoint = "/api/portfolio/product/delivery";
const calls = (f, method) => f.calls.filter(call => call.url === endpoint && call.method === method);
const sqlRows = (f, sql) => f.storeHost.worker.sqlite.prepare(sql).all();
const updates = f => sqlRows(f, "SELECT * FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionUpdated' ORDER BY sequence");
const receipts = f => sqlRows(f, "SELECT * FROM event_client_receipts WHERE stream_id='platform:product-delivery' ORDER BY client_event_id");
const moneyTables = ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations",
  "cost_budget_counters", "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_steps"];
const money = f => Object.fromEntries(moneyTables.map(table => [table,
  f.storeHost.worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ? sqlRows(f, 'SELECT * FROM "' + table + '" ORDER BY rowid') : null]));
async function grantManager(f, id) {
  const worker = f.storeHost.worker, headers = { "oai-authenticated-user-id": id, "oai-authenticated-user-email": id + "@example.test" };
  // The existing request port applies scoped headers after explicit headers.
  // Select this genuine incoming principal before its real denied-session read.
  worker.setScopedHeaders(headers);
  assert.equal((await worker.request("/api/session?audience=product", { headers })).status, 403);
  const now = new Date().toISOString(), grantId = crypto.randomUUID();
  worker.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,'product.delivery.manage','platform',NULL,NULL,NULL,'active',?,?,?,NULL,NULL)")
    .run(grantId, id, worker.owner, now, now);
  return { id, grantId, headers };
}
async function enterManager(f, manager) {
  f.storeHost.worker.setScopedHeaders(manager.headers); f.platformSession.reset(); f.draw();
  const session = await f.platformSession.load("product");
  assert.equal(session.user.userId, manager.id); assert.ok(session.capabilities.includes("product.delivery.manage"));
  await untilScene(() => f.draw().includes("delivery-decision-form"), "The real current manager's report and form arrive.");
}
async function seedCreate(f, title, ownerUserId) {
  const form = f.form(); f.fill(form, { title, audience: "product", evidence: "Existing evidence " + title, ownerUserId, dependencies: [] });
  await f.submit(form); f.draw();
  const rows = f.decisions().filter(row => row.title === title); assert.equal(rows.length, 1);
  assert.equal(f.committed.at(-1)?.status, 201, "Seed is created by the actual form and Worker receipt.");
  return rows[0].decision_id;
}
async function fixture(t, reorder = false) {
  const f = nativeUpdateForms(await productDeliveryFixture(t));
  const manager = await grantManager(f, "patch-draft-manager"); await enterManager(f, manager);
  const originalTitle = "Existing exact milestone", originalId = await seedCreate(f, originalTitle, f.storeHost.worker.owner);
  let companionId = null;
  if (reorder) {
    companionId = await seedCreate(f, "Companion milestone", f.storeHost.worker.owner);
    const companion = f.updateRow("Companion milestone");
    f.editUpdate(companion, { status: "running" }); await f.submitUpdate(companion); f.draw();
    assert.equal(f.decisions().find(row => row.decision_id === companionId).status, "running");
    assert.equal(f.updateRow(originalTitle).index, 1, "Actual status sorting places the planned original after the running companion.");
  }
  const row = f.updateRow(originalTitle);
  const draftA = { title: "Acknowledged update A", evidence: "Acknowledged evidence A", ownerUserId: manager.id, status: reorder ? "failed" : "running" };
  const draftB = { title: "  Newer unsubmitted update B 文書  ", evidence: "  Newer raw evidence B\nنص 文書  ", ownerUserId: f.storeHost.worker.owner, status: reorder ? "running" : "failed" };
  f.editUpdate(row, draftA);
  const before = { patches: calls(f, "PATCH").length, posts: calls(f, "POST").length, gets: calls(f, "GET").length,
    updates: updates(f).length, creations: f.creationEvents(), receipts: receipts(f), decisions: f.decisions(), money: money(f) };
  return { f, manager, row, originalId, companionId, draftA, draftB, before };
}
function hold(f, stage) {
  const gate = sceneDeferred(); let entered = false, patchResponse = false, responseStatus = null, jsonCalls = 0;
  f.deliver = async (call, response) => {
    if (call.method === "PATCH") {
      assert.equal(response.status, 200, "The original PATCH actually committed before this delivery gate.");
      patchResponse = true; responseStatus = response.status;
      if (stage === "headers") { entered = true; await gate.promise; }
      if (stage === "json") return { status: response.status, ok: response.ok, json: async () => {
        jsonCalls++; entered = true; await gate.promise; return response.json();
      } };
    } else if (stage === "report" && patchResponse && call.method === "GET" && call.url === endpoint) {
      assert.equal(response.status, 200, "Real post-PATCH report, not substituted success.");
      entered = true; await gate.promise;
    }
    return response;
  };
  return { gate, entered: () => entered, evidence: () => ({ stage, patchResponse, responseStatus, jsonCalls }) };
}
function assertOriginalWrite(x) {
  const { f, originalId, companionId, draftA, before } = x;
  assert.equal(calls(f, "PATCH").length, before.patches + 1, "Only the deliberately submitted A PATCH.");
  const request = calls(f, "PATCH").at(-1).body, original = before.decisions.find(row => row.decision_id === originalId);
  assert.deepEqual(request, { decisionId: originalId, ...draftA, expectedUpdatedAt: original.updated_at });
  const row = f.decisions().find(item => item.decision_id === originalId);
  assert.ok(row); assert.equal(row.title, draftA.title); assert.equal(row.evidence, draftA.evidence);
  assert.equal(row.owner_user_id, draftA.ownerUserId); assert.equal(row.status, draftA.status);
  assert.equal(f.decisions().length, before.decisions.length);
  if (companionId) assert.deepEqual(f.decisions().find(item => item.decision_id === companionId), before.decisions.find(item => item.decision_id === companionId));
  assert.equal(updates(f).length, before.updates + 1); assert.equal(calls(f, "POST").length, before.posts);
  assert.deepEqual(f.creationEvents(), before.creations); assert.deepEqual(receipts(f), before.receipts);
  assert.deepEqual(money(f), before.money); assert.deepEqual(f.external, []);
}
function observe(name, x, extra) {
  const record = { name, originalId: x.originalId, originalForm: x.row.id,
    patchCount: calls(x.f, "PATCH").length - x.before.patches, newCreateCount: calls(x.f, "POST").length - x.before.posts,
    updateEventCount: updates(x.f).length - x.before.updates, originalRowConnected: x.row.form.isConnected,
    ...extra };
  observations.push(record); console.log("PRODUCT_UPDATE_DRAFT_OBSERVATION " + JSON.stringify(record));
}


export { nativeUpdateForms, fixture, hold, assertOriginalWrite, observe, endpoint, calls, updates, receipts, money, grantManager, enterManager, seedCreate };
