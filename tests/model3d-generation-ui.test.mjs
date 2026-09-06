import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./inactive-generation-dialog-host.test.mjs";
import { DEFAULT_MODEL3D_SETTINGS } from "../src/model/model3d.ts";
import { adaptDocumentToModel3d, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";

function configured(){
  const f=fixture(),session=f.store.session.get;
  f.store.session.get=()=>{const value=session();return{...value,provider:{...value.provider,model3dConfigured:true}};};
  f.store.documentGenerationRevision=()=>JSON.stringify([f.state.documentId,f.state.events]);
  f.store.documentModel3dAdaptation=(documentId,referenceCount)=>{
    const projection=f.store.projection.get();assert.equal(documentId,projection.documentId);
    return adaptDocumentToModel3d({facts:projection.blocks.map(block=>({block_id:block.id,type:block.type,handle:block.handle,position:block.position,locked:block.locked,active:Number(block.properties.weight??.5)>0,properties:block.properties})),relationships:projection.blockRelations},{referenceCount});
  };
  return f;
}
function change(f,settings=structuredClone(DEFAULT_MODEL3D_SETTINGS),valid=true){
  const editor=f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0];
  assert.ok(editor);
  editor.handlers["model3d-settings-change"].call(f.host,{detail:{prompt:"A child cannot replace the document adaptation",settings,valid}});f.draw();
}
function submit(f){
  const form=f.renderer.ownNodes(f.host,"form").find(node=>node.attributes.class==="document-artifact-dialog");
  assert.ok(form);return form.handlers.submit.call(f.host,{preventDefault(){}});
}
function append(f,type,payload){f.state.events.push({eventId:`model3d-${f.state.events.length}`,streamId:"stream",sequence:f.state.events.length+1,actor:"user:owner",correlationId:"fixture",occurredAt:"2026-08-31T00:00:00Z",type,payload:{project_id:"p",document_id:"A",...payload}});}
function references(f,count=6){
  for(let index=1;index<=count;index++){
    append(f,"ReferenceIngested",{reference_id:`reference-${index}`,rights_class:"asserted"});
    append(f,"BlockCreated",{block_id:`image-${index}`,type:"reference",handle:`reference/${index}`,position:`r${index}`,properties:{reference_id:`reference-${index}`,media_url:`/api/media/reference-${index}`,media_type:"image/png",label:`View ${index}`,intent:"include",weight:1,pixel_reference_mode:"preserve_composition"}});
  }
}
function candidateInputs(f){return f.renderer.ownNodes(f.host,"input").filter(node=>node.attributes.type==="checkbox");}

test("3D document form blocks unsupported settings even if a child reports valid",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);
  const settings={...structuredClone(DEFAULT_MODEL3D_SETTINGS),nonexistent_parameter:true};change(f,settings);
  await submit(f);await f.flush();
  assert.equal(f.state.requests.length,0);
  assert.deepEqual(f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0].properties.settings,settings);
  const generate=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="button primary");
  assert.ok(Object.hasOwn(generate.attributes,"disabled"));
});

test("3D Render document derives and dispatches the reviewed document without requiring a prompt",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);
  const settings={...structuredClone(DEFAULT_MODEL3D_SETTINGS),geometry_file_format:"obj",seed:42};
  change(f,settings);
  const editor=f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0];
  const adaptation=f.store.documentModel3dAdaptation("A",0);
  assert.equal(editor.attributes["prompt-source"],"document");assert.equal(editor.properties.prompt,adaptation.prompt);
  assert.equal(adaptation.valid,true);assert.ok(adaptation.prompt.includes("Keep all original evidence for A"));
  assert.ok(adaptation.suggestions.length>0,"missing optional block types do not prevent useful adaptation");
  assert.match(f.renderer.markup,/Approve cost and generate 3D model/);
  assert.doesNotMatch(f.renderer.markup,/artifact-request-summary|Let the document decide|Each field allows up to/);
  await submit(f);await f.flush();
  assert.equal(f.state.requests.length,1);
  const [kind,request]=f.state.requests[0];
  assert.equal(kind,"model3d");assert.equal(request.model3dPrompt,adaptation.prompt);
  assert.equal(request.model3dPromptSource,"document");assert.deepEqual(request.model3dAdaptation,model3dAdaptationReceipt(adaptation));
  assert.doesNotMatch(request.model3dPrompt,/A child cannot replace/);
  assert.deepEqual(request.model3dSettings,settings);
  assert.deepEqual(request.model3dReferenceBlockIds,[]);
  assert.equal(request.productionMode,"manual");assert.equal(request.paidMediaConfirmed,true);
  assert.equal(typeof request.current,"function");
});

test("3D reference selection preserves explicit order and disallows a sixth image",async()=>{
  const f=configured();references(f);assert.equal(await f.open("model3d"),true);change(f);
  for(let index=0;index<5;index++){const input=candidateInputs(f)[index];input.handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();}
  assert.equal(candidateInputs(f).length,6);
  assert.ok(Object.hasOwn(candidateInputs(f)[5].attributes,"disabled"));
  candidateInputs(f)[5].handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();
  const later=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes["aria-label"]==="Move reference later");
  later.handlers.click.call(f.host,{});f.draw();
  await submit(f);await f.flush();
  assert.deepEqual(f.state.requests[0][1].model3dReferenceBlockIds,["image-2","image-1","image-3","image-4","image-5"]);
  assert.equal(f.state.requests[0][1].model3dPrompt,f.store.documentModel3dAdaptation("A",5).prompt);
});

test("3D selected references stay blocked when their source is removed",async()=>{
  const f=configured();references(f,1);assert.equal(await f.open("model3d"),true);change(f);
  candidateInputs(f)[0].handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();
  append(f,"BlockRemoved",{block_id:"image-1"});f.draw();
  await submit(f);await f.flush();assert.equal(f.state.requests.length,0);
  assert.match(f.renderer.markup,/selected image is unavailable|selected image is no longer available/);
});

test("3D deferred document dispatch retires with its original authorization and clears private controls",async()=>{
  const f=configured();append(f,"BlockPropertyEdited",{block_id:"direction-A",property_path:"text",new_value:"Private actor A model direction"});
  assert.equal(await f.open("model3d"),true);change(f,{...structuredClone(DEFAULT_MODEL3D_SETTINGS),seed:42});
  let resolve;const wait=new Promise(done=>{resolve=done;});
  f.store.renderDocumentArtifact=async(kind,options)=>{await wait;if(!options.current())return false;f.state.requests.push([kind,options]);return true;};
  await submit(f);f.state.authorization="actor-scope-b";f.emitAuthorization();f.changeDocument("B");f.draw();resolve();await f.flush();
  assert.equal(f.state.requests.length,0);
  assert.equal(await f.open("model3d"),true);
  const editor=f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0];
  assert.doesNotMatch(editor.properties.prompt,/Private actor A/);assert.equal(editor.properties.settings.seed,null);
});

test("an older Document form cannot submit after its reviewed context changes",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);
  const oldForm=f.renderer.ownNodes(f.host,"form").find(node=>node.attributes.class==="document-artifact-dialog");
  append(f,"BlockPropertyEdited",{block_id:"direction-A",property_path:"text",new_value:"A blue ceramic bird with a short curved beak"});
  await oldForm.handlers.submit.call(f.host,{preventDefault(){}});await f.flush();
  assert.equal(f.state.requests.length,0);
  const prepared=f.store.documentModel3dAdaptation("A",0);assert.equal(prepared.valid,true);
  await submit(f);await f.flush();assert.equal(f.state.requests.length,1);
  assert.equal(f.state.requests[0][1].model3dPrompt,prepared.prompt);
});

test("3D receipt renders and copies the exact raw prompt and actual ordered pixel receipts",async()=>{
  const f=fixture("receipt"),raw="  Ceramic teapot 🫖\n  ";
  f.host.inspection={title:"Artifact inputs",subtitle:"3D model",prompt:raw.trim(),retained:true,receipt:{artifact_kind:"model3d",render:{
    model:"fal-ai/hyper3d/rodin/v2.5",submittedPrompt:raw,parameters:{geometry_file_format:"glb",tier:"Gen-2.5-High"},providerJobId:"original-request",
    referenceInputs:[{index:0,label:"Material view",mimeType:"image/png",byteLength:4321,sha256:"a".repeat(64)}],
  }}};
  f.host.open=true;f.draw();
  assert.ok(f.renderer.ownNodes(f.host,"textarea").some(node=>node.value===raw));
  assert.match(f.renderer.markup,/4,321 bytes/);assert.match(f.renderer.markup,/Pixels submitted/);
  assert.doesNotMatch(f.renderer.markup,/Prepared before failure/);
  const copy=f.renderer.ownNodes(f.host,"button").filter(node=>node.attributes.class==="button secondary compact")[0];
  await copy.handlers.click.call(f.host,{});assert.deepEqual(f.clipboard,[raw]);
});
