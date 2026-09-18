// Actual complete Delivery/Store/RAM Worker; finite native OPTION/Lit Parts.
// Portable counterpart of immutable root baseline6191149c. Only the exact
// prior-committed form query and native command/reset/button ports are added;
// no application method, authority, endpoint response or selection is replaced.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange } from "lit";
import { productDeliveryFixture } from "./product-delivery-native-fixture.mjs";
import { snapshot, setLocale, seedExistingFixtureHistory } from "./product-delivery-owner-choice-fixture.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./calm-full-page-fixture.mjs";
import { untilScene } from "./scene-cost-store-host.mjs";
const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")));

const endpoint = "/api/portfolio/product/delivery";
const within = (node, parent) => { for (let value = node; value; value = value.parent) if (value === parent) return true; return false; };
const ancestor = (node, tag) => { for (let value = node.parent; value; value = value.parent) if (value.tag === tag) return value; return null; };
const createForms = f => fullPageTree(f).visible("form").filter(node => node.owner === f.host && String(node.handlers.submit).includes("#create"));

// Bounded adaptation of the installed Grant OPTION-part mechanism, plus the
// existing Create form's same-TemplateResult lifetime and native FormData port.
// Paths are actual RendererPort numeric/repeat paths. Never synthesize ID keys
// for a plain array. Only the two changing Create selects model OPTION nodes;
// other raw fields stay on their existing native nodes. No saved owner/ID map
// restores the chosen value after a draw: FormData follows selected OPTIONs.
function nativeCreateSelection(f) {
  const renderValue = f.renderer.value.bind(f.renderer), draw = f.draw, fill = f.fill, query = f.renderer.query.bind(f.renderer);
  let capturing = false, captures = [], retained = null, sequence = 0;
  const records = [], commits = [], fallbacks = [];
  // Native DOM remains committed while the actual class computes its next
  // template. Forward only its exact Create form query, as Update already does.
  f.renderer.query = (owner, selector) => owner === f.host && selector === "form[data-delivery-create]"
    ? retained?.form.isConnected && retained.form.hasAttribute("data-delivery-create") ? [retained.form] : []
    : query(owner, selector);
  f.renderer.value = (value, owner, at, caches) => {
    if (capturing && owner === f.host && value?.strings) {
      if (value.values.some(item => typeof item === "function" && item.toString().includes("#create")))
        captures.push({ path: at, strings: value.strings, options: [] });
      else if (/^\s*<option\b/u.test(value.strings[0])) {
        const form = captures.filter(item => at.startsWith(item.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
        if (form) form.options.push({ path: at, strings: value.strings });
      }
    }
    return renderValue(value, owner, at, caches);
  };
  const copyNode = (fresh, node, parent) => {
    for (const key of ["full", "handlers", "properties", "attributes"]) node[key] = fresh[key];
    node.disabled = Object.hasOwn(fresh.attributes, "disabled"); node.isConnected = true; node.parentElement = parent;
    const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
  };
  const retire = record => {
    record.form.isConnected = false; record.form.parentElement = null;
    for (const field of record.fields.values()) { field.node.isConnected = false; field.node.parentElement = null; }
    for (const select of record.selects.values()) for (const option of select.options) { option.node.isConnected = false; option.node.parentElement = null; }
  };
  const chooseNode = (select, node) => { for (const option of select.options) option.node.selected = option.node === node; };
  const newSelect = (name, node, multiple) => {
    const select = { name, node, multiple, options: [], valuePart: null };
    Object.defineProperties(node, {
      value: { configurable: true, get: () => select.options.find(option => option.node.selected)?.node.value ?? "",
        set: value => { chooseNode(select, select.options.find(option => option.node.value === String(value))?.node); } },
      selectedOptions: { configurable: true, get: () => select.options.filter(option => option.node.selected).map(option => option.node) },
      selectedIndex: { configurable: true, get: () => select.options.findIndex(option => option.node.selected) },
      options: { configurable: true, get: () => select.options.map(option => option.node) },
    });
    return select;
  };
  const optionRecord = (fresh, description, select) => {
    let item = select.options.find(option => option.path === description.path && option.strings === description.strings);
    if (!item) {
      const node = fresh.port; assert.ok(node);
      item = { id: ++sequence, path: description.path, strings: description.strings, node, valuePart: null, selectedPart: null };
      node.selected = Boolean(fresh.properties.selected ?? Object.hasOwn(fresh.attributes, "selected"));
      Object.defineProperty(node, "value", { configurable: true, get: () => String(node.attributes.value ?? ""), set: value => { node.attributes.value = String(value); } });
    }
    const before = { value: item.node.value, selected: item.node.selected }, nativeAttributes = { ...item.node.attributes };
    copyNode(fresh.port, item.node, select.node); item.node.attributes = { ...fresh.attributes, value: nativeAttributes.value ?? "" };
    item.valuePart ??= new litParts.AttributePart(item.node, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
    const value = litParts.getAttributePartCommittedValue(item.valuePart, fresh.attributes.value ?? "");
    if (value !== noChange) {
      item.node.setAttribute("value", String(value ?? ""));
      commits.push({ select: select.name, optionNode: item.id, path: item.path, from: before.value, to: item.node.value, selected: before.selected });
    }
    if (Object.hasOwn(fresh.properties, "selected")) {
      item.selectedPart ??= new litParts.PropertyPart(item.node, "selected", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
      const selected = litParts.getAttributePartCommittedValue(item.selectedPart, fresh.properties.selected);
      if (selected !== noChange) item.node.selected = Boolean(selected);
    }
    item.text = fresh.text; item.node.textContent = fresh.text; return item;
  };
  const sync = record => {
    const values = {};
    for (const [name, item] of record.fields) {
      if (record.selects.has(name)) {
        const selected = record.selects.get(name).node.selectedOptions.filter(node => !Object.hasOwn(node.attributes, "disabled"));
        if (name === "dependencies") values[name] = selected.map(node => node.value);
        else if (selected.length) values[name] = selected[0].value;
      } else values[name] = String(item.node.value);
    }
    fill(record.form, values);
  };
  f.draw = () => {
    captures = []; capturing = true; let markup;
    try { markup = draw(); } finally { capturing = false; }
    const tree = fullPageTree(f, markup), forms = tree.visible("form").filter(node => node.owner === f.host && String(node.handlers.submit).includes("#create"));
    assert.equal(forms.length, captures.length); assert.ok(forms.length <= 1);
    if (!forms.length) { if (retained) retire(retained); retained = null; return markup; }
    const form = forms[0], description = captures[0];
    if (retained && (retained.path !== description.path || retained.strings !== description.strings)) { retire(retained); retained = null; }
    if (!retained) {
      retained = { id: ++sequence, path: description.path, strings: description.strings, form: form.port, fields: new Map(), selects: new Map() };
      const created = retained;
      created.form.reset = () => {
        f.formResets += 1;
        for (const [name, item] of created.fields) {
          const select = created.selects.get(name);
          if (select) {
            if (select.multiple) for (const option of select.options) option.node.selected = false;
            else chooseNode(select, select.options.find(option => !Object.hasOwn(option.node.attributes, "disabled"))?.node);
          } else item.node.value = item.defaultValue;
        }
        sync(created);
      };
      records.push(retained);
    }
    const record = retained; copyNode(form.port, record.form, f.host);
    const fields = tree.nodes.filter(node => within(node, form) && ["input", "textarea", "select"].includes(node.tag) && node.attributes.name);
    assert.deepEqual(fields.map(node => node.attributes.name), ["title", "audience", "ownerUserId", "evidence", "dependencies"]);
    const allOptions = tree.nodes.filter(node => within(node, form) && node.tag === "option");
    const literalSelf = allOptions.filter(node => ancestor(node, "select")?.attributes.name === "ownerUserId" && node.attributes.value === "");
    assert.equal(literalSelf.length, 1); assert.equal(allOptions.length, description.options.length + 1);
    const descriptions = new Map(); let optionIndex = 0;
    for (const option of allOptions) descriptions.set(option, option === literalSelf[0]
      ? { path: description.path + "/literal-self", strings: description.strings } : description.options[optionIndex++]);
    assert.equal(optionIndex, description.options.length);
    for (const field of fields) {
      const name = field.attributes.name; let item = record.fields.get(name);
      if (!item) {
        const defaultValue = field.tag === "select"
          ? allOptions.find(option => ancestor(option, "select") === field && !Object.hasOwn(option.attributes, "disabled"))?.attributes.value ?? ""
          : field.attributes.value ?? "";
        item = { node: field.port, valuePart: null, defaultValue: String(defaultValue) }; record.fields.set(name, item);
        if (field.tag === "select" && !["ownerUserId", "dependencies"].includes(name)) item.node.value = item.defaultValue;
      }
      copyNode(field.port, item.node, record.form);
      if (["ownerUserId", "dependencies"].includes(name)) {
        let select = record.selects.get(name);
        if (!select) { select = newSelect(name, item.node, Object.hasOwn(field.attributes, "multiple")); record.selects.set(name, select); }
        const options = allOptions.filter(option => ancestor(option, "select") === field);
        const index = f.renderer.nodes.indexOf(item.node); assert.ok(index >= 0);
        const portsForOptions = f.renderer.nodes.slice(index + 1).filter(node => node.owner === f.host && node.tag === "option").slice(0, options.length);
        assert.equal(portsForOptions.length, options.length);
        for (const [at, option] of portsForOptions.entries()) assert.equal(option.attributes.value, options[at].attributes.value);
        const previous = select.options, next = options.map((option, at) => optionRecord({ ...option, port: portsForOptions[at] }, descriptions.get(option), select));
        for (const old of previous) if (!next.includes(old)) { old.node.isConnected = false; old.node.parentElement = null; }
        select.options = next;
        if (!select.multiple && !next.some(option => option.node.selected)) {
          const first = next.find(option => !Object.hasOwn(option.node.attributes, "disabled")); chooseNode(select, first?.node);
          fallbacks.push({ form: record.id, select: name, value: first?.node.value ?? "" });
        }
        if (Object.hasOwn(field.properties, "value")) {
          select.valuePart ??= new litParts.PropertyPart(select.node, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
          const value = litParts.getAttributePartCommittedValue(select.valuePart, field.properties.value);
          if (value !== noChange) select.node.value = value;
        }
      } else if (Object.hasOwn(field.properties, "value")) {
        item.valuePart ??= new litParts.PropertyPart(item.node, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
        const value = litParts.getAttributePartCommittedValue(item.valuePart, field.properties.value);
        if (value !== noChange) item.node.value = String(value ?? "");
      }
    }
    record.form.elements = { namedItem: name => record.fields.get(name)?.node ?? null };
    record.buttons = tree.nodes.filter(node => within(node, form) && node.tag === "button");
    for (const button of record.buttons) { assert.ok(button.port); button.port.parentElement = record.form; }
    record.submit = record.buttons.find(node => node.attributes.type === "submit"); assert.ok(record.submit?.port);
    sync(record); return markup;
  };
  const current = () => { f.draw(); assert.ok(retained?.form.isConnected && f.host.contains(retained.form)); return retained; };
  const choose = (name, ids) => {
    const record = current(), select = record.selects.get(name); assert.ok(select);
    assert.equal(select.node.disabled, false); assert.ok(select.multiple || ids.length === 1);
    for (const id of ids) assert.equal(select.options.filter(option => option.node.value === id && !Object.hasOwn(option.node.attributes, "disabled")).length, 1);
    for (const option of select.options) option.node.selected = ids.includes(option.node.value);
    const event = { type: "change", target: select.node, currentTarget: select.node, preventDefault() {}, stopPropagation() {} };
    select.node.handlers.change?.call(f.host, event); record.form.handlers.change?.call(f.host, { ...event, currentTarget: record.form });
    sync(record); f.draw(); return record;
  };
  const fillRaw = values => {
    const record = current();
    for (const [name, value] of Object.entries(values)) {
      const item = record.fields.get(name); assert.ok(item && !record.selects.has(name)); assert.equal(item.node.disabled, false);
      if (name === "audience") assert.ok(fullPageTree(f).nodes.some(option => option.tag === "option" && ancestor(option, "select")?.attributes.name === name && option.attributes.value === value));
      item.node.value = value;
      const event = { type: "input", target: item.node, currentTarget: item.node, preventDefault() {}, stopPropagation() {} };
      item.node.handlers.input?.call(f.host, event); record.form.handlers.input?.call(f.host, { ...event, currentTarget: record.form });
    }
    sync(record); return record;
  };
  const observation = () => {
    const record = current(), data = new FormData(record.form);
    const selectors = Object.fromEntries([...record.selects].map(([name, select]) => [name, {
      value: select.node.value, selected: select.node.selectedOptions.map(node => node.value),
      selectedNodes: select.options.filter(option => option.node.selected).map(option => option.id),
      formData: data.getAll(name), options: select.options.map(option => ({ node: option.id, path: option.path, value: option.node.value,
        text: option.text, selected: option.node.selected, disabled: Object.hasOwn(option.node.attributes, "disabled") })),
    }]));
    const enabled = !Object.hasOwn(record.submit.attributes, "disabled"), required = [...record.fields].filter(([, item]) => Object.hasOwn(item.node.attributes, "required"));
    const valid = required.every(([name, item]) => Boolean(String(item.node.value).trim()) && (name !== "audience" || item.node.value === "product"));
    return { form: record.id, selectors, raw: { title: data.get("title"), audience: data.get("audience"), evidence: data.get("evidence") },
      submitEnabled: enabled, requiredFieldsValid: valid, actionable: enabled && valid,
      ownerRequired: Object.hasOwn(record.fields.get("ownerUserId").node.attributes, "required") };
  };
  const activateCreate = async () => {
    const record = current(), button = record.submit;
    assert.ok(button.port.isConnected && record.form.contains(button.port));
    const noValidate = Object.hasOwn(button.attributes, "formnovalidate") || Object.hasOwn(record.form.attributes, "novalidate");
    const missing = [...record.fields].filter(([, item]) => Object.hasOwn(item.node.attributes, "required") && !String(item.node.value).trim()).map(([name]) => name);
    if (Object.hasOwn(button.attributes, "disabled") || !noValidate && missing.length) return { dispatched: false, noValidate, missing };
    sync(record);
    await f.submit(record.form); f.draw();
    return { dispatched: true, noValidate, missing };
  };
  const removeUnavailableDependencies = () => {
    const record = current(), buttons = record.buttons.filter(button => String(button.handlers.click).includes("#removeUnavailableCreateDependencies"));
    assert.equal(buttons.length, 1); const button = buttons[0];
    assert.ok(button.port.isConnected && record.form.contains(button.port)); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    button.handlers.click.call(f.host, { type: "click", currentTarget: button.port, target: button.port, preventDefault() {}, stopPropagation() {} });
    f.draw();
  };
  return { current, choose, fillRaw, observation, activateCreate, removeUnavailableDependencies, records, commits, fallbacks, retained: () => retained };
}

function seedDependencies(f, seeded, locale) {
  const db = f.storeHost.worker.sqlite;
  for (const [index, person] of seeded.people.entries()) {
    person.name = "zzzz Owner " + (index + 1); db.prepare("UPDATE users SET display_name=? WHERE user_id=?").run(person.name, person.userId);
  }
  db.prepare("UPDATE delivery_decisions SET updated_at=? WHERE decision_id=?").run("2026-08-29T00:05:00.000Z", seeded.decisionId);
  const row = db.prepare("SELECT * FROM delivery_decisions WHERE decision_id=?").get(seeded.decisionId), dependencies = [];
  const insert = db.prepare("INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  for (const [index, name] of ["B", "D", "C"].entries()) {
    const item = { ...row, decision_id: "create-selection-dependency-" + name + "-" + locale,
      title: "Existing dependency " + name + " 文書", updated_at: "2026-08-29T00:0" + (3 - index) + ":00.000Z" };
    insert.run(item.decision_id, item.title, item.audience, item.status, item.owner_user_id, item.owner_display_name,
      item.evidence, item.dependency_ids_json, item.created_by_user_id, item.created_at, item.updated_at); dependencies.push(item);
  }
  return dependencies;
}

export { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory, ports, untilScene, endpoint, createForms, nativeCreateSelection, seedDependencies };
