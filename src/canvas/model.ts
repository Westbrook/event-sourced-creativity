import * as Y from "yjs";
import type { CreativeEvent } from "../model/events";

export type CanvasHlc = { pt: number; c: number; site: string };
export type CanvasSourceKind = "block" | "document" | "output" | "reference" | "sketch";
export type CanvasView = "spatial" | "list" | "compare" | "folders";

export type ProjectCanvas = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  removed: boolean;
  createdSequence: number;
  sourceEvents: string[];
};

export type CanvasStroke = {
  id: string;
  points: number[];
  pressure: number[];
  color: string;
  width: number;
  bbox: { x: number; y: number; w: number; h: number };
  sourceEventId: string;
};

export type CanvasItem = {
  id: string;
  canvasId: string;
  projectId: string;
  sourceKind: CanvasSourceKind;
  sourceId: string;
  title: string;
  body: string;
  blockType: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  z: string;
  visible: boolean;
  removed: boolean;
  lockedBy: string | null;
  strokes: CanvasStroke[];
  sourceEvents: string[];
};

export type CanvasContextSet = {
  id: string;
  canvasId: string;
  projectId: string;
  name: string;
  itemIds: string[];
  blockIds: string[];
  documentIds: string[];
  outputIds: string[];
  asOfSequence: number;
  sourceEventId: string;
};

export type CanvasProposal = {
  id: string;
  canvasId: string;
  projectId: string;
  agent: string;
  title: string;
  summary: string;
  itemIds: string[];
  x: number;
  y: number;
  status: "open" | "accepted" | "rejected" | "restored";
  evidenceRefs: string[];
  sourceEvents: string[];
};

export type CanvasMembership = {
  id: string;
  canvasId: string;
  projectId: string;
  principalType: "user" | "team";
  principalRef: string;
  role: "viewer" | "commenter" | "editor" | "owner";
  sourceEvents: string[];
};

export type CanvasProjection = {
  projectId: string;
  selectedCanvasId: string;
  canvases: ProjectCanvas[];
  items: CanvasItem[];
  contextSets: CanvasContextSet[];
  proposals: CanvasProposal[];
  memberships: CanvasMembership[];
};

type RegisterValue = { value: unknown; hlc: CanvasHlc };
type TextInsert = { id: readonly [string, number]; left: readonly [string, number] | null; right: readonly [string, number] | null; chars: string };
type TextDelete = { target: readonly [string, number]; len: number };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tuple = (value: unknown): readonly [string, number] | null => Array.isArray(value) && value.length === 2 ? [String(value[0]), Number(value[1])] : null;
const opKey = (value: readonly [string, number]) => `${value[0]}:${String(value[1]).padStart(12, "0")}`;
const fallbackHlc = (event: CreativeEvent): CanvasHlc => ({ pt: Date.parse(event.occurredAt) || event.sequence, c: event.sequence, site: event.clientId });
const normalizeHlc = (value: unknown, event: CreativeEvent): CanvasHlc => { const input=record(value);return{pt:Number(input.pt??fallbackHlc(event).pt),c:Number(input.c??fallbackHlc(event).c),site:String(input.site??event.clientId)}; };
export const compareCanvasHlc = (left: CanvasHlc, right: CanvasHlc) => left.pt-right.pt || left.c-right.c || left.site.localeCompare(right.site);
const sourceKind = (value: unknown): CanvasSourceKind => ["block","document","output","reference","sketch"].includes(String(value)) ? String(value) as CanvasSourceKind : "block";
const numeric = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function foldCanvasText(events: CreativeEvent[], objectId: string, field = "value") {
  const inserts = new Map<string, TextInsert>(); const deletes: TextDelete[] = [];
  for (const event of events) {
    if (event.type !== "CanvasTextApplied") continue;
    const payload=event.payload;const operation=record(payload.operation);
    const object=record(operation.object);if(String(object.item_id??object.block_id??payload.item_id??"")!==objectId||String(operation.field??payload.field??"value")!==field)continue;
    for(const raw of Array.isArray(operation.ops)?operation.ops:[]){const op=record(raw);const ins=record(op.ins);const del=record(op.del);const id=tuple(ins.id);const target=tuple(del.target);if(id)inserts.set(opKey(id),{id,left:tuple(ins.left),right:tuple(ins.right),chars:String(ins.chars??"")});if(target)deletes.push({target,len:Math.max(0,Number(del.len??0))});}
  }
  const children=new Map<string,TextInsert[]>();for(const insert of inserts.values()){const parent=insert.left?opKey(insert.left):"root";children.set(parent,[...(children.get(parent)??[]),insert]);}
  for(const values of children.values())values.sort((a,b)=>opKey(a.id).localeCompare(opKey(b.id)));
  const ordered:TextInsert[]=[];const visit=(parent:string)=>{for(const child of children.get(parent)??[]){ordered.push(child);visit(opKey(child.id));}};visit("root");
  const deleted=new Map<string,number>();for(const removal of deletes)deleted.set(opKey(removal.target),Math.max(deleted.get(opKey(removal.target))??0,removal.len));
  const doc=new Y.Doc();const text=doc.getText(field);for(const insert of ordered){const count=deleted.get(opKey(insert.id))??0;text.insert(text.length,insert.chars.slice(Math.min(count,insert.chars.length)));}
  return text.toString();
}

export function canvasTextReplacementOperations(events: CreativeEvent[], objectId: string, nextValue: string, site: string, counter = Date.now()) {
  const deletes:Array<{del:{target:readonly[string,number];len:number}}>=[];
  for(const event of events){if(event.type!=="CanvasTextApplied")continue;const operation=record(event.payload.operation);const object=record(operation.object);if(String(object.item_id??object.block_id??event.payload.item_id??"")!==objectId)continue;for(const raw of Array.isArray(operation.ops)?operation.ops:[]){const ins=record(record(raw).ins);const id=tuple(ins.id);const length=String(ins.chars??"").length;if(id&&length)deletes.push({del:{target:id,len:length}});}}
  return[...deletes,{ins:{id:[site,counter] as const,left:null,right:null,chars:nextValue}}];
}

export function canvasProjectId(events: CreativeEvent[], canvasId: string) {
  for (let index=events.length-1;index>=0;index-=1){const event=events[index];if(event.type==="CanvasCreated"&&String(event.payload.canvas_id)===canvasId)return String(event.payload.project_id??"");}
  return "";
}

export function foldCanvasEvents(events: CreativeEvent[], selectedProjectId = "", selectedCanvasId = ""): CanvasProjection {
  const canvases=new Map<string,ProjectCanvas>();const items=new Map<string,CanvasItem>();const registers=new Map<string,Map<string,RegisterValue>>();
  const strokes=new Map<string,Map<string,CanvasStroke>>();const erasedStrokes=new Map<string,Set<string>>();const contextSets=new Map<string,CanvasContextSet>();const proposals=new Map<string,CanvasProposal>();const memberships=new Map<string,CanvasMembership>();
  let latestProjectId=selectedProjectId;
  const applyRegister=(event:CreativeEvent,itemId:string,prop:string,value:unknown,hlc:CanvasHlc)=>{const item=items.get(itemId);if(!item)return;const itemRegisters=registers.get(itemId)??new Map<string,RegisterValue>();const previous=itemRegisters.get(prop);if(previous&&compareCanvasHlc(previous.hlc,hlc)>=0)return;itemRegisters.set(prop,{value,hlc});registers.set(itemId,itemRegisters);if(prop==="x")item.x=numeric(value,item.x);else if(prop==="y")item.y=numeric(value,item.y);else if(prop==="w")item.w=Math.max(120,numeric(value,item.w));else if(prop==="h")item.h=Math.max(90,numeric(value,item.h));else if(prop==="rot")item.rot=numeric(value,item.rot);else if(prop==="z")item.z=String(value??item.z);else if(prop==="visible")item.visible=Boolean(value);item.sourceEvents.push(event.eventId);};
  for(const event of events){const p=event.payload;
    if(event.type==="ProjectCreated"&&!latestProjectId)latestProjectId=String(p.project_id??"");
    if(event.type==="CanvasCreated"){const id=String(p.canvas_id??"");if(!id)continue;const projectId=String(p.project_id??latestProjectId);canvases.set(id,{id,projectId,name:String(p.name??"Untitled canvas"),slug:String(p.slug??"canvas"),removed:false,createdSequence:event.sequence,sourceEvents:[event.eventId]});latestProjectId=projectId;continue;}
    if(event.type==="CanvasRenamed"){const canvas=canvases.get(String(p.canvas_id??""));if(canvas){canvas.name=String(p.new_name??canvas.name);canvas.slug=String(p.slug??canvas.slug);canvas.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="CanvasRemoved"||event.type==="CanvasRestored"){const canvas=canvases.get(String(p.canvas_id??""));if(canvas){canvas.removed=event.type==="CanvasRemoved";canvas.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="CanvasItemPlaced"||event.type==="CanvasReferenceCreated"){const id=String(p.item_id??p.reference_item_id??"");const canvasId=String(p.canvas_id??"");const canvas=canvases.get(canvasId);if(!id||!canvas)continue;const frame=record(p.frame);const kind=sourceKind(p.source_kind??(event.type==="CanvasReferenceCreated"?"reference":"block"));const sourceId=String(p.source_id??p.block_id??p.document_id??p.object_id??id);items.set(id,{id,canvasId,projectId:canvas.projectId,sourceKind:kind,sourceId,title:String(p.title??"Canvas item"),body:String(p.body??""),blockType:String(p.block_type??(kind==="sketch"?"sketch":"")),x:numeric(frame.x??p.x,80),y:numeric(frame.y??p.y,80),w:Math.max(120,numeric(frame.w??p.w,280)),h:Math.max(90,numeric(frame.h??p.h,200)),rot:numeric(frame.rot??p.rot,0),z:String(frame.z??p.z??`a${event.sequence}`),visible:p.visible!==false,removed:false,lockedBy:null,strokes:[],sourceEvents:[event.eventId]});continue;}
    if(event.type==="CanvasItemRemoved"||event.type==="CanvasItemRestored"){const item=items.get(String(p.item_id??""));if(item){item.removed=event.type==="CanvasItemRemoved";item.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="CanvasRegisterSet"){const operation=record(p.operation);const object=record(operation.object);applyRegister(event,String(object.item_id??p.item_id??""),String(operation.prop??p.prop??""),operation.value??p.value,normalizeHlc(operation.hlc??p.hlc,event));continue;}
    if(event.type==="CanvasLockAcquired"){const item=items.get(String(p.item_id??""));if(item&&!item.lockedBy){item.lockedBy=String(p.holder_id??event.actor);item.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="CanvasLockReleased"){const item=items.get(String(p.item_id??""));if(item&&item.lockedBy===String(p.holder_id??event.actor)){item.lockedBy=null;item.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="CanvasLockOverridden"){const item=items.get(String(p.item_id??""));if(item){item.lockedBy=null;item.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="StrokeAdded"){const operation=record(p.operation);const sketch=record(operation.sketch);const stroke=record(operation.stroke);const itemId=String(sketch.item_id??p.item_id??"");const idTuple=tuple(stroke.id);const strokeId=idTuple?opKey(idTuple):String(p.stroke_id??event.eventId);const erased=erasedStrokes.get(itemId)??new Set<string>();erasedStrokes.set(itemId,erased);if(!erased.has(strokeId)){const byId=strokes.get(itemId)??new Map<string,CanvasStroke>();const style=record(stroke.style);const bbox=record(stroke.bbox);byId.set(strokeId,{id:strokeId,points:(Array.isArray(stroke.points)?stroke.points:[]).map(Number),pressure:(Array.isArray(stroke.pressure)?stroke.pressure:[]).map(Number),color:String(style.color??"#171717"),width:numeric(style.width,3),bbox:{x:numeric(bbox.x,0),y:numeric(bbox.y,0),w:numeric(bbox.w,0),h:numeric(bbox.h,0)},sourceEventId:event.eventId});strokes.set(itemId,byId);}continue;}
    if(event.type==="StrokeErased"){const operation=record(p.operation);const sketch=record(operation.sketch);const itemId=String(sketch.item_id??p.item_id??"");const target=tuple(operation.target);const strokeId=target?opKey(target):String(p.stroke_id??"");const erased=erasedStrokes.get(itemId)??new Set<string>();erased.add(strokeId);erasedStrokes.set(itemId,erased);strokes.get(itemId)?.delete(strokeId);continue;}
    if(event.type==="ContextSetFormalized"){const id=String(p.context_set_id??"");const canvasId=String(p.canvas_id??"");const canvas=canvases.get(canvasId);if(!id||!canvas)continue;const itemIds=(Array.isArray(p.item_ids)?p.item_ids:[]).map(String);const selected=itemIds.map((itemId)=>items.get(itemId)).filter((item):item is CanvasItem=>Boolean(item));contextSets.set(id,{id,canvasId,projectId:canvas.projectId,name:String(p.name??`Context set ${contextSets.size+1}`),itemIds,blockIds:selected.filter((item)=>item.sourceKind==="block"||item.sourceKind==="reference"||item.sourceKind==="sketch").map((item)=>item.sourceId),documentIds:selected.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId),outputIds:selected.filter((item)=>item.sourceKind==="output").map((item)=>item.sourceId),asOfSequence:numeric(p.as_of_sequence,event.sequence),sourceEventId:event.eventId});continue;}
    if(event.type==="ProposalIssued"){const id=String(p.proposal_id??"");if(!id)continue;const target=record(p.target_location);proposals.set(id,{id,canvasId:String(p.canvas_id??""),projectId:String(p.project_id??latestProjectId),agent:String(p.agent??event.actor),title:String(p.title??"Arrangement proposal"),summary:String(p.summary??"A suggested way to organize this work."),itemIds:(Array.isArray(p.item_ids)?p.item_ids:[]).map(String),x:numeric(target.x,120),y:numeric(target.y,120),status:"open",evidenceRefs:(Array.isArray(p.evidence_refs)?p.evidence_refs:[]).map(String),sourceEvents:[event.eventId]});continue;}
    if(event.type==="ProposalAccepted"||event.type==="ProposalRejected"||event.type==="ProposalRestored"){const proposal=proposals.get(String(p.proposal_id??""));if(proposal){proposal.status=event.type==="ProposalAccepted"?"accepted":event.type==="ProposalRejected"?"rejected":"restored";proposal.sourceEvents.push(event.eventId);}continue;}
    if(event.type==="MembershipAdded"){const id=String(p.membership_id??"");if(id)memberships.set(id,{id,canvasId:String(p.canvas_id??""),projectId:String(p.project_id??latestProjectId),principalType:p.principal_type==="team"?"team":"user",principalRef:String(p.principal_ref??"Unknown member"),role:["viewer","commenter","editor","owner"].includes(String(p.role))?String(p.role) as CanvasMembership["role"]:"viewer",sourceEvents:[event.eventId]});continue;}
    if(event.type==="MembershipRemoved"){const membership=memberships.get(String(p.membership_id??""));if(membership){membership.sourceEvents.push(event.eventId);memberships.delete(membership.id);}continue;}
  }
  for(const item of items.values()){item.strokes=[...(strokes.get(item.id)?.values()??[])];const mergedText=foldCanvasText(events,item.id);if(mergedText)item.body=mergedText;}
  const requestedCanvas=selectedCanvasId?canvases.get(selectedCanvasId):undefined;const projectId=requestedCanvas?.projectId??selectedProjectId??latestProjectId;
  const visibleCanvases=[...canvases.values()].filter((canvas)=>!canvas.removed&&(!projectId||canvas.projectId===projectId)).sort((a,b)=>b.createdSequence-a.createdSequence);
  const selected=requestedCanvas&&!requestedCanvas.removed?requestedCanvas:visibleCanvases[0];
  return{projectId:selected?.projectId??projectId,selectedCanvasId:selected?.id??"",canvases:visibleCanvases,items:[...items.values()].filter((item)=>!item.removed&&item.canvasId===selected?.id&&item.visible).sort((a,b)=>a.z.localeCompare(b.z)),contextSets:[...contextSets.values()].filter((set)=>set.canvasId===selected?.id),proposals:[...proposals.values()].filter((proposal)=>proposal.projectId===(selected?.projectId??projectId)),memberships:[...memberships.values()].filter((membership)=>membership.projectId===(selected?.projectId??projectId)&&(!membership.canvasId||membership.canvasId===selected?.id))};
}

export function canvasItemAccessibleName(item: CanvasItem) {
  const type=item.blockType||item.sourceKind;return `${item.title || type}, ${type}, position ${Math.round(item.x)}, ${Math.round(item.y)}`;
}
