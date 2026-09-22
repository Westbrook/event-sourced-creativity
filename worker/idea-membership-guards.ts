import { foldEvents, type CreativeEvent } from '../src/model/events.ts';
import { attachIdeaEvents, canAttachProjectIdea, ideaDependencies, ideaDocumentUses, isIdeaMembershipEvent } from '../src/model/project-ideas.ts';

/** Canonical history and the pending batch share the append's expected-head fence. */
export function validateIdeaMembershipEvents(history: CreativeEvent[], inputs: readonly {type?:string;payload?:Record<string,unknown>}[]) {
  const pending=[...history];let sequence=Math.max(0,...history.slice(-1).map(e=>e.sequence));
  for(const [index,input] of inputs.entries()) {
    const p=input.payload??{};
    if(input.type==='BlockRehomed'){
      const initial=foldEvents(pending,Infinity,'',String(p.from_project_id??p.project_id??''));
      const projection=initial.libraryBlocks.some(b=>b.id===p.block_id)?initial:initial.projects.map(project=>foldEvents(pending,Infinity,'',project.id)).find(project=>project.libraryBlocks.some(b=>b.id===p.block_id))??initial;
      const block=projection.libraryBlocks.find(b=>b.id===p.block_id);
      if(block){const uses=ideaDocumentUses(block).filter(u=>!u.inherited),moving=p.project_id&&p.project_id!==block.projectId;
        if(uses.length>1||moving&&(uses.length>0||projection.libraryBlockRelations.some(r=>r.fromBlockId===block.id||r.toBlockId===block.id)))return {index,error:'idea_rehome_would_break_membership'};
      }
    }
    if(isIdeaMembershipEvent(String(input.type))) {
      if(!['block_id','project_id','document_id'].every(k=>typeof p[k]==='string'&&String(p[k]).length>0&&String(p[k]).length<=180)
        ||p.weight!==undefined&&(typeof p.weight!=='number'||!Number.isFinite(p.weight)||p.weight<0||p.weight>1)
        ||p.position!==undefined&&(typeof p.position!=='string'||p.position.length>120))return {index,error:'invalid_idea_membership'};
      const projectId=String(p.project_id),documentId=String(p.document_id),blockId=String(p.block_id);
      const projection=foldEvents(pending,Infinity,documentId,projectId);
      const block=projection.libraryBlocks.find(b=>b.id===blockId&&b.projectId===projectId);
      if(!projection.documents.some(d=>d.id===documentId&&d.projectId===projectId)||!block)return {index,error:'idea_membership_scope_denied'};
      const dependencies=ideaDependencies([blockId],projection.libraryBlocks,projection.libraryBlockRelations);
      if(dependencies.some(b=>b.projectId!==projectId||!canAttachProjectIdea(b)))return {index,error:'idea_membership_protected'};
      if(input.type==='BlockDocumentAttached')try{attachIdeaEvents(block,documentId,projection.libraryBlocks,projection.libraryBlockRelations);}catch{return {index,error:'idea_membership_protected'};}
      if(input.type==='BlockDocumentDetached') {
        const detaching=new Set(inputs.slice(index).filter(e=>e.type==='BlockDocumentDetached'&&e.payload?.project_id===projectId&&e.payload?.document_id===documentId).map(e=>String(e.payload?.block_id)));
        const otherRoots=projection.libraryBlocks.filter(b=>!detaching.has(b.id)&&ideaDocumentUses(b).some(u=>!u.inherited&&u.documentId===documentId));
        if(ideaDependencies(otherRoots.map(b=>b.id),projection.libraryBlocks,projection.libraryBlockRelations).some(b=>b.id===blockId))return {index,error:'idea_required_by_document_group'};
      }
    }
    pending.push({eventId:`membership-validation:${index}`,streamId:history[0]?.streamId??'',sequence:++sequence,occurredAt:'',recordedAt:'',actor:'user',clientId:'',correlationId:'',causationId:null,compensatesEventId:null,schemaVersion:1,type:String(input.type),payload:p});
  }
  return null;
}

/** New removals preserve project ideas; old removal history keeps its old visibility. */
export function projectOwnedIdeaInput<T extends {type?: string;payload?:Record<string,unknown>}>(event:T):T {
  if(event.type==='BlockCreated'&&String(event.payload?.type??'').toLowerCase()!=='output'&&event.payload?.scope!=='canvas'&&!event.payload?.canvas_id)return {...event,payload:{...event.payload,project_owned:true}};
  if(event.type==='DocumentRemoved')return {...event,payload:{...event.payload,preserve_project_ideas:true}};
  return event;
}
