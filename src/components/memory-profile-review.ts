import { html,nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { createMemoryProfileClient,type MemoryProfilePage,type MemoryProfileReview as MemoryProfileReviewData,type MemoryProfileEntry } from '../state/memory-profile-catalog-client.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { memoryProfileMessages } from './design-system/locales/memory-profile-messages.ts';

/** Actor-private profile review. The catalog is metadata only; each selected
 * current profile requires fresh original-source and correction checks. */
export class MemoryProfileReview extends FormaElement{
 #page:MemoryProfilePage|null=null;#review:MemoryProfileReviewData|null=null;#busy=false;#suspended=false;#notice='';
 #controller:AbortController|null=null;#current:(()=>boolean)|null=null;#timer:ReturnType<typeof setTimeout>|undefined;#clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;
 #text(){return memoryProfileMessages[this.i18n.locale.startsWith('ar')?'ar':this.i18n.locale.startsWith('fr')?'fr':this.i18n.locale.startsWith('ja')?'ja':'en'];}
 #clear(){this.#controller?.abort();this.#controller=null;this.#current=null;this.#page=null;this.#review=null;this.#busy=false;this.#notice='';clearTimeout(this.#timer);this.#clock?.retire();this.#clock=null;}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};#show=()=>{this.#suspended=false;this.requestUpdate();};#privacy=()=>{this.#clear();this.requestUpdate();};#visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('pageshow',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('pageshow',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override updated(){if(this.#current&&!this.#current()){this.#clear();this.requestUpdate();}}
 async #load(entry?:MemoryProfileEntry,after=''){
  if(this.#busy||this.#suspended||memoryPrivacyMutationActive())return;this.#clear();const store=this.store,session=store.session.get(),auth=store.captureAuthorizationScope(),source=store.captureSourceOwnership(),route=store.route.get(),locale=this.i18n.locale;
  if(!session||session.impersonation||!auth||!store.sourceOwnershipActive(source))return;const controller=new AbortController();this.#controller=controller;
  const current=()=>this.#controller===controller&&!controller.signal.aborted&&this.isConnected&&!this.#suspended&&this.ownerDocument.visibilityState==='visible'&&!memoryPrivacyMutationActive()&&this.store===store&&store.route.get()===route&&store.authorizationScopeActive(auth)&&store.sourceOwnershipActive(source)&&store.session.get()?.user.userId===session.user.userId&&!store.session.get()?.impersonation&&this.i18n.locale===locale;this.#current=current;this.#busy=true;this.requestUpdate();
  const client=createMemoryProfileClient((url,init)=>store.guardedFetch(url,init,this.#text().heading,{current}));
  try{
   const value=entry?await client.inspect(entry,controller.signal):await client.page(controller.signal,after);if(!current())return;
   if(entry)this.#review=value as MemoryProfileReviewData;else this.#page=value as MemoryProfilePage;
   this.#clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});this.#duration=Date.parse(value.validUntil)-Date.now();this.#timer=setTimeout(()=>{this.#clear();this.#notice='expired';this.requestUpdate();},Math.max(0,this.#duration));
  }catch{if(current())this.#notice='unavailable';}finally{if(current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){
  const c=this.#text(),live=this.#current?.()&&this.#clock&&this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<this.#duration,page=live?this.#page:null,review=live?this.#review:null,disabled=this.#busy||this.#suspended||memoryPrivacyMutationActive();
  return html`<section class="memory-profile-review"><h3>${c.heading}</h3><p>${c.intro}</p><p>${c.scope}</p><div class="resource-memory-actions"><button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#load()}>${c.refresh}</button>${page?.nextAfter?html`<button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#load(undefined,page.nextAfter!)}>${c.next}</button>`:nothing}</div>
   ${page?html`<p>${c.metadata}</p>${page.entries.length?page.entries.map(entry=>html`<article><p><strong>${c.project}: <bdi>${entry.project_id}</bdi></strong> · ${c.document}: <bdi>${entry.document_id}</bdi></p><p>${c.partition}: <bdi>${entry.organization_id??c.personal}</bdi> · ${c.owner}: <bdi>${entry.owner_user_id}</bdi></p><button type="button" class="button secondary" ?disabled=${disabled||entry.state!=='active'||Date.parse(entry.expires_at)<=Date.now()} @click=${()=>this.#load(entry)}>${c.inspect}</button>${entry.state!=='active'||Date.parse(entry.expires_at)<=Date.now()?html`<p>${c.retired}</p>`:nothing}</article>`):html`<p>${c.empty}</p>`}`:nothing}
   ${review?html`<article><h4>${c.document}: <bdi>${review.entry.document_id}</bdi></h4><p>${c.published}: <bdi>${review.entry.published_at}</bdi></p><p>${c.tentative}</p>${review.corrections.length?html`<section><h4>${c.corrections}</h4>${review.corrections.map(row=>html`<p class="memory-profile-text">${row.correctionText}</p>`)}</section>`:nothing}${review.items.length?review.items.map(item=>html`<section><p class="memory-profile-text">${item.text}</p><details><summary>${c.evidence}</summary>${item.supports.map(q=>html`<blockquote>${q.text}</blockquote>`)}${item.counterevidence.length?html`<h4>${c.counterevidence}</h4>${item.counterevidence.map(q=>html`<blockquote>${q.text}</blockquote>`)}`:nothing}</details></section>`):html`<p>${c.noClaims}</p>`}</article>`:nothing}<p role="status">${this.#notice?c[this.#notice as 'unavailable']:nothing}</p></section>`;
 }
}
if(!customElements.get('forma-memory-profile-review'))customElements.define('forma-memory-profile-review',MemoryProfileReview);
