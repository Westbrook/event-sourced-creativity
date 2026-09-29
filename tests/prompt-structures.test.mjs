import assert from "node:assert/strict";
import test from "node:test";
import { buildBoundedPromptRepresentation, buildBulletPrompt, buildPromptRepresentation, buildStructuredPrompt, buildXmlPrompt, effectivePromptPreference, IMAGE_PROMPT_MAX_CHARACTERS, PROMPT_TECHNIQUES } from "../src/model/prompt-structures.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";

const snapshot={
  document:{id:"doc-1",title:"Window study"},
  facts:[
    {block_id:"subject-1",type:"subject",role:"subject",intent:"include",effect:"must_include",handle:"subject/vessel",locked:true,properties:{text:"A hand-thrown glass vessel",weight:.9,spatial_scope:{kind:"aabb",aabb:{x:.6,y:.2,width:.3,height:.55},falloff:"soft",feather:.1}}},
    {block_id:"palette-1",type:"palette",role:"palette",intent:"prefer",effect:"prefer",handle:"palette/amber",properties:{label:"Restrained amber",colors:["#b96f42","#171c22"],weight:.7,spatial_scope:{kind:"region",region:"right",falloff:"contextual",feather:.2}}},
    {block_id:"avoid-1",type:"exclusion",role:"subject",intent:"avoid",effect:"must_not_include",handle:"avoid/people",properties:{text:"people under 20 years old",weight:1}},
  ],
  relationships:[{relation_id:"relation-1",from_block_id:"subject-1",to_block_id:"reference-1",kind:"subject_reference"}],
  standing_constraints:[{axis:"finish",polarity:"prefer",value:"restrained grain"}],pins:[],
};
const direction={title:"Amber threshold",rationale:"Protect the quiet field.",scene:"A vessel at the right edge in warm lateral light.",palette:["amber","ink"],next_moves:["compare"]};
const references=[{source:"uploaded-reference",blockId:"subject-1",referenceId:"ref-1",label:"Vessel reference",mimeType:"image/jpeg",mode:"preserve_subject"}];

test("compiles four stable prompt languages from one canonical document",()=>{
  const prompts=Object.fromEntries(PROMPT_TECHNIQUES.map((technique)=>[technique,buildPromptRepresentation(technique,snapshot,direction,references,{size:"1536x1024",quality:"high"})]));
  assert.match(prompts.prose,/Create one polished landscape image/);assert.match(prompts.prose,/people under 20 years old/);
  assert.match(prompts.bullets,/Document decisions:/);assert.match(prompts.bullets,/Decision 1/);assert.match(prompts.bullets,/Intent: avoid/);
  const json=JSON.parse(prompts.json);assert.equal(json.operation,"generate_image");assert.equal(json.aspect_ratio,"3:2");assert.equal(json.use_reference_images,1);assert.equal(json.reference_images[0].image.input_index,0);assert.equal(json.user_edited_layout.regions.length,3);assert.deepEqual(json.user_edited_layout.regions[0].bbox,{x0:.6,x1:.9,y0:.2,y1:.75});assert.equal(json.user_edited_layout.regions[1].color_palette[0].r,185);
  assert.match(prompts.xml,/^<\?xml version=/);assert.match(prompts.xml,/<image-generation-prompt schema-version="1">/);assert.match(prompts.xml,/<user-edited-layout>/);assert.match(prompts.xml,/people under 20 years old/);
  for(const [technique,prompt] of Object.entries(prompts))assert.doesNotMatch(prompt,/subject-1|palette-1|avoid-1|doc-1|ref-1|relation-1/,`${technique} must preserve meaning without leaking durable document identities`);
});

test("keeps JSON and XML structures deterministic while allowing missing optional data",()=>{
  assert.deepEqual(buildStructuredPrompt(snapshot,direction,references),buildStructuredPrompt(structuredClone(snapshot),structuredClone(direction),structuredClone(references)));
  assert.equal(buildXmlPrompt(snapshot,direction,references),buildXmlPrompt(structuredClone(snapshot),structuredClone(direction),structuredClone(references)));
  assert.doesNotThrow(()=>buildStructuredPrompt({facts:[]},{title:"Empty"},[]));
  assert.match(buildBulletPrompt({facts:[]},{title:"Empty"},[]),/No active document decisions/);
});

test("resolves prompt preferences from the narrowest applicable durable scope",()=>{
  const preferences=[
    {preference_kind:"prompt_technique",technique:"xml",scope:"account",scope_id:"user-1",authored_sequence:2},
    {preference_kind:"prompt_technique",technique:"json",scope:"project",scope_id:"project-1",authored_sequence:3},
    {preference_kind:"prompt_technique",technique:"bullets",scope:"collection",scope_id:"folder-1",authored_sequence:4},
    {preference_kind:"prompt_technique",technique:"prose",scope:"document",scope_id:"doc-1",authored_sequence:5},
  ];
  assert.equal(effectivePromptPreference(preferences,{documentId:"doc-1",collectionIds:["folder-1"],projectId:"project-1",accountId:"user-1"}).technique,"prose");
  assert.equal(effectivePromptPreference(preferences,{documentId:"doc-2",collectionIds:["folder-1"],projectId:"project-1",accountId:"user-1"}).technique,"bullets");
  assert.equal(effectivePromptPreference([], {documentId:"doc-1",collectionIds:[],projectId:"project-1"}).technique,"prose");
});

test("keeps complete mock and live-document prompt languages inside the provider character limit",()=>{
  const facts=BLOCK_TYPES.map((definition,index)=>({block_id:`block-${index}`,type:definition.type,role:definition.type,intent:index%6===0?"avoid":"include",effect:index%6===0?"must_not_include":"include",handle:`${definition.type}/${definition.label}`,properties:{text:definition.type==="output"?"UNSELECTED_OUTPUT_REQUIREMENT_MUST_NOT_BE_A_FACT":`Use a specific ${definition.label.toLowerCase()} decision with concrete visual detail and a coherent relationship to the scene.`,label:`${definition.label} decision`,subtype:definition.subtypes[0],weight:.75,spatial_scope:{kind:["document","region","aabb","subject","path"][index%5],region:"right",instruction:"the right portion of the composition",aabb:{x:.2,y:.2,width:.4,height:.5},subject_block_id:"block-4",subject_relation:"around",path:[{x:.1,y:.1},{x:.8,y:.1},{x:.8,y:.8},{x:.1,y:.8}],feather:.14,falloff:"contextual",polarity:"inside"}}}));
  const fullSnapshot={facts,relationships:facts.slice(0,12).map((fact,index)=>({relation_id:`relation-${index}`,from_block_id:fact.block_id,to_block_id:"block-19",kind:"style_reference",properties:{purpose:"creative-reference"}})),standing_constraints:["Prefer restrained light"]};
  for(const technique of PROMPT_TECHNIQUES){const prepared=buildBoundedPromptRepresentation(technique,fullSnapshot,direction,references);assert.equal(prepared.fits,true,technique);assert.ok(prepared.finalLength<=IMAGE_PROMPT_MAX_CHARACTERS,`${technique}: ${prepared.finalLength}`);assert.ok(BLOCK_TYPES.filter((definition)=>definition.type!=="output").every((definition)=>prepared.prompt.includes(definition.type)),technique);assert.doesNotMatch(prepared.prompt,/UNSELECTED_OUTPUT_REQUIREMENT_MUST_NOT_BE_A_FACT/,technique);}
  const verbose=buildBoundedPromptRepresentation("prose",{facts:[{block_id:"verbose",type:"direction",role:"direction",properties:{text:"detail ".repeat(9000)}}]},direction,[]);assert.equal(verbose.fits,true);assert.equal(verbose.compacted,true);assert.ok(verbose.finalLength<=IMAGE_PROMPT_MAX_CHARACTERS);assert.match(verbose.prompt,/characters compacted/);
});
