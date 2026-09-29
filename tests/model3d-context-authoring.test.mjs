import assert from "node:assert/strict";
import test from "node:test";
import { createDecompositionPlan, newLearnedSuggestion, contextResearchCandidates } from "../src/model/context-intelligence.ts";
import { buildContextApplicationPlan } from "../src/model/context-proposal-application.ts";

const block=(id,type="subject",properties={})=>({id,projectId:"project",documentId:"document",scope:"document",type,handle:`${type}/${id}`,position:id,locked:false,removed:false,properties:{text:"A bronze bird",subtype:"Hero subject",...properties},sourceEvents:[]});
const proposal={key:"execution:bird",executionId:"execution",proposalId:"bird",decomposition:{id:"bird",type:"subject",subtype:"Hero subject",label:"Bronze bird",text:"A bronze bird",sourceExcerpt:"A bronze bird",participants:[],addendum:false}};

test("text decomposition and research cannot manufacture a model asset without uploaded bytes",()=>{
  const planned=createDecompositionPlan("source","A bronze bird",[{id:"model",type:"model3d",subtype:"Object",label:"Bronze bird",text:"A bronze bird",source_excerpt:"A bronze bird"}]);
  assert.deepEqual(planned.proposals,[]);
  assert.equal(newLearnedSuggestion({id:"model",type:"model3d",subtype:"Object",text:"A bronze bird"},[]),null);
  const target=block("target"),projection={libraryBlocks:[target],libraryBlockRelations:[]};
  assert.throws(()=>buildContextApplicationPlan({target,projection,proposals:[{...proposal,edit:{type:"model3d",subtype:"Object"}}]}),/invalid_edit/);
});

test("generic context authoring preserves an original model and cannot relabel it as text",()=>{
  const target=block("model","model3d",{model_url:"/api/media/owned.glb",model_content_hash:"a".repeat(64)});
  const projection={libraryBlocks:[target],libraryBlockRelations:[]};
  assert.throws(()=>buildContextApplicationPlan({target,projection,proposals:[proposal]}),/unavailable/);
  const disguised={...target,type:"subject"};
  assert.throws(()=>buildContextApplicationPlan({target:disguised,projection:{...projection,libraryBlocks:[disguised]},proposals:[proposal]}),/unavailable/);
  assert.deepEqual(contextResearchCandidates(block("text"),[target,disguised],[],"document"),[]);
});
