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
