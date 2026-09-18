import assert from "node:assert/strict";
import test from "node:test";
import {currentPage,targetId} from "./helpers/context-structured-source-fixture.mjs";
import {defaultSlidePresentation} from "../src/model/document-artifacts.ts";

const previousFetch=globalThis.fetch;
let externalCalls=0;
globalThis.fetch=async()=>{externalCalls++;throw new Error("No external/provider request is permitted in the output-input copy tests.");};
test.after(()=>{try{assert.equal(externalCalls,0);}finally{globalThis.fetch=previousFetch;}});

const originalHelp="Your complete writing remains separate from the original output. Command or Control plus Enter saves; Escape cancels.";
const calmHelp="Command or Control plus Enter saves; Escape closes controls and keeps unsaved edits.";
const normalized=value=>String(value).replace(/\s+/gu," ").trim();
function richField(x){
 const child=x.child(),rich=child?.querySelector("forma-ui-rich-text");
 assert.ok(child?.isConnected&&rich?.isConnected,"the complete current structured editor and rich-text field are mounted");
 const field=x.f.find("textarea",row=>row.owner===rich);
 const ids=String(field.attributes["aria-describedby"]).split(/\s/u);
 const descriptions=ids.map(id=>x.f.tree().nodes.find(row=>row.attributes.id===id));
 assert.ok(descriptions.every(row=>row&&!row.hiddenBy),"every described-by target is current and visible");
 return{child,rich,field,description:normalized(descriptions.map(row=>row.text).join(" "))};
}
function assertHelp(x,expected){
 const current=richField(x);
 assert.equal(current.rich.help,expected);
 assert.equal(current.description,normalized(expected+" "+x.f.i18n.t("editor.help")));
 return current;
}
function formFor(x){
 return x.f.find("form",row=>row.owner===x.owner()&&String(row.attributes.class).split(/\s/u).includes("block-editor"));
}
async function escape(x,isComposing=false){
 const {rich,field}=richField(x),form=formFor(x);
 let stopped=false,prevented=false;
 const event={key:"Escape",isComposing,target:field.port,currentTarget:field.port,
  preventDefault(){prevented=true;},stopPropagation(){stopped=true;}};
 // Invoke the actual native target handler and its existing parent form
 // bubble boundary, without replacing any keyboard or Cancel implementation.
 field.handlers.keydown.call(rich,event);
 if(!stopped)form.handlers.keydown.call(x.owner(),{...event,currentTarget:form.port});
 await x.f.settle();
 assert.equal(prevented,!isComposing);
}
async function cancel(x){
 const owner=x.owner(),button=x.f.find("button",row=>{
  if(row.owner!==owner||row.attributes.type!=="button"||row.attributes.class!=="button ghost")return false;
  for(let current=row.parent;current;current=current.parent)if(current.tag==="form"&&String(current.attributes.class).split(/\s/u).includes("block-editor"))return true;
  return false;
 });
 await x.f.act(button);
}
const writes=(x,start)=>x.host.requests.slice(start).filter(row=>(row.init.method??"GET")!=="GET");
const unchanged=(x,start)=>{assert.deepEqual(writes(x,start),[]);assert.deepEqual(x.financial(),x.financialBefore);assert.equal(externalCalls,0);};

for(const locale of["en","fr","ar","ja"])for(const surface of["document","library"])test("Output input copy: "+locale+" calm Context "+surface+" describes retained Escape and distinct Cancel",async t=>{
 const x=await currentPage(t,locale),start=x.host.requests.length,canonical=x.state();
 if(surface==="library"){
  // The public ContextBlock Library mode, not LibraryBlockEditor's unrelated
  // Back-to-Library keyboard executor. The complete Store/parent still runs.
  x.owner().surface="library";x.owner().requestUpdate();await x.f.settle();await x.f.act(x.toggle());
 }
 const expected=x.f.i18n.t("context.controls.shortcutHelp",calmHelp);
 const current=assertHelp(x,expected);
 if(locale!=="en")assert.notEqual(expected,calmHelp);
 const authored="Unsaved exact manuscript — العربية 日本語 café\n"+locale;
 await x.input("markdown",authored);const owned=x.child().draft;
 await escape(x,true);assert.deepEqual(x.child().draft,owned);assertHelp(x,expected);
 await escape(x);
 assert.equal(x.f.tree().visible("form").filter(row=>row.owner===x.owner()&&String(row.attributes.class).includes("block-editor")).length,0);
 await x.f.act(x.toggle());assert.equal(x.child(),current.child);assert.deepEqual(x.child().draft,owned);assertHelp(x,expected);
 await cancel(x);await x.f.act(x.toggle());await x.f.act(x.toggle());
 assert.deepEqual(x.child().draft,canonical,"explicit Cancel still discards the unsaved complete draft");
 assertHelp(x,expected);unchanged(x,start);
});

for(const locale of["en","fr","ar","ja"])test("Output input copy: "+locale+" noncalm Context still describes and performs cancel",async t=>{
 const x=await currentPage(t,locale),start=x.host.requests.length,canonical=x.state();
 x.owner().surface="canvas";x.owner().requestUpdate();await x.f.settle();
 x.f.store.patchUi({editingBlockId:targetId});await x.f.settle();
 const expected=x.f.i18n.system(originalHelp);assertHelp(x,expected);
 await x.input("markdown","Uncommitted noncalm copy — العربية 日本語");await escape(x);
 assert.equal(x.f.store.ui.editingBlockId,"");
 x.f.store.patchUi({editingBlockId:targetId});await x.f.settle();
 assert.deepEqual(x.child().draft,canonical);assertHelp(x,expected);unchanged(x,start);
});

for(const locale of["en","fr","ar","ja"])test("Output input copy: "+locale+" other parent defaults are unchanged",async t=>{
 const x=await currentPage(t,locale),start=x.host.requests.length;
 // Actual independent public child controls prove default copy only. Creative
 // and Library parent keyboard executors are audited separately, not inferred.
 for(const [source,standalone]of[["creative-editor",false],["library-block-editor",false],["output-input-editor",true]]){
  const child=new (x.child().constructor)();child.tag="forma-output-input-editor";child.attributes={};
  child.block=x.f.store.projection.get().libraryBlocks.find(block=>block.id===targetId);child.source=source;child.standalone=standalone;
  const renderer=new (x.f.renderer.constructor)(x.f,x.f.renderer.registry);renderer.draw(child);
  const rich=renderer.component("forma-ui-rich-text");assert.ok(rich);
  assert.equal(rich.help,x.f.i18n.system(originalHelp));
  assert.deepEqual(child.draft,x.state());
  for(const {instance}of renderer.instances.values()){instance.isConnected=false;instance.disconnectedCallback();}
  child.isConnected=false;child.disconnectedCallback();
 }
 unchanged(x,start);
});

for(const locale of["en","fr","ar","ja"])test("Output input copy: "+locale+" palette role labels localize without changing stored keys or authored values",async t=>{
 const presentation={...defaultSlidePresentation("gallery"),theme:"Accent",footerLabel:"Surface"};
 const x=await currentPage(t,locale,{source_artifact_kind:"slides",label:"Background",artifact_summary:"Foreground",artifact_markdown:"Muted",
  artifact_structure:{presentation,items:[]}}),start=x.host.requests.length;
 const before=x.child().draft,keys=Object.keys(before.presentation.palette);
 const labels={background:"Background",foreground:"Foreground",accent:"Accent",muted:"Muted",surface:"Surface"};
 const colors=()=>{
  const details=x.f.tree().nodes.find(row=>row.tag==="details"&&row.owner===x.child()&&row.attributes.class==="output-input-presentation");
  assert.ok(details?.port?.isConnected);details.port.open=true;
  return x.f.tree().visible("input").filter(row=>row.owner===x.child()&&row.attributes.type==="color");
 };
 assert.equal(colors().length,5);assert.deepEqual(colors().map(row=>row.properties.value),Object.values(before.presentation.palette));
 for(const [index,key]of keys.entries()){
  const row=colors()[index],label=row.parent;
  assert.equal(label.tag,"label");assert.ok(row.port.isConnected);
  const role=x.f.i18n.system(labels[key]);
  assert.ok(normalized(label.text).toLocaleLowerCase(locale).includes(normalized(role).toLocaleLowerCase(locale)),key+" label uses its existing translated system role");
  const value=["#010203","#040506","#070809","#0a0b0c","#0d0e0f"][index];
  await x.f.act(row,"input",{target:{value},currentTarget:{value}});
  const current=x.child().draft;
  assert.deepEqual(Object.keys(current.presentation.palette),keys,"display copy never rewrites machine palette keys");
  assert.equal(current.presentation.palette[key],value,"the original exact key still receives the explicit color");
  assert.deepEqual([current.title,current.summary,current.markdown,current.presentation.theme,current.presentation.footerLabel],
   [before.title,before.summary,before.markdown,before.presentation.theme,before.presentation.footerLabel],"authored text equal to English role names stays byte-identical");
 }
 unchanged(x,start);
});
