import type { AssistantContextAction } from '../src/model/assistant-proposals.ts';
import type { CreativeProjection } from '../src/model/events.ts';
import { ideaDependencies, validateIdeaDependencyGraph } from '../src/model/project-ideas.ts';

/** Legacy assistant actions cannot flatten structured Ideas or bypass their reference graph.
 * This guard runs for ordinary proposal acceptance and native Memory publications. */
export function assistantIdeaMutationIssue(action: AssistantContextAction, projection: Pick<CreativeProjection, 'libraryBlocks' | 'libraryBlockRelations'>): string | null {
  if (action.kind === 'context.create') return null;
  const affected = action.kind === 'context.edit' || action.kind === 'context.remove' ? action.targetBlockId : action.fromBlockId;
  const target = projection.libraryBlocks.find(block => block.id === affected && !block.removed);
  if (action.kind === 'context.edit' && target && (Object.hasOwn(target.properties, 'rich_text_body') || Object.hasOwn(target.properties, 'preferred_output_kinds'))) return 'idea_body_editor_required';
  if (action.kind === 'context.edit' || action.kind === 'context.relation.remove') return null;
  const blocks = projection.libraryBlocks.map(block => action.kind === 'context.remove' && block.id === action.targetBlockId ? { ...block, removed: true } : block);
  const relations = action.kind === 'context.relation.add' ? [...projection.libraryBlockRelations, {
    id: 'assistant:prospective-relation', projectId: target?.projectId ?? '', documentId: target?.documentId ?? '',
    fromBlockId: action.fromBlockId, toBlockId: action.toBlockId, kind: action.relationKind,
    properties: {}, sourceEvents: [], removed: false,
  }] : projection.libraryBlockRelations;
  for (const root of blocks.filter(block => !block.removed && Object.hasOwn(block.properties, 'rich_text_body'))) {
    const before = ideaDependencies([root.id], projection.libraryBlocks, projection.libraryBlockRelations);
    const after = ideaDependencies([root.id], blocks, relations);
    if (![...before, ...after].some(block => block.id === affected)) continue;
    const issue = validateIdeaDependencyGraph(after, relations);
    if (issue) return issue.code;
  }
  return null;
}
