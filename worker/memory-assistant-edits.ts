import { memoryCreationKind, parseMemoryCreationReview, type MemoryCreationReview } from '../src/model/memory-creation-review.ts';
import { parseMemoryEditReview,type MemoryEditReview,type MemoryEditReviewTarget } from '../src/model/memory-edit-review.ts';
import type { AssistantContext } from '../src/model/conversation-context.ts';
import type { AssistantProviderResult } from './assistant-provider.ts';

/** Called only after native dispatch/usage/result decoding. Keep eligible text
 * edits in the existing ancestry-owned private result, NOT action proposals,
 * authored events, prompts, or ordinary chat history. No new provider request. */
export function memoryAssistantEditReview(result:AssistantProviderResult,context:AssistantContext,target:MemoryEditReviewTarget,fieldBlockId?:string):MemoryEditReview|null{
  if(context.scope.projectId!==target.projectId||context.scope.documentId!==target.documentId)return null;
  const edits:MemoryEditReview['edits']=[],seen=new Set<string>();
  for(const action of result.actions){
    if(fieldBlockId&&action.target_block_id!==fieldBlockId)continue;
    if(action.kind!=='context.edit'||!action.target_block_id||result.actions.filter(other=>other.target_block_id===action.target_block_id).length!==1)continue;
    const matches=context.decisionAtoms.filter(atom=>atom.id===action.target_block_id),block=matches[0];
    if(matches.length!==1||!block||seen.has(block.id)||block.locked||block.immutable||block.protected||!block.providerEligible
      ||block.providerVisibility!=='editable'||block.intent==='prohibit'||['reference','model3d'].includes(block.type))continue;
    seen.add(block.id);
    if(action.text.trim()===block.text)continue;
    edits.push({blockId:block.id,field:'text',revision:block.version,beforeExcerpt:block.text,suggestedText:action.text});
  }
  return parseMemoryEditReview({version:'memory-edit-review-v1',...target,mode:'review-only',independentEvidence:false,edits},target);
}

/** Retain safe plain-text creations in the same private, lifecycle-bound result.
 * Exact-field requests cannot expand themselves into document-wide creations. */
export function memoryAssistantCreationReview(result:AssistantProviderResult,context:AssistantContext,target:MemoryEditReviewTarget,fieldBlockId?:string):MemoryCreationReview|null{
  if(fieldBlockId||context.scope.projectId!==target.projectId||context.scope.documentId!==target.documentId)return null;
  const creations:MemoryCreationReview['creations']=[];
  for(const [index,action]of result.actions.entries()){
    if(action.kind!=='context.create'||!(memoryCreationKind(action.block_type)||action.block_type==='output'&&action.intent==='include')||!['include','avoid'].includes(action.intent)
      ||action.target_block_id!==null||action.from_block_id!==null||action.to_block_id!==null||action.relation_kind!=='')continue;
    creations.push({proposalId:'create-'+index,blockType:action.block_type as MemoryCreationReview['creations'][number]['blockType'],intent:action.intent as 'include'|'avoid',text:action.text.trim()});
  }
  return parseMemoryCreationReview({version:creations.some(item=>item.blockType==='output')?'memory-creation-review-v2':'memory-creation-review-v1',...target,mode:'review-only',independentEvidence:false,creations},target);
}
