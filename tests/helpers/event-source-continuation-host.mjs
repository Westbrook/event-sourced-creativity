
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {fileURLToPath} from "node:url";
import {calmFullPageNativePorts as ports} from "./calm-full-page-fixture.mjs";
import {navigationSourceContinuationHost} from "./studio-source-continuation-native.mjs";
import {layersSourceContinuationHost} from "./layers-source-continuation-native.mjs";
import {promptFanSourceContinuationHost} from "./prompt-fan-source-continuation-native.mjs";

// Full production classes with native control ports. These test-only entrypoints
// expose existing handlers/fields; no production member is removed or replaced.
const specs={
 library:{file:"src/components/forma-library.ts",name:"FormaLibrary",bridge:
  'fixturePrepare(){} fixtureState(){return{}} fixtureInvoke(_name:string,value:any){return this.#useCopy(value);}'},
 creative:{file:"src/components/forma-creative-editor.ts",name:"FormaCreativeEditor",bridge:
  'fixturePrepare(input:any){if(input.text!==undefined)this.#newText=input.text;if(input.creating!==undefined)this.#creating=input.creating;if(input.selected!==undefined)this.#selectedId=input.selected;if(input.file){this.#queueReference({target:{files:[input.file],value:""}} as unknown as Event);this.#rightsConfirmed=true;}} fixtureState(){return{text:this.#newText,creating:this.#creating,selected:this.#selectedId,pending:this.#pendingReference?.name??null}} fixtureInvoke(name:string,value:any){return name==="create"?this.#create({preventDefault(){}} as SubmitEvent):name==="reference"?this.#confirmReference():this.#duplicate(value);}'},
 editor:{file:"src/components/library-block-editor.ts",name:"LibraryBlockEditor",bridge:
  'fixturePrepare(input:any){if(input.blockId!==undefined){this.blockId=input.blockId;this.#ensureLoaded();}if(input.text!==undefined)this.#copy=input.text;if(input.file){this.#type="reference";this.#pendingFile=input.file;this.#rightsConfirmed=true;}if(input.relatedFile){this.#pendingRelatedFile=input.relatedFile;this.#relatedRightsConfirmed=true;}} fixtureState(){return{text:this.#copy,loaded:this.#loaded}} fixtureInvoke(){return this.#save({preventDefault(){}} as SubmitEvent);}'},
};
const loaded=new Map();
async function ownerClass(kind){
 if(loaded.has(kind))return loaded.get(kind);
 const spec=specs[kind],url=new URL("../../"+spec.file,import.meta.url),originalRead=fs.readFileSync.bind(fs),source=originalRead(url,"utf8");
 const tree=ts.createSourceFile(spec.file,source,ts.ScriptTarget.Latest,true),owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===spec.name);
 assert.ok(owner);const bridged=source.slice(0,owner.end-1)+"\n"+spec.bridge+"\n"+source.slice(owner.end-1);
 const checked=ts.createSourceFile(spec.file,bridged,ts.ScriptTarget.Latest,true),next=checked.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===spec.name);
 assert.equal(checked.parseDiagnostics.length,0);for(const member of owner.members)assert.equal(next.members.find(row=>row.name?.getText(checked)===member.name?.getText(tree))?.getText(checked),member.getText(tree),"Every original member remains exact");
 fs.readFileSync=(file,...args)=>{const target=file instanceof URL?fileURLToPath(file):String(file);return target===fileURLToPath(url)?(typeof args[0]==="string"?bridged:Buffer.from(bridged)):originalRead(file,...args);};
 try{ports.moduleCache.delete(spec.file);const module=await ports.loadActual(spec.file);loaded.set(kind,module[spec.name]);return module[spec.name];}
 finally{fs.readFileSync=originalRead;}
}
export async function sourceContinuationHost(t,h,kind,{navigationAction}={}){
 if(kind==="navigation")return navigationSourceContinuationHost(t,h,navigationAction);
 if(kind==="alternatives")return layersSourceContinuationHost(t,h);
 if(kind==="fan")return promptFanSourceContinuationHost(t,h);
 const f={store:h.store,storeHost:h,locale:"en",trace:[],clipboard:[],listeners:new Map(),changed:new Map(),resizeTargets:new Map(),frames:new Map(),timers:new Map(),timerSequence:0,storage:new Map(),requested:false,steps:0};
 ports.bindFixture(f);f.i18n=new ports.FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){event.callback({locale:"en",formatLocale:"en",direction:"ltr",timeZone:"UTC",messages:ports.FORMA_DEFAULT_MESSAGES,revision:1},()=>{});return true;}});f.i18n.hostConnected();
 f.renderer={query:()=>[]};f.tick=async()=>undefined;
 h.document.querySelectorAll=()=>[];h.document.activeElement=null;h.document.hasFocus=()=>true;
 h.window.cancelAnimationFrame=id=>h.window.clearTimeout(id);
 const Owner=await ownerClass(kind),Library=kind==="editor"?await ownerClass("library"):null;
 ports.bindFixture(f);
 // The production reusable editor is a child of the actual same-Store Library.
 // Supply that existing owner in this direct-handler fixture, not an always-
 // current predicate or a replacement save/receipt implementation.
 const library=Library?new Library():null;
 if(library){library.tag="forma-library";library.attributes={};library.isConnected=true;library.connectedCallback();}
 const component=new Owner();component.isConnected=true;component.attributes={};
 if(library){
  component.tag="forma-library-block-editor";component.parentElement=library;
  assert.equal(component.closest("forma-library"),library);
  assert.ok(ports.ElementPort.hasStoreIdentity(library,h.store),"the actual connected parent owns the same real Store");
 }
 component.connectedCallback();
 t.after(()=>{ports.bindFixture(f);component.isConnected=false;component.disconnectedCallback();
  if(library){library.isConnected=false;library.disconnectedCallback();component.parentElement=null;}
  f.i18n.hostDisconnected();});
 return{component,frame:f,bind:()=>ports.bindFixture(f)};
}
