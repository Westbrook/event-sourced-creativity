import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const canonical = "/Users/westbrook/Documents/repos/codex/.wrangler/assistant-release-87d3137/";
const donor = "/Users/westbrook/.codex/visualizations/2026/08/26/01a03eaa-d5b7-7630-943d-7105f7a3067b/forma-recovery-20260831/model3d-reference-intake-r1/";
const root = new URL("../",import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){
  if((context.parentURL?.startsWith(root)||context.parentURL?.startsWith(new URL(donor,"file://").href))&&specifier.startsWith(".")){
    const p=new URL(specifier,context.parentURL);if(!existsSync(fileURLToPath(p))){
      const base=context.parentURL.startsWith(root)?fileURLToPath(root):donor;
      const relative=fileURLToPath(p).slice(base.length);
      const candidate=donor+relative;return next(new URL(existsSync(candidate)?candidate:canonical+relative,"file://").href,context);
    }
  }return next(specifier,context);
}});
const {Model3dReferencePicker}=await import("../src/experiences/model3d-reference-picker.ts");
hook.deregister();

// Explicit fake DOM/focus/decode ports, not a browser or image-decoding acceptance.
class Element {
  children=[];parentElement=null;attributes=new Map();listeners=new Map();hidden=false;checked=false;value="";textContent="";
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;}
  get isConnected(){return this===this.doc.body||Boolean(this.parentElement?.isConnected);}
  append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){for(const n of this.children){if(n.contains(this.doc.activeElement))this.doc.activeElement=this.doc.body;n.parentElement=null;}this.children=[];this.append(...nodes);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.get(k)??null;}
  removeAttribute(k){this.attributes.delete(k);}
  addEventListener(type,fn){const values=this.listeners.get(type)??[];values.push(fn);this.listeners.set(type,values);}
  fire(type){for(const fn of this.listeners.get(type)??[])fn({type,currentTarget:this,target:this});}
  focus(){if(this.isConnected)this.doc.activeElement=this;}
  async decode(){} // Declared successful fake decode only.
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const all=(root)=>[root,...root.children.flatMap(all)];
const flush=async()=>{for(let i=0;i<12;i++)await tick();};
test("fresh list resets head/cursor, preserves source and text, and requires fresh matching checks",async()=>{
  const old=globalThis.document,doc={createElement(tag){return new Element(tag,this);},activeElement:null};
  doc.body=new Element("body",doc);doc.activeElement=doc.body;globalThis.document=doc;
  const bytes=new Uint8Array([1,2,3]),sha=createHash("sha256").update(bytes).digest("hex");
  const source={version:1,kind:"image",sourceProjectId:"project",sourceDocumentId:"document",sourceBlockId:"block",referenceId:"reference",sha256:sha};
  const candidate={source,label:"Literal <img> reference 日本語",preview:"/api/media/u-6f776e6572/a.png"};
  const calls=[],changes=[];let list=0;
  const fetcher=async(path,init)=>{
    calls.push({path,method:init?.method??"GET",body:init?.body});
    if(path.startsWith("/api/experiences/model3d/references")){
      list++;
      if(list===2)return Response.json({error:"model3d_reference_list_changed"},{status:409});
      return Response.json({version:1,scope:"personal-document-references",qualification:"discovery-only",head:list===1?10:20,
        candidates:[list===4?{...candidate,source:{...source,sha256:"f".repeat(64)}}:candidate],
        next:list===1?{after:"project/~",head:10}:null});
    }
    if(path===candidate.preview)return new Response(bytes,{headers:{"content-type":"image/png"}});
    assert.equal(path,"/api/experiences/model3d/reference/inspect");
    const selection=JSON.parse(init.body);return Response.json({version:1,status:"inspected",generation:"unavailable",
      inspection:{version:1,qualification:"read-only-reference-inspection",selection,sourceDigest:"b".repeat(64),
        content:{sha256:sha,byteLength:bytes.length,mimeType:"image/png"}}});
  };
  const picker=new Model3dReferencePicker((selection,ready)=>changes.push({selection,ready}),undefined,fetcher);
  const authored=doc.createElement("textarea");authored.value="Unsent exact subject  日本語";doc.body.append(authored,picker.element);
  try{
    const browse=all(picker.element).find(n=>n.textContent==="Browse Document references");
    const refresh=all(picker.element).find(n=>n.textContent==="Refresh reference list");
    browse.focus();browse.fire("click");await flush();
    let radio=all(picker.element).find(n=>n.tagName==="INPUT"&&n.value==="block");
    radio.checked=true;radio.fire("change");await flush();
    const permission=all(picker.element).find(n=>n.type==="checkbox");permission.checked=true;permission.fire("change");await flush();
    assert.equal(changes.at(-1).ready,true);const selected=changes.at(-1).selection;
    browse.fire("click");await flush();
    assert.equal(changes.at(-1).ready,false);assert.deepEqual(changes.at(-1).selection,selected);
    assert.equal(refresh.hidden,false);
    const before=calls.length;browse.fire("click");await flush();assert.equal(calls.length,before,"stale cursor cannot repeat");
    permission.checked=false;permission.fire("change");
    radio.focus();refresh.fire("click");await flush();
    assert.equal(doc.activeElement,refresh);assert.equal(refresh.isConnected,true);assert.equal(authored.value,"Unsent exact subject  日本語");
    assert.equal(permission.checked,false,"a withdrawal during refresh must not be restored");
    assert.equal(calls.filter(x=>x.path.startsWith("/api/experiences/model3d/references")).at(-1).path,"/api/experiences/model3d/references");
    assert.equal(changes.at(-1).ready,false);
    permission.checked=true;permission.fire("change");await flush();
    assert.equal(changes.at(-1).ready,true);assert.deepEqual(changes.at(-1).selection,selected);
    assert.equal(calls.filter(x=>x.path.endsWith("/inspect")).length,2,"fresh matching source needs a new inspection");
    refresh.fire("click");await flush();
    assert.equal(changes.at(-1).ready,false);assert.deepEqual(changes.at(-1).selection,selected,"changed hash must not substitute the selected source");
    assert.equal(calls.filter(x=>x.path.endsWith("/inspect")).length,2);
    assert.equal(doc.activeElement,refresh);assert.equal(refresh.hidden,false);
    assert(calls.every(x=>x.method==="GET"||x.path.endsWith("/inspect")),"no draft/commit/provider request");
  }finally{picker.dispose();globalThis.document=old;}
});
