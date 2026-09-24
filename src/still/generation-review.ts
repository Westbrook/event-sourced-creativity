import type { GenerationReadinessProbe } from '../model/generation-readiness.ts';

export type GenerationReview = {
  inspection?:{documentId:string;preflightId:string};
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
  const readiness = body.readiness as { probes?: GenerationReadinessProbe[];documentId?:string;preflightId?:string } | undefined;
  const issues = (Array.isArray(readiness?.probes) ? readiness.probes : []).filter(probe =>
    probe && ['warning', 'unknown', 'fail'].includes(probe.status) && typeof probe.summary === 'string');
  return {
    ...(typeof readiness?.documentId==='string'&&typeof readiness.preflightId==='string'?{inspection:{documentId:readiness.documentId,preflightId:readiness.preflightId}}:{}),
    key: blocked ? null : 'preflightAcknowledged',
    message: blocked ? 'Generation blocked' : 'Review before generating',
    issues: issues.length ? issues : [{ id: 'review', label: 'Generation review', status: blocked ? 'fail' : 'unknown', severity: blocked ? 'blocking' : 'warning', summary: 'Review details are unavailable. Go back and retry.' }],
  };
}

export function issueAffectsBlock(issue: GenerationReadinessProbe, block: { block_id: string; properties: Record<string, unknown> }) {
  return issue.blockIds?.includes(block.block_id) || (typeof block.properties.reference_id === 'string' && issue.referenceIds?.includes(block.properties.reference_id)) || false;
}

/** Never attach the aggregate category union to an individual highlighted idea. */
export function issueBlockSummary(issue:GenerationReadinessProbe,blockId:string) {
  if(issue.id!=='context-safety')return issue.summary;
  const items=issue.sourceVerdicts?.filter(v=>v.kind==='fact'&&v.blockId===blockId&&v.flagged);
  if(!items?.length)return 'This idea was highlighted by the source advisory. Its individual categories were not recorded; the overall categories may come from other inputs.';
  const categories=[...new Set(items.flatMap(v=>v.categories))].sort();
  return `This idea’s isolated input was flagged${categories.length?`: ${categories.join(', ')}`:'; category unavailable'}. This does not identify a causal phrase or establish an image-provider refusal.`;
}
