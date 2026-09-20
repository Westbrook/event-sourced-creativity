import type { DocumentView } from './routes.ts';

export const MEMORY_EVIDENCE_RESOURCES = 'memory-evidence-resources-v1';
/** Where cited evidence was recorded, not the inferred scope or truth of a claim. */
export type MemoryEvidenceResource = { zoom: 'document'; scopeKey: string }
  | { zoom: 'page'; scopeKey: string; view: DocumentView }
  | { zoom: 'block'; scopeKey: string; blockId: string; revision: number };
export type MemoryResourceCitation = { source: 'original' | 'observation'; index: number; resource: MemoryEvidenceResource };

/** Stable presentation ordering only. Context never changes authorization,
 * confidence, citation role, suppression, retention or source lifetime. */
export function memoryEvidenceProximity(citations: readonly MemoryResourceCitation[] | undefined,
  selection: { view?: DocumentView | null; blockId?: string | null }): 'block' | 'page' | 'document' {
  if (selection.blockId && citations?.some(row => row.resource.zoom === 'block' && row.resource.blockId === selection.blockId)) return 'block';
  if (selection.view && citations?.some(row => row.resource.zoom === 'page' && row.resource.view === selection.view)) return 'page';
  return 'document';
}
