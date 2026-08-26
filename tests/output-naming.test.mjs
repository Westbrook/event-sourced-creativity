import assert from "node:assert/strict";
import test from "node:test";
import { describeOutput, describeOutputs, imageOutputNamingCandidate } from "../src/model/output-naming.ts";
import { foldEvents } from "../src/model/events.ts";
import { artifactReviewState } from "../src/model/context-health.ts";
import { productionWorkflowSourceIdentity, recommendProductionWorkflow } from "../src/model/production-workflow.ts";

const event=(sequence,type,payload,actor="user")=>({eventId:`event-${sequence}`,streamId:"creative:owner",sequence,occurredAt:`2026-08-${String(Math.min(28,sequence)).padStart(2,"0")}T12:00:00.000Z`,recordedAt:`2026-08-${String(Math.min(28,sequence)).padStart(2,"0")}T12:00:00.000Z`,actor,clientId:"client",correlationId:"correlation",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const artifact=(id,sequence,options={})=>({id,sequence,documentId:"document",kind:"scene",title:"The last match",sourceEventId:`event-${sequence}`,settings:{scene_medium:"visual"},...options});

test("same-medium output labels lead with stable chronological takes, not global event sequences",()=>{
  const newest=artifact("scene-3",30,{settings:{scene_medium:"audio"}}),oldest=artifact("scene-1",10),middle=artifact("scene-2",20);
  const descriptions=describeOutputs([newest,oldest,middle],{locale:"en",events:[event(10,"DocumentRenderCompleted",{artifact_id:oldest.id,artifact_kind:"scene",document_id:"document"}),event(20,"DocumentRenderCompleted",{artifact_id:middle.id,artifact_kind:"scene",document_id:"document"}),event(30,"DocumentRenderCompleted",{artifact_id:newest.id,artifact_kind:"scene",document_id:"document"})],includeTimestamp:true,timeZone:"UTC"});
  assert.deepEqual(descriptions.map(({ordinal})=>ordinal),[3,1,2]);
  assert.match(descriptions[0].label,/^Take 3 — The last match · Audio scene/u);
  assert.match(descriptions[1].label,/^Take 1 — The last match · Visual scene/u);
  assert.equal(new Set(descriptions.map(({label})=>label)).size,3);
  assert.doesNotMatch(descriptions[0].label,/Revision|Version 30/u);
});

test("take identity includes filtered and discarded historical siblings",()=>{
  const retained=artifact("scene-3",30);
  const history=[event(10,"DocumentRenderCompleted",{artifact_id:"removed-scene",artifact_kind:"scene",document_id:"document"}),event(20,"DocumentRenderCompleted",{artifact_id:"audio-scene",artifact_kind:"scene",document_id:"document"}),event(30,"DocumentRenderCompleted",{artifact_id:retained.id,artifact_kind:"scene",document_id:"document"})];
  const description=describeOutput(retained,[retained],{events:history});
  assert.equal(description.ordinal,3);
  assert.equal(description.total,3);
  assert.match(description.label,/^Take 3 —/u);
});

test("authored names remain verbatim while equal custom names stay distinguishable",()=>{
  const first=artifact("first",10,{title:"Approved opening",titleSource:"authored"}),second=artifact("second",20,{title:"Approved opening",titleSource:"authored"});
  const descriptions=describeOutputs([second,first]);
  assert.deepEqual(descriptions.map(({title,isCustomTitle})=>({title,isCustomTitle})),[{title:"Approved opening",isCustomTitle:true},{title:"Approved opening",isCustomTitle:true}]);
  assert.match(descriptions[0].label,/^Take 2 — Approved opening/u);
  assert.match(descriptions[1].label,/^Take 1 — Approved opening/u);
});

test("take numbering is scoped by document and exact medium",()=>{
  const one=artifact("one",10),otherDocument=artifact("foreign",5,{documentId:"other"}),otherFormat=artifact("slides",6,{kind:"slides"});
  const [first,second,third]=describeOutputs([one,otherDocument,otherFormat]);
  assert.equal(first.ordinal,1);
  assert.equal(second.ordinal,1);
  assert.equal(third.ordinal,1);
  assert.equal(first.total,1);
});

test("existing model-authored image names are reused and authored names win",()=>{
  const output={id:"image",sequence:1,documentId:"document",contentRef:"direction",quality:"high",purpose:"final"};
  const generated=imageOutputNamingCandidate(output,{direction:JSON.stringify({title:"Rain against the blue door"})},"A creative document");
  assert.equal(generated.title,"Rain against the blue door");
  const authored=imageOutputNamingCandidate({...output,title:"Client-approved hero",titleSource:"authored"},{direction:JSON.stringify({title:"Rain against the blue door"})},"A creative document");
  assert.equal(authored.title,"Client-approved hero");
  assert.equal(authored.customTitle,"Client-approved hero");
});

test("take labels and occurrence dates follow the requested locale",()=>{
  const first=artifact("first",10),second=artifact("second",20);
  const descriptions=describeOutputs([second,first],{locale:"fr",timeZone:"UTC",events:[event(10,"DocumentRenderCompleted",{artifact_id:first.id,artifact_kind:"scene",document_id:"document"}),event(20,"DocumentRenderCompleted",{artifact_id:second.id,artifact_kind:"scene",document_id:"document"})],includeTimestamp:true});
  assert.match(descriptions[0].label,/^Prise 2 —/u);
  assert.match(descriptions[0].secondaryLabel,/août/u);
});

test("output renames preserve durable identity, creation provenance, review state, and production sources",()=>{
  const rows=[event(1,"ProjectCreated",{project_id:"project",name:"A project"}),event(2,"DocumentCreated",{project_id:"project",document_id:"document",title:"A document"}),event(3,"GenerationCompleted",{project_id:"project",document_id:"document",object_ids:["image"],title:"Generated image"},"worker:generator"),event(4,"DocumentRenderCompleted",{project_id:"project",document_id:"document",artifact_id:"artifact",artifact_kind:"scene",title:"Generated scene",summary:"A tense opening",items:[],settings:{scene_medium:"visual"}},"worker:renderer")];
  const before=foldEvents(rows),original=before.artifacts[0];
  const workflow=recommendProductionWorkflow({id:"workflow",documentId:"document",projectId:"project",target:"video"});
  const stage=workflow.stages.find(({format})=>format==="scene");
  const sourceFor=(output)=>({outputKind:"artifact",outputId:output.id,format:output.kind,documentId:output.documentId,sourceEventId:output.sourceEventId,revision:0,approvalRequired:stage.approvalRequired,allowTextGuidance:false});
  const sourceBefore=productionWorkflowSourceIdentity([sourceFor(original)]);
  const reviewBefore=artifactReviewState(original,before.blocks,rows);
  const renamed=[...rows,event(5,"OutputRenamed",{output_id:"artifact",artifact_id:"artifact",output_kind:"artifact",artifact_kind:"scene",document_id:"document",project_id:"project",old_title:"Generated scene",new_title:"Opening · approved cut"}),event(6,"OutputRenamed",{output_id:"image",object_id:"image",output_kind:"image",document_id:"document",project_id:"project",old_title:"Generated image",new_title:"Campaign hero"})];
  const after=foldEvents(renamed),changed=after.artifacts[0];
  assert.equal(changed.title,"Opening · approved cut");
  assert.equal(changed.titleSource,"authored");
  assert.equal(after.outputs[0].title,"Campaign hero");
  assert.equal(after.outputs[0].titleSource,"authored");
  assert.equal(changed.id,original.id);
  assert.equal(changed.sequence,original.sequence);
  assert.equal(changed.sourceEventId,original.sourceEventId);
  assert.deepEqual(productionWorkflowSourceIdentity([sourceFor(changed)]),sourceBefore);
  assert.equal(artifactReviewState(changed,after.blocks,renamed).status,reviewBefore.status);
});

test("rename projection rejects mismatched document identities",()=>{
  const rows=[event(1,"ProjectCreated",{project_id:"project",name:"A project"}),event(2,"DocumentCreated",{project_id:"project",document_id:"document",title:"A document"}),event(3,"GenerationCompleted",{document_id:"document",object_ids:["image"],title:"Original"},"worker:generator"),event(4,"OutputRenamed",{output_id:"image",object_id:"image",output_kind:"image",document_id:"another-document",project_id:"project",new_title:"Untrusted name"})];
  assert.equal(foldEvents(rows).outputs[0].title,"Original");
});
