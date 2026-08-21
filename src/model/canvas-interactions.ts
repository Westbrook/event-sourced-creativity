import type { CreativeEvent } from "./events.ts";

export const CANVAS_INTERACTION_CATEGORIES = ["navigation","selection","content","organization","generation","collaboration","assistant","history","review"] as const;
export type CanvasInteractionCategory = typeof CANVAS_INTERACTION_CATEGORIES[number];

export const CANVAS_INTERACTIONS = [
  ["board_created","Created a board","content"], ["board_opened","Opened a board","navigation"],
  ["board_renamed","Renamed a board","content"], ["board_removed","Removed a board","content"], ["board_restored","Restored a board","history"],
  ["focus_toggled","Changed Focus mode","navigation"], ["view_changed","Changed the board view","navigation"],
  ["filter_changed","Filtered the board","navigation"], ["sort_changed","Sorted the board","navigation"],
  ["zoom_changed","Changed board zoom","navigation"], ["board_fitted","Fit the board to the viewport","navigation"], ["board_panned","Panned the board","navigation"],
  ["item_selected","Selected board content","selection"], ["selection_cleared","Cleared a selection","selection"],
  ["batch_selection_toggled","Changed batch-select mode","selection"], ["batch_selection_completed","Batch-selected board content","selection"],
  ["item_moved","Moved board content","organization"], ["item_nudged","Nudged board content","organization"], ["item_resized","Resized board content","organization"], ["image_resized","Resized an image on the board","organization"],
  ["organization_menu_opened","Opened organization choices","organization"], ["organization_applied","Organized selected ideas","organization"],
  ["add_opened","Opened Add","content"], ["add_category_changed","Chose an Add category","content"], ["source_searched","Searched project context","content"],
  ["source_placed","Placed project content","content"], ["canvas_block_created","Created context on the board","content"],
  ["drawing_started","Started drawing","content"], ["stroke_added","Added a sketch stroke","content"], ["stroke_erased","Erased a sketch stroke","content"],
  ["item_edited","Edited shared context","content"], ["item_removed","Removed board content","content"], ["item_restored","Restored board content","history"],
  ["context_combined","Combined selected context","content"], ["document_prepare_opened","Opened document preparation","generation"], ["document_prepared","Created a document from the board","generation"],
  ["document_opened","Opened a document from the board","navigation"], ["document_outputs_opened","Opened every output from a document","review"], ["document_output_placed","Placed a document output on the board","content"], ["render_opened","Opened render choices","generation"], ["render_started","Started a render","generation"],
  ["comparison_opened","Compared selected images","review"], ["comparison_member_removed","Removed an image from comparison","review"],
  ["image_opened","Opened an image","review"], ["fan_image_navigated","Navigated a prompt fan","review"],
  ["intent_submitted","Submitted board intent","assistant"], ["suggestion_used","Used a suggested next move","assistant"], ["suggestion_dismissed","Dismissed suggestions","assistant"],
  ["reading_order_opened","Opened accessible reading order","navigation"], ["members_opened","Opened project members","collaboration"],
  ["member_added","Added a project member","collaboration"], ["member_removed","Removed a project member","collaboration"],
  ["proposal_accepted","Accepted an arrangement proposal","assistant"], ["proposal_rejected","Rejected an arrangement proposal","assistant"], ["proposal_restored","Restored an arrangement proposal","history"],
  ["undo_invoked","Used Undo","history"], ["redo_invoked","Used Redo","history"],
] as const satisfies readonly (readonly [string,string,CanvasInteractionCategory])[];

export type CanvasInteractionId = typeof CANVAS_INTERACTIONS[number][0];
export const CANVAS_INTERACTION_DEFINITIONS = new Map<CanvasInteractionId,{id:CanvasInteractionId;label:string;category:CanvasInteractionCategory}>(
  CANVAS_INTERACTIONS.map(([id,label,category])=>[id,{id,label,category}])
);
export const isCanvasInteractionId=(value:unknown):value is CanvasInteractionId=>CANVAS_INTERACTION_DEFINITIONS.has(String(value) as CanvasInteractionId);

const text=(value:unknown)=>String(value??"");
export function canvasInteractionIdsForEvent(event:Pick<CreativeEvent,"type"|"payload">):CanvasInteractionId[]{
  const p=event.payload;
  if(event.type==="CanvasInteractionRecorded"&&isCanvasInteractionId(p.interaction_id))return[p.interaction_id];
  if(event.type==="CanvasCreated")return["board_created"];
  if(event.type==="CanvasRenamed")return["board_renamed"];
  if(event.type==="CanvasRemoved")return["board_removed"];
  if(event.type==="CanvasRestored")return["board_restored"];
  if(event.type==="CanvasItemPlaced"||event.type==="CanvasReferenceCreated")return["source_placed"];
  if(event.type==="BlockCreated"&&p.scope==="canvas")return["canvas_block_created"];
  if(event.type==="CanvasTextApplied")return["item_edited"];
  if(event.type==="CanvasItemRemoved")return["item_removed"];
  if(event.type==="CanvasItemRestored")return["item_restored"];
  if(event.type==="CanvasArrangementCreated")return["organization_applied"];
  if(event.type==="StrokeAdded")return["stroke_added"];
  if(event.type==="StrokeErased")return["stroke_erased"];
  if(event.type==="CanvasRegisterSet"){
    const source=text(p.source_surface);
    if(source==="canvas-image-size-controls"||source==="canvas-image-resize-handles")return["image_resized"];
    if(source==="canvas-resize-handles")return p.resize_mode==="aspect-locked"?["image_resized"]:["item_resized"];
    if(source==="canvas-organize-menu")return["organization_applied"];
    if(source==="canvas-keyboard-nudge")return["item_nudged"];
    return["item_moved"];
  }
  if(event.type==="ContextSetFormalized")return["context_combined"];
  if(event.type==="DocumentCreated"&&p.created_from==="canvas-selection")return["document_prepared"];
  if(event.type==="GenerationRequested"&&p.source_surface==="canvas")return["render_started"];
  if(event.type==="DocumentRenderRequested"&&text(p.source_surface).startsWith("canvas"))return["render_started"];
  if(event.type==="DocumentArtifactViewed"&&text(p.source_surface).startsWith("canvas"))return["document_outputs_opened"];
  if(event.type==="ComparisonOpened"&&text(p.source_surface).startsWith("canvas"))return["comparison_opened"];
  if(event.type==="ObjectViewed"&&text(p.source_surface).startsWith("canvas"))return p.interaction==="navigate"?["fan_image_navigated"]:["image_opened"];
  if(event.type==="MembershipAdded")return["member_added"];
  if(event.type==="MembershipRemoved")return["member_removed"];
  if(event.type==="ProposalAccepted")return["proposal_accepted"];
  if(event.type==="ProposalRejected")return["proposal_rejected"];
  if(event.type==="ProposalRestored")return["proposal_restored"];
  return[];
}

export function canvasInteractionAnalytics(events:CreativeEvent[]){
  const counts=new Map<CanvasInteractionId,number>();const seenActions=new Set<string>();
  for(const event of events){if(event.actor!=="user")continue;for(const id of canvasInteractionIdsForEvent(event)){const action=String(event.payload.organization_action_id??event.payload.presentation_action_id??event.payload.history_action_id??event.eventId);const key=`${id}:${action}`;if(seenActions.has(key))continue;seenActions.add(key);counts.set(id,(counts.get(id)??0)+1);}}
  const byInteraction=CANVAS_INTERACTIONS.map(([id,label,category])=>({id,label,category,count:counts.get(id)??0})).filter((row)=>row.count).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const byCategory=CANVAS_INTERACTION_CATEGORIES.map((id)=>({id,label:id[0].toUpperCase()+id.slice(1),count:byInteraction.filter((row)=>row.category===id).reduce((sum,row)=>sum+row.count,0)})).filter((row)=>row.count).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  return{total:byInteraction.reduce((sum,row)=>sum+row.count,0),covered:byInteraction.length,available:CANVAS_INTERACTIONS.length,byInteraction,byCategory};
}
