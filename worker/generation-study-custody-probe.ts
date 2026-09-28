import type {WorkerEnv} from './runtime.ts';
import {consentHash,canonicalConsent} from './consequential-consent.ts';
import {memoryDerivationJsonUniqueKeys} from './memory-derivation-result.ts';
import {qualificationPrincipal,qualificationReadDb,qualificationResponse,QUALIFICATION_PATH,QUALIFICATION_TARGET,QUALIFICATION_EXPIRY,QUALIFICATION_ORIGIN} from './generation-study-qualification.ts';
export const CUSTODY_PROBE_PATH=QUALIFICATION_PATH+'/custody';
export const CUSTODY_PROBE_ID='p5-forma-r15-29b1d7f841b54f10a9e65a4c6b183e7d';
export const CUSTODY_PROBE_KEY='qualification/'+CUSTODY_PROBE_ID+'.txt';
export const CUSTODY_PROBE_BYTES=new TextEncoder().encode('FORMA P5 R15 synthetic custody only\n29b1d7f841b54f10a9e65a4c6b183e7d\n');
const hashBytes=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');
function denied():never{throw Error('custody_probe_unavailable');}
/** Separate write phase. Off by default; no database writes, list, caller keys,
 * provider transport or purchase authority. Operator must not replay put after deletion.
 * R2 does not expose conditional delete here: exclusive control of this unique key
 * must be accepted and verified; hash/metadata checks are not a concurrency lock. */
export async function handleStudyCustodyProbe(request:Request,env:WorkerEnv&{FORMA_GENERATION_CUSTODY_PROBE_ENABLED?:string}){
 if(env.FORMA_GENERATION_CUSTODY_PROBE_ENABLED!=='1')return qualificationResponse({status:'disabled',storageOperations:0});
 try{
  if(request.method==='GET'&&request.body===null){
   if(Date.now()>=Date.parse(QUALIFICATION_EXPIRY))denied();
   const read=qualificationReadDb(env.DB);await qualificationPrincipal(request,env,read.db);read.check();
   return new Response(CUSTODY_PROBE_PAGE,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'x-content-type-options':'nosniff'}});
  }
  if(Date.now()>=Date.parse(QUALIFICATION_EXPIRY)||request.method!=='POST'||request.headers.get('origin')!==QUALIFICATION_ORIGIN||request.headers.get('content-type')!=='application/json')denied();
  const reader=request.body?.getReader();if(!reader)denied();let raw='';let count=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const r=await reader!.read();if(r.done)break;count+=r.value.byteLength;if(count>64){void reader!.cancel().catch(()=>{});denied();}raw+=decoder.decode(r.value,{stream:true});}}finally{reader!.releaseLock();}raw+=decoder.decode();
  if(!memoryDerivationJsonUniqueKeys(raw))denied();const command=JSON.parse(raw);
  if(!command||Array.isArray(command)||Object.keys(command).join(',')!=='action'||!['put','read','delete'].includes(command.action))denied();
  const original=env.DB,read=qualificationReadDb(original),actor=await qualificationPrincipal(request,env,read.db);
  const owner=await consentHash(actor.userId),fingerprint=await consentHash(actor.authorizationSnapshot),sha256=await hashBytes(CUSTODY_PROBE_BYTES);
  const metadata={probe:CUSTODY_PROBE_ID,target:QUALIFICATION_TARGET,owner,sha256};
  const bucket=env.MEDIA,existing=await bucket.get(CUSTODY_PROBE_KEY);
  if(existing){
   const objectHeaders=new Headers();existing.writeHttpMetadata(objectHeaders);
   if(existing.size!==CUSTODY_PROBE_BYTES.length||canonicalConsent(existing.customMetadata)!==canonicalConsent(metadata)||objectHeaders.get('content-type')!=='text/plain')denied();
   // size checked before consuming; never read any other key or caller bytes.
   if(await hashBytes(new Uint8Array(await new Response(existing.body).arrayBuffer()))!==sha256)denied();
  }
  const after=await qualificationPrincipal(request,env,read.db);
  if(env.DB!==original||env.MEDIA!==bucket||after.userId!==actor.userId||await consentHash(after.authorizationSnapshot)!==fingerprint)denied();read.check();
  let result:unknown;
  if(command.action==='put'){
   if(existing)denied();
   const stored=await bucket.put(CUSTODY_PROBE_KEY,CUSTODY_PROBE_BYTES.buffer,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:metadata,httpMetadata:{contentType:'text/plain'}});
   if(!stored)denied();result={stored:true,bytes:CUSTODY_PROBE_BYTES.length,sha256,metadata};
  }else if(command.action==='read'){
   if(!existing)denied();result={originalBytesVerified:true,bytes:CUSTODY_PROBE_BYTES.length,sha256,metadata};
  }else{
   // An absent original is a useful cleanup acknowledgement; never re-create it.
   if(existing)await bucket.delete(CUSTODY_PROBE_KEY);
   if(await bucket.get(CUSTODY_PROBE_KEY)!==null)denied();result={originalExisted:!!existing,readNull:true,apiDeletionOnly:true,backupErasureProven:false};
  }
  return qualificationResponse({contract:'forma-p5-custody-probe-v1',action:command.action,key:CUSTODY_PROBE_KEY,result,metrics:read.metrics,retained:'No DB marker. Local/native receipts and source/version history remain. No automatic expiry deletion.'});
 }catch{return qualificationResponse({status:'denied',reason:'custody_probe_unavailable',inspectOriginalBeforeRecovery:true},409);}
}

// Fixed UI for a supported signed-in browser. No load-time API call, source editor,
// caller input, retry loop, or background job. Operator accounting still applies.
export const CUSTODY_PROBE_PAGE=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forma · P5 custody probe</title><h1>P5 custody probe</h1><p>Separate authorized write phase only. One fixed synthetic key; no generation. Each button sends one request. A failed or uncertain request stops this page; do not reload to retry.</p><button data-action="put">Put fixed object</button> <button data-action="read">Read original</button> <button data-action="delete">Delete original and verify absent</button><pre id="receipt" aria-live="polite">No request sent.</pre><script>
const buttons=[...document.querySelectorAll('button')],receipt=document.getElementById('receipt');
buttons.forEach(button=>button.addEventListener('click',async()=>{buttons.forEach(b=>b.disabled=true);try{const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:button.dataset.action}),redirect:'error',credentials:'same-origin'});const value=await r.json();receipt.textContent=JSON.stringify(value,null,2);if(r.ok&&value.result&&button.dataset.action!=='delete')buttons.filter(b=>b.dataset.action!=='put').forEach(b=>b.disabled=false);}catch{receipt.textContent='Uncertain request. Preserve evidence and use only separately accounted original recovery; do not replay put.';}}));
</script></html>`;
