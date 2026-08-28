import assert from "node:assert/strict";

// Add only native DOM ports missing from the reusable full-class renderer.
// Attribute selectors must not return an unrelated first section. Programmatic
// focus updates activeElement and delivers focusin as a browser would; this is
// deterministic component evidence, not a browser/AT certificate.
export function installOutputNavigationFocusNative(t, f, ports) {
  const { documentPort, ElementPort } = ports;
  const previousActive = documentPort.activeElement;
  documentPort.activeElement = null;
  const nativeFocus = [], nativeScroll = [], wrapped = new WeakMap();
  let drawing=false;
  const draw=f.renderer.draw.bind(f.renderer);
  f.renderer.draw=(...args)=>{drawing=true;try{return draw(...args);}finally{drawing=false;}};
  const emit = (type, target = documentPort.activeElement) => {
    const event = { type, target, currentTarget: documentPort, preventDefault() {}, stopPropagation() {}, composedPath: () => target ? [target, documentPort] : [documentPort] };
    for (const listener of [...(f.listeners.get(type) ?? [])]) listener(event);
  };
  const attributesMatch = (node, selector) => [...selector.matchAll(/\[([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/gu)].every(([, name, double, single, bare]) => {
    const expected = double ?? single ?? bare;
    const actual = name === "open" ? (node.open ? "" : undefined)
      : name === "hidden" ? (node.hidden || Object.hasOwn(node.attributes ?? {}, name) ? "" : undefined)
      : node.getAttribute?.(name) ?? node.attributes?.[name];
    return expected === undefined ? actual !== undefined && actual !== null : String(actual) === expected;
  });
  const simpleMatches = (node, selector) => {
    if (selector.startsWith("#")) return node.attributes?.id === selector.slice(1);
    if (selector.startsWith(".")) return String(node.attributes?.class ?? "").split(/\s+/u).includes(selector.slice(1));
    return node.tag === selector;
  };
  const treeRows = () => !drawing && typeof f.tree === "function" ? f.tree().nodes : null;
  const previousClosest=ElementPort&&Object.getOwnPropertyDescriptor(ElementPort.prototype,"closest");
  if(ElementPort)ElementPort.prototype.closest=function(selector){
    const row=treeRows()?.find(value=>value.component===this||value.port===this);
    if(row){for(let parent=row;parent;parent=parent.parent)if(simpleMatches(parent,selector))return parent.component??parent.port??null;}
    return previousClosest?.value?.call(this,selector)??null;
  };
  t.after(()=>{if(ElementPort&&previousClosest)Object.defineProperty(ElementPort.prototype,"closest",previousClosest);});

  const own = node => {
    if (wrapped.get(node) === node.focus) return;
    const originalFocus = node.focus?.bind(node), originalScroll=node.scrollIntoView?.bind(node);
    node.scrollIntoView=(...args)=>{nativeScroll.push({node,args});return originalScroll?.(...args);};
    node.focus = (...args) => {
      if (!node.isConnected) return;
      const previous = documentPort.activeElement;
      documentPort.activeElement = node;
      nativeFocus.push({ node, previous, previousConnected: Boolean(previous?.isConnected) });
      emit("focusin", node);
      return originalFocus?.(...args);
    };
    node.closest = selector => {
      const row = treeRows()?.find(value => value.port === node);
      if (row) {
        for (let parent = row; parent; parent = parent.parent) if (simpleMatches(parent, selector)) return parent.component ?? parent.port ?? null;
      }
      for (let owner = node.owner ?? node.parentElement; owner; owner = owner.parentElement) if (owner.tag === selector) return owner;
      return null;
    };
    Object.defineProperty(node,"hidden",{configurable:true,get:()=>Object.hasOwn(node.attributes??{},"hidden"),set:value=>{if(value)node.setAttribute("hidden","");else delete node.attributes.hidden;}});
    wrapped.set(node,node.focus);
  };
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length;
    collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) own(node);
  };
  for (const node of f.renderer.nodes) own(node);
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (selector.includes(",")) return selector.split(",").flatMap(value => f.renderer.query(owner, value.trim()));
    const result = query(owner, selector);
    for(const node of result)if(!String(node.tag??"").startsWith("forma-"))own(node);
    if (!selector.includes("[")) return result;
    const actual = !f.renderer.updatingOwner ? treeRows() : null;
    const actualPorts = actual ? new Set(actual.map(value => value.port).filter(Boolean)) : null;
    return result.filter(node => attributesMatch(node, selector) && (!actualPorts || actualPorts.has(node)));
  };
  t.after(() => { documentPort.activeElement = previousActive; });
  return {
    document: documentPort, nativeFocus, nativeScroll, emit,
    focus(node) { assert.ok(node?.isConnected, "newer field really exists"); own(node); node.focus(); assert.equal(documentPort.activeElement === node, true); },
    listeners(type) { return (f.listeners.get(type) ?? []).length; },
  };
}
