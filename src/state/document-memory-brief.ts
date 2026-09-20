import { createLiveMemoryClient, MEMORY_POLICY } from './live-memory-client.ts';
import { createMemoryDerivationClient, type DerivationControl, type DerivationHistory, type DerivationResultItem, type DerivationScopeRequest } from './memory-derivation-client.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { MEMORY_DERIVATION_PURPOSES, type MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';
import { parseMemoryCustody, type MemoryCustody } from '../model/memory-custody.ts';
import { createRecallBoundaryClient, type RecallSource } from './memory-recall-boundary-client.ts';

export type DocumentMemoryBrief = Readonly<{ projectId:string;documentId:string;validUntil:string;
  completeHistory:false;independentEvidence:false;sections:readonly Readonly<{purpose:MemoryDerivationPurpose;
    corrections:readonly DerivationControl[];items:readonly DerivationResultItem[];jobId:string|null;history?:DerivationHistory;source?:RecallSource}>[] }>;
export type DocumentMemoryBriefLease = Readonly<{current:()=>DocumentMemoryBrief|null;retire:()=>void}>;
type Selection={projectId:string;documentId:string;custody:MemoryCustody};
const sample=()=>({monotonic:performance.now(),wall:Date.now()});

/** Automatic presentation only. Each private result is freshly checked by its
 * native endpoint; this bundle is neither an answer-publication capability nor
 * a reusable prompt. No enrollment, provider call, event, edit, retry or storage.
 * A bounded/incomplete controls page cannot authorize automatic presentation.
 */
export async function readDocumentMemoryBrief(selection:Selection,transport:typeof fetch,
  current:()=>boolean,signal:AbortSignal):Promise<DocumentMemoryBriefLease|null>{
  const selected=structuredClone(selection),custody=parseMemoryCustody(selected.custody),started=sample(),elapsed=createMemoryElapsed(started);
  if(!custody||!selected.projectId||!selected.documentId)throw Error('memory-brief-scope');
  const active=()=>!signal.aborted&&current()&&elapsed.elapsed(sample())<60000;
  const check=()=>{if(!active())throw Error('memory-brief-stale');};
  const guarded:typeof fetch=(input,init)=>{check();const headers=new Headers(init?.headers);
    headers.set('x-forma-memory-consumer','document-brief-v1');return transport(input,{...init,headers});};
  const base=createLiveMemoryClient(guarded),client=createMemoryDerivationClient(guarded);
  let cursor:string|undefined,enrollment:Awaited<ReturnType<typeof base.settings>>['enrollments'][number]|undefined;
  const cursors=new Set<string>();
  // Metadata only: don't scan an unbounded account to populate a small document card.
  for(let page=0;page<4;page++){
    const settings=await base.settings(cursor,signal);check();if(!settings.enabled)return null;
    const matches=settings.enrollments.filter(row=>row.projectId===selected.projectId&&row.documentId===selected.documentId
      &&row.organizationId===(custody.kind==='organization'?custody.organizationId:null));
    if(matches.length>1)throw Error('memory-brief-ambiguous');
    enrollment=matches[0];if(enrollment||!settings.nextAfter)break;
    if(cursors.has(settings.nextAfter))throw Error('memory-brief-pagination');cursors.add(settings.nextAfter);cursor=settings.nextAfter;
  }
  if(!enrollment||!enrollment.learn||!enrollment.recall||enrollment.policyVersion!==MEMORY_POLICY||Date.parse(enrollment.expiresAt)<=Date.now())return null;
  const scope:DerivationScopeRequest={projectId:selected.projectId,documentId:selected.documentId,expectedCustody:custody,
    enrollmentId:enrollment.id,enrollmentRevision:enrollment.revision};
  const settings=await client.settings(scope,signal);check();if(!settings.enabled||!settings.available)return null;
  const grants=settings.grants.filter(row=>row.revokedAt===null&&Date.parse(row.expiresAt)>Date.now());
  const purposes=MEMORY_DERIVATION_PURPOSES.filter(purpose=>grants.some(row=>row.purpose===purpose));
  if(!purposes.length)return null;
  const deadlines=[started.wall+60000,Date.parse(enrollment.expiresAt),...grants.map(row=>Date.parse(row.expiresAt))];
  const sections:DocumentMemoryBrief['sections'][number][]=[];
  for(const purpose of purposes){
    const listing=await client.results(scope,null,signal,purpose);check();deadlines.push(Date.parse(listing.checkedAt)+60000);
    const entry=listing.results[0];
    // No older fallback when the newest native result becomes unavailable.
    const view=entry?await client.inspectResult(entry,signal):null;check();
    if(view)deadlines.push(Date.parse(view.validUntil),Date.parse(view.expiresAt));
    sections.push({purpose,corrections:[],items:view?.items??[],jobId:view?.jobId??null,...(view?.history?{history:view.history}:{})});
  }
  const controls=await client.controls(scope,null,signal);check();
  if(controls.next!==null)throw Error('memory-brief-controls-incomplete');
  deadlines.push(Date.parse(controls.validUntil),...controls.controls.map(row=>Date.parse(row.expiresAt)));
  const resolved=sections.map(section=>{
    const applicable=controls.controls.filter(row=>row.purpose===section.purpose&&row.action!=='released');
    const blocked=new Set(applicable.map(row=>row.lineageId));
    const corrections=[...new Map(applicable.filter(row=>row.action==='corrected'&&row.textAvailable&&row.correctionText!==null)
      .map(row=>[JSON.stringify([row.claimKey,row.correctionText]),row])).values()];
    return {...section,corrections,items:section.items.filter(item=>!item.lineageIds.some(lineage=>blocked.has(lineage)))};
  });
  // One nearest independently eligible source, never an account-wide fan-out.
  // Existing grants remain document-only. Missing optional native schema or a
  // failed source read does not suppress an otherwise certified local brief.
  const related:DocumentMemoryBrief['sections'][number][]=[];
  try {
    const recall=createRecallBoundaryClient(guarded),catalog=await recall.sources(selected,signal);check();
    const nearest=catalog.sources[0],relatedDeadlines=[Date.parse(catalog.validUntil)];
    if(nearest){
      for(const purpose of purposes){
        const view=await recall.inspect(selected,nearest,purpose,signal);check();
        relatedDeadlines.push(Date.parse(view.validUntil));
        related.push({purpose,corrections:[],items:view.items,jobId:view.jobId,...(view.history?{history:view.history}:{}),source:view.source});
      }
      if(related.length)deadlines.push(...relatedDeadlines);
    }
  } catch { check();related.length=0; }
  const until=Math.min(...deadlines),duration=until-started.wall;
  if(!Number.isFinite(until)||duration<=0||elapsed.elapsed(sample())>=duration)throw Error('memory-brief-expired');
  const value:DocumentMemoryBrief={projectId:selected.projectId,documentId:selected.documentId,validUntil:new Date(until).toISOString(),
    completeHistory:false,independentEvidence:false,sections:[...resolved,...related]};
  let retired=false;
  const retire=()=>{retired=true;elapsed.retire();signal.removeEventListener('abort',retire);};
  signal.addEventListener('abort',retire,{once:true});
  return Object.freeze({retire,current:()=>{
    if(retired||!active()||elapsed.elapsed(sample())>=duration||Date.now()>=until){retire();return null;}
    return structuredClone(value);
  }});
}
