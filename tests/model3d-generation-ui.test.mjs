import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./inactive-generation-dialog-fixture.mjs";
import { retainNativeSubmitForms, retainNativeClickDialogs } from "./helpers/deferred-focus-invokers.mjs";
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
  // Opt in only this actual host's existing native form/dialog EventParts.
  // RendererPort otherwise recreates native nodes and has no literal ancestry.
  const owners=new Set([f.host]);
  retainNativeSubmitForms(f,owners,node=>node.attributes.class==="document-artifact-dialog");
  retainNativeClickDialogs(f,owners,node=>node.attributes.class==="document-artifact-create");
  const draw=f.draw,queries=new WeakMap();
  f.draw=()=>{
    const result=draw(),dialogs=f.renderer.ownNodes(f.host,"dialog").filter(node=>node.attributes.class==="document-artifact-create"),
      forms=f.renderer.ownNodes(f.host,"form").filter(node=>node.attributes.class==="document-artifact-dialog");
    if(dialogs.length&&forms.length){
      assert.equal(dialogs.length,1);assert.equal(forms.length,1);
      const dialog=dialogs[0],form=forms[0];form.parentElement=dialog;
      if(!queries.has(dialog))queries.set(dialog,dialog.querySelector);
      dialog.querySelector=selector=>selector===":scope > form.document-artifact-dialog"
        ?form.isConnected&&form.parentElement===dialog?form:null:queries.get(dialog)(selector);
    }
    return result;
  };
  return f;
}
function change(f,settings=structuredClone(DEFAULT_MODEL3D_SETTINGS),valid=true){
  const editor=f.renderer.ownNodes(f.host,"forma-model3d-settings-editor")[0];
  assert.ok(editor);
  editor.handlers["model3d-settings-change"].call(f.host,{detail:{prompt:"A child cannot replace the document adaptation",settings,valid}});f.draw();
}
function submitNodes(f){
  const form=f.renderer.ownNodes(f.host,"form").find(node=>node.attributes.class==="document-artifact-dialog"),
    dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class==="document-artifact-create");
  assert.ok(form);assert.ok(dialog);assert.equal(form.parentElement,dialog);return{form,dialog};
}
function submitEvent(nodes){
  return{type:"submit",target:nodes.form,currentTarget:nodes.dialog,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;}};
}
function captureSubmit(f,event,nodes=submitNodes(f)){
  const listener=nodes.dialog.handlers.submit;
  // Baseline has no capture callback. Continue to its real bubble callback so
  // the focused baseline fails on its revised request, not a missing test hook.
  if(listener===undefined)return false;
  assert.equal(listener.capture,true);assert.equal(typeof listener.handleEvent,"function");
  event.currentTarget=nodes.dialog;listener.handleEvent.call(listener,event);return true;
}
function bubbleSubmit(f,event,nodes=submitNodes(f)){
  event.currentTarget=nodes.form;return nodes.form.handlers.submit.call(f.host,event);
}
function submit(f){const nodes=submitNodes(f),event=submitEvent(nodes);captureSubmit(f,event,nodes);return bubbleSubmit(f,event,nodes);}
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
  const nodes=submitNodes(f),event=submitEvent(nodes);captureSubmit(f,event,nodes);
  append(f,"BlockPropertyEdited",{block_id:"direction-A",property_path:"text",new_value:"A blue ceramic bird with a short curved beak"});
  await bubbleSubmit(f,event,nodes);await f.flush();
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


// These invoke actual emitted capture/current-bubble callbacks with finite DOM
// identity/event ports. They do not simulate browser scheduling or certify a
// native run; the unchanged browser fixture retains its trusted Enter guard.
const JADE='Create one jade <mesh> with a "curved" handle & matte sides. 🧊';
const COPPER='Create one copper <mesh> with a "curved" handle & polished sides. 🧊';
function direction(f,text){append(f,"BlockPropertyEdited",{block_id:"direction-A",property_path:"text",new_value:text});}
function selectKind(f,kind){
  const input=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.name==="artifact-kind"&&node.attributes.value===kind);
  assert.ok(input);input.handlers.change.call(f.host,{});f.draw();
}
function assertSameSubmitParts(before,after){
  assert.equal(after.form,before.form,"same actual submit EventPart form");
  assert.equal(after.dialog,before.dialog,"same actual dialog EventPart");
}

test("3D submit keeps the captured JADE basis across a COPPER rerender",async()=>{
  for(const duplicateCapture of[false,true]){
    const f=configured();direction(f,JADE);assert.equal(await f.open("model3d"),true);
    change(f,{...structuredClone(DEFAULT_MODEL3D_SETTINGS),geometry_file_format:"usdz",seed:42});
    const before=submitNodes(f),oldBubble=before.form.handlers.submit,event=submitEvent(before);
    const reviewed=f.store.documentModel3dAdaptation("A",0);assert.ok(reviewed.prompt.includes(JADE));
    const hadCapture=captureSubmit(f,event,before);
    direction(f,COPPER);f.draw();
    const after=submitNodes(f);assertSameSubmitParts(before,after);assert.notEqual(after.form.handlers.submit,oldBubble);
    assert.ok(f.store.documentModel3dAdaptation("A",0).prompt.includes(COPPER));
    if(duplicateCapture)captureSubmit(f,event,after);
    await bubbleSubmit(f,event,after);await f.flush();
    assert.equal(f.state.requests.length,0,"the same activation cannot approve newly rendered COPPER");
    assert.equal(hadCapture,true,"candidate uses the actual capture:true listener");
    const current=f.store.documentModel3dAdaptation("A",0);
    await submit(f);await f.flush();assert.equal(f.state.requests.length,1,"a fresh approval may submit COPPER");
    assert.equal(f.state.requests[0][1].model3dPrompt,current.prompt);
    assert.deepEqual(f.state.requests[0][1].model3dAdaptation,model3dAdaptationReceipt(current));
    assert.equal(f.state.requests[0][1].model3dSettings.geometry_file_format,"usdz");
    assert.equal(f.state.requests[0][1].model3dSettings.seed,42);
  }
});

test("3D unchanged submit basis survives rerender and is consumed exactly once",async()=>{
  const f=configured();direction(f,JADE);assert.equal(await f.open("model3d"),true);
  const before=submitNodes(f),event=submitEvent(before),oldBubble=before.form.handlers.submit;
  const reviewed=f.store.documentModel3dAdaptation("A",0);captureSubmit(f,event,before);f.draw();
  const after=submitNodes(f);assertSameSubmitParts(before,after);assert.notEqual(after.form.handlers.submit,oldBubble);
  await bubbleSubmit(f,event,after);await f.flush();assert.equal(f.state.requests.length,1);
  assert.equal(f.state.requests[0][1].model3dPrompt,reviewed.prompt);
  assert.deepEqual(f.state.requests[0][1].model3dAdaptation,model3dAdaptationReceipt(reviewed));
  assert.equal(f.state.requests[0][1].paidMediaConfirmed,true);
  assert.equal(await f.open("model3d"),true);const reopened=submitNodes(f);
  // Adversarial delivery of the consumed event: the weak marker has no prompt
  // payload, but neither another capture nor a later bubble may reauthorize it.
  event.target=reopened.form;event.defaultPrevented=false;captureSubmit(f,event,reopened);
  await bubbleSubmit(f,event,reopened);await f.flush();assert.equal(f.state.requests.length,1);
});

test("3D submit rejects missing and foreign event basis",async()=>{
  for(const mode of["missing","foreign-event"]){
    const f=configured();assert.equal(await f.open("model3d"),true);const nodes=submitNodes(f);
    if(mode==="foreign-event")captureSubmit(f,submitEvent(nodes),nodes);
    await bubbleSubmit(f,submitEvent(nodes),nodes);await f.flush();assert.equal(f.state.requests.length,0,mode);
  }
});

test("3D rejected capture cannot be replaced by a later valid capture",async()=>{
  for(const mode of["foreign-target","wrong-type","canceled","retired-opening","foreign-current-target"]){
    const f=configured();assert.equal(await f.open("model3d"),true);const nodes=submitNodes(f),event=submitEvent(nodes);
    if(mode==="foreign-target")event.target={...nodes.form};
    if(mode==="wrong-type")event.type="click";
    if(mode==="canceled")event.defaultPrevented=true;
    if(mode==="retired-opening")f.state.required=false;
    if(mode==="foreign-current-target"){
      const listener=nodes.dialog.handlers.submit;if(listener){assert.equal(listener.capture,true);event.currentTarget={...nodes.dialog};listener.handleEvent.call(listener,event);}
    }else captureSubmit(f,event,nodes);
    event.type="submit";event.target=nodes.form;event.defaultPrevented=false;f.state.required=true;
    captureSubmit(f,event,nodes);await bubbleSubmit(f,event,nodes);await f.flush();assert.equal(f.state.requests.length,0,mode);
  }
});

test("3D bubble rechecks form identity, event target, cancellation and opening",async()=>{
  for(const mode of["foreign-target","foreign-current-target","wrong-type","canceled","retired-opening"]){
    const f=configured();assert.equal(await f.open("model3d"),true);const nodes=submitNodes(f),event=submitEvent(nodes);captureSubmit(f,event,nodes);
    if(mode==="foreign-target")event.target={...nodes.form};
    if(mode==="wrong-type")event.type="click";
    if(mode==="canceled")event.defaultPrevented=true;
    if(mode==="retired-opening")f.state.required=false;
    if(mode==="foreign-current-target"){event.currentTarget={...nodes.form};await nodes.form.handlers.submit.call(f.host,event);}
    else await bubbleSubmit(f,event,nodes);
    await f.flush();assert.equal(f.state.requests.length,0,mode);
  }
});

test("3D captured approval cannot become another artifact kind",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);const before=submitNodes(f),event=submitEvent(before);captureSubmit(f,event,before);
  selectKind(f,"short_story");const after=submitNodes(f);assertSameSubmitParts(before,after);
  await bubbleSubmit(f,event,after);await f.flush();assert.equal(f.state.requests.length,0);
  await submit(f);await f.flush();assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0][0],"short_story");
});

test("3D captured approval cannot cross a closed and reopened dialog",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);const before=submitNodes(f),event=submitEvent(before);captureSubmit(f,event,before);
  await f.createClose();assert.equal(await f.open("model3d"),true);const after=submitNodes(f);
  await bubbleSubmit(f,event,after);await f.flush();assert.equal(f.state.requests.length,0);
  await submit(f);await f.flush();assert.equal(f.state.requests.length,1);
});

test("3D refusal survives private-source clearing before a new non-3D opening",async()=>{
  const f=configured();assert.equal(await f.open("model3d"),true);const before=submitNodes(f),event=submitEvent(before);captureSubmit(f,event,before);
  f.state.authorization="actor-scope-b";f.emitAuthorization();assert.equal(await f.open("short_story"),true);
  const after=submitNodes(f);
  // Deliver the original event to the new callback adversarially. This is a
  // callback-ownership test, not a claim that a native event changes its target.
  await bubbleSubmit(f,event,after);await f.flush();assert.equal(f.state.requests.length,0);
  await submit(f);await f.flush();assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0][0],"short_story");
});
