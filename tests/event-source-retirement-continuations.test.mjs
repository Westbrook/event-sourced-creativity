
import {test as nodeTest} from "node:test";import assert from "node:assert/strict";
import { writeFixture,input,eventPost,sceneDeferred,appendAuditEvent } from "./helpers/event-source-retirement-fixture.mjs";
import {sourceContinuationHost} from "./helpers/event-source-continuation-host.mjs";
import {wav} from "./output-asset-fixtures.mjs";
const test=(name,body)=>nodeTest(name,{timeout:12000},body);
const CASES=[
 {name:"Library reusable save",kind:"editor",method:"appendBatch",action:"save"},
 {name:"Creative new decision",kind:"creative",method:"append",action:"create"},
 {name:"Creative uploaded audio reference",kind:"creative",method:"appendBatch",action:"reference",reference:true},
 {name:"Creative ordinary copy",kind:"creative",method:"append",action:"duplicate"},
 {name:"Alternative ordinary copy",kind:"alternatives",method:"append",action:"copy"},
 {name:"Library copy",kind:"library",method:"copyLibraryBlockSet",action:"copy"},
 {name:"Context-picker copy",kind:"navigation",method:"copyLibraryBlockSet",action:"context"},
 {name:"Previous-work picker",kind:"navigation",method:"addArtifactAsContext",action:"previous"},
 {name:"Creative complete artifact copy",kind:"creative",method:"copyLibraryBlockSet",action:"duplicate",artifact:true},
 {name:"Alternative complete artifact copy",kind:"alternatives",method:"copyLibraryBlockSet",action:"copy",artifact:true},
 {name:"Prompt-fan image input",kind:"fan",method:"addImageOutputAsContext",action:"copy",image:true},
];
for(const spec of CASES)for(const withdrawn of[false,true])test(spec.name+" "+(withdrawn?"old completed response cannot continue after source retirement/recovery":"healthy exact success continues"),async t=>{
 const h=await writeFixture(t,{shared:false});retainActualUploadedMedia(h);let original=h.store.projection.get().libraryBlocks.find(block=>block.id==="scene-reuse-direction");assert.ok(original);
 if(spec.kind==="editor"){
  const seed={...input(h,"continuation-library"),payload:{...input(h,"continuation-library").payload,scope:"library"}};delete seed.payload.document_id;
  const rows=await h.store.append(seed);assert.ok(rows.length);original=h.store.projection.get().libraryBlocks.find(block=>block.id==="continuation-library");assert.ok(original);
 }
 if(spec.artifact){
  const adopted=await h.store.addArtifactAsContext("saved-scene-story",h.worker.documentId,"source-continuation-fixture",{reveal:false});
  assert.ok(adopted&&!("publication"in adopted));original=h.store.projection.get().libraryBlocks.find(block=>block.id===adopted.rootBlockId);assert.ok(original?.properties.source_artifact_id);
 }
 if(spec.image){
  // Existing historical media fixture: actual upload/custody and canonical
  // simulation event, never a fabricated provider charge or a real generation.
  const form=new FormData();form.append("file",new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64")],"source-fixture.png",{type:"image/png"}));
  form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");
  const upload=await h.worker.request("/api/media",{method:"POST",body:form});assert.equal(upload.status,200,await upload.clone().text());const media=await upload.json();
  await appendAuditEvent(h.worker.env,h.worker.streamId,"worker:renderer","GenerationCompleted",{project_id:h.worker.projectId,document_id:h.worker.documentId,object_ids:["source-continuation-image"],
   generation_id:"synthetic-historical-image",simulation:true,provider:"simulation",model_id:"fixture",media_url:media.url,media_type:"image/png",image_width:1,image_height:1,source_surface:"document"});
  await h.store.refreshEvents();original=h.store.projection.get().libraryOutputs.find(output=>output.id==="source-continuation-image");assert.ok(original?.mediaUrl);
 }
 if(spec.reference){const descriptor=Object.getOwnPropertyDescriptor(URL,"createObjectURL");Object.defineProperty(URL,"createObjectURL",{configurable:true,writable:true,value:undefined});t.after(()=>Object.defineProperty(URL,"createObjectURL",descriptor));}
 const {component,bind}=await sourceContinuationHost(t,h,spec.kind),routeRequests=[];const nativeRoute=h.store.setRoute.bind(h.store);
 t.mock.method(h.store,"setRoute",(...args)=>{routeRequests.push(args[0]);return nativeRoute(...args);});
 component.fixturePrepare({blockId:original.id,text:"Original A saved through actual Worker",creating:true,selected:"original-selection",...(spec.reference?{file:new File([wav()],"original-reference.wav",{type:"audio/wav"})}:{})});
 const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());const real=h.store[spec.method].bind(h.store);let result,invocations=0;const responses=[];
 h.intercept=async request=>{if(!eventPost(request))return;const response=await h.worker.request(request.url,request.init);responses.push({request:request.body,response:await response.clone().json(),status:response.status});return response;};
 t.mock.method(h.store,spec.method,async(...args)=>{invocations++;const value=await real(...args);result=value;
  entered.resolve();await gate.promise;return value;});
 const argument=spec.action==="context"?original.id:spec.action==="previous"?"saved-scene-story":original,pending=component.fixtureInvoke(spec.action,argument);
 await entered.promise;assert.equal(invocations,1);assert.ok(Array.isArray(result)?result.length:!!result&&!("publication"in result),"Actual successful original result: "+JSON.stringify({result,notice:h.store.ui.toast,appendFailure:h.store.appendFailure.get(),responses}).slice(0,6000));
 if(withdrawn){await h.deny();h.restore();await h.store.refreshEvents();bind();component.fixturePrepare({text:"New B after independently verified recovery",selected:"new-selection",...(spec.reference?{file:new File([wav()],"new-reference.wav",{type:"audio/wav"})}:{})});}
 const before=component.fixtureState(),beforeRoute=h.store.route.get(),beforeToast=h.store.ui.toast,posts=h.requests.filter(eventPost).length,routeCount=routeRequests.length;
 gate.resolve();await pending;bind();const after=component.fixtureState();
 assert.equal(h.requests.filter(eventPost).length,posts,"No old completion triggers another append or extraction");
 if(withdrawn){assert.deepEqual(after,before);assert.equal(h.store.route.get(),beforeRoute);assert.equal(h.store.ui.toast,beforeToast);assert.equal(routeRequests.length,routeCount);}
 else if(spec.kind==="editor")assert.equal(after.loaded,"");
 else if(spec.kind==="creative"&&spec.action==="reference"){assert.equal(after.pending,null);assert.notEqual(after.selected,before.selected);}
 else if(spec.kind==="creative"&&spec.action==="create"){assert.equal(after.creating,false);assert.notEqual(after.selected,before.selected);}
 else if(spec.kind==="creative"||spec.kind==="alternatives")assert.notEqual(after.selected,before.selected);
 else if(spec.kind==="navigation"||spec.kind==="fan")assert.equal(after.open,false);
 else if(spec.kind==="library")assert.deepEqual(routeRequests.slice(routeCount),["/"]);
 assert.ok(result);
});

// A real in-memory bucket port retains only bytes/metadata written by the
// actual upload route. It does not invent source rights or evidence.
function retainActualUploadedMedia(h){
 const rows=new Map();
 h.worker.env.MEDIA={
  async put(key,value,options={}){const bytes=new Uint8Array(await new Response(value).arrayBuffer());rows.set(key,{bytes,customMetadata:structuredClone(options.customMetadata??{}),httpMetadata:structuredClone(options.httpMetadata??{})});return{key};},
  async head(key){const row=rows.get(key);return row?{key,size:row.bytes.length,customMetadata:structuredClone(row.customMetadata),httpMetadata:structuredClone(row.httpMetadata),writeHttpMetadata(headers){for(const[name,value]of Object.entries(row.httpMetadata))if(name==="contentType")headers.set("content-type",value);}}:null;},
  async get(key){const row=rows.get(key);return row?{key,size:row.bytes.length,body:new Response(row.bytes).body,customMetadata:structuredClone(row.customMetadata),httpMetadata:structuredClone(row.httpMetadata),arrayBuffer:async()=>row.bytes.slice().buffer,writeHttpMetadata(headers){for(const[name,value]of Object.entries(row.httpMetadata))if(name==="contentType")headers.set("content-type",value);}}:null;},
  async delete(key){rows.delete(key);},
 };
 return rows;
}
function pngFile(name){return new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64")],name,{type:"image/png"});}

for(const kind of["creative","editor","related"])for(const withdrawn of[false,true])test(kind+" reference upload waits on actual image sampling "+(withdrawn?"without using a retired original intent":"and preserves healthy upload"),async t=>{
 const h=await writeFixture(t,{shared:false});retainActualUploadedMedia(h);const {component,bind}=await sourceContinuationHost(t,h,kind==="related"?"editor":kind);
 component.fixturePrepare({blockId:null,text:"Private native reference",...(kind==="related"?{relatedFile:pngFile("sample-delayed.png")}:{file:pngFile("sample-delayed.png")})});
 const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());
 const old=Object.getOwnPropertyDescriptor(globalThis,"createImageBitmap");
 Object.defineProperty(globalThis,"createImageBitmap",{configurable:true,writable:true,value:async()=>{entered.resolve();await gate.promise;return{width:1,height:1,close(){}};}});
 t.after(()=>old?Object.defineProperty(globalThis,"createImageBitmap",old):delete globalThis.createImageBitmap);
 const pending=component.fixtureInvoke(kind==="creative"?"reference":"save");await entered.promise;
 if(withdrawn){await h.deny();h.restore();await h.store.refreshEvents();bind();}
 gate.resolve();await pending;
 const uploads=h.requests.filter(request=>request.url==="/api/media"&&request.init.method==="POST");
 assert.equal(uploads.length,withdrawn?0:1);assert.equal(h.requests.filter(eventPost).length,withdrawn?0:1);
});
