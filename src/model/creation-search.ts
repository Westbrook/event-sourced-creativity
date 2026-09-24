/** Shared v19 discovery transport. IDs are identities; labels and scores are never authority. */
export type CreationSearchKind = 'project' | 'document' | 'idea';
export interface CreationSearchRequest {
  draftId: string;
  draftRevision: number;
  queryRevision: number;
  query: string;
}
export interface CreationSearchPartition {
  projectId: string;
  custody: string;
  /** Changes when membership/capability/provider policy changes, not a TTL. */
  permissionEpoch: string;
  contentVersion: string;
  indexVersion: string;
  providerPolicy: string;
}
export interface CreationSearchCandidate {
  id: string;
  projectId: string;
  kind: CreationSearchKind;
  revision: string;
  contentHash: string;
  title: string;
  /** Readable authorized locations, never model-invented labels. */
  locations: Array<{ documentId?: string; title: string }>;
  reason: string;
  action: 'open' | 'open-or-use';
}
export interface CreationIndexCoverage {
  projectId: string;
  custody: string;
  expected: number | null;
  lexical: number;
  semantic: number;
  backfillComplete: boolean;
}
export interface CreationSearchResponse {
  schemaVersion: 1;
  draftId: string;
  draftRevision: number;
  queryRevision: number;
  scope: 'account' | 'project';
  projectId?: string;
  candidates: CreationSearchCandidate[];
  coverage: CreationIndexCoverage[];
  mode: 'hybrid' | 'lexical-only' | 'unavailable';
  partial: boolean;
  /** Empty results are conclusive only after complete, healthy indexing and reranking. */
  definitiveNoMatch: boolean;
  notices: string[];
}
export const CREATION_SEARCH_BUDGETS = Object.freeze({ lexical: 20, semantic: 20, hydrate: 24, results: 3, partitions: 64, timeoutMs: 1600, queryBytes: 12000 });
export function validCreationSearchRequest(value: unknown): value is CreationSearchRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as CreationSearchRequest;
  return typeof v.draftId === 'string' && !!v.draftId && Number.isSafeInteger(v.draftRevision) && v.draftRevision >= 0 && Number.isSafeInteger(v.queryRevision) && v.queryRevision >= 0 && typeof v.query === 'string' && new TextEncoder().encode(v.query).length <= CREATION_SEARCH_BUDGETS.queryBytes;
}
