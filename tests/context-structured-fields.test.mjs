import assert from "node:assert/strict";
import test from "node:test";
import {currentPage,json,targetId} from "./helpers/context-structured-source-fixture.mjs";
import {DOCUMENT_ARTIFACT_KINDS,defaultSlidePresentation} from "../src/model/document-artifacts.ts";
const previousFetch=globalThis.fetch;
let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error("No external/provider request is permitted in this structured-fields test.");};
test.after(()=>{try{assert.equal(networkCalls,0);}finally{globalThis.fetch=previousFetch;}});

const unicode=" — العربية 日本語 café 👩🏽‍💻\n";
function fullDraft(kind,mark){
 const presentation=kind==="slides"?{...defaultSlidePresentation(mark==="A"?"gallery":"nocturne"),theme:mark+" theme"+unicode,footerLabel:mark+" footer"+unicode,fontFamily:mark+" font"}:null;
 const item=index=>({
  source_artifact_item_id:"story-part-"+index,title:mark+" section "+index+unicode,body:mark+" body "+index+unicode,
  notes:mark+" notes "+index+unicode,image_prompt:mark+" visual "+index+unicode,context_group_ids:[mark+"-group"],
  slide:kind==="slides"?{layout:mark==="A"?"metric":"timeline",kicker:mark+" kicker "+index+unicode,bullets:[mark+" bullet one",mark+" bullet two"],
   quote:{text:mark+" quotation",speaker:mark+" speaker",role:mark+" role",sourceId:mark+"-source",citation:mark+" citation"},
   citations:[{sourceId:mark+"-source",label:mark+" source",anchor:mark+"-anchor",excerpt:mark+" exact excerpt"}],
   sourceIds:[mark+"-source"],section:mark+" section",sourceOrder:index+1,
   visual:{kind:mark==="A"?"metric":"bars",label:mark+" visual label",value:mark+" visual value",exactValue:mark+" exact",displayValue:mark+" display",unit:mark+" unit",
    data:[{label:mark+" point one",value:mark==="A"?"25%":"75%",weight:mark==="A"?0.25:0.75,exactValue:mark+" datum exact",displayValue:mark+" datum display",sourceIds:[mark+"-source"]}]}}:null,
  media_url:"/api/media/"+mark+"-"+index,media_type:kind==="audio"?"audio/wav":kind==="video"?"video/mp4":"image/png",
  scene_id:mark+"-scene-"+index,narrative_order:index+1,generation_order:2-index,duration_seconds:mark==="A"?3:5,
 });
 return{kind,title:mark+" complete title"+unicode,summary:mark+" complete summary"+unicode,markdown:mark+" complete manuscript"+unicode,presentation,items:[item(0),item(1)]};
}
function propertiesFor(draft){
 return{source_artifact_kind:draft.kind,label:draft.title,artifact_summary:draft.summary,artifact_markdown:draft.markdown,
  artifact_item_count:draft.items.length,artifact_structure:{presentation:draft.presentation,items:draft.items},text:draft.markdown};
}
function inside(node,owner){for(let current=node.owner;current;current=current.parentElement)if(current===owner)return true;return false;}
function openDetails(x){
 const child=x.child();assert.ok(child?.isConnected,"current workbench exists");
 // Native <details> state is a deterministic DOM port, not a component method
 // replacement. Reacquire each current node; every input below must be visible.
 for(const node of x.f.tree().nodes.filter(row=>row.tag==="details"&&inside(row,child))){assert.ok(node.port?.isConnected);node.port.open=true;}
}
function fields(x){
 openDetails(x);const child=x.child();
 return x.f.tree().nodes.filter(row=>{
  if(!["input","textarea","select"].includes(row.tag)||!inside(row,child)||row.hiddenBy)return false;
  // Video's preceding native playback controls are not authored draft fields.
  // Keep all fields in the actual workbench's primary authoring fieldset.
  for(let parent=row.parent;parent;parent=parent.parent)if(parent.tag==="fieldset"&&String(parent.attributes.class).split(/\s/u).includes("output-input-primary"))return true;
  return false;
 });
}
function descriptors(draft){
 const out=[{value:draft.title,edit:"C title"+unicode},{value:draft.summary,edit:"C summary"+unicode},{value:draft.markdown,edit:"C manuscript"+unicode}];
 if(draft.kind==="slides"&&draft.presentation){
  const p=draft.presentation;out.push({value:p.theme,edit:"C theme"+unicode},{value:p.footerLabel,edit:"C footer"+unicode},
   {value:p.stylePreset,edit:"editorial",event:"change"},{value:p.mode,edit:"dark",event:"change"},
   ...Object.entries(p.palette).map(([key,value],index)=>({value,edit:["#010203","#fefdfc","#654321","#a1b2c3","#d4e5f6"][index],key})));
 }
 for(const item of draft.items){
  out.push({value:item.title,edit:"C item title"+unicode},{value:item.body,edit:"C item body"+unicode},{value:item.notes,edit:"C item notes"+unicode},{value:item.image_prompt,edit:"C item visual"+unicode});
  if(item.slide){const s=item.slide;out.push({value:s.kicker,edit:"C kicker"+unicode},{value:s.layout,edit:"comparison",event:"change"},
   {value:s.bullets.join("\n"),edit:"C bullet one\nC bullet two"},{value:s.visual.label,edit:"C visual label"+unicode},{value:s.visual.value,edit:"C visual value"+unicode},
   {value:s.visual.kind,edit:"comparison",event:"change"},
   ...s.visual.data.flatMap(d=>[{value:d.label,edit:"C datum"+unicode},{value:d.value,edit:"50%"}]));}
 }
 return out;
}
function assertVisibleDraft(x,expected){
 assert.deepEqual(x.child().draft,expected,"complete detached draft equals the expected current/owned input");
 const actual=fields(x).map(row=>row.properties.value??row.attributes.value??"");
 assert.deepEqual(actual,descriptors(expected).map(row=>row.value),"every current visible text, setting and nested field is rendered from that same complete input");
}
async function typeAll(x){
 const count=descriptors(x.child().draft).length;
 for(let index=0;index<count;index++){
  const plan=descriptors(x.child().draft)[index],node=fields(x)[index];
  assert.ok(node.port?.isConnected&&!node.hiddenBy);assert.ok(!Object.hasOwn(node.attributes,"disabled"));
  await x.f.act(node,plan.event??"input",{target:{value:plan.edit},currentTarget:{value:plan.edit}});
 }
 return x.child().draft;
}
const postsSince=(x,start)=>x.host.requests.slice(start).filter(request=>(request.init.method??"GET")!=="GET");
const notes=x=>x.f.tree().visible("small").filter(row=>row.owner===x.owner()&&row.attributes.class==="context-draft-note").length;
async function peerProperties(x,patch){
 const block=x.f.store.projection.get().libraryBlocks.find(row=>row.id===targetId);
 const events=Object.entries(patch).map(([property_path,new_value])=>({type:"BlockPropertyEdited",payload:{block_id:targetId,property_path,
  old_value:block.properties[property_path]??null,new_value,source_surface:"structured-source-peer-fixture"}}));
 const response=await x.worker.request("/api/events",json({action:events.length>1?"batch":"append",event:events[0],events,expectedSequence:x.f.store.head.get(),clientId:"web:structured-source-peer"}));
 assert.equal(response.status,200,await response.clone().text());await x.refresh();
}
async function cancelVisible(x){
 const owner=x.owner();const button=x.f.find("button",row=>{
  if(row.owner!==owner||row.attributes.type!=="button"||row.attributes.class!=="button ghost")return false;
  for(let parent=row.parent;parent;parent=parent.parent)if(parent.tag==="form"&&String(parent.attributes.class).split(/\s/u).includes("block-editor"))return true;
  return false;
 });
 await x.f.act(button);
}
function unchangedMoney(x){assert.deepEqual(x.financial(),x.financialBefore);assert.equal(networkCalls,0);}

for(const kind of DOCUMENT_ARTIFACT_KINDS)for(const posture of["open","reentry"])test("structured fields: "+kind+" complete clean peer input while "+posture,async t=>{
 const x=await currentPage(t,kind==="audio"?"ja":"en",propertiesFor(fullDraft(kind,"A"))),start=x.host.requests.length,child=x.child();
 if(posture==="reentry")await x.f.act(x.toggle());
 await x.peer(fullDraft(kind,"B"));const canonical=x.state();
 if(posture==="reentry")await x.f.act(x.toggle());
 assert.equal(x.child(),child,"same-kind cache keeps the actual child instance");assertVisibleDraft(x,canonical);
 const head=x.eventHead();assert.deepEqual(postsSince(x,start),[],"a source refresh does not invoke Save");
 await x.saveVisible();assert.equal(x.eventHead(),head,"fresh visible Save of clean current fields produces no rollback event");
 assert.deepEqual(x.state(),canonical);assert.deepEqual(postsSince(x,start),[]);unchangedMoney(x);
});

for(const kind of DOCUMENT_ARTIFACT_KINDS)test("structured fields: "+kind+" every user-authored field survives a complete peer update",async t=>{
 const x=await currentPage(t,kind==="slides"?"ar":"en",propertiesFor(fullDraft(kind,"A"))),start=x.host.requests.length;
 const owned=await typeAll(x);assertVisibleDraft(x,owned);
 const detached=x.child().draft;detached.items[0].body="MUTATE ONLY DETACHED CLONE";assert.deepEqual(x.child().draft,owned,"public getter never aliases retained private fields");
 await x.f.act(x.toggle());assert.equal(notes(x),1);await x.peer(fullDraft(kind,"B"));assert.equal(notes(x),1);
 await x.f.act(x.toggle());assertVisibleDraft(x,owned);assert.deepEqual(postsSince(x,start),[]);
 await x.saveVisible();assert.deepEqual(x.state(),owned,"only the explicit current Save commits the complete intended draft");
 assert.deepEqual(postsSince(x,start).map(row=>row.url),["/api/events"]);unchangedMoney(x);
});

for(const locale of["en","fr","ar","ja"])test("structured fields: "+locale+" full equality removes the badge but never removes explicit ABA intent",async t=>{
 const x=await currentPage(t,locale),start=x.host.requests.length,original=x.state();
 await x.input("title","Temporary authored title");await x.input("title",original.title);assert.deepEqual(x.child().draft,original);
 await x.f.act(x.toggle());assert.equal(notes(x),0,"full exact equality has no false unsaved claim");
 await x.peer();assert.equal(notes(x),1,"the still-owned original intent differs from new peer input");
 await x.f.act(x.toggle());assertVisibleDraft(x,original);await x.f.act(x.toggle());
 await x.peer(original);assert.equal(notes(x),0,"current peer equality removes only the difference badge");
 await x.peer({...original,summary:"Another later canonical summary"});assert.equal(notes(x),1);
 await x.f.act(x.toggle());assertVisibleDraft(x,original);assert.deepEqual(postsSince(x,start),[]);
 await x.saveVisible();assert.deepEqual(x.state(),original);assert.deepEqual(postsSince(x,start).map(row=>row.url),["/api/events"]);unchangedMoney(x);
});

for(const locale of["en","fr","ar","ja"])test("structured fields: "+locale+" unchanged objects and unrelated metadata do not reset a clean editor",async t=>{
 const x=await currentPage(t,locale,propertiesFor(fullDraft("slides","A"))),child=x.child(),original=x.state(),start=x.host.requests.length;
 const reset=child.reset;let resets=0;t.mock.method(child,"reset",function(...args){resets++;return reset.apply(this,args);});
 await x.refresh();await x.f.settle();await peerProperties(x,{weight:0.8});await x.refresh();await x.f.settle();
 assert.equal(x.child(),child);assertVisibleDraft(x,original);assert.equal(resets,0,"same complete canonical draft must not be reset for object churn or weight changes");
 assert.deepEqual(postsSince(x,start),[]);await x.f.act(x.toggle());assert.equal(notes(x),0);unchangedMoney(x);
});

for(const locale of["en","fr","ar","ja"])test("structured fields: "+locale+" Cancel returns all fields to the current peer input",async t=>{
 const x=await currentPage(t,locale,propertiesFor(fullDraft("slides","A"))),start=x.host.requests.length;
 await x.input("title","Canceled local title");await x.peer(fullDraft("slides","B"));const current=x.state();
 await cancelVisible(x);
 assert.equal(x.f.tree().visible("form").filter(row=>row.owner===x.owner()&&String(row.attributes.class).includes("block-editor")).length,0,"explicit Cancel ends editing");
 await x.f.act(x.toggle());assert.equal(notes(x),0);await x.f.act(x.toggle());assertVisibleDraft(x,current);
 const head=x.eventHead();await x.saveVisible();assert.equal(x.eventHead(),head);assert.deepEqual(postsSince(x,start),[]);unchangedMoney(x);
});

for(const identity of["source_artifact_id","source_artifact_kind"])for(const locale of["en","ja"])test("structured fields: "+locale+" changed "+identity+" owns a fresh editor",async t=>{
 const x=await currentPage(t,locale),old=x.child(),start=x.host.requests.length;
 await x.input("title","Private draft for original source");
 await peerProperties(x,{[identity]:identity==="source_artifact_id"?"another-existing-source-fixture":"scene"});
 assert.equal(old.isConnected,false,"the old source identity cannot retain a connected editor");
 assert.equal(notes(x),0);await x.f.act(x.toggle());assert.notEqual(x.child(),old);assertVisibleDraft(x,x.state());
 assert.notEqual(x.child().draft.title,"Private draft for original source");
 assert.deepEqual(postsSince(x,start),[]);unchangedMoney(x);
});

test("structured fields: an actual current lock prevents a fresh visible Save without erasing user intent",async t=>{
 const x=await currentPage(t,"en"),start=x.host.requests.length;
 await x.input("title","Owned draft before lock");const owned=x.child().draft;
 const response=await x.worker.request("/api/events",json({action:"append",event:{type:"BlockLocked",payload:{block_id:targetId,locked_by:"user"}},expectedSequence:x.f.store.head.get(),clientId:"web:structured-lock-peer"}));
 assert.equal(response.status,200,await response.clone().text());await x.refresh();
 assert.equal(x.owner().block.locked,true);assert.deepEqual(x.child().draft,owned);
 const head=x.eventHead();await x.saveVisible();assert.equal(x.eventHead(),head);assert.deepEqual(postsSince(x,start),[]);
 assert.ok(x.f.tree().nodes.filter(row=>row.tag==="fieldset"&&inside(row,x.child())).every(row=>Object.hasOwn(row.attributes,"disabled")),"native structured fields remain disabled by the current lock");
 unchangedMoney(x);
});

for(const denial of["author","evidence"])test("structured fields: current "+denial+" guard never becomes a fresh Save grant",async t=>{
 const x=await currentPage(t,"en"),start=x.host.requests.length;
 await x.input("title","Local draft before current guard");
 if(denial==="author"){
  // Projected session permission is the existing component guard port; this
  // is not a claim of another real user's membership revocation.
  const session=x.f.store.session.get();x.f.store.session.set({...session,capabilities:session.capabilities.filter(value=>value!=="project.author")});await x.f.settle();
  assert.equal(x.f.tree().visible("form").filter(row=>row.owner===x.owner()&&String(row.attributes.class).includes("block-editor")).length,0);
 }else{
  // Existing verified-evidence projection boundary. No attempt is made to
  // forge such evidence through the Worker or confer authoring permission.
  x.f.appendEvent("BlockPropertyEdited",{block_id:targetId,property_path:"source_evidence_hash",old_value:null,new_value:"fixture-current-verified-evidence"});await x.f.settle();
  const head=x.eventHead();await x.saveVisible();assert.equal(x.eventHead(),head);
 }
 assert.deepEqual(postsSince(x,start),[]);unchangedMoney(x);
});

for(const posture of["clean","edited"])test("structured fields: standalone child "+posture+" source continuity uses the actual public component",async t=>{
 const x=await currentPage(t,"en",propertiesFor(fullDraft("slides","A"))),start=x.host.requests.length;
 // Component-only coverage of the existing public standalone option. Current
 // app parents remain embedded; no nested standalone form is mounted in them.
 const editor=new (x.child().constructor)();
 editor.tag="forma-output-input-editor";editor.attributes={};editor.standalone=true;
 const renderer=new (x.f.renderer.constructor)(x.f,x.f.renderer.registry);
 const render=()=>{editor.block=x.f.store.projection.get().libraryBlocks.find(block=>block.id===targetId);renderer.draw(editor);};
 t.after(()=>{editor.isConnected=false;editor.disconnectedCallback();for(const {instance}of renderer.instances.values()){instance.isConnected=false;instance.disconnectedCallback();}});
 render();assert.deepEqual(editor.draft,x.state());
 const title=()=>renderer.ownNodes(editor,"input")[0];
 assert.equal(title().properties.value,x.state().title);assert.equal(renderer.ownNodes(editor,"form").length,1);
 if(posture==="edited"){
  const field=title();assert.equal(typeof field.handlers.input,"function");
  field.handlers.input.call(editor,{target:{value:"Standalone authored title"+unicode},currentTarget:field});
  render();
 }
 const owned=editor.draft;
 await x.peer(fullDraft("slides","B"));render();
 assert.deepEqual(editor.draft,posture==="clean"?x.state():owned);
 assert.equal(title().properties.value,(posture==="clean"?x.state():owned).title);
 const clone=editor.draft;clone.items[0].body="detached clone only";assert.notEqual(editor.draft.items[0].body,clone.items[0].body);
 editor.reset();render();assert.deepEqual(editor.draft,x.state(),"explicit reset ends standalone user intent");
 assert.deepEqual(postsSince(x,start),[]);unchangedMoney(x);
});
