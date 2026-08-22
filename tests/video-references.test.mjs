import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { videoReferencePreflight } from "../src/model/video-references.ts";
import { adaptVideoPrompt, videoPlannerCreativeContext, videoStoryboardBeats } from "../worker/video-prompt-adapter.ts";

const reference=(id,sequence,mode="context_only",referenceId=`reference-${id}`)=>({
  id,documentId:"document-1",type:"reference",handle:`reference/${id}`,position:`z${sequence}`,removed:false,locked:false,
  properties:{
    reference_id:referenceId,media_url:`/api/media/${id}.jpg`,label:`Shot ${sequence}`,
    pixel_reference_mode:mode,source_artifact_id:"storyboard-1",source_artifact_kind:"storyboard",
    storyboard_frame_index:sequence,storyboard_frame_count:3,storyboard_title:"Threshold sequence",
    storyboard_shot_direction:`Direction ${sequence}`,storyboard_camera_direction:`Camera ${sequence}`,
  },
});

const ingested=(referenceId,rightsClass="account-generated")=>({
  eventId:`event-${referenceId}`,streamId:"stream",sequence:1,occurredAt:"2026-08-20T12:00:00.000Z",recordedAt:"2026-08-20T12:00:00.000Z",
  actor:"worker",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type:"ReferenceIngested",
  payload:{reference_id:referenceId,rights_class:rightsClass},
});

test("video reference preflight keeps storyboard frames ordered and description-only by default",()=>{
  const blocks=[reference("frame-3",3),reference("frame-1",1),reference("frame-2",2)];
  const result=videoReferencePreflight(blocks,blocks.map((block)=>ingested(block.properties.reference_id)));
  assert.deepEqual(result.storyboardItems.map((item)=>item.sequence),[1,2,3]);
  assert.equal(result.providerPath,"prompt-only");
  assert.equal(result.pixelCount,0);
  assert.equal(result.describeOnlyCount,3);
});

test("video reference preflight selects the pixel route and blocks missing rights",()=>{
  const pixel=reference("frame-1",1,"preserve_composition");
  const promptOnly=reference("frame-2",2);
  const allowed=videoReferencePreflight([pixel,promptOnly],[ingested("reference-frame-1"),ingested("reference-frame-2")]);
  assert.equal(allowed.providerPath,"reference-to-video");
  assert.equal(allowed.pixelCount,1);
  assert.equal(allowed.rightsBlockedCount,0);
  const blocked=videoReferencePreflight([pixel,promptOnly],[ingested("reference-frame-2")]);
  assert.equal(blocked.providerPath,"blocked");
  assert.equal(blocked.rightsBlockedCount,1);
  const missingMedia={...pixel,properties:{...pixel.properties,media_url:""}};const unavailable=videoReferencePreflight([missingMedia,promptOnly],[ingested("reference-frame-1"),ingested("reference-frame-2")]);
  assert.equal(unavailable.providerPath,"blocked");
  assert.equal(unavailable.unavailablePixelCount,1);
});

test("video reference preflight preserves mixed per-frame pixel choices",()=>{
  const blocks=Array.from({length:6},(_,index)=>reference(`frame-${index+1}`,index+1,index===5?"context_only":"preserve_composition"));
  const mixed=videoReferencePreflight(blocks,blocks.map((block)=>ingested(block.properties.reference_id)));
  assert.equal(mixed.providerPath,"reference-to-video");
  assert.equal(mixed.pixelCount,5);
  assert.equal(mixed.describeOnlyCount,1);
  assert.deepEqual(mixed.items.map((item)=>item.sendsPixels),[true,true,true,true,true,false]);
});

test("video reference preflight blocks more pixel references than the adopted provider contract",()=>{
  const blocks=Array.from({length:10},(_,index)=>reference(`frame-${index+1}`,index+1,"preserve_composition"));
  const result=videoReferencePreflight(blocks,blocks.map((block)=>ingested(block.properties.reference_id)));
  assert.equal(result.providerPath,"blocked");
  assert.equal(result.pixelCount,10);
  assert.equal(result.providerReferenceLimit,9);
  assert.equal(result.providerLimitExceededCount,1);
});

test("adopted motion scenes preserve authored chronology, camera lenses, and visual direction without video-pixel references",()=>{
  const snapshot={facts:[
    {block_id:"scene-two",type:"motion",properties:{source_artifact_id:"original-reel",source_artifact_kind:"video",video_title:"Midnight observatory",video_scene_index:2,video_scene_count:2,video_scene_title:"Ivo enters",video_scene_direction:"Ivo opens the observatory door.",video_scene_camera_direction:"35mm matched left-facing eyeline",video_scene_frame_prompt:"Ivo beneath cobalt light."}},
    {block_id:"scene-one",type:"motion",properties:{source_artifact_id:"original-reel",source_artifact_kind:"video",video_title:"Midnight observatory",video_scene_index:1,video_scene_count:2,video_scene_title:"Mara arrives",video_scene_direction:"Mara raises the silver compass.",video_scene_camera_direction:"85mm rightward tracking shot",video_scene_frame_prompt:"Mara beneath crimson moonlight."}},
  ]};
  const beats=videoStoryboardBeats(snapshot);
  assert.deepEqual(beats.map((beat)=>[beat.sequence,beat.title,beat.cameraDirection]),[[1,"Mara arrives","85mm rightward tracking shot"],[2,"Ivo enters","35mm matched left-facing eyeline"]]);
  const planner=JSON.stringify(videoPlannerCreativeContext(snapshot));
  assert.match(planner,/video_scene_index|Mara raises the silver compass|85mm rightward tracking shot|35mm matched left-facing eyeline/);
  const adapted=adaptVideoPrompt("A moonlit observatory sequence.",{snapshot,references:[],seconds:10,size:"1280x720",model:"bytedance/seedance-2.0/reference-to-video",promptProfile:"positive-only"});
  assert.match(adapted.prompt,/Mara raises the silver compass/);
  assert.match(adapted.prompt,/Ivo opens the observatory door/);
  assert.match(adapted.prompt,/85mm rightward tracking shot/);
  assert.equal(adapted.referenceBindings.length,0);
});

test("scoped managed-video prohibitions survive first-class provider compilation after long continuity summaries",()=>{
  const snapshot={facts:[{block_id:"mara",type:"subject",properties:{text:"Mara discovers the silver compass."}}]};
  const adaptation=adaptVideoPrompt("Mara discovers the silver compass.",{snapshot,plan:{summary:"Ordinary global styling. ".repeat(80)},productionContinuity:{prohibitions:["Never include modern vehicles"],scopedTargets:[{target:"Mara",role:"character",prohibitions:["MARA_ONLY_FORBIDDEN_RED_COAT_8731"]}]},references:[],seconds:6,size:"1280x720",model:"bytedance/seedance-2.0/reference-to-video",promptProfile:"positive-only"});
  assert.equal(adaptation.compilation.valid,true);
  assert.match(adaptation.prompt,/MARA_ONLY_FORBIDDEN_RED_COAT_8731/);
  assert.match(adaptation.prompt,/only from character “Mara”/);
  assert.match(adaptation.prompt,/Never include modern vehicles/);
});

test("video creation exposes durable batch and per-frame reference controls",async()=>{
  const [dialog,preflight,policy,styles]=await Promise.all([
    readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/video-reference-preflight.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/reference-pixel-policy.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
  ]);
  assert.match(dialog,/forma-video-reference-preflight/);
  assert.match(dialog,/Pixel-backed reference-to-video|reference-to-video path/);
  assert.match(dialog,/prompt-only video path/i);
  assert.match(dialog,/short-lived storage/);
  assert.match(preflight,/Send all frame pixels/);
  assert.match(preflight,/Describe all only/);
  assert.match(preflight,/Send this frame’s pixels/);
  assert.match(preflight,/Pixel role/);
  assert.match(preflight,/checked\?"preserve_composition":"context_only"/);
  assert.match(preflight,/filter\(\(option\)=>option\.id!=="context_only"\)/);
  assert.match(preflight,/BlockPropertyEdited/);
  assert.match(preflight,/video_reference_preflight:true/);
  assert.match(preflight,/batch_id:batchId/);
  assert.match(preflight,/providerLimitExceededCount/);
  assert.match(preflight,/image limit/);
  assert.match(policy,/Use in generation/);
  assert.match(policy,/image and video models/);
  assert.match(styles,/\.video-reference-preflight/);
  assert.match(styles,/\.video-reference-mode-controls/);
});
