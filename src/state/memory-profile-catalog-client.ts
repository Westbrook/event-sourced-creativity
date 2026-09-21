import { createMemoryPrivateRequest } from './memory-private-request.ts';
import { createMemoryDerivationClient,type DerivationResultView,type DerivationControl } from './memory-derivation-client.ts';
import { derivationId,derivationHash,derivationTime } from '../model/memory-derivation-policy.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { memoryDigest } from '../model/scoped-memory.ts';

export type MemoryProfileEntry={enrollment_id:string;enrollment_revision:number;owner_user_id:string;organization_id:string|null;project_access_id:string|null;project_id:string;document_id:string;job_id:string;through_sequence:number;state:'active'|'withdrawn';published_at:string;expires_at:string;scope_key:string};
export type MemoryProfilePage={validUntil:string;pageRevision:string;entries:MemoryProfileEntry[];nextAfter:string|null};
export type MemoryProfileReview={validUntil:string;entry:MemoryProfileEntry;items:DerivationResultView['items'];corrections:DerivationControl[];history?:DerivationResultView['history']};
const columns=['enrollment_id','enrollment_revision','owner_user_id','organization_id','project_access_id','project_id','document_id','job_id','through_sequence','state','published_at','expires_at'] as const;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v{if(!v)throw Error('memory_profile_response');}
const canonical=(v:unknown):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);
export function createMemoryProfileClient(transport:typeof fetch){
 const request=createMemoryPrivateRequest(transport,'memory-profile-catalog-v1');
 return {
  async page(signal:AbortSignal,after=''):Promise<MemoryProfilePage>{
   const clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});const v=await request({after},'profile-catalog',signal);check(v.controlMetadataOnly===true&&v.sourceContentRead===false&&v.automaticallyDerived===true&&v.completeProfile===false&&derivationTime(v.validUntil)&&Date.parse(v.validUntil)>Date.now()&&Date.parse(v.validUntil)<=Date.now()+30000&&derivationHash(v.pageRevision)&&Array.isArray(v.entries)&&v.entries.length<=16&&(v.nextAfter===null||derivationId(v.nextAfter)));
   check(v.entries.every((row:unknown)=>object(row)&&Object.keys(row).sort().join(',')===[...columns,'scope_key'].sort().join(',')&&[row.enrollment_id,row.owner_user_id,row.project_id,row.document_id].every(derivationId)&&Number.isSafeInteger(row.enrollment_revision)&&Number(row.enrollment_revision)>0&&derivationHash(row.job_id)&&Number.isSafeInteger(row.through_sequence)&&Number(row.through_sequence)>=0&&['active','withdrawn'].includes(String(row.state))&&derivationTime(row.published_at)&&derivationTime(row.expires_at)&&typeof row.scope_key==='string'&&row.scope_key.length<=4096&&(row.organization_id===null&&row.project_access_id===null||derivationId(row.organization_id)&&derivationId(row.project_access_id))));
   const rows=v.entries as MemoryProfileEntry[];check(new Set(rows.map(r=>r.enrollment_id)).size===rows.length&&rows.every((r,i)=>r.enrollment_id>(i?rows[i-1]!.enrollment_id:after))&&(v.nextAfter===null||rows.length===16&&v.nextAfter===rows.at(-1)!.enrollment_id));
   check(await memoryDigest(canonical(rows.map(row=>Object.fromEntries(columns.map(k=>[k,row[k]])))))===v.pageRevision);check(!signal.aborted&&clock.elapsed({wall:Date.now(),monotonic:performance.now()})<30000&&Date.parse(v.validUntil)>Date.now());return {validUntil:v.validUntil,pageRevision:v.pageRevision,entries:rows,nextAfter:v.nextAfter};
  },
  async inspect(entry:MemoryProfileEntry,signal:AbortSignal):Promise<MemoryProfileReview>{
   entry={...entry};check(!signal.aborted&&entry.state==='active'&&Date.parse(entry.expires_at)>Date.now());const clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});
   const custody=entry.organization_id?{kind:'organization' as const,organizationId:entry.organization_id,projectAccessId:entry.project_access_id!,ownerUserId:entry.owner_user_id}:{kind:'personal' as const};
   const controls=await createMemoryDerivationClient(transport).controls({projectId:entry.project_id,documentId:entry.document_id,expectedCustody:custody,enrollmentId:entry.enrollment_id,enrollmentRevision:entry.enrollment_revision},null,signal);
   check(controls.next===null&&!signal.aborted&&clock.elapsed({wall:Date.now(),monotonic:performance.now()})<30000);
   const view=await createMemoryDerivationClient(transport).inspectCurrentProfileResult({jobId:entry.job_id,purpose:'profile',scopeKey:entry.scope_key,expiresAt:entry.expires_at},signal);
   const revisions=new Map(controls.controls.filter(c=>c.purpose==='profile').map(c=>[c.lineageId,c.revision]));check(view.items.every(item=>item.lineageIds.every(id=>view.controlRevisions[id]===(revisions.get(id)??0))));
   const applicable=controls.controls.filter(c=>c.purpose==='profile'&&c.action!=='released'),blocked=new Set(applicable.map(c=>c.lineageId));
   const validUntil=new Date(Math.min(Date.parse(view.validUntil),Date.parse(controls.validUntil),Date.now()+30000-clock.elapsed({wall:Date.now(),monotonic:performance.now()}),...applicable.map(c=>Date.parse(c.expiresAt)))).toISOString();check(!signal.aborted&&Date.parse(validUntil)>Date.now());
   return {entry,validUntil,items:view.items.filter(item=>!item.lineageIds.some(id=>blocked.has(id))),corrections:applicable.filter(c=>c.action==='corrected'&&c.textAvailable&&c.correctionText!==null),...(view.history?{history:view.history}:{})};
  },
 };
}
