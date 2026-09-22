import type {CreativeEvent,CreativeProjection} from './events.ts';
import {ideasInDocument} from './project-ideas.ts';
import {ideaContentEdit,ideaEditHasChanges} from './shared-idea-edits.ts';
import type {CreativeMedium} from './workspace-intelligence.ts';
export type SharedIdeaOutputNotice={key:string;documentId:string;documentTitle:string;outputId:string;kind:CreativeMedium;changedIdeaIds:string[]};
const cache=new WeakMap<CreativeProjection,{events:CreativeEvent[];length:number;notices:SharedIdeaOutputNotice[]}>();
/** A derived notice, never a mutation of the retained output or a generation request. */
export function sharedIdeaOutputNotices(p:CreativeProjection,events:CreativeEvent[]):SharedIdeaOutputNotice[]{
 const previous=cache.get(p);if(previous?.events===events&&previous.length===events.length)return previous.notices;
 const byId=new Map(events.map(e=>[e.eventId,e]));
 const uses=new Map<string,CreativeEvent[]>();for(const event of events)if(['BlockDocumentAttached','BlockDocumentDetached','BlockRehomed'].includes(event.type)){const id=String(event.payload.block_id);if(!uses.has(id))uses.set(id,[]);uses.get(id)!.push(event);}
 const latest=new Map<string,{id:string;documentId:string;sequence:number;sourceEventId:string;kind:CreativeMedium;generationId?:string}>();
 for(const output of [...p.libraryOutputs.filter(o=>!o.discarded&&!o.canvasId).map(o=>({...o,kind:'image' as const})),...p.libraryArtifacts]){const key=`${output.documentId}:${output.kind}`;if(!latest.has(key)||latest.get(key)!.sequence<output.sequence)latest.set(key,output);}
 const notices:SharedIdeaOutputNotice[]=[];
 for(const output of latest.values()){
  const doc=p.documents.find(d=>d.id===output.documentId&&!d.removed);if(!doc)continue;
  const completion=byId.get(output.sourceEventId);
  const captured=output.generationId?events.findLast(e=>e.type==='ContextCompiled'&&e.payload.generation_id===output.generationId):completion;
  const versions=Array.isArray(captured?.payload.source_block_versions)?captured!.payload.source_block_versions as {block_id:string;version:number}[]:[];
  const changed:CreativeEvent[]=[];const ids:string[]=[];
  const effective=ideasInDocument(p,doc.id);
  const sourceBlocks=versions.length?p.libraryBlocks.filter(b=>versions.some(v=>v.block_id===b.id)):effective;
  for(const block of sourceBlocks){
   const version=versions.find(v=>v.block_id===block.id);if(versions.length&&!version)continue;
   const base=p.libraryBlocks.find(b=>b.id===block.id)!;
   // Membership receipts are appended to the block's source list by the document projection.
   const lastUse=uses.get(block.id)?.findLast(e=>e.sequence<=(captured?.sequence??output.sequence)&&e.payload.block_id===block.id&&(e.type==='BlockRehomed'||['BlockDocumentAttached','BlockDocumentDetached'].includes(e.type)&&e.payload.document_id===doc.id));
   const membershipCount=lastUse&&lastUse.type!=='BlockDocumentDetached'&&lastUse.payload.document_id===doc.id?1:0;
   const capturedCount=version?Math.max(0,Number(version.version)-membershipCount):undefined;
   const changes=base.sourceEvents.map((id,index)=>({event:byId.get(id),index})).filter(({event,index})=>event&&ideaContentEdit(event)&&event.payload.document_id!==doc.id
     &&(capturedCount!==undefined?index>=capturedCount:event.sequence>(captured?.sequence??output.sequence))
     &&ideaEditHasChanges(event)).map(x=>x.event!);
   if(changes.length){ids.push(block.id);changed.push(...changes);}
  }
  if(changed.length)notices.push({key:`${output.id}:${changed.map(e=>e.eventId).sort().join(':')}`,documentId:doc.id,documentTitle:doc.title,outputId:output.id,kind:output.kind,changedIdeaIds:ids});
 }
 cache.set(p,{events,length:events.length,notices});return notices;
}
