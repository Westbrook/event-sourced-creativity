import { BLOCK_TYPES, type BlockKind } from "./block-types.ts";
import type { CreativeEvent } from "./events.ts";
import { buildComprehensiveScenario } from "./scenarios.ts";

export type LiveReplayBlock = {
  type: BlockKind;
  subtype: string;
  label: string;
  instruction: string;
  intent: "include" | "prefer" | "avoid" | "prohibit";
  applies_to: "document" | "left" | "right" | "top" | "bottom" | "foreground" | "background";
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
  chat: { user_message: string; assistant_reply: string; resolved_change: string };
  blocks: LiveReplayBlock[];
  draft: { title: string; rationale: string; scene: string; palette: string[]; next_moves: string[] };
  final: { title: string; rationale: string; scene: string; palette: string[]; next_moves: string[] };
  critique: { axis: string; polarity: "positive" | "negative"; value: string; note: string };
  collection: { name: string; reason: string };
  memory: { preference: string; resurface_condition: string };
};

export type LiveReplayAssets = {
  referenceMediaUrl: string;
  previewMediaUrl: string;
  finalMediaUrl: string;
  referenceGenerationId: string;
  previewGenerationId: string;
  finalGenerationId: string;
  plannerModel: string;
  imageModel: string;
  referenceLatencyMs: number;
  previewLatencyMs: number;
  finalLatencyMs: number;
  createdAt: string;
};

const scopeFor=(target:LiveReplayBlock["applies_to"])=>target==="document"
  ? {schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"}
  : {schema_version:1,kind:"region",coordinate_space:"document-normalized",region:target,instruction:`the ${target} portion of the composition`,feather:.14,falloff:"contextual",polarity:"inside"};

const effectFor=(intent:LiveReplayBlock["intent"])=>intent==="prohibit"?"must_not_include":intent==="avoid"?"deemphasize":intent==="prefer"?"prefer":"include";
const text=(value:unknown)=>String(value??"");

/**
 * The provider supplies creative data; this mapper retains authority, identity, and
 * causation rules so a model can never mint arbitrary event envelopes.
 */
export function buildLiveReplayEvents(plan:LiveReplayPlan,assets:LiveReplayAssets,sessionId:string):CreativeEvent[]{
  const source=buildComprehensiveScenario(`replay-session:${sessionId}`);const sourceStart=Date.parse(source[0]?.occurredAt??assets.createdAt);const actualStart=Date.parse(assets.createdAt);
  const blocksByType=new Map(plan.blocks.map((block)=>[block.type,block]));
  const fallbackBlock=plan.blocks[0]??{type:"direction" as BlockKind,subtype:"Creative intent",label:plan.title,instruction:plan.user_goal,intent:"include" as const,applies_to:"document" as const,weight:.8};
  let blockOrdinal=0;
  return source.map((event,index)=>{
    const eventId=`live-${sessionId}-${index+1}`;const previousId=index?`live-${sessionId}-${index}`:null;const occurredAt=new Date(actualStart+Math.max(0,Date.parse(event.occurredAt)-sourceStart)).toISOString();
    let payload:Record<string,unknown>={...event.payload,mock_data_source:"openai-provider",replay_session_id:sessionId};
    if(event.type==="ProjectCreated")payload={...payload,name:plan.project_name,description:plan.summary};
    if(event.type==="ProjectRenamed")payload={...payload,new_name:plan.project_name,reason:"The LLM-populated interaction converged on the project’s working language."};
    if(event.type==="DocumentCreated"||event.type==="DocumentRenamed")payload={...payload,title:plan.document_title,new_title:plan.document_title,creative_goal:plan.user_goal};
    if(event.type==="IntentDeclared")payload={...payload,statement:plan.user_goal,statement_ref:`live-intent:${sessionId}`};
    if(event.type==="BlockCreated"){
      const existingType=text(payload.type) as BlockKind;const block=blocksByType.get(existingType)??plan.blocks[blockOrdinal%Math.max(1,plan.blocks.length)]??fallbackBlock;blockOrdinal+=1;
      payload={...payload,type:block.type,handle:`${block.type}/${block.label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"decision"}`,properties:{text:block.instruction,label:block.label,subtype:block.subtype,authority:"authored",weight:block.weight,intent:block.intent,effect:effectFor(block.intent),spatial_scope:scopeFor(block.applies_to),...(block.type==="reference"?{reference_id:`live-reference-${sessionId}`,media_url:assets.referenceMediaUrl,pixel_reference_mode:"context_only"}:{})}};
    }
    if(event.type==="ReferenceIngested")payload={...payload,reference_id:`live-reference-${sessionId}`,label:plan.reference.label,description:plan.reference.description,media_url:assets.referenceMediaUrl,content_ref:assets.referenceMediaUrl,media_type:"image/jpeg",synthetic_reference:true,reference_generation_id:assets.referenceGenerationId,latency_ms:assets.referenceLatencyMs};
    if(event.type==="RightsAsserted")payload={...payload,reference_id:`live-reference-${sessionId}`,rights_class:"synthetic-provider-fixture",scope:"generation-and-image-editing",assertion_method:"approved-provider-backed-replay"};
    if(event.type==="ExtractionCompleted")payload={...payload,overall_confidence:.86,requested_findings:["palette","mood","composition","material","lighting","spatial"],chips:[{property:"colors",value:plan.reference.palette,confidence:.9},{property:"reference_findings",value:[{kind:"mood",label:"Mood",value:plan.reference.mood,confidence:.86},{kind:"composition",label:"Composition",value:plan.reference.composition,confidence:.84},{kind:"material",label:"Materials",value:plan.reference.materials,confidence:.82},{kind:"lighting",label:"Lighting",value:plan.reference.lighting,confidence:.88},{kind:"spatial",label:"Spatial structure",value:plan.reference.spatial,confidence:.8}],confidence:.84}]};
    if(event.type==="ChatMessageSent")payload={...payload,content_ref:`live-chat-user:${sessionId}`,mock_content:plan.chat.user_message};
    if(event.type==="AssistantReasoned")payload={...payload,content_ref:`live-chat-assistant:${sessionId}`,mock_content:plan.chat.assistant_reply,resolved_change:plan.chat.resolved_change,provider:"openai",model_id:assets.plannerModel};
    if(event.type==="MutationProposed")payload={...payload,summary:plan.chat.resolved_change,content_ref:`live-mutation:${sessionId}`};
    if(event.type==="IdeationPreviewCompleted")payload={...payload,generation_id:assets.previewGenerationId,object_id:`draft-${sessionId}`,object_ids:[`draft-${sessionId}`],media_url:assets.previewMediaUrl,media_type:"image/jpeg",image_width:816,image_height:816,model_id:assets.imageModel,quality:"low",purpose:"ideate",size:"816x816",output_format:"jpeg",output_compression:70,planning_source:"provider",reference_input_count:1,reference_inputs:[{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_uploaded_reference_pixels:true,adapter_version:"openai-image-v4",latency_ms:assets.previewLatencyMs,simulation:false,title:plan.draft.title,rationale:plan.draft.rationale,scene:plan.draft.scene,palette:plan.draft.palette,next_moves:plan.draft.next_moves};
    if(event.type==="IdeationPromoted")payload={...payload,promotion_id:`promotion-${sessionId}`,draft_generation_id:assets.previewGenerationId,draft_object_id:`draft-${sessionId}`,full_generation_id:assets.finalGenerationId,intent_weight:1,system_success_pending:true};
    if(event.type==="GenerationRequested"&&event.actor==="user")payload={...payload,generation_id:assets.finalGenerationId,requested_output:"image",model_ids:[assets.plannerModel,assets.imageModel],quality:"high",purpose:"final",promotion_id:`promotion-${sessionId}`,reference_preview_event_id:`live-preview:${sessionId}`};
    if(event.type==="ContextCompiled")payload={...payload,generation_id:assets.finalGenerationId,model_id:assets.imageModel,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v4",reference_input_count:2,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,compiled_snapshot:{facts:plan.blocks.map((block)=>({type:block.type,label:block.label,instruction:block.instruction,intent:block.intent,weight:block.weight,spatial_scope:scopeFor(block.applies_to)})),reference:plan.reference,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],user_goal:plan.user_goal,standing_constraints:[plan.memory.preference],as_of:{replay_session_id:sessionId,complete:true}}};
    if(event.type==="GenerationCompleted"&&event.actor==="worker:generator")payload={...payload,generation_id:assets.finalGenerationId,object_ids:[`final-${sessionId}`],media_url:assets.finalMediaUrl,media_type:"image/png",image_width:1536,image_height:1024,quality:"high",purpose:"final",model_id:assets.imageModel,planner_model_id:assets.plannerModel,adapter_version:"openai-image-v4",promotion_id:`promotion-${sessionId}`,promoted_from_object_id:`draft-${sessionId}`,promotion_outcome:"completed",reference_input_count:2,reference_inputs:[{source:"ideation-preview",mode:null},{source:"uploaded-reference",reference_id:`live-reference-${sessionId}`,label:plan.reference.label,mode:"inspiration"}],used_ideation_preview_pixels:true,used_uploaded_reference_pixels:true,latency_ms:assets.finalLatencyMs,simulation:false,title:plan.final.title,rationale:plan.final.rationale,scene:plan.final.scene,palette:plan.final.palette,next_moves:plan.final.next_moves};
    if(event.type==="ObjectCritiqued")payload={...payload,object_id:`final-${sessionId}`,axis_ref:plan.critique.axis,polarity:plan.critique.polarity,value:plan.critique.value,note:plan.critique.note};
    if(["ObjectViewed","ObjectSaved","ObjectPinned","ObjectUnpinned","ObjectRegenerated","AddedToLibrary","RemovedFromLibrary","ObjectDiscarded","ObjectExported","AnnotationAdded","AnnotationRetracted","ComparisonOpened"].includes(event.type))payload={...payload,object_id:`final-${sessionId}`,...(event.type==="ComparisonOpened"?{object_ids:[`draft-${sessionId}`,`final-${sessionId}`]}:{})};
    if(event.type==="CollectionCreated"||event.type==="CollectionRenamed")payload={...payload,handle:plan.collection.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),new_handle:plan.collection.name,reason:plan.collection.reason};
    if(event.type==="PreferenceAuthored")payload={...payload,value:plan.memory.preference,source_claim_ref:`live-memory:${sessionId}`};
    if(event.type==="ConditionSet"||event.type==="Resurfaced")payload={...payload,condition:plan.memory.resurface_condition,condition_ref:`live-condition:${sessionId}`};
    return{...event,eventId,streamId:`replay-session:${sessionId}`,sequence:index+1,occurredAt,recordedAt:occurredAt,clientId:"web:replay-laboratory",correlationId:`live-replay:${sessionId}:${event.correlationId}`,causationId:previousId,payload};
  });
}

export function replayCoverage(events:CreativeEvent[]){
  const types=new Set(events.map((event)=>event.type));const blockTypes=new Set(events.filter((event)=>event.type==="BlockCreated").map((event)=>text(event.payload.type)));
  return{eventTypes:types.size,blockTypes:blockTypes.size,allEventTypes:types,allBlockTypes:BLOCK_TYPES.every((definition)=>blockTypes.has(definition.type))};
}
