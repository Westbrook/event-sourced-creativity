import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { noChange } from "lit";
import { fullPageTree } from "./calm-full-page-fixture.mjs";

const { _$LH: parts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")));
const ancestor = (node, tag) => { for (let at = node.parent; at; at = at.parent) if (at.tag === tag) return at; return null; };

// Scoped native OPTION/value ports over the existing renderer, following the
// installed Editor/Delivery real Lit Parts mechanism. Identity is the actual
// owner/template/part path, never a Document/collection ID or saved selection.
export function installStudioNavigatorNative(t, x) {
  const { f, h } = x, owners = f.components().filter(owner => owner.tag === "forma-studio-navigator" && owner.store === h.store);
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner.isConnected); assert.equal(owner.closest("forma-creative-editor"), x.owner);
  const previousDraw = f.draw, previousValue = f.renderer.value;
  let capturing = false, template = null, descriptions = [], retained = new Map();
  const value = function(part, currentOwner, path, caches) {
    if (capturing && currentOwner === owner && part?.strings) {
      if (/^\s*<div class="studio-navigator"/u.test(part.strings[0])) template = { path, strings: part.strings };
      else if (/^\s*<option\b/u.test(part.strings[0])) descriptions.push({ path, strings: part.strings });
    }
    return previousValue.call(this, part, currentOwner, path, caches);
  };
  f.renderer.value = value;
  const copy = (fresh, node, parent) => {
    for (const key of ["full", "attributes", "properties", "propertyParts", "handlers"]) node[key] = fresh[key];
    node.parentElement = parent; node.isConnected = true; node.disabled = Object.hasOwn(fresh.attributes, "disabled");
    const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
  };
  const retire = record => { for (const node of [record.node, ...record.options.map(option => option.node)]) { node.isConnected = false; node.parentElement = null; } };
  const choose = (record, selected) => { for (const option of record.options) option.node.selected = option.node === selected; };
  const draw = () => {
    capturing = true; template = null; descriptions = []; let markup;
    try { markup = previousDraw(); } finally { capturing = false; }
    const tree = fullPageTree(f, markup), fields = tree.visible("select").filter(node => node.owner === owner);
    if (!owner.isConnected) { assert.equal(fields.length, 0); for (const record of retained.values()) retire(record); retained = new Map(); return markup; }
    assert.ok(template); assert.equal(fields.length, 2, "Only the actual collection and Document navigation selects");
    const options = tree.nodes.filter(node => node.owner === owner && node.tag === "option");
    assert.equal(options.length, descriptions.length + 2, "Two actual literal placeholders plus emitted dynamic OPTION templates");
    const optionDescriptions = new Map(); let dynamic = 0;
    for (const option of options) {
      const field = ancestor(option, "select"); assert.ok(fields.includes(field));
      optionDescriptions.set(option, option.attributes.value === ""
        ? { path: field.propertyParts.value + "/literal-placeholder", strings: template.strings }
        : descriptions[dynamic++]);
    }
    assert.equal(dynamic, descriptions.length);
    const next = new Map();
    for (const [index, fresh] of fields.entries()) {
      const name = index === 0 ? "collection" : "document", path = fresh.propertyParts.value;
      assert.equal(typeof path, "string"); assert.ok(ancestor(fresh, "form"));
      let record = retained.get(path);
      if (record && record.strings !== template.strings) { retire(record); record = null; }
      if (!record) {
        record = { name, path, strings: template.strings, node: fresh.port, options: [], valuePart: null };
        const select = record;
        Object.defineProperties(select.node, {
          options: { configurable: true, get: () => select.options.map(option => option.node) },
          selectedOptions: { configurable: true, get: () => select.options.filter(option => option.node.selected).map(option => option.node) },
          selectedIndex: { configurable: true, get: () => select.options.findIndex(option => option.node.selected) },
          value: { configurable: true, get: () => select.options.find(option => option.node.selected)?.node.value ?? "",
            set: input => { choose(select, select.options.find(option => option.node.value === String(input))?.node); } },
        });
      }
      assert.equal(record.name, name); copy(fresh.port, record.node, ancestor(fresh, "form").port);
      const actualOptions = options.filter(option => ancestor(option, "select") === fresh), oldOptions = record.options;
      assert.equal(actualOptions.filter(option => option.attributes.value === "").length, 1);
      record.options = actualOptions.map(option => {
        const description = optionDescriptions.get(option); assert.ok(description);
        let entry = oldOptions.find(previous => previous.path === description.path && previous.strings === description.strings);
        if (!entry) {
          entry = { ...description, node: option.port, valuePart: null }; entry.node.selected = Object.hasOwn(option.attributes, "selected");
          Object.defineProperty(entry.node, "value", { configurable: true, get: () => String(entry.node.attributes.value ?? ""),
            set: input => { entry.node.attributes.value = String(input); } });
        }
        const attributes = { ...entry.node.attributes }; copy(option.port, entry.node, record.node);
        entry.node.attributes = { ...option.attributes, value: attributes.value ?? "" };
        entry.valuePart ??= new parts.AttributePart(entry.node, "value", ["", ""], parts.connectedDisconnectable({}), { host: owner });
        const committed = parts.getAttributePartCommittedValue(entry.valuePart, option.attributes.value ?? "");
        if (committed !== noChange) entry.node.setAttribute("value", String(committed));
        entry.node.textContent = option.text; return entry;
      });
      for (const option of oldOptions) if (!record.options.includes(option)) { option.node.isConnected = false; option.node.parentElement = null; }
      if (!record.options.some(option => option.node.selected)) choose(record, record.options.find(option => !option.node.disabled)?.node);
      record.valuePart ??= new parts.PropertyPart(record.node, "value", ["", ""], parts.connectedDisconnectable({}), { host: owner });
      const committed = parts.getAttributePartCommittedValue(record.valuePart, fresh.properties.value);
      if (committed !== noChange) record.node.value = committed;
      next.set(path, record);
    }
    for (const [path, record] of retained) if (!next.has(path)) retire(record);
    retained = next; return markup;
  };
  f.draw = draw;
  t.after(() => { if (f.draw === draw) f.draw = previousDraw; if (f.renderer.value === value) f.renderer.value = previousValue; });
  const current = name => {
    f.draw(); const found = [...retained.values()].filter(record => record.name === name);
    assert.equal(found.length, 1); const record = found[0];
    assert.ok(owner.isConnected && record.node.isConnected && f.renderer.nodes.includes(record.node));
    assert.equal(record.node.matches(":disabled"), false); return record;
  };
  return { owner, current,
    values() { return Object.fromEntries(["collection", "document"].map(name => [name, current(name).node.value])); },
    async choose(name, id) {
      const record = current(name), matches = record.node.options.filter(option => option.value === id && !option.disabled);
      assert.equal(matches.length, 1); assert.ok(matches[0].isConnected);
      f.native.emit("pointerdown", record.node); f.native.focus(record.node);
      record.node.value = id; assert.deepEqual(record.node.selectedOptions, [matches[0]]);
      assert.equal(record.node.value, id); f.native.emit("change", record.node);
      const fields = f.tree().visible("select").filter(field => field.owner === owner && field.port === record.node);
      assert.equal(fields.length, 1); await f.act(fields[0], "change");
    },
  };
}
