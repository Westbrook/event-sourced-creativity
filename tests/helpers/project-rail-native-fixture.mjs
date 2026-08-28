import assert from "node:assert/strict";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";

// Extend the existing full Shell/Creative/Workspace renderer's DOM ports only.
// These are deterministic native-control/geometry ports, not browser/CSS/AT evidence.
const classes=node=>String(node?.attributes?.class??"").split(/\s+/u);
const matches=(node,selector)=>selector.split(",").some(part=>{
  part=part.trim();if(!part)return false;
  if(part===":popover-open")return node.fixture.renderer.openPopovers.has(node.attributes.id);
  const tag=part.match(/^[\w-]+/u)?.[0];if(tag&&node.tag!==tag)return false;
  for(const name of part.matchAll(/\.([\w-]+)/gu))if(!classes(node).includes(name[1]))return false;
  for(const [,name,,value]of part.matchAll(/\[([\w-]+)(?:=(["']?)([^\]"']+)\2)?\]/gu)){
    if(!Object.hasOwn(node.attributes??{},name))return false;
    if(value!==undefined&&String(node.attributes[name])!==value)return false;
  }
  if(part.includes(":popover-open")&&!node.fixture.renderer.openPopovers.has(node.attributes.id))return false;
  return true;
});
const below=(node,ancestor)=>{for(let at=node.parent;at;at=at.parent)if(at===ancestor)return true;return false;};
const invoke=(handler,owner,event)=>typeof handler==="function"?handler.call(owner,event):handler?.handleEvent(event);
const rect=(width,height=44,left=0,top=0)=>({left,right:left+width,top,bottom:top+height,width,height});
const identity=node=>node?.attributes?.id??[node?.tag,classes(node)[0],node?.attributes?.href??""].join("|");

export async function createProjectRailNativeFixture(t,options={}){
  const f=await createCalmFullPage(t,options),window=ports.windowPort,document=ports.documentPort;
  const saved={width:window.innerWidth,height:window.innerHeight,computed:window.getComputedStyle,media:window.matchMedia,scroll:window.scrollTo,observer:ports.FixtureObserver.prototype.observe,disconnect:ports.FixtureObserver.prototype.disconnect,active:document.activeElement,history:globalThis.history};
  f.metrics={width:options.width??760,height:options.height??882,shellWidth:options.shellWidth??options.width??760,studioWidth:options.studioWidth??718,rootFont:options.rootFont??16,safe:options.safe??0};
  f.history=[];globalThis.history={pushState(_state,_title,url){const next=new URL(url,"https://fixture.invalid");Object.assign(f.storeHost.location,{pathname:next.pathname,search:next.search,hash:next.hash});f.history.push(["push",url]);},replaceState(_state,_title,url){const next=new URL(url,"https://fixture.invalid");Object.assign(f.storeHost.location,{pathname:next.pathname,search:next.search,hash:next.hash});f.history.push(["replace",url]);}};
  f.nativeInvokers=new Map();f.media=[];f.mutations=new Map();f.nativeStyles=new Map();f.nativeEvents=[];f.scrolls=[];
  f.currentNode=node=>f.dom?.nodes.find(item=>item.port?.owner===node?.owner&&identity(item.port)===identity(node))?.port??null;
  window.scrollTo=value=>f.scrolls.push(value);
  window.getComputedStyle=element=>({...saved.computed(element),fontSize:f.metrics.rootFont+"px",width:classes(element).includes("ui-popover-panel")?Math.min(384,f.metrics.width-16)+"px":f.metrics.shellWidth+"px",getPropertyValue:name=>name.startsWith("--forma-popover-safe-")?String(f.metrics.safe):"0px"});
  window.matchMedia=query=>{
    const listeners=new Set();
    const media={media:query,get matches(){return query.split(",").some(branch=>{
      const ranges=[...branch.matchAll(/\((max|min)-(width|height):\s*([\d.]+)(rem|px)\)/gu)];
      return ranges.length>0&&ranges.every(([,bound,axis,size,unit])=>(bound==="max"?f.metrics[axis]<=Number(size)*(unit==="rem"?f.metrics.rootFont:1):f.metrics[axis]>=Number(size)*(unit==="rem"?f.metrics.rootFont:1)));
    });},addEventListener(type,handler){if(type==="change")listeners.add(handler);},removeEventListener(type,handler){if(type==="change")listeners.delete(handler);},listeners};
    media.previous=media.matches;f.media.push(media);return media;
  };
  ports.FixtureObserver.prototype.observe=function(element,configuration){if(configuration?.attributeFilter?.includes("data-nav-posture"))f.mutations.set(this,{element,configuration,previous:configuration.attributeFilter.map(name=>element.getAttribute(name))});};
  ports.FixtureObserver.prototype.disconnect=function(){f.mutations.delete(this);saved.disconnect.call(this);};
  const wrapResize=observer=>{
    if(observer.nativeMeasured)return;observer.nativeMeasured=true;
    const actual=observer.callback;observer.callback=entries=>{entries=entries.map(entry=>({...entry,contentRect:(f.currentNode(entry.target)??entry.target).getBoundingClientRect()}));const sizes=JSON.stringify(entries.map(entry=>entry.contentRect));if(observer.nativeSizes===sizes)return;observer.nativeSizes=sizes;actual(entries);};
  };
  for(const observer of f.resizeTargets.keys())wrapResize(observer);
  const setResize=f.resizeTargets.set.bind(f.resizeTargets);
  f.resizeTargets.set=(observer,element)=>{wrapResize(observer);return setResize(observer,element);};
  f.host.getBoundingClientRect=()=>rect(f.metrics.shellWidth,f.metrics.height);
  f.measure=next=>{
    Object.assign(f.metrics,next);window.innerWidth=f.metrics.width;window.innerHeight=f.metrics.height;
    Object.assign(window.visualViewport,{width:f.metrics.width,height:f.metrics.height});
    Object.assign(document.documentElement,{clientWidth:f.metrics.width,clientHeight:f.metrics.height});
    for(const media of f.media)if(media.matches!==media.previous){media.previous=media.matches;for(const listener of [...media.listeners])listener({matches:media.matches,media:media.media});}
  };
  const oldDraw=f.draw;
  f.draw=()=>{
    const active=document.activeElement;const markup=oldDraw();f.dom=f.tree();
    f.shell=f.dom.nodes.find(node=>classes(node.port).includes("app-shell"))?.port;
    for(const node of f.dom.nodes){
      const port=node.port;if(!port)continue;
      port.getBoundingClientRect=()=>classes(port).includes("app-shell")?rect(f.metrics.shellWidth,f.metrics.height):classes(port).includes("studio-main")?rect(f.metrics.studioWidth,f.metrics.height):classes(port).includes("rail-collapse-toggle")?rect(150,44,Math.max(0,f.metrics.shellWidth-160),52):rect(Math.min(384,f.metrics.width-16),44);
      port.matches=selector=>matches(port,selector);
      port.closest=selector=>{for(let at=node;at;at=at.parent)if(at.port&&matches(at.port,selector))return at.port;return null;};
      port.contains=target=>{const found=f.dom.nodes.find(item=>item.port===target);return Boolean(found&&(found===node||below(found,node)));};
      port.querySelector=selector=>f.dom.nodes.find(item=>item.port&&below(item,node)&&matches(item.port,selector))?.port??null;
      port.querySelectorAll=selector=>f.dom.nodes.filter(item=>item.port&&below(item,node)&&matches(item.port,selector)).map(item=>item.port);
      const styleKey=port.attributes.id??identity(port);let style=f.nativeStyles.get(styleKey);if(!style){style=new Map();f.nativeStyles.set(styleKey,style);}
      port.style={setProperty:(name,value)=>style.set(name,value),getPropertyValue:name=>style.get(name)??"",removeProperty:name=>style.delete(name)};
      port.focus=()=>{document.activeElement=port;f.trace.push("focus:"+(port.attributes.class??port.tag));};
      port.showPopover=()=>{
        if(f.renderer.openPopovers.has(port.attributes.id))return;
        let prevented=false;
        invoke(port.handlers.beforetoggle,port.owner,{currentTarget:port,target:port,newState:"open",oldState:"closed",preventDefault(){prevented=true;}});
        if(prevented)return;
        if(port.attributes.popover==="auto")for(const opened of [...f.renderer.openPopovers]){
          const other=f.dom.nodes.find(item=>item.attributes.id===opened);if(other?.port?.attributes.popover==="auto"&&!below(node,other))other.port.hidePopover();
        }
        f.renderer.openPopovers.add(port.attributes.id);f.nativeEvents.push(["open",port.attributes.id]);
        invoke(port.handlers.toggle,port.owner,{currentTarget:port,target:port,newState:"open",oldState:"closed"});
      };
      port.hidePopover=()=>{
        if(!f.renderer.openPopovers.has(port.attributes.id))return;
        invoke(port.handlers.beforetoggle,port.owner,{currentTarget:port,target:port,newState:"closed",oldState:"open",preventDefault(){}});
        f.renderer.openPopovers.delete(port.attributes.id);f.nativeEvents.push(["closed",port.attributes.id]);
        invoke(port.handlers.toggle,port.owner,{currentTarget:port,target:port,newState:"closed",oldState:"open"});
      };
    }
    if(active?.owner&&f.currentNode(active))document.activeElement=f.currentNode(active);
    for(const [observer,record]of [...f.mutations]){
      const element=f.currentNode(record.element);if(!element)continue;
      const next=record.configuration.attributeFilter.map(name=>element.getAttribute(name));
      if(next.some((value,index)=>value!==record.previous[index])){record.previous=next;observer.callback([{type:"attributes",target:element}]);}
    }
    return markup;
  };
  const {CollectionTree}=await ports.loadActual("src/components/collection-tree.ts");f.renderer.registry["forma-collection-tree"]=CollectionTree;
  f.measure({});f.draw();
  f.rail=f.components().find(component=>component.tag==="forma-project-rail");assert.ok(f.rail);
  const originalQuery=f.rail.querySelector.bind(f.rail);
  f.rail.closest=selector=>selector===".app-shell"?f.shell:null;
  f.rail.querySelector=selector=>selector===".rail-content[popover]"?f.dom.nodes.find(node=>node.owner===f.rail&&node.port&&matches(node.port,selector))?.port??null:originalQuery(selector);
  f.rail.disconnectedCallback();f.rail.connectedCallback();
  f.dispatch=async(node,eventName="click",fields={},{settle=true}={})=>{
    assert.ok(node.port,"actual native target");let prevented=false,stopped=false,immediate=false;
    const event={type:eventName,target:node.port,currentTarget:node.port,button:0,defaultPrevented:false,isComposing:false,composedPath:()=>[node.port],
      preventDefault(){prevented=true;this.defaultPrevented=true;},stopPropagation(){stopped=true;},stopImmediatePropagation(){stopped=true;immediate=true;},...fields};
    const chain=[];for(let at=node;at;at=at.parent)chain.unshift(at);
    for(const at of chain){const listener=at.handlers?.[eventName];if(listener?.capture){event.currentTarget=at.port;await invoke(listener,at.owner,event);}if(stopped)break;}
    if(!immediate){event.currentTarget=node.port;const handler=node.handlers[eventName];if(!handler?.capture)await invoke(handler,node.owner,event);}
    if(!stopped)for(const at of chain.slice(0,-1).reverse()){const handler=at.handlers?.[eventName];if(handler&&!handler.capture){event.currentTarget=at.port;await invoke(handler,at.owner,event);}if(stopped)break;}
    if(eventName==="click"&&!prevented&&!Object.hasOwn(node.attributes,"disabled")&&node.attributes.popovertarget){
      const panel=f.dom.nodes.find(item=>item.attributes.id===node.attributes.popovertarget);assert.ok(panel?.port,"declarative popover target exists before opening");
      if(f.renderer.openPopovers.has(panel.attributes.id))panel.port.hidePopover();
      else{f.nativeInvokers.set(panel.attributes.id,node.port);node.port.focus();panel.port.showPopover();}
    }
    if(settle)await f.settle();return {prevented,stopped,event};
  };
  f.dismiss=async(reason="outside")=>{
    const panel=f.panel();assert.ok(panel,"current panel");const invoker=f.nativeInvokers.get(panel.attributes.id);
    if(reason==="escape"){
      const target=f.dom.nodes.find(node=>node.port===document.activeElement)??panel;
      const result=await f.dispatch(target,"keydown",{key:"Escape"},{settle:false});
      assert.equal(result.prevented,false,"native Escape default is not canceled");
    }
    panel.port.hidePopover();
    if(reason==="escape")f.currentNode(invoker)?.focus();
    await f.settle();
  };
  f.emit=type=>{for(const listener of [...(f.listeners.get(type)??[])])listener({type,detail:{path:f.store.route.get()}});};
  f.panel=()=>f.dom.nodes.find(node=>node.owner===f.rail&&classes(node.port).includes("rail-content")&&Object.hasOwn(node.attributes,"popover"))??null;
  f.toggle=()=>f.dom.nodes.find(node=>node.owner===f.rail&&classes(node.port).includes("rail-collapse-toggle"));
  f.open=()=>f.dispatch(f.toggle());
  f.active=()=>document.activeElement;
  t.after(()=>{
    Object.assign(window,{innerWidth:saved.width,innerHeight:saved.height,getComputedStyle:saved.computed,matchMedia:saved.media,scrollTo:saved.scroll});
    Object.assign(window.visualViewport,{width:saved.width,height:saved.height});
    Object.assign(document.documentElement,{clientWidth:saved.width,clientHeight:saved.height});document.activeElement=saved.active;
    if(saved.history===undefined)delete globalThis.history;else globalThis.history=saved.history;
    ports.FixtureObserver.prototype.observe=saved.observer;ports.FixtureObserver.prototype.disconnect=saved.disconnect;
  });
  await f.settle();return f;
}
