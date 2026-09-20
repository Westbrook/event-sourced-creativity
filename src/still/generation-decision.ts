import { documentJobCanAcknowledgeSafety, documentJobFailure, type DocumentJob } from '../model/document-jobs.ts';
import { generationActive, generationFormat } from './results.ts';

/** Deliberately excludes prompts, provider URLs, receipts and private checkpoints. */
export function generationDecisionContext(job: DocumentJob | undefined) {
  if (!job) return undefined;
  const failure = documentJobFailure({...job,members:job.members??[]}), receipt = job.result?.generationReceipt as Record<string, unknown> | undefined;
  const acceptance = failure?.code === 'provider_submission_uncertain' || receipt?.provider_request_status === 'submission_unknown'
    ? 'unknown' : receipt?.provider_request_status === 'submitted' || !!job.result?.providerJobId
      ? 'confirmed' : receipt?.provider_request_status === 'not_submitted' ? 'not-submitted' : 'unknown';
  return {
    jobId: job.jobId, documentId: job.documentId, format: generationFormat(job), status: job.status,
    attempt: job.attemptCount, active: generationActive(job), failureCode: failure?.code ?? '', failureCategory: failure?.category ?? '',
    acceptance, needsAcknowledgement: documentJobCanAcknowledgeSafety(job),
    canStartNew: ['failed', 'canceled'].includes(job.status),
    refreshEffect: 'Read saved job status; does not reconcile a missing provider receipt or submit a request.',
    newGenerationEffect: 'Starts a separate paid request using current document context; does not resume the original.',
    mayDuplicateCharge: acceptance === 'unknown' && job.status === 'failed',
  };
}
export type GenerationDecisionContext = NonNullable<ReturnType<typeof generationDecisionContext>>;
