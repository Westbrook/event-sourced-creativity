import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";

const event=(sequence,type,payload,actor="user",compensatesEventId=null)=>({eventId:`event-${sequence}`,streamId:"stream-documents",sequence,occurredAt:new Date(Date.UTC(2026,7,10,12,0,sequence)).toISOString(),recordedAt:new Date(Date.UTC(2026,7,10,12,0,sequence)).toISOString(),actor,clientId:"test",correlationId:`corr-${sequence}`,causationId:null,compensatesEventId,schemaVersion:1,type,payload});

test("projects every document and opens a prior document without copying it",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project",name:"Document study"}),
    event(2,"DocumentCreated",{document_id:"doc-a",handle:"first",title:"First"}),
    event(3,"BlockCreated",{block_id:"block-a",document_id:"doc-a",type:"style",handle:"style/first",position:"a0",properties:{text:"First style"}}),
    event(4,"GenerationCompleted",{generation_id:"g-a",document_id:"doc-a",model_id:"m",object_ids:["output-a"]},"worker:generator"),
    event(5,"DocumentCreated",{document_id:"doc-b",handle:"second",title:"Second"}),
    event(6,"BlockCreated",{block_id:"block-b",document_id:"doc-b",type:"subject",handle:"subject/second",position:"a0",properties:{text:"Second subject"}}),
    event(7,"DocumentRenamed",{document_id:"doc-a",old_title:"First",new_title:"First renamed"}),
    event(8,"DocumentOpened",{document_id:"doc-a",previous_document_id:"doc-b"}),
  ];
  const projection=foldEvents(events);
  assert.equal(projection.documents.length,2);
  assert.equal(projection.documentId,"doc-a");assert.equal(projection.documentTitle,"First renamed");
  assert.deepEqual(projection.blocks.map((block)=>block.id),["block-a"]);
  assert.deepEqual(projection.outputs.map((output)=>output.id),["output-a"]);
});

test("switches project projections without copying cross-project documents",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-a",name:"First project"}),
    event(2,"DocumentCreated",{document_id:"doc-a",title:"First document"}),
    event(3,"BlockCreated",{block_id:"block-a",document_id:"doc-a",type:"direction",handle:"direction/a",position:"a0",properties:{text:"First"}}),
    event(4,"ProjectCreated",{project_id:"project-b",name:"Second project"}),
    event(5,"DocumentCreated",{document_id:"doc-b",title:"Second document"}),
    event(6,"ProjectOpened",{project_id:"project-a",previous_project_id:"project-b"}),
  ];
  const projection=foldEvents(events);
  assert.equal(projection.projectId,"project-a");assert.equal(projection.projectName,"First project");
  assert.deepEqual(projection.documents.map((document)=>document.id),["doc-a"]);assert.deepEqual(projection.blocks.map((block)=>block.id),["block-a"]);
  assert.deepEqual(projection.projects.map((project)=>project.id),["project-a","project-b"]);
});

test("keeps a URL-selected document and its project stable when later events open another project",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-a",name:"First project"}),
    event(2,"DocumentCreated",{project_id:"project-a",document_id:"doc-a",title:"First document"}),
    event(3,"BlockCreated",{block_id:"block-a",document_id:"doc-a",type:"direction",handle:"direction/a",position:"a0",properties:{text:"First direction"}}),
    event(4,"ProjectCreated",{project_id:"project-b",name:"Second project"}),
    event(5,"DocumentCreated",{project_id:"project-b",document_id:"doc-b",title:"Second document"}),
    event(6,"BlockCreated",{block_id:"block-b",document_id:"doc-b",type:"subject",handle:"subject/b",position:"a0",properties:{text:"Second subject"}}),
    event(7,"ProjectOpened",{project_id:"project-b",previous_project_id:"project-a"}),
    event(8,"DocumentOpened",{document_id:"doc-b",previous_document_id:"doc-a"}),
  ];
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,"doc-a");
  assert.equal(projection.projectId,"project-a");
  assert.equal(projection.documentId,"doc-a");
  assert.deepEqual(projection.documents.map((document)=>document.id),["doc-a"]);
  assert.deepEqual(projection.blocks.map((block)=>block.id),["block-a"]);
});

test("replays a compensated document-open event back to the previous document",()=>{
  const events=[event(1,"DocumentCreated",{document_id:"doc-a",title:"A"}),event(2,"DocumentCreated",{document_id:"doc-b",title:"B"}),event(3,"DocumentOpened",{document_id:"doc-a",previous_document_id:"doc-b"}),event(4,"DocumentOpened",{document_id:"doc-b",previous_document_id:"doc-a"},"user","event-3")];
  assert.equal(foldEvents(events).documentId,"doc-b");
});

test("removes a document from active projections and restores it without erasing history",()=>{
  const events=[
    event(1,"DocumentCreated",{document_id:"doc-a",title:"A"}),
    event(2,"BlockCreated",{block_id:"block-a",document_id:"doc-a",type:"direction",handle:"direction/a",position:"a0",properties:{text:"A"}}),
    event(3,"GenerationCompleted",{generation_id:"generation-a",document_id:"doc-a",model_id:"model",object_ids:["output-a"]},"worker:generation"),
    event(4,"CollectionCreated",{collection_id:"collection-a",handle:"work",position:"a0"}),
    event(5,"CollectionItemAdded",{collection_id:"collection-a",item_ref:{document_id:"doc-a"},position:"a0"}),
    event(6,"DocumentCreated",{document_id:"doc-b",title:"B"}),
    event(7,"DocumentOpened",{document_id:"doc-a",previous_document_id:"doc-b"}),
    event(8,"DocumentRemoved",{document_id:"doc-a",was_current:true,fallback_document_id:"doc-b"}),
  ];
  const removed=foldEvents(events);
  assert.deepEqual(removed.documents.map((document)=>document.id),["doc-b"]);
  assert.equal(removed.documentId,"doc-b");
  assert.equal(removed.libraryBlocks.length,0);assert.equal(removed.libraryOutputs.length,0);assert.equal(removed.membership["doc-a"],undefined);

  const restored=foldEvents([...events,event(9,"DocumentRestored",events[7].payload,"user","event-8")]);
  assert.equal(restored.documents.length,2);assert.equal(restored.documentId,"doc-a");
  assert.deepEqual(restored.blocks.map((block)=>block.id),["block-a"]);assert.deepEqual(restored.outputs.map((output)=>output.id),["output-a"]);
  assert.equal(restored.membership["doc-a"].collectionId,"collection-a");
});

test("projects independent blocks beside documents and files both in the same collections",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-a",name:"Shared project"}),
    event(2,"DocumentCreated",{project_id:"project-a",document_id:"doc-a",title:"Document A"}),
    event(3,"BlockCreated",{block_id:"doc-block",document_id:"doc-a",type:"direction",handle:"direction/document",properties:{text:"Document context"}}),
    event(4,"BlockCreated",{block_id:"library-block",project_id:"project-a",scope:"library",type:"style",handle:"style/reusable",properties:{text:"Reusable context",forked_from_block_id:"doc-block"}}),
    event(5,"CollectionCreated",{collection_id:"collection-a",project_id:"project-a",handle:"Shared folder"}),
    event(6,"CollectionItemAdded",{collection_id:"collection-a",item_ref:{document_id:"doc-a"},position:"a0"}),
    event(7,"CollectionItemAdded",{collection_id:"collection-a",item_ref:{block_id:"library-block"},position:"a1"}),
  ];
  const projection=foldEvents(events);
  assert.deepEqual(projection.blocks.map((block)=>block.id),["doc-block"]);
  assert.deepEqual(projection.libraryBlocks.map((block)=>block.id),["doc-block","library-block"]);
  const reusable=projection.libraryBlocks.find((block)=>block.id==="library-block");
  assert.equal(reusable.scope,"library");assert.equal(reusable.projectId,"project-a");assert.equal(reusable.documentId,"");
  assert.equal(projection.membership["doc-a"].collectionId,"collection-a");
  assert.equal(projection.membership["library-block"].collectionId,"collection-a");
  assert.equal(projection.projects[0].blockCount,2);
});

test("versions generation-relevant block state changes",()=>{
  const projection=foldEvents([
    event(1,"DocumentCreated",{document_id:"doc-a",title:"A"}),
    event(2,"BlockCreated",{block_id:"block-a",document_id:"doc-a",type:"direction",handle:"direction/a",properties:{text:"Begin"}}),
    event(3,"BlockWeightSet",{block_id:"block-a",weight:.8}),
    event(4,"BlockLocked",{block_id:"block-a"}),
    event(5,"BlockRemoved",{block_id:"block-a"}),
    event(6,"BlockRestored",{block_id:"block-a"}),
  ]);
  const block=projection.blocks.find((item)=>item.id==="block-a");
  assert.deepEqual(block.sourceEvents,["event-2","event-3","event-4","event-5","event-6"]);
  assert.equal(block.properties.weight,.8);assert.equal(block.locked,true);
});

test("keeps project-scoped reusable blocks out of other project projections",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-a",name:"A"}),
    event(2,"DocumentCreated",{project_id:"project-a",document_id:"doc-a",title:"A"}),
    event(3,"BlockCreated",{block_id:"block-a",project_id:"project-a",scope:"library",type:"style",handle:"style/a",properties:{text:"A"}}),
    event(4,"ProjectCreated",{project_id:"project-b",name:"B"}),
    event(5,"DocumentCreated",{project_id:"project-b",document_id:"doc-b",title:"B"}),
    event(6,"BlockCreated",{block_id:"block-b",project_id:"project-b",scope:"library",type:"style",handle:"style/b",properties:{text:"B"}}),
    event(7,"ProjectOpened",{project_id:"project-a"}),
  ];
  assert.deepEqual(foldEvents(events).libraryBlocks.map((block)=>block.id),["block-a"]);
});

test("projects typed block relationships by project and document without merging either block",()=>{
  const events=[
    event(1,"ProjectCreated",{project_id:"project-a",name:"Connected context"}),
    event(2,"DocumentCreated",{project_id:"project-a",document_id:"doc-a",title:"A"}),
    event(3,"BlockCreated",{block_id:"subject-doc",document_id:"doc-a",type:"subject",handle:"subject/person",properties:{text:"A quiet portrait"}}),
    event(4,"BlockCreated",{block_id:"reference-doc",document_id:"doc-a",type:"reference",handle:"reference/person",properties:{label:"Portrait reference"}}),
    event(5,"BlockRelationAdded",{relation_id:"relation-doc",project_id:"project-a",document_id:"doc-a",from_block_id:"subject-doc",to_block_id:"reference-doc",kind:"subject_reference",properties:{purpose:"creative-reference"}}),
    event(6,"BlockCreated",{block_id:"style-library",project_id:"project-a",scope:"library",type:"style",handle:"style/editorial",properties:{text:"Restrained editorial finish"}}),
    event(7,"BlockCreated",{block_id:"reference-library",project_id:"project-a",scope:"library",type:"reference",handle:"reference/material",properties:{label:"Material reference"}}),
    event(8,"BlockRelationAdded",{relation_id:"relation-library",project_id:"project-a",from_block_id:"style-library",to_block_id:"reference-library",kind:"material_reference"}),
  ];
  const active=foldEvents(events);
  assert.deepEqual(active.blockRelations.map((relation)=>relation.id),["relation-doc"]);
  assert.deepEqual(active.libraryBlockRelations.map((relation)=>relation.id),["relation-doc","relation-library"]);
  assert.equal(active.libraryBlockRelations[0].kind,"subject_reference");
  const removed=foldEvents([...events,event(9,"BlockRelationRemoved",events[4].payload)]);
  assert.deepEqual(removed.blockRelations,[]);assert.deepEqual(removed.libraryBlockRelations.map((relation)=>relation.id),["relation-library"]);
  const restored=foldEvents([...events,event(9,"BlockRelationRemoved",events[4].payload),event(10,"BlockRelationAdded",events[4].payload,"user","event-9")]);
  assert.deepEqual(restored.blockRelations.map((relation)=>relation.id),["relation-doc"]);
});
