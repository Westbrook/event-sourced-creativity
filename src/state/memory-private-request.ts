import { beginMemoryPrivacyMutation } from './memory-privacy-mutation.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { derivationId } from '../model/memory-derivation-policy.ts';
import { memoryResourceSelector,type MemoryResourceSelector } from '../model/memory-resource-scope.ts';
type Scope={projectId:string;documentId:string}|MemoryResourceSelector|{after:string};
function check(value:unknown):asserts value{if(!value)throw Error('memory-private-response');}
/** Bounded same-origin, non-retrying transport. No draft or custody fields on the wire. */
export function createMemoryPrivateRequest(transport:typeof fetch,version:string){
  async function request(scope: Scope, route: 'recall-boundary'|'recall-scopes'|'assistant-context'|'resource-settings'|'resource-history'|'resource-enrollments'|'resource-opening'|'resource-assistant-context'|'resource-assistant'|'profile-catalog'|'scope-profile', signal: AbortSignal, method='GET', body?: unknown, query: Record<string,string>={}) {
    const resource=route.startsWith('resource-');
    check(route==='profile-catalog'?'after' in scope&&(scope.after===''||derivationId(scope.after)):route==='resource-enrollments'?'after' in scope&&(scope.after===''||/^[a-f0-9-]{36}$/.test(scope.after)):resource?memoryResourceSelector(scope):'documentId' in scope&&[scope.projectId,scope.documentId].every(derivationId));
    const elapsed=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()}),controller=new AbortController();
    // Select the wire fields explicitly: callers may also carry private custody
    // objects, UI ownership stamps or other native selection metadata.
    const url='/api/memory/'+route+'?'+new URLSearchParams({...('after' in scope?{after:scope.after}:'kind' in scope?{kind:scope.kind,projectId:scope.projectId,resourceId:scope.resourceId}:{projectId:scope.projectId,documentId:scope.documentId}),...query});
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let rejectInterrupted:(error:Error)=>void=()=>{};
    const interrupted=new Promise<never>((_resolve,reject)=>{rejectInterrupted=reject;});
    const cancel=()=>{controller.abort();void reader?.cancel().catch(()=>{});rejectInterrupted(Error('memory-recall-expired'));};
    const active=()=>check(!signal.aborted&&!controller.signal.aborted&&elapsed.elapsed({wall:Date.now(),monotonic:performance.now()})<30000);
    const timer=setTimeout(cancel,30000);signal.addEventListener('abort',cancel,{once:true});
    let finishMutation:(()=>void)|undefined;
    try {
      active();
      if(route==='recall-boundary'&&method!=='GET')finishMutation=beginMemoryPrivacyMutation();
      response=await Promise.race([transport(url,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
        headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}).then(value=>{
          if(controller.signal.aborted){void value.body?.cancel().catch(()=>{});throw Error('memory-recall-expired');}return value;
        }),interrupted]);
      active();check(response.ok&&response.headers.get('content-type')?.split(';')[0]==='application/json'&&response.body);
      const length=response.headers.get('content-length');check(length===null||/^\d+$/u.test(length)&&Number(length)<=524288);
      reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
      for(;;){const part=await Promise.race([reader.read(),interrupted]);active();if(part.done)break;bytes+=part.value.byteLength;
        check(bytes<=524288);text+=decoder.decode(part.value,{stream:true});}
      text+=decoder.decode();active();const value=JSON.parse(text);check(value?.version===version);return value;
    }finally{
      finishMutation?.();
      clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.abort();
      if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}else if(response?.body)void response.body.cancel().catch(()=>{});
    }
  }
  return request;
}
