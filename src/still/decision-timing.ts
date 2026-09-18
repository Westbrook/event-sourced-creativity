import type { ReceivedDecision } from './diagnostics.ts';

const duration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const format=(ms:number)=>ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;

/** A transport failure is not evidence of a Jev response. */
export function jevRequestState(received:ReceivedDecision|undefined,pending=false){
 if(pending)return 'Pending';
 if(!received||received.reason==='not_configured')return 'Not Requested';
 if(received.source==='jev'||received.trace?.passes?.some(p=>p.status==='answered'))return 'Received';
 return 'Failed';
}

/** Timing belongs to the received response, even when an older decision is displayed. */
export function decisionTiming(received:ReceivedDecision|undefined,pending=false) {
  if(pending||!duration(received?.requestElapsedMs))return null;
  const label=format(received.firstResponseMs??received.requestElapsedMs),phase=received.trace?.metrics.elapsedMs;
  const calls=received.trace?.passes.filter(p=>p.status!=='skipped')??[];
  const cached=received.cache?.status==='hit'||received.cache?.status==='shared';
  const detail=[`Request: ${format(received.requestElapsedMs)} (browser round trip, including data loading; excludes UI debounce).`];
  if(duration(received.firstResponseMs))detail.push(`First usable response: ${label}.`);
  if(received.cache)detail.push(`${received.cache.layer} cache: ${received.cache.status}. Original computation: ${format(received.cache.originalLatencyMs)}.`);
  if(cached&&received.cache?.layer==='browser')detail[0]=`Local cache delivery: ${label}. No new network request for a hit.`;
  if(cached)detail.push('The following timings describe the original decision, not a new Jev call.');
  if(received.preparation)detail.push(`Preparation: ${format(received.preparation.totalMs)}; session ${format(received.preparation.sessionMs)}, history ${format(received.preparation.elapsedMs)} (${received.preparation.source}, ${received.preparation.eventsRead} events read), selected content ${format(received.preparation.selectedContentMs)}.`);
  if(duration(phase))detail.push(`Decision phase: ${format(phase)}.`);
  if(calls.length&&calls.every(p=>duration(p.elapsedMs)))detail.push(`Jev calls: ${format(calls.reduce((sum,p)=>sum+p.elapsedMs,0))} across ${calls.length} ${calls.length===1?'call':'calls'}.`);
  const steps:Array<{label:string;value:string}>=[];
  if(cached)steps.push({label:'Delivery',value:format(received.requestElapsedMs)},{label:'Original computation',value:format(received.cache!.originalLatencyMs)});
  else{
    if(received.preparation)steps.push({label:'Preparation',value:format(received.preparation.totalMs)});
    for(const pass of calls)steps.push({label:pass.id==='assessment'?'Jev assessment':'Enrichment',value:format(pass.elapsedMs)});
    if(duration(received.delivery?.serverMs))steps.push({label:'Transport / client',value:format(Math.max(0,received.requestElapsedMs-received.delivery!.serverMs))});
    if(duration(received.firstResponseMs))steps.push({label:'First usable',value:format(received.firstResponseMs)});
    steps.push({label:jevRequestState(received)==='Failed'?'Failed':received.delivery?.stage==='initial'?'Elapsed':'Complete',value:format(received.requestElapsedMs)});
  }
  return {label,description:detail.join(' '),steps};
}
