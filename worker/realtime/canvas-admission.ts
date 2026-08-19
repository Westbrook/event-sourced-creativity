type CanvasEventInput={type?:string;payload?:Record<string,unknown>};

export const CANVAS_USER_EVENT_TYPES=[
  "CanvasCreated","CanvasRenamed","CanvasRemoved","CanvasRestored","CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored","CanvasRegisterSet","CanvasTextApplied","CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized","ProposalAccepted","ProposalRejected","ProposalRestored","VoteCast","MembershipAdded","MembershipRemoved","BlockRehomed",
] as const;

export const CANVAS_COMMUTATIVE_EVENT_TYPES=["CanvasRegisterSet","CanvasTextApplied","StrokeAdded","StrokeErased","CanvasLockReleased","VoteCast"] as const;
const id=(value:unknown)=>typeof value==="string"&&/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const hlc=(value:unknown)=>{const input=object(value);return Number.isFinite(Number(input.pt))&&Number.isFinite(Number(input.c))&&id(input.site);};

/** Rejects raw presence data and admits only the compact, replayable operation grammar. */
export function validateCanvasEvent(item:CanvasEventInput){
  const type=String(item.type??"");const payload=item.payload??{};
  if(!CANVAS_USER_EVENT_TYPES.includes(type as typeof CANVAS_USER_EVENT_TYPES[number]))return null;
  if(Object.keys(payload).some((key)=>/cursor_trail|pointer_path|raw_pointer|raw_keys|raw_input/i.test(key)))return"ephemeral_presence_must_not_be_persisted";
  if(type==="CanvasCreated"&&(!id(payload.canvas_id)||!id(payload.project_id)||!String(payload.name??"").trim()))return"canvas_project_and_name_required";
  if(type.startsWith("Canvas")&&type!=="CanvasCreated"&&!id(payload.canvas_id))return"canvas_id_required";
  if(["CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored","CanvasLockAcquired","CanvasLockReleased"].includes(type)&&!id(payload.item_id??payload.reference_item_id))return"canvas_item_id_required";
  if(type==="CanvasItemPlaced"&&(!id(payload.source_id)||!["block","document","output","reference","sketch"].includes(String(payload.source_kind))))return"canvas_source_required";
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
