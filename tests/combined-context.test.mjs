import assert from "node:assert/strict";
import test from "node:test";
import { combinedContextGroups, combinedContextMemberships, combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { buildBulletPrompt, buildProsePrompt, buildStructuredPrompt, buildXmlPrompt } from "../src/model/prompt-structures.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { validateCanvasEvent } from "../worker/realtime/canvas-admission.ts";
import { generateDocumentArtifact } from "../worker/openai-adapter.ts";

const membership=(order)=>({context_set_id:"group-mara",name:"Mara field kit",role:"character",target:"Mara",application:"isolate",relativity:.92,member_order:order,source_canvas_id:"canvas-1"});
const snapshot={
  document:{id:"doc-1",title:"A meeting in the field"},
  facts:[
    {block_id:"subject-mara",type:"subject",role:"subject",handle:"subject/mara",properties:{text:"Mara, an adult field researcher",combined_context_memberships:[membership(0)]}},
    {block_id:"wardrobe-mara",type:"wardrobe",role:"wardrobe",handle:"wardrobe/mara",properties:{text:"A rust rain shell",combined_context_memberships:[membership(1)]}},
    {block_id:"prop-mara",type:"object",role:"object",handle:"object/mara-recorder",properties:{text:"A brass field recorder",combined_context_memberships:[membership(2)]}},
    {block_id:"subject-jon",type:"subject",role:"subject",handle:"subject/jon",properties:{text:"Jon in a blue work shirt"}},
  ],
  relationships:[],standing_constraints:[],pins:[],
};
const direction={title:"Field meeting",scene:"Mara and Jon meet beside the observatory."};

test("Combined Contexts compile as ordered, weighted isolation boundaries",()=>{
  const groups=combinedContextGroups(snapshot);assert.equal(groups.length,1);assert.equal(groups[0].target,"Mara");assert.equal(groups[0].relativity,.92);assert.deepEqual(groups[0].members.map((member)=>member.blockId),["subject-mara","wardrobe-mara","prop-mara"]);
  assert.match(combinedContextPromptDirectives(snapshot,"image")[0],/prevent their attributes from spreading|prevent their attributes|prevent.*spreading/i);
  assert.match(combinedContextPromptDirectives(snapshot,"short_story")[0],/same narrative moments/i);
  assert.match(combinedContextPromptDirectives(snapshot,"slides")[0],/contiguous run of slides/i);
  assert.match(combinedContextPromptDirectives(snapshot,"video")[0],/same shots or ordered shot range/i);
});

test("every prompt language carries the same Combined Context semantics",()=>{
  const prose=buildProsePrompt(snapshot,direction,[]),bullets=buildBulletPrompt(snapshot,direction,[]),structured=buildStructuredPrompt(snapshot,direction,[]),xml=buildXmlPrompt(snapshot,direction,[]);
  assert.match(prose,/Combined-context isolation map/);assert.match(prose,/Mara field kit/);
  assert.match(bullets,/Combined contexts/);assert.match(bullets,/92% group relativity/);
  assert.equal(structured.context_groups.length,1);assert.equal(structured.context_groups[0].target,"Mara");assert.equal(structured.context_groups[0].context_key,"context_group_1");assert.deepEqual(structured.user_edited_layout.regions.slice(0,3).map((region)=>region.context_group_ids),[["context_group_1"],["context_group_1"],["context_group_1"]]);
  for(const prompt of [prose,bullets,JSON.stringify(structured),xml])assert.doesNotMatch(prompt,/group-mara|subject-mara|wardrobe-mara|prop-mara|canvas-1|doc-1/,"provider-facing group semantics use request-local aliases instead of durable IDs");
  assert.match(xml,/<context-groups>/);assert.match(xml,/Mara field kit/);
});

test("story, scene, slides, storyboard, and video planning receive output-specific group isolation",async()=>{
  const originalFetch=globalThis.fetch;const requests=[];globalThis.fetch=async(_input,init={})=>{requests.push(JSON.parse(String(init.body)));return Response.json({id:"response-1",model:"gpt-test",output_text:JSON.stringify({title:"Field meeting",summary:"Mara's field kit remains specific to her.",content_markdown:"# Field meeting\n\nMara reaches for her recorder.",items:[{title:"Arrival",body:"Mara enters in the rust shell with the recorder.",notes:"Keep Jon visually distinct.",image_prompt:"Mara beside the observatory.",context_group_ids:["context_group_1"]}]}),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});};
  try{for(const kind of ["short_story","scene","storyboard","video"]){const result=await generateDocumentArtifact({OPENAI_API_KEY:"test"},"user-1",kind,{documentTitle:"Field meeting",snapshot,options:{itemCount:1}});assert.equal(result.inputReceipt.providerInput.combined_context_plan.length,1);assert.match(result.inputReceipt.providerInput.combined_context_plan[0].instruction,kind==="short_story"||kind==="scene"?/narrative moments/:/same shots or ordered shot range/);}
    assert.ok(requests.every((request)=>/Combined contexts are binding authorial units/.test(request.instructions)));
  }finally{globalThis.fetch=originalFetch;}
});

test("artifact planning keeps durable group IDs server-side and repairs stale provider assignments once",async()=>{
  const originalFetch=globalThis.fetch;let providerRequest;let providerAttempts=0;
  globalThis.fetch=async(_input,init={})=>{providerRequest=JSON.parse(String(init.body));const contextGroup=providerAttempts++===0?"historical-group-from-source-artifact":"context_group_1";return Response.json({id:`response-stale-${providerAttempts}`,model:"gpt-test",output_text:JSON.stringify({title:"Field meeting",summary:"One shot",content_markdown:"Mara crosses the field with her recorder.",items:[{title:"Field crossing",body:"Mara crosses the field.",notes:"One continuous shot.",image_prompt:"Mara crosses the field with her recorder.",context_group_ids:[contextGroup]}]}),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});};
  try{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-test"},"user-1","video",{documentTitle:"Field meeting",snapshot,options:{itemCount:1}});
    assert.deepEqual(result.output.items[0].context_group_ids,["group-mara"]);
    assert.equal(result.inputReceipt.providerInput.combined_context_plan[0].context_key,"context_group_1");
    assert.doesNotMatch(JSON.stringify(result.inputReceipt.providerInput),/group-mara|historical-group-from-source-artifact/);
    assert.deepEqual(result.inputReceipt.validation.context_group_resolution.initial.unknownAssignments,["historical-group-from-source-artifact"]);
    assert.equal(result.inputReceipt.validation.context_group_resolution.initial.deterministicallyAssigned,true);
    assert.equal(providerAttempts,2,"an unapproved provider alias receives exactly one bounded repair");
    assert.match(providerRequest.instructions,/context_key aliases|request-local Combined Context aliases/);
    assert.match(String(providerRequest.input),/context_group_1/);
  }finally{globalThis.fetch=originalFetch;}
});

test("older copied sets and storyboard sets gain compatible grouping semantics",()=>{
  const copied=combinedContextMemberships({context_set_id:"legacy-1",copied_as_context_set:true,weight:.7});assert.equal(copied.length,1);assert.equal(copied[0].application,"isolate");assert.equal(copied[0].relativity,.7);
  const storyboard=combinedContextMemberships({context_set_id:"story-1",reference_set_kind:"storyboard",storyboard_title:"Opening pursuit",storyboard_frame_index:4});assert.equal(storyboard[0].role,"sequence");assert.equal(storyboard[0].application,"ordered");assert.equal(storyboard[0].memberOrder,3);
});

test("Canvas admission and projection retain complete Combined Context controls",()=>{
  const formalized={type:"ContextSetFormalized",payload:{context_set_id:"group-mara",canvas_id:"canvas-1",project_id:"project-1",name:"Mara field kit",target:"Mara",role:"character",application:"isolate",relativity:.92,semantic_isolation:true,composite:true,item_ids:["item-1","item-2"]}};
  assert.equal(validateCanvasEvent(formalized),null);assert.equal(validateCanvasEvent({type:"ContextSetFormalized",payload:{...formalized.payload,role:"anything"}}),"invalid_combined_context_semantics");
  const events=[{type:"CanvasCreated",payload:{canvas_id:"canvas-1",project_id:"project-1",name:"Room"}},{type:"CanvasItemPlaced",payload:{canvas_id:"canvas-1",project_id:"project-1",item_id:"item-1",source_kind:"block",source_id:"block-1",frame:{x:0,y:0,w:100,h:100}}},formalized].map((event,index)=>({...event,eventId:`event-${index}`,streamId:"creative:test",sequence:index+1,occurredAt:"2026-01-01T00:00:00.000Z",recordedAt:"2026-01-01T00:00:00.000Z",actor:"user",clientId:"web:test",correlationId:"test",causationId:null,compensatesEventId:null,schemaVersion:1}));
  const group=foldCanvasEvents(events,"project-1","canvas-1").contextSets[0];assert.equal(group.role,"character");assert.equal(group.target,"Mara");assert.equal(group.application,"isolate");assert.equal(group.relativity,.92);
});
