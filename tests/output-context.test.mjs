import assert from "node:assert/strict";
import test from "node:test";
import { artifactContextEvents, imageOutputContextEvents } from "../src/model/output-context.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";

const ids=()=>{let index=0;return()=>`id-${++index}`;};
const item=(id="item-1",mediaUrl=null)=>({id,title:"Opening beat",body:"The librarian turns toward the discovery.",notes:"Hold the reaction.",imagePrompt:"A quiet reveal",contextGroupIds:[],mediaUrl,mediaType:mediaUrl?"image/jpeg":null,width:mediaUrl?1024:null,height:mediaUrl?768:null,focalPoint:null,slide:null});
const artifact=(kind)=>({id:`artifact-${kind}`,documentId:"source-document",kind,title:`Source ${kind}`,summary:`A durable ${kind} output`,contentRef:`content-${kind}`,inputRef:`input-${kind}`,itemCount:1,items:[item("item-1",kind==="storyboard"?"/api/media/frame.jpg":null)],mediaUrl:kind==="video"?"/api/media/video.mp4":null,mediaType:kind==="video"?"video/mp4":null,provider:"provider",modelId:"model",latency:100,sequence:1,sourceEventId:"event-1",sourceSurface:"document",settings:{},presentation:null});
const content=(kind)=>({title:`Source ${kind}`,summary:"Summary",content_markdown:`# ${kind}\n\nComplete retained content.`,presentation:null,items:[{title:"Opening beat",body:"The complete beat.",notes:"Continuity note.",image_prompt:"A frame",context_group_ids:[],slide:null}]});
const options=(factory)=>({documentId:"destination-document",projectId:"project",sourceSurface:"test",positionStart:12,idFactory:factory});

test("every durable artifact kind becomes structured document input",()=>{
  for(const kind of DOCUMENT_ARTIFACT_KINDS){
    const result=artifactContextEvents(artifact(kind),{...options(ids()),content:content(kind)});const root=result.events.find((event)=>event.type==="BlockCreated"&&!event.payload.source_artifact_item_id);
    assert.ok(root,kind);assert.equal(root.payload.properties.input_mode,"full_output",kind);assert.equal(root.payload.properties.source_artifact_kind,kind);assert.equal(root.payload.properties.text,`# ${kind}\n\nComplete retained content.`);assert.ok(root.payload.properties.artifact_structure);
    const membership=root.payload.properties.combined_context_memberships[0];assert.equal(membership.relativity,1);assert.equal(membership.role,kind==="scene"?"scene":kind==="slides"?"slide_chapter":"sequence");
  }
});

test("storyboards preserve one ordered artifact plus pixel-capable frame members",()=>{
  const result=artifactContextEvents(artifact("storyboard"),{...options(ids()),content:content("storyboard")});const blocks=result.events.filter((event)=>event.type==="BlockCreated"),references=result.events.filter((event)=>event.type==="ReferenceIngested"),relations=result.events.filter((event)=>event.type==="BlockRelationAdded");
  assert.equal(blocks.length,2);assert.equal(references.length,1);assert.equal(relations.length,1);assert.equal(blocks[1].payload.properties.combined_context_memberships[0].memberOrder,1);assert.equal(relations[0].payload.kind,"artifact_contains");
});

test("generated stills become rights-backed Reference inputs",()=>{
  const output={id:"output-1",documentId:"source-document",canvasId:null,contextSetId:null,generationId:"generation-1",modelId:"gpt-image-2",variant:0,latency:100,sequence:1,pinned:false,saved:false,discarded:false,library:false,contentRef:null,promptRef:null,promptTechnique:"prose",promptFanId:null,provider:"openai",mediaUrl:"/api/media/output.png",mediaType:"image/png",width:1024,height:768,plannerModelId:null,quality:"high",purpose:"final",sourceEventId:"event-1",sourceSurface:"document",promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:null,standalone:true,standaloneSequence:null};
  const result=imageOutputContextEvents(output,options(ids()));assert.equal(result.events[0].type,"ReferenceIngested");assert.equal(result.events[0].payload.rights_class,"account-generated");assert.equal(result.events[1].payload.type,"reference");assert.equal(result.events[1].payload.properties.pixel_reference_mode,"inspiration");assert.equal(result.events[1].payload.properties.source_output_id,"output-1");
});
