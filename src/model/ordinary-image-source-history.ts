import type {CreativeEvent} from './events.ts';

// Used only by the canonical creative fold's optional authority observation.
// These receipts never mutate the creative projection or skip census rows.
export const personalSourceActor=(event:CreativeEvent)=>event.actor==='user'||event.actor==='user:'+event.streamId.slice('creative:'.length);
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const empty=(v:unknown)=>v===undefined||Array.isArray(v)&&v.length===0;
const nullish=(v:unknown)=>v===undefined||v===null;
const keys=(p:Record<string,unknown>,allowed:string,arrays:string[]=[],objects:string[]=[])=>Object.entries(p).every(([k,v])=>allowed.split(' ').includes(k)
 && (arrays.includes(k)?strings(v):objects.includes(k)?typeof v==='object'&&v!==null: v===null||['string','number','boolean'].includes(typeof v)));
const common='generation_id project_id document_id canvas_id context_set_id model_id planner_model_id quality purpose source_surface prompt_technique prompt_fan_id promotion_id reference_preview_event_id reference_input_count reference_inputs used_uploaded_reference_pixels used_ideation_preview_pixels image_format_block_id target_aspect_ratio target_width target_height target_unit provider_render_size size production_mode';
const plainRoute=(p:Record<string,unknown>)=>typeof p.generation_id==='string'&&!!p.generation_id
 && ['project_id','document_id'].every(k=>p[k]===undefined||typeof p[k]==='string'&&!!p[k])
 && ['canvas_id','context_set_id','prompt_fan_id','promotion_id','reference_preview_event_id'].every(k=>nullish(p[k]))
 && (p.production_mode===undefined||p.production_mode==='manual')&&(p.quality===undefined||p.quality==='high')&&(p.purpose===undefined||p.purpose==='final')
 && p.source_surface==='still'&&(p.reference_input_count===undefined||p.reference_input_count===0)&&empty(p.reference_inputs)
 && (p.used_uploaded_reference_pixels===undefined||p.used_uploaded_reference_pixels===false)&&(p.used_ideation_preview_pixels===undefined||p.used_ideation_preview_pixels===false);
type Origin={request:CreativeEvent;documentId:string;projectId:string;compile?:CreativeEvent;terminal?:CreativeEvent;budget?:CreativeEvent};
export function createOrdinaryImageSourceHistory(){
 const origins=new Map<string,Origin>();
 const same=(e:CreativeEvent,parent:CreativeEvent)=>e.streamId===parent.streamId&&e.correlationId===parent.correlationId&&e.causationId===parent.eventId;
 return {
  request(e:CreativeEvent,projectId:string,documentId:string){
   const p=e.payload,id=String(p.generation_id??'');
   const valid=!!id&&!origins.has(id)&&!!projectId&&!!documentId&&personalSourceActor(e)&&!e.causationId&&plainRoute(p)
    && (p.stream_id===undefined||p.stream_id===e.streamId)&&(p.requested_output===undefined||p.requested_output==='image')
    && keys(p,common+' stream_id model_ids document_version requested_output preflight_id preflight_version preflight_risk_acknowledged',['model_ids','reference_inputs']);
   if(valid)origins.set(id,{request:e,projectId,documentId});return valid;
  },
  compile(e:CreativeEvent,projectId:string,documentId:string){
   const p=e.payload,o=origins.get(String(p.generation_id??''));
   const valid=!!o&&!o.compile&&!o.terminal&&o.projectId===projectId&&o.documentId===documentId&&e.actor==='worker:compiler'&&same(e,o.request)&&plainRoute(p)
    && keys(p,common+' provider adapter_version adapter_selection_reason compiled_snapshot context_hash source_block_versions',['reference_inputs'],['compiled_snapshot','source_block_versions'])
    && Array.isArray(p.source_block_versions)&&p.source_block_versions.every(v=>{const r=record(v);return keys(r,'block_id version')&&typeof r.block_id==='string'&&Number.isSafeInteger(r.version);});
   if(valid)o!.compile=e;return valid;
  },
  terminal(e:CreativeEvent,projectId:string,documentId:string){
   const p=e.payload,o=origins.get(String(p.generation_id??'')),completed=e.type==='GenerationCompleted';
   const allowed=completed?'provider provider_request_id provider_submission_id planner_response_id provider_created_at object_id object_ids title image_width image_height promoted_from_generation_id promoted_from_object_id promotion_outcome context_hash planning_source planning_cache_hit latency_ms planning_latency_ms image_latency_ms adapter_version simulation output_ref prompt_ref content_expires_at media_url media_type source_content_hash'
    :'promotion_outcome prompt_ref prompt_expires_at pipeline_stage provider_moderation_stage generation_outcome error_class error_code error_category error_scope error_action error_message retryable retry_after_ms provider_request_id http_status safety_input_digest risk_categories contributing_block_ids contributing_reference_ids preflight_probe';
   const valid=!!o&&!!o.compile&&!o.terminal&&o.projectId===projectId&&o.documentId===documentId&&e.actor==='worker:generator'&&same(e,o.compile)&&plainRoute(p)
    && keys(p,common+' '+allowed,['reference_inputs','object_ids','risk_categories','contributing_block_ids','contributing_reference_ids'])
    && (completed?Array.isArray(p.object_ids)&&p.object_ids.length===1&&typeof p.object_ids[0]==='string'&&!!p.object_ids[0]&&(p.object_id===undefined||p.object_id===p.object_ids[0])
      && ['promoted_from_generation_id','promoted_from_object_id','promotion_outcome'].every(k=>nullish(p[k]))&&p.simulation!==true
      && (p.planning_source===undefined||p.planning_source==='provider')&&p.planning_cache_hit!==true
      : empty(p.contributing_reference_ids));
   if(valid)o!.terminal=e;return valid;
  },
  accounting(e:CreativeEvent){
   const p=e.payload,o=origins.get(String(p.generation_id??''));
   const parent=e.type==='BudgetReserved'?o?.request:o?.terminal;
   const allowed=e.type==='BudgetReserved'?'generation_id reservation_id cost_reservation_id reserved_tokens reserved_microusd period operation'
    :'generation_id document_id reservation_id cost_reservation_id input_tokens output_tokens total_tokens planner_tokens image_tokens planner_input_tokens planner_output_tokens image_text_input_tokens image_input_tokens image_output_tokens reserved_tokens reserved_microusd model_ids operation quality promotion_id image_cost_precision cost_microusd cost_precision cost_basis pricing_version image_pricing_version cost_breakdown_microusd';
   const valid=!!o&&!!parent&&e.actor==='worker:policy'&&same(e,parent)&&keys(p,allowed,['model_ids'],['cost_breakdown_microusd'])&&p.operation==='image-generation'
    && typeof p.generation_id==='string'&&typeof p.reservation_id==='string'&&!!p.reservation_id&&typeof p.cost_reservation_id==='string'&&!!p.cost_reservation_id
    && (p.document_id===undefined||p.document_id===o.documentId)&&nullish(p.promotion_id)
    && (p.cost_breakdown_microusd===undefined||keys(record(p.cost_breakdown_microusd),'text_input_microusd text_output_microusd image_text_input_microusd image_input_microusd image_output_microusd')&&Object.values(record(p.cost_breakdown_microusd)).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))
    && (e.type==='BudgetReserved'?!o.budget:o.terminal?.type==='GenerationCompleted'&&!!o.budget&&p.reservation_id===o.budget.payload.reservation_id&&p.cost_reservation_id===o.budget.payload.cost_reservation_id);
   if(valid&&e.type==='BudgetReserved')o!.budget=e;
   return {eligible:valid,projectId:o?.projectId??'',documentId:o?.documentId??''};
  },
  registry(e:CreativeEvent){
   const p=e.payload,allowed=e.type==='ModelRegistered'?'model_id planner_model_id provider status':e.type==='AdapterVersioned'?'adapter_id version contract_version selection_reason reference_handoff multiple_image_input block_level_reference_policy block_level_image_format streaming_previews':'model_id capabilities';
   return e.actor==='worker:registry'&&!e.causationId&&keys(p,allowed,['capabilities']);
  },
 };
}
