import type { DocumentJob } from '../model/document-jobs.ts';
import { generationActive, generationFormat } from './results.ts';

export const generationNoticeKey = (job: DocumentJob) => `${job.jobId}:${job.attemptCount}:${job.status}:${job.completedAt ?? ''}`;
const observable = (job: DocumentJob) => !!generationFormat(job) && !job.parentJobId && !job.memoryMode && job.sourceSurface !== 'native-image';

// Session-local observation, separate from the selected document's result list.
// Never announce historical completions just because a page was opened.
export class GenerationActivity {
  private watching = new Set<string>();
  private seen = new Set<string>();
  private pending = new Map<string, DocumentJob>();
  private active = new Set<string>();
  get hasActive() { return this.active.size > 0; }
  get notices() { return [...this.pending.values()]; }
  hasSeen(job: DocumentJob) { return this.seen.has(generationNoticeKey(job)); }
  clear() { this.watching.clear(); this.seen.clear(); this.pending.clear(); this.active.clear(); }
  observe(jobs: DocumentJob[], snapshot = true) {
    const visible = jobs.filter(observable), ids = new Set(visible.map(job => job.jobId));
    if (snapshot) {
      this.active.clear();
      // A fresh authorized feed owns visibility; do not retain a withdrawn notice.
      for (const id of this.pending.keys()) if (!ids.has(id)) this.pending.delete(id);
    }
    for (const job of visible) {
      if (generationActive(job)) {
        this.active.add(job.jobId); this.watching.add(job.jobId); this.pending.delete(job.jobId);
      } else {
        this.active.delete(job.jobId);
        if ((this.watching.has(job.jobId) || this.pending.has(job.jobId)) && !job.dismissedAt && !job.notifiedAt && !this.seen.has(generationNoticeKey(job))) this.pending.set(job.jobId, job);
        else this.pending.delete(job.jobId);
        this.watching.delete(job.jobId);
      }
    }
    while (this.watching.size > 120) this.watching.delete(this.watching.values().next().value!);
  }
  consume(job: DocumentJob) {
    this.pending.delete(job.jobId); this.seen.add(generationNoticeKey(job));
    while (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!);
  }
}

export function generationCompletion(job: DocumentJob) {
  const format = generationFormat(job), name = ({short_story:'story', model3d:'3D model', slides:'presentation'} as Record<string,string>)[format] ?? format.replaceAll('_',' ');
  return job.status === 'completed'
    ? {message:`Your ${name} is ready.`, label:`View ${name}`, variant:'success' as const}
    : job.status === 'partial'
      ? {message:`Your ${name} is partially complete.`, label:'Review generation', variant:'warning' as const}
      : job.status === 'canceled'
        ? {message:`Your ${name} generation was canceled.`, label:'Review generation', variant:'info' as const}
        : {message:job.errorDetail?.message || job.error || `Your ${name} couldn’t be generated.`, label:'Review generation', variant:'danger' as const};
}
