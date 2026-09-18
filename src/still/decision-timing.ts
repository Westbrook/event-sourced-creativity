import type { ReceivedDecision } from './diagnostics.ts';

const duration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const format=(ms:number)=>ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;

/** Timing belongs to the received response, even when an older decision is displayed. */
export function decisionTiming(received:ReceivedDecision|undefined,pending=false) {
  if(pending||!duration(received?.requestElapsedMs))return null;
  const label=format(received.requestElapsedMs),phase=received.trace?.metrics.elapsedMs;
  const calls=received.trace?.passes.filter(p=>p.status!=='skipped')??[];
  const detail=[`Request: ${label} (browser round trip, including data loading; excludes UI debounce).`];
  if(duration(phase))detail.push(`Decision phase: ${format(phase)}.`);
  if(calls.length&&calls.every(p=>duration(p.elapsedMs)))detail.push(`Jev calls: ${format(calls.reduce((sum,p)=>sum+p.elapsedMs,0))} across ${calls.length} ${calls.length===1?'call':'calls'}.`);
  return {label,description:detail.join(' ')};
}
