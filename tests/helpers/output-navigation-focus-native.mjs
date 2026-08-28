import assert from "node:assert/strict";

// Add only native DOM ports missing from the reusable full-class renderer.
// Attribute selectors must not return an unrelated first section. Programmatic
// focus updates activeElement and delivers focusin as a browser would; this is
// deterministic component evidence, not a browser/AT certificate.
export function installOutputNavigationFocusNative(t, f, ports) {
  const { documentPort, ElementPort } = ports;
  const focusDocument=f.storeHost?.document??documentPort;
  const restore=[];
  const replace=(object,key,descriptor)=>{
    const previous=Object.getOwnPropertyDescriptor(object,key);
    Object.defineProperty(object,key,{configurable:true,...descriptor});
    restore.push(()=>{if(previous)Object.defineProperty(object,key,previous);else delete object[key];});
  };
  // The full Store and full component fixtures own separate native ports.
  // Join their document surface, never their Store/authentication behavior.
  if(focusDocument!==documentPort){
    for(const key of["activeElement","body","documentElement"])
      replace(focusDocument,key,{get:()=>documentPort[key],set:value=>{documentPort[key]=value;}});
    for(const key of["querySelector","querySelectorAll","addEventListener","removeEventListener"])
      replace(focusDocument,key,{value:(...args)=>documentPort[key](...args),writable:true});
    replace(f.storeHost.window,"cancelAnimationFrame",{value:id=>f.storeHost.window.clearTimeout(id),writable:true});
    replace(f.storeHost.window,"getComputedStyle",{value:element=>{
      const base=ports.windowPort.getComputedStyle(element);
      const row=treeRows()?.find(value=>value.port===element||value.component===element);
      let visibility="",display="";
      for(let current=row;current;current=current.parent){
        const native=current.port??current.component;
        const inline=String(native?.getAttribute?.("style")??current.attributes?.style??"");
        if(!visibility)visibility=native?.style?.visibility??inline.match(/visibility\s*:\s*([^;]+)/iu)?.[1]?.trim()??"";
        if(current===row)display=native?.style?.display??inline.match(/display\s*:\s*([^;]+)/iu)?.[1]?.trim()??"";
      }
      return{...base,display:display||base.display||"block",visibility:visibility||base.visibility||"visible"};
    },writable:true});
    replace(ElementPort.prototype,"ownerDocument",{get(){return focusDocument;}});
  }
  t.after(()=>{for(const undo of restore.reverse())undo();});
  const previousActive = documentPort.activeElement;
  documentPort.activeElement = null;
  const nativeFocus = [], nativeScroll = [], wrapped = new WeakMap();
  let drawing=false;
  const draw=f.renderer.draw.bind(f.renderer);
  f.renderer.draw=(...args)=>{
    const previous=new Set(f.renderer.nodes);drawing=true;
    try{return draw(...args);}finally{
      drawing=false;const present=new Set(f.renderer.nodes);
      if(typeof f.tree==="function")for(const node of previous)if(!present.has(node))node.isConnected=false;
    }
  };
  const emit = (type, target = documentPort.activeElement) => {
    const event = { type, target, currentTarget: focusDocument, preventDefault() {}, stopPropagation() {}, composedPath: () => target ? [target, focusDocument] : [focusDocument] };
    for (const listener of [...(f.listeners.get(type) ?? [])]) listener(event);
  };
  const attributesMatch = (node, selector) => [...selector.matchAll(/\[([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/gu)].every(([, name, double, single, bare]) => {
    const expected = double ?? single ?? bare;
    const actualNode=node.port??node.component??node;
    const actual = name === "open" ? (actualNode.open ? "" : undefined)
      : name === "hidden" ? (actualNode.hidden || Object.hasOwn(actualNode.attributes ?? {}, name) ? "" : undefined)
      : actualNode.getAttribute?.(name) ?? actualNode.attributes?.[name];
    return expected === undefined ? actual !== undefined && actual !== null : String(actual) === expected;
  });
  const simpleMatches = (node, selector) => {
    if(selector.includes(","))return selector.split(",").some(part=>simpleMatches(node,part.trim()));
    if(selector.startsWith("["))return attributesMatch(node,selector);
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
    Object.defineProperty(node,"ownerDocument",{configurable:true,get:()=>focusDocument});
    node.querySelectorAll=selector=>f.renderer.query(node,selector);
    node.querySelector=selector=>node.querySelectorAll(selector)[0]??null;
    const originalMatches=node.matches?.bind(node);
    node.matches=selector=>{
      if(selector!==":disabled")return originalMatches?.(selector)??simpleMatches(node,selector);
      if(node.disabled||Object.hasOwn(node.attributes??{},"disabled"))return true;
      const row=treeRows()?.find(value=>value.port===node);
      for(let parent=row?.parent;parent;parent=parent.parent){
        if(parent.tag!=="fieldset"||!parent.port?.disabled&&!Object.hasOwn(parent.port?.attributes??parent.attributes??{},"disabled"))continue;
        const legend=parent.children?.find(child=>child.tag==="legend");
        if(legend){let inside=false;for(let ancestor=row;ancestor&&ancestor!==parent;ancestor=ancestor.parent)if(ancestor===legend)inside=true;if(inside)continue;}
        return true;
      }
      return false;
    };
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
    const actual = !f.renderer.updatingOwner ? treeRows() : null;
    const literalOwner=owner == null ? undefined : actual?.find(row=>row.port===owner);
    const result = query(literalOwner?owner.owner:owner, selector).filter(node=>{
      if(!literalOwner)return true;
      const row=actual.find(value=>value.port===node||value.component===node);
      for(let parent=row?.parent;parent;parent=parent.parent)if(parent===literalOwner)return true;
      return false;
    });
    for(const node of result)if(!String(node.tag??"").startsWith("forma-"))own(node);
    if (!selector.includes("[")) return result;
    const actualPorts = actual ? new Set(actual.map(value => value.port).filter(Boolean)) : null;
    return result.filter(node => attributesMatch(node, selector) && (!actualPorts || actualPorts.has(node)));
  };
  t.after(() => { documentPort.activeElement = previousActive; });
  return {
    document: focusDocument, nativeFocus, nativeScroll, emit,
    focus(node) { assert.ok(node?.isConnected, "newer field really exists"); own(node); node.focus(); assert.equal(documentPort.activeElement === node, true); },
    listeners(type) { return (f.listeners.get(type) ?? []).length; },
  };
}
