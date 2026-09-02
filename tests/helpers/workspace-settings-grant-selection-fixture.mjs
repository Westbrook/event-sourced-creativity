// E task successor: default Grant entry is Projects; explicit Transfer stays
// on Members. The native selectedness adapter below is unchanged. Old combined
// Overview/Revoke scenarios remain archived and are not claimed byte-identical.
// Complete current Settings/Store/native confirmation with finite HTTP.
// The proven B3 R3 selected-option adapter retains the original semantics.
// Root's lint-only forward drops an unused import and an implicit setter return;
// the immutable baseline and all eight original case bodies remain preserved.
// Native selectedness ports are not browser/OS-picker/physical AT certification.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange } from "lit";
import { settingsFixture, endpoint, method } from "./workspace-settings-whole-read-fixture.mjs";
const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")).href);

const within = (node, parent) => { for (let value = node; value; value = value.parent) if (value === parent) return true; return false; };
const ancestor = (node, tag) => { for (let value = node.parent; value; value = value.parent) if (value.tag === tag) return value; return null; };
const actualGrantForm = f => f.tree().visible("form").filter(node => node.owner === f.host && String(node.handlers.submit).includes("#grantProject"));
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(), authorization: f.store.captureAuthorizationScope() });

// The original renderer emits numeric array paths, and /repeat:<key> only for
// an actual repeat directive. It recreates flat native ports on every draw.
// Retain the exact form/select/option nodes under those emitted paths, as the
// existing nativeFormLifetime/Delivery PropertyPart fixtures do for forms.
// Installed Lit decides whether a value/property binding commits. The bounded
// native rule is explicit: changing an OPTION's value does not select another
// OPTION; selectedness stays on that node. This is not a browser implementation.
function nativeGrantSelection(f, { formHandler = "#grantProject", fieldName = "userId", roleField = true, allowNoPlaceholder = false } = {}) {
  const actualForms = formHandler === "#grantProject" ? actualGrantForm
    : current => current.tree().visible("form").filter(node => node.owner === current.host && String(node.handlers.submit).includes(formHandler));
  const renderValue = f.renderer.value.bind(f.renderer), draw = f.draw, collect = f.renderer.collect.bind(f.renderer);
  let capturing = false, captures = [], retained = null, sequence = 0;
  const records = [], commits = [], fallbacks = [];
  f.renderer.value = (value, owner, at, caches) => {
    if (capturing && owner === f.host && value?.strings) {
      if (value.strings.join("").includes('<select name="' + fieldName + '"')
        && value.values.some(item => typeof item === "function" && item.toString().includes(formHandler))) {
        captures.push({ path: at, strings: value.strings, options: [] });
      } else if (/^\s*<option\b/u.test(value.strings[0])) {
        const form = captures.filter(item => at.startsWith(item.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
        if (form) form.options.push({ path: at, strings: value.strings });
      }
    }
    return renderValue(value, owner, at, caches);
  };
  const copyNode = (fresh, node, parent) => {
    for (const key of ["full", "handlers", "properties", "attributes"]) node[key] = fresh[key];
    node.disabled = fresh.disabled; node.isConnected = true; node.parentElement = parent;
    const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0);
    f.renderer.nodes[index] = node;
  };
  const chooseNode = (record, node) => { for (const option of record.options) option.node.selected = option.node === node; };
  const createSelect = (form, select, template) => {
    const record = { id: ++sequence, path: template.path, strings: template.strings, form, select, options: [], valuePart: null };
    Object.defineProperties(select, {
      value: { configurable: true, get: () => record.options.find(option => option.node.selected)?.node.value ?? "",
        set: value => { chooseNode(record, record.options.find(option => option.node.value === String(value))?.node); } },
      selectedOptions: { configurable: true, get: () => record.options.filter(option => option.node.selected).map(option => option.node) },
      selectedIndex: { configurable: true, get: () => record.options.findIndex(option => option.node.selected) },
      options: { configurable: true, get: () => record.options.map(option => option.node) },
    });
    records.push(record); return record;
  };
  const optionRecord = (fresh, description, record) => {
    let item = record.options.find(option => option.path === description.path && option.strings === description.strings);
    if (!item) {
      const node = fresh.port; assert.ok(node);
      item = { id: ++sequence, path: description.path, strings: description.strings, node, valuePart: null, selectedPart: null };
      node.selected = Boolean(fresh.properties.selected ?? Object.hasOwn(fresh.attributes, "selected"));
      Object.defineProperty(node, "value", { configurable: true, get: () => String(node.attributes.value ?? ""),
        set: value => { node.attributes.value = String(value); } });
    }
    const before = { value: item.node.value, selected: item.node.selected };
    // Preserve the native value until the real Lit attribute part commits it.
    const nativeAttributes = { ...item.node.attributes };
    copyNode(fresh.port, item.node, record.select);
    item.node.attributes = { ...fresh.attributes, value: nativeAttributes.value ?? "" };
    item.valuePart ??= new litParts.AttributePart(item.node, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
    const committed = litParts.getAttributePartCommittedValue(item.valuePart, fresh.attributes.value ?? "");
    if (committed !== noChange) {
      item.node.setAttribute("value", String(committed ?? ""));
      commits.push({ optionNode: item.id, path: item.path, from: before.value, to: item.node.value, selected: before.selected });
    }
    // A future explicit selected property must receive its actual Lit semantics,
    // not be ignored to preserve the baseline failure. None is emitted today.
    if (Object.hasOwn(fresh.properties, "selected")) {
      item.selectedPart ??= new litParts.PropertyPart(item.node, "selected", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
      const selected = litParts.getAttributePartCommittedValue(item.selectedPart, fresh.properties.selected);
      if (selected !== noChange) item.node.selected = Boolean(selected);
    }
    item.text = fresh.text; item.node.textContent = fresh.text; return item;
  };
  // Commit the existing retained native nodes before the renderer invokes
  // post-update ownership checks. Repairing them after draw() would expose
  // a transiently removed form to an otherwise current confirmation.
  f.renderer.collect = (markup, owner) => {
    const result = collect(markup, owner);
    if (!capturing || owner !== f.host) return result;
    const forms = actualForms(f); assert.equal(forms.length, captures.length); assert.ok(forms.length <= 1);
    if (!forms.length) {
      if (retained) { retained.form.isConnected = false; retained.select.isConnected = false; }
      retained = null; return result;
    }
    const form = forms[0], description = captures[0], tree = f.tree();
    // fullPageTree returns new tree nodes, so locate the same form in this tree.
    const currentForm = tree.visible("form").find(node => node.port === form.port); assert.ok(currentForm);
    const selects = tree.nodes.filter(node => within(node, currentForm) && node.tag === "select" && node.attributes.name === fieldName);
    assert.equal(selects.length, 1); const select = selects[0];
    if (retained && (retained.path !== description.path || retained.strings !== description.strings)) {
      retained.form.isConnected = false; retained.select.isConnected = false; retained = null;
    }
    retained ??= createSelect(form.port, select.port, description);
    const record = retained, optionNodes = tree.nodes.filter(node => within(node, select) && node.tag === "option");
    const literalCount = optionNodes.length - description.options.length;
    if (allowNoPlaceholder) assert.ok(literalCount === 0 || literalCount === 1, "Observe the actual zero-or-one literal option; never synthesize a Choose option.");
    else assert.equal(literalCount, 1, "One literal Choose option plus the actual rendered member templates.");
    if (literalCount) assert.equal(optionNodes[0].attributes.value, "");
    // fullPageTree's generic full-token lookup can alias identical literal
    // Choose options in sibling forms. Use their actual serialized node order
    // after this unique userId SELECT, not the first matching token elsewhere.
    const selectIndex = f.renderer.nodes.indexOf(select.port); assert.ok(selectIndex >= 0);
    const optionPorts = f.renderer.nodes.slice(selectIndex + 1).filter(node => node.owner === f.host && node.tag === "option").slice(0, optionNodes.length);
    assert.equal(optionPorts.length, optionNodes.length);
    for (const [index, node] of optionPorts.entries()) assert.equal(node.attributes.value, optionNodes[index].attributes.value);
    copyNode(form.port, record.form, f.host); copyNode(select.port, record.select, record.form);
    const previousOptions = record.options;
    const descriptions = literalCount ? [{ path: description.path + "/literal-placeholder", strings: description.strings }, ...description.options] : description.options;
    const next = optionNodes.map((option, index) => optionRecord({ ...option, port: optionPorts[index] }, descriptions[index], record));
    for (const old of previousOptions) if (!next.includes(old)) { old.node.isConnected = false; old.node.parentElement = null; }
    record.options = next;
    if (!next.some(option => option.node.selected)) {
      // Finite native single-select default. The C→D cases do not take this
      // branch: their selected node remains mounted while its value changes.
      const first = next.find(option => !Object.hasOwn(option.node.attributes, "disabled"));
      chooseNode(record, first?.node); fallbacks.push({ form: record.id, value: first?.node.value ?? "" });
    }
    if (Object.hasOwn(select.properties, "value")) {
      record.valuePart ??= new litParts.PropertyPart(record.select, "value", ["", ""], litParts.connectedDisconnectable({}), { host: f.host });
      const value = litParts.getAttributePartCommittedValue(record.valuePart, select.properties.value);
      if (value !== noChange) record.select.value = value;
    }
    const role = roleField ? tree.nodes.find(node => within(node, currentForm) && node.tag === "select" && node.attributes.name === "role") : null;
    if (roleField) assert.ok(role);
    record.form.elements = { namedItem: name => name === fieldName ? record.select : name === "role" ? role?.port ?? null : null };
    // Native FormData follows the currently selected OPTION's reflected value,
    // not a saved original userId map that would hide the suspected defect.
    f.forms.set(record.form, new Map([[fieldName, record.select.value], ...(role ? [["role", String(role.port.value || "viewer")]] : [])]));
    return result;
  };
  f.draw = () => {
    captures = []; capturing = true;
    try { return draw(); } finally { capturing = false; }
  };
  const current = () => { f.draw(); assert.ok(retained?.form.isConnected && retained.select.isConnected); return retained; };
  const choose = id => {
    const record = current(), options = record.options.filter(option => option.node.value === id);
    assert.equal(options.length, 1); assert.equal(Object.hasOwn(options[0].node.attributes, "disabled"), false);
    assert.equal(record.select.disabled, false); record.select.focus(); record.select.value = id;
    const event = { type: "change", target: record.select, currentTarget: record.select, preventDefault() {}, stopPropagation() {} };
    record.select.handlers.change?.call(f.host, event); f.draw();
    assert.equal(record.select.value, id); assert.equal(record.select.selectedOptions.length, 1);
    return { record, option: options[0] };
  };
  const observation = () => {
    const record = current();
    return { form: record.id, selectedIndex: record.select.selectedIndex, value: record.select.value,
      formDataValue: new FormData(record.form).get(fieldName), selectedNodes: record.select.selectedOptions.map(node => record.options.find(option => option.node === node).id),
      options: record.options.map(option => ({ node: option.id, path: option.path, value: option.node.value, text: option.text, selected: option.node.selected,
        disabled: Object.hasOwn(option.node.attributes, "disabled") })) };
  };
  return { current, choose, observation, records, commits, fallbacks };
}

async function fixture(t, locale, { memberRole = "member", selection = {}, section = "projects" } = {}) {
  const f = await settingsFixture(t, { locale, section }), service = f.service, originalReply = service.reply;
  const detail = structuredClone(originalReply({ url: endpoint("A"), init: {} }).body);
  const owner = detail.members.find(member => member.role === "owner"), sample = detail.members.find(member => member.role !== "owner");
  assert.ok(owner && sample);
  const members = Object.fromEntries(["B", "C", "D"].map(letter => [letter, { ...sample,
    membership_id: "finite-grant-member-" + letter, user_id: "finite-grant-user-" + letter,
    display_name: "Unique person " + letter, email: "person-" + letter.toLowerCase() + "@example.invalid", role: memberRole, status: "active" }]));
  detail.members = [owner, members.B, members.C, members.D];
  service.reply = request => {
    if (method(request) === "GET" && request.url === endpoint("A")) return { status: 200, body: structuredClone(detail) };
    if (method(request) === "GET" && request.url === endpoint("A", "/members")) return { status: 200,
      body: { organization: structuredClone(detail.organization), members: structuredClone(detail.members), invitations: [] } };
    const target = Object.values(members).find(member => request.url === endpoint("A", "/members/" + member.membership_id));
    if (method(request) === "DELETE" && target) {
      assert.equal(target.status, "active"); assert.equal(request.body, null);
      target.status = "revoked";
      const receipt = { ok: true }; service.writes.push({ method: "DELETE", url: request.url, body: null, receipt });
      return { status: 200, body: receipt }; // Explicit finite service, not real Worker authorization.
    }
    return originalReply(request);
  };
  // The caller names an actual task before any raw selection. Subsequent
  // refreshes retain that task and exact principal/source/template owner.
  f.navigate("B", section); await f.flush();
  f.navigate("A", section); await f.flush();
  const native = nativeGrantSelection(f, selection); f.draw();
  if (selection.allowNoPlaceholder) assert.deepEqual(native.current().options.filter(option => option.node.value !== "").map(option => option.node.value),
    [members.B.user_id, members.C.user_id, members.D.user_id]);
  else assert.deepEqual(native.current().options.map(option => option.node.value), ["", members.B.user_id, members.C.user_id, members.D.user_id]);
  assert.equal(new Set(native.current().options.filter(option => option.node.value !== "").map(option => option.text)).size, 3, "Unique visible names are a healthy identity prerequisite.");
  if(section==="members")assert.ok(f.nodes("table").some(table=>table.text.includes(members.B.email)),
    "Members really co-renders Revoke and Transfer.");
  else{
    assert.equal(section,"projects","The Grant fixture must enter its actual E task");
    assert.ok(f.privateText().includes(detail.projects[0].project_name),"Projects renders the exact current Grant destination");
  }
  return { f, service, detail, members, native };
}

export { fixture, snapshot, ancestor, endpoint, method };
