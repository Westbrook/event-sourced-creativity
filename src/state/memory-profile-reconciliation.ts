import type { DerivationResultItem, DerivationResultView } from './memory-derivation-client.ts';

export const MEMORY_PROFILE_REVIEW_LIMIT = 16;

export type ReconciledProfileItem = DerivationResultItem & { profileOrigin: {
  jobId: string; state: 'latest' | 'historical'; repeatedIn: number; sharedEvidence: boolean;
  interpretation: 'current' | 'earlier-only' | 'revised';
  newerInterpretationJobId: string | null; counterevidence: boolean;
} };
export type ReconciledProfile = { items: ReconciledProfileItem[]; results: number; complete: false };

/** A read-side projection of independently revalidated retained results, newest
 * first. It never derives fresh claims, renews retention, or treats repeated
 * model output as independent evidence. Earlier-only facets remain historical;
 * omission is neither reaffirmation nor withdrawal. Different interpretations
 * of the same support remain separate and explicitly share evidence.
 * Inputs are strict-client views, not caller-supplied publication authority. */
export function reconcileMemoryProfile(views: readonly DerivationResultView[]): ReconciledProfile {
  if (!views.length || views.length > MEMORY_PROFILE_REVIEW_LIMIT || new Set(views.map(view => view.jobId)).size !== views.length
    || views.some(view => view.purpose !== 'profile' || view.scopeKey !== views[0]!.scopeKey)) throw Error('memory-profile-scope');
  const items: ReconciledProfileItem[] = [];
  const equivalent = new Map<string, ReconciledProfileItem>();
  const newestClaim = new Map<string, ReconciledProfileItem>();
  for (const [index, view] of views.entries()) for (const item of view.items) {
    // Exact claim identity alone does not imply unchanged model interpretation.
    // Quotes/indexes stay attached to their own result; never splice evidence.
    const key = JSON.stringify([item.claimKey, item.category, item.text, item.citationStatus,
      [...item.lineageIds].sort(), item.supports, item.counterevidence, item.observationCitations ?? [], item.resourceCitations ?? []]);
    const old = equivalent.get(key);
    if (old) { old.profileOrigin.repeatedIn++; continue; }
    // Only native claim identity can connect interpretations. Similar wording,
    // category or overlapping evidence is not semantic equivalence. A newer
    // model interpretation does not supersede a human correction or prove that
    // the older hypothesis is false. Both retain their own original citations.
    const newer = newestClaim.get(item.claimKey);
    const row: ReconciledProfileItem = { ...structuredClone(item), profileOrigin: {
      jobId: view.jobId, state: index === 0 ? 'latest' : 'historical', repeatedIn: 1, sharedEvidence: false,
      interpretation: newer ? 'revised' : index === 0 ? 'current' : 'earlier-only',
      newerInterpretationJobId: newer?.profileOrigin.jobId ?? null,
      counterevidence: item.citationStatus === 'conflicting-citations',
    } };
    equivalent.set(key, row); items.push(row);
    if (!newer) newestClaim.set(item.claimKey, row);
  }
  const support = new Map<string, ReconciledProfileItem[]>();
  for (const item of items) for (const lineage of item.lineageIds) {
    const peers = support.get(lineage) ?? []; peers.push(item); support.set(lineage, peers);
  }
  for (const peers of support.values()) if (peers.length > 1) for (const item of peers) item.profileOrigin.sharedEvidence = true;
  return { items, results: views.length, complete: false };
}
