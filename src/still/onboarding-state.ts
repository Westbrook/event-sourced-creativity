import type { OnboardingStatus } from './onboarding-client.ts';

const duration=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const format=(ms:number)=>ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;
const reasons:Record<string,string>={
 not_configured:'Model not configured',impersonation:'Preview mode',cooldown:'Request cooldown',
 budget:'Allowance unavailable',unconfirmed:'Request unconfirmed',unavailable:'Request unavailable',
 usage_unconfirmed:'Usage unconfirmed',incomplete:'Incomplete response',invalid_response:'Invalid response',
};

/** Received means usable model wording, never an error response or local fallback. */
export function onboardingState(status:OnboardingStatus|undefined,enabled:boolean){
 const state=!enabled?'Not Requested':status?.source==='pending'?'Pending':status?.source==='model'?'Received':status?.reason?'Fallback':'Not Requested';
 const count=status?.tipCount;
 const note=!enabled?'Off':state==='Pending'?'Requesting tooltip copy':state==='Received'
  ?`${count===undefined?'Tooltip copy':`${count} ${count===1?'tooltip':'tooltips'}`} received`
  :state==='Fallback'?`Local wording · ${reasons[status?.reason??'']??'Generated copy unavailable'}`:'Local wording · waiting for a request';
 const ms=status?.requestElapsedMs??status?.elapsedMs;
 let timing:{label:string;description:string}|undefined;
 if(enabled&&state!=='Pending'&&duration(ms)){
  const cache=status?.cache,hit=cache?.status==='hit',shared=cache?.status==='shared';
  const suffix=hit?`${cache.layer} cache`:shared?'shared request':'total';
  const detail=[status?.requestElapsedMs!==undefined
   ?`${hit&&cache?.layer==='browser'?'Local cache delivery':'Browser delivery'}: ${format(ms)}. Excludes toolbar debounce.`
   :`Server processing: ${format(ms)}. Browser delivery was not measured.`];
  if(hit&&cache?.layer==='browser')detail.push('No network request.');
  else if(duration(status?.elapsedMs))detail.push(`Server processing: ${format(status.elapsedMs)}.`);
  if(status?.timing){const t=status.timing;detail.push(`Authorization: ${format(t.authorizationMs)}; preparation: ${format(t.preparationMs)}; cache read: ${format(t.cacheReadMs)}; allowance reservation: ${format(t.reservationMs)}; model response: ${format(t.providerMs)}; accounting: ${format(t.settlementMs)}; cache write: ${format(t.cacheWriteMs)}. Cache source: ${t.cacheSource}.`);}
  if(cache){detail.push(`${cache.layer} cache: ${cache.status}.`);if(duration(cache.originalLatencyMs))detail.push(`Original computation: ${format(cache.originalLatencyMs)}.`);}
  timing={label:`${format(ms)} ${suffix}`,description:detail.join(' ')};
 }
 return {state,note,timing};
}
