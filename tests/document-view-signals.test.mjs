import assert from "node:assert/strict";
import test from "node:test";
import { documentViewWorkflow, preferredDocumentView } from "../src/model/document-view-signals.ts";
import { inferTasteBeliefs } from "../src/model/taste.ts";

const at=(sequence)=>new Date(Date.UTC(2026,7,13,12,0,sequence)).toISOString();
const event=(sequence,type,payload={},actor="user")=>({eventId:`view-${sequence}`,streamId:"creative:view-test",sequence,occurredAt:at(sequence),recordedAt:at(sequence),actor,clientId:"test",correlationId:"view-corr",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});

test("attributes direct progress and retained outcomes to the document view in use",()=>{
  const events=[
    event(1,"DocumentCreated",{document_id:"d1",title:"Study"}),
    event(2,"DocumentViewVisited",{document_id:"d1",view:"editor",focused:true}),
    event(3,"BlockPropertyEdited",{document_id:"d1",block_id:"b1",property_path:"text",new_value:"Quiet light",source_surface:"creative-editor"}),
    event(4,"GenerationRequested",{document_id:"d1",generation_id:"g1",source_surface:"creative-editor"}),
    event(5,"GenerationCompleted",{document_id:"d1",generation_id:"g1",object_ids:["o1"]},"worker:generator"),
    event(6,"ObjectSaved",{object_id:"o1"}),
    event(7,"DocumentViewVisited",{document_id:"d1",view:"chat",focused:false}),
    event(8,"ChatMessageSent",{document_id:"d1",source_surface:"chat"}),
  ];
  const workflow=documentViewWorkflow(events,"d1");
  assert.equal(workflow.usedViews,2);
  assert.equal(workflow.transitions,1);
  assert.equal(workflow.preferredView?.view,"editor");
  assert.equal(workflow.lastView?.view,"chat");
  assert.equal(workflow.rows.find((row)=>row.view==="editor")?.outcomes,1);
  assert.equal(preferredDocumentView(events,"d1"),"editor");
});

test("keeps optional dwell supplemental and excludes view behavior from aesthetic taste",()=>{
  const expires=new Date(Date.UTC(2026,7,20)).toISOString();
  const events=[
    event(1,"DocumentCreated",{document_id:"d1"}),
    event(2,"DocumentViewVisited",{document_id:"d1",view:"layers",focused:false}),
    event(3,"AttentionEpisodeObserved",{document_id:"d1",document_view:"layers",active_ms:90_000,idle_ms:1_000,friction_score:.62,outcome_weight:.08,expires_at:expires}),
  ];
  const workflow=documentViewWorkflow(events,"d1",Date.UTC(2026,7,14));
  const layers=workflow.rows.find((row)=>row.view==="layers");
  assert.equal(layers?.visits,1);
  assert.equal(layers?.frictionEpisodes,1);
  assert.equal(layers?.outcomes,0);
  assert.deepEqual(inferTasteBeliefs(events,new Date(Date.UTC(2026,7,14))),[]);
});
