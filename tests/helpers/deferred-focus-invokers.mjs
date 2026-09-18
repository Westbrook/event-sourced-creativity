// Test-only reuse of the native EventPart retention used by the existing
// themed-confirmation and Shell command-trigger ports. No semantic ID key,
// activeElement remapping, application method or global renderer replacement.
// Only explicitly supplied actual owners and native EventParts participate.
function retainNativeEventParts(f, owners, tag, event, pattern, accepts) {
  const parts = new WeakMap(), collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length, result = collect(markup, owner);
    if (!owners.has(owner) || !owner.isConnected) return result;
    const current = new Map();
    for (const node of f.renderer.nodes.slice(start)) {
      if (node.tag !== tag || !accepts(node)) continue;
      const token = node.full.match(pattern);
      const binding = token ? f.renderer.bindings[Number(token[1])] : null;
      if (binding?.owner !== owner || typeof binding.part !== "string"
        || typeof binding.value !== "function" || binding.value !== node.handlers[event]) continue;
      parts.set(node, binding.part);
      const rows = current.get(binding.part) ?? []; rows.push(node); current.set(binding.part, rows);
    }
    for (const [part, rows] of current) {
      if (rows.length !== 1) continue;
      const fresh = rows[0], previous = (f.renderer.previousNodes ?? []).filter(node => node.owner === owner
        && node.tag === fresh.tag && node.isConnected && parts.get(node) === part);
      if (previous.length !== 1) continue;
      const node = previous[0];
      for (const key of ["full", "attributes", "properties", "propertyParts", "handlers", "open", "value", "checked"])
        node[key] = fresh[key];
      node.parentElement = owner; node.disabled = Object.hasOwn(node.attributes, "disabled");
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = node; fresh.isConnected = false;
    }
    // RendererPort already retires every previous node absent from the current
    // draw. Looking back exactly one committed draw cannot resurrect an invoker.
    return result;
  };
}

export function retainDeferredFocusInvokers(f, owners) {
  retainNativeEventParts(f, owners, "button", "click",
    /\s@click=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u, () => true);
}

// Form-only opt-in: retain the actual current submit EventPart, not fields,
// semantic IDs, FormData/defaults or a second raw-value cache. The caller names
// its exact eligible native forms; all ordinary click callers stay unchanged.
export function retainNativeSubmitForms(f, owners, accepts) {
  retainNativeEventParts(f, owners, "form", "submit",
    /\s@submit=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u, accepts);
}

// Dialog-only opt-in through its existing click EventPart. This retains actual
// native dialog identity without depending on a newly added submit listener.
export function retainNativeClickDialogs(f, owners, accepts) {
  retainNativeEventParts(f, owners, "dialog", "click",
    /\s@click=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u, accepts);
}
