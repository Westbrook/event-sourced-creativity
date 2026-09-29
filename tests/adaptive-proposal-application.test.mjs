import assert from "node:assert/strict";
import test from "node:test";
import { BLOCK_TYPES, suggestedSubtype } from "../src/model/block-types.ts";
import { adaptiveProposalOptions, adaptiveProposalSelections, buildAdaptiveProposalApplication } from "../src/model/adaptive-proposal-application.ts";
const structure={interpretation:"One private paid plan.",active_decision:{type:"subject",label:"Subject",prompt:"Choose the next subject.",why:"Focus the work."},
  suggested_blocks:[{type:"subject",subtype:"Hero subject",label:"A considered subject",instruction:"Keep the full source-authorized subject description.",reason:"Focus.",relationship_to:"Existing audience"},
  {type:"environment",subtype:"Interior",label:"A setting",instruction:"Make this setting concrete.",reason:"Ground it.",relationship_to:"Subject"}],hidden_until_later:["Lighting"]};
const block=(id="existing-subject",extra={})=>({id,projectId:"p",documentId:"d",canvasId:"",scope:"document",type:"subject",handle:"subject/existing",position:"a1",removed:false,locked:false,
  sourceEvents:["created-existing"],properties:{text:"An existing authored subject.",label:"Existing subject",subtype:"Hero subject",authority:"authored",weight:.75},...extra});
const projection=(blocks=[block()])=>({projectId:"p",documentId:"d",libraryBlocks:blocks,blocks,libraryBlockRelations:[],blockRelations:[],documents:[{id:"d",projectId:"p",title:"Document",removed:false}],membership:{}});
function plan(selections=[{proposalId:"/suggested_blocks/0"}],extra={}){
 let id=0;return buildAdaptiveProposalApplication({projection:projection(),documentId:"d",canvasId:null,structure,executionId:"original-paid",bindingHash:"a".repeat(64),selections,createId:()=>["new-block","new-item","another-block"][id++],...extra});
}
test("adaptive proposal model: retained JSON-pointer IDs are stable and hidden-later text is not selectable",()=>{
 const options=adaptiveProposalOptions(structure);
 assert.deepEqual(options.map(item=>item.proposalId),["/active_decision","/suggested_blocks/0","/suggested_blocks/1"]);
 assert.equal(options[0].subtype,suggestedSubtype("subject"));assert.equal(options[1].relationshipTo,"Existing audience");
 assert.throws(()=>plan([{proposalId:"/hidden_until_later/0"}]),/invalid_selection/u);
});
test("adaptive proposal model: default creates without overwriting same-type facts or inventing semantic links",()=>{
 const original=structuredClone(structure),result=plan();
 assert.deepEqual(result.events.map(event=>event.type),["BlockCreated"]);assert.deepEqual(result.blockIds,["new-block"]);assert.equal(result.relationCount,0);
 assert.equal(result.events[0].payload.properties.accepted_from_execution_id,"original-paid");assert.equal(result.events[0].payload.properties.accepted_from_proposal_id,"/suggested_blocks/0");
 assert.equal(result.events[0].payload.properties.related_block_ids,undefined);assert.equal(result.events[0].payload.properties.block_references,undefined);
 assert.deepEqual(structure,original);
});
test("adaptive proposal model: precise human-edited whitespace and metadata survive without coercion",()=>{
 const text="  Complete human text.\nDo not rewrite this ending.  ",result=plan([{proposalId:"/suggested_blocks/0",edit:{label:"My title",text}}]);
 assert.equal(result.events[0].payload.properties.text,text);assert.equal(result.events[0].payload.properties.label,"My title");
 assert.equal(result.changes[0].text,text);
});
for(const definition of BLOCK_TYPES.filter(item=>item.type!=="reference"&&item.type!=="model3d"))test("adaptive proposal model: supported "+definition.type+" retains the existing vocabulary",()=>{
 const current={...structure,active_decision:{...structure.active_decision,type:definition.type}};
 const result=plan([{proposalId:"/active_decision"}],{structure:current});
 assert.equal(result.events[0].payload.type,definition.type);assert.equal(result.events[0].payload.properties.subtype,definition.subtypes[0]);
 if(definition.type==="audio")assert.deepEqual(Object.fromEntries(["audio_role","inform_generation","include_in_output","allow_provider_audio_transfer"].map(key=>[key,result.events[0].payload.properties[key]])),
   {audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false});
});
for(const type of ["reference","model3d"])test("adaptive proposal model: "+type+" must come from verified assets instead of text-only creation",()=>{
 const current={...structure,active_decision:{...structure.active_decision,type}};
 assert.throws(()=>plan([{proposalId:"/active_decision"}],{structure:current}),/adaptive_changes_invalid_edit/u);
 assert.throws(()=>adaptiveProposalSelections([{proposalId:"/active_decision",edit:{type}}]),/adaptive_changes_invalid_edit/u);
});
test("adaptive proposal model: explicit Canvas placement creates the native block and item together",()=>{
 const selection={proposalId:"/suggested_blocks/0",placement:{x:-120,y:340,w:300,h:210}},result=plan([selection],{canvasId:"board"});
 assert.deepEqual(result.events.map(event=>event.type),["BlockCreated","CanvasItemPlaced"]);
 assert.equal(result.events[0].payload.scope,"canvas");assert.equal(result.events[0].payload.canvas_id,"board");assert.equal(result.events[0].payload.document_id,undefined);
 assert.equal(result.events[1].payload.source_id,result.blockIds[0]);assert.equal(result.events[1].payload.item_id,result.canvasItemIds[0]);
 assert.deepEqual(Object.fromEntries(["x","y","w","h"].map(key=>[key,result.events[1].payload.frame[key]])),selection.placement);
});
test("adaptive proposal model: exact target ID is required for edits and every prior value is retained",()=>{
 const target=block("target"),other=block("other"),result=plan([{proposalId:"/suggested_blocks/0",targetBlockId:"target"}],{projection:projection([other,target])});
 assert.deepEqual(result.blockIds,["target"]);assert.equal(result.events.every(event=>event.type==="BlockPropertyEdited"&&event.payload.block_id==="target"),true);
 assert.equal(result.events.find(event=>event.payload.property_path==="text").payload.old_value,target.properties.text);
 assert.equal(result.events.some(event=>event.payload.block_id==="other"),false);
});
for(const[name,extra]of[
 ["locked",{locked:true}],["prohibit",{properties:{text:"Never lose this",intent:"prohibit"}}],
 ["exact text",{properties:{text:"Original",exact_text:"Original"}}],["protected phrases",{properties:{text:"Original",protected_phrases:["Original"]}}],
 ["governed",{properties:{text:"Original",organization_context_package_id:"package"}}],
 ["evidence",{properties:{text:"Original",source_evidence_hash:"proof"}}],
 ["artifact",{properties:{text:"Original",source_artifact_id:"derived"}}],
 ["output",{properties:{text:"Original",source_output_id:"image"}}],
 ["revoked rights",{properties:{text:"Original",rights_revoked:true}}],
])test("adaptive proposal model: protected "+name+" target cannot be overwritten",()=>{
 assert.throws(()=>plan([{proposalId:"/suggested_blocks/0",targetBlockId:"target"}],{projection:projection([block("target",extra)])}),/target_protected/u);
});
for(const[name,extra]of[
 ["foreign document",{documentId:"other"}],["foreign project",{projectId:"other"}],["Canvas block",{scope:"canvas",canvasId:"other",documentId:""}],["removed",{removed:true}],["type mismatch",{type:"direction"}],
])test("adaptive proposal model: "+name+" target is never silently substituted",()=>{
 assert.throws(()=>plan([{proposalId:"/suggested_blocks/0",targetBlockId:"target"}],{projection:projection([block("target",extra)])}),/target_unavailable/u);
});
for(const value of[
 null,{},[],[{proposalId:"/suggested_blocks/6"}],[{proposalId:"/suggested_blocks/00"}],[{proposalId:"/active_decision",events:[]}],
 [{proposalId:"/active_decision"},{proposalId:"/active_decision"}],[{proposalId:"/active_decision",targetBlockId:12}],
 [{proposalId:"/active_decision",edit:null}],[{proposalId:"/active_decision",edit:[]}],[{proposalId:"/active_decision",edit:{text:12}}],
 [{proposalId:"/active_decision",edit:{authority:"model"}}],[{proposalId:"/active_decision",edit:{text:"x".repeat(16001)}}],
 [{proposalId:"/active_decision",edit:{label:"x".repeat(161)}}],[{proposalId:"/active_decision",edit:{type:"not-a-kind"}}],
 [{proposalId:"/active_decision",placement:{x:"2",y:0,w:10,h:10}}],[{proposalId:"/active_decision",placement:{x:NaN,y:0,w:10,h:10}}],
 [{proposalId:"/active_decision",placement:{x:0,y:Infinity,w:10,h:10}}],[{proposalId:"/active_decision",placement:{x:0,y:0,w:0,h:10}}],
 [{proposalId:"/active_decision",placement:{x:0,y:0,w:10,h:10,canvasId:"forged"}}],
])test("adaptive proposal model: malformed selection fails closed "+JSON.stringify(value).slice(0,110),()=>{
 assert.throws(()=>adaptiveProposalSelections(value),/adaptive_changes_/u);
});
test("adaptive proposal model: invalid provider subtype is surfaced for explicit human correction",()=>{
 const invalid={...structure,suggested_blocks:[{...structure.suggested_blocks[0],subtype:"Not a supported subtype"},structure.suggested_blocks[1]]};
 assert.throws(()=>plan(undefined,{structure:invalid}),/invalid_edit/u);
 assert.equal(plan([{proposalId:"/suggested_blocks/0",edit:{subtype:"Hero subject"}}],{structure:invalid}).events[0].payload.properties.subtype,"Hero subject");
});
test("adaptive proposal model: no implicit board position, document placement, or competing target updates",()=>{
 assert.throws(()=>plan(undefined,{canvasId:"board"}),/placement_required/u);
 assert.throws(()=>plan([{proposalId:"/active_decision",placement:{x:0,y:0,w:100,h:100}}]),/placement_required/u);
 assert.throws(()=>plan([{proposalId:"/active_decision",targetBlockId:"existing-subject"},{proposalId:"/suggested_blocks/0",targetBlockId:"existing-subject"}]),/duplicate_target/u);
});
