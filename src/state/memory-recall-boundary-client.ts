import { memoryRecallBoundary, type MemoryRecallBoundary, type MemoryRecallRelation } from '../model/memory-recall-boundary.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { parseMemoryDerivationPresentation, MEMORY_DERIVATION_CONTROL } from './memory-derivation-client.ts';
import { derivationHash, derivationId, derivationTime } from '../model/memory-derivation-policy.ts';
import type { MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';

const version = 'memory-scope-recall-v1';
type Scope = { projectId: string; documentId: string };
export type RecallBoundaryView = { enrollmentId: string; enrollmentRevision: number; boundary: MemoryRecallBoundary; revision: string | null; validUntil: string };
export type RecallSource = { enrollmentId: string; projectId: string; documentId: string } & MemoryRecallRelation;
type Row = Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw Error('memory-recall-response'); }
function object(value: unknown, keys: string[]): Row {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).sort().join(',') === [...keys].sort().join(',')); return value as Row;
}
function lifetime(value: unknown) { check(derivationTime(value) && Date.parse(value) > Date.now() && Date.parse(value) <= Date.now() + 30000); return value; }
function source(value: unknown): RecallSource {
  const row = object(value, ['enrollmentId','projectId','documentId','zoom','distance','weight']);
  check([row.enrollmentId,row.projectId,row.documentId].every(derivationId) && memoryRecallBoundary(row.zoom) && row.zoom !== 'document'
    && (row.zoom === 'project-tree' ? Number(row.distance) >= 1 : row.distance === 0)
    && Number.isSafeInteger(row.distance) && Number(row.distance) >= 0 && Number(row.distance) <= 30
    && row.weight === (row.zoom === 'project' ? .7 : row.zoom === 'partition' ? .01 : .5 / (1 + Number(row.distance))));
  return row as RecallSource;
}
export function createRecallBoundaryClient(transport: typeof fetch = fetch) {
  async function request(scope: Scope, route: 'recall-boundary'|'recall-scopes', signal: AbortSignal, method='GET', body?: unknown, query: Record<string,string>={}) {
    check([scope.projectId,scope.documentId].every(derivationId));
    const elapsed=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()}),controller=new AbortController();
    // Select the wire fields explicitly: callers may also carry private custody
    // objects, UI ownership stamps or other native selection metadata.
    const url='/api/memory/'+route+'?'+new URLSearchParams({projectId:scope.projectId,documentId:scope.documentId,...query});
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let rejectInterrupted:(error:Error)=>void=()=>{};
    const interrupted=new Promise<never>((_resolve,reject)=>{rejectInterrupted=reject;});
    const cancel=()=>{controller.abort();void reader?.cancel().catch(()=>{});rejectInterrupted(Error('memory-recall-expired'));};
    const active=()=>check(!signal.aborted&&!controller.signal.aborted&&elapsed.elapsed({wall:Date.now(),monotonic:performance.now()})<30000);
    const timer=setTimeout(cancel,30000);signal.addEventListener('abort',cancel,{once:true});
    try {
      active();
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
      clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.abort();
      if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}else if(response?.body)void response.body.cancel().catch(()=>{});
    }
  }

  return {
    async boundary(scope:Scope,signal:AbortSignal){
      const row=object(await request(scope,'recall-boundary',signal),['version','enrollmentId','enrollmentRevision','boundary','revision','validUntil']);
      check(derivationId(row.enrollmentId)&&Number.isSafeInteger(row.enrollmentRevision)&&Number(row.enrollmentRevision)>=1&&memoryRecallBoundary(row.boundary)
        &&(row.revision===null||typeof row.revision==='string'&&/^[a-f0-9-]{36}$/u.test(row.revision)));
      lifetime(row.validUntil);const {version:_version,...view}=row;return view as RecallBoundaryView;
    },
    async save(scope:Scope,view:RecallBoundaryView,boundary:MemoryRecallBoundary,signal:AbortSignal){
      check(memoryRecallBoundary(boundary));lifetime(view.validUntil);
      const row=object(await request(scope,'recall-boundary',signal,'PUT',{version,enrollmentId:view.enrollmentId,enrollmentRevision:view.enrollmentRevision,
        revision:view.revision,boundary,confirmation:'CHANGE_RECALL_BOUNDARY'}),['version','saved','refreshRequired']);
      check(row.saved===true&&row.refreshRequired===true);
    },
    async reset(scope:Scope,signal:AbortSignal){
      const row=object(await request(scope,'recall-boundary',signal,'DELETE',{confirmation:'RESET_RECALL_BOUNDARY'}),['version','saved','refreshRequired']);check(row.saved===true&&row.refreshRequired===true);
    },
    async sources(scope:Scope,signal:AbortSignal){
      const row=object(await request(scope,'recall-scopes',signal),['version','sources','validUntil','complete']);
      check(row.complete===true&&Array.isArray(row.sources)&&row.sources.length<=32);lifetime(row.validUntil);
      const sources=row.sources.map(source);check(new Set(sources.map(s=>s.enrollmentId)).size===sources.length&&new Set(sources.map(s=>JSON.stringify([s.projectId,s.documentId]))).size===sources.length
        &&sources.every((s,index)=>(s.projectId!==scope.projectId||s.documentId!==scope.documentId)&&(!index||sources[index-1].weight>=s.weight)));
      return {sources,validUntil:row.validUntil as string};
    },
    async inspect(scope:Scope,expected:RecallSource,purpose:MemoryDerivationPurpose,signal:AbortSignal){
      const row=object(await request(scope,'recall-scopes',signal,'GET',undefined,{source:expected.enrollmentId,purpose}),['version','source','presentation','validUntil','independentEvidence','completeHistory','presentationOnly']);
      const selected=source(row.source);check((['enrollmentId','projectId','documentId','zoom','distance','weight'] as const).every(key=>selected[key]===expected[key])&&row.independentEvidence===false&&row.completeHistory===false&&row.presentationOnly===true);
      lifetime(row.validUntil);
      const p=row.presentation as Row,c=p?.candidate as Row;check(p&&c&&derivationHash(p.jobId)&&derivationTime(p.expiresAt)&&c.purpose===purpose&&typeof c.scopeKey==='string');
      const parsed=parseMemoryDerivationPresentation({...p,version:MEMORY_DERIVATION_CONTROL},{jobId:p.jobId as string,purpose,scopeKey:c.scopeKey,expiresAt:p.expiresAt as string});
      return {...parsed,validUntil:new Date(Math.min(Date.parse(row.validUntil as string),Date.parse(parsed.validUntil))).toISOString(),source:selected};
    },
  };
}
