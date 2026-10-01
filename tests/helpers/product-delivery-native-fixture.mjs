import assert from "node:assert/strict";
import { createSceneStoreHost, untilScene } from "./scene-cost-store-host.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./calm-full-page-fixture.mjs";

// The actual loader supplies HTMLElement/Element, while these three Review
// instanceof checks resolve through the ambient realm. Keep distinct native
// classes shared by this module's live opt-in users; never alias every tag to
// ElementPort or infer class identity from a mutable node property.
const reviewNativeTypes = Object.freeze({
  button: class HTMLButtonElement extends ports.ElementPort {},
  form: class HTMLFormElement extends ports.ElementPort {},
  textarea: class HTMLTextAreaElement extends ports.ElementPort {},
});
let reviewNativeLease = null;
const sameDescriptor = (a, b) => a === undefined || b === undefined ? a === b
  : Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
const restoreNativeDescriptor = entry => {
  if (entry.original) Object.defineProperty(globalThis, entry.name, entry.original);
  else assert.ok(Reflect.deleteProperty(globalThis, entry.name), "remove the originally absent native constructor");
  assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(globalThis, entry.name), entry.original), "restore the exact original native descriptor");
};
function acquireReviewNativeTypes() {
  let state = reviewNativeLease;
  if (state) {
    if (state.phase !== "active") throw state.failure;
    for (const entry of state.entries) assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(globalThis, entry.name), entry.installed),
      "a live native constructor lease was changed by another owner");
  } else {
    const entries = Object.values(reviewNativeTypes).map(type => ({ name: type.name,
      original: Object.getOwnPropertyDescriptor(globalThis, type.name),
      installed: { value: type, configurable: true, writable: true, enumerable: false } }));
    // Snapshot every descriptor without invoking accessor values before the
    // first write. A failed installation grants no token and rolls back only
    // its attempted bindings, including a write that threw after committing.
    const attempted = [];
    try {
      for (const entry of entries) assert.ok(!entry.original || entry.original.configurable, "native constructor bindings must be restorable");
      for (const entry of entries) { attempted.push(entry); Object.defineProperty(globalThis, entry.name, entry.installed); }
      for (const entry of entries) assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(globalThis, entry.name), entry.installed), "install the exact native constructor descriptor");
    } catch (error) {
      const failures = [];
      for (const entry of attempted.reverse()) {
        try {
          const current = Object.getOwnPropertyDescriptor(globalThis, entry.name);
          assert.ok(sameDescriptor(current, entry.installed) || sameDescriptor(current, entry.original), "installation rollback cannot overwrite another owner");
          restoreNativeDescriptor(entry);
        } catch (failure) { failures.push(failure); }
      }
      if (!failures.length) throw error;
      const failure = new AggregateError([error, ...failures], "Native constructor installation rollback failed");
      reviewNativeLease = { phase: "quarantined", entries, tokens: new Set(), failure };
      throw failure;
    }
    state = { phase: "active", entries, tokens: new Set(), failure: null }; reviewNativeLease = state;
  }
  const token = Object.freeze({}); state.tokens.add(token);
  return () => {
    if (!state.tokens.has(token)) return;
    if (state.phase !== "active") throw state.failure;
    if (state.tokens.size > 1) { state.tokens.delete(token); return; }
    // The last token and the first snapshots remain retained until every
    // restore succeeds. An external mutation or partial failure quarantines
    // this lease instead of capturing altered globals as new originals.
    const failures = [];
    try {
      for (const entry of state.entries) assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(globalThis, entry.name), entry.installed),
        "native constructor restoration cannot overwrite another owner");
      for (const entry of [...state.entries].reverse()) {
        try { restoreNativeDescriptor(entry); } catch (error) { failures.push(error); }
      }
    } catch (error) { failures.push(error); }
    if (failures.length) {
      state.phase = "quarantined"; state.failure = new AggregateError(failures, "Native constructor restoration failed");
      throw state.failure;
    }
    state.tokens.delete(token); reviewNativeLease = null;
  };
}

// Whole current ProductDelivery + RoleDashboard + platform session; the Worker,
// schema and SQLite are the existing fixture. Only HTTP delivery and native
// form/template events are ports. This is not a browser or layout certificate.
export async function productDeliveryFixture(t, { maintenanceAdoption = false } = {}) {
  assert.equal(typeof maintenanceAdoption, "boolean");
  const fetchBefore = globalThis.fetch, formDataBefore = globalThis.FormData;
  const workerFixture = maintenanceAdoption
    ? await (await import("./experience-maintenance-operator-fixture.mjs")).createMaintenanceOperatorWorkerFixture() : null;
  let h;
  try { h = await createSceneStoreHost({ exposeSceneTestAccessors: false, workerFixture }); }
  catch (error) {
    try { workerFixture?.close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Operator Worker host setup failed"); }
    throw error;
  }
  const f = { store: h.store, storeHost: h, trace: [], clipboard: [], listeners: new Map(), changed: new Map(),
    requested: false, tick: async () => true, locale: "en", frames: new Map(), timers: new Map(), storage: new Map(),
    resizeTargets: new Map(), timerSequence: 0, calls: [], external: [], committed: [], loseNextCreate: "", formResets: 0 };
  if (maintenanceAdoption) Object.assign(f, { maintenanceMaterial: workerFixture.maintenanceMaterial, reviewer: workerFixture.reviewer });
  f.renderer = new ports.RendererPort(f, {});
  h.store.route.set("/product/delivery"); ports.bindFixture(f);
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC",
      messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs.en }, revision: 1 }, () => {}); return true;
  } }); f.i18n.hostConnected();
  const fields = new WeakMap(), materialRequests = new Set(), materialFailures = new Set();
  let expectedManagedDeliveryFailure = null;
  f.managedDeliveryFailures = [];
  f.expectManagedDeliveryFailure = error => {
    assert.ok(maintenanceAdoption && error instanceof Error, "one explicit operator delivery fault");
    assert.equal(expectedManagedDeliveryFailure, null, "the prior declared delivery fault must be consumed");
    expectedManagedDeliveryFailure = error;
  };
  const lookupEntries = new WeakMap(), installedRenderers = new WeakSet();
  const nativeNodes = new WeakMap(), wiredNativeNodes = new WeakSet(), emittedAttributes = new WeakMap();
  const pendingReviews = new Set(), scheduledReviews = new WeakSet();
  const styleBefore = ports.windowPort.getComputedStyle, activeElementBefore = ports.documentPort.activeElement;
  let parentPending = true, requestingReview = null;
  const retireNativeFocus = () => {
    const active = ports.documentPort.activeElement;
    if (maintenanceAdoption && nativeNodes.has(active) && !active.isConnected) ports.documentPort.activeElement = ports.documentPort.body;
  };
  const commitAttributes = (node, fresh) => {
    const previous = emittedAttributes.get(node), next = { ...fresh.attributes };
    if (previous) for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (Object.hasOwn(previous, name) === Object.hasOwn(next, name) && previous[name] === next[name]) continue;
      if (Object.hasOwn(next, name)) node.attributes[name] = next[name]; else delete node.attributes[name];
    }
    emittedAttributes.set(node, next);
  };
  const nativeVisibility = node => {
    const owned = nativeNodes.get(node);
    if (!owned || owned.renderer !== f.renderer || !owned.owner.isConnected || !owned.renderer.nodes.includes(node)) return { visibility: "hidden", opacity: "0" };
    let branch = null;
    for (let current = node; current; branch = current, current = current.parentElement) {
      if (!current.isConnected || Object.hasOwn(current.attributes ?? {}, "hidden")) return { visibility: "hidden", opacity: "0" };
      const supplied = styleBefore(current);
      if (supplied.display === "none" || ["hidden", "collapse"].includes(supplied.visibility)) return { visibility: "hidden", opacity: "0" };
      if (supplied.opacity !== undefined && Number(supplied.opacity) === 0) return { visibility: "visible", opacity: "0" };
      if (current.tag === "details" && !current.open) {
        const summary = owned.renderer.nodes.find(candidate => candidate.owner === owned.owner && candidate.parentElement === current && candidate.tag === "summary");
        if (branch !== summary) return { visibility: "hidden", opacity: "0" };
      }
      const inline = Object.fromEntries(String(current.attributes?.style ?? "").split(";").flatMap(declaration => {
        const colon = declaration.indexOf(":"); return colon < 0 ? [] : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]];
      }));
      const value = name => current.style?.[name] || inline[name] || "";
      if (value("display") === "none" || ["hidden", "collapse"].includes(value("visibility"))) return { visibility: "hidden", opacity: "0" };
      if (value("opacity") !== "" && Number(value("opacity")) === 0) return { visibility: "visible", opacity: "0" };
    }
    return { visibility: "visible", opacity: "1" };
  };
  if (maintenanceAdoption) {
    Object.defineProperty(f, "requested", { configurable: true, enumerable: true,
      get: () => parentPending || pendingReviews.size > 0,
      set: value => {
        if (value) { if (requestingReview) pendingReviews.add(requestingReview); else parentPending = true; }
        else { parentPending = false; pendingReviews.clear(); }
      } });
    // Only Review has a constant outer mount and commits its inner view from
    // updated(). Parent requests still run the original whole-host renderer.
    f.flushReviewUpdate = () => {
      ports.bindFixture(f);
      if (parentPending || !f.renderer.markup) return false;
      const current = [];
      for (const owner of [...pendingReviews]) {
        if (!owner.isConnected || ![...f.renderer.instances.values()].some(record => record.instance === owner)) pendingReviews.delete(owner);
        else current.push(owner);
      }
      if (!current.length) return false;
      for (const owner of current) owner.updated();
      retireNativeFocus(); return true;
    };
  }
  const scheduleReview = owner => {
    if (!maintenanceAdoption || scheduledReviews.has(owner)) return;
    scheduledReviews.add(owner);
    const requestUpdate = owner.requestUpdate, updated = owner.updated, dispatchEvent = owner.dispatchEvent;
    // Only the two genuine Review save events need this existing EventPart's
    // synchronous native identity. This is not general DOM event propagation.
    owner.dispatchEvent = function (...args) {
      const event = args[0];
      if (!["experience-proposal-saved", "experience-operation-saved"].includes(event?.type))
        return Reflect.apply(dispatchEvent, this, args);
      assert.equal(this, owner, "the actual Review dispatches its own saved event");
      const identities = ["target", "currentTarget"];
      for (const name of identities) {
        assert.equal(Object.getOwnPropertyDescriptor(event, name), undefined, "no foreign or reentrant event identity");
        assert.equal(event[name], null, "only an undispatched native saved event");
      }
      let result, failed = false, failure;
      const cleanupFailures = [];
      try {
        for (const name of identities) Object.defineProperty(event, name, { configurable: true, value: this });
        result = Reflect.apply(dispatchEvent, this, args);
      } catch (error) { failed = true; failure = error; }
      finally {
        for (const name of identities) try {
          assert.ok(Reflect.deleteProperty(event, name), "remove the temporary dispatch identity");
          assert.equal(Object.getOwnPropertyDescriptor(event, name), undefined, "restore the exact absent own descriptor");
        } catch (error) { cleanupFailures.push(error); }
      }
      if (failed) throw failure; // Preserve the original thrown value, including undefined.
      if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "Native saved-event identity restoration failed");
      return result;
    };
    owner.requestUpdate = function (...args) {
      const previous = requestingReview; requestingReview = owner;
      try { return requestUpdate.apply(this, args); } finally { requestingReview = previous; }
    };
    owner.updated = function (...args) {
      pendingReviews.delete(owner); // New requests made during the commit remain pending.
      try { return updated.apply(this, args); } finally { retireNativeFocus(); }
    };
  };
  // Full Platform later replaces this fixture's renderer. Install the same
  // finite native port on each actual instance, never on the shared prototype.
  const installReviewForms = renderer => {
    assert.ok(renderer instanceof ports.RendererPort && renderer.fixture === f);
    if (installedRenderers.has(renderer)) return;
    installedRenderers.add(renderer);
    const query = renderer.query.bind(renderer), collect = renderer.collect.bind(renderer), slots = new WeakMap(), operatorSlots = new WeakMap();
    const owns = owner => f.renderer === renderer && owner?.fixture === f && owner.isConnected
      && owner.tag === "forma-experience-review" && typeof renderer.registry[owner.tag] === "function"
      && owner instanceof renderer.registry[owner.tag];
    const durableMarkers = ["data-experience-maintenance", "data-experience-adoption", "data-experience-acknowledgment"];
    const nativeSelectors = new Set([...durableMarkers, "data-experience-adoption-load", "data-experience-adoption-reset",
      "data-experience-maintenance-load", "data-experience-maintenance-preview"].map(marker => `[${marker}]`));
    const templateParts = new WeakMap(), durableSlots = new WeakMap();
    if (maintenanceAdoption) {
      const value = renderer.value.bind(renderer), draw = renderer.draw.bind(renderer);
      renderer.value = (template, owner, path, caches) => {
        if (owns(owner) && template?.strings) {
          let parts = templateParts.get(owner); if (!parts) { parts = new Map(); templateParts.set(owner, parts); }
          for (const marker of durableMarkers) if (template.strings.some(text => new RegExp(`\\b${marker}(?=[\\s=>])`, "u").test(text)))
            parts.set(marker, { strings: template.strings, path });
        }
        return value(template, owner, path, caches);
      };
      renderer.draw = (...args) => { try { return draw(...args); } finally { retireNativeFocus(); } };
    }
    const part = (node, attribute, owner) => {
      const token = [...node.full.matchAll(/\s([?@][\w-]+)=(?:["'])?__bound_([0-9]+)__(?:["'])?(?=[\s>])/gu)]
        .find(match => match[1] === attribute);
      const binding = token ? renderer.bindings[Number(token[2])] : null;
      assert.ok(binding?.owner === owner && typeof binding.part === "string", "exact actual Review EventPart/BooleanAttributePart");
      return binding;
    };
    const present = node => renderer.nodes.includes(node) || (renderer.previousNodes ?? []).includes(node);
    renderer.query = (owner, selector) => {
      if (maintenanceAdoption && owner?.tag === "forma-experience-review" && nativeSelectors.has(selector)) {
        if (!owns(owner)) return [];
        return (renderer.updatingOwner ? renderer.previousNodes ?? [] : renderer.nodes)
          .filter(node => node.owner === owner && node.isConnected && Object.hasOwn(node.attributes, selector.slice(1, -1)));
      }
      if (owner?.tag !== "forma-experience-review" || !selector.startsWith("form") || !selector.includes("data-experience-")) return query(owner, selector);
      const plain = /^form\[(data-experience-(?:publication-lookup|patch))\]$/u.exec(selector);
      const keyed = /^form\[(data-experience-(proposal|action))\]\[data-experience-\2-owner="([0-9]+)"\]$/u.exec(selector);
      const adoption = /^form\[(data-experience-adoption-proposal)\]\[data-experience-adoption-owner="([0-9]+)"\]$/u.exec(selector);
      assert.ok(plain || keyed || adoption, "only the exact current Review form selectors are ported");
      if (!owns(owner)) return [];
      const marker = plain?.[1] ?? keyed?.[1] ?? adoption[1], matches = node => node.owner === owner && node.tag === "form"
        && Object.hasOwn(node.attributes, marker) && (!keyed || String(node.attributes[marker + "-owner"]) === keyed[3])
        && (!adoption || String(node.attributes["data-experience-adoption-owner"]) === adoption[2]);
      const nodes = renderer.updatingOwner ? renderer.previousNodes ?? [] : renderer.nodes;
      let selected = nodes.filter(node => node.isConnected && matches(node));
      // The outer native render temporarily detaches inner nodes before
      // updated(). The same actual mount still owns its committed lookup.
      const slot = marker === "data-experience-publication-lookup" ? slots.get(owner) : operatorSlots.get(owner)?.get(marker);
      const mount = query(owner, "[data-experience-review-mount]")[0];
      if (!selected.length && slot && slot.mount === mount && mount?.isConnected && present(slot.form)
        && (slot.input ? present(slot.input) : slot.fields.every(field => present(field.node))) && matches(slot.form)) selected = [slot.form];
      assert.ok(selected.length <= 1, "one exact owned Review form");
      return selected;
    };
    // Only these actual current Review forms are added to the native port. The
    // original publication lookup below remains on its existing implementation.
    const schemas = {
      "data-experience-patch": [["layout", "select"]],
      "data-experience-proposal": [["title", "input"], ["ownerUserId", "select"], ["evidence", "textarea"]],
      "data-experience-action": [["evidence", "textarea"], ["status", "select"]],
      "data-experience-adoption-proposal": [["nomination", "select"], ["title", "input"], ["ownerUserId", "select"], ["evidence", "textarea"]],
    };
    const collectOperatorForms = (markup, owner) => {
      if (!maintenanceAdoption || !markup.includes('class="experience-review"')) return;
      const tree = fullPageTree({ ...f, renderer, host: owner }, markup), mount = query(owner, "[data-experience-review-mount]")[0];
      assert.ok(mount?.isConnected);
      let owned = operatorSlots.get(owner); if (!owned) { owned = new Map(); operatorSlots.set(owner, owned); }
      const replacements = new Map();
      const within = (node, ancestor) => { for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true; return false; };
      const retire = slot => { for (const node of [slot.form, ...slot.fields.map(field => field.node)]) { node.isConnected = false; node.parentElement = null; } };
      for (const [marker, schema] of Object.entries(schemas)) {
        const forms = tree.nodes.filter(node => node.owner === owner && node.tag === "form" && Object.hasOwn(node.attributes, marker));
        assert.ok(forms.length <= 1, "one actual " + marker + " form");
        let slot = owned.get(marker);
        if (!forms.length) { if (slot) retire(slot); owned.delete(marker); continue; }
        const description = forms[0], form = description.port, submit = part(form, "@submit", owner);
        assert.equal(submit.value, form.handlers.submit);
        const epochAttribute = marker === "data-experience-adoption-proposal" ? "data-experience-adoption-owner"
          : marker === "data-experience-patch" ? null : marker + "-owner";
        const epoch = epochAttribute ? String(form.attributes[epochAttribute]) : null;
        if (epochAttribute) assert.match(epoch, /^[0-9]+$/u);
        const controls = tree.nodes.filter(node => node.owner === owner && within(node, description) && ["input", "textarea", "select"].includes(node.tag));
        assert.deepEqual(controls.map(node => [node.attributes.name, node.tag]), schema, "only current declared successful controls are ported");
        assert.ok(controls.every(node => node.port && !Object.hasOwn(node.attributes, "form") && !Object.hasOwn(node.attributes, "multiple")));
        const retained = slot && slot.mount === mount && slot.submitPart === submit.part && slot.epoch === epoch
          && (renderer.previousNodes ?? []).includes(slot.form) && slot.fields.every(field => (renderer.previousNodes ?? []).includes(field.node));
        if (!retained) {
          if (slot) retire(slot);
          slot = { form, mount, submitPart: submit.part, epoch, fields: [] }; owned.set(marker, slot);
        }
        replacements.set(form, slot.form);
        for (const [index, control] of controls.entries()) {
          const node = control.port, name = schema[index][0], tag = control.tag;
          const options = tag === "select" ? tree.nodes.filter(row => row.owner === owner && row.tag === "option" && within(row, control)).map(row => ({
            value: String(row.attributes.value ?? row.text ?? ""), disabled: Object.hasOwn(row.attributes, "disabled"),
            defaultSelected: Object.hasOwn(row.attributes, "selected"),
            selected: Object.hasOwn(row.properties, "selected") ? Boolean(row.properties.selected) : Object.hasOwn(row.attributes, "selected"),
          })) : [];
          assert.equal(new Set(options.map(option => option.value)).size, options.length, "finite Review selections have unique emitted values");
          const selected = options.filter(option => option.selected); assert.ok(selected.length <= 1);
          const selectedValue = (selected[0] ?? options.find(option => !option.disabled))?.value ?? "";
          const selection = JSON.stringify(options.map(({ value, selected, defaultSelected }) => ({ value, selected, defaultSelected })));
          const controlled = Object.hasOwn(control.properties, "value") ? String(control.properties.value) : null;
          const disabled = Object.hasOwn(node.attributes, "disabled"), defaultValue = String(control.attributes.value ?? (tag === "textarea" ? control.text ?? "" : ""));
          let field = slot.fields[index];
          if (!retained) {
            field = { node, name, tag, options, defaultValue, value: tag === "select" ? selectedValue : controlled ?? defaultValue,
              committedValue: controlled, committedDisabled: disabled, committedSelection: selection, customValidity: "" };
            slot.fields.push(field);
            Object.defineProperties(node, {
              value: { configurable: true, get: () => field.value, set: value => { const next = String(value); field.value = tag === "select" && !field.options.some(option => option.value === next) ? "" : next; } },
              defaultValue: { configurable: true, get: () => field.defaultValue, set: value => { field.defaultValue = String(value); } },
              name: { configurable: true, get: () => String(node.attributes.name ?? ""), set: value => { node.attributes.name = String(value); } },
              disabled: { configurable: true, get: () => Object.hasOwn(node.attributes, "disabled"), set: value => { if (value) node.attributes.disabled = ""; else delete node.attributes.disabled; } },
              form: { configurable: true, get: () => slot.form },
            });
            node.removeAttribute = attribute => { delete node.attributes[attribute]; };
            node.setCustomValidity = value => { field.customValidity = String(value); };
          } else {
            replacements.set(node, field.node);
            for (const key of ["full", "handlers", "properties", "propertyParts"]) field.node[key] = node[key];
            if (controlled !== null && controlled !== field.committedValue) field.node.value = controlled;
            if (disabled !== field.committedDisabled) field.node.disabled = disabled;
            field.options = options;
            if (tag === "select" && selection !== field.committedSelection) field.node.value = selectedValue;
            field.committedValue = controlled; field.committedDisabled = disabled; field.committedSelection = selection;
            renderer.nodes[renderer.nodes.indexOf(node)] = field.node; node.isConnected = false;
          }
        }
        if (retained) {
          commitAttributes(slot.form, form);
          for (const key of ["full", "handlers", "properties", "propertyParts"]) slot.form[key] = form[key];
          renderer.nodes[renderer.nodes.indexOf(form)] = slot.form; form.isConnected = false;
        }
        slot.form.elements = { namedItem: name => {
          const found = slot.fields.filter(field => field.node.name !== "" && field.node.name === name);
          assert.ok(found.length <= 1, "only a unique current Review named control is requested"); return found[0]?.node ?? null;
        } };
        slot.form.reset = () => { for (const field of slot.fields) field.node.value = field.tag === "select"
          ? (field.options.find(option => option.defaultSelected) ?? field.options.find(option => !option.disabled))?.value ?? "" : field.defaultValue; };
        const invalid = () => slot.fields.find(field => !field.node.disabled && (field.customValidity
          || Object.hasOwn(field.node.attributes, "required") && field.node.value === ""));
        slot.form.checkValidity = () => !invalid();
        slot.form.reportValidity = () => { const field = invalid(); if (field) field.node.focus(); return !field; };
        lookupEntries.set(slot.form, () => slot.fields.flatMap(field => field.node.disabled || field.node.name === ""
          || field.tag === "select" && !field.options.some(option => option.value === field.node.value && !option.disabled)
          ? [] : [[field.node.name, field.node.value]]));
        slot.form.isConnected = true;
      }
      let retained = durableSlots.get(owner); if (!retained) { retained = new Map(); durableSlots.set(owner, retained); }
      const seen = new Set();
      for (const description of tree.nodes.filter(node => node.owner === owner && node.port)) {
        const fresh = description.port, marker = durableMarkers.find(name => Object.hasOwn(description.attributes, name));
        let identity = marker ? templateParts.get(owner)?.get(marker) : null, form = null, key = marker;
        if (description.tag === "button") {
          let ancestor = description.parent; while (ancestor && ancestor.tag !== "form") ancestor = ancestor.parent;
          form = ancestor ? replacements.get(ancestor.port) ?? ancestor.port : null;
          const attribute = typeof fresh.handlers.click === "function" ? "@click" : form ? "?disabled" : null;
          if (attribute) {
            const binding = part(fresh, attribute, owner);
            const position = attribute !== "@click" && form
              ? tree.nodes.filter(node => node.owner === owner && node.tag === "button" && within(node, ancestor)).indexOf(description) : null;
            key = "button:" + binding.part; identity = { strings: null, path: binding.part, position };
          }
        }
        if (!identity) continue;
        assert.ok(!seen.has(key), "one exact Review native template/control part"); seen.add(key);
        let previous = retained.get(key);
        if (!previous || previous.mount !== mount || previous.identity.strings !== identity.strings || previous.identity.path !== identity.path
          || previous.identity.position !== identity.position || previous.form !== form || !(renderer.previousNodes ?? []).includes(previous.node)) previous = null;
        const node = previous?.node ?? fresh;
        if (previous) {
          commitAttributes(node, fresh);
          for (const name of ["full", "handlers", "properties", "propertyParts"]) node[name] = fresh[name];
          renderer.nodes[renderer.nodes.indexOf(fresh)] = node; fresh.isConnected = false;
        }
        replacements.set(fresh, node); node.isConnected = true;
        retained.set(key, { node, identity, mount, form });
      }
      for (const [key, previous] of retained) if (!seen.has(key)) { previous.node.isConnected = false; previous.node.parentElement = null; retained.delete(key); }
      // Resolve every retained section/form/field/button in one ancestry pass.
      // DETAILS keeps its native open state when its actual template survives.
      for (const description of tree.nodes.filter(node => node.owner === owner && node.port)) {
        const node = replacements.get(description.port) ?? description.port;
        let ancestor = description.parent; while (ancestor && !ancestor.port) ancestor = ancestor.parent;
        node.parentElement = replacements.get(ancestor?.port) ?? ancestor?.port ?? mount; node.isConnected = true;
        nativeNodes.set(node, { renderer, owner });
        const nativeType = Object.hasOwn(reviewNativeTypes, description.tag) ? reviewNativeTypes[description.tag] : null;
        if (nativeType) {
          const prototype = Object.getPrototypeOf(node);
          assert.ok(prototype === ports.ElementPort.prototype || prototype === nativeType.prototype, "only the parsed authored native type is branded");
          if (prototype !== nativeType.prototype) Object.setPrototypeOf(node, nativeType.prototype);
        }
        if (!emittedAttributes.has(node)) emittedAttributes.set(node, { ...description.attributes });
        if (wiredNativeNodes.has(node)) continue;
        wiredNativeNodes.add(node);
        if (node.tag === "details") Object.defineProperty(node, "open", { configurable: true,
          get: () => Object.hasOwn(node.attributes, "open"), set: value => { if (value) node.attributes.open = ""; else delete node.attributes.open; } });
        if (["button", "input", "select", "textarea"].includes(node.tag) && !Object.getOwnPropertyDescriptor(node, "disabled")?.get)
          Object.defineProperty(node, "disabled", { configurable: true,
            get: () => Object.hasOwn(node.attributes, "disabled"), set: value => { if (value) node.attributes.disabled = ""; else delete node.attributes.disabled; } });
        const querySelector = node.querySelector, closest = node.closest;
        node.querySelector = selector => nativeSelectors.has(selector)
          ? renderer.nodes.find(candidate => candidate.owner === owner && candidate !== node && candidate.isConnected
            && node.contains(candidate) && Object.hasOwn(candidate.attributes, selector.slice(1, -1))) ?? null : querySelector.call(node, selector);
        node.closest = selector => {
          if (selector === "form") {
            for (let current = node; current; current = current.parentElement) if (current.tag === "form") return current;
            return null;
          }
          if (selector === "[hidden], [inert], details:not([open])") {
            for (let current = node; current; current = current.parentElement)
              if (Object.hasOwn(current.attributes ?? {}, "hidden") || Object.hasOwn(current.attributes ?? {}, "inert") || current.tag === "details" && !current.open) return current;
            return null;
          }
          return closest.call(node, selector);
        };
        node.focus = () => {
          if (!owns(owner) || !node.isConnected || !renderer.nodes.includes(node) || node.disabled) return;
          const focusable = ["button", "input", "select", "textarea", "summary"].includes(node.tag)
            || node.tag === "a" && Object.hasOwn(node.attributes, "href") || Object.hasOwn(node.attributes, "tabindex");
          const style = ports.windowPort.getComputedStyle(node);
          if (!focusable || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return;
          for (let current = node; current; current = current.parentElement) if (Object.hasOwn(current.attributes ?? {}, "inert")) return;
          ports.documentPort.activeElement = node; f.trace.push("focus:" + (node.attributes.class ?? node.tag));
          for (const handler of [...(f.listeners.get("focusin") ?? [])]) handler({ type: "focusin", target: node });
        };
      }
      retireNativeFocus();
    };
    renderer.collect = (markup, owner) => {
      const result = collect(markup, owner);
      if (!owns(owner)) return result;
      scheduleReview(owner);
      if (!markup.includes("data-experience-publication-lookup")) { collectOperatorForms(markup, owner); return result; }
      const tree = fullPageTree({ ...f, renderer, host: owner }, markup);
      const forms = tree.nodes.filter(node => node.owner === owner && node.tag === "form"
        && Object.hasOwn(node.attributes, "data-experience-publication-lookup"));
      assert.equal(forms.length, 1, "one actual lookup form, including closed details");
      const description = forms[0], form = description.port;
      const within = node => { for (let current = node.parent; current; current = current.parent) if (current === description) return true; return false; };
      const controls = tree.nodes.filter(node => node.owner === owner && within(node) && ["input", "textarea", "select"].includes(node.tag));
      assert.equal(controls.length, 1); const field = controls[0], input = field.port;
      assert.ok(form && input && field.tag === "input" && field.attributes.name === "publicationId"
        && !Object.hasOwn(field.attributes, "form") && !Object.hasOwn(field.properties, "value"));
      const submit = part(form, "@submit", owner), disabledPart = part(input, "?disabled", owner);
      assert.equal(submit.value, form.handlers.submit);
      assert.equal(typeof disabledPart.value, "boolean");
      const mount = query(owner, "[data-experience-review-mount]")[0]; assert.ok(mount?.isConnected);
      let slot = slots.get(owner);
      const retained = slot && slot.mount === mount && slot.submitPart === submit.part && slot.inputPart === disabledPart.part
        && (renderer.previousNodes ?? []).includes(slot.form) && (renderer.previousNodes ?? []).includes(slot.input);
      const disabled = Object.hasOwn(input.attributes, "disabled");
      if (!retained) {
        slot = { form, input, mount, submitPart: submit.part, inputPart: disabledPart.part,
          committedDisabled: disabled, defaultValue: String(field.attributes.value ?? "") };
        let value = String(input.value ?? "");
        Object.defineProperties(input, {
          value: { configurable: true, get: () => value, set: next => { value = String(next); } },
          name: { configurable: true, get: () => String(input.attributes.name ?? ""), set: next => { input.attributes.name = String(next); } },
          disabled: { configurable: true, get: () => Object.hasOwn(input.attributes, "disabled"), set: next => { if (next) input.attributes.disabled = ""; else delete input.attributes.disabled; } },
          form: { configurable: true, get: () => form },
        });
        input.removeAttribute = name => { delete input.attributes[name]; };
        form.elements = { namedItem: name => input.name === name && name !== "" ? input : null };
        form.reset = () => { input.value = slot.defaultValue; };
        lookupEntries.set(form, () => !input.disabled && input.name !== "" ? [[input.name, input.value]] : []);
        slots.set(owner, slot);
      } else {
        for (const key of ["full", "handlers", "properties", "propertyParts"]) { slot.form[key] = form[key]; slot.input[key] = input[key]; }
        if (maintenanceAdoption) commitAttributes(slot.form, form); else slot.form.attributes = form.attributes;
        // An unchanged boolean part does not overwrite deliberate native IDL
        // changes. A changed actual ?disabled binding still commits normally.
        if (slot.committedDisabled !== disabled) slot.input.disabled = disabled;
        slot.committedDisabled = disabled;
        renderer.nodes[renderer.nodes.indexOf(form)] = slot.form;
        renderer.nodes[renderer.nodes.indexOf(input)] = slot.input;
        form.isConnected = false; input.isConnected = false;
      }
      slot.form.isConnected = true; slot.form.parentElement = owner;
      slot.input.isConnected = true; slot.input.parentElement = slot.form;
      collectOperatorForms(markup, owner);
      return result;
    };
  };
  let currentRenderer = f.renderer;
  Object.defineProperty(f, "renderer", { configurable: true, enumerable: true,
    get: () => currentRenderer, set: renderer => { installReviewForms(renderer); currentRenderer = renderer; if (maintenanceAdoption) parentPending = true; } });
  let releaseNativeTypes = null, cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    const failures = [], attempt = async action => { try { await action(); } catch (error) { failures.push(error); } };
    try {
    await attempt(() => ports.bindFixture(f));
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
      await attempt(() => { instance.isConnected = false; instance.disconnectedCallback(); });
    }
    await attempt(() => { if (f.host) { f.host.isConnected = false; f.host.disconnectedCallback(); } });
    await attempt(() => f.platformSession?.reset()); await attempt(() => f.i18n.hostDisconnected());
    // Every admitted new material read is observed before closing its real DB.
    // This does not claim global quiescence or alter the older delivery gates.
    await attempt(async () => {
      for (const outcome of await Promise.allSettled([...materialRequests])) if (outcome.status === "rejected"
        && !f.managedDeliveryFailures.some(failure => failure.error === outcome.reason)) materialFailures.add(outcome.reason);
      failures.push(...materialFailures);
      assert.equal(materialRequests.size, 0, "retired review starts no further material read");
      assert.equal(expectedManagedDeliveryFailure, null, "every declared operator delivery fault was actually observed");
    });
    await attempt(() => { globalThis.fetch = fetchBefore; }); await attempt(() => { globalThis.FormData = formDataBefore; });
    if (maintenanceAdoption) {
      await attempt(() => { ports.windowPort.getComputedStyle = styleBefore; });
      await attempt(() => { ports.documentPort.activeElement = activeElementBefore; });
    }
    } catch (error) { failures.push(error); }
    finally {
      await attempt(() => releaseNativeTypes?.());
      await attempt(() => h.close()); await attempt(() => assert.deepEqual(f.external, [], "no external/provider request"));
    }
    if (failures.length) throw new AggregateError(failures, "Product native fixture teardown failed");
  })();
  t.after(cleanup);
  try {
  if (maintenanceAdoption) releaseNativeTypes = acquireReviewNativeTypes();
  if (maintenanceAdoption) ports.windowPort.getComputedStyle = node => {
    const style = styleBefore(node), owned = nativeNodes.get(node);
    if (owned?.renderer !== f.renderer) return style;
    const visible = nativeVisibility(node);
    // Finite native visibility, not a CSS/layout/viewport measurement. Existing
    // supplied style blockers remain blockers; foreign nodes keep their port.
    return { ...style, visibility: style.visibility && style.visibility !== "visible" ? style.visibility : visible.visibility,
      opacity: style.opacity !== undefined && Number(style.opacity) === 0 ? "0" : visible.opacity };
  };
  installReviewForms(currentRenderer);
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
    constructor(form) {
      const lookup = lookupEntries.get(form);
      if (lookup) this.entries = lookup().map(entry => [...entry]);
      else { assert.ok(fields.has(form), "only an actual selected form uses this native FormData port"); this.entries = [...fields.get(form)]; }
    }
    get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
    getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
  };
  const reviewEndpoint = "/api/portfolio/product/experiences";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const managedRequest = (url, method) => {
    if (!maintenanceAdoption || !url.startsWith(reviewEndpoint + "/")) return false;
    const parsed = new URL(url, "http://localhost"), path = parsed.pathname.slice(reviewEndpoint.length);
    if (parsed.origin !== "http://localhost" || parsed.hash || parsed.pathname + parsed.search !== url) return false;
    const query = [...parsed.searchParams], none = query.length === 0;
    if (method === "POST") return none && ["/preview", "/maintenance/preview", "/maintenance/adoption-proposals", "/maintenance/adoptions"].includes(path);
    if (method !== "GET") return false;
    if (["/materials/detail", "/materials/maintenance", "/maintenance/adoption-nominations"].includes(path)) {
      const selected = f.maintenanceMaterial.selection, keys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"];
      return query.length === keys.length && keys.every(key => parsed.searchParams.getAll(key).length === 1 && parsed.searchParams.get(key) === selected[key]);
    }
    if (path === "/heads/model3d") return query.length === 1 && parsed.searchParams.get("channel") === "managed-fixture";
    if (!none) return false;
    const decision = /^\/maintenance\/adoption-decisions\/([^/]+)$/u.exec(path);
    if (decision) {
      const id = decodeURIComponent(decision[1]);
      return encodeURIComponent(id) === decision[1] && id.startsWith("experience-maintenance:v1:") && uuid.test(id.slice("experience-maintenance:v1:".length));
    }
    const original = /^\/maintenance\/adoption-operations\/(maintenance-proposal|maintenance-transition|maintenance-adoption)\/([^/]+)$/u.exec(path);
    return Boolean(original && uuid.test(original[2]));
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET";
    if (!url.startsWith("/api/")) { f.external.push(url); throw new Error("External/provider transport is forbidden"); }
    const materialRead = url === "/api/portfolio/product/experiences/materials";
    const managed = managedRequest(url, method);
    assert.ok(url === "/api/session?audience=product" || url === "/api/portfolio/product/delivery" || materialRead || managed, "exact Product service paths only");
    if (materialRead) assert.equal(method, "GET", "only the actual default-registry inventory is admitted");
    else assert.ok(["GET", "POST", "PATCH"].includes(method));
    const call = { url, method, body: init.body ? JSON.parse(init.body) : null }; f.calls.push(call);
    const maintenanceTransition = maintenanceAdoption && url === "/api/portfolio/product/delivery" && method === "PATCH"
      && call.body !== null && Object.hasOwn(call.body, "maintenanceAdoption");
    if (materialRead || managed || maintenanceTransition) {
      // Default inventory keeps its original delivery behavior. The opt-in
      // operator joins actual managed reads/commands and their response hold,
      // including the original Worker response after its genuine DB commit.
      const pending = (async () => {
        let response;
        try { response = await h.worker.request(url, init); }
        catch (error) { materialFailures.add(error); throw error; }
        try { return maintenanceAdoption && f.deliver ? await f.deliver(call, response) : response; }
        catch (error) {
          if (expectedManagedDeliveryFailure !== null && error === expectedManagedDeliveryFailure) {
            expectedManagedDeliveryFailure = null;
            f.managedDeliveryFailures.push({ call, error });
          } else materialFailures.add(error);
          throw error;
        }
      })(); materialRequests.add(pending);
      try { return await pending; }
      finally { materialRequests.delete(pending); }
    }
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
  const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");
  const { FormaExperienceReview } = await ports.loadActual("src/apps/product/experience-review.ts");
  f.renderer.registry["forma-ui-cluster"] = FormaUiCluster;
  f.renderer.registry["forma-experience-review"] = FormaExperienceReview;
  f.host = new FormaProductDelivery(); f.host.tag = "forma-product-delivery"; f.host.attributes = {}; f.host.isConnected = true;
  f.draw = () => {
    ports.bindFixture(f);
    if (f.flushReviewUpdate?.()) return f.renderer.markup;
    if (maintenanceAdoption) f.requested = false;
    return f.renderer.draw(f.host);
  };
  f.reviewReady = () => {
    const review = f.renderer.component("forma-experience-review");
    if (!(review instanceof FormaExperienceReview) || !review.isConnected) return false;
    if (!maintenanceAdoption) return review.markup.includes(f.i18n.t("experience.review.No candidates", "No candidates"));
    const tree = fullPageTree({ ...f, host: review }, review.markup);
    const lists = tree.nodes.filter(node => node.owner === review && node.tag === "ul" && node.attributes.class === "experience-review-candidates");
    if (lists.length !== 1) return false;
    const within = node => { for (let current = node.parent; current; current = current.parent) if (current === lists[0]) return true; return false; };
    const buttons = tree.nodes.filter(node => node.owner === review && node.tag === "button" && within(node));
    return buttons.length === 1 && typeof buttons[0].handlers.click === "function" && !Object.hasOwn(buttons[0].attributes, "disabled")
      && tree.nodes.some(node => node.tag === "bdi" && node.parent === buttons[0] && node.text === f.maintenanceMaterial.adoptionBinding.experienceId);
  };
  f.host.connectedCallback();
  await untilScene(() => f.draw().includes("delivery-decision-form"), "actual delivery report and create form arrive");
  await untilScene(() => {
    f.draw(); return f.reviewReady();
  }, maintenanceAdoption ? "actual mounted material review shows its one code-owned candidate" : "actual mounted material review certifies its default empty registry");
  assert.equal(f.calls.filter(call => call.url === "/api/portfolio/product/experiences/materials").length, 1);
  // E reuses the one existing initializer only when no selection interface is
  // present. Retained FormData and stronger native OPTION ports keep ownership.
  f.bindCreateFields = form => { if (!form.elements) createSelectionPort(form); };
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
  f.reviewForm = marker => {
    assert.ok(["publication-lookup", "patch", "proposal", "action", "adoption-proposal"].includes(marker), "one of the five exact Review form markers");
    if (!maintenanceAdoption || f.requested) f.draw();
    const owner = f.renderer.component("forma-experience-review");
    if (!owner?.isConnected) return null;
    const attribute = "data-experience-" + marker;
    const forms = f.renderer.ownNodes(owner, "form").filter(node => node.isConnected && Object.hasOwn(node.attributes, attribute));
    assert.ok(forms.length <= 1, "one current connected " + marker + " form");
    if (!forms.length) return null;
    const form = forms[0], epochAttribute = marker === "adoption-proposal" ? "data-experience-adoption-owner"
      : ["proposal", "action"].includes(marker) ? attribute + "-owner" : null;
    const selector = `form[${attribute}]` + (epochAttribute ? `[${epochAttribute}="${form.attributes[epochAttribute]}"]` : "");
    assert.equal(owner.querySelector(selector), form, "actual selector and rendered native owner agree"); return form;
  };
  f.refresh = () => { f.draw(); return f.renderer.handler(f.host, "button", (node) => node.handlers.click?.toString().includes("this.refresh"))(); };
  f.decisions = () => h.worker.sqlite.prepare("SELECT * FROM delivery_decisions ORDER BY created_at,decision_id").all();
  f.creationEvents = () => h.worker.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionCreated' ORDER BY sequence").all();
  f.financial = () => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations"].map((table) => [table, h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n]));
  return f;
  } catch (error) {
    if (!maintenanceAdoption) throw error;
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Product native fixture setup failed"); }
    throw error;
  }
}
