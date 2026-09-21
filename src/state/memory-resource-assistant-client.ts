import { memoryResourceNextQuestions } from '../model/memory-resource-next-questions.ts';
import { createMemoryPrivateRequest } from './memory-private-request.ts';
import { memoryResourceIdentity,type MemoryResourceSelector } from '../model/memory-resource-scope.ts';

export type ResourceAssistantQuote={executionId:string;validUntil:string;quote:{bindingHash:string;expiresAt:string;maximumMicrousd:number;models:string[];privateInput:unknown;canExecute:boolean;status:string}};
export type ResourceAssistantResult={executionId:string;status:string;validUntil:string;asOf:string;result?:{reply:string;nextQuestions?:string[];mode:'private-review';independentEvidence:false}};
export type ResourceAssistantRun={execution_id:string;state:'active'|'retired';created_at:string;expires_at:string;status:string;owner_user_id:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const status=(v:unknown)=>['quoted','reserved','completed','failed','uncertain','canceled','expired'].includes(String(v));
function check(v:unknown):asserts v{if(!v)throw Error('resource_assistant_response');}
function deadline(v:unknown):asserts v is string{check(time(v)&&Date.parse(v)>Date.now()&&Date.parse(v)<=Date.now()+30000);}
/** Explicit, bounded operations. Recovery never dispatches another model call. */
export function createResourceAssistantClient(transport:typeof fetch){
 const request=createMemoryPrivateRequest(transport,'resource-memory-assistant-v1');
 const call=async(scope:MemoryResourceSelector,signal:AbortSignal,body:Record<string,unknown>)=>{const v=await request(scope,'resource-assistant',signal,'POST',body);check(v.noAutomaticRetry===true);return v;};
 return {
  async quote(scope:MemoryResourceSelector,signal:AbortSignal,contextId:string,question:string,locale:string):Promise<ResourceAssistantQuote>{
   check(id(contextId)&&question.trim()&&question.isWellFormed()&&Array.from(question).length<=2000&&['en','fr','ar','ja'].includes(locale));
   const v=await call(scope,signal,{action:'quote',contextId,question,locale}),q=v.quote;deadline(v.validUntil);
   check(id(v.executionId)&&object(q)&&q.executionId===v.executionId&&typeof q.bindingHash==='string'&&/^[a-f0-9]{64}$/.test(q.bindingHash)&&time(q.expiresAt)&&q.operation==='assistant-specialist'&&q.projectId===scope.projectId&&q.documentId===''&&q.blockId===''&&q.canvasId===(scope.kind==='canvas'?scope.resourceId:null)&&q.publicQuery===''&&q.providerCalls===1&&q.searchCalls===0&&q.provider==='OpenAI'&&Array.isArray(q.models)&&q.models.length===1&&q.models[0]==='gpt-5.6-luna'&&Number.isSafeInteger(q.maximumMicrousd)&&Number(q.maximumMicrousd)>=0&&Number.isSafeInteger(q.maximumTokens)&&Number(q.maximumTokens)>0&&status(q.status)&&typeof q.canExecute==='boolean'&&typeof q.providerAvailable==='boolean'&&(q.availableMicrousd===null||Number.isSafeInteger(q.availableMicrousd)&&Number(q.availableMicrousd)>=0));
   check(object(q.privateInput)&&q.privateInput.question===question&&object(q.privateInput.resourceActivity)&&q.privateInput.resourceActivity.kind===scope.kind&&object(q.privateInput.modelRequest)&&q.privateInput.modelRequest.model==='gpt-5.6-luna'&&q.privateInput.modelRequest.store===false&&Array.isArray(q.privateInput.modelRequest.tools)&&q.privateInput.modelRequest.tools.length===0&&typeof q.privateInput.modelRequest.input==='string');
   if(q.canExecute)check(q.status==='quoted'&&q.providerAvailable&&Date.parse(q.expiresAt)>Date.now()&&q.availableMicrousd!==null&&Number(q.availableMicrousd)>=Number(q.maximumMicrousd));
   return v as ResourceAssistantQuote;
  },
  async read(scope:MemoryResourceSelector,signal:AbortSignal,action:'execute'|'retrieve'|'resume',executionId:string,approvedBindingHash?:string):Promise<ResourceAssistantResult>{
   check(id(executionId)&&(['retrieve','resume'].includes(action)||typeof approvedBindingHash==='string'&&/^[a-f0-9]{64}$/.test(approvedBindingHash)));
   const v=await call(scope,signal,{action,executionId,...(action==='execute'?{approvedBindingHash}:{})});deadline(v.validUntil);
   check(v.executionId===executionId&&status(v.status)&&time(v.asOf)&&Date.parse(v.asOf)<=Date.now()&&object(v.scope));const identity=memoryResourceIdentity(scope,v.scope as never);check(identity&&Object.entries(identity).every(([key,value])=>v.scope[key]===value));
   if(v.result!==undefined){check(v.status==='completed'&&object(v.result)&&Object.keys(v.result).sort().join(',')===['reply','mode','independentEvidence',...(Object.hasOwn(v.result,'nextQuestions')?['nextQuestions']:[])].sort().join(',')&&(!Object.hasOwn(v.result,'nextQuestions')||memoryResourceNextQuestions(v.result.nextQuestions)!==null)&&v.result.mode==='private-review'&&v.result.independentEvidence===false&&typeof v.result.reply==='string'&&v.result.reply.isWellFormed()&&Array.from(v.result.reply).length<=2400);}
   return v as ResourceAssistantResult;
  },
  async controls(scope:MemoryResourceSelector,signal:AbortSignal):Promise<{runs:ResourceAssistantRun[];more:boolean}>{
   const v=await call(scope,signal,{action:'controls'});check(v.accountingControlsOnly===true&&v.sourceContentRead===false&&typeof v.more==='boolean'&&Array.isArray(v.runs)&&v.runs.length<=16);
   check(v.runs.every((r:unknown)=>object(r)&&Object.keys(r).length===6&&id(r.execution_id)&&['active','retired'].includes(String(r.state))&&time(r.created_at)&&time(r.expires_at)&&status(r.status)&&typeof r.owner_user_id==='string'&&r.owner_user_id.length>0&&r.owner_user_id.length<=240));return {runs:v.runs,more:v.more};
  },
  async reconcile(scope:MemoryResourceSelector,signal:AbortSignal,executionId:string){check(id(executionId));const v=await call(scope,signal,{action:'reconcile',executionId});check(v.executionId===executionId&&v.accountingOnly===true&&v.providerCalled===false&&status(v.status));return v.status as string;},
 };
}
