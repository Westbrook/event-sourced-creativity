import { memoryDigest } from '../model/scoped-memory.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { createMemoryPrivateRequest } from './memory-private-request.ts';
import { memoryResourceIdentity,type MemoryResourceSelector,type MemoryResourceIdentity } from '../model/memory-resource-scope.ts';
import { type MemoryCustody } from '../model/memory-custody.ts';
export type ResourceEnrollment={id:string;revision:number;kind:'library'|'canvas';projectId:string;resourceId:string;learn:boolean;recall:boolean;background:boolean;retentionDays:number;timeZone:string;enrolledAt:string;expiresAt:string;throughSequence:number;nextDueAt:string;policyVersion:string};
export type ResourceControl=ResourceEnrollment&{ownerUserId:string;organizationId:string|null;projectAccessId:string|null};
export type ResourceSettings={scope:MemoryResourceIdentity;validUntil:string;policyVersion:string;enrollment:ResourceEnrollment|null};
export type ResourceHistory={scope:MemoryResourceIdentity;validUntil:string;openings?:{available:boolean;limitReached:boolean};windows:Array<{days:number;resourceOpenings?:number;counts:Record<string,number>}>;coverage:{since:string;throughSequence:number;currentHead:number;sourceLimitReached:boolean};sources:Array<{eventId:string;type:string;recordedAt:string}>};
export type ResourceContextPreview={snapshot:Record<string,unknown>;snapshotSha256:string;expectedContextId:string|null;history:ResourceHistory};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v{if(!v)throw Error('memory_resource_response');}
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function scopeCheck(value:unknown,scope:MemoryResourceSelector){check(record(value));const actual=memoryResourceIdentity(scope,value as MemoryResourceIdentity);check(actual&&JSON.stringify(actual)===JSON.stringify(Object.fromEntries(Object.keys(actual).map(k=>[k,value[k]]))));}
function deadline(value:unknown){check(time(value)&&Date.parse(value as string)>Date.now()&&Date.parse(value as string)<=Date.now()+30000);}
function historyView(v:Record<string,unknown>,scope:MemoryResourceSelector):ResourceHistory{scopeCheck(v.scope,scope);deadline(v.validUntil);
   check(v.method==='action-counts-not-semantic'&&v.independentPreferenceEvidence===false&&v.linkedContentRead===false&&Array.isArray(v.windows)&&v.windows.length===2&&v.windows.every((w:unknown,i:number)=>record(w)&&w.days===[7,30][i]&&record(w.counts)&&Object.entries(w.counts).every(([k,n])=>['edit','reuse','remove','restore','commit','inspect'].includes(k)&&Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=256)));
   const openings=v.openings;
   if(openings!==undefined)check(record(openings)&&openings.method==='resource-surface-open-not-content-consumption'&&openings.limit===256&&typeof openings.limitReached==='boolean'&&typeof openings.available==='boolean'&&v.windows.every((w:Record<string,unknown>)=>Number.isSafeInteger(w.resourceOpenings)&&Number(w.resourceOpenings)>=0&&Number(w.resourceOpenings)<=256&&(openings.available||w.resourceOpenings===0)));
   else check(v.windows.every((w:Record<string,unknown>)=>w.resourceOpenings===undefined));
   check(record(v.coverage)&&time(v.coverage.since)&&Number.isSafeInteger(v.coverage.throughSequence)&&Number.isSafeInteger(v.coverage.currentHead)&&v.coverage.completeFromStart===false&&v.coverage.sourceLimit===256&&typeof v.coverage.sourceLimitReached==='boolean');
   check(Array.isArray(v.sources)&&v.sources.length<=256&&v.sources.every((r:unknown)=>record(r)&&typeof r.eventId==='string'&&r.eventId.length<=240&&typeof r.type==='string'&&r.type.length<=80&&time(r.recordedAt)));return v as unknown as ResourceHistory;}
/** Explicit user control, bounded transport, no enrollment/capture on mount. */
export function createMemoryResourceClient(transport:typeof fetch){
 const opening=createMemoryPrivateRequest(transport,'memory-resource-opening-v1'),settings=createMemoryPrivateRequest(transport,'memory-resource-settings-v1'),history=createMemoryPrivateRequest(transport,'memory-resource-history-v1'),context=createMemoryPrivateRequest(transport,'memory-resource-context-v1');
 const client={
  async contextPreview(scope:MemoryResourceSelector,signal:AbortSignal):Promise<ResourceContextPreview>{
   const v=await context(scope,'resource-assistant-context',signal);check(v.policyVersion==='resource-assistant-context-v1'&&v.spendingAuthorized===false&&/^[a-f0-9]{64}$/.test(v.snapshotSha256)&&record(v.snapshot)&&(v.expectedContextId===null||typeof v.expectedContextId==='string'&&/^[a-f0-9-]{36}$/.test(v.expectedContextId)));
   const history=historyView(v.history,scope),snapshot=v.snapshot;
   check(snapshot.version===1&&snapshot.resourceKey===history.scope.resourceKey&&time(snapshot.asOf)&&Date.parse(snapshot.asOf)<=Date.now()&&time(snapshot.expiresAt)&&Date.parse(snapshot.expiresAt)>Date.now()&&Array.isArray(snapshot.sources)&&Array.isArray(snapshot.openings)&&snapshot.sources.length+snapshot.openings.length>0&&new TextEncoder().encode(JSON.stringify(snapshot)).byteLength<=60000);
   // Canonical hashing is data integrity, never a client-issued capability.
   const canonical=(v:unknown):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);
   check(await memoryDigest(canonical(snapshot))===v.snapshotSha256);
   return {snapshot,snapshotSha256:v.snapshotSha256,expectedContextId:v.expectedContextId,history};
  },
  async selectContext(scope:MemoryResourceSelector,signal:AbortSignal,preview:ResourceContextPreview){
   deadline(preview.history.validUntil);check(preview.history.scope.resourceKey===preview.snapshot.resourceKey);
   const v=await context(scope,'resource-assistant-context',signal,'PUT',{confirmation:'USE_RESOURCE_ACTIVITY_IN_ASSISTANT',snapshot:preview.snapshot,snapshotSha256:preview.snapshotSha256,expectedContextId:preview.expectedContextId});
   check(v.saved===true&&v.spendingAuthorized===false&&v.noAutomaticRetry===true&&typeof v.contextId==='string'&&/^[a-f0-9-]{36}$/.test(v.contextId)&&v.snapshotSha256===preview.snapshotSha256);return v.contextId as string;
  },
  async forgetContext(scope:MemoryResourceSelector,signal:AbortSignal,contextId:string){
   check(/^[a-f0-9-]{36}$/.test(contextId));const v=await context(scope,'resource-assistant-context',signal,'DELETE',{contextId,confirmation:'FORGET_RESOURCE_ASSISTANT_CONTEXT'});check(v.forgotten===true&&v.authoredResourcesPreserved===true&&v.noAutomaticRetry===true);
  },
  async observeOpening(scope:MemoryResourceSelector,signal:AbortSignal,openingId:string,current:()=>boolean){
   const clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});
   if(signal.aborted||!current())return false;
   const selected=await client.settings(scope,signal);
   const enrollment=selected.enrollment;
   // A fresh metadata read is not collection consent. The native POST still
   // independently checks the same user/resource enrollment and current rights.
   if(signal.aborted||!current()||clock.elapsed({wall:Date.now(),monotonic:performance.now()})>=30000
    ||Date.now()>=Date.parse(selected.validUntil)||!enrollment?.learn||Date.now()>=Date.parse(enrollment.expiresAt))return false;
   return client.opening(scope,signal,openingId);
  },
  async opening(scope:MemoryResourceSelector,signal:AbortSignal,openingId:string){
   check(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(openingId));
   const v=await opening(scope,'resource-opening',signal,'POST',{openingId});check(typeof v.recorded==='boolean'&&v.noAutomaticRetry===true);return v.recorded as boolean;
  },
  async controls(signal:AbortSignal,after=''):Promise<{validUntil:string;enrollments:ResourceControl[];nextAfter:string|null}>{
   const v=await settings({after},'resource-enrollments',signal);deadline(v.validUntil);check(v.controlMetadataOnly===true&&Array.isArray(v.enrollments)&&v.enrollments.length<=32&&(v.nextAfter===null||typeof v.nextAfter==='string'&&/^[a-f0-9-]{36}$/.test(v.nextAfter)));
   check(v.enrollments.every((r:unknown)=>record(r)&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/.test(r.id)&&Number.isSafeInteger(r.revision)&&Number(r.revision)>0&&['library','canvas'].includes(String(r.kind))&&typeof r.projectId==='string'&&typeof r.resourceId==='string'&&typeof r.ownerUserId==='string'&&[r.projectId,r.resourceId,r.ownerUserId].every(x=>(x as string).length>0&&(x as string).length<=240)&&time(r.expiresAt)&&(r.organizationId===null&&r.projectAccessId===null||typeof r.organizationId==='string'&&typeof r.projectAccessId==='string')));return v;
  },
  async settings(scope:MemoryResourceSelector,signal:AbortSignal):Promise<ResourceSettings>{
   const v=await settings(scope,'resource-settings',signal);scopeCheck(v.scope,scope);deadline(v.validUntil);check(v.policyVersion==='personal-resource-memory-v1');const e=v.enrollment;
   if(e!==null){check(record(e)&&typeof e.id==='string'&&e.id.length===36&&Number.isSafeInteger(e.revision)&&Number(e.revision)>0&&e.kind===scope.kind&&e.projectId===scope.projectId&&e.resourceId===scope.resourceId
    &&['learn','recall','background'].every(k=>typeof e[k]==='boolean')&&Number.isSafeInteger(e.retentionDays)&&Number(e.retentionDays)>0&&Number(e.retentionDays)<=30&&typeof e.timeZone==='string'&&time(e.expiresAt)&&time(e.enrolledAt)&&time(e.nextDueAt)&&Number.isSafeInteger(e.throughSequence)&&e.policyVersion===v.policyVersion);}
   return v;
  },
  async enable(scope:MemoryResourceSelector,signal:AbortSignal,input:{revision:number;background:boolean;retentionDays:number;timeZone:string;expectedCustody:MemoryCustody;confirmation:'ENABLE_RESOURCE_MEMORY'}){
   check(input.confirmation==='ENABLE_RESOURCE_MEMORY'&&Number.isSafeInteger(input.retentionDays)&&input.retentionDays>=1&&input.retentionDays<=30&&typeof input.background==='boolean');
   const v=await settings(scope,'resource-settings',signal,'PUT',{...input,learn:true,recall:true,policyVersion:'personal-resource-memory-v1',expiresAt:new Date(Date.now()+input.retentionDays*86400000-60000).toISOString()});check(v.saved===true&&v.refreshRequired===true);
  },
  async forget(scope:MemoryResourceSelector,signal:AbortSignal,enrollment:ResourceEnrollment){const v=await settings(scope,'resource-settings',signal,'DELETE',{id:enrollment.id,revision:enrollment.revision,confirmation:'FORGET_RESOURCE_MEMORY'});check(v.forgotten===true&&v.authoredResourcesPreserved===true);},
  async capture(scope:MemoryResourceSelector,signal:AbortSignal){const v=await history(scope,'resource-history',signal,'POST',{confirmation:'REVIEW_RESOURCE_ACTIVITY'});check(Number.isSafeInteger(v.captured)&&v.captured>=0&&v.captured<=64&&Number.isSafeInteger(v.throughSequence)&&typeof v.more==='boolean');return {captured:v.captured as number,more:v.more as boolean};},
  async recall(scope:MemoryResourceSelector,signal:AbortSignal):Promise<ResourceHistory>{const v=await history(scope,'resource-history',signal);return historyView(v,scope);
  },
 };
 return client;
}
