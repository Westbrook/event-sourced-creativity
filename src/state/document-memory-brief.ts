import { memoryEvidenceProximity } from '../model/memory-evidence-resource.ts';
import type { DocumentView } from '../model/routes.ts';
import { createLiveMemoryClient, MEMORY_POLICY } from './live-memory-client.ts';
import { createMemoryDerivationClient, type DerivationControl, type DerivationHistory, type DerivationResultItem, type DerivationScopeRequest } from './memory-derivation-client.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { MEMORY_DERIVATION_PURPOSES, type MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';
import { parseMemoryCustody, type MemoryCustody } from '../model/memory-custody.ts';
import { createRecallBoundaryClient, type RecallSource } from './memory-recall-boundary-client.ts';
import { MEMORY_PROFILE_REVIEW_LIMIT, reconcileMemoryProfile, type ReconciledProfileItem } from './memory-profile-reconciliation.ts';

export type DocumentMemoryBrief = Readonly<{ projectId:string;documentId:string;validUntil:string;
  completeHistory:false;independentEvidence:false;sections:readonly Readonly<{purpose:MemoryDerivationPurpose;
    corrections:readonly DerivationControl[];items:readonly (DerivationResultItem|ReconciledProfileItem)[];jobId:string|null;history?:DerivationHistory;source?:RecallSource;
    retainedProfile?:{results:number;complete:false;nextAfter:string|null;historicalPage:boolean}}>[] }>;
export type DocumentMemoryBriefLease = Readonly<{current:()=>DocumentMemoryBrief|null;retire:()=>void}>;
type Selection={projectId:string;documentId:string;custody:MemoryCustody;view?:DocumentView|null;blockId?:string|null;profileAfter?:string|null};
const sample=()=>({monotonic:performance.now(),wall:Date.now()});

/** Automatic presentation only. Each private result is freshly checked by its
 * native endpoint; this bundle is neither an answer-publication capability nor
 * a reusable prompt. No enrollment, provider call, event, edit, retry or storage.
 * A bounded/incomplete controls page cannot authorize automatic presentation.
 */
export const MEMORY_BRIEF_READ_TIMEOUT_MS=60000;
/** Bound the entire multi-page read, including a transport that never settles.
 * The original caller's cancellation remains connected throughout the lease;
 * no late body or timed-out operation can recreate a retired presentation. */
export async function readDocumentMemoryBrief(selection:Selection,transport:typeof fetch,
  current:()=>boolean,signal:AbortSignal):Promise<DocumentMemoryBriefLease|null>{
  const controller=new AbortController();let retained=false;
  let reject!:(error:Error)=>void;
  const interrupted=new Promise<never>((_,fail)=>{reject=fail;});void interrupted.catch(()=>undefined);
  const abort=()=>{controller.abort();signal.removeEventListener('abort',abort);reject(Error('memory-brief-stale'));};
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,MEMORY_BRIEF_READ_TIMEOUT_MS);
  try{
    if(signal.aborted||!current()){controller.abort();throw Error('memory-brief-stale');}
    const pending=assembleDocumentMemoryBrief(selection,transport,current,controller.signal).then(lease=>{
      if(controller.signal.aborted){lease?.retire();throw Error('memory-brief-stale');}return lease;
    });
    const lease=await Promise.race([pending,interrupted]);if(!lease)return null;
    const retire=()=>{lease.retire();controller.abort();signal.removeEventListener('abort',abort);};
    retained=true;
    return Object.freeze({retire,current:()=>{
      const value=controller.signal.aborted?null:lease.current();if(!value)retire();return value;
    }});
  }finally{
    clearTimeout(timer);if(!retained){controller.abort();signal.removeEventListener('abort',abort);}
  }
}

async function assembleDocumentMemoryBrief(selection:Selection,transport:typeof fetch,
  current:()=>boolean,signal:AbortSignal):Promise<DocumentMemoryBriefLease|null>{
  const selected=structuredClone(selection),custody=parseMemoryCustody(selected.custody),started=sample(),elapsed=createMemoryElapsed(started);
  if(!custody||!selected.projectId||!selected.documentId)throw Error('memory-brief-scope');
  const active=()=>!signal.aborted&&current()&&elapsed.elapsed(sample())<60000;
  const check=()=>{if(!active())throw Error('memory-brief-stale');};
  const guarded:typeof fetch=(input,init)=>{check();const headers=new Headers(init?.headers);
    headers.set('x-forma-memory-consumer','document-brief-v1');return transport(input,{...init,headers});};
  const base=createLiveMemoryClient(guarded),client=createMemoryDerivationClient(guarded);
  const inspect=(entry:Parameters<typeof client.inspectResult>[0],readSignal:AbortSignal)=>{
    // Each independent result has its own strict latest-request client. The
    // shared owner signal/current predicate still cancels the whole bundle.
    const reader=createMemoryDerivationClient(guarded);
    return selected.view?reader.inspectResultResources(entry,readSignal):reader.inspectResult(entry,readSignal);
  };
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
  const deadlines=[started.wall+60000,Date.parse(enrollment.expiresAt),...grants.map(row=>Date.parse(row.expiresAt))];
  const sections:DocumentMemoryBrief['sections'][number][]=[];
  for(const purpose of purposes){
    const listing=await client.results(scope,null,signal,purpose,true);check();deadlines.push(Date.parse(listing.checkedAt)+60000);
    const entry=listing.results[0];
    // No older fallback when the newest native result becomes unavailable.
    const view=entry?await inspect(entry,signal):null;check();
    if(view)deadlines.push(Date.parse(view.validUntil),Date.parse(view.expiresAt));
    if(purpose==='profile'&&view){
      // Establish the latest result first: a withdrawn newest result must never
      // resurrect an older profile. Every older page and body is independently
      // authorized; this bounded scan neither extends retention nor persists a
      // cumulative profile that could outlive its supporting originals.
      const views=[view],seenJobs=new Set([view.jobId]),seenPages=new Set<string>();
      let after:string|null=selected.profileAfter??null,nextAfter:string|null=null;
      for(let page=0;page<MEMORY_PROFILE_REVIEW_LIMIT/8;page++){
        const retained=await client.results(scope,after,signal,purpose);check();
        deadlines.push(Date.parse(retained.checkedAt)+60000);
        if(page===0&&!selected.profileAfter&&retained.results[0]?.jobId!==view.jobId)throw Error('memory-profile-changed');
        const olderEntries=retained.results.slice(page===0&&!selected.profileAfter?1:0);
        const pageEntries=olderEntries.slice(0,MEMORY_PROFILE_REVIEW_LIMIT-views.length);
        for(const older of pageEntries){
          if(seenJobs.has(older.jobId))throw Error('memory-profile-pagination');
          seenJobs.add(older.jobId);
        }
        // At most four independent native result reads overlap. Preserve the
        // listing order and inspect every outcome before advancing the cursor.
        // A failed/withdrawn result aborts the page, never an older fallback.
        for(let offset=0;offset<pageEntries.length;offset+=4){
          check();const batch=await Promise.allSettled(pageEntries.slice(offset,offset+4).map(async older=>{
            check();const prior=await inspect(older,signal);check();return prior;
          }));
          check();const failure=batch.find(row=>row.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
          for(const row of batch)if(row.status==='fulfilled'){
            const prior=row.value;deadlines.push(Date.parse(prior.validUntil),Date.parse(prior.expiresAt));views.push(prior);
          }
        }
        nextAfter=pageEntries.length<olderEntries.length?pageEntries.at(-1)?.jobId??null:retained.next;
        if(!nextAfter||views.length===MEMORY_PROFILE_REVIEW_LIMIT)break;
        if(seenPages.has(nextAfter)||nextAfter===after)throw Error('memory-profile-pagination');
        seenPages.add(nextAfter);after=nextAfter;
      }
      const profile=reconcileMemoryProfile(views);
      sections.push({purpose,corrections:[],items:profile.items,jobId:null,retainedProfile:{results:profile.results,complete:false,nextAfter,historicalPage:Boolean(selected.profileAfter)},...(view.history?{history:view.history}:{})});
    }else sections.push({purpose,corrections:[],items:view?.items??[],jobId:view?.jobId??null,...(view?.history?{history:view.history}:{})});
  }
  const controls=purposes.length?await client.controls(scope,null,signal):{controls:[],next:null,validUntil:new Date(started.wall+60000).toISOString()};check();
  if(controls.next!==null)throw Error('memory-brief-controls-incomplete');
  deadlines.push(Date.parse(controls.validUntil),...controls.controls.map(row=>Date.parse(row.expiresAt)));
  const resolved=sections.map(section=>{
    const applicable=controls.controls.filter(row=>row.purpose===section.purpose&&row.action!=='released');
    const blocked=new Set(applicable.map(row=>row.lineageId));
    const corrections=[...new Map(applicable.filter(row=>row.action==='corrected'&&row.textAvailable&&row.correctionText!==null)
      .map(row=>[JSON.stringify([row.claimKey,row.correctionText]),row])).values()];
    const items=section.items.filter(item=>!item.lineageIds.some(lineage=>blocked.has(lineage)));
    const rank=(item:DerivationResultItem)=>({block:0,page:1,document:2})[memoryEvidenceProximity(item.resourceCitations,selected)];
    items.sort((a,b)=>rank(a)-rank(b));
    return {...section,corrections,items};
  });
  // One independently eligible source per relevance band, at most four.
  // These are separate facets, not fallback evidence or a blended personality.
  // Source boundaries and access are proved again for every actual result.
  const related:DocumentMemoryBrief['sections'][number][]=[];
  try {
    const recall=createRecallBoundaryClient(guarded),catalog=await recall.sources(selected,signal);check();
    const bands=new Set<string>(),chosen=catalog.sources.filter(source=>{
      if(bands.has(source.zoom))return false;bands.add(source.zoom);return true;
    });
    if(chosen.length>4)throw Error('memory-brief-source-capacity');
    const relatedDeadlines=[Date.parse(catalog.validUntil)];
    for(const source of chosen){
      // The source's existing purpose consent governs presentation. This does
      // not enroll the target in processing or silently widen any boundary.
      for(const purpose of MEMORY_DERIVATION_PURPOSES){
        try {
          const view=await recall.inspect(selected,source,purpose,signal);check();
          relatedDeadlines.push(Date.parse(view.validUntil));
          related.push({purpose,corrections:[],items:view.items,jobId:view.jobId,...(view.history?{history:view.history}:{}),source:view.source});
        } catch { check(); } // No alternate source in this band after failure.
      }
    }
    if(related.length)deadlines.push(...relatedDeadlines);
  } catch { check();related.length=0; }
  if(!resolved.length&&!related.length)return null;
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
