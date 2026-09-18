import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";

const root=new URL("../../",import.meta.url);
const resolution=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.startsWith(root.href)&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/iu.test(specifier)){
    const candidate=new URL(specifier+".ts",context.parentURL);if(fs.existsSync(candidate))return{url:candidate.href,shortCircuit:true};
  }
  return next(specifier,context);
}});
const pause=()=>new Promise(resolve=>setImmediate(resolve));
export async function untilScene(check,message="Scene asynchronous boundary"){for(let i=0;i<120;i++){if(check())return;await pause();}assert.ok(check(),message);}
export function sceneDeferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

class ElementPort {
  constructor(tag=""){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.open=false;this.checked=false;this.parent=null;this.textContent="";}
  append(...nodes){for(const node of nodes){if(node&&typeof node==="object")node.parent=this;this.children.push(node);}}
  addEventListener(type,handler){this.listeners.set(type,[...(this.listeners.get(type)??[]),handler]);}
  removeEventListener(type,handler){this.listeners.set(type,(this.listeners.get(type)??[]).filter(value=>value!==handler));}
  dispatchEvent(event){for(const handler of this.listeners.get(event.type)??[])handler(event);return true;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent({type:"close"});}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  focus(){}
  querySelector(){return null;}
}
const allElements=element=>[element,...element.children.flatMap(child=>child instanceof ElementPort?allElements(child):[])];
/** Full production class/modules; only native DOM, HTTP, timers and private gate state are deterministic ports. */
export async function createSceneStoreHost({count=9,medium="visual",shared=false,workerFixture=null,exposeSceneTestAccessors=true,beforeFetch=null}={}){
  const worker=workerFixture??await createSceneCostFixture(count,medium,{shared});
  const host={worker,requests:[],timers:new Map(),domReads:[],transport:null,intercept:null,closed:false};
  const documentPort=new ElementPort("document");documentPort.documentElement={lang:"en",dir:"ltr",dataset:{}};documentPort.body=new ElementPort("body");documentPort.visibilityState="hidden";
  documentPort.createElement=tag=>new ElementPort(tag);documentPort.createTextNode=text=>({textContent:text});documentPort.querySelector=()=>null;
  const windowPort=new ElementPort("window");let timerId=0;
  Object.assign(windowPort,{matchMedia:()=>({matches:false}),setTimeout(callback,delay){const id=++timerId;host.timers.set(id,{callback,delay});return id;},clearTimeout(id){host.timers.delete(id);},requestAnimationFrame(callback){return windowPort.setTimeout(callback,16);}});
  const locationPort={origin:"http://localhost",pathname:"/studio",search:"?document="+encodeURIComponent(worker.documentId),hash:""};
  windowPort.location=locationPort;const storage=new Map(),localStoragePort={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  host.document=documentPort;host.window=windowPort;host.location=locationPort;host.storage=storage;
  host.fetch=(input,init={})=>{
    beforeFetch?.(input,init);
    return (async()=>{
      const url=String(input),request={url,init,body:typeof init.body==="string"?JSON.parse(init.body):null};host.requests.push(request);
      if(host.intercept){const handled=await host.intercept(request);if(handled!==undefined)return handled;}
      // The existing foreground driver is a transport port, never a real provider call in these tests.
      if(/^\/api\/document-jobs\/[^/]+\/run$/u.test(url))return Response.json({job:{jobId:decodeURIComponent(url.split("/")[3]),status:"queued"}});
      assert.ok(url.startsWith("/api/"),"Only an in-memory application HTTP path is permitted");
      const response=await (host.transport?host.transport(request):worker.request(url,init));
      return response;
    })();
  };
  const cache=new Map();
  const load=async relative=>{
    if(cache.has(relative))return cache.get(relative);
    const source=fs.readFileSync(new URL(relative,root),"utf8"),tree=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),dependencies=new Map(),exports={};cache.set(relative,exports);
    for(const statement of tree.statements){
      if(!ts.isImportDeclaration(statement)||!statement.importClause||statement.importClause.isTypeOnly)continue;
      const specifier=statement.moduleSpecifier.text;
      if(specifier.startsWith(".")){
        const url=new URL(specifier.endsWith(".ts")?specifier:specifier+".ts",new URL(relative,root));
        const target=fileURLToPath(url).slice(fileURLToPath(root).length);
        dependencies.set(specifier,target.includes("/model/")||target.startsWith("src/model/")||target.startsWith("src/canvas/")||target.startsWith("src/platform/")?await import(url.href):await load(target));
      }else dependencies.set(specifier,await import(specifier));
    }
    let text=source;
    if(relative==="src/state/store.ts"&&exposeSceneTestAccessors){
      const owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");assert.ok(owner,"Full production Store class");
      // Exposes private state, not replacement behavior; every production method remains byte-for-byte intact.
      text=source.slice(0,owner.end-1)+"\nsceneGateForTest(kind:string,pending:Promise<any>){if(kind==='append')this.#appendPipeline=pending;else if(kind==='navigation')this.#navigationCommit=pending;else throw new Error('Unknown test gate');}\nsceneEstimateForTest(payload:Record<string,unknown>){return this.#generationEstimate('render_document',payload);}\n"+source.slice(owner.end-1);
    }
    const code=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const require=specifier=>{assert.ok(dependencies.has(specifier),"Actual dependency "+relative+" "+specifier);return dependencies.get(specifier);};
    new Function("require","exports","document","window","HTMLElement","Element","customElements","location","localStorage","fetch","requestAnimationFrame",code)(
      require,exports,documentPort,windowPort,ElementPort,ElementPort,{get:()=>true,define(){}},locationPort,localStoragePort,host.fetch,windowPort.requestAnimationFrame);
    return exports;
  };
  const {FormaStore}=await load("src/state/store.ts");
  host.store=new FormaStore();host.modules=cache;
  const sessionResponse=await worker.request("/api/session");assert.equal(sessionResponse.status,200);
  const session=await sessionResponse.json();
  host.store.session.set(session);
  host.store.route.set(locationPort.pathname+locationPort.search);
  const eventsResponse=await worker.request("/api/events?after=0&limit=2000&content=1");assert.equal(eventsResponse.status,200);
  const eventBody=await eventsResponse.json();host.store.events.set(eventBody.events??worker.events);host.store.head.set(eventBody.head??worker.events.at(-1)?.sequence??0);host.store.content.set(eventBody.content??{[worker.contentRef]:worker.content});
  host.request={documentId:worker.documentId,requestId:worker.requestId,sceneMedium:medium,productionMode:"managed",locale:"en",workflowId:worker.payload.workflowId,workflowStageId:worker.payload.workflowStageId,workflowSources:structuredClone(worker.payload.workflowSources)};
  host.quote=()=>host.store.previewSceneCost(host.request);
  host.approve=(preview,ports={})=>host.store.renderDocumentArtifact("scene",{...host.request,sceneRequestId:host.request.requestId,sceneCostConsent:{...preview,confirmed:true},...ports});
  host.dialog=()=>documentPort.body.children.find(element=>element.tag==="dialog")??null;
  host.budgetButton=label=>allElements(host.dialog()??new ElementPort()).find(element=>element.tag==="button"&&element.textContent===label);
  host.clickBudget=accepted=>{const button=host.budgetButton(accepted?"I understand, continue":"Cancel");assert.ok(button,"Actual budget action");button.dispatchEvent({type:"click"});};
  host.setSession=patch=>host.store.session.set({...host.store.session.get(),...patch});
  host.changeText=()=>{const events=host.store.events.get();host.store.events.set(events.map(event=>event.type==="BlockCreated"&&event.payload.block_id==="scene-reuse-direction"?{...event,payload:{...event.payload,properties:{...event.payload.properties,text:"A changed authored source."}}}:event));};
  host.close=async()=>{if(host.closed)return;host.closed=true;await pause();host.timers.clear();worker.close();};
  return host;
}
export function disposeSceneStoreResolution(){resolution.deregister();}
