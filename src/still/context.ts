import { ideasInDocument, genericIdeaRelationships, isSemanticIdeaRelation, validateIdeaDependencyGraph } from '../model/project-ideas.ts';
import { documentGenerationRevision } from '../model/document-jobs.ts';
import type { CreativeProjection } from '../model/events.ts';
import { blockEffectFor, blockIntentFor } from '../model/block-types.ts';
import { normalizeSpatialScope } from '../model/spatial-scope.ts';
import { combinedContextGroups } from '../model/combined-context.ts';
import { isOutputContextBlock } from '../model/output-source-policy.ts';
/** The existing model's snapshot contract, without importing any application store or UI. */
export function documentSnapshot(projection: CreativeProjection, documentId: string) {
  const blocks = ideasInDocument(projection,documentId).filter(b=>!isOutputContextBlock(b));
  if(blocks.some(block=>Object.hasOwn(block.properties,'rich_text_body'))){const issue=validateIdeaDependencyGraph(blocks,projection.libraryBlockRelations);if(issue)throw new Error(issue.message);}
  const ids = new Set(blocks.map(b => b.id));
  const facts = blocks.map(b => ({ block_id: b.id, document_id: b.documentId, type: b.type, role: b.type, intent: blockIntentFor(b.type, b.properties), handle: b.handle, position: b.position, locked: b.locked, active: Number(b.properties.weight ?? .5) > 0, effect: blockEffectFor(b.type, b.properties), properties: { ...b.properties, spatial_scope: normalizeSpatialScope(b.properties.spatial_scope) } as Record<string, unknown>, authority: b.properties.authority ?? 'authored', source_event_refs: b.sourceEvents }));
  const relationships = projection.libraryBlockRelations.filter(r => isSemanticIdeaRelation(r.kind) && ids.has(r.fromBlockId) && ids.has(r.toBlockId)).map(r => ({ relation_id: r.id, from_block_id: r.fromBlockId, to_block_id: r.toBlockId, kind: r.kind, properties: r.properties, source_event_refs: r.sourceEvents }));
  relationships.push(...genericIdeaRelationships(blocks));
  return { facts, relationships, context_groups: combinedContextGroups({ facts, relationships }), pins: projection.libraryOutputs.filter(o => o.documentId === documentId && o.pinned).map(o => o.id), tail: [] };
}

export function documentSource(projection: CreativeProjection, documentId: string) {
  const snapshot = documentSnapshot(projection,documentId);
  const sourceBlockVersions = ideasInDocument(projection,documentId).map(b => ({block_id:b.id, version:b.sourceEvents.length}));
  return { snapshot, sourceBlockVersions, revision:documentGenerationRevision({snapshot,sourceBlockVersions,documentId}) };
}
