import assert from "node:assert/strict";

// Shared finite native port for actual full-RendererPort consumers. The caller
// supplies its existing { f, h, after } fixture, never another Store or model.
// Opt-in native lifetime for each actual current ImageFormat child. Reuse the
// existing renderer's primitive .value committed-part rule. Nodes belong only
// to their exact owner and emitted outer/form TemplateResults; no raw cache.
export function installImageFormatNativeLifetime(x, original = null) {
  if (original) assert.ok(original.tag === "forma-image-format-editor" && original.store === x.h.store && original.isConnected);
  if (x.imageFormatNative) {
    if (original) { x.imageFormatNative.owner ??= original; assert.equal(x.imageFormatNative.owner, original); }
    return;
  }
  const { f } = x, draw = f.renderer.draw.bind(f.renderer), value = f.renderer.value.bind(f.renderer), collect = f.renderer.collect.bind(f.renderer);
  const NativeFormData = globalThis.FormData, forms = new WeakMap(), records = new Map(), descriptions = new Map(), seen = new Set();
  let drawing = false;
  const eligible = owner => owner?.tag === "forma-image-format-editor" && owner.store === x.h.store;
  const retire = owner => {
    const record = records.get(owner); if (!record) return;
    for (const node of record.nodes.values()) { node.isConnected = false; node.parentElement = null; }
    records.delete(owner);
  };
  f.renderer.value = (part, owner, path, caches) => {
    if (drawing && eligible(owner) && part?.strings) {
      const outer = part.strings[0].match(/^\s*<(details|section)\b/u);
      if (outer) descriptions.set(owner, { tag: outer[1], path, strings: part.strings, form: null });
      else {
        const description = descriptions.get(owner);
        if (description && path.startsWith(description.path + "/") && /^\s*<form\b/u.test(part.strings[0]))
          description.form = { path, strings: part.strings };
      }
    }
    return value(part, owner, path, caches);
  };
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    const description = descriptions.get(owner);
    if (!drawing || !eligible(owner) || !description) return;
    const own = f.renderer.nodes.slice(start), one = (tag, predicate = () => true) => {
      const matches = own.filter(node => node.tag === tag && predicate(node)); assert.equal(matches.length, 1); return matches[0];
    };
    const container = one(description.tag, node => node.classList.contains("image-format-control"));
    if (description.tag === "details") {
      assert.equal(Object.hasOwn(container.properties, "open"), false);
      assert.equal(Object.hasOwn(container.attributes, "open"), false, "Actual compact template does not bind or statically set open");
    }
    assert.ok(description.form, "Actual nested form TemplateResult was observed");
    const form = one("form", node => node.classList.contains("image-format-form"));
    assert.equal(typeof form.handlers.submit, "function");
    const fields = own.filter(node => ["input", "select"].includes(node.tag));
    assert.deepEqual(fields.map(node => node.attributes.name), ["preset", "width", "height"]);
    for (const field of fields) assert.equal(typeof field.propertyParts.value, "string", "Actual .value part identity is present");
    let record = records.get(owner);
    const same = record && record.store === owner.store && record.tag === description.tag
      && record.path === description.path && record.strings === description.strings
      && record.formPath === description.form.path && record.formStrings === description.form.strings
      && [...record.nodes.values()].every(node => node.isConnected);
    if (!same) { retire(owner); record = null; }
    if (!record) {
      record = { owner, store: owner.store, tag: description.tag, path: description.path, strings: description.strings,
        formPath: description.form.path, formStrings: description.form.strings, nodes: new Map(), fields: new Map() };
      records.set(owner, record);
    }
    const keep = (key, fresh, parent) => {
      let node = record.nodes.get(key);
      if (!node) { node = fresh; record.nodes.set(key, node); }
      const open = node.open;
      for (const property of ["full", "handlers", "properties", "propertyParts"]) node[property] = fresh[property];
      node.attributes = { ...fresh.attributes }; node.isConnected = true; node.parentElement = parent;
      node.disabled = Object.hasOwn(fresh.attributes, "disabled");
      if (Object.hasOwn(fresh.properties, "value")) {
        // collect() already compared this exact prior owner/part's committed
        // value. Preserve that result, not a second copy of canonical defaults.
        node.value = fresh.value; node.committedValue = fresh.committedValue;
      }
      if (fresh.tag === "details") {
        Object.defineProperty(node, "open", { configurable: true,
          get: () => Object.hasOwn(node.attributes, "open"),
          set: on => { if (on) node.attributes.open = ""; else delete node.attributes.open; } });
        node.open = open;
      }
      const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
      if (fresh !== node) fresh.isConnected = false;
      return node;
    };
    record.container = keep("container", container, owner);
    if (description.tag === "details") keep("summary", one("summary"), record.container);
    record.form = keep("form", form, record.container);
    const nextFields = new Map();
    for (const fresh of fields) {
      const node = keep("field:" + fresh.propertyParts.value, fresh, record.form);
      nextFields.set(fresh.attributes.name, node);
    }
    assert.equal(nextFields.size, 3); record.fields = nextFields;
    keep("submit", one("button", node => node.attributes.type === "submit"), record.form);
    record.form.elements = { namedItem: name => record.fields.get(name) ?? null };
    forms.set(record.form, record); seen.add(owner);
  };
  f.renderer.draw = (...args) => {
    drawing = true; descriptions.clear(); seen.clear();
    try { return draw(...args); }
    finally {
      drawing = false;
      for (const [owner, record] of records) if (!seen.has(owner) || !owner.isConnected
        || ![...record.nodes.values()].every(node => f.renderer.nodes.includes(node))) retire(owner);
    }
  };
  globalThis.FormData = class extends NativeFormData {
    constructor(form) {
      const record = form && forms.get(form);
      if (!record) { super(form); return; }
      super(); assert.ok(form.isConnected && records.get(record.owner) === record && record.owner.isConnected,
        "Only an exact current actual ImageFormat form can submit");
      for (const [name, node] of record.fields) {
        assert.ok(node.isConnected && node.parentElement === form);
        if (!node.matches(":disabled")) this.append(name, String(node.value));
      }
    }
  };
  x.after(() => { globalThis.FormData = NativeFormData; });
  x.imageFormatNative = { owner: original };
  f.draw();
}
