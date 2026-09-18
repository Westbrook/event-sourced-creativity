import type { GenerationReadinessProbe } from '../model/generation-readiness.ts';

export type GenerationReview = {
  key: 'budgetAcknowledged' | 'preflightAcknowledged' | null;
  message: string;
  issues: GenerationReadinessProbe[];
};

/** Keep the reasons for admission failure, not just its generic summary. */
export function generationReview(status: number, body: Record<string, unknown>): GenerationReview | null {
  if (status === 428 && body.error === 'generation_budget_acknowledgement_required') {
    return { key: 'budgetAcknowledged', message: String(body.message ?? 'Review budget usage.'), issues: [] };
  }
  const blocked = status === 409 && body.error === 'generation_preflight_blocked';
  if (!blocked && !(status === 428 && body.error === 'generation_preflight_review_required')) return null;
  const readiness = body.readiness as { probes?: GenerationReadinessProbe[] } | undefined;
  const issues = (Array.isArray(readiness?.probes) ? readiness.probes : []).filter(probe =>
    probe && ['warning', 'unknown', 'fail'].includes(probe.status) && typeof probe.summary === 'string');
  return {
    key: blocked ? null : 'preflightAcknowledged',
    message: blocked ? 'Generation blocked' : 'Review before generating',
    issues: issues.length ? issues : [{ id: 'review', label: 'Generation review', status: blocked ? 'fail' : 'unknown', severity: blocked ? 'blocking' : 'warning', summary: 'Review details are unavailable. Go back and retry.' }],
  };
}

export function issueAffectsBlock(issue: GenerationReadinessProbe, block: { block_id: string; properties: Record<string, unknown> }) {
  return issue.blockIds?.includes(block.block_id) || (typeof block.properties.reference_id === 'string' && issue.referenceIds?.includes(block.properties.reference_id)) || false;
}
