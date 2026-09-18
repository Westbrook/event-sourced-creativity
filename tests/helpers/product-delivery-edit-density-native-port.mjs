import assert from "node:assert/strict";
import { calmFullPageNativePorts as ports, fullPageTree } from "./calm-full-page-fixture.mjs";
import { nativeUpdateForms } from "./product-delivery-update-draft-fixture.mjs";

const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");

// Existing decisions use the single installed nativeUpdateForms owner, including
// actual Lit PropertyPart/noChange and actual repeat paths. This adapter owns
// only the separate, uncontrolled create form plus ordinary E reveal/input ports.
// No raw existing-decision copy or second dirty/revision registry is introduced.
// Hidden/inert and Cluster ancestry are structural, not physical DOM/AT/CSS proof.
export function nativeDeliveryForms(f) {
  const nativeFill = f.fill;
  nativeUpdateForms(f);
  f.renderer.registry["forma-ui-cluster"] = FormaUiCluster;
  const updateDraw = f.draw, renderValue = f.renderer.value.bind(f.renderer), query = f.renderer.query.bind(f.renderer);
  let create = null, capturing = false, createTemplates = [];
  // Exact committed Create query, as in the installed native-selection fixture.
  // These E cases retain their existing FormData port; the separate 17 current
  // Create cases and new label cases use unchanged full OPTION/Lit Parts.
  f.renderer.query = (owner, selector) => owner === f.host && selector === "form[data-delivery-create]"
    ? create?.node.isConnected && create.node.hasAttribute("data-delivery-create") ? [create.node] : []
    : query(owner, selector);
  f.renderer.value = (value, owner, at, caches) => {
    if (capturing && owner === f.host && value?.strings
      && value.values.some(item => typeof item === "function" && item.toString().includes("#create")))
      createTemplates.push({ path: at, strings: value.strings, template: value });
    return renderValue(value, owner, at, caches);
  };
  const createDefaults = template => {
    const markup = f.renderer.value(template, f.host, "density-create-defaults"), initial = {};
    const decode = text => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    for (const match of markup.matchAll(/<(input)\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\3>/gu)) {
      const tag = match[1] ?? match[3], parsed = f.renderer.attrs(match[2] ?? match[4]), name = parsed.attributes.name;
      if (!name) continue;
      assert.equal(Object.hasOwn(parsed.properties, "value"), false, "Only the original uncontrolled create form uses this adapter.");
      if (tag === "select") {
        const options = [...match[5].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gu)].map(option => {
          const item = f.renderer.attrs(option[1]);
          return { value: String(item.attributes.value ?? decode(option[2])),
            selected: Object.hasOwn(item.attributes, "selected") || item.properties.selected === true };
        });
        initial[name] = Object.hasOwn(parsed.attributes, "multiple") ? options.filter(option => option.selected).map(option => option.value)
          : (options.find(option => option.selected) ?? options[0])?.value ?? "";
      } else initial[name] = String(parsed.attributes.value ?? (tag === "textarea" ? decode(match[5]) : ""));
    }
    return initial;
  };
  const createValues = form => {
    const values = { dependencies: [] };
    for (const [name, value] of f.values(form)) {
      if (name === "dependencies") values.dependencies.push(value);
      else values[name] = value;
    }
    return values;
  };
  f.draw = () => {
    createTemplates = []; capturing = true;
    let markup;
    try { markup = updateDraw(); } finally { capturing = false; }
    const forms = f.renderer.ownNodes(f.host, "form").filter(node => node.handlers.submit?.toString().includes("#create"));
    assert.equal(forms.length, createTemplates.length, "Every actual create form has one emitted template; no synthetic owner.");
    assert.ok(forms.length <= 1, "One separate original create/retry owner.");
    if (!forms.length) {
      if (create) { create.node.isConnected = false; create.node.parentElement = null; }
      create = null; return markup;
    }
    const fresh = forms[0], entry = createTemplates[0];
    if (create && (create.path !== entry.path || create.strings !== entry.strings)) {
      create.node.isConnected = false; create.node.parentElement = null; create = null;
    }
    if (create) {
      Object.assign(create.node, { attributes: fresh.attributes, properties: fresh.properties, handlers: fresh.handlers,
        full: fresh.full, owner: fresh.owner, parentElement: fresh.parentElement, isConnected: true });
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = create.node;
    } else {
      const initial = createDefaults(entry.template);
      create = { node: fresh, path: entry.path, strings: entry.strings };
      nativeFill(fresh, initial);
      fresh.reset = () => { f.formResets += 1; nativeFill(fresh, initial); };
    }
    f.bindCreateFields(create.node);
    return markup;
  };
  const updateRecord = form => {
    const matches = f.updateRows().filter(record => record.form === form);
    assert.equal(matches.length, 1, "One existing current native update owner, not a copied draft record.");
    return matches[0];
  };
  f.form = (kind = "#create", decisionId = "") => {
    f.draw();
    if (kind === "#create") { assert.ok(create, "The original create/retry form is mounted."); return create.node; }
    assert.equal(kind, "#update");
    const matches = f.updateRows().filter(record => record.form.getAttribute("data-delivery-decision-id") === decisionId);
    assert.equal(matches.length, 1, "One mounted exact decision form.");
    return matches[0].form;
  };
  f.decisionForm = decisionId => f.form("#update", decisionId);
  f.currentFields = form => form.handlers.submit?.toString().includes("#create") ? createValues(form) : f.updateValues(updateRecord(form));
  f.fill = (form, values) => {
    if (form.handlers.submit?.toString().includes("#update")) f.editUpdate(updateRecord(form), values);
    else nativeFill(form, values);
  };
  f.draw();
  return f;
}

export function setDeliveryLocale(f, locale) {
  f.i18n.hostDisconnected(); f.locale = locale;
  const catalog = locale === "en" ? ports.FORMA_DEFAULT_MESSAGES : ports.localeCatalogs[locale];
  for (const key of ["delivery.editNamed", "delivery.hideEditNamed", "delivery.editDraftKept", "delivery.numberedName",
    "delivery.updateSavedDraftKept", "delivery.updateUnknown", "delivery.discardDraft", "delivery.unavailableOwner", "delivery.unavailableStatus"]) {
    assert.equal(typeof catalog[key], "string", "the actual " + locale + " catalog contains " + key);
  }
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
      messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: 1 }, () => {});
    return true;
  } });
  f.i18n.hostConnected(); f.host.i18n = f.i18n; f.draw();
}

export const deliveryTree = f => { f.draw(); return fullPageTree(f); };
export const deliveryRows = f => deliveryTree(f).nodes.filter(node => node.tag === "li" && Object.hasOwn(node.attributes, "data-delivery-decision-id"));
export const deliveryRow = (f, decisionId) => {
  const row = deliveryRows(f).find(node => node.attributes["data-delivery-decision-id"] === decisionId);
  assert.ok(row, "the exact current decision row exists"); return row;
};
export const within = (node, ancestor) => { for (let current = node; current; current = current.parent) if (current === ancestor) return true; return false; };

export async function toggleDeliveryEditor(f, decisionId) {
  const tree = deliveryTree(f);
  const button = tree.visible("button").find(node => node.attributes["data-delivery-editor-toggle"] === decisionId);
  assert.ok(button?.port?.isConnected, "the named current editor control is visible and connected");
  assert.equal(typeof button.port.handlers.click, "function");
  await button.port.handlers.click.call(f.host, { currentTarget: button.port, target: button.port, preventDefault() {} });
  return deliveryTree(f);
}

export function submitVisibleDeliveryForm(f, decisionId = "") {
  const tree = deliveryTree(f);
  const form = tree.visible("form").find(node => decisionId
    ? node.attributes["data-delivery-decision-id"] === decisionId
    : !Object.hasOwn(node.attributes, "data-delivery-decision-id") && node.handlers.submit?.toString().includes("#create"));
  assert.ok(form?.port?.isConnected, "submission starts from the current visible connected form");
  assert.equal(Object.hasOwn(form.attributes, "inert"), false);
  const submit = tree.visible("button").find(node => within(node, form) && node.attributes.type === "submit");
  assert.ok(submit, "this same form has a visible submit control");
  assert.equal(Object.hasOwn(submit.attributes, "disabled"), false, "the ordinary submit control is enabled");
  return f.submit(form.port);
}
