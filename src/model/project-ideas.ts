import type { CreativeBlock, CreativeBlockRelation, CreativeProjection, EventInput } from './events.ts';
import { combinedContextMemberships, normalizeActionBlockReferences } from './combined-context.ts';
import { isOutputContextBlock } from './output-source-policy.ts';

export const IDEA_MEMBERSHIP_EVENTS = ['BlockDocumentAttached', 'BlockDocumentDetached'] as const;
export const isIdeaMembershipEvent = (type: string) => (IDEA_MEMBERSHIP_EVENTS as readonly string[]).includes(type);
export type IdeaDocumentUse = { documentId: string; position: string; weight?: number; sourceEvents: string[]; inherited?: boolean };
export const ideaDocumentUses = (block: CreativeBlock): IdeaDocumentUse[] => block.documentUses ?? (block.scope === 'document' && block.documentId ? [{documentId:block.documentId,position:block.position,sourceEvents:[]}] : []);
export const ideaUsedInDocument = (block: CreativeBlock, documentId: string) => ideaDocumentUses(block).some(use => !use.inherited && use.documentId === documentId);

/** Follow the complete authored dependency graph, preserving identities and order. */
export function ideaDependencies(rootIds: string[], blocks: CreativeBlock[], relations: CreativeBlockRelation[]): CreativeBlock[] {
  const available = new Map(blocks.filter(b => !b.removed).map(b => [b.id,b]));
  const selected = new Map<string,CreativeBlock>();
  const pending = [...rootIds];
  for (let i=0;i<pending.length;i++) {
    const id=pending[i]!;
    if(selected.has(id))continue;
    const block=available.get(id);if(!block)continue;
    selected.set(id,block);
    for(const r of relations)if(!r.removed&&r.fromBlockId===id)pending.push(r.toBlockId);
    for(const ref of normalizeActionBlockReferences(block.properties.block_references))pending.push(ref.block_id);
    if(typeof block.properties.context_set_root_id==='string')pending.push(block.properties.context_set_root_id);
    const groups=new Set(combinedContextMemberships(block.properties).map(m=>m.contextSetId));
    if(groups.size)for(const other of available.values())if(combinedContextMemberships(other.properties).some(m=>groups.has(m.contextSetId)))pending.push(other.id);
  }
  return [...selected.values()];
}

/** Output execution requirements and governed/canvas records retain dedicated contracts. */
export const canAttachProjectIdea = (block: CreativeBlock) => !block.removed && block.scope !== 'canvas' && !isOutputContextBlock(block)
  && !Object.keys(block.properties).some(key=>key.startsWith('organization_context_'));

export function attachIdeaEvents(block: CreativeBlock, documentId: string, blocks: CreativeBlock[], relations: CreativeBlockRelation[]): EventInput[] {
  if(!documentId)throw new Error('Choose a document.');
  const dependencies=ideaDependencies([block.id],blocks,relations);
  const available=new Set(blocks.filter(b=>!b.removed).map(b=>b.id));
  if(dependencies.some(b=>normalizeActionBlockReferences(b.properties.block_references).some(ref=>!available.has(ref.block_id))||typeof b.properties.context_set_root_id==='string'&&b.properties.context_set_root_id&&!available.has(b.properties.context_set_root_id)))throw new Error('A related idea is unavailable. Review the group before using it.');
  if(!dependencies.length||dependencies.some(b=>b.projectId!==block.projectId||!canAttachProjectIdea(b)))throw new Error('This idea has protected dependencies. Use its dedicated editor.');
  // Only the root needs an explicit use. Its authored dependencies follow it.
  if(ideaUsedInDocument(block,documentId))return [];
  return [{type:'BlockDocumentAttached',payload:{project_id:block.projectId,document_id:documentId,block_id:block.id,position:`z${String(blocks.length+1).padStart(8,'0')}`}}];
}

/** All effective memberships, including dependencies carried by a shared parent. */
export function ideasInDocument(projection: Pick<CreativeProjection,'libraryBlocks'|'libraryBlockRelations'>, documentId:string):CreativeBlock[] {
  const roots=projection.libraryBlocks.filter(b=>ideaUsedInDocument(b,documentId));
  return ideaDependencies(roots.map(b=>b.id),projection.libraryBlocks,projection.libraryBlockRelations).map(block=>{
    const use=ideaDocumentUses(block).find(u=>u.documentId===documentId);
    return {...block,documentId,scope:'document' as const,position:use?.position??block.position,
      properties:{...block.properties,...(use?.weight!==undefined?{weight:use.weight}:{})},sourceEvents:[...block.sourceEvents,...(use?.sourceEvents??[])]};
  }).sort((a,b)=>a.position.localeCompare(b.position));
}
