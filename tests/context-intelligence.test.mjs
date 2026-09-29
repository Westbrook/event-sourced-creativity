import assert from "node:assert/strict";
import test from "node:test";
import { blockTypeDefinition, suggestedSubtype } from "../src/model/block-types.ts";
import { ACTION_REFERENCE_ROLES, combinedContextRoleForBlockType, normalizeActionBlockReferences } from "../src/model/combined-context.ts";
import { appendDecompositionAddendum, contextResearchCandidates, createDecompositionPlan, decompositionIsGrounded, existingResearchSuggestion, newLearnedSuggestion } from "../src/model/context-intelligence.ts";
import { foldEvents } from "../src/model/events.ts";
import { productionClaims } from "../src/model/managed-production.ts";
import { providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { buildIdeogramCaption } from "../worker/ideogram-caption-adapter.ts";
import { adaptVideoPrompt } from "../worker/video-prompt-adapter.ts";

const block=(id,type,text,patch={})=>({id,type,handle:`${type}/${id}`,projectId:"project",documentId:"document",canvasId:"",scope:"document",position:id,removed:false,locked:false,properties:{text,subtype:suggestedSubtype(type)},sourceEvents:[],...patch});

test("action blocks expose meaningful scene subtypes and validated participant references",()=>{
  assert.ok(blockTypeDefinition("action")?.subtypes.includes("Interaction"));
  assert.ok(blockTypeDefinition("action")?.subtypes.includes("Possession or transfer"));
  assert.equal(combinedContextRoleForBlockType("action"),"scene");
  assert.deepEqual(normalizeActionBlockReferences([{block_id:"man",handle:"man",role:"actor"},{block_id:"man",handle:"man",role:"actor"},{block_id:"woman",handle:"woman",role:"counterparty"},{block_id:"bad",handle:"bad",role:"invented"}]),[{block_id:"man",handle:"man",role:"actor"},{block_id:"woman",handle:"woman",role:"counterparty"}]);
  assert.ok(ACTION_REFERENCE_ROLES.includes("location"));
});

test("decomposition extracts only source-grounded realities and rejects invented context",()=>{
  const source="A man and woman having an intense discussion at a bar.";
  const plan=createDecompositionPlan("source",source,[
    {id:"man",type:"subject",subtype:"Hero subject",label:"Man",text:"A man",source_excerpt:"man"},
    {id:"woman",type:"subject",subtype:"Hero subject",label:"Woman",text:"A woman",source_excerpt:"woman"},
    {id:"bar",type:"environment",subtype:"Interior",label:"Bar",text:"Bar",source_excerpt:"bar"},
    {id:"intensity",type:"emotion",subtype:"Energy level",label:"Intense",text:"Intense",source_excerpt:"intense"},
    {id:"discussion",type:"action",subtype:"Interaction",label:"Discussion",text:"Discussion between @man and @woman",source_excerpt:"discussion",participants:[{handle:"man",role:"actor"},{handle:"woman",role:"counterparty"}]},
    {id:"invented",type:"lighting",label:"Neon",text:"Neon lighting",source_excerpt:"bar"},
  ]);
  assert.deepEqual(plan.proposals.map((proposal)=>proposal.type),["subject","subject","environment","emotion","action"]);
  assert.equal(plan.proposals.at(-1).participants.length,2);
  assert.equal(decompositionIsGrounded(source,"Neon lighting","bar"),false);
  assert.equal(decompositionIsGrounded(source,"Discussion between @dragon and @alien","discussion"),false);
  assert.equal(decompositionIsGrounded("A red dog and blue cat","blue dog","dog"),false);
  assert.equal(decompositionIsGrounded("A man not wearing a coat","A man wearing a coat","A man not wearing a coat"),false);
  assert.equal(decompositionIsGrounded("Never show the logo","Show the logo","Never show the logo"),false);
  assert.equal(decompositionIsGrounded("Don’t show the logo","Show the logo","Don’t show the logo"),false);
  assert.equal(decompositionIsGrounded("Ne jamais montrer le logo","Montrer le logo","Ne jamais montrer le logo"),false);
  assert.equal(decompositionIsGrounded("لا تظهر الشعار","تظهر الشعار","لا تظهر الشعار"),false);
  assert.equal(decompositionIsGrounded("A dog chases a man","A man chases a dog","A dog chases a man"),false);
  assert.equal(decompositionIsGrounded("A man in red and a woman in blue","A woman in red","A man in red and a woman in blue"),false);
  assert.equal(decompositionIsGrounded("A red dog and a blue cat","red cat","A red dog and a blue cat"),false);
  assert.equal(decompositionIsGrounded("A man and a woman","A man or a woman","A man and a woman"),false);
  assert.equal(decompositionIsGrounded("A man carries his coat","her coat","his coat"),false);
  assert.equal(decompositionIsGrounded("Ilya rides on Pushkin","Ilya rides by Pushkin","Ilya rides on Pushkin"),false);
});

test("user-added context creates independently grounded addendum suggestions",()=>{
  const plan=createDecompositionPlan("source","A man at a bar",[]);
  const expanded=appendDecompositionAddendum(plan,"A leather book",[
    {type:"subject",text:"A book",source_excerpt:"book"},
    {type:"material",text:"Leather",source_excerpt:"leather"},
    {type:"style",text:"Gothic book",source_excerpt:"book"},
  ]);
  assert.deepEqual(expanded.addenda.map((proposal)=>proposal.text),["A book","Leather"]);
  assert.ok(expanded.addenda.every((proposal)=>proposal.addendum));
});

test("decomposition cannot invent participant handles, labels, or subtype context",()=>{
  const [proposal]=createDecompositionPlan("source","A man",[{type:"subject",text:"A man",source_excerpt:"man",label:"Dragon emperor",subtype:"Fire-breathing dragon emperor"}]).proposals;
  assert.equal(proposal.label,"A man");
  assert.equal(proposal.subtype,"Hero subject");
  assert.deepEqual(createDecompositionPlan("source","A man discussing",[{type:"action",text:"Discussing @dragon",source_excerpt:"discussing",participants:[{handle:"dragon",role:"actor"}]}]).proposals,[]);
  assert.deepEqual(createDecompositionPlan("source","A man discussing",[{type:"action",text:"Discussing @man",source_excerpt:"discussing",participants:[]}]).proposals,[]);
  assert.deepEqual(createDecompositionPlan("source","A man discussing",[{type:"action",text:"Discussing @dragon/man",source_excerpt:"discussing",participants:[{handle:"dragon/man",role:"actor"}]}]).proposals,[]);
});

test("research ranks current-document context above existing same-project decisions",()=>{
  const target=block("dog","subject","Blink dog carrying Ilya");
  const local=block("ilya","subject","Ilya riding the blink dog");
  const reusable=block("saddle","subject","Blink dog saddle",{scope:"library",documentId:""});
  const foreign=block("foreign","subject","Blink dog",{projectId:"other"});
  const ranked=contextResearchCandidates(target,[reusable,foreign,local],[],"document");
  assert.deepEqual(ranked.map((candidate)=>candidate.block.id),["ilya","saddle"]);
  assert.equal(existingResearchSuggestion({area:"inferred",block:local,reason:"Rider already exists",documentId:"document"}).scope,"document");
  assert.equal(existingResearchSuggestion({area:"inferred",block:reusable,reason:"Wrong scope",documentId:"document"}),null);
  assert.equal(existingResearchSuggestion({area:"related",block:reusable,reason:"Reusable saddle",documentId:"document"}).distance,1);
  const richTarget=block("rich-dog","subject","crimson velvet enchanted woodland moonlit guardian ancient silver saddle arcane");
  const unrelatedLocal=block("local-note","subject","A nearby person");
  const exactProject=block("project-match","subject","crimson velvet enchanted woodland moonlit guardian ancient silver saddle arcane",{scope:"library",documentId:""});
  assert.deepEqual(contextResearchCandidates(richTarget,[exactProject,unrelatedLocal],[],"document").map((candidate)=>candidate.block.id),["local-note","project-match"]);
});

test("learned suggestions are new and only expose safe licensed-image hosts",()=>{
  const existing=[block("dog","subject","Blink dog")];
  assert.equal(newLearnedSuggestion({id:"duplicate",type:"subject",text:"Blink dog"},existing),null);
  const suggestion=newLearnedSuggestion({id:"learned",type:"reference",text:"Blink dog reference",sourceUrl:"https://commons.wikimedia.org/wiki/File:Dog.jpg",imageUrl:"https://evil.example/dog.jpg",license:"CC BY-SA"},existing);
  assert.equal(suggestion.imageUrl,null);
  assert.equal(suggestion.blockId,null);
  assert.equal(suggestion.sourceUrl,"https://commons.wikimedia.org/wiki/File:Dog.jpg");
});

test("provider contexts preserve participant meaning without leaking durable participant identities",()=>{
  const input={blocks:[{id:"allowed-action-alias",type:"action",properties:{text:"Discussion between @man and @woman",block_references:[{block_id:"PRIVATE_PARTICIPANT_ID",handle:"@man",role:"actor"},{block_id:"ANOTHER_PRIVATE_ID",handle:"woman",role:"counterparty"}]}}]};
  for(const context of [providerFacingCreativeContext(input),providerFacingRenderingContext(input)]){
    const serialized=JSON.stringify(context);
    assert.doesNotMatch(serialized,/PRIVATE_PARTICIPANT_ID|ANOTHER_PRIVATE_ID/u);
    assert.match(serialized,/"role":"actor"/u);
    assert.match(serialized,/"handle":"man"/u);
  }
});

test("Action participant edits invalidate exact-source approvals for both affected blocks",()=>{
  const event=(sequence,type,payload)=>({eventId:`event-${sequence}`,streamId:"creative:test",sequence,occurredAt:"2026-08-26T00:00:00.000Z",recordedAt:"2026-08-26T00:00:00.000Z",actor:"user",clientId:"test",correlationId:`correlation-${sequence}`,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
  const history=[event(1,"ProjectCreated",{project_id:"project",name:"Project"}),event(2,"DocumentCreated",{document_id:"document",project_id:"project",title:"Document"}),event(3,"BlockCreated",{block_id:"action",document_id:"document",project_id:"project",type:"action",handle:"action/discuss",properties:{text:"Discusses @person"}}),event(4,"BlockCreated",{block_id:"person",document_id:"document",project_id:"project",type:"subject",handle:"subject/person",properties:{text:"A person"}}),event(5,"BlockRelationAdded",{relation_id:"participant",document_id:"document",project_id:"project",from_block_id:"action",to_block_id:"person",kind:"action_participant",properties:{participant_role:"actor"}}),event(6,"BlockRelationRemoved",{relation_id:"participant"})];
  const added=foldEvents(history.slice(0,5),Number.POSITIVE_INFINITY,"document","project");
  for(const id of ["action","person"])assert.ok(added.libraryBlocks.find((candidate)=>candidate.id===id).sourceEvents.includes("event-5"));
  const removed=foldEvents(history,Number.POSITIVE_INFINITY,"document","project");
  for(const id of ["action","person"])assert.ok(removed.libraryBlocks.find((candidate)=>candidate.id===id).sourceEvents.includes("event-6"));
});

test("authored Action decisions reach video without incorrectly recurring across every scene",()=>{
  const snapshot={facts:[{block_id:"action-interaction",type:"action",intent:"include",properties:{text:"Ilya gently nuzzles Pushkin beside the silver saddle.",weight:.8}}]};
  const video=adaptVideoPrompt("A quiet woodland clearing.",{snapshot,references:[],seconds:6,size:"1280x720",model:VIDEO_ADAPTER_CONTRACT.model,promptProfile:"positive-only"});
  assert.match(video.prompt,/ACTION: Ilya gently nuzzles Pushkin beside the silver saddle\./u);
  const image=buildIdeogramCaption(snapshot,{scene:"A quiet woodland clearing."},"A quiet woodland clearing.",[]);
  assert.equal(image.valid,true);assert.match(image.prompt,/Ilya gently nuzzles Pushkin beside the silver saddle\./u);assert.ok(image.includedBlockIds.includes("action-interaction"));
  const claim=productionClaims(snapshot).find((candidate)=>candidate.type==="action");
  assert.equal(claim?.text,"Ilya gently nuzzles Pushkin beside the silver saddle.");
  assert.equal(claim?.continuity,false);
});
