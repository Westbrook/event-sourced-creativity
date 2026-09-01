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
    replace(focusDocument,"defaultView",{get:()=>f.storeHost.window});
    replace(f.storeHost.window,"cancelAnimationFrame",{value:id=>f.storeHost.window.clearTimeout(id),writable:true});
    replace(f.storeHost.window,"getComputedStyle",{value:element=>{
      const base=ports.windowPort.getComputedStyle(element);
      const row=treeIndex()?.byNode.get(element);
      let visibility="",display="";
      for(let current=row;current;current=current.parent){
        const native=current.port??current.component;
        const inline=String(native?(native.getAttribute?.("style")??native.attributes?.style??""):(current.attributes?.style??""));
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
  let drawing=false,structure=null;
  // RendererPort already supplies actual template/keyed/repeat ancestry. Its
  // flat collect() recreates literal ports, unlike a same-template Lit update.
  // Preserve only the exact context-block ARTICLE, never a matching lookalike
  // or activeElement reassignment. Native listeners stay on the retained node;
  // current rendered attributes and event bindings are refreshed in collect.
  const articleTemplates=new Map(),articles=new Map(),seenArticles=new Set();
  // The global command trigger has one real EventPart in Shell's persistent
  // header template. Its existing renderer binding carries template identity
  // and keyed/repeat ancestry; a matching class alone never owns a native node.
  const commandTriggers=new Map(),seenCommandTriggers=new Set();
  // Library's original import preview has one native dialog in its actual
  // keyed template. Its own close EventPart includes that exact key ancestry;
  // neither a class match nor the original import's data confers identity.
  const importDialogs=new Map(),seenImportDialogs=new Set();
  const value=f.renderer.value.bind(f.renderer);
  f.renderer.value=(part,owner,path,caches)=>{
    const markup=value(part,owner,path,caches);
    if(drawing&&owner?.tag==="forma-context-block"&&part?.strings&&/^\s*<article\b/u.test(part.strings[0])){
      const opening=markup.match(/^\s*<article([^>]*)>/u),block=owner.block;
      if(opening&&block&&f.renderer.attrs(opening[1]).attributes["data-block-id"]===block.id){
        const authority=owner.store?.captureAuthorizationScope?.()?.key;
        if(authority)articleTemplates.set(owner,{path,strings:part.strings,store:owner.store,authority,
          address:JSON.stringify([block.projectId,block.documentId,block.id,owner.surface])});
      }
    }
    return markup;
  };
  const draw=f.renderer.draw.bind(f.renderer);
  f.renderer.draw=(...args)=>{
    const previous=new Set(f.renderer.nodes);articleTemplates.clear();seenArticles.clear();seenCommandTriggers.clear();seenImportDialogs.clear();structure=null;drawing=true;
    try{return draw(...args);}finally{
      drawing=false;structure=null;const present=new Set(f.renderer.nodes);
      for(const [owner,record]of articles)if(!seenArticles.has(owner)||!present.has(record.node)){
        record.node.isConnected=false;articles.delete(owner);
      }
      for(const [owner,record]of commandTriggers)if(!seenCommandTriggers.has(owner)||!present.has(record.node)){
        record.node.isConnected=false;commandTriggers.delete(owner);
      }
      for(const [owner,record]of importDialogs)if(!owner.isConnected||!seenImportDialogs.has(owner)||!present.has(record.node)){
        record.node.isConnected=false;importDialogs.delete(owner);
      }
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
    const tagClass=selector.match(/^([A-Za-z][A-Za-z0-9-]*)\.([A-Za-z_-][A-Za-z0-9_-]*)$/u);
    if(tagClass)return node.tag===tagClass[1].toLowerCase()&&simpleMatches(node,"."+tagClass[2]);
    const qualified=selector.match(/^([\w-]+)((?:\[[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])+)$/u);
    if(qualified)return node.tag===qualified[1]&&attributesMatch(node,qualified[2]);
    if(selector.startsWith("["))return attributesMatch(node,selector);
    const native=node.port??node.component??node;
    if (selector.startsWith("#")) return (native.getAttribute?.("id")??native.attributes?.id) === selector.slice(1);
    if (selector.startsWith(".")) return String(native.getAttribute?.("class")??native.attributes?.class??"").split(/\s+/u).includes(selector.slice(1));
    return node.tag === selector;
  };
  // Only ancestry and current port/component membership are reusable. Leave
  // f.tree() itself untouched: its visibility/text answers are deliberately
  // not copied here, and all native state is read at the point of use.
  const treeIndex = () => {
    if(drawing||typeof f.tree!=="function")return null;
    const renderer=f.renderer,nodes=renderer.nodes,markup=renderer.markup;
    if(structure&&structure.tree===f.tree&&structure.host===f.host&&structure.nodes===nodes
      &&structure.markup===markup&&structure.members.length===nodes.length
      &&structure.members.every((member,index)=>member.node===nodes[index]
        &&member.owner===nodes[index].owner&&member.full===nodes[index].full))return structure;
    const tree=f.tree(),rows=new Map(),byNode=new Map(),byPort=new Map(),ports=new Set();
    const rowFor=source=>{
      if(!source)return null;
      if(!rows.has(source))rows.set(source,{tag:source.tag,port:source.port,component:source.component,
        attributes:source.port||source.component?undefined:source.attributes,parent:null,children:[]});
      return rows.get(source);
    };
    for(const source of tree.nodes){
      const row=rowFor(source);row.parent=rowFor(source.parent);
      row.children=(source.children??[]).filter(child=>child&&typeof child==="object").map(rowFor);
      if(source.port){
        ports.add(source.port);if(!byPort.has(source.port))byPort.set(source.port,row);
        if(!byNode.has(source.port))byNode.set(source.port,row);
      }
      if(source.component&&!byNode.has(source.component))byNode.set(source.component,row);
    }
    structure={tree:f.tree,host:f.host,nodes,markup,
      members:nodes.map(node=>({node,owner:node.owner,full:node.full})),byNode,byPort,ports};
    return structure;
  };
  const previousClosest=ElementPort&&Object.getOwnPropertyDescriptor(ElementPort.prototype,"closest");
  if(ElementPort)ElementPort.prototype.closest=function(selector){
    const row=treeIndex()?.byNode.get(this);
    if(row){for(let parent=row;parent;parent=parent.parent)if(simpleMatches(parent,selector))return parent.component??parent.port??null;}
    return previousClosest?.value?.call(this,selector)??null;
  };
  t.after(()=>{if(ElementPort&&previousClosest)Object.defineProperty(ElementPort.prototype,"closest",previousClosest);});

  const own = node => {
    if (wrapped.get(node) === node.focus) return;
    // Text-selection IDL belongs only to actual native fields. Do not add it
    // to an ancestor form, alter raw value, or infer browser focus/event timing.
    if ((node.tag === "input" || node.tag === "textarea") && typeof node.select !== "function") node.select = () => {
      const type = String(node.getAttribute?.("type") ?? "text").toLowerCase();
      if (node.tag === "input" && !["text", "search", "url", "tel", "password"].includes(type)) return;
      node.selectionStart = 0; node.selectionEnd = String(node.value ?? "").length; node.selectionDirection = "none";
    };
    const originalFocus = node.focus?.bind(node), originalScroll=node.scrollIntoView?.bind(node);
    Object.defineProperty(node,"ownerDocument",{configurable:true,get:()=>focusDocument});
    node.querySelectorAll=selector=>f.renderer.query(node,selector);
    node.querySelector=selector=>node.querySelectorAll(selector)[0]??null;
    const originalContains=node.contains?.bind(node);
    node.contains=target=>{
      if(target===node)return true;
      const actual=treeIndex(),ancestor=actual?.byPort.get(node),row=actual?.byNode.get(target);
      if(ancestor){for(let current=row;current;current=current.parent)if(current===ancestor)return true;return false;}
      return originalContains?.(target)??false;
    };
    const originalMatches=node.matches?.bind(node);
    node.matches=selector=>{
      // Literal attributes and simple ASCII IDs reuse the exact live matcher;
      // pseudos, popover state and other selectors retain their existing port.
      if(/^#[A-Za-z_][A-Za-z0-9_-]*$/u.test(selector))return simpleMatches(node,selector);
      if(/^(?:[\w-]+)?(?:\[[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])+$/u.test(selector))return simpleMatches(node,selector);
      if(selector!==":disabled")return originalMatches?.(selector)??simpleMatches(node,selector);
      if(node.disabled||Object.hasOwn(node.attributes??{},"disabled"))return true;
      const row=treeIndex()?.byPort.get(node);
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
      const row = treeIndex()?.byPort.get(node);
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
    const template=drawing?articleTemplates.get(owner):null;
    if(template){
      const anchors=f.renderer.nodes.slice(start).filter(node=>node.tag==="article"&&node.attributes["data-block-id"]===owner.block.id);
      // Ambiguous anchors retain collect's ordinary replacement behavior.
      if(anchors.length===1){
        const fresh=anchors[0],previous=articles.get(owner);
        const same=previous?.node.isConnected&&previous.path===template.path&&previous.strings===template.strings
          &&previous.store===template.store&&previous.authority===template.authority&&previous.address===template.address;
        if(same){
          const node=previous.node;
          for(const key of["full","attributes","properties","handlers","open","value","checked"])node[key]=fresh[key];
          node.parentElement=owner;node.isConnected=true;
          f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;fresh.isConnected=false;
        }else{
          if(previous)previous.node.isConnected=false;
          articles.set(owner,{...template,node:fresh});
        }
        seenArticles.add(owner);
      }
    }
    if(drawing&&owner?.tag==="forma-shell"){
      const anchors=f.renderer.nodes.slice(start).filter(node=>node.tag==="button"
        &&String(node.attributes.class??"").split(/\s+/u).includes("command-trigger"));
      if(anchors.length===1){
        const fresh=anchors[0],token=fresh.full.match(/\s@click=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
        const binding=token?f.renderer.bindings[Number(token[1])]:null;
        if(binding?.owner===owner&&typeof binding.part==="string"&&typeof binding.value==="function"
          &&binding.value===fresh.handlers.click){
          const previous=commandTriggers.get(owner);
          const same=previous?.node.isConnected&&previous.part===binding.part&&previous.store===owner.store;
          if(same){
            const node=previous.node;
            for(const key of["full","attributes","properties","propertyParts","handlers","open","value","checked"])node[key]=fresh[key];
            node.parentElement=owner;node.isConnected=true;
            f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;fresh.isConnected=false;
          }else{
            if(previous)previous.node.isConnected=false;
            commandTriggers.set(owner,{part:binding.part,store:owner.store,node:fresh});
          }
          seenCommandTriggers.add(owner);
        }
      }
    }
    if(drawing&&owner?.tag==="forma-library"){
      const anchors=f.renderer.nodes.slice(start).filter(node=>node.tag==="dialog"
        &&String(node.attributes.class??"").split(/\s+/u).includes("library-import-dialog"));
      if(anchors.length===1){
        const fresh=anchors[0],token=fresh.full.match(/\s@close=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
        const binding=token?f.renderer.bindings[Number(token[1])]:null;
        if(binding?.owner===owner&&typeof binding.part==="string"
          &&/\/key:[^/]+\/template:\d+\/part:\d+$/u.test(binding.part)
          &&typeof binding.value==="function"&&binding.value===fresh.handlers.close
          &&!/\s[.?]?open(?=[\s=>])/u.test(fresh.full)){
          const previous=importDialogs.get(owner);
          const same=previous?.node.isConnected&&previous.part===binding.part&&previous.store===owner.store;
          if(same){
            const node=previous.node;
            // Keep native open state, listeners and original node-bound methods.
            // Only this same emitted element's current attributes/parts change.
            for(const key of["full","attributes","properties","propertyParts","handlers"])node[key]=fresh[key];
            f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;
            if(fresh!==node)fresh.isConnected=false;
          }else{
            if(previous)previous.node.isConnected=false;
            importDialogs.set(owner,{part:binding.part,store:owner.store,node:fresh});
          }
          seenImportDialogs.add(owner);
        }
      }
    }
    for (const node of f.renderer.nodes.slice(start)) own(node);
  };
  for (const node of f.renderer.nodes) own(node);
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (selector.includes(",")) return selector.split(",").flatMap(value => f.renderer.query(owner, value.trim()));
    const actual = !f.renderer.updatingOwner ? treeIndex() : null;
    const literalOwner=owner == null ? undefined : actual?.byPort.get(owner);
    // Bounded descendant grammar, resolved from current emitted ancestry.
    // The generic first-class port must not return the form for ".editor input".
    const fieldDescendant = actual && selector.match(/^(\.[\w-]+)\s+(input|textarea)$/u);
    const result = query(literalOwner?owner.owner:owner, fieldDescendant?.[2] ?? selector).filter(node=>{
      if (fieldDescendant) {
        const row = actual.byNode.get(node);
        if (row?.tag !== fieldDescendant[2]) return false;
        let match = false;
        for (let parent = row.parent; parent; parent = parent.parent) if (simpleMatches(parent, fieldDescendant[1])) { match = true; break; }
        if (!match) return false;
      }
      if(!literalOwner)return true;
      const row=actual.byNode.get(node);
      for(let parent=row?.parent;parent;parent=parent.parent)if(parent===literalOwner)return true;
      return false;
    });
    for(const node of result)if(!String(node.tag??"").startsWith("forma-"))own(node);
    if (!selector.includes("[")) return result;
    const actualPorts = actual?.ports;
    return result.filter(node => attributesMatch(node, selector) && (!actualPorts || actualPorts.has(node)));
  };
  t.after(() => { documentPort.activeElement = previousActive; });
  return {
    document: focusDocument, nativeFocus, nativeScroll, emit,
    focus(node) { assert.ok(node?.isConnected, "newer field really exists"); own(node); node.focus(); assert.equal(documentPort.activeElement === node, true); },
    listeners(type) { return (f.listeners.get(type) ?? []).length; },
  };
}
