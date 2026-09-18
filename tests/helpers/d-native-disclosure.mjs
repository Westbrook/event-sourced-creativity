import assert from "node:assert/strict";

// D-only opt-in: reuse the existing Projects native DETAILS.open reflection.
// Apply the current emitted Boolean at collection, never a requested/expected
// opening, prior node state, replacement handler, or relaxed visibility rule.
export function installDBoundNativeDetails(t, f, owner, { className = null } = {}) {
  assert.ok(owner?.isConnected && f.components().includes(owner), "actual mounted disclosure owner");
  assert.equal(owner.store, f.store, "disclosure belongs to this actual Store");
  const originalCollect = f.renderer.collect;
  const collect = (markup, currentOwner) => {
    const start = f.renderer.nodes.length, result = Reflect.apply(originalCollect, f.renderer, [markup, currentOwner]);
    if (currentOwner === owner) for (const node of f.renderer.nodes.slice(start)) {
      if (node.tag !== "details" || !Object.hasOwn(node.properties, "open")) continue;
      if (className !== null && !String(node.attributes.class ?? "").split(/\s+/u).includes(className)) continue;
      assert.equal(node.owner, owner);
      assert.ok(node.isConnected && f.renderer.nodes.includes(node), "current collected native disclosure");
      const tokens = [...node.full.matchAll(/\s\.open=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/gu)];
      assert.equal(tokens.length, 1, "one actual .open PropertyPart token");
      const binding = f.renderer.bindings[Number(tokens[0][1])];
      assert.equal(binding?.owner, owner);
      assert.equal(typeof binding?.part, "string", "original emitted PropertyPart identity");
      assert.equal(binding.part, node.propertyParts.open);
      assert.equal(typeof binding.value, "boolean", "only the current app's explicit Boolean is reflected");
      assert.equal(binding.value, node.properties.open);
      node.open = binding.value;
    }
    return result;
  };
  f.renderer.collect = collect;
  t.after(() => { if (f.renderer.collect === collect) f.renderer.collect = originalCollect; });
}
