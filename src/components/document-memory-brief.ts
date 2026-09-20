import { documentViewFromRoute, documentContextBlockFromRoute } from '../model/routes.ts';
import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import './memory-assistant-context.ts';
import { html, nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { readDocumentMemoryBrief, type DocumentMemoryBriefLease } from '../state/document-memory-brief.ts';
import { parseMemoryCustody } from '../model/memory-custody.ts';
import { personalMemoryMessage } from './design-system/locales/personal-memory-messages.ts';
import './document-memory-brief.css';

type BriefOwner={controller:AbortController;current:()=>boolean};
/** Read-only re-entry consumer. It never applies a candidate to authored context,
 * emits a consumption event, enrolls, or puts text into an assistant prompt. */
export class DocumentMemoryBrief extends FormaElement {
  #owner:BriefOwner|null=null;
  #lease:DocumentMemoryBriefLease|null=null;
  #timer:ReturnType<typeof setTimeout>|undefined;
  #suspended=false;
  #hadContent=false;
  #profileAfter:string|null=null;
  #focusProfilePage=false;
  #profileScope:string|null=null;
  #t(key:string,values:Record<string,string|number>={}){return personalMemoryMessage(this.i18n.locale,'memory.live.'+key,values);}
  #clear(){this.#owner?.controller.abort();this.#owner=null;this.#lease?.retire();this.#lease=null;clearTimeout(this.#timer);this.#timer=undefined;this.#hadContent=false;}
  #hide=()=>{this.#profileAfter=null;this.#profileScope=null;this.#suspended=true;this.#clear();this.requestUpdate();};
  #show=()=>{if(this.ownerDocument.visibilityState==='visible'){this.#suspended=false;this.#sync();this.requestUpdate();}};
  #visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
  override connectedCallback(){super.connectedCallback();this.ownerDocument.addEventListener('visibilitychange',this.#visibility);
    window.addEventListener('pagehide',this.#hide);window.addEventListener('pageshow',this.#show);window.addEventListener('blur',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#refresh);}
  override disconnectedCallback(){this.#clear();this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);
    window.removeEventListener('pagehide',this.#hide);window.removeEventListener('pageshow',this.#show);window.removeEventListener('blur',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#refresh);super.disconnectedCallback();}
  protected override updated(){this.#sync();}
  #scope(){
    const session=this.store.session.get(),p=this.store.projection.get(),context=session?.projectContext;
    if(!session||session.impersonation||!Array.isArray(session.projects)||!p.projectId||!p.documentId)return null;
    const matches=session.projects.filter(project=>project.projectId===p.projectId);
    if(context?(context.projectId!==p.projectId||matches.length!==1||matches[0]!.organizationId!==context.organizationId
      ||matches[0]!.projectAccessId!==context.projectAccessId):matches.length!==0)return null;
    const custody=parseMemoryCustody(context?{kind:'organization',organizationId:context.organizationId,projectAccessId:context.projectAccessId,ownerUserId:context.ownerUserId}:{kind:'personal'});
    const document=p.documents.find(row=>row.id===p.documentId&&row.projectId===p.projectId);
    return custody&&document?{projectId:p.projectId,documentId:p.documentId,custody,view:documentViewFromRoute(this.store.route.get()),blockId:documentContextBlockFromRoute(this.store.route.get()),stamp:JSON.stringify([document.createdSequence,document.sourceEvents])}:null;
  }
  #sync(){
    if(this.#owner?.current())return;
    this.#clear();
    if(!this.isConnected||this.#suspended||memoryPrivacyMutationActive()||this.ownerDocument.visibilityState!=='visible')return;
    const store=this.store,session=store.session.get(),authorization=store.captureAuthorizationScope(),source=store.captureSourceOwnership();
    const selected=this.#scope();if(!session||!authorization||!selected||!store.sourceOwnershipActive(source))return;
    const route=store.route.get(),locale=this.i18n.locale,scopeStamp=JSON.stringify(selected),controller=new AbortController();
    const profileScope=JSON.stringify([session.user.userId,authorization,source,route,locale,scopeStamp]);
    if(this.#profileScope!==profileScope){this.#profileAfter=null;this.#profileScope=profileScope;}
    const profileAfter=this.#profileAfter,focusProfilePage=this.#focusProfilePage;this.#focusProfilePage=false;
    const owner:BriefOwner={controller,current:()=>this.#owner===owner&&!memoryPrivacyMutationActive()&&!controller.signal.aborted&&this.isConnected&&!this.#suspended
      &&this.ownerDocument.visibilityState==='visible'&&this.store===store&&store.session.get()?.user.userId===session.user.userId
      &&!store.session.get()?.impersonation&&store.authorizationScopeActive(authorization)&&store.sourceOwnershipActive(source)
      &&store.route.get()===route&&this.i18n.locale===locale&&JSON.stringify(this.#scope())===scopeStamp};
    this.#owner=owner;
    void readDocumentMemoryBrief({...selected,profileAfter},(input,init)=>store.guardedFetch(input,init,this.#t('briefHeading'),{current:owner.current}),owner.current,controller.signal)
      .then(lease=>{if(!owner.current()){lease?.retire();return;}this.#lease=lease;const value=lease?.current();
        this.#hadContent=Boolean(value?.sections.some(section=>section.items.length||section.corrections.length));
        if(value)this.#timer=setTimeout(()=>this.#expire(owner),Math.max(0,Date.parse(value.validUntil)-Date.now()));
        this.requestUpdate();
        if(focusProfilePage&&value)void this.updateComplete.then(()=>{if(owner.current())this.querySelector<HTMLButtonElement>('button')?.focus();});
      }).catch(()=>{if(owner.current()){this.#lease=null;this.requestUpdate();}});
  }
  #expire(owner:BriefOwner){
    if(!owner.current())return;
    const active=this.ownerDocument.activeElement,restore=Boolean(active&&this.contains(active)&&active!==this.querySelector('button'));
    this.#lease?.retire();this.#lease=null;this.requestUpdate();
    if(restore)void this.updateComplete.then(()=>{if(owner.current())this.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});});
  }
  #olderProfile=()=>{
    if(!this.#owner?.current())return;
    const next=this.#lease?.current()?.sections.find(section=>section.retainedProfile)?.retainedProfile?.nextAfter;
    if(!next)return;this.#focusProfilePage=true;this.#profileAfter=next;this.#clear();this.#sync();this.requestUpdate();
  };
  #refresh=()=>{this.#profileAfter=null;this.#clear();this.#sync();this.requestUpdate();};
  override render(){
    if(!this.#owner?.current())return nothing;
    const value=this.#lease?.current();
    if(!this.#hadContent)return nothing;
    return html`<aside class="document-memory-brief" aria-label=${this.#t('briefHeading')} data-memory-document-brief>
      <header><h2>${this.#t('briefHeading')}</h2><button type="button" class="button ghost compact" @click=${this.#refresh}>${this.#t('briefRefresh')}</button></header>
      ${value?html`<p class="memory-brief-disclosure">${this.#t('briefDisclosure')}</p>
        ${value.sections.filter(section=>section.items.length||section.corrections.length).map(section=>html`<section>
          <h3>${this.#t('purpose.'+section.purpose)}</h3>
          ${section.jobId&&section.items.length?html`<forma-memory-assistant-context .candidateJobId=${section.jobId}></forma-memory-assistant-context>`:nothing}
          ${section.source?html`<p>${section.source.documentId} · ${this.#t('recallBoundary.'+section.source.zoom)}</p><p class="memory-brief-disclosure">${this.#t('recallBoundaryPreview')} ${this.#t('briefSourceWeight',{weight:Math.round(section.source.weight*1000)/1000})}</p>`:nothing}
          ${section.corrections.map(control=>html`<p class="memory-brief-correction"><strong>${this.#t('reviewAction.corrected')}</strong> ${control.correctionText}</p>`)}
          ${section.retainedProfile?html`<p class="memory-brief-disclosure">${this.#t('profileRetained',{count:section.retainedProfile.results})}
            ${section.retainedProfile.historicalPage?this.#t('profileHistoryPage'):nothing}</p>`:nothing}
          <ul>${section.items.map((item,index)=>html`<li><p>${item.text}</p>${item.citationStatus==='conflicting-citations'?html`<strong>${this.#t('briefConflict')}</strong>`:nothing}
            ${'profileOrigin' in item?html`<p class="memory-brief-disclosure">${this.#t(item.profileOrigin.state==='latest'?'profileLatest':'profileHistorical')}
              ${item.profileOrigin.repeatedIn>1?this.#t('profileRepeated',{count:item.profileOrigin.repeatedIn}):nothing}
              ${item.profileOrigin.sharedEvidence?this.#t('profileSharedEvidence'):nothing}
              ${item.profileOrigin.interpretation==='revised'?this.#t('profileRevised'):nothing}
              ${item.profileOrigin.counterevidence?this.#t('profileCitedConflict'):nothing}</p>
              ${index===section.items.findIndex(candidate=>'profileOrigin' in candidate&&candidate.profileOrigin.jobId===item.profileOrigin.jobId)?html`<forma-memory-assistant-context .candidateJobId=${item.profileOrigin.jobId}></forma-memory-assistant-context>`:nothing}`:nothing}
            <details><summary>${this.#t(item.observationCitations?.length?'behavioralEvidence':'briefEvidence')}</summary>
              ${item.resourceCitations?.length?html`<p class="memory-brief-disclosure">${this.#t('resourceEvidenceDisclosure')}</p><ul data-memory-evidence-resources>${[...new Map(item.resourceCitations.map(row=>[JSON.stringify(row.resource),row.resource])).values()].map(resource=>html`<li>${resource.zoom==='page'?this.#t('resourceEvidencePage',{view:this.#t('visitsPage.'+resource.view)}):resource.zoom==='block'?this.#t('resourceEvidenceBlock',{block:resource.blockId,revision:resource.revision}):this.#t('resourceEvidenceDocument')}</li>`)}</ul>`:nothing}
              ${item.observationCitations?.length?html`<p>${this.#t('behavioralDisclosure')}</p><ul>${item.observationCitations.map(cited=>html`<li>${this.#t('behavioralRole.'+cited.role)}: ${this.#t('behavioralAction.'+cited.action)} · <time datetime=${cited.recordedAt}>${this.i18n.date(new Date(cited.recordedAt),{dateStyle:'medium',timeStyle:'short'})}</time></li>`)}</ul>`:nothing}
              ${item.supports.map(quote=>html`<blockquote>${quote.text}</blockquote>`)}
              ${item.counterevidence.length?html`<p>${this.#t('briefCounterevidence')}</p>${item.counterevidence.map(quote=>html`<blockquote>${quote.text}</blockquote>`)}`:nothing}
            </details></li>`)}</ul>
          ${section.retainedProfile?.nextAfter?html`<button type="button" class="button ghost compact" @click=${this.#olderProfile}>${this.#t('profileOlder')}</button>`:nothing}
          ${section.history?html`<small>${this.#t('reviewHistory',{windows:section.history.windowCount,pairs:section.history.originalPairs})} ${this.#t('reviewHistory.'+section.history.boundary)}</small>`:nothing}
        </section>`)}`:html`<p role="status">${this.#t('briefExpired')}</p>`}
    </aside>`;
  }
}
if(!customElements.get('forma-document-memory-brief'))customElements.define('forma-document-memory-brief',DocumentMemoryBrief);
