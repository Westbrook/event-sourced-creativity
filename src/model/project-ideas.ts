import type { CreativeBlock, CreativeBlockRelation, CreativeProjection, EventInput } from './events.ts';
import { combinedContextMemberships, normalizeActionBlockReferences } from './combined-context.ts';
import { ideaBodyReferences } from './idea-body.ts';
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
    for(const r of relations)if(!r.removed&&r.fromBlockId===id&&isSemanticIdeaRelation(r.kind))pending.push(r.toBlockId);
    for(const ref of genericIdeaReferences(block.properties))if(ref.projectId===block.projectId)pending.push(ref.blockId);
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
  const issue=validateIdeaDependencyGraph(dependencies,relations);if(issue)throw new Error(issue.message);
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

/** Attribution is audit evidence, never an instruction to include another Idea. */
export const isSemanticIdeaRelation = (kind:string) => !/(?:provenance|source_attribution|copied_from)/u.test(kind);
export function genericIdeaReferences(properties:Record<string,unknown>) {
  if(!Object.hasOwn(properties,'rich_text_body'))return [];
  // Unknown future versions remain readable; mutation and generation gates reject them.
  try{return ideaBodyReferences(properties.rich_text_body);}catch{return [];}
}
export type IdeaDependencyIssue={code:string;message:string;blockId:string};
export function validateIdeaDependencyGraph(blocks:readonly CreativeBlock[],relations:readonly CreativeBlockRelation[]):IdeaDependencyIssue|null {
  const available=new Map(blocks.filter(b=>!b.removed).map(b=>[b.id,b]));
  const edges=new Map<string,Set<string>>();
  for(const block of available.values()) {
    if(Object.hasOwn(block.properties,'rich_text_body'))try{ideaBodyReferences(block.properties.rich_text_body);}catch(error){return {code:'idea_body_editor_required',message:error instanceof Error?error.message:'Open this Idea in a compatible Still editor.',blockId:block.id};}
    const refs=genericIdeaReferences(block.properties), targets=new Set(refs.map(ref=>ref.blockId));
    for(const ref of refs){const target=available.get(ref.blockId);if(target&&!canAttachProjectIdea(target))return {code:'idea_reference_protected',message:'This reference requires its dedicated editor. Choose an eligible Idea in Still.',blockId:block.id};}
    for(const ref of refs)if(ref.projectId!==block.projectId)return {code:'idea_reference_scope_denied',message:'Idea references must stay in the same Project. Choose the reference again in Still.',blockId:block.id};
    for(const ref of normalizeActionBlockReferences(block.properties.block_references))targets.add(ref.block_id);
    for(const relation of relations)if(!relation.removed&&relation.fromBlockId===block.id&&isSemanticIdeaRelation(relation.kind))targets.add(relation.toBlockId);
    for(const id of targets){const target=available.get(id);if(!target||target.projectId!==block.projectId)return {code:'idea_reference_unavailable',message:'A referenced Idea is unavailable in this Project. Restore or replace the reference in Still.',blockId:block.id};}
    edges.set(block.id,targets);
  }
  const active=new Set<string>(),done=new Set<string>();
  const cycle=(id:string):boolean=>{if(active.has(id))return true;if(done.has(id))return false;active.add(id);for(const next of edges.get(id)??[])if(cycle(next))return true;active.delete(id);done.add(id);return false;};
  for(const id of available.keys())if(cycle(id))return {code:'idea_reference_cycle',message:'An Idea cannot include itself through another reference. Remove the circular reference in Still.',blockId:id};
  return null;
}

/** Semantic relationships retain direction without turning mentions into composition groups. */
export function genericIdeaRelationships(blocks:readonly CreativeBlock[]) {
  return blocks.flatMap(block=>[...new Set(genericIdeaReferences(block.properties).map(ref=>ref.blockId))].map(target=>({
    relation_id:`idea-reference:${block.id}:${target}`,from_block_id:block.id,to_block_id:target,
    kind:'idea_reference',properties:{},source_event_refs:block.sourceEvents,
  })));
}
