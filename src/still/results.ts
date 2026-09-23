import { imageGenerationStatus } from '../model/image-generation-progress.ts';
import { generationOutcome } from './generation-outcome.ts';
import type { CreativeEvent, CreativeProjection } from '../model/events.ts';
import type { DocumentJob } from '../model/document-jobs.ts';

export const generationActive = (job:DocumentJob) => ['queued','running','committing'].includes(job.status);
export function generationFormat(job:DocumentJob):string {
  if(job.kind==='generate')return 'image';
  return job.kind==='render_document' && typeof job.result?.artifactKind==='string' ? job.result.artifactKind : '';
}
export function generationResult(job:DocumentJob,p:CreativeProjection,events:CreativeEvent[],includeDiscarded=false):string {
  if(job.documentId!==p.documentId)return '';
  const ids=new Set(Array.isArray(job.result?.appendedEventIds)?job.result.appendedEventIds:[]);
  const owned=events.filter(e=>e.correlationId===job.jobId||ids.has(e.eventId));
  const artifact=p.artifacts.find(a=>a.documentId===job.documentId&&(a.id===job.result?.artifactId||owned.some(e=>e.payload.artifact_id===a.id)));
  if(artifact)return artifact.id;
  return p.outputs.find(o=>(includeDiscarded||!o.discarded)&&o.documentId===job.documentId&&owned.some(e=>e.eventId===o.sourceEventId))?.id??'';
}
export function generationStatus(job:DocumentJob):string {
  if(job.status==='failed')return generationOutcome(job).title;
  const imageStatus=imageGenerationStatus(job);if(imageStatus)return imageStatus;
  return ({queued:'Queued',running:'Generating…',committing:'Saving…',completed:'Loading result…',partial:'Partially complete',failed:'Generation failed',canceled:'Canceled'})[job.status];
}
export function generationPreview(job:DocumentJob,p:CreativeProjection,events:CreativeEvent[]) {
  const plan=job.result?.artifactPlan as {title?:unknown}|undefined;
  const title=typeof plan?.title==='string'&&plan.title.trim()?plan.title.trim():p.documentTitle;
  const request=events.find(e=>e.type==='GenerationRequested'&&e.correlationId===job.jobId&&e.payload.document_id===job.documentId);
  const size=typeof request?.payload.provider_render_size==='string'?/^(\d{2,5})x(\d{2,5})$/.exec(request.payload.provider_render_size):null;
  const width=size?Number(size[1]):job.imageSize?.width??0,height=size?Number(size[2]):job.imageSize?.height??0;
  return {title,...(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=16384&&height<=16384?{width,height}:{})};
}
export type StillResult = {id:string;view:'artifact'|'generation';title:string;kind:string;url:string;sequence:number;width?:number|null;height?:number|null;job?:DocumentJob};
export function stillResults(p:CreativeProjection,jobs:DocumentJob[],events:CreativeEvent[]):StillResult[] {
  const pending:StillResult[]=jobs.filter(j=>j.documentId===p.documentId&&generationFormat(j)&&!generationResult(j,p,events,true)).map(job=>({
    id:job.jobId,view:'generation',title:generationPreview(job,p,events).title,kind:generationFormat(job),url:'',sequence:job.requestedSequence,job,
  }));
  const results:StillResult[]=[...pending,
    ...p.outputs.filter(o=>!o.discarded).map(o=>({id:o.id,view:'artifact' as const,title:o.title??'Image',kind:'image',url:o.mediaUrl??'',width:o.width,height:o.height,sequence:o.sequence})),
    ...p.artifacts.map(a=>({id:a.id,view:'artifact' as const,title:a.title,kind:a.kind,url:a.kind==='video'?a.mediaUrl??'':'',sequence:a.sequence})),
  ];
  return results.sort((a,b)=>b.sequence-a.sequence||((b.job?.requestedAt??'').localeCompare(a.job?.requestedAt??'')));
}
