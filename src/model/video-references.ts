import { referencePixelMode, sendsReferencePixels, type ReferencePixelMode } from "./block-types.ts";
import type { CreativeBlock, CreativeEvent } from "./events.ts";
import { VIDEO_ADAPTER_CONTRACT } from "./video-adapter.ts";

export type VideoReferencePreflightItem = {
  block: CreativeBlock;
  mode: ReferencePixelMode;
  sendsPixels: boolean;
  rightsConfirmed: boolean;
  isStoryboardFrame: boolean;
  storyboardId: string;
  storyboardTitle: string;
  sequence: number | null;
  frameCount: number | null;
  label: string;
  shotDirection: string;
  cameraDirection: string;
  mediaUrl: string;
  focalPoint: unknown;
};

export type VideoReferencePreflight = {
  items: VideoReferencePreflightItem[];
  storyboardItems: VideoReferencePreflightItem[];
  otherItems: VideoReferencePreflightItem[];
  pixelCount: number;
  providerPixelCount: number;
  describeOnlyCount: number;
  rightsBlockedCount: number;
  unavailablePixelCount: number;
  providerLimitExceededCount: number;
  providerReferenceLimit: number;
  providerPath: "prompt-only" | "reference-to-video" | "blocked";
};

const text=(value:unknown)=>String(value??"").trim();

export function videoReferencePreflight(blocks:CreativeBlock[],events:CreativeEvent[]):VideoReferencePreflight{
  const rights=new Set<string>();
  for(const event of events){
    const referenceId=text(event.payload.reference_id);if(!referenceId)continue;
    if(event.type==="RightsAsserted"||event.type==="ReferenceIngested"&&Boolean(event.payload.rights_class))rights.add(referenceId);
  }
  const activeBlocks=blocks.filter((block)=>block.type==="reference"&&!block.removed&&Number(block.properties.weight??.5)>0);const unavailablePixelCount=activeBlocks.filter((block)=>sendsReferencePixels(referencePixelMode(block.properties.pixel_reference_mode))&&!text(block.properties.media_url)).length;
  const items=activeBlocks.filter((block)=>Boolean(text(block.properties.media_url))).map((block):VideoReferencePreflightItem=>{
    const mode=referencePixelMode(block.properties.pixel_reference_mode);const sequence=Number(block.properties.storyboard_frame_index);const sourceArtifactKind=text(block.properties.source_artifact_kind);const referenceSetKind=text(block.properties.reference_set_kind);const isStoryboardFrame=sourceArtifactKind==="storyboard"||referenceSetKind==="storyboard";
    const label=text(block.properties.storyboard_shot_title)||text(block.properties.label)||block.handle;const shotDirection=text(block.properties.storyboard_shot_direction)||text(block.properties.text);const cameraDirection=text(block.properties.storyboard_camera_direction);const framePrompt=text(block.properties.storyboard_frame_prompt);
    return{block,mode,sendsPixels:sendsReferencePixels(mode),rightsConfirmed:rights.has(text(block.properties.reference_id)),isStoryboardFrame,storyboardId:text(block.properties.source_artifact_id)||text(block.properties.reference_set_id)||text(block.properties.context_set_id),storyboardTitle:text(block.properties.storyboard_title)||"Storyboard",sequence:Number.isFinite(sequence)&&sequence>0?sequence:null,frameCount:Number.isFinite(Number(block.properties.storyboard_frame_count))?Number(block.properties.storyboard_frame_count):null,label,shotDirection,cameraDirection,mediaUrl:text(block.properties.media_url),focalPoint:block.properties.focal_point};
  }).sort((left,right)=>{
    if(left.isStoryboardFrame!==right.isStoryboardFrame)return left.isStoryboardFrame?-1:1;
    if(left.storyboardId&&left.storyboardId===right.storyboardId)return(left.sequence??Number.POSITIVE_INFINITY)-(right.sequence??Number.POSITIVE_INFINITY);
    return left.block.position.localeCompare(right.block.position);
  });
  const pixelItems=items.filter((item)=>item.sendsPixels);const rightsBlockedCount=pixelItems.filter((item)=>!item.rightsConfirmed).length;const providerReferenceLimit=VIDEO_ADAPTER_CONTRACT.maxReferenceImages;const providerLimitExceededCount=Math.max(0,pixelItems.length-providerReferenceLimit);
  return{items,storyboardItems:items.filter((item)=>item.isStoryboardFrame),otherItems:items.filter((item)=>!item.isStoryboardFrame),pixelCount:pixelItems.length,providerPixelCount:pixelItems.length,describeOnlyCount:items.length-pixelItems.length,rightsBlockedCount,unavailablePixelCount,providerLimitExceededCount,providerReferenceLimit,providerPath:rightsBlockedCount||unavailablePixelCount||providerLimitExceededCount?"blocked":pixelItems.length?"reference-to-video":"prompt-only"};
}
