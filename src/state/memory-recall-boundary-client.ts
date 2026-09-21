import { memoryRecallBoundary, type MemoryRecallBoundary, type MemoryRecallRelation } from '../model/memory-recall-boundary.ts';
import { createMemoryPrivateRequest } from './memory-private-request.ts';
import { parseMemoryDerivationPresentation, MEMORY_DERIVATION_CONTROL } from './memory-derivation-client.ts';
import { derivationHash, derivationId, derivationTime } from '../model/memory-derivation-policy.ts';
import type { MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';

const version = 'memory-scope-recall-v1';
type Scope = { projectId: string; documentId: string };
export type RecallBoundaryView = { enrollmentId: string; enrollmentRevision: number; boundary: MemoryRecallBoundary; revision: string | null; validUntil: string; organizationAvailable?: boolean };
export type RecallSource = { ownerId?: string; enrollmentId: string; projectId: string; documentId: string } & MemoryRecallRelation;
type Row = Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw Error('memory-recall-response'); }
function object(value: unknown, keys: string[]): Row {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).sort().join(',') === [...keys].sort().join(',')); return value as Row;
}
function lifetime(value: unknown) { check(derivationTime(value) && Date.parse(value) > Date.now() && Date.parse(value) <= Date.now() + 30000); return value; }
function source(value: unknown): RecallSource {
  const organization=(value as Row)?.zoom==='organization'||Boolean(value&&typeof value==='object'&&Object.hasOwn(value,'ownerId'));
  check(!organization||['organization','project-tree'].includes(String((value as Row)?.zoom)));
  const row = object(value, ['enrollmentId','projectId','documentId','zoom','distance','weight',...(organization?['ownerId']:[])]);
  check(!organization||derivationId(row.ownerId));
  check([row.enrollmentId,row.projectId,row.documentId].every(derivationId) && memoryRecallBoundary(row.zoom) && row.zoom !== 'document'
    && (row.zoom === 'project-tree' ? Number(row.distance) >= 1 : row.distance === 0)
    && Number.isSafeInteger(row.distance) && Number(row.distance) >= 0 && Number(row.distance) <= 30
    && row.weight === (row.zoom === 'project' ? .7 : row.zoom === 'partition' ? .01 : row.zoom === 'organization' ? .0125 : .5 / (1 + Number(row.distance))));
  return row as RecallSource;
}
export function createRecallBoundaryClient(transport: typeof fetch = fetch) {
  const request=createMemoryPrivateRequest(transport,version);

  return {
    async boundary(scope:Scope,signal:AbortSignal){
      const value=await request(scope,'recall-boundary',signal),extended=Object.hasOwn(value,'organizationAvailable');
      const row=object(value,['version','enrollmentId','enrollmentRevision','boundary','revision','validUntil',...(extended?['organizationAvailable']:[])]);
      check((!extended||typeof row.organizationAvailable==='boolean')&&(row.boundary!=='organization'||row.organizationAvailable===true));
      check(derivationId(row.enrollmentId)&&Number.isSafeInteger(row.enrollmentRevision)&&Number(row.enrollmentRevision)>=1&&memoryRecallBoundary(row.boundary)
        &&(row.revision===null||typeof row.revision==='string'&&/^[a-f0-9-]{36}$/u.test(row.revision)));
      lifetime(row.validUntil);const {version:_version,...view}=row;return view as RecallBoundaryView;
    },
    async save(scope:Scope,view:RecallBoundaryView,boundary:MemoryRecallBoundary,signal:AbortSignal){
      check(memoryRecallBoundary(boundary)&&(boundary!=='organization'||view.organizationAvailable===true));lifetime(view.validUntil);
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
      const sources=row.sources.map(source);check(new Set(sources.map(s=>s.enrollmentId)).size===sources.length&&new Set(sources.map(s=>JSON.stringify([s.ownerId??null,s.projectId,s.documentId]))).size===sources.length
        &&sources.every((s,index)=>(s.ownerId!==undefined||s.projectId!==scope.projectId||s.documentId!==scope.documentId)&&(!index||sources[index-1].weight>=s.weight)));
      return {sources,validUntil:row.validUntil as string};
    },
    async inspect(scope:Scope,expected:RecallSource,purpose:MemoryDerivationPurpose,signal:AbortSignal){
      const row=object(await request(scope,'recall-scopes',signal,'GET',undefined,{source:expected.enrollmentId,purpose}),['version','source','presentation','validUntil','independentEvidence','completeHistory','presentationOnly']);
      const selected=source(row.source);check((['enrollmentId','ownerId','projectId','documentId','zoom','distance','weight'] as const).every(key=>selected[key]===expected[key])&&row.independentEvidence===false&&row.completeHistory===false&&row.presentationOnly===true);
      lifetime(row.validUntil);
      const p=row.presentation as Row,c=p?.candidate as Row;check(p&&c&&derivationHash(p.jobId)&&derivationTime(p.expiresAt)&&c.purpose===purpose&&typeof c.scopeKey==='string');
      const parsed=parseMemoryDerivationPresentation({...p,version:MEMORY_DERIVATION_CONTROL},{jobId:p.jobId as string,purpose,scopeKey:c.scopeKey,expiresAt:p.expiresAt as string});
      return {...parsed,validUntil:new Date(Math.min(Date.parse(row.validUntil as string),Date.parse(parsed.validUntil))).toISOString(),source:selected};
    },
  };
}
