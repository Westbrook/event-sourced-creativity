import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";

// Full component hierarchy, synthetic state and native-control ports; no CSS,
// viewport, provider, study-data or accessibility certification is implied.
const fixtureUrl=new URL("../inactive-generation-dialog-host.test.mjs",import.meta.url);
const fixtureText=fs.readFileSync(fixtureUrl,"utf8");
const fixtureTree=ts.createSourceFile(fixtureUrl.pathname,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const firstTest=fixtureTree.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(fixtureTree)==="test");
assert.ok(firstTest,"existing full-class fixture ends before test registration");
const fixtureFactory=fixtureTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="fixture");
assert.ok(fixtureFactory&&fixtureFactory.pos<firstTest.pos,"reuse renderer declarations, not the old mock application factory");
let fixtureModule=fixtureText.slice(0,fixtureFactory.getFullStart());
const replacePort=(from,to)=>{if(typeof from==="string")assert.equal(fixtureModule.split(from).length,2,"exact reused fixture seam: "+from.slice(0,80));else assert.ok(fixtureModule.match(from),"reused fixture import statements");fixtureModule=fixtureModule.replace(from,to);};
// The standalone dialog-test import is unused by this full-page prefix.
replacePort("import { documentArtifactRevision } from \"../src/model/document-artifacts.ts\";\n","");
replacePort(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,prefix,_quote,specifier)=>prefix+JSON.stringify(specifier.startsWith(".")?new URL(specifier,fixtureUrl).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
fixtureModule=fixtureModule.replaceAll("import.meta.url",JSON.stringify(fixtureUrl.href));
replacePort("await import(specifier)","await import(new URL(specifier.slice(4),"+JSON.stringify(new URL("./",import.meta.resolve("lit")).href)+").href)");
replacePort('{ origin: "https://fixture.invalid" }','{ origin: "https://fixture.invalid",get pathname(){return activeFixture?.nativeHistoryLocation?.pathname??activeFixture?.store.route.get().split(/[?#]/)[0]??"/";},get search(){return activeFixture?.nativeHistoryLocation?.search??(activeFixture?.nativeUrlParts?new URL(activeFixture.store.route.get(),"https://fixture.invalid").search:"");},get hash(){return activeFixture?.nativeHistoryLocation?.hash??(activeFixture?.nativeUrlParts?new URL(activeFixture.store.route.get(),"https://fixture.invalid").hash:"");} }');
replacePort('/(?:forma-element|presentational-element)$/','/(?:forma-element|presentational-element)(?:\\.ts)?$/');
replacePort('else if (specifier === "./consequential-preview") dependencies.set(specifier, { consequentialPreview: () => nothing });','');
replacePort('getComputedStyle", "matchMedia", "InputEvent", code)(','getComputedStyle", "matchMedia", "InputEvent", "MutationObserver", "IntersectionObserver", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "navigator", "innerWidth", "innerHeight", code)(');
replacePort('class { observe() {} disconnect() {} }, () => ({ direction: activeFixture?.locale === "ar" ? "rtl" : "ltr", fontSize: "16px" }), () => ({ matches: true }), class InputEvent {},',
  'FixtureResizeObserver, element => windowPort.getComputedStyle(element), query => windowPort.matchMedia(query), class InputEvent {}, FixtureObserver, FixtureObserver, callback => windowPort.requestAnimationFrame(callback), id => windowPort.cancelAnimationFrame(id), fixtureStorage, {onLine:true,language:"en"}, windowPort.innerWidth, windowPort.innerHeight,');
replacePort("return \"<\" + tag + \" data-rendered-port=\\\"true\\\"\" + raw + \">\" + child + content + \"</\" + tag + \">\";","return \"<\" + tag + \" data-rendered-port=\\\"true\\\" data-fixture-component=\" + this.reference(id,owner) + raw + \">\" + child + content + \"</\" + tag + \">\";");
fixtureModule=fixtureModule.replaceAll("instance.updated?.();","instance.updated?.(new Map());");
replacePort('const child = this.value(instance.render(), instance, id, caches);','const child = typeof instance.render==="function"?this.value(instance.render(), instance, id, caches):serializeNative(instance.children??[],this,instance);');
// Observe only the actual factory return inside an explicitly opted-in host construction.
replacePort("else if (/\\/icons$/.test(specifier)) dependencies.set(specifier, { icon: () => nothing, registerIcons() {} });","else if (/\\/adaptive-proposal-review(?:\\.ts)?$/u.test(specifier)) {\n      const actual = await loadActual(\"src/components/adaptive-proposal-review.ts\");\n      dependencies.set(specifier, { ...actual, createAdaptiveProposalReview(...args) {\n        const controller = Reflect.apply(actual.createAdaptiveProposalReview, this, args);\n        if (adaptiveProposalConstruction) {\n          assert.equal(args[0], adaptiveProposalConstruction.fixture.store, \"observe the actual owning Store argument\");\n          assert.ok(controller instanceof actual.AdaptiveProposalReviewController, \"observe the actual factory result\");\n          adaptiveProposalConstruction.controllers.push(controller);\n        }\n        return controller;\n      } });\n    }\n    else if (/\\/icons$/.test(specifier)) dependencies.set(specifier, { icon: () => nothing, registerIcons() {} });");
replacePort('const instance = new this.registry[tag]();','const instance = constructObservedComponent(this.fixture, tag, this.registry[tag]);');
const fullPageNativePorts=String.raw`
// Opt-in read-only observation of the exact controller constructed by the
// current complete host. Neither host nor controller gains an accessor.
const adaptiveProposalControllers = new WeakMap();
let adaptiveProposalConstruction;
function constructObservedComponent(fixture, tag, Constructor) {
  if (!fixture.observeAdaptiveProposals || !["forma-canvas-surface", "forma-adaptive-path"].includes(tag)) return new Constructor();
  const previous = adaptiveProposalConstruction, capture = { fixture, controllers: [] };
  adaptiveProposalConstruction = capture;
  let instance;
  try { instance = new Constructor(); }
  finally { adaptiveProposalConstruction = previous; }
  assert.equal(instance.fixture, fixture, "actual complete host uses this fixture");
  assert.equal(capture.controllers.length, 1, "one original factory invocation belongs to this host construction");
  assert.equal(adaptiveProposalControllers.has(instance), false);
  adaptiveProposalControllers.set(instance, capture.controllers[0]);
  return instance;
}
function readAdaptiveProposalEvidence(host) {
  assert.equal(host?.fixture?.observeAdaptiveProposals, true, "controller observation was explicitly enabled");
  const value = adaptiveProposalControllers.get(host), store = host.store;
  assert.ok(value, "the actual host/controller pair was observed during native construction");
  // Freeze only the evidence envelope. preview identity is itself an original
  // regression observation; never clone or freeze controller-owned objects.
  return Object.freeze({visible:value.visible,busy:value.busy,phase:value.phase,notice:value.notice,
    presentationId:value.presentationId,uncertain:value.uncertain,executionId:value.executionId,bindingHash:value.bindingHash,
    handle:value.handle,preview:value.preview,receipt:value.receipt,originalCount:value.originals.length,
    canEdit:value.canEdit,canPreview:value.canPreview,canApply:value.canApply,outputEditorRequired:value.outputEditorRequired,
    draftCount:value.drafts.length,canAuthor:Boolean(value.ports.scope()?.canAuthor),policyAccepted:store.session.get()?.policy.accepted===true});
}
class FixtureObserver {constructor(callback){this.callback=callback;}observe(){}unobserve(){}disconnect(){}}
class FixtureResizeObserver extends FixtureObserver {observe(element){activeFixture?.resizeTargets.set(this,element);}disconnect(){activeFixture?.resizeTargets.delete(this);}}
const fixtureStorage={getItem:key=>activeFixture?.storage.get(key)??null,setItem:(key,value)=>activeFixture?.storage.set(key,String(value)),removeItem:key=>activeFixture?.storage.delete(key)};
function serializeNative(children,renderer,owner){return children.map(node=>{
 const attrs={...(node.attributes??{})};
 if(node.className)attrs.class=node.className;if(node.value!==undefined)attrs.value=node.value;
 for(const key of ["lang","dir","title"])if(node[key])attrs[key]=node[key];
 if(node.disabled)attrs.disabled="";if(node.checked)attrs.checked="";
 const text=Object.entries(attrs).map(([key,value])=>" "+key+"="+renderer.reference(value,owner)).join("");
 const handlers=Object.entries(node.listeners??{}).map(([name,value])=>" @"+name+"="+renderer.reference(value,owner)).join("");
 return "<"+node.tag+text+handlers+">"+escapeText(node.textContent??"")+serializeNative(node.children??[],renderer,owner)+"</"+node.tag+">";
}).join("");}
Object.defineProperty(ElementPort.prototype,"dataset",{get(){return this.fixtureDataset??={};}});
ElementPort.prototype.willUpdate=function(){};ElementPort.prototype.updated=function(){};ElementPort.prototype.firstUpdated=function(){};
ElementPort.prototype.append=function(...nodes){this.children??=[];for(const node of nodes){node.parentElement=this;this.children.push(node);}};
ElementPort.prototype.replaceChildren=function(...nodes){this.children=[];this.append(...nodes);};
ElementPort.prototype.addEventListener=function(name,handler){(this.listeners??={})[name]=handler;};
ElementPort.prototype.removeEventListener=function(name){delete this.listeners?.[name];};
ElementPort.prototype.hasAttribute=function(name){return Object.hasOwn(this.attributes??{},name);};
ElementPort.prototype.removeAttribute=function(name){delete this.attributes?.[name];};
ElementPort.prototype.toggleAttribute=function(name,force){const on=force??!this.hasAttribute(name);if(on)this.setAttribute(name,"");else this.removeAttribute(name);return on;};
ElementPort.prototype.getBoundingClientRect=function(){const width=this.tag==="forma-shell"?790:718;return{left:0,top:0,right:width,bottom:882,width,height:882};};
ElementPort.prototype.getClientRects=function(){return this.isConnected?[this.getBoundingClientRect()]:[];};
ElementPort.prototype.contains=function(node){while(node){if(node===this)return true;node=node.parentElement;}return false;};
ElementPort.prototype.scrollIntoView=function(){};
ElementPort.prototype.style={setProperty(){},removeProperty(){},getPropertyValue(){return "0px";}};
documentPort.createElement=tag=>{const node=new ElementPort();node.tag=tag;node.tagName=tag.toUpperCase();node.attributes={};node.children=[];node.textContent="";return node;};
documentPort.body=documentPort.createElement("body");documentPort.visibilityState="visible";documentPort.hasFocus=()=>true;
Object.assign(documentPort.documentElement,{clientWidth:790,clientHeight:882,style:{setProperty(){}},setAttribute(name,value){this[name]=String(value);},removeAttribute(name){delete this[name];},toggleAttribute(name,force){const on=force??!Object.hasOwn(this,name);if(on)this[name]="";else delete this[name];return on;},hasAttribute(name){return Object.hasOwn(this,name);}});
documentPort.querySelectorAll=selector=>activeFixture?.renderer.query(null,selector)??[];
documentPort.getElementById=id=>activeFixture?.renderer.query(null,"*").find(node=>node.attributes?.id===id)??null;
windowPort.innerWidth=790;windowPort.innerHeight=882;
windowPort.getComputedStyle=element=>({fontSize:"16px",width:(element?.tag==="forma-shell"?790:718)+"px",getPropertyValue:()=>"0px",direction:activeFixture?.locale==="ar"?"rtl":"ltr"});
windowPort.matchMedia=query=>({matches:query.includes("75rem")||query.includes("37.5rem"),media:query,addEventListener(){},removeEventListener(){}});
windowPort.setTimeout=(callback,delay)=>{const id=++activeFixture.timerSequence;activeFixture.timers.set(id,{callback,delay});return id;};
windowPort.clearTimeout=id=>activeFixture?.timers.delete(id);windowPort.setInterval=windowPort.setTimeout;windowPort.clearInterval=windowPort.clearTimeout;
windowPort.requestAnimationFrame=callback=>{const id=++activeFixture.timerSequence;activeFixture.frames.set(id,callback);return id;};
windowPort.cancelAnimationFrame=id=>activeFixture?.frames.delete(id);
windowPort.visualViewport={width:790,height:882,offsetLeft:0,offsetTop:0,addEventListener(){},removeEventListener(){}};
moduleCache.set("src/route-loader.ts",{loadRouteComponent:async route=>activeFixture?.trace.push("route-module:"+route)});
`;
replacePort("const { FormaUiPopover } = await loadActual",fullPageNativePorts+"\nconst { FormaUiPopover } = await loadActual");
fixtureModule+="\nexport {RendererPort,ElementPort,loadActual,documentPort,windowPort,FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs,moduleCache,FixtureObserver,readAdaptiveProposalEvidence};\nexport function bindFixture(value){activeFixture=value;}\n";
const ports=await import("data:text/javascript;base64,"+Buffer.from(fixtureModule).toString("base64"));
// Expose native DOM ports for focused host extensions; component implementations stay actual.
export { ports as calmFullPageNativePorts };
export const readAdaptiveProposalEvidence = ports.readAdaptiveProposalEvidence;
const componentManifest=JSON.parse(fs.readFileSync(new URL("../../custom-elements.json",import.meta.url),"utf8"));
const componentModules=new Map(componentManifest.modules.flatMap(module=>(module.declarations??[]).filter(declaration=>declaration.tagName).map(declaration=>[declaration.tagName,{file:module.path,name:declaration.name}])));
export const STUDY_SHAPED_TYPES=Object.freeze(["direction","audience","message","format","exclusion","subject","environment","emotion","style","composition","accessibility","direction","direction","audio"]);
export async function createCalmFullPage(t,{locale="en",reader=false,assistant=false,storeHost:providedStoreHost=null,observeAdaptiveProposals=false}={}){
  const storeHost=providedStoreHost??await createSceneStoreHost();t.after(()=>storeHost.close());
  const store=storeHost.store,id=storeHost.request.documentId,projectId=storeHost.worker.projectId;
  const events=store.events.get().filter(event=>event.payload.document_id!==id||event.type==="DocumentCreated");
  for(const [index,type]of STUDY_SHAPED_TYPES.entries())events.push({eventId:"synthetic-study-"+index,streamId:storeHost.worker.streamId,sequence:events.length+1,occurredAt:"2026-08-27T00:00:00.000Z",recordedAt:"2026-08-27T00:00:00.000Z",actor:"user",correlationId:"synthetic-full-page",type:"BlockCreated",payload:{project_id:projectId,document_id:id,block_id:"synthetic-"+index,type,handle:type+"/synthetic-"+index,position:"a"+index.toString().padStart(2,"0"),properties:{text:"Synthetic editable "+type+" evidence "+index,weight:0.7,intent:type==="exclusion"?"prohibit":"include"}}});
  store.events.set(events);store.head.set(events.length);store.content.set({});store.route.set("/document/"+id+"/synthetic-study");
  store.loading.set(false);store.patchUi({projectRailCollapsed:true,attentionCapture:false,instrumentation:false});
  const session=store.session.get();
  store.session.set({...session,...(assistant?{assistant:{enabled:true,phase:"read-only",capabilities:["project.assistant.read"]}}:{assistant:undefined}),
    ...(reader?{projectContext:{organizationId:"synthetic-org",projectAccessId:"synthetic-access",projectId,ownerUserId:session.user.userId,role:"viewer",permissions:["project.read"],expiresAt:new Date(Date.now()+3600_000).toISOString()}}:{})});
  const f={store,storeHost,locale,observeAdaptiveProposals,trace:[],clipboard:[],listeners:new Map(),changed:new Map(),steps:0,requested:false,resizeTargets:new Map(),frames:new Map(),timers:new Map(),timerSequence:0,storage:new Map()};
  ports.bindFixture(f);
  const messages={...ports.FORMA_DEFAULT_MESSAGES,...ports.localeCatalogs[locale]};
  f.i18n=new ports.FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){event.callback({locale,formatLocale:locale,direction:locale==="ar"?"rtl":"ltr",timeZone:"UTC",messages,revision:1},()=>{});return true;}});
  f.i18n.hostConnected();
  const {FormaShell}=await ports.loadActual("src/components/forma-shell.ts"),registry={};
  f.renderer=new ports.RendererPort(f,registry);
  const originalCollect=f.renderer.collect.bind(f.renderer);
  f.renderer.collect=(markup,owner)=>{
    const index=f.renderer.nodes.length;originalCollect(markup,owner);
    for(const node of f.renderer.nodes.slice(index)){
      node.getBoundingClientRect=()=>({left:0,right:node.attributes.class==="studio-main"?718:790,top:0,bottom:44,width:node.attributes.class==="studio-main"?718:790,height:44});
      node.getClientRects=()=>node.isConnected?[node.getBoundingClientRect()]:[];
      node.contains=ports.ElementPort.prototype.contains;
      node.removeAttribute=name=>delete node.attributes[name];
    }
  };
  f.tick=async()=>{await Promise.resolve();f.draw();f.requested=true;return true;};
  f.host=new FormaShell();f.host.tag="forma-shell";f.host.attributes={};f.host.isConnected=true;
  f.draw=()=>{ports.bindFixture(f);f.requested=false;return f.renderer.draw(f.host);};
  f.host.connectedCallback();
  f.flush=async()=>{
    for(let step=0;step<12;step++){
      f.draw();
      const unknown=[...new Set([...f.renderer.markup.matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match=>match[1]).filter(tag=>!registry[tag]))];
      if(unknown.length){
        for(const tag of unknown){const entry=componentModules.get(tag);assert.ok(entry,"every emitted component has a real definition: "+tag);const module=await ports.loadActual(entry.file);assert.equal(typeof module[entry.name],"function",tag);registry[tag]=module[entry.name];}
        continue;
      }
      const resized=[...f.resizeTargets];for(const [observer,node]of resized)observer.callback([{target:node,contentRect:node.getBoundingClientRect()}]);
      const frames=[...f.frames.values()];f.frames.clear();for(const callback of frames)callback(0);
      await Promise.resolve();
      if(!f.requested)break;
      if(step===11)throw new Error("Full page did not settle under finite native ports");
    }
    return f.renderer.markup;
  };
  t.after(()=>{ports.bindFixture(f);for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}f.host.disconnectedCallback();f.i18n.hostDisconnected();});
  await f.flush();
  f.components=()=>[f.host,...[...f.renderer.instances.values()].map(record=>record.instance).filter(instance=>instance.isConnected)];
  f.modules=ports.moduleCache;
  f.posture=Object.freeze({viewportWidth:790,viewportHeight:882,studioWidth:718,rootFontSize:16,kind:"functional-native-ports-not-CSS"});
  f.patchProperties=(index,properties)=>{store.events.set(store.events.get().map(event=>event.type==="BlockCreated"&&event.payload.block_id==="synthetic-"+index?{...event,payload:{...event.payload,properties:{...event.payload.properties,...properties}}}:event));};
  f.appendEvent=(type,payload)=>{const list=store.events.get(),event={eventId:"synthetic-extra-"+list.length,streamId:storeHost.worker.streamId,sequence:list.length+1,occurredAt:"2026-08-27T00:00:00.000Z",actor:"user",correlationId:"synthetic-full-page",type,payload:{project_id:projectId,document_id:id,...payload}};store.events.set([...list,event]);store.head.set(event.sequence);return event;};
  f.tree=()=>fullPageTree(f);
  f.settle=async()=>{
    for(let step=0;step<4;step++){
      await new Promise(setImmediate);await f.flush();
      // Join the real mounted Output client's current read, not a substitute
      // empty snapshot or a fixed number of render ticks.
      const documents=[...new Set(f.components().filter(component=>component.tag==="forma-output-requirements").map(component=>component.documentId).filter(Boolean))];
      await Promise.all(documents.map(id=>{const resource=store.outputRequirements.resource(id);return ["loading","refreshing"].includes(resource.state)?store.outputRequirements.ensure(id):resource;}));
      await f.flush();
    }
  };
  f.find=(tag,predicate)=>{const found=f.tree().visible(tag).filter(predicate);assert.equal(found.length,1,"one visible "+tag+" matches predicate");return found[0];};
  f.act=async(node,eventName="click",event={})=>{assert.ok(!node.hiddenBy,"cannot use a hidden control");assert.ok(node.port,"exact native control port exists");assert.ok(!Object.hasOwn(node.attributes,"disabled"),"executor is not disabled");const handler=node.handlers[eventName];assert.equal(typeof handler,"function","actual "+eventName+" handler");await handler.call(node.owner,{target:node.port,currentTarget:node.port,preventDefault(){},stopPropagation(){},...event});await f.settle();};
  await f.settle();
  assert.equal(STUDY_SHAPED_TYPES.filter((type,index)=>store.projection.get().blocks.some(block=>block.id==="synthetic-"+index&&block.type===type)).length,14);
  return f;
}

// Structural visibility follows actual emitted ancestors and native open state.
// It intentionally does not estimate CSS layout, viewport intersection or AT.
const VOID_ELEMENTS=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
const decode=value=>value.replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&");
export function fullPageTree(f,markup=f.renderer.markup){
  const root={tag:"#root",attributes:{},owner:f.host,children:[],parent:null,text:"",hiddenBy:null};
  const stack=[root],nodes=[];
  for(const match of markup.matchAll(/<!--[\s\S]*?-->|<\/?[\w-]+\b[^>]*>|[^<]+/gu)){
    const token=match[0];
    if(token.startsWith("<!--"))continue;
    if(token.startsWith("</")){
      const name=token.slice(2).split(/[\s>]/u)[0];
      const index=stack.findLastIndex(node=>node.tag===name);
      assert.ok(index>0,"balanced actual template closing element "+name);
      stack.length=index;continue;
    }
    const parent=stack.at(-1);
    if(!token.startsWith("<")){parent.children.push(decode(token));continue;}
    const [,tag,raw]=token.match(/^<([\w-]+)([^>]*)>/u),parsed=f.renderer.attrs(raw);
    const owner=parent.component??parent.owner;
    const componentId=parsed.attributes["data-fixture-component"],component=componentId?f.renderer.instances.get(componentId)?.instance:null;
    if(tag.startsWith("forma-"))assert.ok(component,"full hierarchy includes actual "+tag);
    const port=f.renderer.nodes.find(candidate=>candidate.owner===owner&&candidate.full===token)??null;
    let hiddenBy=parent.hiddenBy;
    if(!hiddenBy&&Object.hasOwn(parsed.attributes,"hidden"))hiddenBy=parsed.attributes.id??tag+"[hidden]";
    if(!hiddenBy&&/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(String(parsed.attributes.style??"")))hiddenBy=tag+"[style]";
    if(!hiddenBy&&tag==="dialog"&&!port?.open&&!Object.hasOwn(parsed.attributes,"open"))hiddenBy=tag+"[closed]";
    if(!hiddenBy&&Object.hasOwn(parsed.attributes,"popover")&&!f.renderer.openPopovers.has(parsed.attributes.id))hiddenBy=String(parsed.attributes.id??tag)+"[closed-popover]";
    if(!hiddenBy&&parent.tag==="details"&&!parent.open&&tag!=="summary")hiddenBy="details[closed]";
    const node={tag,...parsed,owner,component,port,parent,children:[],text:"",hiddenBy,open:Boolean(port?.open||Object.hasOwn(parsed.attributes,"open"))};
    parent.children.push(node);nodes.push(node);
    if(!VOID_ELEMENTS.has(tag)&&!raw.endsWith("/"))stack.push(node);
  }
  assert.equal(stack.length,1,"balanced full hierarchy");
  const finish=node=>{node.text=node.children.map(child=>typeof child==="string"?child:finish(child)).join("").replace(/\s+/gu," ").trim();return node.text;};finish(root);
  return {root,nodes,visible:tag=>nodes.filter(node=>node.tag===tag&&!node.hiddenBy),controls:()=>Object.fromEntries(["button","select"].map(tag=>[tag,nodes.filter(node=>node.tag===tag&&!node.hiddenBy).length]))};
}
