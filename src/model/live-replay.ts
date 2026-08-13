import type { BlockKind } from "./block-types.ts";
import type { CreativeEvent } from "./events.ts";
import { PROMPT_TECHNIQUES, type PromptTechnique } from "./prompt-structures.ts";
import { evaluateReplayCoverage } from "./replay-coverage.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "./scenarios.ts";

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

export type LiveReplayPlan = {
  title: string;
  summary: string;
  user_goal: string;
  project_name: string;
  document_title: string;
  reference: {
    label: string;
    description: string;
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

export type LiveReplayFanAsset = { technique: PromptTechnique; mediaUrl: string; generationId: string; objectId: string; latencyMs: number; model: string };
export type LiveReplayAssets = {
  referenceMediaUrl: string;
  previewMediaUrl: string;
  referenceGenerationId: string;
  previewGenerationId: string;
  fanOutputs: LiveReplayFanAsset[];
  plannerModel: string;
  imageModel: string;
  referenceLatencyMs: number;
  previewLatencyMs: number;
  createdAt: string;
};

const scopeFor=(block:LiveReplayBlock,index=0)=>{
  if(block.spatial_method==="document")return{schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"};
  if(block.spatial_method==="region")return{schema_version:1,kind:"region",coordinate_space:"document-normalized",region:block.applies_to==="document"?"foreground":block.applies_to,instruction:`the ${block.applies_to} portion of the composition`,feather:.14,falloff:"contextual",polarity:"inside"};
  if(block.spatial_method==="aabb")return{schema_version:1,kind:"aabb",coordinate_space:"document-normalized",aabb:{x:.08+(index%4)*.12,y:.12+(index%3)*.08,width:.34,height:.46},feather:.08,falloff:"soft",polarity:"inside"};
  if(block.spatial_method==="subject")return{schema_version:1,kind:"subject",coordinate_space:"document-normalized",subject_block_id:"live-block-subject",subject_relation:block.applies_to==="background"?"behind":"around",feather:.18,falloff:"contextual",polarity:"inside"};
  return{schema_version:1,kind:"path",coordinate_space:"document-normalized",path:[{x:.12,y:.14},{x:.74,y:.1},{x:.82,y:.74},{x:.18,y:.84}],feather:.06,falloff:"soft",polarity:block.intent==="avoid"||block.intent==="prohibit"?"outside":"inside"};
};

const effectFor=(intent:LiveReplayBlock["intent"])=>intent==="prohibit"?"must_not_include":intent==="avoid"?"deemphasize":intent==="prefer"?"prefer":"include";
const text=(value:unknown)=>String(value??"");

/**
 * The provider supplies creative data; this mapper retains authority, identity, and
 * causation rules so a model can never mint arbitrary event envelopes.
 */
export function buildLiveReplayEvents(plan:LiveReplayPlan,assets:LiveReplayAssets,sessionId:string):CreativeEvent[]{
  const source=buildComprehensiveScenario(`replay-session:${sessionId}`);const sourceStart=Date.parse(source[0]?.occurredAt??assets.createdAt);const actualStart=Date.parse(assets.createdAt);
  const blocksByType=new Map(plan.blocks.map((block)=>[block.type,block]));
  const fanByTechnique=new Map(assets.fanOutputs.map((output)=>[output.technique,output]));
  const preferred=fanByTechnique.get(plan.fan_review.preferred_technique)??assets.fanOutputs[0];
  if(!preferred||PROMPT_TECHNIQUES.some((technique)=>!fanByTechnique.has(technique)))throw new Error("live_replay_prompt_fan_assets_incomplete");
  const activeRelations=new Map<string,Record<string,unknown>>();for(const event of source){const id=text(event.payload.relation_id);if(!id)continue;if(event.type==="BlockRelationAdded")activeRelations.set(id,{relation_id:id,from_block_id:event.payload.from_block_id,to_block_id:event.payload.to_block_id,kind:event.payload.kind,properties:event.payload.properties});if(event.type==="BlockRelationRemoved")activeRelations.delete(id);}
  const fallbackBlock=plan.blocks[0]??{type:"direction" as BlockKind,subtype:"Creative intent",label:plan.title,instruction:plan.user_goal,intent:"include" as const,applies_to:"document" as const,spatial_method:"document" as const,weight:.8};
  let blockOrdinal=0;let chatOrdinal=0;let assistantOrdinal=0;
  return source.map((event,index)=>{
    const eventId=`live-${sessionId}-${index+1}`;const previousId=index?`live-${sessionId}-${index}`:null;const occurredAt=new Date(actualStart+Math.max(0,Date.parse(event.occurredAt)-sourceStart)).toISOString();
    let payload:Record<string,unknown>={...event.payload,mock_data_source:"openai-provider",replay_session_id:sessionId};
    if(event.type==="ProjectCreated")payload={...payload,name:plan.project_name,description:plan.summary};
    if(event.type==="ProjectRenamed")payload={...payload,new_name:plan.project_name,reason:"The LLM-populated interaction converged on the project’s working language."};
    if(event.type==="DocumentCreated"||event.type==="DocumentRenamed")payload={...payload,title:plan.document_title,new_title:plan.document_title,creative_goal:plan.user_goal};
    if(event.type==="IntentDeclared")payload={...payload,statement:plan.user_goal,statement_ref:`live-intent:${sessionId}`};
    if(event.type==="BlockCreated"){
      const existingType=text(payload.type) as BlockKind;const standalone=payload.scope==="library";const block=blocksByType.get(existingType)??plan.blocks[blockOrdinal%Math.max(1,plan.blocks.length)]??fallbackBlock;blockOrdinal+=1;
      payload={...payload,type:block.type,handle:`${block.type}/${block.label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"decision"}`,properties:{text:block.instruction,label:block.label,subtype:block.subtype,authority:"authored",weight:block.weight,intent:block.intent,effect:effectFor(block.intent),spatial_scope:scopeFor(block,blockOrdinal-1),...(standalone?{created_from:"library-block-editor",forked_from_block_id:`live-source-${sessionId}-${block.type}`}:{}) ,...(block.type==="reference"?{reference_id:`live-reference-${sessionId}`,media_url:assets.referenceMediaUrl,pixel_reference_mode:"context_only"}:{})}};
    }
    if(event.type==="ReferenceIngested")payload={...payload,reference_id:`live-reference-${sessionId}`,label:plan.reference.label,description:plan.reference.description,media_url:assets.referenceMediaUrl,content_ref:assets.referenceMediaUrl,media_type:"image/jpeg",synthetic_reference:true,reference_generation_id:assets.referenceGenerationId,latency_ms:assets.referenceLatencyMs};
    if(event.type==="RightsAsserted")payload={...payload,reference_id:`live-reference-${sessionId}`,rights_class:"synthetic-provider-fixture",scope:"generation-and-image-editing",assertion_method:"approved-provider-backed-replay"};
    if(event.type==="ExtractionCompleted")payload={...payload,overall_confidence:.86,requested_findings:["palette","mood","composition","material","lighting","spatial"],chips:[{property:"colors",value:plan.reference.palette,confidence:.9},{property:"reference_findings",value:[{kind:"mood",label:"Mood",value:plan.reference.mood,confidence:.86},{kind:"composition",label:"Composition",value:plan.reference.composition,confidence:.84},{kind:"material",label:"Materials",value:plan.reference.materials,confidence:.82},{kind:"lighting",label:"Lighting",value:plan.reference.lighting,confidence:.88},{kind:"spatial",label:"Spatial structure",value:plan.reference.spatial,confidence:.8}],confidence:.84}]};
    if(event.type==="ChatMessageSent"){const turn=plan.chat_turns[chatOrdinal%plan.chat_turns.length];payload={...payload,turn_id:`live-chat-turn:${sessionId}:${chatOrdinal+1}`,content_ref:`live-chat-user:${sessionId}:${chatOrdinal+1}`,mock_content:turn.user_message,live_preview:turn.live_preview,live_preview_requested:turn.live_preview,job_kind:"chat"};chatOrdinal+=1;}
    if(event.type==="AssistantReasoned"){const turn=plan.chat_turns[assistantOrdinal%plan.chat_turns.length];payload={...payload,turn_id:`live-chat-turn:${sessionId}:${assistantOrdinal+1}`,content_ref:`live-chat-assistant:${sessionId}:${assistantOrdinal+1}`,mock_content:turn.assistant_reply,resolved_change:turn.resolved_change,provider:"openai",model_id:assets.plannerModel,job_kind:event.payload.operation==="adaptive-structure"?"structure_adaptive":"chat",live_preview_requested:turn.live_preview,preview_suppressed:!turn.live_preview};assistantOrdinal+=1;}
    if(event.type==="MutationProposed")payload={...payload,summary:plan.chat_turns[0]?.resolved_change??plan.user_goal,content_ref:`live-mutation:${sessionId}`};
    if(event.type==="IdeationPreviewCompleted")payload={...payload,generation_id:assets.previewGenerationId,object_id:`draft-${sessionId}`,object_ids:[`draft-${sessionId}`],media_url:assets.previewMediaUrl,media_type:"image/jpeg",image_width:816,image_height:816,model_id:assets.imageModel,quality:"low",purpose:"ideate",size:"816x816",output_format:"jpeg",output_compression:70,planning_source:"provider",reference_input_count:1,reference_inputs:[{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_uploaded_reference_pixels:true,adapter_version:"openai-image-v4",latency_ms:assets.previewLatencyMs,simulation:false,title:plan.draft.title,rationale:plan.draft.rationale,scene:plan.draft.scene,palette:plan.draft.palette,next_moves:plan.draft.next_moves};
    if(event.type==="IdeationPromoted")payload={...payload,promotion_id:`promotion-${sessionId}`,draft_generation_id:assets.previewGenerationId,draft_object_id:`draft-${sessionId}`,full_generation_id:preferred.generationId,prompt_fan_id:`live-prompt-fan-${sessionId}`,intent_weight:1,system_success_pending:true};
    const technique=PROMPT_TECHNIQUES.includes(payload.prompt_technique as PromptTechnique)?payload.prompt_technique as PromptTechnique:null;const sourceFanId=text(payload.prompt_fan_id);const liveFanId=sourceFanId?`live-${sourceFanId}-${sessionId}`:`live-prompt-fan-${sessionId}`;const fanAsset=technique&&sourceFanId?fanByTechnique.get(technique):undefined;
    if(event.type==="GenerationRequested"&&event.actor==="user"&&fanAsset)payload={...payload,generation_id:fanAsset.generationId,requested_output:"image",model_ids:[assets.plannerModel,fanAsset.model],quality:"high",purpose:"final",job_kind:"generate",prompt_fan_id:liveFanId,reference_preview_event_id:`live-preview:${sessionId}`};
    if(event.type==="ContextCompiled"&&fanAsset)payload={...payload,generation_id:fanAsset.generationId,model_id:fanAsset.model,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v4",prompt_fan_id:liveFanId,reference_input_count:2,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,compiled_snapshot:{facts:plan.blocks.map((block,ordinal)=>({type:block.type,label:block.label,instruction:block.instruction,intent:block.intent,weight:block.weight,spatial_scope:scopeFor(block,ordinal)})),relationships:[...activeRelations.values()],reference:plan.reference,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],user_goal:plan.user_goal,standing_constraints:[plan.memory.preference],prompt_technique:technique,as_of:{replay_session_id:sessionId,complete:true}}};
    if(event.type==="GenerationCompleted"&&event.actor==="worker:generator"&&fanAsset)payload={...payload,generation_id:fanAsset.generationId,object_ids:[fanAsset.objectId],media_url:fanAsset.mediaUrl,media_type:"image/png",image_width:1536,image_height:1024,quality:"high",purpose:"final",model_id:fanAsset.model,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v4",prompt_fan_id:liveFanId,promoted_from_object_id:`draft-${sessionId}`,promotion_outcome:"completed",reference_input_count:2,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,latency_ms:fanAsset.latencyMs,simulation:false,title:`${plan.final.title} · ${technique}`,rationale:plan.fan_review.reasons[technique!],scene:plan.final.scene,palette:plan.final.palette,next_moves:plan.final.next_moves};
    if(event.type==="PromptFanOutputPromoted"){const promoted=plan.fan_review.promoted_techniques[0]??plan.fan_review.preferred_technique;const asset=fanByTechnique.get(promoted)!;payload={...payload,object_id:asset.objectId,prompt_fan_id:`live-${text(event.payload.prompt_fan_id)}-${sessionId}`,prompt_technique:promoted,reason:plan.fan_review.reasons[promoted]};}
    if(event.type==="PromptTechniquePreferred")payload={...payload,technique:plan.fan_review.preferred_technique,source_fan_id:`live-${text(event.payload.source_fan_id)}-${sessionId}`,source_output_id:preferred.objectId,comparison_note:plan.fan_review.comparison_note};
    if(event.type==="ObjectCritiqued")payload={...payload,object_id:preferred.objectId,axis_ref:plan.critique.axis,polarity:plan.critique.polarity,value:plan.critique.value,note:plan.critique.note};
    if(["ObjectViewed","ObjectSaved","ObjectPinned","ObjectUnpinned","ObjectRegenerated","AddedToLibrary","RemovedFromLibrary","ObjectDiscarded","ObjectExported","AnnotationAdded","AnnotationRetracted"].includes(event.type))payload={...payload,object_id:preferred.objectId};
    if(event.type==="ComparisonOpened")payload=event.payload.comparison_kind==="prompt_fan"?{...payload,comparison_kind:"prompt_fan",prompt_fan_id:liveFanId,object_ids:assets.fanOutputs.map((output)=>output.objectId),comparison_note:plan.fan_review.comparison_note}:{...payload,object_ids:[`draft-${sessionId}`,preferred.objectId]};
    if(event.type==="CollectionCreated"||event.type==="CollectionRenamed")payload={...payload,handle:plan.collection.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),new_handle:plan.collection.name,reason:plan.collection.reason};
    if(event.type==="PreferenceAuthored")payload={...payload,value:plan.memory.preference,source_claim_ref:`live-memory:${sessionId}`};
    if(event.type==="ConditionSet"||event.type==="Resurfaced")payload={...payload,condition:plan.memory.resurface_condition,condition_ref:`live-condition:${sessionId}`};
    if(event.type==="AttentionEpisodeObserved"&&text(payload.document_id)){payload={...payload,document_view:plan.friction.view,friction_hypothesis:plan.friction.stuck_moment,recovery_observed:plan.friction.recovery_action,outcome_weight:.08,authority:"supplemental-weak-signal"};}
    if(event.type==="BriefComposed")payload={...payload,recovery_context:{stuck_moment:plan.friction.stuck_moment,recovery_action:plan.friction.recovery_action,last_difficult_view:plan.friction.view}};
    return{...event,eventId,streamId:`replay-session:${sessionId}`,sequence:index+1,occurredAt,recordedAt:occurredAt,clientId:"web:replay-laboratory",correlationId:`live-replay:${sessionId}:${event.correlationId}`,causationId:previousId,payload};
  });
}

export function replayCoverage(events:CreativeEvent[]){
  return evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);
}
