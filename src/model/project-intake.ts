import type { EventInput } from "./events";
import { suggestedSubtype, type BlockKind } from "./block-types";

export type ProjectIntake = Readonly<{projectId:string;documentId:string;events:EventInput[]}>;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const only=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
const id=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
const text=(value:unknown,max:number)=>typeof value==="string"&&Boolean(value.trim())&&value===value.trim()&&value.length<=max;
export const projectIntakeReceiptPrefix=(projectId:string)=>"project-intake:v1:"+projectId+":";
export const projectIntakeReceiptKey=(projectId:string,index:number)=>projectIntakeReceiptPrefix(projectId)+index;

/** Exact current intake grammar, not a general event/batch permission. */
export function projectIntake(value:unknown):ProjectIntake|null{
  let inputs:unknown;try{inputs=JSON.parse(JSON.stringify(value));}catch{return null;}
  if(!Array.isArray(inputs)||inputs.length<3||inputs.length>11)return null;
  if(inputs.some(input=>!record(input)||!only(input,["type","payload","compensatesEventId"])||input.compensatesEventId!=null||!record(input.payload)))return null;
  const events=inputs as EventInput[],project=events[0]!,document=events[1]!,empty=events[2]!;
  const projectId=project.payload.project_id,documentId=document.payload.document_id;
  if(project.type!=="ProjectCreated"||document.type!=="DocumentCreated"||empty.type!=="EmptyCanvasChosen"||!id(projectId)||!id(documentId)||projectId===documentId
    ||!only(project.payload,["project_id","name","state","client_event_id"])||!text(project.payload.name,80)||project.payload.state!=="active"
    ||!only(document.payload,["project_id","document_id","handle","title","client_event_id"])||!text(document.payload.title,100)||!text(document.payload.handle,180)
    ||!only(empty.payload,["project_id","document_id","source_surface","client_event_id"])||empty.payload.source_surface!=="projects")return null;
  if(events.some((event,index)=>event.payload.project_id!==projectId||index>0&&event.payload.document_id!==documentId
    ||event.payload.client_event_id!==undefined&&event.payload.client_event_id!==projectIntakeReceiptKey(projectId,index)))return null;
  const kinds=["direction","audience","message","format","exclusion"],limits=[1200,240,13050,240,400],ids=new Set([projectId,documentId]);
  let previous=-1,index=3;
  for(;index<events.length&&events[index]!.type==="BlockCreated";index++){
    const payload=events[index]!.payload,properties=payload.properties;
    if(typeof payload.type!=="string")return null;
    const kind=kinds.indexOf(payload.type);
    if(kind<=previous||!id(payload.block_id)||ids.has(payload.block_id)||!record(properties)
      ||!only(payload,["project_id","document_id","block_id","type","handle","position","properties","client_event_id"])
      ||payload.handle!==String(payload.type)+"/project-brief-"+(index-2)||payload.position!=="z"+String(index-2).padStart(4,"0")
      ||!only(properties,["text","subtype","weight","authority","intent","exact_text","exact_placements","protected_phrases"])
      ||!text(properties.text,limits[kind]??0)||properties.subtype!==suggestedSubtype(payload.type as BlockKind)
      ||properties.weight!==.8||properties.authority!=="authored"
      ||(payload.type==="exclusion"?properties.intent!=="prohibit":properties.intent!==undefined))return null;
    const exact=properties.exact_text,placements=properties.exact_placements,phrases=properties.protected_phrases;
    if(exact!==undefined||placements!==undefined||phrases!==undefined){
      if(payload.type!=="message"||!text(exact,500)||JSON.stringify(placements)!==JSON.stringify(["opening","closing"])
        ||JSON.stringify(phrases)!==JSON.stringify([{text:exact,placement:"opening_and_closing"}])
        ||!String(properties.text).includes("Preserve this line exactly: "+exact))return null;
    }
    previous=kind;ids.add(payload.block_id);
  }
  if(index<events.length){
    if(events.length-index!==3)return null;
    const reference=events[index]!,rights=events[index+1]!,block=events[index+2]!,refId=reference.payload.reference_id,payload=block.payload,properties=payload.properties;
    if(reference.type!=="ReferenceIngested"||rights.type!=="RightsAsserted"||block.type!=="BlockCreated"
      ||!id(refId)||ids.has(refId)||!id(payload.block_id)||ids.has(payload.block_id)||payload.block_id===refId
      ||!only(reference.payload,["project_id","document_id","reference_id","source_type","source_kind","source_mime_type","media_type","source_ref","rights_class","client_event_id"])
      ||reference.payload.source_ref!=="authored-project-brief"||reference.payload.rights_class!=="asserted"
      ||!only(rights.payload,["project_id","document_id","reference_id","rights_class","assertion_method","client_event_id"])
      ||rights.payload.reference_id!==refId||rights.payload.rights_class!=="owned_or_licensed"||rights.payload.assertion_method!=="explicit-brief-confirmation"
      ||!only(payload,["project_id","document_id","block_id","type","handle","position","properties","client_event_id"])
      ||payload.type!=="reference"||payload.handle!=="reference/project-source"||payload.position!=="z"+String(index-2).padStart(4,"0")
      ||!record(properties)||!only(properties,["reference_id","label","text","source_type","source_kind","source_mime_type","media_type","source_citation","subtype","weight","authority","extraction_status"])
      ||properties.reference_id!==refId||properties.label!=="Project source excerpt"||!text(properties.text,5000)
      ||properties.source_citation!=="Pasted and explicitly licensed by the project creator"||properties.subtype!=="Mood"
      ||properties.weight!==.8||properties.authority!=="authored"||properties.extraction_status!=="ready")return null;
    for(const metadata of [reference.payload,properties])if(metadata.source_type!=="pasted-text"||metadata.source_kind!=="text"
      ||metadata.source_mime_type!=="text/plain"||metadata.media_type!=="text/plain")return null;
  }
  return{projectId,documentId,events:events.map((event,index)=>({...event,payload:{...event.payload,client_event_id:projectIntakeReceiptKey(projectId,index)}}))};
}

export function projectIntakeValue(value:unknown):string{
  if(Array.isArray(value))return"["+value.map(projectIntakeValue).join(",")+"]";
  if(record(value))return"{"+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>JSON.stringify(key)+":"+projectIntakeValue(item)).join(",")+"}";
  return JSON.stringify(value)??"null";
}
