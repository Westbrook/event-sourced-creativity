import type { DocumentJob } from '../model/document-jobs.ts';
import type { GenerationReview } from './generation-review.ts';

export function failureNotification(job: DocumentJob) {
  const format = job.kind === 'generate' || job.kind === 'preview' ? 'image' : String(job.result?.artifactKind ?? '');
  const edit = job.errorDetail?.category === 'safety' || job.errorDetail?.action === 'edit_request';
  return {
    key: `${job.jobId}:${job.attemptCount}:${job.errorDetail?.code ?? job.error ?? 'failed'}`,
    message: job.errorDetail?.message || job.error || 'Generation failed.',
    action: edit ? 'context' as const : format ? 'generation' as const : 'results' as const,
    label: edit ? 'Review context' : format ? 'Review generation' : 'View results',
    format,
  };
}

// Only admission's explicit acknowledgment contract can expose Continue.
// Dismissal never changes this contract or a generation's attempted state.
export const canContinueReview = (review: GenerationReview | null) => review?.key === 'budgetAcknowledged' || review?.key === 'preflightAcknowledged';
