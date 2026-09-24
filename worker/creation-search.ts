import {withinSignal} from './creation-provider-http.ts';
import { CREATION_SEARCH_BUDGETS as B, type CreationIndexCoverage, type CreationSearchCandidate, type CreationSearchKind, type CreationSearchPartition, type CreationSearchRequest, type CreationSearchResponse } from '../src/model/creation-search.ts';
import { decisionHash } from './still-decision-store.ts';

export interface IndexedCreationIdentity { id: string; projectId: string; custody: string; kind: CreationSearchKind; revision: string; contentHash: string; }
export interface CreationSearchHit extends IndexedCreationIdentity { rank: number; relevance?:number; passage?:{start:number;end:number}; }
export interface HydratedCreationCandidate extends IndexedCreationIdentity { title: string; text: string; type?:string; locations: CreationSearchCandidate['locations']; passage?:{start:number;end:number}; }
export interface CreationSearchIndex {
  lexical(partition: CreationSearchPartition, query: string, limit: number, signal: AbortSignal): Promise<CreationSearchHit[]>;
  /** Discards stale external-vector IDs and tombstones before any protected hydration. */
  current(partition: CreationSearchPartition, candidates: CreationSearchHit[], signal: AbortSignal): Promise<CreationSearchHit[]>;
  coverage(partition: CreationSearchPartition): Promise<CreationIndexCoverage>;
}
export interface CreationLearnedSearch {
  readonly modelVersion: string;
  /** An independent learned index: input must never be the lexical shortlist. */
  query(partition: CreationSearchPartition, query: string, limit: number, signal: AbortSignal): Promise<CreationSearchHit[]>;
}
export interface CreationIdentityReranker {
  readonly modelVersion: string;
  readonly custodyBatch?: boolean;
  rank(partition: CreationSearchPartition, query: string, candidates: HydratedCreationCandidate[], signal: AbortSignal): Promise<Array<{ id: string; projectId?:string; relevant: boolean; rank: number; evidence: string }>>;
}
export interface CreationSearchAuthority {
  /** Re-resolve current actor permissions and policy. Return false if any bound epoch changed. */
  authorize(principal: string, partition: CreationSearchPartition): Promise<boolean>;
  /** Must freshly authorize each canonical ID/revision. Undefined means deleted, stale or denied. */
  hydrate(principal: string, partition: CreationSearchPartition, hit: IndexedCreationIdentity): Promise<HydratedCreationCandidate | undefined>;
  permitsProvider(partition: CreationSearchPartition, modelVersion: string): boolean;
}
export interface CreationSearchInput {
  principal: string;
  request: CreationSearchRequest;
  entryKind: 'project' | 'document' | 'idea';
  /** Server-derived scope only. A new Project is account Open-only. */
  projectId?: string;
  partitions: CreationSearchPartition[];
  partitionsComplete: boolean;
  index: CreationSearchIndex;
  authority: CreationSearchAuthority;
  learned?: CreationLearnedSearch;
  reranker?: CreationIdentityReranker;
  signal?: AbortSignal;
}
const identity = (v: IndexedCreationIdentity) => JSON.stringify([v.custody, v.projectId, v.kind, v.id]);
const same = (a: IndexedCreationIdentity, b: IndexedCreationIdentity) => identity(a) === identity(b) && a.revision === b.revision && a.contentHash === b.contentHash;
/** All cache dimensions are explicit. Cache consumers must STILL freshly authorize returned IDs. */
export function creationSearchCacheKey(input: CreationSearchInput) {
  return decisionHash({ principal: input.principal, scope: input.entryKind === 'project' ? 'account' : input.projectId, partitions: input.partitions, draft: input.request.draftId, draftRevision: input.request.draftRevision, queryRevision: input.request.queryRevision, query: input.request.query, semantic: input.learned?.modelVersion ?? null, rerank: input.reranker?.modelVersion ?? null, version: 'creation-search-v19-1' });
}
export async function searchCreationContent(input: CreationSearchInput): Promise<CreationSearchResponse> {
 const signal=input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(B.timeoutMs)]):AbortSignal.timeout(B.timeoutMs);
 try{return await withinSignal(searchWithinDeadline({...input,signal}),signal);}catch(error){if(!signal.aborted)throw error;return {schemaVersion:1,draftId:input.request.draftId,draftRevision:input.request.draftRevision,queryRevision:input.request.queryRevision,scope:input.entryKind==='project'?'account':'project',...(input.entryKind==='project'?{}:{projectId:input.projectId}),candidates:[],coverage:[],mode:'unavailable',partial:true,definitiveNoMatch:false,notices:['Search reached its time limit. Try a more specific description.']};}
}
async function searchWithinDeadline(input: CreationSearchInput): Promise<CreationSearchResponse> {
  const { request, authority, index } = input;
  const notices = new Set<string>();
  let partial = !input.partitionsComplete || input.partitions.length > B.partitions;
  const response: CreationSearchResponse = { schemaVersion: 1, draftId: request.draftId, draftRevision: request.draftRevision, queryRevision: request.queryRevision, scope: input.entryKind === 'project' ? 'account' : 'project', ...(input.entryKind === 'project' ? {} : { projectId: input.projectId }), candidates: [], coverage: [], mode: 'unavailable', partial, definitiveNoMatch: false, notices: [] };
  if (!request.query.trim()) return response;
  if (input.entryKind !== 'project' && !input.projectId) throw new Error('A server-authorized Project is required for scoped discovery.');
  const signal = input.signal!;
  const partitions: CreationSearchPartition[] = [];
  const seenPartitions = new Set<string>();
  for (const p of [...input.partitions].sort((a,b)=>JSON.stringify([a.custody,a.projectId]).localeCompare(JSON.stringify([b.custody,b.projectId]))).slice(0, B.partitions)) {
    const key = JSON.stringify([p.custody,p.projectId]);
    if (seenPartitions.has(key)) continue;
    seenPartitions.add(key);
    if (input.entryKind !== 'project' && p.projectId !== input.projectId) continue;
    signal.throwIfAborted();
    if (await authority.authorize(input.principal, p)) partitions.push(p); else { partial = true; notices.add('Some sources are no longer accessible.'); }
  }
  let lexicalHealthy = false, semanticHealthy = !!input.learned, rankHealthy = !!input.reranker;
  const groups = await Promise.all(partitions.map(async p => {
    let lexical: CreationSearchHit[] = [], semantic: CreationSearchHit[] = [];
    const [lex, sem, cov] = await Promise.allSettled([
      index.lexical(p, request.query, B.lexical, signal),
      input.learned && authority.permitsProvider(p, input.learned.modelVersion) ? input.learned.query(p, request.query, B.semantic, signal) : Promise.reject(new Error('Semantic retrieval is not configured or permitted in this custody partition.')),
      index.coverage(p),
    ]);
    if (lex.status === 'fulfilled') { lexical = lex.value.slice(0, B.lexical); lexicalHealthy = true; } else { partial = true; notices.add('Lexical index unavailable for some sources.'); }
    if (sem.status === 'fulfilled') semantic = sem.value.slice(0, B.semantic); else { semanticHealthy = false; partial = true; notices.add('Semantic retrieval unavailable; lexical-only suggestions may miss related content.'); }
    if (cov.status === 'fulfilled') {
      response.coverage.push(cov.value);
      if (!cov.value.backfillComplete || cov.value.expected === null || cov.value.lexical < cov.value.expected || cov.value.semantic < cov.value.expected) { partial = true; notices.add('Search indexing is incomplete.'); }
    } else { partial = true; notices.add('Search index coverage is unavailable.'); }
    // Treat index/provider IDs as untrusted. No other custody or Project enters hydration.
    const scoped = (hits: CreationSearchHit[]) => hits.filter(h => h.projectId === p.projectId && h.custody === p.custody && (input.entryKind === 'project' || h.kind !== 'project') && (input.entryKind !== 'idea' || h.kind === 'idea'));
    return { p, lexical: scoped(lexical), semantic: scoped(semantic) };
  }));
  const union = new Map<string, { hit: CreationSearchHit; score: number; partition: CreationSearchPartition }>();
  for(const group of groups)for(const pool of [group.lexical,group.semantic])for(const hit of pool){
    const key=identity(hit),existing=union.get(key),score=1/(61+Math.max(0,hit.rank));
    if(existing){existing.score+=score;if(hit.passage&&same(hit,existing.hit))existing.hit={...existing.hit,passage:hit.passage,relevance:Math.max(existing.hit.relevance??0,hit.relevance??0)};}else union.set(key,{hit,score,partition:group.p});
  }
  const relevance=(hit:CreationSearchHit)=>Number.isFinite(hit.relevance)?hit.relevance!:0;
  const shortlisted=[...union.values()].sort((a,b)=>relevance(b.hit)-relevance(a.hit)||b.score-a.score||identity(a.hit).localeCompare(identity(b.hit))).slice(0,B.hydrate);
  if(union.size>B.hydrate||groups.some(g=>g.lexical.length===B.lexical||g.semantic.length===B.semantic)){partial=true;notices.add('Candidate coverage is limited; a more specific description can reveal other matches.');}
  const hydrated = await Promise.all(partitions.map(async p => {
    if (!await authority.authorize(input.principal, p)) { partial = true; return { p, candidates: [] }; }
    const requested = shortlisted.filter(v => v.partition === p).map(v => v.hit);
    let current: CreationSearchHit[] = [];
    try { current = await index.current(p, requested, signal); } catch { partial = true; }
    const candidates: HydratedCreationCandidate[] = [];
    for (const hit of current) {
      if (!requested.some(r => same(r,hit))) continue;
      const value = await authority.hydrate(input.principal, p, hit);
      if (value && same(value,hit)) candidates.push({...value,...(hit.passage?{passage:hit.passage}:{})}); else partial = true;
    }
    if (current.length !== requested.length) { partial = true; notices.add('Changed sources are being reindexed.'); }
    return { p, candidates };
  }));
  const rankGroups=input.reranker?.custodyBatch?[...hydrated.reduce((map,group)=>{const key=JSON.stringify([group.p.custody,group.p.providerPolicy,group.p.permissionEpoch]);const prior=map.get(key);if(prior)prior.candidates.push(...group.candidates);else map.set(key,{p:group.p,candidates:[...group.candidates]});return map;},new Map<string,typeof hydrated[number]>()).values()]:hydrated;
  const ranked = await Promise.all(rankGroups.map(async ({p,candidates}) => {
    if (!candidates.length) return [];
    const partitionFor=(c:HydratedCreationCandidate)=>partitions.find(v=>v.projectId===c.projectId&&v.custody===c.custody)!;
    for(const c of candidates)if(!await authority.authorize(input.principal,partitionFor(c))){partial=true;return [];}
    signal.throwIfAborted();
    // Re-read each canonical revision immediately before any provider disclosure.
    for(const candidate of candidates){const current=await authority.hydrate(input.principal,partitionFor(candidate),candidate);if(!current||!same(current,candidate)){partial=true;return [];}}
    if (input.reranker && authority.permitsProvider(p,input.reranker.modelVersion)) {
      try {
        const ranks = await input.reranker.rank(p,request.query,candidates,signal);
        if(!Array.isArray(ranks)||ranks.some(r=>!r||typeof r.relevant!=='boolean'||!Number.isFinite(r.rank)||!candidates.some(c=>c.id===r.id&&(!r.projectId||c.projectId===r.projectId))||r.relevant&&(typeof r.evidence!=='string'||!r.evidence.trim()||!candidates.find(c=>c.id===r.id&&(!r.projectId||c.projectId===r.projectId))!.text.includes(r.evidence))))throw new Error('creation_rerank_evidence_invalid');
        return ranks.filter(r => r.relevant && Number.isFinite(r.rank)).flatMap(r => {
          const candidate = candidates.find(c => c.id === r.id && (!r.projectId || c.projectId === r.projectId));
          // Explanations are exact substrings of hydrated evidence, not invented model claims.
          return candidate && r.evidence.trim() && candidate.text.includes(r.evidence) ? [{ candidate, p:partitionFor(candidate), rank: r.rank, reason: r.evidence.slice(0,240) }] : [];
        });
      } catch { rankHealthy = false; partial = true; notices.add('Relevance assessment is unavailable. Showing lexical suggestions.'); }
    } else { rankHealthy = false; partial = true; notices.add('Relevance assessment is not configured or permitted.'); }
    // Honest degraded lexical suggestions exclude semantic-only guesses, with grounded snippets.
    const lexicalKeys = new Set(groups.filter(g => g.p.custody === p.custody && candidates.some(c=>c.projectId===g.p.projectId)).flatMap(g => g.lexical).map(identity));
    return candidates.filter(c => lexicalKeys.has(identity(c))).map((candidate,rank) => ({candidate,p:partitionFor(candidate),rank,reason:candidate.text.slice(0,240)}));
  }));
  const accepted = new Set<string>();
  for (const value of ranked.flat().sort((a,b)=>a.rank-b.rank||Number(b.candidate.kind==='idea')-Number(a.candidate.kind==='idea')||(union.get(identity(b.candidate))?.score??0)-(union.get(identity(a.candidate))?.score??0)||identity(a.candidate).localeCompare(identity(b.candidate)))) {
    if (response.candidates.length >= B.results) break;
    const {candidate,p,reason} = value, key = identity(candidate);
    if (accepted.has(key)) continue;
    // This is a fresh check, so cache TTL or a earlier model call cannot preserve revoked snippets.
    if (!await authority.authorize(input.principal,p)) { partial = true; continue; }
    const current = await authority.hydrate(input.principal,p,candidate);
    if (!current || !same(current,candidate)) { partial = true; continue; }
    accepted.add(key);
    response.candidates.push({ id:candidate.id,projectId:candidate.projectId,kind:candidate.kind,revision:candidate.revision,contentHash:candidate.contentHash,title:current.title,locations:current.locations,reason,action:input.entryKind==='project'?'open':'open-or-use' });
  }
  response.mode = semanticHealthy && lexicalHealthy ? 'hybrid' : lexicalHealthy ? 'lexical-only' : 'unavailable';
  response.partial = partial;
  response.definitiveNoMatch = partitions.length>0 && !response.candidates.length && !partial && semanticHealthy && lexicalHealthy && rankHealthy;
  if (!input.partitionsComplete || input.partitions.length > B.partitions) notices.add('Account coverage is partial; some Project partitions were not searched.');
  response.notices = [...notices];
  return response;
}
