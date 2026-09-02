import assert from "node:assert/strict";
import test from "node:test";
import { artifactContextEvents, imageOutputContextEvents } from "../src/model/output-context.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { videoPlannerCreativeContext } from "../worker/video-prompt-adapter.ts";

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

test("configured audio scenes preserve alternate visual delivery and authored-context lineage",()=>{
  const source=artifact("scene");
  source.settings={
    scene_medium:"audio",
    source_snapshot_sha256:"a".repeat(64),
    production_workflow:{id:"private-workflow-17",stage_id:"private-stage-2"},
    scene_configuration:{
      medium:"audio",
      source:"production-path",
      targetFormat:"audio",
      downstreamFormats:["audio","video","audio"],
      alternateMedium:"visual",
      context_continuity:{
        document_id:"private-source-document",
        project_id:"private-project",
        workflow_id:"private-workflow-17",
        workflow_stage_id:"private-stage-2",
        source_block_ids:["private-block-1","private-block-2"],
        source_artifact_ids:["private-story-source"],
      },
    },
  };

  const result=artifactContextEvents(source,{...options(ids()),content:content("scene")});
  const root=result.events.find((event)=>event.type==="BlockCreated");
  const properties=root.payload.properties;
  const expectedConfiguration={
    medium:"audio",
    source:"production-path",
    targetFormat:"audio",
    downstreamFormats:["audio","video"],
    alternateMedium:"visual",
  };

  assert.equal(properties.subtype,"Audio scene");
  assert.equal(properties.scene_medium,"audio");
  assert.deepEqual(properties.scene_configuration,expectedConfiguration);
  assert.equal(properties.scene_alternate_medium,"visual");
  assert.deepEqual(properties.scene_available_media,["audio","visual"]);
  assert.equal(properties.scene_target_format,"audio");
  assert.deepEqual(properties.scene_downstream_formats,["audio","video"]);
  assert.deepEqual(properties.scene_context_reuse,{
    strategy:"same-authored-context",
    available_media:["audio","visual"],
    target_format:"audio",
  });
  assert.deepEqual(properties.scene_context_lineage,{
    source_artifact_id:"artifact-scene",
    source_document_id:"source-document",
    source_event_id:"event-1",
    project_id:"private-project",
    workflow_id:"private-workflow-17",
    source_block_ids:["private-block-1","private-block-2"],
    source_ids:["private-story-source"],
    context_fingerprint:"a".repeat(64),
  });
  assert.deepEqual(properties.artifact_structure.scene_configuration,expectedConfiguration);
  assert.deepEqual(properties.artifact_structure.scene_context_lineage,properties.scene_context_lineage);
});

test("scene context accepts snake-case receipts while rejecting private fields and unsupported delivery formats",()=>{
  const source=artifact("scene");
  source.settings={
    scene_configuration:{
      medium:"visual",
      source:"production-path",
      target_format:"video",
      downstream_formats:["storyboard","video","javascript:private","video"],
      alternate_medium:"audio",
      input_ref:"PRIVATE_INPUT_RECEIPT_9137",
      content_ref:"PRIVATE_CONTENT_RECEIPT_9137",
      media_url:"/api/media/PRIVATE_SOURCE_MEDIA_9137.wav",
      nested:{source_ref:"PRIVATE_NESTED_SOURCE_9137"},
      context_continuity:{
        document_id:"private-continuity-document",
        project_id:"private-continuity-project",
        workflow_id:"private-continuity-workflow",
        workflow_stage_id:"PRIVATE_CONTINUITY_STAGE_9137",
        source_block_ids:["private-continuity-block","/api/media/PRIVATE_INJECTED_9137.wav"],
        source_artifact_ids:["private-continuity-artifact"],
        input_ref:"PRIVATE_CONTINUITY_INPUT_9137",
        media_url:"/api/media/PRIVATE_CONTINUITY_MEDIA_9137.wav",
      },
    },
  };

  const root=artifactContextEvents(source,{...options(ids()),content:content("scene")}).events[0];
  const properties=root.payload.properties;
  assert.deepEqual(properties.scene_configuration,{
    medium:"visual",source:"production-path",targetFormat:"video",
    downstreamFormats:["storyboard","video"],alternateMedium:"audio",
  });
  assert.equal(properties.subtype,"Visual scene");
  assert.deepEqual(properties.scene_context_lineage.source_block_ids,["private-continuity-block"]);
  assert.deepEqual(properties.scene_context_lineage.source_ids,["private-continuity-artifact"]);
  assert.doesNotMatch(JSON.stringify(properties.scene_configuration),/PRIVATE_|\/api\/media\//);
  assert.doesNotMatch(JSON.stringify(properties.scene_context_lineage),/PRIVATE_|\/api\/media\//);

  const snapshot={facts:[{block_id:"private-adopted-scene",type:"message",role:"message",properties}],relationships:[]};
  const providerContext=providerFacingRenderingContext(snapshot);
  const serialized=JSON.stringify(providerContext);
  assert.match(serialized,/"scene_medium":"visual"/);
  assert.match(serialized,/"alternateMedium":"audio"/);
  assert.doesNotMatch(serialized,/private-(?:adopted|continuity|source|workflow|story)|PRIVATE_|content-scene|input-scene|\/api\/media\//);

  const videoContext=videoPlannerCreativeContext(snapshot);
  assert.equal(videoContext.facts[0].properties.subtype,"Visual scene");
  assert.equal(videoContext.facts[0].properties.source_artifact_kind,"scene");
});

test("legacy and non-scene artifacts keep their existing unconfigured context",()=>{
  const legacy=artifactContextEvents(artifact("scene"),{...options(ids()),content:content("scene")}).events[0].payload.properties;
  assert.equal(legacy.subtype,"Scripted scene");
  assert.equal("scene_medium" in legacy,false);
  assert.equal("scene_configuration" in legacy,false);
  assert.equal("scene_medium" in legacy.artifact_structure,false);

  const nonScene=artifact("audio");
  nonScene.settings={scene_medium:"audio",scene_configuration:{medium:"audio",source:"manual"}};
  const properties=artifactContextEvents(nonScene,{...options(ids()),content:content("audio")}).events.find((event)=>event.type==="BlockCreated").payload.properties;
  assert.equal("scene_medium" in properties,false);
  assert.equal("scene_configuration" in properties,false);
});

test("scene-medium-only artifacts retain manual configuration and the opposite render variant",()=>{
  const source=artifact("scene");
  source.settings={scene_medium:"visual"};
  const properties=artifactContextEvents(source,{...options(ids()),content:content("scene")}).events[0].payload.properties;

  assert.deepEqual(properties.scene_configuration,{
    medium:"visual",source:"manual",targetFormat:null,downstreamFormats:[],alternateMedium:"audio",
  });
  assert.deepEqual(properties.scene_available_media,["visual","audio"]);
  assert.equal("scene_target_format" in properties,false);
});

test("delivered scene fingerprints and sibling lineage survive reuse without exposing private references",()=>{
  const source=artifact("scene");
  source.settings={
    scene_medium:"audio",
    scene_context_fingerprint:"b".repeat(64),
    scene_configuration:{medium:"audio",source:"production-path",targetFormat:"audio",downstreamFormats:["audio"],alternateMedium:"visual"},
    scene_context_lineage:{
      project_id:"project-production",
      workflow_id:"workflow-production",
      source_block_ids:["source-block-one","/api/media/PRIVATE_SCENE_MEDIA"],
      source_artifact_ids:["source-story"],
      input_ref:"PRIVATE_SCENE_INPUT",
    },
  };

  const properties=artifactContextEvents(source,{...options(ids()),content:content("scene")}).events[0].payload.properties;
  assert.deepEqual(properties.scene_context_lineage,{
    source_artifact_id:"artifact-scene",
    source_document_id:"source-document",
    source_event_id:"event-1",
    project_id:"project-production",
    workflow_id:"workflow-production",
    source_block_ids:["source-block-one"],
    source_ids:["source-story"],
    context_fingerprint:"b".repeat(64),
  });
  assert.doesNotMatch(JSON.stringify(properties.scene_context_lineage),/PRIVATE_SCENE/);
});

test("storyboards preserve one ordered artifact plus pixel-capable frame members",()=>{
  const result=artifactContextEvents(artifact("storyboard"),{...options(ids()),content:content("storyboard")});const blocks=result.events.filter((event)=>event.type==="BlockCreated"),references=result.events.filter((event)=>event.type==="ReferenceIngested"),relations=result.events.filter((event)=>event.type==="BlockRelationAdded");
  assert.equal(blocks.length,2);assert.equal(references.length,1);assert.equal(relations.length,1);assert.equal(blocks[1].payload.properties.combined_context_memberships[0].memberOrder,1);assert.equal(relations[0].payload.kind,"artifact_contains");
});

test("generated stills become rights-backed Reference inputs",()=>{
  const output={id:"output-1",documentId:"source-document",canvasId:null,contextSetId:null,generationId:"generation-1",modelId:"gpt-image-2",variant:0,latency:100,sequence:1,pinned:false,saved:false,discarded:false,library:false,contentRef:null,promptRef:null,promptTechnique:"prose",promptFanId:null,provider:"openai",mediaUrl:"/api/media/output.png",mediaType:"image/png",width:1024,height:768,plannerModelId:null,quality:"high",purpose:"final",sourceEventId:"event-1",sourceSurface:"document",promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:null,standalone:true,standaloneSequence:null};
  const result=imageOutputContextEvents(output,options(ids()));assert.equal(result.events[0].type,"ReferenceIngested");assert.equal(result.events[0].payload.rights_class,"account-generated");assert.equal(result.events[1].payload.type,"reference");assert.equal(result.events[1].payload.properties.pixel_reference_mode,"inspiration");assert.equal(result.events[1].payload.properties.source_output_id,"output-1");
});
