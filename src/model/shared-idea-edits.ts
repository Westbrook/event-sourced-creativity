import type {CreativeProjection, EventInput} from './events.ts';
import {canAttachProjectIdea, ideaDependencies, ideaUsedInDocument, ideasInDocument} from './project-ideas.ts';

export const ideaContentEdit = (event:EventInput) => ['BlockRenamed','ChipEdited','BlockRelationAdded','BlockRelationRemoved'].includes(event.type)
  ||event.type==='BlockWeightSet'&&(!event.payload.document_id||event.payload.scope==='library')
  ||event.type==='BlockPropertyEdited'&&event.payload.property_path!=='position'&&(event.payload.property_path!=='weight'||!event.payload.document_id||event.payload.scope==='library');
export const ideaEditHasChanges=(e:EventInput)=>e.type.startsWith('BlockRelation')?true:e.type==='BlockRenamed'?e.payload.old_handle!==e.payload.new_handle:e.type==='BlockWeightSet'?e.payload.previous_weight!==e.payload.weight:JSON.stringify(e.payload.old_value)!==JSON.stringify(e.payload.new_value);

export function sharedIdeaEdits(p:CreativeProjection, events:EventInput[]) {
  const ids=new Set(events.filter(ideaContentEdit).filter(ideaEditHasChanges).map(e=>String(e.payload.block_id??e.payload.from_block_id??p.libraryBlockRelations.find(r=>r.id===e.payload.relation_id)?.fromBlockId??'')));
  return p.libraryBlocks.filter(b=>ids.has(b.id)&&canAttachProjectIdea(b)).map(block=>({block,documents:p.documents.filter(d=>!d.removed&&ideasInDocument(p,d.id).some(b=>b.id===block.id))})).filter(item=>item.documents.length>1);
}

/** Fork the affected connected context in this document, leaving other uses intact. */
export function independentIdeaEdits(p:CreativeProjection, edits:EventInput[], documentId:string, createId=()=>crypto.randomUUID()) {
  const targets=sharedIdeaEdits(p,edits).map(x=>x.block.id);
  let graph=ideaDependencies(targets,p.libraryBlocks,p.libraryBlockRelations);
  if(documentId){
    const local=ideasInDocument(p,documentId);
    // Clone referring parents too: replacing only a child would leave the original in the document.
    for(;;){const ids=new Set(graph.map(b=>b.id));const parents=local.filter(b=>ideaDependencies([b.id],p.libraryBlocks,p.libraryBlockRelations).some(dep=>ids.has(dep.id)));const next=ideaDependencies([...ids,...parents.map(b=>b.id)],p.libraryBlocks,p.libraryBlockRelations);if(next.length===graph.length)break;graph=next;}
  }
  if(!graph.length||graph.length>100||graph.some(b=>!canAttachProjectIdea(b)))throw new Error('This group cannot be separated here. Review its connected ideas in Forma.');
  const ids=new Map(graph.map(b=>[b.id,createId()])), groups=new Map<string,string>(),relations=new Map<string,string>();
  const group=(id:string)=>{if(!groups.has(id))groups.set(id,createId());return groups.get(id)!;};
  const remap=(value:unknown,key=''):unknown=>{
    if(typeof value==='string')return ['block_id','from_block_id','to_block_id','context_set_root_id'].includes(key)?ids.get(value)??value:['contextSetId','context_set_id','reference_set_id'].includes(key)?group(value):value;
    if(Array.isArray(value))return value.map(v=>remap(v));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,k)]));
    return value;
  };
  const scope={project_id:p.projectId,document_id:documentId,scope:documentId?'document':'library',source_surface:'independent-idea-edit'};
  const events:EventInput[]=[],deferred:EventInput[]=[];
  for(const block of graph){
    const local=documentId?ideasInDocument(p,documentId).find(b=>b.id===block.id):undefined;
    const properties=remap({...block.properties,...(local?{weight:local.properties.weight}:{}),forked_from_block_id:block.id}) as Record<string,unknown>;
    if(Array.isArray(properties.block_references)&&properties.block_references.length){deferred.push({type:'BlockPropertyEdited',payload:{...scope,block_id:ids.get(block.id),property_path:'block_references',old_value:[],new_value:properties.block_references}});properties.block_references=[];}
    events.push({type:'BlockCreated',payload:{...scope,block_id:ids.get(block.id),scope:documentId&&ideaUsedInDocument(block,documentId)?'document':'library',project_owned:true,type:block.type,handle:block.handle,position:local?.position??block.position,properties}});
  }
  for(const r of p.libraryBlockRelations.filter(r=>!r.removed&&ids.has(r.fromBlockId)&&ids.has(r.toBlockId))){const id=createId();relations.set(r.id,id);events.push({type:'BlockRelationAdded',payload:{...scope,relation_id:id,from_block_id:ids.get(r.fromBlockId),to_block_id:ids.get(r.toBlockId),kind:r.kind,properties:remap(r.properties)}});}
  events.push(...deferred,...edits.map(e=>({...e,payload:{...remap(e.payload) as Record<string,unknown>,...(e.type==='BlockPropertyEdited'?{old_value:remap(e.payload.old_value,String(e.payload.property_path)),new_value:remap(e.payload.new_value,String(e.payload.property_path))}:{}),...(ids.has(String(e.payload.block_id))?scope:{}),...(relations.has(String(e.payload.relation_id))?{relation_id:relations.get(String(e.payload.relation_id))}:{})}})));
  for(const b of graph)if(documentId&&ideaUsedInDocument(b,documentId)){const use=ideasInDocument(p,documentId).find(local=>local.id===b.id)!;events.push({type:'BlockDocumentDetached',payload:{...scope,block_id:b.id,position:use.position,weight:Number(use.properties.weight??.5)}});}
  for(const b of graph)if(b.locked)events.push({type:'BlockLocked',payload:{...scope,block_id:ids.get(b.id)}});
  if(events.length>512)throw new Error('Choose a smaller group.');
  return {events,ids};
}
