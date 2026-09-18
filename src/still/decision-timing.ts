import type { ReceivedDecision } from './diagnostics.ts';

const duration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const format=(ms:number)=>ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;

/** Timing belongs to the received response, even when an older decision is displayed. */
export function decisionTiming(received:ReceivedDecision|undefined,pending=false) {
  if(pending||!duration(received?.requestElapsedMs))return null;
  const label=format(received.requestElapsedMs),phase=received.trace?.metrics.elapsedMs;
  const calls=received.trace?.passes.filter(p=>p.status!=='skipped')??[];
  const cached=received.cache?.status==='hit'||received.cache?.status==='shared';
  const detail=[`Request: ${label} (browser round trip, including data loading; excludes UI debounce).`];
  if(received.cache)detail.push(`${received.cache.layer} cache: ${received.cache.status}. Original computation: ${format(received.cache.originalLatencyMs)}.`);
  if(cached&&received.cache?.layer==='browser')detail[0]=`Local cache delivery: ${label}. No new network request for a hit.`;
  if(cached)detail.push('The following timings describe the original decision, not a new Jev call.');
  if(received.preparation)detail.push(`Preparation: ${format(received.preparation.totalMs)}; session ${format(received.preparation.sessionMs)}, history ${format(received.preparation.elapsedMs)} (${received.preparation.source}, ${received.preparation.eventsRead} events read), selected content ${format(received.preparation.selectedContentMs)}.`);
  if(duration(phase))detail.push(`Decision phase: ${format(phase)}.`);
  if(calls.length&&calls.every(p=>duration(p.elapsedMs)))detail.push(`Jev calls: ${format(calls.reduce((sum,p)=>sum+p.elapsedMs,0))} across ${calls.length} ${calls.length===1?'call':'calls'}.`);
  return {label,description:detail.join(' ')};
}
