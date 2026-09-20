import { projectContainmentId, type ProjectContainmentNode } from './project-containment.ts';
import { derivationId } from './memory-derivation-policy.ts';

/** An explicit source-side limit; no existing enrollment is broadened. */
export const MEMORY_RECALL_BOUNDARIES = ['document', 'project', 'project-tree', 'partition'] as const;
export type MemoryRecallBoundary = typeof MEMORY_RECALL_BOUNDARIES[number];
export type MemoryRecallScope = { actorId: string; ownerId: string; organizationId: string | null; projectId: string; documentId: string };
export type MemoryRecallRelation = { zoom: MemoryRecallBoundary; distance: number; weight: number };
export function memoryRecallBoundary(value: unknown): value is MemoryRecallBoundary {
  return MEMORY_RECALL_BOUNDARIES.some(boundary => boundary === value);
}

/** Relevance only. The caller must independently prove both sources and every
 * traversed project. An inaccessible intermediate node breaks the path. */
export function memoryRecallRelation(source: MemoryRecallScope, target: MemoryRecallScope, boundary: MemoryRecallBoundary,
  forest: ReadonlyMap<string, Readonly<ProjectContainmentNode>>, readable: ReadonlySet<string>): MemoryRecallRelation | null {
  if (!memoryRecallBoundary(boundary) || [source, target].some(scope => !scope ||
    ![scope.actorId, scope.ownerId, scope.documentId].every(derivationId) || !projectContainmentId(scope.projectId)
    || scope.organizationId !== null && !derivationId(scope.organizationId))
    || source.actorId !== target.actorId || source.ownerId !== target.ownerId || source.organizationId !== target.organizationId) return null;
  const node = (scope: MemoryRecallScope) => readable.has(scope.projectId) && forest.get(scope.projectId)?.organizationId === scope.organizationId;
  if (!node(source) || !node(target)) return null;
  if (source.projectId === target.projectId && source.documentId === target.documentId) return { zoom: 'document', distance: 0, weight: 1 };
  if (boundary === 'document') return null;
  if (source.projectId === target.projectId) return { zoom: 'project', distance: 0, weight: .7 };
  if (boundary === 'project') return null;
  const path = (projectId: string) => {
    const result = new Map<string, number>(); let id: string | null = projectId;
    while (id !== null && result.size < 16 && readable.has(id)) {
      const current = forest.get(id); if (!current || current.organizationId !== source.organizationId || result.has(id)) return null;
      result.set(id, result.size); id = current.parentId;
    }
    return id !== null && readable.has(id) ? null : result;
  };
  const from = path(source.projectId), to = path(target.projectId); if (!from || !to) return null;
  const distances = [...from].flatMap(([id, steps]) => to.has(id) ? [steps + to.get(id)!] : []);
  if (distances.length) { const distance = Math.min(...distances); return { zoom: 'project-tree', distance, weight: .5 / (1 + distance) }; }
  return boundary === 'partition' ? { zoom: 'partition', distance: 0, weight: .01 } : null;
}
