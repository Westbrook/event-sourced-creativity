import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange } from "lit";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./scene-cost-store-host.mjs";
import { createCalmFullPage, registerCalmFullPageComponents, fullPageTree, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./actual-scene-resume-read.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../../worker/runtime.ts";
import { observeBoardRailDocument } from "./board-rail-document-observer.mjs";
import { withDocumentInRoute } from "../../src/model/routes.ts";
import { commandDiscoveryCopy } from "../../src/components/design-system/locales/command-discovery-messages.ts";

const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")));
const within = (node, ancestor) => { for (let current = node; current; current = current.parent) if (current === ancestor) return true; return false; };
const ancestor = (node, tag) => { for (let current = node.parent; current; current = current.parent) if (current.tag === tag) return current; return null; };
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);

// Reuse the complete Shell/Editor/Store/Worker and RendererPort. This bounded
// native adapter retains only the actual inspector form and its native fields
// at their existing template/part paths. It neither keys an unkeyed option by
// domain ID nor restores selection from a saved value. Copy is .value-bound;
// no defaultValue/defaultChecked oracle is used for any Editor control.
function editorNative(t, f, owner) {
  const draw = f.draw, render = f.renderer.value.bind(f.renderer);
  let capturing = false, description = null, retained = null;
  const records = new Set();
  f.renderer.value = (value, currentOwner, path, caches) => {
    if (capturing && currentOwner === owner && value?.strings) {
      if (/^\s*<form\b/u.test(value.strings[0]) && value.values.some(item => typeof item === "function" && String(item).includes("#save")))
        description = { path, strings: value.strings, options: [] };
      else if (description && path.startsWith(description.path + "/") && /^\s*<option\b/u.test(value.strings[0]))
        description.options.push({ path, strings: value.strings });
    }
    return render(value, currentOwner, path, caches);
  };
  const copyPort = (fresh, node, parent) => {
    for (const key of ["full", "handlers", "properties", "propertyParts", "attributes"]) node[key] = fresh[key];
    node.parentElement = parent; node.isConnected = true; node.disabled = Object.hasOwn(fresh.attributes, "disabled");
    const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
  };
  const retire = record => {
    for (const node of [record.form, ...[...record.fields.values()].map(item => item.node), ...record.options.map(item => item.node)]) {
      node.isConnected = false; node.parentElement = null;
    }
  };
  const partValue = (item, name, value, kind = "PropertyPart") => {
    item.parts ??= new Map(); let part = item.parts.get(name);
    if (!part) { part = new litParts[kind](item.node, name, ["", ""], litParts.connectedDisconnectable({}), { host: owner }); item.parts.set(name, part); }
    return litParts.getAttributePartCommittedValue(part, value);
  };
  f.draw = () => {
    description = null; capturing = true; let markup;
    try { markup = draw(); } finally { capturing = false; }
    const tree = fullPageTree(f, markup), forms = tree.visible("form").filter(node => node.owner === owner && String(node.handlers.submit).includes("#save"));
    assert.ok(forms.length <= 1); assert.equal(forms.length, description ? 1 : 0);
    if (!forms.length) { if (retained) retire(retained); retained = null; return markup; }
    const form = forms[0];
    if (retained && (retained.path !== description.path || retained.strings !== description.strings)) { retire(retained); retained = null; }
    if (!retained) { retained = { ...description, form: form.port, fields: new Map(), options: [] }; records.add(retained); }
    const record = retained; copyPort(form.port, record.form, owner);
    const fields = tree.nodes.filter(node => within(node, form) && ["select", "textarea", "input"].includes(node.tag) && node.attributes.name);
    assert.deepEqual(fields.map(node => node.attributes.name), ["item-type", "item-intent", "copy", "strength", "strength", "strength"],
      "This native adapter is only the actual ordinary plain-copy inspector, never an invented structured editor");
    const options = tree.nodes.filter(node => within(node, form) && node.tag === "option");
    assert.equal(options.length, description.options.length);
    const nextOptions = options.map((fresh, index) => {
      const at = description.options[index];
      let item = record.options.find(value => value.path === at.path && value.strings === at.strings);
      if (!item) item = { ...at, node: fresh.port, selected: Object.hasOwn(fresh.attributes, "selected"), dirty: false };
      const selectedAttribute = Object.hasOwn(item.node.attributes, "selected");
      copyPort(fresh.port, item.node, record.form);
      item.node.attributes = { ...fresh.attributes };
      if (selectedAttribute) item.node.attributes.selected = ""; else delete item.node.attributes.selected;
      Object.defineProperties(item.node, {
        value: { configurable: true, get: () => String(item.node.attributes.value ?? ""), set: value => { item.node.attributes.value = String(value); } },
        selected: { configurable: true, get: () => item.selected, set: value => { item.selected = Boolean(value); item.dirty = true; } },
      });
      const selected = partValue(item, "selected", Object.hasOwn(fresh.attributes, "selected"), "BooleanAttributePart");
      if (selected !== noChange) {
        if (selected) item.node.attributes.selected = ""; else delete item.node.attributes.selected;
        if (!item.dirty) item.selected = Boolean(selected);
      }
      item.selectName = ancestor(fresh, "select").attributes.name;
      item.node.textContent = fresh.text; return item;
    });
    for (const item of record.options) if (!nextOptions.includes(item)) { item.node.isConnected = false; item.node.parentElement = null; }
    record.options = nextOptions;
    for (const fresh of fields) {
      const name = fresh.attributes.name;
      const key = name === "strength" ? fresh.propertyParts.checked : name;
      assert.ok(key); let item = record.fields.get(key);
      if (!item) { item = { node: fresh.port, name }; record.fields.set(key, item); }
      copyPort(fresh.port, item.node, record.form);
      if (fresh.tag === "select") {
        const selected = () => record.options.filter(option => option.selectName === name);
        Object.defineProperties(item.node, {
          options: { configurable: true, get: () => selected().map(option => option.node) },
          selectedOptions: { configurable: true, get: () => selected().filter(option => option.selected).map(option => option.node) },
          value: { configurable: true, get: () => selected().find(option => option.selected)?.node.value ?? "",
            set: value => { for (const option of selected()) option.node.selected = option.node.value === String(value); } },
        });
        for (const option of selected()) option.node.parentElement = item.node;
        if (!selected().some(option => option.selected)) { const first = selected()[0]; if (first) first.selected = true; }
      } else {
        const property = fresh.tag === "textarea" ? "value" : "checked";
        assert.ok(Object.hasOwn(fresh.properties, property), "Actual controlled field property exists");
        const value = partValue(item, property, fresh.properties[property]);
        if (value !== noChange) item.node[property] = value;
      }
    }
    record.form.elements = { namedItem: name => [...record.fields.values()].find(item => item.name === name)?.node ?? null };
    record.buttons = tree.nodes.filter(node => within(node, form) && node.tag === "button");
    record.submit = record.buttons.find(node => !Object.hasOwn(node.attributes, "type"));
    assert.ok(record.submit?.port); return markup;
  };
  const NativeFormData = globalThis.FormData;
  globalThis.FormData = class extends NativeFormData {
    constructor(form) {
      const record = [...records].find(item => item.form === form);
      if (!record) { super(form); return; }
      super(); assert.ok(form.isConnected);
      for (const { node, name } of record.fields.values()) {
        if (node.matches(":disabled")) continue;
        if (name === "strength") { if (node.checked) this.append(name, node.value); }
        else if (node.tag === "select") { for (const option of node.selectedOptions) if (!option.hasAttribute("disabled")) this.append(name, option.value); }
        else this.append(name, node.value);
      }
    }
  };
  t.after(() => { globalThis.FormData = NativeFormData; });
  const current = () => { f.draw(); assert.ok(retained?.form.isConnected && owner.isConnected); return retained; };
  const field = name => { const record = current(), matches = [...record.fields.values()].filter(item => item.name === name); assert.equal(matches.length, 1); return matches[0].node; };
  const raw = () => Object.fromEntries(new FormData(current().form));
  const change = values => {
    const record = current();
    for (const [name, value] of Object.entries(values)) {
      if (name === "strength") {
        const radios = [...record.fields.values()].filter(item => item.name === name); assert.equal(radios.length, 3);
        assert.equal(radios.filter(item => item.node.value === value).length, 1);
        for (const item of radios) { assert.equal(item.node.matches(":disabled"), false); item.node.checked = item.node.value === value; }
        f.native.emit("change", radios.find(item => item.node.checked).node);
      } else { const node = field(name); assert.equal(node.matches(":disabled"), false); node.value = value; f.native.emit(node.tag === "select" ? "change" : "input", node); }
    }
    f.draw(); return raw();
  };
  const escape = async () => {
    const record = current(), form = record.form;
    assert.equal(typeof form.handlers.keydown, "function");
    await form.handlers.keydown.call(owner, { key: "Escape", isComposing: false, target: field("copy"), currentTarget: form, preventDefault() {}, stopPropagation() {} });
    await f.settle(); return raw();
  };
  const submit = () => {
    const record = current(), button = record.submit.port;
    assert.equal(button.matches(":disabled"), false); assert.ok(button.isConnected);
    return record.form.handlers.submit.call(owner, { type: "submit", target: record.form, currentTarget: record.form, submitter: button, preventDefault() {}, stopPropagation() {} });
  };
  return { current, field, raw, change, escape, submit };
}

export async function creativeEditorCommandPage(t, locale, { navigationDocument = false, emptyReusableContext = false } = {}) {
  const checkpoint = phase => t.diagnostic("C_EDITOR_SETUP " + JSON.stringify({ locale, phase, evidence: "actual complete class/native ports; not physical DOM" }));
  checkpoint("start");
  t.mock.method(globalThis, "fetch", async () => assert.fail("No live network or provider is authorized"));
  const fixtureWorker = await createSceneCostFixture(1, "visual");
  let worker = fixtureWorker, selectedId = "scene-reuse-direction";
  if (emptyReusableContext) {
    assert.equal(navigationDocument, false, "The empty-picker source is separate from the select/collection fixture");
    const projectId = "empty-reusable-context-project", documentId = "empty-reusable-context-document";
    selectedId = "empty-reusable-context-direction";
    // Genuine independent source setup before the original history snapshot;
    // do not filter the saved scene artifact out of a live Store projection.
    await appendAuditEvent(worker.env, worker.streamId, "user", "ProjectCreated", {
      project_id: projectId, name: "Empty reusable context project" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", {
      project_id: projectId, document_id: documentId, title: "Empty reusable context document" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "BlockCreated", {
      project_id: projectId, document_id: documentId, block_id: selectedId, type: "direction",
      handle: "direction/empty-reusable-context", position: "a",
      properties: { text: "The keeper checks the harbor.", weight: 1 } });
    worker = { ...fixtureWorker, projectId, documentId };
  }
  const navigationTarget = navigationDocument ? { documentId: "studio-navigator-other-document", title: "Exact other navigation document",
    collectionId: "studio-navigator-other-collection", collectionHandle: "Exact other document collection" } : null;
  if (navigationTarget) {
    // Explicit RAM source setup before the original expected-history snapshot.
    // No fake Store projection or response, user creation, grant or provider.
    await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", {
      project_id: worker.projectId, document_id: navigationTarget.documentId, title: navigationTarget.title });
    await appendAuditEvent(worker.env, worker.streamId, "user", "CollectionCreated", {
      project_id: worker.projectId, collection_id: navigationTarget.collectionId, handle: navigationTarget.collectionHandle, position: "zz" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "CollectionItemAdded", {
      project_id: worker.projectId, collection_id: navigationTarget.collectionId,
      item_ref: { document_id: navigationTarget.documentId }, position: "a" });
    await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentOpened", {
      document_id: worker.documentId, source_surface: "studio-navigator-fixture" });
  }
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  const history = () => readWorkspaceEvents(worker.env, worker.streamId);
  const counts = () => Object.fromEntries(Object.keys(worker.counts()).map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '"').all()]));
  const receipts = () => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  let expectedHistory = await history(); const originalCounts = counts(); let navigationReceipt = null;
  const oldHistory = globalThis.history;
  globalThis.history = { pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); }, replaceState(...args) { this.pushState(...args); } };
  t.after(async () => {
    try {
      if (navigationReceipt) {
        await resume.settleOriginalRequests();
        if (navigationReceipt.acknowledged()) {
          const proof = await navigationReceipt.verify(), current = await history(), event = current.at(-1);
          assert.equal(event.eventId, proof.eventId); assert.equal(event.type, "DocumentOpened");
          assert.deepEqual(current.slice(0, -1), expectedHistory, "Only the exact witnessed original may extend this fixture history");
          expectedHistory = current;
        }
      }
      assert.deepEqual(await history(), expectedHistory); assert.deepEqual(counts(), originalCounts);
    } finally { navigationReceipt?.restore(); globalThis.history = oldHistory; }
  });
  const resume = observeActualSceneResumeReads(h); t.after(() => resume.restore());
  const events = h.store.events.get(), head = h.store.head.get(), content = h.store.content.get();
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  checkpoint("actual-shell-mounted");
  await registerCalmFullPageComponents(f, ["forma-creative-editor", "forma-workspace", "forma-project-rail", "forma-studio-mode-nav", "forma-output-requirements", "forma-studio-navigator"]);
  checkpoint("actual-transitive-components-registered");
  f.native = installOutputNavigationFocusNative(t, f, ports);
  h.store.events.set(events); h.store.head.set(head); h.store.content.set(content);
  const route = withDocumentInRoute("/studio/editor", worker.documentId, "Original editor document");
  h.store.setRoute(route); await h.store.syncDocumentFromRoute(); await f.settle();
  checkpoint("actual-editor-route-mounted");
  const owners = f.components().filter(component => component.tag === "forma-creative-editor"); assert.equal(owners.length, 1);
  const owner = owners[0]; assert.equal(owner.store, h.store); assert.ok(owner.isConnected);
  assert.ok(owner instanceof f.modules.get("src/components/forma-creative-editor.ts").FormaCreativeEditor);
  const native = editorNative(t, f, owner); await f.settle();
  checkpoint("actual-controlled-native-fields-bound");
  const settle = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await f.settle();
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await resume.settleOriginalRequests(); await new Promise(setImmediate);
    }
    await worker.drainBackground();
  };
  await settle();
  checkpoint("setup-original-transports-settled");
  const current = h.store.projection.get(), selected = current.blocks.find(item => item.id === selectedId);
  assert.ok(selected); assert.equal(current.blocks[0].id, selected.id);
  assert.deepEqual(native.raw(), { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" });
  assert.equal(selected.properties.weight, 1, "Pristine Lead is a category, not Save's .94 normalization");
  assert.equal(h.store.session.get().projectContext, undefined);
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
  const snapshot = async () => ({ route: h.store.route.get(), title: h.store.projection.get().documentTitle, history: await history(), receipts: receipts(), counts: counts(),
    source: h.store.captureSourceOwnership(), authority: h.store.captureAuthorizationScope(), session: JSON.stringify(h.store.session.get()), requests: h.requests.length, raw: native.raw() });
  const safety = async before => {
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
    assert.equal(JSON.stringify(h.store.session.get()), before.session);
    assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
    assert.deepEqual(await history(), before.history); assert.deepEqual(receipts(), before.receipts); assert.deepEqual(counts(), before.counts);
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(request)), [],
      "Only independently certified exact original free Resume is a read; no endpoint-wide POST exemption");
  };
  const prepare = async () => {
    const copy = commandDiscoveryCopy(locale), trigger = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
    assert.ok(trigger.port.isConnected); f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
    const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search"); search.port.value = copy.prepare; await f.act(search, "input");
    const tree = f.tree(), dialog = tree.visible("dialog").filter(node => node.owner === f.host && classed(node, "command-dialog") && node.port.open);
    assert.equal(dialog.length, 1);
    const choices = tree.visible("button").filter(node => within(node, dialog[0]) && node.attributes.role === "option"
      && node.children.some(child => child.tag === "span" && child.text === copy.prepare));
    assert.equal(choices.length, 1); assert.ok(choices[0].port.isConnected); assert.equal(choices[0].port.matches(":disabled"), false);
    assert.equal(choices[0].children.find(child => child.tag === "small").text,
      [h.store.projection.get().documentTitle, h.store.projection.get().projectName, copy.preparing].join(" · "));
    f.native.emit("pointerdown", choices[0].port); f.native.focus(choices[0].port); await f.act(choices[0], "click", { button: 0 });
    await settle();
  };
  const holdSave = () => {
    const prior = h.transport, ready = sceneDeferred(), gate = sceneDeferred(); let record = null;
    h.transport = async request => {
      if (request.url !== "/api/events" || request.init.method !== "POST") return prior(request);
      assert.equal(record, null, "Exactly one deliberately submitted native Save batch");
      const bytes = request.init.body, body = JSON.parse(bytes), before = await history();
      assert.equal(body.action, "batch"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, before.at(-1).sequence);
      assert.deepEqual(body.events.map(event => event.type), ["BlockPropertyEdited", "BlockWeightSet"]);
      assert.ok(body.events.every(event => event.payload.block_id === selected.id && event.payload.source_surface === "creative-editor"));
      const response = await prior(request); assert.equal(response.status, 200);
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, body.events.length);
      for (const [index, event] of receipt.appended.entries()) {
        assert.equal(event.type, body.events[index].type); assert.deepEqual(event.payload, body.events[index].payload);
        assert.equal(event.sequence, body.expectedSequence + index + 1); assert.equal(event.streamId, worker.streamId);
      }
      await worker.drainBackground(); assert.deepEqual(await history(), [...before, ...receipt.appended]); assert.deepEqual(counts(), originalCounts);
      expectedHistory = [...before, ...receipt.appended]; record = { request, bytes, receipt, response, released: false }; ready.resolve(record);
      await gate.promise; record.released = true; assert.equal(request.init.body, bytes); return response;
    };
    const restore = () => { gate.resolve(); h.transport = prior; }; t.after(restore);
    return { ready: ready.promise, release: () => gate.resolve(), restore, record: () => record };
  };
  if (navigationTarget) navigationReceipt = observeBoardRailDocument(h, resume, navigationTarget.documentId, { sourceSurface: "studio-alternative" });
  return { f, h, owner, native, selected, route, resume, settle, snapshot, safety, prepare, holdSave, history, counts, receipts, navigationTarget, navigationReceipt,
    desiredDestination: title => withDocumentInRoute("/", worker.documentId, title), classed, within, untilScene };
}
