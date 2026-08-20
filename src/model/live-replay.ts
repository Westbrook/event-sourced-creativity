import type { BlockKind } from "./block-types.ts";
import type { CreativeEvent, CreativeOutput } from "./events.ts";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "./prompt-structures.ts";
import { evaluateReplayCoverage } from "./replay-coverage.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "./scenarios.ts";
import { imageAspectRatioLabel, imageFormatEventFields, normalizeImageFormat, providerRenderFormat, type ImageFormat } from "./image-format.ts";
import type { CreativeStudyKind, ReplayDevelopmentStage, ReplayDevelopmentStageKind } from "./replay-development.ts";
import { defaultSlidePresentation, normalizeSlideDeckItems, normalizeSlidePresentation, normalizeSlideVisual, type DocumentArtifactKind, type SlideStylePresetId } from "./document-artifacts.ts";
import { DEFAULT_REPLAY_EXPERIENCE, normalizeReplayExperienceId, type ReplayExperienceId } from "./replay-experiences.ts";

export type LiveReplayBlock = {
  type: BlockKind;
  subtype: string;
  label: string;
  instruction: string;
  intent: "include" | "prefer" | "avoid" | "prohibit";
  applies_to: "document" | "left" | "right" | "top" | "bottom" | "foreground" | "background";
  spatial_method: "document" | "region" | "aabb" | "subject" | "path";
  weight: number;
};

export type LiveReplayOutputBrief = {
  title: string;
  purpose: string;
  audience: string;
  content_direction: string;
  success_signal: string;
  beats: string[];
};

export type LiveReplayExperience = {
  profile: ReplayExperienceId;
  value_proposition: string;
  creative_arc: string[];
  library: {
    goal: string;
    reusable_context: string[];
    search_intent: string;
    reuse_decision: string;
  };
  canvas: {
    goal: string;
    synthesis: string;
    arrangement: string;
    suggested_next_move: string;
  };
  outputs: Record<"image" | DocumentArtifactKind, LiveReplayOutputBrief>;
  slides_style_preset: SlideStylePresetId;
};

export type LiveReplayPlan = {
  title: string;
  summary: string;
  user_goal: string;
  project_name: string;
  document_title: string;
  experience: LiveReplayExperience;
  image_format: ImageFormat;
  development: {
    stage_kind: ReplayDevelopmentStageKind;
    stage_label: string;
    focus: string;
    purpose: string;
    success_criteria: string[];
    lock_summary: string;
    locked_decisions: Array<{ block_type: BlockKind; label: string; value: string }>;
    consumes_studies: CreativeStudyKind[];
  };
  reference: {
    label: string;
    description: string;
    source_strategy: "generated" | "licensed-web";
    source_rationale: string;
    generation_prompt: string;
    internet_search_query: string;
    mood: string;
    composition: string;
    materials: string;
    lighting: string;
    spatial: string;
    palette: string[];
  };
  chat_turns: Array<{ user_message: string; assistant_reply: string; resolved_change: string; live_preview: boolean }>;
  blocks: LiveReplayBlock[];
  draft: { title: string; rationale: string; scene: string; palette: string[]; next_moves: string[] };
  final: { title: string; rationale: string; scene: string; palette: string[]; next_moves: string[] };
  critique: { axis: string; polarity: "positive" | "negative"; value: string; note: string };
  collection: { name: string; reason: string };
  memory: { preference: string; resurface_condition: string };
  fan_review: { preferred_technique: PromptTechnique; promoted_techniques: PromptTechnique[]; comparison_note: string; reasons: Record<PromptTechnique, string> };
  friction: { stuck_moment: string; recovery_action: string; view: "document" | "board" | "guided" | "layers" | "adaptive" | "editor" | "chat" };
};

export type LiveReplayFanAsset = { technique: PromptTechnique; mediaUrl: string; generationId: string; objectId: string; latencyMs: number; model: string; width: number; height: number };
export type LiveReplayReferenceSource = {
  kind: "generated" | "licensed-web";
  requestedKind: "generated" | "licensed-web";
  provider: "openai" | "fal" | "google" | "wikimedia-commons";
  model: string | null;
  query: string | null;
  sourceUrl: string | null;
  sourcePageUrl: string | null;
  licenseName: string;
  licenseUrl: string | null;
  creator: string | null;
  attribution: string;
  fallbackReason: string | null;
};
export type LiveReplayAssets = {
  developmentStage?: ReplayDevelopmentStage;
  referenceMediaUrl: string;
  referenceMediaType: string;
  referenceWidth: number;
  referenceHeight: number;
  referenceByteSize: number;
  referenceContentHash: string;
  referenceSource: LiveReplayReferenceSource;
  previewMediaUrl: string;
  previewWidth: number;
  previewHeight: number;
  referenceGenerationId: string;
  previewGenerationId: string;
  lockedStudyReferences?: Array<{ kind: CreativeStudyKind; label: string; generationId: string; objectId: string; mediaUrl: string }>;
  fanOutputs: LiveReplayFanAsset[];
  plannerModel: string;
  imageModel: string;
  referenceLatencyMs: number;
  previewLatencyMs: number;
  createdAt: string;
};
export type LiveReplayMilestone = { plan: LiveReplayPlan; assets: LiveReplayAssets };

const scopeFor=(block:LiveReplayBlock,index=0)=>{
  if(block.spatial_method==="document")return{schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"};
  if(block.spatial_method==="region")return{schema_version:1,kind:"region",coordinate_space:"document-normalized",region:block.applies_to==="document"?"foreground":block.applies_to,instruction:`the ${block.applies_to} portion of the composition`,feather:.14,falloff:"contextual",polarity:"inside"};
  if(block.spatial_method==="aabb")return{schema_version:1,kind:"aabb",coordinate_space:"document-normalized",aabb:{x:.08+(index%4)*.12,y:.12+(index%3)*.08,width:.34,height:.46},feather:.08,falloff:"soft",polarity:"inside"};
  if(block.spatial_method==="subject")return{schema_version:1,kind:"subject",coordinate_space:"document-normalized",subject_block_id:"live-block-subject",subject_relation:block.applies_to==="background"?"behind":"around",feather:.18,falloff:"contextual",polarity:"inside"};
  return{schema_version:1,kind:"path",coordinate_space:"document-normalized",path:[{x:.12,y:.14},{x:.74,y:.1},{x:.82,y:.74},{x:.18,y:.84}],feather:.06,falloff:"soft",polarity:block.intent==="avoid"||block.intent==="prohibit"?"outside":"inside"};
};

const effectFor=(intent:LiveReplayBlock["intent"])=>intent==="prohibit"?"must_not_include":intent==="avoid"?"deemphasize":intent==="prefer"?"prefer":"include";
const text=(value:unknown)=>String(value??"");
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const fallbackOutput=(plan:LiveReplayPlan,kind:"image"|DocumentArtifactKind):LiveReplayOutputBrief=>({title:kind==="image"?plan.final.title:`${plan.document_title} · ${kind.replace("_"," ")}`,purpose:kind==="image"?plan.final.rationale:`Translate the durable document into a useful ${kind.replace("_"," ")}.`,audience:"creative team",content_direction:kind==="image"?plan.final.scene:plan.summary,success_signal:kind==="image"?plan.critique.note:`The ${kind.replace("_"," ")} creates a clear next decision without losing the source context.`,beats:[plan.user_goal,plan.reference.description,plan.final.scene,plan.critique.note]});
const outputBeats=(brief:LiveReplayOutputBrief,experience:LiveReplayExperience)=>Array.isArray(brief.beats)&&brief.beats.length>=3?brief.beats:experience.creative_arc;
export const liveReplayExperience=(plan:LiveReplayPlan):LiveReplayExperience=>plan.experience??{
  profile:DEFAULT_REPLAY_EXPERIENCE,
  value_proposition:plan.summary,
  creative_arc:[plan.user_goal,plan.reference.description,plan.draft.rationale,plan.final.rationale,plan.critique.note],
  library:{goal:plan.collection.reason,reusable_context:plan.blocks.slice(0,5).map((block)=>block.label),search_intent:plan.reference.label,reuse_decision:`Reuse the strongest context in ${plan.collection.name}.`},
  canvas:{goal:`Explore ${plan.user_goal}`,synthesis:plan.final.scene,arrangement:plan.reference.composition,suggested_next_move:plan.final.next_moves[0]??"Prepare the selected context as a document."},
  outputs:Object.fromEntries((["image","short_story","scene","slides","storyboard","video"] as const).map((kind)=>[kind,fallbackOutput(plan,kind)])) as LiveReplayExperience["outputs"],
  slides_style_preset:"nocturne",
};

/**
 * The provider supplies creative data; this mapper retains authority, identity, and
 * causation rules so a model can never mint arbitrary event envelopes.
 */
export function buildLiveReplayEvents(plan:LiveReplayPlan,assets:LiveReplayAssets,sessionId:string):CreativeEvent[]{
  const source=buildComprehensiveScenario(`replay-session:${sessionId}`);const sourceStart=Date.parse(source[0]?.occurredAt??assets.createdAt);const actualStart=Date.parse(assets.createdAt);
  const experience=liveReplayExperience(plan);experience.profile=normalizeReplayExperienceId(experience.profile);
  const stage=assets.developmentStage??{kind:"composition" as const,label:"Composed image",purpose:"Resolve the full creative direction into one image.",sequence:1,total:1,study:false,consumesStudies:[]};
  const development=plan.development??{stage_kind:stage.kind,stage_label:stage.label,focus:plan.user_goal,purpose:stage.purpose,success_criteria:["The intended direction is recognizable."],lock_summary:stage.study?`Lock the ${stage.label.toLowerCase()} before composition.`:"Resolve the composed image.",locked_decisions:[],consumes_studies:stage.consumesStudies};
  const lockedStudyInputs=(assets.lockedStudyReferences??[]).map((reference)=>({source:"locked-study",study_kind:reference.kind,label:reference.label,generation_id:reference.generationId,object_id:reference.objectId,media_url:reference.mediaUrl,mode:"preserve_subject"}));
  const stageFields={development_stage_kind:stage.kind,development_stage_label:stage.label,development_stage_sequence:stage.sequence,development_stage_total:stage.total,study:stage.study,study_lock_summary:development.lock_summary,locked_decisions:development.locked_decisions,consumes_studies:stage.consumesStudies};
  const blocksByType=new Map(plan.blocks.map((block)=>[block.type,block]));const imageFormat=normalizeImageFormat(plan.image_format);const sourceFormatBlockId=text(source.find((event)=>event.type==="BlockCreated"&&event.payload.type==="format")?.payload.block_id)||"live-block-format";const previewFormatFields=imageFormatEventFields(imageFormat,"preview",sourceFormatBlockId);const fullFormatFields=imageFormatEventFields(imageFormat,"full",sourceFormatBlockId);const previewRender=providerRenderFormat(imageFormat,"preview");const fullRender=providerRenderFormat(imageFormat,"full");
  const fanByTechnique=new Map(assets.fanOutputs.map((output)=>[output.technique,output]));
  const preferred=fanByTechnique.get(plan.fan_review.preferred_technique)??assets.fanOutputs[0];
  if(!preferred||PROMPT_TECHNIQUES.some((technique)=>!fanByTechnique.has(technique)))throw new Error("live_replay_prompt_fan_assets_incomplete");
  const activeRelations=new Map<string,Record<string,unknown>>();for(const event of source){const id=text(event.payload.relation_id);if(!id)continue;if(event.type==="BlockRelationAdded")activeRelations.set(id,{relation_id:id,from_block_id:event.payload.from_block_id,to_block_id:event.payload.to_block_id,kind:event.payload.kind,properties:event.payload.properties});if(event.type==="BlockRelationRemoved")activeRelations.delete(id);}
  const fallbackBlock=plan.blocks[0]??{type:"direction" as BlockKind,subtype:"Creative intent",label:plan.title,instruction:plan.user_goal,intent:"include" as const,applies_to:"document" as const,spatial_method:"document" as const,weight:.8};
  let blockOrdinal=0;let chatOrdinal=0;let assistantOrdinal=0;
  return source.map((event,index)=>{
    const eventId=`live-${sessionId}-${index+1}`;const previousId=index?`live-${sessionId}-${index}`:null;const occurredAt=new Date(actualStart+Math.max(0,Date.parse(event.occurredAt)-sourceStart)).toISOString();
    let payload:Record<string,unknown>={...event.payload,mock_data_source:"openai-provider",replay_session_id:sessionId,experience_profile:experience.profile,value_proposition:experience.value_proposition,...stageFields};let returnedType=event.type;let returnedActor=event.actor;
    if(event.type==="ProjectCreated")payload={...payload,name:plan.project_name,description:plan.summary,creative_arc:experience.creative_arc};
    if(event.type==="ProjectRenamed")payload={...payload,new_name:plan.project_name,reason:"The LLM-populated interaction converged on the project’s working language."};
    if(event.type==="DocumentCreated"||event.type==="DocumentRenamed")payload={...payload,title:plan.document_title,new_title:plan.document_title,creative_goal:plan.user_goal};
    if(event.type==="IntentDeclared")payload={...payload,statement:plan.user_goal,statement_ref:`live-intent:${sessionId}`};
    if(event.type==="BlockCreated"){
      const existingType=text(payload.type) as BlockKind;const standalone=payload.scope==="library";const block=blocksByType.get(existingType)??plan.blocks[blockOrdinal%Math.max(1,plan.blocks.length)]??fallbackBlock;blockOrdinal+=1;
      const libraryRole=experience.library.reusable_context[(blockOrdinal-1)%Math.max(1,experience.library.reusable_context.length)]??block.label;
      payload={...payload,type:block.type,handle:`${block.type}/${block.label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"decision"}`,properties:{text:block.instruction,label:block.label,subtype:block.subtype,authority:"authored",weight:block.weight,intent:block.intent,effect:effectFor(block.intent),spatial_scope:scopeFor(block,blockOrdinal-1),development_stage:stage.kind,study_lock_candidate:stage.study,...(standalone?{created_from:"library-block-editor",forked_from_block_id:`live-source-${sessionId}-${block.type}`,library_goal:experience.library.goal,reusable_role:libraryRole,reuse_decision:experience.library.reuse_decision}:{}) ,...(block.type==="format"?{image_format:imageFormat}:{}),...(block.type==="reference"?{reference_id:`live-reference-${sessionId}`,media_url:assets.referenceMediaUrl,pixel_reference_mode:"context_only"}:{})}};
    }
    if(event.type==="BlockLocked"&&stage.study)payload={...payload,lock_scope:"creative-study",lock_reason:development.lock_summary,locked_decisions:development.locked_decisions};
    if(event.type==="ReferenceIngested")payload={...payload,reference_id:`live-reference-${sessionId}`,label:plan.reference.label,description:plan.reference.description,source_type:assets.referenceSource.kind==="licensed-web"?"licensed-web-import":"generated-image",source_ref:assets.referenceSource.sourceUrl??assets.referenceMediaUrl,source_page_url:assets.referenceSource.sourcePageUrl,media_url:assets.referenceMediaUrl,content_ref:assets.referenceMediaUrl,content_hash:assets.referenceContentHash,media_type:assets.referenceMediaType,image_width:assets.referenceWidth,image_height:assets.referenceHeight,byte_size:assets.referenceByteSize,actual_image:true,asset_prepared_before_ingest:true,provider:assets.referenceSource.provider,model_id:assets.referenceSource.model??assets.referenceSource.provider,synthetic_reference:true,reference_asset_id:assets.referenceGenerationId,reference_generation_id:assets.referenceSource.kind==="generated"?assets.referenceGenerationId:null,reference_source:assets.referenceSource,license_name:assets.referenceSource.licenseName,license_url:assets.referenceSource.licenseUrl,attribution:assets.referenceSource.attribution,latency_ms:assets.referenceLatencyMs};
    if(event.type==="RightsAsserted")payload={...payload,reference_id:`live-reference-${sessionId}`,rights_class:assets.referenceSource.kind==="licensed-web"?"licensed-public-web-fixture":"synthetic-provider-fixture",scope:"generation-and-image-editing",assertion_method:assets.referenceSource.kind==="licensed-web"?"verified-commons-license":"approved-provider-backed-replay",license_name:assets.referenceSource.licenseName,license_url:assets.referenceSource.licenseUrl,attribution:assets.referenceSource.attribution};
    if(event.type==="ExtractionCompleted")payload={...payload,overall_confidence:.86,requested_findings:["palette","mood","composition","material","lighting","spatial"],chips:[{property:"colors",value:plan.reference.palette,confidence:.9},{property:"reference_findings",value:[{kind:"mood",label:"Mood",value:plan.reference.mood,confidence:.86},{kind:"composition",label:"Composition",value:plan.reference.composition,confidence:.84},{kind:"material",label:"Materials",value:plan.reference.materials,confidence:.82},{kind:"lighting",label:"Lighting",value:plan.reference.lighting,confidence:.88},{kind:"spatial",label:"Spatial structure",value:plan.reference.spatial,confidence:.8}],confidence:.84}]};
    if(event.type==="ChatMessageSent"){const turn=plan.chat_turns[chatOrdinal%plan.chat_turns.length];payload={...payload,turn_id:`live-chat-turn:${sessionId}:${chatOrdinal+1}`,content_ref:`live-chat-user:${sessionId}:${chatOrdinal+1}`,mock_content:turn.user_message,live_preview:turn.live_preview,live_preview_requested:turn.live_preview,job_kind:"chat"};chatOrdinal+=1;}
    if(event.type==="AssistantReasoned"){const turn=plan.chat_turns[assistantOrdinal%plan.chat_turns.length];payload={...payload,turn_id:`live-chat-turn:${sessionId}:${assistantOrdinal+1}`,content_ref:`live-chat-assistant:${sessionId}:${assistantOrdinal+1}`,mock_content:turn.assistant_reply,resolved_change:turn.resolved_change,provider:"openai",model_id:assets.plannerModel,job_kind:event.payload.operation==="adaptive-structure"?"structure_adaptive":"chat",live_preview_requested:turn.live_preview,preview_suppressed:!turn.live_preview};assistantOrdinal+=1;}
    if(event.type==="MutationProposed")payload={...payload,summary:plan.chat_turns[0]?.resolved_change??plan.user_goal,content_ref:`live-mutation:${sessionId}`};
    if(event.type==="BlockPropertyEdited"&&payload.property_path==="image_format")payload={...payload,block_id:sourceFormatBlockId,document_id:`live-document-${sessionId}`,old_value:{schema_version:1,aspect_ratio:{width:3,height:2},dimensions:{width:1536,height:1024,unit:"px"}},new_value:imageFormat,source_surface:"context-block"};
    if(event.type==="IdeationPreviewCompleted")payload={...payload,generation_id:assets.previewGenerationId,object_id:`draft-${sessionId}`,object_ids:[`draft-${sessionId}`],media_url:assets.previewMediaUrl,media_type:"image/jpeg",image_width:assets.previewWidth??previewRender.width,image_height:assets.previewHeight??previewRender.height,model_id:assets.imageModel,quality:"low",purpose:"ideate",...previewFormatFields,output_format:"jpeg",output_compression:70,planning_source:"provider",reference_input_count:1,reference_inputs:[{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_uploaded_reference_pixels:true,adapter_version:"openai-image-v5",latency_ms:assets.previewLatencyMs,simulation:false,title:plan.draft.title,rationale:plan.draft.rationale,scene:plan.draft.scene,palette:plan.draft.palette,next_moves:plan.draft.next_moves,output_brief:experience.outputs.image};
    if(event.type==="IdeationPromoted")payload={...payload,promotion_id:`promotion-${sessionId}`,draft_generation_id:assets.previewGenerationId,draft_object_id:`draft-${sessionId}`,full_generation_id:preferred.generationId,prompt_fan_id:`live-prompt-fan-${sessionId}`,intent_weight:1,system_success_pending:true};
    const technique=PROMPT_TECHNIQUES.includes(payload.prompt_technique as PromptTechnique)?payload.prompt_technique as PromptTechnique:null;const sourceFanId=text(payload.prompt_fan_id);const liveFanId=sourceFanId?`live-${sourceFanId}-${sessionId}`:`live-prompt-fan-${sessionId}`;const fanAsset=technique&&sourceFanId?fanByTechnique.get(technique):undefined;
    if(event.type==="GenerationRequested"&&event.actor==="user"&&fanAsset)payload={...payload,generation_id:fanAsset.generationId,requested_output:"image",model_ids:[assets.plannerModel,fanAsset.model],quality:"high",purpose:"final",job_kind:"generate",...fullFormatFields,prompt_fan_id:liveFanId,reference_preview_event_id:`live-preview:${sessionId}`};
    if(event.type==="ContextCompiled"&&!fanAsset){
      const compiled=record(payload.compiled_snapshot);
      payload={...payload,compiled_snapshot:{...compiled,relationships:[...activeRelations.values()],experience_profile:experience.profile,value_proposition:experience.value_proposition,creative_arc:experience.creative_arc,library_goal:experience.library.goal,canvas_goal:experience.canvas.goal}};
    }
    if(event.type==="ContextCompiled"&&fanAsset){const referenceInputs=[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"},...lockedStudyInputs];payload={...payload,generation_id:fanAsset.generationId,model_id:fanAsset.model,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v5",...fullFormatFields,prompt_fan_id:liveFanId,reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,used_locked_study_pixels:lockedStudyInputs.length>0,compiled_snapshot:{facts:plan.blocks.map((block,ordinal)=>({block_id:`live-block-${block.type}`,type:block.type,label:block.label,instruction:block.instruction,intent:block.intent,active:true,properties:{text:block.instruction,weight:block.weight,spatial_scope:scopeFor(block,ordinal),...(block.type==="format"?{image_format:imageFormat}:{})}})),relationships:[...activeRelations.values()],reference:plan.reference,reference_inputs:referenceInputs,development,locked_studies:lockedStudyInputs,user_goal:plan.user_goal,standing_constraints:[plan.memory.preference],prompt_technique:technique,as_of:{replay_session_id:sessionId,complete:true}}};}
    if(event.type==="GenerationCompleted"&&event.actor==="worker:generator"&&fanAsset){const referenceInputs=[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"},...lockedStudyInputs];payload={...payload,generation_id:fanAsset.generationId,object_ids:[fanAsset.objectId],media_url:fanAsset.mediaUrl,media_type:"image/png",image_width:fanAsset.width??fullRender.width,image_height:fanAsset.height??fullRender.height,quality:"high",purpose:stage.study?"study":"final",model_id:fanAsset.model,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v5",...fullFormatFields,prompt_fan_id:liveFanId,promoted_from_object_id:`draft-${sessionId}`,promotion_outcome:"completed",reference_input_count:referenceInputs.length,reference_inputs:referenceInputs,used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,used_locked_study_pixels:lockedStudyInputs.length>0,latency_ms:fanAsset.latencyMs,simulation:false,title:`${plan.final.title} · ${technique}`,rationale:plan.fan_review.reasons[technique!],scene:plan.final.scene,palette:plan.final.palette,next_moves:plan.final.next_moves,output_brief:experience.outputs.image};}
    if(event.type==="PromptFanOutputPromoted"){const promoted=plan.fan_review.promoted_techniques[0]??plan.fan_review.preferred_technique;const asset=fanByTechnique.get(promoted)!;payload={...payload,object_id:asset.objectId,prompt_fan_id:`live-${text(event.payload.prompt_fan_id)}-${sessionId}`,prompt_technique:promoted,reason:plan.fan_review.reasons[promoted],study_locked:stage.study,lock_summary:stage.study?development.lock_summary:null,locked_decisions:stage.study?development.locked_decisions:[]};}
    if(event.type==="PromptTechniquePreferred")payload={...payload,technique:plan.fan_review.preferred_technique,source_fan_id:`live-${text(event.payload.source_fan_id)}-${sessionId}`,source_output_id:preferred.objectId,comparison_note:plan.fan_review.comparison_note};
    if(event.type==="ObjectCritiqued")payload={...payload,object_id:preferred.objectId,axis_ref:plan.critique.axis,polarity:plan.critique.polarity,value:plan.critique.value,note:plan.critique.note};
    if(["ObjectViewed","ObjectSaved","ObjectPinned","ObjectUnpinned","ObjectRegenerated","AddedToLibrary","RemovedFromLibrary","ObjectDiscarded","ObjectExported","AnnotationAdded","AnnotationRetracted"].includes(event.type))payload={...payload,object_id:preferred.objectId};
    if(event.type==="ComparisonOpened")payload=event.payload.comparison_kind==="prompt_fan"?{...payload,comparison_kind:"prompt_fan",prompt_fan_id:liveFanId,object_ids:assets.fanOutputs.map((output)=>output.objectId),comparison_note:plan.fan_review.comparison_note}:{...payload,object_ids:[`draft-${sessionId}`,preferred.objectId]};
    if(event.type==="CollectionCreated"||event.type==="CollectionRenamed")payload={...payload,handle:plan.collection.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),new_handle:plan.collection.name,reason:plan.collection.reason,library_goal:experience.library.goal,reuse_decision:experience.library.reuse_decision};
    if(event.type==="CanvasCreated")payload={...payload,name:`${plan.project_name} · synthesis board`,creative_goal:experience.canvas.goal};
    if(event.type==="CanvasInteractionRecorded"){
      const interaction=text(payload.interaction_id);const creativeIntent=interaction==="source_searched"?experience.library.search_intent:interaction==="intent_submitted"?experience.canvas.goal:interaction==="suggestion_used"||interaction==="suggestion_dismissed"?experience.canvas.suggested_next_move:interaction.includes("organization")||interaction.includes("arrang")?experience.canvas.arrangement:experience.canvas.synthesis;
      payload={...payload,creative_intent:creativeIntent,board_goal:experience.canvas.goal};
    }
    if(event.type==="CanvasItemPlaced"||event.type==="CanvasReferenceCreated")payload={...payload,board_goal:experience.canvas.goal,creative_role:experience.library.reusable_context[index%Math.max(1,experience.library.reusable_context.length)]??experience.canvas.synthesis};
    if(event.type==="CanvasArrangementCreated")payload={...payload,label:experience.canvas.arrangement,rationale:experience.canvas.synthesis,presentation_intent:"organization"};
    if(event.type==="ContextSetFormalized")payload={...payload,name:experience.canvas.synthesis,selection_rationale:experience.canvas.goal,next_step:experience.canvas.suggested_next_move};
    if(event.type==="DocumentCreated"&&payload.created_from==="canvas-selection")payload={...payload,title:experience.outputs.image.title,creative_goal:experience.canvas.synthesis};
    if(event.type==="PreferenceAuthored")payload={...payload,value:plan.memory.preference,source_claim_ref:`live-memory:${sessionId}`};
    if(event.type==="ConditionSet"||event.type==="Resurfaced")payload={...payload,condition:plan.memory.resurface_condition,condition_ref:`live-condition:${sessionId}`};
    if(event.type==="AttentionEpisodeObserved"&&text(payload.document_id)){payload={...payload,document_view:plan.friction.view,friction_hypothesis:plan.friction.stuck_moment,recovery_observed:plan.friction.recovery_action,outcome_weight:.08,authority:"supplemental-weak-signal"};}
    if(event.type==="BriefComposed")payload={...payload,recovery_context:{stuck_moment:plan.friction.stuck_moment,recovery_action:plan.friction.recovery_action,last_difficult_view:plan.friction.view}};
    if(event.type==="DocumentRenderCompleted"){
      const artifactKind=text(payload.artifact_kind);
      const outputBrief=experience.outputs[artifactKind as DocumentArtifactKind]??fallbackOutput(plan,artifactKind as DocumentArtifactKind);
      if(artifactKind==="video"){
        returnedType="DocumentRenderFailed";returnedActor="worker:renderer";payload={artifact_id:payload.artifact_id,artifact_kind:"video",document_id:payload.document_id,project_id:payload.project_id,source_surface:payload.source_surface,mock_data_source:"openai-provider",replay_session_id:sessionId,experience_profile:experience.profile,value_proposition:experience.value_proposition,output_brief:outputBrief,error_code:"video_provider_not_approved_for_actual_data_mock",error_category:"application",error_message:"The actual-data mock approval covers structured plans and still images, not a paid video-provider call. The planned video treatment remains inspectable without incurring unapproved cost.",retryable:false,provider_job_id:null,video_mock_boundary:true};
      }else if(artifactKind==="storyboard"){
        const beats=outputBeats(outputBrief,experience);const count=Math.max(4,Number(payload.item_count??6));payload={...payload,title:outputBrief.title,summary:outputBrief.purpose,output_brief:outputBrief,items:Array.from({length:count},(_,ordinal)=>{const asset=assets.fanOutputs[ordinal%assets.fanOutputs.length];const beat=beats[ordinal%Math.max(1,beats.length)]??outputBrief.content_direction;return{id:`${text(payload.artifact_id)}-frame-${ordinal+1}`,title:`Beat ${ordinal+1} · ${beat.slice(0,54)}`,body:beat,notes:`${outputBrief.audience}: ${outputBrief.success_signal}`,image_prompt:`${beat}. ${plan.reference.composition}. ${outputBrief.content_direction}`,media_url:asset.mediaUrl,media_type:"image/png",width:asset.width,height:asset.height,fixture_asset_reused:true,prompt_technique:asset.technique};}),provider:"replay-approved-image-assets",model_id:assets.imageModel,provider_job_id:null,actual_data_scope:"structured-storyboard-with-reused-approved-pixels"};
      }else if(artifactKind==="slides"){
        const beats=outputBeats(outputBrief,experience);const count=Math.max(4,Number(payload.item_count??6));const fallback=defaultSlidePresentation(experience.slides_style_preset);const palette=plan.final.palette;const presentation=normalizeSlidePresentation({theme:outputBrief.title,footer_label:plan.document_title,style_preset:experience.slides_style_preset,mode:fallback.mode,palette:{background:palette[0]??fallback.palette.background,foreground:palette[1]??fallback.palette.foreground,accent:palette[2]??fallback.palette.accent,muted:palette[3]??fallback.palette.muted,surface:palette[4]??fallback.palette.surface}})??fallback;
        const visualSeeds=[
          {layout:"cover",kicker:"Resolved direction",bullets:plan.final.next_moves.slice(0,2),visual:{kind:"hero-type",label:"Creative thesis",value:plan.reference.mood,data:[]}},
          {layout:"split",kicker:"Frame",bullets:development.success_criteria.slice(0,2),visual:{kind:"metric",label:"Target ratio",value:imageAspectRatioLabel(imageFormat),data:[]}},
          {layout:"split",kicker:"Evidence",bullets:[plan.reference.spatial,plan.reference.description],visual:{kind:"bars",label:"Decision confidence",value:"",data:[{label:"Composition",value:"88%",weight:.88},{label:"Lighting",value:"84%",weight:.84},{label:"Materials",value:"79%",weight:.79}]}},
          {layout:"statement",kicker:"Progression",bullets:plan.chat_turns.map((turn)=>turn.resolved_change).slice(0,2),visual:{kind:"timeline",label:"Creative sequence",value:"",data:[{label:"Explore",value:"Open",weight:.35},{label:"Resolve",value:"Aligned",weight:.7},{label:"Commit",value:"Ready",weight:1}]}},
          {layout:"split",kicker:"Relationships",bullets:development.locked_decisions.map((decision)=>decision.value).slice(0,2),visual:{kind:"diagram",label:"Connected context",value:"",data:[{label:"Subject",value:"",weight:.92},{label:"Environment",value:"",weight:.78},{label:"Finish",value:"",weight:.66}]}},
          {layout:"statement",kicker:"Palette",bullets:[plan.memory.preference],visual:{kind:"color-field",label:"Tonal system",value:"",data:[{label:"Shadow",value:palette[0]??"#171c22",weight:.9},{label:"Warmth",value:palette[1]??"#b96f42",weight:.78},{label:"Canvas",value:palette[2]??"#e8d7bd",weight:.64}]}},
          {layout:"closing",kicker:"Commitment",bullets:[plan.critique.note],visual:{kind:"hero-type",label:"Handoff state",value:"Ready for handoff",data:[]}},
        ];
        const slideRoles=["Direction","Frame","Evidence","Progression","Relationships","Palette","Commitment"];
        const slideBodies=[outputBrief.content_direction,...beats,plan.reference.composition,plan.reference.lighting,plan.collection.reason,plan.reference.materials,plan.final.rationale];
        const rawSlides=Array.from({length:count},(_,ordinal)=>{const block=plan.blocks[Math.max(0,ordinal-1)%Math.max(1,plan.blocks.length)],nextMove=plan.final.next_moves[Math.max(0,ordinal-1)%Math.max(1,plan.final.next_moves.length)];const title=ordinal===0?outputBrief.title:`${slideRoles[ordinal%slideRoles.length]} · ${block?.label??nextMove??`Decision ${ordinal+1}`}`;const body=ordinal===0?outputBrief.content_direction:slideBodies[ordinal]??`${block?.instruction??nextMove??plan.user_goal} This is the distinct decision for stage ${ordinal+1}.`;const seed=visualSeeds[ordinal%visualSeeds.length];return{id:`${text(payload.artifact_id)}-slide-${ordinal+1}`,title,body,notes:`For ${outputBrief.audience}. ${outputBrief.success_signal}`,image_prompt:"Visual rationale only; the slide is rendered from reusable presentation data.",slide:normalizeSlideVisual(seed,{title,body},ordinal)};});
        payload={...payload,title:outputBrief.title,summary:outputBrief.purpose,output_brief:outputBrief,presentation,items:normalizeSlideDeckItems(rawSlides).map((slide,index)=>({...slide,id:rawSlides[index]?.id??`${text(payload.artifact_id)}-slide-${index+1}`})),actual_data_scope:"provider-planned-visual-structure"};
      }else {
        const beats=outputBeats(outputBrief,experience);const arc=beats.join("\n\n");payload={...payload,title:outputBrief.title,summary:outputBrief.purpose,output_brief:outputBrief,items:[{id:`${text(payload.artifact_id)}-part-1`,title:outputBrief.title,body:artifactKind==="scene"?`${outputBrief.content_direction}\n\n${beats.map((beat,index)=>`BEAT ${index+1}: ${beat}`).join("\n")}`:`${outputBrief.content_direction}\n\n${arc}`,notes:`For ${outputBrief.audience}. Success: ${outputBrief.success_signal}`,image_prompt:""}],actual_data_scope:"provider-planned-structure"};
      }
    }
    if(event.type==="DocumentArtifactViewed"&&payload.artifact_kind==="video")payload={...payload,artifact_id:text(payload.artifact_id).replace(/-video$/,"-storyboard"),artifact_kind:"storyboard",viewer_kind:"storyboard"};
    if(event.type==="DocumentArtifactExported"&&payload.artifact_kind==="video")payload={...payload,artifact_id:text(payload.artifact_id).replace(/-video$/,"-storyboard"),artifact_kind:"storyboard",format:"markdown"};
    return{...event,type:returnedType,actor:returnedActor,eventId,streamId:`replay-session:${sessionId}`,sequence:index+1,occurredAt,recordedAt:occurredAt,clientId:"web:replay-laboratory",correlationId:`live-replay:${sessionId}:${event.correlationId}`,causationId:previousId,payload};
  });
}

export function replayCoverage(events:CreativeEvent[]){
  return evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);
}

let replayCycleEventCount:number|undefined;
export function liveReplayCycleEventCount(){
  replayCycleEventCount??=buildComprehensiveScenario().length;
  return replayCycleEventCount;
}

export function minimumLiveReplayEventCount(milestoneCount:number){
  return liveReplayCycleEventCount()*Math.max(1,Math.floor(milestoneCount));
}

/**
 * Materialize one bounded page of a long-running provider-backed fixture.
 * Provider calls create the milestone assets once; later cycles reuse those
 * durable pixels while continuing to exercise the full event vocabulary.
 */
export function buildScaledLiveReplayPage(milestones:LiveReplayMilestone[],sessionId:string,targetEventCount:number,startSequence=1,pageSize=250):CreativeEvent[]{
  if(!milestones.length||targetEventCount<=0||startSequence>targetEventCount)return[];
  const first=milestones[0];
  const probe=buildLiveReplayEvents(first.plan,{...first.assets,createdAt:first.assets.createdAt},`${sessionId}-probe`);
  const cycleLength=probe.length;
  const cycleSpan=Math.max(1,Date.parse(probe.at(-1)?.occurredAt??first.assets.createdAt)-Date.parse(probe[0]?.occurredAt??first.assets.createdAt));
  const sessionStart=Date.parse(first.assets.createdAt);
  const endSequence=Math.min(targetEventCount,startSequence+Math.max(1,pageSize)-1);
  const pages:CreativeEvent[]=[];
  const cycleCache=new Map<number,CreativeEvent[]>();
  for(let sequence=startSequence;sequence<=endSequence;sequence+=1){
    const globalIndex=sequence-1;const cycleIndex=Math.floor(globalIndex/cycleLength);const localIndex=globalIndex%cycleLength;const milestoneIndex=cycleIndex%milestones.length;const milestone=milestones[milestoneIndex];
    let cycle=cycleCache.get(cycleIndex);
    if(!cycle){const cycleId=`${sessionId}-m${milestoneIndex+1}-c${cycleIndex+1}`;cycle=buildLiveReplayEvents(milestone.plan,{...milestone.assets,createdAt:first.assets.createdAt},cycleId);cycleCache.set(cycleIndex,cycle);}
    const source=cycle[localIndex];const firstProviderCycle=cycleIndex===milestoneIndex;const assetKey=source.type==="GenerationCompleted"&&milestone.assets.fanOutputs.some((asset)=>asset.generationId===source.payload.generation_id)?String(source.payload.generation_id??""):source.type==="IdeationPreviewCompleted"&&source.payload.generation_id===milestone.assets.previewGenerationId?String(source.payload.generation_id??""):source.type==="ReferenceIngested"&&source.payload.reference_asset_id===milestone.assets.referenceGenerationId?String(source.payload.reference_asset_id??""):"";
    const priorSameAsset=assetKey?cycle.slice(0,localIndex).some((event)=>event.type===source.type&&String(event.payload.generation_id??event.payload.reference_asset_id??event.payload.reference_generation_id??"")===assetKey):false;
    const durableMediaBacked=Boolean(assetKey)&&firstProviderCycle&&!priorSameAsset;
    const providerCallBacked=durableMediaBacked&&(source.type!=="ReferenceIngested"||milestone.assets.referenceSource.kind==="generated");
    const externalAssetBacked=durableMediaBacked&&source.type==="ReferenceIngested"&&milestone.assets.referenceSource.kind==="licensed-web";
    const occurredAt=new Date(sessionStart+cycleIndex*(cycleSpan+60_000)+Math.max(0,Date.parse(source.occurredAt)-sessionStart)).toISOString();
    pages.push({...source,eventId:`live-${sessionId}-${sequence}`,streamId:`replay-session:${sessionId}`,sequence,occurredAt,recordedAt:occurredAt,correlationId:`live-replay:${sessionId}:cycle-${cycleIndex+1}`,causationId:sequence>1?`live-${sessionId}-${sequence-1}`:null,payload:{...source.payload,replay_session_id:sessionId,target_event_count:targetEventCount,provider_milestone_index:milestoneIndex+1,fixture_cycle:cycleIndex+1,durable_media_backed:durableMediaBacked,provider_call_backed:providerCallBacked,external_asset_backed:externalAssetBacked,fixture_asset_reused:Boolean(assetKey)&&!durableMediaBacked}});
  }
  return pages;
}

/**
 * Semantic coverage must see one complete application rehearsal for every paid
 * creative milestone. A fixed first-page sample can omit later study or
 * composition stages even when the stored stream contains them.
 */
export function buildLiveReplayCoverageSample(milestones:LiveReplayMilestone[],sessionId:string):CreativeEvent[]{
  if(!milestones.length)return[];
  const eventCount=minimumLiveReplayEventCount(milestones.length);
  return buildScaledLiveReplayPage(milestones,sessionId,eventCount,1,eventCount);
}

export function buildScaledLiveReplayEvents(milestones:LiveReplayMilestone[],sessionId:string,targetEventCount:number):CreativeEvent[]{
  const events:CreativeEvent[]=[];for(let start=1;start<=targetEventCount;start+=500)events.push(...buildScaledLiveReplayPage(milestones,sessionId,targetEventCount,start,500));return events;
}

const persistentReplayMediaUrl=(value:unknown)=>{const url=String(value??"");return Boolean(url)&&!url.includes("replay%2Fgenerated")&&!url.includes("/replay/generated");};

/** Returns each durable provider image once, independent of replay position. */
export function replaySavedMediaOutputs(events:CreativeEvent[]):CreativeOutput[]{
  const durableReceipts=events.some((event)=>event.payload.durable_media_backed===true);const providerReceipts=events.some((event)=>event.payload.provider_call_backed===true);const outputs=new Map<string,CreativeOutput>();
  for(const event of events){
    if(!["ReferenceIngested","IdeationPreviewCompleted","GenerationCompleted"].includes(event.type))continue;const payload=event.payload;const mediaUrl=String(payload.media_url??"");if(!persistentReplayMediaUrl(mediaUrl)||payload.simulation===true||(durableReceipts?payload.durable_media_backed!==true:providerReceipts&&payload.provider_call_backed!==true))continue;
    const reference=event.type==="ReferenceIngested";const preview=event.type==="IdeationPreviewCompleted";if(reference&&payload.synthetic_reference!==true)continue;
    const rawObjectId=reference?payload.reference_id:payload.object_id??(Array.isArray(payload.object_ids)?payload.object_ids[0]:null);const id=String(rawObjectId??payload.generation_id??payload.reference_generation_id??event.eventId);if(!id)continue;
    outputs.set(mediaUrl,{id,documentId:String(payload.document_id??"replay-document"),canvasId:null,contextSetId:null,generationId:String(payload.generation_id??payload.reference_generation_id??id),modelId:String(payload.model_id??"gpt-image-2"),variant:outputs.size%4,latency:Number(payload.latency_ms??0),sequence:event.sequence,pinned:false,saved:true,discarded:false,library:true,contentRef:null,promptRef:null,promptTechnique:normalizePromptTechnique(payload.prompt_technique),promptFanId:payload.prompt_fan_id?String(payload.prompt_fan_id):null,provider:String(payload.provider??"openai"),mediaUrl,mediaType:String(payload.media_type??"image/jpeg"),width:Number(payload.image_width??816)||null,height:Number(payload.image_height??816)||null,plannerModelId:payload.planner_model_id?String(payload.planner_model_id):null,quality:payload.quality==="high"?"high":payload.quality==="medium"?"medium":"low",purpose:reference||preview?"ideate":"final",sourceEventId:event.eventId,sourceSurface:"replay-laboratory",promotionId:null,promotedFromId:payload.promoted_from_object_id?String(payload.promoted_from_object_id):null,promotedFromEventId:null,focalPoint:null,standalone:!payload.prompt_fan_id,standaloneSequence:payload.prompt_fan_id?null:event.sequence});
  }
  return[...outputs.values()].sort((left,right)=>left.sequence-right.sequence);
}
