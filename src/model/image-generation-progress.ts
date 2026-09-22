import type { DocumentJob } from './document-jobs.ts';

/** These are observed job stages, never an estimate of provider completion. */
export function imageGenerationStatus(job: DocumentJob): 'Queued' | 'Preparing…' | 'Generating…' | 'Saving…' | null {
  if (!['generate', 'preview'].includes(job.kind) || !['queued', 'running', 'committing'].includes(job.status)) return null;
  if (job.status === 'committing' || ['storage', 'saving', 'committing'].includes(job.stage)) return 'Saving…';
  if (job.status === 'queued') return 'Queued';
  if (['preparing', 'compiling', 'planning', 'safety-review'].includes(job.stage)) return 'Preparing…';
  return 'Generating…';
}

const dimension = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 16384;

export function imageGenerationProgress(job: DocumentJob, documentId: string) {
  const status = imageGenerationStatus(job);
  if (!status || job.documentId !== documentId) return null;
  const result = job.result;
  const url = result?.partialMediaUrl;
  // Keep partials on the existing authenticated media route; never display a
  // retained partial as a successful image after failure, cancellation or retry.
  const mediaUrl = job.status !== 'queued' && typeof url === 'string' && /^\/api\/media\/[^/\s?#\\]+(?:\?partial=\d+)?$/.test(url) ? url : '';
  const partialSize = mediaUrl && dimension(result?.partialWidth) && dimension(result?.partialHeight);
  const width = partialSize ? result.partialWidth as number : job.imageSize?.width ?? 1024;
  const height = partialSize ? result.partialHeight as number : job.imageSize?.height ?? 1024;
  return { jobId: job.jobId, mediaUrl, width, height, status, sourceSurface: job.sourceSurface };
}

export type ImageGenerationProgress = NonNullable<ReturnType<typeof imageGenerationProgress>>;
