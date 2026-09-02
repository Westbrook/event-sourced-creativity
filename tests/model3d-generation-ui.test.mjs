import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./inactive-generation-dialog-host.test.mjs";
import { DEFAULT_MODEL3D_SETTINGS } from "../src/model/model3d.ts";

function configured(){
  const f=fixture(),session=f.store.session.get;
  f.store.session.get=()=>{const value=session();return{...value,provider:{...value.provider,model3dConfigured:true}};};
  return f;
}
function change(f,prompt,settings=structuredClone(DEFAULT_MODEL3D_SETTINGS),valid=true){
  const editor=f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0];
  assert.ok(editor);
  editor.handlers["model3d-settings-change"].call(f.host,{detail:{prompt,settings,valid}});f.draw();
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

test("3D generation form blocks an overlong prompt even if a child reports valid",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);
  const prompt="🫖".repeat(1025);change(f,prompt);
  await submit(f);await f.flush();
  assert.equal(f.state.requests.length,0);
  assert.equal(f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0].properties.prompt,prompt);
  const generate=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="button primary");
  assert.ok(Object.hasOwn(generate.attributes,"disabled"));
});

test("3D cost approval dispatches exactly the reviewed prompt and supported settings",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);
  const prompt="  A glazed ceramic teapot 🫖\nwith a curved handle.  ";
  const settings={...structuredClone(DEFAULT_MODEL3D_SETTINGS),geometry_file_format:"obj",seed:42};
  change(f,prompt,settings);
  assert.match(f.renderer.markup,/Approve cost and generate 3D model/);
  await submit(f);await f.flush();
  assert.equal(f.state.requests.length,1);
  const [kind,request]=f.state.requests[0];
  assert.equal(kind,"model3d");assert.equal(request.model3dPrompt,prompt);
  assert.deepEqual(request.model3dSettings,settings);
  assert.deepEqual(request.model3dReferenceBlockIds,[]);
  assert.equal(request.productionMode,"manual");assert.equal(request.paidMediaConfirmed,true);
  assert.equal(typeof request.current,"function");
});

test("3D reference selection preserves explicit order and disallows a sixth image",async()=>{
  const f=configured();references(f);assert.equal(await f.open("model3d"),true);change(f,"");
  for(let index=0;index<5;index++){const input=candidateInputs(f)[index];input.handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();}
  assert.equal(candidateInputs(f).length,6);
  assert.ok(Object.hasOwn(candidateInputs(f)[5].attributes,"disabled"));
  candidateInputs(f)[5].handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();
  const later=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes["aria-label"]==="Move reference later");
  later.handlers.click.call(f.host,{});f.draw();
  await submit(f);await f.flush();
  assert.deepEqual(f.state.requests[0][1].model3dReferenceBlockIds,["image-2","image-1","image-3","image-4","image-5"]);
  assert.equal(f.state.requests[0][1].model3dPrompt,"");
});

test("3D selected references stay blocked when their source is removed",async()=>{
  const f=configured();references(f,1);assert.equal(await f.open("model3d"),true);change(f,"A teapot");
  candidateInputs(f)[0].handlers.change.call(f.host,{currentTarget:{checked:true}});f.draw();
  append(f,"BlockRemoved",{block_id:"image-1"});f.draw();
  await submit(f);await f.flush();assert.equal(f.state.requests.length,0);
  assert.match(f.renderer.markup,/selected image is unavailable|selected image is no longer available/);
});

test("3D deferred dispatch retires with its original authorization and clears private draft",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);change(f,"Private exact actor A model prompt");
  let resolve;const wait=new Promise(done=>{resolve=done;});
  f.store.renderDocumentArtifact=async(kind,options)=>{await wait;if(!options.current())return false;f.state.requests.push([kind,options]);return true;};
  await submit(f);f.state.authorization="actor-scope-b";f.emitAuthorization();f.draw();resolve();await f.flush();
  assert.equal(f.state.requests.length,0);
  assert.equal(await f.open("model3d"),true);
  assert.equal(f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0].properties.prompt,"");
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
