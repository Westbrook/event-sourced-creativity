import type { DocumentArtifact, DocumentArtifactDraft, DocumentArtifactDraftItem } from "./document-artifacts.ts";
import type { CreativeOutput, EventInput } from "./events.ts";
import { storyboardFrameContextEvents } from "./storyboard-context.ts";

export type OutputContextOptions = {
  documentId: string;
  projectId: string;
  sourceSurface: string;
  positionStart?: number;
  positionPrefix?: string;
  sourceCanvasId?: string;
  sourceCanvasItemIds?: string[];
  idFactory?: () => string;
};

export type ArtifactContextOptions = OutputContextOptions & {
  content?: DocumentArtifactDraft | null;
  existingRootBlockId?: string;
  existingSourceItemIds?: Iterable<string>;
  contextSetId?: string;
};

export type OutputContextResult = {
  events: EventInput[];
  blockIds: string[];
  sourceItemIds: string[];
  availableMemberCount: number;
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "output";
const sharedPayload = (options: OutputContextOptions) => ({
  project_id: options.projectId,
  document_id: options.documentId,
  source_surface: options.sourceSurface,
  ...(options.sourceCanvasId ? { source_canvas_id: options.sourceCanvasId } : {}),
  ...(options.sourceCanvasItemIds?.length ? { source_canvas_item_ids: options.sourceCanvasItemIds } : {}),
});

const artifactSemantics = (artifact: DocumentArtifact) => ({
  short_story: { type:"message", subtype:"Narrative source", role:"sequence", application:"ordered", target:`${artifact.title} narrative continuity` },
  scene: { type:"message", subtype:"Scripted scene", role:"scene", application:"co_locate", target:`${artifact.title} scene unit` },
  slides: { type:"message", subtype:"Presentation source", role:"slide_chapter", application:"ordered", target:`${artifact.title} presentation sequence` },
  storyboard: { type:"composition", subtype:"Storyboard sequence", role:"sequence", application:"ordered", target:`${artifact.title} ordered shot sequence` },
  video: { type:"motion", subtype:"Rendered motion", role:"sequence", application:"ordered", target:`${artifact.title} motion continuity` },
}[artifact.kind]);

const draftItems = (artifact: DocumentArtifact, content?: DocumentArtifactDraft | null): DocumentArtifactDraftItem[] => artifact.items.map((item,index)=>{
  const authored=content?.items[index];
  return {
    title:authored?.title?.trim()||item.title,
    body:authored?.body?.trim()||item.body,
    notes:authored?.notes?.trim()||item.notes,
    image_prompt:authored?.image_prompt?.trim()||item.imagePrompt,
    context_group_ids:authored?.context_group_ids??item.contextGroupIds??[],
    slide:authored?.slide??item.slide,
  };
});

const artifactText = (artifact: DocumentArtifact, content?: DocumentArtifactDraft | null) => {
  const retained=content?.content_markdown?.trim();if(retained)return retained;
  const parts=draftItems(artifact,content).flatMap((item,index)=>[
    `${index+1}. ${item.title}`,
    item.body,
    item.notes?`Notes: ${item.notes}`:"",
  ]).filter(Boolean);
  return [artifact.summary,...parts].filter(Boolean).join("\n\n");
};

/**
 * Turn a durable non-image output into authored document input without
 * flattening away its order, presentation data, media, or provenance.
 * Storyboards additionally materialize every finished frame as an ordinary
 * Reference block in the same ordered Combined Context.
 */
export function artifactContextEvents(artifact: DocumentArtifact, options: ArtifactContextOptions): OutputContextResult {
  const idFactory=options.idFactory??(()=>crypto.randomUUID());const semantics=artifactSemantics(artifact);const contextSetId=options.contextSetId??idFactory();const rootBlockId=options.existingRootBlockId??idFactory();const items=draftItems(artifact,options.content);const events:EventInput[]=[];const blockIds:string[]=[];const shared={...sharedPayload(options),source_artifact_id:artifact.id,source_artifact_kind:artifact.kind,source_document_id:artifact.documentId};
  if(!options.existingRootBlockId){
    blockIds.push(rootBlockId);
    events.push({type:"BlockCreated",payload:{...shared,block_id:rootBlockId,type:semantics.type,handle:`${semantics.type}/${slug(artifact.title)}-${artifact.id.slice(-8)}`,position:`${options.positionPrefix??"z"}${String(options.positionStart??0).padStart(8,"0")}`,properties:{
      label:artifact.title,text:artifactText(artifact,options.content),subtype:semantics.subtype,intent:"include",authority:"authored",weight:.9,
      source_artifact_id:artifact.id,source_artifact_kind:artifact.kind,source_document_id:artifact.documentId,source_artifact_content_ref:artifact.contentRef,source_artifact_input_ref:artifact.inputRef??null,
      artifact_summary:artifact.summary,artifact_item_count:artifact.itemCount,artifact_structure:{presentation:options.content?.presentation??artifact.presentation,items},
      media_url:artifact.mediaUrl,media_type:artifact.mediaType,provider:artifact.provider,model_id:artifact.modelId,input_mode:"full_output",
      context_set_id:contextSetId,context_set_root_id:rootBlockId,copied_as_context_set:true,semantic_isolation:true,
      combined_context_memberships:[{contextSetId,name:artifact.title,role:semantics.role,target:semantics.target,application:semantics.application,relativity:1,memberOrder:0,sourceCanvasId:options.sourceCanvasId??""}],
      created_from:options.sourceSurface,...(options.sourceCanvasItemIds?.length?{source_canvas_item_ids:options.sourceCanvasItemIds}:{}),
    }}});
  }
  let sourceItemIds:string[]=[];
  if(artifact.kind==="storyboard"){
    const frames=storyboardFrameContextEvents(artifact,{...options,contextSetId,contextRootBlockId:rootBlockId,memberOrderOffset:1,positionStart:(options.positionStart??0)+(options.existingRootBlockId?0:1)});events.push(...frames.events);blockIds.push(...frames.blockIds);sourceItemIds=frames.sourceItemIds;
    for(const frameBlockId of frames.blockIds)events.push({type:"BlockRelationAdded",payload:{...shared,relation_id:idFactory(),from_block_id:rootBlockId,to_block_id:frameBlockId,kind:"artifact_contains",properties:{context_set_id:contextSetId,source_artifact_id:artifact.id,ordered:true,created_from:options.sourceSurface}}});
  }
  return{events,blockIds,sourceItemIds,availableMemberCount:1+(artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)).length:0)};
}

/** Materialize a generated still as a rights-backed Reference input. */
export function imageOutputContextEvents(output: CreativeOutput, options: OutputContextOptions): OutputContextResult {
  if(!output.mediaUrl)return{events:[],blockIds:[],sourceItemIds:[],availableMemberCount:0};
  const idFactory=options.idFactory??(()=>crypto.randomUUID());const blockId=idFactory(),referenceId=idFactory();const shared={...sharedPayload(options),source_output_id:output.id,source_generation_id:output.generationId,source_document_id:output.documentId};
  return{events:[
    {type:"ReferenceIngested",payload:{...shared,reference_id:referenceId,source_type:"generated-output",source_ref:output.mediaUrl,media_url:output.mediaUrl,media_type:output.mediaType,rights_class:"account-generated",provider:output.provider,model_id:output.modelId}},
    {type:"BlockCreated",payload:{...shared,block_id:blockId,type:"reference",handle:`reference/generated-${output.id.slice(-8)}`,position:`${options.positionPrefix??"z"}${String(options.positionStart??0).padStart(8,"0")}`,properties:{reference_id:referenceId,label:`${output.quality==="low"?"Draft":"Full-quality"} image input`,text:"Use this selected generation as visual inspiration for the next output.",media_url:output.mediaUrl,media_type:output.mediaType,width:output.width,height:output.height,focal_point:output.focalPoint,source_output_id:output.id,source_generation_id:output.generationId,source_document_id:output.documentId,prompt_technique:output.promptTechnique,prompt_fan_id:output.promptFanId,pixel_reference_mode:"inspiration",intent:"include",authority:"authored",weight:.8,input_mode:"full_output",created_from:options.sourceSurface,...(options.sourceCanvasItemIds?.length?{source_canvas_item_ids:options.sourceCanvasItemIds}:{})}}},
  ],blockIds:[blockId],sourceItemIds:[output.id],availableMemberCount:1};
}
