import { createMemoryPrivateRequest } from './memory-private-request.ts';
import { parseMemoryDerivationPresentation, MEMORY_DERIVATION_CONTROL, type DerivationResultView } from './memory-derivation-client.ts';
import { derivationHash, derivationId, derivationTime, MEMORY_DERIVATION_PURPOSES, type MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';
import { memoryRecallBoundary } from '../model/memory-recall-boundary.ts';
const version='memory-assistant-context-v1';
type Scope={projectId:string;documentId:string};
type Row=Record<string,unknown>;
export type AssistantMemoryContextView={targetEnrollmentId:string;targetRevision:number;validUntil:string;
 context:null|{revision:string;state:'dismissed'|'unavailable';jobId:string}|{revision:string;state:'accepted';jobId:string;purpose:MemoryDerivationPurpose;expiresAt:string;
 source:{enrollmentId:string;projectId:string;documentId:string;zoom:string;distance:number;weight:number}};presentation:DerivationResultView|null};
const check=(value:unknown):void=>{if(!value)throw Error('memory-assistant-context-response');};
function object(value:unknown,keys:string[]):Row{check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));return value as Row;}
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const valid=(time:unknown)=>derivationTime(time)&&Date.parse(time)>Date.now()&&Date.parse(time)<=Date.now()+30000;
export function createAssistantMemoryContextClient(transport:typeof fetch=fetch){
 const request=createMemoryPrivateRequest(transport,version);
 return{
  async read(scope:Scope,signal:AbortSignal,controls=false):Promise<AssistantMemoryContextView>{
   const raw=await request(scope,'assistant-context',signal,'GET',undefined,controls?{controls:'1'}:{}),accepted=raw?.context?.state==='accepted';
   const row=object(raw,['version','targetEnrollmentId','targetRevision','validUntil','context','presentation',...(accepted?['independentEvidence','completeHistory']:[])]);
   check(derivationId(row.targetEnrollmentId)&&Number.isSafeInteger(row.targetRevision)&&Number(row.targetRevision)>=1&&valid(row.validUntil));
   if(row.context===null){check(row.presentation===null);return {...row,presentation:null} as AssistantMemoryContextView;}
   const c=object(row.context,['revision','state','jobId',...(accepted?['source','purpose','expiresAt']:[])]);
   check(uuid(c.revision)&&derivationHash(c.jobId));
   if(!accepted){check((c.state==='dismissed'||controls&&c.state==='unavailable')&&row.presentation===null);return {...row,presentation:null} as AssistantMemoryContextView;}
   check(row.independentEvidence===false&&row.completeHistory===false&&MEMORY_DERIVATION_PURPOSES.includes(c.purpose as MemoryDerivationPurpose)&&derivationTime(c.expiresAt)&&Date.parse(c.expiresAt as string)>Date.now());
   const source=object(c.source,['enrollmentId','projectId','documentId','zoom','distance','weight']);
   check([source.enrollmentId,source.projectId,source.documentId].every(derivationId)&&memoryRecallBoundary(source.zoom)&&Number.isSafeInteger(source.distance)&&Number(source.distance)>=0&&Number(source.distance)<=30);
   check(source.weight===(source.zoom==='document'?1:source.zoom==='project'?.7:source.zoom==='partition'?.01:.5/(1+Number(source.distance)))
    &&(source.zoom==='project-tree'?Number(source.distance)>0:source.distance===0)
    &&(source.zoom==='document'?(source.documentId===scope.documentId&&source.projectId===scope.projectId&&source.enrollmentId===row.targetEnrollmentId):source.enrollmentId!==row.targetEnrollmentId));
   const p=row.presentation as Row,candidate=p?.candidate as Row;check(p&&candidate&&p.jobId===c.jobId&&typeof candidate.scopeKey==='string'&&derivationTime(p.expiresAt));
   const parsed=parseMemoryDerivationPresentation({...p,version:MEMORY_DERIVATION_CONTROL},{jobId:c.jobId as string,purpose:c.purpose as MemoryDerivationPurpose,scopeKey:candidate.scopeKey as string,expiresAt:p.expiresAt as string});
   check(Date.parse(row.validUntil as string)<=Date.parse(parsed.validUntil)&&Date.parse(row.validUntil as string)<=Date.parse(c.expiresAt as string));
   return {...row,presentation:parsed} as AssistantMemoryContextView;
  },
  async accept(scope:Scope,view:AssistantMemoryContextView,jobId:string,signal:AbortSignal){
   check(valid(view.validUntil)&&derivationHash(jobId));
   const row=object(await request(scope,'assistant-context',signal,'PUT',{jobId,revision:view.context?.revision??null,targetEnrollmentId:view.targetEnrollmentId,targetRevision:view.targetRevision,confirmation:'ACCEPT_ASSISTANT_CONTEXT'}),['version','saved','refreshRequired']);
   check(row.saved===true&&row.refreshRequired===true);
  },
  async dismiss(scope:Scope,view:AssistantMemoryContextView,signal:AbortSignal){
   check(valid(view.validUntil)&&view.context&&uuid(view.context.revision));
   const row=object(await request(scope,'assistant-context',signal,'DELETE',{revision:view.context!.revision,confirmation:'DISMISS_ASSISTANT_CONTEXT'}),['version','saved','refreshRequired']);check(row.saved===true&&row.refreshRequired===true);
  },
 };
}
