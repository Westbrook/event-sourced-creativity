import { DOCUMENT_ARTIFACT_KINDS, type DocumentArtifact, type DocumentArtifactDraft, type DocumentArtifactDraftItem } from "./document-artifacts.ts";
import type { CreativeOutput, EventInput } from "./events.ts";
import type { ProductionFormat } from "./managed-production.ts";
import { createSceneConfiguration, isSceneMedium } from "./scene-configuration.ts";
import { storyboardFrameContextEvents } from "./storyboard-context.ts";
import { AUDIO_ROLES, audioPlaybackTiming, type AudioRole } from "./audio.ts";
import { MODEL3D_MIME_TYPE } from "./model3d-assets.ts";
import { isModel3dMediaSource } from "./model3d-view.ts";

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

export type ImageOutputContextOptions = OutputContextOptions & {
  content?: Record<string, unknown> | null;
  /** Hash from the retained image receipt or verified original bytes. */
  contentHash?: string | null;
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

function artifactAudioRole(artifact:DocumentArtifact):AudioRole{
  const settings=artifact.settings&&typeof artifact.settings==="object"?artifact.settings:{};
  const profile=settings.audio_profile&&typeof settings.audio_profile==="object"?settings.audio_profile as Record<string,unknown>:{};
  const role=String(settings.audio_role??profile.role??"score");
  return AUDIO_ROLES.includes(role as AudioRole)?role as AudioRole:"score";
}
const artifactSemantics = (artifact: DocumentArtifact) => ({
  short_story: { type:"message", subtype:"Narrative source", role:"sequence", application:"ordered", target:`${artifact.title} narrative continuity` },
  scene: { type:"message", subtype:"Scripted scene", role:"scene", application:"co_locate", target:`${artifact.title} scene unit` },
  slides: { type:"message", subtype:"Presentation source", role:"slide_chapter", application:"ordered", target:`${artifact.title} presentation sequence` },
  storyboard: { type:"composition", subtype:"Storyboard sequence", role:"sequence", application:"ordered", target:`${artifact.title} ordered shot sequence` },
  video: { type:"motion", subtype:"Rendered motion", role:"sequence", application:"ordered", target:`${artifact.title} motion continuity` },
  audio: { type:"audio", subtype:({score:"Score",song:"Song",soundscape:"Soundscape",sound_design:"Sound design",voice:"Voice",silence:"Silence"} as Record<AudioRole,string>)[artifactAudioRole(artifact)], role:"sequence", application:"ordered", target:`${artifact.title} audible and emotional continuity` },
  model3d: { type:"model3d", subtype:"Object", role:"object", application:"co_locate", target:`${artifact.title} shape and appearance` },
}[artifact.kind]);

type Model3dContextSource = { url: string; mimeType: typeof MODEL3D_MIME_TYPE; sha256: string };
const model3dContextUrl = (value: unknown): value is string => isModel3dMediaSource(value) && /^\/api\/media\/[^?#\s]+$/.test(value);
const model3dContextHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

/** Select the retained binary model, never the provider's optional preview image. */
function model3dArtifactContextSource(artifact: DocumentArtifact): Model3dContextSource | null {
  if (artifact.kind !== "model3d") return null;
  const files = (Array.isArray(artifact.settings.model3d_files) ? artifact.settings.model3d_files : []).map(sceneRecord);
  const downloadOnlyUrls = new Set(files.filter((file)=>file.previewSupported===false).map((file)=>file.url));
  for (const file of files) {
    if (file.role !== "mesh" || file.format !== "glb" || file.mimeType !== MODEL3D_MIME_TYPE || downloadOnlyUrls.has(file.url) || !model3dContextUrl(file.url)) continue;
    const sha256 = file.sha256 ?? (file.url === artifact.mediaUrl ? artifact.settings.source_media_sha256 : null);
    if (model3dContextHash(sha256)) return { url: file.url, mimeType: MODEL3D_MIME_TYPE, sha256: sha256.toLowerCase() };
  }
  if (artifact.mediaType === MODEL3D_MIME_TYPE && !downloadOnlyUrls.has(artifact.mediaUrl) && model3dContextUrl(artifact.mediaUrl) && model3dContextHash(artifact.settings.source_media_sha256)) {
    return { url: artifact.mediaUrl, mimeType: MODEL3D_MIME_TYPE, sha256: artifact.settings.source_media_sha256.toLowerCase() };
  }
  return null;
}

/** Shared by reuse actions and their pre-action explanation. All output formats remain downloadable. */
export function model3dArtifactContextReadiness(artifact: DocumentArtifact): { supported: boolean; reason: string | null; reasonCode?: "download_only" | "glb_required" } {
  const supported = artifact.kind !== "model3d" || model3dArtifactContextSource(artifact) !== null;
  const downloadOnly = !supported && Array.isArray(artifact.settings.model3d_files) && artifact.settings.model3d_files.some((value)=>{
    const file=sceneRecord(value);return file.role==="mesh"&&file.format==="glb"&&file.previewSupported===false;
  });
  return {
    supported,
    reason: supported ? null : downloadOnly ? "Export this model as an uncompressed, self-contained GLB with embedded PNG, JPEG, or WebP textures before choosing a reusable view." : "To choose a reusable view, generate a GLB or download and upload a self-contained GLB with embedded textures.",
    ...(supported?{}:{reasonCode:downloadOnly?"download_only" as const:"glb_required" as const}),
  };
}

const sceneRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const sceneProductionFormat = (value: unknown): value is ProductionFormat =>
  value === "image" || DOCUMENT_ARTIFACT_KINDS.includes(value as typeof DOCUMENT_ARTIFACT_KINDS[number]);

const safeSceneLineageValue = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/u.test(value) ? value : null;

/** Carry useful scene semantics forward without copying private receipt/media fields. */
function sceneContextMetadata(artifact: DocumentArtifact) {
  if (artifact.kind !== "scene") return null;

  const settings = sceneRecord(artifact.settings);
  const configured = sceneRecord(settings.scene_configuration);
  const medium = isSceneMedium(settings.scene_medium)
    ? settings.scene_medium
    : isSceneMedium(configured.medium) ? configured.medium : null;
  // Historical scenes had no medium contract; leave their existing context untouched.
  if (!medium) return null;

  const workflow = sceneRecord(settings.production_workflow);
  const continuity = {
    ...sceneRecord(settings.scene_context_lineage),
    ...sceneRecord(configured.context_continuity ?? configured.contextContinuity),
  };
  const requestedTarget = configured.targetFormat ?? configured.target_format ?? workflow.target_format ?? workflow.target;
  const requestedDownstream = configured.downstreamFormats ?? configured.downstream_formats;
  const downstreamFormats = Array.isArray(requestedDownstream)
    ? requestedDownstream.filter(sceneProductionFormat).slice(0, 12)
    : [];
  const source = configured.source === "production-path" || configured.source !== "manual" && typeof workflow.id === "string"
    ? "production-path"
    : "manual";
  const configuration = createSceneConfiguration(medium, {
    source,
    targetFormat: sceneProductionFormat(requestedTarget) ? requestedTarget : null,
    downstreamFormats,
  });
  const availableMedia = [configuration.medium, configuration.alternateMedium];
  const fingerprint = [
    settings.scene_context_fingerprint,
    settings.context_fingerprint,
    settings.source_context_fingerprint,
    settings.source_snapshot_sha256,
    configured.context_fingerprint,
    configured.contextFingerprint,
    continuity.context_fingerprint,
    continuity.contextFingerprint,
    continuity.source_snapshot_sha256,
  ].map(safeSceneLineageValue).find(Boolean);
  const workflowId = safeSceneLineageValue(continuity.workflow_id ?? continuity.workflowId ?? workflow.id);
  const continuityBlockIds = continuity.source_block_ids ?? continuity.sourceBlockIds;
  const continuityArtifactIds = continuity.source_artifact_ids ?? continuity.sourceArtifactIds;
  const sourceBlockIds = Array.isArray(continuityBlockIds)
    ? [...new Set(continuityBlockIds
      .map(safeSceneLineageValue).filter((value): value is string => value !== null))].slice(0, 100)
    : [];
  const sourceArtifactIds = Array.isArray(continuityArtifactIds)
    ? [...new Set(continuityArtifactIds
      .map(safeSceneLineageValue).filter((value): value is string => value !== null))].slice(0, 12)
    : [];

  return {
    scene_medium: configuration.medium,
    scene_configuration: configuration,
    scene_alternate_medium: configuration.alternateMedium,
    scene_available_media: availableMedia,
    ...(configuration.targetFormat ? { scene_target_format: configuration.targetFormat } : {}),
    scene_downstream_formats: configuration.downstreamFormats,
    scene_context_reuse: {
      strategy: "same-authored-context",
      available_media: availableMedia,
      ...(configuration.targetFormat ? { target_format: configuration.targetFormat } : {}),
    },
    scene_context_lineage: {
      source_artifact_id: artifact.id,
      source_document_id: artifact.documentId,
      ...(safeSceneLineageValue(artifact.sourceEventId) ? { source_event_id: artifact.sourceEventId } : {}),
      ...(safeSceneLineageValue(continuity.project_id ?? continuity.projectId)
        ? { project_id: continuity.project_id ?? continuity.projectId } : {}),
      ...(workflowId ? { workflow_id: workflowId } : {}),
      ...(sourceBlockIds.length ? { source_block_ids: sourceBlockIds } : {}),
      // `source_ids` is an existing provider-redacted identifier contract.
      ...(sourceArtifactIds.length ? { source_ids: sourceArtifactIds } : {}),
      ...(fingerprint ? { context_fingerprint: fingerprint } : {}),
    },
  };
}

type AuthoredArtifactItem = DocumentArtifactDraftItem & { source_artifact_item_id: string; media_url?: string | null; media_type?: string | null; scene_id?: string | null; narrative_order?: number | null; generation_order?: number | null; duration_seconds?: number | null };

const draftItems = (artifact: DocumentArtifact, content?: DocumentArtifactDraft | null): AuthoredArtifactItem[] => artifact.items.map((item,index)=>{
  const authored=content?.items[index];
  return {
    source_artifact_item_id:item.id,
    title:typeof authored?.title==="string"?authored.title:item.title,
    body:typeof authored?.body==="string"?authored.body:item.body,
    notes:typeof authored?.notes==="string"?authored.notes:item.notes,
    image_prompt:typeof authored?.image_prompt==="string"?authored.image_prompt:item.imagePrompt,
    context_group_ids:authored?.context_group_ids??item.contextGroupIds??[],
    slide:authored?.slide??item.slide,
    ...(item.mediaUrl?{media_url:item.mediaUrl,media_type:item.mediaType}:{}),
    ...(item.sceneId?{scene_id:item.sceneId}:{}),
    ...(item.narrativeOrder?{narrative_order:item.narrativeOrder}:{}),
    ...(item.generationOrder?{generation_order:item.generationOrder}:{}),
    ...(item.durationSeconds?{duration_seconds:item.durationSeconds}:{}),
  };
});

const artifactText = (artifact: DocumentArtifact, content?: DocumentArtifactDraft | null) => {
  if(typeof content?.content_markdown==="string")return content.content_markdown;
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
 * Storyboards materialize finished frames as Reference inputs; managed-video
 * clips materialize ordered motion children without ever becoming image pixels.
 * Models retain their original GLB; a creator saves and enables an image view
 * separately before that model can provide visual input to another generation.
 */
export function artifactContextEvents(artifact: DocumentArtifact, options: ArtifactContextOptions): OutputContextResult {
  const model3dSource = model3dArtifactContextSource(artifact);
  if (artifact.kind === "model3d" && !model3dSource) return { events: [], blockIds: [], sourceItemIds: [], availableMemberCount: 0 };
  const idFactory=options.idFactory??(()=>crypto.randomUUID());const semantics=artifactSemantics(artifact);const contextSetId=options.contextSetId??idFactory();const rootBlockId=options.existingRootBlockId??idFactory();const items=draftItems(artifact,options.content);const events:EventInput[]=[];const blockIds:string[]=[];const shared={...sharedPayload(options),source_artifact_id:artifact.id,source_artifact_kind:artifact.kind,source_document_id:artifact.documentId};
  const sceneMetadata=sceneContextMetadata(artifact);
  if(!options.existingRootBlockId){
    blockIds.push(rootBlockId);
    const audioReferenceId=artifact.kind==="audio"&&artifact.mediaUrl?idFactory():null;
    if(audioReferenceId)events.push({type:"ReferenceIngested",payload:{...shared,reference_id:audioReferenceId,source_type:"generated-audio",source_ref:artifact.mediaUrl,media_url:artifact.mediaUrl,media_type:artifact.mediaType,content_hash:String(artifact.settings.source_media_sha256??""),rights_class:"account-generated",provider:artifact.provider,model_id:artifact.modelId}});
    const modelReferenceId=model3dSource?idFactory():null;
    if(model3dSource&&modelReferenceId)events.push({type:"ReferenceIngested",payload:{...shared,reference_id:modelReferenceId,source_type:"generated-model3d",source_ref:model3dSource.url,media_url:model3dSource.url,media_type:model3dSource.mimeType,content_hash:model3dSource.sha256,rights_class:"account-generated",provider:artifact.provider,model_id:artifact.modelId}});
    events.push({type:"BlockCreated",payload:{...shared,block_id:rootBlockId,type:semantics.type,handle:`${semantics.type}/${slug(artifact.title)}-${artifact.id.slice(-8)}`,position:`${options.positionPrefix??"z"}${String(options.positionStart??0).padStart(8,"0")}`,properties:{
      label:artifact.title,text:artifactText(artifact,options.content),artifact_markdown:artifactText(artifact,options.content),subtype:sceneMetadata?sceneMetadata.scene_medium==="audio"?"Audio scene":"Visual scene":semantics.subtype,intent:"include",authority:"authored",weight:.9,
      source_artifact_id:artifact.id,source_artifact_kind:artifact.kind,source_document_id:artifact.documentId,source_artifact_content_ref:artifact.contentRef,source_artifact_input_ref:artifact.inputRef??null,
      artifact_summary:artifact.summary,artifact_item_count:artifact.itemCount,artifact_structure:{presentation:options.content?.presentation??artifact.presentation,items,...(sceneMetadata??{})},...(sceneMetadata??{}),
      media_url:model3dSource?null:artifact.mediaUrl,media_type:model3dSource?null:artifact.mediaType,provider:artifact.provider,model_id:artifact.modelId,input_mode:"full_output",...(artifact.kind==="audio"?{reference_id:audioReferenceId,source_mime_type:artifact.mediaType,source_content_hash:String(artifact.settings.source_media_sha256??""),...(() => { const timing=audioPlaybackTiming(artifact.settings,artifact.mediaUrl); return { duration_seconds:timing&&timing.basis!=="estimate"?timing.seconds:null,estimated_duration_seconds:timing?.basis==="estimate"?timing.seconds:null,duration_basis:timing?.basis==="measured"?"media-container":timing?.basis??null,duration_media_url:artifact.mediaUrl,duration_media_sha256:String(artifact.settings.source_media_sha256??"") }; })(),audio_role:artifactAudioRole(artifact),rights_class:"account-generated",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false,lyrics:typeof artifact.settings.lyrics==="string"?artifact.settings.lyrics:"",audio_cues:Array.isArray(artifact.settings.audio_cues)?artifact.settings.audio_cues:[]}:{}),
      ...(model3dSource?{model_url:model3dSource.url,model_mime_type:model3dSource.mimeType,model_content_hash:model3dSource.sha256,model_reference_id:modelReferenceId,reference_id:null,rights_class:"account-generated",pixel_reference_mode:"context_only"}:{}),
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
  if(artifact.kind==="video"){
    const existing=new Set(options.existingSourceItemIds??[]);
    const available=artifact.items.map((item,index)=>({item,index})).filter(({item})=>Boolean(item.mediaUrl)&&String(item.mediaType??"").startsWith("video/"));
    for(const [ordinal,{item,index}] of available.filter(({item})=>!existing.has(item.id)).entries()){
      const authored=items[index]!;const sceneBlockId=idFactory();const sceneNumber=Number(item.narrativeOrder??index+1);const sceneTitle=authored.title||`Scene ${sceneNumber}`;
      const sceneShared={...shared,source_artifact_item_id:item.id};
      events.push({type:"BlockCreated",payload:{...sceneShared,block_id:sceneBlockId,type:"motion",handle:`motion/${slug(artifact.title)}-scene-${String(sceneNumber).padStart(2,"0")}`,position:`${options.positionPrefix??"z"}${String((options.positionStart??0)+(options.existingRootBlockId?0:1)+ordinal).padStart(8,"0")}`,properties:{
        label:`${artifact.title} · Scene ${sceneNumber} · ${sceneTitle}`,
        text:[authored.body,authored.notes].filter(Boolean).join(" "),
        subtype:"Rendered scene",intent:"include",authority:"authored",weight:.8,
        source_artifact_id:artifact.id,source_artifact_item_id:item.id,source_artifact_kind:"video",source_document_id:artifact.documentId,
        media_url:item.mediaUrl,media_type:item.mediaType,
        scene_id:item.sceneId??null,narrative_order:sceneNumber,generation_order:item.generationOrder??null,duration_seconds:item.durationSeconds??null,
        context_group_ids:[...new Set([...(item.contextGroupIds??[]),...(authored.context_group_ids??[])])],
        video_scene_index:sceneNumber,video_scene_count:available.length,video_title:artifact.title,video_scene_title:sceneTitle,video_scene_direction:authored.body,video_scene_camera_direction:authored.notes,video_scene_frame_prompt:authored.image_prompt,
        context_set_id:contextSetId,context_set_root_id:rootBlockId,copied_as_context_set:true,semantic_isolation:true,
        combined_context_memberships:[{contextSetId,name:artifact.title,role:"sequence",target:`${artifact.title} motion continuity`,application:"ordered",relativity:1,memberOrder:index+1,sourceCanvasId:options.sourceCanvasId??""}],
        created_from:options.sourceSurface,...(options.sourceCanvasItemIds?.length?{source_canvas_item_ids:options.sourceCanvasItemIds}:{}),
      }}});
      events.push({type:"BlockRelationAdded",payload:{...sceneShared,relation_id:idFactory(),from_block_id:rootBlockId,to_block_id:sceneBlockId,kind:"artifact_contains",properties:{context_set_id:contextSetId,source_artifact_id:artifact.id,ordered:true,created_from:options.sourceSurface}}});
      blockIds.push(sceneBlockId);sourceItemIds.push(item.id);
    }
  }
  return{events,blockIds,sourceItemIds,availableMemberCount:1+(artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)).length:artifact.kind==="video"?artifact.items.filter((item)=>Boolean(item.mediaUrl)&&String(item.mediaType??"").startsWith("video/")).length:0)};
}

/** Materialize a generated still as a rights-backed Reference input. */
export function imageOutputContextEvents(output: CreativeOutput, options: ImageOutputContextOptions): OutputContextResult {
  if(!output.mediaUrl)return{events:[],blockIds:[],sourceItemIds:[],availableMemberCount:0};
  const idFactory=options.idFactory??(()=>crypto.randomUUID());const blockId=idFactory(),referenceId=idFactory();const shared={...sharedPayload(options),...(output.memoryAssisted?{memory_authored_version:1,independent_evidence:false}:{}),source_output_id:output.id,source_generation_id:output.generationId,source_document_id:output.documentId};
  const contentHash=typeof options.contentHash==="string"&&/^[a-f0-9]{64}$/i.test(options.contentHash)?options.contentHash.toLowerCase():null;
  const direction=options.content??{};const title=output.title?.trim()||(typeof direction.title==="string"&&direction.title?direction.title:`${output.quality==="low"?"Draft":"Full-quality"} image input`);const guidance=[direction.rationale,direction.scene].filter((value):value is string=>typeof value==="string"&&Boolean(value));const palette=Array.isArray(direction.palette)?direction.palette.filter((value):value is string=>typeof value==="string"):[];
  return{events:[
    {type:"ReferenceIngested",payload:{...shared,reference_id:referenceId,source_type:"generated-output",source_ref:output.mediaUrl,media_url:output.mediaUrl,media_type:output.mediaType,...(contentHash?{content_hash:contentHash}:{}),rights_class:"account-generated",provider:output.provider,model_id:output.modelId}},
    {type:"BlockCreated",payload:{...shared,block_id:blockId,type:"reference",handle:`reference/generated-${output.id.slice(-8)}`,position:`${options.positionPrefix??"z"}${String(options.positionStart??0).padStart(8,"0")}`,properties:{reference_id:referenceId,label:title,text:guidance.length?[...new Set(guidance)].join("\n\n"):"Use this selected generation as visual inspiration for the next output.",output_palette:palette,palette,image_caption:title,media_url:output.mediaUrl,media_type:output.mediaType,source_mime_type:output.mediaType,...(contentHash?{source_content_hash:contentHash}:{}),width:output.width,height:output.height,focal_point:output.focalPoint,source_output_id:output.id,source_generation_id:output.generationId,source_output_content_ref:output.contentRef,source_output_prompt_ref:output.promptRef,source_document_id:output.documentId,prompt_technique:output.promptTechnique,prompt_fan_id:output.promptFanId,pixel_reference_mode:"inspiration",intent:"include",authority:"authored",weight:.8,input_mode:"full_output",created_from:options.sourceSurface,...(options.sourceCanvasItemIds?.length?{source_canvas_item_ids:options.sourceCanvasItemIds}:{})}}},
  ],blockIds:[blockId],sourceItemIds:[output.id],availableMemberCount:1};
}
