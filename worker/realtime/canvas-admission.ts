import { CANVAS_INTERACTION_DEFINITIONS, isCanvasInteractionId } from "../../src/model/canvas-interactions.ts";

type CanvasEventInput={type?:string;payload?:Record<string,unknown>};

export const CANVAS_USER_EVENT_TYPES=[
  "CanvasCreated","CanvasRenamed","CanvasRemoved","CanvasRestored","CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored","CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored","CanvasRegisterSet","CanvasTextApplied","CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized","CanvasInteractionRecorded","ProposalAccepted","ProposalRejected","ProposalRestored","VoteCast","MembershipAdded","MembershipRemoved","BlockRehomed",
] as const;

export const CANVAS_COMMUTATIVE_EVENT_TYPES=["CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored","CanvasRegisterSet","CanvasTextApplied","StrokeAdded","StrokeErased","CanvasLockReleased","VoteCast"] as const;
const id=(value:unknown)=>typeof value==="string"&&/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const hlc=(value:unknown)=>{const input=object(value);return Number.isFinite(Number(input.pt))&&Number.isFinite(Number(input.c))&&id(input.site);};

/** Rejects raw presence data and admits only the compact, replayable operation grammar. */
export function validateCanvasEvent(item:CanvasEventInput){
  const type=String(item.type??"");const payload=item.payload??{};
  if(!CANVAS_USER_EVENT_TYPES.includes(type as typeof CANVAS_USER_EVENT_TYPES[number]))return null;
  if(Object.keys(payload).some((key)=>/cursor_trail|pointer_path|raw_pointer|raw_keys|raw_input/i.test(key)))return"ephemeral_presence_must_not_be_persisted";
  if(type==="CanvasCreated"&&(!id(payload.canvas_id)||!id(payload.project_id)||!String(payload.name??"").trim()))return"canvas_project_and_name_required";
  if(type.startsWith("Canvas")&&!['CanvasCreated','CanvasInteractionRecorded'].includes(type)&&!id(payload.canvas_id))return"canvas_id_required";
  if(type==="CanvasInteractionRecorded"){
    if(!id(payload.project_id)||!isCanvasInteractionId(payload.interaction_id))return"invalid_canvas_interaction";
    if(payload.category!==CANVAS_INTERACTION_DEFINITIONS.get(payload.interaction_id)?.category)return"invalid_canvas_interaction_category";
  }
  if(["CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored","CanvasLockAcquired","CanvasLockReleased"].includes(type)&&!id(payload.item_id??payload.reference_item_id))return"canvas_item_id_required";
  if(type==="CanvasLockAcquired"&&(!id(payload.holder_id)||!Number.isFinite(Number(payload.lease_ms))||Number(payload.lease_ms)<1_000||Number(payload.lease_ms)>60_000))return"invalid_canvas_lock_lease";
  if(type==="CanvasLockReleased"&&!id(payload.holder_id))return"invalid_canvas_lock_holder";
  if(type==="CanvasItemPlaced"&&(!id(payload.source_id)||!["block","document","output","artifact","reference","sketch","context"].includes(String(payload.source_kind))))return"canvas_source_required";
  if(type==="CanvasArrangementCreated"){
    const itemIds=Array.isArray(payload.item_ids)?payload.item_ids:[],frames=Array.isArray(payload.frames)?payload.frames:[],previousFrames=Array.isArray(payload.previous_frames)?payload.previous_frames:[];
    if(!id(payload.arrangement_id)||itemIds.length<2||itemIds.length>500||itemIds.some((value)=>!id(value))||!["grid","row","column","type","match-size"].includes(String(payload.kind))||frames.length!==itemIds.length||previousFrames.length!==itemIds.length)return"invalid_canvas_arrangement";
    for(const value of [...frames,...previousFrames]){const frame=object(value);if(!id(frame.item_id)||![frame.x,frame.y,frame.w,frame.h].every((part)=>Number.isFinite(Number(part)))||Number(frame.w)<=0||Number(frame.h)<=0)return"invalid_canvas_arrangement_frame";}
    if(payload.kind==="match-size"&&(!["minimum","average","maximum"].includes(String(payload.size_modifier))||!Number.isFinite(Number(payload.target_width))||!Number.isFinite(Number(payload.target_height))))return"invalid_canvas_match_size_arrangement";
  }
  if(["CanvasArrangementRemoved","CanvasArrangementRestored"].includes(type)&&!id(payload.arrangement_id))return"canvas_arrangement_id_required";
  if(type==="CanvasRegisterSet"){const operation=object(payload.operation);const target=object(operation.object);if(!id(target.item_id)||!["x","y","w","h","rot","z","visible"].includes(String(operation.prop))||!hlc(operation.hlc))return"invalid_canvas_register_operation";}
  if(type==="CanvasTextApplied"){const operation=object(payload.operation);if(!Array.isArray(operation.ops)||operation.ops.length>4000)return"invalid_canvas_text_operation";}
  if(type==="StrokeAdded"){const operation=object(payload.operation);const stroke=object(operation.stroke);if(!Array.isArray(stroke.points)||stroke.points.length<4||stroke.points.length>4000||stroke.points.some((value)=>!Number.isFinite(Number(value))))return"invalid_canvas_stroke";}
  if(type==="StrokeErased"&&!object(payload.operation).target&&!id(payload.stroke_id))return"stroke_target_required";
  if(type==="ContextSetFormalized"&&(!id(payload.context_set_id)||!Array.isArray(payload.item_ids)||payload.item_ids.length<1||payload.item_ids.length>500))return"formalized_context_items_required";
  if(["ProposalAccepted","ProposalRejected","ProposalRestored"].includes(type)&&!id(payload.proposal_id))return"proposal_id_required";
  if(type==="MembershipAdded"&&(!id(payload.membership_id)||!id(payload.canvas_id)||!id(payload.project_id)||!["user","team"].includes(String(payload.principal_type))||!["viewer","commenter","editor","owner"].includes(String(payload.role))))return"invalid_canvas_membership";
  if(type==="MembershipRemoved"&&(!id(payload.membership_id)||!id(payload.canvas_id)||!id(payload.project_id)))return"invalid_canvas_membership_removal";
  if(type==="BlockRehomed"&&(!id(payload.block_id)||!id(payload.project_id)||!id(payload.from_project_id)))return"invalid_block_rehome";
  return null;
}
