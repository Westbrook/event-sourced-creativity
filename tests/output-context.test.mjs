import assert from "node:assert/strict";
import test from "node:test";
import { artifactContextEvents, imageOutputContextEvents, model3dArtifactContextReadiness } from "../src/model/output-context.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { videoPlannerCreativeContext } from "../worker/video-prompt-adapter.ts";

const ids=()=>{let index=0;return()=>`id-${++index}`;};
const item=(id="item-1",mediaUrl=null)=>({id,title:"Opening beat",body:"The librarian turns toward the discovery.",notes:"Hold the reaction.",imagePrompt:"A quiet reveal",contextGroupIds:[],mediaUrl,mediaType:mediaUrl?"image/jpeg":null,width:mediaUrl?1024:null,height:mediaUrl?768:null,focalPoint:null,slide:null});
const artifact=(kind)=>({id:`artifact-${kind}`,documentId:"source-document",kind,title:`Source ${kind}`,summary:`A durable ${kind} output`,contentRef:`content-${kind}`,inputRef:`input-${kind}`,itemCount:1,items:[item("item-1",kind==="storyboard"?"/api/media/frame.jpg":null)],mediaUrl:kind==="video"?"/api/media/video.mp4":kind==="model3d"?"/api/media/model.glb":null,mediaType:kind==="video"?"video/mp4":kind==="model3d"?"model/gltf-binary":null,provider:"provider",modelId:"model",latency:100,sequence:1,sourceEventId:"event-1",sourceSurface:"document",settings:kind==="model3d"?{source_media_sha256:"b".repeat(64)}:{},presentation:null});
const content=(kind)=>({title:`Source ${kind}`,summary:"Summary",content_markdown:`# ${kind}\n\nComplete retained content.`,presentation:null,items:[{title:"Opening beat",body:"The complete beat.",notes:"Continuity note.",image_prompt:"A frame",context_group_ids:[],slide:null}]});
const options=(factory)=>({documentId:"destination-document",projectId:"project",sourceSurface:"test",positionStart:12,idFactory:factory});

test("every durable artifact kind becomes structured document input",()=>{
  for(const kind of DOCUMENT_ARTIFACT_KINDS){
    const result=artifactContextEvents(artifact(kind),{...options(ids()),content:content(kind)});const root=result.events.find((event)=>event.type==="BlockCreated"&&!event.payload.source_artifact_item_id);
    assert.ok(root,kind);assert.equal(root.payload.properties.input_mode,"full_output",kind);assert.equal(root.payload.properties.source_artifact_kind,kind);assert.equal(root.payload.properties.text,`# ${kind}\n\nComplete retained content.`);assert.ok(root.payload.properties.artifact_structure);
    const membership=root.payload.properties.combined_context_memberships[0];assert.equal(membership.relativity,1);assert.equal(membership.role,kind==="scene"?"scene":kind==="slides"?"slide_chapter":kind==="model3d"?"object":"sequence");
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
  const assisted=imageOutputContextEvents({...output,memoryAssisted:true},options(ids()));assert.ok(assisted.events.every(event=>event.payload.memory_authored_version===1&&event.payload.independent_evidence===false));
  const retained=imageOutputContextEvents(output,{...options(ids()),contentHash:"A".repeat(64)});
  assert.equal(retained.events[0].payload.content_hash,"a".repeat(64));
  assert.equal(retained.events[1].payload.properties.source_content_hash,"a".repeat(64));
  assert.equal(retained.events[1].payload.properties.source_mime_type,"image/png");
  for(const contentHash of [undefined,null,"","a".repeat(63),"not-a-receipt"]){
    const unavailable=imageOutputContextEvents(output,{...options(ids()),contentHash,content:{source_content_hash:"c".repeat(64)}});
    assert.equal(unavailable.events[0].payload.content_hash,undefined);
    assert.equal(unavailable.events[1].payload.properties.source_content_hash,undefined,"authored direction content cannot invent an asset receipt");
  }
});

test("generated GLB reuse preserves the original mesh and rights without inventing an image view",()=>{
  const source=artifact("model3d");
  source.settings.model3d_files=[
    {url:source.mediaUrl,mimeType:"model/gltf-binary",format:"glb",role:"mesh",sha256:"a".repeat(64)},
    {url:"/api/media/provider-preview.webp",mimeType:"image/webp",format:"webp",role:"preview",sha256:"c".repeat(64)},
  ];
  const result=artifactContextEvents(source,{...options(ids()),content:content("model3d")});
  const ingest=result.events.find((event)=>event.type==="ReferenceIngested");
  const block=result.events.find((event)=>event.type==="BlockCreated");
  assert.equal(result.availableMemberCount,1);
  assert.equal(ingest.payload.source_type,"generated-model3d");
  assert.equal(ingest.payload.source_ref,source.mediaUrl);
  assert.equal(ingest.payload.media_type,"model/gltf-binary");
  assert.equal(ingest.payload.content_hash,"a".repeat(64));
  assert.equal(ingest.payload.rights_class,"account-generated");
  assert.equal(block.payload.type,"model3d");
  assert.equal(block.payload.properties.model_reference_id,ingest.payload.reference_id);
  assert.equal(block.payload.properties.model_url,source.mediaUrl);
  assert.equal(block.payload.properties.model_mime_type,"model/gltf-binary");
  assert.equal(block.payload.properties.model_content_hash,"a".repeat(64));
  assert.equal(block.payload.properties.rights_class,"account-generated");
  assert.equal(block.payload.properties.media_url,null);
  assert.equal(block.payload.properties.media_type,null);
  assert.equal(block.payload.properties.reference_id,null);
  assert.equal(block.payload.properties.pixel_reference_mode,"context_only");
  assert.equal(block.payload.properties.model_view,undefined);
  assert.equal(block.payload.properties.source_artifact_id,source.id);
  assert.equal(block.payload.properties.source_document_id,source.documentId);
  assert.equal(block.payload.properties.source_artifact_content_ref,source.contentRef);
  assert.doesNotMatch(JSON.stringify(result.events),/provider-preview/);
  const providerContext=providerFacingRenderingContext({facts:[{block_id:block.payload.block_id,type:"model3d",role:"subject",properties:block.payload.properties}],relationships:[]});
  const serialized=JSON.stringify(providerContext);
  assert.match(serialized,/Complete retained content/);
  assert.doesNotMatch(serialized,/\/api\/media\/|"model_reference_id"|"model_content_hash"|artifact-model3d|content-model3d/);
});

test("model reuse selects a retained GLB mesh even when another output format is primary",()=>{
  const source=artifact("model3d");
  source.mediaUrl="/api/media/model.obj";
  source.mediaType="model/obj";
  source.settings.model3d_files=[
    {url:source.mediaUrl,mimeType:"model/obj",format:"obj",role:"mesh",sha256:"a".repeat(64)},
    {url:"/api/media/secondary.glb",mimeType:"model/gltf-binary",format:"glb",role:"mesh",sha256:"c".repeat(64)},
  ];
  assert.deepEqual(model3dArtifactContextReadiness(source),{supported:true,reason:null});
  const result=artifactContextEvents(source,options(ids()));
  const block=result.events.find((event)=>event.type==="BlockCreated");
  assert.equal(block.payload.properties.model_url,"/api/media/secondary.glb");
  assert.equal(block.payload.properties.model_content_hash,"c".repeat(64));
  assert.equal(block.payload.properties.media_url,null);
});

test("model reuse refuses unsupported, unretained, and unverified originals with actionable guidance",()=>{
  for(const change of [
    {mediaType:"model/obj",mediaUrl:"/api/media/model.obj"},
    {mediaType:"model/gltf+json",mediaUrl:"/api/media/model.gltf"},
    {mediaType:"image/png",mediaUrl:"/api/media/preview.png"},
    {mediaUrl:"https://provider.example/model.glb"},
    {mediaUrl:"/api/media/%2e%2e/outside.glb"},
    {mediaUrl:null},
    {settings:{}},
    {settings:{source_media_sha256:"not-a-sha256"}},
  ]){
    const source={...artifact("model3d"),...change};
    const readiness=model3dArtifactContextReadiness(source);
    assert.equal(readiness.supported,false,JSON.stringify(change));
    assert.match(readiness.reason,/generate a GLB or download and upload a self-contained GLB/);
    assert.deepEqual(artifactContextEvents(source,options(ids())),{events:[],blockIds:[],sourceItemIds:[],availableMemberCount:0});
  }
});

test("download-only GLB output cannot bypass viewer validation through the primary media fallback",()=>{
  const source=artifact("model3d");
  source.settings.model3d_files=[{url:source.mediaUrl,mimeType:source.mediaType,format:"glb",role:"mesh",sha256:"a".repeat(64),previewSupported:false}];
  const readiness=model3dArtifactContextReadiness(source);
  assert.equal(readiness.supported,false);
  assert.equal(readiness.reasonCode,"download_only");
  assert.match(readiness.reason,/uncompressed, self-contained GLB/);
  assert.deepEqual(artifactContextEvents(source,options(ids())),{events:[],blockIds:[],sourceItemIds:[],availableMemberCount:0});
  source.settings.model3d_files.push({url:"/api/media/compatible.glb",mimeType:"model/gltf-binary",format:"glb",role:"mesh",sha256:"c".repeat(64),previewSupported:true});
  const result=artifactContextEvents(source,options(ids()));
  assert.equal(result.events.find((event)=>event.type==="BlockCreated").payload.properties.model_url,"/api/media/compatible.glb");
});

test("an existing model context keeps its saved view and does not acquire another original reference",()=>{
  const result=artifactContextEvents(artifact("model3d"),{...options(ids()),existingRootBlockId:"already-created"});
  assert.deepEqual(result,{events:[],blockIds:[],sourceItemIds:[],availableMemberCount:1});
});
