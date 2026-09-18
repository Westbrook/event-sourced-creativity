import type { CreativeBlock, CreativeProjection, EventInput } from '../model/events.ts';
import { combinedContextRoleForBlockType, isContextCompositionRelation, validateContextCompositionGraph } from '../model/combined-context.ts';
import { creativeContextRightsIssue } from '../model/context-health.ts';
import { isOutputContextBlock } from '../model/output-source-policy.ts';
export function editableIdea(block: CreativeBlock | undefined): block is CreativeBlock {
  return !!block && !block.removed && !block.locked && block.scope === 'document' && !['reference','model3d','action'].includes(block.type) && !isOutputContextBlock(block) && !block.properties.model_url && !block.properties.source_evidence_hash && !Object.keys(block.properties).some(k => k.startsWith('organization_context_')) && !creativeContextRightsIssue(block.properties);
}
export function compositionPlan(projection: CreativeProjection, parentId: string, members: string[], application: string): EventInput[] {
  const parent = projection.blocks.find(b => b.id === parentId);
  if (!editableIdea(parent) || !['isolate','co_locate','ordered','recur'].includes(application)) throw new Error('This group is not editable here.');
  const existing = projection.blockRelations.filter(r => !r.removed && r.fromBlockId === parentId && isContextCompositionRelation(r.kind)).sort((a,b) => Number(a.properties.member_order ?? 0)-Number(b.properties.member_order ?? 0));
  if (members.length > 40 || new Set(members).size !== members.length) throw new Error('Choose up to 40 distinct ideas.');
  const scope = {project_id:parent.projectId,document_id:parent.documentId};
  for (const id of members) { const block = projection.blocks.find(b => b.id === id); if (!editableIdea(block) || block.documentId !== parent.documentId) throw new Error('Each member must be an editable idea in this document.'); }
  const oldGroup = parent.properties.context_group ?? null;
  const events: EventInput[] = [{type:'BlockPropertyEdited',payload:{...scope,block_id:parent.id,property_path:'context_group',old_value:oldGroup,new_value:{name:parent.handle,target:parent.handle,role:combinedContextRoleForBlockType(parent.type),relativity:Number(parent.properties.weight ?? .8),...(oldGroup && typeof oldGroup === 'object' ? oldGroup : {}),application}}}];
  for (const relation of existing) events.push({type:'BlockRelationRemoved',payload:{...scope,relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind}});
  members.forEach((id,index) => { const previous = existing.find(r => r.toBlockId === id); events.push({type:'BlockRelationAdded',payload:{...scope,relation_id:crypto.randomUUID(),from_block_id:parent.id,to_block_id:id,kind:previous?.kind ?? 'context_contains',properties:{...previous?.properties,member_order:index,relation_label:previous?.properties.relation_label ?? projection.blocks.find(b=>b.id===id)?.handle,relativity:previous?.properties.relativity ?? 1}}}); });
  const issue = validateContextCompositionGraph({blocks:projection.libraryBlocks,relations:projection.libraryBlockRelations,events});
  if (issue) throw new Error(issue.message);
  return events;
}
