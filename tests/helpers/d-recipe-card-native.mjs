import assert from "node:assert/strict";
import { live } from "lit/directives/live.js";

const liveType = live("")._$litDirective$;

// D-only opt-in reuse of the existing recipe Card lifecycle and native-details
// ports. Install once per fixture; a fixed controller keeps Save-host scope exact.
export function installDRecipeCardNative(t, f, controller = null) {
  const h = f.storeHost, Card = f.renderer.registry["forma-output-requirement-card"];
  const Output = f.renderer.registry["forma-output-requirements"];
  assert.equal(typeof Card, "function", "actual Card registered before native queries");
  assert.equal(typeof Output, "function", "actual Output controller registered before native queries");
  assert.equal(h.store, f.store);
  const outputOwner = owner => owner instanceof Output && owner.isConnected && owner.store === h.store
    && !owner.blockId && owner.surface === "document" && f.components().includes(owner);
  if (controller !== null) assert.ok(outputOwner(controller), "actual fixed document controller");
  const recipeCardOwner = owner => owner instanceof Card && owner.isConnected && owner.store === h.store
    && outputOwner(owner.parentElement) && (controller === null || owner.parentElement === controller);
  // Supply only real recipe-card binding changes at the original pre-render
  // lifecycle call; the shared renderer and actual component body stay intact.
  const actualWillUpdate = Card.prototype.willUpdate, committedCardProperties = new WeakMap();
  const cardUpdate = t.mock.method(Card.prototype, "willUpdate", function(changed) {
    if (!recipeCardOwner(this)) return actualWillUpdate.call(this, changed);
    const records = [...f.renderer.instances.values()].filter(record => record.instance === this);
    assert.equal(records.length, 1, "the actual card has one existing renderer record");
    const record = records[0], bindings = record.propertyValues;
    if (!bindings?.has("newDraft")) return actualWillUpdate.call(this, changed);
    assert.equal(f.renderer.updatingOwner, this, "bookkeeping runs at the original pre-render owner boundary");
    const previous = committedCardProperties.get(record), next = new Map(), merged = new Map(changed);
    assert.ok(previous || !record.firstRendered, "observe the first binding before adopting later committed values");
    for (const name of ["snapshot", "newDraft"]) {
      assert.ok(bindings.has(name), "the actual recipe template committed " + name);
      const value = bindings.get(name);
      assert.ok(Object.is(this[name], value), "the current public property is the actual committed binding");
      next.set(name, value);
      if (!Object.is(previous?.get(name), value) && !merged.has(name)) merged.set(name, previous?.get(name));
    }
    committedCardProperties.set(record, next);
    return actualWillUpdate.call(this, merged);
  });
  t.after(() => cardUpdate.mock.restore());
  // Unbound native details keep their own state only at the same real summary
  // AttributePart. A content-free current binding token disambiguates otherwise
  // identical <details> openings for the unchanged full hierarchy lookup.
  const disclosurePart = Symbol("recipe disclosure AttributePart");
  const nativeValue = f.renderer.value, nativeCollect = f.renderer.collect;
  const recipeDisclosureOwner = owner => recipeCardOwner(owner)
    && [...f.renderer.instances.values()].some(record => record.instance === owner && record.propertyValues?.has("newDraft"));
  f.renderer.value = function(part, owner, path, caches) {
    const markup = nativeValue.call(this, part, owner, path, caches);
    if (!part?.strings || !recipeDisclosureOwner(owner)) return markup;
    return markup.replace(/<details>(<summary aria-label=__bound_(\d+)__>)/gu, (opening, summary, id) => {
      const binding = f.renderer.bindings[Number(id)];
      if (binding?.owner !== owner) return opening;
      assert.equal(typeof binding.part, "string", "actual summary AttributePart identifies this disclosure template");
      return '<details data-fixture-recipe-disclosure="' + id + '">' + summary;
    });
  };
  f.renderer.collect = function(markup, owner) {
    const start = f.renderer.nodes.length, nativeAttrs = this.attrs;
    const currentRecipe = recipeDisclosureOwner(owner);
    // Reuse the existing Output reachability port's live() value decoding,
    // only for this current Card's actual emitted .value PropertyPart.
    if (currentRecipe) this.attrs = function(raw) {
      const parsed = nativeAttrs.call(this, raw), value = parsed.properties.value;
      if (value?._$litDirective$ !== liveType) return parsed;
      const tokens = [...raw.matchAll(/(?:^|\s)\.value=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>]|$)/gu)];
      assert.equal(tokens.length, 1, "one actual .value PropertyPart token");
      const binding = this.bindings[Number(tokens[0][1])];
      if (binding?.owner !== owner) return parsed;
      assert.equal(typeof binding.part, "string", "current emitted value PropertyPart identity");
      assert.equal(parsed.propertyParts.value, binding.part);
      assert.ok(binding.value === value, "decode the exact current binding, not a requested field value");
      assert.ok(Array.isArray(value.values) && value.values.length === 1, "one actual live() argument");
      parsed.properties.value = value.values[0];
      return parsed;
    };
    let result;
    try { result = nativeCollect.call(this, markup, owner); }
    finally { if (currentRecipe) this.attrs = nativeAttrs; }
    if (!recipeDisclosureOwner(owner)) return result;
    const nodes = f.renderer.nodes.slice(start), parts = new Set();
    for (const [index, fresh] of nodes.entries()) {
      if (fresh.tag !== "details" || !Object.hasOwn(fresh.attributes, "data-fixture-recipe-disclosure")) continue;
      const summary = nodes[index + 1], id = Number(fresh.attributes["data-fixture-recipe-disclosure"]);
      assert.equal(summary?.tag, "summary");
      assert.equal(summary.full, "<summary aria-label=__bound_" + id + "__>");
      const binding = f.renderer.bindings[id];
      assert.equal(binding?.owner, owner); assert.equal(typeof binding?.part, "string");
      assert.equal(binding.value, summary.attributes["aria-label"]);
      assert.equal(parts.has(binding.part), false, "one actual disclosure per current AttributePart"); parts.add(binding.part);
      assert.equal(Object.hasOwn(fresh.attributes, "open"), false); assert.equal(Object.hasOwn(fresh.properties, "open"), false);
      const previous = (f.renderer.previousNodes ?? []).filter(node => node.owner === owner && node.tag === "details"
        && node.isConnected && node[disclosurePart] === binding.part);
      assert.ok(previous.length <= 1, "only one connected node in the immediately prior committed tree");
      const node = previous[0] ?? fresh, open = node.open;
      for (const key of ["full", "attributes", "properties", "propertyParts", "handlers"]) node[key] = fresh[key];
      node[disclosurePart] = binding.part; node.parentElement = owner; node.isConnected = true;
      Object.defineProperty(node, "open", { configurable: true, get: () => Object.hasOwn(node.attributes, "open"),
        set: on => { if (on) node.attributes.open = ""; else delete node.attributes.open; } });
      node.open = open;
      f.renderer.nodes[start + index] = node;
      if (node !== fresh) fresh.isConnected = false;
    }
    return result;
  };
  t.after(() => { f.renderer.value = nativeValue; f.renderer.collect = nativeCollect; });
}
