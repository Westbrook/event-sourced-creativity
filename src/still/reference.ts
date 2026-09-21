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

export type SuppliedMedia = AcquiredMedia & {name:string;kind?:string;size?:number;durationSeconds?:number;sourceEvidenceHash?:string;extraction?:import('../model/source-documents.ts').SourceDocumentExtraction};
/** Owned uploads use Forma's original typed blocks and immutable extraction evidence. */
export function suppliedReferenceEvents(target:CreativeBlock,projection:CreativeProjection,media:SuppliedMedia,candidate?:IdeaCandidate):EventInput[] {
  if(!media.url.startsWith('/api/media/')||!media.contentHash||!media.mimeType)throw new Error('File receipt is incomplete.');
  const r=candidate?.research,model=media.mimeType==='model/gltf-binary',audio=media.mimeType.startsWith('audio/'),image=media.mimeType.startsWith('image/'),e=media.extraction;
  if(!model&&!audio&&!image&&(!e||!media.sourceEvidenceHash))throw new Error('File evidence is incomplete.');
  const referenceId=crypto.randomUUID(),blockId=crypto.randomUUID(),scope={project_id:target.projectId,document_id:target.documentId};
  const properties:Record<string,unknown>={label:media.name,text:e?.text??r?.text??'',source_block_id:target.id,weight:.72,authority:'authored',pixel_reference_mode:'context_only',rights_class:'owned_or_licensed',
    ...(model?{subtype:'Object',intent:'include',model_url:media.url,model_mime_type:media.mimeType,model_content_hash:media.contentHash,model_reference_id:referenceId}:{reference_id:referenceId,subtype:audio?'Score':'Mood',media_url:media.url,media_type:media.mimeType,source_mime_type:media.mimeType,source_content_hash:media.contentHash}),
    source_citation:[media.name,r?.sourceUrl,r?.attribution,r?.license,`SHA-256 ${media.contentHash}`].filter(Boolean).join(' · '),
    ...(r?{source_url:r.sourceUrl,source_license:r.license,source_attribution:r.attribution,source_execution_id:candidate!.selection.executionId,source_proposal_id:r.id,reference_purpose:r.text}:{}),
    ...(audio?{audio_role:'score',duration_seconds:media.durationSeconds??null,size_bytes:media.size,description:r?.text??'',inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{}),
    ...(e?{source_citations:e.segments.map(s=>({anchor:s.anchor,excerpt:s.text})),source_segment_count:e.segments.length,source_excerpt_truncated:e.truncated,source_kind:e.sourceKind,source_evidence_hash:media.sourceEvidenceHash,extraction_status:e.status,...(e.status==='unavailable'?{extraction_message:e.message}:{})}:{}),
  };
  const events:EventInput[]=[{type:'ReferenceIngested',payload:{...scope,reference_id:referenceId,source_type:model?'model3d-upload':audio?'audio-upload':image?'upload':'document-upload',source_ref:media.url,content_hash:media.contentHash,source_mime_type:media.mimeType,rights_class:'asserted'}},{type:'RightsAsserted',payload:{...scope,reference_id:referenceId,rights_class:'owned_or_licensed',assertion_method:'explicit-upload-confirmation'}},{type:'BlockCreated',payload:{...scope,block_id:blockId,type:model?'model3d':audio?'audio':'reference',scope:'document',handle:media.name.slice(0,120),position:`z${String(projection.libraryBlocks.length+1).padStart(8,'0')}`,properties}}];
  if(!target.properties.context_group)events.push({type:'BlockPropertyEdited',payload:{...scope,block_id:target.id,property_path:'context_group',old_value:null,new_value:{name:target.handle,target:target.handle,role:combinedContextRoleForBlockType(target.type),application:'isolate',relativity:Number(target.properties.weight??.8)}}});
  const order=projection.blockRelations.filter(r=>!r.removed&&r.fromBlockId===target.id&&isContextCompositionRelation(r.kind)).reduce((max,r)=>Math.max(max,Number(r.properties.member_order??0)+1),0);
  events.push({type:'BlockRelationAdded',payload:{...scope,relation_id:crypto.randomUUID(),from_block_id:target.id,to_block_id:blockId,kind:'context_contains',properties:{member_order:order,relation_label:media.name.slice(0,120),relativity:1}}});return events;
}
