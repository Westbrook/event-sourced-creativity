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

test("replays a compensated document-open event back to the previous document",()=>{
  const events=[event(1,"DocumentCreated",{document_id:"doc-a",title:"A"}),event(2,"DocumentCreated",{document_id:"doc-b",title:"B"}),event(3,"DocumentOpened",{document_id:"doc-a",previous_document_id:"doc-b"}),event(4,"DocumentOpened",{document_id:"doc-b",previous_document_id:"doc-a"},"user","event-3")];
  assert.equal(foldEvents(events).documentId,"doc-b");
});
