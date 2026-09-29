import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { storyboardFrameContextEvents } from "../src/model/storyboard-context.ts";

const artifact={
  id:"storyboard-1",documentId:"source-document",kind:"storyboard",title:"Threshold sequence",summary:"A connected visual progression",contentRef:"storyboard-content",itemCount:3,
  items:[
    {id:"frame-1",title:"Approach",body:"",notes:"",imagePrompt:"",mediaUrl:"/api/media/frame-1.jpg",mediaType:"image/jpeg",width:1024,height:768,focalPoint:{x:.42,y:.55,confidence:.8,method:"attention-region-v2",sampleWidth:32,sampleHeight:32},slide:null},
    {id:"frame-2",title:"Crossing",body:"",notes:"",imagePrompt:"",mediaUrl:"/api/media/frame-2.jpg",mediaType:"image/jpeg",width:1024,height:768,focalPoint:null,slide:null},
    {id:"frame-3",title:"Unfinished",body:"",notes:"",imagePrompt:"",mediaUrl:null,mediaType:null,width:null,height:null,focalPoint:null,slide:null},
  ],
  mediaUrl:null,mediaType:null,provider:"openai",modelId:"gpt-image-2",latency:1200,sequence:4,sourceEventId:"render-completed",sourceSurface:"document",settings:{},presentation:null,
};

const content={title:"Threshold sequence",summary:"A connected visual progression",content_markdown:"# Threshold sequence",presentation:null,items:[
  {title:"Approach",body:"A figure approaches the lit threshold.",notes:"Keep the silhouette legible.",image_prompt:"Warm threshold in a wide composition.",slide:null},
  {title:"Crossing",body:"The figure crosses into warm light.",notes:"Preserve the camera axis.",image_prompt:"",slide:null},
  {title:"Unfinished",body:"No pixels were retained.",notes:"",image_prompt:"",slide:null},
]};

test("storyboard conversion creates one ordered reference block for every finished frame",()=>{
  let ordinal=0;const result=storyboardFrameContextEvents(artifact,{documentId:"destination-document",projectId:"project-1",sourceSurface:"document-artifact-viewer",content,positionStart:20,idFactory:()=>`id-${++ordinal}`});
  assert.equal(result.availableFrameCount,2);assert.equal(result.blockIds.length,2);assert.deepEqual(result.sourceItemIds,["frame-1","frame-2"]);assert.equal(result.events.length,4);
  const ingested=result.events.filter((event)=>event.type==="ReferenceIngested");const blocks=result.events.filter((event)=>event.type==="BlockCreated");
  assert.deepEqual(ingested.map((event)=>event.payload.source_ref),["/api/media/frame-1.jpg","/api/media/frame-2.jpg"]);
  assert.deepEqual(blocks.map((event)=>event.payload.position),["z00000020","z00000021"]);
  assert.deepEqual(blocks.map((event)=>event.payload.properties.source_artifact_item_id),["frame-1","frame-2"]);
  assert.deepEqual(blocks.map((event)=>event.payload.properties.storyboard_frame_index),[1,2]);
  assert.equal(blocks[0].payload.properties.pixel_reference_mode,"context_only");assert.equal(blocks[0].payload.properties.focal_point.x,.42);
  assert.match(blocks[0].payload.properties.text,/figure approaches the lit threshold/i);assert.match(blocks[0].payload.properties.text,/silhouette legible/i);
  assert.equal(blocks[0].payload.properties.storyboard_shot_direction,"A figure approaches the lit threshold.");assert.equal(blocks[0].payload.properties.storyboard_camera_direction,"Keep the silhouette legible.");assert.equal(blocks[0].payload.properties.storyboard_frame_prompt,"Warm threshold in a wide composition.");
  assert.equal(blocks[0].payload.properties.reference_set_kind,"storyboard");assert.equal(blocks[0].payload.properties.reference_set_role,"ordered-video-sequence");assert.equal(blocks[0].payload.properties.reference_set_order,"storyboard_frame_index");
  assert.equal(blocks[0].payload.properties.context_set_id,blocks[1].payload.properties.context_set_id);assert.equal(blocks[0].payload.properties.context_set_root_id,blocks[0].payload.block_id);

  const events=[
    {eventId:"e1",streamId:"s",sequence:1,occurredAt:"2026-08-20T12:00:00.000Z",recordedAt:"2026-08-20T12:00:00.000Z",actor:"user",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type:"ProjectCreated",payload:{project_id:"project-1",name:"Project"}},
    {eventId:"e2",streamId:"s",sequence:2,occurredAt:"2026-08-20T12:00:01.000Z",recordedAt:"2026-08-20T12:00:01.000Z",actor:"user",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type:"DocumentCreated",payload:{project_id:"project-1",document_id:"destination-document",title:"Destination"}},
    ...result.events.map((event,index)=>({eventId:`e${index+3}`,streamId:"s",sequence:index+3,occurredAt:"2026-08-20T12:00:02.000Z",recordedAt:"2026-08-20T12:00:02.000Z",actor:"user",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,...event})),
  ];
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,"destination-document");assert.equal(projection.blocks.length,2);assert.deepEqual(projection.blocks.map((block)=>block.properties.media_url),["/api/media/frame-1.jpg","/api/media/frame-2.jpg"]);
});

test("storyboard conversion is idempotent per source frame and ignores non-storyboard artifacts",()=>{
  let ordinal=0;const result=storyboardFrameContextEvents(artifact,{documentId:"destination-document",projectId:"project-1",sourceSurface:"canvas-selection-storyboard",existingSourceItemIds:["frame-1"],idFactory:()=>`next-${++ordinal}`});
  assert.deepEqual(result.sourceItemIds,["frame-2"]);assert.equal(result.blockIds.length,1);assert.equal(result.events.filter((event)=>event.type==="BlockCreated").length,1);
  assert.deepEqual(storyboardFrameContextEvents({...artifact,kind:"slides"},{documentId:"destination-document",projectId:"project-1",sourceSurface:"test"}),{events:[],blockIds:[],sourceItemIds:[],availableFrameCount:0});
});
