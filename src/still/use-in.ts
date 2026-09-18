import { foldEvents, type CreativeEvent, type EventInput } from '../model/events.ts';
import { combinedContextMemberships, combinedContextRoleForBlockType, isContextCompositionRelation, normalizeActionBlockReferences, validateContextCompositionGraph } from '../model/combined-context.ts';
import { copyOutputRequirementBlock } from '../model/output-requirement-copy.ts';
import { editableIdea } from './composition.ts';
import type { Position } from './decisions.ts';

export type Destination={id:string;projectId:string;documentId:string;blockId:string;label:string;project:string;document:string;kind:string};
export function destinationsFor(events:CreativeEvent[],position:Pick<Position,'projectId'|'documentId'|'blockId'>):Destination[]{
  const projects=foldEvents(events).projects,items:Destination[]=[];
  for(const project of projects){
    const p=foldEvents(events,Infinity,'',project.id);
    const blockedTargets=new Set([position.blockId]);
    const descendants=new Map<string,string[]>();for(const relation of p.libraryBlockRelations)if(!relation.removed&&isContextCompositionRelation(relation.kind)){if(!descendants.has(relation.fromBlockId))descendants.set(relation.fromBlockId,[]);descendants.get(relation.fromBlockId)!.push(relation.toBlockId);}
    for(const id of blockedTargets)for(const child of descendants.get(id)??[])blockedTargets.add(child);
    for(const relation of p.libraryBlockRelations)if(!relation.removed&&isContextCompositionRelation(relation.kind)&&relation.toBlockId===position.blockId)blockedTargets.add(relation.fromBlockId);
    const blocksByDocument=new Map<string,typeof p.libraryBlocks>();for(const b of p.libraryBlocks){if(!blocksByDocument.has(b.documentId))blocksByDocument.set(b.documentId,[]);blocksByDocument.get(b.documentId)!.push(b);}
    for(const d of p.documents.filter(d=>!d.removed&&d.projectId===project.id)){
      if(d.id!==position.documentId)items.push({id:`document:${d.id}`,projectId:project.id,documentId:d.id,blockId:'',label:d.title,project:project.name,document:d.title,kind:'document'});
      for(const b of (blocksByDocument.get(d.id)??[]).filter(b=>!blockedTargets.has(b.id)&&editableIdea(b))){
        items.push({id:`block:${b.id}`,projectId:project.id,documentId:d.id,blockId:b.id,label:String(b.properties.label||b.handle),project:project.name,document:d.title,kind:b.type==='subject'?'character / subject':b.properties.context_group||b.type==='composition'?'composition':b.type});
      }
    }
  }
  return items;
}

export type UseInPlan={events:EventInput[];sourceId:string;destination:Destination;rootId:string;copies:{id:string;label:string;text:string}[];mode:'link'|'copy'};
// Plan only: the caller retains these exact IDs through preview and receipt recovery.
// The native append transaction remains the authority for scope, graph and stream-head validation.
export function useInPlan(events:CreativeEvent[],position:Position,sourceId:string,destinationId:string,createId:()=>string=()=>crypto.randomUUID()):UseInPlan{
  const sourceProjection=foldEvents(events,Infinity,position.documentId,position.projectId);
  const source=sourceProjection.blocks.find(b=>b.id===sourceId);
  if(!editableIdea(source))throw new Error('Choose an editable idea.');
  const destination=destinationsFor(events,{...position,blockId:sourceId}).find(d=>d.id===destinationId);
  if(!destination)throw new Error('Destination unavailable.');
  const p=foldEvents(events,Infinity,destination.documentId,destination.projectId);
  const target=destination.blockId?p.blocks.find(b=>b.id===destination.blockId):undefined;
  if(destination.blockId&&!editableIdea(target))throw new Error('Destination is not editable.');
  const scope={project_id:destination.projectId,document_id:destination.documentId,scope:'document'};
  const changes:EventInput[]=[],relations:EventInput[]=[],deferred:EventInput[]=[],copies:UseInPlan['copies']=[];
  const live=sourceProjection.libraryBlockRelations.filter(r=>!r.removed);
  const copied=new Map<string,string>();
  let rootId=source.id;
  if(source.documentId!==destination.documentId){
    const available=new Map(sourceProjection.libraryBlocks.filter(b=>!b.removed).map(b=>[b.id,b]));
    const pending=[source.id];
    for(const id of pending){
      if(copied.has(id))continue;
      const b=available.get(id);
      // Reject the whole transfer rather than silently dropping protected dependencies.
      if(!editableIdea(b))throw new Error('A related idea cannot be copied. Review it in Forma.');
      copied.set(id,createId());if(copied.size>100)throw new Error('Choose a smaller group.');
      for(const r of live)if(r.fromBlockId===id)pending.push(r.toBlockId);
      for(const reference of normalizeActionBlockReferences(b.properties.block_references))pending.push(reference.block_id);
      if(typeof b.properties.context_set_root_id==='string'&&b.properties.context_set_root_id)pending.push(b.properties.context_set_root_id);
      const groups=new Set(combinedContextMemberships(b.properties).map(m=>m.contextSetId));
      if(groups.size)for(const other of available.values())if(combinedContextMemberships(other.properties).some(m=>groups.has(m.contextSetId)))pending.push(other.id);
    }
    const groupIds=new Map<string,string>();
    const groupId=(v:unknown)=>{if(typeof v!=='string'||!v)return v;if(!groupIds.has(v))groupIds.set(v,createId());return groupIds.get(v);};
    const membership=(v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))return v;const m=v as Record<string,unknown>;return {...m,...(m.contextSetId?{contextSetId:groupId(m.contextSetId)}:{}),...(m.context_set_id?{context_set_id:groupId(m.context_set_id)}:{})};};
    for(const [oldId,id] of copied){
      const b=available.get(oldId)!,copy=copyOutputRequirementBlock(b,id,copied);
      const properties:Record<string,unknown>={...copy.properties,label:String(b.properties.label||b.handle),authority:'authored',copied_from_block_id:oldId};
      for(const key of ['context_set_id','reference_set_id'])if(properties[key])properties[key]=groupId(properties[key]);
      if(typeof properties.context_set_root_id==='string')properties.context_set_root_id=copied.get(properties.context_set_root_id);
      if(Array.isArray(properties.combined_context_memberships))properties.combined_context_memberships=properties.combined_context_memberships.map(membership);
      if(properties.combined_context)properties.combined_context=membership(properties.combined_context);
      const refs=normalizeActionBlockReferences(properties.block_references).map(r=>({...r,block_id:copied.get(r.block_id)!}));
      if(refs.some(r=>!r.block_id))throw new Error('Related idea unavailable.');
      if(refs.length){properties.block_references=[];deferred.push({type:'BlockPropertyEdited',payload:{...scope,block_id:id,property_path:'block_references',old_value:[],new_value:refs}});}
      changes.push({type:'BlockCreated',payload:{...scope,block_id:id,type:copy.type,handle:`${b.handle}-copy-${id.slice(0,6)}`,position:`z${String(p.libraryBlocks.length+copies.length+1).padStart(8,'0')}`,properties}});
      copies.push({id:oldId,label:b.handle,text:String(b.properties.text??'')});
    }
    for(const r of live)if(copied.has(r.fromBlockId)&&copied.has(r.toBlockId))relations.push({type:'BlockRelationAdded',payload:{...scope,relation_id:createId(),from_block_id:copied.get(r.fromBlockId),to_block_id:copied.get(r.toBlockId),kind:r.kind,properties:{...r.properties,copied_from_relation_id:r.id,...(r.properties.context_set_id?{context_set_id:groupId(r.properties.context_set_id)}:{})}}});
    rootId=copied.get(source.id)!;
  }
  if(target){
    if(!target.properties.context_group)changes.push({type:'BlockPropertyEdited',payload:{...scope,block_id:target.id,property_path:'context_group',old_value:null,new_value:{name:target.handle,target:target.handle,role:combinedContextRoleForBlockType(target.type),application:'isolate',relativity:Number(target.properties.weight??.8)}}});
    const order=p.blockRelations.filter(r=>!r.removed&&r.fromBlockId===target.id&&isContextCompositionRelation(r.kind)).reduce((n,r)=>Math.max(n,Number(r.properties.member_order??0)+1),0);
    relations.push({type:'BlockRelationAdded',payload:{...scope,relation_id:createId(),from_block_id:target.id,to_block_id:rootId,kind:'context_contains',properties:{member_order:order,relation_label:source.handle,relativity:1}}});
  }
  changes.push(...deferred,...relations);
  if(changes.length>512)throw new Error('Choose a smaller group.');
  const issue=validateContextCompositionGraph({blocks:p.libraryBlocks,relations:p.libraryBlockRelations,events:changes});
  if(issue)throw new Error(issue.message);
  return {events:changes,sourceId,destination,rootId,copies,mode:copied.size?'copy':'link'};
}
