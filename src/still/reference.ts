import type { CreativeBlock, CreativeProjection, EventInput } from '../model/events.ts';
import type { IdeaCandidate } from './context-workflow.ts';
import { combinedContextRoleForBlockType, isContextCompositionRelation } from '../model/combined-context.ts';
export type AcquiredMedia = { url:string; contentHash:string; mimeType:string };
/** The same media, rights, block and composition events consumed by Forma. */
export function acquiredReferenceEvents(target:CreativeBlock,projection:CreativeProjection,candidate:IdeaCandidate,media:AcquiredMedia):EventInput[] {
  const r=candidate.research;
  if(!r||r.blockId||r.area!=='learned'||r.type!=='reference'||!r.license||!media.url.startsWith('/api/media/')||!media.contentHash)throw new Error('This reference receipt is incomplete.');
  const referenceId=crypto.randomUUID(),blockId=crypto.randomUUID(),scope={project_id:target.projectId,document_id:target.documentId};
  const events:EventInput[]=[
    {type:'ReferenceIngested',payload:{...scope,reference_id:referenceId,source_type:'upload',source_ref:media.url,content_hash:media.contentHash,source_mime_type:media.mimeType,rights_class:'asserted'}},
    {type:'RightsAsserted',payload:{...scope,reference_id:referenceId,rights_class:'owned_or_licensed',assertion_method:'explicit-upload-confirmation'}},
    {type:'BlockCreated',payload:{...scope,block_id:blockId,type:'reference',scope:'document',handle:r.label==='Reference'?r.text.slice(0,120):r.label,position:`z${String(projection.libraryBlocks.length+1).padStart(8,'0')}`,properties:{reference_id:referenceId,label:r.text,text:r.text,media_url:media.url,media_type:media.mimeType,source_mime_type:media.mimeType,source_content_hash:media.contentHash,subtype:'Mood',weight:.72,authority:'authored',pixel_reference_mode:'context_only',source_url:r.sourceUrl,source_image_url:r.imageUrl,source_license:r.license,source_attribution:r.attribution,source_execution_id:candidate.selection.executionId,source_proposal_id:r.id,source_block_id:target.id,source_citation:[r.sourceUrl,r.attribution,r.license].filter(Boolean).join(' · ')}}},
  ];
  if(!target.properties.context_group)events.push({type:'BlockPropertyEdited',payload:{...scope,block_id:target.id,property_path:'context_group',old_value:null,new_value:{name:target.handle,target:target.handle,role:combinedContextRoleForBlockType(target.type),application:'isolate',relativity:Number(target.properties.weight??.8)}}});
  const order=projection.blockRelations.filter(r=>!r.removed&&r.fromBlockId===target.id&&isContextCompositionRelation(r.kind)).reduce((max,r)=>Math.max(max,Number(r.properties.member_order??0)+1),0);
  events.push({type:'BlockRelationAdded',payload:{...scope,relation_id:crypto.randomUUID(),from_block_id:target.id,to_block_id:blockId,kind:'context_contains',properties:{member_order:order,relation_label:r.label,relativity:1}}});
  return events;
}
